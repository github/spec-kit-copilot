"""Bind complete category templates to one captured Specify composition."""

import hashlib
import json
from pathlib import Path

import yaml

from experience import default_experience, validate_complete_category
from override import CATEGORY_FIELDS
from phase_output import HASH, _invalid_number, _unique_object
from validation import declared_file


GENERATOR = "pipeline-canvas-generator"


def _provider(snapshot: dict, layer: dict) -> dict:
    if layer["layer"] == "project":
        return {"kind": "project", "id": "project", "version": None}
    matches = [
        row for row in snapshot["providers"]
        if row["kind"] == layer["layer"] and row["id"] == layer["sourceId"]
    ]
    if len(matches) != 1 or not matches[0]["enabled"]:
        raise ValueError(f"Unavailable category provider: {layer['sourceId']}")
    return {key: matches[0][key] for key in ("kind", "id", "version")}


def _source(workspace: Path, name: str, layer: dict) -> bytes:
    source = layer["sourcePath"]
    if not isinstance(source, str):
        raise ValueError(f"Missing category template source: {name}")
    if layer["layer"] in ("preset", "extension"):
        kind, package_id = layer["layer"], layer["sourceId"]
        root = Path(".specify") / ("presets" if kind == "preset" else "extensions") / package_id
        manifest = root / f"{kind}.yml"
        if (not Path(source).is_relative_to(root)
            or not isinstance(layer["manifestPath"], str)
            or Path(layer["manifestPath"]) != manifest):
            raise ValueError(f"Category template escapes its installed provider: {name}")
        try:
            parsed = yaml.safe_load(declared_file(workspace, str(manifest)).read_text(encoding="utf-8"))
        except (yaml.YAMLError, UnicodeError, OSError) as error:
            raise ValueError(f"Invalid category provider manifest for {name}: {error}") from error
        provides = parsed.get("provides") if isinstance(parsed, dict) else None
        templates = provides.get("templates") if isinstance(provides, dict) else None
        declared = [
            entry for entry in templates or []
            if isinstance(entry, dict) and entry.get("name") == name
        ]
        if len(declared) != 1 or not isinstance(declared[0].get("file"), str) or (
            root / declared[0]["file"] != Path(source)
        ):
            raise ValueError(f"Category template is not declared by its provider: {name}")
    elif layer["layer"] != "project":
        raise ValueError(f"Unsupported category provider for {name}")
    return declared_file(workspace, source, maximum=256 * 1024).read_bytes()


def bind_categories(snapshot: dict, workspace: Path, package: Path) -> dict:
    defaults = default_experience(package)["categories"]
    installed_generator = next((
        row for row in snapshot["providers"]
        if row["kind"] == "extension" and row["id"] == GENERATOR
    ), None)
    if installed_generator is None:
        raise ValueError("The installed canvas generator is required for category composition")
    result = {}
    for name in CATEGORY_FIELDS:
        template = next((
            row for row in snapshot["artifacts"]
            if row["kind"] == "template" and row["name"] == name
        ), None)
        if template is None:
            path = f"config/{name}.json"
            raw = declared_file(package, path, maximum=256 * 1024).read_bytes()
            document = defaults[name]
            provider = {
                "kind": "extension", "id": GENERATOR,
                "version": installed_generator["version"],
            }
            stack = []
            source_path = f"generator:{path}"
        else:
            active = [layer for layer in template["stack"] if layer["active"]]
            if len(active) != 1 or active[0]["hidden"] or active[0]["strategy"] != "replace":
                raise ValueError(f"Category {name} requires exactly one effective replace provider")
            layer = active[0]
            provider = _provider(snapshot, layer)
            raw = _source(workspace, name, layer)
            source_path = layer["sourcePath"]
            stack = template["stack"]
            try:
                document = json.loads(
                    raw, object_pairs_hook=_unique_object, parse_constant=_invalid_number
                )
            except (UnicodeError, json.JSONDecodeError) as error:
                raise ValueError(f"Invalid complete category template for {name}: {error}") from error
            validate_complete_category(name, document, package)
        result[name] = {
            "document": document, "provider": provider,
            "sourcePath": source_path, "sha256": hashlib.sha256(raw).hexdigest(),
            "templateStack": stack,
        }
    return result


def validate_category_bindings(bindings: object, snapshot: dict, package: Path) -> None:
    if not isinstance(bindings, dict) or set(bindings) != CATEGORY_FIELDS.keys():
        raise ValueError("Request must bind all six experience categories")
    for name, binding in bindings.items():
        if not isinstance(binding, dict) or set(binding) != {
            "document", "provider", "sourcePath", "sha256", "templateStack",
        }:
            raise ValueError(f"Invalid category binding for {name}")
        validate_complete_category(name, binding["document"], package)
        if not isinstance(binding["sha256"], str) or not HASH.fullmatch(binding["sha256"]):
            raise ValueError(f"Invalid category source hash for {name}")
        provider = binding["provider"]
        if (not isinstance(provider, dict)
            or set(provider) != {"kind", "id", "version"}
            or provider["kind"] not in ("extension", "preset", "project")
            or not isinstance(provider["id"], str)
            or not provider["id"]
            or not (provider["version"] is None or isinstance(provider["version"], str))
            or not isinstance(binding["sourcePath"], str)):
            raise ValueError(f"Invalid category provider for {name}")
        template = next((
            row for row in snapshot["artifacts"]
            if row["kind"] == "template" and row["name"] == name
        ), None)
        if template is None:
            if binding["sourcePath"] != f"generator:config/{name}.json" or binding["templateStack"] != []:
                raise ValueError(f"Uncaptured category source for {name}")
            installed = next((
                row for row in snapshot["providers"]
                if row["kind"] == "extension" and row["id"] == GENERATOR
            ), None)
            if binding["provider"] != {
                "kind": "extension", "id": GENERATOR,
                "version": installed["version"] if installed else None,
            }:
                raise ValueError(f"Uncaptured category owner for {name}")
            raw = declared_file(package, f"config/{name}.json", maximum=256 * 1024).read_bytes()
            if binding["sha256"] != hashlib.sha256(raw).hexdigest():
                raise ValueError(f"Generator default category source changed: {name}")
        else:
            active = [part for part in template["stack"] if part["active"]]
            if len(active) != 1 or active[0]["hidden"] or active[0]["strategy"] != "replace":
                raise ValueError(f"Ambiguous category winner for {name}")
            if (binding["templateStack"] != template["stack"]
                or binding["sourcePath"] != active[0]["sourcePath"]
                or binding["provider"] != _provider(snapshot, active[0])):
                raise ValueError(f"Category binding differs from captured Specify stack: {name}")


def category_warnings(request: dict, final: dict) -> list[str]:
    return [
        f"Ignored command override for customer-owned {name} ({request['workflow']['categoryTemplates'][name]['provider']['id']})"
        for name in CATEGORY_FIELDS
        if name in final["categories"]
        and request["workflow"]["categoryTemplates"][name]["provider"]["id"] != GENERATOR
    ]

