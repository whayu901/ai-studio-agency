#!/usr/bin/env python3
"""Put an APPROVED production's final video and captions into one delivery folder.

    python3 tools/package_delivery.py outputs/<job>/production.json \\
        --video outputs/<job>/edit/<job>_v01.mp4 --caption outputs/<job>/caption.json

Refuses unless the production is APPROVED by a named reviewer, the brief is real (not sample)
data, every asset has real rights, the character's commercial use is authorized, the captions
validate (claims, disclosure) and the video matches the planned length and aspect ratio.

Writes outputs/<job>/delivery/:
    <job>_final.mp4          copy of the approved edit
    caption_<platform>.txt   ready to paste (text, hashtags, disclosure, AI note)
    DELIVERY.md              what was approved, by whom, checksums and a posting checklist

It never uploads or posts anything. A person posts by hand.
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import sys
from pathlib import Path
from typing import List, Optional

import validate
from approve import BLOCKED_RIGHTS
from generate_manifest import ToolError, probe_video
from postprod import DURATION_TOLERANCE, aspect_matches


class DeliveryError(Exception):
    pass


def delivery_blockers(production_path: Path, video: Path, caption: Optional[Path], root: Path) -> List[str]:
    blockers: List[str] = []
    rep = validate.check_production(production_path, root=root)
    blockers += rep.errors
    p = json.loads(production_path.read_text(encoding="utf-8"))
    if p["status"] != "APPROVED":
        blockers.append(f"status is {p['status']!r}; a person must approve it first (python3 tools/approve.py … --reviewer \"Name\")")
    for a in p["reference_assets"]:
        if a["rights_basis"] in BLOCKED_RIGHTS:
            blockers.append(f"asset {a['path']} has rights_basis {a['rights_basis']!r}")
    brief_path = root / p["brief"]
    if brief_path.exists() and json.loads(brief_path.read_text(encoding="utf-8"))["is_sample"]:
        blockers.append("the brief is sample data; sample productions are never delivered")
    characters, _ = validate.load_characters(root)
    ch = characters.get(p["character_id"])
    if ch is not None:
        cu = ch["commercial_use"]
        if ch["status"] != "active" or not cu["authorized"]:
            blockers.append(f"character {p['character_id']!r} is not active with authorized commercial use")

    if caption is None:
        blockers.append("no --caption: captions carry the affiliate/AI disclosure and are required (prompts/caption.md)")
    elif not caption.exists():
        blockers.append(f"caption {caption} not found")
    else:
        crep = validate.check_caption(caption, production_path, root)
        blockers += [f"caption: {e}" for e in crep.errors]

    if not video.exists():
        blockers.append(f"video {video} not found")
    else:
        try:
            info = probe_video(video)
        except ToolError as exc:
            blockers.append(str(exc))
        else:
            if not aspect_matches(info["display_width"], info["display_height"], p["aspect_ratio"]):
                blockers.append(f"video is {info['display_width']}x{info['display_height']}, not {p['aspect_ratio']}")
            if abs(info["duration_seconds"] - p["duration_seconds"]) > DURATION_TOLERANCE:
                blockers.append(f"video is {info['duration_seconds']:g}s; the plan is {p['duration_seconds']:g}s")
    return blockers


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-") or "platform"


def caption_text(item: dict, ai_disclosure: str) -> str:
    parts = [item["text"].strip(), "", item["disclosure"].strip(), ai_disclosure.strip()]
    if item["hashtags"]:
        parts += ["", " ".join(item["hashtags"])]
    return "\n".join(parts).strip() + "\n"


def package(production_path: Path, video: Path, caption: Optional[Path], overwrite: bool = False,
            root: Path = validate.REPO_ROOT) -> dict:
    if not production_path.exists():
        raise DeliveryError(f"{production_path} not found")
    blockers = delivery_blockers(production_path, video, caption, root)
    if blockers:
        raise DeliveryError("not deliverable yet:\n  - " + "\n  - ".join(blockers))
    p = json.loads(production_path.read_text(encoding="utf-8"))
    cap = json.loads(caption.read_text(encoding="utf-8"))  # type: ignore[union-attr]
    out = production_path.parent / "delivery"
    if out.exists() and any(out.iterdir()):
        if not overwrite:
            raise DeliveryError(f"{out} already has files; use --overwrite to replace them")
        shutil.rmtree(out)
    out.mkdir(parents=True, exist_ok=True)

    final = out / f"{p['job_id']}_final.mp4"
    shutil.copyfile(video, final)
    info = probe_video(final)
    caption_files = []
    for item in cap["captions"]:
        f = out / f"caption_{_slug(item['platform'])}.txt"
        f.write_text(caption_text(item, cap["ai_disclosure"]), encoding="utf-8")
        caption_files.append(f)

    record = video.with_suffix(".json")
    edit = json.loads(record.read_text(encoding="utf-8")) if record.exists() else None
    hr = p["human_review"]
    lines = [
        f"# Delivery: {p['job_id']}",
        "",
        "Prepared locally. **Nothing has been uploaded or posted.** Post each platform by hand.",
        "",
        f"- Approved by **{hr['reviewer']}** on {hr['approved_on']}" + (f" — {hr['notes']}" if hr["notes"] else ""),
        f"- Character: `{p['character_id']}` · Brief: `{p['brief']}`",
        f"- Video: `{final.name}` · {info['duration_seconds']:g} s · {info['display_width']}x{info['display_height']} · sha256 `{info['sha256']}`",
        f"- Source edit: `{video.name}`" + (f" (assembled {edit['created']}, AI label: {edit['ai_label'] or 'none burned in'})" if edit else " (no edit record found)"),
        f"- Prompt versions: {', '.join(f'{k}@{v}' for k, v in p['prompt_versions'].items())}",
        "",
        "## Claims in the video and captions",
        "",
    ]
    claims = sorted(set(p["claims_used"]) | set(cap["claims_used"]))
    lines += [f"- {c}" for c in claims] or ["- (none)"]
    lines += ["", "## QC scores", "", "| Check | Clip | Score | Min |", "|---|---|---|---|"]
    lines += [f"| {q['check_id']} {q['dimension']} | {q['clip_id'] or 'all'} | {q['score']} | {q['min_pass_score']} |" for q in p["quality_checks"]]
    lines += ["", "## Captions", ""] + [f"- `{f.name}`" for f in caption_files]
    lines += [
        "",
        "## Before you post (by hand)",
        "",
        "- [ ] Watch the final video once more, with sound",
        "- [ ] Switch on the platform's own AI-generated / synthetic-content label",
        "- [ ] Keep the paid / affiliate disclosure in the caption",
        "- [ ] Use the affiliate link exactly as the programme gives it",
        "- [ ] Do not add claims, prices or promises that are not in this package",
        "",
    ]
    (out / "DELIVERY.md").write_text("\n".join(lines), encoding="utf-8")
    return {"dir": out, "video": final, "captions": caption_files, "info": info}


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("production", type=Path)
    ap.add_argument("--video", type=Path, required=True, help="the assembled edit (outputs/<job>/edit/<job>_vNN.mp4)")
    ap.add_argument("--caption", type=Path, default=None, help="outputs/<job>/caption.json")
    ap.add_argument("--overwrite", action="store_true", help="replace an existing delivery folder")
    args = ap.parse_args(argv)
    try:
        r = package(args.production, args.video, args.caption, args.overwrite)
    except DeliveryError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    print(f"Delivery folder: {r['dir']}")
    print(f"  {r['video'].name}  ({r['info']['duration_seconds']:g}s)")
    for f in r["captions"]:
        print(f"  {f.name}")
    print("  DELIVERY.md")
    print("Nothing was uploaded or posted. Post by hand and switch on the platform's AI label.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
