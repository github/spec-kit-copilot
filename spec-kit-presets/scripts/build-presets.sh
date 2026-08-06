#!/usr/bin/env bash
#
# Build distributable ZIP artifacts for the Copilot-specific Spec Kit presets.
#
# Each preset is packaged so that its `preset.yml` and `commands/` sit at the
# ROOT of the archive — the layout `specify preset add --from <zip>` expects.
# Output zips are named `<preset>.zip`, matching the `download_url` asset names
# in catalog.json (published under the `<preset>-v<version>` release tag).
#
# Usage:
#   spec-kit-presets/scripts/build-presets.sh [preset-id ...] [--out DIR]
#
# With no preset ids, every preset in the directory is built. Default output
# directory is `spec-kit-presets/dist/`.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/.." && pwd)"

out="$root/dist"
presets=()
while [ $# -gt 0 ]; do
  case "$1" in
    --out) out="$2"; shift 2 ;;
    --out=*) out="${1#--out=}"; shift ;;
    -h|--help) grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) presets+=("$1"); shift ;;
  esac
done

if [ "${#presets[@]}" -eq 0 ]; then
  # Default to every directory that carries a preset.yml.
  while IFS= read -r d; do presets+=("$(basename "$(dirname "$d")")"); done \
    < <(find "$root" -mindepth 2 -maxdepth 2 -name preset.yml | sort)
fi

mkdir -p "$out"

for id in "${presets[@]}"; do
  src="$root/$id"
  if [ ! -f "$src/preset.yml" ]; then
    echo "error: no preset.yml in $src" >&2
    exit 1
  fi
  zip="$out/$id.zip"
  rm -f "$zip"
  # -X drops extra file attributes for reproducibility; contents are archived
  # relative to the preset directory so preset.yml is at the archive root.
  ( cd "$src" && zip -q -r -X "$zip" . -x '.*' )
  echo "built $zip"
done
