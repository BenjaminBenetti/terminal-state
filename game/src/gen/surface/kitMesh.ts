// Task studio-surface-run-opus-rebuild-20261116-020827-01 (lane KIT): the Surface Run kit's PROCEDURAL GEOMETRY — pure TypeScript triangle
// buffers (no three.js) per kind and material, shared by the runtime (world/surface/kit.ts: one BufferGeometry per material, instanced per
// kind) and the scale check (tools/asset-pipeline/props/scale-check.mjs renders exactly these triangles beside the zombie).
//
// Geometry only: every surface is one of the EXISTING approved material sets (world/shapeMaterials.ts shape keys, world/purposeTextures.ts
// paints, or a tinted existing surface set in world/surface/kit.ts KIT_MATERIALS) — no new static art. Rounded sandbags are tessellated
// superellipsoid "pillows" (not boxes), the jersey barrier is the New Jersey profile extruded, the fence's chain link is real diagonal wire.
// Prop frame: origin bottom centre, front +Z, metres; every kind stays inside its PropDef box (gen/surface/kinds.ts) except overhangs
// above head height (lamp / signal arms, sign blades), recorded in SURFACE_SCALE.

import type {PartMat} from '../purposeShapes';
import {SR_MAP_TABLE, SR_SIGN, srStreetSignStreets, type SurfaceDrawnKind} from './kinds';

/** Kit-own materials (tinted existing surface sets, world/surface/kit.ts KIT_MATERIALS) on top of the shape / purpose keys. */
export const KIT_OWN_MATS = ['bagTan', 'bagOlive', 'olive', 'lens', 'wire', 'galv'] as const;
export type KitOwnMat = (typeof KIT_OWN_MATS)[number];
export type KitMat = PartMat | KitOwnMat;
export const isKitOwnMat = (m: string): m is KitOwnMat => (KIT_OWN_MATS as readonly string[]).includes(m);
/** Flat stand-in colours of the kit-own materials (the scale check's rasteriser; the runtime tints are in world/surface/kit.ts). */
export const KIT_MAT_RGB: Readonly<Record<KitOwnMat, number>> = {bagTan: 0x9f8d66, bagOlive: 0x66684a, olive: 0x5a5f44, lens: 0x3a3632, wire: 0xb2b6b8, galv: 0x9ea3a6};

/** One material's triangles: positions / normals (xyz per vertex) and indices. */
export interface KitBuf { pos: number[]; nor: number[]; idx: number[] }
export type KitMesh = ReadonlyMap<KitMat, KitBuf>;

type V3 = [number, number, number];
/** Rotation (row-major 3 x 3) + translation. */
interface Xf { r: number[]; t: V3 }

const r6 = (v: number) => Math.round(v * 1e6) / 1e6;
/** Rotation about X, then Z, then Y (radians), then translation. */
function xf(t: V3, rx = 0, ry = 0, rz = 0): Xf {
  const cx = Math.cos(rx), sx = Math.sin(rx), cy = Math.cos(ry), sy = Math.sin(ry), cz = Math.cos(rz), sz = Math.sin(rz);
  const X = [1, 0, 0, 0, cx, -sx, 0, sx, cx], Z = [cz, -sz, 0, sz, cz, 0, 0, 0, 1], Y = [cy, 0, sy, 0, 1, 0, -sy, 0, cy];
  return {r: mul(Y, mul(Z, X)), t};
}
function mul(a: number[], b: number[]): number[] {
  const o = new Array<number>(9);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) o[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
  return o;
}
const rot = (r: number[], v: readonly number[]): V3 => [r[0] * v[0] + r[1] * v[1] + r[2] * v[2], r[3] * v[0] + r[4] * v[1] + r[5] * v[2], r[6] * v[0] + r[7] * v[1] + r[8] * v[2]];
/** A frame whose local +X runs from a to b (local Y / Z perpendicular). */
function along(a: V3, b: V3): {x: Xf; len: number} {
  const d: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], len = Math.hypot(...d);
  const u: V3 = [d[0] / len, d[1] / len, d[2] / len];
  const ref: V3 = Math.abs(u[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  let w: V3 = [u[1] * ref[2] - u[2] * ref[1], u[2] * ref[0] - u[0] * ref[2], u[0] * ref[1] - u[1] * ref[0]];
  const wl = Math.hypot(...w); w = [w[0] / wl, w[1] / wl, w[2] / wl];
  const v: V3 = [w[1] * u[2] - w[2] * u[1], w[2] * u[0] - w[0] * u[2], w[0] * u[1] - w[1] * u[0]];
  // columns u (local X), v (local Y), w (local Z)
  return {x: {r: [u[0], v[0], w[0], u[1], v[1], w[1], u[2], v[2], w[2]], t: a}, len};
}

/** Accumulates triangles per material. */
class MeshB {
  readonly out = new Map<KitMat, KitBuf>();
  private buf(m: KitMat): KitBuf { let b = this.out.get(m); if (!b) this.out.set(m, (b = {pos: [], nor: [], idx: []})); return b; }
  /** Raw local vertices / normals / triangles through `x`. */
  add(m: KitMat, x: Xf, pos: readonly V3[], nor: readonly V3[], tris: readonly number[]): void {
    const b = this.buf(m), base = b.pos.length / 3;
    for (let i = 0; i < pos.length; i++) {
      const p = rot(x.r, pos[i]), n = rot(x.r, nor[i]);
      b.pos.push(r6(p[0] + x.t[0]), r6(p[1] + x.t[1]), r6(p[2] + x.t[2]));
      b.nor.push(r6(n[0]), r6(n[1]), r6(n[2]));
    }
    for (const i of tris) b.idx.push(base + i);
  }
  /** Box (sizes s, centre at x's origin). `faces` false: the 4 sides only (along local X: wires). */
  box(m: KitMat, s: readonly number[], x: Xf, caps = true): void {
    const [hx, hy, hz] = [s[0] / 2, s[1] / 2, s[2] / 2], P: V3[] = [], N: V3[] = [], T: number[] = [];
    const face = (n: V3, c: V3[]) => { const k = P.length; P.push(...c); for (let i = 0; i < 4; i++) N.push(n); T.push(k, k + 1, k + 2, k, k + 2, k + 3); };
    face([0, 1, 0], [[-hx, hy, -hz], [-hx, hy, hz], [hx, hy, hz], [hx, hy, -hz]]);
    face([0, -1, 0], [[-hx, -hy, -hz], [hx, -hy, -hz], [hx, -hy, hz], [-hx, -hy, hz]]);
    face([0, 0, 1], [[-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz]]);
    face([0, 0, -1], [[hx, -hy, -hz], [-hx, -hy, -hz], [-hx, hy, -hz], [hx, hy, -hz]]);
    if (caps) {
      face([1, 0, 0], [[hx, -hy, hz], [hx, -hy, -hz], [hx, hy, -hz], [hx, hy, hz]]);
      face([-1, 0, 0], [[-hx, -hy, -hz], [-hx, -hy, hz], [-hx, hy, hz], [-hx, hy, -hz]]);
    }
    this.add(m, x, P, N, T);
  }
  /** Frustum along local +Y from 0 to h (radius r0 at the base, r1 at the top), `seg` sides, optional caps. */
  cyl(m: KitMat, r0: number, r1: number, h: number, x: Xf, seg = 12, caps: 0 | 1 | 2 | 3 = 3): void {
    const P: V3[] = [], N: V3[] = [], T: number[] = [], slope = (r0 - r1) / h, nl = Math.hypot(1, slope);
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
      P.push([c * r0, 0, s * r0], [c * r1, h, s * r1]);
      N.push([c / nl, slope / nl, s / nl], [c / nl, slope / nl, s / nl]);
    }
    for (let i = 0; i < seg; i++) { const k = i * 2; T.push(k, k + 1, k + 3, k, k + 3, k + 2); }
    const cap = (y: number, r: number, up: boolean) => {
      if (r <= 1e-5) return;
      const c0 = P.length;
      P.push([0, y, 0]); N.push([0, up ? 1 : -1, 0]);
      for (let i = 0; i <= seg; i++) { const a = (i / seg) * Math.PI * 2; P.push([Math.cos(a) * r, y, Math.sin(a) * r]); N.push([0, up ? 1 : -1, 0]); }
      for (let i = 0; i < seg; i++) up ? T.push(c0, c0 + 2 + i, c0 + 1 + i) : T.push(c0, c0 + 1 + i, c0 + 2 + i);
    };
    if (caps & 1) cap(0, r0, false);
    if (caps & 2) cap(h, r1, true);
    this.add(m, x, P, N, T);
  }
  /** Round tube from a to b. */
  tube(m: KitMat, a: V3, b: V3, r: number, seg = 8, caps: 0 | 3 = 0): void {
    const {x, len} = along(a, b);
    // the frustum runs along local +Y: turn it onto the segment's local +X (rotate local -90 deg about Z first)
    const zr = xf([0, 0, 0], 0, 0, -Math.PI / 2);
    this.cyl(m, r, r, len, {r: mul(x.r, zr.r), t: x.t}, seg, caps);
  }
  /** Thin square wire from a to b (4 sides, no caps). */
  wire(m: KitMat, a: V3, b: V3, t: number): void {
    const {x, len} = along(a, b);
    this.box(m, [len, t, t], {r: x.r, t: [x.t[0] + x.r[0] * len / 2, x.t[1] + x.r[3] * len / 2, x.t[2] + x.r[6] * len / 2]}, false);
  }
  /**
   * A filled bag: a superellipsoid "pillow" L (local X) x H x W (local Z), boxy in plan and rounded in section, its ends pinched
   * where the bag is folded / tied; smooth normals from the faces.
   */
  pillow(m: KitMat, L: number, H: number, W: number, x: Xf, su = 10, sv = 6): void {
    const P: V3[] = [], T: number[] = [], eh = 0.42, ev = 0.62;
    const sp = (c: number, e: number) => Math.sign(c) * Math.abs(c) ** e;
    for (let j = 0; j <= sv; j++) {
      const v = -Math.PI / 2 + (j / sv) * Math.PI, cv = Math.cos(v), svv = Math.sin(v);
      for (let i = 0; i < su; i++) {
        const u = (i / su) * Math.PI * 2;
        let px = sp(cv, eh) * sp(Math.cos(u), eh), py = sp(svv, ev), pz = sp(cv, eh) * sp(Math.sin(u), eh);
        const pinch = 1 - 0.28 * Math.abs(px) ** 6; // folded ends
        py *= pinch; pz *= pinch;
        if (py < 0) py *= 0.82; // settled flat-ish underside
        P.push([px * L / 2, py * H / 2, pz * W / 2]);
      }
    }
    for (let j = 0; j < sv; j++) for (let i = 0; i < su; i++) {
      const a = j * su + i, b = j * su + (i + 1) % su, c = (j + 1) * su + (i + 1) % su, d = (j + 1) * su + i;
      T.push(a, c, b, a, d, c);
    }
    this.add(m, x, P, smoothNormals(P, T), T);
  }
  /** A convex (z, y) profile, CLOCKWISE with z to the right and y up, extruded along local X from x0 to x1, with end caps. */
  extrudeX(m: KitMat, prof: readonly (readonly [number, number])[], x0: number, x1: number, x: Xf): void {
    const P: V3[] = [], N: V3[] = [], T: number[] = [], n = prof.length;
    for (let i = 0; i < n; i++) {
      const [za, ya] = prof[i], [zb, yb] = prof[(i + 1) % n];
      // outward normal of the edge a -> b: its left-hand normal in (z, y) (the polygon runs clockwise), = the quad's winding normal
      const ez = zb - za, ey = yb - ya, l = Math.hypot(ez, ey), nn: V3 = [0, ez / l, -ey / l];
      const k = P.length;
      P.push([x0, ya, za], [x1, ya, za], [x1, yb, zb], [x0, yb, zb]);
      N.push(nn, nn, nn, nn);
      T.push(k, k + 2, k + 1, k, k + 3, k + 2);
    }
    for (const [xe, s] of [[x0, -1], [x1, 1]] as const) {
      const k = P.length;
      for (const [z, y] of prof) { P.push([xe, y, z]); N.push([s, 0, 0]); }
      for (let i = 1; i + 1 < n; i++) s > 0 ? T.push(k, k + i, k + i + 1) : T.push(k, k + i + 1, k + i);
    }
    this.add(m, x, P, N, T);
  }
}

/** Area-weighted vertex normals of an indexed triangle list. */
function smoothNormals(P: readonly V3[], T: readonly number[]): V3[] {
  const N: V3[] = P.map(() => [0, 0, 0]);
  for (let i = 0; i < T.length; i += 3) {
    const a = P[T[i]], b = P[T[i + 1]], c = P[T[i + 2]];
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    for (const k of [T[i], T[i + 1], T[i + 2]]) { N[k][0] += n[0]; N[k][1] += n[1]; N[k][2] += n[2]; }
  }
  return N.map(n => { const l = Math.hypot(...n) || 1; return [n[0] / l, n[1] / l, n[2] / l] as V3; });
}

/** Deterministic hash in [0, 1). */
const hash = (i: number, k: number) => { let h = (i * 374761393 + k * 668265263) >>> 0; h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const at = (x: number, y: number, z: number, ry = 0, rx = 0, rz = 0) => xf([x, y, z], rx, ry, rz);

// ---------------------------------------------------------------------------------------------------------------------------
// The kinds

/** Sandbag wall 1.6 x 0.9 x 0.6: six staggered rows of two-deep bags, the courses stepping in 1.5 cm per row (a battered face). */
function sandbagWall(b: MeshB): void {
  const rows = 6, H = 0.16, pitch = 0.148, W = 0.29, half = 0.792; // (half: the end bags + their 1 cm jitter stay inside the 1.6 m box)
  let n = 0;
  for (let r = 0; r < rows; r++) {
    const y = 0.82 * H / 2 + r * pitch, inset = r * 0.012; // (the bottom course's flattened undersides on the ground)
    // whole bags 0.54 long; odd courses offset by half a bag with half-length end bags
    const xs: [number, number][] = r % 2 === 0 ? [[-0.53, 0.54], [0, 0.54], [0.53, 0.54]] : [[-0.665, 0.27], [-0.265, 0.54], [0.265, 0.54], [0.665, 0.27]];
    for (const zs of [-1, 1]) for (const [cx, L] of xs) {
      const j = hash(n++, r);
      const jit = (j - 0.5) * 0.02, len = Math.min(L * (0.97 + 0.03 * j), 2 * (half - Math.abs(cx + jit)));
      const z = zs * (W / 2 + 0.006 - inset * 0.5) - zs * inset * 0.5;
      const hb = H * (0.94 + 0.06 * hash(n, 7));
      b.pillow(j < 0.3 ? 'bagOlive' : 'bagTan', len, hb, W - inset * 0.6, at(cx + jit, y - 0.41 * (H - hb), z, (j - 0.5) * 0.08), 8, 5);
    }
  }
}

/** Jersey barrier: the New Jersey profile (0.6 base, 75 mm reveal, 55-degree then 84-degree faces, 0.15 top) extruded 2 m. */
function jerseyBarrier(b: MeshB): void {
  const half: [number, number][] = [[0.3, 0], [0.3, 0.075], [0.125, 0.33], [0.075, 0.81]];
  const prof: [number, number][] = [...half, ...half.slice().reverse().map(([z, y]) => [-z, y] as [number, number])];
  // `prof` runs up the +z face, over the top and down the -z face: counter-clockwise (z right, y up) — extrudeX takes it clockwise
  b.extrudeX('concrete', prof.slice().reverse(), -1, 1, at(0, 0, 0));
}

function trafficCone(b: MeshB): void {
  b.box('black', [0.36, 0.03, 0.36], at(0, 0.015, 0));
  const y0 = 0.03, H = 0.67, r0 = 0.135, r1 = 0.022, rAt = (y: number) => r0 + (r1 - r0) * ((y - y0) / H);
  b.cyl('paintOrange', r0, r1, H, at(0, y0, 0), 18, 2);
  for (const [a, c] of [[0.33, 0.43], [0.5, 0.56]] as const) b.cyl('paintWhite', rAt(a) + 0.002, rAt(c) + 0.002, c - a, at(0, a, 0), 18, 0);
}

function fireHydrant(b: MeshB): void {
  b.cyl('paintRed', 0.14, 0.14, 0.035, at(0, 0, 0), 14);
  b.cyl('paintRed', 0.105, 0.098, 0.52, at(0, 0.035, 0), 14);
  b.cyl('paintRed', 0.125, 0.125, 0.04, at(0, 0.53, 0), 14);
  b.cyl('paintRed', 0.115, 0.062, 0.13, at(0, 0.57, 0), 14, 0);
  b.cyl('paintRed', 0.062, 0.034, 0.04, at(0, 0.7, 0), 12, 0);
  b.cyl('steelDark', 0.026, 0.026, 0.05, at(0, 0.735, 0), 5); // pentagon operating nut
  for (const s of [-1, 1]) { // hose outlets with their caps (along X)
    b.cyl('paintRed', 0.04, 0.04, 0.085, at(s * 0.09, 0.43, 0, 0, 0, -s * Math.PI / 2), 12, 0);
    b.cyl('steelDark', 0.048, 0.048, 0.03, at(s * 0.17, 0.43, 0, 0, 0, -s * Math.PI / 2), 12);
  }
  b.cyl('paintRed', 0.06, 0.06, 0.06, at(0, 0.38, 0.09, 0, Math.PI / 2), 14, 0); // pumper nozzle (+Z)
  b.cyl('steelDark', 0.068, 0.068, 0.035, at(0, 0.38, 0.155, 0, Math.PI / 2), 14);
}

function streetLamp(b: MeshB): void {
  b.box('galv', [0.4, 0.04, 0.4], at(0, 0.02, 0));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.cyl('steelDark', 0.016, 0.016, 0.05, at(sx * 0.15, 0.04, sz * 0.15), 6, 2); // anchor nuts
  b.cyl('galv', 0.16, 0.11, 0.5, at(0, 0.04, 0), 8, 2);
  b.cyl('galv', 0.1, 0.062, 6.86, at(0, 0.54, 0), 12, 0);
  b.cyl('galv', 0.066, 0.05, 0.05, at(0, 7.4, 0), 12, 2);
  // the arm (+Z, rising), a brace, the cobra head with its dead lens
  b.tube('galv', [0, 7.2, 0], [0, 7.36, 1.75], 0.04, 8, 3);
  b.tube('galv', [0, 6.75, 0.05], [0, 7.26, 0.9], 0.022, 6);
  b.pillow('grille', 0.74, 0.16, 0.34, at(0, 7.38, 1.98, Math.PI / 2), 12, 6);
  b.box('lens', [0.24, 0.03, 0.5], at(0, 7.305, 2.0));
}

function trafficSignal(b: MeshB): void {
  b.box('galv', [0.5, 0.04, 0.5], at(0, 0.02, 0));
  b.cyl('galv', 0.19, 0.14, 0.45, at(0, 0.04, 0), 8, 2);
  b.cyl('galv', 0.13, 0.09, 4.96, at(0, 0.49, 0), 12, 0);
  b.cyl('galv', 0.095, 0.07, 0.05, at(0, 5.45, 0), 12, 2);
  b.tube('galv', [0, 5.25, 0], [0, 5.3, 1.65], 0.05, 8, 3); // mast arm over the carriageway (+Z)
  // a three-lens head facing +X: housing, backplate, lenses with their hoods
  const head = (hx: number, top: number, hz: number) => {
    b.box('black', [0.25, 0.95, 0.33], at(hx, top - 0.475, hz));
    b.box('black', [0.02, 1.12, 0.52], at(hx - 0.135, top - 0.475, hz));
    for (let i = 0; i < 3; i++) {
      const y = top - 0.17 - i * 0.305;
      b.cyl('lens', 0.1, 0.1, 0.016, at(hx + 0.125, y, hz, 0, 0, -Math.PI / 2), 14, 2);
      b.box('black', [0.13, 0.012, 0.25], at(hx + 0.19, y + 0.12, hz));
    }
  };
  head(0, 5.22, 1.55);
  b.box('black', [0.08, 0.06, 0.06], at(0, 5.24, 1.55)); // hanger
  head(0.27, 3.6, 0);
  b.box('galv', [0.16, 0.08, 0.08], at(0.12, 3.3, 0)); // pole bracket
}

function streetSign(b: MeshB, blades: 1 | 2): void {
  const {h, poleR, bladeL, bladeH, bladeT, bladeAY, bladeBY} = SR_SIGN;
  b.cyl('galv', 0.05, 0.05, 0.15, at(0, 0, 0), 10, 2);
  b.cyl('galv', poleR, poleR, h - 0.03, at(0, 0, 0), 10, 0);
  b.cyl('galv', poleR + 0.006, poleR + 0.006, 0.03, at(0, h - 0.03, 0), 10, 2);
  b.box('paintGreen', [bladeL, bladeH, bladeT], at(0, bladeAY, poleR + bladeT / 2 + 0.004));
  b.box('galv', [0.05, bladeH + 0.02, 0.01], at(0, bladeAY, poleR + 0.002));
  if (blades === 2) {
    b.box('paintGreen', [bladeT, bladeH, bladeL], at(poleR + bladeT / 2 + 0.004, bladeBY, 0));
    b.box('galv', [0.01, bladeH + 0.02, 0.05], at(poleR + 0.002, bladeBY, 0));
  }
}
/** Where the blades' text faces are (prop frame): blade A on +-Z of its plate, blade B on +-X (world/surface/kit.ts draws them). */
export function srStreetSignFaces(variant: number): {blade: 'a' | 'b'; c: V3; normal: 'z' | 'x'}[] {
  const {poleR, bladeT, bladeAY, bladeBY} = SR_SIGN, off = poleR + bladeT / 2 + 0.004;
  const {b} = srStreetSignStreets(variant);
  return [{blade: 'a', c: [0, bladeAY, off], normal: 'z'}, ...(b >= 0 ? [{blade: 'b' as const, c: [off, bladeBY, 0] as V3, normal: 'x' as const}] : [])];
}

/** Temporary chain-link fence panel 3.0 x 2.2: two concrete feet, a galvanised tube frame, diagonal chain-link wire. */
function chainFence(b: MeshB): void {
  for (const s of [-1, 1]) b.box('concrete', [0.6, 0.13, 0.2], at(s * 1.2, 0.065, 0));
  const px = 1.45, y0 = 0.16, y1 = 2.18;
  for (const s of [-1, 1]) b.tube('galv', [s * px, 0.05, 0], [s * px, 2.2, 0], 0.019, 8, 3);
  for (const y of [y0, y1]) b.tube('galv', [-px, y, 0], [px, y, 0], 0.016, 8);
  b.tube('galv', [-px, 1.15, 0], [px, 1.15, 0], 0.012, 6);
  // diamond mesh: lines x - y = c and x + y = c, 0.1 m apart along X, clipped to the frame's inside
  const X0 = -px + 0.02, X1 = px - 0.02, Y0 = y0 + 0.01, Y1 = y1 - 0.01, s = 0.1, t = 0.005;
  for (const dir of [1, -1]) {
    for (let c = (dir > 0 ? X0 - Y1 : X0 + Y0) + s / 2; c < (dir > 0 ? X1 - Y0 : X1 + Y1); c += s) {
      // points on x = c + dir * y inside the rectangle
      let ya = Y0, yb = Y1;
      const xAt = (y: number) => c + dir * y;
      const yFor = (xv: number) => (xv - c) * dir;
      const lo = Math.min(yFor(X0), yFor(X1)), hi = Math.max(yFor(X0), yFor(X1));
      ya = Math.max(ya, lo); yb = Math.min(yb, hi);
      if (yb - ya < 0.02) continue;
      b.wire('wire', [xAt(ya), ya, 0], [xAt(yb), yb, 0], t);
    }
  }
}

function bollard(b: MeshB): void {
  b.cyl('paintYellow', 0.11, 0.11, 0.95, at(0, 0, 0), 14, 0);
  b.cyl('paintYellow', 0.11, 0.05, 0.05, at(0, 0.95, 0), 14, 2);
  b.cyl('paintWhite', 0.113, 0.113, 0.06, at(0, 0.78, 0), 14, 0);
}

/** Planning table: a 28 mm plywood top on two welded steel A-trestles with an olive steel apron and a stretcher; bare top for the map. */
function mapTable(b: MeshB): void {
  const {w, d, h, topT} = SR_MAP_TABLE;
  b.box('wood', [w, topT, d], at(0, h - topT / 2, 0));
  const ay = h - topT - 0.03;
  for (const s of [-1, 1]) b.box('olive', [w - 0.04, 0.06, 0.03], at(0, ay, s * (d / 2 - 0.035)));
  for (const s of [-1, 1]) b.box('olive', [0.03, 0.06, d - 0.1], at(s * (w / 2 - 0.035), ay, 0));
  for (const tx of [-0.72, 0.72]) {
    b.box('olive', [0.06, 0.05, d - 0.12], at(tx, h - topT - 0.085, 0)); // top cross bar
    b.box('olive', [0.06, 0.035, d - 0.06], at(tx, 0.0175, 0)); // foot bar
    for (const sz of [-1, 1]) b.wire('olive', [tx, 0.03, sz * 0.5], [tx, h - topT - 0.1, sz * 0.4], 0.045);
    b.wire('olive', [tx, 0.15, -0.47], [tx, h - topT - 0.12, 0.38], 0.03); // diagonal brace
  }
  b.box('olive', [1.44, 0.04, 0.04], at(0, 0.32, 0)); // stretcher
}

/** Field radio set: an olive case on rubber feet, a black front panel with knobs and a dial, top handles, the stowed whip, the handset. */
function fieldRadio(b: MeshB): void {
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box('black', [0.04, 0.012, 0.04], at(sx * 0.16, 0.006, sz * 0.1));
  b.box('olive', [0.38, 0.24, 0.25], at(0, 0.132, 0));
  b.box('black', [0.34, 0.19, 0.008], at(0, 0.135, 0.129));
  b.box('lens', [0.12, 0.05, 0.004], at(-0.07, 0.19, 0.135));
  for (const [x, y, r] of [[0.06, 0.19, 0.02], [0.12, 0.19, 0.016], [-0.1, 0.09, 0.018], [0, 0.09, 0.018], [0.1, 0.09, 0.024]] as const) b.cyl('black', r, r * 0.9, 0.016, at(x, y, 0.133, 0, Math.PI / 2), 10, 2);
  for (const sx of [-1, 1]) { // carrying handles
    b.box('black', [0.025, 0.03, 0.025], at(sx * 0.13, 0.267, -0.08));
    b.box('black', [0.025, 0.03, 0.025], at(sx * 0.13, 0.267, 0.08));
    b.box('black', [0.025, 0.02, 0.185], at(sx * 0.13, 0.29, 0));
  }
  b.tube('black', [-0.17, 0.262, -0.115], [0.17, 0.262, -0.115], 0.006, 6, 3); // stowed whip antenna
  b.box('black', [0.034, 0.17, 0.055], at(-0.207, 0.15, 0.02)); // handset in its side clip
}

/** Folding camp cot 1.9 x 0.7: olive canvas on aluminium side rails and end bars, three U-leg frames with floor bars, rubber caps. */
function cot(b: MeshB): void {
  const bed = 0.43, hx = 0.94, hz = 0.33;
  b.box('vinyl', [1.84, 0.012, 0.62], at(0, bed - 0.004, 0));
  for (const s of [-1, 1]) b.tube('galv', [-hx, bed, s * hz], [hx, bed, s * hz], 0.017, 8, 3);
  for (const s of [-1, 1]) b.tube('galv', [s * (hx - 0.02), bed - 0.01, -hz], [s * (hx - 0.02), bed - 0.01, hz], 0.014, 8);
  for (const lx of [-0.78, 0, 0.78]) {
    for (const s of [-1, 1]) b.tube('galv', [lx, 0.02, s * 0.31], [lx, bed - 0.015, s * (hz - 0.005)], 0.012, 6);
    b.tube('galv', [lx, 0.016, -0.31], [lx, 0.016, 0.31], 0.012, 6);
    for (const s of [-1, 1]) b.box('black', [0.04, 0.03, 0.05], at(lx, 0.015, s * 0.32));
  }
}

// ---------------------------------------------------------------------------------------------------------------------------

const BUILD: Readonly<Record<SurfaceDrawnKind, (b: MeshB, variant: number) => void>> = {
  srSandbagWall: sandbagWall, srJerseyBarrier: jerseyBarrier, srTrafficCone: trafficCone, srFireHydrant: fireHydrant, srStreetLamp: streetLamp,
  srTrafficSignal: trafficSignal, srStreetSign: (b, v) => streetSign(b, srStreetSignStreets(v).b >= 0 ? 2 : 1), srChainFence: chainFence, srBollard: bollard,
  srMapTable: mapTable, srFieldRadio: fieldRadio, srCot: cot,
};

/** The geometry batch a placement variant draws with (only the street sign has two: one or two blades). */
export function surfaceKitVariantKey(kind: SurfaceDrawnKind, variant: number): string {
  return kind === 'srStreetSign' ? (srStreetSignStreets(variant).b >= 0 ? 'b2' : 'b1') : 'v0';
}

const cache = new Map<string, KitMesh>();
/** The kind's triangles per material for a placement variant (cached per variant key). */
export function surfaceKitMesh(kind: SurfaceDrawnKind, variant = 0): KitMesh {
  const key = `${kind}|${surfaceKitVariantKey(kind, variant)}`;
  let m = cache.get(key);
  if (!m) {
    const b = new MeshB();
    BUILD[kind](b, variant);
    cache.set(key, (m = b.out));
  }
  return m;
}

/** Triangle count of a kit mesh (all materials). */
export const kitTriangles = (m: KitMesh): number => [...m.values()].reduce((s, q) => s + q.idx.length / 3, 0);
