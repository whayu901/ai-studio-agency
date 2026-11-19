import fs from "node:fs";
import path from "node:path";
import { AppError, badRequest, conflict } from "./errors";
import { readJsonFile, repoPath, safeFileName, saveUpload, writeJsonFile } from "./files";
import { productionRel } from "./jobs";
import { briefToCampaign, campaignToBrief } from "./pipeline/brief";
import { loadCharacters, type Json } from "./pipeline/context";
import { validateBrief, validateProduction } from "./python";
import { addBriefRevision, findCampaign, findJob, getJob, insertJob, listJobs, transition, upsertCampaign, type Campaign } from "./repo";
import { CampaignDraft, CampaignInput, ID_RE, zodMessage } from "./schemas";
import type { Actor, JobState } from "./states";

export function slugify(name: string): string {
  return name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50) || "campaign";
}

function freeCampaignId(base: string): string {
  let id = base.length >= 2 ? base : `${base}-c`;
  for (let i = 2; findCampaign(id) || fs.existsSync(repoPath(`briefs/${id}`)); i++) id = `${base}-${i}`;
  return id;
}

/**
 * Save a campaign. Incomplete data is kept as a draft. Complete data is mapped to a brief
 * (briefs/<id>/brief.json) and checked by the Python validator; invalid briefs are not written.
 */
export async function saveCampaign(id: string | null, data: Json, actor: Actor): Promise<{ campaign: Campaign; complete: boolean; issues: { path: string; message: string }[]; report: Json | null }> {
  const draft = CampaignDraft.safeParse(data);
  if (!draft.success) throw new AppError(400, "validation", zodMessage(draft.error).message, zodMessage(draft.error).issues);
  const campaignId = id ?? freeCampaignId(slugify(String(data.name)));
  if (!ID_RE.test(campaignId)) throw badRequest("invalid campaign id");
  // Existing jobs keep their own brief snapshot and character; campaign edits only affect new jobs.
  const full = CampaignInput.safeParse(data);
  if (!full.success) {
    const c = upsertCampaign(campaignId, data, { status: "draft" });
    return { campaign: c, complete: false, issues: zodMessage(full.error).issues, report: null };
  }
  const { characters } = await loadCharacters();
  if (!characters[full.data.character_id]) {
    const c = upsertCampaign(campaignId, data, { status: "draft" });
    return { campaign: c, complete: false, issues: [{ path: "character_id", message: `character ${full.data.character_id} is not in the registry` }], report: null };
  }
  for (const img of full.data.product_images) {
    if (!fs.existsSync(repoPath(img))) return { campaign: upsertCampaign(campaignId, data, { status: "draft" }), complete: false, issues: [{ path: "product_images", message: `${img} is missing` }], report: null };
  }
  const brief = campaignToBrief(campaignId, full.data);
  const rel = `briefs/${campaignId}/brief.json`;
  const abs = repoPath(rel);
  const before = fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : null;
  writeJsonFile(abs, brief);
  const report = await validateBrief(rel);
  if (!report.valid) {
    if (before === null) fs.rmSync(path.dirname(abs), { recursive: true, force: true });
    else fs.writeFileSync(abs, before, "utf8");
    const c = upsertCampaign(campaignId, data, { status: "draft" });
    return { campaign: c, complete: false, issues: report.errors.map((m) => ({ path: "brief", message: m })), report };
  }
  const c = upsertCampaign(campaignId, full.data as unknown as Json, { status: "active", brief_path: rel });
  addBriefRevision(campaignId, null, brief, "campaign_form", actor.name ?? actor.type, report);
  return { campaign: c, complete: true, issues: [], report };
}

export async function uploadProductImage(campaignId: string, body: ReadableStream<Uint8Array> | null, filename: string) {
  if (!ID_RE.test(campaignId)) throw badRequest("invalid campaign id");
  const name = safeFileName(filename, "image");
  const rel = `assets/products/${campaignId}/${name}`;
  if (fs.existsSync(repoPath(rel))) throw conflict(`${rel} already exists; rename the file`);
  const r = await saveUpload(body, repoPath(rel), "image");
  return { path: rel, ...r };
}

export async function uploadReferenceVideo(campaignId: string, body: ReadableStream<Uint8Array> | null, filename: string) {
  if (!ID_RE.test(campaignId)) throw badRequest("invalid campaign id");
  const name = safeFileName(filename, "video");
  const rel = `assets/reference-videos/${campaignId}-${name}`;
  if (fs.existsSync(repoPath(rel))) throw conflict(`${rel} already exists; rename the file`);
  const r = await saveUpload(body, repoPath(rel), "video");
  return { path: rel, ...r };
}

const STATUS_TO_STATE: Record<string, JobState> = {
  DRAFT: "DRAFT", NEEDS_REVIEW: "DRAFT", READY_FOR_MANUAL_RENDER: "PROMPTS_READY", RENDERED_PENDING_QC: "PROMPTS_READY", APPROVED: "PROMPTS_READY", REJECTED: "DRAFT",
};

/** Productions made with the CLI (outputs/<job>/production.json) that the dashboard does not track yet. */
export function importableProductions(): { job_id: string; status: string; brief: string; character_id: string }[] {
  const dir = repoPath("outputs/.gitkeep").replace(/\.gitkeep$/, "");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && ID_RE.test(d.name) && !findJob(d.name) && fs.existsSync(path.join(dir, d.name, "production.json")))
    .map((d) => {
      const p = readJsonFile<Json>(path.join(dir, d.name, "production.json"));
      return { job_id: d.name, status: p.status, brief: p.brief, character_id: p.character_id };
    });
}

/**
 * Bring a CLI production into the dashboard. Its brief becomes a campaign; the job starts at the
 * state its file reached (at most PROMPTS_READY — earlier approvals happened outside the app and
 * are recorded as such, and render/QC history is not invented).
 */
export async function importProduction(jobId: string, actor: Actor) {
  if (findJob(jobId)) throw conflict(`job ${jobId} is already tracked`);
  const rel = productionRel(jobId);
  const p = readJsonFile<Json>(repoPath(rel));
  const rep = await validateProduction(rel);
  if (!rep.valid) throw new AppError(422, "production_invalid", "the production has validation errors", rep);
  const brief = readJsonFile<Json>(repoPath(p.brief));
  // The campaign points at the production's existing brief file, so it keeps the brief's own id.
  const campaignId: string = brief.brief_id;
  const data = briefToCampaign(brief, { character_id: p.character_id, creation_mode: p.mode, performance_mode: p.performance_mode ?? "talking_influencer", video_provider: p.video_provider ?? "google_flow" } as never);
  if (!findCampaign(campaignId)) upsertCampaign(campaignId, data, { status: "active", brief_path: p.brief });
  const state = STATUS_TO_STATE[p.status] ?? "DRAFT";
  const job = insertJob(
    {
      id: jobId, campaign_id: campaignId, character_id: p.character_id, creation_mode: p.mode, performance_mode: p.performance_mode ?? "talking_influencer",
      video_provider: p.video_provider ?? "google_flow", ai_mode: "manual", state: "DRAFT", is_test: !!brief.is_sample, production_path: rel,
      reference_manifest: p.reference_video_manifest ?? null, analysis_path: null,
    },
    { ...actor, source: "import" },
  );
  if (state !== "DRAFT") {
    // Record the path the file took, one audited step at a time, labelled as an import.
    const chain: JobState[] = ["BRIEF_READY", "BRIEF_APPROVED", "SCRIPT_READY", "SCRIPT_APPROVED", "STORYBOARD_READY", "STORYBOARD_APPROVED", "PROMPTS_READY"];
    const importer: Actor = { type: "human", name: actor.name ?? "import", source: "import" };
    for (const s of chain) {
      transition(jobId, s, importer, `imported from ${rel} (status ${p.status}); step completed outside the dashboard`);
      if (s === state) break;
    }
  }
  // Renders made outside the app are not invented here; upload them on the Render & QC tab.
  addBriefRevision(campaignId, null, brief, "import", actor.name ?? "import", { valid: true, errors: [], warnings: [] });
  return getJob(job.id);
}

export function campaignJobs(campaignId: string) {
  return listJobs().filter((j) => j.campaign_id === campaignId);
}

