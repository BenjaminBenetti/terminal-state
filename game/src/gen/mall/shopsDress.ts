// Task track3-eaton-centre-20261031 (lane SHOPS): THE EATON'S CENTER SHOP INTERIORS — dresses every shop unit (sales floor + stock
// room) of layout.mall from its program's RECIPE. Pure data (no three.js), deterministic per shop (`shop:<id>` fork of the dressing
// rng, so one shop never shifts another's draws).
//
// User (track 3): "the shops should be very substantial very detailed ... I don't want a quick result with small little dinky things
// I want it to be really a real exploration". Every recipe is a real store layout, distinct per program:
//   gun shop      — a glass-counter run across the floor with the staff zone behind it: empty long-gun racks on the back wall
//                   over steel ammo shelving, the forced gun locker, display benches on the customer side (the weapon plan's finds
//                   lie on them), accessory bays; back office (desk, cabinets, safe, lockers, crates, ammo shelving);
//   pharmacy      — tills by the entry, pharmacy gondola aisles, wall shelving, a cooler, the dispensary counter run at the back
//                   with medicine cabinets + stocked shelving behind it; dispensary stock room (shelving, cabinets, a cold-chain
//                   specimen fridge);
//   clinic        — reception desk, waiting sofas, exam bays (exam tables, vitals monitors, cabinets, a stretcher, crash cart);
//   electronics / phone — TV walls, device walls, demo tables, showcases, the repair bench; hardware — tills, steel shelving,
//                   parts gondolas, tool chests, ladders, hand trucks;
//   clothing / shoes / department — window mannequins, garment rails, display tables, slatwall bays, fitting rooms, sneaker
//                   walls, try-on ottomans, the cash wrap, (department) a cosmetics hall of glass counters and a bed showroom;
//   grocery       — checkout counters with registers, produce stands, gondola aisles, a cooler wall, chest freezers, carts;
//   food court / café — the cuisine's counter run and kitchen line (the station's store purposes), café tables, a bakery case;
//   books, toys, sports, jewellery, home, beauty, music, pet, arcade, luggage, optician, florist, kiosks, the mall's service
//   rooms (security, first aid, management, customer service, janitorial) and vacant units (leftover fixtures, cartons).
// Everything goes through the shared placement primitive (gen/placeKit.ts tryPlaceProp: door zones, access strips, island walkway
// rings, stair / landing keep-outs and ROOM CONNECTIVITY — every walkable cell stays reachable and every door touched), so a piece
// that cannot fit is skipped, never forced; the entry span of the shopfront is reserved (a 2 m deep keep-out) so the way in stays
// open; stocked displays keep 1.5 m clear in front; openables keep their swing / drawer strips. Real interaction classes only:
// openables (cabinets, lockers, safes, coolers, freezers, filing cabinets, specimen fridges, bakery case, tool chests), open holders
// (counters, shelving, bays, tables, stands), movables (garment rails, mannequins, ottomans, plants, bicycles, ladders, carts,
// suitcases, plush toys …) and classified static fixtures (gen/mall/kinds.ts, the office / company tables). No baked clutter: loot
// lies on the holders' real surfaces; the gun-display benches carry the weapon plan's pickups (gen/mall/shopsWeapons.ts).
//
// Frame: GEN's pipeline calls dressMallShops BEFORE stationDress.dress() (like the Office's company pre-dress): props are authored in
// each storey's LOCAL height frame and dress()'s liftLevels lifts them; `frame: 'absolute'` lifts them here instead (callers that do
// not run dress() afterwards, and the tests). Shop lights are absolute (level-tagged). Shopfront glazing / shutter blockers are
// collision-only props (`shopGlazing` / `shopShutter`, drawn by lane ARCH from the shop's fit: lanes/SHOPS.notes).

import type {Rng} from '../../core/rng';
import {CELL, FLOOR} from '../grid';
import {PROP_DEFS, SHOP_COUNTER_TOP_Y, footprint, type PropKind, type PropPlacement} from '../props';
import {
  areaBase, areaLevel, cellsOfBox, forceProp, levelGrid, makePlaceCtx, markCell, mountProp, relCeil, tryPlaceProp, wallSpot,
  type PlaceCtx,
} from '../placeKit';
import {stockVariant, type StockTheme} from '../purposeShapes';
import {STORE_PURPOSES} from '../purposes';
import type {Area, ShopUse, Side, StationLayout} from '../stationTypes';
import type {MallShop} from './mallTypes';
import {MALL_MOUNT_Y} from './kinds';
import {shopFit, type MallRecipe, type MallShopFit} from './shops';

// ---------------------------------------------------------------------------------------------
// Frame of one unit: u along the frontage (0 at the x0 / z0 end), v depth from the frontage into the unit.

export interface ShopFrame {
  a: Area;
  /** Wall of the unit holding the frontage; back = the opposite wall; L / R = the side walls at u = 0 / u = W. */
  side: Side; back: Side; L: Side; R: Side;
  x0: number; z0: number; x1: number; z1: number;
  W: number; D: number;
  /** Yaw facing the frontage (customers), facing into the unit, facing +u, facing -u. */
  face: number; inward: number; plusU: number; minusU: number;
  /** Entry span (u) of the shopfront (glazed fronts) or the whole frontage (open fronts). */
  entry: [number, number];
}

const OPP: Record<Side, Side> = {N: 'S', S: 'N', E: 'W', W: 'E'};

/** Frame of a unit (sales floor or stock room). `front`: the frontage side; entry in metres along it (from its x0 / z0 end). */
export function frameOf(a: Area, front: Side, entry?: readonly [number, number], frontStart?: number): ShopFrame {
  const x0 = a.x * CELL, z0 = a.y * CELL, x1 = (a.x + a.w) * CELL, z1 = (a.y + a.h) * CELL;
  const alongX = front === 'N' || front === 'S';
  const W = alongX ? x1 - x0 : z1 - z0, D = alongX ? z1 - z0 : x1 - x0;
  const rot = {
    N: {face: Math.PI, inward: 0, plusU: Math.PI / 2, minusU: -Math.PI / 2, L: 'W' as Side, R: 'E' as Side},
    S: {face: 0, inward: Math.PI, plusU: Math.PI / 2, minusU: -Math.PI / 2, L: 'W' as Side, R: 'E' as Side},
    W: {face: -Math.PI / 2, inward: Math.PI / 2, plusU: 0, minusU: Math.PI, L: 'N' as Side, R: 'S' as Side},
    E: {face: Math.PI / 2, inward: -Math.PI / 2, plusU: 0, minusU: Math.PI, L: 'N' as Side, R: 'S' as Side},
  }[front];
  const off = frontStart !== undefined ? frontStart - (alongX ? x0 : z0) : 0;
  const e: [number, number] = entry ? [Math.max(0, off + entry[0]), Math.min(W, off + entry[1])] : [0, W];
  return {a, side: front, back: OPP[front], L: rot.L, R: rot.R, x0, z0, x1, z1, W, D, face: rot.face, inward: rot.inward, plusU: rot.plusU, minusU: rot.minusU, entry: e};
}
/** World XZ of frame point (u, v). */
export function uvXZ(fr: ShopFrame, u: number, v: number): [number, number] {
  switch (fr.side) {
    case 'N': return [fr.x0 + u, fr.z0 + v];
    case 'S': return [fr.x0 + u, fr.z1 - v];
    case 'W': return [fr.x0 + v, fr.z0 + u];
    default: return [fr.x1 - v, fr.z0 + u];
  }
}
/** Frame (u, v) of a world point. */
export function xzUV(fr: ShopFrame, x: number, z: number): [number, number] {
  switch (fr.side) {
    case 'N': return [x - fr.x0, z - fr.z0];
    case 'S': return [x - fr.x0, fr.z1 - z];
    case 'W': return [z - fr.z0, x - fr.x0];
    default: return [z - fr.z0, fr.x1 - x];
  }
}
/** Wall coordinate (world x for N / S walls, z for W / E walls) of u on the back wall, of v on a side wall. */
const tBack = (fr: ShopFrame, u: number) => (fr.side === 'N' || fr.side === 'S' ? fr.x0 + u : fr.z0 + u);
const tSide = (fr: ShopFrame, v: number) => (fr.side === 'N' ? fr.z0 + v : fr.side === 'S' ? fr.z1 - v : fr.side === 'W' ? fr.x0 + v : fr.x1 - v);

/** Which wall of the sales area the shop's frontage is on (geometry first: the record's side is the fallback). */
export function frontageSide(a: Area, s: MallShop): Side {
  const f = s.frontage, x0 = a.x * CELL, z0 = a.y * CELL, x1 = (a.x + a.w) * CELL, z1 = (a.y + a.h) * CELL;
  const cx = (f.x0 + f.x1) / 2, cz = (f.z0 + f.z1) / 2;
  const d: [Side, number][] = [['N', Math.abs(cz - z0)], ['S', Math.abs(cz - z1)], ['W', Math.abs(cx - x0)], ['E', Math.abs(cx - x1)]];
  const thin = Math.abs(f.x1 - f.x0) >= Math.abs(f.z1 - f.z0) ? ['N', 'S'] : ['W', 'E'];
  const best = d.filter(e => thin.includes(e[0])).sort((p, q) => p[1] - q[1])[0];
  return best && best[1] < 1.6 ? best[0] : f.side;
}

// ---------------------------------------------------------------------------------------------
// Placement helpers

const r3 = (v: number) => Math.round(v * 1000) / 1000;
/** Cell-aligned slot a module of width w occupies (placement footprints shrink 4 cm per side). */
const slot = (w: number) => Math.ceil((w - 0.08) / CELL - 1e-9) * CELL;
const snapUp = (v: number) => Math.ceil(v / CELL - 1e-6) * CELL;
const snapDn = (v: number) => Math.floor(v / CELL + 1e-6) * CELL;
/** Access strip (m) kept in front of a holder / display (customers stand there to reach it). */
const HOLDER_FRONT = 0.8;

type KindV = readonly [PropKind, number];

export class ShopDresser {
  readonly placed: PropPlacement[] = [];
  constructor(readonly layout: StationLayout, readonly ctx: PlaceCtx, readonly fr: ShopFrame, readonly rng: Rng) {}
  get W(): number { return this.fr.W; }
  get D(): number { return this.fr.D; }
  get a(): Area { return this.fr.a; }

  /** tryPlaceProp at frame point (u, v). */
  put(kind: PropKind, u: number, v: number, rot: number, o: {front?: number; ring?: number; variant?: number} = {}): PropPlacement | null {
    const [x, z] = uvXZ(this.fr, u, v);
    const p = tryPlaceProp(this.ctx, this.a, kind, r3(x), r3(z), rot, {front: o.front, ring: o.ring, variant: o.variant});
    if (p) this.placed.push(p);
    return p;
  }

  /** Modules side by side along a wall in cell-aligned slots between wall coordinates t0..t1 (cycling `kinds`); returns how many. */
  wallRun(wall: Side, kinds: readonly KindV[], t0: number, t1: number, o: {max?: number; front?: number} = {}): number {
    let t = snapUp(Math.min(t0, t1));
    const end = Math.max(t0, t1);
    let n = 0, k = 0, misses = 0;
    while (n < (o.max ?? 99) && kinds.length) {
      const [kind, variant] = kinds[k % kinds.length];
      const sw = slot(PROP_DEFS[kind].w);
      if (t + sw > end + 1e-6) { if (++misses > kinds.length) break; k++; continue; }
      misses = 0;
      const s = wallSpot(this.a, wall, t + sw / 2, kind);
      const p = tryPlaceProp(this.ctx, this.a, kind, r3(s.x), r3(s.z), s.rot, {front: o.front ?? frontFor(kind), variant});
      if (p) { this.placed.push(p); n++; k++; t += sw; } else t += CELL;
    }
    return n;
  }
  /** Along the back wall between u0..u1. */
  backRow(kinds: readonly KindV[], u0 = 0.25, u1 = this.W - 0.25, o: {max?: number; front?: number} = {}): number {
    return this.wallRun(this.fr.back, kinds, tBack(this.fr, u0), tBack(this.fr, u1), o);
  }
  /** Along one side wall ('L' at u = 0, 'R' at u = W) between depths v0..v1. */
  sideRow(which: 'L' | 'R', kinds: readonly KindV[], v0: number, v1: number, o: {max?: number; front?: number} = {}): number {
    if (v1 - v0 < 0.4) return 0;
    return this.wallRun(which === 'L' ? this.fr.L : this.fr.R, kinds, tSide(this.fr, v0), tSide(this.fr, v1), o);
  }
  sideRows(kinds: readonly KindV[], v0: number, v1: number, o: {max?: number; front?: number; sides?: readonly ('L' | 'R')[]} = {}): number {
    let n = 0;
    for (const s of o.sides ?? (['L', 'R'] as const)) n += this.sideRow(s, kinds, v0, v1, {max: o.max === undefined ? undefined : o.max - n, front: o.front});
    return n;
  }

  /** Free-standing islands of `kind` spread over the zone (walkway ring kept all round); `along`: long side along u (facing front). */
  islands(kind: PropKind, n: number, zone: {u0: number; u1: number; v0: number; v1: number}, o: {ring?: number; along?: boolean; variant?: number; rot?: number} = {}): PropPlacement[] {
    const out: PropPlacement[] = [];
    if (n <= 0 || zone.u1 < zone.u0 - 1e-6 || zone.v1 < zone.v0 - 1e-6) return out;
    const def = PROP_DEFS[kind], ring = o.ring ?? 0.9;
    const along = o.along ?? true;
    const rot = o.rot ?? (along ? this.fr.face : this.fr.plusU);
    const wu = along ? def.w : def.d, wv = along ? def.d : def.w;
    const pu = wu + 2 * ring + 0.1, pv = wv + 2 * ring + 0.1;
    const cu = Math.max(1, Math.floor((zone.u1 - zone.u0 + 2 * ring) / pu)), cv = Math.max(1, Math.floor((zone.v1 - zone.v0 + 2 * ring) / pv));
    const cells: [number, number][] = [];
    for (let j = 0; j < cv; j++) for (let i = 0; i < cu; i++) {
      const u = zone.u0 + (zone.u1 - zone.u0) * (cu === 1 ? 0.5 : i / (cu - 1)), v = zone.v0 + (zone.v1 - zone.v0) * (cv === 1 ? 0.5 : j / (cv - 1));
      cells.push([u, v]);
    }
    // even spread: alternate rows / columns first, then the rest (seeded within)
    const order = this.rng.shuffle(cells.map((c, i) => ({c, k: ((i % cu) + Math.floor(i / cu)) % 2 + this.rng.next() * 0.5}))).sort((p, q) => p.k - q.k).map(e => e.c);
    for (const [u, v] of order) {
      if (out.length >= n) break;
      for (const [du, dv] of [[0, 0], [0.25, 0], [-0.25, 0], [0, 0.25], [0, -0.25], [0.5, 0.25], [-0.5, -0.25]]) {
        const p = this.put(kind, Math.round((u + du) * 4) / 4, Math.round((v + dv) * 4) / 4, rot, {ring, variant: o.variant});
        if (p) { out.push(p); break; }
      }
    }
    return out;
  }

  /**
   * Back-to-back gondola runs perpendicular to the frontage (you look down the aisles from the entry) inside the zone, with
   * `aisle` m between runs and to the zone's sides; `variants` cycle per run (grocery / snacks / cleaning …). Returns modules placed.
   */
  aisles(kind: PropKind, variants: readonly number[], zone: {u0: number; u1: number; v0: number; v1: number}, aisle = 1.2): number {
    const def = PROP_DEFS[kind], sw = slot(def.w), half = def.d + 0.01;
    const span = zone.u1 - zone.u0;
    const lines = Math.floor((span - aisle) / (2 * half + aisle));
    if (lines < 1) return 0;
    const slots = Math.floor((zone.v1 - zone.v0) / sw);
    if (slots < 1) return 0;
    const used = lines * 2 * half + (lines - 1) * aisle;
    const start = zone.u0 + (span - used) / 2;
    const vs = snapUp(zone.v0 + (zone.v1 - zone.v0 - slots * sw) / 2 - CELL / 2);
    let n = 0;
    for (let k = 0; k < lines; k++) {
      const B = Math.round((start + half + k * (2 * half + aisle)) / CELL) * CELL;
      const variant = variants[k % variants.length] ?? 0;
      for (let i = 0; i < slots; i++) {
        const v = vs + sw * (i + 0.5);
        if (v + sw / 2 > zone.v1 + 0.05) break;
        if (this.put(kind, B - def.d / 2 - 0.01, v, this.fr.minusU, {variant})) n++;
        if (this.put(kind, B + def.d / 2 + 0.01, v, this.fr.plusU, {variant})) n++;
      }
    }
    return n;
  }

  /**
   * A counter run parallel to the frontage whose fronts face the customers at depth `v` (cell line), from u0 to u1 (cycling kinds):
   * the staff work behind it. Returns the modules placed.
   */
  counterRun(kinds: readonly KindV[], v: number, u0: number, u1: number, o: {max?: number} = {}): PropPlacement[] {
    const out: PropPlacement[] = [];
    const V = snapUp(v);
    let u = snapUp(Math.min(u0, u1));
    let k = 0;
    while (out.length < (o.max ?? 99)) {
      const [kind, variant] = kinds[k % kinds.length];
      const def = PROP_DEFS[kind], sw = slot(def.w);
      if (u + sw > Math.max(u0, u1) + 1e-6) break;
      const p = this.put(kind, u + sw / 2, V + def.d / 2 + 0.01, this.fr.face, {variant, front: 0.9});
      if (p) { out.push(p); k++; u += sw; } else u += CELL;
    }
    return out;
  }

  /** Wall-mounted kind (gen/mall/kinds.ts MALL_MOUNT_Y) on `wall` around wall coordinate t; tries a few spots. */
  mount(kind: PropKind, wall: Side, t0: number, t1: number, n: number): number {
    const def = PROP_DEFS[kind], y = MALL_MOUNT_Y[kind as keyof typeof MALL_MOUNT_Y] ?? 1.0;
    const base = areaBase(this.layout, this.a);
    let placed = 0;
    const lo = Math.min(t0, t1) + def.w / 2 + 0.1, hi = Math.max(t0, t1) - def.w / 2 - 0.1;
    if (hi < lo) return 0;
    const spots = n === 1 ? [(lo + hi) / 2] : Array.from({length: n}, (_, i) => lo + (hi - lo) * (i + 0.5) / n);
    for (const t of spots) {
      for (const dt of [0, 0.5, -0.5, 1, -1]) {
        const p = mountProp(this.ctx, this.a, wall, Math.round((t + dt) * 4) / 4, kind, y, base);
        if (p) { this.placed.push(p); placed++; break; }
      }
    }
    return placed;
  }

  /** Light decor against any wall (seeded spot): a plant, a ladder, a bicycle … */
  againstWall(kind: PropKind, n: number, o: {front?: number; walls?: readonly Side[]} = {}): number {
    let k = 0;
    const walls = o.walls ?? [this.fr.L, this.fr.R, this.fr.back];
    for (let i = 0; i < n; i++) {
      for (let t = 0; t < 16; t++) {
        const wall = this.rng.pick(walls);
        const alongX = wall === 'N' || wall === 'S';
        const lo = alongX ? this.fr.x0 : this.fr.z0, hi = alongX ? this.fr.x1 : this.fr.z1;
        const def = PROP_DEFS[kind];
        if (hi - lo < def.w + 0.4) continue;
        const along = Math.round(this.rng.range(lo + def.w / 2 + 0.15, hi - def.w / 2 - 0.15) * 4) / 4;
        const s = wallSpot(this.a, wall, along, kind);
        const p = tryPlaceProp(this.ctx, this.a, kind, r3(s.x), r3(s.z), s.rot, {front: o.front ?? frontFor(kind)});
        if (p) { this.placed.push(p); k++; break; }
      }
    }
    return k;
  }

  /** Host decor on a counter / sideboard top (`du` along the host's local x): a cash register, an aquarium; the host's loot surface gives up that span. */
  onTop(host: PropPlacement, kind: PropKind, du = 0): PropPlacement | null {
    const hi = this.layout.props.indexOf(host);
    if (hi < 0) return null;
    const def = PROP_DEFS[kind], top = topOf(host.kind);
    if (top === undefined) return null;
    const hd = PROP_DEFS[host.kind];
    if (Math.abs(du) + def.w / 2 > hd.w / 2 + 1e-6 || def.d > hd.d + 0.05) return null;
    const {hx, hz} = footprint(kind, host.rot);
    const x = host.x + Math.cos(host.rot) * du, z = host.z - Math.sin(host.rot) * du;
    const p: PropPlacement = {kind, x: r3(x), z: r3(z), y: host.y + top, rot: host.rot, area: host.area, hx, hz, h: def.h, blocksSight: false, variant: 0, host: hi,
      ...(host.level ? {level: host.level} : {})};
    host.cut = [...(host.cut ?? []), {y: top, x0: r3(du - def.w / 2 - 0.02), x1: r3(du + def.w / 2 + 0.02)}];
    this.layout.props.push(p);
    this.placed.push(p);
    return p;
  }

  /** Reserves frame cells (u0..u1 x v0..v1) as a keep-out (the shopfront entry, a staff gap). */
  keep(u0: number, u1: number, v0: number, v1: number): void {
    const [xa, za] = uvXZ(this.fr, u0, v0), [xb, zb] = uvXZ(this.fr, u1, v1);
    const [cx0, cy0, cx1, cy1] = cellsOfBox((xa + xb) / 2, (za + zb) / 2, Math.abs(xb - xa) / 2, Math.abs(zb - za) / 2);
    const g = this.ctx.g;
    for (let y = cy0; y <= cy1; y++) for (let x = cx0; x <= cx1; x++) {
      if (!g.inBounds(x, y)) continue;
      const i = g.idx(x, y);
      if (g.area[i] === this.a.id && g.cells[i] === FLOOR) markCell(this.ctx, this.ctx.keep, i);
    }
  }
}

/** Access strip for a kind placed against a wall: holders / displays keep a customer strip, openables their swing (placeKit adds it). */
function frontFor(kind: PropKind): number {
  if (kind === 'stockShelf' || kind === 'shelf' || kind === 'wallBay' || kind === 'glassCounter' || kind === 'shopCooler' || kind === 'deviceWall'
    || kind === 'medCabinet' || kind === 'gunLocker' || kind === 'flowerStand' || kind === 'sneakerWall' || kind === 'lawBookcase' || kind === 'shopCounter'
    || kind === 'arcadeCabinet' || kind === 'magazineRack') return HOLDER_FRONT;
  if (kind === 'cabinetTall' || kind === 'cabinetLow' || kind === 'staffLockers' || kind === 'safe' || kind === 'officeFiling') return 0.7;
  return 0.5;
}
/** Top (support) height of a host kind, prop-relative. */
function topOf(kind: PropKind): number | undefined {
  if (kind === 'shopCounter') return SHOP_COUNTER_TOP_Y;
  if (kind === 'cabinetLow' || kind === 'desk' || kind === 'merchTable') return PROP_DEFS[kind].h;
  return undefined;
}

// ---------------------------------------------------------------------------------------------
// Recipes

type Recipe = (d: ShopDresser, f: MallShopFit) => void;
const sv = (t: StockTheme) => stockVariant(t);

/** Cash wrap: a short counter run (+ register) facing the customers on the side away from the entry, at depth v. */
function cashWrap(d: ShopDresser, kinds: readonly KindV[], n: number, v = 2.0): PropPlacement[] {
  const {W, fr} = d;
  const entryMid = (fr.entry[0] + fr.entry[1]) / 2;
  const leftSide = entryMid > W / 2; // entry on the right half -> wrap on the left
  const len = kinds.slice(0, n).reduce((s, [k]) => s + slot(PROP_DEFS[k].w), 0) || slot(PROP_DEFS.shopCounter.w) * n;
  const u0 = leftSide ? 1.0 : Math.max(1.0, W - 1.0 - len), u1 = Math.min(W - 1.0, u0 + len + 0.01);
  const run = d.counterRun(kinds, v, u0, u1, {max: n});
  const reg = run.find(p => p.kind === 'shopCounter');
  if (reg) d.onTop(reg, 'cashRegister', 0.35);
  return run;
}
/** Display mannequins in the shop window beside the entry (facing the gallery). */
function windowDisplay(d: ShopDresser, kind: PropKind, n: number): number {
  const {fr, W} = d;
  let k = 0;
  const spots = [0.9, W - 0.9, 2.1, W - 2.1].filter(u => u < fr.entry[0] - 0.6 || u > fr.entry[1] + 0.6);
  for (const u of spots) { if (k >= n) break; if (d.put(kind, u, 1.35, fr.face)) k++; }
  return k;
}

const RECIPES: Record<MallRecipe, Recipe> = {
  guns(d) {
    const {W, D, fr} = d;
    const V = Math.max(3.5, Math.min(D - 2.8, snapDn(D * 0.55)));
    // staff zone behind the counter run: long-gun racks over the back wall, steel ammo shelving under / beside them, the gun locker
    d.mount('gunRack', fr.back, tBack(fr, 0.3), tBack(fr, W - 0.3), W >= 7 ? 2 : 1);
    d.backRow([['shelf', 0], ['gunLocker', 0], ['shelf', 0]], 0.3, W - 0.3);
    d.sideRow(d.rng.chance(0.5) ? 'L' : 'R', [['gunLocker', 0], ['cabinetTall', 0]], V + 1.6, D - 0.2, {max: 1});
    // the counter run (glass display counters + a till), a staff gap at one end
    const gapR = d.rng.chance(0.5);
    const run = d.counterRun([['glassCounter', 0], ['glassCounter', 0], ['shopCounter', 0], ['glassCounter', 0]], V, gapR ? 0.3 : 1.3, gapR ? W - 1.3 : W - 0.3);
    const till = run.find(p => p.kind === 'shopCounter');
    if (till) d.onTop(till, 'cashRegister', 0.35);
    // customer side: display benches (the weapon finds), accessory bays + ammo shelving along the side walls
    const benches = d.islands('gunDisplay', W >= 8 ? 2 : 1, {u0: 1.8, u1: W - 1.8, v0: 2.4, v1: V - 1.0}, {ring: 0.8}).length;
    if (!benches && !d.sideRows([['gunDisplay', 0]], 1.4, V - 0.6, {max: 1})) d.againstWall('gunDisplay', 1, {front: 0.9});
    d.sideRows([['wallBay', 0], ['shelf', 0]], 1.4, V - 0.9);
    d.againstWall('bin', 1);
  },
  outdoors(d) {
    const {W, D} = d;
    cashWrap(d, [['shopCounter', 0], ['glassCounter', 0]], 2, 2.0);
    const coolers = d.backRow([['shopCooler', 0], ['shopCooler', 0]], W - 2.0, W - 0.2, {max: 2});
    d.backRow([['wallBay', 0], ['shelf', 0]], 0.25, W - (coolers ? 2.1 : 0.25));
    d.sideRows([['wallBay', 0]], 3.2, D - 1.2);
    if (W * D >= 70) d.islands('tentDisplay', 1, {u0: 2, u1: W - 2, v0: D * 0.45, v1: D * 0.7}, {ring: 1.0});
    d.islands('clothingRack', W * D >= 90 ? 4 : 2, {u0: 1.5, u1: W - 1.5, v0: 3.8, v1: D - 2.0}, {ring: 0.8});
    d.islands('merchTable', 1, {u0: 1.6, u1: W - 1.6, v0: 3.2, v1: D - 2.4}, {ring: 0.9});
    d.againstWall('bicycle', 1);
  },
  pharmacy(d) {
    const {W, D, fr} = d;
    cashWrap(d, [['shopCounter', 0], ['shopCounter', 0]], 2, 1.8);
    d.againstWall('basketStack', 1, {walls: [fr.L, fr.R]});
    // the dispensary: a glass counter run across the back with medicine cabinets and stocked shelving behind it
    const V = Math.max(4.5, D - 3.4);
    const staff = D - V >= 2.6;
    if (staff) {
      d.backRow([['stockShelf', sv('pharmacy')], ['medCabinet', 0], ['stockShelf', sv('pharmacy')]], 0.3, W - 0.3);
      d.counterRun([['glassCounter', 0], ['shopCounter', 0], ['glassCounter', 0]], V, 0.3, W - 1.4);
    } else d.backRow([['medCabinet', 0], ['stockShelf', sv('pharmacy')]], 0.3, W - 0.3);
    d.sideRows([['stockShelf', sv('pharmacy')]], 2.9, (staff ? V : D) - 1.2);
    d.sideRow(d.rng.chance(0.5) ? 'L' : 'R', [['shopCooler', 0]], 2.2, 3.8, {max: 1});
    d.aisles('stockShelf', [sv('pharmacy'), sv('cleaning'), sv('pharmacy')], {u0: 1.3, u1: W - 1.3, v0: 3.4, v1: (staff ? V : D) - 1.6}, 1.2);
    d.againstWall('bloodPressureKiosk', 1, {walls: [fr.L, fr.R]});
  },
  clinic(d) {
    const {W, D, fr} = d;
    // reception + waiting, exam bays behind
    d.counterRun([['desk', 0]], 1.8, W / 2 - 1.0, W / 2 + 1.0, {max: 1});
    d.sideRows([['lobbySofa', 0]], 1.4, Math.min(D * 0.45, 5), {max: 2});
    d.againstWall('pottedPlantSmall', 1, {walls: [fr.L, fr.R]});
    d.backRow([['examTable', 0], ['vitalsMonitor', 0], ['medCabinet', 0], ['examTable', 0], ['vitalsMonitor', 0]], 0.3, W - 0.3);
    d.sideRows([['medCabinet', 0], ['crashCart', 0], ['wheeledStretcher', 0]], Math.max(D * 0.5, 4.5), D - 1.2, {max: 3});
    d.againstWall('ivPole', 1);
    d.againstWall('physicianScale', 1);
  },
  electronics(d) {
    const {W, D, fr} = d;
    d.mount('tvWall', fr.back, tBack(fr, 0.3), tBack(fr, W - 0.3), W >= 9 ? 2 : 1);
    d.backRow([['showcase', 0], ['shopCounter', 0], ['glassCounter', 0], ['showcase', 0]], 0.3, W - 0.3);
    const tills = d.placed.filter(p => p.kind === 'shopCounter');
    if (tills[0]) d.onTop(tills[0], 'cashRegister', 0.35);
    d.sideRows([['deviceWall', 0], ['wallBay', 0], ['deviceWall', 0]], 1.6, D - 1.3);
    d.islands('techDisplay', W * D >= 80 ? 4 : 2, {u0: 1.8, u1: W - 1.8, v0: 2.4, v1: D - 2.2}, {ring: 1.0});
  },
  phone(d) {
    const {W, D} = d;
    d.backRow([['repairBench', 1], ['glassCounter', 0], ['shopCounter', 0]], 0.3, W - 0.3);
    d.sideRows([['deviceWall', 0]], 1.4, D - 1.2);
    d.islands('techDisplay', 1, {u0: 1.6, u1: W - 1.6, v0: 2.2, v1: D - 1.9}, {ring: 0.9});
    d.againstWall('spinnerRack', 1);
  },
  hardware(d) {
    const {W, D} = d;
    cashWrap(d, [['shopCounter', 0], ['shopCounter', 0]], 2, 1.8);
    d.backRow([['shelf', 0]], 0.3, W - 0.3);
    d.sideRows([['stockShelf', sv('parts')], ['shelf', 0]], 2.8, D - 1.3);
    d.aisles('stockShelf', [sv('parts'), sv('cleaning'), sv('parts')], {u0: 1.3, u1: W - 1.3, v0: 3.4, v1: D - 1.7}, 1.2);
    d.againstWall('rollingToolChest', 1);
    d.againstWall('stepLadder', 1);
    d.againstWall('handTruck', 1);
  },
  clothing(d) {
    const {W, D, fr} = d;
    windowDisplay(d, 'dressForm', 2);
    const corner = d.rng.chance(0.5) ? 0.25 : W - 0.25 - PROP_DEFS.fittingRooms.w;
    d.backRow([['fittingRooms', 0]], corner, corner + PROP_DEFS.fittingRooms.w + 0.3, {max: 1, front: 1.0});
    d.backRow([['wallBay', 0]], 0.25, W - 0.25);
    d.sideRows([['wallBay', 0]], 2.4, D - 1.2);
    cashWrap(d, [['shopCounter', 0], ['glassCounter', 0]], 2, Math.min(D - 3, Math.max(2.4, D * 0.55)));
    d.islands('clothingRack', Math.round(Math.min(6, W * D / 20)), {u0: 1.6, u1: W - 1.6, v0: 2.6, v1: D - 2.2}, {ring: 0.8});
    d.islands('merchTable', W * D >= 60 ? 2 : 1, {u0: 1.6, u1: W - 1.6, v0: 2.4, v1: D - 2.4}, {ring: 0.9});
    d.islands('ottoman', 1, {u0: 1.2, u1: W - 1.2, v0: D * 0.5, v1: D - 1.6}, {ring: 0.7});
    void fr;
  },
  shoes(d) {
    const {W, D} = d;
    windowDisplay(d, 'dressForm', 1);
    d.sideRows([['sneakerWall', 0]], 1.4, D - 1.0);
    d.backRow([['wallBay', 0], ['sneakerWall', 0]], 0.25, W - 0.25);
    cashWrap(d, [['shopCounter', 0]], 1, Math.min(D - 2.6, 2.2));
    d.islands('ottoman', W * D >= 45 ? 3 : 2, {u0: 1.6, u1: W - 1.6, v0: 2.6, v1: D - 1.8}, {ring: 0.7});
    d.islands('merchTable', 1, {u0: 1.8, u1: W - 1.8, v0: 2.4, v1: D - 2.4}, {ring: 0.9});
  },
  department(d) {
    const {W, D, fr} = d;
    windowDisplay(d, 'dressForm', 3);
    // cosmetics hall of glass counters in the front third; garment rails / mannequins / tables in the middle; fitting rooms, a bed
    // showroom corner and slatwall bays at the back; two cash wraps
    d.islands('glassCounter', Math.round(Math.min(6, W / 3)), {u0: 2, u1: W - 2, v0: 2.6, v1: Math.max(3.4, D * 0.3)}, {ring: 1.0});
    d.backRow([['fittingRooms', 0]], 0.25, PROP_DEFS.fittingRooms.w + 0.6, {max: 1, front: 1.0});
    d.backRow([['fittingRooms', 0]], W - PROP_DEFS.fittingRooms.w - 0.6, W - 0.25, {max: 1, front: 1.0});
    d.backRow([['wallBay', 0], ['wallBay', 0], ['sneakerWall', 0]], 0.25, W - 0.25);
    d.sideRows([['wallBay', 0], ['clothingRack', 0]], 2.4, D - 1.2);
    d.islands('clothingRack', Math.round(Math.min(10, W * D / 30)), {u0: 2, u1: W - 2, v0: D * 0.35, v1: D * 0.8}, {ring: 0.8});
    d.islands('dressForm', 3, {u0: 2, u1: W - 2, v0: D * 0.32, v1: D * 0.75}, {ring: 0.6});
    d.islands('merchTable', 3, {u0: 2, u1: W - 2, v0: D * 0.35, v1: D * 0.8}, {ring: 0.9});
    d.islands('displayBed', 1, {u0: 2, u1: W - 2, v0: D * 0.62, v1: D - 2.4}, {ring: 0.9, along: false});
    d.islands('loungeArmchair', 2, {u0: 2, u1: W - 2, v0: D * 0.62, v1: D - 2}, {ring: 0.6});
    cashWrap(d, [['shopCounter', 0], ['shopCounter', 0]], 2, Math.max(3.5, D * 0.45));
    d.counterRun([['shopCounter', 0], ['glassCounter', 0]], Math.max(4, D * 0.7), W * 0.5 - 1.5, W * 0.5 + 1.5, {max: 2});
    void fr;
  },
  food(d, f) {
    const {W, D} = d;
    const P = STORE_PURPOSES[(f.cuisine ?? 'burger') as ShopUse];
    // the counter run across the front (display cases per cuisine), staff gap at one end, the kitchen line along the back wall
    const gapR = d.rng.chance(0.5);
    const mods: KindV[] = [];
    for (let i = 0; i < 6; i++) mods.push([d.rng.chance(P?.display ?? 0) && mods.filter(m => m[0] === 'shopDisplay').length < 2 ? 'shopDisplay' : 'shopCounter', i]);
    const run = d.counterRun(mods, 1.0, gapR ? 0.2 : 1.2, gapR ? W - 1.2 : W - 0.2);
    const till = run.find(p => p.kind === 'shopCounter');
    if (till) d.onTop(till, 'cashRegister', 0.35);
    const cooler = d.rng.chance(P?.cooler ?? 0.6) ? d.backRow([['shopCooler', 0]], gapR ? W - 1.0 : 0.15, gapR ? W - 0.15 : 1.0, {max: 1}) : 0;
    const kitchen = (P?.kitchen ?? [['shopBackbar', 0]]) as readonly KindV[];
    d.backRow(kitchen, cooler && !gapR ? 1.0 : 0.2, cooler && gapR ? W - 1.0 : W - 0.2);
    for (const r of P?.extras ?? []) d.sideRow(gapR ? 'L' : 'R', [[r.kind, typeof r.variant === 'number' ? r.variant : 0]], 2.4, D - 1.0, {max: 1});
    // bigger units: prep counters / the staff fridge / a chest freezer along the side walls behind the counter
    if (D >= 4.5) d.sideRows([['shopBackbar', 0], ['fridge', 0], ['chestFreezer', 0]], 2.2, D - 1.0, {max: W * D >= 50 ? 3 : 1});
  },
  cafe(d, f) {
    const {W, D} = d;
    const P = STORE_PURPOSES[(f.cuisine ?? 'coffee') as ShopUse];
    const gapR = d.rng.chance(0.5);
    const counterV = Math.min(D - 2.6, Math.max(1.0, D * 0.55));
    const run = d.counterRun([['shopCounter', 0], ['shopDisplay', 0], ['bakeryCase', 0]], counterV, gapR ? 0.2 : 1.2, gapR ? W - 1.2 : W - 0.2, {max: 3});
    const till = run.find(p => p.kind === 'shopCounter');
    if (till) d.onTop(till, 'cashRegister', 0.35);
    d.backRow([...(P?.kitchen ?? [['espressoBar', 0]]) as readonly KindV[], ['shopBackbar', 0]], 0.2, W - 1.1);
    d.backRow([['shopCooler', 0]], W - 1.0, W - 0.15, {max: 1});
    d.islands('table', W * D >= 40 ? 2 : 1, {u0: 1.5, u1: W - 1.5, v0: 1.8, v1: counterV - 1.2}, {ring: 0.8});
    d.againstWall('plasticStackChair', 2);
  },
  grocery(d) {
    const {W, D} = d;
    // checkout counters along the front with registers and impulse racks, carts by the entry
    const lanes = Math.max(1, Math.min(4, Math.floor((W - 3) / 3.2)));
    for (let k = 0; k < lanes; k++) {
      const u = 1.5 + k * 3.2;
      const c = d.counterRun([['shopCounter', k]], 2.5, u, u + 1.6, {max: 1});
      if (c[0]) { d.onTop(c[0], 'cashRegister', 0.35); d.put('snackRack', u + 2.05, 2.5 + PROP_DEFS.snackRack.d / 2 + 0.01, d.fr.face); }
    }
    d.againstWall('shoppingCart', 2, {walls: [d.fr.L, d.fr.R]});
    d.backRow([['shopCooler', 0]], 0.3, W - 0.3);
    d.sideRows([['stockShelf', sv('grocery')], ['stockShelf', sv('snacks')]], 3.8, D - 1.3);
    d.sideRow(d.rng.chance(0.5) ? 'L' : 'R', [['chestFreezer', 0]], 3.4, D - 1.4, {max: 2});
    d.islands('produceStand', W * D >= 160 ? 4 : 2, {u0: 1.8, u1: W - 1.8, v0: 4.0, v1: Math.min(D * 0.4, D - 4)}, {ring: 1.0});
    d.aisles('stockShelf', [sv('grocery'), sv('snacks'), sv('cleaning'), sv('grocery')], {u0: 1.4, u1: W - 1.4, v0: Math.max(5.4, D * 0.42), v1: D - 1.8}, 1.2);
  },
  books(d) {
    const {W, D} = d;
    d.sideRows([['lawBookcase', 0]], 1.4, D - 1.0);
    d.backRow([['lawBookcase', 0]], 0.25, W - 0.25);
    cashWrap(d, [['shopCounter', 0]], 1, 2.0);
    d.islands('merchTable', W * D >= 50 ? 3 : 2, {u0: 1.6, u1: W - 1.6, v0: 2.4, v1: D - 2.4}, {ring: 0.9});
    d.islands('magazineRack', 1, {u0: 1.4, u1: W - 1.4, v0: 2.0, v1: 3.2}, {ring: 0.8});
    d.islands('loungeArmchair', 2, {u0: 1.4, u1: W - 1.4, v0: D * 0.6, v1: D - 1.8}, {ring: 0.6});
  },
  toys(d) {
    const {W, D} = d;
    d.sideRows([['wallBay', 0]], 1.4, D - 1.0);
    d.backRow([['wallBay', 0]], 0.25, W - 0.25);
    cashWrap(d, [['shopCounter', 0]], 1, 2.0);
    d.againstWall('capsuleToyMachine', 2, {walls: [d.fr.L, d.fr.R]});
    d.islands('merchTable', 2, {u0: 1.6, u1: W - 1.6, v0: 2.6, v1: D - 2.4}, {ring: 0.9});
    if (W * D >= 50) d.islands('kiddieRide', 1, {u0: 1.6, u1: W - 1.6, v0: 2.6, v1: D - 2.2}, {ring: 0.9});
    d.islands('giantTeddy', 1, {u0: 1.2, u1: W - 1.2, v0: 2.2, v1: D - 1.6}, {ring: 0.6});
    d.islands('rockingHorse', 2, {u0: 1.2, u1: W - 1.2, v0: 2.2, v1: D - 1.6}, {ring: 0.6});
  },
  sports(d) {
    const {W, D} = d;
    d.sideRows([['wallBay', 0], ['sneakerWall', 0]], 1.4, D - 1.0);
    d.backRow([['wallBay', 0]], 0.25, W - 0.25);
    cashWrap(d, [['shopCounter', 0]], 1, 2.0);
    d.islands('treadmill', W * D >= 70 ? 2 : 1, {u0: 1.8, u1: W - 1.8, v0: D * 0.55, v1: D - 2.0}, {ring: 0.8, along: false});
    d.islands('clothingRack', 2, {u0: 1.6, u1: W - 1.6, v0: 2.6, v1: D * 0.55}, {ring: 0.8});
    d.islands('merchTable', 1, {u0: 1.6, u1: W - 1.6, v0: 2.6, v1: D - 2.2}, {ring: 0.9});
    d.islands('ottoman', 1, {u0: 1.2, u1: W - 1.2, v0: 2.4, v1: D - 1.6}, {ring: 0.7});
    d.againstWall('bicycle', 2);
  },
  jewelry(d) {
    const {W, D} = d;
    d.backRow([['glassCounter', 0], ['shopCounter', 0], ['glassCounter', 0]], 0.3, W - 0.3);
    const till = d.placed.find(p => p.kind === 'shopCounter');
    if (till) d.onTop(till, 'cashRegister', 0.35);
    d.sideRows([['glassCounter', 0]], 1.5, D - 1.2);
    d.islands('glassCounter', W * D >= 40 ? 2 : 1, {u0: 1.8, u1: W - 1.8, v0: 2.4, v1: D - 2.2}, {ring: 1.0});
  },
  home(d) {
    const {W, D} = d;
    d.backRow([['kitchenette', 0], ['fridge', 0], ['cabinetTall', 0]], 0.3, W - 0.3);
    d.sideRows([['cabinetLow', 0], ['wallBay', 0]], 1.6, D - 1.2);
    cashWrap(d, [['shopCounter', 0]], 1, 2.0);
    d.islands('displayBed', W * D >= 90 ? 2 : 1, {u0: 2, u1: W - 2, v0: D * 0.45, v1: D - 2.2}, {ring: 0.9, along: false});
    d.islands('lobbySofa', 1, {u0: 2, u1: W - 2, v0: 2.6, v1: D * 0.5}, {ring: 0.8});
    d.islands('loungeArmchair', 2, {u0: 1.6, u1: W - 1.6, v0: 2.4, v1: D - 1.8}, {ring: 0.6});
    d.islands('merchTable', 1, {u0: 1.8, u1: W - 1.8, v0: 2.4, v1: D - 2.2}, {ring: 0.9});
    d.againstWall('pottedPlantSmall', 2);
    d.islands('planterTree', 1, {u0: 1.2, u1: W - 1.2, v0: 1.6, v1: 3.0}, {ring: 0.6});
  },
  beauty(d) {
    const {W, D, fr} = d;
    d.sideRow('L', [['glassCounter', 0], ['wallBay', 0]], 1.4, D - 1.0);
    // salon station: chairs facing the opposite wall's mirror
    for (let k = 0, v = 2.2; k < 3 && v < D - 1.4; v += 1.4) if (d.put('salonChair', W - 0.75, v, OPP_ROT[fr.R])) k++;
    d.backRow([['wallBay', 0], ['glassCounter', 0]], 0.25, W - 0.25);
    cashWrap(d, [['shopCounter', 0]], 1, 2.0);
    d.islands('merchTable', 1, {u0: 1.8, u1: W - 1.8, v0: 2.6, v1: D - 2.2}, {ring: 0.9});
  },
  music(d) {
    const {W, D} = d;
    d.sideRows([['wallBay', 0]], 1.4, D - 1.0);
    d.backRow([['wallBay', 0], ['jukebox', 0], ['wallBay', 0]], 0.25, W - 0.25);
    cashWrap(d, [['glassCounter', 0], ['shopCounter', 0]], 2, 2.0);
    d.islands('merchTable', W * D >= 45 ? 3 : 2, {u0: 1.6, u1: W - 1.6, v0: 2.6, v1: D - 2.2}, {ring: 0.9});
    d.islands('loungeArmchair', 1, {u0: 1.4, u1: W - 1.4, v0: D * 0.6, v1: D - 1.6}, {ring: 0.6});
  },
  pet(d) {
    const {W, D} = d;
    const boards = [] as PropPlacement[];
    d.backRow([['cabinetLow', 0], ['cabinetLow', 0], ['stockShelf', sv('grocery')]], 0.3, W - 0.3);
    for (const p of d.placed) if (p.kind === 'cabinetLow') boards.push(p);
    for (const b of boards) d.onTop(b, 'aquarium', 0);
    d.sideRows([['stockShelf', sv('grocery')], ['wallBay', 0]], 2.6, D - 1.2);
    cashWrap(d, [['shopCounter', 0]], 1, 2.0);
    d.islands('catTree', 2, {u0: 1.4, u1: W - 1.4, v0: 2.4, v1: D - 1.8}, {ring: 0.7});
    d.islands('merchTable', 1, {u0: 1.8, u1: W - 1.8, v0: 2.6, v1: D - 2.2}, {ring: 0.9});
  },
  arcade(d) {
    const {W, D} = d;
    d.backRow([['arcadeCabinet', 0]], 0.25, W - 0.25);
    d.sideRows([['arcadeCabinet', 0], ['arcadeCabinet', 0], ['consoleStation', 0]], 2.6, D - 1.0);
    const counter = d.counterRun([['glassCounter', 0], ['shopCounter', 0]], 1.4, 0.4, 3.6, {max: 2});
    const till = counter.find(p => p.kind === 'shopCounter');
    if (till) d.onTop(till, 'cashRegister', 0.35);
    d.againstWall('capsuleToyMachine', 2);
    d.islands('foosballTable', 1, {u0: 2, u1: W - 2, v0: 3.2, v1: D - 2.4}, {ring: 0.9});
    if (W * D >= 70) d.islands('pingPongTable', 1, {u0: 2.2, u1: W - 2.2, v0: 3.4, v1: D - 2.6}, {ring: 1.0});
    d.islands('kiddieRide', 1, {u0: 1.6, u1: W - 1.6, v0: 2.6, v1: D - 2.2}, {ring: 0.8});
    d.againstWall('vending', 1, {front: 1.0});
  },
  luggage(d) {
    const {W, D} = d;
    d.sideRows([['wallBay', 0]], 1.4, D - 1.0);
    d.backRow([['wallBay', 0], ['glassCounter', 0]], 0.25, W - 0.25);
    cashWrap(d, [['shopCounter', 0]], 1, 2.0);
    d.islands('merchTable', 1, {u0: 1.6, u1: W - 1.6, v0: 2.6, v1: D - 2.2}, {ring: 0.9});
    d.islands('rollingSuitcase', 4, {u0: 1.2, u1: W - 1.2, v0: 2.2, v1: D - 1.4}, {ring: 0.5});
  },
  optical(d) {
    const {W, D} = d;
    d.sideRows([['wallBay', 0]], 1.4, D - 1.0);
    d.backRow([['glassCounter', 0], ['desk', 0]], 0.25, W - 0.25);
    d.islands('glassCounter', 1, {u0: 1.6, u1: W - 1.6, v0: 2.4, v1: D - 2.2}, {ring: 1.0});
    cashWrap(d, [['shopCounter', 0]], 1, 2.0);
    d.againstWall('officeChair', 1);
  },
  florist(d) {
    const {W, D} = d;
    d.backRow([['flowerStand', 0], ['shopCooler', 0], ['flowerStand', 0]], 0.25, W - 0.25);
    d.sideRows([['flowerStand', 0]], 2.2, D - 1.0, {max: 2});
    cashWrap(d, [['shopCounter', 0]], 1, 1.8);
    d.islands('merchTable', 1, {u0: 1.4, u1: W - 1.4, v0: 2.4, v1: D - 2.0}, {ring: 0.9});
    d.againstWall('pottedPlantSmall', 3);
    d.islands('planterTree', 1, {u0: 1.0, u1: W - 1.0, v0: 1.6, v1: 2.8}, {ring: 0.5});
  },
  kiosk(d) {
    const {W, D} = d;
    if (W >= 3 && D >= 3.4) {
      d.counterRun([['shopCounter', 0]], 1.0, Math.max(0.2, W / 2 - 1.0), Math.min(W - 0.2, W / 2 + 1.0), {max: 1});
      const till = d.placed.find(p => p.kind === 'shopCounter');
      if (till) d.onTop(till, 'cashRegister', 0.35);
    }
    d.backRow([['stockShelf', sv('snacks')], ['wallBay', 0]], 0.2, W - 0.2, {max: 2});
    d.againstWall('snackRack', 1, {walls: [d.fr.L, d.fr.R]});
  },
  security(d) {
    const {W, D} = d;
    d.backRow([['monitorDesk', 0], ['gunLocker', 0], ['cabinetTall', 0]], 0.3, W - 0.3);
    d.sideRows([['staffLockers', 0], ['cabinetTall', 0]], 1.6, D - 1.0, {max: 3});
    if (W * D >= 30) d.islands('cctvConsole', 1, {u0: 1.6, u1: W - 1.6, v0: 2.2, v1: D - 1.8}, {ring: 0.8});
    d.againstWall('crate', 1);
  },
  'first-aid'(d) {
    const {W, D} = d;
    d.backRow([['medCabinet', 0], ['medCabinet', 0], ['cabinetLow', 0]], 0.3, W - 0.3);
    d.sideRows([['wheeledStretcher', 0], ['crashCart', 0], ['desk', 0]], 1.6, D - 1.0, {max: 3});
    d.againstWall('wheelchair', 1);
  },
  management(d) {
    const {W, D} = d;
    d.backRow([['desk', 0], ['officeFiling', 0], ['desk', 0]], 0.3, W - 0.3);
    d.sideRows([['cabinetTall', 0], ['officeShelf', 0]], 1.6, D - 1.0, {max: 3});
    d.againstWall('officeChair', 2);
    d.againstWall('pottedPlantSmall', 1);
  },
  'customer-service'(d) {
    const {W, D} = d;
    d.counterRun([['shopCounter', 0], ['shopCounter', 0]], 1.8, W / 2 - 1.6, W / 2 + 1.6, {max: 2});
    d.backRow([['desk', 0], ['cabinetLow', 0]], 0.3, W - 0.3);
    d.sideRows([['lobbySofa', 0]], 1.4, D - 1.0, {max: 1});
    d.againstWall('pottedPlantSmall', 1);
  },
  janitorial(d) {
    const {W, D} = d;
    d.backRow([['mopSink', 0], ['stockShelf', sv('cleaning')], ['stockShelf', sv('cleaning')]], 0.3, W - 0.3);
    d.sideRows([['cabinetTall', 0]], 1.4, D - 1.0, {max: 1});
    d.againstWall('janitorCart', 1);
    d.againstWall('wetFloorSign', 1);
    d.againstWall('trashBagPile', 1);
  },
  vacant(d) {
    const {W, D} = d;
    // a stripped unit: a leftover shelf or two, sealed cartons, a crate, a ladder, rubbish, a barricade
    d.backRow([['shelf', 0]], 0.3, W - 0.3, {max: d.rng.int(0, 2)});
    d.againstWall('cartonStack', d.rng.int(1, 2));
    d.againstWall('crate', d.rng.int(0, 2));
    d.againstWall('stepLadder', d.rng.chance(0.5) ? 1 : 0);
    d.againstWall('trashBagPile', 1);
    if (W * D >= 30) d.againstWall('foldingBarricade', 1);
  },
};
const OPP_ROT: Record<Side, number> = {N: Math.PI, S: 0, W: -Math.PI / 2, E: Math.PI / 2};

/** Stock-room recipe by program (shelving runs on the long walls, cartons, crates, the program's extras). */
function dressBack(d: ShopDresser, f: MallShopFit): void {
  const {W, D} = d;
  const st: StockTheme = f.program === 'pharmacy' || f.program === 'clinic' ? 'pharmacy' : f.program === 'electronics' || f.program === 'phone' ? 'devices'
    : f.program === 'hardware' ? 'parts' : f.program === 'grocery' || f.kind === 'food' || f.program === 'cafe' ? 'grocery' : 'cartons';
  const shelf: KindV = f.program === 'guns' || f.program === 'hardware' || f.program === 'outdoors' ? ['shelf', 0] : ['stockShelf', sv(st)];
  const extras: Partial<Record<MallRecipe, readonly KindV[]>> = {
    guns: [['desk', 0], ['cabinetTall', 0], ['safe', 0], ['staffLockers', 0], ['gunLocker', 0], ['cabinetTall', 0]],
    pharmacy: [['medCabinet', 0], ['biohazardFridge', 0], ['cabinetTall', 0], ['desk', 0]],
    clinic: [['medCabinet', 0], ['biohazardFridge', 0], ['labBench', 0], ['cabinetTall', 0]],
    electronics: [['repairBench', 1], ['rollingToolChest', 0], ['cabinetTall', 0]],
    phone: [['repairBench', 1], ['cabinetLow', 0]],
    hardware: [['rollingToolChest', 0], ['cabinetTall', 0]],
    jewelry: [['desk', 0], ['vaultSafe', 0], ['safe', 0], ['cabinetTall', 0]],
    food: [['fridge', 0], ['kitchenette', 0], ['chestFreezer', 0]],
    cafe: [['fridge', 0], ['kitchenette', 0]],
    grocery: [['fridge', 0], ['chestFreezer', 0], ['fridge', 0]],
    clothing: [['clothingRack', 0], ['staffLockers', 0]],
    department: [['clothingRack', 0], ['staffLockers', 0], ['desk', 0]],
    pet: [['fridge', 0], ['cabinetTall', 0]],
    arcade: [['electricalPanel', 0], ['cabinetTall', 0]],
    music: [['cabinetLow', 0]],
    home: [['cabinetTall', 0]],
  };
  const long: Side[] = d.fr.W >= d.fr.D ? [d.fr.back, d.fr.side] : [d.fr.L, d.fr.R];
  // program extras first (they are what makes the room), then shelving runs, then cartons / crates
  const ex = extras[f.recipe] ?? [['cabinetTall', 0]];
  const ax = (s: Side) => s === 'N' || s === 'S';
  d.wallRun(long[0], ex, ax(long[0]) ? d.fr.x0 + 0.3 : d.fr.z0 + 0.3, ax(long[0]) ? d.fr.x1 - 0.3 : d.fr.z1 - 0.3);
  for (const s of long) {
    const alongX = s === 'N' || s === 'S';
    d.wallRun(s, [shelf], alongX ? d.fr.x0 + 0.3 : d.fr.z0 + 0.3, alongX ? d.fr.x1 - 0.3 : d.fr.z1 - 0.3);
  }
  if (W * D >= 14 && W >= 4 && D >= 4) d.islands(shelf[0], 2, {u0: 1.4, u1: W - 1.4, v0: 1.6, v1: D - 1.6}, {ring: 0.9, variant: shelf[1], along: d.fr.W >= d.fr.D});
  d.againstWall('cartonStack', d.rng.int(1, 2));
  d.againstWall('crate', d.rng.int(1, 3));
  if (f.program === 'grocery' || f.kind === 'anchor') d.againstWall('handTruck', 1);
}

// ---------------------------------------------------------------------------------------------
// Entry point

export interface MallDressOpts {
  /** 'local' (default): authored in each storey's local height frame, lifted by stationDress.dress(); 'absolute': lifted here. */
  frame?: 'local' | 'absolute';
  /** Add ceiling lights to shop areas that have none (default true). */
  lights?: boolean;
  /** Collision blockers for the shopfront glazing / closed shutters (default true; lane ARCH draws them). */
  fronts?: boolean;
}

export interface ShopDressReport {
  shop: string;
  area: number;
  backroom?: number;
  recipe: MallRecipe;
  props: number;
  backProps: number;
  holders: number;
  /** Props per 10 m² of sales floor (interior substance). */
  density: number;
}

/** Holder kinds counted as "holders" in the report (items/loot.ts holders; loose by kind name to stay three-free here). */
const HOLDERISH = new Set(['shopCounter', 'shopDisplay', 'shopBackbar', 'shopCooler', 'stockShelf', 'shelf', 'snackRack', 'glassCounter', 'merchTable', 'wallBay', 'produceStand',
  'medCabinet', 'gunLocker', 'safe', 'staffLockers', 'cabinetTall', 'cabinetLow', 'crate', 'fridge', 'kitchenette', 'desk', 'monitorDesk', 'table', 'chestFreezer', 'shoppingCart',
  'crashCart', 'wheeledStretcher', 'rollingToolChest', 'examTable', 'biohazardFridge', 'labBench', 'vaultSafe', 'bakeryCase', 'officeFiling', 'vending', 'stall',
  'grillLine', 'espressoBar', 'wokLine', 'deliLine', 'blenderBar', 'hotdogCart', 'bin']);

/** Dresses every shop of layout.mall (after assignMallPrograms). Returns one report per shop. */
export function dressMallShops(layout: StationLayout, rng: Rng, opts: MallDressOpts = {}): ShopDressReport[] {
  const mall = layout.mall;
  if (!mall) return [];
  const ctxs = new Map<number, PlaceCtx>();
  const ctxOf = (level: number): PlaceCtx => {
    let c = ctxs.get(level);
    if (!c) ctxs.set(level, (c = makePlaceCtx(layout, rng, level)));
    return c;
  };
  const first = layout.props.length;
  const reports: ShopDressReport[] = [];
  for (const s of mall.shops) {
    const fit = shopFit(s);
    const a = layout.areas[s.area];
    if (!fit || !a) continue;
    const srng = rng.fork(`shop:${s.id}`);
    const base = ctxOf(areaLevel(a));
    const ctx: PlaceCtx = {...base, rng: srng};
    const side = frontageSide(a, s);
    const frontStart = side === 'N' || side === 'S' ? Math.min(s.frontage.x0, s.frontage.x1) : Math.min(s.frontage.z0, s.frontage.z1);
    const fr = frameOf(a, side, fit.entry, frontStart);
    const d = new ShopDresser(layout, ctx, fr, srng);
    if (opts.fronts !== false) shopfront(layout, ctx, s, fit, fr);
    // the way in stays open: a 2 m deep keep-out behind the entry span (open counter fronts — food units, kiosks — serve over the
    // counter from the gallery: their door zone is enough; other open fronts keep a 3 m wide walk-in lane)
    if (fit.front === 'glazed') d.keep(fr.entry[0] - 0.25, fr.entry[1] + 0.25, 0, Math.min(2.0, fr.D * 0.4));
    else if (fit.kind !== 'food' && fit.kind !== 'kiosk') d.keep(fr.W / 2 - 1.5, fr.W / 2 + 1.5, 0, Math.min(2.0, fr.D * 0.4));
    RECIPES[fit.recipe](d, fit);
    let backProps = 0;
    if (s.backroom !== undefined && layout.areas[s.backroom]) {
      const b = layout.areas[s.backroom];
      const bctx: PlaceCtx = {...ctxOf(areaLevel(b)), rng: srng.fork('back')};
      const bd = new ShopDresser(layout, bctx, frameOf(b, backFront(layout, b, a)), bctx.rng);
      dressBack(bd, fit);
      backProps = bd.placed.length;
      d.placed.push(...bd.placed);
      if (opts.lights !== false) shopLights(layout, b, 3.5);
    }
    if (opts.lights !== false) shopLights(layout, a, 4.0);
    const own = d.placed.filter(p => p.area === a.id);
    const m2 = Math.max(1, s.salesArea || a.w * a.h * CELL * CELL);
    reports.push({shop: s.id, area: a.id, ...(s.backroom !== undefined ? {backroom: s.backroom} : {}), recipe: fit.recipe, props: own.length, backProps,
      holders: d.placed.filter(p => HOLDERISH.has(p.kind)).length, density: Math.round(own.length / m2 * 100) / 10});
  }
  if (opts.frame === 'absolute') liftPlaced(layout, first);
  return reports;
}

/** Side of the stock room facing the sales floor (its door wall), so its frame's "front" is the door. */
function backFront(layout: StationLayout, b: Area, a: Area): Side {
  if (b.y + b.h <= a.y) return 'S';
  if (b.y >= a.y + a.h) return 'N';
  if (b.x + b.w <= a.x) return 'E';
  if (b.x >= a.x + a.w) return 'W';
  void layout;
  return b.w >= b.h ? 'S' : 'E';
}

/** Glazing beside the entry span (glazed fronts) / a rolled-down shutter across a closed unit: collision-only blockers in the frontage row. */
function shopfront(layout: StationLayout, ctx: PlaceCtx, s: MallShop, fit: MallShopFit, fr: ShopFrame): void {
  const a = fr.a;
  const f = s.frontage;
  const alongX = fr.side === 'N' || fr.side === 'S';
  // the frontage row: the door row of the record when it has thickness, else the unit's first interior row
  const thick = alongX ? Math.abs(f.z1 - f.z0) : Math.abs(f.x1 - f.x0);
  const inset = thick >= 0.4 ? null : CELL / 2;
  const line = inset === null ? (alongX ? (f.z0 + f.z1) / 2 : (f.x0 + f.x1) / 2)
    : fr.side === 'N' ? fr.z0 + inset : fr.side === 'S' ? fr.z1 - inset : fr.side === 'W' ? fr.x0 + inset : fr.x1 - inset;
  const fs = alongX ? Math.min(f.x0, f.x1) : Math.min(f.z0, f.z1), fe = alongX ? Math.max(f.x0, f.x1) : Math.max(f.z0, f.z1);
  const head = Math.min(3.2, Math.max(2.4, relCeil(layout, a) - 0.1));
  const span = (t0: number, t1: number, kind: 'shopGlazing' | 'shopShutter') => {
    if (t1 - t0 < 0.3) return;
    const c = (t0 + t1) / 2, half = (t1 - t0) / 2 - 0.02;
    const x = alongX ? c : line, z = alongX ? line : c;
    forceProp(ctx, a, kind, r3(x), r3(z), alongX ? half : 0.06, alongX ? 0.06 : half, head, kind === 'shopShutter');
  };
  if (fit.shutter === 'closed') { span(fs, fe, 'shopShutter'); return; }
  if (fit.front !== 'glazed') return;
  const off = fs - (alongX ? fr.x0 : fr.z0);
  const e0 = fs + Math.max(0, fr.entry[0] - off), e1 = fs + Math.min(fe - fs, fr.entry[1] - off);
  span(snapDn(fs + 1e-6), snapDn(e0 + 1e-6), 'shopGlazing');
  span(snapUp(e1 - 1e-6), snapUp(fe - 1e-6), 'shopGlazing');
}

/** A grid of ceiling lights over a shop area (absolute y, level-tagged), unless the area already has fixtures. */
function shopLights(layout: StationLayout, a: Area, step: number): void {
  if (layout.lights.some(l => l.area === a.id)) return;
  const lv = areaLevel(a);
  const w = a.w * CELL, h = a.h * CELL, nx = Math.max(1, Math.round(w / step)), nz = Math.max(1, Math.round(h / step));
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
    const x = a.x * CELL + w * (i + 0.5) / nx, z = a.y * CELL + h * (j + 0.5) / nz;
    layout.lights.push({x: r3(x), y: r3(a.ceil - 0.02), z: r3(z), rot: w >= h ? 0 : Math.PI / 2, area: a.id, broken: false, flicker: false, warm: true, power: 1, dying: false, ...(lv ? {level: lv} : {})});
  }
}

/** Moves the props placed since `from` from their storey's local height frame to absolute heights (like stationDress.liftLevels). */
export function liftPlaced(layout: StationLayout, from: number): void {
  const floorAt = (p: PropPlacement): number => {
    const g = levelGrid(layout, p.level ?? 0), a = layout.areas[p.area];
    const [cx, cy] = g.cellOf(p.x, p.z);
    const i = g.inBounds(cx, cy) ? g.idx(cx, cy) : -1;
    return i >= 0 && g.cells[i] === FLOOR && g.rampIdx[i] < 0 ? g.floorOf(i) : a ? areaBase(layout, a) : 0;
  };
  for (let k = from; k < layout.props.length; k++) { const p = layout.props[k]; if (p.level && p.host === undefined) p.y += floorAt(p); }
  for (let k = from; k < layout.props.length; k++) { const p = layout.props[k]; if (p.level && p.host !== undefined) p.y += floorAt(layout.props[p.host]); }
}
