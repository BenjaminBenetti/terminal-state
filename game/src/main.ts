import {Game} from './game';
import {AssetLoadError} from './assets/loader';
import {codeToSeed, freshSeed} from './core/rng';
import {renderControls} from './ui/hud';
import {installQaHooks} from './qa';

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
  if (!webgl2()) {
    showError('WebGL 2 is not available in this browser.', ['Enable hardware acceleration or try a current desktop Chrome, Edge or Firefox.']);
    return;
  }
  if (matchMedia('(pointer: coarse)').matches && !matchMedia('(pointer: fine)').matches) {
    $('#station-intro').textContent = 'Touch devices are not supported — this slice needs a keyboard and mouse.';
  }
  const canvas = $('#view') as HTMLCanvasElement;
  const game = new Game(canvas, qa);
  if (qa) installQaHooks(game);
  (window as unknown as {__game?: Game}).__game = qa ? game : undefined;

  // --- menus and settings ---
  $('#btn-start').addEventListener('click', () => void game.enterPlay());
  $('#btn-resume').addEventListener('click', () => void game.enterPlay());
  $('#btn-new-station').addEventListener('click', () => game.restart(false));
  $('#btn-death-new').addEventListener('click', () => game.restart(false));
  $('#btn-death-retry').addEventListener('click', () => game.restart(true));
  $('#btn-win-new').addEventListener('click', () => game.restart(false));
  $('#btn-win-stay').addEventListener('click', () => game.keepExploring());
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
  ($('#set-quality') as HTMLSelectElement).addEventListener('change', e => { game.settings.quality = (e.target as HTMLSelectElement).value as 'low' | 'high'; game.applySettings(); });

  // Session-only quality override (?quality=low), e.g. for slow software renderers.
  if (params.get('quality') === 'low') { game.settings.quality = 'low'; ($('#set-quality') as HTMLSelectElement).value = 'low'; game.applySettings(); }

  const loop = () => {
    try {
      game.frame();
    } catch (err) {
      game.lastError = String((err as Error)?.stack ?? err);
      console.error(err);
    }
    requestAnimationFrame(loop);
  };

  game.setState('loading');
  const bar = $('#load .fill'), label = $('#load .label');
  try {
    await game.load((f, file) => { bar.style.width = `${Math.round(f * 100)}%`; label.textContent = `Loading ${file} · ${Math.round(f * 100)}%`; });
  } catch (err) {
    if (err instanceof AssetLoadError) showError('Some game files could not be loaded.', err.failures.map(f => `${f.url} — ${f.reason}`));
    else showError('The game failed to start.', [String((err as Error)?.message ?? err)]);
    game.state = 'error';
    return;
  }
  // Session-only debug/share seed via ?seed=CODE; otherwise a brand-new station every load.
  const seedParam = params.get('seed');
  const parsed = seedParam ? codeToSeed(seedParam) : null;
  const seed = parsed ?? freshSeed();
  // Iteration 07 (Lane P2): only this station's lazy prop models are fetched (with progress) before it is built and revealed.
  await game.prepareStation(seed, (f, file) => { bar.style.width = `${Math.round(f * 100)}%`; label.textContent = `Loading station props · ${file} · ${Math.round(f * 100)}%`; });
  game.newStation(seed);
  const n = game.layout.zombies.length;
  $('#station-intro').textContent = `${game.layout.name}. ${n} infected reported below street level. Clear them out.`;
  label.textContent = `Ready · ${game.layout.areas.length} spaces generated`;
  bar.style.width = '100%';
  ($('#btn-start') as HTMLButtonElement).disabled = false;
  game.setState('title');
  requestAnimationFrame(loop);
}

void boot();
