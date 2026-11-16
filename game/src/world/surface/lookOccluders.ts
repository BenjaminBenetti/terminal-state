// Task studio-surface-run-opus-rebuild-20261116-020827-01 (lane LOOK, follow-up 2: the district's per-frame draws): the district's
// FACADES as occluders for the look's own instanced pieces (the rooftop plant, the surroundings: world/surface/look.ts
// cullSurfaceInstances). Pure; the level culler and every registered mesh are untouched.
//
// A street facade is drawn opaque on its plane from the building's base to its roof line, except at its LIVE openings (AIR's window
// spans, doorways, boarded doors): every decorative window / shopfront bay is closed by its dark-room box (arch.ts: reveal + void face),
// so a sight line that meets the facade plane inside the side, at a height clear of every live opening's band and under the side's
// lowest top, meets the drawn face. Each side gives SOLID STRIPS: the height bands between its live openings, across the whole side.
// Only sides that face open street along their whole length count (a party wall may be hidden by its neighbour), and not the tent,
// the hosts' own buildings or the depot (their openings are their own).
//
// LookOcclusion rasterises the strips that face the eye into a coarse view-space depth buffer CONSERVATIVELY: a buffer pixel takes a
// strip only when the strip covers the whole pixel, at the strip's FARTHEST depth over it; a box is hidden only when every pixel its
// projection touches holds an occluder nearer than the box's nearest corner (and no corner is behind the near plane).

import * as THREE from 'three';
import {CELL, FLOOR} from '../../gen/grid';
import type {StationLayout} from '../../gen/stationTypes';
import {OWNER, entranceFloor, type BuildingLook, type FacadeSide, type SurfaceLookPlan} from './archPlan';

/** A solid band of a street facade: its plane (z for N / S sides, x for W / E), outward normal sign, extent along it, heights. */
export interface FacadeStrip { alongX: boolean; plane: number; n: 1 | -1; s0: number; s1: number; y0: number; y1: number }

/** Margins (m): kept off a strip's ends and band edges, round every live opening's band, and the least band height kept. */
const END = 0.3, EDGE = 0.08, OPEN_PAD = 0.15, MIN_BAND = 0.4;

/** Whether every cell just outside the side (0.3 m out, every half cell along it) is open street (FLOOR, no owner). */
export function streetSide(layout: StationLayout, plan: SurfaceLookPlan, sd: FacadeSide): boolean {
  const g = layout.grid, L = sd.s1 - sd.s0;
  if (L <= 2 * CELL) return false;
  const out = sd.plane + sd.n * (CELL * 0.6), steps = Math.ceil((L - 0.2) / (CELL / 2));
  for (let j = 0; j <= steps; j++) {
    const s = sd.s0 + 0.1 + (L - 0.2) * (j / steps);
    const cx = Math.floor((sd.alongX ? s : out) / CELL), cz = Math.floor((sd.alongX ? out : s) / CELL), i = cz * g.w + cx;
    if (!(cx >= 0 && cz >= 0 && cx < g.w && cz < g.h && g.cells[i] === FLOOR && plan.owner[i] === OWNER.none)) return false;
  }
  return true;
}

/** Whether a building's facades are a closed street shell (not the tent, a host's own building, the depot). */
export const closedShell = (bl: BuildingLook): boolean => bl.style.wall !== 'canvas' && !bl.b.host && bl.b.kind !== 'depot' && bl.sides.length > 0;

/** The district's solid facade strips (see above); [] without a plan. */
export function facadeStrips(layout: StationLayout, plan: SurfaceLookPlan | null): FacadeStrip[] {
  if (!plan) return [];
  const out: FacadeStrip[] = [];
  for (const bl of plan.buildings) {
    if (!closedShell(bl)) continue;
    const base = bl.storeyY[0] ?? 0;
    for (const sd of bl.sides) {
      if (!sd.tops.length || !streetSide(layout, plan, sd)) continue;
      const top = Math.min(...sd.tops.map(t => t.top)) - EDGE;
      // the live openings' bands on this side (AIR's spans, boarded doors, every doorway)
      const open: [number, number][] = [];
      for (const h of bl.holes) if (h.side === sd.side && (h.kind === 'air' || h.kind === 'door-boarded')) open.push([h.y0 - OPEN_PAD, h.y1 + OPEN_PAD]);
      for (const e of bl.b.entrances) if (e.side === sd.side) { const f = entranceFloor(layout, e); open.push([f - OPEN_PAD, f + e.height + 0.4 + OPEN_PAD]); }
      open.sort((a, b) => a[0] - b[0]);
      let y = base + EDGE;
      const band = (y1: number) => { if (y1 - y >= MIN_BAND) out.push({alongX: sd.alongX, plane: sd.plane, n: sd.n, s0: sd.s0 + END, s1: sd.s1 - END, y0: y, y1}); };
      for (const [a, b] of open) {
        if (a > y) band(Math.min(a, top));
        y = Math.max(y, b);
        if (y >= top) break;
      }
      if (y < top) band(top);
    }
  }
  return out;
}

const _v = new THREE.Vector3();

/** A coarse conservative occlusion buffer of the facade strips for one camera view (see above). */
export class LookOcclusion {
  readonly w: number;
  readonly h: number;
  /** Per pixel: the nearest depth behind which a strip covers it whole (Infinity: none). */
  readonly depth: Float32Array;
  private readonly lo: Float64Array;
  private readonly hi: Float64Array;
  private readonly V = new THREE.Matrix4();
  private readonly P = new THREE.Matrix4();
  private near = 0.05;
  stats = {strips: 0, drawn: 0, pixels: 0, ms: 0};

  constructor(w = 96, h = 54) {
    this.w = w; this.h = h;
    this.depth = new Float32Array(w * h);
    this.lo = new Float64Array(h + 1);
    this.hi = new Float64Array(h + 1);
  }

  /** Rasterises the strips facing the eye within `maxDistance` for `cam`'s current view (its world matrices up to date). */
  build(cam: THREE.PerspectiveCamera, strips: readonly FacadeStrip[], maxDistance: number): void {
    const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
    const W = this.w, H = this.h, V = this.V.copy(cam.matrixWorldInverse), P = this.P.copy(cam.projectionMatrix), pe = P.elements, ve = V.elements;
    this.near = cam.near;
    this.depth.fill(Infinity);
    const me = cam.matrixWorld.elements, ex = me[12], ey = me[13], ez = me[14];
    let drawn = 0, pixels = 0;
    const poly: number[][] = [], clip: number[][] = [], sp: number[][] = [];
    for (const st of strips) {
      // facing the eye (the eye on the outward side of the plane) and inside the fog distance
      const ea = st.alongX ? ez : ex, es = st.alongX ? ex : ez;
      if ((ea - st.plane) * st.n <= 0.05) continue;
      const ds = Math.max(st.s0 - es, 0, es - st.s1), dy = Math.max(st.y0 - ey, 0, ey - st.y1);
      if (Math.hypot(ea - st.plane, ds, dy) > maxDistance) continue;
      poly.length = 0;
      for (const [s, y] of [[st.s0, st.y0], [st.s1, st.y0], [st.s1, st.y1], [st.s0, st.y1]]) {
        _v.set(st.alongX ? s : st.plane, y, st.alongX ? st.plane : s).applyMatrix4(V);
        poly.push([_v.x, _v.y, _v.z]);
      }
      // clip to the near plane (z <= -near)
      clip.length = 0;
      const zn = -this.near;
      for (let i = 0; i < 4; i++) {
        const a = poly[i], b = poly[(i + 1) % 4], ain = a[2] <= zn, bin = b[2] <= zn;
        if (ain) clip.push(a);
        if (ain !== bin) { const t = (zn - a[2]) / (b[2] - a[2]); clip.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, zn]); }
      }
      if (clip.length < 3) continue;
      // to buffer pixels (x right, y down)
      sp.length = 0;
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const p of clip) {
        const cw = pe[3] * p[0] + pe[7] * p[1] + pe[11] * p[2] + pe[15];
        const px = ((pe[0] * p[0] + pe[4] * p[1] + pe[8] * p[2] + pe[12]) / cw + 1) * 0.5 * W;
        const py = (1 - (pe[1] * p[0] + pe[5] * p[1] + pe[9] * p[2] + pe[13]) / cw) * 0.5 * H;
        sp.push([px, py]);
        x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py);
      }
      const j0 = Math.max(0, Math.ceil(y0)), j1 = Math.min(H, Math.floor(y1));
      if (j1 - j0 < 1 || Math.min(W, Math.floor(x1)) - Math.max(0, Math.ceil(x0)) < 1) continue;
      // the polygon's span on each grid line y = j (convex: one interval)
      for (let jj = j0; jj <= j1; jj++) {
        let l = Infinity, r = -Infinity;
        for (let k = 0; k < sp.length; k++) {
          const a = sp[k], b = sp[(k + 1) % sp.length];
          if ((a[1] - jj) * (b[1] - jj) > 0) continue;
          if (a[1] === b[1]) { l = Math.min(l, a[0], b[0]); r = Math.max(r, a[0], b[0]); continue; }
          const x = a[0] + (jj - a[1]) * (b[0] - a[0]) / (b[1] - a[1]);
          l = Math.min(l, x); r = Math.max(r, x);
        }
        this.lo[jj] = l; this.hi[jj] = r;
      }
      // the plane's inverse view depth over the buffer: affine in the pixel coordinates (a view ray (x, y, -1) * t meets it at t)
      const wn = st.alongX ? [0, 0, st.n] : [st.n, 0, 0];
      const nx = ve[0] * wn[0] + ve[4] * wn[1] + ve[8] * wn[2], ny = ve[1] * wn[0] + ve[5] * wn[1] + ve[9] * wn[2], nz = ve[2] * wn[0] + ve[6] * wn[1] + ve[10] * wn[2];
      const c = nx * poly[0][0] + ny * poly[0][1] + nz * poly[0][2];
      if (!(Math.abs(c) > 1e-9)) continue;
      const A = nx * (2 / W) / pe[0] / c, B = -ny * (2 / H) / pe[5] / c, C = (-nx / pe[0] + ny / pe[5] - nz) / c;
      const corner = Math.min(0, A) + Math.min(0, B);
      drawn++;
      for (let jj = j0; jj < j1; jj++) {
        const ia = Math.max(0, Math.ceil(Math.max(this.lo[jj], this.lo[jj + 1]))), ib = Math.min(W, Math.floor(Math.min(this.hi[jj], this.hi[jj + 1])));
        for (let ii = ia; ii < ib; ii++) {
          // the farthest point of the strip over the pixel: the least inverse depth, at a corner
          const inv = A * ii + B * jj + C + corner;
          if (!(inv > 0)) continue;
          const d = 1 / inv, o = jj * W + ii;
          if (d < this.depth[o]) { this.depth[o] = d; pixels++; }
        }
      }
    }
    this.stats = {strips: strips.length, drawn, pixels, ms: (typeof performance !== 'undefined' ? performance.now() : 0) - t0};
  }

  /** Whether the strips drawn hide the world box (x0 y0 z0 .. x1 y1 z1) whole from the view `build` saw. */
  boxHidden(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): boolean {
    const W = this.w, H = this.h, pe = this.P.elements, zn = -this.near;
    let px0 = Infinity, px1 = -Infinity, py0 = Infinity, py1 = -Infinity, dmin = Infinity;
    for (let k = 0; k < 8; k++) {
      _v.set(k & 1 ? x1 : x0, k & 2 ? y1 : y0, k & 4 ? z1 : z0).applyMatrix4(this.V);
      if (_v.z > zn) return false;
      const cw = pe[3] * _v.x + pe[7] * _v.y + pe[11] * _v.z + pe[15];
      const px = ((pe[0] * _v.x + pe[4] * _v.y + pe[8] * _v.z + pe[12]) / cw + 1) * 0.5 * W;
      const py = (1 - (pe[1] * _v.x + pe[5] * _v.y + pe[9] * _v.z + pe[13]) / cw) * 0.5 * H;
      px0 = Math.min(px0, px); px1 = Math.max(px1, px); py0 = Math.min(py0, py); py1 = Math.max(py1, py);
      dmin = Math.min(dmin, -_v.z);
    }
    const i0 = Math.max(0, Math.floor(px0)), i1 = Math.min(W - 1, Math.ceil(px1) - 1), j0 = Math.max(0, Math.floor(py0)), j1 = Math.min(H - 1, Math.ceil(py1) - 1);
    if (i1 < i0 || j1 < j0) return false;
    const lim = dmin - 0.05;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (!(this.depth[j * W + i] < lim)) return false;
    return true;
  }
}
