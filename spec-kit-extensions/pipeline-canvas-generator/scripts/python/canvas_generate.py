#!/usr/bin/env python3
"""Entry points for the extension-owned canvas generation protocol."""

import argparse
import json
import sys
from pathlib import Path


sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "lib"))
from request import prepare_request  # noqa: E402
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
    preparation.add_argument("--canvas-id", required=True)
    preparation.add_argument("--display-name", required=True)
    preparation.add_argument("--phase", action="append", required=True)
    preparation.add_argument("--overwrite", action="store_true")
    preparation.add_argument("--settings-json", help="Wizard-confirmed installation approval setting")
    preparation.add_argument(
        "--inventory-stdin", action="store_true",
        help="Use one freshly captured Wizard Specify inventory from standard input",
    )
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
            inventory = json.load(sys.stdin) if args.inventory_stdin else None
            path = prepare_request(
                args.workspace, args.phase, args.canvas_id, args.display_name,
                args.overwrite, inventory=inventory,
                settings=json.loads(args.settings_json) if args.settings_json else None,
            )
        except (ValueError, json.JSONDecodeError) as error:
            parser.error(str(error))
        print(json.dumps({"requestPath": str(path)}, ensure_ascii=False))
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
