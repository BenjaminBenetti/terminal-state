// Minimal deterministic CPU rasteriser for QA contact sheets (no GPU, no browser):
// orthographic camera rotated about Y, z-buffer, smooth Lambert + ambient shading, bilinear
// base-colour texture sampling, no back-face culling (garment interiors stay visible).
import {MeshoptSimplifier} from 'meshoptimizer';

/** Smooth normals that ignore UV seams: accumulate face normals per welded position. */
export function seamlessNormals(pos, idx) {
  const remap = MeshoptSimplifier.generatePositionRemap(pos, 3);
  const n = pos.length / 3, acc = new Float32Array(n * 3);
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const e1 = [pos[b] - pos[a], pos[b + 1] - pos[a + 1], pos[b + 2] - pos[a + 2]], e2 = [pos[c] - pos[a], pos[c + 1] - pos[a + 1], pos[c + 2] - pos[a + 2]];
    const nx = e1[1] * e2[2] - e1[2] * e2[1], ny = e1[2] * e2[0] - e1[0] * e2[2], nz = e1[0] * e2[1] - e1[1] * e2[0];
    for (const v of [idx[t], idx[t + 1], idx[t + 2]]) { const r = remap[v] * 3; acc[r] += nx; acc[r + 1] += ny; acc[r + 2] += nz; }
  }
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { const r = remap[i] * 3; const l = Math.hypot(acc[r], acc[r + 1], acc[r + 2]) || 1; out[i * 3] = acc[r] / l; out[i * 3 + 1] = acc[r + 1] / l; out[i * 3 + 2] = acc[r + 2] / l; }
  return out;
}

export class Canvas {
  constructor(w, h, bg = [38, 38, 42]) {
    this.w = w; this.h = h;
    this.rgb = new Uint8Array(w * h * 3);
    for (let i = 0; i < w * h; i++) this.rgb.set(bg, i * 3);
    this.z = new Float32Array(w * h).fill(-Infinity);
  }
  /**
   * @param mesh {pos, idx, uv?, nrm?, tex?: {data (RGBA), width, height}, color?: [r,g,b] 0..255, tint?}
   * @param cam {yawDeg (0 = looking at the +Z face), cx, cy (world point at image centre), height (world metres spanning the image height)}
   */
  draw(mesh, cam) {
    const {w, h} = this;
    const th = (cam.yawDeg || 0) * Math.PI / 180, cs = Math.cos(th), sn = Math.sin(th);
    const k = h / cam.height;
    const P = mesh.pos, n = P.length / 3;
    const sx = new Float32Array(n), sy = new Float32Array(n), sz = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      // rotate the model by -yaw about Y so the camera sees the side at yaw
      const x = P[i * 3] - (cam.cx || 0), y = P[i * 3 + 1] - cam.cy, z = P[i * 3 + 2] - (cam.cz || 0);
      const xr = cs * x - sn * z, zr = sn * x + cs * z;
      sx[i] = w / 2 + xr * k; sy[i] = h / 2 - y * k; sz[i] = zr;
    }
    const N = mesh.nrm || seamlessNormals(P, mesh.idx);
    const light = norm([-0.35 * cs + 0.75 * sn, 0.55, 0.35 * sn + 0.75 * cs].map(v => v)); // key light from upper-front-left of the camera
    const lw = norm([-0.35, 0.55, 0.75]);
    const shade = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const nx = cs * N[i * 3] - sn * N[i * 3 + 2], ny = N[i * 3 + 1], nz = sn * N[i * 3] + cs * N[i * 3 + 2];
      const d = Math.abs(nx * lw[0] + ny * lw[1] + nz * lw[2]); // two-sided
      shade[i] = 0.38 + 0.72 * d;
    }
    void light;
    const tex = mesh.tex, uv = mesh.uv, col = mesh.color || [180, 180, 180], idx = mesh.idx;
    // mesh.cullBack (iteration 06): skip back faces like the game's single-sided materials do
    const cullSign = mesh.cullBack ? (mesh.cullSign ?? 1) : 0;
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t], b = idx[t + 1], c = idx[t + 2];
      const ax = sx[a], ay = sy[a], bx = sx[b], by = sy[b], cx = sx[c], cy = sy[c];
      const area = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
      if (Math.abs(area) < 1e-9) continue;
      if (cullSign && area * cullSign > 0) continue;
      const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx))), x1 = Math.min(w - 1, Math.ceil(Math.max(ax, bx, cx)));
      const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy))), y1 = Math.min(h - 1, Math.ceil(Math.max(ay, by, cy)));
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const qx = x + 0.5, qy = y + 0.5;
        const w0 = ((bx - qx) * (cy - qy) - (cx - qx) * (by - qy)) / area;
        const w1 = ((cx - qx) * (ay - qy) - (ax - qx) * (cy - qy)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
        const z = w0 * sz[a] + w1 * sz[b] + w2 * sz[c] + (mesh.zBias || 0);
        const o = y * w + x;
        if (z <= this.z[o]) continue;
        this.z[o] = z;
        if (mesh.mark) (this.mark ??= new Uint8Array(w * h))[o] = mesh.mark;
        let r = col[0], g = col[1], bl = col[2];
        if (tex && uv) {
          const u = w0 * uv[a * 2] + w1 * uv[b * 2] + w2 * uv[c * 2], v = w0 * uv[a * 2 + 1] + w1 * uv[b * 2 + 1] + w2 * uv[c * 2 + 1];
          [r, g, bl] = sample(tex, u, v);
        }
        const s = w0 * shade[a] + w1 * shade[b] + w2 * shade[c];
        this.rgb[o * 3] = Math.min(255, r * s); this.rgb[o * 3 + 1] = Math.min(255, g * s); this.rgb[o * 3 + 2] = Math.min(255, bl * s);
      }
    }
  }
}

function norm(a) { const l = Math.hypot(...a) || 1; return a.map(x => x / l); }

function sample(tex, u, v) {
  const W = tex.width, H = tex.height, d = tex.data, ch = tex.channels || 4;
  let x = (u - Math.floor(u)) * W - 0.5, y = (v - Math.floor(v)) * H - 0.5;
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  const px = (xx, yy) => { xx = (xx + W) % W; yy = (yy + H) % H; return (yy * W + xx) * ch; };
  const i00 = px(x0, y0), i10 = px(x0 + 1, y0), i01 = px(x0, y0 + 1), i11 = px(x0 + 1, y0 + 1);
  const out = [0, 0, 0];
  for (let k = 0; k < 3; k++) out[k] = (d[i00 + k] * (1 - fx) + d[i10 + k] * fx) * (1 - fy) + (d[i01 + k] * (1 - fx) + d[i11 + k] * fx) * fy;
  return out;
}
