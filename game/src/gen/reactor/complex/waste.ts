// Task reactor-expansion-20261101 (lane WASTE): THE NUCLEAR-WASTE REPOSITORY carver — a substantial side complex off the Reactor's main
// shaft (tier 4) housing zone 2's auxiliary generator (the third generator: it powers the core floor's fans). Contract: ./types.ts.
//
// carveWaste(inp) plans the program in the slot's region (./wastePlan.ts: a SEEDED ROOM GRAPH grown from the entrance — receiving
// bay, health-physics checkpoint, change room, control room, the vault airlock and the sealed corridors with the drum vault(s), the
// compactor, the hot-cell gallery and the DRY-CASK HALL off them, the service side with the generator / ventilation plant; >= 2
// independent loops), carves it as areas of the slot's storey with doors, opens the entrance from the shaft deck and places the zone
// generator in the plant. The returned `dress` hook (./wasteDress.ts) furnishes it after the crop. Pure: draws only from inp.rng.

import {FLOOR} from '../../grid';
import type {Area, Door, Rect} from '../../stationTypes';
import type {ComplexCarve, ComplexCarveInput, ComplexRoom} from './types';
import {WASTE_CLEAR, WASTE_KINDS, doorGapL, planWaste, type WasteDoorKind, type WasteKey, type WastePlan} from './wastePlan';
import {dressWaste} from './wasteDress';

/** Why the last carves returned null (QA / tests). */
export const WASTE_CARVE_FAILS: Record<string, number> = {};
const fail = (why: string): null => { WASTE_CARVE_FAILS[why] = (WASTE_CARVE_FAILS[why] ?? 0) + 1; return null; };

const r2 = (v: number) => Math.round(v * 100) / 100;

/** What the carve recorded for the dress hook (area / door ids are layout indices: the crop keeps them). */
export interface WasteCarveRecord {
  plan: WastePlan;
  level: number;
  baseY: number;
  areas: Record<WasteKey, number>;
  /** Door ids (layout.doors) by kind, the entrance door and every door of the complex. */
  doors: {id: number; kind: WasteDoorKind | 'entrance'; a: WasteKey | 'deck'; b: WasteKey; loop?: boolean}[];
  frontArea: number;
  /** The slot's entrance span (canvas cells, BEFORE the crop). */
  entrance: Rect;
  /** Generator footprint / use cell (canvas cells, BEFORE the crop). */
  genFoot: Rect;
  genUse: [number, number];
  /** The carve's room records (the host copies their labels into layout.reactor.complexes after the dress: a relabel shows). */
  rooms: ComplexRoom[];
  /** The guaranteed set pieces' reserved spans (canvas cells, BEFORE the crop): booth / hot-cell window, the room, the rect. */
  reserve: {what: 'booth' | 'hotcell'; room: WasteKey; side: 0 | 1 | 2 | 3; rect: Rect}[];
}

export function carveWaste(inp: ComplexCarveInput): ComplexCarve | null {
  const {k, rng, slot, levelOpt} = inp;
  const level = slot.level, base = slot.baseY, g = k.grid(level);
  const plan = planWaste(slot.region, slot.inward, slot.entrance, rng);
  if (!plan) return fail('plan');
  const f = plan.frame;
  const room = WASTE_CLEAR.room, maxClear = slot.ceilMax - base;
  if (maxClear < room - 1e-6) return fail('ceiling');
  // every space must be free rock (with its wall margin) inside the region
  for (const s of plan.rooms) {
    const r = f.rect(s.r);
    if (!inside(r, slot.region) || !k.rectFree(r, level)) return fail(`rock-${s.key}`);
  }
  const front = k.areas[slot.frontArea];
  if (!front || (front.level ?? 0) !== level) return fail('front-area');
  // --- areas (entry first: the plan grows from the bay) ----------------------------------------------------------------------------
  const ids = {} as Record<WasteKey, number>;
  const areaOf = (key: WasteKey): Area => k.areas[ids[key]];
  for (const s of plan.rooms) {
    const sp = WASTE_KINDS[s.kind];
    const ceil = r2(base + Math.min(WASTE_CLEAR[sp.clear], maxClear));
    const a = k.addArea(f.rect(s.r), sp.kind, s.type, ceil, -1, {...levelOpt, ...(levelOpt.level ? {floorY: base} : {}), label: s.label, role: 'reactor-room'});
    a.purpose = s.purpose;
    a.publicSpace = false;
    ids[s.key] = a.id;
  }
  // --- the entrance: the shaft deck -> the bay through the pit-wall span (and any rock rows up to the bay) ------------------------------
  const doors: WasteCarveRecord['doors'] = [];
  {
    const bay = plan.by.bay.r;
    const [u0, u1, ev] = [plan.entrance.u0, plan.entrance.u1, plan.entrance.v];
    const gap = f.rect({u: u0, v: ev, du: u1 - u0, dv: bay.v - ev});
    for (let y = gap.y; y < gap.y + gap.h; y++) for (let x = gap.x; x < gap.x + gap.w; x++) {
      const i = g.idx(x, y), entr = x >= slot.entrance.x && x < slot.entrance.x + slot.entrance.w && y >= slot.entrance.y && y < slot.entrance.y + slot.entrance.h;
      if (!entr && g.cells[i] === FLOOR) return fail('entrance-gap');
    }
    const d = k.carveDoor(gap, front, areaOf('bay'), Math.min(4.2, maxClear), false);
    doors.push({id: d.id, kind: 'entrance', a: 'deck', b: 'bay'});
  }
  // --- doors between the spaces ---------------------------------------------------------------------------------------------------
  for (const ds of plan.doors) {
    const gl = doorGapL(plan.by[ds.a].r, plan.by[ds.b].r, ds.w, ds.t);
    if (!gl) return fail(`door-${ds.a}-${ds.b}`);
    const d: Door = k.carveDoor(f.rect(gl), areaOf(ds.a), areaOf(ds.b), ds.h, false);
    doors.push({id: d.id, kind: ds.kind, a: ds.a, b: ds.b, ...(ds.loop ? {loop: true} : {})});
  }
  // --- the zone generator in the plant --------------------------------------------------------------------------------------------
  const foot = f.rect(plan.gen.foot);
  const [ux, uy] = f.cell(plan.gen.use[0], plan.gen.use[1]);
  const plant = areaOf('plant');
  for (let y = foot.y; y < foot.y + foot.h; y++) for (let x = foot.x; x < foot.x + foot.w; x++) if (g.area[g.idx(x, y)] !== plant.id) return fail('gen-foot');
  if (g.area[g.idx(ux, uy)] !== plant.id) return fail('gen-use');
  const fcx = foot.x + foot.w / 2, fcy = foot.y + foot.h / 2;
  const toUse = [ux + 0.5 - fcx, uy + 0.5 - fcy];
  // skid long axis = the plant's long side; its yaw (camera convention) turns the model's +X end (the control-box end) toward the use point
  const alongX = foot.w > foot.h;
  const genYaw = alongX ? (toUse[0] >= 0 ? 0 : Math.PI) : (toUse[1] >= 0 ? -Math.PI / 2 : Math.PI / 2);
  // the use point faces the skid's end (yaw: forward = (-sin, -cos))
  const face = alongX ? [Math.sign(-toUse[0]), 0] : [0, Math.sign(-toUse[1])];
  const useYaw = Math.round(Math.atan2(-face[0], -face[1]) * 1000) / 1000;

  const rooms: ComplexRoom[] = plan.rooms.map(s => ({area: ids[s.key], key: s.key, label: s.label, role: WASTE_KINDS[s.kind].role}));
  const rec: WasteCarveRecord = {plan, level, baseY: base, areas: ids, doors, frontArea: slot.frontArea, entrance: {...slot.entrance}, genFoot: foot, genUse: [ux, uy], rooms,
    reserve: plan.reserve.map(q => ({what: q.what, room: q.room, side: q.side, rect: f.rect(q.r)}))};
  return {
    id: 'waste', slot, areas: plan.rooms.map(s => ids[s.key]), entryArea: ids.bay, rooms,
    generator: {area: plant.id, foot, yaw: Math.round(genYaw * 1000) / 1000, use: {x: ux, y: uy, yaw: useYaw}},
    name: 'Waste repository',
    // the booth / window spans: the host holds them through the shared station dresser (ComplexCarve.reserve)
    reserve: rec.reserve.map(q => ({...q.rect})),
    dress: (layout, drng, crop) => dressWaste(layout, drng, crop, rec),
  };
}

const inside = (r: Rect, R: Rect) => r.x >= R.x + 1 && r.y >= R.y + 1 && r.x + r.w <= R.x + R.w - 1 && r.y + r.h <= R.y + R.h - 1;
