// Non-QA build check: real pointer lock on start, mouse-look moves the view, Esc releases the
// lock and opens the pause menu (combat frozen), Resume re-locks. No test hooks are used.
import path from 'node:path';
import fs from 'node:fs';
import {launchBrowser, withBrowserLock} from './browser-env.mjs';
import {serveStatic} from './static-server.mjs';
const out = process.argv[2] ?? 'qa-artifacts/pointerlock';
fs.mkdirSync(out, {recursive: true});
const sleep = ms => new Promise(r => setTimeout(r, ms));
const result = {};
await withBrowserLock(async () => {
  const {server, port} = await serveStatic(path.resolve('dist/game'), {prefix: '/'});
  const browser = await launchBrowser();
  const page = await browser.newPage();
  await page.setViewport({width: 1280, height: 720});
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  try {
    await page.goto(`http://127.0.0.1:${port}/index.html`);
    await page.waitForFunction(() => !document.querySelector('#btn-start').disabled, {timeout: 180000, polling: 500});
    result.qaHooksAbsent = await page.evaluate(() => typeof window.__LL === 'undefined' && typeof window.__game === 'undefined');
    await page.click('#btn-start');
    await sleep(2000);
    result.lockedAfterStart = await page.evaluate(() => document.pointerLockElement?.id ?? null);
    result.hudVisible = await page.evaluate(() => !document.querySelector('#hud').classList.contains('hidden'));
    const before = await page.screenshot({encoding: 'base64'});
    await page.mouse.move(640, 360);
    for (let i = 0; i < 10; i++) { await page.mouse.move(640 + (i + 1) * 30, 360); await sleep(60); }
    await sleep(800);
    const after = await page.screenshot({encoding: 'base64'});
    result.viewChangedAfterMouseMove = before !== after;
    await page.keyboard.press('Escape');
    await sleep(1500);
    result.lockedAfterEsc = await page.evaluate(() => document.pointerLockElement?.id ?? null);
    result.pauseShownAfterEsc = await page.evaluate(() => !document.querySelector('#pause').classList.contains('hidden'));
    await page.screenshot({path: path.join(out, 'pause-after-esc.png')});
    await sleep(1500);
    try { await page.click('#btn-resume'); } catch (e) { result.resumeClickError = String(e).slice(0, 120); }
    await sleep(1500);
    result.lockedAfterResume = await page.evaluate(() => document.pointerLockElement?.id ?? null);
    result.pauseHiddenAfterResume = await page.evaluate(() => document.querySelector('#pause').classList.contains('hidden'));
    await page.keyboard.press('Tab');
    await sleep(1000);
    result.inventoryOpenWithTab = await page.evaluate(() => !document.querySelector('#inventory').classList.contains('hidden'));
    result.lockReleasedForInventory = await page.evaluate(() => document.pointerLockElement === null);
  } catch (e) {
    result.exception = String(e).slice(0, 300);
  } finally {
    result.errors = errors;
    await browser.close();
    server.close();
  }
});
fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
