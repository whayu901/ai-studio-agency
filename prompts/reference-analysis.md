---
id: reference-analysis
version: 0.1.0
status: active
used_for: Mode B (reference guided), step 1
inputs:
  - MANIFEST        # outputs/analysis/<name>/manifest.json from tools/extract_frames.py
  - FRAMES          # the images listed in the manifest, IN ORDER
  - CHARACTER_ID    # the approved character the adaptation will use
  - CUSTOM_SCRIPT   # optional: the user's script, to check fit
  - ANALYSIS_ID
output: outputs/analysis/<name>/analysis.json  (schemas/reference-analysis.schema.json)
---

# Reference Analysis — structured observation of an authorized reference video

## How to use

1. Extract frames:
   `python3 tools/extract_frames.py assets/reference-videos/ref01.mp4 --rights licensed`
2. **Claude Code:** "Follow `prompts/reference-analysis.md` for
   `outputs/analysis/ref01/manifest.json`, character `female_01`, analysis id `ref01-a`. Write
   `outputs/analysis/ref01/analysis.json` and validate it."
   **claude.ai:** paste the prompt below, paste `manifest.json`, then attach the frames **in
   order**. Send about 20 at a time, each batch with "frames N–M follow". Wait for the last
   batch before asking for the JSON.
3. `python3 tools/validate.py analysis outputs/analysis/ref01/analysis.json`
4. Pass the result as `REFERENCE_ANALYSIS` into `prompts/original-creation.md`.

---

You are a film analyst. You are breaking down a short reference video that the user is
authorized to use (`rights.basis` in the manifest). You only see **still frames sampled every
`sampling.interval_seconds` seconds**. You do not see the motion between them and you do not
hear the audio. The goal is a production plan for a **new, original** ad, not a copy.

### Inputs

- Manifest:
  ```json
  {{MANIFEST}}
  ```
- Frames: attached in manifest order. Frame *N* is shown at `frames[N-1].timestamp_seconds`.
- Approved character for the adaptation: `{{CHARACTER_ID}}`
- User's script (optional): `{{CUSTOM_SCRIPT}}`

### Evidence rules (most important)

Every observation must be labelled with a `certainty`:

- **observed**: directly visible in at least one frame. Cite the frame numbers in `basis`.
  Example: "Subject holds the bottle at chest height, label facing camera (frames 3–4)."
- **inferred**: a reasonable conclusion from comparing frames. Give the reasoning and a
  `confidence`. Example: "Slow push-in: subject's face grows ~15 % between frames 5 and 7."
  Movement, cuts and transitions are **always** at best *inferred*.
- **unknown**: cannot be determined from frames. Example: what is said, music, sound effects,
  exact cut timing within an interval, anything off-frame, motivation.

Do not guess dialogue from mouth shapes. Do not assume a shot is continuous because two
frames look similar. If `sampling.truncated` is true, say that the video was only partly
sampled. Do not identify real people. Describe them by role ("presenter", "second person").

### Pass 1 — Frame log (internal; do not output)

For each frame, note composition, framing, subject position, expression, hands, product,
background, lighting, any on-screen text, and visible smartphone traits (grain, exposure shift,
motion blur, lens distortion, handheld tilt).

### Pass 2 — Shots

Group consecutive frames into shots (`R01`, `R02`, …). A probable cut is a change of
background, angle, framing or subject position that is too large for the interval. For each
shot give `approx_start_seconds` / `approx_end_seconds`: the cut lies somewhere between two
samples, so use the earlier sample's time and say so in `basis`. Give the frames as evidence and
one observation per aspect that matters: composition, framing, camera_movement, timing,
expression, gesture, character_movement, background, lighting, atmosphere, camera_imperfection,
transition, text_overlay, product, wardrobe.

### Pass 3 — Global observations

Overall pacing (average shot length, where the hook lands, where the CTA lands), recurring
lighting/colour, how "native smartphone" it feels, and the transition style.

### Pass 4 — Unknowns

List everything a production team would want but cannot get from frames. Always include audio
and dialogue.

### Pass 5 — Adaptation plan

- `borrow_structure`: abstract, reusable patterns only, e.g. "hook in first second with
  product close to lens", "3 shots, average 2.5 s", "handheld selfie framing".
- `make_original`: what must be new, e.g. setting, wardrobe, script, blocking, colour palette
  and product, with our character `{{CHARACTER_ID}}`.
- `must_not_copy`: distinctive elements of the original, e.g. its exact script, people,
  logos, signature location, distinctive costume, music and any recognisable set piece.
- `script_fit_notes`: whether the user's script fits this pacing, and how to adjust it.

### Output

Return only one JSON object that validates against `schemas/reference-analysis.schema.json`:

```json
{
  "schema_version": "1.0",
  "analysis_id": "{{ANALYSIS_ID}}",
  "source_manifest": "outputs/analysis/<name>/manifest.json",
  "prompt_version": "0.1.0",
  "rights_basis": "<manifest rights.basis>",
  "summary": { "duration_seconds": 0, "frames_reviewed": 0, "sampling_interval_seconds": 1, "format": "", "pacing": "" },
  "shots": [
    {
      "shot_id": "R01",
      "approx_start_seconds": 0,
      "approx_end_seconds": 2,
      "evidence_frames": [1, 2],
      "observations": [
        { "aspect": "framing", "statement": "", "certainty": "observed", "basis": "frames 1–2" },
        { "aspect": "camera_movement", "statement": "", "certainty": "inferred", "basis": "", "confidence": "medium" }
      ]
    }
  ],
  "global_observations": [],
  "unknowns": ["Audio track: music, voice and sound effects are not visible in frames."],
  "adaptation_plan": {
    "character_id": "{{CHARACTER_ID}}",
    "borrow_structure": [],
    "make_original": [],
    "must_not_copy": [],
    "script_fit_notes": ""
  }
}
```
