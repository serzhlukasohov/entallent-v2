#!/usr/bin/env python3
from __future__ import annotations

import json
import re
import sys
from datetime import datetime
from pathlib import Path
from typing import Any

DEFAULT_ERROR_CATEGORY = "CONTRACT_SCHEMA_INVALID"
RUNTIME_ROOT = Path(__file__).resolve().parent


def main() -> int:
    schema_document = read_json(RUNTIME_ROOT / "openapi.json")
    manifest = read_json(RUNTIME_ROOT / "fixtures" / "manifest.json")

    failures: list[str] = []

    for fixture in manifest["valid"]:
        value = read_json(RUNTIME_ROOT / "fixtures" / fixture["path"])
        result = validate_runtime_contract(schema_document, fixture["schemaName"], value)
        if not result["ok"]:
            failures.append(
                f"{fixture['path']} expected ok, got {result['errorCategory']} at {result['path']}"
            )

    for fixture in manifest["invalid"]:
        value = read_json(RUNTIME_ROOT / "fixtures" / fixture["path"])
        result = validate_runtime_contract(schema_document, fixture["schemaName"], value)
        if result["ok"]:
            failures.append(f"{fixture['path']} expected rejection, got ok")
            continue
        if result["errorCategory"] != fixture["expectedErrorCategory"]:
            failures.append(
                f"{fixture['path']} expected {fixture['expectedErrorCategory']}, "
                f"got {result['errorCategory']} at {result['path']}"
            )

    if failures:
        for failure in failures:
            print(failure, file=sys.stderr)
        return 1

    print("runtime contract fixtures ok")
    return 0


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def validate_runtime_contract(
    schema_document: dict[str, Any], schema_name: str, value: Any
) -> dict[str, Any]:
    schemas = schema_document.get("components", {}).get("schemas", {})
    schema = schemas.get(schema_name)

    if not isinstance(schema, dict):
        return fail("$schema", DEFAULT_ERROR_CATEGORY, f"Missing schema: {schema_name}")

    return validate_schema(schema, value, "$", schemas)


def validate_schema(
    schema: dict[str, Any],
    value: Any,
    path: str,
    schemas: dict[str, Any],
) -> dict[str, Any]:
    ref = schema.get("$ref")
    if isinstance(ref, str):
        resolved = resolve_ref(ref, schemas)
        if resolved is None:
            return fail(path, error_category(schema), f"Unresolvable schema ref: {ref}")
        return validate_schema(resolved, value, path, schemas)

    if allows_null(schema) and value is None:
        return {"ok": True}

    schema_type = first_non_null_type(schema)
    if schema_type and not matches_type(schema_type, value):
        return fail(path, error_category(schema), f"Expected {schema_type}")

    if schema_type == "object":
        return validate_object(schema, value, path, schemas)
    if schema_type == "array":
        return validate_array(schema, value, path, schemas)
    if schema_type == "string":
        return validate_string(schema, value, path)
    if schema_type == "integer":
        return validate_integer(schema, value, path)

    return {"ok": True}


def validate_object(
    schema: dict[str, Any],
    value: Any,
    path: str,
    schemas: dict[str, Any],
) -> dict[str, Any]:
    if not isinstance(value, dict):
        return fail(path, error_category(schema), "Expected object")

    properties = schema.get("properties", {})
    if not isinstance(properties, dict):
        properties = {}

    for property_name in schema.get("required", []):
        if not isinstance(property_name, str):
            continue
        if property_name not in value:
            return fail(
                f"{path}.{property_name}",
                error_category(properties.get(property_name)),
                f"Missing required property: {property_name}",
            )

    for key, property_value in value.items():
        child_schema = properties.get(key)

        if not isinstance(child_schema, dict):
            if schema.get("additionalProperties") is False:
                return fail(
                    f"{path}.{key}",
                    error_category(schema),
                    f"Unexpected property: {key}",
                )

            additional_properties = schema.get("additionalProperties")
            if isinstance(additional_properties, dict):
                result = validate_schema(
                    additional_properties, property_value, f"{path}.{key}", schemas
                )
                if not result["ok"]:
                    return result
            continue

        result = validate_schema(child_schema, property_value, f"{path}.{key}", schemas)
        if not result["ok"]:
            return result

    return {"ok": True}


def validate_array(
    schema: dict[str, Any],
    value: Any,
    path: str,
    schemas: dict[str, Any],
) -> dict[str, Any]:
    if not isinstance(value, list):
        return fail(path, error_category(schema), "Expected array")

    item_schema = schema.get("items")
    if not isinstance(item_schema, dict):
        return {"ok": True}

    for index, item in enumerate(value):
        result = validate_schema(item_schema, item, f"{path}[{index}]", schemas)
        if not result["ok"]:
            return result

    return {"ok": True}


def validate_string(schema: dict[str, Any], value: Any, path: str) -> dict[str, Any]:
    if not isinstance(value, str):
        return fail(path, error_category(schema), "Expected string")

    min_length = schema.get("minLength")
    if isinstance(min_length, int) and len(value) < min_length:
        return fail(path, error_category(schema), "String is shorter than minLength")

    pattern = schema.get("pattern")
    if isinstance(pattern, str) and re.search(pattern, value) is None:
        return fail(path, error_category(schema), "String does not match pattern")

    enum_values = schema.get("enum")
    if isinstance(enum_values, list) and value not in enum_values:
        return fail(path, error_category(schema), "String is not in enum")

    if schema.get("format") == "uuid" and not is_uuid(value):
        return fail(path, error_category(schema), "String is not a UUID")

    if schema.get("format") == "date-time" and not is_date_time(value):
        return fail(path, error_category(schema), "String is not a date-time")

    return {"ok": True}


def validate_integer(schema: dict[str, Any], value: Any, path: str) -> dict[str, Any]:
    if not isinstance(value, int) or isinstance(value, bool):
        return fail(path, error_category(schema), "Expected integer")

    minimum = schema.get("minimum")
    if isinstance(minimum, int) and value < minimum:
        return fail(path, error_category(schema), "Integer is below minimum")

    return {"ok": True}


def resolve_ref(ref: str, schemas: dict[str, Any]) -> dict[str, Any] | None:
    prefix = "#/components/schemas/"
    if not ref.startswith(prefix):
        return None

    resolved = schemas.get(ref[len(prefix) :])
    return resolved if isinstance(resolved, dict) else None


def allows_null(schema: dict[str, Any]) -> bool:
    schema_type = schema.get("type")
    return isinstance(schema_type, list) and "null" in schema_type


def first_non_null_type(schema: dict[str, Any]) -> str | None:
    schema_type = schema.get("type")
    if isinstance(schema_type, str):
        return schema_type
    if isinstance(schema_type, list):
        for candidate in schema_type:
            if candidate != "null" and isinstance(candidate, str):
                return candidate
    return None


def matches_type(schema_type: str, value: Any) -> bool:
    if schema_type == "integer":
        return isinstance(value, int) and not isinstance(value, bool)
    if schema_type == "array":
        return isinstance(value, list)
    if schema_type == "object":
        return isinstance(value, dict)
    if schema_type == "string":
        return isinstance(value, str)
    if schema_type == "boolean":
        return isinstance(value, bool)
    if schema_type == "number":
        return isinstance(value, int | float) and not isinstance(value, bool)
    return True


def error_category(schema: Any) -> str:
    if isinstance(schema, dict) and isinstance(schema.get("x-error-category"), str):
        return schema["x-error-category"]
    return DEFAULT_ERROR_CATEGORY


def fail(path: str, error_category_value: str, message: str) -> dict[str, Any]:
    return {
        "ok": False,
        "errorCategory": error_category_value,
        "message": message,
        "path": path,
    }


def is_uuid(value: str) -> bool:
    return (
        re.fullmatch(
            r"[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}",
            value,
            flags=re.IGNORECASE,
        )
        is not None
    )


def is_date_time(value: str) -> bool:
    try:
        datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return False
    return True


if __name__ == "__main__":
    raise SystemExit(main())
