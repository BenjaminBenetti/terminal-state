// Task studio-alpha-skyways-shops-20261107-054512-01 (lane STORE-DESIGN): top-down PLANS of the Larch & Loom Home store (no browser),
// after the primary's tools/qa/skyways-store-plans.mjs — but coloured for this store's review: the rugs in their colourway under
// everything, the openable storage green (holders teal, open holders blue), the vignette furniture warm, the folded textiles pink,
// the lamps yellow, the back rooms; the walking lanes the dresser reserved as thin cyan lines. One PNG per design store and seed.
// Usage: node tools/asset-pipeline/skyways-stores/design/plan.mjs OUT_DIR [seed ...]   (default: the first 4 two-level + 4 hall seeds)
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const args = process.argv.slice(2);
const outDir = args[0] && !args[0].startsWith('--') ? args.shift() : path.join(root, 'qa-artifacts/skyways-store-design');
const seeds = args.map(Number).filter(Number.isFinite);
fs.mkdirSync(outDir, {recursive: true});

const ROLE = {floor: [205, 186, 150], upper: [190, 196, 172], zones: [170, 160, 196], stock: [140, 132, 122], other: [52, 54, 58]};
const OPEN = {openable: [40, 170, 70], existing: [30, 150, 150], open: [70, 120, 200], exception: [150, 150, 150]};
const WARM = [150, 92, 60], TEXTILE = [230, 120, 170], LAMP = [240, 210, 60], DECOR = [225, 220, 205];

const server = await createServer({root: path.join(root, 'game'), configFile: false, logLevel: 'error', server: {middlewareMode: true, hmr: false}, appType: 'custom', optimizeDeps: {noDiscovery: true, include: []}});
try {
  const {LEVELS} = await server.ssrLoadModule('/src/levels/registry.ts');
  const {OPENABLE_AUDIT} = await server.ssrLoadModule('/src/world/openablesSpec.ts');
  const {skywaysDesignDressOf} = await server.ssrLoadModule('/src/gen/skyways/stores/designDress.ts');
  const {DESIGN_RUGS, DESIGN_TINT} = await server.ssrLoadModule('/src/gen/skyways/stores/kinds/design.ts');
  const audit = new Map(OPENABLE_AUDIT.map(e => [e.kind, e.cls]));
  const list = [];
  if (seeds.length) for (const s of seeds) list.push(s);
  else {
    const want = {'two-level': 4, hall: 4};
    for (let s = 1; s <= 80 && (want['two-level'] || want.hall); s++) {
      const L = LEVELS.skyways.generate('main', {levelSeed: s, startWeapon: 'pistol', layoutVersion: 3});
      const an = L.skyways?.anchors?.find(a => a.family === 'design');
      if (an && want[an.format] > 0) { want[an.format]--; list.push(s); }
    }
  }
  const summary = [];
  for (const seed of list) {
    const L = LEVELS.skyways.generate('main', {levelSeed: seed, startWeapon: 'pistol', layoutVersion: 3});
    const an = L.skyways?.anchors?.find(a => a.family === 'design');
    if (!an) continue;
    const res = skywaysDesignDressOf(L).find(r => r.anchor === an.id);
    const role = new Map([[an.floor, 'floor']]);
    for (const a of L.areas) if (a.parent === an.floor && a.type === 'shop' && !an.zones.includes(a.id)) role.set(a.id, 'floor');
    if (an.upper !== undefined) { role.set(an.upper, 'upper'); for (const a of L.areas) if (a.parent === an.upper) role.set(a.id, 'upper'); }
    for (const s of an.stock) role.set(s, 'stock');
    const areas = [...role.keys()].map(i => L.areas[i]);
    const levels = [...new Set(areas.map(a => a.level ?? 0))].sort();
    const x0 = Math.min(...areas.map(a => a.x)) - 2, y0 = Math.min(...areas.map(a => a.y)) - 2;
    const x1 = Math.max(...areas.map(a => a.x + a.w)) + 2, y1 = Math.max(...areas.map(a => a.y + a.h)) + 2;
    const S = 12, cw = x1 - x0, ch = y1 - y0, W = cw * S * levels.length + (levels.length - 1) * 16, H = ch * S;
    const px = Buffer.alloc(W * H * 3, 18);
    const put = (ox, x, y, c) => { if (x < 0 || y < 0 || x >= cw * S || y >= H) return; const i = (y * W + ox + x) * 3; px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; };
    const fill = (ox, cx, cy, c) => { for (let dy = 0; dy < S; dy++) for (let dx = 0; dx < S; dx++) put(ox, (cx - x0) * S + dx, (cy - y0) * S + dy, c); };
    const toPx = (wx, wz) => [Math.round((wx / 0.5 - x0) * S), Math.round((wz / 0.5 - y0) * S)];
    const box = (ox, wx0, wz0, wx1, wz1, c, outline = true) => {
      const [ax, ay] = toPx(wx0, wz0), [bx, by] = toPx(wx1, wz1);
      for (let y = ay; y <= by; y++) for (let x = ax; x <= bx; x++) put(ox, x, y, outline && (y === ay || y === by || x === ax || x === bx) ? [20, 20, 20] : c);
    };
    const line = (ox, a, b, c) => { const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.05)); for (let k = 0; k <= n; k++) { const [x, y] = toPx(a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n); put(ox, x, y, c); } };
    const hex = h => [(h >> 16) & 255, (h >> 8) & 255, h & 255];
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
        if ((L.areas[d.a]?.level ?? 0) !== lv || !(role.has(d.a) || role.has(d.b))) continue;
        const c = d.shopfront ? [60, 200, 230] : d.staff ? [240, 140, 30] : [230, 230, 90];
        for (let cy = d.y; cy < d.y + d.h; cy++) for (let cx = d.x; cx < d.x + d.w; cx++) fill(ox, cx, cy, c);
      }
      const props = L.props.filter(p => role.has(p.area) && (p.level ?? 0) === lv);
      for (const p of props.filter(p => p.kind === 'skyDsRug')) {
        const [f, e] = DESIGN_RUGS[p.variant % DESIGN_RUGS.length];
        box(ox, p.x - p.hx, p.z - p.hz, p.x + p.hx, p.z + p.hz, hex(DESIGN_TINT[e]), false);
        box(ox, p.x - p.hx + 0.12, p.z - p.hz + 0.12, p.x + p.hx - 0.12, p.z + p.hz - 0.12, hex(DESIGN_TINT[f]), false);
      }
      for (const p of props.filter(p => p.kind !== 'skyDsRug' && p.kind !== 'skyDPoster')) {
        const cls = audit.get(p.kind);
        const c = p.kind === 'skyDsTextiles' ? TEXTILE : /Lamp/.test(p.kind) ? LAMP : OPEN[cls] ?? (/Sofa|Bed|Table|Chair|ottoman|Armchair/.test(p.kind) ? WARM : DECOR);
        box(ox, p.x - p.hx, p.z - p.hz, p.x + p.hx, p.z + p.hz, c, p.host === undefined);
      }
      for (const l of res?.lanes ?? []) if (l.level === lv) for (let k = 1; k < l.pts.length; k++) line(ox, l.pts[k - 1], l.pts[k], [80, 230, 240]);
    });
    const file = path.join(outDir, `design-seed${seed}-${an.format}.png`);
    await sharp(px, {raw: {width: W, height: H, channels: 3}}).png().toFile(file);
    const kinds = {};
    for (const p of L.props) if (role.has(p.area)) kinds[p.kind] = (kinds[p.kind] ?? 0) + 1;
    summary.push({seed, format: an.format, file: path.basename(file), sets: res?.sets.map(s => `${s.kind}@${s.level}${s.rug ? '+rug' : ''}`), skipped: res?.skipped, kinds});
  }
  fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 1));
  console.log(`${summary.length} design store plans -> ${outDir}`);
} finally {
  await server.close();
}
