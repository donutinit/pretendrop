# pretendrop

> A Pretentious Backdrop for videos, based on Butterchurn.

Pretendrop is a silent, fullscreen music-reactive visual system for a second
display, a projector, or the wall behind a set. It decodes a random track from
your own library to drive the visuals, then routes the audio through a gain of
zero. The screen gets the motion; the room stays quiet.

It ships with the Butterchurn preset collection, fast preset transitions,
favorites, and three deliberately different shuffle engines.

## Start it

Pretendrop requires [Bun](https://bun.sh/).

```bash
cd ~/src/pretendrop
bun install
bun run build
bun run start
```

For live UI development, run these in separate terminals:

```bash
bun run dev
bun run dev:desktop
```

The regular app opens fullscreen in kiosk mode. Move the pointer to reveal its
controls. Press `F` to leave or return to kiosk mode, and `Ctrl+Q` to quit.

## Everyday controls

| Key | Action |
| --- | --- |
| `Space` | Pause or resume the reactive track |
| `N` | Pick another random track |
| `←` / `→` | Change preset |
| `H` | Love or unlove the current preset |
| `O` | Open the preset console |
| `F` | Toggle fullscreen kiosk mode |

The heart updates immediately and the status line confirms that it was saved.
Favorite names wrap to as many lines as they need; they are never abbreviated.

## Music and privacy

On Linux, the first scan starts at `~/Music`. Choose any library from the
console whenever you want. Pretendrop reads embedded title, artist, and album
tags only for the selected track; it does not send library data anywhere.

No personal media path is embedded in the source or build. The music index is
held in memory for the running session and audio output remains muted.

## Favorites and settings

On Linux, preferences are written in the standard XDG location:

```text
$XDG_CONFIG_HOME/pretendrop/preferences.json
# or ~/.config/pretendrop/preferences.json when XDG_CONFIG_HOME is unset
```

The file is plain JSON and is created automatically on first run. Existing
Butter preferences are migrated once if they are found, without deleting the
old file. Set `PRETENDROP_PREFERENCES_FILE` to use an explicit JSON path.

When `~/dot` exists, `bun run install:linux` keeps the plain JSON in your
private dotfiles source and exposes it at the standard XDG path:

```text
~/.config/pretendrop/preferences.json
  -> ~/dot/stow/common/.config/pretendrop/preferences.json
```

Pretendrop resolves that link before its atomic save, so it never replaces the
link itself. This keeps personal preference data in the private dotfiles repo,
not in the Pretendrop source repository. The macOS build uses the platform
app-data directory instead of an XDG path.

## Shuffle

Choose **all presets** or **favorites**, then choose an engine:

- **Entropy** uses cryptographic randomness and avoids recent repeats.
- **Deck** deals a complete random permutation before repeating a preset.
- **Explorer** favors presets seen least during the current session.

The seconds field controls automatic preset changes. Set it to `0` for manual
changes only.

## Install and build

### Linux and Rofi

```bash
bun run install:linux
rofi -show drun
```

The installer builds the UI, writes an XDG desktop entry named **Pretendrop**,
and replaces the previous Butter launcher if it exists. It does not require a
system-wide install.

To make distributable Linux artifacts:

```bash
bun run dist:linux
```

This creates an AppImage and a tarball in `release/`.

### macOS

Run this on a Mac:

```bash
bun run install:mac
```

It generates a DMG and ZIP in `release/`. Mount the DMG and drag
`Pretendrop.app` to Applications. The GitHub Actions workflow builds Linux x64,
macOS x64, and macOS arm64 artifacts; public distribution still needs your own
Apple signing and notarization credentials.

## License

Pretendrop is released under the [MIT License](LICENSE). Butterchurn and its
preset collection are also MIT-licensed; direct runtime dependency notices are
kept in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and copied into
packaged apps.
