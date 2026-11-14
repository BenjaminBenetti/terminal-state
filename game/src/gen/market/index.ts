// Task studio-survivor-market-20261108-005807-01 (lane LEVEL): THE SURVIVOR MARKET (LevelId 'market') — a compact, calm survivor settlement
// in a salvaged railway shed that the player's train pulls into for a pit stop, as ONE continuous StationLayout: `generateMarketLevel(ctx)`.
// Contract: gen/market/marketTypes.ts (layout.market: the six stalls, the residents' spots; the NPC / trade lanes read it).
//
// levels[0] = the shed floor: the track bed + side platform (the train docks here: gen/playerTrain.ts), the stall row (six trader stalls,
// two market gates), the market square, under the deck the workshop (scenery only) / bunk room / communal kitchen; levels[1] = the housing
// deck along the south wall, one open stair up from the square. No enemies, clean air (no gas source of any kind), no free loot (every
// holder carries the empty market key: gen/market/dress.ts), no track extensions. Deterministic from ctx.levelSeed; the level-wide gear /
// mask roll is empty for the market (items/lootTables.ts MARKET_PROFILE gear cap 0; gen/maskLoot.ts market 0 / 0).
//
// Pipeline (the Reactor's / mall's, much smaller): frame (seeded) → carve (Kit with 2 level grids) → crop (fixed origin) → storeys / the
// stair link / apertures / rescue ladders / rails → start → furnishing (own pass, never the abandoned-station dresser) → lift the deck's
// props → lighting (every area lit: a lived-in place) → finishTraversal → layout.market → validation (retry on issues).

import {Rng, hashString} from '../../core/rng';
import {Kit} from '../stationKit';
import {deriveRails, registerApertures} from '../levelGen';
import {Levels, type Level, type LevelLink, type RailRun} from '../levels';
import {finishTraversal, placeLadders} from '../traversal';
import {liftLevels} from '../stationDress';
import {cropKit} from '../office/common';
import {pathRails} from '../reactor/pathsGen';
import type {SectionGenContext} from '../../levels/types';
import type {StationLayout} from '../stationTypes';
import {MARKET_STALLS, type MarketStallId} from './marketTypes';
import {MARKET, marketFrame, marketSeed, type MarketFrame} from './frame';
import {carveMarket, type MarketCarve} from './carve';
import {dressMarket} from './dress';
import {stallName} from './names';
import {marketRecord} from './spots';
import {marketIssues} from './validate';
import {MARKET_LAYOUT_VERSION} from './layoutVersion';
import {generateSettlement, settleStoreyLabel} from './v2/index';
import {settleIssues} from './v2/validate';
import {barSettleIssues} from './v3/barValidate'; // task studio-market-bar-20261108-225231-01 (lane BAR): layout version 3
import {denSettleIssues} from './v4/denValidate'; // task studio-corpse-market-shop-20261114-031614-01 (lane LAYOUT): layout version 4

export {MARKET, MARKET_GENERIC_NAME, marketFrame, marketNameOf, marketSeed} from './frame';
export {MARKET_LAYOUT_LANE, MARKET_LAYOUT_VERSION, marketLayoutVersionFor} from './layoutVersion';
export {SETTLE_GEN_STATS, generateSettlement} from './v2/index';
export {BAR_DECK, barDeckArea} from './v3/barCarve';
export {BAR_RULES, barFloorArea, barSettleIssues} from './v3/barValidate';
export {DEN} from './v4/denCarve'; // (task studio-corpse-market-shop-20261114-031614-01: the corpse buyer's den)
export {DEN_RULES, denIssues, denSettleIssues} from './v4/denValidate';
export {marketIssues} from './validate';
export {MARKET_EMPTY_KEY} from './dress';
export {MARKET_POPULATION, marketStandOk} from './spots';

/** Generation attempts before the last generated layout is returned with its issues. */
const ATTEMPTS = 8;
/** Validation issues of rejected attempts (QA / tests). */
export const MARKET_REJECTS = new Map<string, number>();
/** Timing of the last generateMarketLevel call (ms), its attempts / carve failures and the last attempt's issues (QA / tests). */
export const MARKET_GEN_STATS = {ms: 0, attempts: 0, carveFails: 0, issues: [] as string[]};

/** Storey labels (HUD / map): the shed floor and the housing deck (version 2: the lanes, the catwalks, the rooftops). */
export function marketStoreyLabel(level: number, version = 1): string {
  if (version >= 2) return settleStoreyLabel(level); // (task studio-market-rework-20261108-074144-01)
  return level === 1 ? 'Housing deck' : 'Market floor';
}

/** Any market layout's validation issues (version 1, 2, 3 or 4). */
export function marketLayoutIssues(layout: StationLayout): string[] {
  const v = layout.market?.v;
  return v === 4 ? denSettleIssues(layout) : v === 3 ? barSettleIssues(layout) : v === 2 ? settleIssues(layout) : marketIssues(layout);
}

/**
 * The ONE continuous market layout. Task studio-market-rework-20261108-074144-01 (lane LAYOUT): `ctx.layoutVersion` picks the generator
 * (gen/market/layoutVersion.ts: a station keeps the version it was first built with) — 1 = the first market (below, unchanged), 2 = the
 * dense container settlement (gen/market/v2/), 3 (task studio-market-bar-20261108-225231-01, lane BAR) = that settlement plus
 * the upper-level bar (gen/market/v3/), absent / 4 (task studio-corpse-market-shop-20261114-031614-01) = version 3 plus the corpse
 * buyer's den (gen/market/v4/).
 */
export function generateMarketLevel(ctx: SectionGenContext): StationLayout {
  const version = ctx.layoutVersion ?? MARKET_LAYOUT_VERSION;
  if (version >= 2) return generateSettlement(ctx, {bar: version >= 3, den: version >= 4});
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const seed = marketSeed(ctx.levelSeed);
  let f = marketFrame(ctx.levelSeed);
  let fallback: StationLayout | null = null;
  MARKET_GEN_STATS.carveFails = 0;
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const s = attempt === 0 ? seed : hashString('retry' + attempt, seed);
    const layout = tryLevel(f, s, seed, attempt, ctx);
    MARKET_GEN_STATS.attempts = attempt + 1;
    if (!layout) { MARKET_GEN_STATS.carveFails++; f = marketFrame(ctx.levelSeed, MARKET_GEN_STATS.carveFails); continue; }
    const issues = marketIssues(layout);
    MARKET_GEN_STATS.issues = issues;
    if (!issues.length) { fallback = layout; break; }
    for (const i of new Set(issues.map(q => q.replace(/-?[\d.]+/g, '#')))) MARKET_REJECTS.set(i, (MARKET_REJECTS.get(i) ?? 0) + 1);
    fallback ??= layout;
  }
  MARKET_GEN_STATS.ms = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
  if (fallback) return fallback;
  throw new Error('market level generation failed');
}

/** QA / tests: one attempt (null when the program does not fit). */
export function marketAttempt(ctx: SectionGenContext, attempt: number, salt = 0): StationLayout | null {
  const seed = marketSeed(ctx.levelSeed);
  return tryLevel(marketFrame(ctx.levelSeed, salt), attempt === 0 ? seed : hashString('retry' + attempt, seed), seed, attempt, ctx);
}

function tryLevel(f: MarketFrame, genSeed: number, seed: number, attempt: number, ctx: SectionGenContext): StationLayout | null {
  const rng = new Rng(genSeed);
  const k = new Kit(rng, {levels: MARKET.canvas.levels, w: MARKET.canvas.w, h: MARKET.canvas.h});
  const mc = carveMarket(k, f);
  if (!mc) return null;
  // --- Crop (fixed origin: canvas cells = grid cells) ----------------------------------------------------------------------------
  const c = cropKit(k, [0, 1], 0, 0, k.g.w, k.g.h);
  const levels: Level[] = c.grids.map((grid, id) => ({id, role: id === 0 ? 'main' : 'ring', grid, baseY: mc.bases[id]}));
  const links: LevelLink[] = [];
  {
    const fl = mc.stair.flights.map(i => c.flights[i]);
    const lo = fl.reduce((a, q) => (Math.min(q.h0, q.h1) < Math.min(a.h0, a.h1) ? q : a));
    const hi = fl.reduce((a, q) => (Math.max(q.h0, q.h1) > Math.max(a.h0, a.h1) ? q : a));
    links.push({id: 0, kind: 'stairs', lower: 0, upper: 1, ramp: fl[0].ramp, bottom: {...lo.bottom}, top: {...hi.top}, traversalId: fl[0].id});
  }
  const layout: StationLayout = {
    seed, attempt, name: f.name, archetype: 'side-mezzanine', towards: ['Mainline', 'Siding End'], grid: c.grids[0], areas: k.areas, doors: k.doors,
    props: [], lights: [], signs: [], pickups: [], zombies: [], storefronts: [], decor: [],
    playerSpawn: {x: 0, z: 0, yaw: 0}, trench: c.trenches[0], trenches: c.trenches, platform: mc.platform.id, platforms: [mc.platform.id],
    traversal: {stairs: c.flights, ladders: [], underpasses: []}, levels, levelLinks: links, rails: [],
  };
  mc.platform.towardsN = layout.towards[0];
  registerApertures(layout.levels);
  layout.traversal.ladders = placeLadders(layout);
  layout.rails = marketRails(layout);
  layout.startWeapon = ctx.startWeapon ?? 'rifle';
  startOf(layout, mc);

  // --- Furnishing (own pass), the deck's props onto the deck, lighting, traversal --------------------------------------------------
  const nr = rng.fork('market-names');
  const names = Object.fromEntries(MARKET_STALLS.map(id => [id, stallName(id, nr)])) as Record<MarketStallId, string>;
  const anchors = dressMarket(layout, mc, rng.fork('dress'), names);
  if (!anchors) return null;
  liftLevels(layout, {lights: layout.lights.length, signs: layout.signs.length});
  for (const a of layout.areas) a.lighting = 'lit';
  finishTraversal(layout);
  layout.market = marketRecord(layout, mc, anchors, names, rng.fork('market-spots'));
  return layout;
}

/** The settlement's railings: the derived well edges (the deck's edge over the square) + every other drop (the open stair's sides), no
 *  rail across a seam between storeys at one height (the stair's mouths: gen/reactor/pathsGen.ts pathRails, the shared rule). */
function marketRails(layout: StationLayout): RailRun[] {
  const base = deriveRails(layout.levels);
  const extra = new Levels(layout.levels, layout.levelLinks, base).unrailedDrops();
  return pathRails(layout, [...base, ...extra.map(r => ({...r, h: r.h ?? 1.1}))]);
}

/**
 * Player start: on the platform in front of the market gate nearer the platform's middle, 2 m back from the edge, facing it (south) —
 * the parked train centres on it, so its middle door opens straight onto the gate and the square beyond.
 */
function startOf(layout: StationLayout, mc: MarketCarve): void {
  const g = layout.grid, P = mc.platform, pc = P.x + P.w / 2;
  const gx = mc.gates.map(gt => (gt.rect.x + gt.rect.w / 2)).sort((a, b) => Math.abs(a - pc) - Math.abs(b - pc));
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
