#!/usr/bin/env bash
set -euo pipefail

if test "$(uname -s)" != "Darwin"; then
  printf '%s\n' 'This installer only runs on macOS.' >&2
  exit 1
fi

pretendrop_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if ! command -v npm >/dev/null 2>&1; then
  printf '%s\n' 'Install Node.js 22.12 or newer before building Pretendrop: https://nodejs.org' >&2
  exit 1
fi

(cd "$pretendrop_root" && npm ci && npm run dist:mac)
printf 'macOS artifacts created in %s/release\n' "$pretendrop_root"
printf '%s\n' 'Mount the .dmg and drag Pretendrop.app to Applications.'
