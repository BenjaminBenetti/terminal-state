// Short iteration-03 browser check of the STATIC build (QA hooks via ?qa=1): big layout loads + moves,
// hunger/thirst 80, visible loot taken + consumed, cabinet contents visible, a real rifle kill ragdolls,
// casings spawn/land, no page errors. Usage: node game/e2e/iter03-check.mjs OUTDIR [--dist=dist/game] [--seed=1A2B3C]
import fs from 'node:fs';
import path from 'node:path';
import {launchBrowser, withBrowserLock} from '../../tools/qa/browser-env.mjs';
import {serveStatic} from '../../tools/qa/static-server.mjs';

const arg = (k, d) => (process.argv.find(a => a.startsWith(`--${k}=`)) ?? `--${k}=${d}`).split('=')[1];
const outDir = path.resolve(process.argv.find((a, i) => i > 1 && !a.startsWith('--')) ?? 'qa-artifacts/iter03');
const dist = path.resolve(arg('dist', 'dist/game'));
const SEED = arg('seed', '1A2B3C');
fs.mkdirSync(outDir, {recursive: true});
const sleep = ms => new Promise(r => setTimeout(r, ms));
const report = {startedAt: new Date().toISOString(), dist, seed: SEED, steps: [], pageErrors: [], console: [], badResponses: [], screenshots: []};
const step = (name, ok, detail = {}) => { report.steps.push({name, ok, detail}); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`, JSON.stringify(detail).slice(0, 500)); return ok; };

await withBrowserLock(async () => {
  const {server, port} = await serveStatic(dist, {prefix: '/'});
  const browser = await launchBrowser();
  const page = await browser.newPage();
  await page.setViewport({width: 1280, height: 720});
  page.on('pageerror', e => report.pageErrors.push(String(e).slice(0, 600)));
  page.on('console', m => { if (['error', 'warn', 'warning'].includes(m.type())) report.console.push(`${m.type()}: ${m.text()}`.slice(0, 300)); });
  page.on('response', r => { if (r.status() >= 400) report.badResponses.push(`${r.status()} ${r.url()}`); });
  const ev = (fn, ...a) => page.evaluate(fn, ...a);
  const snap = () => ev(() => window.__LL.snapshot());
  const shot = async name => { const f = path.join(outDir, `${name}.png`); await page.screenshot({path: f}); report.screenshots.push(f); };
  const waitFor = async (fn, timeout = 20000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > timeout) return null; await sleep(200); } };
  const areaCenter = a => ({x: (a.x + a.w / 2) * 0.5, z: (a.y + a.h / 2) * 0.5});
  try {
    await page.goto(`http://127.0.0.1:${port}/index.html?qa=1&seed=${SEED}`);
    const ready = await waitFor(() => ev(() => !!window.__LL?.ready() && window.__LL.state() === 'title').catch(() => false), 240000);
    step('loads to title', !!ready);
    await page.click('#btn-start');
    await waitFor(async () => (await snap()).state === 'playing');
    await sleep(2500);
    let s = await snap();
    const types = {};
    for (const a of s.layout.areas) types[a.type] = (types[a.type] ?? 0) + 1;
    const plat = s.layout.areas.filter(a => a.type === 'platform').map(a => ({len: +(Math.max(a.w, a.h) * 0.5).toFixed(1), wid: +(Math.min(a.w, a.h) * 0.5).toFixed(1)}));
    step('enters play on the big layout', s.state === 'playing' && plat.length >= 1 && Math.max(...plat.map(p => p.len)) >= 100 && !!types['food-court'],
      {name: s.name, genMs: s.genMs, areas: s.layout.areas.length, types, platforms: plat, props: s.layout.props, zombies: s.zombies.length, render: s.render});
    fs.writeFileSync(path.join(outDir, 'map.png'), Buffer.from((await ev(() => window.__LL.mapImage(3))).split(',')[1], 'base64'));
    await shot('01-spawn-platform');
    step('hunger and thirst start at 80', Math.round(s.survival.hunger) === 80 && Math.round(s.survival.thirst) === 80, s.survival);

    // movement
    const p0 = s.player;
    // software GL runs a few fps with capped dt: hold W until 1 m of movement (or 10 s)
    await page.keyboard.down('KeyW');
    await waitFor(async () => { const q = await snap(); return Math.hypot(q.player.x - p0.x, q.player.z - p0.z) > 1; }, 10000);
    await page.keyboard.up('KeyW');
    s = await snap();
    step('moves', Math.hypot(s.player.x - p0.x, s.player.z - p0.z) > 1, {from: [p0.x, p0.z], to: [s.player.x, s.player.z]});

    // layout views: food court, concourse/ticket hall
    for (const [t, name] of [['food-court', '02-food-court'], ['ticket-hall', '03-ticket-hall'], ['concourse', '04-concourse']]) {
      const a = s.layout.areas.find(q => q.type === t) ?? (t === 'ticket-hall' ? s.layout.areas.find(q => q.type === 'fare-hall') : null);
      if (!a) continue;
      const c = areaCenter(a);
      const wide = a.w >= a.h;
      await ev((x, z) => window.__LL.teleport(x, z), wide ? c.x - (a.w * 0.5) * 0.4 : c.x, wide ? c.z : c.z - (a.h * 0.5) * 0.4);
      await ev((x, z) => window.__LL.lookAt(x, 1.6, z), wide ? c.x + a.w * 0.25 : c.x, wide ? c.z : c.z + a.h * 0.25);
      await sleep(1800);
      await shot(name);
    }

    // generated props up close: kiosk stall, vending machine, stock-room shelf (with their loot)
    const seen = {};
    for (const kind of ['stall', 'vending', 'shelf']) {
      const serial = await ev(k => { const cm = window.__game.containers; const h = cm.all.filter(q => q.kind === k && q.state.lots.length)[0] ?? cm.all.filter(q => q.kind === k)[0]; return h ? h.serial : null; }, kind);
      if (serial === null) { seen[kind] = false; continue; }
      const a0 = await ev(i => window.__LL.aimHolder(i), serial);
      const back = kind === 'stall' ? 1.4 : 0.6;
      await ev((x, z, ax, az, b) => { const dx = x - ax, dz = z - az, d = Math.hypot(dx, dz) || 1; window.__LL.teleport(x + dx / d * b, z + dz / d * b); }, a0.stand.x, a0.stand.z, a0.aim.x, a0.aim.z, back);
      await sleep(300);
      await ev(i => window.__LL.aimHolder(i), serial);
      await sleep(1500);
      await shot(`04-${kind}`);
      seen[kind] = a0.lots;
    }
    const models = await ev(() => ['stall', 'vending', 'shelf', 'item_water', 'item_cola', 'item_juice', 'item_chocolate', 'item_chips', 'item_beans', 'item_noodles'].filter(k => !!window.__game.assets.models[k]));
    step('generated stall/vending/shelf/item models load and are placed', models.length === 10 && seen.stall !== false && seen.vending !== false && seen.shelf !== false, {models, lotsSeen: seen});

    // visible loot on a stall/shelf: take a drink and drink it
    let lootOk = false, lootDetail = {};
    const target = await ev(() => window.__LL.aimLoot({itemId: 'water', visibleOnly: true}) ?? window.__LL.aimLoot({itemId: 'cola', visibleOnly: true}) ?? window.__LL.aimLoot({itemId: 'juice', visibleOnly: true}));
    if (target) {
      await ev((x, z) => window.__LL.teleport(x, z), target.stand.x, target.stand.z);
      await sleep(400);
      await ev(o => window.__LL.aimLoot({serial: o.serial, itemId: o.itemId}), target);
      await sleep(700);
      await shot('05-visible-loot');
      const prompt = await page.$eval('#prompt', e => e.textContent);
      const before = await snap();
      await page.keyboard.press('KeyE');
      await sleep(900);
      const after = await snap();
      const slot = after.hotbar.findIndex(h => h && h.itemId === target.itemId);
      let thirst0 = after.survival.thirst, thirst1 = thirst0;
      if (slot >= 0) {
        await page.keyboard.press(`Digit${slot + 1}`);
        await sleep(600);
        await page.mouse.down(); await sleep(120); await page.mouse.up();
        await waitFor(async () => (await snap()).survival.thirst > thirst0 + 5, 60000);
        thirst1 = (await snap()).survival.thirst;
        await shot('06-after-drink-hud');
      }
      lootOk = slot >= 0 && thirst1 > thirst0 + 5;
      lootDetail = {holder: target.kind, item: target.itemId, prompt, slot, thirstBefore: +thirst0.toFixed(1), thirstAfter: +thirst1.toFixed(1), lootBefore: before.loot && {...before.loot, holders: undefined}};
    }
    step('visible drink on a holder is taken with E and drinking raises thirst', lootOk, lootDetail);

    // cabinet: open shows items inside
    s = await snap();
    const cab = await ev(() => { const cm = window.__game.containers; const p = window.__game.player; const c = cm.all.filter(h => /cabinet/.test(h.kind) && h.state.lots.length).sort((a, b) => Math.hypot(a.prop.x - p.x, a.prop.z - p.z) - Math.hypot(b.prop.x - p.x, b.prop.z - p.z))[0]; return c ? c.serial : null; });
    if (cab !== null) {
      const a0 = await ev(i => window.__LL.aimHolder(i), cab);
      await ev((x, z) => window.__LL.teleport(x, z), a0.stand.x, a0.stand.z);
      await sleep(300);
      await ev(i => window.__LL.aimHolder(i), cab);
      await sleep(400);
      const prompt0 = await page.$eval('#prompt', e => e.textContent);
      await page.keyboard.press('KeyE');
      await sleep(1800);
      await ev(i => window.__LL.aimHolder(i), cab);
      await sleep(500);
      await shot('07-cabinet-open-contents');
      const h = await ev(i => { const q = window.__game.containers.all[i]; return {open: q.state.open, lots: q.state.lots.map(l => l.itemId + 'x' + l.count)}; }, cab);
      step('cabinet opens and its contents stay visible inside', h.open && h.lots.length > 0, {prompt0, ...h});
    } else step('cabinet with contents exists', false);

    // real rifle kill -> ragdoll, casings
    await page.keyboard.press('Digit1'); await sleep(500);
    s = await snap();
    const zi = s.zombies.map((z, i) => ({...z, i, d: Math.hypot(z.x - s.player.x, z.z - s.player.z)})).filter(z => z.alive).sort((a, b) => a.d - b.d)[0];
    let ragOk = false, ragDetail = {};
    if (zi) {
      const path0 = await ev((x, z) => window.__LL.pathTo(x, z), zi.x, zi.z);
      // stand ~4 m from the zombie on its path back toward the player
      // walk back from the zombie along the path polyline to a point ~4.5 m away (clear line of fire)
      const pts = [{x: s.player.x, z: s.player.z}, ...(path0?.length ? path0 : []), {x: zi.x, z: zi.z}];
      let stand = pts[0], need = 4.5;
      for (let k = pts.length - 1; k > 0; k--) {
        const a = pts[k], b = pts[k - 1], seg = Math.hypot(b.x - a.x, b.z - a.z);
        if (seg >= need) { stand = {x: a.x + (b.x - a.x) * need / seg, z: a.z + (b.z - a.z) * need / seg}; break; }
        need -= seg; stand = b;
      }
      await ev((x, z) => window.__LL.teleport(x, z), stand.x, stand.z);
      const c0 = (await snap()).physics.casingsLive ?? 0;
      for (let k = 0; k < 40; k++) {
        const ch = await ev(i => window.__LL.zombieChest(i), zi.i);
        if (ch) await ev(c => window.__LL.lookAt(c.x, c.y, c.z), ch);
        await page.mouse.down(); await sleep(260); await page.mouse.up();
        const q = await snap();
        if (!q.zombies[zi.i].alive) break;
        if (q.weapon.phase === 'reloading' || q.held?.mag === 0) { await page.keyboard.press('KeyR'); await sleep(2500); }
      }
      await sleep(300);
      const q1 = await snap();
      await shot('08-ragdoll-falling');
      const casings = q1.physics.casingsLive ?? q1.physics.casings?.length;
      await waitFor(async () => { const q = await snap(); return q.physics.ragdollsActive === 0 && q.physics.ragdollsFrozen >= 1; }, 90000);
      const q2 = await snap();
      const zz = q2.zombies[zi.i];
      await ev((x, z) => window.__LL.lookAt(x, 0.2, z), zz.x, zz.z);
      await sleep(600);
      await shot('09-ragdoll-settled');
      ragOk = !q1.zombies[zi.i].alive && q2.physics.ragdollsFrozen >= 1 && (q2.physics.ragdollsFailed ?? 0) === 0 && casings > c0;
      ragDetail = {zombie: zi.i, killed: !q1.zombies[zi.i].alive, physicsDuring: {...q1.physics, ragdolls: undefined, casings: undefined}, physicsAfter: {...q2.physics, ragdolls: q2.physics.ragdolls, casings: (q2.physics.casings ?? []).slice(-3)}, casingsLive: casings};
      // look down at casings on the floor
      const pl = q2.player;
      await ev((x, z) => window.__LL.lookAt(x, 0, z), pl.x + Math.sin(pl.yaw) * -0.2 + 0.6, pl.z);
      await sleep(500);
      await shot('10-casings-floor');
    }
    step('real rifle kill ragdolls (settles + freezes, no failures) and casings spawn', ragOk, ragDetail);

    // pause freezes survival
    await page.keyboard.press('Escape');
    await waitFor(async () => (await snap()).state === 'paused', 5000);
    await sleep(300);
    const t0 = (await snap()).survival.time;
    await sleep(2500);
    const t1 = (await snap()).survival.time;
    step('pause freezes the survival clock', Math.abs(t1 - t0) < 0.05, {t0, t1});
    // New Station resets 80/80 + audio stays one running context
    await page.click('#btn-new-station');
    await waitFor(async () => (await snap()).state === 'playing', 30000);
    await sleep(1500);
    s = await snap();
    const au = await ev(() => window.__LL.audio());
    step('New Station resets hunger/thirst and keeps one running audio context', Math.round(s.survival.hunger) === 80 && Math.round(s.survival.thirst) === 80 && au.contexts === 1 && au.state === 'running',
      {survival: s.survival, audio: {contexts: au.contexts, state: au.state, ambientLoops: au.ambientLoops}});
    await shot('11-new-station');
    step('no page errors', report.pageErrors.length === 0 && !s.lastError, {pageErrors: report.pageErrors.slice(0, 3), lastError: s.lastError, render: s.render});
  } catch (e) {
    step('script error', false, {error: String(e?.stack ?? e).slice(0, 700)});
  } finally {
    await browser.close();
    server.close();
    report.ok = report.steps.every(x => x.ok);
    fs.writeFileSync(path.join(outDir, 'iter03-check.json'), JSON.stringify(report, null, 2));
  }
});
