// Task studio-alpha-campaign-foundation-20261102-230708-01 (primary): ONE short, serial, low-footprint browser spot check of the
// campaign loop (root CLAUDE.md browser policy; lock / watchdog / cleanup from browser-env.mjs; the 6 GiB anon + shmem guard closes the
// owned browser, plus an earlier self-stop at STOP_GIB). llvmpipe / WebGL2: functional evidence only, not GPU performance.
//   1. the site load shows the MAIN MENU (no level built); 2. New game into slot 1 (a fresh network; the start station built, the
//   player inside the train); 3. the slot holds a valid save; 4. the console's map opens (state 'map', current + one hop revealed) and
//   closes; 5. a journey to a neighbour (depart -> transit -> build -> arrive), the arrival recorded + autosaved; 6. a page reload ->
//   the menu -> Continue -> the arrived station restored. On software GL the arrival drive outgrows the guard (a whole new platform view):
//   the page is closed during the arrival like a crash mid-journey, and step 6 instead proves the departure save's once-only resume.
//   npm run build && node tools/qa/campaign-loop-check.mjs [--no-journey] [outDir]   (--no-journey: steps 1-4 + 6, for software GL under the guard)
import fs from 'node:fs';
import path from 'node:path';
import {launchBrowser, withBrowserLock} from './browser-env.mjs';
import {serveStatic} from './static-server.mjs';

const ARGS = process.argv.slice(2), NO_JOURNEY = ARGS.includes('--no-journey');
const out = path.resolve(ARGS.find(a => !a.startsWith('--')) ?? 'qa-artifacts/campaign-loop-browser');
const STOP_GIB = 5.75, ARRIVAL_STOP_GIB = 5.5;
let crashed = false;
fs.mkdirSync(out, {recursive: true});
const sleep = ms => new Promise(r => setTimeout(r, ms));
const anon = () => { try { const s = fs.readFileSync('/sys/fs/cgroup/memory.stat', 'utf8'); const g = k => Number(new RegExp(`^${k} (\\d+)$`, 'm').exec(s)?.[1] ?? 0); return g('anon') + g('shmem'); } catch { return 0; } };
const gib = () => +(anon() / 1024 ** 3).toFixed(2);
const report = {started: new Date().toISOString(), steps: [], consoleErrors: [], peakGiB: 0, guard: false, stoppedAt: null};
const step = (name, data = {}) => { report.steps.push({name, gib: gib(), t: new Date().toISOString(), ...data}); console.log(name, `${gib()} GiB`, JSON.stringify(data).slice(0, 700)); };
const headroom = name => { if (gib() >= STOP_GIB) { report.stoppedAt = name; step(`self-stop before ${name}`, {stopGib: STOP_GIB}); return false; } return true; };

await withBrowserLock(async () => {
  const {server, port} = await serveStatic(path.resolve('dist/game'), {prefix: '/'});
  let browser = null;
  const guard = setInterval(() => { const b = anon(); report.peakGiB = Math.max(report.peakGiB, b / 1024 ** 3); if (b > 6 * 1024 ** 3 && !report.guard) { report.guard = true; console.error('memory guard: closing the owned browser'); void browser?.close(); } }, 1000);
  const url = `http://127.0.0.1:${port}/index.html?qa=1&qaPrebuild=0&menuScene=0&quality=low&warmup=off`;
  try {
    step('before launch');
    browser = await launchBrowser({protocolTimeout: 300000});
    const page = await browser.newPage();
    page.on('console', m => { if (m.type() === 'error' && report.consoleErrors.length < 30) report.consoleErrors.push(m.text().slice(0, 300)); if (/^(Terminal State|campaign|QA mark)/.test(m.text())) step(`console: ${m.text().slice(0, 160)}`); });
    page.on('pageerror', e => { if (report.consoleErrors.length < 30) report.consoleErrors.push(`pageerror: ${String(e).slice(0, 300)}`); });
    await page.setViewport({width: 640, height: 360});
    const pageRef = {page};
    const ev = (fn, ...a) => pageRef.page.evaluate(fn, ...a);
    const waitFor = async (fn, capS, ...a) => { const r0 = Date.now(); while (Date.now() - r0 < capS * 1000) { if (await ev(fn, ...a).catch(() => false)) return true; await sleep(1000); } return false; };
    await page.goto(url);
    const menu = await waitFor(() => window.__game && window.__game.state === 'title', 120);
    step('1 menu on load', {menu, world: await ev(() => !!window.__game?.world), menuVisible: await ev(() => !document.querySelector('#mm-view')?.classList.contains('hidden'))});
    // wait until the game files are loaded (the menu's New game is enabled)
    const booted = await waitFor(() => !!window.__game?.pickups, 240);
    step('game files', {booted});
    await ev(() => { try { localStorage.removeItem('terminal-state.save.slot1.v1'); } catch {} });
    if (!headroom('new game')) return;
    const ng = await ev(() => window.__game.newCampaign(1, {overwrite: true, networkSeed: 1}).then(r => r, e => ({ok: false, error: String(e)})));
    const playing = await waitFor(() => window.__game.state === 'playing', 240);
    const c0 = await ev(() => { const g = window.__game, c = g.run.campaign; return {current: c?.current, known: c?.known.length, archetype: g.run.current.level, station: g.run.current.station, nodes: c?.network.nodes.length, inTrain: g.trainRuntime.playerInside?.() ?? null, slot: g.currentSlot}; });
    step('2 new game', {ng, playing, ...c0});
    step('2b renderer', await ev(() => { const i = window.__game.renderer.info; return {geometries: i.memory?.geometries, textures: i.memory?.textures, calls: i.render?.calls}; }));
    const slots = await ev(() => window.__game.saves.list().map(v => ({slot: v.slot, valid: v.valid, reason: v.meta?.reason, station: v.meta?.station, chars: v.chars})));
    step('3 slot written', {slots});
    const mapOpen = await ev(() => { const g = window.__game; const ok = g.openTravelMap(); return {ok, state: g.state, known: g.run.campaign.known.length, svg: document.querySelectorAll('svg circle').length}; });
    step('4 map open', mapOpen);
    await ev(() => window.dispatchEvent(new KeyboardEvent('keydown', {code: 'Escape', key: 'Escape', bubbles: true})));
    await sleep(800);
    step('4b map closed', {state: await ev(() => window.__game.state)});
    let c1 = await ev(() => ({current: window.__game.run.campaign.current}));
    if (!NO_JOURNEY) {
    if (!headroom('journey')) return;
    const to = await ev(() => { const c = window.__game.run.campaign, net = c.network; const e = net.edges.find(([a, b]) => a === c.current || b === c.current); return e ? (e[0] === c.current ? e[1] : e[0]) : null; });
    // QA marks (this page only): the journey's stages logged as they start / end (the memory timeline is read against them)
    await ev(() => { const g = window.__game; for (const m of ['leaveSection', 'flushRetired', 'commitSave', 'prepareSection', 'buildSection', 'backgroundCompile']) { const f = g[m]; g[m] = function (...a) { const info = () => { const i = g.renderer.info; return `geo ${i.memory?.geometries} tex ${i.memory?.textures} calls ${i.render?.calls}`; }; console.info(`QA mark ${m} start · ${info()}`); const r = f.apply(this, a); if (r && typeof r.then === 'function') return r.finally(() => console.info(`QA mark ${m} end · ${info()}`)); console.info(`QA mark ${m} end · ${info()}`); return r; }; } });
    const t0 = Date.now();
    const jr = ev(t => window.__game.travelToStation(t).then(r => r, e => ({ok: false, error: String(e)})), to);
    jr.catch(() => {}); // the guard may close the page mid-journey
    let phase = null, gapSeen = false;
    const shots = {};
    for (let i = 0; i < 180; i++) {
      const st = await ev(() => ({phase: window.__game.trainRide.state().phase, gap: window.__game.transitGap, state: window.__game.state})).catch(() => null);
      if (st) { phase = st.phase; gapSeen ||= st.gap; }
      if (report.guard) break;
      if (i % 10 === 0 || (st && st.phase !== 'departing') || !st) step('journey tick', {i, ...st});
      if (st?.gap && !shots.transit && gib() < 5.2) { shots.transit = true; await page.screenshot({path: path.join(out, 'transit.png')}); step('screenshot transit (internal)'); }
      if (st?.phase === 'arriving' && !shots.arriving && gib() < 5.6) { shots.arriving = true; await page.screenshot({path: path.join(out, 'arriving.png')}); step('screenshot arriving (internal)'); }
      // software GL: the arrival drive renders a whole new platform view (the known llvmpipe walk-headroom limit). The departure autosave
      // already holds the pending journey, so the page closes here like a crash in the tunnel and step 6 proves the once-only resume.
      if (st?.phase === 'arriving' && gib() >= ARRIVAL_STOP_GIB) { crashed = true; step('journey: page closed during the arrival (software-GL memory) = a crash mid-journey', {stopGib: ARRIVAL_STOP_GIB}); break; }
      if (st && st.phase === 'idle' && i > 5) break;
      await sleep(1000);
    }
    if (crashed) {
      const s0 = await ev(() => window.__game.saves.list().find(v => v.slot === 1)?.meta ?? null).catch(() => null);
      c1 = {current: to, departureSave: s0 && {reason: s0.reason, station: s0.station}};
      step('5 journey (to the arrival; then closed)', {to, seconds: (Date.now() - t0) / 1000, gapSeen, lastPhase: phase, ...c1});
    } else {
    const result = await Promise.race([jr, sleep(60000).then(() => ({timeout: true}))]);
    c1 = await ev(() => { const g = window.__game, c = g.run.campaign; return {current: c.current, visited: c.visited, transit: c.transit, station: g.run.current.station, archetype: g.run.current.level, state: g.state, inTrain: g.trainRuntime.playerInside?.() ?? null}; });
    const s1 = await ev(() => window.__game.saves.list().find(v => v.slot === 1)?.meta ?? null);
    step('5 journey', {to, seconds: (Date.now() - t0) / 1000, result, gapSeen, lastPhase: phase, ...c1, save: s1 && {reason: s1.reason, station: s1.station, visited: s1.stationsVisited}});
    if (headroom('screenshot')) { await page.screenshot({path: path.join(out, 'arrived.png')}); step('screenshot arrived (internal)'); }
    }
    }
    if (!crashed && !headroom('reload')) return;
    // a FRESH page for the reload (the old page's memory goes first; a same-tab reload kept both on software GL)
    await page.close();
    await sleep(3000);
    for (let i = 0; i < 90 && gib() > 2.6; i++) await sleep(1000); // the closed page's memory is returned before the next page boots
    step('old page released');
    const page2 = await browser.newPage();
    page2.on('console', m => { if (m.type() === 'error' && report.consoleErrors.length < 30) report.consoleErrors.push(m.text().slice(0, 300)); });
    page2.on('pageerror', e => { if (report.consoleErrors.length < 30) report.consoleErrors.push(`pageerror: ${String(e).slice(0, 300)}`); });
    await page2.setViewport({width: 640, height: 360});
    pageRef.page = page2;
    await page2.goto(url);
    await waitFor(() => window.__game && window.__game.state === 'title', 120);
    await waitFor(() => !!window.__game?.pickups, 240);
    const cont = await ev(() => window.__game.continueCampaign().then(r => r, e => ({ok: false, error: String(e)})));
    await waitFor(() => window.__game.state === 'playing', 240);
    const c2 = await ev(() => { const g = window.__game, c = g.run.campaign; return {current: c?.current, transit: c?.transit ?? null, visited: c?.visited.length, station: g.run.current.station, inTrain: g.trainRuntime.playerInside?.() ?? null}; });
    const s2 = await ev(() => window.__game.saves.list().find(v => v.slot === 1)?.meta ?? null);
    step('6 reload + continue', {cont, ...c2, matches: c2.current === c1.current, resumedJourney: crashed, save: s2 && {reason: s2.reason, station: s2.station, visited: s2.stationsVisited}});
  } catch (e) {
    step('error', {message: String(e?.message ?? e).slice(0, 400)});
  } finally {
    clearInterval(guard);
    await browser?.close().catch(() => {});
    server.close();
    report.finished = new Date().toISOString();
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 1));
    console.log('peak anon+shmem GiB', report.peakGiB.toFixed(2), 'guard', report.guard, 'self-stop', report.stoppedAt, 'console errors', report.consoleErrors.length);
  }
});
