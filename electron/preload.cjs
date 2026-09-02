const { contextBridge, ipcRenderer } = require("electron");

function subscribe(channel, callback) {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld("pretendrop", {
  library: {
    scan: (root) => ipcRenderer.invoke("library:scan", root),
    getRoot: () => ipcRenderer.invoke("library:get-root"),
    randomTrack: (excludedPaths) =>
      ipcRenderer.invoke("library:random-track", excludedPaths),
    chooseRoot: () => ipcRenderer.invoke("library:choose-root"),
  },
  preferences: {
    load: () => ipcRenderer.invoke("preferences:load"),
    save: (preferences) => ipcRenderer.invoke("preferences:save", preferences),
  },
  window: {
    getDisplays: () => ipcRenderer.invoke("window:get-displays"),
    setDisplay: (displayId) => ipcRenderer.invoke("window:set-display", displayId),
    toggleKiosk: () => ipcRenderer.invoke("window:toggle-kiosk"),
  },
  app: {
    version: () => ipcRenderer.invoke("app:version"),
    quit: () => ipcRenderer.invoke("app:quit"),
  },
  onLibraryProgress: (callback) => subscribe("library:progress", callback),
  onLibraryReady: (callback) => subscribe("library:ready", callback),
  onLibraryError: (callback) => subscribe("library:error", callback),
});
