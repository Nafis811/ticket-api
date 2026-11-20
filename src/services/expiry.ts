import { pool } from "../db";

/**
 * Menandai pesanan PENDING yang lewat batas waktu sebagai EXPIRED.
 * Ini hanya merapikan status. Kuota sudah kembali sendiri sejak expires_at lewat,
 * karena semua hitungan kuota mengabaikan PENDING yang kedaluwarsa.
 */
export async function expireOrders(): Promise<number> {
  const r = await pool.query(
    "UPDATE orders SET status = 'EXPIRED' WHERE status = 'PENDING' AND expires_at <= clock_timestamp()",
  );
  return r.rowCount ?? 0;
}

export function startExpiryWorker(intervalMs: number): NodeJS.Timeout {
  const timer = setInterval(() => {
    expireOrders().catch((err) => console.error("expiry worker gagal:", err));
  }, intervalMs);
  timer.unref();
  return timer;
}
