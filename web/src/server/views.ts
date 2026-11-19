/** Read models for the dashboard: everything a page needs in one response. */
import fs from "node:fs";
import { db } from "./db";
import { readJsonFile, repoPath } from "./files";
import { stageInfo } from "./jobs";
import { readProduction, type Json } from "./pipeline/context";
import { conceptsRel, imagePromptsRel, productionExtrasRel, renderSheetRel, scriptNotesRel } from "./pipeline/stages";
import { listRuns } from "./orchestrator";
import { validateProduction } from "./python";
import { applicable } from "./qc";
import {
  getCampaign, getJob, latestPackage, listApprovals, listBriefRevisions, listCampaigns, listEvents, listJobs, listRenders, listReviews, listUsage,
} from "./repo";
import { AWAITING_HUMAN, STATE_LABELS } from "./states";

const readIf = (rel: string): Json | null => (fs.existsSync(repoPath(rel)) ? readJsonFile<Json>(repoPath(rel)) : null);

export async function jobDetail(id: string) {
  const job = getJob(id);
  const production = readProduction(job);
  const [report, ready] = await Promise.all([validateProduction(job.production_path), validateProduction(job.production_path, true)]);
  const brief = readIf(production.brief);
  return {
    job: { ...job, state_label: STATE_LABELS[job.state] },
    campaign: getCampaign(job.campaign_id),
    production,
    brief,
    brief_revisions: listBriefRevisions(job.campaign_id, id),
    stages: stageInfo(id),
    concepts: readIf(conceptsRel(id)),
    script_notes: readIf(scriptNotesRel(id)),
    image_prompts: readIf(imagePromptsRel(id)),
    motion_audio: readIf(productionExtrasRel(id)),
    render_sheet: fs.existsSync(repoPath(renderSheetRel(id))) ? fs.readFileSync(repoPath(renderSheetRel(id)), "utf8") : null,
    analysis: job.analysis_path ? readIf(job.analysis_path) : null,
    manifest: job.reference_manifest ? readIf(job.reference_manifest) : null,
    renders: listRenders(id),
    reviews: listReviews(id),
    approvals: listApprovals(id),
    events: listEvents(id),
    runs: listRuns(id),
    usage: listUsage(id),
    package: latestPackage(id),
    qc_categories: applicable(job.performance_mode),
    validation: report,
    readiness: ready,
  };
}

export function dashboardStats() {
  const jobs = listJobs();
  const campaigns = listCampaigns();
  const usage = db().prepare("SELECT provider, kind, unit_type, currency, SUM(amount) AS amount, SUM(units) AS units FROM usage GROUP BY provider, kind, unit_type, currency").all();
  return {
    totals: {
      campaigns: campaigns.length,
      active_jobs: jobs.filter((j) => !["DELIVERED", "FAILED"].includes(j.state)).length,
      awaiting_approval: jobs.filter((j) => AWAITING_HUMAN.includes(j.state)).length,
      awaiting_render: jobs.filter((j) => j.state === "AWAITING_RENDER").length,
      delivered: jobs.filter((j) => j.state === "DELIVERED").length,
      failed: jobs.filter((j) => j.state === "FAILED").length,
      test_jobs: jobs.filter((j) => j.is_test).length,
    },
    awaiting: jobs.filter((j) => AWAITING_HUMAN.includes(j.state)).slice(0, 10).map((j) => ({ id: j.id, state: j.state, label: STATE_LABELS[j.state], is_test: j.is_test })),
    failed: jobs.filter((j) => j.state === "FAILED").map((j) => ({ id: j.id, last_error: j.last_error, retry_count: j.retry_count })),
    recent: listEvents(undefined, 15),
    usage,
    by_state: Object.fromEntries(Object.keys(STATE_LABELS).map((s) => [s, jobs.filter((j) => j.state === s).length])),
  };
}
