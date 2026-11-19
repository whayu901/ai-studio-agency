#!/usr/bin/env python3
"""Validate studio data: character registry, briefs, productions, manifests, analyses.

Examples (run from the repo root):
    python3 tools/validate.py characters
    python3 tools/validate.py brief briefs/demo-001/brief.json
    python3 tools/validate.py production briefs/demo-001/expected-production.json --check-ready
    python3 tools/validate.py caption outputs/<job>/caption.json
    python3 tools/validate.py manifest outputs/analysis/my-ref/manifest.json
    python3 tools/validate.py analysis outputs/analysis/my-ref/analysis.json
    python3 tools/validate.py all

Exit code 0 = no errors (warnings may still be printed), 1 = errors found.
"""

from __future__ import annotations

import argparse
import datetime as _dt
import hashlib
import json
import sys
from pathlib import Path
from typing import Dict, List, Optional, Tuple

from schema_lite import backend_name, validate

REPO_ROOT = Path(__file__).resolve().parent.parent
TIME_TOLERANCE = 0.05  # seconds of slack allowed between consecutive shots/clips


class Report:
    """Collects errors (block the step) and warnings (worth reading)."""

    def __init__(self) -> None:
        self.errors: List[str] = []
        self.warnings: List[str] = []

    def error(self, msg: str) -> None:
        self.errors.append(msg)

    def warn(self, msg: str) -> None:
        self.warnings.append(msg)

    def extend(self, other: "Report") -> None:
        self.errors.extend(other.errors)
        self.warnings.extend(other.warnings)

    @property
    def ok(self) -> bool:
        return not self.errors

    def print(self, title: str) -> None:
        state = "OK" if self.ok else "FAILED"
        print(f"[{state}] {title}")
        for e in self.errors:
            print(f"   ERROR   {e}")
        for w in self.warnings:
            print(f"   WARNING {w}")


def load_json(path: Path) -> object:
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)


def load_schema(name: str, root: Path = REPO_ROOT) -> dict:
    return load_json(root / "schemas" / name)  # type: ignore[return-value]


def schema_check(instance: object, schema_name: str, label: str, root: Path) -> Report:
    rep = Report()
    for err in validate(instance, load_schema(schema_name, root)):
        rep.error(f"{label}: {err}")
    return rep


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


# --------------------------------------------------------------------------- characters


def load_characters(root: Path = REPO_ROOT) -> Tuple[Dict[str, dict], Report]:
    """Load and validate every character. Returns ({id: profile}, report)."""
    rep = Report()
    reg_path = root / "characters" / "registry.json"
    if not reg_path.exists():
        rep.error(f"missing {reg_path.relative_to(root)}")
        return {}, rep
    registry = load_json(reg_path)
    rep.extend(schema_check(registry, "character-registry.schema.json", "registry.json", root))
    if not rep.ok:
        return {}, rep

    profiles: Dict[str, dict] = {}
    path_owner: Dict[str, str] = {}
    hash_owner: Dict[str, Tuple[str, str]] = {}

    for entry in registry["characters"]:  # type: ignore[index]
        cid = entry["character_id"]
        if cid in profiles:
            rep.error(f"duplicate character_id {cid!r} in registry")
            continue
        expected_profile = f"characters/{cid}/character.json"
        if entry["profile"] != expected_profile:
            rep.error(f"{cid}: profile must be {expected_profile!r}, got {entry['profile']!r}")
            continue
        ppath = root / entry["profile"]
        if not ppath.exists():
            rep.error(f"{cid}: profile file {entry['profile']} not found")
            continue
        profile = load_json(ppath)
        sub = schema_check(profile, "character.schema.json", entry["profile"], root)
        rep.extend(sub)
        if not sub.ok:
            continue
        if profile["character_id"] != cid:  # type: ignore[index]
            rep.error(f"{entry['profile']}: character_id {profile['character_id']!r} does not match registry id {cid!r}")
            continue
        profiles[cid] = profile  # type: ignore[assignment]

        status = profile["status"]  # type: ignore[index]
        own_prefix = f"characters/{cid}/references/"
        refs = profile["references"]  # type: ignore[index]
        for view, paths in refs.items():
            for rel in paths:
                if not rel.startswith(own_prefix):
                    rep.error(f"{cid}: reference {rel!r} ({view}) is outside {own_prefix} — character mixing is not allowed")
                    continue
                if rel in path_owner and path_owner[rel] != cid:
                    rep.error(f"{cid}: reference {rel!r} is also used by {path_owner[rel]!r}")
                path_owner[rel] = cid
                fpath = root / rel
                if not fpath.exists():
                    msg = f"{cid}: reference file {rel} is listed but missing on disk"
                    (rep.error if status == "active" else rep.warn)(msg)
                    continue
                digest = _sha256(fpath)
                if digest in hash_owner and hash_owner[digest][0] != cid:
                    other, other_rel = hash_owner[digest]
                    rep.error(f"{cid}: {rel} has identical content to {other}'s {other_rel} — character mixing is not allowed")
                hash_owner.setdefault(digest, (cid, rel))

        # Images dropped into references/ but not listed — easy to forget.
        ref_dir = root / own_prefix
        if ref_dir.is_dir():
            listed = {p for paths in refs.values() for p in paths}
            for f in sorted(ref_dir.iterdir()):
                if f.name.startswith(".") or not f.is_file():
                    continue
                rel = f"{own_prefix}{f.name}"
                if rel not in listed:
                    rep.warn(f"{cid}: {rel} exists but is not listed in character.json")

        cu = profile["commercial_use"]  # type: ignore[index]
        if status == "active":
            if not refs["front"]:
                rep.error(f"{cid}: active characters need at least one 'front' reference")
            if not refs["close_up"]:
                rep.error(f"{cid}: active characters need at least one 'close_up' reference")
            if not profile["physical_description"]:  # type: ignore[index]
                rep.error(f"{cid}: active characters need a human-written physical_description")
            if not cu["authorized"]:
                rep.error(f"{cid}: active characters need commercial_use.authorized = true")
            if not cu["rights_holder"]:
                rep.error(f"{cid}: active characters need commercial_use.rights_holder")
        elif status == "placeholder":
            rep.warn(f"{cid}: status is 'placeholder' — cannot be used for a real render yet")
        if cu["expires_on"]:
            if _dt.date.fromisoformat(cu["expires_on"]) < _dt.date.today():
                rep.error(f"{cid}: commercial_use expired on {cu['expires_on']}")
        voice = profile.get("voice") or {}  # type: ignore[union-attr]
        if voice.get("is_cloned_from_real_person") and not voice.get("clone_authorization_reference"):
            rep.error(f"{cid}: cloned voice without clone_authorization_reference")

    return profiles, rep


# --------------------------------------------------------------------------- flow config


def load_flow_config(root: Path = REPO_ROOT) -> Tuple[Optional[dict], Report]:
    path = root / "config" / "google-flow.json"
    rep = Report()
    if not path.exists():
        rep.error("missing config/google-flow.json")
        return None, rep
    cfg = load_json(path)
    rep.extend(schema_check(cfg, "google-flow-config.schema.json", "config/google-flow.json", root))
    if not rep.ok:
        return None, rep
    ids = [m["model_id"] for m in cfg["models"]]  # type: ignore[index]
    if cfg["default_model_id"] not in ids:  # type: ignore[index]
        rep.error("config/google-flow.json: default_model_id is not in models")
    for m in cfg["models"]:  # type: ignore[index]
        if not m["verified"]:
            rep.warn(f"Flow model {m['model_id']!r} capabilities are unverified — check them in the Flow UI")
    return cfg, rep  # type: ignore[return-value]


# --------------------------------------------------------------------------- brief


def check_brief(path: Path, root: Path = REPO_ROOT) -> Tuple[Optional[dict], Report]:
    rep = Report()
    brief = load_json(path)
    rep.extend(schema_check(brief, "product-brief.schema.json", str(path), root))
    if not rep.ok:
        return None, rep
    b: dict = brief  # type: ignore[assignment]
    if b["is_sample"]:
        rep.warn(f"{path}: is_sample = true — fictional data for testing only")
    if b["script"]["mode"] == "custom" and not b["script"]["custom_script"]:
        rep.error(f"{path}: script.mode is 'custom' but custom_script is empty")
    if not b["verified_claims"]:
        rep.warn(f"{path}: no verified_claims — the script may not make any product claims")
    return b, rep


# --------------------------------------------------------------------------- production


def _check_timeline(items: List[dict], duration: float, label: str, rep: Report) -> None:
    if not items:
        return
    prev_end = 0.0
    for i, it in enumerate(items):
        s, e = it["start_seconds"], it["end_seconds"]
        name = it.get("shot_id") or it.get("clip_id") or f"#{i}"
        if e <= s:
            rep.error(f"{label} {name}: end_seconds must be after start_seconds")
        if abs(s - prev_end) > TIME_TOLERANCE:
            kind = "gap" if s > prev_end else "overlap"
            rep.error(f"{label} {name}: {kind} — starts at {s}s but previous ends at {prev_end}s")
        prev_end = e
    if abs(prev_end - duration) > TIME_TOLERANCE:
        rep.error(f"{label}: ends at {prev_end}s but duration_seconds is {duration}s")


def check_production(path: Path, check_ready: bool = False, root: Path = REPO_ROOT) -> Report:
    rep = Report()
    prod = load_json(path)
    rep.extend(schema_check(prod, "production.schema.json", str(path), root))
    if not rep.ok:
        return rep
    p: dict = prod  # type: ignore[assignment]

    characters, crep = load_characters(root)
    rep.errors.extend(crep.errors)
    cid = p["character_id"]
    character = characters.get(cid)
    if character is None:
        rep.error(f"character_id {cid!r} is not in characters/registry.json")

    # Brief consistency
    brief: Optional[dict] = None
    brief_path = root / p["brief"]
    if not brief_path.exists():
        rep.error(f"brief {p['brief']} not found")
    else:
        brief, brep = check_brief(brief_path, root)
        rep.errors.extend(brep.errors)
        if brief:
            d = brief["deliverable"]
            if d["duration_seconds"] != p["duration_seconds"]:
                rep.warn(f"duration {p['duration_seconds']}s differs from brief ({d['duration_seconds']}s)")
            if d["aspect_ratio"] != p["aspect_ratio"]:
                rep.warn(f"aspect ratio {p['aspect_ratio']} differs from brief ({d['aspect_ratio']})")
            verified = {c["claim"] for c in brief["verified_claims"]}
            for claim in p.get("claims_used", []):
                if claim not in verified:
                    rep.error(f"claims_used contains {claim!r}, which is not a verified claim in the brief")

    # Mode
    if p["mode"] == "reference_guided":
        if not p["reference_video_manifest"]:
            rep.error("reference_guided mode needs reference_video_manifest")
        elif not (root / p["reference_video_manifest"]).exists():
            msg = f"reference manifest {p['reference_video_manifest']} not found"
            (rep.error if check_ready else rep.warn)(msg)
    elif p["reference_video_manifest"]:
        rep.warn("original mode has a reference_video_manifest — is the mode right?")

    duration = float(p["duration_seconds"])
    shots = p["storyboard"]
    clips = p["flow_prompts"]
    _check_timeline(shots, duration, "storyboard shot", rep)
    _check_timeline(clips, duration, "flow clip", rep)

    shot_ids = [s["shot_id"] for s in shots]
    if len(shot_ids) != len(set(shot_ids)):
        rep.error("storyboard has duplicate shot_id values")
    clip_by_id = {}
    for c in clips:
        if c["clip_id"] in clip_by_id:
            rep.error(f"duplicate flow clip_id {c['clip_id']}")
        clip_by_id[c["clip_id"]] = c
    if clips:
        for s in shots:
            c = clip_by_id.get(s["clip_id"])
            if c is None:
                rep.error(f"shot {s['shot_id']} belongs to clip {s['clip_id']}, which has no flow prompt")
            elif s["start_seconds"] < c["start_seconds"] - TIME_TOLERANCE or s["end_seconds"] > c["end_seconds"] + TIME_TOLERANCE:
                rep.error(f"shot {s['shot_id']} ({s['start_seconds']}-{s['end_seconds']}s) falls outside clip {c['clip_id']}")

    # Reference assets — the character-mixing guard
    asset_paths = set()
    own_prefix = f"characters/{cid}/references/"
    for a in p["reference_assets"]:
        rel = a["path"]
        asset_paths.add(rel)
        if rel.startswith("characters/") and not rel.startswith(own_prefix):
            rep.error(f"reference asset {rel} belongs to a different character than {cid!r} — character mixing is not allowed")
        if a["kind"] == "character_reference":
            if a["character_id"] != cid:
                rep.error(f"character_reference {rel} is tagged {a['character_id']!r}, production uses {cid!r}")
            if not rel.startswith(own_prefix):
                rep.error(f"character_reference {rel} must live under {own_prefix}")
            if character is not None:
                listed = {x for paths in character["references"].values() for x in paths}
                if rel not in listed:
                    msg = f"character_reference {rel} is not listed in {cid}'s character.json"
                    (rep.error if check_ready else rep.warn)(msg)
        elif a["kind"] == "product_image" and not rel.startswith("assets/products/"):
            rep.error(f"product_image {rel} must live under assets/products/")
        if a["rights_basis"] == "unknown":
            (rep.error if check_ready else rep.warn)(f"asset {rel} has rights_basis 'unknown'")

    # Flow prompts vs config
    cfg, frep = load_flow_config(root)
    rep.errors.extend(frep.errors)
    models = {m["model_id"]: m for m in cfg["models"]} if cfg else {}
    for c in clips:
        cname = c["clip_id"]
        for ing in c["ingredients"] + [x for x in (c.get("start_frame"), c.get("end_frame")) if x]:
            if ing not in asset_paths:
                rep.error(f"clip {cname}: {ing} is not declared in reference_assets")
            if ing.startswith("characters/") and not ing.startswith(own_prefix):
                rep.error(f"clip {cname}: {ing} belongs to another character — character mixing is not allowed")
        if c["generation_mode"] == "frames_to_video" and not c.get("start_frame"):
            rep.error(f"clip {cname}: frames_to_video needs start_frame")
        if c["generation_mode"] == "ingredients_to_video" and not c["ingredients"]:
            rep.error(f"clip {cname}: ingredients_to_video needs at least one ingredient")
        if c.get("continuity_from") and c["continuity_from"] not in clip_by_id:
            rep.error(f"clip {cname}: continuity_from {c['continuity_from']} does not exist")
        model = models.get(c["model_id"])
        if cfg is None:
            continue
        if model is None:
            rep.error(f"clip {cname}: model_id {c['model_id']!r} is not in config/google-flow.json")
            continue
        if not model["enabled"]:
            rep.error(f"clip {cname}: model {c['model_id']!r} is disabled in config/google-flow.json")
        if c["generation_mode"] not in model["generation_modes"]:
            rep.error(f"clip {cname}: {model['label']} is not configured for {c['generation_mode']}")
        length = c["end_seconds"] - c["start_seconds"]
        if length > model["max_clip_seconds"] + TIME_TOLERANCE:
            rep.error(f"clip {cname}: {length:g}s is longer than {model['label']}'s max_clip_seconds ({model['max_clip_seconds']}s) — split it")
        if model["max_ingredients"] is not None and len(c["ingredients"]) > model["max_ingredients"]:
            rep.error(f"clip {cname}: {len(c['ingredients'])} ingredients exceeds the configured limit of {model['max_ingredients']}")
        if p["aspect_ratio"] not in model["aspect_ratios"]:
            rep.error(f"clip {cname}: aspect ratio {p['aspect_ratio']} is not configured for {model['label']}")
        if c["dialogue"] and model["supports_spoken_dialogue"] is not True:
            rep.warn(f"clip {cname}: has dialogue, but spoken dialogue for {model['label']} is unverified — plan a voice-over fallback")

    # Status rules
    status = p["status"]
    qc = p["quality_checks"]
    if status == "APPROVED":
        hr = p["human_review"]
        if not hr["reviewer"] or not hr["approved_on"]:
            rep.error("APPROVED needs human_review.reviewer and human_review.approved_on")
        for q in qc:
            if q["score"] is None:
                rep.error(f"APPROVED but {q['check_id']} ({q['dimension']}) has no score")
            elif q["score"] < q["min_pass_score"]:
                rep.error(f"APPROVED but {q['check_id']} scored {q['score']} (< {q['min_pass_score']})")
    if status in ("DRAFT", "NEEDS_REVIEW", "READY_FOR_MANUAL_RENDER"):
        if any(q["score"] is not None for q in qc):
            rep.warn("quality scores are filled in, but nothing has been rendered yet according to status")

    if check_ready:
        if not p["script"].strip():
            rep.error("not ready: script is empty")
        if not shots:
            rep.error("not ready: storyboard is empty")
        if not clips:
            rep.error("not ready: no flow_prompts")
        if not qc:
            rep.error("not ready: no quality_checks to evaluate the render against")
        if character is not None and character["status"] != "active":
            rep.error(f"not ready: character {cid!r} has status {character['status']!r} (needs 'active')")
        for a in p["reference_assets"]:
            if not (root / a["path"]).exists():
                rep.error(f"not ready: asset file {a['path']} is missing on disk")
        if brief and brief["is_sample"]:
            rep.warn("brief is sample data — internal test render only, never deliver")
    return rep


# --------------------------------------------------------------------------- manifest / analysis


def check_manifest(path: Path, root: Path = REPO_ROOT) -> Report:
    rep = Report()
    m = load_json(path)
    rep.extend(schema_check(m, "frame-manifest.schema.json", str(path), root))
    if not rep.ok:
        return rep
    man: dict = m  # type: ignore[assignment]
    base = path.parent
    prev_t = -1.0
    for i, fr in enumerate(man["frames"], start=1):
        if fr["index"] != i:
            rep.error(f"frame index {fr['index']} out of order (expected {i})")
        if fr["timestamp_seconds"] <= prev_t:
            rep.error(f"frame {fr['index']}: timestamp {fr['timestamp_seconds']} is not after the previous one")
        prev_t = fr["timestamp_seconds"]
        if not (base / fr["path"]).exists():
            rep.error(f"frame {fr['index']}: file {fr['path']} is missing")
    paths = [fr["path"] for fr in man["frames"]]
    if paths != sorted(paths):
        rep.error("frame file names do not sort in time order")
    if man["sampling"]["extracted_frame_count"] != len(man["frames"]):
        rep.error("sampling.extracted_frame_count does not match the number of frames")
    if man["audio"] and not (base / man["audio"]["path"]).exists():
        rep.error(f"audio file {man['audio']['path']} is missing")
    return rep


def check_analysis(path: Path, root: Path = REPO_ROOT) -> Report:
    rep = Report()
    a = load_json(path)
    rep.extend(schema_check(a, "reference-analysis.schema.json", str(path), root))
    if not rep.ok:
        return rep
    an: dict = a  # type: ignore[assignment]
    characters, _ = load_characters(root)
    if an["adaptation_plan"]["character_id"] not in characters:
        rep.error(f"adaptation_plan.character_id {an['adaptation_plan']['character_id']!r} is not in the registry")
    for s in an["shots"]:
        if s["approx_end_seconds"] < s["approx_start_seconds"]:
            rep.error(f"shot {s['shot_id']}: end before start")
        for o in s["observations"]:
            if o["aspect"] in ("camera_movement", "character_movement") and o["certainty"] == "observed" and len(s["evidence_frames"]) < 2:
                rep.warn(f"shot {s['shot_id']}: movement marked 'observed' from a single frame — should be 'inferred'")
    return rep


# --------------------------------------------------------------------------- caption


def check_caption(path: Path, production_path: Optional[Path] = None, root: Path = REPO_ROOT) -> Report:
    """Captions: schema, claims only from the brief, disclosure present, no unresolved claims."""
    rep = Report()
    c = load_json(path)
    rep.extend(schema_check(c, "caption.schema.json", str(path), root))
    if not rep.ok:
        return rep
    cap: dict = c  # type: ignore[assignment]
    prod_path = production_path or path.parent / "production.json"
    if not prod_path.exists():
        rep.error(f"production {prod_path} not found (needed to check claims)")
        return rep
    prod = load_json(prod_path)
    if prod["job_id"] != cap["job_id"]:  # type: ignore[index]
        rep.error(f"caption job_id {cap['job_id']!r} does not match production {prod['job_id']!r}")  # type: ignore[index]
    brief_path = root / prod["brief"]  # type: ignore[index]
    if not brief_path.exists():
        rep.error(f"brief {prod['brief']} not found")  # type: ignore[index]
        return rep
    brief = load_json(brief_path)
    verified = {v["claim"] for v in brief["verified_claims"]}  # type: ignore[index]
    for claim in cap["claims_used"]:
        if claim not in verified:
            rep.error(f"claims_used contains {claim!r}, which is not a verified claim in the brief")
    seen = set()
    for item in cap["captions"]:
        plat = item["platform"]
        if plat in seen:
            rep.error(f"two captions for platform {plat!r}")
        seen.add(plat)
        if "[CLAIM NEEDED" in item["text"].upper():
            rep.error(f"{plat}: caption still contains [CLAIM NEEDED] — verify the claim or remove it")
        if not item["disclosure"].strip():
            rep.error(f"{plat}: disclosure is empty")
    for plat in brief["campaign"]["platforms"]:  # type: ignore[index]
        if plat not in seen:
            rep.warn(f"no caption for {plat}, which the brief lists as a platform")
    return rep


# --------------------------------------------------------------------------- CLI


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("characters", help="validate the character registry")
    sub.add_parser("flow-config", help="validate config/google-flow.json")
    for name in ("brief", "manifest", "analysis"):
        sp = sub.add_parser(name)
        sp.add_argument("file", type=Path)
    sp = sub.add_parser("production")
    sp.add_argument("file", type=Path)
    sp.add_argument("--check-ready", action="store_true", help="also require everything needed to render now")
    sp = sub.add_parser("caption")
    sp.add_argument("file", type=Path)
    sp.add_argument("--production", type=Path, default=None, help="default: production.json next to the caption")
    sub.add_parser("all", help="validate characters, flow config and every briefs/*/ file")
    args = parser.parse_args(argv)

    print(f"(schema backend: {backend_name()})")
    reports: List[Tuple[str, Report]] = []
    if args.cmd == "characters":
        _, r = load_characters()
        reports.append(("characters/registry.json", r))
    elif args.cmd == "flow-config":
        _, r = load_flow_config()
        reports.append(("config/google-flow.json", r))
    elif args.cmd == "brief":
        _, r = check_brief(args.file)
        reports.append((str(args.file), r))
    elif args.cmd == "production":
        reports.append((str(args.file) + (" (render readiness)" if args.check_ready else ""), check_production(args.file, args.check_ready)))
    elif args.cmd == "caption":
        reports.append((str(args.file), check_caption(args.file, args.production)))
    elif args.cmd == "manifest":
        reports.append((str(args.file), check_manifest(args.file)))
    elif args.cmd == "analysis":
        reports.append((str(args.file), check_analysis(args.file)))
    elif args.cmd == "all":
        _, r = load_characters()
        reports.append(("characters/registry.json", r))
        _, r = load_flow_config()
        reports.append(("config/google-flow.json", r))
        for f in sorted((REPO_ROOT / "briefs").glob("*/brief.json")):
            _, r = check_brief(f)
            reports.append((str(f.relative_to(REPO_ROOT)), r))
        for f in sorted((REPO_ROOT / "briefs").glob("*/expected-production.json")):
            reports.append((str(f.relative_to(REPO_ROOT)), check_production(f)))

    for title, r in reports:
        r.print(title)
    return 0 if all(r.ok for _, r in reports) else 1


if __name__ == "__main__":
    sys.exit(main())
