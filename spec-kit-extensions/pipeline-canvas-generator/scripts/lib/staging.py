"""Exact-request control files; never clean a workspace or cache root."""

import json
import hashlib
import html
import os
import re
import subprocess
import tempfile
import uuid
from pathlib import Path

from validation import MAX_DECLARED_FILE_BYTES, confined_path, declared_file


SCAFFOLD_FOUNDATION = {
    "SDK session": r"\bjoinSession\s*\(",
    "canvas registration": r"\bcreateCanvas\s*\(",
    "local HTTP server": r"\bcreateServer\s*\(",
    "loopback binding": r"\.listen\s*\(\s*0\s*,\s*['\"]127\.0\.0\.1['\"]",
    "instance identity": r"\bctx\.instanceId\b",
    "action handler": r"\bactions\s*:\s*\[",
    "canvas open": r"\bopen\s*:\s*async\b",
    "canvas close": r"\bonClose\s*:\s*async\b",
    "server cleanup": r"\bserver\.close\s*\(",
}


def validate_canvas_scaffold(directory: Path) -> dict:
    """Reject missing or malformed host scaffolds before touching a target."""
    if not directory.is_dir() or directory.is_symlink() or getattr(directory, "is_junction", lambda: False)():
        raise ValueError("Canvas authoring scaffold directory is unavailable or unsafe")
    try:
        entry = declared_file(directory, "extension.mjs", maximum=512 * 1024)
    except FileNotFoundError as error:
        raise ValueError("Missing canvas authoring scaffold entry: extension.mjs") from error
    source = entry.read_text(encoding="utf-8")
    if '@github/copilot-sdk/extension' not in source:
        raise ValueError("Canvas scaffold is missing the SDK extension import")
    for part, expression in SCAFFOLD_FOUNDATION.items():
        if not re.search(expression, source):
            raise ValueError(f"Canvas scaffold is missing its {part} foundation")
    try:
        check = subprocess.run(
            ["node", "--check", str(entry)], capture_output=True, text=True, check=False,
        )
    except OSError as error:
        raise ValueError(f"Canvas authoring requires Node.js: {error}") from error
    if check.returncode:
        raise ValueError(f"Canvas scaffold has invalid JavaScript: {check.stderr.strip()}")
    return {"sha256": hashlib.sha256(entry.read_bytes()).hexdigest(), "entry": str(entry)}


def stage_canvas_scaffold(request_path: Path, scaffold_dir: Path) -> Path:
    """Snapshot a fresh authoring scaffold into this request, without loading it."""
    from override import _request_file

    request_file, _ = _request_file(request_path)
    validate_canvas_scaffold(scaffold_dir)
    destination = confined_path(request_file.parent, "authoring-scaffold")
    if destination.exists() or destination.is_symlink():
        raise ValueError("This request already has a staged authoring scaffold")
    files = {}
    for entry in scaffold_dir.rglob("*"):
        relative = entry.relative_to(scaffold_dir).as_posix()
        if entry.is_symlink() or getattr(entry, "is_junction", lambda: False)():
            raise ValueError(f"Authoring scaffold contains a link: {relative}")
        if entry.is_file():
            source = declared_file(scaffold_dir, relative, maximum=MAX_DECLARED_FILE_BYTES)
            files[relative] = source.read_bytes()
        elif not entry.is_dir():
            raise ValueError(f"Authoring scaffold contains an unsupported entry: {relative}")
        if len(files) > 128:
            raise ValueError("Authoring scaffold contains too many files")
    destination.mkdir()
    for relative, content in files.items():
        path = confined_path(destination, relative)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
    validate_canvas_scaffold(destination)
    return destination


def refine_canvas_scaffold(scaffold_dir: Path, backend: str) -> tuple[bytes, bytes]:
    """Keep the scaffold's SDK registration and server factory; supply protected handlers."""
    evidence = validate_canvas_scaffold(scaffold_dir)
    source = Path(evidence["entry"]).read_text(encoding="utf-8")
    sdk_imports = [
        line for line in source.splitlines()
        if line.startswith("import ") and (
            'from "node:http"' in line or "from 'node:http'" in line
            or 'from "@github/copilot-sdk/extension"' in line
            or "from '@github/copilot-sdk/extension'" in line
        )
    ]
    if len(sdk_imports) != 2 or not any("createServer" in line for line in sdk_imports):
        raise ValueError("Canvas scaffold has an unsupported SDK/server import shape")
    registration = (
        "\n".join(sdk_imports)
        + '\nimport { generatedCanvasOptions, bindGeneratedSession } from "./runtime/generated-canvas.mjs";\n\n'
        + "const session = await joinSession({\n"
        + "    canvases: [createCanvas(generatedCanvasOptions({ createServer }))],\n"
        + "});\n"
        + "await bindGeneratedSession(session);\n"
    )
    head = 'import { createServer } from "node:http";'
    sdk = 'import { joinSession, createCanvas } from "@github/copilot-sdk/extension";'
    if head not in backend or sdk not in backend:
        raise ValueError("Protected backend no longer matches the SDK scaffold foundation")
    backend = backend.replace(head, "", 1).replace(sdk, "", 1)
    replacements = {
        "./runtime/workflow-adapter.mjs": "./workflow-adapter.mjs",
        "./runtime/phase-runs.mjs": "./phase-runs.mjs",
        "./runtime/phase-results.mjs": "./phase-results.mjs",
        "./runtime/workspace-files.mjs": "./workspace-files.mjs",
        "./ui/": "../ui/",
        "./amendment-runtime.mjs": "../amendment-runtime.mjs",
        "./artifact-review.mjs": "../artifact-review.mjs",
        "./phase-response.mjs": "../phase-response.mjs",
        "./project-artifacts.mjs": "../project-artifacts.mjs",
        "./setup-runtime.mjs": "../setup-runtime.mjs",
        "./approval-runtime.mjs": "../approval-runtime.mjs",
        "const here = dirname(fileURLToPath(import.meta.url));":
            "const here = dirname(dirname(fileURLToPath(import.meta.url)));",
        "inst.server = createServer(": "inst.server = serverFactory(",
        "let session;": "let session;\nlet serverFactory;",
    }
    for before, after in replacements.items():
        if before not in backend:
            raise ValueError(f"Protected backend lacks scaffold refinement anchor: {before}")
        backend = backend.replace(before, after)
    marker = "session = await joinSession({"
    if backend.count(marker) != 1:
        raise ValueError("Protected backend registration shape changed")
    before, registration_tail = backend.split(marker, 1)
    options_marker = "canvases: [createCanvas({"
    options_end = "    })],\n});"
    if options_marker not in registration_tail or options_end not in registration_tail:
        raise ValueError("Protected backend canvas options cannot be refined")
    options, events = registration_tail.split(options_marker, 1)[1].split(options_end, 1)
    if not events.strip().startswith("if (trackPhaseRuns) {"):
        raise ValueError("Protected backend session lifecycle cannot be refined")
    refined_backend = (
        before
        + "export function generatedCanvasOptions({ createServer }) {\n"
        + "    serverFactory = createServer;\n"
        + "    return {" + options + "    };\n}\n\n"
        + "export async function bindGeneratedSession(connected) {\n"
        + "    session = connected;\n" + events
        + "}\n"
    )
    return registration.encode("utf-8"), refined_backend.encode("utf-8")


def create_request_dir(workspace: Path) -> Path:
    root = confined_path(workspace, ".specify/.cache/canvas-generation")
    root.mkdir(parents=True, exist_ok=True)
    for _ in range(3):
        request_id = str(uuid.uuid4())
        path = confined_path(root, request_id)
        try:
            path.mkdir()
        except FileExistsError:
            continue
        return path
    raise FileExistsError("Could not allocate a unique generation request directory")


def atomic_json(path: Path, value: object) -> bytes:
    if path.is_symlink() or getattr(path, "is_junction", lambda: False)():
        raise ValueError(f"Unsafe control-file target: {path}")
    data = canonical_json_bytes(value)
    handle, temporary = tempfile.mkstemp(prefix=f".{path.name}-", dir=path.parent)
    try:
        with os.fdopen(handle, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    return data


def canonical_json_bytes(value: object) -> bytes:
    return (json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False) + "\n").encode("utf-8")


def read_json(path: Path) -> object:
    if not path.is_file() or path.is_symlink() or getattr(path, "is_junction", lambda: False)():
        raise ValueError(f"Missing or unsafe control file: {path}")
    with path.open("r", encoding="utf-8") as stream:
        return json.load(stream)


def expected_candidate_files(request_path: Path, scaffold_dir: Path) -> dict[str, bytes]:
    """Derive every allowed candidate byte from the bound request and package."""
    from compiler import compile_blueprint
    from experience import default_experience, validate_complete_category
    from override import merge_sparse, validate_final_override
    from theme_asset import logo_file

    final = validate_final_override(request_path)
    request = read_json(request_path)
    blueprint = compile_blueprint(request)
    package = Path(__file__).resolve().parents[2]
    bindings = request["workflow"]["categoryTemplates"]
    profile = {"schemaVersion": 1, "categories": {
        name: binding["document"] for name, binding in bindings.items()
    }}
    for name, patch in final["categories"].items():
        if bindings[name]["provider"]["id"] != "pipeline-canvas-generator":
            continue
        profile["categories"][name] = merge_sparse(profile["categories"][name], patch)
        validate_complete_category(name, profile["categories"][name], package)
    profile["categories"]["canvas-content"]["workflowListName"] = request["canvas"]["workflowListName"]
    profile["categories"]["canvas-content"]["description"] = request["canvas"]["description"]
    profile["categories"]["canvas-onboarding"]["workflowSlug"]["userProvided"] = (
        request["instanceConfiguration"]["workflowSlug"]["userProvided"]
    )
    if profile["categories"]["canvas-onboarding"]["installationMode"] != "external":
        profile["categories"]["canvas-onboarding"]["installationMode"] = (
            request["instanceConfiguration"]["installationMode"]
        )
    for name in ("canvas-results", "canvas-onboarding"):
        validate_complete_category(name, profile["categories"][name], package)
    defaults = default_experience(package)["categories"]
    content = profile["categories"]["canvas-content"]
    onboarding = profile["categories"]["canvas-onboarding"]
    results = profile["categories"]["canvas-results"]
    if content["description"] != defaults["canvas-content"]["description"]:
        blueprint["metadata"]["description"] = content["description"]
    blueprint["metadata"]["workflowListName"] = content["workflowListName"]
    blueprint["runtime"]["userProvidesSlug"] = onboarding["workflowSlug"]["userProvided"]
    blueprint["setup"]["requireInstallationApproval"] = onboarding["installationMode"] == "prompt"
    source = package / "templates" / "generated-canvas"
    logo = logo_file(Path(request["workspace"]), package, profile["categories"]["canvas-theme"],
                     bindings["canvas-theme"])

    files = {}
    def changed_fields(document: dict, baseline: dict) -> dict:
        return {
            key: changed_fields(value, baseline[key])
            if isinstance(value, dict) and isinstance(baseline.get(key), dict)
            else value
            for key, value in document.items()
            if key not in baseline or value != baseline[key]
        }

    presentation = {
            name: changed_fields(document, defaults[name])
            for name, document in profile["categories"].items()
            if document != defaults[name]
    }
    replacements = {
        "__EXTENSION_ID_JSON__": json.dumps(request["canvas"]["id"], ensure_ascii=False),
        "__DISPLAY_NAME_JSON__": json.dumps(request["canvas"]["displayName"], ensure_ascii=False),
        "__DESCRIPTION_JSON__": json.dumps(blueprint["metadata"]["description"], ensure_ascii=False),
    }
    for source_file in source.rglob("*"):
        if source_file.is_dir():
            continue
        relative = source_file.relative_to(source)
        if relative.name in {"README.md", "workflow-config.json"}:
            continue
        original = declared_file(source, str(relative), maximum=MAX_DECLARED_FILE_BYTES)
        if relative.as_posix() == "extension.mjs":
            content = original.read_text(encoding="utf-8")
            for token, value in replacements.items():
                if token not in content:
                    raise ValueError(f"Generated runtime is missing the {token} placeholder")
                content = content.replace(token, value)
            files["extension.mjs"], files["runtime/generated-canvas.mjs"] = refine_canvas_scaffold(
                scaffold_dir, content,
            )
        elif relative.as_posix() == "ui/index.html":
            content = original.read_text(encoding="utf-8")
            if "__DISPLAY_NAME__" not in content:
                raise ValueError("Generated UI shell is missing its display-name placeholder")
            files[relative.as_posix()] = content.replace(
                "__DISPLAY_NAME__", html.escape(request["canvas"]["displayName"])
            ).encode("utf-8")
        elif relative.as_posix() == "ui/app.js":
            content = original.read_text(encoding="utf-8")
            if "__PRESENTATION_JSON__" not in content:
                raise ValueError("Generated UI is missing its presentation placeholder")
            files[relative.as_posix()] = content.replace(
                "__PRESENTATION_JSON__", json.dumps(presentation, ensure_ascii=False)
            ).encode("utf-8")
        else:
            files[relative.as_posix()] = original.read_bytes()
    if logo:
        files[f"theme/{logo[0]}"] = logo[1]
    files["pipeline.json"] = canonical_json_bytes(blueprint)
    files["canvas-experience.json"] = canonical_json_bytes(profile)
    files["workflow-config.json"] = canonical_json_bytes({
        "version": 1,
        "itemLabels": {},
        "phaseArguments": {},
        "resultLabels": results.get("resultLabels", []),
        "clarificationTag": results["clarification"]["enabled"],
    })
    return files


def materialize_candidate(request_path: Path, scaffold_dir: Path) -> Path:
    """Build an isolated candidate; this never publishes or replaces a target."""
    validate_canvas_scaffold(scaffold_dir)
    files = expected_candidate_files(request_path, scaffold_dir)
    staging = confined_path(request_path.parent, "staging")
    if staging.exists():
        raise ValueError("This request already has a staged candidate; start a new request")
    staging.mkdir()
    for relative, data in files.items():
        destination = confined_path(staging, relative)
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(data)
    return staging
