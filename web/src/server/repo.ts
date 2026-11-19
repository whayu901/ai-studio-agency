import { db, now, parseJson, tx } from "./db";
import { conflict, notFound, AppError } from "./errors";
import { log } from "./log";
import { canTransition, type Actor, type JobState } from "./states";

// ----------------------------------------------------------------------------- campaigns

export interface CampaignRow {
  id: string;
  name: string;
  status: string;
  creation_mode: string;
  performance_mode: string;
  video_provider: string;
  character_id: string;
  language: string;
  duration_seconds: number;
  is_test: number;
  brief_path: string | null;
  data: string;
  created_at: string;
  updated_at: string;
}

export interface Campaign extends Omit<CampaignRow, "data" | "is_test"> {
  is_test: boolean;
  data: Record<string, unknown>;
}

function toCampaign(r: CampaignRow): Campaign {
  return { ...r, is_test: !!r.is_test, data: parseJson(r.data, {}) };
}

export function listCampaigns(): Campaign[] {
  return (db().prepare("SELECT * FROM campaigns ORDER BY updated_at DESC").all() as unknown as CampaignRow[]).map(toCampaign);
}

export function getCampaign(id: string): Campaign {
  const r = db().prepare("SELECT * FROM campaigns WHERE id = ?").get(id) as unknown as CampaignRow | undefined;
  if (!r) throw notFound(`campaign ${id} not found`);
  return toCampaign(r);
}

export function findCampaign(id: string): Campaign | null {
  const r = db().prepare("SELECT * FROM campaigns WHERE id = ?").get(id) as unknown as CampaignRow | undefined;
  return r ? toCampaign(r) : null;
}

export function upsertCampaign(id: string, data: Record<string, unknown>, fields: Partial<CampaignRow>) {
  const t = now();
  const existing = findCampaign(id);
  const d = data as Record<string, unknown>;
  const row = {
    name: String(d.name ?? existing?.name ?? id),
    status: fields.status ?? existing?.status ?? "draft",
    creation_mode: String(d.creation_mode ?? existing?.creation_mode ?? "original"),
    performance_mode: String(d.performance_mode ?? existing?.performance_mode ?? "talking_influencer"),
    video_provider: String(d.video_provider ?? existing?.video_provider ?? "google_flow"),
    character_id: String(d.character_id ?? existing?.character_id ?? ""),
    language: String(d.language ?? existing?.language ?? "id"),
    duration_seconds: Number(d.duration_seconds ?? existing?.duration_seconds ?? 8),
    is_test: d.is_test ? 1 : 0,
    brief_path: fields.brief_path ?? existing?.brief_path ?? null,
  };
  if (existing) {
    db()
      .prepare(
        `UPDATE campaigns SET name=?, status=?, creation_mode=?, performance_mode=?, video_provider=?, character_id=?, language=?,
         duration_seconds=?, is_test=?, brief_path=?, data=?, updated_at=? WHERE id=?`,
      )
      .run(row.name, row.status, row.creation_mode, row.performance_mode, row.video_provider, row.character_id, row.language,
        row.duration_seconds, row.is_test, row.brief_path, JSON.stringify(data), t, id);
  } else {
    db()
      .prepare(
        `INSERT INTO campaigns (id, name, status, creation_mode, performance_mode, video_provider, character_id, language,
         duration_seconds, is_test, brief_path, data, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(id, row.name, row.status, row.creation_mode, row.performance_mode, row.video_provider, row.character_id, row.language,
        row.duration_seconds, row.is_test, row.brief_path, JSON.stringify(data), t, t);
  }
  return getCampaign(id);
}

export interface BriefRevision {
  id: number;
  campaign_id: string;
  job_id: string | null;
  revision: number;
  brief: Record<string, unknown>;
  source: string;
  author: string | null;
  valid: boolean;
  report: { errors: string[]; warnings: string[] };
  created_at: string;
}

export function addBriefRevision(campaignId: string, jobId: string | null, brief: unknown, source: string, author: string | null, report: { valid: boolean; errors: string[]; warnings: string[] }): BriefRevision {
  const next = (db().prepare("SELECT COALESCE(MAX(revision),0)+1 AS n FROM brief_revisions WHERE campaign_id=? AND job_id IS ?").get(campaignId, jobId) as { n: number }).n;
  db()
    .prepare("INSERT INTO brief_revisions (campaign_id, job_id, revision, brief, source, author, valid, report, created_at) VALUES (?,?,?,?,?,?,?,?,?)")
    .run(campaignId, jobId, next, JSON.stringify(brief), source, author, report.valid ? 1 : 0, JSON.stringify({ errors: report.errors, warnings: report.warnings }), now());
  return listBriefRevisions(campaignId, jobId)[0];
}

/** Revisions of the campaign brief (jobId null) or of one job's brief snapshot. */
export function listBriefRevisions(campaignId: string, jobId: string | null = null): BriefRevision[] {
  return (db().prepare("SELECT * FROM brief_revisions WHERE campaign_id=? AND job_id IS ? ORDER BY revision DESC").all(campaignId, jobId) as Record<string, unknown>[]).map((r) => ({
    ...(r as unknown as BriefRevision),
    brief: parseJson(r.brief, {}),
    valid: !!r.valid,
    report: parseJson(r.report, { errors: [], warnings: [] }),
  }));
}

// ----------------------------------------------------------------------------- jobs

export interface Job {
  id: string;
  campaign_id: string;
  character_id: string;
  creation_mode: "original" | "reference_guided";
  performance_mode: "talking_influencer" | "fashion_showcase" | "voiceover_showcase";
  video_provider: "google_flow" | "seedance";
  ai_mode: "mock" | "manual" | "anthropic";
  state: JobState;
  state_before_failure: JobState | null;
  is_test: boolean;
  production_path: string;
  reference_manifest: string | null;
  analysis_path: string | null;
  retry_count: number;
  last_error: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

function toJob(r: Record<string, unknown>): Job {
  return { ...(r as unknown as Job), is_test: !!r.is_test };
}

export function listJobs(): Job[] {
  return (db().prepare("SELECT * FROM jobs ORDER BY updated_at DESC").all() as Record<string, unknown>[]).map(toJob);
}

export function getJob(id: string): Job {
  const r = db().prepare("SELECT * FROM jobs WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  if (!r) throw notFound(`job ${id} not found`);
  return toJob(r);
}

export function findJob(id: string): Job | null {
  const r = db().prepare("SELECT * FROM jobs WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  return r ? toJob(r) : null;
}

export function insertJob(j: Omit<Job, "version" | "created_at" | "updated_at" | "retry_count" | "last_error" | "state_before_failure">, actor: Actor) {
  if (findJob(j.id)) throw conflict(`job ${j.id} already exists`);
  const t = now();
  tx(() => {
    db()
      .prepare(
        `INSERT INTO jobs (id, campaign_id, character_id, creation_mode, performance_mode, video_provider, ai_mode, state, is_test,
         production_path, reference_manifest, analysis_path, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(j.id, j.campaign_id, j.character_id, j.creation_mode, j.performance_mode, j.video_provider, j.ai_mode, j.state, j.is_test ? 1 : 0,
        j.production_path, j.reference_manifest, j.analysis_path, t, t);
    addEvent(j.id, null, j.state, actor, "job created");
  });
  return getJob(j.id);
}

export function updateJobFields(id: string, fields: Partial<Pick<Job, "ai_mode" | "analysis_path" | "reference_manifest" | "last_error" | "retry_count">>) {
  const keys = Object.keys(fields) as (keyof typeof fields)[];
  if (!keys.length) return getJob(id);
  db()
    .prepare(`UPDATE jobs SET ${keys.map((k) => `${k}=?`).join(", ")}, updated_at=?, version=version+1 WHERE id=?`)
    .run(...keys.map((k) => (fields[k] ?? null) as string | number | null), now(), id);
  return getJob(id);
}

export function addEvent(jobId: string, from: JobState | null, to: JobState, actor: Actor, reason: string) {
  db()
    .prepare("INSERT INTO job_events (job_id, ts, from_state, to_state, actor_type, actor_name, source, execution_id, reason) VALUES (?,?,?,?,?,?,?,?,?)")
    .run(jobId, now(), from, to, actor.type, actor.name ?? null, actor.source, actor.executionId ?? null, reason);
}

/**
 * The only way a job changes state. Validates the transition, writes the audit event and bumps
 * the version in one transaction. `expectFrom` guards against two callers racing on one job.
 */
export function transition(jobId: string, to: JobState, actor: Actor, reason: string, expectFrom?: JobState | JobState[]): Job {
  return tx(() => {
    const job = getJob(jobId);
    if (expectFrom && !(Array.isArray(expectFrom) ? expectFrom : [expectFrom]).includes(job.state)) {
      throw conflict(`job ${jobId} is ${job.state}, expected ${Array.isArray(expectFrom) ? expectFrom.join(" or ") : expectFrom}`);
    }
    const check = canTransition(job.state, to, actor, { stateBeforeFailure: job.state_before_failure });
    if (!check.ok) throw new AppError(409, "invalid_transition", check.reason ?? "invalid transition", { from: job.state, to });
    const before = to === "FAILED" ? job.state : job.state === "FAILED" ? null : job.state_before_failure;
    db()
      .prepare("UPDATE jobs SET state=?, state_before_failure=?, last_error=?, updated_at=?, version=version+1 WHERE id=?")
      .run(to, before, to === "FAILED" ? reason : job.state === "FAILED" ? null : job.last_error, now(), jobId);
    addEvent(jobId, job.state, to, actor, reason);
    log("info", "transition", { job: jobId, from: job.state, to, actor: actor.type, source: actor.source, exec: actor.executionId ?? null });
    return getJob(jobId);
  });
}

export interface JobEvent {
  id: number;
  job_id: string;
  ts: string;
  from_state: string | null;
  to_state: string;
  actor_type: string;
  actor_name: string | null;
  source: string;
  execution_id: string | null;
  reason: string | null;
}

export function listEvents(jobId?: string, limit = 200): JobEvent[] {
  if (jobId) return db().prepare("SELECT * FROM job_events WHERE job_id=? ORDER BY id DESC LIMIT ?").all(jobId, limit) as unknown as JobEvent[];
  return db().prepare("SELECT * FROM job_events ORDER BY id DESC LIMIT ?").all(limit) as unknown as JobEvent[];
}

// ----------------------------------------------------------------------------- approvals

export function recordApproval(jobId: string, gate: string, decision: string, reviewer: string, notes: string, sha: string | null) {
  db().prepare("INSERT INTO approvals (job_id, gate, decision, reviewer, notes, artifact_sha256, ts) VALUES (?,?,?,?,?,?,?)").run(jobId, gate, decision, reviewer, notes, sha, now());
}

export function listApprovals(jobId: string) {
  return db().prepare("SELECT * FROM approvals WHERE job_id=? ORDER BY id DESC").all(jobId) as Record<string, unknown>[];
}

// ----------------------------------------------------------------------------- renders

export interface Render {
  id: number;
  job_id: string;
  clip_id: string;
  attempt: number;
  path: string;
  provider: string;
  original_name: string | null;
  bytes: number;
  sha256: string;
  probe: Record<string, unknown> | null;
  contact_sheet: string | null;
  first_frame: string | null;
  credits: number | null;
  est_cost: number | null;
  currency: string | null;
  is_test_media: boolean;
  status: "uploaded" | "attached" | "selected" | "rejected";
  uploaded_at: string;
}

function toRender(r: Record<string, unknown>): Render {
  return { ...(r as unknown as Render), probe: parseJson(r.probe, null), is_test_media: !!r.is_test_media };
}

export function listRenders(jobId: string): Render[] {
  return (db().prepare("SELECT * FROM renders WHERE job_id=? ORDER BY clip_id, attempt").all(jobId) as Record<string, unknown>[]).map(toRender);
}

export function getRender(jobId: string, id: number): Render {
  const r = db().prepare("SELECT * FROM renders WHERE job_id=? AND id=?").get(jobId, id) as Record<string, unknown> | undefined;
  if (!r) throw notFound(`render ${id} not found for job ${jobId}`);
  return toRender(r);
}

export function nextAttempt(jobId: string, clipId: string): number {
  return (db().prepare("SELECT COALESCE(MAX(attempt),0)+1 AS n FROM renders WHERE job_id=? AND clip_id=?").get(jobId, clipId) as { n: number }).n;
}

export function insertRender(r: Omit<Render, "id" | "probe" | "contact_sheet" | "first_frame" | "status" | "uploaded_at">): Render {
  const res = db()
    .prepare(
      `INSERT INTO renders (job_id, clip_id, attempt, path, provider, original_name, bytes, sha256, credits, est_cost, currency, is_test_media, status, uploaded_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'uploaded',?)`,
    )
    .run(r.job_id, r.clip_id, r.attempt, r.path, r.provider, r.original_name, r.bytes, r.sha256, r.credits, r.est_cost, r.currency, r.is_test_media ? 1 : 0, now());
  return getRender(r.job_id, Number(res.lastInsertRowid));
}

export function updateRender(jobId: string, id: number, f: Partial<Pick<Render, "probe" | "contact_sheet" | "first_frame" | "status">>) {
  const sets: string[] = [];
  const vals: (string | null)[] = [];
  for (const [k, v] of Object.entries(f)) {
    sets.push(`${k}=?`);
    vals.push(k === "probe" ? JSON.stringify(v) : (v as string | null));
  }
  if (sets.length) db().prepare(`UPDATE renders SET ${sets.join(", ")} WHERE job_id=? AND id=?`).run(...vals, jobId, id);
  return getRender(jobId, id);
}

// ----------------------------------------------------------------------------- QC reviews

export interface QcReview {
  id: number;
  job_id: string;
  render_ids: number[];
  scores: Record<string, number | "na" | null>;
  defects: { check_id: string; start_seconds: number; end_seconds: number; note: string }[];
  comments: string;
  overall: number | null;
  passed: boolean;
  decision: string;
  reviewer: string | null;
  ts: string;
}

export function insertReview(r: Omit<QcReview, "id" | "ts">): QcReview {
  const res = db()
    .prepare("INSERT INTO qc_reviews (job_id, render_ids, scores, defects, comments, overall, passed, decision, reviewer, ts) VALUES (?,?,?,?,?,?,?,?,?,?)")
    .run(r.job_id, JSON.stringify(r.render_ids), JSON.stringify(r.scores), JSON.stringify(r.defects), r.comments, r.overall, r.passed ? 1 : 0, r.decision, r.reviewer, now());
  return listReviews(r.job_id).find((x) => x.id === Number(res.lastInsertRowid))!;
}

export function listReviews(jobId: string): QcReview[] {
  return (db().prepare("SELECT * FROM qc_reviews WHERE job_id=? ORDER BY id DESC").all(jobId) as Record<string, unknown>[]).map((r) => ({
    ...(r as unknown as QcReview),
    render_ids: parseJson(r.render_ids, []),
    scores: parseJson(r.scores, {}),
    defects: parseJson(r.defects, []),
    passed: !!r.passed,
  }));
}

// ----------------------------------------------------------------------------- usage / costs

export function recordUsage(u: { job_id: string | null; provider: string; kind: "estimate" | "actual"; units: number | null; unit_type: string | null; amount: number | null; currency: string | null; note: string }) {
  db()
    .prepare("INSERT INTO usage (job_id, provider, kind, units, unit_type, amount, currency, note, ts) VALUES (?,?,?,?,?,?,?,?,?)")
    .run(u.job_id, u.provider, u.kind, u.units, u.unit_type, u.amount, u.currency, u.note, now());
}

export function listUsage(jobId?: string) {
  if (jobId) return db().prepare("SELECT * FROM usage WHERE job_id=? ORDER BY id DESC").all(jobId) as Record<string, unknown>[];
  return db().prepare("SELECT * FROM usage ORDER BY id DESC LIMIT 500").all() as Record<string, unknown>[];
}

export function spentUsd(provider: string): number {
  const r = db().prepare("SELECT COALESCE(SUM(amount),0) AS s FROM usage WHERE provider=? AND currency='USD'").get(provider) as { s: number };
  return r.s;
}

// ----------------------------------------------------------------------------- packages

export function insertPackage(jobId: string, dir: string, zip: string, manifest: unknown, isTest: boolean) {
  db().prepare("INSERT INTO packages (job_id, dir, zip_path, manifest, is_test, created_at) VALUES (?,?,?,?,?,?)").run(jobId, dir, zip, JSON.stringify(manifest), isTest ? 1 : 0, now());
}

export function latestPackage(jobId: string) {
  const r = db().prepare("SELECT * FROM packages WHERE job_id=? ORDER BY id DESC LIMIT 1").get(jobId) as Record<string, unknown> | undefined;
  return r ? { ...r, zip_path: String(r.zip_path), dir: String(r.dir), manifest: parseJson<Record<string, unknown>>(r.manifest, {}), is_test: !!r.is_test } : null;
}
