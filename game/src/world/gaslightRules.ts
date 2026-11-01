// Task reactor-expansion-20261101 (lane GASLIGHT): THE TOXIC-GAS VISIBILITY RULE (root CLAUDE.md "Toxic gas is always VISIBLE green
// volumetric fog") as pure data + CPU mirrors (no three.js / DOM; shared by the exposure, the volumetric march and the tests).
//
//  - REGIONAL OUTDOOR GAS: outside air above a height inside a world rect, c(y) = c · smoothstep(y0, y1, y). ONE function for what
//    hurts (world/gas/system.ts exposure, world/reactor/air.ts depthGasAt) and what shows (render/volumetricShaders.ts depth term's
//    outdoor part): the Office roof deck (y0 / y1 = world/roofAir.ts's ramp round the deck, c = GAS.ROOF_OUTDOOR_C) and the Reactor's
//    OPEN pit top (above the pit roof line: out of every player's reach, so the toxic sky never hurts anyone who can stand there).
//  - LIGHT SHAFTS through the open pit top (B's shafts): a directional sky light that reaches a march point through the roof
//    opening, striped by the roof beams' shadows and broken into patches by the drifting outdoor gas; it lights the haze AND the
//    gas strata (in-scatter only — surfaces keep the baked fixture field).
//  - The FALLBACK when the volumetric pass is off / unsupported / failed: the scene's own FogExp2 is tinted toward the gas green and
//    thickened by the eye concentration for the frame (render/volumetric.ts direct(); in-engine fog, never a CSS / image overlay).
//  - CPU mirrors for the visibility tests: opacity of a gas over a view path and its saturated glow colour.

/** Outdoor (regional) gas above a height inside a world rect: c(y) = c · smoothstep(y0, y1, y). */
export interface OutdoorGas {
  rect: {x0: number; z0: number; x1: number; z1: number};
  /** Ramp from 0 at y0 to `c` at y1 (absolute y). */
  y0: number;
  y1: number;
  /** Concentration above the ramp (0..1). */
  c: number;
  /** Visual density scale of the outdoor part relative to the term's extinction (look only: c itself is the hazard). */
  vis: number;
}

const sstep = (a: number, b: number, v: number): number => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** The outdoor gas concentration at a world point (0 outside the rect / below the ramp). Exposure and render read this. */
export function outdoorGasAt(o: OutdoorGas | null, x: number, y: number, z: number): number {
  if (!o || o.c <= 0) return 0;
  const r = o.rect;
  if (x < r.x0 || x > r.x1 || z < r.z0 || z > r.z1) return 0;
  return o.c * sstep(o.y0, o.y1, y);
}

/**
 * The Reactor's open pit top: the toxic surface atmosphere starts above the pit roof line (pit.roofY: the crane runway / pipe tops
 * stand below it; no deck, ladder or stair reaches it — the rim is at 0, the roof 14-18 m up). c = the Office roof's outdoor air
 * (the same surface atmosphere); vis thins the look so the sky still reads through it from the rim.
 */
export const REACTOR_OUTDOOR = {c: 0.6, rampLo: 0.6, rampHi: 6, vis: 0.15} as const;

/** The Reactor's outdoor gas over the layout rect: above roofY + rampLo .. + rampHi. */
export function reactorOutdoorGas(roofY: number, rect: OutdoorGas['rect']): OutdoorGas {
  return {rect, y0: roofY + REACTOR_OUTDOOR.rampLo, y1: roofY + REACTOR_OUTDOOR.rampHi, c: REACTOR_OUTDOOR.c, vis: REACTOR_OUTDOOR.vis};
}

/**
 * The Office roof's outdoor gas term as the march draws it — EXACTLY world/roofAir.ts roofBlend x GAS.ROOF_OUTDOOR_C (footprint
 * +1.5 m, the smooth ramp from the deck - ROOF_FOG.below to + ROOF_FOG.above): pass those numbers in (no import cycle here).
 */
export function officeRoofGas(foot: OutdoorGas['rect'], baseY: number, below: number, above: number, c: number): OutdoorGas {
  return {rect: {x0: foot.x0 - 1.5, z0: foot.z0 - 1.5, x1: foot.x1 + 1.5, z1: foot.z1 + 1.5}, y0: baseY - below, y1: baseY + above, c, vis: ROOF_GAS_LOOK.vis};
}

/**
 * The look of the regional term on the Office roof (no strata there: only the outdoor part). Outdoor air over the open deck is seen
 * across tens of metres, so its extinction per c is far below a breach room's (GAS.EXT 1.1) but it glows the same infectious green.
 */
export const ROOF_GAS_LOOK = {
  ext: 0.3, vis: 0.12, scatter: 0.55, emission: 0.3, wisps: 0.45,
  sheets: 0.35, sheetXZ: 0.03, sheetY: 0.25,
  tint: [0.4, 0.66, 0.24] as readonly [number, number, number],
} as const;

/**
 * Light shafts through the open pit top (the Reactor variant of the march only): the sky light's travel direction (normalised in
 * use: steep, a little slanted like B), its linear colour x gain, the roof-beam stripes (beam half shadow width, soft edge), the
 * outdoor gas patches (noise scale, coverage) and the fade with depth below the roof (1/m).
 */
export const PIT_SHAFTS = {
  dir: [0.2, -1, 0.12] as readonly [number, number, number],
  colour: [0.78, 0.92, 0.62] as readonly [number, number, number],
  gain: 5.5,
  beamHalf: 0.55, beamSoft: 0.7,
  noiseScale: 0.045, cover: 0.5, coverSoft: 0.16,
  fade: 0.045,
} as const;

/** Shaft geometry of one Reactor: the opening rect (the pit outline's bounds), the roof line, the beams (axis + pitch + origin). */
export interface ShaftSpec {
  rect: {x0: number; z0: number; x1: number; z1: number};
  roofY: number;
  /** Beams span along x (their shadows stripe along z: the coordinate across them is z) when 'x', else along z. */
  beamsAlong: 'x' | 'z';
  /** First beam coordinate (across) and the pitch between beams (m). */
  beam0: number;
  pitch: number;
}

/** The shaft spec of a Reactor pit (mirrors world/reactor/archKit.ts planRoof: the beams span the SHORT way, ~6 m apart). */
export function pitShaftSpec(b: {x0: number; z0: number; x1: number; z1: number}, roofY: number): ShaftSpec {
  const spanX = b.x1 - b.x0 <= b.z1 - b.z0; // beams run along x (span the short way) when the pit is narrower in x
  const L0 = spanX ? b.z0 : b.x0, L1 = spanX ? b.z1 : b.x1;
  const n = Math.max(1, Math.round((L1 - L0) / 6));
  return {rect: {...b}, roofY, beamsAlong: spanX ? 'x' : 'z', beam0: L0, pitch: (L1 - L0) / n};
}

/**
 * CPU mirror of the shaft light at a world point (the march's term without the drifting patch noise: `patch` = the noise value
 * there, 1 = fully open sky): 0 outside the pit / above the roof / where the slanted ray leaves through the walls; beam shadows;
 * the fade with depth. Returns the light intensity factor (multiply PIT_SHAFTS.colour x gain).
 */
export function shaftAt(s: ShaftSpec, x: number, y: number, z: number, patch = 1): number {
  const r = s.rect;
  if (x < r.x0 || x > r.x1 || z < r.z0 || z > r.z1 || y >= s.roofY) return 0;
  const d = PIT_SHAFTS.dir, t = s.roofY - y; // toward the sky: -dir, reaching the roof plane after t / |dir.y|
  const qx = x - d[0] / -d[1] * t, qz = z - d[2] / -d[1] * t;
  if (qx < r.x0 || qx > r.x1 || qz < r.z0 || qz > r.z1) return 0;
  const across = s.beamsAlong === 'x' ? qz : qx;
  const f = ((across - s.beam0) / s.pitch) % 1, fr = f < 0 ? f + 1 : f;
  const dist = Math.min(fr, 1 - fr) * s.pitch;
  const stripe = sstep(PIT_SHAFTS.beamHalf, PIT_SHAFTS.beamHalf + PIT_SHAFTS.beamSoft, dist);
  const open = sstep(PIT_SHAFTS.cover - PIT_SHAFTS.coverSoft, PIT_SHAFTS.cover + PIT_SHAFTS.coverSoft, patch);
  return stripe * open * Math.exp(-PIT_SHAFTS.fade * t);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Fallback (no volumetric pass): the scene fog tinted / thickened by the eye concentration

/** Fallback fog: the gas green (LINEAR rgb, three's working space), its blend gain per unit c (capped) and the added density per c. */
export const GAS_FALLBACK = {color: [0.05, 0.1, 0.03] as readonly [number, number, number], blend: 1.4, maxBlend: 0.85, density: 0.16} as const;

/** The fallback's fog for an eye concentration `c` over the scene's own fog (colour rgb 0..1, FogExp2 density). */
export function fallbackFog(c: number, base: {color: readonly [number, number, number]; density: number}): {color: [number, number, number]; density: number; k: number} {
  const cc = Math.max(0, Math.min(1, c));
  const k = Math.min(GAS_FALLBACK.maxBlend, cc * GAS_FALLBACK.blend);
  const g = GAS_FALLBACK.color;
  return {color: [base.color[0] + (g[0] - base.color[0]) * k, base.color[1] + (g[1] - base.color[1]) * k, base.color[2] + (g[2] - base.color[2]) * k], density: base.density + GAS_FALLBACK.density * cc, k};
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Visibility mirrors (tests): a gas look over a view path

/** What a gas look needs for the mirror: extinction per metre at c = 1, emission (ratio of extinction), linear tint. */
export interface GasLookLike { ext: number; emission: number; tint: readonly [number, number, number] }

/** Opacity of a uniform gas of concentration c over `pathM` metres (1 − transmittance). */
export function gasOpacity(look: GasLookLike, c: number, pathM: number, vis = 1): number {
  return 1 - Math.exp(-look.ext * vis * Math.max(0, c) * pathM);
}

/** The unlit glow the gas adds over that path (linear rgb): tint x emission x opacity (the march's emission integral, no lights). */
export function gasGlow(look: GasLookLike, c: number, pathM: number, vis = 1): [number, number, number] {
  const o = gasOpacity(look, c, pathM, vis), e = look.emission;
  return [look.tint[0] * e * o, look.tint[1] * e * o, look.tint[2] * e * o];
}

/** Green dominance of a linear colour: g / max(r, b) (> 1 = reads green). */
export const greenness = (c: readonly [number, number, number]): number => c[1] / Math.max(1e-6, c[0], c[2]);
/** Linear luminance. */
export const luminance = (c: readonly [number, number, number]): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
