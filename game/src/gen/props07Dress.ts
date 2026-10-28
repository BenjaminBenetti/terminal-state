// Iteration 07 (Lane P2): places the NEW generated prop types (gen/props07.ts) into a dressed station. Pure data (no three.js).
//
// Runs once at the end of stationDress.dress() through the station dresser's own placement primitive (door zones, access strips,
// walkway rings, platform-edge bands, stair/ladder keep-outs and room connectivity are enforced there) on a forked RNG, so the rest
// of generation is unchanged. Every candidate is ALSO checked against Lane DW's doorway clear volumes (gen/doorways.ts
// propBlocksDoorway) and wall items must be wall-backed (doorways.wallBacked: never in front of an opening or an open join).
// Per area: the uses of its purpose (rooms, closets, corridors, washrooms, store units) or of its hall type (platforms, ticket halls,
// concourses, food court, arcades, passages, underpasses, exit stairs) — signature (`lead`) uses first, then floor items, then wall
// mounts / ceiling-hung items — under a size-scaled budget so a room reads as furnished for what it is, never as a dump. Then
// host-relative uses: on-top decor on counters / desks / tables / worktops (the host's loot surface gives up that span) and chairs
// pulled up to desks and tables (they collide but never block the walk grid).
//
// Iteration 08 (Lane P): level-aware (every check runs on the area's own level grid, heights in its local frame) and COMPOSED:
//  - areas the composer owns (gen/compose.ts COMPOSED_ZONES: halls, platforms, passages, service corridors, upper / lower levels)
//    only get their wall-mounted / ceiling-hung infrastructure here (CCTV, fire cabinets, clocks …), spaced out per kind; their
//    floor items come as composed clusters;
//  - room uses may name AFFINITIES: `near` partner kinds (a pegboard by the tool chest, a copier by the desk, the IV pole by the
//    couch) and `door` (extinguishers, punch clocks, coat racks and baskets by the entrance) — wall spots are tried nearest the
//    anchor first, then anywhere.

import type {Rng} from '../core/rng';
import {CELL, type Grid} from './grid';
import {PROP_DEFS, SHELF_TIER_Y, STALL_BACK_SHELF_Y, STALL_BACK_SHELF_Z, STALL_COUNTER_Y, STALL_COUNTER_Z, footprint, type PropDef, type PropKind, type PropPlacement} from './props';
import {p7HostUsesFor, p7Palette, p7UsesFor, type P7Kind, type P7Use} from './props07';
import {propBlocksDoorway} from './placeKit';
import {holderSurfaces, type SurfaceOptions} from '../items/lootLayout';
import {isContainerKind, isLootHolderKind} from '../items/loot';
import type {Area, Door, Side, StationLayout} from './stationTypes';

export interface P7DressApi {
  rng: Rng;
  /** The station dresser's tryPlaceProp (all checks; y >= 0.9 = wall-mounted / hung: reserves, never blocks walking). */
  place(area: Area, kind: PropKind, x: number, z: number, rot: number, o?: {front?: number; ring?: number; y?: number}): PropPlacement | null;
  /** Footprint cells are open floor of the area: not blocked, no door cell / door zone, no platform-edge or stair keep-out. */
  cellsFree(area: Area, x: number, z: number, hx: number, hz: number): boolean;
  /** Wall the area's main door is in (rooms), null for halls. */
  doorSide(area: Area): Side | null;
  /** Iteration 08: the area's level grid, its floor height (local frame base), whether the composer owns it, its doors. */
  grid(area: Area): Grid;
  base(area: Area): number;
  composed(area: Area): boolean;
  doors(area: Area): readonly Door[];
  /** Wall backing on the area's level (absolute yb; apertures never back anything). */
  backed(area: Area, side: Side, t0: number, t1: number, yb: number): boolean;
}

const OPP: Record<Side, Side> = {N: 'S', S: 'N', W: 'E', E: 'W'};
const ALL: Side[] = ['N', 'S', 'E', 'W'];
const WALL_ROT: Record<Side, number> = {N: 0, S: Math.PI, W: Math.PI / 2, E: -Math.PI / 2};
const q4 = (v: number) => Math.round(v * 4) / 4;
const r3 = (v: number) => Math.round(v * 1000) / 1000;
const def = (k: string): PropDef => PROP_DEFS[k as PropKind];

/** Placement key of an area: its purpose (rooms / stores / washrooms) or its public hall type. */
export function p7AreaKey(a: Area): string {
  if (a.purpose) return a.purpose;
  if (a.type === 'concourse') return a.paid ? 'paid-concourse' : 'concourse';
  return a.type;
}

/** Budget per area: floor-standing and wall-mounted / hung p7 placements (rooms ~1 per 7 m2, halls ~1 per 35 m2). */
export function p7Budget(a: Area): {floor: number; high: number} {
  const m2 = a.w * a.h * CELL * CELL, per = (a.w + a.h) * 2 * CELL;
  const hall = a.publicSpace && a.type !== 'washroom' && a.storefront === undefined;
  return hall ? {floor: Math.max(3, Math.min(40, Math.floor(m2 / 35))), high: Math.max(2, Math.min(24, Math.floor(per / 12)))}
    : {floor: Math.max(2, Math.floor(m2 / 7)), high: Math.max(2, Math.floor(per / 5))};
}

export interface P7DressStats { placed: number; byKind: Map<string, number>; host: number; rejectedDoorway: number }

const isHigh = (u: P7Use) => u.at === 'hang' || (u.at === 'mount' && (u.y ?? 1.2) >= 0.9) || (u.at === 'row' && (u.y ?? 0) >= 0.9);

export function dressP7(layout: StationLayout, api: P7DressApi): P7DressStats {
  const st: P7DressStats = {placed: 0, byKind: new Map(), host: 0, rejectedDoorway: 0};
  // Seeded per-station palette: infrastructure + purpose signatures always, ~55% of the other kinds (bounded per-station downloads /
  // GPU texture memory; stations differ). Forked RNG: the palette never shifts the placement draws.
  const prng = api.rng.fork('palette');
  const palette = p7Palette(p => prng.chance(p));
  const ctx: Ctx = {layout, api, st, palette, kindPos: null};
  for (const a of layout.areas) {
    // Composed areas: only their wall / ceiling infrastructure (floor vignettes come from gen/compose.ts).
    const composed = api.composed(a);
    const uses = p7UsesFor(p7AreaKey(a)).filter(u => palette.has(u.kind) && (!composed || ((isHigh(u.use) || u.use.at === 'mount') && !COMPOSED_KINDS.has(u.kind))));
    if (!uses.length) continue;
    const lead = composed ? [] : uses.filter(u => u.use.lead);
    const floor = api.rng.shuffle(uses.filter(u => (composed || !u.use.lead) && !isHigh(u.use)));
    const high = api.rng.shuffle(uses.filter(u => (composed || !u.use.lead) && isHigh(u.use)));
    const budget = p7Budget(a);
    let nf = 0, nh = 0;
    for (const {kind, use} of [...lead, ...floor, ...high]) {
      const hi = isHigh(use);
      if (!use.lead && (hi ? nh >= budget.high : nf >= budget.floor)) continue;
      if (use.chance !== undefined && !api.rng.chance(use.chance)) continue;
      let n = api.rng.int(use.n[0], use.n[1]);
      if (use.per100) n = Math.max(use.n[0], Math.min(use.n[1], Math.round(use.per100 * a.w * a.h * CELL * CELL / 100 * api.rng.range(0.7, 1.3))));
      if (!use.lead) n = Math.min(n, hi ? budget.high - nh : budget.floor - nf);
      if (n <= 0) continue;
      const got = placeUse(ctx, a, kind, use, n);
      if (hi) nh += got; else nf += got;
    }
  }
  dressHosts(ctx);
  return st;
}

interface Ctx {
  layout: StationLayout; api: P7DressApi; st: P7DressStats; palette: ReadonlySet<string>;
  /** Positions per `${area}|${kind}` (same-kind spacing), filled lazily from layout.props then by record(). */
  kindPos: Map<string, number[]> | null;
}

function record(ctx: Ctx, p: PropPlacement | null): boolean {
  if (!p) return false;
  ctx.kindPos?.get(`${p.area}|${p.kind}`)?.push(p.x, p.z) ?? ctx.kindPos?.set(`${p.area}|${p.kind}`, [p.x, p.z]);
  ctx.st.placed++;
  ctx.st.byKind.set(p.kind, (ctx.st.byKind.get(p.kind) ?? 0) + 1);
  return true;
}

function sidesFor(api: P7DressApi, a: Area, sel: P7Use['wall']): Side[] {
  const ds = api.doorSide(a);
  if (!ds || !sel || sel === 'any') return api.rng.shuffle(ALL.slice());
  const sideWalls: Side[] = ds === 'N' || ds === 'S' ? ['W', 'E'] : ['N', 'S'];
  return sel === 'far' ? [OPP[ds]] : sel === 'side' ? api.rng.shuffle(sideWalls) : [ds];
}

function wallRange(a: Area, side: Side): [number, number] {
  return side === 'N' || side === 'S' ? [a.x * CELL, (a.x + a.w) * CELL] : [a.y * CELL, (a.y + a.h) * CELL];
}
/** World XZ of a point `t` along a wall, `off` metres in from its face. */
function wallXZ(a: Area, side: Side, t: number, off: number): [number, number] {
  if (side === 'N') return [t, a.y * CELL + off];
  if (side === 'S') return [t, (a.y + a.h) * CELL - off];
  if (side === 'W') return [a.x * CELL + off, t];
  return [(a.x + a.w) * CELL - off, t];
}

/** Doorway clearance (Lane DW) for a candidate box. */
function clearOfDoors(ctx: Ctx, x: number, z: number, hx: number, hz: number, y: number, h: number): boolean {
  if (!propBlocksDoorway(ctx.layout, x, z, hx, hz, y, h)) return true;
  ctx.st.rejectedDoorway++;
  return false;
}

/**
 * One wall spot: back (or, `along`, the long side) against `side` at `t`; wall-backed over the item's extent up to `yb`, doorway
 * clear, then the dresser's checks. Low mounts (y < 0.9) are placed from the floor (they collide) and rendered `lift` higher.
 */
function tryWall(ctx: Ctx, a: Area, kind: P7Kind, use: P7Use, side: Side, t: number): PropPlacement | null {
  const d = def(kind), along = use.at === 'along';
  const extent = along ? d.d : d.w, depth = along ? d.w : d.d;
  const base = ctx.api.base(a);
  // Any wall-type use with a height (mounts, rows of urinals) is wall-mounted; mounts default to 1.2 m.
  const wantY = use.y ?? (use.at === 'mount' ? 1.2 : null);
  const mountY = wantY !== null ? clampMount(a, d, wantY, base) : null;
  if (wantY !== null && mountY === null) return null;
  const high = mountY !== null && mountY >= 0.9;
  const yb = high ? mountY! : 0;
  if (!ctx.api.backed(a, side, t - extent / 2, t + extent / 2, base + yb)) return null;
  const [x, z] = wallXZ(a, side, t, depth / 2 + 0.03);
  if (!spacedKind(ctx, a, kind, use, x, z)) return null;
  const rot = WALL_ROT[side] + (along ? (ctx.api.rng.chance(0.5) ? Math.PI / 2 : -Math.PI / 2) : 0);
  const {hx, hz} = footprint(kind, rot);
  if (!clearOfDoors(ctx, x, z, hx, hz, base + (high ? mountY! : 0), (mountY ?? 0) + d.h)) return null;
  if (along) {
    // Long items turned along the wall: keep a 0.9 m strip open in front of their long side.
    const [sx, sz] = wallXZ(a, side, t, depth + 0.03 + 0.45);
    const n = side === 'N' || side === 'S';
    if (!ctx.api.cellsFree(a, sx, sz, n ? extent / 2 : 0.45, n ? 0.45 : extent / 2)) return null;
  }
  const p = ctx.api.place(a, kind, r3(x), r3(z), rot, high ? {y: mountY!} : along ? {} : {front: use.front ?? (mountY !== null ? 0.6 : 0.9)});
  if (!p) return null;
  if (high) p.mounted = true;
  else if (mountY !== null) { p.lift = mountY; p.h = mountY + d.h; }
  return p;
}

/**
 * Iteration 08: minimum distance (m) between two placements of the same generated kind in one composed area (wall / ceiling
 * infrastructure is spread along the walls, not bunched): a use's own `space`, else this default, else 6 m. Rooms: `space` only.
 */
/** Wall kinds the composer groups into vignettes (safety points, phone banks): never scattered on their own in composed areas. */
export const COMPOSED_KINDS: ReadonlySet<string> = new Set(['payphone', 'fireExtinguisherCabinet', 'fireHoseReelCabinet', 'aedWallCabinet', 'emergencyCallPoint', 'fareValidatorStand', 'fireExtinguisher']);
export const P7_SPACING: Readonly<Record<string, number>> = {
  cctvCamera: 14, fireExtinguisherCabinet: 14, fireHoseReelCabinet: 18, aedWallCabinet: 22, payphone: 10, fieldPhoneBox: 18, platformClock: 14,
  emergencyCallPoint: 14, disconnectSwitch: 6, firstAidWallKit: 14, punchClock: 20, pipeValveManifold: 10, wallDataCabinet: 8,
};
function spacedKind(ctx: Ctx, a: Area, kind: P7Kind, use: P7Use, x: number, z: number): boolean {
  const sp = use.space ?? (ctx.api.composed(a) ? P7_SPACING[kind] ?? 6 : 0);
  if (sp <= 0) return true;
  if (!ctx.kindPos) {
    ctx.kindPos = new Map();
    for (const p of ctx.layout.props) { const k = `${p.area}|${p.kind}`; const l = ctx.kindPos.get(k); if (l) l.push(p.x, p.z); else ctx.kindPos.set(k, [p.x, p.z]); }
  }
  const l = ctx.kindPos.get(`${a.id}|${kind}`);
  if (l) for (let i = 0; i < l.length; i += 2) if (Math.hypot(l[i] - x, l[i + 1] - z) < sp) return false;
  return true;
}

/** Wall side a wall-backed prop stands against, when it really is backed against that wall of the area (else null). */
function backSide(a: Area, p: PropPlacement): Side | null {
  const q = ((Math.round(p.rot / (Math.PI / 2)) % 4) + 4) % 4;
  const side: Side = q === 0 ? 'N' : q === 1 ? 'W' : q === 2 ? 'S' : 'E';
  const gap = side === 'N' ? p.z - p.hz - a.y * CELL : side === 'S' ? (a.y + a.h) * CELL - (p.z + p.hz) : side === 'W' ? p.x - p.hx - a.x * CELL : (a.x + a.w) * CELL - (p.x + p.hx);
  return gap >= -0.01 && gap < 0.25 ? side : null;
}

/**
 * Affinity candidates (iteration 08): wall spots right beside the use's `near` partner fixtures (same wall, either side) and
 * just past the door zone beside the area's doors (`door`), nearest first. Empty when the use names no anchor.
 */
function anchorSpots(ctx: Ctx, a: Area, use: P7Use, extent: number): {side: Side; t: number}[] {
  if (!use.near?.length && !use.door) return [];
  const out: {side: Side; t: number; k: number}[] = [];
  const jitter = () => ctx.api.rng.next() * 0.5;
  if (use.near?.length) {
    for (const p of ctx.layout.props) {
      if (p.area !== a.id || p.host !== undefined || p.mounted || !use.near.includes(p.kind)) continue;
      const side = backSide(a, p);
      if (!side) continue;
      const ns = side === 'N' || side === 'S', tc = ns ? p.x : p.z, half = ns ? p.hx : p.hz;
      for (let k = 0; k < 4; k++) for (const dir of [-1, 1]) out.push({side, t: Math.round((tc + dir * (half + extent / 2 + 0.06 + k * 0.25)) * 100) / 100, k: k + jitter()});
    }
  }
  if (use.door) {
    for (const d of ctx.api.doors(a)) {
      const side: Side = d.h === 1 && d.w > 1 ? (d.y < a.y ? 'N' : 'S') : d.w === 1 && d.h > 1 ? (d.x < a.x ? 'W' : 'E') : d.y < a.y ? 'N' : d.y >= a.y + a.h ? 'S' : d.x < a.x ? 'W' : 'E';
      const ns = side === 'N' || side === 'S';
      const s0 = (ns ? d.x : d.y) * CELL, s1 = s0 + (ns ? d.w : d.h) * CELL;
      for (let k = 0; k < 4; k++) {
        out.push({side, t: Math.round((s1 + 1.05 + extent / 2 + k * 0.25) * 100) / 100, k: k + 0.5 + jitter()});
        out.push({side, t: Math.round((s0 - 1.05 - extent / 2 - k * 0.25) * 100) / 100, k: k + 0.5 + jitter()});
      }
    }
  }
  return out.sort((p, q) => p.k - q.k).slice(0, 14);
}

/** Mount height clamped under the area ceiling (5 cm gap; ceilings are absolute, `base` = the area floor); null when it does not fit. */
function clampMount(a: Area, d: PropDef, y: number, base: number): number | null {
  const top = a.ceil - base - 0.05 - d.h;
  const m = Math.min(y, top);
  return m < Math.min(y, 0.3) - 1e-6 ? null : Math.round(m * 100) / 100;
}

function placeUse(ctx: Ctx, a: Area, kind: P7Kind, use: P7Use, n: number): number {
  const {api} = ctx;
  const d = def(kind);
  let got = 0;
  const sides = sidesFor(api, a, use.wall);
  switch (use.at) {
    case 'wall': case 'along': case 'mount': {
      const extent = use.at === 'along' ? d.d : d.w;
      for (let i = 0; i < n; i++) {
        let p: PropPlacement | null = null;
        // Affinity: spots beside the anchor fixtures / the entrance first.
        for (const c of anchorSpots(ctx, a, use, extent)) { p = tryWall(ctx, a, kind, use, c.side, c.t); if (p) break; }
        for (const pool of p ? [] : use.wall && use.wall !== 'any' ? [sides, ALL] : [sides]) {
          for (let t = 0; t < 16 && !p; t++) {
            const side = api.rng.pick(pool);
            const [lo, hi] = wallRange(a, side);
            if (hi - lo < extent + 0.3) continue;
            p = tryWall(ctx, a, kind, use, side, q4(api.rng.range(lo + extent / 2 + 0.1, hi - extent / 2 - 0.1)));
          }
          if (p) break;
        }
        if (record(ctx, p)) got++;
      }
      break;
    }
    case 'row':
      for (const side of [...sides, ...ALL.filter(s => !sides.includes(s))]) {
        const [lo, hi] = wallRange(a, side);
        for (let t = lo + 0.45 + d.w / 2; t + d.w / 2 <= hi - 0.45 && got < n;) {
          const p = tryWall(ctx, a, kind, use, side, r3(t));
          if (record(ctx, p)) { got++; t += d.w + 0.02; } else t += 0.5;
        }
        if (got) break;
      }
      break;
    case 'center': {
      const alongX = a.w >= a.h, rot = (d.w >= d.d) === alongX ? 0 : Math.PI / 2;
      const cx = (a.x + a.w / 2) * CELL, cz = (a.y + a.h / 2) * CELL;
      for (let i = 0; i < n; i++) {
        let p: PropPlacement | null = null;
        for (const oa of [0, 0.5, -0.5, 1, -1, 1.5, -1.5, 2, -2]) for (const ob of [0, 0.5, -0.5, 1, -1]) {
          if (p) break;
          const x = q4(cx + (alongX ? oa : ob)), z = q4(cz + (alongX ? ob : oa));
          const {hx, hz} = footprint(kind, rot);
          if (!clearOfDoors(ctx, x, z, hx, hz, api.base(a), d.h)) continue;
          p = api.place(a, kind, x, z, rot, {ring: use.ring ?? 1.0});
        }
        if (record(ctx, p)) got++;
      }
      break;
    }
    case 'free': {
      // Loose item on open floor (abandoned luggage, strollers, carts): random spot >= 1 m in from the walls, walkway ring kept.
      const x0 = a.x * CELL + 1, x1 = (a.x + a.w) * CELL - 1, z0 = a.y * CELL + 1, z1 = (a.y + a.h) * CELL - 1;
      if (x1 <= x0 || z1 <= z0) break;
      for (let i = 0; i < n; i++) {
        let p: PropPlacement | null = null;
        for (let t = 0; t < 24 && !p; t++) {
          const x = q4(api.rng.range(x0, x1)), z = q4(api.rng.range(z0, z1)), rot = api.rng.int(0, 3) * Math.PI / 2 - Math.PI / 2;
          const {hx, hz} = footprint(kind, rot);
          if (!clearOfDoors(ctx, x, z, hx, hz, api.base(a), d.h)) continue;
          p = api.place(a, kind, x, z, rot, {ring: use.ring ?? 0.9});
        }
        if (record(ctx, p)) got++;
      }
      break;
    }
    case 'hang': {
      // From the ceiling, top touching it; headroom >= 2.2 m; >= 1.5 m from hung signs and light fixtures; faces along the hall.
      const base = api.base(a), g = api.grid(a);
      const y = Math.round((a.ceil - base - d.h - 0.02) * 100) / 100;
      if (y < 2.2) break;
      const alongX = a.w >= a.h;
      const x0 = a.x * CELL + 1.5, x1 = (a.x + a.w) * CELL - 1.5, z0 = a.y * CELL + 1.5, z1 = (a.y + a.h) * CELL - 1.5;
      if (x1 <= x0 || z1 <= z0) break;
      const busy = [...ctx.layout.lights.filter(l => l.area === a.id), ...ctx.layout.signs.filter(s => s.area === a.id && s.hang)];
      for (let i = 0; i < n; i++) {
        let p: PropPlacement | null = null;
        for (let t = 0; t < 24 && !p; t++) {
          const x = q4(api.rng.range(x0, x1)), z = q4(api.rng.range(z0, z1));
          if (busy.some(b => Math.hypot(b.x - x, b.z - z) < 1.5)) continue;
          if (!spacedKind(ctx, a, kind, use, x, z)) continue;
          const rot = alongX ? (api.rng.chance(0.5) ? Math.PI / 2 : -Math.PI / 2) : (api.rng.chance(0.5) ? 0 : Math.PI);
          const {hx, hz} = footprint(kind, rot);
          // Under the local ceiling (a lower soffit / slab edge over part of the hall), never over a stair or into a doorway.
          const lc = Math.min(g.ceilAt(x - hx, z - hz), g.ceilAt(x + hx, z - hz), g.ceilAt(x - hx, z + hz), g.ceilAt(x + hx, z + hz)) - base;
          if (lc < y + d.h + 0.01) continue;
          if (!clearOfDoors(ctx, x, z, hx, hz, base + y, d.h)) continue;
          p = api.place(a, kind, x, z, rot, {y});
          if (p) p.mounted = true;
        }
        if (record(ctx, p)) got++;
      }
      break;
    }
    default:
      break;
  }
  return got;
}

// ---------------------------------------------------------------------------------------
// Host-relative: on-top decor and chairs

/** Loot-surface options as world/containers.ts uses them (measured shelf tiers, kiosk counter / back shelves). */
function hostSurfaceOptions(): SurfaceOptions {
  const sh = PROP_DEFS.shelf;
  return {shelf: {tierY: SHELF_TIER_Y, w: sh.w, d: sh.d, h: sh.h}, stallCounterY: STALL_COUNTER_Y, stallBackShelfY: STALL_BACK_SHELF_Y, stallCounterZ: STALL_COUNTER_Z, stallBackShelfZ: STALL_BACK_SHELF_Z};
}

export interface HostTop { y: number; x0: number; x1: number; z0: number; z1: number; /** Surfaces above it (shelves over a worktop). */ over: {y: number; z0: number; z1: number}[] }

/** Top surface decor may stand on, in the host's local frame (y above the host base). */
export function hostTop(kind: string): HostTop | null {
  const d = def(kind);
  if (!d) return null;
  if (isContainerKind(kind) || !isLootHolderKind(kind)) {
    // Solid furniture without loot surfaces (closed containers, crates): the flat top of its box.
    return {y: d.h, x0: -d.w / 2 + 0.05, x1: d.w / 2 - 0.05, z0: -d.d / 2 + 0.05, z1: d.d / 2 - 0.05, over: []};
  }
  const all = holderSurfaces(kind, d, hostSurfaceOptions());
  // The roomiest surface (worktop / counter / tier), the higher on ties.
  const s = all.filter(q => q.clear >= 0.3).sort((p, q) => (q.clear - p.clear > 0.05 ? 1 : p.clear - q.clear > 0.05 ? -1 : q.y - p.y))[0];
  if (!s) return null;
  return {y: s.y - 0.002, x0: s.x0, x1: s.x1, z0: s.z0, z1: s.z1, over: all.filter(q => q.y > s.y + 0.05).map(q => ({y: q.y - 0.002, z0: q.z0, z1: q.z1}))};
}

function dressHosts(ctx: Ctx): void {
  const {layout, api} = ctx;
  const perArea = new Map<string, number>();
  const hosts = layout.props.length;
  const chairs: {x: number; z: number; hx: number; hz: number}[] = [];
  for (let i = 0; i < hosts; i++) {
    const host = layout.props[i];
    if (host.host !== undefined || host.mounted) continue;
    const area = layout.areas[host.area];
    if (!area) continue;
    const uses = p7HostUsesFor(host.kind, host.purpose ?? p7AreaKey(area)).filter(u => ctx.palette.has(u.kind));
    if (!uses.length) continue;
    const top = hostTop(host.kind), hd = def(host.kind);
    let onThis = 0;
    for (const {kind, use} of api.rng.shuffle(uses.slice())) {
      const key = `${area.id}|${kind}`;
      if ((perArea.get(key) ?? 0) >= (use.max ?? 1)) continue;
      if (use.chance !== undefined && !api.rng.chance(use.chance)) continue;
      const placed = use.at === 'onTop' ? (top && onThis < (top.x1 - top.x0 >= 1.3 ? 2 : 1) ? onTop(ctx, i, top, kind) : 0) : atHost(ctx, i, hd, kind, use, chairs);
      if (placed) { perArea.set(key, (perArea.get(key) ?? 0) + placed); if (use.at === 'onTop') onThis += placed; }
    }
  }
}

const toWorld = (host: PropPlacement, lx: number, lz: number): [number, number] => {
  const c = Math.cos(host.rot), s = Math.sin(host.rot);
  return [host.x + lx * c + lz * s, host.z - lx * s + lz * c];
};

function onTop(ctx: Ctx, i: number, top: HostTop, kind: P7Kind): number {
  const {layout, api} = ctx;
  const host = layout.props[i], d = def(kind), hd = def(host.kind);
  const width = top.x1 - top.x0;
  if (d.w > width - 0.04) return 0;
  // Depth: on the surface, or centred on the host's full depth when the appliance is deeper than the loot band (it overhangs nothing).
  let lz: number;
  if (d.d <= top.z1 - top.z0 + 0.06) lz = Math.max(top.z0 + d.d / 2 - 0.03, Math.min(top.z1 - d.d / 2 + 0.03, (top.z0 + top.z1) / 2));
  else if (d.d <= hd.d - 0.02) lz = 0;
  else return 0;
  // Head room under any shelf above the decor's depth span.
  const zs = [lz - d.d / 2, lz + d.d / 2];
  const over = top.over.filter(o => o.z1 > zs[0] && o.z0 < zs[1]).map(o => o.y);
  if (over.length && Math.min(...over) - top.y - 0.02 < d.h) return 0;
  const taken = host.cut?.filter(c => Math.abs(c.y - top.y) < 0.06) ?? [];
  const free = (x: number) => taken.every(c => x + d.w / 2 + 0.03 <= c.x0 || x - d.w / 2 - 0.03 >= c.x1);
  const lo = top.x0 + d.w / 2 + 0.02, hi = top.x1 - d.w / 2 - 0.02;
  if (hi < lo) return 0;
  const lx = (api.rng.chance(0.5) ? [lo, hi, (lo + hi) / 2] : [hi, lo, (lo + hi) / 2]).find(free);
  if (lx === undefined) return 0;
  const [x, z] = toWorld(host, lx, lz);
  const {hx, hz} = footprint(kind, host.rot);
  if (!clearOfDoors(ctx, x, z, hx, hz, ctx.api.base(ctx.layout.areas[host.area]) + host.y + top.y, d.h)) return 0;
  const p: PropPlacement = {kind, x: r3(x), z: r3(z), y: r3(host.y + top.y), rot: host.rot, area: host.area, hx, hz, h: d.h, blocksSight: false, variant: 0, host: i};
  if (host.level) p.level = host.level;
  (host.cut ??= []).push({y: r3(top.y), x0: r3(lx - d.w / 2 - 0.02), x1: r3(lx + d.w / 2 + 0.02)});
  layout.props.push(p);
  record(ctx, p);
  ctx.st.host++;
  return 1;
}

/** Chairs pulled up to a desk (front) or a table (long sides); they collide (PropIndex) but never block the walk grid. */
function atHost(ctx: Ctx, i: number, hd: PropDef, kind: P7Kind, use: P7Use, chairs: {x: number; z: number; hx: number; hz: number}[]): number {
  const {layout, api} = ctx;
  const host = layout.props[i], d = def(kind), area = layout.areas[host.area];
  const table = host.kind === 'table';
  // Spots in host-local space: [x, z, facing (toward the host), outward axis x, outward axis z]. Chairs tuck 0.1-0.12 m under the
  // host, so only the part of the chair outside the host's own grid cells is checked for free floor.
  const tx = hd.w / 2 + d.d / 2 - 0.12;
  const spots: [number, number, number, number, number][] = table
    ? [[tx, -0.35, -Math.PI / 2, 1, 0], [-tx, 0.35, Math.PI / 2, -1, 0], [tx, 0.35, -Math.PI / 2, 1, 0], [-tx, -0.35, Math.PI / 2, -1, 0]]
    : [[0, hd.d / 2 + d.d / 2 - 0.1, Math.PI, 0, 1]];
  const want = api.rng.int(use.n[0], use.n[1]);
  let got = 0;
  for (const [lx, lz, face, ox, oz] of spots) {
    if (got >= want) break;
    const [x, z] = toWorld(host, lx, lz);
    const rot = host.rot + face;
    const {hx, hz} = footprint(kind, rot);
    // Checked span (outward axis u): from 0.3 m past the host's face (beyond the grid cell the face sits in) to the chair's far edge.
    const faceU = ox !== 0 ? hd.w / 2 : hd.d / 2, u1 = (ox !== 0 ? Math.abs(lx) : lz) + d.d / 2, u0 = faceU + 0.3;
    if (u1 - u0 < 0.1) continue;
    const uc = (u0 + u1) / 2, [cx, cz] = toWorld(host, ox ? ox * uc : lx, oz ? oz * uc : lz);
    const quarter = Math.round(host.rot / (Math.PI / 2)) & 1, alongX = (ox !== 0) !== (quarter === 1);
    const half = (u1 - u0) / 2, across = d.w / 2 - 0.05;
    if (!api.cellsFree(area, cx, cz, alongX ? half : across, alongX ? across : half)) continue;
    if (chairs.some(c => Math.abs(c.x - x) < c.hx + hx && Math.abs(c.z - z) < c.hz + hz)) continue;
    if (!clearOfDoors(ctx, x, z, hx, hz, api.base(area) + host.y, d.h)) continue;
    const p: PropPlacement = {kind, x: r3(x), z: r3(z), y: host.y, rot, area: host.area, hx, hz, h: d.h, blocksSight: false, variant: 0, host: i};
    if (host.level) p.level = host.level;
    layout.props.push(p);
    chairs.push({x, z, hx, hz});
    record(ctx, p);
    ctx.st.host++;
    got++;
  }
  return got;
}
