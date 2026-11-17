// Task studio-survivor-market-crevice-20261116-074419: THE SURVIVOR MARKET, layout version 5 — THE CREVICE (gen/market/v5/frame.ts), ONE
// continuous StationLayout of four storeys: `generateCrevice(ctx)`. The earlier versions' contract (gen/market/marketTypes.ts: layout.market
// with v = 5 — the six stalls with their display surfaces, the bar's bartender, the corpse buyer's den, the residents' spots) and calm rules
// (no enemies, clean air, no free loot, no track extensions), the same docking (one track bed + side platform; gen/playerTrain.ts).
// Versions 1-4 are untouched (gen/market/index.ts dispatches on the recorded version): this generator draws only from its own streams.
// Layout version 6 (task studio-market-irregular-envelope-20261116-210503-01) is this generator with the IRREGULAR ENVELOPE
// (gen/market/v6/envelope.ts, on its own fork): a taller canvas, the top terrace's alcoves, the overhead, the end clefts, the chasm's bed;
// `generateCrevice(ctx, 5)` (a recorded version 5) never forks it and regenerates exactly as shipped.
// Layout version 7 (task studio-market-irregular-settlement-20261117-003819-01) is version 6 on an IRREGULAR SETTLEMENT FLOORPLAN
// (gen/market/v7/settlement.ts, on its own fork: each storey's container row, terrace walk and the pit's edges in seeded sections) on a
// wider canvas; `generateCrevice(ctx, 6)` never forks it and regenerates exactly as shipped.
//
// Pipeline (version 2's): frame (seeded) → carve (Kit with 4 storey grids) → crop (fixed origin) → storeys / the stair links / apertures /
// rescue ladders / rails → start → furnishing (own pass) → the den → lift the upper storeys' props → lighting (every area lit: a lived-in
// place) → finishTraversal → layout.market (+ its crevice record) → validation (retry on issues).

import {Rng, hashString} from '../../../core/rng';
import {Kit} from '../../stationKit';
import {deriveRails, registerApertures} from '../../levelGen';
import {Levels, type Level, type LevelLink, type RailRun} from '../../levels';
import {finishTraversal, placeLadders} from '../../traversal';
import {liftLevels} from '../../stationDress';
import {cropKit} from '../../office/common';
import {pathRails} from '../../reactor/pathsGen';
import type {SectionGenContext} from '../../../levels/types';
import type {StationLayout} from '../../stationTypes';
import {BAR_STALL, MARKET_STALLS, type MarketStallId} from '../marketTypes';
import {marketSeed} from '../frame';
import {stallName} from '../names';
import {CREVICE, creviceFrame, creviceRows, type CreviceFrame} from './frame';
import {carveCrevice, type CreviceCarve} from './carve';
import {dressCrevice, type CreviceAnchors} from './dress';
import {creviceRecord} from './record';
import {creviceIssues} from './validate';
import {addCreviceDen} from './den';
import {creviceShape} from './shape';
import {ENVELOPE, creviceEnvelopeDrop, creviceEnvelope} from '../v6/envelope';
import {SETTLEMENT, creviceSettlement} from '../v7/settlement';

/** Generation attempts before the last generated layout is returned with its issues. */
const ATTEMPTS = 8;
/** Validation issues of rejected attempts (QA / tests). */
export const CREVICE_REJECTS = new Map<string, number>();
/** Timing of the last generateCrevice call (ms), its attempts / carve failures and the last attempt's issues (QA / tests). */
export const CREVICE_GEN_STATS = {ms: 0, attempts: 0, carveFails: 0, issues: [] as string[]};

/** Storey labels (HUD / map). */
export function creviceStoreyLabel(level: number): string {
  return level === 3 ? 'Upper terrace' : level === 2 ? 'Middle terrace' : level === 1 ? 'Lower terrace' : 'Crevice floor';
}

/** The crevice layout versions this generator builds: 5 (as shipped), 6 (in the irregular envelope) and 7 (+ the irregular settlement). */
export type CreviceVersion = 5 | 6 | 7;

/** The frame a version builds on (version 7: every column moved onto its wider canvas). */
function frameOf(levelSeed: number, salt: number, version: CreviceVersion): CreviceFrame {
  const f = creviceFrame(levelSeed, salt);
  return version >= 7 ? {...f, shift: SETTLEMENT.shift} : f;
}

/** The ONE continuous version-5 (or -6: `version`) market layout. */
export function generateCrevice(ctx: SectionGenContext, version: CreviceVersion = 5): StationLayout {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const seed = marketSeed(ctx.levelSeed);
  let f = frameOf(ctx.levelSeed, 0, version);
  let fallback: StationLayout | null = null;
  CREVICE_GEN_STATS.carveFails = 0;
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const s = attempt === 0 ? seed : hashString('retry' + attempt, seed);
    const layout = tryCrevice(f, s, seed, attempt, ctx, version);
    CREVICE_GEN_STATS.attempts = attempt + 1;
    if (!layout) { CREVICE_GEN_STATS.carveFails++; f = frameOf(ctx.levelSeed, CREVICE_GEN_STATS.carveFails, version); continue; }
    const issues = creviceIssues(layout);
    CREVICE_GEN_STATS.issues = issues;
    if (!issues.length) { fallback = layout; break; }
    for (const i of new Set(issues.map(q => q.replace(/-?[\d.]+/g, '#')))) CREVICE_REJECTS.set(i, (CREVICE_REJECTS.get(i) ?? 0) + 1);
    fallback ??= layout;
  }
  CREVICE_GEN_STATS.ms = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
  if (fallback) return fallback;
  throw new Error(`market (version ${version}) generation failed`);
}

/** QA / tests: one attempt (null when the program does not fit), with its carve. */
export function creviceAttempt(ctx: SectionGenContext, attempt: number, salt = 0, version: CreviceVersion = 5): {layout: StationLayout | null; carve: CreviceCarve | null} {
  const seed = marketSeed(ctx.levelSeed);
  const out = {carve: null as CreviceCarve | null};
  const layout = tryCrevice(frameOf(ctx.levelSeed, salt, version), attempt === 0 ? seed : hashString('retry' + attempt, seed), seed, attempt, ctx, version, out);
  return {layout, carve: out.carve};
}

function tryCrevice(f: CreviceFrame, genSeed: number, seed: number, attempt: number, ctx: SectionGenContext, version: CreviceVersion, out?: {carve: CreviceCarve | null}): StationLayout | null {
  const rng = new Rng(genSeed);
  const H = version >= 6 ? ENVELOPE.canvasH : CREVICE.canvas.h, W = version >= 7 ? SETTLEMENT.canvasW : CREVICE.canvas.w;
  const k = new Kit(rng, {levels: CREVICE.canvas.levels, w: W, h: H});
  // (version 7: the settlement's own fork, the pit it plans fed to the envelope's chasm bed; version 6: the envelope's own fork — Rng.fork
  // never advances the generator's stream)
  const R = creviceRows(f);
  const plan = version >= 7 ? creviceSettlement(R, f, H, rng.fork('settlement')) : undefined;
  const env = version >= 6 ? creviceEnvelope(R, W, H, rng.fork('envelope'), plan) : undefined;
  const cc = carveCrevice(k, f, rng.fork('carve'), env, plan);
  if (!cc) return null;
  if (out) out.carve = cc;
  // --- Crop (fixed origin: canvas cells = grid cells) ----------------------------------------------------------------------------
  const c = cropKit(k, [0, 1, 2, 3], 0, 0, k.g.w, k.g.h);
  const levels: Level[] = c.grids.map((grid, id) => ({id, role: id === 0 ? 'main' : 'ring', grid, baseY: cc.bases[id]}));
  const links: LevelLink[] = [];
  for (const st of cc.stairs) {
    const fl = st.flights.map(i => c.flights[i]);
    const lo = fl.reduce((a, q) => (Math.min(q.h0, q.h1) < Math.min(a.h0, a.h1) ? q : a));
    const hi = fl.reduce((a, q) => (Math.max(q.h0, q.h1) > Math.max(a.h0, a.h1) ? q : a));
    links.push({id: links.length, kind: 'stairs', lower: st.from, upper: st.from + 1, ramp: fl[0].ramp, bottom: {...lo.bottom}, top: {...hi.top}, traversalId: fl[0].id});
  }
  const layout: StationLayout = {
    seed, attempt, name: f.name, archetype: 'side-mezzanine', towards: ['Mainline', 'Siding End'], grid: c.grids[0], areas: k.areas, doors: k.doors,
    props: [], lights: [], signs: [], pickups: [], zombies: [], storefronts: [], decor: [],
    playerSpawn: {x: 0, z: 0, yaw: 0}, trench: c.trenches[0], trenches: c.trenches, platform: cc.platform.id, platforms: [cc.platform.id],
    traversal: {stairs: c.flights, ladders: [], underpasses: []}, levels, levelLinks: links, rails: [],
  };
  cc.platform.towardsN = layout.towards[0];
  registerApertures(layout.levels);
  layout.traversal.ladders = placeLadders(layout);
  layout.rails = creviceRails(layout, cc);
  layout.startWeapon = ctx.startWeapon ?? 'rifle';
  startOf(layout, cc);

  // --- Furnishing (own pass), the den, the upper storeys' props onto their floors, lighting, traversal --------------------------------
  const nr = rng.fork('market-names');
  const names = Object.fromEntries(MARKET_STALLS.map(id => [id, stallName(id, nr)])) as Record<MarketStallId, string>;
  names[BAR_STALL] = stallName(BAR_STALL, rng.fork('market-bar-name'));
  const anchors: CreviceAnchors | null = dressCrevice(layout, cc, rng.fork('dress'), names);
  if (!anchors) return null;
  liftLevels(layout, {lights: layout.lights.length, signs: layout.signs.length});
  for (const a of layout.areas) a.lighting = 'lit';
  finishTraversal(layout);
  layout.market = creviceRecord(layout, cc, anchors, names, rng.fork('market-spots'), version);
  // the corpse buyer's den: carved into the rock behind its entry box by the square, furnished on its own fork (gen/market/v5/den.ts)
  if (!addCreviceDen(layout, cc, rng.fork('market-den'))) return null;
  layout.market = {...layout.market, crevice: creviceShape(layout, cc)};
  return layout;
}

/**
 * The crevice's railings: the derived well edges (every terrace / bridge / deck edge over a lower storey) + every other drop (the low
 * walks over the chasm, the stair runs' open sides), no rail across a seam between storeys at one height (the stairs' mouths)
 * (gen/reactor/pathsGen.ts pathRails, the shared rule). A bridge's own railings are the cooked bridge kit's: its rail runs are kept for
 * collision but drawn by the bridge (hidden).
 */
function creviceRails(layout: StationLayout, cc: CreviceCarve): RailRun[] {
  const base = deriveRails(layout.levels);
  // (version 6: no railing round an end cleft's lip — its floor is out of reach, high over the top terrace — nor along the steps
  // between the chasm bed's shelves, under the walks' railings: creviceEnvelopeDrop)
  const extra = new Levels(layout.levels, layout.levelLinks, base).unrailedDrops().filter(r => !cc.envelope || !creviceEnvelopeDrop(layout, r));
  const rails = pathRails(layout, [...base, ...extra.map(r => ({...r, h: r.h ?? 1.1}))]);
  const CELL = 0.5;
  for (const r of rails) {
    for (const b of cc.bridges) {
      if (r.level !== b.level) continue;
      const x0 = b.rect.x * CELL, x1 = (b.rect.x + b.rect.w) * CELL, z0 = b.rect.y * CELL, z1 = (b.rect.y + b.rect.h) * CELL;
      const along = Math.abs(r.z0 - r.z1) < 1e-6 && (Math.abs(r.z0 - z0) < 1e-6 || Math.abs(r.z0 - z1) < 1e-6) && Math.min(r.x0, r.x1) >= x0 - 1e-6 && Math.max(r.x0, r.x1) <= x1 + 1e-6;
      if (along) r.hidden = true;
    }
  }
  return rails;
}

/**
 * Player start: on the platform in front of the gate nearer the platform's middle, 2 m back from the edge, facing it (south) — the parked
 * train centres on it, so its middle door opens straight onto the gate and the square beyond (version 1's rule).
 */
function startOf(layout: StationLayout, cc: CreviceCarve): void {
  const g = layout.grid, P = cc.platform, pc = P.x + P.w / 2;
  const gx = cc.gates.map(gt => (gt.rect.x + gt.rect.w / 2)).sort((a, b) => Math.abs(a - pc) - Math.abs(b - pc));
  const sx0 = Math.round(gx[0]), sy0 = P.y + 4;
  let spot: [number, number] | null = null;
  search: for (let r = 0; r < 24; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
    const x = sx0 + dx, y = sy0 + dy;
    if (y < P.y + 3 || y > P.y + P.h - 3 || !g.inBounds(x, y) || g.area[g.idx(x, y)] !== P.id) continue;
    let ok = true;
    for (let qy = -2; qy <= 2 && ok; qy++) for (let qx = -2; qx <= 2; qx++) if (!g.walkable(x + qx, y + qy)) { ok = false; break; }
    if (ok) { spot = [x, y]; break search; }
  }
  const [wx, wz] = g.center(...(spot ?? [sx0, sy0]));
  layout.playerSpawn = {x: wx, z: wz, yaw: Math.PI}; // forward = (-sin yaw, -cos yaw) = (0, +1): south, toward the gates
}
