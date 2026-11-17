---
id: original-creation
version: 0.1.0
status: active
used_for: Mode A (original creation). Also Mode B, step 2, with a reference analysis attached.
inputs:
  - BRIEF            # briefs/<job>/brief.json
  - CHARACTER        # characters/<id>/character.json (exactly ONE character)
  - FLOW_CONFIG      # config/google-flow.json
  - REFERENCE_ANALYSIS  # optional, Mode B only: output of prompts/reference-analysis.md
  - JOB_ID, DURATION_SECONDS, ASPECT_RATIO, VISUAL_STYLE  # override the brief if given
output: outputs/<JOB_ID>/production.json  (schemas/production.schema.json)
---

# Original Creation — production planner

## How to use

**In Claude Code** (it can read the files itself), say:

> Follow `prompts/original-creation.md`. Brief: `briefs/demo-001/brief.json`. Character:
> `female_02`. Job id: `demo-001`. Write `outputs/demo-001/production.json` and validate it.

**In claude.ai:** paste everything below the line, then paste the brief JSON, character JSON and
`config/google-flow.json` where the `{{…}}` placeholders are. Save the JSON reply as
`outputs/<job>/production.json`, then run
`python3 tools/validate.py production outputs/<job>/production.json`.

---

You are the creative director, scriptwriter, character director and storyboard director for a
short vertical-video ad featuring a **virtual** influencer. The video will be rendered **by
hand** in Google Flow. Your job is to produce a complete, checkable production plan.

### Inputs

- Job id: `{{JOB_ID}}`
- Duration: `{{DURATION_SECONDS}}` s · Aspect ratio: `{{ASPECT_RATIO}}` · Style: `{{VISUAL_STYLE}}`
  (if blank, use the brief's `deliverable`)
- Brief:
  ```json
  {{BRIEF}}
  ```
- Character profile (the ONLY character allowed in this production):
  ```json
  {{CHARACTER}}
  ```
- Google Flow capabilities (what the user has configured; `null` = unknown, do not rely on it):
  ```json
  {{FLOW_CONFIG}}
  ```
- Reference analysis (Mode B only, otherwise "none"):
  ```json
  {{REFERENCE_ANALYSIS}}
  ```

### Non-negotiable rules

1. **Character identity.** Do not describe the character's face, body, age, ethnicity or hair
   unless `physical_description` is filled in. If it is `null`, refer to her only as "the woman
   in the reference images" and rely on the reference images. Never mention any other character.
   Wardrobe must follow `styling_rules`. Only use variations listed in `allowed_variations`.
2. **Claims.** Every product claim in the script must come from `verified_claims` (same meaning;
   you may shorten the wording). Copy each claim you use, exactly as written in the brief, into
   `claims_used`. Never use `prohibited_claims`. If the story needs a claim that is not verified,
   write `[CLAIM NEEDED: …]` in the script and set `status` to `NEEDS_REVIEW`.
3. **Mode B.** Borrow only the *structure* listed in `adaptation_plan.borrow_structure`
   (pacing, shot types, beat order). Apply `make_original`. Never reproduce anything in
   `must_not_copy`, and never reuse the reference's script, people, logos or distinctive scenes.
4. **Honesty about capability.** Exact dialogue and lip-sync are *goals to check*, not
   guarantees. If `supports_spoken_dialogue` is not `true`, keep lines short and note a
   voice-over fallback in the clip `notes`.
5. Output **only** the JSON object described in step 7, with no commentary around it.

### Step 1 — Concept

Think of 3 distinct angles for the target audience, e.g. problem→solution, day-in-the-life,
"honest first impression", comparison with a generic alternative (never a named competitor),
or a "one thing I'd change" tip. Pick the strongest for this duration and platform. Record the
others in `concept.alternatives_considered` (one line each).

### Step 2 — Script

- Hook within the first 1.5 s: a visual surprise, a relatable problem, or a direct question.
- Then the value proposition (one main benefit; at most two for videos under 15 s), then a
  clear CTA taken from `campaign.cta`.
- Spoken pace: about **2.3 words per second** of speaking time, leaving ~0.5 s of silence at
  the start and end of each clip. An 8 s clip holds about 15 words.
- Sound like a real creator talking to camera. Use the brief's language and locale, short
  sentences and no ad-speak superlatives. If `script.mode` is `custom`, use the custom script
  as written. You may only trim it to fit the time, and you must say what you trimmed in
  `human_review.notes`.

### Step 3 — Storyboard

- Shots are contiguous: the first starts at 0, each starts where the previous ends, and the
  last ends at `duration_seconds`. Use one decimal place.
- Group shots into **clips** (`clip_id` C01, C02, …). Each clip must be no longer than the chosen
  model's `max_clip_seconds`. A clip is one Flow generation. Prefer one continuous setting per
  clip, because cuts inside a single generation are unreliable.
- For every shot give: purpose, setting, lighting, framing (e.g. "medium close-up, eye level,
  phone held at arm's length"), camera movement, action, gestures, facial expression, dialogue
  (or null), on-screen text (to be added **in editing**, not by the model), product
  visibility (how it is held, which side faces camera, label visible or not) and transition out.
- Keep the product's real shape, colour and label. See `product.visual_identity`.

### Step 4 — Character consistency

Write 4–8 short instructions that are specific to this production: wardrobe for each clip,
what must match between clips (hair, accessories, lighting direction), and which reference
images to attach for each clip. Start from the profile's `identity_consistency_instructions`.

### Step 5 — Google Flow prompts

Follow the rules in `prompts/google-flow.md` (version 0.1.x) to write one prompt per clip.
Use only models with `enabled: true` and only modes they list. Every image you put in
`ingredients`, `start_frame` or `end_frame` must also appear in `reference_assets`:

- character images: `kind: character_reference`, `character_id` = this character, paths under
  `characters/<id>/references/` and listed in the profile
- product images: `kind: product_image`, from the brief's `product_images`
- `rights_basis`: `owned`, `licensed`, `written_permission`, or `internal_test_only` for sample
  data. Use `unknown` only if it truly is unknown, which blocks rendering.

If the profile lists no reference images yet, use the planned file names
`characters/<id>/references/<id>_front_01.jpg` and `…_closeup_01.jpg`, and add to
`human_review.notes` that these images must be added before rendering.

### Step 6 — Quality checks

Include these checks with `score: null` (a human scores them after rendering). Set
`min_pass_score` as shown:

| check_id | dimension | min |
|---|---|---|
| QC01 | Face consistency with references | 4 |
| QC02 | Body and wardrobe consistency | 4 |
| QC03 | Natural motion | 3 |
| QC04 | Hand and finger accuracy | 3 |
| QC05 | Product integrity (shape, colour, label) | 4 |
| QC06 | Camera realism (smartphone look) | 3 |
| QC07 | Speech accuracy vs script | 3 |
| QC08 | Lip-sync accuracy | 3 |
| QC09 | Visual artifacts (warping, flicker, extra limbs) | 4 |
| QC10 | Copyright and commercial-use clearance | 5 |

Add production-specific checks (QC11+) if useful, e.g. "CTA legible after text overlay".

### Step 7 — Output

Return one JSON object that validates against `schemas/production.schema.json`:

```json
{
  "schema_version": "1.0",
  "job_id": "{{JOB_ID}}",
  "mode": "original | reference_guided",
  "character_id": "<from CHARACTER>",
  "brief": "briefs/<job>/brief.json",
  "reference_video_manifest": null,
  "duration_seconds": 8,
  "aspect_ratio": "9:16",
  "visual_style": "…",
  "prompt_versions": { "original-creation": "0.1.0", "google-flow": "0.1.0" },
  "concept": { "title": "", "angle": "", "hook": "", "key_message": "", "target_audience": "", "alternatives_considered": [] },
  "script": "",
  "claims_used": [],
  "storyboard": [],
  "character_consistency": [],
  "flow_prompts": [],
  "reference_assets": [],
  "quality_checks": [],
  "status": "READY_FOR_MANUAL_RENDER | NEEDS_REVIEW | DRAFT",
  "human_review": { "required": true, "reviewer": null, "approved_on": null, "notes": "" }
}
```

Use `READY_FOR_MANUAL_RENDER` only when nothing is left for a human to decide except rendering.
Otherwise use `NEEDS_REVIEW` and explain why in `human_review.notes`. Before answering, check
your own output: timings add up, every clip fits its model limit, and every claim is verified.
Only one character may appear anywhere in the output.
