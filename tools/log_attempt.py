#!/usr/bin/env python3
"""Log one Google Flow generation attempt to the experiment CSV (and optionally score the plan).

    python3 tools/log_attempt.py outputs/demo-001/production.json --clip C01 --credits 20 \\
        --scores QC01=4,QC02=4,QC03=3,QC04=2,QC05=5,QC06=4,QC07=3,QC08=3,QC09=4,QC10=1 \\
        --problems "6 fingers at 2.4 s" --decision RETRY \\
        --output-file outputs/demo-001/renders/C01_a01.mp4

    # the take you keep: also write the scores into production.json
    python3 tools/log_attempt.py outputs/demo-001/production.json --clip C01 --credits 20 \\
        --scores QC01=5,... --decision SELECTED --update-production

Each call appends one row with an automatic experiment id (EXP-0001, …) and attempt number,
and prints which QC checks failed. The log is created from the template on first use. The
tool never marks a production APPROVED; a named reviewer does that by hand.
"""

from __future__ import annotations

import argparse
import csv
import datetime as _dt
import json
import re
import sys
from pathlib import Path
from typing import Dict, List, Optional

import validate
from qc import BY_ID

DEFAULT_LOG = validate.REPO_ROOT / "experiments" / "experiment-log.csv"
TEMPLATE = validate.REPO_ROOT / "experiments" / "experiment-log-template.csv"
DECISIONS = ("REJECTED", "RETRY", "SELECTED", "APPROVED_FOR_DELIVERY")


class LogError(Exception):
    pass


def template_header(template: Path = TEMPLATE) -> List[str]:
    with open(template, newline="", encoding="utf-8") as fh:
        return next(csv.reader(fh))


def parse_scores(text: Optional[str]) -> Dict[str, int]:
    if not text:
        return {}
    scores: Dict[str, int] = {}
    for part in text.split(","):
        part = part.strip()
        if not part:
            continue
        m = re.fullmatch(r"(QC\d{2})\s*=\s*(\d+)", part, re.I)
        if not m:
            raise LogError(f"bad score {part!r}; use QC01=4,QC02=5,…")
        key, val = m.group(1).upper(), int(m.group(2))
        if not 1 <= val <= 5:
            raise LogError(f"{key}: score must be 1–5, got {val}")
        if key in scores:
            raise LogError(f"{key} given twice")
        scores[key] = val
    return scores


def read_log(path: Path, header: List[str]) -> List[dict]:
    if not path.exists():
        return []
    with open(path, newline="", encoding="utf-8") as fh:
        reader = csv.DictReader(fh)
        if reader.fieldnames != header:
            raise LogError(f"{path} has different columns from the template; fix the header or use --log with a new file")
        return list(reader)


def next_experiment_id(rows: List[dict]) -> str:
    nums = [int(m.group(1)) for r in rows if (m := re.fullmatch(r"EXP-(\d+)", r.get("experiment_id", "")))]
    return f"EXP-{(max(nums) + 1 if nums else 1):04d}"


def log_attempt(
    production_path: Path,
    clip_id: str,
    *,
    credits: float,
    scores: Dict[str, int],
    decision: str,
    problems: str = "",
    output_file: str = "",
    cost: Optional[float] = None,
    currency: str = "",
    model_id: Optional[str] = None,
    date: Optional[str] = None,
    log_path: Path = DEFAULT_LOG,
    update_production: bool = False,
    template: Path = TEMPLATE,
) -> dict:
    if decision not in DECISIONS:
        raise LogError(f"--decision must be one of {', '.join(DECISIONS)}")
    if credits < 0:
        raise LogError("--credits cannot be negative")
    production = json.loads(production_path.read_text(encoding="utf-8"))
    clip = next((c for c in production["flow_prompts"] if c["clip_id"] == clip_id), None)
    if clip is None:
        have = ", ".join(c["clip_id"] for c in production["flow_prompts"]) or "none"
        raise LogError(f"clip {clip_id} is not in this production's flow_prompts (have: {have})")

    plan_checks = {q["check_id"] for q in production["quality_checks"]}
    unknown = [k for k in scores if k not in plan_checks and k not in BY_ID]
    if unknown:
        raise LogError(f"unknown QC id(s): {', '.join(unknown)}")
    if decision in ("SELECTED", "APPROVED_FOR_DELIVERY"):
        missing = [q["check_id"] for q in production["quality_checks"] if q["clip_id"] in (clip_id, None) and q["check_id"] not in scores]
        if missing:
            raise LogError(f"{decision} needs every QC score for {clip_id}; missing {', '.join(missing)}")

    header = template_header(template)
    rows = read_log(log_path, header)
    attempt = 1 + sum(1 for r in rows if r.get("job_id") == production["job_id"] and r.get("clip_id") == clip_id)

    row = {col: "" for col in header}
    row.update(
        experiment_id=next_experiment_id(rows),
        date=date or _dt.date.today().isoformat(),
        job_id=production["job_id"],
        production_mode=production["mode"],
        character_id=production["character_id"],
        flow_model=model_id or clip["model_id"],
        generation_mode=clip["generation_mode"],
        prompt_versions=";".join(f"{k}@{v}" for k, v in production["prompt_versions"].items()),
        clip_id=clip_id,
        video_duration_seconds=f"{clip['end_seconds'] - clip['start_seconds']:g}",
        generation_attempts=str(attempt),
        credits_consumed=f"{credits:g}",
        estimated_cost="" if cost is None else f"{cost:g}",
        cost_currency=currency,
        problems_encountered=problems,
        output_file=output_file,
        final_approval_status=decision,
    )
    for key, val in scores.items():
        if key in BY_ID and BY_ID[key].csv_column in row:
            row[BY_ID[key].csv_column] = str(val)
    if scores:
        row["quality_score_avg"] = f"{sum(scores.values()) / len(scores):.2f}"

    new_file = not log_path.exists()
    log_path.parent.mkdir(parents=True, exist_ok=True)
    with open(log_path, "a", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=header)
        if new_file:
            writer.writeheader()
        writer.writerow(row)

    mins = {q["check_id"]: q["min_pass_score"] for q in production["quality_checks"]}
    failed = [f"{k}={v} (< {mins[k]})" for k, v in sorted(scores.items()) if k in mins and v < mins[k]]

    if update_production:
        for q in production["quality_checks"]:
            if q["check_id"] in scores and q["clip_id"] in (clip_id, None):
                q["score"] = scores[q["check_id"]]
        if production["status"] in ("DRAFT", "NEEDS_REVIEW", "READY_FOR_MANUAL_RENDER"):
            production["status"] = "RENDERED_PENDING_QC"
        production_path.write_text(json.dumps(production, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    return {"row": row, "attempt": attempt, "failed": failed, "log_path": log_path, "created_log": new_file}


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("production", type=Path)
    ap.add_argument("--clip", required=True, help="clip id, e.g. C01")
    ap.add_argument("--credits", type=float, required=True, help="Flow credits this attempt used")
    ap.add_argument("--scores", default=None, help="QC scores, e.g. QC01=4,QC02=5 (1–5)")
    ap.add_argument("--decision", choices=DECISIONS, default="RETRY")
    ap.add_argument("--problems", default="", help="short description of what went wrong")
    ap.add_argument("--output-file", default="", help="where you saved the download")
    ap.add_argument("--cost", type=float, default=None, help="estimated cost of this attempt")
    ap.add_argument("--currency", default="", help="e.g. IDR, USD")
    ap.add_argument("--model", default=None, help="override if you used a different model than planned")
    ap.add_argument("--date", default=None, help="YYYY-MM-DD (default today)")
    ap.add_argument("--log", type=Path, default=DEFAULT_LOG)
    ap.add_argument("--update-production", action="store_true", help="also write these scores into production.json")
    args = ap.parse_args(argv)
    try:
        if not args.production.exists():
            raise LogError(f"{args.production} not found")
        result = log_attempt(
            args.production, args.clip, credits=args.credits, scores=parse_scores(args.scores), decision=args.decision,
            problems=args.problems, output_file=args.output_file, cost=args.cost, currency=args.currency,
            model_id=args.model, date=args.date, log_path=args.log, update_production=args.update_production,
        )
    except LogError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    row = result["row"]
    if result["created_log"]:
        print(f"Created {result['log_path']}")
    print(f"Logged {row['experiment_id']}: {row['job_id']} {row['clip_id']} attempt {result['attempt']}, {row['credits_consumed']} credits, decision {row['final_approval_status']}")
    if row["quality_score_avg"]:
        print(f"Average QC score: {row['quality_score_avg']}")
    if result["failed"]:
        print("FAILED checks: " + ", ".join(result["failed"]))
    elif row["quality_score_avg"]:
        print("All scored checks meet their minimum.")
    if args.update_production:
        print(f"Updated scores in {args.production}. A named reviewer must still set status APPROVED by hand.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
