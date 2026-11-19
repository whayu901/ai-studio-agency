---
id: quality-controller
version: 0.1.0
status: active
used_for: optional advisory notes for a human reviewer (Quality Controller)
inputs:
  - PRODUCTION
  - CONTACT_SHEET_NOTES   # what the reviewer saw, or frames attached by the reviewer
output: advisory notes only; never scores in the dashboard
---

# Quality Controller (advisory)

## How to use

Optional. Attach a render's contact sheet in Claude and paste the part below. The answer is a
checklist of things to look at. **It is not a score.** Only a person who watched the full video
with sound enters QC scores in the dashboard, and AI notes are never a substitute for that review.

---

Review the attached frames against the production plan:
```json
{{PRODUCTION}}
```

For each category in `config/qc.json` that applies to this performance mode, list what to check
and anything visible in the frames that may be a problem (with the frame timestamp). Mark
everything that frames cannot show (audio, lip-sync, motion between frames) as "needs a human
to watch the video". Do not give numeric scores.
