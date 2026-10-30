// Task office-overhaul-20261030 (lane STRUCT): feedback items 10 (the roof via a real access ladder) and 11 (a believable,
// high-capacity station <-> lobby connection: a broad stair flanked by two escalators) on the REAL generated Office Space level.
//
// A real Player (the game's own movement / collision / stairs / climbing code on the level's Levels, steered with the W key)
// walks from the ticket hall up the transit hall into the lobby by the fixed stair AND by each (stopped) escalator, and back down;
// the glass balustrades stop a sideways walk; from floor 8 it climbs the roof access ladder (the same scripted climb and controls
// as the rescue ladders) onto the roof deck, walks into the parapet on every side without ever leaving the deck, and climbs back
// down — never falling, y continuous. The AI path graph never uses the ladder (no nav link, no cross link) while player
// reachability does; raycasts see open sky above the roof and above the parapet; determinism; transit widths / mouths; the
// builder's roof / escalator geometry and the open-sky ceiling / parapet rules.

import {beforeAll, describe, expect, it} from 'vitest';
import * as THREE from 'three';
import {LEVELS} from '../src/levels/registry';
import {levelsOf, type Levels} from '../src/gen/levels';
import {CELL, FLOOR, PathFinder, SOLID} from '../src/gen/grid';
import {levelDistance} from '../src/gen/levelGen';
import {ladderTarget, type Ladder, type StairFlight} from '../src/gen/traversal';
import {Player, STAND_EYE} from '../src/player/player';
import {officeIssues} from '../src/gen/office/validate';
import {MARGIN, OFFICE_ROOF_LEVEL, OFFICE_TOP_FLOOR, ROOF, towerFrame} from '../src/gen/office/frame';
import {roofLadderPose} from '../src/gen/office/roof';
import {TRANSIT_MIN, transitIssues, transitPose} from '../src/gen/office/transit';
import type {StationLayout} from '../src/gen/stationTypes';
import {LevelColumns, ceilingRuns, extractWallFaces, stationLevels} from '../src/world/levelGeometry';
import {LevelCuller} from '../src/world/levelCulling';
import {buildTraversal, type QuadSink} from '../src/world/traversalBuilder';
import {WorldMaterials} from '../src/world/materials';
import {installCanvasShim} from './helpers/canvas2d';
import {fakeEnvTextures} from './helpers/openablesFixture';

const SEEDS = [0x5ea1e55, 222];
const DT = 1 / 60;
const cache = new Map<number, StationLayout>();
const gen = (seed: number): StationLayout => {
  if (!cache.has(seed)) cache.set(seed, LEVELS.office.generate('main', {levelSeed: seed, startWeapon: 'pistol'}));
  return cache.get(seed)!;
};

class Keys {
  held = new Set<string>();
  down(c: string) { return this.held.has(c); }
  hit() { return false; }
}
const OPTS = {aiming: false, speedMult: 1, canSprint: false};

/** Steps the player toward (tx, tz) with W until within `tol` (or `cap` steps); returns per-step stats. */
function walkTo(p: Player, L: Levels, tx: number, tz: number, cap: number, tol = 0.3) {
  const keys = new Keys();
  keys.held.add('KeyW');
  let maxDy = 0, minVy = 0, steps = 0;
  const visited = new Set<number>();
  while (steps < cap && Math.hypot(tx - p.x, tz - p.z) > tol) {
    p.yaw = Math.atan2(-(tx - p.x), -(tz - p.z));
    const y0 = p.y;
    p.update(DT, keys, L, null, OPTS);
    maxDy = Math.max(maxDy, Math.abs(p.y - y0));
    minVy = Math.min(minVy, p.vy);
    visited.add(L.levelAt(p.x, p.z, p.y + 0.05));
    steps++;
  }
  return {maxDy, minVy, steps, visited, reached: Math.hypot(tx - p.x, tz - p.z) <= tol};
}

/** Holds a key set for `n` steps at a fixed yaw (strafing / pushing against something). */
function hold(p: Player, L: Levels, codes: string[], n: number) {
  const keys = new Keys();
  for (const c of codes) keys.held.add(c);
  let minVy = 0, maxDy = 0;
  for (let i = 0; i < n; i++) { const y0 = p.y; p.update(DT, keys, L, null, OPTS); minVy = Math.min(minVy, p.vy); maxDy = Math.max(maxDy, Math.abs(p.y - y0)); }
  return {minVy, maxDy};
}

/** Runs a started climb to its end; returns per-step stats. */
function climb(p: Player, L: Levels, cap = 60 * 20) {
  const keys = new Keys();
  let maxDy = 0, steps = 0, minY = Infinity;
  while (p.climbing && steps < cap) { const y0 = p.y; p.update(DT, keys, L, null, OPTS); maxDy = Math.max(maxDy, Math.abs(p.y - y0)); minY = Math.min(minY, p.y); steps++; }
  return {maxDy, steps, minY};
}

const lookDir = (yaw: number, pitch: number) => ({x: -Math.sin(yaw) * Math.cos(pitch), y: Math.sin(pitch), z: -Math.cos(yaw) * Math.cos(pitch)});

describe('transit hall (item 11): broad fixed stair + two stopped escalators between the station and the lobby', () => {
  it('validates; widths, mouths, one shared pitch, link 0 is the fixed stair; the old narrow core is gone', () => {
    for (const seed of SEEDS) {
      const l = gen(seed), t = l.office!.transit!;
      expect(officeIssues(l, towerFrame(seed))).toEqual([]);
      expect(transitIssues(l)).toEqual([]);
      expect(t.escalators.length).toBe(2);
      expect(t.stairLinks.length).toBe(1);
      expect(l.levelLinks[0]).toMatchObject({kind: 'stairs', lower: 0, upper: 1});
      expect(t.stairLinks[0]).toBe(0);
      const stair = l.traversal.stairs[l.levelLinks[0].traversalId!];
      expect(stair.spec).toBe('transit');
      expect(stair.a1 - stair.a0).toBeGreaterThanOrEqual(TRANSIT_MIN.stair);
      for (const e of t.escalators) {
        expect(e.width).toBeGreaterThanOrEqual(1.0);
        expect(e.width).toBeLessThanOrEqual(1.2);
        const q = l.traversal.stairs[e.flights[0]];
        expect(q.spec).toBe('escalator');
        expect(q.risers).toBeGreaterThan(20); // one continuous flight: an escalator has no landings
        expect(e.upper.y).toBeCloseTo(l.levels[1].baseY, 3);
        expect(e.lower.y).toBeCloseTo(0, 3);
        expect(e.yaw).toBeCloseTo(0, 3); // rises north into the tower
      }
      // the lanes side by side: 1.5 m | >= 4.5 m | 1.5 m, total >= 7.5 m wide; the ticket-hall mouth spans them all
      const lanes = [l.traversal.stairs[t.escalators[0].flights[0]], stair, l.traversal.stairs[t.escalators[1].flights[0]]].sort((a, b) => a.a0 - b.a0);
      for (let i = 1; i < 3; i++) expect(lanes[i].a0).toBeCloseTo(lanes[i - 1].a1, 6);
      const width = lanes[2].a1 - lanes[0].a0;
      expect(width).toBeGreaterThanOrEqual(7.5);
      const run = l.areas[stair.area];
      const mouth = l.doors.find(d => (d.a === run.id || d.b === run.id) && !d.level)!;
      expect(mouth.w * CELL).toBeCloseTo(width, 6);
      expect(l.areas[t.lowerHall].type).toBe('fare-hall');
      expect(l.areas[t.upperHall].level).toBe(1);
      expect(l.areas.some(a => a.label === 'Stairs · Office tower' || a.label === 'Stairs · To the trains')).toBe(false);
      // fare-line logic: the tower connection is on the unpaid side (the ticket hall), the fare line between it and the paid hall
      expect(l.doors.some(d => d.fare && (d.a === t.lowerHall || d.b === t.lowerHall))).toBe(true);
      // lobby security gate line: pedestals with open lanes
      expect(l.props.filter(p => p.kind === 'securityTurnstile' && p.level === 1).length).toBeGreaterThanOrEqual(3);
      // signage at both mouths
      expect(l.signs.some(s => s.text.startsWith('TO TRAINS') && s.level === 1)).toBe(true);
      expect(l.signs.some(s => s.text.startsWith('OFFICE TOWER') && !s.level)).toBe(true);
      // QA poses (browser spot check): both on open floor of their storey, clear for a standing body
      for (const [end, lane] of [['bottom', 0], ['bottom', 1], ['bottom', 2], ['top', 1]] as const) {
        const q = transitPose(l, end, lane)!;
        const g = l.levels[q.level].grid;
        expect(g.circleClearH(q.x, q.z, 0.3, q.y), `transit pose ${end} ${lane}`).toBe(true);
        expect(levelsOf(l).levelAt(q.x, q.z, q.y + 0.05)).toBe(q.level);
      }
    }
  });

  it('a REAL Player walks up the fixed stair and EACH escalator from the ticket hall into the lobby (and down again): continuous y, never falls', () => {
    const l = gen(SEEDS[0]), L = levelsOf(l), t = l.office!.transit!;
    const hu = l.levels[1].baseY;
    const stair = l.traversal.stairs[l.levelLinks[t.stairLinks[0]].traversalId!];
    const lanes: [string, StairFlight, number][] = [
      ['fixed stair', stair, stair.a0 + (stair.a1 - stair.a0) * 0.25], // beside the centre handrail
      ...t.escalators.map((e, i) => { const q = l.traversal.stairs[e.flights[0]]; return [`escalator ${i}`, q, (q.a0 + q.a1) / 2] as [string, StairFlight, number]; }),
    ];
    for (const [name, q, x] of lanes) {
      const zBottom = Math.max(q.s0, q.s1), zTop = Math.min(q.s0, q.s1);
      const p = new Player();
      p.spawn(x, zBottom + 2.0, 0, 0);
      expect(L.levelAt(p.x, p.z, p.y + 0.05), `${name} start`).toBe(0);
      // up: through the mouth, up the flight, over the top landing onto the transit concourse
      const up = walkTo(p, L, x, zTop - 3.0, 60 * 20, 0.25);
      expect(up.reached, `${name} up`).toBe(true);
      expect(p.y, `${name} lobby height`).toBeCloseTo(hu, 2);
      expect(L.levelAt(p.x, p.z, p.y + 0.05)).toBe(1);
      expect(up.visited.has(0) && up.visited.has(1)).toBe(true);
      expect(up.maxDy, `${name} continuous`).toBeLessThan(0.12);
      expect(up.minVy, `${name} never fell`).toBeGreaterThan(-1);
      expect(Math.abs(p.x - x), `${name} kept its lane`).toBeLessThan(0.4);
      // down again
      const down = walkTo(p, L, x, zBottom + 2.0, 60 * 20, 0.25);
      expect(down.reached, `${name} down`).toBe(true);
      expect(p.y).toBeCloseTo(0, 2);
      expect(down.maxDy).toBeLessThan(0.12);
      expect(down.minVy).toBeGreaterThan(-1);
    }
  });

  it('the glass balustrades stop a sideways walk off the stair onto an escalator (and the AI never paths across them)', () => {
    const l = gen(SEEDS[0]), L = levelsOf(l), t = l.office!.transit!;
    const stair = l.traversal.stairs[l.levelLinks[t.stairLinks[0]].traversalId!];
    const zMid = (stair.s0 + stair.s1) / 2;
    for (const [code, edge, sign] of [['KeyA', stair.a0, -1], ['KeyD', stair.a1, 1]] as const) {
      const p = new Player();
      const x = (stair.a0 + stair.a1) / 2 + sign * 0.6; // beside the centre handrail, on the side of `edge`
      const pitch = stair.h0 + (stair.h1 - stair.h0) * (zMid - stair.s0) / (stair.s1 - stair.s0);
      p.spawn(x, zMid, 0, L.supportAt(x, zMid, pitch + 0.1)!.floor);
      expect(p.y).toBeCloseTo(pitch, 1);
      const r = hold(p, L, [code], 60 * 4);
      // facing north (yaw 0): A strafes west (-x), D east (+x); the balustrade line is the lane edge
      expect(sign * (p.x - edge), `stopped at the ${code === 'KeyA' ? 'west' : 'east'} balustrade`).toBeLessThan(-0.2);
      expect(r.minVy).toBeGreaterThan(-1);
    }
    // AI: every railing edge of the balustrades is closed for the path graph
    const blocked = L.blockedEdges();
    const g0 = l.levels[0].grid, [, cy] = g0.cellOf(stair.a0 - 0.1, zMid);
    const line = Math.round(stair.a0 / CELL);
    expect(blocked.some(e => e.level === 0 && (e.a === g0.idx(line - 1, cy) && e.b === g0.idx(line, cy) || e.b === g0.idx(line - 1, cy) && e.a === g0.idx(line, cy)))).toBe(true);
  });

  it('the AI path graph routes station <-> lobby through the transit run (any lane)', () => {
    const l = gen(SEEDS[0]), L = levelsOf(l), t = l.office!.transit!;
    const pf = new PathFinder(L);
    const T = l.areas[t.lowerHall], U = l.areas[t.upperHall];
    const a = {x: (T.x + T.w / 2) * CELL, z: (T.y + T.h / 2) * CELL}, b = {x: (U.x + U.w / 2) * CELL, z: (U.y + U.h / 2) * CELL};
    const path = pf.find(a.x, a.z, b.x, b.z, 0.34, 26000, {ay: 0, by: l.levels[1].baseY});
    expect(path, `ticket hall -> lobby (${pf.lastExpanded} expansions)`).not.toBeNull();
  });
});

describe('the roof (item 10): reached by a real access ladder from floor 8', () => {
  it('the storey: level 9, role roof, open sky, one storey above floor 8; not an elevator stop; parapet, hatch, plant, daylight', () => {
    for (const seed of SEEDS) {
      const l = gen(seed), f = towerFrame(seed), roof = l.office!.roof!;
      const R = l.levels[OFFICE_ROOF_LEVEL];
      expect(l.levels.length).toBe(10);
      expect(R.role).toBe('roof');
      expect(R.baseY).toBeCloseTo(l.levels[OFFICE_TOP_FLOOR].baseY + 4.4, 6);
      expect(R.sky).toBeDefined();
      expect(roof.level).toBe(OFFICE_ROOF_LEVEL);
      expect(roof.parapet).toBe(ROOF.parapet);
      expect(l.office!.elevator.stops.map(s => s.floor)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
      expect(l.office!.storeys.some(s => s.levelId === OFFICE_ROOF_LEVEL)).toBe(false);
      // the deck covers the tower interior (minus the elevator overrun and the hatch); the wall ring and beyond are solid
      const g = R.grid;
      for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
        const interior = x >= MARGIN && x < MARGIN + f.TW && y >= MARGIN && y < MARGIN + f.TD;
        if (!interior) expect(g.cells[g.idx(x, y)]).toBe(SOLID);
      }
      const kinds = new Set(l.props.filter(p => p.level === OFFICE_ROOF_LEVEL).map(p => p.kind));
      expect(kinds.has('roofHvac')).toBe(true);
      expect(kinds.has('satelliteDish') || kinds.has('waterTower')).toBe(true);
      for (const p of l.props.filter(q => q.level === OFFICE_ROOF_LEVEL)) expect(p.y).toBeGreaterThanOrEqual(R.baseY - 1e-6);
      expect(l.lights.filter(x => x.level === OFFICE_ROOF_LEVEL).every(x => x.virtual)).toBe(true);
      expect(l.lights.some(x => x.level === OFFICE_ROOF_LEVEL)).toBe(true);
      expect(l.zombies.filter(z => z.level === OFFICE_ROOF_LEVEL).length).toBeLessThanOrEqual(2);
      expect(roof.structures.some(s => s.kind === 'hatch')).toBe(true);
      expect(roof.structures.some(s => s.kind === 'overrun')).toBe(true);
      // the floor-8 roof access closet holds the ladder foot
      const lad = l.traversal.ladders.find(q => q.kind === 'roof')!;
      const g8 = l.levels[OFFICE_TOP_FLOOR].grid;
      expect(l.areas[g8.area[g8.idx(...g8.cellOf(lad.bottom.x, lad.bottom.z))]].label).toContain('Roof access'); // (tenant prefix)
      expect(l.areas[g.area[g.idx(...g.cellOf(lad.top.x, lad.top.z))]].label).toBe('Roof');
      expect(l.signs.some(s => s.text === 'ROOF ACCESS' && s.level === OFFICE_TOP_FLOOR)).toBe(true);
    }
  });

  it('a REAL Player climbs the ladder from floor 8 onto the roof (continuous, no teleport), walks into the parapet on every side, climbs back down', () => {
    const l = gen(SEEDS[0]), L = levelsOf(l), f = towerFrame(SEEDS[0]);
    const lad = l.traversal.ladders.find(q => q.kind === 'roof')!;
    const base8 = l.levels[OFFICE_TOP_FLOOR].baseY, base9 = l.levels[OFFICE_ROOF_LEVEL].baseY;
    const pose = roofLadderPose(l, 'bottom')!;
    expect(pose.level).toBe(OFFICE_TOP_FLOOR);
    const p = new Player();
    p.spawn(pose.x, pose.z, pose.yaw, pose.y);
    p.pitch = pose.pitch;
    expect(L.levelAt(p.x, p.z, p.y + 0.05)).toBe(OFFICE_TOP_FLOOR);
    // the game's ladder targeting picks the roof ladder (climb up) from the closet
    const aim = ladderTarget(l.traversal.ladders, {x: p.x, y: p.y + STAND_EYE, z: p.z}, lookDir(p.yaw, p.pitch), p.y);
    expect(aim?.ladder).toBe(lad);
    expect(aim?.up).toBe(true);
    p.startClimb(aim!.ladder, true);
    const up = climb(p, L);
    expect(p.climbing).toBe(false);
    expect(p.justClimbed || p.grounded).toBe(true);
    expect(p.y).toBeCloseTo(base9, 2);
    expect(L.levelAt(p.x, p.z, p.y + 0.05)).toBe(OFFICE_ROOF_LEVEL);
    expect(l.areas[L.areaAt(p.x, p.z, p.y + 0.05)].label).toBe('Roof'); // the HUD's area line: "Roof · <tower>"
    expect(up.maxDy).toBeLessThan(0.12);
    expect(up.minY).toBeGreaterThanOrEqual(base8 - 1e-4);
    expect(up.steps * DT).toBeGreaterThan(3); // a real 4.4 m climb, not a teleport
    // walk to each side of the roof and push into the parapet: never off the deck, never falling
    const x0 = MARGIN * CELL, x1 = (MARGIN + f.TW) * CELL, z0 = MARGIN * CELL, z1 = (MARGIN + f.TD) * CELL;
    const targets = [[x0 - 3, (z0 + z1) / 2], [x1 + 3, (z0 + z1) / 2], [(x0 + x1) / 2, z0 - 3], [(x0 + x1) / 2, z1 + 3]];
    const pf = new PathFinder(L);
    for (const [tx, tz] of targets) {
      // route to the deck cell nearest the parapet on that side first (props / plant stand in the way)
      const cx = Math.min(x1 - 0.4, Math.max(x0 + 0.4, tx)), cz = Math.min(z1 - 0.4, Math.max(z0 + 0.4, tz));
      const path = pf.find(p.x, p.z, cx, cz, 0.3, 60000, {ay: p.y, by: base9});
      if (path) for (const [wx, wz] of path) walkTo(p, L, wx, wz, 60 * 10, 0.35);
      const r = walkTo(p, L, tx, tz, 60 * 3, 0.1);
      expect(r.reached).toBe(false);
      expect(p.x).toBeGreaterThan(x0 - 1e-6); expect(p.x).toBeLessThan(x1 + 1e-6);
      expect(p.z).toBeGreaterThan(z0 - 1e-6); expect(p.z).toBeLessThan(z1 + 1e-6);
      expect(p.y).toBeCloseTo(base9, 3);
      expect(r.minVy).toBeGreaterThan(-1);
      expect(r.maxDy).toBeLessThan(0.12);
      // jumping at the parapet does not get you over it either
      const k = new Keys(); k.held.add('KeyW');
      for (let i = 0; i < 90; i++) { (k as unknown as {hit: (c: string) => boolean}).hit = c => c === 'Space' && i % 30 === 0; p.update(DT, k, L, null, OPTS); }
      expect(p.x > x0 - 1e-6 && p.x < x1 + 1e-6 && p.z > z0 - 1e-6 && p.z < z1 + 1e-6).toBe(true);
      expect(p.y).toBeGreaterThanOrEqual(base9 - 1e-4);
    }
    // back to the hatch and down the ladder
    const top = roofLadderPose(l, 'top')!;
    const back = pf.find(p.x, p.z, top.x, top.z, 0.3, 60000, {ay: p.y, by: base9});
    expect(back).not.toBeNull();
    for (const [wx, wz] of back!) walkTo(p, L, wx, wz, 60 * 10, 0.35);
    walkTo(p, L, top.x, top.z, 60 * 3, 0.1);
    p.yaw = top.yaw; p.pitch = top.pitch;
    const aimDown = ladderTarget(l.traversal.ladders, {x: p.x, y: p.y + STAND_EYE, z: p.z}, lookDir(p.yaw, p.pitch), p.y);
    expect(aimDown?.ladder).toBe(lad);
    expect(aimDown?.up).toBe(false);
    p.startClimb(lad, false);
    const down = climb(p, L);
    expect(p.y).toBeCloseTo(base8, 2);
    expect(L.levelAt(p.x, p.z, p.y + 0.05)).toBe(OFFICE_TOP_FLOOR);
    expect(down.maxDy).toBeLessThan(0.12);
    // letting go half way drops you onto floor 8 (the hatch shaft is the closet's), never below it
    p.startClimb(lad, true);
    for (let i = 0; i < 150; i++) p.update(DT, new Keys(), L, null, OPTS);
    expect(p.climbing).toBe(true);
    p.letGo();
    let minY = Infinity;
    for (let i = 0; i < 120; i++) { p.update(DT, new Keys(), L, null, OPTS); minY = Math.min(minY, p.y); }
    expect(p.grounded).toBe(true);
    expect(p.y).toBeCloseTo(base8, 2);
    expect(minY).toBeGreaterThanOrEqual(base8 - 1e-4);
  });

  it('enemies never use the ladder: no nav link, no cross link, no AI route between floor 8 and the roof; player reachability follows it', () => {
    for (const seed of SEEDS) {
      const l = gen(seed), L = levelsOf(l);
      const lad = l.traversal.ladders.find(q => q.kind === 'roof')!;
      expect(lad.link).toBe(-1);
      const link = l.levelLinks.find(k => k.kind === 'ladder')!;
      expect(link).toMatchObject({lower: OFFICE_TOP_FLOOR, upper: OFFICE_ROOF_LEVEL});
      expect(link.traversalId).toBeUndefined();
      expect(L.crossLinks().some(c => c.la === OFFICE_ROOF_LEVEL || c.lb === OFFICE_ROOF_LEVEL)).toBe(false);
      for (const lv of l.levels) expect(lv.grid.links.every(k => k.pa.y < l.levels[OFFICE_TOP_FLOOR].baseY - 1)).toBe(true);
      const pf = new PathFinder(L);
      const a = lad.bottom, b = lad.top;
      expect(pf.find(a.x, a.z, b.x + 2, b.z - 1.5, 0.34, 26000, {ay: a.y, by: b.y})).toBeNull();
      expect(pf.find(b.x + 2, b.z - 1.5, a.x, a.z, 0.34, 26000, {ay: b.y, by: a.y})).toBeNull();
      // reachability for the player: the roof only through the ladder link
      const g0 = l.grid, [sx, sy] = g0.cellOf(l.playerSpawn.x, l.playerSpawn.z);
      const g9 = l.levels[OFFICE_ROOF_LEVEL].grid, [tx, ty] = g9.cellOf(b.x, b.z);
      expect(levelDistance(l.levels, sx, sy, 0)[OFFICE_ROOF_LEVEL][g9.idx(tx, ty)]).toBe(-1);
      expect(levelDistance(l.levels, sx, sy, 0, l.levelLinks)[OFFICE_ROOF_LEVEL][g9.idx(tx, ty)]).toBeGreaterThan(0);
    }
  });

  it('raycasts / sight see open sky above the roof and over the parapet; the parapet and the overrun still stop low shots', () => {
    const l = gen(SEEDS[0]), L = levelsOf(l), f = towerFrame(SEEDS[0]);
    const base = l.levels[OFFICE_ROOF_LEVEL].baseY;
    const lad = l.traversal.ladders.find(q => q.kind === 'roof')!;
    const eye = {x: lad.top.x, y: base + 1.62, z: lad.top.z - 1.0};
    expect(L.raycast(eye, {x: 0, y: 1, z: 0}, 80).kind).toBe('none');
    const x0 = MARGIN * CELL, z0 = MARGIN * CELL;
    // horizontal over the parapet (1.1 m) toward the north facade, and toward the west facade
    expect(L.raycast(eye, {x: 0, y: 0, z: -1}, 200).kind).toBe('none');
    const low = {x: eye.x, y: base + 0.6, z: eye.z};
    const hitLow = L.raycast(low, {x: 0, y: 0, z: -1}, 200);
    expect(hitLow.kind === 'wall' || hitLow.kind === 'prop').toBe(true);
    if (hitLow.kind === 'wall') expect(low.z - hitLow.t).toBeGreaterThan(z0 - CELL - 1e-6);
    void x0;
    // the overrun: a shot at 2 m into it hits, one at 3.5 m flies over it
    const sh = l.office!.elevator.shaft, cz = (sh.z0 + sh.z1) / 2;
    const from = (y: number) => ({x: sh.x1 + 3, y: base + y, z: cz});
    const lowHit = L.raycast(from(2.0), {x: -1, y: 0, z: 0}, 20);
    expect(['wall', 'prop']).toContain(lowHit.kind);
    expect(L.lineOfSight(from(3.5), {x: sh.x0 - 3, y: base + 3.5, z: cz})).toBe(true);
    // floor 8 is still a closed storey: a ray up from an office hits its ceiling
    const g8 = l.levels[OFFICE_TOP_FLOOR].grid;
    let oc = -1;
    for (let i = g8.w * MARGIN; i < g8.cells.length && oc < 0; i++) if (g8.cells[i] === FLOOR && g8.ceil[i] - g8.floor[i] < 3.2 && g8.rampIdx[i] < 0) oc = i;
    const ox = (oc % g8.w + 0.5) * CELL, oz = (Math.floor(oc / g8.w) + 0.5) * CELL;
    expect(L.raycast({x: ox, y: g8.floor[oc] + 1.6, z: oz}, {x: 0, y: 1, z: 0}, 20).kind).toBe('ceiling');
    void f;
  });

  it('determinism: the roof and the transit hall are identical for the same seed', () => {
    const a = gen(SEEDS[1]);
    const b = LEVELS.office.generate('main', {levelSeed: SEEDS[1], startWeapon: 'pistol'});
    expect(b.office!.roof).toEqual(a.office!.roof);
    expect(b.office!.transit).toEqual(a.office!.transit);
    expect(b.traversal.ladders).toEqual(a.traversal.ladders);
    expect(b.zombies).toEqual(a.zombies);
    expect(b.rails.length).toBe(a.rails.length);
  });
});

describe('render: open-sky roof, escalator / ladder / roof geometry, portals', () => {
  let mats: WorldMaterials;
  beforeAll(() => { installCanvasShim(false); mats = new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17}); });

  it('no ceiling over the roof or the hatch; roof walls stop at the parapet / overrun top; geometry tagged with its storeys; portals 0-1 and 8-9', () => {
    const l = gen(SEEDS[0]), lv = stationLevels(l), cols = new LevelColumns(lv);
    const sky = lv[OFFICE_ROOF_LEVEL].sky!;
    expect(ceilingRuns(lv, cols).filter(r => r.level === OFFICE_ROOF_LEVEL || r.y >= sky.ceil - 0.01)).toEqual([]);
    const faces = extractWallFaces(l, lv, cols, {tileLowerHeight: 1.2});
    const roofFaces = faces.filter(f => f.level === OFFICE_ROOF_LEVEL);
    expect(roofFaces.length).toBeGreaterThan(4);
    expect(Math.max(...roofFaces.map(f => f.y1))).toBeLessThanOrEqual(sky.y + ROOF.overrun + 1e-6);
    expect(roofFaces.some(f => Math.abs(f.y1 - sky.top) < 1e-6)).toBe(true); // the parapet's inner face
    expect(faces.every(f => f.y1 <= sky.ceil - 0.5)).toBe(true); // nothing rises into the sky
    // traversal geometry: escalators / stair rails tagged with the station + lobby, the ladder with floor 8 + roof, roof fixtures
    const group = new THREE.Group();
    const sink: QuadSink = {quad() {}};
    buildTraversal(group, l, mats, () => sink, {levels: lv, cols});
    const names = group.children.map(c => c.name);
    for (const n of ['transit-steps', 'transit-glass', 'transit-black', 'transit-stainless', 'roof-ladder-steel', 'roof-concrete']) expect(names, n).toContain(n);
    const tagged = (n: string) => group.children.find(c => c.name === n)!.userData;
    expect(tagged('transit-steps').levels).toEqual([0, 1]);
    expect(tagged('roof-ladder-steel').levels).toEqual([OFFICE_TOP_FLOOR, OFFICE_ROOF_LEVEL]);
    expect(tagged('roof-concrete').level).toBe(OFFICE_ROOF_LEVEL);
    let tris = 0;
    group.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) tris += (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3; });
    expect(tris).toBeLessThan(60000);
    // escalator treads face up (horizontal step faces are never upside down; risers are vertical, both faces)
    const steps = group.children.find(c => c.name === 'transit-steps') as THREE.Mesh;
    const nrm = steps.geometry.attributes.normal;
    let upN = 0, downN = 0;
    for (let i = 0; i < nrm.count; i++) { const y = nrm.getY(i); if (y > 0.9) upN++; else if (y < -0.9) downN++; }
    expect(upN).toBeGreaterThan(0);
    expect(downN).toBe(0);
    // the escalator steps sit on the shared pitch line (between the lobby and the station floors)
    steps.geometry.computeBoundingBox();
    expect(steps.geometry.boundingBox!.min.y).toBeGreaterThan(-0.01);
    expect(steps.geometry.boundingBox!.max.y).toBeLessThan(l.levels[1].baseY + 0.05);
    // portal tiles: the transit box joins station and lobby, the hatch column joins floor 8 and the roof
    const cu = new LevelCuller(lv, cols, () => 0) as unknown as {tiles: {a: number; b: number}[]};
    expect(cu.tiles.some(t => t.a === 0 && t.b === 1)).toBe(true);
    expect(cu.tiles.some(t => t.a === OFFICE_TOP_FLOOR && t.b === OFFICE_ROOF_LEVEL)).toBe(true);
  });
});

// (types used only in signatures)
export type {Ladder};
