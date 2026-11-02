// Task reactor-expansion-20261101 (lane BUNKER): THE BUNKER's program in a LOCAL frame (pure data, no Kit): the civil-defence shelter
// that houses zone 0's auxiliary generator off the Reactor's tier-1 gallery. gen/reactor/complex/bunker.ts maps it onto the canvas and
// carves it; bunkerDress.ts furnishes it after the crop.
//
// Task reactor-playtest-round2-20261102 (lane BUNKER), user: "the layout of reactor / reactor side areas is much to normal right now.
// Just like the subway it should be random! with logical rooms flowing in to one another! It should feel exploring a coherent space
// for the first time every time you play a new generation of the map!" — the fixed band / spine plan became a SEEDED ROOM GRAPH:
//
//  1. the ENTRY chain (always, in this order): the BLAST-DOOR LOCK behind the entrance span -> the bulkhead (the round blast door over
//     its raised threshold) -> DECONTAMINATION; the GUARD POST beside both with a door into the lock and one onto the clean side (the
//     muster corridor or the decon): a level way round the threshold (the generator cable takes it). Seeded: the door's facing, lock
//     width, decon depth, guard side / width, which clean-side room the guard opens onto;
//  2. the MUSTER CORRIDOR off the decon: across behind the entry group, a spine straight in, or a passage beside the decon;
//  3. 1-3 more CORRIDORS grown off the corridors (T branches, L turns, straight runs, sometimes out of the mess hall), placed where the
//     rock round them can still hold rooms;
//  4. the PROGRAM grown onto that skeleton by FUNCTION (each room opens only off the rooms it logically belongs to, corridors take the
//     wing of the first room on them): the generator hall (deep in the plant wing) + its switch room, the mess hall, dormitory, latrines,
//     air filtration plant, infirmary, radio room, the dead-end armoury (off the guard post / warden / hall), then a seeded subset of
//     warden's office, ration store (beside the mess), shelter stores, workshop, dormitory B, locker room; spare storerooms fill voids;
//  5. rooms grow into the rock left beside them (dense: ~900-1000 m2), LOOP doors join corridors / suites that share a wall (seeded),
//     and the generator hall always keeps two independent ways in from the muster corridor (escape routes; the test pins it);
//  6. the generator mid-hall along the hall's long axis, its panel end toward the switch room when that room sits on a short wall.
// Candidates are scored on an O(1) summed-area occupancy (./bunkerGrow.ts): snug packing, no thin rock slivers, wing affinity, seeded
// jitter. Topology (branches, loops, dead ends, corridor shapes), room sizes / positions / orientations, which optional rooms exist
// and how the entry leads in all vary per seed; deterministic (rng forks only), a failed attempt retries on the next fork.
//
// Local frame (cells): u runs ALONG the pit wall (0 = the region's first cell along it), v runs INTO the rock (0 = the first row behind
// the entrance span). Every room is a rect with exactly one wall cell between neighbours; doors are 1-cell-deep gaps in those walls.
// Real scale: rooms 3.2-4.0 m clear, corridors 3.2 m (2.5-3 m wide), the hall up to 6.5 m (slot.ceilMax), doorways 1.5-3 m wide x
// 2.4 m (junctions / halls 3.0 m).

import type {Rng} from '../../../core/rng';
import type {AreaKind, RoomType} from '../../stationTypes';
import type {ComplexRoom} from './types';
import {BUNKER_PURPOSE} from './bunkerPurposes';
import {BLAST} from './bunkerKinds';
import {LSIDES, Occ, sharedWall, sideToward, type LRect, type LSide} from './bunkerGrow';

export type {LRect};

export type BunkerWing = 'entry' | 'hub' | 'living' | 'ops' | 'plant';

export interface PlanRoom {
  key: string;
  label: string;
  role: ComplexRoom['role'];
  kind: AreaKind;
  type: RoomType;
  /** Room purpose (gen/purposes.ts ROOM_PURPOSES id): preset, so the station dresser keeps the label and dresses / lights / loots by it. */
  purpose: string;
  r: LRect;
  /** Clear height above the floor (m) before the slot's ceilMax cap. */
  clear: number;
  /** Key of the room it opens off (its main door; '' = the entrance deck). */
  parent: string;
  /** Functional wing (corridors: the wing of the rooms on them). */
  wing?: BunkerWing;
}

export interface PlanDoor {
  /** Parent side (a) and the room the door cells join (b), by key ('' = the entrance deck). */
  a: string;
  b: string;
  /** Local gap (1 cell deep), height above the floor (m), arch. The entrance's gap is the slot's own span (`entrance`). */
  gap: LRect;
  height: number;
  arch: boolean;
  kind: 'blast' | 'junction' | 'door' | 'bulkhead';
  /** A loop door (not the room's parent door). */
  loop?: boolean;
}

export type BunkerHub = 'across' | 'deep' | 'side';

export interface BunkerPlan {
  rooms: PlanRoom[];
  doors: PlanDoor[];
  /**
   * The generator skid (8 x 4 cells, long axis along local `axis`) and the use cell (2 cells off its `end` short side, facing it):
   * `foot` is a plain local rect (w along u, h along v).
   */
  gen: {foot: LRect; use: {u: number; v: number}; end: 'lo' | 'hi'; axis: 'u' | 'v'};
  /**
   * The blast door in the bulkhead: the lane's first cell along u (3 cells wide), the model origin (continuous local cells: model x
   * along xs * u, model z along -facing * v; facing 1 = its front / open leaf toward the lock, -1 toward the decon), and the threshold
   * cells' rise (rows v, risers of BLAST.sill / 3 over the lane).
   */
  blast: {uo: number; uf: number; vo: number; xs: 1 | -1; facing: 1 | -1; steps: [number, number][]};
  /** Layout numbers (QA / tests / dressing): region, lock depth, bulkhead, front-band depth (lock + bulkhead + decon), the lock rect. */
  dims: {A: number; Vd: number; LD: number; BW: number; FB: number; lock: LRect};
  /** What this seed rolled (QA / tests / docs): the plan attempt, muster corridor kind, extra corridors, loop doors, optional rooms. */
  meta: {attempt: number; hub: BunkerHub; corridors: number; loops: number; optional: string[]};
}

/** Fixed module sizes (cells, 0.5 m). */
export const BUNKER = {
  /** Lock depth / bulkhead (blast door) thickness / decontamination depth range / muster corridor width / guard post width range. */
  LD: 9, bulkhead: 2, DD: [9, 12] as const, MW: 6, GW: [9, 12] as const,
  /** Narrowest lock (cells): the blast-door frame (4.95 m) along its back wall plus a walkway past the open leaf. */
  lockMinW: 13,
  /** Minimum along / depth (cells) the program needs. */
  minA: 56, minVd: 57,
  /** Plan attempts (each on its own rng fork) before the carver gives up. */
  attempts: 10,
  /** Clear heights (m): rooms, stores, corridors, the lock, hall side rooms, the hall (target; capped by ceilMax). */
  clear: {room: 3.4, store: 3.2, corridor: 3.2, lock: 4.0, side: 3.6, hall: 6.5},
  /** Door heights (m): ordinary doors, corridor junctions, the entrance, the bulkhead lane (threshold sill + 2.26 m). */
  door: {room: 2.4, junction: 3.0, blast: 3.0, bulkhead: 3.1},
  /** The generator skid footprint (cells along its long axis x across). */
  skid: {w: 8, d: 4},
} as const;

/** QA / tests: what the last plans did (attempts used, why attempts failed). */
export const BUNKER_PLAN_STATS = {attempts: 0, fails: {} as Record<string, number>};

interface Prog { key: string; label: string; kind: AreaKind; type: RoomType; purpose: string; role: ComplexRoom['role']; clear?: number }

/**
 * A program room: its sizes (cells: long side min / max, short side min / max, either orientation), the rooms it may open off
 * (parent class -> weight: 'hub' = the muster corridor, 'corr' = the other corridors, else a room key), its wing (corridor affinity),
 * whether it must exist, dead end (`leaf`: one door, no rooms off it), no rooms off it (`noKids`), its growth cap, door kind / width,
 * a pull toward the back of the shelter (`deep`) or toward a room (`near`), rooms it should not share a wall with (`avoid`).
 */
interface Spec extends Prog {
  size: readonly [number, number, number, number];
  parents: Readonly<Record<string, number>>;
  wing?: BunkerWing;
  req?: boolean;
  leaf?: boolean;
  noKids?: boolean;
  cap?: readonly [number, number];
  door?: 'door' | 'junction';
  dw?: readonly [number, number];
  deep?: number;
  near?: string;
  avoid?: readonly string[];
  /** Pull toward spots sharing walls with two or more corridors (a second way in). */
  loopy?: number;
  /** Door cap (default 3; the big halls take more: side rooms + two ways in). */
  maxDoors?: number;
}

const C = BUNKER.clear;
const room = (key: string, label: string, type: RoomType, purpose: string, o: Omit<Spec, keyof Prog> & {role?: ComplexRoom['role']; clear?: number}): Spec =>
  ({key, label, kind: 'room', type, purpose, role: o.role ?? 'room', ...o});

/** The rooms every shelter has (placed in this order onto the corridor skeleton). */
const REQUIRED: readonly Spec[] = [
  room('hall', 'Generator hall', 'utility', 'generator-room', {role: 'generator', clear: C.hall, size: [26, 40, 16, 22], parents: {corr: 1, hub: 0.15},
    wing: 'plant', req: true, door: 'junction', dw: [5, 5], deep: 1.6, loopy: 0.8, cap: [44, 24], maxDoors: 6}),
  room('switch', 'Switch room', 'utility', 'electrical-room', {clear: C.side, size: [9, 12, 8, 10], parents: {hall: 2}, wing: 'plant', req: true,
    noKids: true, cap: [14, 12]}),
  room('mess', 'Mess hall', 'crew-room', 'staff-room', {role: 'hall', size: [18, 26, 12, 17], parents: {hub: 1, corr: 0.9}, wing: 'living', req: true,
    door: 'junction', dw: [4, 5], cap: [30, 20], avoid: ['hall', 'switch'], maxDoors: 5}),
  room('dorm', 'Dormitory', 'crew-room', BUNKER_PURPOSE.dorm, {size: [16, 22, 11, 16], parents: {corr: 1, hub: 0.35}, wing: 'living', req: true,
    cap: [26, 18], avoid: ['hall', 'switch', 'filtration']}),
  room('washroom', 'Latrines', 'washroom', 'washroom', {size: [9, 12, 8, 10], parents: {corr: 1, dorm: 0.9, hub: 0.5}, wing: 'living', req: true,
    near: 'dorm', cap: [14, 12]}),
  room('filtration', 'Air filtration plant', 'utility', 'ventilation-plant', {size: [11, 16, 9, 12], parents: {corr: 1, hall: 0.8, hub: 0.3},
    wing: 'plant', req: true, cap: [18, 14]}),
  room('infirmary', 'Infirmary', 'crew-room', 'first-aid-room', {size: [10, 14, 10, 12], parents: {hub: 1.2, corr: 0.6, decon: 0.5}, wing: 'ops',
    req: true, cap: [16, 14], avoid: ['hall', 'switch']}),
  room('radio', 'Radio room', 'utility', BUNKER_PURPOSE.radio, {size: [9, 12, 9, 11], parents: {hub: 1, guard: 0.8, warden: 1, corr: 0.5}, wing: 'ops',
    req: true, cap: [14, 12]}),
  room('armoury', 'Armoury', 'storage', BUNKER_PURPOSE.armoury, {role: 'vault', clear: C.side, size: [9, 12, 9, 11],
    parents: {guard: 1.3, warden: 1.1, hall: 0.8, hub: 0.3, corr: 0.25}, wing: 'ops', req: true, leaf: true, cap: [14, 12]}),
];
/** The optional rooms (a seeded subset, shuffled; the ones left out may still come back to fill a void). */
const OPTIONAL: readonly Spec[] = [
  room('warden', 'Shelter warden\'s office', 'agent-office', 'agent-office', {size: [9, 11, 9, 10], parents: {hub: 1, guard: 0.8, corr: 0.5},
    wing: 'ops', cap: [13, 11]}),
  room('rations', 'Ration store', 'stock-room', 'stock-room', {role: 'store', clear: C.store, size: [9, 12, 8, 10], parents: {mess: 1.5, corr: 0.5},
    wing: 'living', near: 'mess', cap: [14, 12]}),
  room('stores', 'Shelter stores', 'storage', 'storage', {role: 'store', clear: C.store, size: [9, 14, 9, 12], parents: {corr: 1, hall: 0.6, hub: 0.5},
    wing: 'plant', cap: [16, 13]}),
  room('workshop', 'Maintenance workshop', 'utility', 'workshop', {size: [10, 14, 10, 12], parents: {corr: 1, hall: 0.9}, wing: 'plant',
    cap: [16, 14], avoid: ['dorm', 'dorm2']}),
  room('dorm2', 'Dormitory B', 'crew-room', BUNKER_PURPOSE.dorm, {size: [15, 20, 11, 14], parents: {corr: 1, hub: 0.3}, wing: 'living',
    cap: [24, 16], avoid: ['hall', 'switch', 'filtration']}),
  room('lockers', 'Locker room', 'crew-room', 'locker-room', {size: [9, 12, 10, 11], parents: {corr: 1, dorm: 0.7, decon: 0.6, hub: 0.6},
    wing: 'living', cap: [14, 12]}),
];
const SPARE: Spec = room('store', 'Storeroom', 'storage', 'storage', {role: 'store', clear: C.store, size: [8, 12, 8, 10],
  parents: {corr: 1, hub: 0.8, hall: 0.4, workshop: 0.5, mess: 0.4, infirmary: 0.4, filtration: 0.4, guard: 0.3, warden: 0.3, radio: 0.3}, cap: [13, 11]});

const CORRIDOR: Omit<Prog, 'key' | 'label'> = {kind: 'service', type: 'service-corridor', purpose: 'service-corridor', role: 'corridor', clear: C.corridor};
/** Corridor names by the wing of the rooms on them. */
const CORRIDOR_LABEL: Readonly<Record<string, string>> = {living: 'Quarters corridor', plant: 'Plant corridor', ops: 'Operations corridor', '': 'Service passage'};

interface Node extends PlanRoom {
  id: number;
  /** Entry geometry (never grows). */
  fixed: boolean;
  axis?: 'u' | 'v';
  /** A dead end (one door), may be a parent. */
  leaf: boolean;
  kids: boolean;
  cap: readonly [number, number];
  depth: number;
  maxDoors: number;
  /** Walls a child / loop door may use: side -> allowed span [s0, s1) along it, false = none (absent = the whole wall). */
  walls?: Partial<Record<LSide, readonly [number, number] | false>>;
}

interface Edge { a: number; b: number; kind: PlanDoor['kind']; dw: number; loop: boolean; range?: readonly [number, number]; placed?: PlanDoor }

const isCorr = (n: PlanRoom) => n.role === 'corridor';
const ENTRY = new Set(['lock', 'decon', 'guard']);
/** A node's parent class: 'hub' (the muster corridor), 'corr' (another corridor) or its key without the duplicate number. */
const cls = (n: PlanRoom) => (n.key === 'muster' ? 'hub' : isCorr(n) ? 'corr' : n.key.replace(/\d+$/, ''));

/** Loop-door suites between two rooms (both orders): probability. */
const SUITE: Readonly<Record<string, number>> = {
  'dorm|washroom': 0.45, 'dorm2|washroom': 0.45, 'mess|rations': 0.55, 'hall|workshop': 0.35, 'hall|filtration': 0.35, 'hall|stores': 0.3,
  'radio|warden': 0.4, 'dorm|lockers': 0.35, 'dorm2|lockers': 0.35, 'stores|workshop': 0.3, 'infirmary|washroom': 0.15,
};
/** Rooms that never take a loop door from a corridor (the dormitories stay quiet, the switch room / armoury stay single-door). */
const NO_CORRIDOR_LOOP = new Set(['armoury', 'dorm', 'dorm2', 'switch']);

class Planner {
  readonly occ: Occ;
  readonly nodes: Node[] = [];
  readonly edges: Edge[] = [];
  readonly doors: PlanDoor[] = [];
  private readonly doorCell: Uint8Array;
  constructor(readonly A: number, readonly Vd: number, readonly rng: Rng) {
    this.occ = new Occ(A, Vd);
    this.doorCell = new Uint8Array(A * Vd);
  }

  key(k: string): Node | undefined { return this.nodes.find(n => n.key === k); }
  doorsOf(n: Node): number { return this.edges.filter(e => e.a === n.id || e.b === n.id).length; }
  linked(a: Node, b: Node): boolean { return this.edges.some(e => (e.a === a.id && e.b === b.id) || (e.a === b.id && e.b === a.id)); }

  add(p: Prog & {cap?: readonly [number, number]}, r: LRect, parent: Node | null, o: Partial<Node> = {}): Node {
    const n: Node = {
      key: p.key, label: p.label, role: p.role, kind: p.kind, type: p.type, purpose: p.purpose, r, clear: p.clear ?? C.room,
      parent: parent?.key ?? '', id: this.nodes.length, fixed: false, leaf: false, kids: true, cap: p.cap ?? [40, 30],
      depth: parent ? parent.depth + 1 : 0, maxDoors: isCorr(p as PlanRoom) ? 12 : 3, ...o,
    };
    this.nodes.push(n);
    this.occ.mark(r, n.id);
    return n;
  }

  link(a: Node, b: Node, kind: PlanDoor['kind'], dw: number, loop = false, range?: readonly [number, number]): Edge {
    const e: Edge = {a: a.id, b: b.id, kind, dw, loop, range};
    this.edges.push(e);
    return e;
  }

  /** The span [s0, s1) along side `s` of `n` a child may open onto (null: none). */
  span(n: Node, s: LSide): readonly [number, number] | null {
    const lim = n.walls?.[s];
    if (lim === false) return null;
    const r = n.r, full: [number, number] = s === 'u-' || s === 'u+' ? [r.v, r.v + r.h] : [r.u, r.u + r.w];
    if (!lim) return full;
    const s0 = Math.max(full[0], lim[0]), s1 = Math.min(full[1], lim[1]);
    return s1 > s0 ? [s0, s1] : null;
  }

  // ------------------------------------------------------------------------------------------------------------------------------
  // Candidates

  /** Candidate sizes (both orientations): the minimum, the middle, a seeded one — rooms grow into the rock beside them afterwards. */
  private sizes(sp: Spec): [number, number][] {
    const [l0, l1, s0, s1] = sp.size, rng = this.rng;
    const pairs: [number, number][] = [[l0, s0], [Math.round((l0 + l1) / 2), Math.round((s0 + s1) / 2)], [rng.int(l0, l1), rng.int(s0, s1)]];
    const out: [number, number][] = [], seen = new Set<number>();
    for (const [L, S] of pairs) for (const [w, h] of [[L, S], [S, L]] as const) { const k = w * 100 + h; if (!seen.has(k)) { seen.add(k); out.push([w, h]); } }
    return out;
  }

  /** Child rect of size w x h against side `s` of rect P, starting at `off` along that side. */
  private static at(P: LRect, s: LSide, off: number, w: number, h: number): LRect {
    switch (s) {
      case 'u+': return {u: P.u + P.w + 1, v: off, w, h};
      case 'u-': return {u: P.u - 1 - w, v: off, w, h};
      case 'v+': return {u: off, v: P.v + P.h + 1, w, h};
      default: return {u: off, v: P.v - 1 - h, w, h};
    }
  }

  /** Start offsets along a parent side for a child `len` cells long there, keeping >= `need` cells of shared wall inside `span`. */
  private offsets(P: LRect, s: LSide, span: readonly [number, number], len: number, need: number): number[] {
    const lo = span[0] + need - len, hi = span[1] - need;
    if (hi < lo) return [];
    if (hi - lo <= 8) { const out: number[] = []; for (let o = lo; o <= hi; o++) out.push(o); return out; }
    const p0 = s === 'u-' || s === 'u+' ? P.v : P.u, p1 = p0 + (s === 'u-' || s === 'u+' ? P.h : P.w);
    const set = new Set<number>([lo, hi]);
    for (const o of [p0, p1 - len, span[0], span[1] - len]) if (o >= lo && o <= hi) set.add(o);
    for (let i = 0; i < 6; i++) set.add(this.rng.int(lo, hi));
    return [...set].sort((a, b) => a - b);
  }

  /**
   * Places a program room off one of its allowed parents (the best seeded / packed candidate); null when nothing fits. `then` (a
   * follow-up placement, e.g. the hall's switch room) must succeed for the candidate to stay.
   */
  place(sp: Spec, key = sp.key, then?: (n: Node) => boolean): Node | null {
    const rng = this.rng, parents: [Node, number][] = [];
    for (const n of this.nodes) {
      if (!n.kids || n.leaf) continue;
      const w = sp.parents[cls(n)];
      if (w === undefined || this.doorsOf(n) >= n.maxDoors) continue;
      parents.push([n, w]);
    }
    if (!parents.length) return null;
    const maxDepth = Math.max(1, ...this.nodes.map(n => n.depth));
    const near = sp.near ? this.key(sp.near) : undefined;
    const avoid = (sp.avoid ?? []).map(k => this.key(k)).filter((n): n is Node => !!n);
    const maxArea = sp.size[1] * sp.size[3];
    const dw0 = sp.dw?.[0] ?? 3, need = Math.max(dw0, 3) + 2;
    const corrs = sp.loopy ? this.nodes.filter(isCorr) : [];
    const sizes = this.sizes(sp);
    const top: {r: LRect; p: Node; s: number}[] = [];
    for (const [p, pw] of parents) {
      for (const side of LSIDES) {
        const span = this.span(p, side);
        if (!span) continue;
        // a corridor's END opens whole (a junction) or takes a jambed door: its width is the shared wall
        const needHere = isCorr(p) && span[1] - span[0] <= 6 ? span[1] - span[0] : need;
        for (const [w, h] of sizes) {
          const len = side === 'u-' || side === 'u+' ? h : w;
          for (const off of this.offsets(p.r, side, span, len, needHere)) {
            const r = Planner.at(p.r, side, off, w, h);
            if (!this.occ.fits(r)) continue;
            let s = pw + 1.2 * this.occ.contact(r) + 0.7 * (w * h) / maxArea + 0.9 * rng.next();
            if (isCorr(p) && p.key !== 'muster' && sp.wing) s += !p.wing ? 0 : p.wing === sp.wing ? 0.5 : -0.6;
            if (sp.deep) s += sp.deep * (0.6 * (r.v + r.h / 2) / this.Vd + 0.4 * p.depth / maxDepth);
            if (near && sharedWall(r, near.r)) s += 0.8;
            for (const q of avoid) if (sharedWall(r, q.r)) s -= 0.5;
            if (sp.loopy) {
              let k = 0;
              for (const q of corrs) { const sw = q !== p ? sharedWall(r, q.r) : null; if (sw && sw.s1 - sw.s0 >= 5) k++; }
              s += sp.loopy * Math.min(1, k);
            }
            if (top.length < 10 || s > top[top.length - 1].s) {
              top.push({r, p, s});
              top.sort((a, b) => b.s - a.s);
              if (top.length > 10) top.pop();
            }
          }
        }
      }
    }
    if (!top.length) return null;
    // the hall prefers a spot that can keep two independent ways in (a loop door onto a second corridor closes a cycle through the
    // muster corridor: checked on the hypothetical graph)
    const ranked = top.map(c => ({...c, s: c.s - 0.004 * this.occ.sliver(c.r) + (sp.loopy && this.hypoBridges(c.r, c.p) === 0 ? 1.5 * sp.loopy : 0)}))
      .sort((a, b) => b.s - a.s);
    const dw = sp.dw ? rng.int(sp.dw[0], sp.dw[1]) : rng.int(3, 4);
    for (const best of ranked) {
      const n = this.add({...sp, key}, best.r, best.p, {leaf: !!sp.leaf, kids: !sp.leaf && !sp.noKids, cap: sp.cap ?? [40, 30], maxDoors: sp.leaf ? 1 : sp.maxDoors ?? 3, wing: sp.wing});
      this.link(best.p, n, sp.door ?? 'door', dw);
      // a room that needs its own neighbour (the hall's switch room) takes the next candidate when that one does not fit
      if (then && !then(n)) { this.undo(n); continue; }
      if (isCorr(best.p) && best.p.key !== 'muster' && !best.p.wing && sp.wing) best.p.wing = sp.wing;
      return n;
    }
    return null;
  }

  // ------------------------------------------------------------------------------------------------------------------------------
  // The corridor skeleton

  addCorridor(key: string, r: LRect, parent: Node, axis: 'u' | 'v', wing?: BunkerWing): Node {
    return this.add({...CORRIDOR, key, label: 'Service passage', cap: [56, Math.min(r.w, r.h)]}, r, parent, {axis, wing, maxDoors: 12});
  }

  /**
   * One more corridor off the skeleton (a T branch / an L turn off a corridor's long side, a straight run off its end, or out of a big
   * room's wall): the seeded candidate with the most rock round it that can still hold rooms.
   */
  spine(key: string, bases: readonly [Node, number][]): Node | null {
    const rng = this.rng;
    let best: {r: LRect; base: Node; ax: 'u' | 'v'} | null = null, bs = -Infinity;
    for (let t = 0; t < 40; t++) {
      const base = rng.weighted(bases);
      const br = base.r, w = rng.chance(0.65) ? 5 : 6;
      // a room base: perpendicular out of one of its walls (like a T); a corridor: T / L off a long side, E off an end
      const bAx: 'u' | 'v' = base.axis ?? (rng.chance(0.5) ? 'u' : 'v');
      const mode = base.axis ? rng.weighted<'T' | 'L' | 'E'>([['T', 4], ['L', 3], ['E', 1]]) : 'T';
      const sgn = rng.chance(0.5) ? 1 : -1;
      const b0 = bAx === 'u' ? br.u : br.v, b1 = b0 + (bAx === 'u' ? br.w : br.h);
      const c0 = bAx === 'u' ? br.v : br.u, c1 = c0 + (bAx === 'u' ? br.h : br.w);
      const ax: 'u' | 'v' = mode === 'E' ? bAx : bAx === 'u' ? 'v' : 'u';
      if (mode === 'T' && b1 - 4 - w < b0 + 4) continue;
      // the side it leaves from must be open to children
      const side: LSide = mode === 'E' ? (bAx === 'u' ? (sgn > 0 ? 'u+' : 'u-') : (sgn > 0 ? 'v+' : 'v-')) : bAx === 'u' ? (sgn > 0 ? 'v+' : 'v-') : (sgn > 0 ? 'u+' : 'u-');
      const span = this.span(base, side);
      if (!span) continue;
      const p = mode === 'L' ? (rng.chance(0.5) ? b0 : b1 - w) : mode === 'T' ? rng.int(b0 + 4, b1 - 4 - w) : 0;
      if (mode !== 'E' && (p < span[0] || p + w > span[1])) continue;
      for (let L = rng.int(16, 48); L >= 12; L -= 2) {
        let r: LRect;
        if (mode === 'E') {
          const a0 = sgn > 0 ? b1 + 1 : b0 - 1 - L;
          r = bAx === 'u' ? {u: a0, v: c0, w: L, h: c1 - c0} : {u: c0, v: a0, w: c1 - c0, h: L};
        } else {
          const a0 = sgn > 0 ? c1 + 1 : c0 - 1 - L;
          r = bAx === 'u' ? {u: p, v: a0, w, h: L} : {u: a0, v: p, w: L, h: w};
        }
        if (!this.occ.fits(r)) continue;
        const long: LSide[] = ax === 'u' ? ['v-', 'v+'] : ['u-', 'u+'];
        const pot = this.occ.free(r, long, 10) / (2 * 10 * L);
        // a run that ends snug against another corridor closes a loop
        const closes = this.nodes.some(q => q !== base && isCorr(q) && ((sw) => !!sw && sw.s1 - sw.s0 >= 5)(sharedWall(r, q.r)));
        const s = pot + 0.25 * L / 48 - 0.002 * this.occ.sliver(r, long) + 0.6 * rng.next() + (closes ? 0.35 : 0);
        if (s > bs) { bs = s; best = {r, base, ax}; }
        break;
      }
    }
    if (!best) return null;
    const n = this.addCorridor(key, best.r, best.base, best.ax);
    this.link(best.base, n, 'junction', 5);
    return n;
  }

  // ------------------------------------------------------------------------------------------------------------------------------
  // Growth, loops, doors

  /** Grows every non-entry room into the free rock beside it (one cell at a time, within its cap; corridors only along their axis). */
  grow(filter: (n: Node) => boolean = () => true): void {
    const ids = this.rng.shuffle(this.nodes.filter(n => !n.fixed && filter(n)).map(n => n.id));
    for (const id of ids) {
      const n = this.nodes[id];
      const dirs: LSide[] = isCorr(n) ? (n.axis === 'u' ? ['u-', 'u+'] : ['v-', 'v+']) : this.rng.shuffle([...LSIDES]);
      for (const d of dirs) for (let k = 0; k < 40 && this.step(n, d); k++);
    }
  }

  private step(n: Node, d: LSide): boolean {
    const r = n.r, nr = {...r};
    if (d === 'u-') { nr.u--; nr.w++; } else if (d === 'u+') nr.w++; else if (d === 'v-') { nr.v--; nr.h++; } else nr.h++;
    if (!this.occ.inside(nr)) return false;
    const L = Math.max(nr.w, nr.h), S = Math.min(nr.w, nr.h);
    if (L > n.cap[0] || S > n.cap[1] || (!isCorr(n) && L > 2.6 * S)) return false;
    // the new line of cells and the wall line beyond it hold no room cell
    const box = d === 'u-' ? [nr.u - 1, nr.v - 1, nr.u + 1, nr.v + nr.h + 1] : d === 'u+' ? [r.u + r.w, nr.v - 1, r.u + r.w + 2, nr.v + nr.h + 1]
      : d === 'v-' ? [nr.u - 1, nr.v - 1, nr.u + nr.w + 1, nr.v + 1] : [nr.u - 1, r.v + r.h, nr.u + nr.w + 1, r.v + r.h + 2];
    if (this.occ.anyIn(box[0], box[1], box[2], box[3])) return false;
    // mark only the new line of cells
    this.occ.mark(d === 'u-' ? {u: nr.u, v: nr.v, w: 1, h: nr.h} : d === 'u+' ? {u: r.u + r.w, v: nr.v, w: 1, h: nr.h}
      : d === 'v-' ? {u: nr.u, v: nr.v, w: nr.w, h: 1} : {u: nr.u, v: r.v + r.h, w: nr.w, h: 1}, n.id);
    n.r = nr;
    return true;
  }

  /** Takes the last placed node (and its parent edge) back. */
  undo(n: Node): void {
    if (this.nodes[this.nodes.length - 1] !== n) throw new Error('bunker plan undo: not the last node');
    this.nodes.pop();
    this.occ.clear(n.r);
    while (this.edges.length && (this.edges[this.edges.length - 1].b === n.id || this.edges[this.edges.length - 1].a === n.id)) this.edges.pop();
  }

  /** Places the door of an edge on its shared wall (null: no room for it); a corridor's whole end opens as a junction. */
  door(e: Edge): PlanDoor | null {
    const A = this.nodes[e.a], B = this.nodes[e.b];
    const w = sharedWall(A.r, B.r);
    if (!w) return null;
    let s0 = w.s0, s1 = w.s1;
    if (e.range) { s0 = Math.max(s0, e.range[0]); s1 = Math.min(s1, e.range[1]); }
    else for (const [n, o] of [[A, B], [B, A]] as const) {
      const lim = n.walls?.[sideToward(n.r, o.r)!];
      if (lim === false) return null;
      if (lim) { s0 = Math.max(s0, lim[0]); s1 = Math.min(s1, lim[1]); }
    }
    const S = s1 - s0;
    const sideLen = (n: Node) => (w.col ? n.r.h : n.r.w);
    const end = e.kind === 'junction' && [A, B].some(n => isCorr(n) && sideLen(n) === S && n.r[w.col ? 'v' : 'u'] === s0) && S >= 4 && S <= 6;
    const opts: [number, number][] = [];
    if (end) opts.push([s0, S]);
    // jambed doors (also the fallback of a corridor end whose whole span clashes): the wanted width, then narrower
    for (let dw = Math.min(e.dw, S - 2); dw >= 3 && dw >= Math.min(e.dw, S - 2) - 1; dw--) {
      const lo = s0 + 1, hi = s1 - 1 - dw;
      const offs: number[] = [];
      for (let o = lo; o <= hi; o++) offs.push(o);
      for (const o of this.rng.shuffle(offs)) opts.push([o, dw]);
    }
    for (const [o, dw] of opts) {
      const gap: LRect = w.col ? {u: w.line, v: o, w: 1, h: dw} : {u: o, v: w.line, w: dw, h: 1};
      if (this.doorClash(gap, w.col)) continue;
      this.markDoor(gap);
      const D = BUNKER.door;
      const big = e.kind === 'junction';
      const d: PlanDoor = {a: A.key, b: B.key, gap, height: big ? D.junction : D.room, arch: big, kind: e.kind, ...(e.loop ? {loop: true} : {})};
      e.placed = d;
      this.doors.push(d);
      return d;
    }
    return null;
  }

  /** A door gap touching another door's cells (a wall cell stays between two doors along a wall line and round a corner). */
  private doorClash(g: LRect, _col: boolean): boolean {
    const u0 = g.u - 1, u1 = g.u + g.w + 1, v0 = g.v - 1, v1 = g.v + g.h + 1;
    for (let v = Math.max(0, v0); v < Math.min(this.Vd, v1); v++) for (let u = Math.max(0, u0); u < Math.min(this.A, u1); u++) if (this.doorCell[v * this.A + u]) return true;
    return false;
  }
  markDoor(g: LRect): void {
    for (let v = Math.max(0, g.v); v < Math.min(this.Vd, g.v + g.h); v++) for (let u = Math.max(0, g.u); u < Math.min(this.A, g.u + g.w); u++) this.doorCell[v * this.A + u] = 1;
  }

  /** Loop-door candidates: corridors / big rooms / suites sharing a wall, never the entry chain or a dead end. */
  loopPairs(): [Node, Node, number][] {
    const out: [Node, Node, number][] = [];
    const big = (n: Node) => n.key === 'hall' || n.key === 'mess';
    for (let i = 0; i < this.nodes.length; i++) for (let j = i + 1; j < this.nodes.length; j++) {
      const a = this.nodes[i], b = this.nodes[j];
      if (ENTRY.has(a.key) || ENTRY.has(b.key) || a.leaf || b.leaf || this.linked(a, b)) continue;
      const w = sharedWall(a.r, b.r);
      if (!w) continue;
      const S = w.s1 - w.s0, ca = isCorr(a), cb = isCorr(b);
      let p = 0;
      if (ca && cb) p = S >= 5 ? 0.85 : 0;
      else if ((ca && big(b)) || (cb && big(a))) p = S >= 8 ? 0.5 : 0;
      else if (ca || cb) p = !NO_CORRIDOR_LOOP.has(cls(ca ? b : a)) && S >= 7 ? 0.14 : 0;
      else p = S >= 7 ? SUITE[`${cls(a)}|${cls(b)}`] ?? SUITE[`${cls(b)}|${cls(a)}`] ?? 0 : 0;
      if (p > 0) out.push([a, b, p]);
    }
    return out;
  }

  /** A loop edge between two rooms, its door placed at once (dropped again when no door fits). */
  loop(a: Node, b: Node): boolean {
    if (this.doorsOf(a) >= a.maxDoors || this.doorsOf(b) >= b.maxDoors) return false;
    const junction = (isCorr(a) && isCorr(b)) || ((isCorr(a) || isCorr(b)) && (a.key === 'hall' || b.key === 'hall' || a.key === 'mess' || b.key === 'mess'));
    const e = this.link(a, b, junction ? 'junction' : 'door', junction ? 5 : this.rng.int(3, 4), true);
    if (this.door(e)) return true;
    this.edges.pop();
    return false;
  }

  /** Takes the last loop edge (and its door) back. */
  unloop(): void {
    const e = this.edges.pop()!, d = e.placed!;
    this.doors.splice(this.doors.indexOf(d), 1);
    for (let v = Math.max(0, d.gap.v); v < Math.min(this.Vd, d.gap.v + d.gap.h); v++) for (let u = d.gap.u; u < d.gap.u + d.gap.w; u++) this.doorCell[v * this.A + u] = 0;
  }

  /** Doors (edges with a placed door) whose removal cuts the generator hall off from the muster corridor, ignoring the entry chain. */
  hallBridges(): number {
    const hub = this.key('muster'), hall = this.key('hall');
    if (!hub || !hall) return Infinity;
    const live = this.edges.filter(e => e.placed && !ENTRY.has(this.nodes[e.a].key) && !ENTRY.has(this.nodes[e.b].key)).map(e => [e.a, e.b] as const);
    return bridgeCount(this.nodes.length, live, hub.id, hall.id);
  }

  /**
   * The hall's bridges if it stood at `r` off `p`, every planned edge counted and the loop doors it could get: onto each other corridor
   * it shares a wall with, and between corridors already sharing a wall.
   */
  hypoBridges(r: LRect, p: Node): number {
    const hub = this.key('muster');
    if (!hub) return Infinity;
    const V = this.nodes.length, corrs = this.nodes.filter(isCorr);
    const es: (readonly [number, number])[] = this.edges.filter(e => !ENTRY.has(this.nodes[e.a].key) && !ENTRY.has(this.nodes[e.b].key)).map(e => [e.a, e.b] as const);
    es.push([p.id, V]);
    for (const q of corrs) { const w = q !== p ? sharedWall(r, q.r) : null; if (w && w.s1 - w.s0 >= 5) es.push([q.id, V]); }
    for (let i = 0; i < corrs.length; i++) for (let j = i + 1; j < corrs.length; j++) {
      const w = sharedWall(corrs[i].r, corrs[j].r);
      if (w && w.s1 - w.s0 >= 5 && !this.linked(corrs[i], corrs[j])) es.push([corrs[i].id, corrs[j].id]);
    }
    return bridgeCount(V + 1, es, hub.id, V);
  }
}

/** Edges whose removal cuts `to` off `from` (only the edges of one from -> to path can be such bridges); Infinity when unreached. */
function bridgeCount(n: number, edges: readonly (readonly [number, number])[], from: number, to: number): number {
  const adj: [number, number][][] = Array.from({length: n}, () => []);
  edges.forEach(([a, b], i) => { adj[a].push([b, i]); adj[b].push([a, i]); });
  /** BFS without edge `skip`: the edge each node was reached by (-2 = unreached), or null when `to` is not reached. */
  const reach = (skip: number): Int32Array | null => {
    const via = new Int32Array(n).fill(-2), q = [from];
    via[from] = -1;
    for (let h = 0; h < q.length; h++) for (const [y, i] of adj[q[h]]) if (i !== skip && via[y] === -2) { via[y] = i; q.push(y); }
    return via[to] === -2 ? null : via;
  };
  const via = reach(-1);
  if (!via) return Infinity;
  let k = 0;
  for (let x = to; via[x] >= 0;) {
    const i = via[x], [a, b] = edges[i];
    if (!reach(i)) k++;
    x = a === x ? b : a;
  }
  return k;
}

// ---------------------------------------------------------------------------------------------------------------------------------

/**
 * The bunker program for a region `A` cells along the wall, `Vd` usable cells deep (v in [0, Vd)), the entrance span [e0, e1) along u;
 * `leafSign` = the local u direction of the blast-door model's +x (its open leaf) when its front faces the lock (bunker.ts).
 * Null when it does not fit (the carver then returns null and the host keeps the generator on its landing).
 */
export function planBunker(A: number, Vd: number, e0: number, e1: number, leafSign: 1 | -1, rng: Rng): BunkerPlan | null {
  if (A < BUNKER.minA || Vd < BUNKER.minVd || e1 - e0 < 2 || e0 < 1 || e1 > A - 1) return null;
  for (let attempt = 0; attempt < BUNKER.attempts; attempt++) {
    BUNKER_PLAN_STATS.attempts = attempt + 1;
    const why = {v: ''};
    const p = attemptPlan(A, Vd, e0, e1, leafSign, rng.fork(`bunker-plan-${attempt}`), attempt, why);
    if (p) return p;
    BUNKER_PLAN_STATS.fails[why.v] = (BUNKER_PLAN_STATS.fails[why.v] ?? 0) + 1;
  }
  return null;
}

function attemptPlan(A: number, Vd: number, e0: number, e1: number, leafSign: 1 | -1, rng: Rng, attempt: number, why: {v: string}): BunkerPlan | null {
  const fail = (s: string): null => { why.v = s; return null; };
  const g = new Planner(A, Vd, rng);
  const {LD, bulkhead: BW} = BUNKER;
  const D = BUNKER.door;

  // --- 1. The entry chain: lock, the blast-door bulkhead, decon, guard post ------------------------------------------------------
  // The lock (vestibule) behind the entrance; a 2-cell bulkhead holds the BLAST DOOR (REACTOR_X_KIT.blastDoor, grounded) whose round
  // leaf stands open beside the frame on the model's +x side: facing the LOCK (you see the open door as you come in; the leaf along the
  // lock's side wall away from the entrance) or facing the DECON (the leaf along a decon side wall) — a seeded preference, each when it
  // fits. The 3-cell lane through it climbs a raised threshold (bunkerKinds.ts BLAST). The guard post opens into the lock and onto the
  // clean side: a level way round the threshold.
  const DD = rng.int(BUNKER.DD[0], BUNKER.DD[1]), FB = LD + BW + DD;
  const ew = e1 - e0;
  const fHalf = BLAST.halfW / 0.5, oOff = BLAST.openX / 0.5, leafW = (BLAST.leaf.x[1] - BLAST.leaf.x[0]) / 0.5;
  const zc = (BLAST.bodyZ[0] + BLAST.bodyZ[1]) / 2 / 0.5;
  let GW = rng.int(BUNKER.GW[0], BUNKER.GW[1]);
  const LWmin = BUNKER.lockMinW + rng.int(0, 3), gap = 3 + rng.int(0, 3);
  const preferLock = rng.chance(0.7);
  let facing: 1 | -1 = 1, lu0 = 0, lu1 = 0, gHi = false, ok = false;
  const tryLock = (): boolean => {
    // facing the lock: the leaf's wall (u side `leafSign`) keeps >= `gap` cells clear of the entrance, the guard on the other side
    const l0 = Math.max(1, leafSign > 0 ? Math.min(e0 - 1, e1 + gap - LWmin) : e0 - gap);
    const l1 = Math.min(A - 1, leafSign > 0 ? e1 + gap : Math.max(e1 + 1, e0 - gap + LWmin));
    const leafClear = leafSign > 0 ? l1 - leafW >= e1 + 1 : l0 + leafW <= e0 - 1;
    const away = leafSign > 0 ? l0 - 2 : A - 2 - l1;
    if (!(l1 - l0 >= BUNKER.lockMinW && e0 >= l0 + 1 && e1 <= l1 - 1 && leafClear && away >= GW)) return false;
    facing = 1; lu0 = l0; lu1 = l1; gHi = leafSign < 0;
    return true;
  };
  const tryDecon = (): boolean => {
    // facing the decon: the lock round the entrance, the guard on the roomier side
    const w = Math.max(LWmin, ew + 4);
    const a0 = Math.max(1, Math.min(A - 1 - w, Math.round((e0 + e1) / 2 - w / 2)));
    const lo = a0 - 2, hi = A - 2 - (a0 + w);
    if (Math.max(lo, hi) < 8) return false;
    facing = -1; lu0 = a0; lu1 = a0 + w; gHi = hi >= lo;
    if (Math.max(lo, hi) < GW) GW = Math.max(lo, hi);
    return true;
  };
  ok = preferLock ? tryLock() || tryDecon() : tryDecon() || tryLock();
  if (!ok) return fail('entry');
  const LW = lu1 - lu0;
  if (LW < BUNKER.lockMinW || e0 < lu0 + 1 || e1 > lu1 - 1) return fail('lock');
  // the model's +x along local u: `leafSign` facing the lock (front +z = -v), reversed facing the decon (front +z = +v)
  const xs = (facing > 0 ? leafSign : -leafSign) as 1 | -1;
  // the frame: its +x end (the leaf side) against that side wall; the opening's 3-cell lane; the model origin (continuous cells)
  const uo = Math.round(xs > 0 ? lu1 - fHalf + xs * oOff - 1.5 : lu0 + fHalf + xs * oOff - 1.5);
  const uf = uo + 1.5 - xs * oOff;
  if (uf - fHalf < lu0 - 0.7 || uf + fHalf > lu1 + 0.7) return fail('frame');
  // model z -> v: facing the lock v = vo - z / 0.5, the decon v = vo + z / 0.5; the body centred in the bulkhead
  const vo = LD + BW / 2 + facing * zc;
  const leafTip = vo - facing * BLAST.leaf.z[1] / 0.5;
  if (facing > 0 ? leafTip < 0.5 : leafTip > FB - 0.5) return fail('leaf'); // the open leaf stays inside its room
  const gu0 = gHi ? lu1 + 1 : lu0 - 1 - GW;
  const lockR: LRect = {u: lu0, v: 0, w: LW, h: LD};
  const gSign = gHi ? 1 : -1, freeSign = -gSign;
  // facing the decon, the leaf stands along the decon's xs side wall: no door there
  const leafOn = (sign: number) => facing < 0 && sign === xs;
  const stepsEnd = LD + BW + 3; // the decon's rows past the threshold risers
  const lock = g.add({key: 'lock', label: 'Blast-door lock', kind: 'room', type: 'utility', purpose: BUNKER_PURPOSE.lock, role: 'entry', clear: C.lock}, lockR, null,
    {fixed: true, kids: false, wing: 'entry', maxDoors: 4});
  const deconWalls: Partial<Record<LSide, readonly [number, number] | false>> = {
    'v-': false, 'v+': [lu0 + (leafOn(-1) ? 3 : 0), lu1 - (leafOn(1) ? 3 : 0)],
    [gSign > 0 ? 'u+' : 'u-']: false, [freeSign > 0 ? 'u+' : 'u-']: leafOn(freeSign) ? false : [stepsEnd, FB],
  };
  const decon = g.add({key: 'decon', label: 'Decontamination', kind: 'room', type: 'utility', purpose: BUNKER_PURPOSE.decon, role: 'room', clear: C.lock},
    {u: lu0, v: LD + BW, w: LW, h: DD}, lock, {fixed: true, wing: 'entry', walls: deconWalls, maxDoors: 4});
  if (gu0 < 1 || gu0 + GW > A - 1) return fail('guard');
  const guard = g.add({key: 'guard', label: 'Guard post', kind: 'room', type: 'utility', purpose: 'security-office', role: 'room'},
    {u: gu0, v: 0, w: GW, h: FB}, lock, {fixed: true, wing: 'entry', walls: {[gSign > 0 ? 'u-' : 'u+']: false}, maxDoors: 4});
  // the entrance (the slot's own span) and the bulkhead lane
  const doors: PlanDoor[] = [
    {a: '', b: 'lock', gap: {u: e0, v: -1, w: ew, h: 1}, height: D.blast, arch: false, kind: 'blast'},
    {a: 'lock', b: 'decon', gap: {u: uo, v: LD, w: 3, h: BW}, height: D.bulkhead, arch: false, kind: 'bulkhead'},
  ];
  g.markDoor({u: uo, v: LD, w: 3, h: BW});
  g.link(lock, decon, 'bulkhead', 3).placed = doors[1];
  // the threshold: the sill level over the bulkhead AND the first row each side (the frame's faces stand 0.29 / 0.49 m proud of the
  // wall: their plate below the round opening stays under the walking surface), then two risers down to each room's floor
  const blast = {uo, uf, vo, xs, facing, steps: [[LD - 3, 1], [LD - 2, 2], [LD - 1, 3], [LD, 3], [LD + 1, 3], [LD + BW, 3], [LD + BW + 1, 2], [LD + BW + 2, 1]] as [number, number][]};

  // --- 2. The muster corridor off the decon --------------------------------------------------------------------------------------
  // across behind the entry group (it may run behind the guard post too), straight in from the decon's back wall, or beside the decon
  // on its free side; the guard post opens onto it when they share a wall (it must when its decon wall carries the open leaf)
  const guardDeconOk = !leafOn(gSign);
  const MW = BUNKER.MW;
  const back = deconWalls['v+'] as readonly [number, number];
  let hub: Node | null = null, hubKind: BunkerHub = 'across';
  const kinds = rng.shuffle<BunkerHub>(['across', 'across', 'deep', 'side', 'side']);
  for (const kind of [...new Set(kinds)]) {
    let best: LRect | null = null, bs = -Infinity;
    for (let t = 0; t < 14; t++) {
      let r: LRect;
      if (kind === 'across') {
        const L = rng.int(Math.max(LW + 10, 26), A - 2);
        const lo = Math.max(1, back[0] + MW - L), hi = Math.min(A - 1 - L, back[1] - MW);
        if (hi < lo) continue;
        r = {u: rng.int(lo, hi), v: FB + 1, w: L, h: MW};
      } else if (kind === 'deep') {
        const L = rng.int(18, Math.min(44, Vd - FB - 1));
        if (back[1] - MW < back[0]) continue;
        r = {u: rng.int(back[0], back[1] - MW), v: FB + 1, w: MW, h: L};
      } else {
        if (leafOn(freeSign)) continue;
        const v0 = rng.int(0, FB - MW - 1), L = rng.int(Math.max(24, stepsEnd + MW - v0 + 6), Math.min(46, Vd - v0));
        r = {u: freeSign > 0 ? lu1 + 1 : lu0 - 1 - MW, v: v0, w: MW, h: L};
      }
      if (!g.occ.fits(r)) continue;
      const gw = sharedWall(r, guard.r);
      const touchesGuard = !!gw && gw.s1 - gw.s0 >= 5;
      if (!guardDeconOk && !touchesGuard) continue;
      const long: LSide[] = kind === 'across' ? ['v+'] : ['u-', 'u+'];
      const s = g.occ.free(r, long, 10) / (10 * (kind === 'across' ? r.w : 2 * r.h)) + 0.8 * rng.next() + (touchesGuard ? 0.2 : 0);
      if (s > bs) { bs = s; best = r; }
    }
    if (best) { hub = g.addCorridor('muster', best, decon, kind === 'across' ? 'u' : 'v', 'hub'); hubKind = kind; break; }
  }
  if (!hub) return fail('hub');
  hub.label = 'Muster corridor';
  g.link(decon, hub, 'door', 4);
  g.link(lock, guard, 'door', 3, false, [0, LD - 2]);
  {
    const gw = sharedWall(hub.r, guard.r);
    const toHub = !!gw && gw.s1 - gw.s0 >= 5 && (!guardDeconOk || rng.chance(0.6));
    if (toHub) g.link(guard, hub, 'door', 3);
    else g.link(guard, decon, 'door', 3, false, [stepsEnd, FB]);
  }

  // --- 3. The corridor skeleton ----------------------------------------------------------------------------------------------------
  const nCorr = rng.weighted<number>([[1, 2], [2, 4], [3, 3]]);
  let made = 0;
  for (let i = 0; i < nCorr; i++) {
    const bases = g.nodes.filter(isCorr).map(n => [n, n.key === 'muster' ? 2 : 1] as [Node, number]);
    if (g.spine(`corr${made + 1}`, bases)) made++;
  }

  // --- 4. The program by function ----------------------------------------------------------------------------------------------------
  const SWITCH = REQUIRED.find(sp => sp.key === 'switch')!;
  for (const sp of REQUIRED) {
    if (sp === SWITCH) continue; // placed with the hall: a hall spot keeps a wall for its switch room
    if (!(sp.key === 'hall' ? g.place(sp, 'hall', () => !!g.place(SWITCH)) : g.place(sp))) return fail(`place-${sp.key}`);
    // sometimes a corridor leaves through the mess hall's far wall (the mess as a through room)
    if (sp.key === 'mess' && made < 3 && rng.chance(0.35) && g.spine(`corr${made + 1}`, [[g.key('mess')!, 1]])) made++;
  }
  const optional = rng.shuffle(OPTIONAL.slice());
  const want = optional.filter(() => rng.chance(0.72));
  const skipped = optional.filter(sp => !want.includes(sp));
  for (const sp of want) g.place(sp);
  // --- 5. Dense: rooms grow, the left-out optional rooms / spare storerooms fill voids, then everything grows --------------------
  g.grow(n => !isCorr(n));
  for (const sp of skipped) g.place(sp);
  for (let i = 0, n = 1; i < 4; i++) if (g.place(SPARE, n > 1 ? `store${n}` : 'store')) n++;
  g.grow();

  // --- 6. Doors: the parent doors (all must fit), seeded loop doors, the generator hall's second way in -------------------------
  // the most constrained first: the shortest shared walls (corridor ends), then the rest
  const spanOf = (e: Edge) => { const w = sharedWall(g.nodes[e.a].r, g.nodes[e.b].r); return w ? w.s1 - w.s0 : 0; };
  for (const e of g.edges.filter(q => !q.placed).sort((p, q) => spanOf(p) - spanOf(q) || p.a - q.a || p.b - q.b)) {
    if (!g.door(e)) return fail(`door-${g.nodes[e.a].key}-${g.nodes[e.b].key}`);
  }
  let loops = 0;
  for (const [a, b, p] of rng.shuffle(g.loopPairs())) if (rng.chance(p) && g.loop(a, b)) loops++;
  // the generator hall keeps two independent ways in from the muster corridor: while one door is a bridge, add the loop door that
  // removes the most bridges (corridor / hall pairs first; a door that does not help is taken back)
  for (let guard = 0; guard < 6; guard++) {
    const before = g.hallBridges();
    if (before === 0) break;
    const pairs = rng.shuffle(g.loopPairs()).sort((p, q) => +!(p[0].key === 'hall' || p[1].key === 'hall') - +!(q[0].key === 'hall' || q[1].key === 'hall')
      || +!(isCorr(p[0]) && isCorr(p[1])) - +!(isCorr(q[0]) && isCorr(q[1])));
    let best: [Node, Node] | null = null, bb = before;
    for (const [a, b] of pairs) {
      if (!g.loop(a, b)) continue;
      const n = g.hallBridges();
      g.unloop();
      if (n < bb) { bb = n; best = [a, b]; if (n === 0) break; }
    }
    if (!best || !g.loop(best[0], best[1])) break;
    loops++;
  }
  if (g.hallBridges() !== 0) return fail('hall-loop');

  // --- 7. The generator: mid-hall along its long axis, the use point 2 cells off one short end ---------------------------------
  const hall = g.key('hall')!, H = hall.r;
  const axis: 'u' | 'v' = H.w >= H.h ? 'u' : 'v';
  const a0 = axis === 'u' ? H.u : H.v, aL = axis === 'u' ? H.w : H.h, c0 = axis === 'u' ? H.v : H.u, cL = axis === 'u' ? H.h : H.w;
  const {w: gw, d: gd} = BUNKER.skid;
  if (aL < gw + 14 || cL < gd + 10) return fail('hall-size');
  const fa = a0 + Math.round((aL - gw) / 2) + rng.int(-2, 2), fc = c0 + Math.round((cL - gd) / 2) + rng.int(-1, 1);
  // the panel end faces the switch room when it opens off a short wall of the hall, else a seeded end
  const sw = g.key('switch')!, side = sideToward(H, sw.r);
  const end: 'lo' | 'hi' = side === (axis === 'u' ? 'u+' : 'v+') ? 'hi' : side === (axis === 'u' ? 'u-' : 'v-') ? 'lo' : rng.chance(0.5) ? 'hi' : 'lo';
  const ua = end === 'hi' ? fa + gw + 1 : fa - 2, uc = fc + Math.floor(gd / 2);
  const foot: LRect = axis === 'u' ? {u: fa, v: fc, w: gw, h: gd} : {u: fc, v: fa, w: gd, h: gw};
  const use = axis === 'u' ? {u: ua, v: uc} : {u: uc, v: ua};

  // --- 8. Corridor names by the rooms on them --------------------------------------------------------------------------------------
  const used = new Map<string, number>();
  for (const n of g.nodes) {
    if (!isCorr(n) || n.key === 'muster') continue;
    const count: Record<string, number> = {};
    for (const e of g.edges) {
      const o = e.a === n.id ? g.nodes[e.b] : e.b === n.id ? g.nodes[e.a] : null;
      if (o && !isCorr(o) && o.wing && o.wing !== 'entry') count[o.wing] = (count[o.wing] ?? 0) + 1;
    }
    const top = Object.entries(count).sort((p, q) => q[1] - p[1] || p[0].localeCompare(q[0]))[0];
    const w = top && top[1] >= 1 ? top[0] : '';
    if (w) n.wing = w as BunkerWing;
    const base = CORRIDOR_LABEL[w] ?? CORRIDOR_LABEL[''];
    const k = (used.get(base) ?? 0) + 1;
    used.set(base, k);
    n.label = k > 1 ? `${base} ${String.fromCharCode(64 + k)}` : base;
  }

  const rooms: PlanRoom[] = g.nodes.map(n => ({key: n.key, label: n.label, role: n.role, kind: n.kind, type: n.type, purpose: n.purpose, r: n.r, clear: n.clear, parent: n.parent, wing: n.wing}));
  doors.push(...g.doors);
  return {
    rooms, doors, gen: {foot, use, end, axis}, blast,
    dims: {A, Vd, LD, BW, FB, lock: lockR},
    meta: {attempt, hub: hubKind, corridors: g.nodes.filter(isCorr).length, loops, optional: g.nodes.filter(n => OPTIONAL.some(o => o.key === n.key)).map(n => n.key)},
  };
}
