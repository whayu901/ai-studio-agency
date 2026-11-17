"""Minimal JSON Schema validator (standard library only).

Supports the subset of JSON Schema 2020-12 used by the files in ``schemas/``:
type, const, enum, required, properties, additionalProperties, items, minItems,
maxItems, minLength, maxLength, pattern, minimum, maximum, exclusiveMinimum,
exclusiveMaximum and local ``$ref`` ("#/$defs/...").

If the third-party ``jsonschema`` package is installed, ``validate`` uses it
instead, so results match a full implementation. An unknown validation keyword
raises ``SchemaError`` rather than being silently ignored.
"""

from __future__ import annotations

import re
from typing import Any, List

ANNOTATION_KEYWORDS = {
    "$schema",
    "$id",
    "$defs",
    "$comment",
    "title",
    "description",
    "default",
    "examples",
}
SUPPORTED_KEYWORDS = {
    "type",
    "const",
    "enum",
    "required",
    "properties",
    "additionalProperties",
    "items",
    "minItems",
    "maxItems",
    "minLength",
    "maxLength",
    "pattern",
    "minimum",
    "maximum",
    "exclusiveMinimum",
    "exclusiveMaximum",
    "$ref",
}


class SchemaError(Exception):
    """The schema itself uses something this validator cannot check."""


def _is_type(value: Any, type_name: str) -> bool:
    if type_name == "null":
        return value is None
    if type_name == "boolean":
        return isinstance(value, bool)
    if type_name == "integer":
        return isinstance(value, int) and not isinstance(value, bool) or (
            isinstance(value, float) and value.is_integer()
        )
    if type_name == "number":
        return isinstance(value, (int, float)) and not isinstance(value, bool)
    if type_name == "string":
        return isinstance(value, str)
    if type_name == "array":
        return isinstance(value, list)
    if type_name == "object":
        return isinstance(value, dict)
    raise SchemaError(f"unknown type {type_name!r}")


def _resolve_ref(ref: str, root: dict) -> dict:
    if not ref.startswith("#/"):
        raise SchemaError(f"only local $ref values are supported, got {ref!r}")
    node: Any = root
    for part in ref[2:].split("/"):
        if not isinstance(node, dict) or part not in node:
            raise SchemaError(f"$ref {ref!r} does not resolve")
        node = node[part]
    return node


def _fmt(path: str) -> str:
    return path or "(root)"


def _validate(value: Any, schema: Any, root: dict, path: str, errors: List[str]) -> None:
    if schema is True or schema == {}:
        return
    if schema is False:
        errors.append(f"{_fmt(path)}: not allowed")
        return
    unknown = set(schema) - SUPPORTED_KEYWORDS - ANNOTATION_KEYWORDS
    if unknown:
        raise SchemaError(f"unsupported keyword(s) {sorted(unknown)} at {_fmt(path)}")

    if "$ref" in schema:
        _validate(value, _resolve_ref(schema["$ref"], root), root, path, errors)

    if "type" in schema:
        types = schema["type"] if isinstance(schema["type"], list) else [schema["type"]]
        if not any(_is_type(value, t) for t in types):
            errors.append(f"{_fmt(path)}: expected {' or '.join(types)}, got {type(value).__name__}")
            return

    if "const" in schema and value != schema["const"]:
        errors.append(f"{_fmt(path)}: must equal {schema['const']!r}")
    if "enum" in schema and value not in schema["enum"]:
        errors.append(f"{_fmt(path)}: {value!r} is not one of {schema['enum']}")

    if isinstance(value, str):
        if "minLength" in schema and len(value) < schema["minLength"]:
            errors.append(f"{_fmt(path)}: shorter than {schema['minLength']} characters")
        if "maxLength" in schema and len(value) > schema["maxLength"]:
            errors.append(f"{_fmt(path)}: longer than {schema['maxLength']} characters")
        if "pattern" in schema and not re.search(schema["pattern"], value):
            errors.append(f"{_fmt(path)}: {value!r} does not match pattern {schema['pattern']!r}")

    if _is_type(value, "number"):
        if "minimum" in schema and value < schema["minimum"]:
            errors.append(f"{_fmt(path)}: {value} is below minimum {schema['minimum']}")
        if "maximum" in schema and value > schema["maximum"]:
            errors.append(f"{_fmt(path)}: {value} is above maximum {schema['maximum']}")
        if "exclusiveMinimum" in schema and value <= schema["exclusiveMinimum"]:
            errors.append(f"{_fmt(path)}: {value} must be greater than {schema['exclusiveMinimum']}")
        if "exclusiveMaximum" in schema and value >= schema["exclusiveMaximum"]:
            errors.append(f"{_fmt(path)}: {value} must be less than {schema['exclusiveMaximum']}")

    if isinstance(value, list):
        if "minItems" in schema and len(value) < schema["minItems"]:
            errors.append(f"{_fmt(path)}: needs at least {schema['minItems']} item(s)")
        if "maxItems" in schema and len(value) > schema["maxItems"]:
            errors.append(f"{_fmt(path)}: allows at most {schema['maxItems']} item(s)")
        if "items" in schema:
            for i, item in enumerate(value):
                _validate(item, schema["items"], root, f"{path}[{i}]", errors)

    if isinstance(value, dict):
        for key in schema.get("required", []):
            if key not in value:
                errors.append(f"{_fmt(path)}: missing required property {key!r}")
        props = schema.get("properties", {})
        for key, sub in value.items():
            child = f"{path}.{key}" if path else key
            if key in props:
                _validate(sub, props[key], root, child, errors)
            elif "additionalProperties" in schema:
                extra = schema["additionalProperties"]
                if extra is False:
                    errors.append(f"{_fmt(path)}: unexpected property {key!r}")
                elif isinstance(extra, dict):
                    _validate(sub, extra, root, child, errors)


def validate_lite(instance: Any, schema: dict) -> List[str]:
    """Validate with the built-in subset implementation. Returns error strings."""
    errors: List[str] = []
    _validate(instance, schema, schema, "", errors)
    return errors


def validate(instance: Any, schema: dict) -> List[str]:
    """Validate ``instance``; uses ``jsonschema`` when installed, else the lite validator."""
    try:
        import jsonschema  # type: ignore
    except ImportError:
        return validate_lite(instance, schema)
    validator_cls = jsonschema.validators.validator_for(schema)
    validator = validator_cls(schema)
    out = []
    for err in sorted(validator.iter_errors(instance), key=lambda e: list(e.absolute_path)):
        loc = ".".join(str(p) for p in err.absolute_path) or "(root)"
        out.append(f"{loc}: {err.message}")
    return out


def backend_name() -> str:
    try:
        import jsonschema  # type: ignore  # noqa: F401
    except ImportError:
        return "schema_lite (built-in)"
    return "jsonschema"
