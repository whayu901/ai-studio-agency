"use client";

export class ApiError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}

/** Fetch JSON from the local API. Mutations send the x-acs-client header the middleware requires. */
export async function api<T = any>(url: string, opts: { method?: string; body?: unknown; raw?: Blob | File; signal?: AbortSignal } = {}): Promise<T> {
  const method = opts.method ?? (opts.body !== undefined || opts.raw ? "POST" : "GET");
  const headers: Record<string, string> = { "x-acs-client": "dashboard" };
  let body: BodyInit | undefined;
  if (opts.raw) {
    headers["content-type"] = "application/octet-stream";
    body = opts.raw;
  } else if (opts.body !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  const r = await fetch(url, { method, headers, body, signal: opts.signal, cache: "no-store" });
  const text = await r.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* not JSON */
  }
  if (!r.ok) throw new ApiError(r.status, json?.error?.message ?? `HTTP ${r.status}`, json?.error?.details);
  return json as T;
}

export const fileUrl = (rel: string, download = false) => `/api/files?path=${encodeURIComponent(rel)}${download ? "&download=1" : ""}`;

export function fmtDate(iso?: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function useReviewerName(): [string, (v: string) => void] {
  // Remembered per browser for convenience; the person still types the job id on every approval.
  const key = "acs.reviewer";
  const get = () => {
    try {
      return localStorage.getItem(key) ?? "";
    } catch {
      return "";
    }
  };
  const set = (v: string) => {
    try {
      localStorage.setItem(key, v);
    } catch {
      /* storage unavailable */
    }
  };
  return [typeof window === "undefined" ? "" : get(), set];
}
