# Dashboard

`npm --prefix web run dev` → http://localhost:3000. Pages:

| Page | What you do there |
|---|---|
| **Dashboard** | Totals (campaigns, active jobs, awaiting approval, awaiting render, delivered, failed), jobs waiting for you, failed jobs, recent activity with who/what/source, usage and **estimated** costs |
| **Campaigns** | Create/edit campaigns: production mode, performance mode, provider, character, language, duration, aspect ratio, product facts, verified/prohibited claims, audience, script (custom with exact-script toggle and live speech-duration estimate, or drafted), product photo upload with rights, reference video upload with rights (Mode B), test-data flag. Save drafts any time. Create production jobs with an AI mode |
| **Production jobs** | Every job with campaign, character, provider, mode, status, retries, errors, dates |
| **Job → Overview** | Next step, "Run automatic stages" (n8n or direct), retry, reopen a stage, AI mode switch, validator results |
| **Job → Brief** | Brief summary, JSON editor with validated revisions, approve |
| **Job → Script** | Concepts (generate/import, choose), script editor (read-only in exact-script mode), per-line timing, claims checklist, regenerate, approve |
| **Job → Storyboard** | Shots per clip with timestamps, camera, action, dialogue/VO, product visibility; edit, regenerate, approve; reference analysis (Mode B) |
| **Job → Prompt Studio** | Google Flow / Seedance prompts per clip (copy, download, edit), image-generation (first-frame) prompts with upload, reference-analysis prompt, input asset manifest with rights, continuity manifest, motion/audio plan, prompt versions, render sheet download, "Mark ready for manual render" |
| **Job → Render & QC** | Upload MP4 per clip (credits, cost, test-media flag), playback, technical checks, first frame, contact sheet, QC form (1–5 per category, defects with time ranges, comments), keep draft / approve / request revision / reject, review history |
| **Job → Delivery** | Build the package, file list with checksums, download ZIP |
| **Job → History** | State history with actor and n8n execution id, orchestration runs, approvals, usage |
| **Characters** | Female 01 / Female 02: reference images (local only), description, wardrobe, accessories, commercial-use status, validator warnings |
| **Settings & ops** | Execution modes, n8n health, provider capabilities (verified or not), storage and limits, cost settings, QC criteria, import CLI productions, template-pack export, diagnostics (versions, record counts, runs, log tail) |

Every approval opens a dialog where you type your name and the job id. Generated output is labelled
by origin: *Mock (templates, no AI)*, *Imported from manual Claude*, *Anthropic API*, or *Written by
a person*. Theme: System / Light / Dark (bottom of the sidebar).
