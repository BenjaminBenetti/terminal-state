// Quick before/after framing capture: start a seeded station from a static dir and grab the
// spawn view (gun hip pose + lighting). Usage: node tools/qa/pose-shot.mjs DIST OUT.png [seed]
import path from 'node:path';
import {launchBrowser, withBrowserLock} from './browser-env.mjs';
import {serveStatic} from './static-server.mjs';

const [dist, out, seed = '1A2B3C'] = process.argv.slice(2);
const sleep = ms => new Promise(r => setTimeout(r, ms));
await withBrowserLock(async () => {
  const {server, port} = await serveStatic(path.resolve(dist), {prefix: '/'});
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setViewport({width: 1280, height: 720});
    await page.goto(`http://127.0.0.1:${port}/index.html?qa=1&seed=${seed}`);
    for (let i = 0; i < 400; i++) { if (await page.evaluate(() => window.__LL?.ready() && window.__LL.state() === 'title').catch(() => false)) break; await sleep(500); }
    await page.click('#btn-start');
    await sleep(3000);
    await page.screenshot({path: out});
    console.log('saved', out);
  } finally { await browser.close(); server.close(); }
});
