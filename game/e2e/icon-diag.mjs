// Diagnostic: load the built game, save the 3D item icon contact sheet.
import fs from 'node:fs';
import path from 'node:path';
import {launchBrowser, withBrowserLock} from '../../tools/qa/browser-env.mjs';
import {serveStatic} from '../../tools/qa/static-server.mjs';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const out = path.resolve(process.argv[2] ?? 'qa-artifacts/icon-diag.png');
await withBrowserLock(async () => {
  const {server, port} = await serveStatic(path.resolve('dist/game'), {prefix: '/'});
  const browser = await launchBrowser();
  const page = await browser.newPage();
  await page.setViewport({width: 1280, height: 720});
  await page.goto(`http://127.0.0.1:${port}/index.html?qa=1&seed=1A2B3C`);
  for (let i = 0; i < 900; i++) { if (await page.evaluate(() => !!window.__LL?.ready() && window.__LL.state() === 'title').catch(() => false)) break; await sleep(400); }
  const url = await page.evaluate(() => window.__LL.iconSheet());
  fs.writeFileSync(out, Buffer.from(url.split(',')[1], 'base64'));
  console.log(JSON.stringify(await page.evaluate(() => window.__LL.snapshot().icons)).slice(0, 300));
  await browser.close(); server.close();
});
