// Iteration-09 short browser check of the pistol flow (?qa=1&devpistol=1 — since 2026-10-28 the flag is redundant and the
// real user pistol.glb is shown, not the placeholder) plus the normal default loadout (no devpistol). Real input: frame-synced mouse fire, R reload, G drop,
// E pick up, digit slot select. QA hooks only aim/read state.
// Usage: node game/e2e/iter09-pistol.mjs OUTDIR [--dist=dist/game] [--seed=1A2B3C]
import fs from 'node:fs';
import path from 'node:path';
import {launchBrowser, withBrowserLock} from '../../tools/qa/browser-env.mjs';
import {serveStatic} from '../../tools/qa/static-server.mjs';

const arg = (k, d) => (process.argv.find(a => a.startsWith(`--${k}=`)) ?? `--${k}=${d}`).split('=')[1];
const outDir = path.resolve(process.argv.find((a, i) => i > 1 && !a.startsWith('--')) ?? 'qa-artifacts/iter09-pistol');
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
  const frames = n => ev(k => new Promise(res => { let i = 0; const t = setTimeout(() => res(i), 60000); const f = () => { if (++i >= k) { clearTimeout(t); res(i); } else requestAnimationFrame(f); }; requestAnimationFrame(f); }), n);
  const held = () => ev(() => { const g = window.__game, s = g.inv.selectedStack(); return s ? {itemId: s.itemId, mag: s.mag ?? null, uid: s.uid} : null; });
  const ammo = id => ev(i => window.__game.inv.count(i), id);
  const start = async q => {
    await page.goto(`http://127.0.0.1:${port}/index.html?qa=1&seed=${SEED}${q}`);
    const ready = await waitFor(() => ev(() => !!window.__LL?.ready() && window.__LL.state() === 'title').catch(() => false), 480000);
    await page.click('#btn-start');
    await waitFor(async () => (await snap()).state === 'playing', 180000);
    await sleep(2500);
    await ev(() => { const p = window.__game.player; window.__qaHeal = setInterval(() => { if (p.hp > 0 && p.hp < p.maxHp) p.hp = p.maxHp; }, 100); });
    return ready;
  };
  try {
    // A) normal default (no devpistol): usable visible starting weapon, no pistol anywhere, no guaranteed spawn shotgun
    step('default build loads to title', !!(await start('')));
    const h0 = await held();
    const finds0 = await ev(() => window.__LL.weaponFinds?.() ?? null);
    await shot('a1-default-start');
    const nearShotgun = (finds0?.finds ?? finds0 ?? []).filter?.(f => f.itemId === 'shotgun' && (f.distFromSpawn ?? f.dist ?? 99) < 15) ?? [];
    // 2026-10-28: the user's pistol.glb is in (PISTOL_ART_READY), so the normal default now starts with the real pistol.
    step('default start: pistol held (user model, no devpistol flag); no pistol finds; no shotgun beside spawn', h0?.itemId === 'pistol' && !JSON.stringify(finds0 ?? '').includes('"pistol"') && nearShotgun.length === 0, {held: h0, finds: finds0});

    // B) devpistol: pistol start + real input weapon flow
    step('devpistol build loads to title', !!(await start('&devpistol=1')));
    let h = await held();
    await shot('b1-devpistol-start');
    step('devpistol: starts holding the pistol (real pistol.glb; the flag is redundant now)', h?.itemId === 'pistol', {held: h, snapshotHeld: (await snap()).held});
    const r0 = await ammo('ammo_9mm');
    const m0 = h?.mag;
    for (let k = 0; k < 3; k++) { await page.mouse.down(); await frames(2); await page.mouse.up(); await frames(14); }
    h = await held();
    await shot('b2-pistol-fired');
    step('ordinary mouse clicks fire the pistol (magazine decreases, finite)', m0 !== null && h?.mag < m0, {mag: [m0, h?.mag]});
    await page.keyboard.press('KeyR'); await frames(120);
    const h2 = await held(); const r1 = await ammo('ammo_9mm');
    step('R reloads from finite reserve ammo', h2?.mag > h?.mag && r1 < r0, {mag: [h?.mag, h2?.mag], reserve: [r0, r1]});
    await page.keyboard.press('KeyG'); await frames(40);
    const after = await held();
    const drop = await ev(() => { const g = window.__game, p = g.player; const pk = g.pickups.list.filter(q => q.stack.itemId === 'pistol').sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z))[0]; return pk ? {x: pk.x, y: pk.y, z: pk.z} : null; });
    await shot('b3-pistol-dropped');
    step('G drops the pistol as a world pickup', after?.itemId !== 'pistol' && !!drop, {held: after, drop});
    if (drop) {
      await ev(q => window.__LL.lookAt(q.x, q.y + 0.04, q.z), drop); await frames(6);
      const prompt = await page.$eval('#prompt', e => e.textContent).catch(() => null);
      await page.keyboard.press('KeyE'); await frames(20);
      const back = await ev(() => window.__game.inv.hotbar.findIndex(s => s?.itemId === 'pistol'));
      if (back >= 0) { await page.keyboard.press(`Digit${back + 1}`); await frames(30); }
      const h3 = await held();
      step('E picks the pistol back up; slot key selects it again (same uid)', h3?.itemId === 'pistol' && h3.uid === h2?.uid, {prompt, slot: back, held: h3});
    }
    const finds = await ev(() => window.__LL.weaponFinds?.() ?? null);
    step('devpistol: rifle and shotgun are seeded map finds away from spawn', JSON.stringify(finds ?? '').includes('rifle') && JSON.stringify(finds ?? '').includes('shotgun'), {finds});
    const shaderErr = report.console.filter(x => /shader|program|webgl|glsl/i.test(x));
    step('no page errors, shader errors or failed requests', report.pageErrors.length === 0 && shaderErr.length === 0 && report.badResponses.length === 0, {pageErrors: report.pageErrors.slice(0, 3), shaderErr: shaderErr.slice(0, 3), bad: report.badResponses.slice(0, 5)});
  } catch (e) {
    step('script error', false, {error: String(e?.stack ?? e).slice(0, 800)});
  } finally {
    await browser.close();
    server.close();
    report.ok = report.steps.every(x => x.ok);
    fs.writeFileSync(path.join(outDir, 'iter09-pistol.json'), JSON.stringify(report, null, 2));
  }
});
