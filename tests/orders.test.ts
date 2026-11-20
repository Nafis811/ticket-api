import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { pool } from "../src/db";
import { expireOrders } from "../src/services/expiry";
import { api, makeEvent, order, remaining, resetDb, setup, teardown } from "./helpers";

beforeAll(setup);
afterAll(teardown);
beforeEach(resetDb);

describe("alur pesan sampai tiket", () => {
  it("pesan -> menunggu bayar -> bayar -> tiket terbit dengan kode unik", async () => {
    const { eventId, reguler } = await makeEvent(10);

    const created = await order("budi", reguler, 3);
    expect(created.status).toBe(201);
    expect(created.body.status).toBe("PENDING");
    expect(created.body.total_price).toBe(300000);
    expect(created.body.tickets).toHaveLength(0);
    expect(await remaining(eventId)).toBe(7); // kuota langsung ditahan

    const paid = await api("POST", `/orders/${created.body.id}/pay`);
    expect(paid.status).toBe(200);
    expect(paid.body.status).toBe("PAID");
    expect(paid.body.tickets).toHaveLength(3);
    expect(new Set(paid.body.tickets.map((t: any) => t.code)).size).toBe(3);

    const history = await api("GET", "/orders", { user: "budi" });
    expect(history.body).toHaveLength(1);
    expect(history.body[0].tickets).toHaveLength(3);
    expect((await api("GET", "/orders", { user: "orang-lain" })).body).toHaveLength(0);
  });

  it("membayar dua kali tidak menerbitkan tiket dua kali", async () => {
    const { reguler } = await makeEvent(10);
    const o = await order("budi", reguler, 2);

    const first = await api("POST", `/orders/${o.body.id}/pay`);
    const second = await api("POST", `/orders/${o.body.id}/pay`);
    expect(second.status).toBe(200);
    expect(second.body.tickets.map((t: any) => t.code)).toEqual(first.body.tickets.map((t: any) => t.code));

    const count = await pool.query("SELECT count(*)::int AS n FROM tickets WHERE order_id = $1", [o.body.id]);
    expect(count.rows[0].n).toBe(2);
  });

  it("pembayaran bersamaan untuk satu pesanan tetap hanya menerbitkan tiket sekali", async () => {
    const { reguler } = await makeEvent(10);
    const o = await order("budi", reguler, 4);

    const results = await Promise.all(Array.from({ length: 10 }, () => api("POST", `/orders/${o.body.id}/pay`)));
    expect(results.every((r) => r.status === 200)).toBe(true);

    const count = await pool.query("SELECT count(*)::int AS n FROM tickets WHERE order_id = $1", [o.body.id]);
    expect(count.rows[0].n).toBe(4);
  });
});

describe("kuota habis", () => {
  it("menolak pesanan yang melebihi sisa kuota dan tidak pernah oversell", async () => {
    const { eventId, reguler } = await makeEvent(3);

    expect((await order("a", reguler, 2)).status).toBe(201);
    const rejected = await order("b", reguler, 2);
    expect(rejected.status).toBe(409);
    expect(rejected.body.error.code).toBe("SOLD_OUT");
    expect(await remaining(eventId)).toBe(1);

    expect((await order("b", reguler, 1)).status).toBe(201);
    expect(await remaining(eventId)).toBe(0);
    expect((await order("c", reguler, 1)).body.error.code).toBe("SOLD_OUT");
  });

  it("kuota Reguler dan VIP terpisah", async () => {
    const { eventId, reguler, vip } = await makeEvent(1, 5);
    expect((await order("a", reguler, 1)).status).toBe(201);
    expect((await order("b", reguler, 1)).status).toBe(409);
    expect((await order("b", vip, 2)).status).toBe(201);
    expect(await remaining(eventId, "VIP")).toBe(3);
  });
});

describe("kedaluwarsa 15 menit", () => {
  it("pesanan lewat batas waktu mengembalikan kuota, tidak bisa dibayar, dan ditandai EXPIRED", async () => {
    const { eventId, reguler } = await makeEvent(2);
    const o = await order("budi", reguler, 2);
    expect(await remaining(eventId)).toBe(0);

    // Majukan waktu: anggap 15 menit sudah lewat.
    await pool.query("UPDATE orders SET expires_at = now() - interval '1 second' WHERE id = $1", [o.body.id]);

    // Kuota kembali SEBELUM worker jalan (bukti kebenaran tidak bergantung pada worker).
    expect(await remaining(eventId)).toBe(2);

    const pay = await api("POST", `/orders/${o.body.id}/pay`);
    expect(pay.status).toBe(409);
    const tickets = await pool.query("SELECT count(*)::int AS n FROM tickets");
    expect(tickets.rows[0].n).toBe(0);

    expect((await order("orang-lain", reguler, 2)).status).toBe(201); // kuota benar-benar bisa dipakai lagi
  });

  it("worker mengubah status PENDING kedaluwarsa menjadi EXPIRED", async () => {
    const { reguler } = await makeEvent(5);
    const o = await order("budi", reguler, 1);
    await pool.query("UPDATE orders SET expires_at = now() - interval '1 second' WHERE id = $1", [o.body.id]);

    expect(await expireOrders()).toBe(1);
    expect((await api("GET", `/orders/${o.body.id}`, { user: "budi" })).body.status).toBe("EXPIRED");
  });

  it("pesanan baru memiliki batas waktu sekitar 15 menit", async () => {
    const { reguler } = await makeEvent(5);
    const o = await order("budi", reguler, 1);
    const ms = new Date(o.body.expires_at).getTime() - Date.now();
    expect(ms).toBeGreaterThan(14 * 60 * 1000);
    expect(ms).toBeLessThanOrEqual(15 * 60 * 1000);
  });
});

describe("batas 4 tiket per pembeli per event", () => {
  it("dihitung dari semua pesanan aktif atau lunas, lintas tipe tiket", async () => {
    const { reguler, vip } = await makeEvent(20, 20);
    expect((await order("budi", reguler, 3)).status).toBe(201);
    const over = await order("budi", vip, 2);
    expect(over.status).toBe(409);
    expect(over.body.error.code).toBe("LIMIT_EXCEEDED");
    expect((await order("budi", vip, 1)).status).toBe(201); // pas 4
  });

  it("pesanan kedaluwarsa atau dibatalkan tidak dihitung", async () => {
    const { reguler } = await makeEvent(20);
    const a = await order("budi", reguler, 4);
    expect((await order("budi", reguler, 1)).status).toBe(409);
    await api("POST", `/orders/${a.body.id}/cancel`, { user: "budi" });
    expect((await order("budi", reguler, 4)).status).toBe(201);
  });

  it("menolak quantity di luar 1-4", async () => {
    const { reguler } = await makeEvent(20);
    for (const q of [0, 5, -1, 1.5, "2"]) {
      expect((await order("budi", reguler, q as number)).status).toBe(400);
    }
  });
});

describe("pembatalan", () => {
  it("pembeli membatalkan sebelum bayar: kuota langsung kembali", async () => {
    const { eventId, reguler } = await makeEvent(5);
    const o = await order("budi", reguler, 3);
    expect(await remaining(eventId)).toBe(2);

    const cancelled = await api("POST", `/orders/${o.body.id}/cancel`, { user: "budi" });
    expect(cancelled.body.status).toBe("CANCELLED");
    expect(await remaining(eventId)).toBe(5);
    expect((await api("POST", `/orders/${o.body.id}/pay`)).status).toBe(409);
  });

  it("tidak bisa membatalkan pesanan orang lain atau yang sudah dibayar", async () => {
    const { reguler } = await makeEvent(5);
    const o = await order("budi", reguler, 1);
    expect((await api("POST", `/orders/${o.body.id}/cancel`, { user: "orang-lain" })).status).toBe(404);
    await api("POST", `/orders/${o.body.id}/pay`);
    expect((await api("POST", `/orders/${o.body.id}/cancel`, { user: "budi" })).status).toBe(409);
  });
});
