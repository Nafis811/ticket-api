// Uji 200 pesanan bersamaan untuk kuota 100 tiket. Server harus sudah jalan.
// Pakai: npm run loadtest   (atau BASE_URL=http://host:3000 npm run loadtest)
export {};

const base = process.env.BASE_URL ?? "http://localhost:3300";
const QUOTA = 100;
const REQUESTS = 200;

async function call(method: string, path: string, body?: unknown, user?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (user) headers["X-User-Id"] = user;
  const res = await fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: (await res.json()) as any };
}

async function main() {
  const ev = await call("POST", "/events", {
    name: `Load test ${new Date().toISOString()}`,
    ticket_types: [
      { name: "Reguler", price: 100000, quota: QUOTA },
      { name: "VIP", price: 300000, quota: 10 },
    ],
  });
  const typeId = ev.body.ticket_types.find((t: any) => t.name === "Reguler").id;

  console.log(`Mengirim ${REQUESTS} permintaan bersamaan untuk kuota ${QUOTA}...`);
  const started = Date.now();
  const results = await Promise.all(
    Array.from({ length: REQUESTS }, (_, i) =>
      call("POST", "/orders", { ticket_type_id: typeId, quantity: 1 }, `loadtest-${i}`),
    ),
  );
  const ms = Date.now() - started;

  const success = results.filter((r) => r.status === 201).length;
  const soldOut = results.filter((r) => r.status === 409 && r.body.error?.code === "SOLD_OUT").length;
  const other = REQUESTS - success - soldOut;
  const after = await call("GET", `/events/${ev.body.id}`);
  const remaining = after.body.ticket_types.find((t: any) => t.name === "Reguler").remaining;

  console.log(`Selesai dalam ${ms} ms`);
  console.log(`  berhasil (201)     : ${success}`);
  console.log(`  kuota habis (409)  : ${soldOut}`);
  console.log(`  lainnya            : ${other}`);
  console.log(`  sisa kuota di API  : ${remaining}`);

  const pass = success === QUOTA && soldOut === REQUESTS - QUOTA && other === 0 && remaining === 0;
  console.log(pass ? "LULUS: tepat 100 terjual, tidak ada oversell." : "GAGAL: hasil tidak sesuai harapan.");
  process.exit(pass ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
