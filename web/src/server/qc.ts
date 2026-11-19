import fs from "node:fs";
import path from "node:path";
import { env } from "./env";
import type { Json } from "./pipeline/context";

export interface QcCategory {
  check_id: string;
  label: string;
  min_pass: number;
  weight: number;
  applies_to: string[];
}

export function qcConfig(): { categories: QcCategory[]; scale: Json; notes: string[] } {
  return JSON.parse(fs.readFileSync(path.join(env().repoRoot, "config", "qc.json"), "utf8"));
}

export function applicable(mode: string): QcCategory[] {
  return qcConfig().categories.filter((c) => c.applies_to.includes(mode));
}

/** production.json quality_checks for a new job (scores stay null until a person reviews). */
export function productionQualityChecks(mode: string, isTest: boolean): Json[] {
  return applicable(mode).map((c) => ({
    check_id: c.check_id,
    dimension: c.label,
    clip_id: null,
    min_pass_score: c.min_pass,
    score: null,
    notes: c.check_id === "QC10" && isTest ? "Test job: internal only, never cleared for commercial delivery." : "",
  }));
}

export interface ScoreResult {
  overall: number | null;
  passed: boolean;
  missing: string[];
  failing: { check_id: string; score: number; min: number }[];
  invalid_na: string[];
}

/**
 * The one scoring rule: weighted mean over applicable, scored categories; pass only if every
 * applicable category has a numeric score at or above its minimum. "na" is only accepted for
 * categories that do not apply to the job's performance mode.
 */
export function scoreReview(mode: string, scores: Record<string, number | "na" | null>): ScoreResult {
  const cats = applicable(mode);
  let sum = 0;
  let wsum = 0;
  const missing: string[] = [];
  const failing: ScoreResult["failing"] = [];
  const invalid_na: string[] = [];
  for (const c of cats) {
    const s = scores[c.check_id];
    if (s === "na") invalid_na.push(c.check_id);
    if (typeof s !== "number") {
      missing.push(c.check_id);
      continue;
    }
    sum += s * c.weight;
    wsum += c.weight;
    if (s < c.min_pass) failing.push({ check_id: c.check_id, score: s, min: c.min_pass });
  }
  const overall = wsum ? Math.round((sum / wsum) * 100) / 100 : null;
  return { overall, passed: missing.length === 0 && failing.length === 0, missing, failing, invalid_na };
}
