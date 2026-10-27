// Quick visual check of the built game: start a seeded station and capture a few views.
// Usage: node tools/qa/shots.mjs outDir seedCode [quality]
import fs from 'node:fs';
import path from 'node:path';
import {launchBrowser, withBrowserLock} from './browser-env.mjs';
import {serveStatic} from './static-server.mjs';

const [outDir = 'qa-artifacts/shots', seed = '1A2B3C', quality = 'high'] = process.argv.slice(2);
fs.mkdirSync(outDir, {recursive: true});
const sleep = ms => new Promise(r => setTimeout(r, ms));
await withBrowserLock(async () => {
  const {server, port} = await serveStatic(path.resolve('dist/game'), {prefix: '/'});
  const browser = await launchBrowser();
  const page = await browser.newPage();
  await page.setViewport({width: 1280, height: 720});
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warn') errors.push(m.type() + ': ' + m.text()); });
  try {
    const t0 = Date.now();
    await page.goto(`http://127.0.0.1:${port}/index.html?qa=1&seed=${seed}&quality=${quality}`);
    for (let i = 0; i < 400; i++) { if (await page.evaluate(() => window.__LL?.ready() && window.__LL.state() === 'title').catch(() => false)) break; await sleep(500); }
    console.log('ready after', Date.now() - t0, 'ms');
    await page.screenshot({path: path.join(outDir, 'title.png')});
    await page.click('#btn-start');
    await sleep(2500);
    const s = await page.evaluate(() => window.__LL.snapshot());
    console.log(JSON.stringify({state: s.state, name: s.name, world: s.world, render: s.render, memory: s.memory, zombies: s.zombies, genMs: s.genMs, lastError: s.lastError}));
    const t1 = Date.now(); const f0 = s.frames; await sleep(5000); const f1 = (await page.evaluate(() => window.__LL.snapshot())).frames;
    console.log('fps (software)', ((f1 - f0) / ((Date.now() - t1) / 1000)).toFixed(1));
    await page.screenshot({path: path.join(outDir, 'spawn.png')});
    const views = JSON.parse(process.env.VIEWS ?? '[]');
    for (const v of views) {
      await page.evaluate(v => { if (v.x !== undefined) window.__LL.teleport(v.x, v.z, v.yaw); if (v.look) window.__LL.lookAt(...v.look); else if (v.pitch !== undefined) window.__game.player.pitch = v.pitch; }, v);
      if (v.pickup) {
        const pk = (await page.evaluate(() => window.__LL.snapshot())).pickups.find(p => p.itemId === v.pickup);
        if (pk) { await page.evaluate(pk => { window.__LL.teleport(pk.x + 1.0, pk.z); window.__LL.lookAt(pk.x, pk.y + 0.05, pk.z); }, pk); await sleep(600); await page.keyboard.press('KeyE'); await sleep(500); }
      }
      for (const k of v.keys ?? []) { await page.keyboard.press(k); await sleep(400); }
      if (v.look2) await page.evaluate(l => window.__LL.lookAt(...l), v.look2);
      if (v.rmb) await page.mouse.down({button: 'right'});
      if (v.fire) await page.mouse.down();
      await sleep(v.wait ?? 2500);
      await page.screenshot({path: path.join(outDir, v.name + '.png')});
      if (v.fire) await page.mouse.up();
      if (v.rmb) await page.mouse.up({button: 'right'});
    }
    // zombie close-ups: teleport near each of the first two zombies and look at them
    for (let i = 0; i < Math.min(2, s.zombies.length); i++) {
      const z = (await page.evaluate(() => window.__LL.snapshot())).zombies[i];
      await page.evaluate((z) => { window.__LL.teleport(z.x + 2.6, z.z + 0.2); }, z);
      await sleep(300);
      const c = await page.evaluate(i => window.__LL.zombieChest(i), i);
      if (c) await page.evaluate(c => window.__LL.lookAt(c.x, c.y, c.z), c);
      await sleep(1800);
      await page.screenshot({path: path.join(outDir, `zombie-${i}.png`)});
    }
  } finally {
    console.log('errors', JSON.stringify(errors.slice(0, 20)));
    await browser.close();
    server.close();
  }
});
