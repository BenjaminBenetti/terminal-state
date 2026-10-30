// HUD layout bounds check (task gasmask-hud-fix-20261030) — a cheap, isolated browser check: NO game world, NO WebGL. It loads
// the BUILT stylesheet + the built index.html's #hud markup, fills the vitals / weapon panel / light panel with representative
// text and the hotbar with cells shaped like ui/hud.ts builds them (Q, 1-5, 6, G; optionally a 9th "melee" cell), then measures
// real layout boxes at 960x540 and 1280x720: no hotbar cell may overlap the vitals, the weapon panel or the light panel, every
// cell stays on screen and readable. One serial session under the workspace browser lock (browser-env.mjs).
//
//   npm run build && node tools/qa/hud-layout-check.mjs [outDir]
import fs from 'node:fs';
import path from 'node:path';
import {launchBrowser, withBrowserLock} from './browser-env.mjs';
import {serveStatic} from './static-server.mjs';

const out = path.resolve(process.argv[2] ?? 'qa-artifacts/hud-layout');
fs.mkdirSync(out, {recursive: true});
const dist = path.resolve('dist/game');
const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
const head = html.slice(html.indexOf('<head>') + 6, html.indexOf('</head>')).replace(/<script[\s\S]*?<\/script>/g, '').replace(/<link rel="modulepreload"[^>]*>/g, '').replace(/ crossorigin(="[^"]*")?/g, ''); // a null-origin setContent page cannot fetch CORS-mode links from the QA server
const hud = /<div id="hud"[\s\S]*?(?=\n\s*<div id="title"|\n\s*<section id="title"|\n\s*<div class="screen)/.exec(html)?.[0];
if (!hud) throw new Error('could not find #hud in dist/game/index.html');
// the gear lane's runtime-injected CSS (ui/gearStyles.ts ensureGearStyles: bag / grenade cell margins, ghosts), read from source
const gearCss = /const CSS = `([\s\S]*?)`;/.exec(fs.readFileSync(path.resolve('game/src/ui/gearStyles.ts'), 'utf8'))?.[1] ?? '';
const VIEWS = [[960, 540], [1280, 720]];
const MIN_CELL = 36;

const ICON = '<svg viewBox="0 0 64 32" aria-hidden="true"><rect x="6" y="8" width="52" height="16" rx="3" fill="currentColor"/></svg>';
const IMG = '<img class="ico3d" alt="" src="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2278%22 height=%2238%22/%3E">';
function cells(melee) {
  const q = `<div class="slot maskslot on" data-bar="gear" data-index="5"><span class="key">Q</span><span class="count">+2</span>${IMG}<span class="nm">ON</span><span class="fb"><i style="width:60%"></i></span></div>`;
  const names = ['Pistol', 'Knife', '', 'Rifle', 'Bandage'];
  const quick = names.map((n, i) => `<div class="slot${i === 0 ? ' selected' : ''}" data-bar="hotbar" data-index="${i}"><span class="key">${i + 1}</span>${n ? (i % 2 ? ICON : IMG) : ''}<span class="nm">${n}</span>${n === 'Pistol' ? '<span class="count">15</span>' : ''}</div>`).join('');
  const meleeCell = melee ? `<div class="slot meleeslot" data-bar="melee" data-index="0"><span class="key">V</span>${ICON}<span class="nm">Knife</span></div>` : '';
  const bag = `<div class="slot bagslot vacant" data-bar="gear" data-index="4"><span class="key">6</span><span class="ghost">${ICON}</span><span class="nm">no bag</span></div>`;
  const thr = `<div class="slot throwslot" data-bar="throw" data-index="0"><span class="key">G</span>${IMG}<span class="nm">Flare</span><span class="count">3</span></div>`;
  return q + quick + meleeCell + bag + thr;
}

const report = {started: new Date().toISOString(), cases: []};
await withBrowserLock(async () => {
  const {server, port} = await serveStatic(dist, {prefix: '/'});
  try {
    const browser = await launchBrowser();
    const page = await browser.newPage();
    for (const [w, h] of VIEWS) for (const melee of [false, true]) {
      await page.setViewport({width: w, height: h});
      await page.setContent(`<!doctype html><html><head><base href="http://127.0.0.1:${port}/">${head}<style>${gearCss}</style></head><body><div id="app"><div class="hud-bg" style="position:absolute;inset:0;background:#2a2f2b"></div>${hud}</div></body></html>`, {waitUntil: 'load'});
      const res = await page.evaluate((cellsHtml, minCell) => {
        const $ = s => document.querySelector(s);
        $('#hud').classList.remove('hidden');
        $('#hotbar').innerHTML = cellsHtml;
        const set = (s, t) => { const e = $(s); if (e) e.textContent = t; };
        set('#weapon-name', 'Pistol · 9mm'); set('#mag', '15'); set('#reserve', '45'); set('#weapon-hint', 'R reloads · 3 spare magazines');
        for (const e of document.querySelectorAll('#vitals .val, #vitals .num, #vitals output, #vitals [id$="-val"]')) e.textContent = e.textContent || '80%';
        const r = e => { const b = e.getBoundingClientRect(); return {l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height}; };
        const hit = (a, b) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
        const panels = {vitals: $('#vitals'), weapon: $('#weapon-panel'), light: $('#light-panel')};
        const P = Object.fromEntries(Object.entries(panels).filter(([, e]) => e).map(([k, e]) => [k, r(e)]));
        // the vitals' real content edge (rows / values), not just the box
        const vit = [...document.querySelectorAll('#vitals *')].map(r).filter(b => b.w > 0 && b.h > 0);
        P.vitalsContent = vit.length ? {l: Math.min(...vit.map(b => b.l)), t: Math.min(...vit.map(b => b.t)), r: Math.max(...vit.map(b => b.r)), b: Math.max(...vit.map(b => b.b))} : P.vitals;
        const cs = [...document.querySelectorAll('#hotbar .slot')].map(e => ({cls: e.className, ...r(e)}));
        const overlaps = [];
        for (const c of cs) for (const [k, p] of Object.entries(P)) if (hit(c, p)) overlaps.push(`${c.cls} x ${k}`);
        const W = innerWidth, H = innerHeight;
        const off = cs.filter(c => c.l < 0 || c.r > W || c.t < 0 || c.b > H).map(c => c.cls);
        const bar = r($('#hotbar')), barContent = {l: Math.min(...cs.map(c => c.l)), r: Math.max(...cs.map(c => c.r))};
        return {cells: cs.length, minCellW: Math.min(...cs.map(c => c.w)), cellW: cs.map(c => Math.round(c.w)), overlaps, offscreen: off, small: cs.filter(c => c.w < minCell).map(c => c.cls),
          barCentreOffset: Math.round((barContent.l + barContent.r) / 2 - W / 2), bar, barContent, panels: P};
      }, cells(melee), MIN_CELL);
      const name = `${w}x${h}-${melee ? 9 : 8}cells`;
      await page.screenshot({path: path.join(out, `${name}.png`), clip: {x: 0, y: Math.max(0, h - 200), width: w, height: Math.min(200, h)}});
      const ok = res.overlaps.length === 0 && res.offscreen.length === 0 && res.small.length === 0;
      report.cases.push({name, ok, ...res});
      console.log(name, ok ? 'OK' : 'FAIL', JSON.stringify({minCellW: Math.round(res.minCellW), cellW: res.cellW, centreOffset: res.barCentreOffset, overlaps: res.overlaps, offscreen: res.offscreen, small: res.small}));
    }
  } finally {
    server.close();
    report.finished = new Date().toISOString();
    report.ok = report.cases.length > 0 && report.cases.every(c => c.ok);
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  }
}, {maxMinutes: 5, label: 'hud-layout-check'});
if (!report.ok) process.exitCode = 1;
