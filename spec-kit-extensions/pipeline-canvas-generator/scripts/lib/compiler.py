"""Compile a request-bound linear blueprint without reading live composition."""

from copy import deepcopy

from request import validate_request


DEFAULT_ARGUMENTS = {
    "hint": "Provide guidance to focus or scope this phase.",
    "whenEmpty": "If left empty, the phase will run with default behavior using the existing artifacts.",
}
CORE_ARGUMENTS = {
    "constitution": (
        "Enter your project's governing principles and development guidelines that will guide all subsequent development.",
        "If left empty, a new constitution will be drafted from your repo context (README, docs) for review; otherwise, an existing constitution will be changed.",
    ),
    "specify": (
        "Describe what you want to build - focus on the what and why, not the tech stack.",
        "A description is required.",
    ),
    "clarify": (
        "Provide areas of concern to focus clarification pass.",
        "If left empty, the full spec will be scanned across categories of impact areas (scope, data model, UX, integration, etc.).",
    ),
    "plan": (
        "Provide your tech stack and architecture choices.",
        "If left empty, the plan will be derived from the spec.md and constitution.md alone, marking missing technical decisions as needing clarification.",
    ),
    "tasks": (
        "Add guidance for task generation like groupings, priorities, and areas to emphasize.",
        "If left empty, a full, dependency-ordered tasks.md will be generated directly from plan.md and spec.md (with constitution.md as governing constraints).",
    ),
    "implement": (
        "Add guidance for the implementation.",
        "If left empty, all tasks in tasks.md will be implemented in dependency order, updating progress markers as each completes.",
    ),
    "analyze": (
        "Add a specific concern for analysis to focus on.",
        "If left empty, a full consistency and quality analysis will be performed across spec.md, plan.md, and tasks.md (with constitution.md as governing authority).",
    ),
    "taskstoissues": (
        "Add issue-creation guidance like labels, milestone, and assignees.",
        "If left empty, one GitHub issue per task will be created in tasks.md on the current repo's git remote.",
    ),
}


def _source(snapshot: dict, command: dict) -> dict:
    contributor = next(
        (layer for layer in command["stack"]
         if layer["active"] and layer["layer"] in ("project", "preset", "extension")),
        None,
    )
    if contributor is None:
        return {"kind": "core", "id": None, "version": None, "skillPath": None}
    if contributor["layer"] == "project":
        return {
            "kind": "project", "id": "project", "version": None,
            "skillPath": contributor["sourcePath"],
        }
    provider = next(
        entry for entry in snapshot["providers"]
        if entry["kind"] == contributor["layer"] and entry["id"] == contributor["sourceId"]
    )
    return {
        "kind": provider["kind"], "id": provider["id"],
        "version": provider["version"], "skillPath": contributor["sourcePath"],
    }


def _setup_requirements(
    snapshot: dict, commands: list[dict], steps: list[dict],
    skill_hashes: dict | None = None,
) -> dict:
    providers = {}
    precedence = {"preset": {}, "extension": {}}
    for provider in snapshot["providers"]:
        kind = provider["kind"]
        precedence[kind][provider["id"]] = len(precedence[kind])
    for command in commands:
        for layer in command["stack"]:
            if not layer["active"] or layer["layer"] not in ("preset", "extension"):
                continue
            kind, package_id = layer["layer"], layer["sourceId"]
            source = next(
                entry for entry in snapshot["providers"]
                if entry["kind"] == kind and entry["id"] == package_id
            )
            providers[(kind, package_id)] = {
                "kind": kind, "id": package_id, "version": source["version"],
                "enabled": source["enabled"], "priority": source["priority"],
                "precedence": precedence[kind][package_id],
                "installedSource": deepcopy(source["source"]),
                "manifestPath": source["manifestPath"],
                **({"manifestSha256": source["manifestSha256"]}
                   if "manifestSha256" in source else {}),
            }
    skills = {}
    for step in steps:
        skills[step["skillName"]] = {
            "name": step["skillName"], "invocation": step["invocation"],
            "commandName": step["commandName"],
            "provider": {key: step["source"][key] for key in ("kind", "id")},
            **({"sha256": skill_hashes[step["skillName"]]}
               if skill_hashes and skill_hashes.get(step["skillName"]) else {}),
        }
    return {
        "requiresSpecKit": True,
        "requireInstallationApproval": False,
        "compositionFingerprint": snapshot["compositionFingerprint"],
        "integration": {"id": "copilot", "skillsMode": True},
        "requiredSkills": [skills[name] for name in sorted(skills)],
        "presets": sorted(
            (value for (kind, _), value in providers.items() if kind == "preset"),
            key=lambda value: value["precedence"],
        ),
        "extensions": sorted(
            (value for (kind, _), value in providers.items() if kind == "extension"),
            key=lambda value: value["precedence"],
        ),
    }


def compile_blueprint(request: dict) -> dict:
    """Preserve phase order, bound outputs and Specify provider provenance."""
    validate_request(request)
    workflow = request["workflow"]
    instance_configuration = request["instanceConfiguration"]
    snapshot = workflow["artifactSnapshot"]
    commands_by_name = {
        row["name"]: row for row in snapshot["artifacts"] if row["kind"] == "command"
    }
    commands = [commands_by_name[phase] for phase in workflow["selectedPhases"]]
    steps = []
    item_roots = set()
    hint_roots = set()
    constitution = None
    for index, (phase, binding, command) in enumerate(
        zip(workflow["selectedPhases"], workflow["phaseOutputs"], commands, strict=True)
    ):
        result = binding["contract"]["result"]
        artifact_path = result.get("pathTemplate")
        if phase == "speckit.constitution":
            if result["kind"] != "artifact" or "<" in artifact_path or ">" in artifact_path:
                raise ValueError("Unsupported project Constitution output contract")
        elif artifact_path and "<slug>" in artifact_path:
            prefix = artifact_path.split("<slug>", 1)[0]
            if "<" in prefix or ">" in prefix:
                raise ValueError("Unsupported workflow artifact root")
            if result["kind"] == "artifact":
                item_roots.add(prefix + "<slug>")
            else:
                hint_roots.add(prefix + "<slug>")
        bare = phase.removeprefix("speckit.")
        skill = phase.replace(".", "-")
        hint, when_empty = CORE_ARGUMENTS.get(bare, (
            DEFAULT_ARGUMENTS["hint"], DEFAULT_ARGUMENTS["whenEmpty"],
        ))
        source = _source(snapshot, command)
        step = {
            "index": index,
            "instanceKey": f"{index}:{bare}",
            "id": bare,
            "commandName": phase,
            "skillName": skill,
            "invocation": f"/skill:{skill}",
            "label": bare.split(".")[-1].replace("-", " ").title(),
            "description": command.get("description", ""),
            "source": source,
            "artifact": {
                "pathTemplate": artifact_path,
                "persistent": result["kind"] == "artifact",
                "completionSignal": result["kind"],
            },
            "arguments": {"hint": hint, "whenEmpty": when_empty},
            "optional": False,
            "predecessors": [] if index == 0 else [index - 1],
        }
        if phase == "speckit.constitution":
            constitution = {"instanceKey": step["instanceKey"], "required": True}
        steps.append(step)
    if len(item_roots) > 1:
        raise ValueError("The pipeline uses multiple independent item roots")
    item_root = next(iter(item_roots), None)
    if item_root is None and len(hint_roots) == 1:
        item_root = next(iter(hint_roots))
    for step in steps:
        path = step["artifact"]["pathTemplate"]
        if step["artifact"]["completionSignal"] == "hint" and path and "<slug>" in path:
            if not item_root or not path.startswith(item_root + "/"):
                step["artifact"]["pathTemplate"] = None
    blueprint = {
        "schemaVersion": 2,
        "kind": "speckit-wizard-linear-canvas",
        "metadata": {
            "extensionId": request["canvas"]["id"],
            "displayName": request["canvas"]["displayName"],
            "description": request["canvas"]["description"],
            "workflowListName": request["canvas"]["workflowListName"],
        },
        "pipeline": {"topology": "linear", "steps": steps},
        "phaseOutputs": deepcopy(workflow["phaseOutputs"]),
        "setup": {
            **_setup_requirements(snapshot, commands, steps, workflow["requiredSkillHashes"]),
            "requireInstallationApproval": instance_configuration["installationMode"] == "prompt",
        },
        "runtime": {
            "visualStyle": "spec-kit-wizard",
            "workflowMode": "item" if item_root else "project",
            "itemRoot": item_root,
            "userProvidesSlug": instance_configuration["workflowSlug"]["userProvided"],
            "multiInstance": bool(item_root),
            "supportsArtifactPreview": True,
            "supportsRerun": True,
            "supportsSse": True,
            "requiredActions": ["list_items", "setup_workflow", "run_phase"],
        },
        "warnings": [],
    }
    if constitution is not None:
        blueprint["projectArtifacts"] = {"constitution": constitution}
    return blueprint
