// Uji 200 pesanan bersamaan untuk kuota 100 tiket.
//
// Dua cara jalan:
//   1. Dari host  : npm run loadtest            (BASE_URL default http://localhost:3300)
//   2. Dari dalam : npm run loadtest:docker     (jalan di network Docker, tanpa port proxy host)
//
// Cara 2 lebih disarankan saat demo di Windows/macOS: port-forward Docker Desktop
// membatasi lonjakan koneksi dari host dan bisa memutus sebagian socket (ECONNRESET),
// sehingga angka "lainnya" ikut naik padahal backend benar.

const base = process.env.BASE_URL ?? "http://localhost:3300";
const QUOTA = 100;
const REQUESTS = 200;
const MAX_RETRY = 3;

async function callOnce(method, path, body, user) {
  const headers = { "Content-Type": "application/json" };
  if (user) headers["X-User-Id"] = user;
  const res = await fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

// Retry hanya untuk kegagalan jaringan (bukan jawaban HTTP), lalu dilaporkan
// berapa kali terjadi. Jumlah tiket yang terjual tetap dikunci kuota di database.
async function call(method, path, body, user) {
  let lastErr;
  for (let attempt = 0; attempt <= MAX_RETRY; attempt++) {
    try {
      return { ...(await callOnce(method, path, body, user)), retries: attempt };
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 50 * (attempt + 1)));
    }
  }
  throw lastErr;
}

async function main() {
  console.log(`Target: ${base}`);
  const ev = await call("POST", "/events", {
    name: `Load test ${new Date().toISOString()}`,
    ticket_types: [
      { name: "Reguler", price: 100000, quota: QUOTA },
      { name: "VIP", price: 300000, quota: 10 },
    ],
  });
  const typeId = ev.body.ticket_types.find((t) => t.name === "Reguler").id;

  console.log(`Mengirim ${REQUESTS} permintaan bersamaan untuk kuota ${QUOTA}...`);
  const started = Date.now();
  const results = await Promise.all(
    Array.from({ length: REQUESTS }, (_, i) =>
      call("POST", "/orders", { ticket_type_id: typeId, quantity: 1 }, `loadtest-${i}`),
    ),
  );
  const ms = Date.now() - started;

  const success = results.filter((r) => r.status === 201).length;
  const soldOut = results.filter((r) => r.status === 409 && r.body?.error?.code === "SOLD_OUT").length;
  const other = REQUESTS - success - soldOut;
  const retries = results.reduce((n, r) => n + (r.retries ?? 0), 0);

  const after = await call("GET", `/events/${ev.body.id}`);
  const remaining = after.body.ticket_types.find((t) => t.name === "Reguler").remaining;

  console.log(`Selesai dalam ${ms} ms`);
  console.log(`  berhasil (201)     : ${success}`);
  console.log(`  kuota habis (409)  : ${soldOut}`);
  console.log(`  lainnya            : ${other}`);
  console.log(`  sisa kuota di API  : ${remaining}`);
  if (retries > 0) console.log(`  retry jaringan     : ${retries}`);

  const pass = success === QUOTA && soldOut === REQUESTS - QUOTA && other === 0 && remaining === 0;
  console.log(pass ? "LULUS: tepat 100 terjual, tidak ada oversell." : "GAGAL: hasil tidak sesuai harapan.");
  process.exit(pass ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});