// Task studio-surface-run-opus-rebuild-20261116-020827-01 (lane GEN): SURFACE RUN's RECORDS for the runtime lanes — street segments (the
// map / LOOK: names, ranks, widths, blocked spans), crossings, lots, the outdoor spawn zones (LIFE: kept out of the checkpoint's safe box,
// weighted by street length) and the planning map's NOTES (local observations tied to real places in this district; never anything about
// other stations or the campaign).

import type {Rng} from '../../core/rng';
import {CELL} from '../grid';
import type {SRect, SurfaceBuilding, SurfaceJunction, SurfaceLot, SurfaceNote, SurfaceRubble, SurfaceStreet} from './surfaceTypes';
import {crH, crW, type CR, type CityFrame} from './cityFrame';
import type {BlockPlans} from './cityBlocks';
import type {GroundMap} from './cityCarve';

const toM = (r: CR): SRect => ({x0: r.x0 * CELL, z0: r.y0 * CELL, x1: r.x1 * CELL, z1: r.y1 * CELL});
const r2 = (v: number) => Math.round(v * 100) / 100;

/** Street records: one per carriageway segment (id = segment id), then one per service lane. */
export function streetRecords(f: CityFrame, plans: BlockPlans): SurfaceStreet[] {
  const out: SurfaceStreet[] = f.segments.map(s => {
    const zRun = s.run === 'z';
    const c = zRun ? (s.r.x0 + s.r.x1) / 2 * CELL : (s.r.y0 + s.r.y1) / 2 * CELL;
    return {id: s.id, name: s.line.name, ax: r2(zRun ? c : s.r.x0 * CELL), az: r2(zRun ? s.r.y0 * CELL : c), bx: r2(zRun ? c : s.r.x1 * CELL), bz: r2(zRun ? s.r.y1 * CELL : c),
      width: s.line.cw * CELL, sidewalk: s.line.sw * CELL, rank: s.line.rank};
  });
  for (const l of plans.lots) {
    if (l.use !== 'alley') continue;
    const b = f.blocks[l.block];
    const alongX = crW(l.r) >= crH(l.r);
    const c = alongX ? (l.r.y0 + l.r.y1) / 2 * CELL : (l.r.x0 + l.r.x1) / 2 * CELL;
    out.push({id: out.length, name: `${(alongX ? b.lines.N : b.lines.W).name.replace(/ (Street|Avenue|Road|Boulevard|Way)$/, '')} Lane`,
      ax: r2(alongX ? l.r.x0 * CELL : c), az: r2(alongX ? c : l.r.y0 * CELL), bx: r2(alongX ? l.r.x1 * CELL : c), bz: r2(alongX ? c : l.r.y1 * CELL),
      width: (alongX ? crH(l.r) : crW(l.r)) * CELL, sidewalk: 0, rank: 'lane'});
  }
  return out;
}

export function junctionRecords(f: CityFrame, gm: GroundMap): SurfaceJunction[] {
  return gm.groupRect.map((r, k) => {
    const segs = f.segments.filter(s => gm.junctionGroup[s.a] === k || gm.junctionGroup[s.b] === k);
    return {id: k, rect: toM(r), streets: segs.map(s => s.id), area: gm.junctionArea[f.junctions.find(j => gm.junctionGroup[j.id] === k)!.id], signals: segs.some(s => s.line.rank === 'avenue')};
  });
}

export function lotRecords(plans: BlockPlans, gm: GroundMap): SurfaceLot[] {
  const byLot = new Map<number, number>();
  for (const [a, l] of gm.lotOfArea) byLot.set(l.id, a);
  return plans.lots.map(l => ({id: l.id, block: l.block, rect: toM(l.r), use: l.use, grade: l.grade, area: byLot.get(l.id) ?? -1, label: l.label, driveways: [...l.driveways],
    ...(l.diagonal ? {diagonal: true} : {})}));
}

/** Outdoor spawn zones: carriageway segments (the part outside the safe box along the run) and the larger open lots. */
export function spawnZones(f: CityFrame, plans: BlockPlans, safe: SRect): (SRect & {weight: number})[] {
  const out: (SRect & {weight: number})[] = [];
  const hits = (r: SRect) => r.x0 < safe.x1 && safe.x0 < r.x1 && r.z0 < safe.z1 && safe.z0 < r.z1;
  for (const s of f.segments) {
    const m = toM(s.r);
    const zRun = s.run === 'z';
    const parts: SRect[] = [];
    if (!hits(m)) parts.push(m);
    else if (zRun) { if (safe.z0 - m.z0 > 8) parts.push({...m, z1: safe.z0}); if (m.z1 - safe.z1 > 8) parts.push({...m, z0: safe.z1}); }
    else { if (safe.x0 - m.x0 > 8) parts.push({...m, x1: safe.x0}); if (m.x1 - safe.x1 > 8) parts.push({...m, x0: safe.x1}); }
    for (const p of parts) out.push({...p, weight: r2(zRun ? p.z1 - p.z0 : p.x1 - p.x0)});
  }
  for (const l of plans.lots) {
    if (!(l.use === 'parking' || l.use === 'park' || l.use === 'vacant' || l.use === 'rubble' || l.use === 'plaza' || l.use === 'yard') || l.label === 'Military checkpoint') continue;
    const m = toM(l.r);
    if (hits(m) || crW(l.r) < 16 || crH(l.r) < 16) continue;
    out.push({...m, weight: r2(Math.max(m.x1 - m.x0, m.z1 - m.z0) * 0.5)});
  }
  return out;
}

/** The planning map's notes: what the checkpoint knows about this district (all of it true of the generated layout). */
export function districtNotes(rng: Rng, o: {
  buildings: SurfaceBuilding[]; depot: number; tent: SRect; yard: SRect | null; rubble: SurfaceRubble[]; streets: SurfaceStreet[]; roadblock: SRect | null;
  enemies: ReadonlyMap<number, number>; checkpoint: {x: number; z: number};
}): SurfaceNote[] {
  const notes: SurfaceNote[] = [];
  const mid = (r: SRect) => ({x: r2((r.x0 + r.x1) / 2), z: r2((r.z0 + r.z1) / 2)});
  const door = (b: SurfaceBuilding) => {
    const e = b.entrances.find(q => q.door !== 'boarded') ?? b.entrances[0];
    return e ? {x: e.x, z: e.z} : mid(b.footprint);
  };
  const t = mid(o.tent);
  notes.push({...t, text: 'Checkpoint: map table, radio, supply crates', kind: 'info'});
  const dep = o.buildings[o.depot];
  if (dep) notes.push({...door(dep), text: `${dep.name}: train parts inside`, kind: 'route'});
  if (o.yard) notes.push({...mid(o.yard), text: 'Rail yard: truck can reach the loading door', kind: 'route'});
  for (const r of o.rubble.filter(q => q.kind === 'pile-up').slice(0, 4)) {
    const s = r.street !== undefined ? o.streets[r.street] : undefined;
    notes.push({...mid(r), text: s ? `${s.name} blocked: no vehicles` : 'Street blocked: no vehicles', kind: 'hazard'});
  }
  if (o.roadblock) notes.push({...mid(o.roadblock), text: 'Abandoned roadblock', kind: 'route'});
  const near = (b: SurfaceBuilding) => Math.hypot((b.footprint.x0 + b.footprint.x1) / 2 - o.checkpoint.x, (b.footprint.z0 + b.footprint.z1) / 2 - o.checkpoint.z);
  const SUPPLY: Record<string, string> = {pharmacy: 'medicine', clinic: 'medical supplies', grocery: 'food', hardware: 'tools', 'sporting-goods': 'gear', convenience: 'food and water'};
  const supply = o.buildings.filter(b => b.destination && b.enterable && SUPPLY[b.programme]).sort((p, q) => near(p) - near(q)).slice(0, 4);
  for (const b of supply) notes.push({...door(b), text: `${b.name}: ${SUPPLY[b.programme]}, not yet searched`, kind: 'supply'});
  const busy = o.buildings.filter(b => (o.enemies.get(b.id) ?? 0) >= 4).sort((p, q) => (o.enemies.get(q.id) ?? 0) - (o.enemies.get(p.id) ?? 0)).slice(0, 2);
  for (const b of busy) notes.push({...door(b), text: `Movement inside ${b.name}`, kind: 'enemy'});
  const ruins = o.rubble.filter(q => q.kind === 'spill');
  if (ruins.length) notes.push({...mid(rng.pick(ruins)), text: 'Collapsed building: debris on the road', kind: 'hazard'});
  return notes;
}
