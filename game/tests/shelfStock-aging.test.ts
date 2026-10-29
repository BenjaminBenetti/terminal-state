// Iteration 12 (LOOT lane): user feedback #3 — "most shelf items should be boxes, or trash or broken. So the good items the player
// is looking for stand out ... The 'no interactable' items should appear time worn and tarnished." The filler stock is mostly
// aged / boxed / trash / spoiled (by piece, over generated stations), coolers are mostly empty / broken bottles, the label atlas
// and vertex colours are faded and desaturated well below the real loot items' own textures, cans / foil lost their shine.
import {fileURLToPath} from 'node:url';
import {NodeIO} from '@gltf-transform/core';
import sharp from 'sharp';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {installStockCanvas, loadModel, stockedStation, stockProp} from './helpers/stockHelpers';
import {ARCH_INDEX, CATEGORY_STOCK, STOCK_ARCHES, type StockLook} from '../src/world/shelfStockCatalog';
import {AGE, ageColor, ageRGB, archGeometry, atlasLayout, disposeStockAssets, stockMaterial} from '../src/world/shelfStockGeometry';
import {FILLER_TINT, ShelfStock} from '../src/world/shelfStock';
import {ITEMS} from '../src/items/items';
import {MODEL_FILES, type ModelKey} from '../src/assets/manifest';

const SEEDS = [9001, 424242, 24839];
const sat = (r: number, g: number, b: number) => { const mx = Math.max(r, g, b), mn = Math.min(r, g, b); return mx <= 0 ? 0 : (mx - mn) / mx; };
const NOT_INTACT: ReadonlySet<StockLook> = new Set(['box', 'trash', 'spoiled', 'aged']);

describe('the filler is mostly boxes, trash and broken / spoiled goods', () => {
  let uninstall: () => void = () => {};
  beforeAll(async () => { uninstall = await installStockCanvas(false); });
  afterAll(() => uninstall());

  it('every archetype declares how it reads; categories lean on the aged / boxed / trash classes', () => {
    for (const a of STOCK_ARCHES) expect(['box', 'trash', 'spoiled', 'aged', 'intact'], a.id).toContain(a.look);
    // the archetypes that share a real item's NAME (chips, ...) are the intact minority, drawn from the aged atlas (below)
    for (const a of STOCK_ARCHES) if (ITEMS[a.id]) expect(a.look, a.id).toBe('intact');
    for (const [cat, rows] of Object.entries(CATEGORY_STOCK)) {
      const total = rows.reduce((s, r) => s + r[1], 0);
      const intact = rows.filter(r => STOCK_ARCHES[ARCH_INDEX[r[0]]].look === 'intact').reduce((s, r) => s + r[1], 0);
      expect(intact / total, `${cat} intact share of picks`).toBeLessThanOrEqual(0.3);
    }
  });

  it('>= 75 % of the pieces in generated stations are box / trash / spoiled / aged; coolers mostly empty, broken or crushed', async () => {
    let all = 0, kept = 0, cooler = 0, coolerIntact = 0, coolerTrash = 0;
    for (const seed of SEEDS) {
      const {stock} = await stockedStation(seed);
      for (const p of stock.filler.pieces) {
        const a = STOCK_ARCHES[ARCH_INDEX[stock.pieceInfo(p.id).arch]];
        all++;
        if (NOT_INTACT.has(a.look)) kept++;
        if (stock.holders[p.holder].kind === 'shopCooler') {
          cooler++;
          if (a.look === 'intact') coolerIntact++;
          if (a.id === 'bottleEmpty' || a.id === 'bottleBroken' || a.id === 'canCrushed') coolerTrash++;
        }
      }
    }
    expect(all).toBeGreaterThan(4000);
    expect(kept / all).toBeGreaterThanOrEqual(0.75);
    expect(cooler).toBeGreaterThan(50);
    expect(coolerIntact / cooler).toBeLessThanOrEqual(0.25);
    expect(coolerTrash / cooler).toBeGreaterThan(0.6);
  });

  it('coolers are emptier than shop shelving (sold-out gaps); an intact package is a lone leftover, never a full block', async () => {
    const shelf = await loadModel('shelf.glb');
    let shelfPieces = 0, coolerPieces = 0, intactRuns = 0, intactPieces = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const S = new ShelfStock();
      S.build({props: [stockProp('stockShelf', 4, 3, {variant: 1}), stockProp('shopCooler', 8, 3)], areas: [{purpose: 'convenience'}], seed} as never, {models: {shelf}});
      for (const h of S.holders) {
        // pieces per metre of board
        const per = h.boards.reduce((m, b) => m + (b.x1 - b.x0), 0);
        if (h.kind === 'shopCooler') coolerPieces += h.count / per; else shelfPieces += h.count / per;
        // runs of one intact archetype on a board: at most 2 facings x 2 rows, unstacked
        const byBoard = new Map<string, number>();
        for (const p of h.placements) {
          const a = STOCK_ARCHES[p.arch];
          if (a.look !== 'intact') continue;
          intactPieces++;
          expect(p.on, `${a.id} stacked`).toBe(-1);
          const k = `${p.board}:${a.id}:${p.variant}`;
          byBoard.set(k, (byBoard.get(k) ?? 0) + 1);
        }
        for (const n of byBoard.values()) { intactRuns++; expect(n).toBeLessThanOrEqual(8); }
      }
    }
    expect(intactPieces).toBeGreaterThan(0);
    expect(intactRuns).toBeGreaterThan(0);
    expect(coolerPieces).toBeLessThan(shelfPieces);
  });
});

describe('aged and tarnished print, colours and materials (the real loot stays fresh)', () => {
  it('ageColor / ageRGB desaturate, darken and lift blacks; every gradient stop and fill goes through it', () => {
    for (const c of ['#c4161c', '#1d8f3a', '#f07d00', '#173f8a', '#ffd200', 'rgb(46,111,208)']) {
      const m = /^#(..)(..)(..)$/.exec(c);
      const [r, g, b] = m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [46, 111, 208];
      const [R, G, B] = ageRGB(r, g, b);
      expect(sat(R, G, B), c).toBeLessThan(sat(r, g, b) * 0.6);
      expect(Math.max(R, G, B), c).toBeLessThanOrEqual(Math.max(r, g, b));
    }
    const [wr, wg, wb] = ageRGB(255, 255, 255), [kr] = ageRGB(0, 0, 0);
    expect(Math.max(wr, wg, wb)).toBeLessThan(255 * (1 - AGE.darken * 0.5)); // no fresh white
    expect(kr).toBeGreaterThan(0); // faded ink
    expect(ageColor('rgba(10,20,30,0.5)')).toMatch(/^rgba\(\d+,\d+,\d+,0\.5\)$/);
    expect(ageColor('#fff')).toMatch(/^rgb\(/);
    expect(ageColor('transparent')).toBe('transparent');
  });

  it('the rasterized label atlas is far less saturated than the real food / drink items\' own textures', async () => {
    const uninstall = await installStockCanvas(true);
    try {
      disposeStockAssets();
      const mat = stockMaterial();
      const img = mat.map!.image as {data: Uint8ClampedArray; width: number; height: number};
      const L = atlasLayout();
      expect(img.width).toBe(L.width);
      let s = 0, n = 0;
      const FOODISH = ['soda', 'energy', 'tin', 'bottle', 'bigbottle', 'carton', 'cereal', 'pantry', 'candy', 'chips', 'snack', 'cup', 'jar', 'med', 'pills'];
      for (const [key, c] of L.cells) {
        if (!FOODISH.includes(key.split(':')[0])) continue;
        for (let y = c.y; y < c.y + c.h; y += 2) for (let x = c.x; x < c.x + c.w; x += 2) {
          const i = (y * img.width + x) * 4;
          s += sat(img.data[i], img.data[i + 1], img.data[i + 2]); n++;
        }
      }
      const filler = s / n;
      // the real loot items' base-colour textures (generated item models: the manifest's item_* files)
      let rs = 0, rn = 0;
      const io = new NodeIO();
      for (const f of ['water', 'cola', 'juice', 'chocolate', 'chips', 'beans', 'noodles']) {
        const doc = await io.read(fileURLToPath(new URL(`../public/${MODEL_FILES[`item_${f}` as ModelKey].url}`, import.meta.url)));
        const tex = doc.getRoot().listMaterials()[0].getBaseColorTexture()!;
        const {data, info} = await sharp(Buffer.from(tex.getImage()!)).resize(128, 128, {fit: 'fill'}).removeAlpha().raw().toBuffer({resolveWithObject: true});
        for (let i = 0; i < info.width * info.height * 3; i += 3) { rs += sat(data[i], data[i + 1], data[i + 2]); rn++; }
      }
      const real = rs / rn;
      expect(n).toBeGreaterThan(5000);
      expect(real).toBeGreaterThan(0.3);
      expect(filler).toBeLessThan(real * 0.6);
    } finally {
      disposeStockAssets();
      uninstall();
    }
  }, 120000);

  it('vertex colours are faded (no pure white / fresh colour left), pieces are tinted dusty, cans and foil are dull', async () => {
    const uninstall = await installStockCanvas(false);
    try {
      for (let a = 0; a < STOCK_ARCHES.length; a++) {
        const col = archGeometry(a, 0).attributes.color.array as Float32Array;
        let mx = 0, mxSat = 0;
        for (let i = 0; i < col.length; i += 3) { mx = Math.max(mx, col[i], col[i + 1], col[i + 2]); mxSat = Math.max(mxSat, sat(col[i], col[i + 1], col[i + 2])); }
        expect(mx, STOCK_ARCHES[a].id).toBeLessThanOrEqual(0.9);
        expect(mxSat, STOCK_ARCHES[a].id).toBeLessThan(0.97);
      }
      expect(FILLER_TINT[1]).toBeLessThan(0.95);
      expect(FILLER_TINT[0]).toBeLessThan(0.7);
      const m = stockMaterial();
      expect(m.emissive.getHex()).toBe(0);
    } finally {
      disposeStockAssets();
      uninstall();
    }
  });
});
