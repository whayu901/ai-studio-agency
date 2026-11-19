"""Shared FFmpeg helpers for the post-production tools (review_render, assemble, package_delivery)."""

from __future__ import annotations

import os
import re
import shutil
import subprocess
from pathlib import Path
from typing import List, Optional, Sequence

from generate_manifest import ToolError, require_binary

# Output frame size per aspect ratio (what TikTok / Reels / Shorts expect).
RESOLUTIONS = {"9:16": (1080, 1920), "16:9": (1920, 1080), "1:1": (1080, 1080), "4:5": (1080, 1350)}
OUTPUT_FPS = 30
ASPECT_TOLERANCE = 0.02  # 2 % difference in width/height ratio is still "the same" aspect
DURATION_TOLERANCE = 0.5  # seconds

FONT_CANDIDATES = [
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "/System/Library/Fonts/Supplemental/Arial.ttf",
    "/Library/Fonts/Arial.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/TTF/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf",
]
_SAFE_FILTER_PATH = re.compile(r"^[A-Za-z0-9_./-]+$")


def find_font(explicit: Optional[str] = None) -> Path:
    """A .ttf/.ttc font for drawtext: --font, then $ACS_FONT, then common system fonts."""
    for cand in [explicit, os.environ.get("ACS_FONT")] + FONT_CANDIDATES:
        if cand and Path(cand).is_file():
            return Path(cand)
    raise ToolError("no font found for on-screen text. Pass --font /path/to/font.ttf or set ACS_FONT.")


def filter_path(path: Path) -> str:
    """A path that is safe to put inside an FFmpeg filtergraph without escaping."""
    text = str(path)
    if not _SAFE_FILTER_PATH.match(text):
        raise ToolError(f"internal: path {text!r} is not filter-safe")
    return text


def stage_font(font: Path, workdir: Path) -> str:
    """Copy the font into the work dir under a simple name (system font paths contain spaces)."""
    dest = workdir / ("font" + font.suffix.lower())
    shutil.copyfile(font, dest)
    return filter_path(dest)


def run_ffmpeg(args: Sequence[str]) -> None:
    ffmpeg = require_binary("ffmpeg")
    proc = subprocess.run([ffmpeg, "-hide_banner", "-loglevel", "error", "-nostdin", *args], capture_output=True, text=True)
    if proc.returncode != 0:
        tail = "\n".join(proc.stderr.strip().splitlines()[-6:])
        raise ToolError(f"FFmpeg failed:\n{tail}")


def video_encoder_args() -> List[str]:
    """H.264 when available (what every platform wants), else MPEG-4 as a fallback."""
    ffmpeg = require_binary("ffmpeg")
    encoders = subprocess.run([ffmpeg, "-hide_banner", "-encoders"], capture_output=True, text=True).stdout
    if re.search(r"^\s*V\S*\s+libx264\s", encoders, re.M):
        return ["-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-profile:v", "high"]
    return ["-c:v", "mpeg4", "-q:v", "2", "-pix_fmt", "yuv420p"]


def aspect_value(aspect: str) -> float:
    w, h = aspect.split(":")
    return int(w) / int(h)


def aspect_matches(width: int, height: int, aspect: str) -> bool:
    want = aspect_value(aspect)
    return abs((width / height) - want) / want <= ASPECT_TOLERANCE


def strip_editing_marker(text: str) -> str:
    """Storyboard text is written as '… (added in editing)'; the overlay itself drops that note."""
    return re.sub(r"\s*\(added in editing\)\s*$", "", text, flags=re.I).strip()
