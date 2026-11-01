// Terminal State - STRAINER texture QA renderer (task studio-alpha-bts-round4-compliance-followup-20261101-01, lane TEXTURE).
// Internal CPU diagnostics only (no GPU / browser; renders never committed). Orthographic camera about Y like
// zombie/lib/raster.mjs, z-buffer, double-sided, per-pixel lighting with the GLB's own maps:
//   base colour (bilinear), tangent-space normal map with the glTF / three.js derivative-tangent convention
//   (T = dP/du, normal-map +Y along -dP/dv, i.e. toward decreasing v = image up; three's GLTFLoader negates normalScale.y for
//   exactly this when a mesh has no tangents), metallic-roughness G channel -> Blinn-Phong highlight; key + fill + ambient.

function sample(tex, u, v, out) {
  const W = tex.width, H = tex.height, d = tex.data, ch = tex.channels || 4;
  const x = (u - Math.floor(u)) * W - 0.5, y = (v - Math.floor(v)) * H - 0.5;
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  const px = (xx, yy) => (((yy + H) % H) * W + ((xx + W) % W)) * ch;
  const i00 = px(x0, y0), i10 = px(x0 + 1, y0), i01 = px(x0, y0 + 1), i11 = px(x0 + 1, y0 + 1);
  for (let k = 0; k < 3; k++) out[k] = (d[i00 + k] * (1 - fx) + d[i10 + k] * fx) * (1 - fy) + (d[i01 + k] * (1 - fx) + d[i11 + k] * fx) * fy;
  return out;
}
const norm3 = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

export class LitCanvas {
  constructor(w, h, bg = [38, 38, 42]) {
    this.w = w; this.h = h;
    this.rgb = new Uint8Array(w * h * 3);
    for (let i = 0; i < w * h; i++) this.rgb.set(bg, i * 3);
    this.z = new Float32Array(w * h).fill(-Infinity);
  }
  /**
   * @param mesh {pos, nrm (posed vertex normals), uv, idx, base?, normal?, mr? (decoded {data, width, height, channels}), color?}
   * @param cam {yawDeg, cx, cy, cz, height}
   * @param opt {normalMap = true, spec = true, light: camera-space key direction}
   */
  draw(mesh, cam, opt = {}) {
    const {w, h} = this, useN = opt.normalMap !== false && mesh.normal, useS = opt.spec !== false;
    const th = (cam.yawDeg || 0) * Math.PI / 180, cs = Math.cos(th), sn = Math.sin(th), k = h / cam.height;
    const toWorld = a => [cs * a[0] + sn * a[2], a[1], -sn * a[0] + cs * a[2]];
    const Lk = norm3(toWorld(opt.light || [-0.55, 0.62, 0.56])), Lf = norm3(toWorld([0.6, 0.1, 0.5])), Vw = toWorld([0, 0, 1]);
    const Hk = norm3([Lk[0] + Vw[0], Lk[1] + Vw[1], Lk[2] + Vw[2]]);
    const P = mesh.pos, N = mesh.nrm, UV = mesh.uv, I = mesh.idx, n = P.length / 3;
    const sx = new Float32Array(n), sy = new Float32Array(n), sz = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = P[i * 3] - (cam.cx || 0), y = P[i * 3 + 1] - cam.cy, z = P[i * 3 + 2] - (cam.cz || 0);
      sx[i] = w / 2 + (cs * x - sn * z) * k; sy[i] = h / 2 - y * k; sz[i] = sn * x + cs * z;
    }
    const c = [0, 0, 0], nt = [0, 0, 0], mr = [0, 0, 0];
    for (let t = 0; t < I.length; t += 3) {
      const a = I[t], b = I[t + 1], cc = I[t + 2];
      const ax = sx[a], ay = sy[a], bx = sx[b], by = sy[b], cx = sx[cc], cy = sy[cc];
      const area = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
      if (Math.abs(area) < 1e-9) continue;
      // per-triangle dP/du, dP/dv (world) from positions + UVs
      const e1 = [P[b * 3] - P[a * 3], P[b * 3 + 1] - P[a * 3 + 1], P[b * 3 + 2] - P[a * 3 + 2]], e2 = [P[cc * 3] - P[a * 3], P[cc * 3 + 1] - P[a * 3 + 1], P[cc * 3 + 2] - P[a * 3 + 2]];
      const du1 = UV[b * 2] - UV[a * 2], dv1 = UV[b * 2 + 1] - UV[a * 2 + 1], du2 = UV[cc * 2] - UV[a * 2], dv2 = UV[cc * 2 + 1] - UV[a * 2 + 1];
      const det = du1 * dv2 - du2 * dv1, r = Math.abs(det) > 1e-12 ? 1 / det : 0;
      const dPdu = [(e1[0] * dv2 - e2[0] * dv1) * r, (e1[1] * dv2 - e2[1] * dv1) * r, (e1[2] * dv2 - e2[2] * dv1) * r];
      const dPdv = [(e2[0] * du1 - e1[0] * du2) * r, (e2[1] * du1 - e1[1] * du2) * r, (e2[2] * du1 - e1[2] * du2) * r];
      const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx))), x1 = Math.min(w - 1, Math.ceil(Math.max(ax, bx, cx)));
      const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy))), y1 = Math.min(h - 1, Math.ceil(Math.max(ay, by, cy)));
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const qx = x + 0.5, qy = y + 0.5;
        const w0 = ((bx - qx) * (cy - qy) - (cx - qx) * (by - qy)) / area, w1 = ((cx - qx) * (ay - qy) - (ax - qx) * (cy - qy)) / area, w2 = 1 - w0 - w1;
        if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
        const z = w0 * sz[a] + w1 * sz[b] + w2 * sz[cc], o = y * w + x;
        if (z <= this.z[o]) continue;
        this.z[o] = z;
        const u = w0 * UV[a * 2] + w1 * UV[b * 2] + w2 * UV[cc * 2], v = w0 * UV[a * 2 + 1] + w1 * UV[b * 2 + 1] + w2 * UV[cc * 2 + 1];
        let Nn = norm3([w0 * N[a * 3] + w1 * N[b * 3] + w2 * N[cc * 3], w0 * N[a * 3 + 1] + w1 * N[b * 3 + 1] + w2 * N[cc * 3 + 1], w0 * N[a * 3 + 2] + w1 * N[b * 3 + 2] + w2 * N[cc * 3 + 2]]);
        if (useN) {
          sample(mesh.normal, u, v, nt);
          const mx = nt[0] / 127.5 - 1, my = nt[1] / 127.5 - 1, mz = nt[2] / 127.5 - 1;
          const dn = dPdu[0] * Nn[0] + dPdu[1] * Nn[1] + dPdu[2] * Nn[2], T = norm3([dPdu[0] - dn * Nn[0], dPdu[1] - dn * Nn[1], dPdu[2] - dn * Nn[2]]);
          const bn = dPdv[0] * Nn[0] + dPdv[1] * Nn[1] + dPdv[2] * Nn[2], Bu = norm3([-(dPdv[0] - bn * Nn[0]), -(dPdv[1] - bn * Nn[1]), -(dPdv[2] - bn * Nn[2])]);
          Nn = norm3([T[0] * mx + Bu[0] * my + Nn[0] * mz, T[1] * mx + Bu[1] * my + Nn[1] * mz, T[2] * mx + Bu[2] * my + Nn[2] * mz]);
        }
        if (Nn[0] * Vw[0] + Nn[1] * Vw[1] + Nn[2] * Vw[2] < 0) Nn = [-Nn[0], -Nn[1], -Nn[2]]; // double-sided
        if (mesh.base) sample(mesh.base, u, v, c); else { c[0] = c[1] = c[2] = 180; }
        const dk = Math.max(0, Nn[0] * Lk[0] + Nn[1] * Lk[1] + Nn[2] * Lk[2]), df = Math.max(0, Nn[0] * Lf[0] + Nn[1] * Lf[1] + Nn[2] * Lf[2]);
        let spec = 0;
        if (useS && mesh.mr) { sample(mesh.mr, u, v, mr); const rough = Math.max(0.08, mr[1] / 255), pw = Math.min(400, 2 / (rough ** 4) - 2); spec = (1 - rough) * 0.55 * Math.pow(Math.max(0, Nn[0] * Hk[0] + Nn[1] * Hk[1] + Nn[2] * Hk[2]), pw) * (dk > 0 ? 1 : 0); }
        const s = 0.32 + 0.85 * dk + 0.25 * df;
        for (let q = 0; q < 3; q++) this.rgb[o * 3 + q] = Math.max(0, Math.min(255, c[q] * s + 255 * spec));
      }
    }
  }
}

/** Posed normals by linear-blend skinning of the bind normals (world joint rotations from FK). */
export function skinNormals(m, world, jointNames) {
  const q = jointNames.map(nm => world[nm].rot), n = m.pos.length / 3, out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const v0 = m.nrm[i * 3], v1 = m.nrm[i * 3 + 1], v2 = m.nrm[i * 3 + 2];
    let x = 0, y = 0, z = 0;
    for (let k = 0; k < 4; k++) {
      const w = m.weights[i * 4 + k]; if (!w) continue;
      const [qx, qy, qz, qw] = q[m.joints[i * 4 + k]];
      const ix = qw * v0 + qy * v2 - qz * v1, iy = qw * v1 + qz * v0 - qx * v2, iz = qw * v2 + qx * v1 - qy * v0, iw = -qx * v0 - qy * v1 - qz * v2;
      x += w * (ix * qw + iw * -qx + iy * -qz - iz * -qy); y += w * (iy * qw + iw * -qy + iz * -qx - ix * -qz); z += w * (iz * qw + iw * -qz + ix * -qy - iy * -qx);
    }
    const l = Math.hypot(x, y, z) || 1; out[i * 3] = x / l; out[i * 3 + 1] = y / l; out[i * 3 + 2] = z / l;
  }
  return out;
}
