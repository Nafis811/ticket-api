export const config = {
  port: Number(process.env.PORT ?? 3000),
  databaseUrl:
    process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/tickets",
  webhookSecret: process.env.WEBHOOK_SECRET ?? "dev-webhook-secret",
  orderTtlSeconds: Number(process.env.ORDER_TTL_SECONDS ?? 900),
  expiryIntervalMs: Number(process.env.EXPIRY_INTERVAL_MS ?? 30000),
};
