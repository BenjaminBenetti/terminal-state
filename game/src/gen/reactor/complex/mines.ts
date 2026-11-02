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
import {CELL} from '../../grid';
import type {ComplexCarve, ComplexCarveInput, ComplexRoom} from './types';
import {MINES, planMines, type MinePlan} from './minesPlan';
import {dressMines, type MinesDressInfo} from './minesDress';

/** Human name of the complex. */
export const MINES_NAME = 'No. 2 workings — old service mine';

/** carveMines' result: the contract plus the lane's extras (the plan for QA / tests, a cable route the host may adopt). */
export interface MinesCarve extends ComplexCarve {
  plan: MinePlan;
  /**
   * Cable route from the generator back to the entrance doorway (canvas cells, continuous; `y` = absolute height): along the haulage
   * drift's wall under the support sets, through each opening below its head. The host may prepend it to ReactorGenerator.cable.
   */
  cable: {x: number; z: number; y: number}[];
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
    const A = k.addArea(r.rect, r.kind, r.type, r2(slot.baseY + r.clear), parent, {...levelOpt, floorY: slot.baseY, label: r.label, publicSpace: false});
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
    name: MINES_NAME, plan, cable: cableRoute(plan, slot.baseY),
    dress: (layout, drng, crop) => dressMines(layout, drng, crop, info),
  };
  MINES_STATS.ms = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
  return out;
}

/**
 * The generator's cable back to the entrance (canvas cells): from the skid's panel end along the haulage route's openings (each crossed
 * 0.3 m in from its jamb, below its head) to the adit mouth. Heights: 2.2 m above the floor in the openings, 2.5 m along the walls.
 */
function cableRoute(plan: MinePlan, base: number): {x: number; z: number; y: number}[] {
  const pts: {x: number; z: number; y: number}[] = [];
  const g = plan.generator;
  pts.push({x: g.use.x, z: g.use.y, y: r2(base + 2.5)});
  // the haulage chain from the cavern back to the portal (parent links)
  const byKey = new Map(plan.rooms.map(r => [r.key, r]));
  const chain: string[] = ['cavern'];
  let cur = plan.rooms.filter(r => r.part === 'haulage').slice(-1)[0];
  while (cur) { chain.push(cur.key); cur = cur.parent ? byKey.get(cur.parent)! : undefined!; if (cur && cur.key === 'portal') { chain.push('portal'); break; } }
  for (let i = 0; i + 1 < chain.length; i++) {
    const d = plan.doors.find(q => (q.a === chain[i] && q.b === chain[i + 1]) || (q.b === chain[i] && q.a === chain[i + 1]));
    if (!d) continue;
    const along = d.rect.w >= d.rect.h;
    const x = along ? d.rect.x + 0.6 : d.rect.x + 0.5, z = along ? d.rect.y + 0.5 : d.rect.y + 0.6;
    pts.push({x, z, y: r2(base + 2.2)});
  }
  const e = plan.doors.find(q => q.a === null);
  if (e) pts.push({x: e.rect.x + (e.rect.w >= e.rect.h ? 0.6 : 0.5), z: e.rect.y + (e.rect.w >= e.rect.h ? 0.5 : 0.6), y: r2(base + 2.2)});
  void CELL; void MINES;
  return pts;
}
