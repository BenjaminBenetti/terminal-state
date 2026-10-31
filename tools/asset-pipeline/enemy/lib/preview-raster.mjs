// Task studio-siren-clothing-refit-20261031-01 (lane PREVIEW): deterministic CPU (software) rasteriser for the Siren human-review
// preview — NOT a GPU / WebGPU / browser render and NOT a captured game frame.
//  - cameras: orthographic or perspective look-at (unmirrored: the camera's right = forward x up);
//  - deferred: a z-buffered G-buffer of (draw, triangle, perspective-correct barycentrics), then per-pixel shading;
//  - materials are double-sided (like the Siren's): a back face shades with its flipped normal;
//  - 'studio' shading: neutral grey background, a light grey ground plane with a 0.5 m grid, three fixed camera-relative lights
//    (key upper-left-front, fill right, rim behind) + ambient, base-colour texture only (no normal map: geometry reads as is);
//  - 'gameplay' shading: a standalone approximation of the game's flashlight look (see GAMEPLAY_LIGHT; three.js physical model:
//    Lambert / pi + GGX specular from the metallic-roughness texture + normal map; hemisphere ambient; FogExp2; ACES filmic);
//  - ground plane y = 0 drawn as a TRANSLUCENT plane: geometry under the floor stays visible, tinted magenta (disclosed, not hidden);
//    edge-on (elevation 0) orthographic views draw the floor as a line + a section band below it; geometry below y = 0 is tinted;
//  - optional soft contact shading on the floor (cosmetic: top-down height map of the drawn geometry; no cast shadows);
//  - supersampled (ss x ss) and downsampled with sharp (lanczos3).
import sharp from 'sharp';

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
const S2L = new Float32Array(256).map((_, i) => { const c = i / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
export const srgbToLinear = c => S2L[Math.max(0, Math.min(255, Math.round(c * 255)))];
const l2s = v => { v = clamp01(v); return v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055; };
export const hexLinear = hex => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255].map(v => S2L[v]);

/** The game's flashlight / ambient look (game/src/game.ts + world/lights.ts MOOD, read 2026-10-31) used by 'gameplay' shading. */
export const GAMEPLAY_LIGHT = {
  source: 'game/src/game.ts (SpotLight 0xfff4e2, 30 m, 0.58 rad, penumbra 0.7, decay 1.2; camera-local position (0.2, -0.15, 0.1), target (0.04, -0.12, -6)) + game/src/world/lights.ts MOOD (flashlight 34 cd, hemisphere 0x8f9c92 / 0x1a1c1a x 0.045, FogExp2 0x090b0a 0.043, ACES filmic exposure 0.78, background 0x0a0b0c)',
  spot: {color: 0xfff4e2, intensity: 34, distance: 30, angle: 0.58, penumbra: 0.7, decay: 1.2, localPos: [0.2, -0.15, 0.1], localTarget: [0.04, -0.12, -6]},
  hemi: {sky: 0x8f9c92, ground: 0x1a1c1a, intensity: 0.045},
  fog: {color: 0x090b0a, density: 0.043}, exposure: 0.78, background: 0x0a0b0c,
  floorAlbedo: 0.16,
  notModelled: ['baked station fixture light field (world/lights.ts StationLighting) and fixture glow cards', 'flashlight / other shadows', 'volumetric atmosphere / scatter', 'player body glow (0.22 cd)', 'battery flicker', 'GPU MSAA / post-processing'],
};

// ------------------------------------------------------------------------------------------------------------------- camera
/**
 * @param o {type: 'ortho' | 'persp', eye, target, up?, height? (ortho: world metres spanning the image height), fovDeg? (persp,
 *   vertical), w, h (pixels)}
 */
export function makeCamera(o) {
  const up0 = o.up ?? [0, 1, 0];
  const f = norm(sub(o.target, o.eye)), r = norm(cross(f, up0)), u = cross(r, f);
  const persp = o.type === 'persp';
  const k = persp ? (o.h / 2) / Math.tan((o.fovDeg * Math.PI / 180) / 2) : o.h / o.height;
  const cam = {...o, f, r, u, persp, k};
  cam.project = p => {
    const d = sub(p, o.eye), x = dot(d, r), y = dot(d, u), z = dot(d, f);
    return persp ? [o.w / 2 + (x / z) * k, o.h / 2 - (y / z) * k, z] : [o.w / 2 + x * k, o.h / 2 - y * k, z];
  };
  /** Ray through pixel centre (px, py): origin + unit direction (ortho: origin on the image plane through the eye). */
  cam.ray = (px, py) => {
    const x = (px - o.w / 2) / k, y = (o.h / 2 - py) / k;
    if (persp) return {o: o.eye, d: norm([f[0] + r[0] * x + u[0] * y, f[1] + r[1] * x + u[1] * y, f[2] + r[2] * x + u[2] * y])};
    return {o: [o.eye[0] + r[0] * x + u[0] * y, o.eye[1] + r[1] * x + u[1] * y, o.eye[2] + r[2] * x + u[2] * y], d: f};
  };
  cam.scaled = s => makeCamera({...o, w: o.w * s, h: o.h * s});
  return cam;
}

/** Camera around a target by body-relative azimuth (deg; 0 = in front of the wearer, +90 = at her LEFT side) and elevation. */
export function orbit({front, left, target, azDeg, elDeg = 0, dist = 6}) {
  const a = azDeg * Math.PI / 180, e = elDeg * Math.PI / 180;
  const dir = [front[0] * Math.cos(a) + left[0] * Math.sin(a), 0, front[2] * Math.cos(a) + left[2] * Math.sin(a)];
  const eye = [target[0] + dir[0] * dist * Math.cos(e), target[1] + dist * Math.sin(e), target[2] + dir[2] * dist * Math.cos(e)];
  return {eye, target};
}

// ------------------------------------------------------------------------------------------------------------------- textures
export async function decodeTex(t, maxSize = 2048) {
  if (!t) return null;
  const {data, info} = await sharp(Buffer.from(t.bytes)).removeAlpha().resize({width: maxSize, height: maxSize, fit: 'inside', withoutEnlargement: true}).raw().toBuffer({resolveWithObject: true});
  return {data, width: info.width, height: info.height};
}
function sample(tex, u, v, out) {
  const W = tex.width, H = tex.height, d = tex.data;
  const x = (u - Math.floor(u)) * W - 0.5, y = (v - Math.floor(v)) * H - 0.5;
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  const xa = (x0 + W) % W, xb = (x0 + 1 + W) % W, ya = (y0 + H) % H, yb = (y0 + 1 + H) % H;
  const i00 = (ya * W + xa) * 3, i10 = (ya * W + xb) * 3, i01 = (yb * W + xa) * 3, i11 = (yb * W + xb) * 3;
  for (let k = 0; k < 3; k++) out[k] = ((d[i00 + k] * (1 - fx) + d[i10 + k] * fx) * (1 - fy) + (d[i01 + k] * (1 - fx) + d[i11 + k] * fx) * fy) / 255;
  return out;
}

/** Decoded material for drawing (textures decoded once per asset). */
export async function prepareMaterial(m, {maxTex = 2048} = {}) {
  if (!m) return {baseColorFactor: [0.7, 0.7, 0.7, 1], metallicFactor: 0, roughnessFactor: 1, normalScale: 1};
  return {...m, baseColorTex: await decodeTex(m.baseColor, maxTex), mrTex: await decodeTex(m.metallicRoughness, maxTex), normalTex: await decodeTex(m.normal, maxTex)};
}

// ------------------------------------------------------------------------------------------------------------------- raster
/**
 * Renders draws [{pos, nrm, uv, idx, mat (prepareMaterial), color? [lin r,g,b] (overrides texture), tint?: [r,g,b,a],
 * zBias?}] with camera `cam` (final resolution), supersampled by `ss`. Returns {rgb (Uint8 sRGB, final w x h), gbuf} via sharp.
 * opts: {mode: 'studio' | 'gameplay', floor: {y, half, grid}|null, contact: bool, bg, below: {tint [r,g,b], mix}}
 */
export async function render(draws, cam0, opts = {}) {
  const ss = opts.ss ?? 2;
  const cam = cam0.scaled(ss);
  const W = cam.w, H = cam.h, N = W * H;
  const depth = new Float32Array(N).fill(Infinity), did = new Int16Array(N).fill(-1), tri = new Int32Array(N), B1 = new Float32Array(N), B2 = new Float32Array(N);
  const near = 0.02;
  const prep = draws.map((dr, di) => {
    const n = dr.pos.length / 3, sx = new Float32Array(n), sy = new Float32Array(n), sd = new Float32Array(n);
    const {eye, r, u, f} = cam, k = cam.k, persp = cam.persp;
    for (let i = 0; i < n; i++) {
      const dx = dr.pos[i * 3] - eye[0], dy = dr.pos[i * 3 + 1] - eye[1], dz = dr.pos[i * 3 + 2] - eye[2];
      const x = dx * r[0] + dy * r[1] + dz * r[2], y = dx * u[0] + dy * u[1] + dz * u[2], z = dx * f[0] + dy * f[1] + dz * f[2];
      sd[i] = z;
      if (persp) { sx[i] = W / 2 + (x / z) * k; sy[i] = H / 2 - (y / z) * k; } else { sx[i] = W / 2 + x * k; sy[i] = H / 2 - y * k; }
    }
    const nt = dr.idx.length / 3, back = new Uint8Array(nt);
    const P = dr.pos, idx = dr.idx, zb = dr.zBias ?? 0;
    for (let t = 0; t < nt; t++) {
      const a = idx[t * 3], b = idx[t * 3 + 1], c = idx[t * 3 + 2];
      // world face normal vs the view ray -> back face flag (double-sided shading)
      const e1x = P[b * 3] - P[a * 3], e1y = P[b * 3 + 1] - P[a * 3 + 1], e1z = P[b * 3 + 2] - P[a * 3 + 2];
      const e2x = P[c * 3] - P[a * 3], e2y = P[c * 3 + 1] - P[a * 3 + 1], e2z = P[c * 3 + 2] - P[a * 3 + 2];
      const fnx = e1y * e2z - e1z * e2y, fny = e1z * e2x - e1x * e2z, fnz = e1x * e2y - e1y * e2x;
      const vx = persp ? P[a * 3] - eye[0] : f[0], vy = persp ? P[a * 3 + 1] - eye[1] : f[1], vz = persp ? P[a * 3 + 2] - eye[2] : f[2];
      back[t] = fnx * vx + fny * vy + fnz * vz > 0 ? 1 : 0;
      const ad = sd[a], bd = sd[b], cd = sd[c];
      if (ad < near || bd < near || cd < near) continue;
      const ax = sx[a], ay = sy[a], bx = sx[b], by = sy[b], cx = sx[c], cy = sy[c];
      const area = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
      if (Math.abs(area) < 1e-12) continue;
      const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx))), x1 = Math.min(W - 1, Math.ceil(Math.max(ax, bx, cx)));
      const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy))), y1 = Math.min(H - 1, Math.ceil(Math.max(ay, by, cy)));
      if (x0 > x1 || y0 > y1) continue;
      const inv = 1 / area;
      for (let y = y0; y <= y1; y++) {
        const qy = y + 0.5;
        for (let x = x0; x <= x1; x++) {
          const qx = x + 0.5;
          const l0 = ((bx - qx) * (cy - qy) - (cx - qx) * (by - qy)) * inv;
          const l1 = ((cx - qx) * (ay - qy) - (ax - qx) * (cy - qy)) * inv;
          const l2 = 1 - l0 - l1;
          if (l0 < -1e-7 || l1 < -1e-7 || l2 < -1e-7) continue;
          let z, p1, p2;
          if (persp) { const iw = l0 / ad + l1 / bd + l2 / cd; z = 1 / iw; p1 = (l1 / bd) * z; p2 = (l2 / cd) * z; } else { z = l0 * ad + l1 * bd + l2 * cd; p1 = l1; p2 = l2; }
          z -= zb;
          const o = y * W + x;
          if (z >= depth[o]) continue;
          depth[o] = z; did[o] = di; tri[o] = t; B1[o] = p1; B2[o] = p2;
        }
      }
    }
    return {back};
  });

  // ------------------------------------------------------------------ shading
  const mode = opts.mode ?? 'studio';
  const out = new Uint8Array(N * 3);
  const floor = opts.floor === undefined ? {y: 0, half: 2.5, grid: 0.5} : opts.floor;
  const edgeOn = floor && !cam.persp && Math.abs(cam.f[1]) < 1e-3;
  const contact = floor && opts.contact !== false ? contactMap(draws, floor.y) : null;
  const G = GAMEPLAY_LIGHT;
  const gp = mode === 'gameplay' ? gameplaySetup(cam) : null;
  const studio = mode === 'studio' ? studioSetup(cam) : null;
  const bgTop = opts.bgTop ?? [0.105, 0.11, 0.118], bgBot = opts.bgBot ?? [0.06, 0.063, 0.068];
  const belowTint = opts.belowTint ?? [0.95, 0.12, 0.75];
  const c = [0, 0, 0], tc = [0, 0, 0], mr = [0, 0, 0], nt = [0, 0, 0];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const o = y * W + x;
    // floor hit
    let fHit = false, fDepth = Infinity, fx = 0, fz = 0;
    if (floor && !edgeOn) {
      const ray = cam.ray(x + 0.5, y + 0.5);
      if (Math.abs(ray.d[1]) > 1e-6) {
        const tf = (floor.y - ray.o[1]) / ray.d[1];
        if (tf > 0) {
          fx = ray.o[0] + ray.d[0] * tf; fz = ray.o[2] + ray.d[2] * tf;
          if (Math.abs(fx) <= floor.half && Math.abs(fz) <= floor.half) { fHit = true; fDepth = dot(sub([fx, floor.y, fz], cam.eye), cam.f); }
        }
      }
    }
    const di = did[o];
    let r, g, b, lit = true;
    if (di >= 0) {
      const dr = draws[di], t = tri[o], b1 = B1[o], b2 = B2[o], b0 = 1 - b1 - b2;
      const ia = dr.idx[t * 3], ib = dr.idx[t * 3 + 1], ic = dr.idx[t * 3 + 2];
      const P = dr.pos, Nn = dr.nrm;
      const px = b0 * P[ia * 3] + b1 * P[ib * 3] + b2 * P[ic * 3], py = b0 * P[ia * 3 + 1] + b1 * P[ib * 3 + 1] + b2 * P[ic * 3 + 1], pz = b0 * P[ia * 3 + 2] + b1 * P[ib * 3 + 2] + b2 * P[ic * 3 + 2];
      let nx = b0 * Nn[ia * 3] + b1 * Nn[ib * 3] + b2 * Nn[ic * 3], ny = b0 * Nn[ia * 3 + 1] + b1 * Nn[ib * 3 + 1] + b2 * Nn[ic * 3 + 1], nz = b0 * Nn[ia * 3 + 2] + b1 * Nn[ib * 3 + 2] + b2 * Nn[ic * 3 + 2];
      let nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
      if (prep[di].back[t]) { nx = -nx; ny = -ny; nz = -nz; }
      const mat = dr.mat ?? {};
      let u = 0, v = 0;
      if (dr.uv) { u = b0 * dr.uv[ia * 2] + b1 * dr.uv[ib * 2] + b2 * dr.uv[ic * 2]; v = b0 * dr.uv[ia * 2 + 1] + b1 * dr.uv[ib * 2 + 1] + b2 * dr.uv[ic * 2 + 1]; }
      if (dr.color) { c[0] = dr.color[0]; c[1] = dr.color[1]; c[2] = dr.color[2]; } else if (mat.baseColorTex && dr.uv) {
        sample(mat.baseColorTex, u, v, tc);
        const bf = mat.baseColorFactor ?? [1, 1, 1, 1];
        c[0] = S2L[Math.round(tc[0] * 255)] * bf[0]; c[1] = S2L[Math.round(tc[1] * 255)] * bf[1]; c[2] = S2L[Math.round(tc[2] * 255)] * bf[2];
      } else { const bf = mat.baseColorFactor ?? [0.7, 0.7, 0.7]; c[0] = bf[0]; c[1] = bf[1]; c[2] = bf[2]; }
      let lr, lg, lb;
      if (gp) {
        let metal = mat.metallicFactor ?? 0, rough = mat.roughnessFactor ?? 1;
        if (mat.mrTex && dr.uv) { sample(mat.mrTex, u, v, mr); rough *= mr[1]; metal *= mr[2]; }
        if (mat.normalTex && dr.uv && !dr.color) {
          const tb = tangentOf(dr, t);
          if (tb) {
            sample(mat.normalTex, u, v, nt);
            const s = mat.normalScale ?? 1;
            const mx = (nt[0] * 2 - 1) * s, my = (nt[1] * 2 - 1) * s, mz = nt[2] * 2 - 1;
            // Gram-Schmidt against the interpolated normal; glTF: +Y of the map = -dP/dv (three.js derivative tangents)
            let Tx = tb[0], Ty = tb[1], Tz = tb[2];
            const tdn = Tx * nx + Ty * ny + Tz * nz; Tx -= nx * tdn; Ty -= ny * tdn; Tz -= nz * tdn;
            let tl = Math.hypot(Tx, Ty, Tz) || 1; Tx /= tl; Ty /= tl; Tz /= tl;
            let Bx = -tb[3], By = -tb[4], Bz = -tb[5];
            const bdn = Bx * nx + By * ny + Bz * nz; Bx -= nx * bdn; By -= ny * bdn; Bz -= nz * bdn;
            tl = Math.hypot(Bx, By, Bz) || 1; Bx /= tl; By /= tl; Bz /= tl;
            if (prep[di].back[t]) { /* flipped face: mirror the tangent frame with the normal */ Tx = -Tx; Ty = -Ty; Tz = -Tz; Bx = -Bx; By = -By; Bz = -Bz; }
            const qx = Tx * mx + Bx * my + nx * mz, qy = Ty * mx + By * my + ny * mz, qz = Tz * mx + Bz * my + nz * mz;
            nl = Math.hypot(qx, qy, qz) || 1; nx = qx / nl; ny = qy / nl; nz = qz / nl;
          }
        }
        [lr, lg, lb] = shadeGameplay(gp, px, py, pz, nx, ny, nz, c, metal, rough);
        [lr, lg, lb] = fogMix(gp, px, py, pz, lr, lg, lb);
      } else {
        [lr, lg, lb] = shadeStudio(studio, nx, ny, nz, c);
      }
      if (dr.tint) { const a = dr.tint[3]; lr = lr * (1 - a) + dr.tint[0] * a; lg = lg * (1 - a) + dr.tint[1] * a; lb = lb * (1 - a) + dr.tint[2] * a; }
      if (floor && py < floor.y - 0.003) { const a = gp ? 0.5 : 0.55, bt = gp ? belowTint.map(q => q * 0.25) : belowTint; lr = lr * (1 - a) + bt[0] * a; lg = lg * (1 - a) + bt[1] * a; lb = lb * (1 - a) + bt[2] * a; }
      if (fHit && fDepth < depth[o] - 1e-4) {
        const [fr, fg, fb] = floorColor(fx, fz, floor, contact, gp, studio);
        const a = 0.55; lr = fr * a + lr * (1 - a); lg = fg * a + lg * (1 - a); lb = fb * a + lb * (1 - a);
      }
      r = lr; g = lg; b = lb;
    } else if (fHit) {
      [r, g, b] = floorColor(fx, fz, floor, contact, gp, studio);
    } else if (edgeOn) {
      const ray = cam.ray(x + 0.5, y + 0.5);
      if (ray.o[1] < floor.y) { r = 0.045; g = 0.047; b = 0.05; if (gp) { r = g = b = 0.0; } } else { const k = y / H; r = bgTop[0] * (1 - k) + bgBot[0] * k; g = bgTop[1] * (1 - k) + bgBot[1] * k; b = bgTop[2] * (1 - k) + bgBot[2] * k; }
      if (gp && ray.o[1] >= floor.y) { [r, g, b] = gp.bg; }
      lit = false;
    } else if (gp) { [r, g, b] = gp.bg; lit = false; } else { const k = y / H; r = bgTop[0] * (1 - k) + bgBot[0] * k; g = bgTop[1] * (1 - k) + bgBot[1] * k; b = bgTop[2] * (1 - k) + bgBot[2] * k; }
    if (gp && lit) [r, g, b] = aces(r, g, b, G.exposure); // background colour is not tone-mapped (three.js clear colour)
    out[o * 3] = Math.round(l2s(r) * 255); out[o * 3 + 1] = Math.round(l2s(g) * 255); out[o * 3 + 2] = Math.round(l2s(b) * 255);
  }
  if (edgeOn) { // the floor line (2 px at final resolution)
    const sy = Math.round(cam.project([0, floor.y, 0])[1]);
    for (let yy = sy - ss; yy < sy + ss; yy++) if (yy >= 0 && yy < H) for (let x = 0; x < W; x++) { const o = (yy * W + x) * 3; out[o] = 215; out[o + 1] = 215; out[o + 2] = 205; }
  }
  const rgb = ss === 1 ? Buffer.from(out.buffer) : await sharp(Buffer.from(out.buffer), {raw: {width: W, height: H, channels: 3}}).resize(cam0.w, cam0.h, {kernel: 'lanczos3'}).raw().toBuffer();
  return {rgb, w: cam0.w, h: cam0.h, cam: cam0, depthAt: (px, py) => { const X = Math.min(W - 1, Math.max(0, Math.round(px * ss))), Y = Math.min(H - 1, Math.max(0, Math.round(py * ss))); return depth[Y * W + X]; }};
}

function tangentOf(dr, t) {
  dr._tan ??= new Map();
  let tb = dr._tan.get(t);
  if (tb !== undefined) return tb;
  const P = dr.pos, U = dr.uv, a = dr.idx[t * 3], b = dr.idx[t * 3 + 1], c = dr.idx[t * 3 + 2];
  const e1 = [P[b * 3] - P[a * 3], P[b * 3 + 1] - P[a * 3 + 1], P[b * 3 + 2] - P[a * 3 + 2]], e2 = [P[c * 3] - P[a * 3], P[c * 3 + 1] - P[a * 3 + 1], P[c * 3 + 2] - P[a * 3 + 2]];
  const du1 = U[b * 2] - U[a * 2], dv1 = U[b * 2 + 1] - U[a * 2 + 1], du2 = U[c * 2] - U[a * 2], dv2 = U[c * 2 + 1] - U[a * 2 + 1];
  const det = du1 * dv2 - du2 * dv1;
  if (Math.abs(det) < 1e-14) tb = null; else {
    const r = 1 / det;
    tb = [(e1[0] * dv2 - e2[0] * dv1) * r, (e1[1] * dv2 - e2[1] * dv1) * r, (e1[2] * dv2 - e2[2] * dv1) * r, (e2[0] * du1 - e1[0] * du2) * r, (e2[1] * du1 - e1[1] * du2) * r, (e2[2] * du1 - e1[2] * du2) * r];
  }
  dr._tan.set(t, tb);
  return tb;
}

function studioSetup(cam) {
  const {r, u, f} = cam;
  const vdir = (x, y, z) => norm([r[0] * x + u[0] * y - f[0] * z, r[1] * x + u[1] * y - f[1] * z, r[2] * x + u[2] * y - f[2] * z]);
  return {lights: [{d: vdir(-0.5, 0.62, 0.6), i: 0.95}, {d: vdir(0.75, 0.15, 0.45), i: 0.33}, {d: vdir(0.25, 0.55, -0.8), i: 0.28}], amb: 0.2, floorLight: 0.95 * Math.max(0, vdir(-0.5, 0.62, 0.6)[1]) + 0.2};
}
function shadeStudio(S, nx, ny, nz, c) {
  let k = S.amb + 0.06 * ny;
  for (const L of S.lights) { const d = nx * L.d[0] + ny * L.d[1] + nz * L.d[2]; if (d > 0) k += L.i * d; }
  return [c[0] * k, c[1] * k, c[2] * k];
}

function gameplaySetup(cam) {
  const G = GAMEPLAY_LIGHT, s = G.spot, {r, u, f, eye} = cam;
  const local = p => [eye[0] + r[0] * p[0] + u[0] * p[1] - f[0] * p[2], eye[1] + r[1] * p[0] + u[1] * p[1] - f[1] * p[2], eye[2] + r[2] * p[0] + u[2] * p[1] - f[2] * p[2]];
  const pos = local(s.localPos), tgt = local(s.localTarget);
  const col = hexLinear(s.color).map(v => v * s.intensity);
  return {pos, dir: norm(sub(tgt, pos)), col, coneCos: Math.cos(s.angle), penCos: Math.cos(s.angle * (1 - s.penumbra)), decay: s.decay, dist: s.distance,
    sky: hexLinear(G.hemi.sky).map(v => v * G.hemi.intensity), ground: hexLinear(G.hemi.ground).map(v => v * G.hemi.intensity), eye, fogCol: hexLinear(G.fog.color), fogD: G.fog.density, bg: hexLinear(G.background)};
}
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
function shadeGameplay(g, px, py, pz, nx, ny, nz, c, metal, rough) {
  let lx = g.pos[0] - px, ly = g.pos[1] - py, lz = g.pos[2] - pz;
  const d = Math.hypot(lx, ly, lz); lx /= d; ly /= d; lz /= d;
  let att = 1 / Math.max(d ** g.decay, 0.01); att *= (clamp01(1 - (d / g.dist) ** 4)) ** 2;
  att *= smooth(g.coneCos, g.penCos, -(lx * g.dir[0] + ly * g.dir[1] + lz * g.dir[2]));
  const ndl = Math.max(0, nx * lx + ny * ly + nz * lz);
  let vx = g.eye[0] - px, vy = g.eye[1] - py, vz = g.eye[2] - pz; const vl = Math.hypot(vx, vy, vz); vx /= vl; vy /= vl; vz /= vl;
  const diff = [c[0] * (1 - metal), c[1] * (1 - metal), c[2] * (1 - metal)];
  const f0 = [0.04 * (1 - metal) + c[0] * metal, 0.04 * (1 - metal) + c[1] * metal, 0.04 * (1 - metal) + c[2] * metal];
  // three.js BRDF_GGX (F_Schlick, V_GGX_SmithCorrelated, D_GGX); roughness clamped like three (>= 0.0525)
  const rgh = Math.max(rough, 0.0525), a2 = (rgh * rgh) ** 2;
  let hx = lx + vx, hy = ly + vy, hz = lz + vz; const hl = Math.hypot(hx, hy, hz) || 1; hx /= hl; hy /= hl; hz /= hl;
  const ndv = Math.max(1e-4, Math.abs(nx * vx + ny * vy + nz * vz)), ndh = clamp01(nx * hx + ny * hy + nz * hz), vdh = clamp01(lx * hx + ly * hy + lz * hz);
  const fres = (1 - vdh) ** 5;
  const gv = ndl * Math.sqrt(a2 + (1 - a2) * ndv * ndv), gl = ndv * Math.sqrt(a2 + (1 - a2) * ndl * ndl);
  const V = 0.5 / Math.max(gv + gl, 1e-6), D = a2 / (Math.PI * (ndh * ndh * (a2 - 1) + 1) ** 2);
  const out = [0, 0, 0];
  const w = 0.5 * ny + 0.5;
  for (let k = 0; k < 3; k++) {
    const irr = g.col[k] * att * ndl;
    const F = f0[k] + (1 - f0[k]) * fres;
    out[k] = irr * (diff[k] / Math.PI + F * V * D) + (g.ground[k] * (1 - w) + g.sky[k] * w) * diff[k] / Math.PI;
  }
  return out;
}
function fogMix(g, px, py, pz, r, gg, b) {
  const d = Math.hypot(px - g.eye[0], py - g.eye[1], pz - g.eye[2]);
  const ff = 1 - Math.exp(-((g.fogD * d) ** 2));
  return [r * (1 - ff) + g.fogCol[0] * ff, gg * (1 - ff) + g.fogCol[1] * ff, b * (1 - ff) + g.fogCol[2] * ff];
}
// three.js ACESFilmicToneMapping
function aces(r, g, b, exposure) {
  r *= exposure / 0.6; g *= exposure / 0.6; b *= exposure / 0.6;
  const ir = 0.59719 * r + 0.35458 * g + 0.04823 * b, ig = 0.076 * r + 0.90834 * g + 0.01566 * b, ib = 0.0284 * r + 0.13383 * g + 0.83777 * b;
  const fit = v => (v * (v + 0.0245786) - 0.000090537) / (v * (0.983729 * v + 0.432951) + 0.238081);
  const fr = fit(ir), fg = fit(ig), fb = fit(ib);
  return [clamp01(1.60475 * fr - 0.53108 * fg - 0.07367 * fb), clamp01(-0.10208 * fr + 1.10813 * fg - 0.00605 * fb), clamp01(-0.00327 * fr - 0.07276 * fg + 1.07602 * fb)];
}

function floorColor(x, z, floor, contact, gp, studio) {
  const gsz = floor.grid ?? 0.5;
  const gx = Math.abs(x / gsz - Math.round(x / gsz)) * gsz, gz = Math.abs(z / gsz - Math.round(z / gsz)) * gsz;
  const line = Math.min(gx, gz) < 0.006, axis = (Math.abs(x) < 0.008 || Math.abs(z) < 0.008);
  const occ = contact ? contact(x, z) : 1;
  if (gp) {
    const a = GAMEPLAY_LIGHT.floorAlbedo * (line ? 0.75 : 1);
    const col = shadeGameplay(gp, x, floor.y, z, 0, 1, 0, [a, a, a], 0, 0.9);
    const f = fogMix(gp, x, floor.y, z, col[0] * occ, col[1] * occ, col[2] * occ);
    return f;
  }
  const base = axis ? 0.16 : line ? 0.2 : 0.3;
  const k = (studio?.floorLight ?? 0.8) * occ;
  return [base * k * 0.98, base * k, base * k * 1.03];
}

/** Soft contact shading: darkens the floor under geometry that is close to it (top-down min height, 1 cm cells, blurred). */
function contactMap(draws, fy) {
  const R = 1.8, cell = 0.01, n = Math.round(2 * R / cell);
  const hmin = new Float32Array(n * n).fill(Infinity);
  for (const dr of draws) {
    if (dr.noContact) continue;
    const P = dr.pos;
    for (let i = 0; i < P.length; i += 3) {
      const ix = Math.floor((P[i] + R) / cell), iz = Math.floor((P[i + 2] + R) / cell);
      if (ix < 0 || iz < 0 || ix >= n || iz >= n) continue;
      const h = P[i + 1] - fy; const o = iz * n + ix; if (h < hmin[o]) hmin[o] = h;
    }
  }
  const occ = new Float32Array(n * n);
  for (let i = 0; i < n * n; i++) { const h = Math.max(0, hmin[i]); occ[i] = Number.isFinite(hmin[i]) ? Math.max(0, 1 - h / 0.35) : 0; }
  // separable box blur x2 (radius 4 cells)
  const tmp = new Float32Array(n * n), rad = 4;
  for (let pass = 0; pass < 2; pass++) {
    for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) { let s = 0, c = 0; for (let k = -rad; k <= rad; k++) { const xx = x + k; if (xx >= 0 && xx < n) { s += occ[z * n + xx]; c++; } } tmp[z * n + x] = s / c; }
    for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) { let s = 0, c = 0; for (let k = -rad; k <= rad; k++) { const zz = z + k; if (zz >= 0 && zz < n) { s += tmp[zz * n + x]; c++; } } occ[z * n + x] = s / c; }
  }
  return (x, z) => { const ix = Math.floor((x + R) / cell), iz = Math.floor((z + R) / cell); if (ix < 0 || iz < 0 || ix >= n || iz >= n) return 1; return 1 - 0.55 * Math.min(1, occ[iz * n + ix] * 1.4); };
}

// ------------------------------------------------------------------------------------------------------------------- composition
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export const FONT = 'DejaVu Sans, sans-serif';
/** SVG text helper. */
export function svgText(x, y, s, {size = 13, fill = '#e8e8e8', weight = 'normal', anchor = 'start', stroke = null} = {}) {
  const st = stroke ? ` stroke="${stroke}" stroke-width="3" paint-order="stroke"` : '';
  return `<text x="${x}" y="${y}" font-family="${FONT}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}"${st}>${esc(s)}</text>`;
}

/**
 * Composes rendered panels [{img (render result), title, lines?, tags?: [{world, text, color?}], overlaySvg?: string}] in a grid with
 * caption bars; optional sheet title / footer lines. Returns {buf (raw rgb), width, height, svg}. Encode with encode().
 */
export async function compose(panels, {cols = panels.length, title = '', subtitle = '', footer = [], capH = null, bg = [22, 23, 26], gap = 4} = {}) {
  const pw = Math.max(...panels.map(p => p.img.w)), ph = Math.max(...panels.map(p => p.img.h));
  const rows = Math.ceil(panels.length / cols);
  const Wd = cols * pw + (cols - 1) * gap;
  // wrap captions to the panel width (DejaVu Sans ~0.6 em average advance; bold ~0.66 em)
  const wp = panels.map(p => ({title: wrapText(p.title ?? '', pw - 14, 13, true), lines: (p.lines ?? []).flatMap(l => wrapText(l, pw - 14, 11.5))}));
  const titleL = title ? wrapText(title, Wd - 20, 16, true) : [], subL = subtitle ? wrapText(subtitle, Wd - 20, 12) : [], footL = footer.flatMap(l => wrapText(l, Wd - 20, 11.5));
  const maxCap = Math.max(0, ...wp.map(p => 17 * p.title.length + 15 * p.lines.length));
  const CAP = capH ?? (maxCap ? maxCap + 10 : 0);
  const TITLE = titleL.length || subL.length ? 10 + 20 * titleL.length + 16 * subL.length : 0, FOOT = footL.length ? 8 + 15 * footL.length : 0;
  const Hd = TITLE + rows * (ph + CAP) + (rows - 1) * gap + FOOT;
  const buf = Buffer.alloc(Wd * Hd * 3);
  for (let i = 0; i < Wd * Hd; i++) { buf[i * 3] = bg[0]; buf[i * 3 + 1] = bg[1]; buf[i * 3 + 2] = bg[2]; }
  const svg = [];
  titleL.forEach((l, j) => svg.push(svgText(10, 21 + 20 * j, l, {size: 16, weight: 'bold', fill: '#ffffff'})));
  subL.forEach((l, j) => svg.push(svgText(10, 21 + 20 * titleL.length - 2 + 16 * j + (titleL.length ? 0 : -2), l, {size: 12, fill: '#c8ccd2'})));
  panels.forEach((p, i) => {
    const ox = (i % cols) * (pw + gap), oy = TITLE + Math.floor(i / cols) * (ph + CAP + gap);
    for (let y = 0; y < p.img.h; y++) p.img.rgb.copy(buf, ((oy + y) * Wd + ox) * 3, y * p.img.w * 3, (y + 1) * p.img.w * 3);
    svg.push(`<g transform="translate(${ox},${oy})">`);
    for (const tg of p.tags ?? []) svg.push(tagSvg(p.img, tg));
    if (p.overlaySvg) svg.push(p.overlaySvg);
    svg.push('</g>');
    let yy = oy + ph + 17;
    for (const l of wp[i].title) { svg.push(svgText(ox + 8, yy, l, {size: 13, weight: 'bold', fill: '#ffffff'})); yy += 17; }
    yy -= 1;
    for (const l of wp[i].lines) { svg.push(svgText(ox + 8, yy, l, {size: 11.5, fill: '#c9cdd3'})); yy += 15; }
  });
  footL.forEach((l, j) => svg.push(svgText(10, Hd - FOOT + 18 + j * 15, l, {size: 11.5, fill: '#aeb4bb'})));
  return {buf, width: Wd, height: Hd, svg: svg.join('')};
}

/** Greedy word wrap by an estimated advance (no font metrics available without a browser). */
export function wrapText(s, maxW, size, bold = false) {
  if (!s) return [];
  const max = Math.max(10, Math.floor(maxW / (size * (bold ? 0.66 : 0.6))));
  const out = [];
  let cur = '';
  for (const w of String(s).split(' ')) {
    if (!cur) cur = w; else if ((cur + ' ' + w).length <= max) cur += ' ' + w; else { out.push(cur); cur = w; }
    while (cur.length > max) { out.push(cur.slice(0, max)); cur = cur.slice(max); }
  }
  if (cur) out.push(cur);
  return out;
}

/** Tag: dot at a projected world point (hollow when occluded) + leader + label pushed toward the nearer panel edge. */
function tagSvg(img, tg) {
  const [sx, sy, sd] = img.cam.project(tg.world);
  if (!(sx >= 0 && sx <= img.w && sy >= 0 && sy <= img.h)) return '';
  const visible = sd <= img.depthAt(sx, sy) + 0.02;
  const col = tg.color ?? '#ffe14a';
  const dir = tg.dir ?? (sx < img.w / 2 ? -1 : 1);
  const lx = tg.x ?? (dir < 0 ? 10 : img.w - 10), ly = sy + (tg.dy ?? 0);
  const anchor = dir < 0 ? 'start' : 'end';
  return `<line x1="${sx.toFixed(1)}" y1="${sy.toFixed(1)}" x2="${(dir < 0 ? lx + 4 : lx - 4).toFixed(1)}" y2="${(ly + 4).toFixed(1)}" stroke="${col}" stroke-width="1.2" stroke-opacity="0.85"/>`
    + `<circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="3.5" fill="${visible ? col : 'none'}" stroke="${col}" stroke-width="1.5"/>`
    + svgText(lx, ly, tg.text, {size: 12, weight: 'bold', fill: col, anchor, stroke: '#111'});
}

/** Encodes a composed sheet to a file (jpeg | png | webp by extension). */
export async function encode(sheet, file, {quality = 86} = {}) {
  let s = sharp(sheet.buf, {raw: {width: sheet.width, height: sheet.height, channels: 3}});
  if (sheet.svg) s = s.composite([{input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${sheet.width}" height="${sheet.height}">${sheet.svg}</svg>`), top: 0, left: 0}]);
  if (file.endsWith('.png')) s = s.png({compressionLevel: 9});
  else if (file.endsWith('.webp')) s = s.webp({quality});
  else s = s.jpeg({quality, chromaSubsampling: '4:4:4', mozjpeg: true});
  const info = await s.toFile(file);
  return {file, width: info.width, height: info.height, bytes: info.size};
}

/** Flattens a composed sheet (svg burned in) to raw rgb (for animation frames). */
export async function flatten(sheet) {
  const s = sharp(sheet.buf, {raw: {width: sheet.width, height: sheet.height, channels: 3}}).composite([{input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${sheet.width}" height="${sheet.height}">${sheet.svg}</svg>`), top: 0, left: 0}]);
  return s.removeAlpha().raw().toBuffer();
}
