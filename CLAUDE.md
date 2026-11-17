# CLAUDE.md — AI Creative Studio

Local-first toolkit for planning virtual-influencer video ads. Claude does the creative
reasoning and prompt writing; **Google Flow renders by hand in its web UI**. Nothing here
calls a paid API.

## Hard rules

1. **Never invent character appearance.** `female_01` / `female_02` have
   `physical_description: null` until a human fills it in from their reference images. If it is
   null, describe the character only as "the person in the attached reference images".
2. **Never mix characters.** A production uses exactly one `character_id`. Only use reference
   files under `characters/<that id>/references/`. Run `python3 tools/validate.py characters`
   after any registry edit.
3. **Only verified product claims.** Use `verified_claims` from the brief, word for word in
   meaning. Never use anything in `prohibited_claims`. If a claim is needed but missing, write
   `[CLAIM NEEDED]` instead of making one up.
4. **Do not say a video was generated or that Flow is integrated.** Rendering is manual. A
   production's best status before a human renders is `READY_FOR_MANUAL_RENDER`.
5. **Reference videos:** analyze only files the user put in `assets/reference-videos/` and
   says they are authorized to use. Never download videos. Adapt, never replicate. Sampled frames
   do not show audio, exact dialogue, off-frame actions or continuous motion: label these as
   unknown.
6. **No voice cloning** of real speakers. **No auto-publishing.** Human review before any
   commercial delivery.
7. Do not commit media, secrets, or anything in `outputs/`. Do not install system software
   without asking.

## Layout

| Path | What |
|---|---|
| `characters/registry.json` | Index of characters → `characters/<id>/character.json` |
| `briefs/<job>/brief.json` | Product brief (schema: `schemas/product-brief.schema.json`) |
| `prompts/*.md` | Versioned prompt templates (front matter has `version`) |
| `config/google-flow.json` | Flow models/modes the **user** has confirmed. Edit, don't assume. |
| `schemas/*.schema.json` | JSON Schemas for all structured data |
| `tools/` | Python CLIs (stdlib only + FFmpeg) |
| `outputs/<job>/` | Generated production JSON, frames, notes (gitignored) |
| `experiments/` | Render attempt log (CSV) |
| `docs/` | Google Flow guide, QC checklist |

## Common tasks

- Run a production (Mode A): follow `prompts/original-creation.md` with the brief and character
  profile. Write the result to `outputs/<job_id>/production.json`. Then run:
  `python3 tools/validate.py production outputs/<job_id>/production.json --check-ready`
- Analyze a reference (Mode B): `python3 tools/extract_frames.py <video> --rights <basis>`. Then
  follow `prompts/reference-analysis.md`, reading the frames listed in `manifest.json` in order.
- Step by step instead: `python3 tools/new_production.py --job <job> --brief <brief> --character <id>`,
  then creative-director → scriptwriter → storyboard → character-consistency → google-flow.
  Each stage edits only its own fields in `production.json`. Validate after each one. Wait for
  the user to pick a concept before stage 2.
- Compile Flow prompts: `prompts/google-flow.md` + `config/google-flow.json`, then
  `python3 tools/render_sheet.py outputs/<job>/production.json`. Never hand-write the render
  sheet.
- Log a render the user did: `python3 tools/log_attempt.py outputs/<job>/production.json --clip C01 ...`
  Use the scores and credits the **user** reports. Never invent them. Never set `APPROVED` yourself.
- Tests: `python3 -m unittest discover -s tests -v`

## Conventions

- Python 3.9+ standard library only. FFmpeg/ffprobe are called via `subprocess`.
- Bump a prompt's `version` in its front matter whenever you change its behaviour. Record the
  version in `production.json` → `prompt_versions` and in the experiment log.
- Timestamps are seconds (float) in JSON; timecodes are `HH:MM:SS.mmm`.
