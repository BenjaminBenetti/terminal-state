// Task studio-reactor-surface-ending-20261102-213051-01 (lane SURFACE): BUILDS the surface's outside visuals from the pure plans —
// the ruined city (surfacePlan.ts), the wet ground, the wet film over the walkable floor, the outdoor sky and the two rain layers
// (surfaceRain.ts) — into ONE group that the runtime (surface.ts) shows only while the eye is outside (surfaceSite.ts gate): inside the
// pit the whole group is invisible, so it costs no draw and no traversal there.
// Budget: one InstancedMesh per (kit model part x quadrant round the aperture: frustum culling drops whole quadrants) — the kit's
// GLB geometry is shared with the lazy library, never copied; the ground, the film, the sky dome, the tank stands and each rain
// layer are one mesh each. No shadow casters. Materials: surfaceLook.ts (one per model map) and the rain's own.

import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {modelParts} from '../exterior';
import {SURFACE_KIT, type SurfaceKitEntry} from './surfaceKit';
import {SURFACE_CITY, footprintCorners, type SurfaceCityPlan} from './surfacePlan';
import type {SurfaceSite} from './surfaceSite';
import {SURFACE_RAIN, RainLayer, buildRainFloor, rainFloorTexture, type RainFloorMap} from './surfaceRain';
import {SURF_U, streetMaskTexture, surfaceFilmMaterial, surfaceGroundMaterial, surfaceModelMaterial, surfaceSkyMaterial, surfaceSteelMaterial, surfaceWallMaterial} from './surfaceLook';

/** Sky dome radius (follows the eye; inside the Reactor's 230 m far plane, beyond every building from anywhere on the surface). */
export const SURFACE_SKY = {radius: 205} as const;
/** The ground sits this far under the walk height (lane ENDING's floor covers it on the walk area); the film this far above. */
export const SURFACE_LAYERS = {groundBelow: 0.03, filmAbove: 0.012, maskCell: 0.5, parapetT: SURFACE_CITY.parapetT} as const;

const QUADS = 4;

export interface SurfaceView {
  root: THREE.Group;
  /** Everything seen only from outside (the eye gate toggles it); the aperture rain column sits beside it under `root`. */
  outdoor: THREE.Group;
  city: THREE.Group;
  ground: THREE.Mesh;
  parapet: THREE.Mesh | null;
  film: THREE.Mesh | null;
  sky: THREE.Mesh;
  near: RainLayer;
  column: RainLayer;
  floor: RainFloorMap;
  /** Instanced city meshes (InstancedMesh per entry part x quadrant). */
  instanced: THREE.InstancedMesh[];
  /** Geometries / textures / materials this view owns (the kit's GLB geometry is the library's). */
  own: {geometries: THREE.BufferGeometry[]; textures: THREE.Texture[]; materials: THREE.Material[]};
  /** Which entries drew a model (the rest of the plan had no delivered model and was skipped). */
  drawn: Record<string, number>;
  tris: number;
}

const quadOf = (cx: number, cz: number, x: number, z: number): number => {
  const a = Math.atan2(z - cz, x - cx);
  return ((Math.floor(((a + Math.PI) / (Math.PI * 2)) * QUADS) % QUADS) + QUADS) % QUADS;
};
const triCount = (g: THREE.BufferGeometry): number => (g.index ? g.index.count : g.attributes.position.count) / 3;

/** The street-mask rows (CPU side of the ground shader's lookup; surfacePlan.ts streetMaskAt mirrors the value). */
export function streetMaskRows(plan: Pick<SurfaceCityPlan, 'xGaps' | 'zGaps' | 'centre' | 'groundR'>): {rows: Float32Array; texels: number; x0: number; z0: number; cell: number} {
  const cell = SURFACE_LAYERS.maskCell, texels = Math.ceil((plan.groundR * 2) / cell) + 2;
  const x0 = plan.centre.x - plan.groundR - cell, z0 = plan.centre.z - plan.groundR - cell;
  const rows = new Float32Array(texels * 2);
  const fill = (gaps: readonly (readonly [number, number])[], o: number, row: number) => {
    for (let i = 0; i < texels; i++) {
      const v = o + (i + 0.5) * cell;
      let m = 0;
      for (const [a, b] of gaps) if (v >= a && v <= b) { m = v - a < SURFACE_CITY.pavement || b - v < SURFACE_CITY.pavement ? 0.5 : 1; break; }
      rows[row * texels + i] = m;
    }
  };
  fill(plan.xGaps, x0, 0);
  fill(plan.zGaps, z0, 1);
  return {rows, texels, x0, z0, cell};
}

/** The water tank's steel stand (unit: for a tank of footprint w x d on legs `h` tall), merged boxes. */
function standGeometry(w: number, d: number, h: number): THREE.BufferGeometry {
  const lx = w * 0.36, lz = d * 0.36, parts: THREE.BufferGeometry[] = [];
  const bx = (sx: number, sy: number, sz: number, x: number, y: number, z: number, rz = 0, rx = 0) => {
    const g = new THREE.BoxGeometry(sx, sy, sz);
    if (rz) g.rotateZ(rz);
    if (rx) g.rotateX(rx);
    g.translate(x, y, z);
    g.deleteAttribute('uv');
    parts.push(g);
  };
  for (const [x, z] of [[-lx, -lz], [lx, -lz], [-lx, lz], [lx, lz]]) bx(0.24, h, 0.24, x, h / 2, z);
  for (const y of [h - 0.1, h * 0.5]) {
    bx(2 * lx + 0.24, 0.16, 0.16, 0, y, -lz); bx(2 * lx + 0.24, 0.16, 0.16, 0, y, lz);
    bx(0.16, 0.16, 2 * lz + 0.24, -lx, y, 0); bx(0.16, 0.16, 2 * lz + 0.24, lx, y, 0);
  }
  // X braces on every face, upper and lower bay
  const bay = h / 2, dx = Math.hypot(2 * lx, bay), dz = Math.hypot(2 * lz, bay), ax = Math.atan2(bay, 2 * lx), az = Math.atan2(bay, 2 * lz);
  for (const yc of [bay / 2, bay * 1.5]) for (const s of [-1, 1]) {
    bx(dx, 0.07, 0.07, 0, yc, -lz, s * ax); bx(dx, 0.07, 0.07, 0, yc, lz, s * ax);
    bx(0.07, 0.07, dz, -lx, yc, 0, 0, s * az); bx(0.07, 0.07, dz, lx, yc, 0, 0, s * az);
  }
  const g = mergeGeometries(parts.map(p => p.toNonIndexed()), false)!;
  for (const p of parts) p.dispose();
  return g;
}

/** The walkable floor's wet film: 1 m cells over the walk rects, none inside the opening's keep-off radius or under a shelter. */
export function filmGeometry(site: SurfaceSite): THREE.BufferGeometry | null {
  const pos: number[] = [], y = site.y + SURFACE_LAYERS.filmAbove, o = site.hole, keep = Math.max(o.keepR, o.r + 0.6);
  const seen = new Set<string>();
  for (const r of site.walk) {
    for (let z = Math.floor(r.z0); z < r.z1; z++) for (let x = Math.floor(r.x0); x < r.x1; x++) {
      const x0 = Math.max(x, r.x0), x1 = Math.min(x + 1, r.x1), z0 = Math.max(z, r.z0), z1 = Math.min(z + 1, r.z1);
      if (x1 - x0 < 0.05 || z1 - z0 < 0.05) continue;
      const k = `${x},${z}`;
      if (seen.has(k)) continue;
      // the whole cell clear of the opening's keep-off radius (its nearest point outside it)
      if (Math.hypot(Math.max(o.x - x1, 0, x0 - o.x), Math.max(o.z - z1, 0, z0 - o.z)) < keep) continue;
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
      if (site.shelters.some(s => cx >= s.rect.x0 && cx <= s.rect.x1 && cz >= s.rect.z0 && cz <= s.rect.z1)) continue;
      seen.add(k);
      pos.push(x0, y, z0, x0, y, z1, x1, y, z1, x0, y, z0, x1, y, z1, x1, y, z0);
    }
  }
  if (!pos.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(pos.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  g.computeBoundingSphere();
  return g;
}

/** Strictly inside a walkable cell rect. */
export const onWalk = (site: Pick<SurfaceSite, 'walk'>, x: number, z: number): boolean =>
  site.walk.some(r => x > r.x0 + 1e-3 && x < r.x1 - 1e-3 && z > r.z0 + 1e-3 && z < r.z1 - 1e-3);

/**
 * The PLAZA PARAPET: a low wet-concrete wall on the outer side of every boundary edge (lane ENDING's contract: the boundary columns are
 * solid up to parapetY, so this is where the body stops); a corner post closes every convex corner (a post that would stand on a
 * walkable cell — a concave corner, already closed by its two walls — is skipped). One merged mesh, never inside `walk`.
 */
export function parapetGeometry(site: SurfaceSite): THREE.BufferGeometry | null {
  const T = SURFACE_LAYERS.parapetT, H = site.parapetY - site.y + SURFACE_LAYERS.groundBelow, y0 = site.y - SURFACE_LAYERS.groundBelow;
  if (!(H > 0.2) || !site.edges.length) return null;
  const parts: THREE.BufferGeometry[] = [];
  const add = (sx: number, sz: number, x: number, z: number) => {
    const g = new THREE.BoxGeometry(sx, H, sz);
    g.translate(x, y0 + H / 2, z);
    g.deleteAttribute('uv');
    parts.push(g.toNonIndexed());
    g.dispose();
  };
  for (const e of site.edges) {
    const L = Math.hypot(e.x1 - e.x0, e.z1 - e.z0);
    if (L < 0.05) continue;
    const ux = (e.x1 - e.x0) / L, uz = (e.z1 - e.z0) / L, alongX = Math.abs(ux) >= Math.abs(uz);
    add(alongX ? L : T, alongX ? T : L, (e.x0 + e.x1) / 2 + e.nx * T / 2, (e.z0 + e.z1) / 2 + e.nz * T / 2);
    for (const [px, pz, s] of [[e.x0, e.z0, -1], [e.x1, e.z1, 1]] as const) {
      const qx = px + s * ux * T / 2 + e.nx * T / 2, qz = pz + s * uz * T / 2 + e.nz * T / 2;
      if (!onWalk(site, qx, qz)) add(T, T, qx, qz);
    }
  }
  if (!parts.length) return null;
  const g = mergeGeometries(parts, false)!;
  for (const p of parts) p.dispose();
  g.computeBoundingSphere();
  return g;
}

/** The city ground: a disc round the aperture (radius plan.groundR) with the opening cut out. */
export function groundGeometry(site: SurfaceSite, plan: Pick<SurfaceCityPlan, 'groundR'>): THREE.BufferGeometry {
  const o = site.hole, R = plan.groundR, segs = 96;
  // shape coordinates (x, -z): rotateX(-90 deg) maps (x, y, 0) -> (x, 0, -y) = (x, 0, z), its +Z normal -> +Y (facing up)
  const shape = new THREE.Shape();
  for (let k = 0; k <= segs; k++) {
    const a = (k / segs) * Math.PI * 2, x = o.x + Math.cos(a) * R, z = o.z + Math.sin(a) * R;
    if (k === 0) shape.moveTo(x, -z); else shape.lineTo(x, -z);
  }
  // the opening cut out under ENDING's parapet ring / the roof curb's upstand (both hide the edge)
  const hole = new THREE.Path(), rh = Math.max(o.r + 0.05, Math.min(o.r + 0.4, o.ringR0 + 0.05));
  for (let k = 0; k <= 64; k++) {
    const a = (k / 64) * Math.PI * 2, x = o.x + Math.cos(a) * rh, z = o.z + Math.sin(a) * rh;
    if (k === 0) hole.moveTo(x, -z); else hole.lineTo(x, -z);
  }
  shape.holes.push(hole);
  const g = new THREE.ShapeGeometry(shape, 1);
  g.rotateX(-Math.PI / 2);
  g.translate(0, site.y - SURFACE_LAYERS.groundBelow, 0);
  g.deleteAttribute('uv');
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

/**
 * Build the surface's outside visuals. `models(key)`: the lazy library's GLTF (undefined = not delivered: that entry is skipped).
 * `concrete`: the Reactor's pit-concrete colour map (null: a flat tone).
 */
export function buildSurfaceView(site: SurfaceSite, plan: SurfaceCityPlan, models: (key: string) => GLTF | undefined, concrete: THREE.Texture | null, seed: number, kit: readonly SurfaceKitEntry[] = SURFACE_KIT): SurfaceView {
  const root = new THREE.Group(), outdoor = new THREE.Group(), city = new THREE.Group();
  root.name = 'reactor-surface';
  city.name = 'reactor-surface-city';
  outdoor.name = 'reactor-surface-outdoor';
  root.add(outdoor);
  outdoor.add(city);
  root.visible = false;
  const own: SurfaceView['own'] = {geometries: [], textures: [], materials: []};
  const instanced: THREE.InstancedMesh[] = [], drawn: Record<string, number> = {};
  let tris = 0;
  const cx = plan.centre.x, cz = plan.centre.z;
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sv = new THREE.Vector3(), tv = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  const place = (x: number, y: number, z: number, yaw: number, s: number) => m4.compose(tv.set(x, y, z), q.setFromAxisAngle(up, yaw), sv.set(s, s, s)).clone();
  const addInstanced = (name: string, geometry: THREE.BufferGeometry, material: THREE.Material, mats: THREE.Matrix4[]) => {
    if (!mats.length) return;
    const im = new THREE.InstancedMesh(geometry, material, mats.length);
    im.name = name;
    mats.forEach((m, i) => im.setMatrixAt(i, m));
    im.instanceMatrix.needsUpdate = true;
    im.computeBoundingSphere();
    im.computeBoundingBox();
    im.castShadow = im.receiveShadow = false;
    im.matrixAutoUpdate = false;
    instanced.push(im);
    city.add(im);
    tris += triCount(geometry) * mats.length;
  };
  // --- the city: per kit entry, per model part, per quadrant ---
  const steel = surfaceSteelMaterial();
  own.materials.push(steel);
  for (const e of kit) {
    const list = plan.placements.filter(p => p.entry === e.id);
    const gltf = list.length ? models(e.key) : undefined;
    if (!gltf) continue;
    drawn[e.id] = list.length;
    const byQuad: (typeof list)[] = Array.from({length: QUADS}, () => []);
    for (const p of list) byQuad[quadOf(cx, cz, p.x, p.z)].push(p);
    for (const [pi, part] of modelParts(gltf).entries()) {
      const mat = surfaceModelMaterial(part.material);
      byQuad.forEach((ql, qi) => addInstanced(`reactor-surface-${e.id}-${pi}-q${qi}`, part.geometry, mat,
        ql.map(p => place(p.x, p.y + (e.stand ?? 0) * p.scale, p.z, p.yaw, p.scale).multiply(part.matrix))));
    }
    if (e.stand) {
      const sg = standGeometry(e.dims[0], e.dims[2], e.stand);
      own.geometries.push(sg);
      addInstanced(`reactor-surface-${e.id}-stand`, sg, steel, list.map(p => place(p.x, p.y, p.z, p.yaw, p.scale)));
    }
  }
  // --- the ground (street mask rows: a 1-D data texture) ---
  const rows = streetMaskRows(plan);
  const maskTex = streetMaskTexture(rows.rows, rows.texels);
  own.textures.push(maskTex);
  SURF_U.maskXf.value.set(rows.x0, rows.z0, rows.cell, rows.texels);
  SURF_U.yard.value.set(plan.plaza.x0, plan.plaza.z0, plan.plaza.x1, plan.plaza.z1);
  const gg = groundGeometry(site, plan);
  own.geometries.push(gg);
  const gmat = surfaceGroundMaterial(maskTex, concrete);
  own.materials.push(gmat);
  const ground = new THREE.Mesh(gg, gmat);
  ground.name = 'reactor-surface-ground';
  ground.matrixAutoUpdate = false;
  outdoor.add(ground);
  tris += triCount(gg);
  // --- the plaza parapet (wet concrete) ---
  const pg = parapetGeometry(site);
  let parapet: THREE.Mesh | null = null;
  if (pg) {
    own.geometries.push(pg);
    const pm = surfaceWallMaterial(concrete);
    own.materials.push(pm);
    parapet = new THREE.Mesh(pg, pm);
    parapet.name = 'reactor-surface-parapet';
    parapet.matrixAutoUpdate = false;
    outdoor.add(parapet);
    tris += triCount(pg);
  }
  // --- the wet film over the walkable floor ---
  const fg = filmGeometry(site);
  let film: THREE.Mesh | null = null;
  if (fg) {
    own.geometries.push(fg);
    const fm = surfaceFilmMaterial();
    own.materials.push(fm);
    film = new THREE.Mesh(fg, fm);
    film.name = 'reactor-surface-film';
    film.matrixAutoUpdate = false;
    film.renderOrder = 1;
    outdoor.add(film);
    tris += triCount(fg);
  }
  // --- the outdoor sky (follows the eye: the runtime moves it) ---
  const sg = new THREE.SphereGeometry(SURFACE_SKY.radius, 32, 14);
  sg.deleteAttribute('uv');
  own.geometries.push(sg);
  const skm = surfaceSkyMaterial();
  own.materials.push(skm);
  const sky = new THREE.Mesh(sg, skm);
  sky.name = 'reactor-surface-sky';
  sky.frustumCulled = false;
  sky.renderOrder = -4.5; // (world/mallExterior.ts MALL_EXT_ORDER: over the pit's murk dome -5, under the gas sheets / curtain)
  outdoor.add(sky);
  tris += triCount(sg);
  // --- rain (the shelter map shared by both layers) ---
  const floor = buildRainFloor(site, plan);
  const ft = rainFloorTexture(floor);
  own.textures.push(ft);
  const near = new RainLayer('reactor-surface-rain', SURFACE_RAIN.near.count, ft, floor, seed ^ 0x2a1);
  const column = new RainLayer('reactor-surface-rain-aperture', SURFACE_RAIN.column.count, ft, floor, seed ^ 0x3b7);
  column.column(site);
  outdoor.add(near.mesh);
  root.add(column.mesh);
  for (const o of [ground, film, sky, parapet]) if (o) { o.castShadow = o.receiveShadow = false; o.updateMatrix(); }
  return {root, outdoor, city, ground, parapet, film, sky, near, column, floor, instanced, own, drawn, tris};
}

/** Release what the view owns (the kit's GLB geometry / maps stay with the library; model materials stay cached). */
export function disposeSurfaceView(v: SurfaceView): void {
  v.root.removeFromParent();
  for (const im of v.instanced) im.dispose();
  for (const g of v.own.geometries) g.dispose();
  for (const t of v.own.textures) t.dispose();
  for (const m of v.own.materials) m.dispose();
  v.near.dispose();
  v.column.dispose();
}

/** Every footprint corner of the plan (tests / QA): the city's extent round the aperture. */
export const planExtent = (plan: SurfaceCityPlan): number => Math.max(0, ...plan.placements.flatMap(p => footprintCorners(p).map(([x, z]) => Math.hypot(x - plan.centre.x, z - plan.centre.z))));
