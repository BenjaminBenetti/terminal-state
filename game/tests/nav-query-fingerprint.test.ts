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
import {coreView} from '../src/gen/trackExt/index';
import {generateStation} from '../src/gen/station';
import {TRACK_EXT_RESERVE_OFF} from './helpers/trackExtCore';

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

function officeWithCab(open: boolean, core = false) {
  const live = LEVELS.office.generate('main', {levelSeed: 4242, startWeapon: 'pistol'});
  // Track 2 (lane GEN): `core` = the level without its track extensions (gen/trackExt coreView) — the proof world
  const layout = core ? coreView(live) : live;
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
    // Track 2 proof: the same queries over the core level (no extensions, the core grid) reproduce the pre-Track-2 pins
    check('OFFICE_SHUT core', fp(officeWithCab(false, true)), OFFICE_SHUT_CORE);
    check('OFFICE_OPEN core', fp(officeWithCab(true, true)), OFFICE_OPEN_CORE);
    check('OFFICE_SHUT', fp(shut), OFFICE_SHUT);
    check('OFFICE_OPEN', fp(open), OFFICE_OPEN);
    // near the cab: lines from the landing into / through the doorway at the stop's floor
    const cab = (list: ReturnType<typeof officeWithCab>[]) => {
    const h = new Hash(), r = rng(0xcab);
    for (const o of list) {
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
    return h.hex;
    };
    check('OFFICE_CAB core', cab([officeWithCab(false, true), officeWithCab(true, true)]), OFFICE_CAB_CORE);
    check('OFFICE_CAB', cab([shut, open]), OFFICE_CAB);
  });

  it('a Subway station (seed 1234) and the hand-made 3-level fixture (railings, light well, alcoves)', () => {
    const sub = LEVELS.subway.generate('main', {levelSeed: 1234, startWeapon: 'pistol'});
    // Track 2 GEN-2 proof: with the core reserve OFF the core view reproduces the pin (the extensions never touch the core)
    const off = generateStation(1234, {startWeapon: 'pistol', trackExtensions: TRACK_EXT_RESERVE_OFF});
    check('SUBWAY core (reserve off)', fingerprint(levelsOf(coreView(off)), coreView(off), 0x5ab, 2500, true), SUBWAY);
    // reserve on: seed 1234's skeleton leaves no bed end open, so the reserve keeps nothing and its core is unchanged
    check('SUBWAY core', fingerprint(levelsOf(coreView(sub)), coreView(sub), 0x5ab, 2500, true), SUBWAY);
    check('SUBWAY', fingerprint(levelsOf(sub), sub, 0x5ab, 2500, true), SUBWAY_LIVE);
    const fx = levelFixture();
    const LF = new Levels(fx.levels, fx.levelLinks, fx.rails);
    check('FIXTURE', fingerprint(LF, fx, 0xf1f, 3000, false), FIXTURE);
  });
});

// Recorded on main ed4f9b7 (before the gen/levels.ts hot-spot change).
// Task office-props-physics-scale-20261030: the OFFICE world (not the queries) changed — user-requested furniture rescales, the
// server rack r2 footprint, host-top clutter and a turning square kept free in small office rooms re-lay seed 4242's props, so the
// same queries walk a different world. gen/levels.ts and gen/grid.ts are byte-identical to main 932624e (the query code is
// unchanged) and the Subway / fixture fingerprints below did not move. Was {lines c9f3c098, circles 75e6b2f8, support a9ea28e1,
// rails 9c7ef718, finds 46231f70} (shut = open, as now).
// Track 2 — Beyond the Station (lane GEN): the office level now carries track extensions (tunnels east of its station's beds and
// service annexes), stamped after every core pass; its grid grows east / south (same origin), so the office world the random
// queries sample (cells drawn over W x H) changes. gen/levels.ts and gen/grid.ts are untouched. Translation-normalised proof
// (every run): the same queries over the CORE level (gen/trackExt coreView: the core grid, extension cells / records out)
// reproduce the pre-Track-2 pins byte for byte (OFFICE_*_CORE = the previous OFFICE_* values); the live pins below are the
// extended world's.
const OFFICE_SHUT_CORE = {lines: '56f458a5', circles: 'f4c1a2a5', support: '6d441f6d', rails: 'aea167c5', finds: '4353c5dc'};
const OFFICE_OPEN_CORE = {lines: '56f458a5', circles: 'f4c1a2a5', support: '6d441f6d', rails: 'aea167c5', finds: '4353c5dc'};
const OFFICE_CAB_CORE = '3570ed8b';
// Track 2 (lane CONTENT): office 4242's service annexes are now dressed (gen/annexContent.ts, appended after every core pass: prop
// footprints block annex cells) — the live world the random queries sample changes again (was {lines e6296ba5, circles c6c70805,
// support 9728d7d2, rails af1f34c5, finds 11c31ab0}); the core pins above still hold byte for byte (coreView drops the extensions'
// cells, their blocked footprints and appended records). gen/levels.ts / gen/grid.ts untouched.
// Task track2-playtest-revision-20261031 (lane ROOMS): the live Office world changed again — its street station's annexes are re-laid
// (machinery halls, signature machinery boxes, lean furniture; the grid grows differently east / south), so the same seeded queries
// sample a different world (the query code is unchanged; the core-view pins above did not move). Was shut = open {lines d7c9a265,
// circles fd0c3f65, support 3633f80e, rails c0990205, finds 41c7c82f} (shut = open, as now).
// (playtest revision, primary: annex room storage / loot classes / service bands on the merged ROOMS + ART lanes — the annex
// props and spawns re-lay; lines 69abd718 -> 00dbccf8, circles 2ac511c5 -> 7dcfff05; the CORE pins are unchanged)
const OFFICE_SHUT = {lines: '00dbccf8', circles: '7dcfff05', support: 'ea00599b', rails: '5e871885', finds: '0c734d22'};
const OFFICE_OPEN = {lines: '00dbccf8', circles: '7dcfff05', support: 'ea00599b', rails: '5e871885', finds: '0c734d22'};
/** (the near-cab queries only touch the tower: unchanged by the extensions) */
const OFFICE_CAB = '3570ed8b';
const SUBWAY = {lines: '4a492dc5', circles: '04796bf8', support: '72973980', rails: '8f361b45', finds: 'a1b21c35'};
// Track 2 lane GEN-2 — CAUSE: "core reserve enabled (authorized incidence change)" + the GEN-2 incidence planner: the LIVE Subway
// seed 1234 now carries two service-hatch annexes (it had no extension before; its core is unchanged: SUBWAY above, proven with
// the reserve off and on), so the extended world the random queries sample (cells drawn over W x H) changes. Was = SUBWAY.
// Track 2 (lane CONTENT): its two hatch annexes are now dressed (gen/annexContent.ts, appended after every core pass: prop footprints
// block annex cells) — the live world changes again (was {lines 98db9ae5, circles 958d5d98, support 0f5d72cc, rails 967a2aa5,
// finds fdfd6e2b}); SUBWAY (core, reserve off and on) still holds byte for byte. gen/levels.ts / gen/grid.ts untouched.
// (task track2-playtest-revision lane ROOMS: seed 1234's annexes re-laid — halls, machinery boxes, lean furniture; was {lines f3ead7d8,
// circles f2f9e858, support 14ebe369, rails 967a2aa5, finds 8b2e7b36}; the core / reserve-off pins are unchanged)
// (playtest revision, primary: circles e28fe105 -> 24650d58 — the annex room storage pieces; lines / support / rails / finds unchanged)
const SUBWAY_LIVE = {lines: '5316efe5', circles: '24650d58', support: '8501fb29', rails: '8f0e3c65', finds: 'dcd8c5b9'};
/** The fixture runs no PathFinder (finds = the empty hash). */
const FIXTURE = {lines: '2278f298', circles: 'c101d1b8', support: '1243b7fb', rails: 'ca023ed8', finds: '811c9dc5'};
