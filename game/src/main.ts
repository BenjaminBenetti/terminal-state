import {Game, type GameState} from './game';
import {AssetLoadError} from './assets/loader';
import {codeToSeed} from './core/rng';
import {LEVELS, LEVEL_IDS, isLevelId, levelDisplayName, sectionLabel, travelTargets} from './levels/registry'; // Iteration 16 (lane RUN); + travelTargets (task track3-eaton-centre-20261031, lane GEN: three levels)
import type {LevelId} from './levels/types';
import {setMallVariantOverride} from './gen/mall/frame'; // Task track3-eaton-centre-20261031 (lane GEN): QA ?mallVariant=
import {CONTROLS, renderControls} from './ui/hud'; // (+ CONTROLS: the main menu's Controls view, task studio-beta-campaign-polish-20261103-063841-01 lane MENU)
import {installQaHooks} from './qa';
import {installBackendIndicator, rendererRequest} from './render/backend'; // Iteration 13 (CORE)
import {installPerfOverlay, type PerfOverlay} from './debug/overlay';
import {installPerfRecorder} from './debug/perfRecorderUi'; // task studio-performance-recorder-20261103-043629 (lane RECORDER): the player's performance recorder
import {milestoneBadge, readMilestones} from './run/milestones'; // task reactor-build-20261101 (lane RESTART): the title's earned badge
// task campaign-foundation-20261102 (lane MENU): the main menu, its diorama and the persisted settings
import {MainMenuController, MainMenuView, bootLine, mountControlsForm, mountSettingsForm, mountTutorialReset, type DevStart, type MenuHost, type SlotView} from './ui/mainMenu';
import {SettingsStore, browserSettingsStorage, copySettingsInto} from './ui/settingsStore';
import {isEnhancedLightingMode, isReflectionQuality} from './world/enhancedLighting'; // task studio-baked-lighting-reflections-20261114-050258-01 (lane SETTINGS): ?lighting= / ?reflections=
import {MENU_TRAIN_KEYS, MenuScene, type MenuRenderer, type MenuSceneAssets} from './world/menuScene';
import {OFFICE_ASSETS, loadOfficeAsset, loadOfficeTexture, type OfficeAssetId} from './assets/officeAssets';
import {setSkylineTexture} from './world/exterior';
import {ATMOSPHERE_QUALITY} from './render/atmosphere'; // (lane MENU, campaign polish item 7: the quality setting's real numbers in its help line)
import {installTooltips, setTip} from './ui/tooltip'; // task studio-ui-subway-maps-20261108-074144-01
import {coverUntilPlayDrawn, lastSaveNote} from './ui/loadingScreen'; // (lane MENU, DEATH: the death screen's last-save line; + the loading screen's hand-off to play)
import {LoadingMapView} from './ui/loadingMap'; // task studio-initial-loading-subway-graphic-20261111-070741-01: the loading screen's map

const $ = (sel: string) => document.querySelector(sel) as HTMLElement;
const params = new URLSearchParams(location.search);
const qa = params.get('qa') === '1';

function showError(msg: string, items: string[] = []): void {
  for (const id of ['title', 'pause', 'inventory', 'death', 'win']) $('#' + id).classList.add('hidden');
  $('#error').classList.remove('hidden');
  $('#error-msg').textContent = msg;
  $('#error-list').innerHTML = items.map(i => `<li>${i.replace(/[<>&]/g, '')}</li>`).join('');
}

function webgl2(): boolean {
  try {
    return !!document.createElement('canvas').getContext('webgl2');
  } catch {
    return false;
  }
}

// ==== task campaign-foundation-20261102 (lane MENU): boot -> menu ==================================================================
// Every load shows the MAIN MENU (dev deep links included). Boot = the renderer + the menu's diorama (only what the menu needs, a
// small indicator) -> the menu; the heavy game boot assets (game.load: guns, items, icons) load in the background meanwhile (an
// unobtrusive line at the foot of the menu; New game / Continue wait for them). No level is built before New game / Continue.
//
// QA automation (?qa=1): by default the menu stays hidden behind the loading card while a SCRATCH run of the URL's level / seeds is
// prepared exactly as the old boot did (never saved, no slot); then state 'title' + __LL.ready(), and #btn-start ("QA quick start",
// the menu's first item) enters it — the 26 scripts that wait for that and click #btn-start keep working. ?qa=1&qaPrebuild=0 shows the
// real menu (diorama, settings, slots) with QA hooks; there #btn-start builds the scratch run on click (__LL.ready() only after it).

/** The URL's developer start (?level= / ?seed= / ?officeSeed= / ?mallSeed= / ?marketSeed= / ?bunkerSeed= / ?reactorSeed=; ?qa=1 always offers it). */
function devStartFromUrl(p: URLSearchParams, qaMode: boolean): DevStart | null {
  const seedOf = (k: string) => { const v = p.get(k); return v ? codeToSeed(v) ?? undefined : undefined; };
  const seeds: Partial<Record<LevelId, number>> = {};
  for (const [l, k] of [['subway', 'seed'], ['office', 'officeSeed'], ['mall', 'mallSeed'], ['market', 'marketSeed'], ['bunker', 'bunkerSeed'], ['skyways', 'skywaysSeed'], ['reactor', 'reactorSeed']] as const) { const s = seedOf(k); if (s !== undefined) seeds[l] = s; }
  const level = p.get('level');
  const any = qaMode || isLevelId(level) || Object.keys(seeds).length > 0 || p.has('mallVariant');
  return any ? {level: isLevelId(level) ? level : 'subway', seeds} : null;
}

/**
 * Task studio-alpha-campaign-foundation-20261102-230708-01 (primary): THE menu host — the 3 localStorage slots (lane SAVE's SaveSlots,
 * slots 1..3; the menu's 0-based slot n is save slot n + 1), New game = a fresh campaign network into the chosen slot (the menu has
 * already confirmed an overwrite), Continue / Load = Game.continueCampaign, Export = a .json download, Import = a validated replace
 * into the chosen slot (the menu has already confirmed it), Delete = that slot only.
 */
function campaignMenuHost(game: Game, ready: () => boolean): MenuHost {
  const fail = (e: string): never => { throw new Error(e); };
  return {
    listSlots: (): SlotView[] => game.saves.list().map(v => ({slot: v.slot - 1, empty: v.empty, valid: v.valid, ...(v.meta ? {meta: v.meta} : {}), ...(v.error ? {error: v.error} : {})})),
    lastSlot: () => { const n = game.saves.lastSlot(); return n === null ? null : n - 1; },
    newGame: async (slot, dev) => {
      if (!ready()) fail('the game files are still loading');
      const r = await game.newCampaign(slot + 1, {overwrite: true, dev: dev ? {level: dev.level} : undefined});
      if (!r.ok) fail(r.error);
    },
    continueGame: async slot => {
      if (!ready()) fail('the game files are still loading');
      const r = await game.continueCampaign(slot === undefined ? undefined : slot + 1);
      if (!r.ok) fail(r.error);
    },
    exportSlot: slot => {
      const r = game.saves.exportFile(slot + 1);
      if (!r.ok) fail(r.error);
      const e = r as {filename: string; blob: Blob};
      const url = URL.createObjectURL(e.blob), a = document.createElement('a');
      a.href = url; a.download = e.filename; a.rel = 'noopener';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    },
    importFile: async (slot, file) => {
      const r = await game.saves.importFile(slot + 1, file, {confirmReplace: true});
      if (!r.ok) return {ok: false, error: r.error};
      if (game.currentSlot === slot + 1) game.currentSlot = null; // the replaced slot no longer belongs to the run in memory
      return {ok: true};
    },
    deleteSlot: slot => {
      const r = game.saves.delete(slot + 1);
      if (!r.ok) fail(r.error);
      if (game.currentSlot === slot + 1) game.currentSlot = null;
    },
  };
}

/** A file chooser opened inside the click (user gesture); null when cancelled. */
function pickJsonFile(): Promise<File | null> {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.addEventListener('change', () => resolve(input.files?.[0] ?? null), {once: true});
    input.addEventListener('cancel', () => resolve(null), {once: true});
    input.click();
  });
}

const EXT_IDS: Record<'tower' | 'midrise' | 'car' | 'bus' | 'rubble', OfficeAssetId> = {tower: 'ruined-tower', midrise: 'ruined-midrise', car: 'car-wreck', bus: 'bus-wreck', rubble: 'rubble-pile'};

/** The diorama's models: the train shell + door leaf (prop library) and the exterior's Meshy pieces + skyline (office caches). Never rejects. */
async function loadMenuAssets(game: Game, progress: (f: number) => void): Promise<MenuSceneAssets> {
  const trainKeys = [MENU_TRAIN_KEYS.shell, MENU_TRAIN_KEYS.door];
  const files = game.propModels.catalogue;
  const total = trainKeys.reduce((s, k) => s + (files[k]?.bytes ?? 0), 0) + Object.values(EXT_IDS).reduce((s, id) => s + (OFFICE_ASSETS[id].bytes ?? 0), 0);
  let done = 0, train = 0;
  const tick = () => progress(Math.min(1, (done + train) / Math.max(1, total)));
  const ext = {} as Record<keyof typeof EXT_IDS, Awaited<ReturnType<typeof loadOfficeAsset>>>;
  await Promise.all([
    game.propModels.ensure(trainKeys, f => { train = f * trainKeys.reduce((s, k) => s + (files[k]?.bytes ?? 0), 0); tick(); }),
    ...(Object.entries(EXT_IDS) as [keyof typeof EXT_IDS, OfficeAssetId][]).map(([k, id]) => loadOfficeAsset(id).then(g => { ext[k] = g; done += OFFICE_ASSETS[id].bytes ?? 0; tick(); })),
    loadOfficeTexture('skyline').then(t => { if (t) setSkylineTexture(t); }),
  ]);
  return {shell: game.propModels.get(trainKeys[0]) ?? null, door: game.propModels.get(trainKeys[1]) ?? null, exterior: ext};
}
// ==== end lane MENU (helpers) ==========================================================================================================

async function boot(): Promise<void> {
  renderControls($('#controls-pause')); // (the main menu's Controls view renders the same CONTROLS: lane MENU, campaign polish item 5)
  $('#btn-retry').addEventListener('click', () => location.reload());
  if (location.protocol === 'file:') {
    showError('This page was opened directly from disk.', ['Serve the folder over HTTP, e.g. `npx vite preview` or any static web server.']);
    return;
  }
  // Iteration 13 (CORE): the renderer needs WebGPU (navigator.gpu + an adapter) or, as its fallback, WebGL 2.
  const req = rendererRequest(location.search, navigator as {gpu?: unknown}, isSecureContext);
  if ((req.forceWebGL || !req.webgpuApi) && !webgl2()) {
    showError(req.forceWebGL ? 'WebGL 2 is not available in this browser (?renderer=webgl2 forces the WebGL 2 backend).' : 'Neither WebGPU nor WebGL 2 is available in this browser.',
      ['Enable hardware acceleration or try a current desktop Chrome, Edge or Firefox.']);
    return;
  }
  const canvas = $('#view') as HTMLCanvasElement;
  installTooltips(); // (task studio-ui-subway-maps-20261108-074144-01) the game's own tooltip: menus use it instead of native titles
  const game = new Game(canvas, qa);
  if (qa) installQaHooks(game);
  (window as unknown as {__game?: Game}).__game = qa ? game : undefined;
  // Performance / debug overlay: Ctrl+Shift+P toggles it (off by default; ?perf=1 starts it shown)
  const perf = installPerfOverlay(game, {visible: params.get('perf') === '1'});
  (window as unknown as {__perf?: PerfOverlay}).__perf = qa ? perf : undefined;
  // Lane RECORDER: Pause / main-menu Settings -> Performance (Start / Stop & Download / Download last), F8 start / stop, F9 mark; QA __LL.perfRecorder()
  const recorder = installPerfRecorder(game, {overlay: perf, qa});
  recorder.mountPanel(document.querySelector<HTMLElement>('#pause .panel'), {idPrefix: 'pause-', before: document.getElementById('controls-pause')});

  // --- settings (lane MENU): ONE persisted store for the menu, the pause menu and the game ---
  const settings = new SettingsStore(browserSettingsStorage());
  // Session-only quality override (?quality=low), e.g. for slow software renderers: applied, never persisted.
  if (params.get('quality') === 'low') settings.sessionOverride({quality: 'low'});
  // (task studio-baked-lighting-reflections-20261114-050258-01, lane SETTINGS) session-only ?lighting=off|auto|on and
  // ?reflections=off|standard|high (QA / comparisons): applied on top of the stored choices, never persisted; any other value is ignored
  const urlLighting = params.get('lighting'), urlReflections = params.get('reflections');
  if (isEnhancedLightingMode(urlLighting)) settings.sessionOverride({enhancedLighting: urlLighting});
  if (isReflectionQuality(urlReflections)) settings.sessionOverride({reflections: urlReflections});
  copySettingsInto(game.settings, settings.get());
  game.applySettings();
  settings.subscribe((s, changed) => {
    const {qualityChanged} = copySettingsInto(game.settings, s);
    // only what changed: a resize (canvas re-size) for the view settings, the audio gain for volume / mute, nothing for the mouse
    if (changed.some(k => k === 'quality' || k === 'renderScale' || k === 'fov')) game.applySettings();
    else if (changed.includes('ambientOcclusion')) game.applySettings(); // (lane AO: the atmosphere's AO gate; applies volume / mute too)
    else if (changed.some(k => k === 'volume' || k === 'muted')) { game.sfx.setVolume(s.volume); game.sfx.setMuted(s.muted); }
    if (qualityChanged) void game.rewarmAfterSettings(); // Iteration 14: new render targets -> prepare their pipelines before Resume
  });
  game.onSettingsChanged = key => { if (key === 'muted') settings.set({muted: game.settings.muted}); }; // the M key
  window.addEventListener('storage', e => { if (e.key === settings.key) settings.reload(); }); // another tab changed them
  // (task studio-perf-ao-train-continuity-20261110-022206-01, lane AO: the AO line says when the atmosphere pass cannot run it)
  const aoUnavailable = () => game.atmosphere.aoUnavailable();
  // (task studio-baked-lighting-reflections-20261114-050258-01, lane SETTINGS: both forms show enhanced lighting's truthful status — what
  // the live station was built with, a pending change — and the derived cache's numbers, and re-read them when the runtime says they
  // changed. The two settings are only copied into game.settings (the subscription above, which runs before the forms' own): the game
  // reads them when a station is built, so there is nothing to apply and no re-warm.)
  const lightingStatus = () => game.enhancedLighting.status();
  const lightingCache = () => game.enhancedLighting.cacheStats();
  const clearLightingCache = () => game.enhancedLighting.clearCache();
  const lightingChanged = (refresh: () => void) => game.enhancedLighting.subscribe(refresh);
  mountSettingsForm($('#pause-settings'), settings, {idPrefix: 'set-', lightingStatus, lightingCache, clearLightingCache, lightingChanged, qualityPresets: ATMOSPHERE_QUALITY, aoUnavailable});
  // task studio-first-player-onboarding-20261111-234657-01: "Reset tutorials" under the pause menu's Settings (and the main menu's, below):
  // clears only the browser-global tutorial record; the current / next parked train shows its guide markers again
  mountTutorialReset($('#pause-settings'), game.onboarding, {idPrefix: 'set-'});
  window.addEventListener('storage', e => { if (e.key === null || e.key === game.onboarding.key) game.onboarding.reload(); }); // another tab
  // (task studio-alpha-survival-controls-20261107-060450-01) the input preferences live under Controls: the same store, ids set-*
  mountControlsForm($('#pause-controls-form'), settings, {idPrefix: 'set-'});

  // --- menus and settings ---
  // Iteration 16 (lane RUN): the pause menu travels to the other level (the run carries over) or starts a new game (confirmed: it
  // resets everything); the death screen offers Load last save (task studio-beta-campaign-polish-20261103-063841-01, lane MENU: the
  // active slot's persisted save; was Retry level from the in-memory level-entry snapshot) or a new game; the clear screen lets the
  // run go on. (lane MENU: new runs from the main menu go through its slot choice.)
  $('#btn-resume').addEventListener('click', () => void game.enterPlay());
  const confirms = ['#confirm-travel', '#confirm-new', '#confirm-win-new'];
  const closeConfirms = () => { for (const c of confirms) $(c).classList.add('hidden'); };
  const openConfirm = (id: string) => { closeConfirms(); $(id).classList.remove('hidden'); };
  for (const b of document.querySelectorAll<HTMLButtonElement>('.confirm .btn-cancel')) b.addEventListener('click', closeConfirms);
  // task mall-playtest-revision-20261031 (lane GEN): run-aware display names (the mall's seeded "<Name> Center")
  const nameOf = (l: LevelId) => levelDisplayName(l, game.run?.seeds?.[l]);
  // Task track3-eaton-centre-20261031 (lane GEN): every other level is a travel target (slot 0 = the old "other level").
  const travelTo = (to: LevelId) => {
    closeConfirms();
    void game.travel({to: {level: to, section: LEVELS[to].entry}, arrival: {kind: 'start'}, label: `Travelling to ${nameOf(to)}`, via: 'menu'});
  };
  let travelTarget: LevelId | null = null;
  ['#btn-travel', '#btn-travel-2', '#btn-travel-3', '#btn-travel-4'].forEach((id, slot) => $(id).addEventListener('click', () => { // (+ slot 3: task reactor-build-20261101; + slot 4: skyways)
    travelTarget = travelTargets(game.run.current.level)[slot] ?? null;
    if (!travelTarget) return;
    $('#confirm-travel .to').textContent = nameOf(travelTarget);
    openConfirm('#confirm-travel');
  }));
  $('#btn-travel-go').addEventListener('click', () => { if (travelTarget) travelTo(travelTarget); });
  $('#btn-new-game').addEventListener('click', () => openConfirm('#confirm-new'));
  for (const b of document.querySelectorAll<HTMLButtonElement>('.btn-new-level')) {
    b.addEventListener('click', () => { const l = b.dataset.level; closeConfirms(); if (isLevelId(l)) void game.newGame(l, {enter: true}); });
  }
  // task studio-beta-campaign-polish-20261103-063841-01 (lane MENU, DEATH): "Load last save" = the ACTIVE slot's latest valid persisted
  // save through the main menu's Continue path (Game.loadLastSave -> continueCampaign). Nothing is saved or erased on death; with no
  // valid save the button is disabled and the note says why (Main menu / the legacy New game buttons remain).
  const deathLoad = $('#btn-death-load') as HTMLButtonElement, deathNote = () => $('#death-note');
  const showLastSave = () => {
    const st = game.lastSaveStatus();
    deathLoad.disabled = !st.ok;
    setTip(deathLoad, st.ok ? null : {head: 'No save to load', hint: st.message}); // (task studio-ui-subway-maps-20261108-074144-01: the game tooltip)
    deathNote().textContent = lastSaveNote(st, iso => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(); });
  };
  deathLoad.addEventListener('click', () => {
    if (deathLoad.disabled || game.state !== 'dead') return;
    deathLoad.disabled = true;
    deathNote().textContent = 'Loading the last save…';
    void game.loadLastSave().then(r => {
      if (r.ok || game.state !== 'dead') return;
      showLastSave();
      deathNote().textContent = `Could not load the save: ${r.error.slice(0, 160)}`;
    });
  });
  $('#btn-death-new').addEventListener('click', () => void game.newGame(game.run.current.level, {enter: true}));
  ['#btn-death-new-other', '#btn-death-new-third', '#btn-death-new-fourth', '#btn-death-new-fifth'].forEach((id, slot) => $(id).addEventListener('click', () => {
    const to = travelTargets(game.run.current.level)[slot];
    if (to) void game.newGame(to, {enter: true});
  }));
  $('#btn-win-stay').addEventListener('click', () => game.keepExploring());
  ['#btn-win-travel', '#btn-win-travel-2', '#btn-win-travel-3', '#btn-win-travel-4'].forEach((id, slot) => $(id).addEventListener('click', () => {
    const to = travelTargets(game.run.current.level)[slot];
    if (to) travelTo(to);
  }));
  $('#btn-win-new').addEventListener('click', () => openConfirm('#confirm-win-new'));
  // menu wording follows the run (current level, the other level, what Load last save restores)
  game.stateListeners.push((s: GameState) => {
    if (s !== 'paused' && s !== 'dead' && s !== 'won') return;
    closeConfirms();
    const cur = game.run.current, targets = travelTargets(cur.level), other = targets[0];
    targets.forEach((t, slot) => { for (const id of [['#btn-travel', '#btn-win-travel'], ['#btn-travel-2', '#btn-win-travel-2'], ['#btn-travel-3', '#btn-win-travel-3'], ['#btn-travel-4', '#btn-win-travel-4']][slot] ?? []) $(id).textContent = `Travel to ${nameOf(t)}`; }); // (+ slot 3: task reactor-build-20261101; + slot 4)
    $('#confirm-travel .to').textContent = nameOf(other);
    // (lane MENU, campaign polish item 2: one short line, and no "nothing is saved" claim for a campaign run — it autosaves)
    const here = cur.station ? game.run.node(cur.station)?.name : undefined;
    $('#pause-run').textContent = here ? `This run: ${here}` : `This run: ${nameOf(cur.level)} · ${sectionLabel(cur)} (not saved)`;
    // a new game rolls fresh seeds: the static (generic) names
    $('#btn-death-new').textContent = `New game · ${LEVELS[cur.level].name}`;
    $('#btn-death-new-other').textContent = `New game · ${LEVELS[other].name}`;
    if (targets[1]) $('#btn-death-new-third').textContent = `New game · ${LEVELS[targets[1]].name}`;
    if (targets[2]) $('#btn-death-new-fourth').textContent = `New game · ${LEVELS[targets[2]].name}`;
    if (targets[3]) $('#btn-death-new-fifth').textContent = `New game · ${LEVELS[targets[3]].name}`;
    if (s === 'dead') showLastSave();
    $('#win-title').textContent = cur.level === 'office' ? 'Office tower clear' : cur.level === 'mall' ? `${nameOf('mall')} clear` : cur.level === 'reactor' ? 'Reactor pit clear' : cur.level === 'skyways' ? 'Skyways clear' : cur.level === 'market' ? `${nameOf('market')}` : cur.level === 'bunker' ? `${nameOf('bunker')} clear` : 'Station clear'; // (+ the bunker's: task studio-bunker-level-20261109-072224-01)
  });
  // task reactor-build-20261101 (lane RESTART): the title shows the persistent local "Reactor restarted" milestone once earned
  game.stateListeners.push((st: GameState) => { if (st !== 'title') return; const el = $('#milestone-badge'), t = milestoneBadge(readMilestones()); if (el) { el.textContent = t; el.hidden = !t; } });

  const loop = (time: number) => {
    const t0 = performance.now();
    try {
      game.frame(time); // task frame-budget-deferral-20261030 (lane SCHED): the rAF timestamp feeds display-rate detection
    } catch (err) {
      game.lastError = String((err as Error)?.stack ?? err);
      console.error(err);
    }
    const cpuMs = performance.now() - t0;
    perf.frame(time, cpuMs);
    recorder.frame(time, cpuMs, t0); // lane RECORDER: the same frame values + the callback start (off: one boolean check)
    requestAnimationFrame(loop);
  };

  // ==== task campaign-foundation-20261102 (lane MENU): the main menu =============================================================
  // (task track3-eaton-centre-20261031, lane GEN: QA-only ?mallVariant=galleria|oval-court|cross-galleria forces the mall's layout
  // variant for this session)
  setMallVariantOverride(params.get('mallVariant'));
  const qaPrebuild = qa && params.get('qaPrebuild') !== '0';
  const dev = devStartFromUrl(params, qa);
  const titleEl = $('#title'), qaButton = $('#btn-start') as HTMLButtonElement;
  let qaReady = false, booted = false;
  // a run outside the slots (the session host's New game, the QA scratch run): a click -> pointer lock / audio inside the gesture
  const startRun = (level: LevelId, seeds: Partial<Record<LevelId, number>>): Promise<void> => {
    if (!booted) return Promise.reject(new Error('the game files are still loading'));
    return game.newGame(level, {seeds, enter: true}).then(w => {
      if (!w) throw new Error('another start is already in progress');
      if (w.status === 'cancelled') throw new Error('the graphics device was lost');
    });
  };
  const host: MenuHost = campaignMenuHost(game, () => booted); // (primary: the 3 persistent slots; sessionMenuHost kept for tests / QA)
  const menu = new MainMenuController(host, {
    dev, devLevels: LEVEL_IDS, levelName: l => LEVELS[l].name, pickFile: pickJsonFile, controls: CONTROLS,
    qa: qa ? {label: qaPrebuild ? `QA quick start · ${LEVELS[dev?.level ?? 'subway'].name} (scratch, not saved)` : 'QA quick start (scratch build, not saved)', start: () => qaButton.click(), ready: () => qaReady || !qaPrebuild} : null,
  });
  const menuView = new MainMenuView($('#mm-view'), menu, {
    settings: box => { mountSettingsForm(box, settings, {idPrefix: 'mm-set-', lightingStatus, lightingCache, clearLightingCache, lightingChanged, qualityPresets: ATMOSPHERE_QUALITY, aoUnavailable}); mountTutorialReset(box, game.onboarding, {idPrefix: 'mm-set-'}); recorder.mountPanel(box, {idPrefix: 'mm-'}); }, // (+ the tutorial reset; lane RECORDER's Performance section; lane MENU: the quality help line; lane SETTINGS: the lighting status / cache)
    controlsForm: box => { mountControlsForm(box, settings, {idPrefix: 'mm-set-'}); }, // (task studio-alpha-survival-controls-20261107-060450-01: input preferences under Controls)
    qaButton: qa ? qaButton : null,
    overlayHost: titleEl, // (lane MENU, campaign polish item 4: submenus open front and centre over the diorama)
  });
  qaButton.addEventListener('click', () => {
    if (qaPrebuild) { if (game.world) void game.enterPlay(); return; }
    void startRun(dev?.level ?? 'subway', dev?.seeds ?? {}).catch(err => console.warn('QA quick start failed', err));
  });
  const bootUi = bootLine($('#mm-boot'));
  // task studio-initial-loading-subway-graphic-20261111-070741-01: the loading screen's decorative map, fed by the game's load stages
  game.loadMeter = new LoadingMapView($('#loading-map'));
  let menuScene: MenuScene | null = null, menuAudio = false, lastAmbience = 0;
  const disposeMenuScene = () => {
    game.menuRender = null;
    menuScene?.dispose();
    menuScene = null;
  };
  game.stateListeners.push((s: GameState, prev: GameState) => {
    menuView.visible = s === 'title';
    // (lane MENU, campaign polish: back from a game the menu opens on its main list, not on the submenu the run was started from;
    // a failed start (loading -> title) keeps its view and its error line)
    if (s === 'title') { titleEl.dataset.mode = 'menu'; if (prev !== 'title' && prev !== 'loading') menu.home(); else menu.refresh(); }
    // leaving the menu for a level build: the diorama goes first (its shared exterior uniforms restored before any level exterior)
    if (s === 'loading' && prev === 'title') disposeMenuScene();
    // (task studio-initial-loading-subway-graphic-20261111-070741-01) a load ends in play: the loading screen stays until a frame of play is drawn
    if (s === 'playing' && prev === 'loading') coverUntilPlayDrawn(titleEl, () => game.state === 'playing', fn => requestAnimationFrame(fn));
  });
  // menu ambience: an existing bed loop (the track bed: wind + rumble, distant trains) at the master volume, after a user gesture
  const startMenuAudio = () => {
    if (game.state !== 'title') return;
    game.sfx.init();
    game.sfx.setVolume(game.settings.volume);
    game.sfx.setMuted(game.settings.muted);
    if (!menuAudio) game.sfx.setRoom('large', 'track');
    menuAudio = true;
  };
  window.addEventListener('pointerdown', startMenuAudio, true);
  window.addEventListener('keydown', startMenuAudio, true);
  (window as unknown as {__menu?: unknown}).__menu = qa ? {controller: menu, scene: () => menuScene, stats: () => menuScene?.stats() ?? null, frames: () => menuScene?.frames ?? 0} : undefined;

  game.onDeviceLost = text => {
    if (game.gpu) installBackendIndicator(document, game.gpu);
    showError('The graphics device was lost — rendering stopped.', [text, 'Reload the page to restart (your browser or GPU driver reset the device).']);
    game.state = 'error';
  };
  // ==== task studio-alpha-campaign-foundation-20261102-230708-01 (primary): campaign runs in the pause / death screens ============
  // A campaign run travels only by its train (the console's map): the legacy level travel + per-level new-game buttons are hidden; a
  // "Main menu" button returns to the menu after a confirmation that says what the last autosave holds (nothing after it is saved).
  const mainMenuButton = (parentSel: string, id: string): HTMLButtonElement => {
    const b = document.createElement('button');
    b.id = id; b.type = 'button'; b.textContent = 'Main menu';
    document.querySelector(`${parentSel} .actions`)?.appendChild(b);
    return b;
  };
  // (task refinement-batch, lane SAVE: the slot's latest save may be the player's own — the train's Save terminal — so "Last save", with
  // its real reason; the game autosaves at every departure / arrival and saves on demand at the Save terminal)
  const autosaveNote = (): string => {
    const slot = game.currentSlot;
    const v = slot ? game.saves.list().find(x => x.slot === slot) : undefined;
    if (!slot || !v?.meta) return 'This run has no save yet — leaving now loses it.';
    const at = new Date(v.meta.savedAt), when = isNaN(at.getTime()) ? v.meta.savedAt : at.toLocaleString();
    const why = v.meta.reason === 'manual' ? 'saved at the Save terminal' : v.meta.reason === 'new-game' ? 'new game' : v.meta.reason;
    return `Last save (slot ${slot}): ${when}, at ${v.meta.station} (${why}). Progress since then is NOT saved — the game autosaves at every train departure and arrival, and the Save terminal left of the train's driving desk saves any time the train is stopped.`;
  };
  const toMenu = (b: HTMLButtonElement) => b.addEventListener('click', () => {
    if (!game.run.campaign) { game.setState('title'); return; }
    if (b.dataset.armed !== '1') { b.dataset.armed = '1'; b.textContent = 'Confirm: back to the main menu'; setTip(b, {head: 'Back to the main menu', hint: autosaveNote()}); const n = document.querySelector('#pause .fine'); if (n && game.state === 'paused') n.textContent = autosaveNote(); return; }
    b.dataset.armed = ''; b.textContent = 'Main menu';
    game.returnToMenu(); // (trainRide.reset + the title; lane CREDITS' end card takes the same path after its save)
  });
  toMenu(mainMenuButton('#pause', 'btn-main-menu'));
  toMenu(mainMenuButton('#death', 'btn-death-menu'));
  const legacyRunUi = ['#btn-travel', '#btn-travel-2', '#btn-travel-3', '#btn-travel-4', '#btn-new-game', '#btn-death-new', '#btn-death-new-other', '#btn-death-new-third', '#btn-death-new-fourth', '#btn-death-new-fifth',
    '#btn-win-travel', '#btn-win-travel-2', '#btn-win-travel-3', '#btn-win-travel-4', '#btn-win-new'];
  game.stateListeners.push((s: GameState) => {
    const campaign = !!game.run.campaign;
    for (const id of legacyRunUi) document.querySelector(id)?.classList.toggle('hidden', campaign);
    if (s !== 'paused') { const b = document.getElementById('btn-main-menu'); if (b) { b.dataset.armed = ''; b.textContent = 'Main menu'; } }
  });

  if (qaPrebuild) game.setState('loading'); // (QA: the loading card until the scratch run is ready, as the old boot)
  else { titleEl.dataset.mode = 'menu'; game.setState('title'); }
  requestAnimationFrame(loop);
  // Iteration 13 (CORE): renderer.init() (WebGPU adapter + device, else the WebGL 2 fallback); game.load awaits it before the first
  // GPU work (the item icons). A lost device stops rendering and shows the error screen.
  const gpuReady = game.initRenderer().then(gpu => { installBackendIndicator(document, gpu); return gpu; });
  gpuReady.catch(() => {}); // handled below
  const fatal = async (err: unknown) => {
    const gpuFailed = await gpuReady.then(() => null, (e: unknown) => e);
    if (gpuFailed) showError('The renderer could not start (neither WebGPU nor its WebGL 2 fallback initialized).', [String((gpuFailed as Error)?.message ?? gpuFailed), 'Enable hardware acceleration or try a current desktop Chrome, Edge or Firefox.']);
    else if (err instanceof AssetLoadError) showError('Some game files could not be loaded.', err.failures.map(f => `${f.url} — ${f.reason}`));
    else showError('The game failed to start.', [String((err as Error)?.message ?? err)]);
    game.state = 'error';
  };
  try { await gpuReady; } catch (err) { await fatal(err); return; }

  // 1. the diorama (only what the menu needs; a small indicator; failures leave the plain backdrop). The game files start after
  // it, or after MENU_FIRST_MS on a slow connection (the two then share the network; both are safe to interleave: the menu frame
  // leaves the renderer's target / exposure as it found them)
  const MENU_FIRST_MS = 4000;
  let sceneBusy = !qaPrebuild && !(qa && params.get('menuScene') === '0');
  // (primary, QA only: ?qa=1&menuScene=0 skips the diorama — software-GL browser checks of the campaign loop stay under the memory guard)
  const menuSceneOff = qa && params.get('menuScene') === '0';
  const menuTask = qaPrebuild || menuSceneOff ? Promise.resolve() : (async () => {
    try {
      bootUi(0, 'Preparing the scene…', false);
      const assets = await loadMenuAssets(game, f => { if (sceneBusy) bootUi(f, `Preparing the scene · ${Math.round(f * 100)} %`, false); });
      if (game.state === 'title' && !game.world) {
        const scene = new MenuScene(assets);
        await scene.compile(game.renderer); // every diorama pipeline before it is shown (no cold compile on screen)
        if (game.state === 'title' && !game.world) {
          menuScene = scene;
          game.menuRender = t => {
            const s = menuScene;
            if (!s) return false;
            const drew = s.render(game.renderer as unknown as MenuRenderer, t);
            if (drew && menuAudio) { const dt = lastAmbience ? Math.min(0.25, (t - lastAmbience) / 1000) : 0; lastAmbience = t; game.sfx.ambience(dt); }
            return drew;
          };
          requestAnimationFrame(() => $('#title-backdrop').classList.add('faded'));
        } else scene.dispose();
      }
    } catch (err) {
      console.warn('main menu: the diorama could not be built (plain backdrop kept)', err);
    } finally {
      sceneBusy = false;
    }
  })();
  await Promise.race([menuTask, new Promise(r => setTimeout(r, MENU_FIRST_MS))]);
  sceneBusy = false; // from here the line reports the game files

  // 2. the heavy game boot assets in the background (New game / Continue wait for them)
  try {
    bootUi(0, 'Loading game files…', false);
    menu.setBoot(false, 0);
    await game.load((f, file) => { bootUi(f, `Loading game files · ${Math.round(f * 100)} %`, false); menu.setBoot(false, f); if (qaPrebuild) $('#load .label').textContent = `Loading ${file} · ${Math.round(f * 100)}%`; });
  } catch (err) {
    await fatal(err);
    return;
  }
  if (game.state === 'error') return;
  booted = true;
  bootUi(1, 'Ready', true);
  menu.setBoot(true, 1);

  // 3. QA: the scratch run of the URL's level / seeds, prepared like the old boot (state 'title' + __LL.ready() when done)
  if (qaPrebuild) {
    const d = dev ?? {level: 'subway' as LevelId, seeds: {}};
    // Iteration 07 (Lane P2) / 14: the level's lazy prop models are fetched with progress, then its pipelines are prepared on the
    // loading screen before #btn-start becomes available; partial / failed results say so.
    const warm = await game.newGame(d.level, {seeds: d.seeds});
    if ((game.state as GameState) === 'error' || !warm) return; // the device was lost meanwhile (error screen already shown)
    qaReady = true;
    qaButton.disabled = false;
    game.setState('title');
  }
  // ==== end lane MENU ============================================================================================================
}

void boot();
