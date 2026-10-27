// Top-down debug maps of generated stations (no browser): loads the TypeScript generator through
// Vite's SSR module loader and rasterises the grid with sharp. One PNG per seed + a JSON summary.
// Usage: node tools/qa/station-maps.mjs OUT_DIR [seed ...]   (default: one seed per archetype)
// Also writes a front elevation of each station's food-court counter wall (storefront building
// blocks + unit furniture, from gen/storefronts.ts) to check the facade composition without a browser.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const [outDir = path.join(root, 'qa-artifacts/maps'), ...seedArgs] = process.argv.slice(2);
fs.mkdirSync(outDir, {recursive: true});

function pickPerArchetype(gen) {
  const want = new Map();
  for (let i = 0; want.size < gen.ARCHETYPES.length && i < 400; i++) {
    const seed = (i * 2654435761 + 12345) >>> 0;
    const a = gen.pickArchetype(seed);
    if (!want.has(a)) want.set(a, seed);
  }
  return [...want.values()];
}

const KIND = {platform: [201, 185, 143], passage: [191, 183, 163], concourse: [169, 184, 168], service: [143, 154, 160], room: [183, 165, 140], closet: [156, 140, 120]};
const TYPE = {
  'food-court': [222, 196, 120], 'retail-arcade': [150, 196, 206], 'fare-hall': [140, 176, 150], 'eatery': [232, 150, 92], 'shop': [120, 170, 226],
  'exit-stair': [120, 120, 120], 'washroom': [170, 190, 200], 'underpass': [175, 168, 150],
};
const PROP = {table: [110, 80, 60], shopCounter: [170, 40, 30], shopDisplay: [210, 60, 40], shopBackbar: [90, 90, 96], shopCooler: [40, 90, 170], shopGlazing: [200, 235, 245], shopShutter: [40, 40, 44], shelf: [80, 80, 80], vending: [160, 30, 30], column: [60, 62, 66], fareGate: [230, 180, 40], bin: [50, 60, 50]};

async function render(l, file) {
  const g = l.grid, S = 4;
  const W = g.w * S, H = g.h * S;
  const px = Buffer.alloc(W * H * 3);
  const set = (x, y, c) => { for (let dy = 0; dy < S; dy++) for (let dx = 0; dx < S; dx++) { const i = ((y * S + dy) * W + x * S + dx) * 3; px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; } };
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
    const i = g.idx(x, y), cell = g.cells[i];
    if (cell === 0) { set(x, y, [22, 24, 26]); continue; }
    if (cell === 2) { set(x, y, [59, 53, 48]); continue; }
    const a = l.areas[g.area[i]];
    let c = a ? (TYPE[a.type] ?? KIND[a.kind]) : [136, 136, 136];
    if (a && a.paid && a.kind !== 'platform') c = [c[0] - 20, c[1], c[2] + 10];
    set(x, y, c);
  }
  // Props (footprints), doors (fare lines highlighted), spawn and zombies.
  const fillWorld = (x0, z0, x1, z1, c) => {
    for (let y = Math.floor(z0 / 0.5 * S); y < Math.ceil(z1 / 0.5 * S); y++) for (let x = Math.floor(x0 / 0.5 * S); x < Math.ceil(x1 / 0.5 * S); x++) {
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const i = (y * W + x) * 3; px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2];
    }
  };
  for (const p of l.props) if (p.y <= 0.01 || p.kind === 'column') fillWorld(p.x - p.hx, p.z - p.hz, p.x + p.hx, p.z + p.hz, PROP[p.kind] ?? [74, 79, 85]);
  for (const d of l.doors) if (d.fare) fillWorld(d.x * 0.5, d.y * 0.5, (d.x + d.w) * 0.5, (d.y + d.h) * 0.5, [240, 200, 40]);
  for (const sf of l.storefronts) if (sf.unit < 0) fillWorld(sf.ox * 0.5, sf.oy * 0.5, (sf.ox + sf.ow) * 0.5, (sf.oy + sf.oh) * 0.5, sf.style === 'hoarding' ? [220, 220, 200] : [90, 90, 96]);
  for (const z of l.zombies) fillWorld(z.x - 0.6, z.z - 0.6, z.x + 0.6, z.z + 0.6, z.type === 'coated' ? [61, 111, 209] : [194, 70, 58]);
  const sp = l.playerSpawn;
  fillWorld(sp.x - 0.9, sp.z - 0.9, sp.x + 0.9, sp.z + 0.9, [255, 255, 255]);
  // Labels: hall names and storefront names as SVG text overlay.
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const texts = [];
  for (const a of l.areas) {
    if (!['food-court', 'retail-arcade', 'fare-hall', 'concourse', 'platform', 'passage'].includes(a.type) || a.w * a.h < 200) continue;
    texts.push(`<text x="${(a.x + a.w / 2) * S}" y="${(a.y + a.h / 2) * S}" font-size="13" text-anchor="middle" fill="#111" font-family="sans-serif" font-weight="bold">${esc(a.label)}</text>`);
  }
  for (const sf of l.storefronts) {
    const cx = (sf.ux + sf.uw / 2) * S, cy = (sf.uy + sf.uh / 2) * S;
    const tag = `${sf.name}${sf.shutter === 'closed' ? ' ▮' : sf.shutter === 'partial' ? ' ▯' : ''}`;
    const vertical = sf.side === 'E' || sf.side === 'W';
    texts.push(`<text x="${cx}" y="${cy}" font-size="9" text-anchor="middle" fill="${sf.unit < 0 ? '#bbb' : '#102030'}" font-family="sans-serif"${vertical ? ` transform="rotate(-90 ${cx} ${cy})"` : ''}>${esc(tag)}</text>`);
  }
  const title = `${l.name} · ${l.archetype} · seed ${l.seed} · ${l.areas.length} areas · ${l.storefronts.length} storefronts · ${l.zombies.length} zombies`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H + 22}"><rect x="0" y="${H}" width="${W}" height="22" fill="#16181a"/>${texts.join('')}<text x="6" y="${H + 16}" font-size="14" fill="#ece4cf" font-family="sans-serif">${esc(title)}</text></svg>`;
  await sharp(px, {raw: {width: W, height: H, channels: 3}})
    .extend({bottom: 22, background: '#16181a'})
    .composite([{input: Buffer.from(svg), top: 0, left: 0}])
    .png({compressionLevel: 9})
    .toFile(file);
}

async function main() {
const server = await createServer({root: path.join(root, 'game'), configFile: false, logLevel: 'error', server: {middlewareMode: true, hmr: false}, appType: 'custom', optimizeDeps: {noDiscovery: true, include: []}});
try {
  const gen = {...await server.ssrLoadModule('/src/gen/station.ts'), ...await server.ssrLoadModule('/src/gen/storefronts.ts')};
  const seeds = seedArgs.length ? seedArgs.map(s => Number(s) >>> 0) : pickPerArchetype(gen);
  const summary = [];
  for (const seed of seeds) {
    const t0 = performance.now();
    const l = gen.generateStation(seed);
    const ms = performance.now() - t0;
    const file = path.join(outDir, `map-${String(seed).padStart(10, '0')}-${l.archetype}.png`);
    await render(l, file);
    await elevation(l, gen.storefrontParts, file.replace('.png', '-foodcourt-elevation.png'));
    const m = gen.layoutMetrics(l);
    summary.push({seed, file: path.basename(file), genMs: Math.round(ms), issues: gen.validateLayout(l), ...m});
    console.log(seed, l.archetype, `${Math.round(ms)} ms`, path.basename(file));
  }
  fs.writeFileSync(path.join(outDir, 'maps.json'), JSON.stringify(summary, null, 2));
} finally {
  await server.close();
}
}


const MAT_FILL = {
  shopFrame: '#7a766f', signBand: '#d9d2bf', menuBoard: '#2a2522', menuBoardNoodle: '#efe6d0', menuBoardCoffee: '#25352f', menuBoardPizza: '#1f2225',
  shutterSteel: '#8d9093', grille: '#a6a6a6', kitchenSteel: '#d8d8d8', glassShopfront: 'rgba(190,215,225,0.45)', black: '#111', quarryTile: '#a65a3a', tileShop: '#ddd6c8',
};
const FURN_FILL = {shopCounter: '#6b4f35', shopDisplay: 'rgba(200,225,235,0.7)', shopBackbar: '#c8c8c8', shopCooler: '#3a4a5a', shelf: '#555', shopGlazing: 'none', shopShutter: 'none'};

/** Front elevation (as seen from the hall) of the food court wall with the most storefronts. */
async function elevation(l, storefrontParts, file) {
  const F = l.areas.find(a => a.type === 'food-court');
  const bySide = new Map();
  for (const sf of l.storefronts) if (sf.hall === F.id) bySide.set(sf.side, [...(bySide.get(sf.side) ?? []), sf]);
  const [side, list] = [...bySide.entries()].sort((a, b) => b[1].length - a[1].length)[0];
  const alongX = side === 'N' || side === 'S';
  // Screen-right direction for a viewer in the hall facing the wall.
  const flip = side === 'S' || side === 'W' ? -1 : 1;
  const a0 = alongX ? F.x * 0.5 : F.y * 0.5, a1 = alongX ? (F.x + F.w) * 0.5 : (F.y + F.h) * 0.5;
  const S = 60, PAD = 20, W = Math.round((a1 - a0) * S) + PAD * 2, H = Math.round(F.ceil * S) + PAD * 2 + 30;
  const sx = a => PAD + (flip > 0 ? a - a0 : a1 - a) * S, sy = y => PAD + (F.ceil - y) * S;
  const depthOf = (x, z) => { const sf = list[0]; const wall = side === 'S' ? sf.oy * 0.5 : side === 'N' ? (sf.oy + 1) * 0.5 : side === 'E' ? sf.ox * 0.5 : (sf.ox + 1) * 0.5; const c = alongX ? z : x; return side === 'S' || side === 'E' ? wall - c : c - wall; };
  const items = [];
  items.push({n: -99, svg: `<rect x="${PAD}" y="${sy(F.ceil)}" width="${(a1 - a0) * S}" height="${F.ceil * S}" fill="#cfc8b4"/>`});
  for (const sf of list) {
    const o0 = alongX ? sf.ox * 0.5 : sf.oy * 0.5, o1 = o0 + (alongX ? sf.ow : sf.oh) * 0.5;
    if (sf.unit >= 0) items.push({n: -50, svg: `<rect x="${Math.min(sx(o0), sx(o1))}" y="${sy(sf.shutter === 'partial' ? sf.shutterY : sf.head)}" width="${Math.abs(sx(o1) - sx(o0))}" height="${(sf.shutter === 'partial' ? sf.shutterY : sf.head) * S}" fill="#3a352e"/>`});
    const parts = storefrontParts(l, sf);
    for (const b of parts.boxes) {
      const pa0 = alongX ? b.x0 : b.z0, pa1 = alongX ? b.x1 : b.z1;
      const n = Math.max(depthOf(b.x0, b.z0), depthOf(b.x1, b.z1));
      const fill = MAT_FILL[b.m] ?? '#999';
      items.push({n, svg: `<rect x="${Math.min(sx(pa0), sx(pa1))}" y="${sy(b.y1)}" width="${Math.max(1, Math.abs(sx(pa1) - sx(pa0)))}" height="${Math.max(1, (b.y1 - b.y0) * S)}" fill="${fill}" stroke="rgba(0,0,0,0.25)" stroke-width="0.5"/>`});
    }
    for (const f of parts.faces) {
      const fa = alongX ? f.x : f.z;
      const color = '#' + sf.color.toString(16).padStart(6, '0');
      items.push({n: 1, svg: `<rect x="${sx(fa) - f.w / 2 * S}" y="${sy(f.y + f.h / 2)}" width="${f.w * S}" height="${f.h * S}" fill="${f.kind === 'hoarding' ? '#e6e0d2' : color}" opacity="${sf.sign === 'lit' ? 1 : sf.sign === 'dim' ? 0.6 : 0.3}"/><text x="${sx(fa)}" y="${sy(f.y) + 5}" font-size="${Math.min(16, f.h * S * 0.6)}" text-anchor="middle" fill="#fff" font-family="sans-serif" font-weight="bold">${f.kind === 'hoarding' ? 'SPACE AVAILABLE' : sf.name.toUpperCase().replace(/&/g, '&amp;')}</text>`});
    }
    for (const p of l.props.filter(q => q.area === sf.unit && FURN_FILL[q.kind] && FURN_FILL[q.kind] !== 'none')) {
      const pa0 = alongX ? p.x - p.hx : p.z - p.hz, pa1 = alongX ? p.x + p.hx : p.z + p.hz;
      items.push({n: depthOf(p.x, p.z), svg: `<rect x="${Math.min(sx(pa0), sx(pa1))}" y="${sy(p.h)}" width="${Math.abs(sx(pa1) - sx(pa0))}" height="${p.h * S}" fill="${FURN_FILL[p.kind]}" stroke="#000" stroke-width="0.6"/>`});
    }
  }
  items.sort((p, q) => p.n - q.n);
  const label = `${l.name} · ${l.archetype} · food court wall ${side} · ${list.length} units (${list.map(s => s.shutter).join(', ')})`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="#16181a"/>${items.map(i => i.svg).join('')}<text x="8" y="${H - 10}" font-size="14" fill="#ece4cf" font-family="sans-serif">${label.replace(/&/g, '&amp;')}</text></svg>`;
  await sharp(Buffer.from(svg)).png().toFile(file);
}

await main();
