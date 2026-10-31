import {Game, type GameState} from './game';
import {AssetLoadError} from './assets/loader';
import {codeToSeed} from './core/rng';
import {LEVELS, isLevelId, levelDisplayName, sectionLabel, travelTargets} from './levels/registry'; // Iteration 16 (lane RUN); + travelTargets (task track3-eaton-centre-20261031, lane GEN: three levels)
import type {LevelId} from './levels/types';
import {setMallVariantOverride} from './gen/mall/frame'; // Task track3-eaton-centre-20261031 (lane GEN): QA ?mallVariant=
import {renderControls} from './ui/hud';
import {installQaHooks} from './qa';
import {installBackendIndicator, rendererRequest} from './render/backend'; // Iteration 13 (CORE)
import {warmupNote} from './render/warmup'; // Iteration 14
import {installPerfOverlay, type PerfOverlay} from './debug/overlay';

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

async function boot(): Promise<void> {
  renderControls($('#controls-title'));
  renderControls($('#controls-pause'));
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
  if (matchMedia('(pointer: coarse)').matches && !matchMedia('(pointer: fine)').matches) {
    $('#station-intro').textContent = 'Touch devices are not supported — this slice needs a keyboard and mouse.';
  }
  const canvas = $('#view') as HTMLCanvasElement;
  const game = new Game(canvas, qa);
  if (qa) installQaHooks(game);
  (window as unknown as {__game?: Game}).__game = qa ? game : undefined;
  // Performance / debug overlay: Ctrl+Shift+P toggles it (off by default; ?perf=1 starts it shown)
  const perf = installPerfOverlay(game, {visible: params.get('perf') === '1'});
  (window as unknown as {__perf?: PerfOverlay}).__perf = qa ? perf : undefined;

  // --- menus and settings ---
  // Iteration 16 (lane RUN): the title starts a NEW RUN in the chosen level; the pause menu travels to the other level (the run
  // carries over) or starts a new game (confirmed: it resets everything); the death screen offers Retry level (the snapshot
  // taken when the level was entered) or a new game; the clear screen lets the run go on.
  $('#btn-start').addEventListener('click', () => void game.enterPlay());
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
  ['#btn-travel', '#btn-travel-2'].forEach((id, slot) => $(id).addEventListener('click', () => {
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
  $('#btn-death-retry').addEventListener('click', () => void game.retryLevel());
  $('#btn-death-new').addEventListener('click', () => void game.newGame(game.run.current.level, {enter: true}));
  ['#btn-death-new-other', '#btn-death-new-third'].forEach((id, slot) => $(id).addEventListener('click', () => {
    const to = travelTargets(game.run.current.level)[slot];
    if (to) void game.newGame(to, {enter: true});
  }));
  $('#btn-win-stay').addEventListener('click', () => game.keepExploring());
  ['#btn-win-travel', '#btn-win-travel-2'].forEach((id, slot) => $(id).addEventListener('click', () => {
    const to = travelTargets(game.run.current.level)[slot];
    if (to) travelTo(to);
  }));
  $('#btn-win-new').addEventListener('click', () => openConfirm('#confirm-win-new'));
  // menu wording follows the run (current level, the other level, what Retry restores)
  game.stateListeners.push((s: GameState) => {
    if (s !== 'paused' && s !== 'dead' && s !== 'won') return;
    closeConfirms();
    const cur = game.run.current, targets = travelTargets(cur.level), other = targets[0];
    targets.forEach((t, slot) => { for (const id of slot ? ['#btn-travel-2', '#btn-win-travel-2'] : ['#btn-travel', '#btn-win-travel']) $(id).textContent = `Travel to ${nameOf(t)}`; });
    $('#confirm-travel .to').textContent = nameOf(other);
    $('#pause-run').textContent = `This run: ${nameOf(cur.level)} · ${sectionLabel(cur)}. Travelling keeps everything you carry and your condition; only New game resets them. Nothing is saved when the page reloads.`;
    // a new game rolls fresh seeds: the static (generic) names
    $('#btn-death-new').textContent = `New game · ${LEVELS[cur.level].name}`;
    $('#btn-death-new-other').textContent = `New game · ${LEVELS[other].name}`;
    if (targets[1]) $('#btn-death-new-third').textContent = `New game · ${LEVELS[targets[1]].name}`;
    const entry = game.run.entry;
    $('#death-note').textContent = entry
      ? `Retry level puts you back where you entered ${nameOf(entry.level)}, exactly as you were then — the same kit, health, food and water, battery and injuries (no free heal or refill) — and the level as you found it. New game resets everything.`
      : 'New game resets everything.';
    $('#win-title').textContent = cur.level === 'office' ? 'Office tower clear' : cur.level === 'mall' ? `${nameOf('mall')} clear` : 'Station clear';
  });
  // task mall-playtest-revision-20261031 (lane GEN): the title's mall card names the prepared run's seeded mall
  game.stateListeners.push((s: GameState) => {
    if (s !== 'title') return;
    const b = document.querySelector('.level-card[data-level="mall"] b');
    if (b) b.textContent = nameOf('mall');
  });
  // the title's level choice (before the run starts): rebuilds the prepared run's start (same seeds) and warms it up
  const choice = document.querySelectorAll<HTMLButtonElement>('.level-card');
  const markChoice = (level: LevelId) => { for (const c of choice) c.setAttribute('aria-checked', String(c.dataset.level === level)); };
  let choosing = false;
  for (const c of choice) c.addEventListener('click', () => {
    const level = c.dataset.level;
    if (!isLevelId(level) || choosing || game.state !== 'title' || level === game.run.current.level) return;
    choosing = true;
    markChoice(level);
    void game.newGame(level, {seeds: {...game.run.seeds}}).then(w => {
      if (game.state === 'loading' || game.state === 'title') $('#title').dataset.mode = 'new-run';
      if (w && w.status !== 'cancelled' && game.state === 'loading') game.setState('title');
      markChoice(game.run.current.level); // a failed build keeps the prepared run (and its level)
    }).finally(() => { choosing = false; });
  });
  const bindRange = (id: string, key: 'sens' | 'fov' | 'volume', fmt: (v: number) => string) => {
    const input = $(id) as HTMLInputElement;
    const out = input.parentElement!.querySelector('output')!;
    const apply = () => { game.settings[key] = Number(input.value); out.textContent = fmt(Number(input.value)); game.applySettings(); };
    input.addEventListener('input', apply);
    apply();
  };
  bindRange('#set-sens', 'sens', v => v.toFixed(2));
  bindRange('#set-fov', 'fov', v => v.toFixed(0));
  bindRange('#set-vol', 'volume', v => `${Math.round(v * 100)}`);
  ($('#set-mute') as HTMLInputElement).addEventListener('change', e => { game.settings.muted = (e.target as HTMLInputElement).checked; game.applySettings(); });
  ($('#set-invert') as HTMLInputElement).addEventListener('change', e => { game.settings.invertY = (e.target as HTMLInputElement).checked; });
  ($('#set-quality') as HTMLSelectElement).addEventListener('change', e => {
    game.settings.quality = (e.target as HTMLSelectElement).value as 'low' | 'high';
    game.applySettings();
    void game.rewarmAfterSettings(); // Iteration 14: new render targets -> prepare their pipelines before Resume
  });

  // Session-only quality override (?quality=low), e.g. for slow software renderers.
  if (params.get('quality') === 'low') { game.settings.quality = 'low'; ($('#set-quality') as HTMLSelectElement).value = 'low'; game.applySettings(); }

  const loop = (time: number) => {
    const t0 = performance.now();
    try {
      game.frame(time); // task frame-budget-deferral-20261030 (lane SCHED): the rAF timestamp feeds display-rate detection
    } catch (err) {
      game.lastError = String((err as Error)?.stack ?? err);
      console.error(err);
    }
    perf.frame(time, performance.now() - t0);
    requestAnimationFrame(loop);
  };

  game.setState('loading');
  const bar = $('#load .fill'), label = $('#load .label');
  // Iteration 13 (CORE): renderer.init() (WebGPU adapter + device, else the WebGL 2 fallback) runs while the assets download;
  // game.load awaits it before the first GPU work (the item icons). A lost device stops rendering and shows the error screen.
  game.onDeviceLost = text => {
    if (game.gpu) installBackendIndicator(document, game.gpu);
    showError('The graphics device was lost — rendering stopped.', [text, 'Reload the page to restart (your browser or GPU driver reset the device).']);
    game.state = 'error';
  };
  const gpuReady = game.initRenderer().then(gpu => { installBackendIndicator(document, gpu); return gpu; });
  gpuReady.catch(() => {}); // handled below (awaited together with the asset load)
  try {
    await Promise.all([gpuReady, game.load((f, file) => { bar.style.width = `${Math.round(f * 100)}%`; label.textContent = `Loading ${file} · ${Math.round(f * 100)}%`; })]);
  } catch (err) {
    const gpuFailed = await gpuReady.then(() => null, (e: unknown) => e);
    if (gpuFailed) showError('The renderer could not start (neither WebGPU nor its WebGL 2 fallback initialized).', [String((gpuFailed as Error)?.message ?? gpuFailed), 'Enable hardware acceleration or try a current desktop Chrome, Edge or Firefox.']);
    else if (err instanceof AssetLoadError) showError('Some game files could not be loaded.', err.failures.map(f => `${f.url} — ${f.reason}`));
    else showError('The game failed to start.', [String((err as Error)?.message ?? err)]);
    game.state = 'error';
    return;
  }
  // Session-only debug/share seeds via ?seed=CODE (Subway) and ?officeSeed=CODE (Office Space); otherwise a brand-new run every
  // load. ?level=office starts the title's run in Office Space. Iteration 16 (lane RUN): boot = a NewGame (not entered yet).
  const seedOf = (k: string) => { const v = params.get(k); return v ? codeToSeed(v) ?? undefined : undefined; };
  const startLevel: LevelId = isLevelId(params.get('level')) ? params.get('level') as LevelId : 'subway';
  markChoice(startLevel);
  // Iteration 07 (Lane P2): only this section's lazy prop models are fetched (with progress) before it is built and revealed.
  // Iteration 14 (primary): its pipelines, shadow variants, fog passes, held items and effects are prepared on the loading
  // screen (render/warmup.ts) before "Start run" becomes available; partial / failed results say so.
  // (task track3-eaton-centre-20261031, lane GEN: + ?mallSeed=CODE for the mall (seeded "<Name> Center"); ?level=mall starts there; QA-only
  // ?mallVariant=galleria|oval-court|cross-galleria forces the mall's layout variant for this session)
  setMallVariantOverride(params.get('mallVariant'));
  const warm = await game.newGame(startLevel, {seeds: {subway: seedOf('seed'), office: seedOf('officeSeed'), mall: seedOf('mallSeed')},
    onProgress: (f, file) => { bar.style.width = `${Math.round(f * 100)}%`; label.textContent = `Loading station props · ${file} · ${Math.round(f * 100)}%`; }});
  if (game.state === 'error' || !warm) return; // the device was lost meanwhile (error screen already shown)
  const note = warmupNote(warm);
  label.textContent = `Ready · ${game.layout.areas.length} spaces generated${note ? ` · ${note}` : ''}`;
  bar.style.width = '100%';
  ($('#btn-start') as HTMLButtonElement).disabled = false;
  $('#title').dataset.mode = 'new-run';
  game.setState('title');
  requestAnimationFrame(loop);
}

void boot();
