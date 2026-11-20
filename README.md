# Ticket API - Sistem Penjualan Tiket Kuota Terbatas

API backend penjualan tiket event dengan penanganan konkurensi tinggi, proteksi oversell, auto-expiry 15 menit, pembatasan 4 tiket per user, webhook idempoten, dan dilengkapi Web Dashboard opsional untuk presentasi demo.

Dibuat menggunakan: **Node.js, TypeScript, Express, PostgreSQL, Docker, Vitest**.

---

## 🚀 Menjalankan Sistem (Satu Perintah)

Pastikan Docker Desktop aktif, lalu jalankan:

```bash
docker compose up --build
```

Setelah container berjalan:
- **API Endpoint**: `http://localhost:3000`
- **Health Check**: `http://localhost:3000/health`
- **Web UI Showcase (Opsional untuk Demo)**: Buka browser di `http://localhost:3000`

---

## 📋 Contoh Alur Transaksi via CLI (curl)

```bash
# 1. Buat event dengan dua tipe tiket (Reguler dan VIP)
curl -s -X POST http://localhost:3000/events -H 'Content-Type: application/json' -d '{
  "name": "Konser Musik Indie 2026",
  "ticket_types": [
    {"name": "Reguler", "price": 100000, "quota": 100},
    {"name": "VIP", "price": 300000, "quota": 20}
  ]
}'

# 2. Lihat event dan sisa kuota tiap tipe
curl -s http://localhost:3000/events

# 3. Pesan 2 tiket (identitas pembeli melalui header X-User-Id)
curl -s -X POST http://localhost:3000/orders -H 'Content-Type: application/json' \
  -H 'X-User-Id: budi' -d '{"ticket_type_id": "<ID_TIPE_TIKET>", "quantity": 2}'

# 4. Tandai lunas (simulasi pembayaran) -> tiket resmi terbit
curl -s -X POST http://localhost:3000/orders/<ORDER_ID>/pay

# 5. Lihat riwayat pesanan dan kode tiket resmi yang diterbitkan
curl -s http://localhost:3000/orders -H 'X-User-Id: budi'
```

---

## 📡 Daftar Endpoint API

| Method | Endpoint | Deskripsi | Header Khusus |
|---|---|---|---|
| `GET` | `/health` | Pemeriksaan kesehatan service | - |
| `POST` | `/events` | Membuat event baru (harus berisi Reguler & VIP) | - |
| `GET` | `/events` | Melihat semua event beserta sisa kuota terkini | - |
| `GET` | `/events/:id` | Melihat detail satu event beserta sisa kuota | - |
| `POST` | `/orders` | Memesan 1-4 tiket (status `PENDING`, kuota tertahan 15 menit) | `X-User-Id` |
| `GET` | `/orders` | Melihat daftar pesanan & tiket milik pengguna | `X-User-Id` |
| `GET` | `/orders/:id` | Melihat detail pesanan & tiket spesifik | `X-User-Id` |
| `POST` | `/orders/:id/cancel` | Membatalkan pesanan sebelum bayar (kuota langsung kembali) | `X-User-Id` |
| `POST` | `/orders/:id/pay` | Simulasi pembayaran lunas (menerbitkan tiket dengan kode unik) | - |
| `POST` | `/webhooks/payment` | Webhook pembayaran provider (HMAC-SHA256, idempoten) | `X-Signature` |

---

## 💳 Cara Menandai Pesanan Lunas

Tersedia 3 cara untuk menandai pesanan lunas:

1. **Endpoint REST API**:
   ```bash
   curl -X POST http://localhost:3000/orders/<ORDER_ID>/pay
   ```
2. **Skrip CLI**:
   ```bash
   npm run pay -- <ORDER_ID>
   ```
3. **Webhook Pembayaran (Nilai Tambah / Real Provider Pattern)**:
   Kirim `POST /webhooks/payment` dengan JSON payload:
   ```json
   {
     "event_id": "evt-payment-12345",
     "order_id": "<ORDER_ID>",
     "status": "paid"
   }
   ```
   Dan sertakan header `X-Signature` yang merupakan digest `HMAC-SHA256(hex)` dari body mentah menggunakan `WEBHOOK_SECRET`. Webhook bersifat idempoten dan menangani pengiriman ulang, keterlambatan, atau pembayaran yang tiba setelah batas 15 menit (refund required).

---

## 🧪 Pengujian Otomatis (Automated Tests)

Test suite mencakup seluruh kebutuhan bisnis dan skenario ekstrem:
- Alur lengkap dari pemesanan hingga penerbitan tiket ber-kode unik
- Penolakan pesanan saat kuota habis (*no oversell*)
- Kedaluwarsa 15 menit dan pengembalian kuota otomatis
- Batas maksimal 4 tiket per pengguna per event (lintas tipe tiket)
- Pembatalan pesanan sebelum bayar
- Konkurensi tinggi & perlindungan balapan (*race conditions*)
- Verifikasi webhook: idempotensi duplikat, signature invalid, dan *late payment*

Untuk menjalankan test secara lokal:
```bash
# Nyalakan PostgreSQL test container
docker compose up db -d
docker compose exec db psql -U postgres -c "CREATE DATABASE tickets_test;"

# Jalankan test suite
npm ci
npm test
```

---

## ⚡ Nilai Tambah (Opsional)

### 1. Uji 200 Pesanan Bersamaan (High Concurrency Stress Test)
Dengan server menyala di `http://localhost:3000`, jalankan:
```bash
npm run loadtest
```
Hasil uji:
```text
Mengirim 200 permintaan bersamaan untuk kuota 100...
Selesai dalam 1391 ms
  berhasil (201)     : 100
  kuota habis (409)  : 100
  lainnya            : 0
  sisa kuota di API  : 0
LULUS: tepat 100 terjual, tidak ada oversell.
```

### 2. Webhook Pembayaran Idempoten (Real Provider Pattern)
- Kunci idempotensi unik: `provider_event_id` dicatat dalam satu transaksi ACID.
- Webhook duplikat otomatis diabaikan tanpa menerbitkan tiket ganda.
- Pembayaran terlambat yang tiba setelah 15 menit ditandai sebagai `LATE_PAYMENT_REFUND_NEEDED` untuk melindungi kuota yang sudah dilepas ke pembeli lain.
- Validasi tanda tangan kriptografis HMAC dengan `crypto.timingSafeEqual` untuk mencegah *timing attacks*.

---

## 🏗️ Pipeline CI/CD

Konfigurasi GitHub Actions ada di `.github/workflows/ci.yml`:
1. **Trigger**: Setiap `push` ke repositori.
2. **Job Test**: Menjalankan service Postgres, menjalankan `npm ci`, verifikasi tipe TypeScript (`npm run typecheck`), dan menjalankan seluruh test otomatis (`npm test`).
3. **Job Build & Push**: Jika test lulus, Docker build dijalankan dan image di-push ke GitHub Container Registry (`ghcr.io`) dengan tag SHA commit (`ghcr.io/<user>/<repo>:<commit-sha>`) serta tag `latest` untuk default branch. Image **tidak akan dibuat** bila ada test yang gagal.

---

## 📖 Analisis Arsitektur & Keputusan Desain

Rincian keputusan teknis, mekanisme locking, handling deadlock, dan pertimbangan trade-off dapat dilihat secara lengkap di [DECISIONS.md](DECISIONS.md).
