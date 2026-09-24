"""Bounded, symlink-free paths for generator inputs and final targets."""

import re
import subprocess
from pathlib import Path


CANVAS_ID = re.compile(r"^[a-z0-9][a-z0-9-]*$")
PACKAGE_ID = re.compile(r"^[a-z0-9][a-z0-9._-]*$")
MAX_DECLARED_FILE_BYTES = 5 * 1024 * 1024


def confined_path(root: Path, relative: str, *, must_exist: bool = False) -> Path:
    """Reject escapes and symlink/reparse points in every existing component."""
    if not isinstance(relative, str) or not relative or "\x00" in relative:
        raise ValueError("Path must be a nonempty relative string")
    fragment = Path(relative)
    if fragment.is_absolute() or ".." in fragment.parts or fragment == Path("."):
        raise ValueError(f"Path escapes its allowed root: {relative}")
    base = root.resolve(strict=True)
    current = base
    for part in fragment.parts:
        current = current / part
        if current.is_symlink() or getattr(current, "is_junction", lambda: False)():
            raise ValueError(f"Symlink or reparse point is not permitted: {relative}")
    candidate = current.resolve(strict=must_exist)
    if not candidate.is_relative_to(base):
        raise ValueError(f"Path escapes its allowed root: {relative}")
    return candidate


def declared_file(root: Path, relative: str, *, maximum: int = MAX_DECLARED_FILE_BYTES) -> Path:
    file = confined_path(root, relative, must_exist=True)
    if not file.is_file() or file.stat().st_size > maximum:
        raise ValueError(f"Missing, nonregular, or oversized declared file: {relative}")
    return file


def package_file(workspace: Path, kind: str, package_id: str, relative: str) -> Path:
    if kind not in {"preset", "extension"} or not isinstance(package_id, str) or not PACKAGE_ID.fullmatch(package_id):
        raise ValueError(f"Invalid package identity: {kind}:{package_id}")
    package_root = confined_path(
        workspace,
        f".specify/{'presets' if kind == 'preset' else 'extensions'}/{package_id}",
        must_exist=True,
    )
    return declared_file(package_root, relative)


def target_path(workspace: Path, canvas_id: str) -> Path:
    if not isinstance(canvas_id, str) or not CANVAS_ID.fullmatch(canvas_id):
        raise ValueError(f"Invalid canvas ID: {canvas_id!r}")
    target = confined_path(workspace, f".github/extensions/{canvas_id}")
    if target.exists() and not target.is_dir():
        raise ValueError(f"Existing canvas target is not a directory: {target}")
    return target


def validate_candidate(request_path: Path, scaffold_dir: Path) -> dict[str, str]:
    """Require exact package bytes, safe paths, and compiled authority before publication."""
    import hashlib
    from staging import expected_candidate_files, read_json, validate_canvas_scaffold
    from experience import validate_complete_category

    validate_canvas_scaffold(scaffold_dir)
    expected = expected_candidate_files(request_path, scaffold_dir)
    root = confined_path(request_path.parent, "staging", must_exist=True)
    if not root.is_dir():
        raise ValueError("Candidate staging root must be a directory")
    present = set()
    has_receipt = False
    for entry in root.rglob("*"):
        relative = entry.relative_to(root)
        if entry.is_symlink() or getattr(entry, "is_junction", lambda: False)():
            raise ValueError(f"Candidate contains a symlink or reparse point: {relative}")
        if entry.is_dir():
            continue
        name = relative.as_posix()
        if name == ".speckit-canvas.json":
            declared_file(root, name, maximum=MAX_DECLARED_FILE_BYTES)
            has_receipt = True
            continue
        present.add(name)
        file = declared_file(root, name, maximum=MAX_DECLARED_FILE_BYTES)
        if name not in expected or file.read_bytes() != expected[name]:
            raise ValueError(f"Unexpected or modified candidate file: {name}")
    if present != expected.keys():
        raise ValueError(f"Candidate is missing declared files: {sorted(expected.keys() - present)}")
    blueprint = read_json(root / "pipeline.json")
    request = read_json(request_path)
    if blueprint["phaseOutputs"] != request["workflow"]["phaseOutputs"]:
        raise ValueError("Candidate blueprint changed request-bound phase outputs")
    profile = read_json(root / "canvas-experience.json")
    for name, document in profile["categories"].items():
        validate_complete_category(name, document, Path(__file__).resolve().parents[2])
    source = (root / "runtime" / "generated-canvas.mjs").read_text(encoding="utf-8")
    for required in ('name: "list_items"', 'name: "run_phase"', 'name: "setup_workflow"'):
        if required not in source:
            raise ValueError(f"Candidate is missing required action: {required}")
    for forbidden in ('name: "install_extension"', 'name: "execute_shell"', 'name: "replace_pipeline"'):
        if forbidden in source:
            raise ValueError(f"Candidate contains forbidden action: {forbidden}")
    for name in sorted(present):
        if name.endswith((".mjs", ".js")) and b"shared-workflow-ui" in expected[name]:
            raise ValueError(f"Candidate depends on Wizard UI assets: {name}")
    for name in sorted(present):
        if not name.endswith((".mjs", ".js")):
            continue
        try:
            checked = subprocess.run(
                ["node", "--check", str(root / name)],
                capture_output=True, text=True, check=False,
            )
        except OSError as error:
            raise ValueError(f"Node.js is required to validate generated runtime: {error}") from error
        if checked.returncode:
            raise ValueError(f"Invalid candidate JavaScript {name}: {checked.stderr.strip()}")
    hashes = {name: hashlib.sha256(expected[name]).hexdigest() for name in sorted(present)}
    if has_receipt:
        from receipt import verify_receipt
        verify_receipt(request_path, hashes)
    return hashes
