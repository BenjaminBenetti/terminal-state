// Iteration 17 (seamless Office Space, primary): the level is ONE continuous world. A real Player (the game's own movement,
// collision, stairs and support code on the generated level's Levels) walks from the platform start up the station stair
// into the lobby and then up the scissor stairwell to every office floor — no teleport, no section, no load. The walk is
// steered with the W key along the game's own PathFinder routes (as qaWalk.ts does in the browser).
//
// Proves: one layout holds every storey at its real height; every floor is reachable on foot; the player's height changes
// continuously (no jump bigger than one frame of motion) while crossing every floor boundary; nothing about the world is
// replaced while walking; the tower code has no travel / fade path left (source guard).

import {describe, expect, it} from 'vitest';
import {readFileSync} from 'node:fs';
import {LEVELS} from '../src/levels/registry';
import {levelsOf} from '../src/gen/levels';
import {PathFinder, type Waypoint} from '../src/gen/grid';
import {Player} from '../src/player/player';

const SEED = 0x5ea1e55;
const DT = 1 / 60;

class Keys {
  held = new Set<string>();
  down(c: string) { return this.held.has(c); }
  hit() { return false; }
}

describe('seamless Office Space: one world, walked floor to floor', () => {
  const layout = LEVELS.office.generate('main', {levelSeed: SEED, startWeapon: 'pistol'});
  const office = layout.office!;
  const L = levelsOf(layout);

  it('holds the station, the lobby and floors 2-8 in ONE layout at their real, contiguous heights', () => {
    expect(layout.levels.map(l => l.id)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(office.storeys.map(s => [s.floor, s.levelId])).toEqual([1, 2, 3, 4, 5, 6, 7, 8].map(f => [f, f]));
    const lobby = layout.levels[1].baseY;
    expect(lobby).toBeGreaterThan(5);
    for (let f = 2; f <= 8; f++) expect(layout.levels[f].baseY).toBeCloseTo(lobby + office.floorHeight * (f - 1), 3);
    expect(office.groundY).toBeCloseTo(lobby, 3);
    // one stair run between every pair of consecutive tower storeys, each a LevelLink
    const runs = office.stairs.runs.map(r => [r.lower, r.upper]);
    expect(runs).toEqual([[1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 8]]);
    for (const r of office.stairs.runs) expect(layout.levelLinks[r.link]).toMatchObject({kind: 'stairs', lower: r.lower, upper: r.upper});
    // the elevator serves every floor from one shaft
    expect(office.elevator.stops.map(s => s.floor)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('a real Player walks (W key) from the platform to floor 8 by stairs; y changes continuously across every floor boundary', () => {
    const pf = new PathFinder(L);
    const p = new Player();
    const start = office.start;
    p.spawn(start.x, start.z, start.yaw, L.grid(start.level).floorAt(start.x, start.z));
    const keys = new Keys();
    let maxDy = 0, steps = 0, minVy = 0;
    const visited = new Set<number>();
    const goals = office.stairs.landings.slice().sort((a, b) => a.floor - b.floor);
    expect(goals.map(g => g.floor)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    for (const goal of goals) {
      const gy = layout.levels[goal.levelId].baseY;
      const path: Waypoint[] | null = pf.find(p.x, p.z, goal.x, goal.z, 0.3, 400000, {ay: p.y, by: gy});
      expect(path, `route to floor ${goal.floor}`).not.toBeNull();
      let i = 0;
      const cap = steps + 60 * 120;
      while (i < path!.length && steps < cap) {
        const [wx, wz, , wy] = path![i];
        if (Math.hypot(wx - p.x, wz - p.z) < 0.35 && (wy === undefined || Math.abs(wy - p.y) < 0.9)) { i++; continue; }
        p.yaw = Math.atan2(-(wx - p.x), -(wz - p.z));
        keys.held.add('KeyW');
        const y0 = p.y;
        p.update(DT, keys, L, null, {aiming: false, speedMult: 1, canSprint: false});
        maxDy = Math.max(maxDy, Math.abs(p.y - y0));
        minVy = Math.min(minVy, p.vy);
        visited.add(L.levelAt(p.x, p.z, p.y + 0.05));
        steps++;
      }
      keys.held.clear();
      expect(i, `reached floor ${goal.floor} (${steps} steps)`).toBe(path!.length);
      expect(p.y).toBeCloseTo(gy, 1);
      expect(L.levelAt(p.x, p.z, p.y + 0.05)).toBe(goal.levelId);
    }
    expect([...visited].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(p.y).toBeGreaterThan(30); // floor 8 at its real height
    expect(maxDy).toBeLessThan(0.12); // stairs: no snap / teleport between storeys, one frame of motion at most
    expect(minVy).toBeGreaterThan(-3); // never fell (no void / missing slab on the way up)
    expect(p.alive).toBe(true);
  });

  it('generation is deterministic and is the only build of the level (one layout object for every storey)', () => {
    const again = LEVELS.office.generate('main', {levelSeed: SEED, startWeapon: 'pistol'});
    expect(again.zombies).toEqual(layout.zombies);
    expect(again.pickups).toEqual(layout.pickups);
    expect(again.props.length).toBe(layout.props.length);
    // enemies live on every storey of the one world (whole-level population)
    const per = new Map<number, number>();
    for (const z of layout.zombies) per.set(z.level ?? 0, (per.get(z.level ?? 0) ?? 0) + 1);
    for (let f = 2; f <= 8; f++) expect(per.get(f) ?? 0, `enemies on floor ${f}`).toBeGreaterThan(0);
  });

  it('source guard: no tower / office code path travels, fades or rebuilds a section', () => {
    const files = ['world/towerRuntime.ts', 'world/elevator.ts', 'world/towerShared.ts', 'world/towerQa.ts', 'gen/office/index.ts'];
    for (const f of files) {
      let src = '';
      try { src = readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8'); } catch { continue; }
      const code = src.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
      expect(code, f).not.toMatch(/\.travel\(|TowerFade|via:\s*'local'|sectionForFloor|'travelling'/);
    }
  });
});
