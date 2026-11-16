// Task studio-skywalk-events-20261115-193624-01 (layout version 7, lane GOLF-COURSE): the mini-golf event's own drawing.
//  - the course DECK (golfGreen / golfTier, sized per placement): one unit box per instance scaled to its piece, in a world-mapped
//    TURF material per tint (gen/skyways/events/golfKinds.ts GOLF_TINTS). The turf is a PROCEDURAL carpet texture (a seeded fibre /
//    mottle / tufting-row DataTexture, no image art), roughness 0.92, never reflective (tag 'none'), event-local materials;
//  - the CUP piece: its turf square with a real round opening in the top (a ShapeGeometry hole), the white plastic cup liner (an open
//    cylinder facing in) with its rim ring, and the dark liner floor just over the hall floor (a holed ball rests on the floor in it);
//  - the bumper RAILS / BLOCKS (sized per placement): scaled unit boxes in the shared shape / purpose paints, the rails with a black cap;
//  - every other golf kind: the generic code-drawn parts + canvas faces of world/skywaysEventDraw.ts (return null).
// The canvas PAINTERS (GOLF_PAINTERS) draw the faces' DYNAMIC per-seed graphics over code shapes: the hole's number / par plate, the
// flag's number, the scorecard (course name, every hole's par), the rack's header, the party banner. Fictional names; no static art.

import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import type {PropPlacement} from '../gen/props';
import type {ShapeMat} from '../gen/propShapes';
import {isPurposeMat, type PartMat} from '../gen/purposeShapes';
import type {StationLayout} from '../gen/stationTypes';
import {GOLF_CUP_PIECE, GOLF_CUP_R, GOLF_GREEN_H} from '../gen/skyways/events/golfContract';
import {GOLF_BLOCK_MATS, GOLF_RAIL_CAP, GOLF_RAIL_MATS, GOLF_TINTS, golfCardOf, golfSignOf} from '../gen/skyways/events/golfKinds';
import {GOLF_COURSE_NAMES, GOLF_PARTY_NAMES} from '../gen/skyways/events/golfTypes';
import {tagReflect} from '../render/reflectTag';
import {purposeMaterial} from './purposeTextures';
import {shapeMaterials} from './shapeMaterials';
import {SurfaceNodeMaterial, worldMapped, type WorldMaterials} from './materials';
import type {EventPainter} from './skywaysEventDraw';

/** The turf: texture size (px), its span (m per tile), roughness. */
export const GOLF_TURF = {px: 128, span: 0.4, roughness: 0.92} as const;

// ---------------------------------------------------------------------------------------------
// Turf

let turfTex: THREE.DataTexture | null = null;
/** The procedural carpet (greyscale ~0.7-1.0, tinted by the material colour): fine fibre speckle, soft mottling, tufting rows. Tileable. */
export function golfTurfTexture(): THREE.DataTexture {
  if (turfTex) return turfTex;
  const N = GOLF_TURF.px, data = new Uint8Array(N * N * 4);
  let s = 0x2f6b1d5 >>> 0;
  const rnd = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  const G = 8, coarse = Float32Array.from({length: G * G}, () => rnd());
  const c = (i: number, j: number) => coarse[(j % G) * G + (i % G)];
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const fx = (x / N) * G, fy = (y / N) * G, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
    const m = (c(x0, y0) * (1 - tx) + c(x0 + 1, y0) * tx) * (1 - ty) + (c(x0, y0 + 1) * (1 - tx) + c(x0 + 1, y0 + 1) * tx) * ty;
    const row = y % 4 === 0 ? -0.05 : y % 4 === 2 ? 0.015 : 0;
    const v = Math.max(0, Math.min(1, 0.84 + 0.1 * (m - 0.5) + 0.2 * (rnd() - 0.5) + row));
    const i = (y * N + x) * 4;
    data[i] = data[i + 1] = data[i + 2] = Math.round(v * 255);
    data[i + 3] = 255;
  }
  const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 4;
  t.name = 'event-golf-turf';
  t.needsUpdate = true;
  return (turfTex = t);
}

const TURF_MATS = new Map<number, SurfaceNodeMaterial>();
/** The course carpet of a tint (event-local, world-mapped: a scaled deck piece keeps the carpet's real scale). */
export function golfTurfMaterial(tint: number): SurfaceNodeMaterial {
  const k = ((tint % GOLF_TINTS.length) + GOLF_TINTS.length) % GOLF_TINTS.length;
  let m = TURF_MATS.get(k);
  if (m) return m;
  m = new SurfaceNodeMaterial({map: golfTurfTexture(), color: GOLF_TINTS[k], roughness: GOLF_TURF.roughness, metalness: 0});
  worldMapped(m, {span: [GOLF_TURF.span, GOLF_TURF.span], macro: 0.12});
  tagReflect(m, 'none');
  m.name = `event-golf-turf-${k}`;
  TURF_MATS.set(k, m);
  return m;
}

// ---------------------------------------------------------------------------------------------
// Instancing (scaled pieces)

const byKey = <K>(list: readonly PropPlacement[], key: (p: PropPlacement) => K): Map<K, PropPlacement[]> => {
  const m = new Map<K, PropPlacement[]>();
  for (const p of list) { const k = key(p), l = m.get(k); if (l) l.push(p); else m.set(k, [p]); }
  return m;
};
const UNIT = (() => { const g = new THREE.BoxGeometry(1, 1, 1); g.translate(0, 0.5, 0); return g; })();
const Q0 = new THREE.Quaternion();

/** Instances per storey (userData.level), each placed at (x, y + y0, z) and scaled by `scale(p)`; named `prop-<kind>-<suffix>`. */
function scaledInstanced(group: THREE.Group, geo: THREE.BufferGeometry, mat: THREE.Material, list: readonly PropPlacement[], name: string,
  scale: (p: PropPlacement) => [number, number, number], y0: (p: PropPlacement) => number = () => 0): void {
  for (const [level, ps] of byKey(list, p => p.level ?? 0)) {
    const im = new THREE.InstancedMesh(geo, mat, ps.length), m = new THREE.Matrix4();
    ps.forEach((p, i) => im.setMatrixAt(i, m.compose(new THREE.Vector3(p.x, p.y + y0(p), p.z), Q0, new THREE.Vector3(...scale(p)))));
    im.name = name;
    im.userData.level = level;
    im.computeBoundingSphere();
    group.add(im);
  }
}
const paint = (wm: WorldMaterials, m: PartMat): THREE.Material => (isPurposeMat(m) ? purposeMaterial(m) : shapeMaterials(wm)[m as ShapeMat]);

// ---------------------------------------------------------------------------------------------
// The cup piece

/** Flips a geometry to face inward (reversed winding, negated normals). */
function inward(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const idx = g.getIndex();
  if (idx) for (let i = 0; i < idx.count; i += 3) { const a = idx.getX(i + 1); idx.setX(i + 1, idx.getX(i + 2)); idx.setX(i + 2, a); }
  const n = g.getAttribute('normal');
  if (n) for (let i = 0; i < n.count; i++) n.setXYZ(i, -n.getX(i), -n.getY(i), -n.getZ(i));
  return g;
}
let cupGeos: {turf: THREE.BufferGeometry; liner: THREE.BufferGeometry; floor: THREE.BufferGeometry} | null = null;
/** The cup piece's geometries (prop frame: origin at the floor under the cup's centre). */
export function golfCupGeometries(): {turf: THREE.BufferGeometry; liner: THREE.BufferGeometry; floor: THREE.BufferGeometry} {
  if (cupGeos) return cupGeos;
  const S = GOLF_CUP_PIECE / 2, H = GOLF_GREEN_H, R = GOLF_CUP_R, SEG = 28;
  // the turf top: the square with the cup's round opening
  const shape = new THREE.Shape([new THREE.Vector2(-S, -S), new THREE.Vector2(S, -S), new THREE.Vector2(S, S), new THREE.Vector2(-S, S)]);
  shape.holes.push(new THREE.Path().absarc(0, 0, R, 0, Math.PI * 2, true));
  const top = new THREE.ShapeGeometry(shape, SEG);
  top.rotateX(-Math.PI / 2);
  top.translate(0, H, 0);
  // the four outer sides of the square
  const sides = [0, 1, 2, 3].map(k => {
    const p = new THREE.PlaneGeometry(2 * S, H);
    p.translate(0, H / 2, S);
    p.rotateY((k * Math.PI) / 2);
    return p;
  });
  const parts = [top, ...sides].map(g => (g.index ? g.toNonIndexed() : g));
  const turf = mergeGeometries(parts, false)!;
  // the liner: an open cylinder seen from inside, its rim ring on the turf line
  const wall = inward(new THREE.CylinderGeometry(R, R, H - 0.0015, SEG, 1, true));
  wall.translate(0, 0.0015 + (H - 0.0015) / 2, 0);
  const rim = new THREE.RingGeometry(R, R + 0.006, SEG);
  rim.rotateX(-Math.PI / 2);
  rim.translate(0, H + 0.0008, 0);
  const lin = [wall, rim].map(g => (g.index ? g.toNonIndexed() : g));
  const liner = mergeGeometries(lin, false)!;
  const floor = new THREE.CircleGeometry(R, SEG);
  floor.rotateX(-Math.PI / 2);
  floor.translate(0, 0.0015, 0);
  for (const g of [turf, liner, floor]) g.computeBoundingSphere();
  return (cupGeos = {turf, liner, floor});
}

// ---------------------------------------------------------------------------------------------
// The drawer

/** Draws a kind this lane draws itself (returns its instance count), or null (the generic parts + faces). */
export function drawGolfProp(group: THREE.Group, kind: string, list: readonly PropPlacement[], wm: WorldMaterials, layout?: StationLayout): number | null {
  void layout;
  switch (kind) {
    case 'golfGreen': case 'golfTier':
      for (const [tint, ps] of byKey(list, p => p.variant)) scaledInstanced(group, UNIT, golfTurfMaterial(tint), ps, `prop-${kind}-t${tint}`, p => [2 * p.hx, p.h, 2 * p.hz]);
      return list.length;
    case 'golfCup': {
      const g = golfCupGeometries();
      for (const [tint, ps] of byKey(list, p => p.variant)) {
        scaledInstanced(group, g.turf, golfTurfMaterial(tint), ps, `prop-golfCup-t${tint}`, () => [1, 1, 1]);
      }
      scaledInstanced(group, g.liner, purposeMaterial('paintWhite'), list, 'prop-golfCup-liner', () => [1, 1, 1]);
      scaledInstanced(group, g.floor, shapeMaterials(wm).black, list, 'prop-golfCup-floor', () => [1, 1, 1]);
      return list.length;
    }
    case 'golfRail':
      for (const [v, ps] of byKey(list, p => p.variant)) {
        const m = GOLF_RAIL_MATS[((v % GOLF_RAIL_MATS.length) + GOLF_RAIL_MATS.length) % GOLF_RAIL_MATS.length];
        scaledInstanced(group, UNIT, paint(wm, m), ps, `prop-golfRail-v${v}-${m}`, p => [2 * p.hx, p.h - GOLF_RAIL_CAP, 2 * p.hz]);
      }
      // the rubber cap, a little proud of the board on both faces
      scaledInstanced(group, UNIT, shapeMaterials(wm).black, list, 'prop-golfRail-cap', p => (p.hx >= p.hz ? [2 * p.hx, GOLF_RAIL_CAP, 2 * p.hz + 0.006] : [2 * p.hx + 0.006, GOLF_RAIL_CAP, 2 * p.hz]),
        p => p.h - GOLF_RAIL_CAP);
      return list.length;
    case 'golfBlock':
      for (const [v, ps] of byKey(list, p => p.variant)) {
        const m = GOLF_BLOCK_MATS[((v % GOLF_BLOCK_MATS.length) + GOLF_BLOCK_MATS.length) % GOLF_BLOCK_MATS.length];
        scaledInstanced(group, UNIT, paint(wm, m), ps, `prop-golfBlock-v${v}-${m}`, p => [2 * p.hx, p.h, 2 * p.hz]);
      }
      return list.length;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------------------------
// Painters (dynamic per-seed text over code shapes)

const GREEN = '#1d5a33', CREAM = '#fdfbef', GOLD = '#f5c542', INK = '#1f2a22';
const font = (px: number, weight = 'bold') => `${weight} ${Math.round(px)}px "Trebuchet MS", "Helvetica Neue", Arial, sans-serif`;
const courseName = (i: number) => GOLF_COURSE_NAMES[((i % GOLF_COURSE_NAMES.length) + GOLF_COURSE_NAMES.length) % GOLF_COURSE_NAMES.length];
function fitText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, px: number, weight = 'bold'): void {
  let s = px;
  ctx.font = font(s, weight);
  while (s > 8 && ctx.measureText(text).width > maxW) { s -= 1; ctx.font = font(s, weight); }
  ctx.fillText(text, x, y);
}

export const GOLF_PAINTERS: Readonly<Record<string, EventPainter>> = {
  // the tee sign's plate: HOLE n over the course name band, PAR p
  'golf-hole': {px: [320, 240], draw(ctx, w, h, variant) {
    const {n, par, name} = golfSignOf(variant);
    ctx.fillStyle = CREAM; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = GREEN; ctx.fillRect(0, 0, w, h * 0.24);
    ctx.fillStyle = GOLD; ctx.fillRect(0, h * 0.24, w, h * 0.025);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = CREAM; fitText(ctx, courseName(name).toUpperCase(), w / 2, h * 0.125, w * 0.9, h * 0.13);
    ctx.fillStyle = INK; fitText(ctx, 'HOLE', w * 0.3, h * 0.42, w * 0.4, h * 0.13);
    ctx.fillStyle = GREEN; fitText(ctx, String(n), w * 0.3, h * 0.68, w * 0.45, h * 0.38);
    ctx.fillStyle = INK; fitText(ctx, 'PAR', w * 0.74, h * 0.42, w * 0.4, h * 0.13);
    ctx.fillStyle = '#b3332b'; fitText(ctx, String(par), w * 0.74, h * 0.68, w * 0.4, h * 0.34);
    ctx.strokeStyle = GREEN; ctx.lineWidth = Math.max(3, w * 0.015); ctx.strokeRect(ctx.lineWidth / 2, ctx.lineWidth / 2, w - ctx.lineWidth, h - ctx.lineWidth);
  }},
  // the pennant: the hole's number (red / yellow by hole)
  'golf-flag': {px: [176, 104], draw(ctx, w, h, variant) {
    const odd = variant % 2 === 1;
    ctx.fillStyle = odd ? '#c9302c' : '#f2c230'; ctx.fillRect(0, 0, w, h);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = odd ? CREAM : INK; fitText(ctx, String(variant), w / 2, h * 0.54, w * 0.8, h * 0.8);
  }},
  // the scorecard: the course name, a row per hole with its par, blank player columns
  'golf-card': {px: [160, 240], draw(ctx, w, h, variant) {
    const {name, pars} = golfCardOf(variant);
    ctx.fillStyle = '#fbfaf3'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = GREEN; ctx.fillRect(0, 0, w, h * 0.16);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = CREAM; fitText(ctx, courseName(name).toUpperCase(), w / 2, h * 0.08, w * 0.92, h * 0.07);
    const n = Math.max(1, pars.length), top = h * 0.2, rowH = (h * 0.74) / (n + 2), cols = [0.06, 0.26, 0.42, 0.6, 0.78, 0.96];
    ctx.strokeStyle = '#7c8a7f'; ctx.lineWidth = 1;
    ctx.fillStyle = INK; ctx.font = font(rowH * 0.6);
    ['HOLE', 'PAR', 'A', 'B', 'C'].forEach((t, k) => fitText(ctx, t, w * (cols[k] + cols[k + 1]) / 2, top + rowH / 2, w * (cols[k + 1] - cols[k]) * 0.95, rowH * 0.6));
    for (let k = 0; k <= n + 1; k++) { ctx.beginPath(); ctx.moveTo(w * cols[0], top + k * rowH); ctx.lineTo(w * cols[5], top + k * rowH); ctx.stroke(); }
    for (const c of cols) { ctx.beginPath(); ctx.moveTo(w * c, top); ctx.lineTo(w * c, top + (n + 1) * rowH); ctx.stroke(); }
    ctx.font = font(rowH * 0.6, 'normal');
    pars.forEach((p, k) => {
      const y = top + (k + 1.5) * rowH;
      ctx.fillText(String(k + 1), w * (cols[0] + cols[1]) / 2, y);
      ctx.fillText(String(p), w * (cols[1] + cols[2]) / 2, y);
    });
    ctx.font = font(rowH * 0.6);
    ctx.fillText('TOTAL', w * (cols[0] + cols[1]) / 2 + w * 0.06, top + (n + 1.5) * rowH);
    ctx.fillText(String(pars.reduce((a, b) => a + b, 0)), w * (cols[1] + cols[2]) / 2 + w * 0.04, top + (n + 1.5) * rowH);
  }},
  // the putter rack's header board
  'golf-rack': {px: [512, 64], draw(ctx, w, h) {
    ctx.fillStyle = GREEN; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = GOLD; ctx.fillRect(0, h * 0.86, w, h * 0.06);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = CREAM; fitText(ctx, 'PUTTERS · PLEASE RETURN TO THE RACK', w / 2, h * 0.45, w * 0.94, h * 0.5);
  }},
  // the party room's birthday banner: bunting and the name
  'golf-party': {px: [1024, 256], draw(ctx, w, h, variant) {
    const who = GOLF_PARTY_NAMES[((variant % GOLF_PARTY_NAMES.length) + GOLF_PARTY_NAMES.length) % GOLF_PARTY_NAMES.length];
    ctx.fillStyle = '#fff8ec'; ctx.fillRect(0, 0, w, h);
    const flags = ['#e8483f', '#f6b93b', '#3c9d5d', '#3b7dd8', '#9b59b6'];
    const n = 16;
    for (let k = 0; k < n; k++) {
      const x0 = (k / n) * w, x1 = ((k + 1) / n) * w;
      ctx.fillStyle = flags[k % flags.length];
      ctx.beginPath(); ctx.moveTo(x0 + 2, 0); ctx.lineTo(x1 - 2, 0); ctx.lineTo((x0 + x1) / 2, h * 0.24); ctx.closePath(); ctx.fill();
    }
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#d63b5c'; fitText(ctx, `HAPPY BIRTHDAY ${who}!`, w / 2, h * 0.6, w * 0.92, h * 0.4);
    ctx.fillStyle = GREEN; fitText(ctx, 'PARTY ROOM · MINI-GOLF', w / 2, h * 0.88, w * 0.6, h * 0.11);
  }},
};
