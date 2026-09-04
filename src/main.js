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
const AUDIO_METER_FLOOR_DB = -72;
const AUDIO_METER_SIGNAL_DB = -60;
const AUDIO_METER_UPDATE_MS = 50;
const AUDIO_METER_PEAK_DECAY_DB_PER_SECOND = 18;
const BUTTERCHURN_FFT_SIZE = 1024;
const SILENT_OUTPUT_GAIN = 1e-8;
const AUDIO_SOURCE_MODES = new Set(["library", "microphone", "system"]);
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
  audioSource: document.querySelector("#audio-source"),
  audioSourceDetail: document.querySelector("#audio-source-detail"),
  audioMeter: document.querySelector("#audio-meter"),
  audioMeterTrack: document.querySelector("#audio-meter-track"),
  audioMeterFill: document.querySelector("#audio-meter-fill"),
  audioMeterPeak: document.querySelector("#audio-meter-peak"),
  audioMeterLevel: document.querySelector("#audio-meter-level"),
  audioMeterState: document.querySelector("#audio-meter-state"),
  systemAudioOption: document.querySelector("#system-audio-option"),
  microphoneDeviceSetting: document.querySelector("#microphone-device-setting"),
  microphoneDevice: document.querySelector("#microphone-device"),
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
  resetDefaults: document.querySelector("#reset-defaults"),
  reactivityValue: document.querySelector("#reactivity-value"),
  transitionValue: document.querySelector("#transition-duration-value"),
  vignetteValue: document.querySelector("#vignette-value"),
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
  librarySource: null,
  inputAnalyser: null,
  inputMeterSamples: null,
  visualGain: null,
  visualAnalyser: null,
  visualChannelSplitter: null,
  visualLeftAnalyser: null,
  visualRightAnalyser: null,
  visualAudioLevels: null,
  silentOutput: null,
  liveInputNode: null,
  liveInputStream: null,
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
  audioSourceMode: "library",
  microphoneDeviceId: "default",
  audioCapabilities: null,
  switchingAudioSource: false,
  liveInputLabel: "",
  inputMeterPeakDb: AUDIO_METER_FLOOR_DB,
  inputMeterLastUpdate: 0,
  controlsTimer: null,
  lastRemovedFavorite: null,
};

/* The status line carries two different things: the standing state of the
   library, and short notices about what just happened. Notices used to
   overwrite the state permanently, so they now revert to it. */
let statusRestoreTimer = null;
let standingStatus = { message: "Preparando biblioteca…", tone: "neutral" };

function paintStatus({ message, tone }, live = true) {
  elements.libraryStatus.textContent = message;
  elements.libraryStatus.dataset.tone = tone;
  elements.libraryStatus.setAttribute(
    "aria-live",
    !live ? "off" : tone === "error" ? "assertive" : "polite",
  );
}

function setStatus(message, tone = "neutral", { standing = false, live = true } = {}) {
  clearTimeout(statusRestoreTimer);
  paintStatus({ message, tone }, live);

  if (standing || tone === "error") {
    standingStatus = { message, tone };
    return;
  }

  statusRestoreTimer = setTimeout(() => paintStatus(standingStatus), 3600);
}

function showControls(force = false) {
  if (state.interfaceMode === "hidden" && !force) return;
  if (state.blackout && !force) return;

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

  if (state.blackout) {
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
    audioSourceMode: state.audioSourceMode,
    microphoneDeviceId: state.microphoneDeviceId,
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
  state.audioSourceMode = AUDIO_SOURCE_MODES.has(saved?.audioSourceMode)
    ? saved.audioSourceMode
    : "library";
  state.microphoneDeviceId = typeof saved?.microphoneDeviceId === "string"
    ? saved.microphoneDeviceId
    : "default";

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

  /* Roving tabindex: one stop for the group, arrows move within it. The
     favorites option stays enabled so it can explain why it is empty. */
  for (const button of elements.shuffleScope.querySelectorAll("button")) {
    const selected = button.dataset.shuffleScope === state.shuffleScope;
    button.setAttribute("aria-checked", String(selected));
    button.tabIndex = selected ? 0 : -1;
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
  elements.presetDuration.value = String(state.presetIntervalSeconds);
  updateSliderReadouts();

  /* The label stays put; aria-pressed and the selected style carry the state,
     so a screen reader does not announce it twice. */
  elements.presetLock.classList.toggle("is-selected", state.presetLocked);
  elements.presetLock.setAttribute("aria-pressed", String(state.presetLocked));
  elements.toggleBlackout.classList.toggle("is-selected", state.blackout);
  elements.toggleBlackout.setAttribute("aria-pressed", String(state.blackout));

  document.documentElement.style.setProperty(
    "--vignette-opacity",
    String(state.vignettePercent / 100),
  );
  document.body.classList.toggle("is-blackout", state.blackout);
  applyReactivity();
}

function updateSliderReadouts() {
  elements.reactivityValue.textContent = state.reactivity.toLocaleString("es-MX");
  elements.transitionValue.textContent = `${state.transitionSeconds.toLocaleString("es-MX")} s`;
  elements.vignetteValue.textContent = `${state.vignettePercent.toLocaleString("es-MX")} %`;
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
    remove.textContent = "×";
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

  state.lastRemovedFavorite = wasFavorite ? name : null;

  if (await persistPreferences()) {
    setStatus(
      wasFavorite ? "favorito eliminado · z para deshacer" : "favorito guardado",
      "ready",
    );
  } else {
    setStatus("No pude guardar el favorito.", "error");
  }
}

async function undoFavoriteRemoval() {
  const name = state.lastRemovedFavorite;
  if (!name || state.favorites.has(name)) return;

  state.lastRemovedFavorite = null;
  state.favorites.add(name);
  resetShuffleDeck();
  updateFavoriteButton();
  updateShuffleControls();
  renderFavorites();

  if (await persistPreferences()) {
    setStatus("favorito restaurado", "ready");
  } else {
    setStatus("No pude restaurar el favorito.", "error");
  }
}

async function restoreDefaults() {
  state.presetIntervalSeconds = DEFAULT_PRESET_INTERVAL_SECONDS;
  state.transitionSeconds = DEFAULT_TRANSITION_SECONDS;
  state.reactivity = DEFAULT_REACTIVITY;
  state.vignettePercent = DEFAULT_VIGNETTE_PERCENT;
  state.trackIntervalMinutes = DEFAULT_TRACK_INTERVAL_MINUTES;
  state.quality = "normal";
  state.interfaceMode = "auto";
  state.presetLocked = false;

  restartPresetTimer();
  restartTrackTimer();
  resizeVisualizer();
  updateSceneControls();
  applyInterfaceMode();

  if (await persistPreferences()) {
    setStatus("valores restaurados", "ready");
  } else {
    setStatus("No pude guardar los valores.", "error");
  }
}

function setShuffleScope(scope) {
  if (scope === "favorites" && state.favorites.size === 0) {
    setStatus("Primero marca un preset con el corazón.", "error");
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

  if (state.audioSourceMode === "library" && state.trackIntervalMinutes > 0) {
    state.trackTimer = setInterval(() => {
      if (!state.paused) void playRandomTrack();
    }, state.trackIntervalMinutes * 60_000);
  }
}

function audioMeterPercent(decibels) {
  return Math.min(
    Math.max((decibels - AUDIO_METER_FLOOR_DB) / -AUDIO_METER_FLOOR_DB, 0),
    1,
  );
}

function resetAudioMeter() {
  state.inputMeterPeakDb = AUDIO_METER_FLOOR_DB;
  state.inputMeterLastUpdate = 0;
  elements.audioMeterFill.style.transform = "scaleX(0)";
  elements.audioMeterPeak.style.left = "0%";
  elements.audioMeterLevel.textContent = "−∞ dB";
  elements.audioMeterState.textContent = "Esperando señal…";
  elements.audioMeterState.dataset.signal = "quiet";
  elements.audioMeterTrack.setAttribute("aria-valuenow", String(AUDIO_METER_FLOOR_DB));
  elements.audioMeterTrack.setAttribute("aria-valuetext", "Sin señal");
}

function updateAudioMeter(timestamp) {
  if (
    elements.audioMeter.hidden
    || !elements.settingsPanel.classList.contains("is-open")
    || !state.inputAnalyser
    || !state.inputMeterSamples
    || timestamp - state.inputMeterLastUpdate < AUDIO_METER_UPDATE_MS
  ) {
    return;
  }

  const elapsedSeconds = state.inputMeterLastUpdate > 0
    ? (timestamp - state.inputMeterLastUpdate) / 1_000
    : AUDIO_METER_UPDATE_MS / 1_000;
  state.inputMeterLastUpdate = timestamp;
  state.inputAnalyser.getFloatTimeDomainData(state.inputMeterSamples);

  let squareSum = 0;
  let absolutePeak = 0;
  for (const sample of state.inputMeterSamples) {
    squareSum += sample * sample;
    absolutePeak = Math.max(absolutePeak, Math.abs(sample));
  }

  const rms = Math.sqrt(squareSum / state.inputMeterSamples.length);
  const rmsDb = rms > 0 ? 20 * Math.log10(rms) : AUDIO_METER_FLOOR_DB;
  const instantPeakDb = absolutePeak > 0
    ? 20 * Math.log10(absolutePeak)
    : AUDIO_METER_FLOOR_DB;
  const levelDb = Math.min(Math.max(rmsDb, AUDIO_METER_FLOOR_DB), 0);
  const decayedPeakDb = state.inputMeterPeakDb
    - AUDIO_METER_PEAK_DECAY_DB_PER_SECOND * elapsedSeconds;
  state.inputMeterPeakDb = Math.min(
    Math.max(instantPeakDb, decayedPeakDb, AUDIO_METER_FLOOR_DB),
    0,
  );

  const levelPercent = audioMeterPercent(levelDb);
  const peakPercent = audioMeterPercent(state.inputMeterPeakDb);
  const levelText = rmsDb > AUDIO_METER_FLOOR_DB
    ? `${levelDb.toFixed(1)} dB`
    : "−∞ dB";
  let signalText = levelDb > AUDIO_METER_SIGNAL_DB
    ? "Señal presente"
    : "Sin señal detectable";

  if (!state.liveInputStream) signalText = "Conectando entrada…";
  if (state.paused) signalText = "Entrada pausada";

  elements.audioMeterFill.style.transform = `scaleX(${levelPercent})`;
  elements.audioMeterPeak.style.left = `${peakPercent * 100}%`;
  elements.audioMeterLevel.textContent = levelText;
  elements.audioMeterState.textContent = signalText;
  elements.audioMeterState.dataset.signal = levelDb > AUDIO_METER_SIGNAL_DB
    && state.liveInputStream
    && !state.paused
    ? "present"
    : "quiet";
  elements.audioMeterTrack.setAttribute("aria-valuenow", levelDb.toFixed(1));
  elements.audioMeterTrack.setAttribute(
    "aria-valuetext",
    `${signalText}, ${levelText}`,
  );
}

function renderFrame(timestamp = 0) {
  requestAnimationFrame(renderFrame);
  updateAudioMeter(timestamp);
  if (state.blackout) return;

  try {
    /* Butterchurn can sample a connected AudioNode itself, but Chromium may
       leave that analyser-only branch idle for MediaStream sources. Sampling
       the active, silently-routed graph here makes live and library inputs use
       the same deterministic path into Butterchurn. */
    state.visualAnalyser.getByteTimeDomainData(
      state.visualAudioLevels.timeByteArray,
    );
    state.visualLeftAnalyser.getByteTimeDomainData(
      state.visualAudioLevels.timeByteArrayL,
    );
    state.visualRightAnalyser.getByteTimeDomainData(
      state.visualAudioLevels.timeByteArrayR,
    );

    const liveChannelCount = state.liveInputStream
      ?.getAudioTracks()[0]
      ?.getSettings()
      ?.channelCount;
    if (liveChannelCount === 1) {
      state.visualAudioLevels.timeByteArrayL.set(
        state.visualAudioLevels.timeByteArray,
      );
      state.visualAudioLevels.timeByteArrayR.set(
        state.visualAudioLevels.timeByteArray,
      );
    }

    state.visualizer.render({ audioLevels: state.visualAudioLevels });
  } catch (error) {
    const brokenPreset = state.presetNames[state.presetIndex];
    state.failedPresets.add(brokenPreset);
    console.warn(`Preset omitido durante render: ${brokenPreset}`, error);
    loadPreset(nextPresetIndex(), 0);
  }
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
  elements.togglePlayback.textContent = state.paused ? "SEGUIR" : "PAUSA";
  if (state.paused) {
    elements.playbackState.textContent = "▮▮ pausado";
  } else if (state.audioSourceMode === "microphone") {
    elements.playbackState.textContent = "● micrófono activo";
  } else if (state.audioSourceMode === "system") {
    elements.playbackState.textContent = "● sistema activo";
  } else {
    elements.playbackState.textContent = "▶ reproduciendo";
  }
  elements.togglePlayback.title = state.paused
    ? "Seguir (espacio)"
    : "Pausar (espacio)";
  updateAudioSourceControls();
}

function updateAudioSourceControls() {
  const capabilities = state.audioCapabilities;
  const microphoneOption = elements.audioSource.querySelector('option[value="microphone"]');
  const microphoneAvailable = capabilities?.microphone !== false;
  const systemAvailable = capabilities?.systemAudio === true;
  const isLibrary = state.audioSourceMode === "library";

  microphoneOption.disabled = !microphoneAvailable;
  elements.systemAudioOption.hidden = capabilities?.platform !== "linux";
  elements.systemAudioOption.disabled = !systemAvailable;
  elements.audioSource.value = state.audioSourceMode;
  elements.audioSource.disabled = state.switchingAudioSource;
  elements.microphoneDeviceSetting.hidden = state.audioSourceMode !== "microphone";
  elements.microphoneDevice.disabled = state.switchingAudioSource;
  elements.nextTrack.disabled = !isLibrary;
  elements.trackInterval.disabled = !isLibrary;
  if (elements.audioMeter.hidden !== isLibrary) {
    elements.audioMeter.hidden = isLibrary;
    resetAudioMeter();
  }

  if (state.audioSourceMode === "microphone") {
    elements.audioSourceDetail.textContent = "Entrada directa para Butterchurn; no se graba ni se reproduce en las bocinas.";
  } else if (state.audioSourceMode === "system") {
    const outputName = state.liveInputLabel || capabilities?.systemAudioLabel || "salida predeterminada";
    elements.audioSourceDetail.textContent = `Monitor de ${outputName}; disponible sólo en este equipo Linux.`;
  } else if (capabilities?.platform === "linux" && !systemAvailable) {
    elements.audioSourceDetail.textContent = capabilities.systemAudioError
      ? `Pistas locales. Audio del sistema no disponible: ${capabilities.systemAudioError}`
      : "Reproduce una pista local sin enviar audio a las bocinas.";
  } else {
    elements.audioSourceDetail.textContent = "Reproduce una pista local sin enviar audio a las bocinas.";
  }
}

function mediaInputError(error) {
  if (error?.name === "NotAllowedError") {
    return "No se concedió permiso para usar el micrófono.";
  }
  if (error?.name === "NotFoundError") {
    return "No encontré ningún micrófono disponible.";
  }
  if (error?.name === "NotReadableError") {
    return "El sistema no pudo abrir el dispositivo de audio.";
  }
  if (error?.name === "OverconstrainedError") {
    return "El micrófono guardado ya no está disponible.";
  }
  return error?.message || "No pude abrir la entrada de audio.";
}

function liveAudioConstraints(deviceId = "default") {
  return {
    audio: {
      autoGainControl: false,
      echoCancellation: false,
      noiseSuppression: false,
      channelCount: { ideal: 2 },
      ...(deviceId !== "default" ? { deviceId: { exact: deviceId } } : {}),
    },
    video: false,
  };
}

async function refreshMicrophoneDevices(preferredDeviceId = state.microphoneDeviceId) {
  if (!navigator.mediaDevices?.enumerateDevices) return;

  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const microphones = devices.filter(
      (device) => device.kind === "audioinput" && device.deviceId !== "default",
    );
    const availableIds = new Set(microphones.map((device) => device.deviceId));

    elements.microphoneDevice.replaceChildren();
    const defaultOption = document.createElement("option");
    defaultOption.value = "default";
    defaultOption.textContent = "predeterminado del sistema";
    elements.microphoneDevice.append(defaultOption);

    microphones.forEach((device, index) => {
      const option = document.createElement("option");
      option.value = device.deviceId;
      option.textContent = device.label || `micrófono ${index + 1}`;
      elements.microphoneDevice.append(option);
    });

    state.microphoneDeviceId = availableIds.has(preferredDeviceId)
      ? preferredDeviceId
      : "default";
    elements.microphoneDevice.value = state.microphoneDeviceId;
  } catch (error) {
    console.warn("No pude enumerar los micrófonos.", error);
  }
}

function disconnectLibraryInput() {
  if (!state.librarySource || !state.inputAnalyser) return;
  try {
    state.librarySource.disconnect(state.inputAnalyser);
  } catch {
    // La fuente ya estaba desconectada del visualizador.
  }
}

function connectLibraryInput() {
  disconnectLibraryInput();
  state.librarySource.connect(state.inputAnalyser);
}

function stopLiveInput() {
  const inputNode = state.liveInputNode;
  const inputStream = state.liveInputStream;
  state.liveInputNode = null;
  state.liveInputStream = null;
  state.liveInputLabel = "";

  try {
    inputNode?.disconnect();
  } catch {
    // El nodo ya estaba desconectado.
  }
  inputStream?.getTracks().forEach((track) => track.stop());
}

async function acquireDefaultMicrophoneStream() {
  const prepared = state.audioCapabilities?.platform === "linux"
    ? await window.pretendrop.audio.prepareDefaultMicrophoneCapture()
    : null;
  let stream = null;

  try {
    stream = await navigator.mediaDevices.getUserMedia(liveAudioConstraints());
    if (prepared) {
      await window.pretendrop.audio.activateLinuxCapture(prepared.token);
    }
    return stream;
  } catch (error) {
    stream?.getTracks().forEach((track) => track.stop());
    if (prepared) {
      await window.pretendrop.audio.cancelLinuxCapture(prepared.token);
    }
    throw error;
  }
}

async function acquireMicrophoneInput() {
  let requestedDeviceId = state.microphoneDeviceId;
  let stream;

  if (requestedDeviceId === "default") {
    stream = await acquireDefaultMicrophoneStream();
  } else {
    try {
      stream = await navigator.mediaDevices.getUserMedia(
        liveAudioConstraints(requestedDeviceId),
      );
    } catch (error) {
      if (error?.name !== "OverconstrainedError") throw error;
      requestedDeviceId = "default";
      state.microphoneDeviceId = "default";
      stream = await acquireDefaultMicrophoneStream();
    }
  }

  const track = stream.getAudioTracks()[0];
  return {
    stream,
    label: requestedDeviceId === "default"
      ? "Micrófono predeterminado"
      : track?.label || "Micrófono",
  };
}

async function acquireSystemInput() {
  const prepared = await window.pretendrop.audio.prepareSystemCapture();
  let stream = null;

  try {
    stream = await navigator.mediaDevices.getUserMedia(liveAudioConstraints());
    const activated = await window.pretendrop.audio.activateLinuxCapture(prepared.token);
    return { stream, label: activated.label || prepared.label };
  } catch (error) {
    stream?.getTracks().forEach((track) => track.stop());
    await window.pretendrop.audio.cancelLinuxCapture(prepared.token);
    throw error;
  }
}

function attachLiveInput(mode, acquired) {
  const inputNode = state.audioContext.createMediaStreamSource(acquired.stream);

  state.audio.pause();
  disconnectLibraryInput();
  stopLiveInput();

  state.audioSourceMode = mode;
  state.liveInputStream = acquired.stream;
  state.liveInputNode = inputNode;
  state.liveInputLabel = acquired.label;
  state.liveInputNode.connect(state.inputAnalyser);
  state.paused = false;

  for (const track of acquired.stream.getAudioTracks()) {
    track.addEventListener("ended", () => {
      if (state.liveInputStream !== acquired.stream) return;
      state.paused = true;
      updatePlaybackUi();
      setStatus("La entrada de audio se desconectó.", "error");
    });
  }

  if (mode === "microphone") {
    elements.trackTitle.textContent = acquired.label;
    elements.trackDetail.textContent = "Entrada de micrófono · sin grabación";
    setStatus("micrófono activo · salida desconectada", "ready", { standing: true });
  } else {
    elements.trackTitle.textContent = "Audio del sistema";
    elements.trackDetail.textContent = acquired.label;
    setStatus("sistema activo · monitor PipeWire", "ready", { standing: true });
  }

  restartTrackTimer();
  updatePlaybackUi();
}

async function activateLibraryInput() {
  stopLiveInput();
  state.audioSourceMode = "library";
  connectLibraryInput();
  await state.audioContext.resume();

  if (!state.currentTrack) {
    await playRandomTrack();
    return;
  }

  updateTrackUi(state.currentTrack);
  try {
    await state.audio.play();
    state.paused = false;
    setStatus("audio reactivo · salida silenciada", "ready", { standing: true });
  } catch {
    await playRandomTrack();
  }
  restartTrackTimer();
  updatePlaybackUi();
}

async function switchAudioSource(mode, { force = false, persist = true } = {}) {
  const requestedMode = AUDIO_SOURCE_MODES.has(mode) ? mode : "library";
  const previousMode = state.audioSourceMode;

  if (state.switchingAudioSource) return false;
  if (!force && requestedMode === previousMode) return true;

  state.switchingAudioSource = true;
  updateAudioSourceControls();

  try {
    if (requestedMode === "system" && !state.audioCapabilities?.systemAudio) {
      throw new Error(state.audioCapabilities?.systemAudioError || "El audio del sistema no está disponible.");
    }
    if (requestedMode === "microphone" && !state.audioCapabilities?.microphone) {
      throw new Error("El micrófono no está disponible en esta plataforma.");
    }

    if (requestedMode === "library") {
      await activateLibraryInput();
    } else {
      await state.audioContext.resume();
      if (state.liveInputStream) {
        stopLiveInput();
        await new Promise((resolve) => window.setTimeout(resolve, 100));
      }
      const acquired = requestedMode === "microphone"
        ? await acquireMicrophoneInput()
        : await acquireSystemInput();
      attachLiveInput(requestedMode, acquired);
      if (requestedMode === "microphone") {
        await refreshMicrophoneDevices(state.microphoneDeviceId);
      }
    }

    if (persist) await persistPreferences();
    return true;
  } catch (error) {
    if (!state.liveInputStream && previousMode !== "library") {
      try {
        const restored = previousMode === "microphone"
          ? await acquireMicrophoneInput()
          : await acquireSystemInput();
        attachLiveInput(previousMode, restored);
      } catch (restoreError) {
        console.warn("No pude restaurar la entrada anterior.", restoreError);
        state.audioSourceMode = "library";
        connectLibraryInput();
        state.paused = true;
        updatePlaybackUi();
      }
    }
    elements.audioSource.value = state.audioSourceMode;
    setStatus(mediaInputError(error), "error");
    return false;
  } finally {
    state.switchingAudioSource = false;
    updateAudioSourceControls();
  }
}

async function initializeAudioSources() {
  state.audioCapabilities = await window.pretendrop.audio.getCapabilities();
  const savedMode = state.audioSourceMode;

  if (state.audioSourceMode === "system" && !state.audioCapabilities.systemAudio) {
    state.audioSourceMode = "library";
  }
  if (state.audioSourceMode === "microphone" && !state.audioCapabilities.microphone) {
    state.audioSourceMode = "library";
  }

  await refreshMicrophoneDevices(state.microphoneDeviceId);
  updateAudioSourceControls();
  if (state.audioSourceMode !== savedMode) await persistPreferences();
}

async function playRandomTrack() {
  if (state.audioSourceMode !== "library") {
    setStatus("El cambio de pista sólo aplica a la biblioteca.");
    return false;
  }
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
    setStatus("audio reactivo · salida silenciada", "ready", { standing: true });
    return true;
  } catch (error) {
    setStatus(`No pude reproducir: ${error.message}`, "error");
    state.paused = true;
    updatePlaybackUi();
    return false;
  } finally {
    state.loadingTrack = false;
  }
}

async function togglePlayback() {
  if (state.audioSourceMode !== "library") {
    state.paused = !state.paused;
    state.liveInputStream?.getAudioTracks().forEach((track) => {
      track.enabled = !state.paused;
    });
    updatePlaybackUi();
    setStatus(
      state.paused ? "entrada pausada" : `${state.audioSourceMode === "system" ? "sistema" : "micrófono"} activo`,
      "ready",
      { standing: true },
    );
    return;
  }

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

  if (state.blackout && !elements.settingsPanel.classList.contains("is-open")) {
    clearTimeout(state.controlsTimer);
    elements.interface.classList.remove("is-visible");
    document.body.classList.remove("show-cursor");
  } else if (!state.blackout) {
    applyInterfaceMode();
  }
}

function openSettings(open) {
  elements.settingsPanel.classList.toggle("is-open", open);
  /* inert does what aria-hidden could not: takes the closed panel out of the
     tab order, and holds focus inside it while it is open. */
  elements.settingsPanel.inert = !open;
  elements.interface.inert = open;
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
    if (state.audioSourceMode === "library") {
      await playRandomTrack();
    }
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
  state.librarySource = state.audioContext.createMediaElementSource(state.audio);
  state.inputAnalyser = state.audioContext.createAnalyser();
  state.visualGain = state.audioContext.createGain();
  state.visualAnalyser = state.audioContext.createAnalyser();
  state.visualChannelSplitter = state.audioContext.createChannelSplitter(2);
  state.visualLeftAnalyser = state.audioContext.createAnalyser();
  state.visualRightAnalyser = state.audioContext.createAnalyser();
  state.silentOutput = state.audioContext.createGain();
  state.inputAnalyser.fftSize = BUTTERCHURN_FFT_SIZE;
  state.inputMeterSamples = new Float32Array(state.inputAnalyser.fftSize);
  state.visualAnalyser.fftSize = BUTTERCHURN_FFT_SIZE;
  state.visualLeftAnalyser.fftSize = BUTTERCHURN_FFT_SIZE;
  state.visualRightAnalyser.fftSize = BUTTERCHURN_FFT_SIZE;
  state.visualAudioLevels = {
    timeByteArray: new Uint8Array(BUTTERCHURN_FFT_SIZE),
    timeByteArrayL: new Uint8Array(BUTTERCHURN_FFT_SIZE),
    timeByteArrayR: new Uint8Array(BUTTERCHURN_FFT_SIZE),
  };
  state.visualAudioLevels.timeByteArray.fill(128);
  state.visualAudioLevels.timeByteArrayL.fill(128);
  state.visualAudioLevels.timeByteArrayR.fill(128);
  /* An exact zero lets Chromium optimize away the live analyser branch. At
     -160 dB this keeps Web Audio rendering while quantizing to silence at the
     physical output, so system capture cannot feed back into itself. */
  state.silentOutput.gain.value = SILENT_OUTPUT_GAIN;
  state.inputAnalyser.connect(state.visualGain);
  state.visualGain.connect(state.visualAnalyser);
  state.visualGain.connect(state.visualChannelSplitter);
  state.visualChannelSplitter.connect(state.visualLeftAnalyser, 0);
  state.visualChannelSplitter.connect(state.visualRightAnalyser, 1);
  state.visualGain.connect(state.silentOutput);
  state.silentOutput.connect(state.audioContext.destination);
  applyReactivity();

  state.audio.addEventListener("ended", () => {
    if (state.audioSourceMode === "library") void playRandomTrack();
  });
  state.audio.addEventListener("error", () => {
    if (state.audioSourceMode !== "library") return;
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

function bindLiveSlider(input, apply) {
  const run = (persist) => {
    apply(input.value);
    updateSceneControls();
    if (persist) void persistPreferences();
  };

  input.addEventListener("input", () => run(false));
  input.addEventListener("change", () => run(true));
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
  elements.audioSource.addEventListener("change", () => {
    void switchAudioSource(elements.audioSource.value);
  });
  elements.microphoneDevice.addEventListener("change", () => {
    state.microphoneDeviceId = elements.microphoneDevice.value;
    void switchAudioSource("microphone", { force: true });
  });
  elements.presetLock.addEventListener("click", togglePresetLock);
  elements.resetChaos.addEventListener("click", resetChaos);
  elements.resetDefaults.addEventListener("click", () => void restoreDefaults());
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

  /* These three are perceptual: you set them by watching the result, so they
     apply on every input and only hit the disk when the drag ends. */
  bindLiveSlider(elements.transitionDuration, (value) => {
    state.transitionSeconds = clampNumber(value, 0, 15, DEFAULT_TRANSITION_SECONDS, 1);
  });

  bindLiveSlider(elements.reactivity, (value) => {
    state.reactivity = clampNumber(value, 0.1, 3, DEFAULT_REACTIVITY, 1);
  });

  bindLiveSlider(elements.vignette, (value) => {
    state.vignettePercent = clampNumber(value, 0, 100, DEFAULT_VIGNETTE_PERCENT);
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
    if (state.interfaceMode === "hidden") {
      setStatus("interfaz oculta · pulsa O para volver", "ready", { standing: true });
    }
    applyInterfaceMode();
    void persistPreferences();
  });

  elements.shuffleScope.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-shuffle-scope]");
    if (button) setShuffleScope(button.dataset.shuffleScope);
  });

  elements.shuffleScope.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;

    event.preventDefault();
    event.stopPropagation();
    const buttons = [...elements.shuffleScope.querySelectorAll("button")];
    const current = buttons.indexOf(event.target.closest("button"));
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : -1;
    const next = buttons[(current + step + buttons.length) % buttons.length];
    next.focus();
    setShuffleScope(next.dataset.shuffleScope);
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

    /* Space activates the focused button; the arrows move inside a radio
       group. Only claim those keys when nothing else owns them. */
    const target = event.target instanceof HTMLElement ? event.target : null;
    const onButton = target?.closest("button, a[href]") != null;
    const inRadioGroup = target?.closest('[role="radiogroup"]') != null;

    if (event.key === " ") {
      if (onButton) return;
      event.preventDefault();
      void togglePlayback();
    } else if (event.key === "ArrowRight") {
      if (inRadioGroup) return;
      nextPreset();
    } else if (event.key === "ArrowLeft") {
      if (inRadioGroup) return;
      previousPreset();
    } else if (event.key.toLowerCase() === "n") {
      void playRandomTrack();
    } else if (event.key.toLowerCase() === "h") {
      void toggleFavorite();
    } else if (event.key.toLowerCase() === "z") {
      void undoFavoriteRemoval();
    } else if (event.key.toLowerCase() === "o") {
      openSettings(!elements.settingsPanel.classList.contains("is-open"));
    } else if (event.key.toLowerCase() === "f") {
      void window.pretendrop.window.toggleKiosk();
    } else if (event.key.toLowerCase() === "b") {
      toggleBlackout();
    } else if (event.key === "Escape") {
      if (elements.settingsPanel.classList.contains("is-open")) openSettings(false);
      return;
    }

    showControls();
  });

  window.addEventListener("resize", resizeVisualizer);
  navigator.mediaDevices?.addEventListener("devicechange", () => {
    void refreshMicrophoneDevices(state.microphoneDeviceId);
  });
}

function bindLibraryEvents() {
  /* Progress fires every ~180 ms. It stays in the status line, announcements
     off, so it neither floods a live region nor overwrites artist and album. */
  window.pretendrop.onLibraryProgress(({ tracks, foldersVisited }) => {
    const folders = foldersVisited
      ? ` · ${foldersVisited.toLocaleString("es-MX")} carpetas`
      : "";
    setStatus(
      `Indexando: ${tracks.toLocaleString("es-MX")} pistas${folders}`,
      "neutral",
      { standing: true, live: false },
    );
  });

  window.pretendrop.onLibraryReady(({ count, root, unreadableFolders }) => {
    elements.libraryRoot.textContent = root;
    const skipped = unreadableFolders > 0
      ? ` · ${unreadableFolders.toLocaleString("es-MX")} carpetas sin leer`
      : "";
    setStatus(
      `${count.toLocaleString("es-MX")} pistas listas${skipped}`,
      "ready",
      { standing: true },
    );
  });

  window.pretendrop.onLibraryError(({ message }) => setStatus(message, "error"));
}

async function boot() {
  try {
    bindLibraryEvents();
    await initVisualizer();
    bindControls();
    await populateDisplays();
    await initializeAudioSources();
    const root = await window.pretendrop.library.getRoot();
    elements.libraryRoot.textContent = root;
    const preferredMode = state.audioSourceMode;
    const activated = await switchAudioSource(preferredMode, {
      force: true,
      persist: false,
    });
    if (!activated && preferredMode !== "library") {
      state.audioSourceMode = "library";
      await switchAudioSource("library", { force: true });
    }
  } catch (error) {
    console.error(error);
    setStatus(error.message || "Pretendrop no pudo iniciar.", "error");
  }
}

void boot();
