// Task studio-alpha-skyways-shops-20261107-054512-01 (lane STORE-BOOKS): detailed top-down PLANS of Paper Prairie Books (no browser) —
// QA evidence of the store's layout: areas by role, walls, doors (staff orange, storefront cyan), every prop as its rotated footprint
// coloured by what it is (bookcases walnut, the Mall's openable storage green, counters, seating, the rugs, signs as a front tick),
// the reserved walking lanes (thin blue) and a short legend line. Storeys side by side. Loads the generator through Vite's SSR module
// loader (like tools/qa/skyways-store-plans.mjs).
// Usage: node tools/asset-pipeline/skyways-stores/books/plan-books.mjs OUT_DIR [--version 3] [seed ...]   (default: seeds 1..12)
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const args = process.argv.slice(2);
const outDir = args[0] && !args[0].startsWith('--') ? args.shift() : path.join(root, 'qa-artifacts/skyways-store-books');
let version = 3;
const seeds = [];
for (let i = 0; i < args.length; i++) { if (args[i] === '--version') version = Number(args[++i]); else seeds.push(Number(args[i])); }
if (!seeds.length) for (let s = 1; s <= 12; s++) seeds.push(s);
fs.mkdirSync(outDir, {recursive: true});

const PPM = 26; // pixels per metre
const ROLE = {floor: '#d9c7a6', upper: '#9fb39a', stock: '#a39a8c'};
const KIND = {
  skyDBookcase: '#6b3f22', bookstoreBookcase: '#3f9a52', mallCashwrapCounter: '#2f9a6a', glassDisplayCabinet: '#3faab0', dresserDrawers: '#46a35a',
  shopCounter: '#b0763a', cashRegister: '#222222', skyDBookTable: '#a8743e', skyDWingbackChair: '#557a3f', cafeBistroTable: '#cfcfcf', skyDArcLamp: '#e0c040',
  skyBooksRug: '#b04848', skyBooksSign: '#ffd75a', skyDBookStack: '#e8e0d0', beanBag: '#e07a3a', giantTeddy: '#b0702a', desk: '#5d6f80', officeChair: '#333a44',
  planterTree: '#3c8a3c', pottedPlantSmall: '#3c8a3c', stepLadder: '#999999', skyDPoster: '#ff66cc', cardboardBoxFlaps: '#c49a5a', cabinetTall: '#4a8a9a',
  filingCabinet: '#4a7a9a', cabinetLow: '#4a8a9a', stockShelf: '#8a8a8a', shelf: '#8a8a8a',
};

const server = await createServer({root: path.join(root, 'game'), configFile: false, logLevel: 'error', server: {middlewareMode: true, hmr: false}, appType: 'custom', optimizeDeps: {noDiscovery: true, include: []}});
try {
  const {LEVELS} = await server.ssrLoadModule('/src/levels/registry.ts');
  const {booksStoreDressOf} = await server.ssrLoadModule('/src/gen/skyways/stores/booksDress.ts');
  const out = [];
  for (const seed of seeds) {
    const L = LEVELS.skyways.generate('main', {levelSeed: seed, startWeapon: 'pistol', layoutVersion: version});
    const an = (L.skyways?.anchors ?? []).find(a => a.family === 'books');
    if (!an) continue;
    const res = booksStoreDressOf(L).find(r => r.anchor === an.id);
    const zones = new Set(an.zones), role = new Map([[an.floor, 'floor']]);
    for (const a of L.areas) if (a.parent === an.floor && a.type === 'shop' && !zones.has(a.id)) role.set(a.id, 'floor');
    if (an.upper !== undefined) { role.set(an.upper, 'upper'); for (const a of L.areas) if (a.parent === an.upper) role.set(a.id, 'upper'); }
    for (const s of an.stock) role.set(s, 'stock');
    const areas = [...role.keys()].map(i => L.areas[i]);
    const levels = [...new Set(areas.map(a => a.level ?? 0))].sort((p, q) => (p === an.level ? -1 : q === an.level ? 1 : p - q));
    const CELL = 0.5, x0 = (Math.min(...areas.map(a => a.x)) - 2) * CELL, z0 = (Math.min(...areas.map(a => a.y)) - 2) * CELL;
    const x1 = (Math.max(...areas.map(a => a.x + a.w)) + 2) * CELL, z1 = (Math.max(...areas.map(a => a.y + a.h)) + 2) * CELL;
    const pw = (x1 - x0) * PPM, ph = (z1 - z0) * PPM, gap = 30, W = Math.ceil(pw * levels.length + gap * (levels.length - 1)), H = Math.ceil(ph + 40);
    const parts = [`<rect width="${W}" height="${H}" fill="#151515"/>`];
    levels.forEach((lv, li) => {
      const ox = li * (pw + gap), X = x => ox + (x - x0) * PPM, Z = z => 40 + (z - z0) * PPM;
      const g = L.levels[lv].grid;
      for (let cy = Math.floor(z0 / CELL); cy < z1 / CELL; cy++) for (let cx = Math.floor(x0 / CELL); cx < x1 / CELL; cx++) {
        if (!g.inBounds(cx, cy)) continue;
        const i = g.idx(cx, cy);
        if (g.cells[i] === 0) continue;
        const r = role.get(g.area[i]);
        parts.push(`<rect x="${X(cx * CELL).toFixed(1)}" y="${Z(cy * CELL).toFixed(1)}" width="${(CELL * PPM).toFixed(1)}" height="${(CELL * PPM).toFixed(1)}" fill="${r ? ROLE[r] : '#3a3c40'}"/>`);
      }
      for (const d of L.doors) {
        if ((d.level ?? 0) !== lv || !(role.has(d.a) || role.has(d.b))) continue;
        const c = d.shopfront ? '#3cc8e6' : d.staff ? '#f08c1e' : '#e6e65a';
        parts.push(`<rect x="${X(d.x * CELL)}" y="${Z(d.y * CELL)}" width="${d.w * CELL * PPM}" height="${d.h * CELL * PPM}" fill="${c}" opacity="0.8"/>`);
      }
      const props = L.props.filter(p => role.has(p.area) && (p.level ?? 0) === lv);
      const order = k => (k === 'skyBooksRug' ? 0 : k === 'skyBooksSign' ? 3 : k === 'skyDBookStack' || k === 'cashRegister' ? 2 : 1);
      for (const p of props.sort((a, b) => order(a.kind) - order(b.kind))) {
        const c = KIND[p.kind] ?? '#bbbbbb', isSign = p.kind === 'skyBooksSign';
        // rotated footprint from the prop's own w / d (round: a circle)
        const rot = p.rot, cs = Math.cos(rot), sn = Math.sin(rot);
        const w = Math.max(p.hx, p.hz) * 2, d = Math.min(p.hx, p.hz) * 2;
        let lw = 0, ld = 0;
        // the unrotated half sizes: swap when the yaw is a quarter turn
        const q = Math.abs(sn) > 0.7;
        lw = (q ? p.hz : p.hx); ld = (q ? p.hx : p.hz);
        if (p.round) { parts.push(`<circle cx="${X(p.x)}" cy="${Z(p.z)}" r="${p.hx * PPM}" fill="${c}" stroke="#111" stroke-width="1"/>`); continue; }
        const pts = [[-lw, -ld], [lw, -ld], [lw, ld], [-lw, ld]].map(([lx, lz]) => [p.x + lx * cs + lz * sn, p.z - lx * sn + lz * cs]);
        parts.push(`<polygon points="${pts.map(([x, z]) => `${X(x).toFixed(1)},${Z(z).toFixed(1)}`).join(' ')}" fill="${c}" fill-opacity="${p.kind === 'skyBooksRug' ? 0.55 : 0.95}" stroke="#111" stroke-width="${isSign ? 0 : 1}"/>`);
        // the front (+Z) tick
        const fx = p.x + sn * (ld + (isSign ? 0.25 : 0.12)), fz = p.z + cs * (ld + (isSign ? 0.25 : 0.12));
        if (p.kind !== 'skyBooksRug' && p.kind !== 'skyDBookStack') parts.push(`<line x1="${X(p.x)}" y1="${Z(p.z)}" x2="${X(fx)}" y2="${Z(fz)}" stroke="${isSign ? '#ffd75a' : '#111'}" stroke-width="${isSign ? 3 : 1.5}"/>`);
        void w; void d;
      }
      for (const l of res?.lanes ?? []) {
        if (l.level !== lv) continue;
        parts.push(`<polyline points="${l.pts.map(([x, z]) => `${X(x).toFixed(1)},${Z(z).toFixed(1)}`).join(' ')}" fill="none" stroke="#3060ff" stroke-width="2" stroke-dasharray="6 4" opacity="0.7"/>`);
      }
      parts.push(`<text x="${ox + 6}" y="18" fill="#eee" font-family="sans-serif" font-size="14">seed ${seed} · ${an.format} · storey ${lv}${lv === an.level ? ' (entrance)' : ''}</text>`);
    });
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${parts.join('')}</svg>`;
    const file = path.join(outDir, `books-v${version}-seed${seed}.png`);
    await sharp(Buffer.from(svg)).png().toFile(file);
    const kinds = {};
    for (const p of L.props) if (role.has(p.area)) kinds[p.kind] = (kinds[p.kind] ?? 0) + 1;
    out.push({seed, format: an.format, file: path.basename(file), skipped: res?.skipped ?? [], bays: res?.bays.length, runs: res?.runs.length, signs: res?.signs.length,
      cash: res && {wrap: res.cash.wrap !== null, counters: res.cash.counters.length, drawers: res.cash.drawers !== null}, kids: !!res?.kids, rare: res?.rare && {cabinets: res.rare.cabinets.length, desk: res.rare.desk !== null},
      nooks: res?.nooks.length, back: res?.back.map(b => ({area: b.area, type: L.areas[b.area].type, added: b.added.map(i => L.props[i]?.kind)})), kinds});
  }
  fs.writeFileSync(path.join(outDir, `books-v${version}-summary.json`), JSON.stringify(out, null, 1));
  console.log(`${out.length} plans -> ${outDir}`);
} finally {
  await server.close();
}
