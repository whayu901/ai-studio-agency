#!/usr/bin/env python3
"""JSON bridge between the web app and the existing Python rules. One command per call.

The web API runs this as a subprocess so the business rules (character mixing, claims,
render readiness, approval blockers) live in exactly one place: the Python tools.

    python3 tools/service.py characters
    python3 tools/service.py configs
    python3 tools/service.py brief <brief.json>
    python3 tools/service.py production <production.json> [--check-ready]
    python3 tools/service.py render-sheet <production.json> --output <file.md> [--allow-not-ready]
    python3 tools/service.py probe <video>
    python3 tools/service.py contact-sheet <video> --out <file.jpg> [--every 0.5]
    python3 tools/service.py extract-frames <video> --rights <basis> --out-dir <dir> [--interval 1] [--max-frames 60]
    python3 tools/service.py analysis <analysis.json>
    python3 tools/service.py manifest <manifest.json>
    python3 tools/service.py frame <video> --out <file.png> [--at 0]
    python3 tools/service.py assemble <production.json> --output <edit.mp4> --take C01=<render.mp4> ...
    python3 tools/service.py approval-blockers <production.json>
    python3 tools/service.py zip <out.zip> <base_dir> <rel_path> [<rel_path> ...]

Every command prints one JSON object on stdout: {"ok": true, ...} or {"ok": false, "error": "..."}.
Paths must be inside the repository (or the app's data folder given by $ACS_DATA_DIR); anything
else is refused. Nothing here calls a network service.
"""

from __future__ import annotations

import argparse
import contextlib
import io
import json
import os
import sys
import zipfile
from pathlib import Path
from typing import List, Optional

import validate

ROOT = validate.REPO_ROOT


class ServiceError(Exception):
    pass


def _allowed_roots() -> List[Path]:
    roots = [ROOT.resolve()]
    extra = os.environ.get("ACS_DATA_DIR")
    if extra:
        roots.append(Path(extra).resolve())
    return roots


def safe_path(text: str, must_exist: bool = True) -> Path:
    """Resolve a path and refuse anything outside the repo / data dir (no traversal, no symlink escape)."""
    p = Path(text)
    p = (p if p.is_absolute() else ROOT / p).resolve()
    if not any(p == r or r in p.parents for r in _allowed_roots()):
        raise ServiceError(f"path is outside the project: {text}")
    if must_exist and not p.exists():
        raise ServiceError(f"not found: {text}")
    return p


def report_json(rep: "validate.Report") -> dict:
    return {"valid": rep.ok, "errors": rep.errors, "warnings": rep.warnings}


def cmd_characters(_args) -> dict:
    profiles, rep = validate.load_characters(ROOT)
    return {"characters": profiles, "report": report_json(rep)}


def cmd_configs(_args) -> dict:
    flow, frep = validate.load_flow_config(ROOT)
    sd, srep = validate.load_seedance_config(ROOT)
    return {"google_flow": flow, "google_flow_report": report_json(frep), "seedance": sd, "seedance_report": report_json(srep)}


def cmd_brief(args) -> dict:
    brief, rep = validate.check_brief(safe_path(args.file), ROOT)
    return {"brief": brief, "report": report_json(rep)}


def cmd_production(args) -> dict:
    path = safe_path(args.file)
    rep = validate.check_production(path, check_ready=args.check_ready, root=ROOT)
    return {"report": report_json(rep)}


def cmd_render_sheet(args) -> dict:
    import render_sheet

    path = safe_path(args.file)
    out = safe_path(args.output, must_exist=False)
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf), contextlib.redirect_stderr(buf):
        code = render_sheet.make_sheet(path, out, args.allow_not_ready, root=ROOT)
    return {"exit_code": code, "written": code == 0 and out.exists(), "output": str(out), "log": buf.getvalue()}


def cmd_probe(args) -> dict:
    from generate_manifest import probe_video

    return {"info": probe_video(safe_path(args.file))}


def cmd_contact_sheet(args) -> dict:
    from generate_manifest import probe_video
    from postprod import find_font
    from review_render import make_contact_sheet

    src = safe_path(args.file)
    out = safe_path(args.out, must_exist=False)
    out.parent.mkdir(parents=True, exist_ok=True)
    info = probe_video(src)
    tiles = make_contact_sheet(src, out, args.every, info["duration_seconds"], find_font())
    return {"output": str(out), "tiles": tiles}


def cmd_extract_frames(args) -> dict:
    import extract_frames

    src = safe_path(args.file)
    out_dir = safe_path(args.out_dir, must_exist=False)
    argv = [str(src), "--rights", args.rights, "--output", str(out_dir), "--interval", str(args.interval),
            "--max-frames", str(args.max_frames), "--fit", "--overwrite"]
    if args.rights_note:
        argv += ["--rights-note", args.rights_note]
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf), contextlib.redirect_stderr(buf):
        code = extract_frames.main(argv)
    if code != 0:
        raise ServiceError(buf.getvalue().strip() or f"extract_frames exited {code}")
    manifest = out_dir / "manifest.json"
    return {"manifest": str(manifest), "log": buf.getvalue()}


def cmd_analysis(args) -> dict:
    return {"report": report_json(validate.check_analysis(safe_path(args.file), ROOT))}


def cmd_manifest(args) -> dict:
    return {"report": report_json(validate.check_manifest(safe_path(args.file), ROOT))}


def cmd_frame(args) -> dict:
    """One still frame (PNG) at --at seconds, e.g. the first frame a reviewer checks."""
    from postprod import run_ffmpeg

    src = safe_path(args.file)
    out = safe_path(args.out, must_exist=False)
    out.parent.mkdir(parents=True, exist_ok=True)
    run_ffmpeg(["-ss", f"{max(0.0, args.at):.3f}", "-i", str(src), "-frames:v", "1", "-update", "1", "-y", str(out)])
    return {"output": str(out)}


def cmd_assemble(args) -> dict:
    """Run tools/assemble.py on the chosen takes. Seedance plans are mapped onto the clip list it expects."""
    import assemble

    prod_path = safe_path(args.file)
    out = safe_path(args.output, must_exist=False)
    p = json.loads(prod_path.read_text(encoding="utf-8"))
    tmp = None
    if not p.get("flow_prompts") and p.get("seedance_prompts"):
        p["flow_prompts"] = [
            {"clip_id": c["clip_id"], "start_seconds": c["start_seconds"], "end_seconds": c["end_seconds"], "model_id": c["model_id"],
             "generation_mode": "ingredients_to_video", "ingredients": [], "prompt": c["prompt"], "dialogue": c.get("dialogue")}
            for c in p["seedance_prompts"]
        ]
        tmp = prod_path.parent / ".assemble-production.json"
        tmp.write_text(json.dumps(p), encoding="utf-8")
    argv = [str(tmp or prod_path), "--output", str(out)]
    for take in args.take:
        clip, _, rel = take.partition("=")
        argv += ["--take", f"{clip}={safe_path(rel)}"]
    buf = io.StringIO()
    try:
        with contextlib.redirect_stdout(buf), contextlib.redirect_stderr(buf):
            code = assemble.main(argv)
    finally:
        if tmp is not None:
            tmp.unlink(missing_ok=True)
    if code != 0 or not out.exists():
        raise ServiceError(buf.getvalue().strip() or f"assemble exited {code}")
    return {"output": str(out), "log": buf.getvalue()}


def cmd_approval_blockers(args) -> dict:
    import approve

    return {"blockers": approve.approval_blockers(safe_path(args.file), ROOT)}


def cmd_zip(args) -> dict:
    """Zip files under base_dir. Each entry must stay inside base_dir; secrets are refused."""
    base = safe_path(args.base)
    out = safe_path(args.out, must_exist=False)
    out.parent.mkdir(parents=True, exist_ok=True)
    refused = (".env", ".pem", ".key")
    entries = []
    with zipfile.ZipFile(out, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for rel in args.paths:
            src = (base / rel).resolve()
            if base not in src.parents:
                raise ServiceError(f"zip entry escapes the package folder: {rel}")
            if src.name.startswith(".env") or src.suffix in refused or "secret" in src.name.lower():
                raise ServiceError(f"refusing to package a secret-looking file: {rel}")
            if not src.is_file():
                raise ServiceError(f"zip entry not found: {rel}")
            arc = src.relative_to(base).as_posix()
            zf.write(src, arc)
            entries.append(arc)
    return {"output": str(out), "entries": entries, "bytes": out.stat().st_size}


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("characters").set_defaults(fn=cmd_characters)
    sub.add_parser("configs").set_defaults(fn=cmd_configs)
    sp = sub.add_parser("brief"); sp.add_argument("file"); sp.set_defaults(fn=cmd_brief)
    sp = sub.add_parser("production"); sp.add_argument("file"); sp.add_argument("--check-ready", action="store_true"); sp.set_defaults(fn=cmd_production)
    sp = sub.add_parser("render-sheet"); sp.add_argument("file"); sp.add_argument("--output", required=True)
    sp.add_argument("--allow-not-ready", action="store_true"); sp.set_defaults(fn=cmd_render_sheet)
    sp = sub.add_parser("probe"); sp.add_argument("file"); sp.set_defaults(fn=cmd_probe)
    sp = sub.add_parser("contact-sheet"); sp.add_argument("file"); sp.add_argument("--out", required=True)
    sp.add_argument("--every", type=float, default=0.5); sp.set_defaults(fn=cmd_contact_sheet)
    sp = sub.add_parser("extract-frames"); sp.add_argument("file"); sp.add_argument("--rights", required=True)
    sp.add_argument("--rights-note", default=""); sp.add_argument("--out-dir", required=True)
    sp.add_argument("--interval", type=float, default=1.0); sp.add_argument("--max-frames", type=int, default=60)
    sp.set_defaults(fn=cmd_extract_frames)
    sp = sub.add_parser("analysis"); sp.add_argument("file"); sp.set_defaults(fn=cmd_analysis)
    sp = sub.add_parser("manifest"); sp.add_argument("file"); sp.set_defaults(fn=cmd_manifest)
    sp = sub.add_parser("frame"); sp.add_argument("file"); sp.add_argument("--out", required=True)
    sp.add_argument("--at", type=float, default=0.0); sp.set_defaults(fn=cmd_frame)
    sp = sub.add_parser("assemble"); sp.add_argument("file"); sp.add_argument("--output", required=True)
    sp.add_argument("--take", action="append", default=[]); sp.set_defaults(fn=cmd_assemble)
    sp = sub.add_parser("approval-blockers"); sp.add_argument("file"); sp.set_defaults(fn=cmd_approval_blockers)
    sp = sub.add_parser("zip"); sp.add_argument("out"); sp.add_argument("base"); sp.add_argument("paths", nargs="+"); sp.set_defaults(fn=cmd_zip)
    return ap


def main(argv: Optional[List[str]] = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        result = args.fn(args)
        print(json.dumps({"ok": True, **result}, ensure_ascii=False, default=str))
        return 0
    except Exception as exc:  # report every failure as JSON; the API decides what to show
        msg = str(exc).replace(str(ROOT) + os.sep, "")
        print(json.dumps({"ok": False, "error": msg or exc.__class__.__name__}, ensure_ascii=False))
        return 1


if __name__ == "__main__":
    sys.exit(main())
