// Task gas-mask-roof-feedback-20261030 (feedback item 4): the FIRST-PERSON GAS MASK VIEW — you look out through the real mask's
// visor while it is on your face. It replaces the old CSS / SVG camera overlay (ui/maskOverlay.ts, removed).
//
// THE MODEL is the shipped zombie-outfit gas mask (assets/models/outfit-gasmask-t25.glb, mesh `Outfit_gasmask__lastshift`, the
// same mesh the gas-mask pickup uses: gear/models.ts). This is a LOCAL VIEWMODEL DERIVATIVE made at load time from that already
// loaded, accepted art; nothing new is generated and no file is written. Provenance is unchanged: the mask was delivered and
// review-accepted in the authorized Meshy T2.5 replacement; its derivative record still says approved: false, gameReady: false
// and no licence clearance (delivery acceptance is not legal clearance).
//
// cutMaskView() (CPU, once at load):
//  1. bakes the skinned mesh's bind pose into a static copy (skin attributes dropped), like the pickup;
//  2. splits it into geometric islands (vertices welded by position). The visor glass is two separate sheet islands (outer and
//     inner face of the lens) in front of the eyes: they are found as the non-body islands crossed by rays in a cone forward
//     from an eye guess, and REMOVED from the shell, so the visor is an opening framed by the mask's own rubber rim, nose-
//     bridge dip, inner walls and valve;
//  3. puts the eye behind the visor (MASK_VIEW.eye: across the glass box, `eyeToGlass` behind the glass at its centre) and
//     re-expresses everything in the viewmodel camera's frame (eye at the origin, visor toward -Z), scaled about the eye
//     (MASK_VIEW.scale) so the whole mask sits closer than any held item (the rifle optic's eyepiece is 10.5 cm away) —
//     scaling about the eye does not change the image;
//  4. the inner glass sheet becomes the LENS: its triangles turned to face the eye, planar UVs over the glass, and a lens
//     texture computed from the sheet's own outline (distance to its boundary): a faint tint that is clear in the middle,
//     a darker band along the rim (edge darkening / rubber shadow), breath condensation low in the corners, a few soft
//     smudges and faint scratches — all kept out of the central aim area;
//  5. the shell gets vertex colours (dark near the face seal, lighter toward the visor where light comes in) and a matte
//     rubber material (the outfit's colour texture, metalness 0), double-sided so its inner faces render.
// Triangles: ~2.6k shell + ~0.2k lens (the source mesh is 3k). If the outfit mesh is missing or the cut fails, a small
// procedural frame + lens stands in (never on the normal load path: the outfit file is a required main asset).
//
// MaskView (runtime): one root under the viewmodel camera (Viewmodel.addFaceRoot), so it renders in the existing viewmodel
// overlay pass (render/overlay.ts; no new pass) and is compiled on the loading screen by the 'weapons and held items' warm-up
// pass (its root is one of Viewmodel.warmRoots()). Materials, textures and geometry are made ONCE here; set() / update() only
// move the root, toggle its visibility and write material uniforms (lens opacity, emissive colour / intensity) — never a
// new material, geometry, light or render target.
//  - cover (GasMaskSystem.cover 0..1, eased): the mask comes up from below and in front, tipped, and settles on the face;
//    doffing goes back the same way; cover 0 = root hidden (still warm);
//  - ADS (the viewmodel's aimBlend): the eye moves toward the glass so the rim recedes and the lens clears a little; the rifle
//    optic sits in the clear middle of the visor and nothing of the mask is in front of it;
//  - filter tone: low = a faint amber glow along the lens rim, empty = a slow red pulse (the HUD Q cell stays the primary cue).

import * as THREE from 'three';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {mulberry32} from '../core/rng';
import {GAS_MASK_OUTFIT_MESH} from './models';
import type {MaskTone} from './gasMask';

/** Mask-view tuning (first pass; all in one place). Lengths are mask (outfit model) metres unless noted. */
export const MASK_VIEW = {
  /** The eye across the visor-glass box (fractions of its width / height from the wearer's right / bottom). */
  eyeFx: 0.48,
  eyeFy: 0.58,
  /** Eye distance behind the inner glass at its centre (mask metres; real goggles are closer, but then the rim leaves the 54 deg view). */
  eyeToGlass: 0.1,
  /** Uniform scale about the eye: the mask's nearest visible parts stay beyond the 1 cm near plane, its farthest in front of held items. */
  scale: 0.6,
  /** The cone (deg, about the eye's forward axis) that stays clear of rubber after the cut (the nose bridge peaks ~11 deg below). */
  clearConeDeg: 10,
  /** A non-body island needs this many triangles to count as visor glass (strap buckles / rivets never do). */
  glassMinTris: 60,
  /** Non-body islands reaching back to within this of the eye's depth (mask metres) are head-strap pieces: dropped. */
  strapReach: 0.03,
  /** ADS: at full aim the eye moves this far toward the glass (mask metres) and the lens opacity drops by `aimLensClear`. */
  aimForward: 0.024,
  aimLensClear: 0.45,
  /** Don / doff path at cover 0 (camera-space metres / radians): below, in front and tipped forward. */
  offY: -0.07,
  offZ: -0.035,
  tilt: 0.85,
  /** Shell vertex shade: `seal` near the face seal .. 1 at the visor; `tint` multiplies the outfit colour texture. */
  seal: 0.32,
  tint: 2.5,
  /** Lens texture (planar over the glass box) and its look. */
  lensTexW: 256,
  lensTexH: 128,
  lensSeed: 20261030,
  /** Base tint alpha in the middle, the rim band's extra alpha and its width (mask metres from the glass outline). */
  lensBase: 0.04,
  lensRim: 0.42,
  lensRimW: 0.011,
  /** Emissive warning glow width along the rim (mask metres) and intensities. */
  glowW: 0.0045,
  lowGlow: 0.2,
  emptyGlow: 0.35,
  emptyPulseHz: 0.9,
  /** Draw order: after the rifle optic lens (3). */
  lensRenderOrder: 6,
} as const;

/** Warning tints (linear RGB) of the lens rim glow. */
const LOW_RGB = new THREE.Color(0.95, 0.55, 0.08);
const EMPTY_RGB = new THREE.Color(1.0, 0.08, 0.04);

/** What the cut produced. Geometry is in the eye frame (viewmodel camera space at cover 1, before ADS): eye at 0, visor toward -Z. */
export interface MaskViewCut {
  /** The rubber shell (+ the cowl's triangles at the end of its index, from `cowlStart`). */
  shell: THREE.BufferGeometry;
  cowlStart: number;
  lens: THREE.BufferGeometry;
  /** Lens texture (sRGB RGBA) and the rim glow mask (linear) made from the lens outline. */
  lensMap: THREE.DataTexture;
  glowMap: THREE.DataTexture;
  /** The eye in the source (outfit model) space, and the inner glass depth at the centre. */
  eye: THREE.Vector3;
  glassZ: number;
  /** Islands removed as visor glass, their triangles; triangles kept in the shell (without the cowl); strap triangles dropped; lens triangles. */
  glassIslands: number;
  glassTriangles: number;
  shellTriangles: number;
  strapTriangles: number;
  lensTriangles: number;
  /** Mask-space -> eye-frame transform (QA / tests). */
  toEye: THREE.Matrix4;
}

// ---------------------------------------------------------------------------------------------------------------------
// geometry helpers

type Tri = [number, number, number];

/** Möller–Trumbore: distance along `d` (unit) from `o` to the triangle, or -1. */
function rayTri(o: THREE.Vector3, d: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3): number {
  const e1x = b.x - a.x, e1y = b.y - a.y, e1z = b.z - a.z, e2x = c.x - a.x, e2y = c.y - a.y, e2z = c.z - a.z;
  const px = d.y * e2z - d.z * e2y, py = d.z * e2x - d.x * e2z, pz = d.x * e2y - d.y * e2x;
  const det = e1x * px + e1y * py + e1z * pz;
  if (Math.abs(det) < 1e-12) return -1;
  const inv = 1 / det, tx = o.x - a.x, ty = o.y - a.y, tz = o.z - a.z;
  const u = (tx * px + ty * py + tz * pz) * inv;
  if (u < 0 || u > 1) return -1;
  const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
  const v = (d.x * qx + d.y * qy + d.z * qz) * inv;
  if (v < 0 || u + v > 1) return -1;
  const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
  return t > 1e-6 ? t : -1;
}

/** Unit directions in a cone of `deg` about `axis`: the axis, then rings (QA / tests use the same sampling). */
export function coneRays(axis: THREE.Vector3, deg: number, rings = 4, perRing = 24): THREE.Vector3[] {
  const a = axis.clone().normalize();
  const u = Math.abs(a.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const r = new THREE.Vector3().crossVectors(a, u).normalize(), up = new THREE.Vector3().crossVectors(r, a);
  const out = [a.clone()];
  for (let i = 1; i <= rings; i++) {
    const th = THREE.MathUtils.degToRad(deg) * i / rings;
    for (let j = 0; j < perRing; j++) {
      const ph = (j / perRing) * Math.PI * 2;
      out.push(a.clone().multiplyScalar(Math.cos(th)).addScaledVector(r, Math.sin(th) * Math.cos(ph)).addScaledVector(up, Math.sin(th) * Math.sin(ph)).normalize());
    }
  }
  return out;
}

/** Triangles of `geo` (indexed or not) crossed by any of `rays` from `o` (first hits only when `first`). */
export function trianglesOnRays(geo: THREE.BufferGeometry, o: THREE.Vector3, rays: THREE.Vector3[], first = true): Set<number> {
  const P = geo.attributes.position, I = geo.index, n = (I ? I.count : P.count) / 3;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const hit = new Set<number>();
  for (const d of rays) {
    let best = Infinity, bi = -1;
    for (let t = 0; t < n; t++) {
      a.fromBufferAttribute(P, I ? I.getX(t * 3) : t * 3); b.fromBufferAttribute(P, I ? I.getX(t * 3 + 1) : t * 3 + 1); c.fromBufferAttribute(P, I ? I.getX(t * 3 + 2) : t * 3 + 2);
      const h = rayTri(o, d, a, b, c);
      if (h < 0) continue;
      if (!first) hit.add(t); else if (h < best) { best = h; bi = t; }
    }
    if (first && bi >= 0) hit.add(bi);
  }
  return hit;
}

/** Island (welded-position connected component) id per triangle. */
function islands(geo: THREE.BufferGeometry): {of: Int32Array; count: number; size: number[]} {
  const P = geo.attributes.position, I = geo.index!;
  const parent = new Int32Array(P.count).map((_, i) => i);
  const find = (i: number): number => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const join = (a: number, b: number) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[rb] = ra; };
  const weld = new Map<string, number>();
  for (let i = 0; i < P.count; i++) {
    const k = `${Math.round(P.getX(i) * 1e5)},${Math.round(P.getY(i) * 1e5)},${Math.round(P.getZ(i) * 1e5)}`;
    const j = weld.get(k);
    if (j === undefined) weld.set(k, i); else join(j, i);
  }
  const tris = I.count / 3;
  for (let t = 0; t < tris; t++) { join(I.getX(t * 3), I.getX(t * 3 + 1)); join(I.getX(t * 3), I.getX(t * 3 + 2)); }
  const ids = new Map<number, number>(), of = new Int32Array(tris), size: number[] = [];
  for (let t = 0; t < tris; t++) {
    const r = find(I.getX(t * 3));
    let id = ids.get(r);
    if (id === undefined) { id = ids.size; ids.set(r, id); size.push(0); }
    of[t] = id;
    size[id]++;
  }
  return {of, count: ids.size, size};
}

/** A compact copy of the listed triangles (only the vertices they use). */
function subset(geo: THREE.BufferGeometry, tris: Tri[], attrs: string[]): THREE.BufferGeometry {
  const remap = new Map<number, number>(), order: number[] = [], index: number[] = [];
  for (const t of tris) for (const v of t) {
    let k = remap.get(v);
    if (k === undefined) { k = order.length; remap.set(v, k); order.push(v); }
    index.push(k);
  }
  const out = new THREE.BufferGeometry();
  for (const name of attrs) {
    const a = geo.getAttribute(name) as THREE.BufferAttribute | undefined;
    if (!a) continue;
    const arr = new Float32Array(order.length * a.itemSize);
    for (let i = 0; i < order.length; i++) for (let k = 0; k < a.itemSize; k++) arr[i * a.itemSize + k] = a.getComponent(order[i], k);
    out.setAttribute(name, new THREE.BufferAttribute(arr, a.itemSize));
  }
  out.setIndex(index);
  return out;
}

const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// ---------------------------------------------------------------------------------------------------------------------
// the cut

/** The static, bind-pose copy of the outfit's lastshift mask (outfit model space; skin attributes dropped). */
export function bakedMaskGeometry(gltf: Pick<GLTF, 'scene'>): THREE.BufferGeometry {
  gltf.scene.updateMatrixWorld(true);
  let src: THREE.Mesh | null = null;
  gltf.scene.traverse(o => { if (!src && (o as THREE.Mesh).isMesh && o.name === GAS_MASK_OUTFIT_MESH) src = o as THREE.Mesh; });
  const mesh = src as THREE.Mesh | null;
  if (!mesh) throw new Error(`${GAS_MASK_OUTFIT_MESH} not in the outfit file`);
  const geo = mesh.geometry.clone();
  for (const a of ['skinIndex', 'skinWeight']) if (geo.getAttribute(a)) geo.deleteAttribute(a);
  geo.applyMatrix4(mesh.matrixWorld);
  if (!geo.index) geo.setIndex([...Array(geo.attributes.position.count).keys()]);
  if (!geo.getAttribute('normal')) geo.computeVertexNormals();
  return geo;
}

/** Cut the visor glass out of the baked mask and build the shell / lens of the first-person view (see the module header). */
export function cutMaskView(geo: THREE.BufferGeometry): MaskViewCut {
  const P = geo.attributes.position, I = geo.index!;
  const tris = I.count / 3;
  const isl = islands(geo);
  const body = isl.size.indexOf(Math.max(...isl.size));
  // eye guess from the body's box: centred, ~2/3 up, at the face seal; the glass sheets lie straight ahead of it
  const bodyBox = new THREE.Box3(), v = new THREE.Vector3();
  for (let t = 0; t < tris; t++) if (isl.of[t] === body) for (let k = 0; k < 3; k++) bodyBox.expandByPoint(v.fromBufferAttribute(P, I.getX(t * 3 + k)));
  const guess = new THREE.Vector3((bodyBox.min.x + bodyBox.max.x) / 2, bodyBox.min.y + 0.68 * (bodyBox.max.y - bodyBox.min.y), bodyBox.min.z);
  const fwd = new THREE.Vector3(0, 0, 1);
  const crossed = trianglesOnRays(geo, guess, coneRays(fwd, MASK_VIEW.clearConeDeg * 0.7, 2, 12), false);
  const glass = new Set<number>();
  for (const t of crossed) if (isl.of[t] !== body && isl.size[isl.of[t]] >= MASK_VIEW.glassMinTris) glass.add(isl.of[t]);
  if (!glass.size) throw new Error('no visor glass in front of the eye');
  // the glass box -> the eye; the inner (nearest) sheet -> the lens
  const glassBox = new THREE.Box3(), mean = new Map<number, {d: number; n: number}>();
  const shellTris: Tri[] = [], glassTris = new Map<number, Tri[]>(), islandOfTri = new Map<Tri, number>();
  for (let t = 0; t < tris; t++) {
    const tri: Tri = [I.getX(t * 3), I.getX(t * 3 + 1), I.getX(t * 3 + 2)];
    islandOfTri.set(tri, t);
    if (!glass.has(isl.of[t])) { shellTris.push(tri); continue; }
    const list = glassTris.get(isl.of[t]) ?? [];
    list.push(tri);
    glassTris.set(isl.of[t], list);
    const m = mean.get(isl.of[t]) ?? {d: 0, n: 0};
    for (const i of tri) { v.fromBufferAttribute(P, i); glassBox.expandByPoint(v); m.d += v.distanceTo(guess); m.n++; }
    mean.set(isl.of[t], m);
  }
  const inner = [...mean.entries()].sort((a, b) => a[1].d / a[1].n - b[1].d / b[1].n)[0][0];
  const lensTris = glassTris.get(inner)!;
  const ex = glassBox.min.x + MASK_VIEW.eyeFx * (glassBox.max.x - glassBox.min.x);
  const ey = glassBox.min.y + MASK_VIEW.eyeFy * (glassBox.max.y - glassBox.min.y);
  // inner glass depth straight ahead of the eye
  const lensOnly = subset(geo, lensTris, ['position']);
  const probe = new THREE.Vector3(ex, ey, glassBox.min.z - 1);
  let glassZ = glassBox.min.z;
  {
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), LP = lensOnly.attributes.position, LI = lensOnly.index!;
    let best = Infinity;
    for (let t = 0; t < LI.count / 3; t++) {
      a.fromBufferAttribute(LP, LI.getX(t * 3)); b.fromBufferAttribute(LP, LI.getX(t * 3 + 1)); c.fromBufferAttribute(LP, LI.getX(t * 3 + 2));
      const h = rayTri(probe, fwd, a, b, c);
      if (h >= 0 && h < best) best = h;
    }
    if (best < Infinity) glassZ = probe.z + best;
  }
  lensOnly.dispose();
  const eye = new THREE.Vector3(ex, ey, glassZ - MASK_VIEW.eyeToGlass);
  const toEye = new THREE.Matrix4().makeScale(MASK_VIEW.scale, MASK_VIEW.scale, MASK_VIEW.scale)
    .multiply(new THREE.Matrix4().makeRotationY(Math.PI))
    .multiply(new THREE.Matrix4().makeTranslation(-eye.x, -eye.y, -eye.z));

  // --- shell: everything but the glass and the head-strap pieces, shaded dark at the seal .. lighter toward the visor. Strap
  // buckles / the crown strap are small islands reaching back past the face seal: never seen from inside a worn mask, and only
  // in the way while it comes up.
  const islandMinZ = new Float64Array(isl.count).fill(Infinity);
  for (let t = 0; t < tris; t++) for (let k = 0; k < 3; k++) islandMinZ[isl.of[t]] = Math.min(islandMinZ[isl.of[t]], P.getZ(I.getX(t * 3 + k)));
  const strap = (t: Tri) => { const id = isl.of[islandOfTri.get(t)!]; return id !== body && islandMinZ[id] < eye.z + MASK_VIEW.strapReach; };
  const kept = shellTris.filter(t => !strap(t));
  const strapTriangles = shellTris.length - kept.length;
  const shell = subset(geo, kept, ['position', 'normal', 'uv']);
  {
    const SP = shell.attributes.position, col = new Float32Array(SP.count * 3);
    const z0 = eye.z + 0.012, z1 = glassZ;
    for (let i = 0; i < SP.count; i++) {
      const k = MASK_VIEW.seal + (1 - MASK_VIEW.seal) * smooth(z0, z1, SP.getZ(i));
      col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = k;
    }
    shell.setAttribute('color', new THREE.BufferAttribute(col, 3));
  }
  // + the COWL: dark inward faces just outside the mask's outline (over the brow, beside the upper cheeks). With the eye behind the
  // face seal, steep rays at the top corners of a wide view pass over the mask's low upper edge; the cowl stands for the wearer's
  // own brow / hood in shadow there. It never reaches into the visor's view (it ends before the visor rays climb that high).
  const shellOnly = shell.index!.count;
  const withCowl = mergeGeometries([shell, cowlGeometry(shell, bodyBox, eye, glassZ)], false);
  shell.dispose();
  if (!withCowl) throw new Error('cowl merge failed');
  const full = withCowl;
  full.applyMatrix4(toEye);
  full.computeBoundingBox();
  full.computeBoundingSphere();
  const shellGeo = full;

  // --- lens: the inner glass sheet facing the eye, planar UVs over the glass box (u: screen left -> right, v: bottom -> top)
  const lens = subset(geo, lensTris, ['position', 'normal']);
  {
    const LP = lens.attributes.position, LN = lens.attributes.normal as THREE.BufferAttribute, LI = lens.index!;
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(), cen = new THREE.Vector3();
    const idx = Array.from(LI.array as ArrayLike<number>);
    for (let t = 0; t < idx.length / 3; t++) {
      a.fromBufferAttribute(LP, idx[t * 3]); b.fromBufferAttribute(LP, idx[t * 3 + 1]); c.fromBufferAttribute(LP, idx[t * 3 + 2]);
      n.subVectors(b, a).cross(c.clone().sub(a));
      cen.copy(a).add(b).add(c).divideScalar(3);
      if (n.dot(cen.sub(eye).negate()) < 0) { const s = idx[t * 3 + 1]; idx[t * 3 + 1] = idx[t * 3 + 2]; idx[t * 3 + 2] = s; } // face the eye
    }
    lens.setIndex(idx);
    for (let i = 0; i < LP.count; i++) { // vertex normals toward the eye side
      n.fromBufferAttribute(LN, i);
      a.fromBufferAttribute(LP, i);
      if (n.dot(a.sub(eye).negate()) < 0) LN.setXYZ(i, -n.x, -n.y, -n.z);
    }
    const uv = new Float32Array(LP.count * 2), w = glassBox.max.x - glassBox.min.x, h = glassBox.max.y - glassBox.min.y;
    for (let i = 0; i < LP.count; i++) { uv[i * 2] = (glassBox.max.x - LP.getX(i)) / w; uv[i * 2 + 1] = (LP.getY(i) - glassBox.min.y) / h; }
    lens.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  }
  const maps = lensMaps(lens, glassBox, eye);
  lens.applyMatrix4(toEye);
  lens.computeBoundingBox();
  lens.computeBoundingSphere();
  let glassTriangles = 0;
  for (const list of glassTris.values()) glassTriangles += list.length;
  return {
    shell: shellGeo, cowlStart: shellOnly, lens, lensMap: maps.map, glowMap: maps.glow, eye, glassZ, glassIslands: glass.size, glassTriangles,
    shellTriangles: kept.length, strapTriangles, lensTriangles: lensTris.length, toEye,
  };
}

/** The cowl (mask space, same attributes as the shell): a brow plane over the mask and two upper side walls, facing the eye. */
function cowlGeometry(shell: THREE.BufferGeometry, body: THREE.Box3, eye: THREE.Vector3, glassZ: number): THREE.BufferGeometry {
  // one rubber texel for all of it: the UV of the shell vertex nearest the eye (inside, by the seal)
  const SP = shell.attributes.position, SU = shell.attributes.uv;
  let best = Infinity, u = 0, w = 0;
  const v = new THREE.Vector3();
  for (let i = 0; i < SP.count; i++) { const d = v.fromBufferAttribute(SP, i).distanceToSquared(eye); if (d < best) { best = d; u = SU.getX(i); w = SU.getY(i); } }
  const z0 = eye.z - 0.03, top = body.max.y + 0.002, x0 = body.min.x - 0.05, x1 = body.max.x + 0.05;
  const quads: [THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3][] = [
    [new THREE.Vector3(x0, top, z0), new THREE.Vector3(x1, top, z0), new THREE.Vector3(x1, top, glassZ + 0.035), new THREE.Vector3(x0, top, glassZ + 0.035)], // brow
    [new THREE.Vector3(body.min.x - 0.002, body.min.y, z0), new THREE.Vector3(body.min.x - 0.002, top, z0), new THREE.Vector3(body.min.x - 0.002, top, glassZ - 0.012), new THREE.Vector3(body.min.x - 0.002, body.min.y, glassZ - 0.012)],
    [new THREE.Vector3(body.max.x + 0.002, body.min.y, z0), new THREE.Vector3(body.max.x + 0.002, top, z0), new THREE.Vector3(body.max.x + 0.002, top, glassZ - 0.012), new THREE.Vector3(body.max.x + 0.002, body.min.y, glassZ - 0.012)],
  ];
  const pos: number[] = [], nrm: number[] = [], uv: number[] = [], col: number[] = [], idx: number[] = [];
  const n = new THREE.Vector3(), c = new THREE.Vector3();
  for (const q of quads) {
    n.subVectors(q[1], q[0]).cross(new THREE.Vector3().subVectors(q[2], q[0])).normalize();
    c.copy(q[0]).add(q[2]).multiplyScalar(0.5);
    const facing = n.dot(new THREE.Vector3().subVectors(eye, c)) > 0;
    const base = pos.length / 3;
    for (const p of q) { pos.push(p.x, p.y, p.z); nrm.push(...(facing ? n : n.clone().negate()).toArray()); uv.push(u, w); col.push(0.12, 0.12, 0.12); }
    idx.push(...(facing ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2]).map(k => base + k));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}

/**
 * Lens texture + rim-glow mask from the lens sheet's own outline (mask space, planar over the glass box, before the eye
 * transform): each texel's distance to the sheet boundary (in the x / y plane) drives the rim band; condensation, smudges and
 * scratches are seeded, deterministic and kept out of the central aim area.
 */
function lensMaps(lens: THREE.BufferGeometry, box: THREE.Box3, eye: THREE.Vector3): {map: THREE.DataTexture; glow: THREE.DataTexture} {
  const W = MASK_VIEW.lensTexW, H = MASK_VIEW.lensTexH;
  const P = lens.attributes.position, I = lens.index!;
  const tris = I.count / 3;
  const bw = box.max.x - box.min.x, bh = box.max.y - box.min.y, aspect = bw / bh;
  // texel coordinates of a mask-space x / y (u: screen left -> right = mask +x -> -x; v: bottom -> top)
  const tu = (x: number) => (box.max.x - x) / bw * W - 0.5, tv = (y: number) => (y - box.min.y) / bh * H - 0.5;
  // coverage: the projected sheet, scan-converted once (row spans per triangle; the sheet has long sliver triangles)
  const cover = new Uint8Array(W * H);
  const qx = [0, 0, 0], qy = [0, 0, 0];
  for (let t = 0; t < tris; t++) {
    for (let k = 0; k < 3; k++) { const i = I.getX(t * 3 + k); qx[k] = tu(P.getX(i)); qy[k] = tv(P.getY(i)); }
    const y0 = Math.max(0, Math.ceil(Math.min(qy[0], qy[1], qy[2]))), y1 = Math.min(H - 1, Math.floor(Math.max(qy[0], qy[1], qy[2])));
    for (let y = y0; y <= y1; y++) {
      let lo = Infinity, hi = -Infinity;
      for (let k = 0; k < 3; k++) {
        const ax = qx[k], ay = qy[k], bx = qx[(k + 1) % 3], by = qy[(k + 1) % 3];
        if ((y < ay && y < by) || (y > ay && y > by)) continue;
        const x = ay === by ? Math.min(ax, bx) : ax + (bx - ax) * (y - ay) / (by - ay);
        const x2 = ay === by ? Math.max(ax, bx) : x;
        lo = Math.min(lo, x); hi = Math.max(hi, x2);
      }
      for (let x = Math.max(0, Math.ceil(lo - 1e-6)), xe = Math.min(W - 1, Math.floor(hi + 1e-6)); x <= xe; x++) cover[y * W + x] = 1;
    }
  }
  // the sheet's OUTLINE: edges used by one triangle, vertices welded by position (a UV seam inside the sheet is not an edge)
  const key = (i: number) => `${Math.round(P.getX(i) * 1e5)},${Math.round(P.getY(i) * 1e5)},${Math.round(P.getZ(i) * 1e5)}`;
  const count = new Map<string, {n: number; a: number; b: number}>();
  for (let t = 0; t < tris; t++) for (let k = 0; k < 3; k++) {
    const a = I.getX(t * 3 + k), b = I.getX(t * 3 + (k + 1) % 3), ka = key(a), kb = key(b);
    const e = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
    const c = count.get(e);
    if (c) c.n++; else count.set(e, {n: 1, a, b});
  }
  // distance (mask metres, in x / y) to the outline, splatted per edge within the band that matters (covered texels only)
  const dist = new Float32Array(W * H).fill(Infinity);
  const colX = new Float64Array(W), rowY = new Float64Array(H);
  for (let x = 0; x < W; x++) colX[x] = box.max.x - (x + 0.5) / W * bw;
  for (let y = 0; y < H; y++) rowY[y] = box.min.y + (y + 0.5) / H * bh;
  const reach = Math.max(MASK_VIEW.lensRimW, MASK_VIEW.glowW) * 1.2, rx = reach / bw * W + 1, ry = reach / bh * H + 1;
  for (const {n, a, b} of count.values()) {
    if (n !== 1) continue;
    const ax = P.getX(a), ay = P.getY(a), dx = P.getX(b) - ax, dy = P.getY(b) - ay, l2 = dx * dx + dy * dy || 1e-12;
    const ua = tu(ax), ub = tu(ax + dx), va = tv(ay), vb = tv(ay + dy);
    const x0 = Math.max(0, Math.floor(Math.min(ua, ub) - rx)), x1 = Math.min(W - 1, Math.ceil(Math.max(ua, ub) + rx));
    const y0 = Math.max(0, Math.floor(Math.min(va, vb) - ry)), y1 = Math.min(H - 1, Math.ceil(Math.max(va, vb) + ry));
    for (let y = y0; y <= y1; y++) {
      const py = rowY[y] - ay;
      for (let x = x0; x <= x1; x++) {
        const k = y * W + x;
        if (!cover[k]) continue;
        const px = colX[x] - ax;
        let t = (px * dx + py * dy) / l2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const ex = px - dx * t, ey = py - dy * t, d = Math.sqrt(ex * ex + ey * ey);
        if (d < dist[k]) dist[k] = d;
      }
    }
  }
  const rnd = mulberry32(MASK_VIEW.lensSeed);
  const blobs = Array.from({length: 9}, () => ({u: rnd(), v: 0.15 + rnd() * 0.75, r: 0.04 + rnd() * 0.07, a: 0.025 + rnd() * 0.035}));
  const scratches = Array.from({length: 6}, () => ({u: rnd(), v: rnd(), ang: rnd() * Math.PI, len: 0.08 + rnd() * 0.2, a: 0.05 + rnd() * 0.05}));
  const map = new Uint8Array(W * H * 4), glow = new Uint8Array(W * H * 4);
  const cu = (box.max.x - eye.x) / bw, cv = (eye.y - box.min.y) / bh; // the eye's straight-ahead point on the lens
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const u = (i + 0.5) / W, v = (j + 0.5) / H;
    // outside the sheet the rim values continue (texture filtering at the outline): distance 0 there
    const d = cover[j * W + i] ? dist[j * W + i] : 0;
    const rim = 1 - smooth(0, MASK_VIEW.lensRimW, d);
    const centre = Math.sqrt(((u - cu) * aspect) ** 2 + (v - cv) ** 2); // 0 at the aim point .. ~1 at the corners
    const keepClear = smooth(0.16, 0.42, centre);
    // breath condensation: low on the lens, strongest in the lower corners and either side of the nose bridge
    const fog = smooth(0.42, 0.0, v) * (0.35 + 0.65 * smooth(0.1, 0.45, Math.abs(u - 0.5))) * keepClear;
    let smudge = 0;
    for (const b of blobs) { const r = Math.sqrt(((u - b.u) * aspect) ** 2 + (v - b.v) ** 2) / b.r; if (r < 1) smudge += b.a * (1 - r * r) ** 2; }
    smudge *= keepClear;
    let scratch = 0;
    for (const s of scratches) {
      const dx = (u - s.u) * aspect, dy = v - s.v, along = dx * Math.cos(s.ang) + dy * Math.sin(s.ang), across = -dx * Math.sin(s.ang) + dy * Math.cos(s.ang);
      if (Math.abs(along) < s.len && Math.abs(across) < 0.004) scratch = Math.max(scratch, s.a * (1 - Math.abs(along) / s.len) * (1 - Math.abs(across) / 0.004));
    }
    scratch *= keepClear;
    const a = Math.min(0.85, MASK_VIEW.lensBase + MASK_VIEW.lensRim * rim + 0.16 * fog + smudge + scratch);
    // colour (sRGB): light grey-green glass / condensation, darkening into the rim band
    const light = (MASK_VIEW.lensBase * 0.6 + 0.16 * fog + smudge + scratch) / Math.max(1e-3, a);
    const k = Math.min(1, light) * (1 - 0.85 * rim);
    const o = (j * W + i) * 4;
    map[o] = Math.round(18 + 150 * k);
    map[o + 1] = Math.round(22 + 165 * k);
    map[o + 2] = Math.round(19 + 150 * k);
    map[o + 3] = Math.round(a * 255);
    const g = Math.round(255 * (1 - smooth(0, MASK_VIEW.glowW, d)));
    glow[o] = glow[o + 1] = glow[o + 2] = g;
    glow[o + 3] = 255;
  }
  const tex = (data: Uint8Array, srgb: boolean, name: string) => {
    const t = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.name = name;
    t.needsUpdate = true;
    return t;
  };
  return {map: tex(map, true, 'gas-mask-view-lens'), glow: tex(glow, false, 'gas-mask-view-lens-glow')};
}

/** Stand-in when the outfit mesh is missing or the cut fails: a flat rubber frame with a rounded visor and a nose dip. */
function proceduralCut(): MaskViewCut {
  const z = -0.045, hw = 0.05, hh = 0.03;
  const outline = (s: THREE.Path) => {
    s.moveTo(-hw + 0.012, hh);
    s.lineTo(hw - 0.012, hh); s.quadraticCurveTo(hw, hh, hw, hh - 0.012);
    s.lineTo(hw, -hh + 0.012); s.quadraticCurveTo(hw, -hh, hw - 0.014, -hh);
    s.lineTo(0.012, -hh); s.quadraticCurveTo(0, -hh + 0.012, -0.012, -hh);
    s.lineTo(-hw + 0.014, -hh); s.quadraticCurveTo(-hw, -hh, -hw, -hh + 0.012);
    s.lineTo(-hw, hh - 0.012); s.quadraticCurveTo(-hw, hh, -hw + 0.012, hh);
  };
  const frame = new THREE.Shape();
  frame.moveTo(-0.2, -0.15); frame.lineTo(0.2, -0.15); frame.lineTo(0.2, 0.15); frame.lineTo(-0.2, 0.15); frame.lineTo(-0.2, -0.15);
  const hole = new THREE.Path();
  outline(hole);
  frame.holes.push(hole);
  const shell = new THREE.ShapeGeometry(frame, 8).translate(0, 0, z);
  const n = shell.attributes.position.count;
  shell.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(MASK_VIEW.seal), 3));
  const vis = new THREE.Shape();
  outline(vis);
  const lens = new THREE.ShapeGeometry(vis, 8).translate(0, 0, z + 0.001);
  const LP = lens.attributes.position, uv = lens.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < LP.count; i++) uv.setXY(i, (LP.getX(i) + hw) / (2 * hw), (LP.getY(i) + hh) / (2 * hh));
  const box = new THREE.Box3(new THREE.Vector3(-hw, -hh, z), new THREE.Vector3(hw, hh, z));
  // lensMaps works in a +Z-facing mask space; this flat stand-in is already in the eye frame (mirror x for its u)
  const mirrored = lens.clone().scale(-1, 1, 1);
  const maps = lensMaps(mirrored, new THREE.Box3(new THREE.Vector3(-hw, -hh, z), new THREE.Vector3(hw, hh, z)), new THREE.Vector3(0, 0, 0));
  mirrored.dispose();
  for (const g of [shell, lens]) { g.computeBoundingBox(); g.computeBoundingSphere(); }
  return {
    shell, cowlStart: shell.index ? shell.index.count : Infinity, lens, lensMap: maps.map, glowMap: maps.glow, eye: new THREE.Vector3(), glassZ: box.min.z, glassIslands: 0, glassTriangles: 0,
    shellTriangles: shell.index ? shell.index.count / 3 : 0, strapTriangles: 0, lensTriangles: lens.index ? lens.index.count / 3 : 0, toEye: new THREE.Matrix4(),
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// runtime view

const easeOut = (c: number) => 1 - (1 - c) ** 3;

export class MaskView {
  /** Under the viewmodel camera (Viewmodel.addFaceRoot); hidden at cover 0. */
  readonly root = new THREE.Group();
  readonly shell: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  readonly lens: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  readonly cut: MaskViewCut;
  /** 'outfit' = the real mask derivative; 'procedural' = the stand-in (outfit mesh missing / cut failed). */
  readonly source: 'outfit' | 'procedural';
  /** Last applied cover (0..1), ADS blend and tone (QA / tests). */
  shown = 0;
  aim = 0;
  tone: MaskTone = 'ok';
  private clock = 0;

  constructor(outfit: Pick<GLTF, 'scene'> | null | undefined) {
    let cut: MaskViewCut | null = null, map: THREE.Texture | null = null;
    if (outfit) {
      try {
        const geo = bakedMaskGeometry(outfit);
        cut = cutMaskView(geo);
        geo.dispose();
        outfit.scene.traverse(o => {
          const m = o as THREE.Mesh;
          if (!map && m.isMesh && o.name === GAS_MASK_OUTFIT_MESH) map = ((Array.isArray(m.material) ? m.material[0] : m.material) as THREE.MeshStandardMaterial).map ?? null;
        });
      } catch (err) {
        console.warn('gas mask view: outfit mesh unusable, using the procedural stand-in', err);
        cut = null;
      }
    }
    this.source = cut ? 'outfit' : 'procedural';
    this.cut = cut ?? proceduralCut();
    // matte rubber: the outfit's colour texture (shared, not copied), no metal / roughness maps, double-sided (inner faces)
    const shellMat = new THREE.MeshStandardMaterial({map, color: new THREE.Color().setScalar(map ? MASK_VIEW.tint : 0.06), roughness: 0.82, metalness: 0, vertexColors: true, side: THREE.DoubleSide});
    shellMat.name = 'gas-mask-view-shell';
    const lensMat = new THREE.MeshStandardMaterial({
      map: this.cut.lensMap, emissiveMap: this.cut.glowMap, emissive: 0x000000, emissiveIntensity: 1, roughness: 0.28, metalness: 0,
      transparent: true, depthWrite: false, depthTest: true, side: THREE.FrontSide,
    });
    lensMat.name = 'gas-mask-view-lens';
    this.shell = new THREE.Mesh(this.cut.shell, shellMat);
    this.shell.name = 'gas-mask-view-shell';
    this.lens = new THREE.Mesh(this.cut.lens, lensMat);
    this.lens.name = 'gas-mask-view-lens';
    this.lens.renderOrder = MASK_VIEW.lensRenderOrder;
    for (const m of [this.shell, this.lens]) { m.castShadow = false; m.receiveShadow = false; m.frustumCulled = false; m.raycast = () => {}; }
    this.root.name = 'gas-mask-view';
    this.root.add(this.shell, this.lens);
    this.root.visible = false;
  }

  /** GasMaskSystem.present(): the mask's cover (0 off .. 1 on) and the lens-rim tone; applies the pose at once. */
  set(cover: number, tone: MaskTone): void {
    this.shown = Math.max(0, Math.min(1, cover));
    this.tone = tone;
    this.apply();
  }

  /** Per frame while playing: the ADS blend (viewmodel aimBlend 0..1) and the clock of the empty-filter pulse. */
  update(dt: number, aim: number): void {
    this.clock += Math.max(0, dt);
    this.aim = Math.max(0, Math.min(1, aim));
    this.apply();
  }

  private apply(): void {
    const c = this.shown;
    this.root.visible = c > 0.001;
    if (!this.root.visible) return;
    // the cowl only belongs to the mask sitting on the face (while it moves, the world shows around it)
    this.shell.geometry.setDrawRange(0, c >= 0.999 ? Infinity : this.cut.cowlStart);
    const e = easeOut(c), off = 1 - e, k = this.aim;
    this.root.position.set(0, MASK_VIEW.offY * off, MASK_VIEW.offZ * off + MASK_VIEW.aimForward * MASK_VIEW.scale * k);
    this.root.rotation.set(MASK_VIEW.tilt * off, 0, 0);
    const lm = this.lens.material;
    lm.opacity = 1 - MASK_VIEW.aimLensClear * k;
    if (this.tone === 'low') { lm.emissive.copy(LOW_RGB); lm.emissiveIntensity = MASK_VIEW.lowGlow; }
    else if (this.tone === 'empty') { lm.emissive.copy(EMPTY_RGB); lm.emissiveIntensity = MASK_VIEW.emptyGlow * (0.55 + 0.45 * Math.cos(this.clock * Math.PI * 2 * MASK_VIEW.emptyPulseHz)); }
    else { lm.emissive.setRGB(0, 0, 0); lm.emissiveIntensity = 1; }
  }

  /** QA: a compact report. */
  qa(): {source: string; shown: number; visible: boolean; aim: number; tone: MaskTone; shellTriangles: number; lensTriangles: number; glassTriangles: number} {
    return {source: this.source, shown: +this.shown.toFixed(3), visible: this.root.visible, aim: +this.aim.toFixed(3), tone: this.tone, shellTriangles: this.cut.shellTriangles, lensTriangles: this.cut.lensTriangles, glassTriangles: this.cut.glassTriangles};
  }
}
