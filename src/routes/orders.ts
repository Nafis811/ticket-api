import { Router } from "express";
import { asyncHandler, requireUser, userIdOf, uuidParam } from "../http";
import { cancelOrder, createOrder, getOrder, listOrders, payOrder } from "../services/orders";

export const ordersRouter = Router();

// Simulasi pembayaran: tandai lunas. Sengaja tanpa X-User-Id (dianggap dipanggil "provider"/admin).
ordersRouter.post("/:id/pay", asyncHandler(async (req, res) => {
  res.json(await payOrder(uuidParam(req.params.id, "id pesanan")));
}));

ordersRouter.use(requireUser);

ordersRouter.post("/", asyncHandler(async (req, res) => {
  const ticketTypeId = uuidParam(req.body?.ticket_type_id, "ticket_type_id");
  res.status(201).json(await createOrder(userIdOf(req), ticketTypeId, req.body?.quantity));
}));

ordersRouter.get("/", asyncHandler(async (req, res) => {
  res.json(await listOrders(userIdOf(req)));
}));

ordersRouter.get("/:id", asyncHandler(async (req, res) => {
  res.json(await getOrder(userIdOf(req), uuidParam(req.params.id, "id pesanan")));
}));

ordersRouter.post("/:id/cancel", asyncHandler(async (req, res) => {
  res.json(await cancelOrder(userIdOf(req), uuidParam(req.params.id, "id pesanan")));
}));
