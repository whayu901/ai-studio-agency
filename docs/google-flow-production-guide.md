# Google Flow — manual production guide

Rendering is done **by you, by hand, in the Flow web app**. This toolkit only prepares the
inputs. Nothing is uploaded, generated or published automatically. Flow's interface, model
names and limits change over time and differ by plan and region. If a step below doesn't match
what you see, go by your screen and update `config/google-flow.json`.

## 0. Before you open Flow

```bash
python3 tools/validate.py production outputs/<job>/production.json --check-ready
```

Continue only when it prints `[OK]`. Then make the render sheet and keep it open next to the
browser:

```bash
python3 tools/render_sheet.py outputs/<job>/production.json
```

It writes `outputs/<job>/render-sheet.md`, with the upload order, prompt and checks for every
clip.

## 1. Open Google Flow

Go to Google Flow (labs.google/flow) in Chrome and sign in with the Google account that has
your Flow plan. Create a **new project** named after the job id (e.g. `demo-001`), so renders
from different jobs never mix.

## 2. Select a compatible video model

In the model selector, choose the model named in the clip's `model_id` (for example Omni Flash
1.2). Check:

- The model offers the clip's **generation mode**. Not every model offers every mode.
- The clip length setting is long enough for the clip (`end_seconds − start_seconds`).
- The **aspect ratio** (e.g. 9:16 portrait) is available and selected.

If something is different, edit the model entry in `config/google-flow.json`. Set `verified: true`
once you've checked, put today's date in `verified_by_user_on`, then re-run the validator.
Don't change the prompt to fit an assumption.

## 3. Upload character reference images

Only for `ingredients_to_video`: upload the files listed in the clip's `ingredients`, **in
order**. The character close-up comes first. Upload images of **one character only**. If Flow
shows images from earlier sessions, make sure you aren't reusing the other character's
images by mistake.

## 4. Supply product images

Upload the product image(s) listed in `ingredients` after the character images. Use a clean,
well-lit image where the label is readable. If Flow limits the number of images (see
`max_ingredients`), keep the character close-up and the product, and drop the full-body
reference first.

## 5. Choose the generation mode

| `generation_mode` | In Flow |
|---|---|
| `ingredients_to_video` | Ingredients / reference images → video |
| `frames_to_video` | Frames → video. Upload `start_frame` (and `end_frame` if set). |
| `text_to_video` | Text → video (no images) |
| `video_to_video` | Edit or extend an existing clip. Only use it on your own previous renders. |

## 6. Paste the prompt

Copy the clip's `prompt` text exactly. If Flow has a separate negative-prompt field, paste the
`avoid` list there, separated by commas. Don't add extra details by hand. If you want changes,
edit `production.json` instead, so every attempt is reproducible. Then generate.

## 7. Evaluate the output

Score the result with [quality-control-checklist.md](quality-control-checklist.md). Watch at
normal speed and at 0.25×, and compare the face side by side with the close-up reference.

- Fails **face** or **product** → re-generate (same prompt first; models vary between runs).
- Fails twice with the same problem → change the prompt in `production.json`, bump its
  version note in `human_review.notes`, then re-generate.
- Speech wrong but visuals good → keep the clip and plan a voice-over in editing.

## 8. Save results and log the attempt

1. Download the clip into `outputs/<job>/renders/` named `<clip_id>_a<attempt>.mp4`
   (e.g. `C01_a01.mp4`). This folder is gitignored.
2. Log **every** attempt, including failed ones, with the credits Flow shows and your QC
   scores:

   ```bash
   python3 tools/log_attempt.py outputs/<job>/production.json --clip C01 --credits 20 --scores QC01=4,QC02=4,QC03=3,QC04=2,QC05=5,QC06=4,QC07=3,QC08=3,QC09=4,QC10=1 --problems "extra finger at 2.4 s" --decision RETRY --output-file outputs/<job>/renders/C01_a01.mp4
   ```

3. For the take you keep, log it with `--decision SELECTED --update-production`. That copies its
   scores into `quality_checks` and sets `status` to `RENDERED_PENDING_QC`. Set `APPROVED` (with
   reviewer and date in `human_review`) by hand, only after a named reviewer signs off.
4. Edit, add text, and add voice-over or captions in your editor. **Never publish automatically.**
   Apply the platform's AI-content disclosure where it's required.
