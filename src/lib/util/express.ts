import { Request } from "express";
import { env } from "../env";

export function getFullURL(req: Request, uri?: string): string {
  // const protocol = req.protocol;
  // const host = req.get("host");
  const host = env.serverUrl;
  const originalUrl = uri ?? req.originalUrl;
  return `${host}${originalUrl}`;
}