// Task mall-round3-20261031 (lane LIGHT, R7): the decay of the mall's PUBLIC WALKWAY lighting — PURE (no three.js).
//
// User feedback: "the main walking area of the mall ... is really well lit ... to sell the state of decay a bit, lets cut lighting in
// this area by 50% i.e. 50% of the lights above this area specifically should be burned out or flickering / off color."
//
// Where the light comes from: the station dresser hangs the walkway fixtures (gen/stationDress.ts: dressArcade lineLights every 4.5 m
// down each retail-floor walkway rectangle, dressExitHall gridLights in the level-0 Fountain court); applyLighting gives those areas
// the 'lit' profile (LIGHT_ODDS 'retail-arcade' / 'concourse' = [1, 0, 0]: ~7 % dead, ~10 % flickering, >= 60 % working), so the
// walkways read as a fully lit, working mall. World/lights.ts bakes every working fixture into the light field and shows each
// fixture's state on its tube / downlight lens (+ glow card); nothing else lights the walkways except the skylight bake
// (world/mallSkylight.ts, independent of the fixtures: unchanged here).
//
// This pass (gen/mall/index.ts, after applyLighting + dropFloatingFixtures, on its own RNG fork: no other draw moves) re-assigns
// the state of the walkway fixtures only — the retail floors' public walkways (MallInfo.galleries: atrium courts, galleries,
// corridor wings, secondary courts, the food-court gallery; area role 'mall') and the level-0 Fountain court (role 'great-hall').
// Platforms, public stair / escalator runs, shopfront recesses, washroom passages, shops, stock rooms and back of house keep
// applyLighting's state. With the existing runtime only (layout state -> bake + tubes; the three flicker circuits):
//  - DEAD (~50 %): burned out (broken: no light in the bake, dark lens, no glow card), a fifth of them sputtering ('dying' circuit:
//    dark apart from brief bursts);
//  - FLICKERING (~14 %): circuits 0 / 1 (mostly on, irregular stutters);
//  - OFF-COLOUR (~14 %): an aged tube at reduced output with a tint (sickly green / cold blue / pink / deep amber) — the bake uses
//    LightPlacement.tint, the tube / lens and glow show it (world/builder.ts passes it on);
//  - NORMAL: the rest, as before (applyLighting power, warm / cool mix).
// Spatially mixed and playable: deterministic random order under a GAP rule — every walkway fixture keeps a lit (not dead)
// walkway fixture within WALKWAY_LIGHTS.gapM on its storey in line of sight (on the 4.5 m lines: at most two dark fixtures in a
// row); the walkway fixture nearest each escalator / stair mouth and each elevator landing, and the Fountain court fixtures
// around the start (SPAWN_LIT_RADIUS, as applyLighting), stay steady and working.

import type {Rng} from '../../core/rng';
import {SPAWN_LIT_RADIUS, type Area, type LightPlacement, type StationLayout} from '../stationTypes';

/** Tunables of the walkway decay. Shares are of all walkway fixtures. */
export const WALKWAY_LIGHTS = {
  /** Dark share (burned out + sputtering), as far as the gap rule allows. */
  dead: 0.5,
  /** Of the dark fixtures: sputtering ('dying' circuit, mostly dark) instead of burned out. */
  sputter: 0.2,
  /** Flickering share (flicker circuits 0 / 1). */
  flicker: 0.14,
  /** Off-colour share (tinted, reduced output). */
  offColour: 0.14,
  /** Output of an off-colour tube [min, max]. */
  offPower: [0.55, 0.75] as readonly [number, number],
  /** Output of a sputtering tube (applyLighting's dying tube). */
  sputterPower: 0.5,
  /** Every walkway fixture keeps a lit walkway fixture within this distance (m, same storey, line of sight). */
  gapM: 6.5,
  /** The nearest walkway fixture to an escalator / stair mouth or an elevator landing within this distance (m) stays working. */
  anchorM: 6,
};

/** Off-colour tints (linear RGB, ~unit luminance like lightField TINT): failing / mismatched tubes. */
export const OFF_COLOURS: readonly (readonly [number, number, number])[] = [
  [0.7, 1.1, 0.55], // sickly green
  [0.72, 0.98, 1.45], // cold blue-white
  [1.45, 0.78, 1.15], // pink (failing ballast)
  [1.55, 0.82, 0.3], // deep amber
];

export type WalkwayLightState = 'dead' | 'sputter' | 'flicker' | 'off-colour' | 'normal';

export interface WalkwayLightReport {
  /** Walkway fixtures (non-virtual) and their states after the pass. */
  fixtures: number; dead: number; sputter: number; flicker: number; offColour: number; normal: number;
  /** Fixtures held working (mouths / landings / start). */
  anchors: number;
  /** Dark fixtures the gap rule refused (target - dark). */
  shortfall: number;
}

/** A public walkway of the mall: a retail-floor walkway (role 'mall') or the level-0 Fountain court (role 'great-hall'). */
export function isWalkwayArea(a: Pick<Area, 'role' | 'level'> | undefined): boolean {
  return !!a && (a.role === 'mall' || (a.role === 'great-hall' && (a.level ?? 0) === 0));
}

/** Storey of a fixture. */
const levelOf = (layout: StationLayout, l: LightPlacement): number => l.level ?? layout.areas[l.area]?.level ?? 0;

/** Indices into layout.lights of the walkway fixtures (real fixtures only: virtual daylight sources are not lights overhead). */
export function walkwayLightIndices(layout: StationLayout): number[] {
  const out: number[] = [];
  layout.lights.forEach((l, i) => { if (!l.virtual && isWalkwayArea(layout.areas[l.area])) out.push(i); });
  return out;
}

/** State class of a fixture (as the pass assigns it). */
export function walkwayLightState(l: LightPlacement): WalkwayLightState {
  if (l.broken) return 'dead';
  if (l.dying) return 'sputter';
  if (l.flicker) return 'flicker';
  if (l.tint) return 'off-colour';
  return 'normal';
}

/**
 * Re-assigns the walkway fixtures' state (mall only; see the header). Deterministic from `rng`; every other fixture untouched.
 */
export function decayWalkwayLights(layout: StationLayout, rng: Rng, P: typeof WALKWAY_LIGHTS = WALKWAY_LIGHTS): WalkwayLightReport {
  const idx = walkwayLightIndices(layout);
  const n = idx.length;
  const L = idx.map(i => layout.lights[i]);
  const lv = L.map(l => levelOf(layout, l));
  // Neighbours within gapM on the same storey, in line of sight on that storey's grid (only SOLID cells block).
  const g2 = P.gapM * P.gapM;
  const nb: number[][] = L.map(() => []);
  for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) {
    if (lv[a] !== lv[b]) continue;
    const dx = L[b].x - L[a].x, dz = L[b].z - L[a].z, d2 = dx * dx + dz * dz;
    if (d2 > g2) continue;
    const g = layout.levels?.[lv[a]]?.grid ?? layout.grid, d = Math.sqrt(d2);
    if (d > 1e-6 && g.raycast(L[a].x, L[a].z, dx, dz, d, true) < d - 1e-4) continue;
    nb[a].push(b); nb[b].push(a);
  }
  // Anchors: the walkway fixture nearest each escalator / stair mouth and elevator landing; the Fountain court around the start.
  const anchor = new Uint8Array(n);
  const pts: {lv: number; x: number; z: number}[] = [];
  for (const v of layout.mall?.verticals ?? []) {
    if (v.kind === 'service-stair') continue;
    if (v.kind === 'elevator') { for (let k = v.lower; k <= v.upper; k++) pts.push({lv: k, x: v.foot.x, z: v.foot.z}); continue; }
    pts.push({lv: v.lower, x: v.foot.x, z: v.foot.z}, {lv: v.upper, x: v.head.x, z: v.head.z});
  }
  const a2 = P.anchorM * P.anchorM;
  for (const p of pts) {
    let best = -1, bd = a2;
    for (let k = 0; k < n; k++) {
      if (lv[k] !== p.lv) continue;
      const d2 = (L[k].x - p.x) ** 2 + (L[k].z - p.z) ** 2;
      if (d2 < bd) { bd = d2; best = k; }
    }
    if (best >= 0) anchor[best] = 1;
  }
  const sp = layout.playerSpawn, s2 = SPAWN_LIT_RADIUS * SPAWN_LIT_RADIUS;
  for (let k = 0; k < n; k++) if (lv[k] === 0 && (L[k].x - sp.x) ** 2 + (L[k].z - sp.z) ** 2 < s2) anchor[k] = 1;
  // Start from steady working fixtures (applyLighting's output power and warm / cool mix kept).
  for (const l of L) { l.broken = false; l.flicker = false; l.dying = false; delete l.tint; }
  // Dark set: random order, each kill only if the gap rule still holds for it and for every dark neighbour.
  const alive = new Uint8Array(n).fill(1);
  const target = Math.round(n * P.dead);
  const free = rng.shuffle(Array.from({length: n}, (_, k) => k).filter(k => !anchor[k]));
  const dark: number[] = [];
  for (const c of free) {
    if (dark.length >= target) break;
    if (!nb[c].some(j => alive[j])) continue;
    if (nb[c].some(j => !alive[j] && !nb[j].some(q => q !== c && alive[q]))) continue;
    alive[c] = 0;
    dark.push(c);
  }
  const sputter = Math.round(dark.length * P.sputter);
  rng.shuffle(dark).forEach((k, r) => {
    const l = L[k];
    if (r < sputter) { l.dying = true; l.flicker = true; l.power = P.sputterPower; } else l.broken = true;
  });
  // Flickering, then off-colour, among the lit non-anchor fixtures.
  const lit = rng.shuffle(free.filter(k => alive[k]));
  const nf = Math.min(lit.length, Math.round(n * P.flicker));
  const no = Math.min(lit.length - nf, Math.round(n * P.offColour));
  for (let r = 0; r < nf + no; r++) {
    const l = L[lit[r]];
    if (r < nf) { l.flicker = true; continue; }
    l.tint = rng.pick(OFF_COLOURS);
    l.power = Math.round(rng.range(P.offPower[0], P.offPower[1]) * 1000) / 1000;
  }
  return {...walkwayLightCounts(layout), anchors: anchor.reduce((s, v) => s + v, 0), shortfall: target - dark.length};
}

/** Walkway fixture counts by state (any layout: QA / tests / the before-after report). */
export function walkwayLightCounts(layout: StationLayout): Omit<WalkwayLightReport, 'anchors' | 'shortfall'> {
  const c = {fixtures: 0, dead: 0, sputter: 0, flicker: 0, offColour: 0, normal: 0};
  for (const i of walkwayLightIndices(layout)) {
    c.fixtures++;
    const s = walkwayLightState(layout.lights[i]);
    if (s === 'dead') c.dead++; else if (s === 'sputter') c.sputter++; else if (s === 'flicker') c.flicker++; else if (s === 'off-colour') c.offColour++; else c.normal++;
  }
  return c;
}
