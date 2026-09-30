"""Read registered Designer page templates using Specify's effective precedence."""

import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path

import yaml
from specify_cli.presets import PresetResolver

PACKAGE = Path(__file__).resolve().parents[2]
PREFIX = "canvas-settings-"
LIMIT = 256 * 1024
RULES = {
    "canvas.id": {"type": "string", "minLength": 1, "maxLength": 100,
                  "pattern": "^[a-z0-9][a-z0-9-]*$"},
    "canvas.displayName": {"type": "string", "minLength": 1, "maxLength": 120},
    "canvas.description": {"type": "string", "maxLength": 240},
    "canvas.workflowListName": {"type": "string", "maxLength": 80},
    "workflowSlug.userProvided": {"type": "boolean"},
}


def read_text(path):
    if path.is_symlink() or not path.is_file() or path.stat().st_size > LIMIT:
        raise ValueError(f"Missing, unsafe or oversized page file: {path}")
    data = path.read_bytes()
    if len(data) > LIMIT:
        raise ValueError(f"Oversized page file: {path}")
    return data.decode("utf-8")


def confined(root, value):
    path = root / value
    if not path.resolve().is_relative_to(root.resolve()):
        raise ValueError("Template path escapes its provider")
    if path.resolve() != path.absolute():
        raise ValueError("Template path contains a symlink")
    return path


def specify_json(project, args):
    result = subprocess.run(
        [sys.executable, "-X", "utf8", "-c", "from specify_cli import app; app()",
         *args, "--json"], cwd=project, capture_output=True, encoding="utf-8", timeout=30,
    )
    if result.returncode:
        raise ValueError(f"Specify {' '.join(args)} failed: {result.stderr.strip()[:1000]}")
    if len(result.stdout.encode("utf-8")) > 2 * 1024 * 1024:
        raise ValueError("Specify artifact inventory exceeds the size limit")
    return json.loads(result.stdout)


def provider_root(project, kind, provider, dev_source):
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,99}", provider):
        raise ValueError("Invalid template provider ID")
    path = project / ".specify" / f"{kind}s" / provider
    actual = path.resolve(strict=True)
    if actual != path:
        if kind != "extension" or provider != "canvas-design" or actual != dev_source:
            raise ValueError("Template provider escapes its installed root")
    elif not actual.is_relative_to(project):
        raise ValueError("Template provider escapes the child project")
    return actual


def intended_template(project, resolver, name, dev_source):
    # resolve() can skip a declared but missing file; inspect declarations first.
    override = confined(project, f".specify/templates/overrides/{name}.md")
    if override.exists():
        return override, "project", "overrides"
    providers = [("preset", key) for key, _ in resolver._get_all_presets_by_priority()]
    providers += [("extension", key) for _, key, _ in resolver._get_all_extensions_by_priority()]
    for kind, provider in providers:
        root = provider_root(project, kind, provider, dev_source)
        manifest_path = confined(root, f"{kind}.yml")
        if manifest_path.exists():
            manifest = yaml.safe_load(read_text(manifest_path))
            templates = manifest.get("provides", {}).get("templates", [])
            for template in templates:
                if template.get("name") == name:
                    file = template.get("file")
                    if not isinstance(file, str) or not file:
                        raise ValueError(f"{name}: missing declared file")
                    return confined(root, file), kind, provider
        for value in (f"templates/{name}.md", f"{name}.md"):
            candidate = confined(root, value)
            if candidate.exists():
                return candidate, kind, provider
    raise ValueError(f"{name}: no installed template provider")


def check_schema(value, schema, location):
    if "const" in schema and (type(value) is not type(schema["const"]) or value != schema["const"]):
        raise ValueError(f"{location}: unsupported schema version")
    if "enum" in schema and value not in schema["enum"]:
        raise ValueError(f"{location}: unsupported value")
    kind = schema.get("type")
    types = {"object": dict, "array": list, "string": str, "integer": int, "boolean": bool}
    if kind and type(value) is not types[kind]:
        raise ValueError(f"{location}: expected {kind}")
    if kind == "object":
        if set(schema.get("required", [])) - value.keys():
            raise ValueError(f"{location}: missing required fields")
        properties = schema["properties"]
        if schema.get("additionalProperties") is False and value.keys() - properties.keys():
            raise ValueError(f"{location}: unsupported properties")
        for key, item in value.items():
            check_schema(item, properties[key], f"{location}.{key}")
    if kind == "array":
        if len(value) > schema["maxItems"]:
            raise ValueError(f"{location}: too many items")
        for index, item in enumerate(value):
            check_schema(item, schema["items"], f"{location}[{index}]")
    if kind == "string":
        if not schema.get("minLength", 0) <= len(value) <= schema.get("maxLength", LIMIT):
            raise ValueError(f"{location}: invalid text length")
        if "pattern" in schema and not re.fullmatch(schema["pattern"], value):
            raise ValueError(f"{location}: invalid identifier")
    if kind == "integer" and not schema["minimum"] <= value <= schema["maximum"]:
        raise ValueError(f"{location}: out of range")


def load_pages(project, dev_source):
    project, dev_source = Path(project).resolve(strict=True), Path(dev_source).resolve(strict=True)
    inventory = specify_json(project, ["artifact", "list"])
    if not isinstance(inventory, list):
        raise ValueError("Invalid Specify artifact inventory")
    names = set()
    for item in inventory:
        name = item.get("name", "")
        if item.get("kind") == "template" and isinstance(name, str) and name.startswith(PREFIX):
            if not re.fullmatch(r"[a-z][a-z0-9-]{0,63}", name[len(PREFIX):]):
                raise ValueError("Invalid registered Designer page name")
            names.add(name)
    if not 1 <= len(names) <= 100:
        raise ValueError("Missing or excessive registered Designer pages")
    schema = json.loads(read_text(PACKAGE / "schemas" / "page.schema.json"))
    resolver = PresetResolver(project)
    pages, constraints, values = [], {}, {}
    for name in sorted(names):
        path, kind, provider = intended_template(project, resolver, name, dev_source)
        text = read_text(path)
        artifact = specify_json(project, ["artifact", "info", f"template:{name}"])
        active = [layer for layer in artifact.get("stack", []) if layer.get("active")]
        if (len(active) != 1 or active[0].get("hidden")
                or active[0].get("strategy", "replace") != "replace"):
            raise ValueError(f"{name}: expected one effective replace layer")
        layer = active[0]
        resolved = resolver.resolve(name, template_type="template")
        if (resolved is None or Path(resolved).resolve() != path.resolve()
                or layer.get("layer") != kind
                or (kind != "project" and layer.get("sourceId") != provider)
                or (kind != "project" and
                    (project / layer.get("sourcePath", "")).resolve() != path.resolve())):
            raise ValueError(f"{name}: template resolution and provenance disagree")
        if read_text(path) != text:
            raise ValueError(f"{name}: template changed during resolution; reopen Designer")
        document = json.loads(text)
        check_schema(document, schema, name)
        ids = set()
        for field in document["fields"]:
            key, field_type = field["id"], field.get("type", "string")
            if (key in ids or ("default" in field and field_type != "boolean")
                    or (key in RULES and field_type != RULES[key]["type"])):
                raise ValueError(f"{name}: duplicate or invalid field {key}")
            ids.add(key)
            if not document.get("enabled", True):
                continue
            if key in constraints:
                raise ValueError(f"Duplicate enabled field: {key}")
            constraints[key] = RULES.get(key, {"type": field_type, **(
                {"maxLength": 1000} if field_type == "string" else {})})
            values[key] = field.get("default", False) if field_type == "boolean" else ""
        if document.get("enabled", True):
            pages.append({**document, "page": name[len(PREFIX):], "provenance": {
                "template": name, "kind": kind, "provider": provider,
                "fingerprint": hashlib.sha256(text.encode("utf-8")).hexdigest(),
            }})
    if {"canvas.id", "canvas.displayName"} - constraints.keys():
        raise ValueError("Enabled pages must contain Canvas ID and Title")
    return {"pages": sorted(pages, key=lambda page: (page["order"], page["page"])),
            "constraints": constraints, "values": values}


if __name__ == "__main__":
    try:
        if len(sys.argv) != 3:
            raise ValueError("Usage: pages.py <child-project> <validated-design-source>")
        print(json.dumps(load_pages(*sys.argv[1:])))
    except (ValueError, OSError, subprocess.SubprocessError, yaml.YAMLError) as error:
        print(json.dumps({"error": str(error)}), file=sys.stderr)
        sys.exit(1)
