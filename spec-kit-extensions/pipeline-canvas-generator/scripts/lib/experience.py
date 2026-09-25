"""Read and validate complete, generator-owned experience documents."""

import json
import re
from pathlib import Path

from staging import read_json
from validation import declared_file


DOCUMENTS = frozenset({
    "canvas-presentation", "canvas-interactions", "canvas-setup",
    "canvas-results", "phase-outputs",
})


def _check(value: object, schema: dict, root: dict, location: str) -> None:
    if "oneOf" in schema:
        matches = 0
        for choice in schema["oneOf"]:
            try:
                _check(value, choice, root, location)
            except ValueError:
                continue
            matches += 1
        if matches != 1:
            raise ValueError(f"Expected exactly one category shape at {location}")
        return
    if "$ref" in schema:
        pointer = schema["$ref"]
        if not isinstance(pointer, str) or not pointer.startswith("#/$defs/"):
            raise ValueError(f"Unsupported category schema reference at {location}")
        name = pointer.removeprefix("#/$defs/")
        definition = root.get("$defs", {}).get(name)
        if not isinstance(definition, dict):
            raise ValueError(f"Missing category schema definition at {location}")
        _check(value, definition, root, location)
        return
    allowed = {
        "$schema", "$id", "$defs", "title", "description", "type",
        "const", "enum", "properties", "required", "additionalProperties",
        "minLength", "maxLength", "pattern", "propertyNames",
        "items", "minItems", "maxItems", "oneOf",
    }
    if set(schema) - allowed:
        raise ValueError(f"Unsupported category schema constraint at {location}")
    kind = schema.get("type")
    if isinstance(kind, list):
        if value is None and "null" in kind:
            return
        kind = next((entry for entry in kind if entry != "null"), None)
    if value is None:
        raise ValueError(f"Null category value at {location}")
    if kind == "object":
        if not isinstance(value, dict):
            raise ValueError(f"Expected category object at {location}")
        properties = schema.get("properties", {})
        if set(schema.get("required", [])) - value.keys():
            raise ValueError(f"Missing required category value at {location}")
        extra = schema.get("additionalProperties", True)
        if extra is False and set(value) - properties.keys():
            raise ValueError(f"Unknown category field at {location}")
        for key, field in value.items():
            if key in {"__proto__", "constructor", "prototype"}:
                raise ValueError(f"Protected category field at {location}")
            if "propertyNames" in schema:
                _check(key, schema["propertyNames"], root, f"{location} key")
            child = properties.get(key, extra)
            if isinstance(child, dict):
                _check(field, child, root, f"{location}.{key}")
            elif child is False:
                raise ValueError(f"Unknown category field at {location}.{key}")
            elif field is None:
                raise ValueError(f"Null category value at {location}.{key}")
    elif kind == "string":
        if not isinstance(value, str) or not (
            schema.get("minLength", 0) <= len(value) <= schema.get("maxLength", float("inf"))
        ) or ("pattern" in schema and re.fullmatch(schema["pattern"], value) is None):
            raise ValueError(f"Invalid category string at {location}")
    elif kind == "boolean":
        if type(value) is not bool:
            raise ValueError(f"Expected category boolean at {location}")
    elif kind == "array":
        if not isinstance(value, list) or not (
            schema.get("minItems", 0) <= len(value) <= schema.get("maxItems", float("inf"))
        ):
            raise ValueError(f"Invalid category array at {location}")
        for index, item in enumerate(value):
            _check(item, schema["items"], root, f"{location}[{index}]")
    elif kind is not None:
        raise ValueError(f"Unsupported category schema type at {location}")
    if "const" in schema and (type(value) is not type(schema["const"]) or value != schema["const"]):
        raise ValueError(f"Wrong category constant at {location}")
    if "enum" in schema and value not in schema["enum"]:
        raise ValueError(f"Unsupported category choice at {location}")


def validate_complete_category(name: str, document: object, package: Path) -> dict:
    if name not in DOCUMENTS:
        raise ValueError(f"Unknown experience category: {name}")
    schema_path = declared_file(package, f"schemas/{name}.schema.json", maximum=256 * 1024)
    schema = read_json(schema_path)
    if not isinstance(schema, dict):
        raise ValueError(f"Invalid category schema: {name}")
    _check(document, schema, schema, name)
    if name == "canvas-presentation":
        logo = document["brand"]["logo"]
        if logo["mode"] == "asset":
            path = logo.get("path")
            if (not path or not logo.get("alt") or Path(path).is_absolute()
                or ".." in Path(path).parts
                or not path.lower().endswith((".png", ".jpg", ".jpeg", ".webp"))
                or ":" in path or "\\" in path or path.startswith("/")):
                raise ValueError("Asset logo requires a confined image path and alt text")
        elif set(logo) != {"mode"}:
            raise ValueError("Default and hidden logos cannot specify a custom asset")
    if name in ("canvas-presentation", "canvas-interactions", "canvas-setup"):
        pending = [document]
        while pending:
            current = pending.pop()
            if isinstance(current, dict):
                pending.extend(current.values())
            elif isinstance(current, str) and re.search(
                r"<[a-z!/][^>]*>|\$\{|{{|javascript:", current, re.IGNORECASE
            ):
                raise ValueError(f"Executable expression or markup in {name}")
    if name == "canvas-results":
        labels = document.get("resultLabels", [])
        reserved = {
            "not determined", "clarification needed", "needs clarification", "reviewing",
            "review unavailable", "artifact unavailable", "artifact ready", "artifact not ready",
        }
        normalized = []
        for label in labels:
            if (label != label.strip() or len(label.split()) > 3
                or any(ord(char) < 32 or ord(char) in (127, 0x2028, 0x2029) for char in label)):
                raise ValueError("Invalid phase result tag")
            normalized.append(" ".join(label.lower().split()))
        if len(set(normalized)) != len(normalized) or reserved.intersection(normalized):
            raise ValueError("Duplicate or reserved phase result tag")
        for phase, result in [("defaultResult", document.get("defaultResult"))] + list(document["phases"].items()):
            if result is None or result.get("disabled") is True:
                continue
            source = result["source"]
            if (source["kind"] == "artifact-field") != ("field" in source):
                raise ValueError(f"Invalid result source for {phase}")
            identifiers = [option["id"] for option in result["values"]]
            if len(identifiers) != len(set(identifiers)):
                raise ValueError(f"Duplicate result ID for {phase}")
    return document


def default_document(package: Path, name: str) -> dict:
    if name not in DOCUMENTS:
        raise ValueError(f"Unknown default document: {name}")
    path = declared_file(package, f"config/{name}.json", maximum=256 * 1024)
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (UnicodeError, json.JSONDecodeError) as error:
        raise ValueError(f"Invalid default experience document: {name}") from error
    return validate_complete_category(name, value, package)
