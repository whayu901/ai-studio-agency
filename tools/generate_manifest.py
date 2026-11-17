#!/usr/bin/env python3
"""Build the timestamped JSON manifest for a folder of extracted frames.

``extract_frames.py`` calls this automatically. Run it directly only to rebuild
a manifest for frames that already exist (for example after deleting a few
unhelpful frames by hand):

    python3 tools/generate_manifest.py outputs/analysis/my-ref \\
        --source assets/reference-videos/my-ref.mp4 --rights licensed

Frame timestamps are read back from the file names
(``frame_0001_00001500ms.jpg`` = frame 1 at 1.500 s), so file names must not be
renamed.
"""

from __future__ import annotations

import argparse
import datetime as _dt
import hashlib
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path
from typing import List, Optional

TOOL_VERSION = "0.1.0"
MANIFEST_VERSION = "1.0"
FRAME_NAME_RE = re.compile(r"^frame_(\d{4,})_(\d{8,})ms\.(jpg|png)$")
RIGHTS_BASES = ("owned", "licensed", "written_permission", "internal_test_only")

LIMITATIONS = [
    "Frames are samples taken at fixed intervals. Anything between two samples (fast gestures, quick cuts, motion paths) is not shown.",
    "Frames carry no sound. Dialogue, voice, music and sound effects cannot be recovered from them; use the optional audio file for a manual listen.",
    "Each frame is the picture displayed at its timestamp. Exact cut points are only known to within one sampling interval.",
    "Camera movement and character movement can only be inferred by comparing frames, never directly observed in one frame.",
    "Off-screen actions, intent and emotion are not visible and must be treated as unknown or inferred.",
]


class ToolError(Exception):
    """A user-facing error with a clear message (no traceback needed)."""


# --------------------------------------------------------------------------- helpers


def require_binary(name: str) -> str:
    path = shutil.which(name)
    if not path:
        raise ToolError(
            f"'{name}' was not found on PATH. Install FFmpeg (it includes {name}). On macOS with Homebrew: brew install ffmpeg"
        )
    return path


def ffmpeg_version() -> Optional[str]:
    exe = shutil.which("ffmpeg")
    if not exe:
        return None
    out = subprocess.run([exe, "-version"], capture_output=True, text=True).stdout
    first = out.splitlines()[0] if out else ""
    m = re.match(r"ffmpeg version (\S+)", first)
    return m.group(1) if m else first or None


def format_timecode(seconds: float) -> str:
    """12.3456 -> '00:00:12.346' (HH:MM:SS.mmm)."""
    total_ms = int(round(seconds * 1000))
    h, rem = divmod(total_ms, 3_600_000)
    m, rem = divmod(rem, 60_000)
    s, ms = divmod(rem, 1000)
    return f"{h:02d}:{m:02d}:{s:02d}.{ms:03d}"


def frame_filename(index: int, seconds: float, ext: str) -> str:
    """Zero-padded so alphabetical order == time order."""
    return f"frame_{index:04d}_{int(round(seconds * 1000)):08d}ms.{ext}"


def parse_frame_filename(name: str):
    """'frame_0003_00002000ms.jpg' -> (3, 2.0, 'jpg'); None if it does not match."""
    m = FRAME_NAME_RE.match(name)
    if not m:
        return None
    return int(m.group(1)), int(m.group(2)) / 1000.0, m.group(3)


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _parse_rate(rate: Optional[str]) -> Optional[float]:
    if not rate or rate in ("0/0", "N/A"):
        return None
    if "/" in rate:
        num, den = rate.split("/", 1)
        try:
            return round(float(num) / float(den), 3) if float(den) else None
        except ValueError:
            return None
    try:
        return float(rate)
    except ValueError:
        return None


def _rotation(stream: dict) -> int:
    for sd in stream.get("side_data_list", []) or []:
        if "rotation" in sd:
            try:
                return int(float(sd["rotation"]))
            except (TypeError, ValueError):
                pass
    tag = (stream.get("tags") or {}).get("rotate")
    try:
        return int(tag) if tag is not None else 0
    except ValueError:
        return 0


def probe_video(path: Path) -> dict:
    """Return source metadata via ffprobe. Raises ToolError for unreadable files."""
    ffprobe = require_binary("ffprobe")
    proc = subprocess.run(
        [ffprobe, "-v", "error", "-print_format", "json", "-show_format", "-show_streams", str(path)],
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        raise ToolError(f"ffprobe could not read {path}: {proc.stderr.strip() or 'unknown error'}")
    info = json.loads(proc.stdout or "{}")
    streams = info.get("streams", [])
    video = next((s for s in streams if s.get("codec_type") == "video" and not (s.get("disposition") or {}).get("attached_pic")), None)
    if video is None:
        raise ToolError(f"{path} has no video stream")
    audio = next((s for s in streams if s.get("codec_type") == "audio"), None)
    fmt = info.get("format", {})

    duration = None
    for cand in (fmt.get("duration"), video.get("duration")):
        try:
            duration = float(cand)
            if duration > 0:
                break
        except (TypeError, ValueError):
            continue
    if not duration or duration <= 0:
        raise ToolError(f"could not determine the duration of {path}")

    width, height = int(video["width"]), int(video["height"])
    rot = _rotation(video)
    disp_w, disp_h = (height, width) if abs(rot) % 180 == 90 else (width, height)
    return {
        "path": str(path),
        "filename": path.name,
        "size_bytes": path.stat().st_size,
        "sha256": sha256_file(path),
        "container": fmt.get("format_name"),
        "duration_seconds": round(duration, 3),
        "width": width,
        "height": height,
        "display_width": disp_w,
        "display_height": disp_h,
        "rotation_degrees": rot,
        "fps": _parse_rate(video.get("avg_frame_rate")) or _parse_rate(video.get("r_frame_rate")),
        "video_codec": video.get("codec_name"),
        "has_audio": audio is not None,
        "audio_codec": audio.get("codec_name") if audio else None,
    }


def display_path(path: Path, repo_root: Optional[Path] = None) -> str:
    """Repo-relative path when possible (keeps your home folder out of manifests)."""
    root = repo_root or Path(__file__).resolve().parent.parent
    try:
        return str(path.resolve().relative_to(root))
    except ValueError:
        return str(path.resolve())


# --------------------------------------------------------------------------- manifest


def build_manifest(
    source: dict,
    frames: List[dict],
    *,
    rights_basis: str,
    rights_note: Optional[str],
    interval: float,
    start: float,
    end: float,
    max_frames: int,
    fit: bool,
    planned: int,
    truncated: bool,
    image_format: str,
    max_long_edge: Optional[int],
    audio: Optional[dict],
) -> dict:
    if rights_basis not in RIGHTS_BASES:
        raise ToolError(f"rights basis must be one of {', '.join(RIGHTS_BASES)}")
    return {
        "manifest_version": MANIFEST_VERSION,
        "generated_at": _dt.datetime.now(_dt.timezone.utc).replace(microsecond=0).isoformat(),
        "tool": {"name": "ai-creative-studio/extract_frames", "version": TOOL_VERSION, "ffmpeg_version": ffmpeg_version()},
        "source": source,
        "rights": {"basis": rights_basis, "note": rights_note},
        "sampling": {
            "interval_seconds": round(interval, 6),
            "start_seconds": round(start, 3),
            "end_seconds": round(end, 3),
            "max_frames": max_frames,
            "fit_to_max_frames": fit,
            "planned_frame_count": planned,
            "extracted_frame_count": len(frames),
            "truncated": truncated,
            "image_format": image_format,
            "max_long_edge_px": max_long_edge,
        },
        "frames": frames,
        "audio": audio,
        "limitations": list(LIMITATIONS),
    }


def write_manifest(manifest: dict, out_dir: Path) -> Path:
    path = out_dir / "manifest.json"
    path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    write_index(manifest, out_dir)
    return path


def write_index(manifest: dict, out_dir: Path) -> Path:
    """A small Markdown table so a human (or Claude) can scan the frames quickly."""
    src = manifest["source"]
    s = manifest["sampling"]
    lines = [
        f"# Frames — {src['filename']}",
        "",
        f"- Duration: {src['duration_seconds']} s · {src['display_width']}x{src['display_height']} · rights: {manifest['rights']['basis']}",
        f"- Sampling: every {s['interval_seconds']} s from {s['start_seconds']} s · {s['extracted_frame_count']} frames"
        + (" · **TRUNCATED at max_frames — later footage not sampled**" if s["truncated"] else ""),
        f"- Audio for manual review: {manifest['audio']['path'] if manifest['audio'] else 'not extracted'}",
        "",
        "| # | Time | File |",
        "|---|---|---|",
    ]
    lines += [f"| {f['index']} | {f['timecode']} | {f['path']} |" for f in manifest["frames"]]
    lines += ["", "## Limitations", ""] + [f"- {x}" for x in manifest["limitations"]] + [""]
    path = out_dir / "INDEX.md"
    path.write_text("\n".join(lines), encoding="utf-8")
    return path


def frames_from_directory(frames_dir: Path, rel_to: Path) -> List[dict]:
    """Rebuild the frames list from file names, sorted by timestamp, re-indexed from 1."""
    found = []
    for f in frames_dir.iterdir():
        parsed = parse_frame_filename(f.name)
        if parsed:
            found.append((parsed[1], parsed[0], f))
    found.sort()
    return [
        {
            "index": i,
            "timestamp_seconds": t,
            "timecode": format_timecode(t),
            "path": str(f.relative_to(rel_to)),
        }
        for i, (t, _, f) in enumerate(found, start=1)
    ]


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("output_dir", type=Path, help="folder containing frames/ (manifest.json is written here)")
    ap.add_argument("--source", type=Path, required=True, help="the original video file")
    ap.add_argument("--rights", required=True, choices=RIGHTS_BASES, help="your basis for using this video")
    ap.add_argument("--rights-note", default=None)
    ap.add_argument("--interval", type=float, default=None, help="sampling interval used (default: inferred from frames)")
    args = ap.parse_args(argv)
    try:
        frames_dir = args.output_dir / "frames"
        if not frames_dir.is_dir():
            raise ToolError(f"{frames_dir} does not exist")
        frames = frames_from_directory(frames_dir, args.output_dir)
        if not frames:
            raise ToolError(f"no frame_XXXX_XXXXXXXXms.(jpg|png) files in {frames_dir}")
        source = probe_video(args.source)
        source["path"] = display_path(args.source)
        interval = args.interval
        if interval is None:
            interval = frames[1]["timestamp_seconds"] - frames[0]["timestamp_seconds"] if len(frames) > 1 else 1.0
        ext = Path(frames[0]["path"]).suffix.lstrip(".")
        audio_file = next((p for p in args.output_dir.glob("audio.*")), None)
        manifest = build_manifest(
            source,
            frames,
            rights_basis=args.rights,
            rights_note=args.rights_note,
            interval=interval,
            start=frames[0]["timestamp_seconds"],
            end=source["duration_seconds"],
            max_frames=len(frames),
            fit=False,
            planned=len(frames),
            truncated=False,
            image_format=ext,
            max_long_edge=None,
            audio={"path": audio_file.name, "format": audio_file.suffix.lstrip("."), "purpose": "manual_review_only"} if audio_file else None,
        )
        path = write_manifest(manifest, args.output_dir)
    except ToolError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    print(f"Wrote {path} ({len(frames)} frames)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
