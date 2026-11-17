#!/usr/bin/env python3
"""Turn a production plan into a copy/paste render sheet for Google Flow.

    python3 tools/render_sheet.py outputs/<job>/production.json
    python3 tools/render_sheet.py briefs/demo-001/expected-production.json --allow-not-ready --output /tmp/sheet.md

By default the sheet is written only when the production passes `--check-ready`. With
--allow-not-ready it is written anyway, with a NOT READY banner listing the blockers (handy
for reviewing a plan before the images exist). The tool renders nothing. It only prepares what
you paste into Flow by hand.
"""

from __future__ import annotations

import argparse
import datetime as _dt
import json
import sys
from pathlib import Path
from typing import List, Optional

import validate
from qc import MODE_LABELS


def _fence(text: str) -> str:
    fence = "~~~" if "```" in text else "```"
    return f"{fence}\n{text}\n{fence}"


def build_sheet(production: dict, flow_config: Optional[dict], blockers: List[str], warnings: List[str]) -> str:
    p = production
    models = {m["model_id"]: m for m in (flow_config or {}).get("models", [])}
    job = p["job_id"]
    lines = [
        f"# Render sheet: {job}",
        "",
        f"Generated {_dt.date.today().isoformat()} from the production plan. **Nothing has been rendered.** You render each clip by hand in Google Flow.",
        "",
        f"- Character: `{p['character_id']}` (use ONLY this character's images)",
        f"- Mode: {p['mode']} · Duration: {p['duration_seconds']} s · Aspect ratio: **{p['aspect_ratio']}** · Clips: {len(p['flow_prompts'])}",
        f"- Concept: {p['concept']['title'] or '(none)'}",
        f"- Prompt versions: {', '.join(f'{k}@{v}' for k, v in p['prompt_versions'].items()) or '(not recorded)'}",
        f"- Plan status: `{p['status']}`",
        "",
    ]
    if blockers:
        lines += ["> **NOT READY TO RENDER.** Fix these first, then re-run this tool:", ">"]
        lines += [f"> - {b}" for b in blockers]
        lines.append("")
    if warnings:
        lines += ["**Warnings**", ""] + [f"- {w}" for w in warnings] + [""]

    lines += [
        "## Before you start",
        "",
        f"- [ ] New Flow project named `{job}`",
        "- [ ] Model, mode, clip length and aspect ratio checked in Flow (see config/google-flow.json)",
        f"- [ ] Experiment log ready: `experiments/experiment-log.csv`",
        "",
    ]

    for c in p["flow_prompts"]:
        model = models.get(c["model_id"], {})
        label = model.get("label", c["model_id"])
        length = round(c["end_seconds"] - c["start_seconds"], 2)
        lines += [
            f"## {c['clip_id']} · {c['start_seconds']:g}–{c['end_seconds']:g} s ({length:g} s) · {label} · {MODE_LABELS.get(c['generation_mode'], c['generation_mode'])} · {p['aspect_ratio']}",
            "",
        ]
        if c.get("continuity_from"):
            lines += [f"Continues straight on from **{c['continuity_from']}**.", ""]
        uploads = []
        if c.get("start_frame"):
            uploads.append(f"Start frame: `{c['start_frame']}`")
        if c.get("end_frame"):
            uploads.append(f"End frame: `{c['end_frame']}`")
        uploads += [f"`{x}`" for x in c["ingredients"]]
        if uploads:
            lines += ["**Upload, in this order:**", ""] + [f"{i}. {u}" for i, u in enumerate(uploads, 1)] + [""]
        else:
            lines += ["**No images to upload** (text to video).", ""]
        lines += ["**Prompt** (paste exactly):", "", _fence(c["prompt"]), ""]
        if c.get("avoid"):
            lines += ["**Negative prompt / avoid** (only if Flow has a field for it):", "", _fence(", ".join(c["avoid"])), ""]
        if c.get("dialogue"):
            lines += [f"**Expected dialogue:** “{c['dialogue']}”", ""]
        if c.get("notes"):
            lines += [f"**Notes:** {c['notes']}", ""]
        checks = [q for q in p["quality_checks"] if q.get("clip_id") in (c["clip_id"], None)]
        if checks:
            lines += ["**Check after each attempt** (score 1–5, see docs/quality-control-checklist.md):", ""]
            lines += [f"- [ ] {q['check_id']} {q['dimension']} (pass ≥ {q['min_pass_score']})" + (f": {q['notes']}" if q["notes"] else "") for q in checks]
            lines.append("")
        lines += [
            f"**Save as** `outputs/{job}/renders/{c['clip_id']}_a01.mp4` (a02, a03… for retries), then log it:",
            "",
            _fence(
                f"python3 tools/log_attempt.py outputs/{job}/production.json --clip {c['clip_id']} --credits <N> \\\n"
                f"    --scores QC01=<1-5>,QC02=<1-5>,... --decision RETRY --output-file outputs/{job}/renders/{c['clip_id']}_a01.mp4"
            ),
            "",
        ]

    edit_items = [s for s in p["storyboard"] if s.get("on_screen_text")]
    lines += ["## Editing notes", "", f"Assemble clips in order: {' → '.join(c['clip_id'] for c in p['flow_prompts']) or '(no clips)'}.", ""]
    if edit_items:
        lines += ["Text overlays to add in editing:", ""]
        lines += [f"- {s['start_seconds']:g}–{s['end_seconds']:g} s ({s['shot_id']}): {s['on_screen_text']}" for s in edit_items]
        lines.append("")
    lines += [
        "Before any delivery: every QC check passes, a named reviewer approves, and AI-content disclosure is applied where the platform requires it. Never publish automatically.",
        "",
    ]
    return "\n".join(lines)


def make_sheet(production_path: Path, output: Optional[Path] = None, allow_not_ready: bool = False,
               root: Path = validate.REPO_ROOT) -> int:
    """Validate and write the sheet. Returns an exit code (0 ok, 1 blocked, 2 bad input)."""
    if not production_path.exists():
        print(f"error: {production_path} not found", file=sys.stderr)
        return 2
    structural = validate.check_production(production_path, root=root)
    if structural.errors:
        structural.print(str(production_path))
        print("error: the production plan itself is invalid; fix it before making a render sheet", file=sys.stderr)
        return 1
    production = json.loads(production_path.read_text(encoding="utf-8"))
    if not production["flow_prompts"]:
        print("error: no flow_prompts yet — run prompts/google-flow.md first", file=sys.stderr)
        return 1
    ready = validate.check_production(production_path, check_ready=True, root=root)
    if ready.errors and not allow_not_ready:
        ready.print(f"{production_path} (render readiness)")
        print("error: not ready to render. Fix the errors above, or use --allow-not-ready to preview the sheet.", file=sys.stderr)
        return 1
    cfg, _ = validate.load_flow_config(root)
    sheet = build_sheet(production, cfg, ready.errors, ready.warnings)
    out = output or production_path.parent / "render-sheet.md"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(sheet, encoding="utf-8")
    state = "NOT READY (preview)" if ready.errors else "ready"
    print(f"Wrote {out} — {len(production['flow_prompts'])} clip(s), {state}")
    return 0


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("production", type=Path)
    ap.add_argument("--output", type=Path, default=None, help="default: render-sheet.md next to production.json")
    ap.add_argument("--allow-not-ready", action="store_true", help="write the sheet even if render-readiness checks fail")
    args = ap.parse_args(argv)
    return make_sheet(args.production, args.output, args.allow_not_ready)


if __name__ == "__main__":
    sys.exit(main())
