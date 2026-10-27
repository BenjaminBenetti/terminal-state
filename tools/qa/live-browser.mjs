// Live deployment browser check (no QA hooks, no ?qa=1). Uses browserUrl once for the auth cookie.
// Never logs token/browserUrl; request URLs are reduced to origin-class + path without query.
import fs from 'node:fs';
import path from 'node:path';
import {launchBrowser, withBrowserLock} from './browser-env.mjs';
const out = process.argv[2];
fs.mkdirSync(out, {recursive: true});
const acc = JSON.parse(fs.readFileSync(process.env.LIVE_ACCESS ?? '/tmp/last-line-live-access.json', 'utf8'));
const base = new URL(acc.url.endsWith('/') ? acc.url : acc.url + '/');
const bOrigin = new URL(acc.browserUrl).origin;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const red = s => String(s).split(acc.token).join('[REDACTED]').split(acc.browserUrl).join('[REDACTED-URL]');
const cls = u => { try { const x = new URL(u); const o = x.origin === base.origin || x.origin === bOrigin ? 'artifact-host' : (x.protocol === 'data:' || x.protocol === 'blob:' ? x.protocol : 'EXTERNAL:' + x.origin); let p = x.pathname; if (p.startsWith(base.pathname)) p = './' + p.slice(base.pathname.length); return {origin: o, path: red(x.protocol === 'data:' || x.protocol === 'blob:' ? '' : p), hadQuery: !!x.search}; } catch { return {origin: 'unparsable', path: ''}; } };
const result = {mode: 'non-QA live build (no ?qa=1, no test hooks)', requests: [], console: [], pageErrors: []};
await withBrowserLock(async () => {
  const browser = await launchBrowser();
  const page = await browser.newPage();
  await page.setViewport({width: 1280, height: 720});
  page.on('response', r => { const c = cls(r.url()); if (c.origin !== 'data:' && c.origin !== 'blob:') result.requests.push({...c, status: r.status()}); });
  page.on('requestfailed', r => { const c = cls(r.url()); result.requests.push({...c, failed: true}); });
  page.on('console', m => { if (['error', 'warn', 'warning'].includes(m.type())) result.console.push({type: m.type(), text: red(m.text()).slice(0, 300)}); });
  page.on('pageerror', e => result.pageErrors.push(red(String(e)).slice(0, 300)));
  try {
    await page.goto(acc.browserUrl, {waitUntil: 'load', timeout: 60000});
    const landed = new URL(page.url());
    result.landedPath = landed.pathname.startsWith(base.pathname) ? './' + landed.pathname.slice(base.pathname.length) : '[other path]';
    result.landedHadQuery = !!landed.search;
    if (landed.search) { await page.goto(new URL('./index.html', base).href, {waitUntil: 'load'}); result.renavigatedWithoutQuery = true; }
    result.title = await page.title();
    const t0 = Date.now();
    await page.waitForFunction(() => { const b = document.querySelector('#btn-start'); return b && !b.disabled; }, {timeout: 180000, polling: 500});
    result.loadToStartEnabledMs = Date.now() - t0;
    result.qaHooksAbsent = await page.evaluate(() => typeof window.__LL === 'undefined' && typeof window.__game === 'undefined');
    await page.screenshot({path: path.join(out, 'title.png')});
    await page.click('#btn-start');
    await sleep(2500);
    result.pointerLockAfterStart = await page.evaluate(() => document.pointerLockElement?.id ?? document.pointerLockElement?.tagName ?? null);
    result.hudVisible = await page.evaluate(() => { const h = document.querySelector('#hud'); return !!h && !h.classList.contains('hidden'); });
    const s0 = await page.screenshot({encoding: 'base64'});
    await page.keyboard.down('KeyW'); await sleep(1500); await page.keyboard.up('KeyW'); await sleep(500);
    const s1 = await page.screenshot({encoding: 'base64'});
    result.viewChangedAfterW = s0 !== s1;
    await page.mouse.move(640, 360);
    for (let i = 0; i < 10; i++) { await page.mouse.move(640 + (i + 1) * 30, 360); await sleep(60); }
    await sleep(800);
    const s2 = await page.screenshot({encoding: 'base64'});
    result.viewChangedAfterMouseMove = s1 !== s2;
    await page.mouse.down(); await sleep(120); await page.mouse.up(); await sleep(800);
    result.shotClickNoError = true;
    await page.screenshot({path: path.join(out, 'in-world.png')});
    if (process.env.LIVE_R5) {
      // Iteration 05: HUD food/water, C crouch (and Ctrl press alone must NOT crouch; never Ctrl+W), one
      // fire hold long enough for a software-GL frame, inventory icons, one RMB optic view. No hooks.
      const hud = () => page.evaluate(() => (document.querySelector('#hud')?.innerText ?? '').replace(/\s+/g, ' '));
      result.hudFoodWater = (await hud()).match(/FOOD \d+%|WATER \d+%/g);
      await page.keyboard.press('KeyC'); await sleep(1500);
      result.stanceTagAfterC = await page.evaluate(() => document.querySelector('#stance-tag')?.textContent ?? null);
      await page.keyboard.press('KeyC'); await sleep(1500);
      result.stanceTagAfterSecondC = await page.evaluate(() => document.querySelector('#stance-tag')?.textContent ?? null);
      await page.keyboard.press('Control'); await sleep(1500);
      result.stanceTagAfterCtrl = await page.evaluate(() => document.querySelector('#stance-tag')?.textContent ?? null);
      const ammo = t => (t.match(/RIFLE (\d+) ?\/ ?(\d+)/) ?? []).slice(1, 3).join('/');
      result.ammoBeforeFire = ammo(await hud());
      await page.mouse.down(); await sleep(700); await page.mouse.up(); await sleep(1500);
      result.ammoAfterFire = ammo(await hud());
      await page.screenshot({path: path.join(out, 'after-fire.png')});
      await page.keyboard.press('Tab'); await sleep(1500);
      result.inventoryIcons = await page.evaluate(() => [...document.querySelectorAll('#inventory img')].filter(i => i.naturalWidth > 0).length);
      await page.screenshot({path: path.join(out, 'inventory.png')});
      await page.keyboard.press('Tab'); await sleep(1500);
      await page.mouse.down({button: 'right'}); await sleep(2500);
      await page.screenshot({path: path.join(out, 'optic-ads.png')});
      result.crosshairHiddenAtAds = await page.evaluate(() => document.getElementById('crosshair')?.style.visibility === 'hidden');
      await page.mouse.up({button: 'right'}); await sleep(500);
    }
    if (process.env.LIVE_R4) {
      // Iteration 04: HUD food/water, Ctrl crouch (press/release only — never Ctrl+W), inventory with
      // model-rendered icons, one RMB optic view. No cheats, no QA hooks.
      result.hudFoodWater = await page.evaluate(() => (document.querySelector('#hud')?.innerText ?? '').match(/FOOD\s*\d+%|WATER\s*\d+%/g));
      await page.keyboard.press('Control'); await sleep(1500);
      result.stanceTagAfterCtrl = await page.evaluate(() => document.querySelector('#stance-tag')?.textContent ?? null);
      await page.keyboard.press('Control'); await sleep(1500);
      result.stanceTagAfterSecondCtrl = await page.evaluate(() => document.querySelector('#stance-tag')?.textContent ?? null);
      await page.keyboard.press('Tab'); await sleep(1500);
      result.inventoryOpen = await page.evaluate(() => { const el = document.querySelector('#inventory'); return !!el && !el.classList.contains('hidden') && getComputedStyle(el).display !== 'none'; });
      result.inventoryIcons = await page.evaluate(() => [...document.querySelectorAll('#inventory img')].map(i => ({blob: i.src.startsWith('blob:') || i.src.startsWith('data:image/png'), w: i.naturalWidth})).filter(i => i.w > 0));
      await page.screenshot({path: path.join(out, 'inventory.png')});
      await page.keyboard.press('Tab'); await sleep(1500);
      result.pointerLockAfterInventory = await page.evaluate(() => !!document.pointerLockElement);
      await page.mouse.down({button: 'right'}); await sleep(2500);
      await page.screenshot({path: path.join(out, 'optic-ads.png')});
      result.crosshairHiddenAtAds = await page.evaluate(() => document.getElementById('crosshair')?.style.visibility === 'hidden');
      await page.mouse.up({button: 'right'}); await sleep(500);
      result.hudTextAfter = await page.evaluate(() => (document.querySelector('#hud')?.innerText ?? '').replace(/\s+/g, ' ').slice(0, 300));
    }
    if (process.env.LIVE_STANCE) {
      // Jump: no QA hooks, so only "view moved during the jump" is observable from screenshots.
      const g0 = await page.screenshot({encoding: 'base64'});
      await page.keyboard.down(' '); await sleep(60); await page.keyboard.up(' '); await sleep(150);
      const g1 = await page.screenshot({encoding: 'base64'});
      result.jumpViewChanged = g0 !== g1;
      await sleep(1500);
      // Crouch: the HUD stance tag is the observable proof.
      await page.keyboard.press('KeyC'); await sleep(1500);
      result.stanceTagAfterC = await page.evaluate(() => document.querySelector('#stance-tag')?.textContent ?? null);
      await page.screenshot({path: path.join(out, 'crouched.png')});
      await page.keyboard.press('KeyC'); await sleep(1500);
      result.stanceTagAfterSecondC = await page.evaluate(() => document.querySelector('#stance-tag')?.textContent ?? null);
    }
    result.hudText = await page.evaluate(() => (document.querySelector('#hud')?.innerText ?? '').replace(/\s+/g, ' ').slice(0, 300));
    result.webglRenderer = await page.evaluate(() => { try { const c = document.createElement('canvas'); const g = c.getContext('webgl2') || c.getContext('webgl'); return g ? g.getParameter(g.RENDERER) : null; } catch { return null; } });
  } catch (e) { result.exception = red(String(e)).slice(0, 400); }
  finally { await browser.close(); }
});
result.summary = {requests: result.requests.length, non200: result.requests.filter(r => r.failed || (r.status >= 400)).map(r => ({path: r.path, status: r.status, failed: r.failed})), external: result.requests.filter(r => r.origin.startsWith('EXTERNAL')), assetPaths: [...new Set(result.requests.filter(r => r.path.startsWith('./assets/')).map(r => r.path))]};
const txt = JSON.stringify(result, null, 2);
if (txt.includes(acc.token)) throw new Error('redaction failure; not writing');
fs.writeFileSync(path.join(out, 'browser-check.json'), txt);
console.log(JSON.stringify({...result, requests: undefined}, null, 1));
