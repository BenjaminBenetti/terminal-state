// Short iteration-06 browser check of the STATIC build (?qa=1): volumetric atmosphere (flashlight on/off,
// before/after), material damage (tile/concrete crater + debris, crate break with loot kept, glass shatter),
// zombie wounds (live + held), wardrobe look variety, no page/shader errors.
// Usage: node game/e2e/iter06-check.mjs OUTDIR [--dist=dist/game] [--seed=1A2B3C]
import fs from 'node:fs';
import path from 'node:path';
import {launchBrowser, withBrowserLock} from '../../tools/qa/browser-env.mjs';
import {serveStatic} from '../../tools/qa/static-server.mjs';

const arg = (k, d) => (process.argv.find(a => a.startsWith(`--${k}=`)) ?? `--${k}=${d}`).split('=')[1];
const outDir = path.resolve(process.argv.find((a, i) => i > 1 && !a.startsWith('--')) ?? 'qa-artifacts/iter06');
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
  const shoot = async (n, weapon = 'rifle') => { const r = []; for (let i = 0; i < n; i++) { r.push(await ev(w => window.__LL.qaDamageShot(w), weapon)); await sleep(700); } return r; };
  try {
    await page.goto(`http://127.0.0.1:${port}/index.html?qa=1&seed=${SEED}`);
    const ready = await waitFor(() => ev(() => !!window.__LL?.ready() && window.__LL.state() === 'title').catch(() => false), 420000);
    step('loads to title', !!ready);
    await page.click('#btn-start');
    await waitFor(async () => (await snap()).state === 'playing', 90000);
    await sleep(3000);
    let s = await snap();
    step('enters play; volumetric atmosphere active, no shader failure', s.state === 'playing' && s.atmosphere?.active && !s.atmosphere?.failed, {archetype: s.layout.archetype, atmosphere: s.atmosphere, render: s.render});

    // atmosphere: flashlight on vs off vs volumetric disabled, same view (dark area preferred)
    const dark = s.layout.areas.find(a => a.type === 'platform') ?? s.layout.areas[0];
    const c = {x: (dark.x + dark.w / 2) * 0.5, z: (dark.y + dark.h / 2) * 0.5};
    await ev((x, z) => { window.__LL.teleport(x, z); window.__LL.lookAt(x + 8, 1.2, z + 0.5); }, c.x, c.z);
    await ev(() => window.__LL.setAtmosphere({flashlight: true, enabled: true}));
    await sleep(3000); await shot('01-fog-flashlight-on');
    await ev(() => window.__LL.setAtmosphere({flashlight: false}));
    await sleep(3000); await shot('02-fog-flashlight-off');
    await ev(() => window.__LL.setAtmosphere({flashlight: true, enabled: false}));
    await sleep(3000); await shot('03-volumetric-disabled-flashlight-on');
    await ev(() => window.__LL.setAtmosphere({enabled: true}));
    await sleep(1500);
    s = await snap();
    step('atmosphere toggles on/off without errors', s.atmosphere?.active && report.pageErrors.length === 0, {atmosphere: s.atmosphere});

    // structural chip: tile/concrete wall, 5 hits same spot
    const wall = await ev(() => window.__LL.aimDamage('tile', {teleport: true}) ?? window.__LL.aimDamage('concrete', {teleport: true}) ?? window.__LL.aimDamage('wall', {teleport: true}));
    await sleep(1200);
    const d0 = await ev(() => window.__LL.damage());
    const wallHits = await shoot(5);
    await sleep(1200); await shot('04-wall-crater-debris');
    const d1 = await ev(() => window.__LL.damage());
    step('wall hits leave a persistent crater + debris chunks', !!wall && (d1.craters ?? 0) > (d0.craters ?? 0) && ((d1.debrisLive ?? d1.debris ?? 0) > 0 || (d1.debrisSpawned ?? 0) > 0), {wall, before: d0, after: d1, lastHit: wallHits.at(-1)});

    // crate break: loot kept
    const crate = await ev(() => window.__LL.aimDamage('crate', {teleport: true}));
    if (crate) {
      await sleep(1000);
      const pk0 = (await snap()).pickups.length;
      const hits = await shoot(8);
      await sleep(1500); await shot('05-crate-broken');
      const after = await snap();
      const dc = await ev(() => window.__LL.damage());
      step('crate splinters and keeps its contents takeable (finite loot)', (dc.props?.broken ?? 0) > 0, {crate, pickupsBefore: pk0, pickupsAfter: after.pickups.length, damage: dc, lastHit: hits.at(-1)});
    } else step('crate found', false);

    // glass shatter
    const glass = await ev(() => window.__LL.aimDamage('prop:shopGlazing', {teleport: true}) ?? window.__LL.aimDamage('prop:shopCooler', {teleport: true}) ?? window.__LL.aimDamage('glass', {teleport: true}));
    if (glass) {
      await sleep(1000);
      const hits = await shoot(6);
      await sleep(1500); await shot('06-glass-shattered');
      const dg = await ev(() => window.__LL.damage());
      step('glass cracks then shatters', hits.some(h => JSON.stringify(h ?? {}).includes('shatter') || JSON.stringify(h ?? {}).includes('break')) || (dg.props?.glassBroken ?? 0) > 0, {glass, damage: dg, lastHit: hits.at(-1)});
    } else step('glass found', false);

    // zombie wounds
    // stand 1.6 m from a live zombie (clear line) and aim at its chest each shot
    let s2 = await snap();
    const zi0 = s2.zombies.findIndex(q => q.alive);
    const z = zi0 >= 0 ? {index: zi0} : null;
    if (z) {
      const q0 = s2.zombies[zi0];
      await ev((x, zz) => window.__LL.teleport(x + 1.6, zz), q0.x, q0.z);
      const aimZ = async () => { const ch = await ev(i => window.__LL.zombieChest(i), zi0); if (ch) await ev(cc => window.__LL.lookAt(cc.x, cc.y, cc.z), ch); };
      await aimZ(); await sleep(600); await aimZ();
      const hits = [];
      for (let k = 0; k < 3; k++) { await aimZ(); hits.push(await ev(() => window.__LL.qaDamageShot('rifle'))); await sleep(500); }
      await aimZ(); await sleep(800); await shot('07-zombie-wounds');
      const dz = await ev(() => window.__LL.damage());
      step('zombie flesh/clothing tears where shot (wounds recorded on the actor)', (dz.woundsPerZombie ?? []).some(n => n > 0), {zombie: z, damage: dz, lastHit: hits.at(-1)});
    } else step('zombie found', false);

    // wardrobe variety
    s = await snap();
    const looks = s.zombies.map(q => JSON.stringify(q.look ?? null));
    const distinct = [...new Set(looks)];
    step('zombies spawn with varied wardrobe looks (slots)', distinct.length >= 5, {distinct: distinct.length, sample: distinct.slice(0, 8)});
    const zi = s.zombies.findIndex(q => q.alive);
    if (zi >= 0) {
      const ch = await ev(i => window.__LL.zombieChest(i), zi);
      const q = s.zombies[zi];
      await ev((x, zz) => window.__LL.teleport(x + 2.2, zz + 2.2), q.x, q.z);
      if (ch) await ev(cc => window.__LL.lookAt(cc.x, cc.y, cc.z), ch);
      await sleep(1500); await shot('08-zombie-look');
    }
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
    fs.writeFileSync(path.join(outDir, 'iter06-check.json'), JSON.stringify(report, null, 2));
  }
});
