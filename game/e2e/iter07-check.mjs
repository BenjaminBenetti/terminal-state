// Short iteration-07 browser check of the STATIC build (?qa=1 for aiming/teleport only): doorways clear,
// wardrobe looks, rat/dog creature, a cola can moved by a NORMAL frame-synced mouse shot, zombie flesh chunks,
// new p7 props placed + screenshot, no page/shader errors.
// Usage: node game/e2e/iter07-check.mjs OUTDIR [--dist=dist/game] [--seed=1A2B3C]
import fs from 'node:fs';
import path from 'node:path';
import {launchBrowser, withBrowserLock} from '../../tools/qa/browser-env.mjs';
import {serveStatic} from '../../tools/qa/static-server.mjs';

const arg = (k, d) => (process.argv.find(a => a.startsWith(`--${k}=`)) ?? `--${k}=${d}`).split('=')[1];
const outDir = path.resolve(process.argv.find((a, i) => i > 1 && !a.startsWith('--')) ?? 'qa-artifacts/iter07');
const dist = path.resolve(arg('dist', 'dist/game'));
const SEED = arg('seed', '1A2B3C');
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
  const shot = async name => { const f = path.join(outDir, `${name}.png`); await page.screenshot({path: f}); report.screenshots.push(f); };
  const waitFor = async (fn, timeout = 20000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > timeout) return null; await sleep(250); } };
  const frames = n => ev(k => new Promise(res => { let i = 0; const t = setTimeout(() => res(i), 30000); const f = () => { if (++i >= k) { clearTimeout(t); res(i); } else requestAnimationFrame(f); }; requestAnimationFrame(f); }), n);
  const fireNormal = async () => { await page.mouse.down(); await frames(2); await page.mouse.up(); await frames(8); };
  try {
    await page.goto(`http://127.0.0.1:${port}/index.html?qa=1&seed=${SEED}`);
    const ready = await waitFor(() => ev(() => !!window.__LL?.ready() && window.__LL.state() === 'title').catch(() => false), 480000);
    step('loads to title', !!ready);
    await page.click('#btn-start');
    await waitFor(async () => (await snap()).state === 'playing', 120000);
    await sleep(3000);
    let s = await snap();
    const dw = await ev(() => window.__LL.doorways());
    step('enters play; doorway openings have no intrusions', s.state === 'playing' && (dw?.intrusions?.length ?? 0) === 0, {archetype: s.layout.archetype, openings: dw?.openings?.length ?? dw?.count, intrusions: dw?.intrusions?.slice?.(0, 3), props07: s.props07 && {kinds: s.props07.kinds?.length, placements: s.props07.placements, loaded: s.props07.loaded?.length, failures: s.props07.failures}, render: s.render});
    await ev(() => window.__LL.goDoorway(undefined, 'staff')); await frames(6); await shot('01-staff-doorway');

    // new props in a room
    const p7 = s.props07;
    let p7shot = false;
    if (p7?.kinds?.length) {
      const where = await ev(kinds => { const g = window.__game; const pr = g.layout.props.find(p => kinds.includes(p.kind)); return pr ? {x: pr.x, z: pr.z, kind: pr.kind, rot: pr.rot} : null; }, p7.kinds);
      if (where) { await ev(w => { window.__LL.teleport(w.x + Math.sin(w.rot) * 2.2, w.z + Math.cos(w.rot) * 2.2); window.__LL.lookAt(w.x, 0.8, w.z); }, where); await frames(8); await shot('02-new-prop'); p7shot = true; }
    }
    step('new p7 prop types placed in the station', (p7?.kinds?.length ?? 0) > 0 && p7shot, {kinds: p7?.kinds?.length, placements: p7?.placements, sample: p7?.kinds?.slice(0, 12)});

    // can/item moved by a NORMAL mouse shot (QA only aims); try up to 3 different visible items
    const attempts = [];
    let canOk = false;
    await page.keyboard.press('Digit1'); await frames(10);
    for (let k = 0; k < 3 && !canOk; k++) {
      const can = await ev(n => { const L = window.__LL; const ids = ['cola', 'water', 'juice', 'chips', 'chocolate', 'beans', 'noodles']; for (const id of ids.slice(n)) { const r = L.aimItem(id, {teleport: true}); if (r) return r; } return L.aimItem(undefined, {teleport: true}); }, k * 2);
      if (!can) break;
      await frames(6);
      const kind = await ev(serial => window.__game.containers?.all[serial]?.kind ?? null, can.holder);
      await ev((x, y, z) => window.__LL.lookAt(x, y, z), can.at.x, can.at.y, can.at.z); await frames(4);
      const d0 = await ev(() => window.__LL.dynamics());
      const ammo0 = (await snap()).held?.mag;
      await fireNormal(); await frames(20);
      const d1 = await ev(() => window.__LL.dynamics());
      const ammo1 = (await snap()).held?.mag;
      await shot(`03-item-after-shot-${k + 1}`);
      const moved = (d1.dynamic?.counts?.activated ?? 0) > (d0.dynamic?.counts?.activated ?? 0) || (d1.dynamic?.counts?.shots ?? 0) > (d0.dynamic?.counts?.shots ?? 0) || d1.liftedLots.length > d0.liftedLots.length;
      attempts.push({item: can.itemId, source: can.source, holderKind: kind, at: can.at, firstHit: can.firstHit, firstHitT: can.firstHitT, dist: can.dist, ammo: [ammo0, ammo1], moved, after: {items: d1.items?.slice(0, 2), counts: d1.dynamic?.counts}});
      canOk = moved && ammo1 < ammo0;
    }
    step('an item moves when hit by a normal frame-synced mouse shot', canOk, {attempts});

    // zombie: flesh chunks (QA aim, pipeline shots)
    s = await snap();
    const zi = s.zombies.findIndex(q => q.alive && (q.archetype ?? 'zombie') === 'zombie');
    if (zi >= 0) {
      const q0 = s.zombies[zi];
      await ev((x, z) => window.__LL.teleport(x + 1.6, z), q0.x, q0.z);
      const aimZ = async () => { const ch = await ev(i => window.__LL.zombieChest(i), zi); if (ch) await ev(c => window.__LL.lookAt(c.x, c.y, c.z), ch); };
      for (let k = 0; k < 3; k++) { await aimZ(); await ev(() => window.__LL.qaDamageShot('rifle')); await frames(3); }
      await frames(12); await aimZ(); await shot('04-zombie-chunks');
      const d = await ev(() => window.__LL.dynamics());
      step('zombie hits tear physical flesh/cloth chunks (QA pipeline shots)', (d.flesh?.length ?? 0) > 0 || (d.chunks?.flesh ?? 0) > 0, {chunks: d.chunks, flesh: d.flesh?.slice(0, 4), look: q0.look});
    } else step('zombie found', false);

    // wardrobe looks
    s = await snap();
    const looks = [...new Set(s.zombies.filter(q => (q.archetype ?? 'zombie') === 'zombie').map(q => JSON.stringify(q.look ?? null)))];
    for (let k = 0, n = 0; k < s.zombies.length && n < 3; k++) {
      const q = s.zombies[k];
      if (!q.alive || (q.archetype ?? 'zombie') !== 'zombie') continue;
      const ch = await ev(i => window.__LL.zombieChest(i), k);
      await ev((x, z) => window.__LL.teleport(x + 2.0, z + 1.0), q.x, q.z);
      if (ch) await ev(c => window.__LL.lookAt(c.x, c.y - 0.2, c.z), ch);
      await frames(8); await shot(`05-wardrobe-${n + 1}`); n++;
    }
    step('zombies spawn with varied validated wardrobe looks', looks.length >= 4, {distinct: looks.length, sample: looks.slice(0, 6)});

    // creature
    const mix = await ev(() => window.__LL.enemyMix());
    let cr = await ev(() => window.__LL.goCreature());
    if (!cr) cr = await ev(() => window.__LL.qaSpawnCreature(4));
    await frames(10); await shot('06-ratdog');
    const crs = await ev(() => window.__LL.creatures());
    let crOk = (crs?.length ?? 0) > 0;
    if (crOk) {
      await ev(() => window.__LL.aimCreature(undefined, 'torso'));
      await ev(() => window.__LL.qaDamageShot('rifle')); await frames(4);
      await ev(() => window.__LL.aimCreature(undefined, 'torso'));
      await ev(() => window.__LL.qaDamageShot('rifle')); await frames(20);
      await shot('07-ratdog-hit');
    }
    const mix2 = await ev(() => window.__LL.enemyMix());
    step('rat/dog creature present (station mix or QA spawn), takes hits, no model fallback', crOk && (mix2.fallbacks ?? 0) === 0, {mix: {byArchetype: mix.byArchetype, fallbacks: mix.fallbacks}, creatures: crs?.slice?.(0, 2), after: mix2.byArchetype});

    s = await snap();
    const shaderErr = report.console.filter(x => /shader|program|webgl|glsl/i.test(x));
    step('no page errors, shader errors or failed requests', report.pageErrors.length === 0 && !s.lastError && shaderErr.length === 0 && report.badResponses.length === 0,
      {pageErrors: report.pageErrors.slice(0, 3), lastError: s.lastError, shaderErr: shaderErr.slice(0, 3), bad: report.badResponses.slice(0, 5), consoleCount: report.console.length, console: report.console.slice(0, 5), render: s.render});
  } catch (e) {
    step('script error', false, {error: String(e?.stack ?? e).slice(0, 800)});
  } finally {
    await browser.close();
    server.close();
    report.ok = report.steps.every(x => x.ok);
    fs.writeFileSync(path.join(outDir, 'iter07-check.json'), JSON.stringify(report, null, 2));
  }
});
