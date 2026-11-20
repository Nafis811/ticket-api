import { Router } from "express";
import { asyncHandler, uuidParam } from "../http";
import { createEvent, getEvent, listEvents } from "../services/events";

export const eventsRouter = Router();

eventsRouter.post("/", asyncHandler(async (req, res) => {
  res.status(201).json(await createEvent(req.body ?? {}));
}));

eventsRouter.get("/", asyncHandler(async (_req, res) => {
  res.json(await listEvents());
}));

eventsRouter.get("/:id", asyncHandler(async (req, res) => {
  res.json(await getEvent(uuidParam(req.params.id, "id event")));
}));
