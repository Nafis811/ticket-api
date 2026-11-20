import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Test memakai database sungguhan, jadi file test dijalankan berurutan.
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 30000,
    env: {
      // Pakai database TERPISAH: test mengosongkan tabel.
      DATABASE_URL:
        process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/tickets_test",
      WEBHOOK_SECRET: "test-secret",
    },
  },
});
