// Task track3-eaton-centre-20261031 (lane SHOPS): THE EATON'S CENTER SHOP INTERIORS — dresses every shop unit (sales floor + stock
// room) of layout.mall from its program's RECIPE. Pure data (no three.js), deterministic per shop (`shop:<id>` fork of the dressing
// rng, so one shop never shifts another's draws).
//
// User (track 3): "the shops should be very substantial very detailed ... I don't want a quick result with small little dinky things
// I want it to be really a real exploration". Every recipe is a real store layout, distinct per program:
//   gun shop      — a glass-counter run across the floor with the staff zone behind it: empty floor-standing long-gun racks along
//                   the back wall between steel ammo shelving and the forced gun locker, display benches on the customer side (the
//                   weapon plan's finds lie on them), accessory bays; back office (desk, cabinets, safe, lockers, crates, ammo shelving);
//   (lane ASSETS batch 1, integrated by lane SHOPS: the cash wrap's wall-backed back counter with drawers + cupboard behind most
//   wraps, glass display cabinets, back-to-back gondola aisles, clothing bays with garments on their rails, the dispensary back
//   counter, checkout lanes, pipe-and-plank shelving, shoe walls, food-court table sets, storage totes in the stock rooms; the
//   gallery commons — kiosk carts, food-hall seating — in gen/mall/commons.ts)
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
  placeAgainstWall, // (Task mall-playtest-revision-20261031, lane SHOPS U09: the arcade's vending machine)
  type PlaceCtx,
} from '../placeKit';
import {stockVariant, type StockTheme} from '../purposeShapes';
import {STORE_PURPOSES} from '../purposes';
import type {Area, ShopUse, Side, StationLayout} from '../stationTypes';
import type {MallShop} from './mallTypes';
import {GARMENT_RAIL_Y, MALL_MOUNT_Y} from './kinds';
import {dressMallCommons, type CommonsReport} from './commons';
import {placeMallAds, type MallAdsReport} from './ads'; // Task mall-playtest-revision-20261031 (lane SHOPS, D06)
import {inferLot, shopFit, type MallRecipe, type MallShopFit} from './shops';
import {mallLot, type MallLotFamily} from './lots'; // Task mall-playtest-revision-20261031 (lane GEN's lot families)
import {dressMannequin, hangLingerie, placeChangingSuite, rackCode} from './lingerieStore'; // task mall-lingerie-20261102 / store-polish (lane STORE)

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
/** Free floor (m) kept beside both ends of a wall-placed kind whose lid / flaps need room (U10 follow-up: the flap-top carton). */
const SIDE_GAP: Readonly<Partial<Record<PropKind, number>>> = {cardboardBoxFlaps: 0.35};
/** Task mall-playtest-revision-20261031 (lane SHOPS, D02): lattice spots tried per island the coarse grid could not place. */
const ISLAND_FILL_TRIES = 40;

type KindV = readonly [PropKind, number];

export class ShopDresser {
  readonly placed: PropPlacement[] = [];
  /** Task mall-playtest-revision-20261031 (lane SHOPS, D02): the unit's lot family (gen/mall/lots.ts; inferred for lot-less units). */
  lot?: MallLotFamily;
  /** Task mall-lingerie-20261102 (lane STORE): the shop record being dressed (a recipe may record on it: MallShop.changing). */
  shop?: MallShop;
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
    // Task mall-playtest-revision-20261031 (lane SHOPS, D02 "dense with props"): the coarse grid above misses free floor between the
    // pieces already placed (a corner unit's second entry, a focal display, wall runs): a seeded pass over a 0.5 m lattice of the zone
    // fills the rest of the requested count (bounded: ISLAND_FILL_TRIES per missing island)
    if (out.length < n) {
      const lattice: [number, number][] = [];
      for (let v = zone.v0; v <= zone.v1 + 1e-6; v += 0.5) for (let u = zone.u0; u <= zone.u1 + 1e-6; u += 0.5) lattice.push([Math.round(u * 4) / 4, Math.round(v * 4) / 4]);
      let tries = (n - out.length) * ISLAND_FILL_TRIES;
      for (const [u, v] of this.rng.shuffle(lattice)) {
        if (out.length >= n || tries-- <= 0) break;
        const p = this.put(kind, u, v, rot, {ring, variant: o.variant});
        if (p) out.push(p);
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
        if (p) {
          this.placed.push(p); k++;
          // Task mall-playtest-revision-20261031 (lane SHOPS, U10 follow-up): a flap-top carton keeps SIDE_GAP free beside both ends
          // along the wall — a carton stack pressed against it cramped its flaps to 10-20 degrees (its finds hidden)
          const gap = SIDE_GAP[kind];
          if (gap) {
            const hw = PROP_DEFS[kind].w / 2, hd = PROP_DEFS[kind].d / 2;
            for (const sgn of [-1, 1]) {
              const c = along + sgn * (hw + gap / 2);
              const [x0, z0] = alongX ? [c - gap / 2, s.z - hd] : [s.x - hd, c - gap / 2], [x1, z1] = alongX ? [c + gap / 2, s.z + hd] : [s.x + hd, c + gap / 2];
              const [cx0, cy0, cx1, cy1] = cellsOfBox((x0 + x1) / 2, (z0 + z1) / 2, (x1 - x0) / 2, (z1 - z0) / 2);
              for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
                const g = this.ctx.g;
                if (g.inBounds(cx, cy) && g.area[g.idx(cx, cy)] === this.a.id && !g.blocked[g.idx(cx, cy)]) markCell(this.ctx, this.ctx.keep, g.idx(cx, cy));
              }
            }
          }
          break;
        }
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

  /**
   * Hangs `kind` (a garment group) from a rail host, its hook line at the host's measured rail height (gen/mall/kinds.ts
   * GARMENT_RAIL_Y: rail 1.53, round ring 1.31, the M08 clothing bay's rail 1.915), `du` along the host's local x (host decor: it
   * rides the rail).
   */
  hang(host: PropPlacement, kind: PropKind, du = 0, dv = 0): PropPlacement | null {
    const hi = this.layout.props.indexOf(host);
    if (hi < 0) return null;
    const def = PROP_DEFS[kind], hd = PROP_DEFS[host.kind];
    const rail = GARMENT_RAIL_Y[host.kind as keyof typeof GARMENT_RAIL_Y] ?? hd.h - 0.02;
    if (def.h >= rail || Math.abs(du) + def.w / 2 > hd.w / 2 + 1e-6) return null;
    const {hx, hz} = footprint(kind, host.rot);
    // (round 4, lane GARMENTS: `dv` along the host's local +Z — a women's group's own hook rod sits behind its bounds centre)
    const x = host.x + Math.cos(host.rot) * du + Math.sin(host.rot) * dv, z = host.z - Math.sin(host.rot) * du + Math.cos(host.rot) * dv;
    const p: PropPlacement = {kind, x: r3(x), z: r3(z), y: host.y + r3(rail - def.h), rot: host.rot, area: host.area, hx, hz, h: def.h, blocksSight: false, variant: 0,
      host: hi, ...(host.level ? {level: host.level} : {})};
    this.layout.props.push(p);
    this.placed.push(p);
    return p;
  }
  /**
   * Garment groups on a share of the rails just placed (a looted store: some rails stripped bare); a clothing bay takes two. Task
   * mall-round4-20261101 (lane GARMENTS): `women` = the chance a rail carries the WOMEN'S face-out groups instead of M06 (womenswear 1,
   * a department floor part of its rails, menswear / clothing 0 — no extra draw then, so those stores dress exactly as before).
   */
  dressRails(rails: readonly PropPlacement[], share = 0.65, women = 0): void {
    for (const r of rails) {
      if (women > 0 && WOMENS_HANGS[r.kind] && (women >= 1 || this.rng.chance(women))) { if (this.rng.chance(share)) this.hangWomen(r); continue; }
      if (r.kind === 'clothingWallUnit') { for (const du of [-0.55, 0.55]) if (this.rng.chance(share)) this.hang(r, 'garmentHangingGroup', du); }
      else if ((r.kind === 'garmentRail' || r.kind === 'garmentRailRound') && this.rng.chance(share)) this.hang(r, 'garmentHangingGroup');
    }
  }
  /** Dresses the clothing bays (lane ASSETS M08) placed so far that carry nothing yet: garment groups on their rails. */
  dressWallUnits(share = 0.7, women = 0): void {
    const hosts = new Set(this.layout.props.map(p => p.host).filter((h): h is number => h !== undefined));
    this.dressRails(this.placed.filter(p => p.kind === 'clothingWallUnit' && !hosts.has(this.layout.props.indexOf(p))), share, women);
  }
  /**
   * Task mall-round4-20261101 (lane GARMENTS): hangs one of the host's women's options (WOMENS_HANGS, seeded) whose every group FITS:
   * its hem clears the floor by HEM_CLEAR under the host's rail (GARMENT_RAIL_Y) and the face-out row stays within the host's usable
   * width (a round rack: WOMENS_ROUND_W of its ring — a straight row wider than that would poke out). Riders face the host's front.
   */
  hangWomen(r: PropPlacement): boolean {
    const opts = WOMENS_HANGS[r.kind];
    const rail = GARMENT_RAIL_Y[r.kind as keyof typeof GARMENT_RAIL_Y];
    if (!opts || rail === undefined) return false;
    const usable = PROP_DEFS[r.kind].w * (r.kind === 'garmentRailRound' ? WOMENS_ROUND_W : 1) / 2;
    const fit = opts.filter(o => o.every(([k, du]) => PROP_DEFS[k].h <= rail - HEM_CLEAR && Math.abs(du) + PROP_DEFS[k].w / 2 <= usable + 1e-6));
    if (!fit.length) return false;
    const o = fit[this.rng.int(0, fit.length - 1)];
    for (const [k, du] of o) this.hang(r, k, du, WOMENS_ROD_Z[k] ?? 0);
    return true;
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

const FRONT_KINDS: ReadonlySet<string> = new Set(['stockShelf', 'shelf', 'wallBay', 'glassCounter', 'shopCooler', 'deviceWall', 'medCabinet', 'gunLocker', 'flowerStand',
  'bookstoreBookcase', 'shopCounter', 'arcadeCabinet', 'magazineRack',
  // lane ASSETS batch 1 open holders against a wall
  'retailGondola', 'clothingWallUnit', 'outdoorsPlankShelving', 'shoeWallDisplay',
  // batch 2 resume (12c)
  'multideckOpenCooler', 'cosmeticsWallUnit']);
/**
 * Swing / drawer strips (m) of the lane ASSETS openables, measured on their models (world/openablesSpec.ts): the cash-wrap counter's
 * drawers travel 0.38 m and its cupboard door is 0.44 m wide, the dispensary's cupboard doors ~0.4 m, the glass cabinet's doors
 * 0.45 m, the kiosk cart's lower doors 0.77 m (a staff member crouches in front of them).
 */
const OPENABLE_STRIP: Readonly<Partial<Record<PropKind, number>>> = {mallCashwrapCounter: 0.9, pharmacyDispensaryCounter: 0.9, glassDisplayCabinet: 0.7, mallKioskCart: 0.9,
  medicineDrawerCabinet: 0.7, // (batch 2 M29: a 0.46 m door, drawers travel 0.3 m)
  gunSafeTall: 0.7, dresserDrawers: 0.7}; // (12c: the safe's 0.58 m door, the dresser's drawers travel 0.3 m)
/**
 * Task mall-round4-20261101 (lane GARMENTS — user: "we need to generate female cloths for the female store (else it doesn't match up)"):
 * the women's face-out garment groups each rail host may carry, by hanging length (an option = groups [kind, offset along the host's x]):
 * the long dresses (~1.05 m) on a straight rail (rail 1.53 m) or centred on a clothing bay (1.915 m); blouses (~0.65 m) on a straight rail
 * or two to a bay; skirts (~0.76 m) on a round rack (ring 1.31 m) or beside blouses on a bay. hangWomen keeps only the options that fit.
 */
const WOMENS_HANGS: Readonly<Partial<Record<PropKind, readonly (readonly (readonly [PropKind, number])[])[]>>> = {
  garmentRail: [[['womensDressesGroup', 0]], [['womensDressesGroup', 0]], [['womensBlousesGroup', 0]]],
  garmentRailRound: [[['womensSkirtsGroup', 0]]],
  clothingWallUnit: [[['womensDressesGroup', 0]], [['womensBlousesGroup', -0.55], ['womensSkirtsGroup', 0.55]], [['womensSkirtsGroup', -0.55], ['womensBlousesGroup', 0.55]]],
};
/** Share of a department store's rails / bays on its women's side (the rest keep M06). */
export const DEPT_WOMENS = 0.4;
/**
 * Each women's group's own hook rod lies this far BEHIND its bounds centre (measured on the cooked M82 / M83 / M84: dresses 6-8 cm,
 * blouses 3.4-4.4 cm, skirts 1-4 cm; lanes/GARMENTS-ASSETS.part): the rider shifts forward by it so its rod sits on the host's rail line.
 */
export const WOMENS_ROD_Z: Readonly<Partial<Record<PropKind, number>>> = {womensDressesGroup: 0.07, womensBlousesGroup: 0.039, womensSkirtsGroup: 0.025};
/** Minimum floor clearance (m) of a hung women's group's hem. */
const HEM_CLEAR = 0.15;
/** Share of a round rack's ring width a straight face-out row may span (wider would poke out of the ring). */
const WOMENS_ROUND_W = 0.7;
/** Access strip for a kind placed against a wall: holders / displays keep a customer strip, openables their swing (placeKit adds it). */
function frontFor(kind: PropKind): number {
  const strip = OPENABLE_STRIP[kind];
  if (strip !== undefined) return strip;
  if (FRONT_KINDS.has(kind)) return HOLDER_FRONT;
  if (kind === 'cabinetTall' || kind === 'cabinetLow' || kind === 'staffLockers' || kind === 'safe' || kind === 'officeFiling') return 0.7;
  return 0.5;
}
/** Belt deck of the M12 checkout lane (measured: the deck plane 0.89 inside a 0.90 rim). */
const CHECKOUT_TOP_Y = 0.89;
/** Top (support) height of a host kind, prop-relative. */
function topOf(kind: PropKind): number | undefined {
  if (kind === 'shopCounter') return SHOP_COUNTER_TOP_Y;
  if (kind === 'checkoutLane') return CHECKOUT_TOP_Y;
  if (kind === 'cabinetLow' || kind === 'desk' || kind === 'merchTable') return PROP_DEFS[kind].h;
  return undefined;
}

// ---------------------------------------------------------------------------------------------
// Recipes

type Recipe = (d: ShopDresser, f: MallShopFit) => void;
const sv = (t: StockTheme) => stockVariant(t);
/** An island count scaled with the sales floor: one per `per` m², clamped to [lo, hi]. */
const per = (d: ShopDresser, m2: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(d.W * d.D / m2)));

/**
 * Cash wrap: a short counter run (+ register) facing the customers on the side away from the entry, at depth v; behind it, on the
 * near side wall, the wall-backed back counter (lane ASSETS M01 `mallCashwrapCounter`: 5 drawers + a cupboard to the staff side,
 * an open niche, the hutch) when the wall there is free (a recipe that runs the wrap before its side rows gets it most often).
 */
function cashWrap(d: ShopDresser, kinds: readonly KindV[], n: number, v = 2.0, back = true, side?: 'L' | 'R'): PropPlacement[] {
  const {W, fr} = d;
  // Task mall-playtest-revision-20261031 (lane SHOPS, D02): a narrow deep boutique has its till at the far end (lots.ts layout intent)
  if (d.lot?.shape === 'narrow-deep' && d.D >= 8) { v = Math.max(v, d.D - 2.6); back = false; }
  const entryMid = (fr.entry[0] + fr.entry[1]) / 2;
  // entry on the right half -> wrap on the left (task mall-lingerie-20261102, lane STORE: `side` forces it, off the changing area)
  const leftSide = side ? side === 'L' : entryMid > W / 2;
  const len = kinds.slice(0, n).reduce((s, [k]) => s + slot(PROP_DEFS[k].w), 0) || slot(PROP_DEFS.shopCounter.w) * n;
  const u0 = leftSide ? 1.0 : Math.max(1.0, W - 1.0 - len), u1 = Math.min(W - 1.0, u0 + len + 0.01);
  const run = d.counterRun(kinds, v, u0, u1, {max: n});
  const reg = run.find(p => p.kind === 'shopCounter');
  if (reg) d.onTop(reg, 'cashRegister', 0.35);
  if (back && run.length) {
    // the staff stand behind the wrap (its counters span v .. v + 0.75): the back counter starts just past them, drawers to the room
    const V = snapUp(v) + PROP_DEFS.shopCounter.d + 0.1;
    d.sideRow(leftSide ? 'L' : 'R', [['mallCashwrapCounter', 0]], V, Math.min(d.D - 0.3, V + 3.4), {max: 1});
  }
  return run;
}
/**
 * Café sets (lane ASSETS M31 bistro table + M32 chairs; both movable): up to n tables on a seeded grid of the zone, each with a chair
 * on either side (along u) facing it; a 0.6 m keep ring round each set keeps the next set off it. Returns the tables placed. The table
 * stands on a cell corner (its 0.75 m disc on 2 x 2 cells) and each chair on the next cell centre beside it (0.54 m deep: one cell),
 * ~0.1 m off the table edge.
 */
function bistroSets(d: ShopDresser, n: number, zone: {u0: number; u1: number; v0: number; v1: number}): number {
  const T = PROP_DEFS.cafeBistroTable, C = PROP_DEFS.cafeChair;
  const off = 1.5 * CELL, half = off + C.d / 2;
  const spots: [number, number][] = [];
  for (let v = zone.v0 + T.d / 2; v <= zone.v1 - T.d / 2 + 1e-6; v += T.d + 1.6) for (let u = zone.u0 + half; u <= zone.u1 - half + 1e-6; u += 2 * half + 1.0) spots.push([u, v]);
  let k = 0;
  for (const [u, v] of d.rng.shuffle(spots)) {
    if (k >= n) break;
    const uu = Math.round(u / CELL) * CELL, vv = Math.round(v / CELL) * CELL;
    if (!d.put('cafeBistroTable', uu, vv, d.fr.face)) continue;
    k++;
    d.put('cafeChair', uu - off, vv, d.fr.plusU);
    d.put('cafeChair', uu + off, vv, d.fr.minusU);
    d.keep(uu - half - 0.6, uu + half + 0.6, vv - T.d / 2 - 0.6, vv + T.d / 2 + 0.6);
  }
  return k;
}
/**
 * Display mannequins in the shop window beside the entry (facing the gallery). Task mall-round3-20261031 (lane SHOPS, R4): `kind` may be
 * a list (cycled: a department store's window mixes the female forms with the M07 figure).
 */
function windowDisplay(d: ShopDresser, kind: PropKind | readonly PropKind[], n: number): number {
  const {fr, W} = d;
  const kinds = typeof kind === 'string' ? [kind] : kind;
  let k = 0;
  // (a four-form window — a wide women's showroom — also tries 3.3 m in from each side)
  const spots = [0.9, W - 0.9, 2.1, W - 2.1, ...(n >= 4 ? [3.3, W - 3.3] : [])].filter(u => u < fr.entry[0] - 0.6 || u > fr.entry[1] + 0.6);
  for (const u of spots) { if (k >= n) break; if (d.put(kinds[k % kinds.length], u, 1.35, fr.face)) k++; }
  return k;
}

/**
 * Task mall-round3-20261031 (lane SHOPS, R4 — user: "This asset will be handy in other spots, because it will be spooooky!"): the
 * female mannequin's SPOOKY spots outside the fashion floors — a lone form standing in a back room (in a corner facing the wall, or at
 * the far wall facing the door) of a fashion / department stock room, or in the middle of a stripped vacant unit staring out through
 * its glass. Seeded on the shop's own `spooky` fork (the shop's other draws are unchanged), bounded per mall (`perMall`), placed through
 * the shared primitive (never forced, never in a doorway / access strip), standing on the floor; nothing is hung on it (rule 4). The
 * department floor mixes the forms with the M07 figure (its recipe). A TOPPLED form is not authored (props have no roll / pitch pose):
 * it topples for real when shot or bumped (light dynamic physics).
 */
export const SPOOKY_MANNEQUINS = {
  perMall: 4,
  /** Chance per stock room of these programs. */
  back: {womenswear: 0.7, clothing: 0.45, department: 0.5, shoes: 0.25} as Readonly<Partial<Record<string, number>>>,
  /** Chance per vacant sales floor. */
  vacant: 0.4,
} as const;
/** One spooky female mannequin in `d`'s room ('back': corner facing the wall / far wall facing the door; 'vacant': mid-floor facing out). */
function spookyMannequin(d: ShopDresser, mode: 'back' | 'vacant', rng: Rng): PropPlacement | null {
  const {fr, W, D} = d;
  if (mode === 'vacant') {
    for (let t = 0; t < 14; t++) {
      const u = Math.round(rng.range(Math.min(1.4, W / 2), Math.max(W / 2, W - 1.4)) * 4) / 4, v = Math.round(rng.range(Math.min(2.6, D / 2), Math.max(D / 2, D - 1.4)) * 4) / 4;
      const [x, z] = uvXZ(fr, u, v);
      const p = tryPlaceProp(d.ctx, d.a, 'mannequinFemale', r3(x), r3(z), fr.face + rng.range(-0.35, 0.35), {ring: 0.5});
      if (p) { d.placed.push(p); return p; }
    }
    return null;
  }
  const faceWall = rng.chance(0.5);
  const walls: Side[] = faceWall ? rng.shuffle([fr.L, fr.R, fr.back]) : [fr.back, ...rng.shuffle([fr.L, fr.R])];
  const def = PROP_DEFS.mannequinFemale;
  for (const wall of walls) {
    const alongX = wall === 'N' || wall === 'S';
    const lo = (alongX ? fr.x0 : fr.z0) + def.w / 2 + 0.2, hi = (alongX ? fr.x1 : fr.z1) - def.w / 2 - 0.2;
    if (hi < lo) continue;
    // a corner first (facing the wall), else anywhere along the wall
    for (const along of faceWall ? [lo, hi, (lo + hi) / 2] : [(lo + hi) / 2, lo + (hi - lo) * 0.3, lo + (hi - lo) * 0.7]) {
      const s = wallSpot(d.a, wall, Math.round(along * 4) / 4, 'mannequinFemale');
      const p = tryPlaceProp(d.ctx, d.a, 'mannequinFemale', r3(s.x), r3(s.z), faceWall ? s.rot + Math.PI : s.rot, {front: 0.5});
      if (p) { d.placed.push(p); return p; }
    }
  }
  return null;
}

/**
 * Task mall-playtest-revision-20261031 (lane SHOPS, D02 — "the stores ... a bit more character, a bit more love"): each program's FOCAL
 * merchandising piece on the entry axis just behind the entry keep-out, facing the walkway — the first thing seen through the door:
 * the gun shop's first display bench, a mannequin pair in the clothing / department store, the outfitter's pitched tent, the toy shop's
 * giant teddy, a TV table in electronics, a new-releases table in the bookshop … An END unit (lots.ts 'end') puts it on the corridor
 * axis further in. Skipped when it does not fit (never forced).
 */
const FOCAL: Partial<Record<MallRecipe, readonly KindV[]>> = {
  guns: [['gunDisplay', 0]], clothing: [['mannequinFull', 0], ['mannequinFull', 1]], department: [['mannequinFull', 0], ['mannequinFull', 1]],
  womenswear: [['mannequinFemale', 0], ['mannequinFemale', 1]], // task mall-round3-20261031 (lane SHOPS, R4)
  shoes: [['merchTable', 0]], sports: [['merchTable', 0]], outdoors: [['merchTable', 0]], electronics: [['merchTable', 0]], phone: [['techDisplay', 0]],
  books: [['merchTable', 0]], toys: [['giantTeddy', 0]], home: [['merchTable', 0]], beauty: [['glassCounter', 0]], jewelry: [['glassCounter', 0]],
  optical: [['glassCounter', 0]], music: [['merchTable', 0]], pet: [['catTree', 0]], luggage: [['rollingSuitcase', 0], ['rollingSuitcase', 1]],
  florist: [['planterTree', 0]],
};
export const MALL_FOCAL = FOCAL;
function focalDisplay(d: ShopDresser, f: MallShopFit): PropPlacement[] {
  const kinds = FOCAL[f.recipe];
  if (!kinds || f.kind === 'kiosk' || f.kind === 'food' || f.kind === 'service' || f.kind === 'vacant') return [];
  const {fr, W, D} = d;
  // a compact gun shop's counter run crosses the floor 3.5 m in: a bench on the axis would stand in its customer strip — its benches
  // come after the counter (guns recipe)
  if (f.recipe === 'guns' && D < 8) return [];
  const end = d.lot?.shape === 'end';
  const u0 = end ? W / 2 : (fr.entry[0] + fr.entry[1]) / 2;
  // just past the 2 m entry keep-out; in a compact unit (D < 8) as shallow as that allows, so the counter run / till behind it fits
  const v0 = end ? Math.max(3.0, D * 0.4) : D < 8 ? 2.4 : Math.min(Math.max(2.6, D * 0.3), Math.max(2.6, D - 2.4));
  const out: PropPlacement[] = [];
  const pair = kinds.length > 1;
  for (const [k, [kind, variant]] of kinds.entries()) {
    const du = pair ? (k ? 0.55 : -0.55) : 0;
    for (const [eu, ev] of [[0, 0], [0.5, 0], [-0.5, 0], [0, 0.5], [0, -0.5], [1, 0], [-1, 0]]) {
      const u = Math.round((u0 + du + eu) * 4) / 4, v = Math.round((v0 + ev) * 4) / 4;
      if (u < 0.5 || u > W - 0.5) continue;
      const p = d.put(kind, u, v, fr.face, {ring: 0.5, variant}); // (a 0.5 m walk-round: an 0.8 m ring kept compact units' counters out)
      if (p) { out.push(p); break; }
    }
  }
  // the electronics focal table carries a flat-screen set
  for (const p of out) if (f.recipe === 'electronics' && p.kind === 'merchTable') d.onTop(p, 'flatScreenTv', 0);
  return out;
}

const RECIPES: Record<MallRecipe, Recipe> = {
  guns(d) {
    const {W, D, fr} = d;
    const V = Math.max(3.5, Math.min(D - 2.8, snapDn(D * 0.55)));
    // staff zone behind the counter run: the empty floor-standing long-gun racks (lane ASSETS M14) along the back wall between steel
    // ammo shelving and the gun locker
    d.backRow([['gunRack', 0], ['shelf', 0], ['gunLocker', 0], ['gunRack', 0], ['shelf', 0]], 0.3, W - 0.3);
    void fr;
    d.sideRow(d.rng.chance(0.5) ? 'L' : 'R', [['gunLocker', 0], ['cabinetTall', 0]], V + 1.6, D - 0.2, {max: 1});
    // the counter run (glass display counters + a till), a staff gap at one end
    const gapR = d.rng.chance(0.5);
    // (mall revision: a compact unit's run holds two or three modules — the till goes second so it is always there)
    const runKinds: readonly KindV[] = W < 8 ? [['glassCounter', 0], ['shopCounter', 0], ['glassCounter', 0]] : [['glassCounter', 0], ['glassCounter', 0], ['shopCounter', 0], ['glassCounter', 0]];
    const run = d.counterRun(runKinds, V, gapR ? 0.3 : 1.3, gapR ? W - 1.3 : W - 0.3);
    const till = run.find(p => p.kind === 'shopCounter');
    if (till) d.onTop(till, 'cashRegister', 0.35);
    // customer side: display benches (the weapon finds), accessory bays + ammo shelving along the side walls
    const benches = d.islands('gunDisplay', per(d, 45, 1, 3), {u0: 1.8, u1: W - 1.8, v0: 2.4, v1: V - 1.0}, {ring: 0.8}).length;
    if (!benches && !d.sideRows([['gunDisplay', 0]], 1.4, V - 0.6, {max: 1})) d.againstWall('gunDisplay', 1, {front: 0.9});
    d.sideRows([['wallBay', 0], ['shelf', 0]], D < 8 ? 0.8 : 1.4, V - 0.9); // (compact: the side walls from just behind the glazing)
    d.islands('merchTable', per(d, 90, 0, 2), {u0: 1.8, u1: W - 1.8, v0: 2.4, v1: V - 1.0}, {ring: 0.9});
    d.againstWall('bin', 1);
  },
  outdoors(d) {
    const {W, D} = d;
    cashWrap(d, [['shopCounter', 0], ['glassCounter', 0]], 2, 2.0);
    const coolers = d.backRow([['shopCooler', 0], ['shopCooler', 0]], W - 2.0, W - 0.2, {max: 2});
    // back wall: a clothing bay (outerwear on its rail), pipe-and-plank shelving (lane ASSETS M16), slatwall, steel shelving
    d.backRow([['clothingWallUnit', 0], ['outdoorsPlankShelving', 0], ['wallBay', 0], ['shelf', 0]], 0.25, W - (coolers ? 2.1 : 0.25));
    d.sideRows([['outdoorsPlankShelving', 0], ['wallBay', 0]], 3.2, D - 1.2);
    d.dressWallUnits();
    if (W * D >= 70) d.islands('tentDisplay', W * D >= 160 ? 2 : 1, {u0: 2, u1: W - 2, v0: D * 0.45, v1: D * 0.75}, {ring: 1.0});
    if (W * D >= 120) d.aisles('retailGondola', [0], {u0: W * 0.55, u1: W - 1.3, v0: 3.4, v1: D - 1.8}, 1.2);
    d.dressRails(d.islands('garmentRail', per(d, 25, 2, 8), {u0: 1.5, u1: W - 1.5, v0: 3.8, v1: D - 2.0}, {ring: 0.8}));
    d.islands('merchTable', per(d, 70, 1, 3), {u0: 1.6, u1: W - 1.6, v0: 3.2, v1: D - 2.4}, {ring: 0.9});
    d.againstWall('bicycle', 1);
  },
  pharmacy(d) {
    const {W, D, fr} = d;
    cashWrap(d, [['shopCounter', 0], ['shopCounter', 0]], 2, 1.8);
    d.againstWall('basketStack', 1, {walls: [fr.L, fr.R]});
    // the dispensary: a glass counter run across the back with medicine cabinets and stocked shelving behind it
    const V = Math.max(4.5, D - 3.4);
    const staff = D - V >= 2.6;
    // the dispensary back counter (lane ASSETS M11: drawers, cupboards, the mirror cupboard) heads the back wall
    d.backRow([['pharmacyDispensaryCounter', 0]], 0.3, W - 0.3, {max: 1});
    // and a medicine drawer cabinet (lane ASSETS M29) beside it
    d.backRow([['medicineDrawerCabinet', 0]], 0.3, W - 0.3, {max: 1});
    if (staff) {
      d.backRow([['stockShelf', sv('pharmacy')], ['medCabinet', 0], ['stockShelf', sv('pharmacy')]], 0.3, W - 0.3);
      d.counterRun([['glassCounter', 0], ['shopCounter', 0], ['glassCounter', 0]], V, 0.3, W - 1.4);
    } else d.backRow([['medCabinet', 0], ['stockShelf', sv('pharmacy')]], 0.3, W - 0.3);
    const coolerSide = d.rng.chance(0.5) ? 'L' : 'R';
    d.sideRow(coolerSide === 'L' ? 'R' : 'L', [['glassDisplayCabinet', 0]], 2.9, (staff ? V : D) - 1.2, {max: 1});
    d.sideRow(coolerSide === 'L' ? 'R' : 'L', [['cosmeticsWallUnit', 0]], 2.9, (staff ? V : D) - 1.2, {max: 1});
    d.sideRows([['stockShelf', sv('pharmacy')]], 2.9, (staff ? V : D) - 1.2);
    d.sideRow(coolerSide, [['shopCooler', 0]], 2.2, 3.8, {max: 1});
    // back-to-back gondola runs (lane ASSETS M03) down the floor
    d.aisles('retailGondola', [0], {u0: 1.3, u1: W - 1.3, v0: 3.4, v1: (staff ? V : D) - 1.6}, 1.2);
    d.againstWall('bloodPressureKiosk', 1, {walls: [fr.L, fr.R]});
  },
  clinic(d) {
    const {W, D, fr} = d;
    // reception + waiting, exam bays behind
    d.counterRun([['desk', 0]], 1.8, W / 2 - 1.0, W / 2 + 1.0, {max: 1});
    d.sideRows([['lobbySofa', 0]], 1.4, Math.min(D * 0.45, 5), {max: per(d, 40, 2, 4)});
    d.islands('plasticStackChair', per(d, 30, 1, 4), {u0: 1.2, u1: W - 1.2, v0: 2.6, v1: Math.min(D * 0.45, 5)}, {ring: 0.5});
    d.againstWall('pottedPlantSmall', 1, {walls: [fr.L, fr.R]});
    d.backRow([['examTable', 0], ['vitalsMonitor', 0], ['medCabinet', 0], ['examTable', 0], ['vitalsMonitor', 0]], 0.3, W - 0.3);
    // the clinic's dispensary back counter (lane ASSETS M11) on a side wall of the exam area, when it fits
    d.sideRows([['pharmacyDispensaryCounter', 0]], Math.max(D * 0.5, 4.5) - 0.5, D - 0.6, {max: 1});
    d.sideRows([['medicineDrawerCabinet', 0]], Math.max(D * 0.5, 4.5) - 0.5, D - 0.6, {max: 1});
    d.sideRows([['medCabinet', 0], ['crashCart', 0], ['wheeledStretcher', 0]], Math.max(D * 0.5, 4.5), D - 1.2, {max: 3});
    d.againstWall('ivPole', 1);
    d.againstWall('physicianScale', 1);
  },
  electronics(d) {
    const {W, D, fr} = d;
    // the TV display banks (lane ASSETS M41) stand on their feet against the back wall, showcases / the till between them
    d.backRow([['tvWall', 0]], 0.3, W - 0.3, {max: W >= 9 ? 2 : 1});
    d.backRow([['showcase', 0], ['shopCounter', 0], ['glassCounter', 0], ['showcase', 0]], 0.3, W - 0.3);
    void fr;
    const tills = d.placed.filter(p => p.kind === 'shopCounter');
    if (tills[0]) d.onTop(tills[0], 'cashRegister', 0.35);
    // (R6: slatwall bays between the device walls / cabinet — open shelves carrying the store's cells and salvaged parts)
    d.sideRows([['deviceWall', 0], ['wallBay', 0], ['glassDisplayCabinet', 0], ['wallBay', 0]], 1.6, D - 1.3);
    // Task mall-round3-20261031 (lane SHOPS, R6 — "stores where the theme would reasonably boost spawn chance of associated loot"): the
    // repair corner's rolling tool chest (an existing openable holder: its drawers take the store's salvage — electrical parts — through
    // the mall storage fill). Before, an electronics sales floor was glass cabinets (no salvage by their display rule) and device walls
    // (no loot): fewer electrical parts than a bookstore (lanes/SHOPS-LOOT.part)
    d.againstWall('rollingToolChest', 1, {walls: [fr.L, fr.R, fr.back]});
    d.islands('techDisplay', per(d, 30, 2, 8), {u0: 1.8, u1: W - 1.8, v0: 2.4, v1: D - 2.2}, {ring: 1.0});
    // TV display tables: a flat-screen set (lane ASSETS M10, loose on-host decor) on each, loot beside it
    for (const t of d.islands('merchTable', per(d, 60, 1, 3), {u0: 1.8, u1: W - 1.8, v0: 2.4, v1: D - 2.2}, {ring: 1.0})) d.onTop(t, 'flatScreenTv', d.rng.chance(0.5) ? -0.15 : 0.15);
  },
  phone(d) {
    const {W, D} = d;
    d.backRow([['repairBench', 1], ['glassCounter', 0], ['shopCounter', 0]], 0.3, W - 0.3);
    d.againstWall('rollingToolChest', 1); // (R6: the repair bench's tool chest — electrical parts in its drawers; before the demo tables)
    d.sideRows([['deviceWall', 0], ['wallBay', 0], ['glassDisplayCabinet', 0]], 1.4, D - 1.2);
    d.islands('techDisplay', per(d, 18, 2, 4), {u0: 1.6, u1: W - 1.6, v0: 2.2, v1: D - 1.9}, {ring: 0.9}); // (mall revision: a phone shop is dense with demo tables)
    d.againstWall('spinnerRack', 1);
  },
  hardware(d) {
    const {W, D} = d;
    cashWrap(d, [['shopCounter', 0], ['shopCounter', 0]], 2, 1.8);
    d.backRow([['shelf', 0], ['outdoorsPlankShelving', 0]], 0.3, W - 0.3);
    d.sideRows([['stockShelf', sv('parts')], ['shelf', 0]], 2.8, D - 1.3);
    d.aisles('retailGondola', [0], {u0: 1.3, u1: W - 1.3, v0: 3.4, v1: D - 1.7}, 1.2);
    d.againstWall('rollingToolChest', 1);
    d.againstWall('stepLadder', 1);
    d.againstWall('handTruck', 1);
  },
  clothing(d) {
    const {W, D, fr} = d;
    windowDisplay(d, 'mannequinFull', 2);
    const corner = d.rng.chance(0.5) ? 0.25 : W - 0.25 - PROP_DEFS.fittingRooms.w;
    d.backRow([['fittingRooms', 0]], corner, corner + PROP_DEFS.fittingRooms.w + 0.3, {max: 1, front: 1.0});
    // back wall: clothing bays (lane ASSETS M08, garments on their rails) between slatwall bays
    d.backRow([['clothingWallUnit', 0], ['wallBay', 0]], 0.25, W - 0.25);
    cashWrap(d, [['shopCounter', 0], ['glassCounter', 0]], 2, Math.min(D - 3, Math.max(2.4, D * 0.55)));
    d.sideRows([['wallBay', 0]], 2.4, D - 1.2);
    d.dressWallUnits();
    if (W * D >= 150) d.backRow([['fittingRooms', 0]], corner < W / 2 ? W - PROP_DEFS.fittingRooms.w - 0.6 : 0.25, corner < W / 2 ? W - 0.25 : PROP_DEFS.fittingRooms.w + 0.6, {max: 1, front: 1.0});
    d.dressRails(d.islands('garmentRail', per(d, 25, 2, 9), {u0: 1.6, u1: W - 1.6, v0: 2.6, v1: D - 2.2}, {ring: 0.8}));
    d.dressRails(d.islands('garmentRailRound', per(d, 45, 1, 4), {u0: 1.8, u1: W - 1.8, v0: 2.8, v1: D - 2.4}, {ring: 0.8}));
    d.islands('merchTable', per(d, 60, 1, 4), {u0: 1.6, u1: W - 1.6, v0: 2.4, v1: D - 2.4}, {ring: 0.9});
    d.islands('ottoman', per(d, 80, 1, 2), {u0: 1.2, u1: W - 1.2, v0: D * 0.5, v1: D - 1.6}, {ring: 0.7});
    void fr;
  },
  /**
   * Task mall-round3-20261031 (lane SHOPS, R4 — user: "no female clothing store ... Lets get that in, Make sure to make a female
   * maniqune"): the women's fashion store. A window display of FEMALE mannequins (mannequinFemale: featureless forms, nothing baked on
   * them), dress bays (the clothing bays' rails with garment groups) on the back wall, handbag / accessory cabinets and tiers, a shoe
   * wall, fitting rooms in a back corner, the till with an accessories counter, and on the floor dresses on rails, blouse / skirt round
   * racks, folded-knit tables, a mannequin pair, a lingerie / knitwear dresser and a boutique armchair. Per lot family: a narrow boutique
   * runs its rails down the unit (aisle view from the door, till + fitting rooms at the far end: cashWrap), a wide showroom shows four
   * window forms, a big unit a second fitting block.
   */
  womenswear(d) {
    const {W, D, fr} = d;
    const shape = d.lot?.shape, narrow = shape === 'narrow-deep', wide = shape === 'wide-shallow' || W >= 11;
    windowDisplay(d, ['mannequinFemale'], wide ? 4 : 2);
    const fw = PROP_DEFS.fittingRooms.w;
    const corner = d.rng.chance(0.5) ? 0.25 : W - 0.25 - fw;
    // (a narrow boutique's back wall often holds its stock-room door: the fitting block then stands against a side wall at the far end)
    if (!d.backRow([['fittingRooms', 0]], corner, corner + fw + 0.3, {max: 1, front: 1.0})) d.sideRows([['fittingRooms', 0]], Math.max(2.6, D - fw - 1.2), D - 0.2, {max: 1, front: 1.0});
    // back wall: dress bays between slatwall bays and a cosmetics / accessories tier unit
    d.backRow([['clothingWallUnit', 0], ['cosmeticsWallUnit', 0], ['clothingWallUnit', 0], ['wallBay', 0]], 0.25, W - 0.25);
    cashWrap(d, [['shopCounter', 0], ['glassCounter', 0]], 2, Math.min(D - 3, Math.max(2.4, D * 0.5)));
    // side walls: the handbag cabinet, the shoe wall, blouse bays; a lingerie / knitwear dresser
    const sideA: 'L' | 'R' = d.rng.chance(0.5) ? 'L' : 'R', sideB: 'L' | 'R' = sideA === 'L' ? 'R' : 'L';
    d.sideRow(sideA, [['glassDisplayCabinet', 0]], 2.4, D - 1.2, {max: 1});
    d.sideRow(sideB, [['shoeWallDisplay', 0]], 2.4, D - 1.2, {max: 1});
    d.sideRows([['dresserDrawers', 0]], D * 0.45, D - 1.2, {max: 1});
    d.sideRows([['clothingWallUnit', 0], ['wallBay', 0]], 2.4, D - 1.2);
    d.dressWallUnits(0.75, 1); // (round 4: the women's face-out groups, never M06)
    if (W * D >= 140) d.backRow([['fittingRooms', 0]], corner < W / 2 ? W - fw - 0.6 : 0.25, corner < W / 2 ? W - 0.25 : fw + 0.6, {max: 1, front: 1.0});
    // the floor: dresses on rails (down a narrow unit, else parallel to the windows), blouse / skirt round racks, folded-knit tables
    d.dressRails(d.islands('garmentRail', per(d, 28, 1, 7), {u0: 1.6, u1: W - 1.6, v0: 2.6, v1: D - 2.2}, {ring: 0.8, along: !narrow}), 0.75, 1);
    d.dressRails(d.islands('garmentRailRound', per(d, 40, 1, 4), {u0: 1.8, u1: W - 1.8, v0: 2.8, v1: D - 2.4}, {ring: 0.8}), 0.75, 1);
    d.islands('merchTable', per(d, 75, 1, 3), {u0: 1.6, u1: W - 1.6, v0: 2.4, v1: D - 2.4}, {ring: 0.9});
    d.islands('mannequinFemale', W * D >= 90 ? 2 : 1, {u0: 1.4, u1: W - 1.4, v0: D * 0.35, v1: D - 2.2}, {ring: 0.6});
    d.islands(W * D >= 70 ? 'loungeArmchair' : 'ottoman', 1, {u0: 1.2, u1: W - 1.2, v0: D * 0.55, v1: D - 1.6}, {ring: 0.7});
    void fr;
  },
  /**
   * Task mall-lingerie-20261102 / store-polish-20261103 (lane STORE — user: "layout of the store seems strange, it should be layed out better,
   * for shopping. I think the regular clothing stores look nice, so more like that. Like with racks of clothing and stuff (but ofc
   * liginiery on the racks)"): the lingerie boutique, laid out like the womenswear / clothing stores. FIRST the changing SUITE carved into
   * the shop (gen/mall/lingerieStore.ts: real walls and framed doorways, 3-4 rooms off a corridor, its doorway onto the sales floor), then
   * a clear main aisle from the entry to the suite doorway (reserved), the window of FEMALE MANNEQUINS dressed in the six sets (lane FIT's
   * mannequin fits), a dressed pair flanking the aisle, clothing bays with lingerie hanging on their rails between slatwall bays and a
   * fragrance tier unit, the till, the accessories cabinet and drawer chests (openable holders), and on the floor garment rails and round
   * racks hung with lingerie (lane FIT's hanger stock), folded-stock tables, a dressed mannequin or two, a full-length mirror and an ottoman
   * by the suite. Loot: the existing mall holders under `mall-lingerie` (personal theme like womenswear).
   */
  lingerie(d) {
    const {W, D, fr} = d;
    const narrow = d.lot?.shape === 'narrow-deep', wide = d.lot?.shape === 'wide-shallow' || W >= 11;
    const suite = placeChangingSuite(d, d.shop);
    // the suite's extent in this frame (u along the frontage, v depth): the sales floor is in front of / beside it
    let vMax = D, uMin = 0, uMax = W;
    let eu = (fr.entry[0] + fr.entry[1]) / 2, ev = D - 1;
    if (suite) {
      const a = xzUV(fr, suite.zone.x0, suite.zone.z0), b = xzUV(fr, suite.zone.x1, suite.zone.z1);
      const zu0 = Math.min(a[0], b[0]), zu1 = Math.max(a[0], b[0]), zv0 = Math.min(a[1], b[1]);
      if (suite.wall === fr.back) vMax = zv0; else if (zu0 < W / 2) uMin = zu1; else uMax = zu0;
      [eu, ev] = xzUV(fr, suite.entry.x, suite.entry.z);
    }
    const zoneSide: 'L' | 'R' | undefined = !suite || suite.wall === fr.back ? undefined : uMin > 0 ? 'L' : 'R';
    // the MAIN AISLE: 1.5 m from the entry straight in, then to the suite doorway — kept clear (the sightline to the changing rooms)
    const um = Math.min(Math.max((fr.entry[0] + fr.entry[1]) / 2, uMin + 1.0), uMax - 1.0);
    // (a shallow sales floor — under 6.5 m in front of the suite — keeps only the suite doorway's own approach: its racks' walkway rings
    // still leave a way through, and the floor is too small to give a whole aisle away)
    const small = vMax < 6.5;
    const aisleV = suite?.wall === fr.back ? ev - 0.75 : ev;
    if (!small) d.keep(um - 0.6, um + 0.6, 1.5, Math.max(1.5, aisleV + 0.6));
    if (suite && !small) d.keep(Math.min(um, eu) - 0.6, Math.max(um, eu) + 0.6, aisleV - 0.6, aisleV + 0.6);
    let design = d.rng.int(0, 5);
    const dressNew = (from: number) => { for (const p of d.placed.slice(from)) if (p.kind === 'mannequinFemale') dressMannequin(d, p, design++); };
    // the window: dressed female mannequins either side of the entry, facing the gallery
    let from = d.placed.length;
    windowDisplay(d, ['mannequinFemale'], wide ? 4 : 2);
    dressNew(from);
    // walls: clothing bays (lingerie on their rails) between slatwall bays and a fragrance / accessories tier unit; the back wall when the
    // suite leaves it free
    if (vMax >= D) d.backRow([['clothingWallUnit', 0], ['cosmeticsWallUnit', 0], ['clothingWallUnit', 0], ['wallBay', 0]], Math.max(0.25, uMin + 0.25), Math.min(W - 0.25, uMax - 0.25));
    // the till at the back of the sales floor by the changing suite (the side away from the suite doorway / a side-wall suite)
    cashWrap(d, [['shopCounter', 0], ['glassCounter', 0]], small ? 1 : 2, Math.max(2.4, vMax - 2.0), true, zoneSide === 'L' ? 'R' : zoneSide === 'R' ? 'L' : suite ? (eu > W / 2 ? 'L' : 'R') : undefined);
    const sideA: 'L' | 'R' = zoneSide ? (zoneSide === 'L' ? 'R' : 'L') : d.rng.chance(0.5) ? 'L' : 'R';
    const sideB: 'L' | 'R' = sideA === 'L' ? 'R' : 'L';
    // each side wall up to the suite — or, beside a back-wall suite that leaves a strip on that side, all the way to the back corner
    const zu = suite && suite.wall === fr.back ? [xzUV(fr, suite.zone.x0, suite.zone.z0)[0], xzUV(fr, suite.zone.x1, suite.zone.z1)[0]] : null;
    const vEnd = (side: 'L' | 'R') => (zu && (side === 'L' ? Math.min(...zu) >= 1.6 : Math.max(...zu) <= W - 1.6) ? D - 0.3 : Math.min(D, vMax) - 0.6);
    if (zoneSide !== 'L') d.sideRow('L', [['clothingWallUnit', 0], ['wallBay', 0]], 2.4, vEnd('L'), {max: 2});
    if (zoneSide !== 'R') d.sideRow('R', [['clothingWallUnit', 0], ['wallBay', 0]], 2.4, vEnd('R'), {max: 2});
    d.sideRow(sideA, [['glassDisplayCabinet', 0]], 2.4, vEnd(sideA), {max: 1});
    d.sideRows([['dresserDrawers', 0]], 2.4, Math.min(D, vMax) - 0.6, {max: 2});
    d.sideRow(sideB, [['cosmeticsWallUnit', 0]], 2.4, vEnd(sideB), {max: 1});
    for (const side of ['L', 'R'] as const) if (zoneSide !== side) d.sideRow(side, [['clothingWallUnit', 0], ['wallBay', 0]], 2.4, vEnd(side));
    d.againstWall('fittingMirror', 1, {front: 0.9});
    // hanging stock: lingerie on every clothing bay's rail (two designs per bay, seeded)
    const hang = (rails: readonly PropPlacement[], share: number) => { for (const r of rails) if (d.rng.chance(share)) hangLingerie(d, r, rackCode(design++, design + d.rng.int(1, 4), d.rng.int(0, 9999))); };
    hang(d.placed.filter(p => p.kind === 'clothingWallUnit'), 1);
    // the floor: garment rails and round racks hung with lingerie, folded-stock tables, a dressed mannequin or two, an ottoman by the suite
    // (the islands' walkway rings keep them off the suite's wall: the zone runs up to it)
    const zone = {u0: Math.max(1.4, uMin + 1.0), u1: Math.min(W - 1.4, uMax - 1.0), v0: 2.4, v1: Math.max(2.4, vMax - 0.9)};
    // the bigger pieces first (a dressed mannequin, round racks), then the straight rails pack the floor like a clothing store's (a one-cell
    // walkway ring: ~0.7-1.0 m between the racks' real edges), a folded-stock table where room is left
    from = d.placed.length;
    if (vMax >= 7) d.islands('mannequinFemale', W * vMax >= 90 ? 2 : 1, {...zone, v0: Math.max(zone.v0, D * 0.3)}, {ring: 0.5}); // (a shallower floor keeps its room for racks)
    dressNew(from);
    hang(d.islands('garmentRailRound', per(d, 40, 1, 3), zone, {ring: 0.5}), 1);
    hang(d.islands('garmentRail', per(d, 18, 2, 7), zone, {ring: 0.5, along: !narrow}), 1);
    d.islands('merchTable', per(d, 70, 1, 2), zone, {ring: 0.6});
    if (suite) {
      ottoman: for (const du of [1.6, -1.6, 2.2, -2.2]) for (const dv of [-1.6, -2.1]) {
        const away = suite.wall === fr.back ? [eu + du, ev + dv] : [eu + (zoneSide === 'L' ? 1.8 : -1.8), ev + du];
        if (d.put('ottoman', Math.round(away[0] * 4) / 4, Math.round(away[1] * 4) / 4, fr.face, {ring: 0.5})) break ottoman;
      }
    } else d.islands('ottoman', 1, zone, {ring: 0.7});
  },
  shoes(d) {
    const {W, D} = d;
    windowDisplay(d, 'mannequinFull', 1);
    cashWrap(d, [['shopCounter', 0]], 1, Math.min(D - 2.6, 2.2));
    // shoe walls (lane ASSETS M19: six ledge rows) with slatwall bays between
    d.sideRows([['shoeWallDisplay', 0], ['wallBay', 0]], 1.4, D - 1.0);
    d.backRow([['shoeWallDisplay', 0], ['wallBay', 0]], 0.25, W - 0.25);
    d.islands('ottoman', per(d, 25, 2, 8), {u0: 1.6, u1: W - 1.6, v0: 2.6, v1: D - 1.8}, {ring: 0.7});
    d.islands('merchTable', per(d, 70, 1, 3), {u0: 1.8, u1: W - 1.8, v0: 2.4, v1: D - 2.4}, {ring: 0.9});
  },
  department(d) {
    const {W, D, fr} = d;
    windowDisplay(d, ['mannequinFemale', 'mannequinFull'], 3); // (R4: the department window mixes the female forms with the M07 figure)
    // cosmetics hall of glass counters in the front third; garment rails / mannequins / tables in the middle; fitting rooms, a bed
    // showroom corner and slatwall bays at the back; two cash wraps
    d.islands('glassCounter', Math.round(Math.min(6, W / 3)), {u0: 2, u1: W - 2, v0: 2.6, v1: Math.max(3.4, D * 0.3)}, {ring: 1.0});
    d.backRow([['fittingRooms', 0]], 0.25, PROP_DEFS.fittingRooms.w + 0.6, {max: 1, front: 1.0});
    d.backRow([['fittingRooms', 0]], W - PROP_DEFS.fittingRooms.w - 0.6, W - 0.25, {max: 1, front: 1.0});
    d.backRow([['clothingWallUnit', 0], ['wallBay', 0], ['wallBay', 0]], 0.25, W - 0.25);
    cashWrap(d, [['shopCounter', 0], ['shopCounter', 0]], 2, Math.max(3.5, D * 0.45));
    // cosmetics wall units (lane ASSETS M42) by the cosmetics hall, a dresser (M45) in the home corner at the back
    d.sideRows([['cosmeticsWallUnit', 0]], 2.4, Math.max(3.4, D * 0.3) + 1.2, {max: 2});
    // Task mall-round3-20261031 (lane SHOPS, R4): a beauty bar by the cosmetics hall — one styling chair facing the side wall (the beauty
    // store's chair; with womenswear in every mall the beauty store rotates in less often)
    chair: for (const [u, rot] of [[W - 0.75, OPP_ROT[fr.R]], [0.75, OPP_ROT[fr.L]], [W - 1.6, OPP_ROT[fr.R]], [1.6, OPP_ROT[fr.L]]] as const) {
      for (let v = 2.6; v < Math.min(D - 1.6, D * 0.7); v += 0.6) if (d.put('salonChair', u, Math.round(v * 4) / 4, rot)) break chair;
    }
    d.sideRows([['dresserDrawers', 0]], D * 0.6, D - 1.0, {max: 1});
    d.sideRows([['wallBay', 0], ['garmentRail', 0]], 2.4, D - 1.2);
    // (round 4, lane GARMENTS: its women's side — about 40 % of its rails / bays carry the women's face-out groups, the rest M06)
    d.dressWallUnits(0.7, DEPT_WOMENS);
    d.dressRails(d.islands('garmentRail', Math.round(Math.min(8, W * D / 35)), {u0: 2, u1: W - 2, v0: D * 0.35, v1: D * 0.8}, {ring: 0.8}), 0.65, DEPT_WOMENS);
    d.dressRails(d.islands('garmentRailRound', per(d, 60, 1, 4), {u0: 2, u1: W - 2, v0: D * 0.35, v1: D * 0.8}, {ring: 0.8}), 0.65, DEPT_WOMENS);
    d.islands('mannequinFull', 2, {u0: 2, u1: W - 2, v0: D * 0.32, v1: D * 0.75}, {ring: 0.6});
    d.islands('mannequinFemale', 2, {u0: 2, u1: W - 2, v0: D * 0.32, v1: D * 0.75}, {ring: 0.6}); // (R4)
    d.islands('merchTable', 3, {u0: 2, u1: W - 2, v0: D * 0.35, v1: D * 0.8}, {ring: 0.9});
    d.islands('displayBed', 1, {u0: 2, u1: W - 2, v0: D * 0.62, v1: D - 2.4}, {ring: 0.9, along: false});
    d.islands('loungeArmchair', 2, {u0: 2, u1: W - 2, v0: D * 0.62, v1: D - 2}, {ring: 0.6});
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
    // a deep unit (GEN's food ring: 10-12 m) is a counter-service restaurant: the counter part-way in, dining tables in front of it
    const deep = D >= 7;
    const V = deep ? Math.max(3.0, Math.min(D - 3.6, snapDn(D * 0.45))) : 1.0;
    // (lane SHOPS, mall revision: a compact food stall — lots.ts 'counter' — keeps only a 0.8 m staff flap; its staff come in from
    // the kitchen store at the back)
    const gap = W < 7 ? 0.8 : 1.2;
    const run = d.counterRun(mods, V, gapR ? 0.2 : gap, gapR ? W - gap : W - 0.2);
    const till = run.find(p => p.kind === 'shopCounter');
    if (till) d.onTop(till, 'cashRegister', 0.35);
    if (deep) {
      // dining: food-court table sets (lane ASSETS M20: a table + four stools on one floor-fixed frame), a stack chair or two spare
      d.islands('foodCourtTableSet', per(d, 30, 1, 4), {u0: 1.5, u1: W - 1.5, v0: 1.8, v1: V - 1.3}, {ring: 0.8});
      // + movable café sets (lane ASSETS M31 bistro table + M32 chairs) where room is left
      bistroSets(d, per(d, 45, 1, 2), {u0: 1.4, u1: W - 1.4, v0: 1.6, v1: V - 1.2});
      d.againstWall('plasticStackChair', 1, {walls: [d.fr.L, d.fr.R]});
    }
    const cooler = d.rng.chance(P?.cooler ?? 0.6) ? d.backRow([['shopCooler', 0]], gapR ? W - 1.0 : 0.15, gapR ? W - 0.15 : 1.0, {max: 1}) : 0;
    const kitchen = (P?.kitchen ?? [['shopBackbar', 0]]) as readonly KindV[];
    d.backRow(kitchen, cooler && !gapR ? 1.0 : 0.2, cooler && gapR ? W - 1.0 : W - 0.2);
    for (const r of P?.extras ?? []) d.sideRow(gapR ? 'L' : 'R', [[r.kind, typeof r.variant === 'number' ? r.variant : 0]], 2.4, D - 1.0, {max: 1});
    // bigger units: prep counters / the staff fridge / a chest freezer along the side walls behind the counter
    if (D >= 4.5) d.sideRows([['shopBackbar', 0], ['fridge', 0], ['chestFreezer', 0]], V + 1.2, D - 1.0, {max: W * D >= 50 ? 3 : 1});
  },
  cafe(d, f) {
    const {W, D} = d;
    const P = STORE_PURPOSES[(f.cuisine ?? 'coffee') as ShopUse];
    const gapR = d.rng.chance(0.5);
    // (lane SHOPS, mall revision: a café in a food-court stall — lots.ts 'counter' — serves over a front counter, its seating is the
    // common food court; a café in a shop unit keeps its counter part-way in with tables in front)
    const stall = d.lot?.shape === 'counter' || f.kind === 'food';
    const counterV = stall ? 1.0 : Math.min(D - 2.6, Math.max(1.0, D * 0.55));
    // the seating floor between the entry keep-out (2 m) and the counter's customer strip (0.6 m): one row of bistro sets in a
    // compact café, more in a deep one
    const seatV1 = Math.max(snapUp(counterV) - 0.6, 2.2);
    const gap = W < 7 ? 0.8 : 1.2;
    const menu: readonly KindV[] = f.cuisine === 'bakery' || f.cuisine === 'donut' ? [['bakeryCase', 0], ['shopCounter', 0], ['bakeryCase', 0], ['shopDisplay', 0]]
      : [['shopCounter', 0], ['shopDisplay', 0], ['bakeryCase', 0]];
    const run = d.counterRun(menu, counterV, gapR ? 0.2 : gap, gapR ? W - gap : W - 0.2, {max: stall ? 4 : 3});
    const till = run.find(p => p.kind === 'shopCounter');
    if (till) d.onTop(till, 'cashRegister', 0.35);
    // the grab-and-go open multideck (lane ASSETS M30) at the back corner when it fits, else the glass-door cooler
    const md = W >= 6 ? d.backRow([['multideckOpenCooler', 0]], W - 2.2, W - 0.15, {max: 1}) : 0;
    d.backRow([...(P?.kitchen ?? [['espressoBar', 0]]) as readonly KindV[], ['shopBackbar', 0]], 0.2, W - (md ? 2.3 : 1.1));
    if (!md) d.backRow([['shopCooler', 0]], W - 1.0, W - 0.15, {max: 1});
    // café seating: bistro tables (lane ASSETS M31) with their chairs (M32), movable
    if (!stall && !bistroSets(d, W * D >= 40 ? 3 : 2, {u0: 1.0, u1: W - 1.0, v0: 2.2, v1: seatV1})) {
      d.islands('foodCourtTableSet', 1, {u0: 1.5, u1: W - 1.5, v0: 2.2, v1: seatV1}, {ring: 0.8});
    }
    d.againstWall('plasticStackChair', 1);
  },
  grocery(d) {
    const {W, D, fr} = d;
    // checkout lanes (lane ASSETS M12) by the front with registers and impulse racks, carts by the entry: in a deep store the lanes run
    // into the store (belts toward the exit, customers pass between them), in a shallow one they stand along the front like counters
    const L = PROP_DEFS.checkoutLane, deepLanes = D >= 10;
    const v0 = 2.6, run = deepLanes ? L.d + 0.9 : slot(L.w) + 0.65, step = deepLanes ? 2.6 : slot(L.w) + 1.6;
    const spots: number[] = [];
    for (let u = 1.5; u + run <= W - 1.0 && spots.length < 6; u += step) spots.push(u);
    const clear = spots.filter(u => u + run < fr.entry[0] - 0.4 || u > fr.entry[1] + 0.4);
    let lanes = 0;
    for (const u of (clear.length ? clear : spots)) {
      if (lanes >= 5) break;
      let c: PropPlacement | null;
      if (deepLanes) {
        // local +X (the till end) toward the frontage, the cashier's strip (+Z) to the +u side
        const [xa, za] = uvXZ(fr, 0, 1), [xb, zb] = uvXZ(fr, 0, 0);
        c = d.put('checkoutLane', u + L.d / 2, v0 + L.w / 2, Math.atan2(-(zb - za), xb - xa), {front: 0.9});
      } else c = d.counterRun([['checkoutLane', 0]], v0, u, u + slot(L.w) + 0.01, {max: 1})[0] ?? null;
      if (!c) continue;
      lanes++;
      d.onTop(c, 'cashRegister', 0.85);
      if (deepLanes) d.put('snackRack', u + L.d / 2, v0 - PROP_DEFS.snackRack.d / 2 - 0.05, fr.face);
      else d.put('snackRack', u + slot(L.w) + 0.35, v0 + PROP_DEFS.snackRack.d / 2 + 0.01, fr.face);
    }
    const front = v0 + (deepLanes ? L.w : L.d) + 0.6;
    d.againstWall('shoppingCart', 2, {walls: [d.fr.L, d.fr.R]});
    // the cooler wall: open multidecks (lane ASSETS M30) between glass-door coolers
    d.backRow([['multideckOpenCooler', 0], ['shopCooler', 0]], 0.3, W - 0.3);
    d.sideRows([['stockShelf', sv('grocery')], ['stockShelf', sv('snacks')]], 3.8, D - 1.3);
    d.sideRow(d.rng.chance(0.5) ? 'L' : 'R', [['chestFreezer', 0]], 3.4, D - 1.4, {max: 2});
    d.islands('produceStand', W * D >= 160 ? 4 : 2, {u0: 1.8, u1: W - 1.8, v0: Math.max(4.0, front + 0.9), v1: Math.min(Math.max(D * 0.4, front + 1.6), D - 4)}, {ring: 1.0});
    // back-to-back gondola runs (lane ASSETS M03) behind the produce
    d.aisles('retailGondola', [0], {u0: 1.4, u1: W - 1.4, v0: Math.max(5.4, D * 0.42, front + 1.2), v1: D - 1.8}, 1.2);
  },
  books(d) {
    const {W, D} = d;
    cashWrap(d, [['shopCounter', 0]], 1, 2.0);
    d.sideRows([['bookstoreBookcase', 0]], 1.4, D - 1.0);
    d.backRow([['bookstoreBookcase', 0]], 0.25, W - 0.25);
    if (W * D >= 100) d.aisles('bookstoreBookcase', [0], {u0: W * 0.5, u1: W - 1.3, v0: 3.2, v1: D - 1.6}, 1.2);
    d.islands('merchTable', per(d, 40, 2, 6), {u0: 1.6, u1: W - 1.6, v0: 2.4, v1: D - 2.4}, {ring: 0.9});
    d.islands('magazineRack', 1, {u0: 1.4, u1: W - 1.4, v0: 2.0, v1: 3.2}, {ring: 0.8});
    d.islands('loungeArmchair', 2, {u0: 1.4, u1: W - 1.4, v0: D * 0.6, v1: D - 1.8}, {ring: 0.6});
  },
  toys(d) {
    const {W, D} = d;
    cashWrap(d, [['shopCounter', 0]], 1, 2.0);
    d.sideRows([['wallBay', 0]], 1.4, D - 1.0);
    d.backRow([['wallBay', 0], ['glassDisplayCabinet', 0]], 0.25, W - 0.25);
    d.againstWall('capsuleToyMachine', 2, {walls: [d.fr.L, d.fr.R]});
    if (W * D >= 100) d.aisles('retailGondola', [0], {u0: W * 0.5, u1: W - 1.3, v0: 3.2, v1: D - 1.6}, 1.2);
    d.islands('merchTable', per(d, 50, 2, 5), {u0: 1.6, u1: W - 1.6, v0: 2.6, v1: D - 2.4}, {ring: 0.9});
    if (W * D >= 50) d.islands('kiddieRide', 1, {u0: 1.6, u1: W - 1.6, v0: 2.6, v1: D - 2.2}, {ring: 0.9});
    d.islands('giantTeddy', 1, {u0: 1.2, u1: W - 1.2, v0: 2.2, v1: D - 1.6}, {ring: 0.6});
    d.islands('rockingHorse', 2, {u0: 1.2, u1: W - 1.2, v0: 2.2, v1: D - 1.6}, {ring: 0.6});
  },
  sports(d) {
    const {W, D} = d;
    cashWrap(d, [['shopCounter', 0]], 1, 2.0);
    d.sideRows([['wallBay', 0], ['clothingWallUnit', 0]], 1.4, D - 1.0);
    d.backRow([['wallBay', 0], ['shoeWallDisplay', 0]], 0.25, W - 0.25);
    d.dressWallUnits();
    d.islands('treadmill', per(d, 60, 1, 4), {u0: 1.8, u1: W - 1.8, v0: D * 0.55, v1: D - 2.0}, {ring: 0.8, along: false});
    d.dressRails(d.islands('garmentRail', per(d, 40, 2, 6), {u0: 1.6, u1: W - 1.6, v0: 2.6, v1: D * 0.55}, {ring: 0.8}));
    d.islands('merchTable', per(d, 70, 1, 3), {u0: 1.6, u1: W - 1.6, v0: 2.6, v1: D - 2.2}, {ring: 0.9});
    d.islands('ottoman', 1, {u0: 1.2, u1: W - 1.2, v0: 2.4, v1: D - 1.6}, {ring: 0.7});
    d.againstWall('bicycle', 2);
  },
  jewelry(d) {
    const {W, D} = d;
    d.backRow([['glassCounter', 0], ['shopCounter', 0], ['glassCounter', 0]], 0.3, W - 0.3);
    const till = d.placed.find(p => p.kind === 'shopCounter');
    if (till) d.onTop(till, 'cashRegister', 0.35);
    d.sideRows([['glassCounter', 0], ['glassDisplayCabinet', 0]], 1.5, D - 1.2);
    d.islands('glassCounter', per(d, 30, 1, 6), {u0: 1.8, u1: W - 1.8, v0: 2.4, v1: D - 2.2}, {ring: 1.0});
  },
  home(d) {
    const {W, D} = d;
    d.backRow([['kitchenette', 0], ['fridge', 0], ['cabinetTall', 0]], 0.3, W - 0.3);
    cashWrap(d, [['shopCounter', 0]], 1, 2.0);
    d.sideRows([['dresserDrawers', 0], ['outdoorsPlankShelving', 0], ['cabinetLow', 0]], 1.6, D - 1.2);
    d.islands('displayBed', per(d, 60, 1, 4), {u0: 2, u1: W - 2, v0: D * 0.45, v1: D - 2.2}, {ring: 0.9, along: false});
    d.islands('lobbySofa', per(d, 70, 1, 3), {u0: 2, u1: W - 2, v0: 2.6, v1: D * 0.5}, {ring: 0.8});
    d.islands('loungeArmchair', per(d, 40, 2, 5), {u0: 1.6, u1: W - 1.6, v0: 2.4, v1: D - 1.8}, {ring: 0.6});
    d.islands('merchTable', per(d, 60, 1, 3), {u0: 1.8, u1: W - 1.8, v0: 2.4, v1: D - 2.2}, {ring: 0.9});
    d.againstWall('pottedPlantSmall', 2);
    d.islands('planterTree', 1, {u0: 1.2, u1: W - 1.2, v0: 1.6, v1: 3.0}, {ring: 0.6});
  },
  beauty(d) {
    const {W, D, fr} = d;
    d.sideRow('L', [['glassCounter', 0], ['cosmeticsWallUnit', 0], ['glassDisplayCabinet', 0], ['wallBay', 0]], 1.4, D - 1.0);
    // salon station: chairs facing the opposite wall's mirror
    for (let k = 0, v = 2.2; k < 3 && v < D - 1.4; v += 1.4) if (d.put('salonChair', W - 0.75, v, OPP_ROT[fr.R])) k++;
    d.backRow([['cosmeticsWallUnit', 0], ['wallBay', 0], ['glassCounter', 0]], 0.25, W - 0.25);
    cashWrap(d, [['shopCounter', 0]], 1, 2.0);
    d.islands('glassCounter', per(d, 70, 0, 3), {u0: 1.8, u1: W - 1.8, v0: 2.6, v1: D - 2.2}, {ring: 1.0});
    d.islands('merchTable', per(d, 50, 1, 4), {u0: 1.8, u1: W - 1.8, v0: 2.6, v1: D - 2.2}, {ring: 0.9});
  },
  music(d) {
    const {W, D} = d;
    cashWrap(d, [['glassCounter', 0], ['shopCounter', 0]], 2, 2.0);
    d.sideRows([['wallBay', 0]], 1.4, D - 1.0);
    d.backRow([['wallBay', 0], ['jukebox', 0], ['wallBay', 0]], 0.25, W - 0.25);
    d.islands('merchTable', per(d, 35, 2, 6), {u0: 1.6, u1: W - 1.6, v0: 2.6, v1: D - 2.2}, {ring: 0.9});
    d.islands('loungeArmchair', 1, {u0: 1.4, u1: W - 1.4, v0: D * 0.6, v1: D - 1.6}, {ring: 0.6});
  },
  pet(d) {
    const {W, D} = d;
    const boards = [] as PropPlacement[];
    d.backRow([['cabinetLow', 0], ['cabinetLow', 0], ['stockShelf', sv('grocery')]], 0.3, W - 0.3);
    for (const p of d.placed) if (p.kind === 'cabinetLow') boards.push(p);
    for (const b of boards) d.onTop(b, 'aquarium', 0);
    cashWrap(d, [['shopCounter', 0]], 1, 2.0);
    d.sideRows([['stockShelf', sv('grocery')], ['wallBay', 0]], 1.4, D - 1.2); // (mall revision: from 1.4 m — a compact pet shop's side walls are short)
    if (W * D >= 100) d.aisles('retailGondola', [0], {u0: W * 0.5, u1: W - 1.3, v0: 3.2, v1: D - 1.6}, 1.2);
    d.islands('catTree', per(d, 50, 1, 3), {u0: 1.4, u1: W - 1.4, v0: 2.4, v1: D - 1.8}, {ring: 0.7});
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
    if (W * D >= 110) d.aisles('arcadeCabinet', [0], {u0: W * 0.45, u1: W - 1.6, v0: 3.4, v1: D - 1.8}, 1.6);
    d.islands('foosballTable', 1, {u0: 2, u1: W - 2, v0: 3.2, v1: D - 2.4}, {ring: 0.9});
    if (W * D >= 70) d.islands('pingPongTable', 1, {u0: 2.2, u1: W - 2.2, v0: 3.4, v1: D - 2.6}, {ring: 1.0});
    d.islands('kiddieRide', 1, {u0: 1.6, u1: W - 1.6, v0: 2.6, v1: D - 2.2}, {ring: 0.8});
    // Task mall-playtest-revision-20261031 (lane SHOPS, U09): back to a REAL wall of the unit (placeKit.placeAgainstWall: strict in the
    // mall — solid wall behind its width, approach + passing lane in front), never the frontage
    const vm = placeAgainstWall(d.ctx, d.a, 'vending', {sides: [d.fr.L, d.fr.R, d.fr.back], front: 1.0, tries: 16});
    if (vm) d.placed.push(vm);
  },
  luggage(d) {
    const {W, D} = d;
    cashWrap(d, [['shopCounter', 0]], 1, 2.0);
    d.sideRows([['wallBay', 0]], 1.4, D - 1.0);
    d.backRow([['wallBay', 0], ['glassCounter', 0]], 0.25, W - 0.25);
    d.islands('merchTable', 1, {u0: 1.6, u1: W - 1.6, v0: 2.6, v1: D - 2.2}, {ring: 0.9});
    d.islands('rollingSuitcase', per(d, 12, 3, 10), {u0: 1.2, u1: W - 1.2, v0: 2.2, v1: D - 1.4}, {ring: 0.5});
  },
  optical(d) {
    const {W, D} = d;
    cashWrap(d, [['shopCounter', 0]], 1, 2.0);
    d.sideRows([['wallBay', 0], ['glassDisplayCabinet', 0]], 1.4, D - 1.0);
    d.backRow([['glassCounter', 0], ['desk', 0]], 0.25, W - 0.25);
    d.islands('glassCounter', per(d, 40, 1, 4), {u0: 1.6, u1: W - 1.6, v0: 2.4, v1: D - 2.2}, {ring: 1.0});
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
    // (lane SHOPS, mall revision: a kiosk cell — lots.ts 'cell', 2.5-3.5 m deep — serves over a counter just behind its open front
    // (the first metre is the frontage's door zone), the seller behind it; a back-wall rack where depth is left)
    if (W >= 3 && D >= 2.5) {
      d.counterRun([['shopCounter', 0]], 1.0, Math.max(0.2, W / 2 - 1.0), Math.min(W - 0.2, W / 2 + 1.0), {max: 1});
      const till = d.placed.find(p => p.kind === 'shopCounter');
      if (till) d.onTop(till, 'cashRegister', 0.35);
    }
    if (D >= 3.2) d.backRow([['stockShelf', sv('snacks')], ['wallBay', 0]], 0.2, W - 0.2, {max: 2});
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
    d.backRow([['medCabinet', 0], ['medicineDrawerCabinet', 0], ['cabinetLow', 0]], 0.3, W - 0.3);
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
    d.againstWall('cardboardBoxFlaps', 1); // (before the carton stacks: its side gaps keep them off its flaps)
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
  // a stock room the station dresser already furnished (its 'stock-room' purpose rules: shelving runs, cartons, crates) keeps that
  // and only gains the program's own pieces (the gun shop's desk / safe / lockers, the dispensary's cabinets / specimen fridge …)
  const pre = d.layout.props.filter(p => p.area === d.a.id).length >= 3;
  const st: StockTheme = f.program === 'pharmacy' || f.program === 'clinic' ? 'pharmacy' : f.program === 'electronics' || f.program === 'phone' ? 'devices'
    : f.program === 'hardware' ? 'parts' : f.program === 'grocery' || f.kind === 'food' || f.program === 'cafe' ? 'grocery' : 'cartons';
  const shelf: KindV = f.program === 'guns' || f.program === 'hardware' || f.program === 'outdoors' ? ['shelf', 0] : ['stockShelf', sv(st)];
  const extras: Partial<Record<MallRecipe, readonly KindV[]>> = {
    guns: [['desk', 0], ['cabinetTall', 0], ['gunSafeTall', 0], ['staffLockers', 0], ['gunLocker', 0], ['cabinetTall', 0]],
    outdoors: [['gunSafeTall', 0], ['cabinetTall', 0]], // (lane ASSETS M35: the outfitter's rifle / ammo safe)
    pharmacy: [['medCabinet', 0], ['medicineDrawerCabinet', 0], ['biohazardFridge', 0], ['cabinetTall', 0], ['desk', 0]],
    clinic: [['medCabinet', 0], ['biohazardFridge', 0], ['labBench', 0], ['cabinetTall', 0]],
    electronics: [['repairBench', 1], ['rollingToolChest', 0], ['cabinetTall', 0]],
    phone: [['repairBench', 1], ['cabinetLow', 0]],
    hardware: [['rollingToolChest', 0], ['cabinetTall', 0]],
    jewelry: [['desk', 0], ['vaultSafe', 0], ['safe', 0], ['cabinetTall', 0]],
    food: [['fridge', 0], ['kitchenette', 0], ['chestFreezer', 0]],
    cafe: [['fridge', 0], ['kitchenette', 0]],
    grocery: [['fridge', 0], ['chestFreezer', 0], ['fridge', 0]],
    clothing: [['garmentRail', 0], ['staffLockers', 0]],
    womenswear: [['garmentRail', 0], ['staffLockers', 0], ['dresserDrawers', 0]], // task mall-round3-20261031 (lane SHOPS, R4)
    lingerie: [['dresserDrawers', 0], ['staffLockers', 0], ['garmentRail', 0], ['cabinetTall', 0]], // task mall-lingerie-20261102 (lane STORE)
    department: [['garmentRail', 0], ['staffLockers', 0], ['desk', 0]],
    pet: [['fridge', 0], ['cabinetTall', 0]],
    arcade: [['electricalPanel', 0], ['cabinetTall', 0]],
    music: [['cabinetLow', 0]],
    home: [['cabinetTall', 0]],
  };
  const long: Side[] = d.fr.W >= d.fr.D ? [d.fr.back, d.fr.side] : [d.fr.L, d.fr.R];
  // program extras first (they are what makes the room), then shelving runs, then cartons / crates
  const ex = extras[f.recipe] ?? [['cabinetTall', 0]];
  const ax = (s: Side) => s === 'N' || s === 'S';
  // each extra once (the first long wall, the rest on the other)
  d.wallRun(long[0], ex, ax(long[0]) ? d.fr.x0 + 0.3 : d.fr.z0 + 0.3, ax(long[0]) ? d.fr.x1 - 0.3 : d.fr.z1 - 0.3, {max: ex.length});
  if (d.placed.length < ex.length) d.wallRun(long[1], ex.slice(d.placed.length), ax(long[1]) ? d.fr.x0 + 0.3 : d.fr.z0 + 0.3, ax(long[1]) ? d.fr.x1 - 0.3 : d.fr.z1 - 0.3, {max: ex.length - d.placed.length});
  // storage totes (lane ASSETS M18) on the floor along the walls: lidded spill boxes with a little room-themed stock inside
  d.againstWall('storageTote', d.rng.int(1, 3));
  // taped cartons (lane ASSETS M47): flap-top spill boxes with a little room-themed stock
  d.againstWall('cardboardBoxFlaps', d.rng.int(1, 2));
  if (pre) return;
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
  /** Furnish the gallery commons (kiosk carts, food-hall seating: gen/mall/commons.ts; default true). */
  commons?: boolean;
  /** Task mall-playtest-revision-20261031 (lane SHOPS, D06): the shops' ad records (gen/mall/ads.ts; default true; absolute frame only). */
  ads?: boolean;
}
/** The last dressMallShops call's gallery-commons report (diagnostics / tests). */
export const MALL_COMMONS_STATS: {last: CommonsReport | null} = {last: null};
/** Task mall-playtest-revision-20261031 (lane SHOPS, D06): the last dressMallShops call's ad report. */
export const MALL_ADS_STATS: {last: MallAdsReport | null} = {last: null};

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
  'grillLine', 'espressoBar', 'wokLine', 'deliLine', 'blenderBar', 'hotdogCart', 'bin', 'bookstoreBookcase',
  // lane ASSETS batch 1
  'retailGondola', 'clothingWallUnit', 'checkoutLane', 'outdoorsPlankShelving', 'storageTote', 'shoeWallDisplay', 'foodCourtTableSet',
  'mallCashwrapCounter', 'glassDisplayCabinet', 'pharmacyDispensaryCounter', 'mallKioskCart', 'medicineDrawerCabinet',
  'gunSafeTall', 'dresserDrawers', 'cardboardBoxFlaps', 'multideckOpenCooler', 'cosmeticsWallUnit']);

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
  let spooky = 0; // (R4) spooky female mannequins placed in this mall (SPOOKY_MANNEQUINS.perMall)
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
    d.lot = mallLot(s.lot ?? inferLot(s, s.salesArea || a.w * a.h * CELL * CELL));
    d.shop = s; // (lane STORE)
    if (opts.fronts !== false) shopfront(layout, ctx, s, fit, fr);
    // the way in stays open: a 2 m deep keep-out behind the entry span (open counter fronts — food units, kiosks — serve over the
    // counter from the gallery: their door zone is enough; other open fronts keep a 3 m wide walk-in lane)
    if (fit.front === 'glazed') d.keep(fr.entry[0] - 0.25, fr.entry[1] + 0.25, 0, Math.min(2.0, fr.D * 0.4));
    else if (fit.kind !== 'kiosk' && !(fit.kind === 'food' && fr.D < 7)) d.keep(fr.W / 2 - 1.5, fr.W / 2 + 1.5, 0, Math.min(2.0, fr.D * 0.4));
    // Task mall-playtest-revision-20261031 (lane SHOPS, D02): a corner unit's SECOND shopfront (MallShop.frontages[1]): its glazing /
    // shutter and its own entry keep-out, before the recipe furnishes the floor
    const f2 = s.frontages?.[1];
    if (f2 && fit.entry2) {
      const s2 = {...s, frontage: f2} as MallShop, side2 = frontageSide(a, s2);
      const fr2 = frameOf(a, side2, fit.entry2, side2 === 'N' || side2 === 'S' ? Math.min(f2.x0, f2.x1) : Math.min(f2.z0, f2.z1));
      if (opts.fronts !== false) shopfront(layout, ctx, s2, {...fit, entry: fit.entry2}, fr2);
      if (fit.front === 'glazed') new ShopDresser(layout, ctx, fr2, srng).keep(fr2.entry[0] - 0.25, fr2.entry[1] + 0.25, 0, Math.min(2.0, fr2.D * 0.4));
    }
    // the program's FOCAL display on the entry axis, seen from the walkway (placed first: the recipe flows around it)
    focalDisplay(d, fit);
    RECIPES[fit.recipe](d, fit);
    // (R4) ... and one standing in the middle of some stripped vacant units, staring out through the glass
    if (fit.kind === 'vacant' && spooky < SPOOKY_MANNEQUINS.perMall) { const r = srng.fork('spooky'); if (r.chance(SPOOKY_MANNEQUINS.vacant) && spookyMannequin(d, 'vacant', r)) spooky++; }
    let backProps = 0;
    if (s.backroom !== undefined && layout.areas[s.backroom]) {
      const b = layout.areas[s.backroom];
      const bctx: PlaceCtx = {...ctxOf(areaLevel(b)), rng: srng.fork('back')};
      const bd = new ShopDresser(layout, bctx, frameOf(b, backFront(layout, b, a)), bctx.rng);
      dressBack(bd, fit);
      // Task mall-round3-20261031 (lane SHOPS, R4): a spooky lone female mannequin in some fashion / department stock rooms (bounded)
      const sp = SPOOKY_MANNEQUINS.back[fit.program];
      if (sp && spooky < SPOOKY_MANNEQUINS.perMall) { const r = srng.fork('spooky'); if (r.chance(sp) && spookyMannequin(bd, 'back', r)) spooky++; }
      backProps = bd.placed.length;
      d.placed.push(...bd.placed);
      if (opts.lights !== false) shopLights(layout, b, 5.0);
    }
    if (opts.lights !== false) shopLights(layout, a, 6.0);
    const own = d.placed.filter(p => p.area === a.id);
    const m2 = Math.max(1, s.salesArea || a.w * a.h * CELL * CELL);
    reports.push({shop: s.id, area: a.id, ...(s.backroom !== undefined ? {backroom: s.backroom} : {}), recipe: fit.recipe, props: own.length, backProps,
      holders: d.placed.filter(p => HOLDERISH.has(p.kind)).length, density: Math.round(own.length / m2 * 100) / 10});
  }
  // the gallery commons: a kiosk cart per ring, food-hall seating on the food-court ring (gen/mall/commons.ts)
  if (opts.commons !== false) MALL_COMMONS_STATS.last = dressMallCommons(layout, ctxOf, rng.fork('commons'));
  if (opts.frame === 'absolute') liftPlaced(layout, first);
  // Task mall-playtest-revision-20261031 (lane SHOPS, D06): the shops' ad / fashion-merchandising records (gen/mall/ads.ts) — read the
  // final absolute prop heights, so only in the absolute frame (the generator's)
  if (opts.ads !== false && opts.frame === 'absolute') MALL_ADS_STATS.last = placeMallAds(layout, rng.fork('ads'));
  return reports;
}

/**
 * Task studio-skywalk-encounters-20261108-074144-01 (lane STORES): ONE sales floor furnished with a Mall programme's own interior OUTSIDE
 * the mall (the Skywalk's Mall store families, gen/skyways/skywaysMallStores.ts) — exactly the two steps dressMallShops runs per shop:
 * the programme's FOCAL display, then its RECIPE, through the shared placement primitive on `d`'s context. The caller owns the frame,
 * the shopfront blockers, the entry keep-out, the lights and the height frame. dressMallShops never calls it (the mall is unchanged).
 */
export function dressMallRecipe(d: ShopDresser, fit: MallShopFit): void {
  focalDisplay(d, fit);
  RECIPES[fit.recipe](d, fit);
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
export function shopLights(layout: StationLayout, a: Area, step: number): void {
  if (layout.lights.some(l => l.area === a.id)) return;
  const lv = areaLevel(a);
  const w = a.w * CELL, h = a.h * CELL, nx = Math.max(1, Math.round(w / step)), nz = Math.max(1, Math.round(h / step));
  const g = levelGrid(layout, lv);
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
    let x = a.x * CELL + w * (i + 0.5) / nx, z = a.y * CELL + h * (j + 0.5) / nz;
    // (task store-polish-20261103, lane STORE: a shop with walls carved inside it — the lingerie changing suite — moves a fixture that
    // would hang inside a wall / over a doorway lintel to the nearest open cell of the shop under its full ceiling; no other shop has such
    // a cell inside its rect, so their fixtures are unchanged)
    const [cx, cy] = g.cellOf(x, z);
    const open = (q: number) => g.cells[q] === FLOOR && g.area[q] === a.id && g.ceil[q] >= a.ceil - 0.05;
    if (g.inBounds(cx, cy) && !open(g.idx(cx, cy))) {
      search: for (let r = 1; r <= 8; r++) for (let oy = -r; oy <= r; oy++) for (let ox = -r; ox <= r; ox++) {
        if (Math.max(Math.abs(ox), Math.abs(oy)) !== r || !g.inBounds(cx + ox, cy + oy) || !open(g.idx(cx + ox, cy + oy))) continue;
        [x, z] = g.center(cx + ox, cy + oy);
        break search;
      }
    }
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
