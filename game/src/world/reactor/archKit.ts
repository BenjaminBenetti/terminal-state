// Task reactor-build-20261101 (lane ARCH): the Reactor's INDUSTRIAL KIT PLAN — the B "Industrial Service Cathedral" steel, as
// pure instance placements (no materials, no canvas: Node-testable). world/reactor/arch.ts turns the plan into InstancedMeshes.
//
// Reference (reference/tasks/reactor-concepts-20261101-203831/concepts/B-service-cathedral-attempt2.png, user-selected): rusted
// concrete pit walls with vertical steel pilasters and cable runs; switchback galleries / landings hung on the walls with I-beam
// stringers and knee braces; lattice bridges and free-standing X-braced lattice towers crossing the pit at several depths; an
// overhead gantry crane (runways on wall corbels, a yellow box-girder bridge, trolley, hoist ropes, hook block hanging into the pit);
// an organ-like bank of tall vertical pipes with flanges, ring catwalks and lamps on one wall; generator blocks on the landings;
// warm caged lamps everywhere; a domed reactor vessel ringed by circular gantries with a faint glow at the bottom.
//
// COST MODEL (bounded): a dozen reused unit geometries ('box', 'ibeam', 'cyl', 'tube', 'stripe', 'plane', 'bulb', 'cage',
// 'blade', ...) x ~14 shared materials. Every placement is an INSTANCE of one (geometry, material) PART; parts are chunked per
// depth BAND (the tier a placement stands on / hangs under: one InstancedMesh per part per band, tagged with the two tiers that
// see it for the level culler) — so the whole pit is a few dozen draw calls, never one per beam. Unique pieces (the vessel body /
// dome, the crane hook, the ring gantries) are one merged mesh per material. Lamp bulbs are one InstancedMesh PER TIER with a
// per-tier material (setTierPower = one uniform), generator lamps / bodies and fan rotors are addressable instances (the visuals
// API updates O(1) instances per call; per frame only the spinning fans and running generators).

import * as THREE from 'three';
import type {
  ReactorCore, ReactorCrane, ReactorDeck, ReactorFan, ReactorGenerator, ReactorInfo, ReactorMarker, ReactorPipeBank, ReactorScreen,
  ReactorSite, ReactorTower,
} from '../../gen/reactor/reactorTypes';
import type {RailRun} from '../../gen/levels';
import type {ReactorPiece} from './archAssets';

/** Unit geometries of the kit (archMeshes.ts kitGeometry). */
export type KitGeo = 'box' | 'ibeam' | 'cyl' | 'tube' | 'stripe' | 'plane' | 'bulb' | 'cage' | 'blade' | 'wheel';
/** Shared kit materials (archMaterials.ts reactorDress). 'bulb' is per tier (see KitPlan.bulbs). */
export type KitMat = 'steel' | 'steelDark' | 'yellow' | 'black' | 'pipe' | 'machine' | 'grating' | 'band' | 'vessel' | 'glow' | 'panelLamp' | 'cable' | 'concrete' | 'marker';

/** One instance: its matrix and depth band (index into KitPlan.tiers, top-down); optional per-instance colour (0xRRGGBB). */
export interface KitInst { m: THREE.Matrix4; band: number; color?: number }
export interface KitPart { geo: KitGeo; mat: KitMat; list: KitInst[] }
/** An addressable instance (part key + its index in that part's list). */
export interface KitRef { part: string; index: number }

export interface KitFan { id: number; zone: number; level: number; hub: THREE.Vector3; basis: THREE.Matrix4; radius: number }
export interface KitGenerator {
  id: number; zone: number; level: number;
  /** Vibrating body instances (engine, heads, alternator, exhaust; or the model's instances: see arch.ts). */
  body: KitRef[];
  /** Panel lamps: [off (red), running (green)]. */
  lamps: [KitRef, KitRef];
  /** Model placement (when 'aux-generator' is delivered). */
  place: THREE.Matrix4;
  size: {w: number; d: number; h: number};
}
export interface KitLamp { band: number; level: number; m: THREE.Matrix4; dead: boolean; tint: number }

/** Merged unique geometry (vessel, hook, gantries) in world space, per material. */
export interface KitMerged { mat: KitMat; geos: THREE.BufferGeometry[]; band: number; name: string }

export interface KitStats {
  decks: number; decksSupported: number; deckBeams: number; braces: number; trusses: number; stripes: number; toePlates: number;
  towers: number; towerMembers: number; craneParts: number; pipes: number; flanges: number; catwalks: number; fans: number;
  generators: number; vesselParts: number; crdm: number; gantries: number; machines: number; screens: number; cables: number;
  bands: number; markerLabels: number; ribs: number; lamps: number; railRuns: number; railMembers: number; roofBeams: number;
}

const UP = new THREE.Vector3(0, 1, 0);

/** Deterministic 0..1 hash of a few numbers (seeded variation; same layout -> same kit). */
export function kitHash(...v: number[]): number {
  let h = 2166136261 >>> 0;
  for (const x of v) {
    h ^= Math.round(x * 97) | 0;
    h = Math.imul(h, 16777619) >>> 0;
    h ^= h >>> 15;
  }
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Even-odd point-in-polygon (x / z). */
export function inPoly(poly: readonly {x: number; z: number}[], x: number, z: number): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.z > z) !== (b.z > z) && x < (b.x - a.x) * (z - a.z) / (b.z - a.z) + a.x) c = !c;
  }
  return c;
}

/** Distance from (x, z) to the polygon's boundary. */
export function polyDist(poly: readonly {x: number; z: number}[], x: number, z: number): number {
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[j], b = poly[i];
    const ex = b.x - a.x, ez = b.z - a.z, L2 = ex * ex + ez * ez || 1;
    const t = Math.max(0, Math.min(1, ((x - a.x) * ex + (z - a.z) * ez) / L2));
    best = Math.min(best, Math.hypot(a.x + ex * t - x, a.z + ez * t - z));
  }
  return best;
}

// ---------------------------------------------------------------------------------------------------------------------------
// Matrix helpers (scratch vectors; the plan is built once per level on the loading screen)

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3();
const _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3();

type P3 = {x: number; y: number; z: number};

/** A unit member (length along local Z, section x = w, y = h) from a to b; the section's y follows `up` (default world up). */
export function memberMatrix(a: P3, b: P3, w: number, h: number, up: THREE.Vector3 = UP): THREE.Matrix4 | null {
  _z.set(b.x - a.x, b.y - a.y, b.z - a.z);
  const len = _z.length();
  if (len < 1e-4) return null;
  _z.divideScalar(len);
  _y.copy(up);
  if (Math.abs(_y.dot(_z)) > 0.985) _y.set(Math.abs(_z.x) < 0.9 ? 1 : 0, 0, Math.abs(_z.x) < 0.9 ? 0 : 1);
  _y.addScaledVector(_z, -_y.dot(_z)).normalize();
  _x.crossVectors(_y, _z);
  const m = new THREE.Matrix4().makeBasis(_x.multiplyScalar(w), _y.multiplyScalar(h), _z.multiplyScalar(len));
  return m.setPosition((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
}

/** A unit cylinder (axis local Y, diameter 1) from a to b with diameter d. */
export function cylMatrix(a: P3, b: P3, d: number): THREE.Matrix4 | null {
  _y.set(b.x - a.x, b.y - a.y, b.z - a.z);
  const len = _y.length();
  if (len < 1e-4) return null;
  _y.divideScalar(len);
  _x.set(1, 0, 0);
  if (Math.abs(_x.dot(_y)) > 0.9) _x.set(0, 0, 1);
  _x.addScaledVector(_y, -_x.dot(_y)).normalize();
  _z.crossVectors(_x, _y);
  const m = new THREE.Matrix4().makeBasis(_x.multiplyScalar(d), _y.multiplyScalar(len), _z.multiplyScalar(d));
  return m.setPosition((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
}

/** An axis-aligned (yawed) box centred at (x, y, z), size sx x sy x sz. */
export function boxMatrix(x: number, y: number, z: number, sx: number, sy: number, sz: number, yaw = 0): THREE.Matrix4 {
  _q.setFromAxisAngle(UP, yaw);
  return new THREE.Matrix4().compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
}

/** A box in a local frame (origin o, yaw): local centre (lx, ly, lz) + size. */
function localBox(o: P3, yaw: number, lx: number, ly: number, lz: number, sx: number, sy: number, sz: number): THREE.Matrix4 {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return boxMatrix(o.x + lx * c + lz * s, o.y + ly, o.z - lx * s + lz * c, sx, sy, sz, yaw);
}
/** World point of a local point (origin o, yaw: local X -> (cos, 0, -sin)). */
function localPt(o: P3, yaw: number, lx: number, ly: number, lz: number): P3 {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return {x: o.x + lx * c + lz * s, y: o.y + ly, z: o.z - lx * s + lz * c};
}

// ---------------------------------------------------------------------------------------------------------------------------
// The plan

/** Kit tunables (metres). */
export const KIT = {
  /** Under-deck steel: deck plate thickness (stringers hang below it), stringer depth / width, cross-beam pitch, stringer pitch. */
  plate: 0.12, beamDepth: 0.42, beamWidth: 0.2, crossPitch: 2.6, stringerPitch: 1.8,
  /** Knee braces every `bracePitch` along a wall edge. */
  bracePitch: 3.2,
  /** Bridge Warren truss: bottom chord depth below the deck, panel length. */
  trussDepth: 1.5, trussPanel: 2.4,
  /** Edge fascia (black channel with hazard stripes) height, stripe pitch; toe plate height. */
  fascia: 0.3, stripePitch: 0.5, toe: 0.12,
  /** Lattice tower: leg section, storey height, girt / brace sections. */
  leg: 0.34, storey: 4, girt: 0.2, brace: 0.12,
  /** Wall pilasters (vertical I-beams) every `ribPitch` along the pit outline. */
  ribPitch: 7,
  /** Lamp spacing along open deck edges / the pit walls; max lamps. */
  lampPitch: 6.5, wallLampPitch: 9, maxLamps: 700,
  /** Hazard stripes cap (instances). */
  maxStripes: 3000,
  /** Pipe flange pitch (m) and the ring catwalk depth in front of a pipe bank. */
  flangePitch: 3.6, catwalk: 1.1,
} as const;

export interface KitOptions {
  /** Pieces drawn from a delivered model instead of procedurally (arch.ts sets it from the loaded models). */
  models?: ReadonlySet<ReactorPiece>;
  /** The level's collision rails ARCH draws (ownsRail filtered). */
  rails?: readonly RailRun[];
}

export class KitPlan {
  readonly parts = new Map<string, KitPart>();
  readonly merged: KitMerged[] = [];
  readonly fans: KitFan[] = [];
  readonly generators: KitGenerator[] = [];
  readonly lamps: KitLamp[] = [];
  /** Marker labels (stencilled text plates on the bands): plane matrix + text + band. */
  readonly labels: {m: THREE.Matrix4; text: string; band: number; color: number; aspect: number}[] = [];
  /** Model placements per delivered piece (matrices fit by arch.ts). */
  readonly modelPlacements = new Map<ReactorPiece, {m: THREE.Matrix4; band: number; size?: readonly [number, number, number]}[]>();
  readonly stats: KitStats = {
    decks: 0, decksSupported: 0, deckBeams: 0, braces: 0, trusses: 0, stripes: 0, toePlates: 0, towers: 0, towerMembers: 0, craneParts: 0,
    pipes: 0, flanges: 0, catwalks: 0, fans: 0, generators: 0, vesselParts: 0, crdm: 0, gantries: 0, machines: 0, screens: 0, cables: 0,
    bands: 0, markerLabels: 0, ribs: 0, lamps: 0, railRuns: 0, railMembers: 0, roofBeams: 0,
  };
  /** Tiers top-down (baseY descending): bands are indices into this. */
  readonly tiers: readonly {level: number; baseY: number; index: number}[];
  readonly seed: number;

  constructor(readonly info: ReactorInfo, private readonly opts: KitOptions = {}) {
    this.tiers = [...info.tiers].sort((a, b) => b.baseY - a.baseY).map(t => ({level: t.level, baseY: t.baseY, index: t.index}));
    let s = 0;
    for (const ch of info.pit.variant ?? '') s = (s * 31 + ch.charCodeAt(0)) >>> 0;
    this.seed = (s ^ Math.round(info.pit.cx * 13 + info.pit.cz * 7)) % 100003;
  }

  /** Depth band of a world height: the tier a placement at y stands on (largest baseY <= y + 0.35); 0 above the rim. */
  bandOf(y: number): number {
    const T = this.tiers;
    for (let i = 0; i < T.length; i++) if (T[i].baseY <= y + 0.35) return i;
    return Math.max(0, T.length - 1);
  }
  /** Levels (layout.levels ids) that see band b: its tier and the tier above (steel under a deck is seen from both). */
  bandLevels(b: number): number[] {
    const out = [this.tiers[b]?.level, this.tiers[b - 1]?.level].filter((l): l is number => typeof l === 'number');
    return [...new Set(out)];
  }

  add(geo: KitGeo, mat: KitMat, m: THREE.Matrix4 | null, band: number, color?: number): KitRef | null {
    if (!m) return null;
    const key = `${geo}|${mat}`;
    let p = this.parts.get(key);
    if (!p) this.parts.set(key, (p = {geo, mat, list: []}));
    p.list.push(color === undefined ? {m, band} : {m, band, color});
    return {part: key, index: p.list.length - 1};
  }
  /** Member between two points (box or I-beam section). */
  member(geo: 'box' | 'ibeam', mat: KitMat, a: P3, b: P3, w: number, h: number, up?: THREE.Vector3): KitRef | null {
    return this.add(geo, mat, memberMatrix(a, b, w, h, up), this.bandOf(Math.min(a.y, b.y) + 0.05));
  }
  cyl(geo: 'cyl' | 'tube', mat: KitMat, a: P3, b: P3, d: number): KitRef | null {
    return this.add(geo, mat, cylMatrix(a, b, d), this.bandOf(Math.min(a.y, b.y) + 0.05));
  }
  box(mat: KitMat, x: number, y: number, z: number, sx: number, sy: number, sz: number, yaw = 0, color?: number): KitRef | null {
    return this.add('box', mat, boxMatrix(x, y, z, sx, sy, sz, yaw), this.bandOf(y - sy / 2 + 0.05), color);
  }
  lamp(x: number, y: number, z: number, level?: number): void {
    if (this.lamps.length >= KIT.maxLamps) return;
    const band = this.bandOf(y);
    const lv = level ?? this.tiers[band]?.level ?? 0;
    const h = kitHash(x, y, z, this.seed);
    const m = boxMatrix(x, y, z, 0.2, 0.26, 0.2);
    this.lamps.push({band, level: lv, m, dead: h < 0.1, tint: 0.82 + 0.18 * kitHash(z, x, 3)});
    this.add('cage', 'steelDark', boxMatrix(x, y, z, 0.26, 0.34, 0.26), band);
    this.stats.lamps++;
  }
  placeModel(piece: ReactorPiece, m: THREE.Matrix4, band: number, size?: readonly [number, number, number]): void {
    let l = this.modelPlacements.get(piece);
    if (!l) this.modelPlacements.set(piece, (l = []));
    l.push(size ? {m, band, size} : {m, band});
  }
  usesModel(piece: ReactorPiece): boolean { return !!this.opts.models?.has(piece); }

  /** Total instances over every part. */
  get instanceCount(): number { let n = 0; for (const p of this.parts.values()) n += p.list.length; return n + this.lamps.length; }
}

/** Builds the whole kit plan of a Reactor (decks, towers, crane, pipe banks, fans, generators, vessel, sites, screens, cables, bands). */
export function planReactorKit(info: ReactorInfo, opts: KitOptions = {}): KitPlan {
  const plan = new KitPlan(info, opts);
  const step = (fn: () => void, what: string) => { try { fn(); } catch (e) { console.warn(`reactor kit: ${what} skipped`, e); } };
  step(() => planWallRibs(plan), 'wall ribs');
  step(() => planMarkers(plan), 'markers');
  step(() => { for (const d of info.decks) planDeck(plan, d); }, 'decks');
  step(() => { for (const t of info.towers) planTower(plan, t); }, 'towers');
  step(() => planCrane(plan, info.crane), 'crane');
  step(() => planRoof(plan), 'roof');
  step(() => { for (const b of info.pipeBanks) planPipeBank(plan, b); }, 'pipe banks');
  step(() => { for (const f of info.fans) planFan(plan, f); }, 'fans');
  step(() => { for (const g of info.generators) planGenerator(plan, g); }, 'generators');
  step(() => planVessel(plan, info.core), 'vessel');
  step(() => { for (const s of info.sites) planSite(plan, s); }, 'sites');
  step(() => { for (const s of info.screens) planScreen(plan, s); }, 'screens');
  step(() => planWallLamps(plan), 'wall lamps');
  step(() => { if (opts.rails) planRails(plan, opts.rails); }, 'rails');
  return plan;
}

// ---------------------------------------------------------------------------------------------------------------------------
// Pit walls: vertical pilasters, painted tier bands + stencilled markers, wall lamps

/** Outline edges with their inward normal (toward the pit centre). */
export function pitEdges(info: ReactorInfo): {a: {x: number; z: number}; b: {x: number; z: number}; nx: number; nz: number; len: number}[] {
  const P = info.pit.outline, out: ReturnType<typeof pitEdges> = [];
  for (let i = 0; i < P.length; i++) {
    const a = P[i], b = P[(i + 1) % P.length];
    const ex = b.x - a.x, ez = b.z - a.z, len = Math.hypot(ex, ez);
    if (len < 0.5) continue;
    let nx = -ez / len, nz = ex / len;
    const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
    if (nx * (info.pit.cx - mx) + nz * (info.pit.cz - mz) < 0) { nx = -nx; nz = -nz; }
    out.push({a, b, nx, nz, len});
  }
  return out;
}

function planWallRibs(plan: KitPlan): void {
  const {pit} = plan.info;
  const top = Math.max(pit.rimY, Math.min(pit.roofY, pit.rimY + 6));
  // split each pilaster at the tier heights (per-band chunks for the culler)
  const cuts = [top, ...plan.tiers.map(t => t.baseY).filter(y => y < top && y > pit.floorY), pit.floorY].sort((a, b) => b - a);
  for (const e of pitEdges(plan.info)) {
    const n = Math.max(1, Math.round(e.len / KIT.ribPitch));
    const tx = (e.b.x - e.a.x) / e.len, tz = (e.b.z - e.a.z) / e.len;
    for (let k = 0; k <= n; k++) {
      if (k === 0 || k === n) continue; // corners: the neighbour edge's pilasters
      const s = (e.len * k) / n;
      const x = e.a.x + tx * s + e.nx * 0.2, z = e.a.z + tz * s + e.nz * 0.2;
      // flange faces the pit: section y (depth) along the inward normal, x along the wall
      const up = new THREE.Vector3(e.nx, 0, e.nz);
      for (let i = 0; i + 1 < cuts.length; i++) {
        const y0 = cuts[i + 1], y1 = cuts[i];
        if (y1 - y0 < 0.3) continue;
        const m = memberMatrix({x, y: y0, z}, {x, y: y1, z}, 0.42, 0.36, up);
        plan.add('ibeam', 'steelDark', m, plan.bandOf(y0 + 0.05));
        plan.stats.ribs++;
      }
    }
  }
}

/** Painted tier colour bands round the pit + stencilled labels on the long walls. */
function planMarkers(plan: KitPlan): void {
  const edges = pitEdges(plan.info);
  for (const mk of plan.info.markers) planMarker(plan, mk, edges);
}

function planMarker(plan: KitPlan, mk: ReactorMarker, edges: ReturnType<typeof pitEdges>): void {
  const h = mk.y1 - mk.y0;
  if (!(h > 0.05)) return;
  const yc = (mk.y0 + mk.y1) / 2, band = plan.bandOf(mk.y0 + 0.05);
  for (const e of edges) {
    const mx = (e.a.x + e.b.x) / 2 + e.nx * 0.04, mz = (e.a.z + e.b.z) / 2 + e.nz * 0.04;
    // plane faces +Z locally: yaw so local +Z = the inward normal
    const yaw = Math.atan2(e.nx, e.nz);
    plan.add('plane', 'band', boxMatrix(mx, yc, mz, e.len, h, 1, yaw), band, mk.color);
    plan.stats.bands++;
    if (e.len >= 8 && mk.text) {
      const lh = h * 0.72, aspect = Math.max(2, Math.min(9, mk.text.length * 0.62));
      const lw = Math.min(e.len * 0.6, lh * aspect);
      plan.labels.push({m: boxMatrix(mx + e.nx * 0.02, yc, mz + e.nz * 0.02, lw, lh, 1, yaw), text: mk.text, band, color: mk.color, aspect: lw / lh});
      plan.stats.markerLabels++;
    }
  }
}

function planWallLamps(plan: KitPlan): void {
  const edges = pitEdges(plan.info), {pit} = plan.info;
  for (const t of plan.tiers) {
    if (t.baseY < pit.floorY - 0.1) continue;
    const y = t.baseY + 2.7;
    for (const e of edges) {
      const n = Math.max(1, Math.floor(e.len / KIT.wallLampPitch));
      const tx = (e.b.x - e.a.x) / e.len, tz = (e.b.z - e.a.z) / e.len;
      for (let k = 0; k < n; k++) {
        const s = (e.len * (k + 0.5)) / n;
        const x = e.a.x + tx * s + e.nx * 0.45, z = e.a.z + tz * s + e.nz * 0.45;
        // a short bracket arm from the wall
        plan.member('box', 'steelDark', {x: x - e.nx * 0.42, y: y + 0.22, z: z - e.nz * 0.42}, {x, y: y + 0.22, z}, 0.06, 0.06);
        plan.lamp(x, y, z, t.level);
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------------------
// Decks: stringers + cross beams, knee braces to the wall, bridge trusses, fascia with hazard stripes, toe plates, lamps

type Edge = {x0: number; z0: number; x1: number; z1: number; nx: number; nz: number; len: number; kind: 'open' | 'wall' | 'joined'};

/** The four edges of a deck rect with what lies beyond each (the rock = wall, another deck at the same height = joined, else open). */
export function deckEdges(info: ReactorInfo, d: ReactorDeck): Edge[] {
  const r = d.rect, out: Edge[] = [];
  const sides: [number, number, number, number, number, number][] = [
    [r.x0, r.z0, r.x1, r.z0, 0, -1], [r.x0, r.z1, r.x1, r.z1, 0, 1], [r.x0, r.z0, r.x0, r.z1, -1, 0], [r.x1, r.z0, r.x1, r.z1, 1, 0],
  ];
  for (const [x0, z0, x1, z1, nx, nz] of sides) {
    const len = Math.hypot(x1 - x0, z1 - z0);
    let wall = 0, joined = 0;
    const N = 5;
    for (let k = 0; k < N; k++) {
      const t = (k + 0.5) / N, px = x0 + (x1 - x0) * t + nx * 0.35, pz = z0 + (z1 - z0) * t + nz * 0.35;
      if (!inPoly(info.pit.outline, px, pz) || polyDist(info.pit.outline, px, pz) < 0.05) wall++;
      else if (info.decks.some(o => o !== d && Math.abs(o.y - d.y) < 0.6 && px >= o.rect.x0 - 0.05 && px <= o.rect.x1 + 0.05 && pz >= o.rect.z0 - 0.05 && pz <= o.rect.z1 + 0.05)) joined++;
    }
    out.push({x0, z0, x1, z1, nx, nz, len, kind: wall >= 3 ? 'wall' : joined >= 3 ? 'joined' : 'open'});
  }
  return out;
}

function planDeck(plan: KitPlan, d: ReactorDeck): void {
  const r = d.rect, w = r.x1 - r.x0, dz = r.z1 - r.z0;
  if (!(w > 0.2 && dz > 0.2)) return;
  plan.stats.decks++;
  const yb = d.y - KIT.plate; // underside of the deck plate
  const heavy = d.kind === 'landing' || d.kind === 'bridge';
  const depth = heavy ? KIT.beamDepth * 1.4 : KIT.beamDepth;
  const yc = yb - depth / 2;
  const alongX = w >= dz; // stringers along the long axis
  const L = alongX ? w : dz, B = alongX ? dz : w;
  const P = (s: number, t: number, y: number): P3 => (alongX ? {x: r.x0 + s, y, z: r.z0 + t} : {x: r.x0 + t, y, z: r.z0 + s});
  let beams = 0;
  // stringers: both long edges + every ~stringerPitch between
  const ns = Math.max(1, Math.round(B / KIT.stringerPitch));
  for (let k = 0; k <= ns; k++) {
    const t = Math.min(B - 0.12, Math.max(0.12, (B * k) / ns));
    if (plan.member('ibeam', 'steel', P(0, t, yc), P(L, t, yc), KIT.beamWidth, depth)) beams++;
  }
  // cross beams (slightly shallower, under the stringers' flange line)
  const nc = Math.max(1, Math.round(L / KIT.crossPitch));
  for (let k = 0; k <= nc; k++) {
    const s = Math.min(L - 0.1, Math.max(0.1, (L * k) / nc));
    if (plan.member('ibeam', 'steelDark', P(s, 0.05, yc - 0.04), P(s, B - 0.05, yc - 0.04), KIT.beamWidth * 0.8, depth * 0.8)) beams++;
  }
  plan.stats.deckBeams += beams;
  const edges = deckEdges(plan.info, d);
  // knee braces back to the wall (galleries, landings, stair landings): from under the outer part of the deck down to the wall
  const wallEdges = edges.filter(e => e.kind === 'wall');
  let braces = 0;
  if (d.kind !== 'bridge' && d.kind !== 'tower') {
    for (const e of wallEdges) {
      const span = (e.nx !== 0 ? w : dz); // depth of the deck away from this wall
      const reach = Math.min(span * 0.85, 3.2), drop = Math.max(1.2, reach * 0.9);
      const n = Math.max(1, Math.round(e.len / KIT.bracePitch));
      for (let k = 0; k <= n; k++) {
        const s = Math.min(e.len - 0.2, Math.max(0.2, (e.len * k) / n));
        const tx = (e.x1 - e.x0) / (e.len || 1), tz = (e.z1 - e.z0) / (e.len || 1);
        const wx = e.x0 + tx * s + e.nx * 0.08, wz = e.z0 + tz * s + e.nz * 0.08; // on the wall plane
        const ix = -e.nx, iz = -e.nz; // into the deck
        const top = {x: wx + ix * reach, y: yb - depth, z: wz + iz * reach};
        const foot = {x: wx, y: yb - depth - drop, z: wz};
        if (plan.member('box', 'steel', foot, top, 0.16, 0.16)) braces++;
        plan.box('steelDark', foot.x + ix * 0.04, foot.y, foot.z + iz * 0.04, Math.abs(e.nx) > 0 ? 0.08 : 0.42, 0.5, Math.abs(e.nz) > 0 ? 0.08 : 0.42); // wall plate
        plan.box('steelDark', wx + ix * 0.25, yb - depth / 2, wz + iz * 0.25, Math.abs(e.nx) > 0 ? 0.5 : 0.3, depth, Math.abs(e.nz) > 0 ? 0.5 : 0.3); // corbel under the edge beam
      }
    }
  }
  plan.stats.braces += braces;
  // bridges: Warren trusses under both long sides (B's lattice bridges)
  if (d.kind === 'bridge') {
    const yt = yb - depth, ybot = yb - KIT.trussDepth;
    for (const t of [0.1, B - 0.1]) {
      plan.member('ibeam', 'steel', P(0, t, ybot), P(L, t, ybot), 0.18, 0.24);
      const np = Math.max(2, Math.round(L / KIT.trussPanel));
      for (let k = 0; k <= np; k++) {
        const s = (L * k) / np;
        plan.member('box', 'steel', P(s, t, ybot), P(s, t, yt), 0.12, 0.12);
        if (k < np) {
          const s2 = (L * (k + 1)) / np;
          plan.member('box', 'steel', k % 2 ? P(s, t, yt) : P(s, t, ybot), k % 2 ? P(s2, t, ybot) : P(s2, t, yt), 0.11, 0.11);
        }
      }
      plan.stats.trusses++;
    }
    // bottom lateral bracing (X between the two trusses every other panel)
    const np = Math.max(2, Math.round(L / KIT.trussPanel));
    for (let k = 0; k < np; k += 2) {
      const s = (L * k) / np, s2 = (L * Math.min(np, k + 1)) / np;
      plan.member('box', 'steelDark', P(s, 0.1, ybot), P(s2, B - 0.1, ybot), 0.07, 0.07);
      plan.member('box', 'steelDark', P(s, B - 0.1, ybot), P(s2, 0.1, ybot), 0.07, 0.07);
    }
  }
  if (beams > 0) plan.stats.decksSupported++;
  // open edges: black fascia channel with hazard stripes, toe plate, lamps
  const stripeEdges = d.kind === 'bridge' || d.kind === 'landing' || d.kind === 'stair-landing' || d.kind === 'tower';
  for (const e of edges) {
    if (e.kind !== 'open') continue;
    const tx = (e.x1 - e.x0) / (e.len || 1), tz = (e.z1 - e.z0) / (e.len || 1);
    const ox = e.nx * 0.02, oz = e.nz * 0.02;
    const a = {x: e.x0 + ox, y: d.y - KIT.fascia / 2, z: e.z0 + oz}, b = {x: e.x1 + ox, y: d.y - KIT.fascia / 2, z: e.z1 + oz};
    plan.member('box', 'black', a, b, 0.04, KIT.fascia);
    // toe plate on the deck top
    const ti = 0.03;
    plan.member('box', 'steel', {x: e.x0 - e.nx * ti, y: d.y + KIT.toe / 2, z: e.z0 - e.nz * ti}, {x: e.x1 - e.nx * ti, y: d.y + KIT.toe / 2, z: e.z1 - e.nz * ti}, 0.012, KIT.toe);
    plan.stats.toePlates++;
    if (stripeEdges && plan.stats.stripes < KIT.maxStripes) {
      const n = Math.floor(e.len / KIT.stripePitch);
      const yaw = Math.atan2(e.nx, e.nz);
      for (let k = 0; k < n && plan.stats.stripes < KIT.maxStripes; k++) {
        const s = (k + 0.5) * KIT.stripePitch;
        const x = e.x0 + tx * s + e.nx * 0.045, z = e.z0 + tz * s + e.nz * 0.045;
        // the stripe parallelogram leans along the edge: its local X must follow the edge tangent
        const m = boxMatrix(x, d.y - KIT.fascia / 2, z, KIT.stripePitch, KIT.fascia * 0.9, 1, yaw);
        plan.add('stripe', 'yellow', m, plan.bandOf(d.y - 0.2));
        plan.stats.stripes++;
      }
    }
    // lamps on the railing posts of the open edges
    if (d.kind !== 'stair-landing') {
      const n = Math.floor(e.len / KIT.lampPitch);
      for (let k = 0; k < n; k++) {
        const s = (k + 0.5) * (e.len / n);
        plan.lamp(e.x0 + tx * s + e.nx * 0.12, d.y + 1.28, e.z0 + tz * s + e.nz * 0.12, d.level);
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------------------
// Lattice towers

function planTower(plan: KitPlan, t: ReactorTower): void {
  const H = t.y1 - t.y0;
  if (!(H > 1 && t.hx > 0.2 && t.hz > 0.2)) return;
  plan.stats.towers++;
  const corners: [number, number][] = [[-t.hx, -t.hz], [t.hx, -t.hz], [t.hx, t.hz], [-t.hx, t.hz]];
  const ns = Math.max(1, Math.round(H / KIT.storey)), sh = H / ns;
  let n = 0;
  for (let s = 0; s < ns; s++) {
    const ya = t.y0 + s * sh, yb = ya + sh;
    // legs per storey (per-band chunks)
    for (const [cx, cz] of corners) if (plan.member('box', 'steelDark', {x: t.x + cx, y: ya, z: t.z + cz}, {x: t.x + cx, y: yb, z: t.z + cz}, KIT.leg, KIT.leg)) n++;
    for (let f = 0; f < 4; f++) {
      const [ax, az] = corners[f], [bx, bz] = corners[(f + 1) % 4];
      const A = (y: number) => ({x: t.x + ax, y, z: t.z + az}), B = (y: number) => ({x: t.x + bx, y, z: t.z + bz});
      if (plan.member('box', 'steel', A(yb - 0.1), B(yb - 0.1), KIT.girt, KIT.girt)) n++;
      // X-bracing per storey and face
      if (plan.member('box', 'steel', A(ya + 0.15), B(yb - 0.2), KIT.brace, KIT.brace)) n++;
      if (plan.member('box', 'steel', B(ya + 0.15), A(yb - 0.2), KIT.brace, KIT.brace)) n++;
    }
    if (s % 2 === 1) plan.lamp(t.x + t.hx + 0.25, ya + sh * 0.5, t.z, plan.tiers[plan.bandOf(ya + sh * 0.5)]?.level);
  }
  // foot plates
  for (const [cx, cz] of corners) plan.box('concrete', t.x + cx, t.y0 + 0.15, t.z + cz, 0.8, 0.3, 0.8);
  plan.stats.towerMembers += n;
}

// ---------------------------------------------------------------------------------------------------------------------------
// The overhead gantry crane

function planCrane(plan: KitPlan, c: ReactorCrane): void {
  if (!c || !(Math.abs(c.a1 - c.a0) > 2 && Math.abs(c.b1 - c.b0) > 2)) return;
  const ax = c.axis === 'x';
  // (a, b) -> world: a along the axis, b across
  const W = (a: number, y: number, b: number): P3 => (ax ? {x: a, y, z: b} : {x: b, y, z: a});
  const a0 = Math.min(c.a0, c.a1), a1 = Math.max(c.a0, c.a1);
  const bMid = (c.b0 + c.b1) / 2;
  let n = 0;
  const cnt = (r: unknown) => { if (r) n++; };
  // runway girders + rails, on wall corbels every ~6 m (outward = away from the pit centre line)
  for (const b of [c.b0, c.b1]) {
    const out = Math.sign(b - bMid) || 1;
    cnt(plan.member('ibeam', 'steelDark', W(a0, c.railY - 0.75, b), W(a1, c.railY - 0.75, b), 0.55, 1.3));
    cnt(plan.member('box', 'black', W(a0, c.railY - 0.04, b), W(a1, c.railY - 0.04, b), 0.1, 0.12));
    const nk = Math.max(1, Math.round((a1 - a0) / 6));
    for (let k = 0; k <= nk; k++) {
      const a = a0 + ((a1 - a0) * k) / nk;
      const p = W(a, c.railY - 1.9, b + out * 0.45);
      cnt(plan.add('box', 'concrete', boxMatrix(p.x, p.y, p.z, ax ? 0.7 : 1.3, 0.9, ax ? 1.3 : 0.7), plan.bandOf(p.y)));
      // a diagonal strut under the corbel back into the wall
      cnt(plan.member('box', 'steelDark', W(a, c.railY - 1.4, b), W(a, c.railY - 3.6, b + out * 1.1), 0.18, 0.18));
    }
  }
  // the bridge: double box girder (crane yellow) + end trucks
  const ba = c.bridgeAt;
  for (const o of [-0.85, 0.85]) cnt(plan.member('box', 'yellow', W(ba + o, c.railY + 0.95, c.b0 - 0.2), W(ba + o, c.railY + 0.95, c.b1 + 0.2), 0.62, 1.35));
  for (const b of [c.b0, c.b1]) {
    cnt(plan.member('box', 'yellow', W(ba - 2.1, c.railY + 0.32, b), W(ba + 2.1, c.railY + 0.32, b), 0.72, 0.6));
    for (const o of [-1.6, 1.6]) { const p = W(ba + o, c.railY + 0.12, b); cnt(plan.add('cyl', 'black', cylMatrix(W(ba + o, c.railY + 0.12, b - 0.25), W(ba + o, c.railY + 0.12, b + 0.25), 0.42) ?? boxMatrix(p.x, p.y, p.z, 0.4, 0.4, 0.4), plan.bandOf(p.y))); }
  }
  // walkway + handrail along one girder
  cnt(plan.member('box', 'grating', W(ba + 1.55, c.railY + 0.32, c.b0), W(ba + 1.55, c.railY + 0.32, c.b1), 0.75, 0.05));
  cnt(plan.member('box', 'yellow', W(ba + 1.9, c.railY + 1.35, c.b0), W(ba + 1.9, c.railY + 1.35, c.b1), 0.05, 0.05));
  // trolley (GLB 'reactor-crane-trolley' when delivered) on top of the girders
  const tb = c.trolleyAt, ty = c.railY + 1.65;
  const tp = W(ba, ty, tb);
  if (plan.usesModel('crane-trolley')) plan.placeModel('crane-trolley', boxMatrix(tp.x, ty, tp.z, 1, 1, 1, ax ? 0 : Math.PI / 2), plan.bandOf(ty));
  else {
    cnt(plan.add('box', 'yellow', boxMatrix(tp.x, ty + 0.55, tp.z, ax ? 2.4 : 2.6, 1.1, ax ? 2.6 : 2.4), plan.bandOf(ty)));
    cnt(plan.add('cyl', 'steelDark', cylMatrix(W(ba - 1.0, ty + 0.75, tb), W(ba + 1.0, ty + 0.75, tb), 0.9), plan.bandOf(ty))); // hoist drum
    cnt(plan.add('box', 'black', boxMatrix(tp.x, ty + 1.25, tp.z, ax ? 1.2 : 1.0, 0.4, ax ? 1.0 : 1.2), plan.bandOf(ty))); // motor
  }
  // hoist ropes down to the hook block, the block and hook (GLB 'reactor-crane-hook' when delivered)
  const blockTop = c.hookY + 2.0;
  if (ty - blockTop > 0.5) {
    for (const [oa, ob] of [[-0.18, -0.12], [0.18, -0.12], [-0.18, 0.12], [0.18, 0.12]]) cnt(plan.cyl('tube', 'black', W(ba + oa, ty, tb + ob), W(ba + oa * 0.7, blockTop, tb + ob * 0.7), 0.045));
  }
  const hp = W(ba, c.hookY, tb);
  if (plan.usesModel('crane-hook')) plan.placeModel('crane-hook', boxMatrix(hp.x, blockTop, hp.z, 1, 1, 1, ax ? 0 : Math.PI / 2), plan.bandOf(c.hookY));
  else {
    cnt(plan.add('box', 'yellow', boxMatrix(hp.x, c.hookY + 1.45, hp.z, ax ? 0.9 : 0.5, 1.1, ax ? 0.5 : 0.9), plan.bandOf(c.hookY)));
    cnt(plan.add('cyl', 'black', cylMatrix(W(ba, c.hookY + 1.55, tb - 0.3), W(ba, c.hookY + 1.55, tb + 0.3), 0.75), plan.bandOf(c.hookY))); // sheave
    cnt(plan.cyl('cyl', 'steelDark', W(ba, c.hookY + 0.55, tb), W(ba, c.hookY + 0.95, tb), 0.22)); // shank
    const hook = new THREE.TorusGeometry(0.32, 0.08, 6, 12, Math.PI * 1.45);
    hook.rotateZ(Math.PI * 0.78);
    if (!ax) hook.rotateY(Math.PI / 2);
    hook.translate(hp.x, c.hookY + 0.3, hp.z);
    plan.merged.push({mat: 'steelDark', geos: [hook], band: plan.bandOf(c.hookY), name: 'reactor-crane-hook'});
    n++;
  }
  plan.stats.craneParts += n;
}

/** Roof girders across the top of the pit (under roofY) — the cathedral's ceiling structure. */
function planRoof(plan: KitPlan): void {
  const {pit} = plan.info, b = pit.bounds;
  if (!(pit.roofY > pit.rimY + 1.5)) return;
  const y = pit.roofY - 0.55;
  const alongX = b.x1 - b.x0 <= b.z1 - b.z0; // span the short way
  const L0 = alongX ? b.z0 : b.x0, L1 = alongX ? b.z1 : b.x1;
  const n = Math.max(1, Math.round((L1 - L0) / 6));
  for (let k = 1; k < n; k++) {
    const s = L0 + ((L1 - L0) * k) / n;
    const a = alongX ? {x: b.x0, y, z: s} : {x: s, y, z: b.z0}, c = alongX ? {x: b.x1, y, z: s} : {x: s, y, z: b.z1};
    if (plan.member('ibeam', 'steelDark', a, c, 0.4, 1.0)) plan.stats.roofBeams++;
  }
}

// ---------------------------------------------------------------------------------------------------------------------------
// Organ-like pipe banks

function planPipeBank(plan: KitPlan, b: ReactorPipeBank): void {
  const L = Math.hypot(b.x1 - b.x0, b.z1 - b.z0), H = b.y1 - b.y0;
  if (!(L > 1 && H > 2)) return;
  const tx = (b.x1 - b.x0) / L, tz = (b.z1 - b.z0) / L;
  const at = (s: number, off: number, y: number): P3 => ({x: b.x0 + tx * s + b.nx * off, y, z: b.z0 + tz * s + b.nz * off});
  const D = Math.max(0.8, b.depth);
  if (plan.usesModel('pipe-bank')) {
    // stackable 4 m modules (arch.ts fits each to dims): along the wall every 4 m, up every 4 m
    const nu = Math.max(1, Math.round(L / 4)), nv = Math.max(1, Math.round(H / 4));
    const yaw = Math.atan2(b.nx, b.nz);
    for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
      const p = at((i + 0.5) * (L / nu), D / 2, b.y0 + j * (H / nv));
      plan.placeModel('pipe-bank', boxMatrix(p.x, p.y, p.z, L / nu, H / nv, D, yaw), plan.bandOf(p.y + 0.1), [L / nu, H / nv, D]);
    }
  } else {
    // two rows: big pipes against the wall, smaller ones in front (organ pipes of several diameters)
    const rows: {off: number; sizes: number[]}[] = [{off: D * 0.32, sizes: [1.15, 0.9, 1.3, 0.75, 1.0]}, {off: D * 0.74, sizes: [0.42, 0.55, 0.36, 0.62, 0.48]}];
    const cuts = [b.y1, ...plan.tiers.map(t => t.baseY).filter(y => y < b.y1 && y > b.y0), b.y0].sort((p, q) => q - p);
    for (const [ri, row] of rows.entries()) {
      let s = 0.3 + kitHash(ri, plan.seed) * 0.3;
      let k = 0;
      while (s < L - 0.25) {
        const h = kitHash(s, ri, b.x0, b.z0, plan.seed);
        const d = Math.min(row.sizes[k++ % row.sizes.length] * (0.9 + 0.2 * h), D * (ri ? 0.5 : 0.62));
        const c = s + d / 2;
        if (c + d / 2 > L - 0.1) break;
        // organ tops: most run to the top, some stop short with a cap
        const top = h < 0.28 ? b.y1 - 3 - Math.round(h * 30) : b.y1;
        // split at the tier heights (per-band chunks)
        for (let i = 0; i + 1 < cuts.length; i++) {
          const y1 = Math.min(cuts[i], top), y0 = cuts[i + 1];
          if (y1 - y0 < 0.2) continue;
          plan.cyl('cyl', 'pipe', at(c, row.off, y0), at(c, row.off, y1), d);
        }
        plan.stats.pipes++;
        if (top < b.y1) plan.cyl('cyl', 'steelDark', at(c, row.off, top), at(c, row.off, top + 0.35), d * 1.12);
        // flanges every ~3.6 m (staggered per pipe)
        for (let y = b.y0 + 1 + h * KIT.flangePitch; y < top - 0.4; y += KIT.flangePitch) {
          plan.cyl('cyl', 'steelDark', at(c, row.off, y - 0.09), at(c, row.off, y + 0.09), d * 1.24);
          plan.stats.flanges++;
        }
        s += d + 0.12 + h * 0.22;
      }
    }
  }
  // ring catwalks halfway between the tiers (maintenance rings), with brackets, rails and lamps
  const ys: number[] = [];
  for (let i = 0; i + 1 < plan.tiers.length; i++) {
    const y = (plan.tiers[i].baseY + plan.tiers[i + 1].baseY) / 2;
    if (y > b.y0 + 1.5 && y < b.y1 - 1.5) ys.push(y);
  }
  if (!ys.length && H > 8) ys.push(b.y0 + H / 2);
  for (const y of ys) {
    const o0 = D + 0.05, o1 = D + KIT.catwalk;
    plan.member('box', 'grating', at(0, (o0 + o1) / 2, y - 0.03), at(L, (o0 + o1) / 2, y - 0.03), o1 - o0, 0.06);
    plan.member('box', 'steel', at(0, o1, y + 1.05), at(L, o1, y + 1.05), 0.05, 0.05);
    plan.member('box', 'steel', at(0, o1, y + 0.55), at(L, o1, y + 0.55), 0.035, 0.035);
    plan.member('box', 'steel', at(0, o1, y + 0.06), at(L, o1, y + 0.06), 0.012, 0.12);
    const np = Math.max(1, Math.round(L / 1.5));
    for (let k = 0; k <= np; k++) {
      const s = (L * k) / np;
      plan.member('box', 'steel', at(s, o1, y), at(s, o1, y + 1.05), 0.05, 0.05);
      if (k % 2 === 0) plan.member('box', 'steelDark', at(s, o1 - 0.1, y - 0.08), at(s, D * 0.2, y - 1.1), 0.1, 0.1);
    }
    for (let s = 2; s < L - 1; s += 4.5) plan.lamp(at(s, o1 + 0.1, y + 1.3).x, y + 1.3, at(s, o1 + 0.1, y).z);
    plan.stats.catwalks++;
  }
}

// ---------------------------------------------------------------------------------------------------------------------------
// Extraction fans (duct housing in the wall; one instanced rotor per fan, spun by the visuals)

function planFan(plan: KitPlan, f: ReactorFan): void {
  const R = Math.max(0.4, f.radius);
  const nl = Math.hypot(f.nx, f.nz) || 1, nx = f.nx / nl, nz = f.nz / nl;
  const hub = new THREE.Vector3(f.x, f.y, f.z);
  const P = (o: number, dy = 0): P3 => ({x: f.x + nx * o, y: f.y + dy, z: f.z + nz * o});
  // duct + dark back disc + square frame plate + motor hub + guard ring
  plan.cyl('tube', 'steelDark', P(-0.7), P(0.35), R * 2.16);
  plan.cyl('cyl', 'black', P(-0.62), P(-0.56), R * 2.1);
  const yaw = Math.atan2(nx, nz);
  const fw = R * 2 + 0.7;
  for (const [lx, ly, sx, sy] of [[0, R + 0.2, fw, 0.4], [0, -R - 0.2, fw, 0.4], [R + 0.2, 0, 0.4, fw], [-R - 0.2, 0, 0.4, fw]] as const) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    plan.add('box', 'steelDark', boxMatrix(f.x + lx * c + nx * 0.05, f.y + ly, f.z - lx * s + nz * 0.05, sx, sy, 0.16, yaw), plan.bandOf(f.y - R));
  }
  plan.cyl('cyl', 'machine', P(-0.4), P(0.05), R * 0.42);
  plan.cyl('tube', 'black', P(0.42), P(0.48), R * 2.12);
  // hazard ring label: a yellow band below the housing
  plan.add('box', 'yellow', boxMatrix(f.x + nx * 0.1, f.y - R - 0.62, f.z + nz * 0.1, fw * 0.8, 0.16, 0.05, yaw), plan.bandOf(f.y - R - 0.7));
  // rotor basis: local Z = the outward normal, Y up
  _z.set(nx, 0, nz); _y.set(0, 1, 0); _x.crossVectors(_y, _z);
  const basis = new THREE.Matrix4().makeBasis(_x.clone(), _y.clone(), _z.clone());
  basis.setPosition(f.x + nx * 0.12, f.y, f.z + nz * 0.12);
  plan.fans.push({id: f.id, zone: f.zone, level: f.level, hub, basis, radius: R});
  plan.stats.fans++;
}

// ---------------------------------------------------------------------------------------------------------------------------
// Auxiliary generators (procedural block now; 'reactor-aux-generator' GLB later)

function planGenerator(plan: KitPlan, g: ReactorGenerator): void {
  const {w, d, h} = g.size;
  if (!(w > 0.5 && d > 0.3 && h > 0.5)) return;
  const o = {x: g.x, y: g.y, z: g.z}, yaw = g.yaw;
  const band = plan.bandOf(g.y + 0.1);
  const body: KitRef[] = [];
  const push = (r: KitRef | null) => { if (r) body.push(r); };
  const place = localBox(o, yaw, 0, 0, 0, 1, 1, 1);
  if (plan.usesModel('aux-generator')) plan.placeModel('aux-generator', place, band, [w, h, d]);
  else {
    plan.add('box', 'steelDark', localBox(o, yaw, 0, 0.12, 0, w, 0.24, d), band); // skid
    push(plan.add('box', 'machine', localBox(o, yaw, -w * 0.1, 0.24 + h * 0.27, 0, w * 0.46, h * 0.54, d * 0.72), band)); // engine block
    push(plan.add('box', 'steelDark', localBox(o, yaw, -w * 0.1, 0.24 + h * 0.6, 0, w * 0.42, h * 0.12, d * 0.5), band)); // rocker covers
    const altD = Math.min(d * 0.78, h * 0.62);
    push(plan.add('cyl', 'machine', cylMatrix(localPt(o, yaw, w * 0.16, 0.3 + altD / 2, 0), localPt(o, yaw, w * 0.44, 0.3 + altD / 2, 0), altD), band)); // alternator
    plan.add('box', 'steelDark', localBox(o, yaw, -w * 0.44, 0.24 + h * 0.38, 0, w * 0.1, h * 0.76, d * 0.92), band); // radiator
    plan.add('box', 'black', localBox(o, yaw, -w * 0.385, 0.24 + h * 0.38, 0, 0.02, h * 0.66, d * 0.8), band); // radiator grille
    push(plan.add('tube', 'pipe', cylMatrix(localPt(o, yaw, w * 0.05, 0.24 + h * 0.66, -d * 0.2), localPt(o, yaw, w * 0.05, 0.24 + h * 1.25, -d * 0.2), 0.24), band)); // exhaust stack
    plan.add('box', 'machine', localBox(o, yaw, w * 0.38, 0.24 + h * 0.75, 0, w * 0.16, h * 0.3, d * 0.5), band); // terminal box
  }
  // control box at the panel (faces the start pose), two lamps (red = off, green = running)
  const px = g.panel.x, py = g.panel.y, pz = g.panel.z;
  let fx = g.use.x - px, fz = g.use.z - pz;
  const fl = Math.hypot(fx, fz) || 1; fx /= fl; fz /= fl;
  const pyaw = Math.atan2(fx, fz);
  plan.add('box', 'machine', boxMatrix(px - fx * 0.12, py, pz - fz * 0.12, 0.62, 0.78, 0.26, pyaw), band);
  plan.add('box', 'yellow', boxMatrix(px + fx * 0.02, py - 0.24, pz + fz * 0.02, 0.12, 0.2, 0.06, pyaw), band); // start lever
  const c = Math.cos(pyaw), s = Math.sin(pyaw);
  const lamp = (lx: number, color: number): KitRef => plan.add('bulb', 'panelLamp', boxMatrix(px + lx * c + fx * 0.03, py + 0.24, pz - lx * s + fz * 0.03, 0.08, 0.08, 0.08), band, color)!;
  const lamps: [KitRef, KitRef] = [lamp(-0.14, 0xff3020), lamp(0.14, 0x103010)];
  plan.generators.push({id: g.id, zone: g.zone, level: g.level, body, lamps, place, size: {w, d, h}});
  plan.stats.generators++;
  // cable run to the zone's fans: a tray + three cables along the polyline
  for (let i = 0; i + 1 < g.cable.length; i++) {
    const a = g.cable[i], b = g.cable[i + 1];
    plan.member('box', 'steelDark', {x: a.x, y: a.y - 0.05, z: a.z}, {x: b.x, y: b.y - 0.05, z: b.z}, 0.32, 0.05);
    for (const off of [-0.09, 0, 0.09]) {
      const dx = b.x - a.x, dz = b.z - a.z, dl = Math.hypot(dx, dz) || 1, ox = -dz / dl * off, oz = dx / dl * off;
      plan.cyl('tube', 'cable', {x: a.x + ox, y: a.y + 0.02, z: a.z + oz}, {x: b.x + ox, y: b.y + 0.02, z: b.z + oz}, 0.055);
    }
    plan.stats.cables++;
  }
}

// ---------------------------------------------------------------------------------------------------------------------------
// The reactor vessel (procedural now; 'reactor-vessel' GLB later) — dome, flange, CRDM housings, nozzles, ring gantries, glow

export function vesselDims(c: ReactorCore): {rv: number; plinthH: number; yd: number; domeH: number} {
  const rv = Math.max(1, c.radius * 0.78), plinthH = 0.8;
  const H = Math.max(3, c.y1 - c.y0);
  const domeH = Math.min(rv * 0.58, H * 0.35);
  return {rv, plinthH, yd: c.y1 - domeH, domeH};
}

function planVessel(plan: KitPlan, c: ReactorCore): void {
  if (!(c.radius > 0.5 && c.y1 > c.y0 + 2)) return;
  const {rv, plinthH, yd, domeH} = vesselDims(c);
  const band = plan.bandOf(c.y0 + 0.1);
  const steel: THREE.BufferGeometry[] = [], vessel: THREE.BufferGeometry[] = [], glow: THREE.BufferGeometry[] = [], grate: THREE.BufferGeometry[] = [];
  const T = (g: THREE.BufferGeometry, y: number) => { g.translate(c.x, y, c.z); return g; };
  // plinth (stepped) + a glowing slot ring on top of it
  steel.push(T(new THREE.CylinderGeometry(c.radius, c.radius * 1.03, plinthH, 40, 1, false), c.y0 + plinthH / 2));
  glow.push(T(new THREE.CylinderGeometry(rv * 1.05, rv * 1.05, 0.14, 40, 1, true), c.y0 + plinthH + 0.07));
  if (!plan.usesModel('vessel')) {
    const bodyH = yd - (c.y0 + plinthH);
    vessel.push(T(new THREE.CylinderGeometry(rv, rv * 1.02, bodyH, 40, 1, true), c.y0 + plinthH + bodyH / 2));
    const dome = new THREE.SphereGeometry(rv, 40, 12, 0, Math.PI * 2, 0, Math.PI / 2);
    dome.scale(1, domeH / rv, 1);
    vessel.push(T(dome, yd));
    // flange ring at the dome joint + a lower ring
    steel.push(T(new THREE.CylinderGeometry(rv * 1.09, rv * 1.09, 0.5, 40, 1, false), yd));
    steel.push(T(new THREE.CylinderGeometry(rv * 1.05, rv * 1.05, 0.32, 40, 1, false), c.y0 + plinthH + bodyH * 0.35));
    // glowing viewport slits round the body (faint when dormant)
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2;
      const g = new THREE.BoxGeometry(0.2, Math.min(1.8, bodyH * 0.3), 0.08);
      g.translate(0, 0, rv + 0.03); g.rotateY(a);
      glow.push(T(g, c.y0 + plinthH + bodyH * 0.6));
    }
    // flange bolts (instanced tubes) round the dome joint
    for (let k = 0; k < 32; k++) {
      const a = (k / 32) * Math.PI * 2, x = c.x + Math.cos(a) * rv * 1.04, z = c.z + Math.sin(a) * rv * 1.04;
      plan.add('tube', 'steelDark', cylMatrix({x, y: yd + 0.25, z}, {x, y: yd + 0.55, z}, 0.12), band);
    }
    // control-rod drive housings on the dome (hex grid inside 0.55 rv), tall thin tubes with caps
    const sp = Math.max(0.7, rv * 0.18);
    for (let i = -6; i <= 6; i++) for (let j = -6; j <= 6; j++) {
      const x = (i + (j % 2 ? 0.5 : 0)) * sp, z = j * sp * 0.866;
      const r = Math.hypot(x, z);
      if (r > rv * 0.55) continue;
      const base = yd + domeH * Math.sqrt(Math.max(0, 1 - (r / rv) ** 2));
      const top = c.y1 + 1.6 + kitHash(i, j, plan.seed) * 0.6;
      plan.add('tube', 'pipe', cylMatrix({x: c.x + x, y: base - 0.1, z: c.z + z}, {x: c.x + x, y: top, z: c.z + z}, 0.2), band);
      plan.add('cyl', 'steelDark', cylMatrix({x: c.x + x, y: top, z: c.z + z}, {x: c.x + x, y: top + 0.3, z: c.z + z}, 0.3), band);
      plan.stats.crdm++;
    }
    // nozzle stubs (radial, with flanges)
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + Math.PI / 4, dx = Math.cos(a), dz = Math.sin(a), y = c.y0 + plinthH + bodyH * 0.72;
      plan.add('cyl', 'vessel', cylMatrix({x: c.x + dx * rv * 0.9, y, z: c.z + dz * rv * 0.9}, {x: c.x + dx * (rv + 1.5), y, z: c.z + dz * (rv + 1.5)}, 0.9), band);
      plan.add('cyl', 'steelDark', cylMatrix({x: c.x + dx * (rv + 1.45), y, z: c.z + dz * (rv + 1.45)}, {x: c.x + dx * (rv + 1.7), y, z: c.z + dz * (rv + 1.7)}, 1.3), band);
    }
    plan.stats.vesselParts += 6;
  } else {
    plan.placeModel('vessel', boxMatrix(c.x, c.y0 + plinthH, c.z, 1, 1, 1), band, [rv * 2, c.y1 - c.y0 - plinthH, rv * 2]);
  }
  // ring gantries (above head height on the core floor), with brackets, rails, posts, lamps
  const rings = [c.y0 + 3.4, yd - 0.9].filter((y, i, a) => i === 0 || y > a[0] + 2.6);
  for (const y of rings) {
    const r0 = rv + 0.25, r1 = rv + 1.45;
    const prof = [new THREE.Vector2(r0, -0.06), new THREE.Vector2(r1, -0.06), new THREE.Vector2(r1, 0.06), new THREE.Vector2(r0, 0.06), new THREE.Vector2(r0, -0.06)];
    grate.push(T(new THREE.LatheGeometry(prof, 48), y));
    steel.push(T(new THREE.TorusGeometry(r1, 0.035, 4, 48).rotateX(Math.PI / 2), y + 1.05));
    steel.push(T(new THREE.TorusGeometry(r1, 0.025, 4, 48).rotateX(Math.PI / 2), y + 0.55));
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
      plan.add('box', 'steel', memberMatrix({x: c.x + ca * r1, y, z: c.z + sa * r1}, {x: c.x + ca * r1, y: y + 1.05, z: c.z + sa * r1}, 0.05, 0.05), band);
      if (k % 2 === 0) plan.add('box', 'steelDark', memberMatrix({x: c.x + ca * r1 * 0.98, y: y - 0.08, z: c.z + sa * r1 * 0.98}, {x: c.x + ca * rv, y: y - 1.1, z: c.z + sa * rv}, 0.12, 0.12), band);
      if (k % 6 === 3) plan.lamp(c.x + ca * (r1 + 0.1), y + 1.3, c.z + sa * (r1 + 0.1));
    }
    plan.stats.gantries++;
  }
  plan.merged.push({mat: 'steelDark', geos: steel, band, name: 'reactor-vessel-steel'});
  if (vessel.length) plan.merged.push({mat: 'vessel', geos: vessel, band, name: 'reactor-vessel-body'});
  plan.merged.push({mat: 'glow', geos: glow, band, name: 'reactor-vessel-glow'});
  plan.merged.push({mat: 'grating', geos: grate, band, name: 'reactor-vessel-gantries'});
}

// ---------------------------------------------------------------------------------------------------------------------------
// Restart sites: switchgear / pump / valve / console fixtures (procedural now; GLBs later), screen frames

/** The machine piece of a control id ('fuse-0' / 'breaker' -> switchgear, 'pump', 'valve', 'rods' / 'keyswitch' -> console). */
export function pieceOfControl(id: string): ReactorPiece | null {
  if (/^(fuse|breaker|switch)/.test(id)) return 'switchgear';
  if (/^pump/.test(id)) return 'coolant-pump';
  if (/^valve/.test(id)) return 'valve';
  if (/^(rods|keyswitch|console)/.test(id)) return 'control-console';
  return null;
}

function planSite(plan: KitPlan, site: ReactorSite): void {
  const floorY = plan.info.tiers.find(t => t.level === site.level)?.baseY;
  for (const ctl of site.controls) {
    const piece = pieceOfControl(ctl.id);
    if (!piece) continue;
    let fx = ctl.at.x - ctl.stand.x, fz = ctl.at.z - ctl.stand.z;
    const fl = Math.hypot(fx, fz);
    if (fl < 0.05) { fx = -Math.sin(ctl.yaw); fz = -Math.cos(ctl.yaw); } else { fx /= fl; fz /= fl; }
    // the machine stands behind the control point (away from the stand), its front facing the player
    const yaw = Math.atan2(-fx, -fz);
    const fy = floorY !== undefined && ctl.at.y - floorY < 2.5 && ctl.at.y >= floorY ? floorY : ctl.at.y - 1.1;
    const dims = {switchgear: [0.8, 2.1, 0.6], 'coolant-pump': [1.8, 1.3, 1.1], valve: [0.9, 1.6, 0.6], 'control-console': [1.6, 1.15, 0.85]}[piece as 'switchgear'];
    const [w, h, d] = dims;
    const cx = ctl.at.x + fx * (d / 2 + 0.02), cz = ctl.at.z + fz * (d / 2 + 0.02);
    const band = plan.bandOf(fy + 0.1);
    if (plan.usesModel(piece)) { plan.placeModel(piece, boxMatrix(cx, fy, cz, 1, 1, 1, yaw), band, [w, h, d]); plan.stats.machines++; continue; }
    const o = {x: cx, y: fy, z: cz};
    if (piece === 'switchgear') {
      plan.add('box', 'machine', localBox(o, yaw, 0, h / 2, 0, w, h, d), band);
      plan.add('box', 'steelDark', localBox(o, yaw, 0, h - 0.05, 0, w + 0.04, 0.1, d + 0.04), band);
      plan.add('box', 'black', localBox(o, yaw, 0, ctl.at.y - fy, d / 2 + 0.005, w * 0.6, 0.34, 0.02), band); // fuse / breaker panel
      plan.add('box', 'yellow', localBox(o, yaw, w * 0.3, h * 0.82, d / 2 + 0.006, 0.18, 0.12, 0.012), band); // warning plate
    } else if (piece === 'coolant-pump') {
      plan.add('box', 'steelDark', localBox(o, yaw, 0, 0.1, 0, w, 0.2, d), band);
      plan.add('cyl', 'machine', cylMatrix(localPt(o, yaw, -w * 0.45, 0.2 + d * 0.38, 0), localPt(o, yaw, 0.05, 0.2 + d * 0.38, 0), d * 0.76), band); // motor
      plan.add('cyl', 'pipe', cylMatrix(localPt(o, yaw, 0.15, 0.2 + h * 0.4, -d * 0.4), localPt(o, yaw, 0.15, 0.2 + h * 0.4, d * 0.4), h * 0.62), band); // volute
      plan.add('tube', 'pipe', cylMatrix(localPt(o, yaw, 0.6, 0.2 + h * 0.4, 0), localPt(o, yaw, 0.6, h + 1.4, 0), 0.32), band); // discharge riser
    } else if (piece === 'valve') {
      plan.add('tube', 'pipe', cylMatrix(localPt(o, yaw, 0, 0, -d * 0.2), localPt(o, yaw, 0, h, -d * 0.2), 0.36), band);
      plan.add('cyl', 'steelDark', cylMatrix(localPt(o, yaw, 0, ctl.at.y - fy - 0.2, -d * 0.2), localPt(o, yaw, 0, ctl.at.y - fy + 0.15, -d * 0.2), 0.55), band); // valve body
      plan.add('tube', 'steelDark', cylMatrix(localPt(o, yaw, 0, ctl.at.y - fy, -d * 0.2), localPt(o, yaw, 0, ctl.at.y - fy, d * 0.42), 0.06), band); // stem
      plan.add('wheel', 'yellow', localBox(o, yaw, 0, ctl.at.y - fy, d * 0.42, 0.62, 0.62, 0.62), band); // handwheel (faces the player)
    } else {
      plan.add('box', 'machine', localBox(o, yaw, 0, 0.42, -0.05, w, 0.84, d * 0.8), band);
      const m = localBox(o, yaw, 0, 0.92, 0.05, w, 0.12, d * 0.72);
      m.multiply(new THREE.Matrix4().makeRotationX(-0.35));
      plan.add('box', 'steelDark', m, band); // sloped desk
      plan.add('box', 'black', localBox(o, yaw, 0, 1.25, -d * 0.36, w * 0.9, 0.5, 0.08), band); // instrument hood
    }
    plan.stats.machines++;
  }
}

function planScreen(plan: KitPlan, s: ReactorScreen): void {
  if (!(s.w > 0.1 && s.h > 0.1)) return;
  // face normal = the yaw's camera forward (-sin, -cos); the frame is symmetric about the face plane (the content is lane RESTART's)
  const nx = -Math.sin(s.yaw), nz = -Math.cos(s.yaw), yaw = Math.atan2(nx, nz);
  const band = plan.bandOf(s.y - s.h / 2);
  const t = 0.07, w = s.w + 2 * t, h = s.h + 2 * t;
  const c = Math.cos(yaw), sn = Math.sin(yaw);
  for (const [lx, ly, sx, sy] of [[0, (s.h + t) / 2, w, t], [0, -(s.h + t) / 2, w, t], [(s.w + t) / 2, 0, t, h], [-(s.w + t) / 2, 0, t, h]] as const)
    plan.add('box', 'steelDark', boxMatrix(s.x + lx * c, s.y + ly, s.z - lx * sn, sx, sy, 0.1, yaw), band);
  // hood over the screen
  plan.add('box', 'steelDark', boxMatrix(s.x + nx * 0.12, s.y + h / 2 + 0.04, s.z + nz * 0.12, w + 0.1, 0.05, 0.3, yaw), band);
  plan.stats.screens++;
}

// ---------------------------------------------------------------------------------------------------------------------------
// Railings (the level's collision rails ARCH owns): rusted steel top / mid rail, toe board or stringer, posts

function planRails(plan: KitPlan, rails: readonly RailRun[]): void {
  for (const r of rails) {
    const len = Math.hypot(r.x1 - r.x0, r.z1 - r.z0);
    if (len < 0.05) continue;
    const H = r.h ?? 1.05;
    const P = (s: number, dy: number): P3 => { const u = s / len; return {x: r.x0 + (r.x1 - r.x0) * u, y: r.y0 + (r.y1 - r.y0) * u + dy, z: r.z0 + (r.z1 - r.z0) * u}; };
    const sloped = Math.abs(r.y1 - r.y0) > 1e-3;
    let n = 0;
    if (plan.member('box', 'steel', P(0, H), P(len, H), 0.05, 0.05)) n++;
    if (plan.member('box', 'steel', P(0, 0.55), P(len, 0.55), 0.035, 0.035)) n++;
    if (!sloped) { if (plan.member('box', 'steelDark', P(0.02, 0.06), P(len - 0.02, 0.06), 0.015, 0.11)) n++; }
    else if (plan.member('box', 'steelDark', P(0, -0.04), P(len, -0.04), 0.06, 0.32)) n++;
    const np = Math.max(1, Math.ceil(len / 1.25));
    for (let k = 0; k <= np; k++) {
      const s = Math.min(len - 0.03, Math.max(0.03, (len * k) / np));
      const b = P(s, 0);
      if (plan.member('box', 'steel', b, {x: b.x, y: b.y + H, z: b.z}, 0.05, 0.05)) n++;
    }
    plan.stats.railRuns++;
    plan.stats.railMembers += n;
  }
}
