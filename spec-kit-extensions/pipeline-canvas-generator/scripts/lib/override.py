"""Finalize a sparse model draft against exactly one immutable request."""

import hashlib
import math
from pathlib import Path

from request import validate_request
from staging import atomic_json, read_json
from validation import confined_path, declared_file


CATEGORY_FIELDS = {
    "canvas-content": {"workflowListName", "itemName", "description", "copy"},
    "canvas-theme": {"colors", "typography", "density", "shape", "brand"},
    "canvas-layout": {"phases", "artifacts", "clarification", "amendment"},
    "canvas-interactions": {"progression", "rerun", "inputs", "phaseRunConfirmations", "artifacts"},
    "canvas-results": {"defaultResult", "phases", "clarification", "progress", "resultLabels"},
    "canvas-onboarding": {
        "workflowSlug", "installationMode", "approvalCopy", "readinessCopy",
        "firstRunCopy", "helpCopy", "recoveryCopy",
    },
}
PROTECTED_FIELDS = {"schemaVersion", "requestSha256", "__proto__", "constructor", "prototype"}


def merge_sparse(complete: dict, patch: dict) -> dict:
    merged = dict(complete)
    for field, value in patch.items():
        if isinstance(value, dict) and isinstance(merged.get(field), dict):
            merged[field] = merge_sparse(merged[field], value)
        else:
            merged[field] = value
    return merged


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
    if not isinstance(value, dict) or set(value) - CATEGORY_FIELDS.keys():
        raise ValueError("Override categories must use only the six declared categories")
    for category, patch in value.items():
        if not isinstance(patch, dict) or set(patch) - CATEGORY_FIELDS[category]:
            raise ValueError(f"Unsupported sparse override path in {category}")
        pending = [patch]
        while pending:
            node = pending.pop()
            if isinstance(node, dict):
                if PROTECTED_FIELDS.intersection(node):
                    raise ValueError(f"Protected sparse override field in {category}")
                pending.extend(node.values())
            elif isinstance(node, list):
                pending.extend(node)
            elif node is None or not isinstance(node, (str, int, float, bool)) or (
                isinstance(node, float) and not math.isfinite(node)
            ):
                raise ValueError(f"Invalid or null sparse override value in {category}")
    return value


def validate_phase_overrides(categories: dict, selected_phases: list[str]) -> None:
    selected = set(selected_phases)
    for name in ("canvas-interactions", "canvas-results"):
        category = categories.get(name, {})
        maps = (
            (category.get("inputs", {}).get("phases", {}), category.get("phaseRunConfirmations", {}))
            if name == "canvas-interactions" else (category.get("phases", {}),)
        )
        for mapping in maps:
            if set(mapping) - selected:
                raise ValueError(f"{name} references an unselected phase")


def validate_override_categories(value: object, selected_phases: list[str]) -> dict:
    categories = validate_sparse_categories(value)
    validate_phase_overrides(categories, selected_phases)
    from experience import default_experience, validate_complete_category

    package = Path(__file__).resolve().parents[2]
    defaults = default_experience(package)["categories"]
    for name, patch in categories.items():
        validate_complete_category(name, merge_sparse(defaults[name], patch), package)
    return categories


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
