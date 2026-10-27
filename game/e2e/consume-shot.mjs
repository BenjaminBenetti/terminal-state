// Targeted check: take a visible drink and screenshot the consume view mid-use (item at the face).
import fs from 'node:fs';
import path from 'node:path';
import {launchBrowser, withBrowserLock} from '../../tools/qa/browser-env.mjs';
import {serveStatic} from '../../tools/qa/static-server.mjs';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const out = path.resolve(process.argv[2] ?? 'qa-artifacts/consume-shot');
fs.mkdirSync(out, {recursive: true});
await withBrowserLock(async () => {
  const {server, port} = await serveStatic(path.resolve('dist/game'), {prefix: '/'});
  const browser = await launchBrowser();
  const page = await browser.newPage();
  await page.setViewport({width: 1280, height: 720});
  const ev = (fn, ...a) => page.evaluate(fn, ...a);
  const snap = () => ev(() => window.__LL.snapshot());
  const waitFor = async (fn, t = 30000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > t) return null; await sleep(250); } };
  await page.goto(`http://127.0.0.1:${port}/index.html?qa=1&seed=1A2B3C`);
  await waitFor(() => ev(() => !!window.__LL?.ready() && window.__LL.state() === 'title').catch(() => false), 300000);
  await page.click('#btn-start'); await waitFor(async () => (await snap()).state === 'playing'); await sleep(2000);
  const res = {};
  for (const item of ['water', 'chocolate']) {
    const t = await ev(id => window.__LL.aimLoot({itemId: id, visibleOnly: true}), item);
    if (!t) { res[item] = 'none visible'; continue; }
    await ev((x, z) => window.__LL.teleport(x, z), t.stand.x, t.stand.z); await sleep(300);
    await ev(o => window.__LL.aimLoot({serial: o.serial, itemId: o.itemId}), t); await sleep(500);
    await page.keyboard.press('KeyE'); await sleep(900);
    const s = await snap();
    const slot = s.hotbar.findIndex(h => h && h.itemId === item);
    if (slot < 0) { res[item] = 'not in hotbar'; continue; }
    // look level so the frame shows the viewmodel against the room
    await ev(() => { const p = window.__game.player; window.__LL.lookAt(p.x + Math.sin(p.yaw) * -5, 1.6, p.z + Math.cos(p.yaw) * -5); });
    await page.keyboard.press(`Digit${slot + 1}`); await sleep(600);
    await page.mouse.down(); await sleep(150); await page.mouse.up();
    const mid = await waitFor(async () => { const q = await snap(); return q.consume?.phase === 'use' && q.consume.itemVisible ? q : null; }, 30000);
    await sleep(300);
    await page.screenshot({path: path.join(out, `consume-${item}.png`)});
    res[item] = mid?.consume ?? null;
    await waitFor(async () => !(await snap()).consume?.busy, 90000);
  }
  console.log(JSON.stringify(res).slice(0, 800));
  await browser.close(); server.close();
});
