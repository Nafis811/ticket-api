import { NextFunction, Request, RequestHandler, Response } from "express";
import { AppError } from "./errors";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const asyncHandler =
  (fn: (req: Request, res: Response) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res).catch(next);
  };

export function uuidParam(value: unknown, what: string): string {
  if (typeof value !== "string" || !UUID_RE.test(value)) {
    throw new AppError(400, "VALIDATION", `${what} bukan UUID yang valid`);
  }
  return value;
}

// Identifikasi pembeli seadanya lewat header X-User-Id (auth tidak dinilai).
export function requireUser(req: Request, _res: Response, next: NextFunction) {
  const id = req.header("X-User-Id")?.trim();
  if (!id || id.length > 64) {
    return next(new AppError(401, "UNAUTHENTICATED", "header X-User-Id wajib diisi (maks 64 karakter)"));
  }
  (req as any).userId = id;
  next();
}

export const userIdOf = (req: Request): string => (req as any).userId;
