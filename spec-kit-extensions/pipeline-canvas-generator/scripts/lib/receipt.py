"""Exact candidate provenance and integrity receipt; never self-hash."""

import hashlib
import json
from pathlib import Path

import yaml

from category_contracts import NAMES, bound_documents
from staging import atomic_json, canonical_json_bytes, read_json


RECEIPT_NAME = ".speckit-canvas.json"


def build_receipt(request_path: Path, file_hashes: dict[str, str]) -> dict:
    from category_contracts import category_warnings
    if RECEIPT_NAME in file_hashes:
        raise ValueError("The receipt must not hash itself")
    request = read_json(request_path)
    candidate = request_path.parent / "staging"
    blueprint = read_json(candidate / "pipeline.json")
    profile = read_json(candidate / "canvas-experience.json")
    package = Path(__file__).resolve().parents[2]
    metadata = yaml.safe_load((package / "extension.yml").read_text(encoding="utf-8"))
    generator_id = metadata["extension"]["id"]
    generator_version = metadata["extension"]["version"]
    bindings = bound_documents(request_path)
    logo = profile["presentation"]["brand"]["logo"]
    categories = {
        name: {
            "owner": bindings[name]["provider"]["id"],
            "version": bindings[name]["provider"]["version"],
            "sourcePath": bindings[name]["sourcePath"],
            "sourceSha256": bindings[name]["sha256"],
            "sha256": hashlib.sha256(canonical_json_bytes(bindings[name]["document"])).hexdigest(),
            **({"submittedInline": {
                "sha256": hashlib.sha256(canonical_json_bytes(
                    request["inlineDocuments"][name])).hexdigest(),
                "superseded": bindings[name]["provider"]["kind"] != "inline",
            }} if name in request.get("inlineDocuments", {}) else {}),
        }
        for name in NAMES
    }
    providers = [
        {"kind": kind, "id": entry["id"], "version": entry["version"]}
        for kind in ("preset", "extension")
        for entry in blueprint["setup"][f"{kind}s"]
    ]
    return {
        "schemaVersion": 1,
        "canvasId": request["canvas"]["id"],
        "generator": {
            "id": generator_id,
            "version": generator_version,
            "templateVersion": "1",
        },
        "requestSha256": hashlib.sha256(request_path.read_bytes()).hexdigest(),
        "blueprintSha256": file_hashes["pipeline.json"],
        "experienceSha256": file_hashes["canvas-experience.json"],
        "categories": categories,
        "warnings": category_warnings(request, bindings),
        "logo": ({
            "provider": bindings["canvas-presentation"]["provider"],
            "sourcePath": logo["path"],
            "generatedPath": f"theme/{logo['path']}",
            "sha256": file_hashes[f"theme/{logo['path']}"],
        } if logo["mode"] == "asset" else {"mode": logo["mode"]}),
        "runtimeProviders": providers,
        "provenance": [
            {
                "kind": "template",
                "name": name,
                "stack": [
                    json.dumps(layer, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
                    for layer in bindings[name]["templateStack"]
                ],
            }
            for name in NAMES
        ],
        "files": [
            {"path": name, "sha256": digest}
            for name, digest in sorted(file_hashes.items())
        ],
    }


def write_receipt(request_path: Path, scaffold_dir: Path) -> Path:
    from validation import validate_candidate

    candidate = request_path.parent / "staging"
    path = candidate / RECEIPT_NAME
    if path.exists() or path.is_symlink():
        raise ValueError("Candidate receipt already exists")
    hashes = validate_candidate(request_path, scaffold_dir)
    atomic_json(path, build_receipt(request_path, hashes))
    return path


def verify_receipt(request_path: Path, file_hashes: dict[str, str]) -> None:
    actual = read_json(request_path.parent / "staging" / RECEIPT_NAME)
    if actual != build_receipt(request_path, file_hashes):
        raise ValueError("Candidate receipt does not match its request and exact files")
