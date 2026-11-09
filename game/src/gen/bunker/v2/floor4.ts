// Task studio-bunker-rework-20261109-205115-01: THE BUNKER v2 — storey 4, MAINTENANCE & WATER (the damp storey; level role 'lower').
// Contract: gen/bunker/v2/floorApi.ts; frame: gen/bunker/v2/spine.ts. Dressing: ./floor4Dress.ts.
//
// The shelter's MACHINE FLOOR: the storey that keeps everyone above alive — it draws, stores, treats and heats the water, filters the
// air and feeds the processing core's cooling below. Its architecture is a rhythm of HUGE PLANT HALLS (6.4 m) threaded together by
// CRAMPED SERVICE RUNS (2-2.5 m wide, 3 m low), organised on ONE AXIS:
//
//   north plant band:  RESERVOIR HALL (the cistern) — WATER TREATMENT (+ the chlorination room) — AIR FILTRATION — BOILER HOUSE
//                      → the generator's AUXILIARY POWER ROOM; a low north pipe run strings them together.
//   the hub:           the FREIGHT HALL in front of the cargo lift and the main stair (the loading bay), a pipe run north, the crew
//                      room / switch room / washroom to its east, the flooded drainage wing to its west.
//   the axis:          from the freight hall the PUMP HALL opens south — two rows of pumps either side of a central aisle — and the
//                      aisle ends in a wide opening onto the CORE GALLERY: the railed catwalk round the V45 well, where the player
//                      first looks down into the processing core's nave. The service stair lands on the well's east side (the
//                      cooling feed gallery), a west catwalk wraps its third side.
//   the damaged wing:  west of the main stair: the drainage gallery, the flooded sump and the sewage ejector room (aged, damp).
//
// Hazards: the STRONG leak is the chlorination room (a dead end off water treatment: ruptured chlorine cylinders), a weak one in the
// sewage ejector room. Damp: the water plant, the pump hall, the generator room and the drainage wing (the Strainer's habitat).

import type {Area, AreaKind, AreaRole, Rect, RoomType} from '../../stationTypes';
import type {BunkerFloorModule, FloorCarveCtx, FloorCarveResult, V2GasClass} from './floorApi';
import {dressFloor4} from './floor4Dress';

const R = (x: number, y: number, w: number, h: number): Rect => ({x, y, w, h});

/** One area of the storey. */
interface Spec {
  key: string;
  r: Rect;
  kind: AreaKind;
  type: RoomType;
  /** Clear height above the storey floor (m). */
  clear: number;
  label: string;
  purpose: string;
  parent?: string;
  role?: AreaRole;
  publicSpace?: boolean;
  noFloorLoot?: boolean;
}

/** One opening: a centred / seeded gap of `w` cells in the shared wall (`at` 0..1 along it), or an explicit gap rect. */
interface Opening {
  a: string;
  b: string;
  w: number;
  h: number;
  /** 0..1 along the shared wall (the seeded draw is added in carve); 'gap' = the explicit rect. */
  at?: number;
  jitter?: number;
  gap?: Rect;
}

/** The storey's keys (QA / tests / dress). */
export const FLOOR4_KEYS = {
  reservoir: 'reservoir', treatment: 'treatment', chlorine: 'chlorine', filtration: 'filtration', boiler: 'boiler', power: 'power',
  pipeRun: 'pipeRun', workshop: 'workshop', link: 'link', stores: 'stores', switchRoom: 'switch', washroom: 'washroom', crew: 'crew',
  freight: 'freight', pumpHall: 'pumpHall', passage: 'passage', gallery: 'gallery', feed: 'feed', drainage: 'drainage', sump: 'sump',
  ejector: 'ejector', westWalk: 'westWalk',
} as const;

/** Clear heights (m). */
const H = {hall: 6.4, plant: 5.4, mid: 4.6, room: 3.4, run: 3.0, lobby: 5.0, gallery: 4.6} as const;

function specs(): Spec[] {
  return [
    // --- the north plant band -----------------------------------------------------------------------------------------------------
    {key: 'reservoir', r: R(6, 6, 42, 30), kind: 'room', type: 'utility', clear: H.hall, label: 'Reservoir hall', purpose: 'overflow-chamber', parent: 'pipeRun'},
    {key: 'treatment', r: R(49, 8, 30, 22), kind: 'room', type: 'utility', clear: H.plant, label: 'Water treatment', purpose: 'pump-room', parent: 'pipeRun'},
    {key: 'chlorine', r: R(80, 14, 11, 12), kind: 'room', type: 'utility', clear: H.room, label: 'Chlorination room', purpose: 'spillway', parent: 'treatment'},
    {key: 'filtration', r: R(95, 8, 18, 22), kind: 'room', type: 'utility', clear: H.mid, label: 'Air filtration plant', purpose: 'ventilation-plant', parent: 'pipeRun'},
    {key: 'boiler', r: R(114, 8, 22, 28), kind: 'room', type: 'utility', clear: H.plant, label: 'Boiler house', purpose: 'boiler-room', parent: 'pipeRun'},
    {key: 'power', r: R(115, 37, 21, 20), kind: 'room', type: 'utility', clear: 6.0, label: 'Auxiliary power room', purpose: 'generator-room', parent: 'boiler'},
    {key: 'pipeRun', r: R(49, 31, 64, 5), kind: 'service', type: 'service-corridor', clear: H.run, label: 'North pipe run', purpose: 'service-corridor', parent: 'link'},
    // --- between the plant band and the hub ---------------------------------------------------------------------------------------
    {key: 'workshop', r: R(49, 37, 16, 18), kind: 'room', type: 'utility', clear: H.room, label: 'Maintenance workshop', purpose: 'workshop', parent: 'link'},
    {key: 'link', r: R(66, 37, 4, 18), kind: 'service', type: 'service-corridor', clear: H.run, label: 'Pipe run', purpose: 'service-corridor', parent: 'freight'},
    {key: 'stores', r: R(71, 37, 14, 12), kind: 'room', type: 'storage', clear: H.room, label: 'Maintenance stores', purpose: 'storage', parent: 'link'},
    {key: 'switch', r: R(86, 38, 10, 17), kind: 'room', type: 'utility', clear: H.room, label: 'Switch room', purpose: 'electrical-room', parent: 'crew'},
    {key: 'washroom', r: R(97, 38, 11, 17), kind: 'room', type: 'washroom', clear: H.room, label: 'Crew washroom', purpose: 'washroom', parent: 'crew'},
    {key: 'crew', r: R(85, 56, 23, 15), kind: 'room', type: 'crew-room', clear: H.room + 0.2, label: 'Crew room', purpose: 'locker-room', parent: 'freight'},
    // --- the hub and the axis ---------------------------------------------------------------------------------------------------
    {key: 'freight', r: R(30, 56, 54, 15), kind: 'room', type: 'utility', clear: H.lobby, label: 'Freight hall', purpose: 'storage'},
    {key: 'pumpHall', r: R(68, 72, 23, 41), kind: 'room', type: 'utility', clear: H.hall, label: 'Pump hall', purpose: 'pump-room', parent: 'freight'},
    {key: 'passage', r: R(92, 72, 5, 49), kind: 'service', type: 'service-corridor', clear: H.run + 0.2, label: 'Service passage', purpose: 'service-corridor', parent: 'crew'},
    {key: 'gallery', r: R(30, 114, 61, 10), kind: 'room', type: 'utility', clear: H.gallery, label: 'Core gallery', purpose: 'service-corridor', parent: 'pumpHall', role: 'catwalk', noFloorLoot: true},
    {key: 'feed', r: R(92, 122, 26, 24), kind: 'room', type: 'utility', clear: H.lobby, label: 'Cooling feed gallery', purpose: 'pump-room', parent: 'passage'},
    // --- the damaged drainage wing ------------------------------------------------------------------------------------------------
    {key: 'drainage', r: R(30, 72, 12, 41), kind: 'room', type: 'utility', clear: H.room, label: 'Drainage gallery', purpose: 'sewage-room', parent: 'freight'},
    {key: 'sump', r: R(12, 76, 17, 20), kind: 'room', type: 'utility', clear: 4.2, label: 'Flooded sump', purpose: 'overflow-chamber', parent: 'drainage'},
    {key: 'ejector', r: R(12, 97, 17, 14), kind: 'room', type: 'utility', clear: H.room, label: 'Sewage ejector room', purpose: 'sewage-room', parent: 'drainage'},
    {key: 'westWalk', r: R(40, 125, 10, 20), kind: 'room', type: 'utility', clear: H.gallery, label: 'West catwalk', purpose: 'service-corridor', parent: 'gallery', role: 'catwalk', noFloorLoot: true},
  ];
}

function openings(): Opening[] {
  return [
    {a: 'reservoir', b: 'treatment', w: 6, h: 3.0, at: 0.5, jitter: 0.3},
    {a: 'pipeRun', b: 'reservoir', w: 3, h: 2.8, at: 0.5},
    {a: 'pipeRun', b: 'treatment', w: 4, h: 3.0, at: 0.3, jitter: 0.25},
    {a: 'treatment', b: 'chlorine', w: 3, h: 2.6, at: 0.5, jitter: 0.4},
    {a: 'pipeRun', b: 'filtration', w: 4, h: 3.0, at: 0.5, jitter: 0.4},
    {a: 'pipeRun', b: 'boiler', w: 3, h: 2.8, at: 0.5},
    {a: 'boiler', b: 'power', w: 5, h: 3.0, at: 0.5, jitter: 0.5},
    {a: 'pipeRun', b: 'workshop', w: 3, h: 2.8, at: 0.5, jitter: 0.6},
    {a: 'pipeRun', b: 'link', w: 4, h: 2.8, gap: R(66, 36, 4, 1)},
    {a: 'link', b: 'workshop', w: 3, h: 2.6, at: 0.5, jitter: 0.6},
    {a: 'link', b: 'stores', w: 3, h: 2.6, at: 0.5, jitter: 0.6},
    {a: 'freight', b: 'link', w: 4, h: 2.8, gap: R(66, 55, 4, 1)},
    {a: 'freight', b: 'pumpHall', w: 12, h: 3.0, at: 0.5},
    {a: 'freight', b: 'drainage', w: 8, h: 2.8, at: 0.5},
    {a: 'freight', b: 'crew', w: 6, h: 2.8, at: 0.5, jitter: 0.4},
    {a: 'crew', b: 'switch', w: 3, h: 2.6, at: 0.5, jitter: 0.6},
    {a: 'crew', b: 'washroom', w: 3, h: 2.6, at: 0.5, jitter: 0.6},
    {a: 'crew', b: 'passage', w: 5, h: 2.8, gap: R(92, 71, 5, 1)},
    {a: 'pumpHall', b: 'passage', w: 4, h: 2.8, at: 0.5, jitter: 0.5},
    {a: 'pumpHall', b: 'gallery', w: 15, h: 3.0, at: 0.5},
    {a: 'gallery', b: 'passage', w: 5, h: 2.8, at: 0.5},
    {a: 'passage', b: 'feed', w: 5, h: 2.8, gap: R(92, 121, 5, 1)},
    {a: 'drainage', b: 'gallery', w: 8, h: 2.8, at: 0.5},
    {a: 'drainage', b: 'sump', w: 4, h: 2.6, at: 0.5, jitter: 0.5},
    {a: 'drainage', b: 'ejector', w: 3, h: 2.4, at: 0.5, jitter: 0.6},
    {a: 'gallery', b: 'westWalk', w: 6, h: 3.0, at: 0.5},
  ];
}

/** Storey 4: maintenance & water. */
export const FLOOR_4: BunkerFloorModule = {
  level: 4,
  title: 'Level 4 — Maintenance & water: plant halls on one axis (reservoir, treatment, pump hall) over the core gallery',
  carve(ctx: FloorCarveCtx): FloorCarveResult | null {
    const rng = ctx.rng;
    const byKey = new Map<string, Area>();
    const all = specs();
    for (const s of all) {
      const a = ctx.room(s.r, s.kind, s.type, s.clear, -1, {label: s.label, purpose: s.purpose, role: s.role, publicSpace: s.publicSpace ?? false, noFloorLoot: s.noFloorLoot});
      if (!a) return null;
      byKey.set(s.key, a);
    }
    // parents (the dressers' "main door" reads them)
    for (const s of all) if (s.parent) { const a = byKey.get(s.key)!, p = byKey.get(s.parent)!; a.parent = p.id; a.depth = p.depth + 1; }
    for (const o of openings()) {
      const a = byKey.get(o.a)!, b = byKey.get(o.b)!;
      if (o.gap) { ctx.door(o.gap, a, b, o.h); continue; }
      const at = Math.max(0, Math.min(1, (o.at ?? 0.5) + (o.jitter ? rng.range(-o.jitter / 2, o.jitter / 2) : 0)));
      if (!ctx.connect(a, b, o.w, o.h, at)) return null;
    }
    const id = (k: string) => byKey.get(k)!.id;
    const areas: Record<string, number> = {};
    for (const [k, a] of byKey) areas[k] = a.id;
    const gas: {area: number; strength: V2GasClass}[] = [{area: id('chlorine'), strength: 'strong'}, {area: id('ejector'), strength: 'weak'}];
    return {
      areas,
      generator: {area: id('power'), label: 'Auxiliary power room'},
      gas,
      damp: ['reservoir', 'treatment', 'pumpHall', 'power', 'feed', 'drainage', 'sump', 'ejector', 'westWalk'].map(id),
      aged: ['drainage', 'sump', 'ejector'].map(id),
    };
  },
  dress: dressFloor4,
};
