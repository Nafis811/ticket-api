import { Router } from "express";
import { AppError } from "../errors";
import { asyncHandler } from "../http";
import { handlePaymentWebhook, verifySignature } from "../services/webhook";

export const webhooksRouter = Router();

webhooksRouter.post("/payment", asyncHandler(async (req, res) => {
  if (!verifySignature((req as any).rawBody, req.header("X-Signature"))) {
    throw new AppError(401, "BAD_SIGNATURE", "signature webhook tidak valid");
  }
  // Selalu 200 untuk event yang valid (termasuk duplikat/terlambat) supaya provider berhenti mengirim ulang.
  res.status(200).json(await handlePaymentWebhook(req.body));
}));
