/**
 * Manual Claude mode: export a filled prompt for a stage, the user runs it in claude.ai (or Claude
 * Code), and pastes the JSON answer back. The same prompt text is what the optional Anthropic API
 * provider sends, so manual and API runs are comparable.
 */
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { env } from "../env";
import { badRequest, AppError } from "../errors";
import { zodMessage } from "../schemas";
import type { JobContext, Json } from "./context";

export type AiStage = "reference_analysis" | "concepts" | "script" | "storyboard" | "prompts";

const TEMPLATES: Record<AiStage, string[]> = {
  reference_analysis: ["reference-analysis"],
  concepts: ["creative-director"],
  script: ["scriptwriter"],
  storyboard: ["storyboard", "natural-motion"],
  prompts: ["character-consistency", "natural-motion", "audio-director", "PROVIDER"],
};

export function promptVersion(id: string): string {
  const text = readTemplate(id);
  return /^version:\s*([^\s]+)/m.exec(text)?.[1] ?? "unknown";
}

function readTemplate(id: string): string {
  if (!/^[a-z-]+$/.test(id)) throw badRequest("bad template id");
  return fs.readFileSync(path.join(env().repoRoot, "prompts", `${id}.md`), "utf8");
}

/** The prompt body is everything after the "How to use" section's closing `---` line. */
function body(text: string): string {
  const noFront = text.replace(/^---\n[\s\S]*?\n---\n/, "");
  const idx = noFront.search(/\n---\n/);
  return (idx >= 0 ? noFront.slice(idx + 5) : noFront).trim();
}

export function templatesFor(stage: AiStage, provider: string): string[] {
  return TEMPLATES[stage].map((t) => (t === "PROVIDER" ? (provider === "seedance" ? "seedance" : "google-flow") : t));
}

const RETURN_FORMAT: Record<AiStage, string> = {
  reference_analysis: "Return ONE JSON object that follows schemas/reference-analysis.schema.json (the analysis itself).",
  concepts: 'Return ONE JSON object: {"concepts": [{"concept_id": "K01", "title": "", "angle": "", "hook": "", "key_message": "", "target_audience": ""}, …]} with 3–5 concepts.',
  script: 'Return ONE JSON object: {"script": "<full spoken text, one string>", "claims_used": ["<claim copied exactly from verified_claims>", …], "notes": ["…"]}.',
  storyboard: 'Return ONE JSON object: {"storyboard": [<shot objects exactly as in schemas/production.schema.json $defs.shot>]}.',
  prompts:
    'Return ONE JSON object: {"character_consistency": ["…"], "reference_assets": [<asset objects>], "flow_prompts": [<flowPrompt objects, Google Flow only>], "seedance_prompts": [<seedancePrompt objects, Seedance only>], "continuity": [{"from_clip": "C01", "to_clip": "C02", "end_state": "…", "carry_over": ["…"]}], "image_prompts": [{"clip_id": "C01", "purpose": "…", "prompt": "…", "save_as": "outputs/<job>/frames/C01_first.png"}]}.',
};

export function buildStagePrompt(stage: AiStage, ctx: JobContext): { text: string; templates: { id: string; version: string }[] } {
  const p = ctx.production;
  const flowCfg = ctx.configs.google_flow;
  const providerCfg = ctx.job.video_provider === "seedance" ? ctx.configs.seedance : flowCfg;
  const concept = p.concept?.title ? p.concept : null;
  const values: Record<string, string> = {
    BRIEF: JSON.stringify(ctx.brief, null, 2),
    CHARACTER: JSON.stringify(ctx.character, null, 2),
    CHARACTER_ID: ctx.job.character_id,
    FLOW_CONFIG: JSON.stringify(providerCfg, null, 2),
    SEEDANCE_CONFIG: JSON.stringify(ctx.configs.seedance, null, 2),
    PRODUCTION: JSON.stringify(p, null, 2),
    CONCEPT: JSON.stringify(concept, null, 2),
    DURATION_SECONDS: String(p.duration_seconds),
    PERFORMANCE_MODE: p.performance_mode ?? "talking_influencer",
    JOB_ID: ctx.job.id,
    VISUAL_STYLE: p.visual_style,
    REFERENCE_ANALYSIS: ctx.analysis ? JSON.stringify(ctx.analysis, null, 2) : "none",
    MANIFEST: ctx.manifest ? JSON.stringify(ctx.manifest, null, 2) : "none",
    ANALYSIS_ID: ctx.job.id,
    CUSTOM_SCRIPT: ctx.brief.script?.custom_script ?? "none",
    FAILED_RENDER_NOTES: "none",
  };
  const templates = templatesFor(stage, ctx.job.video_provider);
  const parts = templates.map((id) => {
    const filled = body(readTemplate(id)).replace(/\{\{([A-Z_]+)\}\}/g, (m, k: string) => values[k] ?? m);
    return `<!-- prompt: ${id}@${promptVersion(id)} -->\n${filled}`;
  });
  const header = [
    `# AI Creative Studio — ${stage} for job ${ctx.job.id}`,
    `Character: ${ctx.job.character_id} (use only this character) · Mode: ${ctx.job.creation_mode} · Performance: ${values.PERFORMANCE_MODE} · Provider: ${ctx.job.video_provider} (manual rendering)`,
    "",
  ].join("\n");
  const footer = ["", "---", "## Return format (for importing into the dashboard)", RETURN_FORMAT[stage], "Return only the JSON, in one ```json block. Use only verified_claims; write [CLAIM NEEDED: …] instead of inventing a claim."].join("\n");
  return { text: header + parts.join("\n\n---\n\n") + footer, templates: templates.map((id) => ({ id, version: promptVersion(id) })) };
}

/** Accept raw JSON or a fenced ```json block; return the parsed object. */
export function extractJson(text: string): Json {
  const fenced = /```(?:json)?\s*\n([\s\S]*?)\n```/.exec(text);
  const candidate = (fenced ? fenced[1] : text).trim();
  try {
    const v = JSON.parse(candidate);
    if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("not an object");
    return v as Json;
  } catch {
    throw badRequest("could not read a JSON object from the pasted text");
  }
}

const str = z.string();
const ConceptOut = z.object({ concept_id: str.optional(), title: str.min(1), angle: str.min(1), hook: str.min(1), key_message: str.min(1), target_audience: str.min(1) }).passthrough();
export const STAGE_OUTPUT: Record<AiStage, z.ZodTypeAny> = {
  reference_analysis: z.object({ schema_version: z.literal("1.0"), adaptation_plan: z.object({}).passthrough() }).passthrough(),
  concepts: z.object({ concepts: z.array(ConceptOut).min(1).max(6) }),
  script: z.object({ script: str, claims_used: z.array(str).default([]), notes: z.array(str).default([]) }),
  storyboard: z.object({ storyboard: z.array(z.object({ shot_id: str, clip_id: str }).passthrough()).min(1) }),
  prompts: z.object({
    character_consistency: z.array(str).min(1),
    reference_assets: z.array(z.object({ path: str, kind: str }).passthrough()),
    flow_prompts: z.array(z.object({ clip_id: str }).passthrough()).default([]),
    seedance_prompts: z.array(z.object({ clip_id: str }).passthrough()).default([]),
    continuity: z.array(z.object({}).passthrough()).default([]),
    image_prompts: z.array(z.object({ clip_id: str, prompt: str }).passthrough()).default([]),
  }),
};

export function parseStageOutput(stage: AiStage, raw: unknown): Json {
  const r = STAGE_OUTPUT[stage].safeParse(raw);
  if (!r.success) {
    const m = zodMessage(r.error);
    throw new AppError(422, "import_invalid", `imported ${stage} JSON does not match the expected shape: ${m.message}`, m.issues);
  }
  return r.data as Json;
}
