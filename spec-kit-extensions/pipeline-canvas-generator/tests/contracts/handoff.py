"""Explicit artifact handoffs for legacy test journeys (not generator defaults)."""

import json
from pathlib import Path

from request import prepare_request as _prepare_request
from category_contracts import stage_documents


PATHS = {
    "speckit.constitution": ".specify/memory/constitution.md",
    "speckit.specify": "specs/<slug>/spec.md",
    "speckit.plan": "specs/<slug>/plan.md",
    "speckit.tasks": "specs/<slug>/tasks.md",
    "speckit.bug.assess": ".specify/bugs/<slug>/assessment.md",
}
NO_DIRECT_ARTIFACT = {"speckit.analyze", "speckit.taskstoissues", "speckit.implement"}


def default_profile(package: Path):
    config = package / "config"
    def document(name):
        return json.loads((config / f"canvas-{name}.json").read_text(encoding="utf-8"))
    return {
        "schemaVersion": 1,
        "presentation": document("presentation"),
        "interactions": document("interactions"),
        "setup": document("setup"),
        "results": document("results"),
    }


def handoff(phases):
    return [
        {
            "commandName": name,
            "expectsArtifact": (False if name in NO_DIRECT_ARTIFACT
                                else True if name in PATHS else None),
            "outputPath": PATHS.get(name),
        }
        for name in phases
    ]


def prepare_request(workspace, selected_phases, canvas_id, display_name, overwrite,
                    **kwargs):
    path = _prepare_request(
        workspace, selected_phases, canvas_id, display_name, overwrite,
        phase_outputs=kwargs.pop("phase_outputs", handoff(selected_phases)), **kwargs,
    )
    inventory = kwargs.get("inventory")
    templates = {row["name"] for row in inventory["artifacts"]
                 if row["kind"] == "template"} if inventory else set()
    if {"canvas-presentation", "canvas-results", "phase-outputs"} <= templates:
        stage_documents(path)
    return path
