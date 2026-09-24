"""Explicitly named Canvas Design support commands, never automatic hooks."""

import hashlib
import re
from pathlib import Path

import yaml

from override import validate_override_categories
from request import validate_request
from staging import atomic_json, read_json
from validation import declared_file


SUPPORT_NAME = re.compile(r"^[a-z0-9][a-z0-9-]*\.[a-z0-9][a-z0-9.-]*$")


def validate_support_command(request_path: Path, name: str) -> dict:
    request = read_json(request_path)
    validate_request(request)
    if not isinstance(name, str) or not SUPPORT_NAME.fullmatch(name):
        raise ValueError("Support command must be an explicitly named extension command")
    if name in request["workflow"]["selectedPhases"] or name == "speckit.pipeline-canvas-generator.generate":
        raise ValueError("Support command must be distinct from generation and runtime phases")
    snapshot = request["workflow"]["artifactSnapshot"]
    matches = [
        row for row in snapshot["artifacts"]
        if row["kind"] == "command" and row["name"] == name
    ]
    if len(matches) != 1:
        raise ValueError(f"Support command is not present in the captured composition: {name}")
    contributors = [layer for layer in matches[0]["stack"] if layer["active"]]
    if not contributors:
        raise ValueError(f"Support command has no effective provider: {name}")
    effective = contributors[0]
    if effective["layer"] != "extension" or not effective["sourceId"]:
        raise ValueError(f"Support command must be contributed by a Canvas Design extension: {name}")
    package_id = effective["sourceId"]
    tagged = any(
        row["kind"] == "extension" and row["id"] == package_id
        and row["classification"] == "canvas-design"
        for row in snapshot["packageClassifications"]
    )
    if not tagged:
        raise ValueError(f"Support extension {package_id} is not classified canvas-design")
    provider = next(
        (entry for entry in snapshot["providers"]
         if entry["kind"] == "extension" and entry["id"] == package_id),
        None,
    )
    source = effective["sourcePath"]
    prefix = Path(".specify") / "extensions" / package_id
    if provider is None or not source:
        raise ValueError(f"Support command {name} lacks a captured installed source")
    root = Path(request["workspace"])
    if not Path(source).is_relative_to(prefix):
        skill = Path(".github") / "skills" / name.replace(".", "-") / "SKILL.md"
        if Path(source) != skill:
            raise ValueError(f"Support command {name} lacks a captured installed source")
        manifest = declared_file(root, str(prefix / "extension.yml"), maximum=256 * 1024)
        try:
            installed = yaml.safe_load(manifest.read_text(encoding="utf-8"))
        except (yaml.YAMLError, UnicodeError) as error:
            raise ValueError(f"Invalid installed support extension manifest: {error}") from error
        provides = installed.get("provides") if isinstance(installed, dict) else None
        commands = provides.get("commands") if isinstance(provides, dict) else None
        declarations = [
            entry for entry in commands or []
            if isinstance(entry, dict) and entry.get("name") == name
        ]
        if len(declarations) != 1 or not isinstance(declarations[0].get("file"), str):
            raise ValueError(f"Generated support skill is not declared by extension {package_id}")
        declared_file(root, str(prefix / declarations[0]["file"]), maximum=256 * 1024)
    file = declared_file(root, source, maximum=256 * 1024)
    content = file.read_bytes()
    documentation = content.decode("utf-8")
    if "## Inputs" not in documentation or "## Result" not in documentation:
        raise ValueError(f"Support command {name} must document its inputs and result")
    return {
        "commandName": name,
        "invocation": f"/skill:{name.replace('.', '-')}",
        "extensionId": package_id,
        "extensionVersion": provider["version"],
        "sourcePath": source,
        "sourceSha256": hashlib.sha256(content).hexdigest(),
        "documentation": documentation,
    }


def record_support_result(request_path: Path, name: str, response: object, source_sha256: str) -> Path:
    """Call only after one explicit skill invocation has returned a result."""
    binding = validate_support_command(request_path, name)
    if not isinstance(source_sha256, str) or source_sha256 != binding["sourceSha256"]:
        raise ValueError("Support command source changed after explicit validation")
    if not isinstance(response, dict) or set(response) != {"categories"}:
        raise ValueError("Support command result must contain only categories")
    request = read_json(request_path)
    categories = validate_override_categories(
        response["categories"], request["workflow"]["selectedPhases"]
    )
    draft = request_path.with_name("command-override-draft.json")
    if draft.exists() or draft.is_symlink():
        raise ValueError("This request already has a command override draft")
    atomic_json(draft, {"categories": categories})
    return draft
