// Short iteration-04 browser check of the STATIC build (?qa=1): layout archetype + storefront views,
// Ctrl crouch, real-mouse inventory drag (slot->slot and out to the floor) with 3D icons, eat/drink
// consume view, rifle optic ADS, macro variety over New Station, no page/shader errors.
// Usage: node game/e2e/iter04-check.mjs OUTDIR [--dist=dist/game] [--seed=1A2B3C]
import fs from 'node:fs';
import path from 'node:path';
import {launchBrowser, withBrowserLock} from '../../tools/qa/browser-env.mjs';
import {serveStatic} from '../../tools/qa/static-server.mjs';

const arg = (k, d) => (process.argv.find(a => a.startsWith(`--${k}=`)) ?? `--${k}=${d}`).split('=')[1];
const outDir = path.resolve(process.argv.find((a, i) => i > 1 && !a.startsWith('--')) ?? 'qa-artifacts/iter04');
const dist = path.resolve(arg('dist', 'dist/game'));
const SEED = arg('seed', '1A2B3C');
fs.mkdirSync(outDir, {recursive: true});
const sleep = ms => new Promise(r => setTimeout(r, ms));
const report = {startedAt: new Date().toISOString(), dist, seed: SEED, steps: [], pageErrors: [], console: [], badResponses: [], screenshots: []};
const step = (name, ok, detail = {}) => { report.steps.push({name, ok, detail}); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`, JSON.stringify(detail).slice(0, 500)); return ok; };

await withBrowserLock(async () => {
  const {server, port} = await serveStatic(dist, {prefix: '/'});
  const browser = await launchBrowser();
  const page = await browser.newPage();
  await page.setViewport({width: 1280, height: 720});
  page.on('pageerror', e => report.pageErrors.push(String(e).slice(0, 600)));
  page.on('console', m => { if (['error', 'warn', 'warning'].includes(m.type())) report.console.push(`${m.type()}: ${m.text()}`.slice(0, 400)); });
  page.on('response', r => { if (r.status() >= 400) report.badResponses.push(`${r.status()} ${r.url()}`); });
  const ev = (fn, ...a) => page.evaluate(fn, ...a);
  const snap = () => ev(() => window.__LL.snapshot());
  const shot = async name => { const f = path.join(outDir, `${name}.png`); await page.screenshot({path: f}); report.screenshots.push(f); };
  const waitFor = async (fn, timeout = 20000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > timeout) return null; await sleep(250); } };
  const saveData = (name, url) => fs.writeFileSync(path.join(outDir, name), Buffer.from(url.split(',')[1], 'base64'));
  const viewHall = async (type, name) => {
    const s = await snap();
    const a = s.layout.areas.find(q => q.type === type);
    if (!a) return false;
    const cx = (a.x + a.w / 2) * 0.5, cz = (a.y + a.h / 2) * 0.5, wide = a.w >= a.h;
    // stand near one long side, look across at the opposite wall's storefronts
    const sx = wide ? cx - a.w * 0.15 : cx - a.w * 0.5 * 0.35, sz = wide ? cz - a.h * 0.5 * 0.35 : cz - a.h * 0.15;
    await ev((x, z) => window.__LL.teleport(x, z), sx, sz);
    await ev((x, z) => window.__LL.lookAt(x, 2.0, z), wide ? cx + a.w * 0.1 : cx + a.w * 0.5 * 0.45, wide ? cz + a.h * 0.5 * 0.45 : cz + a.h * 0.1);
    await sleep(2200);
    await shot(name);
    return true;
  };
  try {
    await page.goto(`http://127.0.0.1:${port}/index.html?qa=1&seed=${SEED}`);
    const ready = await waitFor(() => ev(() => !!window.__LL?.ready() && window.__LL.state() === 'title').catch(() => false), 300000);
    step('loads to title', !!ready);
    await page.click('#btn-start');
    await waitFor(async () => (await snap()).state === 'playing');
    await sleep(2500);
    let s = await snap();
    const types = {};
    for (const a of s.layout.areas) types[a.type] = (types[a.type] ?? 0) + 1;
    const lay = {archetype: s.layout.archetype, tracks: s.layout.tracks, storefronts: s.layout.storefronts?.length, uses: [...new Set((s.layout.storefronts ?? []).map(f => f.use))], areas: s.layout.areas.length, types, zombies: s.zombies.length, genMs: s.genMs, render: s.render};
    step('enters play; layout has an archetype and wall-embedded storefronts', s.state === 'playing' && !!lay.archetype && lay.storefronts > 0, lay);
    saveData('map-1.png', await ev(() => window.__LL.mapImage(3)));
    await shot('01-spawn');
    step('food/water 80 at start', Math.round(s.survival.hunger) === 80 && Math.round(s.survival.thirst) === 80, s.survival);

    // storefront halls
    const viewed = {};
    for (const [t, n] of [['food-court', '02-food-court'], ['retail-arcade', '03-retail-arcade'], ['concourse', '04-concourse']]) viewed[t] = await viewHall(t, n);
    step('food court / arcade views captured', viewed['food-court'] || viewed['retail-arcade'], viewed);

    // Ctrl crouch (tap toggles)
    await page.keyboard.press('Control');
    const crouched = await waitFor(async () => { const q = await snap(); return q.player.crouched ? q : null; }, 8000);
    const tag = await page.$eval('#stance-tag', e => e.textContent).catch(() => null);
    await page.keyboard.press('Control');
    const stood = await waitFor(async () => { const q = await snap(); return !q.player.crouched ? q : null; }, 8000);
    step('Ctrl crouches and Ctrl stands', !!crouched && !!stood, {crouchedEye: crouched?.player.eye, tag, stoodEye: stood?.player.eye});

    // inventory: real mouse drag hotbar:4 (bandage) -> pack:0, then pack:0 -> out (drops to floor)
    await page.keyboard.press('Tab');
    await waitFor(async () => (await snap()).state === 'inventory', 6000);
    await sleep(800);
    s = await snap();
    const icons = s.icons;
    const drag = async (from, to) => {
      const a = await ev(sp => window.__LL.invPoint(sp), from), b = await ev(sp => window.__LL.invPoint(sp), to);
      if (!a || !b) return {error: 'no point', a, b};
      await page.mouse.move(a.x, a.y); await page.mouse.down();
      for (let k = 1; k <= 6; k++) { await page.mouse.move(a.x + (b.x - a.x) * k / 6, a.y + (b.y - a.y) * k / 6); await sleep(40); }
      await page.mouse.up(); await sleep(500);
      return (await snap()).invUi.lastDrop;
    };
    const before = {hotbar: s.hotbar, pack: s.pack, pickups: s.pickups.length};
    const src = s.hotbar.findIndex((h, i) => i > 0 && h), empty = s.pack.findIndex(q => !q);
    const srcItem = s.hotbar[src]?.itemId;
    const d1 = await drag(`hotbar:${src}`, `pack:${empty}`);
    s = await snap();
    const moved = !s.hotbar[src] && s.pack[empty]?.itemId === srcItem;
    await shot('05-inventory-3d-icons');
    const d2 = await drag(`pack:${empty}`, 'out');
    await sleep(800);
    s = await snap();
    const dropped = !s.pack[empty] && s.pickups.length === before.pickups + 1 && s.pickups.some(p => p.itemId === srcItem);
    step('real mouse drag moves a stack and dragging out drops it; invariants hold; 3D icons rendered', moved && dropped && (!s.invariants || s.invariants.length === 0) && icons && icons.count >= 10 && (icons.failed ?? []).length === 0,
      {d1, d2, moved, dropped, invariants: s.invariants, icons});
    saveData('icon-sheet.png', await ev(() => window.__LL.iconSheet()));
    await page.keyboard.press('Tab');
    await waitFor(async () => (await snap()).state === 'playing', 6000);
    await sleep(500);

    // consume view: take a visible drink, hold it, drink -> item to face, gun returns after
    let cOk = false, cDetail = {};
    const target = await ev(() => window.__LL.aimLoot({itemId: 'water', visibleOnly: true}) ?? window.__LL.aimLoot({itemId: 'cola', visibleOnly: true}) ?? window.__LL.aimLoot({itemId: 'juice', visibleOnly: true}));
    if (target) {
      await ev((x, z) => window.__LL.teleport(x, z), target.stand.x, target.stand.z);
      await sleep(400);
      await ev(o => window.__LL.aimLoot({serial: o.serial, itemId: o.itemId}), target);
      await sleep(600);
      await page.keyboard.press('KeyE');
      await sleep(900);
      s = await snap();
      const slot = s.hotbar.findIndex(h => h && h.itemId === target.itemId);
      if (slot >= 0) {
        await page.keyboard.press(`Digit${slot + 1}`); await sleep(700);
        const thirst0 = (await snap()).survival.thirst;
        await page.mouse.down(); await sleep(150); await page.mouse.up();
        const mid = await waitFor(async () => { const q = await snap(); return q.consume && q.consume.itemVisible && q.consume.phase === 'use' ? q : null; }, 30000);
        await shot('06-drinking-item-to-face');
        const done = await waitFor(async () => { const q = await snap(); return q.survival.thirst > thirst0 + 5 ? q : null; }, 90000);
        await page.keyboard.press('Digit1');
        const back = await waitFor(async () => { const q = await snap(); return q.weapon.id === 'rifle' && (!q.consume || !q.consume.itemVisible) ? q : null; }, 30000);
        cOk = !!mid && !!done && !!back;
        cDetail = {item: target.itemId, midConsume: mid?.consume, thirst: [thirst0, done?.survival.thirst], rifleBack: !!back};
      } else cDetail = {error: 'item not in hotbar', hotbar: s.hotbar};
    } else cDetail = {error: 'no visible drink found'};
    step('drinking shows the actual item at the face, restores thirst, rifle returns', cOk, cDetail);

    // rifle optic ADS
    await page.keyboard.press('Digit1'); await sleep(600);
    await page.mouse.down({button: 'right'});
    const ads = await waitFor(async () => { const q = await snap(); return q.optic && q.optic.clarity > 0.8 ? q : null; }, 30000);
    await sleep(400);
    await shot('07-rifle-optic-ads');
    await page.mouse.up({button: 'right'});
    step('rifle ADS looks through a clear optic with the HUD crosshair hidden', !!ads && ads.optic.crosshairHidden, {optic: ads?.optic ?? (await snap()).optic});
    await sleep(800);
    await shot('08-rifle-hip');

    // macro variety: two New Stations
    const arch = [lay.archetype];
    for (let r = 0; r < 2; r++) {
      await page.keyboard.press('Escape');
      await waitFor(async () => (await snap()).state === 'paused', 6000);
      await page.click('#btn-new-station');
      await waitFor(async () => (await snap()).state === 'playing', 60000);
      await sleep(1500);
      s = await snap();
      arch.push(s.layout.archetype);
      saveData(`map-${r + 2}.png`, await ev(() => window.__LL.mapImage(3)));
      await shot(`09-new-station-${r + 1}`);
    }
    const au = await ev(() => window.__LL.audio());
    step('New Station produces new stations (archetypes recorded); one running AudioContext', s.state === 'playing' && au.contexts === 1, {archetypes: arch, audio: {contexts: au.contexts, state: au.state}});
    const shaderErr = report.console.filter(c => /shader|program|webgl/i.test(c));
    step('no page errors, shader errors or failed requests', report.pageErrors.length === 0 && !s.lastError && shaderErr.length === 0 && report.badResponses.length === 0,
      {pageErrors: report.pageErrors.slice(0, 3), lastError: s.lastError, shaderErr: shaderErr.slice(0, 3), bad: report.badResponses.slice(0, 3), consoleCount: report.console.length, render: s.render});
  } catch (e) {
    step('script error', false, {error: String(e?.stack ?? e).slice(0, 800)});
  } finally {
    await browser.close();
    server.close();
    report.ok = report.steps.every(x => x.ok);
    fs.writeFileSync(path.join(outDir, 'iter04-check.json'), JSON.stringify(report, null, 2));
  }
});
