"""Normalize one Specify resolution without recomputing any winners."""

import hashlib
import json
import re
from pathlib import Path

import yaml


PACKAGE_ID = re.compile(r"^[a-z0-9][a-z0-9._-]*$")
ARTIFACT_KINDS = {"command", "template", "script"}
LAYERS = {"core", "preset", "extension", "project", None}
STRATEGIES = {"replace", "wrap", "prepend", "append"}
SOURCE_FIELDS = {"kind", "name", "url", "path"}
LAYER_FIELDS = {
    "id", "sourceId", "layer", "strategy", "active", "hidden",
    "manifestPath", "lookupId", "sourcePath", "presetId", "presetName",
}


def _list(value: object, label: str) -> list:
    if not isinstance(value, list):
        raise ValueError(f"Specify {label} must be a JSON array")
    return value


def _object(value: object, label: str) -> dict:
    if not isinstance(value, dict):
        raise ValueError(f"Specify {label} must be a JSON object")
    return value


def _package_manifest(workspace: Path, kind: str, package_id: str) -> tuple[Path, str]:
    if not isinstance(package_id, str) or not PACKAGE_ID.fullmatch(package_id):
        raise ValueError(f"Invalid {kind} package ID: {package_id!r}")
    suffix = "presets" if kind == "preset" else "extensions"
    relative = Path(".specify") / suffix / package_id / f"{kind}.yml"
    root = workspace.resolve(strict=True)
    path = root / relative
    for part in (
        root / ".specify",
        root / ".specify" / suffix,
        root / ".specify" / suffix / package_id,
        path,
    ):
        if not part.exists() or part.is_symlink() or getattr(part, "is_junction", lambda: False)():
            raise ValueError(f"Missing or unsafe installed {kind} manifest: {relative}")
    if not path.is_file() or not path.resolve(strict=True).is_relative_to(root):
        raise ValueError(f"Installed {kind} manifest escapes workspace: {relative}")
    return path, relative.as_posix()


def _tags(package: dict, manifest_bytes: bytes, kind: str, package_id: str) -> list[str]:
    if "tags" in package:
        tags = package["tags"]
    else:
        try:
            data = yaml.safe_load(manifest_bytes.decode("utf-8"))
        except (UnicodeError, yaml.YAMLError) as error:
            raise ValueError(f"Cannot read installed {kind} {package_id} tags: {error}") from error
        if not isinstance(data, dict):
            raise ValueError(f"Installed {kind} {package_id} manifest must be a mapping")
        tags = data.get("tags", [])
    if not isinstance(tags, list) or any(
        not isinstance(tag, str) or not tag for tag in tags
    ) or len(set(tags)) != len(tags):
        raise ValueError(f"Invalid installed {kind} {package_id} tags")
    return tags


def normalize_snapshot(
    artifacts: object, presets: object, extensions: object, workspace: Path
) -> dict:
    """Retain Specify's ordered stacks and classify installed packages only."""
    root = workspace.resolve(strict=True)
    providers = []
    classifications = []
    installed = set()
    for kind, rows in (
        ("preset", _list(presets, "preset list")),
        ("extension", _list(extensions, "extension list")),
    ):
        for index, value in enumerate(rows):
            row = _object(value, f"{kind} list item {index}")
            package_id = row.get("id")
            manifest, manifest_path = _package_manifest(root, kind, package_id)
            try:
                manifest_bytes = manifest.read_bytes()
            except OSError as error:
                raise ValueError(f"Cannot read installed {kind} {package_id} manifest: {error}") from error
            if len(manifest_bytes) > 1024 * 1024:
                raise ValueError(f"Oversized installed {kind} {package_id} manifest")
            key = (kind, package_id)
            if key in installed:
                raise ValueError(f"Duplicate installed {kind}: {package_id}")
            installed.add(key)
            source = _object(row.get("source"), f"{kind} {package_id} source")
            if source.keys() - SOURCE_FIELDS or not isinstance(source.get("kind"), str):
                raise ValueError(f"Unsupported Specify source for {kind} {package_id}")
            version, priority, enabled = (
                row.get("version"), row.get("priority"), row.get("enabled")
            )
            if (
                not isinstance(version, str) or not version
                or type(priority) is not int or type(enabled) is not bool
            ):
                raise ValueError(f"Incomplete installed {kind} {package_id} metadata")
            tags = _tags(row, manifest_bytes, kind, package_id)
            providers.append({
                "id": package_id, "kind": kind, "version": version,
                "priority": priority, "enabled": enabled, "source": source,
                "manifestPath": manifest_path,
                "manifestSha256": hashlib.sha256(manifest_bytes).hexdigest(),
            })
            classifications.append({
                "id": package_id, "kind": kind, "tags": tags,
                "classification": "canvas-design" if "canvas-design" in tags else "runtime",
                "manifestPath": manifest_path,
            })

    normalized_artifacts = []
    identities = set()
    for index, value in enumerate(_list(artifacts, "artifact list")):
        row = _object(value, f"artifact list item {index}")
        kind, name = row.get("kind"), row.get("name")
        if kind not in ARTIFACT_KINDS or not isinstance(name, str) or not name:
            raise ValueError(f"Invalid artifact identity at row {index}")
        if (kind, name) in identities:
            raise ValueError(f"Duplicate Specify artifact identity: ({kind}, {name})")
        identities.add((kind, name))
        stack = []
        for layer_index, entry in enumerate(_list(row.get("stack"), f"{kind}:{name} stack")):
            layer = _object(entry, f"{kind}:{name} layer {layer_index}")
            if (
                layer.keys() - LAYER_FIELDS
                or not {"sourceId", "layer", "strategy", "active", "hidden", "manifestPath", "lookupId", "sourcePath"}.issubset(layer)
                or layer.get("layer") not in LAYERS
                or layer.get("strategy") not in STRATEGIES
                or type(layer.get("active")) is not bool
                or type(layer.get("hidden")) is not bool
            ):
                raise ValueError(f"Invalid Specify layer at {kind}:{name}[{layer_index}]")
            source_id = layer.get("sourceId")
            if layer.get("layer") in ("preset", "extension") and (
                layer["layer"], source_id
            ) not in installed:
                raise ValueError(f"Uninstalled provider {source_id!r} in {kind}:{name}")
            stack.append({key: layer.get(key) for key in (
                "sourceId", "layer", "strategy", "active", "hidden",
                "manifestPath", "lookupId", "sourcePath",
            )} | {key: layer[key] for key in ("id", "presetId", "presetName") if key in layer})
        if not stack:
            raise ValueError(f"Empty Specify stack for {kind}:{name}")
        item = {"kind": kind, "name": name, "stack": stack}
        if "description" in row:
            if not isinstance(row["description"], str):
                raise ValueError(f"Invalid description for {kind}:{name}")
            item["description"] = row["description"]
        normalized_artifacts.append(item)

    snapshot = {
        "schemaVersion": 1,
        "providers": providers,
        "artifacts": normalized_artifacts,
        "packageClassifications": classifications,
    }
    canonical = json.dumps(snapshot, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return {
        "schemaVersion": 1,
        "compositionFingerprint": hashlib.sha256(canonical.encode("utf-8")).hexdigest(),
        "providers": providers,
        "artifacts": normalized_artifacts,
        "packageClassifications": classifications,
    }
