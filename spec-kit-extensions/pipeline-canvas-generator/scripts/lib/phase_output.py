"""Explicit per-phase artifact handoff and preset-replaceable exceptions."""

import re
from pathlib import Path

from validation import confined_path


COMMAND_ID = re.compile(r"^speckit\.[a-z0-9][a-z0-9.-]*$")
SEGMENT = re.compile(r"^(?:[a-zA-Z0-9._-]|<slug>|<name>)+$")
PLACEHOLDER = re.compile(r"<[^>]*>")
RESERVED = {"CON", "PRN", "AUX", "NUL", *(f"COM{i}" for i in range(1, 10)),
            *(f"LPT{i}" for i in range(1, 10))}


def validate_pair(value: object, workspace: Path | None = None) -> dict:
    if (not isinstance(value, dict) or set(value) != {"expectsArtifact", "outputPath"}
        or value["expectsArtifact"] is not None
        and type(value["expectsArtifact"]) is not bool):
        raise ValueError("Phase output requires expectsArtifact (boolean or null) and outputPath")
    expected, path = value["expectsArtifact"], value["outputPath"]
    if expected is False and path is not None:
        raise ValueError("A phase without a direct artifact must have a null path")
    if path is None:
        return value
    if (not isinstance(path, str) or len(path) > 2048 or not path.endswith(".md")
        or path.startswith("/") or "\\" in path or "\x00" in path
        or any(part in ("", ".", "..") for part in path.split("/"))
        or any(not SEGMENT.fullmatch(part) for part in path.split("/"))
        or any(tag not in ("<slug>", "<name>") for tag in PLACEHOLDER.findall(path))
        or any(part.split(".")[0].upper() in RESERVED for part in path.split("/"))):
        raise ValueError(f"Unsafe phase-output Markdown path: {path!r}")
    if workspace is not None:
        static = []
        for part in path.split("/"):
            if "<" in part:
                break
            static.append(part)
        if static:
            confined_path(workspace, "/".join(static))
    return value


def validate_handoff(outputs: object, phases: list[str], workspace: Path | None = None) -> list:
    if not isinstance(outputs, list) or len(outputs) != len(phases):
        raise ValueError("Each selected phase requires an ordered phase-output handoff")
    for phase, item in zip(phases, outputs, strict=True):
        if (not isinstance(item, dict) or set(item) != {
            "commandName", "expectsArtifact", "outputPath"
        } or item["commandName"] != phase):
            raise ValueError(f"Invalid or unordered phase-output handoff for {phase}")
        validate_pair({key: item[key] for key in ("expectsArtifact", "outputPath")}, workspace)
    return outputs


def derived_document(outputs: list[dict]) -> dict:
    return {"schemaVersion": 1, "byCommand": {
        item["commandName"]: {key: item[key] for key in ("expectsArtifact", "outputPath")}
        for item in outputs
    }}


def validate_document_commands(document: dict, phases: list[str], workspace: Path) -> None:
    actual = set(document["byCommand"])
    if actual != set(phases):
        raise ValueError(
            f"Phase outputs must match selected commands; missing: {sorted(set(phases) - actual)}, "
            f"extra: {sorted(actual - set(phases))}"
        )
    for pair in document["byCommand"].values():
        validate_pair(pair, workspace)


def bind_phase_outputs(outputs: list, document: dict, phases: list[str], workspace: Path) -> list:
    from experience import validate_complete_category

    validate_handoff(outputs, phases, workspace)
    validate_complete_category("phase-outputs", document, Path(__file__).resolve().parents[2])
    validate_document_commands(document, phases, workspace)
    return [
        {"commandName": item["commandName"], **document["byCommand"][item["commandName"]]}
        for item in outputs
    ]
