// Task reactor-expansion-20261101 (lane MINES): the mines complex carver — THE OLD MINE WORKINGS behind the tier-2 pit wall that house
// zone 1's auxiliary generator (the second generator; reached once zone 0 is cleared). Contract: ./types.ts.
//
// carveMines plans the whole program first (./minesPlan.ts: pure, reads the storey grid only) and only then commits it into the shared
// Kit: areas on the slot's storey (existing RoomTypes / purposes so the station dresser, loot, spawns, materials and sounds work:
// drifts are 'service-corridor' passages, the rooms preset purposes — lamp room 'locker-room', tool room 'workshop', hoist room
// 'electrical-room', magazine 'storage', refuge 'first-aid-room', the cavern 'generator-room'), the openings between them and the
// entrance doorway from the front deck. A plan that does not fit returns null BEFORE anything is written (the host keeps the generator
// on its landing). The returned `dress` hook (./minesDress.ts) furnishes the workings after the crop.

import type {Area} from '../../stationTypes';
import type {ComplexCarve, ComplexCarveInput, ComplexRoom} from './types';
import {planMines, type MinePlan} from './minesPlan';
import {dressMines, type MinesDressInfo} from './minesDress';

/** Human name of the complex. */
export const MINES_NAME = 'No. 2 workings — old service mine';

/** carveMines' result: the contract plus the plan (QA / tests). The generator's cable is the host's (complex/host.ts complexCable). */
export interface MinesCarve extends ComplexCarve {
  plan: MinePlan;
}

/** Why the last attempts returned null (QA / tests). */
export const MINES_STATS = {plans: 0, nulls: 0, ms: 0};

const r2 = (v: number) => Math.round(v * 100) / 100;

export function carveMines(inp: ComplexCarveInput): MinesCarve | null {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const {k, rng, slot, levelOpt} = inp;
  const g = k.grid(slot.level);
  const plan = planMines(slot, g, rng, slot.ceilMax - slot.baseY);
  MINES_STATS.plans++;
  if (!plan) { MINES_STATS.nulls++; return null; }
  const front = k.areas[slot.frontArea];
  const ids = new Map<string, Area>();
  for (const r of plan.rooms) {
    // the magazine / lamp room keep their own stencilled plates (the purpose plates MAINTENANCE STORES / CREW LOCKERS would mislabel
    // them): their parent is the front deck, which they share no door with
    const parent = r.parent && r.part !== 'magazine' && r.part !== 'lamp' ? ids.get(r.parent)!.id : slot.frontArea;
    const A = k.addArea(r.rect, r.kind, r.type, r2(slot.baseY + r.clear), parent, {...levelOpt, floorY: slot.baseY, label: r.label, publicSpace: false}); // (levelOpt carries floorY too)
    A.purpose = r.purpose;
    ids.set(r.key, A);
  }
  for (const d of plan.doors) {
    const a = d.a ? ids.get(d.a)! : front, b = ids.get(d.b)!;
    k.carveDoor(d.rect, a, b, d.height, false);
  }
  const rooms: ComplexRoom[] = plan.rooms.map(r => ({area: ids.get(r.key)!.id, key: r.key, label: r.label, role: r.role}));
  const cavern = ids.get('cavern')!;
  const gp = plan.generator;
  const info: MinesDressInfo = {
    level: slot.level, base: slot.baseY,
    rooms: plan.rooms.map(r => ({key: r.key, area: ids.get(r.key)!.id, part: r.part})),
    use: {x: gp.use.x, y: gp.use.y}, foot: {...gp.foot},
  };
  const out: MinesCarve = {
    id: 'mines', slot, areas: plan.rooms.map(r => ids.get(r.key)!.id), entryArea: ids.get('portal')!.id, rooms,
    generator: {area: cavern.id, foot: {...gp.foot}, yaw: gp.yaw, use: {...gp.use}},
    name: MINES_NAME, plan,
    dress: (layout, drng, crop) => dressMines(layout, drng, crop, info),
  };
  MINES_STATS.ms = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
  return out;
}
