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
import {REACTOR_MODELS, type ReactorPiece} from './archAssets';

/** Unit geometries of the kit (archMeshes.ts kitGeometry). */
export type KitGeo = 'box' | 'ibeam' | 'cyl' | 'tube' | 'stripe' | 'plane' | 'bulb' | 'cage' | 'blade' | 'wheel';
/** Shared kit materials (archMaterials.ts reactorDress). 'bulb' is per tier (see KitPlan.bulbs). */
export type KitMat = 'steel' | 'steelDark' | 'yellow' | 'black' | 'pipe' | 'machine' | 'grating' | 'band' | 'vessel' | 'glow' | 'panelLamp' | 'cable' | 'concrete' | 'marker';

/** One instance: its matrix and depth band (index into KitPlan.tiers, top-down); optional per-instance colour (0xRRGGBB). */
export interface KitInst { m: THREE.Matrix4; band: number; color?: number; tag?: string } // task reactor-expansion-20261101 (lane PATHS): + tag (audit kind)
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
  /** Placement (the model's, when the 'generator' model is used: its index in modelPlacements.get('generator'), else -1). */
  place: THREE.Matrix4;
  size: {w: number; d: number; h: number};
  modelIndex: number;
}
/** A lamp's emissive part (procedural bulb in a cage, or the lens overlay of a flood-lamp model): per-tier material (setTierPower). */
export interface KitLamp { band: number; level: number; m: THREE.Matrix4; dead: boolean; tint: number; model: boolean; tag?: string } // task reactor-expansion-20261101 (lane PATHS): + tag

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

const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3();
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
  /**
   * Task reactor-expansion-20261101 (lane GASLIGHT): the layout's pit fixtures are MOUNTED lamps (gen/reactor/gaslightLamps.ts) drawn by
   * world/reactor/gaslightFixtures.ts planMountedLamps — then the kit plans NO decorative lamps of its own (their per-tier lens glowed
   * orange and lit nothing: the user's "orange circle … but no light").
   */
  fixtures?: boolean;
  /** Task reactor-expansion-20261101 (lane PATHS): the walkable body volume (world/reactor/pathsAudit.ts WalkVolume): planners keep
   *  their steel out of it (braces re-routed / shortened, members skipped or flattened over walkways, tower portals). */
  walk?: KitWalk;
}

/** Task reactor-expansion-20261101 (lane PATHS): what the planners ask of the walkable body volume (pathsAudit.ts implements it). */
export interface KitWalk {
  /** A unit-geometry instance (matrix m, local box lo..hi, default the unit cube) would stand in walkable space. */
  intrudes(m: THREE.Matrix4, lo?: readonly number[], hi?: readonly number[]): boolean;
  /** Walkable body bands [y0, y1] (merged) whose footprint touches the world rect. */
  bandsIn(x0: number, z0: number, x1: number, z1: number): {y0: number; y1: number}[];
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
  readonly modelPlacements = new Map<ReactorPiece, {m: THREE.Matrix4; band: number; size?: readonly [number, number, number]; tag?: string}[]>();
  readonly stats: KitStats = {
    decks: 0, decksSupported: 0, deckBeams: 0, braces: 0, trusses: 0, stripes: 0, toePlates: 0, towers: 0, towerMembers: 0, craneParts: 0,
    pipes: 0, flanges: 0, catwalks: 0, fans: 0, generators: 0, vesselParts: 0, crdm: 0, gantries: 0, machines: 0, screens: 0, cables: 0,
    bands: 0, markerLabels: 0, ribs: 0, lamps: 0, railRuns: 0, railMembers: 0, roofBeams: 0,
  };
  /** Tiers top-down (baseY descending): bands are indices into this. */
  readonly tiers: readonly {level: number; baseY: number; index: number}[];
  readonly seed: number;
  /** Task reactor-expansion-20261101 (lane PATHS): the planner tag stamped on every instance / lamp / model placement added while it is
   *  set (world/reactor/pathsAudit.ts reports intrusions by it); planReactorKit's steps set it to their name. */
  tag = '';

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
    const inst: KitInst = color === undefined ? {m, band} : {m, band, color};
    if (this.tag) inst.tag = this.tag; // task reactor-expansion-20261101 (lane PATHS)
    p.list.push(inst);
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
  /**
   * A caged industrial lamp MOUNTED at (x, y, z) on whatever lies behind it (wall, post, pipe bank), its head out along `n`: the
   * flood-lamp model when `model` (pit walls, catwalks, gantries — up to its cap; callers go top-down), else a cheap cage + bulb.
   */
  lamp(x: number, y: number, z: number, n: {x: number; z: number}, level?: number, model = false): void {
    if (this.opts.fixtures) return; // task reactor-expansion-20261101 (lane GASLIGHT): every pit lamp is a mounted fixture (KitOptions.fixtures)
    if (this.lamps.length >= KIT.maxLamps) return;
    const band = this.bandOf(y);
    const lv = level ?? this.tiers[band]?.level ?? 0;
    const h = kitHash(x, y, z, this.seed);
    const dead = h < 0.1, tint = 0.82 + 0.18 * kitHash(z, x, 3);
    const nl = Math.hypot(n.x, n.z) || 1, nx = n.x / nl, nz = n.z / nl, yaw = Math.atan2(nx, nz); // local +Z -> n
    // task reactor-expansion-20261101 (lane PATHS): a lamp whose head would hang in walkable space (over a stair flight passing the
    // wall, a walkway beyond a deck edge) is not mounted there
    if (this.opts.walk && !this.clear(boxMatrix(x + nx * 0.17, y, z + nz * 0.17, 0.4, 0.5, 0.4, yaw))) return;
    if (model && this.canModel('floodLamp')) {
      const A = REACTOR_MODELS.floodLamp.anchors!, plate = A.plate as readonly number[], lens = A.lens as readonly number[];
      // model origin: its wall plate (local z = plate[2] < 0, centre height plate[1]) on the mount point
      const ox = x - nx * plate[2], oz = z - nz * plate[2], oy = y - plate[1];
      this.placeModel('floodLamp', boxMatrix(ox, oy, oz, 1, 1, 1, yaw), band);
      const d = lens[2] + 0.008;
      this.lamps.push({band, level: lv, m: boxMatrix(ox + nx * d, oy + lens[1], oz + nz * d, A.lensW as number, A.lensH as number, 0.03, yaw), dead, tint, model: true, ...(this.tag ? {tag: this.tag} : {})});
    } else {
      const cx = x + nx * 0.17, cz = z + nz * 0.17;
      this.member('box', 'steelDark', {x, y: y + 0.12, z}, {x: cx, y: y + 0.12, z: cz}, 0.05, 0.05); // bracket arm
      this.lamps.push({band, level: lv, m: boxMatrix(cx, y, cz, 0.2, 0.26, 0.2, yaw), dead, tint, model: false, ...(this.tag ? {tag: this.tag} : {})});
      this.add('cage', 'steelDark', boxMatrix(cx, y, cz, 0.26, 0.34, 0.26, yaw), band);
    }
    this.stats.lamps++;
  }
  placeModel(piece: ReactorPiece, m: THREE.Matrix4, band: number, size?: readonly [number, number, number]): void {
    let l = this.modelPlacements.get(piece);
    if (!l) this.modelPlacements.set(piece, (l = []));
    l.push(size ? {m, band, size} : {m, band});
    if (this.tag) l[l.length - 1].tag = this.tag; // task reactor-expansion-20261101 (lane PATHS)
  }
  /** Task reactor-expansion-20261101 (lane PATHS): the walkable body volume, when the builder gave one. */
  get walk(): KitWalk | undefined { return this.opts.walk; }
  /** Task reactor-expansion-20261101 (lane PATHS): an instance (matrix m, local box lo..hi) stays out of the walkable body volume
   *  (always, without one). */
  clear(m: THREE.Matrix4 | null, lo?: readonly number[], hi?: readonly number[]): boolean {
    return !!m && (!this.opts.walk || !this.opts.walk.intrudes(m, lo, hi));
  }
  /** Task reactor-expansion-20261101 (lane PATHS): `member`, only when it stays out of the walkable body volume. */
  memberClear(geo: 'box' | 'ibeam', mat: KitMat, a: P3, b: P3, w: number, h: number, up?: THREE.Vector3): KitRef | null {
    const m = memberMatrix(a, b, w, h, up);
    return m && this.clear(m) ? this.add(geo, mat, m, this.bandOf(Math.min(a.y, b.y) + 0.05)) : null;
  }
  private railIndex: Map<number, RailRun[]> | null = null;
  /** Task reactor-expansion-20261101 (lane PATHS): the plan knows the level's railings (KitOptions.rails). */
  get hasRails(): boolean { return !!this.opts.rails; }
  /**
   * Task reactor-expansion-20261101 (lane PATHS): a railing (KitOptions.rails) stands on the line through (x, z) at base height ~y —
   * deck-edge toe plates and post lamps belong to railed edges only. True when the plan has no rails (fixtures).
   */
  railed(x: number, z: number, y: number): boolean {
    const rails = this.opts.rails;
    if (!rails) return true;
    const key = (cx: number, cz: number) => cx * 65536 + cz;
    if (!this.railIndex) {
      this.railIndex = new Map();
      for (const r of rails) {
        for (let cx = Math.floor((Math.min(r.x0, r.x1) - 0.2) / 0.5); cx <= Math.floor((Math.max(r.x0, r.x1) + 0.2) / 0.5); cx++) {
          for (let cz = Math.floor((Math.min(r.z0, r.z1) - 0.2) / 0.5); cz <= Math.floor((Math.max(r.z0, r.z1) + 0.2) / 0.5); cz++) {
            let l = this.railIndex.get(key(cx, cz));
            if (!l) this.railIndex.set(key(cx, cz), (l = []));
            l.push(r);
          }
        }
      }
    }
    for (const r of this.railIndex.get(key(Math.floor(x / 0.5), Math.floor(z / 0.5))) ?? []) {
      const ex = r.x1 - r.x0, ez = r.z1 - r.z0, L2 = ex * ex + ez * ez || 1;
      const t = Math.max(0, Math.min(1, ((x - r.x0) * ex + (z - r.z0) * ez) / L2));
      if (Math.hypot(r.x0 + ex * t - x, r.z0 + ez * t - z) < 0.12 && Math.abs(r.y0 + (r.y1 - r.y0) * t - y) < 0.35) return true;
    }
    return false;
  }
  /** The piece's model is loaded (arch.ts: KitOptions.models). */
  usesModel(piece: ReactorPiece): boolean { return !!this.opts.models?.has(piece); }
  /** The model is loaded and its per-level cap (REACTOR_MODELS[piece].cap) is not reached yet. */
  canModel(piece: ReactorPiece, more = 1): boolean {
    return this.usesModel(piece) && (this.modelPlacements.get(piece)?.length ?? 0) + more <= REACTOR_MODELS[piece].cap;
  }

  /** Total instances over every part. */
  get instanceCount(): number { let n = 0; for (const p of this.parts.values()) n += p.list.length; return n + this.lamps.length; }
}

/** Builds the whole kit plan of a Reactor (decks, towers, crane, pipe banks, fans, generators, vessel, sites, screens, cables, bands). */
export function planReactorKit(info: ReactorInfo, opts: KitOptions = {}): KitPlan {
  const plan = new KitPlan(info, opts);
  const step = (fn: () => void, what: string) => { plan.tag = what; try { fn(); } catch (e) { console.warn(`reactor kit: ${what} skipped`, e); } plan.tag = ''; }; // lane PATHS: + tag
  step(() => planWallRibs(plan), 'wall ribs');
  step(() => planMarkers(plan), 'markers');
  step(() => planWallLamps(plan), 'wall lamps'); // first: the flood-lamp model's cap goes to the pit walls, top tier down
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
      // task reactor-expansion-20261101 (lane PATHS): where a walkway runs along the wall here (a gallery, a stair flight, a doorway)
      // the pilaster is a flat strap flush on the wall (4 cm) instead of the 0.38 m deep I-beam the body would walk through
      const hx = Math.abs(tx) * 0.21 + Math.abs(e.nx) * 0.19, hz = Math.abs(tz) * 0.21 + Math.abs(e.nz) * 0.19;
      const bands = plan.walk ? plan.walk.bandsIn(x - hx, z - hz, x + hx, z + hz) : [];
      // a DOORWAY in the wall here (walkable cells behind the wall line: a platform opening, a room door): no pilaster across it up to
      // its lintel (the opening's floor + 2.45 m)
      const bx = x - e.nx * 0.33, bz = z - e.nz * 0.33, dh = {x: Math.abs(tx) * 0.32 + Math.abs(e.nx) * 0.1, z: Math.abs(tz) * 0.32 + Math.abs(e.nz) * 0.1}; // (+ the jamb's edge tolerance)
      const doors = plan.walk ? plan.walk.bandsIn(bx - dh.x, bz - dh.z, bx + dh.x, bz + dh.z) : [];
      const wx = x - e.nx * 0.165, wz = z - e.nz * 0.165; // the strap: 0.02 .. 0.05 m off the wall
      for (let i = 0; i + 1 < cuts.length; i++) {
        const y0 = cuts[i + 1], y1 = cuts[i];
        if (y1 - y0 < 0.3) continue;
        // pieces: 0 = the I-beam, 1 = the flat strap, 2 = nothing (a doorway)
        let pieces: [number, number, number][] = [[y0, y1, 0]];
        const cut = (c0: number, c1: number, kind: number) => {
          const next: [number, number, number][] = [];
          for (const [p, q, k] of pieces) {
            if (k >= kind || c1 <= p || c0 >= q) { next.push([p, q, k]); continue; }
            if (c0 > p) next.push([p, c0, k]);
            next.push([Math.max(p, c0), Math.min(q, c1), kind]);
            if (c1 < q) next.push([c1, q, k]);
          }
          pieces = next;
        };
        for (const b of doors) cut(b.y0 - 0.05, b.y0 + 2.45, 2);
        for (const b of bands) cut(b.y0 - 0.05, b.y1 + 0.1, 1);
        for (const [p, q, kind] of pieces) {
          if (q - p < 0.05 || kind === 2) continue;
          const flat = kind === 1;
          plan.tag = flat ? 'wall-strap' : 'wall ribs';
          const m = flat ? memberMatrix({x: wx, y: p, z: wz}, {x: wx, y: q, z: wz}, 0.42, 0.03, up) : memberMatrix({x, y: p, z}, {x, y: q, z}, 0.42, 0.36, up);
          plan.add(flat ? 'box' : 'ibeam', 'steelDark', m, plan.bandOf(p + 0.05));
        }
        plan.stats.ribs++;
      }
      plan.tag = 'wall ribs';
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
        // on the wall face (flood-lamp model while its cap lasts: tiers are visited top-down)
        plan.lamp(e.a.x + tx * s + e.nx * 0.02, y, e.a.z + tz * s + e.nz * 0.02, {x: e.nx, z: e.nz}, t.level, true);
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
  // task reactor-expansion-20261101 (lane PATHS): every member of the deck steel stays out of the walkable body volume (memberClear;
  // the deck rects are the decks' ACTUAL cells: gen/reactor/pathsGen.ts deckFootprint) — sub-tags name the audit kinds
  plan.tag = 'deck-beam';
  // stringers: both long edges + every ~stringerPitch between
  const ns = Math.max(1, Math.round(B / KIT.stringerPitch));
  for (let k = 0; k <= ns; k++) {
    const t = Math.min(B - 0.12, Math.max(0.12, (B * k) / ns));
    if (plan.memberClear('ibeam', 'steel', P(0, t, yc), P(L, t, yc), KIT.beamWidth, depth)) beams++;
  }
  // cross beams (slightly shallower, under the stringers' flange line)
  const nc = Math.max(1, Math.round(L / KIT.crossPitch));
  for (let k = 0; k <= nc; k++) {
    const s = Math.min(L - 0.1, Math.max(0.1, (L * k) / nc));
    if (plan.memberClear('ibeam', 'steelDark', P(s, 0.05, yc - 0.04), P(s, B - 0.05, yc - 0.04), KIT.beamWidth * 0.8, depth * 0.8)) beams++;
  }
  plan.stats.deckBeams += beams;
  const edges = deckEdges(plan.info, d);
  // knee braces back to the wall (galleries, landings, stair landings): from under the outer part of the deck down to the wall —
  // lane PATHS: a brace that would cross a walkway below (a stair flight along the same wall) is shortened (reach / drop x 0.6, x 0.35)
  // or left out with its plate and corbel
  plan.tag = 'deck-brace';
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
        const corbel = boxMatrix(wx + ix * 0.25, yb - depth / 2, wz + iz * 0.25, Math.abs(e.nx) > 0 ? 0.5 : 0.3, depth, Math.abs(e.nz) > 0 ? 0.5 : 0.3);
        if (!plan.clear(corbel)) continue;
        for (const f of [1, 0.6, 0.35]) {
          const top = {x: wx + ix * reach * f, y: yb - depth, z: wz + iz * reach * f};
          const foot = {x: wx, y: yb - depth - Math.max(0.45, drop * f), z: wz};
          const brace = memberMatrix(foot, top, 0.16, 0.16);
          const plate = boxMatrix(foot.x + ix * 0.04, foot.y, foot.z + iz * 0.04, Math.abs(e.nx) > 0 ? 0.08 : 0.42, 0.5, Math.abs(e.nz) > 0 ? 0.08 : 0.42);
          if (!plan.clear(brace) || !plan.clear(plate)) continue;
          plan.add('box', 'steel', brace, plan.bandOf(foot.y + 0.05));
          braces++;
          plan.add('box', 'steelDark', plate, plan.bandOf(foot.y - 0.25 + 0.05)); // wall plate
          plan.add('box', 'steelDark', corbel, plan.bandOf(yb - depth + 0.05)); // corbel under the edge beam
          break;
        }
      }
    }
  }
  plan.stats.braces += braces;
  // bridges: Warren trusses under both long sides (B's lattice bridges)
  plan.tag = 'bridge-truss';
  if (d.kind === 'bridge') {
    const yt = yb - depth, ybot = yb - KIT.trussDepth;
    for (const t of [0.1, B - 0.1]) {
      plan.memberClear('ibeam', 'steel', P(0, t, ybot), P(L, t, ybot), 0.18, 0.24);
      const np = Math.max(2, Math.round(L / KIT.trussPanel));
      for (let k = 0; k <= np; k++) {
        const s = (L * k) / np;
        plan.memberClear('box', 'steel', P(s, t, ybot), P(s, t, yt), 0.12, 0.12);
        if (k < np) {
          const s2 = (L * (k + 1)) / np;
          plan.memberClear('box', 'steel', k % 2 ? P(s, t, yt) : P(s, t, ybot), k % 2 ? P(s2, t, ybot) : P(s2, t, yt), 0.11, 0.11);
        }
      }
      plan.stats.trusses++;
    }
    // bottom lateral bracing (X between the two trusses every other panel)
    const np = Math.max(2, Math.round(L / KIT.trussPanel));
    for (let k = 0; k < np; k += 2) {
      const s = (L * k) / np, s2 = (L * Math.min(np, k + 1)) / np;
      plan.memberClear('box', 'steelDark', P(s, 0.1, ybot), P(s2, B - 0.1, ybot), 0.07, 0.07);
      plan.memberClear('box', 'steelDark', P(s, B - 0.1, ybot), P(s2, 0.1, ybot), 0.07, 0.07);
    }
  }
  if (beams > 0) plan.stats.decksSupported++;
  // open edges: black fascia channel with hazard stripes, toe plate, lamps — task reactor-expansion-20261101 (lane PATHS): only along
  // the edge's DROP spans: never across a stair mouth or a seam where the walkway continues (the fascia would stand in the flight's
  // first treads), the toe plate and the post lamps only where a railing stands (KitPlan.railed; no lamp floats over a walkway)
  const stripeEdges = d.kind === 'bridge' || d.kind === 'landing' || d.kind === 'stair-landing' || d.kind === 'tower';
  const fine = !!plan.walk || plan.hasRails;
  for (const e of edges) {
    if (e.kind !== 'open') continue;
    const tx = (e.x1 - e.x0) / (e.len || 1), tz = (e.z1 - e.z0) / (e.len || 1);
    const ti = 0.03;
    const at = (s: number, off: number, y: number): P3 => ({x: e.x0 + tx * s + e.nx * off, y, z: e.z0 + tz * s + e.nz * off});
    const fascia = (s0: number, s1: number) => memberMatrix(at(s0, 0.02, d.y - KIT.fascia / 2), at(s1, 0.02, d.y - KIT.fascia / 2), 0.04, KIT.fascia);
    const toe = (s0: number, s1: number) => memberMatrix(at(s0, -ti, d.y + KIT.toe / 2), at(s1, -ti, d.y + KIT.toe / 2), 0.012, KIT.toe);
    const spans = (ok: (s0: number, s1: number) => boolean): [number, number][] => {
      if (!fine) return [[0, e.len]];
      const out: [number, number][] = [], n = Math.max(1, Math.round(e.len / 0.25));
      for (let k = 0; k < n; k++) {
        const s0 = (e.len * k) / n, s1 = (e.len * (k + 1)) / n;
        if (!ok(s0, s1)) continue;
        const last = out[out.length - 1];
        if (last && Math.abs(last[1] - s0) < 1e-6) last[1] = s1; else out.push([s0, s1]);
      }
      return out;
    };
    const fasc = spans((s0, s1) => plan.clear(fascia(s0, s1)));
    const toes = spans((s0, s1) => { const p = at((s0 + s1) / 2, 0, d.y); return plan.railed(p.x, p.z, d.y) && plan.clear(toe(s0, s1)); });
    plan.tag = 'deck-fascia';
    for (const [s0, s1] of fasc) if (s1 - s0 > 0.05) plan.member('box', 'black', at(s0, 0.02, d.y - KIT.fascia / 2), at(s1, 0.02, d.y - KIT.fascia / 2), 0.04, KIT.fascia);
    // toe plate on the deck top
    plan.tag = 'deck-toe';
    for (const [s0, s1] of toes) if (s1 - s0 > 0.05) plan.member('box', 'steel', at(s0, -ti, d.y + KIT.toe / 2), at(s1, -ti, d.y + KIT.toe / 2), 0.012, KIT.toe);
    if (toes.length) plan.stats.toePlates++;
    plan.tag = 'deck-stripes';
    if (stripeEdges && plan.stats.stripes < KIT.maxStripes) {
      const n = Math.floor(e.len / KIT.stripePitch);
      const yaw = Math.atan2(e.nx, e.nz);
      for (let k = 0; k < n && plan.stats.stripes < KIT.maxStripes; k++) {
        const s = (k + 0.5) * KIT.stripePitch;
        if (!fasc.some(([a, b]) => s - KIT.stripePitch / 2 >= a - 1e-6 && s + KIT.stripePitch / 2 <= b + 1e-6)) continue; // on the fascia
        const x = e.x0 + tx * s + e.nx * 0.045, z = e.z0 + tz * s + e.nz * 0.045;
        // the stripe parallelogram leans along the edge: its local X must follow the edge tangent
        const m = boxMatrix(x, d.y - KIT.fascia / 2, z, KIT.stripePitch, KIT.fascia * 0.9, 1, yaw);
        plan.add('stripe', 'yellow', m, plan.bandOf(d.y - 0.2));
        plan.stats.stripes++;
      }
    }
    // lamps on the railing posts of the open edges
    plan.tag = 'deck-lamp';
    if (d.kind !== 'stair-landing') {
      const n = Math.floor(e.len / KIT.lampPitch);
      for (let k = 0; k < n; k++) {
        const s = (k + 0.5) * (e.len / n);
        if (fine && !toes.some(([a, b]) => s >= a - 1e-6 && s <= b + 1e-6)) continue; // a lamp needs its railing post
        plan.lamp(e.x0 + tx * s + e.nx * 0.05, d.y + 1.18, e.z0 + tz * s + e.nz * 0.05, {x: e.nx, z: e.nz}, d.level);
      }
    }
  }
  plan.tag = 'decks';
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
      const girt = memberMatrix(A(yb - 0.1), B(yb - 0.1), KIT.girt, KIT.girt);
      const x1 = memberMatrix(A(ya + 0.15), B(yb - 0.2), KIT.brace, KIT.brace), x2 = memberMatrix(B(ya + 0.15), A(yb - 0.2), KIT.brace, KIT.brace);
      if (!plan.walk || (plan.clear(girt) && plan.clear(x1) && plan.clear(x2))) {
        if (plan.member('box', 'steel', A(yb - 0.1), B(yb - 0.1), KIT.girt, KIT.girt)) n++;
        // X-bracing per storey and face
        if (plan.member('box', 'steel', A(ya + 0.15), B(yb - 0.2), KIT.brace, KIT.brace)) n++;
        if (plan.member('box', 'steel', B(ya + 0.15), A(yb - 0.2), KIT.brace, KIT.brace)) n++;
        continue;
      }
      // task reactor-expansion-20261101 (lane PATHS): a walkway crosses this face (a bridge entering the tower deck, the core floor
      // round the tower's foot): a PORTAL — a header girt over each walk band, the X-bracing only in the free height between the bands
      // (under-deck steel kept clear below a band), nothing standing in the walkway
      plan.tag = 'tower-portal';
      const pa = A(0), pb = B(0);
      const bands = plan.walk.bandsIn(Math.min(pa.x, pb.x) - 0.05, Math.min(pa.z, pb.z) - 0.05, Math.max(pa.x, pb.x) + 0.05, Math.max(pa.z, pb.z) + 0.05)
        .filter(b => b.y1 > ya - 0.8 && b.y0 < yb + 0.3);
      let free: [number, number][] = [[ya + 0.15, yb - 0.1]];
      for (const b of bands) {
        const c0 = b.y0 - 0.8, c1 = b.y1 + 0.3, next: [number, number][] = [];
        for (const [p, q] of free) { if (c1 <= p || c0 >= q) next.push([p, q]); else { if (c0 > p) next.push([p, c0]); if (c1 < q) next.push([c1, q]); } }
        free = next;
      }
      for (const [p, q] of free) {
        if (q - p < 0.9) continue;
        if (plan.memberClear('box', 'steel', A(p), B(q), KIT.brace, KIT.brace)) n++;
        if (plan.memberClear('box', 'steel', B(p), A(q), KIT.brace, KIT.brace)) n++;
      }
      for (const b of bands) if (b.y1 + 0.2 > ya && b.y1 + 0.2 < yb - 0.3 && plan.memberClear('box', 'steel', A(b.y1 + 0.2), B(b.y1 + 0.2), KIT.girt, KIT.girt)) n++;
      if (plan.memberClear('box', 'steel', A(yb - 0.1), B(yb - 0.1), KIT.girt, KIT.girt)) n++;
      plan.tag = 'towers';
    }
    if (s % 2 === 1) plan.lamp(t.x + t.hx + KIT.leg / 2, ya + sh * 0.5, t.z + t.hz, {x: 1, z: 0}, plan.tiers[plan.bandOf(ya + sh * 0.5)]?.level);
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
  // trolley (the 'craneTrolley' model when loaded: real size, its length along the runway axis, spanning both girders) on top
  const tb = c.trolleyAt, ty = c.railY + 0.95 + 1.35 / 2;
  const tp = W(ba, ty, tb);
  if (plan.canModel('craneTrolley')) { plan.placeModel('craneTrolley', boxMatrix(tp.x, ty, tp.z, 1, 1, 1, ax ? 0 : Math.PI / 2), plan.bandOf(ty)); n++; }
  else {
    cnt(plan.add('box', 'yellow', boxMatrix(tp.x, ty + 0.55, tp.z, ax ? 2.4 : 2.6, 1.1, ax ? 2.6 : 2.4), plan.bandOf(ty)));
    cnt(plan.add('cyl', 'steelDark', cylMatrix(W(ba - 1.0, ty + 0.75, tb), W(ba + 1.0, ty + 0.75, tb), 0.9), plan.bandOf(ty))); // hoist drum
    cnt(plan.add('box', 'black', boxMatrix(tp.x, ty + 1.25, tp.z, ax ? 1.2 : 1.0, 0.4, ax ? 1.0 : 1.2), plan.bandOf(ty))); // motor
  }
  // hoist ropes down to the hook block, the block and hook (the 'craneHook' model when loaded: real size, rope stubs on top,
  // its bottom at hookY)
  const hookModel = plan.canModel('craneHook');
  const blockTop = c.hookY + (hookModel ? REACTOR_MODELS.craneHook.dims[1] - 0.05 : 2.0);
  if (ty - blockTop > 0.5) {
    for (const [oa, ob] of [[-0.18, -0.12], [0.18, -0.12], [-0.18, 0.12], [0.18, 0.12]]) cnt(plan.cyl('tube', 'black', W(ba + oa, ty + 0.1, tb + ob), W(ba + oa * 0.7, blockTop, tb + ob * 0.7), 0.045));
  }
  const hp = W(ba, c.hookY, tb);
  if (hookModel) { plan.placeModel('craneHook', boxMatrix(hp.x, c.hookY, hp.z, 1, 1, 1, ax ? 0 : Math.PI / 2), plan.bandOf(c.hookY)); n++; }
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
  const PB = REACTOR_MODELS.pipeBank.dims;
  const D = Math.max(0.8, b.depth, plan.usesModel('pipeBank') ? PB[2] : 0);
  // stackable 4 m modules ('pipeBank' model: real height, front +Z = toward the pit, back on the wall, flat-cut ends) from the TOP
  // down while the per-level cap lasts (the clear upper air); below, the procedural organ pipes (the gassed depths)
  let yProc = b.y1;
  if (plan.usesModel('pipeBank')) {
    const nu = Math.max(1, Math.round(L / PB[0])), sx = L / (nu * PB[0]);
    const yaw = Math.atan2(b.nx, b.nz);
    if (sx > 0.8 && sx < 1.25) {
      for (let y = b.y1 - PB[1]; y >= b.y0 - 0.01 && plan.canModel('pipeBank', nu); y -= PB[1]) {
        for (let i = 0; i < nu; i++) {
          const p = at((i + 0.5) * (L / nu), PB[2] / 2 + 0.02, y);
          plan.placeModel('pipeBank', boxMatrix(p.x, y, p.z, sx, 1, 1, yaw), plan.bandOf(y + 0.1));
        }
        yProc = y;
      }
    }
  }
  if (yProc > b.y0 + 0.5) {
    // two rows: big pipes against the wall, smaller ones in front (organ pipes of several diameters)
    const rows: {off: number; sizes: number[]}[] = [{off: D * 0.32, sizes: [1.15, 0.9, 1.3, 0.75, 1.0]}, {off: D * 0.74, sizes: [0.42, 0.55, 0.36, 0.62, 0.48]}];
    const cuts = [yProc, ...plan.tiers.map(t => t.baseY).filter(y => y < yProc && y > b.y0), b.y0].sort((p, q) => q - p);
    for (const [ri, row] of rows.entries()) {
      let s = 0.3 + kitHash(ri, plan.seed) * 0.3;
      let k = 0;
      while (s < L - 0.25) {
        const h = kitHash(s, ri, b.x0, b.z0, plan.seed);
        const d = Math.min(row.sizes[k++ % row.sizes.length] * (0.9 + 0.2 * h), D * (ri ? 0.5 : 0.62));
        const c = s + d / 2;
        if (c + d / 2 > L - 0.1) break;
        // organ tops: most run to the top, some stop short with a cap (under the model modules: all run into them)
        const top = yProc < b.y1 ? yProc : h < 0.28 ? b.y1 - 3 - Math.round(h * 30) : b.y1;
        // split at the tier heights (per-band chunks)
        for (let i = 0; i + 1 < cuts.length; i++) {
          const y1 = Math.min(cuts[i], top), y0 = cuts[i + 1];
          if (y1 - y0 < 0.2) continue;
          plan.cyl('cyl', 'pipe', at(c, row.off, y0), at(c, row.off, y1), d);
        }
        plan.stats.pipes++;
        if (top < b.y1 && yProc >= b.y1) plan.cyl('cyl', 'steelDark', at(c, row.off, top), at(c, row.off, top + 0.35), d * 1.12);
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
    for (let s = 2; s < L - 1; s += 4.5) { const p = at(s, o1 + 0.03, y + 1.15); plan.lamp(p.x, p.y, p.z, {x: b.nx, z: b.nz}, undefined, true); }
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
  const yaw = Math.atan2(nx, nz);
  // the hub point is on the wall face; the housing stands out from it along n
  let bladeAt = 0.12, bladeR = R * 0.95;
  if (plan.canModel('fanHousing')) {
    // 'fanHousing' model (empty ring facing +Z): uniform scale so its ring opening matches the fan radius, back plate on the wall
    const A = REACTOR_MODELS.fanHousing.anchors!, s = R / (A.ringR as number);
    const back = -(A.back as number) * s;
    plan.placeModel('fanHousing', boxMatrix(f.x + nx * back, f.y - (A.ringY as number) * s, f.z + nz * back, s, s, s, yaw), plan.bandOf(f.y - R));
    bladeAt = back + (A.bladeZ as number) * s;
    bladeR = (A.bladeR as number) * s;
  } else {
    // duct + dark back disc + square frame plate + motor hub + guard ring
    plan.cyl('tube', 'steelDark', P(-0.7), P(0.35), R * 2.16);
    plan.cyl('cyl', 'black', P(-0.62), P(-0.56), R * 2.1);
    const fw = R * 2 + 0.7;
    for (const [lx, ly, sx, sy] of [[0, R + 0.2, fw, 0.4], [0, -R - 0.2, fw, 0.4], [R + 0.2, 0, 0.4, fw], [-R - 0.2, 0, 0.4, fw]] as const) {
      const c = Math.cos(yaw), s = Math.sin(yaw);
      plan.add('box', 'steelDark', boxMatrix(f.x + lx * c + nx * 0.05, f.y + ly, f.z - lx * s + nz * 0.05, sx, sy, 0.16, yaw), plan.bandOf(f.y - R));
    }
    plan.cyl('cyl', 'machine', P(-0.4), P(0.05), R * 0.42);
    plan.cyl('tube', 'black', P(0.42), P(0.48), R * 2.12);
  }
  // hazard band below the housing
  plan.add('box', 'yellow', boxMatrix(f.x + nx * 0.06, f.y - R - 0.75, f.z + nz * 0.06, R * 1.6, 0.16, 0.05, yaw), plan.bandOf(f.y - R - 0.8));
  // rotor basis: local Z = the outward normal, Y up (archMeshes 'blade': unit radius in local XY)
  _z.set(nx, 0, nz); _y.set(0, 1, 0); _x.crossVectors(_y, _z);
  const basis = new THREE.Matrix4().makeBasis(_x.clone(), _y.clone(), _z.clone());
  basis.setPosition(f.x + nx * bladeAt, f.y, f.z + nz * bladeAt);
  plan.fans.push({id: f.id, zone: f.zone, level: f.level, hub, basis, radius: bladeR});
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
  let place = localBox(o, yaw, 0, 0, 0, 1, 1, 1), modelIndex = -1;
  if (plan.canModel('generator')) {
    // the 'generator' model (real size 5.6 x 2.48 x 1.67, length X): one uniform scale inside the record's footprint; its own control
    // box is on its +Z long side, so it turns to face the start panel's side
    const GD = REACTOR_MODELS.generator.dims, s = Math.min(1.25, w / GD[0], h / GD[1], d / GD[2]);
    const lz = (g.panel.x - g.x) * Math.sin(yaw) + (g.panel.z - g.z) * Math.cos(yaw);
    place = boxMatrix(g.x, g.y, g.z, s, s, s, lz >= 0 ? yaw : yaw + Math.PI);
    modelIndex = plan.modelPlacements.get('generator')?.length ?? 0;
    plan.placeModel('generator', place, band, [GD[0] * s, GD[1] * s, GD[2] * s]);
  } else {
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
  // task reactor-expansion-20261101 (lane PATHS): the panel sits flush on its (axis-aligned) footprint face — an off-centre stand point
  // used to turn it ~18 deg, so its corner, lever and lamps stuck 0.1 m into the walkway; within 30 deg of an axis it faces square out
  if (Math.abs(fx) > 0.866) { fx = Math.sign(fx); fz = 0; } else if (Math.abs(fz) > 0.866) { fz = Math.sign(fz); fx = 0; }
  const pyaw = Math.atan2(fx, fz);
  plan.add('box', 'machine', boxMatrix(px - fx * 0.12, py, pz - fz * 0.12, 0.62, 0.78, 0.26, pyaw), band);
  if (py - 0.39 > g.y + 0.1) plan.cyl('tube', 'steelDark', {x: px - fx * 0.12, y: g.y, z: pz - fz * 0.12}, {x: px - fx * 0.12, y: py - 0.39, z: pz - fz * 0.12}, 0.09); // its post
  plan.add('box', 'yellow', boxMatrix(px + fx * 0.02, py - 0.24, pz + fz * 0.02, 0.12, 0.2, 0.06, pyaw), band); // start lever
  const c = Math.cos(pyaw), s = Math.sin(pyaw);
  const lamp = (lx: number, color: number): KitRef => plan.add('bulb', 'panelLamp', boxMatrix(px + lx * c + fx * 0.03, py + 0.24, pz - lx * s + fz * 0.03, 0.08, 0.08, 0.08), band, color)!;
  const lamps: [KitRef, KitRef] = [lamp(-0.14, 0xff3020), lamp(0.14, 0x103010)];
  plan.generators.push({id: g.id, zone: g.zone, level: g.level, body, lamps, place, size: {w, d, h}, modelIndex});
  plan.stats.generators++;
  // cable run to the zone's fans: a tray + three cables along the polyline — task reactor-expansion-20261101 (lane PATHS): with the
  // walk volume the first leg rises at the control box to 2.6 m and crosses the landing over head height; a leg that would cross a
  // walkway runs FLAT on its pit wall (tray on edge, cables in its plane, < 0.1 m off the wall); a leg that still would is left out
  plan.tag = 'gen-cable';
  const pts = g.cable.map(p => ({x: p.x, y: p.y, z: p.z}));
  if (plan.walk && pts.length >= 2) {
    const rx = px - fx * 0.12, rz = pz - fz * 0.12;
    pts.splice(0, 1, {x: rx, y: py + 0.39, z: rz}, {x: rx, y: Math.max(pts[1].y, g.y + 2.6), z: rz});
  }
  const walls = plan.walk ? pitEdges(plan.info) : [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], b = pts[i + 1];
    const dx = b.x - a.x, dz = b.z - a.z, dl = Math.hypot(dx, dz) || 1;
    const tray = memberMatrix({x: a.x, y: a.y - 0.05, z: a.z}, {x: b.x, y: b.y - 0.05, z: b.z}, 0.32, 0.05);
    const wires = [-0.09, 0, 0.09].map(off => cylMatrix({x: a.x - dz / dl * off, y: a.y + 0.02, z: a.z + dx / dl * off}, {x: b.x - dz / dl * off, y: b.y + 0.02, z: b.z + dx / dl * off}, 0.055));
    if (!plan.walk || (plan.clear(tray) && wires.every(m => plan.clear(m)))) {
      plan.add('box', 'steelDark', tray, plan.bandOf(Math.min(a.y, b.y) - 0.05 + 0.05));
      for (const m of wires) plan.add('tube', 'cable', m, plan.bandOf(Math.min(a.y, b.y) + 0.02 + 0.05));
      plan.stats.cables++;
      continue;
    }
    // flat on the nearest pit wall (the leg's points moved onto the wall plane, 3.5 cm off it)
    const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
    let wall: (typeof walls)[number] | null = null, wd = Infinity;
    for (const e of walls) {
      const ex = (e.b.x - e.a.x) / e.len, ez = (e.b.z - e.a.z) / e.len, s = Math.max(0, Math.min(e.len, (mx - e.a.x) * ex + (mz - e.a.z) * ez));
      const dd = Math.hypot(e.a.x + ex * s - mx, e.a.z + ez * s - mz);
      if (dd < wd) { wd = dd; wall = e; }
    }
    if (!wall || wd > 0.6) continue;
    const W = wall, n = new THREE.Vector3(W.nx, 0, W.nz);
    const onWall = (p: P3, off: number): P3 => { const d0 = (p.x - W.a.x) * W.nx + (p.z - W.a.z) * W.nz; return {x: p.x + W.nx * (off - d0), y: p.y, z: p.z + W.nz * (off - d0)}; };
    const A = onWall(a, 0.035), Bw = onWall(b, 0.035);
    const dir = new THREE.Vector3(Bw.x - A.x, Bw.y - A.y, Bw.z - A.z);
    if (dir.lengthSq() < 1e-6) continue;
    dir.normalize();
    const q = new THREE.Vector3().crossVectors(n, dir).normalize();
    const flat = memberMatrix(A, Bw, 0.32, 0.03, n);
    const flatWires = [-0.09, 0, 0.09].map(off => cylMatrix(
      {x: A.x + q.x * off + W.nx * 0.035, y: A.y + q.y * off, z: A.z + q.z * off + W.nz * 0.035},
      {x: Bw.x + q.x * off + W.nx * 0.035, y: Bw.y + q.y * off, z: Bw.z + q.z * off + W.nz * 0.035}, 0.045));
    if (!plan.clear(flat) || !flatWires.every(m => plan.clear(m))) continue;
    plan.add('box', 'steelDark', flat!, plan.bandOf(Math.min(A.y, Bw.y)));
    for (const m of flatWires) plan.add('tube', 'cable', m, plan.bandOf(Math.min(A.y, Bw.y)));
    plan.stats.cables++;
  }
  plan.tag = 'generators';
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
  let {rv, plinthH, yd, domeH} = vesselDims(c);
  const band = plan.bandOf(c.y0 + 0.1);
  const steel: THREE.BufferGeometry[] = [], vessel: THREE.BufferGeometry[] = [], glow: THREE.BufferGeometry[] = [], grate: THREE.BufferGeometry[] = [];
  const T = (g: THREE.BufferGeometry, y: number) => { g.translate(c.x, y, c.z); return g; };
  const model = plan.canModel('vessel');
  let gantryLow = c.y0 + 3.4;
  if (model) {
    // the 'vessel' model (dome + CRDM housings + 4 nozzles + hazard plinth; 14 m across the nozzles): one uniform scale so it spans
    // 2 x ReactorCore.radius (the solid round obstruction); glow parts at its measured seam / plinth
    const A = REACTOR_MODELS.vessel.anchors!, s = (2 * c.radius) / (A.width as number);
    plan.placeModel('vessel', boxMatrix(c.x, c.y0, c.z, s, s, s), band, [REACTOR_MODELS.vessel.dims[0] * s, REACTOR_MODELS.vessel.dims[1] * s, REACTOR_MODELS.vessel.dims[2] * s]);
    rv = (A.bodyR as number) * s;
    glow.push(T(new THREE.CylinderGeometry(rv * 1.025, rv * 1.025, 0.2 * s, 40, 1, true), c.y0 + (A.seamY as number) * s));
    glow.push(T(new THREE.CylinderGeometry((A.plinthR as number) * s * 1.006, (A.plinthR as number) * s * 1.006, 0.22 * s, 48, 1, true), c.y0 + 0.42 * s));
    gantryLow = Math.max(gantryLow, c.y0 + 4.45 * s);
    yd = c.y0 + 6.6 * s; domeH = REACTOR_MODELS.vessel.dims[1] * s - 6.6 * s;
    plan.stats.vesselParts += 1;
  } else {
    // plinth (stepped) + a glowing slot ring on top of it
    steel.push(T(new THREE.CylinderGeometry(c.radius, c.radius * 1.03, plinthH, 40, 1, false), c.y0 + plinthH / 2));
    glow.push(T(new THREE.CylinderGeometry(rv * 1.05, rv * 1.05, 0.14, 40, 1, true), c.y0 + plinthH + 0.07));
  }
  if (!model) {
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
  }
  void domeH;
  // ring gantries (above head height on the core floor; with the model above its nozzle band), brackets, rails, posts, lamps
  const rings = [gantryLow, yd - 0.9].filter((y, i, a) => i === 0 || y > a[0] + 2.6);
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
      if (k % 6 === 3) plan.lamp(c.x + ca * (r1 + 0.03), y + 1.2, c.z + sa * (r1 + 0.03), {x: ca, z: sa}, undefined, true);
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
  if (/^pump/.test(id)) return 'coolantPump';
  if (/^valve/.test(id)) return 'coolantValve';
  if (/^(rods|keyswitch|console)/.test(id)) return 'controlConsole';
  return null;
}

/** Procedural stand-in sizes (W x H x D, m) when a machine's model is not loaded. */
const MACHINE_DIMS: Record<'switchgear' | 'coolantPump' | 'coolantValve' | 'controlConsole', readonly [number, number, number]> = {
  switchgear: [0.8, 2.1, 0.6], coolantPump: [1.8, 1.3, 1.1], coolantValve: [0.9, 1.6, 0.6], controlConsole: [1.6, 1.15, 0.85],
};

function planSite(plan: KitPlan, site: ReactorSite): void {
  const floorY = plan.info.tiers.find(t => t.level === site.level)?.baseY;
  // one machine per piece and facing: a console / pump / valve serves every control of its kind; the switchgear is a BANK of
  // cabinet sections side by side (4-6, inside the room) behind its fuse / breaker controls
  const seen = new Map<string, {x: number; z: number}[]>();
  for (const ctl of site.controls) {
    const piece = pieceOfControl(ctl.id);
    if (!piece) continue;
    let fx = ctl.at.x - ctl.stand.x, fz = ctl.at.z - ctl.stand.z;
    const fl = Math.hypot(fx, fz);
    if (fl < 0.05) { fx = -Math.sin(ctl.yaw); fz = -Math.cos(ctl.yaw); } else { fx /= fl; fz /= fl; }
    // the machine stands behind the control point (away from the stand), its front facing the player
    const yaw = Math.atan2(-fx, -fz);
    const fy = floorY !== undefined && ctl.at.y - floorY < 2.5 && ctl.at.y >= floorY - 0.05 ? floorY : ctl.at.y - 1.1;
    const model = plan.canModel(piece);
    const [w, h, d] = model ? REACTOR_MODELS[piece].dims : MACHINE_DIMS[piece as keyof typeof MACHINE_DIMS];
    const cx = ctl.at.x + fx * (d / 2 + 0.02), cz = ctl.at.z + fz * (d / 2 + 0.02);
    const key = `${piece}|${Math.round(yaw * 10)}`;
    const prior = seen.get(key) ?? [];
    // a machine of this kind facing this way already stands within its width: that one serves this control too
    if (piece === 'switchgear' ? prior.length > 0 : prior.some(p => Math.hypot(p.x - cx, p.z - cz) < w * 0.95)) continue;
    prior.push({x: cx, z: cz}); seen.set(key, prior);
    const band = plan.bandOf(fy + 0.1);
    if (piece === 'switchgear') { planSwitchgearBank(plan, site, {x: cx, z: cz}, fy, yaw, model, prior); continue; }
    if (model) { plan.placeModel(piece, boxMatrix(cx, fy, cz, 1, 1, 1, yaw), band, [w, h, d]); plan.stats.machines++; continue; }
    const o = {x: cx, y: fy, z: cz};
    if (piece === 'coolantPump') {
      plan.add('box', 'steelDark', localBox(o, yaw, 0, 0.1, 0, w, 0.2, d), band);
      plan.add('cyl', 'machine', cylMatrix(localPt(o, yaw, -w * 0.45, 0.2 + d * 0.38, 0), localPt(o, yaw, 0.05, 0.2 + d * 0.38, 0), d * 0.76), band); // motor
      plan.add('cyl', 'pipe', cylMatrix(localPt(o, yaw, 0.15, 0.2 + h * 0.4, -d * 0.4), localPt(o, yaw, 0.15, 0.2 + h * 0.4, d * 0.4), h * 0.62), band); // volute
      plan.add('tube', 'pipe', cylMatrix(localPt(o, yaw, 0.6, 0.2 + h * 0.4, 0), localPt(o, yaw, 0.6, h + 1.4, 0), 0.32), band); // discharge riser
    } else if (piece === 'coolantValve') {
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

/** Cabinet sections per switchgear bank (the 'switchgear' model is ONE section: tiled side by side). */
export const SWITCHGEAR_SECTIONS = {min: 4, max: 6} as const;

/**
 * A switchgear BANK facing `yaw` (front toward the controls' stand points), covering every fuse / breaker control of the site that
 * faces the same way: 4-6 sections side by side along the wall, inside the room rect (fewer when the wall is shorter).
 */
function planSwitchgearBank(plan: KitPlan, site: ReactorSite, c: {x: number; z: number}, fy: number, yaw: number, model: boolean, _prior: {x: number; z: number}[]): void {
  const [w, h, d] = model ? REACTOR_MODELS.switchgear.dims : MACHINE_DIMS.switchgear;
  const tx = Math.cos(yaw), tz = -Math.sin(yaw); // the bank runs along the section's local X
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw); // into the wall (away from the player)
  // the controls this bank serves (same piece + facing): their projections along the bank
  const proj: number[] = [];
  for (const ctl of site.controls) {
    if (pieceOfControl(ctl.id) !== 'switchgear') continue;
    let gx = ctl.at.x - ctl.stand.x, gz = ctl.at.z - ctl.stand.z;
    const gl = Math.hypot(gx, gz) || 1; gx /= gl; gz /= gl;
    if (gx * fx + gz * fz < 0.9) continue;
    proj.push((ctl.at.x - c.x) * tx + (ctl.at.z - c.z) * tz);
  }
  if (!proj.length) proj.push(0);
  // room extent along the bank line through c (0.1 m margin)
  const r = site.rect, m = 0.1;
  let s0 = -Infinity, s1 = Infinity;
  for (const [p, t, lo, hi] of [[c.x, tx, r.x0 + m, r.x1 - m], [c.z, tz, r.z0 + m, r.z1 - m]] as const) {
    if (Math.abs(t) < 1e-6) { if (p < lo - 0.5 || p > hi + 0.5) { s0 = 0; s1 = 0; } continue; }
    const a = (lo - p) / t, b = (hi - p) / t;
    s0 = Math.max(s0, Math.min(a, b)); s1 = Math.min(s1, Math.max(a, b));
  }
  if (!Number.isFinite(s0) || !Number.isFinite(s1) || s1 - s0 < w) { s0 = Math.min(...proj) - w / 2; s1 = Math.max(...proj) + w / 2; }
  const need = Math.max(...proj) - Math.min(...proj) + w;
  const n = Math.max(1, Math.min(SWITCHGEAR_SECTIONS.max, Math.max(Math.ceil(need / w - 1e-6), Math.min(SWITCHGEAR_SECTIONS.min, Math.floor((s1 - s0) / w + 1e-6)))));
  const mid = (Math.min(...proj) + Math.max(...proj)) / 2;
  const start = Math.max(s0, Math.min(s1 - n * w, mid - (n * w) / 2));
  const band = plan.bandOf(fy + 0.1);
  for (let k = 0; k < n; k++) {
    const s = start + (k + 0.5) * w, x = c.x + tx * s, z = c.z + tz * s;
    if (model && plan.canModel('switchgear')) { plan.placeModel('switchgear', boxMatrix(x, fy, z, 1, 1, 1, yaw), band, [w, h, d]); continue; }
    const o = {x, y: fy, z};
    plan.add('box', 'machine', localBox(o, yaw, 0, h / 2, 0, w - 0.02, h, d), band);
    plan.add('box', 'steelDark', localBox(o, yaw, 0, h - 0.05, 0, w, 0.1, d + 0.04), band);
    plan.add('box', 'black', localBox(o, yaw, 0, 1.2, d / 2 + 0.005, w * 0.6, 0.34, 0.02), band); // fuse / breaker panel
    plan.add('box', 'yellow', localBox(o, yaw, w * 0.3, h * 0.82, d / 2 + 0.006, 0.18, 0.12, 0.012), band); // warning plate
  }
  plan.stats.machines += n;
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
    // task reactor-expansion-20261101 (lane PATHS): a sloped member's end faces are square to the pitch, so their low corners overshot
    // the rail's end into the landing at a stair mouth by (h / 2) tan(pitch): pull each end in by that much
    const tan = Math.abs(r.y1 - r.y0) / len, end = (h: number) => Math.min(len / 2 - 0.01, (h / 2) * tan);
    let n = 0;
    if (plan.member('box', 'steel', P(end(0.05), H), P(len - end(0.05), H), 0.05, 0.05)) n++;
    if (plan.member('box', 'steel', P(end(0.035), 0.55), P(len - end(0.035), 0.55), 0.035, 0.035)) n++;
    if (!sloped) { if (plan.member('box', 'steelDark', P(0.02, 0.06), P(len - 0.02, 0.06), 0.015, 0.11)) n++; }
    else if (plan.member('box', 'steelDark', P(end(0.32), -0.04), P(len - end(0.32), -0.04), 0.06, 0.32)) n++;
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
