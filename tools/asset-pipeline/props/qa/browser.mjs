// Shared helper: serve the repo on 127.0.0.1, open the QA viewer in the shared Firefox launcher
// (always inside withBrowserLock), run a callback, then close everything.
import path from 'node:path';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {launchBrowser, withBrowserLock} from '../../../qa/browser-env.mjs';
import {startServer} from './server.mjs';

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

export async function withViewer(fn) {
  return withBrowserLock(async () => {
    const srv = await startServer(REPO);
    let browser;
    try {
      browser = await launchBrowser();
      const page = await browser.newPage();
      page.setDefaultTimeout(30 * 60 * 1000);
      const consoleLines = [];
      page.on('console', m => consoleLines.push(`${m.type()}: ${m.text()}`));
      page.on('pageerror', e => consoleLines.push(`pageerror: ${e.message}`));
      await page.setViewport({width: 1000, height: 800});
      await page.goto(`http://127.0.0.1:${srv.port}/tools/asset-pipeline/props/qa/viewer.html`, {waitUntil: 'load'});
      await page.waitForFunction('window.qa && window.qa.ready', {timeout: 120000});
      const api = {
        page, consoleLines, port: srv.port,
        glInfo: () => page.evaluate(() => window.qa.glInfo()),
        load: (id, url, opts) => page.evaluate((i, u, o) => window.qa.load(i, u, o), id, url, opts ?? {}),
        dispose: id => page.evaluate(i => window.qa.dispose(i), id),
        texPlane: (id, spec) => page.evaluate((i, s) => window.qa.texPlane(i, s), id, spec),
        sheet: async (spec, outFile) => {
          const r = await page.evaluate(s => window.qa.sheet(s), spec);
          const buf = Buffer.from(r.png.split(',')[1], 'base64');
          fs.mkdirSync(path.dirname(outFile), {recursive: true});
          fs.writeFileSync(outFile, buf);
          return r.stats;
        },
      };
      return await fn(api);
    } finally {
      if (browser) await browser.close().catch(() => {});
      await srv.close();
    }
  });
}
