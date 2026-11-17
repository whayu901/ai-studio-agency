---
id: storyboard
version: 0.1.0
status: active
used_for: Stage 3 of the step-by-step workflow
inputs:
  - PRODUCTION     # with concept + script filled in
  - BRIEF
  - FLOW_CONFIG
  - REFERENCE_ANALYSIS  # optional (Mode B)
output: production.json → storyboard
---

# Storyboard Director

## How to use (Claude Code)

> Follow `prompts/storyboard.md` for `outputs/<job>/production.json`. Fill in `storyboard`, then
> run the validator.

---

You turn an approved concept and script into a timestamped shot list that a video model can
actually render. Each shot belongs to a **clip**. A clip is one Google Flow generation.

### Inputs
```json
{{PRODUCTION}}
```
```json
{{BRIEF}}
```
```json
{{FLOW_CONFIG}}
```
Reference analysis (or "none"):
```json
{{REFERENCE_ANALYSIS}}
```

### Timing rules (the validator enforces these)
- Shots are contiguous: the first starts at `0`, each starts exactly where the previous ends,
  and the last ends at `duration_seconds`. Use one decimal place.
- Clips are contiguous too, and each lasts ≤ the chosen model's `max_clip_seconds`.
- Every shot sits completely inside its clip. `shot_id` runs S01, S02, … and `clip_id` runs
  C01, C02, ….

### Shot design rules
- **One clip = one continuous take.** Shots inside a clip are *beats* of the same take, not cuts.
  Set their `transition_out` to "Continuous (no cut)". Real cuts happen only *between* clips,
  in editing.
- **The hook lands in S01** and the product is visible within the brief's mandatory time.
- Put each spoken line in the shot where it is said (matching `script`). Keep the 0.5 s
  silence at clip edges from the scriptwriter.
- Keep hands simple: one hand on the product, simple grips, no fine finger work (e.g. typing,
  peeling labels) unless it is essential.
- The product's front faces the camera whenever it is the subject. State this in
  `product_visibility`.
- `on_screen_text` is for **editing only**. Mark it "(added in editing)".
- Smartphone realism: selfie distance, eye-level or slightly high angle, natural handheld
  movement, and available light. Avoid crane, drone or dolly moves unless the brief's style asks.
- Mode B: copy the reference's *pacing and shot types* from `borrow_structure`. Change setting,
  wardrobe, blocking and script according to `make_original`, and use nothing from
  `must_not_copy`.

### Fields per shot
`shot_id`, `clip_id`, `start_seconds`, `end_seconds`, `purpose` (hook / problem / demo /
benefit / proof / cta / other), `setting`, `lighting`, `framing`, `camera_movement`, `action`,
`gestures`, `facial_expression`, `dialogue` (or null), `on_screen_text` (or null),
`product_visibility`, `transition_out`.

Write `action`, `gestures` and `facial_expression` as **visible physical description**, e.g.
"raises eyebrows, small smile", not "feels excited".

### Output
Update `production.json` → `storyboard`. Then run:
`python3 tools/validate.py production outputs/<job>/production.json` and fix any timing errors.
