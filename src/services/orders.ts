import { PoolClient } from "pg";
import { config } from "../config";
import { pool, withTx } from "../db";
import { AppError } from "../errors";
import { ACTIVE_ORDER_SQL } from "./events";

const MAX_PER_BUYER = 4;

export type PaymentOutcome = "PAID" | "ALREADY_PAID" | "TOO_LATE";

export async function createOrder(userId: string, ticketTypeId: string, quantity: unknown) {
  if (!Number.isInteger(quantity) || (quantity as number) < 1 || (quantity as number) > MAX_PER_BUYER) {
    throw new AppError(400, "VALIDATION", "quantity harus bilangan bulat 1-4");
  }
  const qty = quantity as number;

  return withTx(async (c) => {
    const found = await c.query("SELECT event_id FROM ticket_types WHERE id = $1", [ticketTypeId]);
    if (!found.rows[0]) throw new AppError(404, "TICKET_TYPE_NOT_FOUND", "tipe tiket tidak ditemukan");
    const eventId: string = found.rows[0].event_id;

    // Lock 1: per (pembeli, event). Menyerialkan pesanan pembeli yang sama,
    // termasuk lintas tipe tiket (Reguler + VIP), supaya batas 4 tiket tidak bisa dibobol.
    await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`${userId}:${eventId}`]);

    // Lock 2: baris tipe tiket. Menyerialkan semua pesanan untuk tipe yang sama,
    // sehingga hitungan terjual di bawah ini tidak bisa berubah sampai kita commit.
    // Urutan lock selalu sama (1 lalu 2) supaya tidak terjadi deadlock.
    const tt = await c.query(
      "SELECT id, event_id, price, quota FROM ticket_types WHERE id = $1 FOR UPDATE",
      [ticketTypeId],
    );
    const type = tt.rows[0];

    const sold = await c.query(
      `SELECT COALESCE(SUM(o.quantity), 0)::int AS n FROM orders o
       WHERE o.ticket_type_id = $1 AND ${ACTIVE_ORDER_SQL}`,
      [ticketTypeId],
    );
    if (sold.rows[0].n + qty > type.quota) {
      throw new AppError(409, "SOLD_OUT", `kuota tidak cukup, sisa ${Math.max(type.quota - sold.rows[0].n, 0)}`);
    }

    const mine = await c.query(
      `SELECT COALESCE(SUM(o.quantity), 0)::int AS n FROM orders o
       WHERE o.user_id = $1 AND o.event_id = $2 AND ${ACTIVE_ORDER_SQL}`,
      [userId, eventId],
    );
    if (mine.rows[0].n + qty > MAX_PER_BUYER) {
      throw new AppError(
        409,
        "LIMIT_EXCEEDED",
        `maksimal ${MAX_PER_BUYER} tiket per event, kamu sudah punya ${mine.rows[0].n}`,
      );
    }

    const inserted = await c.query(
      `INSERT INTO orders (user_id, event_id, ticket_type_id, quantity, total_price, status, expires_at)
       VALUES ($1, $2, $3, $4, $5, 'PENDING', clock_timestamp() + make_interval(secs => $6))
       RETURNING id`,
      [userId, eventId, ticketTypeId, qty, type.price * qty, config.orderTtlSeconds],
    );
    return fetchOrder(c, inserted.rows[0].id);
  });
}

const ORDER_SELECT = `
  SELECT o.id, o.user_id, o.event_id, o.ticket_type_id, tt.name AS ticket_type_name,
         o.quantity, o.total_price, o.status, o.expires_at, o.created_at, o.paid_at,
         COALESCE((SELECT json_agg(json_build_object('seq', t.seq, 'code', t.code) ORDER BY t.seq)
                   FROM tickets t WHERE t.order_id = o.id), '[]'::json) AS tickets
  FROM orders o JOIN ticket_types tt ON tt.id = o.ticket_type_id`;

async function fetchOrder(c: Pick<PoolClient, "query">, id: string) {
  const r = await c.query(`${ORDER_SELECT} WHERE o.id = $1`, [id]);
  return r.rows[0];
}

export async function getOrder(userId: string, orderId: string) {
  const order = await fetchOrder(pool, orderId);
  if (!order || order.user_id !== userId) throw new AppError(404, "ORDER_NOT_FOUND", "pesanan tidak ditemukan");
  return order;
}

export async function listOrders(userId: string) {
  const r = await pool.query(`${ORDER_SELECT} WHERE o.user_id = $1 ORDER BY o.created_at DESC`, [userId]);
  return r.rows;
}

export async function cancelOrder(userId: string, orderId: string) {
  const result = await withTx(async (c) => {
    const r = await c.query(
      "SELECT status, user_id, expires_at <= clock_timestamp() AS is_expired FROM orders WHERE id = $1 FOR UPDATE",
      [orderId],
    );
    const o = r.rows[0];
    if (!o || o.user_id !== userId) throw new AppError(404, "ORDER_NOT_FOUND", "pesanan tidak ditemukan");

    if (o.status === "CANCELLED") return { ok: true, order: await fetchOrder(c, orderId) }; // idempoten
    if (o.status === "PENDING" && o.is_expired) {
      await c.query("UPDATE orders SET status = 'EXPIRED' WHERE id = $1", [orderId]);
      return { ok: false, code: "ORDER_EXPIRED", message: "pesanan sudah kedaluwarsa" };
    }
    if (o.status !== "PENDING") {
      return { ok: false, code: "ORDER_NOT_CANCELLABLE", message: `pesanan berstatus ${o.status}, tidak bisa dibatalkan` };
    }
    await c.query("UPDATE orders SET status = 'CANCELLED' WHERE id = $1", [orderId]);
    return { ok: true, order: await fetchOrder(c, orderId) };
  });
  if (!result.ok) throw new AppError(409, result.code!, result.message!);
  return result.order;
}

/**
 * Inti pembayaran, dipakai endpoint simulasi DAN webhook.
 * Harus dipanggil di dalam transaksi. Baris order dikunci (FOR UPDATE), jadi dua
 * pembayaran untuk pesanan yang sama diproses bergantian, bukan bersamaan.
 */
export async function applyPayment(
  c: PoolClient,
  orderId: string,
): Promise<{ outcome: PaymentOutcome; order: any } | null> {
  const r = await c.query(
    "SELECT status, quantity, expires_at <= clock_timestamp() AS is_expired FROM orders WHERE id = $1 FOR UPDATE",
    [orderId],
  );
  const o = r.rows[0];
  if (!o) return null;

  if (o.status === "PAID") return { outcome: "ALREADY_PAID", order: await fetchOrder(c, orderId) };

  if (o.status === "PENDING" && !o.is_expired) {
    await c.query("UPDATE orders SET status = 'PAID', paid_at = clock_timestamp() WHERE id = $1", [orderId]);
    // ON CONFLICT DO NOTHING + UNIQUE (order_id, seq): sabuk pengaman kalau ada jalur lain yang lolos.
    await c.query(
      `INSERT INTO tickets (order_id, seq, code)
       SELECT $1, g, 'TKT-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12))
       FROM generate_series(1, $2::int) g
       ON CONFLICT DO NOTHING`,
      [orderId, o.quantity],
    );
    return { outcome: "PAID", order: await fetchOrder(c, orderId) };
  }

  if (o.status === "PENDING") {
    await c.query("UPDATE orders SET status = 'EXPIRED' WHERE id = $1", [orderId]);
  }
  return { outcome: "TOO_LATE", order: await fetchOrder(c, orderId) };
}

/** Endpoint simulasi pembayaran: tandai pesanan lunas. */
export async function payOrder(orderId: string) {
  const result = await withTx((c) => applyPayment(c, orderId));
  if (!result) throw new AppError(404, "ORDER_NOT_FOUND", "pesanan tidak ditemukan");
  if (result.outcome === "TOO_LATE") {
    throw new AppError(409, "ORDER_NOT_PAYABLE", `pesanan berstatus ${result.order.status}, tidak bisa dibayar`);
  }
  return result.order;
}
