// Task studio-train-crafting-v1-20261111-225628-01 (lane SENTRY): THE HEADROOM CENSUS — where the parked train's roof turret can stand
// deployed. Every level archetype's REAL generated layout (a few seeds each) with the real parked train runtime:
//  - the headroom world/sentryTurret.ts reports over the roof mount (the bed's ceiling over the swept disc, hanging props) against the
//    turret's highest reach + SENTRY.headroom, cross-checked by the bullet's own world ray cast straight up from the roof (centre + four
//    points of the swept circle): where the turret may deploy nothing is in its way;
//  - where it may NOT deploy it never rises, never fires at an enemy right beside it, and its console says why;
//  - its field of fire there: the standing cells within range with a clear shot at chest height (the dead zone / walls in numbers).
// The table is written to $LL_SENTRY_OUT when set (the lane's report); the pinned outcomes below are what the census found.
import {appendFileSync, writeFileSync} from 'node:fs';
import {afterEach, describe, expect, it} from 'vitest';
import {installCanvasShim} from './helpers/canvas2d';
import {DT, sentryWorld, teardownSentryWorlds, type SentryWorld} from './helpers/sentryFixture';
import {LEVEL_IDS} from '../src/levels/registry';
import type {LevelId} from '../src/levels/types';
import {CELL, FLOOR} from '../src/gen/grid';
import {raycastWorld} from '../src/combat/hitscan';
import {trainToWorld} from '../src/gen/playerTrain';
import {TRAIN_CLEAR} from '../src/gen/playerTrain';
import {SENTRY, turretReach, turretSweep} from '../src/craft/sentry';
import {turretMount} from '../src/craft/trainFixtures';
import {PLAYER_TRAIN_SPEC as SPEC} from '../src/world/playerTrainSpec';
import {SENTRY_TEXT} from '../src/world/sentryTurret';

installCanvasShim(false);
afterEach(teardownSentryWorlds);

const OUT = process.env.LL_SENTRY_OUT;
const out = (s: string) => { if (OUT) appendFileSync(OUT, s + '\n'); };
if (OUT) writeFileSync(OUT, '');

const SEEDS = [1, 2, 3] as const;

interface Row {
  level: LevelId; seed: number; placed: boolean; ok: boolean; clearance: number; over: number; rayUp: number;
  samples: number; clear: number; platform: number; platformClear: number;
  /** The clear-shot tests of the field of fire: how many went on to the world rays, the mean time of one (microseconds; the report only). */
  rayed: number; us: number;
}

/** The free height straight up from the car's roof top at train-local (lx, lz), by the bullet's world ray (m above the MOUNT). */
function rayUp(s: SentryWorld, lx: number, lz: number): number {
  const m = turretMount(SPEC), o = trainToWorld(s.p, lx, SPEC.roofY + 0.02, lz);
  const wh = raycastWorld(s.levels, s.lay.props, o, {x: 0, y: 1, z: 0}, 60, s.lay.trench.floorY);
  return (wh.kind === 'none' ? Infinity : o.y + wh.t) - (s.p.railTopY + m.y);
}

function census(level: LevelId, seed: number): Row {
  const s = sentryWorld({level, seed, ammo: 10});
  const row: Row = {level, seed, placed: !!s.p, ok: false, clearance: NaN, over: NaN, rayUp: NaN, samples: 0, clear: 0, platform: 0, platformClear: 0, rayed: 0, us: 0};
  if (!s.p) return row;
  const m = turretMount(SPEC), r = turretSweep(), room = s.sys.headroom();
  row.ok = room.ok;
  row.clearance = room.clearance;
  row.over = room.ceil - (s.p.railTopY + m.y);
  row.rayUp = Math.min(rayUp(s, m.x, m.z), rayUp(s, m.x + r, m.z), rayUp(s, m.x - r, m.z), rayUp(s, m.x, m.z + r * 0.98), rayUp(s, m.x, m.z - r * 0.98));
  // the field of fire: standing cells within range (every 3rd cell of every storey), a clear shot at chest height
  const piv = s.mount(); // (the range is measured from the yaw axis)
  const rayed: {x: number; y: number; z: number}[] = [];
  for (const lv of s.levels.list) {
    const g = lv.grid;
    for (let cy = 1; cy < g.h; cy += 3) for (let cx = 1; cx < g.w; cx += 3) {
      const i = cy * g.w + cx;
      if (g.cells[i] !== FLOOR || g.blocked[i] || g.rampIdx[i] >= 0) continue;
      const x = (cx + 0.5) * CELL, z = (cy + 0.5) * CELL;
      if (Math.hypot(x - piv.x, z - piv.z) > SENTRY.range) continue;
      const f = g.floorOf(i), on = Math.abs(f - s.p.floorY) < 0.6, to = {x, y: f + 1.3, z};
      row.samples++;
      if (on) row.platform++;
      const n = s.sys.counts.rayTests, clear = s.sys.clearTo(to, s.p);
      if (s.sys.counts.rayTests !== n) rayed.push(to); // (it went on to the world rays: a costly test)
      if (clear) { row.clear++; if (on) row.platformClear++; }
    }
  }
  // the cost of a costly test (the report only): the same lines again, timed as one pass
  row.rayed = rayed.length;
  if (OUT && rayed.length) {
    const t0 = performance.now();
    for (let k = 0; k < 3; k++) for (const to of rayed) s.sys.clearTo(to, s.p);
    row.us = (performance.now() - t0) * 1000 / (3 * rayed.length);
  }
  return row;
}

const fmt = (v: number) => (Number.isFinite(v) ? v.toFixed(2) : String(v));

/**
 * What the census found (2026-11-12, the cooked turret on the middle hatch: its top 0.568 m over the mount at the lower stop): the
 * turret can deploy at every placed train of every level archetype, every seed — the least clearance over the raised turret is
 * 0.65 m (the 1.22 m ceilings over the mount: Subway seed 1, Office seed 2).
 */
const DEPLOYS: Record<LevelId, boolean> = {subway: true, office: true, mall: true, market: true, bunker: true, skyways: true, reactor: true};

describe('sentry: headroom over the roof mount, every level archetype', () => {
  it('needs more than the placement guarantees: the turret stands taller than the roof-to-ceiling clearance of the car', () => {
    const m = turretMount(SPEC);
    expect(turretReach()).toBeGreaterThan(0.4);
    expect(m.y + turretReach() + SENTRY.headroom).toBeGreaterThan(SPEC.roofY + TRAIN_CLEAR.ceiling); // (so the headroom check is a real one)
    expect(turretSweep()).toBeLessThan(SPEC.width / 2); // the swept disc stays over the roof
  });

  for (const level of LEVEL_IDS) {
    it(`${level}: seeds ${SEEDS.join(', ')}`, () => {
      for (const seed of SEEDS) {
        const row = census(level, seed);
        out(`${level.padEnd(8)} seed ${seed}: placed ${row.placed ? 'yes' : 'NO '} deploy ${row.ok ? 'yes' : 'NO '} ceiling over mount ${fmt(row.over)} m, clearance over the raised turret ${fmt(row.clearance)} m (ray up ${fmt(row.rayUp)} m)`
          + ` | clear shots at chest height: ${row.clear}/${row.samples} standing samples in range, ${row.platformClear}/${row.platform} on the platform's height`
          + ` | ${row.rayed} tests went on to the world rays, ${row.us.toFixed(0)} us each: a pick's worst (${SENTRY.maxChecks} bodies refused by the rays, torso + head) ${(row.us * SENTRY.maxChecks * 2 / 1000).toFixed(2)} ms`);
        expect(row.placed, `${level} ${seed}: a train is placed`).toBe(true);
        // the report is consistent with itself and with the world ray
        expect(row.ok).toBe(row.clearance >= SENTRY.headroom);
        if (row.ok) expect(row.rayUp, `${level} ${seed}: nothing in the raised turret's way`).toBeGreaterThanOrEqual(turretReach() + SENTRY.headroom - 0.02);
        else expect(row.rayUp, `${level} ${seed}: the world ray agrees something is in the way`).toBeLessThan(turretReach() + SENTRY.headroom + 0.25);
        expect(row.ok, `${level} ${seed}: deploys`).toBe(DEPLOYS[level]);
        if (row.ok) expect(row.clearance, `${level} ${seed}: the least clearance found`).toBeGreaterThan(0.6);
        if (row.ok) expect(row.platformClear, `${level} ${seed}: a field of fire on the platform`).toBeGreaterThan(0);
      }
    }, 240000);
  }
});

describe('sentry: no headroom = stowed, silent, and the console says so', () => {
  it('a ceiling lowered over the mount keeps the turret down; with the ceiling back it deploys', () => {
    const s = sentryWorld({ammo: 20});
    expect(s.sys.headroom().ok).toBe(true);
    // a beam hung over the roof mount (a prop box in the layout: what a low duct / sign would be)
    const m = turretMount(SPEC), at = trainToWorld(s.p, m.x, m.y + turretReach() - 0.1, m.z);
    const beam = {kind: 'crate', x: at.x, z: at.z, y: at.y, rot: 0, area: -1, hx: 0.5, hz: 0.5, h: 0.3, blocksSight: false, variant: 0} as never;
    s.lay.props.push(beam);
    try {
      for (const h of s.host.sectionHooks) h.teardown?.();
      for (const h of s.host.sectionHooks) h.build?.(s.lay);
      const room = s.sys.headroom();
      expect(room.ok).toBe(false);
      expect(room.clearance).toBeCloseTo(-0.1, 5);
      const n = s.toasts.length;
      s.eq.disconnect(s.unit);
      s.eq.connect(s.unit, 0);
      expect(s.toasts.slice(n).map(t => t.text)).toEqual([SENTRY_TEXT.plugNoHeadroom]);
      expect(s.eq.uses.sentry!.prompt(s.unit)).toContain(SENTRY_TEXT.noHeadroom);
      s.host.zombies.push(fakeEnemy(trainToWorld(s.p, m.x, SPEC.floorY, -7)));
      for (let i = 0; i < 3 / DT; i++) s.sys.update(DT);
      expect(s.sys.deploy).toBe(0);
      expect(s.sys.view.root.visible).toBe(false);
      expect(s.sys.counts.shots).toBe(0);
      expect(s.unit.ammo).toBe(20);
    } finally {
      s.lay.props.splice(s.lay.props.indexOf(beam), 1);
    }
    for (const h of s.host.sectionHooks) h.teardown?.();
    for (const h of s.host.sectionHooks) h.build?.(s.lay);
    expect(s.sys.headroom().ok).toBe(true);
    expect(s.eq.uses.sentry!.prompt(s.unit)).not.toContain(SENTRY_TEXT.noHeadroom);
    for (let i = 0; i < 1 / DT; i++) s.sys.update(DT);
    expect(s.sys.deploy).toBe(1);
    expect(s.sys.view.root.visible).toBe(true);
  });
});

/** A standing body of plain volumes at world feet `f` (a head sphere, a torso capsule) with a counting brain. */
function fakeEnemy(f: {x: number; y: number; z: number}) {
  return {
    brain: {alive: true, x: f.x, y: f.y, z: f.z, state: 'idle', stats: {radius: 0.35}, damage: () => false, hear: () => {}},
    ragdolled: false, hitFlash: 0,
    hitVolumes: [
      {part: 'head' as const, a: {x: f.x, y: f.y + 1.62, z: f.z}, b: null, r: 0.13},
      {part: 'torso' as const, a: {x: f.x, y: f.y + 0.95, z: f.z}, b: {x: f.x, y: f.y + 1.45, z: f.z}, r: 0.2},
    ],
  };
}
