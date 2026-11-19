import { execFile } from "node:child_process";
import path from "node:path";
import { env } from "./env";
import { AppError } from "./errors";
import { redact } from "./log";

export interface ValidationReport {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/** Run one tools/service.py command and return its JSON. The Python tools own the business rules. */
export function service<T = Record<string, unknown>>(args: string[], timeoutMs = 120_000): Promise<T & { ok: true }> {
  const e = env();
  const script = path.join(e.repoRoot, "tools", "service.py");
  return new Promise((resolve, reject) => {
    execFile(
      e.python,
      [script, ...args],
      { cwd: e.repoRoot, timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024, env: { ...process.env, ACS_DATA_DIR: e.dataDir, PYTHONDONTWRITEBYTECODE: "1" } },
      (err, stdout, stderr) => {
        let parsed: { ok: boolean; error?: string } | null = null;
        try {
          parsed = JSON.parse(stdout.trim().split("\n").pop() ?? "");
        } catch {
          parsed = null;
        }
        if (parsed?.ok) return resolve(parsed as T & { ok: true });
        const msg = parsed?.error ?? (err ? `${err.message}\n${stderr}` : "service returned no JSON");
        reject(new AppError(422, "python_service", redact(msg).slice(0, 4000)));
      },
    );
  });
}

export async function validateProduction(rel: string, checkReady = false): Promise<ValidationReport> {
  const r = await service<{ report: ValidationReport }>(["production", rel, ...(checkReady ? ["--check-ready"] : [])]);
  return r.report;
}

export async function validateBrief(rel: string): Promise<ValidationReport> {
  const r = await service<{ report: ValidationReport }>(["brief", rel]);
  return r.report;
}

export interface ProbeInfo {
  duration_seconds: number;
  display_width: number;
  display_height: number;
  has_audio: boolean;
  sha256?: string;
  [k: string]: unknown;
}

export async function probe(rel: string): Promise<ProbeInfo> {
  const r = await service<{ info: ProbeInfo }>(["probe", rel]);
  return r.info;
}
