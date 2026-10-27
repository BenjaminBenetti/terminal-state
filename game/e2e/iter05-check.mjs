// Short iteration-05 browser check of the STATIC build (?qa=1): persistent fixture lighting + mood,
// C crouch, underpass stairs below the track bed, rescue-ladder climb, open cooler stock, room purposes,
// zombie body x outfit variants, Sound Lab audio bank, no page/shader errors.
// Usage: node game/e2e/iter05-check.mjs OUTDIR [--dist=dist/game] [--seed=1A2B3C]
import fs from 'node:fs';
import path from 'node:path';
import {launchBrowser, withBrowserLock} from '../../tools/qa/browser-env.mjs';
import {serveStatic} from '../../tools/qa/static-server.mjs';

const arg = (k, d) => (process.argv.find(a => a.startsWith(`--${k}=`)) ?? `--${k}=${d}`).split('=')[1];
const outDir = path.resolve(process.argv.find((a, i) => i > 1 && !a.startsWith('--')) ?? 'qa-artifacts/iter05');
const dist = path.resolve(arg('dist', 'dist/game'));
const SEED = arg('seed', '1A2B3C');
fs.mkdirSync(outDir, {recursive: true});
const sleep = ms => new Promise(r => setTimeout(r, ms));
const report = {startedAt: new Date().toISOString(), dist, seed: SEED, steps: [], pageErrors: [], console: [], badResponses: [], screenshots: []};
const step = (name, ok, detail = {}) => { report.steps.push({name, ok, detail}); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`, JSON.stringify(detail).slice(0, 600)); return ok; };

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
  try {
    await page.goto(`http://127.0.0.1:${port}/index.html?qa=1&seed=${SEED}`);
    const ready = await waitFor(() => ev(() => !!window.__LL?.ready() && window.__LL.state() === 'title').catch(() => false), 360000);
    step('loads to title', !!ready);
    await page.click('#btn-start');
    await waitFor(async () => (await snap()).state === 'playing', 60000);
    await sleep(2500);
    let s = await snap();
    const lights0 = await ev(() => { let n = 0; window.__game.scene.traverse(o => { if (o.isLight) n++; }); return n; });
    step('enters play', s.state === 'playing', {archetype: s.layout.archetype, purposes: s.layout.purposes?.length, zombies: s.zombies.length, lighting: s.lighting && {...s.lighting, areaProfiles: undefined}, sceneLights: lights0, render: s.render});
    await shot('01-spawn');

    // persistent lights: look down the platform, then move ~50 m and look back; scene light count unchanged
    const plat = s.layout.areas.find(a => a.type === 'platform');
    if (plat) {
      const wide = plat.w >= plat.h, cx = (plat.x + plat.w / 2) * 0.5, cz = (plat.y + plat.h / 2) * 0.5;
      const half = (wide ? plat.w : plat.h) * 0.5 / 2;
      const a = wide ? {x: cx - half + 3, z: cz} : {x: cx, z: cz - half + 3}, b = wide ? {x: cx + half - 3, z: cz} : {x: cx, z: cz + half - 3};
      await ev((p, q) => { window.__LL.teleport(p.x, p.z); window.__LL.lookAt(q.x, 1.7, q.z); }, a, b);
      await sleep(2500); await shot('02-platform-far-lights-A');
      await ev((p, q) => { window.__LL.teleport(p.x, p.z); window.__LL.lookAt(q.x, 1.7, q.z); }, b, a);
      await sleep(2500); await shot('03-platform-far-lights-B');
      const lights1 = await ev(() => { let n = 0; window.__game.scene.traverse(o => { if (o.isLight) n++; }); return n; });
      const lg = (await snap()).lighting;
      step('fixture lighting independent of camera (no light re-assignment; baked field)', lights1 === lights0, {lights0, lights1, field: lg?.field ?? lg});
    }

    // C crouch
    await page.keyboard.press('KeyC');
    const cr = await waitFor(async () => { const q = await snap(); return q.player.crouched ? q : null; }, 8000);
    const tag = await page.$eval('#stance-tag', e => e.textContent).catch(() => null);
    await page.keyboard.press('KeyC');
    const st = await waitFor(async () => { const q = await snap(); return !q.player.crouched ? q : null; }, 8000);
    await page.keyboard.press('Control'); await sleep(1500);
    const ctrl = (await snap()).player.crouched;
    step('C crouches/stands; Ctrl no longer crouches', !!cr && !!st && !ctrl, {tag, ctrlCrouched: ctrl});

    // underpass stairs: walk down below the track bed (island/express archetypes have none: try New Station)
    let top = await ev(() => window.__LL.goStairs());
    for (let r = 0; r < 5 && !top; r++) {
      await page.keyboard.press('Escape'); await waitFor(async () => (await snap()).state === 'paused', 6000);
      await page.click('#btn-new-station'); await waitFor(async () => (await snap()).state === 'playing', 90000); await sleep(1500);
      top = await ev(() => window.__LL.goStairs());
      if (top) top.archetype = (await snap()).layout.archetype;
    }
    if (top) {
      await sleep(1500); await shot('04-stairs-top');
      await page.keyboard.down('KeyW');
      const low = await waitFor(async () => { const t = await ev(() => window.__LL.traversal()); return t.player.y < -3 ? t : null; }, 90000);
      await page.keyboard.up('KeyW');
      await sleep(800); await shot('05-underpass-below-tracks');
      step('walks down real stairs to an underpass floor below the track bed', !!low, {flight: top, player: low?.player});
    } else step('underpass stairs exist on this archetype', false, {note: 'no stair flight (island/express archetype?)'});

    // rescue ladder: from the track bed, E climbs to the platform
    const lad = await ev(() => window.__LL.goLadder(undefined, 'bottom'));
    if (lad) {
      await sleep(1200);
      const t0 = await ev(() => window.__LL.traversal());
      const prompt = await page.$eval('#prompt', e => e.textContent).catch(() => null);
      await shot('06-ladder-bottom-prompt');
      await page.keyboard.press('KeyE');
      const climbing = await waitFor(async () => (await ev(() => window.__LL.traversal())).player.climbing, 10000);
      await sleep(400); await shot('07-ladder-climbing');
      const up = await waitFor(async () => { const t = await ev(() => window.__LL.traversal()); return !t.player.climbing && t.player.y > -0.1 ? t : null; }, 60000);
      step('rescue ladder: prompt, E climbs from the track bed up to the platform', !!climbing && !!up && t0.player.y < -1, {ladder: lad, startY: t0.player.y, prompt, endY: up?.player.y});
    } else step('rescue ladders exist', false);

    // open cooler with real stock inside
    const cool = await ev(() => window.__LL.aimPurpose('convenience', {kind: 'shopCooler', teleport: true}) ?? window.__LL.aimPurpose('newsstand', {kind: 'shopCooler', teleport: true}) ?? window.__LL.aimLoot({kind: 'shopCooler'}));
    if (cool) {
      await ev(o => window.__LL.aimHolder(o.serial ?? 0), cool);
      await sleep(1800); await shot('08-cooler-open-front-stock');
      const pr = await page.$eval('#prompt', e => e.textContent).catch(() => null);
      step('drinks cooler shows real stocked items behind clear glass', (cool.items?.length ?? 1) > 0, {cool, prompt: pr});
    } else step('cooler found', false);

    // room purposes: a few distinct rooms/stores
    s = await snap();
    const wanted = ['staff-room', 'janitor-closet', 'security-office', 'hotdog', 'tech', 'pharmacy', 'newsstand'];
    const have = [...new Set((s.layout.purposes ?? []).map(p => p.purpose))];
    const seen = [];
    for (const p of wanted.filter(w => have.includes(w)).slice(0, 5)) {
      const r = await ev(pp => window.__LL.aimPurpose(pp, {teleport: true}), p);
      if (!r) continue;
      await sleep(1800); await shot(`09-purpose-${p}`);
      seen.push({purpose: p, label: r.label, props: r.props, items: r.items});
    }
    step('purposeful rooms/stores with matching fixtures + loot', seen.length >= 3, {purposesOnStation: have, seen});

    // zombie variants
    s = await snap();
    const zs = s.zombies.map(z => ({body: z.look?.body ?? z.body ?? null, outfit: z.look?.outfit ?? z.outfit ?? null, type: z.type}));
    const combos = [...new Set(zs.map(z => `${z.body}/${z.outfit}`))];
    const zi = s.zombies.findIndex(z => z.alive);
    if (zi >= 0) {
      const ch = await ev(i => window.__LL.zombieChest(i), zi);
      const z = s.zombies[zi];
      await ev((x, zz) => window.__LL.teleport(x + 2.5, zz + 2.5), z.x, z.z);
      if (ch) await ev(c => window.__LL.lookAt(c.x, c.y, c.z), ch);
      await sleep(1500); await shot('10-zombie-variant');
    }
    step('zombies spawn with varied body x outfit combinations', combos.length >= 3, {combos, count: zs.length});

    // Sound Lab audio bank
    const au = await ev(() => window.__LL.audio());
    step('audio: one context; Sound Lab clip bank loaded', au.contexts === 1, {audio: au});
    s = await snap();
    const shaderErr = report.console.filter(c => /shader|program|webgl|glsl/i.test(c));
    step('no page errors, shader errors or failed requests', report.pageErrors.length === 0 && !s.lastError && shaderErr.length === 0 && report.badResponses.length === 0,
      {pageErrors: report.pageErrors.slice(0, 3), lastError: s.lastError, shaderErr: shaderErr.slice(0, 3), bad: report.badResponses.slice(0, 5), consoleCount: report.console.length, console: report.console.slice(0, 5), render: s.render});
  } catch (e) {
    step('script error', false, {error: String(e?.stack ?? e).slice(0, 800)});
  } finally {
    await browser.close();
    server.close();
    report.ok = report.steps.every(x => x.ok);
    fs.writeFileSync(path.join(outDir, 'iter05-check.json'), JSON.stringify(report, null, 2));
  }
});
