"""Bind author-declared phase outputs from Specify's captured template stacks."""

import hashlib
import json
import re
from pathlib import Path

from validation import confined_path, declared_file


HASH = re.compile(r"^[0-9a-f]{64}$")
SEGMENT = re.compile(r"^(?:[a-zA-Z0-9._-]|<slug>|<name>)+$")
PLACEHOLDER = re.compile(r"<[^>]*>")
RESERVED = {"CON", "PRN", "AUX", "NUL", *(f"COM{i}" for i in range(1, 10)),
            *(f"LPT{i}" for i in range(1, 10))}


def template_name(phase_id: str) -> str:
    return "phase-output-" + phase_id.encode("utf-8").hex()


def _unique_object(pairs: list[tuple[str, object]]) -> dict:
    value = {}
    for key, entry in pairs:
        if key in value:
            raise ValueError(f"Duplicate phase-output JSON key: {key}")
        value[key] = entry
    return value


def _invalid_number(value: str) -> object:
    raise ValueError(f"Invalid phase-output JSON number: {value}")


def validate_contract(
    value: object, phase_id: str, workspace: Path | None = None, *,
    allow_hint: bool = False,
) -> None:
    if (
        not isinstance(value, dict) or set(value) != {"schemaVersion", "commandName", "result"}
        or type(value["schemaVersion"]) is not int or value["schemaVersion"] != 1
        or value["commandName"] != phase_id or not isinstance(value["result"], dict)
    ):
        raise ValueError(f"Invalid phase-output contract for {phase_id}")
    result = value["result"]
    if result.get("kind") == "transient":
        if set(result) != {"kind"}:
            raise ValueError(f"Invalid transient phase-output contract for {phase_id}")
        return
    if result.get("kind") not in (("artifact", "hint") if allow_hint else ("artifact",)) or set(result) != {"kind", "pathTemplate"}:
        raise ValueError(f"Invalid phase-output result for {phase_id}")
    path = result["pathTemplate"]
    if (
        not isinstance(path, str) or len(path) > 2048 or not path.endswith(".md")
        or path.startswith("/") or "\\" in path or "\x00" in path
        or any(part in ("", ".", "..") for part in path.split("/"))
        or any(not SEGMENT.fullmatch(part) for part in path.split("/"))
        or any(tag not in ("<slug>", "<name>") for tag in PLACEHOLDER.findall(path))
        or any(part.split(".")[0].upper() in RESERVED for part in path.split("/"))
    ):
        raise ValueError(f"Unsafe phase-output Markdown path for {phase_id}: {path!r}")
    if workspace is not None:
        static = []
        for part in path.split("/"):
            if "<" in part:
                break
            static.append(part)
        if static:
            confined_path(workspace, "/".join(static))


def _provider(snapshot: dict, layer: dict) -> dict:
    if layer["layer"] == "project":
        return {"kind": "project", "id": "project", "version": None}
    matches = [
        item for item in snapshot["providers"]
        if item["kind"] == layer["layer"] and item["id"] == layer["sourceId"]
    ]
    if len(matches) != 1:
        raise ValueError(f"Missing phase-output provider: {layer['sourceId']}")
    return {
        "kind": matches[0]["kind"], "id": matches[0]["id"],
        "version": matches[0]["version"],
    }


def _declared_source(root: Path, name: str, layer: dict) -> bytes:
    source = layer["sourcePath"]
    if not isinstance(source, str):
        raise ValueError(f"Missing phase-output source path: {name}")
    if layer["layer"] in ("preset", "extension"):
        provider_root = Path(".specify") / (
            "presets" if layer["layer"] == "preset" else "extensions"
        ) / layer["sourceId"]
        if not Path(source).is_relative_to(provider_root):
            raise ValueError(f"Phase-output source escapes contributing package: {name}")
        manifest = provider_root / f"{layer['layer']}.yml"
        if layer["manifestPath"] is not None and Path(layer["manifestPath"]) != manifest:
            raise ValueError(f"Phase-output manifest does not match its provider: {name}")
    return declared_file(root, source).read_bytes()


def _skill_output_hint(workspace: Path, phase_id: str) -> str | None:
    skill = f".github/skills/{phase_id.replace('.', '-')}/SKILL.md"
    try:
        text = declared_file(workspace, skill).read_text(encoding="utf-8")
    except (ValueError, OSError, UnicodeError):
        return None
    if text.startswith("---"):
        text = text.split("---", 2)[-1]
    opening = text.split("\n## ", 1)[0]
    match = re.search(r"(?<![\w/])(?:\.specify|specs)/[A-Za-z0-9._<>/-]+\.md\b", opening)
    if match:
        try:
            validate_contract({
                "schemaVersion": 1, "commandName": phase_id,
                "result": {"kind": "hint", "pathTemplate": match.group()},
            }, phase_id, workspace, allow_hint=True)
            return match.group()
        except ValueError:
            pass
    return None


def bind_phase_output(
    snapshot: dict, command: dict, phase_id: str, workspace: Path
) -> dict:
    name = template_name(phase_id)
    templates = [
        item for item in snapshot["artifacts"]
        if item["kind"] == "template" and item["name"] == name
    ]
    if not templates:
        hint = _skill_output_hint(workspace, phase_id)
        return {
            "phaseId": phase_id, "contract": {
                "schemaVersion": 1, "commandName": phase_id,
                "result": {"kind": "hint", "pathTemplate": hint} if hint else {"kind": "unknown"},
            },
            "provider": None, "sourcePath": None, "sha256": None, "templateStack": [],
        }
    stack = templates[0]["stack"]
    effective = [part for part in stack if part["active"]]
    if len(effective) != 1 or effective[0]["hidden"] or effective[0]["strategy"] != "replace":
        raise ValueError(f"Ambiguous phase-output contract for {phase_id}: requires one replace winner")
    winner = effective[0]
    owner = _provider(snapshot, winner)
    raw = _declared_source(workspace, name, winner)
    try:
        contract = json.loads(
            raw, object_pairs_hook=_unique_object, parse_constant=_invalid_number
        )
    except (json.JSONDecodeError, UnicodeError) as error:
        raise ValueError(f"Malformed phase-output JSON for {phase_id}: {error}") from error
    validate_contract(contract, phase_id, workspace)
    return {
        "phaseId": phase_id,
        "contract": contract,
        "provider": owner,
        "sourcePath": winner["sourcePath"],
        "sha256": hashlib.sha256(raw).hexdigest(),
        "templateStack": stack,
    }


def validate_binding(binding: object, phase_id: str, snapshot: dict) -> None:
    if not isinstance(binding, dict) or set(binding) != {
        "phaseId", "contract", "provider", "sourcePath", "sha256", "templateStack",
    } or binding["phaseId"] != phase_id:
        raise ValueError(f"Invalid request phase-output binding for {phase_id}")
    name = template_name(phase_id)
    template = next(
        (row for row in snapshot["artifacts"]
         if row["kind"] == "template" and row["name"] == name), None
    )
    if template is None:
        if binding["templateStack"] == [] and all(
            binding[key] is None for key in ("provider", "sourcePath", "sha256")
        ):
            result = binding["contract"].get("result") if isinstance(binding["contract"], dict) else None
            if binding["contract"] == {
                "schemaVersion": 1, "commandName": phase_id, "result": {"kind": "unknown"},
            }:
                return
            if isinstance(result, dict) and result.get("kind") == "hint":
                validate_contract(binding["contract"], phase_id, allow_hint=True)
                return
        raise ValueError(f"Phase-output stack changed in request for {phase_id}")
    validate_contract(binding["contract"], phase_id)
    if binding["templateStack"] != template["stack"]:
        raise ValueError(f"Phase-output stack changed in request for {phase_id}")
    if not isinstance(binding["sha256"], str) or not HASH.fullmatch(binding["sha256"]):
        raise ValueError(f"Invalid phase-output source hash for {phase_id}")
    effective = [part for part in template["stack"] if part["active"]]
    if len(effective) != 1 or binding["sourcePath"] != effective[0]["sourcePath"]:
        raise ValueError(f"Phase-output source differs from captured stack for {phase_id}")
    if binding["provider"] != _provider(snapshot, effective[0]):
        raise ValueError(f"Phase-output provider differs from captured stack for {phase_id}")
