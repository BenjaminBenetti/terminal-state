// Task studio-surface-map-tent-cab-20261119-025201-01 (lead): ONE short, serial browser spot check of THE COMMAND TENT AS THE PREPARATION
// SPACE (world/surface/tentStage.ts): up into a version-2 district by the Subway cargo lift (--host=subway) or the Office / Mall connector
// walk (--host=office | mall), then in the tent while the street is prepared behind its held flap: the tent's view, the held flap's prompt
// and its refused [E], the planning map opened at its table with real keys (the street's preparation going on while it is open), a short
// walk in the tent, the flap released, opened with [E] and the street beyond. Optionally (--cab=1) the truck's dashboard map from the
// driver's seat. Root CLAUDE.md browser policy: the workspace lock / watchdog / owned-browser cleanup of browser-env.mjs; a 10 GiB
// anon + shmem guard closes the owned browser, plus an earlier self-stop at STOP_GIB. Firefox + Mesa on this worker: functional evidence,
// after-views and software-rasterizer waits only — never hardware performance.
//   npm run build && node tools/qa/surface-tent-stage-check.mjs [outDir] [--size=640x360] [--quality=low] [--lighting=off] [--network=2] [--host=subway]
import fs from 'node:fs';
import path from 'node:path';
import {launchBrowser, withBrowserLock} from './browser-env.mjs';
import {serveStatic} from './static-server.mjs';

const ARGS = process.argv.slice(2), POS = ARGS.filter(a => !a.startsWith('--'));
const opt = (k, d) => (ARGS.find(a => a.startsWith(`--${k}=`)) ?? `--${k}=${d}`).slice(k.length + 3);
const out = path.resolve(POS[0] ?? 'qa-artifacts/surface-tent-stage-browser');
const SIZE = opt('size', '640x360').split('x').map(Number), QUALITY = opt('quality', 'low'), LIGHTING = opt('lighting', 'off');
const NETWORK_SEED = Number(opt('network', '2')), HOST = opt('host', 'subway'), CAB = opt('cab', '0') === '1';
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
      else if (/crossing|first view|tent|lift opens|passage opens|Terminal State: (lift|crossing)/i.test(t) && report.consoleInfo.length < 60) report.consoleInfo.push(t.slice(0, 700));
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
    const stage = () => ev(() => window.__LL.surfaceTentStage()).catch(e => String(e));
    const units = () => ev(() => { const j = window.__game.journeyCompileStats; return j ? {at: Math.round(performance.now()), repsCompiled: j.viewRepsCompiled, reps: j.viewReps, drawn: j.viewDone, scene: j.sceneDone, steps: j.steps, fv: j.firstView} : null; }).catch(() => null);
    const hud = () => ev(() => ({prompt: document.querySelector('#prompt')?.textContent ?? null, toasts: [...document.querySelectorAll('#toasts > *, .toast')].map(n => n.textContent).slice(-4)})).catch(e => String(e));

    if (!headroom('new campaign')) return;
    const t1 = Date.now();
    await ev((seed, host) => { window.__srNewGame = null; void window.__game.newCampaign(1, {overwrite: true, networkSeed: seed, dev: {level: host}}).then(r => { window.__srNewGame = r; }, e => { window.__srNewGame = {ok: false, error: String(e)}; }); }, NETWORK_SEED, HOST);
    const playing = await waitState('playing', 900);
    step('station playing', {playing, seconds: (Date.now() - t1) / 1000, newGame: await ev(() => window.__srNewGame).catch(e => String(e)),
      station: await ev(() => ({id: window.__game.run.current.station, name: window.__game.layout?.name, level: window.__game.run.current.level, access: window.__game.layout.surfaceAccess?.kind})).catch(e => String(e))});
    if (!playing) throw new Error('station never reached playing');
    await frames(30);

    // the frame trace from the crossing's start: the worst gap by phase (the ride / walk; 'tent' — in the tent, the street being prepared;
    // 'map' — the planning map open meanwhile; 'street' — after the flap's release) and the times the tent opened / the flap was released
    await ev(() => {
      const w = window; w.__ts = {frames: 0, t0: performance.now(), last: performance.now(), gaps: {}, worst: 0, tentOpenMs: null, releasedMs: null, phases: []};
      const tick = () => { const r = w.__ts; if (!r || r.done) return; r.frames++;
        const g = w.__game, now = performance.now(), dtf = now - r.last; r.last = now;
        const T = g.surfaceTentStage, ph = g.transitGap || g.lifecycle?.busy ? `cross:${g.surfaceCrossing?.phase ?? '-'}` : T?.phase === 'street' ? (g.state === 'map' ? 'map' : 'tent') : r.tentOpenMs !== null ? 'street' : 'before';
        r.gaps[ph] = Math.max(r.gaps[ph] ?? 0, Math.round(dtf));
        if (r.phases[r.phases.length - 1]?.p !== ph) r.phases.push({p: ph, ms: Math.round(now - r.t0)});
        if (r.tentOpenMs === null && T?.phase === 'street' && !g.lifecycle?.busy) r.tentOpenMs = Math.round(now - r.t0);
        if (r.tentOpenMs !== null && r.releasedMs === null && T?.phase === 'idle') r.releasedMs = Math.round(now - r.t0);
        requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    });
    const trace = () => ev(() => { const r = window.__ts; return {frames: r.frames, ms: Math.round(performance.now() - r.t0), maxFrameGapMsByPhase: r.gaps, tentOpenMs: r.tentOpenMs, releasedMs: r.releasedMs, phases: r.phases.slice(0, 40)}; }).catch(e => String(e));

    // ---- 1. up into the district: the crossing ends INTO THE TENT -------------------------------------------------------------------
    if (!headroom('up')) return;
    const tUp = Date.now();
    if (HOST === 'subway') {
      step('lift go', {ok: await ev(() => window.__LL.surface.liftGo())});
      await frames(10);
      const up = await ev(() => window.__LL.surface.cross('up')).catch(e => ({ok: false, error: String(e)}));
      step('rode up: the car open in the tent', {up, seconds: (Date.now() - tUp) / 1000, stage: await stage(), trace: await trace()});
    } else {
      step('connector go', {ok: await ev(() => window.__LL.surface.connectorGo(1.6))});
      await frames(10);
      await page.keyboard.down('KeyW');
      const began = await waitFor(() => window.__LL.surface.connector()?.phase === 'crossing', 30);
      await sleep(1500);
      await page.keyboard.up('KeyW');
      const ready = await waitFor(() => { const c = window.__LL.surface.connector(); return !!c && c.ready && c.phase === 'idle'; }, 900);
      step('the far flap may roll up into the tent', {began, ready, seconds: (Date.now() - tUp) / 1000, stage: await stage()});
      await page.keyboard.down('KeyW');
      const released = await waitFor(() => !window.__LL.surface.connector()?.holding, 120);
      await page.keyboard.up('KeyW');
      step('walked out into the tent', {released, seconds: (Date.now() - tUp) / 1000, stage: await stage(), trace: await trace()});
    }
    await frames(10);
    await shot('tent-open', 'just arrived: the command tent while the street is prepared behind the shut flap');
    const tent = await ev(() => window.__LL.surface.tent()).catch(() => null);
    const S = await ev(() => { const s = window.__game.layout.surface; return s && {read: s.checkpoint.mapTable.read, tent: s.checkpoint.tent}; }).catch(() => null);
    step('tent', {tent, S});

    // ---- 2. the held flap: its prompt says why; [E] refused ---------------------------------------------------------------------------
    if (tent?.door && S) {
      const d = tent.door, r = tent.rect, n = d.side === 'N' ? [0, -1] : d.side === 'S' ? [0, 1] : d.side === 'W' ? [-1, 0] : [1, 0];
      const fx = d.side === 'N' || d.side === 'S' ? tent.flap?.a ?? d.x : d.x, fz = d.side === 'N' || d.side === 'S' ? d.z : tent.flap?.a ?? d.z;
      await face(fx - n[0] * 1.6, fz - n[1] * 1.6, fx, fz, 0); await frames(12);
      step('at the flap', {units: await units(), hud: await hud(), stage: await stage(), inTent: (await ev(() => window.__LL.surface.tent()).catch(() => null))?.player});
      await shot('flap-held', 'facing the held tent flap: its prompt says the street is being prepared');
      await page.keyboard.press('KeyE'); await frames(8);
      step('[E] on the held flap', {hud: await hud(), flap: (await ev(() => window.__LL.surface.tent()).catch(() => null))?.flap, stage: await stage()});
      await shot('flap-refused', '[E] on the held flap: refused with the street\'s progress (the flap stays shut)');

      // ---- 3. the planning map at its table, opened with [E] while the street is prepared --------------------------------------------
      const rd = S.read;
      await ev(a => { window.__LL.teleport(a.x, a.z, a.yaw, a.level); window.__game.player.pitch = -0.5; }, rd); await frames(12);
      step('at the map table', {units: await units(), hud: await hud()});
      await shot('map-table', 'at the planning map\'s table in the tent (its prompt)');
      const u0 = await units();
      await page.keyboard.press('KeyE');
      const mapOpen = await waitState('map', 20);
      await sleep(2500);
      step('map open', {mapOpen, units: u0, stage: await stage()});
      await shot('map-open', 'the planning map open at the normal view while the street is prepared');
      await sleep(15000);
      const u1 = await units();
      step('map open 15 s later', {units: u1, stage: await stage(), state: await ev(() => window.__game.state)});
      await shot('map-open-later', 'the planning map still open; the street\'s preparation went on meanwhile (counts in the report)');
      await page.keyboard.press('Escape');
      const back = await waitState('playing', 20);
      step('map closed', {back, state: await ev(() => window.__game.state)});
      if (!back) { await ev(() => window.__game.setState('playing')); await frames(5); }

      // ---- 4. a short walk / look in the tent meanwhile -------------------------------------------------------------------------------
      await page.keyboard.down('KeyW'); await sleep(1200); await page.keyboard.up('KeyW');
      await page.mouse.move(SIZE[0] / 2, SIZE[1] / 2); await page.mouse.move(SIZE[0] / 2 + 120, SIZE[1] / 2, {steps: 6});
      await frames(10);
      step('walked in the tent', {units: await units(), player: (await ev(() => window.__LL.surface.tent()).catch(() => null))?.player, stage: await stage(), trace: await trace()});
      await shot('tent-walk', 'walking and looking in the tent while the street is prepared');

      // ---- 5. the flap released on the street's first view; [E] opens it; the street beyond ------------------------------------------
      const tRel = Date.now();
      const released = await waitFor(() => window.__game.surfaceTentStage?.phase === 'idle', 1200);
      step('flap released', {released, waitedS: (Date.now() - tRel) / 1000, sinceUpS: (Date.now() - tUp) / 1000, stage: await stage(), trace: await trace(), hud: await hud()});
      await face(fx - n[0] * 1.6, fz - n[1] * 1.6, fx, fz, 0); await frames(20);
      await shot('flap-free', 'the street is ready: the flap\'s prompt is the ordinary one again');
      await page.keyboard.press('KeyE');
      await waitFor(() => (window.__LL.surface.tent()?.flap?.t ?? 0) > 0.95, 30);
      await frames(20);
      step('flap opened', {flap: (await ev(() => window.__LL.surface.tent()).catch(() => null))?.flap, trace: await trace()});
      await shot('street-through-flap', 'the flap opened with [E]: the street beyond, drawn');
    }

    // ---- 6. (--cab=1) the truck's map on the passenger-side dash: in at the driver's door with a real [E], the view on the sheet, a real
    // [E] opens the planning map, Escape returns to the seat (still driving), then out
    if (CAB && headroom('cab')) {
      const door = await ev(() => { const c = window.__game.skywaysCar, b = c.body, S = c.spec, lx = -(S.width / 2 + 0.7), lz = S.exits.left.z;
        const cs = Math.cos(b.yaw), sn = Math.sin(b.yaw); return {x: b.x + lx * cs + lz * sn, z: b.z - lx * sn + lz * cs, bx: b.x, bz: b.z, y: b.y}; }).catch(e => String(e));
      await ev(d => { window.__LL.teleport(d.x, d.z, Math.atan2(-(d.bx - d.x), -(d.bz - d.z)), 0); window.__LL.lookAt(d.bx, d.y + 1.6, d.bz); }, door);
      await frames(10);
      await page.keyboard.press('KeyE'); await frames(30);
      step('in the cab', {truck: await ev(() => window.__LL.truck()?.state).catch(e => String(e))});
      step('dash map look', {look: await ev(() => window.__LL.truckDashMapLook()).catch(e => String(e))});
      await frames(10);
      step('dash map', {map: await ev(() => window.__LL.truckDashMap()).catch(e => String(e)), hud: await hud()});
      await shot('cab-dash-map', 'seated: the planning map on the passenger-side dash, its [E] prompt');
      await page.keyboard.press('KeyE');
      step('dash map open', {map: await waitState('map', 10)});
      await sleep(1500);
      await shot('cab-dash-map-open', 'the planning map opened from the dash');
      await page.keyboard.press('Escape');
      const seat = await waitState('playing', 20);
      await frames(20);
      step('dash map closed', {seat, truck: await ev(() => window.__LL.truck()?.state).catch(e => String(e)), map: await ev(() => window.__LL.truckDashMap()).catch(e => String(e)), hud: await hud()});
      await shot('cab-dash-map-closed', 'closed: back in the driver\'s seat, the dash map in view');
    }
    step('done', {trace: await trace(), stage: await stage()});
  } finally {
    clearInterval(guard);
    save();
    server.close();
  }
}, {maxMinutes: 45, waitMinutes: 30, label: 'surface-tent-stage-check'});
console.log('report', path.join(out, 'report.json'), 'peak', report.peakGiB, 'GiB');
