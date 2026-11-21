// Task studio-surface-tent-first-staging-20261120-225458-01 (lead): ONE short, serial browser spot check of THE STAGED COMMAND TENT as the
// loading space (world/surface/tentShell.ts): up into a version-2 district by the Subway cargo lift (--host=subway) or the Office / Mall
// connector walk (--host=office | mall); the car / tube opens into the staged tent while the district is still being BUILT; meanwhile a
// look and a short walk in it, the closed flap ([E] refused with the build's real stage), the planning map opened at its table with real
// keys (the build going on while it is open); then the swap to the district's real tent, the street prepared behind the held flap, released
// on its real first view, and the flap opened. Root CLAUDE.md browser policy: the workspace lock / watchdog / owned-browser cleanup of
// browser-env.mjs; a 10 GiB anon + shmem guard closes the owned browser, plus an earlier self-stop at STOP_GIB. Firefox + Mesa on this
// worker: functional evidence, after-views and software-rasterizer waits only — never hardware performance.
//   npm run build && node tools/qa/surface-tent-first-check.mjs [outDir] [--size=640x360] [--quality=low] [--lighting=off] [--network=1] [--host=subway]
import fs from 'node:fs';
import path from 'node:path';
import {launchBrowser, withBrowserLock} from './browser-env.mjs';
import {serveStatic} from './static-server.mjs';

const ARGS = process.argv.slice(2), POS = ARGS.filter(a => !a.startsWith('--'));
const opt = (k, d) => (ARGS.find(a => a.startsWith(`--${k}=`)) ?? `--${k}=${d}`).slice(k.length + 3);
const out = path.resolve(POS[0] ?? 'qa-artifacts/surface-tent-first-browser');
const SIZE = opt('size', '640x360').split('x').map(Number), QUALITY = opt('quality', 'low'), LIGHTING = opt('lighting', 'off');
const NETWORK_SEED = Number(opt('network', '1')), HOST = opt('host', 'subway');
const GUARD_GIB = 10, STOP_GIB = Number(opt('stop', '9.8'));
fs.mkdirSync(out, {recursive: true});
const sleep = ms => new Promise(r => setTimeout(r, ms));
const anon = () => { try { const s = fs.readFileSync('/sys/fs/cgroup/memory.stat', 'utf8'); const g = k => Number(new RegExp(`^${k} (\\d+)$`, 'm').exec(s)?.[1] ?? 0); return g('anon') + g('shmem'); } catch { return 0; } };
const gib = () => +(anon() / 1024 ** 3).toFixed(2);
const report = {started: new Date().toISOString(), size: SIZE, quality: QUALITY || 'default', lighting: LIGHTING || 'default', network: NETWORK_SEED, host: HOST, steps: [], shots: [], consoleErrors: [], consoleInfo: [], peakGiB: 0, guard: false, stoppedAt: null};
const step = (name, data = {}) => { report.steps.push({name, gib: gib(), t: new Date().toISOString(), ...data}); console.log(name, `${gib()} GiB`, JSON.stringify(data).slice(0, 1500)); };
const headroom = name => { if (gib() >= STOP_GIB) { report.stoppedAt = name; step(`self-stop before ${name}`, {stopGib: STOP_GIB}); return false; } return true; };
const save = () => fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));

await withBrowserLock(async () => {
  const {server, port} = await serveStatic(path.resolve('dist/game'), {prefix: '/'});
  let browser = null;
  const guard = setInterval(() => { const b = anon(); report.peakGiB = Math.max(report.peakGiB, +(b / 1024 ** 3).toFixed(2)); if (b > GUARD_GIB * 1024 ** 3 && !report.guard) { report.guard = true; console.error('memory guard: closing the owned browser'); void browser?.close(); } }, 500);
  try {
    step('before launch');
    browser = await launchBrowser({protocolTimeout: 900000});
    const page = await browser.newPage();
    page.on('console', m => {
      const t = m.text();
      if (m.type() === 'error' && report.consoleErrors.length < 40) report.consoleErrors.push(t.slice(0, 300));
      else if (/crossing|first view|tent|lift opens|passage opens|street|Terminal State: (lift|crossing)/i.test(t) && report.consoleInfo.length < 60) report.consoleInfo.push(t.slice(0, 700));
    });
    page.on('pageerror', e => { if (report.consoleErrors.length < 40) report.consoleErrors.push(`pageerror: ${String(e).slice(0, 300)}`); });
    await page.setViewport({width: SIZE[0], height: SIZE[1]});
    const ev = (fn, ...a) => page.evaluate(fn, ...a);
    const q = (QUALITY ? `&quality=${QUALITY}` : '') + (LIGHTING ? `&lighting=${LIGHTING}` : '');
    const t0 = Date.now();
    await page.goto(`http://127.0.0.1:${port}/index.html?qa=1&qaPrebuild=0&menuScene=0${q}`);
    let booted = false;
    for (let i = 0; i < 300 && !booted && !report.guard; i++) { booted = await ev(() => !!window.__game?.pickups && !!window.__LL).catch(() => false); if (!booted) await sleep(1000); }
    step('booted', {booted, seconds: (Date.now() - t0) / 1000});
    if (!booted) throw new Error('game did not boot');
    const waitState = async (want, capS) => { const r0 = Date.now(); while (Date.now() - r0 < capS * 1000 && !report.guard) { if (await ev(w => window.__game.state === w, want).catch(() => false)) return true; await sleep(1000); } return false; };
    const shot = async (name, note) => {
      if (report.guard) return;
      await sleep(300);
      const file = path.join(out, `${String(report.shots.length + 1).padStart(2, '0')}-${name}.png`);
      await page.screenshot({path: file});
      report.shots.push({name, file: path.basename(file), note, gib: gib()});
      step(`shot ${name}`, {note});
      save();
    };
    const frames = async n => { await ev(k => new Promise(res => { let i = 0; const f = () => (++i >= k ? res(null) : requestAnimationFrame(f)); requestAnimationFrame(f); }), n).catch(() => {}); };
    const face = (x, z, tx, tz, level = 0) => ev((a) => window.__LL.teleport(a.x, a.z, Math.atan2(-(a.tx - a.x), -(a.tz - a.z)), a.level), {x, z, tx, tz, level});
    const waitFor = async (fn, capS, arg) => { const r0 = Date.now(); while (Date.now() - r0 < capS * 1000 && !report.guard) { if (await ev(fn, arg).catch(() => false)) return true; await sleep(250); } return false; };
    const hud = () => ev(() => ({prompt: document.querySelector('#prompt')?.textContent ?? null, toasts: [...document.querySelectorAll('#toasts > *, .toast')].map(n => n.textContent).slice(-4)})).catch(e => String(e));
    const build = () => ev(() => { const b = window.__game.journeyBuildStats; return b && {workMs: Math.round(b.workMs), steps: b.steps, slices: b.slices, maxSliceMs: Math.round(b.maxSliceMs), maxStepMs: Math.round(b.maxStepMs), parkedMs: Math.round(b.parkedMs), last: Object.keys(b.stages).slice(-2)}; }).catch(e => String(e));
    const shell = () => ev(() => { const g = window.__game, r = g.surfaceTentShellRecord; return {open: g.surfaceTentShellOpen, live: !!g.surfaceTentShell, gap: g.transitGap, built: g.liftBuilt, rec: r && {...r, stats: {...r.stats}}}; }).catch(e => String(e));

    if (!headroom('new campaign')) return;
    const t1 = Date.now();
    await ev((seed, host) => { window.__srNewGame = null; void window.__game.newCampaign(1, {overwrite: true, networkSeed: seed, dev: {level: host}}).then(r => { window.__srNewGame = r; }, e => { window.__srNewGame = {ok: false, error: String(e)}; }); }, NETWORK_SEED, HOST);
    const playing = await waitState('playing', 900);
    step('station playing', {playing, seconds: (Date.now() - t1) / 1000, newGame: await ev(() => window.__srNewGame).catch(e => String(e)),
      station: await ev(() => ({id: window.__game.run.current.station, name: window.__game.layout?.name, level: window.__game.run.current.level, access: window.__game.layout.surfaceAccess?.kind})).catch(e => String(e))});
    if (!playing) throw new Error('station never reached playing');
    await frames(30);

    // the frame trace from the crossing's start: the worst frame gap by phase — 'sealed' (the shut car / tube), 'shell' (the staged tent
    // open, the district being built), 'shell-map' (its planning map open meanwhile), 'tent' (the district's tent, the street prepared
    // behind the held flap), 'street' (after the flap's release) — and when each began (ms from the crossing's start)
    await ev(() => {
      const w = window; w.__ts = {frames: 0, t0: performance.now(), last: performance.now(), gaps: {}, counts: {}, phases: []};
      const tick = () => { const r = w.__ts; if (!r || r.done) return; r.frames++;
        const g = w.__game, now = performance.now(), dtf = now - r.last; r.last = now;
        const T = g.surfaceTentStage;
        const ph = g.surfaceTentShellOpen ? (g.state === 'map' ? 'shell-map' : 'shell') : g.transitGap || g.lifecycle?.busy ? 'sealed' : T?.phase === 'street' ? (g.state === 'map' ? 'map' : 'tent') : r.phases.length > 1 ? 'street' : 'before';
        r.gaps[ph] = Math.max(r.gaps[ph] ?? 0, Math.round(dtf));
        r.counts[ph] = (r.counts[ph] ?? 0) + 1;
        if (r.phases[r.phases.length - 1]?.p !== ph) r.phases.push({p: ph, ms: Math.round(now - r.t0)});
        requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    });
    const trace = () => ev(() => { const r = window.__ts; return {frames: r.frames, ms: Math.round(performance.now() - r.t0), maxFrameGapMsByPhase: r.gaps, framesByPhase: r.counts, phases: r.phases.slice(0, 40)}; }).catch(e => String(e));

    // ---- 1. the crossing starts; the car / tube opens INTO THE STAGED TENT while the district is built ---------------------------------
    if (!headroom('up')) return;
    const tUp = Date.now();
    if (HOST === 'subway') {
      step('lift go', {ok: await ev(() => window.__LL.surface.liftGo())});
      await frames(10);
      await ev(() => { window.__srCross = null; void window.__LL.surface.cross('up').then(r => { window.__srCross = r; }, e => { window.__srCross = {ok: false, error: String(e)}; }); });
    } else {
      step('connector go', {ok: await ev(() => window.__LL.surface.connectorGo(1.6))});
      await frames(10);
      await ev(() => { window.__srCross = null; });
      await page.keyboard.down('KeyW');
      const began = await waitFor(() => window.__LL.surface.connector()?.phase === 'crossing', 30);
      await sleep(1500);
      await page.keyboard.up('KeyW');
      step('the seam fired', {began});
    }
    const opened = await waitFor(() => window.__game.surfaceTentShellOpen, 900);
    step('the staged tent is open', {opened, seconds: (Date.now() - tUp) / 1000, shell: await shell(), build: await build(), hud: await hud()});
    if (!opened) throw new Error('the staged tent never opened');
    if (HOST === 'subway') await waitFor(() => !window.__game.surfaceLiftRide?.holding, 120);
    else { await page.keyboard.down('KeyW'); await waitFor(() => !window.__LL.surface.connector()?.holding, 120); await page.keyboard.up('KeyW'); }
    await frames(6);
    step('released into the staged tent', {seconds: (Date.now() - tUp) / 1000, shell: await shell(), build: await build(), hud: await hud()});
    const tent = await ev(() => window.__LL.surface.tent()).catch(() => null);
    const S = await ev(() => { const s = window.__game.layout.surface; return s && {read: s.checkpoint.mapTable.read, tent: s.checkpoint.tent}; }).catch(() => null);
    const c = tent?.rect ? {x: (tent.rect.x0 + tent.rect.x1) / 2, z: (tent.rect.z0 + tent.rect.z1) / 2} : null;
    if (c) { const p = await ev(() => ({x: window.__game.player.x, z: window.__game.player.z})); await face(p.x, p.z, c.x, c.z, 0); await frames(10); }
    await shot('staged-tent', 'released into the STAGED tent: the district is still being built (its stage in the prompt)');

    // ---- 2. while the district is built: a look and a walk, the closed flap, the planning map -------------------------------------------
    await page.keyboard.down('KeyW'); await sleep(1200); await page.keyboard.up('KeyW');
    await page.mouse.move(SIZE[0] / 2, SIZE[1] / 2); await page.mouse.move(SIZE[0] / 2 + 120, SIZE[1] / 2, {steps: 6});
    await frames(8);
    step('walked in the staged tent', {shell: await shell(), build: await build(), hud: await hud(), player: (await ev(() => window.__LL.surface.tent()).catch(() => null))?.player});
    await shot('staged-tent-walk', 'walking and looking in the staged tent while the district is built');
    if (tent?.door && S) {
      const d = tent.door, n = d.side === 'N' ? [0, -1] : d.side === 'S' ? [0, 1] : d.side === 'W' ? [-1, 0] : [1, 0];
      const fx = d.side === 'N' || d.side === 'S' ? tent.flap?.a ?? d.x : d.x, fz = d.side === 'N' || d.side === 'S' ? d.z : tent.flap?.a ?? d.z;
      await face(fx - n[0] * 1.6, fz - n[1] * 1.6, fx, fz, 0); await frames(10);
      step('at the closed flap', {hud: await hud(), shell: await shell()});
      await page.keyboard.press('KeyE'); await frames(8);
      step('[E] on the closed flap', {hud: await hud(), shell: await shell(), build: await build()});
      await shot('staged-flap-refused', '[E] on the staged tent\'s closed flap: refused with the build\'s real stage');
      const rd = S.read;
      await ev(a => { window.__LL.teleport(a.x, a.z, a.yaw, a.level); window.__game.player.pitch = -0.5; }, rd); await frames(10);
      step('at the map table', {hud: await hud()});
      const b0 = await build();
      await page.keyboard.press('KeyE');
      const mapOpen = await waitState('map', 20);
      await sleep(2500);
      step('map open in the staged tent', {mapOpen, build: b0, shell: await shell()});
      await shot('staged-map-open', 'the planning map open in the staged tent while the district is built');
      await sleep(10000);
      step('map open 10 s later', {build: await build(), shell: await shell(), state: await ev(() => window.__game.state)});
      await page.keyboard.press('Escape');
      const back = await waitState('playing', 20);
      if (!back) { await ev(() => window.__game.setState('playing')); await frames(5); }
      step('map closed', {back, shell: await shell()});
    }

    // ---- 3. built: the swap to the district's tent; the street behind the held flap; released; the flap opened ------------------------
    const tSwap = Date.now();
    const swapped = await waitFor(() => !window.__game.surfaceTentShell && !window.__game.transitGap, 1500);
    step('built and swapped', {swapped, waitedS: (Date.now() - tSwap) / 1000, sinceUpS: (Date.now() - tUp) / 1000, shell: await shell(), build: await build(), cross: await ev(() => window.__srCross).catch(() => null), hud: await hud()});
    await frames(10);
    await shot('district-tent', 'the district\'s real tent after the swap: the street prepared behind the held flap');
    const released = await waitFor(() => window.__game.surfaceTentStage?.phase === 'idle', 1500);
    step('flap released', {released, sinceUpS: (Date.now() - tUp) / 1000, stage: await ev(() => window.__LL.surfaceTentStage()).catch(e => String(e)), trace: await trace()});
    if (tent?.door) {
      const d = tent.door, n = d.side === 'N' ? [0, -1] : d.side === 'S' ? [0, 1] : d.side === 'W' ? [-1, 0] : [1, 0];
      const fx = d.side === 'N' || d.side === 'S' ? tent.flap?.a ?? d.x : d.x, fz = d.side === 'N' || d.side === 'S' ? d.z : tent.flap?.a ?? d.z;
      await face(fx - n[0] * 1.6, fz - n[1] * 1.6, fx, fz, 0); await frames(12);
      await page.keyboard.press('KeyE');
      await waitFor(() => (window.__LL.surface.tent()?.flap?.t ?? 0) > 0.95, 30);
      await frames(20);
      step('flap opened', {flap: (await ev(() => window.__LL.surface.tent()).catch(() => null))?.flap});
      await shot('street-through-flap', 'the flap opened with [E]: the street beyond, drawn');
    }
    step('done', {trace: await trace(), shell: await shell()});
  } finally {
    clearInterval(guard);
    save();
    server.close();
  }
}, {maxMinutes: 45, waitMinutes: 30, label: 'surface-tent-first-check'});
console.log('report', path.join(out, 'report.json'), 'peak', report.peakGiB, 'GiB');
