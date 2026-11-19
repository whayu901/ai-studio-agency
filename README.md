# AI Creative Studio

A local, human-reviewed production studio for **virtual-influencer video ads**:

- A **web dashboard** (Next.js, http://localhost:3000) for campaigns, production jobs, briefs,
  scripts, storyboards, provider prompts, render uploads, quality review and delivery packages.
- **Claude** does creative work in *manual* mode (export prompt → paste JSON back), or a free
  deterministic *mock* mode fills every stage from templates. An optional *Anthropic API* mode runs
  only with your API key and a budget you set.
- **Google Flow** and **Seedance / Dreamina** render the video **by hand** in their web UIs.
- **n8n** (optional, local Docker) orchestrates the pipeline; the app stays the source of truth.
- The original Python tools still do the checking (validation, render sheets, FFmpeg work), from the
  command line or behind the dashboard.

Nothing here publishes anything or calls a paid API by default. Everything runs on your Mac.

## Quick start (dashboard)

```bash
cd ~/Documents/office/ai-creative-studio
npm --prefix web ci
bash scripts/setup-local-env.sh
npm --prefix web run dev            # http://localhost:3000
```

Then: **Campaigns → New campaign** → fill in product, claims, character, mode → **Create production
job** → follow the job's tabs (Brief → Script → Storyboard → Prompt Studio → Render & QC → Delivery).

| Topic | Doc |
|---|---|
| Install, configuration, storage | [docs/installation.md](docs/installation.md) |
| Pages and actions | [docs/dashboard.md](docs/dashboard.md) |
| Architecture, state machine, data flow | [docs/architecture.md](docs/architecture.md) |
| Original vs Reference Guided; Talking / Showcase / Voice-over | [docs/production-modes.md](docs/production-modes.md) |
| Mock, manual Claude and API modes; the ten roles | [docs/agents.md](docs/agents.md) |
| n8n setup and workflows | [docs/n8n-integration.md](docs/n8n-integration.md) |
| Google Flow / Seedance | [docs/google-flow.md](docs/google-flow.md), [docs/seedance.md](docs/seedance.md) |
| Characters | [docs/character-registry.md](docs/character-registry.md) |
| Quality control | [docs/quality-control.md](docs/quality-control.md) |
| Tests | [docs/testing.md](docs/testing.md) |
| Deployment limits, roadmap | [docs/deployment.md](docs/deployment.md), [docs/roadmap.md](docs/roadmap.md) |
| Audit and final report | [docs/reports/](docs/reports/) |

The sections below describe the command-line workflow, which still works on its own.

---

## 1. What you need (macOS)

| Tool | Check | Install if missing |
|---|---|---|
| Python 3.9+ | `python3 --version` | `xcode-select --install`, or `brew install python` |
| FFmpeg (includes ffprobe) | `ffmpeg -version` | `brew install ffmpeg` (needs [Homebrew](https://brew.sh)) |
| Git | `git --version` | `xcode-select --install` |
| Google Flow access | open labs.google/flow | your Google plan |
| Node.js 22.13+ (dashboard only) | `node -v` | nodejs.org or `nvm install 22` |
| Docker Desktop (n8n only, optional) | `docker info` | docker.com |

There are no Python packages to install. Optionally, `python3 -m pip install jsonschema`
makes the validator use the full JSON Schema library instead of the built-in one.

All commands below are run from the project folder:

```bash
cd ~/Documents/office/ai-creative-studio
```

## 2. Folder map

```
characters/            registry.json + one folder per character (images are private, not in Git)
assets/products/       product photos (not in Git)
assets/reference-videos/  authorized reference videos (not in Git)
briefs/<job>/          brief.json (+ expected-production.json for the demo)
prompts/               versioned prompt templates
config/google-flow.json   which Flow models/modes YOU have (edit to match your account)
schemas/               JSON Schemas for every data file
tools/                 extract_frames.py, generate_manifest.py, validate.py
outputs/               everything generated: frames, production plans, renders (not in Git)
experiments/           render attempt log template
docs/                  Google Flow guide, QC checklist
tests/                 automated tests
```

## 3. Check that everything works

```bash
python3 -m unittest discover -s tests -v
```

```bash
python3 tools/validate.py all
```

Warnings about `placeholder` characters and unverified Flow capabilities are expected until
you complete steps 4 and 5.

## 4. Add the character reference images (one-time per character)

Do this for `female_01` and `female_02` separately. **Never put one character's images in the
other's folder.**

1. Copy the images into the character's own folder. Suggested names:

   ```
   characters/female_02/references/female_02_front_01.jpg
   characters/female_02/references/female_02_side_01.jpg
   characters/female_02/references/female_02_back_01.jpg
   characters/female_02/references/female_02_closeup_01.jpg
   characters/female_02/references/female_02_fullbody_01.jpg   (optional)
   ```

   Good references show a neutral expression, even light, a plain background, a sharp face,
   no heavy filters, and the same hairstyle in every image.

2. Open `characters/female_02/character.json` and list each path under the matching view:

   ```json
   "references": {
     "front":    ["characters/female_02/references/female_02_front_01.jpg"],
     "side":     ["characters/female_02/references/female_02_side_01.jpg"],
     "back":     ["characters/female_02/references/female_02_back_01.jpg"],
     "close_up": ["characters/female_02/references/female_02_closeup_01.jpg"],
     "full_body": [],
     "other": []
   }
   ```

3. Look at the images and **write `physical_description` yourself** (or ask Claude to draft it
   from the images, then check it). Fill in `styling_rules` (default wardrobe, hair, makeup).
4. Fill in `commercial_use`: who owns the character's likeness, a licence or reference, what
   uses are allowed, and `authorized: true` only if that is actually true.
5. Change `"status": "placeholder"` to `"status": "active"`.
6. Validate:

   ```bash
   python3 tools/validate.py characters
   ```

   The validator blocks a character from becoming `active` without front and close-up
   images, a description, and commercial authorization. It also blocks any image shared
   between characters (same path or identical file content).

## 5. Tell the toolkit what your Google Flow account can do

Open Flow, look at the model list and the modes each model offers, then edit
`config/google-flow.json`: models, `generation_modes`, `max_clip_seconds`,
`max_ingredients`, `aspect_ratios`, and whether it generates audio or speech. Set
`"verified": true` and `verified_by_user_on` to today's date. Then run:

```bash
python3 tools/validate.py flow-config
```

## 6. Mode A — create an original ad

1. Copy the demo brief and edit it for your product:

   ```bash
   mkdir -p briefs/my-job
   cp briefs/demo-001/brief.json briefs/my-job/brief.json
   ```

   Only list claims you can prove under `verified_claims`, with their source. Put product
   photos in `assets/products/` and list them in `product_images`.

2. Generate the production plan with Claude.
   - **Claude Code:** in this folder, ask:
     *"Follow prompts/original-creation.md. Brief: briefs/my-job/brief.json. Character:
     female_02. Job id: my-job. Write outputs/my-job/production.json, write
     outputs/my-job/render-sheet.md, and validate."*
   - **claude.ai:** open `prompts/original-creation.md` and paste the part below the line, then
     paste the brief, character JSON and Flow config in place of the `{{…}}` placeholders. Save
     the JSON answer as `outputs/my-job/production.json`.

3. Check it:

   ```bash
   python3 tools/validate.py production outputs/my-job/production.json --check-ready
   ```

   Fix anything listed under `ERROR`. Common ones are a clip longer than the model allows, an
   unverified claim, a missing image, or an image from the wrong character.

4. Make the copy/paste render sheet:

   ```bash
   python3 tools/render_sheet.py outputs/my-job/production.json
   ```

   This writes `outputs/my-job/render-sheet.md`, with each clip's upload order, prompt, the QC
   checks to watch and where to save the file. It refuses until the plan is ready. Add
   `--allow-not-ready` for a preview that lists the blockers.

5. Render in Flow by hand. See [docs/google-flow-production-guide.md](docs/google-flow-production-guide.md).

`briefs/demo-001/expected-production.json` shows what a finished plan looks like.

### Step-by-step variant (more control)

`original-creation.md` plans everything in one pass. To review and refine each stage
separately, start from an empty DRAFT:

```bash
python3 tools/new_production.py --job my-job --brief briefs/my-job/brief.json --character female_02
```

Then ask Claude Code to run each prompt in turn on `outputs/my-job/production.json`. Check the
result after each stage before moving on:

| Stage | Prompt | Fills in |
|---|---|---|
| 1 | `prompts/creative-director.md` | `outputs/my-job/concepts.json` (3–5 options). You pick one, which goes into `concept`. |
| 2 | `prompts/scriptwriter.md` | `script`, `claims_used`, plus `script-notes.md` (line timing) |
| 3 | `prompts/storyboard.md` | `storyboard` (shots grouped into Flow clips) |
| 4 | `prompts/character-consistency.md` | `character_consistency`, character `reference_assets` |
| 5 | `prompts/google-flow.md` | `flow_prompts`, then run `tools/render_sheet.py` |

After a bad render, use Part B of `character-consistency.md` ("drift diagnosis") to decide what
to change.

## 7. Mode B — adapt an authorized reference video

Use only videos you own or have permission or a licence for. The tool never downloads videos.
You save the file yourself.

1. Put the video in `assets/reference-videos/` (MP4 or MOV).
2. Extract frames (1 per second by default, at most 120):

   ```bash
   python3 tools/extract_frames.py assets/reference-videos/ref01.mp4 --rights licensed --rights-note "Licence #123"
   ```

   Useful options:

   | Option | Effect |
   |---|---|
   | `--interval 0.5` | one frame every 0.5 s |
   | `--max-frames 60 --fit` | spread 60 frames over the whole video instead of stopping at 60 |
   | `--start 2 --end 10` | only sample 2 s–10 s |
   | `--extract-audio` | also save `audio.wav` for a manual listen |
   | `--format png` | PNG instead of JPG |
   | `--max-long-edge 0` | keep full resolution (default downsizes to 1280 px) |
   | `--overwrite` | replace a previous extraction |

   `--rights` must be one of `owned`, `licensed`, `written_permission` or `internal_test_only`.
   The result goes in `outputs/analysis/ref01/`:

   - `frames/frame_0001_00000000ms.jpg` … (the frame number and timestamp are in the name)
   - `manifest.json` (timestamps, video metadata, frame paths, limitations)
   - `INDEX.md` (a quick table of frames)

3. Analyze with Claude using `prompts/reference-analysis.md`. Attach the frames in order. Save
   the result as `outputs/analysis/ref01/analysis.json` and check it:

   ```bash
   python3 tools/validate.py analysis outputs/analysis/ref01/analysis.json
   ```

4. Continue with Mode A step 2, adding the analysis as `REFERENCE_ANALYSIS` and setting
   `mode` to `reference_guided`.

**Limits of frame sampling:** frames are snapshots. They do not contain audio or the exact
dialogue, and they do not show motion between samples, exact cut timing, or anything off-screen.
The analysis prompt makes Claude label every observation as *observed*, *inferred* or
*unknown* for this reason. The goal is to learn the structure (pacing, framing, beat order) and
make something **original**, never a copy.

## 8. After rendering: review, log, edit, approve, deliver

Everything here runs locally with FFmpeg. Nothing is uploaded or posted.

1. **Check each download.** Measures length, aspect ratio and audio, and makes a contact sheet
   (frames every 0.5 s with timestamps) plus the last frame for continuing clips:

   ```bash
   python3 tools/review_render.py outputs/my-job/production.json --clip C01 --file outputs/my-job/renders/C01_a01.mp4
   ```

2. **Score and log every attempt**, including failed ones (see
   [docs/quality-control-checklist.md](docs/quality-control-checklist.md)). The log file is created on first use:

   ```bash
   python3 tools/log_attempt.py outputs/my-job/production.json --clip C01 --credits 20 --scores QC01=4,QC02=4,QC03=3,QC04=2,QC05=5,QC06=4,QC07=3,QC08=3,QC09=4,QC10=1 --problems "6 fingers at 2.4 s" --decision RETRY --output-file outputs/my-job/renders/C01_a01.mp4
   ```

   For the take you keep, use `--decision SELECTED --update-production`. That copies the scores
   into `production.json` and sets the status to `RENDERED_PENDING_QC`.

3. **Assemble the edit.** Takes come from the log (latest `SELECTED` per clip) or `--take`. Each
   clip is fitted to 1080×1920 (for 9:16), trimmed or held to its planned length, joined in
   order, the storyboard's on-screen text is drawn at the shot times, a small AI-content label
   is added, and audio is normalised to -14 LUFS:

   ```bash
   python3 tools/assemble.py outputs/my-job/production.json
   # with your own voice-over (clip audio ducked underneath):
   python3 tools/assemble.py outputs/my-job/production.json --voiceover outputs/my-job/audio/vo.wav --voiceover-rights own_recording
   ```

   Output: `outputs/my-job/edit/my-job_v01.mp4` plus `my-job_v01.json` (which takes, texts and
   audio went in). Voice-overs must be your own recording or a licensed voice; never a clone of
   a real person.

4. **Write captions** with `prompts/caption.md` → `outputs/my-job/caption.json`, then
   `python3 tools/validate.py caption outputs/my-job/caption.json`. Claims must come from the
   brief, and every caption carries the paid/affiliate disclosure and an AI note.

5. **Approve (a person, in a terminal).** Refuses unless every QC check passes, all rights are
   real, the brief isn't sample data and the character is active. You type the job id to confirm.
   It only runs in an interactive terminal, so no script or AI assistant can approve for you:

   ```bash
   python3 tools/approve.py outputs/my-job/production.json --reviewer "Your Name"
   ```

6. **Package the delivery.** Copies the approved edit, writes one caption file per platform and
   a `DELIVERY.md` with checksums, scores and a posting checklist:

   ```bash
   python3 tools/package_delivery.py outputs/my-job/production.json --video outputs/my-job/edit/my-job_v01.mp4 --caption outputs/my-job/caption.json
   ```

   Then post by hand, and switch on the platform's own AI-content label.

## 9. Safety and rights rules

- Character images, product assets, reference videos and all outputs stay **out of Git**
  (see `.gitignore`). Check with `git status` before every commit.
- Never paste API keys or passwords into files in this repo.
- Nothing here publishes media anywhere.
- Use only licensed or authorized reference material, and record the basis with `--rights`.
- Do not clone a real person's voice without written authorization.
- Only verified product claims. Human review before any commercial delivery.

## 10. Prompt versions

Each prompt has a `version` in its front matter. When you change how a prompt behaves, bump its
version. Productions record the versions they used (`prompt_versions`), and the experiment log
has a column for them, so you can tell which prompt changes improved results.

| Prompt | Version | Role |
|---|---|---|
| `original-creation.md` | 0.1.1 | Whole plan in one pass |
| `reference-analysis.md` | 0.1.0 | Mode B frame analysis |
| `creative-director.md` | 0.1.0 | Concept options |
| `scriptwriter.md` | 0.2.0 | Script within time and claim limits; exact-script and performance modes |
| `storyboard.md` | 0.1.0 | Timestamped shots and clips |
| `character-consistency.md` | 0.1.0 | Identity plan and drift diagnosis |
| `google-flow.md` | 0.2.0 | Flow prompts per clip |
| `caption.md` | 0.1.0 | Post captions with disclosure |
| `brief-intake.md` | 0.1.0 | Raw notes → brief (optional) |
| `natural-motion.md` | 0.1.0 | Motion direction per performance mode |
| `audio-director.md` | 0.1.0 | Audio plan per performance mode |
| `seedance.md` | 0.1.0 | Seedance / Dreamina prompts per clip |
| `quality-controller.md` | 0.1.0 | Advisory review notes (never scores) |

## 11. Tools

| Command | What it does |
|---|---|
| `tools/extract_frames.py` | Timestamped frames + manifest from an authorized MP4/MOV |
| `tools/generate_manifest.py` | Rebuild a manifest for frames that already exist |
| `tools/validate.py` | Validate characters, briefs, productions, captions, manifests and analyses (`--check-ready` for render readiness) |
| `tools/new_production.py` | Create an empty DRAFT production for a job |
| `tools/render_sheet.py` | Production → copy/paste render sheet for Flow |
| `tools/log_attempt.py` | Log a render attempt and its QC scores to the experiment CSV |
| `tools/review_render.py` | Check a downloaded clip; contact sheet, last frame, review notes |
| `tools/assemble.py` | Kept takes → edited video with on-screen text, AI label, voice-over, loudness |
| `tools/approve.py` | Human-only sign-off (interactive terminal) that sets `APPROVED` |
| `tools/package_delivery.py` | Approved edit + captions → `outputs/<job>/delivery/` |
| `tools/service.py` | JSON bridge the dashboard uses to call these rules |

Every tool has `--help`.
