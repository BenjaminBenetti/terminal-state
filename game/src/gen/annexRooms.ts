// Task track2-playtest-revision-20261031 (lane ROOMS): ROOM SIGNATURES of the service annexes — recognisable BOILER, GENERATOR,
// SEWAGE, OVERFLOW, SPILLWAY, TURBINE and VENTILATION rooms built from actual layout, silhouette, fixtures, circulation and material,
// not a label (user feedback 4: "the same rooms repeating … think boiler room, generator room, sewage room, overflow room, spill way,
// turbine room, ventilation room … actually make them feel like that room, with custom layout and props"; feedback 5: keep the tight
// claustrophobic feel, "break it up with bigger rooms … so you have a mix").
//
// Two passes, both on the annex content's own forks (gen/annexContent.ts; no core stream is consumed):
//  1. assignAnnexRooms — every annex area takes a purpose: machinery HALLS (Area.extHall, gen/trackExt/carve.ts) and about half of
//     the medium rooms a SIGNATURE, the other rooms a small utility purpose (existing ids: workshop, stores, electrical, pump,
//     custodial, first aid), closets a closet purpose, corridors 'service-corridor'. THE ANTI-REPETITION RULE (bounded, seeded):
//      - halls first (largest first), then the chosen medium rooms in door-graph (traversal) order;
//      - a room never takes a signature already used by an annex room within ANNEX_ROOMS.hops (2) door hops — a room seen through one
//        door or across one corridor / hall: no adjacent copies of one signature along the traversal;
//      - weight = the signature's weight x its hall preference (halls) x unusedBoost (6) while still unused in the annex
//        x repeat (0.2) ^ uses so far — every annex shows several different signatures before any repeats;
//      - a signature whose layout cannot be built in the room (doors / proportions) falls back to another eligible one (same rule),
//        then to a utility purpose; utility purposes follow the same hop rule where possible and a 0.35 repeat penalty.
//  2. placeAnnexMachinery — the signature's LAYOUT in the room: anchored machinery assemblies as RECORDS
//     (layout.extensions.machines, AnnexMachine; drawn as merged procedural world geometry by world/trackExt/machines.ts) with
//     honest collision: every solid part is a collision-only prop 'annexMachine' (gen/props.ts; per-placement box, blocked / sight
//     cells, player / zombie / bullet / ragdoll collision through the existing prop paths) from machineBoxes(record) — the single
//     source both the generator and the renderer use. Placed through the dresser's own context (door zones, connectivity,
//     doorway clear volumes) in all-or-nothing transactions. Visual-only parts (wall pipes, overhead ducts / crane, floor gratings,
//     railings over curbs) stay within 0.28 m of a wall, above 2.2 m, flat on the floor or over a blocked footprint.
// No hazards, water physics or machinery simulation: channels / basins are blocked, visual, walkable-safe; machinery is static.
// Anchored machinery is the prop rules' "anchored structures / heavy machinery" exception (openables + physics audits classify
// 'annexMachine' with that reason); storage in these rooms comes from the purposes' (openable, finite) holders.

import type {Rng} from '../core/rng';
import {CELL, FLOOR} from './grid';
import type {Area, Door, StationLayout} from './stationTypes';
import {areaConnected, begin, cellsOfBox, commit, markCell, propBlocksDoorway, rollback, type PlaceCtx} from './placeKit';
import type {PropRule} from './purposes';

// ---------------------------------------------------------------------------------------------------------------------------------
// Signatures

export type SignatureId = 'boiler' | 'generator' | 'sewage' | 'overflow' | 'spillway' | 'turbine' | 'ventilation';
export const SIGNATURE_IDS: readonly SignatureId[] = ['boiler', 'generator', 'sewage', 'overflow', 'spillway', 'turbine', 'ventilation'];

export interface SignatureSpec {
  /** Room purpose id (gen/purposes.ts ANNEX_PURPOSES). */
  purpose: string;
  /** Minimum interior [short, long] side (m). */
  min: readonly [number, number];
  /** Only in a machinery hall. */
  hallOnly?: boolean;
  weight: number;
  /** Weight multiplier in a hall. */
  hall: number;
}

/** THE signature registry (focal point / footprint per signature: see the layouts below and docs/track-extensions.md). */
export const ROOM_SIGNATURES: Readonly<Record<SignatureId, SignatureSpec>> = {
  boiler: {purpose: 'boiler-room', min: [5, 6], weight: 1, hall: 1.3},
  generator: {purpose: 'generator-room', min: [5, 6.5], weight: 1, hall: 1.3},
  sewage: {purpose: 'sewage-room', min: [4.5, 7], weight: 1, hall: 0.7},
  overflow: {purpose: 'overflow-chamber', min: [6, 6.5], weight: 0.9, hall: 1.4},
  spillway: {purpose: 'spillway', min: [6, 8.5], weight: 0.9, hall: 2},
  turbine: {purpose: 'turbine-hall', min: [9, 12], hallOnly: true, weight: 1, hall: 2.6},
  ventilation: {purpose: 'ventilation-plant', min: [4.5, 5.5], weight: 1, hall: 0.9},
};

export const SIGNATURE_OF_PURPOSE: Readonly<Record<string, SignatureId>> = Object.fromEntries(SIGNATURE_IDS.map(s => [ROOM_SIGNATURES[s].purpose, s]));

/** THE annex room-mix config (one exported block). */
export const ANNEX_ROOMS = {
  /** A MEDIUM room (may take a signature): short side >= short m and >= m2 m². */
  medium: {short: 4.5, m2: 26},
  /** Share of the medium rooms that take a signature (seeded, bigger rooms likelier); the rest keep a small utility role. */
  mediumShare: 0.6,
  /** Anti-repetition: door hops within which a signature is never repeated; boost while unused; penalty per use. */
  hops: 2, unusedBoost: 6, repeat: 0.2,
  /** Alternative signatures tried when a layout does not fit its room. */
  retries: 2,
  /** Small utility rooms (existing purpose ids), weights; repeat penalty per use. */
  utility: [['workshop', 1], ['storage', 1.3], ['electrical-room', 1], ['pump-room', 0.8], ['custodial-room', 0.6], ['first-aid-room', 0.45]] as readonly (readonly [string, number])[],
  utilityRepeat: 0.35,
  closets: [['janitor-closet', 1.4], ['electrical-closet', 1], ['supply-closet', 0.7]] as readonly (readonly [string, number])[],
};

/**
 * Lean furniture rules of the existing (core) purposes when they dress an ANNEX room (gen/stationDress.ts dressExtensionAreas
 * `rules`): fewer, meaningful storage holders where the room's function suggests them (stores keep shelving, workshops a tool
 * locker, electrical rooms panels + a cabinet, closets one fixture) instead of the core's full furniture sets — the core's own
 * rooms are untouched. Signature purposes carry their own (lean) rules in gen/purposes.ts.
 */
export const ANNEX_RULES: Readonly<Record<string, readonly PropRule[]>> = {
  'storage': [
    {kind: 'stockShelf', at: 'row', wall: 'far', n: [1, 2], variant: 'stock', front: 0.8},
    {kind: 'shelf', at: 'wall', wall: 'side', n: [1, 1], chance: 0.4, front: 0.8},
    {kind: 'cartonStack', at: 'wall', wall: 'any', n: [0, 1]},
    {kind: 'crate', at: 'wall', wall: 'any', n: [1, 1], chance: 0.4},
  ],
  'workshop': [
    {kind: 'cabinetTall', at: 'wall', wall: 'side', n: [1, 1], chance: 0.7, front: 0.8},
    {kind: 'shelf', at: 'wall', wall: 'any', n: [0, 1], chance: 0.5, front: 0.8},
  ],
  'electrical-room': [
    {kind: 'electricalPanel', at: 'row', wall: 'far', n: [2, 3], front: 1.0},
    {kind: 'cabinetTall', at: 'wall', wall: 'any', n: [0, 1], chance: 0.6, front: 0.8},
  ],
  'pump-room': [
    {kind: 'cabinetLow', at: 'wall', wall: 'any', n: [0, 1], chance: 0.5, front: 0.7},
  ],
  'custodial-room': [
    {kind: 'mopSink', at: 'wall', wall: 'far', n: [1, 1], chance: 0.7, front: 0.6},
    {kind: 'stockShelf', at: 'wall', wall: 'side', n: [0, 1], chance: 0.6, variant: 'stock', front: 0.8},
  ],
  'first-aid-room': [
    {kind: 'medCabinet', at: 'wall', wall: 'far', n: [1, 1], front: 0.9},
    {kind: 'couch', at: 'wall', wall: 'side', n: [0, 1], chance: 0.5, front: 0.7},
    {kind: 'cabinetLow', at: 'wall', wall: 'any', n: [0, 1], chance: 0.5, front: 0.7},
  ],
  'janitor-closet': [
    {kind: 'mopSink', at: 'wall', wall: 'far', n: [1, 1], front: 0.6},
    {kind: 'stockShelf', at: 'wall', wall: 'side', n: [1, 1], chance: 0.25, variant: 'stock', front: 0.6},
    {kind: 'janitorCart', at: 'wall', wall: 'any', n: [1, 1], chance: 0.5},
  ],
  'electrical-closet': [
    {kind: 'electricalPanel', at: 'row', wall: 'far', n: [1, 2], front: 0.8},
    {kind: 'crate', at: 'wall', wall: 'any', n: [0, 1], chance: 0.25},
  ],
  'supply-closet': [
    {kind: 'stockShelf', at: 'wall', wall: 'far', n: [1, 1], variant: 'stock', front: 0.6},
    {kind: 'cartonStack', at: 'wall', wall: 'any', n: [0, 1], chance: 0.5},
  ],
};

// ---------------------------------------------------------------------------------------------------------------------------------
// Machinery records (layout.extensions.machines) and their collision

/**
 * Assembly kinds. Solid: boiler, genset, switchgear, turbine, fanWall, fanUnit, tank (one box), channel / basin / chute (curbs,
 * parapets, walls and water surfaces). Visual only: header, pipeRun, duct, crane, catwalk, gate, culvert, louvre.
 */
export type MachineKind = 'boiler' | 'header' | 'genset' | 'switchgear' | 'channel' | 'basin' | 'chute' | 'catwalk' | 'gate' | 'culvert'
  | 'turbine' | 'crane' | 'fanWall' | 'fanUnit' | 'duct' | 'louvre' | 'pipeRun' | 'tank';
export const MACHINE_KINDS: readonly MachineKind[] = ['boiler', 'header', 'genset', 'switchgear', 'channel', 'basin', 'chute', 'catwalk', 'gate', 'culvert',
  'turbine', 'crane', 'fanWall', 'fanUnit', 'duct', 'louvre', 'pipeRun', 'tank'];

/**
 * One assembly. Local frame: origin = footprint centre on the floor, local X along `w`, local Z along `d` (front = +Z), yawed by
 * `rot` (quarter turns, the PropPlacement convention: front = (sin rot, cos rot)); `y` = the floor (absolute). Wall-backed kinds have
 * their back (local -Z) on the wall face. `p`: kind parameters — channel: crossing spans [u0, u1, ...] in local X; chute: [steps, high
 * end (0: local -X, 1: +X), -X end on a wall (1/0), +X end on a wall]; basin: [inlet offset]; boiler: [shell diameter]; switchgear:
 * [panels]; fanWall: [fan diameter]; header / pipeRun / duct: [centre height above the floor, pipes]; crane: [girder height, hall
 * length]; catwalk: [railing on the -Z side (1/0)]; louvre: [bottom height].
 */
export interface AnnexMachine {
  kind: MachineKind;
  area: number;
  x: number; z: number; y: number;
  rot: number;
  w: number; d: number; h: number;
  seed: number;
  p?: number[];
}

/** A collision box of a record (world axis-aligned; y0 = 0 relative to the record floor). */
export interface MachineBox { x: number; z: number; hx: number; hz: number; h: number; sight: boolean }

/** Curb width / height of channels, parapet height / thickness of basins, chute wall (m). */
export const MACHINE_DIMS = {curb: 0.15, curbH: 0.22, water: 0.05, parapet: 0.92, parapetT: 0.25, chuteWall: 0.8, chuteT: 0.25, chuteTop: 0.6};

/** Water level (m above the floor) of chute step k of n (descending). */
export const chuteLevel = (k: number, n: number): number => n <= 1 ? MACHINE_DIMS.water : MACHINE_DIMS.chuteTop - k * (MACHINE_DIMS.chuteTop - MACHINE_DIMS.water) / (n - 1);

/** Chute steps (p[0]) and the water level of step k counted from the local -X end (p[1] = 1: the +X end is the high inlet). */
export const chuteSteps = (m: AnnexMachine): number => Math.max(1, Math.round(m.p?.[0] ?? 3));
export const chuteStepLevel = (m: AnnexMachine, k: number): number => { const n = chuteSteps(m); return chuteLevel(m.p?.[1] ? n - 1 - k : k, n); };

/** Spans [s0, s1] of [-half, half] outside the crossing spans `p` ([u0, u1, ...]). */
export function channelSegments(w: number, p: readonly number[] = []): [number, number][] {
  const cuts: [number, number][] = [];
  for (let i = 0; i + 1 < p.length; i += 2) cuts.push([p[i], p[i + 1]]);
  cuts.sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  let s = -w / 2;
  for (const [u0, u1] of cuts) { if (u0 > s + 1e-6) out.push([s, u0]); s = Math.max(s, u1); }
  if (w / 2 > s + 1e-6) out.push([s, w / 2]);
  return out;
}

/** Local collision boxes (centre lx / lz, half extents hw / hd along local X / Z, height). */
function localBoxes(m: AnnexMachine): {lx: number; lz: number; hw: number; hd: number; h: number; sight: boolean}[] {
  const D = MACHINE_DIMS, hw = m.w / 2, hd = m.d / 2;
  switch (m.kind) {
    case 'boiler': case 'genset': case 'switchgear': case 'turbine': case 'fanWall': case 'fanUnit': case 'tank':
      return [{lx: 0, lz: 0, hw, hd, h: m.h, sight: m.h >= 1.4}];
    case 'channel': {
      const out: ReturnType<typeof localBoxes> = [];
      for (const [s0, s1] of channelSegments(m.w, m.p)) {
        const cx = (s0 + s1) / 2, sw = (s1 - s0) / 2;
        out.push({lx: cx, lz: 0, hw: sw, hd: hd - D.curb, h: D.water, sight: false});
        for (const sg of [-1, 1]) out.push({lx: cx, lz: sg * (hd - D.curb / 2), hw: sw, hd: D.curb / 2, h: D.curbH, sight: false});
      }
      return out;
    }
    case 'basin': {
      const t = D.parapetT;
      return [
        {lx: 0, lz: hd - t / 2, hw, hd: t / 2, h: D.parapet, sight: false},
        {lx: -hw + t / 2, lz: -t / 2, hw: t / 2, hd: hd - t / 2, h: D.parapet, sight: false},
        {lx: hw - t / 2, lz: -t / 2, hw: t / 2, hd: hd - t / 2, h: D.parapet, sight: false},
        {lx: 0, lz: -t / 2, hw: hw - t, hd: hd - t / 2, h: D.water, sight: false},
      ];
    }
    case 'chute': {
      const t = D.chuteT, n = chuteSteps(m), out: ReturnType<typeof localBoxes> = [{lx: 0, lz: hd - t / 2, hw, hd: t / 2, h: D.chuteWall, sight: false}];
      for (let k = 0; k < n; k++) {
        const s0 = -hw + (k * m.w) / n, s1 = -hw + ((k + 1) * m.w) / n;
        out.push({lx: (s0 + s1) / 2, lz: -t / 2, hw: (s1 - s0) / 2, hd: hd - t / 2, h: chuteStepLevel(m, k) + 0.03, sight: false});
      }
      return out;
    }
    default: return [];
  }
}

/** World collision boxes of a record (empty for the visual-only kinds). */
export function machineBoxes(m: AnnexMachine): MachineBox[] {
  const c = Math.cos(m.rot), s = Math.sin(m.rot), odd = Math.abs(Math.round(m.rot / (Math.PI / 2))) % 2 === 1;
  return localBoxes(m).map(b => ({
    x: r3(m.x + b.lx * c + b.lz * s), z: r3(m.z - b.lx * s + b.lz * c),
    hx: r3(odd ? b.hd : b.hw), hz: r3(odd ? b.hw : b.hd), h: r3(b.h), sight: b.sight,
  }));
}

/** Whether a record kind is solid (has collision boxes). */
export const isSolidMachine = (k: MachineKind): boolean => ['boiler', 'genset', 'switchgear', 'turbine', 'fanWall', 'fanUnit', 'tank', 'channel', 'basin', 'chute'].includes(k);

// ---------------------------------------------------------------------------------------------------------------------------------
// 1. Assignment (purposes; the anti-repetition rule)

const m2 = (a: Area) => a.w * a.h * CELL * CELL;
const dims = (a: Area): [number, number] => [Math.min(a.w, a.h) * CELL, Math.max(a.w, a.h) * CELL];
const fitsSig = (s: SignatureId, a: Area): boolean => {
  const sp = ROOM_SIGNATURES[s], [sh, lo] = dims(a);
  return sh >= sp.min[0] - 1e-6 && lo >= sp.min[1] - 1e-6 && (!sp.hallOnly || !!a.extHall);
};

/** Door graph of a set of annex areas: neighbours per area id, and the BFS order from the first area (the entry corridor). */
export function annexDoorGraph(layout: StationLayout, areas: readonly Area[]): {adj: Map<number, number[]>; order: Map<number, number>} {
  const ids = new Set(areas.map(a => a.id)), adj = new Map<number, number[]>();
  for (const a of areas) adj.set(a.id, []);
  for (const d of layout.doors) {
    if (d.a === d.b || !ids.has(d.a) || !ids.has(d.b)) continue;
    adj.get(d.a)!.push(d.b);
    adj.get(d.b)!.push(d.a);
  }
  const order = new Map<number, number>();
  if (areas.length) {
    const q = [areas[0].id];
    order.set(areas[0].id, 0);
    for (let h = 0; h < q.length; h++) for (const n of adj.get(q[h]) ?? []) if (!order.has(n)) { order.set(n, order.size); q.push(n); }
  }
  return {adj, order};
}

/** Area ids within `hops` door hops of `id` (excluding it). */
function within(adj: Map<number, number[]>, id: number, hops: number): number[] {
  const dist = new Map<number, number>([[id, 0]]), q = [id], out: number[] = [];
  for (let h = 0; h < q.length; h++) {
    const v = q[h], dv = dist.get(v)!;
    if (dv >= hops) continue;
    for (const n of adj.get(v) ?? []) if (!dist.has(n)) { dist.set(n, dv + 1); q.push(n); out.push(n); }
  }
  return out;
}

/** The signature per room id decided by assignAnnexRooms (consumed by placeAnnexMachinery). */
export interface AnnexRoomPlan {
  sig: Map<number, SignatureId>;
  adj: Map<number, number[]>;
  order: Map<number, number>;
}

/**
 * Purposes of one annex's areas (see the file header, pass 1): `setPurpose(area, purposeId)` applies one (the caller's purpose ↔ slot
 * rule). Returns the plan placeAnnexMachinery builds the layouts from.
 */
export function assignAnnexRooms(layout: StationLayout, areas: readonly Area[], rng: Rng, setPurpose: (a: Area, pid: string) => void, utilityOk: (pid: string, a: Area) => boolean): AnnexRoomPlan {
  const R = ANNEX_ROOMS, {adj, order} = annexDoorGraph(layout, areas);
  const sig = new Map<number, SignatureId>(), used = new Map<SignatureId, number>();
  const rooms = areas.filter(a => a.kind === 'room');
  const halls = rooms.filter(a => a.extHall).sort((p, q) => m2(q) - m2(p) || p.id - q.id);
  const medium = rooms.filter(a => !a.extHall && dims(a)[0] >= R.medium.short - 1e-6 && m2(a) >= R.medium.m2 - 1e-6);
  const k = Math.round(medium.length * R.mediumShare);
  const chosen = medium.map(a => ({a, key: Math.pow(rng.next(), 1 / m2(a))})).sort((p, q) => q.key - p.key || p.a.id - q.a.id).slice(0, k).map(o => o.a)
    .sort((p, q) => (order.get(p.id) ?? 1e9) - (order.get(q.id) ?? 1e9) || p.id - q.id);
  for (const a of [...halls, ...chosen]) {
    const s = drawSignature(a, adj, sig, used, rng);
    if (!s) continue;
    sig.set(a.id, s);
    used.set(s, (used.get(s) ?? 0) + 1);
  }
  // purposes: signature rooms, then utility rooms (hop rule where possible + repeat penalty), closets, corridors
  const uUsed = new Map<string, number>();
  const ordered = areas.slice().sort((p, q) => (order.get(p.id) ?? 1e9) - (order.get(q.id) ?? 1e9) || p.id - q.id);
  for (const a of ordered) {
    if (a.kind === 'service') { setPurpose(a, 'service-corridor'); continue; }
    const s = sig.get(a.id);
    if (s) { setPurpose(a, ROOM_SIGNATURES[s].purpose); continue; }
    if (a.kind === 'closet') { setPurpose(a, rng.weighted(R.closets)); continue; }
    setPurpose(a, drawUtility(a, adj, areas, uUsed, rng, utilityOk));
  }
  return {sig, adj, order};
}

/** The anti-repetition draw of one room's signature (null: none eligible). `ban`: signatures already tried here. */
function drawSignature(a: Area, adj: Map<number, number[]>, sig: ReadonlyMap<number, SignatureId>, used: ReadonlyMap<SignatureId, number>, rng: Rng, ban: ReadonlySet<SignatureId> = new Set()): SignatureId | null {
  const R = ANNEX_ROOMS;
  const near = new Set(within(adj, a.id, R.hops).map(id => sig.get(id)).filter((s): s is SignatureId => !!s));
  const opts = SIGNATURE_IDS.filter(s => !ban.has(s) && !near.has(s) && fitsSig(s, a)).map(s => {
    const sp = ROOM_SIGNATURES[s], u = used.get(s) ?? 0;
    return [s, sp.weight * (a.extHall ? sp.hall : 1) * (u ? Math.pow(R.repeat, u) : R.unusedBoost)] as [SignatureId, number];
  });
  return opts.length ? rng.weighted(opts) : null;
}

function drawUtility(a: Area, adj: Map<number, number[]>, areas: readonly Area[], used: Map<string, number>, rng: Rng, ok: (pid: string, a: Area) => boolean): string {
  const R = ANNEX_ROOMS, byId = new Map(areas.map(q => [q.id, q]));
  const near = new Set(within(adj, a.id, R.hops).map(id => byId.get(id)?.purpose).filter((p): p is string => !!p));
  const all = R.utility.filter(([pid]) => ok(pid, a));
  const fresh = all.filter(([pid]) => !near.has(pid));
  const list = (fresh.length ? fresh : all).map(([pid, w]) => [pid, w * Math.pow(R.utilityRepeat, used.get(pid) ?? 0)] as [string, number]);
  const pid = list.length ? rng.weighted(list) : 'storage';
  used.set(pid, (used.get(pid) ?? 0) + 1);
  return pid;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// 2. Layouts

type Side = 'N' | 'S' | 'E' | 'W';
const SIDES: readonly Side[] = ['N', 'S', 'E', 'W'];
const OPP: Record<Side, Side> = {N: 'S', S: 'N', E: 'W', W: 'E'};
/** Yaw of an assembly whose back is against `side` (front into the room): placeKit WALL_ROT. */
const ROT: Record<Side, number> = {N: 0, S: Math.PI, W: Math.PI / 2, E: -Math.PI / 2};

interface Env {
  layout: StationLayout; ctx: PlaceCtx; a: Area; rng: Rng; out: AnnexMachine[];
  x0: number; z0: number; x1: number; z1: number;
  floorY: number;
  /** Ceiling above the floor (m). */
  ceil: number;
  doors: Door[];
  main: Side | null;
  hall: boolean;
  /** Solid props placed by this pass. */
  placed: number;
}

const wallLen = (e: Env, s: Side) => (s === 'N' || s === 'S' ? e.x1 - e.x0 : e.z1 - e.z0);
const depthOf = (e: Env, s: Side) => (s === 'N' || s === 'S' ? e.z1 - e.z0 : e.x1 - e.x0);
/** World XZ at `t` m along the wall (from its low-coordinate end) and `dep` m in from its face. */
function wallPt(e: Env, s: Side, t: number, dep: number): [number, number] {
  if (s === 'N') return [e.x0 + t, e.z0 + dep];
  if (s === 'S') return [e.x0 + t, e.z1 - dep];
  if (s === 'W') return [e.x0 + dep, e.z0 + t];
  return [e.x1 - dep, e.z0 + t];
}
/** Door spans (m along the wall) of the area's doors in wall `s`. */
function doorSpans(e: Env, s: Side): [number, number][] {
  const a = e.a, out: [number, number][] = [];
  for (const d of e.doors) {
    if (s === 'N' && d.h === 1 && d.y === a.y - 1) out.push([(d.x - a.x) * CELL, (d.x + d.w - a.x) * CELL]);
    else if (s === 'S' && d.h === 1 && d.y === a.y + a.h) out.push([(d.x - a.x) * CELL, (d.x + d.w - a.x) * CELL]);
    else if (s === 'W' && d.w === 1 && d.x === a.x - 1) out.push([(d.y - a.y) * CELL, (d.y + d.h - a.y) * CELL]);
    else if (s === 'E' && d.w === 1 && d.x === a.x + a.w) out.push([(d.y - a.y) * CELL, (d.y + d.h - a.y) * CELL]);
  }
  return out;
}
/** Free spans of wall `s` (door spans grown by `margin` removed), longest first. */
function freeSpans(e: Env, s: Side, margin: number): [number, number][] {
  const len = wallLen(e, s), cuts = doorSpans(e, s).map(([p, q]) => [p - margin, q + margin] as [number, number]).sort((p, q) => p[0] - q[0]);
  const out: [number, number][] = [];
  let t = 0;
  for (const [p, q] of cuts) { if (p > t) out.push([t, p]); t = Math.max(t, q); }
  if (len > t) out.push([t, len]);
  return out.filter(([p, q]) => q - p > 0.4).sort((p, q) => (q[1] - q[0]) - (p[1] - p[0]) || p[0] - q[0]);
}
const hasDoor = (e: Env, s: Side) => doorSpans(e, s).length > 0;
/** Walls in preference order: far from the main door, then the sides, then the door wall. */
function wallOrder(e: Env): Side[] {
  if (!e.main) return e.rng.shuffle(SIDES.slice());
  const sides = e.rng.shuffle((e.main === 'N' || e.main === 'S' ? ['E', 'W'] : ['N', 'S']) as Side[]);
  return [OPP[e.main], ...sides, e.main];
}
const snap = (v: number) => Math.round(v / CELL) * CELL;
const r3 = (v: number) => Math.round(v * 1000) / 1000;
const seedOf = (e: Env) => Math.floor(e.rng.next() * 1e9);

function rec(e: Env, kind: MachineKind, x: number, z: number, rot: number, w: number, d: number, h: number, p?: number[]): AnnexMachine {
  return {kind, area: e.a.id, x: r3(x), z: r3(z), y: e.floorY, rot, w: r3(w), d: r3(d), h: r3(h), seed: seedOf(e), ...(p ? {p: p.map(r3)} : {})};
}
/** A wall-backed record: `t` = centre along wall `s`, footprint `w` along the wall x `d` deep (from the wall face). */
const onWall = (e: Env, kind: MachineKind, s: Side, t: number, w: number, d: number, h: number, p?: number[], dep0 = 0): AnnexMachine => {
  const [x, z] = wallPt(e, s, t, dep0 + d / 2);
  return rec(e, kind, x, z, ROT[s], w, d, h, p);
};

/**
 * Places a group of records all-or-nothing: their collision boxes on free floor of the room (not blocked / reserved / an edge, not
 * a door cell, outside the door zones unless `zoneOk`), under the ceiling, outside every doorway clear volume, the room still one
 * connected piece touching all its doors; `keep` cells (access strips, island rings) must be walkable and are reserved. Pushes one
 * collision-only 'annexMachine' prop per box (y 0: lifted onto the floor with the rest of the dressing) and the records.
 */
/** Debug sink (tests / census only): failure reasons of tryPlace when set. */
export const ROOMS_DEBUG: {log: string[] | null} = {log: null};

function tryPlace(e: Env, recs: readonly AnnexMachine[], keep: readonly MachineBox[] = [], zoneOk = false): boolean {
  const {ctx, a, layout} = e, g = ctx.g;
  // local undo (the room's outer transaction, placeAnnexMachinery, also logs every mask change: a failed LAYOUT undoes all of it)
  const p0 = layout.props.length, undo: [Uint8Array, number, number][] = [];
  /** Cells this placement itself blocked (its own boxes may share a cell: sub-cell curbs, a keep strip beside a footprint). */
  const mine = new Set<number>();
  const mark = (arr: Uint8Array, i: number) => { if (arr[i] !== 1) { undo.push([arr, i, arr[i]]); markCell(ctx, arr, i); } };
  let why = '';
  const fail = () => {
    for (let k = undo.length - 1; k >= 0; k--) undo[k][0][undo[k][1]] = undo[k][2];
    layout.props.length = p0;
    ROOMS_DEBUG.log?.push(`${a.id} ${recs.map(m => m.kind).join('+')}: ${why}`);
    return false;
  };
  for (const m of recs) {
    for (const b of machineBoxes(m)) {
      if (b.h > e.ceil - 0.02) { why = `ceil ${b.h} > ${e.ceil}`; return fail(); }
      const [cx0, cy0, cx1, cy1] = cellsOfBox(b.x, b.z, b.hx, b.hz);
      for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
        if (!g.inBounds(cx, cy)) { why = 'bounds'; return fail(); }
        const i = g.idx(cx, cy);
        if (mine.has(i)) continue;
        if (g.cells[i] !== FLOOR || g.area[i] !== a.id || g.blocked[i] || ctx.keep[i] || ctx.edge[i] || ctx.doorCell[i] || (!zoneOk && ctx.zone[i])) {
          why = `cell ${g.cells[i] !== FLOOR ? 'notfloor' : g.area[i] !== a.id ? 'area' : g.blocked[i] ? 'blocked' : ctx.keep[i] ? 'keep' : ctx.edge[i] ? 'edge' : ctx.doorCell[i] ? 'door' : 'zone'}`;
          return fail();
        }
      }
      if (propBlocksDoorway(layout, b.x, b.z, b.hx, b.hz, e.floorY, b.h)) { why = 'doorway'; return fail(); }
      for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
        const i = g.idx(cx, cy);
        mine.add(i);
        mark(g.blocked, i);
        if (b.sight) mark(g.sightBlocked, i);
      }
      layout.props.push({kind: 'annexMachine', x: b.x, z: b.z, y: 0, rot: 0, area: a.id, hx: b.hx, hz: b.hz, h: b.h, blocksSight: b.sight, variant: MACHINE_KINDS.indexOf(m.kind)});
    }
  }
  for (const b of keep) {
    const [cx0, cy0, cx1, cy1] = cellsOfBox(b.x, b.z, b.hx, b.hz);
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
      if (!g.inBounds(cx, cy) || g.area[g.idx(cx, cy)] !== a.id || mine.has(g.idx(cx, cy))) continue;
      if (!g.walkable(cx, cy)) { why = 'keep blocked'; return fail(); }
      mark(ctx.keep, g.idx(cx, cy));
    }
  }
  if (!areaConnected(ctx, a)) { why = 'connectivity'; return fail(); }
  e.placed += layout.props.length - p0;
  e.out.push(...recs);
  return true;
}
/** Visual-only records (no collision): appended directly. */
const addVisual = (e: Env, ...recs: AnnexMachine[]) => { e.out.push(...recs); };

/** The strip `dep0 .. dep0 + d` m in front of a wall-backed footprint (access / keep box). */
function frontStrip(e: Env, s: Side, t: number, w: number, dep0: number, d: number): MachineBox {
  const [x, z] = wallPt(e, s, t, dep0 + d / 2), along = s === 'N' || s === 'S';
  return {x, z, hx: along ? w / 2 : d / 2, hz: along ? d / 2 : w / 2, h: 0, sight: false};
}

/** Pipe runs high on 1-2 walls (atmosphere: within 0.28 m of the wall face, under the ceiling). */
function wallPipes(e: Env, n: number, skip: readonly Side[] = []): void {
  for (const s of e.rng.shuffle(SIDES.filter(q => !skip.includes(q)))) {
    if (n-- <= 0) break;
    const len = wallLen(e, s), y = Math.min(e.ceil - 0.22, 2.75);
    if (y < 1.9 || len < 2) continue;
    addVisual(e, onWall(e, 'pipeRun', s, len / 2, len, 0.28, 0.3, [y, e.rng.int(2, 3)]));
  }
}

// --- BOILER ROOM: a bank of horizontal fire-tube boilers (burner fronts into an aisle), flue stacks, a pipe header on the back wall
function boilerLayout(e: Env): boolean {
  const D = e.hall ? 1.7 : 1.45, L = e.hall ? 3.5 : 3.0, w = 2.0, gap = 1.0;
  for (const s of wallOrder(e)) {
    if (depthOf(e, s) - L < 1.5) continue;
    for (const n of e.hall ? [3, 2] : [2]) {
      const total = n * w + (n - 1) * gap;
      for (const [t0, t1] of freeSpans(e, s, 1.0)) {
        if (t1 - t0 < total) continue;
        const start = snap(t0 + (t1 - t0 - total) / 2 + e.rng.range(-0.25, 0.25) * (t1 - t0 - total));
        if (start < t0 - 1e-6 || start + total > t1 + 1e-6) continue;
        const h = Math.min(D + 0.45, e.ceil - 0.1), recs: AnnexMachine[] = [];
        for (let k = 0; k < n; k++) recs.push(onWall(e, 'boiler', s, start + w / 2 + k * (w + gap), w, L, h, [D]));
        if (!tryPlace(e, recs, [frontStrip(e, s, start + total / 2, total, L, 1.0)])) continue;
        const hy = Math.min(e.ceil - 0.25, 2.9), offs: number[] = [];
        for (let k = 0; k < n; k++) offs.push(w / 2 + k * (w + gap) - total / 2);
        // (the header's along-wall axis runs with the wall's t on N / E walls, against it on S / W: mirror the branch offsets there)
        const flip = s === 'S' || s === 'W' ? -1 : 1;
        addVisual(e, onWall(e, 'header', s, start + total / 2, total + 1.2, 0.28, 0.4, [hy, ...offs.map(o => o * flip)]));
        if (e.hall) addVisual(e, onWall(e, 'duct', s, start + total / 2, total, 0.9, 0.6, [e.ceil - 0.45], L * 0.55));
        // a vertical expansion / feed tank on another wall (best effort)
        wallTank(e, [s]);
        wallPipes(e, 1, [s]);
        return true;
      }
    }
  }
  return false;
}

/** Island scan: the most central footprint (w x d along the room's long axis) with a walkway ring all round. */
function islandSpots(e: Env, w: number, d: number, ring: number): {x: number; z: number; rot: number}[] {
  const alongX = e.x1 - e.x0 >= e.z1 - e.z0, rot = alongX ? 0 : Math.PI / 2;
  const hx = (alongX ? w : d) / 2, hz = (alongX ? d : w) / 2;
  const cx = (e.x0 + e.x1) / 2, cz = (e.z0 + e.z1) / 2, out: {x: number; z: number; rot: number; k: number}[] = [];
  for (let x = e.x0 + ring + hx; x <= e.x1 - ring - hx + 1e-6; x += CELL / 2) {
    for (let z = e.z0 + ring + hz; z <= e.z1 - ring - hz + 1e-6; z += CELL / 2) {
      const sx = Math.abs(((x - hx) / CELL) - Math.round((x - hx) / CELL)) < 1e-6, sz = Math.abs(((z - hz) / CELL) - Math.round((z - hz) / CELL)) < 1e-6;
      if (!sx || !sz) continue;
      out.push({x, z, rot, k: Math.hypot(x - cx, z - cz) + e.rng.next() * 0.3});
    }
  }
  return out.sort((p, q) => p.k - q.k).slice(0, 48);
}
const ringBox = (x: number, z: number, hx: number, hz: number, ring: number): MachineBox => ({x, z, hx: hx + ring, hz: hz + ring, h: 0, sight: false});

/** A vertical tank (expansion / day / oil tank, 1 x 1 m) against the first wall that takes it (best effort). */
function wallTank(e: Env, avoid: readonly Side[] = []): boolean {
  for (const s of wallOrder(e)) {
    if (avoid.includes(s)) continue;
    for (const [t0, t1] of freeSpans(e, s, 1.0)) {
      if (t1 - t0 < 1.2) continue;
      if (tryPlace(e, [onWall(e, 'tank', s, snap((t0 + t1) / 2 - 0.5) + 0.5, 1.0, 1.0, Math.min(1.9, e.ceil - 0.2))], [frontStrip(e, s, snap((t0 + t1) / 2 - 0.5) + 0.5, 1.0, 1.0, 0.6)])) return true;
    }
  }
  return false;
}

/** Switchgear lineup (n panels x 0.8 m) on the first wall that takes it; returns the wall used. */
function switchgear(e: Env, nMax: number, avoid: readonly Side[] = []): Side | null {
  for (const s of wallOrder(e)) {
    if (avoid.includes(s) || depthOf(e, s) < 3) continue;
    for (const [t0, t1] of freeSpans(e, s, 1.0)) {
      const n = Math.min(nMax, Math.floor((t1 - t0) / 0.8));
      if (n < 2) continue;
      const w = n * 0.8, t = snap(t0 + (t1 - t0 - w) / 2) + w / 2;
      const h = Math.min(2.1, e.ceil - 0.15);
      if (tryPlace(e, [onWall(e, 'switchgear', s, t, w, 0.6, h, [n])], [frontStrip(e, s, t, w, 0.6, 1.0)])) return s;
    }
  }
  return null;
}

// --- GENERATOR ROOM: diesel generator sets on concrete plinths as islands (walkway ring), a switchgear lineup, exhaust risers
function generatorLayout(e: Env): boolean {
  const gw = e.hall ? 4.0 : 3.5, gd = 1.5, ring = 1.0;
  const sg = switchgear(e, e.hall ? 7 : 4);
  const want = e.hall ? 2 : 1;
  let got = 0;
  for (let k = 0; k < want; k++) {
    let ok = false;
    for (const sp of islandSpots(e, gw, gd, ring)) {
      const h = Math.min(1.75, e.ceil - 0.1);
      const m = rec(e, 'genset', sp.x, sp.z, sp.rot + (e.rng.chance(0.5) ? Math.PI : 0), gw, gd, h);
      const bx = machineBoxes(m)[0];
      if (tryPlace(e, [m], [ringBox(bx.x, bx.z, bx.hx, bx.hz, ring)])) { ok = true; break; }
    }
    if (!ok) break;
    got++;
  }
  if (!got) return false;
  // the fuel day tank (best effort; not on the switchgear's wall)
  wallTank(e, sg ? [sg] : []);
  wallPipes(e, 1);
  return true;
}

// --- SEWAGE ROOM: a contained channel down the room's length (dark water, curbs, handrails), grated crossings, walkways both sides
function sewageLayout(e: Env): boolean {
  const alongX = e.x1 - e.x0 >= e.z1 - e.z0;
  const len = alongX ? e.x1 - e.x0 : e.z1 - e.z0, wide = alongX ? e.z1 - e.z0 : e.x1 - e.x0;
  const cw = e.hall || wide >= 6 ? 2.0 : 1.5;
  if (wide - cw < 2.5) return false;
  const endA: Side = alongX ? 'W' : 'N', endB: Side = alongX ? 'E' : 'S';
  // stop 1.5 m short of an end wall with a door in it
  const a0 = hasDoor(e, endA) ? 1.5 : 0, a1 = hasDoor(e, endB) ? 1.5 : 0;
  const L = snap(len - a0 - a1);
  if (L < 4) return false;
  const offsets = [0, CELL, -CELL].map(o => snap((wide - cw) / 2 + o));
  for (const off of offsets) {
    if (off < 1.2 || wide - off - cw < 1.2) continue;
    // crossings (grated, walkable): one, two on a long channel, at seeded cell positions away from the ends
    const nc = L > 9 ? 2 : 1, cross: number[] = [];
    for (let k = 0; k < nc; k++) {
      const c = snap(-L / 2 + L * (k + 1) / (nc + 1) + e.rng.range(-0.5, 0.5));
      cross.push(c - 0.75, c + 0.75);
    }
    const cxw = alongX ? e.x0 + a0 + L / 2 : e.x0 + off + cw / 2, czw = alongX ? e.z0 + off + cw / 2 : e.z0 + a0 + L / 2;
    const rot = alongX ? 0 : Math.PI / 2;
    // (the crossing spans are the record's own local-X spans: its boxes and its drawing read the same numbers)
    const ch = rec(e, 'channel', cxw, czw, rot, L, cw, MACHINE_DIMS.curbH, cross);
    if (!tryPlace(e, [ch])) continue;
    // sluice gate at an end the channel meets, a culvert mouth at the other; walkways (gratings) both sides
    const lo = alongX ? [cxw - L / 2, czw] : [cxw, czw - L / 2], hi = alongX ? [cxw + L / 2, czw] : [cxw, czw + L / 2];
    if (!a0) addVisual(e, rec(e, 'gate', lo[0] + (alongX ? 0.15 : 0), lo[1] + (alongX ? 0 : 0.15), alongX ? Math.PI / 2 : 0, cw, 0.3, Math.min(2.2, e.ceil - 0.2)));
    if (!a1) addVisual(e, rec(e, 'culvert', hi[0] - (alongX ? 0.05 : 0), hi[1] - (alongX ? 0 : 0.05), alongX ? -Math.PI / 2 : Math.PI, cw - 0.3, 0.1, 0.9));
    for (const sg of [-1, 1]) {
      const wv = sg < 0 ? off : wide - off - cw;
      const ww = Math.min(1.0, wv - 0.2);
      if (ww < 0.6) continue;
      const v = sg < 0 ? off - ww / 2 : off + cw + ww / 2;
      const x = alongX ? cxw : e.x0 + v, z = alongX ? e.z0 + v : czw;
      addVisual(e, rec(e, 'catwalk', x, z, rot, L, ww, 0.03, [0]));
    }
    wallPipes(e, 2, alongX ? ['W', 'E'] : ['N', 'S']);
    return true;
  }
  return false;
}

// --- OVERFLOW CHAMBER: a deep basin against the far wall behind a concrete parapet and handrail, an inlet pipe pouring in
function overflowLayout(e: Env): boolean {
  const ring = 1.2;
  for (const s of wallOrder(e)) {
    const dep = depthOf(e, s);
    for (const [t0, t1] of freeSpans(e, s, 0.0)) {
      // keep a walkway at either end of the basin unless it meets a side wall
      const len = t1 - t0, w = snap(Math.min(len - 2 * ring, e.hall ? 10 : 6));
      if (w < 3) continue;
      const d = snap(Math.min(dep - ring - 1.5, e.hall ? 7 : 4));
      if (d < 2.5) continue;
      const t = snap(t0 + (len - w) / 2) + w / 2;
      const m = onWall(e, 'basin', s, t, w, d, MACHINE_DIMS.parapet, [snap(e.rng.range(-w / 4, w / 4))]);
      if (!tryPlace(e, [m], [frontStrip(e, s, t, w, d, ring)])) continue;
      if (e.hall) addVisual(e, onWall(e, 'pipeRun', s, t, w + 1, 0.28, 0.3, [Math.min(e.ceil - 0.3, 3.2), 2]));
      wallPipes(e, 1, [s]);
      return true;
    }
  }
  return false;
}

// --- SPILLWAY: a stepped concrete chute along a door-free long wall (inlet weir high, culvert low), a grated catwalk with railing
function spillwayLayout(e: Env): boolean {
  const alongX = e.x1 - e.x0 >= e.z1 - e.z0;
  const walls: Side[] = e.rng.shuffle((alongX ? ['N', 'S'] : ['W', 'E']) as Side[]).filter(s => !hasDoor(e, s));
  for (const s of walls) {
    const len = wallLen(e, s), dep = depthOf(e, s);
    const ends: [Side, Side] = alongX ? ['W', 'E'] : ['N', 'S'];
    const a0 = hasDoor(e, ends[0]) ? 1.5 : 0, a1 = hasDoor(e, ends[1]) ? 1.5 : 0;
    const L = snap(len - a0 - a1), cw = e.hall ? 2.25 : 1.75;
    if (L < 6 || dep - cw < 2.5) continue;
    const n = Math.max(3, Math.min(5, Math.round(L / 2.4)));
    const high = e.rng.chance(0.5);   // which end the water comes in at
    const tc = a0 + L / 2;
    // local -X = the high end: rotate the wall frame so local X runs along the wall toward the low end
    const [x, z] = wallPt(e, s, tc, cw / 2);
    // back of the chute against the wall: local -Z faces the wall => front (+Z) points into the room: ROT[s]; local +X then runs
    // along the wall in the direction (cos rot, -sin rot); flip by pi... keep the front into the room and mirror the steps instead
    // local -X runs toward the wall's low t end on N / E walls (rot 0 / -pi/2), toward its high t end on S / W walls
    const negLow = s === 'N' || s === 'E', onNeg = negLow ? !a0 : !a1, onPos = negLow ? !a1 : !a0;
    const m = rec(e, 'chute', x, z, ROT[s], L, cw, MACHINE_DIMS.chuteWall, [n, high ? 1 : 0, onNeg ? 1 : 0, onPos ? 1 : 0]);
    if (!tryPlace(e, [m])) continue;
    // catwalk grating along the open side (the chute wall is its parapet; the chute draws its inlet weir / culvert mouth)
    const [cx, cz] = wallPt(e, s, tc, cw + 0.6);
    addVisual(e, rec(e, 'catwalk', cx, cz, ROT[s], L, 1.1, 0.03, [0]));
    // the sluice control panels on the opposite wall (best effort)
    if (dep - cw > 4) switchgear(e, e.hall ? 3 : 2, [s]);
    wallPipes(e, 1, [s]);
    return true;
  }
  return false;
}

// --- TURBINE HALL: a long turbine-generator set on a plinth, its inlet pipe from an end wall, an overhead crane, control panels
function turbineLayout(e: Env): boolean {
  const alongX = e.x1 - e.x0 >= e.z1 - e.z0;
  // the inlet end against an end wall (door-free end walls first; a door off the set's line is left to the door-zone checks)
  const ends: Side[] = e.rng.shuffle((alongX ? ['W', 'E'] : ['N', 'S']) as Side[]).sort((p, q) => Number(hasDoor(e, p)) - Number(hasDoor(e, q)));
  const len = alongX ? e.x1 - e.x0 : e.z1 - e.z0, wide = alongX ? e.z1 - e.z0 : e.x1 - e.x0;
  const pw = wide >= 11 ? 3.0 : 2.75;
  for (const end of ends) {
    // a door in the end wall: the set stands 1 m off it (walkway) and its penstock drops in from the ceiling instead (p[0] = 1)
    const gap = hasDoor(e, end) ? 1.0 : 0;
    const L = snap(Math.min(len - 2.0 - gap, 10));
    if (L < 6 || wide - pw < 3) continue;
    for (const off of [0, CELL, -CELL, 1, -1, 1.5, -1.5]) {
      const v = snap((wide - pw) / 2 + off);
      if (v < 1.4 || wide - v - pw < 1.4) continue;
      // the set's inlet end toward `end` (the record's local -X end at the wall, or 1 m off it)
      const t = v + pw / 2, dep = gap + L / 2;
      const [x, z] = wallPt(e, end, t, dep);
      // local X along the hall pointing away from `end`: rot so (cos, -sin) = inward normal of `end`
      const rot = end === 'W' ? 0 : end === 'E' ? Math.PI : end === 'N' ? -Math.PI / 2 : Math.PI / 2;
      const h = Math.min(2.7, e.ceil - 0.3);
      const m = rec(e, 'turbine', x, z, rot, L, pw, h, [gap ? 1 : 0]);
      const bx = machineBoxes(m)[0];
      if (!tryPlace(e, [m], [ringBox(bx.x, bx.z, bx.hx, bx.hz, 1.2)])) continue;
      // overhead travelling crane: rails high on the long walls, a girder across the hall over the set (visual, > 2.9 m)
      const cy = e.ceil - 0.45;
      if (cy >= 2.9) {
        // record frame: local X spans the hall's width, local Z runs along it (rot pi/2: local Z = world +X; rot 0: world +Z);
        // p = [girder height, hall length, hall centre - girder along local Z] (the runway rails run the hall's full length)
        const u = len * e.rng.range(0.3, 0.7);
        const g = alongX ? [e.x0 + u, (e.z0 + e.z1) / 2] : [(e.x0 + e.x1) / 2, e.z0 + u];
        addVisual(e, rec(e, 'crane', g[0], g[1], alongX ? Math.PI / 2 : 0, wide, 0.5, 0.4, [cy, len, len / 2 - u]));
      }
      const ctl = switchgear(e, 4, [end]);
      // lube-oil tank (best effort)
      wallTank(e, ctl ? [end, ctl] : [end]);
      wallPipes(e, 1, [end]);
      return true;
    }
  }
  return false;
}

// --- VENTILATION PLANT: big axial fans in the far wall, a floor-standing inline fan unit with its duct riser, ducts along the ceiling
function ventilationLayout(e: Env): boolean {
  let fans = 0, fanWall: Side | null = null;
  for (const s of wallOrder(e)) {
    const dia = Math.min(e.hall ? 2.6 : 1.9, e.ceil - 0.65);
    if (dia < 1.2 || depthOf(e, s) < 3) continue;
    const w = dia + 0.3, gap = 0.6;
    for (const [t0, t1] of freeSpans(e, s, 1.0)) {
      const n = Math.min(e.hall ? 3 : 2, Math.floor((t1 - t0 + gap) / (w + gap)));
      if (n < 1) continue;
      const total = n * w + (n - 1) * gap, start = snap(t0 + (t1 - t0 - total) / 2);
      const recs: AnnexMachine[] = [];
      for (let k = 0; k < n; k++) recs.push(onWall(e, 'fanWall', s, start + w / 2 + k * (w + gap), w, 0.75, dia + 0.45, [dia]));
      if (!tryPlace(e, recs, [frontStrip(e, s, start + total / 2, total, 0.75, 0.8)])) continue;
      fans = n; fanWall = s;
      break;
    }
    if (fans) break;
  }
  if (!fans || !fanWall) return false;
  // floor-standing inline fan unit(s) with a duct riser to the ceiling, on another wall
  let units = 0;
  for (const s of wallOrder(e)) {
    if (s === fanWall || units >= (e.hall ? 2 : 1)) continue;
    for (const [t0, t1] of freeSpans(e, s, 1.0)) {
      if (t1 - t0 < 2.0) continue;
      const t = snap((t0 + t1) / 2 - 0.9) + 0.9;
      if (tryPlace(e, [onWall(e, 'fanUnit', s, t, 2.0, 1.5, e.ceil - 0.05)], [frontStrip(e, s, t, 2.0, 1.5, 0.8)])) { units++; break; }
    }
  }
  // ducts along the ceiling over the fan wall (and across a hall), bottom >= 2.25 m; louvres beside the fans
  const dh = e.hall ? 0.7 : 0.45;
  if (e.ceil - 0.05 - dh >= 2.25) {
    const len = wallLen(e, fanWall);
    addVisual(e, onWall(e, 'duct', fanWall, len / 2, len, e.hall ? 1.2 : 0.9, dh, [e.ceil - 0.05 - dh / 2], 0.85));
  }
  for (const s of SIDES) {
    if (s === fanWall || hasDoor(e, s)) continue;
    const len = wallLen(e, s);
    if (len >= 3) { addVisual(e, onWall(e, 'louvre', s, snap(len / 2), Math.min(2.4, len - 1.5), 0.06, Math.min(1.2, e.ceil - 1.2), [0.9])); break; }
  }
  return true;
}

const LAYOUTS: Readonly<Record<SignatureId, (e: Env) => boolean>> = {
  boiler: boilerLayout, generator: generatorLayout, sewage: sewageLayout, overflow: overflowLayout, spillway: spillwayLayout,
  turbine: turbineLayout, ventilation: ventilationLayout,
};

/** What placeAnnexMachinery did for one annex (census / tests). */
export interface MachineryReport {
  /** Signature per room id that got its layout. */
  built: Map<number, SignatureId>;
  /** Rooms whose signature had to fall back to a utility purpose. */
  demoted: number;
  /** Collision props placed (budget-exempt). */
  solids: number;
}

/**
 * The signature layouts of one annex (file header, pass 2), halls first then in traversal order, through the dresser's own
 * contexts. Each room's layout runs in ONE transaction: a layout that cannot be built is undone entirely and up to
 * ANNEX_ROOMS.retries other eligible signatures are tried (the same anti-repetition rule), then the room becomes a utility room
 * (drawn like pass 1's). Records go to `out` (layout.extensions.machines).
 */
export function placeAnnexMachinery(layout: StationLayout, plan: AnnexRoomPlan, areas: readonly Area[], ctxOf: (a: Area) => PlaceCtx, rng: Rng, out: AnnexMachine[],
  setPurpose: (a: Area, pid: string) => void, utilityOk: (pid: string, a: Area) => boolean): MachineryReport {
  const rep: MachineryReport = {built: new Map(), demoted: 0, solids: 0};
  const byId = new Map(areas.map(a => [a.id, a]));
  const used = new Map<SignatureId, number>(), uUsed = new Map<string, number>();
  const rooms = [...plan.sig.keys()].map(id => byId.get(id)).filter((a): a is Area => !!a)
    .sort((p, q) => (p.extHall ? 0 : 1) - (q.extHall ? 0 : 1) || (plan.order.get(p.id) ?? 1e9) - (plan.order.get(q.id) ?? 1e9) || p.id - q.id);
  for (const a of rooms) {
    const ctx = ctxOf(a), doors = ctx.doorsOf.get(a.id) ?? [];
    const md = doors.find(d => d.a === a.parent || d.b === a.parent) ?? doors[0];
    const main: Side | null = !md ? null : md.h === 1 ? (md.y < a.y ? 'N' : 'S') : (md.x < a.x ? 'W' : 'E');
    const e: Env = {
      layout, ctx, a, rng: rng.fork(`room:${a.id}`), out, x0: a.x * CELL, z0: a.y * CELL, x1: (a.x + a.w) * CELL, z1: (a.y + a.h) * CELL,
      floorY: a.floorY ?? 0, ceil: a.ceil - (a.floorY ?? 0), doors, main, hall: !!a.extHall, placed: 0,
    };
    let s: SignatureId | null = plan.sig.get(a.id) ?? null;
    const tried = new Set<SignatureId>();
    let ok = false;
    for (let k = 0; s && k <= ANNEX_ROOMS.retries; k++) {
      tried.add(s);
      const n0 = out.length;
      e.placed = 0;
      if (ROOMS_DEBUG.log) {
        let bl = 0, kp = 0, nf = 0;
        for (let y = a.y; y < a.y + a.h; y++) for (let x = a.x; x < a.x + a.w; x++) { const i = ctx.g.idx(x, y); if (ctx.g.blocked[i]) bl++; if (ctx.keep[i]) kp++; if (ctx.g.cells[i] !== FLOOR) nf++; }
        ROOMS_DEBUG.log.push(`room ${a.id} ${(a.w * CELL).toFixed(1)}x${(a.h * CELL).toFixed(1)} ceil ${e.ceil.toFixed(2)} hall ${e.hall} doors ${doors.length} main ${main}: try ${s} [blocked ${bl} keep ${kp} notfloor ${nf} of ${a.w * a.h}; tx depth ${ctx.tx.depth}]`);
      }
      begin(ctx);
      if (LAYOUTS[s](e)) { commit(ctx); ok = true; break; }
      rollback(ctx);
      out.length = n0;
      plan.sig.delete(a.id);
      s = drawSignature(a, plan.adj, plan.sig, used, e.rng, tried);
      if (s) plan.sig.set(a.id, s);
    }
    if (ok && s) {
      plan.sig.set(a.id, s);
      setPurpose(a, ROOM_SIGNATURES[s].purpose);
      rep.built.set(a.id, s);
      used.set(s, (used.get(s) ?? 0) + 1);
      rep.solids += e.placed;
    } else {
      plan.sig.delete(a.id);
      setPurpose(a, drawUtility(a, plan.adj, areas, uUsed, e.rng, utilityOk));
      rep.demoted++;
    }
  }
  return rep;
}
