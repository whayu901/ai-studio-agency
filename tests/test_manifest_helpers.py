"""Unit tests for timestamp/filename helpers (no FFmpeg needed)."""

from __future__ import annotations

import unittest

import helpers  # noqa: F401  (adds tools/ to sys.path)

from extract_frames import plan_timestamps
from generate_manifest import ToolError, build_manifest, format_timecode, frame_filename, parse_frame_filename


class TimecodeTest(unittest.TestCase):
    def test_format(self):
        self.assertEqual(format_timecode(0), "00:00:00.000")
        self.assertEqual(format_timecode(1.5), "00:00:01.500")
        self.assertEqual(format_timecode(61.0004), "00:01:01.000")
        self.assertEqual(format_timecode(3723.4567), "01:02:03.457")


class FrameFilenameTest(unittest.TestCase):
    def test_roundtrip(self):
        name = frame_filename(7, 12.345, "jpg")
        self.assertEqual(name, "frame_0007_00012345ms.jpg")
        self.assertEqual(parse_frame_filename(name), (7, 12.345, "jpg"))

    def test_rejects_other_names(self):
        self.assertIsNone(parse_frame_filename("frame_1_2.jpg"))
        self.assertIsNone(parse_frame_filename("notes.md"))

    def test_sort_order_equals_time_order(self):
        times = [i * 0.5 for i in range(250)]
        names = [frame_filename(i + 1, t, "jpg") for i, t in enumerate(times)]
        self.assertEqual(sorted(names), names)


class PlanTimestampsTest(unittest.TestCase):
    def test_basic(self):
        self.assertEqual(plan_timestamps(0, 4, 1, 0.02), [0, 1, 2, 3])

    def test_guard_drops_sample_at_the_very_end(self):
        self.assertEqual(plan_timestamps(0, 3.01, 1, 0.02), [0, 1, 2])

    def test_no_float_drift(self):
        ts = plan_timestamps(0, 3, 0.1, 0.02)
        self.assertEqual(len(ts), 30)
        self.assertEqual(ts[-1], 2.9)

    def test_invalid_interval(self):
        with self.assertRaises(ToolError):
            plan_timestamps(0, 4, 0, 0.02)


class BuildManifestTest(unittest.TestCase):
    def test_rejects_unknown_rights_basis(self):
        with self.assertRaises(ToolError):
            build_manifest(
                {}, [], rights_basis="found_it_online", rights_note=None, interval=1, start=0, end=1,
                max_frames=1, fit=False, planned=0, truncated=False, image_format="jpg", max_long_edge=None, audio=None,
            )


if __name__ == "__main__":
    unittest.main()
