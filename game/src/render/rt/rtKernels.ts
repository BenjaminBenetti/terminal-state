// Task studio-rt-flashlight-compute-20261115-233136-01: the RT FLASHLIGHT's compute kernels (WGSL, raw WebGPU on three's own device:
// render/rt/rtGpu.ts runs them). Ordinary WebGPU compute with our own two-level BVH and traversal — no hardware ray-tracing API
// (browsers expose none; see docs/rt-flashlight.md).
//
// One frame (rtGpu.ts encode), one compute pass, six dispatches:
//  1. LIGHT     VPL_COUNT rays of EQUAL FLUX in the spot's cone (the cone table is the CPU's: rtCone.ts, the same equal-flux math as
//               world/flashBounce.ts) traced through the station (closest hit, from the spot, t >= the flashlight shadow's near
//               plane) -> one VPL per ray where the beam really lands: its point, its normal (toward the light), the radiant
//               intensity it sends back (albedo x the spot's own falloff x d^2 x the ray's solid angle / pi, like flashBounce.ts'
//               transfer) and its own patch size (r0^2 from its footprint d^2 w / cos).
//  2. RECEIVERS the main camera's rays through a low-resolution grid traced through the station (closest hit): per cell the surface
//               it sees (point, normal toward the eye, class: mesh / proxy / none).
//  3. GATHER    per receiver the UNSHADOWED irradiance U = sum over EVERY VPL of the area-regularized Lambert kernel (FB's range
//               window), exactly, VPLs streamed through workgroup memory; on the way, weighted reservoir sampling picks one VPL per
//               STRATUM (two halves of the beam, the split axis alternating per frame) with probability ~ its contribution, and
//               one SHADOW RAY per stratum (any hit) tells whether it is seen: v = the contribution-weighted visible share.
//  4. TEMPORAL  v is reprojected from the previous frame's receivers (their world points, the previous view-projection; a tap
//               counts only on the same plane, facing the same way, of the same class), clamped to this frame's 3 x 3 range and
//               blended with an alpha that never falls below the CPU's floor (raised while the beam turns or the light moves).
//  5. SPATIAL   two edge-stopped a-trous passes (steps 1 and 2, 5 x 5 B3 weights) over v; the second writes the result textures:
//               E = U x v x gain (+ the receiver's plane offset) and N (normal, class) — world/rtBounceNode.ts reads them.
// U is exact for the frame's VPLs: the bounce's shape follows the beam the same frame; only the visible share v is filtered.
// Formats (shared with render/rt/rtScene.ts / rtTrace.ts, the CPU reference): see the reference task's DESIGN and rtScene.ts.

/** Rays the light casts (32 x 32 equal-flux cells). */
export const VPL_GRID = 32;
export const VPL_COUNT = VPL_GRID * VPL_GRID;
/** Shadow rays per receiver per frame (one per stratum). */
export const STRATA = 2;
/** vec4 per receiver record: [p, cls] [n, planeOffset] [U, v] [vAcc, histLen, vFilt, 0]. */
export const RECEIVER_VEC4 = 4;
/** vec4 per VPL: [p (lifted), r0^2] [n, 0] [intensity rgb, 0]. */
export const VPL_VEC4 = 3;
/** A VPL stands this far (m) off its surface. */
export const VPL_LIFT = 0.05;
/** Workgroup edge (8 x 8) of the grid kernels; the light kernel runs 64 rays a group. */
export const WG = 8;
/** Most stack entries of one tree walk (a deeper tree drops the farthest pending node: the leaf-size and SAH build keep it far below). */
export const STACK_DEPTH = 40;

/**
 * The per-frame uniform block (rtGpu.ts writes it; FRAME_FLOATS floats, offsets in floats):
 *   0 camPos.xyz, w unused | 4 camRight.xyz (x tan half fov x) | 8 camUp.xyz (x tan half fov y) | 12 camFwd.xyz, w far
 *   16 prevViewProj (mat4, column-major) | 32 lightPos.xyz, w tmin | 36 lightAxis.xyz, w cutoff (0 = none)
 *   40 lightU.xyz, w decay | 44 lightV.xyz, w share (one ray's solid angle / pi) | 48 lightColor.rgb (x intensity), w reach
 *   52 params: gain, range, r0min^2, soft (patch area multiplier / pi) | 56 params2: alphaMin, rayEps, prevValid, planeTol
 *   60 roots (u32): staticNodes, staticNodeCount, dynamicNodes, dynamicNodeCount
 *   64 regions (u32): instances, materials, lightOn, vplCount | 68 grid (u32): W, H, prevW, prevH | 72 misc (u32): frame, odd, 0, 0
 */
export const FRAME_FLOATS = 76;

const PRELUDE = /* wgsl */`
const INF: f32 = 1e30;
const STACK: u32 = ${STACK_DEPTH}u;

struct Frame {
  camPos: vec4f,
  camRight: vec4f,
  camUp: vec4f,
  camFwd: vec4f,
  prevViewProj: mat4x4f,
  lightPos: vec4f,
  lightAxis: vec4f,
  lightU: vec4f,
  lightV: vec4f,
  lightColor: vec4f,
  params: vec4f,
  params2: vec4f,
  roots: vec4u,
  regions: vec4u,
  grid: vec4u,
  misc: vec4u,
}

@group(0) @binding(0) var<uniform> F: Frame;
`;

/** Scene buffers + traversal (closest / any hit). Bindings 1..3. */
const TRACE = /* wgsl */`
@group(0) @binding(1) var<storage, read> bn: array<vec4f>;
@group(0) @binding(2) var<storage, read> bt: array<vec4f>;
@group(0) @binding(3) var<storage, read> tl: array<vec4f>;

struct Hit {
  t: f32,
  inst: u32,
  prim: i32,
  nObj: vec3f,
}

fn safeInv(d: vec3f) -> vec3f {
  let e = vec3f(1e-12);
  let s = select(-e, e, d >= vec3f(0.0));
  return 1.0 / select(d, s, abs(d) < e);
}

fn boxEnter(o: vec3f, inv: vec3f, mn: vec3f, mx: vec3f, tmin: f32, tmax: f32) -> f32 {
  let t0 = (mn - o) * inv;
  let t1 = (mx - o) * inv;
  let lo = min(t0, t1);
  let hi = max(t0, t1);
  let tn = max(max(lo.x, lo.y), max(lo.z, tmin));
  let tf = min(min(hi.x, hi.y), min(hi.z, tmax));
  return select(INF, tn, tn <= tf);
}

// One BLAS (object space), closest hit below *best; anyHit: stop at the first.
fn blasWalk(root: u32, o: vec3f, d: vec3f, tmin: f32, best: ptr<function, f32>, prim: ptr<function, i32>, nObj: ptr<function, vec3f>, anyHit: bool) -> bool {
  let inv = safeInv(d);
  var sn: array<u32, ${STACK_DEPTH}>;
  var st: array<f32, ${STACK_DEPTH}>;
  var sp = 0u;
  var found = false;
  let r0 = bn[2u * root];
  let r1 = bn[2u * root + 1u];
  let te = boxEnter(o, inv, r0.xyz, r1.xyz, tmin, *best);
  if (te >= INF) { return false; }
  sn[0] = root; st[0] = te; sp = 1u;
  loop {
    if (sp == 0u) { break; }
    sp = sp - 1u;
    if (st[sp] >= *best) { continue; }
    let node = sn[sp];
    let a = bn[2u * node];
    let b = bn[2u * node + 1u];
    let cnt = bitcast<u32>(b.w);
    if (cnt > 0u) {
      let first = bitcast<u32>(a.w);
      for (var k = 0u; k < cnt; k = k + 1u) {
        let ti = first + k;
        let p0 = bt[3u * ti];
        let p1 = bt[3u * ti + 1u];
        let p2 = bt[3u * ti + 2u];
        let e1 = p1.xyz - p0.xyz;
        let e2 = p2.xyz - p0.xyz;
        let pv = cross(d, e2);
        let det = dot(e1, pv);
        if (abs(det) < 1e-20) { continue; }
        let id = 1.0 / det;
        let s = o - p0.xyz;
        let u = dot(s, pv) * id;
        if (u < 0.0 || u > 1.0) { continue; }
        let q = cross(s, e1);
        let v = dot(d, q) * id;
        if (v < 0.0 || u + v > 1.0) { continue; }
        let t = dot(e2, q) * id;
        if (t > tmin && t < *best) {
          *best = t;
          *prim = i32(ti);
          *nObj = cross(e1, e2);
          found = true;
          if (anyHit) { return true; }
        }
      }
    } else {
      let l = bitcast<u32>(a.w);
      let r = l + 1u;
      let la = bn[2u * l];
      let lb = bn[2u * l + 1u];
      let ra = bn[2u * r];
      let rb = bn[2u * r + 1u];
      let tL = boxEnter(o, inv, la.xyz, lb.xyz, tmin, *best);
      let tR = boxEnter(o, inv, ra.xyz, rb.xyz, tmin, *best);
      var nearN = l; var farN = r; var nearT = tL; var farT = tR;
      if (tR < tL) { nearN = r; farN = l; nearT = tR; farT = tL; }
      if (farT < INF && sp < STACK) { sn[sp] = farN; st[sp] = farT; sp = sp + 1u; }
      if (nearT < INF && sp < STACK) { sn[sp] = nearN; st[sp] = nearT; sp = sp + 1u; }
    }
  }
  return found;
}

// An upright cylinder with flat caps (x, z, radius, y0 | y1): the nearest entry in (tmin, tmax); INF none. A ray that starts
// inside it does not see it. n receives the world normal.
fn capsuleHit(c: vec4f, y1: f32, o: vec3f, d: vec3f, tmin: f32, tmax: f32, n: ptr<function, vec3f>) -> f32 {
  let ox = o.x - c.x;
  let oz = o.z - c.y;
  let r = c.z;
  let y0 = c.w;
  let cq = ox * ox + oz * oz - r * r;
  if (cq < 0.0 && o.y >= y0 && o.y <= y1) { return INF; }
  var best = INF;
  let a = d.x * d.x + d.z * d.z;
  if (a > 1e-12) {
    let b = ox * d.x + oz * d.z;
    let disc = b * b - a * cq;
    if (disc >= 0.0) {
      let t = (-b - sqrt(disc)) / a;
      let y = o.y + d.y * t;
      if (t > tmin && t < tmax && y >= y0 && y <= y1) {
        best = t;
        *n = vec3f((ox + d.x * t) / r, 0.0, (oz + d.z * t) / r);
      }
    }
  }
  if (abs(d.y) > 1e-12) {
    for (var k = 0u; k < 2u; k = k + 1u) {
      let yc = select(y0, y1, k == 1u);
      let t = (yc - o.y) / d.y;
      if (t > tmin && t < min(best, tmax)) {
        let px = ox + d.x * t;
        let pz = oz + d.z * t;
        if (px * px + pz * pz <= r * r) {
          best = t;
          *n = vec3f(0.0, select(-1.0, 1.0, k == 1u), 0.0);
        }
      }
    }
  }
  return best;
}

// The instances of one TLAS leaf: closest (or any) hit below *best. A hit sets h (its nObj is WORLD space for a capsule).
fn instWalk(ii: u32, o: vec3f, d: vec3f, tmin: f32, best: ptr<function, f32>, h: ptr<function, Hit>, anyHit: bool) -> bool {
  let base = F.regions.x + 6u * ii;
  let im = bitcast<vec4u>(tl[base + 3u]);
  if ((im.z & 1u) != 0u) { return false; }
  if (im.w == 1u) {
    var nw = vec3f(0.0);
    let t = capsuleHit(tl[base + 4u], tl[base + 5u].x, o, d, tmin, *best, &nw);
    if (t < *best) { *best = t; (*h).t = t; (*h).inst = ii; (*h).prim = -1; (*h).nObj = nw; return true; }
    return false;
  }
  let w0 = tl[base];
  let w1 = tl[base + 1u];
  let w2 = tl[base + 2u];
  let oo = vec3f(dot(w0.xyz, o) + w0.w, dot(w1.xyz, o) + w1.w, dot(w2.xyz, o) + w2.w);
  let dd = vec3f(dot(w0.xyz, d), dot(w1.xyz, d), dot(w2.xyz, d));
  var prim = -1;
  var no = vec3f(0.0);
  if (blasWalk(im.x, oo, dd, tmin, best, &prim, &no, anyHit)) {
    (*h).t = *best; (*h).inst = ii; (*h).prim = prim; (*h).nObj = no;
    return true;
  }
  return false;
}

// One TLAS (nodes at vec4 offset nodeBase, nodeCount nodes; root = node 0).
fn tlasWalk(nodeBase: u32, nodeCount: u32, o: vec3f, d: vec3f, tmin: f32, best: ptr<function, f32>, h: ptr<function, Hit>, anyHit: bool) -> bool {
  if (nodeCount == 0u) { return false; }
  let inv = safeInv(d);
  var sn: array<u32, ${STACK_DEPTH}>;
  var st: array<f32, ${STACK_DEPTH}>;
  var sp = 0u;
  var found = false;
  let te = boxEnter(o, inv, tl[nodeBase].xyz, tl[nodeBase + 1u].xyz, tmin, *best);
  if (te >= INF) { return false; }
  sn[0] = 0u; st[0] = te; sp = 1u;
  loop {
    if (sp == 0u) { break; }
    sp = sp - 1u;
    if (st[sp] >= *best) { continue; }
    let node = sn[sp];
    let a = tl[nodeBase + 2u * node];
    let b = tl[nodeBase + 2u * node + 1u];
    let cnt = bitcast<u32>(b.w);
    if (cnt > 0u) {
      let first = bitcast<u32>(a.w);
      for (var k = 0u; k < cnt; k = k + 1u) {
        if (instWalk(first + k, o, d, tmin, best, h, anyHit)) {
          found = true;
          if (anyHit) { return true; }
        }
      }
    } else {
      let l = bitcast<u32>(a.w);
      let r = l + 1u;
      let tL = boxEnter(o, inv, tl[nodeBase + 2u * l].xyz, tl[nodeBase + 2u * l + 1u].xyz, tmin, *best);
      let tR = boxEnter(o, inv, tl[nodeBase + 2u * r].xyz, tl[nodeBase + 2u * r + 1u].xyz, tmin, *best);
      var nearN = l; var farN = r; var nearT = tL; var farT = tR;
      if (tR < tL) { nearN = r; farN = l; nearT = tR; farT = tL; }
      if (farT < INF && sp < STACK) { sn[sp] = farN; st[sp] = farT; sp = sp + 1u; }
      if (nearT < INF && sp < STACK) { sn[sp] = nearN; st[sp] = nearT; sp = sp + 1u; }
    }
  }
  return found;
}

fn traceClosest(o: vec3f, d: vec3f, tmin: f32, tmax: f32, h: ptr<function, Hit>) -> bool {
  var best = tmax;
  let a = tlasWalk(F.roots.x, F.roots.y, o, d, tmin, &best, h, false);
  let b = tlasWalk(F.roots.z, F.roots.w, o, d, tmin, &best, h, false);
  return a || b;
}

fn traceAny(o: vec3f, d: vec3f, tmin: f32, tmax: f32) -> bool {
  var best = tmax;
  var h: Hit;
  if (tlasWalk(F.roots.x, F.roots.y, o, d, tmin, &best, &h, true)) { return true; }
  return tlasWalk(F.roots.z, F.roots.w, o, d, tmin, &best, &h, true);
}

// The hit's world normal (geometric, unit) and diffuse albedo.
fn hitNormal(h: Hit) -> vec3f {
  if (h.prim < 0) { return normalize(h.nObj); }
  let base = F.regions.x + 6u * h.inst;
  let w0 = tl[base].xyz;
  let w1 = tl[base + 1u].xyz;
  let w2 = tl[base + 2u].xyz;
  return normalize(w0 * h.nObj.x + w1 * h.nObj.y + w2 * h.nObj.z);
}

fn hitAlbedo(h: Hit) -> vec3f {
  let base = F.regions.x + 6u * h.inst;
  let im = bitcast<vec4u>(tl[base + 3u]);
  if (h.prim < 0) { return tl[F.regions.y + im.y].xyz; }
  let ti = u32(h.prim);
  let slot = bitcast<u32>(bt[3u * ti].w);
  let m = tl[F.regions.y + im.y + slot];
  var a = m.xyz * tl[base + 4u].xyz;
  if ((bitcast<u32>(m.w) & 1u) != 0u) {
    let c = bitcast<u32>(bt[3u * ti + 1u].w);
    if (c != 0xffffffffu) { a = a * unpack4x8unorm(c).xyz; }
  }
  return a;
}

fn hitProxy(h: Hit) -> bool {
  let im = bitcast<vec4u>(tl[F.regions.x + 6u * h.inst + 3u]);
  return (im.z & 2u) != 0u;
}
`;

const LIGHT = /* wgsl */`
struct Cone { dirs: array<vec4f, ${VPL_COUNT}> }
@group(0) @binding(4) var<uniform> C: Cone;
@group(0) @binding(5) var<storage, read_write> vpl: array<vec4f>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= F.regions.w) { return; }
  let c = C.dirs[i];
  let o = F.lightPos.xyz;
  let d = normalize(F.lightAxis.xyz * c.x + F.lightU.xyz * c.y + F.lightV.xyz * c.z);
  var h: Hit;
  h.t = INF;
  if (F.regions.z == 0u || c.w <= 0.0 || !traceClosest(o, d, F.lightPos.w, F.lightColor.w, &h)) {
    vpl[3u * i] = vec4f(0.0);
    vpl[3u * i + 1u] = vec4f(0.0);
    vpl[3u * i + 2u] = vec4f(0.0);
    return;
  }
  var nrm = hitNormal(h);
  if (dot(nrm, d) > 0.0) { nrm = -nrm; }
  let p = o + d * h.t;
  let d2 = h.t * h.t;
  // three's spot falloff at the hit (r186 getDistanceAttenuation), on the ray's share of the cone's flux, x d^2 (the footprint)
  var g = d2 / max(pow(h.t, F.lightU.w), 0.01);
  let cutoff = F.lightAxis.w;
  if (cutoff > 0.0) {
    let q = h.t / cutoff;
    let w = clamp(1.0 - q * q * q * q, 0.0, 1.0);
    g = g * w * w;
  }
  g = g * F.lightV.w;
  let tilt = max(-dot(d, nrm), 0.0);
  let area = d2 * F.lightV.w * 3.14159265 / max(tilt, 0.25);
  let r0 = max(F.params.w * area, F.params.z);
  vpl[3u * i] = vec4f(p + nrm * ${VPL_LIFT}, r0);
  vpl[3u * i + 1u] = vec4f(nrm, 0.0);
  vpl[3u * i + 2u] = vec4f(hitAlbedo(h) * g * F.lightColor.xyz, 0.0);
}
`;

const RECEIVERS = /* wgsl */`
@group(0) @binding(4) var<storage, read_write> rc: array<vec4f>;

@compute @workgroup_size(${WG}, ${WG})
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let W = F.grid.x;
  let H = F.grid.y;
  if (gid.x >= W || gid.y >= H) { return; }
  let r = (gid.y * W + gid.x) * ${RECEIVER_VEC4}u;
  let nx = (f32(gid.x) + 0.5) / f32(W) * 2.0 - 1.0;
  let ny = 1.0 - (f32(gid.y) + 0.5) / f32(H) * 2.0;
  let d = normalize(F.camFwd.xyz + F.camRight.xyz * nx + F.camUp.xyz * ny);
  var h: Hit;
  h.t = INF;
  if (!traceClosest(F.camPos.xyz, d, 0.02, F.camFwd.w, &h)) {
    rc[r] = vec4f(0.0);
    rc[r + 1u] = vec4f(0.0, 0.0, 0.0, 0.0);
    rc[r + 2u] = vec4f(0.0, 0.0, 0.0, 1.0);
    rc[r + 3u] = vec4f(1.0, 0.0, 1.0, 0.0);
    return;
  }
  let p = F.camPos.xyz + d * h.t;
  var nrm = hitNormal(h);
  if (dot(nrm, d) > 0.0) { nrm = -nrm; }
  rc[r] = vec4f(p, select(1.0, 0.5, hitProxy(h)));
  rc[r + 1u] = vec4f(nrm, dot(nrm, p - F.camPos.xyz));
}
`;

const GATHER = /* wgsl */`
@group(0) @binding(4) var<storage, read> vpl: array<vec4f>;
@group(0) @binding(5) var<storage, read_write> rc: array<vec4f>;

var<workgroup> tP: array<vec4f, 64>;
var<workgroup> tN: array<vec4f, 64>;
var<workgroup> tF: array<vec4f, 64>;

fn pcg(s: u32) -> u32 {
  let st = s * 747796405u + 2891336453u;
  let w = ((st >> ((st >> 28u) + 4u)) ^ st) * 277803737u;
  return (w >> 22u) ^ w;
}

@compute @workgroup_size(${WG}, ${WG})
fn main(@builtin(global_invocation_id) gid: vec3u, @builtin(local_invocation_index) li: u32) {
  let W = F.grid.x;
  let H = F.grid.y;
  let inside = gid.x < W && gid.y < H;
  let r = (min(gid.y, H - 1u) * W + min(gid.x, W - 1u)) * ${RECEIVER_VEC4}u;
  let r0 = rc[r];
  let r1 = rc[r + 1u];
  let live = inside && r0.w > 0.25 && F.regions.z != 0u;
  let p = r0.xyz;
  let n = r1.xyz;
  let invR2 = 1.0 / max(F.params.y * F.params.y, 1e-6);
  var U = vec3f(0.0);
  var wsum = array<f32, ${STRATA}>(0.0, 0.0);
  var pick = array<u32, ${STRATA}>(0u, 0u);
  var seed = pcg(gid.x * 1973u + gid.y * 9277u + F.misc.x * 26699u);
  let count = F.regions.w;
  let odd = F.misc.y != 0u;
  for (var base = 0u; base < count; base = base + 64u) {
    workgroupBarrier();
    let k = base + li;
    if (k < count) {
      tP[li] = vpl[3u * k];
      tN[li] = vpl[3u * k + 1u];
      tF[li] = vpl[3u * k + 2u];
    } else {
      tF[li] = vec4f(0.0);
    }
    workgroupBarrier();
    if (live) {
      for (var j = 0u; j < 64u; j = j + 1u) {
        let lf = tF[j].xyz;
        if (lf.x + lf.y + lf.z <= 0.0) { continue; }
        let lp = tP[j];
        let dv = lp.xyz - p;
        let r2 = max(dot(dv, dv), 1e-6);
        let cr = max(dot(n, dv), 0.0);
        let ce = max(-dot(tN[j].xyz, dv), 0.0);
        if (cr * ce <= 0.0) { continue; }
        let q = r2 * invR2;
        let win = clamp(1.0 - q * q, 0.0, 1.0);
        if (win <= 0.0) { continue; }
        let f = lf * (cr * ce * win * win / (r2 * (r2 + lp.w)));
        U = U + f;
        let lum = dot(f, vec3f(0.2126, 0.7152, 0.0722));
        let kk = base + j;
        let gx = kk % ${VPL_GRID}u;
        let gy = kk / ${VPL_GRID}u;
        let s = select(u32(gx >= ${VPL_GRID / 2}u), u32(gy >= ${VPL_GRID / 2}u), odd);
        wsum[s] = wsum[s] + lum;
        seed = pcg(seed);
        if (f32(seed >> 8u) * (1.0 / 16777216.0) * wsum[s] < lum) { pick[s] = kk; }
      }
    }
  }
  if (!inside) { return; }
  var v = 1.0;
  if (live) {
    var seen = 0.0;
    var total = 0.0;
    let eps = F.params2.y * (1.0 + length(p - F.camPos.xyz) * 0.05);
    let o = p + n * eps;
    for (var s = 0u; s < ${STRATA}u; s = s + 1u) {
      if (wsum[s] <= 0.0) { continue; }
      let to = vpl[3u * pick[s]].xyz - o;
      let dist = length(to);
      total = total + wsum[s];
      if (dist <= 2.0 * eps || !traceAny(o, to / dist, 1e-3, dist - eps)) { seen = seen + wsum[s]; }
    }
    if (total > 0.0) { v = seen / total; }
  }
  rc[r + 2u] = vec4f(U, v);
}
`;

const TEMPORAL = /* wgsl */`
@group(0) @binding(4) var<storage, read_write> rc: array<vec4f>;
@group(0) @binding(5) var<storage, read> rp: array<vec4f>;

@compute @workgroup_size(${WG}, ${WG})
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let W = F.grid.x;
  let H = F.grid.y;
  if (gid.x >= W || gid.y >= H) { return; }
  let r = (gid.y * W + gid.x) * ${RECEIVER_VEC4}u;
  let r0 = rc[r];
  let v = rc[r + 2u].w;
  if (r0.w <= 0.25) { rc[r + 3u] = vec4f(v, 0.0, v, 0.0); return; }
  let p = r0.xyz;
  let n = rc[r + 1u].xyz;
  // this frame's 3 x 3 range of v on the same surface (the history is clamped into it)
  var lo = v;
  var hi = v;
  for (var dy = -1; dy <= 1; dy = dy + 1) {
    for (var dx = -1; dx <= 1; dx = dx + 1) {
      let x = i32(gid.x) + dx;
      let y = i32(gid.y) + dy;
      if (x < 0 || y < 0 || x >= i32(W) || y >= i32(H)) { continue; }
      let q = (u32(y) * W + u32(x)) * ${RECEIVER_VEC4}u;
      if (rc[q].w <= 0.25 || dot(rc[q + 1u].xyz, n) < 0.8) { continue; }
      let vq = rc[q + 2u].w;
      lo = min(lo, vq);
      hi = max(hi, vq);
    }
  }
  var hist = 0.0;
  var len = 0.0;
  var wsum = 0.0;
  if (F.params2.z > 0.5) {
    let clip = F.prevViewProj * vec4f(p, 1.0);
    if (clip.w > 1e-4) {
      let PW = F.grid.z;
      let PH = F.grid.w;
      let g = vec2f(clip.x / clip.w * 0.5 + 0.5, 0.5 - clip.y / clip.w * 0.5) * vec2f(f32(PW), f32(PH)) - 0.5;
      let i0 = floor(g);
      let fr = g - i0;
      let tol = F.params2.w * (1.0 + length(p - F.camPos.xyz) * 0.25);
      for (var k = 0u; k < 4u; k = k + 1u) {
        let x = i32(i0.x) + i32(k & 1u);
        let y = i32(i0.y) + i32(k >> 1u);
        if (x < 0 || y < 0 || x >= i32(PW) || y >= i32(PH)) { continue; }
        let q = (u32(y) * PW + u32(x)) * ${RECEIVER_VEC4}u;
        let q0 = rp[q];
        if (abs(q0.w - r0.w) > 0.1) { continue; }
        let qn = rp[q + 1u].xyz;
        if (dot(qn, n) < 0.85 || abs(dot(qn, p - q0.xyz)) > tol) { continue; }
        let wb = select(1.0 - fr.x, fr.x, (k & 1u) != 0u) * select(1.0 - fr.y, fr.y, (k >> 1u) != 0u);
        let h3 = rp[q + 3u];
        hist = hist + h3.x * wb;
        len = len + h3.y * wb;
        wsum = wsum + wb;
      }
    }
  }
  var acc = v;
  var n1 = 1.0;
  if (wsum > 1e-3) {
    let h = clamp(hist / wsum, lo - 0.05, hi + 0.05);
    let l = len / wsum;
    let alpha = max(1.0 / (l + 1.0), F.params2.x);
    acc = mix(h, v, alpha);
    n1 = min(l + 1.0, 32.0);
  }
  rc[r + 3u] = vec4f(acc, n1, acc, 0.0);
}
`;

/** The a-trous pass: reads vIn (the temporal v, or the first pass's), writes vOut; the last pass also writes the textures. */
const spatial = (last: boolean): string => /* wgsl */`
@group(0) @binding(4) var<storage, read> rc: array<vec4f>;
${last ? '@group(0) @binding(5) var<storage, read> vIn: array<f32>;' : '@group(0) @binding(5) var<storage, read_write> vOut: array<f32>;'}
${last ? '@group(0) @binding(6) var outE: texture_storage_2d<rgba16float, write>;\n@group(0) @binding(7) var outN: texture_storage_2d<rgba8unorm, write>;' : ''}

fn vAt(q: u32) -> f32 {
  ${last ? 'return vIn[q];' : `return rc[q * ${RECEIVER_VEC4}u + 3u].x;`}
}

@compute @workgroup_size(${WG}, ${WG})
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let W = F.grid.x;
  let H = F.grid.y;
  if (gid.x >= W || gid.y >= H) { return; }
  let c = gid.y * W + gid.x;
  let r = c * ${RECEIVER_VEC4}u;
  let r0 = rc[r];
  let r1 = rc[r + 1u];
  var v = vAt(c);
  if (r0.w > 0.25) {
    let p = r0.xyz;
    let n = r1.xyz;
    let tol = F.params2.w * (1.0 + length(p - F.camPos.xyz) * 0.25);
    let step = ${last ? 2 : 1};
    var sum = 0.0;
    var ws = 0.0;
    for (var dy = -2; dy <= 2; dy = dy + 1) {
      for (var dx = -2; dx <= 2; dx = dx + 1) {
        let x = i32(gid.x) + dx * step;
        let y = i32(gid.y) + dy * step;
        if (x < 0 || y < 0 || x >= i32(W) || y >= i32(H)) { continue; }
        let q = u32(y) * W + u32(x);
        let s0 = rc[q * ${RECEIVER_VEC4}u];
        if (abs(s0.w - r0.w) > 0.1) { continue; }
        let sn = rc[q * ${RECEIVER_VEC4}u + 1u].xyz;
        let nd = dot(sn, n);
        if (nd < 0.8) { continue; }
        let pd = abs(dot(n, s0.xyz - p));
        let kx = select(select(0.25, 0.0625, abs(dx) == 2), 0.375, dx == 0);
        let ky = select(select(0.25, 0.0625, abs(dy) == 2), 0.375, dy == 0);
        let w = kx * ky * exp(-pd / tol) * pow(nd, 8.0);
        sum = sum + vAt(q) * w;
        ws = ws + w;
      }
    }
    if (ws > 1e-6) { v = sum / ws; }
  }
  ${last ? `
  let U = rc[r + 2u].xyz;
  let E = select(vec3f(0.0), U * clamp(v, 0.0, 1.0) * F.params.x, r0.w > 0.25);
  textureStore(outE, vec2u(gid.x, gid.y), vec4f(E, r1.w));
  textureStore(outN, vec2u(gid.x, gid.y), vec4f(r1.xyz * 0.5 + 0.5, select(0.0, r0.w, r0.w > 0.25)));` : 'vOut[c] = v;'}
}
`;

export type RtKernel = 'light' | 'receivers' | 'gather' | 'temporal' | 'spatial1' | 'spatial2';
export const RT_KERNELS: readonly RtKernel[] = ['light', 'receivers', 'gather', 'temporal', 'spatial1', 'spatial2'];

/** The WGSL module of one kernel (entry point `main`). */
export function kernelSource(k: RtKernel): string {
  switch (k) {
    case 'light': return PRELUDE + TRACE + LIGHT;
    case 'receivers': return PRELUDE + TRACE + RECEIVERS;
    case 'gather': return PRELUDE + TRACE + GATHER;
    case 'temporal': return PRELUDE + TEMPORAL;
    case 'spatial1': return PRELUDE + spatial(false);
    case 'spatial2': return PRELUDE + spatial(true);
  }
}

/** Storage buffers each kernel binds (the probe checks the device's per-stage limit against the largest). */
export const KERNEL_STORAGE_BUFFERS: Readonly<Record<RtKernel, number>> = {light: 4, receivers: 4, gather: 5, temporal: 2, spatial1: 2, spatial2: 2};
export const KERNEL_STORAGE_TEXTURES: Readonly<Record<RtKernel, number>> = {light: 0, receivers: 0, gather: 0, temporal: 0, spatial1: 0, spatial2: 2};
