# Quality control

A **person** reviews every render: watch each take in full, with sound, then score it on the
Render & QC tab. AI-generated notes (`prompts/quality-controller.md`) are advisory and never replace
this review; the app never scores a video.

## Criteria (`config/qc.json`, editable)

| Id | Category | Min | Weight | Modes |
|---|---|---|---|---|
| QC01 | Facial identity consistency | 4 | 2 | all |
| QC02 | Wardrobe consistency | 4 | 1 | all |
| QC11 | Character distinguishing details | 3 | 1 | all |
| QC03 | Natural body motion | 3 | 1 | all |
| QC04 | Natural hand movement | 3 | 1 | all |
| QC05 | Product geometry consistency | 4 | 2 | all |
| QC12 | Product interaction realism | 3 | 1 | all |
| QC13 | Background stability | 3 | 1 | all |
| QC06 | Camera realism | 3 | 1 | all |
| QC14 | Audio quality | 3 | 1 | talking, voice-over |
| QC07 | Dialogue accuracy | 3 | 1 | talking |
| QC08 | Lip synchronization | 3 | 1 | talking |
| QC09 | Visual artifacts | 4 | 2 | all |
| QC10 | Commercial-use clearance | 5 | 1 | all |

Scale 1–5 (unusable … excellent). **Overall** = weighted mean of the scored applicable categories.
A review **passes** only when every applicable category is scored and at or above its minimum.
Categories that do not apply to the job's mode are left out; an applicable one cannot be N/A.
QC01–QC10 keep the ids used by `tools/qc.py`, `log_attempt.py` and the checklist in
[quality-control-checklist.md](quality-control-checklist.md).

## Decisions

| Decision | Result |
|---|---|
| Keep as draft | review saved, no state change |
| Approve | needs a passing review, your name and the typed job id. Real jobs must also pass `tools/approve.py`'s blockers (all assets with real rights, brief not sample data, character active); production.json becomes `APPROVED` with your name and date. Test jobs get a TEST approval only and are never `APPROVED` |
| Request revision | job → REVISION_REQUIRED, optionally reopening a stage (brief, script, storyboard, prompts or render) |
| Reject take | takes marked rejected, job → AWAITING_RENDER for a new take |

Defects can be recorded with a category and a time range; they are written into the matching
`quality_checks[].notes` and kept in the review history.

Automatic technical checks on upload (they do not score): length vs plan, aspect ratio, missing
audio when dialogue is planned; plus a contact sheet every 0.5 s and the first frame.
