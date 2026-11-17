#!/usr/bin/env python3
"""Extract timestamped frames from an AUTHORIZED local reference video (MP4/MOV).

Examples (run from the repo root):
    # 1 frame per second (default), at most 120 frames
    python3 tools/extract_frames.py assets/reference-videos/ref01.mp4 --rights licensed

    # one frame every 0.5 s, also export the audio track for a manual listen
    python3 tools/extract_frames.py assets/reference-videos/ref01.mov --rights owned \\
        --interval 0.5 --extract-audio

    # long video: spread 60 frames evenly over the whole clip instead of cutting off
    python3 tools/extract_frames.py ref.mp4 --rights written_permission --max-frames 60 --fit

Output (default: outputs/analysis/<video name>/):
    frames/frame_0001_00000000ms.jpg ...   frame number + timestamp in the name
    manifest.json                          timestamps, source metadata, frame paths
    INDEX.md                               human-readable table of the same
    audio.wav                              only with --extract-audio

This tool never downloads anything. It only reads a file already on your disk.
Sampled frames cannot reproduce exact motion or the original audio.
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path
from typing import List, Optional

from generate_manifest import (
    RIGHTS_BASES,
    ToolError,
    build_manifest,
    display_path,
    format_timecode,
    frame_filename,
    parse_frame_filename,
    probe_video,
    require_binary,
    write_manifest,
)

REPO_ROOT = Path(__file__).resolve().parent.parent
ALLOWED_EXTENSIONS = {".mp4", ".mov"}
DEFAULT_INTERVAL = 1.0
DEFAULT_MAX_FRAMES = 120
DEFAULT_MAX_LONG_EDGE = 1280


def plan_timestamps(start: float, end: float, interval: float, guard: float) -> List[float]:
    """Sample times start, start+interval, ... strictly before ``end - guard``."""
    if interval <= 0:
        raise ToolError("--interval must be greater than 0")
    times = []
    i = 0
    while True:
        t = round(start + i * interval, 6)
        if t >= end - guard:
            break
        times.append(t)
        i += 1
    return times


def check_input(path_arg: str) -> Path:
    if "://" in path_arg or path_arg.lower().startswith(("www.", "youtube.", "tiktok.", "instagram.")):
        raise ToolError("URLs are not accepted. This tool never downloads videos. Save an authorized copy into assets/reference-videos/ first.")
    path = Path(path_arg).expanduser()
    if not path.exists():
        raise ToolError(f"file not found: {path}")
    if not path.is_file():
        raise ToolError(f"not a file: {path}")
    if path.suffix.lower() not in ALLOWED_EXTENSIONS:
        raise ToolError(f"unsupported file type {path.suffix!r}; use .mp4 or .mov")
    return path


def prepare_output_dir(out_dir: Path, overwrite: bool) -> Path:
    frames_dir = out_dir / "frames"
    existing = list(out_dir.iterdir()) if out_dir.exists() else []
    if existing and not overwrite:
        raise ToolError(f"{out_dir} already has files. Use --overwrite to replace a previous extraction, or --output to pick another folder.")
    if overwrite and frames_dir.exists():
        # Remove only files this tool creates; leave anything else (e.g. your notes) alone.
        for f in frames_dir.iterdir():
            if parse_frame_filename(f.name):
                f.unlink()
        for name in ("manifest.json", "INDEX.md", "audio.wav"):
            if (out_dir / name).exists():
                (out_dir / name).unlink()
    frames_dir.mkdir(parents=True, exist_ok=True)
    return frames_dir


def extract_one(ffmpeg: str, src: Path, t: float, out: Path, max_long_edge: Optional[int], fmt: str) -> bool:
    cmd = [ffmpeg, "-hide_banner", "-loglevel", "error", "-nostdin", "-ss", f"{t:.3f}", "-i", str(src), "-frames:v", "1", "-an"]
    if max_long_edge:
        cmd += [
            "-vf",
            f"scale=w='min(iw,{max_long_edge})':h='min(ih,{max_long_edge})':force_original_aspect_ratio=decrease:force_divisible_by=2",
        ]
    if fmt == "jpg":
        cmd += ["-q:v", "2"]
    cmd += ["-update", "1", "-y", str(out)]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    return proc.returncode == 0 and out.exists() and out.stat().st_size > 0


def extract_audio(ffmpeg: str, src: Path, out: Path) -> bool:
    cmd = [ffmpeg, "-hide_banner", "-loglevel", "error", "-nostdin", "-i", str(src), "-map", "0:a:0", "-vn", "-c:a", "pcm_s16le", "-y", str(out)]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    return proc.returncode == 0 and out.exists()


def run(args: argparse.Namespace) -> Path:
    src = check_input(args.video)
    ffmpeg = require_binary("ffmpeg")
    source = probe_video(src)
    source["path"] = display_path(src, REPO_ROOT)
    duration = source["duration_seconds"]

    if args.max_frames < 1:
        raise ToolError("--max-frames must be at least 1")
    if args.start < 0 or args.start >= duration:
        raise ToolError(f"--start must be between 0 and the video duration ({duration}s)")
    end = min(args.end, duration) if args.end is not None else duration
    if end <= args.start:
        raise ToolError("--end must be after --start")

    # Don't ask for a frame in the last half-frame of the video: it may not exist.
    guard = 0.5 / source["fps"] if source["fps"] else 0.02
    interval = args.interval
    times = plan_timestamps(args.start, end, interval, guard)
    planned = len(times)
    truncated = False
    if planned > args.max_frames:
        if args.fit:
            interval = (end - args.start) / args.max_frames
            times = plan_timestamps(args.start, end, interval, guard)[: args.max_frames]
            planned = len(times)
        else:
            times = times[: args.max_frames]
            truncated = True

    out_dir = (args.output or (REPO_ROOT / "outputs" / "analysis" / src.stem)).expanduser()
    frames_dir = prepare_output_dir(out_dir, args.overwrite)

    frames = []
    skipped = []
    for t in times:
        idx = len(frames) + 1
        name = frame_filename(idx, t, args.format)
        if extract_one(ffmpeg, src, t, frames_dir / name, args.max_long_edge, args.format):
            frames.append({"index": idx, "timestamp_seconds": round(t, 3), "timecode": format_timecode(t), "path": f"frames/{name}"})
        else:
            skipped.append(t)
    if not frames:
        raise ToolError("FFmpeg did not produce any frames. Is the file a playable video?")

    audio = None
    if args.extract_audio:
        if not source["has_audio"]:
            print("note: the video has no audio track; nothing to extract.")
        elif extract_audio(ffmpeg, src, out_dir / "audio.wav"):
            audio = {"path": "audio.wav", "format": "wav", "purpose": "manual_review_only"}
        else:
            print("warning: audio extraction failed; continuing without audio.", file=sys.stderr)

    manifest = build_manifest(
        source,
        frames,
        rights_basis=args.rights,
        rights_note=args.rights_note,
        interval=interval,
        start=args.start,
        end=end,
        max_frames=args.max_frames,
        fit=args.fit,
        planned=planned,
        truncated=truncated,
        image_format=args.format,
        max_long_edge=args.max_long_edge,
        audio=audio,
    )
    path = write_manifest(manifest, out_dir)

    print(f"Source:   {source['path']} ({duration}s, {source['display_width']}x{source['display_height']}, audio: {'yes' if source['has_audio'] else 'no'})")
    print(f"Sampled:  {len(frames)} frame(s), every {interval:g}s from {args.start:g}s")
    if truncated:
        last = frames[-1]["timecode"]
        print(f"WARNING:  stopped at --max-frames {args.max_frames}; nothing after {last} was sampled. Use --fit or a larger --interval to cover the whole video.")
    if skipped:
        print(f"WARNING:  FFmpeg returned no image at {', '.join(f'{t:g}s' for t in skipped)} (skipped).")
    if audio:
        print(f"Audio:    {out_dir / 'audio.wav'} (for manual review only)")
    print(f"Manifest: {path}")
    print("Reminder: sampled frames do not show motion between samples or any audio. Treat those as unknown.")
    return path


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("video", help="path to a local .mp4 or .mov you are authorized to use")
    ap.add_argument(
        "--rights",
        required=True,
        choices=RIGHTS_BASES,
        help="why you may use this video: owned, licensed, written_permission, or internal_test_only",
    )
    ap.add_argument("--rights-note", default=None, help="e.g. licence ID or who gave permission (stored in the manifest)")
    ap.add_argument("--interval", type=float, default=DEFAULT_INTERVAL, help="seconds between frames (default 1.0)")
    ap.add_argument("--max-frames", type=int, default=DEFAULT_MAX_FRAMES, help=f"upper limit on frames (default {DEFAULT_MAX_FRAMES})")
    ap.add_argument("--fit", action="store_true", help="if the limit would be hit, widen the interval to cover the whole video")
    ap.add_argument("--start", type=float, default=0.0, help="first sample time in seconds (default 0)")
    ap.add_argument("--end", type=float, default=None, help="stop sampling at this time (default: end of video)")
    ap.add_argument("--format", choices=("jpg", "png"), default="jpg")
    ap.add_argument(
        "--max-long-edge",
        type=int,
        default=DEFAULT_MAX_LONG_EDGE,
        help=f"downscale so the longer side is at most this many px (default {DEFAULT_MAX_LONG_EDGE}; 0 = keep original)",
    )
    ap.add_argument("--extract-audio", action="store_true", help="also save audio.wav for a manual listen")
    ap.add_argument("--output", type=Path, default=None, help="output folder (default outputs/analysis/<video name>)")
    ap.add_argument("--overwrite", action="store_true", help="replace a previous extraction in the output folder")
    return ap


def main(argv: Optional[List[str]] = None) -> int:
    args = build_parser().parse_args(argv)
    if args.max_long_edge == 0:
        args.max_long_edge = None
    try:
        run(args)
    except ToolError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
