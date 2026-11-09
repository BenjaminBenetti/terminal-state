// Task studio-food-shelf-production-20261109-002816-01 (lane SHELF): the 27 Meshy-modelled ruined shelf props as filler stock —
// mapping coverage, real size / physics classes, the batching (one extra rest mesh per chunk, detach to an instanced set, rejoin
// in place), determinism (the layout never depends on whether the atlas loaded), storage shelving and loot neutrality.
// Without the cooked atlas a synthetic one (one mesh node per prop id, one shared material) drives the render path; once the cook
// delivered shelf-junk-atlas.glb the same checks run against the real file too.
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import * as THREE from 'three';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {installStockCanvas, loadModel, stockProp, stockedStation} from './helpers/stockHelpers';
import {generateStation} from '../src/gen/station';
import {CATEGORY_STOCK, MAX_STOCK_PER_STATION, STOCK_ARCHES, stockCategory, type StockCategory} from '../src/world/shelfStockCatalog';
import {JUNK_PROPS, SHELF_JUNK_KEY, junkArchId, junkAtlasCooked, junkDims, junkNode, junkPart} from '../src/world/shelfJunkModels';
import {archGeometry, junkSet, stockMaterial} from '../src/world/shelfStockGeometry';
import {ShelfStock, shelfJunkModelKeysFor} from '../src/world/shelfStock';
import {LOW_DECK_Y, dressHolder, holderStockSeed, obbBoxOverlap, obbOverlap, placementOBB} from '../src/world/shelfStockLayout';
import {SHELF_JUNK_ATLAS} from '../src/assets/foodShelfModels.generated';
import {PhysicsSystem} from '../src/physics/world';
import {FLOOR, Grid, SOLID} from '../src/gen/grid';
import {ContainerManager} from '../src/world/containers';

let uninstall: () => void = () => {};
let shelf: GLTF, techDisplay: GLTF;
beforeAll(async () => { uninstall = await installStockCanvas(false); shelf = await loadModel('shelf.glb'); techDisplay = await loadModel('tech-display.glb'); });
afterAll(() => uninstall());

const SEEDS = [9001, 424242, 24839];
const ARCH = (id: string) => STOCK_ARCHES.findIndex(a => a.id === id);
const FOOD_CATS: ReadonlySet<StockCategory> = new Set(['snacks', 'grocery', 'drinks', 'juice', 'bread', 'pastry', 'pantry', 'fruit']);

/** A stand-in atlas: one box mesh per prop id (named like the cooked nodes), offset / scaled / turned, all on ONE material. */
function syntheticAtlas(): {gltf: GLTF; material: THREE.MeshStandardMaterial} {
  const material = new THREE.MeshStandardMaterial({name: 'shelf-junk-atlas'});
  const scene = new THREE.Group();
  JUNK_PROPS.forEach((j, i) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1, 2, 2, 2), material);
    m.name = junkNode(j.id);
    m.position.set(i * 1.5, 2, -3);
    m.scale.set(0.3 + i * 0.01, 0.5, 0.2);
    scene.add(m);
  });
  return {gltf: {scene} as unknown as GLTF, material};
}

const ATLAS_FILE = fileURLToPath(new URL(`../public/${SHELF_JUNK_ATLAS.url}`, import.meta.url));
const cooked = junkAtlasCooked() && existsSync(ATLAS_FILE);

function hall(props: ReturnType<typeof stockProp>[], seed = 77) {
  const g = new Grid(48, 32);
  for (let y = 0; y < 32; y++) for (let x = 0; x < 48; x++) g.set(x, y, x < 2 || y < 2 || x >= 46 || y >= 30 ? SOLID : FLOOR);
  return {grid: g, props, trench: {floorY: -1.15}, areas: [{purpose: 'grocery'}], seed};
}

describe('the 27 ruined props are filler archetypes', () => {
  it('each P01..P27 is exactly one model-backed archetype, used by at least one category; non-food junk never in food shops', () => {
    expect(JUNK_PROPS.map(j => j.id)).toEqual(Array.from({length: 27}, (_, i) => `P${String(i + 1).padStart(2, '0')}`));
    const used = new Map<string, Set<StockCategory>>();
    for (const [cat, rows] of Object.entries(CATEGORY_STOCK) as [StockCategory, readonly (readonly [string, number])[]][]) {
      for (const [id] of rows) { const A = STOCK_ARCHES[ARCH(id)]; expect(A, id).toBeTruthy(); if (A.model) { let s = used.get(A.model); if (!s) used.set(A.model, (s = new Set())); s.add(cat); } }
    }
    for (const j of JUNK_PROPS) {
      const arches = STOCK_ARCHES.filter(a => a.model === j.id);
      expect(arches.length, j.id).toBe(1);
      expect(arches[0].id).toBe(junkArchId(j));
      expect(used.get(j.id)?.size ?? 0, `${j.id} ${j.slug} unused`).toBeGreaterThan(0);
      // non-food storage / maintenance / office junk: cleaning / parts / storage / office / devices shelving, never a food shop or pantry
      if (j.family === 'junk') for (const c of used.get(j.id)!) expect(FOOD_CATS.has(c), `${j.slug} in ${c}`).toBe(false);
      // spoiled groceries (the wrapper cluster is generic trash) stay with food
      if (j.family === 'food' && j.id !== 'P11') for (const c of used.get(j.id)!) expect(FOOD_CATS.has(c), `${j.slug} in ${c}`).toBe(true);
    }
    // archetype ids are append-only: the authored ones keep their indices (the model ones follow bottleBroken)
    expect(STOCK_ARCHES[ARCH('bottleBroken') + 1].model).toBe('P01');
    expect(STOCK_ARCHES.slice(0, ARCH('bottleBroken') + 1).every(a => !a.model)).toBe(true);
  });

  it('real size (the cooked registry when present), plausible colliders / masses / materials; the fallback stays in its box', () => {
    for (const j of JUNK_PROPS) {
      const A = STOCK_ARCHES[ARCH(junkArchId(j))];
      expect([A.w, A.h, A.d]).toEqual(junkDims(j));
      const part = junkPart(j.id);
      // (a part laid on its back here — the blister card — swaps its height and depth)
      const [ph, pd] = j.layFlat ? [A.d, A.h] : [A.h, A.d];
      if (part) { expect(Math.abs(ph - part.h)).toBeLessThan(0.0011); if (j.collider === 'box') { expect(Math.abs(A.w - part.w)).toBeLessThan(0.0011); expect(Math.abs(pd - part.d)).toBeLessThan(0.0011); } }
      // the reference measure of the plan (the cook scales to it): within 15 % (rounding)
      const ref = j.ref.axis === 'h' ? ph : j.ref.axis === 'd' ? pd : Math.max(A.w, pd);
      expect(Math.abs(ref - j.ref.m) / j.ref.m, `${j.id} ${j.ref.axis}`).toBeLessThan(0.15);
      const f = A.fit ?? [1, 1, 1];
      const vol = A.w * f[0] * A.h * f[1] * A.d * f[2];
      const rho = A.mass / vol;
      expect(rho, `${j.slug} density`).toBeGreaterThan(5);
      expect(rho, `${j.slug} density`).toBeLessThan(2000);
      if (A.hit === 'cardboard') expect(A.mass, j.slug).toBeLessThan(2.6);
      const g = archGeometry(ARCH(junkArchId(j)), 0).boundingBox!;
      expect(g.min.y).toBeGreaterThanOrEqual(-1e-4); expect(g.max.y).toBeLessThanOrEqual(A.h + 1e-4);
      expect(Math.max(-g.min.x, g.max.x)).toBeLessThanOrEqual(A.w / 2 + 1e-4); expect(Math.max(-g.min.z, g.max.z)).toBeLessThanOrEqual(A.d / 2 + 1e-4);
    }
    const m = (slug: string) => STOCK_ARCHES[ARCH(`junk_${slug}`)];
    expect(m('retail_carton').mass).toBeLessThan(m('paint_tin').mass); // a cardboard carton is light, a paint tin heavy
    expect(m('wrapper_cluster').mass).toBeLessThan(m('rusty_tins').mass);
    expect(m('paint_tin').mat).toBe('metal'); expect(m('mould_jar').mat).toBe('glass'); expect(m('rag_bundle').mat).toBe('cloth'); expect(m('rotten_fruit_crate').mat).toBe('wood');
    // heavy bulk goods stand on bottom decks only; the thin blister card lies flat (stable), never on its edge
    for (const s of ['flour_sack', 'potato_sack', 'rotten_fruit_crate']) expect(m(s).low, s).toBe(true);
    expect(m('blister_card').layFlat).toBe(true);
    expect(m('blister_card').h).toBeLessThan(m('blister_card').d);
  });

  it('every prop is actually dressed on some stocked holder at its real size (the shipping box fits no deck: never placed)', async () => {
    const deck = (await import('../src/world/shelfStock')).shelfDecks(shelf);
    const wall = (await import('../src/world/shelfStock')).deviceWallDeck(techDisplay);
    const {stockBoards} = await import('../src/world/shelfStockCarcass');
    const {STOCK_THEMES} = await import('../src/gen/purposeShapes');
    const cases: [string, number, string | undefined, unknown][] = [
      ...STOCK_THEMES.map((_, v) => ['stockShelf', v, undefined, deck] as [string, number, undefined, unknown]),
      ...['storage', 'office-storage', 'janitor-closet', 'workshop', 'ramen-kitchen'].map(p => ['shelf', 0, p, deck] as [string, number, string, unknown]),
      ['shopCooler', 0, 'convenience', null], ['shopCooler', 0, 'juice', null], ['breadRack', 0, 'bakery', null], ['breadRack', 1, 'donut', null],
      ['snackRack', 0, 'newsstand', null], ['repairBench', 0, 'keys', null], ['repairBench', 1, 'phone', null], ['deviceWall', 0, 'tech', wall],
    ];
    const placed = new Set<string>();
    for (const [kind, v, purpose, d] of cases) {
      const boards = stockBoards(kind, v, {deck: d as never});
      for (let seed = 0; seed < 40; seed++) for (const p of dressHolder({category: stockCategory(kind, v, purpose)!, boards, lots: [], seed})) { const m = STOCK_ARCHES[p.arch].model; if (m) placed.add(m); }
    }
    // P14 at the cooked size (0.55 x 0.47 x 0.34 m) is taller than every bay and deeper than every shelf deck: it stands on top of
    // storage units (UNIT_TOP) only
    const inBays = JUNK_PROPS.map(j => j.id).filter(id => !placed.has(id));
    expect(inBays).toEqual(junkPart('P14') && junkPart('P14')!.h > 0.45 ? ['P14'] : []);
    const boards = stockBoards('shelf', 0, {deck: deck as never});
    for (let seed = 0; seed < 40; seed++) for (const p of dressHolder({category: 'storage', boards, lots: [], seed, unitTop: {board: boards.length - 1, clear: 1}})) { const m = STOCK_ARCHES[p.arch].model; if (m) placed.add(m); }
    expect(JUNK_PROPS.map(j => j.id).filter(id => !placed.has(id))).toEqual([]);
  });

  it('the atlas is a lazy model of levels with stock (never fetched while the registry is the stub)', () => {
    const layout = generateStation(9001);
    expect(shelfJunkModelKeysFor(layout)).toEqual(junkAtlasCooked() ? [SHELF_JUNK_KEY] : []);
    expect(shelfJunkModelKeysFor({props: [{kind: 'bench'}, {kind: 'desk'}]})).toEqual([]);
  });
});

describe('batching: merged per chunk, detached to instancing, rejoined at rest', () => {
  it('with the atlas: at most one extra rest mesh per chunk on the shared material; the layout is identical without it', async () => {
    const {gltf, material} = syntheticAtlas();
    for (const seed of SEEDS) {
      const layout = generateStation(seed);
      const A = new ShelfStock(), B = new ShelfStock();
      A.build(layout, {models: {shelf, techDisplay}});
      B.build(layout, {models: {shelf, techDisplay, [SHELF_JUNK_KEY]: gltf}});
      const sig = (S: ShelfStock) => S.filler.pieces.map(p => `${S.pieceInfo(p.id).arch}@${p.p.x.toFixed(4)},${p.p.y.toFixed(4)},${p.p.z.toFixed(4)}`).join('|');
      expect(sig(B)).toBe(sig(A)); // same pieces, poses and bodies whether the atlas loaded or not
      const s = B.stats(), a = A.stats();
      expect(s.junk.loaded).toBe(true);
      expect(s.junk.modelPieces).toBe(s.junk.pieces); // every model archetype found its node
      expect(s.junk.modelPieces).toBeGreaterThan(200);
      expect(Object.keys(s.junk.byModel).length).toBeGreaterThan(15);
      expect(a.drawCalls.junk).toBe(0);
      // one authored + at most one modelled rest mesh per (level, chunk): draw calls bounded by chunks, never by pieces
      const spatial = new Set<string>(), meshes: THREE.Mesh[] = [];
      B.group.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh && !(m as THREE.InstancedMesh).isInstancedMesh) { meshes.push(m); spatial.add(m.name.replace(/^shelf-(stock|junk)-/, '')); } });
      expect(meshes.length).toBe(s.drawCalls.chunks + s.drawCalls.junk);
      expect(s.drawCalls.junk).toBeLessThanOrEqual(spatial.size);
      expect(s.drawCalls.chunks).toBeLessThanOrEqual(40);
      for (const m of meshes) expect(m.material).toBe(m.name.startsWith('shelf-junk-') ? material : stockMaterial());
      expect(s.drawCalls.moving).toBe(0);
      expect(s.pieces).toBeLessThanOrEqual(MAX_STOCK_PER_STATION);
      // every modelled piece's vertices sit in a junk mesh, inside its own collider box at its pose
      for (const p of B.filler.pieces) {
        const r = B.restRange(p.id), info = B.pieceInfo(p.id);
        expect(r.family === 1, info.arch).toBe(!!info.model);
        if (!r.family || p.id % 9) continue;
        const P = r.mesh.geometry.attributes.position.array as Float32Array, box = new THREE.Box3();
        for (let i = r.start; i < r.start + r.count; i++) box.expandByPoint(new THREE.Vector3(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]));
        expect(box.getCenter(new THREE.Vector3()).distanceTo(p.p), info.arch).toBeLessThan(0.002);
      }
      // the modelled moving sets are prepared hidden for the warm-up (one per archetype present, the shared material)
      const roots = B.warmRoots() as THREE.InstancedMesh[];
      expect(roots.length).toBe(Object.keys(s.junk.byModel).length);
      for (const r of roots) { expect(r.isInstancedMesh).toBe(true); expect(r.visible).toBe(false); expect(r.count).toBe(0); expect(r.material).toBe(material); }
      expect(A.warmRoots().length).toBe(0);
    }
  });

  it('a shot model piece leaves its chunk, moves instanced, settles back into the same rest mesh (no ghost, no duplicate)', () => {
    const {gltf, material} = syntheticAtlas();
    const sh = stockProp('stockShelf', 8, 3, {variant: 1});
    const L = hall([sh], 2024);
    const ph = new PhysicsSystem(null, null);
    ph.build(L as never);
    const S = new ShelfStock();
    S.filler.attach(ph);
    ph.holderBoxes = p => S.physicsBoxes(p, null);
    S.build(L as never, {models: {shelf, [SHELF_JUNK_KEY]: gltf}});
    const target = S.filler.pieces.find(p => S.pieceInfo(p.id).model && S.holders[0].placements[p.id].board === 1 && S.holders[0].placements[p.id].on < 0)!;
    expect(target).toBeTruthy();
    const r = S.restRange(target.id), P = r.mesh.geometry.attributes.position.array as Float32Array;
    const meshesBefore = S.group.children.length;
    expect(S.filler.shoot(target, target.p.clone().add(new THREE.Vector3(0, 0, 0.03)), new THREE.Vector3(0, 0.1, -1).normalize(), 6)).toBe(true);
    // collapsed out of the chunk: every vertex of its range on one point (zero-area: nothing drawn twice)
    for (let i = r.start + 1; i < r.start + r.count; i++) for (let k = 0; k < 3; k++) expect(P[i * 3 + k]).toBe(P[r.start * 3 + k]);
    ph.update(1 / 60);
    const moving = S.group.children.filter(o => (o as THREE.InstancedMesh).isInstancedMesh && o.visible) as THREE.InstancedMesh[];
    const mine = moving.find(m => m.name === `shelf-junk-moving-${S.pieceInfo(target.id).arch}`)!;
    expect(mine && mine.count).toBeGreaterThanOrEqual(1);
    expect(mine.material).toBe(material);
    expect(S.stats().drawCalls.moving).toBeGreaterThanOrEqual(1);
    expect(S.group.children.length).toBe(meshesBefore); // its set was prepared at build: nothing created on first use
    for (let f = 0; f < 60 * 10; f++) ph.update(1 / 60);
    expect(S.filler.awake + S.filler.stats().frozen).toBe(0);
    expect(target.p.distanceTo(target.home)).toBeGreaterThan(0.05);
    // rejoined in place: its vertices rewritten at the settled pose in the same rest mesh, the moving sets empty again
    expect(S.restRange(target.id).mesh).toBe(r.mesh);
    const box = new THREE.Box3();
    for (let i = r.start; i < r.start + r.count; i++) box.expandByPoint(new THREE.Vector3(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]));
    expect(box.getCenter(new THREE.Vector3()).distanceTo(target.p)).toBeLessThan(0.002);
    expect(S.stats().drawCalls.moving).toBe(0);
    expect(S.filler.pieces.length).toBe(S.holders[0].count);
    expect(new Set(S.filler.pieces.map(p => p.id)).size).toBe(S.filler.pieces.length);
  });
});

describe('top-of-unit boxes (storage / stock-room shelving)', () => {
  const BIG = new Set(['junk_shipping_box', 'junk_torn_carton', 'junk_rotten_fruit_crate']);
  it('the shipping box stands on top of storage units: under the ceiling headroom, at most 2 per unit, clear of lots, decor and the model', async () => {
    const {fittedTriangles} = await import('../src/world/shelfStock');
    const {triangleHitsOBB} = await import('./helpers/stockHelpers');
    const {levelsOf} = await import('../src/gen/levels');
    const {UNIT_TOP, obbExtent} = await import('../src/world/shelfStockLayout');
    const tris = fittedTriangles(shelf, 1.2, 1.85, 0.45);
    let shipping = 0, units = 0;
    for (const seed of SEEDS) {
      const {stock, layout} = await stockedStation(seed);
      const L = levelsOf(layout);
      for (const h of stock.holders) {
        const tb = h.boards.length - 1;
        const tops = h.placements.filter(p => p.board === tb && BIG.has(STOCK_ARCHES[p.arch].id) && STOCK_ARCHES[p.arch].h > h.boards[tb].top - h.boards[tb].y);
        if (!tops.length) continue;
        // only storage shelving and back-of-house stock shelving, on their top deck, with the measured headroom
        expect(h.kind === 'shelf' || (h.kind === 'stockShelf' && h.shop === undefined), h.kind).toBe(true);
        expect(h.unitTop?.board).toBe(tb);
        expect(tops.length).toBeLessThanOrEqual(UNIT_TOP.max);
        units++;
        const ceil = L.ceilingOver(h.prop.x, h.prop.z, Math.max(h.prop.hx, h.prop.hz), h.prop.y + 0.05);
        for (const p of tops) {
          const A = STOCK_ARCHES[p.arch], o = placementOBB(p), e = obbExtent(o);
          if (A.id === 'junk_shipping_box') shipping++;
          expect(h.prop.y + p.c[1] + e[1] + UNIT_TOP.headroom).toBeLessThanOrEqual(ceil + 1e-6); // the ceiling leaves room
          const deckY = h.boards[tb].deck!(p.c[0] - e[0], p.c[2] - e[2], p.c[0] + e[0], p.c[2] + e[2]);
          expect(p.c[1] - e[1] - deckY).toBeGreaterThan(-0.001); expect(p.c[1] - e[1] - deckY).toBeLessThan(0.0045); // seated on the top deck
          for (const b of h.blockers) expect(obbBoxOverlap(o, b, 0), `${A.id} over a lot / decor`).toBe(false);
          for (const q of h.placements) if (q !== p) expect(obbOverlap(o, placementOBB(q), 0)).toBe(false);
          // never inside the shelf model (posts, lips, braces): the deeper top deck is clear
          const ob = placementOBB(p, 0.002), oe = obbExtent(ob);
          for (let t = 0; t < tris.length; t += 9) {
            const a: [number, number, number] = [tris[t], tris[t + 1], tris[t + 2]], b2: [number, number, number] = [tris[t + 3], tris[t + 4], tris[t + 5]], c: [number, number, number] = [tris[t + 6], tris[t + 7], tris[t + 8]];
            if (Math.max(a[1], b2[1], c[1]) < ob.c[1] - oe[1] || Math.min(a[0], b2[0], c[0]) > ob.c[0] + oe[0] || Math.max(a[0], b2[0], c[0]) < ob.c[0] - oe[0]) continue;
            expect(triangleHitsOBB(a, b2, c, ob), `${A.id} in the shelf model`).toBe(false);
          }
        }
      }
    }
    expect(units).toBeGreaterThan(10);
    expect(shipping).toBeGreaterThan(10); // P14 is placed on every seed's stock rooms
  });

  it('own RNG fork: every other board of the unit dresses exactly as without the top boxes; no headroom, no boxes', async () => {
    const deck = (await import('../src/world/shelfStock')).shelfDecks(shelf);
    const {stockBoards} = await import('../src/world/shelfStockCarcass');
    const boards = stockBoards('shelf', 0, {deck});
    const tb = boards.length - 1;
    let boxed = 0;
    for (let seed = 1; seed < 30; seed++) {
      const plain = dressHolder({category: 'storage', boards, lots: [], seed});
      const top = dressHolder({category: 'storage', boards, lots: [], seed, unitTop: {board: tb, clear: 1.2}});
      const sig = (l: typeof plain) => l.filter(p => p.board !== tb).map(p => `${p.arch}:${p.c.map(v => v.toFixed(5))}`).join('|');
      expect(sig(top)).toBe(sig(plain));
      if (top.some(p => STOCK_ARCHES[p.arch].id === 'junk_shipping_box')) boxed++;
      // a low ceiling (0.4 m over the top deck): nothing taller than its headroom goes up there
      const low = dressHolder({category: 'storage', boards, lots: [], seed, unitTop: {board: tb, clear: 0.4}});
      for (const p of low.filter(q => q.board === tb)) expect(STOCK_ARCHES[p.arch].h).toBeLessThanOrEqual(0.35);
    }
    expect(boxed).toBeGreaterThan(5);
  });
});

describe('storage shelving, hosted props, determinism and loot', () => {
  it('storage / closet / workshop shelving is stocked with the junk of its room; never a lot or a prop standing on it', async () => {
    let shelves = 0;
    const cats = new Set<string>();
    for (const seed of SEEDS) {
      const {stock, cm} = await stockedStation(seed);
      for (const h of stock.holders.filter(x => x.kind === 'shelf')) {
        shelves++;
        cats.add(h.category);
        expect(['storage', 'parts', 'cleaning', 'office', 'pantry', 'pharmacy']).toContain(h.category);
        const lots = cm.holderFor(h.prop)?.state.lots ?? [];
        const {placementBox} = await import('../src/items/lootLayout');
        for (const l of lots) for (const p of h.placements) expect(obbBoxOverlap(placementOBB(p), placementBox(l.itemId, l), 0)).toBe(false);
        for (const p of h.placements) { const A = STOCK_ARCHES[p.arch]; if (A.low && p.board !== h.unitTop?.board) expect(h.boards[p.board].y).toBeLessThanOrEqual(LOW_DECK_Y); } // (bottom decks, or the unit's top)
      }
    }
    expect(shelves).toBeGreaterThan(5);
    expect(cats.size).toBeGreaterThanOrEqual(2);
    // a crate standing on a storage shelf (on-top decor, host index): the dressing keeps clear of it
    const sh = stockProp('shelf', 8, 3);
    const crate = {...stockProp('crate', 8, 3 - 0.02, {y: 0.6}), hx: 0.2, hz: 0.15, h: 0.3, host: 0} as ReturnType<typeof stockProp>;
    const S = new ShelfStock();
    S.build({props: [sh, crate], areas: [{purpose: 'storage'}], seed: 5} as never, {models: {shelf}});
    expect(S.holders.length).toBe(1);
    const lb = {min: [crate.x - crate.hx - sh.x, crate.y, crate.z - crate.hz - sh.z] as [number, number, number], max: [crate.x + crate.hx - sh.x, crate.y + crate.h, crate.z + crate.hz - sh.z] as [number, number, number]};
    expect(S.holders[0].placements.length).toBeGreaterThan(5);
    for (const p of S.holders[0].placements) expect(obbBoxOverlap(placementOBB(p), lb, 0)).toBe(false);
  });

  it('deterministic per holder seed, loot-neutral (no draw from any shared stream), within the station budgets', async () => {
    const {gltf} = syntheticAtlas();
    for (const seed of SEEDS) {
      const layout = generateStation(seed);
      const stubMats = {get: () => new THREE.MeshStandardMaterial(), scale: {}} as unknown as ConstructorParameters<typeof ContainerManager>[1];
      const lotsSig = (cm: ContainerManager) => cm.all.map(h => h.state.lots.map(l => `${l.id}:${l.itemId}x${l.count}`).join(',')).join('|');
      const cm1 = new ContainerManager({}, stubMats, () => null as never); cm1.build(layout);
      const before = lotsSig(cm1);
      const props = JSON.stringify(layout.props);
      const S = new ShelfStock();
      S.build(layout, {models: {shelf, techDisplay, [SHELF_JUNK_KEY]: gltf}, lotsOf: () => []});
      expect(JSON.stringify(layout.props)).toBe(props); // the layout is read, never written
      // each holder's dressing is its own (holder seed): re-dressed alone it is the same
      if (S.thinning === 'none') for (const h of S.holders.filter((_, i) => i % 7 === 0)) {
        const alone = dressHolder({category: h.category, boards: h.boards, lots: h.blockers, seed: h.seed, ...(h.unitTop ? {unitTop: h.unitTop} : {})});
        if (!layout.extensions) expect(h.seed).toBe(holderStockSeed(layout.seed >>> 0, h.kind, h.prop.x, h.prop.z, h.prop.y));
        expect(alone.map(p => `${p.arch}:${p.c.map(v => v.toFixed(5))}`)).toEqual(h.placements.map(p => `${p.arch}:${p.c.map(v => v.toFixed(5))}`));
      }
      const cm2 = new ContainerManager({}, stubMats, () => null as never); cm2.build(layout);
      expect(lotsSig(cm2)).toBe(before); // the stock consumed nothing the loot rolls read
      const T = new ShelfStock();
      T.build(layout, {models: {shelf, techDisplay, [SHELF_JUNK_KEY]: gltf}, lotsOf: () => []});
      expect(T.filler.pieces.map(p => T.pieceInfo(p.id).arch).join()).toBe(S.filler.pieces.map(p => S.pieceInfo(p.id).arch).join());
      const s = S.stats();
      expect(s.triangles).toBeLessThan(320_000);
      expect(s.geometryMB).toBeLessThan(14);
    }
    expect(stockCategory('shelf', 0, 'janitor-closet')).toBe('cleaning');
  });
});

describe.runIf(cooked)('the cooked atlas (shelf-junk-atlas.glb)', () => {
  it('every part is usable on the ONE shared material, fitted to its archetype box; real stations stay within budget', async () => {
    const atlas = await loadModel('shelf-junk-atlas.glb');
    const set = junkSet(atlas)!;
    expect(set).toBeTruthy();
    expect(set.arches.length).toBe(27);
    expect(set.uvShort).toBe(true);
    for (const a of set.arches) {
      const A = STOCK_ARCHES[a], g = set.geometry(a)!;
      const bb = g.boundingBox!;
      expect(bb.min.y).toBeCloseTo(0, 4); expect(bb.max.y).toBeCloseTo(A.h, 4);
      expect(bb.max.x - bb.min.x).toBeCloseTo(A.w, 3); expect(bb.max.z - bb.min.z).toBeCloseTo(A.d, 3);
      expect(g.index!.count / 3).toBeLessThanOrEqual((junkPart(A.model!)?.tris ?? Infinity) + 1);
    }
    for (const seed of SEEDS) {
      const layout = generateStation(seed);
      const S = new ShelfStock();
      S.build(layout, {models: {shelf, techDisplay, [SHELF_JUNK_KEY]: atlas}});
      const s = S.stats();
      expect(s.junk.modelPieces).toBe(s.junk.pieces);
      expect(s.triangles).toBeLessThan(320_000);
      expect(s.geometryMB).toBeLessThan(14);
      expect(s.drawCalls.chunks).toBeLessThanOrEqual(40);
      expect(s.drawCalls.junk).toBeLessThanOrEqual(40);
    }
  });
});
