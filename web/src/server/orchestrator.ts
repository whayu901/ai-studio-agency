/**
 * n8n orchestration. The app stays the source of truth: n8n receives a versioned contract
 * (acs.job.v1) with ids only — no file paths, no secrets — and calls back the app's
 * /api/orchestrator/* endpoints, which apply the same stage functions and state machine.
 *
 * Idempotency: a submission key is `${job}:${event}:v${job.version}`. Re-submitting the same key
 * returns the earlier run instead of starting a second one. Callbacks carry
 * x-acs-idempotency-key; a repeated key returns the stored response without re-running.
 */
import { db, now, parseJson } from "./db";
import { env } from "./env";
import { AppError, conflict, notFound } from "./errors";
import { campaignInput } from "./jobs";
import { log, redact } from "./log";
import { runUntilHalt, type StageResult } from "./pipeline/stages";
import { getJob, listRenders, transition, updateJobFields, type Job } from "./repo";
import { ORCHESTRATION_CONTRACT, OrchestrationPayload } from "./schemas";
import type { Actor } from "./states";

export type OrchestratorEvent = "job.submitted" | "render.uploaded" | "job.approved";

export function workflowFor(job: Job, event: OrchestratorEvent): string {
  if (event === "render.uploaded") return "acs-production-review";
  if (event === "job.approved") return "acs-delivery";
  return job.creation_mode === "reference_guided" ? "acs-reference-guided" : "acs-original-creation";
}

export function buildPayload(job: Job, event: OrchestratorEvent): OrchestrationPayload {
  const c = campaignInput(job.campaign_id);
  const payload = {
    contract: ORCHESTRATION_CONTRACT,
    event,
    idempotency_key: `${job.id}:${event}:v${job.version}`,
    job_id: job.id,
    campaign_id: job.campaign_id,
    character_id: job.character_id,
    creation_mode: job.creation_mode,
    performance_mode: job.performance_mode,
    provider: job.video_provider,
    ai_mode: job.ai_mode,
    product: { name: c.product.name, category: c.product.category, verified_claim_count: c.verified_claims.length },
    script: { source: c.script_mode, exact: c.script_mode === "custom" && c.exact_script, language: c.language },
    reference_asset_ids: c.product_images.map((p) => p.split("/").pop()!),
    render_ids: event === "render.uploaded" ? listRenders(job.id).filter((r) => r.status === "uploaded").map((r) => r.id) : [],
    settings: { duration_seconds: c.duration_seconds, aspect_ratio: c.aspect_ratio, is_test: job.is_test },
    requested_at: now(),
  };
  return OrchestrationPayload.parse(payload);
}

export interface RunRow {
  id: number;
  job_id: string | null;
  workflow: string;
  execution_id: string | null;
  idempotency_key: string;
  status: string;
  attempts: number;
  last_error: string | null;
  request: unknown;
  response: unknown;
  created_at: string;
  updated_at: string;
}

const toRun = (r: Record<string, unknown>): RunRow => ({ ...(r as unknown as RunRow), request: parseJson(r.request, null), response: parseJson(r.response, null) });

export function listRuns(jobId?: string): RunRow[] {
  const rows = jobId
    ? db().prepare("SELECT * FROM orchestration_runs WHERE job_id=? ORDER BY id DESC").all(jobId)
    : db().prepare("SELECT * FROM orchestration_runs ORDER BY id DESC LIMIT 200").all();
  return (rows as Record<string, unknown>[]).map(toRun);
}

function runByKey(key: string): RunRow | null {
  const r = db().prepare("SELECT * FROM orchestration_runs WHERE idempotency_key=?").get(key) as Record<string, unknown> | undefined;
  return r ? toRun(r) : null;
}

function updateRun(id: number, f: Partial<Pick<RunRow, "status" | "execution_id" | "last_error">> & { response?: unknown; attempts?: number }) {
  const sets: string[] = [];
  const vals: (string | number | null)[] = [];
  for (const [k, v] of Object.entries(f)) {
    sets.push(`${k}=?`);
    vals.push(k === "response" ? JSON.stringify(v) : (v as string | number | null));
  }
  db().prepare(`UPDATE orchestration_runs SET ${sets.join(", ")}, updated_at=? WHERE id=?`).run(...vals, now(), id);
}

/** Link an n8n execution id to the run it belongs to (called on every callback). */
export function linkExecution(runKey: string | null, executionId: string | null) {
  if (!runKey || !executionId) return;
  const run = runByKey(runKey);
  if (run && !run.execution_id) updateRun(run.id, { execution_id: executionId, status: run.status === "submitted" ? "running" : run.status });
}

export async function n8nHealth(): Promise<{ reachable: boolean; status?: number; error?: string; url: string; mode: string }> {
  const e = env();
  try {
    const r = await fetch(`${e.n8nUrl}/healthz`, { signal: AbortSignal.timeout(2500) });
    return { reachable: r.ok, status: r.status, url: e.n8nUrl, mode: e.orchestrator };
  } catch (err) {
    return { reachable: false, error: err instanceof Error ? err.message : String(err), url: e.n8nUrl, mode: e.orchestrator };
  }
}

/**
 * Hand a job event to the orchestrator. In "direct" mode the same stages run in-process (labelled
 * as such). In "n8n" mode the event is POSTed to the workflow's webhook and n8n drives the stages.
 */
export async function submit(jobId: string, event: OrchestratorEvent, actor: Actor): Promise<{ mode: "n8n" | "direct"; run?: RunRow; results?: StageResult[]; duplicate?: boolean; response?: unknown }> {
  const job = getJob(jobId);
  if (job.state === "FAILED") throw conflict("the job has failed; use Retry");
  const e = env();
  if (e.orchestrator !== "n8n") {
    if (event === "job.submitted") return { mode: "direct", results: await runUntilHalt(jobId, { ...actor, source: "direct" }) };
    throw conflict(`${event} is handled directly by the dashboard in direct mode`);
  }
  if (e.orchestratorToken.length < 16) throw new AppError(503, "not_configured", "ACS_ORCHESTRATOR_TOKEN is not set; run scripts/setup-local-env.sh");
  const payload = buildPayload(job, event);
  const existing = runByKey(payload.idempotency_key);
  if (existing && existing.status !== "failed") return { mode: "n8n", run: existing, duplicate: true, response: existing.response };

  const workflow = workflowFor(job, event);
  let runId: number;
  if (existing) {
    runId = existing.id;
    updateRun(existing.id, { status: "submitted", attempts: existing.attempts + 1, last_error: null });
  } else {
    const r = db()
      .prepare("INSERT INTO orchestration_runs (job_id, workflow, idempotency_key, status, request, created_at, updated_at) VALUES (?,?,?,?,?,?,?)")
      .run(jobId, workflow, payload.idempotency_key, "submitted", JSON.stringify(payload), now(), now());
    runId = Number(r.lastInsertRowid);
  }
  try {
    const resp = await fetch(`${e.n8nUrl}/webhook/${workflow}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-acs-token": e.orchestratorToken },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(180_000),
    });
    const text = await resp.text();
    const body = parseJson<Record<string, unknown>>(text, { raw: text.slice(0, 2000) });
    const exec = typeof body.execution_id === "string" ? body.execution_id : null;
    if (!resp.ok) {
      updateRun(runId, { status: "failed", last_error: redact(`n8n HTTP ${resp.status}: ${text.slice(0, 500)}`), response: body, ...(exec ? { execution_id: exec } : {}) });
      throw new AppError(502, "n8n_error", `n8n answered ${resp.status} for ${workflow}${resp.status === 404 ? " — is the workflow imported and active?" : ""}`);
    }
    const cur = db().prepare("SELECT execution_id FROM orchestration_runs WHERE id=?").get(runId) as { execution_id: string | null };
    // n8n answers 200 with an empty body when a workflow fails before its Respond node; that is a
    // failure (the error workflow reports the details separately).
    if (!exec || typeof body.state !== "string") {
      updateRun(runId, { status: "failed", last_error: "the workflow ended without a result (see the n8n execution and job history)", response: body, execution_id: exec ?? cur.execution_id });
      throw new AppError(502, "n8n_workflow_failed", `n8n workflow ${workflow} failed${cur.execution_id ? ` (execution ${cur.execution_id})` : ""}; see the job history`);
    }
    updateRun(runId, { status: "completed", response: body, execution_id: exec ?? cur.execution_id });
    log("info", "n8n run finished", { job: jobId, workflow, exec });
    return { mode: "n8n", run: listRuns(jobId).find((r) => r.id === runId), response: body };
  } catch (err) {
    if (err instanceof AppError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    updateRun(runId, { status: "failed", last_error: redact(msg) });
    throw new AppError(502, "n8n_unreachable", `could not reach n8n at ${e.n8nUrl} (${msg}). Start it with: docker compose -f n8n/docker-compose.yml up -d`);
  }
}

/** Callback idempotency: same key → same stored response, no second run. */
export async function idempotent<T>(key: string | null, jobId: string, operation: string, fn: () => Promise<T>): Promise<T> {
  if (!key) return fn();
  if (!/^[A-Za-z0-9:_.-]{4,200}$/.test(key)) throw new AppError(400, "bad_key", "invalid idempotency key");
  const hit = db().prepare("SELECT response FROM idempotency WHERE key=?").get(key) as { response: string } | undefined;
  if (hit) return { ...(JSON.parse(hit.response) as object), duplicate: true } as T;
  const out = await fn();
  db().prepare("INSERT OR IGNORE INTO idempotency (key, job_id, operation, response, created_at) VALUES (?,?,?,?,?)").run(key, jobId, operation, JSON.stringify(out), now());
  return out;
}

/** Workflow E: n8n's Error Trigger reports a failed execution. */
export function recordWorkflowError(input: { execution_id: string | null; workflow: string; message: string; last_node: string | null }, actor: Actor) {
  const run = input.execution_id
    ? (db().prepare("SELECT * FROM orchestration_runs WHERE execution_id=?").get(input.execution_id) as Record<string, unknown> | undefined)
    : undefined;
  if (!run) {
    log("warn", "n8n error for an unknown execution (not linked to a job run)", input);
    return { linked: false };
  }
  const r = toRun(run);
  updateRun(r.id, { status: "failed", last_error: redact(`${input.last_node ?? "?"}: ${input.message}`).slice(0, 1000) });
  if (r.job_id) {
    const job = getJob(r.job_id);
    if (job.state !== "FAILED" && job.state !== "DELIVERED") {
      transition(job.id, "FAILED", { ...actor, executionId: input.execution_id }, `n8n ${input.workflow} failed at ${input.last_node ?? "?"}: ${input.message}`.slice(0, 500));
    } else {
      updateJobFields(job.id, { last_error: `n8n ${input.workflow}: ${input.message}`.slice(0, 500) });
    }
  }
  return { linked: true, job_id: r.job_id };
}

/** Safe retry: bounded, returns the job to where it failed, then resubmits (new idempotency key). */
export async function retryJob(jobId: string, actor: Actor) {
  const job = getJob(jobId);
  if (job.state !== "FAILED") throw conflict("only failed jobs can be retried");
  if (job.retry_count >= env().maxRetries) throw conflict(`retry limit reached (${env().maxRetries}); fix the cause and reopen manually`);
  if (!job.state_before_failure) throw notFound("no previous state recorded");
  updateJobFields(jobId, { retry_count: job.retry_count + 1 });
  const back = transition(jobId, job.state_before_failure, actor, `retry ${job.retry_count + 1}/${env().maxRetries}`, "FAILED");
  const event: OrchestratorEvent = ["RENDER_UPLOADED"].includes(back.state) ? "render.uploaded" : back.state === "QC_APPROVED" ? "job.approved" : "job.submitted";
  if (env().orchestrator === "n8n") return { job: back, resubmitted: await submit(jobId, event, actor) };
  return { job: back, resubmitted: null };
}
