// Iteration 08 (Lane S): REAL 3D SHELF STOCK. Every stocked holder of the station (retail shelving,
// snack racks, drinks coolers, magazine racks, flower stands, bread racks, repair benches and the
// key-cutting wall, electronics wall bays, juice-bar fruit crates) is
// dressed with genuinely separate filler pieces (world/shelfStockLayout.ts) on its real boards
// (world/shelfStockCarcass.ts derives the carcass without the old product-picture facades), drawn
// from authored packaging (world/shelfStockGeometry.ts: one atlas, one material).
//
// Rendering: resting pieces are baked into ONE merged mesh per (level, 18 m chunk) — one draw call
// per chunk however many pieces stand there, frustum-culled per chunk. A piece that starts moving is
// collapsed out of its chunk (its vertex range degenerates; partial buffer upload) and drawn by a
// small instanced mesh per (archetype, label) while it moves; when it settles its vertices are
// rewritten in place at the new pose. Physics: physics/fillerStock.ts.
//
// Iteration 12 (LOOT lane): ~30 years on, most of it is boxes, trash and broken / spoiled goods, aged and tarnished
// (world/shelfStockCatalog.ts StockLook, world/shelfStockGeometry.ts aging), so the few real finds stand out.
//
// Filler is NOT loot: no pickup, no highlight / glint, no inventory entry, no [E] prompt — the
// targeting code (world/containers.ts, world/pickups.ts) only ever sees real lots and pickups, and
// filler never appears in either list. Real loot lots keep their own models / glow / finite ids and
// are never covered (the dresser stops facings short of them).
//
// Task studio-food-shelf-production-20261109-002816-01 (lane SHELF): MODEL-BACKED filler — the 27 Meshy-modelled ruined props
// (world/shelfJunkModels.ts: spoiled groceries, ruined boxes / packaging, non-food storage / maintenance / office junk) replace the
// crude authored packaging where they correspond (world/shelfStockCatalog.ts CATEGORY_STOCK). They come as ONE atlas GLB (one mesh
// node per prop, ONE shared material with Meshy's own maps), a lazy per-level model (deps.models[SHELF_JUNK_KEY]); until it is
// loaded (or if it fails) each draws its procedural fallback at the same box — same layout, same bodies. The SAME batching, narrowly
// extended: a chunk's resting model pieces merge into ONE extra mesh per (level, chunk) beside its authored-filler mesh (two draw
// calls per chunk at most, however many pieces), a moving model piece collapses out of it into an instanced mesh per archetype
// (same shared material; prepared at build so the warm-up compiles it: warmRoots) and is written back in place when it settles.
// Storage shelving ('shelf' kind: storage / stock rooms, closets, workshops, office storage) is stocked too, and props standing on a
// holder (on-top decor, crates on shelves) are kept clear like real lots. Station-wide bounds: pieces, triangles, geometry bytes.

import * as THREE from 'three';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {PROP_DEFS, SHELF_TIER_Y, type PropPlacement} from '../gen/props';
import type {StationLayout} from '../gen/station';
import type {Levels} from '../gen/levels';
import {DAMAGE_MATERIALS} from '../damage/materials';
import type {Vec3} from '../combat/hitscan';
import {MAX_STOCK_GEOMETRY_BYTES, MAX_STOCK_PER_STATION, MAX_STOCK_TRIANGLES, STOCK_ARCHES, isStockedKind, stockCategory, type StockCategory} from './shelfStockCatalog';
import {dressHolder, holderStockSeed, type Board, type Box3Like, type StockPlacement} from './shelfStockLayout';
import {DEVICE_WALL_DECK, measureDecks, stockBoards, stockColliders, toWorldBoxes, type DeckSampler} from './shelfStockCarcass';
import {archCost, archGeometry, archTriangles, junkSet, stockMaterial, stockTextureBytes, type JunkSet} from './shelfStockGeometry';
import {SHELF_JUNK_KEY, SHELF_JUNK_MODEL_FILES, junkAtlasCooked} from './shelfJunkModels';
import {FILLER_TUNING, FillerStock, type FillerHit, type FillerPiece, type FillerSpec, type FillerView} from '../physics/fillerStock';

export {SHELF_JUNK_KEY, SHELF_JUNK_MODEL_FILES};

/**
 * Game.sectionModelKeys hook (task food-shelf-production, lane SHELF): the lazy atlas of the modelled ruined props, for a layout
 * with stockable holders once the cook delivered it (the stub registry asks for nothing). Never fetched for a level without stock.
 */
export function shelfJunkModelKeysFor(layout: {props: readonly {kind: string}[]}): string[] {
  return junkAtlasCooked() && layout.props.some(p => isStockedKind(p.kind)) ? [SHELF_JUNK_KEY] : [];
}

/** Rest-mesh family of a piece: 0 = authored filler (label atlas material), 1 = modelled ruined prop (the junk atlas material). */
type Fam = 0 | 1;

/**
 * Iteration 12 (LOOT lane): per-piece grime / fade tint range (was 0.86..1.06): the filler reads dusty and uneven next to the
 * fresh real loot (own models and materials, never tinted).
 */
export const FILLER_TINT = [0.62, 0.9] as const;
/** Render chunk size (m), like builder.ts instanced props. */
const CHUNK = 18;
/** Holders whose front is glass: a pellet reaching their stock also hits the glass. */
const GLAZED = new Set(['shopCooler', 'shopDisplay']);

export interface StockedHolder {
  index: number;
  prop: PropPlacement;
  kind: string;
  category: StockCategory;
  level: number;
  boards: Board[];
  placements: StockPlacement[];
  /** First piece id and piece count. */
  first: number;
  count: number;
  /** World AABBs of its boards / backs (physics). */
  colliders: THREE.Box3[];
  /** Storefront index when the holder stands in a shop. */
  shop?: number;
  area: number;
  /** Render chunk index (-1: nothing stands on it). */
  chunk: number;
}

/** One merged rest mesh of a chunk (one family, one material, one draw call). */
interface ChunkPart {
  mesh: THREE.Mesh;
  pos: THREE.BufferAttribute;
  nor: THREE.BufferAttribute;
  tris: number;
}

interface Chunk {
  key: string;
  level: number;
  /** [authored filler, modelled ruined props]: a part only where the chunk has pieces of that family. */
  parts: [ChunkPart | null, ChunkPart | null];
}

interface DynSet { mesh: THREE.InstancedMesh; cap: number }

export interface StockDeps {
  /** Boot models (shelf, techDisplay) and, when the level fetched it, the ruined-prop atlas (SHELF_JUNK_KEY: Game.propModels). */
  models: Record<string, GLTF | undefined>;
  /** Real loot lots of a holder prop (holder-local AABBs; items/lootLayout.ts placementBox). */
  lotsOf?: (p: PropPlacement) => Box3Like[];
}

/** Moving-set key of an archetype (authored: per label variant; modelled: one per archetype). */
const dynKey = (fam: Fam, arch: number, variant: number) => (fam ? -1 - arch : arch * 64 + variant);

/**
 * Holder-local boxes of the props standing ON a stocked holder (on-top decor, crates on a storage shelf: `host`, or standing
 * inside its footprint above its base) — the dresser keeps them clear like real loot lots (nothing inside or in front of them).
 */
function hostedBoxes(holder: PropPlacement, hi: number, near: readonly {p: PropPlacement; i: number}[]): Box3Like[] {
  const out: Box3Like[] = [];
  const c = Math.cos(holder.rot), s = Math.sin(holder.rot);
  for (const {p: q, i} of near) {
    if (q === holder || q.cargoGone || (q.level ?? 0) !== (holder.level ?? 0)) continue;
    const inside = Math.abs(q.x - holder.x) < holder.hx - 0.02 && Math.abs(q.z - holder.z) < holder.hz - 0.02 && q.y > holder.y + 0.02 && q.y < holder.y + holder.h + 0.05;
    if (q.host !== hi && !inside) continue;
    const min: [number, number, number] = [Infinity, q.y - holder.y, Infinity], max: [number, number, number] = [-Infinity, q.y - holder.y + q.h, -Infinity];
    for (const X of [q.x - q.hx, q.x + q.hx]) for (const Z of [q.z - q.hz, q.z + q.hz]) {
      const dx = X - holder.x, dz = Z - holder.z;
      const lx = dx * c - dz * s, lz = dx * s + dz * c;
      min[0] = Math.min(min[0], lx); max[0] = Math.max(max[0], lx); min[2] = Math.min(min[2], lz); max[2] = Math.max(max[2], lz);
    }
    out.push({min, max});
  }
  return out;
}

export interface StockFx {
  impact?(pos: THREE.Vector3, normal: THREE.Vector3, surface: 'concrete' | 'tile' | 'metal' | 'flesh' | 'wood' | 'glass' | 'soft', opts?: {decal?: boolean; chips?: number; dust?: number}): void;
}
export interface StockSfx {
  impact?(x: number, y: number, z: number, surface: string): void;
}

/** Fitted triangles of a GLB (same fit as builder.addInstancedModel: footprint w/h/d, base at y = 0). 9 floats per triangle. */
export function fittedTriangles(gltf: GLTF, w: number, h: number, d: number): Float32Array {
  const root = gltf.scene;
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
  const fit = new THREE.Matrix4().makeScale(w / size.x, h / size.y, d / size.z).multiply(new THREE.Matrix4().makeTranslation(-c.x, -box.min.y, -c.z));
  const out: number[] = [];
  const v = new THREE.Vector3();
  root.traverse(o => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const m = new THREE.Matrix4().multiplyMatrices(fit, mesh.matrixWorld);
    const pos = mesh.geometry.attributes.position, idx = mesh.geometry.index;
    const n = idx ? idx.count : pos.count;
    for (let i = 0; i < n; i++) {
      v.fromBufferAttribute(pos, idx ? idx.getX(i) : i).applyMatrix4(m);
      out.push(v.x, v.y, v.z);
    }
  });
  return new Float32Array(out);
}

const deckCache = new WeakMap<object, DeckSampler>();
/** Measured deck heightmaps of the generated shelf model (cached per loaded model). */
export function shelfDecks(shelf: GLTF): DeckSampler {
  let d = deckCache.get(shelf);
  if (!d) {
    const {w, h, d: dd} = PROP_DEFS.stockShelf;
    d = measureDecks(fittedTriangles(shelf, w, h, dd), SHELF_TIER_Y, w, dd, h);
    deckCache.set(shelf, d);
  }
  return d;
}

/** Measured deck of the generated electronics wall bay (tech-display.glb fitted to the deviceWall footprint), cached. */
export function deviceWallDeck(model: GLTF): DeckSampler {
  let d = deckCache.get(model);
  if (!d) {
    const {w, h, d: dd} = PROP_DEFS.deviceWall;
    d = measureDecks(fittedTriangles(model, w, h, dd), [DEVICE_WALL_DECK.y], w, dd, h, DEVICE_WALL_DECK.rect);
    deckCache.set(model, d);
  }
  return d;
}

/**
 * QA stand-point check (__LL.goStockedShelf): a body of radius 0.3 can stand there on a floor at about the
 * holder's height (its own storey), and the eye 1.6 m above that floor sees the aim point (walls, slabs and
 * sight-blocking props block).
 */
export function qaStandFree(L: Levels, stand: THREE.Vector3, aim: THREE.Vector3): boolean {
  const sup = L.supportIn(stand.x, stand.z, stand.y + 0.3);
  if (!sup || Math.abs(sup.floor - stand.y) > 0.3 || !L.grid(sup.level).passable(...L.main.cellOf(stand.x, stand.z))) return false;
  if (!L.circleClear(stand.x, stand.z, 0.3, sup.floor)) return false;
  return L.lineOfSight({x: stand.x, y: sup.floor + 1.6, z: stand.z}, {x: aim.x, y: aim.y, z: aim.z}, {slack: 0.3});
}

/** Ray parameter where a ray leaves a prop's AABB. */
function exitT(o: Vec3, d: Vec3, p: PropPlacement): number {
  let tmax = Infinity;
  const lo = [p.x - p.hx, p.y, p.z - p.hz], hi = [p.x + p.hx, p.y + p.h, p.z + p.hz], O = [o.x, o.y, o.z], D = [d.x, d.y, d.z];
  for (let a = 0; a < 3; a++) {
    if (Math.abs(D[a]) < 1e-12) continue;
    const t1 = (lo[a] - O[a]) / D[a], t2 = (hi[a] - O[a]) / D[a];
    tmax = Math.min(tmax, Math.max(t1, t2));
  }
  return tmax;
}

const UP = new THREE.Vector3(0, 1, 0);
const tm = new THREE.Matrix4(), tm2 = new THREE.Matrix4(), tv = new THREE.Vector3(), tq = new THREE.Quaternion(), ts = new THREE.Vector3(1, 1, 1), tc = new THREE.Color();

export class ShelfStock implements FillerView {
  readonly group = new THREE.Group();
  readonly filler = new FillerStock();
  holders: StockedHolder[] = [];
  private readonly holderOf = new Map<PropPlacement, StockedHolder>();
  /** Per piece: archetype, label variant, tint, rest-mesh family, chunk, vertex range (in its family's part). */
  private arch = new Uint16Array(0);
  private variant = new Uint8Array(0);
  private tint = new Float32Array(0);
  private fam = new Uint8Array(0);
  private chunkOf = new Int32Array(0);
  private vStart = new Int32Array(0);
  private vCount = new Int32Array(0);
  private chunks: Chunk[] = [];
  private readonly dyn = new Map<number, DynSet>();
  /** The loaded ruined-prop atlas of this station (null: every model archetype draws its procedural fallback). */
  private junk: JunkSet | null = null;
  private seed = 0;
  /** Thinning applied to reach MAX_STOCK_PER_STATION (QA). */
  thinning = 'none';
  buildMs = 0;

  constructor(private readonly fx: StockFx | null = null, private readonly sfx: StockSfx | null = null) {
    this.group.name = 'shelf-stock';
  }

  // ---------------------------------------------------------------------------------------
  // Build

  /** Dress every stocked holder of the station and bake the rest meshes. Replaces the previous station's stock. */
  build(layout: Pick<StationLayout, 'props' | 'areas' | 'seed'> & {storefronts?: StationLayout['storefronts']; extensions?: StationLayout['extensions']}, deps: StockDeps): void {
    const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    this.clear();
    this.seed = layout.seed >>> 0;
    const deck = deps.models.shelf ? shelfDecks(deps.models.shelf) : null;
    // the electronics wall bay renders tech-display.glb when loaded (storefrontBuilder MODEL_READY), else its authored fallback
    const wallDeck = deps.models.techDisplay ? deviceWallDeck(deps.models.techDisplay) : null;
    // task food-shelf-production (lane SHELF): the ruined-prop atlas of this level (lazy; absent = procedural fallbacks)
    const junk = junkSet(deps.models[SHELF_JUNK_KEY]);
    if (this.junk && this.junk !== junk) this.junk.dispose(); // (another loaded file: the old templates' buffers go)
    this.junk = junk;
    // 1. holders + their boards / lots / seeds
    type Pre = {prop: PropPlacement; kind: string; category: StockCategory; boards: Board[]; lots: Box3Like[]; seed: number; back: boolean; area: number; shop?: number};
    const pre: Pre[] = [];
    // Track 2 (lane GEN): stock seeds from CORE-frame positions, so a crop translation by track extensions keeps every shelf's stock:
    // the core's props at their exact core-frame x / z (extensions.coreXZ: a translated double can come back one ulp off and flip a
    // cm rounding tie), props appended after the core by their translated-back position.
    const ext = layout.extensions, xz = ext?.coreXZ?.props;
    const sx = ext?.shift.x ?? 0, sz = ext?.shift.z ?? 0;
    // props standing on holders (on-top decor, crates on shelves): a 2 m cell index of every prop
    const cells = new Map<string, {p: PropPlacement; i: number}[]>();
    const cellKey = (x: number, z: number) => `${Math.floor(x / 2)},${Math.floor(z / 2)}`;
    layout.props.forEach((p, i) => { const k = cellKey(p.x, p.z); let l = cells.get(k); if (!l) cells.set(k, (l = [])); l.push({p, i}); });
    const nearProps = (p: PropPlacement) => {
      const out: {p: PropPlacement; i: number}[] = [];
      for (let gx = Math.floor((p.x - p.hx) / 2); gx <= Math.floor((p.x + p.hx) / 2); gx++) for (let gz = Math.floor((p.z - p.hz) / 2); gz <= Math.floor((p.z + p.hz) / 2); gz++) out.push(...(cells.get(`${gx},${gz}`) ?? []));
      return out;
    };
    for (let pi = 0; pi < layout.props.length; pi++) {
      const p = layout.props[pi];
      if (!isStockedKind(p.kind) || p.cargoGone) continue;
      const area = layout.areas[p.area];
      const purpose = p.purpose ?? area?.purpose;
      const category = stockCategory(p.kind, p.variant, purpose);
      if (!category) continue;
      const boards = stockBoards(p.kind, p.variant, {deck: p.kind === 'stockShelf' || p.kind === 'shelf' ? deck : p.kind === 'deviceWall' ? wallDeck : null});
      if (!boards.length) continue;
      const shop = p.shop ?? (area as {storefront?: number} | undefined)?.storefront;
      const lots = [...(deps.lotsOf?.(p) ?? []), ...hostedBoxes(p, pi, nearProps(p))];
      pre.push({prop: p, kind: p.kind, category, boards, lots, seed: holderStockSeed(this.seed, p.kind, xz && 2 * pi < xz.length ? xz[2 * pi] : p.x - sx, xz && 2 * pi < xz.length ? xz[2 * pi + 1] : p.z - sz, p.y), back: shop === undefined, area: p.area, shop});
    }
    // 2. dress (station-wide bounds on pieces, triangles and rest-mesh bytes: back-of-house rows thin first, then all; then, as the
    // last resort before the hard bound, more sold-out bays). Costs are the archetypes' static ones (archCost), never what loaded.
    const passes: {cap: (h: Pre) => number; gap?: number; name: string}[] = [
      {cap: () => 3, name: 'none'},
      {cap: h => (h.back ? 1 : 3), name: 'back rooms 1 deep'},
      {cap: h => (h.back ? 1 : 2), name: 'back rooms 1 deep, shops 2 deep'},
      {cap: () => 1, name: 'all 1 deep'},
      {cap: () => 1, gap: 0.25, name: 'all 1 deep, sparser'},
      {cap: () => 1, gap: 0.5, name: 'all 1 deep, sparse'},
    ];
    const cost = (l: readonly StockPlacement[]) => { let t = 0, b = 0; for (const p of l) { const c = archCost(p.arch); t += c.tris; b += c.bytes; } return {t, b}; };
    let dressed: StockPlacement[][] = [];
    for (const pass of passes) {
      dressed = pre.map(h => dressHolder({category: h.category, boards: h.boards, lots: h.lots, seed: h.seed, depthCap: pass.cap(h), gapBoost: pass.gap ?? 0}));
      this.thinning = pass.name;
      const c = cost(dressed.flat());
      if (dressed.reduce((n, l) => n + l.length, 0) <= MAX_STOCK_PER_STATION && c.t <= MAX_STOCK_TRIANGLES && c.b <= MAX_STOCK_GEOMETRY_BYTES) break;
    }
    // hard bound (never reached by generated stations; keeps the caps caps)
    let budget = MAX_STOCK_PER_STATION, tBudget = MAX_STOCK_TRIANGLES, bBudget = MAX_STOCK_GEOMETRY_BYTES;
    dressed = dressed.map(l => {
      let k = 0;
      while (k < l.length && budget > 0) { const c = archCost(l[k].arch); if (c.tris > tBudget || c.bytes > bBudget) break; tBudget -= c.tris; bBudget -= c.bytes; budget--; k++; }
      if (k < l.length) budget = 0;
      return k < l.length ? l.slice(0, k).filter(p => p.on < k) : l;
    });
    // 3. pieces (world poses) + chunks
    const total = dressed.reduce((n, l) => n + l.length, 0);
    this.arch = new Uint16Array(total); this.variant = new Uint8Array(total); this.tint = new Float32Array(total); this.fam = new Uint8Array(total);
    this.chunkOf = new Int32Array(total); this.vStart = new Int32Array(total); this.vCount = new Int32Array(total);
    const pieces: FillerPiece[] = [];
    const chunkKeys = new Map<string, number>();
    const chunkPieces: number[][] = [];
    const colliders: THREE.Box3[] = [];
    pre.forEach((h, hi) => {
      const p = h.prop, list = dressed[hi];
      const level = p.level ?? 0;
      const key = `${level}:${Math.floor(p.x / CHUNK)},${Math.floor(p.z / CHUNK)}`;
      let ci = chunkKeys.get(key) ?? -1;
      if (ci < 0 && list.length) { ci = chunkPieces.length; chunkKeys.set(key, ci); chunkPieces.push([]); this.chunks.push({key, level, parts: [null, null]}); }
      const holderQ = tq.setFromAxisAngle(UP, p.rot).clone();
      const holderM = new THREE.Matrix4().compose(new THREE.Vector3(p.x, p.y, p.z), holderQ, ts);
      const first = pieces.length;
      list.forEach((pl, k) => {
        const id = first + k;
        const A = STOCK_ARCHES[pl.arch];
        const fit = A.fit ?? [1, 1, 1];
        const spec: FillerSpec = A.collider === 'cylinder'
          ? {shape: 'cylinder', half: [A.w / 2 * fit[0], A.h / 2 * fit[1], A.w / 2 * fit[0]], mass: A.mass, mat: A.mat, fam: A.fam}
          : A.collider === 'sphere'
            ? {shape: 'sphere', half: [A.w / 2 * fit[0], A.w / 2 * fit[0], A.w / 2 * fit[0]], mass: A.mass, mat: A.mat, fam: A.fam}
            : {shape: 'box', half: [A.w / 2 * fit[0], A.h / 2 * fit[1], A.d / 2 * fit[2]], mass: A.mass, mat: A.mat, fam: A.fam};
        const c = new THREE.Vector3(pl.c[0], pl.c[1], pl.c[2]).applyMatrix4(holderM);
        const q = holderQ.clone().multiply(new THREE.Quaternion(pl.q[0], pl.q[1], pl.q[2], pl.q[3]));
        pieces.push({id, spec, p: c, q, home: c.clone(), holder: hi, above: [], state: 'rest', body: null, moved: false, box: new THREE.Box3(), ...(h.boards[pl.board]?.mode === 'hang' ? {hung: true} : {})});
        this.arch[id] = pl.arch; this.variant[id] = pl.variant; this.tint[id] = FILLER_TINT[0] + pl.tint * (FILLER_TINT[1] - FILLER_TINT[0]);
        this.fam[id] = A.model && junk?.geometry(pl.arch) ? 1 : 0;
        this.chunkOf[id] = ci;
        chunkPieces[ci].push(id);
      });
      list.forEach((pl, k) => { if (pl.on >= 0) pieces[first + pl.on].above.push(first + k); });
      const cols = toWorldBoxes(p, stockColliders(h.kind, p.variant, h.boards)).map(b => new THREE.Box3(new THREE.Vector3(...b.min), new THREE.Vector3(...b.max)));
      colliders.push(...cols);
      const holder: StockedHolder = {index: hi, prop: p, kind: h.kind, category: h.category, level, boards: h.boards, placements: list, first, count: list.length, colliders: cols, area: h.area, chunk: ci, ...(h.shop !== undefined ? {shop: h.shop} : {})};
      this.holders.push(holder);
      this.holderOf.set(p, holder);
    });
    // 4. merged rest meshes
    const mat = stockMaterial();
    chunkPieces.forEach((ids, ci) => this.bakeChunk(ci, ids, pieces, mat));
    this.filler.setPieces(pieces, colliders, this);
    this.group.updateMatrixWorld(true);
    this.buildMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
  }

  private bakeChunk(ci: number, ids: number[], pieces: FillerPiece[], mat: THREE.Material): void {
    let vc = 0, ic = 0;
    for (const id of ids) {
      const g = archGeometry(this.arch[id], this.variant[id]);
      vc += g.attributes.position.count; ic += g.index!.count;
    }
    // packed: float positions, int16 normals, uint16 UVs, uint8 colours (25 bytes / vertex)
    const pos = new Float32Array(vc * 3), nor = new Int16Array(vc * 3), uv = new Uint16Array(vc * 2), col = new Uint8Array(vc * 3), idx = new Uint32Array(ic);
    let vo = 0, io = 0;
    for (const id of ids) {
      const g = archGeometry(this.arch[id], this.variant[id]);
      const n = g.attributes.position.count;
      this.vStart[id] = vo; this.vCount[id] = n;
      const gu = g.attributes.uv.array as Float32Array;
      for (let i = 0; i < n * 2; i++) uv[vo * 2 + i] = Math.round(Math.max(0, Math.min(1, gu[i])) * 65535);
      const gc = g.attributes.color.array as Float32Array, k = this.tint[id];
      for (let i = 0; i < n * 3; i++) col[vo * 3 + i] = Math.max(0, Math.min(255, Math.round(gc[i] * k * 255)));
      const src = g.index!.array;
      for (let i = 0; i < src.length; i++) idx[io + i] = src[i] + vo;
      io += src.length;
      vo += n;
    }
    const geo = new THREE.BufferGeometry();
    const P = new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage), N = new THREE.BufferAttribute(nor, 3, true).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', P);
    geo.setAttribute('normal', N);
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2, true));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3, true));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    const ch = this.chunks[ci];
    ch.pos = P; ch.nor = N; ch.tris = ic / 3;
    for (const id of ids) this.writePiece(ch, id, pieces[id], false);
    geo.computeBoundingSphere();
    if (geo.boundingSphere) geo.boundingSphere.radius += 0.5;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = `shelf-stock-${ch.key}`;
    mesh.userData.level = ch.level;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    ch.mesh = mesh;
    this.group.add(mesh);
  }

  /** Render matrix of a piece: collider centre pose, geometry origin at the box bottom. */
  private pieceMatrix(id: number, p: FillerPiece, out: THREE.Matrix4): THREE.Matrix4 {
    const A = STOCK_ARCHES[this.arch[id]];
    return out.compose(p.p, p.q, ts).multiply(tm2.makeTranslation(0, -A.h / 2, 0));
  }

  /** Writes (or collapses) one piece's vertices in its chunk; `upload` marks the ranges for a partial upload. */
  private writePiece(ch: Chunk, id: number, p: FillerPiece | null, upload: boolean): void {
    const g = archGeometry(this.arch[id], this.variant[id]);
    const s = this.vStart[id], n = this.vCount[id];
    const P = ch.pos.array as Float32Array, N = ch.nor.array as Int16Array;
    if (!p) {
      // collapse: every vertex to one point (zero-area triangles: nothing drawn)
      const x = P[s * 3], y = P[s * 3 + 1], z = P[s * 3 + 2];
      for (let i = 0; i < n; i++) { P[(s + i) * 3] = x; P[(s + i) * 3 + 1] = y; P[(s + i) * 3 + 2] = z; }
    } else {
      const m = this.pieceMatrix(id, p, tm).elements;
      const gp = g.attributes.position.array as Float32Array, gn = g.attributes.normal.array as Float32Array;
      for (let i = 0; i < n; i++) {
        const x = gp[i * 3], y = gp[i * 3 + 1], z = gp[i * 3 + 2];
        const o = (s + i) * 3;
        P[o] = m[0] * x + m[4] * y + m[8] * z + m[12];
        P[o + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
        P[o + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
        const a = gn[i * 3], b = gn[i * 3 + 1], c = gn[i * 3 + 2];
        N[o] = Math.round((m[0] * a + m[4] * b + m[8] * c) * 32767);
        N[o + 1] = Math.round((m[1] * a + m[5] * b + m[9] * c) * 32767);
        N[o + 2] = Math.round((m[2] * a + m[6] * b + m[10] * c) * 32767);
      }
    }
    if (!upload) return;
    ch.pos.addUpdateRange(s * 3, n * 3);
    ch.pos.needsUpdate = true;
    if (p) { ch.nor.addUpdateRange(s * 3, n * 3); ch.nor.needsUpdate = true; }
    const bs = ch.mesh?.geometry.boundingSphere;
    if (p && bs && bs.distanceToPoint(p.p) > -0.3) bs.expandByPoint(tv.copy(p.p).addScalar(0.3)).expandByPoint(tv.copy(p.p).subScalar(0.3));
  }

  // ---------------------------------------------------------------------------------------
  // FillerView

  wake(p: FillerPiece): void {
    this.writePiece(this.chunks[this.chunkOf[p.id]], p.id, null, true);
  }

  rest(p: FillerPiece): void {
    this.writePiece(this.chunks[this.chunkOf[p.id]], p.id, p, true);
  }

  /** Moving / frozen pieces: one instanced mesh per (archetype, label) in use this frame. */
  frame(moving: readonly FillerPiece[]): void {
    const used = new Map<number, FillerPiece[]>();
    for (const p of moving) {
      const k = this.arch[p.id] * 64 + this.variant[p.id];
      let l = used.get(k);
      if (!l) used.set(k, (l = []));
      l.push(p);
    }
    for (const [k, set] of this.dyn) if (!used.has(k) && set.mesh.count) { set.mesh.count = 0; set.mesh.visible = false; }
    for (const [k, list] of used) {
      let set = this.dyn.get(k);
      if (!set || set.cap < list.length) {
        if (set) { this.group.remove(set.mesh); set.mesh.dispose(); }
        const cap = Math.max(8, 1 << Math.ceil(Math.log2(list.length)));
        const mesh = new THREE.InstancedMesh(archGeometry(Math.floor(k / 64), k % 64), stockMaterial(), cap);
        mesh.name = `shelf-stock-moving-${STOCK_ARCHES[Math.floor(k / 64)].id}`;
        mesh.frustumCulled = false; // a handful of instances anywhere in the station
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.group.add(mesh);
        this.dyn.set(k, (set = {mesh, cap}));
      }
      list.forEach((p, i) => {
        set!.mesh.setMatrixAt(i, this.pieceMatrix(p.id, p, tm));
        set!.mesh.setColorAt(i, tc.setScalar(this.tint[p.id]));
      });
      set.mesh.count = list.length;
      set.mesh.visible = true;
      set.mesh.instanceMatrix.needsUpdate = true;
      if (set.mesh.instanceColor) set.mesh.instanceColor.needsUpdate = true;
    }
  }

  // ---------------------------------------------------------------------------------------
  // Physics / combat glue

  /**
   * Loot-holder collision for items / chunks / filler (PhysicsSystem.holderBoxes): a stocked prop
   * collides by its real boards / backs (plus the holder's own loot-surface boxes `base`), so knocked
   * pieces land on the right board instead of inside a solid box. null: not stocked (unchanged).
   */
  physicsBoxes(p: PropPlacement, base: THREE.Box3[] | null): THREE.Box3[] | null {
    const h = this.holderOf.get(p);
    if (!h) return base;
    return [...(base ?? []), ...h.colliders];
  }

  /** Whether a prop carries filler stock. */
  isStocked(p: PropPlacement | undefined): boolean {
    return !!p && this.holderOf.has(p);
  }

  /**
   * The filler piece a pellet / bullet hits before anything else: nearer than `bestT` (world /
   * actor / corpse hit), or — when the world hit is the box of a stocked holder and no actor stands
   * in front — anywhere inside that holder (the pellet enters the shelf). `glass`: it entered a glazed
   * holder (the glass takes the hit too).
   */
  pelletHit(o: Vec3, d: Vec3, bestT: number, wh: {t: number; kind: string; prop?: number}, props: readonly PropPlacement[], actorHit: boolean): (FillerHit & {glass: boolean}) | null {
    if (!this.filler.pieces.length) return null;
    let limit = bestT;
    const hp = wh.kind === 'prop' && wh.prop !== undefined ? props[wh.prop] : undefined;
    if (!actorHit && hp && this.holderOf.has(hp) && Math.abs(wh.t - bestT) < 1e-4) limit = Math.min(bestT + 3, exitT(o, d, hp) + 0.01);
    const h = this.filler.rayHit(o, d, limit);
    if (!h) return null;
    return {...h, glass: !!hp && GLAZED.has(hp.kind) && h.t > wh.t + 1e-4};
  }

  /**
   * A pellet / bullet hit on a piece: impulse at the hit point (+ a paper / plastic / metal puff and a
   * knock sound). Buckshot pierces light packaging (cardboard, paper, bags, thin plastic): the pellet
   * goes on through with about two thirds of its momentum into the piece behind (at most 4 pieces);
   * cans, jars, jugs and heavy boxes stop it. Every hit piece also splashes its board neighbours
   * (physics/fillerStock.ts).
   */
  shoot(hit: FillerHit, dir: THREE.Vector3, damage: number): boolean {
    let h: FillerHit | null = hit, j = damage * FILLER_TUNING.impulsePerDamage, ok = false;
    const seen = new Set<FillerPiece>();
    for (let n = 0; h && n < 4; n++) {
      const A = STOCK_ARCHES[this.arch[h.piece.id]];
      ok = this.filler.shoot(h.piece, h.point, dir, j, h.normal) || ok;
      if (n === 0) {
        const spec = DAMAGE_MATERIALS[A.hit];
        this.fx?.impact?.(h.point, h.normal, spec.fx as 'soft', {decal: false, chips: 1, dust: 0.5});
        this.sfx?.impact?.(h.point.x, h.point.y, h.point.z, spec.sound);
      }
      seen.add(h.piece);
      if (!(A.mat === 'soft' || (A.mat === 'plastic' && A.mass < 0.7))) break;
      j *= 0.65;
      h = this.filler.rayHit(h.point, dir, 0.6, seen);
    }
    this.pierced += seen.size - 1;
    return ok;
  }
  /** Extra pieces hit by pellets that went through light packaging (QA). */
  pierced = 0;

  // ---------------------------------------------------------------------------------------
  // Lifecycle

  clear(): void {
    this.filler.setPieces([], [], null);
    for (const c of this.chunks) if (c.mesh) { this.group.remove(c.mesh); c.mesh.geometry.dispose(); }
    for (const s of this.dyn.values()) { this.group.remove(s.mesh); s.mesh.dispose(); }
    this.dyn.clear();
    this.chunks = [];
    this.holders = [];
    this.holderOf.clear();
  }

  dispose(): void {
    this.clear();
  }

  // ---------------------------------------------------------------------------------------
  // QA

  /** Archetype id / category of a piece (tests, QA). */
  pieceInfo(id: number): {arch: string; variant: number; holder: number; category: StockCategory} {
    const p = this.filler.pieces[id];
    return {arch: STOCK_ARCHES[this.arch[id]].id, variant: this.variant[id], holder: p.holder, category: this.holders[p.holder].category};
  }

  /** Draw calls, triangles, memory and counts — per station and per stocked shop. */
  stats(): {
    holders: number; pieces: number; byKind: Record<string, {holders: number; pieces: number}>; byCategory: Record<string, number>;
    drawCalls: {chunks: number; moving: number}; triangles: number; textureMB: number; geometryMB: number; thinning: string; buildMs: number;
    shops: {shop: number; holders: number; pieces: number; triangles: number; chunks: number}[];
    physics: ReturnType<FillerStock['stats']>;
  } {
    const byKind: Record<string, {holders: number; pieces: number}> = {}, byCategory: Record<string, number> = {};
    const shops = new Map<number, {shop: number; holders: number; pieces: number; triangles: number; chunks: Set<number>}>();
    let tris = 0;
    for (const h of this.holders) {
      const k = (byKind[h.kind] ??= {holders: 0, pieces: 0});
      k.holders++; k.pieces += h.count;
      byCategory[h.category] = (byCategory[h.category] ?? 0) + h.count;
      let ht = 0;
      for (let i = h.first; i < h.first + h.count; i++) ht += archTriangles(this.arch[i]);
      tris += ht;
      if (h.shop !== undefined) {
        let s = shops.get(h.shop);
        if (!s) shops.set(h.shop, (s = {shop: h.shop, holders: 0, pieces: 0, triangles: 0, chunks: new Set()}));
        s.holders++; s.pieces += h.count; s.triangles += ht; if (h.chunk >= 0) s.chunks.add(h.chunk);
      }
    }
    let bytes = 0;
    for (const c of this.chunks) { const g = c.mesh?.geometry; if (!g) continue; for (const a of Object.values(g.attributes)) bytes += (a.array as ArrayLike<number> & {byteLength: number}).byteLength; bytes += (g.index!.array as Uint32Array).byteLength; }
    let moving = 0;
    for (const s of this.dyn.values()) if (s.mesh.visible && s.mesh.count) moving++;
    return {
      holders: this.holders.length, pieces: this.filler.pieces.length, byKind, byCategory,
      drawCalls: {chunks: this.chunks.length, moving}, triangles: tris,
      textureMB: Math.round(stockTextureBytes() / 1048576 * 100) / 100, geometryMB: Math.round(bytes / 1048576 * 100) / 100,
      thinning: this.thinning, buildMs: Math.round(this.buildMs),
      shops: [...shops.values()].map(s => ({shop: s.shop, holders: s.holders, pieces: s.pieces, triangles: s.triangles, chunks: s.chunks.size})),
      physics: this.filler.stats(),
    };
  }

  /**
   * QA: a stocked holder to shoot at — storefront shelving first, then any stock shelving / stocked
   * holder (optionally on `level`), the fullest board (middle boards preferred; sparse back-room boards
   * accepted down to 2 pieces). Stand points are tried `dists` m in front of it (default 2.5 / 2.0 /
   * 1.6 / 1.3: narrow lower-level rooms) until `free` accepts one. Returns the aim (that board, front of
   * its stock) and the stand point.
   */
  shelfTarget(o: {level?: number; dist?: number; dists?: number[]; free?: (stand: THREE.Vector3, aim: THREE.Vector3) => boolean} = {}): {holder: StockedHolder; aim: THREE.Vector3; stand: THREE.Vector3; pieces: number; tier: number; dist: number} | null {
    const dists = o.dists ?? (o.dist !== undefined ? [o.dist] : [2.5, 2.0, 1.6, 1.3]);
    const rank = (h: StockedHolder) => (h.shop !== undefined ? 2 : 0) + (h.kind === 'stockShelf' ? 1 : 0);
    const cands = this.holders.filter(h => h.count > 0 && (o.level === undefined || h.level === o.level)).sort((a, b) => rank(b) - rank(a) || b.count - a.count);
    for (const minPieces of [6, 2]) {
      for (const h of cands) {
        const p = h.prop;
        const fx = Math.sin(p.rot), fz = Math.cos(p.rot);
        // the fullest board, middle boards first (eye-level shots)
        let tier = -1, best = -1;
        const order = h.boards.map((_, i) => i).sort((a, b) => (a === 1 || a === 2 ? 0 : 1) - (b === 1 || b === 2 ? 0 : 1));
        for (const t of order) { const n = h.placements.filter(q => q.board === t).length; if (n > best + 2 || (best < 0 && n > 0)) { best = n; tier = t; } }
        if (tier < 0 || best < minPieces) continue;
        const b = h.boards[tier];
        const front = Math.round(p.rot / (Math.PI / 2)) & 1 ? p.hx : p.hz;
        const aim = new THREE.Vector3(0, Math.min(b.y + 0.12, b.top - 0.02), Math.min(b.z1, 0.12)).applyAxisAngle(UP, p.rot).add(new THREE.Vector3(p.x, p.y, p.z));
        for (const dist of dists) {
          const stand = new THREE.Vector3(p.x + fx * (front + dist), p.y, p.z + fz * (front + dist));
          if (o.free && !o.free(stand, aim)) continue;
          return {holder: h, aim, stand, pieces: best, tier, dist};
        }
      }
      if (o.level === undefined) break; // the main hook keeps its "a full shop shelf" meaning
    }
    return null;
  }

  /** Rest-mesh chunks inside the camera frustum + moving-piece meshes drawn (the stock's draw calls this frame). */
  drawCallsInView(camera: THREE.Camera): {chunks: number; inView: number; moving: number} {
    const f = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    let inView = 0, moving = 0;
    for (const c of this.chunks) { const s = c.mesh?.geometry.boundingSphere; if (s && f.intersectsSphere(s)) inView++; }
    for (const s of this.dyn.values()) if (s.mesh.visible && s.mesh.count) moving++;
    return {chunks: this.chunks.length, inView, moving};
  }
}
