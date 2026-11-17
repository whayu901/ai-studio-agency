---
id: google-flow
version: 0.1.0
status: active
used_for: compiling an approved storyboard into per-clip Google Flow prompts
inputs:
  - PRODUCTION      # outputs/<job>/production.json (storyboard approved)
  - CHARACTER       # characters/<id>/character.json
  - FLOW_CONFIG     # config/google-flow.json
output:
  - flow_prompts[] inside production.json
  - outputs/<job>/render-sheet.md   (copy/paste sheet for the human doing the render)
---

# Google Flow Prompt Compiler

## How to use

`prompts/original-creation.md` uses these rules inside its step 5. To re-compile prompts for
an existing production (for example after editing the storyboard), tell Claude Code:

> Follow `prompts/google-flow.md` for `outputs/demo-001/production.json`. Update
> `flow_prompts` and write `outputs/demo-001/render-sheet.md`. Validate afterwards.

---

You convert an approved storyboard into Google Flow prompts. A **human** will paste each one
into Flow by hand. Nothing is sent automatically. Keep the prompts concise, concrete and
visual.

### Inputs

```json
{{PRODUCTION}}
```
```json
{{CHARACTER}}
```
```json
{{FLOW_CONFIG}}
```

### 1. Respect the user's configuration

- Use only models with `enabled: true`, only the `generation_modes` they list, clips no longer
  than `max_clip_seconds`, at most `max_ingredients` images, and only the `aspect_ratios` they
  list.
- If `verified` is false, add to the clip `notes`: "Model capabilities unverified — confirm
  mode and limits in Flow before generating."
- `null` means unknown. Example: if `supports_spoken_dialogue` is `null`, write the line, but
  plan for a voice-over fallback.

### 2. Pick the generation mode for each clip

| Situation | Mode |
|---|---|
| Character on screen, first clip or new scene | `ingredients_to_video`. Attach character reference(s) + product image. |
| Continuing straight on from the previous clip | `frames_to_video`, with the previous clip's last frame (exported by you) as `start_frame`. Note that this mode may not take extra reference images, so identity relies on the start frame. |
| Product-only B-roll, no person | `text_to_video` or `ingredients_to_video` with the product image only |
| Fixing or extending a clip you already rendered | `video_to_video`, only on your own renders |

If the preferred mode is not configured, pick the next best one and say so in `notes`.

### 3. Ingredient order (most important first)

1. Character close-up reference (face identity)
2. Character front / full-body reference (body, wardrobe)
3. Product image (clean, label readable)

Use images of **one character only**. Never put two characters' images in the same clip unless
the production is explicitly a two-character ad. That is not supported in Phase 1.

### 4. Prompt structure (one paragraph, about 60–120 words)

Write in this order:

1. **Shot and camera:** "Vertical 9:16 smartphone selfie video, medium close-up, eye level,
   handheld with subtle natural shake."
2. **Subject:** "The woman from the reference images" (plus the physical description only if
   the profile has one), followed by wardrobe from the production.
3. **Action beats with times:** "0–2s: she lifts the tumbler into frame and raises her
   eyebrows. 2–5s: … 5–8s: …" Use visible, physical actions. Avoid inner states.
4. **Product:** how it is held, which side faces the camera, and "keep the product's exact shape,
   colour and label from the product image".
5. **Setting and light:** a specific place, time of day and light direction.
6. **Dialogue (if any):** `She says to camera: "…"`. Keep it short and natural. One line per
   clip is the most reliable.
7. **Sound (if the model makes audio):** room tone or ambience; no music unless the brief asks.
8. **Realism:** "natural skin texture, realistic hands, true-to-life smartphone colour, slight
   auto-exposure shift, no cinematic grading."

Put things to avoid in `avoid` as plain phrases, e.g. "extra fingers", "text on screen",
"different face", "logo changes". Many Flow modes have no negative-prompt field. If there is
none, turn the most important two into positive wording in the prompt ("hands relaxed with five
fingers"; "no on-screen text").

**Do not** ask the model to write on-screen text, captions or prices. Add those in editing.
Do not ask for camera cuts inside one clip.

### 5. Continuity across clips

- Same wardrobe, hair, accessories, location and light direction unless the storyboard changes
  them on purpose. Restate them in every clip prompt, because each generation is independent.
- Set `continuity_from` to the previous clip_id when a clip continues straight on from it.

### 6. Output

1. Update `flow_prompts[]` in the production JSON. Each item has `clip_id`, `start_seconds`,
   `end_seconds`, `model_id`, `generation_mode`, `ingredients`, `start_frame`, `end_frame`,
   `prompt`, `avoid`, `dialogue`, `continuity_from` and `notes`. Every image path you use must be
   in `reference_assets`.
2. Write `outputs/<job>/render-sheet.md` with, for each clip:

   ~~~markdown
   ## C01 · 0.0–8.0 s · Omni Flash 1.2 · Ingredients to Video · 9:16
   Upload, in this order:
   1. characters/female_02/references/female_02_closeup_01.jpg
   2. assets/products/arka-tumbler-front.jpg
   Prompt (copy everything in the box):
   ```
   <prompt>
   ```
   Check after render: QC01, QC04, QC05, QC08 (see docs/quality-control-checklist.md)
   Log the attempt in experiments/experiment-log.csv
   ~~~

Do not claim anything has been rendered.
