// Task studio-market-rework-20261108-074144-01 (lane TRADE): THE RAIL TIES MODEL (items/railTies.ts) — the world drop / pickup / icon of the
// market's currency, CODE-BUILT and DETERMINISTIC from the existing track sleeper (no generation of any kind):
//  - the sleeper: TRACK_SLEEPER (the station builder's instanced `sleeperGeo`, world/builder.ts, reads it: 0.24 x 0.14 x 2.5 m);
//  - its surface: the 'sleeper' material's own creosoted timber set (canvasTextures surface('timberTie'): the same maps, the same 1 x 0.5 m
//    span) — but mapped on the model's OWN UVs in metres (a pickup moves; the station's world-mapped variant would swim on it), the grain
//    along each offcut; the straps use the rail's surface set (surface('railSteel')) the same way.
// The bundle: FOUR tie offcuts stacked 2 x 2 — each the sleeper's section halved both ways and a seventh of its length (so the strapped
// bundle's section is exactly one sleeper's), a hair apart and a little out of line like a hand-stacked bundle (fixed offsets, no RNG) —
// held by two steel straps, and four old spike heads still in the top pair. Lying along X (origin bottom-centre, front +Z, metres; the
// bounds are ITEM_DIMS.rail_ties: tests). Geometry / materials are shared (cached once; templates flag them `userData.shared`).
import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {surface} from './canvasTextures';

/** The track sleeper (m): section w (along the rails) x h, length across the track. The builder's instanced sleepers use exactly this. */
export const TRACK_SLEEPER = {w: 0.24, h: 0.14, len: 2.5} as const;

/** The bundle's dimensions, derived from the sleeper (m). */
export const RAIL_TIES_BUNDLE = {
  /** One offcut: the sleeper's section halved both ways (less the gap), a seventh of its length. */
  pieceW: TRACK_SLEEPER.w / 2 - 0.002, pieceH: TRACK_SLEEPER.h / 2 - 0.002, len: Math.round((TRACK_SLEEPER.len / 7) * 1000) / 1000 - 0.012,
  /** Gap between neighbouring offcuts. */
  gap: 0.004,
  /** Each offcut's offset along its length (hand-stacked: bottom back, bottom front, top back, top front). */
  shift: [-0.006, 0.005, 0.004, -0.004] as const,
  /** Steel strap: width along X, thickness, centre x of each. */
  strap: {w: 0.024, t: 0.003, x: [-0.105, 0.105] as const},
  /** Spike heads in the top pair: size, height above the timber, x of each pair. */
  spike: {s: 0.014, h: 0.006, x: [-0.05, 0.05] as const},
} as const;

/** Model source line (QA / itemModelSources). */
export const RAIL_TIES_MODEL_SOURCE = 'code-built from the track sleeper (world/railTiesModel.ts)';

let geoCache: Record<string, THREE.BufferGeometry> = {};
let matCache: Record<string, THREE.Material> = {};

/**
 * A box w x h x d (bottom at y0, centred on x / z) whose UVs are METRES / `span` per face (BoxGeometry faces: +-x, +-y, +-z with u along
 * z / x / x and v along y / z / y): a shared tiling surface keeps its real scale on every face, the grain (u) along X on the long faces.
 */
function meterBox(w: number, h: number, d: number, x: number, y0: number, z: number, span: readonly [number, number]): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  const faces: [number, number][] = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  faces.forEach(([fu, fv], f) => { for (let k = 0; k < 4; k++) { const i = f * 4 + k; uv.setXY(i, uv.getX(i) * fu / span[0], uv.getY(i) * fv / span[1]); } });
  uv.needsUpdate = true;
  return g.translate(x, y0 + h / 2, z);
}

function merged(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const g = mergeGeometries(parts.map(p => (p.index ? p.toNonIndexed() : p)), false);
  for (const p of parts) p.dispose();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/** The offcuts' bottom (on top of the bottom straps) and the bundle's section edges. */
const B = RAIL_TIES_BUNDLE, Y0 = B.strap.t, D = 2 * B.pieceW + B.gap, H = 2 * B.pieceH + B.gap;

/** The four offcuts (one merged geometry; timber UVs). */
function timberGeometry(): THREE.BufferGeometry {
  return geoCache.timber ??= (() => {
    const span = surface('timberTie').span, parts: THREE.BufferGeometry[] = [];
    let k = 0;
    for (let row = 0; row < 2; row++) for (let col = 0; col < 2; col++) {
      const z = (col === 0 ? -1 : 1) * (B.pieceW + B.gap) / 2, y0 = Y0 + row * (B.pieceH + B.gap);
      parts.push(meterBox(B.len, B.pieceH, B.pieceW, B.shift[k++], y0, z, span));
    }
    return merged(parts);
  })();
}

/** The two straps (each: under, over, in front of and behind the bundle) and the spike heads (one merged geometry; rail-steel UVs). */
function steelGeometry(): THREE.BufferGeometry {
  return geoCache.steel ??= (() => {
    const span = surface('railSteel').span, t = B.strap.t, w = B.strap.w, parts: THREE.BufferGeometry[] = [];
    for (const x of B.strap.x) {
      parts.push(meterBox(w, t, D + 2 * t, x, 0, 0, span), meterBox(w, t, D + 2 * t, x, Y0 + H, 0, span)); // under / over
      parts.push(meterBox(w, H, t, x, Y0, D / 2 + t / 2, span), meterBox(w, H, t, x, Y0, -D / 2 - t / 2, span)); // front / back
    }
    const s = B.spike.s, top = Y0 + H;
    for (const x of B.spike.x) for (const col of [-1, 1]) parts.push(meterBox(s, B.spike.h, s, x + col * 0.012, top, col * (B.pieceW + B.gap) / 2, span));
    return merged(parts);
  })();
}

/** A standard material on a shared surface set's maps (mesh UVs). */
const surfaceStd = (key: 'timber' | 'steel', name: string, set: 'timberTie' | 'railSteel', metalness: number): THREE.Material => matCache[key] ??= (() => {
  const s = surface(set);
  return new THREE.MeshStandardMaterial({name, map: s.map, roughnessMap: s.roughnessMap, normalMap: s.normalMap, roughness: 1, metalness});
})();
const timberMat = () => surfaceStd('timber', 'rail-ties-timber', 'timberTie', 0);
const steelMat = () => surfaceStd('steel', 'rail-ties-strap', 'railSteel', 0.45);

/** A NEW group of the tie bundle (shared geometry / materials; the caller may clone it). */
export function railTiesModel(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'item-rail-ties';
  g.userData.authored = true;
  const timber = new THREE.Mesh(timberGeometry(), timberMat()), steel = new THREE.Mesh(steelGeometry(), steelMat());
  timber.name = 'rail-ties-offcuts';
  steel.name = 'rail-ties-straps';
  g.add(timber, steel);
  return g;
}

/** Tests / previews that swap the canvas implementation: drop the cached geometry / materials. */
export function resetRailTiesModel(): void {
  for (const x of Object.values(geoCache)) x.dispose();
  for (const x of Object.values(matCache)) x.dispose();
  geoCache = {};
  matCache = {};
}
