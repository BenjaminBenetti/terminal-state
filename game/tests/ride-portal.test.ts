// Task studio-perf-ao-train-continuity-20261110-022206-01 (lead): the ride portals of the parked car's track (world/ridePortal.ts) on
// generated levels of EVERY level kind in the registry — both ends, both yaws as the levels place them.
import {describe, expect, it} from 'vitest';
import {LEVELS, LEVEL_IDS} from '../src/levels/registry';
import {levelsOf} from '../src/gen/levels';
import {SOLID} from '../src/gen/grid';
import type {StationLayout} from '../src/gen/stationTypes';
import {playerTrainPlacement, type TrainPlacement} from '../src/gen/playerTrain';
import {PLAYER_TRAIN_SPEC as SPEC} from '../src/world/playerTrainSpec';
import {RIDE_BOX, RIDE_PORTAL, boxOverlaps, breachS, gatedEnds, handU, inBox, planeU, portalEndKey, rideEnds, ridePortals, tunnelOfEnd} from '../src/world/ridePortal';
import {RAIL_TOP_ABOVE_BED} from '../src/gen/playerTrain';

const SEEDS = [4242, 8, 93, 20261110, 777123];
const cases: {id: string; seed: number; L: StationLayout; p: TrainPlacement}[] = [];
for (const id of LEVEL_IDS) for (const seed of SEEDS) {
  const L = LEVELS[id].generate('main', {levelSeed: seed});
  const p = playerTrainPlacement(L);
  if (p) cases.push({id, seed, L, p});
}

describe('ride portals: one per bed end of the parked car\'s track, on every level kind', () => {
  it('every level kind of the registry places the car on these seeds', () => {
    expect(cases.length).toBe(LEVEL_IDS.length * SEEDS.length);
    expect(new Set(cases.map(c => c.id))).toEqual(new Set(LEVEL_IDS));
  });

  it('front = the end the cab points at, rear = the other; the plane lies on the track beyond the car, straight ahead / behind', () => {
    for (const {L, p} of cases) {
      const e = rideEnds(p), r = ridePortals(L, p), t = L.trenches[p.trenchIndex];
      expect(e.front).toBe(p.front > 0 ? 'x1' : 'x0');
      expect(r.front.end).toBe(e.front);
      expect(r.rear.end).toBe(e.rear);
      expect(r.front.out).toBe(p.front);
      expect(r.rear.out).toBe(-p.front);
      expect(ridePortals(L, p)).toBe(r); // memoized
      for (const q of [r.front, r.rear]) {
        expect(q.z).toBe(p.z);
        expect(q.railTopY).toBe(p.railTopY);
        expect(q.bedY).toBe(t.floorY);
        expect(q.railTopY - q.bedY).toBeCloseTo(RAIL_TOP_ABOVE_BED, 9);
        expect(q.faceX).toBe(q.end === 'x1' ? t.x1 : t.x0);
        expect((q.x - q.faceX) * q.out).toBeCloseTo(q.sFace, 9);
        // the car's whole body is on the station side of the plane with room to spare
        expect((q.x - p.x) * q.out).toBeGreaterThan(SPEC.length / 2 + 1.5);
        expect(planeU(q, p)).toBeCloseTo(Math.abs(q.x - p.x), 12);
        expect(handU(q, p)).toBeCloseTo(planeU(q, p) + SPEC.length / 2 + RIDE_PORTAL.dark, 9);
      }
    }
  });

  it('a closed end is a gate in its end face; an end a station tunnel continues is a breach at the end of its first straight', () => {
    let gates = 0, breaches = 0;
    for (const {L, p} of cases) {
      const r = ridePortals(L, p), keys = gatedEnds(L, p);
      for (const q of [r.front, r.rear]) {
        const tn = tunnelOfEnd(L, p.trenchIndex, q.end);
        if (!tn) {
          gates++;
          expect(q.kind).toBe('gate');
          expect(q.sFace).toBe(0);
          expect(q.tunnel).toBe(-1);
          expect(keys.has(portalEndKey(q))).toBe(true);
          const t = L.trenches[p.trenchIndex];
          expect(q.face).toEqual({z0: t.z0, z1: t.z1, y0: t.floorY, y1: t.ceil});
          expect(q.dummies.length).toBe(t.tracks.length - 1);
        } else {
          breaches++;
          expect(q.kind).toBe('breach');
          expect(q.tunnel).toBe(tn.id);
          expect(keys.has(portalEndKey(q))).toBe(false);
          expect(q.sFace).toBe(breachS(tn));
          expect(q.sFace).toBeGreaterThanOrEqual(RIDE_PORTAL.breachMin);
          // inside the axis-aligned first straight and before the cap: the tunnel's section there is the plain box
          expect(q.sFace).toBeLessThanOrEqual(tn.firstStraight - RIDE_PORTAL.breachBack + 1e-9);
          expect(q.sFace).toBeLessThanOrEqual(Math.min(tn.length, tn.cap.s) - RIDE_PORTAL.capClear + 1e-9);
          expect(q.face.z1 - q.face.z0).toBeCloseTo(tn.width, 9);
          expect(q.face.y0).toBe(tn.floorY);
          expect(q.face.y1).toBe(tn.ceilY);
          expect(q.dummies).toEqual([]);
        }
      }
      expect(gatedEnds(L, null).size).toBe(0);
    }
    expect(gates).toBeGreaterThan(10);
    expect(breaches).toBeGreaterThan(10);
  });

  it('the ride-box opening fits inside the section the plane closes (under its ceiling, between its walls); gates of one end face never overlap', () => {
    for (const {id, seed, L, p} of cases) {
      const r = ridePortals(L, p);
      for (const q of [r.front, r.rear]) {
        const o = q.opening, f = q.face, tag = `${id} ${seed} ${q.end}`;
        expect(o.z1 - o.z0, tag).toBeCloseTo(2 * RIDE_BOX.half, 9);
        expect(o.y1 - o.y0, tag).toBeCloseTo(RIDE_BOX.ceil, 9);
        expect(o.y0, tag).toBe(q.bedY);
        expect(o.z0, tag).toBeGreaterThanOrEqual(f.z0 - 1e-9);
        expect(o.z1, tag).toBeLessThanOrEqual(f.z1 + 1e-9);
        expect(o.y1, tag).toBeLessThanOrEqual(f.y1 - 0.1); // a lintel above the opening
        // the car (body + roof) passes with clearance
        expect(RIDE_BOX.half - SPEC.width / 2, tag).toBeGreaterThan(0.4);
        expect(q.bedY + RIDE_BOX.ceil - (q.railTopY + SPEC.roofY), tag).toBeGreaterThan(0.4);
        const all = [o, ...q.dummies].sort((a, b) => a.z0 - b.z0);
        for (let i = 1; i < all.length; i++) expect(all[i].z0, tag).toBeGreaterThanOrEqual(all[i - 1].z1 + 0.05);
        for (const d of q.dummies) { expect(d.z0, tag).toBeGreaterThanOrEqual(f.z0 - 1e-9); expect(d.z1, tag).toBeLessThanOrEqual(f.z1 + 1e-9); }
      }
    }
  });

  it('the box: the ride tunnel\'s volume beyond the plane (never the station side), long enough for the hand-over and the sight beyond it', () => {
    for (const {L, p} of cases) {
      const r = ridePortals(L, p);
      for (const q of [r.front, r.rear]) {
        const b = q.box, k = RIDE_PORTAL.skin;
        expect(b.x1 - b.x0).toBeCloseTo(RIDE_PORTAL.cut, 9);
        expect(q.out > 0 ? b.x0 : b.x1).toBeCloseTo(q.x, 9);
        expect(b.z0).toBeCloseTo(q.z - RIDE_BOX.half - k, 9);
        expect(b.z1).toBeCloseTo(q.z + RIDE_BOX.half + k, 9);
        expect(b.y0).toBeCloseTo(q.bedY - k, 9);
        expect(b.y1).toBeCloseTo(q.bedY + RIDE_BOX.ceil + k, 9);
        // the parked car and everything on the station side of the plane is outside
        expect(boxOverlaps(b, p.x0, p.railTopY, p.z - SPEC.width / 2, p.x1, p.railTopY + SPEC.roofY, p.z + SPEC.width / 2)).toBe(false);
        expect(inBox(b, q.x - q.out * 0.5, q.bedY + 1, q.z)).toBe(false);
        expect(inBox(b, q.x + q.out * 0.5, q.bedY + 1, q.z)).toBe(true);
        // the car at the hand-over, and what it can see ahead of it in the murk (48 m), are inside the cleared length
        const nose = handU(q, p) - planeU(q, p) + SPEC.length / 2;
        expect(RIDE_PORTAL.cut).toBeGreaterThan(nose + 48);
      }
    }
  });

  it('a breach\'s straight run stays inside its tunnel\'s walkable first straight (the car never meets a bend or the cap before the plane)', () => {
    for (const {id, seed, L, p} of cases) {
      const r = ridePortals(L, p), lv = levelsOf(L), g = lv.grid(p.level);
      for (const q of [r.front, r.rear]) {
        if (q.kind !== 'breach') continue;
        // every 0.5 m along the track between the bed end face and the plane: open cells across the car's width
        for (let s = 0.25; s < q.sFace; s += 0.5) for (const dz of [-SPEC.width / 2, 0, SPEC.width / 2]) {
          const x = q.faceX + q.out * s, [cx, cy] = g.cellOf(x, q.z + dz);
          expect(g.inBounds(cx, cy) && g.cells[g.idx(cx, cy)] !== SOLID, `${id} ${seed} ${q.end} s ${s} dz ${dz}`).toBe(true);
        }
      }
    }
  });
});
