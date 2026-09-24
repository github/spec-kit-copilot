"""Receipt-based diagnostics and explicitly confirmed exact-target removal."""

import hashlib
import re
import shutil
from pathlib import Path

from receipt import RECEIPT_NAME
from staging import read_json
from validation import MAX_DECLARED_FILE_BYTES, confined_path, declared_file, target_path


SHA256 = re.compile(r"^[0-9a-f]{64}$")
MAX_TARGET_FILES = 4096


def inspect_target(workspace: Path, canvas_id: str) -> dict:
    root = workspace.resolve(strict=True)
    target = target_path(root, canvas_id)
    if not target.is_dir():
        raise ValueError(f"Generated canvas target does not exist: {target}")
    receipt_path = confined_path(target, RECEIPT_NAME)
    if not receipt_path.is_file():
        raise ValueError("Unrecognized generated canvas: receipt is missing")
    receipt = read_json(declared_file(target, RECEIPT_NAME))
    if not isinstance(receipt, dict) or receipt.get("schemaVersion") != 1:
        raise ValueError("Unrecognized generated canvas receipt")
    generator = receipt.get("generator")
    if (
        receipt.get("canvasId") != canvas_id
        or not isinstance(generator, dict)
        or generator.get("id") != "pipeline-canvas-generator"
        or not isinstance(generator.get("version"), str)
        or not generator["version"]
    ):
        raise ValueError("Receipt does not identify this generator and canvas")
    entries = receipt.get("files")
    if not isinstance(entries, list) or not 0 < len(entries) <= MAX_TARGET_FILES:
        raise ValueError("Receipt has an invalid file list")
    expected = {}
    for entry in entries:
        if not isinstance(entry, dict) or set(entry) != {"path", "sha256"}:
            raise ValueError("Receipt has an invalid file entry")
        name, digest = entry["path"], entry["sha256"]
        if not isinstance(name, str) or name == RECEIPT_NAME or not isinstance(digest, str) or not SHA256.fullmatch(digest) or name in expected:
            raise ValueError("Receipt has an invalid or duplicate file entry")
        file = declared_file(target, name, maximum=MAX_DECLARED_FILE_BYTES)
        if hashlib.sha256(file.read_bytes()).hexdigest() != digest:
            raise ValueError(f"Generated file changed since publication: {name}")
        expected[name] = digest
    observed = set()
    for item in target.rglob("*"):
        relative = item.relative_to(target).as_posix()
        if item.is_symlink() or getattr(item, "is_junction", lambda: False)():
            raise ValueError(f"Generated target contains a link: {relative}")
        if item.is_dir():
            continue
        if len(observed) >= MAX_TARGET_FILES + 1:
            raise ValueError("Generated target has too many files")
        declared_file(target, relative, maximum=MAX_DECLARED_FILE_BYTES)
        observed.add(relative)
    if observed != set(expected) | {RECEIPT_NAME}:
        raise ValueError(f"Generated target contains unexpected or missing files: {target}")
    return {
        "target": str(target),
        "canvasId": canvas_id,
        "generatorVersion": generator["version"],
        "fileCount": len(expected),
        "receipt": str(target / RECEIPT_NAME),
    }


def remove_target(workspace: Path, canvas_id: str, confirmed_target: str) -> dict:
    root = workspace.resolve(strict=True)
    target = target_path(root, canvas_id)
    if not isinstance(confirmed_target, str) or confirmed_target != str(target):
        raise ValueError(f"Removal requires confirmation of the exact target: {target}")
    lock = confined_path(root, f".github/extensions/.{canvas_id}.lock")
    try:
        lock.mkdir(exist_ok=False)
    except FileExistsError as error:
        raise ValueError(f"Another operation holds the target lock: {target}") from error
    try:
        report = inspect_target(root, canvas_id)
        shutil.rmtree(target)
        return report
    finally:
        lock.rmdir()
