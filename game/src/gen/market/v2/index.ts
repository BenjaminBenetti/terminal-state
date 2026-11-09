// Task studio-market-rework-20261108-074144-01 (lane LAYOUT): THE SURVIVOR MARKET, layout version 2 — the dense, lived-in container
// settlement (gen/market/v2/frame.ts), ONE continuous StationLayout of three storeys: `generateSettlement(ctx)`. Same contract as
// version 1 (gen/market/marketTypes.ts, layout.market with v = 2 and the stalls' display surfaces), same calm rules (no enemies, clean
// air, no free loot, no track extensions), the same docking (one track bed + side platform; gen/playerTrain.ts).
//
// Pipeline (version 1's): frame (seeded) → carve (Kit with 3 storey grids) → crop (fixed origin) → storeys / the stair links /
// apertures / rescue ladders / the rooftop ladders / rails → start → furnishing (own pass) → lift the upper storeys' props → lighting
// (every area lit: a lived-in place) → finishTraversal → layout.market → validation (retry on issues).

import {Rng, hashString} from '../../../core/rng';
import {CELL, FLOOR, SOLID} from '../../grid';
import {Kit} from '../../stationKit';
import {deriveRails, registerApertures} from '../../levelGen';
import {Levels, type Level, type LevelLink, type RailRun} from '../../levels';
import {LADDER, finishTraversal, placeLadders, type Ladder} from '../../traversal';
import {liftLevels} from '../../stationDress';
import {cropKit} from '../../office/common';
import {pathRails} from '../../reactor/pathsGen';
import type {SectionGenContext} from '../../../levels/types';
import type {StationLayout} from '../../stationTypes';
import {BAR_STALL, MARKET_STALLS, type MarketStallId} from '../marketTypes';
import {marketSeed} from '../frame';
import {stallName} from '../names';
import {SETTLE, settleFrame, type SettleFrame} from './frame';
import {carveSettlement, type SettleCarve} from './carve';
import {dressSettlement} from './dress';
import {settleRecord} from './record';
import {settleIssues} from './validate';
// task studio-market-bar-20261108-225231-01 (lane BAR): layout version 3 = this settlement + the upper-level bar (gen/market/v3/)
import {carveBar, type BarCarve} from '../v3/barCarve';
import {dressBar} from '../v3/barDress';
import {barRecord} from '../v3/barRecord';
import {barSettleIssues} from '../v3/barValidate';

/** Generation attempts before the last generated layout is returned with its issues. */
const ATTEMPTS = 8;
/** Validation issues of rejected attempts (QA / tests). */
export const SETTLE_REJECTS = new Map<string, number>();
/** Timing of the last generateSettlement call (ms), its attempts / carve failures and the last attempt's issues (QA / tests). */
export const SETTLE_GEN_STATS = {ms: 0, attempts: 0, carveFails: 0, issues: [] as string[]};

/** Rooftops without a clear ladder spot (QA / tests). */
export const LADDER_FAILS: string[] = [];

/** Storey labels (HUD / map). */
export function settleStoreyLabel(level: number): string {
  return level === 2 ? 'Rooftops' : level === 1 ? 'Catwalks' : 'Market lanes';
}

/**
 * The ONE continuous version-2 market layout. Task studio-market-bar-20261108-225231-01 (lane BAR): `opts.bar` — layout version 3, the
 * same settlement plus the upper-level bar (gen/market/v3/: its carve before the crop, its furnishing after version 2's, its record and
 * checks after version 2's; every draw of its own from forks, so version 2's stream is untouched). Version 2 is `bar` false (the default).
 */
export function generateSettlement(ctx: SectionGenContext, opts: {bar?: boolean} = {}): StationLayout {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const seed = marketSeed(ctx.levelSeed);
  const bar = opts.bar === true;
  let f = settleFrame(ctx.levelSeed);
  let fallback: StationLayout | null = null;
  SETTLE_GEN_STATS.carveFails = 0;
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const s = attempt === 0 ? seed : hashString('retry' + attempt, seed);
    const layout = trySettlement(f, s, seed, attempt, ctx, undefined, bar);
    SETTLE_GEN_STATS.attempts = attempt + 1;
    if (!layout) { SETTLE_GEN_STATS.carveFails++; f = settleFrame(ctx.levelSeed, SETTLE_GEN_STATS.carveFails); continue; }
    const issues = bar ? barSettleIssues(layout) : settleIssues(layout);
    SETTLE_GEN_STATS.issues = issues;
    if (!issues.length) { fallback = layout; break; }
    for (const i of new Set(issues.map(q => q.replace(/-?[\d.]+/g, '#')))) SETTLE_REJECTS.set(i, (SETTLE_REJECTS.get(i) ?? 0) + 1);
    fallback ??= layout;
  }
  SETTLE_GEN_STATS.ms = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
  if (fallback) return fallback;
  throw new Error('market (version 2) generation failed');
}

/** QA / tests: one attempt (null when the program does not fit); `bar`: version 3's. */
export function settlementAttempt(ctx: SectionGenContext, attempt: number, salt = 0, bar = false): {layout: StationLayout | null; carve: SettleCarve | null; bar: BarCarve | null} {
  const seed = marketSeed(ctx.levelSeed);
  const out = {carve: null as SettleCarve | null, bar: null as BarCarve | null};
  const layout = trySettlement(settleFrame(ctx.levelSeed, salt), attempt === 0 ? seed : hashString('retry' + attempt, seed), seed, attempt, ctx, out, bar);
  return {layout, carve: out.carve, bar: out.bar};
}

function trySettlement(f: SettleFrame, genSeed: number, seed: number, attempt: number, ctx: SectionGenContext, out?: {carve: SettleCarve | null; bar?: BarCarve | null}, bar = false): StationLayout | null {
  const rng = new Rng(genSeed);
  const k = new Kit(rng, {levels: SETTLE.canvas.levels, w: SETTLE.canvas.w, h: SETTLE.canvas.h});
  const sc = carveSettlement(k, f, rng.fork('carve'));
  if (!sc) return null;
  if (out) out.carve = sc;
  // (version 3) the bar deck over the yard, before the crop (no draw: geometry only)
  const bc = bar ? carveBar(k, sc, 'Bar') : null;
  if (bar && !bc) return null;
  if (out && bc) out.bar = bc;
  // --- Crop (fixed origin: canvas cells = grid cells) ----------------------------------------------------------------------------
  const c = cropKit(k, [0, 1, 2], 0, 0, k.g.w, k.g.h);
  const levels: Level[] = c.grids.map((grid, id) => ({id, role: id === 0 ? 'main' : 'ring', grid, baseY: sc.bases[id]}));
  const links: LevelLink[] = [];
  for (const st of sc.stairs) {
    const fl = st.flights.map(i => c.flights[i]);
    const lo = fl.reduce((a, q) => (Math.min(q.h0, q.h1) < Math.min(a.h0, a.h1) ? q : a));
    const hi = fl.reduce((a, q) => (Math.max(q.h0, q.h1) > Math.max(a.h0, a.h1) ? q : a));
    links.push({id: links.length, kind: 'stairs', lower: 0, upper: 1, ramp: fl[0].ramp, bottom: {...lo.bottom}, top: {...hi.top}, traversalId: fl[0].id});
  }
  const layout: StationLayout = {
    seed, attempt, name: f.name, archetype: 'side-mezzanine', towards: ['Mainline', 'Siding End'], grid: c.grids[0], areas: k.areas, doors: k.doors,
    props: [], lights: [], signs: [], pickups: [], zombies: [], storefronts: [], decor: [],
    playerSpawn: {x: 0, z: 0, yaw: 0}, trench: c.trenches[0], trenches: c.trenches, platform: sc.platform.id, platforms: [sc.platform.id],
    traversal: {stairs: c.flights, ladders: [], underpasses: []}, levels, levelLinks: links, rails: [],
  };
  sc.platform.towardsN = layout.towards[0];
  registerApertures(layout.levels);
  layout.traversal.ladders = placeLadders(layout);
  const roofLadders = rooftopLadders(layout, sc);
  if (!roofLadders) return null;
  layout.rails = settleRails(layout);
  layout.startWeapon = ctx.startWeapon ?? 'rifle';
  startOf(layout, sc);

  // --- Furnishing (own pass), the upper storeys' props onto their floors, lighting, traversal -------------------------------------
  const nr = rng.fork('market-names');
  const names = Object.fromEntries(MARKET_STALLS.map(id => [id, stallName(id, nr)])) as Record<MarketStallId, string>;
  // (the placement kit holds every traversal ladder's stand cells clear on the GROUND storey — the rooftop ladders stand on the catwalks:
  // their level links keep their feet / heads clear on their own storeys instead, so they are left out of that list while dressing)
  layout.traversal.ladders = layout.traversal.ladders.filter(l => l.kind !== 'maintenance');
  const anchors = dressSettlement(layout, sc, rng.fork('dress'), names);
  layout.traversal.ladders.push(...roofLadders);
  if (!anchors) return null;
  // (version 3) the covered yard's lamps hang under the deck; the bar's furnishing (its own forks: the name, the dressing)
  const barName = bc ? stallName(BAR_STALL, rng.fork('market-bar-name')) : '';
  const barDressed = bc ? dressBar(layout, bc, rng.fork('market-bar'), barName) : null;
  if (bc) {
    if (!barDressed) return null;
    for (const l of layout.lights) if (l.area === sc.lanes.yard.id && (l.level ?? 0) === 0 && l.y > SETTLE.cont) l.y = SETTLE.cont - 0.05;
  }
  liftLevels(layout, {lights: layout.lights.length, signs: layout.signs.length});
  for (const a of layout.areas) a.lighting = 'lit';
  finishTraversal(layout);
  // finishTraversal's rescue-ladder plate ('EMERGENCY LADDER', storey-less) is not for the rooftop ladders (the Reactor's rule)
  layout.signs = layout.signs.filter(s => !roofLadders.some(q => Math.abs(q.x + 0.95 - s.x) < 1e-6 && Math.abs(q.bottomY + 0.72 - s.y) < 1e-6));
  layout.market = settleRecord(layout, sc, anchors, names, rng.fork('market-spots'));
  if (bc && barDressed) layout.market = barRecord(layout, sc, bc, barDressed, barName, rng.fork('market-bar-spots'), layout.market);
  return layout;
}

/**
 * The settlement's railings: the derived well edges (every catwalk / bridge / rooftop edge over a lane) + every other drop (the stair
 * runs' open sides), no rail across a seam between storeys at one height (the stairs' mouths), real openings at the rooftop ladder heads
 * (gen/reactor/pathsGen.ts pathRails, the shared rule).
 */
function settleRails(layout: StationLayout): RailRun[] {
  const base = deriveRails(layout.levels);
  const extra = new Levels(layout.levels, layout.levelLinks, base).unrailedDrops();
  return pathRails(layout, [...base, ...extra.map(r => ({...r, h: r.h ?? 1.1}))]);
}

/**
 * The rooftop ladders: one per rooftop (the front row's, the back row's, each block's), a steel ladder up the upper container's wall from
 * its catwalk (storey 1) to the rooftop edge (storey 2) — traversal.ladders kind 'maintenance' (drawn, climbed, its railing opening) and a
 * PLAYER-ONLY 'ladder' level link (no traversal id: the residents' paths never climb). Placed on a closed container's wall when the
 * rooftop has one, else on a wall run clear of every home door; null when a rooftop has no clear spot.
 */
function rooftopLadders(layout: StationLayout, sc: SettleCarve): Ladder[] | null {
  const g1 = layout.levels[1].grid, g2 = layout.levels[2].grid;
  const [, B1, B2] = sc.bases;
  const R = sc.rows, S = SETTLE;
  const W = layout.grid.w;
  const M = (x: number) => (sc.f.mirror ? W - 1 - x : x); // a canonical column -> world column
  const doors = layout.doors.filter(d => d.level === 1);
  const out: Ladder[] = [];
  /** Per rooftop, its candidate walls: the wall row (world), the ladder's face z, direction toward the rooftop, the x span (world cells). */
  type Face = {row: number; faceZ: number; dir: 1 | -1; x0: number; x1: number; prefer: number};
  const roofs: Face[][] = [];
  const span = (cx0: number, cx1: number) => { const a = M(cx0), b = M(cx1 - 1); return [Math.min(a, b), Math.max(a, b) + 1] as const; };
  const preferIn = (x0: number, x1: number, rowY: number) => {
    const c = sc.closed.find(r => r.y <= rowY && r.y + r.h > rowY && r.x >= x0 && r.x + r.w <= x1);
    return c ? c.x + c.w / 2 : (x0 + x1) / 2;
  };
  {
    const [x0, x1] = span(S.x0, S.x1), row = R.pw + S.rowD - S.cat - 1;
    roofs.push([{row, faceZ: (row + 1) * CELL, dir: -1, x0, x1, prefer: preferIn(x0, x1, row)}]);
  }
  {
    const [x0, x1] = span(S.x0, S.x1), row = R.b0 + S.cat;
    roofs.push([{row, faceZ: row * CELL, dir: 1, x0, x1, prefer: preferIn(x0, x1, row)}]);
  }
  for (const b of sc.blocks) {
    const u = b.upper, prefer = u.x + u.w / 2;
    roofs.push([{row: u.y, faceZ: u.y * CELL, dir: 1, x0: u.x, x1: u.x + u.w, prefer}, {row: u.y + u.h - 1, faceZ: (u.y + u.h) * CELL, dir: -1, x0: u.x, x1: u.x + u.w, prefer}]);
  }
  for (const faces of roofs) {
    const cands: [Face, number][] = [];
    for (const rf of faces) for (let x = rf.x0 + 2; x < rf.x1 - 2; x++) cands.push([rf, x]);
    cands.sort(([p, a], [q, b]) => Math.abs(a + 0.5 - p.prefer) - Math.abs(b + 0.5 - q.prefer) || a - b || p.row - q.row);
    let done = false;
    for (const [rf, cx] of cands) {
      const x = r3((cx + 0.5) * CELL);
      // the wall itself (3 cells, no opening) and no home door within 1 m of the ladder
      let wall = true;
      for (let dx = -1; dx <= 1; dx++) if (g1.cells[g1.idx(cx + dx, rf.row)] !== SOLID) wall = false;
      if (!wall || doors.some(d => d.y === rf.row && cx + 2 >= d.x && cx - 2 < d.x + d.w)) continue;
      const bottom = {x, y: B1, z: r3(rf.faceZ - rf.dir * LADDER.standOff)}, top = {x, y: B2, z: r3(rf.faceZ + rf.dir * LADDER.topIn)};
      const [bx, by] = g1.cellOf(bottom.x, bottom.z), [tx, ty] = g2.cellOf(top.x, top.z);
      if (g1.cells[g1.idx(bx, by)] !== FLOOR || g2.cells[g2.idx(tx, ty)] !== FLOOR) continue;
      if (!g1.circleClearH(bottom.x, bottom.z, 0.3, B1) || !g2.circleClearH(top.x, top.z, 0.34, B2)) continue;
      const id = layout.traversal.ladders.length;
      const l: Ladder = {id, trench: -1, platform: g2.area[g2.idx(tx, ty)], x, faceZ: r3(rf.faceZ), dir: rf.dir, bottomY: B1, topY: B2, bottom, top, pair: -1, link: -1, kind: 'maintenance', level: 1, topLevel: 2};
      layout.traversal.ladders.push(l);
      layout.levelLinks.push({id: layout.levelLinks.length, kind: 'ladder', lower: 1, upper: 2, bottom: {...bottom}, top: {...top}, cost: LADDER.cost});
      out.push(l);
      done = true;
      break;
    }
    if (!done) { LADDER_FAILS.push(`no ladder spot: row ${faces[0].row} x ${faces[0].x0}..${faces[0].x1}`); return null; }
  }
  return out;
}

/**
 * Player start: on the platform in front of the gate nearer the platform's middle, 2 m back from the edge, facing it (south) — the
 * parked train centres on it, so its middle door opens straight onto the gate (version 1's rule).
 */
function startOf(layout: StationLayout, sc: SettleCarve): void {
  const g = layout.grid, P = sc.platform, pc = P.x + P.w / 2;
  const gx = sc.gates.map(gt => (gt.rect.x + gt.rect.w / 2)).sort((a, b) => Math.abs(a - pc) - Math.abs(b - pc));
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

const r3 = (v: number) => Math.round(v * 1000) / 1000;
