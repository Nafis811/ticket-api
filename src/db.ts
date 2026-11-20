import fs from "fs";
import path from "path";
import { Pool, PoolClient } from "pg";
import { config } from "./config";

export const pool = new Pool({ connectionString: config.databaseUrl, max: 20 });

export async function migrate(): Promise<void> {
  const sql = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
  const client = await pool.connect();
  try {
    // Advisory lock supaya dua proses yang start bersamaan tidak balapan saat migrasi.
    await client.query("SELECT pg_advisory_lock(727272)");
    await client.query(sql);
  } finally {
    await client.query("SELECT pg_advisory_unlock(727272)").catch(() => undefined);
    client.release();
  }
}

export async function withTx<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
