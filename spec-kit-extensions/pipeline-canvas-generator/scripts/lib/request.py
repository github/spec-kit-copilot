"""Shared Wizard/CLI request preparation from one Specify composition capture."""

import hashlib
import json
import re
import subprocess
from pathlib import Path

from packaging.version import InvalidVersion, Version
from artifact_snapshot import normalize_snapshot
from phase_output import validate_document_commands, validate_handoff
from staging import atomic_json, create_request_dir
from validation import confined_path, declared_file, target_path


MINIMUM_SPECIFY_VERSION = Version("1.0.7")
PHASE_ID = re.compile(r"^speckit\.[a-z0-9][a-z0-9.-]*$")


def _run(workspace: Path, *arguments: str) -> str:
    try:
        result = subprocess.run(
            ["specify", *arguments], cwd=workspace, capture_output=True,
            text=True, check=False,
        )
    except OSError as error:
        raise ValueError(f"Specify CLI is unavailable: {error}") from error
    if result.returncode:
        raise ValueError(
            f"Specify {' '.join(arguments)} failed ({result.returncode}): "
            f"{result.stderr.strip() or result.stdout.strip()}"
        )
    return result.stdout


def _preflight(workspace: Path) -> None:
    output = _run(workspace, "--version").strip().split()
    if len(output) != 2 or output[0] != "specify":
        raise ValueError("Specify CLI reported an invalid version")
    try:
        version = Version(output[1])
    except InvalidVersion as error:
        raise ValueError(f"Specify CLI reported an invalid version: {output[1]}") from error
    if version < MINIMUM_SPECIFY_VERSION:
        raise ValueError(
            f"Specify CLI {version} is incompatible; requires {MINIMUM_SPECIFY_VERSION} or newer"
        )


def capture_inventory(workspace: Path) -> dict:
    """Read each released Specify JSON surface exactly once."""
    inventory = {}
    for key, command in (
        ("artifacts", "artifact"),
        ("presets", "preset"),
        ("extensions", "extension"),
    ):
        raw = _run(workspace, command, "list", "--json")
        try:
            inventory[key] = json.loads(raw)
        except json.JSONDecodeError as error:
            raise ValueError(f"Malformed Specify {command} list JSON: {error}") from error
    return inventory


def _keys(value: object, required: set[str], optional: set[str] = frozenset()) -> None:
    if not isinstance(value, dict) or not required.issubset(value) or set(value) - required - optional:
        raise ValueError(
            f"Invalid request fields: expected {sorted(required)}, "
            f"optional {sorted(optional)}"
        )


def validate_request(request: object) -> None:
    """Reject drift and unknown authority fields on a persisted request."""
    _keys(request, {"schemaVersion", "canvas", "workflow", "workspace", "overwrite"},
          {"inlineDocuments"})
    if type(request["schemaVersion"]) is not int or request["schemaVersion"] != 1 or type(request["overwrite"]) is not bool:
        raise ValueError("Unsupported request version or overwrite decision")
    if "inlineDocuments" in request:
        from experience import validate_complete_category

        from experience import DOCUMENTS

        documents = request["inlineDocuments"]
        if not isinstance(documents, dict) or set(documents) - DOCUMENTS:
            raise ValueError("Invalid inline document names")
        for name, document in documents.items():
            if len(json.dumps(document, ensure_ascii=False).encode("utf-8")) > 256 * 1024:
                raise ValueError(f"Inline {name} exceeds 256 KiB")
            validate_complete_category(name, document, Path(__file__).resolve().parents[2])
            if name == "canvas-presentation" and document["brand"]["logo"]["mode"] == "asset":
                raise ValueError("Inline presentation cannot supply an asset logo; use a preset")
    _keys(request["canvas"], {"id", "displayName", "workflowListName", "description"})
    if not isinstance(request["canvas"]["displayName"], str) or not request["canvas"]["displayName"].strip():
        raise ValueError("Invalid canvas display name")
    if (not isinstance(request["canvas"]["workflowListName"], str)
        or not request["canvas"]["workflowListName"].strip()
        or len(request["canvas"]["workflowListName"]) > 80):
        raise ValueError("Invalid workflow header")
    if (not isinstance(request["canvas"]["description"], str)
        or not request["canvas"]["description"].strip()
        or len(request["canvas"]["description"]) > 240):
        raise ValueError("Invalid canvas description")
    if not isinstance(request["workspace"], str) or not request["workspace"]:
        raise ValueError("Invalid request workspace")
    target_path(Path(request["workspace"]), request["canvas"]["id"])
    _keys(request["workflow"], {"selectedPhases", "phaseOutputs", "artifactSnapshot", "requiredSkillHashes"})
    phases = request["workflow"]["selectedPhases"]
    if (
        not isinstance(phases, list) or not phases
        or any(not isinstance(phase, str) or not PHASE_ID.fullmatch(phase) for phase in phases)
        or len(set(phases)) != len(phases)
    ):
        raise ValueError("Invalid selected phases")
    skill_hashes = request["workflow"]["requiredSkillHashes"]
    if (not isinstance(skill_hashes, dict)
        or set(skill_hashes) != {phase.replace(".", "-") for phase in phases}
        or any(value is not None and (not isinstance(value, str)
                   or not re.fullmatch(r"[0-9a-f]{64}", value))
               for value in skill_hashes.values())):
        raise ValueError("Invalid required skill fingerprints")
    snapshot = request["workflow"]["artifactSnapshot"]
    _keys(snapshot, {
        "schemaVersion", "compositionFingerprint", "providers",
        "artifacts", "packageClassifications",
    })
    if snapshot["schemaVersion"] != 1:
        raise ValueError("Unsupported composition snapshot version")
    for row in snapshot["providers"]:
        _keys(row, {"id", "kind", "version", "priority", "enabled", "source", "manifestPath"},
              {"manifestSha256"})
    for row in snapshot["artifacts"]:
        _keys(row, {"kind", "name", "stack"}, {"description"})
        for layer in row["stack"]:
            _keys(layer, {
                "sourceId", "layer", "strategy", "active", "hidden",
                "manifestPath", "lookupId", "sourcePath",
            }, {"id", "presetId", "presetName"})
    for row in snapshot["packageClassifications"]:
        _keys(row, {"id", "kind", "tags", "classification", "manifestPath"})
    authority = {key: value for key, value in snapshot.items() if key != "compositionFingerprint"}
    canonical = json.dumps(authority, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    digest = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
    if snapshot["compositionFingerprint"] != digest:
        raise ValueError("Composition fingerprint does not match captured providers and stacks")
    validate_handoff(request["workflow"]["phaseOutputs"], phases, Path(request["workspace"]))
    if "inlineDocuments" in request and "phase-outputs" in request["inlineDocuments"]:
        validate_document_commands(request["inlineDocuments"]["phase-outputs"], phases,
                                   Path(request["workspace"]))
    if any(row["kind"] == "template" and row["name"] == "canvas-renderer"
           for row in snapshot["artifacts"]):
        raise ValueError("Canvas renderer templates are no longer supported; update or remove the contributing package")


def prepare_request(
    workspace: Path,
    selected_phases: list[str],
    canvas_id: str,
    display_name: str,
    overwrite: bool,
    *,
    phase_outputs: list[dict],
    inventory: dict | None = None,
    configuration: dict | None = None,
    inline_documents: dict | None = None,
) -> Path:
    """Validate all authority and composition before creating a request file."""
    root = workspace.resolve(strict=True)
    _preflight(root)
    if (
        not isinstance(selected_phases, list) or not selected_phases
        or any(not isinstance(phase, str) or not PHASE_ID.fullmatch(phase)
               for phase in selected_phases)
        or len(set(selected_phases)) != len(selected_phases)
    ):
        raise ValueError("Selected runtime phases must be unique ordered speckit command IDs")
    if not isinstance(display_name, str) or not display_name.strip() or len(display_name) > 120:
        raise ValueError("Canvas display name must contain 1 to 120 nonblank characters")
    if type(overwrite) is not bool:
        raise ValueError("Overwrite decision must be an explicit boolean")
    validate_handoff(phase_outputs, selected_phases, root)
    if configuration is None:
        configuration = {"canvas": {
            "id": canvas_id, "displayName": display_name,
            "workflowListName": "Workflows",
            "description": f"{display_name.strip()} workflow canvas.",
        }}
    _keys(configuration, {"canvas"})
    canvas = configuration["canvas"]
    if canvas.get("id") != canvas_id or canvas.get("displayName") != display_name:
        raise ValueError("Canvas configuration must match the requested identity")
    target = target_path(root, canvas_id)
    if target.exists() and not overwrite:
        raise ValueError(f"Existing target requires explicit replacement confirmation: {target}")

    captured = capture_inventory(root) if inventory is None else inventory
    if not isinstance(captured, dict) or set(captured) != {"artifacts", "presets", "extensions"}:
        raise ValueError("Specify inventory requires artifacts, presets, and extensions")
    snapshot = normalize_snapshot(
        captured["artifacts"], captured["presets"], captured["extensions"], root
    )
    classifications = {
        (row["kind"], row["id"]): row["classification"]
        for row in snapshot["packageClassifications"]
    }
    manifests = {
        (row["kind"], row["id"]): row["manifestPath"]
        for row in snapshot["packageClassifications"]
    }
    commands = {
        row["name"]: row for row in snapshot["artifacts"] if row["kind"] == "command"
    }
    for row in snapshot["artifacts"]:
        for layer in row["stack"]:
            path = layer["sourcePath"]
            kind, package_id = layer["layer"], layer["sourceId"]
            if path is not None:
                confined_path(root, path)
                if kind in ("preset", "extension"):
                    expected = Path(".specify") / (
                        "presets" if kind == "preset" else "extensions"
                    ) / package_id
                    if not Path(path).is_relative_to(expected):
                        skill = Path(".github") / "skills" / (
                            row["name"].replace(".", "-")
                        ) / "SKILL.md"
                        if row["kind"] != "command" or Path(path) != skill:
                            raise ValueError(
                                f"Specify {row['kind']}:{row['name']} source escapes "
                                f"installed {kind} {package_id}"
                            )
                        declared_file(root, path)
            manifest_path = layer["manifestPath"]
            if kind in ("preset", "extension") and manifest_path is not None:
                if Path(manifest_path) != Path(manifests[(kind, package_id)]):
                    raise ValueError(
                        f"Specify {row['kind']}:{row['name']} manifest does not match "
                        f"installed {kind} {package_id}"
                    )
    for phase in selected_phases:
        command = commands.get(phase)
        if command is None or not any(layer["active"] for layer in command["stack"]):
            raise ValueError(f"Missing selected phase command: {phase}")
        for layer in command["stack"]:
            if not layer["active"] or layer["layer"] not in ("preset", "extension"):
                continue
            package_id = layer["sourceId"]
            if classifications[(layer["layer"], package_id)] == "canvas-design":
                raise ValueError(
                    f"Canvas Design package {package_id} contributes to selected "
                    f"runtime phase/command {phase}"
                )
            if not layer["sourcePath"]:
                raise ValueError(f"Missing installed source path for selected phase {phase}")
            declared_file(root, layer["sourcePath"])
    skill_hashes = {}
    for phase in selected_phases:
        name = phase.replace(".", "-")
        relative = f".github/skills/{name}/SKILL.md"
        path = confined_path(root, relative)
        if path.exists():
            content = declared_file(root, relative).read_bytes()
            if not content.strip():
                raise ValueError(f"Required skill is empty: {relative}")
            skill_hashes[name] = hashlib.sha256(content).hexdigest()
        else:
            skill_hashes[name] = None
    if any(row["kind"] == "template" and row["name"] == "canvas-renderer"
           for row in snapshot["artifacts"]):
        raise ValueError("Canvas renderer templates are no longer supported; update or remove the contributing package")
    request = {
        "schemaVersion": 1,
        "canvas": canvas,
        "workflow": {
            "selectedPhases": selected_phases,
            "requiredSkillHashes": skill_hashes,
            "phaseOutputs": phase_outputs,
            "artifactSnapshot": snapshot,
        },
        "workspace": str(root),
        "overwrite": overwrite,
    }
    if inline_documents:
        request["inlineDocuments"] = inline_documents
    validate_request(request)
    directory = create_request_dir(root)
    path = directory / "request.json"
    atomic_json(path, request)
    return path
