# Keputusan Desain & Analisis Sistem (Architectural Decisions)

Dokumen ini menjelaskan keputusan teknis, mekanisme proteksi kuota, penanganan konkurensi, idempotensi, trade-off arsitektur, serta korelasi implementasi dengan materi **Silabus Backend Intermediate**.

---

## 1. Menjaga Kuota Tidak Oversell (High Concurrency Protection)
* **Pilihan Arsitektur**: Transaksi ACID PostgreSQL dengan pesimistik row-level lock (`SELECT ... FOR UPDATE`) pada baris `ticket_types`, lalu menghitung kuota terpakai di dalam transaksi yang sama.
* **Alasan**: Semua pesanan untuk tipe tiket yang sama akan mengantre secara serial di level database lock. Sisa kuota dihitung secara deterministik dan tidak dapat berubah di tengah proses transaksi.
* **Alternatif yang Dipertimbangkan**:
  1. *Atomic update* (`UPDATE ... SET sold = sold + n WHERE sold + n <= quota`): Cepat, tetapi nilai counter harus dikembalikan secara manual jika pesanan batal atau kedaluwarsa, yang rentan meleset/inkonsisten saat crash.
  2. *Optimistic locking + retry*: Menyebabkan banyak *retry storm* dan memboroskan resource CPU database saat rebutan kuota tinggi.
  3. *Distributed Lock di Redis*: Menambah dependensi infrastruktur baru dan menimbulkan risiko *dual-write problem* antara Redis dan PostgreSQL.
* **Trade-off**: Pesanan untuk tipe tiket yang sama diproses secara serial. Untuk skala event ini (ratusan/ribuan pesanan), performa sangat mumpuni (200 permintaan paralel selesai dalam ~1,3 detik).

---

## 2. Batas Maksimal 4 Tiket per Pembeli per Event
* **Pilihan Arsitektur**: Menggunakan **PostgreSQL Transaction-level Advisory Lock** (`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`) pada kombinasi string `${userId}:${eventId}` di awal transaksi.
* **Alasan**: Row lock pada tipe tiket saja tidak cukup. Jika seorang pembeli membuka 2 tab sekaligus dan memesan tiket Reguler dan VIP di milidetik yang sama, kedua request tersebut akan memegang lock baris tiket yang berbeda dan bisa meloloskan lebih dari 4 tiket. Dengan advisory lock per pembeli-event, kedua transaksi tersebut dipaksa serial.
* **Pencegahan Deadlock**: Urutan akuisisi lock dibuat selalu konsisten di semua alur kode: **(1) Lock Pembeli-Event, baru kemudian (2) Lock Baris Tipe Tiket**.

---

## 3. Kedaluwarsa Kuota 15 Menit (Auto-Expiry)
* **Pilihan Arsitektur**: Kebenaran status kuota **tidak bergantung pada background worker/cron**.
* **Alasan**: Setiap query perhitungan sisa kuota hanya memperhitungkan pesanan dengan filter:
  ```sql
  (status = 'PAID' OR (status = 'PENDING' AND expires_at > clock_timestamp()))
  ```
  Fungsi `clock_timestamp()` digunakan (bukan `now()`) agar waktu dibaca saat query dieksekusi, bukan saat transaksi dimulai. Begitu detik ke-901 tercapai, pesanan otomatis tidak lagi menahan kuota, dan kuota seketika tersedia bagi pembeli lain.
* **Peran Worker**: Background worker (berjalan tiap 30 detik) hanya bertugas untuk *housekeeping* (merapikan status DB dari `PENDING` menjadi `EXPIRED`).
* **Alternatif yang Ditolak**: *Timer in-memory* (hilang saat restart) atau *Delayed Queue* (menambah kompleksitas broker).

---

## 4. Pencegahan Tiket Terbit Ganda (Idempotency Lunas)
Sistem menerapkan perlindungan 3 lapis:
1. Baris pesanan dikunci `FOR UPDATE` saat endpoint pembayaran atau webhook dipanggil.
2. Validasi transisi status: hanya pesanan berstatus `PENDING` yang belum kedaluwarsa yang dapat beralih ke `PAID`. Jika sudah `PAID`, sistem mengembalikan data tiket yang sudah terbit tanpa membuat baru.
3. Constraint level database: tabel `tickets` memiliki constraint `UNIQUE (order_id, seq)` dipadukan dengan klausa `ON CONFLICT DO NOTHING`.

---

## 5. Webhook Pembayaran Idempoten (Nilai Tambah)
* **Penyimpanan Event Provider**: ID event dari penyedia pembayaran dijadikan `PRIMARY KEY` pada tabel `payment_events`. Pencatatan status event dan pembaruan order dilakukan dalam satu transaksi database.
* **Penanganan Duplikat**: Jika webhook yang sama dikirimkan ulang oleh provider (misal karena network retry), sistem mengenali primary key yang sudah ada dan langsung merespon HTTP 200 dengan status pemrosesan sebelumnya.
* **Late Payment**: Jika webhook pembayaran tiba terlambat (setelah 15 menit dan status sudah `EXPIRED`), tiket **tidak akan diterbitkan** demi menjaga kuota yang mungkin sudah dibeli pengguna lain. Sistem mencatat event dengan status `LATE_PAYMENT_REFUND_NEEDED`.
* **Keamanan Signature**: Signature diverifikasi menggunakan algoritma **HMAC-SHA256** dan pencocokan waktu konstan (`crypto.timingSafeEqual`) untuk memitigasi serangan *timing attack*.

---

## 6. Penerapan Materi Silabus Backend Intermediate

Proyek ini merefleksikan seluruh kompetensi yang diajarkan sepanjang silabus:

| Pertemuan Silabus | Topik Pembelajaran | Penerapan pada Proyek Ini |
|---|---|---|
| **Pertemuan 2** | Dockerfile, Containerization, Port Mapping & Env | Penulisan **Multi-stage Dockerfile** (Build TypeScript & Minimal Alpine Runtime), non-root user (`USER node`), Healthcheck container, serta konfigurasi environment variables (`.env`). |
| **Pertemuan 3** | Docker Compose, Volumes, Network Isolation | Orkestrasi multi-container (`db`, `api`, `nginx`) via `docker-compose.yml`. Menggunakan **Named Volume** (`pgdata`) untuk persistensi data dan **User-defined Bridge Network** (`app-net`) untuk isolasi database (database tidak membuka port ke host publik). |
| **Pertemuan 4** | Reverse Proxy & Web Server Nginx | Integrasi **Nginx sebagai Reverse Proxy** di depan backend API. Nginx bertindak sebagai gerbang masuk tunggal (port 3300), meneruskan traffic ke service backend, dan menyuntikkan reverse proxy headers (`X-Real-IP`, `X-Forwarded-For`, `X-Forwarded-Proto`). |
| **Pertemuan 5** | Keamanan Web, Secret Management, Hashing | Validasi kriptografi HMAC-SHA256 pada Webhook payload, proteksi timing attack dengan `crypto.timingSafeEqual`, dan isolasi secret pada environment variables. |
| **Pertemuan 6** | Monolith vs Microservices, Event-Driven | Memilih arsitektur **Modular Monolith** karena sistem penjualan tiket dengan kuota terbatas menuntut konsistensi transaksi yang sangat ketat (ACID). Pendekatan Microservices dihindari karena membutuhkan *Distributed Transaction* (2PC/Saga) yang rawan inkonsistensi saat rebutan kuota. Pola **Event-Driven Asynchronous** tetap diterapkan pada penerimaan notifikasi Webhook pembayaran. |
| **Pertemuan 7** | CI/CD Pipeline & GitHub Actions, Logging | Otomatisasi pipeline pada `.github/workflows/ci.yml`: menjalankan service database PostgreSQL, *type-checking*, *automated testing*, *build Docker image*, dan *push* ke GitHub Container Registry (`ghcr.io`) dengan commit SHA tagging. Log aplikasi distandardisasi agar mudah dipantau via `docker compose logs`. |

---

## 7. Keterbatasan & Rencana Peningkatan (Trade-offs & Scalability)
* **Pengembalian Dana**: Transaksi `LATE_PAYMENT_REFUND_NEEDED` saat ini dicatat pada tabel audit; pada sistem produksi skala enterprise, status ini dapat memicu webhook otomatis ke payment gateway refund API.
* **Skalabilitas Jutaan Request**: Pada skala jutaan transaksi per detik, lock database dapat digantikan dengan arsitektur *Virtual Waiting Room* dan antrean terdistribusi (Message Queue seperti Kafka / RabbitMQ) untuk meratakan lonjakan traffic (*traffic spike levelling*).
