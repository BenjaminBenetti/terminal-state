// CPU lighting preview (Lane L, iteration 05; QA only, no WebGL): a 2.5D grid raycaster for station
// architecture (floors, walls, ceilings, steps/lintels, track bed) and fixture tubes, shaded with
//  - 'after':  the baked light field exactly as the runtime shader decodes it (amb + dir * N.L),
//              constant hemisphere, flashlight, MOOD exposure/fog, glow-fog tubes;
//  - 'before': an emulation of the iteration-04 model (the 3-8 PointLights nearest the camera, no
//              shadows, hemisphere driven by the camera's area profile, exposure 1.0, fog 0.038).
// Albedos are flat per surface class (no textures/props): this previews light distribution and mood,
// not final shading. three's ACES filmic + sRGB + post-tonemap fog order are reproduced.
import {CELL, SOLID, VOID} from '../../src/gen/grid';
import type {Area, LightProfile, StationLayout} from '../../src/gen/station';
import {cellFloorFn, sampleField, type BakedField} from '../../src/world/lightField';

export interface PreviewCamera { x: number; y: number; z: number; yaw: number; pitch: number; fov: number }
export interface PreviewMood {
  exposure: number; ambient: number; hemiSky: number; hemiGround: number; fogDensity: number; fogColor: number;
  flashlight: number; glowFog: number;
}

type V3 = [number, number, number];
const hex = (h: number): V3 => [(h >> 16 & 255) / 255, (h >> 8 & 255) / 255, (h & 255) / 255];
const toLin = (c: number) => c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
const toSrgb = (c: number) => c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
const lin = (h: number): V3 => hex(h).map(toLin) as V3;

function aces(c: V3, exposure: number): V3 {
  const e = exposure / 0.6;
  const r = c[0] * e, g = c[1] * e, b = c[2] * e;
  // three's column-major mat3 (input)
  const i0 = 0.59719 * r + 0.35458 * g + 0.04823 * b;
  const i1 = 0.07600 * r + 0.90834 * g + 0.01566 * b;
  const i2 = 0.02840 * r + 0.13383 * g + 0.83777 * b;
  const f = (v: number) => (v * (v + 0.0245786) - 0.000090537) / (v * (0.983729 * v + 0.4329510) + 0.238081);
  const a0 = f(i0), a1 = f(i1), a2 = f(i2);
  const o0 = 1.60475 * a0 - 0.53108 * a1 - 0.07367 * a2;
  const o1 = -0.10208 * a0 + 1.10813 * a1 - 0.00605 * a2;
  const o2 = -0.00327 * a0 - 0.07276 * a1 + 1.07602 * a2;
  const s = (v: number) => Math.min(1, Math.max(0, v));
  return [s(o0), s(o1), s(o2)];
}

// Flat albedos (linear) roughly matching the kit textures' average colours.
const ALB = {
  terrazzo: lin(0x8a8478), slab: lin(0x7f7b72), concrete: lin(0x6c6963), quarry: lin(0x8a4a36), ballast: lin(0x45413c),
  tile: lin(0xc6bea6), paint: lin(0x8a8d84), shopTile: lin(0xd0ccc0), tunnel: lin(0x34322f), face: lin(0x6f6b63),
  ceiling: lin(0x8c877d), ceilingService: lin(0x77736b),
};

export interface Hit { t: number; p: V3; n: V3; alb: V3; emit?: V3 }

export interface PreviewScene {
  layout: StationLayout;
  floor: (cx: number, cy: number) => number;
  tubes: Map<number, number[]>; // cell -> light indices whose tube overlaps it
}

export function previewScene(layout: StationLayout): PreviewScene {
  const g = layout.grid;
  const tubes = new Map<number, number[]>();
  layout.lights.forEach((l, i) => {
    const ax = Math.cos(l.rot) * 0.5, az = -Math.sin(l.rot) * 0.5;
    for (let s = -1; s <= 1; s += 0.25) {
      const [cx, cy] = g.cellOf(l.x + ax * s, l.z + az * s);
      if (!g.inBounds(cx, cy)) continue;
      const k = cy * g.w + cx;
      let list = tubes.get(k);
      if (!list) tubes.set(k, (list = []));
      if (!list.includes(i)) list.push(i);
    }
  });
  return {layout, floor: cellFloorFn(g, layout.trench.floorY), tubes};
}

function surfaceAlbedo(layout: StationLayout, cell: number, kind: 'floor' | 'wall' | 'ceil'): V3 {
  const g = layout.grid;
  if (g.cells[cell] === VOID) return kind === 'floor' ? ALB.ballast : kind === 'wall' ? ALB.tunnel : ALB.ceiling;
  const a: Area | undefined = layout.areas[g.area[cell]];
  if (kind === 'ceil') return a?.publicSpace === false ? ALB.ceilingService : ALB.ceiling;
  if (kind === 'wall') return !a ? ALB.tile : a.type === 'eatery' || a.type === 'shop' ? ALB.shopTile : a.publicSpace ? ALB.tile : ALB.paint;
  if (!a) return ALB.concrete;
  if (a.kind === 'platform') return ALB.slab;
  if (a.type === 'eatery') return ALB.quarry;
  return a.publicSpace ? ALB.terrazzo : ALB.concrete;
}

function tubeHit(sc: PreviewScene, cell: number, o: V3, d: V3, tMax: number): {t: number; li: number} | null {
  const list = sc.tubes.get(cell);
  if (!list) return null;
  let best: {t: number; li: number} | null = null;
  for (const li of list) {
    const l = sc.layout.lights[li];
    // Tube box in the fixture frame: 1.0 x 0.05 x 0.08 m centred 0.2 m below the fixture anchor.
    const c = Math.cos(l.rot), s = Math.sin(l.rot);
    const ox = o[0] - l.x, oy = o[1] - (l.y - 0.2), oz = o[2] - l.z;
    const lx = ox * c - oz * s, lz = ox * s + oz * c; // rotate into fixture frame (x along tube)
    const dx = d[0] * c - d[2] * s, dz = d[0] * s + d[2] * c;
    const lo = [-0.5, -0.025, -0.06], hi = [0.5, 0.025, 0.06];
    const oo = [lx, oy, lz], dd = [dx, d[1], dz];
    let t0 = 0, t1 = tMax, ok = true;
    for (let k = 0; k < 3 && ok; k++) {
      if (Math.abs(dd[k]) < 1e-9) { if (oo[k] < lo[k] || oo[k] > hi[k]) ok = false; continue; }
      let a = (lo[k] - oo[k]) / dd[k], b = (hi[k] - oo[k]) / dd[k];
      if (a > b) [a, b] = [b, a];
      t0 = Math.max(t0, a); t1 = Math.min(t1, b);
      if (t0 > t1) ok = false;
    }
    if (ok && (!best || t0 < best.t)) best = {t: t0, li};
  }
  return best;
}

export function castRay(sc: PreviewScene, o: V3, d: V3, maxT: number): Hit | null {
  const g = sc.layout.grid;
  let x = Math.floor(o[0] / CELL), y = Math.floor(o[2] / CELL);
  const stepX = d[0] > 0 ? 1 : -1, stepY = d[2] > 0 ? 1 : -1;
  const tDX = Math.abs(d[0]) > 1e-9 ? CELL / Math.abs(d[0]) : Infinity, tDY = Math.abs(d[2]) > 1e-9 ? CELL / Math.abs(d[2]) : Infinity;
  let tMaxX = Math.abs(d[0]) > 1e-9 ? (d[0] > 0 ? (x + 1) * CELL - o[0] : o[0] - x * CELL) / Math.abs(d[0]) : Infinity;
  let tMaxY = Math.abs(d[2]) > 1e-9 ? (d[2] > 0 ? (y + 1) * CELL - o[2] : o[2] - y * CELL) / Math.abs(d[2]) : Infinity;
  let tIn = 0;
  const P = (t: number): V3 => [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t];
  for (let guard = 0; guard < 600 && tIn < maxT; guard++) {
    if (!g.inBounds(x, y)) return null;
    const i = y * g.w + x;
    const fl = sc.floor(x, y), ce = g.ceil[i] > fl + 0.5 ? g.ceil[i] : fl + 3;
    const tOut = Math.min(tMaxX, tMaxY);
    let tHit = Infinity, n: V3 = [0, 1, 0], kind: 'floor' | 'ceil' = 'floor';
    if (d[1] < 0) { const t = (fl - o[1]) / d[1]; if (t >= tIn - 1e-6 && t <= tOut) { tHit = t; n = [0, 1, 0]; kind = 'floor'; } }
    else if (d[1] > 0) { const t = (ce - o[1]) / d[1]; if (t >= tIn - 1e-6 && t <= tOut) { tHit = t; n = [0, -1, 0]; kind = 'ceil'; } }
    const th = tubeHit(sc, i, o, d, Math.min(tHit, tOut));
    if (th) return {t: th.t, p: P(th.t), n: [0, -1, 0], alb: [0, 0, 0], emit: [th.li, 0, 0]};
    if (tHit < Infinity) return {t: tHit, p: P(tHit), n, alb: surfaceAlbedo(sc.layout, i, kind)};
    // Step into the next cell: wall if solid or the ray height is outside its floor..ceiling.
    const nx = tMaxX < tMaxY ? x + stepX : x, ny = tMaxX < tMaxY ? y : y + stepY;
    const wn: V3 = tMaxX < tMaxY ? [-stepX, 0, 0] : [0, 0, -stepY];
    const yb = o[1] + d[1] * tOut;
    if (!g.inBounds(nx, ny)) return null;
    const j = ny * g.w + nx;
    if (g.cells[j] === SOLID) return {t: tOut, p: P(tOut), n: wn, alb: surfaceAlbedo(sc.layout, i, 'wall')};
    const nfl = sc.floor(nx, ny), nce = g.ceil[j] > nfl + 0.5 ? g.ceil[j] : nfl + 3;
    if (yb < nfl || yb > nce) {
      const alb = g.cells[i] === VOID && yb < nfl ? ALB.face : surfaceAlbedo(sc.layout, i, 'wall');
      return {t: tOut, p: P(tOut), n: wn, alb};
    }
    tIn = tOut;
    if (tMaxX < tMaxY) { tMaxX += tDX; x = nx; } else { tMaxY += tDY; y = ny; }
  }
  return null;
}

/** iteration-04 model constants (world/lights.ts before this lane). */
const R4 = {POOL: 8, RANGE: 12, DECAY: 1.6, INTENSITY: 20, AMBIENT: {lit: 0.6, dim: 0.27, dark: 0.15} as Record<LightProfile, number>,
  SKY_LIT: lin(0xe8dfca), SKY_DARK: lin(0x98a2ad), GROUND_LIT: lin(0x37322b), GROUND_DARK: lin(0x222428), exposure: 1, fog: 0.038, fogColor: 0x0a0b0c};

function r4Pool(layout: StationLayout, cam: PreviewCamera): number[] {
  const g = layout.grid;
  const scored: {i: number; s: number}[] = [];
  layout.lights.forEach((f, i) => {
    if (f.broken) return;
    const d = Math.hypot(f.x - cam.x, f.z - cam.z);
    if (d > 16) return;
    const vis = g.lineOfSight(cam.x, cam.z, f.x, f.z);
    scored.push({i, s: d * (vis ? 1 : 2.2) * (f.dying ? 1.5 : 1)});
  });
  scored.sort((a, b) => a.s - b.s);
  return scored.slice(0, R4.POOL).map(s => s.i);
}

export interface PreviewOptions { mode: 'before' | 'after'; mood: PreviewMood; field?: BakedField; levels?: number[]; flashlight?: boolean; width: number; height: number }

/** Render one view to an RGB buffer (sRGB bytes). */
export function renderPreview(sc: PreviewScene, cam: PreviewCamera, opt: PreviewOptions): Buffer {
  const {layout} = sc, W = opt.width, H = opt.height;
  const out = Buffer.alloc(W * H * 3);
  const after = opt.mode === 'after';
  const mood = opt.mood;
  const fogD = after ? mood.fogDensity : R4.fog;
  const fogC = lin(after ? mood.fogColor : R4.fogColor); // three mixes the (linear) fog colour after sRGB encoding
  const exposure = after ? mood.exposure : R4.exposure;
  // Hemisphere
  let sky: V3, ground: V3, hemiI: number;
  if (after) { sky = lin(mood.hemiSky); ground = lin(mood.hemiGround); hemiI = mood.ambient; }
  else {
    const ai = layout.grid.areaAt(cam.x, cam.z);
    const prof = layout.areas[ai >= 0 ? ai : layout.platform]?.lighting ?? 'lit';
    hemiI = R4.AMBIENT[prof];
    const dark = Math.min(1, Math.max(0, (R4.AMBIENT.lit - hemiI) / (R4.AMBIENT.lit - R4.AMBIENT.dark)));
    sky = R4.SKY_LIT.map((v, k) => v + (R4.SKY_DARK[k] - v) * dark) as V3;
    ground = R4.GROUND_LIT.map((v, k) => v + (R4.GROUND_DARK[k] - v) * dark) as V3;
  }
  const pool = after ? [] : r4Pool(layout, cam);
  const levels = opt.levels ?? [1, 1, 1];
  // Camera basis (three: yaw about Y then pitch about X, looking down -Z).
  const cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw), cp = Math.cos(cam.pitch), spp = Math.sin(cam.pitch);
  const fwd: V3 = [-sy * cp, spp, -cy * cp], right: V3 = [cy, 0, -sy], up: V3 = [sy * spp, cp, cy * spp];
  const tanF = Math.tan(cam.fov * Math.PI / 360);
  const o: V3 = [cam.x, cam.y, cam.z];
  const flashOn = opt.flashlight ?? true;
  const fl = {I: after ? mood.flashlight : 34, cone: Math.cos(0.58), pen: Math.cos(0.58 * 0.3), dist: 30, decay: 1.2};
  const fdn: V3 = fwd; // flashlight sits just below the eye and points (almost) along the view
  for (let py = 0; py < H; py++) for (let px = 0; px < W; px++) {
    const u = ((px + 0.5) / W * 2 - 1) * tanF * W / H, v = (1 - (py + 0.5) / H * 2) * tanF;
    const d: V3 = [fwd[0] + right[0] * u + up[0] * v, fwd[1] + right[1] * u + up[1] * v, fwd[2] + right[2] * u + up[2] * v];
    const dl = Math.hypot(...d); d[0] /= dl; d[1] /= dl; d[2] /= dl;
    const hit = castRay(sc, o, d, 72);
    let col: V3 = [0, 0, 0];
    let fogDepth = 72;
    let glow = false;
    if (hit) {
      fogDepth = hit.t * (d[0] * fwd[0] + d[1] * fwd[1] + d[2] * fwd[2]);
      if (hit.emit) {
        const l = layout.lights[hit.emit[0]];
        const li = hit.emit[0];
        let lvl = l.broken ? 0 : 1;
        if (after && !l.broken && opt.field) { const gq = opt.field.groups[li]; if (gq >= 0) lvl = levels[gq]; }
        const k = lvl * l.power > 0.02 ? 0.12 + 0.88 * lvl * l.power : 0.04;
        col = [k, k * 0.98, k * 0.92];
        glow = after;
      } else {
        const n = hit.n, p = hit.p;
        let E: V3 = [0, 0, 0];
        const w = 0.5 * n[1] + 0.5;
        for (let c = 0; c < 3; c++) E[c] += (ground[c] + (sky[c] - ground[c]) * w) * hemiI;
        if (after && opt.field) {
          const s = sampleField(opt.field, p[0], p[1], p[2], levels, n);
          const ndl = Math.max(0, n[0] * s.dir[0] + n[1] * s.dir[1] + n[2] * s.dir[2]);
          for (let c = 0; c < 3; c++) E[c] += s.amb[c] + s.dirColor[c] * ndl;
        } else if (!after) {
          for (const li of pool) {
            const l = layout.lights[li];
            const lp: V3 = [l.x, l.y - 0.3, l.z];
            const lv: V3 = [lp[0] - p[0], lp[1] - p[1], lp[2] - p[2]];
            const dd = Math.hypot(...lv);
            const ndl = Math.max(0, (n[0] * lv[0] + n[1] * lv[1] + n[2] * lv[2]) / dd);
            const hg = Math.min(1.5, Math.max(0.8, Math.pow(Math.max(0.01, l.y) / 3.2, 1.3)));
            const I = R4.INTENSITY * l.power * hg * (l.dying ? 0 : 1);
            let att = 1 / Math.max(Math.pow(dd, R4.DECAY), 0.01);
            att *= Math.pow(Math.min(1, Math.max(0, 1 - Math.pow(dd / R4.RANGE, 4))), 2);
            const lc = lin(l.warm ? 0xffdcae : l.power < 0.8 ? 0xf2efc8 : 0xfff0d8);
            for (let c = 0; c < 3; c++) E[c] += lc[c] * I * att * ndl;
          }
        }
        if (flashOn) {
          const lv: V3 = [o[0] - p[0], o[1] - 0.15 - p[1], o[2] - p[2]];
          const dd = Math.hypot(...lv);
          const ld: V3 = [lv[0] / dd, lv[1] / dd, lv[2] / dd];
          const ang = -(ld[0] * fdn[0] + ld[1] * fdn[1] + ld[2] * fdn[2]);
          const t = Math.min(1, Math.max(0, (ang - fl.cone) / (fl.pen - fl.cone)));
          const sa = t * t * (3 - 2 * t);
          if (sa > 0) {
            const ndl = Math.max(0, n[0] * ld[0] + n[1] * ld[1] + n[2] * ld[2]);
            let att = 1 / Math.max(Math.pow(dd, fl.decay), 0.01);
            att *= Math.pow(Math.min(1, Math.max(0, 1 - Math.pow(dd / fl.dist, 4))), 2);
            const fc = lin(0xfff4e2);
            for (let c = 0; c < 3; c++) E[c] += fc[c] * fl.I * sa * att * ndl;
          }
        }
        col = [E[0] * hit.alb[0] / Math.PI, E[1] * hit.alb[1] / Math.PI, E[2] * hit.alb[2] / Math.PI];
      }
    }
    // Tone map (tubes in 'after' are toneMapped=false), sRGB, then fog (three's order).
    let c3: V3 = glow ? col : aces(col, exposure);
    c3 = c3.map(toSrgb) as V3;
    const dens = glow ? fogD * mood.glowFog : fogD;
    const ff = 1 - Math.exp(-dens * dens * fogDepth * fogDepth);
    for (let c = 0; c < 3; c++) out[(py * W + px) * 3 + c] = Math.round(Math.min(1, Math.max(0, c3[c] + (fogC[c] - c3[c]) * ff)) * 255);
  }
  return out;
}
