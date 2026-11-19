"""Tests for Phase 3: review_render, assemble, caption validation, approve and package_delivery."""

from __future__ import annotations

import io
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path

from helpers import (
    HAVE_FFMPEG,
    REPO_ROOT,
    SKIP_FFMPEG_MSG,
    dominant,
    frame_at,
    image_size,
    make_color_video,
    make_temp_repo,
    make_tone,
    pixel_rgb,
    read_json,
    region_rgb,
    write_json,
)

import approve
import assemble
import log_attempt
import package_delivery
import review_render
import validate
from generate_manifest import ToolError, probe_video
from postprod import FONT_CANDIDATES

PROD = "briefs/demo-001/expected-production.json"
EIGHT = ("red", "lime", "blue", "white", "red", "lime", "blue", "white")
SMALL = (180, 320)
ALL_PASS = {"QC01": 5, "QC02": 4, "QC03": 4, "QC04": 4, "QC05": 5, "QC06": 4, "QC07": 4, "QC08": 4, "QC09": 4, "QC10": 5}
HAVE_FONT = bool(os.environ.get("ACS_FONT")) or any(Path(f).is_file() for f in FONT_CANDIDATES)


def quiet(fn, *a, **kw):
    with redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
        return fn(*a, **kw)


class StudioCase(unittest.TestCase):
    """Temp repo where female_02 is active and the demo images exist."""

    def setUp(self):
        self.root = make_temp_repo()
        self.tmp = Path(tempfile.mkdtemp(prefix="acs-media-"))
        cid = "female_02"
        refs = {}
        for view in ("front", "closeup"):
            rel = f"characters/{cid}/references/{cid}_{view}_01.jpg"
            (self.root / rel).write_bytes(os.urandom(128))
            refs[view] = rel
        (self.root / "assets/products/arka-tumbler-front.jpg").write_bytes(os.urandom(128))
        prof_path = self.root / "characters" / cid / "character.json"
        prof = read_json(prof_path)
        prof["references"]["front"] = [refs["front"]]
        prof["references"]["close_up"] = [refs["closeup"]]
        prof["physical_description"] = "Test description."
        prof["status"] = "active"
        prof["commercial_use"].update(authorized=True, rights_holder="Test", authorized_uses=["test"])
        write_json(prof_path, prof)
        self.prod_path = self.root / PROD

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)
        shutil.rmtree(self.tmp, ignore_errors=True)

    def clip(self, name="take.mp4", colors=EIGHT, size="180x320", audio=True):
        return make_color_video(self.tmp / name, colors=colors, size=size, audio=audio)

    def make_deliverable(self, status="RENDERED_PENDING_QC"):
        """Turn the demo into a real (non-sample), rendered, fully scored production."""
        brief_path = self.root / "briefs/demo-001/brief.json"
        brief = read_json(brief_path)
        brief["is_sample"] = False
        write_json(brief_path, brief)
        prod = read_json(self.prod_path)
        for a in prod["reference_assets"]:
            a["rights_basis"] = "licensed"
        for q in prod["quality_checks"]:
            q["score"] = ALL_PASS[q["check_id"]]
        prod["status"] = status
        write_json(self.prod_path, prod)

    def write_caption(self, **override):
        cap = {
            "schema_version": "1.0",
            "job_id": "demo-001",
            "prompt_version": "caption@0.1.0",
            "language": "en",
            "ai_disclosure": "This video was made with AI.",
            "claims_used": ["Keeps drinks cold for up to 24 hours"],
            "captions": [
                {"platform": "TikTok", "text": "Ice at 5 PM? Still there.", "hashtags": ["#tumbler", "#icedcoffee"], "disclosure": "#ad"},
                {"platform": "Instagram Reels", "text": "Cold till evening.", "hashtags": ["#tumbler"], "disclosure": "#ad"},
            ],
        }
        cap.update(override)
        path = self.tmp / "caption.json"
        write_json(path, cap)
        return path


# --------------------------------------------------------------------------- review_render


@unittest.skipUnless(HAVE_FFMPEG and HAVE_FONT, SKIP_FFMPEG_MSG + " (and a font for drawtext)")
class ReviewRenderTest(StudioCase):
    def test_contact_sheet_last_frame_and_report(self):
        video = self.clip("C01_a01.mp4")
        r = review_render.review(self.prod_path, "C01", video, every=1.0)
        self.assertEqual(r["issues"], [])
        self.assertEqual(r["tiles"], 8)
        w, h = image_size(r["contact"])
        self.assertEqual(w, 4 * review_render.TILE_WIDTH + 3 * 4, "4 columns of tiles with 4 px padding")
        self.assertGreater(h, w * 0.8, "two rows of portrait tiles")
        self.assertEqual(dominant(pixel_rgb(r["last_frame"])), "white", "last frame must come from the last segment")
        report = r["report"].read_text()
        for needle in ("S01", "S03", "QC05", "log_attempt.py", "Nothing here is a quality score"):
            self.assertIn(needle, report)

    def test_flags_wrong_aspect_short_clip_and_missing_audio(self):
        video = self.clip("wide.mp4", colors=("red", "lime", "blue", "white"), size="320x180", audio=False)
        r = review_render.review(self.prod_path, "C01", video, every=1.0, last_frame=False)
        text = " ".join(r["issues"])
        self.assertIn("not 9:16", text)
        self.assertIn("plan needs 8s", text)
        self.assertIn("voice-over", text)
        self.assertIsNone(r["last_frame"])

    def test_rejects_unknown_clip_and_missing_file(self):
        video = self.clip()
        with self.assertRaisesRegex(ToolError, "not in this production"):
            review_render.review(self.prod_path, "C09", video)
        with self.assertRaisesRegex(ToolError, "not found"):
            review_render.review(self.prod_path, "C01", self.tmp / "nope.mp4")


# --------------------------------------------------------------------------- assemble


@unittest.skipUnless(HAVE_FFMPEG and HAVE_FONT, SKIP_FFMPEG_MSG + " (and a font for drawtext)")
class AssembleTest(StudioCase):
    def run_assemble(self, **kw):
        kw.setdefault("takes", {"C01": self.clip()})
        kw.setdefault("output", self.tmp / "edit.mp4")
        kw.setdefault("size", SMALL)
        return assemble.assemble(self.prod_path, root=self.root, **kw)

    def test_overlay_and_label_follow_storyboard_times(self):
        r = self.run_assemble()
        info = r["info"]
        self.assertAlmostEqual(info["duration_seconds"], 8.0, delta=0.1)
        self.assertEqual((info["display_width"], info["display_height"]), SMALL)
        # S01 (0–2 s) has on-screen text: its dark box sits just above y = 70 % of the height.
        f1 = frame_at(r["output"], 1.0, self.tmp / "t1.png")
        self.assertLess(region_rgb(f1, 85, 220, 10, 2)[1], 200, "overlay box should darken the lime frame at 1 s")
        # S02 (2–5.5 s) has none: the same spot is plain white at 3 s.
        f3 = frame_at(r["output"], 3.0, self.tmp / "t3.png")
        self.assertGreater(min(region_rgb(f3, 85, 220, 10, 2)), 240)
        # The AI label is always on (top-left).
        self.assertLess(max(region_rgb(f3, 9, 15, 4, 3)), 235)
        rec = read_json(r["record"])
        self.assertEqual(rec["ai_label"], "AI-generated content")
        self.assertEqual([o["text"] for o in rec["overlays"]], ["5:00 PM", "Link in bio"])
        self.assertEqual(rec["takes"][0]["clip_id"], "C01")

    def test_no_overlays_no_label_warns(self):
        r = self.run_assemble(overlays=False, ai_label=None)
        f1 = frame_at(r["output"], 1.0, self.tmp / "t1.png")
        self.assertGreater(region_rgb(f1, 85, 220, 10, 2)[1], 240)
        self.assertTrue(any("platform's own AI label" in w for w in r["warnings"]))

    def test_short_take_holds_last_frame(self):
        take = self.clip("short.mp4", colors=("red", "lime", "blue", "white", "blue"))
        r = self.run_assemble(takes={"C01": take})
        self.assertAlmostEqual(r["info"]["duration_seconds"], 8.0, delta=0.1)
        self.assertTrue(any("last frame held" in w for w in r["warnings"]))
        self.assertEqual(dominant(pixel_rgb(frame_at(r["output"], 7.5, self.tmp / "end.png"))), "blue")

    def test_voiceover_needs_rights_and_mixes(self):
        vo = make_tone(self.tmp / "vo.wav", 7)
        with self.assertRaisesRegex(ToolError, "voiceover-rights"):
            self.run_assemble(voiceover=vo)
        r = self.run_assemble(takes={"C01": self.clip(audio=False)}, voiceover=vo, voiceover_rights="own_recording")
        self.assertTrue(r["info"]["has_audio"])
        rec = read_json(r["record"])
        self.assertEqual(rec["audio"]["clip_audio"], "duck")
        self.assertEqual(rec["audio"]["voiceover"]["rights"], "own_recording")

    def test_takes_come_from_the_log(self):
        take = self.clip("C01_a02.mp4")
        log = self.tmp / "log.csv"
        quiet(log_attempt.log_attempt, self.prod_path, "C01", credits=20, scores=ALL_PASS, decision="RETRY",
              output_file=str(self.clip("C01_a01.mp4", colors=("red",) * 8)), log_path=log)
        quiet(log_attempt.log_attempt, self.prod_path, "C01", credits=20, scores=ALL_PASS, decision="SELECTED",
              output_file=str(take), log_path=log)
        r = self.run_assemble(takes={}, log_path=log)
        self.assertEqual(r["takes"]["C01"], take)

    def test_errors(self):
        with self.assertRaisesRegex(ToolError, "no take chosen for C01"):
            self.run_assemble(takes={}, log_path=self.tmp / "none.csv")
        with self.assertRaisesRegex(ToolError, "unknown clip"):
            self.run_assemble(takes={"C02": self.clip()})
        with self.assertRaisesRegex(ToolError, "only makes sense with --voiceover"):
            self.run_assemble(clip_audio="mute")
        out = self.tmp / "exists.mp4"
        out.write_bytes(b"x")
        with self.assertRaisesRegex(ToolError, "already exists"):
            self.run_assemble(output=out)

    def test_versioned_default_output(self):
        r1 = self.run_assemble(output=None)
        r2 = self.run_assemble(output=None)
        self.assertEqual(r1["output"].name, "demo-001_v01.mp4")
        self.assertEqual(r2["output"].name, "demo-001_v02.mp4")
        self.assertEqual(r1["output"].parent, self.prod_path.parent / "edit")


class ParseTakesTest(unittest.TestCase):
    def test_parse(self):
        self.assertEqual(assemble.parse_takes(["c01=a.mp4", "C02 = b.mp4"]), {"C01": Path("a.mp4"), "C02": Path("b.mp4")})
        with self.assertRaisesRegex(ToolError, "CLIP=path"):
            assemble.parse_takes(["a.mp4"])
        with self.assertRaisesRegex(ToolError, "twice"):
            assemble.parse_takes(["C01=a.mp4", "C01=b.mp4"])


# --------------------------------------------------------------------------- caption


class CaptionTest(StudioCase):
    def check(self, path):
        return validate.check_caption(path, self.prod_path, self.root)

    def test_valid_caption(self):
        rep = self.check(self.write_caption())
        self.assertEqual(rep.errors, [])
        self.assertEqual(rep.warnings, [])

    def test_unverified_claim_and_claim_needed(self):
        rep = self.check(self.write_caption(claims_used=["Keeps drinks hot"]))
        self.assertIn("not a verified claim", " ".join(rep.errors))
        cap = self.write_caption(captions=[{"platform": "TikTok", "text": "[CLAIM NEEDED: dishwasher safe]", "hashtags": [], "disclosure": "#ad"}])
        rep = self.check(cap)
        self.assertIn("[CLAIM NEEDED]", " ".join(rep.errors))
        self.assertIn("Instagram Reels", " ".join(rep.warnings))

    def test_schema_rules(self):
        bad = self.write_caption(captions=[{"platform": "TikTok", "text": "x", "hashtags": ["#two words"], "disclosure": ""}])
        text = " ".join(self.check(bad).errors)
        self.assertIn("hashtags", text)
        self.assertIn("disclosure", text)
        dup = self.write_caption(captions=[{"platform": "TikTok", "text": "a", "hashtags": [], "disclosure": "#ad"}] * 2)
        self.assertIn("two captions", " ".join(self.check(dup).errors))


# --------------------------------------------------------------------------- approve


class ApproveTest(StudioCase):
    def test_demo_cannot_be_approved(self):
        text = " ".join(approve.approval_blockers(self.prod_path, self.root))
        self.assertIn("RENDERED_PENDING_QC", text)
        self.assertIn("has no score", text)
        self.assertIn("internal_test_only", text)
        self.assertIn("sample data", text)

    def test_failing_score_blocks(self):
        self.make_deliverable()
        prod = read_json(self.prod_path)
        prod["quality_checks"][3]["score"] = 2
        write_json(self.prod_path, prod)
        self.assertIn("QC04 C01 scored 2", " ".join(approve.approval_blockers(self.prod_path, self.root)))

    def test_approve_needs_matching_job_id(self):
        self.make_deliverable()
        before = self.prod_path.read_text()
        with self.assertRaisesRegex(approve.ApprovalError, "did not match"):
            approve.approve(self.prod_path, "Rina", lambda _: "wrong", root=self.root)
        self.assertEqual(self.prod_path.read_text(), before)
        p = approve.approve(self.prod_path, "Rina", lambda _: "demo-001", today="2026-11-19", root=self.root)
        self.assertEqual(p["status"], "APPROVED")
        self.assertEqual(p["human_review"]["reviewer"], "Rina")
        self.assertEqual(validate.check_production(self.prod_path, root=self.root).errors, [])

    def test_cli_refuses_without_a_terminal(self):
        proc = subprocess.run([sys.executable, str(REPO_ROOT / "tools/approve.py"), str(self.prod_path), "--reviewer", "Bot"],
                              stdin=subprocess.DEVNULL, capture_output=True, text=True)
        self.assertEqual(proc.returncode, 2)
        self.assertIn("interactive terminal", proc.stderr)


# --------------------------------------------------------------------------- package_delivery


@unittest.skipUnless(HAVE_FFMPEG and HAVE_FONT, SKIP_FFMPEG_MSG + " (and a font for drawtext)")
class DeliveryTest(StudioCase):
    def edit(self):
        return quiet(assemble.assemble, self.prod_path, takes={"C01": self.clip()}, output=self.tmp / "edit.mp4",
                     size=SMALL, root=self.root)["output"]

    def test_blocked_until_approved(self):
        video = self.edit()
        with self.assertRaises(package_delivery.DeliveryError) as cm:
            package_delivery.package(self.prod_path, video, self.write_caption(), root=self.root)
        text = str(cm.exception)
        self.assertIn("approve.py", text)
        self.assertIn("sample data", text)

    def test_caption_is_required(self):
        self.make_deliverable(status="APPROVED")
        prod = read_json(self.prod_path)
        prod["human_review"].update(reviewer="Rina", approved_on="2026-11-19")
        write_json(self.prod_path, prod)
        with self.assertRaisesRegex(package_delivery.DeliveryError, "no --caption"):
            package_delivery.package(self.prod_path, self.edit(), None, root=self.root)

    def test_packages_an_approved_production(self):
        self.make_deliverable()
        approve.approve(self.prod_path, "Rina", lambda _: "demo-001", today="2026-11-19", root=self.root)
        video = self.edit()
        r = package_delivery.package(self.prod_path, video, self.write_caption(), root=self.root)
        out = r["dir"]
        self.assertEqual(out, self.prod_path.parent / "delivery")
        self.assertTrue((out / "demo-001_final.mp4").exists())
        self.assertEqual(probe_video(out / "demo-001_final.mp4")["sha256"], probe_video(video)["sha256"])
        tiktok = (out / "caption_tiktok.txt").read_text()
        self.assertIn("#ad", tiktok)
        self.assertIn("This video was made with AI.", tiktok)
        self.assertTrue((out / "caption_instagram-reels.txt").exists())
        doc = (out / "DELIVERY.md").read_text()
        self.assertIn("Approved by **Rina** on 2026-11-19", doc)
        self.assertIn("Nothing has been uploaded or posted", doc)
        self.assertIn("Keeps drinks cold for up to 24 hours", doc)
        with self.assertRaisesRegex(package_delivery.DeliveryError, "--overwrite"):
            package_delivery.package(self.prod_path, video, self.write_caption(), root=self.root)
        package_delivery.package(self.prod_path, video, self.write_caption(), overwrite=True, root=self.root)

    def test_rejects_wrong_length_video(self):
        self.make_deliverable()
        approve.approve(self.prod_path, "Rina", lambda _: "demo-001", today="2026-11-19", root=self.root)
        raw = self.clip("raw.mp4", colors=("red", "lime", "blue", "white"))
        with self.assertRaisesRegex(package_delivery.DeliveryError, "the plan is 8s"):
            package_delivery.package(self.prod_path, raw, self.write_caption(), root=self.root)


if __name__ == "__main__":
    unittest.main()
