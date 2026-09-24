"""Publish one validated candidate; success requires subsequent provider verification."""

import hashlib
import re
import shutil
from pathlib import Path

from receipt import RECEIPT_NAME
from request import validate_request
from staging import atomic_json, read_json
from validation import MAX_DECLARED_FILE_BYTES, confined_path, declared_file, target_path, validate_candidate


INSTANCE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")


def _paths(request_path: Path) -> tuple[dict, Path, Path]:
    request = read_json(request_path)
    validate_request(request)
    root = Path(request["workspace"]).resolve(strict=True)
    expected = confined_path(
        root, f".specify/.cache/canvas-generation/{request_path.parent.name}/request.json",
        must_exist=True,
    )
    if request_path.absolute() != expected:
        raise ValueError("Request path is outside its captured generation directory")
    return request, target_path(root, request["canvas"]["id"]), request_path.parent / "staging"


def verify_published_target(request_path: Path) -> Path:
    request, target, candidate = _paths(request_path)
    if not target.is_dir() or target.is_symlink():
        raise ValueError("Published canvas target is missing or unsafe")
    receipt = read_json(declared_file(target, RECEIPT_NAME, maximum=MAX_DECLARED_FILE_BYTES))
    expected = read_json(candidate / RECEIPT_NAME)
    if receipt != expected or receipt["canvasId"] != request["canvas"]["id"]:
        raise ValueError("Published receipt does not match the validated candidate")
    files = {entry["path"]: entry["sha256"] for entry in receipt["files"]}
    if len(files) != len(receipt["files"]):
        raise ValueError("Published receipt has duplicate file paths")
    observed = set()
    for item in target.rglob("*"):
        relative = item.relative_to(target).as_posix()
        if item.is_symlink() or getattr(item, "is_junction", lambda: False)():
            raise ValueError(f"Published target contains a link: {relative}")
        if item.is_dir():
            continue
        if relative == RECEIPT_NAME:
            continue
        file = declared_file(target, relative, maximum=MAX_DECLARED_FILE_BYTES)
        observed.add(relative)
        if files.get(relative) != hashlib.sha256(file.read_bytes()).hexdigest():
            raise ValueError(f"Published file is missing from its receipt or changed: {relative}")
    if observed != files.keys():
        raise ValueError("Published target is missing receipt-declared files")
    return target


def publish_candidate(request_path: Path, scaffold_dir: Path) -> Path:
    request, target, candidate = _paths(request_path)
    if request["overwrite"]:
        raise ValueError("Replacement requires the separate confirmed Regenerate path")
    validate_candidate(request_path, scaffold_dir)
    receipt = declared_file(candidate, RECEIPT_NAME, maximum=MAX_DECLARED_FILE_BYTES)
    if not receipt.is_file():
        raise ValueError("Candidate receipt is missing")
    target.parent.mkdir(parents=True, exist_ok=True)
    try:
        target.mkdir(exist_ok=False)
    except FileExistsError as error:
        raise ValueError(f"Existing canvas target requires confirmed Regenerate: {target}") from error
    for entry in candidate.rglob("*"):
        if entry.is_dir():
            continue
        relative = entry.relative_to(candidate).as_posix()
        source = declared_file(candidate, relative, maximum=MAX_DECLARED_FILE_BYTES)
        destination = confined_path(target, relative)
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, destination)
    verify_published_target(request_path)
    return target


def regenerate_candidate(request_path: Path, scaffold_dir: Path, confirmed_target: str) -> Path:
    request, target, candidate = _paths(request_path)
    if not request["overwrite"] or confirmed_target != str(target):
        raise ValueError(f"Regenerate requires confirmation of the exact target: {target}")
    validate_candidate(request_path, scaffold_dir)
    declared_file(candidate, RECEIPT_NAME, maximum=MAX_DECLARED_FILE_BYTES)
    lock = confined_path(Path(request["workspace"]), f".github/extensions/.{request['canvas']['id']}.lock")
    lock.parent.mkdir(parents=True, exist_ok=True)
    try:
        lock.mkdir(exist_ok=False)
    except FileExistsError as error:
        raise ValueError(f"Another operation holds the target lock: {target}") from error
    try:
        target = target_path(Path(request["workspace"]), request["canvas"]["id"])
        if target.exists():
            if not target.is_dir():
                raise ValueError(f"Canvas target is not a directory: {target}")
            for entry in target.rglob("*"):
                if entry.is_symlink() or getattr(entry, "is_junction", lambda: False)():
                    raise ValueError(f"Canvas target contains a link: {entry}")
            shutil.rmtree(target)
        target.mkdir()
        for entry in candidate.rglob("*"):
            if entry.is_dir():
                continue
            relative = entry.relative_to(candidate).as_posix()
            source = declared_file(candidate, relative, maximum=MAX_DECLARED_FILE_BYTES)
            destination = confined_path(target, relative)
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, destination)
        verify_published_target(request_path)
        return target
    finally:
        lock.rmdir()


def record_outcome(
    request_path: Path, *,
    opened_instance: str | None = None,
    provider_id: str | None = None,
    error_code: str | None = None,
    details: str | None = None,
) -> Path:
    request, target, _ = _paths(request_path)
    output = request_path.with_name("result.json")
    if output.exists() or output.is_symlink():
        raise ValueError("Generation outcome is already recorded")
    if error_code is not None:
        if not isinstance(error_code, str) or not error_code or not details:
            raise ValueError("Failed outcome requires an error code and details")
        result = {
            "schemaVersion": 1, "status": "failed", "errorCode": error_code,
            "details": details, "warnings": [],
        }
    else:
        if provider_id != f"project:{request['canvas']['id']}" or not INSTANCE_ID.fullmatch(opened_instance or ""):
            raise ValueError("Success requires the inspected provider and opened canvas instance")
        verify_published_target(request_path)
        classified = {
            (row["kind"], row["id"])
            for row in request["workflow"]["artifactSnapshot"]["packageClassifications"]
            if row["classification"] == "canvas-design"
        }
        owners = {
            (binding["provider"]["kind"], binding["provider"]["id"])
            for binding in request["workflow"]["categoryTemplates"].values()
        }
        result = {
            "schemaVersion": 1, "status": "succeeded",
            "target": str(target),
            "designProviders": sorted({provider for kind, provider in owners if (kind, provider) in classified}),
            "warnings": read_json(request_path.parent / "staging" / RECEIPT_NAME)["warnings"],
        }
    atomic_json(output, result)
    return output
