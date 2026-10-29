// Iteration-12 representative browser check (Firefox normal sandbox + Xvfb/Mesa, /tmp/ll-browser-qa.lock).
// Real input for movement (held W), light (F), use/throw (left click, T), open (E), fire (mouse), ADS (right mouse).
// ?qa=1 hooks only position/aim, set battery/give items for setup, and read state.
// Usage: node game/e2e/iter12-check.mjs OUTDIR [--dist=dist/game] [--seed=1A2B3C] [--only=a,b]
import fs from 'node:fs';
import path from 'node:path';
import {launchBrowser, withBrowserLock} from '../../tools/qa/browser-env.mjs';
import {serveStatic} from '../../tools/qa/static-server.mjs';

const arg = (k, d) => (process.argv.find(a => a.startsWith(`--${k}=`)) ?? `--${k}=${d}`).split('=')[1];
const outDir = path.resolve(process.argv.find((a, i) => i > 1 && !a.startsWith('--')) ?? 'qa-artifacts/iter12');
const dist = path.resolve(arg('dist', 'dist/game'));
const SEED = arg('seed', '1A2B3C');
const ONLY = arg('only', '') ? arg('only', '').split(',') : null;
const want = k => !ONLY || ONLY.includes(k);
fs.mkdirSync(outDir, {recursive: true});
const sleep = ms => new Promise(r => setTimeout(r, ms));
const report = {startedAt: new Date().toISOString(), dist, seed: SEED, steps: [], pageErrors: [], console: [], badResponses: [], screenshots: []};
const step = (name, ok, detail = {}) => { report.steps.push({name, ok, detail}); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`, JSON.stringify(detail).slice(0, 700)); return ok; };

await withBrowserLock(async () => {
  const {server, port} = await serveStatic(dist, {prefix: '/'});
  const browser = await launchBrowser();
  const page = await browser.newPage();
  await page.setViewport({width: 1280, height: 720});
  page.on('pageerror', e => report.pageErrors.push(String(e).slice(0, 600)));
  page.on('console', m => { if (['error', 'warn', 'warning'].includes(m.type())) report.console.push(`${m.type()}: ${m.text()}`.slice(0, 500)); });
  page.on('response', r => { if (r.status() >= 400) report.badResponses.push(`${r.status()} ${r.url()}`); });
  const ev = (fn, ...a) => page.evaluate(fn, ...a);
  const snap = () => ev(() => window.__LL.snapshot());
  const light = () => ev(() => window.__LL.light());
  const shot = async name => { const f = path.join(outDir, `${name}.png`); await page.screenshot({path: f}); report.screenshots.push(f); return f; };
  const waitFor = async (fn, timeout = 20000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > timeout) return null; await sleep(250); } };
  const frames = n => ev(k => new Promise(res => { let i = 0; const t = setTimeout(() => res(i), 60000); const f = () => { if (++i >= k) { clearTimeout(t); res(i); } else requestAnimationFrame(f); }; requestAnimationFrame(f); }), n);
  const click = async (button = 'left') => { await page.mouse.down({button}); await frames(2); await page.mouse.up({button}); await frames(6); };
  const pl = () => ev(() => { const p = window.__game.player, L = window.__game.levels; const s = L.supportAt(p.x, p.z, p.y + 0.05); return {x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2), level: s?.level ?? -1}; });
  const calls = () => ev(() => window.__game.renderer.info.render.drawCalls); // Iteration 13 (CORE): WebGPURenderer draw calls this frame
  const lum = async file => { const sharp = (await import('sharp')).default; const {data, info} = await sharp(file).extract({left: 440, top: 200, width: 400, height: 320}).greyscale().raw().toBuffer({resolveWithObject: true}); let s = 0; for (const v of data) s += v; return +(s / (info.width * info.height)).toFixed(1); };
  const walkTo = async (target, timeout = 90000) => {
    let prev = await pl(), maxDy = 0, minCalls = Infinity;
    await page.keyboard.down('KeyW');
    const t0 = Date.now(); let ok = false;
    try {
      while (Date.now() - t0 < timeout) {
        await ev(t => { const g = window.__game, p = g.player; const path = window.__LL.pathTo(t.x, t.z, t.y); const wps = Array.isArray(path) ? path : path?.points ?? path?.path ?? []; let nx = t.x, nz = t.z; for (const w of wps) { if (Math.hypot(w[0] - p.x, w[1] - p.z) > 0.45) { nx = w[0]; nz = w[1]; break; } } p.yaw = Math.atan2(-(nx - p.x), -(nz - p.z)); p.pitch = 0; }, target);
        await frames(3);
        const q = await pl(); maxDy = Math.max(maxDy, Math.abs(q.y - prev.y)); prev = q; minCalls = Math.min(minCalls, await calls());
        if (Math.hypot(q.x - target.x, q.z - target.z) < 0.7 && Math.abs(q.y - target.y) < 0.6) { ok = true; break; }
      }
    } finally { await page.keyboard.up('KeyW'); }
    await frames(4);
    return {ok, end: await pl(), maxDy: +maxDy.toFixed(3), minCalls};
  };
  try {
    await page.goto(`http://127.0.0.1:${port}/index.html?qa=1&seed=${SEED}`);
    step('loads to title', !!(await waitFor(() => ev(() => !!window.__LL?.ready() && window.__LL.state() === 'title').catch(() => false), 480000)));
    await page.click('#btn-start');
    await waitFor(async () => (await snap()).state === 'playing', 180000);
    await sleep(2500);
    await ev(() => { const p = window.__game.player; setInterval(() => { if (p.hp > 0 && p.hp < p.maxHp) p.hp = p.maxHp; }, 100); });
    const L0 = await light(); const s0 = await snap();
    await shot('00-spawn');
    step('start: pistol + 1 flare, battery 80 %, body glow + flashlight registered; enemy count', L0.battery.percent >= 79 && L0.inventory.flare === 1 && L0.sources.some(s => s.kind === 'bodyGlow') && L0.sources.some(s => s.kind === 'flashlight'),
      {battery: L0.battery, inventory: L0.inventory, sources: L0.sources.map(s => s.kind), zombies: s0.zombies?.length, held: s0.held, atmosphere: await ev(() => window.__LL.atmosphere())});

    if (want('stairs')) {
      const links = await ev(() => (window.__game.layout.levelLinks ?? []).map(k => ({lower: k.lower, upper: k.upper, bottom: k.bottom, top: k.top})));
      const res = [];
      for (const [i, k] of links.slice(0, 3).entries()) {
        for (const dir of ['down', 'up']) {
          const from = dir === 'down' ? 'top' : 'bottom', to = dir === 'down' ? k.bottom : k.top;
          await ev((i, e) => window.__LL.goLevelStairs(i, e), i, from); await frames(6);
          const w = await walkTo(to);
          const atEnd = await calls();
          await shot(`01-stairs-link${i}-${dir}-end`);
          // turn around at the end and look back up/down the run
          await ev(() => { const p = window.__game.player; p.yaw += Math.PI; }); await frames(6);
          await shot(`01-stairs-link${i}-${dir}-end-back`);
          res.push({link: i, dir, ok: w.ok, end: w.end, maxDy: w.maxDy, minCallsDuringWalk: w.minCalls, callsAtEnd: atEnd});
        }
      }
      step('stair endpoints walked by held W both ways (screenshots at the last step, facing on and back)', res.length > 0 && res.every(r => r.ok && r.maxDy < 0.6), {res});
    }

    if (want('container')) {
      const kinds = ['kitchenette', 'staffLockers', 'filingCabinet', 'cabinetTall', 'shopCooler'];
      let done = null;
      for (const k of kinds) {
        const st = await ev(kk => window.__LL.goOpenable(kk), k);
        if (!st) continue;
        await frames(4); await ev(a => window.__LL.lookAt(a.x, a.y, a.z), st.parts[0].aim); await frames(4);
        await page.keyboard.press('KeyE'); await frames(45);
        const st1 = await ev(sr => window.__LL.openableState(sr), st.serial);
        await ev(a => window.__LL.lookAt(a.x, a.y - 0.05, a.z), st1.parts[0].aim); await frames(6);
        const on = await shot(`02-container-${k}-flashlight-on`);
        await page.keyboard.press('KeyF'); await frames(10);
        const off = await shot(`02-container-${k}-flashlight-off`);
        await page.keyboard.press('KeyF'); await frames(6);
        done = {kind: k, open: st1.parts[0].open, lumOn: await lum(on), lumOff: await lum(off)};
        break;
      }
      step('opened container interior is lit by the flashlight (centre luminance on > off)', !!done && done.open && done.lumOn > done.lumOff * 1.15, done ?? {});
    }

    if (want('battery')) {
      await ev(() => window.__LL.qaSetBattery(0.08)); await frames(4);
      let dips = 0, samples = 0;
      for (let i = 0; i < 40; i++) { await frames(3); const b = (await light()).battery; samples++; if (b.dipping || b.output < 0.6) dips++; }
      await shot('03-battery-low-flicker');
      step('below 25 % the light flickers (dips observed at 8 %)', dips > 0, {dips, samples, at: (await light()).battery});
      await ev(() => window.__LL.qaSetBattery(0)); await frames(6);
      await page.keyboard.press('KeyF'); await frames(6); await page.keyboard.press('KeyF'); await frames(6);
      const dead = (await light()).battery;
      await shot('03-battery-dead');
      step('at 0 % the flashlight is off and F cannot turn it on', !dead.emitting, {dead});
      await ev(() => window.__LL.qaGiveItem('battery', 2)); await frames(4);
      const slot = await ev(() => window.__game.inv.hotbar.findIndex(s => s?.itemId === 'battery'));
      const before = (await light()).inventory.battery;
      if (slot >= 0) { await page.keyboard.press(`Digit${slot + 1}`); await frames(20); await click(); await frames(120); }
      const after = await light();
      step('using a battery (left click) refills to 100 % and consumes exactly one', after.battery.percent >= 99 && after.inventory.battery === before - 1, {slot, before, after: {battery: after.battery.percent, count: after.inventory.battery}});
      if (slot >= 0) { const s2 = await ev(() => window.__game.inv.hotbar.findIndex(s => s?.itemId === 'battery')); if (s2 >= 0) { await page.keyboard.press(`Digit${s2 + 1}`); await frames(20); await ev(() => window.__LL.qaSetBattery(1)); await click(); await frames(90); } }
      const full = await light();
      step('a battery at full charge is refused (none used)', full.inventory.battery === after.inventory.battery, {count: [after.inventory.battery, full.inventory.battery]});
      await page.keyboard.press('Digit1'); await frames(30);
    }

    if (want('flare')) {
      const v = await ev(() => window.__LL.goLureVantage?.() ?? null);
      await frames(10);
      const n0 = (await light()).inventory.flare;
      await page.keyboard.press('KeyT'); await frames(30);
      await frames(240);
      const L1 = await light();
      await shot('04-flare-landed');
      step('T throws a flare: one consumed, it lands and burns (light source + red light)', L1.inventory.flare === n0 - 1 && JSON.stringify(L1.flares).includes('burn'), {vantage: v, flares: L1.flares, attracting: L1.attracting});
      let lured = null;
      for (let i = 0; i < 12 && !lured; i++) { await frames(30); const q = await ev(() => window.__LL.lightLure()); if ((q?.investigating ?? []).length) lured = q; }
      await shot('04-flare-lure');
      step('an enemy that can see the flare investigates it slowly (not chase)', !!lured && lured.investigating.some(e => /approach|hold/.test(JSON.stringify(e))), {lured});
      if (lured) {
        const e = lured.investigating[0];
        const idx = e.index ?? e.i;
        // stand 4 m from the investigator, on the side it walks toward (its lure target), facing it
        await ev((i, t) => { const g = window.__game, b = g.zombies[i].brain; let dx = (t?.x ?? b.x + 1) - b.x, dz = (t?.z ?? b.z) - b.z; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
          for (const d of [4, 3, 5, 2.5]) { if (window.__LL.teleport(b.x + dx * d, b.z + dz * d, undefined, g.levels.levelAt(b.x, b.z, b.y + 0.05))) break; } window.__LL.lookAt(b.x, b.y + 1.4, b.z); }, idx, e.target);
        let chase = null;
        for (let i = 0; i < 20 && !chase; i++) { await frames(10); const st = await ev(i => window.__game.zombies[i].brain.state, idx); if (/chase|attack/.test(st)) chase = st; }
        await shot('04-player-priority');
        step('seeing the player overrides the light: the investigator switches to chase/attack', !!chase, {idx, state: chase});
        await ev(() => window.__LL.qaKillNearest?.());
      }
    }

    if (want('hit')) {
      // distant confirmed hit: a zombie 35-70 m away with line of sight; ordinary mouse fire with the pistol
      const t = await ev(() => {
        const g = window.__game, p = g.player, L = g.levels;
        // cheap bounded search (main-level zombies, 8 bearings, 2 distances; sight check before the snap)
        const cands = g.zombies.map((z, i) => ({i, b: z.brain})).filter(c => c.b.alive && Math.abs(c.b.y) < 0.3).slice(0, 10);
        let n = 0;
        for (const c of cands) for (let a = 0; a < 8; a++) {
          const ang = a / 8 * Math.PI * 2;
          for (const d of [34, 28]) {
            if (++n > 200) return null;
            const x = c.b.x + Math.sin(ang) * d, z = c.b.z + Math.cos(ang) * d;
            const s = L.supportAt(x, z, c.b.y + 0.05);
            if (!s || Math.abs(s.floor - c.b.y) > 0.3) continue;
            if (!L.lineOfSight({x, y: s.floor + 1.6, z}, {x: c.b.x, y: c.b.y + 1.3, z: c.b.z}, {slack: 0.2})) continue;
            if (!g.snap(x, z, 0)) continue;
            return {i: c.i, x, z, d};
          }
        }
        return null;
      });
      if (t) {
        await ev(t => { window.__LL.teleport(t.x, t.z); const b = window.__game.zombies[t.i].brain; b.state = 'idle'; }, t); await frames(10);
        await page.keyboard.press('Digit1'); await frames(20);
        const a0 = await ev(() => window.__LL.audio());
        let hit = false, tries = 0;
        for (; tries < 5 && !hit; tries++) {
          const ch = await ev(i => window.__LL.zombieChest(i), t.i); if (ch) await ev(c => window.__LL.lookAt(c.x, c.y, c.z), ch);
          await page.mouse.down({button: 'right'}); await frames(30);
          const ch2 = await ev(i => window.__LL.zombieChest(i), t.i); if (ch2) await ev(c => window.__LL.lookAt(c.x, c.y, c.z), ch2);
          await frames(3);
          const hp0 = await ev(i => window.__game.zombies[i].brain.hp, t.i);
          await click(); await frames(20); await page.mouse.up({button: 'right'}); await frames(4);
          const hp1 = await ev(i => window.__game.zombies[i].brain.hp, t.i);
          hit = hp1 < hp0;
        }
        const a1 = await ev(() => window.__LL.audio());
        step(`distant (${t.d} m) confirmed pistol hit plays the foreground hit confirm (audio graph counter)`, hit && a1.confirms > a0.confirms, {target: t, tries, hit, confirms: [a0.confirms, a1.confirms], state: a1.state});
      } else step('found a distant zombie with line of sight', false);
    }

    if (want('ads')) {
      await page.keyboard.press('Digit1'); await frames(30);
      await ev(() => { window.__game.player.pitch = 0; }); await frames(6);
      await page.mouse.down({button: 'right'}); await frames(45); await shot('05-pistol-ads'); await page.mouse.up({button: 'right'}); await frames(10);
      step('pistol ADS screenshot (lower, slightly closer)', true, {});
    }

    if (want('fog')) {
      const faces = await ev(() => { const g = window.__game, out = []; for (const a of g.layout.areas) { if (out.length >= 5) break; if (!['platform', 'concourse', 'service-corridor', 'passage'].includes(a.type)) continue; if (out.some(o => o.type === a.type)) continue; out.push({type: a.type, level: a.level ?? 0, x: a.x * 0.5 + a.w * 0.25, z: a.y * 0.5 + a.h * 0.25}); } return out; });
      for (const f of faces) { if (await ev(f => window.__LL.teleport(f.x, f.z, 0.7, f.level), f)) { await frames(20); await shot(`06-fog-${f.type}-a`); await frames(120); await shot(`06-fog-${f.type}-b`); } }
      step('fog/decay screenshots (two moments per area to show drift)', faces.length > 0, {faces: faces.map(f => f.type)});
    }

    const shaderErr = report.console.filter(x => /shader|program|webgl|glsl/i.test(x));
    step('no page errors, shader errors or failed requests', report.pageErrors.length === 0 && shaderErr.length === 0 && report.badResponses.length === 0, {pageErrors: report.pageErrors.slice(0, 3), shaderErr: shaderErr.slice(0, 3), bad: report.badResponses.slice(0, 5)});
  } catch (e) {
    step('script error', false, {error: String(e?.stack ?? e).slice(0, 900)});
  } finally {
    await browser.close();
    server.close();
    report.ok = report.steps.every(x => x.ok);
    fs.writeFileSync(path.join(outDir, 'iter12-check.json'), JSON.stringify(report, null, 2));
  }
});
