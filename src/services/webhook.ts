import crypto from "crypto";
import { config } from "../config";
import { withTx } from "../db";
import { AppError } from "../errors";
import { applyPayment } from "./orders";

export function verifySignature(rawBody: Buffer | undefined, signature: string | undefined): boolean {
  if (!rawBody || !signature) return false;
  const expected = crypto.createHmac("sha256", config.webhookSecret).update(rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Menangani notifikasi pembayaran dari provider.
 * - Idempoten: id event provider disimpan (PRIMARY KEY). Pengiriman ulang tidak diproses lagi.
 * - Terlambat / setelah kedaluwarsa: tidak menerbitkan tiket, dicatat REFUND_NEEDED.
 * Semua dalam satu transaksi, jadi pencatatan event dan perubahan pesanan berhasil/batal bersama.
 */
export async function handlePaymentWebhook(body: any) {
  const { event_id: eventId, order_id: orderId, status } = body ?? {};
  if (typeof eventId !== "string" || typeof orderId !== "string" || !["paid", "failed"].includes(status)) {
    throw new AppError(400, "VALIDATION", "butuh event_id, order_id, dan status ('paid' | 'failed')");
  }
  // Tolak lebih awal: kalau tidak, string non-UUID akan gagal di kolom UUID
  // dan berakhir sebagai 500, bukan 400.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orderId)) {
    throw new AppError(400, "VALIDATION", "order_id bukan UUID yang valid");
  }
  if (eventId.length > 200) {
    throw new AppError(400, "VALIDATION", "event_id terlalu panjang");
  }

  return withTx(async (c) => {
    const claim = await c.query(
      `INSERT INTO payment_events (provider_event_id, order_id, status, outcome)
       VALUES ($1, $2, $3, 'PROCESSING') ON CONFLICT DO NOTHING RETURNING provider_event_id`,
      [eventId, orderId, status],
    );
    if (claim.rowCount === 0) {
      const prev = await c.query("SELECT outcome FROM payment_events WHERE provider_event_id = $1", [eventId]);
      return { duplicate: true, outcome: prev.rows[0].outcome };
    }

    let outcome: string;
    if (status === "failed") {
      outcome = "FAILED_NOTED"; // pesanan dibiarkan, akan kedaluwarsa sendiri atau dibayar ulang
    } else {
      const result = await applyPayment(c, orderId);
      if (!result) throw new AppError(404, "ORDER_NOT_FOUND", "pesanan tidak ditemukan"); // rollback, provider boleh coba lagi
      outcome = result.outcome === "TOO_LATE" ? "LATE_PAYMENT_REFUND_NEEDED" : result.outcome;
    }
    await c.query("UPDATE payment_events SET outcome = $2 WHERE provider_event_id = $1", [eventId, outcome]);
    return { duplicate: false, outcome };
  });
}
