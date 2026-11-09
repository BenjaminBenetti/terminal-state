// Iteration 08 (Lane S): real 3D shelf stock — catalogue, dressing, derived display treatment,
// rendering budgets, and filler never being loot. Physics: tests/shelfStock-physics.test.ts.
import * as THREE from 'three';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {installStockCanvas, loadModel, stockedStation, triangleHitsOBB} from './helpers/stockHelpers';
import {generateStation} from '../src/gen/station';
import {PURPOSE_PROP_KINDS, type PropKind, type PropPlacement} from '../src/gen/props';
import {purposePropShape, stockShelfStock, STOCK_THEMES, type PurposePart} from '../src/gen/purposeShapes';
import {
  ARCH_INDEX, CATEGORY_STOCK, LABEL_VARIANTS, MAX_STOCK_PER_STATION, STOCKED_KINDS, STOCK_ARCHES, isStockedKind, stockCategory,
} from '../src/world/shelfStockCatalog';
import {dressHolder, footprintRect, obbOverlap, obbBoxOverlap, obbExtent, placementOBB, qAxes, type Board, type OBB, type StockPlacement, type V3} from '../src/world/shelfStockLayout';
import {AUTHORED_CARCASS, PICTURE_MATS, displayTreatment, stockBoards, type DeckSampler} from '../src/world/shelfStockCarcass';
import {ShelfStock, deviceWallDeck, fittedTriangles, qaStandFree, shelfDecks} from '../src/world/shelfStock';
import {archGeometry, atlasLayout, labelUV, stockMaterial} from '../src/world/shelfStockGeometry';
import {buildStorefronts} from '../src/world/storefrontBuilder';
import {ContainerManager} from '../src/world/containers';

let uninstall: () => void = () => {};
beforeAll(async () => { uninstall = await installStockCanvas(false); });
afterAll(() => uninstall());

const SEEDS = [9001, 424242, 24839];

/** Share of the 'rows' boards' length covered by the pieces standing on them (union of their footprints along x). */
function rowCoverage(pl: readonly StockPlacement[], boards: readonly Board[]): number {
  let len = 0, cov = 0;
  boards.forEach((b, bi) => {
    if (b.mode !== 'rows') return;
    len += b.x1 - b.x0;
    const iv = pl.filter(p => p.board === bi).map(p => footprintRect(p)).sort((a, c) => a[0] - c[0]);
    let e = -Infinity;
    for (const f of iv) { cov += Math.max(0, Math.min(f[2], b.x1) - Math.max(f[0], e, b.x0)); e = Math.max(e, f[2]); }
  });
  return len ? cov / len : 1;
}

/** Every placement's own expected category members (lean racks also hold their newspaper bin). */
const allowed = (cat: keyof typeof CATEGORY_STOCK) => new Set([...CATEGORY_STOCK[cat].map(r => r[0]), ...(cat === 'magazines' ? ['news'] : [])]);

/** Bottom of a placement and the deck it should rest on (its board / the piece under it). */
function seatError(p: StockPlacement, list: readonly StockPlacement[], b: Board): number {
  const o = placementOBB(p), e = obbExtent(o);
  const bottom = p.c[1] - e[1];
  if (b.mode === 'hang') {
    // hung: its top just under the rod of a hook it stands on (x within the blank's half width), within its reach
    const top = p.c[1] + e[1], rod = b.rod ?? 0.002;
    const hook = (b.hooks ?? []).find(([x, y]) => Math.abs(x - p.c[0]) < 0.004 && top < y - rod && top > y - rod - 0.006);
    if (!hook || p.c[2] - e[2] < b.z0 || p.c[2] + e[2] > b.z1) return 1;
    return (hook[1] - rod - 0.0015) - top; // nominal 1.5 mm gap under the rod
  }
  if (b.mode === 'lean') return bottom - b.y; // leaning copies stand on the ledge (against the copy behind)
  if (p.on >= 0) {
    const q = list[p.on], qo = placementOBB(q);
    return bottom - (q.c[1] + obbExtent(qo)[1]);
  }
  if (b.mode === 'rows' && b.deck) { const f = footprintRect(p); return bottom - b.deck(f[0], f[1], f[2], f[3]); }
  return bottom - b.y;
}

/**
 * Solid boxes of a piece for intersection tests: its box, or for a round package (cylinder collider)
 * both inscribed squares of the cylinder (yaw and yaw + 45 deg) — anything touching either is inside it.
 */
function pieceBoxes(p: StockPlacement, shrink: number): OBB[] {
  const o = placementOBB(p, shrink);
  if (STOCK_ARCHES[p.arch].collider === 'box') return [o];
  return [0, Math.PI / 4].map(k => {
    const c = Math.cos(k), s = Math.sin(k);
    const ax0: V3 = [o.ax[0][0] * c - o.ax[2][0] * s, o.ax[0][1] * c - o.ax[2][1] * s, o.ax[0][2] * c - o.ax[2][2] * s];
    const ax2: V3 = [o.ax[0][0] * s + o.ax[2][0] * c, o.ax[0][1] * s + o.ax[2][1] * c, o.ax[0][2] * s + o.ax[2][2] * c];
    return {c: o.c, ax: [ax0, o.ax[1], ax2], h: [o.h[0] * Math.SQRT1_2, o.h[1], o.h[2] * Math.SQRT1_2]};
  });
}

function partOBB(part: PurposePart, shrink = 0): OBB {
  const yaw = part.ry ?? 0, tilt = part.rx ?? 0;
  // purposeShapes: rotateX then rotateY (three.js geometry order) = R_y * R_x
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(tilt, yaw, 0, 'YXZ'));
  return {c: part.p, ax: qAxes([q.x, q.y, q.z, q.w]), h: [part.s[0] / 2 - shrink, part.s[1] / 2 - shrink, part.s[2] / 2 - shrink]};
}

describe('filler catalogue and categories', () => {
  it('every archetype is real-scale, physical and drawn from the label atlas', () => {
    for (const a of STOCK_ARCHES) {
      expect(a.w, a.id).toBeGreaterThan(0.002); expect(a.h, a.id).toBeGreaterThan(0.002); expect(a.d, a.id).toBeGreaterThan(0.002);
      // colliders never thinner than 6 mm (stable contacts; thin blanks / magazines get a thicker `fit`)
      const f = a.fit ?? [1, 1, 1];
      expect(Math.min(a.w * f[0], a.h * f[1], a.d * f[2]), a.id).toBeGreaterThan(0.006);
      expect(Math.max(a.w, a.h, a.d), a.id).toBeLessThan(0.7);
      expect(a.mass, a.id).toBeGreaterThan(0.01); expect(a.mass, a.id).toBeLessThan(6); // a key blank ~12 g .. a carton of goods
      if (a.label !== 'none') expect(LABEL_VARIANTS[a.label], a.id).toBeGreaterThanOrEqual(a.variants);
      // geometry stays inside its catalogue box (origin bottom-centre)
      for (let v = 0; v < a.variants; v++) {
        const g = archGeometry(ARCH_INDEX[a.id], v);
        const bb = g.boundingBox!;
        expect(bb.min.y, a.id).toBeGreaterThanOrEqual(-1e-4);
        expect(bb.max.y, a.id).toBeLessThanOrEqual(a.h + 1e-4);
        expect(Math.max(-bb.min.x, bb.max.x), a.id).toBeLessThanOrEqual(a.w / 2 + 1e-4);
        expect(Math.max(-bb.min.z, bb.max.z), a.id).toBeLessThanOrEqual(a.d / 2 + 1e-4);
        expect(g.attributes.color && g.attributes.uv && g.attributes.normal).toBeTruthy();
      }
    }
    // every label cell fits the atlas and does not overlap another
    const L = atlasLayout();
    const cells = [...L.cells.values()];
    for (const c of cells) { expect(c.x + c.w).toBeLessThanOrEqual(L.width); expect(c.y + c.h).toBeLessThanOrEqual(L.height); }
    for (let i = 0; i < cells.length; i++) for (let j = i + 1; j < cells.length; j++) {
      const a = cells[i], b = cells[j];
      expect(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y).toBe(true);
    }
    expect(labelUV('soda', 0).all[2]).toBeGreaterThan(labelUV('soda', 0).all[0]);
  });

  it('every stocked holder kind gets stock appropriate to its category', async () => {
    const shelf = await loadModel('shelf.glb');
    const deck = shelfDecks(shelf);
    const cases: [string, number, string | undefined][] = [
      ...STOCK_THEMES.map((_, v) => ['stockShelf', v, 'convenience'] as [string, number, string]),
      ['snackRack', 0, 'newsstand'], ['shopCooler', 0, 'convenience'], ['shopCooler', 0, 'juice'], ['magazineRack', 0, 'newsstand'],
      ['flowerStand', 0, 'florist'], ['breadRack', 0, 'bakery'], ['breadRack', 1, 'donut'], ['repairBench', 0, 'keys'], ['repairBench', 1, 'phone'],
      ['deviceWall', 0, 'tech'], ['blenderBar', 0, 'juice'],
      // task food-shelf-production (lane SHELF): storage shelving by its room (closets, offices, kitchens, workshops, storage)
      ['shelf', 0, 'janitor-closet'], ['shelf', 0, 'office-storage'], ['shelf', 0, 'storage'], ['shelf', 0, 'workshop'], ['shelf', 0, 'ramen-kitchen'],
    ];
    const wallDeck = deviceWallDeck(await loadModel('tech-display.glb'));
    for (const kind of STOCKED_KINDS) expect(cases.some(c => c[0] === kind), kind).toBe(true);
    expect(['janitor-closet', 'office-storage', 'storage', 'workshop', 'ramen-kitchen'].map(p => stockCategory('shelf', 0, p))).toEqual(['cleaning', 'office', 'storage', 'parts', 'pantry']);
    for (const [kind, variant, purpose] of cases) {
      const cat = stockCategory(kind, variant, purpose)!;
      expect(cat, kind).toBeTruthy();
      // (storage shelving stands stock only on the measured decks of its shelf.glb: its procedural fallback box has no boards)
      if (kind === 'shelf') expect(stockBoards('shelf', variant, {deck: null}).length).toBe(0);
      for (const d of kind === 'stockShelf' ? [deck, null] : kind === 'shelf' ? [deck] : kind === 'deviceWall' ? [wallDeck, null] : [null]) {
        const boards = stockBoards(kind, variant, {deck: d as DeckSampler | null});
        const pl = dressHolder({category: cat, boards, lots: [], seed: 31 + variant});
        // stocked: more than 5 pieces, or (task food-shelf-production: a small board of real-size modelled junk — the electronics wall
        // fallback's 0.15 m-high cabinet top holds four 0.25 m cable coils) its row boards mostly covered
        expect(pl.length > (kind === 'repairBench' && variant === 1 ? 0 : 5) || rowCoverage(pl, boards) > 0.7, `${kind}/${variant}: ${pl.length} pieces`).toBe(true);
        // each board holds its own category (the key-cutting bench's key wall holds key blanks)
        for (const p of pl) {
          const bc = boards[p.board].category ?? cat;
          expect(allowed(bc).has(STOCK_ARCHES[p.arch].id), `${kind}/${bc}: ${STOCK_ARCHES[p.arch].id}`).toBe(true);
        }
      }
    }
    // the key wall really is hung with blanks; a juice bar's crate holds one fruit
    const keyWall = dressHolder({category: 'parts', boards: stockBoards('repairBench', 0), lots: [], seed: 7});
    expect(keyWall.filter(p => STOCK_ARCHES[p.arch].id === 'key').length).toBeGreaterThan(60);
    const crates = dressHolder({category: 'fruit', boards: stockBoards('blenderBar', 0), lots: [], seed: 7});
    expect(crates.length).toBeGreaterThan(12);
    for (const b of [0, 1]) expect(new Set(crates.filter(p => p.board === b).map(p => p.variant)).size).toBe(1);
    // themes really differ: a pharmacy shelf has no tins, a snack shelf no medicine
    expect(stockCategory('stockShelf', 2, 'pharmacy')).toBe('pharmacy');
    expect(stockCategory('shopCooler', 0, 'juice')).toBe('juice');
    expect(isStockedKind('vending')).toBe(false);
  });
});

describe('dressing (generated stations, real loot, real shelf decks)', () => {
  it('no piece interpenetrates another, a real loot lot or the space above its board; nothing floats', async () => {
    for (const seed of SEEDS) {
      const {stock, cm} = await stockedStation(seed);
      expect(stock.holders.length).toBeGreaterThan(20);
      let pieces = 0, lotsChecked = 0;
      for (const h of stock.holders) {
        const lots = cm.holderFor(h.prop)?.state.lots ?? [];
        const obbs = h.placements.map(p => placementOBB(p, 0.0005));
        for (let i = 0; i < h.placements.length; i++) {
          const p = h.placements[i], b = h.boards[p.board];
          pieces++;
          // seated: on its deck / on the piece below it (1.5 mm dressing gap + 2 mm deck sampling)
          const err = seatError(p, h.placements, b);
          expect(err, `${h.kind} piece ${i} seat`).toBeGreaterThan(-0.0015);
          expect(err, `${h.kind} piece ${i} floats`).toBeLessThan(0.0045);
          const top = p.c[1] + obbExtent(obbs[i])[1];
          expect(top, `${h.kind} piece ${i} top`).toBeLessThanOrEqual(b.top + 1e-6);
          for (let j = i + 1; j < h.placements.length; j++) {
            const a = obbs[i], c = obbs[j];
            if (Math.abs(a.c[0] - c.c[0]) > 0.7 || Math.abs(a.c[1] - c.c[1]) > 0.7 || Math.abs(a.c[2] - c.c[2]) > 0.7) continue;
            expect(obbOverlap(a, c, 0), `${h.kind} pieces ${i}/${j} overlap`).toBe(false);
          }
        }
        // real loot lots: never overlapped, never covered from the front
        const { placementBox } = await import('../src/items/lootLayout');
        for (const l of lots) {
          const b = placementBox(l.itemId, l);
          lotsChecked++;
          for (const o of obbs) expect(obbBoxOverlap(o, b, 0), `${h.kind} lot ${l.itemId}`).toBe(false);
          for (const p of h.placements) {
            const e = obbExtent(placementOBB(p));
            const inFront = p.c[2] - e[2] >= b.max[2] - 1e-6 && p.c[0] + e[0] > b.min[0] && p.c[0] - e[0] < b.max[0] && p.c[1] - e[1] < b.max[1] && p.c[1] + e[1] > b.min[1];
            expect(inFront, `${h.kind} piece in front of lot ${l.itemId}`).toBe(false);
          }
        }
      }
      expect(pieces).toBe(stock.filler.pieces.length);
      expect(lotsChecked).toBeGreaterThan(10);
    }
  });

  it('stock never intersects the generated shelf / wall-bay models or the authored carcasses it stands in', async () => {
    const shelf = await loadModel('shelf.glb'), wall = await loadModel('tech-display.glb');
    const models = [
      {kind: 'stockShelf', deck: shelfDecks(shelf), tris: fittedTriangles(shelf, 1.2, 1.85, 0.45), variants: STOCK_THEMES.length},
      {kind: 'deviceWall', deck: deviceWallDeck(wall), tris: fittedTriangles(wall, 1.1, 2.0, 0.58), variants: 1},
      // task food-shelf-production (lane SHELF): storage shelving (the same shelf.glb) with its big storage boxes / junk
      {kind: 'shelf', deck: shelfDecks(shelf), tris: fittedTriangles(shelf, 1.2, 1.85, 0.45), variants: 1},
    ];
    let tested = 0;
    for (const {kind, deck, tris, variants} of models) for (let v = 0; v < variants; v++) {
      for (const seed of [5, 6, 7]) {
        const pl = dressHolder({category: stockCategory(kind, v, undefined)!, boards: stockBoards(kind, v, {deck}), lots: [], seed: seed * 100 + v});
        // the wall bay's strip is stocked along its length (task food-shelf-production: was "> 8 pieces"; the strip now draws its fit
        // products from the category's rows that fit it, and a full strip of 14 cm gadget boxes is 7-8 pieces: measured as coverage)
        if (kind === 'deviceWall') {
          expect(pl.length).toBeGreaterThanOrEqual(6);
          const iv = pl.map(p => footprintRect(p)).map(f => [f[0], f[2]] as const).sort((a, b) => a[0] - b[0]);
          let cov = 0, e = -Infinity;
          for (const [a, b] of iv) { cov += Math.max(0, b - Math.max(a, e)); e = Math.max(e, b); }
          expect(cov / (deck.rect(0).x1 - deck.rect(0).x0)).toBeGreaterThan(0.7);
        }
        for (const p of pl) {
          const A = STOCK_ARCHES[p.arch];
          for (const o of pieceBoxes(p, 0.002)) {
            const e = obbExtent(o);
            for (let t = 0; t < tris.length; t += 9) {
              const a: V3 = [tris[t], tris[t + 1], tris[t + 2]], b: V3 = [tris[t + 3], tris[t + 4], tris[t + 5]], c: V3 = [tris[t + 6], tris[t + 7], tris[t + 8]];
              if (Math.max(a[0], b[0], c[0]) < o.c[0] - e[0] || Math.min(a[0], b[0], c[0]) > o.c[0] + e[0] || Math.max(a[1], b[1], c[1]) < o.c[1] - e[1] || Math.min(a[1], b[1], c[1]) > o.c[1] + e[1] || Math.max(a[2], b[2], c[2]) < o.c[2] - e[2] || Math.min(a[2], b[2], c[2]) > o.c[2] + e[2]) continue;
              expect(triangleHitsOBB(a, b, c, o), `${A.id} at ${p.c.map(x => x.toFixed(3))} in the shelf model`).toBe(false);
            }
          }
          tested++;
        }
      }
    }
    expect(tested).toBeGreaterThan(300);
    // authored carcasses (derived display treatments): no piece inside a board, post, panel or step
    for (const [kind, variants] of [['magazineRack', [0]], ['flowerStand', [0]], ['breadRack', [0, 1]], ['snackRack', [0]], ['repairBench', [0, 1]], ['stockShelf', [0, 3]], ['deviceWall', [0]], ['blenderBar', [0]]] as [PropKind, number[]][]) {
      for (const v of variants) {
        const parts = displayTreatment(kind, v, purposePropShape(kind as never, v) ?? [], {model: false});
        const cat = stockCategory(kind, v, kind === 'repairBench' || kind === 'deviceWall' ? undefined : 'convenience')!;
        for (const seed of [1, 2, 3]) {
          const boards = stockBoards(kind, v);
          const pl = dressHolder({category: cat, boards, lots: [], seed});
          for (const p of pl) for (const part of parts) for (const o of pieceBoxes(p, 0.001)) {
            expect(obbOverlap(o, partOBB(part, 0.0005), 0), `${kind}/${v} ${STOCK_ARCHES[p.arch].id} vs ${part.m}`).toBe(false);
          }
          // seated / hung (the generated stations above may not contain every kind)
          pl.forEach((p, i) => {
            const err = seatError(p, pl, boards[p.board]);
            expect(err, `${kind}/${v} piece ${i} seat`).toBeGreaterThan(-0.0015);
            expect(err, `${kind}/${v} piece ${i} floats`).toBeLessThan(0.0045);
          });
        }
      }
    }
  });

  it('is deterministic and never duplicates on rebuild', async () => {
    const shelf = await loadModel('shelf.glb');
    const layout = generateStation(424242);
    const S = new ShelfStock();
    const sig = () => S.filler.pieces.map(p => `${S.pieceInfo(p.id).arch}@${p.p.x.toFixed(4)},${p.p.y.toFixed(4)},${p.p.z.toFixed(4)}`).join('|');
    S.build(layout, {models: {shelf}});
    const a = sig(), n = S.filler.pieces.length, kids = S.group.children.length;
    S.build(layout, {models: {shelf}});
    expect(S.filler.pieces.length).toBe(n);
    expect(S.group.children.length).toBe(kids);
    expect(sig()).toBe(a);
    const T = new ShelfStock();
    T.build(layout, {models: {shelf}});
    expect(T.filler.pieces.length).toBe(n);
    // a different station replaces (never adds to) the stock
    S.build(generateStation(24839), {models: {shelf}});
    expect(S.filler.pieces.length).not.toBe(n);
    expect(new Set(S.filler.pieces.map(p => p.id)).size).toBe(S.filler.pieces.length);
  });
});

describe('derived display treatment (no product pictures behind the stock)', () => {
  it('removes every picture part and keeps the carcass', () => {
    for (let v = 0; v < STOCK_THEMES.length; v++) {
      const withModel = displayTreatment('stockShelf', v, stockShelfStock(v), {model: true});
      expect(withModel.length).toBe(1); // the plain back board
      expect(withModel[0].m).toBe('panel');
      const authored = displayTreatment('stockShelf', v, purposePropShape('stockShelf', v)!, {model: false});
      expect(authored.some(p => p.m === 'panel')).toBe(true); // frame keeps its back panel / boards / posts
      expect(authored.filter(p => p.m === 'steelBright').length).toBe(4);
      for (const p of [...withModel, ...authored]) expect(PICTURE_MATS.has(p.m), `stockShelf/${v} ${p.m}`).toBe(false);
    }
    for (const kind of PURPOSE_PROP_KINDS) {
      for (let v = 0; v < 3; v++) {
        const parts = displayTreatment(kind, v, purposePropShape(kind, v) ?? [], {model: false});
        if (isStockedKind(kind)) for (const p of parts) expect(PICTURE_MATS.has(p.m), `${kind}/${v} keeps ${p.m}`).toBe(false);
      }
    }
    expect(displayTreatment('breadRack', 0, purposePropShape('breadRack', 0)!, {model: false}).filter(p => p.m === 'steelDark').length).toBe(5);
    expect(AUTHORED_CARCASS.has('magazineRack')).toBe(true);
  });

  it('the storefront builder renders the derived carcass: no picture meshes, the magazine rack model is not used', () => {
    for (const seed of SEEDS) {
      const layout = generateStation(seed);
      const group = new THREE.Group();
      const instanced: string[] = [];
      buildStorefronts(group, layout, {
        mat: k => new THREE.MeshStandardMaterial({name: `stub-${k}`}),
        models: {shelf: {scene: new THREE.Group()} as never, magazineRack: {scene: new THREE.Group()} as never, techDisplay: {scene: new THREE.Group()} as never},
        instanceModel: (_g, _m, list, _f, name) => { instanced.push(name); return list.length; },
      });
      const names: string[] = [];
      group.traverse(o => { if ((o as THREE.Mesh).isMesh) names.push(o.name); });
      for (const n of names) for (const m of PICTURE_MATS) expect(n.endsWith(`|${m}`), `${seed}: ${n}`).toBe(false);
      expect(instanced).not.toContain('magazineRack');
      if (layout.props.some(p => p.kind === 'stockShelf')) expect(instanced).toContain('stockShelf-frame');
    }
  });
});

describe('filler is environmental dressing, never loot', () => {
  it('no targeting, prompt, highlight, glint or inventory path reaches a filler piece', async () => {
    const {stock, cm, layout} = await stockedStation(9001);
    // the stock is its own group: never under the loot display / pickups / container meshes
    const lootNames: string[] = [];
    cm.group.traverse(o => lootNames.push(o.name));
    stock.group.traverse(o => expect(lootNames.includes(o.name) && o.name !== '').toBe(false));
    // one shared, non-emissive material (no glow / glint / highlight copies)
    const mat = stockMaterial();
    expect(mat.emissive.getHex()).toBe(0);
    stock.group.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) expect(m.material).toBe(mat); });
    // aim at every 7th piece from 1.2 m in front: the container target is a real lot (a holder's finite list) or the holder body, never a piece
    const levels = (await import('../src/gen/levels')).levelsOf(layout);
    let aimed = 0;
    for (let i = 0; i < stock.filler.pieces.length; i += 7) {
      const p = stock.filler.pieces[i];
      const h = stock.holders[p.holder];
      const f = new THREE.Vector3(Math.sin(h.prop.rot), 0, Math.cos(h.prop.rot));
      const eye = p.p.clone().addScaledVector(f, 1.2).add(new THREE.Vector3(0, 0.25, 0));
      const dir = p.p.clone().sub(eye).normalize();
      const t = cm.target(eye, dir, levels);
      if (t?.lot) expect(cm.holderFor(t.container.prop)?.state.lots.includes(t.lot)).toBe(true);
      const inBox = Math.abs(p.p.x - h.prop.x) < h.prop.hx && Math.abs(p.p.z - h.prop.z) < h.prop.hz && p.p.y < h.prop.y + h.prop.h;
      if (t && !t.lot && inBox && cm.holderFor(h.prop)) expect(t.container.prop).toBe(h.prop); // a shelf's stock = its holder body, as before
      aimed++;
    }
    expect(aimed).toBeGreaterThan(100);
    // a stocked non-holder (flower stand / magazine rack) has no [E] target at all
    const deco = stock.holders.find(h => h.kind === 'flowerStand' || h.kind === 'magazineRack');
    if (deco) {
      const p = stock.filler.pieces[deco.first];
      const f = new THREE.Vector3(Math.sin(deco.prop.rot), 0, Math.cos(deco.prop.rot));
      const eye = p.p.clone().addScaledVector(f, 1.0);
      expect(cm.target(eye, p.p.clone().sub(eye).normalize(), levels)).toBe(null);
    }
    // loot holders keep exactly their rolled finite lots; stock is not a lot
    const lots = cm.all.reduce((n, h) => n + h.state.lots.length, 0);
    expect(lots).toBe(cm.all.reduce((n, h) => n + h.state.rolled, 0));
    expect(ContainerManager.prototype.target.length).toBeGreaterThan(0);
  });
});

describe('QA setup hook (__LL.goStockedShelf)', () => {
  it('finds a stand point in front of stocked shelving on every level that has stock (narrow lower-level rooms too)', async () => {
    const {levelsOf} = await import('../src/gen/levels');
    const {codeToSeed} = await import('../src/core/rng');
    for (const seed of [codeToSeed('1A2B3C')!, ...SEEDS]) {
      const {layout, stock} = await stockedStation(seed);
      const L = levelsOf(layout);
      const levels = new Set(stock.holders.filter(h => h.count > 0).map(h => h.level));
      for (const level of [undefined, ...levels]) {
        const t = stock.shelfTarget({level, free: (s, a) => qaStandFree(L, s, a)});
        expect(t, `seed ${seed} level ${level}`).not.toBe(null);
        if (level !== undefined) expect(t!.holder.level).toBe(level);
        expect(t!.pieces).toBeGreaterThanOrEqual(2);
        expect(qaStandFree(L, t!.stand, t!.aim)).toBe(true);
        expect(Math.abs(t!.stand.y - t!.holder.prop.y)).toBeLessThan(0.01); // its own storey
      }
    }
  });
});

describe('rendering budgets', () => {
  it('bounded pieces, draw calls, triangles and memory per station; merged rest meshes', async () => {
    for (const seed of SEEDS) {
      const {stock} = await stockedStation(seed);
      const s = stock.stats();
      expect(s.pieces).toBeLessThanOrEqual(MAX_STOCK_PER_STATION);
      expect(s.pieces).toBeGreaterThan(1500);
      expect(s.drawCalls.chunks).toBeLessThanOrEqual(40); // one merged mesh per (level, 18 m chunk)
      expect(s.drawCalls.moving).toBe(0);
      expect(s.triangles).toBeLessThan(320_000);
      expect(s.geometryMB).toBeLessThan(14);
      expect(s.textureMB).toBeLessThan(6);
      for (const shop of s.shops) expect(shop.chunks).toBeLessThanOrEqual(4);
      // every rest mesh: one material, one draw call
      let meshes = 0;
      stock.group.traverse(o => { if ((o as THREE.Mesh).isMesh) { meshes++; expect(Array.isArray((o as THREE.Mesh).material)).toBe(false); } });
      expect(meshes).toBe(s.drawCalls.chunks);
    }
  });
});

export type {PropPlacement};
