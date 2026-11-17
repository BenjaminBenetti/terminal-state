// Task studio-surface-run-field-followup-20261116-211729-01 (primary): ONE short, serial browser spot check of the Surface Run field
// follow-up (root CLAUDE.md browser policy: the workspace lock / watchdog / owned-browser cleanup of browser-env.mjs; a 10 GiB anon + shmem
// guard closes the owned browser, plus an earlier self-stop at STOP_GIB). Firefox + Mesa on this worker: functional evidence and
// after-views only, never hardware performance. A version-2 campaign station (networkSeed 1 → st-00 by default):
//   1. the station's cargo lift at its closed street exit; the RIDE up (frames counted while it runs, the phases, the doors' first open
//      frame), the arrival in the command tent's lift; the tent air, the flap opened and the walk out;
//   2. the truck: damaged (smoke / flames), the side map board, the board's map; the fog pressure at 0.5 and 1 (the HUD's text);
//   3. a facade / avenue view, a deep store's landing and its roof;
//   4. the ride back down and the station's draws at the lift before / after.
//   npm run build && node tools/qa/surface-followup-check.mjs [outDir] [--size=960x540] [--quality=low] [--network=1] [--host=subway]
import fs from 'node:fs';
import path from 'node:path';
import {launchBrowser, withBrowserLock} from './browser-env.mjs';
import {serveStatic} from './static-server.mjs';

const ARGS = process.argv.slice(2), POS = ARGS.filter(a => !a.startsWith('--'));
const opt = (k, d) => (ARGS.find(a => a.startsWith(`--${k}=`)) ?? `--${k}=${d}`).slice(k.length + 3);
const out = path.resolve(POS[0] ?? 'qa-artifacts/surface-followup-browser');
const SIZE = opt('size', '960x540').split('x').map(Number), QUALITY = opt('quality', '');
const NETWORK_SEED = Number(opt('network', '1')), HOST = opt('host', 'subway'), ONLY = opt('only', 'all'), SKIP = opt('skip', '').split(','), STOP_AFTER = opt('stopAfter', ''), LIGHTING = opt('lighting', '');
const GUARD_GIB = 10, STOP_GIB = Number(opt('stop', '9.4'));
fs.mkdirSync(out, {recursive: true});
const sleep = ms => new Promise(r => setTimeout(r, ms));
const anon = () => { try { const s = fs.readFileSync('/sys/fs/cgroup/memory.stat', 'utf8'); const g = k => Number(new RegExp(`^${k} (\\d+)$`, 'm').exec(s)?.[1] ?? 0); return g('anon') + g('shmem'); } catch { return 0; } };
const gib = () => +(anon() / 1024 ** 3).toFixed(2);
const report = {started: new Date().toISOString(), size: SIZE, quality: QUALITY || 'default', lighting: LIGHTING || 'default', network: NETWORK_SEED, host: HOST, steps: [], shots: [], consoleErrors: [], peakGiB: 0, guard: false, stoppedAt: null};
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
    page.on('console', m => { if (m.type() === 'error' && report.consoleErrors.length < 40) report.consoleErrors.push(m.text().slice(0, 300)); });
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
      await sleep(400);
      const file = path.join(out, `${String(report.shots.length + 1).padStart(2, '0')}-${name}.png`);
      await page.screenshot({path: file});
      report.shots.push({name, file: path.basename(file), note, gib: gib()});
      step(`shot ${name}`, {note});
      save();
    };
    const frames = async n => { await ev(k => new Promise(res => { let i = 0; const f = () => (++i >= k ? res(null) : requestAnimationFrame(f)); requestAnimationFrame(f); }), n).catch(() => {}); };
    const drawStats = () => ev(() => new Promise(res => { const inf = window.__game.renderer.info, orig = inf.update; let draws = 0, tris = 0;
      inf.update = function (o, c, n) { draws++; tris += c / 3 * n; return orig.call(this, o, c, n); };
      requestAnimationFrame(() => { inf.update = orig; res({draws, tris: Math.round(tris)}); });
    })).catch(e => String(e));
    const face = (x, z, tx, tz, level = 0) => ev((a) => { window.__LL.teleport(a.x, a.z, Math.atan2(-(a.tx - a.x), -(a.tz - a.z)), a.level); }, {x, z, tx, tz, level});
    // (harness only: the QA route stands in the gas / the pressure on purpose; the player's hp is reset between poses so a later view is
    // not the death screen — recorded in the report, never a game change)
    const heal = () => ev(() => { const p = window.__game.player; const was = p.hp; if (p.alive) p.hp = 100; return was; }).catch(() => null);
    const hudText = () => ev(() => { const el = document.querySelector('#gas-hud') ?? document.querySelector('.gas-hud') ?? document.querySelector('[class*=gas]'); return el ? el.textContent.replace(/\s+/g, ' ').trim().slice(0, 200) : null; }).catch(e => String(e));

    if (!headroom('new campaign')) return;
    const t1 = Date.now();
    await ev((seed, host) => { window.__srNewGame = null; void window.__game.newCampaign(1, {overwrite: true, networkSeed: seed, dev: {level: host}}).then(r => { window.__srNewGame = r; }, e => { window.__srNewGame = {ok: false, error: String(e)}; }); }, NETWORK_SEED, HOST);
    const playing = await waitState('playing', 900);
    step('station playing', {playing, seconds: (Date.now() - t1) / 1000, newGame: await ev(() => window.__srNewGame).catch(e => String(e)),
      station: await ev(() => ({id: window.__game.run.current.station, name: window.__game.layout?.name})).catch(e => String(e)),
      access: await ev(() => { const a = window.__game.layout.surfaceAccess; return a && {v: a.v, kind: a.kind, hall: a.hall, label: a.label}; }).catch(e => String(e))});
    if (!playing) throw new Error('station never reached playing');
    await frames(30);

    // ---- 1. the lift up --------------------------------------------------------------------------------------------------------
    if (!headroom('lift')) return;
    step('lift go', {ok: await ev(() => window.__LL.surface.liftGo()), lift: await ev(() => window.__LL.surface.lift()).catch(e => String(e))});
    await frames(20);
    step('station draws (lift, before)', await drawStats());
    await shot('station-lift', 'inside the station cargo lift at the closed street exit, facing its controls ([E] prompt)');
    const faceGate = async () => { const L = await ev(() => { const l = window.__LL.surface.lift(); const P = window.__game.player; return l?.site && {d: l.site.lift.door, c: l.site.lift.cab, x: P.x, z: P.z, level: l.site.lift.level}; }).catch(() => null);
      if (L) { const cx = (L.c.x0 + L.c.x1) / 2, cz = (L.c.z0 + L.c.z1) / 2; await face(cx, cz, L.d.x, L.d.z, L.level); await frames(12); } return L; };
    if (await faceGate()) await shot('station-lift-gate', 'the same car turned to its gate (the landing beyond)');
    await ev(() => window.__LL.surface.liftGo()); await frames(5);
    if (!headroom('ride up')) return;
    const t2 = Date.now();
    // count drawn frames while the ride runs (the ride IS the loading experience: frames keep coming), the phases seen
    await ev(() => { const w = window; w.__srRide = {frames: 0, phases: [], firstOpenMs: null, t0: performance.now(), last: performance.now(), gaps: {}}; const tick = () => { const r = w.__srRide; if (!r) return; r.frames++;
      const now = performance.now(), gp = w.__game.surfaceCrossing?.phase ?? 'none', dtf = now - r.last; r.last = now; r.gaps[gp] = Math.max(r.gaps[gp] ?? 0, Math.round(dtf));
      const l = w.__LL.surface.lift(); const ph = l?.phase ?? 'none'; if (r.phases[r.phases.length - 1]?.p !== ph) r.phases.push({p: ph, ms: Math.round(performance.now() - r.t0)});
      if (r.firstOpenMs === null && l && l.door > 0.05 && r.phases.some(x => x.p === 'travel' || x.p === 'waiting')) r.firstOpenMs = Math.round(performance.now() - r.t0);
      if (!r.done) requestAnimationFrame(tick); }; requestAnimationFrame(tick); });
    const rideUp = ev(() => window.__LL.surface.cross('up')).catch(e => ({ok: false, error: String(e)}));
    // the memory / phase trace while the ride runs (where a software-renderer peak sits)
    const trace = [], traceT = setInterval(() => { void ev(() => ({c: window.__game.surfaceCrossing?.phase ?? null, l: window.__LL.surface.lift()?.phase ?? null})).then(x => trace.push({s: Math.round((Date.now() - t2) / 1000), gib: gib(), ...x}), () => {}); }, 10000);
    void rideUp.finally(() => clearInterval(traceT));
    await sleep(6000);
    if (!report.guard) await shot('ride-up-early', 'the enclosed ride, early (doors shut, the car lit, the shaft moving)');
    if (STOP_AFTER === 'ride-early') { step('stop after the early ride view (bounded session: the district build is not part of this one)', {lift: await ev(() => window.__LL.surface.lift()).catch(e => String(e))}); return; }
    await sleep(20000);
    if (!report.guard) await shot('ride-up-mid', 'the enclosed ride while the district builds / warms (no loading overlay)');
    const up = await rideUp;
    const ride = await ev(() => { const r = window.__srRide; r.done = true; return {frames: r.frames, maxFrameGapMsByPhase: r.gaps, phases: r.phases, firstOpenMs: r.firstOpenMs, ms: Math.round(performance.now() - r.t0)}; }).catch(e => String(e));
    clearInterval(traceT);
    report.rideTrace = trace;
    step('rode up', {up, ride, seconds: (Date.now() - t2) / 1000, state: await ev(() => window.__game.state).catch(e => String(e))});
    if (!up?.ok) throw new Error(`ride up failed: ${JSON.stringify(up)}`);
    await waitState('playing', 300);
    await frames(60);
    await shot('tent-arrival', 'arrival: in the tent lift car (as carried over from the ride)');
    if (await faceGate()) await shot('tent-arrival-gate', 'arrival: turned to the open gate, the command tent beyond');
    step('district draws (arrival)', await drawStats());
    step('tent', await ev(() => window.__LL.surface.tent()).catch(e => String(e)));
    const S = await ev(() => { const s = window.__game.layout.surface; return s && {v: s.v, truck: s.truck, tent: s.checkpoint.tent, boundary: s.boundary,
      dest: s.buildings.filter(b => b.destination && b.enterable).map(b => ({id: b.id, name: b.name, programme: b.programme, kind: b.kind, fp: b.footprint})),
      streets: s.streets.filter(t => t.rank === 'avenue').map(t => ({name: t.name, ax: t.ax, az: t.az, bx: t.bx, bz: t.bz}))}; });
    fs.writeFileSync(path.join(out, 'district.json'), JSON.stringify(S, null, 1));
    // the flap: stand inside facing it, [E] opens it, walk out through the real opening
    if (!headroom('flap')) return;
    const T = S.tent, n = {N: [0, -1], S: [0, 1], W: [-1, 0], E: [1, 0]}[T.door.side];
    await face(T.door.x - n[0] * 1.6, T.door.z - n[1] * 1.6, T.door.x, T.door.z);
    await frames(10);
    await page.keyboard.press('KeyE');
    await sleep(2500);
    await shot('tent-flap-open', 'the tent flap opened from inside (the real doorway)');
    await page.keyboard.down('KeyW'); await sleep(9000); await page.keyboard.up('KeyW');
    await frames(10);
    step('walked out', await ev(() => { const g = window.__game, t = window.__LL.surface.tent(); return {x: g.player.x, z: g.player.z, tent: t, exposure: {...g.gas.exposure}}; }).catch(e => String(e)));

    // ---- 2. truck, board, fog --------------------------------------------------------------------------------------------------
    if (ONLY !== 'ride') {
    if (!SKIP.includes('truck')) {
    if (!headroom('truck')) return;
    step('truck damaged', {c: await ev(() => window.__LL.truckSetCondition(0.18)), cond: await ev(() => window.__LL.truckCondition()).catch(e => String(e))});
    const tr = await ev(() => { const c = window.__game.skywaysCar, b = c.body, s = Math.sin(b.yaw), k = Math.cos(b.yaw); return {x: b.x, z: b.z, y: b.y, yaw: b.yaw, rx: k, rz: -s}; });
    // the truck's right side (+X in its frame), 7 m out, looking at it
    await face(tr.x + tr.rx * 7, tr.z + tr.rz * 7, tr.x, tr.z);
    await ev(t => window.__LL.lookAt(t.x, t.y + 1.8, t.z), tr);
    await sleep(3000); await frames(30);
    await shot('truck-damaged-board', 'the damaged truck (smoke, flames) and the map board on its right side');
    step('board open', {ok: await ev(() => window.__LL.truckBoardOpen()).catch(e => String(e))});
    await sleep(1500);
    await shot('truck-board-map', 'the planning map opened from the truck board');
    await page.keyboard.press('Escape');
    await waitState('playing', 30);
    await ev(() => window.__LL.truckSetCondition(1));
    }
    if (!SKIP.includes('fog')) {
    if (!headroom('fog')) return;
    for (const p of [0.5, 1]) {
      step('hp reset (harness)', {was: await heal()});
      step(`fog pose ${p}`, {ok: await ev(v => window.__LL.surfaceFogPose(v), p).catch(e => String(e))});
      await sleep(2500); await frames(30);
      step(`fog at ${p}`, {fog: await ev(() => window.__LL.surfaceFog()).catch(e => String(e)), hud: await hudText()});
      await shot(`fog-pressure-${p}`, `on foot at fog pressure ${p}, looking outward (no wall; the HUD)`);
      step('hp after pose', {hp: await ev(() => window.__game.player.hp).catch(e => String(e))});
    }
    }
    // ---- 3. facade, interior, roof ---------------------------------------------------------------------------------------------
    if (!headroom('facade')) return;
    step('hp reset (harness)', {was: await heal()});
    const av = S.streets[0];
    if (av) { const mx = (av.ax + av.bx) / 2, mz = (av.az + av.bz) / 2; await face(mx, mz, av.bx, av.bz); await frames(40); await shot('avenue', `down ${av.name}`); }
    step('facade pose', {ok: await ev(() => !!window.__LL.surfaceLookPose('facade')).catch(e => String(e))});
    await frames(40);
    await shot('facade', 'a facade close up (detail, glazing)');
    if (!headroom('roof')) return;
    const roofsQa = await ev(() => window.__LL.surfaceRoof()).catch(e => String(e)), roofs = roofsQa?.roofs;
    step('roofs', {n: roofsQa?.count ?? roofsQa, first: Array.isArray(roofs) ? roofs[0] : null});
    if (Array.isArray(roofs) && roofs.length) {
      step('hp reset (harness)', {was: await heal()});
      await ev(() => window.__LL.surfaceRoof(0, 'landing')); await frames(40);
      await shot('store-landing', 'a deep store: the stair landing toward the roof');
      await ev(() => window.__LL.surfaceRoof(0, 'roof')); await frames(40);
      step('roof air', await ev(() => ({exposure: {...window.__game.gas.exposure}, p: window.__game.player.y})).catch(e => String(e)));
      await shot('store-roof', 'on the reachable roof, facing the stair housing door');
    }
    }
    // ---- 4. the ride down ------------------------------------------------------------------------------------------------------
    if (!headroom('ride down')) return;
    step('hp reset (harness)', {was: await heal()});
    await ev(() => window.__LL.surface.liftGo());
    await frames(10);
    const t3 = Date.now();
    const down = await ev(() => window.__LL.surface.cross('down')).catch(e => ({ok: false, error: String(e)}));
    await waitState('playing', 600);
    await frames(40);
    step('rode down', {down, seconds: (Date.now() - t3) / 1000, state: await ev(() => window.__LL.surface.state()).catch(e => String(e))});
    await ev(() => window.__LL.surface.liftGo());
    await frames(20);
    step('station draws (lift, after)', await drawStats());
    await shot('station-return', 'back in the station lift (the district gone)');
  } finally {
    clearInterval(guard);
    save();
    server.close();
  }
}, {maxMinutes: 45, waitMinutes: 30, label: 'surface-followup-check'});
console.log('report', path.join(out, 'report.json'), 'peak', report.peakGiB, 'GiB');
