/**
 * The shared production pipeline. Every performance mode and both creation modes go through the
 * same stages; the dashboard ("direct") and n8n call exactly these functions.
 *
 * A stage is gate-aware and idempotent: called in the wrong state it returns "halted" (waiting
 * for a person) or "skipped" (already done) instead of failing, so an orchestrator can call the
 * whole chain every time and it stops at the next human decision.
 */
import fs from "node:fs";
import { AppError, badRequest, conflict, unprocessable } from "../errors";
import { readJsonFile, repoPath, writeJsonFile, writeTextFile } from "../files";
import { assertEditable, campaignInput, jobBriefRel, recordStage, saveProduction, syncProductionStatus } from "../jobs";
import { log } from "../log";
import { runAnthropic } from "../providers/ai";
import { service, validateBrief, validateProduction } from "../python";
import { getJob, transition, type Job } from "../repo";
import type { Actor, JobState } from "../states";
import { loadContext, providerModel, type Json, type JobContext } from "./context";
import { buildStagePrompt, extractJson, parseStageOutput, promptVersion, templatesFor, type AiStage } from "./manual";
import { MOCK_ENGINE_VERSION, mockCompile, mockConcepts, mockReferenceAnalysis, mockScript, mockStoryboard } from "./mock";
import { estimateSpeech } from "./speech";

export const STAGES = ["reference_analysis", "brief", "concepts", "script", "storyboard", "prompts", "await_render"] as const;
export type Stage = (typeof STAGES)[number];

export interface StageResult {
  stage: Stage;
  status: "done" | "skipped" | "halted";
  gate?: string;
  message: string;
  state: JobState;
  mode?: string;
  report?: { errors: string[]; warnings: string[] };
}

const ORDER: JobState[] = [
  "DRAFT", "BRIEF_READY", "BRIEF_APPROVED", "SCRIPT_READY", "SCRIPT_APPROVED", "STORYBOARD_READY", "STORYBOARD_APPROVED",
  "PROMPTS_READY", "AWAITING_RENDER", "RENDER_UPLOADED", "QC_PENDING", "QC_APPROVED", "DELIVERED",
];
const after = (s: JobState, ref: JobState) => ORDER.indexOf(s) > ORDER.indexOf(ref);

export const conceptsRel = (id: string) => `outputs/${id}/concepts.json`;
export const scriptNotesRel = (id: string) => `outputs/${id}/script-notes.json`;
export const imagePromptsRel = (id: string) => `outputs/${id}/image-prompts.json`;
export const renderSheetRel = (id: string) => `outputs/${id}/render-sheet.md`;
export const productionExtrasRel = (id: string) => `outputs/${id}/production-notes.json`;

function res(job: Job, stage: Stage, status: StageResult["status"], message: string, extra: Partial<StageResult> = {}): StageResult {
  return { stage, status, message, state: getJob(job.id).state, ...extra };
}

/** Which engine produces a stage's output. Deterministic steps never need AI. */
function engineFor(ctx: JobContext, stage: AiStage): "mock" | "manual" | "anthropic" {
  if (stage === "script") {
    const s = ctx.brief.script;
    if (s.mode === "custom" || ctx.job.performance_mode === "fashion_showcase") return "mock"; // verbatim copy / no dialogue
  }
  if (stage === "reference_analysis" && ctx.job.ai_mode === "anthropic") return "manual"; // needs the frames attached
  return ctx.job.ai_mode;
}

async function produce(ctx: JobContext, stage: AiStage): Promise<{ output: Json | null; mode: string; versions: Record<string, string> }> {
  const engine = engineFor(ctx, stage);
  if (engine === "manual") return { output: null, mode: "manual", versions: {} };
  if (engine === "anthropic") {
    const { text, templates } = buildStagePrompt(stage, ctx);
    const reply = await runAnthropic(text, ctx.job.id, stage);
    return { output: parseStageOutput(stage, extractJson(reply)), mode: "anthropic", versions: Object.fromEntries(templates.map((t) => [t.id, t.version])) };
  }
  return { output: mockOutput(ctx, stage), mode: "mock", versions: { "mock-engine": MOCK_ENGINE_VERSION } };
}

function mockOutput(ctx: JobContext, stage: AiStage): Json {
  const p = ctx.production;
  const model = providerModel(ctx);
  switch (stage) {
    case "reference_analysis": {
      const input = campaignInput(ctx.job.campaign_id);
      return mockReferenceAnalysis(ctx.job.id, ctx.job.reference_manifest!, ctx.manifest!, ctx.job.character_id, input.reference_video!.rights);
    }
    case "concepts":
      return { concepts: mockConcepts(ctx.brief, ctx.analysis) };
    case "script": {
      const clips = Math.max(1, Math.ceil(p.duration_seconds / model.max_clip_seconds - 1e-9));
      return mockScript(ctx.brief, ctx.job.performance_mode, p.duration_seconds, clips);
    }
    case "storyboard":
      return { storyboard: mockStoryboard(ctx.brief, ctx.character, ctx.job.performance_mode, p.script, p.duration_seconds, model).storyboard };
    case "prompts": {
      const input = campaignInput(ctx.job.campaign_id);
      return mockCompile({ jobId: ctx.job.id, brief: ctx.brief, character: ctx.character, production: p, provider: ctx.job.video_provider, model, isTest: ctx.job.is_test, productRights: input.product_image_rights });
    }
  }
}

// ----------------------------------------------------------------------------- apply outputs

async function applyOutput(ctx: JobContext, stage: AiStage, out: Json, mode: string, versions: Record<string, string>, actor: Actor, force = false): Promise<StageResult> {
  const { job } = ctx;
  const p = structuredClone(ctx.production);
  const stamp = { mode, by: actor.name ?? actor.type, source: actor.source, execution_id: actor.executionId ?? null, versions };
  switch (stage) {
    case "reference_analysis": {
      const rel = job.analysis_path!;
      writeJsonFile(repoPath(rel), out);
      const r = await service<{ report: { valid: boolean; errors: string[]; warnings: string[] } }>(["analysis", rel]);
      if (!r.report.valid) {
        fs.rmSync(repoPath(rel), { force: true });
        throw new AppError(422, "analysis_invalid", `reference analysis rejected: ${r.report.errors.join("; ")}`, r.report);
      }
      recordStage(job.id, stage, stamp);
      return res(job, stage, "done", "reference analysis saved", { mode, report: r.report });
    }
    case "concepts": {
      writeJsonFile(repoPath(conceptsRel(job.id)), { job_id: job.id, generated_by: mode, versions, concepts: out.concepts });
      recordStage(job.id, stage, stamp);
      return res(job, stage, "halted", "concepts ready — a person picks one before the script is written", { gate: "concept_selection", mode });
    }
    case "script": {
      p.script = out.script ?? "";
      p.claims_used = out.claims_used ?? [];
      Object.assign(p.prompt_versions, versions);
      const rep = await saveProduction(job, p);
      const clips = Math.max(1, Math.ceil(p.duration_seconds / providerModel(ctx).max_clip_seconds - 1e-9));
      writeJsonFile(repoPath(scriptNotesRel(job.id)), { notes: out.notes ?? [], speech: estimateSpeech(p.script, ctx.brief.script.language, p.duration_seconds, clips) });
      if (job.state === "BRIEF_APPROVED") transition(job.id, "SCRIPT_READY", actor, `script written (${mode})`, "BRIEF_APPROVED");
      recordStage(job.id, stage, stamp);
      await syncProductionStatus(job.id);
      return res(job, stage, "done", force ? "script regenerated" : "script ready for review", { mode, report: rep });
    }
    case "storyboard": {
      p.storyboard = out.storyboard;
      p.flow_prompts = [];
      p.seedance_prompts = [];
      p.continuity = [];
      Object.assign(p.prompt_versions, versions);
      const rep = await saveProduction(job, p);
      if (job.state === "SCRIPT_APPROVED") transition(job.id, "STORYBOARD_READY", actor, `storyboard written (${mode})`, "SCRIPT_APPROVED");
      recordStage(job.id, stage, stamp);
      await syncProductionStatus(job.id);
      return res(job, stage, "done", "storyboard ready for review", { mode, report: rep });
    }
    case "prompts": {
      const productAssets = p.reference_assets.filter((a: Json) => a.kind === "product_image");
      const incoming: Json[] = out.reference_assets ?? [];
      const merged = [...incoming];
      for (const a of productAssets) if (!merged.some((m) => m.path === a.path)) merged.push(a);
      // Keep a first frame the user already uploaded (its extension may differ from the plan).
      const existingFrames = p.reference_assets.filter((a: Json) => a.kind === "start_frame" && fs.existsSync(repoPath(a.path)));
      p.character_consistency = out.character_consistency;
      p.reference_assets = merged;
      p.flow_prompts = job.video_provider === "google_flow" ? out.flow_prompts ?? [] : [];
      p.seedance_prompts = job.video_provider === "seedance" ? out.seedance_prompts ?? [] : [];
      for (const f of existingFrames) {
        const clip = f.path.match(/(C\d{2,3})_first/)?.[1];
        const sp = p.seedance_prompts.find((s: Json) => s.clip_id === clip);
        if (sp && sp.first_frame !== f.path) {
          p.reference_assets = p.reference_assets.filter((a: Json) => a.path !== sp.first_frame);
          if (!p.reference_assets.some((a: Json) => a.path === f.path)) p.reference_assets.push(f);
          sp.first_frame = f.path;
        }
      }
      p.continuity = out.continuity ?? [];
      Object.assign(p.prompt_versions, versions);
      const rep = await saveProduction(job, p);
      writeJsonFile(repoPath(imagePromptsRel(job.id)), { job_id: job.id, prompts: out.image_prompts ?? [] });
      writeJsonFile(repoPath(productionExtrasRel(job.id)), { motion: out.motion ?? [], audio: out.audio ?? null });
      await writeRenderSheet(getJob(job.id));
      if (job.state === "STORYBOARD_APPROVED") transition(job.id, "PROMPTS_READY", actor, `prompts compiled (${mode})`, "STORYBOARD_APPROVED");
      recordStage(job.id, stage, stamp);
      await syncProductionStatus(job.id);
      return res(job, stage, "done", "provider prompts ready", { mode, report: rep });
    }
  }
}

export async function writeRenderSheet(job: Job) {
  if (job.video_provider === "google_flow") {
    await service(["render-sheet", job.production_path, "--output", renderSheetRel(job.id), "--allow-not-ready"]);
    return;
  }
  const p = readJsonFile<Json>(repoPath(job.production_path));
  const ready = await validateProduction(job.production_path, true);
  const imgs = fs.existsSync(repoPath(imagePromptsRel(job.id))) ? readJsonFile<Json>(repoPath(imagePromptsRel(job.id))).prompts : [];
  const lines = [
    `# Render sheet (Seedance / Dreamina, manual): ${job.id}`, "",
    "**Nothing has been rendered.** You render each clip by hand in Dreamina.", "",
    `- Character: \`${p.character_id}\` (use ONLY this character's images) · Aspect ratio **${p.aspect_ratio}** · ${p.seedance_prompts.length} clip(s)`,
    `- Performance mode: ${p.performance_mode}`, "",
  ];
  if (!ready.valid) lines.push("> **NOT READY TO RENDER.** Fix these first:", ">", ...ready.errors.map((e) => `> - ${e}`), "");
  for (const c of p.seedance_prompts) {
    const img = imgs.find((i: Json) => i.clip_id === c.clip_id);
    lines.push(
      `## ${c.clip_id} · ${c.start_seconds}–${c.end_seconds} s · ${c.model_id} · ${c.generation_mode}`, "",
      "**1. First frame** — make it with this image prompt, then upload it on the Prompts tab:", "", "```", img?.prompt ?? "(none)", "```", "",
      `**2. Upload in Dreamina:** \`${c.first_frame}\``, "", "**3. Motion prompt** (paste exactly):", "", "```", c.prompt, "```", "",
      "**Motion notes:**", "", ...c.motion.map((m: string) => `- ${m}`), "", `**Camera:** ${c.camera}`, "",
      c.avoid?.length ? `**Avoid:** ${c.avoid.join(", ")}` : "", c.dialogue ? `**Expected dialogue:** “${c.dialogue}”` : "", c.notes ? `**Notes:** ${c.notes}` : "", "",
    );
  }
  writeTextFile(repoPath(renderSheetRel(job.id)), lines.filter((l) => l !== undefined).join("\n"));
}

// ----------------------------------------------------------------------------- run a stage

export async function runStage(jobId: string, stage: Stage, actor: Actor, opts: { force?: boolean } = {}): Promise<StageResult> {
  const job = getJob(jobId);
  if (job.state === "FAILED") return res(job, stage, "halted", `job failed: ${job.last_error ?? "see history"}; retry it first`, { gate: "failed" });
  if (opts.force && actor.type !== "human") throw badRequest("only a person can request regeneration");
  try {
    return await runStageInner(job, stage, actor, !!opts.force);
  } catch (e) {
    log("warn", "stage error", { job: jobId, stage, error: e instanceof Error ? e.message : String(e) });
    // Orchestrated runs record failures on the job so they are visible and retryable.
    if (actor.type === "orchestrator" && !(e instanceof AppError && e.status < 500 && e.code === "conflict")) {
      const msg = e instanceof Error ? e.message : String(e);
      const cur = getJob(jobId);
      if (cur.state !== "FAILED" && cur.state !== "DELIVERED") transition(jobId, "FAILED", actor, `${stage} failed: ${msg}`.slice(0, 500));
    }
    throw e;
  }
}

async function runStageInner(job: Job, stage: Stage, actor: Actor, force: boolean): Promise<StageResult> {
  const s = job.state;
  switch (stage) {
    case "reference_analysis": {
      if (job.creation_mode !== "reference_guided") return res(job, stage, "skipped", "not a Reference Guided job");
      if (job.analysis_path && fs.existsSync(repoPath(job.analysis_path)) && !force) return res(job, stage, "skipped", "analysis already exists");
      await ensureReferenceManifest(job);
      const ctx = await loadContext(job.id);
      const { output, mode, versions } = await produce(ctx, "reference_analysis");
      if (!output) return res(job, stage, "halted", "export the reference-analysis prompt, attach the frames in order, and import the JSON", { gate: "manual_import", mode });
      return applyOutput(ctx, "reference_analysis", output, mode, versions, actor);
    }
    case "brief": {
      if (s === "BRIEF_READY") return res(job, stage, "halted", "waiting for a person to approve the brief", { gate: "brief_approval" });
      if (s !== "DRAFT") return res(job, stage, "skipped", "brief already approved");
      if (job.creation_mode === "reference_guided" && !(job.analysis_path && fs.existsSync(repoPath(job.analysis_path)))) {
        return res(job, stage, "halted", "the reference analysis is needed first", { gate: "reference_analysis" });
      }
      const rep = await validateBrief(jobBriefRel(job.id));
      if (!rep.valid) return res(job, stage, "halted", "the brief has errors; fix them in the Brief tab", { gate: "brief_invalid", report: rep });
      transition(job.id, "BRIEF_READY", actor, "brief validated (deterministic intake from the campaign form)", "DRAFT");
      recordStage(job.id, stage, { mode: "deterministic", by: actor.name ?? actor.type, source: actor.source, execution_id: actor.executionId ?? null, versions: {} });
      return res(job, stage, "done", "brief ready for review", { report: rep });
    }
    case "concepts": {
      if (!(s === "BRIEF_APPROVED" || (force && s === "SCRIPT_READY"))) return res(job, stage, s === "DRAFT" || s === "BRIEF_READY" ? "halted" : "skipped", "concepts are made after the brief is approved", s === "DRAFT" || s === "BRIEF_READY" ? { gate: "brief_approval" } : {});
      const ctx = await loadContext(job.id);
      const { output, mode, versions } = await produce(ctx, "concepts");
      if (!output) return res(job, stage, "halted", "export the creative-director prompt and import the concepts", { gate: "manual_import", mode });
      return applyOutput(ctx, "concepts", output, mode, versions, actor);
    }
    case "script": {
      if (s === "DRAFT" || s === "BRIEF_READY") return res(job, stage, "halted", "waiting for brief approval", { gate: "brief_approval" });
      if (s === "SCRIPT_READY" && !force) return res(job, stage, "halted", "waiting for a person to approve the script", { gate: "script_approval" });
      if (s !== "BRIEF_APPROVED" && s !== "SCRIPT_READY") return res(job, stage, "skipped", "script already approved");
      const ctx = await loadContext(job.id);
      if (!ctx.production.concept?.title) {
        if (!fs.existsSync(repoPath(conceptsRel(job.id)))) {
          const c = await runStageInner(job, "concepts", actor, false);
          if (c.gate === "manual_import") return { ...c, stage: "script" };
        }
        return res(job, stage, "halted", "pick a concept on the Script tab", { gate: "concept_selection" });
      }
      const { output, mode, versions } = await produce(ctx, "script");
      if (!output) return res(job, stage, "halted", "export the scriptwriter prompt and import the script", { gate: "manual_import", mode });
      return applyOutput(ctx, "script", output, mode, versions, actor, force);
    }
    case "storyboard": {
      if (after("SCRIPT_APPROVED", s)) return res(job, stage, "halted", "waiting for script approval", { gate: s === "SCRIPT_READY" ? "script_approval" : "brief_approval" });
      if (s === "STORYBOARD_READY" && !force) return res(job, stage, "halted", "waiting for a person to approve the storyboard", { gate: "storyboard_approval" });
      if (s !== "SCRIPT_APPROVED" && s !== "STORYBOARD_READY") return res(job, stage, "skipped", "storyboard already approved");
      const ctx = await loadContext(job.id);
      const { output, mode, versions } = await produce(ctx, "storyboard");
      if (!output) return res(job, stage, "halted", "export the storyboard prompt and import the shots", { gate: "manual_import", mode });
      return applyOutput(ctx, "storyboard", output, mode, versions, actor, force);
    }
    case "prompts": {
      if (after("STORYBOARD_APPROVED", s)) return res(job, stage, "halted", "waiting for earlier approvals", { gate: gateFor(s) });
      if ((s === "PROMPTS_READY" || s === "AWAITING_RENDER") && !force) return res(job, stage, "skipped", "prompts already compiled");
      if (!["STORYBOARD_APPROVED", "PROMPTS_READY", "AWAITING_RENDER"].includes(s)) return res(job, stage, "skipped", "rendering has started");
      if (s === "AWAITING_RENDER") throw conflict("prompts are locked while awaiting render; reopen PROMPTS_READY first");
      const ctx = await loadContext(job.id);
      const { output, mode, versions } = await produce(ctx, "prompts");
      if (!output) return res(job, stage, "halted", "export the prompt-compiler prompt and import the result", { gate: "manual_import", mode });
      return applyOutput(ctx, "prompts", output, mode, versions, actor, force);
    }
    case "await_render": {
      if (after("PROMPTS_READY", s)) return res(job, stage, "halted", "waiting for earlier approvals", { gate: gateFor(s) });
      if (s !== "PROMPTS_READY") return res(job, stage, s === "AWAITING_RENDER" ? "halted" : "skipped", s === "AWAITING_RENDER" ? "waiting for a person to render manually and upload" : "render stage passed", s === "AWAITING_RENDER" ? { gate: "manual_render" } : {});
      await writeRenderSheet(job);
      const rep = await validateProduction(job.production_path, true);
      if (!rep.valid) return res(job, stage, "halted", "not ready to render; fix the listed problems", { gate: "render_readiness", report: rep });
      transition(job.id, "AWAITING_RENDER", actor, "render sheet ready; waiting for manual render", "PROMPTS_READY");
      await syncProductionStatus(job.id);
      return res(job, stage, "halted", "ready for manual rendering — nothing has been generated", { gate: "manual_render", report: rep });
    }
  }
}

function gateFor(s: JobState): string {
  return ({ DRAFT: "brief_approval", BRIEF_READY: "brief_approval", BRIEF_APPROVED: "concept_or_script", SCRIPT_READY: "script_approval", SCRIPT_APPROVED: "storyboard", STORYBOARD_READY: "storyboard_approval" } as Record<string, string>)[s] ?? "unknown";
}

/** Run stages in order until one halts (a human decision) — what Workflow A/B does via n8n. */
export async function runUntilHalt(jobId: string, actor: Actor): Promise<StageResult[]> {
  const job = getJob(jobId);
  const order: Stage[] = [...(job.creation_mode === "reference_guided" ? (["reference_analysis"] as Stage[]) : []), "brief", "script", "storyboard", "prompts", "await_render"];
  const out: StageResult[] = [];
  for (const st of order) {
    const r = await runStage(jobId, st, actor);
    out.push(r);
    if (r.status === "halted") break;
  }
  return out;
}

async function ensureReferenceManifest(job: Job) {
  if (job.reference_manifest && fs.existsSync(repoPath(job.reference_manifest))) return;
  const input = campaignInput(job.campaign_id);
  const ref = input.reference_video;
  if (!ref) throw unprocessable("no reference video on the campaign");
  if (!fs.existsSync(repoPath(ref.path))) throw unprocessable(`reference video ${ref.path} is missing`);
  await service(["extract-frames", ref.path, "--rights", ref.rights, "--rights-note", ref.rights_note || "", "--out-dir", `outputs/${job.id}/reference`, "--interval", "1", "--max-frames", "60"], 300_000);
  const r = await service<{ report: { valid: boolean; errors: string[] } }>(["manifest", job.reference_manifest!]);
  if (!r.report.valid) throw new AppError(422, "manifest_invalid", r.report.errors.join("; "));
}

// ----------------------------------------------------------------------------- manual mode

export async function exportPrompt(jobId: string, stage: AiStage) {
  const job = getJob(jobId);
  if (stage === "reference_analysis") await ensureReferenceManifest(job);
  const ctx = await loadContext(jobId);
  const { text, templates } = buildStagePrompt(stage, ctx);
  const frames = stage === "reference_analysis" && ctx.manifest ? (ctx.manifest.frames ?? []).map((f: Json) => `outputs/${jobId}/reference/${f.path}`) : [];
  return { stage, text, templates, attach_in_order: frames };
}

const STAGE_STATE: Record<AiStage, JobState[]> = {
  reference_analysis: ["DRAFT", "BRIEF_READY"],
  concepts: ["BRIEF_APPROVED", "SCRIPT_READY"],
  script: ["BRIEF_APPROVED", "SCRIPT_READY"],
  storyboard: ["SCRIPT_APPROVED", "STORYBOARD_READY"],
  prompts: ["STORYBOARD_APPROVED", "PROMPTS_READY"],
};

/** Import Claude's JSON answer for a stage (manual mode), validate it, and continue the pipeline. */
export async function importStage(jobId: string, stage: AiStage, pasted: string, actor: Actor): Promise<StageResult> {
  const job = getJob(jobId);
  if (!STAGE_STATE[stage].includes(job.state)) throw conflict(`a ${stage} result can be imported in ${STAGE_STATE[stage].join(" / ")}; the job is ${job.state}`);
  const out = parseStageOutput(stage, extractJson(pasted));
  const ctx = await loadContext(jobId);
  if (stage === "script" && ctx.brief.script.mode === "custom" && ctx.brief.script.exact_script !== false && ctx.job.performance_mode !== "fashion_showcase") {
    // The validator enforces this too; checking here gives a clearer message.
    const norm = (t: string) => t.split(/\s+/).join(" ").trim();
    if (norm(out.script) !== norm(ctx.brief.script.custom_script)) throw unprocessable("exact-script mode: the imported script differs from the custom script");
  }
  const versions = Object.fromEntries(templatesFor(stage, job.video_provider).map((t) => [t, promptVersion(t)]));
  return applyOutput(ctx, stage, out, "manual", versions, actor, job.state !== STAGE_STATE[stage][0]);
}

// ----------------------------------------------------------------------------- human edits

export async function selectConcept(jobId: string, conceptId: string, actor: Actor) {
  const job = getJob(jobId);
  assertEditable(job, "concept");
  const abs = repoPath(conceptsRel(jobId));
  if (!fs.existsSync(abs)) throw conflict("no concepts yet; generate or import them first");
  const all: Json[] = readJsonFile<Json>(abs).concepts;
  const pick = all.find((c, i) => (c.concept_id ?? `K${String(i + 1).padStart(2, "0")}`) === conceptId);
  if (!pick) throw badRequest(`concept ${conceptId} not found`);
  const p = readJsonFile<Json>(repoPath(job.production_path));
  p.concept = {
    title: pick.title, angle: pick.angle, hook: pick.hook, key_message: pick.key_message, target_audience: pick.target_audience,
    alternatives_considered: all.filter((c) => c !== pick).map((c) => c.title),
  };
  const rep = await saveProduction(job, p);
  recordStage(jobId, "concept_selection", { mode: "human", by: actor.name ?? "dashboard", concept_id: conceptId });
  return { concept: p.concept, report: rep };
}

export async function saveScript(jobId: string, script: string, claimsUsed: string[], actor: Actor) {
  const job = getJob(jobId);
  assertEditable(job, "script");
  const p = readJsonFile<Json>(repoPath(job.production_path));
  if (!p.concept?.title) throw conflict("pick a concept first");
  p.script = script;
  p.claims_used = claimsUsed;
  const rep = await saveProduction(job, p);
  const brief = readJsonFile<Json>(repoPath(p.brief));
  const cfg = await loadContext(jobId).then((c) => providerModel(c));
  const clips = Math.max(1, Math.ceil(p.duration_seconds / cfg.max_clip_seconds - 1e-9));
  writeJsonFile(repoPath(scriptNotesRel(jobId)), { notes: ["Edited by hand in the dashboard."], speech: estimateSpeech(script, brief.script.language, p.duration_seconds, clips) });
  if (job.state === "BRIEF_APPROVED") transition(jobId, "SCRIPT_READY", actor, "script written by hand", "BRIEF_APPROVED");
  recordStage(jobId, "script", { mode: "human", by: actor.name ?? "dashboard", source: actor.source, versions: {} });
  await syncProductionStatus(jobId);
  return rep;
}

export async function saveStoryboard(jobId: string, storyboard: Json[], actor: Actor) {
  const job = getJob(jobId);
  assertEditable(job, "storyboard");
  const p = readJsonFile<Json>(repoPath(job.production_path));
  p.storyboard = storyboard;
  p.flow_prompts = [];
  p.seedance_prompts = [];
  p.continuity = [];
  const rep = await saveProduction(job, p);
  if (job.state === "SCRIPT_APPROVED") transition(jobId, "STORYBOARD_READY", actor, "storyboard written by hand", "SCRIPT_APPROVED");
  recordStage(jobId, "storyboard", { mode: "human", by: actor.name ?? "dashboard", source: actor.source, versions: {} });
  await syncProductionStatus(jobId);
  return rep;
}

/** Edit one provider prompt's text after compiling (PROMPTS_READY only). */
export async function savePromptText(jobId: string, clipId: string, prompt: string, actor: Actor) {
  const job = getJob(jobId);
  if (job.state !== "PROMPTS_READY") throw conflict("prompts can be edited in PROMPTS_READY");
  const p = readJsonFile<Json>(repoPath(job.production_path));
  const list: Json[] = job.video_provider === "seedance" ? p.seedance_prompts : p.flow_prompts;
  const c = list.find((x) => x.clip_id === clipId);
  if (!c) throw badRequest(`clip ${clipId} not found`);
  if (!prompt.trim()) throw badRequest("prompt cannot be empty");
  c.prompt = prompt;
  const rep = await saveProduction(job, p);
  await writeRenderSheet(job);
  recordStage(jobId, `prompt_edit_${clipId}`, { mode: "human", by: actor.name ?? "dashboard" });
  return rep;
}
