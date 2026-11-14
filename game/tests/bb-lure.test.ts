// Task studio-refinement-scope-finish-20261113-080904-01: the ZOMBIE LURE draws the BB (ai/bb.ts BbBrain) — "BB must respond to the
// Zombie Lure's real scent emitter within 20 m, without a line-of-sight requirement, for its 20-active-second duration, using valid
// surface/navigation behaviour", under the lure's normal priority rules, with its non-lure AI unchanged. Task
// studio-scanner-console-refinements-20261114-031614-01 raised the lure's reach to 30 m ("Existing BB floor/perch scent support must
// continue using the common radius"): the reach below is the common SCENT.radius, whatever it is.
//
// Real generated levels, driven as the game drives an enemy (tests/helpers/bbSim.ts with `scents`: the game's lure world fields, the
// registry's active list, its tick after every step) and audited every step (bbClean: never inside or through anything solid, no jump,
// no forced or recovered placement):
//  - a BB on the floor and one perched on a wall / ceiling, 8-15 m from a canister they cannot see, come to it inside the scent's 20
//    active seconds (the perched one comes down first) and stay there while it lasts — on valid geometry only, never noticing anyone;
//  - when the scent runs out it lingers, then roams and perches again;
//  - priorities: a BB that sees the player keeps hunting it; one that lost sight of the player is pulled after SCENT.lostSightS; a
//    fresh noise is hunted first for SCENT.alertHoldS;
//  - out of reach (> SCENT.radius in 3D) nothing happens, and a scent out of reach changes nothing at all: the same run step for step as
//    with no scent (its non-lure behaviour is untouched).

import {describe, expect, it} from 'vitest';
import {LEVELS} from '../src/levels/registry';
import type {LevelId} from '../src/levels/types';
import type {StationLayout} from '../src/gen/stationTypes';
import {BB_BODY, BB_CLIMB} from '../src/ai/bb';
import {findMounts} from '../src/ai/bbSurface';
import {LURE} from '../src/ai/lightLure';
import {SCENT, ScentLures, type ScentEmitter} from '../src/ai/scentLure';
import {bbClean, bbSim, bbStatic, standNear} from './helpers/bbSim';

const SEED = 1201;
const LEVEL_IDS: LevelId[] = ['subway', 'office', 'bunker'];
const DT = 1 / 60;
const layouts = new Map<LevelId, StationLayout>();
const layoutOf = (level: LevelId): StationLayout => {
  let l = layouts.get(level);
  if (!l) layouts.set(level, (l = LEVELS[level].generate('main', {levelSeed: SEED})));
  return l;
};

/** Far off the map: nobody to notice. */
const away = (x: number, z: number, y: number) => ({x: x + 500, z: z + 500, y});

/**
 * A canister spot on the floor `minD`..`maxD` m from (x, y, z) that cannot be seen from there (a wall or a prop between) and that the
 * BB can walk to (a ladder-free route of at most `maxRoute` m), or null.
 */
function canisterSpot(layout: StationLayout, x: number, y: number, z: number, minD: number, maxD: number, maxRoute = 18): {x: number; y: number; z: number} | null {
  const {L, pf} = bbStatic(layout);
  for (let d = minD; d <= maxD; d += 1.5) for (let k = 0; k < 24; k++) {
    const a = k / 24 * Math.PI * 2, px = x + Math.sin(a) * d, pz = z + Math.cos(a) * d;
    const s = L.supportIn(px, pz, y + 0.05, 0.3);
    if (!s || Math.abs(s.floor - y) > 0.2 || !L.circleClear(px, pz, 0.34, s.floor)) continue;
    if (L.lineOfSight({x, y: y + 0.4, z}, {x: px, y: s.floor + 0.3, z: pz}) || L.lineOfSight({x, y: y + 2.5, z}, {x: px, y: s.floor + 0.3, z: pz})) continue;
    const path = pf.find(x, z, px, pz, 0.34, 26000, {noLinks: true, drops: true, ay: y, by: s.floor});
    if (!path) continue;
    let len = 0, qx = x, qz = z;
    for (const w of path) { len += Math.hypot(w[0] - qx, w[1] - qz); qx = w[0]; qz = w[1]; }
    if (len <= maxRoute) return {x: px, y: s.floor, z: pz};
  }
  return null;
}

/** Spawn points of a level with a wall to climb near them (BB perches), at least 12 m apart. */
function starts(level: LevelId, n: number): {x: number; y: number; z: number; level?: number}[] {
  const layout = layoutOf(level), {L, cw} = bbStatic(layout), out: {x: number; y: number; z: number; level?: number}[] = [];
  for (const s of layout.zombies) {
    if (out.length >= n) break;
    const y = s.y ?? L.grid(s.level ?? 0).floorAt(s.x, s.z);
    if (!findMounts(cw, s.x, y, s.z, BB_CLIMB.mountReachM).length || out.some(o => Math.hypot(o.x - s.x, o.z - s.z) < 12)) continue;
    if (!canisterSpot(layout, s.x, y, s.z, 8, 15)) continue;
    out.push({x: s.x, y, z: s.z, level: s.level});
  }
  return out;
}

/** At the canister: following its scent, standing (hold) within the investigation's stop distance. */
const holding = (b: ReturnType<typeof bbSim>['b'], e: ScentEmitter): boolean =>
  b.state === 'investigate' && b.lure?.kind === 'scent' && b.lure.lightId === e.id && b.lure.phase === 'hold' && Math.hypot(b.x - e.x, b.z - e.z) < b.lure.stop + 0.05;

describe('BB and the Zombie Lure: drawn to the canister', () => {
  for (const level of LEVEL_IDS) {
    it(`${level}: on the floor or perched on a wall / ceiling, it comes to a canister it cannot see within the 20 active seconds and stays there — on valid geometry only`, () => {
      const layout = layoutOf(level), sc = starts(level, 2);
      expect(sc.length, `${level}: no scene`).toBeGreaterThanOrEqual(1);
      let floorRuns = 0, perchedRuns = 0;
      for (const s of sc) {
        for (const perched of [false, true]) {
          const scents = new ScentLures();
          const sim = bbSim(layout, {at: {x: s.x, z: s.z, y: s.y, yaw: 0, level: s.level}, player: away(s.x, s.z, s.y), scents});
          const b = sim.b;
          if (perched) {
            sim.run(60, DT, () => !(b.offFloor && b.doing.settled));
            if (!(b.offFloor && b.doing.settled)) continue;
          }
          const c = canisterSpot(layout, b.x, b.y, b.z, 8, 15);
          if (!c) continue;
          if (perched) perchedRuns++; else floorRuns++; // counted only once a scene is really run and checked
          const e = scents.add({x: c.x, y: c.y + 0.05, z: c.z});
          expect(Math.hypot(e.x - b.x, e.y - b.y, e.z - b.z)).toBeLessThanOrEqual(SCENT.radius);
          const where = `${level} ${s.x.toFixed(1)},${s.z.toFixed(1)}${perched ? ' perched' : ''}`;
          const mounts0 = b.tally.mounts;
          let arrived = -1;
          sim.run(SCENT.seconds - 0.05, DT, t => { if (arrived < 0 && holding(b, e)) arrived = t; });
          bbClean(sim.audit, b, where);
          expect(e.active, `${where}: the scent still lasts`).toBe(true);
          expect(arrived, `${where}: never stood at the canister (state ${b.state}, ${JSON.stringify(b.lure)})`).toBeGreaterThan(0);
          expect(holding(b, e), `${where}: left the canister while the scent lasted`).toBe(true);
          if (perched) expect(b.lureDowns, `${where}: it came down because of the scent`).toBeGreaterThanOrEqual(1);
          expect(b.tally.mounts, `${where}: climbed while drawn`).toBe(mounts0);
          expect(b.offFloor).toBe(false);
          // a scent is not the player: it noticed nobody, it attacked nobody
          expect(b.aware).toBe(false);
          expect(b.pose.cackleSeq).toBe(0);
          expect(sim.audit.windups + sim.audit.leaps + sim.audit.hits).toBe(0);
          expect(b.scentStarts).toBe(1);
        }
      }
      expect(floorRuns, `${level}: no floor scene checked`).toBeGreaterThanOrEqual(1);
      expect(perchedRuns, `${level}: no perched scene checked`).toBeGreaterThanOrEqual(1);
    }, 120000);
  }

  it('the scent runs out after its 20 active seconds: it lingers, then roams and perches again', () => {
    const level: LevelId = 'office', layout = layoutOf(level), s = starts(level, 1)[0];
    const scents = new ScentLures();
    const sim = bbSim(layout, {at: {x: s.x, z: s.z, y: s.y, yaw: 0, level: s.level}, player: away(s.x, s.z, s.y), scents});
    const b = sim.b, c = canisterSpot(layout, s.x, s.y, s.z, 8, 15)!;
    const e = scents.add({x: c.x, y: c.y + 0.05, z: c.z});
    sim.run(SCENT.seconds - 0.05);
    expect(e.active).toBe(true);
    expect(holding(b, e)).toBe(true);
    sim.run(0.1);
    expect(e.active).toBe(false); // 20 ticked seconds
    expect(scents.list).toEqual([]);
    const tEnd = sim.t;
    sim.run(SCENT.lostGrace + LURE.period * 1.2 + LURE.linger + LURE.lingerJitter + 0.5, DT, () => b.state === 'investigate');
    expect(b.state === 'idle' || b.state === 'wander', `still ${b.state}`).toBe(true);
    expect(b.lure).toBeNull();
    expect(sim.t - tEnd).toBeGreaterThanOrEqual(LURE.linger - 0.05); // it lingered by the canister first
    // its ordinary behaviour again: it roams and climbs to a perch (BB_CLIMB.floorS)
    const m0 = b.tally.mounts;
    let investigated = false;
    sim.run(40, DT, () => { if (b.state === 'investigate') investigated = true; return b.tally.mounts === m0; });
    expect(b.tally.mounts).toBeGreaterThan(m0);
    expect(investigated, 'a phantom lure').toBe(false);
    bbClean(sim.audit, b, 'after the scent');
  }, 120000);
});

describe('BB and the Zombie Lure: priorities and reach', () => {
  it('a BB that sees the player keeps hunting it, scent or not', () => {
    const level: LevelId = 'subway', layout = layoutOf(level);
    let tried = 0;
    for (const s of starts(level, 2)) {
      const p = standNear(layout, s.x, s.z, s.y, 7);
      const c = canisterSpot(layout, s.x, s.y, s.z, 8, 15);
      if (!p || !c) continue;
      tried++;
      const scents = new ScentLures();
      scents.add({x: c.x, y: c.y + 0.05, z: c.z}, {seconds: 60});
      const sim = bbSim(layout, {at: {x: s.x, z: s.z, y: s.y, yaw: Math.atan2(p.x - s.x, p.z - s.z), level: s.level}, player: {x: p.x, z: p.z, y: s.y}, scents});
      let lured = false;
      sim.run(12, DT, () => { if (sim.b.state === 'investigate' || sim.b.lureDowns > 0) lured = true; });
      bbClean(sim.audit, sim.b, `${level} seen`);
      expect(lured, 'drawn away from a player in sight').toBe(false);
      expect(sim.b.pose.cackleSeq).toBeGreaterThanOrEqual(1);
      expect(sim.audit.windups).toBeGreaterThanOrEqual(1);
    }
    expect(tried).toBeGreaterThanOrEqual(1);
  }, 120000);

  it('a BB coming down off its perch for a scent that then sees the player hunts it at once: no further pull while it sees them or lost them < SCENT.lostSightS ago', () => {
    let tried = 0;
    for (const level of LEVEL_IDS) {
      const layout = layoutOf(level);
      for (const s of starts(level, 3)) {
        const scents = new ScentLures();
        const sim = bbSim(layout, {at: {x: s.x, z: s.z, y: s.y, yaw: 0, level: s.level}, player: away(s.x, s.z, s.y), scents});
        const b = sim.b;
        sim.run(60, DT, () => !(b.offFloor && b.doing.settled));
        if (!(b.offFloor && b.doing.settled)) continue;
        const c = canisterSpot(layout, b.x, b.y, b.z, 8, 15);
        if (!c) continue;
        scents.add({x: c.x, y: c.y + 0.05, z: c.z});
        sim.run(5, DT, () => !(b.lureDowns > 0));
        if (!(b.lureDowns > 0 && b.offFloor)) continue;
        // the player steps out where it can see them from where it clings
        const P = b.pose, eye = {x: P.x + P.ux * BB_BODY.eyeUp, y: P.y + P.uy * BB_BODY.eyeUp, z: P.z + P.uz * BB_BODY.eyeUp};
        let spot: {x: number; z: number} | null = null;
        for (let d = 2.5; d <= 7 && !spot; d += 1.5) for (let k = 0; k < 16 && !spot; k++) {
          const q = standNear(layout, b.x + Math.sin(k / 16 * Math.PI * 2) * d, b.z + Math.cos(k / 16 * Math.PI * 2) * d, b.y, 0.01, false);
          if (q && sim.L.lineOfSight(eye, {x: q.x, y: b.y + 1.5, z: q.z}) && sim.L.lineOfSight(eye, {x: q.x, y: b.y + 1.0, z: q.z})) spot = q;
        }
        if (!spot) continue;
        Object.assign(sim.player, {x: spot.x, z: spot.z, y: b.y, eye: b.y + 1.62});
        const downs0 = b.lureDowns, where = `${level} ${s.x.toFixed(1)},${s.z.toFixed(1)}`;
        let lastSeen = -Infinity, sawAt = -1, hunted = false, badPull = '';
        sim.run(6, DT, t => {
          if (b.seeing) { lastSeen = t; if (sawAt < 0) sawAt = t; }
          // it goes for them: a hunt on its surface, a chase on the floor, a wind-up (then it may leap and retreat up a wall as usual)
          if (sawAt >= 0 && (b.doing.plan === 'hunt' || (!b.offFloor && b.state === 'chase') || sim.audit.windups > 0)) hunted = true;
          if (b.lureDowns > downs0 && t - lastSeen < SCENT.lostSightS && !badPull) badPull = `${t.toFixed(2)} (last saw ${lastSeen.toFixed(2)})`;
          if (b.state === 'investigate' && t - lastSeen < SCENT.lostSightS && !badPull) badPull = `investigating ${t.toFixed(2)}`;
        });
        if (sawAt < 0) continue; // it never looked their way: not this scene's case
        tried++;
        bbClean(sim.audit, b, where);
        expect(badPull, `${where}: pulled by the scent while it saw the player`).toBe('');
        expect(b.aware, `${where}: noticed the player`).toBe(true);
        expect(hunted, `${where}: went for the player (plan ${b.doing.plan}, state ${b.state}): ${sim.audit.events.slice(-12).join(' | ')}`).toBe(true);
      }
    }
    expect(tried, 'no perched BB saw the player while coming down').toBeGreaterThanOrEqual(1);
  }, 180000);

  it('a BB that lost sight of the player is pulled after SCENT.lostSightS — never toward the player', () => {
    const level: LevelId = 'office', layout = layoutOf(level);
    let tried = 0;
    for (const s of starts(level, 2)) {
      const p = standNear(layout, s.x, s.z, s.y, 7);
      if (!p) continue;
      const scents = new ScentLures();
      const sim = bbSim(layout, {at: {x: s.x, z: s.z, y: s.y, yaw: Math.atan2(p.x - s.x, p.z - s.z), level: s.level}, player: {x: p.x, z: p.z, y: s.y}, scents});
      const b = sim.b;
      sim.run(0.5); // it has seen the player (cackle)
      expect(b.aware).toBe(true);
      const c = canisterSpot(layout, b.x, b.y, b.z, 8, 15);
      if (!c) continue;
      tried++;
      // the player is gone: far away, out of sight and silent; a canister opens
      sim.player.x = s.x + 500; sim.player.z = s.z + 500;
      const t0 = sim.t;
      const e = scents.add({x: c.x, y: c.y + 0.05, z: c.z}, {seconds: 60});
      // the first pull: off a wall it took after the player (lureDowns), or on the floor (investigate)
      let pulled = -1;
      sim.run(SCENT.lostSightS + 8, DT, t => { if (pulled < 0 && (b.lureDowns > 0 || b.state === 'investigate')) pulled = t; return b.state !== 'investigate'; });
      expect(b.state).toBe('investigate');
      expect(b.lure).toMatchObject({kind: 'scent', lightId: e.id});
      expect(pulled - t0).toBeGreaterThanOrEqual(SCENT.lostSightS - DT);
      expect(pulled - t0).toBeLessThan(SCENT.lostSightS + 1.5); // (the next check: LURE.period x 1.2, or a short act first)
      sim.run(30, DT, () => !holding(b, e));
      expect(holding(b, e)).toBe(true);
      bbClean(sim.audit, b, `${level} lost sight`);
    }
    expect(tried).toBeGreaterThanOrEqual(1);
  }, 120000);

  it('a fresh noise is hunted first: the scent pulls only SCENT.alertHoldS after it', () => {
    const level: LevelId = 'bunker', layout = layoutOf(level), s = starts(level, 1)[0];
    const scents = new ScentLures();
    const sim = bbSim(layout, {at: {x: s.x, z: s.z, y: s.y, yaw: 0, level: s.level}, player: away(s.x, s.z, s.y), scents});
    const b = sim.b, c = canisterSpot(layout, s.x, s.y, s.z, 8, 15)!;
    scents.add({x: c.x, y: c.y + 0.05, z: c.z}, {seconds: 60});
    sim.run(0.1);
    const t0 = sim.t;
    b.hear(s.x + 3, s.z, 20, s.y); // a shot close by
    expect(b.aware).toBe(true);
    sim.run(SCENT.alertHoldS + 2, DT, () => b.state !== 'investigate');
    expect(b.state).toBe('investigate');
    expect(sim.t - t0).toBeGreaterThanOrEqual(SCENT.alertHoldS - DT);
    bbClean(sim.audit, b, `${level} noise first`);
  }, 120000);

  it('reach: the common radius (30 m) — 2 m inside it (3D, through walls, beyond the old 20 m) it is drawn, 2 m beyond it it is not', () => {
    expect(SCENT.radius).toBe(30);
    for (const level of LEVEL_IDS) {
      const layout = layoutOf(level), {L} = bbStatic(layout);
      /** A floor spot on the same storey `d` m from `s` (straight 3D), or null. */
      const at = (s: {x: number; y: number; z: number}, d: number): {x: number; y: number; z: number} | null => {
        for (let k = 0; k < 48; k++) {
          const a = k / 48 * Math.PI * 2, px = s.x + Math.sin(a) * d, pz = s.z + Math.cos(a) * d, q = L.supportIn(px, pz, s.y + 0.05, 0.3);
          if (q && Math.abs(q.floor - s.y) <= 0.2) return {x: px, y: q.floor, z: pz};
        }
        return null;
      };
      // a spawn point with floor on its own storey both 28 m and 32 m away (30 m is more than half of a smaller level: the first
      // spawn may stand mid-building)
      let s: {x: number; y: number; z: number; level?: number} | null = null, spots: {x: number; y: number; z: number}[] = [];
      for (const q of layout.zombies) {
        const y = q.y ?? L.grid(q.level ?? 0).floorAt(q.x, q.z), c = {x: q.x, y, z: q.z, level: q.level};
        const inside = at(c, SCENT.radius - 2), beyond = at(c, SCENT.radius + 2);
        if (inside && beyond) { s = c; spots = [inside, beyond]; break; }
      }
      expect(s, `${level}: no spawn with floor ${SCENT.radius - 2} / ${SCENT.radius + 2} m away`).not.toBeNull();
      for (const [i, drawn] of [[0, true], [1, false]] as const) {
        const p = spots[i], d = Math.hypot(p.x - s!.x, p.y - s!.y, p.z - s!.z);
        expect(d > SCENT.radius, `${level}: ${d.toFixed(1)} m`).toBe(!drawn);
        const scents = new ScentLures();
        scents.add({x: p.x, y: p.y + 0.05, z: p.z}, {seconds: 60});
        const sim = bbSim(layout, {at: {x: s!.x, z: s!.z, y: s!.y, yaw: 0, level: s!.level}, player: away(s!.x, s!.z, s!.y), scents});
        sim.run(1.2); // (an unaware one idles a moment before it roams: it is still where it started)
        expect(sim.b.state === 'investigate', `${level}: ${d.toFixed(1)} m`).toBe(drawn);
        expect(sim.b.scentChecks).toBeGreaterThanOrEqual(2);
      }
    }
  }, 120000);

  it('a scent out of reach changes nothing: step for step the run with no scent at all (its non-lure behaviour is untouched)', () => {
    for (const level of ['subway', 'office'] as LevelId[]) {
      const layout = layoutOf(level), s = starts(level, 1)[0];
      // a canister far across the map: at the spawn point furthest from the start
      let far: {x: number; y: number; z: number} | null = null, fd = 0;
      for (const q of layout.zombies) {
        const d = Math.hypot(q.x - s.x, q.z - s.z), y = q.y ?? bbStatic(layout).L.grid(q.level ?? 0).floorAt(q.x, q.z);
        if (d > fd) { fd = d; far = {x: q.x, y, z: q.z}; }
      }
      expect(fd, `${level}: no far spot`).toBeGreaterThan(40);
      const trace = (scents?: ScentLures) => {
        const sim = bbSim(layout, {at: {x: s.x, z: s.z, y: s.y, yaw: 0, level: s.level}, player: away(s.x, s.z, s.y), ...(scents ? {scents} : {})});
        const poses: string[] = [];
        let nearest = Infinity;
        sim.run(40, DT, () => {
          const P = sim.b.pose;
          poses.push(`${P.x.toFixed(5)},${P.y.toFixed(5)},${P.z.toFixed(5)},${P.phase},${P.surface}`);
          if (far) nearest = Math.min(nearest, Math.hypot(sim.b.x - far.x, sim.b.y - far.y, sim.b.z - far.z));
        });
        return {poses, events: sim.audit.events, tally: {...sim.b.tally}, starts: sim.b.scentStarts, nearest, sim};
      };
      const none = trace();
      const empty = trace(new ScentLures());
      const scents = new ScentLures();
      const e = scents.add(far!, {seconds: 60});
      const out = trace(scents);
      expect(empty.poses).toEqual(none.poses);
      // the BB roams and perches in both; it was never within the scent's reach, so it never followed it
      expect(out.nearest).toBeGreaterThan(SCENT.radius);
      expect(out.starts).toBe(0);
      expect(out.sim.b.lureDowns).toBe(0);
      expect(e.active).toBe(true);
      expect(out.poses).toEqual(none.poses);
      expect(out.events).toEqual(none.events);
      expect(out.tally).toEqual(none.tally);
      expect(none.tally.mounts).toBeGreaterThanOrEqual(1);
      expect(out.sim.b.scentChecks).toBeGreaterThan(10); // it did smell for it, all along
    }
  }, 120000);
});
