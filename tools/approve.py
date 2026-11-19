#!/usr/bin/env python3
"""Human sign-off: mark a production APPROVED. Run this yourself, in a terminal.

    python3 tools/approve.py outputs/<job>/production.json --reviewer "Your Name"

It refuses unless every QC check has a passing score, every asset has real rights (not
'unknown' or 'internal_test_only'), the brief is not sample data and the character is active.
Then it shows a summary and asks you to type the job id. It only runs in an interactive
terminal, so no script or AI assistant can approve on your behalf.
"""

from __future__ import annotations

import argparse
import datetime as _dt
import json
import sys
from pathlib import Path
from typing import Callable, List, Optional

import validate

BLOCKED_RIGHTS = ("unknown", "internal_test_only")


class ApprovalError(Exception):
    pass


def approval_blockers(production_path: Path, root: Path = validate.REPO_ROOT) -> List[str]:
    """Everything that stands between this production and approval (empty = can approve)."""
    rep = validate.check_production(production_path, root=root)
    blockers = list(rep.errors)
    p = json.loads(production_path.read_text(encoding="utf-8"))
    if p["status"] != "RENDERED_PENDING_QC":
        blockers.append(f"status is {p['status']!r}; only a rendered production (RENDERED_PENDING_QC) can be approved")
    for q in p["quality_checks"]:
        where = f" {q['clip_id']}" if q["clip_id"] else ""
        if q["score"] is None:
            blockers.append(f"{q['check_id']}{where} ({q['dimension']}) has no score")
        elif q["score"] < q["min_pass_score"]:
            blockers.append(f"{q['check_id']}{where} scored {q['score']} (needs ≥ {q['min_pass_score']})")
    for a in p["reference_assets"]:
        if a["rights_basis"] in BLOCKED_RIGHTS:
            blockers.append(f"asset {a['path']} has rights_basis {a['rights_basis']!r}")
    brief_path = root / p["brief"]
    if brief_path.exists() and json.loads(brief_path.read_text(encoding="utf-8"))["is_sample"]:
        blockers.append("the brief is sample data (is_sample: true) and can never be approved for delivery")
    characters, _ = validate.load_characters(root)
    ch = characters.get(p["character_id"])
    if ch is not None and ch["status"] != "active":
        blockers.append(f"character {p['character_id']!r} is {ch['status']!r}, not active")
    return blockers


def approve(production_path: Path, reviewer: str, confirm: Callable[[str], str], notes: str = "",
            today: Optional[str] = None, root: Path = validate.REPO_ROOT) -> dict:
    if not reviewer.strip():
        raise ApprovalError("--reviewer must be a real name")
    blockers = approval_blockers(production_path, root)
    if blockers:
        raise ApprovalError("cannot approve yet:\n  - " + "\n  - ".join(blockers))
    original = production_path.read_text(encoding="utf-8")
    p = json.loads(original)
    typed = confirm(f"Type the job id ({p['job_id']}) to approve it for delivery: ").strip()
    if typed != p["job_id"]:
        raise ApprovalError("job id did not match; nothing changed")
    p["status"] = "APPROVED"
    p["human_review"].update(reviewer=reviewer.strip(), approved_on=today or _dt.date.today().isoformat(), notes=notes or p["human_review"]["notes"])
    production_path.write_text(json.dumps(p, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    after = validate.check_production(production_path, root=root)
    if after.errors:  # should not happen; restore rather than leave an invalid approval behind
        production_path.write_text(original, encoding="utf-8")
        raise ApprovalError("approval would make the production invalid: " + "; ".join(after.errors))
    return p


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("production", type=Path)
    ap.add_argument("--reviewer", required=True, help="your name, as the person signing off")
    ap.add_argument("--notes", default="", help="optional review notes")
    args = ap.parse_args(argv)
    if not (sys.stdin.isatty() and sys.stdout.isatty()):
        print("error: approve.py must be run by a person in an interactive terminal.", file=sys.stderr)
        return 2
    if not args.production.exists():
        print(f"error: {args.production} not found", file=sys.stderr)
        return 2
    p = json.loads(args.production.read_text(encoding="utf-8"))
    print(f"Production: {p['job_id']} · character {p['character_id']} · {p['duration_seconds']} s {p['aspect_ratio']}")
    print(f"Script:     {p['script']}")
    print(f"Claims:     {'; '.join(p['claims_used']) or '(none)'}")
    print("QC scores:  " + ", ".join(f"{q['check_id']}={q['score']}" for q in p["quality_checks"]))
    try:
        approve(args.production, args.reviewer, input, args.notes)
    except ApprovalError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    print(f"APPROVED by {args.reviewer}. Next: python3 tools/package_delivery.py {args.production} --video <edit.mp4>")
    return 0


if __name__ == "__main__":
    sys.exit(main())
