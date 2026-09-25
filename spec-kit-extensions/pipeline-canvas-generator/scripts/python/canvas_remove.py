#!/usr/bin/env python3
"""Remove only a verified, explicitly confirmed generated canvas."""

import argparse
import json
import sys
from pathlib import Path


sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "lib"))
from lifecycle import remove_target  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description="Remove a confirmed generated canvas")
    parser.add_argument("--workspace", required=True, type=Path)
    parser.add_argument("--canvas-id", required=True)
    parser.add_argument("--confirmed-target", required=True)
    args = parser.parse_args()
    try:
        report = remove_target(args.workspace, args.canvas_id, args.confirmed_target)
    except (ValueError, OSError) as error:
        parser.error(str(error))
    print(json.dumps({"removed": report["target"], "canvasId": report["canvasId"]}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
