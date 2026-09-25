#!/usr/bin/env python3
"""Inspect an intact generated canvas by its technical receipt."""

import argparse
import json
import sys
from pathlib import Path


sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "lib"))
from lifecycle import inspect_target  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description="Inspect a generated canvas")
    parser.add_argument("--workspace", required=True, type=Path)
    parser.add_argument("--canvas-id", required=True)
    args = parser.parse_args()
    try:
        report = inspect_target(args.workspace, args.canvas_id)
    except (ValueError, OSError) as error:
        parser.error(str(error))
    print(json.dumps(report, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
