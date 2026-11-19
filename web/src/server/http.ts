import crypto from "node:crypto";
import { z } from "zod";
import { AppError, badRequest, forbidden } from "./errors";
import { env } from "./env";
import { log, redact } from "./log";
import { zodMessage } from "./schemas";
import type { Actor } from "./states";

type Handler<C> = (req: Request, ctx: C) => Promise<Response>;

/** Wrap a route: AppErrors become JSON with their status; anything else is logged and hidden. */
export function route<C>(fn: Handler<C>): Handler<C> {
  return async (req, ctx) => {
    try {
      return await fn(req, ctx);
    } catch (e) {
      if (e instanceof AppError) {
        return Response.json({ error: { code: e.code, message: redact(e.message), details: e.details ?? null } }, { status: e.status });
      }
      const id = crypto.randomUUID().slice(0, 8);
      log("error", "unhandled", { id, url: new URL(req.url).pathname, error: e instanceof Error ? `${e.message}\n${e.stack}` : String(e) });
      return Response.json({ error: { code: "internal", message: `Internal error (ref ${id}); see data/logs/app.log`, details: null } }, { status: 500 });
    }
  };
}

export async function body<T extends z.ZodTypeAny>(req: Request, schema: T): Promise<z.infer<T>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw badRequest("request body must be JSON");
  }
  const r = schema.safeParse(raw);
  if (!r.success) {
    const m = zodMessage(r.error);
    throw new AppError(400, "validation", m.message, m.issues);
  }
  return r.data;
}

export function ok(data: unknown, status = 200) {
  return Response.json(data, { status });
}

function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

/** n8n callbacks must carry the shared token. Returns the orchestrator actor for state changes. */
export function orchestratorActor(req: Request): Actor {
  const token = env().orchestratorToken;
  if (token.length < 16) throw forbidden("ACS_ORCHESTRATOR_TOKEN is not configured (min 16 characters)");
  const got = req.headers.get("x-acs-token") ?? "";
  if (!safeEqual(got, token)) throw forbidden("invalid orchestrator token");
  const exec = req.headers.get("x-acs-execution-id");
  return { type: "orchestrator", name: "n8n", source: "n8n", executionId: exec && /^[A-Za-z0-9_-]{1,64}$/.test(exec) ? exec : null };
}

/** The dashboard is single-user and local; people identify themselves when they approve. */
export function dashboardActor(name?: string | null): Actor {
  return { type: "human", name: name?.trim() || null, source: "dashboard" };
}

export type Ctx<P extends Record<string, string>> = { params: Promise<P> };
