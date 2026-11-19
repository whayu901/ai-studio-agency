#!/usr/bin/env python3
"""Check a clip you downloaded from Google Flow and make a QC contact sheet for it.

    python3 tools/review_render.py outputs/<job>/production.json --clip C01 \\
        --file outputs/<job>/renders/C01_a01.mp4

Writes next to the render:
    C01_a01_contact.jpg   frames every --every seconds (default 0.5), with timestamps
    C01_a01_last.png      the last frame (start frame for a clip that continues this one)
    C01_a01_review.md     technical checks, the planned beats and the QC checklist

It checks only what can be measured (length, aspect ratio, audio track). It does not score the
clip. Watch it in full, score QC01–QC10 yourself, then run log_attempt.py.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
import tempfile
from pathlib import Path
from typing import List, Optional

from generate_manifest import ToolError, format_timecode, probe_video
from postprod import DURATION_TOLERANCE, aspect_matches, find_font, run_ffmpeg, stage_font

TILE_WIDTH = 240
COLUMNS = 4
MAX_TILES = 48


def technical_checks(info: dict, clip: dict, aspect: str) -> List[str]:
    """Return problems a human should know about before scoring (empty = all fine)."""
    issues = []
    planned = round(clip["end_seconds"] - clip["start_seconds"], 3)
    actual = info["duration_seconds"]
    if actual < planned - DURATION_TOLERANCE:
        issues.append(f"clip is {actual:g}s but the plan needs {planned:g}s — assemble.py will hold the last frame to fill the gap")
    elif actual > planned + DURATION_TOLERANCE:
        issues.append(f"clip is {actual:g}s but the plan needs {planned:g}s — assemble.py will trim the end")
    w, h = info["display_width"], info["display_height"]
    if not aspect_matches(w, h, aspect):
        issues.append(f"frame is {w}x{h}, which is not {aspect} — check the aspect ratio setting in Flow")
    if clip.get("dialogue") and not info["has_audio"]:
        issues.append("clip has planned dialogue but no audio track — use a voice-over (assemble.py --voiceover)")
    return issues


def make_contact_sheet(src: Path, out: Path, every: float, duration: float, font: Path) -> int:
    count = min(MAX_TILES, max(1, math.ceil(duration / every)))
    rows = math.ceil(count / COLUMNS)
    with tempfile.TemporaryDirectory() as tmp:
        fontfile = stage_font(font, Path(tmp))
        vf = (
            f"fps=1/{every},scale={TILE_WIDTH}:-2,"
            f"drawtext=fontfile={fontfile}:text='%{{pts\\:hms}}':x=6:y=6:fontsize=16:fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=4,"
            f"tile={COLUMNS}x{rows}:padding=4:color=white"
        )
        run_ffmpeg(["-i", str(src), "-vf", vf, "-frames:v", "1", "-q:v", "3", "-update", "1", "-y", str(out)])
    return count


def export_last_frame(src: Path, out: Path) -> None:
    # Decode only the final half second; each frame overwrites the file, so the last one stays.
    run_ffmpeg(["-sseof", "-0.5", "-i", str(src), "-an", "-update", "1", "-y", str(out)])


def review_markdown(production: dict, clip: dict, render: Path, info: dict, issues: List[str], contact: str,
                    last_frame: Optional[str]) -> str:
    cid = clip["clip_id"]
    start = clip["start_seconds"]
    lines = [
        f"# Review: {render.name} ({production['job_id']} {cid})",
        "",
        "Measured with ffprobe. **Nothing here is a quality score.** Watch the clip in full and score it yourself.",
        "",
        f"- Length: {info['duration_seconds']:g} s (planned {clip['end_seconds'] - start:g} s)",
        f"- Frame: {info['display_width']}x{info['display_height']} (plan {production['aspect_ratio']}), {info['fps'] or '?'} fps, {info['video_codec']}",
        f"- Audio track: {'yes (' + str(info['audio_codec']) + ')' if info['has_audio'] else 'no'}",
        f"- Contact sheet: `{contact}`",
    ]
    if last_frame:
        lines.append(f"- Last frame: `{last_frame}` (use as start_frame if the next clip continues this one)")
    lines.append("")
    lines += ["## Technical checks", ""]
    lines += [f"- ⚠️ {i}" for i in issues] if issues else ["- ✅ length, aspect ratio and audio match the plan"]
    lines += ["", "## Planned beats (times inside this clip)", "", "| Shot | Time | Action | Dialogue |", "|---|---|---|---|"]
    for s in production["storyboard"]:
        if s["clip_id"] != cid:
            continue
        t = f"{s['start_seconds'] - start:g}–{s['end_seconds'] - start:g} s"
        lines.append(f"| {s['shot_id']} | {t} | {s['action']} | {s['dialogue'] or '—'} |")
    lines += ["", "## Score it (1–5)", ""]
    for q in production["quality_checks"]:
        if q["clip_id"] in (cid, None):
            note = f" — {q['notes']}" if q["notes"] else ""
            lines.append(f"- [ ] {q['check_id']} {q['dimension']} (pass ≥ {q['min_pass_score']}){note}")
    lines += [
        "",
        "## Then log it",
        "",
        "```",
        f"python3 tools/log_attempt.py outputs/{production['job_id']}/production.json --clip {cid} --credits <N> \\",
        f"    --scores QC01=<1-5>,QC02=<1-5>,... --decision RETRY --output-file {render.as_posix()}",
        "```",
        "",
        "Use `--decision SELECTED --update-production` for the take you keep.",
        "",
    ]
    return "\n".join(lines)


def review(production_path: Path, clip_id: str, render: Path, every: float = 0.5, last_frame: bool = True,
           font: Optional[str] = None) -> dict:
    if every <= 0:
        raise ToolError("--every must be greater than 0")
    if not production_path.exists():
        raise ToolError(f"{production_path} not found")
    if not render.exists():
        raise ToolError(f"render {render} not found")
    production = json.loads(production_path.read_text(encoding="utf-8"))
    clip = next((c for c in production["flow_prompts"] if c["clip_id"] == clip_id), None)
    if clip is None:
        raise ToolError(f"clip {clip_id} is not in this production's flow_prompts")

    info = probe_video(render)
    issues = technical_checks(info, clip, production["aspect_ratio"])
    stem = render.with_suffix("")
    contact = Path(f"{stem}_contact.jpg")
    tiles = make_contact_sheet(render, contact, every, info["duration_seconds"], find_font(font))
    last = None
    if last_frame:
        last = Path(f"{stem}_last.png")
        export_last_frame(render, last)
    report = Path(f"{stem}_review.md")
    report.write_text(review_markdown(production, clip, render, info, issues, contact.name, last.name if last else None), encoding="utf-8")
    return {"info": info, "issues": issues, "contact": contact, "tiles": tiles, "last_frame": last, "report": report}


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("production", type=Path)
    ap.add_argument("--clip", required=True, help="clip id, e.g. C01")
    ap.add_argument("--file", type=Path, required=True, help="the clip you downloaded from Flow")
    ap.add_argument("--every", type=float, default=0.5, help="seconds between contact-sheet frames (default 0.5)")
    ap.add_argument("--no-last-frame", action="store_true", help="skip exporting the last frame")
    ap.add_argument("--font", default=None, help="font file for the timestamps (default: a system font)")
    args = ap.parse_args(argv)
    try:
        r = review(args.production, args.clip, args.file, args.every, not args.no_last_frame, args.font)
    except ToolError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    info = r["info"]
    print(f"Render:  {args.file} ({info['duration_seconds']:g}s, {info['display_width']}x{info['display_height']}, audio: {'yes' if info['has_audio'] else 'no'})")
    for issue in r["issues"]:
        print(f"WARNING: {issue}")
    if not r["issues"]:
        print("Checks:  length, aspect ratio and audio match the plan")
    print(f"Contact: {r['contact']} ({r['tiles']} frames, every {args.every:g}s from {format_timecode(0)})")
    if r["last_frame"]:
        print(f"Last:    {r['last_frame']}")
    print(f"Review:  {r['report']}")
    print("Nothing was scored. Watch the clip, score QC01–QC10, then run log_attempt.py.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
