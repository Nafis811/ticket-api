import { pool, withTx } from "../db";
import { AppError } from "../errors";

// Pesanan yang "memakan" kuota: sudah dibayar, atau menunggu bayar dan belum lewat 15 menit.
// clock_timestamp() (bukan now()) supaya waktu dibaca saat query jalan, bukan saat transaksi mulai.
export const ACTIVE_ORDER_SQL = `(o.status = 'PAID' OR (o.status = 'PENDING' AND o.expires_at > clock_timestamp()))`;

const TYPE_NAMES = ["Reguler", "VIP"];

interface TicketTypeInput {
  name: string;
  price: number;
  quota: number;
}

export async function createEvent(input: {
  name?: unknown;
  starts_at?: unknown;
  ticket_types?: unknown;
}) {
  if (typeof input.name !== "string" || !input.name.trim()) {
    throw new AppError(400, "VALIDATION", "name wajib diisi");
  }
  const types = input.ticket_types as TicketTypeInput[] | undefined;
  if (
    !Array.isArray(types) ||
    types.length !== 2 ||
    !TYPE_NAMES.every((n) => types.some((t) => t?.name === n))
  ) {
    throw new AppError(400, "VALIDATION", "ticket_types harus berisi tepat 'Reguler' dan 'VIP'");
  }
  for (const t of types) {
    if (!Number.isInteger(t.price) || t.price < 0 || !Number.isInteger(t.quota) || t.quota < 1) {
      throw new AppError(400, "VALIDATION", "price harus bilangan bulat >= 0 dan quota >= 1");
    }
  }

  const eventId = await withTx(async (c) => {
    const ev = await c.query(
      "INSERT INTO events (name, starts_at) VALUES ($1, $2) RETURNING id",
      [input.name, input.starts_at ?? null],
    );
    for (const t of types) {
      await c.query(
        "INSERT INTO ticket_types (event_id, name, price, quota) VALUES ($1, $2, $3, $4)",
        [ev.rows[0].id, t.name, t.price, t.quota],
      );
    }
    return ev.rows[0].id as string;
  });
  return getEvent(eventId);
}

const TYPES_WITH_REMAINING = `
  SELECT tt.id, tt.name, tt.price, tt.quota,
         tt.quota - COALESCE((
           SELECT SUM(o.quantity) FROM orders o
           WHERE o.ticket_type_id = tt.id AND ${ACTIVE_ORDER_SQL}
         ), 0)::int AS remaining
  FROM ticket_types tt
  WHERE tt.event_id = $1
  ORDER BY tt.price`;

export async function getEvent(id: string) {
  const ev = await pool.query("SELECT id, name, starts_at, created_at FROM events WHERE id = $1", [id]);
  if (!ev.rows[0]) throw new AppError(404, "EVENT_NOT_FOUND", "event tidak ditemukan");
  const types = await pool.query(TYPES_WITH_REMAINING, [id]);
  return { ...ev.rows[0], ticket_types: types.rows };
}

export async function listEvents() {
  const evs = await pool.query("SELECT id FROM events ORDER BY created_at DESC");
  return Promise.all(evs.rows.map((r) => getEvent(r.id)));
}
