import { config } from "./config";
import { createApp } from "./app";
import { migrate, pool } from "./db";
import { startExpiryWorker } from "./services/expiry";

async function main() {
  await migrate();
  startExpiryWorker(config.expiryIntervalMs);
  const server = createApp().listen(config.port, () => {
    console.log(`API jalan di http://localhost:${config.port}`);
  });

  const shutdown = () => {
    server.close(() => pool.end().then(() => process.exit(0)));
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((err) => {
  console.error("gagal start:", err);
  process.exit(1);
});
