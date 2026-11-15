// Focused Surface Run spot check. Run ONLY through the task heavy-job runner; the browser lock is nested inside it.
// Camera placements and explicit kill fixtures are harness actions, not claims of a manually traversed expedition.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
import {withBrowserLock, launchBrowser, ensureDisplay, firefoxPath, DISPLAY} from './browser-env.mjs';
import {serveStatic} from './static-server.mjs';

const mode = process.argv[2] ?? 'tour', backend = process.argv[3] ?? 'webgpu';
const out = path.resolve(process.argv[4] ?? `qa-artifacts/surface-${mode}-${backend}`);
const input = process.argv[5];
fs.mkdirSync(out, {recursive: true});
const sleep = ms => new Promise(r => setTimeout(r, ms));
const memory = () => {
  const s = fs.readFileSync('/sys/fs/cgroup/memory.stat', 'utf8');
  const n = key => Number(new RegExp(`^${key} (\\d+)$`, 'm').exec(s)?.[1] ?? 0);
  return {current: Number(fs.readFileSync('/sys/fs/cgroup/memory.current', 'utf8')), anon: n('anon') + n('shmem')};
};
const report = {mode, backend, started: new Date().toISOString(), outcome: 'running', steps: [], errors: [], warnings: [], peakGiB: 0,
  note: 'Software lavapipe/llvmpipe functional evidence, no hardware FPS claim. Camera relocations and scripted kills are labelled fixtures. Initial preview save is exported before QA equipment grants.'};
const record = (name, data = {}) => { report.steps.push({name, ...data}); fs.writeFileSync(path.join(out, 'run.json'), JSON.stringify(report, null, 2)); console.log(name, JSON.stringify(data).slice(0, 900)); };
let browser = null, server = null, guard;
async function closeBrowser() {
  if (!browser) return;
  const b = browser; browser = null; const proc = b.process?.();
  const closed = await Promise.race([b.close().then(() => true, () => false), sleep(10000).then(() => false)]);
  if (!closed && proc && proc.exitCode === null) proc.kill('SIGTERM');
}
async function launch() {
  if (backend === 'webgl2') return launchBrowser({protocolTimeout: 600000});
  await ensureDisplay();
  const exe = firefoxPath(), root = path.join(os.homedir(), '.local/ll-ff-libs/root'), libs = path.join(root, 'usr/lib/x86_64-linux-gnu');
  const vk = path.join(os.homedir(), '.local/ll-vk-libs/root/usr/lib/x86_64-linux-gnu'), icd = path.join(out, 'lvp_icd.json');
  fs.writeFileSync(icd, JSON.stringify({ICD: {api_version: '1.1.230', library_path: path.join(vk, 'libvulkan_lvp.so')}, file_format_version: '1.0.0'}));
  return puppeteer.launch({browser: 'firefox', executablePath: exe, headless: false, protocolTimeout: 600000,
    env: {...process.env, DISPLAY, LD_LIBRARY_PATH: [path.dirname(exe), libs, vk].join(':'), LIBGL_DRIVERS_PATH: path.join(libs, 'dri'),
      __EGL_VENDOR_LIBRARY_DIRS: path.join(root, 'usr/share/glvnd/egl_vendor.d'), XKB_CONFIG_ROOT: path.join(root, 'usr/share/X11/xkb'), VK_ICD_FILENAMES: icd, VK_DRIVER_FILES: icd},
    extraPrefsFirefox: {'webgl.force-enabled': true, 'media.autoplay.default': 0, 'dom.webgpu.enabled': true, 'gfx.webgpu.ignore-blocklist': true}});
}
process.on('SIGTERM', () => { report.outcome = 'heavy-guard-stopped'; record('terminated by owned heavy-job guard'); void closeBrowser(); });
try {
  await withBrowserLock(async () => {
    const served = await serveStatic(path.resolve('dist/game')); server = served.server;
    guard = setInterval(() => {
      const m = memory(); report.peakGiB = Math.max(report.peakGiB, m.current / 2 ** 30, m.anon / 2 ** 30);
      if (Math.max(m.current, m.anon) >= 10 * 2 ** 30) { report.outcome = 'browser-memory-guard'; record('10 GiB guard'); void closeBrowser(); }
    }, 300);
    try {
      browser = await launch(); const page = await browser.newPage(); await page.setViewport({width: 960, height: 600}); await page.bringToFront();
      page.on('pageerror', e => { if (report.errors.length < 50) report.errors.push(String(e).slice(0, 700)); });
      page.on('console', m => { if (m.type() === 'error' && report.errors.length < 50) report.errors.push(m.text().slice(0, 700));
        if (m.text().startsWith('Surface Run: boundary')) record('boundary phase', {message: m.text(), memory: memory()});
        if (m.text().startsWith('SURFACE_QA_GRAPHICS')) record('graphics preparation progress', {message: m.text(), memory: memory()});
        if (['warn', 'warning'].includes(m.type()) && report.warnings.length < 50) report.warnings.push(m.text().slice(0, 700)); });
      const ev = (fn, ...args) => page.evaluate(fn, ...args);
      const wait = async (fn, arg, seconds = 600) => { const end = Date.now() + seconds * 1000; let nextLog = Date.now() + 5000, last = '';
        while (Date.now() < end) { if (await ev(fn, arg)) return;
          if (Date.now() >= nextLog) { nextLog = Date.now() + 10000;
            const state = await ev(() => ({state: window.__game?.state, current: window.__game?.run?.current,
              warming: window.__game?.warming, label: document.querySelector('#load .label')?.textContent}));
            const key = JSON.stringify(state); if (last !== key) { last = key; record('loading progress', state); } }
          await sleep(500); }
        const diagnostic = await ev(() => ({state: window.__game?.state, current: window.__game?.run?.current,
          clock: window.__game?.clock, frames: window.__game?.frames, warming: window.__game?.warming, buildHold: window.__game?.buildHold,
          visibility: document.visibilityState, focus: document.hasFocus(), frameProbe: window.__surfaceFrameProbe,
          frameCpu: window.__game?.frameCpu, warmup: window.__game?.warmup, error: window.__game?.lastError, ui: document.body.innerText.slice(-1800)}));
        record('state wait timed out', diagnostic); try { await shot('failure-state'); } catch (e) {record('failure capture unavailable', {error: String(e)});}
        throw new Error('Timed out waiting for the expected game state'); };
      const gameTime = async seconds => { const start = await ev(() => window.__game.clock); await wait(t => window.__game.clock >= t || window.__game.state === 'error', start + seconds, 180); };
      const play = async () => { if (await ev(() => window.__game.state === 'paused')) await page.click('#btn-resume'); await wait(() => window.__game.state === 'playing'); };
      const pose = async (at, target) => ev((p, t) => { const g = window.__game; g.player.place(p.x, p.z, p.yaw ?? 0, p.y ?? 0);
        g.player.eye += g.player.y; // place resets the eye to standing offset; a normal Player.update later adds the floor.
        if (t) { const dx = t.x - p.x, dz = t.z - p.z; g.player.yaw = Math.atan2(-dx, -dz); g.player.pitch = Math.atan2(t.y - g.player.eye, Math.hypot(dx, dz)); }
        g.updateCamera(0); g.surfaceRuntime.beforeRender(); g.render(); }, at, target);
      const shot = async name => { if (Math.max(memory().current, memory().anon) > 9.2 * 2 ** 30) throw new Error('Screenshot soft-stop preserves memory headroom');
        await page.screenshot({path: path.join(out, `${name}.png`)}); };
      const key = async code => { const before = await ev(() => window.__game.clock); await page.keyboard.press(code, {delay: 80});
        await wait(t => window.__game.clock > t || window.__game.state !== 'playing', before, 60); };
      const cross = async section => {
        const a = await ev(() => window.__game.layout.surface?.checkpoint.return ?? window.__game.layout.surfaceAccess);
        const returning = section === 'main', d = returning ? -1.1 : 0.7;
        await pose(a, {x: a.x - Math.sin(a.yaw) * d, y: a.y + 1.25, z: a.z - Math.cos(a.yaw) * d});
        record(`aim ${section} door`, {...await ev(() => ({aimed: window.__game.surfaceRuntime.accessAimed(), prompt: window.__game.surfaceRuntime.prompt(),
          clock: window.__game.clock, frames: window.__game.frames, cpuCopies: window.__LL.levelAssets()?.perf.cpuCopies})), memory: memory()});
        assert(await ev(() => window.__game.surfaceRuntime.accessAimed())); await key('KeyE');
        record('door request dispatched', await ev(() => ({state: window.__game.state, phase: window.__game.surfaceBoundaryPhase,
          warming: window.__game.warming, current: window.__game.run.current, label: document.querySelector('#load .label')?.textContent})));
        await wait(s => window.__game.run.current.section === s && !window.__game.warming && ['playing', 'paused', 'error'].includes(window.__game.state), section);
        assert.notEqual(await ev(() => window.__game.state), 'error'); await play();
        record(`entered ${section}`, await ev(() => ({warmup: window.__game.warmup, surface: window.__game.surfaceRuntime.summary(), population: window.__game.surfacePopulation.report()})));
        assert.equal(await ev(() => window.__game.warmup.status), 'complete');
        if (section === 'surface') { const summary = await ev(() => window.__game.surfaceRuntime.summary());
          assert.equal(summary.city.sectors, 64); assert.deepEqual(summary.city.missing, []);
          assert(summary.sectors.visible > 0 && summary.sectors.visible < 64); }
      };
      await page.goto(`http://127.0.0.1:${served.port}/?qa=1&qaPrebuild=0&menuScene=0&lighting=${backend === 'webgl2' ? 'off' : 'on'}&reflections=high${backend === 'webgl2' ? '&renderer=webgl2' : ''}`, {waitUntil: 'load'});
      await wait(() => !!window.__game?.assets?.models && !document.querySelector('#btn-start')?.disabled);
      record('boot ready', {qaMenuDioramaOmitted: true, gameplayQualityUnchanged: true});
      await ev(() => { const label = document.querySelector('#load .label'); let seen = 0;
        if (label) new MutationObserver(() => { if (window.__game.surfaceBoundaryPhase !== 'warming-target') return;
          const text = label.textContent ?? ''; if (!text.startsWith('Preparing graphics')) return;
          if (seen++ < 40 || seen % 40 === 0) console.info('SURFACE_QA_GRAPHICS', text);
        }).observe(label, {childList: true, characterData: true, subtree: true}); });
      await ev(() => { window.__surfaceFrameProbe = {raf: 0, timers: 0};
        const raf = () => { window.__surfaceFrameProbe.raf++; requestAnimationFrame(raf); }; requestAnimationFrame(raf);
        window.__surfaceTimer = setInterval(() => {window.__surfaceFrameProbe.timers++;}, 500); });
      if (mode === 'tour') {
        await ev(() => { const b = document.createElement('button'); b.id = 'surface-fixture-start'; b.textContent = 'Start seeded QA campaign'; b.style.cssText = 'position:fixed;top:0;left:0;z-index:9999';
          b.onclick = () => { window.__surfaceStart = null; void window.__game.newCampaign(3, {networkSeed: 5}).then(r => { window.__surfaceStart = r; b.remove(); }); }; document.body.appendChild(b); });
        await page.click('#surface-fixture-start'); record('normal seeded newCampaign loading');
        await wait(() => !!window.__surfaceStart); assert((await ev(() => window.__surfaceStart)).ok); await play();
        record('campaign frame state', await ev(() => ({clock: window.__game.clock, frames: window.__game.frames, warming: window.__game.warming,
          buildHold: window.__game.buildHold, visibility: document.visibilityState, focus: document.hasFocus()})));
        const initial = await ev(() => { const e = window.__game.saves.exportFile(3); if (!e.ok) throw new Error(e.error); return e.text; });
        fs.writeFileSync(path.join(out, 'legitimate-preview-start.json'), initial);
        record('legitimate new campaign', await ev(() => ({current: window.__game.run.current, seed: window.__game.run.seedFor(), cheat: window.__game.run.campaign.cheat, access: window.__game.layout.surfaceAccess,
          undergroundSurface: window.__game.surfaceRuntime.summary(), pool: window.__game.surfacePopulation.report()})));
        assert.equal(await ev(() => window.__game.run.campaign.cheat), false);
        await ev(() => { window.__LL.maskGive(1); window.__LL.filterGive(8); }); record('QA equipment fixture', {mask: 1, spareFilters: 8, excludedFromInitialPreviewSave: true});
        await key('KeyQ'); await gameTime(0.8);
        const approach = await ev(() => window.__game.layout.surfaceAccess.approach ?? window.__game.layout.surfaceAccess);
        await key('KeyF');
        await pose(approach, {x: approach.x - Math.sin(approach.yaw) * 5, y: approach.y + 2, z: approach.z - Math.cos(approach.yaw) * 5}); await shot('01-stairwell');
        const base = await ev(() => { const g = window.__game; g.saveSectionMemory(); return {key: {...g.run.current}, memory: structuredClone(g.run.memory()), train: g.playerTrain.participant().save(), transit: g.run.campaign.transit}; });
        await cross('surface');
        await pose({x: 53, y: 0, z: 202}, {x: 65, y: 2, z: 180}); await shot('02-checkpoint-truck');
        const map = await ev(() => window.__game.layout.surface.checkpoint.map);
        await pose({x: map.x, y: 0, z: map.z + 2.3}, {...map, y: map.y + 0.05}); await key('KeyE');
        assert(await ev(() => window.__game.surfaceRuntime.mapOpen)); await shot('03-operations-map'); await key('KeyE');
        const car = await ev(() => ({...window.__game.skywaysCar.body, spec: window.__game.skywaysCar.spec}));
        const local = car.spec.exits.left, c = Math.cos(car.yaw), s = Math.sin(car.yaw);
        await pose({x: car.x + c * local.x + s * local.z, z: car.z - s * local.x + c * local.z, y: car.y}, {x: car.x, y: car.y + 1.8, z: car.z});
        await key('KeyQ'); await gameTime(0.55); await key('KeyE'); assert(await ev(() => window.__game.skywaysCar.driving));
        await ev(() => { const g = window.__game; g.player.yaw = g.skywaysCar.body.yaw; g.player.pitch = 0; }); // labelled camera fixture: forward cab view
        await key('KeyF'); await gameTime(0.3); await shot('04-first-person-cab');
        record('enclosed cab', await ev(() => ({car: window.__game.skywaysCar.state(), headlights: window.__game.skywaysCar.lights,
          cameraFixture: 'facing forward', gas: {...window.__game.gas.exposure}, mask: window.__LL.mask()})));
        assert.equal(await ev(() => window.__game.gas.exposure.dps), 0);
        await page.keyboard.down('KeyW'); await gameTime(0.9); await page.keyboard.down('KeyA'); await gameTime(0.25);
        await page.keyboard.up('KeyA'); await page.keyboard.up('KeyW'); await page.keyboard.down(' '); await gameTime(1); await page.keyboard.up(' ');
        record('normal arcade drive inputs', await ev(() => window.__game.skywaysCar.state()));
        await key('KeyE'); assert(!(await ev(() => window.__game.skywaysCar.driving))); await key('KeyQ'); await gameTime(0.8);
        record('finite storage transfer', await ev(() => { const g = window.__game, st = g.inv.makeStack('pistol', 1, 3); if (g.inv.add(st)) throw new Error('Fixture inventory full');
          const ref = g.inv.find(st.uid), result = g.inv.storeMove(g.surfaceTruck.stores[0].slots, ref, {bar: 'store', index: 0});
          if (result === 'refused' || g.surfaceTruck.stores[0].slots[0]?.uid !== st.uid || g.inv.find(st.uid)) throw new Error('Storage transfer did not conserve fixture UID');
          g.skywaysCar.store(); return {uid: st.uid, result, stored: g.surfaceTruck.stores[0].toJSON()}; }));
        const cargo = await ev(() => window.__game.surfaceTruck.cargo.records.find(r => r.state === 'depot'));
        await pose({x: cargo.x, y: cargo.y, z: cargo.z + 2}, {x: cargo.x, y: cargo.y + 0.35, z: cargo.z}); await shot('05-depot-interior'); await key('KeyE');
        assert.equal(await ev(() => window.__game.surfaceTruck.cargo.carried?.uid), cargo.uid);
        const b = await ev(() => window.__game.skywaysCar.body), rear = car.spec.length / 2 + 1.6;
        await pose({x: b.x + Math.sin(b.yaw) * rear, y: b.y, z: b.z + Math.cos(b.yaw) * rear}, {x: b.x, y: b.y + 1.4, z: b.z}); await key('KeyE');
        assert.equal(await ev(id => window.__game.surfaceTruck.cargo.records.find(r => r.uid === id).state, cargo.uid), 'truck'); await shot('06-secured-cargo');
        const views = await ev(() => { const g = window.__game, info = g.layout.surface;
          return ['store', 'shopping-centre', 'office'].map(kind => { const d = info.destinations.find(x => x.kind === kind), a = g.layout.areas.find(x => x.id === d.areaIds[0]);
            return {kind, destination: d.id, label: d.label, at: {x: (a.x + a.w / 2) * 0.5, y: 0, z: (a.y + a.h / 2) * 0.5}, target: {x: d.entrance.x, y: 1.3, z: d.entrance.z}}; }); });
        for (const v of views) { await pose(v.at, v.target); await gameTime(0.15); await shot(`interior-${v.kind}`); record(`placed inside ${v.kind}`, v); }
        await pose({x: 65, y: 0, z: 154}, {x: 104, y: 5, z: 100}); await shot('core-street');
        record('actual city sectors from core street', await ev(() => window.__game.surfaceRuntime.summary()));
        await pose({x: 7, y: 0, z: 122}, {x: 7, y: 1.6, z: 90}); await shot('outer-street');
        record('outer perimeter road, outside core boundary', await ev(() => ({player: {x: window.__game.player.x, z: window.__game.player.z},
          bounds: window.__game.layout.surface.bounds, core: window.__game.layout.surface.coreBounds, surface: window.__game.surfaceRuntime.summary()})));
        const kills = await ev(() => { const g = window.__game, interior = g.zombies.find(z => z.brain.alive && g.enemyIndex.has(z)), exterior = g.zombies.find(z => z.brain.alive && !g.enemyIndex.has(z));
          const result = {interior: interior ? g.enemyIndex.get(interior) : null, exteriorFound: !!exterior};
          for (const z of [interior, exterior]) if (z?.brain.damage(1e9, g.player.x, g.player.z)) g.blastKill(z, g.camera.position.clone().set(0, 0, 1), z.root.position.clone());
          g.saveSectionMemory(); result.savedKilled = [...g.run.memory().killed]; result.population = g.surfacePopulation.report(); return result; });
        record('scripted interior/exterior death fixtures use normal death bookkeeping', kills);
        assert(kills.exteriorFound); assert(kills.savedKilled.includes(kills.interior)); assert(kills.savedKilled.every(i => i < 10000));
        await cross('main');
        const back = await ev(k => { const g = window.__game; return {memory: g.run.memory(k), train: g.playerTrain.participant().save(), transit: g.run.campaign.transit,
          city: g.surfaceRuntime.summary(), pool: g.surfacePopulation.report()}; }, base.key);
        for (const field of ['pickups', 'holders', 'killed']) assert.deepEqual(back.memory[field], base.memory[field]);
        assert.deepEqual(back.train, base.train); assert.deepEqual(back.transit, base.transit); assert.equal(back.city.city, null); assert.equal(back.pool.capacity, 0); record('underground conservation and culling', back);
        const saved = await ev(() => { const g = window.__game, p = g.trainLocalToWorld({x: 0, z: 0, yaw: 0, pitch: 0, crouched: false});
          g.player.place(p.x, p.z, p.yaw, p.y); g.updateCamera(0); const result = g.saveNow(); if (!result.ok) throw new Error(result.error);
          const file = g.saves.exportFile(3); if (!file.ok) throw new Error(file.error); return file.text; });
        fs.writeFileSync(path.join(out, 'cargo-check-save.json'), saved);
        record('validated train-terminal save', {file: 'cargo-check-save.json', bytes: Buffer.byteLength(saved), interiorKill: kills.interior});
      } else {
        if (!input) throw new Error('restore mode requires the prior cargo-check-save.json');
        const text = fs.readFileSync(input, 'utf8'), expected = JSON.parse(text).run;
        await ev(async value => { const g = window.__game, imported = await g.saves.importFile(3, value, {confirmReplace: true}); if (!imported.ok) throw new Error(imported.error);
          const r = await g.continueCampaign(3); if (!r.ok) throw new Error(r.error); }, text); await play(); await cross('surface');
        const actual = await ev(() => { const g = window.__game; return {record: g.skywaysCar.readRecord(), source: g.skywaysCar.source, cargo: g.surfaceTruck.cargo.save(),
          liveInterior: [...g.enemyIndex.values()], population: g.surfacePopulation.report(), stores: g.surfaceTruck.stores.flatMap(s => s.toJSON().slots)}; });
        const mem = expected.memories[`${expected.campaign.current}:surface`];
        assert.deepEqual(actual.record, mem.lanes['surface.truck']); assert.deepEqual(actual.stores, actual.record.trunk);
        assert.deepEqual(actual.cargo, expected.participants['surface-salvage']); assert.equal(actual.source, 'record');
        for (const dead of mem.killed) assert(!actual.liveInterior.includes(dead)); assert.equal(actual.population.capacity, 12);
        record('fresh browser save/re-entry preserves truck/cargo; interiors stay killed and exterior pool returns', actual); await shot('07-restored-checkpoint');
        const attached = await ev(() => { const g = window.__game, r = g.surfaceTruck.cargo.records.find(r => r.state === 'truck'), b = g.skywaysCar.body,
          m = g.surfaceTruck.root.getObjectByName(`surface-salvage:${r.uid}`), q = m.getWorldPosition(g.camera.position.clone());
          return {uid: r.uid, kind: r.kind, at: {x: b.x + Math.sin(b.yaw) * (g.skywaysCar.spec.length / 2 + 1.2), y: b.y,
            z: b.z + Math.cos(b.yaw) * (g.skywaysCar.spec.length / 2 + 1.2)}, target: {x: q.x, y: q.y + 0.3, z: q.z}}; });
        await pose(attached.at, attached.target); await key('KeyE'); assert.equal(await ev(() => window.__game.surfaceTruck.cargo.carried?.uid), attached.uid);
        await cross('main'); assert.equal(await ev(() => window.__game.surfaceTruck.cargo.carried?.uid), attached.uid);
        const train = await ev(() => window.__game.trainLocalToWorld({x: 0, z: 0, yaw: 0, pitch: 0, crouched: false}));
        await pose(train); const resources = await ev(() => Object.fromEntries(['scrap_metal', 'electrical_parts', 'bio_mater', 'fuel_can'].map(id => [id, window.__game.inv.count(id)]))); await key('KeyE');
        const recovered = await ev(id => { const g = window.__game; return {record: g.surfaceTruck.cargo.records.find(r => r.uid === id),
          resources: Object.fromEntries(['scrap_metal', 'electrical_parts', 'bio_mater', 'fuel_can'].map(id => [id, g.inv.count(id)])), armor: g.trainUpgrades.installed('armor'), carried: g.surfaceTruck.cargo.carried}; }, attached.uid);
        assert.equal(recovered.record.state, 'installed'); assert.equal(recovered.carried, null); assert.deepEqual(recovered.resources, resources);
        record('normal E detach, local crossing and existing train upgrade recovery without crafting debit', recovered);
      }
      record('renderer and graphics evidence', await ev(() => ({gpu: window.__LL.gpu(), lighting: window.__game.enhancedLighting.status(), settings: window.__game.settings,
        surface: window.__game.surfaceRuntime.summary(), errors: window.__game.lastError, assets: window.__LL.levelAssets()})));
      assert.equal(report.errors.length, 0, JSON.stringify(report.errors)); report.outcome = 'passed';
    } finally {clearInterval(guard); await closeBrowser(); if (server) await new Promise(r => server.close(r)); server = null;}
  }, {label: `surface-${mode}-${backend}`, maxMinutes: 35});
} catch (error) { report.outcome = report.outcome === 'running' ? 'failed' : report.outcome; report.failure = String(error?.stack ?? error); process.exitCode = 1; }
finally {clearInterval(guard); await closeBrowser(); if (server) server.close(); report.ended = new Date().toISOString(); fs.writeFileSync(path.join(out, 'run.json'), JSON.stringify(report, null, 2)); console.log('SURFACE_QA', report.outcome, report.failure ?? '');}
