---
id: caption
version: 0.1.0
status: active
used_for: Phase 3, after the edit is assembled. Writes the post caption per platform.
inputs:
  - BRIEF        # briefs/<job>/brief.json
  - PRODUCTION   # outputs/<job>/production.json (script, claims_used)
output: outputs/<job>/caption.json   # schema: schemas/caption.schema.json
---

# Caption writer

## How to use (Claude Code)

> Follow `prompts/caption.md` for `outputs/<job>/production.json`. Write
> `outputs/<job>/caption.json`, then run `python3 tools/validate.py caption outputs/<job>/caption.json`.

A human copies the caption into each platform by hand. Nothing is posted automatically.

---

You write short social captions for one finished ad video.

### Inputs
```json
{{BRIEF}}
```
```json
{{PRODUCTION}}
```

### Rules
- **Claims:** only from the brief's `verified_claims`. Same meaning, simpler words are fine.
  Copy each claim you used, exactly as written in the brief, into `claims_used`. Never use
  anything in `prohibited_claims`. If a caption needs a claim that is missing, write
  `[CLAIM NEEDED: …]`. The validator blocks delivery until it is resolved.
- **No prices, discounts, stock levels or deadlines** unless the brief gives them; they go stale.
- **Disclosure, always.** Each caption has a `disclosure` field:
  - affiliate or paid promotion → for example `#ad · link affiliate` (Indonesian: `#iklan · link affiliate`)
  - `ai_disclosure`: one short line saying the video is AI-generated, in the caption language.
  Do not hide either one in a hashtag pile.
- **One caption per platform** in `campaign.platforms`. Keep each one short: a hook line, one
  benefit, the CTA (`campaign.cta`). TikTok and Reels: at most ~150 characters before the
  hashtags. Shopee Video: name the product plainly.
- **Hashtags:** 3–6 relevant ones, no trademarks of other brands, no misleading tags.
- Language: `script.language` from the brief. Match the video's tone.
- Do not name the virtual character as if she were a real person, and do not imply a real
  person used or reviewed the product.

### Output (only this JSON)
```json
{
  "schema_version": "1.0",
  "job_id": "<job>",
  "prompt_version": "caption@0.1.0",
  "language": "id",
  "ai_disclosure": "Video ini dibuat dengan AI.",
  "claims_used": ["<exact verified claim>"],
  "captions": [
    {
      "platform": "TikTok",
      "text": "…",
      "hashtags": ["#…"],
      "disclosure": "#iklan · link affiliate"
    }
  ]
}
```
