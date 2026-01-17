
// Base64url helpers (URL-safe state encoding)
export function b64urlEncodeUtf8(input: string): string {
  return Buffer.from(input, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export function b64urlDecodeUtf8(input: string): string {
  const pad = "=".repeat((4 - (input.length % 4)) % 4);
  const b64 = input.replace(/-/g, "+").replace(/_/g, "/") + pad;
  return Buffer.from(b64, "base64").toString("utf8");
}