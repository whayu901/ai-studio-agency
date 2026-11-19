import type { CampaignInput } from "../schemas";
import type { Json } from "./context";

/**
 * Brief Intake (deterministic). Maps the structured campaign form 1:1 onto the product-brief
 * schema. It adds nothing that the user did not type: no claims, no features, no audience facts.
 */
export function campaignToBrief(id: string, c: CampaignInput): Json {
  return {
    schema_version: "1.0",
    brief_id: id,
    is_sample: c.is_test,
    brand: { name: c.brand.name, guidelines: c.brand.guidelines, ...(c.brand.colors.length ? { colors: c.brand.colors } : {}) },
    product: {
      name: c.product.name,
      category: c.product.category,
      description: c.product.description,
      ...(c.product.variants.length ? { variants: c.product.variants } : {}),
      key_features: c.product.key_features,
      visual_identity: c.product.visual_identity,
      price: c.product.price || null,
      where_to_buy: c.product.where_to_buy || null,
    },
    product_images: c.product_images,
    verified_claims: c.verified_claims,
    prohibited_claims: c.prohibited_claims,
    target_audience: {
      description: c.audience.description,
      age_range: c.audience.age_range || null,
      locale: c.audience.locale,
      language: c.language,
      pain_points: c.audience.pain_points,
    },
    campaign: { objective: c.objective, concept_direction: c.concept_direction || null, tone: c.tone, cta: c.cta, platforms: c.platforms },
    deliverable: {
      duration_seconds: c.duration_seconds,
      aspect_ratio: c.aspect_ratio,
      visual_style: c.visual_style,
      preferred_character_id: c.character_id,
      performance_mode: c.performance_mode,
      video_provider: c.video_provider,
    },
    script: {
      mode: c.script_mode,
      custom_script: c.script_mode === "custom" ? c.custom_script : null,
      language: c.language,
      ...(c.script_mode === "custom" ? { exact_script: c.exact_script } : {}),
    },
    mandatory_elements: c.mandatory_elements,
    restrictions: c.restrictions,
  };
}

/** The reverse, for importing an existing brief.json into a campaign record. */
export function briefToCampaign(brief: Json, extra: Partial<CampaignInput> = {}): Json {
  const d = brief.deliverable ?? {};
  return {
    name: `${brief.brand?.name ?? ""} ${brief.product?.name ?? brief.brief_id}`.trim(),
    creation_mode: "original",
    performance_mode: d.performance_mode ?? "talking_influencer",
    video_provider: d.video_provider ?? "google_flow",
    character_id: d.preferred_character_id ?? "",
    is_test: !!brief.is_sample,
    brand: { name: brief.brand?.name ?? "", guidelines: brief.brand?.guidelines ?? [], colors: brief.brand?.colors ?? [] },
    product: {
      name: brief.product?.name ?? "", category: brief.product?.category ?? "", description: brief.product?.description ?? "",
      key_features: brief.product?.key_features ?? [], visual_identity: brief.product?.visual_identity ?? [], variants: brief.product?.variants ?? [],
      price: brief.product?.price ?? null, where_to_buy: brief.product?.where_to_buy ?? null,
    },
    product_images: brief.product_images ?? [],
    product_image_rights: "owned",
    verified_claims: brief.verified_claims ?? [],
    prohibited_claims: brief.prohibited_claims ?? [],
    audience: {
      description: brief.target_audience?.description ?? "", age_range: brief.target_audience?.age_range ?? null,
      locale: brief.target_audience?.locale ?? "", pain_points: brief.target_audience?.pain_points ?? [],
    },
    language: brief.script?.language ?? brief.target_audience?.language ?? "en",
    objective: brief.campaign?.objective ?? "", concept_direction: brief.campaign?.concept_direction ?? null,
    tone: brief.campaign?.tone ?? [], cta: brief.campaign?.cta ?? "", platforms: brief.campaign?.platforms ?? [],
    duration_seconds: d.duration_seconds ?? 8, aspect_ratio: d.aspect_ratio ?? "9:16", visual_style: d.visual_style ?? "",
    script_mode: brief.script?.mode ?? "ai_generated", custom_script: brief.script?.custom_script ?? null,
    exact_script: brief.script?.exact_script ?? true,
    mandatory_elements: brief.mandatory_elements ?? [], restrictions: brief.restrictions ?? [], reference_video: null,
    ...extra,
  };
}
