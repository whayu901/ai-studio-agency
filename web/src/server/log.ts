import fs from "node:fs";
import path from "node:path";
import { env } from "./env";

const SECRET_PATTERNS = [/sk-ant-[A-Za-z0-9_-]+/g, /(x-acs-token["']?\s*[:=]\s*["']?)[^"'\s,}]+/gi];

/** Remove anything that looks like a credential before it reaches a log line or an error response. */
export function redact(text: string): string {
  let out = text;
  const e = env();
  for (const secret of [e.orchestratorToken, e.anthropic.apiKey]) {
    if (secret && secret.length >= 8) out = out.split(secret).join("[redacted]");
  }
  for (const re of SECRET_PATTERNS) out = out.replace(re, (_m, p1) => (typeof p1 === "string" ? `${p1}[redacted]` : "[redacted]"));
  return out;
}

export function log(level: "info" | "warn" | "error", msg: string, data: Record<string, unknown> = {}) {
  const line = redact(JSON.stringify({ ts: new Date().toISOString(), level, msg, ...data }));
  try {
    const dir = env().logDir;
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, "app.log"), line + "\n");
  } catch {
    /* logging must never break a request */
  }
  if (level === "error") console.error(line);
}

export function tailLog(lines = 100): string[] {
  try {
    const text = fs.readFileSync(path.join(env().logDir, "app.log"), "utf8");
    return text.trim().split("\n").slice(-lines);
  } catch {
    return [];
  }
}
