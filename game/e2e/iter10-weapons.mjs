// Iteration-10 brief smoke of the USER weapon models (normal start, no devpistol): real pistol start, all three guns
// held at hip + aimed (right mouse) + dropped in the world, pistol fire/reload/drop/pickup by ordinary input.
// ?qa=1 only reads state / aims / hands the long guns over for the look check (they are map finds in play).
// Usage: node game/e2e/iter10-weapons.mjs OUTDIR [--dist=dist/game] [--seed=1A2B3C]
import fs from 'node:fs';
import path from 'node:path';
import {launchBrowser, withBrowserLock} from '../../tools/qa/browser-env.mjs';
import {serveStatic} from '../../tools/qa/static-server.mjs';

const arg = (k, d) => (process.argv.find(a => a.startsWith(`--${k}=`)) ?? `--${k}=${d}`).split('=')[1];
const outDir = path.resolve(process.argv.find((a, i) => i > 1 && !a.startsWith('--')) ?? 'qa-artifacts/iter10-weapons');
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
  page.on('console', m => { if (['error', 'warn', 'warning'].includes(m.type())) report.console.push(`${m.type()}: ${m.text()}`.slice(0, 500)); });
  page.on('response', r => { if (r.status() >= 400) report.badResponses.push(`${r.status()} ${r.url()}`); });
  const ev = (fn, ...a) => page.evaluate(fn, ...a);
  const snap = () => ev(() => window.__LL.snapshot());
  const shot = async name => { const f = path.join(outDir, `${name}.png`); await page.screenshot({path: f}); report.screenshots.push(f); };
  const waitFor = async (fn, timeout = 20000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > timeout) return null; await sleep(250); } };
  const frames = n => ev(k => new Promise(res => { let i = 0; const t = setTimeout(() => res(i), 60000); const f = () => { if (++i >= k) { clearTimeout(t); res(i); } else requestAnimationFrame(f); }; requestAnimationFrame(f); }), n);
  const held = () => ev(() => { const s = window.__game.inv.selectedStack(); return s ? {itemId: s.itemId, mag: s.mag ?? null, uid: s.uid} : null; });
  const heldModel = () => ev(() => { const vm = window.__game.viewmodel; const it = vm.items?.get?.(vm.current); const names = []; it?.root.traverse(o => { if (o.isMesh) names.push(o.name); }); return {current: vm.current, meshes: names.slice(0, 4)}; });
  try {
    await page.goto(`http://127.0.0.1:${port}/index.html?qa=1&seed=${SEED}`);
    step('loads to title', !!(await waitFor(() => ev(() => !!window.__LL?.ready() && window.__LL.state() === 'title').catch(() => false), 480000)));
    await page.click('#btn-start');
    await waitFor(async () => (await snap()).state === 'playing', 180000);
    await sleep(2500);
    await ev(() => { const p = window.__game.player; setInterval(() => { if (p.hp > 0 && p.hp < p.maxHp) p.hp = p.maxHp; }, 100); });
    await ev(() => { const p = window.__game.player; p.pitch = 0; }); await frames(20);
    const h0 = await held(); const m0 = await heldModel();
    await shot('01-pistol-hip');
    step('normal start (no devpistol): holding the REAL pistol model', h0?.itemId === 'pistol' && !JSON.stringify(m0).includes('placeholder') && m0.meshes.length > 0, {held: h0, model: m0});
    await page.mouse.down({button: 'right'}); await frames(40); await shot('02-pistol-aim'); await page.mouse.up({button: 'right'}); await frames(10);
    const mag0 = (await held())?.mag;
    for (let k = 0; k < 3; k++) { await page.mouse.down(); await frames(2); await page.mouse.up(); await frames(14); }
    const mag1 = (await held())?.mag;
    await shot('03-pistol-fired');
    await page.keyboard.press('KeyR'); await frames(110);
    const mag2 = (await held())?.mag;
    step('pistol fires (ordinary clicks) and reloads (R)', mag1 < mag0 && mag2 > mag1, {mag: [mag0, mag1, mag2]});
    // long guns: hand them over (QA) to check held/aim looks; they are seeded map finds in normal play
    const finds = await ev(() => window.__LL.weaponFinds?.() ?? null);
    step('rifle and shotgun are seeded map finds (pistol start)', JSON.stringify(finds ?? '').includes('rifle') && JSON.stringify(finds ?? '').includes('shotgun'), {finds});
    await ev(() => { const g = window.__game, inv = g.inv; for (const [i, id, n] of [[1, 'rifle', 30], [2, 'shotgun', 6]]) { const at = {bar: 'hotbar', index: i}; if (inv.get(at)) { const j = inv.pack.findIndex(s => !s); if (j >= 0) inv.move(at, {bar: 'pack', index: j}); } inv.set(at, inv.makeStack(id, 1, n)); } });
    for (const [key, id] of [['Digit2', 'rifle'], ['Digit3', 'shotgun']]) {
      await page.keyboard.press(key); await frames(50);
      const hm = await heldModel();
      await shot(`04-${id}-hip`);
      await page.mouse.down({button: 'right'}); await frames(40); await shot(`05-${id}-aim`); await page.mouse.up({button: 'right'}); await frames(10);
      const a = (await held())?.mag; await page.mouse.down(); await frames(2); await page.mouse.up(); await frames(20); const b = (await held())?.mag;
      step(`${id}: user model held, aims and fires`, hm.current === id && hm.meshes.length > 0 && b < a, {model: hm, mag: [a, b]});
    }
    // world drops of all three (G), screenshot them on the floor
    for (const [key, id] of [['Digit1', 'pistol'], ['Digit2', 'rifle'], ['Digit3', 'shotgun']]) { await page.keyboard.press(key); await frames(30); await page.keyboard.press('KeyG'); await frames(30); }
    const drops = await ev(() => { const g = window.__game, p = g.player; return g.pickups.list.filter(q => ['pistol', 'rifle', 'shotgun'].includes(q.stack.itemId) && Math.hypot(q.x - p.x, q.z - p.z) < 4).map(q => ({id: q.stack.itemId, x: +q.x.toFixed(2), y: +q.y.toFixed(3), z: +q.z.toFixed(2)})); });
    if (drops.length) { const c = drops.reduce((a, d) => ({x: a.x + d.x / drops.length, z: a.z + d.z / drops.length}), {x: 0, z: 0}); await ev(c => window.__LL.lookAt(c.x, 0, c.z), c); await frames(10); }
    await shot('06-world-drops');
    let picked = null;
    const pd = drops.find(d => d.id === 'pistol');
    if (pd) { await ev(q => window.__LL.lookAt(q.x, q.y + 0.03, q.z), pd); await frames(6); const prompt = await page.$eval('#prompt', e => e.textContent).catch(() => null); await page.keyboard.press('KeyE'); await frames(20); picked = {prompt, back: await ev(() => window.__game.inv.hotbar.findIndex(s => s?.itemId === 'pistol'))}; }
    step('G drops all three as world pickups; E picks the pistol back up', drops.length === 3 && (picked?.back ?? -1) >= 0, {drops, picked});
    const shaderErr = report.console.filter(x => /shader|program|webgl|glsl/i.test(x));
    step('no page errors, shader errors or failed requests', report.pageErrors.length === 0 && shaderErr.length === 0 && report.badResponses.length === 0, {pageErrors: report.pageErrors.slice(0, 3), shaderErr: shaderErr.slice(0, 3), bad: report.badResponses.slice(0, 5)});
  } catch (e) {
    step('script error', false, {error: String(e?.stack ?? e).slice(0, 800)});
  } finally {
    await browser.close();
    server.close();
    report.ok = report.steps.every(x => x.ok);
    fs.writeFileSync(path.join(outDir, 'iter10-weapons.json'), JSON.stringify(report, null, 2));
  }
});
