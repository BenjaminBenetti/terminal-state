// Task studio-flamethrower-fire-20261114-031614-01 (lane ACID-VFX): CPU previews of an acid pool for QA without a browser — the film
// is the shader's own maths run on numbers (weapons/acidPoolLook.ts poolLookAt, the function the node material is built from), the
// beads are the visual's live instances (AcidPoolVisual.beads()) drawn as small spheres. The LIGHTING is a plain stand-in (one
// overhead term, a torch on the camera, a simple highlight), not the game's renderer: these pictures show the pool's shape, layers,
// motion and drying; glints, shadows, tone mapping and anti-aliasing are for the browser spot check.
import * as THREE from 'three';
import {ACID_LOOK, linearRgb, poolLookAt, type PoolLookState} from '../../src/weapons/acidPoolLook';

export interface PreviewBead { kind: 'bubble' | 'froth' | 'spit'; x: number; y: number; z: number; r: number; fade: number }
/** A pool to draw: its film state, the radius it reaches now (m), its live beads, its body colour. */
export interface PreviewPool { look: PoolLookState; reach: number; beads: readonly PreviewBead[]; body: number }

const enc = (v: number) => { const c = Math.max(0, Math.min(1, v)); return Math.round(255 * (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055)); };

/** The floor under the previews: worn 0.6 m tiles (linear grey). */
function floorTone(mx: number, mz: number): number {
  const gx = Math.abs(((mx / 0.6) % 1 + 1) % 1 - 0.5), gz = Math.abs(((mz / 0.6) % 1 + 1) % 1 - 0.5);
  return 0.16 * (Math.max(gx, gz) > 0.485 ? 0.6 : 1) * (0.9 + 0.2 * Math.sin(mx * 7.1) * Math.sin(mz * 5.3));
}

/** Top-down: `size` px square covering `span` x the full radius around (cx, cz) x the full radius; `light` 0..1 (0.06: nearly dark). RGB bytes. */
export function renderTop(p: PreviewPool, size: number, o: {light?: number; span?: number; cx?: number; cz?: number} = {}): Buffer {
  const light = o.light ?? 0.9, span = o.span ?? 1.15, st = p.look, buf = Buffer.alloc(size * size * 3);
  const L = [0.35, 0.86, 0.36], hl = Math.hypot(L[0], L[1] + 1, L[2]), H = [L[0] / hl, (L[1] + 1) / hl, L[2] / hl];
  const body = linearRgb(p.body), bright = linearRgb(ACID_LOOK.bright), foam = linearRgb(ACID_LOOK.foam);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const mx = ((o.cx ?? 0) + ((x + 0.5) / size * 2 - 1) * span) * st.r, mz = ((o.cz ?? 0) + ((y + 0.5) / size * 2 - 1) * span) * st.r;
    const tone = floorTone(mx, mz) * light;
    const rgb = [tone, tone * 0.98, tone * 0.94];
    const f = poolLookAt(st, p.body, mx / p.reach, mz / p.reach);
    if (f) {
      const n = [-f.sx, 1, -f.sz], nl = Math.hypot(n[0], n[1], n[2]);
      const nh = Math.max(0, (n[0] * H[0] + n[1] * H[1] + n[2] * H[2]) / nl), ndl = Math.max(0, (n[0] * L[0] + n[1] * L[1] + n[2] * L[2]) / nl);
      const shin = 2 / Math.max(0.004, f.rough ** 4) - 2;
      const spec = Math.pow(nh, shin) * (shin + 2) / 25 * 0.04 * light * ndl;
      for (let c = 0; c < 3; c++) rgb[c] = rgb[c] * (1 - f.alpha) + (f.rgb[c] * light * ndl * 0.9 + spec + f.glow[c]) * f.alpha;
    }
    for (const b of p.beads) {
      const d = Math.hypot(mx - b.x, mz - b.z) / b.r;
      if (d >= 1 || b.y > 0.1) continue;
      const h = Math.sqrt(1 - d * d), pale = b.kind === 'froth';
      const a = b.fade * (pale ? 0.92 : 0.3 + 0.65 * (1 - h) * (1 - h));
      const hi = Math.pow(Math.max(0, 1 - Math.hypot(mx - b.x + b.r * 0.3, mz - b.z + b.r * 0.3) / (b.r * 0.35)), 2) * 0.9;
      for (let c = 0; c < 3; c++) rgb[c] = rgb[c] * (1 - a) + ((pale ? foam[c] : (body[c] + bright[c]) / 2) * light * (0.5 + 0.5 * h) + hi * light + body[c] * ACID_LOOK.foamGlow) * a;
    }
    const k = (y * size + x) * 3;
    buf[k] = enc(rgb[0]); buf[k + 1] = enc(rgb[1]); buf[k + 2] = enc(rgb[2]);
  }
  return buf;
}

/**
 * First person: the game's 75 degree camera at `eye` (m, relative to the pool's centre on the floor) looking at `at`; `torch` (0 / 1:
 * a cone on the camera) and `ambient` light. 2 x 2 samples per pixel. RGB bytes.
 */
export function renderView(p: PreviewPool, o: {w: number; h: number; eye: [number, number, number]; at: [number, number, number]; torch: number; ambient: number}): Buffer {
  const {w, h} = o, ss = 2, st = p.look, buf = Buffer.alloc(w * h * 3);
  const eye = new THREE.Vector3(...o.eye), fwd = new THREE.Vector3(...o.at).sub(eye).normalize();
  const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize(), up = new THREE.Vector3().crossVectors(right, fwd);
  const tan = Math.tan(75 / 2 * Math.PI / 180), aspect = w / h;
  const body = linearRgb(p.body), bright = linearRgb(ACID_LOOK.bright), foam = linearRgb(ACID_LOOK.foam);
  const d = new THREE.Vector3(), n = new THREE.Vector3(), v = new THREE.Vector3(), lamp = new THREE.Vector3(0.2, 1, -0.3).normalize(), hv = new THREE.Vector3();
  for (let py = 0; py < h; py++) for (let px = 0; px < w; px++) {
    const acc = [0, 0, 0];
    for (let sy = 0; sy < ss; sy++) for (let sx = 0; sx < ss; sx++) {
      d.copy(fwd).addScaledVector(right, ((px + (sx + 0.5) / ss) / w * 2 - 1) * tan * aspect).addScaledVector(up, (1 - (py + (sy + 0.5) / ss) / h * 2) * tan).normalize();
      let rgb = [0.012, 0.013, 0.016];
      if (d.y < -1e-4) {
        const t = -eye.y / d.y, mx = eye.x + d.x * t, mz = eye.z + d.z * t;
        v.copy(d).negate();
        const cone = Math.max(0, Math.min(1, (d.dot(fwd) - 0.83) / 0.12));
        const torch = o.torch * cone * cone * (3 - 2 * cone) * 9 / (1 + t * t);
        const tone = floorTone(mx, mz), lit = o.ambient + torch * Math.max(0, v.y);
        rgb = [tone * lit, tone * lit * 0.98, tone * lit * 0.94];
        const f = poolLookAt(st, p.body, mx / p.reach, mz / p.reach);
        if (f) {
          n.set(-f.sx, 1, -f.sz).normalize();
          const ndv = Math.max(0, n.dot(v)), shin = 2 / Math.max(4e-6, f.rough ** 4) - 2;
          hv.copy(lamp).add(v).normalize();
          const spec = (Math.pow(ndv, shin) * torch + Math.pow(Math.max(0, n.dot(hv)), shin) * o.ambient * 6) * (shin + 2) / 8 * 0.04;
          const sheen = (0.04 + 0.96 * Math.pow(1 - ndv, 5)) * o.ambient * 0.25;
          for (let c = 0; c < 3; c++) rgb[c] = rgb[c] * (1 - f.alpha) + (f.rgb[c] * (o.ambient + torch * ndv) + spec + sheen + f.glow[c]) * f.alpha;
        }
        let best = t, hit: PreviewBead | null = null;
        for (const b of p.beads) {
          if (Math.abs(b.x - mx) > 0.3 || Math.abs(b.z - mz) > 0.3) continue;
          const ox = eye.x - b.x, oy = eye.y - b.y, oz = eye.z - b.z;
          const bq = ox * d.x + oy * d.y + oz * d.z, disc = bq * bq - (ox * ox + oy * oy + oz * oz - b.r * b.r);
          if (disc <= 0) continue;
          const tt = -bq - Math.sqrt(disc);
          if (tt > 0 && tt < best) { best = tt; hit = b; }
        }
        if (hit) {
          n.set(eye.x + d.x * best - hit.x, eye.y + d.y * best - hit.y, eye.z + d.z * best - hit.z).normalize();
          const facing = Math.max(0, n.dot(v)), pale = hit.kind === 'froth';
          const a = hit.fade * (pale ? 0.92 : 0.3 + 0.65 * (1 - facing) * (1 - facing));
          const spec = pale ? 0 : Math.pow(facing, 3000) * 40 * 0.04 * torch;
          for (let c = 0; c < 3; c++) rgb[c] = rgb[c] * (1 - a) + ((pale ? foam[c] : (body[c] + bright[c]) / 2) * (o.ambient + torch * facing) + spec + body[c] * ACID_LOOK.foamGlow) * a;
        }
      }
      for (let c = 0; c < 3; c++) acc[c] += rgb[c];
    }
    const k = (py * w + px) * 3;
    for (let c = 0; c < 3; c++) buf[k + c] = enc(acc[c] / (ss * ss));
  }
  return buf;
}
