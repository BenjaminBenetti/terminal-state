// Task studio-bunker-rework-20261109-205115-01: THE BUNKER v2 — the lead's PLACEHOLDER floors (scaffolding only). Each floor module
// (gen/bunker/v2/floorN.ts) starts as one of these so the whole level generates end to end while its designer builds the real floor:
// a plain hall over the anchors' aprons, corridors joining the stair / lift anchors, the objective rooms and the owned void. A floor's
// designer REPLACES its file's use of this; nothing here is the shipped character of any storey.

import type {Area, Rect} from '../../stationTypes';
import type {BunkerFloorModule, FloorCarveCtx, FloorCarveResult} from './floorApi';
import {V2, V2_GENERATOR_LEVELS} from './spine';

const R = (x: number, y: number, w: number, h: number): Rect => ({x, y, w, h});

/** A placeholder shelter storey (1..5). */
export function stubShelterFloor(level: number): BunkerFloorModule {
  return {
    level,
    title: `placeholder storey ${level}`,
    carve(ctx: FloorCarveCtx): FloorCarveResult | null {
      const a: Record<string, number> = {};
      const room = (key: string, r: Rect, kind: Area['kind'], type: Area['type'], clear: number, label: string, purpose?: string): Area | null => {
        const ar = ctx.room(r, kind, type, clear, -1, {label, purpose});
        if (ar) a[key] = ar.id;
        return ar;
      };
      const A = ctx.spine.cores[0].rect, B = ctx.spine.cores[1].rect;
      const aEnd = A.y + A.h, bEnd = B.y + B.h; // the cores' south wall rows
      const N = room('north', R(30, 56, 61, 15), 'room', 'crew-room', 4.2, 'North hall');
      const NE = room('northeast', R(92, 56, 21, B.y - 1 - 56), 'room', 'crew-room', 4.2, 'East hall');
      // (beside a well the corridor / hall runs along its rim: the derived railings line it)
      const wx = ctx.frame.well?.id === 'V12' ? 38 : 39;
      const W = room('west', R(wx, 72, 43 - wx, aEnd - 72), 'passage', 'service-corridor', 3.2, 'West corridor');
      const S = room('south', R(30, aEnd + 1, 66, ctx.frame.well?.id === 'V45' ? ctx.frame.well.rect.y - aEnd - 1 : 9), 'room', 'crew-room', 4.2, 'South hall');
      const SE = room('southeast', R(97, bEnd + 1, 18, 10), 'room', 'crew-room', 4.2, 'Southeast hall');
      const E = room('east', R(109, B.y, 4, bEnd - B.y), 'passage', 'service-corridor', 3.2, 'East corridor');
      if (!N || !NE || !W || !S || !SE || !E) return null;
      ctx.door(R(91, 60, 1, 6), N, NE, 3.0);
      ctx.door(R(39, 71, 4, 1), N, W, 3.0);
      ctx.door(R(39, aEnd, 4, 1), S, W, 3.0);
      ctx.door(R(109, B.y - 1, 4, 1), NE, E, 3.0);
      ctx.door(R(109, bEnd, 4, 1), SE, E, 3.0);
      const out: FloorCarveResult = {areas: a, gas: [], damp: [], aged: []};
      const gi = V2_GENERATOR_LEVELS.indexOf(level);
      if (gi >= 0) {
        const plant = room('plant', R(70, 88, 23, aEnd - 88), 'room', 'utility', 6.0, 'Plant room', 'generator-room');
        if (!plant) return null;
        ctx.door(R(78, aEnd, 4, 1), S, plant, 3.0);
        out.generator = {area: plant.id, label: 'Plant room'};
      }
      const own = ctx.frame.owns;
      if (own) {
        const hall = room('void', own.rect, 'room', level === 5 ? 'utility' : 'crew-room', own.ceil - ctx.base, level === 5 ? 'Processing hall' : 'Commons', level === 5 ? 'server-room' : undefined);
        if (!hall) return null;
        if (level === 5) { ctx.door(R(66, own.rect.y - 1, 8, 1), S, hall, 3.0); out.core = {area: hall.id}; }
        else ctx.door(R(38, 88, 1, 4), W, hall, 3.0);
      }
      if (level === 3 || level === 4) {
        const dead = room('deadend', R(14, 58, 15, 12), 'room', 'utility', 3.4, 'Plant store', 'storage');
        if (!dead) return null;
        ctx.door(R(29, 62, 1, 3), N, dead, 2.4);
        out.gas!.push({area: dead.id, strength: level === 3 ? 'strong' : 'medium'});
      }
      if (level === 1) out.gas!.push({area: NE.id, strength: 'weak'});
      if (level === 4) out.damp!.push(...[a.plant, S.id].filter(x => x !== undefined));
      return out;
    },
  };
}

/** The placeholder station storey (0): one arrival hall between the platform and the vault bulkhead, two platform openings. */
export function stubStationFloor(): BunkerFloorModule {
  return {
    level: 0,
    title: 'placeholder station',
    carve(ctx: FloorCarveCtx): FloorCarveResult | null {
      const S = V2.station;
      const hall = ctx.room(R(26, S.arrivalY0, 60, S.bulkheadY - S.arrivalY0), 'concourse', 'concourse', 4.8, -1, {label: 'Arrival hall', publicSpace: true});
      if (!hall) return null;
      const platform = ctx.k.areas.find(q => q.type === 'platform');
      if (!platform) return null;
      const openings: Rect[] = [];
      for (const x of [34, 72]) {
        const gap = R(x, platform.y + platform.h, 6, 1);
        ctx.door(gap, platform, hall, 3.2);
        openings.push(gap);
      }
      return {areas: {hall: hall.id}, openings, gas: [], damp: [], aged: []};
    },
  };
}
