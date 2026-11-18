// Task studio-surface-host-ground-connectors-20261118-053602-01 (primary): ONE short, serial browser spot check of the Office / Mall
// on-foot CONNECTOR (world/surface/connectorRuntime.ts) both ways, or the Subway cargo lift's door-open handoff (--host=subway). Root
// CLAUDE.md browser policy: the workspace lock / watchdog / owned-browser cleanup of browser-env.mjs; a 10 GiB anon + shmem guard closes the
// owned browser, plus an earlier self-stop at STOP_GIB. Firefox + Mesa on this worker: functional evidence and after-views only, never
// hardware performance. A version-2 campaign station with the host forced (dev level):
//   1. the host's lobby at the tube's doorway; the WALK out on real keys (W held; the frame trace while it runs: the connector's phase /
//      flaps / held / gap, frame gaps by phase, the far flap's first roll-up); in the tube, the sealed join, the far flap rolling up, the
//      tent; the tube's mouth from inside the tent; the host building outside, grounded at the tube (a plaza view);
//   2. the walk back from the tent; the lobby again, turned to the doorway.
//   Subway: the lift ride up with the same frame trace (the doors' first open frame, the first-view preparation's report), the car's gate.
//   npm run build && node tools/qa/surface-connector-check.mjs [outDir] [--size=640x360] [--quality=low] [--lighting=off] [--network=2] [--host=office]
import fs from 'node:fs';
import path from 'node:path';
import {launchBrowser, withBrowserLock} from './browser-env.mjs';
import {serveStatic} from './static-server.mjs';

const ARGS = process.argv.slice(2), POS = ARGS.filter(a => !a.startsWith('--'));
const opt = (k, d) => (ARGS.find(a => a.startsWith(`--${k}=`)) ?? `--${k}=${d}`).slice(k.length + 3);
const out = path.resolve(POS[0] ?? 'qa-artifacts/surface-connector-browser');
const SIZE = opt('size', '640x360').split('x').map(Number), QUALITY = opt('quality', 'low'), LIGHTING = opt('lighting', 'off');
const NETWORK_SEED = Number(opt('network', '2')), HOST = opt('host', 'office'), ONLY = opt('only', 'all');
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
      else if (/crossing|first view|connector|lift opens|Terminal State: (lift|crossing)/i.test(t) && report.consoleInfo.length < 40) report.consoleInfo.push(t.slice(0, 600));
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
    const con = () => ev(() => window.__LL.surface.connector()).catch(e => String(e));
    const view = () => ev(() => window.__game.crossingView && {...window.__game.crossingView, job: undefined, plan: window.__game.crossingView.plan}).catch(e => String(e));
    const waitFor = async (fn, capS, arg) => { const r0 = Date.now(); while (Date.now() - r0 < capS * 1000 && !report.guard) { if (await ev(fn, arg).catch(() => false)) return true; await sleep(250); } return false; };

    if (!headroom('new campaign')) return;
    const t1 = Date.now();
    await ev((seed, host) => { window.__srNewGame = null; void window.__game.newCampaign(1, {overwrite: true, networkSeed: seed, dev: {level: host}}).then(r => { window.__srNewGame = r; }, e => { window.__srNewGame = {ok: false, error: String(e)}; }); }, NETWORK_SEED, HOST);
    const playing = await waitState('playing', 900);
    step('station playing', {playing, seconds: (Date.now() - t1) / 1000, newGame: await ev(() => window.__srNewGame).catch(e => String(e)),
      station: await ev(() => ({id: window.__game.run.current.station, name: window.__game.layout?.name, level: window.__game.run.current.level})).catch(e => String(e)),
      access: await ev(() => { const a = window.__game.layout.surfaceAccess; return a && {v: a.v, kind: a.kind, label: a.label, connector: a.connector}; }).catch(e => String(e))});
    if (!playing) throw new Error('station never reached playing');
    await frames(30);

    // the frame trace while a crossing runs (the crossing IS the loading experience: frames keep coming, look and walk stay live)
    const startTrace = () => ev(() => {
      const w = window; w.__cc = {frames: 0, gapFrames: 0, looks: 0, phases: [], farOpenMs: null, t0: performance.now(), last: performance.now(), gaps: {}, worst: 0};
      const tick = () => { const r = w.__cc; if (!r || r.done) return; r.frames++;
        const g = w.__game, now = performance.now(), dtf = now - r.last; r.last = now; r.worst = Math.max(r.worst, dtf);
        const c = w.__LL.surface.connector?.(), l = w.__LL.surface.lift?.();
        const ph = `${g.surfaceCrossing?.phase ?? 'none'}/${c?.phase ?? l?.phase ?? 'none'}`;
        r.gaps[ph] = Math.max(r.gaps[ph] ?? 0, Math.round(dtf));
        if (g.transitGap) { r.gapFrames++; if (r.gapFrames % 20 === 0 && g.state === 'playing') { g.input.dx = (r.looks++ % 2 ? -1 : 1) * 25; } } // (a mouse turn now and then in the gap)
        if (r.phases[r.phases.length - 1]?.p !== ph) r.phases.push({p: ph, ms: Math.round(now - r.t0), held: c?.holding ?? l?.held ?? null, flap: c?.flap ?? null});
        if (r.farOpenMs === null && c && c.reposed && c.flap.some(f => f > 0.05) && r.phases.some(x => x.p.startsWith('warmup') || x.p.startsWith('build'))) r.farOpenMs = Math.round(now - r.t0);
        if (r.farOpenMs === null && l && l.door > 0.05 && r.phases.some(x => /travel|waiting/.test(x.p))) r.farOpenMs = Math.round(now - r.t0);
        requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    });
    const stopTrace = () => ev(() => { const r = window.__cc; r.done = true; return {frames: r.frames, gapFrames: r.gapFrames, looks: r.looks, maxFrameGapMsByPhase: r.gaps, worstMs: Math.round(r.worst), phases: r.phases.slice(0, 40), farOpenMs: r.farOpenMs, ms: Math.round(performance.now() - r.t0)}; }).catch(e => String(e));
    const memTrace = (label) => { const tr = [], t = Date.now(); const id = setInterval(() => { void ev(() => ({c: window.__game.surfaceCrossing?.phase ?? null, k: window.__LL.surface.connector?.()?.phase ?? window.__LL.surface.lift?.()?.phase ?? null})).then(x => tr.push({s: Math.round((Date.now() - t) / 1000), gib: gib(), ...x}), () => {}); }, 10000); return () => { clearInterval(id); report[`${label}Trace`] = tr; }; };

    if (HOST === 'subway') {
      // ---- the cargo lift: the ride up's first-visible handoff (the doors open on the drawn first view) ----------------------------
      if (!headroom('lift')) return;
      step('lift go', {ok: await ev(() => window.__LL.surface.liftGo())});
      await frames(10);
      await startTrace();
      const end = memTrace('ride');
      const t2 = Date.now();
      const up = await ev(() => window.__LL.surface.cross('up')).catch(e => ({ok: false, error: String(e)}));
      end();
      const tr = await stopTrace();
      step('rode up', {up, trace: tr, seconds: (Date.now() - t2) / 1000, firstView: await view()});
      await frames(30);
      await shot('lift-arrival', 'the tent lift car just after the doors opened (the first view)');
      return;
    }

    // ---- 1. out: the lobby doorway, the walk, the tent ------------------------------------------------------------------------------
    if (!headroom('walk out')) return;
    step('connector (host)', {c: await con()});
    step('connector go', {ok: await ev(() => window.__LL.surface.connectorGo(1.6))});
    await frames(20);
    await shot('host-doorway', `${HOST}: the lobby at the tube's doorway, facing out (the flap down)`);
    await startTrace();
    const endOut = memTrace('out');
    const t2 = Date.now();
    await page.keyboard.down('KeyW');
    await sleep(1400);
    await shot('host-walk-in', 'walking in: the walk-in flap rolled up, the tube ahead (the far flap down)');
    // the seam fires a metre in with the walk-in flap down behind: the crossing runs while the walk goes on in the tube
    const began = await waitFor(() => window.__LL.surface.connector()?.phase === 'crossing', 20);
    step('crossing began', {began, seconds: (Date.now() - t2) / 1000, c: await con()});
    await sleep(1500);
    await page.keyboard.up('KeyW'); // (at the far flap: it stops the walk until the destination is ready)
    await shot('tube-sealed', 'in the sealed tube while the district is prepared (both flaps down; the lamp; frames keep coming)');
    const ready = await waitFor(() => { const c = window.__LL.surface.connector(); return !!c && c.ready && c.phase === 'idle'; }, 900);
    endOut();
    step('far side ready', {ready, seconds: (Date.now() - t2) / 1000, c: await con(), firstView: await view(), state: await ev(() => window.__LL.surface.state()).catch(e => String(e))});
    await sleep(700);
    await shot('tube-far-open', 'the far flap rolling up: the command tent beyond (no loading screen, no cut)');
    await page.keyboard.down('KeyW'); await sleep(2200); await page.keyboard.up('KeyW');
    await frames(10);
    step('walked out', {trace: await stopTrace(), c: await con(), tent: await ev(() => window.__LL.surface.tent()).catch(e => String(e))});
    await shot('tent', 'in the command tent after the walk out');
    const rec = (await con())?.record;
    if (rec) {
      // the tube's tent mouth from inside the tent (turned back), then the host building outside at the tube (the plaza view)
      const at = (s, t) => { const c = Math.cos(rec.yaw), sn = Math.sin(rec.yaw); return [rec.x - sn * s + c * t, rec.z - c * s - sn * t]; };
      const [mx, mz] = at(rec.len + 2.4, 0), [tx, tz] = at(rec.len - 1, 0);
      await face(mx, mz, tx, tz, rec.level); await frames(20);
      await shot('tent-mouth', 'from inside the tent: the tube\'s mouth (the passage back to the host)');
      const S = await ev(() => { const s = window.__game.layout.surface; return s && {tent: s.checkpoint.tent, portal: s.portal.pose}; }).catch(() => null);
      step('district', {S});
      const [hx, hz] = at(0, 0), [px, pz] = at(rec.len / 2, 9);
      const okPlaza = await face(px, pz, hx, hz, rec.level); await frames(30);
      step('plaza pose', {ok: okPlaza, from: [px, pz], to: [hx, hz]});
      await shot('plaza-host', `outside: the ${HOST} building grounded at the tube, the tube to the tent (a side view)`);
    }
    if (ONLY === 'out') return;

    // ---- 2. back: the tent side, the walk, the lobby --------------------------------------------------------------------------------
    if (!headroom('walk back')) return;
    step('connector go (tent)', {ok: await ev(() => window.__LL.surface.connectorGo(1.6))});
    await frames(20);
    await shot('tent-doorway', 'the tent side of the tube, facing in (the way back)');
    await startTrace();
    const endBack = memTrace('back');
    const t3 = Date.now();
    await page.keyboard.down('KeyW');
    const began2 = await waitFor(() => window.__LL.surface.connector()?.phase === 'crossing', 20);
    step('crossing back began', {began: began2, seconds: (Date.now() - t3) / 1000});
    await sleep(1500);
    await page.keyboard.up('KeyW');
    const ready2 = await waitFor(() => { const c = window.__LL.surface.connector(); return !!c && c.ready && c.phase === 'idle'; }, 900);
    endBack();
    step('host side ready', {ready: ready2, seconds: (Date.now() - t3) / 1000, c: await con(), firstView: await view()});
    await sleep(700);
    await shot('tube-host-open', 'the host flap rolling up: the lobby beyond');
    await page.keyboard.down('KeyW'); await sleep(2200); await page.keyboard.up('KeyW');
    await frames(10);
    step('walked back', {trace: await stopTrace(), c: await con(), state: await ev(() => window.__LL.surface.state()).catch(e => String(e))});
    const r2 = (await con())?.record;
    if (r2) {
      const at = (s, t) => { const c = Math.cos(r2.yaw), sn = Math.sin(r2.yaw); return [r2.x - sn * s + c * t, r2.z - c * s - sn * t]; };
      const [lx, lz] = at(-r2.door.depth - 3, 0.3), [dx, dz] = at(0, 0);
      await face(lx, lz, dx, dz, r2.level); await frames(20);
      await shot('host-return', 'back in the lobby, turned to the doorway (the tube\'s collar beyond)');
    }
  } finally {
    clearInterval(guard);
    save();
    server.close();
  }
}, {maxMinutes: 45, waitMinutes: 30, label: 'surface-connector-check'});
console.log('report', path.join(out, 'report.json'), 'peak', report.peakGiB, 'GiB');
