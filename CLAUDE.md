# pretendrop

"A Pretentious Backdrop for videos": visualizador de escritorio en Electron sobre Butterchurn
(presets de MilkDrop), con favoritos y tres motores de shuffle. Repo público; uso en
`README.md`. `CLAUDE.md` es un hard link de este archivo.

## Comandos

```sh
npm ci
npm run electron:binary   # baja Electron a propósito (los scripts de instalación están apagados)
npm run build             # vite build → dist/
npm run dist:linux:dir    # empaquetado rápido para probar (release/linux-unpacked)
npm run dist:linux        # AppImage + tar.gz en release/
```

- En lizeth no hay escritorio: `npm run start` y `dev:desktop` no abren ventana. Verifica con
  `build` y `dist:linux:dir`.
- Los scripts `dist*` llevan `--publish never`: el CI solo construye artefactos y nunca
  publica releases.
- CI: `.github/workflows/build.yml` construye Linux x64, macOS x64 (`macos-15-intel`) y macOS
  arm64.

## Reglas

- npm estricto: versiones exactas, `npm ci`, nada de dependencias nuevas sin permiso de Diego
  (política completa en `~/.claude/CLAUDE.md`).
- La app abre en kiosk/pantalla completa; `F` sale del modo kiosk y `Ctrl+Q` cierra. No
  rompas esos atajos.
- Commits en inglés, minúsculas, cortos, como el historial. Sin trailers de atribución.
