import { AppError } from "@/lib/util";
import {Request, Response, NextFunction} from "express";

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  next: NextFunction
) {
  console.error(`Error processing request:`, err);
  if (err instanceof AppError) {
    res.status(err.status).json({ error: err.message, nonce: err.nonce });
  } else if (err instanceof Error) {
    res.status(500).json({ error: err.message, nonce: "00000" });
  } else {
    console.error("Unknown error type:", err);
    res.status(500).json({ error: "Unknown error", nonce: "00000" });
  }

  next();
}