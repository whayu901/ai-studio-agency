import fs from "node:fs";
import { AppError, badRequest, conflict, forbidden, notFound, unprocessable } from "./errors";
import { readJsonFile, repoPath, sha256File, writeJsonFile } from "./files";
import { loadCharacters, readProduction, type Json } from "./pipeline/context";
import { validateBrief, validateProduction, type ValidationReport } from "./python";
import { productionQualityChecks } from "./qc";
import {
  addBriefRevision, findJob, getCampaign, getJob, insertJob, listJobs, recordApproval, transition, type Job,
} from "./repo";
import { CampaignInput, ID_RE, zodMessage } from "./schemas";
import { productionStatusFor, type Actor, type JobState } from "./states";

export const productionRel = (jobId: string) => `outputs/${jobId}/production.json`;
export const jobBriefRel = (jobId: string) => `outputs/${jobId}/brief.json`;
export const stagesRel = (jobId: string) => `outputs/${jobId}/stages.json`;

/** Parse a campaign record's form data with the full (not draft) schema. */
export function campaignInput(campaignId: string): CampaignInput {
  const c = getCampaign(campaignId);
  const r = CampaignInput.safeParse(c.data);
  if (!r.success) {
    const m = zodMessage(r.error);
    throw new AppError(422, "campaign_incomplete", `campaign is not complete: ${m.message}`, m.issues);
  }
  return r.data;
}

function nextJobId(campaignId: string): string {
  const taken = new Set(listJobs().map((j) => j.id));
  for (let i = 1; i < 1000; i++) {
    const id = `${campaignId}-${String(i).padStart(2, "0")}`.slice(0, 64);
    if (!taken.has(id) && !fs.existsSync(repoPath(productionRel(id)))) return id;
  }
  throw conflict("no free job id");
}

/**
 * Create a production job from a complete campaign: snapshot the campaign brief into the job,
 * scaffold production.json (validated by the Python rules) and start the job at DRAFT.
 */
export async function createJob(campaignId: string, aiMode: Job["ai_mode"], actor: Actor, wantedId?: string): Promise<Job> {
  const campaign = getCampaign(campaignId);
  const input = campaignInput(campaignId);
  if (!campaign.brief_path) throw unprocessable("campaign has no saved brief yet; save the campaign first");
  const brief = readJsonFile<Json>(repoPath(campaign.brief_path));
  const briefReport = await validateBrief(campaign.brief_path);
  if (!briefReport.valid) throw new AppError(422, "brief_invalid", "the campaign brief is invalid", briefReport);

  const { characters, report } = await loadCharacters();
  if (!characters[input.character_id]) {
    throw new AppError(422, "character_missing", `character ${input.character_id} is not usable (${report.errors.join("; ") || "not in the registry"}); no other character is substituted`);
  }
  if (input.creation_mode === "reference_guided" && !input.reference_video) {
    throw unprocessable("Reference Guided needs an authorized reference video on the campaign");
  }

  const jobId = wantedId ?? nextJobId(campaignId);
  if (!ID_RE.test(jobId)) throw badRequest("job id must be lowercase letters, digits and dashes");
  if (findJob(jobId) || fs.existsSync(repoPath(productionRel(jobId)))) throw conflict(`job ${jobId} already exists`);

  writeJsonFile(repoPath(jobBriefRel(jobId)), brief);
  const production = {
    schema_version: "1.0",
    job_id: jobId,
    mode: input.creation_mode,
    performance_mode: input.performance_mode,
    video_provider: input.video_provider,
    character_id: input.character_id,
    brief: jobBriefRel(jobId),
    reference_video_manifest: input.creation_mode === "reference_guided" ? `outputs/${jobId}/reference/manifest.json` : null,
    duration_seconds: input.duration_seconds,
    aspect_ratio: input.aspect_ratio,
    visual_style: input.visual_style,
    prompt_versions: {},
    concept: { title: "", angle: "", hook: "", key_message: "", target_audience: "", alternatives_considered: [] },
    script: "",
    claims_used: [],
    storyboard: [],
    character_consistency: [],
    flow_prompts: [],
    seedance_prompts: [],
    continuity: [],
    reference_assets: brief.product_images.map((p: string) => ({
      path: p, kind: "product_image", character_id: null, rights_basis: input.is_test ? "internal_test_only" : input.product_image_rights,
    })),
    quality_checks: productionQualityChecks(input.performance_mode, input.is_test),
    status: "DRAFT",
    human_review: { required: true, reviewer: null, approved_on: null, notes: input.is_test ? "TEST JOB: fixture data, not for commercial delivery." : "" },
  };
  const prodAbs = repoPath(productionRel(jobId));
  writeJsonFile(prodAbs, production);
  const rep = await validateProduction(productionRel(jobId));
  if (!rep.valid) {
    fs.rmSync(prodAbs, { force: true });
    throw new AppError(422, "scaffold_invalid", "the new production failed validation", rep);
  }
  writeJsonFile(repoPath(stagesRel(jobId)), {});
  const job = insertJob(
    {
      id: jobId, campaign_id: campaignId, character_id: input.character_id, creation_mode: input.creation_mode,
      performance_mode: input.performance_mode, video_provider: input.video_provider, ai_mode: aiMode, state: "DRAFT",
      is_test: input.is_test, production_path: productionRel(jobId),
      reference_manifest: input.creation_mode === "reference_guided" ? `outputs/${jobId}/reference/manifest.json` : null,
      analysis_path: input.creation_mode === "reference_guided" ? `outputs/${jobId}/reference/analysis.json` : null,
    },
    actor,
  );
  addBriefRevision(campaignId, jobId, brief, "campaign_snapshot", actor.name ?? actor.type, briefReport);
  return job;
}

/**
 * Write production.json and re-validate with the Python rules. If the new content has errors the
 * previous file is restored, so the file on disk is always valid.
 */
export async function saveProduction(job: Job, production: Json, opts: { allowErrors?: boolean } = {}): Promise<ValidationReport> {
  const abs = repoPath(job.production_path);
  const before = fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : null;
  writeJsonFile(abs, production);
  const rep = await validateProduction(job.production_path);
  if (!rep.valid && !opts.allowErrors) {
    if (before !== null) fs.writeFileSync(abs, before, "utf8");
    throw new AppError(422, "production_invalid", `the change was not saved: ${rep.errors.slice(0, 5).join("; ")}`, rep);
  }
  return rep;
}

/** Keep production.status in line with the job state (the Python tools read it). */
export async function syncProductionStatus(jobId: string, humanApprovedRealJob = false): Promise<void> {
  const job = getJob(jobId);
  const p = readProduction(job);
  let renderReady = false;
  if (job.state === "PROMPTS_READY" || job.state === "AWAITING_RENDER") {
    renderReady = (await validateProduction(job.production_path, true)).valid;
  }
  const status = productionStatusFor(job.state, { renderReady, humanApprovedRealJob: humanApprovedRealJob || p.status === "APPROVED" });
  if (p.status !== status) {
    p.status = status;
    await saveProduction(job, p, { allowErrors: true });
  }
}

export function recordStage(jobId: string, stage: string, info: Json) {
  const abs = repoPath(stagesRel(jobId));
  const cur = fs.existsSync(abs) ? readJsonFile<Json>(abs) : {};
  cur[stage] = { ...info, at: new Date().toISOString() };
  writeJsonFile(abs, cur);
}

export function stageInfo(jobId: string): Json {
  const abs = repoPath(stagesRel(jobId));
  return fs.existsSync(abs) ? readJsonFile<Json>(abs) : {};
}

// ----------------------------------------------------------------------------- human gates

export const GATES = {
  brief: { from: "BRIEF_READY", to: "BRIEF_APPROVED" },
  script: { from: "SCRIPT_READY", to: "SCRIPT_APPROVED" },
  storyboard: { from: "STORYBOARD_READY", to: "STORYBOARD_APPROVED" },
} as const;
export type Gate = keyof typeof GATES;

/**
 * Approve the brief, script or storyboard. Needs a named human who types the job id to confirm,
 * the same safeguard tools/approve.py uses. Automated actors are refused by the state machine.
 */
export async function approveGate(jobId: string, gate: Gate, actor: Actor, confirmJobId: string, notes: string): Promise<Job> {
  if (actor.type !== "human" || !actor.name?.trim()) throw forbidden("approvals need a named human reviewer");
  if (confirmJobId.trim() !== jobId) throw badRequest("the typed job id does not match; nothing was approved");
  const job = getJob(jobId);
  const g = GATES[gate];
  if (job.state !== g.from) throw conflict(`the ${gate} can be approved only in ${g.from} (job is ${job.state})`);
  const prod = readProduction(job);
  let artifact: string;
  if (gate === "brief") {
    const rep = await validateBrief(jobBriefRel(jobId));
    if (!rep.valid) throw new AppError(422, "brief_invalid", "fix the brief errors before approving", rep);
    artifact = sha256File(repoPath(jobBriefRel(jobId)));
  } else {
    const rep = await validateProduction(job.production_path);
    if (!rep.valid) throw new AppError(422, "production_invalid", `fix these before approving: ${rep.errors.join("; ")}`, rep);
    if (gate === "script" && !prod.script.trim() && job.performance_mode !== "fashion_showcase") throw unprocessable("the script is empty");
    if (gate === "storyboard" && !prod.storyboard.length) throw unprocessable("the storyboard is empty");
    artifact = sha256File(repoPath(job.production_path));
  }
  const next = transition(jobId, g.to, actor, `${gate} approved by ${actor.name}${notes ? `: ${notes}` : ""}`, g.from);
  recordApproval(jobId, gate, "approved", actor.name!, notes, artifact);
  await syncProductionStatus(jobId);
  return next;
}

/** Reopen an earlier stage for edits (human only). Downstream artifacts must be redone. */
export async function reopen(jobId: string, to: JobState, actor: Actor, reason: string): Promise<Job> {
  if (actor.type !== "human") throw forbidden("only a person can reopen a stage");
  const job = transition(jobId, to, actor, `reopened: ${reason || "no reason given"}`);
  await syncProductionStatus(jobId);
  return job;
}

// ----------------------------------------------------------------------------- edits

const EDITABLE: Record<string, JobState[]> = {
  brief: ["DRAFT", "BRIEF_READY"],
  concept: ["BRIEF_APPROVED", "SCRIPT_READY"],
  script: ["BRIEF_APPROVED", "SCRIPT_READY"],
  storyboard: ["SCRIPT_APPROVED", "STORYBOARD_READY"],
  prompts: ["STORYBOARD_APPROVED", "PROMPTS_READY", "AWAITING_RENDER"],
};

export function assertEditable(job: Job, what: keyof typeof EDITABLE) {
  if (!EDITABLE[what].includes(job.state)) {
    throw conflict(`the ${what} can be edited in ${EDITABLE[what].join(" / ")}; the job is ${job.state}. Reopen the stage first.`);
  }
}

export async function saveJobBrief(jobId: string, brief: Json, actor: Actor): Promise<ValidationReport> {
  const job = getJob(jobId);
  assertEditable(job, "brief");
  const abs = repoPath(jobBriefRel(jobId));
  const before = fs.readFileSync(abs, "utf8");
  const prod = readProduction(job);
  if (brief.brief_id !== readJsonFile<Json>(abs).brief_id) throw badRequest("brief_id cannot change");
  if (brief.deliverable?.preferred_character_id && brief.deliverable.preferred_character_id !== job.character_id) {
    throw badRequest(`this job uses ${job.character_id}; the brief cannot switch characters (create a new job instead)`);
  }
  if (!!brief.is_sample !== job.is_test) throw badRequest("is_sample must match whether this is a test job");
  writeJsonFile(abs, brief);
  const rep = await validateBrief(jobBriefRel(jobId));
  if (!rep.valid) {
    fs.writeFileSync(abs, before, "utf8");
    throw new AppError(422, "brief_invalid", "brief not saved: " + rep.errors.join("; "), rep);
  }
  // Keep the production's product images and timing in line with the edited brief.
  const imgs: string[] = brief.product_images;
  const rights = prod.reference_assets.find((a: Json) => a.kind === "product_image")?.rights_basis ?? (job.is_test ? "internal_test_only" : "owned");
  prod.reference_assets = [
    ...prod.reference_assets.filter((a: Json) => a.kind !== "product_image"),
    ...imgs.map((p) => ({ path: p, kind: "product_image", character_id: null, rights_basis: rights })),
  ];
  prod.duration_seconds = brief.deliverable.duration_seconds;
  prod.aspect_ratio = brief.deliverable.aspect_ratio;
  prod.visual_style = brief.deliverable.visual_style;
  await saveProduction(job, prod, { allowErrors: true });
  addBriefRevision(job.campaign_id, jobId, brief, "editor", actor.name ?? actor.type, rep);
  return rep;
}

export function readJobBrief(jobId: string): Json {
  const abs = repoPath(jobBriefRel(jobId));
  if (!fs.existsSync(abs)) throw notFound("job brief missing");
  return readJsonFile<Json>(abs);
}
