import { randomBytes } from "node:crypto";

export function generateToken(byteLength = 24): string {
  return randomBytes(byteLength).toString("base64url");
}

export function buildJoinUrl(
  host: string,
  port: number,
  token: string,
): string {
  return `ws://${host}:${port}/s/${token}`;
}

export function parseJoinUrl(
  url: string,
): { host: string; port: number; token: string; secure: boolean } {
  const parsed = new URL(url);
  if (parsed.protocol !== "ws:" && parsed.protocol !== "wss:") {
    throw new Error(`unsupported protocol: ${parsed.protocol} (expected ws: or wss:)`);
  }
  const match = parsed.pathname.match(/^\/s\/([A-Za-z0-9_-]+)\/?$/);
  if (!match) {
    throw new Error("invalid join URL: missing /s/<token>");
  }
  const portStr = parsed.port || (parsed.protocol === "wss:" ? "443" : "80");
  return {
    host: parsed.hostname,
    port: parseInt(portStr, 10),
    token: match[1]!,
    secure: parsed.protocol === "wss:",
  };
}
