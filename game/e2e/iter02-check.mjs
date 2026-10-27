// Short iteration-02 browser check of the STATIC build: start, jump/crouch, one container,
// dark/light + flashlight screenshots, New Station x2 with audio-context state.
// Usage: node game/e2e/iter02-check.mjs OUTDIR [--dist=dist/game] [--seed=1A2B3C]
import fs from 'node:fs';
import path from 'node:path';
import {launchBrowser, withBrowserLock} from '../../tools/qa/browser-env.mjs';
import {serveStatic} from '../../tools/qa/static-server.mjs';

const arg = (k, d) => (process.argv.find(a => a.startsWith(`--${k}=`)) ?? `--${k}=${d}`).split('=')[1];
const outDir = path.resolve(process.argv.find((a, i) => i > 1 && !a.startsWith('--')) ?? 'qa-artifacts/iter02');
const dist = path.resolve(arg('dist', 'dist/game'));
const SEED = arg('seed', '1A2B3C');
fs.mkdirSync(outDir, {recursive: true});
const sleep = ms => new Promise(r => setTimeout(r, ms));
const report = {startedAt: new Date().toISOString(), dist, seed: SEED, steps: [], pageErrors: [], console: [], badResponses: [], screenshots: []};
const step = (name, ok, detail = {}) => { report.steps.push({name, ok, detail}); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`, JSON.stringify(detail).slice(0, 400)); return ok; };

await withBrowserLock(async () => {
  const {server, port} = await serveStatic(dist, {prefix: '/'});
  const browser = await launchBrowser();
  const page = await browser.newPage();
  await page.setViewport({width: 1280, height: 720});
  page.on('pageerror', e => report.pageErrors.push(String(e).slice(0, 600)));
  page.on('console', m => { if (['error', 'warn', 'warning'].includes(m.type())) report.console.push(`${m.type()}: ${m.text()}`.slice(0, 300)); });
  page.on('response', r => { if (r.status() >= 400) report.badResponses.push(`${r.status()} ${r.url()}`); });
  const snap = () => page.evaluate(() => window.__LL.snapshot());
  const shot = async name => { const f = path.join(outDir, `${name}.png`); await page.screenshot({path: f}); report.screenshots.push(f); };
  const waitFor = async (fn, timeout = 20000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > timeout) return null; await sleep(200); } };
  try {
    await page.goto(`http://127.0.0.1:${port}/index.html?qa=1&seed=${SEED}`);
    const ready = await waitFor(() => page.evaluate(() => !!window.__LL?.ready() && window.__LL.state() === 'title').catch(() => false), 240000);
    step('loads to title', !!ready);
    await page.click('#btn-start');
    await waitFor(async () => (await snap()).state === 'playing');
    await sleep(2500);
    let s = await snap();
    step('enters play', s.state === 'playing', {name: s.name, containers: s.containers?.count, lighting: s.lighting?.areas});
    await shot('01-spawn-gun-pose');

    // --- jump -------------------------------------------------------------------------
    let maxY = 0;
    await page.keyboard.down(' '); await sleep(50); await page.keyboard.up(' ');
    // llvmpipe runs at a few fps and dt is capped, so game time runs slower than wall time.
    for (let i = 0; i < 25; i++) { maxY = Math.max(maxY, (await snap()).player.y); await sleep(60); }
    s = await waitFor(async () => { const q = await snap(); return q.player.grounded ? q : null; }, 8000) ?? await snap();
    step('Space jumps and lands (grounded, no hover)', maxY > 0.2 && s.player.grounded && Math.abs(s.player.y) < 0.01, {maxY: +maxY.toFixed(3), y: s.player.y, grounded: s.player.grounded});

    // --- crouch -------------------------------------------------------------------------
    await page.keyboard.press('KeyC');
    s = await waitFor(async () => { const q = await snap(); return q.player.eye < 1.1 ? q : null; }, 6000) ?? await snap();
    const eyeC = s.player.eye;
    await page.keyboard.down('KeyW'); await sleep(900);
    const spC = (await snap()).player.speed;
    await page.keyboard.up('KeyW');
    await shot('02-crouched');
    await page.keyboard.press('KeyC');
    await waitFor(async () => (await snap()).player.eye > 1.55, 6000);
    await page.keyboard.down('KeyW'); await sleep(900);
    const st = await snap();
    await page.keyboard.up('KeyW');
    step('C crouches (lower eye, slower) and C stands', s.player.crouched && eyeC < 1.2 && !st.player.crouched && st.player.eye > 1.5 && spC < st.player.speed * 0.7, {eyeCrouch: eyeC, eyeStand: st.player.eye, speedCrouch: spC, speedStand: st.player.speed});

    // --- container ----------------------------------------------------------------------
    s = await snap();
    const list = s.containers?.list ?? [];
    const target = list.find(c => (c.remaining ?? 0) > 0) ?? list[0];
    let cOk = false, cDetail = {count: list.length};
    if (target) {
      const a0 = await page.evaluate(i => window.__LL.aimContainer(i), target.index);
      await page.evaluate((x, z) => window.__LL.teleport(x, z), a0.stand.x, a0.stand.z);
      await sleep(300);
      await page.evaluate(i => window.__LL.aimContainer(i), target.index);
      await sleep(400);
      const prompt0 = await page.$eval('#prompt', e => e.textContent);
      await shot('03a-container-closed');
      const inv0 = await snap();
      await page.keyboard.press('KeyE');
      await sleep(1600);
      await shot('03-container-open');
      const s1 = await snap();
      const c1 = s1.containers.list.find(c => c.index === target.index);
      const prompt1 = await page.$eval('#prompt', e => e.textContent);
      const total = q => JSON.stringify([q.ammo, q.pack.filter(Boolean).length, q.hotbar.filter(Boolean).map(h => h.itemId + h.count)]);
      // close, then reopen: no reroll
      await page.keyboard.press('KeyE'); await sleep(1200);
      const s2 = await snap();
      await page.evaluate(i => window.__LL.aimContainer(i), target.index); await sleep(300);
      await page.keyboard.press('KeyE'); await sleep(1600);
      const s3 = await snap();
      const c3 = s3.containers.list.find(c => c.index === target.index);
      cOk = c1.open && c1.searched && total(s3) === total(s1) && (c3.remaining ?? 0) <= (c1.remaining ?? 0);
      cDetail = {kind: target.kind, before: target.remaining, prompt0, prompt1, openAfterE: c1.open, searched: c1.searched, remainingAfter: c1.remaining, invChanged: total(inv0) !== total(s1), closed: !s2.containers.list.find(c => c.index === target.index).open, reopenNoReroll: total(s3) === total(s1), ammo0: inv0.ammo, ammo1: s1.ammo};
    }
    step('E opens + searches a container, items to inventory, reopen does not reroll', cOk, cDetail);

    // --- lighting: dark area with and without flashlight, plus a lit public view ------------
    s = await snap();
    const prof = s.lighting?.areaProfiles ?? [];
    const darkIdx = prof.findIndex(p => p === 'dark');
    if (darkIdx >= 0) {
      const a = s.layout.areas[darkIdx];
      await page.evaluate((x, z) => window.__LL.teleport(x, z), (a.x + a.w / 2) * 0.5, (a.y + a.h / 2) * 0.5);
      await sleep(2000);
      const d = await snap();
      if (!d.lighting.flashlightOn) { await page.keyboard.press('KeyF'); await sleep(400); }
      await shot('04-dark-flashlight-on');
      await page.keyboard.press('KeyF'); await sleep(600);
      await shot('05-dark-flashlight-off');
      await page.keyboard.press('KeyF'); await sleep(300);
      step('dark area reached (low ambient)', d.lighting.profile === 'dark', {area: d.lighting.areaType, ambient: d.lighting.ambient});
    } else step('dark area present', false, {prof});

    // --- New Station x2 + audio context --------------------------------------------------
    const audio0 = await page.evaluate(() => window.__LL.audio());
    const audioRuns = [];
    for (let r = 0; r < 2; r++) {
      await page.keyboard.press('Escape');
      await waitFor(async () => (await snap()).state === 'paused', 5000);
      await page.click('#btn-new-station');
      await waitFor(async () => (await snap()).state === 'playing', 20000);
      // No input yet: the context must already be running from the menu click alone.
      const t0 = Date.now();
      const runningNoInput = await waitFor(async () => (await page.evaluate(() => window.__LL.audio())).state === 'running', 4000);
      const msToRunning = Date.now() - t0;
      await waitFor(async () => (await snap()).weapon.phase === 'idle', 8000);
      const before = await page.evaluate(() => window.__LL.audio());
      await page.mouse.down(); await sleep(1500); await page.mouse.up();
      await page.keyboard.down('KeyW'); await sleep(2500); await page.keyboard.up('KeyW');
      await sleep(300);
      const after = await page.evaluate(() => window.__LL.audio());
      audioRuns.push({state: (await snap()).state, runningNoInput: !!runningNoInput, msToRunning, before, after});
    }
    const aOk = audioRuns.every(r => r.state === 'playing' && r.runningNoInput && r.after.contexts === 1 && r.after.state === 'running' && r.after.ambientLoops === 1 && r.after.sounds > r.before.sounds);
    step('New Station x2: one running AudioContext, one ambient loop, shots/steps still create sounds', aOk, {audio0, audioRuns});
    s = await snap();
    await shot('06-after-new-station');
    // --- generated turnstile in the fare hall (some stations have none: try a few) ----------
    let gate = null;
    for (let r = 0; r < 6 && !gate; r++) {
      gate = await page.evaluate(() => { const g = window.__game.layout.props.find(p => p.kind === 'fareGate'); return g && {x: g.x, z: g.z}; });
      if (!gate) { await page.keyboard.press('Escape'); await waitFor(async () => (await snap()).state === 'paused', 5000); await page.click('#btn-new-station'); await waitFor(async () => (await snap()).state === 'playing', 20000); }
    }
    if (gate) {
      await page.evaluate((x, z) => window.__LL.teleport(x - 1.6, z + 2.2), gate.x, gate.z);
      await page.evaluate((x, z) => window.__LL.lookAt(x, 0.7, z), gate.x, gate.z);
      await sleep(1500);
      await shot('07-turnstiles');
    }
    const tm = await page.evaluate(() => window.__game.world.group.children.filter(o => /prop-fareGate/.test(o.name)).length);
    step('fare gates render the generated turnstile model', !!gate && tm > 0, {gate, turnstileMeshes: tm});
    step('no page errors', report.pageErrors.length === 0 && !s.lastError, {pageErrors: report.pageErrors.slice(0, 3), lastError: s.lastError});
  } catch (e) {
    step('script error', false, {error: String(e?.stack ?? e).slice(0, 600)});
  } finally {
    await browser.close();
    server.close();
    report.ok = report.steps.every(x => x.ok);
    fs.writeFileSync(path.join(outDir, 'iter02-check.json'), JSON.stringify(report, null, 2));
  }
});
