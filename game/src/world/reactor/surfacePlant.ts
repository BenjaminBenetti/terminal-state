// Task studio-alpha-reactor-surface-redesign-credits-20261103-055510-01 (lane PLANT): BUILDS the surface plant from its pure plan
// (surfacePlantPlan.ts) — the buttressed compound wall round the yard, the duct runs and the VENT TOWERS with the Reactor's existing big
// extraction fan (REACTOR_MODELS.fanHousing, the cooked Meshy GLB with its own maps) and the procedural 'blade' rotor
// (archMeshes.ts kitGeometry) that SPINS. User: "there should be a ventilation tower or two, visible, use the existing big fan assets
// to build this. The fans must spin."
//
// One group under the surface view's `outdoor` group (the eye gate hides it in the pit: 0 draws there). Budget: ONE merged mesh per
// material (concrete / rusted steel / grille), the fan housing's GLB parts instanced once per part (the library's geometry, shared, never
// copied), ONE InstancedMesh for every rotor (DynamicDrawUsage): per frame only the rotors' instance matrices (one small upload). No
// shadow casters, no particles, no physics bodies, nothing walkable (the plan keeps every footprint off site.walk).
// Materials: existing textures only — the Reactor's Codex pit-concrete / rusted-steel / grating colour maps through lane SURFACE's wet
// outdoor look (surfaceLook.ts surfaceWallMaterial: world-mapped, darkened by the rain, runoff streaks, the sky sheen, the rain mist);
// the housing keeps its Meshy maps through surfaceModelMaterial (the city's outdoor look). No new texture, no generation.
// Spin: the rotors rest until the surface first shows with the facility ONLINE (STARTUP's clearing), then spool up smoothly
// (SURFACE_PLANT.spinUpS) and turn steadily — the blades about the fan's own axis (the housing's +Z), never the housing.

import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {modelParts} from '../exterior';
import {kitGeometry} from './archMeshes';
import {REACTOR_MODELS, reactorTexture} from './archAssets';
import {surfaceModelMaterial, surfaceWallMaterial} from './surfaceLook';
import {FAN_ANCHORS, SURFACE_PLANT, type PlantPart, type SurfacePlantPlan, type VentTowerPlan} from './surfacePlantPlan';
import type {SurfaceSite} from './surfaceSite';

/** The existing colour maps the plant reuses (null: a flat tone — Node tests / a failed fetch). */
export interface PlantTextures { concrete: THREE.Texture | null; steel: THREE.Texture | null; grating: THREE.Texture | null }

/** The Reactor's resolved Codex colour maps (archInstall's section preload): pit concrete, rusted steel, grating. */
export const plantTextures = (): PlantTextures => ({
  concrete: (reactorTexture('pitConcrete', 'color') as THREE.Texture | undefined) ?? null,
  steel: (reactorTexture('rustedSteel', 'color') as THREE.Texture | undefined) ?? null,
  grating: (reactorTexture('grating', 'color') as THREE.Texture | undefined) ?? null,
});

/** The lazy-library key of the fan housing model. */
export const PLANT_FAN_KEY = REACTOR_MODELS.fanHousing.key;

/** One spinning rotor: its basis (local Z = the fan's axis, at the blades' centre), radius, angle, speed (0..1), rev / s at full. */
export interface PlantRotor { basis: THREE.Matrix4; radius: number; angle: number; speed: number; rev: number }

export interface SurfacePlantView {
  root: THREE.Group;
  /** Merged structure meshes (concrete, steel, grille) and the instanced fan housings (one per GLB part). */
  meshes: THREE.Mesh[];
  housings: THREE.InstancedMesh[];
  /** ONE InstancedMesh for every rotor (instance i = plan.towers[i]'s fan). */
  rotors: THREE.InstancedMesh | null;
  fans: PlantRotor[];
  /** The rotors have started (the surface showed with the facility online): they keep turning from then on. */
  started: boolean;
  stats: {towers: number; parts: number; draws: number; tris: number; model: boolean};
  /** Per frame: `shown` = the surface view is visible (the eye outside), `power` = STARTUP's clearing 0..1. Returns matrices written. */
  tick(dt: number, shown: boolean, power?: number): number;
  dispose(): void;
}

const UP = new THREE.Vector3(0, 1, 0);
const frameM = (x: number, y: number, z: number, yaw: number) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(UP, yaw), new THREE.Vector3(1, 1, 1));
const triCount = (g: THREE.BufferGeometry) => (g.index ? g.index.count : g.attributes.position.count) / 3;

/** Non-indexed position + normal parts merged into one geometry per material. */
class Batch {
  readonly parts: THREE.BufferGeometry[] = [];
  private add(g: THREE.BufferGeometry, m: THREE.Matrix4): void {
    if (g.getAttribute('uv')) g.deleteAttribute('uv');
    g.applyMatrix4(m);
    const n = g.index ? g.toNonIndexed() : g;
    if (n !== g) g.dispose();
    this.parts.push(n);
  }
  /** A box (w x h x d) centred at local (lx, ly, lz) of frame `f`, optionally pitched about its local X. */
  box(f: THREE.Matrix4, lx: number, ly: number, lz: number, w: number, h: number, d: number, pitch = 0): void {
    if (!(w > 0 && h > 0 && d > 0)) return;
    const g = new THREE.BoxGeometry(w, h, d);
    if (pitch) g.rotateX(pitch);
    g.translate(lx, ly, lz);
    this.add(g, f);
  }
  /** A wedge: x +-hw, z -hd..+hd, bottom y0, top falling from y1 (at -hd) to y1b (at +hd) — local frame `f`. */
  wedge(f: THREE.Matrix4, hw: number, hd: number, y0: number, y1: number, y1b: number): void {
    const g = new THREE.BoxGeometry(2 * hw, 1, 2 * hd).toNonIndexed();
    const p = g.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const z = p.getZ(i), top = p.getY(i) > 0, k = (z + hd) / (2 * hd);
      p.setY(i, top ? y1 + (y1b - y1) * k : y0);
    }
    g.computeVertexNormals();
    this.add(g, f);
  }
  /** Any geometry in frame `f` (local transform `m` first). */
  geo(f: THREE.Matrix4, g: THREE.BufferGeometry, m?: THREE.Matrix4): void {
    if (m) g.applyMatrix4(m);
    this.add(g, f);
  }
  build(name: string, material: THREE.Material): THREE.Mesh | null {
    if (!this.parts.length) return null;
    const g = mergeGeometries(this.parts, false);
    for (const p of this.parts) p.dispose();
    this.parts.length = 0;
    if (!g) return null;
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, material);
    m.name = name;
    return m;
  }
}

/** A railing along local x from x0 to x1 at local z (posts every ~1.4 m, top + mid rail) on a deck at local y. */
function railing(b: Batch, f: THREE.Matrix4, a0: number, a1: number, at: number, y: number, alongX: boolean): void {
  const L = Math.abs(a1 - a0), n = Math.max(1, Math.round(L / 1.4)), H = 1.1;
  const P = (a: number, yy: number, w: number, h: number, d: number) => (alongX ? b.box(f, a, yy, at, w, h, d) : b.box(f, at, yy, a, d, h, w));
  for (let k = 0; k <= n; k++) P(a0 + ((a1 - a0) * k) / n, y + H / 2, 0.06, H, 0.06);
  P((a0 + a1) / 2, y + H - 0.03, L + 0.06, 0.06, 0.06);
  P((a0 + a1) / 2, y + H * 0.5, L + 0.04, 0.045, 0.045);
  P((a0 + a1) / 2, y + 0.08, L, 0.14, 0.02); // toe board
}

/** A caged ladder up the face at local z = zf (facing +Z), centred on x = lx, from y0 to y1 (frame `f`). */
function ladder(b: Batch, f: THREE.Matrix4, lx: number, zf: number, y0: number, y1: number): void {
  const L = y1 - y0, z = zf + 0.22;
  for (const s of [-0.23, 0.23]) b.box(f, lx + s, y0 + L / 2 + 0.5, z, 0.06, L + 1.0, 0.07); // stiles (past the deck: a handhold)
  for (let yy = y0 + 0.3; yy < y1; yy += 0.3) b.box(f, lx, yy, z, 0.46, 0.035, 0.035);
  for (const s of [-0.23, 0.23]) for (let yy = y0 + 0.15; yy < y1; yy += Math.max(1.2, L / 3)) b.box(f, lx + s, yy, zf + 0.11, 0.05, 0.05, 0.22); // wall brackets
  // the cage: hoops (a U of three bars) every 0.9 m from 2.4 m up, three vertical bars
  const c0 = y0 + 2.4, cz0 = z + 0.04, cz1 = z + 0.72, hx = 0.38;
  if (c0 < y1 - 0.3) {
    for (let yy = c0; yy <= y1 + 0.9; yy += 0.9) {
      b.box(f, lx - hx, yy, (cz0 + cz1) / 2, 0.05, 0.05, cz1 - cz0);
      b.box(f, lx + hx, yy, (cz0 + cz1) / 2, 0.05, 0.05, cz1 - cz0);
      b.box(f, lx, yy, cz1, 2 * hx + 0.05, 0.05, 0.05);
    }
    const top = y1 + 0.9, mid = (c0 + top) / 2, h = top - c0;
    for (const [x, zz] of [[lx - hx, cz1 - 0.2], [lx + hx, cz1 - 0.2], [lx, cz1]] as const) b.box(f, x, mid, zz, 0.04, h, 0.04);
  }
}

/**
 * Build the plant (a group to add under the surface view's `outdoor`). `models(key)`: the lazy library's GLTF (the fan housing:
 * PLANT_FAN_KEY; undefined = a procedural steel housing stands in). `tex`: the existing colour maps (default: the Reactor's).
 */
export function buildSurfacePlant(site: Pick<SurfaceSite, 'y' | 'parapetY'>, plan: SurfacePlantPlan, models: (key: string) => GLTF | undefined, tex: PlantTextures = plantTextures()): SurfacePlantView {
  const root = new THREE.Group();
  root.name = 'reactor-surface-plant';
  const concrete = new Batch(), steel = new Batch(), grille = new Batch();
  const own = {geometries: [] as THREE.BufferGeometry[], materials: [] as THREE.Material[]};
  const meshes: THREE.Mesh[] = [], housings: THREE.InstancedMesh[] = [];
  let tris = 0;
  const P = SURFACE_PLANT;
  // --- the compound wall and the duct runs ---
  for (const p of plan.parts) partGeometry(p, site.parapetY, concrete, steel, grille);
  // --- the towers ---
  const gltf = plan.towers.length ? models(PLANT_FAN_KEY) : undefined;
  const fans: PlantRotor[] = [];
  const housingMats: THREE.Matrix4[] = [];
  for (const tw of plan.towers) {
    const f = frameM(tw.x, tw.y, tw.z, tw.yaw);
    towerGeometry(tw, f, concrete, steel, grille, !gltf);
    const s = tw.fanScale, zModel = tw.hd - FAN_ANCHORS.back * s; // the back flange on the stack's front face
    const hub = tw.fan.hubY - tw.y;
    housingMats.push(f.clone().multiply(new THREE.Matrix4().compose(new THREE.Vector3(0, hub - FAN_ANCHORS.ringY * s, zModel), new THREE.Quaternion(), new THREE.Vector3(s, s, s))));
    // the rotor: basis = the tower's frame at the blades' centre (local Z = the fan's axis toward the plaza, Y up)
    const basis = f.clone().multiply(new THREE.Matrix4().makeTranslation(0, hub, zModel + FAN_ANCHORS.bladeZ * s));
    fans.push({basis, radius: tw.bladeR, angle: tw.phase, speed: 0, rev: tw.rev});
  }
  // --- materials (existing maps through the wet outdoor look; owned per build) ---
  const mats = {concrete: surfaceWallMaterial(tex.concrete), steel: surfaceWallMaterial(tex.steel), grille: surfaceWallMaterial(tex.grating)};
  for (const [name, b, mt] of [['concrete', concrete, mats.concrete], ['steel', steel, mats.steel], ['grille', grille, mats.grille]] as const) {
    const m = b.build(`reactor-surface-plant-${name}`, mt);
    if (m) { meshes.push(m); own.geometries.push(m.geometry); tris += triCount(m.geometry); }
  }
  own.materials.push(mats.concrete, mats.steel, mats.grille);
  // --- the fan housings: the cooked GLB's parts, instanced once per part (the library's geometry; its Meshy maps, the outdoor look) ---
  if (gltf) {
    for (const [pi, part] of modelParts(gltf).entries()) {
      const im = new THREE.InstancedMesh(part.geometry, surfaceModelMaterial(part.material), housingMats.length);
      im.name = `reactor-surface-plant-fan-housing-${pi}`;
      housingMats.forEach((m, i) => im.setMatrixAt(i, new THREE.Matrix4().multiplyMatrices(m, part.matrix)));
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere();
      housings.push(im);
      meshes.push(im);
      tris += triCount(part.geometry) * housingMats.length;
    }
  }
  // --- the rotors: ONE InstancedMesh (the Reactor's 'blade' rotor: unit radius in local XY, axis +Z), rusted steel ---
  let rotors: THREE.InstancedMesh | null = null;
  if (fans.length) {
    const g = kitGeometry('blade');
    own.geometries.push(g);
    const src = new THREE.MeshStandardMaterial({map: tex.steel, color: 0x8c8780});
    const rm = surfaceModelMaterial(src);
    src.dispose();
    rotors = new THREE.InstancedMesh(g, rm, fans.length);
    rotors.name = 'reactor-surface-plant-fan-rotors';
    rotors.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    meshes.push(rotors);
    tris += triCount(g) * fans.length;
  }
  for (const m of meshes) {
    m.castShadow = m.receiveShadow = false;
    m.matrixAutoUpdate = false;
    m.updateMatrix();
    root.add(m);
  }
  const mt = new THREE.Matrix4(), rz = new THREE.Matrix4(), sv = new THREE.Vector3();
  const write = (): number => {
    if (!rotors) return 0;
    for (let i = 0; i < fans.length; i++) {
      const fa = fans[i];
      rotors.setMatrixAt(i, mt.copy(fa.basis).multiply(rz.makeRotationZ(fa.angle)).scale(sv.setScalar(fa.radius)));
    }
    rotors.instanceMatrix.needsUpdate = true;
    return fans.length;
  };
  write();
  rotors?.computeBoundingSphere(); // (a rotor's disc bounds do not change with its angle)
  const view: SurfacePlantView = {
    root, meshes, housings, rotors, fans, started: false,
    stats: {towers: plan.towers.length, parts: plan.parts.length, draws: meshes.length, tris, model: !!gltf},
    tick(dt: number, shown: boolean, power = 1): number {
      if (!(dt > 0) || !fans.length) return 0;
      const target = Math.max(0, Math.min(1, Number.isFinite(power) ? power : 0));
      if (!view.started) { if (!shown || target <= 0) return 0; view.started = true; }
      const ease = 1 - Math.exp(-dt / P.spinUpS);
      for (const fa of fans) {
        fa.speed += (target - fa.speed) * ease;
        if (Math.abs(fa.speed - target) < 1e-3) fa.speed = target;
        fa.angle = (fa.angle + fa.speed * fa.rev * Math.PI * 2 * dt) % (Math.PI * 2);
      }
      return shown ? write() : 0;
    },
    dispose(): void {
      root.removeFromParent();
      for (const h of housings) h.dispose();
      rotors?.dispose();
      for (const g of own.geometries) g.dispose();
      for (const m of own.materials) m.dispose();
    },
  };
  return view;
}

/** A plan part (compound wall pier / buttress, plenum, duct, sleeper) into its batch. */
function partGeometry(p: PlantPart, parapetY: number, concrete: Batch, steel: Batch, grille: Batch): void {
  const f = frameM(p.x, 0, p.z, p.yaw), H = p.y1 - p.y0, yc = (p.y0 + p.y1) / 2;
  switch (p.kind) {
    case 'pier':
      concrete.box(f, 0, yc, 0, 2 * p.hw, H, 2 * p.hd);
      // a cap: overhangs the sides and the city face, never inward past the pier's inner face (the walk boundary side, local -Z)
      concrete.box(f, 0, p.y1 + 0.06, 0.04, 2 * p.hw + 0.1, 0.12, 2 * p.hd + 0.08);
      break;
    case 'buttress':
      concrete.wedge(f, p.hw, p.hd, p.y0, p.y1, p.y1b ?? p.y0 + 0.3);
      break;
    case 'plenum': {
      // local +Z faces the plaza (the parapet): the concrete box, a cap overhanging the three city sides, the intake grille above the
      // parapet line on the plaza face (a hair proud: still beyond the parapet's outer face)
      concrete.box(f, 0, yc, 0, 2 * p.hw, H, 2 * p.hd);
      concrete.box(f, 0, p.y1 + 0.09, -0.06, 2 * p.hw + 0.24, 0.18, 2 * p.hd + 0.12);
      const g0 = parapetY + 0.18, g1 = p.y1 - 0.32;
      if (g1 - g0 > 0.4) {
        grille.box(f, 0, (g0 + g1) / 2, p.hd - 0.002, 2 * p.hw - 0.7, g1 - g0, 0.012);
        // its frame (steel angle round the grille)
        for (const yy of [g0 - 0.04, g1 + 0.04]) steel.box(f, 0, yy, p.hd - 0.004, 2 * p.hw - 0.6, 0.08, 0.016);
        for (const xx of [-(p.hw - 0.33), p.hw - 0.33]) steel.box(f, xx, (g0 + g1) / 2, p.hd - 0.004, 0.08, g1 - g0 + 0.16, 0.016);
      }
      // a grille on its top too (the intake from above)
      grille.box(f, 0, p.y1 + 0.185, -0.06, 2 * p.hw - 0.6, 0.012, 2 * p.hd - 0.5);
      break;
    }
    case 'duct': {
      steel.box(f, 0, yc, 0, 2 * p.hw, H, 2 * p.hd);
      // flanged joints every ~1.6 m
      const L = 2 * p.hd, n = Math.max(1, Math.round(L / 1.6));
      for (let k = 1; k < n; k++) steel.box(f, 0, yc, -p.hd + (L * k) / n, 2 * p.hw + 0.16, H + 0.16, 0.12);
      break;
    }
    case 'sleeper':
      concrete.box(f, 0, yc, 0, 2 * p.hw, H, 2 * p.hd);
      break;
  }
}

/**
 * One vent tower in its frame `f` (origin = the stack's centre at the deck, local +Z = toward the plaza): a stepped plinth, the stack
 * with corner pilasters and string courses, a cap and a steel louvred discharge cowl, intake grilles on its sides, the service platform
 * under the fan with its railing and knee braces, a caged ladder up from the plinth, the grille behind the rotor (and a procedural steel
 * housing only when the GLB is missing).
 */
function towerGeometry(tw: VentTowerPlan, f: THREE.Matrix4, concrete: Batch, steel: Batch, grille: Batch, procedural: boolean): void {
  const {hw, hd, h: H} = tw, pl = tw.plinth, s = tw.fanScale, hub = tw.fan.hubY - tw.y;
  // plinth (two steps)
  const p0 = pl.h * 0.65;
  concrete.box(f, 0, (p0 - 0.1) / 2, 0, 2 * pl.hw, p0 + 0.1, 2 * pl.hd);
  concrete.box(f, 0, (p0 + pl.h) / 2, 0, 2 * pl.hw - 0.7, pl.h - p0, 2 * pl.hd - 0.7);
  // the stack in two stages: the lower (the fan's) full size, a ledge, the upper set back — a ventilation shaft, not an office block
  const top = hub + (FAN_ANCHORS.plateH - FAN_ANCHORS.ringY) * s;
  const yS = Math.min(H - 4.4, Math.max(H * 0.6, top + 1.6)), hw2 = hw - 0.55, hd2 = hd - 0.55;
  concrete.box(f, 0, (pl.h + yS) / 2, 0, 2 * hw, yS - pl.h, 2 * hd);
  concrete.box(f, 0, (yS + H) / 2, 0, 2 * hw2, H - yS, 2 * hd2);
  concrete.box(f, 0, yS + 0.06, 0, 2 * hw + 0.5, 0.42, 2 * hd + 0.5); // the ledge (a weathered drip course)
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    concrete.box(f, sx * hw, (pl.h + yS) / 2, sz * hd, 0.8, yS - pl.h, 0.8);
    concrete.box(f, sx * hw2, (yS + H) / 2, sz * hd2, 0.7, H - yS, 0.7);
  }
  // intake grilles on both side faces of the lower stage at the fan's height (framed in concrete); string courses clear of them
  const gy = hub, gh = 3.2, gd = 2 * hd - 2.2;
  for (let yy = pl.h + 3.8; yy < yS - 1.2; yy += 4.6) if (Math.abs(yy - gy) > gh / 2 + 0.5) concrete.box(f, 0, yy, 0, 2 * hw + 0.24, 0.3, 2 * hd + 0.24);
  for (const sx of [-1, 1]) {
    grille.box(f, sx * (hw + 0.02), gy, 0, 0.03, gh, gd);
    for (const yy of [gy - gh / 2 - 0.1, gy + gh / 2 + 0.1]) concrete.box(f, sx * (hw + 0.08), yy, 0, 0.16, 0.2, gd + 0.4);
    for (const zz of [-gd / 2 - 0.1, gd / 2 + 0.1]) concrete.box(f, sx * (hw + 0.08), gy, zz, 0.16, gh + 0.4, 0.2);
  }
  // the exhaust louvre band round the top of the upper stage (all four faces, a concrete sill under it)
  const lb1 = H - 0.7, lb0 = Math.max(yS + 1.2, H - 3.9), ly = (lb0 + lb1) / 2, lh = lb1 - lb0;
  grille.box(f, 0, ly, hd2 + 0.02, 2 * hw2 - 1.0, lh, 0.03);
  grille.box(f, 0, ly, -hd2 - 0.02, 2 * hw2 - 1.0, lh, 0.03);
  grille.box(f, hw2 + 0.02, ly, 0, 0.03, lh, 2 * hd2 - 1.0);
  grille.box(f, -hw2 - 0.02, ly, 0, 0.03, lh, 2 * hd2 - 1.0);
  concrete.box(f, 0, lb0 - 0.12, 0, 2 * hw2 + 0.2, 0.24, 2 * hd2 + 0.2);
  // cap + the louvred discharge cowl (steel box, grille faces, a roof plate)
  concrete.box(f, 0, H + 0.25, 0, 2 * hw2 + 0.9, 0.5, 2 * hd2 + 0.9);
  const cw = 2 * hw2 - 1.0, cd = 2 * hd2 - 1.0, c0 = H + 0.5, ch = 2.2;
  steel.box(f, 0, c0 + ch / 2, 0, cw, ch, cd);
  grille.box(f, 0, c0 + ch / 2, cd / 2 + 0.012, cw - 0.5, ch - 0.5, 0.02);
  grille.box(f, 0, c0 + ch / 2, -cd / 2 - 0.012, cw - 0.5, ch - 0.5, 0.02);
  grille.box(f, cw / 2 + 0.012, c0 + ch / 2, 0, 0.02, ch - 0.5, cd - 0.5);
  grille.box(f, -cw / 2 - 0.012, c0 + ch / 2, 0, 0.02, ch - 0.5, cd - 0.5);
  steel.box(f, 0, c0 + ch + 0.08, 0, cw + 0.6, 0.16, cd + 0.6);
  // the fan: the grille disc behind the rotor (inside the duct ring, just off the face), the service platform under the housing
  const zFace = hd, ringR = FAN_ANCHORS.ringR * s;
  const disc = new THREE.CircleGeometry(ringR * 1.06, 40);
  grille.geo(f, disc, new THREE.Matrix4().makeTranslation(0, hub, zFace + 0.03));
  const plateW = FAN_ANCHORS.plateW * s, depth = FAN_ANCHORS.depth * s;
  const yP = hub - FAN_ANCHORS.ringY * s - 0.3, px = plateW / 2 + 0.45, pz1 = zFace + depth + 0.7;
  grille.box(f, 0, yP - 0.03, (zFace + pz1) / 2, 2 * px, 0.06, pz1 - zFace);
  steel.box(f, 0, yP - 0.14, pz1 - 0.06, 2 * px, 0.16, 0.12); // the deck's edge beams
  for (const sx of [-1, 1]) steel.box(f, sx * (px - 0.06), yP - 0.14, (zFace + pz1) / 2, 0.12, 0.16, pz1 - zFace);
  railing(steel, f, -px, px, pz1 - 0.05, yP, true);
  railing(steel, f, zFace + 0.1, pz1 - 0.05, -px + 0.05, yP, false);
  railing(steel, f, zFace + 0.1, pz1 - 0.05, px - 0.05, yP, false);
  // knee braces from the stack face to the deck's front edge
  const kz0 = zFace + 0.1, ky0 = yP - 2.3, kz1 = pz1 - 0.3, ky1 = yP - 0.2, kl = Math.hypot(kz1 - kz0, ky1 - ky0);
  for (const sx of [-1, 1]) {
    steel.box(f, sx * (px - 0.25), (ky0 + ky1) / 2, (kz0 + kz1) / 2, 0.14, 0.14, kl, -Math.atan2(ky1 - ky0, kz1 - kz0));
    steel.box(f, sx * (px - 0.25), ky0, zFace + 0.06, 0.3, 0.4, 0.12); // its wall plate
  }
  // the caged ladder from the plinth up to the platform (beside the duct)
  ladder(steel, f, px - 0.75, zFace, pl.h, yP);
  if (procedural) {
    // (the fan housing GLB is missing: a steel duct ring, a frame plate round it and the motor pod — the rotor still spins inside)
    const zc = zFace + depth * 0.55;
    const tube = new THREE.CylinderGeometry(ringR * 1.08, ringR * 1.08, depth * 0.9, 28, 1, true);
    steel.geo(f, tube, new THREE.Matrix4().makeRotationX(Math.PI / 2).premultiply(new THREE.Matrix4().makeTranslation(0, hub, zc)));
    const fw = plateW, bt = (plateW - 2 * ringR * 1.08) / 2;
    for (const [lx, ly, w, hh] of [[0, ringR * 1.08 + bt / 2, fw, bt], [0, -ringR * 1.08 - bt / 2, fw, bt], [ringR * 1.08 + bt / 2, 0, bt, 2 * ringR * 1.08], [-ringR * 1.08 - bt / 2, 0, bt, 2 * ringR * 1.08]] as const) {
      steel.box(f, lx, hub + ly, zFace + 0.2, w, hh, 0.4);
    }
    const pod = new THREE.CylinderGeometry(ringR * 0.3, ringR * 0.3, depth * 0.5, 16);
    steel.geo(f, pod, new THREE.Matrix4().makeRotationX(Math.PI / 2).premultiply(new THREE.Matrix4().makeTranslation(0, hub, zFace + depth * 0.35)));
  }
}
