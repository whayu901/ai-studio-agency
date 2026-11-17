"""Tests for the built-in JSON Schema subset validator."""

from __future__ import annotations

import unittest

from helpers import REPO_ROOT, read_json

from schema_lite import ANNOTATION_KEYWORDS, SUPPORTED_KEYWORDS, SchemaError, validate_lite

SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["id", "n"],
    "properties": {
        "id": {"type": "string", "pattern": "^[a-z]+$"},
        "n": {"type": "integer", "minimum": 1, "maximum": 5},
        "opt": {"type": ["string", "null"], "minLength": 2},
        "kind": {"enum": ["a", "b"]},
        "tags": {"type": "array", "minItems": 1, "items": {"$ref": "#/$defs/tag"}},
    },
    "$defs": {"tag": {"type": "string", "minLength": 1}},
}


class SchemaLiteTest(unittest.TestCase):
    def test_valid(self):
        self.assertEqual(validate_lite({"id": "abc", "n": 3, "opt": None, "kind": "a", "tags": ["x"]}, SCHEMA), [])

    def test_errors(self):
        errs = validate_lite({"id": "ABC", "n": 9, "opt": "x", "kind": "z", "tags": [""], "extra": 1}, SCHEMA)
        joined = "\n".join(errs)
        for fragment in ("pattern", "above maximum", "shorter than", "not one of", "tags[0]", "unexpected property 'extra'"):
            self.assertIn(fragment, joined)

    def test_missing_required_and_wrong_type(self):
        errs = validate_lite({"n": "3"}, SCHEMA)
        self.assertTrue(any("missing required property 'id'" in e for e in errs))
        self.assertTrue(any("expected integer" in e for e in errs))

    def test_bool_is_not_a_number(self):
        self.assertTrue(validate_lite({"id": "a", "n": True}, SCHEMA))

    def test_unsupported_keyword_raises(self):
        with self.assertRaises(SchemaError):
            validate_lite({}, {"type": "object", "oneOf": []})

    def test_project_schemas_only_use_supported_keywords(self):
        """Walk every schema so an unsupported keyword is caught even in unused branches."""
        allowed = SUPPORTED_KEYWORDS | ANNOTATION_KEYWORDS

        def walk(node, where):
            if isinstance(node, dict):
                for key, val in node.items():
                    if key in ("properties", "$defs"):
                        for name, sub in val.items():
                            walk(sub, f"{where}/{key}/{name}")
                        continue
                    self.assertIn(key, allowed, f"{where}: unsupported keyword {key!r}")
                    if key in ("items", "additionalProperties") and isinstance(val, dict):
                        walk(val, f"{where}/{key}")

        for path in sorted((REPO_ROOT / "schemas").glob("*.schema.json")):
            with self.subTest(schema=path.name):
                walk(read_json(path), path.name)


if __name__ == "__main__":
    unittest.main()
