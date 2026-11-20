import crypto from "crypto";
import { Server } from "http";
import { AddressInfo } from "net";
import { createApp } from "../src/app";
import { migrate, pool } from "../src/db";

let server: Server;
export let baseUrl = "";

export async function setup() {
  await migrate();
  server = createApp().listen(0);
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

export async function teardown() {
  await new Promise((r) => server.close(r));
  await pool.end();
}

export async function resetDb() {
  await pool.query("TRUNCATE payment_events, tickets, orders, ticket_types, events CASCADE");
}

export async function api(method: string, path: string, opts: { user?: string; body?: unknown; headers?: Record<string, string>; raw?: string } = {}) {
  const headers: Record<string, string> = { "Content-Type": "application/json", ...opts.headers };
  if (opts.user) headers["X-User-Id"] = opts.user;
  const res = await fetch(baseUrl + path, {
    method,
    headers,
    body: opts.raw ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body)),
  });
  return { status: res.status, body: (await res.json()) as any };
}

export async function makeEvent(regulerQuota = 100, vipQuota = 10) {
  const r = await api("POST", "/events", {
    body: {
      name: "Konser Kecil",
      ticket_types: [
        { name: "Reguler", price: 100000, quota: regulerQuota },
        { name: "VIP", price: 300000, quota: vipQuota },
      ],
    },
  });
  const type = (name: string) => r.body.ticket_types.find((t: any) => t.name === name).id as string;
  return { eventId: r.body.id as string, reguler: type("Reguler"), vip: type("VIP") };
}

export const order = (user: string, ticketTypeId: string, quantity: number) =>
  api("POST", "/orders", { user, body: { ticket_type_id: ticketTypeId, quantity } });

export const remaining = async (eventId: string, name = "Reguler") =>
  (await api("GET", `/events/${eventId}`)).body.ticket_types.find((t: any) => t.name === name).remaining as number;

export function signedWebhook(body: object, secret = "test-secret") {
  const raw = JSON.stringify(body);
  const sig = crypto.createHmac("sha256", secret).update(raw).digest("hex");
  return api("POST", "/webhooks/payment", { raw, headers: { "X-Signature": sig } });
}
