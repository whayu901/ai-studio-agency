"""Tests for new_production.py, render_sheet.py and log_attempt.py."""

from __future__ import annotations

import csv
import io
import os
import shutil
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path

from helpers import REPO_ROOT, make_temp_repo, read_json, write_json

import log_attempt
import new_production
import render_sheet
import validate

PROD = "briefs/demo-001/expected-production.json"


def quiet(fn, *a, **kw):
    with redirect_stdout(io.StringIO()) as out, redirect_stderr(io.StringIO()) as err:
        result = fn(*a, **kw)
    return result, out.getvalue(), err.getvalue()


class ReadyRepoCase(unittest.TestCase):
    """A temp repo where female_02 is active and all demo images exist."""

    def setUp(self):
        self.root = make_temp_repo()
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


# --------------------------------------------------------------------------- new_production


class NewProductionTest(unittest.TestCase):
    def setUp(self):
        self.root = make_temp_repo()

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def test_creates_valid_draft(self):
        path = new_production.scaffold("tumbler-01", Path("briefs/demo-001/brief.json"), "female_02", root=self.root)
        self.assertEqual(path, self.root / "outputs/tumbler-01/production.json")
        p = read_json(path)
        self.assertEqual(p["status"], "DRAFT")
        self.assertEqual(p["duration_seconds"], 8)
        self.assertEqual(p["aspect_ratio"], "9:16")
        self.assertEqual([q["check_id"] for q in p["quality_checks"]], [f"QC{i:02d}" for i in range(1, 11)])
        self.assertEqual(p["reference_assets"][0]["kind"], "product_image")
        self.assertEqual(p["reference_assets"][0]["rights_basis"], "internal_test_only", "sample brief → internal test only")
        self.assertEqual(validate.check_production(path, root=self.root).errors, [])

    def test_uses_preferred_character_from_brief(self):
        path = new_production.scaffold("tumbler-02", Path("briefs/demo-001/brief.json"), None, root=self.root)
        self.assertEqual(read_json(path)["character_id"], "female_02")

    def test_real_brief_gets_unknown_rights(self):
        brief = read_json(self.root / "briefs/demo-001/brief.json")
        brief["is_sample"] = False
        write_json(self.root / "briefs/real/brief.json", brief)
        path = new_production.scaffold("real-01", Path("briefs/real/brief.json"), "female_01", root=self.root)
        self.assertEqual(read_json(path)["reference_assets"][0]["rights_basis"], "unknown")

    def test_refuses_overwrite(self):
        new_production.scaffold("dup", Path("briefs/demo-001/brief.json"), "female_02", root=self.root)
        with self.assertRaisesRegex(new_production.ScaffoldError, "already exists"):
            new_production.scaffold("dup", Path("briefs/demo-001/brief.json"), "female_02", root=self.root)

    def test_rejects_unknown_character_and_bad_job(self):
        with self.assertRaisesRegex(new_production.ScaffoldError, "not in characters/registry.json"):
            new_production.scaffold("x1", Path("briefs/demo-001/brief.json"), "male_09", root=self.root)
        with self.assertRaisesRegex(new_production.ScaffoldError, "lowercase"):
            new_production.scaffold("Bad Job", Path("briefs/demo-001/brief.json"), "female_02", root=self.root)

    def test_reference_mode_needs_existing_manifest(self):
        with self.assertRaisesRegex(new_production.ScaffoldError, "needs --manifest"):
            new_production.scaffold("ref1", Path("briefs/demo-001/brief.json"), "female_02", mode="reference_guided", root=self.root)
        with self.assertRaisesRegex(new_production.ScaffoldError, "manifest not found"):
            new_production.scaffold("ref1", Path("briefs/demo-001/brief.json"), "female_02", mode="reference_guided",
                                    manifest=Path("outputs/analysis/none/manifest.json"), root=self.root)

    def test_cli_on_real_repo_reports_errors_cleanly(self):
        code, _, err = quiet(new_production.main, ["--job", "x-cli", "--brief", "briefs/missing/brief.json"])
        self.assertEqual(code, 2)
        self.assertIn("brief not found", err)


# --------------------------------------------------------------------------- render_sheet


class RenderSheetTest(ReadyRepoCase):
    def test_blocks_when_not_ready_on_real_repo(self):
        out = Path(tempfile.mkdtemp()) / "sheet.md"
        code, _, err = quiet(render_sheet.make_sheet, REPO_ROOT / PROD, out)
        self.assertEqual(code, 1)
        self.assertFalse(out.exists())
        self.assertIn("not ready", err)

    def test_preview_lists_blockers(self):
        out = Path(tempfile.mkdtemp()) / "sheet.md"
        code, _, _ = quiet(render_sheet.make_sheet, REPO_ROOT / PROD, out, True)
        self.assertEqual(code, 0)
        text = out.read_text()
        self.assertIn("NOT READY TO RENDER", text)
        self.assertIn("arka-tumbler-front.jpg is missing on disk", text)

    def test_ready_sheet_contents(self):
        code, stdout, _ = quiet(render_sheet.make_sheet, self.prod_path, None, False, self.root)
        self.assertEqual(code, 0, stdout)
        text = (self.prod_path.parent / "render-sheet.md").read_text()
        self.assertNotIn("NOT READY", text)
        self.assertIn("## C01 · 0–8 s (8 s) · Omni Flash 1.2 · Ingredients to Video · 9:16", text)
        prod = read_json(self.prod_path)
        self.assertIn(prod["flow_prompts"][0]["prompt"], text, "prompt must be copied verbatim")
        order = [text.index(p) for p in prod["flow_prompts"][0]["ingredients"]]
        self.assertEqual(order, sorted(order), "uploads must keep ingredient order")
        self.assertIn("QC05 Product integrity", text)
        self.assertIn("Nothing has been rendered", text)
        self.assertIn("5:00 PM (added in editing)", text)
        self.assertIn("log_attempt.py", text)

    def test_refuses_production_without_flow_prompts(self):
        prod = read_json(self.prod_path)
        prod["flow_prompts"] = []
        for s in prod["storyboard"]:
            s["clip_id"] = "C01"
        write_json(self.prod_path, prod)
        code, _, err = quiet(render_sheet.make_sheet, self.prod_path, None, True, self.root)
        self.assertEqual(code, 1)
        self.assertIn("no flow_prompts", err)

    def test_refuses_structurally_invalid_production(self):
        prod = read_json(self.prod_path)
        prod["character_id"] = "female_01"  # assets belong to female_02 → mixing
        write_json(self.prod_path, prod)
        code, out, err = quiet(render_sheet.make_sheet, self.prod_path, None, True, self.root)
        self.assertEqual(code, 1)
        self.assertIn("character mixing", out)


# --------------------------------------------------------------------------- log_attempt


ALL_SCORES = "QC01=5,QC02=4,QC03=4,QC04=3,QC05=5,QC06=4,QC07=3,QC08=3,QC09=4,QC10=5"


class LogAttemptTest(ReadyRepoCase):
    def setUp(self):
        super().setUp()
        self.log = self.root / "experiments" / "experiment-log.csv"
        self.template = REPO_ROOT / "experiments" / "experiment-log-template.csv"

    def log_it(self, **kw):
        kw.setdefault("credits", 20)
        kw.setdefault("scores", {})
        kw.setdefault("decision", "RETRY")
        return log_attempt.log_attempt(self.prod_path, kw.pop("clip", "C01"), log_path=self.log, template=self.template, **kw)

    def rows(self):
        with open(self.log, newline="") as fh:
            return list(csv.DictReader(fh))

    def test_creates_log_and_numbers_attempts(self):
        r1 = self.log_it(scores=log_attempt.parse_scores("QC01=4,QC04=2"), problems="extra finger")
        r2 = self.log_it(credits=25)
        self.assertTrue(r1["created_log"])
        rows = self.rows()
        self.assertEqual([r["experiment_id"] for r in rows], ["EXP-0001", "EXP-0002"])
        self.assertEqual([r["generation_attempts"] for r in rows], ["1", "2"])
        first = rows[0]
        self.assertEqual(first["qc_face"], "4")
        self.assertEqual(first["qc_hands"], "2")
        self.assertEqual(first["quality_score_avg"], "3.00")
        self.assertEqual(first["character_id"], "female_02")
        self.assertEqual(first["prompt_versions"], "original-creation@0.1.1;google-flow@0.2.0")
        self.assertEqual(first["video_duration_seconds"], "8")
        self.assertEqual(r1["failed"], ["QC04=2 (< 3)"])
        self.assertEqual(r2["attempt"], 2)
        with open(self.log, newline="") as fh:
            self.assertEqual(next(csv.reader(fh)), log_attempt.template_header(self.template))

    def test_selected_requires_all_scores(self):
        with self.assertRaisesRegex(log_attempt.LogError, "needs every QC score"):
            self.log_it(scores={"QC01": 5}, decision="SELECTED")

    def test_update_production_writes_scores_but_never_approves(self):
        self.log_it(scores=log_attempt.parse_scores(ALL_SCORES), decision="APPROVED_FOR_DELIVERY", update_production=True)
        prod = read_json(self.prod_path)
        self.assertEqual(prod["status"], "RENDERED_PENDING_QC")
        self.assertEqual({q["check_id"]: q["score"] for q in prod["quality_checks"]}["QC01"], 5)
        self.assertIsNone(prod["human_review"]["reviewer"])
        self.assertEqual(validate.check_production(self.prod_path, root=self.root).errors, [])

    def test_rejects_bad_input(self):
        with self.assertRaisesRegex(log_attempt.LogError, "1–5"):
            log_attempt.parse_scores("QC01=7")
        with self.assertRaisesRegex(log_attempt.LogError, "bad score"):
            log_attempt.parse_scores("face=4")
        with self.assertRaisesRegex(log_attempt.LogError, "given twice"):
            log_attempt.parse_scores("QC01=4,QC01=5")
        with self.assertRaisesRegex(log_attempt.LogError, "not in this production"):
            self.log_it(clip="C09")
        with self.assertRaisesRegex(log_attempt.LogError, "negative"):
            self.log_it(credits=-1)
        with self.assertRaisesRegex(log_attempt.LogError, "unknown QC"):
            self.log_it(scores={"QC77": 3})

    def test_refuses_log_with_different_columns(self):
        self.log.parent.mkdir(parents=True, exist_ok=True)
        self.log.write_text("a,b,c\n1,2,3\n")
        with self.assertRaisesRegex(log_attempt.LogError, "different columns"):
            self.log_it()

    def test_cli(self):
        code, out, _ = quiet(log_attempt.main, [str(self.prod_path), "--clip", "C01", "--credits", "20", "--scores", "QC01=3",
                                                "--log", str(self.log), "--cost", "1500", "--currency", "IDR"])
        self.assertEqual(code, 0)
        self.assertIn("EXP-0001", out)
        self.assertIn("FAILED checks: QC01=3 (< 4)", out)
        self.assertEqual(self.rows()[0]["estimated_cost"], "1500")


if __name__ == "__main__":
    unittest.main()
