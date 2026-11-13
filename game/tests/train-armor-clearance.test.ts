// Task studio-refinement-batch-20261113-035659-01 (lane ARMOR): the fitted train armour (world/trainArmorLayout.ts) at the car's REAL
// placements (gen/playerTrain.ts playerTrainPlacement) on a corpus of generated levels — every level of the campaign at one seed and
// every Subway archetype — measured, not assumed:
//  - every armour box lies in open bed space (no wall, rock, platform slab or ceiling: Levels.isFree over a 0.1 m sample grid);
//  - no station prop of the level (columns of a two-track bed, signs, benches, ...) overlaps an armour box;
//  - no generated enemy spawn or loose pickup lies inside an armour box (never a hidden / floating item, never a spawn in the blades);
//  - every rescue ladder's foot stand point keeps a player's radius clear of the armour (the climb out of the bed stays usable).
// The station is NOT built here (the layout as generated: the car's own boxes are not in it).
import {describe, expect, it} from 'vitest';
import {LEVELS, LEVEL_IDS} from '../src/levels/registry';
import {generateStation} from '../src/gen/station';
import {ARCHETYPES, type StationLayout} from '../src/gen/stationTypes';
import {levelsOf} from '../src/gen/levels';
import {playerTrainPlacement, trainToWorld, type TrainPlacement} from '../src/gen/playerTrain';
import {trainArmorLayout, type ArmorBox} from '../src/world/trainArmorLayout';

interface Entry { tag: string; make: () => StationLayout }
const CORPUS: Entry[] = [
  ...LEVEL_IDS.map(id => ({tag: `${id} 4242`, make: () => LEVELS[id].generate(LEVELS[id].entry, {levelSeed: 4242})})),
  ...ARCHETYPES.map(arch => ({tag: `subway ${arch} 11`, make: () => generateStation(11, {archetype: arch})})),
];
const PLAYER_R = 0.3;
const L = trainArmorLayout();
/** What the corpus actually measured (the last test: never a vacuous pass). */
const seen = {placed: 0, ladders: 0, props: 0, minLadder: Infinity};

/** A train-local box as a world AABB (exact for the placement's yaw 0 / PI). */
function worldBox(p: TrainPlacement, b: ArmorBox) {
  const a = trainToWorld(p, b.x0, b.y0, b.z0), c = trainToWorld(p, b.x1, b.y1, b.z1);
  return {x0: Math.min(a.x, c.x), x1: Math.max(a.x, c.x), y0: a.y, y1: c.y, z0: Math.min(a.z, c.z), z1: Math.max(a.z, c.z)};
}
const distXZ = (x: number, z: number, b: {x0: number; x1: number; z0: number; z1: number}) =>
  Math.hypot(Math.max(b.x0 - x, 0, x - b.x1), Math.max(b.z0 - z, 0, z - b.z1));

describe('train armour: clearances at the real placements', () => {
  for (const e of CORPUS) {
    it(`${e.tag}: open bed space; no prop, spawn or pickup inside; the rescue ladders' feet clear`, () => {
      const layout = e.make(), p = playerTrainPlacement(layout);
      if (!p) return; // (a level without the car: nothing to fit; the count below keeps the corpus honest)
      seen.placed++;
      const levels = levelsOf(layout), boxes = L.boxes.map(b => worldBox(p, b));
      for (const [i, b] of boxes.entries()) {
        // open space: a 0.1 m grid over the footprint at the bottom, the middle and the top
        for (let x = b.x0 + 0.01; x <= b.x1; x += 0.1) for (let z = b.z0 + 0.01; z <= b.z1; z += 0.1) for (const y of [b.y0 + 0.02, (b.y0 + b.y1) / 2, b.y1 - 0.02]) {
          expect(levels.isFree(x, y, z), `${e.tag}: box ${i} at ${x.toFixed(2)} ${y.toFixed(2)} ${z.toFixed(2)}`).toBe(true);
        }
        for (const q of layout.props) {
          if ((q.level ?? 0) !== p.level || q.y >= b.y1 || q.y + q.h <= b.y0) continue;
          seen.props++;
          const c = Math.abs(Math.cos(q.rot ?? 0)), s = Math.abs(Math.sin(q.rot ?? 0));
          const ex = c * q.hx + s * q.hz, ez = s * q.hx + c * q.hz;
          const overlap = q.x + ex > b.x0 && q.x - ex < b.x1 && q.z + ez > b.z0 && q.z - ez < b.z1;
          expect(overlap, `${e.tag}: box ${i} vs a ${q.kind} at ${q.x.toFixed(2)} ${q.z.toFixed(2)}`).toBe(false);
        }
        for (const s of layout.zombies) {
          if ((s.level ?? 0) !== p.level) continue;
          expect(distXZ(s.x, s.z, b), `${e.tag}: box ${i} vs a spawn`).toBeGreaterThan(0.1);
        }
        for (const q of layout.pickups) {
          if ((q.level ?? 0) !== p.level || q.y > b.y1 + 0.1 || q.y < b.y0 - 1) continue;
          expect(distXZ(q.x, q.z, b), `${e.tag}: box ${i} vs a pickup`).toBeGreaterThan(0.05);
        }
      }
      for (const l of layout.traversal.ladders) {
        if (l.trench !== p.trenchIndex) continue;
        const d = Math.min(...boxes.map(b => distXZ(l.bottom.x, l.bottom.z, b)));
        seen.ladders++;
        seen.minLadder = Math.min(seen.minLadder, d);
        expect(d, `${e.tag}: ladder ${l.id} foot`).toBeGreaterThanOrEqual(PLAYER_R);
      }
    });
  }

  it('the corpus measured something: placements, props beside the car, ladders in its bed', () => {
    expect(seen.placed).toBeGreaterThanOrEqual(CORPUS.length - 2);
    expect(seen.props).toBeGreaterThan(0);
    expect(seen.ladders).toBeGreaterThan(0);
    expect(seen.minLadder).toBeGreaterThanOrEqual(PLAYER_R);
  });
});
