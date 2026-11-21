import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { pool } from "../src/db";
import { api, makeEvent, order, remaining, resetDb, setup, signedWebhook, teardown } from "./helpers";

beforeAll(setup);
afterAll(teardown);
beforeEach(resetDb);

const ticketCount = async (orderId: string) =>
  (await pool.query("SELECT count(*)::int AS n FROM tickets WHERE order_id = $1", [orderId])).rows[0].n;

describe("webhook pembayaran", () => {
  it("menolak signature yang salah", async () => {
    const r = await signedWebhook({ event_id: "e1", order_id: "x", status: "paid" }, "rahasia-salah");
    expect(r.status).toBe(401);
  });

  it("pembayaran sukses menerbitkan tiket", async () => {
    const { reguler } = await makeEvent(5);
    const o = await order("budi", reguler, 2);
    const r = await signedWebhook({ event_id: "evt-1", order_id: o.body.id, status: "paid" });
    expect(r.status).toBe(200);
    expect(r.body.outcome).toBe("PAID");
    expect(await ticketCount(o.body.id)).toBe(2);
  });

  it("idempoten: event yang sama terkirim berkali-kali (bahkan bersamaan) hanya diproses sekali", async () => {
    const { reguler } = await makeEvent(5);
    const o = await order("budi", reguler, 3);
    const body = { event_id: "evt-dup", order_id: o.body.id, status: "paid" };

    const results = await Promise.all(Array.from({ length: 8 }, () => signedWebhook(body)));
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(results.filter((r) => r.body.duplicate === false)).toHaveLength(1);
    expect(await ticketCount(o.body.id)).toBe(3);
  });

  it("event berbeda untuk pesanan yang sudah lunas tidak menerbitkan tiket lagi", async () => {
    const { reguler } = await makeEvent(5);
    const o = await order("budi", reguler, 2);
    await signedWebhook({ event_id: "evt-a", order_id: o.body.id, status: "paid" });
    const again = await signedWebhook({ event_id: "evt-b", order_id: o.body.id, status: "paid" });
    expect(again.body.outcome).toBe("ALREADY_PAID");
    expect(await ticketCount(o.body.id)).toBe(2);
  });

  it("tiba setelah pesanan kedaluwarsa: tidak ada tiket, dicatat butuh refund, kuota tidak terganggu", async () => {
    const { eventId, reguler } = await makeEvent(2);
    const o = await order("budi", reguler, 2);
    await pool.query("UPDATE orders SET expires_at = now() - interval '1 minute' WHERE id = $1", [o.body.id]);
    const other = await order("orang-lain", reguler, 2); // kuota dipakai orang lain
    expect(other.status).toBe(201);

    const r = await signedWebhook({ event_id: "evt-late", order_id: o.body.id, status: "paid" });
    expect(r.status).toBe(200);
    expect(r.body.outcome).toBe("LATE_PAYMENT_REFUND_NEEDED");
    expect(await ticketCount(o.body.id)).toBe(0);
    expect((await api("GET", `/orders/${o.body.id}`, { user: "budi" })).body.status).toBe("EXPIRED");
    expect(await remaining(eventId)).toBe(0);
  });

  it("order tidak dikenal -> 404 dan event tidak tercatat (provider boleh kirim ulang)", async () => {
    const r = await signedWebhook({ event_id: "evt-x", order_id: "00000000-0000-0000-0000-000000000000", status: "paid" });
    expect(r.status).toBe(404);
    const n = await pool.query("SELECT count(*)::int AS n FROM payment_events");
    expect(n.rows[0].n).toBe(0);
  });

  it("order_id bukan UUID -> 400, bukan 500", async () => {
    const r = await signedWebhook({ event_id: "evt-bad", order_id: "bukan-uuid", status: "paid" });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe("VALIDATION");
  });
});
