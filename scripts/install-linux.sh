#!/usr/bin/env bash
set -euo pipefail

if test "$(uname -s)" != "Linux"; then
  printf '%s\n' 'This installer only runs on Linux.' >&2
  exit 1
fi

pretendrop_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
pretendrop_launcher="$pretendrop_root/scripts/launch.sh"
pretendrop_data_home="${XDG_DATA_HOME:-$HOME/.local/share}"
pretendrop_applications_dir="$pretendrop_data_home/applications"
pretendrop_desktop_file="$pretendrop_applications_dir/com.donutinit.pretendrop.desktop"
pretendrop_legacy_desktop_file="$pretendrop_applications_dir/com.aristotle.butter.desktop"
pretendrop_config_home="${XDG_CONFIG_HOME:-$HOME/.config}"
pretendrop_config_file="$pretendrop_config_home/pretendrop/preferences.json"
pretendrop_dot_file="$HOME/dot/stow/common/.config/pretendrop/preferences.json"
pretendrop_temp_file=""

cleanup() {
  if test -n "$pretendrop_temp_file" && test -f "$pretendrop_temp_file"; then
    rm -f "$pretendrop_temp_file"
  fi
}
trap cleanup EXIT

if ! command -v bun >/dev/null 2>&1; then
  printf '%s\n' 'Install Bun before running this installer: https://bun.sh' >&2
  exit 1
fi

if test ! -x "$pretendrop_root/node_modules/electron/dist/electron"; then
  (cd "$pretendrop_root" && bun install --frozen-lockfile)
fi

(cd "$pretendrop_root" && bun run build)
chmod +x "$pretendrop_launcher"
mkdir -p "$pretendrop_applications_dir" "$(dirname "$pretendrop_config_file")"

pretendrop_temp_file="$(mktemp "$pretendrop_applications_dir/.pretendrop.desktop.XXXXXX")"
printf '%s\n' \
  '[Desktop Entry]' \
  'Type=Application' \
  'Name=Pretendrop' \
  'Comment=A Pretentious Backdrop for videos, based on Butterchurn.' \
  "Exec=$pretendrop_launcher" \
  'Icon=multimedia-player' \
  'Categories=AudioVideo;Audio;Video;' \
  'Keywords=visualizer;music;butterchurn;backdrop;' \
  'StartupWMClass=com.donutinit.pretendrop' \
  'Terminal=false' > "$pretendrop_temp_file"
mv "$pretendrop_temp_file" "$pretendrop_desktop_file"
pretendrop_temp_file=""

if test -f "$pretendrop_legacy_desktop_file"; then
  rm -f "$pretendrop_legacy_desktop_file"
fi

if test -d "$HOME/dot"; then
  mkdir -p "$(dirname "$pretendrop_dot_file")"

  if test -L "$pretendrop_dot_file" && test "$(readlink -f "$pretendrop_dot_file")" = "$pretendrop_config_file"; then
    unlink "$pretendrop_dot_file"
  fi

  if test -e "$pretendrop_config_file" && test ! -L "$pretendrop_config_file"; then
    if test -e "$pretendrop_dot_file"; then
      printf 'Not replacing existing config or dotfile; link them manually.\n' >&2
    else
      mv "$pretendrop_config_file" "$pretendrop_dot_file"
    fi
  fi

  if test ! -e "$pretendrop_dot_file"; then
    printf '%s\n' \
      '{' \
      '  "version": 2,' \
      '  "favorites": [],' \
      '  "shuffleScope": "all",' \
      '  "shuffleStyle": "entropy",' \
      '  "presetIntervalSeconds": 35,' \
      '  "favoritesSeedVersion": 0' \
      '}' > "$pretendrop_dot_file"
  fi

  if test -L "$pretendrop_config_file"; then
    :
  elif test ! -e "$pretendrop_config_file"; then
    ln -s "$pretendrop_dot_file" "$pretendrop_config_file"
  else
    printf 'Not replacing existing config file: %s\n' "$pretendrop_config_file" >&2
  fi
fi

if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "$pretendrop_applications_dir" >/dev/null 2>&1 || true
fi

printf 'Desktop entry installed at %s\n' "$pretendrop_desktop_file"
printf 'Preferences link installed at %s\n' "$pretendrop_config_file"
printf '%s\n' 'Open it with: rofi -show drun'
