"""Shared test helpers. Tests use only the standard library + FFmpeg (when installed)."""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
TOOLS = REPO_ROOT / "tools"
if str(TOOLS) not in sys.path:
    sys.path.insert(0, str(TOOLS))

FFMPEG = shutil.which("ffmpeg")
FFPROBE = shutil.which("ffprobe")
HAVE_FFMPEG = bool(FFMPEG and FFPROBE)
SKIP_FFMPEG_MSG = "FFmpeg/ffprobe not installed — install with `brew install ffmpeg` to run video tests"


def read_json(path: Path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def write_json(path: Path, data) -> None:
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(json.dumps(data, indent=2), encoding="utf-8")


def make_temp_repo() -> Path:
    """Copy the data parts of the repo (no media) into a temp folder tests may mutate."""
    root = Path(tempfile.mkdtemp(prefix="acs-test-"))
    for d in ("schemas", "config", "briefs"):
        shutil.copytree(REPO_ROOT / d, root / d)
    (root / "characters").mkdir()
    shutil.copy(REPO_ROOT / "characters" / "registry.json", root / "characters" / "registry.json")
    for prof in (REPO_ROOT / "characters").glob("*/character.json"):
        dest = root / "characters" / prof.parent.name
        (dest / "references").mkdir(parents=True)
        # Private reference images are not copied, so start every test profile from a
        # clean placeholder state regardless of what the real repo has filled in.
        data = json.loads(prof.read_text(encoding="utf-8"))
        data["references"] = {view: [] for view in data["references"]}
        data["status"] = "placeholder"
        data["physical_description"] = None
        write_json(dest / "character.json", data)
    (root / "assets" / "products").mkdir(parents=True)
    return root


def make_color_video(path: Path, colors=("red", "lime", "blue", "white"), seg_seconds=1.0, size="180x320", audio=True) -> Path:
    """Video made of solid colour segments, so a frame's colour proves its timestamp."""
    parts = [f"color=c={c}:s={size}:r=25:d={seg_seconds}[v{i}]" for i, c in enumerate(colors)]
    graph = ";".join(parts) + ";" + "".join(f"[v{i}]" for i in range(len(colors))) + f"concat=n={len(colors)}:v=1:a=0[out0]"
    total = seg_seconds * len(colors)
    cmd = [FFMPEG, "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", graph]
    if audio:
        cmd += ["-f", "lavfi", "-i", f"sine=frequency=440:duration={total}"]
    cmd += ["-c:v", "mpeg4", "-q:v", "2", "-pix_fmt", "yuv420p"]
    cmd += ["-c:a", "aac", "-shortest"] if audio else ["-an"]
    cmd += [str(path)]
    subprocess.run(cmd, check=True, capture_output=True)
    return path


def pixel_rgb(image: Path):
    """Average colour of an image as (r, g, b), via FFmpeg (no PIL needed)."""
    out = subprocess.run(
        [FFMPEG, "-hide_banner", "-loglevel", "error", "-i", str(image), "-vf", "scale=1:1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
        check=True,
        capture_output=True,
    ).stdout
    return tuple(out[:3])


def dominant(rgb) -> str:
    r, g, b = rgb
    if min(rgb) > 200:
        return "white"
    return {0: "red", 1: "lime", 2: "blue"}[max(range(3), key=lambda i: rgb[i])]


def image_size(image: Path):
    out = subprocess.run(
        [FFPROBE, "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", str(image)],
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    w, h = out.split(",")[:2]
    return int(w), int(h)
