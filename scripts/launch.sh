#!/usr/bin/env bash
set -euo pipefail

pretendrop_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
pretendrop_electron="$pretendrop_root/node_modules/electron/dist/electron"

if ! command -v bun >/dev/null 2>&1; then
  printf '%s\n' 'Pretendrop needs Bun to run from this checkout.' >&2
  exit 1
fi

if test ! -x "$pretendrop_electron"; then
  (cd "$pretendrop_root" && bun install --frozen-lockfile)
fi

if test ! -f "$pretendrop_root/dist/index.html"; then
  (cd "$pretendrop_root" && bun run build)
fi

exec "$pretendrop_electron" "$pretendrop_root" "$@"
