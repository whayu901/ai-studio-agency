# Agents and prompt engine

The ten roles are prompt modules and small functions, not ten API calls.

| Role | Prompt | Code (mock / deterministic) | Output |
|---|---|---|---|
| Brief Intake | `prompts/brief-intake.md` | `pipeline/brief.ts` (form → brief, 1:1) | brief.json |
| Creative Director | `prompts/creative-director.md` | `mockConcepts` | concepts.json (3–5) |
| Scriptwriter | `prompts/scriptwriter.md` (v0.2.0: exact-script, performance modes) | `mockScript` | script, claims_used, script-notes.json |
| Reference Analyst | `prompts/reference-analysis.md` | `mockReferenceAnalysis` (metadata only, visuals "unknown") | analysis.json |
| Character Consistency Director | `prompts/character-consistency.md` | `mockCompile` → character_consistency | identity rules, reference assets |
| Storyboard Director | `prompts/storyboard.md` | `mockStoryboard` | shots grouped into clips |
| Natural Motion Director | `prompts/natural-motion.md` | `pipeline/motion.ts` | motion notes per mode |
| Audio Director | `prompts/audio-director.md` | `audioDirection` | audio plan per mode |
| Provider Prompt Compiler | `prompts/google-flow.md`, `prompts/seedance.md` | `mockCompile` | flow_prompts / seedance_prompts, continuity, image prompts |
| Quality Controller | `prompts/quality-controller.md` | none — **advisory only** | notes for a human; never scores |

All outputs are typed: JSON Schemas in `schemas/` (validated by `tools/validate.py`) and Zod
schemas for imports (`pipeline/manual.ts` `STAGE_OUTPUT`).

## Execution modes (per job, switchable)

| Mode | What happens | Cost |
|---|---|---|
| **mock** | Deterministic templates from the brief, character profile and provider config. Same input → same output. Labelled "Mock (templates, no AI)" | free |
| **manual** | Stage halts; *Export prompt* gives the filled prompt (with a "return format" footer); you run it in claude.ai or Claude Code; paste the JSON back; it is validated and the pipeline continues | your Claude plan |
| **anthropic** | Same prompt sent with the official `@anthropic-ai/sdk` (default `claude-opus-5-5`, server-side refusal fallback on). Available only when `ANTHROPIC_API_KEY` **and** `ACS_AI_BUDGET_USD > 0` are set; refused when the worst-case estimate would exceed the remaining budget; usage recorded from the API's reported tokens | paid |

Claude Pro and Claude Code do **not** give this app API access. Without a key, only mock and manual
modes exist, and the UI says so.

Deterministic steps never use AI: brief intake from the form, copying a custom exact script,
fashion-showcase "no dialogue", reference frame extraction.

## Rules every mode keeps (and the validator enforces)

- One character per job; only that character's reference files (path and content-hash checks).
- No appearance description invented: if `physical_description` is null, prompts say "the woman in
  the attached reference images".
- Only verified claims (`claims_used` ⊆ brief); `[CLAIM NEEDED]` blocks rendering; prohibited
  phrases in the script raise a warning.
- Exact-script mode: any difference from the user's script is an error.
- Fashion showcase: no dialogue anywhere. Voice-over showcase: no on-camera speech in render prompts.
- Clips never exceed the provider's configured maximum.

Prompt versions are recorded per job (`production.prompt_versions`) and shown in Prompt Studio.
