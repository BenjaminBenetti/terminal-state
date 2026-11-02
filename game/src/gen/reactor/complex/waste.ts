// Task reactor-expansion-20261101 (lane WASTE): THE NUCLEAR-WASTE REPOSITORY carver — a substantial side complex off the Reactor's main
// shaft (tier 4) housing zone 2's auxiliary generator (the third generator: it powers the core floor's fans). Contract: ./types.ts.
//
// carveWaste(inp) plans the program in the slot's region (./wastePlan.ts: receiving bay on the entrance, health-physics checkpoint,
// control room + dosimetry / change room, the long DRUM VAULT, the compactor, the sealed-vault corridor split by a
// heavy airlock door, the generator / ventilation plant, the sump & pump room and the DRY-CASK HALL; >= 2 disjoint routes from the bay
// to the plant), carves it as areas of the slot's storey with doors, opens the entrance from the shaft deck and places the zone
// generator in the plant. The returned `dress` hook (./wasteDress.ts) furnishes it after the crop. Pure: draws only from inp.rng.

import {FLOOR} from '../../grid';
import type {Area, Door, Rect} from '../../stationTypes';
import type {ComplexCarve, ComplexCarveInput, ComplexRoom} from './types';
import {WASTE_CLEAR, WASTE_ROOMS, doorGapL, planWaste, type WasteDoorKind, type WasteKey, type WastePlan} from './wastePlan';
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
  doors: {id: number; kind: WasteDoorKind | 'entrance'; a: WasteKey | 'deck'; b: WasteKey}[];
  frontArea: number;
  /** Generator footprint / use cell (canvas cells, BEFORE the crop). */
  genFoot: Rect;
  genUse: [number, number];
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
  for (const s of WASTE_ROOMS) {
    const r = f.rect(plan.rooms[s.key]);
    if (!inside(r, slot.region) || !k.rectFree(r, level)) return fail(`rock-${s.key}`);
  }
  const front = k.areas[slot.frontArea];
  if (!front || (front.level ?? 0) !== level) return fail('front-area');
  // --- areas (entry first) -----------------------------------------------------------------------------------------------------------
  const ids = {} as Record<WasteKey, number>;
  const areaOf = (key: WasteKey): Area => k.areas[ids[key]];
  for (const s of WASTE_ROOMS) {
    const ceil = r2(base + Math.min(WASTE_CLEAR[s.clear], maxClear));
    const a = k.addArea(f.rect(plan.rooms[s.key]), s.kind, s.type, ceil, -1, {...levelOpt, floorY: base, label: s.label, role: 'reactor-room'});
    if (!levelOpt.level) delete a.floorY;
    a.purpose = s.purpose;
    a.publicSpace = false;
    ids[s.key] = a.id;
  }
  // --- the entrance: the shaft deck -> the bay through the pit-wall span (and any rock rows up to the bay) ------------------------------
  const doors: WasteCarveRecord['doors'] = [];
  {
    const bay = plan.rooms.bay;
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
    const gl = doorGapL(plan.rooms[ds.a], plan.rooms[ds.b], ds.w, ds.t);
    if (!gl) return fail(`door-${ds.a}-${ds.b}`);
    const d: Door = k.carveDoor(f.rect(gl), areaOf(ds.a), areaOf(ds.b), ds.h, false);
    doors.push({id: d.id, kind: ds.kind, a: ds.a, b: ds.b});
  }
  // --- the zone generator in the plant --------------------------------------------------------------------------------------------
  const foot = f.rect(plan.gen.foot);
  const [ux, uy] = f.cell(plan.gen.use[0], plan.gen.use[1]);
  const plant = areaOf('plant');
  for (let y = foot.y; y < foot.y + foot.h; y++) for (let x = foot.x; x < foot.x + foot.w; x++) if (g.area[g.idx(x, y)] !== plant.id) return fail('gen-foot');
  if (g.area[g.idx(ux, uy)] !== plant.id) return fail('gen-use');
  const fcx = foot.x + foot.w / 2, fcy = foot.y + foot.h / 2;
  const toUse = [ux + 0.5 - fcx, uy + 0.5 - fcy];
  // skid long axis = local u; its yaw (camera convention) turns the model's +X end (the control-box end) toward the use point
  const alongX = foot.w > foot.h;
  const genYaw = alongX ? (toUse[0] >= 0 ? 0 : Math.PI) : (toUse[1] >= 0 ? -Math.PI / 2 : Math.PI / 2);
  // the use point faces the skid's end (yaw: forward = (-sin, -cos))
  const face = alongX ? [Math.sign(-toUse[0]), 0] : [0, Math.sign(-toUse[1])];
  const useYaw = Math.round(Math.atan2(-face[0], -face[1]) * 1000) / 1000;

  const rec: WasteCarveRecord = {plan, level, baseY: base, areas: ids, doors, frontArea: slot.frontArea, genFoot: foot, genUse: [ux, uy]};
  const order: WasteKey[] = ['bay', 'hp', 'control', 'lockers', 'vault', 'compactor', 'kWest', 'kEast', 'plant', 'pump', 'cask'];
  const rooms: ComplexRoom[] = WASTE_ROOMS.map(s => ({area: ids[s.key], key: s.key, label: s.label, role: s.role}));
  return {
    id: 'waste', slot, areas: order.map(q => ids[q]), entryArea: ids.bay, rooms,
    generator: {area: plant.id, foot, yaw: Math.round(genYaw * 1000) / 1000, use: {x: ux, y: uy, yaw: useYaw}},
    name: 'Waste repository',
    dress: (layout, drng, crop) => dressWaste(layout, drng, crop, rec),
  };
}

const inside = (r: Rect, R: Rect) => r.x >= R.x + 1 && r.y >= R.y + 1 && r.x + r.w <= R.x + R.w - 1 && r.y + r.h <= R.y + R.h - 1;
