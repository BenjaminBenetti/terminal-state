// Renders the storefront bays of a station (iteration 04): the architectural building blocks from
// gen/storefronts.ts (frames, sign bands, bulkheads, menu boards, shutters, rod grilles, glazing,
// plinths, mullions, food-court seating rugs) merged into ONE mesh per material key; all fascia
// lettering in ONE atlas texture (one draw call); leasing hoardings share one poster texture; the
// modular furniture holders (counter / display / back counter / cooler) instanced — generated
// models (Lane A) when present, procedural blocks otherwise, brand-coloured counter fronts.
// Materials come from world/shapeMaterials.ts (Lane C; world-space metre mapping, so merged boxes
// keep true texture scale; menu boards are face-mapped).
// Iteration 05 (Lane R): per-purpose menu boards (`menuBoard:<use>`) and the PURPOSE props of
// gen/purposes.ts wherever they stand (store fixtures, kitchen lines, back-of-house furniture):
// authored parts (gen/purposeShapes.ts, textures world/purposeTextures.ts) baked into static
// meshes per 12 m chunk and material; decor kinds use Lane A generated models when present.

import * as THREE from 'three';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {PROP_DEFS, PURPOSE_MODEL_KEYS, PURPOSE_PROP_KINDS, SHOP_DISPLAY_CASE, type PropKind, type PropPlacement, type PurposePropKind} from '../gen/props';
import {STORE_PURPOSES} from '../gen/purposes';
import {isP7Kind, p7ModelKey} from '../gen/props07';
import {rendersOwnBody} from './openablesSpec';
import {PURPOSE_ACCENT, isPurposeMat, purposePropShape, shapeVariant, stockShelfStock, type PurposePart} from '../gen/purposeShapes';
import {AUTHORED_CARCASS, displayTreatment} from './shelfStockCarcass';
import {bareTechTableParts, isMerchBare, splitDeviceWall} from './skywaysMerch'; // task studio-skywalk-variety-20261107-231448-01 (lane MERCH)
import {SHOP_HOLDERS, shopPropShape, storefrontParts, type ShopBox, type ShopFace} from '../gen/storefronts';
import type {ShopUse, StationLayout, Storefront} from '../gen/stationTypes';
import {canvasTexture} from './canvasTextures';
import {SurfaceNodeMaterial, surfaceMaterial} from './materials';
import {PAINT, purposeMaterial, purposeMenuMaterial} from './purposeTextures';
import {planCohorts, trianglesOf} from './staticCohorts'; // task static-batching-warmup-20261105
import {drainSync, type BuildSteps} from '../core/pacedBuild'; // task studio-perf-ao-train-continuity-20261110-022206-01 (lane BUILD)
import {drawMallFascia} from './skywaysMallFascia'; // task studio-skywalk-encounters-20261108-074144-01 (lane STORES): Mall store families' fascias

export interface StorefrontDeps {
  /** Shape material by key (falls back to a related key). */
  mat: (key: string) => THREE.Material;
  models: Record<string, GLTF | undefined>;
  instanceModel: (group: THREE.Group, gltf: GLTF, placements: THREE.Matrix4[], fit: {w: number; h: number; d: number; anchor: 'bottom' | 'top'}, name: string) => number;
}

const UP = new THREE.Vector3(0, 1, 0);

/**
 * Generated purpose models used when present. Decor kinds fit their PROP_DEFS box directly;
 * holder kinds (gunLocker, hotdogCart) stay authored until their loot surfaces are measured on
 * the generated model (props.ts PURPOSE_SURFACES must describe the rendered geometry).
 */
const MODEL_READY: ReadonlySet<PurposePropKind> = new Set<PurposePropKind>(['magazineRack', 'janitorCart', 'deviceWall', 'staffLockers']);

/** Material for any storefront/purpose key: per-purpose menus, purpose textures, shape keys. */
function materialFor(deps: StorefrontDeps, key: string): THREE.Material {
  if (key.startsWith('menuBoard:')) {
    const menu = STORE_PURPOSES[key.slice('menuBoard:'.length) as ShopUse]?.menu;
    return menu ? purposeMenuMaterial(menu, key) : deps.mat('menuBoard');
  }
  if (isPurposeMat(key)) return purposeMaterial(key);
  return deps.mat(key);
}

/** Builds every storefront of the layout into `group`. Returns the instance count (stats). */
export function buildStorefronts(group: THREE.Group, layout: StationLayout, deps: StorefrontDeps): number {
  return drainSync(buildStorefrontsSteps(group, layout, deps));
}

/**
 * task studio-perf-ao-train-continuity-20261110-022206-01 (lane BUILD): buildStorefronts as steps (core/pacedBuild.ts) — the same code in the same order, a `yield` every few bays, between its
 * phases and per holder kind, where the journey's paced build may let a frame be drawn (the station group is not in the scene yet).
 */
export function* buildStorefrontsSteps(group: THREE.Group, layout: StationLayout, deps: StorefrontDeps): BuildSteps<number> {
  const boxes: ShopBox[] = [...layout.decor];
  const faces: ShopFace[] = [];
  let step = 0;
  for (const sf of layout.storefronts) {
    if (++step % 4 === 0) yield;
    const p = storefrontParts(layout, sf, {anchorSign: true}); // (+ anchorSign: task studio-alpha-skyways-shops-20261107-054512-01)
    boxes.push(...p.boxes);
    faces.push(...p.faces);
  }
  yield 'world.storefronts.blocks';
  // --- Architectural blocks: one merged mesh per material key -------------------------------
  const byMat = new Map<string, ShopBox[]>();
  for (const b of boxes) { let l = byMat.get(b.m); if (!l) byMat.set(b.m, (l = [])); l.push(b); }
  for (const [key, list] of byMat) {
    if (++step % 8 === 0) yield;
    const geo = mergeAabbs(list);
    const mesh = new THREE.Mesh(geo, materialFor(deps, key));
    mesh.name = `shopfront-${key}`;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    group.add(mesh);
  }
  yield 'world.storefronts.fascia';
  // --- Fascia lettering (atlas) and leasing hoardings ------------------------------------------
  const fascias = faces.filter(f => f.kind === 'fascia');
  if (fascias.length) group.add(faceMesh(fascias, fasciaAtlas(layout.storefronts, fascias), 'shopfront-fascia'));
  const hoardings = faces.filter(f => f.kind === 'hoarding');
  if (hoardings.length) group.add(faceMesh(hoardings, hoardingTexture(), 'shopfront-hoarding'));
  // --- Furniture holders --------------------------------------------------------------------
  let instances = 0;
  for (const kind of SHOP_HOLDERS) {
    yield `world.storefronts.${kind}`;
    if (rendersOwnBody(kind, deps.models)) continue; // iteration 08 (Lane I): openable (glass-door cooler) drawn by world/openables.ts
    const list = layout.props.filter(p => p.kind === kind);
    if (!list.length) continue;
    const def = PROP_DEFS[kind];
    const placements = list.map(placeM);
    const model = deps.models[kind];
    if (kind === 'shopDisplay' && model && deps.models.shopCounter) {
      // Composite building blocks: generated counter module as the base, generated countertop
      // display/warmer standing on its top (never stretched to the whole unit's height).
      const counter = PROP_DEFS.shopCounter, c = SHOP_DISPLAY_CASE;
      instances += deps.instanceModel(group, deps.models.shopCounter, placements, {w: def.w, h: counter.h, d: def.d, anchor: 'bottom'}, 'shopDisplay-base');
      const lift = new THREE.Matrix4().makeTranslation(0, c.baseY, 0);
      instances += deps.instanceModel(group, model, placements.map(m => m.clone().multiply(lift)), {w: c.w, h: c.h, d: c.d, anchor: 'bottom'}, kind);
      continue;
    }
    if (model) {
      instances += deps.instanceModel(group, model, placements, {w: def.w, h: def.h, d: def.d, anchor: 'bottom'}, kind);
      continue;
    }
    instances += proceduralFurniture(group, kind, list, placements, layout.storefronts, deps);
  }
  yield 'world.storefronts.purpose';
  // --- Purpose props (iteration 05): store fixtures, kitchen lines, back-of-house furniture ------
  instances += yield* buildPurposeProps(group, layout, deps);
  yield 'world.storefronts.p7';
  // --- Iteration 07 (Lane P2): NEW generated prop types (lazy per-station models) ---------------------------------------------
  instances += buildP7Props(group, layout, deps);
  return instances + boxes.length;
}

/**
 * Iteration-07 generated props (gen/props07.ts): one instanced mesh per kind per chunk, fitted to the measured footprint (scale ~1).
 * Models are lazy (assets/loader.ts PropModelLibrary, loaded before the station is revealed); a kind whose model is not loaded renders
 * nothing — never a box stand-in (the game drops such placements before building, see props07.dropUnloadedP7).
 */
function buildP7Props(group: THREE.Group, layout: StationLayout, deps: StorefrontDeps): number {
  const byKind = new Map<string, PropPlacement[]>();
  for (const p of layout.props) {
    if (!isP7Kind(p.kind) || rendersOwnBody(p.kind, deps.models)) continue; // iteration 08 (Lane I): openables draw their own split body
    let l = byKind.get(p.kind);
    if (!l) byKind.set(p.kind, (l = []));
    l.push(p);
  }
  let n = 0;
  for (const [kind, list] of [...byKind].sort((a, b) => a[0].localeCompare(b[0]))) {
    const model = deps.models[p7ModelKey(kind)];
    if (!model) continue;
    const def = PROP_DEFS[kind as PropKind];
    // Low wall mounts (hose reels, payphones, urinals) collide from the floor but render `lift` metres up.
    const mats = list.map(p => (p.lift ? new THREE.Matrix4().makeTranslation(0, p.lift, 0).multiply(placeM(p)) : placeM(p)));
    n += deps.instanceModel(group, model, mats, {w: def.w, h: def.h, d: def.d, anchor: 'bottom'}, kind);
  }
  return n;
}

const placeM = (p: PropPlacement) => new THREE.Matrix4().compose(new THREE.Vector3(p.x, p.y, p.z), new THREE.Quaternion().setFromAxisAngle(UP, p.rot), new THREE.Vector3(1, 1, 1));

function proceduralFurniture(group: THREE.Group, kind: PropKind, list: PropPlacement[], placements: THREE.Matrix4[], storefronts: Storefront[], deps: StorefrontDeps): number {
  const parts = shopPropShape(kind);
  if (!parts) return 0;
  const byMat = new Map<string, THREE.BufferGeometry[]>();
  for (const p of parts) {
    const b = new THREE.BoxGeometry(p.s[0], p.s[1], p.s[2]);
    b.translate(p.p[0], p.p[1], p.p[2]);
    let l = byMat.get(p.m);
    if (!l) byMat.set(p.m, (l = []));
    l.push(b);
  }
  const brand = list.map(p => new THREE.Color(p.shop !== undefined ? storefronts[p.shop]?.color ?? 0xb0a890 : 0xb0a890));
  for (const [m, geos] of byMat) {
    const geo = mergeGeometries(geos);
    const im = new THREE.InstancedMesh(geo, deps.mat(m), placements.length);
    placements.forEach((mm, i) => im.setMatrixAt(i, mm));
    if (m === 'accent') brand.forEach((c, i) => im.setColorAt(i, c));
    im.name = `shop-${kind}-${m}`;
    im.computeBoundingSphere();
    group.add(im);
  }
  return list.length;
}

const CHUNK = 12;
let accentVC: THREE.Material | null = null;
/** The `accent` shape material with vertex colours (merged purpose parts carry their tint per vertex). */
function accentVertexColored(): THREE.Material {
  return (accentVC ??= surfaceMaterial('paintedPanel', {metalness: 0.1, vertexColors: true}, {grime: [0.35, 0.45], macro: 0.15}));
}

/**
 * Purpose props: generated models (decor kinds) instanced; authored parts baked into STATIC
 * meshes merged per (12 m chunk, material key) — one draw call per material per chunk however
 * many fixtures stand there, frustum-culled by chunk. `accent` parts take the storefront brand
 * colour, else the kind's palette (vertex colours).
 */
function* buildPurposeProps(group: THREE.Group, layout: StationLayout, deps: StorefrontDeps): BuildSteps<number> { // (task studio-perf-ao-train-continuity-20261110-022206-01 (lane BUILD): steps — per kind, every 16 props, per merged mesh)
  let instances = 0, step = 0;
  const buckets = new Map<string, {mat: string; geos: THREE.BufferGeometry[]; level?: number}>();
  const parts0: {level: number; x: number; z: number; mk: string; geo: THREE.BufferGeometry}[] = [];
  const shapes = new Map<string, PurposePart[]>();
  const tmp = new THREE.Color(), paintCol = new THREE.Color();
  // task mall-round2 (lane PERF): storey-split chunks, mall only (task studio-reactor-submit, lane CPU: + the Reactor's stacked tiers)
  // (task studio-skywalk-variety-20261107-231448-01, lane PERF: + the Skyways — fine chunks are what its occlusion culls with)
  const byStorey = !!(layout as {mall?: unknown}).mall || !!(layout as {reactor?: unknown}).reactor || !!(layout as {skyways?: unknown}).skyways;
  for (const kind of PURPOSE_PROP_KINDS) {
    yield;
    if (rendersOwnBody(kind, deps.models)) continue; // iteration 08 (Lane I): openable (lockers, safe) drawn by world/openables.ts
    const list = layout.props.filter(p => p.kind === kind);
    if (!list.length) continue;
    const def = PROP_DEFS[kind];
    const modelKey = PURPOSE_MODEL_KEYS[kind];
    // Iteration 08 (Lane S): kinds whose model bakes product pictures in (magazine rack) use the derived authored carcass instead.
    const model = modelKey && MODEL_READY.has(kind) && !AUTHORED_CARCASS.has(kind) ? deps.models[modelKey] : undefined;
    if (model) {
      // (task studio-skywalk-variety-20261107-231448-01, lane MERCH: a bare unit — Skyways version 4 stands its devices as separate props —
      // draws the model's own cut, without them: world/skywaysMerch.ts splitDeviceWall)
      const bare = list.filter(p => isMerchBare(kind, p.variant)), whole = bare.length ? list.filter(p => !isMerchBare(kind, p.variant)) : list;
      if (whole.length) instances += deps.instanceModel(group, model, whole.map(placeM), {w: def.w, h: def.h, d: def.d, anchor: 'bottom'}, kind);
      if (bare.length) instances += deps.instanceModel(group, splitDeviceWall(model).body, bare.map(placeM), {w: def.w, h: def.h, d: def.d, anchor: 'bottom'}, kind);
      continue;
    }
    // Stock shelves over the generated shelving unit (same frame as plain shelves) when present.
    const stockOnly = kind === 'stockShelf' && !!deps.models.shelf;
    if (stockOnly) instances += deps.instanceModel(group, deps.models.shelf!, list.map(placeM), {w: def.w, h: def.h, d: def.d, anchor: 'bottom'}, 'stockShelf-frame');
    const palette = PURPOSE_ACCENT[kind];
    for (const p of list) {
      if (++step % 16 === 0) yield;
      const v = shapeVariant(kind, p.variant);
      const bare = isMerchBare(kind, p.variant); // (lane MERCH: a bare demo table — its devices are separate props in Skyways version 4)
      const sk = `${kind}:${v}:${stockOnly ? 's' : 'f'}${bare ? ':bare' : ''}`;
      let parts = shapes.get(sk);
      // Iteration 08 (Lane S): display treatment derived at runtime — product-picture parts removed (3D filler stock stands on the boards).
      if (!parts) {
        parts = displayTreatment(kind, v, stockOnly ? stockShelfStock(v) : purposePropShape(kind, v) ?? [], {model: stockOnly});
        if (bare && kind === 'techDisplay') parts = bareTechTableParts(parts);
        shapes.set(sk, parts);
      }
      if (!parts.length) continue;
      instances++;
      const m4 = placeM(p);
      // Task mall-round2-20261031 (lane PERF): in the mall a chunk is also per storey ('<storey>:<cx>,<cz>'): a chunk holding two
      // storeys' fixtures had a box spanning both, so the level culler could never level- / slab- / occlusion-cull it (world/levelCulling.ts)
      const level = p.level ?? 0; // (task static-batching-warmup-20261105: every level splits per storey; the cohort is chosen below)
      const accent = tmp.set(p.shop !== undefined ? layout.storefronts[p.shop]?.color ?? 0xb0a890
        : palette?.length ? palette[Math.abs(Math.round(p.x * 7 + p.z * 13 + p.variant)) % palette.length] : 0xb0a890);
      for (const part of parts) {
        const b = new THREE.BoxGeometry(part.s[0], part.s[1], part.s[2]);
        if (part.rx) b.rotateX(part.rx);
        if (part.ry) b.rotateY(part.ry);
        b.translate(part.p[0], part.p[1], part.p[2]);
        b.applyMatrix4(m4);
        // Brand/palette accent and the painted-panel tints share one vertex-coloured material.
        const paint = PAINT[part.m as keyof typeof PAINT];
        const mk = paint !== undefined ? 'accent' : part.m;
        if (mk === 'accent') {
          const c3 = paint !== undefined ? paintCol.set(paint) : accent;
          const n = b.attributes.position.count, c = new Float32Array(n * 3);
          for (let i = 0; i < n; i++) c.set([c3.r, c3.g, c3.b], i * 3);
          b.setAttribute('color', new THREE.BufferAttribute(c, 3));
        }
        parts0.push({level, x: p.x, z: p.z, mk, geo: b});
      }
    }
  }
  // Task static-batching-warmup-20261105 (world/staticCohorts.ts): per (level, material key), the 12 m chunks of that level — or, where the
  // culler has no slab occlusion (!byStorey), 48 m cohorts when its parts there total <= STATIC_COHORTS.levelTriangles
  // ('purpose-<level>:<cx>,<cz>|<key>' / 'purpose-<level>:c<cx>,<cz>|<key>'; damage/propDamage.ts reads the key after '|'). The mall /
  // Reactor already split per storey (byStorey); the Subway / Office now do too.
  const byMat = new Map<string, typeof parts0>();
  for (const e of parts0) { const k = `${e.level}|${e.mk}`; let l = byMat.get(k); if (!l) byMat.set(k, (l = [])); l.push(e); }
  for (const list of byMat.values()) {
    const tris = list.reduce((s, e) => s + trianglesOf(e.geo), 0) / list.length; // (box parts: equal per part; the mean keeps the rule exact)
    for (const [cohort, {list: es}] of planCohorts(list, e => e, CHUNK, tris, !byStorey)) {
      const key = `${cohort}|${es[0].mk}`;
      let bk = buckets.get(key);
      if (!bk) buckets.set(key, (bk = {mat: es[0].mk, geos: [], level: es[0].level}));
      for (const e of es) bk.geos.push(e.geo);
    }
  }
  yield;
  for (const [key, bk] of buckets) {
    yield;
    const geo = mergeGeometries(bk.geos);
    const mesh = new THREE.Mesh(geo, bk.mat === 'accent' ? accentVertexColored() : materialFor(deps, bk.mat));
    mesh.name = `purpose-${key}`;
    if (bk.level !== undefined) mesh.userData.level = bk.level; // (the culler's level of the cohort)
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    group.add(mesh);
  }
  return instances;
}

// ---------------------------------------------------------------------------------------
// Geometry helpers

/** Axis-aligned boxes → one indexed geometry (positions, normals, per-face 0..1 UVs like BoxGeometry). */
function mergeAabbs(list: ShopBox[]): THREE.BufferGeometry {
  const pos = new Float32Array(list.length * 24 * 3), nor = new Float32Array(list.length * 24 * 3), uv = new Float32Array(list.length * 24 * 2);
  const idx = new Uint32Array(list.length * 36);
  let v = 0, ii = 0;
  // Faces: +X, -X, +Y, -Y, +Z, -Z. Corners chosen so (u, v) read correctly from outside.
  const face = (n: [number, number, number], c: number[][]) => {
    for (let k = 0; k < 4; k++) {
      pos.set(c[k], (v + k) * 3);
      nor.set(n, (v + k) * 3);
    }
    uv.set([0, 0, 1, 0, 1, 1, 0, 1], v * 2);
    idx.set([v, v + 1, v + 2, v, v + 2, v + 3], ii);
    v += 4; ii += 6;
  };
  for (const b of list) {
    const {x0, y0, z0, x1, y1, z1} = b;
    face([1, 0, 0], [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]]);
    face([-1, 0, 0], [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]]);
    face([0, 1, 0], [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]]);
    face([0, -1, 0], [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]]);
    face([0, 0, 1], [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]]);
    face([0, 0, -1], [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  return g;
}

function mergeGeometries(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let vc = 0, ic = 0;
  for (const b of list) { vc += b.attributes.position.count; ic += b.index!.count; }
  const pos = new Float32Array(vc * 3), nor = new Float32Array(vc * 3), uv = new Float32Array(vc * 2), idx = new Uint32Array(ic);
  // Vertex colours (merged purpose `accent` parts) when every input carries them.
  const col = list.every(b => b.attributes.color) ? new Float32Array(vc * 3) : null;
  let vo = 0, io = 0;
  for (const b of list) {
    pos.set(b.attributes.position.array as Float32Array, vo * 3);
    nor.set(b.attributes.normal.array as Float32Array, vo * 3);
    uv.set(b.attributes.uv.array as Float32Array, vo * 2);
    if (col) col.set(b.attributes.color.array as Float32Array, vo * 3);
    const src = b.index!.array;
    for (let i = 0; i < src.length; i++) idx[io + i] = src[i] + vo;
    vo += b.attributes.position.count; io += src.length;
    b.dispose();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  if (col) g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  return g;
}

/** Quads facing along each face's yaw, UVs from an atlas rect per face (or the full texture). */
function faceMesh(faces: ShopFace[], tex: {texture: THREE.Texture; rects?: Map<ShopFace, [number, number, number, number]>}, name: string): THREE.Mesh {
  const n = faces.length;
  const pos = new Float32Array(n * 12), nor = new Float32Array(n * 12), uv = new Float32Array(n * 8), idx = new Uint32Array(n * 6);
  faces.forEach((f, i) => {
    const nx = Math.sin(f.rot), nz = Math.cos(f.rot);
    // Right vector for a viewer facing the face: (cos, 0, -sin) of the yaw.
    const rx = Math.cos(f.rot), rz = -Math.sin(f.rot);
    const hw = f.w / 2, hh = f.h / 2;
    const corners = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]];
    corners.forEach(([a, b], k) => {
      pos.set([f.x + rx * a, f.y + b, f.z + rz * a], (i * 4 + k) * 3);
      nor.set([nx, 0, nz], (i * 4 + k) * 3);
    });
    const [u0, v0, u1, v1] = tex.rects?.get(f) ?? [0, 0, 1, 1];
    uv.set([u0, v0, u1, v0, u1, v1, u0, v1], i * 8);
    idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  const mat = new SurfaceNodeMaterial({map: tex.texture, emissive: 0xffffff, emissiveMap: tex.texture, emissiveIntensity: 0.75, roughness: 0.45, metalness: 0}); // Iteration 13 (MAT-A)
  const mesh = new THREE.Mesh(g, mat);
  mesh.name = name;
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  return mesh;
}

// ---------------------------------------------------------------------------------------
// Textures

const hex = (c: number, k = 1) => {
  const r = Math.round(((c >> 16) & 255) * k), g = Math.round(((c >> 8) & 255) * k), b = Math.round((c & 255) * k);
  return `rgb(${r},${g},${b})`;
};
const luminance = (c: number) => (0.299 * ((c >> 16) & 255) + 0.587 * ((c >> 8) & 255) + 0.114 * (c & 255)) / 255;

/**
 * One canvas for every fascia: brand-coloured backlit box sign with the (fictional) name. Lit /
 * dim / dead signs are baked into the colours (the material is emissive with the same map), dead
 * signs also lose letters and get a dark smear.
 */
function fasciaAtlas(storefronts: Storefront[], faces: ShopFace[]): {texture: THREE.Texture; rects: Map<ShopFace, [number, number, number, number]>} {
  const SW = 768, SH = 96, cols = 2;
  const rows = Math.ceil(faces.length / cols);
  const W = SW * cols, H = Math.max(SH, rows * SH);
  const rects = new Map<ShopFace, [number, number, number, number]>();
  const texture = canvasTexture(W, H, 7300 + faces.length, (ctx, _w, _h, rnd) => {
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, W, H);
    faces.forEach((f, i) => {
      const sf = storefronts[f.sf];
      const x = (i % cols) * SW, y = Math.floor(i / cols) * SH;
      // Slot aspect follows the sign: wide signs use the full slot, short ones a narrower slice.
      const aspect = f.w / f.h;
      const sw = Math.min(SW, Math.round(SH * aspect));
      // (task studio-skywalk-encounters-20261108-074144-01, lane STORES) a Skywalk Mall store family: its slot in the Mall brand style
      if (sf.mall) {
        drawMallFascia(ctx, x, y, sw, SH, sf.name, sf.mall, sf.sign, rnd);
        rects.set(f, [x / W, 1 - (y + SH) / H, (x + sw) / W, 1 - y / H]);
        return;
      }
      const k = sf.sign === 'lit' ? 1 : sf.sign === 'dim' ? 0.55 : 0.22;
      const light = luminance(sf.color) > 0.6;
      ctx.fillStyle = light ? hex(0x1d2023, k) : hex(sf.color, k);
      ctx.fillRect(x, y, sw, SH);
      ctx.fillStyle = hex(light ? sf.color : 0xffffff, k * (light ? 1 : 0.92));
      ctx.fillRect(x, y + SH - 7, sw, 3);
      let size = Math.round(SH * 0.56);
      const font = () => `bold ${size}px "Helvetica Neue", Arial, sans-serif`;
      ctx.font = font();
      const text = sf.name.toUpperCase();
      while (ctx.measureText(text).width > sw - 30 && size > 18) { size -= 2; ctx.font = font(); }
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';
      const fg = light ? hex(sf.color, Math.max(0.35, k)) : hex(0xf6f0e0, k);
      if (sf.sign === 'dead') {
        // Letters drawn one by one; some burnt out entirely.
        let cx = x + sw / 2 - ctx.measureText(text).width / 2;
        ctx.textAlign = 'left';
        for (const ch of text) {
          ctx.fillStyle = rnd() < 0.35 ? 'rgba(20,20,20,0.9)' : fg;
          ctx.fillText(ch, cx, y + SH / 2 - 2);
          cx += ctx.measureText(ch).width;
        }
      } else {
        ctx.fillStyle = fg;
        ctx.fillText(text, x + sw / 2, y + SH / 2 - 2);
      }
      // Grime: soft dark patches and a dirty lower edge (maintained neglect).
      for (let g = 0; g < 4; g++) {
        ctx.fillStyle = `rgba(20,16,12,${0.08 + rnd() * 0.18})`;
        ctx.fillRect(x + rnd() * sw, y + rnd() * SH, 20 + rnd() * sw * 0.25, 6 + rnd() * SH * 0.5);
      }
      ctx.fillStyle = 'rgba(30,24,18,0.35)';
      ctx.fillRect(x, y + SH - 12, sw, 12);
      // UV rect (v = 0 at the bottom of the canvas).
      rects.set(f, [x / W, 1 - (y + SH) / H, (x + sw) / W, 1 - y / H]);
    });
  });
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.anisotropy = 4;
  return {texture, rects};
}

let hoardingTex: THREE.Texture | null = null;
/** Printed vacant-unit hoarding (fictional landlord; research R22 "LEASING INQUIRIES"). */
function hoardingTexture(): {texture: THREE.Texture} {
  if (!hoardingTex) {
    hoardingTex = canvasTexture(512, 256, 7411, (ctx, w, h, rnd) => {
      ctx.fillStyle = '#e6e0d2'; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#2f7a78'; ctx.fillRect(0, 0, w, h * 0.26);
      ctx.fillStyle = '#f2ecdf'; ctx.font = 'bold 34px "Helvetica Neue", Arial, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('SPACE AVAILABLE', w / 2, h * 0.13);
      ctx.fillStyle = '#2a2522'; ctx.font = 'bold 26px "Helvetica Neue", Arial, sans-serif';
      ctx.fillText('RETAIL · FOOD SERVICE', w / 2, h * 0.42);
      ctx.font = '22px "Helvetica Neue", Arial, sans-serif';
      ctx.fillText('LEASING INQUIRIES', w / 2, h * 0.6);
      ctx.font = 'bold 24px "Helvetica Neue", Arial, sans-serif';
      ctx.fillText('TRANSIT PROPERTIES · 555-0134', w / 2, h * 0.74);
      // Tears, tape and grime.
      for (let i = 0; i < 9; i++) { ctx.fillStyle = `rgba(40,32,24,${0.06 + rnd() * 0.16})`; ctx.fillRect(rnd() * w, rnd() * h, 30 + rnd() * 120, 8 + rnd() * 40); }
      ctx.fillStyle = 'rgba(210,200,150,0.8)'; ctx.fillRect(w * 0.7, h * 0.86, 90, 18);
      ctx.fillStyle = 'rgba(30,24,18,0.4)'; ctx.fillRect(0, h * 0.9, w, h * 0.1);
    });
    hoardingTex.wrapS = hoardingTex.wrapT = THREE.ClampToEdgeWrapping;
  }
  return {texture: hoardingTex};
}
