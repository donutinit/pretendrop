import butterchurn from "butterchurn";
import allPresets from "butterchurn-presets/all.js";
import "./style.css";

const DEFAULT_TRANSITION_SECONDS = 3.8;
const DEFAULT_PRESET_INTERVAL_SECONDS = 35;
const MAX_PRESET_INTERVAL_SECONDS = 3600;
const DEFAULT_REACTIVITY = 1;
const DEFAULT_VIGNETTE_PERCENT = 42;
const DEFAULT_TRACK_INTERVAL_MINUTES = 0;
const MAX_TRACK_INTERVAL_MINUTES = 1440;
const MAX_FAILED_TRACKS = 150;
const QUALITY_PROFILES = {
  eco: { maxScale: 0.8, maxPixels: 2_073_600 },
  normal: { maxScale: 1.5, maxPixels: 8_294_400 },
  full: { maxScale: 2, maxPixels: 16_588_800 },
};
const INTERFACE_MODES = new Set(["auto", "visible", "hidden"]);
const PREFERENCES_KEY = "pretendrop-preferences-v1";
const LEGACY_PREFERENCES_KEY = "butter-preferences-v1";
const FAVORITES_SEED_VERSION = 3;
const RECENT_PRESET_LIMIT = 12;
const INITIAL_FAVORITES = [
  "flexi + amandio c - organic12-3d-2.milk",
  "martin - bombyx mori",
  "Waltra - Ice Plasma",
  "martin + stahlregen - martin in da mash 14",
];
const SHUFFLE_DESCRIPTIONS = {
  entropy: "Usa aleatoriedad criptográfica y aparta los últimos presets para que cada salto se sienta impredecible.",
  deck: "Crea una baraja aleatoria; no repite un preset hasta terminar el universo seleccionado.",
  explorer: "Da prioridad a los presets menos vistos en esta sesión, para sacar joyas que normalmente no aparecen.",
};

const elements = {
  canvas: document.querySelector("#visualizer"),
  interface: document.querySelector("#interface"),
  libraryStatus: document.querySelector("#library-status"),
  playbackState: document.querySelector("#playback-state"),
  trackTitle: document.querySelector("#track-title"),
  trackDetail: document.querySelector("#track-detail"),
  presetName: document.querySelector("#preset-name"),
  presetMode: document.querySelector("#preset-mode"),
  toggleFavorite: document.querySelector("#toggle-favorite"),
  previousPreset: document.querySelector("#previous-preset"),
  nextPreset: document.querySelector("#next-preset"),
  nextTrack: document.querySelector("#next-track"),
  togglePlayback: document.querySelector("#toggle-playback"),
  settingsButton: document.querySelector("#settings-button"),
  settingsPanel: document.querySelector("#settings-panel"),
  settingsScrim: document.querySelector("#settings-scrim"),
  closeSettings: document.querySelector("#close-settings"),
  chooseLibrary: document.querySelector("#choose-library"),
  libraryRoot: document.querySelector("#library-root"),
  displaySelect: document.querySelector("#display-select"),
  presetDuration: document.querySelector("#preset-duration"),
  transitionDuration: document.querySelector("#transition-duration"),
  reactivity: document.querySelector("#reactivity"),
  vignette: document.querySelector("#vignette"),
  quality: document.querySelector("#quality"),
  presetLock: document.querySelector("#preset-lock"),
  trackInterval: document.querySelector("#track-interval"),
  interfaceMode: document.querySelector("#interface-mode"),
  resetChaos: document.querySelector("#reset-chaos"),
  toggleBlackout: document.querySelector("#toggle-blackout"),
  shuffleScope: document.querySelector("#shuffle-scope"),
  allCount: document.querySelector("#all-count"),
  favoritesCount: document.querySelector("#favorites-count"),
  shuffleStyle: document.querySelector("#shuffle-style"),
  shuffleDescription: document.querySelector("#shuffle-description"),
  favoriteSearch: document.querySelector("#favorite-search"),
  favoritesList: document.querySelector("#favorites-list"),
  favoritesTotal: document.querySelector("#favorites-total"),
};

const state = {
  audioContext: null,
  audio: null,
  visualGain: null,
  visualizer: null,
  presets: {},
  presetNames: [],
  presetIndex: 0,
  presetTimer: null,
  trackTimer: null,
  presetIntervalSeconds: DEFAULT_PRESET_INTERVAL_SECONDS,
  transitionSeconds: DEFAULT_TRANSITION_SECONDS,
  reactivity: DEFAULT_REACTIVITY,
  vignettePercent: DEFAULT_VIGNETTE_PERCENT,
  quality: "normal",
  presetLocked: false,
  trackIntervalMinutes: DEFAULT_TRACK_INTERVAL_MINUTES,
  interfaceMode: "auto",
  blackout: false,
  currentTrack: null,
  failedTracks: new Set(),
  failedPresets: new Set(),
  favorites: new Set(),
  shuffleScope: "all",
  shuffleStyle: "entropy",
  shuffleDeck: [],
  recentPresetNames: [],
  presetVisits: new Map(),
  loadingTrack: false,
  paused: false,
  controlsTimer: null,
};

function setStatus(message, tone = "neutral") {
  elements.libraryStatus.textContent = message;
  elements.libraryStatus.dataset.tone = tone;
}

function showControls(force = false) {
  if (state.interfaceMode === "hidden" && !force) return;

  elements.interface.classList.add("is-visible");
  document.body.classList.add("show-cursor");
  clearTimeout(state.controlsTimer);
  if (state.interfaceMode === "visible") return;

  state.controlsTimer = setTimeout(() => {
    if (!elements.settingsPanel.classList.contains("is-open")) {
      elements.interface.classList.remove("is-visible");
      document.body.classList.remove("show-cursor");
    }
  }, 4200);
}

function clampNumber(value, minimum, maximum, fallback, decimals = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  const clamped = Math.min(Math.max(numeric, minimum), maximum);
  return Number(clamped.toFixed(decimals));
}

function applyInterfaceMode() {
  clearTimeout(state.controlsTimer);

  if (state.interfaceMode === "visible") {
    showControls(true);
    return;
  }

  if (state.interfaceMode === "hidden") {
    elements.interface.classList.remove("is-visible");
    document.body.classList.remove("show-cursor");
    return;
  }

  showControls();
}

function titleCasePreset(name) {
  return name.replace(/\s+/g, " ").trim();
}

function currentPresetName() {
  return state.presetNames[state.presetIndex];
}

function secureRandomIndex(maximum) {
  if (maximum <= 1) return 0;

  if (globalThis.crypto?.getRandomValues) {
    const bucketSize = Math.floor(0x100000000 / maximum) * maximum;
    const random = new Uint32Array(1);
    do {
      globalThis.crypto.getRandomValues(random);
    } while (random[0] >= bucketSize);
    return random[0] % maximum;
  }

  return Math.floor(Math.random() * maximum);
}

function secureShuffle(items) {
  const deck = [...items];
  for (let index = deck.length - 1; index > 0; index -= 1) {
    const swapIndex = secureRandomIndex(index + 1);
    [deck[index], deck[swapIndex]] = [deck[swapIndex], deck[index]];
  }
  return deck;
}

function resetShuffleDeck() {
  state.shuffleDeck = [];
}

function preferenceSnapshot() {
  return {
    favorites: [...state.favorites],
    shuffleScope: state.shuffleScope,
    shuffleStyle: state.shuffleStyle,
    presetIntervalSeconds: state.presetIntervalSeconds,
    transitionSeconds: state.transitionSeconds,
    reactivity: state.reactivity,
    vignettePercent: state.vignettePercent,
    quality: state.quality,
    presetLocked: state.presetLocked,
    trackIntervalMinutes: state.trackIntervalMinutes,
    interfaceMode: state.interfaceMode,
    favoritesSeedVersion: FAVORITES_SEED_VERSION,
  };
}

async function persistPreferences() {
  const snapshot = preferenceSnapshot();
  try {
    if (window.pretendrop?.preferences) {
      await window.pretendrop.preferences.save(snapshot);
      return true;
    }

    localStorage.setItem(PREFERENCES_KEY, JSON.stringify(snapshot));
    return true;
  } catch (error) {
    console.warn("No pude guardar las preferencias de Pretendrop.", error);
    return false;
  }
}

async function loadPreferences() {
  let saved = null;
  let shouldMigratePreferences = false;

  try {
    const stored = await window.pretendrop?.preferences?.load();
    saved = stored?.preferences ?? null;
    shouldMigratePreferences = saved === null
      || stored?.sourcePath !== stored?.path
      || stored?.needsRewrite === true;
  } catch (error) {
    console.warn("No pude abrir el archivo de preferencias de Pretendrop.", error);
    shouldMigratePreferences = true;
  }

  if (saved === null) {
    try {
      saved = JSON.parse(
        localStorage.getItem(PREFERENCES_KEY) ?? localStorage.getItem(LEGACY_PREFERENCES_KEY),
      );
      shouldMigratePreferences = true;
    } catch {
      saved = null;
    }
  }

  const storedFavorites = Array.isArray(saved?.favorites)
    ? saved.favorites
    : [];
  const seededFavorites = saved?.favoritesSeedVersion === FAVORITES_SEED_VERSION
    ? storedFavorites
    : [...new Set([...storedFavorites, ...INITIAL_FAVORITES])];
  state.favorites = new Set(
    seededFavorites.filter((name) => Object.hasOwn(state.presets, name)),
  );
  state.shuffleScope = saved?.shuffleScope === "favorites" ? "favorites" : "all";
  state.shuffleStyle = Object.hasOwn(SHUFFLE_DESCRIPTIONS, saved?.shuffleStyle)
    ? saved.shuffleStyle
    : "entropy";
  const savedInterval = Math.round(Number(saved?.presetIntervalSeconds));
  state.presetIntervalSeconds = Number.isFinite(savedInterval)
    ? Math.min(Math.max(savedInterval, 0), MAX_PRESET_INTERVAL_SECONDS)
    : DEFAULT_PRESET_INTERVAL_SECONDS;
  state.transitionSeconds = clampNumber(
    saved?.transitionSeconds,
    0,
    15,
    DEFAULT_TRANSITION_SECONDS,
    1,
  );
  state.reactivity = clampNumber(saved?.reactivity, 0.1, 3, DEFAULT_REACTIVITY, 1);
  state.vignettePercent = clampNumber(
    saved?.vignettePercent,
    0,
    100,
    DEFAULT_VIGNETTE_PERCENT,
  );
  state.quality = Object.hasOwn(QUALITY_PROFILES, saved?.quality)
    ? saved.quality
    : "normal";
  state.presetLocked = Boolean(saved?.presetLocked);
  state.trackIntervalMinutes = clampNumber(
    saved?.trackIntervalMinutes,
    0,
    MAX_TRACK_INTERVAL_MINUTES,
    DEFAULT_TRACK_INTERVAL_MINUTES,
  );
  state.interfaceMode = INTERFACE_MODES.has(saved?.interfaceMode)
    ? saved.interfaceMode
    : "auto";

  if (state.shuffleScope === "favorites" && state.favorites.size === 0) {
    state.shuffleScope = "all";
  }

  if (shouldMigratePreferences) {
    await persistPreferences();
  }
}

function getEligiblePresetNames() {
  const source =
    state.shuffleScope === "favorites"
      ? state.presetNames.filter((name) => state.favorites.has(name))
      : state.presetNames;
  return source.filter((name) => !state.failedPresets.has(name));
}

function chooseEntropyPreset(names) {
  const recent = new Set(state.recentPresetNames);
  const freshNames = names.filter((name) => !recent.has(name));
  const pool = freshNames.length > 0 ? freshNames : names;
  return pool[secureRandomIndex(pool.length)];
}

function chooseDeckPreset(names) {
  const eligible = new Set(names);
  state.shuffleDeck = state.shuffleDeck.filter((name) => eligible.has(name));

  if (state.shuffleDeck.length === 0) {
    state.shuffleDeck = secureShuffle(names);
    const currentName = currentPresetName();
    const alternativeIndex = state.shuffleDeck.findIndex(
      (name) => name !== currentName,
    );
    if (alternativeIndex > 0) {
      [state.shuffleDeck[0], state.shuffleDeck[alternativeIndex]] = [
        state.shuffleDeck[alternativeIndex],
        state.shuffleDeck[0],
      ];
    }
  }

  const recent = new Set(state.recentPresetNames);
  const freshIndex = state.shuffleDeck.findIndex((name) => !recent.has(name));
  const index = freshIndex >= 0 ? freshIndex : 0;
  return state.shuffleDeck.splice(index, 1)[0];
}

function chooseExplorerPreset(names) {
  const minimumVisits = Math.min(
    ...names.map((name) => state.presetVisits.get(name) || 0),
  );
  const explorers = names.filter(
    (name) => (state.presetVisits.get(name) || 0) <= minimumVisits + 1,
  );
  const recent = new Set(state.recentPresetNames);
  const freshNames = explorers.filter((name) => !recent.has(name));
  return chooseEntropyPreset(freshNames.length > 0 ? freshNames : explorers);
}

function nextPresetIndex() {
  const names = getEligiblePresetNames();
  if (names.length === 0) return state.presetIndex;

  let name;
  if (state.shuffleStyle === "deck") {
    name = chooseDeckPreset(names);
  } else if (state.shuffleStyle === "explorer") {
    name = chooseExplorerPreset(names);
  } else {
    name = chooseEntropyPreset(names);
  }

  return state.presetNames.indexOf(name);
}

function updateFavoriteButton() {
  const isFavorite = state.favorites.has(currentPresetName());
  elements.toggleFavorite.classList.toggle("is-favorite", isFavorite);
  elements.toggleFavorite.setAttribute("aria-pressed", String(isFavorite));
  elements.toggleFavorite.setAttribute(
    "aria-label",
    isFavorite ? "Quitar preset de favoritos" : "Agregar preset a favoritos",
  );
  elements.toggleFavorite.title = isFavorite
    ? "Quitar de favoritos (H)"
    : "Agregar a favoritos (H)";
}

function updateShuffleControls() {
  elements.allCount.textContent = state.presetNames.length.toLocaleString("es-MX");
  elements.favoritesCount.textContent = state.favorites.size.toLocaleString("es-MX");
  elements.favoritesTotal.textContent = state.favorites.size.toLocaleString("es-MX");
  elements.shuffleStyle.value = state.shuffleStyle;
  elements.shuffleDescription.textContent = SHUFFLE_DESCRIPTIONS[state.shuffleStyle];
  elements.presetMode.textContent = `${state.shuffleStyle} / ${
    state.shuffleScope === "favorites" ? "favoritos" : "todos"
  }`;

  for (const button of elements.shuffleScope.querySelectorAll("button")) {
    const selected = button.dataset.shuffleScope === state.shuffleScope;
    const isFavorites = button.dataset.shuffleScope === "favorites";
    button.classList.toggle("is-selected", selected);
    button.setAttribute("aria-pressed", String(selected));
    button.disabled = isFavorites && state.favorites.size === 0;
  }
}

function applyReactivity() {
  if (!state.visualGain || !state.audioContext) return;
  state.visualGain.gain.setTargetAtTime(
    state.reactivity,
    state.audioContext.currentTime,
    0.02,
  );
}

function updateSceneControls() {
  elements.transitionDuration.value = String(state.transitionSeconds);
  elements.reactivity.value = String(state.reactivity);
  elements.vignette.value = String(state.vignettePercent);
  elements.quality.value = state.quality;
  elements.trackInterval.value = String(state.trackIntervalMinutes);
  elements.interfaceMode.value = state.interfaceMode;
  elements.presetLock.classList.toggle("is-selected", state.presetLocked);
  elements.presetLock.setAttribute("aria-pressed", String(state.presetLocked));
  elements.presetLock.textContent = state.presetLocked ? "preset fijado" : "fijar preset";
  elements.toggleBlackout.classList.toggle("is-selected", state.blackout);
  elements.toggleBlackout.setAttribute("aria-pressed", String(state.blackout));
  elements.toggleBlackout.textContent = state.blackout ? "blackout: on" : "blackout";
  document.documentElement.style.setProperty(
    "--vignette-opacity",
    String(state.vignettePercent / 100),
  );
  document.body.classList.toggle("is-blackout", state.blackout);
  applyReactivity();
}

function renderFavorites() {
  const search = elements.favoriteSearch.value.trim().toLocaleLowerCase("es-MX");
  const names = [...state.favorites]
    .filter((name) => name.toLocaleLowerCase("es-MX").includes(search))
    .sort((left, right) => left.localeCompare(right));

  elements.favoritesList.replaceChildren();
  if (names.length === 0) {
    const empty = document.createElement("p");
    empty.className = "favorites-empty";
    empty.textContent = state.favorites.size === 0
      ? "Dale ♥ al preset actual para empezar tu selección."
      : "No hay favoritos que coincidan.";
    elements.favoritesList.append(empty);
    return;
  }

  for (const name of names) {
    const row = document.createElement("div");
    row.className = "favorite-row";

    const select = document.createElement("button");
    select.type = "button";
    select.className = "favorite-select";
    select.textContent = titleCasePreset(name);
    select.title = `Usar ${name}`;
    select.addEventListener("click", () => {
      const index = state.presetNames.indexOf(name);
      if (index >= 0) loadPreset(index, 1.2);
    });

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "favorite-remove";
    remove.textContent = "♥";
    remove.setAttribute("aria-label", `Quitar ${name} de favoritos`);
    remove.title = `Quitar ${name} de favoritos`;
    remove.addEventListener("click", () => void toggleFavorite(name));

    row.append(select, remove);
    elements.favoritesList.append(row);
  }
}

async function toggleFavorite(name = currentPresetName()) {
  if (!name) return;

  const wasFavorite = state.favorites.has(name);
  if (wasFavorite) {
    state.favorites.delete(name);
  } else {
    state.favorites.add(name);
  }

  if (state.shuffleScope === "favorites" && state.favorites.size === 0) {
    state.shuffleScope = "all";
  }

  resetShuffleDeck();
  updateFavoriteButton();
  updateShuffleControls();
  renderFavorites();

  if (await persistPreferences()) {
    setStatus(
      wasFavorite ? "favorito eliminado" : "favorito guardado",
      "ready",
    );
  } else {
    setStatus("No pude guardar el favorito.", "error");
  }
}

function setShuffleScope(scope) {
  if (scope === "favorites" && state.favorites.size === 0) {
    setStatus("Primero agrega al menos un favorito con el corazón.", "error");
    return;
  }

  state.shuffleScope = scope === "favorites" ? "favorites" : "all";
  resetShuffleDeck();
  void persistPreferences();
  updateShuffleControls();
}

function recordPresetVisit(name) {
  state.presetVisits.set(name, (state.presetVisits.get(name) || 0) + 1);
  state.recentPresetNames = [
    name,
    ...state.recentPresetNames.filter((recentName) => recentName !== name),
  ].slice(0, RECENT_PRESET_LIMIT);
}

function loadPreset(index, transition = state.transitionSeconds) {
  if (!state.visualizer || state.presetNames.length === 0) return false;

  let candidateIndex = (index + state.presetNames.length) % state.presetNames.length;

  for (let attempt = 0; attempt < state.presetNames.length; attempt += 1) {
    const name = state.presetNames[candidateIndex];

    if (!state.failedPresets.has(name)) {
      try {
        state.visualizer.loadPreset(state.presets[name], transition);
        state.presetIndex = candidateIndex;
        elements.presetName.textContent = titleCasePreset(name);
        recordPresetVisit(name);
        updateFavoriteButton();
        return true;
      } catch (error) {
        state.failedPresets.add(name);
        console.warn(`Preset omitido: ${name}`, error);
      }
    }

    candidateIndex = nextPresetIndex();
  }

  setStatus("No queda ningún preset compatible.", "error");
  return false;
}

function nextPreset() {
  loadPreset(nextPresetIndex());
}

function previousPreset() {
  const names = getEligiblePresetNames();
  const currentIndex = names.indexOf(currentPresetName());
  const previousName = names.at((currentIndex - 1 + names.length) % names.length);
  const previousIndex = state.presetNames.indexOf(previousName);
  loadPreset(previousIndex >= 0 ? previousIndex : state.presetIndex - 1);
}

function restartPresetTimer() {
  clearInterval(state.presetTimer);
  state.presetTimer = null;

  if (!state.presetLocked && state.presetIntervalSeconds > 0) {
    state.presetTimer = setInterval(nextPreset, state.presetIntervalSeconds * 1000);
  }
}

function restartTrackTimer() {
  clearInterval(state.trackTimer);
  state.trackTimer = null;

  if (state.trackIntervalMinutes > 0) {
    state.trackTimer = setInterval(() => {
      if (!state.paused) void playRandomTrack();
    }, state.trackIntervalMinutes * 60_000);
  }
}

function renderFrame() {
  try {
    state.visualizer.render();
  } catch (error) {
    const brokenPreset = state.presetNames[state.presetIndex];
    state.failedPresets.add(brokenPreset);
    console.warn(`Preset omitido durante render: ${brokenPreset}`, error);
    loadPreset(nextPresetIndex(), 0);
  }
  requestAnimationFrame(renderFrame);
}

function getRenderSize() {
  const viewportWidth = Math.max(window.innerWidth, 1);
  const viewportHeight = Math.max(window.innerHeight, 1);
  const profile = QUALITY_PROFILES[state.quality];
  const preferredScale = Math.min(window.devicePixelRatio || 1, profile.maxScale);
  const pixelLimitedScale = Math.sqrt(
    profile.maxPixels / (viewportWidth * viewportHeight),
  );
  const scale = Math.min(preferredScale, pixelLimitedScale);

  return {
    width: Math.max(1, Math.round(viewportWidth * scale)),
    height: Math.max(1, Math.round(viewportHeight * scale)),
  };
}

function syncCanvasSize() {
  const { width, height } = getRenderSize();
  elements.canvas.width = width;
  elements.canvas.height = height;
  return { width, height };
}

function resizeVisualizer() {
  if (!state.visualizer) return;
  const { width, height } = syncCanvasSize();
  state.visualizer.setRendererSize(width, height, {
    pixelRatio: 1,
    textureRatio: 1,
  });
}

function updateTrackUi(track) {
  elements.trackTitle.textContent = track.title;
  const bits = [track.artist, track.album].filter(Boolean);
  elements.trackDetail.textContent = bits.length > 0 ? bits.join(" · ") : track.relative;
}

function updatePlaybackUi() {
  elements.togglePlayback.textContent = state.paused ? "PLAY" : "PAUSA";
  elements.togglePlayback.setAttribute(
    "aria-label",
    state.paused ? "Reproducir" : "Pausar",
  );
  elements.playbackState.textContent = state.paused
    ? "▮▮ pausado"
    : "▶ reproduciendo";
  elements.togglePlayback.title = state.paused
    ? "Reproducir (espacio)"
    : "Pausar (espacio)";
}

async function playRandomTrack() {
  if (state.loadingTrack) return;
  state.loadingTrack = true;
  setStatus("Eligiendo una canción…");

  try {
    const track = await window.pretendrop.library.randomTrack([...state.failedTracks]);
    state.currentTrack = track;
    updateTrackUi(track);

    state.audio.pause();
    state.audio.src = track.url;
    state.audio.load();
    await state.audioContext.resume();
    await state.audio.play();
    state.paused = false;
    updatePlaybackUi();
    restartTrackTimer();
    setStatus("audio reactivo · salida silenciada", "ready");
  } catch (error) {
    setStatus(`No pude reproducir: ${error.message}`, "error");
  } finally {
    state.loadingTrack = false;
  }
}

async function togglePlayback() {
  if (!state.currentTrack) {
    await playRandomTrack();
    return;
  }

  if (state.audio.paused) {
    await state.audioContext.resume();
    await state.audio.play();
    state.paused = false;
  } else {
    state.audio.pause();
    state.paused = true;
  }
  updatePlaybackUi();
}

function togglePresetLock() {
  state.presetLocked = !state.presetLocked;
  restartPresetTimer();
  updateSceneControls();
  void persistPreferences();
  setStatus(
    state.presetLocked ? "preset fijado" : "preset liberado",
    "ready",
  );
}

function resetChaos() {
  resetShuffleDeck();
  state.recentPresetNames = [];
  state.presetVisits.clear();
  nextPreset();
  setStatus("caos reiniciado", "ready");
}

function toggleBlackout() {
  state.blackout = !state.blackout;
  updateSceneControls();
  setStatus(state.blackout ? "blackout activo" : "blackout apagado", "ready");
}

function openSettings(open) {
  elements.settingsPanel.classList.toggle("is-open", open);
  elements.settingsPanel.setAttribute("aria-hidden", String(!open));
  document.body.classList.toggle("panel-open", open);
  if (open) {
    elements.interface.classList.add("is-visible");
    document.body.classList.add("show-cursor");
    clearTimeout(state.controlsTimer);
    requestAnimationFrame(() => elements.closeSettings.focus());
  } else {
    elements.settingsButton.focus({ preventScroll: true });
    applyInterfaceMode();
  }
}

function isTextEntryTarget(target) {
  return target instanceof HTMLElement && target.matches("input, select, textarea, [contenteditable='true']");
}

async function chooseLibrary() {
  const root = await window.pretendrop.library.chooseRoot();
  if (!root) return;

  elements.libraryRoot.textContent = root;
  state.failedTracks.clear();
  await indexLibrary(root);
}

async function indexLibrary(root) {
  try {
    await window.pretendrop.library.scan(root);
    await playRandomTrack();
  } catch (error) {
    setStatus(error.message, "error");
  }
}

async function populateDisplays() {
  const displays = await window.pretendrop.window.getDisplays();
  elements.displaySelect.replaceChildren();

  for (const display of displays) {
    const option = document.createElement("option");
    option.value = String(display.id);
    option.textContent = `${display.primary ? "Principal · " : ""}${display.label}`;
    elements.displaySelect.append(option);
  }
}

async function initVisualizer() {
  const { width, height } = syncCanvasSize();
  state.audioContext = new AudioContext();
  state.visualizer = butterchurn.createVisualizer(state.audioContext, elements.canvas, {
    width,
    height,
    pixelRatio: 1,
    textureRatio: 1,
    outputFXAA: true,
  });

  state.presets = allPresets;
  state.presetNames = Object.keys(state.presets).sort((a, b) => a.localeCompare(b));

  if (state.presetNames.length === 0) {
    throw new Error("Butterchurn no pudo cargar sus presets.");
  }

  await loadPreferences();
  elements.presetDuration.value = String(state.presetIntervalSeconds);
  updateShuffleControls();
  updateSceneControls();
  resizeVisualizer();
  renderFavorites();

  const favoriteIndex = state.presetNames.indexOf(INITIAL_FAVORITES[0]);
  state.presetIndex =
    favoriteIndex >= 0
      ? favoriteIndex
      : Math.floor(Math.random() * state.presetNames.length);
  loadPreset(state.presetIndex, 0);
  restartPresetTimer();

  state.audio = new Audio();
  state.audio.preload = "auto";
  const audioSource = state.audioContext.createMediaElementSource(state.audio);
  const silentOutput = state.audioContext.createGain();
  state.visualGain = state.audioContext.createGain();
  silentOutput.gain.value = 0;
  audioSource.connect(silentOutput);
  silentOutput.connect(state.audioContext.destination);
  audioSource.connect(state.visualGain);
  state.visualizer.connectAudio(state.visualGain);
  applyReactivity();

  state.audio.addEventListener("ended", () => void playRandomTrack());
  state.audio.addEventListener("error", () => {
    if (state.currentTrack) {
      state.failedTracks.add(state.currentTrack.path);
      if (state.failedTracks.size > MAX_FAILED_TRACKS) {
        state.failedTracks.delete(state.failedTracks.values().next().value);
      }
    }
    window.setTimeout(() => void playRandomTrack(), 250);
  });

  applyInterfaceMode();
  renderFrame();
}

function bindControls() {
  elements.previousPreset.addEventListener("click", previousPreset);
  elements.nextPreset.addEventListener("click", nextPreset);
  elements.toggleFavorite.addEventListener("click", () => void toggleFavorite());
  elements.nextTrack.addEventListener("click", () => void playRandomTrack());
  elements.togglePlayback.addEventListener("click", () => void togglePlayback());
  elements.settingsButton.addEventListener("click", () => openSettings(true));
  elements.closeSettings.addEventListener("click", () => openSettings(false));
  elements.settingsScrim.addEventListener("click", () => openSettings(false));
  elements.chooseLibrary.addEventListener("click", () => void chooseLibrary());
  elements.presetLock.addEventListener("click", togglePresetLock);
  elements.resetChaos.addEventListener("click", resetChaos);
  elements.toggleBlackout.addEventListener("click", toggleBlackout);

  elements.presetDuration.addEventListener("change", () => {
    const requestedInterval = Math.round(Number(elements.presetDuration.value));
    state.presetIntervalSeconds = Number.isFinite(requestedInterval)
      ? Math.min(Math.max(requestedInterval, 0), MAX_PRESET_INTERVAL_SECONDS)
      : DEFAULT_PRESET_INTERVAL_SECONDS;
    elements.presetDuration.value = String(state.presetIntervalSeconds);
    restartPresetTimer();
    void persistPreferences();
  });

  elements.transitionDuration.addEventListener("change", () => {
    state.transitionSeconds = clampNumber(
      elements.transitionDuration.value,
      0,
      15,
      DEFAULT_TRANSITION_SECONDS,
      1,
    );
    updateSceneControls();
    void persistPreferences();
  });

  elements.reactivity.addEventListener("change", () => {
    state.reactivity = clampNumber(
      elements.reactivity.value,
      0.1,
      3,
      DEFAULT_REACTIVITY,
      1,
    );
    updateSceneControls();
    void persistPreferences();
  });

  elements.vignette.addEventListener("change", () => {
    state.vignettePercent = clampNumber(
      elements.vignette.value,
      0,
      100,
      DEFAULT_VIGNETTE_PERCENT,
    );
    updateSceneControls();
    void persistPreferences();
  });

  elements.quality.addEventListener("change", () => {
    state.quality = Object.hasOwn(QUALITY_PROFILES, elements.quality.value)
      ? elements.quality.value
      : "normal";
    resizeVisualizer();
    updateSceneControls();
    void persistPreferences();
  });

  elements.trackInterval.addEventListener("change", () => {
    state.trackIntervalMinutes = clampNumber(
      elements.trackInterval.value,
      0,
      MAX_TRACK_INTERVAL_MINUTES,
      DEFAULT_TRACK_INTERVAL_MINUTES,
    );
    restartTrackTimer();
    updateSceneControls();
    void persistPreferences();
  });

  elements.interfaceMode.addEventListener("change", () => {
    state.interfaceMode = INTERFACE_MODES.has(elements.interfaceMode.value)
      ? elements.interfaceMode.value
      : "auto";
    updateSceneControls();
    applyInterfaceMode();
    void persistPreferences();
  });

  elements.shuffleScope.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-shuffle-scope]");
    if (button) setShuffleScope(button.dataset.shuffleScope);
  });

  elements.shuffleStyle.addEventListener("change", () => {
    state.shuffleStyle = elements.shuffleStyle.value;
    resetShuffleDeck();
    void persistPreferences();
    updateShuffleControls();
  });

  elements.favoriteSearch.addEventListener("input", renderFavorites);

  elements.displaySelect.addEventListener("change", () => {
    void window.pretendrop.window.setDisplay(Number(elements.displaySelect.value));
  });

  document.addEventListener("mousemove", showControls);
  document.addEventListener("keydown", (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) {
      if (event.ctrlKey && event.key.toLowerCase() === "q") {
        void window.pretendrop.app.quit();
      }
      return;
    }

    if (event.key !== "Escape" && isTextEntryTarget(event.target)) {
      return;
    }

    if (event.key === " ") {
      event.preventDefault();
      void togglePlayback();
    } else if (event.key === "ArrowRight") {
      nextPreset();
    } else if (event.key === "ArrowLeft") {
      previousPreset();
    } else if (event.key.toLowerCase() === "n") {
      void playRandomTrack();
    } else if (event.key.toLowerCase() === "h") {
      void toggleFavorite();
    } else if (event.key.toLowerCase() === "o") {
      openSettings(!elements.settingsPanel.classList.contains("is-open"));
    } else if (event.key.toLowerCase() === "f") {
      void window.pretendrop.window.toggleKiosk();
    } else if (event.key.toLowerCase() === "b") {
      toggleBlackout();
    } else if (event.key === "Escape") {
      openSettings(false);
    }

    showControls();
  });

  window.addEventListener("resize", resizeVisualizer);
}

function bindLibraryEvents() {
  window.pretendrop.onLibraryProgress(({ tracks, foldersVisited }) => {
    setStatus(`Indexando: ${tracks.toLocaleString("es-MX")} pistas`);
    if (foldersVisited) {
      elements.trackDetail.textContent = `${foldersVisited.toLocaleString("es-MX")} carpetas revisadas`;
    }
  });

  window.pretendrop.onLibraryReady(({ count, root }) => {
    elements.libraryRoot.textContent = root;
    setStatus(`${count.toLocaleString("es-MX")} pistas listas`, "ready");
  });

  window.pretendrop.onLibraryError(({ message }) => setStatus(message, "error"));
}

async function boot() {
  try {
    bindLibraryEvents();
    await initVisualizer();
    bindControls();
    await populateDisplays();
    const root = await window.pretendrop.library.getRoot();
    elements.libraryRoot.textContent = root;
    await indexLibrary(root);
  } catch (error) {
    console.error(error);
    setStatus(error.message || "Pretendrop no pudo iniciar.", "error");
  }
}

void boot();
