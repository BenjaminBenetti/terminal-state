// Opens the QA viewer in the shared Firefox/Xvfb/llvmpipe browser (serialized by the shared lock).
import fs from 'node:fs';
import path from 'node:path';
import {launchBrowser, withBrowserLock} from '../../../qa/browser-env.mjs';
import {startServer} from './static-server.mjs';
import {REPO} from '../lib/master.mjs';

export const TMP = '/tmp/ll-zombie';

export async function withViewer(fn) {
  fs.mkdirSync(TMP, {recursive: true});
  const srv = await startServer(REPO, TMP);
  try {
    return await withBrowserLock(async () => {
      const browser = await launchBrowser();
      try {
        const page = await browser.newPage();
        const logs = [];
        page.on('console', m => logs.push(`[${m.type()}] ${m.text()}`));
        page.on('pageerror', e => logs.push(`[pageerror] ${e.message}`));
        await page.setViewport({width: 900, height: 700});
        await page.goto(`http://127.0.0.1:${srv.port}/tools/asset-pipeline/zombie/qa/viewer.html`, {waitUntil: 'load'});
        await page.waitForFunction('window.qa && window.qa.ready', {timeout: 60000});
        const api = {
          page, logs, port: srv.port,
          load: (url, opts) => page.evaluate((u, o) => window.qa.load(u, o), url, opts || {}),
          minY: (clip, t) => page.evaluate((c, tt) => window.qa.minY(c, tt), clip, t),
          overlayJoints: (j, p, e) => page.evaluate((a, b, c) => window.qa.overlayJoints(a, b, c), j, p, e || {}),
          async sheet(spec, outFile) {
            const dataUrl = await page.evaluate(s => window.qa.sheet(s), spec);
            fs.mkdirSync(path.dirname(outFile), {recursive: true});
            fs.writeFileSync(outFile, Buffer.from(dataUrl.split(',')[1], 'base64'));
            return outFile;
          },
        };
        return await fn(api);
      } finally {
        await browser.close().catch(() => {});
      }
    });
  } finally { await srv.close(); }
}
