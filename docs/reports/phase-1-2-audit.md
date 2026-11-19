# Phase 1 and Phase 2 audit

Date: 2026-11-19 · Commit audited: `35b010c` (clean working tree) · Auditor: Claude Code

All findings come from reading the code, running the test suite, and running the CLI tools in a
scratch copy of the repository. Nothing was rendered and no paid API was called.

## 1. Environment

| Item | Found | Evidence |
|---|---|---|
| Python | 3.12.3 | `python3 --version` |
| FFmpeg / ffprobe | installed, `/usr/local/bin` | `which ffmpeg ffprobe`; FFmpeg tests ran (none skipped) |
| Node.js / npm | 22.23.3 | `node -v`; `node:sqlite` loads (experimental warning) |
| Docker | CLI 29.5.3 installed; **daemon not running** at audit time | `docker info` → socket not found |
| Python packages | none required (stdlib only); `jsonschema` not installed, built-in `schema_lite` used | `validate.py` prints `schema backend: schema_lite (built-in)` |

## 2. What existed before this audit

The project was a **local CLI toolkit**, not an application. Specifically:

- `tools/`: 13 stdlib-only Python CLIs: `extract_frames`, `generate_manifest`, `validate`,
  `new_production`, `render_sheet`, `log_attempt`, `review_render`, `assemble`, `approve`,
  `package_delivery`, plus shared modules `qc`, `postprod`, `schema_lite`.
- `schemas/`: 8 JSON Schemas (registry, character, brief, production, Flow config, frame
  manifest, reference analysis, caption).
- `prompts/`: 8 versioned prompt templates (front matter carries `version`).
- `characters/`: registry with `female_01` (placeholder) and `female_02` (active, 5 private
  reference images, human-approved description, commercial use recorded).
- `briefs/`: `demo-001` (sample) and `bostanten-wander-bag` (real, Indonesian, 8 verified claims).
- `outputs/bostanten-wander-bag-01/`: a production at `READY_FOR_MANUAL_RENDER`, made with the
  step-by-step prompts (1 clip, 3 shots, Indonesian AI-written script).
- `tests/`: 105 unittest tests.
- No web UI, no HTTP API, no database, no n8n, no Seedance/Dreamina support, no notion of a
  campaign or performance mode.

## 3. Test run

```
python3 -m unittest discover -s tests -v
Ran 105 tests in 28.5s — OK (0 failures, 0 errors, 0 skipped)
```

| Test module | Tests |
|---|---|
| test_extract_frames | 18 |
| test_manifest_helpers | 9 |
| test_postproduction | 22 |
| test_production_tools | 18 |
| test_project | 6 |
| test_registry_and_production | 26 |
| test_schema_lite | 6 |

`python3 tools/validate.py all` → exit 0 (warnings: `female_01` placeholder, Flow model
unverified, demo brief is sample data, demo production lists example image names that do not
exist on disk).
`python3 tools/validate.py production outputs/bostanten-wander-bag-01/production.json --check-ready`
→ OK (warning: spoken dialogue unverified for the Flow model).

## 4. Phase 1 validation

| Requirement | Status | Evidence |
|---|---|---|
| Registry loads Female 01 and Female 02 separately | **PASS** | `validate.load_characters`; `RegistryTest` (10 tests); `validate.py characters` lists both with separate status |
| Character mixing is blocked | **PASS** | Validator rejects references outside `characters/<id>/references/`, shared paths, and byte-identical files across characters (SHA-256). `RegistryTest`, `ProductionTest` cover each case |
| Character identity assets handled as private | **PASS** | `.gitignore` excludes `characters/*/references/*`, all image/video extensions; `GitIgnoreTest`; `git status --ignored` shows the 5 images as ignored |
| FFmpeg tooling works | **PASS** | 18 `ExtractFramesTest` tests ran against real FFmpeg; scratch run of `extract_frames.py` on a 3 s test video produced 3 frames |
| Timestamp extraction produces valid manifests | **PASS** | Scratch run → `validate.py manifest` OK; tests check frame colour per timestamp |
| Reference files validated (rights) | **PASS** | `extract_frames.py` without `--rights` exits with an argparse error; rights enum enforced |
| Prompt templates reusable and versioned | **PASS** | 8 templates with `{{PLACEHOLDER}}` inputs and front-matter `version`; productions record `prompt_versions` |
| macOS project configuration | **PASS** | Paths are repo-relative; fonts resolved from macOS system paths in `postprod.find_font`; tests ran on Darwin 24.6 |
| Existing CLI commands work | **PASS** | Scratch runs: `new_production` (ok, unknown character rejected, reference mode without manifest rejected), `render_sheet` (refuses without flow prompts), `extract_frames`, `validate` |
| Tests pass | **PASS** | 105/105 |

## 5. Phase 2 validation

| Requirement | Status | Evidence |
|---|---|---|
| Campaign briefs can be created | **PARTIAL** | Briefs are hand-written JSON copied from `demo-001`; `validate.py brief` checks them. No campaign concept, no form, no API |
| Briefs follow a defined schema | **PASS** | `schemas/product-brief.schema.json`; both briefs validate |
| Required product information validated | **PASS** | Schema requires brand, product name/category/description/features/visual identity, claims with sources, audience, campaign, deliverable |
| User-provided scripts preserved | **FAIL → fixed** | `brief.script.mode = custom` exists, but `prompts/scriptwriter.md` allowed trimming the custom script, and nothing checked that `production.script` matched it. No exact-script mode |
| Generated results persisted / exportable | **PASS** | Productions are files under `outputs/<job>/`; render sheet exported as Markdown |
| Both production modes represented | **PASS** | `mode: original \| reference_guided`; reference mode requires a manifest (validator + `new_production`) |
| Performance modes (talking / fashion showcase / voice-over) | **FAIL → fixed** | Not represented anywhere in schemas, prompts or tools |
| Unsupported claims flagged | **PARTIAL → improved** | `claims_used` must be a subset of `verified_claims` (error). The script text itself was not checked: `[CLAIM NEEDED]` left in a script did not block render readiness, and prohibited terms in the script were not detected |
| Outputs consumable by a dashboard and n8n | **PARTIAL** | Files are JSON with schemas, so they are machine-readable, but validators only print human text (no JSON output), and there is no job state beyond `production.status` |
| Seedance / Dreamina prompts | **FAIL → added in Stage E** | Only Google Flow is modelled |

## 6. Broken functionality

No test or CLI failure was found. The defects are missing rules rather than crashes:

1. **Exact-script mode missing (critical for the spec).** A custom script could be rewritten
   silently. Fixed: new `brief.script.exact_script` flag (default `true` for custom scripts),
   validator error when `production.script` differs from the custom script (whitespace-normalised),
   scriptwriter prompt updated (v0.2.0).
2. **`[CLAIM NEEDED]` did not block rendering.** Fixed: `--check-ready` now errors on it.
3. **No performance mode.** Fixed: optional `performance_mode` on brief and production, with
   validator rules (fashion showcase has no dialogue; voice-over showcase has no on-camera
   dialogue; talking influencer needs a script).
4. `briefs/demo-001/expected-production.json` names reference images that do not exist. This is
   example data and only produces warnings; left as is.

## 7. Architectural risks

| Risk | Impact | Mitigation in later stages |
|---|---|---|
| Two status vocabularies (production.json `status` vs the Phase 7 job states) | Confusing state | The app's job state machine is the source of truth; `production.status` is derived from it at fixed points |
| Business rules exist only in Python | A TypeScript backend could duplicate and drift from them | The API calls the Python rules through one JSON bridge (`tools/service.py`) instead of re-implementing them |
| Flow capabilities unverified (`verified: false`) | Clip lengths may be wrong | Kept as warnings; Settings page shows "unverified" labels |
| Approval rule says "in their own terminal" | The dashboard must not become a way for software to approve | Dashboard approval requires a typed reviewer name and the typed job id, is refused for `system`/`n8n` actors, and sample/test jobs can never be approved for commercial delivery |
| Docker daemon not running | n8n cannot start until Docker Desktop is opened | Documented; smoke test checks it |

## 8. Reusable code

All of it. The API wraps, rather than replaces: `validate.check_brief / check_production /
load_characters / load_flow_config`, `qc.STANDARD_QC`, `render_sheet.build_sheet`,
`generate_manifest.probe_video`, `review_render` contact sheets, `extract_frames`, and
`approve.approval_blockers` (used as the gate for dashboard approval of real jobs).

## 9. Recommended corrections (done before Stage B)

- [x] Add exact-script mode + validator check + prompt update
- [x] Block render readiness on `[CLAIM NEEDED]`; warn on prohibited terms in the script
- [x] Add performance modes to schemas and validator
- [x] Add machine-readable JSON output for the API (`tools/service.py`)
- [ ] User action: verify `config/google-flow.json` in the Flow UI (cannot be done by software)
- [ ] User action: add references for `female_01` before using her

## 10. Acceptance summary

| Area | Status |
|---|---|
| Phase 1 (toolkit, registry, frames, prompts, tests) | **PASS** |
| Phase 2 briefs and validation | **PASS** |
| Phase 2 script preservation | **FAIL → fixed** (see regression tests in `tests/test_modes_and_scripts.py`) |
| Phase 2 performance modes | **FAIL → fixed** |
| Phase 2 claim flagging | **PARTIAL → improved** |
| Dashboard / API / n8n readiness | **NOT PRESENT** (built in Stages B–D) |
