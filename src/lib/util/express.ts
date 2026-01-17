import { Request } from "express";

export function getFullURL(req: Request, uri?: string): string {
  const protocol = req.protocol;
  const host = req.get("host");
  const originalUrl = uri ?? req.originalUrl;
  return `${protocol}://${host}${originalUrl}`;
}