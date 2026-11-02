// Task reactor-expansion-20261101 (lane MINES): the RUNTIME LOOK of the old mine workings (installed from ReactorArch.build: one tagged
// line in world/reactor/arch.ts). Everything is derived from the generated layout (layout.reactor.complexes 'mines' + its areas, doors
// and the dress pass's collision set pieces, gen/reactor/complex/minesDress.ts MINE_PIECE), so what you see is where you collide:
//  - TIMBER SUPPORT SETS along every drift (the lead's Meshy timberSet, instanced) on the post collision boxes the dress pass placed
//    (minesDress.ts placeTimberSets: the whole set inside the drift's rock walls, posts proud of the rib and colliding, cap >= 2.3 m
//    clear, never on an opening's cells, a prop, a lamp or a plate);
//  - the narrow-gauge RAIL LINE (600 mm: rail steel on timber sleepers, steel turnplates at the bends) from the adit mouth through the
//    junction and the haulage to the stope's loading point; it stops short of anything standing on it;
//  - the ORE CARTS / HOIST WINCH / DRILL JUMBO models on their collision boxes (Meshy maps kept), the WINZE (timber collar, a black
//    shaft mouth, a steel guard fence, a timber headframe with its sheave and the winch rope), timber CRIBS up to the stope roof, the
//    RUBBLE choking the collapsed drift, standing WATER over the flooded sump's far end, the generator's timber skid bed.
// Materials are the repo's EXISTING approved sets (timber = the track sleeper set, rail steel, the Reactor's Codex rusted steel / pit
// concrete through archMaterials) — no new hand-drawn texture; the water surface is a dynamic effect material (no texture). Without a
// loaded model (Node tests, a failed fetch) the same records draw textured procedural stand-ins. All meshes are instanced / merged per
// material and tagged with the storey (userData.level) for the level culler; no lights, nothing per frame.

import * as THREE from 'three';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {MeshBasicNodeMaterial, MeshStandardNodeMaterial} from 'three/webgpu';
import {CELL} from '../../gen/grid';
import type {StationLayout} from '../../gen/stationTypes';
import type {PropPlacement} from '../../gen/props';
import {MINE_PIECE, MINE_RAIL, alongPolyline, minesRailWorld, timberSetFit, type RailPoint} from '../../gen/reactor/complex/minesDress';
import type {WorldMaterials} from '../materials';
import {reactorDress, reactorSurfaceMaterial} from './archMaterials';
import {MINES_MODELS, type MinesModel} from './minesAssets';

/** One instanced placement: position (bottom centre), yaw, scale. */
export interface MinePlace { x: number; y: number; z: number; yaw: number; sx: number; sy: number; sz: number }
/** A box (centre, size, yaw about y, optional tilt about its local x / z). */
export interface MineBox { x: number; y: number; z: number; w: number; h: number; d: number; yaw: number; rx?: number; rz?: number }

export type MineMat = 'timber' | 'rail' | 'steel' | 'rock' | 'water' | 'hole' | 'rope';

export interface MinesVisualPlan {
  level: number;
  models: Record<MinesModel, MinePlace[]>;
  boxes: Record<MineMat, MineBox[]>;
  /** Sheave wheels (centre, radius, yaw of the wheel's plane normal). */
  sheaves: {x: number; y: number; z: number; r: number; yaw: number}[];
  stats: {sets: number; setsSkipped: number; railM: number; sleepers: number; cribs: number; rubble: number; water: number};
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;
/** Deterministic 0..1 hash of a few numbers (rubble chunk sizes / tilts). */
const hash = (...v: number[]): number => { let h = 2166136261; for (const x of v) { h ^= Math.round(x * 1000); h = Math.imul(h, 16777619); } return ((h >>> 0) % 10007) / 10007; };

/**
 * A box clamped INSIDE a collision prop's box (axis-aligned annexMachine: x / z +- hx / hz, y base .. base + h), 1 cm in: its rotated
 * extent (yaw, then the x / z tilts, 'YXZ') is measured, the box shrunk if it cannot fit, then its centre moved in.
 */
function within(p: PropPlacement, base: number, b: MineBox): MineBox {
  const R = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(b.rx ?? 0, b.yaw, b.rz ?? 0, 'YXZ')).elements;
  // column-major: R[c * 4 + r]
  const ext = (k: number, hw: number, hh: number, hd: number) => Math.abs(R[k]) * hw + Math.abs(R[4 + k]) * hh + Math.abs(R[8 + k]) * hd;
  const lim = [p.hx - 0.01, p.h / 2 - 0.01, p.hz - 0.01];
  let w = b.w, h = b.h, d = b.d;
  const e0 = [ext(0, w / 2, h / 2, d / 2), ext(1, w / 2, h / 2, d / 2), ext(2, w / 2, h / 2, d / 2)];
  const f = Math.min(1, ...e0.map((e, k) => lim[k] / Math.max(e, 1e-6)));
  if (f < 1) { w *= f; h *= f; d *= f; }
  const e = [ext(0, w / 2, h / 2, d / 2), ext(1, w / 2, h / 2, d / 2), ext(2, w / 2, h / 2, d / 2)];
  const cl = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  return {...b, w, h, d,
    x: r3(cl(b.x, p.x - p.hx + 0.01 + e[0], p.x + p.hx - 0.01 - e[0])),
    y: r3(cl(b.y, base + 0.01 + e[1], base + p.h - 0.01 - e[1])),
    z: r3(cl(b.z, p.z - p.hz + 0.01 + e[2], p.z + p.hz - 0.01 - e[2]))};
}

interface MinesRec { level: number; base: number; rooms: {key: string; area: number}[]; areas: number[] }

/** The mines complex of a Reactor layout (null on any other layout / without one). */
export function minesRecord(layout: StationLayout): MinesRec | null {
  const c = layout.reactor?.complexes?.find(q => q.id === 'mines');
  if (!c || !c.areas.length) return null;
  const a0 = layout.areas[c.areas[0]];
  return {level: c.level, base: a0?.floorY ?? layout.levels[c.level]?.baseY ?? 0, rooms: c.rooms.map(r => ({key: r.key, area: r.area})), areas: [...c.areas]};
}

/** Lamps of the mine areas are caged lamps (ReactorArch.isLamp). */
export function isMineArea(layout: StationLayout, area: number | undefined): boolean {
  if (area === undefined) return false;
  const c = layout.reactor?.complexes?.find(q => q.id === 'mines');
  return !!c && c.areas.includes(area);
}


export function planMinesVisuals(layout: StationLayout): MinesVisualPlan | null {
  const rec = minesRecord(layout);
  if (!rec) return null;
  const {base, level} = rec;
  const g = layout.levels[level]?.grid;
  if (!g) return null;
  const plan: MinesVisualPlan = {
    level, models: {timberSet: [], mineCart: [], hoistWinch: [], drillRig: []},
    boxes: {timber: [], rail: [], steel: [], rock: [], water: [], hole: [], rope: []}, sheaves: [],
    stats: {sets: 0, setsSkipped: 0, railM: 0, sleepers: 0, cribs: 0, rubble: 0, water: 0},
  };
  const mine = new Set(rec.areas);
  const props = layout.props.filter(p => mine.has(p.area));
  const pieces = props.filter(p => p.kind === 'annexMachine');
  const of = (v: number) => pieces.filter(p => p.variant === v);
  const byKey = (k: string) => { const r = rec.rooms.find(q => q.key === k); return r ? layout.areas[r.area] : undefined; };
  const box = (m: MineMat, b: MineBox) => { plan.boxes[m].push(b); };

  // --- timber support sets: one per pair of post collision boxes the dress pass placed (minesDress.ts placeTimberSets) --------------
  {
    const seen = new Set<string>();
    for (const p of of(MINE_PIECE.post)) {
      const a = layout.areas[p.area], alongX = a.w >= a.h, s = alongX ? p.x : p.z, key = `${a.id}:${Math.round(s * 100)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const Wd = (alongX ? a.h : a.w) * CELL, mid = (alongX ? a.y : a.x) * CELL + Wd / 2, fit = timberSetFit(Wd, a.ceil - base);
      plan.models.timberSet.push({x: r3(alongX ? s : mid), y: base, z: r3(alongX ? mid : s), yaw: alongX ? Math.PI / 2 : 0, sx: r3(fit.sx), sy: r3(fit.sy), sz: 1});
    }
    plan.stats.sets = plan.models.timberSet.length;
  }

  // --- the rail line -------------------------------------------------------------------------------------------------------------
  const rail = minesRailWorld(layout, rec.rooms);
  const solid = props.filter(p => !(p.kind === 'annexMachine' && p.variant === MINE_PIECE.cart) && !p.mounted && p.host === undefined);
  const onProp = (x: number, z: number) => solid.some(p => Math.abs(p.x - x) < p.hx + 0.1 && Math.abs(p.z - z) < p.hz + 0.1);
  const corners = rail.slice(1, -1);
  const nearCorner = (x: number, z: number) => corners.some(c => Math.abs(c.x - x) < 0.6 && Math.abs(c.z - z) < 0.6);
  for (let i = 0; i + 1 < rail.length; i++) {
    const a = rail[i], b = rail[i + 1], L = Math.hypot(b.x - a.x, b.z - a.z);
    if (L < 0.05) continue;
    const dx = (b.x - a.x) / L, dz = (b.z - a.z) / L, yaw = Math.atan2(dx, dz);
    // 0.65 m pieces (one sleeper each); a piece under a standing prop or inside a bend's turnplate is left out
    const pieces = Math.max(1, Math.round(L / MINE_RAIL.pitch)), step = L / pieces;
    for (let k = 0; k < pieces; k++) {
      const cx = a.x + dx * (k + 0.5) * step, cz = a.z + dz * (k + 0.5) * step;
      if (onProp(cx, cz) || nearCorner(cx, cz)) continue;
      box('timber', {x: r3(cx), y: base + 0.03, z: r3(cz), w: MINE_RAIL.sleeper, h: 0.06, d: 0.16, yaw});
      for (const off of [-MINE_RAIL.gauge / 2, MINE_RAIL.gauge / 2]) box('rail', {x: r3(cx - dz * off), y: base + 0.1, z: r3(cz + dx * off), w: 0.06, h: 0.08, d: step + 0.002, yaw});
      plan.stats.sleepers++;
      plan.stats.railM += step;
    }
  }
  for (const c of corners) box('steel', {x: c.x, y: base + 0.015, z: c.z, w: 1.25, h: 0.03, d: 1.25, yaw: 0});

  // --- ore carts, the winch, the drill jumbo (models on their collision boxes) ------------------------------------------------------
  for (const p of of(MINE_PIECE.cart)) plan.models.mineCart.push({x: p.x, y: p.y, z: p.z, yaw: p.hx >= p.hz ? 0 : Math.PI / 2, sx: 1, sy: 1, sz: 1});
  const winzes = of(MINE_PIECE.winze);
  for (const p of of(MINE_PIECE.winch)) {
    const wz = winzes.slice().sort((q, r) => Math.hypot(q.x - p.x, q.z - p.z) - Math.hypot(r.x - p.x, r.z - p.z))[0];
    const fx = wz ? Math.sign(Math.abs(wz.x - p.x) > Math.abs(wz.z - p.z) ? wz.x - p.x : 0) : 0, fz = wz ? Math.sign(Math.abs(wz.z - p.z) >= Math.abs(wz.x - p.x) ? wz.z - p.z : 0) : 1;
    plan.models.hoistWinch.push({x: p.x, y: p.y, z: p.z, yaw: Math.atan2(fx, fz), sx: 1, sy: 1, sz: 1});
  }
  for (const p of of(MINE_PIECE.drill)) {
    const a = layout.areas[p.area], alongX = p.hx >= p.hz;
    // its back to the nearer wall: the front (+Z) faces into the room
    const yaw = alongX ? (p.z - a.y * CELL < (a.y + a.h) * CELL - p.z ? 0 : Math.PI) : (p.x - a.x * CELL < (a.x + a.w) * CELL - p.x ? Math.PI / 2 : -Math.PI / 2);
    plan.models.drillRig.push({x: p.x, y: p.y, z: p.z, yaw, sx: 1, sy: 1, sz: 1});
  }

  // --- the winze: timber collar, black shaft mouth, guard fence, headframe + sheave + rope ---------------------------------------------
  for (const p of winzes) {
    const a = layout.areas[p.area], top = Math.min(a.ceil - 0.25, base + 4.2), hw = p.hx;
    box('hole', {x: p.x, y: base + 0.012, z: p.z, w: hw * 2 - 0.5, h: 0.004, d: hw * 2 - 0.5, yaw: 0});
    for (const [ox, oz, w, d] of [[0, -(hw - 0.12), hw * 2, 0.24], [0, hw - 0.12, hw * 2, 0.24], [-(hw - 0.12), 0, 0.24, hw * 2 - 0.48], [hw - 0.12, 0, 0.24, hw * 2 - 0.48]] as const) box('timber', {x: p.x + ox, y: base + 0.12, z: p.z + oz, w, h: 0.24, d, yaw: 0});
    for (const sxn of [-1, 1]) for (const szn of [-1, 1]) box('steel', {x: p.x + sxn * (hw - 0.05), y: base + 0.55, z: p.z + szn * (hw - 0.05), w: 0.06, h: 1.1, d: 0.06, yaw: 0});
    for (const y of [0.55, 1.05]) for (const [ox, oz, w, d] of [[0, -(hw - 0.05), hw * 2, 0.04], [0, hw - 0.05, hw * 2, 0.04], [-(hw - 0.05), 0, 0.04, hw * 2], [hw - 0.05, 0, 0.04, hw * 2]] as const) box('steel', {x: p.x + ox, y: base + y, z: p.z + oz, w, h: 0.05, d, yaw: 0});
    // headframe: two timber legs on the collar's x sides leaning in, a head beam, the sheave over the shaft centre
    if (top - base > 2.6) {
      const H = top - base;
      for (const sxn of [-1, 1]) box('timber', {x: p.x + sxn * (hw - 0.3), y: base + H / 2, z: p.z, w: 0.22, h: H, d: 0.22, yaw: 0, rz: sxn * 0.12});
      box('timber', {x: p.x, y: top - 0.15, z: p.z, w: hw * 2 - 0.2, h: 0.26, d: 0.3, yaw: 0});
      plan.sheaves.push({x: p.x, y: top - 0.6, z: p.z, r: 0.42, yaw: 0});
      const ropeTop = top - 0.6 - 0.42, ropeBot = base - 0.8; // down the shaft centre from the sheave
      box('rope', {x: p.x, y: (ropeTop + ropeBot) / 2, z: p.z, w: 0.03, h: ropeTop - ropeBot, d: 0.03, yaw: 0});
      const w = of(MINE_PIECE.winch).sort((q, r) => Math.hypot(q.x - p.x, q.z - p.z) - Math.hypot(r.x - p.x, r.z - p.z))[0];
      if (w) {
        // rope from the drum (~1.0 m up the winch) to the sheave's top
        const ax = w.x, ay = base + 1.05, az = w.z, bx = p.x, by = top - 0.2, bz = p.z;
        const L = Math.hypot(bx - ax, by - ay, bz - az), hor = Math.hypot(bx - ax, bz - az);
        box('rope', {x: (ax + bx) / 2, y: (ay + by) / 2, z: (az + bz) / 2, w: 0.03, h: L, d: 0.03, yaw: Math.atan2(bx - ax, bz - az), rx: Math.atan2(hor, by - ay)});
      }
    }
  }

  // --- timber cribs up to the stope roof (alternating layers of two timbers) ---------------------------------------------------------
  for (const p of of(MINE_PIECE.crib)) {
    const layers = Math.max(1, Math.floor(p.h / 0.2));
    for (let k = 0; k < layers; k++) {
      const y = p.y + 0.1 + k * 0.2, alongX = k % 2 === 0;
      for (const o of [-(p.hx - 0.11), p.hx - 0.11]) box('timber', alongX ? {x: p.x, y, z: p.z + o, w: p.hx * 2, h: 0.2, d: 0.2, yaw: 0} : {x: p.x + o, y, z: p.z, w: 0.2, h: 0.2, d: p.hz * 2, yaw: 0});
    }
    plan.stats.cribs++;
  }

  // --- rubble choking the collapsed drift: a slope of rock chunks rising to the far end, a fallen cap timber -------------------------
  for (const p of of(MINE_PIECE.rubble)) {
    const a = layout.areas[p.area], alongX = a.w >= a.h;
    const door = layout.doors.find(d => d.a === a.id || d.b === a.id);
    const dm = door ? (alongX ? door.x + door.w / 2 : door.y + door.h / 2) * CELL : 0;
    const pc = alongX ? p.x : p.z, sgn = dm < pc ? 1 : -1; // +1: the slope rises away from the opening
    const L = (alongX ? p.hx : p.hz) * 2, Wd = (alongX ? p.hz : p.hx) * 2;
    let n = 0;
    for (let i = 0; i < 6; i++) for (let j = 0; j < 4; j++) {
      const t = (i + 0.5) / 6, u = (j + 0.5) / 4 - 0.5;
      const s = pc + sgn * (t - 0.5) * L, c = (alongX ? p.z : p.x) + u * Wd * 0.9;
      const hgt = 0.25 + t * (p.h - 0.3), size = 0.35 + hash(s, c) * 0.45;
      const x = alongX ? s : c, z = alongX ? c : s;
      // every chunk lies INSIDE the rubble's collision box (its rotated extent clamped in): what you see is what you bump into
      box('rock', within(p, base, {x: r3(x), y: base + Math.max(size / 2, hgt - size / 2), z: r3(z), w: size, h: size * (0.7 + hash(c, s) * 0.5), d: size * (0.8 + hash(s + 1, c) * 0.4), yaw: hash(x, z) * Math.PI, rx: (hash(z, x) - 0.5) * 0.6, rz: (hash(x + z) - 0.5) * 0.6}));
      // the fill under the chunks (the slope itself): one slice across the drift per step along it
      const cross = alongX ? p.z : p.x;
      if (j === 0) box('rock', within(p, base, {x: alongX ? s : cross, y: base + hgt / 2, z: alongX ? cross : s, w: alongX ? L / 6 : Wd, h: hgt, d: alongX ? Wd : L / 6, yaw: 0}));
      n++;
    }
    const cx = pc - sgn * L * 0.35;
    box('timber', within(p, base, {x: alongX ? cx : p.x, y: base + 0.45, z: alongX ? p.z : cx, w: alongX ? 0.25 : Wd * 0.95, h: 0.25, d: alongX ? Wd * 0.95 : 0.25, yaw: 0, ...(alongX ? {rx: 0.35} : {rz: 0.35})}));
    plan.stats.rubble += n;
  }

  // --- standing water over the flooded sump's far half ---------------------------------------------------------------------------
  {
    const S = byKey('sump');
    if (S) {
      const alongX = S.w >= S.h, door = layout.doors.find(d => d.a === S.id || d.b === S.id);
      const ax0 = S.x * CELL, az0 = S.y * CELL, ax1 = (S.x + S.w) * CELL, az1 = (S.y + S.h) * CELL;
      const dm = door ? (alongX ? door.x + door.w / 2 : door.y + door.h / 2) * CELL : (alongX ? ax0 : az0);
      const lo = alongX ? ax0 : az0, hi = alongX ? ax1 : az1, farHi = dm < (lo + hi) / 2;
      const w0 = farHi ? lo + (hi - lo) * 0.45 : lo, w1 = farHi ? hi : hi - (hi - lo) * 0.45;
      box('water', {x: alongX ? (w0 + w1) / 2 : (ax0 + ax1) / 2, y: base + 0.07, z: alongX ? (az0 + az1) / 2 : (w0 + w1) / 2, w: alongX ? w1 - w0 : ax1 - ax0, h: 0.002, d: alongX ? az1 - az0 : w1 - w0, yaw: 0});
      plan.stats.water++;
    }
  }

  // --- the generator's timber skid bed (sleepers under the skid, showing past its sides) ---------------------------------------------
  {
    const C = byKey('cavern');
    const gen = C ? layout.reactor?.generators.find(q => q.area === C.id) : undefined;
    if (gen) {
      const along = gen.size.w, n = Math.max(3, Math.round(along / 0.7));
      const ca = Math.cos(gen.yaw), sa = Math.sin(gen.yaw);
      for (let i = 0; i < n; i++) {
        const t = -along / 2 + (i + 0.5) * along / n;
        // the skid's long axis is its local x (yaw about y): world (cos, -sin)
        box('timber', {x: r3(gen.x + ca * t), y: gen.y + 0.05, z: r3(gen.z - sa * t), w: 0.22, h: 0.1, d: gen.size.d + 0.7, yaw: gen.yaw});
      }
    }
  }
  return plan;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Build

export interface MinesBuildStats { plan: MinesVisualPlan['stats'] | null; meshes: number; instances: number; models: Partial<Record<MinesModel, number>>; triangles: number }

interface Cache { water?: THREE.Material; hole?: THREE.Material }
const caches = new WeakMap<WorldMaterials, Cache>();

function material(mats: WorldMaterials, m: MineMat): THREE.Material {
  const c = caches.get(mats) ?? {};
  caches.set(mats, c);
  switch (m) {
    case 'timber': return mats.get('sleeper');
    case 'rail': return mats.get('rail');
    case 'steel': return reactorDress(mats).steelDark;
    case 'rope': return reactorDress(mats).cable;
    case 'rock': return reactorSurfaceMaterial(mats, 'reactor-wall');
    case 'water': {
      // dynamic effect surface (no texture): dark, glossy standing water
      if (!c.water) { const w = new MeshStandardNodeMaterial({color: 0x121a14, roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.86, depthWrite: false}); w.name = 'reactor-mines-water'; c.water = w; }
      return c.water;
    }
    case 'hole': {
      if (!c.hole) { const h = new MeshBasicNodeMaterial({color: 0x030303}); h.name = 'reactor-mines-winze-mouth'; c.hole = h; }
      return c.hole;
    }
  }
}

const UP = new THREE.Vector3(0, 1, 0);

/** Builds the workings' visuals into `group` (a Reactor world with a mines complex; else nothing). */
export function buildMinesVisuals(group: THREE.Group, layout: StationLayout, mats: WorldMaterials, models: Readonly<Record<string, GLTF | undefined>>): MinesBuildStats {
  const stats: MinesBuildStats = {plan: null, meshes: 0, instances: 0, models: {}, triangles: 0};
  const plan = planMinesVisuals(layout);
  if (!plan) return stats;
  stats.plan = plan.stats;
  const tag = (o: THREE.Object3D) => { o.userData.level = plan.level; o.matrixAutoUpdate = false; o.updateMatrix(); };
  const tris = (g: THREE.BufferGeometry) => (g.index ? g.index.count : g.attributes.position.count) / 3;
  const unit = new THREE.BoxGeometry(1, 1, 1);
  const q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3();
  const boxMatrix = (b: MineBox) => {
    e.set(b.rx ?? 0, b.yaw, b.rz ?? 0, 'YXZ');
    return new THREE.Matrix4().compose(p.set(b.x, b.y, b.z), q.setFromEuler(e), s.set(b.w, b.h, b.d));
  };
  const placeMatrix = (m: MinePlace) => new THREE.Matrix4().compose(p.set(m.x, m.y, m.z), q.setFromAxisAngle(UP, m.yaw), s.set(m.sx, m.sy, m.sz));
  const instanced = (geo: THREE.BufferGeometry, mat: THREE.Material, mats4: THREE.Matrix4[], name: string) => {
    if (!mats4.length) return;
    const im = new THREE.InstancedMesh(geo, mat, mats4.length);
    mats4.forEach((m, i) => im.setMatrixAt(i, m));
    im.name = name;
    im.computeBoundingSphere();
    im.computeBoundingBox();
    tag(im);
    group.add(im);
    stats.meshes++; stats.instances += mats4.length; stats.triangles += tris(geo) * mats4.length;
  };
  // boxes: one InstancedMesh per material
  for (const [m, list] of Object.entries(plan.boxes) as [MineMat, MineBox[]][]) instanced(unit, material(mats, m), list.map(boxMatrix), `reactor-mines-${m}`);
  // sheaves: torus wheels (steel)
  if (plan.sheaves.length) {
    const wheel = new THREE.TorusGeometry(1, 0.08, 6, 18);
    instanced(wheel, material(mats, 'steel'), plan.sheaves.map(w => new THREE.Matrix4().compose(p.set(w.x, w.y, w.z), q.setFromAxisAngle(UP, w.yaw), s.set(w.r, w.r, w.r))), 'reactor-mines-sheave');
  }
  // the models (or textured procedural stand-ins)
  for (const key of Object.keys(plan.models) as MinesModel[]) {
    const list = plan.models[key];
    if (!list.length) continue;
    const gltf = models[MINES_MODELS[key].key];
    if (gltf) {
      const root = gltf.scene;
      root.updateMatrixWorld(true);
      const meshes: THREE.Mesh[] = [];
      root.traverse(o => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
      for (const mesh of meshes) instanced(mesh.geometry, mesh.material as THREE.Material, list.map(m => placeMatrix(m).multiply(mesh.matrixWorld)), `reactor-mines-model-${key}`);
      stats.models[key] = list.length;
      continue;
    }
    // stand-ins in existing materials (Node tests / a failed fetch): never untextured
    const parts = standIn(key);
    for (const part of parts) instanced(unit, material(mats, part.m), list.map(m => placeMatrix(m).multiply(new THREE.Matrix4().compose(p.set(part.x, part.y, part.z), q.identity(), s.set(part.w, part.h, part.d)))), `reactor-mines-standin-${key}`);
  }
  return stats;
}

/** Procedural stand-ins (model space: front +Z, base y 0) for a model that is not loaded. */
function standIn(key: MinesModel): {m: MineMat; x: number; y: number; z: number; w: number; h: number; d: number}[] {
  switch (key) {
    case 'timberSet': return [
      {m: 'timber', x: -1.15, y: 0.9, z: 0, w: 0.24, h: 1.8, d: 0.24}, {m: 'timber', x: 1.15, y: 0.9, z: 0, w: 0.24, h: 1.8, d: 0.24},
      {m: 'timber', x: 0, y: 2.0, z: 0, w: 3.2, h: 0.3, d: 0.28}, {m: 'timber', x: 0, y: 2.3, z: 0, w: 3.0, h: 0.2, d: 0.5},
    ];
    case 'mineCart': return [
      {m: 'steel', x: 0, y: 0.48, z: 0, w: 1.6, h: 0.56, d: 0.78}, {m: 'rail', x: -0.5, y: 0.12, z: 0, w: 0.12, h: 0.24, d: 0.66}, {m: 'rail', x: 0.5, y: 0.12, z: 0, w: 0.12, h: 0.24, d: 0.66},
    ];
    case 'hoistWinch': return [
      {m: 'rock', x: 0, y: 0.15, z: 0, w: 3.0, h: 0.3, d: 1.7}, {m: 'steel', x: -0.3, y: 0.85, z: 0.1, w: 1.8, h: 0.9, d: 1.0}, {m: 'steel', x: 1.1, y: 0.7, z: -0.2, w: 0.6, h: 0.7, d: 0.7},
    ];
    case 'drillRig': return [
      {m: 'steel', x: 0, y: 0.6, z: 0, w: 3.4, h: 0.8, d: 0.95}, {m: 'rail', x: 1.2, y: 1.1, z: 0, w: 1.0, h: 0.3, d: 0.2},
    ];
  }
}

export type {RailPoint, PropPlacement};
void alongPolyline;
