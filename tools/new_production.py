#!/usr/bin/env python3
"""Create an empty DRAFT production for a job, ready for the step-by-step prompts.

    python3 tools/new_production.py --job tumbler-01 --brief briefs/demo-001/brief.json --character female_02
    python3 tools/new_production.py --job ref-ad-01 --brief briefs/x/brief.json --character female_01 \\
        --mode reference_guided --manifest outputs/analysis/ref01/manifest.json

Writes outputs/<job>/production.json with status DRAFT, the brief's duration, aspect ratio
and style, the product images as reference assets, and the standard QC checks. The tool
never overwrites an existing production.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import List, Optional

import validate
from qc import default_quality_checks

JOB_RE = re.compile(r"^[a-z0-9][a-z0-9-]{1,63}$")


class ScaffoldError(Exception):
    pass


def _rel(path: Path, root: Path) -> str:
    try:
        return str(path.resolve().relative_to(root.resolve()))
    except ValueError:
        raise ScaffoldError(f"{path} must be inside the project folder")


def scaffold(job: str, brief_path: Path, character_id: Optional[str], mode: str = "original",
             manifest: Optional[Path] = None, root: Path = validate.REPO_ROOT) -> Path:
    if not JOB_RE.match(job):
        raise ScaffoldError("--job must be lowercase letters, digits and dashes, e.g. tumbler-01")
    brief_path = brief_path if brief_path.is_absolute() else root / brief_path
    if not brief_path.exists():
        raise ScaffoldError(f"brief not found: {brief_path}")
    brief, brep = validate.check_brief(brief_path, root)
    if brief is None or brep.errors:
        raise ScaffoldError("brief is invalid:\n  " + "\n  ".join(brep.errors))

    character_id = character_id or brief["deliverable"].get("preferred_character_id")
    if not character_id:
        raise ScaffoldError("no --character given and the brief has no preferred_character_id")
    characters, crep = validate.load_characters(root)
    if crep.errors:
        raise ScaffoldError("character registry has errors — run: python3 tools/validate.py characters")
    if character_id not in characters:
        raise ScaffoldError(f"character {character_id!r} is not in characters/registry.json (have: {', '.join(sorted(characters))})")

    manifest_rel = None
    if mode == "reference_guided":
        if manifest is None:
            raise ScaffoldError("--mode reference_guided needs --manifest (from tools/extract_frames.py)")
        manifest = manifest if manifest.is_absolute() else root / manifest
        if not manifest.exists():
            raise ScaffoldError(f"manifest not found: {manifest}")
        manifest_rel = _rel(manifest, root)
    elif manifest is not None:
        raise ScaffoldError("--manifest is only used with --mode reference_guided")

    out_path = root / "outputs" / job / "production.json"
    if out_path.exists():
        raise ScaffoldError(f"{_rel(out_path, root)} already exists — pick another --job or edit that file")

    rights = "internal_test_only" if brief["is_sample"] else "unknown"
    d = brief["deliverable"]
    production = {
        "schema_version": "1.0",
        "job_id": job,
        "mode": mode,
        "character_id": character_id,
        "brief": _rel(brief_path, root),
        "reference_video_manifest": manifest_rel,
        "duration_seconds": d["duration_seconds"],
        "aspect_ratio": d["aspect_ratio"],
        "visual_style": d["visual_style"],
        "prompt_versions": {},
        "concept": {"title": "", "angle": "", "hook": "", "key_message": "", "target_audience": "", "alternatives_considered": []},
        "script": "",
        "claims_used": [],
        "storyboard": [],
        "character_consistency": [],
        "flow_prompts": [],
        "reference_assets": [
            {"path": p, "kind": "product_image", "character_id": None, "rights_basis": rights} for p in brief["product_images"]
        ],
        "quality_checks": default_quality_checks(is_sample=brief["is_sample"]),
        "status": "DRAFT",
        "human_review": {"required": True, "reviewer": None, "approved_on": None, "notes": ""},
    }
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(production, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    rep = validate.check_production(out_path, root=root)
    if rep.errors:  # should never happen; fail loudly rather than leave a broken file
        out_path.unlink()
        raise ScaffoldError("generated production failed validation:\n  " + "\n  ".join(rep.errors))
    return out_path


NEXT_STEPS = """\
Next steps (ask Claude Code, one at a time):
  1. Follow prompts/creative-director.md for job {job}   -> pick a concept
  2. Follow prompts/scriptwriter.md for {path}
  3. Follow prompts/storyboard.md for {path}
  4. Follow prompts/character-consistency.md for {path}
  5. Follow prompts/google-flow.md for {path}
  6. python3 tools/validate.py production {path} --check-ready
  7. python3 tools/render_sheet.py {path}
(Or do it in one go with prompts/original-creation.md.)"""


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--job", required=True, help="job id, e.g. tumbler-01")
    ap.add_argument("--brief", required=True, type=Path)
    ap.add_argument("--character", default=None, help="character id (default: brief's preferred_character_id)")
    ap.add_argument("--mode", choices=("original", "reference_guided"), default="original")
    ap.add_argument("--manifest", type=Path, default=None, help="frame manifest (reference_guided only)")
    args = ap.parse_args(argv)
    try:
        path = scaffold(args.job, args.brief, args.character, args.mode, args.manifest)
    except ScaffoldError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    rel = path.relative_to(validate.REPO_ROOT)
    print(f"Created {rel} (status DRAFT)")
    if any(a["rights_basis"] == "unknown" for a in json.loads(path.read_text())["reference_assets"]):
        print("Note: product images have rights_basis 'unknown' — set owned/licensed/written_permission before rendering.")
    print(NEXT_STEPS.format(job=args.job, path=rel))
    return 0


if __name__ == "__main__":
    sys.exit(main())
