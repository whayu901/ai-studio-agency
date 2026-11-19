# Architecture

```
Browser (dashboard, Next.js client pages)
   │  same-origin fetch, x-acs-client header
   ▼
Application API (Next.js route handlers, TypeScript, Zod)          ← source of truth
   │  ├── SQLite (node:sqlite): campaigns, jobs, state history, approvals,
   │  │    renders, QC reviews, orchestration runs, idempotency keys, usage/costs, packages
   │  ├── Files: briefs/, assets/, outputs/<job>/ (production.json, prompts, renders, packages)
   │  └── tools/service.py (JSON bridge) → existing Python rules: validate.py, render_sheet.py,
   │       extract_frames.py, review_render.py, assemble.py, approve.approval_blockers
   │
   │  acs.job.v1 contract (ids only)          callbacks with x-acs-token
   ▼                                          ▲
n8n (Docker, 127.0.0.1) ── Workflows A–D ─────┘  Workflow E on any failure
   │
   ▼
Person renders in Google Flow / Dreamina web UIs → uploads MP4 → human QC → package ZIP
```

## Decisions

| Decision | Why |
|---|---|
| Next.js 15.5 (patched line) for both UI and API | One process, one port, TypeScript end to end; the spec preferred Next.js + TypeScript + Tailwind |
| Business rules stay in Python | They already existed, were tested (105 tests) and are what Claude Code uses. The API calls them through `tools/service.py` instead of re-implementing them, so CLI and dashboard can never disagree |
| SQLite via Node's built-in `node:sqlite` | Smallest reliable local store with transactions; no native build, no server. It prints an "experimental" warning on Node 22 |
| production.json stays a file | The CLI tools, prompts and Claude Code workflows read/write it; the app validates every write and restores the previous file if validation fails |
| n8n orchestrates, does not decide | Workflows only call app endpoints in order. Every stage is idempotent and gate-aware, so a workflow simply stops at the next human decision |
| No video API | Neither Flow nor Seedance is integrated; `ApiVideoProvider` in `web/src/server/providers/video.ts` is the interface a verified future integration must implement |

## Job state machine

`web/src/server/states.ts` is the only place transitions are defined; `repo.transition()` is the
only function that changes a job's state, and it writes an audit event (time, from, to, actor,
source, n8n execution id, reason) in the same transaction.

```
DRAFT → BRIEF_READY → BRIEF_APPROVED → SCRIPT_READY → SCRIPT_APPROVED → STORYBOARD_READY
  → STORYBOARD_APPROVED → PROMPTS_READY → AWAITING_RENDER → RENDER_UPLOADED → QC_PENDING
  → QC_APPROVED → DELIVERED
QC_PENDING → REVISION_REQUIRED → (BRIEF|SCRIPT|STORYBOARD|PROMPTS)_READY or AWAITING_RENDER
QC_PENDING → AWAITING_RENDER (take rejected)
any active state → FAILED → (retry) the exact state it failed in
```

- `*_APPROVED` and `QC_APPROVED` can only be reached by approving from the matching review state,
  by a **named human**. n8n (`orchestrator`) and `system` actors are refused.
- A person may reopen an earlier review state before rendering starts.
- Retries are bounded by `ACS_MAX_RETRIES` (default 3).
- `production.json` `status` is derived from the job state (`productionStatusFor`).

## Data flow of one job

1. Campaign form → `briefs/<campaign>/brief.json` (deterministic mapping, validated by Python).
2. Create job → snapshot `outputs/<job>/brief.json`, scaffold `production.json`, state DRAFT.
3. Stages (dashboard or n8n): brief → concepts/script → storyboard → prompts → render readiness.
   Each writes only its own fields, then `validate.py` runs.
4. Person renders by hand, uploads MP4 per clip → ffprobe checks, contact sheet, first frame.
5. Person scores QC (config/qc.json) → approve / revision / reject.
6. Package: approved takes + assembled edit + manifests → `outputs/<job>/<job>_package_vNN.zip`.

## Integration contract (app → n8n)

`POST {n8n}/webhook/<workflow>` with header `x-acs-token` and body (Zod `OrchestrationPayload`):

```json
{
  "contract": "acs.job.v1",
  "event": "job.submitted | render.uploaded | job.approved",
  "idempotency_key": "<job>:<event>:v<job version>",
  "job_id": "…", "campaign_id": "…", "character_id": "female_02",
  "creation_mode": "original | reference_guided",
  "performance_mode": "talking_influencer | fashion_showcase | voiceover_showcase",
  "provider": "google_flow | seedance", "ai_mode": "mock | manual | anthropic",
  "product": { "name": "…", "category": "…", "verified_claim_count": 1 },
  "script": { "source": "custom | ai_generated", "exact": true, "language": "id" },
  "reference_asset_ids": ["bag.png"], "render_ids": [],
  "settings": { "duration_seconds": 16, "aspect_ratio": "9:16", "is_test": false },
  "requested_at": "ISO-8601"
}
```

No filesystem paths, credentials or brief contents are sent. See [n8n-integration.md](n8n-integration.md)
for the callback endpoints.

## Source map

| Path | What |
|---|---|
| `web/src/server/states.ts` | State machine |
| `web/src/server/repo.ts`, `db.ts` | SQLite access and migrations |
| `web/src/server/jobs.ts` | Job creation, production saves, human gates, edits |
| `web/src/server/pipeline/` | Stages, mock engine, manual prompt export/import, motion/audio, clips, speech |
| `web/src/server/review.ts` | Render upload/attach, QC review, first frames |
| `web/src/server/delivery.ts` | Delivery package and template pack |
| `web/src/server/orchestrator.ts` | n8n submission, idempotency, error recording, retry |
| `web/src/server/providers/` | AI modes (mock/manual/Anthropic) and video providers |
| `web/src/app/api/` | Route handlers (dashboard + `/api/orchestrator/*`) |
| `tools/service.py` | JSON bridge to the Python rules |
