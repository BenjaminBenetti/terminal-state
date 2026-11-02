// Task reactor-expansion-20261101 (lane WASTE): THE NUCLEAR-WASTE REPOSITORY's dressing — the `dress` hook the host calls once after
// the crop and the station dresser (which already furnished every space by its EXISTING purpose: openable lockers / cabinets / crates
// with loot-table contents, the iteration-07 generated props, fixtures). World metres, absolute heights. What this adds, by function
// (task studio-reactor-playtest-round2-20261102: by each space's KIND — the plan is a seeded room graph, so every section reads the
// rooms and doors it was given, never a fixed position):
//  - receiving bay: the roller-shutter frame on the entrance, banded drum pallets, pallet jack / hand truck / wheelie bins / crates,
//    high-bay lamps, a dock hazard band, a band + plate at every goods shutter into the controlled side;
//  - health-physics checkpoint: decon shower booths (REACTOR_X_KIT.deconShower), a walk-through portal monitor, first-aid / eyewash /
//    defibrillator wall kits, a step-off band; change room: the dosimeter rack, the airlock band;
//  - control room: the control console (REACTOR_KIT), a filing cabinet, a swivel chair;
//  - DRUM VAULT(S): racks of hero drums (REACTOR_X_KIT.wasteDrum) in rows along or across the hall (seeded), aisles >= 1.2 m, cross
//    aisles at every door, painted aisle lines, high-bay lamps down the aisles;
//  (task studio-reactor-playtest-round2-20261102, user bullet 13 via lane PROPS: NO floating status beacons any more — the old
//  bulb-on-a-base records hovering over racks / gates / door heads are not generated; `WasteDecor.beacons` stays empty)
//  - DRY-CASK HALL: a grid of vented casks (REACTOR_X_KIT.storageCask) with painted keep-clear squares, the overhead crane runway;
//  - compactor: the supercompactor press, its roller feed, compacted-puck pallets, a crush-zone band; the hot-cell window
//    (REACTOR_X_KIT.hotCellWindow) set into the hot-cell gallery's wall when the plan has one, else the processing room's;
//  - airlock / sealed corridors: heavy steel door frames, airlock bands, plates; sump: the sump grating, risers;
//  - generator / ventilation plant: two wall fans on plinths with their duct, the keep-clear band round the skid (the GENERATOR model
//    itself is ARCH's, from layout.reactor.generators), the floor trench to its switchgear, a wall spot kept for the generator's
//    status / jam signage (`WasteDecor.genSign`, lane GAS);
//  - SWITCHGEAR, guaranteed: the plan's seeded home first (control room, plant or switch room), then every room of the program;
//  - stencil plates on every door ("DRUM VAULT A · LOW-LEVEL WASTE", "AUX GENERATOR 3 · CORE-FLOOR FANS" …), generic hazard plates only.
// Prop rules: storage placed here OPENS (existing openables; contents from the room purpose's loot table), loose things are existing
// dynamic kinds, the stores / plant are anchored 'annexMachine' collision (OPENABLE_AUDIT 'exception'), nothing loose is baked in,
// every hero model is placed at its cooked real size. Racked drums and banded pallets are anchored stores (not loose props).

import type {Rng} from '../../../core/rng';
import {CELL, FLOOR} from '../../grid';
import {PROP_DEFS, footprint, type PropKind, type PropPlacement} from '../../props';
import {OPENABLE_FRONT, areaConnected, backed, cellsOfBox, makePlaceCtx, propBlocksDoorway, tryPlaceProp, type PlaceCtx} from '../../placeKit';
import type {Area, Door, LightPlacement, Side, StationLayout} from '../../stationTypes';
import type {WasteCarveRecord} from './waste';
import type {WasteKey, WasteKind, WasteRoom} from './wastePlan';
import {WASTE_DRUM_CAP, WASTE_SIZES, type WasteDecor, type WasteMat, type WasteModelPiece, type WasteTag} from './wasteTypes';

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const quarter = (a: number) => {
  const q = ((Math.round(a / (Math.PI / 2)) % 4) + 4) % 4;
  return [0, Math.PI / 2, Math.PI, -Math.PI / 2][q];
};

type V2 = [number, number];
type Wall = 'front' | 'back' | 'left' | 'right';
const WALLS: readonly Wall[] = ['back', 'left', 'right', 'front'];

/** A room's local frame in world metres: origin = the (s-min, t-min) corner, s along the room's first axis, t along its second. */
interface RoomF { key: WasteKey; kind: WasteKind; a: Area; o: V2; au: V2; av: V2; lu: number; lv: number; ceil: number }

/** A door of the complex as the dress sees it (the layout door + its plan record). */
interface DoorRef { d: Door; kind: string; a: WasteKey | 'deck'; b: WasteKey; loop: boolean }

/** QA counters of the last dress (tests); `firstProp` = layout.props index of the first prop the dress added. */
export const WASTE_DRESS_STATS = {props: 0, solids: 0, drums: 0, casks: 0, racks: 0, lights: 0, signs: 0, models: 0, ms: 0, firstProp: 0};

export function dressWaste(layout: StationLayout, rng: Rng, crop: {ox: number; oy: number}, rec: WasteCarveRecord): void {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const level = rec.level, base = rec.baseY;
  const L = layout.levels[level];
  if (!L) return;
  const g = L.grid;
  const plan = rec.plan, f = plan.frame;
  const dU = f.dirU(), dV = f.dirV();
  const mine = new Set(Object.values(rec.areas));
  // complex bounds (cells, after the crop)
  let cx0 = Infinity, cy0 = Infinity, cx1 = -Infinity, cy1 = -Infinity;
  for (const id of mine) { const a = layout.areas[id]; cx0 = Math.min(cx0, a.x); cy0 = Math.min(cy0, a.y); cx1 = Math.max(cx1, a.x + a.w); cy1 = Math.max(cy1, a.y + a.h); }
  const ctx: PlaceCtx = makePlaceCtx(layout, rng.fork('waste-place'), level, {x0: cx0 - 3, y0: cy0 - 3, x1: cx1 + 3, y1: cy1 + 3});
  const decor: WasteDecor = {
    version: 1, level, bounds: {x0: cx0 * CELL, z0: cy0 * CELL, x1: cx1 * CELL, z1: cy1 * CELL},
    boxes: [], cyls: [], stripes: [], beacons: [], models: [], fans: [], // (beacons: always empty — user bullet 13)
  };
  const props0 = layout.props.length;
  const stats = {props: 0, solids: 0, drums: 0, casks: 0, racks: 0, lights: 0, signs: 0, models: 0, ms: 0, firstProp: props0};

  // --- the host's HOLDS (the entrance apron, the use point …): blocked cells of our rooms with no prop on them. They stay clear (keep)
  // but count as open floor for our connectivity checks while we dress; re-blocked before returning (the host then releases them).
  const held: number[] = [];
  {
    const covered = new Uint8Array(g.w * g.h);
    for (const p of layout.props) {
      if ((p.level ?? 0) !== level || p.mounted) continue;
      const [x0, y0, x1, y1] = cellsOfBox(p.x, p.z, p.hx, p.hz);
      for (let y = Math.max(0, y0); y <= Math.min(g.h - 1, y1); y++) for (let x = Math.max(0, x0); x <= Math.min(g.w - 1, x1); x++) covered[g.idx(x, y)] = 1;
    }
    // only the holds that matter inside the complex stay clear (the entrance apron, the use point); a stair-mouth hold that spills
    // through the pit wall into a room behind it is no walkway of ours
    const E = rec.entrance, [ux0, uy0] = [rec.genUse[0] - crop.ox, rec.genUse[1] - crop.oy];
    const near = (x: number, y: number) => (x >= E.x - crop.ox - 4 && x < E.x - crop.ox + E.w + 4 && y >= E.y - crop.oy - 4 && y < E.y - crop.oy + E.h + 4) || (Math.abs(x - ux0) <= 3 && Math.abs(y - uy0) <= 3);
    for (let y = cy0; y < cy1; y++) for (let x = cx0; x < cx1; x++) {
      const i = g.idx(x, y);
      if (g.blocked[i] && !covered[i] && g.cells[i] === FLOOR && mine.has(g.area[i])) { held.push(i); g.blocked[i] = 0; if (near(x, y)) ctx.keep[i] = 1; }
    }
  }
  try {
    dressAll();
  } finally {
    for (const i of held) g.blocked[i] = 1;
  }
  return;

  function dressAll(): void {
  // --- what the station dresser left: keep its openables' access strips and its wall mounts out of our way ---------------------------
  const own: PropPlacement[] = layout.props.filter(p => (p.level ?? 0) === level && mine.has(p.area));
  for (const p of own) {
    const [x0, y0, x1, y1] = cellsOfBox(p.x, p.z, p.hx, p.hz);
    if (p.mounted) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (g.inBounds(x, y)) ctx.keep[g.idx(x, y)] = 1;
    const sw = OPENABLE_FRONT[p.kind];
    if (!sw) continue;
    const def = PROP_DEFS[p.kind], fx = Math.round(Math.sin(p.rot)), fz = Math.round(Math.cos(p.rot));
    const [s0, s1, s2, s3] = cellsOfBox(p.x + fx * (def.d / 2 + sw / 2), p.z + fz * (def.d / 2 + sw / 2), fx ? sw / 2 : def.w / 2 - 0.02, fz ? sw / 2 : def.w / 2 - 0.02);
    for (let y = s1; y <= s3; y++) for (let x = s0; x <= s2; x++) if (g.inBounds(x, y)) ctx.keep[g.idx(x, y)] = 1;
  }
  // the generator skid and its use point (the host blocks / holds them; we never furnish them either)
  const [gox, goy] = [rec.genFoot.x - crop.ox, rec.genFoot.y - crop.oy];
  for (let y = goy - 1; y <= goy + rec.genFoot.h; y++) for (let x = gox - 1; x <= gox + rec.genFoot.w; x++) if (g.inBounds(x, y)) ctx.keep[g.idx(x, y)] = 1;
  const [ux, uy] = [rec.genUse[0] - crop.ox, rec.genUse[1] - crop.oy];
  for (let y = uy - 2; y <= uy + 2; y++) for (let x = ux - 2; x <= ux + 2; x++) if (g.inBounds(x, y)) ctx.keep[g.idx(x, y)] = 1;

  // --- frames ------------------------------------------------------------------------------------------------------------------
  const roomF = (w: WasteRoom): RoomF => {
    const a = layout.areas[rec.areas[w.key]];
    const au: V2 = w.alongU ? dU : dV, av: V2 = w.alongU ? dV : dU;
    const x0 = a.x * CELL, x1 = (a.x + a.w) * CELL, z0 = a.y * CELL, z1 = (a.y + a.h) * CELL;
    const ox = au[0] ? (au[0] > 0 ? x0 : x1) : (av[0] > 0 ? x0 : x1);
    const oz = au[1] ? (au[1] > 0 ? z0 : z1) : (av[1] > 0 ? z0 : z1);
    return {key: w.key, kind: w.kind, a, o: [ox, oz], au, av, lu: (au[0] ? a.w : a.h) * CELL, lv: (av[0] ? a.w : a.h) * CELL, ceil: a.ceil};
  };
  const R = {} as Record<WasteKey, RoomF>;
  for (const w of plan.rooms) R[w.key] = roomF(w);
  const ofKind = (k: WasteKind): RoomF[] => plan.rooms.filter(w => w.kind === k).map(w => R[w.key]);
  const pt = (r: RoomF, s: number, t: number): V2 => [r.o[0] + r.au[0] * s + r.av[0] * t, r.o[1] + r.au[1] * s + r.av[1] * t];
  const loc = (r: RoomF, x: number, z: number): V2 => [(x - r.o[0]) * r.au[0] + (z - r.o[1]) * r.au[1], (x - r.o[0]) * r.av[0] + (z - r.o[1]) * r.av[1]];
  /** World AABB of a local box (s0..s1 along u, t0..t1 along v). */
  const wb = (r: RoomF, s0: number, s1: number, t0: number, t1: number) => {
    const p = pt(r, s0, t0), q = pt(r, s1, t1);
    return {x0: Math.min(p[0], q[0]), x1: Math.max(p[0], q[0]), z0: Math.min(p[1], q[1]), z1: Math.max(p[1], q[1])};
  };
  const wallN = (r: RoomF, w: Wall): V2 => (w === 'front' ? [-r.av[0], -r.av[1]] : w === 'back' ? [r.av[0], r.av[1]] : w === 'left' ? [-r.au[0], -r.au[1]] : [r.au[0], r.au[1]]);
  const sideOf = (d: V2): Side => (d[0] > 0 ? 'E' : d[0] < 0 ? 'W' : d[1] > 0 ? 'S' : 'N');
  const wallLen = (r: RoomF, w: Wall) => (w === 'front' || w === 'back' ? r.lu : r.lv);
  /** Point on wall w at q along it, `off` m into the room. */
  const onWall = (r: RoomF, w: Wall, q: number, off: number): V2 => (w === 'front' ? pt(r, q, off) : w === 'back' ? pt(r, q, r.lv - off) : w === 'left' ? pt(r, off, q) : pt(r, r.lu - off, q));
  /** Prop rotation facing into the room from wall w (front = (sin rot, cos rot)). */
  const rotInto = (r: RoomF, w: Wall) => { const n = wallN(r, w); return quarter(Math.atan2(-n[0], -n[1])); };
  const yawInto = (r: RoomF, w: Wall) => { const n = wallN(r, w); return Math.atan2(-n[0], -n[1]); };
  /** World coordinate along a wall (x for N / S walls, z for E / W walls). */
  const along = (r: RoomF, w: Wall, q: number): number => { const p = onWall(r, w, q, 0); const s = sideOf(wallN(r, w)); return s === 'N' || s === 'S' ? p[0] : p[1]; };
  const doorsOf = (r: RoomF): Door[] => ctx.doorsOf.get(r.a.id) ?? [];
  /** Door spans on wall w of room r (local q0..q1 along the wall). */
  const doorSpans = (r: RoomF, w: Wall): [number, number][] => {
    const out: [number, number][] = [];
    for (const d of doorsOf(r)) {
      const p = loc(r, d.x * CELL, d.y * CELL), q = loc(r, (d.x + d.w) * CELL, (d.y + d.h) * CELL);
      const s0 = Math.min(p[0], q[0]), s1 = Math.max(p[0], q[0]), t0 = Math.min(p[1], q[1]), t1 = Math.max(p[1], q[1]);
      const e = 0.01;
      if (w === 'front' && t1 <= e) out.push([s0, s1]);
      else if (w === 'back' && t0 >= r.lv - e) out.push([s0, s1]);
      else if (w === 'left' && s1 <= e) out.push([t0, t1]);
      else if (w === 'right' && s0 >= r.lu - e) out.push([t0, t1]);
    }
    return out;
  };
  /** Whether [q0, q1] on wall w stays `pad` m clear of every door span. */
  const wallFree = (r: RoomF, w: Wall, q0: number, q1: number, pad: number) => q0 >= 0.05 && q1 <= wallLen(r, w) - 0.05 && doorSpans(r, w).every(([a, b]) => q1 <= a - pad || q0 >= b + pad);

  // --- the plan's doors ----------------------------------------------------------------------------------------------------------
  const refs: DoorRef[] = rec.doors.map(q => ({d: layout.doors[q.id], kind: q.kind, a: q.a, b: q.b, loop: !!q.loop}));
  /** The door between two spaces (either order). */
  const between = (a: WasteKey | 'deck', b: WasteKey): Door | undefined => refs.find(q => (q.a === a && q.b === b) || (q.a === b && q.b === a))?.d;
  /** Every door of a space, with the space on its other side. */
  const doorsAt = (k: WasteKey): {d: Door; other: WasteKey | 'deck'; kind: string; loop: boolean}[] =>
    refs.filter(q => q.a === k || q.b === k).map(q => ({d: q.d, other: q.a === k ? q.b : q.a, kind: q.kind, loop: q.loop}));
  /** A space's tree door (to the room it was grown off). */
  const treeDoor = (k: WasteKey): Door | undefined => between(plan.by[k]?.parent || 'deck', k);

  // --- primitives --------------------------------------------------------------------------------------------------------------
  const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, m: WasteMat, c?: number) =>
    decor.boxes.push({x0: r3(Math.min(x0, x1)), y0: r3(Math.min(y0, y1)), z0: r3(Math.min(z0, z1)), x1: r3(Math.max(x0, x1)), y1: r3(Math.max(y0, y1)), z1: r3(Math.max(z0, z1)), m, ...(c !== undefined ? {c} : {})});
  /** Local box (s, t ranges) from y0 to y1 (relative to the floor). */
  const lbox = (r: RoomF, s0: number, s1: number, t0: number, t1: number, y0: number, y1: number, m: WasteMat, c?: number) => {
    const b = wb(r, s0, s1, t0, t1);
    box(b.x0, base + y0, b.z0, b.x1, base + y1, b.z1, m, c);
  };
  const stripe = (r: RoomF, s0: number, s1: number, t0: number, t1: number) => { const b = wb(r, s0, s1, t0, t1); decor.stripes.push({x0: r3(b.x0), z0: r3(b.z0), x1: r3(b.x1), z1: r3(b.z1), y: base}); };
  const model = (piece: WasteModelPiece, x: number, z: number, yaw: number, w: number, d: number, h: number, y = base) => {
    decor.models.push({piece, x: r3(x), y: r3(y), z: r3(z), yaw: r3(yaw), w, d, h});
    stats.models++;
  };
  /** Absolute 3D box clear of every prop of this storey in the complex (incl. mounted ones); `e` = tolerance (m). */
  const clear3d = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, skip?: PropPlacement, e = 0.01) => {
    for (const p of layout.props) {
      if (p === skip || (p.level ?? 0) !== level || !mine.has(p.area)) continue;
      const py0 = p.y, py1 = p.y + p.h;
      if (p.x + p.hx - e <= x0 || p.x - p.hx + e >= x1 || p.z + p.hz - e <= z0 || p.z - p.hz + e >= z1 || py1 - e <= y0 || py0 + e >= y1) continue;
      return false;
    }
    return true;
  };
  /** Lifts a freshly placed prop onto the floor; withdraws it (it is the last prop) if its box meets another beyond the cell epsilon. */
  const lift = (p: PropPlacement | null): PropPlacement | null => {
    if (!p) return null;
    p.y = r3(p.y + base);
    if (!clear3d(p.x - p.hx, p.x + p.hx, p.y, p.y + p.h, p.z - p.hz, p.z + p.hz, p, 0.045)) {
      if (layout.props[layout.props.length - 1] === p) {
        layout.props.pop();
        if (!p.mounted) unblock(p);
        return null;
      }
    }
    stats.props++;
    return p;
  };
  /** An existing prop kind at (x, z) facing rot (tryPlaceProp: cells, door zones, access strips, connectivity), lifted onto the floor. */
  const put = (r: RoomF, kind: PropKind, x: number, z: number, rot: number, o: {front?: number; ring?: number; zoneOk?: boolean} = {}) =>
    lift(tryPlaceProp(ctx, r.a, kind, r3(x), r3(z), rot, {checkZone: !o.zoneOk, front: o.front, ring: o.ring}));
  /** An existing kind with its back to wall w at the first free spot of `qs` (local along-wall positions). */
  const putWall = (r: RoomF, w: Wall, kind: PropKind, qs: readonly number[], o: {front?: number} = {}): PropPlacement | null => {
    const def = PROP_DEFS[kind];
    for (const q of qs) {
      if (!wallFree(r, w, q - def.w / 2, q + def.w / 2, 0.4)) continue;
      const [x, z] = onWall(r, w, q, def.d / 2 + 0.03);
      const p = put(r, kind, x, z, rotInto(r, w), o);
      if (p) return p;
    }
    return null;
  };
  /** A wall-mounted existing kind (first-aid kit, eyewash …) at height y on wall w (backed, clear, never in a doorway). */
  const mount = (r: RoomF, w: Wall, kind: PropKind, qs: readonly number[], y: number): PropPlacement | null => {
    const def = PROP_DEFS[kind], rot = rotInto(r, w), {hx, hz} = footprint(kind, rot), side = sideOf(wallN(r, w));
    for (const q of qs) {
      if (!wallFree(r, w, q - def.w / 2, q + def.w / 2, 0.3)) continue;
      const [x, z] = onWall(r, w, q, def.d / 2 + 0.03), aq = along(r, w, q);
      if (!backed(ctx, r.a, side, aq - def.w / 2, aq + def.w / 2, base + y)) continue;
      const [x0, y0, x1, y1] = cellsOfBox(x, z, hx, hz);
      let ok = r.ceil - base >= y + def.h + 0.05;
      for (let cy = y0; cy <= y1 && ok; cy++) for (let cx = x0; cx <= x1; cx++) { const i = g.idx(cx, cy); if (!g.inBounds(cx, cy) || g.cells[i] !== FLOOR || g.area[i] !== r.a.id || ctx.doorCell[i]) { ok = false; break; } }
      if (!ok || !clear3d(x - hx, x + hx, base + y, base + y + def.h, z - hz, z + hz) || propBlocksDoorway(layout, x, z, hx, hz, base + y, def.h)) continue;
      const p: PropPlacement = {kind, x: r3(x), z: r3(z), y: r3(base + y), rot, area: r.a.id, hx, hz, h: def.h, blocksSight: false, variant: 0, mounted: true, level};
      layout.props.push(p);
      if (y < 2) for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) ctx.keep[g.idx(cx, cy)] = 1;
      stats.props++;
      return p;
    }
    return null;
  };
  /**
   * An anchored collision box ('annexMachine', static, not storage) over (x, z) +- (hx, hz), height h: on free floor of the room, out of
   * door zones and doorway volumes, clear of every prop, the room still connected; `ring` m of walkable floor kept round it.
   */
  const solid = (r: RoomF, x: number, z: number, hx: number, hz: number, h: number, tag: WasteTag, o: {ring?: number; zoneOk?: boolean; round?: boolean; sight?: boolean} = {}): PropPlacement | null => {
    const [x0, y0, x1, y1] = cellsOfBox(x, z, hx, hz);
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
      if (!g.inBounds(cx, cy)) return null;
      const i = g.idx(cx, cy);
      if (g.cells[i] !== FLOOR || g.area[i] !== r.a.id || g.blocked[i] || g.rampIdx[i] >= 0 || ctx.keep[i] || ctx.doorCell[i] || ctx.edge[i] || (!o.zoneOk && ctx.zone[i])) {
        return null;
      }
    }
    if (o.ring) {
      const rc = Math.max(1, Math.round(o.ring / CELL));
      for (let cy = y0 - rc; cy <= y1 + rc; cy++) for (let cx = x0 - rc; cx <= x1 + rc; cx++) {
        if (cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1) continue;
        if (!g.inBounds(cx, cy)) return null;
        const i = g.idx(cx, cy);
        // the ring is open, unobstructed floor all round (any area: a doorway or the next room counts)
        if (g.cells[i] !== FLOOR || g.blocked[i]) return null;
      }
    }
    if (h > r.ceil - base - 0.05) return null;
    if (propBlocksDoorway(layout, x, z, hx, hz, base, h) || !clear3d(x - hx, x + hx, base, base + h, z - hz, z + hz)) return null;
    const sight = o.sight ?? h > 1.7;
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) { const i = g.idx(cx, cy); g.blocked[i] = 1; if (sight) g.sightBlocked[i] = 1; }
    if (!areaConnected(ctx, r.a)) {
      for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) { const i = g.idx(cx, cy); g.blocked[i] = 0; g.sightBlocked[i] = 0; }
      return null;
    }
    if (o.ring) {
      const rc = Math.max(1, Math.round(o.ring / CELL));
      for (let cy = y0 - rc; cy <= y1 + rc; cy++) for (let cx = x0 - rc; cx <= x1 + rc; cx++) if (g.inBounds(cx, cy) && g.area[g.idx(cx, cy)] === r.a.id && !g.blocked[g.idx(cx, cy)]) ctx.keep[g.idx(cx, cy)] = 1;
    }
    const p: PropPlacement = {kind: 'annexMachine', x: r3(x), z: r3(z), y: base, rot: 0, area: r.a.id, hx: r3(hx), hz: r3(hz), h: r3(h), blocksSight: sight, variant: 0, level, purpose: tag};
    if (o.round) p.round = true;
    layout.props.push(p);
    stats.solids++;
    return p;
  };
  /** Whether solid() would take (x, z) +- (hx, hz), height h, with a `ring` (its cell / ring / volume tests; connectivity aside). */
  const solidFits = (r: RoomF, x: number, z: number, hx: number, hz: number, h: number, ring = 0): boolean => {
    const [x0, y0, x1, y1] = cellsOfBox(x, z, hx, hz);
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
      if (!g.inBounds(cx, cy)) return false;
      const i = g.idx(cx, cy);
      if (g.cells[i] !== FLOOR || g.area[i] !== r.a.id || g.blocked[i] || g.rampIdx[i] >= 0 || ctx.keep[i] || ctx.doorCell[i] || ctx.edge[i] || ctx.zone[i]) return false;
    }
    if (ring) {
      const rc = Math.max(1, Math.round(ring / CELL));
      for (let cy = y0 - rc; cy <= y1 + rc; cy++) for (let cx = x0 - rc; cx <= x1 + rc; cx++) {
        if (cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1) continue;
        if (!g.inBounds(cx, cy) || g.cells[g.idx(cx, cy)] !== FLOOR || g.blocked[g.idx(cx, cy)]) return false;
      }
    }
    return h <= r.ceil - base - 0.05 && !propBlocksDoorway(layout, x, z, hx, hz, base, h) && clear3d(x - hx, x + hx, base, base + h, z - hz, z + hz);
  };
  /**
   * An anchored box (W along the wall, D deep, H tall) with its back to wall w at q, keeping a `front` m access strip of open floor in
   * front of it over its width (operators / doors of switchgear). Returns its centre or null.
   */
  const wallSolid = (r: RoomF, w: Wall, q: number, W: number, D: number, H: number, tag: WasteTag, front: number, o: {zoneOk?: boolean} = {}): V2 | null => {
    if (!wallFree(r, w, q - W / 2, q + W / 2, 0.6)) return null;
    const along = w === 'front' || w === 'back' ? r.au : r.av;
    const [x, z] = onWall(r, w, q, D / 2 + 0.04);
    const hx = along[0] ? W / 2 : D / 2, hz = along[0] ? D / 2 : W / 2;
    const [sx, sz] = onWall(r, w, q, D + 0.04 + front / 2);
    const [a0, b0, a1, b1] = cellsOfBox(sx, sz, along[0] ? W / 2 : front / 2, along[0] ? front / 2 : W / 2);
    for (let cy = b0; cy <= b1; cy++) for (let cx = a0; cx <= a1; cx++) if (!g.walkable(cx, cy) || ctx.doorCell[g.idx(cx, cy)]) return null;
    if (!solid(r, x, z, hx, hz, H, tag, {zoneOk: o.zoneOk})) return null;
    for (let cy = b0; cy <= b1; cy++) for (let cx = a0; cx <= a1; cx++) ctx.keep[g.idx(cx, cy)] = 1;
    return [x, z];
  };
  /**
   * Up to `max` switchgear cabinets (REACTOR_KIT, 1.1 x 1.3 x 2.2 m) backed to the given walls of room r, each with a `front` m access
   * strip; the walls are tried in order, positions low-to-high. Returns their centres.
   */
  const SG = {w: 1.1, d: 1.3, h: 2.2};
  let sgCount = 0;
  const switchgearAt = (r: RoomF, walls: readonly Wall[], max: number, front: number, rr: Rng): V2[] => {
    const out: V2[] = [];
    for (const w of walls) for (const q of spots(r, w, rr, 0.25, SG.w / 2 + 0.15).sort((a, b) => a - b)) {
      if (out.length >= max) return out;
      const at = wallSolid(r, w, q, SG.w, SG.d, SG.h, 'waste:machine', front, {zoneOk: front < 0.9});
      if (!at) continue;
      model('switchgear', at[0], at[1], yawInto(r, w), SG.w, SG.d, SG.h);
      out.push(at);
      sgCount++;
    }
    return out;
  };
  /** Collision box of a local rect (s0..s1, t0..t1). */
  const lsolid = (r: RoomF, s0: number, s1: number, t0: number, t1: number, h: number, tag: WasteTag, o: {ring?: number; zoneOk?: boolean; sight?: boolean} = {}) => {
    const b = wb(r, s0, s1, t0, t1);
    return solid(r, (b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2, (b.x1 - b.x0) / 2, (b.z1 - b.z0) / 2, h, tag, o);
  };
  const lamp = (r: RoomF, s: number, t: number, rotAlongU = true) => {
    const [x, z] = pt(r, s, t);
    const [cx, cy] = g.cellOf(x, z);
    if (!g.inBounds(cx, cy) || g.area[g.idx(cx, cy)] !== r.a.id) return;
    for (const l of layout.lights) if (l.area === r.a.id && Math.hypot(l.x - x, l.z - z) < 2.2) return;
    const along = rotAlongU ? r.au : r.av;
    const l: LightPlacement = {x: r3(x), y: r3(r.ceil - 0.05), z: r3(z), rot: along[0] ? 0 : Math.PI / 2, area: r.a.id, broken: false, flicker: false, warm: true, power: 1, dying: false, level};
    layout.lights.push(l);
    stats.lights++;
  };
  /** Wall spans kept free of plates (the generator's sign wall): area, wall-face point, centre height (absolute), width. */
  const reserved: {area: number; x: number; z: number; y: number; w: number}[] = [];
  const onReserved = (area: number, x: number, z: number, y: number, w: number) => reserved.some(q => q.area === area && Math.abs(q.y - y) < 0.6 && Math.hypot(q.x - x, q.z - z) < (q.w + w) / 2 + 0.1);
  /** Stencil plate on wall w at q (local), height y (relative); slides along the wall to a backed spot clear of doors. */
  const plate = (r: RoomF, w: Wall, q: number, y: number, text: string, width = 1.6, area = r.a) => {
    const side = sideOf(wallN(r, w)), len = wallLen(r, w);
    for (const dq of [0, 0.5, -0.5, 1, -1, 1.5, -1.5, 2.5, -2.5, 3.5, -3.5]) {
      const qq = Math.max(width / 2 + 0.1, Math.min(len - width / 2 - 0.1, q + dq));
      if (!wallFree(r, w, qq - width / 2, qq + width / 2, 0.1)) continue;
      const aq = along(r, w, qq);
      if (!backed(ctx, area, side, aq - width / 2, aq + width / 2, base + y - 0.2)) continue;
      const [x, z] = onWall(r, w, qq, 0.02);
      if (onReserved(area.id, x, z, base + y, width)) continue;
      const rot = side === 'N' ? 0 : side === 'S' ? Math.PI : side === 'W' ? Math.PI / 2 : -Math.PI / 2;
      layout.signs.push({x: r3(x), y: r3(base + y), z: r3(z), rot, kind: 'service', text, area: area.id, w: width, level});
      stats.signs++;
      return true;
    }
    return false;
  };
  /** Candidate positions along a wall (m), every `step`, seeded order. */
  const spots = (r: RoomF, w: Wall, rr: Rng, step = 0.5, m = 0.6): number[] => {
    const out: number[] = [];
    for (let q = m; q <= wallLen(r, w) - m + 1e-6; q += step) out.push(q);
    return rr.shuffle(out);
  };
  /** Local span of a door in room r: [s0, s1, t0, t1]. */
  const dspan = (r: RoomF, d: Door): [number, number, number, number] => {
    const p = loc(r, d.x * CELL, d.y * CELL), q = loc(r, (d.x + d.w) * CELL, (d.y + d.h) * CELL);
    return [Math.min(p[0], q[0]), Math.max(p[0], q[0]), Math.min(p[1], q[1]), Math.max(p[1], q[1])];
  };
  /** The wall of room r a door lies in, and its span along that wall. */
  const doorWall = (r: RoomF, d: Door): {w: Wall; q0: number; q1: number} => {
    const [s0, s1, t0, t1] = dspan(r, d);
    const w: Wall = t1 <= 0.01 ? 'front' : t0 >= r.lv - 0.01 ? 'back' : s1 <= 0.01 ? 'left' : 'right';
    return w === 'front' || w === 'back' ? {w, q0: s0, q1: s1} : {w, q0: t0, q1: t1};
  };
  /** A hazard band on room r's floor along door d (the 0.6 m strip just inside it). */
  const doorBand = (r: RoomF, d: Door | undefined) => {
    if (!d) return;
    const {w, q0, q1} = doorWall(r, d);
    if (w === 'front') stripe(r, q0, q1, 0.15, 0.75);
    else if (w === 'back') stripe(r, q0, q1, r.lv - 0.75, r.lv - 0.15);
    else if (w === 'left') stripe(r, 0.15, 0.75, q0, q1);
    else stripe(r, r.lu - 0.75, r.lu - 0.15, q0, q1);
  };
  /** A plate on room r's side of door d: over it when there is a soffit, else beside it. */
  const doorPlate = (r: RoomF | undefined, d: Door | undefined, text: string, width = 1.6) => {
    if (!d || !r) return false;
    const {w, q0, q1} = doorWall(r, d), over = r.ceil - base - d.height >= 0.6;
    return over ? plate(r, w, (q0 + q1) / 2, d.height + 0.35, text, width) : plate(r, w, q1 + 0.3 + width / 2, 2.1, text, width) || plate(r, w, q0 - 0.3 - width / 2, 2.1, text, width);
  };
  /** Room frame on the other side of a door from `k` (undefined for the deck). */
  const R2 = (k: WasteKey | 'deck'): RoomF | undefined => (k === 'deck' ? undefined : R[k]);
  /** Renames a space everywhere it is shown (the area, the plan, the carve's room record the map boards read). */
  const relabel = (k: WasteKey, label: string) => {
    const w = plan.by[k];
    if (!w) return;
    w.label = label;
    layout.areas[rec.areas[k]].label = label;
    for (const q of rec.rooms) if (q.key === k) q.label = label;
  };
  /** The name a door plate gives a space. */
  const NAME: Partial<Record<WasteKind, string>> = {
    vault: 'DRUM VAULT', cask: 'DRY CASK STORAGE · KEEP 1 M CLEAR', compactor: 'SUPERCOMPACTOR', hotcell: 'HOT CELL · SHIELDED', plant: 'GENERATOR & VENT PLANT',
    pump: 'SUMP · PUMP ROOM', switch: 'SWITCH ROOM · ISOLATE BEFORE WORK', control: 'REPOSITORY CONTROL', lockers: 'DOSIMETRY · CHANGE ROOM', hp: 'HEALTH PHYSICS · MONITOR ON EXIT',
    airlock: 'VAULT AIRLOCK · CHECK SEALS',
  };

  // =================================================================================================================================
  // RECEIVING BAY
  {
    const r = R.bay, rr = rng.fork('waste-bay');
    const ent = between('deck', 'bay');
    if (ent) {
      const [s0, s1] = dspan(r, ent);
      const dh = Math.min(ent.height, r.ceil - base);
      // roller-shutter frame: jamb guides (yellow, black bands), the shutter drum housing above the head, a dock band across the threshold
      for (const s of [s0 - 0.14, s1]) {
        lbox(r, s, s + 0.14, 0, 0.1, 0, dh, 'yellow');
        for (let y = 0.25; y < dh - 0.2; y += 0.6) lbox(r, s - 0.005, s + 0.145, -0.005, 0.105, y, y + 0.25, 'black');
      }
      if (r.ceil - base > dh + 0.75) {
        lbox(r, s0 - 0.25, s1 + 0.25, 0, 0.55, dh + 0.05, dh + 0.65, 'steelDark');
        lbox(r, s0 - 0.25, s1 + 0.25, 0.5, 0.56, dh + 0.1, dh + 0.3, 'yellow');
      }
      stripe(r, s0, s1, 0.15, 0.75);
      // the wayfinding plate on the DECK side of the entrance: centred over the opening on the pit-wall face, facing the shaft
      const front = layout.areas[rec.frontArea];
      const [, , te] = dspan(r, ent);
      if (front) {
        const [mx, mz] = pt(r, (s0 + s1) / 2, te - 0.02);
        const side = sideOf([r.av[0], r.av[1]]);
        const aq = side === 'N' || side === 'S' ? mx : mz, wdt = Math.min(3.2, Math.max(1.6, s1 - s0));
        const y = Math.min(dh + 0.45, front.ceil - base - 0.3);
        if (y > dh + 0.25 && backed(ctx, front, side, aq - wdt / 2, aq + wdt / 2, base + y - 0.2)) {
          const rot = side === 'N' ? 0 : side === 'S' ? Math.PI : side === 'W' ? Math.PI / 2 : -Math.PI / 2;
          layout.signs.push({x: r3(mx), y: r3(base + y), z: r3(mz), rot, kind: 'service', text: 'WASTE REPOSITORY · AUX GENERATOR 3', area: front.id, w: wdt, level});
          stats.signs++;
        }
      }
      plate(r, 'front', s1 + 1.6, 2.1, 'RECEIVING · MONITOR EVERY DRUM', 1.8);
    }
    // banded drum pallets along the side walls (anchored: 4 hero drums strapped on a steel skid ~1 t)
    let pallets = 0;
    for (const w of rr.shuffle(['left', 'right', 'back'] as Wall[])) {
      for (const q of spots(r, w, rr, 0.5, 1.4)) {
        if (pallets >= 4) break;
        const P = WASTE_SIZES.pallet.w;
        if (!wallFree(r, w, q - P / 2, q + P / 2, 0.8)) continue;
        if (drumPallet(r, w, q)) pallets++;
      }
    }
    // dock kit (existing kinds by function): pallet jack, hand truck, wheelie bins, crates, gas cylinder cart, extinguisher, barricade
    for (const [kind, n] of [['palletJack', 1], ['handTruck', 1], ['wheelieBin', 2], ['crate', 2], ['gasCylinderCart', 1], ['fireExtinguisher', 1], ['foldingBarricade', 1], ['tripodWorkLight', 1]] as [PropKind, number][]) {
      for (let i = 0; i < n; i++) {
        const w = rr.pick(['left', 'right', 'back', 'front'] as Wall[]);
        putWall(r, w, kind, spots(r, w, rr, 0.5, 0.8), {front: 0.6});
      }
    }
    // high-bay lamps: two rows
    for (const t of [r.lv * 0.32, r.lv * 0.72]) for (let s = 2.5; s < r.lu - 1.5; s += 5) lamp(r, s, t);
    // the goods shutters into the controlled side (a vault / the cask hall): a hazard band + a plate over each
    for (const q of doorsAt('bay')) {
      if (q.kind !== 'wide') continue;
      const o = R2(q.other);
      const {w, q0, q1} = doorWall(r, q.d);
      doorBand(r, q.d);
      plate(r, w, (q0 + q1) / 2, Math.min(q.d.height + 0.45, r.ceil - base - 0.4), o?.kind === 'cask' ? 'DRY CASK HALL · CONTROLLED AREA' : 'DRUM VAULT · CONTROLLED AREA', 2.2);
    }
  }

  /** A banded 4-drum pallet with its back to wall w at q (collision + skid + hero drums + straps). */
  function drumPallet(r: RoomF, w: Wall, q: number): boolean {
    const P = WASTE_SIZES.pallet.w, D = WASTE_SIZES.drum, deck = WASTE_SIZES.pallet.deck;
    const [x, z] = onWall(r, w, q, P / 2 + 0.08);
    if (stats.drums + 4 > WASTE_DRUM_CAP) return false;
    if (!solid(r, x, z, P / 2, P / 2, deck + D.h + 0.02, 'waste:pallet', {sight: false})) return false;
    box(x - P / 2, base, z - P / 2, x + P / 2, base + deck, z + P / 2, 'steelDark');
    for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      model('wasteDrum', x + a * 0.32, z + b * 0.32, (a + 2 * b) * 0.7, D.r * 2, D.r * 2, D.h, base + deck);
      stats.drums++;
    }
    for (const y of [0.35, 0.75]) {
      box(x - P / 2 + 0.02, base + deck + y, z - 0.645, x + P / 2 - 0.02, base + deck + y + 0.04, z - 0.635, 'black');
      box(x - P / 2 + 0.02, base + deck + y, z + 0.635, x + P / 2 - 0.02, base + deck + y + 0.04, z + 0.645, 'black');
      box(x - 0.645, base + deck + y, z - P / 2 + 0.02, x - 0.635, base + deck + y + 0.04, z + P / 2 - 0.02, 'black');
      box(x + 0.635, base + deck + y, z - P / 2 + 0.02, x + 0.645, base + deck + y + 0.04, z + P / 2 - 0.02, 'black');
    }
    return true;
  }

  // =================================================================================================================================
  // HEALTH-PHYSICS CHECKPOINT + DOSIMETRY / CHANGE ROOM
  {
    const r = R.hp, rr = rng.fork('waste-hp');
    const S = WASTE_SIZES.shower;
    // decon shower booths against a wall of the checkpoint (its first-aid furnishing permitting), else of the change room, else on a
    // long wall of the vault airlock or a sealed corridor (showering out of the controlled area; a 1.5 m lane kept past them)
    let booths = 0;
    const runs = [R.airlock, ...ofKind('corridor')];
    for (const rm of [r, R.lockers, ...runs]) for (const w of (runs.includes(rm) ? ['front', 'back'] : ['left', 'front', 'back', 'right']) as Wall[]) {
      if (booths && runs.includes(rm)) break;
      for (const q of spots(rm, w, rr, 0.25, S.w / 2 + 0.1)) {
        if (booths >= 2) break;
        if (!wallFree(rm, w, q - S.w / 2, q + S.w / 2, 0.5)) continue;
        const [x, z] = onWall(rm, w, q, S.d / 2 + 0.04);
        const along = w === 'front' || w === 'back' ? rm.au : rm.av;
        const hx = along[0] ? S.w / 2 : S.d / 2, hz = along[0] ? S.d / 2 : S.w / 2;
        if (!solid(rm, x, z, hx, hz, S.h, 'waste:shower', {zoneOk: true})) continue;
        model('deconShower', x, z, yawInto(rm, w), S.w, S.d, S.h);
        booths++;
      }
    }
    // walk-through portal monitor: two detector columns (0.3 x 0.6 m) either side of a 1.2 m lane, a header beam
    {
      const lane = 1.2, cw = 0.3, cd = 0.6, h = Math.min(2.25, r.ceil - base - 0.1);
      portal: for (const ft of [0.5, 0.36, 0.64]) for (const s of [r.lu * 0.5, r.lu * 0.35, r.lu * 0.65]) {
        const t = r.lv * ft;
        const a = lsolid(r, s - lane / 2 - cw, s - lane / 2, t - cd / 2, t + cd / 2, h, 'waste:portal', {sight: false});
        if (!a) continue;
        const b = lsolid(r, s + lane / 2, s + lane / 2 + cw, t - cd / 2, t + cd / 2, h, 'waste:portal', {sight: false});
        if (!b) { layout.props.splice(layout.props.indexOf(a), 1); unblock(a); stats.solids--; continue; }
        lbox(r, s - lane / 2 - cw, s - lane / 2, t - cd / 2, t + cd / 2, 0, h, 'machine');
        lbox(r, s + lane / 2, s + lane / 2 + cw, t - cd / 2, t + cd / 2, 0, h, 'machine');
        lbox(r, s - lane / 2 - cw, s + lane / 2 + cw, t - 0.2, t + 0.2, h, h + 0.18, 'steelDark');
        lbox(r, s - lane / 2 - cw + 0.05, s - lane / 2 - 0.05, t - cd / 2 - 0.01, t - cd / 2, 1.3, 1.6, 'black');
        break portal;
      }
    }
    mount(r, 'left', 'eyewashStation', spots(r, 'left', rr), 0.9) ?? mount(r, 'back', 'eyewashStation', spots(r, 'back', rr), 0.9);
    mount(r, 'right', 'firstAidWallKit', spots(r, 'right', rr), 1.3) ?? mount(r, 'front', 'firstAidWallKit', spots(r, 'front', rr), 1.3);
    mount(r, 'back', 'aedWallCabinet', spots(r, 'back', rr), 1.2) ?? mount(r, 'left', 'aedWallCabinet', spots(r, 'left', rr), 1.2);
    putWall(r, 'front', 'bench', spots(r, 'front', rr), {front: 0.6}) ?? putWall(r, 'back', 'bench', spots(r, 'back', rr), {front: 0.6});
    // the step-off band at the change-room door (the way toward the controlled area)
    doorBand(r, between('hp', 'lockers'));
    doorPlate(R.bay, between('bay', 'hp'), NAME.hp!, 1.8);
    lamp(r, r.lu * 0.3, r.lv * 0.3); lamp(r, r.lu * 0.75, r.lv * 0.3); lamp(r, r.lu * 0.5, r.lv * 0.75);
  }
  {
    const r = R.lockers, rr = rng.fork('waste-lockers');
    // the dosimeter-badge rack by the door (an open-fronted key rack: badges are not items), a coat rack
    mount(r, 'front', 'keyCabinet', spots(r, 'front', rr), 1.3) ?? mount(r, 'left', 'keyCabinet', spots(r, 'left', rr), 1.3);
    putWall(r, 'right', 'coatRack', spots(r, 'right', rr), {front: 0.4}) ?? putWall(r, 'left', 'coatRack', spots(r, 'left', rr), {front: 0.4});
    doorPlate(R.hp, between('hp', 'lockers'), NAME.lockers!, 1.5);
    doorPlate(r, between('lockers', 'airlock'), NAME.airlock!, 1.8);
    lamp(r, r.lu * 0.3, r.lv / 2); lamp(r, r.lu * 0.75, r.lv / 2);
  }

  // =================================================================================================================================
  // CONTROL ROOM
  {
    const r = R.control, rr = rng.fork('waste-control');
    const C = {w: 3.0, d: 1.49, h: 1.54};
    // the control console: free-standing mid-room (an aisle round it), else back to a wall with a 1.1 m operator strip in front
    let placed = false;
    console: for (const fs of [0.5, 0.38, 0.62, 0.28, 0.72]) for (const ft of [0.5, 0.42, 0.58]) {
      const s = r.lu * fs, t = r.lv * ft;
      if (lsolid(r, s - C.w / 2, s + C.w / 2, t - C.d / 2, t + C.d / 2, C.h, 'waste:machine', {ring: 0.5, sight: false})) {
        const [x, z] = pt(r, s, t);
        model('controlConsole', x, z, Math.atan2(-r.av[0], -r.av[1]), C.w, C.d, C.h);
        // the operator's chair (a loose, dynamic office chair) pulled up to the console's front (it faces -v)
        const [px, pz] = pt(r, s + 0.4, t - C.d / 2 - 0.55);
        put(r, 'officeSwivelChair', px, pz, quarter(Math.atan2(r.av[0], r.av[1])));
        placed = true;
        break console;
      }
    }
    if (!placed) wall: for (const w of ['back', 'front', 'right', 'left'] as Wall[]) for (const q of spots(r, w, rr, 0.25, C.w / 2 + 0.1)) {
      const at = wallSolid(r, w, q, C.w, C.d, C.h, 'waste:machine', 1.1, {zoneOk: true});
      if (!at) continue;
      model('controlConsole', at[0], at[1], yawInto(r, w), C.w, C.d, C.h);
      break wall;
    }
    putWall(r, rr.pick(['front', 'back', 'left'] as Wall[]), 'filingCabinet', spots(r, 'front', rr), {front: 0.8});
    const p = plan.by.control.parent;
    doorPlate(R[p], between(p, 'control'), NAME.control!, 1.5);
    lamp(r, r.lu * 0.3, r.lv / 2); lamp(r, r.lu * 0.75, r.lv / 2);
  }

  // =================================================================================================================================
  // DRUM VAULT(S): racks in rows (along the hall, or across it off a spine aisle: the vault's frame), cross aisles at the doors
  for (const w0 of plan.rooms.filter(w => w.kind === 'vault')) {
    const rr = rng.fork(`waste-${w0.key}`);
    const B = WASTE_SIZES.rackBay, D = WASTE_SIZES.drum;
    const wallGap = 2.0, aisle = 1.4;
    /**
     * The rack layout of a frame: rows along s (stacked along t), cut by ONE cross aisle at the vault's main door (from the room it
     * opens off) when that door is on a front / back wall; every other door opens onto the 2 m perimeter aisle along the walls.
     */
    const main = treeDoor(w0.key);
    const rackLayout = (r: RoomF) => {
      const bands: [number, number][] = [];
      if (main) { const {w, q0, q1} = doorWall(r, main); if (w === 'front' || w === 'back') bands.push([q0 - 0.6, q1 + 0.6]); }
      // (the end aisles 1.7 m: the 2 m perimeter aisles run along the long walls; furnishing front strips are kept anyway)
      const sA = 1.7, sB = r.lu - 1.7;
      // rack row centres along t
      const inner = r.lv - 2 * wallGap;
      const nRows = Math.max(0, Math.floor((inner + aisle) / (B.d + aisle)));
      const used = nRows * B.d + (nRows - 1) * aisle;
      const rows: number[] = [];
      for (let i = 0; i < nRows; i++) rows.push(wallGap + (inner - used) / 2 + B.d / 2 + i * (B.d + aisle));
      // free s-intervals
      const free: [number, number][] = [];
      {
        let cur = sA;
        for (const [a, b] of bands.sort((p, q) => p[0] - q[0])) { if (a > cur) free.push([cur, Math.min(a, sB)]); cur = Math.max(cur, b); }
        if (cur < sB) free.push([cur, sB]);
      }
      const units: {s0: number; bays: number; t: number}[] = [];
      // each free run split into the units (2-4 bays, an aisle between: a cross aisle every ~6 m down the rows) that hold the most bays
      for (const t of rows) for (const [a, b] of free) {
        const m = Math.floor((b - a + 1e-6) / B.w);
        let k = 0, best = 0;
        for (let q = 1; 3 * q - 1 <= m; q++) { const n = Math.min(4 * q, m - (q - 1)); if (n > best) { best = n; k = q; } }
        let s = a;
        for (let i = 0; i < k; i++) {
          const n = Math.floor(best / k) + (i < best % k ? 1 : 0);
          units.push({s0: s, bays: n, t});
          s += n * B.w + aisle;
        }
      }
      return {rows, units, bays: units.reduce((n, u) => n + u.bays, 0)};
    };
    // the plan's seeded rack direction (along the hall / across it), unless the doors leave the other one clearly more bays (a door in
    // the end wall cuts a spine aisle through rows across a narrow hall)
    const rPlan = R[w0.key], rTurn = roomF({...w0, alongU: !w0.alongU});
    const lPlan = rackLayout(rPlan), lTurn = rackLayout(rTurn);
    const turned = lTurn.bays > lPlan.bays * 1.3 + 1;
    const r = turned ? rTurn : rPlan, {rows, units} = turned ? lTurn : lPlan;
    if (turned) R[w0.key] = r;
    for (const u0 of units) {
      // a unit the station dresser's furnishing gets in the way of shrinks (from either end) down to two bays
      let u: {s0: number; bays: number; t: number} | null = null;
      // (a shorter unit slides along its span, 0.5 m steps, past the furnishing before it shrinks again)
      const slides = (k: number) => { const out = [u0.s0, u0.s0 + (u0.bays - k) * B.w]; for (let x = u0.s0 + 0.5; x < u0.s0 + (u0.bays - k) * B.w - 0.01; x += 0.5) out.push(x); return out; };
      fit: for (let k = u0.bays; k >= 2; k--) for (const s0 of slides(k)) {
        if (lsolid(r, s0, s0 + k * B.w, u0.t - B.d / 2, u0.t + B.d / 2, B.top + 0.05, 'waste:rack', {sight: true})) { u = {s0, bays: k, t: u0.t}; break fit; }
      }
      if (!u) continue;
      const s0 = u.s0, s1 = u.s0 + u.bays * B.w, t = u.t;
      stats.racks++;
      // uprights at every bay line on both faces, the tier beams, the upper deck (grating), the top rails
      for (let i = 0; i <= u.bays; i++) {
        const s = s0 + i * B.w;
        for (const tf of [t - B.d / 2, t + B.d / 2 - 0.08]) lbox(r, s - (i === u.bays ? 0.08 : 0), s + (i === u.bays ? 0 : 0.08), tf, tf + 0.08, 0, B.top, 'steelDark');
      }
      for (const tf of [t - B.d / 2, t + B.d / 2 - 0.06]) {
        for (const y of [0.1, B.tier - 0.12, B.top - 0.1]) lbox(r, s0, s1, tf, tf + 0.06, y, y + 0.1, 'yellow');
      }
      lbox(r, s0 + 0.04, s1 - 0.04, t - B.d / 2 + 0.06, t + B.d / 2 - 0.06, B.tier - 0.03, B.tier, 'grating');
      // drums: 2 across x 2 deep (one per aisle face) x 2 tiers, a few bays picked over
      for (let i = 0; i < u.bays; i++) for (const tier of [0, 1]) for (const ds of [0.36, 1.04]) for (const dt of [-0.33, 0.33]) {
        if (rr.chance(0.14) || stats.drums >= WASTE_DRUM_CAP) continue;
        const [x, z] = pt(r, s0 + i * B.w + ds, t + dt);
        model('wasteDrum', x, z, rr.range(-Math.PI, Math.PI), D.r * 2, D.r * 2, D.h, base + (tier ? B.tier : 0.02));
        stats.drums++;
      }
      // painted aisle lines along both faces
      lbox(r, s0 - 0.3, s1 + 0.3, t - B.d / 2 - 0.42, t - B.d / 2 - 0.34, 0, 0.006, 'yellow');
      lbox(r, s0 - 0.3, s1 + 0.3, t + B.d / 2 + 0.34, t + B.d / 2 + 0.42, 0, 0.006, 'yellow');
    }
    // high-bay lamps over the aisles
    const aisles: number[] = [];
    if (rows.length) { aisles.push(rows[0] - B.d / 2 - (rows[0] - B.d / 2) / 2); for (let i = 0; i + 1 < rows.length; i++) aisles.push((rows[i] + rows[i + 1]) / 2); aisles.push((rows[rows.length - 1] + B.d / 2 + r.lv) / 2); }
    else aisles.push(r.lv / 2);
    let nl = 0;
    for (const t of aisles) for (let s = 3; s < r.lu - 2 && nl < 10; s += 6) { lamp(r, s, t); nl++; }
    // a pallet jack parked in an end aisle, plates
    const endW: Wall = rr.chance(0.5) ? 'left' : 'right';
    putWall(r, endW, 'palletJack', spots(r, endW, rr), {front: 0.4});
    const name = plan.by[r.key].label.toUpperCase();
    plate(r, 'left', r.lv / 2, 2.6, `${name} · LOW-LEVEL WASTE`, 2.2) || plate(r, 'front', r.lu / 2, 2.6, `${name} · LOW-LEVEL WASTE`, 2.2);
    plate(r, 'right', r.lv / 2, 2.6, 'NO NAKED FLAMES · NO EATING OR DRINKING', 2.4);
    // the doors to the sealed corridors: a plate over each on the vault side; the corridor side names the vault
    for (const q of doorsAt(r.key)) {
      const o = R2(q.other);
      if (!o) continue;
      if (o.kind === 'corridor') {
        const {w, q0, q1} = doorWall(r, q.d);
        plate(r, w, (q0 + q1) / 2, Math.min(q.d.height + 0.45, r.ceil - base - 0.4), 'SEALED VAULT CORRIDOR', 1.8);
        if (!q.loop) doorPlate(o, q.d, name, 1.6);
      }
    }
  }

  // =================================================================================================================================
  // THE HOT-CELL WINDOW (before the casks / the press claim the floor): set into a wall of the hot-cell gallery when the plan has one,
  // else of the processing room — the outer wall first (the shielded cell behind it is solid rock) — else the cask hall's / a vault's
  const hotRng = rng.fork('waste-hotcell');
  let hotPlaced = false;
  const hotCell = (cands: readonly [RoomF | undefined, Wall][], pad = 0.6) => {
    if (hotPlaced) return;
    const rr = hotRng, HC = WASTE_SIZES.hotCell;
    hot: for (const [rm, w] of cands) {
      if (!rm || rm.ceil - base < HC.h + 0.1) continue;
      const mid = wallLen(rm, w) / 2;
      for (const q of spots(rm, w, rr, 0.25, HC.w / 2 + 0.1).sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid))) {
        if (!wallFree(rm, w, q - HC.w / 2, q + HC.w / 2, pad)) continue;
        const [x, z] = onWall(rm, w, q, HC.d / 2);
        const along = w === 'front' || w === 'back' ? rm.au : rm.av;
        const hx = along[0] ? HC.w / 2 : HC.d / 2, hz = along[0] ? HC.d / 2 : HC.w / 2;
        if (!solid(rm, x, z, hx, hz, HC.h, 'waste:machine', {zoneOk: true})) continue;
        model('hotCellWindow', x, z, yawInto(rm, w), HC.w, HC.d, HC.h);
        hotPlaced = true;
        break hot;
      }
    }
  };
  const HOT = R.hotcell;
  if (HOT) {
    hotCell(WALLS.map(w => [HOT, w] as [RoomF, Wall]));
    hotCell(WALLS.map(w => [HOT, w] as [RoomF, Wall]), 0.3);
    // a gallery whose walls the station dresser's fittings took cannot hold the window: it is the sample counting room instead
    if (!hotPlaced) relabel('hotcell', 'Sample counting room');
    const p = plan.by.hotcell.parent;
    doorPlate(R[p], between(p, 'hotcell'), hotPlaced ? NAME.hotcell! : 'SAMPLE COUNTING · DOSIMETER ON', 1.6);
    lamp(HOT, HOT.lu * 0.5, HOT.lv * 0.5);
  }
  hotCell([[R.compactor, 'right'], [R.compactor, 'back'], [R.compactor, 'left'], [R.compactor, 'front']]);

  // =================================================================================================================================
  // DRY-CASK HALL: a grid of casks, keep-clear squares, the crane runway
  {
    const r = R.cask, rr = rng.fork('waste-cask');
    const K = WASTE_SIZES.cask, gap = 1.35, margin = 1.3;
    const fits = (w: number, d: number) => {
      const nu = Math.floor((r.lu - 2 * margin + gap) / (w + gap)), nv = Math.floor((r.lv - 2 * margin + gap) / (d + gap));
      return {nu, nv, n: nu * nv};
    };
    const a0 = fits(K.w, K.d), a1 = fits(K.d, K.w);
    const turn = a1.n > a0.n || (a1.n === a0.n && rr.chance(0.5));
    const cw = turn ? K.d : K.w, cd = turn ? K.w : K.d, {nu, nv} = turn ? a1 : a0;
    const h = Math.min(K.h, r.ceil - base - 0.3);
    // the grid centred, else shifted (up to 1 m each way) to where the hall's doors and the dresser's furnishing leave the most casks
    // (a dry fit of every slot first; robust to what the station dresser placed before us)
    const su0 = (r.lu - (nu * cw + (nu - 1) * gap)) / 2, sv0 = (r.lv - (nv * cd + (nv - 1) * gap)) / 2;
    let su = su0, sv = sv0, bestN = -1;
    for (const [ds, dt] of [[0, 0], [0.5, 0], [-0.5, 0], [0, 0.5], [0, -0.5], [1, 0], [-1, 0], [0, 1], [0, -1], [0.5, 0.5], [-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
      const a = su0 + ds, b2 = sv0 + dt;
      if (a < 0.6 || b2 < 0.6 || a + nu * cw + (nu - 1) * gap > r.lu - 0.6 || b2 + nv * cd + (nv - 1) * gap > r.lv - 0.6) continue;
      let n = 0;
      for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
        const s = a + i * (cw + gap) + cw / 2, t = b2 + j * (cd + gap) + cd / 2, bx = wb(r, s - cw / 2, s + cw / 2, t - cd / 2, t + cd / 2);
        if (solidFits(r, (bx.x0 + bx.x1) / 2, (bx.z0 + bx.z1) / 2, (bx.x1 - bx.x0) / 2, (bx.z1 - bx.z0) / 2, h, 0.5)) n++;
      }
      if (n > bestN) { bestN = n; su = a; sv = b2; }
      if (n === nu * nv) break;
    }
    for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
      const s = su + i * (cw + gap) + cw / 2, t = sv + j * (cd + gap) + cd / 2;
      if (h < K.h - 0.01) continue; // the hero cask is never squashed: a hall too low keeps its floor clear
      // (the grid keeps 1.35 m aisles between casks; the ring keeps open floor all round toward the walls' furnishing)
      if (!lsolid(r, s - cw / 2, s + cw / 2, t - cd / 2, t + cd / 2, h, 'waste:cask', {ring: 0.5, sight: true})) continue;
      const [x, z] = pt(r, s, t);
      const yaw = (turn ? Math.atan2(r.au[0], r.au[1]) : Math.atan2(r.av[0], r.av[1])) + (rr.chance(0.5) ? Math.PI : 0);
      model('storageCask', x, z, yaw, K.w, K.d, K.h);
      stats.casks++;
      // keep-clear square painted 0.35 m outside the cask
      const e = 0.35, lw = 0.08;
      lbox(r, s - cw / 2 - e, s + cw / 2 + e, t - cd / 2 - e, t - cd / 2 - e + lw, 0, 0.006, 'yellow');
      lbox(r, s - cw / 2 - e, s + cw / 2 + e, t + cd / 2 + e - lw, t + cd / 2 + e, 0, 0.006, 'yellow');
      lbox(r, s - cw / 2 - e, s - cw / 2 - e + lw, t - cd / 2 - e, t + cd / 2 + e, 0, 0.006, 'yellow');
      lbox(r, s + cw / 2 + e - lw, s + cw / 2 + e, t - cd / 2 - e, t + cd / 2 + e, 0, 0.006, 'yellow');
    }
    // overhead crane runway: two girders on the long walls, a bridge girder over an aisle between casks, a hoist with its hook block
    const top = r.ceil - base;
    if (top > K.h + 0.9) {
      const gy = top - 0.55;
      lbox(r, 0, r.lu, 0.05, 0.4, gy, gy + 0.45, 'yellow');
      lbox(r, 0, r.lu, r.lv - 0.4, r.lv - 0.05, gy, gy + 0.45, 'yellow');
      const sBridge = nu > 1 ? su + cw + gap / 2 + (rr.int(0, nu - 2)) * (cw + gap) : Math.min(r.lu - 0.6, su + cw + 0.65);
      lbox(r, sBridge - 0.25, sBridge + 0.25, 0.05, r.lv - 0.05, gy + 0.45, gy + 0.85, 'yellow');
      lbox(r, sBridge - 0.26, sBridge + 0.26, 0.05, r.lv - 0.05, gy + 0.6, gy + 0.64, 'black');
      const tH = r.lv * rr.range(0.3, 0.7);
      lbox(r, sBridge - 0.4, sBridge + 0.4, tH - 0.5, tH + 0.5, gy - 0.1, gy + 0.45, 'steelDark');
      const hookY = Math.max(2.5, gy - rr.range(0.8, 2.0));
      lbox(r, sBridge - 0.02, sBridge + 0.02, tH - 0.02, tH + 0.02, hookY + 0.45, gy - 0.1, 'cable');
      lbox(r, sBridge - 0.2, sBridge + 0.2, tH - 0.15, tH + 0.15, hookY, hookY + 0.45, 'yellow');
    }
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) lamp(r, r.lu * (0.28 + 0.44 * i), r.lv * (0.3 + 0.4 * j));
    const tw: Wall = rr.pick(['back', 'right'] as Wall[]);
    putWall(r, tw, 'tripodWorkLight', spots(r, tw, rr), {front: 0.4});
    putWall(r, 'right', 'gasCylinderCart', spots(r, 'right', rr), {front: 0.6}) ?? putWall(r, 'left', 'gasCylinderCart', spots(r, 'left', rr), {front: 0.6});
    // the cask doors: the corridor / vault side names the hall
    for (const q of doorsAt('cask')) { const o = R2(q.other); if (o && o.kind !== 'store' && o.kind !== 'bay') doorPlate(o, q.d, NAME.cask!, 2.0); }
    plate(r, 'back', r.lu / 2, 3.0, 'DRY CASK HALL · SURVEY BEFORE ENTRY', 2.4) || plate(r, 'front', r.lu / 2, 3.0, 'DRY CASK HALL · SURVEY BEFORE ENTRY', 2.4);
  }
  // the hot-cell window, if neither the gallery nor the processing room had a wall for it: an inspection cell looking into the cask
  // hall / a vault / the bay / the plant
  hotCell([[R.cask, 'back'], [R.cask, 'right'], [R.cask, 'left'], [R.vault, 'left'], [R.vault, 'right'], [R.bay, 'back'], [R.plant, 'back']]);
  // (last: any wall of the halls / processing rooms, 0.3 m off the door jambs)
  for (const rm of [HOT, R.compactor, R.cask, ...ofKind('vault'), R.plant, R.bay, R.pump]) hotCell(WALLS.map(w => [rm, w] as [RoomF | undefined, Wall]), 0.3);

  // =================================================================================================================================
  // COMPACTOR & PROCESSING
  {
    const r = R.compactor, rr = rng.fork('waste-compactor');
    const top = r.ceil - base;
    // the supercompactor press (3.0 x 2.0 m, ram frame to ~3.3 m) with its roller feed, a crush-zone band round it
    const PH = Math.min(3.3, top - 0.25);
    const cands: [number, number, boolean][] = [];
    for (const turn of [false, true]) for (const fs of [0.45, 0.55, 0.35, 0.65]) for (const ft of [0.5, 0.4, 0.6, 0.32, 0.68]) cands.push([r.lu * fs, r.lv * ft, turn]);
    for (const [s, t, turn] of cands) {
      // (turned: the press's long side runs along t; its feed bed is then left out)
      const PW = turn ? 2.0 : 3.0, PD = turn ? 3.0 : 2.0;
      if (!lsolid(r, s - PW / 2, s + PW / 2, t - PD / 2, t + PD / 2, PH, 'waste:compactor', {ring: 1.0})) continue;
      lbox(r, s - PW / 2, s + PW / 2, t - PD / 2, t + PD / 2, 0, 1.15, 'machine');
      lbox(r, s - PW / 2 + 0.1, s + PW / 2 - 0.1, t - PD / 2 + 0.1, t + PD / 2 - 0.1, 1.15, 1.25, 'black');
      for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) lbox(r, s + a * (PW / 2 - 0.25) - 0.13, s + a * (PW / 2 - 0.25) + 0.13, t + b * (PD / 2 - 0.25) - 0.13, t + b * (PD / 2 - 0.25) + 0.13, 1.15, PH - 0.35, 'yellow');
      lbox(r, s - PW / 2, s + PW / 2, t - PD / 2, t + PD / 2, PH - 0.4, PH, 'steelDark');
      const [cx, cz] = pt(r, s, t);
      decor.cyls.push({x: r3(cx), y: r3(base + 1.6), z: r3(cz), r: 0.32, h: r3(PH - 2.0), m: 'pipe'});
      decor.cyls.push({x: r3(cx), y: r3(base + 1.25), z: r3(cz), r: 0.5, h: 0.35, m: 'steelDark'});
      stripe(r, s - PW / 2 - 0.6, s + PW / 2 + 0.6, t - PD / 2 - 0.6, t - PD / 2 - 0.2);
      stripe(r, s - PW / 2 - 0.6, s + PW / 2 + 0.6, t + PD / 2 + 0.2, t + PD / 2 + 0.6);
      // roller feed bed on the press's -s side
      const fs1 = s - PW / 2 - 1.25, fs0 = fs1 - 2.6;
      if (!turn && fs0 > 1.2 && lsolid(r, fs0, fs1, t - 0.45, t + 0.45, 0.9, 'waste:conveyor', {zoneOk: false, sight: false})) {
        for (const tf of [t - 0.45, t + 0.39]) lbox(r, fs0, fs1, tf, tf + 0.06, 0.62, 0.82, 'steelDark');
        for (const [a, b] of [[fs0, t - 0.45], [fs0, t + 0.39], [fs1 - 0.06, t - 0.45], [fs1 - 0.06, t + 0.39]]) lbox(r, a, a + 0.06, b, b + 0.06, 0, 0.62, 'steelDark');
        for (let s2 = fs0 + 0.12; s2 < fs1 - 0.05; s2 += 0.2) {
          const [rx, rz] = pt(r, s2, t);
          decor.cyls.push({x: r3(rx), y: r3(base + 0.8), z: r3(rz), r: 0.04, h: 0.84, m: 'pipe', ax: r.av[0] ? 'x' : 'z'});
        }
      }
      break;
    }
    // drums AWAITING compaction: banded drum pallets along the processing room's walls (then the bay's) whenever the racks + the
    // bay's pallets hold fewer than 72 (a narrow vault the dresser's machinery crowds), up to six
    for (let extra = 0, k = 0; k < 2 && stats.drums < 72 && extra < 6; k++) {
      const rm = k === 0 ? r : R.bay;
      for (const w of WALLS) for (const q of spots(rm, w, rr, 0.5, 1.0)) {
        if (stats.drums >= 72 || extra >= 6) break;
        const P = WASTE_SIZES.pallet.w;
        if (wallFree(rm, w, q - P / 2, q + P / 2, 0.8) && drumPallet(rm, w, q)) extra++;
      }
    }
    // compacted pucks on pallets (anchored, banded)
    let pucks = 0;
    for (const w of ['back', 'left', 'front', 'right'] as Wall[]) for (const q of spots(r, w, rr, 0.5, 1.0)) {
      if (pucks >= 2) break;
      const P = WASTE_SIZES.pallet.w;
      if (!wallFree(r, w, q - P / 2, q + P / 2, 0.8)) continue;
      const [x, z] = onWall(r, w, q, P / 2 + 0.08);
      if (!solid(r, x, z, P / 2, P / 2, 1.15, 'waste:pallet', {sight: false})) continue;
      box(x - P / 2, base, z - P / 2, x + P / 2, base + 0.12, z + P / 2, 'steelDark');
      for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) for (let k = 0; k < 4; k++) decor.cyls.push({x: r3(x + a * 0.32), y: r3(base + 0.12 + k * 0.25), z: r3(z + b * 0.32), r: 0.3, h: 0.24, m: 'steel', c: 0xc8b070});
      pucks++;
    }
    for (const t of [r.lv * 0.3, r.lv * 0.72]) lamp(r, r.lu / 2, t, false);
    const bw: Wall = rr.pick(['back', 'left'] as Wall[]);
    putWall(r, bw, 'wheelieBin', spots(r, bw, rr), {front: 0.6});
    const sd = treeDoor('compactor');
    if (sd) { const {w, q0, q1} = doorWall(r, sd); plate(r, w, q1 + 1.3, 2.1, 'SUPERCOMPACTOR · CRUSH ZONE', 1.7) || plate(r, w, q0 - 1.3, 2.1, 'SUPERCOMPACTOR · CRUSH ZONE', 1.7); }
    const p = plan.by.compactor.parent;
    if (R[p]?.kind === 'corridor') doorPlate(R[p], sd, NAME.compactor!, 1.6);
  }

  // =================================================================================================================================
  // HEAVY DOORS AND GOODS SHUTTERS: steel door frames (jambs, head, bolt bars), airlock bands
  for (const q of refs.filter(x => x.kind === 'heavy' || x.kind === 'wide')) {
    const door = q.d;
    for (const key of [q.a, q.b]) {
      if (key === 'deck') continue;
      const r = R[key];
      const {w, q0, q1} = doorWall(r, door);
      const dh = Math.min(door.height, r.ceil - base);
      const jb = (qa: number, qb: number, y0: number, y1: number, m: WasteMat, off = 0.16) => {
        const p = onWall(r, w, qa, 0), p2 = onWall(r, w, qb, off);
        box(p[0], base + y0, p[1], p2[0], base + y1, p2[1], m);
      };
      jb(q0 - 0.32, q0, 0, dh + 0.3, 'steelDark');
      jb(q1, q1 + 0.32, 0, dh + 0.3, 'steelDark');
      if (r.ceil - base > dh + 0.35) jb(q0 - 0.32, q1 + 0.32, dh, dh + 0.3, 'steelDark');
      for (let y = 0.2; y < dh - 0.3; y += 0.5) { jb(q0 - 0.3, q0 - 0.02, y, y + 0.22, 'yellow', 0.17); jb(q1 + 0.02, q1 + 0.3, y, y + 0.22, 'yellow', 0.17); }
      // the bolt bars on the jambs
      for (const y of [0.5, 1.2, 1.9]) { jb(q0 - 0.25, q0 - 0.05, y, y + 0.08, 'black', 0.2); jb(q1 + 0.05, q1 + 0.25, y, y + 0.08, 'black', 0.2); }
      doorBand(r, door);
    }
  }

  // =================================================================================================================================
  // AIRLOCK + SEALED CORRIDORS + SERVICE CORRIDOR: plates, lamps down the runs
  {
    const a = R.airlock, k1 = plan.rooms.find(w => w.parent === 'airlock' && w.kind === 'corridor');
    if (k1) doorPlate(a, between('airlock', k1.key), 'AIRLOCK · ONE DOOR AT A TIME', 1.8);
    for (const r of [...ofKind('corridor'), ...ofKind('service'), a]) {
      const rr = rng.fork(`waste-${r.key}`);
      for (let s = 2; s < r.lu - 1; s += 6) lamp(r, s, r.lv / 2);
      if (r.kind === 'corridor' && (r.key === k1?.key || rr.chance(0.5))) plate(r, rr.chance(0.5) ? 'front' : 'back', r.lu * rr.range(0.25, 0.75), 2.1, 'SEALED VAULT CORRIDOR · RADIATION AREA', 2.4);
      if (r.kind === 'service') plate(r, 'front', r.lu * 0.5, 2.1, 'SERVICE CORRIDOR · AUTHORISED STAFF', 2.2);
    }
  }

  // =================================================================================================================================
  // SUMP & PUMP ROOM
  const PUMP = R.pump;
  if (PUMP) {
    const r = PUMP;
    // the sump: a 1.6 x 1.6 m grating flush in a back corner, a riser pipe beside it
    for (const s of [0.4, r.lu - 2.0]) {
      const b = wb(r, s, s + 1.6, r.lv - 2.0, r.lv - 0.4);
      const [x0c, y0c, x1c, y1c] = cellsOfBox((b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2, 0.8, 0.8);
      let ok = true;
      for (let cy = y0c; cy <= y1c && ok; cy++) for (let cx = x0c; cx <= x1c; cx++) { const i = g.idx(cx, cy); if (g.area[i] !== r.a.id || g.blocked[i] || ctx.doorCell[i]) { ok = false; break; } }
      if (!ok) continue;
      box(b.x0, base, b.z0, b.x1, base + 0.012, b.z1, 'grating');
      box(b.x0 - 0.05, base, b.z0 - 0.05, b.x1 + 0.05, base + 0.01, b.z1 + 0.05, 'yellow');
      break;
    }
    for (const [s, t] of [[0.18, r.lv - 0.18], [r.lu - 0.18, r.lv - 0.18]]) {
      const [x, z] = pt(r, s, t);
      const [cx, cy] = g.cellOf(x, z);
      if (ctx.doorCell[g.idx(cx, cy)]) continue;
      decor.cyls.push({x: r3(x), y: base, z: r3(z), r: 0.11, h: r3(r.ceil - base), m: 'pipe'});
    }
    lamp(r, r.lu / 2, r.lv * 0.35, false); lamp(r, r.lu / 2, r.lv * 0.75, false);
    const p = plan.by.pump.parent;
    doorPlate(R[p], between(p, 'pump'), NAME.pump!, 1.3);
  }

  /**
   * Up to `max` ventilation fans on plinths backed to room r's walls (passes of [wall, door pad]; the next pass only while none stands):
   * the plinth, the fan housing record (the hub faces into the room), the duct up to the trunk under the ceiling. Returns the count.
   */
  function placeFans(r: RoomF, rr: Rng, max: number, passes: readonly (readonly [Wall, number])[]): number {
    const top = r.ceil - base, FR = 0.7, FW = 2.6, FD = 1.36, FH = 2.5, plinth = Math.max(0.6, Math.min(1.3, top - FH - 0.5));
    if (top < plinth + FH + 0.25) return 0;
    let fans = 0;
    const wbox = (w: Wall, qa: number, qb: number, da: number, db: number, y0: number, y1: number, m: WasteMat) => {
      const p = onWall(r, w, qa, da), q = onWall(r, w, qb, db);
      box(p[0], base + y0, p[1], q[0], base + y1, q[1], m);
    };
    const firstPad = passes[0]?.[1];
    for (const [w, pad] of passes) {
      if ((fans >= 1 && pad !== firstPad) || fans >= max) break;
      let lastQ = -Infinity, onThis = 0;
      for (const q of spots(r, w, rr, 0.25, FW / 2 + 0.3).sort((a, b) => a - b)) {
        if (fans >= max || q - lastQ < FW + 0.9) continue;
        if (!wallFree(r, w, q - FW / 2, q + FW / 2, pad)) continue;
        const alongV = w === 'front' || w === 'back' ? r.au : r.av;
        const [x, z] = onWall(r, w, q, FD / 2 + 0.05);
        const hx = alongV[0] ? FW / 2 : FD / 2, hz = alongV[0] ? FD / 2 : FW / 2;
        if (!solid(r, x, z, hx, hz, plinth + FH, 'waste:fan')) continue;
        wbox(w, q - FW / 2 + 0.1, q + FW / 2 - 0.1, 0.05, FD + 0.05, 0, plinth, 'concrete');
        const [hxw, hzw] = onWall(r, w, q, 0.05), n = wallN(r, w);
        decor.fans.push({x: r3(hxw), y: r3(base + plinth + 1.256), z: r3(hzw), nx: -n[0], nz: -n[1], r: FR});
        wbox(w, q - 0.55, q + 0.55, 0.05, 0.6, plinth + FH - 0.2, top - 0.05, 'steel');
        lastQ = q;
        fans++; onThis++;
      }
      if (onThis) wbox(w, 0.3, wallLen(r, w) - 0.3, 0.05, 0.95, top - 0.75, top - 0.05, 'steel');
    }
    return fans;
  }

  // =================================================================================================================================
  // GENERATOR & VENTILATION PLANT
  const gfx = (gox + rec.genFoot.w / 2) * CELL, gfz = (goy + rec.genFoot.h / 2) * CELL;
  const PL = R.plant;
  const pdoor = treeDoor('plant');
  const doorS = pdoor ? (dspan(PL, pdoor)[0] + dspan(PL, pdoor)[1]) / 2 : PL.lu / 2;
  // the switchgear's side wall: away from the main door
  const sideW: Wall = doorS < PL.lu / 2 ? 'right' : 'left';
  {
    const r = PL, rr = rng.fork('waste-plant');
    const top = r.ceil - base;
    // keep-clear band round the skid (painted on the floor, outside the footprint)
    {
      const x0 = gox * CELL, z0 = goy * CELL, x1 = (gox + rec.genFoot.w) * CELL, z1 = (goy + rec.genFoot.h) * CELL, e = 0.12, w = 0.3;
      decor.stripes.push({x0: r3(x0 - e - w), z0: r3(z0 - e - w), x1: r3(x1 + e + w), z1: r3(z0 - e), y: base});
      decor.stripes.push({x0: r3(x0 - e - w), z0: r3(z1 + e), x1: r3(x1 + e + w), z1: r3(z1 + e + w), y: base});
      decor.stripes.push({x0: r3(x0 - e - w), z0: r3(z0 - e), x1: r3(x0 - e), z1: r3(z1 + e), y: base});
      decor.stripes.push({x0: r3(x1 + e), z0: r3(z0 - e), x1: r3(x1 + e + w), z1: r3(z1 + e), y: base});
      // the plinth: a low concrete pad flush round the skid
      box(x0 - 0.1, base, z0 - 0.1, x1 + 0.1, base + 0.04, z1 + 0.1, 'concrete');
    }
    // two ventilation fans on plinths against the back wall (else a side wall) + their duct trunk under the ceiling; a plant the
    // furnishing / its doors leave no wall in: one fan in the next service room, else in a hall it ventilates
    if (!placeFans(r, rr, 2, [...(rr.shuffle(['back', 'front']).concat(['left', 'right']) as Wall[]).map(w => [w, 0.8] as const), ...WALLS.map(w => [w, 0.4] as const)])) {
      const next = [R.pump, R.switch, ...plan.rooms.filter(w => w.kind === 'store' && w.zone === 'service').map(w => R[w.key]), R.compactor, R.cask];
      for (const rm of next) if (rm && placeFans(rm, rr, 1, WALLS.map(w => [w, 0.4] as const))) break;
    }
    lamp(r, r.lu * 0.25, r.lv * 0.3); lamp(r, r.lu * 0.75, r.lv * 0.3); lamp(r, r.lu * 0.5, r.lv * 0.78);
    plate(r, 'back', r.lu / 2, Math.min(top - 0.95, 3.2), 'DANGER · ROTATING MACHINERY', 2.0) || plate(r, 'front', r.lu / 2, Math.min(top - 0.95, 3.2), 'DANGER · ROTATING MACHINERY', 2.0);
    const p = plan.by.plant.parent;
    doorPlate(R[p], pdoor, NAME.plant!, 1.6);
  }

  // =================================================================================================================================
  // SWITCH ROOM (optional): its plate; the switchgear below picks it first when the plan made it the home
  const SW = R.switch;
  if (SW) {
    const p = plan.by.switch.parent;
    doorPlate(R[p], between(p, 'switch'), NAME.switch!, 1.8);
    lamp(SW, SW.lu * 0.5, SW.lv * 0.5);
  }

  // =================================================================================================================================
  // SWITCHGEAR, GUARANTEED: every repository has its switchgear — a lineup of two in the plan's seeded home (the control room, the plant
  // or the switch room; the plant's wall away from its door, the fans keep theirs), then every other room of the program, then with a
  // shorter (0.5 m) access strip. A plant that is not the home keeps a local isolator cabinet when it has a wall for it.
  // (The generator's power CABLE is lane HOST's ReactorGenerator.cable — panel -> through the complex -> out of the entrance -> the
  // zone's fans — the one cable drawn; the repository adds no tray of its own.)
  const sgRng = rng.fork('waste-switchgear');
  const sgWalls = (k: WasteKey): Wall[] => (k === 'plant' ? [sideW, sideW === 'right' ? 'left' : 'right', 'front', 'back'] : k === 'control' ? ['right', 'back', 'front', 'left'] : [...WALLS]);
  let plantSg: V2[] = [];
  for (const k of plan.switchgear) {
    if (!R[k]) continue;
    const at = switchgearAt(R[k], sgWalls(k), 2, 0.9, sgRng);
    if (!at.length) continue;
    if (k === 'plant') plantSg = at;
    break;
  }
  if (!plantSg.length && sgRng.chance(0.6)) plantSg = switchgearAt(PL, sgWalls('plant'), 1, 0.9, sgRng);
  if (!sgCount) {
    const rooms = [R.control, PL, SW, R.lockers, R.compactor, PUMP, R.bay, R.cask, ...ofKind('vault'), R.hp, ...ofKind('store')];
    for (const front of [0.9, 0.5]) {
      for (const rm of rooms) if (rm && !sgCount) { const at = switchgearAt(rm, WALLS, 1, front, sgRng); if (rm === PL) plantSg = at; }
      if (sgCount) break;
    }
  }
  // the plant's cable trench: from the skid to its switchgear (floor grating strip, axis-aligned)
  const swS: V2 | null = plantSg[0] ?? null;
  if (swS) {
    const tw = 0.2;
    decor.boxes.push({x0: r3(Math.min(gfx, swS[0]) - tw), y0: base, z0: r3(gfz - tw), x1: r3(Math.max(gfx, swS[0]) + tw), y1: r3(base + 0.012), z1: r3(gfz + tw), m: 'grating'});
    decor.boxes.push({x0: r3(swS[0] - tw), y0: base, z0: r3(Math.min(gfz, swS[1]) - tw), x1: r3(swS[0] + tw), y1: r3(base + 0.012), z1: r3(Math.max(gfz, swS[1]) + tw), m: 'grating'});
  }

  // =================================================================================================================================
  // THE GENERATOR'S SIGN WALL (lane GAS: the zone-2 generator's status / jam board): the plant wall facing the use point, a clear 1.8 m
  // span at 1.7 m (no prop, no door, no other plate there); the generator's own plate goes on the wall beside it
  {
    const r = PL, [uxw, uzw] = g.center(ux, uy), [us, ut] = loc(r, uxw, uzw), W = 1.8, y = 1.7;
    // the walls by distance from the use point (the nearest one the operator faces first)
    const dist: [Wall, number, number][] = [['left', us, ut], ['right', r.lu - us, ut], ['front', ut, us], ['back', r.lv - ut, us]];
    dist.sort((a, b) => a[1] - b[1]);
    let spot: {x: number; y: number; z: number; rot: number; w: number} | null = null;
    sign: for (const [w, , q] of dist) {
      const side = sideOf(wallN(r, w)), len = wallLen(r, w);
      for (const dq of [0, 0.5, -0.5, 1, -1, 1.5, -1.5, 2, -2, 3, -3]) {
        const qq = Math.max(W / 2 + 0.1, Math.min(len - W / 2 - 0.1, q + dq));
        if (!wallFree(r, w, qq - W / 2, qq + W / 2, 0.2)) continue;
        const aq = along(r, w, qq);
        if (!backed(ctx, r.a, side, aq - W / 2, aq + W / 2, base + y - 0.4)) continue;
        const p0 = onWall(r, w, qq - W / 2, 0), p1 = onWall(r, w, qq + W / 2, 0.15);
        if (!clear3d(Math.min(p0[0], p1[0]), Math.max(p0[0], p1[0]), base + y - 0.6, base + y + 0.6, Math.min(p0[1], p1[1]), Math.max(p0[1], p1[1]))) continue;
        const [x, z] = onWall(r, w, qq, 0.02);
        // (no plate of the plant already there: the station dresser's, the plant's own)
        if (layout.signs.some(q => q.area === r.a.id && Math.abs(q.y - (base + y)) < 0.6 && Math.hypot(q.x - x, q.z - z) < ((q.w ?? 1.6) + W) / 2 + 0.1)) continue;
        spot = {x: r3(x), y: r3(base + y), z: r3(z), rot: side === 'N' ? 0 : side === 'S' ? Math.PI : side === 'W' ? Math.PI / 2 : -Math.PI / 2, w: W};
        reserved.push({area: r.a.id, x, z, y: base + y, w: W});
        plate(r, w, qq + (qq + W + 1.2 < len ? W / 2 + 1.2 : -W / 2 - 1.2), 2.4, 'AUX GENERATOR 3 · CORE-FLOOR FANS', 2.2) || plate(r, sideW === 'left' ? 'right' : 'left', r.lv * 0.6, 2.2, 'AUX GENERATOR 3 · CORE-FLOOR FANS', 2.2);
        break sign;
      }
    }
    if (spot) decor.genSign = spot;
    else plate(r, sideW === 'left' ? 'right' : 'left', r.lv * 0.6, 2.2, 'AUX GENERATOR 3 · CORE-FLOOR FANS', 2.2);
  }

  // stores: a plate on their door (the station dresser furnishes them by purpose)
  for (const r of ofKind('store')) {
    const p = plan.by[r.key].parent;
    doorPlate(R[p], between(p, r.key), plan.by[r.key].label.toUpperCase(), 1.4);
    lamp(r, r.lu * 0.5, r.lv * 0.5);
  }

  // --- the record --------------------------------------------------------------------------------------------------------------
  decor.graph = {
    rooms: plan.rooms.map(w => ({area: rec.areas[w.key], key: w.key, kind: w.kind, zone: w.zone, label: w.label})),
    doors: rec.doors.map(q => ({id: q.id, a: q.a, b: q.b, kind: q.kind, loop: !!q.loop})),
    switchgear: plan.switchgear.slice(),
  };
  layout.reactorWaste = decor;
  stats.ms = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
  Object.assign(WASTE_DRESS_STATS, stats);
  }

  function unblock(p: PropPlacement): void {
    const [x0, y0, x1, y1] = cellsOfBox(p.x, p.z, p.hx, p.hz);
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) { const i = g.idx(cx, cy); g.blocked[i] = 0; g.sightBlocked[i] = 0; }
  }
}
