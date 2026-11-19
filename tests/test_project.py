"""Project-structure checks: required files, prompt front matter, git ignore rules."""

from __future__ import annotations

import csv
import re
import shutil
import subprocess
import unittest

from helpers import REPO_ROOT

REQUIRED = [
    "README.md",
    "CLAUDE.md",
    ".gitignore",
    "characters/registry.json",
    "characters/female_01/character.json",
    "characters/female_02/character.json",
    "prompts/original-creation.md",
    "prompts/reference-analysis.md",
    "prompts/google-flow.md",
    "tools/extract_frames.py",
    "tools/generate_manifest.py",
    "tools/validate.py",
    "tools/new_production.py",
    "tools/render_sheet.py",
    "tools/log_attempt.py",
    "tools/postprod.py",
    "tools/review_render.py",
    "tools/assemble.py",
    "tools/approve.py",
    "tools/package_delivery.py",
    "prompts/caption.md",
    "schemas/caption.schema.json",
    "prompts/creative-director.md",
    "prompts/scriptwriter.md",
    "prompts/storyboard.md",
    "prompts/character-consistency.md",
    "briefs/demo-001/brief.json",
    "briefs/demo-001/expected-production.json",
    "config/google-flow.json",
    "docs/google-flow-production-guide.md",
    "docs/quality-control-checklist.md",
    "experiments/experiment-log-template.csv",
]
ACTIVE_PROMPTS = ["original-creation", "reference-analysis", "google-flow", "creative-director", "scriptwriter", "storyboard", "character-consistency", "caption"]


class StructureTest(unittest.TestCase):
    def test_required_files_exist(self):
        missing = [p for p in REQUIRED if not (REPO_ROOT / p).exists()]
        self.assertEqual(missing, [])

    def test_active_prompts_have_versioned_front_matter(self):
        for pid in ACTIVE_PROMPTS:
            with self.subTest(prompt=pid):
                text = (REPO_ROOT / "prompts" / f"{pid}.md").read_text(encoding="utf-8")
                m = re.match(r"^---\n(.*?)\n---\n", text, re.S)
                self.assertIsNotNone(m, "missing front matter")
                fm = m.group(1)
                self.assertIn(f"id: {pid}", fm)
                self.assertRegex(fm, r"version: \d+\.\d+\.\d+")
                self.assertIn("status: active", fm)

    def test_expected_production_records_current_prompt_versions(self):
        import json

        prod = json.loads((REPO_ROOT / "briefs/demo-001/expected-production.json").read_text())
        for pid, ver in prod["prompt_versions"].items():
            text = (REPO_ROOT / "prompts" / f"{pid}.md").read_text(encoding="utf-8")
            self.assertIn(f"version: {ver}", text, f"{pid} version drifted from the example")

    def test_experiment_template_rows_match_header(self):
        with open(REPO_ROOT / "experiments/experiment-log-template.csv", newline="", encoding="utf-8") as fh:
            rows = list(csv.reader(fh))
        header = rows[0]
        for col in ("experiment_id", "production_mode", "character_id", "flow_model", "prompt_versions", "video_duration_seconds",
                    "generation_attempts", "credits_consumed", "estimated_cost", "quality_score_avg", "problems_encountered",
                    "final_approval_status"):
            self.assertIn(col, header)
        for row in rows[1:]:
            self.assertEqual(len(row), len(header))


@unittest.skipUnless(shutil.which("git") and (REPO_ROOT / ".git").exists(), "git repository not available")
class GitIgnoreTest(unittest.TestCase):
    def ignored(self, rel):
        return subprocess.run(["git", "check-ignore", "-q", "--no-index", rel], cwd=REPO_ROOT).returncode == 0

    def test_private_media_is_ignored(self):
        for rel in (
            "characters/female_01/references/female_01_front_01.jpg",
            "characters/female_02/references/anything.png",
            "assets/products/bottle.jpg",
            "assets/reference-videos/ref.mp4",
            "outputs/demo-001/production.json",
            "outputs/analysis/ref/frames/frame_0001_00000000ms.jpg",
            "experiments/experiment-log.csv",
            ".env",
            "render.mov",
        ):
            with self.subTest(path=rel):
                self.assertTrue(self.ignored(rel), f"{rel} should be ignored")

    def test_project_files_are_tracked(self):
        for rel in (
            "characters/female_01/character.json",
            "characters/female_01/references/.gitkeep",
            "experiments/experiment-log-template.csv",
            "briefs/demo-001/brief.json",
            "outputs/.gitkeep",
        ):
            with self.subTest(path=rel):
                self.assertFalse(self.ignored(rel), f"{rel} should NOT be ignored")


if __name__ == "__main__":
    unittest.main()
