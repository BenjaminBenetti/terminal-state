// Task track3-eaton-centre-20261031 (lane ARCH): the mall's shared surface shaders — ONE program per surface kind (wall, floor,
// ceiling) for every finish of The Eaton's Center (world/mallFinishes.ts), so twenty shop programs, six gallery palettes, the
// plaza rings and the back of house cost the draw calls of one material per kind.
//
// How: the builder's architecture accumulators write a per-vertex FINISH ROW ('aFinish', world/builder.ts Accum.fin) for every
// mall surface; the row indexes a small float table texture (MALL_TABLE: 4 texels per row = colours, pattern codes, sizes) that
// the TSL graphs read with textureLoad (no filtering, no derivatives). The pattern is chosen by an If chain on the row's code
// (coherent per surface: one branch per fragment). Every derivative (pattern anti-aliasing via fwidth) is taken BEFORE the If
// chain: WGSL requires derivatives in uniform control flow, and the code is per-vertex data.
// Patterns are procedural (no new textures): painted render, concrete block, ceramic tile, slatwall, pegboard, timber planks,
// board-formed concrete, veined stone, brick, striped / diamond paper, accent bands, slab fascias; terrazzo with chips and brass
// dividers, concentric plaza rings, stone, tile, checker, planks, sealed concrete, clinical vinyl, confetti carpet; plaster, T-bar
// grid (missing / stained tiles), open black ceilings, timber slats, metal panels. Fine detail fades with distance (fwidth) so
// nothing shimmers. The 30-year decay hook (world/decay.ts) layers on top like every architectural material.
// The shadow pass skips all of it (skipInShadowPass: opaque architecture, only alpha matters there).

import * as THREE from 'three';
import type {Node} from 'three/webgpu';
import {Fn, If, abs, attribute, clamp, dot, float, floor, fract, fwidth, int, ivec2, length, max, min, mix, positionWorld, smoothstep, step, textureLoad, uv, vec2, vec3, vec4} from 'three/tsl';
import {SurfaceNodeMaterial} from './materials';
import {skipInShadowPass, wmHash, wmNoise} from './surfaceNodes';
import {applyDecay, type DecayProfile} from './decay';
import type {MallCeilFinish, MallFloorFinish, MallWallFinish} from './mallFinishes';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyNode = any;

/** Texture span (m) of the mall wall / floor / ceiling UVs (builder: uv = metres / span). */
export const MALL_SPAN = 2.4;
/** Rows of the finish table (one per distinct finish of a build; plaza rows carry their ring centre). */
export const MALL_TABLE_ROWS = 160;
/** Vertex attribute holding the finish row. */
export const MALL_FINISH_ATTR = 'aFinish';

const tableData = new Float32Array(4 * MALL_TABLE_ROWS * 4);
/** The finish table: row r = texels (0..3, r): wall (upper rgb + code, lower rgb + code, trim rgb + rough, lowerTop / skirt / scale / band). */
export const MALL_TABLE = new THREE.DataTexture(tableData, 4, MALL_TABLE_ROWS, THREE.RGBAFormat, THREE.FloatType);
MALL_TABLE.minFilter = MALL_TABLE.magFilter = THREE.NearestFilter;
MALL_TABLE.generateMipmaps = false;
MALL_TABLE.colorSpace = THREE.NoColorSpace;
MALL_TABLE.name = 'mall-finish-table';
MALL_TABLE.needsUpdate = true;

const C = new THREE.Color();
const lin = (hex: number): [number, number, number] => { C.setHex(hex, THREE.SRGBColorSpace); return [C.r, C.g, C.b]; };

/** Writes one table row (4 texels x RGBA). */
export function writeRow(row: number, t: readonly (readonly [number, number, number, number])[]): void {
  if (row < 0 || row >= MALL_TABLE_ROWS) throw new Error(`mall finish row ${row} out of range`);
  for (let k = 0; k < 4; k++) for (let c = 0; c < 4; c++) tableData[(row * 4 + k) * 4 + c] = t[k]?.[c] ?? 0;
  MALL_TABLE.needsUpdate = true;
}

/** Table row texels of a wall finish. */
export function wallRow(w: MallWallFinish): [number, number, number, number][] {
  return [[...lin(w.upperColor), w.upper], [...lin(w.lowerColor), w.lower], [...lin(w.trim), w.rough], [w.lowerTop, w.skirt, w.scale, w.band]];
}
/** Table row texels of a floor finish (`center`: concentric-ring centre, plaza rows). */
export function floorRow(f: MallFloorFinish, center: {x: number; z: number} = {x: 0, z: 0}): [number, number, number, number][] {
  return [[...lin(f.a), f.code], [...lin(f.b), f.w], [...lin(f.c), f.rough], [f.d, center.x, center.z, 0]];
}
/** Table row texels of a ceiling finish. */
export function ceilRow(c: MallCeilFinish): [number, number, number, number][] {
  return [[...lin(c.a), c.code], [...lin(c.b), c.module], [0, 0, 0, c.rough], [0, 0, 0, 0]];
}
/** The CPU copy of the table (tests). */
export const mallTableData = (): Float32Array => tableData;

// ---------------------------------------------------------------------------------------------------------------------------
// TSL graphs (module singletons: one program per kind)

const FID: AnyNode = attribute(MALL_FINISH_ATTR, 'float');
const ROW: AnyNode = int(floor(FID.add(0.5)));
const tex = (k: number): AnyNode => textureLoad(MALL_TABLE, ivec2(int(k), ROW));
const isC = (code: AnyNode, k: number): AnyNode => abs(code.sub(k)).lessThan(0.5);
const LUMA: AnyNode = vec3(0.2126, 0.7152, 0.0722);
/** Distance (m) to the nearest cell edge of a grid of cell size `size` at grid coordinate q. */
const edgeDist = (q: AnyNode, size: AnyNode): AnyNode => { const f = fract(q) as AnyNode; return min(min(f.x, f.x.oneMinus()).mul(size.x), min(f.y, f.y.oneMinus()).mul(size.y)); };
/** 1 inside a joint of half-width w (m) at edge distance d, with a soft edge. */
const joint = (d: AnyNode, w: number | AnyNode): AnyNode => float(1).sub(smoothstep(float(w).mul(0.6), float(w), d));
const shadowSafe = (full: AnyNode): AnyNode => skipInShadowPass(full as Node<'vec4'>, vec4(1, 1, 1, 1) as unknown as Node<'vec4'>, 'vec4');

/** Mall wall colour: upper / lower pattern by height, skirting, cap rail, accent band. */
const WALL_COLOR: AnyNode = shadowSafe(Fn(() => {
  const T0 = tex(0).toVar('mwT0'), T1 = tex(1).toVar('mwT1'), T2 = tex(2).toVar('mwT2'), T3 = tex(3).toVar('mwT3');
  const U = uv().mul(MALL_SPAN).toVar('mwUv');
  const s = U.x, h = U.y;
  const pw = positionWorld as AnyNode;
  // anti-aliasing weights (uniform control flow): pattern contrast fades out where a pattern period is ~2-3 px
  const px = max(fwidth(s), fwidth(h)).toVar('mwPx');
  const lowerTop = T3.x, skirt = T3.y, scale = max(T3.z, 0.02).toVar('mwScale'), band = T3.w;
  const inLower = step(h, lowerTop).mul(step(0.001, lowerTop)).toVar('mwLower');
  const code = mix(T0.w, T1.w, inLower).toVar('mwCode');
  const col = mix(T0.rgb, T1.rgb, inLower).toVar('mwCol');
  const trim = T2.rgb;
  const fine = float(1).sub(smoothstep(0.01, 0.03, px)).toVar('mwFine');
  const mid = float(1).sub(smoothstep(0.03, 0.09, px)).toVar('mwMid');
  const nLow = (wmNoise(pw.mul(0.55)) as AnyNode).toVar('mwN');
  const mottle = mix(0.93, 1.07, nLow).toVar('mwMottle');
  const out = vec3(col.mul(mottle)).toVar('mwOut');
  If(isC(code, 1), () => {
    // concrete block, running bond 0.4 x 0.2 (matches wallDetailPlan BLOCK), painted
    const row = floor(h.div(0.2));
    const q = vec2(s.div(0.4).add(fract(row.mul(0.5)).mul(0.5).mul(2)), h.div(0.2));
    const j = joint(edgeDist(q, vec2(0.4, 0.2)), 0.008).mul(mid);
    const tone = (wmHash(vec3(floor(q.x), floor(q.y), 3)) as AnyNode).sub(0.5).mul(0.08).add(1);
    out.assign(mix(col.mul(tone).mul(mottle), col.mul(0.66), j));
  }).ElseIf(isC(code, 2), () => {
    // ceramic tile grid (scale), grout, per-tile tone, a decorative band in the trim colour at `band`
    const q = vec2(s, h).div(scale);
    const g = joint(edgeDist(q, vec2(scale, scale)), 0.004).mul(fine);
    const tone = (wmHash(vec3(floor(q.x), floor(q.y), 7)) as AnyNode).sub(0.5).mul(0.06).add(1);
    const grout = mix(col, vec3(0.6, 0.6, 0.58), 0.55).mul(0.82);
    const b = step(0.001, band).mul(float(1).sub(step(scale.mul(0.5), abs(h.sub(band)))));
    out.assign(mix(mix(col.mul(tone), trim, b), grout, g));
  }).ElseIf(isC(code, 3), () => {
    // slatwall: horizontal grooves every `scale`, a highlight on the slat edge
    const f = fract(h.div(scale));
    const groove = float(1).sub(step(0.14, f)).mul(mid);
    const lip = step(0.14, f).mul(float(1).sub(step(0.2, f))).mul(mid);
    out.assign(col.mul(mottle).mul(float(1).sub(groove.mul(0.62))).mul(float(1).add(lip.mul(0.08))));
  }).ElseIf(isC(code, 4), () => {
    // pegboard: hole grid (scale), holes dark, fading to an average at distance
    const q = fract(vec2(s, h).div(scale)).sub(0.5);
    const hole = float(1).sub(smoothstep(0.1, 0.14, length(q))).mul(fine);
    out.assign(mix(col.mul(mottle), vec3(0.05, 0.045, 0.04), hole.mul(0.9)).mul(mix(1, 0.93, float(1).sub(fine))));
  }).ElseIf(isC(code, 5), () => {
    // vertical timber planks (scale wide): seams, per-plank tone, grain along the height
    const p = s.div(scale);
    const fp = fract(p);
    const seam = float(1).sub(smoothstep(0.004, 0.01, min(fp, fp.oneMinus()).mul(scale))).mul(mid);
    const grain = wmNoise(vec3(s.mul(9), h.mul(0.5), floor(p).mul(1.7))) as AnyNode;
    const tone = (wmHash(vec3(floor(p), 1, 9)) as AnyNode).sub(0.5).mul(0.16).add(1);
    out.assign(col.mul(tone).mul(mix(0.82, 1.14, grain)).mul(float(1).sub(seam.mul(0.55))));
  }).ElseIf(isC(code, 6), () => {
    // board-formed concrete: mottle, horizontal board lines, tie holes on a 0.6 m grid
    const n2 = wmNoise(vec3(s.mul(2.3), h.mul(2.3), 5)) as AnyNode;
    const board = float(1).sub(smoothstep(0.003, 0.008, min(fract(h.div(0.15)), fract(h.div(0.15)).oneMinus()).mul(0.15))).mul(mid);
    const tq = fract(vec2(s, h).div(0.6)).sub(0.5);
    const hole = float(1).sub(smoothstep(0.012, 0.018, length(tq).mul(0.6))).mul(mid);
    const panel = float(1).sub(smoothstep(0.004, 0.009, edgeDist(vec2(s, h).div(vec2(scale, 2.4)), vec2(scale, 2.4)))).mul(mid);
    out.assign(col.mul(mix(0.8, 1.14, nLow.mul(0.55).add(n2.mul(0.45)))).mul(float(1).sub(board.mul(0.08))).mul(float(1).sub(hole.mul(0.6))).mul(float(1).sub(panel.mul(0.3))));
  }).ElseIf(isC(code, 7), () => {
    // veined stone panels (scale x scale / 2): joints, per-panel tone, veins in the trim colour
    const sq = vec2(s.div(scale), h.div(scale.mul(0.5)));
    const j = joint(edgeDist(sq, vec2(scale, scale.mul(0.5))), 0.003).mul(mid);
    const tone = (wmHash(vec3(floor(sq.x), floor(sq.y), 5)) as AnyNode).mul(0.16).add(0.92);
    const vn = wmNoise(vec3(s.mul(0.9), h.mul(0.9), floor(sq.x).mul(2.1))) as AnyNode;
    const vein = float(1).sub(smoothstep(0.0, 0.03, abs(fract(vn.mul(4.5)).sub(0.5)))).mul(mid);
    out.assign(mix(col.mul(tone), mix(col, trim, 0.7), vein.mul(0.5)).mul(float(1).sub(j.mul(0.45))));
  }).ElseIf(isC(code, 8), () => {
    // brick, running bond (0.225 x 0.075 module incl. 10 mm joints), light mortar, per-brick tone
    const row = floor(h.div(0.075));
    const q = vec2(s.div(0.225).add(fract(row.mul(0.5))), h.div(0.075));
    const j = joint(edgeDist(q, vec2(0.225, 0.075)), 0.006).mul(fine);
    const r = wmHash(vec3(floor(q.x), floor(q.y), 11)) as AnyNode;
    const brick = col.mul(r.sub(0.5).mul(0.26).add(1)).mul(mix(vec3(1, 1, 1), vec3(1.06, 0.95, 0.9), r));
    out.assign(mix(brick.mul(mottle), vec3(0.62, 0.6, 0.56).mul(mix(col, vec3(1, 1, 1), 0.5)), j.mul(0.85)));
  }).ElseIf(isC(code, 9), () => {
    // striped paper: alternating stripes (scale wide) of the colour and a cream
    const st = step(0.5, fract(s.div(scale.mul(2))));
    const cream = mix(col, vec3(0.92, 0.9, 0.84), 0.65);
    out.assign(mix(col, mix(col, cream, st), mid).mul(mottle));
  }).ElseIf(isC(code, 10), () => {
    // diamond paper: a diamond lattice of the colour and the trim colour
    const dq = vec2(s.add(h), s.sub(h)).div(scale);
    const chk = step(0.25, fract(floor(dq.x).add(floor(dq.y)).mul(0.5)));
    out.assign(mix(col, mix(col, mix(col, trim, 0.85), chk), mid).mul(mottle));
  }).ElseIf(isC(code, 11), () => {
    // dark wall with an accent band (trim colour) at `band` and a thin pin line below it
    const inBand = step(band, h).mul(float(1).sub(step(band.add(0.14), h)));
    const pin = step(band.sub(0.1), h).mul(float(1).sub(step(band.sub(0.08), h)));
    out.assign(mix(col.mul(mottle), trim, max(inBand, pin.mul(0.8))));
  }).ElseIf(isC(code, 12), () => {
    // slab fascia: white render, a dark soffit-edge strip, faint panel joints every 2.4 m
    const strip = float(1).sub(step(0.06, h));
    const pj = float(1).sub(smoothstep(0.003, 0.006, min(fract(s.div(2.4)), fract(s.div(2.4)).oneMinus()).mul(2.4))).mul(mid);
    out.assign(mix(col.mul(mix(0.97, 1.03, nLow)), trim, strip).mul(float(1).sub(pj.mul(0.12))));
  });
  // skirting and the cap rail on top of a contrasting lower zone
  const sk = float(1).sub(step(skirt, h)).mul(step(0.001, skirt));
  const differ = max(step(0.5, abs(T0.w.sub(T1.w)) as AnyNode), step(0.02, dot(abs(T0.rgb.sub(T1.rgb)) as AnyNode, vec3(1, 1, 1)) as AnyNode)) as AnyNode;
  const cap = float(1).sub(step(0.02, abs(h.sub(lowerTop)))).mul(step(0.001, lowerTop)).mul(differ);
  const withTrim = mix(out, trim.mul(0.95), max(sk, cap));
  // contact shadow just above the floor / skirting
  const above = h.sub(skirt);
  const line = float(1).sub(smoothstep(0.0, 0.03, above)).mul(step(0.0, above));
  return vec4(withTrim.mul(float(1).sub(line.mul(0.22))), 1);
}, 'vec4')());

/** Mall floor colour: terrazzo, plaza rings, stone, tile, checker, planks, concrete, vinyl, carpet. */
const FLOOR_COLOR: AnyNode = shadowSafe(Fn(() => {
  const T0 = tex(0).toVar('mfT0'), T1 = tex(1).toVar('mfT1'), T2 = tex(2).toVar('mfT2'), T3 = tex(3).toVar('mfT3');
  const P = (positionWorld as AnyNode).xz.toVar('mfP');
  const px = max(fwidth(P.x), fwidth(P.y)).toVar('mfPx');
  const chipVis = float(1).sub(smoothstep(0.006, 0.02, px)).toVar('mfChip');
  const fine = float(1).sub(smoothstep(0.01, 0.03, px)).toVar('mfFine');
  const mid = float(1).sub(smoothstep(0.03, 0.09, px)).toVar('mfMid');
  const code = T0.w, A = T0.rgb, B = T1.rgb, Cc = T2.rgb;
  const w = max(T1.w, 0.03).toVar('mfW'), d = max(T3.x, 0.03).toVar('mfD');
  const nLow = (wmNoise(vec3(P.x.mul(0.45), P.y.mul(0.45), 2)) as AnyNode).toVar('mfN');
  const out = vec3(A).toVar('mfOut');
  // terrazzo chips (two chip sizes) over a binder colour, toward the average where chips are sub-pixel
  const chips = (binder: AnyNode, c1: AnyNode, c2: AnyNode): AnyNode => {
    const q1 = P.div(0.035), q2 = P.div(0.012);
    const h1 = wmHash(vec3(floor(q1.x), floor(q1.y), 13)) as AnyNode, h2 = wmHash(vec3(floor(q2.x), floor(q2.y), 17)) as AnyNode;
    const chip1 = step(0.78, h1), chip2 = step(0.7, h2);
    const ccol = mix(c1, c2, step(0.5, fract(h1.mul(7.3))));
    const sharp = mix(mix(binder, ccol, chip1.mul(0.85)), mix(binder, c1.mul(0.9).add(c2.mul(0.1)), 0.6), chip2.mul(0.5).mul(float(1).sub(chip1)));
    const avg = mix(binder, mix(c1, c2, 0.5), 0.2);
    return mix(avg, sharp, chipVis).mul(mix(0.95, 1.05, nLow));
  };
  If(isC(code, 0), () => {
    // terrazzo with brass divider strips every w x d
    const q = vec2(P.x.div(w), P.y.div(d));
    const div = joint(edgeDist(q, vec2(w, d)), 0.005).mul(mid);
    out.assign(mix(chips(A, B, Cc), Cc.mul(1.15), div.mul(0.9)));
  }).ElseIf(isC(code, 1), () => {
    // concentric-ring plaza terrazzo around (T3.y, T3.z): cream / black / cream / grey bands, divider strips at band edges
    const r = length(P.sub(vec2(T3.y, T3.z)));
    const k = floor(r.div(w));
    const m = floor(fract(k.div(5)).mul(5).add(0.5));
    const isB = abs(m.sub(2)).lessThan(0.5), isCc = abs(m.sub(4)).lessThan(0.5);
    const binder = vec3(A).toVar();
    If(isB, () => { binder.assign(B); });
    If(isCc, () => { binder.assign(Cc); });
    const fr = fract(r.div(w));
    const edge = joint(min(fr, fr.oneMinus()).mul(w), 0.006).mul(mid);
    out.assign(mix(chips(binder, mix(B, A, 0.5), Cc), vec3(0.62, 0.5, 0.3), edge.mul(0.8)));
  }).ElseIf(isC(code, 2), () => {
    // polished stone w x d, half bond, per-slab tone, soft veins, a border band in colour C every 6 modules
    const row = floor(P.y.div(d));
    const q = vec2(P.x.div(w).add(row.mul(0.5)), P.y.div(d));
    const j = joint(edgeDist(q, vec2(w, d)), 0.003).mul(mid);
    const tone = (wmHash(vec3(floor(q.x), floor(q.y), 19)) as AnyNode).mul(0.14).add(0.93);
    const vn = wmNoise(vec3(P.x.mul(0.8), P.y.mul(0.8), floor(q.x).mul(1.3))) as AnyNode;
    const vein = float(1).sub(smoothstep(0.0, 0.03, abs(fract(vn.mul(4)).sub(0.5)))).mul(mid);
    out.assign(mix(A.mul(tone), B, vein.mul(0.35)).mul(float(1).sub(j.mul(0.4))));
  }).ElseIf(isC(code, 3), () => {
    // ceramic tile grid w, grout B
    const q = P.div(w);
    const g = joint(edgeDist(q, vec2(w, w)), 0.004).mul(fine);
    const tone = (wmHash(vec3(floor(q.x), floor(q.y), 23)) as AnyNode).sub(0.5).mul(0.07).add(1);
    out.assign(mix(A.mul(tone).mul(mix(0.96, 1.04, nLow)), B.mul(0.85), g));
  }).ElseIf(isC(code, 4), () => {
    // two-colour checker (w), thin joints
    const q = P.div(w);
    const chk = step(0.5, fract(floor(q.x).add(floor(q.y)).mul(0.5)));
    const g = joint(edgeDist(q, vec2(w, w)), 0.003).mul(fine);
    out.assign(mix(mix(A, B, chk).mul(mix(0.95, 1.05, nLow)), Cc, g.mul(0.7)));
  }).ElseIf(isC(code, 5), () => {
    // timber planks w wide (rows along z) x d long, random bond, grain along x
    const row = floor(P.y.div(w));
    const off = (wmHash(vec3(row, 3, 29)) as AnyNode).mul(d);
    const q = vec2(P.x.add(off).div(d), P.y.div(w));
    const j = joint(edgeDist(q, vec2(d, w)), 0.0025).mul(fine);
    const tone = (wmHash(vec3(floor(q.x), floor(q.y), 31)) as AnyNode).sub(0.5).mul(0.22).add(1);
    const grain = wmNoise(vec3(P.x.mul(1.4), P.y.mul(26), row)) as AnyNode;
    out.assign(mix(A, B, grain.mul(0.45)).mul(tone).mul(float(1).sub(j.mul(0.6))));
  }).ElseIf(isC(code, 6), () => {
    // sealed concrete: mottle, saw cuts every w, darker blotches
    const q = P.div(w);
    const cut = joint(edgeDist(q, vec2(w, w)), 0.005).mul(mid);
    const n2 = wmNoise(vec3(P.x.mul(1.9), P.y.mul(1.9), 37)) as AnyNode;
    const blot = smoothstep(0.62, 0.8, n2).mul(0.3);
    out.assign(mix(A.mul(mix(0.85, 1.12, nLow)), B, blot).mul(float(1).sub(cut.mul(0.45))));
  }).ElseIf(isC(code, 7), () => {
    // sheet vinyl: fine flecks, faint welded seams every w, a coloured border line (B) every 2w
    const q = P.div(0.02);
    const fl = step(0.86, wmHash(vec3(floor(q.x), floor(q.y), 41)) as AnyNode).mul(chipVis);
    const seam = joint(min(fract(P.x.div(w)), fract(P.x.div(w)).oneMinus()).mul(w), 0.002).mul(mid);
    out.assign(mix(A.mul(mix(0.97, 1.03, nLow)), Cc, fl.mul(0.5)).mul(float(1).sub(seam.mul(0.12))));
  }).ElseIf(isC(code, 8), () => {
    // confetti carpet: B / C flecks on A, carpet tile checker of pile direction
    const q = P.div(0.05);
    const hh = wmHash(vec3(floor(q.x), floor(q.y), 43)) as AnyNode;
    const f1 = step(0.9, hh).mul(chipVis), f2 = step(0.82, hh).mul(float(1).sub(step(0.86, hh))).mul(chipVis);
    const tq = P.div(w);
    const pile = fract(floor(tq.x).add(floor(tq.y)).mul(0.5)).mul(0.06).add(0.97);
    out.assign(mix(mix(A, B, f1), Cc, f2).mul(pile).mul(mix(0.9, 1.08, nLow)));
  });
  return vec4(out, 1);
}, 'vec4')());

/** Mall ceiling colour: plaster, T-bar grid, open black, timber slats, metal panels. */
const CEIL_COLOR: AnyNode = shadowSafe(Fn(() => {
  const T0 = tex(0).toVar('mcT0'), T1 = tex(1).toVar('mcT1');
  const P = (positionWorld as AnyNode).xz.toVar('mcP');
  const px = max(fwidth(P.x), fwidth(P.y)).toVar('mcPx');
  const mid = float(1).sub(smoothstep(0.03, 0.09, px)).toVar('mcMid');
  const code = T0.w, A = T0.rgb, B = T1.rgb, mod = max(T1.w, 0.05).toVar('mcMod');
  const nLow = (wmNoise(vec3(P.x.mul(0.5), P.y.mul(0.5), 9)) as AnyNode).toVar('mcN');
  const out = vec3(A.mul(mix(0.95, 1.04, nLow))).toVar('mcOut');
  If(isC(code, 1), () => {
    const q = P.div(mod);
    const bar = joint(edgeDist(q, vec2(mod, mod)), 0.012).mul(mid);
    const r = wmHash(vec3(floor(q.x), floor(q.y), 47)) as AnyNode;
    const missing = step(r, 0.04), stained = step(r, 0.13).mul(float(1).sub(missing));
    const tileCol = A.mul(mix(vec3(1, 1, 1), vec3(0.78, 0.7, 0.55), stained)).mul(r.mul(0.08).add(0.96));
    out.assign(mix(mix(tileCol, vec3(0.012, 0.012, 0.013), missing), B, bar));
  }).ElseIf(isC(code, 2), () => {
    // open ceiling: painted dark, beams every module, a duct run every 3 modules
    const bx = fract(P.x.div(mod));
    const beam = float(1).sub(smoothstep(0.03, 0.05, min(bx, bx.oneMinus()))).mul(mid);
    const dz = fract(P.y.div(mod.mul(3)));
    const duct = step(0.42, dz).mul(float(1).sub(step(0.58, dz)));
    out.assign(mix(A.mul(mix(0.85, 1.1, nLow)), B, max(beam.mul(0.8), duct.mul(0.55))));
  }).ElseIf(isC(code, 3), () => {
    // linear timber slats along x, dark gaps
    const f = fract(P.y.div(mod));
    const gap = step(0.62, f).mul(mid);
    const tone = (wmHash(vec3(floor(P.y.div(mod)), 1, 53)) as AnyNode).sub(0.5).mul(0.14).add(1);
    out.assign(mix(A.mul(tone), B, gap));
  }).ElseIf(isC(code, 4), () => {
    // metal panels: seams, per-panel tone
    const q = P.div(mod);
    const seam = joint(edgeDist(q, vec2(mod, mod)), 0.006).mul(mid);
    const tone = (wmHash(vec3(floor(q.x), floor(q.y), 59)) as AnyNode).sub(0.5).mul(0.1).add(1);
    out.assign(mix(A.mul(tone), B, seam));
  });
  return vec4(out, 1);
}, 'vec4')());

/** Roughness from the row (wall / floor: texel 2 alpha; ceiling: texel 2 alpha). */
const ROUGH: AnyNode = clamp(tex(2).w, 0.08, 1);

// ---------------------------------------------------------------------------------------------------------------------------
// Materials (one per kind x front / back of house: same program, different decay profile)

export type MallSurfaceKind = 'wall' | 'floor' | 'ceiling';

/** A mall surface material: a SurfaceNodeMaterial (decay properties) whose colour / roughness come from the finish table. */
export class MallSurfaceMaterial extends SurfaceNodeMaterial {
  readonly isMallSurface = true;
}

const DP = (o: Partial<DecayProfile> & {tint: [number, number, number]}): DecayProfile =>
  ({grime: 0, streaks: 0, efflor: 0, stains: 0, wear: 0, dust: 0, cracks: 0, peel: 0, tile: 0, tileLoss: 0, fade: 0, paintWear: 0, ...o});

/**
 * 30-year decay of the mall surfaces (world/decay.ts; the field adds traffic / openness / wetness / neglect per cell): the
 * front of house (galleries, shops) dusty and stained under the leaking glass roof; the back of house heavier. Floors are
 * monolithic for the decay (tile 0): the finish shaders draw their own tile / plank / divider grids.
 */
export const MALL_DECAY: Record<`${MallSurfaceKind}${'' | '-boh'}`, DecayProfile> = {
  wall: DP({grime: 0.5, streaks: 0.45, efflor: 0.15, stains: 0.35, cracks: 0.2, peel: 0.25, fade: 0.3, tint: [0.6, 0.55, 0.46]}),
  'wall-boh': DP({grime: 0.65, streaks: 0.55, efflor: 0.35, stains: 0.4, cracks: 0.3, peel: 0.6, fade: 0.5, tint: [0.58, 0.54, 0.47]}),
  floor: DP({grime: 0.35, wear: 0.55, dust: 0.7, stains: 0.55, efflor: 0.15, cracks: 0.35, tint: [0.5, 0.45, 0.37]}),
  'floor-boh': DP({grime: 0.4, wear: 0.5, dust: 0.8, stains: 0.6, efflor: 0.3, cracks: 0.5, tint: [0.5, 0.46, 0.4]}),
  ceiling: DP({grime: 0.3, stains: 0.7, efflor: 0.2, cracks: 0.25, peel: 0.35, fade: 0.2, tint: [0.6, 0.53, 0.42]}),
  'ceiling-boh': DP({grime: 0.4, stains: 0.85, efflor: 0.3, cracks: 0.35, peel: 0.6, fade: 0.2, tint: [0.56, 0.5, 0.4]}),
};

const registry = new Map<string, MallSurfaceMaterial>();

/** The mall surface material of a kind (front of house or back of house); created once, shared by every mall build. */
export function mallSurfaceMaterial(kind: MallSurfaceKind, boh = false): MallSurfaceMaterial {
  const key = `${kind}${boh ? '-boh' : ''}` as keyof typeof MALL_DECAY;
  let m = registry.get(key);
  if (m) return m;
  m = new MallSurfaceMaterial({roughness: 0.8, metalness: 0});
  m.name = `mall-${key}`;
  m.colorNode = kind === 'wall' ? WALL_COLOR : kind === 'floor' ? FLOOR_COLOR : CEIL_COLOR;
  m.roughnessNode = ROUGH;
  m.userData.mallSurface = kind;
  applyDecay(m, MALL_DECAY[key]);
  registry.set(key, m);
  return m;
}

/** Every mall surface material created so far (warm-up / tests). */
export const mallSurfaceMaterials = (): MallSurfaceMaterial[] => [...registry.values()];

/** CPU luminance of a linear colour (tests). */
export const lumOf = (c: readonly number[]): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
void LUMA;
