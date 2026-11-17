// Task studio-survivor-market-crevice-20261116-074419: validation of THE SURVIVOR MARKET version 5, THE CREVICE (generation retry guard +
// tests). Pure data. Version 2's settlement rules (gen/market/v2/validate.ts) over the crevice's four storeys, version 3's bar rules
// (gen/market/v3/barValidate.ts) and version 4's den rules (gen/market/v4/denValidate.ts, on the den's version-5 plan), plus the
// crevice's own:
// - storeys: the crevice floor ('main', y 0) and the three terraces (CREVICE.bases); same grid size;
// - the player's train docks (the start platform), the start is clear on it;
// - reachability: every walkable (unblocked) cell of every storey reachable on foot from the start, but the den's sealed back room;
// - layout.market (v 5): the six stalls + the bar, in order — counter inside its area, the trader and the customer on clear floor on
//   opposite sides of the counter (across its depth: a counter runs along x or along z), both reachable WITHOUT a ladder, the trader facing
//   the customer, >= 4 display surfaces on real fixtures within reach (the shops' within the customer's reach from across the counter);
//   >= MARKET_POPULATION.minSpots resident spots of every kind on clear floor reachable without a ladder, on every storey, none on a counter
//   or in the den; the population inside MARKET_POPULATION.residents;
// - the bar: on the lower-terrace storey (1), its floor, its headroom, its furniture, its stock behind the counter, its 'drink' posts;
// - the den: version 4's rules; its door off the Arrival Square into its entry container;
// - the crevice record: every open container's room exists on its storey, every bridge deck floor of its storey, both ends on a walk;
// - the calm rules: no enemies, no hordes, no track extensions, no pickups, no other level's record, no loot in any holder but the
//   community stores;
// - railings on every drop, the shared storey / traversal / doorway rules.
// Layout version 6 (task studio-market-irregular-envelope-20261116-210503-01: the same crevice in its irregular envelope, gen/market/v6/
// envelope.ts) adds: the envelope record; every overhead within its band and >= 3.5 m over every top-storey public floor; the end clefts
// out of reach (their floors well over the top terrace: their lips take no railing); the chasm's bed below a railing's drop everywhere.

import {CELL, FLOOR, VOID} from '../../grid';
import {levelDistance, levelIssues, type LevelRules} from '../../levelGen';
import {levelsOf} from '../../levels';
import {traversalIssues} from '../../traversal';
import {doorClearVolumes, doorwayIssues} from '../../doorways';
import {playerTrainPlacement} from '../../playerTrain';
import {dropInLadderOpening, excuseDesignedRailGaps} from '../../reactor/pathsGen';
import type {StationLayout} from '../../stationTypes';
import {isLootHolderKind} from '../../../items/loot';
import {MARKET_EMPTY_KEY} from '../dress';
import {MARKET_WORKSHOP_KEY} from '../../../items/lootTables';
import {BAR_STALL, MARKET_STALLS_ALL, type MarketStall} from '../marketTypes';
import {MARKET_POPULATION, marketStandOk} from '../spots';
import {SETTLE_DISPLAY} from '../v2/validate';
import {BAR_RULES, barFloorArea} from '../v3/barValidate';
import {BAR_SPOTS} from '../v3/barRecord';
import {DEN_RULES, denIssues} from '../v4/denValidate';
import {CREVICE} from './frame';
import {ENVELOPE, creviceEnvelopeDrop} from '../v6/envelope';

export const CREVICE_LEVEL_RULES: LevelRules = {minLevels: 4, overlapRoles: [], maxRiser: 0.19, minFlightWidth: 1.5};

/** Version 4's den issues that name version 4's own plan (its record version, the Back Lane, rock over the den): version 5 checks those
 *  itself (its den sits under the terraces' containers, a storey up — gen/market/v5/den.ts). */
const DEN_V4_ONLY = /^(a den on a record that is not version 4|den door not off the Back Lane into its passage|\d+ den cells under another storey's floor|den tray in a doorway)$/;

/** Every version-5 rule (header). */
export function creviceIssues(layout: StationLayout): string[] {
  const issues: string[] = [];
  const m = layout.market;
  if (!m) return ['no market record'];
  const levels = layout.levels, g0 = layout.grid;
  if (levels.length !== CREVICE.canvas.levels) return [`${levels.length} levels`];
  for (const L of levels) if (L.grid.w !== g0.w || L.grid.h !== g0.h) issues.push(`level ${L.id} grid size differs`);
  for (const L of levels) if (Math.abs(L.baseY - CREVICE.bases[L.id]) > 1e-6) issues.push(`storey ${L.id} height`);
  if (m.v !== 5 && m.v !== 6) issues.push('market record version');
  if (!m.crevice) issues.push('no crevice record');
  if (m.crevice && !!m.crevice.envelope !== (m.v === 6)) issues.push('envelope record');

  // --- The calm rules --------------------------------------------------------------------------------------------------------
  if (layout.zombies.length) issues.push(`${layout.zombies.length} enemies`);
  if (layout.hordes?.length) issues.push('hordes');
  if (layout.extensions) issues.push('track extensions');
  if (layout.pickups.length) issues.push(`${layout.pickups.length} pickups`);
  if (layout.office || layout.mall || layout.reactor || layout.skyways) issues.push('another level\'s record');
  for (const [k, p] of layout.props.entries()) {
    if (isLootHolderKind(p.kind) && p.purpose !== MARKET_EMPTY_KEY && p.purpose !== MARKET_WORKSHOP_KEY) issues.push(`${p.kind}#${k} with loot key ${p.purpose}`);
  }

  // --- The train docks, the start -------------------------------------------------------------------------------------------
  const sp = layout.playerSpawn;
  const [sx, sy] = g0.cellOf(sp.x, sp.z);
  if (!g0.inBounds(sx, sy) || g0.area[g0.idx(sx, sy)] !== layout.platform || !g0.circleClear(sp.x, sp.z, 0.34)) issues.push('start not clear on the platform');
  const train = playerTrainPlacement(layout);
  if (!train) issues.push('the train does not fit the platform');
  else if (train.platformArea !== layout.platform) issues.push('the train docks off the start platform');

  // --- Reachability: the player, the residents (stairs only) -----------------------------------------------------------------
  const dist = levelDistance(levels, sx, sy, 0, layout.levelLinks);
  const walk = levelDistance(levels, sx, sy, 0, []);
  const sealed = new Set(m.den ? [m.den.back] : []);
  for (const L of levels) {
    const g = L.grid;
    let bad = 0, any = false;
    for (let i = 0; i < g.cells.length; i++) {
      if (g.cells[i] !== FLOOR || g.blocked[i] || sealed.has(g.area[i])) continue;
      if (dist[L.id][i] >= 0) { any = true; continue; }
      if (g.rampIdx[i] >= 0 && levels.some(M => M.id !== L.id && dist[M.id][i] >= 0)) continue;
      bad++;
    }
    if (bad) issues.push(`level ${L.id}: ${bad} walkable cells unreachable`);
    if (!any) issues.push(`level ${L.id} unreachable`);
  }
  const point = (lv: number, x: number, z: number, what: string) => {
    const g = levels[lv]?.grid;
    if (!g) { issues.push(`${what}: level ${lv} missing`); return; }
    if (!marketStandOk(g, x, z)) { issues.push(`${what} not on clear floor`); return; }
    const [cx, cy] = g.cellOf(x, z);
    if (walk[lv][g.idx(cx, cy)] < 0) issues.push(`${what} unreachable on foot`);
  };

  // --- The stalls ---------------------------------------------------------------------------------------------------------------
  const ids = m.stalls.map(s => s.id);
  if (ids.length !== MARKET_STALLS_ALL.length || MARKET_STALLS_ALL.some((id, i) => ids[i] !== id)) issues.push(`stalls ${ids.join(',')}`);
  for (const s of m.stalls) issues.push(...stallIssues(layout, s, walk, point));
  issues.push(...barIssues(layout));

  // --- The residents' spots --------------------------------------------------------------------------------------------------
  if (m.spots.length < MARKET_POPULATION.minSpots) issues.push(`${m.spots.length} resident spots`);
  for (const k of ['idle', 'sit', 'work', 'cook', 'sleep', 'chat', 'drink'] as const) if (!m.spots.some(s => s.kind === k)) issues.push(`no '${k}' spot`);
  for (const L of levels) if (!m.spots.some(s => s.level === L.id)) issues.push(`no spot on storey ${L.id}`);
  m.spots.forEach((s, i) => {
    point(s.level, s.x, s.z, `spot ${i} (${s.kind})`);
    const a = layout.areas[s.area];
    if (!a || (a.level ?? 0) !== s.level) issues.push(`spot ${i} area`);
    for (const st of m.stalls) if (s.level === st.counter.level && s.x > st.counter.x0 && s.x < st.counter.x1 && s.z > st.counter.z0 && s.z < st.counter.z1) issues.push(`spot ${i} on a counter`);
  });
  if (!(m.residents >= MARKET_POPULATION.residents[0] && m.residents <= MARKET_POPULATION.residents[1])) issues.push(`${m.residents} residents`);

  // --- The den -------------------------------------------------------------------------------------------------------------------
  if (!m.den) issues.push('no den');
  else {
    issues.push(...denIssues(layout).filter(q => !DEN_V4_ONLY.test(q)));
    const door = layout.doors.find(d => (d.level ?? 0) === 0 && Math.abs(d.x * CELL - m.den!.door.x0) < 1e-3 && Math.abs(d.y * CELL - m.den!.door.z0) < 1e-3);
    const a = door ? layout.areas[door.a] : undefined, b = door ? layout.areas[door.b] : undefined;
    if (!a || a.label !== 'Arrival Square' || !b || b.label !== 'Den entry') issues.push('den door not off the Arrival Square into its entry');
    // (version 4's tray / doorway rule, on the den's own storey: the terraces' doors stand over it)
    const t = m.den.booth.tray, r = DEN_RULES.trayClear;
    for (const v of doorClearVolumes(layout)) if (v.y0 < 1 && t.x > v.x0 - r && t.x < v.x1 + r && t.z > v.z0 - r && t.z < v.z1 + r) issues.push('den tray in a doorway');
  }

  // --- The crevice record ----------------------------------------------------------------------------------------------------
  if (m.crevice) {
    for (const [k, c] of m.crevice.containers.entries()) {
      if (c.area < 0) continue;
      const a = layout.areas[c.area];
      if (!a || (a.level ?? 0) !== c.level || a.kind !== 'room') issues.push(`container ${k} room`);
    }
    for (const [k, b] of m.crevice.bridges.entries()) {
      const g = levels[b.level]?.grid, a = layout.areas[b.area];
      if (!g || !a || a.role !== 'crossover') { issues.push(`bridge ${k} record`); continue; }
      let open = 0, cells = 0;
      for (let y = a.y; y < a.y + a.h; y++) for (let x = a.x; x < a.x + a.w; x++) { cells++; if (g.cells[g.idx(x, y)] === FLOOR && g.area[g.idx(x, y)] === a.id) open++; }
      if (open !== cells) issues.push(`bridge ${k}: ${cells - open} deck cells not floor`);
      // both ends on a storey-b.level walk (the cells past each end)
      for (const x of [a.x - 1, a.x + a.w]) {
        const y = a.y + (a.h >> 1);
        const w = g.inBounds(x, y) ? layout.areas[g.area[g.idx(x, y)]] : undefined;
        if (!w || g.cells[g.idx(x, y)] !== FLOOR || w.role !== 'catwalk') issues.push(`bridge ${k} end off a terrace`);
      }
    }
  }

  // --- (version 6) The envelope -------------------------------------------------------------------------------------------------
  if (m.v === 6 && m.crevice) issues.push(...envelopeIssues(layout));

  // --- Railings, shared rules -----------------------------------------------------------------------------------------------
  const drops = levelsOf(layout).unrailedDrops().filter(d => !dropInLadderOpening(layout, d) && !(m.v === 6 && creviceEnvelopeDrop(layout, d)));
  if (drops.length) issues.push(`${drops.length} unrailed drops (first at ${drops[0].x0.toFixed(1)},${drops[0].z0.toFixed(1)} level ${drops[0].level})`);
  issues.push(...excuseDesignedRailGaps(layout, levelIssues(layout, dist, CREVICE_LEVEL_RULES)));
  issues.push(...traversalIssues(layout));
  issues.push(...doorwayIssues(layout));
  return issues;
}

/** Version 6's envelope rules (header). */
function envelopeIssues(layout: StationLayout): string[] {
  const issues: string[] = [];
  const cr = layout.market!.crevice!, top = CREVICE.bases[CREVICE.bases.length - 1];
  let low = 0, band = 0, cleft = 0, bed = 0;
  for (const L of layout.levels) {
    const g = L.grid;
    for (let i = 0; i < g.cells.length; i++) {
      const c = g.cells[i];
      if (c === FLOOR) {
        // the open crevice's tops (anything over the top boxes' roof line) inside the envelope's band; the top storey's public floors
        // (walks, bridges, nooks / alcoves, stair heads) at least 3.5 m under it
        const ceil = g.ceil[i], f = g.floorOf(i), a = layout.areas[g.area[i]];
        if (ceil > top + CREVICE.cont + 0.5 && (ceil < ENVELOPE.low - 1e-3 || ceil > ENVELOPE.high + 1e-3)) band++;
        if (L.id === CREVICE.bases.length - 1 && g.rampIdx[i] < 0 && a?.publicSpace && ceil - f < 3.5 - 1e-3) low++;
      } else if (c === VOID) {
        if (L.id > 0) { if (g.floorOf(i) < top + 3 || g.ceil[i] < g.floorOf(i) + 2) cleft++; }
        else if (inBox(cr.chasm, ...g.center(i % g.w, (i / g.w) | 0)) && g.floorOf(i) > ENVELOPE.bed.lipMax + 1e-3) bed++;
      }
    }
  }
  if (low) issues.push(`${low} top-storey floor cells under 3.5 m of headroom`);
  if (band) issues.push(`${band} overhead cells outside the envelope's band`);
  if (cleft) issues.push(`${cleft} end-cleft cells within reach`);
  if (bed) issues.push(`${bed} chasm-bed cells within a railing's drop`);
  if (!cr.envelope?.clefts.length) issues.push('no end clefts');
  return issues;
}
const inBox = (b: {x0: number; z0: number; x1: number; z1: number}, x: number, z: number) => x >= b.x0 && x < b.x1 && z >= b.z0 && z < b.z1;

/** Which side of a counter a point lies on, across its depth (a counter runs along its longer side): -1 / 1, 0 = over it. */
export function counterSide(c: MarketStall['counter'], x: number, z: number): -1 | 0 | 1 {
  const alongX = c.x1 - c.x0 >= c.z1 - c.z0;
  const v = alongX ? z : x, lo = alongX ? c.z0 : c.x0, hi = alongX ? c.z1 : c.x1;
  return v < lo ? -1 : v > hi ? 1 : 0;
}

/** One stall's rules (version 2's, for a counter along x or z). */
function stallIssues(layout: StationLayout, s: MarketStall, walk: Int32Array[], point: (lv: number, x: number, z: number, what: string) => void): string[] {
  const issues: string[] = [];
  const levels = layout.levels, a = layout.areas[s.area];
  if (!a || !s.name) return [`stall ${s.id} record`];
  const c = s.counter;
  if (!(c.x0 >= a.x * CELL - 1e-6 && c.x1 <= (a.x + a.w) * CELL + 1e-6 && c.z0 >= a.y * CELL - 1e-6 && c.z1 <= (a.y + a.h) * CELL + 1e-6)) issues.push(`stall ${s.id} counter outside its area`);
  if (c.level !== (a.level ?? 0) || s.trader.level !== c.level || s.front.level !== c.level) issues.push(`stall ${s.id} storey`);
  point(s.trader.level, s.trader.x, s.trader.z, `stall ${s.id} trader`);
  point(s.front.level, s.front.x, s.front.z, `stall ${s.id} front`);
  const side = (x: number, z: number) => counterSide(c, x, z), ts = side(s.trader.x, s.trader.z), fs = side(s.front.x, s.front.z);
  if (!ts || ts !== -fs) issues.push(`stall ${s.id} trader / customer not across the counter`);
  // the trader faces the customer: forward (-sin yaw, -cos yaw) toward the front
  if (-Math.sin(s.trader.yaw) * (s.front.x - s.trader.x) - Math.cos(s.trader.yaw) * (s.front.z - s.trader.z) <= 0) issues.push(`stall ${s.id} trader faces away`);
  const disp = s.displays ?? [];
  if (disp.length < SETTLE_DISPLAY.min) issues.push(`stall ${s.id}: ${disp.length} displays`);
  const eye = s.front.y + 1.6, gS = levels[s.front.level].grid, stand: [number, number][] = [];
  for (let y = a.y - 1; y <= a.y + a.h; y++) for (let x = a.x - 1; x <= a.x + a.w; x++) {
    if (!gS.inBounds(x, y) || gS.area[gS.idx(x, y)] !== s.area) continue;
    const [wx, wz] = gS.center(x, y);
    if (side(wx, wz) === fs && marketStandOk(gS, wx, wz)) stand.push([wx, wz]);
  }
  const nearW = disp.filter(d => stand.some(([x, z]) => Math.hypot(d.x - x, d.z - z, d.y - eye) <= SETTLE_DISPLAY.customerReach)).reduce((n, d) => n + d.w, 0);
  if (nearW < SETTLE_DISPLAY.nearWidth && s.id !== BAR_STALL) issues.push(`stall ${s.id}: ${nearW.toFixed(2)} m of display within the customer's reach`);
  for (const [k, d] of disp.entries()) {
    const host = d.host !== undefined ? layout.props[d.host] : undefined;
    if (!host || host.area !== s.area || (host.level ?? 0) !== d.level || Math.abs(d.x - host.x) > host.hx + 1e-3 || Math.abs(d.z - host.z) > host.hz + 1e-3 || d.y < host.y - 1e-3 || d.y > host.y + host.h + 0.01) { issues.push(`stall ${s.id} display ${k} not on its fixture`); continue; }
    if (!(isLootHolderKind(host.kind) ? host.purpose === MARKET_EMPTY_KEY : SETTLE_DISPLAY.solidTops.includes(host.kind))) issues.push(`stall ${s.id} display ${k} on a ${host.kind} (not an item surface)`);
    if (!((d.clear ?? 0) >= 0.1)) issues.push(`stall ${s.id} display ${k} without free height`);
    const g = levels[d.level].grid;
    let near = false;
    const r = Math.ceil(SETTLE_DISPLAY.reach / CELL);
    const [cx, cy] = g.cellOf(d.x, d.z);
    for (let oy = -r; oy <= r && !near; oy++) for (let ox = -r; ox <= r; ox++) {
      const x = cx + ox, y = cy + oy;
      if (!g.inBounds(x, y) || !g.walkable(x, y) || walk[d.level][g.idx(x, y)] < 0) continue;
      const [wx, wz] = g.center(x, y);
      if (Math.hypot(wx - d.x, wz - d.z) <= SETTLE_DISPLAY.reach + CELL * 0.71) { near = true; break; }
    }
    if (!near) issues.push(`stall ${s.id} display ${k} out of reach`);
  }
  return issues;
}

/** The bar's rules (version 3's, on the crevice's lower-terrace storey; open to the crevice's rock above). */
function barIssues(layout: StationLayout): string[] {
  const issues: string[] = [];
  const m = layout.market!, bar = m.stalls.find(s => s.id === BAR_STALL);
  if (!bar) return ['no bar'];
  const a = layout.areas[bar.area], g = layout.levels[1]?.grid;
  if (!a || !g || (a.level ?? 0) !== 1 || bar.counter.level !== 1) return ['the bar is not on the lower-terrace storey'];
  const area = barFloorArea(layout, a.id);
  if (area < BAR_RULES.minArea) issues.push(`bar floor ${area.toFixed(1)} m²`);
  let low = 0;
  for (let i = 0; i < g.cells.length; i++) if (g.cells[i] === FLOOR && g.area[i] === a.id && !(g.hasCeil(i) && g.ceil[i] - g.floorOf(i) >= BAR_RULES.headroom)) low++;
  if (low) issues.push(`${low} bar cells without headroom`);
  const props = layout.props.filter(p => p.area === a.id && (p.level ?? 0) === 1);
  const n = (k: string) => props.filter(p => p.kind === k && p.host === undefined).length;
  if (n('shopCounter') < BAR_RULES.min.modules) issues.push(`${n('shopCounter')} bar counter modules`);
  if (n('skyMuStool') < BAR_RULES.min.stools) issues.push(`${n('skyMuStool')} bar stools`);
  if (n('cafeBistroTable') < BAR_RULES.min.tables) issues.push(`${n('cafeBistroTable')} bar tables`);
  if (n('cafeChair') < BAR_RULES.min.chairs) issues.push(`${n('cafeChair')} bar chairs`);
  for (const p of props) if (isLootHolderKind(p.kind) && p.purpose !== MARKET_EMPTY_KEY) issues.push(`bar ${p.kind} with loot key ${p.purpose}`);
  const c = bar.counter, own = counterSide(c, bar.trader.x, bar.trader.z);
  for (const [k, d] of (bar.displays ?? []).entries()) {
    const host = d.host !== undefined ? layout.props[d.host] : undefined;
    if (host?.kind === 'shopCounter') issues.push(`bar display ${k} on the counter`);
    if (counterSide(c, d.x, d.z) !== own) issues.push(`bar display ${k} not behind the counter`);
  }
  const drink = m.spots.filter(s => s.kind === 'drink');
  if (drink.length < BAR_SPOTS.min) issues.push(`${drink.length} drink spots`);
  for (const s of drink) {
    const seat = s.seat !== undefined ? layout.props[s.seat] : undefined;
    if (s.area !== a.id || s.level !== 1) issues.push('a drink spot off the bar');
    if (!seat || seat.area !== a.id || !['skyMuStool', 'cafeChair'].includes(seat.kind) || Math.hypot(seat.x - s.x, seat.z - s.z) > 2.2) issues.push('a drink spot without its seat');
  }
  return issues;
}
