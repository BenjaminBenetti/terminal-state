// Task frame-budget-deferral-20261030 (lane MEASURE): behaviour-preservation fingerprints of the y-aware nav queries that the
// A* string pulling (gen/grid.ts PathFinder.find -> Levels.walkLineClear) spends ~95 % of its time in on the office
// (measured: lanes/MEASURE.notes). The hot-spot fix in gen/levels.ts (non-allocating support floor in walkLineClear, a
// level hint in circleClear, a rail column mask in railCrosses) must return EXACTLY the same answers: these hashes were
// recorded on main ed4f9b7 BEFORE the change and must never move unless the queries' semantics are deliberately changed.
//
// Worlds: the REAL office (seed 4242, 10 storeys) with the elevator cab volume registered (gate shut / open), a Subway
// station (seed 1234) and the hand-made 3-level fixture (railed deck, light well, alcoves). Queries: walkLineClear (random
// and on-storey short lines, every r the game uses, with / without `by`), circleClear, supportIn / supportAt, railCrosses
// and full PathFinder.find waypoint lists (chase / cross-storey / wander requests from the enemy spawns).

import {describe, expect, it} from 'vitest';
import {LEVELS} from '../src/levels/registry';
import {Levels, levelsOf, type DynamicVolume, type VolumeGate} from '../src/gen/levels';
import {CELL, PathFinder} from '../src/gen/grid';
import type {StationLayout} from '../src/gen/stationTypes';
import {levelFixture} from './helpers/levelFixture';

/** FNV-1a over the bytes of every pushed number (Float64) — order sensitive. */
class Hash {
  private h = 0x811c9dc5;
  private readonly f = new Float64Array(1);
  private readonly b = new Uint8Array(this.f.buffer);
  n = 0;
  push(v: number | boolean | null | undefined): void {
    this.f[0] = v === null || v === undefined ? -7777.5 : typeof v === 'boolean' ? (v ? 1 : 0) : v;
    for (let i = 0; i < 8; i++) { this.h ^= this.b[i]; this.h = Math.imul(this.h, 0x01000193); }
    this.n++;
  }
  get hex(): string { return (this.h >>> 0).toString(16).padStart(8, '0'); }
}

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };
}

/** Fingerprints of one world's queries (deterministic sample). */
function fingerprint(L: Levels, layout: Pick<StationLayout, 'zombies'>, seed: number, nLines = 2500, paths = true) {
  const r = rng(seed), G0 = L.main, W = G0.w, H = G0.h;
  // walkable starts per level (cell centres with their floor)
  const starts: [number, number, number][] = [];
  for (let lv = 0; lv < L.count; lv++) {
    const G = L.grid(lv);
    for (let k = 0, got = 0; k < 20000 && got < 60; k++) {
      const cx = Math.floor(r() * W), cy = Math.floor(r() * H);
      if (!G.walkable(cx, cy)) continue;
      const c = G.center(cx, cy);
      starts.push([c[0], c[1], G.cellFloor(cx, cy)]);
      got++;
    }
  }
  const pick = () => starts[Math.floor(r() * starts.length)];
  const lines = new Hash(), circles = new Hash(), support = new Hash(), rails = new Hash(), finds = new Hash();
  const RS = [0.3, 0.34, 0.36, 0.27, 0.38];
  for (let k = 0; k < nLines; k++) {
    const a = pick();
    const short = r() < 0.7;
    const ang = r() * Math.PI * 2, len = short ? 0.5 + r() * 10 : r() * 30;
    const b = short ? [a[0] + Math.cos(ang) * len, a[1] + Math.sin(ang) * len] : [r() * W * CELL, r() * H * CELL];
    const rad = RS[k % RS.length];
    const by = r() < 0.5 ? undefined : (r() < 0.7 ? a[2] : pick()[2]);
    lines.push(L.walkLineClear(a[0], a[2], a[1], b[0], b[1], rad, by));
    const px = a[0] + (r() - 0.5) * 2, pz = a[1] + (r() - 0.5) * 2, feet = r() < 0.8 ? a[2] : a[2] + (r() - 0.5) * 1.2;
    circles.push(L.circleClear(px, pz, rad, feet));
    for (const s of [L.supportIn(px, pz, feet + 0.05, 0.45), L.supportAt(px, pz, feet + (r() - 0.3) * 3), L.supportIn(r() * W * CELL, r() * H * CELL, r() * 40 - 5)]) {
      support.push(s ? s.level : null); support.push(s ? s.floor : null); support.push(s ? s.ceil : null);
    }
    rails.push(L.railCrosses(a[0], a[1], b[0], b[1], rad * (r() < 0.5 ? 0.5 : 1), feet));
  }
  if (paths) {
    const pf = new PathFinder(L);
    const zs = layout.zombies.slice(0, 24);
    for (let k = 0; k < zs.length; k++) {
      const s = zs[k], ay = s.y ?? L.grid(s.level ?? 0).floorAt(s.x, s.z);
      for (const goal of [pick(), pick()]) {
        const p = pf.find(s.x, s.z, goal[0], goal[1], 0.34, 26000, {drops: k % 3 !== 0, ay, by: goal[2], noLinks: k % 5 === 4});
        finds.push(p ? p.length : null);
        if (p) for (const w of p) for (const v of w) finds.push(v);
      }
    }
  }
  return {lines: lines.hex, circles: circles.hex, support: support.hex, rails: rails.hex, finds: finds.hex};
}

function officeWithCab(open: boolean) {
  const layout = LEVELS.office.generate('main', {levelSeed: 4242, startWeapon: 'pistol'});
  const E = layout.office!.elevator;
  const LV = new Levels(layout.levels, layout.levelLinks, layout.rails);
  const [nx, nz] = E.doorSide === 'N' ? [0, -1] : E.doorSide === 'S' ? [0, 1] : E.doorSide === 'W' ? [-1, 0] : [1, 0];
  const along = nx !== 0 ? E.door.z : E.door.x;
  const depth = nx > 0 ? E.shaft.x1 - E.cab.x1 : nx < 0 ? E.cab.x0 - E.shaft.x0 : nz > 0 ? E.shaft.z1 - E.cab.z1 : E.cab.z0 - E.shaft.z0;
  const gate: VolumeGate = {side: E.doorSide, a0: along - E.door.width / 2, a1: along + E.door.width / 2, depth: depth > 0.05 ? depth : 0.5, height: 2.2, open};
  const stop = E.stops.find(s => s.floor === 4)!;
  const vol: DynamicVolume = {x0: E.cab.x0, z0: E.cab.z0, x1: E.cab.x1, z1: E.cab.z1, floorY: stop.y, ceilY: stop.y + E.cabHeight, level: stop.levelId, gates: [gate], stops: E.stops.map(s => s.y), name: 'elevator-cab'};
  LV.addDynamicVolume(vol);
  return {layout, LV, E, stop};
}

/** Compare with the recorded value (an unrecorded empty value prints the measured one and fails). */
function check<T>(name: string, got: T, want: T): void {
  if (JSON.stringify(want).includes('""')) process.stdout.write(`\n[fingerprint] ${name} = ${JSON.stringify(got)}\n`);
  expect.soft(got, name).toEqual(want);
}

describe('nav query fingerprints (behaviour preservation of the string-pulling hot-spot fix)', () => {
  it('the real office (seed 4242) with the elevator cab volume — gate shut and open', () => {
    const shut = officeWithCab(false), open = officeWithCab(true);
    // bias half the samples into the shaft / landing neighbourhood so the volume paths are exercised
    const fp = (o: ReturnType<typeof officeWithCab>) => fingerprint(o.LV, o.layout, 0x0ff1ce, 2500, true);
    check('OFFICE_SHUT', fp(shut), OFFICE_SHUT);
    check('OFFICE_OPEN', fp(open), OFFICE_OPEN);
    // near the cab: lines from the landing into / through the doorway at the stop's floor
    const h = new Hash(), r = rng(0xcab);
    for (const o of [shut, open]) {
      const c = o.E.cab, y = o.stop.y;
      for (let k = 0; k < 1500; k++) {
        const ax = c.x0 - 3 + r() * (c.x1 - c.x0 + 6), az = c.z0 - 3 + r() * (c.z1 - c.z0 + 6);
        const bx = c.x0 - 3 + r() * (c.x1 - c.x0 + 6), bz = c.z0 - 3 + r() * (c.z1 - c.z0 + 6);
        h.push(o.LV.walkLineClear(ax, y, az, bx, bz, 0.34, r() < 0.5 ? y : undefined));
        h.push(o.LV.circleClear(ax, az, 0.3, y));
        const s = o.LV.supportIn(ax, az, y + 0.05, 0.45);
        h.push(s ? s.floor : null);
      }
    }
    check('OFFICE_CAB', h.hex, OFFICE_CAB);
  });

  it('a Subway station (seed 1234) and the hand-made 3-level fixture (railings, light well, alcoves)', () => {
    const sub = LEVELS.subway.generate('main', {levelSeed: 1234, startWeapon: 'pistol'});
    check('SUBWAY', fingerprint(levelsOf(sub), sub, 0x5ab, 2500, true), SUBWAY);
    const fx = levelFixture();
    const LF = new Levels(fx.levels, fx.levelLinks, fx.rails);
    check('FIXTURE', fingerprint(LF, fx, 0xf1f, 3000, false), FIXTURE);
  });
});

// Recorded on main ed4f9b7 (before the gen/levels.ts hot-spot change).
const OFFICE_SHUT = {lines: 'c9f3c098', circles: '75e6b2f8', support: 'a9ea28e1', rails: '9c7ef718', finds: '46231f70'};
const OFFICE_OPEN = {lines: 'c9f3c098', circles: '75e6b2f8', support: 'a9ea28e1', rails: '9c7ef718', finds: '46231f70'};
const OFFICE_CAB = '3570ed8b';
const SUBWAY = {lines: '4a492dc5', circles: '04796bf8', support: '72973980', rails: '8f361b45', finds: 'a1b21c35'};
/** The fixture runs no PathFinder (finds = the empty hash). */
const FIXTURE = {lines: '2278f298', circles: 'c101d1b8', support: '1243b7fb', rails: 'ca023ed8', finds: '811c9dc5'};
