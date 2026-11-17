// Task studio-surface-run-field-followup-20261116-211729-01 (lane ACCESS): SURFACE RUN version 2 — the cargo lift ends of the crossing
// (gen/surface/accessLift.ts; the district's end in gen/surface/checkpoint.ts), through the level registry.
//  - Subway: the lift is at a NORMAL closed street exit — never a hall off the food court / retail arcade while another closed hall can
//    take it (swept over present stations; network seed 1's first Subway node, whose version-1 stairwell opens off the food court, named);
//  - append-only and RNG-neutral like the version-1 stairwell: the plain station's lists are unchanged but for the chosen hall's grille
//    retired, its two signs and label; one area appended (the car) and one light (the landing's fixture, follow-up 3); the grid differs
//    only inside the chosen hall;
//  - a real room: the car's FLOOR cells at the hall floor, its ceiling, the gate's doorway, the return pose standing in it, reachable;
//  - the district's end: the car at the back of the command tent, in the tent's own area, the portal pose standing in it, the way from
//    the car to the flap free; version 1 (both sides) keeps its stairwell / portal (tests/surface-v1-compat.test.ts pins the bytes).
import {describe, expect, it} from 'vitest';
import {LEVELS} from '../src/levels/registry';
import {SURFACE_VERSION, surfacePresent, type SurfaceHost} from '../src/gen/surface/surfaceRun';
import {LIFT_AVOID_PARENTS, LIFT_CAR, subwayLiftCandidates} from '../src/gen/surface/accessLift';
import {validateLayout, type StationLayout} from '../src/gen/station';
import {CELL, FLOOR, SOLID} from '../src/gen/grid';
import {levelDistance} from '../src/gen/levelGen';
import {generateNetwork} from '../src/campaign/network';
import type {SurfaceLift} from '../src/gen/surface/surfaceTypes';

const seeds = (host: SurfaceHost, n: number): number[] => {
  const out: number[] = [];
  for (let s = 1; out.length < n && s < 5000; s++) if (surfacePresent(host, s, SURFACE_VERSION)) out.push(s);
  return out;
};
const gen = (host: SurfaceHost, s: number, v?: number): StationLayout => LEVELS[host].generate('main', {levelSeed: s, ...(v !== undefined ? {surfaceVersion: v} : {})});
const district = (host: SurfaceHost, s: number, v: number): StationLayout => LEVELS[host].generate('surface', {levelSeed: s, surfaceVersion: v});
const plain = (x: unknown) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
const parentType = (L: StationLayout, hall: number) => { const p = L.areas[hall].parent; return p !== undefined && p >= 0 ? L.areas[p].type : ''; };

/** Every cell of a lift's car room is FLOOR in its area at its floor, under the car's ceiling. */
function expectCarRoom(L: StationLayout, l: SurfaceLift): void {
  const g = L.grid;
  for (let z = l.cab.z0 + CELL / 2; z < l.cab.z1; z += CELL) for (let x = l.cab.x0 + CELL / 2; x < l.cab.x1; x += CELL) {
    const [cx, cy] = g.cellOf(x, z), i = g.idx(cx, cy);
    expect(g.cells[i], `car cell ${cx},${cy}`).toBe(FLOOR);
    expect(g.area[i]).toBe(l.area);
    expect(g.floor[i]).toBeCloseTo(l.y - LIFT_CAR.sink, 4); // (just under the kit's deck)
    expect(g.ceil[i]).toBeCloseTo(l.y + LIFT_CAR.cabH + LIFT_CAR.ceilGap, 4);
  }
  expect(l.cab.x1 - l.cab.x0 === LIFT_CAR.width * CELL || l.cab.z1 - l.cab.z0 === LIFT_CAR.width * CELL).toBe(true);
  // the ring: SOLID round the car but for the gate's doorway (its cells FLOOR, a doorway's head)
  const n = l.doorSide === 'N' ? [0, -1] : l.doorSide === 'S' ? [0, 1] : l.doorSide === 'W' ? [-1, 0] : [1, 0];
  const gx = l.door.x + n[0] * CELL / 2, gz = l.door.z + n[1] * CELL / 2;
  const [dx, dy] = g.cellOf(gx, gz), gi = g.idx(dx, dy);
  expect(g.cells[gi], 'the gate doorway').toBe(FLOOR);
  expect(g.ceil[gi]).toBeCloseTo(l.y + LIFT_CAR.gateH + LIFT_CAR.ceilGap, 4);
  const side = (k: number) => { const [sx, sy] = g.cellOf(gx + (n[1] !== 0 ? k : 0), gz + (n[0] !== 0 ? k : 0)); return g.cells[g.idx(sx, sy)]; };
  expect(side(LIFT_CAR.width * CELL / 2 + 0.25), 'the ring beside the gate').toBe(SOLID);
  expect(side(-(LIFT_CAR.width * CELL / 2 + 0.25))).toBe(SOLID);
}

describe('Surface Run v2: the Subway lift at a normal closed street exit', () => {
  it('network seed 1, st-00: version 1 opens the stairwell off the food court; version 2 puts the lift at a ticket-hall / concourse exit', () => {
    const n = generateNetwork(1).nodes.find(x => x.archetype === 'subway')!;
    const L1 = gen('subway', n.levelSeed, 1), L2 = gen('subway', n.levelSeed, 2);
    expect(L1.surfaceAccess?.kind).toBe('subway-stair');
    expect(parentType(L1, L1.surfaceAccess!.hall!)).toBe('food-court'); // (the reported pick)
    const a = L2.surfaceAccess!;
    expect(a).toMatchObject({v: 2, kind: 'lift'});
    expect(LIFT_AVOID_PARENTS).not.toContain(parentType(L2, a.hall!));
  }, 120_000);

  it('over 24 present stations: every one gets its lift, never off the food court / arcade while another closed hall fits', () => {
    let avoided = 0;
    for (const s of seeds('subway', 24)) {
      const L = gen('subway', s, 2), a = L.surfaceAccess;
      expect(a?.kind, `seed ${s}`).toBe('lift');
      const pre = gen('subway', s, 0);
      const cands = subwayLiftCandidates(pre, s);
      const pt = parentType(L, a!.hall!);
      if (cands.some(c => c.preferred && c.fits)) expect(LIFT_AVOID_PARENTS, `seed ${s} took a ${pt} hall`).not.toContain(pt);
      if (cands.some(c => !c.preferred)) avoided++;
    }
    expect(avoided, 'the sweep includes stations that HAVE a food-court / arcade closed hall').toBeGreaterThan(0);
  }, 300_000);

  it('append-only and RNG-neutral: the plain station unchanged but for the chosen hall; deterministic', () => {
    for (const s of seeds('subway', 3)) {
      const L0 = gen('subway', s), L2 = gen('subway', s, 2), a = L2.surfaceAccess!, hall = a.hall!;
      expect(L2.areas.length).toBe(L0.areas.length + 1);
      L0.areas.forEach((ar, i) => expect(plain({...L2.areas[i], label: i === hall ? ar.label : L2.areas[i].label}), `area ${i}`).toEqual(plain(ar)));
      expect(L2.areas[hall].label).not.toMatch(/closed/i);
      expect(a.lift!.area).toBe(L0.areas.length);
      for (const k of ['doors', 'pickups', 'zombies', 'storefronts', 'decor', 'trenches', 'playerSpawn', 'levelLinks', 'hordes'] as const) expect(plain(L2[k]), k).toEqual(plain(L0[k]));
      // (follow-up 3) lights: the plain list, then the landing's fixture appended (tests/surface-lift-lights.test.ts)
      expect(plain(L2.lights.slice(0, L0.lights.length))).toEqual(plain(L0.lights));
      expect(L2.lights.length).toBe(L0.lights.length + 1);
      expect(plain(L2.traversal.stairs)).toEqual(plain(L0.traversal.stairs));
      expect(L2.props.length).toBe(L0.props.length);
      L0.props.forEach((p, i) => {
        const q = L2.props[i];
        if (p.kind === 'exitStair' && p.area === hall) { expect(q).toMatchObject({cargoGone: true, h: p.h, blocksSight: false, x: p.x, z: p.z}); return; }
        expect(plain(q), `prop ${i}`).toEqual(plain(p));
      });
      expect(L2.signs.length).toBe(L0.signs.length);
      const changed = L0.signs.map((g, i) => (JSON.stringify(g) === JSON.stringify(L2.signs[i]) ? -1 : i)).filter(i => i >= 0);
      expect(changed.map(i => L2.signs[i].text).sort()).toEqual([`${a.street!.toUpperCase()} · EXIT`, 'LIFT TO STREET'].sort());
      // the grid differs only inside the chosen hall; every other storey grid untouched
      const g0 = L0.grid, g2 = L2.grid, H = L0.areas[hall];
      for (let i = 0; i < g0.cells.length; i++) {
        if (g0.cells[i] === g2.cells[i] && g0.floor[i] === g2.floor[i] && g0.ceil[i] === g2.ceil[i] && g0.area[i] === g2.area[i] && g0.blocked[i] === g2.blocked[i]) continue;
        const x = i % g0.w, y = Math.floor(i / g0.w);
        expect(x >= H.x && x < H.x + H.w && y >= H.y && y < H.y + H.h, `cell ${x},${y} outside the hall`).toBe(true);
      }
      for (let k = 1; k < L0.levels.length; k++) expect(Buffer.from(L2.levels[k].grid.cells).equals(Buffer.from(L0.levels[k].grid.cells))).toBe(true);
      expect(plain(gen('subway', s, 2).surfaceAccess), 'deterministic').toEqual(plain(a));
    }
  }, 180_000);

  it('a real car room: FLOOR at the hall floor under the car ceiling, the gate open onto the hall, the return pose in it, reachable', () => {
    for (const s of seeds('subway', 3)) {
      const L0 = gen('subway', s), L2 = gen('subway', s, 2), a = L2.surfaceAccess!, l = a.lift!;
      expect(l.end).toBe('lower');
      expectCarRoom(L2, l);
      const base = new Set(validateLayout(L0));
      expect(validateLayout(L2).filter(x => !base.has(x))).toEqual([]);
      const g = L2.grid, p = a.returnPose;
      expect(p.x > l.cab.x0 && p.x < l.cab.x1 && p.z > l.cab.z0 && p.z < l.cab.z1).toBe(true);
      expect(g.floorAt(p.x, p.z)).toBeCloseTo(p.y - LIFT_CAR.sink, 4);
      expect(g.circleClear(p.x, p.z, 0.4)).toBe(true);
      expect(a.trigger).toMatchObject({x0: l.cab.x0, x1: l.cab.x1, z0: l.cab.z0, z1: l.cab.z1});
      const [sx, sy] = g.cellOf(L2.playerSpawn.x, L2.playerSpawn.z);
      const dist = levelDistance(L2.levels, sx, sy)[0];
      const [cx, cy] = g.cellOf(p.x, p.z);
      expect(dist[g.idx(cx, cy)], 'the car is reachable on foot from the spawn').toBeGreaterThan(0);
    }
  }, 180_000);

  it('version 1 keeps its stairwell / street doors; an Office / Mall at version 2 takes its lift inside the building', () => {
    const s = seeds('subway', 1)[0];
    expect(gen('subway', s, 1).surfaceAccess).toMatchObject({v: 1, kind: 'subway-stair'});
    for (const host of ['office', 'mall'] as const) {
      const t = seeds(host, 1)[0];
      expect(gen(host, t, 1).surfaceAccess).toMatchObject({v: 1, kind: `${host}-door`});
      // (follow-up 2: the host's own version-2 lift — tests/surface-access-v2-hosts.test.ts sweeps it)
      expect(gen(host, t, 2).surfaceAccess).toMatchObject({v: 2, kind: 'lift'});
    }
  }, 120_000);
});

describe('Surface Run v2: the district end — the cargo lift inside the command tent', () => {
  for (const host of ['subway', 'office', 'mall'] as const) {
    it(`${host}: the car at the tent's back in the tent's own area, the portal pose in it, the way to the flap free; v1 unchanged`, () => {
      const s = seeds(host, 1)[0];
      const D = district(host, s, 2), S = D.surface!, l = S.portal.lift!;
      expect(S.portal.kind).toBe('lift');
      expect(l.end).toBe('upper');
      const t = S.checkpoint.tent;
      expect(l.shaft.x0 >= t.rect.x0 && l.shaft.x1 <= t.rect.x1 && l.shaft.z0 >= t.rect.z0 && l.shaft.z1 <= t.rect.z1, 'the shaft inside the tent').toBe(true);
      expect(l.area).toBe(t.area);
      expectCarRoom(D, l);
      const p = S.portal.pose, g = D.grid;
      expect(p.x > l.cab.x0 && p.x < l.cab.x1 && p.z > l.cab.z0 && p.z < l.cab.z1).toBe(true);
      expect(g.circleClear(p.x, p.z, 0.4)).toBe(true);
      // the gate faces the flap (the tent's door side)
      expect(l.doorSide).toBe(t.door.side);
      // on foot from the car to the flap's cell
      const [cx, cy] = g.cellOf(p.x, p.z);
      const dist = levelDistance(D.levels!, cx, cy)[0];
      const [fx, fy] = g.cellOf(t.door.x, t.door.z);
      expect(dist[g.idx(fx, fy)], 'the flap is reachable from the car').toBeGreaterThan(0);
      // nothing blocking stands in the car or its gate
      for (const q of D.props) {
        if ((q.level ?? 0) !== 0 || q.h <= 0.05 || q.cargoGone) continue;
        const m = 0.6;
        expect(q.x + q.hx > l.shaft.x0 - m && q.x - q.hx < l.shaft.x1 + m && q.z + q.hz > l.shaft.z0 - m && q.z - q.hz < l.shaft.z1 + m && q.area === t.area, `${q.kind} at the lift`).toBe(false);
      }
      const D1 = district(host, s, 1);
      expect(D1.surface!.portal.kind).toBe(host === 'subway' ? 'stair' : 'door');
      expect(D1.surface!.portal.lift).toBeUndefined();
    }, 120_000);
  }
});
