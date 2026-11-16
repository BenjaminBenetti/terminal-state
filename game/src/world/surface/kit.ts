// Task studio-surface-run-opus-rebuild-20261116-020827-01 (lane KIT): draws the Surface Run kit's prop kinds (gen/surface/kinds.ts) for
// world/builder.ts (one dispatch line in its prop loop):
//  - the procedurally drawn kinds: their gen/surface/kitMesh.ts triangles, one BufferGeometry per material, instanced per kind (and per
//    variant batch: the one- / two-blade street sign) in culling cohorts per storey and SURFACE_KIT_CHUNK-metre chunk. Instanced meshes are
//    named `prop-<kind>-<material>` so damage/propDamage.ts RenderIndex finds every placement's instances (the cone / radio / cot detach
//    into their rigid bodies when shot or bumped);
//  - the wrecks: their lazy library model (gen/surface/kinds.ts SURFACE_WRECK_MODEL; fetched under the 'surface' asset family) through the
//    builder's instanceModel at their runtime box (the measured bounds x k); a missing model draws an honest box stand-in;
//  - the street signs' NAMES: a code-drawn dynamic atlas (one canvas per build: each distinct street name of layout.surface.streets once,
//    white on the blades' green) on merged per-storey face quads — runtime-composited per-seed text, root CLAUDE.md's dynamic exemption.
// The crate (srMilitaryCrate) is an openable holder: world/containers.ts / world/openables.ts draw it (the builder skips container kinds).
// Materials: existing approved sets only — shape keys (world/shapeMaterials.ts), purpose paints (world/purposeTextures.ts) and KIT_MATERIALS
// below (tinted existing surface sets; thin wire / pole stock through thinTrim). Nothing here is new static art.

import * as THREE from 'three';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {PROP_DEFS, type PropPlacement} from '../../gen/props';
import type {StationLayout} from '../../gen/stationTypes';
import {isPurposeMat} from '../../gen/purposeShapes';
import {SR_SIGN, SURFACE_WRECK_MODEL, isSurfaceDrawnKind, isSurfaceWreckKind, srStreetSignStreets, type SurfaceKind} from '../../gen/surface/kinds';
import {isKitOwnMat, kitTriangles, srStreetSignFaces, surfaceKitMesh, surfaceKitVariantKey, type KitBuf, type KitMat, type KitOwnMat} from '../../gen/surface/kitMesh';
import {SurfaceNodeMaterial, surfaceMaterial, thinTrim, type WorldMaterials} from '../materials';
import {shapeMaterial} from '../shapeMaterials';
import {purposeMaterial} from '../purposeTextures';
import {planCohorts} from '../staticCohorts';

type Fit = {w: number; h: number; d: number; anchor: 'bottom' | 'top'};
type InstanceModel = (group: THREE.Group, gltf: GLTF, placements: THREE.Matrix4[], fit: Fit, name: string) => number;

/** Culling chunk of the kit's instanced cohorts (m): one district block pitch — few draws, coarse frustum culling on the open streets. */
export const SURFACE_KIT_CHUNK = 64;
/** Build counters (tests / QA). */
export const SURFACE_KIT_BUILD = {instances: 0, meshes: 0, signFaces: 0, standIns: 0};

const WORN = {grime: [0.35, 0.45] as [number, number], macro: 0.15};
/** The kit-own materials: tinted EXISTING surface sets (world/canvasTextures.ts generated sets), created once, shared. */
const KIT_MATERIALS: Readonly<Record<KitOwnMat, () => THREE.Material>> = {
  // woven polypropylene sandbags, sun-faded tan / olive drab (the moulded-plastic set, rough)
  bagTan: () => surfaceMaterial('plastic', {color: 0xa79470, roughness: 0.95}, {grime: [0.45, 0.5], macro: 0.25}),
  bagOlive: () => surfaceMaterial('plastic', {color: 0x6e7050, roughness: 0.95}, {grime: [0.45, 0.5], macro: 0.25}),
  // olive-drab enamel (the radio case, the map table's steel)
  olive: () => surfaceMaterial('paintedPanel', {color: 0x666b4c, metalness: 0.1}, WORN),
  // a dead lamp / signal lens: dark smoked glass, opaque (nothing is lit behind it)
  lens: () => surfaceMaterial('glass', {color: 0x4a4440, roughness: 0.3, metalness: 0.05}, {macro: 0.1}),
  // galvanised wire and tube (thin: 1x anisotropy, world/materials.ts thinTrim)
  wire: () => thinTrim(surfaceMaterial('brushedSteel', {color: 0xbfc3c5, metalness: 0.6, roughness: 0.55}, {grime: [0.2, 0.4], macro: 0.1})),
  galv: () => thinTrim(surfaceMaterial('brushedSteel', {color: 0xa9adb0, metalness: 0.55, roughness: 0.6}, {grime: [0.3, 0.5], macro: 0.12})),
};
const kitOwn = new Map<KitOwnMat, THREE.Material>();
/** The material of a kit key (shared by every build). */
export function kitMaterial(wm: WorldMaterials, m: KitMat): THREE.Material {
  if (isKitOwnMat(m)) {
    let mat = kitOwn.get(m);
    if (!mat) { mat = KIT_MATERIALS[m](); mat.name = `surface-kit-${m}`; kitOwn.set(m, mat); }
    return mat;
  }
  return isPurposeMat(m) ? purposeMaterial(m) : shapeMaterial(wm, m);
}

const UP = new THREE.Vector3(0, 1, 0);
const placeM = (p: PropPlacement) => new THREE.Matrix4().compose(new THREE.Vector3(p.x, p.y, p.z), new THREE.Quaternion().setFromAxisAngle(UP, p.rot), new THREE.Vector3(1, 1, 1));
const hasCanvas = () => typeof document !== 'undefined' && typeof document.createElement === 'function';

function bufGeometry(q: KitBuf): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(q.pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(q.nor, 3));
  // world-mapped materials ignore uvs; a uv attribute keeps every material's program happy (zeros)
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((q.pos.length / 3) * 2), 2));
  g.setIndex(q.idx);
  g.computeBoundingSphere();
  return g;
}

/** Instanced cohorts (per storey, SURFACE_KIT_CHUNK chunks) of one geometry. */
function instanceCohorts(group: THREE.Group, geo: THREE.BufferGeometry, mat: THREE.Material, list: readonly PropPlacement[], name: string): void {
  const cohorts = planCohorts(list, p => ({x: p.x, z: p.z, level: p.level ?? 0}), SURFACE_KIT_CHUNK, Infinity, false);
  for (const {level, list: ps} of cohorts.values()) {
    const im = new THREE.InstancedMesh(geo, mat, ps.length);
    ps.forEach((p, i) => im.setMatrixAt(i, placeM(p)));
    im.name = name;
    im.userData.level = level;
    im.computeBoundingSphere();
    group.add(im);
    SURFACE_KIT_BUILD.meshes++;
  }
}

/** Draws one Surface kit kind's placements. Returns the instance count. */
export function buildSurfaceKitProp(group: THREE.Group, kind: SurfaceKind, list: PropPlacement[], wm: WorldMaterials, instanceModel: InstanceModel,
  models: Readonly<Record<string, GLTF | undefined>>, layout?: StationLayout): number {
  if (!list.length) return 0;
  if (isSurfaceWreckKind(kind)) {
    const m = SURFACE_WRECK_MODEL[kind], def = PROP_DEFS[kind], gltf = models[m.key];
    const n = gltf ? instanceModel(group, gltf, list.map(placeM), {w: def.w, h: def.h, d: def.d, anchor: 'bottom'}, kind) : wreckStandIn(group, kind, list, wm);
    SURFACE_KIT_BUILD.instances += n;
    return n;
  }
  if (!isSurfaceDrawnKind(kind)) return 0; // the crate: world/containers.ts
  const byKey = new Map<string, PropPlacement[]>();
  for (const p of list) { const k = surfaceKitVariantKey(kind, p.variant); const l = byKey.get(k); if (l) l.push(p); else byKey.set(k, [p]); }
  for (const [key, ps] of byKey) {
    const mesh = surfaceKitMesh(kind, ps[0].variant);
    const tag = key === 'v0' ? '' : `-${key}`;
    for (const [m, q] of mesh) instanceCohorts(group, bufGeometry(q), kitMaterial(wm, m), ps, `prop-${kind}${tag}-${m}`);
  }
  if (kind === 'srStreetSign') {
    // the names atlas / material go with the world: on the first sign InstancedMesh's dispose event (game.ts leaveSection disposes
    // instanced meshes; the face meshes' geometry is released there too) — like world/subwayMapKiosks.ts
    const first = group.children.find(o => (o as THREE.InstancedMesh).isInstancedMesh && o.name.startsWith('prop-srStreetSign-'));
    const owned = drawSignFaces(group, list, layout);
    if (owned.length) first?.addEventListener('dispose', () => { for (const o of owned) o.dispose(); owned.length = 0; });
  }
  SURFACE_KIT_BUILD.instances += list.length;
  return list.length;
}

/** A missing wreck model (node tests / a failed optional load): the footprint as a low body + cabin in dark steel, never nothing. */
function wreckStandIn(group: THREE.Group, kind: SurfaceKind, list: readonly PropPlacement[], wm: WorldMaterials): number {
  const def = PROP_DEFS[kind], body = new THREE.BoxGeometry(def.w, def.h * 0.55, def.d * 0.96), cab = new THREE.BoxGeometry(def.w * 0.5, def.h * 0.45, def.d * 0.88);
  body.translate(0, def.h * 0.275, 0);
  cab.translate(-def.w * 0.05, def.h * 0.775, 0);
  const merged = mergeTwo(body, cab);
  instanceCohorts(group, merged, kitMaterial(wm, 'steelDark'), list, `prop-${kind}-standin`);
  SURFACE_KIT_BUILD.standIns += list.length;
  return list.length;
}
function mergeTwo(a: THREE.BufferGeometry, b: THREE.BufferGeometry): THREE.BufferGeometry {
  const ai = a.index!, bi = b.index!, na = a.attributes.position.count;
  const g = new THREE.BufferGeometry();
  for (const k of ['position', 'normal', 'uv'] as const) {
    const x = a.attributes[k] as THREE.BufferAttribute, y = b.attributes[k] as THREE.BufferAttribute;
    const out = new Float32Array(x.array.length + y.array.length);
    out.set(x.array as Float32Array, 0); out.set(y.array as Float32Array, x.array.length);
    g.setAttribute(k, new THREE.BufferAttribute(out, x.itemSize));
  }
  g.setIndex([...Array.from(ai.array), ...Array.from(bi.array, i => i + na)]);
  g.computeBoundingSphere();
  a.dispose(); b.dispose();
  return g;
}

// ---------------------------------------------------------------------------------------------------------------------------
// Street-name blades (dynamic text)

/** "Calder Street" -> "CALDER ST" (the blade abbreviations). */
export function bladeName(name: string): string {
  const ABBR: Readonly<Record<string, string>> = {STREET: 'ST', AVENUE: 'AVE', LANE: 'LN', ROAD: 'RD', BOULEVARD: 'BLVD', DRIVE: 'DR', PLACE: 'PL', COURT: 'CT', TERRACE: 'TER'};
  const words = name.trim().toUpperCase().split(/\s+/).filter(Boolean);
  if (words.length > 1 && ABBR[words[words.length - 1]]) words[words.length - 1] = ABBR[words[words.length - 1]];
  return words.join(' ') || 'STREET';
}
/** The blade names of a placement (layout.surface streets by id; an unknown id draws a plain blade label). */
export function signNames(layout: StationLayout | undefined, variant: number): {a: string; b: string | null} {
  const {a, b} = srStreetSignStreets(variant);
  const byId = (id: number) => layout?.surface?.streets.find(s => s.id === id)?.name;
  return {a: bladeName(byId(a) ?? 'Main Street'), b: b >= 0 ? bladeName(byId(b) ?? 'Cross Street') : null};
}

const ROW_W = 640, ROW_H = 128;

/** The name faces of the street signs (merged per storey); returns the atlas texture / material the caller releases with the world. */
function drawSignFaces(group: THREE.Group, list: readonly PropPlacement[], layout: StationLayout | undefined): {dispose(): void}[] {
  if (!hasCanvas()) return []; // (node builds without a DOM: the green blades stand alone)
  const rows = new Map<string, number>();
  const facesOf = list.map(p => {
    const names = signNames(layout, p.variant);
    return srStreetSignFaces(p.variant).map(f => {
      const text = f.blade === 'a' ? names.a : names.b!;
      if (!rows.has(text)) rows.set(text, rows.size);
      return {...f, row: rows.get(text)!};
    });
  });
  const n = rows.size, c = document.createElement('canvas');
  c.width = ROW_W; c.height = ROW_H * n;
  const ctx = c.getContext('2d');
  if (!ctx) return [];
  for (const [text, r] of rows) {
    const y0 = r * ROW_H;
    ctx.fillStyle = '#1f5a3a'; ctx.fillRect(0, y0, ROW_W, ROW_H);
    ctx.strokeStyle = '#e8ece6'; ctx.lineWidth = 6; ctx.strokeRect(9, y0 + 9, ROW_W - 18, ROW_H - 18);
    ctx.fillStyle = '#eef1ec'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    let size = 76;
    ctx.font = `bold ${size}px "Helvetica Neue", Arial, sans-serif`;
    while (size > 30 && ctx.measureText(text).width > ROW_W - 60) { size -= 4; ctx.font = `bold ${size}px "Helvetica Neue", Arial, sans-serif`; }
    ctx.fillText(text, ROW_W / 2, y0 + ROW_H / 2 + 3);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = 8;
  const mat = new SurfaceNodeMaterial({map: tex, roughness: 0.45, metalness: 0});
  mat.name = 'surface-sign-names';
  // one quad per blade side (prop frame), uv rows into the atlas; merged per storey
  const {bladeL, bladeH, bladeT} = SR_SIGN, w = bladeL - 0.016, h = bladeH - 0.012, off = bladeT / 2 + 0.0008;
  const byLevel = new Map<number, {pos: number[]; uv: number[]; idx: number[]}>();
  const m4 = new THREE.Matrix4(), v = new THREE.Vector3();
  list.forEach((p, i) => {
    const L = p.level ?? 0;
    let acc = byLevel.get(L);
    if (!acc) byLevel.set(L, (acc = {pos: [], uv: [], idx: []}));
    m4.copy(placeM(p));
    for (const f of facesOf[i]) {
      const v0 = 1 - (f.row + 1) / n, v1 = 1 - f.row / n;
      for (const side of [1, -1]) {
        // corners in the blade's own frame: along = the blade's length axis, out = its face normal (+-)
        const corner = (s: number, t: number): number[] => {
          const along = s * w / 2, up = t * h / 2, out = side * off;
          const local = f.normal === 'z' ? [f.c[0] + along * side, f.c[1] + up, f.c[2] + out] : [f.c[0] + out, f.c[1] + up, f.c[2] - along * side];
          v.set(local[0], local[1], local[2]).applyMatrix4(m4);
          return [v.x, v.y, v.z];
        };
        const k = acc.pos.length / 3;
        acc.pos.push(...corner(-1, -1), ...corner(1, -1), ...corner(1, 1), ...corner(-1, 1));
        acc.uv.push(0, v0, 1, v0, 1, v1, 0, v1);
        acc.idx.push(k, k + 1, k + 2, k, k + 2, k + 3);
        SURFACE_KIT_BUILD.signFaces++;
      }
    }
  });
  for (const [level, acc] of byLevel) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(acc.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(acc.uv, 2));
    g.setIndex(acc.idx);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, mat);
    mesh.name = `surface-sign-names-L${level}`;
    mesh.userData.level = level;
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
    SURFACE_KIT_BUILD.meshes++;
  }
  return [tex, mat];
}

/** Triangles per instance of a drawn kind's variant (tests / budgets). */
export const surfaceKitTris = (kind: SurfaceKind, variant = 0): number => (isSurfaceDrawnKind(kind) ? kitTriangles(surfaceKitMesh(kind, variant)) : 0);
