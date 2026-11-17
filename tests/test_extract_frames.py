"""End-to-end tests for tools/extract_frames.py using synthetic videos made by FFmpeg."""

from __future__ import annotations

import io
import shutil
import subprocess
import sys
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path

from helpers import HAVE_FFMPEG, REPO_ROOT, SKIP_FFMPEG_MSG, dominant, image_size, make_color_video, pixel_rgb, read_json

import extract_frames
import generate_manifest
import validate


def run_cli(*argv):
    out, err = io.StringIO(), io.StringIO()
    with redirect_stdout(out), redirect_stderr(err):
        code = extract_frames.main([str(a) for a in argv])
    return code, out.getvalue(), err.getvalue()


@unittest.skipUnless(HAVE_FFMPEG, SKIP_FFMPEG_MSG)
class ExtractFramesTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = Path(tempfile.mkdtemp(prefix="acs-frames-"))
        # 4 s portrait video: red 0-1 s, lime 1-2 s, blue 2-3 s, white 3-4 s, with a tone.
        cls.video = make_color_video(cls.tmp / "colors.mp4")
        cls.silent_mov = make_color_video(cls.tmp / "silent.mov", colors=("red", "blue"), audio=False)

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def out(self, name):
        return self.tmp / "out" / name

    # -- core behaviour ---------------------------------------------------------------

    def test_default_one_frame_per_second(self):
        code, stdout, _ = run_cli(self.video, "--rights", "internal_test_only", "--output", self.out("default"))
        self.assertEqual(code, 0, stdout)
        m = read_json(self.out("default") / "manifest.json")
        self.assertEqual([f["timestamp_seconds"] for f in m["frames"]], [0.0, 1.0, 2.0, 3.0])
        self.assertEqual(m["sampling"]["interval_seconds"], 1.0)
        self.assertFalse(m["sampling"]["truncated"])
        self.assertEqual(m["frames"][2]["timecode"], "00:00:02.000")

    def test_frame_content_matches_timestamp(self):
        code, _, _ = run_cli(self.video, "--rights", "owned", "--start", "0.5", "--output", self.out("colors"))
        self.assertEqual(code, 0)
        m = read_json(self.out("colors") / "manifest.json")
        self.assertEqual([f["timestamp_seconds"] for f in m["frames"]], [0.5, 1.5, 2.5, 3.5])
        seen = [dominant(pixel_rgb(self.out("colors") / f["path"])) for f in m["frames"]]
        self.assertEqual(seen, ["red", "lime", "blue", "white"])

    def test_manifest_is_schema_valid_and_ordered(self):
        run_cli(self.video, "--rights", "licensed", "--rights-note", "test licence", "--output", self.out("valid"))
        path = self.out("valid") / "manifest.json"
        report = validate.check_manifest(path)
        self.assertEqual(report.errors, [])
        m = read_json(path)
        names = [Path(f["path"]).name for f in m["frames"]]
        self.assertEqual(names, sorted(names), "file names must sort in time order")
        self.assertEqual([f["index"] for f in m["frames"]], list(range(1, len(names) + 1)))
        self.assertEqual(m["rights"], {"basis": "licensed", "note": "test licence"})
        self.assertEqual(m["source"]["display_width"], 180)
        self.assertEqual(m["source"]["display_height"], 320)
        self.assertEqual(len(m["source"]["sha256"]), 64)
        self.assertTrue(m["limitations"])
        self.assertTrue((self.out("valid") / "INDEX.md").exists())

    def test_custom_interval(self):
        run_cli(self.video, "--rights", "owned", "--interval", "0.5", "--output", self.out("half"))
        m = read_json(self.out("half") / "manifest.json")
        self.assertEqual([f["timestamp_seconds"] for f in m["frames"]], [0.0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5])

    def test_max_frames_truncates_and_warns(self):
        code, stdout, _ = run_cli(self.video, "--rights", "owned", "--interval", "0.5", "--max-frames", "3", "--output", self.out("trunc"))
        self.assertEqual(code, 0)
        m = read_json(self.out("trunc") / "manifest.json")
        self.assertEqual(len(m["frames"]), 3)
        self.assertTrue(m["sampling"]["truncated"])
        self.assertEqual(m["sampling"]["planned_frame_count"], 8)
        self.assertIn("max-frames", stdout)

    def test_fit_spreads_frames_over_whole_video(self):
        run_cli(self.video, "--rights", "owned", "--interval", "0.25", "--max-frames", "4", "--fit", "--output", self.out("fit"))
        m = read_json(self.out("fit") / "manifest.json")
        self.assertEqual(len(m["frames"]), 4)
        self.assertFalse(m["sampling"]["truncated"])
        self.assertAlmostEqual(m["sampling"]["interval_seconds"], 1.0, places=3)
        self.assertEqual(m["frames"][-1]["timestamp_seconds"], 3.0)

    def test_start_and_end_window(self):
        run_cli(self.video, "--rights", "owned", "--start", "1", "--end", "3", "--output", self.out("window"))
        m = read_json(self.out("window") / "manifest.json")
        self.assertEqual([f["timestamp_seconds"] for f in m["frames"]], [1.0, 2.0])

    def test_extract_audio(self):
        run_cli(self.video, "--rights", "owned", "--extract-audio", "--output", self.out("audio"))
        m = read_json(self.out("audio") / "manifest.json")
        self.assertEqual(m["audio"]["path"], "audio.wav")
        self.assertEqual(m["audio"]["purpose"], "manual_review_only")
        self.assertGreater((self.out("audio") / "audio.wav").stat().st_size, 1000)

    def test_mov_without_audio(self):
        code, stdout, _ = run_cli(self.silent_mov, "--rights", "owned", "--extract-audio", "--output", self.out("mov"))
        self.assertEqual(code, 0)
        m = read_json(self.out("mov") / "manifest.json")
        self.assertIsNone(m["audio"])
        self.assertFalse(m["source"]["has_audio"])
        self.assertEqual(len(m["frames"]), 2)
        self.assertIn("no audio", stdout)
        self.assertEqual(validate.check_manifest(self.out("mov") / "manifest.json").errors, [])

    def test_downscale_long_edge(self):
        run_cli(self.video, "--rights", "owned", "--max-long-edge", "160", "--format", "png", "--output", self.out("small"))
        m = read_json(self.out("small") / "manifest.json")
        w, h = image_size(self.out("small") / m["frames"][0]["path"])
        self.assertLessEqual(max(w, h), 160)
        self.assertGreater(h, w, "portrait orientation must be kept")
        self.assertTrue(m["frames"][0]["path"].endswith(".png"))

    # -- safety / input checks ------------------------------------------------------------

    def test_rejects_urls(self):
        code, _, err = run_cli("https://www.youtube.com/watch?v=abc", "--rights", "owned")
        self.assertEqual(code, 2)
        self.assertIn("never downloads", err)

    def test_rejects_other_extensions(self):
        bad = self.tmp / "clip.avi"
        bad.write_bytes(b"not a video")
        code, _, err = run_cli(bad, "--rights", "owned")
        self.assertEqual(code, 2)
        self.assertIn(".mp4 or .mov", err)

    def test_rejects_missing_file(self):
        code, _, err = run_cli(self.tmp / "nope.mp4", "--rights", "owned")
        self.assertEqual(code, 2)
        self.assertIn("not found", err)

    def test_rejects_unreadable_video(self):
        fake = self.tmp / "fake.mp4"
        fake.write_bytes(b"\x00" * 64)
        code, _, err = run_cli(fake, "--rights", "owned", "--output", self.out("fake"))
        self.assertEqual(code, 2)
        self.assertIn("ffprobe", err)

    def test_rights_flag_is_required(self):
        with redirect_stderr(io.StringIO()), self.assertRaises(SystemExit) as ctx:
            extract_frames.main([str(self.video)])
        self.assertEqual(ctx.exception.code, 2)

    def test_refuses_to_overwrite_without_flag_and_keeps_user_files(self):
        out = self.out("reuse")
        self.assertEqual(run_cli(self.video, "--rights", "owned", "--output", out)[0], 0)
        (out / "my-notes.md").write_text("keep me")
        code, _, err = run_cli(self.video, "--rights", "owned", "--output", out)
        self.assertEqual(code, 2)
        self.assertIn("--overwrite", err)
        code, _, _ = run_cli(self.video, "--rights", "owned", "--interval", "2", "--output", out, "--overwrite")
        self.assertEqual(code, 0)
        self.assertEqual((out / "my-notes.md").read_text(), "keep me")
        self.assertEqual(len(list((out / "frames").iterdir())), 2, "old frames must be removed")

    # -- manifest regeneration + script entry point -----------------------------------------

    def test_generate_manifest_rebuilds_from_frames(self):
        out = self.out("rebuild")
        run_cli(self.video, "--rights", "owned", "--output", out)
        original = read_json(out / "manifest.json")
        (out / "manifest.json").unlink()
        with redirect_stdout(io.StringIO()):
            code = generate_manifest.main([str(out), "--source", str(self.video), "--rights", "owned"])
        self.assertEqual(code, 0)
        rebuilt = read_json(out / "manifest.json")
        self.assertEqual(
            [(f["index"], f["timestamp_seconds"], f["path"]) for f in rebuilt["frames"]],
            [(f["index"], f["timestamp_seconds"], f["path"]) for f in original["frames"]],
        )
        self.assertEqual(validate.check_manifest(out / "manifest.json").errors, [])

    def test_script_runs_as_command(self):
        out = self.out("cli")
        proc = subprocess.run(
            [sys.executable, str(REPO_ROOT / "tools" / "extract_frames.py"), str(self.video), "--rights", "internal_test_only", "--output", str(out)],
            capture_output=True,
            text=True,
        )
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn("Manifest:", proc.stdout)


if __name__ == "__main__":
    unittest.main()
