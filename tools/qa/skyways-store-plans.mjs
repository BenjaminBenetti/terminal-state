// Task studio-alpha-skyways-shops-20261107-054512-01 (primary): top-down PLANS of the Skyways major stores (no browser). Loads the
// generator through Vite's SSR module loader (like station-maps.mjs) and rasterises one store per PNG: its areas (sales floor / upper /
// zones / back rooms), doors (staff doors orange, the storefront cyan), every prop footprint coloured by its openables class (openable
// green, existing holder teal, static grey, decor / none light) and loose pickups (white). Upper storeys are drawn side by side.
// Usage: node tools/qa/skyways-store-plans.mjs OUT_DIR [--version 3] [--family books] [seed ...]   (default seeds 1..6)
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const outDir = args[0] && !args[0].startsWith('--') ? args.shift() : path.join(root, 'qa-artifacts/skyways-store-plans');
let version = 3, family = null;
const seeds = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--version') version = Number(args[++i]);
  else if (args[i] === '--family') family = args[++i];
  else seeds.push(Number(args[i]));
}
if (!seeds.length) seeds.push(1, 2, 3, 4, 5, 6);
fs.mkdirSync(outDir, {recursive: true});

const ROLE = {floor: [196, 178, 150], upper: [176, 186, 160], zones: [170, 160, 196], stock: [150, 140, 130], other: [60, 62, 66]};
const CLS = {openable: [40, 170, 70], existing: [30, 150, 150], exception: [150, 150, 150], none: [205, 200, 190], other: [120, 120, 130]};

const server = await createServer({root: path.join(root, 'game'), configFile: false, logLevel: 'error', server: {middlewareMode: true, hmr: false}, appType: 'custom', optimizeDeps: {noDiscovery: true, include: []}});
try {
  const {LEVELS} = await server.ssrLoadModule('/src/levels/registry.ts');
  const {OPENABLE_AUDIT} = await server.ssrLoadModule('/src/world/openablesSpec.ts');
  const audit = new Map(OPENABLE_AUDIT.map(e => [e.kind, e.cls]));
  const summary = [];
  for (const seed of seeds) {
    const L = LEVELS.skyways.generate('main', {levelSeed: seed, startWeapon: 'pistol', layoutVersion: version});
    for (const an of L.skyways?.anchors ?? []) {
      if (family && an.family !== family) continue;
      const zones = new Set(an.zones);
      const role = new Map([[an.floor, 'floor']]);
      for (const a of L.areas) if (a.parent === an.floor && a.type === 'shop' && !zones.has(a.id)) role.set(a.id, 'floor');
      if (an.upper !== undefined) { role.set(an.upper, 'upper'); for (const a of L.areas) if (a.parent === an.upper) role.set(a.id, 'upper'); }
      for (const z of an.zones) role.set(z, 'zones');
      for (const s of an.stock) role.set(s, 'stock');
      const ids = [...role.keys()], areas = ids.map(i => L.areas[i]);
      const levels = [...new Set(areas.map(a => a.level ?? 0))].sort();
      const x0 = Math.min(...areas.map(a => a.x)) - 3, y0 = Math.min(...areas.map(a => a.y)) - 3;
      const x1 = Math.max(...areas.map(a => a.x + a.w)) + 3, y1 = Math.max(...areas.map(a => a.y + a.h)) + 3;
      const S = 8, cw = x1 - x0, ch = y1 - y0, W = cw * S * levels.length + (levels.length - 1) * 16, H = ch * S;
      const px = Buffer.alloc(W * H * 3, 18);
      const put = (ox, x, y, c) => { if (x < 0 || y < 0 || x >= cw * S || y >= H) return; const i = (y * W + ox + x) * 3; px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; };
      const fill = (ox, cx, cy, c) => { for (let dy = 0; dy < S; dy++) for (let dx = 0; dx < S; dx++) put(ox, (cx - x0) * S + dx, (cy - y0) * S + dy, c); };
      const box = (ox, wx0, wz0, wx1, wz1, c, g) => {
        // world metres -> plan pixels (the grid's cell centres: g.center)
        const [ax, az] = g.center(x0, y0), cell = g.cellSize ?? 0.5;
        const p0x = Math.round(((wx0 - ax) / cell + 0.5) * S), p0y = Math.round(((wz0 - az) / cell + 0.5) * S);
        const p1x = Math.round(((wx1 - ax) / cell + 0.5) * S), p1y = Math.round(((wz1 - az) / cell + 0.5) * S);
        for (let y = Math.min(p0y, p1y); y <= Math.max(p0y, p1y); y++) for (let x = Math.min(p0x, p1x); x <= Math.max(p0x, p1x); x++) {
          const edge = y === Math.min(p0y, p1y) || y === Math.max(p0y, p1y) || x === Math.min(p0x, p1x) || x === Math.max(p0x, p1x);
          put(ox, x, y, edge ? [20, 20, 20] : c);
        }
      };
      const counts = {openable: 0, existing: 0, exception: 0, none: 0, other: 0, props: 0, pickups: 0};
      levels.forEach((lv, li) => {
        const ox = li * (cw * S + 16), g = L.levels[lv].grid;
        for (let cy = y0; cy < y1; cy++) for (let cx = x0; cx < x1; cx++) {
          if (cx < 0 || cy < 0 || cx >= g.w || cy >= g.h) continue;
          const i = g.idx(cx, cy);
          if (g.cells[i] === 0) continue;
          const r = role.get(g.area[i]);
          fill(ox, cx, cy, r ? ROLE[r] : ROLE.other);
        }
        for (const d of L.doors) {
          if ((d.level ?? 0) !== lv || !(role.has(d.a) || role.has(d.b))) continue;
          const c = d.shopfront ? [60, 200, 230] : d.staff ? [240, 140, 30] : [230, 230, 90];
          for (let cy = d.y; cy < d.y + d.h; cy++) for (let cx = d.x; cx < d.x + d.w; cx++) fill(ox, cx, cy, c);
        }
        for (const p of L.props) {
          if (!role.has(p.area) || (p.level ?? L.areas[p.area].level ?? 0) !== lv) continue;
          const cls = audit.get(p.kind) ?? 'other';
          counts[cls] = (counts[cls] ?? 0) + 1; counts.props++;
          box(ox, p.x - p.hx, p.z - p.hz, p.x + p.hx, p.z + p.hz, CLS[cls] ?? CLS.other, g);
        }
        for (const p of L.pickups) {
          if (!role.has(p.area) || (p.level ?? 0) !== lv) continue;
          counts.pickups++;
          box(ox, p.x - 0.12, p.z - 0.12, p.x + 0.12, p.z + 0.12, [250, 250, 250], g);
        }
      });
      const file = path.join(outDir, `v${version}-seed${seed}-${an.family}.png`);
      await sharp(px, {raw: {width: W, height: H, channels: 3}}).png().toFile(file);
      const kinds = {};
      for (const p of L.props) if (role.has(p.area)) kinds[p.kind] = (kinds[p.kind] ?? 0) + 1;
      summary.push({seed, family: an.family, format: an.format, file: path.basename(file), areas: Object.fromEntries([...role].map(([id, r]) => [id, `${r}:${L.areas[id].type}:${L.areas[id].purpose ?? ''}`])), counts, kinds});
    }
  }
  fs.writeFileSync(path.join(outDir, `summary-v${version}.json`), JSON.stringify(summary, null, 1));
  console.log(`${summary.length} store plans -> ${outDir}`);
} finally {
  await server.close();
}
