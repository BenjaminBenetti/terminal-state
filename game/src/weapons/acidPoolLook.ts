// Task studio-flamethrower-fire-20261114-031614-01 (lane ACID-VFX; user: "an organic convincing corrosive pool: reactive foam, bubbles,
// layered detail, irregular edges, NOT a generic disk. VISUAL ONLY"): what the acid film LOOKS like at a point — pure maths, no
// three.js. ONE definition (poolLook) written over a tiny arithmetic interface (LookMath), run two ways:
//  - on the GPU: weapons/acidPoolVisual.ts hands it TSL nodes, so the film's node material IS this function (WebGPU and the WebGL2
//    fallback: plain uniforms, one small data texture, no loops, no uniformArray);
//  - on the CPU: NUM below hands it numbers (poolLookAt) — the tests hold the drawn film to the hazard circle with it, and QA can
//    render the film top-down without a browser.
// The layers, inside out (`rim`: 0 at the pool's centre, 1 on the liquid's edge — weapons/acidPoolShape.ts poolEdge — 2 on the circle
// that hurts):
//  - the LIQUID BODY: deep, saturated and nearly opaque in the middle, thinning to a pale translucent rim; brighter yellow-green
//    streaks drift and shear in a slow swirl (two cross-scrolling samples of the noise tile, one warping the other);
//  - FOAM: a frothy pale band along the edge, where the acid eats the floor — its width wanders with the flow — a few drifting flecks of
//    scum, and BLOOMS around the reaction points (where an actor stands in it, where a prop is being dissolved, the burst itself:
//    weapons/grenades.ts feeds them, they decay in about a second). The froth's margin breaks up into single cells (the tile's bubble
//    channel at two scales);
//  - the ETCHED FLOOR: a dark wet stain under the film and in the narrow strip between the liquid's edge and the hazard circle (fading
//    out toward the circle, so no perfect ring is drawn);
//  - DRYING: over the pool's last moments the thin film goes first — the rim and the shallow patches dry to the stain with a dull
//    crust where the foam was, the liquid retreats into its deep spots, and everything fades with the pool's strength
//    (weapons/grenades.ts poolStrength, through the material's opacity) — nothing vanishes at once, and the outline stays marked
//    until the end;
//  - wetness: a low roughness on the liquid (the torch and the lamps glint on it), matte foam, and slopes for the normal that drift
//    with the flow and get choppier where it reacts; a modest green glow (stronger at the reactions) keeps it readable in the dark.
// It is a LIQUID on the floor: no vapour, no haze, no volume (CLAUDE.md's green-fog rule is for inhaled gas).

import {POOL_EDGE, poolEdgeRing, ringRadius, type PoolShape} from './acidPoolShape';

export const ACID_LOOK = {
  /** The film material's opacity at full strength (weapons/grenades.ts drawPool: opacity = this x poolStrength, as before). */
  opacity: 0.82,
  /** Reaction points the film shows at once. */
  reactions: 6,
  /** A reaction point's bloom radius (m, the Gaussian's sigma). */
  bloom: 0.19,
  /** The liquid's edge: frayed up to `fray` and softened over `soft` (x the edge; fray + soft = POOL_EDGE.fringe). */
  fray: 0.015,
  soft: 0.01,
  /** The swirl's rate (rad/s at the centre; the rim turns about a third as fast, so the streaks shear). */
  swirl: 0.11,
  /** Alpha of the thin rim / the deep middle / the etched floor. */
  alphaRim: 0.55,
  alphaDeep: 0.94,
  alphaEtch: 0.5,
  /** Glow (x the body colour): base, in the streaks, at a reaction; and the hot yellow at a reaction. */
  glow: [0.1, 0.1, 0.26, 0.14] as const,
  /** The foam's own glow (x the body colour): the edge band is where the hazard ends, so it must read in the dark too. */
  foamGlow: 0.08,
  /** Colours (sRGB): deep / body (= ACID.color, passed in) / bright streak / foam / dried crust / etched floor. */
  deep: 0x3a7009,
  bright: 0xe2f25a,
  foam: 0xf0f6cc,
  crust: 0xb4b878,
  etch: 0x232b0d,
} as const;

/** The noise tile's side (texels). RGBA: R, G = two smooth flow noises, B = froth cells (bubble domes), A = fine grain. */
export const LOOK_TILE = 128;
const CELLS = 12;

/** The arithmetic poolLook is written in (numbers on the CPU, TSL nodes on the GPU). */
export interface LookMath<T> {
  add(a: T | number, b: T | number): T;
  sub(a: T | number, b: T | number): T;
  mul(a: T | number, b: T | number): T;
  div(a: T | number, b: T | number): T;
  min(a: T | number, b: T | number): T;
  max(a: T | number, b: T | number): T;
  clamp(x: T, lo: number, hi: number): T;
  mix(a: T | number, b: T | number, t: T): T;
  smoothstep(lo: T | number, hi: T | number, x: T): T;
  sin(x: T): T;
  cos(x: T): T;
  exp(x: T): T;
  pow(x: T, y: number): T;
  /** The noise tile at (u, v), repeating: its four channels (0..1). */
  tile(u: T, v: T): {r: T; g: T; b: T; a: T};
}

export interface LookIn<T> {
  /** The point in the pool's own frame, in units of the radius that hurts (the film mesh's local x / z). */
  qx: T;
  qz: T;
  /** 0 centre .. 1 the liquid's edge .. 2 the hazard circle. */
  rim: T;
  /** Seconds since the pool formed. */
  t: T;
  /** 0 until the pool starts drying, 1 when it is gone. */
  dry: T;
  /** The pool's strength (0..1: weapons/grenades.ts poolStrength). */
  k: T;
  /** The pool's full radius (m). */
  r: T | number;
  /** Per-pool offsets into the tile and the swirl's signed rate (rad/s). */
  ox: T | number;
  oz: T | number;
  swirl: T | number;
  /** Reaction points: metres from the centre, amount (0 = none). */
  react: readonly {x: T | number; z: T | number; a: T | number}[];
}

/** Weights of the palette colours (colour = their sum), opacity, roughness, glow weights and the surface slopes. */
export interface LookOut<T> {
  deep: T; body: T; bright: T; foam: T; crust: T; etch: T;
  alpha: T;
  rough: T;
  /** x the body colour / x the bright colour. */
  glow: T;
  hot: T;
  /** Surface slope along x / z (normal = normalize(-sx, 1, -sz)). */
  sx: T;
  sz: T;
}

/** THE film: every layer at one point (see the header). */
export function poolLook<T>(M: LookMath<T>, i: LookIn<T>): LookOut<T> {
  const K = ACID_LOOK;
  const px = M.mul(i.qx, i.r), pz = M.mul(i.qz, i.r);
  const rc = M.clamp(i.rim, 0, 1), depth = M.sub(1, rc);
  // the slow swirl (the middle turns faster than the rim) and two cross-scrolling flow samples, the first warping the second
  const ang = M.mul(M.mul(i.t, i.swirl), M.add(0.35, M.mul(depth, 0.65)));
  const c = M.cos(ang), s = M.sin(ang);
  const fx = M.sub(M.mul(px, c), M.mul(pz, s)), fz = M.add(M.mul(px, s), M.mul(pz, c));
  const A = M.tile(M.add(M.add(M.mul(fx, 0.5), i.ox), M.mul(i.t, 0.017)), M.sub(M.add(M.mul(fz, 0.5), i.oz), M.mul(i.t, 0.011)));
  const wx = M.mul(M.sub(A.g, 0.5), 0.3), wz = M.mul(M.sub(A.r, 0.5), 0.3);
  const B = M.tile(M.sub(M.add(M.sub(M.mul(fx, 1.15), i.oz), wx), M.mul(i.t, 0.031)), M.add(M.add(M.add(M.mul(fz, 1.15), i.ox), wz), M.mul(i.t, 0.024)));
  const flow = M.add(M.mul(A.r, 0.55), M.mul(B.r, 0.45));
  // froth cells at two scales (they ride the floor, not the swirl: foam clings where it forms)
  const C = M.tile(M.add(M.add(M.add(M.mul(px, 2.4), M.mul(i.ox, 3)), M.mul(wx, 0.5)), M.mul(i.t, 0.03)), M.sub(M.add(M.add(M.mul(pz, 2.4), M.mul(i.oz, 3)), M.mul(wz, 0.5)), M.mul(i.t, 0.02)));
  const D = M.tile(M.sub(M.sub(M.mul(px, 4.3), M.mul(i.oz, 5)), M.mul(i.t, 0.05)), M.add(M.add(M.mul(pz, 4.3), M.mul(i.ox, 5)), M.mul(i.t, 0.04)));
  const cells = M.max(C.b, M.mul(D.b, 0.85));
  // where the acid is working right now: ragged blooms around the reaction points
  const g = 1 / (2 * K.bloom * K.bloom);
  let re: T | null = null;
  for (const p of i.react) {
    const dx = M.add(M.sub(px, p.x), M.mul(wx, 0.4)), dz = M.add(M.sub(pz, p.z), M.mul(wz, 0.4));
    const b = M.mul(p.a, M.exp(M.mul(M.add(M.mul(dx, dx), M.mul(dz, dz)), -g)));
    re = re === null ? b : M.add(re, b);
  }
  const react = re === null ? M.mul(depth, 0) : M.min(re, 1.5);
  // THICKNESS: lobes of pooled liquid inside a thin runny film — the thick body's own edge wanders (it rides the swirl) between about
  // half way out and the rim, so the heavy part of the spill is far from round; the film itself thins toward the rim, unevenly
  const lobes = M.add(0.8, M.mul(M.sub(M.add(M.mul(A.r, 0.6), M.mul(B.g, 0.4)), 0.5), 0.9));
  const pooled = M.sub(1, M.smoothstep(M.sub(lobes, 0.3), M.add(lobes, 0.05), rc));
  const film = M.add(M.sub(0.22, M.mul(rc, 0.12)), M.mul(M.sub(flow, 0.5), 0.16));
  const thick = M.clamp(M.add(film, M.mul(pooled, M.add(0.3, M.mul(flow, 0.6)))), 0, 1);
  // DRYING: the thin film goes first — from the rim inward, in patches — the pooled lobes shrink last
  const d = M.mul(M.pow(i.dry, 1.6), 1.25);
  const wet = M.smoothstep(M.sub(d, 0.22), M.sub(d, 0.02), thick);
  // the liquid's own edge: frayed and soft, always inside the mesh's rim
  const cut = M.sub(1, M.mul(C.a, K.fray));
  const inside = M.sub(1, M.smoothstep(M.sub(cut, K.soft), cut, i.rim));
  const liquid = M.mul(inside, wet);
  // FOAM: the edge band (clumps where the flow piles it up), drifting scum, the reaction blooms; its margin breaks into cells
  const bw = M.add(M.add(0.05, M.mul(M.smoothstep(0.35, 0.75, B.g), 0.2)), M.mul(M.min(react, 1), 0.05));
  const band = M.smoothstep(M.sub(1, bw), 0.985, rc);
  const scum = M.mul(M.smoothstep(0.62, 0.8, M.add(M.mul(A.g, 0.5), M.mul(B.r, 0.5))), 0.55);
  const field = M.add(M.add(band, scum), M.mul(react, 0.8));
  const foam = M.mul(M.smoothstep(0.25, 0.45, M.sub(field, M.mul(M.sub(1, cells), 0.38))), inside);
  // the liquid's colour: body -> deep with the thickness, bright streaks on top
  const tone = M.smoothstep(0.35, 1, thick);
  const streak = M.mul(M.smoothstep(0.5, 0.78, M.add(M.add(M.mul(B.r, 0.6), M.mul(A.g, 0.4)), M.mul(react, 0.15))), 0.5);
  const lf = M.mul(liquid, M.sub(1, foam)), plain = M.mul(lf, M.sub(1, streak));
  // what is left where it dried: the etched floor (also the strip out to the hazard circle) and a crust where the foam was
  const dryW = M.sub(1, liquid), crustA = M.mul(foam, 0.75);
  const hf = M.clamp(M.sub(2, i.rim), 0, 1);
  const etchA = M.mul(M.mul(M.mul(hf, hf), K.alphaEtch), M.add(0.65, M.mul(B.a, 0.35)));
  const liquidA = M.max(M.mix(K.alphaRim, K.alphaDeep, M.smoothstep(0.15, 0.6, thick)), M.mul(foam, 0.97));
  const dryA = M.max(etchA, M.mul(crustA, 0.85));
  // the whole film fades with the pool's strength (a little slower than it while drying: the retreat stays readable)
  const fade = M.min(M.div(i.k, M.pow(M.max(M.sub(1, i.dry), 0.02), 0.4)), 1);
  const shade = M.add(0.7, M.mul(cells, 0.3));
  const churn = M.mul(liquid, M.add(0.6, M.mul(react, 0.9)));
  const froth = M.mul(M.mul(foam, liquid), 0.4);
  return {
    deep: M.mul(plain, tone),
    body: M.mul(plain, M.sub(1, tone)),
    bright: M.mul(lf, streak),
    foam: M.mul(M.mul(liquid, foam), shade),
    crust: M.mul(M.mul(dryW, crustA), shade),
    etch: M.mul(dryW, M.sub(1, crustA)),
    alpha: M.mul(M.mix(dryA, liquidA, liquid), fade),
    rough: M.mix(M.mix(0.5, 0.9, crustA), M.mix(0.07, 0.75, foam), liquid),
    glow: M.mul(fade, M.add(M.mul(lf, M.add(M.add(K.glow[0], M.mul(streak, 2 * K.glow[1])), M.mul(react, K.glow[2]))), M.mul(M.mul(liquid, foam), K.foamGlow))),
    hot: M.mul(M.mul(M.mul(liquid, fade), react), K.glow[3]),
    sx: M.add(M.mul(churn, M.add(M.mul(M.sub(A.g, 0.5), 0.5), M.mul(M.sub(B.g, 0.5), 0.4))), M.mul(froth, M.sub(C.b, 0.5))),
    sz: M.add(M.mul(churn, M.add(M.mul(M.sub(B.r, 0.5), 0.5), M.mul(M.sub(A.r, 0.5), 0.4))), M.mul(froth, M.sub(D.b, 0.5))),
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The noise tile (deterministic data, generated once)

function hash2(x: number, y: number, seed: number): number {
  let h = (Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ Math.imul(seed, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Tileable value noise: `n` lattice cells per tile, smooth interpolation. */
function lattice(u: number, v: number, n: number, seed: number): number {
  const x = u * n, y = v * n, x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0, sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const w = (i: number) => ((i % n) + n) % n;
  const a = hash2(w(x0), w(y0), seed), b = hash2(w(x0 + 1), w(y0), seed), c = hash2(w(x0), w(y0 + 1), seed), e = hash2(w(x0 + 1), w(y0 + 1), seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + e) * sx * sy;
}

let tileData: Uint8Array | null = null;

/** The LOOK_TILE x LOOK_TILE RGBA noise tile (see LOOK_TILE): tileable in both directions, the same bytes every time. */
export function poolNoiseTile(): Uint8Array {
  if (tileData) return tileData;
  const n = LOOK_TILE, ch = [new Float32Array(n * n), new Float32Array(n * n), new Float32Array(n * n), new Float32Array(n * n)];
  // the froth's feature points: one per cell, jittered
  const pts = new Float32Array(CELLS * CELLS * 2);
  for (let j = 0; j < CELLS; j++) for (let i = 0; i < CELLS; i++) {
    pts[(j * CELLS + i) * 2] = (i + 0.1 + 0.8 * hash2(i, j, 31)) / CELLS;
    pts[(j * CELLS + i) * 2 + 1] = (j + 0.1 + 0.8 * hash2(i, j, 32)) / CELLS;
  }
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const u = (x + 0.5) / n, v = (y + 0.5) / n, k = y * n + x;
    ch[0][k] = 0.55 * lattice(u, v, 4, 1) + 0.3 * lattice(u, v, 8, 2) + 0.15 * lattice(u, v, 16, 3);
    ch[1][k] = 0.55 * lattice(u, v, 4, 4) + 0.3 * lattice(u, v, 8, 5) + 0.15 * lattice(u, v, 16, 6);
    ch[3][k] = 0.6 * lattice(u, v, 16, 7) + 0.4 * lattice(u, v, 32, 8);
    // nearest feature point (wrapping): a dome over each cell
    const ci = Math.floor(u * CELLS), cj = Math.floor(v * CELLS);
    let best = 9;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const i = (ci + di + CELLS) % CELLS, j = (cj + dj + CELLS) % CELLS;
      let dx = Math.abs(u - pts[(j * CELLS + i) * 2]), dy = Math.abs(v - pts[(j * CELLS + i) * 2 + 1]);
      if (dx > 0.5) dx = 1 - dx;
      if (dy > 0.5) dy = 1 - dy;
      const d2 = dx * dx + dy * dy;
      if (d2 < best) best = d2;
    }
    const f = Math.sqrt(best) * CELLS / 0.66;
    ch[2][k] = Math.max(0, 1 - f * f);
  }
  const out = new Uint8Array(n * n * 4);
  for (let c = 0; c < 4; c++) {
    // (each channel stretched to the full range: the thresholds in poolLook assume 0..1 with a mean near the middle)
    let lo = Infinity, hi = -Infinity;
    for (const v of ch[c]) { if (v < lo) lo = v; if (v > hi) hi = v; }
    for (let k = 0; k < n * n; k++) out[k * 4 + c] = Math.round(255 * (ch[c][k] - lo) / (hi - lo));
  }
  return (tileData = out);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The CPU side: poolLook over numbers

const fract = (x: number) => x - Math.floor(x);

/** poolLook's arithmetic over numbers; `tile` samples poolNoiseTile bilinearly, repeating (texel centres at half texels, as a GPU sampler). */
export const NUM: LookMath<number> = {
  add: (a, b) => a + b, sub: (a, b) => a - b, mul: (a, b) => a * b, div: (a, b) => a / b,
  min: (a, b) => Math.min(a, b), max: (a, b) => Math.max(a, b),
  clamp: (x, lo, hi) => Math.max(lo, Math.min(hi, x)),
  mix: (a, b, t) => a + (b - a) * t,
  smoothstep: (lo, hi, x) => { const t = Math.max(0, Math.min(1, (x - lo) / (hi - lo))); return t * t * (3 - 2 * t); },
  sin: Math.sin, cos: Math.cos, exp: Math.exp, pow: (x, y) => Math.pow(x, y),
  tile: (u, v) => {
    const d = poolNoiseTile(), n = LOOK_TILE;
    const x = fract(u) * n - 0.5, y = fract(v) * n - 0.5, x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
    const i0 = (x0 + n) % n, i1 = (x0 + 1) % n, j0 = (y0 + n) % n, j1 = (y0 + 1) % n;
    const at = (c: number) => ((d[(j0 * n + i0) * 4 + c] * (1 - fx) + d[(j0 * n + i1) * 4 + c] * fx) * (1 - fy) + (d[(j1 * n + i0) * 4 + c] * (1 - fx) + d[(j1 * n + i1) * 4 + c] * fx) * fy) / 255;
    return {r: at(0), g: at(1), b: at(2), a: at(3)};
  },
};

/** sRGB hex -> linear RGB (the working space the palette is mixed in). */
export function linearRgb(hex: number): [number, number, number] {
  const f = (c: number) => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
  return [f((hex >> 16) & 255), f((hex >> 8) & 255), f(hex & 255)];
}

/** One pool's film as the shader sees it (weapons/acidPoolVisual.ts fills the same values into the material's uniforms). */
export interface PoolLookState {
  /** The spokes' edge radii (weapons/acidPoolShape.ts poolEdgeRing). */
  ring: Float32Array;
  /** Seconds since it formed; 0..1 drying; 0..1 strength; full radius (m). */
  t: number;
  dry: number;
  k: number;
  r: number;
  ox: number;
  oz: number;
  swirl: number;
  /** x, z (m from the centre), amount — ACID_LOOK.reactions triples. */
  react: Float32Array;
}

/** A fresh film state for a shape (full strength, no reactions). */
export function lookState(shape: PoolShape, r: number): PoolLookState {
  const ring = poolEdgeRing(shape, new Float32Array(POOL_EDGE.segments));
  const h = (k: number) => hash2(shape.seed & 0xffff, shape.seed >>> 16, k);
  return {ring, t: 0, dry: 0, k: 1, r, ox: h(11), oz: h(12), swirl: (h(13) < 0.5 ? -1 : 1) * ACID_LOOK.swirl * (0.7 + 0.6 * h(14)), react: new Float32Array(ACID_LOOK.reactions * 3)};
}

/** `rim` of a point (units of the radius that hurts) as the film's mesh interpolates it: 0 centre, 1 its edge, 2 the circle; > 2 off the mesh. */
export function rimAt(ring: Float32Array, qx: number, qz: number): number {
  const rho = Math.hypot(qx, qz);
  if (rho < 1e-9) return 0;
  const e = ringRadius(ring, Math.atan2(qz, qx));
  if (rho <= e) return rho / e;
  return rho <= 1 ? 1 + (rho - e) / Math.max(1e-9, 1 - e) : 3;
}

/**
 * The film at a point of the pool's frame (units of the radius that hurts), on the CPU: linear colour, opacity, roughness, glow and
 * slopes — null off the mesh (beyond the circle that hurts nothing is ever drawn). `body`: the pool's base colour (ACID.color).
 */
export function poolLookAt(st: PoolLookState, body: number, qx: number, qz: number): {rgb: [number, number, number]; alpha: number; rough: number; glow: [number, number, number]; sx: number; sz: number; liquid: number; foam: number} | null {
  const rim = rimAt(st.ring, qx, qz);
  if (rim > 2) return null;
  const react = [];
  for (let i = 0; i < ACID_LOOK.reactions; i++) react.push({x: st.react[i * 3], z: st.react[i * 3 + 1], a: st.react[i * 3 + 2]});
  const o = poolLook(NUM, {qx, qz, rim, t: st.t, dry: st.dry, k: st.k, r: st.r, ox: st.ox, oz: st.oz, swirl: st.swirl, react});
  const P = [linearRgb(ACID_LOOK.deep), linearRgb(body), linearRgb(ACID_LOOK.bright), linearRgb(ACID_LOOK.foam), linearRgb(ACID_LOOK.crust), linearRgb(ACID_LOOK.etch)];
  const w = [o.deep, o.body, o.bright, o.foam, o.crust, o.etch];
  const rgb: [number, number, number] = [0, 0, 0], glow: [number, number, number] = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    for (let j = 0; j < 6; j++) rgb[c] += w[j] * P[j][c];
    glow[c] = o.glow * P[1][c] + o.hot * P[2][c];
  }
  return {rgb, alpha: o.alpha, rough: o.rough, glow, sx: o.sx, sz: o.sz, liquid: o.deep + o.body + o.bright + o.foam, foam: o.foam + o.crust};
}
