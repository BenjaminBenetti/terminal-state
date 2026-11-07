// Task skyways-vehicle-20261107 (lane VIS): the prize car's LAMPS — the two front lamp lenses on the body and the car's forward beam.
//
//  - LENSES: the headlamps are painted into the body's base map (two slim projector lamps at the front corners). The lens is the body's
//    OWN lamp triangles (lampTriangles: measured outlines in the front projection, every vertex inside, facing forward) drawn a second time
//    over the paint (sharing the body's vertex attributes: no new bytes; a polygon offset toward the viewer) with ONE shared material: a
//    clone of the body's material whose emissive map is the body's base map. Off (emissiveIntensity 0) it looks exactly like the painted
//    lamp; on, the lamp's own white LED strip / projector glow and its dark housing stays dark. The stand-in body (no model) gets two
//    plain lens boxes in a shared flat lens material. Built by world/skywaysCarModel.ts (cached per loaded GLB).
//  - BEAM: ONE wide unshadowed SpotLight (CAR_LAMPS.beam: between the lamps, just in front of the bumper — the cockpit is behind it and
//    never lit by it — aimed down the road ahead). Created once per SkywaysCar, added to the car's view group at a car world's build
//    (before the warm-up: the group is the 'skyways-car' warm pool), removed with the view at teardown; switching only changes its
//    intensity (0 = off), so the scene's light set (and every program) is the same on and off. A world without the car has no beam.
// The on / off state is the car's (SkywaysCar.lights: record v2).
import * as THREE from 'three';

type Poly = readonly (readonly [number, number])[];

/**
 * Measured on the cooked skyways-prize-car.glb (car frame: nose -Z, +X right, y up). right / left: each lamp's lens outline in the
 * front projection (x, y), on the painted housing (the grille it meets at |x| 0.5 stays out; 657 triangles, ~908 cm2, 0.4 % of their
 * base-map samples paint, 31 % the bright LED strip / projector: tests/skyways-car-lights.test.ts);
 * zMax / facing: the nose only, outward-facing triangles (vertex normal . -Z above facing). projector: the lamps' optical centres
 * (the right one; the left mirrored, z -2.043): surface z -2.041, normal (0.44, -0.05, -0.90). lens: emissive tint and the on
 * intensity. beam: the forward light (candela-scale like the train's head lamp; one wide cone for both lamps).
 */
export const CAR_LAMPS = {
  zMax: -1.8,
  facing: 0.3,
  right: [[0.527, 0.747], [0.858, 0.789], [0.866, 0.686], [0.7, 0.664], [0.613, 0.655], [0.547, 0.649], [0.527, 0.653]] as Poly,
  left: [[-0.527, 0.755], [-0.858, 0.797], [-0.864, 0.687], [-0.7, 0.668], [-0.613, 0.658], [-0.547, 0.655], [-0.527, 0.659]] as Poly,
  projector: {x: 0.75, y: 0.747, z: -2.041},
  lens: {color: 0xfff1d6, on: 5},
  beam: {color: 0xfff1d6, intensity: 320, distance: 30, angle: 0.6, penumbra: 0.55, decay: 1.4, at: {x: 0, y: 0.72, z: -2.47}, aim: {x: 0, y: -0.15, z: -14.5}},
} as const;

/** Point in polygon (even-odd). */
export function inPoly(x: number, y: number, poly: Poly): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** The body's lamp triangles (indices into its vertex arrays; deterministic): every vertex inside its side's outline, on the nose, facing forward. */
export function lampTriangles(P: ArrayLike<number>, N: ArrayLike<number>, I: ArrayLike<number> | null, o: {zMax: number; facing: number; right: Poly; left: Poly} = CAR_LAMPS): Uint32Array {
  const nt = Math.floor((I ? I.length : P.length / 3) / 3), out: number[] = [];
  const idx = (k: number): number => (I ? I[k] : k);
  for (let t = 0; t < nt; t++) {
    const a = idx(3 * t), b = idx(3 * t + 1), c = idx(3 * t + 2);
    if ((P[3 * a + 2] + P[3 * b + 2] + P[3 * c + 2]) / 3 > o.zMax) continue;
    const nx = N[3 * a] + N[3 * b] + N[3 * c], ny = N[3 * a + 1] + N[3 * b + 1] + N[3 * c + 1], nz = N[3 * a + 2] + N[3 * b + 2] + N[3 * c + 2];
    if (-nz / (Math.hypot(nx, ny, nz) || 1) < o.facing) continue;
    const poly = P[3 * a] + P[3 * b] + P[3 * c] > 0 ? o.right : o.left;
    if (inPoly(P[3 * a], P[3 * a + 1], poly) && inPoly(P[3 * b], P[3 * b + 1], poly) && inPoly(P[3 * c], P[3 * c + 1], poly)) out.push(a, b, c);
  }
  return Uint32Array.from(out);
}

/** The lens material over a body material: a clone (its maps shared, not copied) glowing through its own base map; dark until switched on. */
export function lensMaterialFrom(body: THREE.Material): THREE.MeshStandardMaterial {
  const src = body as THREE.MeshStandardMaterial;
  const m = (src.isMeshStandardMaterial ? src.clone() : new THREE.MeshStandardMaterial({color: 0xd8dce0, roughness: 0.2})) as THREE.MeshStandardMaterial;
  m.name = 'skyways-car-lamp-lens';
  m.side = THREE.FrontSide;
  m.emissive.set(CAR_LAMPS.lens.color);
  m.emissiveMap = m.map;
  m.emissiveIntensity = 0;
  m.polygonOffset = true; // (drawn over the body's own coplanar triangles)
  m.polygonOffsetFactor = -1;
  m.polygonOffsetUnits = -4;
  return m;
}

/** The car's forward beam (one per SkywaysCar: a stable light for every visit's programs). */
export interface CarBeam { light: THREE.SpotLight; target: THREE.Object3D }

export function createCarBeam(): CarBeam {
  const B = CAR_LAMPS.beam;
  const light = new THREE.SpotLight(B.color, 0, B.distance, B.angle, B.penumbra, B.decay);
  light.name = 'skyways-car-beam';
  light.castShadow = false;
  light.position.set(B.at.x, B.at.y, B.at.z);
  const target = new THREE.Object3D();
  target.name = 'skyways-car-beam-target';
  target.position.set(B.aim.x, B.aim.y, B.aim.z);
  light.target = target;
  return {light, target};
}

/** Puts the beam (light + its target) into a car's view group (car frame). */
export function attachCarBeam(b: CarBeam, group: THREE.Object3D): void {
  group.add(b.light, b.target);
}

/** On / off: the lens glow and the beam's intensity only (never a light added / removed, never a program change). */
export function setCarLamps(on: boolean, lens: THREE.MeshStandardMaterial | null, beam: CarBeam | null): void {
  if (lens) lens.emissiveIntensity = on ? CAR_LAMPS.lens.on : 0;
  if (beam) beam.light.intensity = on ? CAR_LAMPS.beam.intensity : 0;
}
