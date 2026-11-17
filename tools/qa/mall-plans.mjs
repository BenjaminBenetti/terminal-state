// Task studio-mall-layout-variety-20261117-005520-01: top-down PLAN views of generated Malls, one PNG per seed with every storey side by side
// (no browser, no GPU: the TypeScript generator through Vite's SSR loader, rasterised with sharp). Walkways, shops / stock rooms, the
// openings (void), bridge decks, vertical runs, the street exits and the parking-lot window walls are colour coded.
// Usage: node tools/qa/mall-plans.mjs OUT_DIR [--variant NAME] [--version N] [seed ...]   (default: three seeds per family)
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const outDir = args[0] && !args[0].startsWith('--') ? args.shift() : path.join(root, 'qa-artifacts/mall-plans');
const opt = (k) => { const i = args.indexOf(k); if (i < 0) return undefined; const v = args[i + 1]; args.splice(i, 2); return v; };
const variant = opt('--variant'), version = Number(opt('--version') ?? 2);
const seeds = args.map(s => Number(s) >>> 0);
fs.mkdirSync(outDir, {recursive: true});

const C = {
  rock: [24, 25, 27], wall: [52, 50, 47], walk: [214, 208, 194], bridge: [222, 150, 70], open: [36, 58, 92], shop: [118, 164, 206],
  stock: [92, 120, 150], anchor: [92, 150, 120], food: [222, 196, 120], service: [128, 136, 140], station: [196, 182, 146], ramp: [190, 90, 160],
  exit: [220, 60, 50], window: [90, 230, 240], other: [150, 150, 150],
};

async function render(L, file, title) {
  const S = 2, PAD = 8, levels = L.levels, g0 = levels[0].grid, w = g0.w * S, h = g0.h * S;
  const cols = levels.length, W = cols * (w + PAD) + PAD, H = h + PAD * 2 + 40;
  const px = Buffer.alloc(W * H * 3, 16);
  const m = L.mall;
  const shopKind = new Map(), stock = new Set();
  for (const s of m.shops) { shopKind.set(s.area, s.kind); if (s.backroom !== undefined && s.backroom >= 0) stock.add(s.backroom); }
  const bridges = new Set(m.bridges.map(b => b.area)), service = new Set((m.service ?? []).flatMap(q => q.areas));
  const openings = new Map((m.void.openings ?? []).map(o => [o.level, o]));
  const inPoly = (poly, x, z) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a.z > z) !== (b.z > z) && x < (b.x - a.x) * (z - a.z) / (b.z - a.z) + a.x) c = !c; } return c; };
  const put = (ox, x, y, c) => { for (let dy = 0; dy < S; dy++) for (let dx = 0; dx < S; dx++) { const i = ((PAD + y * S + dy) * W + ox + x * S + dx) * 3; px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; } };
  levels.forEach((lvl, k) => {
    const g = lvl.grid, ox = PAD + k * (w + PAD), op = openings.get(lvl.id);
    for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
      const i = g.idx(x, y), cell = g.cells[i];
      let c = C.rock;
      if (cell === 0) {
        const X = (x + 0.5) * 0.5, Z = (y + 0.5) * 0.5;
        if (op && X >= op.bounds.x0 && X <= op.bounds.x1 && Z >= op.bounds.z0 && Z <= op.bounds.z1 && inPoly(op.outline, X, Z)) c = C.open;
      } else if (cell === 2) c = C.wall;
      else {
        const a = L.areas[g.area[i]], sk = shopKind.get(g.area[i]);
        if (g.rampIdx[i] >= 0) c = C.ramp;
        else if (bridges.has(g.area[i])) c = C.bridge;
        else if (sk) c = sk === 'anchor' ? C.anchor : sk === 'food' ? C.food : C.shop;
        else if (stock.has(g.area[i])) c = C.stock;
        else if (service.has(g.area[i]) || (a && !a.publicSpace)) c = C.service;
        else if (lvl.id === 0) c = a && a.kind === 'platform' ? C.station : C.walk;
        else c = C.walk;
      }
      put(ox, x, y, c);
    }
    const line = (x0, z0, x1, z1, c) => {
      const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 0.25));
      for (let t = 0; t <= n; t++) { const X = x0 + (x1 - x0) * t / n, Z = z0 + (z1 - z0) * t / n; const cx = Math.floor(X / 0.5), cy = Math.floor(Z / 0.5); if (cx >= 0 && cy >= 0 && cx < g.w && cy < g.h) for (const [ddx, ddy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) if (cx + ddx < g.w && cy + ddy < g.h) put(ox, cx + ddx, cy + ddy, c); }
    };
    for (const e of m.exits ?? []) if (e.level === lvl.id) { const alongX = e.side === 'N' || e.side === 'S'; alongX ? line(e.door.s0, e.door.plane, e.door.s1, e.door.plane, C.exit) : line(e.door.plane, e.door.s0, e.door.plane, e.door.s1, C.exit); }
    for (const wv of m.windows ?? []) if (wv.bands.some(b => b.level === lvl.id)) { const alongX = wv.side === 'N' || wv.side === 'S'; alongX ? line(wv.s0, wv.plane, wv.s1, wv.plane, C.window) : line(wv.plane, wv.s0, wv.plane, wv.s1, C.window); }
  });
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const labels = levels.map((l, k) => `<text x="${PAD + k * (w + PAD) + 4}" y="${PAD + 14}" font-size="13" fill="#f2ead6" font-family="sans-serif" font-weight="bold">${esc(l.id === 0 ? 'Subway' : `Level ${l.id}`)}</text>`).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${labels}<text x="${PAD}" y="${H - 22}" font-size="13" fill="#ece4cf" font-family="sans-serif">${esc(title)}</text><text x="${PAD}" y="${H - 6}" font-size="11" fill="#b8b0a0" font-family="sans-serif">walkway · void · bridge (orange) · shop (blue) / anchor (green) / food (gold) · runs (magenta) · street exit (red) · window wall (cyan). Software plan render: no lighting.</text></svg>`;
  await sharp(px, {raw: {width: W, height: H, channels: 3}}).composite([{input: Buffer.from(svg), top: 0, left: 0}]).png({compressionLevel: 9}).toFile(file);
}

async function main() {
  const server = await createServer({root: path.join(root, 'game'), configFile: false, logLevel: 'error', server: {middlewareMode: true, hmr: false}, appType: 'custom', optimizeDeps: {noDiscovery: true, include: []}});
  try {
    const gen = await server.ssrLoadModule('/src/gen/mall/index.ts');
    const jobs = [];
    if (seeds.length) for (const s of seeds) jobs.push({seed: s, variant});
    else for (const v of variant ? [variant] : ['galleria', 'crossroads', 'promenade', 'terrace-cross']) for (let k = 1; k <= 3; k++) jobs.push({seed: (k * 2654435761) >>> 0, variant: v});
    const summary = [];
    for (const j of jobs) {
      const t0 = performance.now();
      const L = gen.generateMallLevel({levelSeed: j.seed, startWeapon: 'rifle', layoutVersion: version}, {...(j.variant ? {variant: j.variant} : {}), trackExt: 'none'});
      const ms = Math.round(performance.now() - t0);
      const m = L.mall, issues = gen.mallIssues(L);
      const file = path.join(outDir, `mall-${m.variant}-${j.seed.toString(16)}.png`);
      const title = `${m.name} · ${m.variant} · seed 0x${j.seed.toString(16)} · v${version} · ${m.shops.length} shops · ${m.bridges.length} bridge decks · ${(m.exits ?? []).length} exits · ${(m.windows ?? []).length} window walls · ${ms} ms · ${issues.length ? issues.join('; ') : 'valid'}`;
      await render(L, file, title);
      summary.push({seed: j.seed, variant: m.variant, file: path.basename(file), ms, shops: m.shops.length, bridges: m.bridges.length, exits: (m.exits ?? []).length, windows: (m.windows ?? []).length, issues});
      console.log(title);
    }
    fs.writeFileSync(path.join(outDir, 'plans.json'), JSON.stringify(summary, null, 2));
  } finally {
    await server.close();
  }
}
main().catch(e => { console.error(e); process.exit(1); });
