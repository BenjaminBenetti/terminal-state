// Task studio-ui-subway-maps-20261108-074144-01 (user: "add map kiosks to the subway level, similar to the mall level"): places the Subway's
// station map kiosks (`subwayMapKiosk`, gen/subwayMapKioskKind.ts) — called by levels/registry.ts LEVELS.subway.generate AFTER the station,
// its gear and its track extensions are generated, so generateStation's output is untouched and nothing is re-rolled:
//  - deterministic and RNG-neutral: no draw from any of the station's random streams (a fixed scan; the placement ctx gets its own Rng
//    that tryPlaceProp never draws from); the same seed always gives the same kiosks;
//  - APPENDED to layout.props (every older prop keeps its index: station memory, cargo ids, holder keys and loot rolls are unchanged),
//    never on a pickup, a spawn, the arrival, a sign or another prop;
//  - where people need a map: platform 1 by the arrival (the train doors), then the ticket / fare halls, the concourses, the arcade and
//    the food court (largest first) near the door they are entered by, then the other platforms; at most SUBWAY_MAP_KIOSKS.max, at most one per area, spread apart;
//  - wall-backed (the cabinet's back on a solid wall: never in front of an opening, a storefront or a light well), through the shared
//    placement rules (gen/placeKit.ts tryPlaceProp: never in a door zone, on or beside stairs, in a ladder / link stand area; the reading
//    strip in front stays open floor; the area stays connected), and clear of the track edge.

import type {Area, Side, StationLayout} from './stationTypes';
import type {PropPlacement} from './props';
import {PROP_DEFS, footprint} from './props';
import {CELL, VOID} from './grid';
import {Rng} from '../core/rng';
import {backed, cellsOfBox, mainDoor, makePlaceCtx, markCell, propBlocksDoorway, tryPlaceProp, wallRange, wallSpot, type PlaceCtx} from './placeKit';
import {SUBWAY_MAP_KIOSK, type SubwayMapKioskKind} from './subwayMapKioskKind';

const KIND: SubwayMapKioskKind = 'subwayMapKiosk';

export const SUBWAY_MAP_KIOSKS = {
  /** Kiosks per station. */
  max: 4,
  /** Open floor kept in front of the face for reading (m). */
  front: 1.2,
  /** No track-bed cell within this of the kiosk or its reading strip (the platform edge stays clear, m). */
  trackClear: 2.0,
  /** Clearance around pickups, enemy spawns and the arrival point (m). */
  pickupClear: 0.9,
  spawnClear: 1.2,
  arrivalClear: 2.5,
  /** Kiosks at least this far apart (m). */
  apart: 8,
  /** Storefront openings: the cabinet's back stays this far from one along the wall (m). */
  shopClear: 1.0,
  /** Candidates tried per area (nearest to its anchor first). */
  tries: 80,
} as const;

const SIDES: readonly Side[] = ['N', 'S', 'W', 'E'];

/** Is it a public hall a reader looks for a map in (concourse, ticket / fare hall, food court, arcade)? */
const isHall = (a: Area) => a.publicSpace && !a.ext && a.kind === 'concourse' && (a.type === 'concourse' || a.type === 'fare-hall' || a.type === 'food-court' || a.type === 'retail-arcade');
const sizeOf = (a: Area) => a.w * a.h;
/** Where a reader most needs the map: ticket / fare halls, then concourses, then the arcade and the food court. */
const HALL_RANK: Readonly<Record<string, number>> = {'fare-hall': 0, concourse: 1, 'retail-arcade': 2, 'food-court': 3};

/** Place the station's map kiosks (mutates layout.props / the grids' blocked cells). Returns the kiosks placed. */
export function placeSubwayMapKiosks(layout: StationLayout): PropPlacement[] {
  const out: PropPlacement[] = [];
  if (!layout.grid || !layout.areas?.length) return out;
  const plat = layout.areas[layout.platform];
  type Target = {area: Area; anchor: {x: number; z: number}};
  const targets: Target[] = [];
  if (plat && plat.publicSpace) targets.push({area: plat, anchor: {x: layout.playerSpawn.x, z: layout.playerSpawn.z}});
  const halls = layout.areas.filter(isHall).sort((a, b) => HALL_RANK[a.type] - HALL_RANK[b.type] || sizeOf(b) - sizeOf(a) || a.id - b.id);
  const others = layout.platforms.map(i => layout.areas[i]).filter(a => a && a !== plat && a.publicSpace && !a.ext);
  const ctxs = new Map<number, PlaceCtx>();
  const ctxOf = (level: number) => {
    let c = ctxs.get(level);
    if (!c) { c = makePlaceCtx(layout, new Rng((layout.seed ^ 0x6d4b1e) >>> 0), level); keepClear(layout, c); ctxs.set(level, c); }
    return c;
  };
  for (const a of halls) targets.push({area: a, anchor: hallAnchor(ctxOf(a.level ?? 0), a)});
  for (const a of others) targets.push({area: a, anchor: {x: (a.x + a.w / 2) * CELL, z: (a.y + a.h / 2) * CELL}});
  // kiosks already in the layout (a second call) count: never a second one in an area, never past the cap, never too close
  const all: PropPlacement[] = layout.props.filter(p => p.kind === KIND);
  for (const t of targets) {
    if (all.length >= SUBWAY_MAP_KIOSKS.max) break;
    if (all.some(k => k.area === t.area.id)) continue;
    const p = placeIn(layout, ctxOf(t.area.level ?? 0), t.area, t.anchor, all);
    if (p) { out.push(p); all.push(p); }
  }
  return out;
}

/** A hall's anchor: the middle of the door it is entered by (towards its parent), else its centre. */
function hallAnchor(ctx: PlaceCtx, a: Area): {x: number; z: number} {
  const d = mainDoor(ctx, a);
  return d ? {x: (d.x + d.w / 2) * CELL, z: (d.y + d.h / 2) * CELL} : {x: (a.x + a.w / 2) * CELL, z: (a.y + a.h / 2) * CELL};
}

/** Keep the placement off pickups, spawns, the arrival point, wall-mounted / hung props and low signs (their cells: ctx.keep). */
function keepClear(layout: StationLayout, ctx: PlaceCtx): void {
  const g = ctx.g, R = SUBWAY_MAP_KIOSKS;
  const disc = (x: number, z: number, r: number) => {
    const [x0, y0, x1, y1] = cellsOfBox(x, z, r, r);
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) if (g.inBounds(cx, cy)) markCell(ctx, ctx.keep, g.idx(cx, cy));
  };
  const on = (level: number | undefined) => (level ?? 0) === ctx.level;
  for (const p of layout.pickups) if (on(p.level)) disc(p.x, p.z, R.pickupClear);
  for (const z of layout.zombies) if (on(z.level)) disc(z.x, z.z, R.spawnClear);
  if (ctx.level === 0) disc(layout.playerSpawn.x, layout.playerSpawn.z, R.arrivalClear);
  // every prop below the kiosk's top (mounted plates, hung fixtures, wall items do not block cells but would intersect the cabinet)
  for (const p of layout.props) if (on(p.level) && p.y < SUBWAY_MAP_KIOSK.top + 0.2) disc(p.x, p.z, Math.max(p.hx, p.hz) + 0.15);
  for (const s of layout.signs) {
    const base = layout.levels[s.level ?? 0]?.baseY ?? 0;
    if (on(s.level) && s.y - base < SUBWAY_MAP_KIOSK.top + 0.35) disc(s.x, s.z, (s.w ?? 1.2) / 2 + 0.1);
  }
}

function placeIn(layout: StationLayout, ctx: PlaceCtx, area: Area, anchor: {x: number; z: number}, placed: readonly PropPlacement[]): PropPlacement | null {
  const R = SUBWAY_MAP_KIOSKS, def = PROP_DEFS[KIND], hw = def.w / 2;
  const floor = area.floorY ?? layout.levels[area.level ?? 0]?.baseY ?? 0;
  const cands: {x: number; z: number; rot: number; side: Side; t: number; d: number}[] = [];
  for (const side of SIDES) {
    const [lo, hi] = wallRange(area, side);
    for (let t = lo + hw + 0.25; t <= hi - hw - 0.25 + 1e-6; t += 0.25) {
      const s = wallSpot(area, side, t, KIND);
      cands.push({...s, side, t, d: Math.hypot(s.x - anchor.x, s.z - anchor.z)});
    }
  }
  cands.sort((a, b) => a.d - b.d || a.x - b.x || a.z - b.z);
  let tries = 0;
  for (const c of cands) {
    if (tries >= R.tries) break;
    if (placed.some(p => Math.hypot(p.x - c.x, p.z - c.z) < R.apart)) continue;
    if (!backed(ctx, area, c.side, c.t - hw, c.t + hw, floor + SUBWAY_MAP_KIOSK.top + 0.1)) continue;
    if (nearShopfront(layout, area, c.side, c.t, hw)) continue;
    if (nearTrack(ctx, c.x, c.z, c.rot)) continue;
    const fp = footprint(KIND, c.rot);
    if (propBlocksDoorway(layout, c.x, c.z, fp.hx, fp.hz, floor, SUBWAY_MAP_KIOSK.top)) continue; // (a door's clear volume, as the mall's pylons)
    tries++;
    const p = tryPlaceProp(ctx, area, KIND, c.x, c.z, c.rot, {front: R.front});
    if (p) {
      // stand on the floor under it (absolute, as the station dresser lifts every prop off the main level: stationDress.ts)
      const [gx, gy] = ctx.g.cellOf(p.x, p.z);
      p.y = ctx.g.floorOf(ctx.g.idx(gx, gy));
      return p;
    }
  }
  return null;
}

/** A storefront opening on the same wall within shopClear of the cabinet's back span. */
function nearShopfront(layout: StationLayout, area: Area, side: Side, t: number, hw: number): boolean {
  for (const sf of layout.storefronts) {
    if (sf.hall !== area.id || sf.side !== side) continue;
    const alongX = side === 'N' || side === 'S';
    const s0 = (alongX ? sf.ox : sf.oy) * CELL, s1 = ((alongX ? sf.ox + sf.ow : sf.oy + sf.oh)) * CELL;
    if (t + hw + SUBWAY_MAP_KIOSKS.shopClear > s0 && t - hw - SUBWAY_MAP_KIOSKS.shopClear < s1) return true;
  }
  return false;
}

/** A track-bed cell within trackClear of the kiosk or its reading strip. */
function nearTrack(ctx: PlaceCtx, x: number, z: number, rot: number): boolean {
  const g = ctx.g, R = SUBWAY_MAP_KIOSKS, def = PROP_DEFS[KIND];
  const fx = Math.round(Math.sin(rot)), fz = Math.round(Math.cos(rot));
  const reach = def.d / 2 + R.front;
  const cx = x + fx * reach / 2, cz = z + fz * reach / 2;
  const hx = (fx ? reach / 2 : def.w / 2) + R.trackClear, hz = (fz ? reach / 2 : def.w / 2) + R.trackClear;
  const [x0, y0, x1, y1] = cellsOfBox(cx, cz, hx, hz);
  for (let cy = y0; cy <= y1; cy++) for (let cxx = x0; cxx <= x1; cxx++) if (g.inBounds(cxx, cy) && g.cells[g.idx(cxx, cy)] === VOID) return true;
  return false;
}
