#!/usr/bin/env python3
"""Entry points for the extension-owned canvas generation protocol."""

import argparse
import json
import sys
from pathlib import Path


sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "lib"))
from request import prepare_request  # noqa: E402
from category_contracts import baseline_documents, parse_document_json, winning_providers  # noqa: E402
from artifact_snapshot import normalize_snapshot  # noqa: E402
from phase_output import validate_handoff  # noqa: E402
from override import prepare_override  # noqa: E402
from staging import materialize_candidate, stage_canvas_scaffold  # noqa: E402
from receipt import write_receipt  # noqa: E402
from publication import publish_candidate, record_outcome, regenerate_candidate  # noqa: E402
from support import record_support_result, validate_support_command  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description="Prepare or generate a workflow canvas")
    subcommands = parser.add_subparsers(dest="operation", required=True)
    preparation = subcommands.add_parser(
        "prepare-request", help="Capture an immutable Specify request"
    )
    preparation.add_argument("--workspace", required=True, type=Path)
    preparation.add_argument("--canvas-id")
    preparation.add_argument("--display-name")
    preparation.add_argument("--configuration-json", help="Wizard-confirmed canvas metadata")
    preparation.add_argument("--phase", action="append", required=True)
    preparation.add_argument("--phase-outputs-json", required=True,
                             help="Ordered JSON array of {commandName,expectsArtifact,outputPath} handoffs")
    preparation.add_argument("--presentation-json",
                             help="Complete versioned canvas-presentation JSON for this request only")
    for flag in ("phase-outputs-document", "results", "interactions", "setup"):
        preparation.add_argument(f"--{flag}-json", help=f"Complete versioned {flag} JSON")
    preparation.add_argument("--overwrite", action="store_true")
    preparation.add_argument(
        "--inventory-stdin", action="store_true",
        help="Use one freshly captured Wizard Specify inventory from standard input",
    )
    preparation.add_argument("--payload-stdin", action="store_true",
                             help="Read inventory and named raw inline documents from standard input")
    preview = subcommands.add_parser("preview-config", help="Show baseline documents and active providers")
    preview.add_argument("--workspace", required=True, type=Path)
    preview.add_argument("--phase", action="append", required=True)
    preview.add_argument("--phase-outputs-json", required=True)
    preview.add_argument("--inventory-stdin", action="store_true", required=True)
    validation = subcommands.add_parser("validate-config", help="Validate one strict JSON document")
    validation.add_argument("--workspace", required=True, type=Path)
    validation.add_argument("--name", required=True)
    validation.add_argument("--phase", action="append", required=True)
    validation.add_argument("--json-stdin", action="store_true", required=True)
    finalization = subcommands.add_parser(
        "prepare-override", help="Bind a sparse override to the exact request bytes"
    )
    finalization.add_argument("--request", required=True, type=Path)
    scaffold_stage = subcommands.add_parser(
        "stage-scaffold", help="Copy a fresh create-canvas scaffold into request staging"
    )
    scaffold_stage.add_argument("--request", required=True, type=Path)
    scaffold_stage.add_argument("--scaffold", required=True, type=Path)
    materialization = subcommands.add_parser(
        "materialize", help="Build an isolated candidate from a finalized request"
    )
    materialization.add_argument("--request", required=True, type=Path)
    materialization.add_argument("--scaffold", required=True, type=Path)
    support = subcommands.add_parser(
        "support-command", help="Validate an explicitly named design support command"
    )
    support.add_argument("--request", required=True, type=Path)
    support.add_argument("--command", required=True)
    support_result = subcommands.add_parser(
        "record-support-result", help="Validate an explicit support result as the sparse draft"
    )
    support_result.add_argument("--request", required=True, type=Path)
    support_result.add_argument("--command", required=True)
    support_result.add_argument("--source-sha256", required=True)
    support_result.add_argument("--result-stdin", action="store_true", required=True)
    publication = subcommands.add_parser(
        "generate", help="Publish an already validated candidate at an absent target"
    )
    publication.add_argument("--request", required=True, type=Path)
    publication.add_argument("--scaffold", required=True, type=Path)
    regeneration = subcommands.add_parser(
        "regenerate", help="Replace only the exact, confirmed canvas after candidate validation"
    )
    regeneration.add_argument("--request", required=True, type=Path)
    regeneration.add_argument("--scaffold", required=True, type=Path)
    regeneration.add_argument("--confirmed-target", required=True)
    completion = subcommands.add_parser(
        "record-outcome", help="Record the verified provider outcome once"
    )
    completion.add_argument("--request", required=True, type=Path)
    completion.add_argument("--provider-id")
    completion.add_argument("--opened-instance")
    completion.add_argument("--error-code")
    completion.add_argument("--details")
    args = parser.parse_args()
    if args.operation == "prepare-request":
        try:
            payload = json.load(sys.stdin) if args.payload_stdin else None
            inventory = payload["inventory"] if payload is not None else (
                json.load(sys.stdin) if args.inventory_stdin else None)
            configuration = json.loads(args.configuration_json) if args.configuration_json else None
            phase_outputs = json.loads(args.phase_outputs_json)
            inputs = {
                "canvas-presentation": args.presentation_json,
                "phase-outputs": args.phase_outputs_document_json,
                "canvas-results": args.results_json,
                "canvas-interactions": args.interactions_json,
                "canvas-setup": args.setup_json,
            }
            if payload is not None:
                if not isinstance(payload.get("inlineDocuments"), dict):
                    raise ValueError("Inline documents payload must be an object")
                if any(name not in inputs or not isinstance(raw, str)
                       for name, raw in payload["inlineDocuments"].items()):
                    raise ValueError("Unknown or non-string inline document")
                inputs.update(payload["inlineDocuments"])
            inline_documents = {}
            for name, raw in inputs.items():
                if raw is not None:
                    if len(raw.encode("utf-8")) > 256 * 1024:
                        raise ValueError(f"Inline {name} exceeds 256 KiB")
                    inline_documents[name] = parse_document_json(raw.encode("utf-8"), name)
            canvas = configuration.get("canvas", {}) if configuration else {}
            canvas_id = canvas.get("id", args.canvas_id)
            display_name = canvas.get("displayName", args.display_name)
            if not canvas_id or not display_name:
                raise ValueError("canvas id and display name are required")
            path = prepare_request(
                args.workspace, args.phase, canvas_id, display_name,
                args.overwrite, inventory=inventory,
                configuration=configuration, phase_outputs=phase_outputs,
                inline_documents=inline_documents,
            )
        except (ValueError, json.JSONDecodeError) as error:
            parser.error(str(error))
        print(json.dumps({"requestPath": str(path)}, ensure_ascii=False))
        return 0
    if args.operation == "validate-config":
        from experience import DOCUMENTS, validate_complete_category
        from phase_output import validate_document_commands

        try:
            if args.name not in DOCUMENTS:
                raise ValueError(f"Unknown document: {args.name}")
            raw = sys.stdin.buffer.read(256 * 1024 + 1)
            if len(raw) > 256 * 1024:
                raise ValueError(f"Inline {args.name} exceeds 256 KiB")
            document = parse_document_json(raw, args.name)
            validate_complete_category(args.name, document, Path(__file__).resolve().parents[2])
            if args.name == "phase-outputs":
                validate_document_commands(document, args.phase, args.workspace)
            if args.name == "canvas-presentation" and document["brand"]["logo"]["mode"] == "asset":
                raise ValueError("Inline presentation cannot supply an asset logo; use a preset")
        except (ValueError, OSError) as error:
            parser.error(str(error))
        print(json.dumps({"valid": True, "document": document}, ensure_ascii=False))
        return 0
    if args.operation == "preview-config":
        try:
            phases = args.phase
            outputs = json.loads(args.phase_outputs_json)
            validate_handoff(outputs, phases, args.workspace)
            inventory = json.load(sys.stdin)
            snapshot = normalize_snapshot(inventory["artifacts"], inventory["presets"],
                                          inventory["extensions"], args.workspace)
            documents = baseline_documents(Path(__file__).resolve().parents[2], outputs)
            winners = winning_providers(snapshot)
        except (ValueError, KeyError, OSError, json.JSONDecodeError) as error:
            parser.error(str(error))
        print(json.dumps({"documents": documents, "winners": {
            name: winners.get(name) for name in documents
        }}, ensure_ascii=False))
        return 0
    if args.operation == "prepare-override":
        try:
            path = prepare_override(args.request)
        except (ValueError, OSError) as error:
            parser.error(str(error))
        print(json.dumps({"overridePath": str(path)}, ensure_ascii=False))
        return 0
    if args.operation == "stage-scaffold":
        try:
            path = stage_canvas_scaffold(args.request, args.scaffold)
        except (ValueError, OSError) as error:
            parser.error(str(error))
        print(json.dumps({"scaffoldPath": str(path)}, ensure_ascii=False))
        return 0
    if args.operation == "materialize":
        try:
            path = materialize_candidate(args.request, args.scaffold)
            receipt = write_receipt(args.request, args.scaffold)
        except (ValueError, OSError) as error:
            parser.error(str(error))
        print(json.dumps({
            "candidatePath": str(path), "receiptPath": str(receipt),
        }, ensure_ascii=False))
        return 0
    if args.operation == "support-command":
        try:
            result = validate_support_command(args.request, args.command)
        except (ValueError, OSError) as error:
            parser.error(str(error))
        print(json.dumps(result, ensure_ascii=False))
        return 0
    if args.operation == "record-support-result":
        try:
            result = json.load(sys.stdin)
            path = record_support_result(
                args.request, args.command, result, args.source_sha256
            )
        except (ValueError, OSError) as error:
            parser.error(str(error))
        print(json.dumps({"draftPath": str(path)}, ensure_ascii=False))
        return 0
    if args.operation in ("generate", "regenerate"):
        try:
            path = (
                publish_candidate(args.request, args.scaffold)
                if args.operation == "generate"
                else regenerate_candidate(args.request, args.scaffold, args.confirmed_target)
            )
        except (ValueError, OSError) as error:
            try:
                record_outcome(
                    args.request, error_code="publication_failed", details=str(error),
                )
            except (ValueError, OSError) as outcome_error:
                parser.error(
                    f"Publication failed: {error}. Could not record failure outcome: "
                    f"{outcome_error}"
                )
            parser.error(str(error))
        print(json.dumps({
            "target": str(path), "awaitingProviderVerification": True,
        }, ensure_ascii=False))
        return 0
    if args.operation == "record-outcome":
        try:
            path = record_outcome(
                args.request, provider_id=args.provider_id,
                opened_instance=args.opened_instance,
                error_code=args.error_code, details=args.details,
            )
        except (ValueError, OSError) as error:
            parser.error(str(error))
        print(json.dumps({"resultPath": str(path)}, ensure_ascii=False))
        return 0
    parser.error(
        f"{args.operation} is unavailable until its request, override, and "
        "candidate-validation contracts are implemented"
    )


if __name__ == "__main__":
    raise SystemExit(main())
