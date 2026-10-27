// Diagnostic: triangle budget by object name at spawn (frustum-visible meshes only).
import path from 'node:path';
import {launchBrowser, withBrowserLock} from '../../tools/qa/browser-env.mjs';
import {serveStatic} from '../../tools/qa/static-server.mjs';
const sleep = ms => new Promise(r => setTimeout(r, ms));
await withBrowserLock(async () => {
  const {server, port} = await serveStatic(path.resolve('dist/game'), {prefix: '/'});
  const browser = await launchBrowser();
  const page = await browser.newPage();
  await page.setViewport({width: 1280, height: 720});
  await page.goto(`http://127.0.0.1:${port}/index.html?qa=1&seed=1A2B3C`);
  for (let i = 0; i < 600; i++) { if (await page.evaluate(() => !!window.__LL?.ready() && window.__LL.state() === 'title').catch(() => false)) break; await sleep(400); }
  await page.click('#btn-start'); await sleep(4000);
  const out = await page.evaluate(() => {
    const g = window.__game, cam = g.camera; const T = window.__game.scene.constructor;
    const fr = new (Object.getPrototypeOf(cam.projectionMatrix).constructor)();
    const res = {}; let total = 0;
    const frustum = new (g.renderer.constructor.prototype.constructor === undefined ? Object : Object)();
    g.scene.traverseVisible(o => {
      if (!o.isMesh) return;
      const geo = o.geometry; const tris = (geo.index ? geo.index.count : geo.attributes.position.count) / 3;
      const n = o.isInstancedMesh ? o.count : 1;
      const key = (o.name || o.parent?.name || 'unnamed').replace(/[-_]?\d+.*$/, '');
      res[key] = (res[key] ?? 0) + tris * n; total += tris * n;
    });
    return {total: Math.round(total), top: Object.entries(res).sort((a, b) => b[1] - a[1]).slice(0, 18).map(([k, v]) => [k, Math.round(v)]), render: {...g.renderer.info.render}};
  });
  console.log(JSON.stringify(out, null, 1));
  await browser.close(); server.close();
});
