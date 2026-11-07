// Task studio-skyways-rework-20261107-054512-01 (layout version 3; user: "occasional accessible office building floor / wing using
// Office assets / layout principles"): the tenant OFFICE WING of a Skyways building (gen/skyways/carve.ts carveOfficeWing) furnished
// with the Office level's own kit and rules:
//  - the OPEN PLAN: the office floor's cubicle farm (gen/office/dress.ts cubicleFarm: double pods on partition spines, aisles, desks
//    with monitors / chairs), a reception desk by the entrance, the copier and the water cooler along a wall, a dead plant;
//  - the MEETING ROOM: the conference table (gen/office/dress.ts conferenceTable) and a whiteboard;
//  - the private OFFICES: a desk with its chair and a filing cabinet (drawers: an openable holder), a shelf;
//  - the BREAK ROOM: the kitchenette and a fridge (openable holders), a table with chairs, a couch.
// Placed with the station placement kit on its own rng fork after the station dresser (index.ts holds the wing during that pass), then
// lifted onto the wing's storey. Loot comes from the holders' own purposes (the loot-table foundation); nothing is new here.

import type {Rng} from '../../core/rng';
import {CELL} from '../grid';
import type {PropPlacement} from '../props';
import {makePlaceCtx, rowAlongWall, tryPlaceProp, type PlaceCtx} from '../placeKit';
import type {Area, Side, StationLayout} from '../stationTypes';
import {conferenceTable, cubicleFarm, hostDecor, type OfficeDress} from '../office/dress';
import {PROP_DEFS} from '../props';

export interface OfficeWingResult { props: PropPlacement[]; skipped: string[] }
const SIDES: Side[] = ['N', 'S', 'E', 'W'];
const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** The office kit's dressers read only the layout / placement context for these roles (no tower: never an admin bay). */
const stubDress = (layout: StationLayout, level: number): OfficeDress => ({layout, level, tower: {meta: new Map()}} as unknown as OfficeDress);

/** Dresses the office wing (no-op without one). */
export function dressSkywaysOfficeWing(layout: StationLayout, rng: Rng): OfficeWingResult {
  const res: OfficeWingResult = {props: [], skipped: []};
  const w = layout.skyways?.officeWing;
  if (!w) return res;
  const lv = w.level, g = layout.levels[lv].grid;
  const p0 = layout.props.length;
  const ctx = makePlaceCtx(layout, rng, lv);
  const d = stubDress(layout, lv);
  for (const q of w.rooms) {
    const a = layout.areas[q.area];
    if (!a) continue;
    const before = layout.props.length;
    if (q.role === 'open') openPlan(d, ctx, a, rng);
    else if (q.role === 'meeting') { conferenceTable(d, ctx, a); wallRow(ctx, a, 'officeWhiteboard', 1, rng); }
    else if (q.role === 'office') privateOffice(ctx, a, rng);
    else breakRoom(ctx, a, rng);
    if (layout.props.length === before) res.skipped.push(`office wing: nothing in the ${q.role} room ${a.label}`);
  }
  // onto the wing's storey (hosted pieces keep their height over the host)
  for (let i = p0; i < layout.props.length; i++) {
    const p = layout.props[i];
    const [cx, cy] = g.cellOf(p.x, p.z);
    p.y = r3(p.y + (g.inBounds(cx, cy) ? g.floorOf(g.idx(cx, cy)) : layout.levels[lv].baseY));
    p.level = lv;
  }
  // the office's desk decor (gen/office/dress.ts hostDecor, absolute heights): a chair pulled up and a monitor on every desk, chairs
  // round the conference table, the receptionist's screen
  const n0 = layout.props.length;
  for (let pi = p0; pi < n0; pi++) {
    const p = layout.props[pi], def = PROP_DEFS[p.kind];
    if (p.kind !== 'desk' && p.kind !== 'receptionDesk' && p.kind !== 'conferenceTable') continue;
    const fx = Math.sin(p.rot), fz = Math.cos(p.rot), lx = Math.cos(p.rot), lz = -Math.sin(p.rot), lvo = {level: lv};
    if (p.kind === 'conferenceTable') {
      const per = Math.max(2, Math.floor(def.w / 0.75));
      for (const sgn of [-1, 1]) for (let i = 0; i < per; i++) {
        if (rng.chance(0.18)) continue;
        const t = (i + 0.5) / per * def.w - def.w / 2, off = def.d / 2 + 0.28;
        hostDecor(d, p, pi, 'officeChair', p.x + lx * t + fx * off * sgn, p.z + lz * t + fz * off * sgn, sgn > 0 ? p.rot + Math.PI : p.rot, p.y, lvo);
      }
      continue;
    }
    if (p.kind === 'desk' && rng.chance(0.85)) {
      const off = rng.pick([-0.3, -0.2, 0.25]);
      const m = hostDecor(d, p, pi, 'officeMonitor', p.x + lx * off, p.z + lz * off, p.rot, p.y + p.h, lvo);
      if (m) (p.cut ??= []).push({y: p.h, x0: off - 0.3, x1: off + 0.3});
    }
    if (p.kind === 'receptionDesk') hostDecor(d, p, pi, 'officeMonitor', p.x - lx * 0.6 - fx * 0.15, p.z - lz * 0.6 - fz * 0.15, p.rot + Math.PI, p.y + 0.74, lvo);
    if (rng.chance(0.85)) {
      const back = p.kind === 'receptionDesk' ? -1 : 1, off = def.d / 2 + 0.3;
      hostDecor(d, p, pi, 'officeChair', p.x + fx * off * back, p.z + fz * off * back, back > 0 ? p.rot + Math.PI : p.rot, p.y, lvo);
    }
  }
  for (let i = p0; i < layout.props.length; i++) res.props.push(layout.props[i]);
  return res;
}

function openPlan(d: OfficeDress, ctx: PlaceCtx, a: Area, rng: Rng): void {
  // the cubicle pods first (they need the room's long run), then the reception desk just inside the entrance, facing it
  cubicleFarm(d, ctx, a, 'open');
  const ent = ctx.layout.doors.find(q => (q.a === a.id || q.b === a.id) && ctx.layout.areas[q.a === a.id ? q.b : q.a]?.type !== 'office-room');
  if (ent) {
    const ex = (ent.x + ent.w / 2) * CELL, ez = (ent.y + ent.h / 2) * CELL, cx = (a.x + a.w / 2) * CELL, cz = (a.y + a.h / 2) * CELL;
    const dx = cx - ex, dz = cz - ez, l = Math.hypot(dx, dz) || 1;
    const rot = Math.atan2(-dx / l, -dz / l) + Math.PI; // its front toward the entrance
    for (const t of [3.2, 3.8, 4.4]) {
      if (tryPlaceProp(ctx, a, 'receptionDesk', r3(ex + (dx / l) * t + (dz / l) * 2.4), r3(ez + (dz / l) * t - (dx / l) * 2.4), rot, {ring: 1.0})) break;
    }
  }
  for (const kind of ['officePhotocopier', 'officeWaterCooler', 'deadPlant'] as const) wallRow(ctx, a, kind, 1, rng);
}

function privateOffice(ctx: PlaceCtx, a: Area, rng: Rng): void {
  wallRow(ctx, a, 'desk', 1, rng); // (its chair and monitor: the desk decor pass)
  wallRow(ctx, a, 'officeFiling', 1, rng);
  wallRow(ctx, a, 'officeShelf', 1, rng);
}

function breakRoom(ctx: PlaceCtx, a: Area, rng: Rng): void {
  wallRow(ctx, a, 'kitchenette', 1, rng);
  wallRow(ctx, a, 'fridge', 1, rng);
  wallRow(ctx, a, 'couch', 1, rng);
  const cx = (a.x + a.w / 2) * CELL, cz = (a.y + a.h / 2) * CELL;
  const t = tryPlaceProp(ctx, a, 'table', r3(cx), r3(cz), 0, {ring: 0.8});
  if (t) for (const [ox, oz, rot] of [[0, 0.75, Math.PI], [0, -0.75, 0]] as const) tryPlaceProp(ctx, a, 'officeChair', r3(t.x + ox), r3(t.z + oz), rot, {ring: 0.05});
}

/** Up to `n` of `kind` along the room's walls (sides in a seeded order). */
function wallRow(ctx: PlaceCtx, a: Area, kind: Parameters<typeof rowAlongWall>[3], n: number, rng: Rng): PropPlacement[] {
  for (const s of rng.shuffle(SIDES.slice())) {
    const got = rowAlongWall(ctx, a, s, kind, {max: n, front: 0.8});
    if (got.length) return got;
  }
  return [];
}
