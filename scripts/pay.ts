// Menandai pesanan lunas (simulasi pembayaran).
// Pakai: npm run pay -- <order_id>
export {};

const base = process.env.BASE_URL ?? "http://localhost:3000";
const orderId = process.argv[2];

if (!orderId) {
  console.error("Pakai: npm run pay -- <order_id>");
  process.exit(1);
}

fetch(`${base}/orders/${orderId}/pay`, { method: "POST" })
  .then(async (res) => {
    console.log(res.status, JSON.stringify(await res.json(), null, 2));
    process.exit(res.ok ? 0 : 1);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
