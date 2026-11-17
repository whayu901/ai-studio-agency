# AI Creative Studio

A small, local toolkit for planning realistic **virtual-influencer video ads**:

- **Claude** (claude.ai or Claude Code) does the creative work: concept, script, storyboard,
  character-consistency rules and Google Flow prompts.
- **Google Flow** renders the video. You do that **by hand** in its web app.
- This repo holds the prompts, character registry, schemas and a few Python tools that check
  everything is consistent before you spend credits.

No API keys, servers, databases or paid add-ons. Everything runs on your Mac.

> **Phase 1 status:** tooling, prompts, schemas and docs are ready. The two characters are
> **placeholders**: no reference images have been added yet, and nothing has been rendered.

---

## 1. What you need (macOS)

| Tool | Check | Install if missing |
|---|---|---|
| Python 3.9+ | `python3 --version` | `xcode-select --install`, or `brew install python` |
| FFmpeg (includes ffprobe) | `ffmpeg -version` | `brew install ffmpeg` (needs [Homebrew](https://brew.sh)) |
| Git | `git --version` | `xcode-select --install` |
| Google Flow access | open labs.google/flow | your Google plan |

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

4. Render in Flow by hand. See [docs/google-flow-production-guide.md](docs/google-flow-production-guide.md).

`briefs/demo-001/expected-production.json` shows what a finished plan looks like.

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

## 8. After rendering

- Score each clip with [docs/quality-control-checklist.md](docs/quality-control-checklist.md).
- Log every attempt in the experiment log:

  ```bash
  cp experiments/experiment-log-template.csv experiments/experiment-log.csv
  ```

- A human reviewer must approve before anything is delivered commercially.

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

| Prompt | Status |
|---|---|
| `original-creation.md` | 0.1.0 (active) |
| `reference-analysis.md` | 0.1.0 (active) |
| `google-flow.md` | 0.1.0 (active) |
| `creative-director.md`, `storyboard.md`, `character-consistency.md` | planned (Phase 2); currently part of original-creation |
