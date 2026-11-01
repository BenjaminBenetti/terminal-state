// Task studio-beta-mall-round3-20261031-01 (lane ENEMY, R2). User (mall round 3): "slight agro issue at the start of the level. When
// killing zombies at the subway terminal the open atrium often causes zombies higher up to agro, causing them to run down in a big
// stream. We might need better line of sight checks before agro-ing or something."
//
// The open-atrium perception (ai/brain.ts ATRIUM_PERCEPTION; mall only): an UNAWARE enemy notices a player on another storey only
// within 3D sightRange x 0.75, in its field of view, after 1 s of continuous sight; gunfire heard through the void x0.7 per storey,
// at most 3 new cross-storey responders per noise; a horde member's cross-storey sighting calls at most 2 mates. Covers: each rule,
// the gates (no flag = the established perception, byte for byte for the gunfire loop), no blindness for an aware enemy, the dormant
// Siren untouched. The deterministic before / after scenario on a generated mall (tests/helpers/aggroSim.ts) is in
// tests/mall-enemy-sample.test.ts (it shares that file's memoized malls).

import {describe, expect, it} from 'vitest';
import {ATRIUM_PERCEPTION, ZombieBrain, alertListeners, hearingMuffle, slabsBetween, type BrainWorld} from '../src/ai/brain';
import {SirenBrain} from '../src/ai/siren';
import {HordeDirector} from '../src/ai/horde';
import {placeHordes} from '../src/ai/hordePlace';
import {MALL_HORDE_RULES, type HordeRules} from '../src/ai/hordeSpec';
import {levelsOf} from '../src/gen/levels';
import {Rng} from '../src/core/rng';
import {ringMallFixture} from './helpers/hordeMallFixture';

const DT = 1 / 60;

/** A fake brain world: the player at `p` (feet), a switchable sight line; atriumNotice = the mall's notice rule. */
function world(p: {x: number; y: number; z: number}, notice: boolean, sight: {los: boolean} = {los: true}): BrainWorld {
  return {
    px: p.x, pz: p.z, py: p.y, playerAlive: true,
    los: () => sight.los,
    walkClear: () => false,
    findPath: (_ax, _az, bx, bz, op) => [[bx, bz, undefined, op?.by ?? 0]],
    randomNear: () => null,
    rand: () => 0.5,
    atrium: true,
    ...(notice ? {atriumNotice: true} : {}),
  };
}
/** Seconds until the brain's first `alerted` (-1: never within `secs`). */
function alertTime(b: ZombieBrain, w: BrainWorld, secs: number, each?: (t: number) => void): number {
  for (let f = 1; f <= Math.round(secs * 60); f++) {
    each?.(f * DT);
    if (b.update(DT, w).alerted) return f * DT;
  }
  return -1;
}

describe('sight across storeys (open-atrium notice rule)', () => {
  it('floor 1 (5 m up), 8 m out, facing the player: noticed at once before, after 1 s of continuous sight with the rule', () => {
    const P = {x: 0, y: 0, z: 8};
    const off = new ZombieBrain('shambler', 0, 0, 0); off.y = 5;
    const on = new ZombieBrain('shambler', 0, 0, 0); on.y = 5;
    expect(alertTime(off, world(P, false), 3)).toBeCloseTo(DT, 6);
    const t = alertTime(on, world(P, true), 3);
    expect(t).toBeGreaterThanOrEqual(ATRIUM_PERCEPTION.dwellS - 1e-9);
    expect(t).toBeLessThan(ATRIUM_PERCEPTION.dwellS + 2 * DT);
    expect(on.state).toBe('chase'); // genuinely seen: it hunts
  });

  it('floor 3 (15 m up), 5 m plan distance, facing away: the old plan-distance rule noticed at once; 3D 15.8 m > 13.5 m: never unaware', () => {
    const P = {x: 0, y: 0, z: 5};
    const off = new ZombieBrain('shambler', 0, 0, Math.PI); off.y = 15;
    const on = new ZombieBrain('shambler', 0, 0, Math.PI); on.y = 15;
    expect(alertTime(off, world(P, false), 2)).toBeGreaterThan(0);
    expect(alertTime(on, world(P, true), 10)).toBe(-1);
    // facing the player it is still out of the 3D notice range (shambler 18 x 0.75 = 13.5 m)
    const facing = new ZombieBrain('shambler', 0, 0, 0); facing.y = 15;
    expect(alertTime(facing, world(P, true), 10)).toBe(-1);
    expect(ZombieBrainRange('shambler')).toBeCloseTo(13.5, 6);
  });

  it('the dwell restarts whenever the sight line breaks', () => {
    const P = {x: 0, y: 0, z: 8};
    const b = new ZombieBrain('shambler', 0, 0, 0); b.y = 5;
    const sight = {los: true};
    const t = alertTime(b, world(P, true, sight), 4, s => { sight.los = !(s > 0.6 && s < 0.7); });
    expect(t).toBeGreaterThan(0.7 + ATRIUM_PERCEPTION.dwellS - 2 * DT);
  });

  it('the all-round 5 m awareness is 3D: right above (plan 1 m, 5.1 m 3D) facing away — noticed before, not with the rule', () => {
    const P = {x: 0, y: 0, z: 1};
    const off = new ZombieBrain('shambler', 0, 0, Math.PI); off.y = 5;
    const on = new ZombieBrain('shambler', 0, 0, Math.PI); on.y = 5;
    expect(alertTime(off, world(P, false), 2)).toBeGreaterThan(0);
    expect(alertTime(on, world(P, true), 5)).toBe(-1);
  });

  it('same storey and a rider half a storey away (mid-escalator, 2.5 m): the established sight, unchanged', () => {
    for (const dy of [0, 2.5]) {
      const b = new ZombieBrain('shambler', 0, 0, 0); b.y = dy;
      expect(alertTime(b, world({x: 0, y: 0, z: 17}, true), 1), `dy ${dy}`).toBeCloseTo(DT, 6);
    }
  });

  it('no blindness: an enemy already aware of the player keeps the established sight across storeys (2D 15 m, 10 m below = 18 m 3D)', () => {
    const P = {x: 0, y: 0, z: 15};
    const run = (los: boolean) => {
      const b = new ZombieBrain('shambler', 0, 0, 0); b.y = 10;
      b.hear(P.x, P.z, 100, P.y); // gunfire: aware, chasing
      const w = world(P, true, {los});
      for (let f = 0; f < 12 * 60; f++) b.update(DT, w);
      return b.state;
    };
    expect(run(true)).toBe('chase'); // it keeps seeing the player (never gives up)
    expect(run(false)).not.toBe('chase'); // without the sight line it gives up (search -> idle): the sight is what keeps it hunting
  });
});

/** The unaware cross-storey notice range of a zombie type (m). */
function ZombieBrainRange(type: 'shambler' | 'coated'): number {
  return new ZombieBrain(type, 0, 0, 0).stats.sightRange * ATRIUM_PERCEPTION.noticeFrac;
}

describe('gunfire across storeys (alertListeners)', () => {
  const bases = [0, 5, 10, 15];
  const spy = (b: ZombieBrain, log: Map<ZombieBrain, number>) => { const h = b.hear.bind(b); b.hear = (x, z, r, y) => { log.set(b, r); h(x, z, r, y); }; return b; };
  const at = (x: number, y: number, z: number) => { const b = new ZombieBrain('shambler', x, z, 0); b.y = y; return b; };

  it('without `atrium`: exactly the established rule (3D radius x hearingMuffle(los, slabs)) for every listener', () => {
    const rnd = new Rng(4242);
    const brains = Array.from({length: 60}, () => at(rnd.range(-30, 30), [0, 5, 10, 15][rnd.int(0, 3)], rnd.range(-30, 30)));
    const losOf = new Map(brains.map(b => [b, rnd.chance(0.5)]));
    const log = new Map<ZombieBrain, number>();
    brains.forEach(b => spy(b, log));
    const src = {x: 0, y: 0, z: 0};
    alertListeners(brains, src, 30, b => losOf.get(b)!, bases);
    for (const b of brains) {
      const d = Math.hypot(b.x, b.z, b.y);
      if (d > 30) { expect(log.has(b)).toBe(false); continue; }
      expect(log.get(b)).toBe(30 * hearingMuffle(losOf.get(b)!, slabsBetween(bases, 0, b.y)));
    }
  });

  it('with `atrium`: x0.7 per storey through the void, x0.35 per slab; at most 3 new cross-storey responders (nearest first)', () => {
    const src = {x: 0, y: 0, z: 0};
    const same = at(12, 0, 0); // pit, in sight: full 30 m
    const l1 = [6, 8, 10, 12, 14].map(r => at(0, 5, r)); // floor 1 through the void: 7.8 .. 14.9 m 3D, all within 21 m
    const l2far = at(0, 10, 12); // floor 2: 15.6 m 3D > 30 x 0.49 = 14.7 m
    const hunting = at(0, 5, 4); b2Hunt(hunting); // already chasing: hears (its last known spot moves), takes no slot
    const siren = new SirenBrain(0, 3, 0, undefined, true); siren.y = 5; // dormant: ignores hearing, takes no slot
    const all = [same, ...l1, l2far, hunting, siren];
    const log = new Map<ZombieBrain, number>();
    all.forEach(b => spy(b, log));
    alertListeners(all, src, 30, () => true, bases, true);
    expect(same.state).toBe('chase');
    expect(log.get(same)).toBe(30);
    expect(l1.map(b => b.state)).toEqual(['chase', 'chase', 'chase', 'idle', 'idle']); // the 3 nearest only
    expect(log.get(l1[0])).toBeCloseTo(30 * ATRIUM_PERCEPTION.hearOpen, 9);
    expect(l2far.state).toBe('idle');
    expect(log.has(l2far)).toBe(false);
    expect(log.has(hunting)).toBe(true);
    expect(siren.dormant).toBe(true);
    // through a slab (no sight line): the established x0.35 (10.5 m), capped the same way
    const under = [3, 5, 7, 9].map(r => at(r, 5, 0)); // 5.8 .. 10.3 m 3D
    const log2 = new Map<ZombieBrain, number>();
    under.forEach(b => spy(b, log2));
    alertListeners(under, src, 30, () => false, bases, true);
    expect(under.filter(b => b.state === 'chase')).toHaveLength(ATRIUM_PERCEPTION.hearCrossMax);
    expect(log2.get(under[0])).toBeCloseTo(30 * 0.35, 9);
    expect(under[3].state).toBe('idle');
  });
});

function b2Hunt(b: ZombieBrain): void { b.hear(b.x, b.z + 1, 10, b.y); }

describe('horde call after a cross-storey sighting (HordeDirector.alerted)', () => {
  it('a same-storey sighting calls every mate in earshot (unchanged); one of a player on another storey at most callCrossMax', () => {
    const run = (targetDy: number | undefined) => {
      const fx = ringMallFixture({storeys: 3});
      const rules: HordeRules = {...MALL_HORDE_RULES, groups: [1, 1], size: [14, 14], placement: {...MALL_HORDE_RULES.placement, startM: 12, groupSpacingM: 10, routeMPerMember: undefined, startClearM: undefined} as HordeRules['placement']};
      placeHordes(fx.layout, rules, new Rng(2024), {patrol: fx.patrol, ringStoreys: [1, 2]});
      const L = levelsOf(fx.layout);
      const brains = fx.layout.zombies.map(s => { const b = new ZombieBrain(s.type, s.x, s.z, s.yaw); b.y = s.y ?? 0; return b; });
      const d = new HordeDirector(fx.layout, L, i => brains[i], rules.patrol, fx.patrol);
      const caller = d.groups[0].members[0].brain;
      d.alerted(caller, targetDy === undefined ? undefined : caller.y + targetDy);
      return d;
    };
    const plain = run(undefined), same = run(0), across = run(-5);
    expect(plain.callsHeard).toBeGreaterThan(ATRIUM_PERCEPTION.callCrossMax); // the fixture's crowd: several mates within 6 m
    expect(same.callsHeard).toBe(plain.callsHeard);
    expect(across.callsHeard).toBe(ATRIUM_PERCEPTION.callCrossMax);
    expect(across.crossCallsCapped).toBe(plain.callsHeard - ATRIUM_PERCEPTION.callCrossMax);
  });
});

// The generated-mall before / after scenario (horde at the rail, firing at the start) lives in tests/mall-enemy-sample.test.ts, on the
// memoized mall sample it shares with the R8 Siren checks (one set of generations per file).
