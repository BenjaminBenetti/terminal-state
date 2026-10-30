// CPU preview of the first-person viewmodel overlay (render/overlay.ts) for Node tests — no WebGL / WebGPU.
//
// Renders a THREE scene graph with the real PerspectiveCamera (its projection matrix, near plane and aspect), so the framing
// matches the game's viewmodel camera exactly: perspective-correct UV / normal / vertex-colour interpolation, z-buffer,
// near-plane clipping, FrontSide / BackSide / DoubleSide culling (back faces flip their normal), the scene's own
// HemisphereLight / DirectionalLight / PointLight intensities (three's 1/pi Lambert + a GGX highlight for punctual lights;
// metalness / roughness factors, no maps for them), map / emissiveMap / vertex colours / opacity, depthWrite / depthTest,
// transparent objects sorted like three (renderOrder, then back to front) with normal blending into a premultiplied RGBA
// target. The result is composited over a display-referred background like OverlayPass: covered pixels are ACES-tone-mapped
// (renderer exposure) + sRGB-encoded, then laid over the frame with (1 - alpha).
//
// Approximate on purpose (no shadows, no environment / indirect specular, no custom TSL colour graphs, no MSAA): it shows framing,
// coverage, silhouettes, relative brightness and the lens tint. It is NOT GPU evidence.
import * as THREE from 'three';

type V3 = [number, number, number];

export interface OverlayRenderOpts {
  width: number;
  height: number;
  /** Display-referred background (sRGB 0..1, W*H*3, row 0 = top); default a mid-grey test card. */
  background?: Float32Array;
  /** Renderer toneMappingExposure (game: MOOD.exposure 0.78). */
  exposure?: number;
}

export interface OverlayRender {
  /** Final display RGB (W*H*3 bytes, row 0 = top). */
  rgb: Buffer;
  /** Overlay coverage alpha per pixel (0 = the world shows through untouched). */
  alpha: Float32Array;
  /** View-space depth (m, positive) of the nearest depth-writing viewmodel surface per pixel (Infinity = none). */
  depth: Float32Array;
  /** Meshes with custom node-material colour graphs that this preview cannot shade (not drawn). */
  skipped: string[];
}

interface Tex { w: number; h: number; d: ArrayLike<number>; flipY: boolean; srgb: boolean; repeat: boolean; scale: number }
const texCache = new WeakMap<THREE.Texture, Tex | null>();
function texOf(t: THREE.Texture | null | undefined): Tex | null {
  if (!t) return null;
  if (texCache.has(t)) return texCache.get(t)!;
  const img = t.image as {width: number; height: number; data?: ArrayLike<number>} | undefined;
  const d = img?.data;
  const r = d && img ? {w: img.width, h: img.height, d, flipY: t.flipY, srgb: t.colorSpace === THREE.SRGBColorSpace, repeat: t.wrapS === THREE.RepeatWrapping, scale: d instanceof Float32Array ? 1 : 1 / 255} : null;
  texCache.set(t, r);
  return r;
}
const s2l = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const l2s = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
/** Bilinear sample, linear RGBA out (sRGB textures decoded). */
function sample(t: Tex, u: number, v: number, out: number[]): void {
  if (t.repeat) { u -= Math.floor(u); v -= Math.floor(v); } else { u = Math.min(1, Math.max(0, u)); v = Math.min(1, Math.max(0, v)); }
  const fx = u * t.w - 0.5, fy = (t.flipY ? 1 - v : v) * t.h - 0.5;
  const x0 = Math.floor(fx), y0 = Math.floor(fy), ax = fx - x0, ay = fy - y0;
  const cx = (x: number) => (t.repeat ? ((x % t.w) + t.w) % t.w : Math.min(t.w - 1, Math.max(0, x)));
  const cy = (y: number) => (t.repeat ? ((y % t.h) + t.h) % t.h : Math.min(t.h - 1, Math.max(0, y)));
  const xa = cx(x0), xb = cx(x0 + 1), ya = cy(y0), yb = cy(y0 + 1);
  for (let k = 0; k < 4; k++) {
    const p = (x: number, y: number) => t.d[(y * t.w + x) * 4 + k] * t.scale;
    const val = (p(xa, ya) * (1 - ax) + p(xb, ya) * ax) * (1 - ay) + (p(xa, yb) * (1 - ax) + p(xb, yb) * ax) * ay;
    out[k] = k < 3 && t.srgb ? s2l(val) : val;
  }
}

// three's ACESFilmicToneMapping (r150+), column-major matrices as in the GLSL / TSL source
function aces(c: V3, exposure: number): V3 {
  const e = exposure / 0.6;
  const r = c[0] * e, g = c[1] * e, b = c[2] * e;
  const i: V3 = [0.59719 * r + 0.35458 * g + 0.04823 * b, 0.076 * r + 0.90834 * g + 0.01566 * b, 0.0284 * r + 0.13383 * g + 0.83777 * b];
  const f = i.map(v => (v * (v + 0.0245786) - 0.000090537) / (v * (0.983729 * v + 0.432951) + 0.238081)) as V3;
  const o: V3 = [1.60475 * f[0] - 0.53108 * f[1] - 0.07367 * f[2], -0.10208 * f[0] + 1.10813 * f[1] - 0.00605 * f[2], -0.00327 * f[0] - 0.07276 * f[1] + 1.07602 * f[2]];
  return o.map(v => Math.min(1, Math.max(0, v))) as V3;
}

interface Light { kind: 'hemi' | 'dir' | 'point'; color: V3; ground?: V3; dir?: V3; pos?: V3; intensity: number; distance?: number; decay?: number }

/** Display-referred test card: dark green-grey room tones with a lit doorway, bright window, floor line and a grid. */
export function testCard(W: number, H: number): Float32Array {
  const bg = new Float32Array(W * H * 3);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const u = x / W, v = y / H, k = (y * W + x) * 3;
    let c: V3 = v > 0.62 ? [0.16, 0.16, 0.14] : [0.27, 0.3, 0.27]; // floor / wall
    if (u > 0.38 && u < 0.62 && v > 0.18 && v < 0.62) c = [0.55, 0.6, 0.52]; // lit doorway
    if (u > 0.08 && u < 0.24 && v > 0.12 && v < 0.4) c = [0.85, 0.88, 0.82]; // bright window
    if ((x % Math.round(W / 16)) < 1 || (y % Math.round(H / 9)) < 1) c = c.map(q => q * 0.6) as V3; // grid
    bg[k] = c[0]; bg[k + 1] = c[1]; bg[k + 2] = c[2];
  }
  return bg;
}

/** Render `scene` (only visible objects) through `camera` like OverlayPass over `background`. */
export function renderOverlay(scene: THREE.Object3D, camera: THREE.PerspectiveCamera, opt: OverlayRenderOpts): OverlayRender {
  const W = opt.width, H = opt.height, exposure = opt.exposure ?? 0.78;
  scene.updateMatrixWorld(true);
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();
  const view = camera.matrixWorldInverse.clone();
  const proj = camera.projectionMatrix;
  const near = camera.near;
  // lights (view space)
  const lights: Light[] = [];
  const nm3 = new THREE.Matrix3().getNormalMatrix(view);
  scene.traverseVisible(o => {
    const L = o as THREE.Light;
    if (!L.isLight || L.intensity <= 0) return;
    const col = (c: THREE.Color): V3 => [c.r, c.g, c.b];
    if ((L as THREE.HemisphereLight).isHemisphereLight) {
      const up = new THREE.Vector3().setFromMatrixPosition(L.matrixWorld).normalize().applyMatrix3(nm3).normalize();
      lights.push({kind: 'hemi', color: col(L.color), ground: col((L as THREE.HemisphereLight).groundColor), dir: [up.x, up.y, up.z], intensity: L.intensity});
    } else if ((L as THREE.DirectionalLight).isDirectionalLight) {
      const d = L as THREE.DirectionalLight;
      const p = new THREE.Vector3().setFromMatrixPosition(d.matrixWorld), t = new THREE.Vector3().setFromMatrixPosition(d.target.matrixWorld);
      const dir = p.sub(t).normalize().applyMatrix3(nm3).normalize();
      lights.push({kind: 'dir', color: col(L.color), dir: [dir.x, dir.y, dir.z], intensity: L.intensity});
    } else if ((L as THREE.PointLight).isPointLight) {
      const p = new THREE.Vector3().setFromMatrixPosition(L.matrixWorld).applyMatrix4(view);
      lights.push({kind: 'point', color: col(L.color), pos: [p.x, p.y, p.z], intensity: L.intensity, distance: (L as THREE.PointLight).distance, decay: (L as THREE.PointLight).decay});
    }
  });
  const acc = new Float32Array(W * H * 4); // premultiplied linear RGBA (the overlay target, cleared to 0)
  const zb = new Float32Array(W * H).fill(Infinity);
  const meshes: THREE.Mesh[] = [];
  scene.traverseVisible(o => { const m = o as THREE.Mesh; if (m.isMesh && !Array.isArray(m.material) && (m.material as THREE.Material).visible !== false) meshes.push(m); });
  const opaque = meshes.filter(m => !(m.material as THREE.Material).transparent);
  const transparent = meshes.filter(m => (m.material as THREE.Material).transparent);
  const zOf = (m: THREE.Mesh) => new THREE.Vector3().setFromMatrixPosition(m.matrixWorld).applyMatrix4(view).z;
  opaque.sort((a, b) => a.renderOrder - b.renderOrder);
  transparent.sort((a, b) => a.renderOrder - b.renderOrder || zOf(a) - zOf(b)); // farther (more negative z) first
  const px = [0, 0, 0, 0], ex = [0, 0, 0, 0];
  const skipped: string[] = [];
  for (const mesh of [...opaque, ...transparent]) drawMesh(mesh);

  function drawMesh(mesh: THREE.Mesh): void {
    const mat = mesh.material as THREE.MeshStandardMaterial & THREE.MeshBasicMaterial;
    const g = mesh.geometry, P = g.attributes.position, N = g.attributes.normal, UV = g.attributes.uv, C = g.attributes.color;
    if (!P) return;
    const mv = new THREE.Matrix4().multiplyMatrices(view, mesh.matrixWorld);
    const nmat = new THREE.Matrix3().getNormalMatrix(mv);
    const flip = mv.determinant() < 0;
    const lit = !!mat.isMeshStandardMaterial;
    const map = texOf(mat.map), emap = texOf(mat.emissiveMap);
    const base: V3 = [mat.color.r, mat.color.g, mat.color.b];
    const emis: V3 = mat.emissive ? [mat.emissive.r * mat.emissiveIntensity, mat.emissive.g * mat.emissiveIntensity, mat.emissive.b * mat.emissiveIntensity] : [0, 0, 0];
    const useVC = !!mat.vertexColors && !!C;
    const metal = lit ? mat.metalness : 0, rough = lit ? Math.max(0.04, mat.roughness) : 1;
    const opacity = mat.opacity ?? 1, alphaTest = mat.alphaTest ?? 0;
    const blend = !!mat.transparent, depthWrite = mat.depthWrite !== false, depthTest = mat.depthTest !== false;
    // depth-only meshes (colorWrite false, e.g. the rifle optic's lens mask) write depth only; node materials with their own
    // colour graph (e.g. the optic lens) cannot be evaluated here: they are skipped (reported as `skipped`)
    const colour = mat.colorWrite !== false;
    const custom = !!(mat as unknown as {isNodeMaterial?: boolean}).isNodeMaterial && !!(mat as unknown as {colorNode?: unknown}).colorNode;
    if (custom) { skipped.push(mesh.name || mat.name || mesh.uuid); return; }
    const side = mat.side;
    const idx = g.index;
    const triCount = (idx ? idx.count : P.count) / 3;
    const range = g.drawRange;
    const t0 = Math.floor(range.start / 3), t1 = Math.min(triCount, range.count === Infinity ? triCount : Math.floor((range.start + range.count) / 3));
    const tmp = new THREE.Vector3();
    const vtx = (i: number) => {
      tmp.fromBufferAttribute(P, i).applyMatrix4(mv);
      const p: V3 = [tmp.x, tmp.y, tmp.z];
      let n: V3 = [0, 0, 1];
      if (N) { tmp.fromBufferAttribute(N, i).applyMatrix3(nmat).normalize(); n = [tmp.x, tmp.y, tmp.z]; }
      return {p, n, uv: (UV ? [UV.getX(i), UV.getY(i)] : [0, 0]) as [number, number], c: (useVC ? [C.getX(i), C.getY(i), C.getZ(i)] : [1, 1, 1]) as V3};
    };
    type Vt = ReturnType<typeof vtx>;
    for (let t = t0; t < t1; t++) {
      const ia = idx ? idx.getX(t * 3) : t * 3, ib = idx ? idx.getX(t * 3 + 1) : t * 3 + 1, ic = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
      let poly: Vt[] = [vtx(ia), vtx(ib), vtx(ic)];
      if (poly.every(v => v.p[2] > -near)) continue;
      // facing in view space (camera at the origin): front when the winding is CCW seen from the eye
      const a = poly[0].p, b = poly[1].p, c = poly[2].p;
      const gn = cross(sub(b, a), sub(c, a));
      let front = dot(gn, a) < 0;
      if (flip) front = !front;
      if (side === THREE.FrontSide && !front) continue;
      if (side === THREE.BackSide && front) continue;
      const nsign = front ? 1 : -1;
      if (poly.some(v => v.p[2] > -near)) poly = clipNear(poly, near);
      for (let j = 1; j + 1 < poly.length; j++) raster(poly[0], poly[j], poly[j + 1], nsign);
    }

    function raster(A: Vt, B: Vt, Cc: Vt, nsign: number): void {
      const tri = [A, B, Cc];
      const s = tri.map(v => {
        const q = new THREE.Vector4(v.p[0], v.p[1], v.p[2], 1).applyMatrix4(proj);
        return [(q.x / q.w * 0.5 + 0.5) * W, (1 - (q.y / q.w * 0.5 + 0.5)) * H, 1 / q.w];
      });
      const den = (s[1][1] - s[2][1]) * (s[0][0] - s[2][0]) + (s[2][0] - s[1][0]) * (s[0][1] - s[2][1]);
      if (Math.abs(den) < 1e-12) return;
      const x0 = Math.max(0, Math.floor(Math.min(s[0][0], s[1][0], s[2][0]))), x1 = Math.min(W - 1, Math.ceil(Math.max(s[0][0], s[1][0], s[2][0])));
      const y0 = Math.max(0, Math.floor(Math.min(s[0][1], s[1][1], s[2][1]))), y1 = Math.min(H - 1, Math.ceil(Math.max(s[0][1], s[1][1], s[2][1])));
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const w0 = ((s[1][1] - s[2][1]) * (x + 0.5 - s[2][0]) + (s[2][0] - s[1][0]) * (y + 0.5 - s[2][1])) / den;
        const w1 = ((s[2][1] - s[0][1]) * (x + 0.5 - s[2][0]) + (s[0][0] - s[2][0]) * (y + 0.5 - s[2][1])) / den;
        const w2 = 1 - w0 - w1;
        if (w0 < -1e-9 || w1 < -1e-9 || w2 < -1e-9) continue;
        const q0 = w0 * s[0][2], q1 = w1 * s[1][2], q2 = w2 * s[2][2], qs = q0 + q1 + q2;
        const L = (va: number, vb: number, vc: number) => (va * q0 + vb * q1 + vc * q2) / qs;
        const pz = L(A.p[2], B.p[2], Cc.p[2]);
        const depth = -pz;
        const k = y * W + x;
        if (depthTest && depth > zb[k] + 1e-7) continue;
        if (!colour) { if (depthWrite) zb[k] = depth; continue; }
        const u = L(A.uv[0], B.uv[0], Cc.uv[0]), v = L(A.uv[1], B.uv[1], Cc.uv[1]);
        if (map) sample(map, u, v, px); else { px[0] = px[1] = px[2] = px[3] = 1; }
        const alpha = px[3] * opacity;
        if (alphaTest > 0 && alpha < alphaTest) continue;
        const vc = [L(A.c[0], B.c[0], Cc.c[0]), L(A.c[1], B.c[1], Cc.c[1]), L(A.c[2], B.c[2], Cc.c[2])];
        const alb: V3 = [px[0] * base[0] * vc[0], px[1] * base[1] * vc[1], px[2] * base[2] * vc[2]];
        let out: V3;
        if (lit) {
          const p: V3 = [L(A.p[0], B.p[0], Cc.p[0]), L(A.p[1], B.p[1], Cc.p[1]), pz];
          const n = norm([L(A.n[0], B.n[0], Cc.n[0]) * nsign, L(A.n[1], B.n[1], Cc.n[1]) * nsign, L(A.n[2], B.n[2], Cc.n[2]) * nsign]);
          const vdir = norm([-p[0], -p[1], -p[2]]);
          out = shade(alb, n, vdir, p, metal, rough);
        } else out = alb;
        if (emap) sample(emap, u, v, ex); else { ex[0] = ex[1] = ex[2] = 1; }
        out = [out[0] + emis[0] * ex[0], out[1] + emis[1] * ex[1], out[2] + emis[2] * ex[2]];
        const o = k * 4;
        if (blend) {
          for (let i = 0; i < 3; i++) acc[o + i] = out[i] * alpha + acc[o + i] * (1 - alpha);
          acc[o + 3] = alpha + acc[o + 3] * (1 - alpha);
        } else {
          acc[o] = out[0]; acc[o + 1] = out[1]; acc[o + 2] = out[2]; acc[o + 3] = 1;
        }
        if (depthWrite) zb[k] = depth;
      }
    }
  }

  function shade(alb: V3, n: V3, vdir: V3, p: V3, metal: number, rough: number): V3 {
    const diff: V3 = [alb[0] * (1 - metal) / Math.PI, alb[1] * (1 - metal) / Math.PI, alb[2] * (1 - metal) / Math.PI];
    const f0: V3 = [0.04 + (alb[0] - 0.04) * metal, 0.04 + (alb[1] - 0.04) * metal, 0.04 + (alb[2] - 0.04) * metal];
    const out: V3 = [0, 0, 0];
    for (const l of lights) {
      if (l.kind === 'hemi') {
        const k = 0.5 * dot(n, l.dir!) + 0.5;
        for (let i = 0; i < 3; i++) out[i] += diff[i] * (l.ground![i] + (l.color[i] - l.ground![i]) * k) * l.intensity;
        continue;
      }
      let ldir: V3, irr: number;
      if (l.kind === 'dir') { ldir = l.dir!; irr = l.intensity; } else {
        const d = sub(l.pos!, p), dist = Math.hypot(d[0], d[1], d[2]);
        ldir = norm(d);
        let att = 1 / Math.max(Math.pow(dist, l.decay ?? 2), 0.01);
        if ((l.distance ?? 0) > 0) att *= Math.pow(Math.min(1, Math.max(0, 1 - Math.pow(dist / l.distance!, 4))), 2);
        irr = l.intensity * att;
      }
      const ndl = Math.max(0, dot(n, ldir));
      if (ndl <= 0) continue;
      const h = norm([ldir[0] + vdir[0], ldir[1] + vdir[1], ldir[2] + vdir[2]]);
      const ndh = Math.max(0, dot(n, h)), ndv = Math.max(1e-4, dot(n, vdir)), vdh = Math.max(0, dot(vdir, h));
      const a2 = Math.pow(rough, 4);
      const D = a2 / (Math.PI * Math.pow(ndh * ndh * (a2 - 1) + 1, 2));
      const gv = 0.5 / (ndl * Math.sqrt(a2 + (1 - a2) * ndv * ndv) + ndv * Math.sqrt(a2 + (1 - a2) * ndl * ndl) + 1e-6);
      const fw = Math.pow(1 - vdh, 5);
      for (let i = 0; i < 3; i++) {
        const F = f0[i] + (1 - f0[i]) * fw;
        out[i] += (diff[i] + F * gv * D) * l.color[i] * irr * ndl;
      }
    }
    return out;
  }

  // composite like OverlayPass: covered pixels tone-map their straight colour (x alpha); the frame shows through (1 - alpha)
  const bg = opt.background ?? testCard(W, H);
  const rgb = Buffer.alloc(W * H * 3);
  const alpha = new Float32Array(W * H);
  for (let k = 0; k < W * H; k++) {
    const a = Math.min(1, acc[k * 4 + 3]);
    alpha[k] = a;
    let c: V3 = [0, 0, 0];
    if (a > 1e-4) {
      const t = aces([acc[k * 4] / a, acc[k * 4 + 1] / a, acc[k * 4 + 2] / a], exposure);
      c = [l2s(t[0]) * a, l2s(t[1]) * a, l2s(t[2]) * a];
    }
    for (let i = 0; i < 3; i++) rgb[k * 3 + i] = Math.max(0, Math.min(255, Math.round((c[i] + bg[k * 3 + i] * (1 - a)) * 255)));
  }
  return {rgb, alpha, depth: zb, skipped};
}

function clipNear<T extends {p: V3; n: V3; uv: [number, number]; c: V3}>(poly: T[], near: number): T[] {
  const out: T[] = [];
  const inside = (v: T) => v.p[2] <= -near;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    if (inside(a)) out.push(a);
    if (inside(a) !== inside(b)) {
      const t = (-near - a.p[2]) / (b.p[2] - a.p[2]);
      const lerp = <A extends number[]>(x: A, y: A) => x.map((v, j) => v + (y[j] - v) * t) as A;
      out.push({...a, p: lerp(a.p, b.p), n: lerp(a.n, b.n), uv: lerp(a.uv, b.uv), c: lerp(a.c, b.c)});
    }
  }
  return out;
}

const dot = (a: readonly number[], b: readonly number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: readonly number[], b: readonly number[]): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: readonly number[], b: readonly number[]): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
