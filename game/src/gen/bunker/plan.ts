// Task studio-bunker-level-20261109-072224-01: one SHELTER STOREY's plan — the Reactor shelter's seeded room-graph planner
// (gen/reactor/complex/bunkerPlan.ts Planner: O(1) occupancy, seeded candidates scored for snug packing / wing affinity, room growth,
// loop doors) run inside the storey's footprint round the two fixed stair cores. Pure data, canonical canvas cells (the carver mirrors).
//
// The skeleton every storey starts from (fixed nodes, never grown): the two cores (blocked: their landings are carved by the core
// carver), the MAIN stair lobby along core A's inner flank (planner key 'muster' = the 'hub' parent class: the rooms you meet first
// off the main stair), the SERVICE stair lobby along core B's, and the storey's SPINE corridor between the two lobbies at a seeded
// row (junctions at both ends: the two stairs are always joined on every storey). Then 1-3 more corridors grow off them (T / L /
// straight runs), the programme grows on by function, rooms grow into the rock beside them, spare storerooms fill the voids and seeded
// loop doors join corridors / suites that share a wall. Every planned door must fit (else the attempt fails and the caller retries).

import type {Rng} from '../../core/rng';
import type {Rect} from '../stationTypes';
import {CORRIDOR, Planner, isCorr, type Node, type PlanDoor} from '../reactor/complex/bunkerPlan';
import type {LRect} from '../reactor/complex/bunkerGrow';
import type {StoreyProgramme} from './programme';

/** One planned room of a storey (canonical canvas rect). */
export interface StoreyRoom {
  key: string;
  label: string;
  role: Node['role'];
  kind: Node['kind'];
  type: Node['type'];
  purpose: string;
  rect: Rect;
  clear: number;
  /** Key of the room it opens off ('' = a skeleton node). */
  parent: string;
  wing?: string;
}
/** One planned door (canonical canvas gap rect; `a` / `b` = room keys). */
export interface StoreyDoor { a: string; b: string; gap: Rect; height: number; arch: boolean; kind: PlanDoor['kind']; loop?: boolean }

export interface StoreyPlan {
  level: number;
  rooms: StoreyRoom[];
  doors: StoreyDoor[];
  /** What this seed rolled (QA / docs). */
  meta: {attempt: number; corridors: number; loops: number; optional: string[]};
}

/** The fixed skeleton of a storey (canonical canvas rects). */
export interface StoreySkeleton {
  footprint: Rect;
  coreA: Rect; lobbyA: Rect; coreB: Rect; lobbyB: Rect; spine: Rect;
  /** The landing doors already cut through the lobbies' core-side walls (kept clear of every planned door). */
  landingDoors: Rect[];
}

/** QA / tests: why storey plans failed. */
export const BUNKER_PLAN_FAILS: Record<string, number> = {};

const CORR_LABEL: Readonly<Record<string, string>> = {living: 'Quarters corridor', plant: 'Plant corridor', ops: 'Operations corridor', entry: 'Entry corridor', hub: 'Main corridor', '': 'Service passage'};

/** Plans one storey (null when the programme does not fit after `attempts` forks). */
export function planStorey(level: number, sk: StoreySkeleton, prog: StoreyProgramme, rng: Rng, attempts = 8): StoreyPlan | null {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const why = {v: ''};
    const p = attemptStorey(level, sk, prog, rng.fork(`storey-${level}-${attempt}`), attempt, why);
    if (p) return p;
    BUNKER_PLAN_FAILS[`L${level}:${why.v}`] = (BUNKER_PLAN_FAILS[`L${level}:${why.v}`] ?? 0) + 1;
  }
  return null;
}

function attemptStorey(level: number, sk: StoreySkeleton, prog: StoreyProgramme, rng: Rng, attempt: number, why: {v: string}): StoreyPlan | null {
  const fail = (s: string): null => { why.v = s; return null; };
  const F = sk.footprint;
  // local frame: u = x - F.x (u = 0 / A - 1: the footprint's wall columns), v = y - (F.y + 1) (v = -1 / Vd: its wall rows)
  const A = F.w, Vd = F.h - 2;
  const L = (r: Rect): LRect => ({u: r.x - F.x, v: r.y - F.y - 1, w: r.w, h: r.h});
  const g = new Planner(A, Vd, rng);
  for (const r of [sk.coreA, sk.coreB, sk.lobbyA, sk.lobbyB, sk.spine]) if (!g.occ.inside(L(r))) return fail('skeleton-outside');
  // the cores: blocked, never parents, never in a loop
  g.add({key: 'coreA', label: 'Main stair', kind: 'room', type: 'stair-core', purpose: '', role: 'shaft'}, L(sk.coreA), null, {fixed: true, leaf: true, kids: false, maxDoors: 0});
  g.add({key: 'coreB', label: 'Service stair', kind: 'room', type: 'stair-core', purpose: '', role: 'shaft'}, L(sk.coreB), null, {fixed: true, leaf: true, kids: false, maxDoors: 0});
  // the lobbies (corridors along the cores' inner flanks; no child on the core side) and the spine between them
  const hub = g.add({...CORRIDOR, key: 'muster', label: 'Main stair lobby', cap: [sk.lobbyA.h, sk.lobbyA.w]}, L(sk.lobbyA), null, {fixed: true, axis: 'v', maxDoors: 12, wing: 'hub', walls: {'u-': false}});
  const lobB = g.add({...CORRIDOR, key: 'lobbyB', label: 'Service stair lobby', cap: [sk.lobbyB.h, sk.lobbyB.w]}, L(sk.lobbyB), null, {fixed: true, axis: 'v', maxDoors: 12, walls: {'u+': false}});
  const spine = g.add({...CORRIDOR, key: 'spine', label: 'Main corridor', cap: [sk.spine.w, sk.spine.h]}, L(sk.spine), hub, {fixed: true, axis: 'u', maxDoors: 14, wing: 'hub'});
  g.link(hub, spine, 'junction', 5);
  g.link(spine, lobB, 'junction', 5);
  for (const d of sk.landingDoors) g.markDoor(L(d));

  // --- more corridors off the skeleton -----------------------------------------------------------------------------------------
  const nCorr = rng.weighted<number>(prog.corridors as [number, number][]);
  let made = 0;
  for (let i = 0; i < nCorr; i++) {
    const bases = g.nodes.filter(isCorr).map(n => [n, n.key === 'spine' ? 2 : 1] as [Node, number]);
    if (g.spine(`corr${made + 1}`, bases)) made++;
  }
  // --- the programme by function -------------------------------------------------------------------------------------------------
  for (const sp of prog.required) if (!g.place(sp)) return fail(`place-${sp.key}`);
  const optional = rng.shuffle(prog.optional.slice());
  const want = optional.filter(() => rng.chance(0.7));
  const skipped = optional.filter(sp => !want.includes(sp));
  for (const sp of want) g.place(sp);
  g.grow(n => !isCorr(n));
  for (const sp of skipped) g.place(sp);
  for (let i = 0, n = 1; i < 3; i++) if (g.place(prog.spare, n > 1 ? `store${n}` : 'store')) n++;
  g.grow(n => !n.fixed);
  // --- doors: every parent door must fit (most constrained first), then seeded loops ---------------------------------------------
  const spanOf = (e: {a: number; b: number}) => {
    const a = g.nodes[e.a].r, b = g.nodes[e.b].r;
    const s0 = a.u + a.w + 1 === b.u || b.u + b.w + 1 === a.u ? [Math.max(a.v, b.v), Math.min(a.v + a.h, b.v + b.h)] : [Math.max(a.u, b.u), Math.min(a.u + a.w, b.u + b.w)];
    return s0[1] - s0[0];
  };
  for (const e of g.edges.filter(q => !q.placed).sort((p, q) => spanOf(p) - spanOf(q) || p.a - q.a || p.b - q.b)) {
    if (!g.door(e)) return fail(`door-${g.nodes[e.a].key}-${g.nodes[e.b].key}`);
  }
  let loops = 0;
  for (const [a, b, p] of rng.shuffle(g.loopPairs())) {
    if (a.key.startsWith('core') || b.key.startsWith('core')) continue;
    if (rng.chance(p) && g.loop(a, b)) loops++;
  }
  // --- corridor names by the rooms on them -------------------------------------------------------------------------------------
  const used = new Map<string, number>();
  for (const n of g.nodes) {
    if (!isCorr(n) || n.fixed) continue;
    const count: Record<string, number> = {};
    for (const e of g.edges) {
      const o = e.a === n.id ? g.nodes[e.b] : e.b === n.id ? g.nodes[e.a] : null;
      if (o && !isCorr(o) && o.wing) count[o.wing] = (count[o.wing] ?? 0) + 1;
    }
    const top = Object.entries(count).sort((p, q) => q[1] - p[1] || p[0].localeCompare(q[0]))[0];
    const w = top ? top[0] : '';
    if (w) n.wing = w as Node['wing'];
    const base = CORR_LABEL[w] ?? CORR_LABEL[''];
    const k = (used.get(base) ?? 0) + 1;
    used.set(base, k);
    n.label = k > 1 ? `${base} ${String.fromCharCode(64 + k)}` : base;
  }
  const W = (r: LRect): Rect => ({x: F.x + r.u, y: F.y + 1 + r.v, w: r.w, h: r.h});
  const rooms: StoreyRoom[] = g.nodes.filter(n => !n.key.startsWith('core')).map(n => ({
    key: n.key, label: n.label, role: n.role, kind: n.kind, type: n.type, purpose: n.purpose, rect: W(n.r), clear: n.clear, parent: n.parent, ...(n.wing ? {wing: n.wing} : {}),
  }));
  const doors: StoreyDoor[] = g.doors.map(d => ({a: d.a, b: d.b, gap: W(d.gap), height: d.height, arch: d.arch, kind: d.kind, ...(d.loop ? {loop: true} : {})}));
  return {level, rooms, doors, meta: {attempt, corridors: g.nodes.filter(n => isCorr(n) && !n.fixed).length, loops, optional: g.nodes.filter(n => prog.optional.some(o => o.key === n.key)).map(n => n.key)}};
}
