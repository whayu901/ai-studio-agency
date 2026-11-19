"""Character registry (incl. anti-mixing) and production validation."""

from __future__ import annotations

import copy
import os
import shutil
import unittest
from pathlib import Path

from helpers import REPO_ROOT, make_temp_repo, read_json, write_json

import validate

PROD = "briefs/demo-001/expected-production.json"


def errors_text(report) -> str:
    return "\n".join(report.errors)


class RealRepoTest(unittest.TestCase):
    """The committed files themselves must be valid."""

    def test_registry_is_valid(self):
        profiles, rep = validate.load_characters(REPO_ROOT)
        self.assertEqual(rep.errors, [])
        self.assertEqual(sorted(profiles), ["female_01", "female_02"])
        for cid, p in profiles.items():
            # The registry holds user-filled data, so only check the invariant: an appearance
            # description may exist only once reference images back it up (never invented).
            has_refs = any(p["references"].values())
            if not has_refs:
                self.assertIsNone(p["physical_description"], f"{cid}: no reference images, so appearance must stay null")

    def test_flow_config_is_valid(self):
        cfg, rep = validate.load_flow_config(REPO_ROOT)
        self.assertEqual(rep.errors, [])
        self.assertEqual(cfg["default_model_id"], "omni-flash-1.2")

    def test_sample_brief_is_valid(self):
        brief, rep = validate.check_brief(REPO_ROOT / "briefs/demo-001/brief.json", REPO_ROOT)
        self.assertEqual(rep.errors, [])
        self.assertTrue(brief["is_sample"])

    def test_expected_production_is_valid(self):
        rep = validate.check_production(REPO_ROOT / PROD, root=REPO_ROOT)
        self.assertEqual(rep.errors, [])

    def test_expected_production_not_ready_without_images(self):
        rep = validate.check_production(REPO_ROOT / PROD, check_ready=True, root=REPO_ROOT)
        text = errors_text(rep)
        self.assertIn("status 'placeholder'", text)
        self.assertIn("missing on disk", text)


class TempRepoCase(unittest.TestCase):
    def setUp(self):
        self.root = make_temp_repo()

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def profile_path(self, cid):
        return self.root / "characters" / cid / "character.json"

    def edit_profile(self, cid, fn):
        p = read_json(self.profile_path(cid))
        fn(p)
        write_json(self.profile_path(cid), p)

    def add_image(self, rel, content=None):
        path = self.root / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content if content is not None else os.urandom(256))
        return rel

    def activate(self, cid):
        front = self.add_image(f"characters/{cid}/references/{cid}_front_01.jpg")
        close = self.add_image(f"characters/{cid}/references/{cid}_closeup_01.jpg")

        def fn(p):
            p["references"]["front"] = [front]
            p["references"]["close_up"] = [close]
            p["physical_description"] = "Written by a human from the images (test)."
            p["status"] = "active"
            p["commercial_use"].update(authorized=True, rights_holder="Test Studio", authorized_uses=["test"])

        self.edit_profile(cid, fn)


class RegistryTest(TempRepoCase):
    def check(self):
        return validate.load_characters(self.root)[1]

    def test_reference_in_other_characters_folder_is_mixing(self):
        self.edit_profile("female_01", lambda p: p["references"]["front"].append("characters/female_02/references/x.jpg"))
        self.assertIn("character mixing", errors_text(self.check()))

    def test_same_path_listed_twice_is_rejected(self):
        # Pattern allows any characters/<id>/ path; the ownership check must still catch it.
        self.edit_profile("female_01", lambda p: p["references"]["front"].append("characters/female_01/references/a.jpg"))
        self.edit_profile("female_02", lambda p: p["references"]["front"].append("characters/female_01/references/a.jpg"))
        text = errors_text(self.check())
        self.assertIn("outside characters/female_02/references/", text)

    def test_identical_image_content_across_characters_is_rejected(self):
        blob = b"same-image-bytes" * 20
        a = self.add_image("characters/female_01/references/female_01_front_01.jpg", blob)
        b = self.add_image("characters/female_02/references/female_02_front_01.jpg", blob)
        self.edit_profile("female_01", lambda p: p["references"]["front"].append(a))
        self.edit_profile("female_02", lambda p: p["references"]["front"].append(b))
        self.assertIn("identical content", errors_text(self.check()))

    def test_id_mismatch(self):
        self.edit_profile("female_02", lambda p: p.update(character_id="female_01"))
        self.assertIn("does not match registry id", errors_text(self.check()))

    def test_active_requires_authorization_images_and_description(self):
        self.edit_profile("female_01", lambda p: p.update(status="active"))
        text = errors_text(self.check())
        for fragment in ("'front' reference", "'close_up' reference", "physical_description", "authorized = true"):
            self.assertIn(fragment, text)

    def test_missing_file_is_error_only_when_active(self):
        self.edit_profile("female_01", lambda p: p["references"]["front"].append("characters/female_01/references/missing.jpg"))
        rep = self.check()
        self.assertEqual(rep.errors, [])
        self.assertTrue(any("missing on disk" in w for w in rep.warnings))

    def test_fully_set_up_character_passes(self):
        self.activate("female_02")
        rep = self.check()
        self.assertEqual(rep.errors, [])

    def test_unlisted_image_warns(self):
        self.add_image("characters/female_01/references/forgot.jpg")
        self.assertTrue(any("not listed" in w for w in self.check().warnings))

    def test_expired_license(self):
        self.edit_profile("female_01", lambda p: p["commercial_use"].update(expires_on="2020-01-01"))
        self.assertIn("expired", errors_text(self.check()))

    def test_schema_rejects_reference_outside_characters_tree(self):
        self.edit_profile("female_01", lambda p: p["references"]["front"].append("assets/products/x.jpg"))
        self.assertIn("does not match pattern", errors_text(self.check()))


class ProductionTest(TempRepoCase):
    def setUp(self):
        super().setUp()
        self.prod_path = self.root / PROD
        self.base = read_json(self.prod_path)

    def check(self, prod, ready=False):
        write_json(self.prod_path, prod)
        return validate.check_production(self.prod_path, check_ready=ready, root=self.root)

    def test_character_mixing_in_assets(self):
        p = copy.deepcopy(self.base)
        p["character_id"] = "female_01"  # but assets still point at female_02
        text = errors_text(self.check(p))
        self.assertIn("character mixing", text)
        self.assertIn("tagged 'female_02', production uses 'female_01'", text)

    def test_clip_longer_than_model_limit(self):
        p = copy.deepcopy(self.base)
        p["duration_seconds"] = 10
        p["storyboard"][-1]["end_seconds"] = 10
        p["flow_prompts"][0]["end_seconds"] = 10
        self.assertIn("split it", errors_text(self.check(p)))

    def test_storyboard_gap(self):
        p = copy.deepcopy(self.base)
        p["storyboard"][1]["start_seconds"] = 2.5
        self.assertIn("gap", errors_text(self.check(p)))

    def test_unverified_claim(self):
        p = copy.deepcopy(self.base)
        p["claims_used"].append("Keeps drinks hot for 12 hours")
        self.assertIn("not a verified claim", errors_text(self.check(p)))

    def test_unknown_model_and_unsupported_mode(self):
        p = copy.deepcopy(self.base)
        p["flow_prompts"][0]["model_id"] = "made-up-model"
        self.assertIn("not in config/google-flow.json", errors_text(self.check(p)))

        cfg_path = self.root / "config/google-flow.json"
        cfg = read_json(cfg_path)
        cfg["models"][0]["generation_modes"] = ["text_to_video"]
        write_json(cfg_path, cfg)
        self.assertIn("not configured for ingredients_to_video", errors_text(self.check(copy.deepcopy(self.base))))

    def test_too_many_ingredients(self):
        p = copy.deepcopy(self.base)
        extra = "characters/female_02/references/female_02_side_01.jpg"
        p["flow_prompts"][0]["ingredients"].append(extra)
        p["reference_assets"].append({"path": extra, "kind": "character_reference", "character_id": "female_02", "rights_basis": "owned"})
        self.assertIn("exceeds the configured limit", errors_text(self.check(p)))

    def test_ingredient_must_be_declared(self):
        p = copy.deepcopy(self.base)
        p["reference_assets"] = p["reference_assets"][:1]
        self.assertIn("not declared in reference_assets", errors_text(self.check(p)))

    def test_reference_mode_requires_manifest(self):
        p = copy.deepcopy(self.base)
        p["mode"] = "reference_guided"
        self.assertIn("needs reference_video_manifest", errors_text(self.check(p)))

    def test_approved_requires_reviewer_and_passing_scores(self):
        p = copy.deepcopy(self.base)
        p["status"] = "APPROVED"
        for q in p["quality_checks"]:
            q["score"] = 5
        p["quality_checks"][0]["score"] = 2
        text = errors_text(self.check(p))
        self.assertIn("human_review.reviewer", text)
        self.assertIn("QC01 scored 2", text)

    def test_ready_once_images_added_and_character_active(self):
        self.activate("female_02")
        self.add_image("assets/products/arka-tumbler-front.jpg")
        rep = self.check(copy.deepcopy(self.base), ready=True)
        self.assertEqual(rep.errors, [])
        self.assertTrue(any("sample data" in w for w in rep.warnings))

    def test_schema_rejects_unknown_status(self):
        p = copy.deepcopy(self.base)
        p["status"] = "PUBLISHED"
        self.assertIn("not one of", errors_text(self.check(p)))


if __name__ == "__main__":
    unittest.main()
