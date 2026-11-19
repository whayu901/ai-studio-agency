"""Exact-script mode, performance modes, claim flags and Seedance prompts (audit fixes)."""

from __future__ import annotations

import copy
import shutil
import unittest

from helpers import REPO_ROOT, make_temp_repo, read_json, write_json

import validate

PROD = "briefs/demo-001/expected-production.json"
BRIEF = "briefs/demo-001/brief.json"


class ModeCase(unittest.TestCase):
    def setUp(self):
        self.root = make_temp_repo()
        self.brief_path = self.root / BRIEF
        self.prod_path = self.root / "outputs" / "t" / "production.json"
        self.prod = read_json(REPO_ROOT / PROD)

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def check(self, prod=None, brief=None, ready=False):
        if brief is not None:
            write_json(self.brief_path, brief)
        write_json(self.prod_path, prod or self.prod)
        return validate.check_production(self.prod_path, check_ready=ready, root=self.root)

    def errors(self, rep) -> str:
        return "\n".join(rep.errors)

    def warnings(self, rep) -> str:
        return "\n".join(rep.warnings)


class ExactScriptTest(ModeCase):
    def custom_brief(self, text, exact=None):
        b = read_json(self.brief_path)
        b["script"] = {"mode": "custom", "custom_script": text, "language": "en"}
        if exact is not None:
            b["script"]["exact_script"] = exact
        return b

    def test_changed_custom_script_is_an_error(self):
        b = self.custom_brief("Hello there. This is my own line, kept exactly.")
        p = copy.deepcopy(self.prod)
        p["script"] = "Hello there. This is my line."
        self.assertIn("exact-script mode", self.errors(self.check(p, b)))

    def test_identical_script_passes_whitespace_insensitive(self):
        b = self.custom_brief("Hello there.  This is my own line,\nkept exactly.")
        p = copy.deepcopy(self.prod)
        p["script"] = "Hello there. This is my own line, kept exactly."
        self.assertNotIn("exact-script", self.errors(self.check(p, b)))

    def test_exact_false_allows_trimming(self):
        b = self.custom_brief("Hello there. This is my own line, kept exactly.", exact=False)
        p = copy.deepcopy(self.prod)
        p["script"] = "Hello there."
        self.assertNotIn("exact-script", self.errors(self.check(p, b)))

    def test_empty_draft_script_is_not_flagged(self):
        b = self.custom_brief("Hello there.")
        p = copy.deepcopy(self.prod)
        p["script"] = ""
        self.assertNotIn("exact-script", self.errors(self.check(p, b)))

    def test_custom_mode_without_text_is_invalid_brief(self):
        b = self.custom_brief(None)
        write_json(self.brief_path, b)
        _, rep = validate.check_brief(self.brief_path, self.root)
        self.assertIn("custom_script is empty", self.errors(rep))


class ClaimFlagTest(ModeCase):
    def test_claim_needed_blocks_ready_and_warns_otherwise(self):
        p = copy.deepcopy(self.prod)
        p["script"] = p["script"] + " [CLAIM NEEDED: keeps drinks hot]"
        self.assertIn("[CLAIM NEEDED]", self.warnings(self.check(p)))
        self.assertIn("[CLAIM NEEDED]", self.errors(self.check(p, ready=True)))

    def test_prohibited_phrase_in_script_warns(self):
        p = copy.deepcopy(self.prod)
        p["script"] = "It keeps drinks hot all day."
        self.assertIn("keeps drinks hot", self.warnings(self.check(p)))

    def test_prohibited_terms_parsing(self):
        brief = {"prohibited_claims": ["Kulit asli / genuine leather / real leather", "Waterproof, anti air (not in the listing)"]}
        terms = validate.prohibited_terms(brief)
        for t in ("kulit asli", "genuine leather", "real leather", "waterproof", "anti air"):
            self.assertIn(t, terms)
        self.assertNotIn("not in the listing", terms)


class PerformanceModeTest(ModeCase):
    def test_fashion_showcase_rejects_dialogue(self):
        p = copy.deepcopy(self.prod)
        p["performance_mode"] = "fashion_showcase"
        text = self.errors(self.check(p))
        self.assertIn("fashion_showcase: shot", text)
        self.assertIn("fashion_showcase: flow clip", text)

    def test_fashion_showcase_without_dialogue_is_valid(self):
        p = copy.deepcopy(self.prod)
        p["performance_mode"] = "fashion_showcase"
        p["script"] = ""
        for s in p["storyboard"]:
            s["dialogue"] = None
        for c in p["flow_prompts"]:
            c["dialogue"] = None
        rep = self.check(p)
        self.assertEqual([e for e in rep.errors if "fashion" in e], [])
        ready = self.check(p, ready=True)
        self.assertNotIn("script is empty", self.errors(ready))

    def test_voiceover_rejects_on_camera_speech(self):
        p = copy.deepcopy(self.prod)
        p["performance_mode"] = "voiceover_showcase"
        self.assertIn("voiceover_showcase: flow clip", self.errors(self.check(p)))
        for c in p["flow_prompts"]:
            c["dialogue"] = None
        self.assertNotIn("voiceover_showcase", self.errors(self.check(p)))

    def test_unknown_mode_fails_schema(self):
        p = copy.deepcopy(self.prod)
        p["performance_mode"] = "dancing"
        self.assertTrue(self.check(p).errors)


class SeedanceTest(ModeCase):
    def seedance_prod(self):
        p = copy.deepcopy(self.prod)
        p["video_provider"] = "seedance"
        ingredient = p["flow_prompts"][0]["ingredients"][0]
        p["seedance_prompts"] = [{
            "clip_id": "C01", "start_seconds": 0, "end_seconds": 8, "model_id": "seedance-web",
            "generation_mode": "image_to_video", "first_frame": ingredient, "reference_images": [],
            "prompt": "She lifts the tumbler.", "motion": ["slow lift"], "camera": "static", "dialogue": None,
        }]
        return p

    def test_valid_seedance_prompt(self):
        rep = self.check(self.seedance_prod())
        self.assertEqual([e for e in rep.errors if "seedance" in e], [])
        self.assertIn("not one of the offered lengths", self.warnings(rep))

    def test_seedance_limits(self):
        p = self.seedance_prod()
        c = p["seedance_prompts"][0]
        c["first_frame"] = None
        c["reference_images"] = ["characters/female_01/references/x.jpg"]
        text = self.errors(self.check(p))
        self.assertIn("image_to_video needs first_frame", text)
        self.assertIn("belongs to another character", text)

    def test_seedance_provider_needs_prompts_when_ready(self):
        p = copy.deepcopy(self.prod)
        p["video_provider"] = "seedance"
        self.assertIn("no seedance_prompts", self.errors(self.check(p, ready=True)))

    def test_continuity_must_reference_planned_clips(self):
        p = copy.deepcopy(self.prod)
        p["continuity"] = [{"from_clip": "C01", "to_clip": "C09", "carry_over": ["same top"]}]
        self.assertIn("C09 is not a planned clip", self.errors(self.check(p)))

    def test_repo_seedance_config_is_valid(self):
        cfg, rep = validate.load_seedance_config(REPO_ROOT)
        self.assertEqual(rep.errors, [])
        self.assertFalse(cfg["models"][0]["verified"])


if __name__ == "__main__":
    unittest.main()
