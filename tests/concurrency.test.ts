import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { pool } from "../src/db";
import { makeEvent, order, remaining, resetDb, setup, teardown } from "./helpers";

beforeAll(setup);
afterAll(teardown);
beforeEach(resetDb);

describe("konkurensi", () => {
  it("200 pesanan bersamaan untuk kuota 100 berakhir tepat 100 terjual", async () => {
    const { eventId, reguler } = await makeEvent(100);

    const results = await Promise.all(Array.from({ length: 200 }, (_, i) => order(`user-${i}`, reguler, 1)));
    const ok = results.filter((r) => r.status === 201).length;
    const soldOut = results.filter((r) => r.status === 409 && r.body.error.code === "SOLD_OUT").length;

    expect(ok).toBe(100);
    expect(soldOut).toBe(100);
    expect(await remaining(eventId)).toBe(0);

    const db = await pool.query("SELECT COALESCE(SUM(quantity),0)::int AS n FROM orders WHERE status = 'PENDING'");
    expect(db.rows[0].n).toBe(100);
  });

  it("pembeli yang sama memesan bersamaan lintas tipe tidak bisa melewati batas 4", async () => {
    const { reguler, vip } = await makeEvent(50, 50);
    const calls = Array.from({ length: 12 }, (_, i) => order("budi", i % 2 ? vip : reguler, 1));
    const results = await Promise.all(calls);

    expect(results.filter((r) => r.status === 201)).toHaveLength(4);
    expect(results.filter((r) => r.body.error?.code === "LIMIT_EXCEEDED")).toHaveLength(8);
  });
});
