// Task studio-surface-run-opus-rebuild-20261116-020827-01 (lane LIFE): THE CHECKPOINT'S PLANNING MAP — its drawing MODEL, pure (no
// three.js / DOM). User: "Provide a dynamic military-planning-style map showing the actual roads and destinations, useful local
// annotations/reports, exploration and player/truck positions. Markers must correspond to real places. Do not turn this into global
// campaign-intel disclosure or a new quest system."
//
// Inputs are ONLY the district's own layout record (layout.surface: gen/surface/surfaceTypes.ts) and the district's own live state
// (MapState: its exploration record, the buildings entered, per-building search / contact figures, lane reports, the live player and
// truck poses). Nothing of the campaign, the network, other stations or the host's world is read: the map can say nothing about them.
//
// Every marker carries a `ref` to the real thing it marks (a building id, a street id, a block id, the checkpoint, the portal, the live
// truck / player) and stands on it: destinations at their building's footprint centre, blocked spans on their street, the checkpoint /
// portal at their records, the local notes (surface.notes) and the reports at their own point — a note / report whose point is on no real
// place of the layout (no building, checkpoint, street corridor or block) is NOT printed (markersOnRealPlaces in the tests).
//
// Reports are DERIVED from real state, never invented: "Entered" / "Searched 3/7" / "Cleared" / "N hostiles down" for buildings the
// player has entered (holders searched in its footprint, its own layout enemies down), "Broken windows" for an entered-or-explored
// building whose generated window spans have broken panes (outdoor gas gets in: the normal window rule), the depot's recoverable train
// units as reported by the layout — and any lane's live reports (MapReportInput: e.g. AIR's gas breaches, CARGO's units at the depot / on
// the truck; a lane report with key 'windows' / 'recoverables' replaces that default, and so does a LIVE lane source declaring the key in
// MapState.replace while it has nothing to report there). No objective, no quest step, no reward.

import type {SRect, SurfaceBuildingKind, SurfaceInfo, SurfaceNote} from '../../gen/surface/surfaceTypes';
import {EQUIPMENT, recoverableKind} from '../../craft/equipment';
import {isSet, type ExploreGrid} from './mapExplore';
import {depotRecoverables} from './cargoSeed'; // (lane FIXES: the one train upgrade a depot is seeded with)

export type MapTone = SurfaceNote['kind'];

/** Live figures of one building (the runtime counts them from the real holders / enemies; absent = unknown). */
export interface BuildingStats { holders: number; searched: number; hostiles: number; down: number }

/** A lane's live report (anchored by its own point; `key` 'windows' / 'recoverables' replaces that default report family). */
export interface MapReportInput { x: number; z: number; text: string; kind: MapTone; source: string; key?: string }

export interface MapPose { x: number; z: number; yaw: number }

/** The vehicle controller as the district reads it (game.skywaysCar: lane TRUCK's truck in a district). */
export interface VehicleLike {
  truckTransform?(): {x: number; z: number; yaw: number} | null;
  worldLive?: boolean;
  driving?: boolean;
  body?: {x: number; z: number; yaw: number} | null;
  spec?: {length: number; width: number};
}

/** Where the district's truck stands (lane TRUCK's truckTransform; else a live vehicle body), or null (no vehicle in this world). */
export function vehiclePoseOf(car: VehicleLike | null | undefined): MapPose | null {
  const t = car?.truckTransform ? car.truckTransform() : car?.worldLive ? car.body ?? null : null;
  return t ? {x: t.x, z: t.z, yaw: t.yaw} : null;
}

export interface MapState {
  explore: ExploreGrid;
  entered: ReadonlySet<number>;
  stats?: ReadonlyMap<number, BuildingStats>;
  reports?: readonly MapReportInput[];
  /** Default report families a LIVE lane source covers even when it reports nothing there now (e.g. AIR: 'windows' — no live opening). */
  replace?: readonly string[];
  player?: MapPose | null;
  truck?: MapPose | null;
}

export type MapRef =
  | {type: 'building'; id: number} | {type: 'street'; id: number} | {type: 'block'; id: number}
  | {type: 'checkpoint'} | {type: 'portal'} | {type: 'truck'} | {type: 'player'};

export type MarkerKind = 'destination' | 'depot' | 'checkpoint' | 'portal' | 'blocked' | 'note' | 'report' | 'truck' | 'player';

export interface MapMarker {
  id: string;
  kind: MarkerKind;
  x: number; z: number;
  label: string;
  /** Symbol key (a building kind, 'checkpoint', 'portal', 'blocked', a note / report tone, 'truck', 'player'). */
  symbol: string;
  /** Grid reference of its point ("C4"). */
  grid: string;
  ref: MapRef;
  tone?: MapTone;
  /** Heading (rad, camera convention: forward = (-sin yaw, -cos yaw)) — the truck / player. */
  yaw?: number;
  /** The building is entered (destination markers). */
  entered?: boolean;
}

export interface MapStreet { id: number; name: string; ax: number; az: number; bx: number; bz: number; width: number; sidewalk: number; rank: string; label: {x: number; z: number; vertical: boolean} | null }
export interface MapBuilding { id: number; rect: SRect; kind: SurfaceBuildingKind; name: string; destination: boolean; enterable: boolean; condition: string; explored: boolean; entered: boolean }

export interface PlanningMap {
  name: string;
  host: string;
  extent: SRect;
  core: SRect;
  /** Grid lines (world m) and their labels: columns A.., rows 1.. (a square = one block with half its streets). */
  grid: {xs: number[]; zs: number[]; cols: string[]; rows: string[]};
  blocks: {id: number; rect: SRect; core: boolean}[];
  buildings: MapBuilding[];
  streets: MapStreet[];
  checkpoint: {rect: SRect; tent: SRect};
  markers: MapMarker[];
  /** Unexplored runs [row, col0, col1] of the exploration grid (the fog the drawing shades). */
  fog: {x0: number; z0: number; cell: number; w: number; h: number; runs: [number, number, number][]};
  /** Explored share of the district (0..1). */
  explored: number;
}

const COLS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // (military style: no I / O)

const centre = (r: SRect) => ({x: (r.x0 + r.x1) / 2, z: (r.z0 + r.z1) / 2});
const inRect = (r: SRect, x: number, z: number, pad = 0) => x >= r.x0 - pad && x <= r.x1 + pad && z >= r.z0 - pad && z <= r.z1 + pad;

/** The street corridor of a segment (carriageway + both sidewalks). */
export function streetRect(s: {ax: number; az: number; bx: number; bz: number; width: number; sidewalk: number}): SRect {
  const h = s.width / 2 + s.sidewalk;
  return {x0: Math.min(s.ax, s.bx) - h, z0: Math.min(s.az, s.bz) - h, x1: Math.max(s.ax, s.bx) + h, z1: Math.max(s.az, s.bz) + h};
}

/** Grid lines: the street centre lines between block columns / rows (uniform over the extent when the blocks do not say). */
export function gridLines(s: SurfaceInfo): {xs: number[]; zs: number[]} {
  const line = (n: number, a0: number, a1: number, lo: (i: number) => number[], hi: (i: number) => number[]) => {
    const out = [a0];
    for (let i = 1; i < n; i++) {
      const left = lo(i - 1), right = hi(i);
      out.push(left.length && right.length ? (Math.max(...left) + Math.min(...right)) / 2 : a0 + (a1 - a0) * i / n);
    }
    out.push(a1);
    return out;
  };
  const E = s.extent;
  return {
    xs: line(s.cols, E.x0, E.x1, c => s.blocks.filter(b => b.col === c).map(b => b.rect.x1), c => s.blocks.filter(b => b.col === c).map(b => b.rect.x0)),
    zs: line(s.rows, E.z0, E.z1, r => s.blocks.filter(b => b.row === r).map(b => b.rect.z1), r => s.blocks.filter(b => b.row === r).map(b => b.rect.z0)),
  };
}

/** "C4" for a world point (grid lines from gridLines). */
export function gridRef(xs: readonly number[], zs: readonly number[], x: number, z: number): string {
  let c = 0, r = 0;
  while (c < xs.length - 2 && x >= xs[c + 1]) c++;
  while (r < zs.length - 2 && z >= zs[r + 1]) r++;
  return `${COLS[c] ?? '?'}${r + 1}`;
}

/** The real place a point stands on (building > checkpoint > street corridor > block), or null (a point on nothing of the layout). */
export function placeAt(s: SurfaceInfo, x: number, z: number): MapRef | null {
  const b = s.buildings.find(q => inRect(q.footprint, x, z, 1));
  if (b) return {type: 'building', id: b.id};
  if (inRect(s.checkpoint.rect, x, z, 1)) return {type: 'checkpoint'};
  const st = s.streets.find(q => inRect(streetRect(q), x, z));
  if (st) return {type: 'street', id: st.id};
  const bl = s.blocks.find(q => inRect(q.rect, x, z));
  if (bl) return {type: 'block', id: bl.id};
  return null;
}

/** Does the ref name a real thing of this layout, and does (x, z) stand on it? (the tests' and the drawing's honesty check) */
export function refHolds(s: SurfaceInfo, ref: MapRef, x: number, z: number): boolean {
  switch (ref.type) {
    case 'building': { const b = s.buildings.find(q => q.id === ref.id); return !!b && inRect(b.footprint, x, z, 1); }
    case 'street': { const st = s.streets.find(q => q.id === ref.id); return !!st && inRect(streetRect(st), x, z, 1); }
    case 'block': { const bl = s.blocks.find(q => q.id === ref.id); return !!bl && inRect(bl.rect, x, z); }
    case 'checkpoint': return inRect(s.checkpoint.rect, x, z, 1);
    case 'portal': return Math.hypot(x - s.portal.pose.x, z - s.portal.pose.z) < 0.01;
    case 'truck': case 'player': return inRect(markerBounds(s), x, z, 2);
  }
}

/**
 * Where the live truck / player markers are shown: the playable extent, or (a v2 district: task studio-surface-run-field-followup-
 * 20261116-211729-01) out to the fog-pressure boundary's walkable edge — a truck broken down in the outer fog stays on the map.
 */
export function markerBounds(s: SurfaceInfo): SRect {
  const e = s.boundary?.edge;
  return e ? {x0: Math.min(e.x0, s.extent.x0), z0: Math.min(e.z0, s.extent.z0), x1: Math.max(e.x1, s.extent.x1), z1: Math.max(e.z1, s.extent.z1)} : s.extent;
}

/** Printed name of a depot recoverable / train unit kind (craft/equipment.ts: an equipment kind or an upgrade id -> its kit), lower case. */
export function recoverableName(kind: string): string {
  const k = recoverableKind(kind);
  return k ? EQUIPMENT[k].name.toLowerCase() : kind;
}

/** Is any exploration cell over rect r explored? (a building / place the player has seen) */
export function rectExplored(g: ExploreGrid, r: SRect): boolean {
  for (let z = r.z0; z <= r.z1 + 1e-6; z += g.cell / 2) for (let x = r.x0; x <= r.x1 + 1e-6; x += g.cell / 2) {
    const cx = Math.floor((Math.min(x, r.x1) - g.x0) / g.cell), cz = Math.floor((Math.min(z, r.z1) - g.z0) / g.cell);
    if (cx >= 0 && cz >= 0 && cx < g.w && cz < g.h && isSet(g, cz * g.w + cx)) return true;
  }
  return false;
}

const TONE_SYMBOL: Record<MapTone, string> = {hazard: 'hazard', supply: 'supply', route: 'route', enemy: 'enemy', info: 'info'};

/** Build the planning map of a district from its record and its live state (see the header). */
export function buildPlanningMap(s: SurfaceInfo, st: MapState): PlanningMap {
  const {xs, zs} = gridLines(s);
  const cols = xs.slice(1).map((_, i) => COLS[i] ?? '?'), rows = zs.slice(1).map((_, i) => String(i + 1));
  const ref = (x: number, z: number) => gridRef(xs, zs, x, z);
  const g = st.explore;
  const buildings: MapBuilding[] = s.buildings.map(b => ({id: b.id, rect: b.footprint, kind: b.kind, name: b.name, destination: b.destination, enterable: b.enterable, condition: b.condition,
    explored: rectExplored(g, b.footprint), entered: st.entered.has(b.id)}));
  // street labels: one per name per ~90 m (segments shorter than 30 m carry none)
  const labelled: {name: string; x: number; z: number}[] = [];
  const streets: MapStreet[] = s.streets.map(q => {
    const len = Math.hypot(q.bx - q.ax, q.bz - q.az), m = {x: (q.ax + q.bx) / 2, z: (q.az + q.bz) / 2};
    let label: MapStreet['label'] = null;
    if (q.name && len >= 30 && !labelled.some(l => l.name === q.name && Math.hypot(l.x - m.x, l.z - m.z) < 90)) {
      label = {...m, vertical: Math.abs(q.bz - q.az) > Math.abs(q.bx - q.ax)};
      labelled.push({name: q.name, ...m});
    }
    return {id: q.id, name: q.name, ax: q.ax, az: q.az, bx: q.bx, bz: q.bz, width: q.width, sidewalk: q.sidewalk, rank: q.rank, label};
  });

  const markers: MapMarker[] = [];
  // destinations (and the depot)
  for (const b of s.buildings) {
    const isDepot = b.id === s.depot.building;
    if (!b.destination && !isDepot) continue;
    const c = centre(b.footprint);
    markers.push({id: `b${b.id}`, kind: isDepot ? 'depot' : 'destination', ...c, label: b.name || (isDepot ? 'Rail depot' : ''), symbol: isDepot ? 'depot' : b.kind, grid: ref(c.x, c.z),
      ref: {type: 'building', id: b.id}, entered: st.entered.has(b.id)});
  }
  // the checkpoint and the way back
  const cc = centre(s.checkpoint.rect);
  markers.push({id: 'checkpoint', kind: 'checkpoint', ...cc, label: 'Checkpoint', symbol: 'checkpoint', grid: ref(cc.x, cc.z), ref: {type: 'checkpoint'}});
  markers.push({id: 'portal', kind: 'portal', x: s.portal.pose.x, z: s.portal.pose.z, label: s.portal.label || 'Way back', symbol: 'portal', grid: ref(s.portal.pose.x, s.portal.pose.z), ref: {type: 'portal'}});
  // blocked spans
  for (const q of s.streets) (q.blocked ?? []).forEach((r, k) => {
    const c = centre(r);
    markers.push({id: `x${q.id}-${k}`, kind: 'blocked', ...c, label: 'Blocked', symbol: 'blocked', grid: ref(c.x, c.z), ref: {type: 'street', id: q.id}, tone: 'route'});
  });
  // the local notes (GEN's annotations), anchored to the real place they stand on
  s.notes.forEach((n, k) => {
    const at = placeAt(s, n.x, n.z);
    if (!at || !n.text) return;
    markers.push({id: `n${k}`, kind: 'note', x: n.x, z: n.z, label: n.text, symbol: TONE_SYMBOL[n.kind] ?? 'info', grid: ref(n.x, n.z), ref: at, tone: n.kind});
  });
  // derived reports
  const lane = st.reports ?? [];
  const replaced = new Set([...lane.map(r => r.key).filter((k): k is string => !!k), ...(st.replace ?? [])]);
  const reports: MapReportInput[] = [];
  for (const b of s.buildings) {
    const c = centre(b.footprint), lines: string[] = [];
    const entered = st.entered.has(b.id), stat = st.stats?.get(b.id);
    if (entered) {
      if (stat && stat.hostiles > 0 && stat.down >= stat.hostiles) lines.push('Cleared');
      else if (stat && stat.down > 0) lines.push(`${stat.down} hostile${stat.down === 1 ? '' : 's'} down`);
      if (stat && stat.holders > 0) lines.push(`Searched ${Math.min(stat.searched, stat.holders)}/${stat.holders}`);
      if (!lines.length) lines.push('Entered');
      reports.push({x: c.x, z: c.z + 0, text: lines.join(' · '), kind: lines[0] === 'Cleared' ? 'info' : stat && stat.down > 0 && stat.down < stat.hostiles ? 'enemy' : 'info', source: 'life'});
    }
    if (!replaced.has('windows') && (entered || buildings[s.buildings.indexOf(b)]?.explored)) {
      const broken = s.windows.filter(w => w.building === b.id).reduce((n, w) => n + w.panes.filter(p => p === 'broken').length, 0);
      if (broken > 0) reports.push({x: c.x, z: c.z, text: `Broken windows (${broken}) — gas gets in`, kind: 'hazard', source: 'life', key: 'windows'});
    }
  }
  // (task studio-surface-run-field-followup-20261116-211729-01, lane FIXES: the depot reports the ONE train upgrade a first entry seeds —
  // a live cargo source, which knows a depot seeded before that rule, replaces this)
  const held = depotRecoverables(s, false);
  if (!replaced.has('recoverables') && held.length) {
    const d = s.buildings.find(b => b.id === s.depot.building);
    if (d) {
      const names = [...new Set(held.map(r => recoverableName(r.kind)))];
      const c = centre(d.footprint);
      reports.push({x: c.x, z: c.z, text: `Train units reported: ${names.join(', ')}`, kind: 'supply', source: 'life', key: 'recoverables'});
    }
  }
  [...reports, ...lane].forEach((r, k) => {
    const at = placeAt(s, r.x, r.z);
    if (!at || !r.text) return;
    markers.push({id: `r${k}`, kind: 'report', x: r.x, z: r.z, label: r.text, symbol: TONE_SYMBOL[r.kind] ?? 'info', grid: ref(r.x, r.z), ref: at, tone: r.kind});
  });
  // the live truck and the player
  const inside = (p: MapPose | null | undefined): p is MapPose => !!p && Number.isFinite(p.x) && Number.isFinite(p.z) && inRect(markerBounds(s), p.x, p.z, 2);
  if (inside(st.truck)) markers.push({id: 'truck', kind: 'truck', x: st.truck.x, z: st.truck.z, yaw: st.truck.yaw, label: 'Truck', symbol: 'truck', grid: ref(st.truck.x, st.truck.z), ref: {type: 'truck'}});
  if (inside(st.player)) markers.push({id: 'player', kind: 'player', x: st.player.x, z: st.player.z, yaw: st.player.yaw, label: 'You', symbol: 'player', grid: ref(st.player.x, st.player.z), ref: {type: 'player'}});

  // fog: the unexplored runs per row
  const runs: [number, number, number][] = [];
  let explored = 0;
  for (let r = 0; r < g.h; r++) {
    let c0 = -1;
    for (let c = 0; c <= g.w; c++) {
      const open = c < g.w && !isSet(g, r * g.w + c);
      if (c < g.w && !open) explored++;
      if (open && c0 < 0) c0 = c;
      if (!open && c0 >= 0) { runs.push([r, c0, c - 1]); c0 = -1; }
    }
  }
  return {
    name: s.name, host: s.host, extent: s.extent, core: s.core, grid: {xs, zs, cols, rows},
    blocks: s.blocks.map(b => ({id: b.id, rect: b.rect, core: b.core})), buildings, streets,
    checkpoint: {rect: s.checkpoint.rect, tent: s.checkpoint.tent.rect},
    markers, fog: {x0: g.x0, z0: g.z0, cell: g.cell, w: g.w, h: g.h, runs}, explored: explored / (g.w * g.h),
  };
}

/** A cheap signature of what the drawing shows (the table-top texture redraws only when it changes). */
export function mapSignature(m: PlanningMap): string {
  const q = (v: number) => Math.round(v / 2);
  return [m.markers.map(k => `${k.id}:${q(k.x)},${q(k.z)},${k.yaw !== undefined ? Math.round(k.yaw * 8) : ''},${k.entered ? 1 : 0},${k.label}`).join('|'), m.fog.runs.length, Math.round(m.explored * 1000)].join('#');
}
