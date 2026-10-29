// Scripted real-browser playtest of the STATIC build (dist/game) in Firefox + Mesa llvmpipe.
// Real keyboard/mouse events drive the game; ?qa=1 hooks only read state and aim the camera.
// Usage: node game/e2e/playtest.mjs [outDir] [--prefix=/slug/]
import fs from 'node:fs';
import path from 'node:path';
import {launchBrowser, withBrowserLock} from '../../tools/qa/browser-env.mjs';
import {serveStatic} from '../../tools/qa/static-server.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const outDir = path.resolve(process.argv.find((a, i) => i > 1 && !a.startsWith('--')) ?? path.join(root, 'qa-artifacts/e2e'));
const prefix = (process.argv.find(a => a.startsWith('--prefix=')) ?? '--prefix=/last-line-playtest/').split('=')[1];
const SEED = process.env.LL_SEED ?? '1A2B3C';
fs.mkdirSync(outDir, {recursive: true});
const dist = path.join(root, 'dist/game');
if (!fs.existsSync(path.join(dist, 'index.html'))) throw new Error('Build first: npm run game:build');

const report = {startedAt: new Date().toISOString(), browser: null, renderer: null, url: null, steps: [], console: [], pageErrors: [], badResponses: [], requests: [], screenshots: [], ok: false};
const step = (name, ok, detail = {}) => { report.steps.push({name, ok, detail}); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`, JSON.stringify(detail).slice(0, 300)); return ok; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

await withBrowserLock(async () => {
  const {server, port, log} = await serveStatic(dist, {prefix});
  const browser = await launchBrowser();
  report.browser = await browser.version();
  const page = await browser.newPage();
  await page.setViewport({width: 1280, height: 720});
  page.on('console', m => { if (['error', 'warning', 'warn'].includes(m.type())) report.console.push(`${m.type()}: ${m.text()}`.slice(0, 500)); });
  page.on('pageerror', e => report.pageErrors.push(String(e).slice(0, 800)));
  page.on('response', r => { if (r.status() >= 400) report.badResponses.push(`${r.status()} ${r.url()}`); });
  const snap = () => page.evaluate(() => window.__LL.snapshot());
  const shot = async (name) => { const f = path.join(outDir, `${name}.png`); await page.screenshot({path: f}); report.screenshots.push(f); return f; };
  const waitFor = async (fn, timeout = 60000, poll = 250) => {
    const t0 = Date.now();
    for (;;) {
      const v = await fn();
      if (v) return v;
      if (Date.now() - t0 > timeout) return null;
      await sleep(poll);
    }
  };
  try {
    report.url = `http://127.0.0.1:${port}${prefix}index.html?qa=1&seed=${SEED}`;
    await page.goto(report.url, {waitUntil: 'load'});
    const ready = await waitFor(() => page.evaluate(() => !!window.__LL && window.__LL.ready() && window.__LL.state() === 'title'), 180000, 500);
    step('loads all assets and reaches title screen', !!ready, {ms: Date.now()});
    // Iteration 13 (CORE): the backend the game's WebGPURenderer actually initialized (not a probe canvas / navigator.gpu)
    report.gpu = await page.evaluate(() => window.__LL.gpu());
    report.renderer = report.gpu ? `${report.gpu.label}${report.gpu.glRenderer ? ` · ${report.gpu.glRenderer}` : ''}${report.gpu.adapter ? ` · ${[report.gpu.adapter.vendor, report.gpu.adapter.description].filter(Boolean).join(' ')}` : ''}` : null;
    await shot('01-title');
    const saveMap = async (name) => { const d = await page.evaluate(() => window.__LL.mapImage(4)); const f = path.join(outDir, name); fs.writeFileSync(f, Buffer.from(d.split(',')[1], 'base64')); report.screenshots.push(f); };
    await saveMap('map-seed-fixed.png');
    let s = await snap();
    step('station generated with zombies and pickups', s.zombies.length >= 4 && s.pickups.length > 5, {name: s.name, seed: s.seed, zombies: s.zombies.length, pickups: s.pickups.length, world: s.world, genMs: s.genMs});
    step('zombies are rigged (skeleton + clips found)', s.zombies.every(z => z.rigged), {});

    await page.click('#btn-start');
    await waitFor(async () => (await snap()).state === 'playing', 10000);
    await sleep(1500);
    s = await snap();
    step('enters play state', s.state === 'playing', {frames: s.frames});
    await shot('02-spawn-view');

    // --- movement + collision -------------------------------------------------------------
    const p0 = s.player;
    await page.keyboard.down('KeyW');
    await waitFor(async () => { const q = (await snap()).player; return Math.hypot(q.x - p0.x, q.z - p0.z) > 2; }, 20000);
    await page.keyboard.up('KeyW');
    s = await snap();
    const moved = Math.hypot(s.player.x - p0.x, s.player.z - p0.z);
    step('W moves the player', moved > 1.5, {moved: +moved.toFixed(2)});
    // sprint check
    const st0 = s.player.stamina;
    await page.keyboard.down('ShiftLeft'); await page.keyboard.down('KeyW');
    await sleep(2500);
    s = await snap();
    await page.keyboard.up('KeyW'); await page.keyboard.up('ShiftLeft');
    step('sprint drains stamina', s.player.stamina < st0, {stamina: s.player.stamina});

    // steer along an A* path with real key presses
    const walkTo = async (x, z, near = 0.9, timeout = 90000) => {
      const t0 = Date.now();
      let path = await page.evaluate((x, z) => window.__LL.pathTo(x, z), x, z);
      if (!path) return false;
      await page.keyboard.down('KeyW');
      try {
        while (Date.now() - t0 < timeout) {
          const q = (await snap()).player;
          if (Math.hypot(q.x - x, q.z - z) < near) return true;
          while (path.length > 1 && Math.hypot(path[0][0] - q.x, path[0][1] - q.z) < 0.5) path.shift();
          const [wx, wz] = path[0];
          await page.evaluate((wx, wz) => window.__LL.lookAt(wx, 1.62, wz), wx, wz);
          if (Math.hypot(wx - q.x, wz - q.z) < 0.4 && path.length === 1) return true;
          await sleep(120);
          if ((Date.now() - t0) % 4000 < 150) path = (await page.evaluate((x, z) => window.__LL.pathTo(x, z), x, z)) ?? path;
        }
        return false;
      } finally { await page.keyboard.up('KeyW'); }
    };
    const takePickup = async (itemId) => {
      const pk = (await snap()).pickups.find(p => p.itemId === itemId);
      if (!pk) return {ok: false, why: 'missing'};
      const reached = await walkTo(pk.x, pk.z, 1.0);
      await page.evaluate((x, y, z) => window.__LL.lookAt(x, y + 0.05, z), pk.x, pk.y, pk.z);
      await sleep(400);
      const prompt = await page.$eval('#prompt', e => e.textContent);
      await page.keyboard.press('KeyE');
      await sleep(600);
      const after = await snap();
      return {ok: !after.pickups.some(p => p.itemId === itemId && Math.hypot(p.x - pk.x, p.z - pk.z) < 0.01), reached, prompt};
    };

    const sg = await takePickup('shotgun');
    s = await snap();
    step('walks to and picks up the shotgun with E (prompt shown)', sg.ok && s.hotbar.some(h => h?.itemId === 'shotgun'), {...sg, hotbar: s.hotbar.map(h => h?.itemId ?? null)});
    const sh = await takePickup('ammo_shells');
    s = await snap();
    step('picks up shotgun shells into the backpack', sh.ok && s.ammo.shells >= 8, {...sh, shells: s.ammo.shells});
    await shot('03-after-pickups');

    // --- equip + fire + reload ----------------------------------------------------------
    const slotOf = id => s.hotbar.findIndex(h => h?.itemId === id);
    await page.keyboard.press(`Digit${slotOf('shotgun') + 1}`);
    await waitFor(async () => (await snap()).weapon.id === 'shotgun', 8000);
    await sleep(1500);
    s = await snap();
    const sgMag0 = s.held?.mag;
    step('key selects and equips the shotgun', s.weapon.id === 'shotgun', {mag: sgMag0, phase: s.weapon.phase});
    await page.evaluate(() => { const p = window.__LL.snapshot().player; window.__LL.lookAt(p.x + Math.sin(-p.yaw) * 5, 1.2, p.z - Math.cos(p.yaw) * 5); });
    await page.mouse.click(640, 360);
    await sleep(800);
    await shot('04-shotgun-fired');
    s = await snap();
    step('left click fires the shotgun (mag -1)', s.held?.mag === sgMag0 - 1, {mag: s.held?.mag, shots: s.stats.shots});
    await page.keyboard.press('KeyR');
    await sleep(300);
    const reloadingSg = (await snap()).weapon.phase;
    await waitFor(async () => (await snap()).weapon.phase === 'idle', 20000);
    s = await snap();
    step('R reloads the shotgun shell by shell from inventory', reloadingSg === 'reloading' && s.held?.mag === sgMag0, {phaseDuring: reloadingSg, mag: s.held?.mag, shells: s.ammo.shells});

    await page.keyboard.press('Digit1');
    await waitFor(async () => (await snap()).weapon.id === 'rifle', 8000);
    await sleep(1200);
    s = await snap();
    const rMag0 = s.held.mag;
    await page.mouse.down();
    await sleep(900);
    await page.mouse.up();
    await sleep(300);
    s = await snap();
    step('rifle fires automatically while the trigger is held', s.held.mag < rMag0 - 1, {before: rMag0, after: s.held.mag});
    await shot('05-rifle-fire');
    await page.keyboard.press('KeyR');
    await sleep(300);
    const rPhase = (await snap()).weapon.phase;
    await waitFor(async () => (await snap()).weapon.phase === 'idle', 20000);
    s = await snap();
    step('rifle magazine reload restores 30 rounds', rPhase === 'reloading' && s.held.mag === 30, {phase: rPhase, mag: s.held.mag, reserve: s.ammo.rifle});

    // --- inventory UI ------------------------------------------------------------------
    await page.keyboard.press('Tab');
    await waitFor(async () => (await snap()).state === 'inventory', 5000);
    await sleep(500);
    await shot('06-inventory');
    s = await snap();
    const bandageSlot = s.hotbar.findIndex(h => h?.itemId === 'bandage');
    const emptyPack = s.pack.findIndex(x => !x);
    await page.click(`#inv-hotbar .slot[data-index="${bandageSlot}"]`);
    await page.click(`#inv-pack .slot[data-index="${emptyPack}"]`);
    await sleep(300);
    s = await snap();
    const movedToPack = s.pack[emptyPack]?.itemId === 'bandage' && !s.hotbar[bandageSlot];
    await page.click(`#inv-pack .slot[data-index="${emptyPack}"]`);
    await page.keyboard.press('Digit4');
    await sleep(300);
    s = await snap();
    const assigned = s.hotbar[3]?.itemId === 'bandage';
    step('inventory: click-move to backpack and 1-5 assignment to a quick slot', movedToPack && assigned && s.invariants.length === 0, {movedToPack, assigned, invariants: s.invariants});
    // Drop the shells stack from the backpack, then pick it back up from the floor.
    s = await snap();
    const shellIdx = s.pack.findIndex(x => x?.itemId === 'ammo_shells');
    const shellsBefore = s.ammo.shells;
    await page.click(`#inv-pack .slot[data-index="${shellIdx}"]`);
    await page.click('#btn-inv-drop');
    await sleep(300);
    s = await snap();
    const dropped = s.pickups.find(p => p.itemId === 'ammo_shells' && Math.hypot(p.x - s.player.x, p.z - s.player.z) < 1.5);
    await page.keyboard.press('Tab');
    await waitFor(async () => (await snap()).state === 'playing', 5000);
    step('Tab closes inventory and resumes play', (await snap()).state === 'playing');
    let regained = false;
    if (dropped) {
      await page.evaluate((x, y, z) => window.__LL.lookAt(x, y + 0.05, z), dropped.x, dropped.y, dropped.z);
      await sleep(500);
      await page.keyboard.press('KeyE');
      await sleep(500);
      regained = (await snap()).ammo.shells === shellsBefore;
    }
    step('Drop puts the item on the floor in front of the player; E picks it back up', s.ammo.shells === 0 && !!dropped && regained, {shellsBefore, droppedAt: dropped && [dropped.x, dropped.z], regained});

    // --- pause really pauses ---------------------------------------------------------------
    // Alert zombies with gunfire first so something is moving.
    await page.mouse.click(640, 360);
    await sleep(1500);
    await page.keyboard.press('Escape');
    await waitFor(async () => (await snap()).state === 'paused', 5000);
    const pz0 = (await snap()).zombies.map(z => [z.x, z.z]);
    const hp0 = (await snap()).player.hp;
    await sleep(3000);
    s = await snap();
    const still = s.zombies.every((z, i) => Math.hypot(z.x - pz0[i][0], z.z - pz0[i][1]) < 1e-6);
    step('pause freezes zombies and player health', s.state === 'paused' && still && s.player.hp === hp0, {});
    await shot('07-pause-menu');
    await page.click('#btn-resume');
    await waitFor(async () => (await snap()).state === 'playing', 5000);

    // --- engage a zombie --------------------------------------------------------------
    const pickTarget = async () => {
      const q = await snap();
      const alive = q.zombies.map((z, i) => ({...z, i})).filter(z => z.alive);
      alive.sort((a, b) => Math.hypot(a.x - q.player.x, a.z - q.player.z) - Math.hypot(b.x - q.player.x, b.z - q.player.z));
      return alive[0];
    };
    let target = await pickTarget();
    let firstSeenShot = false;
    const engageT0 = Date.now();
    let killedOne = false;
    while (Date.now() - engageT0 < 150000 && target) {
      const q = await snap();
      const z = q.zombies[target.i];
      if (!z.alive) { killedOne = true; break; }
      const d = Math.hypot(z.x - q.player.x, z.z - q.player.z);
      const head = await page.evaluate(i => window.__LL.zombieChest(i), target.i);
      const los = await page.evaluate((i) => { const g = window.__game; const zz = g.zombies[i].brain; return g.layout.grid.lineOfSight(g.player.x, g.player.z, zz.x, zz.z); }, target.i);
      if (d > 12 || !los) {
        await walkTo(z.x, z.z, 10, 6000);
        continue;
      }
      if (head) await page.evaluate((h) => window.__LL.lookAt(h.x, h.y, h.z), head);
      if (!firstSeenShot) { await sleep(300); await shot('08-zombie-in-view'); firstSeenShot = true; }
      if (q.held?.mag === 0) { await page.keyboard.press('KeyR'); await waitFor(async () => (await snap()).weapon.phase === 'idle', 15000); continue; }
      await page.mouse.down();
      await sleep(250);
      await page.mouse.up();
      await sleep(150);
    }
    s = await snap();
    step('shoots and kills a zombie (hits register on rigged hit volumes)', killedOne, {kills: s.stats.kills, shots: s.stats.shots, hits: s.stats.hits});
    await sleep(1200);
    await shot('09-zombie-down');

    // --- take damage, then die ------------------------------------------------------
    // Stand still and keep the station alerted; zombies path in and attack.
    const hpStart = (await snap()).player.hp;
    let tookDamage = false, damageShot = false, healPressedAt = 0;
    const dmgT0 = Date.now();
    while (Date.now() - dmgT0 < 240000) {
      s = await snap();
      if (s.state === 'dead') break;
      if (s.player.hp < hpStart && !tookDamage) {
        tookDamage = true;
        // Quick heal (H) uses the bandage; taking hits does not cancel it.
        await page.keyboard.press('KeyH');
        healPressedAt = Date.now();
      }
      if (tookDamage && !damageShot) { damageShot = true; await shot('10-taking-damage'); }
      const alive = s.zombies.filter(z => z.alive);
      if (!alive.length) break;
      // face the closest attacker so the screenshot shows it; fire into the ceiling as a lure
      const c = alive.sort((a, b) => Math.hypot(a.x - s.player.x, a.z - s.player.z) - Math.hypot(b.x - s.player.x, b.z - s.player.z))[0];
      await page.evaluate((x, z) => window.__LL.lookAt(x, 1.5, z), c.x, c.z);
      if (Math.hypot(c.x - s.player.x, c.z - s.player.z) > 6 && (Date.now() - dmgT0) % 8000 < 400) {
        await page.evaluate(() => { const p = window.__LL.snapshot().player; window.__LL.lookAt(p.x, 4, p.z - 1); });
        await page.mouse.click(640, 360);
      }
      await sleep(400);
    }
    s = await snap();
    step('zombies reach and damage the player', tookDamage || s.player.hp < hpStart, {hp: s.player.hp});
    step('H uses a healing item (bandage consumed, health restored)', s.stats.itemsUsed >= 1 && s.stats.healed > 0 && !s.hotbar.concat(s.pack).some(x => x?.itemId === 'bandage'), {healed: s.stats.healed, itemsUsed: s.stats.itemsUsed, healPressed: !!healPressedAt});
    step('player death shows the death screen', s.state === 'dead', {state: s.state});
    if (s.state === 'dead') await shot('11-death-screen');

    // --- restart = fresh seed, nothing persisted ------------------------------------
    const seedBefore = s.seed, nameBefore = s.name;
    if (s.state === 'dead') {
      await page.click('#btn-death-new');
      await waitFor(async () => (await snap()).state === 'playing', 20000);
      await sleep(1000);
      s = await snap();
      step('New station restarts with a fresh seed and full health', s.seed !== seedBefore && s.player.hp === 100 && s.player.alive, {seedBefore, seedAfter: s.seed, nameBefore, nameAfter: s.name});
      await shot('12-new-station');
    }
    const storage = await page.evaluate(() => window.__LL.storageKeys());
    const idb = await page.evaluate(async () => (indexedDB.databases ? (await indexedDB.databases()).map(d => d.name) : 'unsupported'));
    step('no localStorage / sessionStorage / IndexedDB persistence', storage.local.length === 0 && storage.session.length === 0 && (idb === 'unsupported' || idb.length === 0), {storage, idb});

    // reload = fresh random station (no ?seed)
    await page.goto(`http://127.0.0.1:${port}${prefix}index.html?qa=1`, {waitUntil: 'load'});
    await waitFor(() => page.evaluate(() => !!window.__LL && window.__LL.ready()), 180000, 500);
    const r1 = (await snap()).seed;
    await saveMap('map-reload-1.png');
    await page.reload({waitUntil: 'load'});
    await waitFor(() => page.evaluate(() => !!window.__LL && window.__LL.ready()), 180000, 500);
    const r2 = (await snap()).seed;
    await saveMap('map-reload-2.png');
    step('each page load generates a different station', r1 !== r2, {r1, r2});
    s = await snap();
    report.finalRender = {render: s.render, memory: s.memory, world: s.world};
  } catch (err) {
    step('unexpected exception', false, {error: String(err?.stack ?? err).slice(0, 1500)});
  } finally {
    report.requests = log;
    report.missingRequests = log.filter(l => l.status !== 200);
    await browser.close();
    server.close();
  }
});

const fatalConsole = report.console.filter(c => c.startsWith('error'));
step('no page errors, console errors or failed requests', report.pageErrors.length === 0 && fatalConsole.length === 0 && report.missingRequests.length === 0 && report.badResponses.length === 0, {pageErrors: report.pageErrors.length, consoleErrors: fatalConsole.length, missing: report.missingRequests.length});
report.ok = report.steps.every(s => s.ok);
report.finishedAt = new Date().toISOString();
fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));
console.log(report.ok ? 'PLAYTEST PASSED' : 'PLAYTEST HAD FAILURES', path.join(outDir, 'report.json'));
process.exit(report.ok ? 0 : 1);
