"""Finalize an empty compatibility draft against one immutable request."""

import hashlib
from pathlib import Path

from request import validate_request
from staging import atomic_json, read_json
from validation import confined_path, declared_file


def _request_file(path: Path) -> tuple[Path, bytes]:
    request = read_json(path)
    validate_request(request)
    workspace = Path(request["workspace"]).resolve(strict=True)
    relative = Path(".specify/.cache/canvas-generation") / path.parent.name / "request.json"
    expected = confined_path(workspace, str(relative), must_exist=True)
    if path.absolute() != expected or path.parent.name in {"", ".", ".."}:
        raise ValueError("Request must be the exact captured generation control file")
    file = declared_file(workspace, str(relative), maximum=512 * 1024)
    return file, file.read_bytes()


def validate_sparse_categories(value: object) -> dict:
    if value != {}:
        raise ValueError(
            "Sparse command overrides are unsupported; use whole-file named "
            "templates or per-app request configuration"
        )
    return {}


def validate_override_categories(value: object, selected_phases: list[str]) -> dict:
    return validate_sparse_categories(value)


def prepare_override(request_path: Path) -> Path:
    """The draft never supplies authority fields or materialization inputs."""
    request_file, content = _request_file(request_path)
    draft_file = request_file.with_name("command-override-draft.json")
    draft_file = declared_file(request_file.parent, draft_file.name, maximum=256 * 1024)
    draft = read_json(draft_file)
    if not isinstance(draft, dict) or set(draft) != {"categories"}:
        raise ValueError("Override draft must contain only categories")
    categories = validate_override_categories(
        draft["categories"], read_json(request_file)["workflow"]["selectedPhases"]
    )
    final = request_file.with_name("command-override.json")
    if final.exists() or final.is_symlink():
        raise ValueError("Finalized override already exists for this request")
    atomic_json(final, {
        "schemaVersion": 1,
        "requestSha256": hashlib.sha256(content).hexdigest(),
        "categories": categories,
    })
    return final


def validate_final_override(request_path: Path) -> dict:
    """Materialization must call this, never accept a draft or absent override."""
    request_file, content = _request_file(request_path)
    final = request_file.with_name("command-override.json")
    if not final.is_file():
        raise ValueError("Missing finalized override; run prepare-override first")
    final = declared_file(request_file.parent, final.name, maximum=256 * 1024)
    value = read_json(final)
    if not isinstance(value, dict) or set(value) != {"schemaVersion", "requestSha256", "categories"}:
        raise ValueError("Invalid finalized override fields")
    if type(value["schemaVersion"]) is not int or value["schemaVersion"] != 1:
        raise ValueError("Unsupported finalized override version")
    if value["requestSha256"] != hashlib.sha256(content).hexdigest():
        raise ValueError("Finalized override request digest does not match")
    validate_override_categories(
        value["categories"], read_json(request_file)["workflow"]["selectedPhases"]
    )
    return value
