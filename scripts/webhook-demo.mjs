// Kirim webhook pembayaran "seperti provider sungguhan" (HMAC-SHA256 + idempoten).
//
// Pakai:
//   node scripts/webhook-demo.mjs <order_id>
//   node scripts/webhook-demo.mjs <order_id> --twice          # kirim 2x, buktikan idempoten
//   node scripts/webhook-demo.mjs <order_id> --event-id=evt-1 --secret=dev-webhook-secret
//
// Default URL: http://localhost:3300/webhooks/payment (atau BASE_URL).

import crypto from "crypto";

const args = process.argv.slice(2);
const orderId = args.find((a) => !a.startsWith("--"));
const flag = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=").slice(1).join("=") : fallback;
};

const base = process.env.BASE_URL ?? "http://localhost:3300";
const secret = flag("secret", process.env.WEBHOOK_SECRET ?? "dev-webhook-secret");
const eventId = flag("event-id", `evt-${Date.now()}`);
const twice = args.includes("--twice");

if (!orderId) {
  console.error("Pakai: node scripts/webhook-demo.mjs <order_id> [--twice] [--event-id=...] [--secret=...]");
  process.exit(1);
}

const body = JSON.stringify({ event_id: eventId, order_id: orderId, status: "paid" });
const signature = crypto.createHmac("sha256", secret).update(body).digest("hex");

async function send(label) {
  const res = await fetch(`${base}/webhooks/payment`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Signature": signature },
    body,
  });
  console.log(`${label} -> HTTP ${res.status}`, JSON.stringify(await res.json()));
}

console.log(`POST ${base}/webhooks/payment`);
console.log(`  event_id : ${eventId}`);
console.log(`  order_id : ${orderId}`);
console.log(`  signature: ${signature.slice(0, 16)}… (HMAC-SHA256)`);

await send("kirim #1");
if (twice) await send("kirim #2 (duplikat, harus 200 + duplicate:true)");