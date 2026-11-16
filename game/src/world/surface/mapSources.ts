// Task studio-surface-run-opus-rebuild-20261116-020827-01 (lane LIFE, follow-up 1): THE PLANNING MAP's LIVE REPORT SOURCES from the other
// district lanes, registered into surfaceMapSources(game) by world/surface/life.ts. Each reads only the lane's PUBLIC state (no edits to
// their internals), and returns null while that lane has no live state in this district (the map's layout defaults then stay):
//  - CARGO ('recoverables', world/surface/cargo.ts + world/trainEquipment.ts): the depot's train units — still at the depot (live units
//    standing in the depot's footprint), secured on the truck (units on its attachment points: the live mounts, else the district's
//    'surface.cargo' record) and gone from the district (the reported count minus everything still here). Before the district's first
//    seeding (or without the live equipment world) it repeats the layout's report.
//  - AIR ('windows', world/surface/air.ts + the gas system's pane breaches): per KNOWN building (entered / explored) its live broken panes
//    and open doorways — each an opening the outdoor gas comes in through (AIR's rule) — and the checkpoint tent's flap while open.
// The report text is derived from that state only; nothing is invented, nothing is about another section or the campaign.

import type {StationLayout} from '../../gen/stationTypes';
import type {SRect, SurfaceInfo} from '../../gen/surface/surfaceTypes';
import {recoverableName, vehiclePoseOf, type MapReportInput, type VehicleLike} from './mapModel';
import {depotRecoverables} from './cargoSeed'; // (lane FIXES)
import {surfaceMapSources, type MapReportContext, type SurfaceMapReportSource} from './mapRuntime';
import {SURFACE_CARGO_LANE, surfaceCargoOf} from './cargoStore';
import {surfaceAirRuntime, type SurfaceAirRuntime} from './air';

const centre = (r: SRect) => ({x: (r.x0 + r.x1) / 2, z: (r.z0 + r.z1) / 2});
const inRect = (r: SRect, x: number, z: number, pad = 0) => x >= r.x0 - pad && x <= r.x1 + pad && z >= r.z0 - pad && z <= r.z1 + pad;
const names = (kinds: readonly string[]) => [...new Set(kinds.map(recoverableName))].join(', ');
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// --- CARGO --------------------------------------------------------------------------------------------------------------------------

/** One train unit as the equipment system reads it out (TrainEquipmentSystem.all(): EquipmentReadout). */
export interface CargoUnitView { kind: string; mode: string; owner: string; x: number; z: number }

/** The district's cargo state the report reads. */
export interface CargoView {
  /** The depot recoverables were seeded into this district (lane 'surface.cargo' `seeded`). */
  seeded: boolean;
  /**
   * (task studio-surface-run-field-followup-20261116-211729-01, lane FIXES) The recoverables' indices the depot was seeded with under the
   * one-upgrade rule (the record's `depot`); absent / null on a depot seeded before it (it got the whole collection).
   */
  depot?: readonly number[] | null;
  /** Every live unit of the district world (null: no live equipment world here). */
  units: readonly CargoUnitView[] | null;
  /** Kinds of the units secured on the truck (the live mounts, else the district record). */
  secured: readonly string[];
  /** Where the truck stands (null: unknown — the layout's truck pose is used). */
  truck: {x: number; z: number} | null;
}

/** The cargo reports: the depot (key 'recoverables') and the truck's secured units (key 'truck-cargo'). */
export function cargoReports(s: SurfaceInfo, v: CargoView): MapReportInput[] {
  const out: MapReportInput[] = [];
  const reported = depotRecoverables(s, v.seeded, v.depot); // (lane FIXES: what this depot holds — one upgrade, or a legacy whole set)
  const depot = s.buildings.find(b => b.id === s.depot.building);
  if (depot && reported.length) {
    const c = centre(depot.footprint), n = reported.length;
    let text: string;
    if (!v.seeded || !v.units) text = `Train units reported: ${names(reported.map(r => r.kind))}`;
    else {
      const live = v.units.filter(u => u.mode !== 'pending' && u.mode !== 'transit');
      const here = live.filter(u => u.owner !== 'mount' && inRect(depot.footprint, u.x, u.z, 1));
      const elsewhere = live.filter(u => u.owner !== 'mount' && !here.includes(u)).length;
      const h = Math.min(here.length, n);
      const gone = Math.max(0, n - h - v.secured.length - elsewhere);
      text = h > 0 ? `Depot: ${h} of ${plural(n, 'train unit')} here (${names(here.map(u => u.kind))})` : `Depot: none of the ${plural(n, 'train unit')} left`;
      if (gone > 0) text += ` · ${gone} gone from the district`;
    }
    out.push({x: c.x, z: c.z, text, kind: 'supply', source: 'cargo', key: 'recoverables'});
  }
  if (v.secured.length) {
    const t = v.truck ?? {x: s.truck.x, z: s.truck.z};
    out.push({x: t.x, z: t.z, text: `Truck: ${plural(v.secured.length, 'unit')} secured (${names(v.secured)})`, kind: 'supply', source: 'cargo', key: 'truck-cargo'});
  }
  return out;
}

// --- AIR ----------------------------------------------------------------------------------------------------------------------------

/** The district's live openings the report reads. */
export interface AirView {
  /** Broken panes per building id. */
  broken: ReadonlyMap<number, number>;
  /** Open (not shut) doorways per building id (a smashed doorway is always open). */
  doors: ReadonlyMap<number, number>;
  /** The checkpoint tent's flap is open. */
  tentOpen: boolean;
}

/** The air reports (key 'windows'): known buildings with live openings, the tent flap while open. */
export function airReports(s: SurfaceInfo, v: AirView, ctx: Pick<MapReportContext, 'known'>): MapReportInput[] {
  const out: MapReportInput[] = [];
  for (const b of s.buildings) {
    const panes = v.broken.get(b.id) ?? 0, doors = v.doors.get(b.id) ?? 0;
    if ((!panes && !doors) || !ctx.known(b.id)) continue;
    const parts: string[] = [];
    if (panes) parts.push(`Broken windows (${panes})`);
    if (doors) parts.push(doors === 1 ? 'a doorway open' : `${doors} doorways open`);
    const c = centre(b.footprint);
    out.push({x: c.x, z: c.z, text: `${parts.join(' · ')} — gas gets in`, kind: 'hazard', source: 'air', key: 'windows'});
  }
  if (v.tentOpen) {
    const d = s.checkpoint.tent.door;
    out.push({x: d.x, z: d.z, text: 'Tent flap open — gas gets in', kind: 'hazard', source: 'air', key: 'windows'});
  }
  return out;
}

// --- the Game adapters -------------------------------------------------------------------------------------------------------------

/** What the sources read from Game (structural: tests drive them with a small host). */
export interface MapSourceHost {
  layout: StationLayout;
  run: {laneStore<T = unknown>(lane: string): T | undefined};
  trainEquipment?: {worldLive: boolean; all(): readonly CargoUnitView[]} | null;
  skywaysCar?: VehicleLike | null;
  gas?: {windows: {readonly plans: readonly unknown[]; state: ReadonlyMap<string, {broken: boolean}>; refs: ReadonlyMap<string, {plan: {index: number}}>} | null} | null;
}

/** The live cargo state of the district (null outside one). */
export function cargoViewOf(h: MapSourceHost): CargoView | null {
  if (!h.layout.surface) return null;
  const rec = surfaceCargoOf(h.run.laneStore(SURFACE_CARGO_LANE));
  const eq = h.trainEquipment, units = eq?.worldLive ? eq.all() : null;
  const secured = units ? units.filter(u => u.owner === 'mount').map(u => u.kind) : (rec.secured ?? []).map(m => m.unit.kind);
  const t = vehiclePoseOf(h.skywaysCar); // (lane TRUCK's truck: its transform)
  return {seeded: rec.seeded === 1, depot: rec.depot ?? null, units, secured, truck: t ? {x: t.x, z: t.z} : null};
}

/** The live openings of the district (null while AIR has no built district world for this layout). */
export function airViewOf(h: MapSourceHost, air: () => Pick<SurfaceAirRuntime, 'air'> | null = surfaceAirRuntime): AirView | null {
  const a = air()?.air, s = h.layout.surface;
  if (!a || !s || a.layout !== h.layout) return null;
  const broken = new Map<number, number>(), doors = new Map<number, number>();
  const w = h.gas?.windows;
  if (w && w.plans === a.plans) { // (the gas system's breaches of THIS district's panes)
    for (const [id, st] of w.state) {
      if (!st.broken) continue;
      const b = s.windows[w.refs.get(id)?.plan.index ?? -1]?.building;
      if (b !== undefined) broken.set(b, (broken.get(b) ?? 0) + 1);
    }
  }
  let tentOpen = false;
  for (const d of a.doors) {
    const open = d.plan.leaves.length === 0 || d.t > 0.02;
    if (!open) continue;
    if (d.plan.tent) tentOpen = true;
    else if (d.plan.building >= 0) doors.set(d.plan.building, (doors.get(d.plan.building) ?? 0) + 1);
  }
  return {broken, doors, tentOpen};
}

export function cargoMapSource(h: MapSourceHost): SurfaceMapReportSource {
  return {name: 'cargo', keys: ['recoverables'], reports: s => { const v = cargoViewOf(h); return v ? cargoReports(s, v) : null; }};
}

export function airMapSource(h: MapSourceHost, air?: () => Pick<SurfaceAirRuntime, 'air'> | null): SurfaceMapReportSource {
  return {name: 'air', keys: ['windows'], reports: (s, ctx) => { const v = airViewOf(h, air); return v ? airReports(s, v, ctx) : null; }};
}

/** Registers the CARGO and AIR report sources into the game's planning map (world/surface/life.ts). */
export function installSurfaceMapSources(game: object): void {
  const h = game as MapSourceHost;
  surfaceMapSources(game).push(cargoMapSource(h), airMapSource(h));
}
