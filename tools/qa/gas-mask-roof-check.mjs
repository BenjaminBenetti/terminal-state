// Gas-mask / roof feedback browser spot check (task gas-mask-roof-feedback-20261030) — short, serial sessions, one at a time
// (root CLAUDE.md browser policy; lock / watchdog / cleanup from browser-env.mjs; memory guard on cgroup anon + shmem > 6 GiB):
//   a  Office lobby, DEFAULT warm-up: real Q puts the first-person mask on (screenshot hip / pistol ADS / rifle optic ADS), the
//      frame intervals around the first Q (a first-use compile would show as a multi-second stall), then 3 pistol shots on the
//      nearest pane (broken after the 3rd, not the 2nd).
//   b  Office roof, warmup=off: unprotected on the deck (outdoor exposure, damage, coughs started, HUD tag), then mask on
//      (protected, no damage, no new cough); the roof find record next to the crate.
// llvmpipe CPU rendering: functional / visual evidence only, not GPU performance or native WebGPU.
//
//   npm run build && node tools/qa/gas-mask-roof-check.mjs a|b [outDir]
import fs from 'node:fs';
import path from 'node:path';
import {launchBrowser, withBrowserLock} from './browser-env.mjs';
import {serveStatic} from './static-server.mjs';

const session = process.argv[2];
if (session !== 'a' && session !== 'b') throw new Error('usage: gas-mask-roof-check.mjs a|b [outDir]');
const out = path.resolve(process.argv[3] ?? 'qa-artifacts/gas-mask-roof');
fs.mkdirSync(out, {recursive: true});
const sleep = ms => new Promise(r => setTimeout(r, ms));
const anon = () => { try { const s = fs.readFileSync('/sys/fs/cgroup/memory.stat', 'utf8'); const g = k => Number(new RegExp(`^${k} (\\d+)$`, 'm').exec(s)?.[1] ?? 0); return g('anon') + g('shmem'); } catch { return 0; } };
const report = {session, started: new Date().toISOString(), steps: [], consoleErrors: [], peakGiB: 0, guard: false};
const step = (name, data) => { report.steps.push({name, ...data}); console.log(name, JSON.stringify(data).slice(0, 700)); };

await withBrowserLock(async () => {
  const {server, port} = await serveStatic(path.resolve('dist/game'), {prefix: '/'});
  let browser = null;
  const guard = setInterval(() => { const b = anon(); report.peakGiB = Math.max(report.peakGiB, b / 1024 ** 3); if (b > 6 * 1024 ** 3 && !report.guard) { report.guard = true; console.error('memory guard: closing the owned browser'); void browser?.close(); } }, 1000);
  try {
    browser = await launchBrowser({protocolTimeout: 300000});
    const page = await browser.newPage();
    page.on('console', m => { if (m.type() === 'error' && report.consoleErrors.length < 20) report.consoleErrors.push(m.text().slice(0, 300)); });
    await page.setViewport({width: 960, height: 540});
    const t0 = Date.now();
    await page.goto(`http://127.0.0.1:${port}/index.html?qa=1&level=office&quality=low${session === 'b' ? '&warmup=off' : ''}`);
    let ready = false;
    for (let i = 0; i < 360 && !ready; i++) { ready = await page.evaluate(() => window.__LL?.ready() && window.__LL.state() === 'title').catch(() => false); if (!ready) await sleep(1000); }
    step('loaded', {ready, seconds: (Date.now() - t0) / 1000, warmup: await page.evaluate(() => window.__LL.warmup?.() ?? null).catch(() => null)});
    if (!ready) throw new Error('no title screen');
    const ev = (fn, ...a) => page.evaluate(fn, ...a);
    const clock = () => ev(() => window.__game.clock);
    const waitGame = async (sec, capS = 240) => { const c0 = await clock(), r0 = Date.now(); while ((await clock()) - c0 < sec && Date.now() - r0 < capS * 1000) await sleep(600); return +((await clock()) - c0).toFixed(2); };
    const waitFor = async (fn, capS, arg) => { const r0 = Date.now(); while (Date.now() - r0 < capS * 1000) { if (await ev(fn, arg)) return true; await sleep(500); } return false; };
    const qTo = async want => { await page.keyboard.press('KeyQ'); return waitFor(w => window.__LL.mask().state === w, 240, want); };
    const shot = n => page.screenshot({path: path.join(out, `${session}-${n}.png`)});
    await page.click('#btn-start');
    await waitFor(() => window.__LL.state() === 'playing', 120);
    await waitGame(1, 120);
    await ev(() => { window.__LL.maskGive(0.8); window.__LL.filterGive(1); });

    if (session === 'a') {
      // frame intervals (page rAF) around the first Q: a first-use pipeline compile would be a multi-second stall
      await ev(() => { window.__ivals = []; let last = performance.now(); const f = t => { window.__ivals.push(t - last); last = t; if (window.__ivals.length < 4000) requestAnimationFrame(f); }; requestAnimationFrame(f); });
      await waitGame(1.5, 120);
      const base = await ev(() => { const v = window.__ivals.splice(0); return {n: v.length, max: Math.max(...v), median: v.sort((p, q) => p - q)[v.length >> 1]}; });
      await shot('0-mask-off');
      const on = await qTo('on');
      await waitGame(0.5, 60);
      const donning = await ev(() => { const v = window.__ivals.splice(0); return {n: v.length, max: Math.max(...v), median: v.sort((p, q) => p - q)[v.length >> 1]}; });
      step('first Q (mask on)', {on, baseline: base, donning, mask: await ev(() => window.__LL.mask())});
      await shot('1-mask-on-hip');
      await page.mouse.down({button: 'right'}); await waitGame(0.6, 60);
      await shot('2-mask-on-pistol-ads');
      await page.mouse.up({button: 'right'});
      // rifle optic through the mask
      const slot = await ev(() => { window.__LL.qaGiveItem('rifle', 1); const i = window.__game.inv.hotbar.findIndex(s => s?.itemId === 'rifle'); return i; });
      if (slot >= 0) {
        await page.keyboard.press(`Digit${slot + 1}`); await waitGame(1.0, 90);
        await page.mouse.down({button: 'right'}); await waitGame(0.8, 90);
        await shot('3-mask-on-rifle-optic-ads');
        await page.mouse.up({button: 'right'});
        await page.keyboard.press('Digit1'); await waitGame(0.8, 90);
      }
      step('rifle', {slot});
      const off = await qTo('off');
      step('Q (mask off)', {off});
      // pane health: 3 pistol shots on the nearest pane of this storey
      const pick = await ev(() => { const P = window.__game.player, eye = P.eye ?? P.y + 1.62; const all = window.__LL.windows().panes.filter(p => p.state !== 'broken'); all.sort((a, b) => Math.hypot(a.centre[0] - P.x, (a.centre[1] - eye) * 3, a.centre[2] - P.z) - Math.hypot(b.centre[0] - P.x, (b.centre[1] - eye) * 3, b.centre[2] - P.z)); return all[0] ?? null; });
      const shots = [];
      if (pick) {
        for (let i = 0; i < 3; i++) {
          await ev(id => window.__LL.windowAim(id, 2.2), pick.id);
          await waitGame(0.5, 240);
          const before = await ev(() => window.__game.stats.shots);
          await page.mouse.click(480, 270);
          await waitFor(b => window.__game.stats.shots > b, 60, before);
          await waitGame(0.35, 60);
          shots.push(await ev(id => window.__LL.windows().panes.find(p => p.id === id), pick.id));
        }
        await shot('4-pane-after-3');
      }
      step('pane health', {pick: pick?.id, shots: shots.map(s => ({state: s?.state, damage: s?.damage, hp: s?.hp, maxHp: s?.maxHp}))});
    } else {
      const pose = await ev(() => window.__LL.goRoofCache());
      await waitGame(2.5, 240);
      const g0 = await ev(() => ({gas: window.__LL.gas(), hp: window.__game.player.hp, coughs: window.__game.cough.coughs, tag: document.querySelector('#gas-tag')?.textContent ?? null}));
      await waitGame(3, 240);
      const g1 = await ev(() => ({gas: window.__LL.gas(), hp: window.__game.player.hp, coughs: window.__game.cough.coughs, tag: document.querySelector('#gas-tag')?.textContent ?? null,
        bank: (() => { const b = window.__game.sfx.debugState?.().bank; return b ? {silentPlays: b.silentPlays, silentCues: [...(b.silentCues ?? [])]} : null; })()}));
      step('roof unprotected', {pose, t0: {eye: g0.gas.eye, source: g0.gas.source, dps: g0.gas.dps, hp: g0.hp, coughs: g0.coughs, tag: g0.tag},
        t3: {eye: g1.gas.eye, source: g1.gas.source, outdoor: g1.gas.outdoor, dps: g1.gas.dps, protected: g1.gas.protected, hp: g1.hp, coughs: g1.coughs, tag: g1.tag, bank: g1.bank}});
      await shot('0-roof-unprotected');
      await qTo('on');
      const p0 = await ev(() => ({hp: window.__game.player.hp, coughs: window.__game.cough.coughs, dmg: window.__LL.gas().damage}));
      await waitGame(3, 240);
      const p1 = await ev(() => ({hp: window.__game.player.hp, coughs: window.__game.cough.coughs, gas: window.__LL.gas(), tag: document.querySelector('#gas-tag')?.textContent ?? null}));
      step('roof protected', {hp: [p0.hp, p1.hp], coughs: [p0.coughs, p1.coughs], gasDamage: [p0.dmg, p1.gas.damage], protected: p1.gas.protected, dps: p1.gas.dps, tag: p1.tag});
      await shot('1-roof-masked');
      step('roof find', await ev(() => {
        const r = window.__game.layout.office?.roof;
        const P = window.__game.player;
        const finds = (window.__game.layout.pickups ?? []).filter(p => p.reward === 'roof-find').map(p => ({itemId: p.itemId ?? p.item ?? p.id, count: p.count, x: +p.x.toFixed(2), z: +p.z.toFixed(2), level: p.level, distToPlayer: +Math.hypot(p.x - P.x, p.z - P.z).toFixed(2)}));
        return {find: r?.find ?? null, pickups: finds};
      }));
    }
    report.final = await ev(() => ({lastError: window.__game.lastError ?? null, bypass: window.__game.atmosphereBypass ?? null, gpuErrors: window.__LL.gpu?.()?.errors ?? null, backend: window.__LL.gpu?.()?.label ?? null}));
    step('final', report.final);
  } finally {
    clearInterval(guard);
    server.close();
    report.finished = new Date().toISOString();
    fs.writeFileSync(path.join(out, `report-${session}.json`), JSON.stringify(report, null, 2));
  }
}, {maxMinutes: 18, label: `gas-mask-roof-check-${session}`});
