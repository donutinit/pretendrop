const { app, BrowserWindow, dialog, ipcMain, screen, session } = require("electron");
const { execFile } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { promisify } = require("node:util");

const DEFAULT_LIBRARY_ROOT = path.join(os.homedir(), "Music");
const PREFERENCES_SCHEMA_VERSION = 4;
const execFileAsync = promisify(execFile);
const PACTL_TIMEOUT_MS = 3_000;
const LINUX_CAPTURE_TIMEOUT_MS = 3_000;
const AUDIO_EXTENSIONS = new Set([
  ".aac",
  ".aif",
  ".aiff",
  ".flac",
  ".m4a",
  ".mp3",
  ".oga",
  ".ogg",
  ".opus",
  ".wav",
  ".weba",
  ".webm",
]);

let mainWindow = null;
let kioskMode = true;
let activeScan = null;
let metadataModulePromise = null;
let pendingLinuxCapture = null;
const library = {
  root: DEFAULT_LIBRARY_ROOT,
  tracks: [],
  lastTrack: null,
};

app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
app.commandLine.appendSwitch("disable-features", "HardwareMediaKeyHandling");
app.setName("Pretendrop");

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function isAudioFile(name) {
  return AUDIO_EXTENSIONS.has(path.extname(name).toLowerCase());
}

function metadataText(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function getMetadataModule() {
  metadataModulePromise ??= import("music-metadata");
  return metadataModulePromise;
}

async function getPreferencesLocations() {
  if (process.env.PRETENDROP_PREFERENCES_FILE) {
    return {
      targetPath: path.resolve(process.env.PRETENDROP_PREFERENCES_FILE),
      legacyPaths: [],
    };
  }

  const homeDirectory = app.getPath("home");
  const dotDirectory = path.join(homeDirectory, "dot");
  const xdgConfigDirectory = process.env.XDG_CONFIG_HOME
    ? path.resolve(process.env.XDG_CONFIG_HOME)
    : path.join(homeDirectory, ".config");
  const configPreferencesPath = path.join(
    xdgConfigDirectory,
    "pretendrop",
    "preferences.json",
  );
  const pretendropDotPreferencesPath = path.join(
    dotDirectory,
    "stow",
    "common",
    ".config",
    "pretendrop",
    "preferences.json",
  );
  const legacyDotPreferencesPath = path.join(
    dotDirectory,
    "stow",
    "common",
    ".config",
    "butter",
    "preferences.json",
  );
  const legacyAppPreferencesPath = path.join(
    app.getPath("appData"),
    "butter-backdrop",
    "preferences.json",
  );
  const legacyPaths = [
    process.env.BUTTER_PREFERENCES_FILE
      ? path.resolve(process.env.BUTTER_PREFERENCES_FILE)
      : null,
    legacyDotPreferencesPath,
    legacyAppPreferencesPath,
  ].filter(Boolean);

  return {
    targetPath: process.platform === "linux"
      ? configPreferencesPath
      : path.join(app.getPath("userData"), "preferences.json"),
    legacyPaths: [pretendropDotPreferencesPath, ...legacyPaths],
  };
}

function normalizePreferences(value) {
  const favorites = Array.isArray(value?.favorites)
    ? [...new Set(value.favorites.filter((name) => typeof name === "string" && name.trim()))]
    : [];
  const presetIntervalSeconds = Math.round(Number(value?.presetIntervalSeconds));
  const transitionSeconds = Number(value?.transitionSeconds);
  const reactivity = Number(value?.reactivity);
  const vignettePercent = Math.round(Number(value?.vignettePercent));
  const trackIntervalMinutes = Math.round(Number(value?.trackIntervalMinutes));

  return {
    version: PREFERENCES_SCHEMA_VERSION,
    favorites,
    shuffleScope: value?.shuffleScope === "favorites" ? "favorites" : "all",
    shuffleStyle: ["entropy", "deck", "explorer"].includes(value?.shuffleStyle)
      ? value.shuffleStyle
      : "entropy",
    presetIntervalSeconds: Number.isFinite(presetIntervalSeconds)
      ? Math.min(Math.max(presetIntervalSeconds, 0), 3600)
      : 35,
    transitionSeconds: Number.isFinite(transitionSeconds)
      ? Math.min(Math.max(transitionSeconds, 0), 15)
      : 3.8,
    reactivity: Number.isFinite(reactivity)
      ? Math.min(Math.max(reactivity, 0.1), 3)
      : 1,
    vignettePercent: Number.isFinite(vignettePercent)
      ? Math.min(Math.max(vignettePercent, 0), 100)
      : 42,
    quality: ["eco", "normal", "full"].includes(value?.quality)
      ? value.quality
      : "normal",
    presetLocked: Boolean(value?.presetLocked),
    trackIntervalMinutes: Number.isFinite(trackIntervalMinutes)
      ? Math.min(Math.max(trackIntervalMinutes, 0), 1440)
      : 0,
    interfaceMode: ["auto", "visible", "hidden"].includes(value?.interfaceMode)
      ? value.interfaceMode
      : "auto",
    audioSourceMode: ["library", "microphone", "system"].includes(value?.audioSourceMode)
      ? value.audioSourceMode
      : "library",
    microphoneDeviceId: typeof value?.microphoneDeviceId === "string"
      ? value.microphoneDeviceId.slice(0, 512)
      : "default",
    favoritesSeedVersion: Math.max(0, Math.round(Number(value?.favoritesSeedVersion)) || 0),
  };
}

async function loadPreferences() {
  const { targetPath, legacyPaths } = await getPreferencesLocations();
  const candidates = [targetPath, ...legacyPaths.filter((entry) => entry !== targetPath)];

  for (const sourcePath of candidates) {
    try {
      const contents = await fs.readFile(sourcePath, "utf8");
      const rawPreferences = JSON.parse(contents);
      return {
        path: targetPath,
        sourcePath,
        needsRewrite: rawPreferences?.version !== PREFERENCES_SCHEMA_VERSION,
        preferences: normalizePreferences(rawPreferences),
      };
    } catch (error) {
      if (error.code !== "ENOENT") {
        console.warn(`No pude leer ${sourcePath}.`, error.message);
      }
    }
  }

  return { path: targetPath, sourcePath: null, preferences: null };
}

async function resolvePreferencesWritePath(preferencesPath) {
  try {
    return await fs.realpath(preferencesPath);
  } catch (error) {
    if (error.code === "ENOENT") return preferencesPath;
    throw error;
  }
}

async function savePreferences(value) {
  const { targetPath } = await getPreferencesLocations();
  const preferencesPath = await resolvePreferencesWritePath(targetPath);
  const preferences = normalizePreferences(value);
  const directory = path.dirname(preferencesPath);
  const temporaryPath = `${preferencesPath}.tmp-${process.pid}`;

  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(
    temporaryPath,
    `${JSON.stringify(preferences, null, 2)}\n`,
    "utf8",
  );
  await fs.rename(temporaryPath, preferencesPath);
  return { path: targetPath, preferences };
}

async function compactTrack(trackPath) {
  const relative = path.relative(library.root, trackPath);
  const parts = relative.split(path.sep);
  const fallback = {
    title: path.basename(trackPath, path.extname(trackPath)),
    album: parts.length > 1 ? parts.at(-2) : "",
    artist: parts.length > 2 ? parts.at(-3) : "",
  };
  let tags = fallback;

  try {
    const { parseFile } = await getMetadataModule();
    const { common } = await parseFile(trackPath, {
      duration: false,
      skipCovers: true,
    });
    const taggedArtists = Array.isArray(common.artists)
      ? common.artists.map(metadataText).filter(Boolean).join(" · ")
      : "";
    tags = {
      title: metadataText(common.title) || fallback.title,
      album: metadataText(common.album) || fallback.album,
      artist: metadataText(common.artist) || taggedArtists || metadataText(common.albumartist) || fallback.artist,
    };
  } catch (error) {
    console.warn(`No pude leer tags de ${relative}; uso nombre de archivo.`, error.message);
  }

  return {
    path: trackPath,
    url: pathToFileURL(trackPath).toString(),
    ...tags,
    relative,
  };
}

async function scanLibrary(requestedRoot = library.root) {
  const root = path.resolve(requestedRoot);

  if (activeScan && activeScan.root === root) {
    return activeScan.promise;
  }

  const run = (async () => {
    const tracks = [];
    const pendingDirectories = [root];
    let foldersVisited = 0;
    let unreadableFolders = 0;
    let lastReport = 0;

    send("library:progress", {
      root,
      tracks: 0,
      foldersVisited: 0,
      phase: "scanning",
    });

    while (pendingDirectories.length > 0) {
      const currentDirectory = pendingDirectories.pop();
      foldersVisited += 1;

      let directory;
      try {
        directory = await fs.opendir(currentDirectory);
      } catch {
        unreadableFolders += 1;
        continue;
      }

      for await (const entry of directory) {
        const entryPath = path.join(currentDirectory, entry.name);

        if (entry.isDirectory()) {
          pendingDirectories.push(entryPath);
        } else if (entry.isFile() && isAudioFile(entry.name)) {
          tracks.push(entryPath);
        }
      }

      const now = Date.now();
      if (now - lastReport > 180) {
        lastReport = now;
        send("library:progress", {
          root,
          tracks: tracks.length,
          foldersVisited,
          pendingFolders: pendingDirectories.length,
          phase: "scanning",
        });
      }
    }

    if (tracks.length === 0) {
      throw new Error("No encontré archivos de audio compatibles en esa carpeta.");
    }

    library.root = root;
    library.tracks = tracks;
    library.lastTrack = null;

    const result = {
      root,
      count: tracks.length,
      foldersVisited,
      unreadableFolders,
      phase: "ready",
    };
    send("library:ready", result);
    return result;
  })();

  activeScan = { root, promise: run };

  try {
    return await run;
  } catch (error) {
    send("library:error", { root, message: error.message });
    throw error;
  } finally {
    if (activeScan?.promise === run) {
      activeScan = null;
    }
  }
}

async function getRandomTrack(excludedPaths = []) {
  if (library.tracks.length === 0) {
    await scanLibrary(library.root);
  }

  const excluded = new Set(excludedPaths);
  const candidates = library.tracks.filter(
    (track) => track !== library.lastTrack && !excluded.has(track),
  );
  const pool = candidates.length > 0 ? candidates : library.tracks;
  const selected = pool[Math.floor(Math.random() * pool.length)];

  library.lastTrack = selected;
  return compactTrack(selected);
}

function createWindow() {
  const target = screen.getPrimaryDisplay();
  mainWindow = new BrowserWindow({
    x: target.bounds.x,
    y: target.bounds.y,
    width: target.bounds.width,
    height: target.bounds.height,
    show: false,
    title: "Pretendrop",
    backgroundColor: "#010101",
    autoHideMenuBar: true,
    fullscreen: true,
    kiosk: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  const devServer = process.env.PRETENDROP_DEV_SERVER_URL;
  if (devServer) {
    mainWindow.loadURL(devServer);
  } else {
    mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }
}

function getDisplays() {
  return screen.getAllDisplays().map((display) => ({
    id: display.id,
    label: `${display.label || "Pantalla"} · ${display.size.width}×${display.size.height}`,
    bounds: display.bounds,
    primary: display.id === screen.getPrimaryDisplay().id,
  }));
}

async function runPactl(args) {
  try {
    const { stdout } = await execFileAsync("pactl", args, {
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
      timeout: PACTL_TIMEOUT_MS,
    });
    return stdout.trim();
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error("Esta captura necesita pactl, pero no está instalado.");
    }

    const detail = String(error.stderr || error.message || "").trim();
    throw new Error(
      detail
        ? `PipeWire/PulseAudio rechazó la captura: ${detail}`
        : "PipeWire/PulseAudio no respondió.",
    );
  }
}

async function pactlJson(args) {
  const output = await runPactl(["--format=json", ...args]);
  try {
    return JSON.parse(output || "[]");
  } catch {
    throw new Error("pactl devolvió una respuesta que Pretendrop no reconoce.");
  }
}

async function getLinuxSystemMonitor() {
  if (process.platform !== "linux") {
    throw new Error("El audio del sistema sólo está disponible en Linux.");
  }

  const defaultSink = await runPactl(["get-default-sink"]);
  const sources = await pactlJson(["list", "sources"]);
  const expectedName = `${defaultSink}.monitor`;
  const monitor = sources.find((source) => source.name === expectedName)
    || sources.find((source) => (
      source.properties?.["device.class"] === "monitor"
      && source.properties?.["node.name"] === defaultSink
    ));

  if (!monitor) {
    throw new Error(`No encontré el monitor de la salida ${defaultSink}.`);
  }

  return {
    name: monitor.name,
    label: String(monitor.description || defaultSink).replace(/^Monitor of /i, ""),
  };
}

async function getLinuxDefaultMicrophone() {
  if (process.platform !== "linux") {
    throw new Error("La selección explícita del micrófono sólo aplica a Linux.");
  }

  const defaultSource = await runPactl(["get-default-source"]);
  const sources = await pactlJson(["list", "sources"]);
  const microphone = sources.find((source) => source.name === defaultSource);

  if (!microphone || microphone.properties?.["device.class"] === "monitor") {
    throw new Error("La entrada predeterminada de Linux no es un micrófono.");
  }

  return {
    name: microphone.name,
    label: String(microphone.description || defaultSource),
  };
}

async function listPretendropSourceOutputs() {
  const outputs = await pactlJson(["list", "source-outputs"]);
  return outputs.filter((output) => (
    output.properties?.["application.name"] === app.getName()
    && output.properties?.["media.name"] === "RecordStream"
  ));
}

async function getAudioCapabilities() {
  const capabilities = {
    platform: process.platform,
    microphone: process.platform === "linux" || process.platform === "darwin",
    systemAudio: false,
    systemAudioLabel: "",
    systemAudioError: "",
  };

  if (process.platform === "linux") {
    try {
      const monitor = await getLinuxSystemMonitor();
      capabilities.systemAudio = true;
      capabilities.systemAudioLabel = monitor.label;
    } catch (error) {
      capabilities.systemAudioError = error.message;
    }
  }

  return capabilities;
}

async function prepareLinuxCapture(target) {
  const existingOutputs = await listPretendropSourceOutputs();
  const token = randomUUID();

  pendingLinuxCapture = {
    token,
    target,
    existingIds: new Set(existingOutputs.map((output) => String(output.index))),
    expiresAt: Date.now() + LINUX_CAPTURE_TIMEOUT_MS,
  };

  return { token, label: target.label };
}

async function prepareLinuxSystemCapture() {
  return prepareLinuxCapture(await getLinuxSystemMonitor());
}

async function prepareLinuxDefaultMicrophoneCapture() {
  return prepareLinuxCapture(await getLinuxDefaultMicrophone());
}

function cancelLinuxCapture(token) {
  if (pendingLinuxCapture?.token === token) {
    pendingLinuxCapture = null;
  }
}

async function activateLinuxCapture(token) {
  const pending = pendingLinuxCapture;
  if (!pending || pending.token !== token || pending.expiresAt < Date.now()) {
    pendingLinuxCapture = null;
    throw new Error("La solicitud de captura de audio expiró.");
  }

  while (Date.now() <= pending.expiresAt) {
    const outputs = await listPretendropSourceOutputs();
    const newOutputs = outputs.filter(
      (output) => !pending.existingIds.has(String(output.index)),
    );

    if (newOutputs.length > 0) {
      for (const output of newOutputs) {
        await runPactl([
          "move-source-output",
          String(output.index),
          pending.target.name,
        ]);
      }

      pendingLinuxCapture = null;
      return { label: pending.target.label, streams: newOutputs.length };
    }

    await new Promise((resolve) => setTimeout(resolve, 75));
  }

  pendingLinuxCapture = null;
  throw new Error("No apareció el stream de captura de Pretendrop en PipeWire.");
}

function isTrustedMediaRequest(webContents) {
  if (!mainWindow || webContents !== mainWindow.webContents) return false;
  const currentUrl = webContents.getURL();
  const appUrl = pathToFileURL(path.join(__dirname, "..", "dist") + path.sep).toString();
  const devServer = process.env.PRETENDROP_DEV_SERVER_URL;
  return currentUrl.startsWith(appUrl) || (devServer && currentUrl.startsWith(devServer));
}

function configureMediaPermissions() {
  const { defaultSession } = session;

  defaultSession.setPermissionCheckHandler((webContents, permission, _origin, details) => (
    permission === "media"
    && details?.mediaType === "audio"
    && isTrustedMediaRequest(webContents)
  ));

  defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const requestedTypes = Array.isArray(details?.mediaTypes) ? details.mediaTypes : [];
    const requestsOnlyAudio = requestedTypes.length === 0
      || (requestedTypes.includes("audio") && !requestedTypes.includes("video"));
    callback(permission === "media" && requestsOnlyAudio && isTrustedMediaRequest(webContents));
  });
}

ipcMain.handle("library:scan", (_event, root) => scanLibrary(root || library.root));
ipcMain.handle("library:get-root", () => library.root);
ipcMain.handle("library:random-track", (_event, excludedPaths) =>
  getRandomTrack(Array.isArray(excludedPaths) ? excludedPaths.slice(-150) : []),
);
ipcMain.handle("library:choose-root", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Elige tu biblioteca musical",
    defaultPath: library.root,
    properties: ["openDirectory"],
  });

  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle("preferences:load", () => loadPreferences());
ipcMain.handle("preferences:save", (_event, preferences) => savePreferences(preferences));

ipcMain.handle("audio:get-capabilities", () => getAudioCapabilities());
ipcMain.handle("audio:prepare-system-capture", () => prepareLinuxSystemCapture());
ipcMain.handle("audio:prepare-default-microphone-capture", () =>
  prepareLinuxDefaultMicrophoneCapture(),
);
ipcMain.handle("audio:activate-linux-capture", (_event, token) =>
  activateLinuxCapture(token),
);
ipcMain.handle("audio:cancel-linux-capture", (_event, token) => {
  cancelLinuxCapture(token);
});

ipcMain.handle("window:get-displays", () => getDisplays());
ipcMain.handle("window:set-display", (_event, displayId) => {
  const target = screen.getAllDisplays().find((display) => display.id === displayId);
  if (!target || !mainWindow) return false;

  mainWindow.setKiosk(false);
  mainWindow.setFullScreen(false);
  mainWindow.setBounds(target.bounds);
  mainWindow.setFullScreen(kioskMode);
  mainWindow.setKiosk(kioskMode);
  return true;
});
ipcMain.handle("window:toggle-kiosk", () => {
  kioskMode = !kioskMode;
  if (mainWindow) {
    mainWindow.setKiosk(kioskMode);
    mainWindow.setFullScreen(kioskMode);
  }
  return kioskMode;
});
ipcMain.handle("app:version", () => app.getVersion());
ipcMain.handle("app:quit", () => app.quit());

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    configureMediaPermissions();
    createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
