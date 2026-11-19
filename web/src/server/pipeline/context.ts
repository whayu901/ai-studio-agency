import fs from "node:fs";
import { notFound } from "../errors";
import { readJsonFile, repoPath } from "../files";
import { service } from "../python";
import { getCampaign, getJob, type Campaign, type Job } from "../repo";

export type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface Configs {
  google_flow: Json | null;
  google_flow_report: { valid: boolean; errors: string[]; warnings: string[] };
  seedance: Json | null;
  seedance_report: { valid: boolean; errors: string[]; warnings: string[] };
}

export async function loadCharacters(): Promise<{ characters: Record<string, Json>; report: { valid: boolean; errors: string[]; warnings: string[] } }> {
  return service(["characters"]);
}

export async function loadConfigs(): Promise<Configs> {
  return service<Configs>(["configs"]);
}

export interface JobContext {
  job: Job;
  campaign: Campaign;
  brief: Json;
  character: Json;
  configs: Configs;
  production: Json;
  analysis: Json | null;
  manifest: Json | null;
}

export function readProduction(job: Job): Json {
  const abs = repoPath(job.production_path);
  if (!fs.existsSync(abs)) throw notFound(`${job.production_path} is missing`);
  return readJsonFile<Json>(abs);
}

export async function loadContext(jobId: string): Promise<JobContext> {
  const job = getJob(jobId);
  const campaign = getCampaign(job.campaign_id);
  const production = readProduction(job);
  // Each job works from its own brief snapshot (outputs/<job>/brief.json), named in production.brief.
  const brief = readJsonFile<Json>(repoPath(production.brief));
  const [{ characters }, configs] = await Promise.all([loadCharacters(), loadConfigs()]);
  const character = characters[job.character_id];
  // Never fall back to another character: a missing profile stops the job.
  if (!character) throw notFound(`character ${job.character_id} is not in the registry (or its profile is invalid); no substitute is used`);
  const analysis = job.analysis_path && fs.existsSync(repoPath(job.analysis_path)) ? readJsonFile<Json>(repoPath(job.analysis_path)) : null;
  const manifest = job.reference_manifest && fs.existsSync(repoPath(job.reference_manifest)) ? readJsonFile<Json>(repoPath(job.reference_manifest)) : null;
  return { job, campaign, brief, character, configs, production, analysis, manifest };
}

export function providerModel(ctx: Pick<JobContext, "configs" | "job">): Json {
  const cfg = ctx.job.video_provider === "seedance" ? ctx.configs.seedance : ctx.configs.google_flow;
  if (!cfg) throw notFound(`config for ${ctx.job.video_provider} is missing or invalid`);
  return cfg.models.find((m: Json) => m.model_id === cfg.default_model_id) ?? cfg.models[0];
}
