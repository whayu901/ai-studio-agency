#!/usr/bin/env python3
"""Assemble the kept Flow takes into one edited video, locally with FFmpeg.

    # takes come from the experiment log (rows with decision SELECTED / APPROVED_FOR_DELIVERY)
    python3 tools/assemble.py outputs/<job>/production.json

    # or name them, and lay your own voice-over on top (clip audio ducked underneath)
    python3 tools/assemble.py outputs/<job>/production.json \\
        --take C01=outputs/<job>/renders/C01_a02.mp4 \\
        --voiceover outputs/<job>/audio/vo.wav --voiceover-rights own_recording

What it does, in order:
  1. each take is scaled/padded to the delivery size (1080x1920 for 9:16), 30 fps, and trimmed
     to its planned length (or the last frame is held if the take is short)
  2. takes are joined in clip order (hard cuts; clips never have cuts inside them)
  3. storyboard `on_screen_text` is drawn at the shot times, plus a small AI-content label
  4. audio: clip audio, optionally mixed with a voice-over, loudness-normalised to -14 LUFS

Output: outputs/<job>/edit/<job>_v01.mp4 (v02, v03… on later runs) and an edit record
<job>_v01.json listing every input. Nothing is uploaded or published.
"""

from __future__ import annotations

import argparse
import csv
import datetime as _dt
import json
import sys
import tempfile
import textwrap
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import validate
from generate_manifest import ToolError, ffmpeg_version, probe_video
from postprod import (
    OUTPUT_FPS,
    RESOLUTIONS,
    aspect_matches,
    filter_path,
    find_font,
    run_ffmpeg,
    stage_font,
    strip_editing_marker,
    video_encoder_args,
)

TOOL_VERSION = "0.1.0"
KEEP_DECISIONS = ("SELECTED", "APPROVED_FOR_DELIVERY")
CLIP_AUDIO_MODES = ("keep", "duck", "mute")
VOICEOVER_RIGHTS = ("own_recording", "licensed_tts", "licensed_voice_actor")
DUCK_VOLUME = 0.2
LOUDNESS = "I=-14:TP=-1.5:LRA=11"
AI_LABELS = {"id": "Konten dibuat dengan AI", "en": "AI-generated content"}
WRAP_CHARS = 26


def parse_takes(items: List[str]) -> Dict[str, Path]:
    takes: Dict[str, Path] = {}
    for item in items:
        if "=" not in item:
            raise ToolError(f"--take {item!r}: use CLIP=path, e.g. C01=outputs/job/renders/C01_a02.mp4")
        clip, path = item.split("=", 1)
        clip = clip.strip().upper()
        if clip in takes:
            raise ToolError(f"--take {clip} given twice")
        takes[clip] = Path(path.strip())
    return takes


def takes_from_log(log_path: Path, job_id: str) -> Dict[str, Path]:
    """Latest kept take per clip, from the experiment log."""
    if not log_path.exists():
        return {}
    found: Dict[str, Path] = {}
    with open(log_path, newline="", encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            if row.get("job_id") == job_id and row.get("final_approval_status") in KEEP_DECISIONS and row.get("output_file"):
                found[row["clip_id"]] = Path(row["output_file"])  # later rows win
    return found


def resolve_takes(production: dict, explicit: Dict[str, Path], log_path: Path, root: Path) -> Dict[str, Path]:
    clip_ids = [c["clip_id"] for c in production["flow_prompts"]]
    if not clip_ids:
        raise ToolError("the production has no flow_prompts, so there is nothing to assemble")
    unknown = sorted(set(explicit) - set(clip_ids))
    if unknown:
        raise ToolError(f"--take for unknown clip(s): {', '.join(unknown)} (production has {', '.join(clip_ids)})")
    logged = takes_from_log(log_path, production["job_id"])
    takes, missing = {}, []
    for cid in clip_ids:
        path = explicit.get(cid) or logged.get(cid)
        if path is None:
            missing.append(cid)
            continue
        if not path.is_absolute() and (root / path).exists():
            path = root / path  # log paths are repo-relative
        if not path.exists():
            raise ToolError(f"take for {cid} not found: {path}")
        takes[cid] = path
    if missing:
        raise ToolError(
            f"no take chosen for {', '.join(missing)}. Log the kept take with log_attempt.py --decision SELECTED "
            f"--output-file …, or pass --take {missing[0]}=path/to/clip.mp4"
        )
    return takes


def overlay_items(production: dict) -> List[Tuple[float, float, str]]:
    items = []
    for s in production["storyboard"]:
        if s.get("on_screen_text"):
            text = strip_editing_marker(s["on_screen_text"])
            if text:
                items.append((float(s["start_seconds"]), float(s["end_seconds"]), text))
    return items


def default_ai_label(brief: Optional[dict]) -> str:
    lang = ((brief or {}).get("script") or {}).get("language", "en")
    return AI_LABELS.get(lang.split("-")[0].lower(), AI_LABELS["en"])


def build_filtergraph(clips: List[dict], infos: List[dict], size: Tuple[int, int], overlays: List[Tuple[float, float, str]],
                      ai_label: Optional[str], workdir: Path, font: Optional[Path], vo_index: Optional[int],
                      clip_audio: str) -> str:
    w, h = size
    parts = []
    total = sum(c["end_seconds"] - c["start_seconds"] for c in clips)
    for i, (clip, info) in enumerate(zip(clips, infos)):
        length = round(clip["end_seconds"] - clip["start_seconds"], 3)
        parts.append(
            f"[{i}:v]scale={w}:{h}:force_original_aspect_ratio=decrease,pad={w}:{h}:(ow-iw)/2:(oh-ih)/2:color=black,"
            f"setsar=1,fps={OUTPUT_FPS},tpad=stop_mode=clone:stop_duration={length},trim=duration={length},setpts=PTS-STARTPTS[v{i}]"
        )
        if info["has_audio"]:
            parts.append(f"[{i}:a]aresample=48000,aformat=channel_layouts=stereo,apad,atrim=duration={length},asetpts=PTS-STARTPTS[a{i}]")
        else:
            parts.append(f"anullsrc=r=48000:cl=stereo,atrim=duration={length}[a{i}]")
    joined = "".join(f"[v{i}][a{i}]" for i in range(len(clips)))
    parts.append(f"{joined}concat=n={len(clips)}:v=1:a=1[vcat][acat]")

    # Text: overlays in the lower third, AI label top-left. Text goes through files (no escaping).
    draws = []
    if overlays or ai_label:
        fontfile = stage_font(font, workdir)  # type: ignore[arg-type]
        for n, (start, end, text) in enumerate(overlays, 1):
            tf = workdir / f"overlay_{n}.txt"
            tf.write_text("\n".join(textwrap.wrap(text, WRAP_CHARS)) or text, encoding="utf-8")
            draws.append(
                f"drawtext=fontfile={fontfile}:textfile={filter_path(tf)}:fontsize={round(h * 0.034)}:fontcolor=white:"
                f"line_spacing={round(h * 0.008)}:box=1:boxcolor=black@0.55:boxborderw={round(h * 0.012)}:"
                f"x=(w-text_w)/2:y=h*0.70:enable='between(t,{start:g},{end:g})'"
            )
        if ai_label:
            tf = workdir / "ai_label.txt"
            tf.write_text(ai_label, encoding="utf-8")
            draws.append(
                f"drawtext=fontfile={fontfile}:textfile={filter_path(tf)}:fontsize={round(h * 0.018)}:fontcolor=white:"
                f"box=1:boxcolor=black@0.45:boxborderw={round(h * 0.006)}:x=w*0.04:y=h*0.04"
            )
    parts.append(f"[vcat]{','.join(draws) if draws else 'null'}[vout]")

    if vo_index is None:
        parts.append(f"[acat]loudnorm={LOUDNESS},aresample=48000[aout]")
    else:
        parts.append(f"[{vo_index}:a]aresample=48000,aformat=channel_layouts=stereo,apad,atrim=duration={total:g}[vo]")
        if clip_audio == "mute":
            parts.append(f"[vo]loudnorm={LOUDNESS},aresample=48000[aout]")
        else:
            vol = DUCK_VOLUME if clip_audio == "duck" else 1.0
            parts.append(f"[acat]volume={vol}[bed]")
            parts.append(f"[bed][vo]amix=inputs=2:duration=first:normalize=0,loudnorm={LOUDNESS},aresample=48000[aout]")
    return ";".join(parts)


def next_output(edit_dir: Path, job: str) -> Path:
    n = 1
    while (edit_dir / f"{job}_v{n:02d}.mp4").exists():
        n += 1
    return edit_dir / f"{job}_v{n:02d}.mp4"


def assemble(production_path: Path, *, takes: Optional[Dict[str, Path]] = None, voiceover: Optional[Path] = None,
             voiceover_rights: Optional[str] = None, clip_audio: Optional[str] = None, overlays: bool = True,
             ai_label: Optional[str] = "", output: Optional[Path] = None, log_path: Optional[Path] = None,
             font: Optional[str] = None, size: Optional[Tuple[int, int]] = None, root: Path = validate.REPO_ROOT) -> dict:
    """Build the edit. ai_label: "" = default for the brief language, None = no label."""
    if not production_path.exists():
        raise ToolError(f"{production_path} not found")
    rep = validate.check_production(production_path, root=root)
    if rep.errors:
        raise ToolError("the production plan is invalid:\n  " + "\n  ".join(rep.errors))
    production = json.loads(production_path.read_text(encoding="utf-8"))
    brief_path = root / production["brief"]
    brief = json.loads(brief_path.read_text(encoding="utf-8")) if brief_path.exists() else None

    if voiceover is not None:
        if voiceover_rights not in VOICEOVER_RIGHTS:
            raise ToolError(f"--voiceover needs --voiceover-rights ({', '.join(VOICEOVER_RIGHTS)}). Cloned voices of real people are not allowed.")
        if not voiceover.exists():
            raise ToolError(f"voice-over {voiceover} not found")
    clip_audio = clip_audio or ("duck" if voiceover else "keep")
    if clip_audio not in CLIP_AUDIO_MODES:
        raise ToolError(f"--clip-audio must be one of {', '.join(CLIP_AUDIO_MODES)}")
    if clip_audio != "keep" and voiceover is None:
        raise ToolError(f"--clip-audio {clip_audio} only makes sense with --voiceover")

    clips = production["flow_prompts"]
    chosen = resolve_takes(production, takes or {}, log_path or (root / "experiments" / "experiment-log.csv"), root)
    infos = [probe_video(chosen[c["clip_id"]]) for c in clips]
    warnings = []
    for c, info in zip(clips, infos):
        if not aspect_matches(info["display_width"], info["display_height"], production["aspect_ratio"]):
            warnings.append(f"{c['clip_id']}: take is {info['display_width']}x{info['display_height']}, not {production['aspect_ratio']} — it will be letterboxed")
        planned = c["end_seconds"] - c["start_seconds"]
        if abs(info["duration_seconds"] - planned) > 0.5:
            action = "last frame held" if info["duration_seconds"] < planned else "end trimmed"
            warnings.append(f"{c['clip_id']}: take is {info['duration_seconds']:g}s, planned {planned:g}s ({action})")

    out_size = size or RESOLUTIONS[production["aspect_ratio"]]
    texts = overlay_items(production) if overlays else []
    label = default_ai_label(brief) if ai_label == "" else ai_label
    if label is None:
        warnings.append("no AI-content label burned in — make sure the platform's own AI label is switched on when posting")
    font_path = find_font(font) if (texts or label) else None

    out = output or next_output(production_path.parent / "edit", production["job_id"])
    if out.exists():
        raise ToolError(f"{out} already exists; pick another --output")
    out.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        inputs: List[str] = []
        for c in clips:
            inputs += ["-i", str(chosen[c["clip_id"]])]
        vo_index = None
        if voiceover is not None:
            vo_index = len(clips)
            inputs += ["-i", str(voiceover)]
        graph = build_filtergraph(clips, infos, out_size, texts, label, work, font_path, vo_index, clip_audio)
        script = work / "graph.txt"
        script.write_text(graph, encoding="utf-8")
        run_ffmpeg([*inputs, "-filter_complex_script", str(script), "-map", "[vout]", "-map", "[aout]",
                    *video_encoder_args(), "-r", str(OUTPUT_FPS), "-c:a", "aac", "-b:a", "192k",
                    "-movflags", "+faststart", "-y", str(out)])

    final = probe_video(out)
    record = {
        "tool": f"assemble.py@{TOOL_VERSION}",
        "created": _dt.datetime.now().isoformat(timespec="seconds"),
        "job_id": production["job_id"],
        "production": validate_rel(production_path, root),
        "prompt_versions": production["prompt_versions"],
        "output": {"path": validate_rel(out, root), "sha256": final["sha256"], "duration_seconds": final["duration_seconds"],
                   "width": final["display_width"], "height": final["display_height"]},
        "takes": [{"clip_id": c["clip_id"], "path": validate_rel(chosen[c["clip_id"]], root), "sha256": info["sha256"],
                   "duration_seconds": info["duration_seconds"], "planned_seconds": round(c["end_seconds"] - c["start_seconds"], 3)}
                  for c, info in zip(clips, infos)],
        "overlays": [{"start_seconds": s, "end_seconds": e, "text": t} for s, e, t in texts],
        "ai_label": label,
        "audio": {"clip_audio": clip_audio, "loudness": LOUDNESS,
                  "voiceover": None if voiceover is None else {"path": validate_rel(voiceover, root), "rights": voiceover_rights}},
        "ffmpeg": ffmpeg_version(),
        "warnings": warnings,
    }
    record_path = out.with_suffix(".json")
    record_path.write_text(json.dumps(record, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return {"output": out, "record": record_path, "info": final, "warnings": warnings, "takes": chosen}


def validate_rel(path: Path, root: Path) -> str:
    try:
        return path.resolve().relative_to(root.resolve()).as_posix()
    except ValueError:
        return str(path)


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("production", type=Path)
    ap.add_argument("--take", action="append", default=[], metavar="CLIP=PATH", help="use this file for a clip (repeatable)")
    ap.add_argument("--log", type=Path, default=None, help="experiment log to read kept takes from")
    ap.add_argument("--voiceover", type=Path, default=None, help="voice-over audio (wav/m4a/mp3) covering the whole video")
    ap.add_argument("--voiceover-rights", choices=VOICEOVER_RIGHTS, default=None, help="required with --voiceover")
    ap.add_argument("--clip-audio", choices=CLIP_AUDIO_MODES, default=None,
                    help="keep (default without VO), duck under the VO (default with VO), or mute")
    ap.add_argument("--no-overlays", action="store_true", help="skip the storyboard's on-screen text")
    label = ap.add_mutually_exclusive_group()
    label.add_argument("--ai-label", default="", help="text of the AI-content label (default by brief language)")
    label.add_argument("--no-ai-label", action="store_true", help="burn in no label (use the platform's AI label instead)")
    ap.add_argument("--font", default=None, help="font file for on-screen text")
    ap.add_argument("--output", type=Path, default=None, help="default outputs/<job>/edit/<job>_vNN.mp4")
    args = ap.parse_args(argv)
    try:
        r = assemble(args.production, takes=parse_takes(args.take), voiceover=args.voiceover, voiceover_rights=args.voiceover_rights,
                     clip_audio=args.clip_audio, overlays=not args.no_overlays, ai_label=None if args.no_ai_label else args.ai_label,
                     output=args.output, log_path=args.log, font=args.font)
    except ToolError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    for cid, path in r["takes"].items():
        print(f"Take:    {cid} ← {path}")
    for w in r["warnings"]:
        print(f"WARNING: {w}")
    info = r["info"]
    print(f"Edit:    {r['output']} ({info['duration_seconds']:g}s, {info['display_width']}x{info['display_height']})")
    print(f"Record:  {r['record']}")
    print("Watch the whole edit before anything else. Nothing was uploaded or published.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
