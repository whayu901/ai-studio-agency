import { z } from "zod";

/**
 * Zod schemas for everything that crosses the API boundary. The JSON Schemas in /schemas remain
 * the contract for files; the Python validator is run on every file the app writes.
 */
export const ID_RE = /^[a-z0-9][a-z0-9-]{1,63}$/;
export const CHARACTER_RE = /^[a-z][a-z0-9_]{1,39}$/;

export const CreationMode = z.enum(["original", "reference_guided"]);
export const PerformanceMode = z.enum(["talking_influencer", "fashion_showcase", "voiceover_showcase"]);
export const VideoProvider = z.enum(["google_flow", "seedance"]);
export const AiMode = z.enum(["mock", "manual", "anthropic"]);
export const AspectRatio = z.enum(["9:16", "16:9", "1:1", "4:5"]);
export const RightsBasis = z.enum(["owned", "licensed", "written_permission", "internal_test_only"]);
export const ReferenceRights = z.enum(["owned", "licensed", "written_permission", "internal_test_only"]);

const text = (max = 2000) => z.string().trim().max(max);
const req = (max = 2000) => text(max).min(1, "required");
const list = (max = 40) => z.array(req(500)).max(max);

export const ClaimInput = z.object({ claim: req(500), source: req(500) });

export const CampaignInput = z
  .object({
    name: req(120),
    creation_mode: CreationMode,
    performance_mode: PerformanceMode,
    video_provider: VideoProvider.default("google_flow"),
    character_id: z.string().regex(CHARACTER_RE, "invalid character id"),
    is_test: z.boolean().default(false),
    brand: z.object({ name: req(120), guidelines: list(), colors: list().default([]) }),
    product: z.object({
      name: req(200),
      category: req(120),
      description: req(2000),
      key_features: list().min(1, "add at least one feature"),
      visual_identity: list().min(1, "describe what must look right on screen"),
      variants: list().default([]),
      price: text(60).nullable().default(null),
      where_to_buy: text(200).nullable().default(null),
    }),
    product_images: z.array(z.string().regex(/^assets\/products\/[^/][^\0]*\.(jpg|jpeg|png|webp)$/i)).max(10).default([]),
    product_image_rights: RightsBasis.default("owned"),
    verified_claims: z.array(ClaimInput).max(40).default([]),
    prohibited_claims: list().default([]),
    audience: z.object({
      description: req(500),
      age_range: text(40).nullable().default(null),
      locale: req(10),
      pain_points: list().default([]),
    }),
    language: z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/, "use a language code such as id or en"),
    objective: req(300),
    concept_direction: text(500).nullable().default(null),
    tone: list().default([]),
    cta: req(200),
    platforms: list().default([]),
    duration_seconds: z.number().positive().max(180),
    aspect_ratio: AspectRatio.default("9:16"),
    visual_style: req(300),
    script_mode: z.enum(["custom", "ai_generated"]),
    custom_script: text(5000).nullable().default(null),
    exact_script: z.boolean().default(true),
    mandatory_elements: list().default([]),
    restrictions: list().default([]),
    reference_video: z
      .object({ path: z.string().regex(/^assets\/reference-videos\/[^/]+\.(mp4|mov)$/i), rights: ReferenceRights, rights_note: text(300).default("") })
      .nullable()
      .default(null),
  })
  .superRefine((c, ctx) => {
    if (c.script_mode === "custom" && !c.custom_script?.trim()) {
      ctx.addIssue({ code: "custom", path: ["custom_script"], message: "custom script mode needs the script text" });
    }
  });
export type CampaignInput = z.infer<typeof CampaignInput>;

/** Saving a draft accepts partial data; full validation happens when a job is created. */
export const CampaignDraft = z.object({ name: req(120) }).passthrough();

export const JobCreate = z.object({
  campaign_id: z.string().regex(ID_RE),
  job_id: z.string().regex(ID_RE).optional(),
  ai_mode: AiMode.default("mock"),
});

export const ReviewerConfirm = z.object({
  reviewer: req(120),
  /** The reviewer types the job id to confirm, the same safeguard as tools/approve.py. */
  confirm_job_id: req(80),
  notes: text(2000).default(""),
});

export const QcScore = z.union([z.number().int().min(1).max(5), z.literal("na"), z.null()]);
export const QcReviewInput = z.object({
  render_ids: z.array(z.number().int().positive()).min(1),
  scores: z.record(z.string().regex(/^QC\d{2}$/), QcScore),
  defects: z
    .array(z.object({ check_id: z.string().regex(/^QC\d{2}$/), start_seconds: z.number().min(0), end_seconds: z.number().min(0), note: req(500) }))
    .max(100)
    .default([]),
  comments: text(5000).default(""),
  decision: z.enum(["draft", "approve", "revision", "reject"]),
  revision_stage: z.enum(["BRIEF_READY", "SCRIPT_READY", "STORYBOARD_READY", "PROMPTS_READY", "AWAITING_RENDER"]).optional(),
  reviewer: text(120).default(""),
  confirm_job_id: text(80).default(""),
});

/** Versioned contract the app sends to n8n. No filesystem paths, no secrets. */
export const ORCHESTRATION_CONTRACT = "acs.job.v1";
export const OrchestrationPayload = z.object({
  contract: z.literal(ORCHESTRATION_CONTRACT),
  event: z.enum(["job.submitted", "render.uploaded", "job.approved"]),
  idempotency_key: z.string().min(8).max(200),
  job_id: z.string().regex(ID_RE),
  campaign_id: z.string().regex(ID_RE),
  character_id: z.string().regex(CHARACTER_RE),
  creation_mode: CreationMode,
  performance_mode: PerformanceMode,
  provider: VideoProvider,
  ai_mode: AiMode,
  product: z.object({ name: z.string(), category: z.string(), verified_claim_count: z.number().int() }),
  script: z.object({ source: z.enum(["custom", "ai_generated"]), exact: z.boolean(), language: z.string() }),
  reference_asset_ids: z.array(z.string()),
  render_ids: z.array(z.number().int()).default([]),
  settings: z.object({ duration_seconds: z.number(), aspect_ratio: AspectRatio, is_test: z.boolean() }),
  requested_at: z.string(),
});
export type OrchestrationPayload = z.infer<typeof OrchestrationPayload>;

export function zodMessage(err: z.ZodError): { message: string; issues: { path: string; message: string }[] } {
  const issues = err.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
  return { message: issues.map((i) => (i.path ? `${i.path}: ${i.message}` : i.message)).join("; "), issues };
}
