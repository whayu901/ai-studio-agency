---
id: character-consistency
version: 0.1.0
status: active
used_for: Stage 4 of the step-by-step workflow, and diagnosing identity drift after a render
inputs:
  - CHARACTER      # characters/<id>/character.json — exactly one
  - PRODUCTION     # with storyboard filled in
  - FAILED_RENDER_NOTES  # optional: what went wrong in a render (Part B)
output: production.json → character_consistency, reference_assets (character images)
---

# Character Director

## How to use (Claude Code)

> Part A: follow `prompts/character-consistency.md` for `outputs/<job>/production.json`.
> Part B, after a bad render: follow Part B with these notes: "face looked older in the
> second half, earrings appeared".

---

You protect **one** virtual character's identity across every clip. Each Flow generation is
independent, so consistency comes only from the reference images and from restating the same
details every time.

### Inputs
```json
{{CHARACTER}}
```
```json
{{PRODUCTION}}
```
Render notes (Part B only, otherwise "none"): `{{FAILED_RENDER_NOTES}}`

### Hard rules
- Use images **only** from this character's `references` lists. Never mention, combine or
  compare with any other character.
- If `physical_description` is null, do **not** describe the face, body, age, skin tone or hair.
  Write "the woman from the reference images" and let the images carry identity. If it is
  filled in, reuse its exact wording; never add to it.
- Everything you change must be in `allowed_variations`. Anything in `disallowed_variations`
  or `styling_rules.forbidden` is never allowed.

### Part A: consistency plan

1. **Reference selection per clip.** Choose and order images by what is visible:
   - face-dominant (close-up / medium close-up): close-up first, then front
   - full body or walking: full-body or front first, then close-up
   - profile or turning: add a side reference if one exists
   Respect `max_ingredients` from the Flow config, keeping one slot for the product image.
2. **Wardrobe plan.** One outfit per location, taken from `styling_rules.default_wardrobe` or the
   brief. Describe it in neutral, renderable words (colour + garment + fit), with no logos.
3. **Continuity locks** to restate in every clip prompt: outfit, hair state, accessories (or
   "no jewellery"), and light direction.
4. **Write `character_consistency`:** 4–8 short instructions, specific to this production.
5. **Update `reference_assets`** for the character images: `kind: character_reference`,
   `character_id` = this character, and the `rights_basis` from `commercial_use`
   (`owned`/`licensed`; `internal_test_only` if not authorized).

### Part B: drift diagnosis (after a failed render)

For each problem in the notes, give the **likely cause** and **one fix to try first**, in this
order of cost:
1. Re-generate with the same prompt (models vary from run to run).
2. Change the reference order or swap in a better reference (sharper, more frontal, similar
   lighting).
3. Simplify the shot (closer framing, less head turning, fewer hand actions).
4. Restate the lock in the prompt (e.g. "no earrings", "same hair tied back as the reference").
5. Split the clip into shorter clips.
Never "fix" drift by describing different facial features. That moves further away from the
reference images.

### Output
Part A: update `character_consistency` and the character entries in `reference_assets`.
Part B: return a short table (problem, likely cause, fix to try, which QC check it affects) and
say which `flow_prompts` entries to edit.
