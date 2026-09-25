"""Resolve complete design documents after authoring, not from request snapshots."""

import hashlib
import json
from pathlib import Path

from specify_cli.presets import PresetResolver
import yaml

from phase_output import derived_document, validate_document_commands
from validation import confined_path, declared_file


NAMES = ("canvas-presentation", "phase-outputs", "canvas-results",
         "canvas-interactions", "canvas-setup")
TEMPLATES = frozenset(("canvas-presentation", "phase-outputs", "canvas-results"))
GENERATOR_ID = "pipeline-canvas-generator"


def baseline_documents(package: Path, phase_outputs: list) -> dict:
    from experience import default_document

    return {
        name: derived_document(phase_outputs) if name == "phase-outputs"
        else default_document(package, name)
        for name in NAMES
    }


def winning_providers(snapshot: dict) -> dict:
    winners = {}
    for name in TEMPLATES:
        artifact = next((row for row in snapshot["artifacts"]
                         if row["kind"] == "template" and row["name"] == name), None)
        if artifact is None:
            raise ValueError(f"Missing required named Specify template: {name}")
        active = [part for part in artifact["stack"] if part["active"]]
        if len(active) != 1 or active[0]["hidden"] or active[0]["strategy"] != "replace":
            raise ValueError(f"{name} requires one effective whole-file replace provider")
        layer = active[0]
        if layer["layer"] not in ("preset", "extension"):
            raise ValueError(f"{name} requires an installed preset or extension")
        if layer["layer"] != "extension" or layer["sourceId"] != GENERATOR_ID:
            winners[name] = {"kind": layer["layer"], "id": layer["sourceId"]}
        else:
            winners[name] = None
    return winners


def parse_document_json(raw: bytes, name: str) -> dict:
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError(f"Duplicate key in {name}: {key}")
            result[key] = value
        return result

    try:
        return json.loads(raw, object_pairs_hook=unique,
                          parse_constant=lambda value: (_ for _ in ()).throw(
                              ValueError(f"Invalid number in {name}: {value}")))
    except (UnicodeError, json.JSONDecodeError) as error:
        raise ValueError(f"Invalid JSON document {name}: {error}") from error


def resolve_documents(workspace: Path, snapshot: dict, package: Path,
                      request_path: Path) -> dict:
    """Bind complete request documents after applying customer-provider precedence."""
    from experience import validate_complete_category
    from staging import read_json

    request = read_json(request_path)
    phases = request["workflow"]["selectedPhases"]
    inline = request.get("inlineDocuments", {})
    defaults = baseline_documents(package, request["workflow"]["phaseOutputs"])
    winners = winning_providers(snapshot)
    resolver = PresetResolver(workspace)
    bindings = {}
    for name in NAMES:
        artifact = next((row for row in snapshot["artifacts"]
                         if row["kind"] == "template" and row["name"] == name), None)
        if name not in TEMPLATES or (not winners[name] and (
            name in inline or name == "phase-outputs"
        )):
            document = validate_complete_category(name, inline.get(name, defaults[name]), package)
            if name == "phase-outputs":
                validate_document_commands(document, phases, workspace)
            kind = "inline" if name in inline else "derived" if name == "phase-outputs" else "generator"
            source_path = "request.json" if kind in ("inline", "derived") else f"config/{name}.json"
            source_bytes = (request_path.read_bytes() if kind in ("inline", "derived")
                            else declared_file(package, source_path).read_bytes())
            bindings[name] = {
                "document": document,
                "documentSha256": hashlib.sha256(json.dumps(
                    document, sort_keys=True, separators=(",", ":"), ensure_ascii=False
                ).encode("utf-8")).hexdigest(),
                "provider": {"kind": kind, "id": "request" if kind == "inline"
                             else "handoff" if kind == "derived" else GENERATOR_ID,
                             "version": None},
                "sourcePath": source_path,
                "sha256": hashlib.sha256(source_bytes).hexdigest(),
                "templateStack": artifact["stack"] if artifact else [],
            }
            continue
        winner = [part for part in artifact["stack"] if part["active"]]
        if len(winner) != 1 or winner[0]["hidden"] or winner[0]["strategy"] != "replace":
            raise ValueError(f"{name} requires one effective whole-file replace provider")
        if winner[0]["layer"] not in ("preset", "extension"):
            raise ValueError(f"{name} requires a declared JSON template in an installed preset or extension")
        resolved = resolver.resolve(name, template_type="template")
        if resolved is None:
            raise ValueError(f"Missing required named Specify template: {name}")
        if resolved.suffix.lower() != ".json":
            raise ValueError(f"Unsupported non-JSON Specify template winner for {name}: {resolved.name}")
        # The captured inventory still identifies the selected provider, but does
        # not supply the document. Reject a winner that changed after preparation.
        try:
            relative = Path(resolved).resolve().relative_to(workspace.resolve()).as_posix()
        except ValueError as error:
            raise ValueError(f"Resolved template escapes workspace: {name}") from error
        if relative != winner[0]["sourcePath"].replace("\\", "/"):
            raise ValueError(f"Specify resolution changed since request preparation: {name}")
        layer = winner[0]
        parent = Path(".specify") / (
            "presets" if layer["layer"] == "preset" else "extensions"
        ) / layer["sourceId"]
        if not Path(relative).is_relative_to(parent):
            raise ValueError(f"Template winner escapes installed provider: {name}")
        manifest = parent / f"{layer['layer']}.yml"
        if layer["manifestPath"] != manifest.as_posix():
            raise ValueError(f"Invalid provider manifest for {name}")
        try:
            source = yaml.safe_load(declared_file(workspace, manifest.as_posix()).read_text(
                encoding="utf-8"))
        except (yaml.YAMLError, UnicodeError) as error:
            raise ValueError(f"Invalid provider manifest for {name}: {error}") from error
        provides = source.get("provides") if isinstance(source, dict) else None
        templates = provides.get("templates") if isinstance(provides, dict) else None
        if not isinstance(templates, list):
            raise ValueError(f"Required named template is not declared by provider: {name}")
        entries = [entry for entry in templates if isinstance(entry, dict)
                   and entry.get("name") == name
                   and (entry.get("type", "template") == "template")]
        if len(entries) != 1 or not isinstance(entries[0].get("file"), str) or (
            parent / entries[0]["file"]
        ).as_posix() != relative:
            raise ValueError(f"Required named template is not declared by provider: {name}")
        raw = declared_file(workspace, relative, maximum=256 * 1024).read_bytes()
        document = validate_complete_category(name, parse_document_json(raw, name), package)
        if name == "phase-outputs":
            validate_document_commands(document, phases, workspace)
        elif name == "canvas-results":
            available = {row["name"] for row in snapshot["artifacts"] if row["kind"] == "command"}
            if set(document["phases"]) - available:
                raise ValueError("Canvas results reference unknown Specify commands")
        provider = next((row for row in snapshot["providers"]
                         if row["kind"] == layer["layer"] and row["id"] == layer["sourceId"]), None)
        if provider is None:
            raise ValueError(f"Missing Specify template provider: {name}")
        bindings[name] = {
            "document": document,
            "documentSha256": hashlib.sha256(json.dumps(
                document, sort_keys=True, separators=(",", ":"), ensure_ascii=False
            ).encode("utf-8")).hexdigest(),
            "provider": {"kind": layer["layer"],
                         "id": layer["sourceId"],
                         "version": provider["version"]},
            "sourcePath": relative,
            "sha256": hashlib.sha256(raw).hexdigest(),
            "templateStack": artifact["stack"],
        }
    return bindings


def stage_documents(request_path: Path) -> Path:
    from staging import atomic_json, read_json

    request = read_json(request_path)
    workspace = Path(request["workspace"])
    output = confined_path(request_path.parent, "design-documents.json")
    if output.exists():
        raise ValueError("Design documents already resolved for this request")
    bindings = resolve_documents(
        workspace, request["workflow"]["artifactSnapshot"],
        Path(__file__).resolve().parents[2], request_path,
    )
    atomic_json(output, bindings)
    return output


def bound_documents(request_path: Path) -> dict:
    from staging import read_json

    request = read_json(request_path)
    bindings = read_json(declared_file(request_path.parent, "design-documents.json"))
    if not isinstance(bindings, dict) or set(bindings) != set(NAMES):
        raise ValueError("Missing required resolved design documents")
    expected = resolve_documents(Path(request["workspace"]),
                                 request["workflow"]["artifactSnapshot"],
                                 Path(__file__).resolve().parents[2], request_path)
    if bindings != expected:
        raise ValueError("Bound design documents changed since request preparation")
    return bindings


def category_warnings(request: dict, final: dict) -> list[str]:
    bindings = final if all(name in final for name in NAMES) else None
    if bindings is None:
        return []
    return [
        f"One-off {name} was superseded by {bindings[name]['provider']['kind']} "
        f"{bindings[name]['provider']['id']}"
        for name in request.get("inlineDocuments", {})
        if bindings[name]["provider"]["kind"] in ("preset", "extension")
        and bindings[name]["provider"]["id"] != GENERATOR_ID
    ]
