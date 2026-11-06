// Task studio-skyways-level-20261106-054448 (lane CAR2): the prize car's COCKPIT layout — where lane ASSET-D's two Meshy parts (Codex
// initial -> Meshy T2.5; their own PBR maps kept) sit in the car frame (world/skywaysCarSpec.ts: nose -Z, driver on the LEFT, y = 0 the
// ground), fitted from the measured car anchors (eye, wheelCentre, interior, cowl / header). Three-free and import-free at runtime (type
// imports only), so the private CPU QA renderer (tools/asset-pipeline/props/qa-skyways-car.mjs, node --experimental-strip-types) places
// the parts with this very function.
//
//  - the DASH (skyways-car-dash.glb: front +Z = the gauges / wheel side, so it faces the driver unrotated): scaled uniformly to the
//    cabin width (interior x0..x1; the hollow shell has no door cards, its skin is ±0.9 m out), then moved so its steering-wheel rim
//    (DASH_MODEL.ring, measured on the geometry) is centred on the eye's x at wheelCentre (y, z). Its top stays under the cowl -> header
//    sight line (the windscreen view is clear over it).
//  - two SEATS (skyways-car-seat.glb: front +Z = the sitting side, turned half round to face the dash), scaled to a sports bucket
//    (~0.6 x 0.95 m), the driver's under the eye (the eye CABIN.eyeOverCushion above the cushion, its headrest CABIN.headGap behind the
//    eye), the passenger's mirrored.
//  - FILLERS (plain untextured geometry in one dark material: no art, no bytes; ONE mesh, fillMesh): the hollow shell is one skin (no
//    firewall, floor tunnel or dash ends), so a FIREWALL closes the cabin at the dash's front right up under the shell's scuttle (its top
//    follows the measured shell, FIREWALL: the first-person view never looks into the engine bay), thin SHELVES carry the dash's top out
//    to the doors at its end height (no blocky faces: under them is the footwell), a TUNNEL takes the centre console down to the floor
//    (the Meshy console ends at its own floor, which sits above the car's), and RISERS stand the seats on the floor. Everything stays
//    inside the body shell (tests/skyways-car-cockpit.test.ts casts it against the cooked GLB). The material matches the dash top's dark
//    leather (FILL_COLOR: the median of its base map there).
import type {CarSpec} from './skywaysCarSpec';

/** The cockpit parts' runtime GLBs (literal paths: the CI packager resolves every 'assets/models/….glb' literal in the bundle). */
export const COCKPIT_URLS = {dash: 'assets/models/skyways-car-dash.glb', seat: 'assets/models/skyways-car-seat.glb'} as const;

/**
 * The dash model measured on the cooked GLB (model frame: metres, +Y up, front +Z, grounded, centred on x / z; w / h / d =
 * SKYWAYS_MESHY_PROPS.skyways_car_dash). ring = the steering wheel: its centre, the rim radius (tube centre; outer edge rimOuter) and the
 * unit normal of its plane (toward the driver, raked 23° back). console = the centre console's footprint on the model's floor (y < 0.08).
 * end = the dash's end profile at x = ±w/2: its z span, underside and top.
 */
export const DASH_MODEL = {
  w: 1.48, h: 0.7596, d: 1.0893,
  ring: {x: -0.312, y: 0.474, z: 0.284, r: 0.257, rimOuter: 0.305, nx: 0.036, ny: 0.394, nz: 0.918},
  console: {x0: -0.087, x1: 0.223, z0: 0.179, z1: 0.545},
  end: {z0: -0.545, z1: 0.21, y0: 0.124, y1: 0.6},
} as const;

/** The seat model (front +Z = the sitting side; w / h / d = SKYWAYS_MESHY_PROPS.skyways_car_seat): cushion top, headrest front (z). */
export const SEAT_MODEL = {w: 0.6933, h: 1.12, d: 0.7897, cushion: 0.23, headrestZ: -0.3} as const;

/**
 * Cabin numbers (car frame; measured on the cooked shell where noted):
 *  floorY: just over the shell's inner floor under the cabin (0.142 at the dash … 0.157 under the seats);
 *  sideX: how far out the shelves reach (the skin: ±0.85..0.93 between the floor and the belt line, ±0.846 at 0.95 m); shelf: their depth;
 *  seatScale / seatOut: a sports bucket ~0.59 x 0.95 m whose centres stand just outboard of the eyes;
 *  eyeOverCushion: the seated eye over the cushion (0.65..0.75 m); headGap: the eye in front of the headrest face.
 */
export const CABIN = {floorY: 0.16, sideX: 0.84, shelf: 0.025, seatScale: 0.85, seatOut: 0.03, eyeOverCushion: 0.72, headGap: 0.13} as const;

/**
 * The firewall's front face (z0) and its top along x (car frame, piecewise linear), measured on the cooked shell: 2..10 mm under the
 * shell's inner top (the scuttle / windscreen base) over the whole depth z0 .. -0.925, the ends lowered clear of the side walls. Its
 * back face is the dash's front (+1 cm). A re-cooked car must re-measure it (the cockpit test checks the gap against the GLB).
 */
export const FIREWALL = {
  z0: -1.03,
  top: [[-0.835, 0.945], [-0.805, 0.968], [-0.765, 0.989], [-0.55, 0.986], [-0.485, 0.982], [-0.47, 0.965], [-0.445, 0.959], [0.025, 0.954], [0.435, 0.953],
    [0.465, 0.962], [0.475, 0.977], [0.48, 0.989], [0.565, 0.985], [0.78, 0.985], [0.805, 0.968], [0.835, 0.945]],
} as const;

/** The fillers' colour (sRGB hex): the median of the dash's base map over its top-facing surface (0x2b2c2d). */
export const FILL_COLOR = 0x2b2c2d;

export interface CockpitBox { name: string; x0: number; x1: number; y0: number; y1: number; z0: number; z1: number }
/** A part's pose (car frame): the model's origin at (x, y, z), turned rotY about +Y, scaled uniformly. */
export interface CockpitPose { x: number; y: number; z: number; rotY: number; scale: number }

export interface CockpitLayout {
  dash: CockpitPose;
  /** [driver (left), passenger (right)] */
  seats: readonly [CockpitPose, CockpitPose];
  /** The steering wheel in the car frame: centre, rim radius (tube centre / outer edge), plane normal (toward the driver). */
  wheel: {x: number; y: number; z: number; r: number; rimOuter: number; nx: number; ny: number; nz: number};
  /** The cushion top under the eye (car frame y). */
  cushionY: number;
  /** The firewall (a prism along z from z0 to z1: floor y0 up to `top`) and the box fillers (shelves, tunnel, risers). */
  firewall: {z0: number; z1: number; y0: number; top: readonly (readonly [number, number])[]};
  fillers: readonly CockpitBox[];
}

/** Model point -> car frame for a pose (rotY 0 or PI: the parts only ever face +Z or -Z). */
export function posePoint(p: CockpitPose, mx: number, my: number, mz: number): {x: number; y: number; z: number} {
  const c = Math.cos(p.rotY), s = Math.sin(p.rotY);
  return {x: p.x + (mx * c + mz * s) * p.scale, y: p.y + my * p.scale, z: p.z + (-mx * s + mz * c) * p.scale};
}

/** The cockpit's layout for a car spec (pure: the runtime view and the QA renderer place the parts with it). */
export function cockpitLayout(spec: CarSpec): CockpitLayout {
  const I = spec.interior, E = spec.eye, W = spec.wheelCentre, D = DASH_MODEL, R = D.ring, C = CABIN;
  // the dash: the cabin width, its wheel rim centred on the eye's x at the measured wheel centre
  const k = (I.x1 - I.x0) / D.w;
  const dash: CockpitPose = {x: E.x - R.x * k, y: W.y - R.y * k, z: W.z - R.z * k, rotY: 0, scale: k};
  const wheel = {x: E.x, y: W.y, z: W.z, r: R.r * k, rimOuter: R.rimOuter * k, nx: R.nx, ny: R.ny, nz: R.nz};
  // the seats: turned to face the dash (-Z); the driver's cushion under the eye, its headrest just behind it
  const ks = C.seatScale, sx = Math.abs(E.x) + C.seatOut;
  const base = Math.max(C.floorY, E.y - C.eyeOverCushion - SEAT_MODEL.cushion * ks);
  const sz = E.z + C.headGap + SEAT_MODEL.headrestZ * ks; // (turned: model z -> -z; the headrest face lands at E.z + headGap)
  const seats = [{x: -sx, y: base, z: sz, rotY: Math.PI, scale: ks}, {x: sx, y: base, z: sz, rotY: Math.PI, scale: ks}] as const;
  // fillers
  const front = dash.z - (D.d / 2) * k, f: CockpitBox[] = [];
  const firewall = {z0: FIREWALL.z0, z1: front + 0.01, y0: C.floorY, top: FIREWALL.top};
  const endY1 = dash.y + D.end.y1 * k, endZ1 = dash.z + D.end.z1 * k;
  const left = dash.x - (D.w / 2) * k, right = dash.x + (D.w / 2) * k;
  if (left > -C.sideX + 0.02) f.push({name: 'shelf-left', x0: -C.sideX, x1: left + 0.02, y0: endY1 - C.shelf, y1: endY1, z0: front - 0.01, z1: endZ1});
  if (right < C.sideX - 0.02) f.push({name: 'shelf-right', x0: right - 0.02, x1: C.sideX, y0: endY1 - C.shelf, y1: endY1, z0: front - 0.01, z1: endZ1});
  if (dash.y > C.floorY + 0.01) {
    const a = posePoint(dash, D.console.x0, 0, D.console.z0), b = posePoint(dash, D.console.x1, 0, D.console.z1);
    f.push({name: 'tunnel', x0: a.x + 0.01, x1: b.x - 0.01, y0: C.floorY, y1: dash.y + 0.02, z0: a.z, z1: b.z - 0.01});
  }
  // (the seat's rails span model z -0.19..0.32: turned, car z s.z - 0.32 ks .. s.z + 0.19 ks)
  if (base > C.floorY + 0.01) for (const s of seats) f.push({name: s.x < 0 ? 'riser-left' : 'riser-right', x0: s.x - 0.2, x1: s.x + 0.2, y0: C.floorY, y1: base + 0.02, z0: s.z - 0.3 * ks, z1: s.z + 0.18 * ks});
  return {dash, seats, wheel, cushionY: base + SEAT_MODEL.cushion * ks, firewall, fillers: f};
}

/** The fillers as ONE triangle mesh (car frame; flat-shaded quads, outward normals, CCW from outside): the firewall prism + the boxes. */
export function fillMesh(lay: CockpitLayout): {P: Float32Array; N: Float32Array; I: Uint32Array} {
  const P: number[] = [], N: number[] = [], I: number[] = [];
  type V = readonly [number, number, number];
  const quad = (a: V, b: V, c: V, d: V) => { // (a, b, c, d counter-clockwise seen from outside)
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]], l = Math.hypot(n[0], n[1], n[2]) || 1;
    const i = P.length / 3;
    for (const p of [a, b, c, d]) { P.push(p[0], p[1], p[2]); N.push(n[0] / l, n[1] / l, n[2] / l); }
    I.push(i, i + 1, i + 2, i, i + 2, i + 3);
  };
  const F = lay.firewall, T = F.top;
  for (let i = 0; i + 1 < T.length; i++) {
    const [xa, ya] = T[i], [xb, yb] = T[i + 1];
    quad([xa, F.y0, F.z1], [xb, F.y0, F.z1], [xb, yb, F.z1], [xa, ya, F.z1]); // the face toward the driver (+Z)
    quad([xb, F.y0, F.z0], [xa, F.y0, F.z0], [xa, ya, F.z0], [xb, yb, F.z0]); // the engine-bay side (-Z)
    quad([xa, ya, F.z1], [xb, yb, F.z1], [xb, yb, F.z0], [xa, ya, F.z0]); // the top
  }
  const [xl, yl] = T[0], [xr, yr] = T[T.length - 1];
  quad([xl, F.y0, F.z0], [xl, F.y0, F.z1], [xl, yl, F.z1], [xl, yl, F.z0]);
  quad([xr, F.y0, F.z1], [xr, F.y0, F.z0], [xr, yr, F.z0], [xr, yr, F.z1]);
  for (const b of lay.fillers) {
    const {x0, x1, y0, y1, z0, z1} = b;
    quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]); // +Z
    quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]); // -Z
    quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]); // +X
    quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]); // -X
    quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]); // +Y
    quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]); // -Y
  }
  return {P: Float32Array.from(P), N: Float32Array.from(N), I: Uint32Array.from(I)};
}

/** The cowl -> header sight line's height at z (car frame; extended past the cowl): a dash top must stay under it. */
export function sightLineY(spec: CarSpec, z: number): number {
  const a = spec.cowl, b = spec.header;
  return a.y + ((z - a.z) * (b.y - a.y)) / (b.z - a.z);
}
