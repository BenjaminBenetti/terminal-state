// Turns a StationLayout into three.js meshes: merged per-material architecture built from the
// cell grid, instanced prop derivatives, procedural props/trim (frames, rails, stairs, gates) and
// instanced signage. Draw calls stay bounded for the large station: architecture is one mesh per
// (level, chunk, material), procedural props one instanced mesh per (kind, material), signs one
// plate mesh plus one face mesh per distinct text.
//
// Iteration 08 (Lane G): multi-level stations. Every level (layout.levels; levels[0] = layout.grid)
// is built from the union-of-open-columns model (world/levelGeometry.ts): wall faces only where a
// level's open band borders closed space at that height (slab fascias, soffits, stair cores and
// double-height voids included), ceilings per band (slab undersides), floors per area on its own
// level, guard railings on drop edges. The faces are published as `wallFaces` for the wall-treatment
// pass. Architecture and trim are chunked (CHUNK_M, per level) so off-screen chunks are culled.

import * as THREE from 'three';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {CELL, FLOOR, VOID, type Grid} from '../gen/grid';
import {PROP_DEFS, type PropKind, type PropPlacement} from '../gen/props';
import {ACCENT_COLORS, propShape, type ShapeMat} from '../gen/propShapes';
import {isContainerKind} from '../items/loot';
import type {Area, SignPlacement, StationLayout} from '../gen/station';
import type {WorldMaterials, MatKey} from './materials';
import {canvasTexture, signPlate} from './canvasTextures';
import {companySignTexture, signStyleKey} from './companySigns'; // Task office-overhaul-20261030 (lane TENANTS)
import {shapeMaterial, shapeMaterials} from './shapeMaterials';
import {SHOP_BLOCKERS, SHOP_FURNITURE} from '../gen/storefronts';
import {buildStorefronts} from './storefrontBuilder';
import {buildTraversal} from './traversalBuilder';
import {SIGN_SIZE, passageRails, signDims} from '../gen/doorways';
import {
  CHUNK_M, LevelColumns, RAIL_HEIGHT, cellCeil as cellCeilAt, ceilingRuns, chunkKey, extractWallFaces, levelOf, rampsEqual, stationLevels, stationRails,
  type BuiltFace, type RailRun,
} from './levelGeometry';
import type {WallFace} from './wallFaces';
import {LEGACY_STACK, LevelCuller} from './levelCulling';
import {MeshBasicNodeMaterial, MeshStandardNodeMaterial} from 'three/webgpu'; // Iteration 13 (MAT-A)
import {SIGN_ATLAS_CONTEXT} from './surfaceNodes';
import {buildWallDetail} from './wallDetail';
import {applyStationDecay, archShopMaterial} from './decay';
import {buildOfficeProp, cutOfficeWindows, isOfficeBuilt} from './officeProps'; // Iteration 16 (WORLD-GEN)
import {OfficeArch} from './officeArch'; // Task office-overhaul-20261030 (lane ARCH): office storeys look like an office
import {setExteriorRoof} from './exterior'; // Task office-overhaul-20261030 (lane ARCH): roof deck for the outdoor fog / tower shell
import {MALL_FINISH_ATTR, MallArch, downlightLensMatrix, splitFinishKey} from './mallArch'; // Task track3-eaton-centre-20261031 (lane ARCH): the mall's finishes + atrium

class Accum {
  pos: number[] = [];
  nor: number[] = [];
  uv: number[] = [];
  idx: number[] = [];
  /** Iteration 12 (ARCH): triangles (quads with one collapsed edge), indexed AFTER every quad (keeps the 6-index quad layout wallDetail cuts rely on). */
  tri: number[] = [];
  /**
   * Task track3-eaton-centre-20261031 (lane ARCH): the mall finish row of the next quads (world/mallSurfaces.ts 'aFinish'), set by
   * the builder from a 'mall-…|row' key; -1 (every Subway / Office accumulator) writes no attribute: their geometry is unchanged.
   */
  fin = -1;
  fid: number[] = [];
  quad(p: number[][], n: readonly number[], uv: number[][]) {
    if (this.fin >= 0) {
      // one row value per vertex this quad adds (3 for a collapsed quad, 4 otherwise)
      let tri = false;
      for (let i = 0; i < 4 && !tri; i++) { const a = p[i], b = p[(i + 1) % 4]; tri = Math.abs(a[0] - b[0]) < 1e-7 && Math.abs(a[1] - b[1]) < 1e-7 && Math.abs(a[2] - b[2]) < 1e-7; }
      for (let k = tri ? 3 : 4; k > 0; k--) this.fid.push(this.fin);
    }
    const base = this.pos.length / 3;
    // A quad with zero height at one end (stair-wall zone slices) is a triangle: no zero-area triangle.
    let gone = -1;
    for (let i = 0; i < 4 && gone < 0; i++) {
      const a = p[i], b = p[(i + 1) % 4];
      if (Math.abs(a[0] - b[0]) < 1e-7 && Math.abs(a[1] - b[1]) < 1e-7 && Math.abs(a[2] - b[2]) < 1e-7) gone = i;
    }
    if (gone >= 0) {
      for (let k = 1; k <= 3; k++) {
        const i = (gone + k) % 4;
        this.pos.push(p[i][0], p[i][1], p[i][2]);
        this.nor.push(n[0], n[1], n[2]);
        this.uv.push(uv[i][0], uv[i][1]);
      }
      this.tri.push(base, base + 1, base + 2);
      return;
    }
    for (let i = 0; i < 4; i++) {
      this.pos.push(p[i][0], p[i][1], p[i][2]);
      this.nor.push(n[0], n[1], n[2]);
      this.uv.push(uv[i][0], uv[i][1]);
    }
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  geometry(): THREE.BufferGeometry | null {
    if (!this.idx.length && !this.tri.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    if (this.fid.length) g.setAttribute(MALL_FINISH_ATTR, new THREE.Float32BufferAttribute(this.fid, 1)); // task track3 (lane ARCH)
    const idx = this.tri.length ? this.idx.concat(this.tri) : this.idx;
    g.setIndex(this.pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
    g.computeBoundingSphere();
    return g;
  }
}

/** Storefront unit interiors use world-mapped shape materials (UV scale irrelevant). */
const SHOP_SCALE = {u: 1, v: 1};

export interface Fixture {
  x: number; y: number; z: number;
  broken: boolean; flicker: boolean; warm: boolean;
  /** Mostly-dead tube that sputters in brief bursts. */
  dying: boolean;
  /** Output multiplier 0..1 (aged/dirty tubes in dim areas are < 0.8). */
  power: number;
  area: number;
  phase: number;
  /** Current brightness 0..1 for emissive + pooled light. */
  level: number;
}

export interface BuiltWorld {
  group: THREE.Group;
  fixtures: Fixture[];
  tubes: THREE.InstancedMesh | null;
  stats: {meshes: number; triangles: number; instances: number; levels: number; archMeshes: number};
  /** Iteration 08: every visible base-wall face (input of the wall-treatment pass). */
  wallFaces: WallFace[];
  /** Iteration 08: guard railings on drop edges (layout.rails, else derived from the geometry). */
  rails: RailRun[];
  /** Iteration 08: level id of a world point (band holding y) — instanced groups are chunked per level with it. */
  levelAt: LevelResolver;
  /** Iteration 08: hides levels behind slabs (portal visibility); register other station groups, update per frame. */
  culler: LevelCuller;
  /** Task office-overhaul-20261030 (lane ARCH): the office storeys' architecture (styles, finish keys, materials); office layouts only. */
  officeArch?: OfficeArch;
  /** Task track3-eaton-centre-20261031 (lane ARCH): the mall's finishes + atrium (world/mallArch.ts); mall layouts only. */
  mallArch?: MallArch;
}

/** Instanced model chunk size (m): bigger chunks = fewer draw calls, coarser frustum culling. */
const CHUNK = 18;
/** Pseudo-level of stair flight geometry (treads, risers, flight ceilings, side walls): seen from both
 *  levels a flight joins, so in a Subway station the level culler never hides it. Task office-seamless-20261029: in a
 *  taller stack (> LEGACY_STACK levels) flight meshes are split per joined level pair and tagged `userData.levels` = those
 *  storeys, so the culler draws a flight only when one of its storeys is visible (a 9-storey scissor stair is not drawn
 *  whole from every floor). userData.level stays STAIR_LEVEL. */
export const STAIR_LEVEL = -1;
/** Trim / sleeper chunk size (m): small cheap geometry, coarse chunks. */
const TRIM_CHUNK_M = 64;
/** Model keys for props that use a generated derivative when it exists (optional). */
const MODEL_FOR: Partial<Record<PropKind, string>> = {bench: 'bench', cabinetTall: 'cabinetTall', cabinetLow: 'cabinetLow', stall: 'stall', vending: 'vending', shelf: 'shelf', bin: 'trashCan'};

/** Storeys tagged on an accumulator chunk key ('level:cx,cz#a-b'), else undefined. */
function chunkLevels(chunk: string): number[] | undefined {
  const h = chunk.indexOf('#');
  return h < 0 ? undefined : chunk.slice(h + 1).split('-').map(Number);
}

function floorMatFor(area: Area | undefined): MatKey {
  if (!area) return 'concrete';
  return area.publicSpace ? 'terrazzo' : 'concrete';
}

interface Sink { quad(p: number[][], n: readonly number[], uv: number[][]): void }

/**
 * Vertical quad on a wall plane. `alongX`: the plane is z = plane (normal ±Z), else x = plane
 * (normal ±X). Bottom/top heights (and texture bases) may differ at the two ends (sloped walls).
 */
function wallQuad(a: Sink, m: {u: number; v: number}, alongX: boolean, plane: number, nSign: number, a0: number, a1: number,
  yb0: number, yb1: number, yt0: number, yt1: number, vb0: number, vb1: number): void {
  const v0 = (y: number) => (y - vb0) / m.v, v1 = (y: number) => (y - vb1) / m.v;
  if (alongX) {
    const z = plane;
    if (nSign > 0) a.quad([[a0, yb0, z], [a1, yb1, z], [a1, yt1, z], [a0, yt0, z]], [0, 0, 1], [[a0 / m.u, v0(yb0)], [a1 / m.u, v1(yb1)], [a1 / m.u, v1(yt1)], [a0 / m.u, v0(yt0)]]);
    else a.quad([[a1, yb1, z], [a0, yb0, z], [a0, yt0, z], [a1, yt1, z]], [0, 0, -1], [[-a1 / m.u, v1(yb1)], [-a0 / m.u, v0(yb0)], [-a0 / m.u, v0(yt0)], [-a1 / m.u, v1(yt1)]]);
  } else {
    const x = plane;
    if (nSign > 0) a.quad([[x, yb1, a1], [x, yb0, a0], [x, yt0, a0], [x, yt1, a1]], [1, 0, 0], [[-a1 / m.u, v1(yb1)], [-a0 / m.u, v0(yb0)], [-a0 / m.u, v0(yt0)], [-a1 / m.u, v1(yt1)]]);
    else a.quad([[x, yb0, a0], [x, yb1, a1], [x, yt1, a1], [x, yt0, a0]], [-1, 0, 0], [[a0 / m.u, v0(yb0)], [a1 / m.u, v1(yb1)], [a1 / m.u, v1(yt1)], [a0 / m.u, v0(yt0)]]);
  }
}

/** Split [a, b] at multiples of CHUNK_M. */
function chunkSpans(a: number, b: number): [number, number][] {
  const out: [number, number][] = [];
  while (a < b - 1e-6) {
    const e = Math.min(b, (Math.floor(a / CHUNK_M + 1e-9) + 1) * CHUNK_M);
    out.push([a, e]);
    a = e;
  }
  return out;
}

export function buildWorld(layout: StationLayout, mats: WorldMaterials, models: Record<string, GLTF | undefined>): BuiltWorld {
  const g0 = layout.grid;
  const levels = stationLevels(layout);
  const cols = new LevelColumns(levels);
  const gridOf = (level: number): Grid => levels[level]?.grid ?? g0;
  // Level of a world point: the band holding y (else the nearest band below / above) at that column.
  const levelAt: LevelResolver = (x, y, z) => {
    const cx = Math.floor(x / CELL), cy = Math.floor(z / CELL);
    if (cx < 0 || cy < 0 || cx >= g0.w || cy >= g0.h) return 0;
    const i = cy * g0.w + cx;
    let best = 0, bd = Infinity;
    for (let k = 0; k < cols.count(i); k++) {
      const L = cols.level(i, k), g = levels[L].grid;
      const f = g.floorAt(x, z), c = cellCeilAt(g, i);
      const d = y < f - 0.3 ? f - 0.3 - y : y > c + 0.3 ? y - c - 0.3 : 0;
      if (d < bd) { bd = d; best = levels[L].id; }
    }
    return best;
  };
  const instanceModel = (gr: THREE.Group, gltf: GLTF, placements: THREE.Matrix4[], fit: {w: number; h: number; d: number; anchor: 'bottom' | 'top'}, name: string) =>
    addInstancedModel(gr, gltf, placements, fit, name, levelAt);
  const group = new THREE.Group();
  group.name = 'station';
  // Architecture accumulators per (material, level:chunk). Task office-overhaul-20261030 (lane ARCH): keys are MatKeys or the
  // office finish keys of world/officeArch.ts ('office-…', office storeys only), resolved by scaleOf / matOf.
  const acc = new Map<string, {k: string; level: number; levels?: number[]; a: Accum}>();
  const A = (k0: string, chunk: string) => {
    // Task track3-eaton-centre-20261031 (lane ARCH): a mall key carries its finish row ('mall-wall|12'): one accumulator (one
    // material) per base key, the row written per vertex. Keys without '|' (Subway / Office) are untouched.
    const {base: k, row} = k0.includes('|') ? splitFinishKey(k0) : {base: k0, row: -1};
    const key = `${k}@${chunk}`;
    let e = acc.get(key);
    if (!e) acc.set(key, (e = {k, level: Number(chunk.split(':')[0]), levels: chunkLevels(chunk), a: new Accum()}));
    if (row >= 0 || e.a.fin >= 0) e.a.fin = row;
    return e.a;
  };
  // Task office-seamless-20261029: the storeys a stair flight joins (every level grid its ramp is carved into), from a
  // point on the flight; its chunk key carries them ('-1:cx,cz#lower-upper').
  const flightLevels = (x: number, z: number, level: number): number[] => {
    const cx = Math.floor(x / CELL), cy = Math.floor(z / CELL);
    if (cx < 0 || cy < 0 || cx >= g0.w || cy >= g0.h) return [level];
    const i = cy * g0.w + cx, ref = gridOf(level), ri = ref.rampIdx[i];
    if (ri < 0) return [level];
    const R = ref.ramps[ri];
    const out = levels.filter(L => { const r = L.grid.rampIdx[i]; return r >= 0 && rampsEqual(L.grid.ramps[r], R); }).map(L => L.id);
    return out.length ? out : [level];
  };
  // Subway stations (<= LEGACY_STACK levels) keep one merged, never level-culled flight chunk per material (draw calls).
  const tagFlights = levels.length > LEGACY_STACK;
  const stairChunk = (x: number, z: number, ids: number[]) => (tagFlights ? `${chunkKey(STAIR_LEVEL, x, z)}#${ids.join('-')}` : chunkKey(STAIR_LEVEL, x, z));
  // Storefront unit interiors (shop tile walls, quarry-tile floors): shape-material accumulators.
  const shopAcc = new Map<string, {k: string; level: number; levels?: number[]; a: Accum}>();
  const S = (k: string, chunk: string) => {
    const key = `${k}@${chunk}`;
    let e = shopAcc.get(key);
    if (!e) shopAcc.set(key, (e = {k, level: Number(chunk.split(':')[0]), levels: chunkLevels(chunk), a: new Accum()}));
    return e.a;
  };
  const trenchY = layout.trench.floorY;
  let instancesFromTraversal = 0;
  // Task office-seamless-20261029: a tower world (Office Space: storeys above the lobby) measures door heads from each
  // storey's base; Subway stations keep the iteration-08 rule (level 0 at y 0, else the carved cell ceiling).
  const storeyDoors = !!(layout as {office?: unknown}).office || levels.length > 3;
  // Task office-overhaul-20261030 (lane ARCH): the office storeys' architecture (null for the Subway: nothing changes there).
  const office = OfficeArch.for(layout, mats, levels);
  setExteriorRoof(office?.roofY ?? null);
  // Task track3-eaton-centre-20261031 (lane ARCH): the mall's finishes + atrium (null for the Subway and the Office).
  const mall = office ? null : MallArch.for(layout, mats, levels);
  const scaleOf = (k: string): {u: number; v: number} => office?.scale(k) ?? mall?.scale(k) ?? mats.scale[k as MatKey];
  const matOf = (k: string): THREE.Material => office?.material(k) ?? mall?.material(k) ?? mats.get(k as MatKey);

  // --- Walls: union-of-open-columns faces, merged per straight run and level band ----------
  // Iteration 16 (WORLD-GEN): office window spans are cut out of the facade faces (no-op without layout.office).
  const cutFaces: BuiltFace[] = cutOfficeWindows(extractWallFaces(layout, levels, cols, {tileLowerHeight: mats.tileLowerHeight}), layout);
  // Task office-overhaul-20261030 (lane ARCH): office storey walls get office finishes (drywall, accent, wet-room tile, core, roof).
  const faces: BuiltFace[] = office ? office.remapFaces(cutFaces, mats.tileLowerHeight) : mall ? mall.remapFaces(cutFaces, mats.tileLowerHeight) : cutFaces;
  const emitFace = (f: BuiltFace) => {
    const alongX = Math.abs(f.z0 - f.z1) < 1e-9;
    const plane = alongX ? f.z0 : f.x0;
    const s0 = alongX ? f.x0 : f.z0, s1 = alongX ? f.x1 : f.z1;
    const nSign = alongX ? f.nz : f.nx;
    const shop = f.finish === 'tileShop';
    const m = shop ? SHOP_SCALE : scaleOf(f.finish);
    // Flight side walls belong to both levels a flight joins (the 'stairs' pseudo-level, tagged with those storeys: the
    // flight cell in front of the face, on the side its normal faces).
    const lv = f.slope ? STAIR_LEVEL : f.level;
    const mid = (s0 + s1) / 2;
    const tag = f.slope && tagFlights ? flightLevels(alongX ? mid : plane + nSign * CELL / 2, alongX ? plane + nSign * CELL / 2 : mid, f.level) : null;
    const sink = (along: number): Sink => {
      let ck = alongX ? chunkKey(lv, along, plane) : chunkKey(lv, plane, along);
      if (tag) ck += `#${tag.join('-')}`;
      return shop ? S('tileShop', ck) : A(f.finish, ck);
    };
    if (f.slope) {
      wallQuad(sink((s0 + s1) / 2), m, alongX, plane, nSign, s0, s1, f.slope.b0, f.slope.b1, f.slope.t0, f.slope.t1, f.vb0, f.vb1);
      return;
    }
    // Solid parts between openings (full height) and over them (lintels).
    const parts: [number, number, number][] = [];
    let pos = 0;
    for (const o of [...f.openings].sort((p, q) => p.s0 - q.s0)) {
      if (o.s0 > pos + 1e-6) parts.push([pos, o.s0, f.y0]);
      if (o.top < f.y1 - 1e-4) parts.push([o.s0, o.s1, Math.max(f.y0, o.top)]);
      pos = Math.max(pos, o.s1);
    }
    if (s1 - s0 > pos + 1e-6) parts.push([pos, s1 - s0, f.y0]);
    for (const [p0, p1, yb] of parts) {
      for (const [a, b] of chunkSpans(s0 + p0, s0 + p1)) wallQuad(sink((a + b) / 2), m, alongX, plane, nSign, a, b, yb, yb, f.y1, f.y1, f.vb0, f.vb1);
    }
  };
  for (const f of faces) emitFace(f);
  // Lane W: the wall treatment runs once the arch meshes exist (buildWallDetail below).

  // --- Floors and ceilings ------------------------------------------------------------------
  const floorQuadTo = (a: Accum, m: {u: number; v: number}, x0: number, z0: number, x1: number, z1: number, y: number, vFrom?: number, flip = false) => {
    const vz = (z: number) => vFrom !== undefined ? 1 - (flip ? vFrom - z : z - vFrom) / m.v : -z / m.v;
    a.quad([[x0, y, z0], [x0, y, z1], [x1, y, z1], [x1, y, z0]], [0, 1, 0], [[x0 / m.u, vz(z0)], [x0 / m.u, vz(z1)], [x1 / m.u, vz(z1)], [x1 / m.u, vz(z0)]]);
  };
  /** Floor rect split on the chunk grid (world-mapped UVs stay continuous). */
  const floorRect = (mat: MatKey | string | {shop: string}, level: number, x0: number, z0: number, x1: number, z1: number, y = 0, vFrom?: number, flip = false) => {
    const m = typeof mat === 'string' ? scaleOf(mat) : SHOP_SCALE;
    for (const [xa, xb] of chunkSpans(x0, x1)) for (const [za, zb] of chunkSpans(z0, z1)) {
      const ck = chunkKey(level, (xa + xb) / 2, (za + zb) / 2);
      floorQuadTo(typeof mat === 'string' ? A(mat, ck) : S(mat.shop, ck), m, xa, za, xb, zb, y, vFrom, flip);
    }
  };
  const ceilRect = (mat: MatKey | string, level: number, x0: number, z0: number, x1: number, z1: number, y: number) => {
    const m = scaleOf(mat);
    for (const [xa, xb] of chunkSpans(x0, x1)) for (const [za, zb] of chunkSpans(z0, z1)) {
      A(mat, chunkKey(level, (xa + xb) / 2, (za + zb) / 2)).quad([[xa, y, za], [xb, y, za], [xb, y, zb], [xa, y, zb]], [0, -1, 0],
        [[xa / m.u, za / m.v], [xb / m.u, za / m.v], [xb / m.u, zb / m.v], [xa / m.u, zb / m.v]]);
    }
  };
  const n0 = g0.w * g0.h;
  // Floors. Platforms (flat, fully carved on their level): kit slab + mustard safety edge strips along
  // the track side(s). Every other open, non-ramp cell of every level: merged per-row runs at the cell's
  // own floor, material by its area (terrazzo public / concrete service / quarry tile eateries / ballast
  // track bed). Ramp cells are built by traversalBuilder. Floors whose column continues straight down
  // into another band are not drawn.
  const covered = levels.map(() => new Uint8Array(n0));
  // Door openings keep their iteration-7 floor rule (the public side's finish only when both sides are public).
  const doorFloor = new Map<number, MatKey>();
  for (const d of layout.doors) {
    const b = layout.areas[d.b], a = layout.areas[d.a];
    const L = Math.min(levels.length - 1, (d as {level?: number}).level ?? levelOf(a));
    const m = floorMatFor(a.publicSpace && b.publicSpace ? a : b);
    for (let y = d.y; y < d.y + d.h; y++) for (let x = d.x; x < d.x + d.w; x++) doorFloor.set(L * n0 + y * g0.w + x, m);
  }
  for (const id of layout.platforms) {
    const a = layout.areas[id];
    const L = levelOf(a), g = gridOf(L);
    const f0 = g.floorOf(g.idx(a.x, a.y));
    let flat = true;
    for (let y = a.y; y < a.y + a.h && flat; y++) for (let x = a.x; x < a.x + a.w; x++) {
      const i = y * g.w + x;
      if (g.cells[i] !== FLOOR || g.rampIdx[i] >= 0 || Math.abs(g.floorOf(i) - f0) > 1e-4 || g.area[i] !== a.id) { flat = false; break; }
    }
    if (!flat) continue;
    const x0 = a.x * CELL, z0 = a.y * CELL, x1 = (a.x + a.w) * CELL, z1 = (a.y + a.h) * CELL;
    const strip = mats.scale.safetyEdge.v;
    const nE = a.edge !== 'S', sEdge = a.edge === 'S' || a.edge === 'NS';
    if (sEdge) floorRect('safetyEdge', L, x0, z1 - strip, x1, z1, f0, z1, true);
    if (nE) floorRect('safetyEdge', L, x0, z0, x1, z0 + strip, f0, z0);
    floorRect('platformSlab', L, x0, nE ? z0 + strip : z0, x1, sEdge ? z1 - strip : z1, f0);
    for (let y = a.y; y < a.y + a.h; y++) covered[L].fill(1, y * g.w + a.x, y * g.w + a.x + a.w);
  }
  for (let L = 0; L < levels.length; L++) {
    const g = levels[L].grid, id = levels[L].id, W = g.w;
    const floorKey = (i: number): string | null => {
      if (covered[L][i] || g.rampIdx[i] >= 0 || !cols.has(i, L)) return null;
      const c = g.cells[i];
      if (c === VOID) return 'ballast';
      if (c !== FLOOR) return null;
      // The space continues downward (another band ends right at this floor): no floor surface.
      const f = g.floorOf(i);
      for (let k = 0; k < cols.count(i); k++) { const M = cols.level(i, k); if (M !== L && Math.abs(cellCeilAt(levels[M].grid, i) - f) < 0.02) return null; }
      // Task office-overhaul-20261030 (lane ARCH): office storey floors (carpet tiles, vinyl, tile, stone, concrete, roof deck ...).
      const of = office ? office.floorKey(L, i) : mall?.floorKey(L, i); // task track3 (lane ARCH): + the mall's floors
      if (of) return of;
      const dm = doorFloor.get(L * n0 + i);
      if (dm) return dm;
      const a = layout.areas[g.area[i]];
      return a?.type === 'eatery' ? 'shop:quarryTile' : floorMatFor(a);
    };
    for (let y = 0; y < g.h; y++) {
      for (let x = 0; x < W;) {
        const i = y * W + x;
        const key = floorKey(i);
        if (!key) { x++; continue; }
        const f = g.floorOf(i);
        let e = x + 1;
        while (e < W && floorKey(y * W + e) === key && Math.abs(g.floorOf(y * W + e) - f) < 1e-4) e++;
        floorRect(key.startsWith('shop:') ? {shop: key.slice(5)} : key, id, x * CELL, y * CELL, e * CELL, (y + 1) * CELL, f);
        x = e;
      }
    }
  }
  // Door rects: ceiling at the opening (storefront heads stay at the opening head, not the shutter line).
  const doorMask = levels.map(() => new Uint8Array(n0));
  for (const d of layout.doors) {
    const b = layout.areas[d.b], a = layout.areas[d.a];
    const L = Math.min(levels.length - 1, (d as {level?: number}).level ?? levelOf(a)), g = gridOf(L);
    const x0 = d.x * CELL, z0 = d.y * CELL, x1 = (d.x + d.w) * CELL, z1 = (d.y + d.h) * CELL;
    const i = g.idx(d.x, d.y);
    const df = g.floorOf(i);
    for (let y = d.y; y < d.y + d.h; y++) for (let x = d.x; x < d.x + d.w; x++) doorMask[L][y * g0.w + x] = 1;
    // The opening head d.height above a door standing at its storey's base (iteration 08: level 0 at y 0; task
    // office-seamless-20261029: any storey's baseY in a tower world), else the carved cell ceiling.
    const atBase = L === 0 ? df === 0 : storeyDoors && Math.abs(df - levels[L].baseY) < 1e-4;
    ceilRect(office?.doorCeilKey(L, a, b) ?? mall?.doorCeilKey(L, a, b) ?? (b.publicSpace ? 'ceiling' : 'ceilingService'), levels[L].id, x0, z0, x1, z1, atBase ? df + d.height : g.ceil[i]);
  }
  // Ceilings of every level band (slab undersides between overlapping levels included).
  for (const r of ceilingRuns(levels, cols, (L, i) => doorMask[L][i] === 1)) {
    const a = r.voidCell ? undefined : layout.areas[r.area];
    // Task office-overhaul-20261030 (lane ARCH): office ceilings (T-bar grid, plaster, exposed slab, core); none on the open roof.
    // Task track3-eaton-centre-20261031 (lane ARCH): the mall's ceilings; none over the void (the glass vault), track bed included.
    const oc = r.voidCell ? (mall?.ceilKey(r.level, -1, r.row * g0.w + r.x0, r.y) ?? null) : office?.ceilKey(r.level, r.area, r.row * g0.w + r.x0) ?? mall?.ceilKey(r.level, r.area, r.row * g0.w + r.x0, r.y) ?? null;
    if (oc === false) continue;
    ceilRect(oc ?? (r.voidCell || !a || a.publicSpace ? 'ceiling' : 'ceilingService'), levels[r.level].id, r.x0 * CELL, r.row * CELL, r.x1 * CELL, (r.row + 1) * CELL, r.y);
  }
  // Lane T (iteration 05): stair flights (treads, risers, nosings, ceilings, handrails), rescue
  // ladders, underpass track-structure beams, tunnel-mouth barricades. Iteration 08: every level's
  // flights once (a flight shared by two levels is built once); side walls come from the faces above.
  instancesFromTraversal = buildTraversal(group, layout, mats, (k, x, z, level) => A(k, stairChunk(x, z, flightLevels(x, z, level))), {levels, cols});

  let archMeshes = 0;
  for (const [key, e] of acc) {
    const geo = e.a.geometry();
    if (!geo) continue;
    const mesh = new THREE.Mesh(geo, matOf(e.k));
    mesh.name = office?.meshName(e.k) ?? mall?.meshName(e.k) ?? `arch-${key}`;
    mesh.userData.level = e.level;
    if (e.levels) mesh.userData.levels = e.levels;
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
    archMeshes++;
  }
  for (const [key, e] of shopAcc) {
    const geo = e.a.geometry();
    if (!geo) continue;
    // Iteration 12 (ARCH): unit interiors age on their own material copy (the shared shape material stays unaged for props).
    const mesh = new THREE.Mesh(geo, archShopMaterial(mats, e.k));
    mesh.name = `arch-shop-${key}`;
    mesh.userData.level = e.level;
    if (e.levels) mesh.userData.levels = e.levels;
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
    archMeshes++;
  }
  // Iteration 08 (Lane W): zone wall treatments + deterioration over the published faces: insets cut
  // into the arch wall meshes above, plus one merged 'wall-detail' group (world/wallDetail.ts).
  try { buildWallDetail(group, layout, mats, faces); } catch (e) { console.warn('wall detail skipped', e); }
  // Iteration 12 (ARCH): ~30 years without upkeep on walls / floors / ceilings (world/decay.ts): the station's decay
  // field (traffic lanes, edges, leaks, neglect) + the architectural materials' decay hook. Surfaces only.
  try { applyStationDecay(layout, levels, mats); } catch (e) { console.warn('surface decay skipped', e); }

  // Tunnel mouths fade to black beyond the platform ends.
  const voidMat = new MeshBasicNodeMaterial({color: 0x030303}); // Iteration 13 (MAT-A): node material
  for (const t of layout.trenches) {
    for (const x of [t.x0 + 0.01, t.x1 - 0.01]) {
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(t.z1 - t.z0, t.ceil - trenchY), voidMat);
      plane.position.set(x, (t.ceil + trenchY) / 2, (t.z0 + t.z1) / 2);
      plane.rotation.y = x < (t.x0 + t.x1) / 2 ? Math.PI / 2 : -Math.PI / 2;
      group.add(plane);
    }
  }

  // --- Procedural trim: door frames, rails, sleepers, coverboard, handrails, rods ----------
  // Merged per (material, level, coarse trim chunk): trim is cheap, so its chunks are larger than the
  // architecture's (fewer draw calls) while off-screen ends of the station and hidden levels still cull.
  const boxes = new Map<string, {mat: MatKey | string; level: number; list: THREE.BufferGeometry[]}>();
  const trimList = (mat: MatKey | string, x: number, z: number, level: number) => {
    const key = `${mat}@${level}:${Math.floor(x / TRIM_CHUNK_M)},${Math.floor(z / TRIM_CHUNK_M)}`;
    let e = boxes.get(key);
    if (!e) boxes.set(key, (e = {mat, level, list: []}));
    return e.list;
  };
  const addBox = (mat: MatKey | string, cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, rotY = 0) => {
    const b = new THREE.BoxGeometry(sx, sy, sz);
    if (rotY) b.rotateY(rotY);
    b.translate(cx, cy, cz);
    trimList(mat, cx, cz, levelAt(cx, cy, cz)).push(b);
  };
  for (const d of layout.doors) {
    if (d.shopfront) continue; // storefront frames are built by storefrontBuilder
    const g = gridOf((d as {level?: number}).level ?? levelOf(layout.areas[d.a]));
    const i = g.idx(d.x, d.y), df = g.floorOf(i);
    // Opening height above the door's own floor (iteration 08: doors on upper/lower levels; task office-seamless-20261029:
    // in a tower world a door at its storey's base keeps its full opening height, as on level 0 at y 0).
    const dl = storeyDoors ? levels.find(L => L.id === ((d as {level?: number}).level ?? levelOf(layout.areas[d.a]))) : undefined;
    const atBase = df === 0 || (dl !== undefined && Math.abs(df - dl.baseY) < 1e-4);
    const h = atBase ? d.height : Math.min(d.height, (g.hasCeil(i) ? g.ceil[i] : df + d.height) - df);
    const ft = 0.09, fd = CELL + 0.06;
    // Task office-overhaul-20261030 (lane ARCH): office doors get painted / timber joinery frames in the tenant's trim, not steel.
    const fm = office?.doorTrimKey((d as {level?: number}).level ?? levelOf(layout.areas[d.a]), layout.areas[d.a])
      ?? mall?.doorTrimKey((d as {level?: number}).level ?? levelOf(layout.areas[d.a]), layout.areas[d.a]) ?? 'steel'; // task track3 (lane ARCH)
    if (d.h === 1) { // wall runs along X; jambs at both X ends of the opening
      const z = (d.y + 0.5) * CELL;
      const xa = d.x * CELL, xb = (d.x + d.w) * CELL;
      addBox(fm, xa + ft / 2, df + h / 2, z, ft, h, fd);
      addBox(fm, xb - ft / 2, df + h / 2, z, ft, h, fd);
      addBox(fm, (xa + xb) / 2, df + h - 0.05, z, xb - xa, 0.1, fd);
    } else {
      const x = (d.x + 0.5) * CELL;
      const za = d.y * CELL, zb = (d.y + d.h) * CELL;
      addBox(fm, x, df + h / 2, za + ft / 2, fd, h, ft);
      addBox(fm, x, df + h / 2, zb - ft / 2, fd, h, ft);
      addBox(fm, x, df + h - 0.05, (za + zb) / 2, fd, 0.1, zb - za);
    }
  }
  const railY = trenchY + 0.14 + 0.08;
  for (const t of layout.trenches) {
    // Long track members are split on the chunk grid like the architecture.
    for (const [xa, xb] of chunkSpans(t.x0, t.x1)) {
      const len = xb - xa, cx = (xa + xb) / 2;
      t.tracks.forEach((tc, i) => {
        for (const off of [-0.72, 0.72]) addBox('rail', cx, railY, tc + off, len, 0.15, 0.07);
        // Third rail + coverboard on the side away from the platform edge.
        const side = t.third[i] ?? 1;
        addBox('rail', cx, trenchY + 0.3, tc + side * 1.4, len, 0.12, 0.08);
        addBox('coverboard', cx, trenchY + 0.46, tc + side * 1.4, len, 0.035, 0.32);
      });
    }
  }
  // Platform edge lips (both edges of an island).
  for (const id of layout.platforms) {
    const a = layout.areas[id];
    const g = gridOf(levelOf(a));
    const af = g.floorOf(g.idx(a.x, a.y));
    const zs = a.edge === 'NS' ? [a.y * CELL + 0.04, (a.y + a.h) * CELL - 0.04] : [a.edge === 'S' ? (a.y + a.h) * CELL - 0.04 : a.y * CELL + 0.04];
    for (const z of zs) for (const [xa, xb] of chunkSpans(a.x * CELL, (a.x + a.w) * CELL)) addBox('platformFace', (xa + xb) / 2, af - 0.04, z, xb - xa, 0.08, 0.08);
  }
  // Passages (stairs, escalator halls, transfer passages): wall handrails along the side walls.
  // Iteration 07 (Lane DW): rails stop short of every opening (gen/doorways.ts passageRails).
  // Iteration 08: per level (each level's passages against its own grid, lifted to its floor).
  for (const L of levels) {
    const mine = levels.length === 1 ? layout : {...layout, grid: L.grid, areas: layout.areas.map(a => (levelOf(a) === L.id ? a : {...a, type: 'storage' as const}))};
    for (const b of passageRails(mine)) {
      const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
      // passageRails heights are above y 0: lifted to the level's floor there (level 0: its base, y 0 in every station).
      const lift = L.id === 0 ? L.baseY : L.grid.floorAt(cx, cz);
      addBox('steel', cx, (b.y0 + b.y1) / 2 + lift, cz, b.x1 - b.x0, b.y1 - b.y0, b.z1 - b.z0);
    }
  }
  // Pendant rods for fixtures hung below tall ceilings.
  for (const l of layout.lights) {
    if (l.virtual) continue; // Iteration 16 (WORLD-GEN): fixture-less daylight sources have no rods
    // Lane T: the local ceiling (follows flights / landings / the underpass), not the area's top.
    const local = gridOf(levelOf(l)).ceilAt(l.x, l.z);
    const ceil = Math.min(layout.areas[l.area]?.ceil ?? l.y, Number.isFinite(local) ? local : Infinity);
    const rod = ceil - l.y;
    if (rod < 0.1) continue;
    const ax = Math.cos(l.rot) * 0.45, az = -Math.sin(l.rot) * 0.45;
    for (const s of [-1, 1]) addBox('steel', l.x + ax * s, l.y + rod / 2, l.z + az * s, 0.015, rod, 0.015);
  }
  // Guard railings on drop edges (mezzanine/catwalk edges, light wells, stairwells, open flight sides).
  const rails = stationRails(layout, levels, cols);
  // (task office-overhaul-20261030, lane STRUCT: collision-only rails — escalator balustrades, roof fixtures — draw their own geometry)
  // (task track3-eaton-centre-20261031, lane ARCH: the mall's ring rails are drawn as glass balustrades by MallArch.buildAtrium)
  for (const r of rails) if (!(r as {hidden?: boolean}).hidden && !mall?.ownsRail(r)) for (const geo of railGeometry(r)) trimList(r.kind === 'parapet' ? 'platformFace' : 'steel', geo.userData.cx, geo.userData.cz, r.level).push(geo);

  let instances = instancesFromTraversal;
  // Sleepers (instanced, every track of every bed), one instanced mesh per trim chunk.
  {
    const m4 = new THREE.Matrix4();
    const sleeperGeo = new THREE.BoxGeometry(0.24, 0.14, 2.5);
    const byChunk = new Map<string, THREE.Matrix4[]>();
    for (const t of layout.trenches) {
      const per = Math.floor((t.x1 - t.x0) / 0.65);
      for (const tc of t.tracks) for (let i = 0; i < per; i++) {
        const x = t.x0 + 0.3 + i * 0.65;
        const key = `${Math.floor(x / TRIM_CHUNK_M)},${Math.floor(tc / TRIM_CHUNK_M)}`;
        let l = byChunk.get(key);
        if (!l) byChunk.set(key, (l = []));
        l.push(m4.clone().makeTranslation(x, trenchY + 0.07, tc));
      }
    }
    for (const list of byChunk.values()) instances += addInstanced(group, sleeperGeo, mats.get('sleeper'), list, 'sleepers');
  }

  // --- Props: model derivatives instanced, simple shapes procedural ----------------------
  const byKind = new Map<PropKind, PropPlacement[]>();
  for (const p of layout.props) {
    let l = byKind.get(p.kind);
    if (!l) byKind.set(p.kind, (l = []));
    l.push(p);
  }
  // Generated turnstile: kept at its derivative scale (arms are visual only). Its origin is the
  // bounding-box centre including the arms, so shift the cabinet (x 0.142..0.459, z -0.478..0.502
  // per derivatives/props-iteration02.json) onto the collision footprint.
  // Centres the turnstile CABINET (not the arms) on the fare-gate placement: turnstile-t25.glb cabinet top x 0.17..0.45, z +-0.49
  // (Meshy T2.5, 2026-10-29; iteration 02: -0.3005, 0, -0.012).
  const TURNSTILE_CABINET_OFFSET = new THREE.Matrix4().makeTranslation(-0.31, 0, 0);
  const placeM = (p: PropPlacement) => new THREE.Matrix4().compose(new THREE.Vector3(p.x, p.y, p.z), new THREE.Quaternion().setFromAxisAngle(UP, p.rot), new THREE.Vector3(1, 1, 1));
  for (const [kind, list] of byKind) {
    // Cabinets and crates are searchable containers: built and animated by world/containers.ts.
    if (isContainerKind(kind)) continue;
    // Iteration 16 (WORLD-GEN): office furniture (Meshy models / procedural fallbacks; the office desk inside office sections).
    if (isOfficeBuilt(kind, layout)) { instances += buildOfficeProp(group, kind, list, mats, layout, instanceModel, models); continue; }
    // Storefront furniture / glazing / shutters: built by storefrontBuilder.
    if (SHOP_FURNITURE.includes(kind) || SHOP_BLOCKERS.includes(kind)) continue;
    const def = PROP_DEFS[kind];
    const modelKey = MODEL_FOR[kind];
    if (kind === 'fareGate' && models.turnstile) {
      const size = new THREE.Box3().setFromObject(models.turnstile.scene).getSize(new THREE.Vector3());
      instances += instanceModel(group, models.turnstile, list.map(p => placeM(p).multiply(TURNSTILE_CABINET_OFFSET)), {w: size.x, h: size.y, d: size.z, anchor: 'bottom'}, kind);
    } else if (modelKey && models[modelKey]) {
      instances += instanceModel(group, models[modelKey]!, list.map(placeM), {w: def.w, h: def.h, d: def.d, anchor: 'bottom'}, kind);
    } else if (kind === 'column') {
      // Unit-height box scaled per instance (platform/concourse columns differ in height).
      const geo = new THREE.BoxGeometry(def.w, 1, def.d);
      geo.translate(0, 0.5, 0);
      const im = new THREE.InstancedMesh(geo, mats.get('steel'), list.length);
      const m4 = new THREE.Matrix4();
      list.forEach((p, i) => im.setMatrixAt(i, m4.makeScale(1, p.h, 1).setPosition(p.x, p.y, p.z)));
      im.name = 'prop-column';
      im.computeBoundingSphere();
      group.add(im);
      instances += list.length;
    } else if ((kind as PropKind) === 'bin') { // iteration 08 (Lane I): bins are openable holders now (world/openables.ts); dead fallback
      const geo = new THREE.CylinderGeometry(def.w / 2, def.w / 2 * 0.92, def.h, 14, 1);
      geo.translate(0, def.h / 2, 0);
      instances += addInstanced(group, geo, mats.get('bin'), list.map(placeM), 'prop-bin');
    } else if (kind === 'fareGate') {
      const geo = new THREE.BoxGeometry(def.w, def.h, def.d);
      geo.translate(0, def.h / 2, 0);
      instances += addInstanced(group, geo, mats.get('gate'), list.map(placeM), 'prop-fareGate');
    } else {
      instances += addProceduralProp(group, kind, list, mats);
    }
  }

  // --- Light fixtures (model derivative) + emissive tubes ----------------------------------
  // Iteration 16 (WORLD-GEN): `virtual` lights (office daylight) bake into the field but show no fixture, tube or glow card.
  const fixtures: Fixture[] = layout.lights.map((l, i) => ({x: l.x, y: l.y, z: l.z, broken: l.broken, flicker: l.flicker, warm: l.warm, dying: l.dying, power: l.virtual ? 0 : l.power, area: l.area, phase: i * 1.7, level: l.broken ? 0 : 1}));
  const lightMats = layout.lights.map(l => new THREE.Matrix4().compose(new THREE.Vector3(l.x, l.y, l.z), new THREE.Quaternion().setFromAxisAngle(UP, l.rot), l.virtual ? HIDDEN : new THREE.Vector3(1, 1, 1)));
  let tubes: THREE.InstancedMesh | null = null;
  // Task track3-eaton-centre-20261031 (lane ARCH): mall ring fixtures are square downlight cans (their tube = the can's lens).
  const down = (i: number) => !!mall && mall.isDownlight(layout.lights[i]);
  if (models.light) instances += instanceModel(group, models.light, mall ? lightMats.filter((_, i) => !down(i)) : lightMats, {w: mats.fixture.w, h: mats.fixture.h, d: mats.fixture.d, anchor: 'top'}, 'light');
  if (mall) instances += mall.buildDownlights(group, lightMats, layout.lights, mats.fixture);
  {
    const geo = new THREE.BoxGeometry(mats.fixture.w * 0.82, 0.025, mats.fixture.d * 0.42);
    geo.translate(0, -mats.fixture.h - 0.004, 0);
    tubes = new THREE.InstancedMesh(geo, mats.get('tube'), layout.lights.length);
    lightMats.forEach((m, i) => tubes!.setMatrixAt(i, down(i) ? downlightLensMatrix(m, mats.fixture) : m));
    const c = new THREE.Color();
    fixtures.forEach((f, i) => tubes!.setColorAt(i, f.broken ? c.setRGB(0.05, 0.05, 0.05) : c.setRGB(1, 1, 1)));
    tubes.name = 'light-tubes';
    tubes.computeBoundingSphere();
    group.add(tubes);
  }

  // --- Storefront bays (frames, fascias, shutters, glazing, menu boards, counters …) -----------
  instances += buildStorefronts(group, layout, {mat: k => shapeMaterial(mats, k), models, instanceModel});
  // Iteration 16 (WORLD-GEN): office carpet, drop ceilings and window reveals (no-op without layout.office). Task
  // office-overhaul-20261030 (lane ARCH): the carpet / ceilings are the office storeys' own floors / ceilings now (office keys
  // above, no overlay over station finishes); only the window reveals are added here, in the storey's wall finish.
  office?.buildReveals(group);

  // --- Signs (instanced: shared plates, one face mesh per distinct text) --------------------
  instances += buildSigns(group, layout, mats, models.sign, addBox);
  // Task track3-eaton-centre-20261031 (lane ARCH): the mall atrium — glass vault + steel arches, glass balustrades, columns, the
  // glass shaft tower, shopfront / blade / level signage, banners, escalator soffits (world/mallArch.ts).
  if (mall) mall.buildAtrium(group, rails);

  for (const [key, e] of boxes) {
    if (!e.list.length) continue;
    const merged = mergeBoxes(e.list);
    const mesh = new THREE.Mesh(merged, matOf(e.mat));
    mesh.name = `trim-${key}`;
    mesh.userData.level = e.level;
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
  }

  group.updateMatrixWorld(true);
  let triangles = 0, meshes = 0;
  group.traverse(o => {
    // Perf (iteration 09): the station shell never moves (instance matrices / instanceColor / layers / geometry
    // carry every runtime change), so its world matrices are final here: no per-frame compose + force-propagated
    // multiply over ~740 objects in every renderer.render scene.updateMatrixWorld().
    o.matrixAutoUpdate = false;
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    meshes++;
    const geo = m.geometry;
    const tris = (geo.index ? geo.index.count : geo.attributes.position.count) / 3;
    triangles += tris * ((o as THREE.InstancedMesh).isInstancedMesh ? (o as THREE.InstancedMesh).count : 1);
  });
  // Iteration 08: level visibility culling (world/levelCulling.ts); game.ts registers its other station
  // groups (containers, stock) and calls culler.update(camera) before rendering.
  // Task track3-eaton-centre-20261031 (lane ARCH): in the mall the culler also gets the atrium columns (view-dependent visibility).
  const culler = new LevelCuller(levels, cols, levelAt, mall ? {atrium: mall.atrium} : undefined);
  culler.register(group);
  return {group, fixtures, tubes, stats: {meshes, triangles: Math.round(triangles), instances, levels: levels.length, archMeshes}, wallFaces: faces, rails, levelAt, culler,
    ...(office ? {officeArch: office} : {}), ...(mall ? {mallArch: mall} : {})};
}

const UP = new THREE.Vector3(0, 1, 0);
/** Iteration 16: zero scale (hidden instance) for fixture-less lights. */
const HIDDEN = new THREE.Vector3(1e-4, 1e-4, 1e-4);

function addInstanced(group: THREE.Group, geo: THREE.BufferGeometry, mat: THREE.Material, placements: THREE.Matrix4[], name: string, colors?: (THREE.Color | null)[]): number {
  const im = new THREE.InstancedMesh(geo, mat, placements.length);
  placements.forEach((m, i) => im.setMatrixAt(i, m));
  if (colors && colors.some(c => c)) colors.forEach((c, i) => im.setColorAt(i, c ?? WHITE));
  im.name = name;
  im.computeBoundingSphere();
  group.add(im);
  return placements.length;
}
const WHITE = new THREE.Color(1, 1, 1);

// ---------------------------------------------------------------------------------------
// Procedural props (stand-ins for stall/vending/shelf, primitive furniture always)

// Shape-key materials (textured, world-space mapped, shared; keyed by ShapeMat) live in
// world/shapeMaterials.ts (iteration 04, Lane C). Storefront parts use the same keys.
const procMats = shapeMaterials;

function addProceduralProp(group: THREE.Group, kind: PropKind, list: PropPlacement[], mats: WorldMaterials): number {
  const parts = propShape(kind);
  if (!parts) return 0;
  const pm = procMats(mats);
  const byMat = new Map<ShapeMat, THREE.BufferGeometry[]>();
  for (const p of parts) {
    const b = new THREE.BoxGeometry(p.s[0], p.s[1], p.s[2]);
    if (p.rx) b.rotateX(p.rx);
    b.translate(p.p[0], p.p[1], p.p[2]);
    let l = byMat.get(p.m);
    if (!l) byMat.set(p.m, (l = []));
    l.push(b);
  }
  const placements = list.map(p => new THREE.Matrix4().compose(new THREE.Vector3(p.x, p.y, p.z), new THREE.Quaternion().setFromAxisAngle(UP, p.rot), new THREE.Vector3(1, 1, 1)));
  const palette = ACCENT_COLORS[kind];
  const accentColors = palette ? list.map(p => new THREE.Color(palette[p.variant % palette.length])) : undefined;
  for (const [m, geos] of byMat) addInstanced(group, mergeBoxes(geos), pm[m], placements, `prop-${kind}-${m}`, m === 'accent' ? accentColors : undefined);
  return list.length;
}

// ---------------------------------------------------------------------------------------
// Signage

// Plate sizes (SIGN_SIZE / signDims) live in gen/doorways.ts: generation keeps plates off openings.
const signTexCache = new Map<string, THREE.Texture>();

function signTexture(s: SignPlacement, w: number, h: number): THREE.Texture {
  const key = `${s.kind}|${s.text}|${s.arrow ?? ''}|${w.toFixed(2)}${signStyleKey(s)}`;
  let tex = signTexCache.get(key);
  if (tex) return tex;
  if (s.style) tex = companySignTexture(s, w, h); // Task office-overhaul-20261030 (lane TENANTS): company / directory plates
  else if (s.kind === 'station') tex = signPlate(s.text.toUpperCase(), 'station', s.text.length * 31 + 7);
  else {
    const W = 1024, H = Math.max(160, Math.round(1024 * h / w));
    tex = canvasTexture(W, H, s.text.length * 17 + s.kind.length, (ctx, cw, ch) => {
      const light = s.kind === 'service';
      ctx.fillStyle = light ? '#d8cfb6' : '#1f2225';
      ctx.fillRect(0, 0, cw, ch);
      ctx.fillStyle = light ? '#b53a2c' : s.kind === 'exit' ? '#c2463a' : '#d9a520';
      ctx.fillRect(0, ch - ch * 0.1, cw, ch * 0.045);
      let x = 36;
      let text = s.text;
      if (s.kind === 'platform') {
        const m = /^(\d+)\s*·?\s*(.*)$/.exec(text);
        if (m) {
          const r = ch * 0.34;
          ctx.fillStyle = '#d9a520';
          ctx.beginPath(); ctx.arc(36 + r, ch / 2 - ch * 0.04, r, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#1f2225';
          ctx.font = `bold ${Math.round(r * 1.3)}px "Helvetica Neue", Arial, sans-serif`;
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(m[1], 36 + r, ch / 2 - ch * 0.02);
          ctx.textAlign = 'left';
          x = 36 + r * 2 + 30;
          text = m[2];
        }
      }
      const arrowW = s.arrow ? ch * 0.6 : 0;
      ctx.fillStyle = light ? '#1f2225' : '#ece4cf';
      let size = Math.round(ch * 0.5);
      const font = () => `bold ${size}px "Helvetica Neue", Arial, sans-serif`;
      ctx.font = font();
      while (ctx.measureText(text).width > cw - x - 40 - arrowW && size > 24) { size -= 3; ctx.font = font(); }
      ctx.textBaseline = 'middle';
      ctx.fillText(text, x, ch / 2 - ch * 0.04);
      if (s.arrow) {
        const ax = cw - 30 - arrowW / 2, ay = ch / 2 - ch * 0.04, r = arrowW * 0.42;
        ctx.save();
        ctx.translate(ax, ay);
        ctx.rotate({right: 0, down: Math.PI / 2, left: Math.PI, up: -Math.PI / 2}[s.arrow]);
        ctx.beginPath(); ctx.moveTo(r, 0); ctx.lineTo(-r * 0.2, -r); ctx.lineTo(-r * 0.2, -r * 0.4); ctx.lineTo(-r, -r * 0.4); ctx.lineTo(-r, r * 0.4); ctx.lineTo(-r * 0.2, r * 0.4); ctx.lineTo(-r * 0.2, r); ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
    });
  }
  signTexCache.set(key, tex);
  return tex;
}

function buildSigns(group: THREE.Group, layout: StationLayout, mats: WorldMaterials, signModel: GLTF | undefined,
  addBox: (mat: MatKey, cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, rotY?: number) => void): number {
  const plates: THREE.Matrix4[] = [];
  const stationFrames: THREE.Matrix4[] = [];
  const faces = new Map<THREE.Texture, THREE.Matrix4[]>();
  const q = new THREE.Quaternion();
  const addFace = (tex: THREE.Texture, m: THREE.Matrix4) => { let l = faces.get(tex); if (!l) faces.set(tex, (l = [])); l.push(m); };
  // Station sign model fit (as WorldMaterials.makeSign): back at z = 0, front at frameDepth.
  let frameDepth = 0.02;
  let frameLocal: {mesh: THREE.Mesh; local: THREE.Matrix4}[] = [];
  if (signModel) {
    const root = signModel.scene;
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root);
    const size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
    const {w, h} = SIGN_SIZE.station;
    const fit = new THREE.Matrix4().makeTranslation(-c.x * w / size.x, -c.y * h / size.y, -box.min.z).multiply(new THREE.Matrix4().makeScale(w / size.x, h / size.y, 1));
    frameDepth = size.z;
    root.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) frameLocal.push({mesh: m, local: new THREE.Matrix4().multiplyMatrices(fit, m.matrixWorld)}); });
  }
  for (const s of layout.signs) {
    const size = SIGN_SIZE[s.kind];
    const {w, h} = signDims(s);
    const tex = signTexture(s, w, h);
    const sides = s.hang ? [s.rot, s.rot + Math.PI] : [s.rot];
    const useFrame = s.kind === 'station' && frameLocal.length && !s.hang && (s.w === undefined || s.w === size.w);
    const depth = useFrame ? frameDepth : 0.02;
    const base = new THREE.Matrix4().compose(new THREE.Vector3(s.x, s.y, s.z), q.setFromAxisAngle(UP, s.rot), new THREE.Vector3(1, 1, 1));
    if (useFrame) stationFrames.push(base.clone());
    else {
      // Unit plate scaled to the sign size; wall plates sit against the wall, hanging plates centred.
      const zc = s.hang ? 0 : depth / 2 + 0.002;
      plates.push(base.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0, zc)).multiply(new THREE.Matrix4().makeScale(w, h, s.hang ? 0.03 : depth)));
    }
    sides.forEach((r, k) => {
      const front = s.hang ? 0.016 : depth + 0.004;
      const m = new THREE.Matrix4().compose(new THREE.Vector3(s.x, s.y, s.z), q.setFromAxisAngle(UP, r), new THREE.Vector3(1, 1, 1))
        .multiply(new THREE.Matrix4().makeTranslation(0, 0, front)).multiply(new THREE.Matrix4().makeScale(w * 0.96, h * 0.8, 1));
      // The back of a hanging sign mirrors left/right arrows so both faces point the same way in the world.
      const flip = k === 1 && (s.arrow === 'left' || s.arrow === 'right');
      addFace(flip ? signTexture({...s, arrow: s.arrow === 'left' ? 'right' : 'left'}, w, h) : tex, m);
    });
    if (s.hang) {
      // Two drop rods to the ceiling.
      const ceil = layout.areas[s.area]?.ceil ?? s.y + 1;
      const rod = ceil - (s.y + h / 2);
      if (rod > 0.05) {
        const ax = Math.cos(s.rot) * w * 0.38, az = -Math.sin(s.rot) * w * 0.38;
        for (const k of [-1, 1]) addBox('steel', s.x + ax * k, s.y + h / 2 + rod / 2, s.z + az * k, 0.015, rod, 0.015);
      }
    }
  }
  let n = 0;
  if (plates.length) {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    n += addInstanced(group, geo, mats.get('steel'), plates, 'sign-plates');
  }
  if (stationFrames.length) {
    for (const {mesh, local} of frameLocal) n += addInstanced(group, mesh.geometry, mesh.material as THREE.Material, stationFrames.map(m => m.clone().multiply(local)), 'sign-frame');
  }
  n += buildSignFaces(group, faces);
  return n;
}

// Iteration 08 (Lane G): sign faces share atlas pages (one draw call per page instead of one per
// distinct text): every distinct sign texture is redrawn into a padded 512 px-wide cell, and each face
// instance carries its cell's UV rect (aUvRect) — same plates, same texts, ~30 fewer draw calls.
const SIGN_CELL_W = 512, SIGN_PAGE_W = 1024, SIGN_PAGE_MAX_H = 2048, SIGN_PAD = 4;
// Iteration 13 (MAT-A): the iteration-08 GLSL hook 'sign-atlas-v1' as a node-material context: the map samples
// uv * aUvRect.zw + aUvRect.xy (per-instance rect, then the map transform), surfaceNodes.ts SIGN_ATLAS_CONTEXT.
export const signAtlasMat = (atlas: THREE.Texture): MeshStandardNodeMaterial => {
  const m = new MeshStandardNodeMaterial({map: atlas, roughness: 0.6});
  m.name = 'sign-atlas';
  m.contextNode = SIGN_ATLAS_CONTEXT;
  return m;
};

/** Pack the face textures into atlas cells: [page, x, y, w, h] per texture, plus each page's height. */
export function packSignAtlas(sizes: readonly {width: number; height: number}[]): {cells: [number, number, number, number, number][]; pages: number[]} {
  const cells: [number, number, number, number, number][] = [];
  const pages: number[] = [];
  let page = 0, col = 0, rowY = 0, rowH = 0;
  for (const img of sizes) {
    const w = SIGN_CELL_W, h = Math.max(16, Math.round(SIGN_CELL_W * img.height / Math.max(1, img.width)));
    if (col + w + 2 * SIGN_PAD > SIGN_PAGE_W) { col = 0; rowY += rowH; rowH = 0; }
    if (rowY + h + 2 * SIGN_PAD > SIGN_PAGE_MAX_H) { pages.push(rowY); page++; col = 0; rowY = 0; rowH = 0; }
    cells.push([page, col + SIGN_PAD, rowY + SIGN_PAD, w, h]);
    col += w + 2 * SIGN_PAD;
    rowH = Math.max(rowH, h + 2 * SIGN_PAD);
  }
  pages.push(rowY + rowH);
  return {cells, pages: pages.map(hh => Math.max(16, Math.ceil(hh / 4) * 4))};
}

function buildSignFaces(group: THREE.Group, faces: Map<THREE.Texture, THREE.Matrix4[]>): number {
  if (!faces.size) return 0;
  const texs = [...faces.keys()];
  const imgs = texs.map(t => t.image as {width: number; height: number});
  const {cells, pages} = packSignAtlas(imgs);
  let n = 0;
  pages.forEach((H, pg) => {
    const mine = cells.map((c, i) => [c, i] as const).filter(([c]) => c[0] === pg);
    const atlas = canvasTexture(SIGN_PAGE_W, H, 7000 + pg, ctx => {
      ctx.fillStyle = '#1f2225';
      ctx.fillRect(0, 0, SIGN_PAGE_W, H);
      for (const [[, x, y, w, h], i] of mine) {
        const img = imgs[i] as unknown as CanvasImageSource;
        // Stretched copy under the padding (no dark seams at low mip levels), then the exact cell.
        ctx.drawImage(img, x - SIGN_PAD, y - SIGN_PAD, w + 2 * SIGN_PAD, h + 2 * SIGN_PAD);
        ctx.drawImage(img, x, y, w, h);
      }
    });
    atlas.wrapS = atlas.wrapT = THREE.ClampToEdgeWrapping;
    const mats4: THREE.Matrix4[] = [], rects: number[] = [];
    for (const [[, x, y, w, h], i] of mine) for (const m of faces.get(texs[i])!) {
      mats4.push(m);
      // Canvas y runs down, texture v up (flipY).
      rects.push(x / SIGN_PAGE_W, 1 - (y + h) / H, w / SIGN_PAGE_W, h / H);
    }
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.setAttribute('aUvRect', new THREE.InstancedBufferAttribute(new Float32Array(rects), 4));
    n += addInstanced(group, geo, signAtlasMat(atlas), mats4, 'sign-face');
  });
  return n;
}


// ---------------------------------------------------------------------------------------
// Guard railings (iteration 08): top rail, mid rail, posts and a toe board along a drop edge; sloped
// along open flight sides (plus a stringer covering the tread ends). Boxes, merged into the trim.

function beamGeo(a: THREE.Vector3, b: THREE.Vector3, t: number, t2 = t): THREE.BufferGeometry | null {
  const d = new THREE.Vector3().subVectors(b, a);
  const len = d.length();
  if (len < 1e-4) return null;
  const g = new THREE.BoxGeometry(t, t2, len);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), d.normalize()));
  g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return g;
}

function railGeometry(r: RailRun): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  const len = Math.hypot(r.x1 - r.x0, r.z1 - r.z0);
  const P = (s: number, dy: number) => {
    const u = len > 0 ? s / len : 0;
    return new THREE.Vector3(r.x0 + (r.x1 - r.x0) * u, r.y0 + (r.y1 - r.y0) * u + dy, r.z0 + (r.z1 - r.z0) * u);
  };
  const push = (g: THREE.BufferGeometry | null) => { if (g) out.push(g); };
  if (r.kind === 'parapet') {
    // Solid low concrete upstand (0.15 m thick) on the edge.
    for (const [a, b] of [[0.01, len - 0.01]]) push(beamGeo(P(a, 0.5), P(b, 0.5), 0.15, 1.0));
  } else {
    const sloped = Math.abs(r.y1 - r.y0) > 1e-3;
    push(beamGeo(P(0, RAIL_HEIGHT), P(len, RAIL_HEIGHT), 0.05, 0.05));
    push(beamGeo(P(0, 0.55), P(len, 0.55), 0.03, 0.03));
    if (!sloped) push(beamGeo(P(0.02, 0.06), P(len - 0.02, 0.06), 0.02, 0.1)); // toe board
    else push(beamGeo(P(0, -0.04), P(len, -0.04), 0.06, 0.34)); // stringer over the tread ends
    const n = Math.max(1, Math.ceil(len / 1.25));
    for (let k = 0; k <= n; k++) {
      const s = Math.min(len - 0.03, Math.max(0.03, (len * k) / n));
      const base = P(s, 0);
      const g = new THREE.BoxGeometry(0.05, RAIL_HEIGHT, 0.05);
      g.translate(base.x, base.y + RAIL_HEIGHT / 2, base.z);
      out.push(g);
    }
  }
  const c = P(len / 2, 0);
  for (const g of out) { g.userData.cx = c.x; g.userData.cz = c.z; }
  return out;
}

// ---------------------------------------------------------------------------------------

function mergeBoxes(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let vCount = 0, iCount = 0;
  for (const b of list) { vCount += b.attributes.position.count; iCount += b.index!.count; }
  const pos = new Float32Array(vCount * 3), nor = new Float32Array(vCount * 3), uv = new Float32Array(vCount * 2);
  const idx = new Uint32Array(iCount);
  let vo = 0, io = 0;
  for (const b of list) {
    pos.set(b.attributes.position.array as Float32Array, vo * 3);
    nor.set(b.attributes.normal.array as Float32Array, vo * 3);
    uv.set(b.attributes.uv.array as Float32Array, vo * 2);
    const src = b.index!.array;
    for (let i = 0; i < src.length; i++) idx[io + i] = src[i] + vo;
    vo += b.attributes.position.count;
    io += src.length;
    b.dispose();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  return g;
}

/** Level id of a world point (the band holding y; 0 when unknown). See BuiltWorld.levelAt. */
export type LevelResolver = (x: number, y: number, z: number) => number;

/**
 * Split instance placements into culling chunks: CHUNK m in X/Z, per level (the band holding the
 * instance origin). Key `level:cx,cz`. Shared by model props, storefront fittings and shelf stock so
 * every instanced group culls the same way.
 */
export function chunkInstances(placements: readonly THREE.Matrix4[], levelAt?: LevelResolver): Map<string, {level: number; list: THREE.Matrix4[]}> {
  const chunks = new Map<string, {level: number; list: THREE.Matrix4[]}>();
  const pos = new THREE.Vector3();
  for (const p of placements) {
    pos.setFromMatrixPosition(p);
    const level = levelAt ? levelAt(pos.x, pos.y, pos.z) : 0;
    const key = `${level}:${Math.floor(pos.x / CHUNK)},${Math.floor(pos.z / CHUNK)}`;
    let e = chunks.get(key);
    if (!e) chunks.set(key, (e = {level, list: []}));
    e.list.push(p);
  }
  return chunks;
}

/**
 * Instances every mesh of a GLB derivative. The model is fitted to the target footprint
 * (width X, height Y, depth Z) with its base (or top, for hanging fixtures) at the origin.
 * Instances are split per level and CHUNK-m chunk (chunkInstances) so off-screen chunks are culled.
 */
export function addInstancedModel(group: THREE.Group, gltf: GLTF, placements: THREE.Matrix4[], fit: {w: number; h: number; d: number; anchor: 'bottom' | 'top'}, name: string, levelAt?: LevelResolver): number {
  if (!placements.length) return 0;
  const root = gltf.scene;
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const s = new THREE.Vector3(fit.w / size.x, fit.h / size.y, fit.d / size.z);
  const center = box.getCenter(new THREE.Vector3());
  const anchorY = fit.anchor === 'bottom' ? box.min.y : box.max.y;
  const fitM = new THREE.Matrix4().makeScale(s.x, s.y, s.z).multiply(new THREE.Matrix4().makeTranslation(-center.x, -anchorY, -center.z));
  const chunks = chunkInstances(placements, levelAt);
  let count = 0;
  root.traverse(o => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const local = new THREE.Matrix4().multiplyMatrices(fitM, mesh.matrixWorld);
    const m = new THREE.Matrix4();
    for (const {level, list} of chunks.values()) {
      const im = new THREE.InstancedMesh(mesh.geometry, mesh.material, list.length);
      list.forEach((p, i) => im.setMatrixAt(i, m.multiplyMatrices(p, local)));
      im.name = `prop-${name}`;
      im.userData.level = level;
      im.computeBoundingSphere();
      group.add(im);
      count += list.length;
    }
  });
  return count;
}

export function gridStats(g: Grid): {floor: number; void: number} {
  let floor = 0, v = 0;
  for (const c of g.cells) { if (c === FLOOR) floor++; else if (c === VOID) v++; }
  return {floor, void: v};
}
