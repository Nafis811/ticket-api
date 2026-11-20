import path from "path";
import express, { NextFunction, Request, Response } from "express";
import { AppError } from "./errors";
import { eventsRouter } from "./routes/events";
import { ordersRouter } from "./routes/orders";
import { webhooksRouter } from "./routes/webhooks";

export function createApp() {
  const app = express();
  // Simpan body mentah: dibutuhkan untuk verifikasi HMAC webhook.
  app.use(express.json({ verify: (req, _res, buf) => { (req as any).rawBody = buf; } }));

  app.use(express.static(path.join(__dirname, "../public")));
  app.get("/health", (_req, res) => { res.json({ status: "ok" }); });
  app.use("/events", eventsRouter);
  app.use("/orders", ordersRouter);
  app.use("/webhooks", webhooksRouter);

  app.use((_req, _res, next) => next(new AppError(404, "NOT_FOUND", "endpoint tidak ada")));

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof AppError) {
      return res.status(err.status).json({ error: { code: err.code, message: err.message } });
    }
    if (err?.type === "entity.parse.failed") {
      return res.status(400).json({ error: { code: "BAD_JSON", message: "body bukan JSON valid" } });
    }
    console.error(err);
    res.status(500).json({ error: { code: "INTERNAL", message: "terjadi kesalahan di server" } });
  });
  return app;
}
