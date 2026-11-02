// Task reactor-expansion-20261101 (lane GASLIGHT): THE TOXIC-GAS VISIBILITY RULE (root CLAUDE.md "Toxic gas is always VISIBLE green
// volumetric fog") as pure data + CPU mirrors (no three.js / DOM; shared by the exposure, the volumetric march and the tests).
//
//  - REGIONAL OUTDOOR GAS: outside air above a height inside a world rect, c(y) = c · smoothstep(y0, y1, y). ONE function for what
//    hurts (world/gas/system.ts exposure, world/reactor/air.ts depthGasAt) and what shows (render/volumetricShaders.ts depth term's
//    outdoor part): the Office roof deck (y0 / y1 = world/roofAir.ts's ramp round the deck, c = GAS.ROOF_OUTDOOR_C) and the Reactor's
//    OPEN pit top (above the pit roof line: out of every player's reach, so the toxic sky never hurts anyone who can stand there).
//  - LIGHT SHAFTS through the pit roof's single opening (B's shafts; task reactor-submit-roof-fog-20261102, lane ROOF: one round hole
//    over the core, was the whole open top): a directional sky light that reaches a march point through the opening disc, soft at its
//    rim and broken into patches by the drifting outdoor gas; it lights the haze AND the gas strata (in-scatter only — surfaces keep
//    the baked fixture field).
//  - The FALLBACK when the volumetric pass is off / unsupported / failed: the scene's own FogExp2 is tinted toward the gas green and
//    thickened by the eye concentration for the frame (render/volumetric.ts direct(); in-engine fog, never a CSS / image overlay).
//  - CPU mirrors for the visibility tests: opacity of a gas over a view path and its saturated glow colour.

import type {ReactorInfo} from '../gen/reactor/reactorTypes';
import {roofOpeningOf} from '../gen/reactor/roofOpening';

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
 * The Reactor's surface air: the toxic outdoor atmosphere starts above the pit roof line (pit.roofY: the crane runway / pipe tops
 * stand below it; no deck, ladder or stair reaches it — the rim is at 0, the roof 14-18 m up). c = the Office roof's outdoor air
 * (the same surface atmosphere); vis thins the look so the sky still reads through it from the rim. Task reactor-submit-roof-fog-
 * 20261102 (lane ROOF): the roof is solid now except its single opening over the core, so the march (which stops at the first
 * surface) shows this air only THROUGH the opening; it stays the whole layout rect above the roof line (the outdoors is everywhere
 * up there: the view through the hole keeps its depth at any angle) and the exposure reads the same function.
 */
export const REACTOR_OUTDOOR = {c: 0.6, rampLo: 0.6, rampHi: 6, vis: 0.2} as const;

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
 * Light shafts through the pit roof's single OPENING (the Reactor variant of the march only): the sky light's travel direction
 * (normalised in use: steep, a little slanted like B — task reactor-submit-roof-fog-20261102, lane ROOF: [0.2, -1, 0.12] ->
 * [0.1, -1, 0.06] so the one column through the hole over the core falls on the reactor, ~5 m off its axis at the core floor instead
 * of ~11 m), its linear colour x gain, the soft rim of the column (the curb's penumbra, m), the outdoor gas patches (noise scale,
 * coverage) and the fade with depth below the roof (1/m). (Was: the whole open pit top, striped by the open beam grid's shadows; the
 * grid is now under a solid roof, no beam crosses the opening.)
 */
export const PIT_SHAFTS = {
  dir: [0.1, -1, 0.06] as readonly [number, number, number],
  colour: [0.78, 0.92, 0.62] as readonly [number, number, number],
  gain: 4.5,
  rimSoft: 1.5,
  noiseScale: 0.045, cover: 0.5, coverSoft: 0.16,
  fade: 0.045,
} as const;

/**
 * Shaft geometry of one Reactor: the pit (the march's bound: shafts only inside it, below the roof line), the roof line and the roof
 * OPENING the sky light falls through (a disc in the roof plane: gen/reactor/roofOpening.ts roofOpeningOf).
 */
export interface ShaftSpec {
  rect: {x0: number; z0: number; x1: number; z1: number};
  roofY: number;
  hole: {x: number; z: number; r: number};
}

/** The shaft spec of a Reactor pit: through its roof opening only (null: a closed roof, no shafts). */
export function pitShaftSpec(info: Pick<ReactorInfo, 'pit' | 'core'>): ShaftSpec | null {
  const o = roofOpeningOf(info);
  return o ? {rect: {...info.pit.bounds}, roofY: info.pit.roofY, hole: {x: o.x, z: o.z, r: o.r}} : null;
}

/**
 * CPU mirror of the shaft light at a world point (the march's term without the drifting patch noise: `patch` = the noise value
 * there, 1 = fully open sky): 0 outside the pit / above the roof / where the slanted ray toward the sky meets the solid roof (outside
 * the opening disc); the soft rim inside the disc's edge; the fade with depth. Returns the light intensity factor (multiply
 * PIT_SHAFTS.colour x gain).
 */
export function shaftAt(s: ShaftSpec, x: number, y: number, z: number, patch = 1): number {
  const r = s.rect;
  if (x < r.x0 || x > r.x1 || z < r.z0 || z > r.z1 || y >= s.roofY) return 0;
  const d = PIT_SHAFTS.dir, t = s.roofY - y; // toward the sky: -dir, reaching the roof plane after t / |dir.y|
  const qx = x - d[0] / -d[1] * t, qz = z - d[2] / -d[1] * t;
  const dq = Math.hypot(qx - s.hole.x, qz - s.hole.z);
  if (dq >= s.hole.r) return 0;
  const rim = 1 - sstep(s.hole.r - Math.min(PIT_SHAFTS.rimSoft, s.hole.r), s.hole.r, dq);
  const open = sstep(PIT_SHAFTS.cover - PIT_SHAFTS.coverSoft, PIT_SHAFTS.cover + PIT_SHAFTS.coverSoft, patch);
  return rim * open * Math.exp(-PIT_SHAFTS.fade * t);
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
