/**
 * Deterministic MOCK engine. No AI is involved: every output is assembled from templates and the
 * user's own brief, character profile and provider config, so the same input always gives the
 * same output. It exists so the whole pipeline can run without a paid model. The UI labels
 * these outputs "Mock (template)" everywhere.
 *
 * Rules it keeps (same as the Claude prompts):
 *  - never describes the character beyond physical_description (null → "the woman in the reference images");
 *  - uses only verified_claims, word for word; never prohibited_claims;
 *  - a custom script in exact mode is copied verbatim;
 *  - fashion_showcase has no dialogue, voiceover_showcase has no on-camera speech.
 */
import { splitClips, round, type ClipPlan } from "./clips";
import type { Json } from "./context";
import { audioDirection, motionDirection, type PerformanceMode } from "./motion";
import { countWords, rateFor, sentences, CLIP_EDGE_SILENCE } from "./speech";

export const MOCK_ENGINE_VERSION = "0.1.0";

const LANG_NAME: Record<string, string> = { id: "Indonesian", en: "English" };
const langName = (l: string) => LANG_NAME[l.slice(0, 2)] ?? l;

function shortName(brief: Json): string {
  const name: string = brief.product.name;
  return name.split(/\s+[—–-]\s+/)[0].split(/\s+/).slice(0, 4).join(" ");
}

function sentence(text: string): string {
  const t = text.trim();
  return /[.!?…]$/.test(t) ? t : `${t}.`;
}

// ----------------------------------------------------------------------------- reference analysis

export function mockReferenceAnalysis(analysisId: string, manifestRel: string, manifest: Json, characterId: string, rights: string): Json {
  const frames: Json[] = manifest.frames ?? [];
  const v = manifest.video ?? manifest.source ?? {};
  const duration = Number(v.duration_seconds ?? manifest.sampling?.end_seconds ?? frames.at(-1)?.timestamp_seconds ?? 1) || 1;
  const interval = Number(manifest.sampling?.interval_seconds ?? 1) || 1;
  const w = v.display_width ?? v.width;
  const h = v.display_height ?? v.height;
  const fmt = w && h ? `${w}x${h} (${w < h ? "vertical" : w > h ? "horizontal" : "square"})` : "unknown";
  return {
    schema_version: "1.0",
    analysis_id: analysisId,
    source_manifest: manifestRel,
    prompt_version: `mock-engine@${MOCK_ENGINE_VERSION}`,
    rights_basis: rights,
    summary: { duration_seconds: round(duration), frames_reviewed: Math.max(1, frames.length), sampling_interval_seconds: interval, format: fmt, pacing: "unknown — the mock engine does not look at frame content; use the manual Claude analysis" },
    shots: [
      {
        shot_id: "R01",
        approx_start_seconds: 0,
        approx_end_seconds: round(duration),
        evidence_frames: frames.length ? frames.map((f) => f.index) : [1],
        observations: [
          { aspect: "composition", statement: `Frame format is ${fmt}.`, certainty: "observed", basis: "video metadata in manifest.json" },
          { aspect: "timing", statement: `${frames.length} frames sampled every ${interval}s over ${round(duration)}s.`, certainty: "observed", basis: "manifest.json sampling" },
          { aspect: "other", statement: "Shot boundaries, framing, gestures and expressions were not analysed (mock engine).", certainty: "unknown", basis: "no visual analysis performed" },
        ],
      },
    ],
    global_observations: [],
    unknowns: [
      "Audio, music and exact dialogue (frames contain no sound)",
      "Motion between sampled frames and exact cut timing",
      "Anything off-frame",
      "All visual content of the frames (not analysed by the mock engine)",
    ],
    adaptation_plan: {
      character_id: characterId,
      borrow_structure: [`Overall length (about ${Math.round(duration)}s) and ${fmt.includes("vertical") ? "vertical" : "the same"} format`],
      make_original: ["New setting, wardrobe from the character profile, the brief's own product and claims", "Original script and shot design"],
      must_not_copy: ["The reference's script, people, faces, voices, music, logos and distinctive scenes"],
      script_fit_notes: "Fit the brief's script to the planned clip lengths; the reference's dialogue is unknown and must not be reproduced.",
    },
  };
}

// ----------------------------------------------------------------------------- concepts

export function mockConcepts(brief: Json, analysis: Json | null): Json[] {
  const name = shortName(brief);
  const pain: string | undefined = brief.target_audience?.pain_points?.[0];
  const feature: string = brief.product.key_features[0];
  const audience: string = brief.target_audience.description;
  const message = brief.verified_claims[0]?.claim ?? brief.product.description;
  const direction: string | null = brief.campaign.concept_direction;
  const concepts: Json[] = [
    {
      concept_id: "K01",
      title: `${name}: everyday moment`,
      angle: direction ?? `Show ${name} in a real, everyday moment of use.`,
      hook: `${name} is in frame and in use within the first 2 seconds.`,
      key_message: message,
      target_audience: audience,
    },
    {
      concept_id: "K02",
      title: pain ? "From a small problem to the answer" : `${name}: one clear benefit`,
      angle: pain ? `Open on the problem "${pain}", then show ${name} as the practical answer.` : `Focus on one feature: ${feature}.`,
      hook: pain ? `A relatable beat about: ${pain}.` : `Close look at ${feature}.`,
      key_message: message,
      target_audience: audience,
    },
    {
      concept_id: "K03",
      title: "Feature close-up",
      angle: `Hands-on demonstration of: ${feature}.`,
      hook: `Close-up of the product, then pull back to the character.`,
      key_message: feature,
      target_audience: audience,
    },
  ];
  if (analysis) {
    concepts.unshift({
      concept_id: "K00",
      title: "Adapted structure from the reference",
      angle: `Borrow only the structure (${analysis.adaptation_plan.borrow_structure.join("; ")}), with an original setting and script.`,
      hook: `${name} appears in the first beat, in a new original scene.`,
      key_message: message,
      target_audience: audience,
    });
  }
  return concepts.map((c) => ({ ...c, alternatives_considered: [], source: `mock-engine@${MOCK_ENGINE_VERSION}` }));
}

// ----------------------------------------------------------------------------- script

export interface ScriptResult {
  script: string;
  claims_used: string[];
  notes: string[];
}

export function mockScript(brief: Json, mode: PerformanceMode, durationSeconds: number, clipCount: number): ScriptResult {
  const s = brief.script;
  const lang: string = s.language;
  const verified: string[] = brief.verified_claims.map((c: Json) => c.claim);
  if (s.mode === "custom") {
    const text: string = s.custom_script;
    const used = verified.filter((c) => text.toLowerCase().includes(c.toLowerCase()));
    const notes = [s.exact_script === false ? "Custom script (trimming allowed, none applied by the mock engine)." : "Custom script used word for word (exact-script mode)."];
    if (used.length === 0) notes.push("No verified claim appears word for word in the custom script: a person must check every product statement in it against the brief.");
    if (mode === "fashion_showcase") return { script: "", claims_used: [], notes: ["Fashion showcase has no dialogue; the custom script is kept in the brief for captions only.", ...notes] };
    return { script: text, claims_used: used, notes };
  }
  if (mode === "fashion_showcase") return { script: "", claims_used: [], notes: ["Fashion showcase: no dialogue. CTA goes on screen in editing."] };

  const rate = rateFor(lang);
  const budget = Math.floor(Math.max(0, durationSeconds - CLIP_EDGE_SILENCE * clipCount) * rate);
  const name = shortName(brief);
  const hook = lang.startsWith("id") ? `Kenalin, ${name}!` : `Meet the ${name}!`;
  const cta = sentence(brief.campaign.cta).replace(/\.$/, "!");
  const lines = [hook];
  const used: string[] = [];
  let words = countWords(hook) + countWords(cta);
  for (const claim of verified) {
    const line = sentence(claim);
    if (words + countWords(line) > budget) break;
    lines.push(line);
    used.push(claim);
    words += countWords(line);
  }
  lines.push(cta);
  const notes = [`Template script (mock engine), ${words} words for a budget of ${budget} words at ${rate} words/s.`];
  if (words > budget) notes.push("Hook + CTA alone exceed the time budget: shorten the CTA or lengthen the video.");
  return { script: lines.join(" "), claims_used: used, notes };
}

// ----------------------------------------------------------------------------- storyboard

const PURPOSES = ["demo", "benefit", "demo", "benefit", "demo", "benefit"];

export function mockStoryboard(brief: Json, character: Json, mode: PerformanceMode, script: string, durationSeconds: number, model: Json): { storyboard: Json[]; clips: ClipPlan[] } {
  const clips = splitClips(durationSeconds, model);
  const name = shortName(brief);
  const wardrobe: string[] = character.styling_rules?.default_wardrobe ?? [];
  const shots: { clip: ClipPlan; start: number; end: number }[] = [];
  for (const c of clips) {
    const len = c.end_seconds - c.start_seconds;
    const n = len >= 7.5 ? 3 : 2;
    const cuts = n === 3 ? [0, 0.31, 0.69, 1] : [0, 0.5, 1];
    for (let i = 0; i < n; i++) shots.push({ clip: c, start: round(c.start_seconds + cuts[i] * len), end: i === n - 1 ? c.end_seconds : round(c.start_seconds + cuts[i + 1] * len) });
  }
  const lines = mode === "fashion_showcase" ? [] : sentences(script);
  const dialogueFor = (j: number): string | null => {
    if (!lines.length) return null;
    const S = shots.length;
    const N = lines.length;
    if (N >= S) return lines.slice(Math.floor((j * N) / S), Math.floor(((j + 1) * N) / S)).join(" ") || null;
    const mine = lines.filter((_, i) => Math.floor((i * S) / N) === j);
    return mine.length ? mine.join(" ") : null;
  };
  const visual: string[] = brief.product.visual_identity;
  const storyboard = shots.map((s, j) => {
    const purpose = j === 0 ? "hook" : j === shots.length - 1 ? "cta" : PURPOSES[(j - 1) % PURPOSES.length];
    const lastInClip = j === shots.length - 1 || shots[j + 1].clip.clip_id !== s.clip.clip_id;
    const talking = mode === "talking_influencer";
    const action =
      purpose === "hook"
        ? `Holds ${name} up at chest height, front facing the camera${talking ? ", and starts talking to the lens" : ""}`
        : purpose === "cta"
          ? `Lets ${name} rest naturally against her body, one hand on it, and looks into the camera${talking ? " to say the call to action" : ""}`
          : purpose === "demo"
            ? `Shows how ${name} is used: ${brief.product.key_features[(j - 1) % brief.product.key_features.length]}`
            : `Small quarter turn so ${name} is seen from the side, then back to the front`;
    const dialogue = dialogueFor(j);
    return {
      shot_id: `S${String(j + 1).padStart(2, "0")}`,
      clip_id: s.clip.clip_id,
      start_seconds: s.start,
      end_seconds: s.end,
      purpose,
      setting: `Simple, uncluttered real-world setting that fits the style: ${brief.deliverable.visual_style}`,
      lighting: "Soft natural daylight from one side",
      framing: purpose === "demo" ? "Medium shot, head to mid-thigh, eye level" : "Medium close-up, chest up with the product in frame, eye level",
      camera_movement: "Near-static smartphone camera, very slight handheld sway",
      action,
      gestures: "Relaxed hands; fingers wrap the product's handle or strap with real contact",
      facial_expression: purpose === "hook" ? "Bright, open smile" : "Relaxed, natural smile",
      dialogue: mode === "fashion_showcase" ? null : dialogue,
      on_screen_text: purpose === "cta" && mode !== "talking_influencer" ? `${brief.campaign.cta} (added in editing)` : null,
      product_visibility: `${name} fully in frame; must match: ${visual.slice(0, 2).join("; ")}`,
      transition_out: lastInClip ? (j === shots.length - 1 ? "End" : "Cut to next clip") : "Continuous (no cut)",
    };
  });
  if (wardrobe.length === 0) storyboard.forEach((s) => (s.gestures += "; wardrobe as in the reference images"));
  return { storyboard, clips };
}

// ----------------------------------------------------------------------------- consistency + prompts

export function characterRefs(character: Json): { closeUp: string[]; front: string[]; side: string[]; full: string[] } {
  const r = character.references ?? {};
  return { closeUp: r.close_up ?? [], front: r.front ?? [], side: r.side ?? [], full: r.full_body ?? [] };
}

export function identityLine(character: Json): string {
  return character.physical_description
    ? `The woman from the reference images. ${character.physical_description}`
    : "The woman in the attached reference images (keep her exact face, hair and body from those images).";
}

export interface CompiledPrompts {
  character_consistency: string[];
  reference_assets: Json[];
  flow_prompts: Json[];
  seedance_prompts: Json[];
  continuity: Json[];
  image_prompts: Json[];
  audio: { plan: string; notes: string[] };
  motion: string[];
}

export function mockCompile(args: {
  jobId: string;
  brief: Json;
  character: Json;
  production: Json;
  provider: "google_flow" | "seedance";
  model: Json;
  isTest: boolean;
  productRights: string;
}): CompiledPrompts {
  const { jobId, brief, character, production, provider, model, isTest } = args;
  const mode: PerformanceMode = production.performance_mode ?? "talking_influencer";
  const cid: string = character.character_id;
  const refs = characterRefs(character);
  const lang = langName(brief.script.language);
  const wardrobe: string[] = character.styling_rules?.default_wardrobe ?? [];
  const accessories: string[] = character.styling_rules?.accessories ?? [];
  const charRights = isTest ? "internal_test_only" : character.commercial_use?.authorized ? "owned" : "unknown";
  const productRights = isTest ? "internal_test_only" : args.productRights;
  const motion = motionDirection(mode);
  const audio = audioDirection(mode, lang, model.supports_spoken_dialogue ?? null);

  const charAssets = [...refs.closeUp.slice(0, 1), ...refs.front.slice(0, 1), ...refs.side.slice(0, 1), ...refs.full.slice(0, 1)];
  const assets: Json[] = [
    ...charAssets.map((p) => ({ path: p, kind: "character_reference", character_id: cid, rights_basis: charRights })),
    ...brief.product_images.map((p: string) => ({ path: p, kind: "product_image", character_id: null, rights_basis: productRights })),
  ];

  const consistency = [
    ...(character.identity_consistency_instructions ?? []),
    wardrobe.length ? `Wardrobe in every clip: ${wardrobe.join(", ")}.` : "Wardrobe exactly as in the reference images.",
    ...(accessories.length ? [`Accessories in every clip: ${accessories.join(", ")}.`] : []),
    `Use only ${cid}'s reference images; never combine them with any other character.`,
    `Product must match the product photo: ${brief.product.visual_identity.join("; ")}.`,
    "Identity fidelity is a goal to check on every take, not a guarantee.",
  ];

  const shots: Json[] = production.storyboard;
  const clipIds = [...new Set(shots.map((s) => s.clip_id))];
  const clipSpan = (id: string) => {
    const ss = shots.filter((s) => s.clip_id === id);
    return { start: ss[0].start_seconds as number, end: ss[ss.length - 1].end_seconds as number, shots: ss };
  };
  const wardrobeText = wardrobe.length ? `${wardrobe.join(", ")}.` : "Wardrobe as in the reference images.";
  const speakText = (ss: Json[], start: number) =>
    ss
      .map((s) => {
        const t0 = round(s.start_seconds - start);
        const t1 = round(s.end_seconds - start);
        const said = mode === "talking_influencer" && s.dialogue ? ` She says in ${lang}: "${s.dialogue}"` : "";
        return `${t0}–${t1}s: ${s.action}.${said}`;
      })
      .join(" ");
  const silent = mode === "talking_influencer" ? "" : " She does not speak; lips relaxed or softly smiling.";
  const productLine = `Keep the product's exact shape, colour and details from the product image: ${brief.product.visual_identity.slice(0, 3).join("; ")}.`;
  const baseAvoid = ["different face", "extra fingers", "second product", "different product shape or colour", "logo changes", "text on screen", "camera cuts", "other brands"];
  const avoid = mode === "talking_influencer" ? baseAvoid : [...baseAvoid, "talking", "mouth moving as if speaking"];

  const flow: Json[] = [];
  const seed: Json[] = [];
  const imagePrompts: Json[] = [];
  const continuity: Json[] = [];
  clipIds.forEach((id, i) => {
    const { start, end, shots: ss } = clipSpan(id);
    const prev = i > 0 ? clipIds[i - 1] : null;
    const dialogue = mode === "talking_influencer" ? ss.map((s) => s.dialogue).filter(Boolean).join(" ") || null : null;
    const scene = `${ss[0].setting}. ${ss[0].lighting}.`;
    const core = `${identityLine(character)} ${wardrobeText} ${speakText(ss, start)}${silent} ${productLine} ${scene} Natural, unhurried movement; realistic hands and skin.`;
    imagePrompts.push({
      clip_id: id,
      purpose: provider === "seedance" ? "first frame for image-to-video (required)" : "optional start frame",
      prompt: `Photorealistic ${production.aspect_ratio} smartphone photo. ${identityLine(character)} ${wardrobeText} Pose: ${ss[0].action}. ${productLine} ${scene} Attach only ${cid}'s reference images and the product photo.`,
      save_as: `outputs/${jobId}/frames/${id}_first.png`,
    });
    if (prev) {
      const prevShots = clipSpan(prev).shots;
      const last = prevShots[prevShots.length - 1];
      continuity.push({
        from_clip: prev,
        to_clip: id,
        end_state: `${last.action} (${last.framing})`,
        carry_over: ["Same face, hair and makeup", wardrobeText.replace(/\.$/, ""), "Same product, same side and strap position", "Same setting and light direction"],
      });
    }
    if (provider === "google_flow") {
      const modes: string[] = model.generation_modes ?? [];
      const max = model.max_ingredients ?? 3;
      const ingredients = [...refs.closeUp.slice(0, 1), ...refs.front.slice(0, 1), ...brief.product_images.slice(0, 1)].slice(0, max);
      flow.push({
        clip_id: id,
        start_seconds: start,
        end_seconds: end,
        model_id: model.model_id,
        generation_mode: modes.includes("ingredients_to_video") ? "ingredients_to_video" : modes[0],
        ingredients,
        start_frame: null,
        end_frame: null,
        prompt: `Vertical ${production.aspect_ratio} smartphone video, ${ss[0].framing}, ${ss[0].camera_movement}, one continuous take. ${core}`,
        avoid,
        dialogue,
        continuity_from: prev,
        notes: [
          model.verified ? null : "Model capabilities unverified: confirm mode, length and ingredient limit in Flow first.",
          prev ? `Continues from ${prev}: match the end state listed in the continuity manifest.` : null,
          mode === "talking_influencer" ? audio.notes[1] : audio.notes.join(" "),
        ].filter(Boolean).join(" "),
      });
    } else {
      const first = `outputs/${jobId}/frames/${id}_first.png`;
      if (!assets.some((a) => a.path === first)) assets.push({ path: first, kind: "start_frame", character_id: null, rights_basis: isTest ? "internal_test_only" : "owned" });
      seed.push({
        clip_id: id,
        start_seconds: start,
        end_seconds: end,
        model_id: model.model_id,
        generation_mode: (model.generation_modes ?? []).includes("image_to_video") ? "image_to_video" : model.generation_modes[0],
        first_frame: first,
        reference_images: [],
        prompt: `${speakText(ss, start)}${silent} The first frame already shows her and the product; keep that face, outfit and product unchanged. ${productLine} Natural, unhurried movement.`,
        motion: motion.slice(0, 6),
        camera: ss[0].camera_movement,
        avoid,
        dialogue,
        continuity_from: prev,
        notes: [
          model.verified ? null : "Seedance capabilities unverified: confirm lengths and modes in Dreamina first.",
          `Make the first frame with the image prompt for ${id} (save it as ${first}), then upload it in Dreamina.`,
        ].filter(Boolean).join(" "),
      });
    }
  });
  return { character_consistency: consistency, reference_assets: assets, flow_prompts: flow, seedance_prompts: seed, continuity, image_prompts: imagePrompts, audio, motion };
}

export const DEFAULT_SPEECH_NOTE = (lang: string) => `Speech estimate uses ${rateFor(lang)} words/s and ${CLIP_EDGE_SILENCE}s of silence per clip.`;
