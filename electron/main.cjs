const { app, BrowserWindow, dialog, ipcMain, screen } = require("electron");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const DEFAULT_LIBRARY_ROOT = path.join(os.homedir(), "Music");
const PREFERENCES_SCHEMA_VERSION = 2;
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
    favoritesSeedVersion: Math.max(0, Math.round(Number(value?.favoritesSeedVersion)) || 0),
  };
}

async function loadPreferences() {
  const { targetPath, legacyPaths } = await getPreferencesLocations();
  const candidates = [targetPath, ...legacyPaths.filter((entry) => entry !== targetPath)];

  for (const sourcePath of candidates) {
    try {
      const contents = await fs.readFile(sourcePath, "utf8");
      return {
        path: targetPath,
        sourcePath,
        preferences: normalizePreferences(JSON.parse(contents)),
      };
    } catch (error) {
      if (error.code !== "ENOENT") {
        console.warn(`No pude leer ${sourcePath}.`, error.message);
      }
    }
  }

  return { path: targetPath, sourcePath: null, preferences: null };
}

async function savePreferences(value) {
  const { targetPath: preferencesPath } = await getPreferencesLocations();
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
  return { path: preferencesPath, preferences };
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
    backgroundColor: "#050507",
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
    createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
