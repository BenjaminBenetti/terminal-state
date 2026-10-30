// Gas mask + breached office window browser spot check — ONE short, serial session (root CLAUDE.md browser policy).
// Office (warmup=off, quality=low, small viewport): give a mask + spare filters (QA), real Q presses put it on / take it
// off, three real shots break the nearest pane on the player's storey, the breach gas is sampled as it builds up (game
// clock), then unprotected vs protected exposure is compared. Screenshots + report.json. A memory guard (cgroup anon +
// shmem > 6.0 GiB) stops the session and closes the owned browser; lock / watchdog / cleanup come from browser-env.mjs.
// llvmpipe is CPU rendering: functional evidence only, not GPU performance.
//
//   node tools/qa/gasmask-breach-check.mjs [outDir]
import fs from 'node:fs';
import path from 'node:path';
import {launchBrowser, withBrowserLock} from './browser-env.mjs';
import {serveStatic} from './static-server.mjs';

const out = path.resolve(process.argv[2] ?? 'qa-artifacts/gasmask-breach');
fs.mkdirSync(out, {recursive: true});
const GUARD_BYTES = 6.0 * 1024 ** 3;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const report = {started: new Date().toISOString(), steps: [], consoleErrors: [], memoryPeakGiB: 0, guardTripped: false};
const step = (name, data) => { report.steps.push({name, at: new Date().toISOString(), ...data}); console.log(name, JSON.stringify(data).slice(0, 600)); };

function cgroupAnonShmem() {
  try {
    const s = fs.readFileSync('/sys/fs/cgroup/memory.stat', 'utf8');
    const get = k => Number(new RegExp(`^${k} (\\d+)$`, 'm').exec(s)?.[1] ?? 0);
    return get('anon') + get('shmem');
  } catch { return 0; }
}

await withBrowserLock(async () => {
  const {server, port} = await serveStatic(path.resolve('dist/game'), {prefix: '/'});
  let browser = null, guard = null;
  try {
    browser = await launchBrowser({protocolTimeout: 240000});
    guard = setInterval(() => {
      const b = cgroupAnonShmem();
      report.memoryPeakGiB = Math.max(report.memoryPeakGiB, b / 1024 ** 3);
      if (b > GUARD_BYTES && !report.guardTripped) {
        report.guardTripped = true;
        console.error(`memory guard: anon+shmem ${(b / 1024 ** 3).toFixed(2)} GiB > 6.0 GiB; closing the owned browser`);
        void browser?.close();
      }
    }, 1000);
    const page = await browser.newPage();
    page.on('console', m => { if (m.type() === 'error' && report.consoleErrors.length < 20) report.consoleErrors.push(m.text().slice(0, 300)); });
    await page.setViewport({width: 960, height: 540});
    const t0 = Date.now();
    await page.goto(`http://127.0.0.1:${port}/index.html?qa=1&level=office&warmup=off&quality=low`);
    let ready = false;
    for (let i = 0; i < 300 && !ready; i++) {
      ready = await page.evaluate(() => window.__LL?.ready() && window.__LL.state() === 'title').catch(() => false);
      if (!ready) await sleep(1000);
    }
    step('loaded', {ready, seconds: (Date.now() - t0) / 1000});
    if (!ready) throw new Error('game did not reach the title screen');
    const ev = (fn, ...a) => page.evaluate(fn, ...a);
    const clock = () => ev(() => window.__game.clock);
    /** Wait until `game seconds` of play passed (real-time cap `capS`). */
    const waitGame = async (sec, capS = 240) => {
      const c0 = await clock(), r0 = Date.now();
      while ((await clock()) - c0 < sec && Date.now() - r0 < capS * 1000) await sleep(700);
      return {game: (await clock()) - c0, real: (Date.now() - r0) / 1000};
    };
    const waitFor = async (fn, capS = 60, arg) => { const r0 = Date.now(); while (Date.now() - r0 < capS * 1000) { if (await ev(fn, arg)) return true; await sleep(500); } return false; };
    const q = async () => { await page.keyboard.press('KeyQ'); await sleep(300); };
    /** A real Q press, then wait (game clock; llvmpipe frames are slow after new views compile) until the mask reaches `want`. */
    const qTo = async want => { await q(); return waitFor(w => window.__LL.mask().state === w, 240, want); };
    const hud = () => ev(() => ({gasTag: document.querySelector('#gas-tag')?.textContent ?? null, qCell: document.querySelector('#hotbar .slot.maskslot')?.textContent?.replace(/\s+/g, ' ').trim() ?? null,
      overlay: window.__LL.mask().view ?? null})); // the first-person mask view (gear/maskView.ts) replaced the #mask-view overlay
    const shot = name => page.screenshot({path: path.join(out, name)});

    await page.click('#btn-start');
    await waitFor(() => window.__LL.state() === 'playing', 60);
    // no free mask: Q with nothing equipped is refused
    await q();
    step('Q without a mask', {mask: await ev(() => window.__LL.mask()), hud: await hud()});
    await ev(() => { window.__LL.maskGive(0.6); window.__LL.filterGive(2); });
    step('mask + 2 filters given (equipped, off the face)', {mask: await ev(() => window.__LL.mask())});
    // the nearest breakable pane on the player's storey
    const pick = await ev(() => {
      const P = window.__game.player, eye = P.eye ?? P.y + 1.62;
      const all = window.__LL.windows().panes.filter(p => p.state !== 'broken');
      all.sort((a, b) => Math.hypot(a.centre[0] - P.x, (a.centre[1] - eye) * 3, a.centre[2] - P.z) - Math.hypot(b.centre[0] - P.x, (b.centre[1] - eye) * 3, b.centre[2] - P.z));
      return all[0] ?? null;
    });
    step('pane', {pick});
    if (!pick) throw new Error('no breakable pane');
    await ev(id => window.__LL.windowAim(id, 2.2), pick.id);
    await waitGame(0.6, 240); // the new view compiles first (warmup=off on a software rasterizer)
    await shot('00-aim-mask-off.png');
    const donned = await qTo('on');
    step('Q -> on', {donned, mask: await ev(() => window.__LL.mask()), hud: await hud()});
    await shot('01-mask-on.png');
    const doffed = await qTo('off');
    step('Q -> off', {doffed, mask: await ev(() => window.__LL.mask()), hud: await hud()});
    // three real shots at the pane (one per trigger pull)
    const shots = [];
    for (let i = 0; i < 3; i++) {
      await ev(id => window.__LL.windowAim(id, 2.2), pick.id);
      const before = await ev(() => window.__game.stats.shots);
      await page.mouse.click(480, 270);
      await waitFor(b => window.__game.stats.shots > b, 20).catch(() => false);
      await waitGame(0.4, 20);
      shots.push(await ev(id => window.__LL.windows().panes.find(p => p.id === id), pick.id));
    }
    step('three shots', {shots, gas: await ev(() => window.__LL.gas())});
    await shot('02-pane-broken.png');
    // gas builds up: mask on (protected), look into the room (turn around) and sample on the game clock
    step('mask on before the build-up', {on: await qTo('on')});
    await ev(() => { const P = window.__game.player; P.yaw += Math.PI; P.pitch = -0.08; });
    const samples = [];
    for (const target of [3, 10, 22]) {
      const done = samples.length ? samples[samples.length - 1].t : 0;
      await waitGame(target - done, 200);
      const g = await ev(() => window.__LL.gas());
      samples.push({t: target, eye: g.eye, storeys: g.storeys.map(s => ({...s, box: undefined})), volumetric: g.volumetric, hp: await ev(() => window.__game.player.hp)});
      await shot(`03-gas-t${target}.png`);
    }
    step('gas build-up (game s after breach)', {samples});
    // unprotected exposure (mask off) vs protected (mask on)
    await qTo('off');
    const hp0 = await ev(() => ({hp: window.__game.player.hp, gas: window.__LL.gas()}));
    await waitGame(3, 120);
    const hp1 = await ev(() => ({hp: window.__game.player.hp, gas: window.__LL.gas(), hud: null}));
    step('unprotected 3 s', {hpBefore: hp0.hp, hpAfter: hp1.hp, eye: hp1.gas.eye, dps: hp1.gas.dps, protected: hp1.gas.protected, damage: hp1.gas.damage, hud: await hud()});
    await qTo('on');
    const p0 = await ev(() => ({hp: window.__game.player.hp, dmg: window.__LL.gas().damage, filter: window.__LL.mask()}));
    await waitGame(3, 120);
    const p1 = await ev(() => ({hp: window.__game.player.hp, gas: window.__LL.gas(), filter: window.__LL.mask()}));
    step('protected 3 s', {hpBefore: p0.hp, hpAfter: p1.hp, gasDamageBefore: p0.dmg, gasDamageAfter: p1.gas.damage, eye: p1.gas.eye, protected: p1.gas.protected, maskBefore: p0.filter, maskAfter: p1.filter, hud: await hud()});
    await shot('04-protected-in-gas.png');
    report.final = await ev(() => ({lastError: window.__game.lastError ?? null, bypass: window.__game.atmosphereBypass ?? null, gpuErrors: window.__LL.gpu?.()?.errors ?? null, backend: window.__LL.gpu?.()?.label ?? null}));
    step('final', report.final);
  } finally {
    clearInterval(guard);
    server.close();
    report.finished = new Date().toISOString();
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  }
}, {maxMinutes: 15, label: 'gasmask-breach-check'});
