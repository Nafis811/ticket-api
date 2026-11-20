# Keputusan Desain (Architectural Decisions)

Dokumen ini menjelaskan keputusan teknis, mekanisme proteksi kuota, penanganan konkurensi, idempotensi, dan trade-off arsitektur pada sistem penjualan tiket API.

## 1. Menjaga kuota tidak oversell
Pilihan: transaksi + `SELECT ... FOR UPDATE` pada baris `ticket_types`, lalu hitung kuota terpakai
di dalam transaksi yang sama.
Alasan: semua pesanan untuk tipe yang sama antre di satu lock, jadi hitungan tidak bisa berubah di tengah jalan.
Alternatif: (a) atomic `UPDATE ... SET sold = sold + n WHERE sold + n <= quota`: cepat, tapi counter
harus dikembalikan manual saat batal/kedaluwarsa dan bisa melenceng; (b) optimistic locking + retry:
boros saat rebutan tinggi; (c) lock di Redis: menambah komponen baru.
Trade-off: pesanan untuk satu tipe tiket diproses serial. Untuk event kecil ini cukup
(200 request selesai sekitar 1,4 detik).

## 2. Batas 4 tiket per pembeli per event
Advisory lock per (pembeli, event) di awal transaksi. Row lock tipe tiket saja tidak cukup:
pembeli yang memesan Reguler dan VIP bersamaan memegang lock berbeda dan bisa lolos jadi lebih dari 4.
Urutan lock selalu sama (pembeli lalu tipe tiket) supaya tidak terjadi deadlock.

## 3. Kedaluwarsa 15 menit
Kebenaran tidak bergantung pada worker: setiap hitungan kuota hanya menghitung PENDING dengan
`expires_at > clock_timestamp()`, jadi kuota kembali tepat saat waktu habis.
Worker (tiap 30 detik) hanya merapikan status PENDING -> EXPIRED.
Alternatif: timer/queue per pesanan: hilang saat proses restart dan butuh infrastruktur tambahan.
Trade-off: query kuota sedikit lebih kompleks; status bisa terlambat maksimal 30 detik.
`clock_timestamp()` dipakai (bukan `now()`) karena `now()` membeku di awal transaksi.

## 4. Satu pesanan tidak menerbitkan tiket dua kali
Tiga lapis: (1) baris order dikunci `FOR UPDATE` saat bayar, (2) transisi hanya dari PENDING,
(3) `UNIQUE (order_id, seq)` di tabel `tickets`. Membayar ulang mengembalikan hasil yang sama.

## 5. Webhook (nilai tambah)
Idempotency: id event provider = PRIMARY KEY di `payment_events`, ditulis di transaksi yang sama
dengan perubahan pesanan. Duplikat -> 200 dengan hasil sebelumnya.
Terlambat/setelah kedaluwarsa: tidak ada tiket, dicatat `LATE_PAYMENT_REFUND_NEEDED` (kuota mungkin
sudah dipakai orang lain, jadi pesanan tidak dihidupkan lagi).
Signature HMAC diverifikasi dengan `timingSafeEqual`.

## 6. Keputusan lain
- Harga integer (rupiah, tanpa desimal) agar tidak ada masalah pembulatan.
- Auth seadanya (header `X-User-Id`) karena tidak dinilai. Endpoint pay dan buat event tanpa auth: hanya untuk simulasi.
- Migrasi: satu `schema.sql` idempoten saat start, cukup untuk skala proyek ini.

## 7. Keterbatasan
- Tidak ada refund otomatis, hanya dicatat.
- Kuota dihitung dengan SUM per request; untuk jutaan pesanan perlu counter atau cache.
