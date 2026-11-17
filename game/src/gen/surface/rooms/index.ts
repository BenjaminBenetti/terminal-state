// Task studio-surface-run-opus-rebuild-20261116-020827-01 (lane ROOMS): the INTERIOR PLANNER (gen/surface/rooms/api.ts InteriorPlanner) —
// one programme-shaped interior per enterable building, every programme its own floor plan (rooms/programmes.ts ids):
//  - stores (rooms/stores.ts): sales floor + the programme's back of house (+ upper sales floor / offices);
//  - small shopping centres (rooms/centres.ts): the strip centre's gallery / units / service corridor (+ office suites above), the
//    arcade's covered walk with units both sides (+ a second arcade above);
//  - offices and civic buildings (rooms/office.ts, rooms/civic.ts): a double-loaded corridor, lobby / bay, rooms by programme, the core;
//  - the train-repair depot (rooms/depot.ts): shed, tracks, pit, crane, support wing, mezzanine, the recoverables and the dolly lanes.
// Then the shared finish (rooms/finish.ts): window spans + daylight, the darker interior fixtures, the permanent interior enemies, the
// loose finds, the entrance records. Deterministic from plot.rng alone (named forks only; never the Kit's stream).
//
// Plan-local indices (the caller rebases them when it appends the plan to the district's lists): props[].host = an index into plan.props;
// links[].id = an index into plan.links (LevelLink ids are indices into layout.levelLinks). links[].traversalId / the flights' ids are
// already Kit-global (kit.flights indices: the district's layout.traversal.stairs must be kit.flights).

import {FLOOR} from '../../grid';
import type {InteriorPlan, InteriorPlot} from './api';
import {InteriorBuilder, type RoomInfo} from './builder';
import {planArcade, planStripCentre} from './centres';
import {planCivic} from './civic';
import {planDepot} from './depot';
import {deskDecor, finishProps} from './dress';
import {planEnemies, planEntrances, planLights, planLoose, planWindows} from './finish';
import {assignLootKeys} from './lootKeys';
import {planOffice} from './office';
import {surfaceProgramme} from './programmes';
import {STORE_SPEC_IDS, planStore} from './stores';
import {planDeepStore} from './deepStores';
import {deepFinish} from './deepFinish';

export {SURFACE_PROGRAMMES, SURFACE_PROGRAMME_IDS, resolveProgramme, surfaceProgramme} from './programmes';

export function planInterior(plot: InteriorPlot): InteriorPlan {
  const first = plot.kit.areas.length;
  const b = new InteriorBuilder(plot);
  // (an id the planner does not know on a kind without a fallback — a residential block — gets the plain room below)
  if (b.pid && b.W >= 8 && b.D >= 8 && b.storeys.length) {
    const kind = surfaceProgramme(b.pid)?.kind;
    // (v2, lane INTERIOR: InteriorPlot.deep) a store's deep plan — back corridor, back rooms, the dog-leg core to its upper floor or roof;
    // the other programmes keep their plans with the dog-leg core (rooms/builder.ts deep mode). A v1 plot never takes this branch.
    if (b.deep && kind === 'store' && STORE_SPEC_IDS.includes(b.pid) && planDeepStore(b)) { /* planned */ }
    else if (b.pid === 'rail-depot') planDepot(b);
    else if (b.pid === 'strip-centre') planStripCentre(b);
    else if (b.pid === 'arcade') planArcade(b);
    else if (b.pid === 'office-block') planOffice(b);
    else if (kind === 'civic') planCivic(b);
    else planStore(b);
  }
  if (!b.rooms.length) plainRoom(b);
  deskDecor(b);
  finishProps(b);
  assignLootKeys(b); // the back of house's loot keys (rooms/lootKeys.ts): no station ammo-cache rows in a depot / fire station / shop
  planWindows(b);
  planLights(b);
  planEnemies(b);
  planLoose(b);
  if (b.deep) deepFinish(b); // (v2: an upper floor never stands empty of the dead)
  const entrances = planEntrances(b).filter(e => entranceOk(b, e.cells, e.side));
  const areas = plot.kit.areas.slice(first).map(a => a.id);
  return {
    areas, entrances, props: b.stub.props, lights: b.stub.lights, signs: b.stub.signs, pickups: b.stub.pickups, zombies: b.stub.zombies,
    windows: b.windows, links: b.links,
    ...(b.recoverables ? {recoverables: b.recoverables} : {}),
    ...(b.features ? {features: b.features} : {}),
  };
}

/** A plot too small for its programme: one plain room on the street storey (never fails). */
function plainRoom(b: InteriorBuilder): RoomInfo | null {
  if (b.W < 2 || b.D < 2) return null;
  return b.room(0, {u: 0, v: 0, du: b.W, dv: b.D}, {type: 'shop', label: 'Ground floor', role: 'sales', front: true, windows: 'shop', enemies: 1});
}

/**
 * An entrance is kept when every cell just inside it is walkable floor of one of the plan's street-storey rooms, never the stair core
 * (a run or a landing: a back door that meets the core stays facade wall — GEN leaves a dropped entrance's cells SOLID).
 */
function entranceOk(b: InteriorBuilder, cells: readonly number[], side: string): boolean {
  const g = b.kit.g;
  const inward: Record<string, number> = {N: g.w, S: -g.w, W: 1, E: -1};
  const d = inward[side];
  return cells.every(c => {
    const i = c + d;
    if (g.cells[i] !== FLOOR || g.rampIdx[i] >= 0) return false;
    const r = b.info(g.area[i]);
    return !!r && r.role !== 'stair-run' && r.role !== 'stair' && r.storey === 0;
  });
}
