// Task studio-skyways-rework-20261107-054512-01 (lane MAPS): the PLAN DATA of the Skyways local directory boards (pure: no three.js, no
// canvas) — what a board's face shows, read from THIS generated network (layout.skyways + the layout's areas / levels / levelLinks):
//  - the building footprints with their names, the streets between them;
//  - every public space per storey, classified (hub / shop / anchor / food / washroom / event / platform / stair / pedway / bridge): the
//    board's OWN storey is drawn solid, the other storeys faint (world/skywaysMapBoards.ts);
//  - the network lines: the +15 skyway (each bridge's deck from hub to hub) and the concourse pedways;
//  - the stairs / escalators between storeys (one icon per run);
//  - the destination labels: the anchor stores by name, the landmark courts by name, the ramen restaurant, the food court, the station
//    and the add-on event by its ordinary event name;
//  - per board: YOU ARE HERE (its own position) and the floor context line ("You are on the +15 Skyway level, <building>").
// Never fuel, prose, gameplay hints, campaign travel or anything about the prize beyond its ordinary event name (SKYWAYS_MAP_FORBIDDEN).

import {CELL} from '../gen/grid';
import type {Area, StationLayout} from '../gen/stationTypes';
import type {PropPlacement} from '../gen/props';
import type {SkywaysRect} from '../gen/skyways/skywaysTypes';

const r2 = (v: number) => Math.round(v * 100) / 100;

export type MapSpaceKind = 'hub' | 'shop' | 'anchor' | 'food' | 'washroom' | 'event' | 'platform' | 'stair' | 'pedway' | 'bridge';
export interface MapSpace { level: number; kind: MapSpaceKind; rect: SkywaysRect; area: number }
export type MapLabelKind = 'event' | 'anchor' | 'landmark' | 'restaurant' | 'food' | 'station';
export interface MapLabel { kind: MapLabelKind; text: string; level: number; x: number; z: number; building: string | null }
/** A stair / escalator run between two storeys (its well rect; `kind` from its lanes). */
export interface MapRun { lower: number; upper: number; kind: 'stairs' | 'escalator' | 'mixed'; rect: SkywaysRect; x: number; z: number; transit: boolean }
/** A network polyline (world x / z): the +15 skyway through a bridge (hub -> deck -> hub) or a concourse pedway. */
export interface MapLine { kind: 'skyway' | 'pedway'; level: number; id: string; pts: {x: number; z: number}[] }
export interface MapBuilding { id: string; name: string; rect: SkywaysRect; station: boolean }

export interface SkywaysMapPlan {
  /** The complex's printed name ("Calder +15"). */
  name: string;
  /** World bounds of everything drawn (buildings, bridges, the concourse storey's public spaces). */
  bounds: SkywaysRect;
  /** Per storey: the bounds its face is fitted to (the buildings and bridges; the concourse storey adds its own spaces). */
  boundsOf: Record<number, SkywaysRect>;
  storeys: {level: number; label: string}[];
  buildings: MapBuilding[];
  streets: {rect: SkywaysRect; axis: 'x' | 'z'}[];
  spaces: MapSpace[];
  runs: MapRun[];
  lines: MapLine[];
  labels: MapLabel[];
}

/** Words a board never prints (no fuel, no vehicle / driving talk, no gameplay or travel hints). */
export const SKYWAYS_MAP_FORBIDDEN = /\b(fuel|gas(oline)?|petrol|driv\w*|car|cars|vehicle|keys?|ignition|steer\w*|loot|ammo|weapons?|zombies?|travel|campaign|hint)\b/i;

const rectOf = (a: Area): SkywaysRect => ({x0: a.x * CELL, z0: a.y * CELL, x1: (a.x + a.w) * CELL, z1: (a.y + a.h) * CELL});
const centre = (r: SkywaysRect) => ({x: (r.x0 + r.x1) / 2, z: (r.z0 + r.z1) / 2});
const inside = (r: SkywaysRect, x: number, z: number, pad = 0) => x >= r.x0 - pad && x <= r.x1 + pad && z >= r.z0 - pad && z <= r.z1 + pad;
const areaOf = (r: SkywaysRect) => (r.x1 - r.x0) * (r.z1 - r.z0);
const levelOf = (a: Area): number => a.level ?? 0;

/** The storey phrase of a floor context line. */
export function storeyPhrase(level: number): string {
  return level === 2 ? '+15 Skyway level' : level === 1 ? 'Street level' : 'Pedway concourse level';
}
/** A storey's short tag (dim labels of other storeys). */
export function storeyTag(level: number): string {
  return level === 2 ? '+15' : level === 1 ? 'Street' : 'Concourse';
}

const plans = new WeakMap<StationLayout, SkywaysMapPlan>();

/** The directory plan of a Skyways layout (cached per layout; null without layout.skyways). */
export function skywaysMapPlan(layout: StationLayout): SkywaysMapPlan | null {
  const info = layout.skyways;
  if (!info) return null;
  const cached = plans.get(layout);
  if (cached) return cached;
  const buildings: MapBuilding[] = info.buildings.map(b => ({id: b.id, name: b.name, rect: {...b.rect}, station: b.role === 'station'}));
  const buildingAt = (x: number, z: number): string | null => buildings.find(b => inside(b.rect, x, z))?.id ?? null;
  const addon = new Set(info.addon.areas);
  const bridges = new Map(info.bridges.map(b => [b.area, b]));
  const anchorAreas = new Set<number>();
  for (const an of info.anchors ?? []) { anchorAreas.add(an.floor); if (an.upper !== undefined) anchorAreas.add(an.upper); for (const z of an.zones) anchorAreas.add(z); }
  for (const a of layout.areas) if (anchorAreas.has(a.parent) && a.type === 'shop') anchorAreas.add(a.id);
  const food = new Set<number>(info.buildings.flatMap(b => (b.foodCourt ? [b.foodCourt.area] : [])));
  if (info.restaurant) food.add(info.restaurant.area);

  // --- public spaces (track extensions and back-of-house excluded) -----------------------------------------------------------------
  const spaces: MapSpace[] = [];
  const runAreas = new Set<number>();
  for (const k of layout.levelLinks ?? []) { const f = layout.traversal.stairs[k.traversalId ?? -1]; if (f) runAreas.add(f.area); }
  for (const a of layout.areas) {
    if (!a.publicSpace || a.ext) continue;
    const lv = levelOf(a), rect = rectOf(a);
    let kind: MapSpaceKind;
    if (runAreas.has(a.id) || a.type === 'stair-core') kind = 'stair';
    else if (bridges.has(a.id)) kind = 'bridge';
    else if (addon.has(a.id)) kind = 'event';
    else if (anchorAreas.has(a.id)) kind = 'anchor';
    else if (food.has(a.id) || a.type === 'eatery') kind = 'food';
    else if (a.type === 'washroom') kind = 'washroom';
    else if (a.kind === 'platform') kind = 'platform';
    else if (/^Pedway to /.test(a.label)) kind = 'pedway';
    else if (a.type === 'shop') kind = 'shop';
    else kind = 'hub';
    spaces.push({level: lv, kind, rect, area: a.id});
  }

  // --- runs (one per stair well: its lanes' links) ---------------------------------------------------------------------------------
  const runs: MapRun[] = [];
  const byArea = new Map<number, {lower: number; upper: number; esc: boolean; stair: boolean}>();
  for (const k of layout.levelLinks ?? []) {
    const f = layout.traversal.stairs[k.traversalId ?? -1];
    if (!f) continue;
    const e = byArea.get(f.area) ?? {lower: k.lower, upper: k.upper, esc: false, stair: false};
    if (f.spec === 'escalator') e.esc = true; else e.stair = true;
    byArea.set(f.area, e);
  }
  for (const [area, e] of byArea) {
    const a = layout.areas[area];
    if (!a || a.ext) continue;
    const rect = rectOf(a), c = centre(rect);
    runs.push({lower: e.lower, upper: e.upper, kind: e.esc && e.stair ? 'mixed' : e.esc ? 'escalator' : 'stairs', rect, x: r2(c.x), z: r2(c.z), transit: /Concourse – Street level/.test(a.label)});
  }

  // --- network lines -------------------------------------------------------------------------------------------------------------
  // a building's node on a storey: the centre of its largest hub space there
  const nodeOf = (id: string, level: number): {x: number; z: number} | null => {
    const b = buildings.find(q => q.id === id);
    if (!b) return null;
    const hubs = spaces.filter(s => s.level === level && s.kind === 'hub' && inside(b.rect, centre(s.rect).x, centre(s.rect).z));
    if (!hubs.length) return null;
    const best = hubs.reduce((p, q) => (areaOf(q.rect) > areaOf(p.rect) ? q : p));
    return centre(best.rect);
  };
  const lines: MapLine[] = [];
  for (const br of info.bridges) {
    const ra = buildings.find(b => b.id === br.a)?.rect, rb = buildings.find(b => b.id === br.b)?.rect;
    if (!ra || !rb) continue;
    const c = centre(br.rect), alongX = br.axis === 'x';
    // the deck's two mouths, each at the facade of the building on its side
    const ends = alongX ? [{x: br.rect.x0, z: c.z}, {x: br.rect.x1, z: c.z}] : [{x: c.x, z: br.rect.z0}, {x: c.x, z: br.rect.z1}];
    const aFirst = alongX ? centre(ra).x < centre(rb).x : centre(ra).z < centre(rb).z;
    const [ma, mb] = aFirst ? ends : [ends[1], ends[0]];
    const leg = (m: {x: number; z: number}, id: string): {x: number; z: number}[] => {
      const n = nodeOf(id, br.level);
      if (!n) return [m];
      // into the building along the deck's axis, then square to the hub's centre (orthogonal routing, like a printed network)
      const elbow = alongX ? {x: n.x, z: m.z} : {x: m.x, z: n.z};
      return [m, elbow, n];
    };
    const pts = [...leg(ma, br.a).reverse(), ...leg(mb, br.b)];
    lines.push({kind: 'skyway', level: br.level, id: br.id, pts: pts.map(p => ({x: r2(p.x), z: r2(p.z)}))});
  }
  // pedways: each "Pedway to <building>" piece's long-axis centreline, joined to the concourse hub
  const conc = spaces.filter(s => s.level === 0 && s.kind === 'hub');
  const concNode = conc.length ? centre(conc.reduce((p, q) => (areaOf(q.rect) > areaOf(p.rect) ? q : p)).rect) : null;
  for (const s of spaces) {
    if (s.kind !== 'pedway') continue;
    const r = s.rect, c = centre(r), alongX = r.x1 - r.x0 >= r.z1 - r.z0;
    const a = alongX ? {x: r.x0, z: c.z} : {x: c.x, z: r.z0}, b = alongX ? {x: r.x1, z: c.z} : {x: c.x, z: r.z1};
    const pts = concNode && Math.hypot(a.x - concNode.x, a.z - concNode.z) > Math.hypot(b.x - concNode.x, b.z - concNode.z) ? [b, a] : [a, b];
    lines.push({kind: 'pedway', level: 0, id: `pedway-${s.area}`, pts: pts.map(p => ({x: r2(p.x), z: r2(p.z)}))});
  }

  // --- destination labels --------------------------------------------------------------------------------------------------------
  const labels: MapLabel[] = [];
  const label = (kind: MapLabelKind, text: string, level: number, x: number, z: number) => labels.push({kind, text, level, x: r2(x), z: r2(z), building: buildingAt(x, z)});
  {
    const a = info.addon, c = centre(a.hall);
    if (a.id === 'convention') {
      const hall = a.areas.map(i => layout.areas[i]).find(q => q && inside(rectOf(q), c.x, c.z)) ?? layout.areas[a.areas[0]];
      label('event', hall?.label && !SKYWAYS_MAP_FORBIDDEN.test(hall.label) ? hall.label : 'Convention hall', a.level, c.x, c.z);
    } else label('event', 'Grand Prize Draw', a.level, c.x, c.z);
  }
  for (const an of info.anchors ?? []) {
    const c = centre(an.rect);
    label('anchor', an.name, an.level, c.x, c.z);
    if (an.upper !== undefined) { const u = layout.areas[an.upper]; if (u) label('anchor', an.name, levelOf(u), c.x, c.z); }
  }
  for (const m of info.landmarks ?? []) label('landmark', m.name, m.level, m.x, m.z);
  if (info.restaurant) { const a = layout.areas[info.restaurant.area]; if (a) { const c = centre(rectOf(a)); label('restaurant', info.restaurant.name, info.restaurant.level, c.x, c.z); } }
  for (const b of info.buildings) if (b.foodCourt) { const a = layout.areas[b.foodCourt.area]; if (a) { const c = centre(rectOf(a)); label('food', 'Food court', b.foodCourt.level, c.x, c.z); } }
  {
    const plats = spaces.filter(s => s.kind === 'platform');
    if (plats.length) {
      const x0 = Math.min(...plats.map(s => s.rect.x0)), x1 = Math.max(...plats.map(s => s.rect.x1)), z0 = Math.min(...plats.map(s => s.rect.z0)), z1 = Math.max(...plats.map(s => s.rect.z1));
      label('station', 'Station platforms', 0, (x0 + x1) / 2, (z0 + z1) / 2);
    }
    const t = runs.find(r => r.transit);
    if (t) label('station', 'To the station', 1, t.x, t.z);
  }

  // --- bounds: the buildings, the bridges and the concourse storey's spaces ------------------------------------------------------------
  const union = (rs: SkywaysRect[]): SkywaysRect => ({x0: Math.min(...rs.map(r => r.x0)), z0: Math.min(...rs.map(r => r.z0)), x1: Math.max(...rs.map(r => r.x1)), z1: Math.max(...rs.map(r => r.z1))});
  const shell = [...buildings.map(b => b.rect), ...info.bridges.map(b => b.rect)];
  const bounds = union([...shell, ...spaces.filter(s => s.level === 0).map(s => s.rect)]);
  const boundsOf: Record<number, SkywaysRect> = {};
  for (const s of info.storeys) boundsOf[s.level] = s.level === 0 ? bounds : union(shell);
  const plan: SkywaysMapPlan = {
    name: info.name, bounds, boundsOf, storeys: info.storeys.map(s => ({level: s.level, label: s.label})), buildings,
    streets: info.streets.map(s => ({rect: {...s.rect}, axis: s.axis})), spaces, runs, lines, labels,
  };
  plans.set(layout, plan);
  return plan;
}

/** What one board shows of itself: its storey, YOU ARE HERE (its position) and the floor context line. */
export interface SkywaysBoardHere { level: number; x: number; z: number; building: string | null; buildingName: string; line: string; lines: [string, string] }

export function skywaysBoardHere(plan: SkywaysMapPlan, p: Pick<PropPlacement, 'x' | 'z' | 'level'>): SkywaysBoardHere {
  const level = p.level ?? 0;
  let b = plan.buildings.find(q => inside(q.rect, p.x, p.z));
  if (!b) {
    // (not inside a footprint: the nearest building)
    let best = Infinity;
    for (const q of plan.buildings) { const c = centre(q.rect), d = Math.hypot(c.x - p.x, c.z - p.z); if (d < best) { best = d; b = q; } }
  }
  const name = b?.name ?? plan.name;
  const phrase = storeyPhrase(level);
  return {level, x: p.x, z: p.z, building: b?.id ?? null, buildingName: name, line: `You are on the ${phrase}, ${name}`, lines: [`You are on the ${phrase}`, name]};
}

/** Every text a board of this plan can print (tests: no forbidden words). */
export function skywaysMapTexts(plan: SkywaysMapPlan): string[] {
  return [plan.name, ...plan.storeys.map(s => s.label), ...plan.buildings.map(b => b.name), ...plan.labels.map(l => l.text)];
}
