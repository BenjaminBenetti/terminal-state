// Task studio-bb-production-20261112-234540-01: BB's behaviour (ai/bb.ts BbBrain) on REAL generated levels, driven as the game drives
// an enemy (tests/helpers/bbSim.ts: brain -> turn -> motor -> separation; the level's own collision as its CrawlWorld).
//
// What is held here: it crawls on walls and ceilings of valid geometry only (never inside or through anything solid, never a
// jump); it knows only what it saw or heard; its attack is the pounce — tell first, one hit at most, a recovery and a cooldown;
// nothing hurts by contact alone; a hard hit knocks it off a perch; a dead one ends on the floor.

import {describe, expect, it} from 'vitest';
import {LEVELS} from '../src/levels/registry';
import type {LevelId} from '../src/levels/types';
import type {StationLayout} from '../src/gen/stationTypes';
import {ZOMBIE_STATS} from '../src/ai/brain';
import {BB_ASSET, BB_BODY, BB_CADENCE, BB_CLIMB, BB_POUNCE, BB_SENSE, BB_STATS, BbBrain, bbRestPose} from '../src/ai/bb';
import {CRAWL, findMounts} from '../src/ai/bbSurface';
import {bbSim, bbStatic, standNear, type BbAudit} from './helpers/bbSim';

const SEED = 1201;
const LEVEL_IDS: LevelId[] = ['subway', 'office', 'mall', 'bunker', 'skyways', 'reactor'];
const layouts = new Map<LevelId, StationLayout>();
const layoutOf = (level: LevelId): StationLayout => {
  let l = layouts.get(level);
  if (!l) layouts.set(level, (l = LEVELS[level].generate('main', {levelSeed: SEED})));
  return l;
};

interface Scene { at: {x: number; z: number; y: number; yaw: number; level?: number}; player: {x: number; z: number; y: number} }
/**
 * Up to `n` scenes on a level: an ordinary spawn point with a wall to climb near it and a place for the player `dist` m away on the
 * same floor with a clear walk line; the BB faces the player.
 */
function scenes(level: LevelId, n: number, dist = 7): Scene[] {
  const layout = layoutOf(level), {L, cw} = bbStatic(layout), out: Scene[] = [];
  for (const s of layout.zombies) {
    if (out.length >= n) break;
    const y = s.y ?? L.grid(s.level ?? 0).floorAt(s.x, s.z);
    if (!findMounts(cw, s.x, y, s.z, BB_CLIMB.mountReachM).length) continue;
    const p = standNear(layout, s.x, s.z, y, dist);
    if (!p || out.some(o => Math.hypot(o.at.x - s.x, o.at.z - s.z) < 12)) continue;
    out.push({at: {x: s.x, z: s.z, y, yaw: Math.atan2(p.x - s.x, p.z - s.z), level: s.level}, player: {x: p.x, z: p.z, y}});
  }
  return out;
}
/**
 * A place for the player near (x, z) on the same floor that cannot be seen from anywhere within 3 m of that spot (a wall between):
 * no sight from any floor point of a 1 m grid round it, at crawling / wall / ceiling eye heights, to the player's head or chest.
 */
function hiddenNear(layout: StationLayout, x: number, z: number, y: number): {x: number; z: number} | null {
  const {L} = bbStatic(layout);
  const eyes: {x: number; y: number; z: number}[] = [];
  for (let gx = -3; gx <= 3; gx++) for (let gz = -3; gz <= 3; gz++) {
    const ex = x + gx, ez = z + gz, s = L.supportIn(ex, ez, y + 0.05, 0.3);
    if (s && Math.abs(s.floor - y) <= 0.2) for (const ey of [0.3, 1.5, 2.5]) eyes.push({x: ex, y: y + ey, z: ez});
  }
  for (const dist of [5, 6.5, 8]) {
    for (let k = 0; k < 24; k++) {
      const a = k / 24 * Math.PI * 2, px = x + Math.sin(a) * dist, pz = z + Math.cos(a) * dist;
      const s = L.supportIn(px, pz, y + 0.05, 0.3);
      if (!s || Math.abs(s.floor - y) > 0.2 || !L.circleClear(px, pz, 0.34, s.floor)) continue;
      if (!eyes.some(e => L.lineOfSight(e, {x: px, y: y + 1.52, z: pz}) || L.lineOfSight(e, {x: px, y: y + 1.07, z: pz}))) return {x: px, z: pz};
    }
  }
  return null;
}

/**
 * The invariants every run must keep. `pushed`: the player kept walking into it — the game's body separation and wall resolve
 * (the floor motor every enemy shares) may then shove it; that is not its own motion.
 */
function clean(A: BbAudit, b: BbBrain, where: string, pushed = false): void {
  const bad = A.events.filter(e => /[A-Z]{4}/.test(e)).slice(0, 3).join(' | ');
  expect(A.inSolid, `${where}: body inside solid geometry: ${bad}`).toBe(0);
  expect(A.crossed, `${where}: moved through solid geometry: ${bad}`).toBe(0);
  expect(A.jumps, `${where}: a step no body could make: ${bad}`).toBe(0);
  if (!pushed) expect(A.shoves, `${where}: shoved across the floor: ${bad}`).toBe(0);
  expect(A.badBasis, `${where}: pose basis not orthonormal`).toBe(0);
  expect(A.maxTurn, `${where}: the pose turned too far in one step: ${A.events.filter(e => / TURN /.test(e)).slice(-2).join(' | ')}`).toBeLessThanOrEqual(14 / 60 + 0.02);
  expect(A.blindSight, `${where}: saw the player through solid geometry`).toBe(0);
  expect(A.freeHits, `${where}: a hit outside a leap`).toBe(0);
  expect(A.doubleHits, `${where}: two hits in one leap`).toBe(0);
  expect(A.earlyLeaps, `${where}: a leap before its wind-up ran its time`).toBe(0);
  expect(A.earlyWindups, `${where}: a wind-up during the cooldown`).toBe(0);
  expect(b.tally.recoveries, `${where}: recovered from an invalid place`).toBe(0);
}

describe('BB: numbers', () => {
  it('is a small, quick, fragile body with one attack — not a scaled zombie', () => {
    const Z = ZOMBIE_STATS.shambler;
    expect(BB_ASSET.heightM).toBeLessThan(1);
    expect(BB_STATS.radius).toBeLessThan(Z.radius);
    expect(BB_STATS.height).toBeLessThan(1);
    expect(BB_STATS.hp).toBeLessThan(Z.hp);
    expect(BB_STATS.chaseSpeed).toBeGreaterThan(Z.chaseSpeed);
    // the base brain's standing swing can neither start nor hit: the pounce is its only attack
    expect(BB_STATS.attackRange).toBe(0);
    expect(BB_STATS.hitRange).toBe(0);
    expect(BB_STATS.attackDamage).toBeLessThanOrEqual(Z.attackDamage);
    // the crawl body is the surface walker's body
    expect(BB_BODY.radius).toBe(CRAWL.radius);
    expect(BB_BODY.centreUp).toBe(CRAWL.lift);
    expect(BB_CLIMB.maxHeightM).toBe(CRAWL.maxHeightM);
  });

  it('stop-start pursuit averages under the player\'s walk; the tell and the recovery are long enough to act on', () => {
    const mean = (r: readonly number[]) => (r[0] + r[1]) / 2;
    const duty = mean(BB_CADENCE.burstS) / (mean(BB_CADENCE.burstS) + mean(BB_CADENCE.freezeS));
    expect(BB_STATS.chaseSpeed * duty).toBeLessThan(3.4);
    expect(BB_STATS.chaseSpeed * duty).toBeGreaterThan(2.5);
    expect(BB_POUNCE.windupS).toBeGreaterThanOrEqual(0.5);
    expect(BB_POUNCE.landS).toBeGreaterThanOrEqual(0.6);
    expect(BB_POUNCE.cooldownS).toBeGreaterThanOrEqual(2.5);
    expect(BB_POUNCE.maxM).toBeLessThanOrEqual(4);
    expect(BB_POUNCE.dropMaxM).toBeLessThanOrEqual(BB_CLIMB.maxHeightM);
    expect(BB_SENSE.stareS).toBeGreaterThan(0);
    const P = bbRestPose(1, 2, 3, Math.PI / 2);
    expect([P.ux, P.uy, P.uz]).toEqual([0, 1, 0]);
    expect(P.fx).toBeCloseTo(1, 9);
    expect(P.fz).toBeCloseTo(0, 9);
    expect(P).toMatchObject({surface: 'floor', phase: 'idle', cackleSeq: 0, twitchSeq: 0, windupSeq: 0, pounceSeq: 0, landSeq: 0});
  });
});

describe('BB: unaware, it perches on walls and ceilings', () => {
  for (const level of LEVEL_IDS) {
    it(`${level}: climbs a real wall, sits up there, comes down again — on valid geometry only, and attacks nobody`, () => {
      const sc = scenes(level, 3);
      expect(sc.length).toBeGreaterThanOrEqual(2);
      let up = 0, mounts = 0, ceilings = 0;
      for (const s of sc) {
        // the player is nowhere near (a far corner of nowhere): nothing to notice
        const sim = bbSim(layoutOf(level), {at: s.at, player: {x: s.at.x + 500, z: s.at.z + 500, y: s.at.y}});
        sim.run(100);
        const A = sim.audit;
        clean(A, sim.b, `${level} calm`);
        expect(sim.b.aware).toBe(false);
        expect(A.windups + A.leaps + A.hits).toBe(0);
        expect(sim.b.pose.cackleSeq).toBe(0);
        up += A.wall + A.ceiling;
        mounts += sim.b.tally.mounts;
        if (A.ceiling > 0) ceilings++;
        // it moves in bursts and freezes
        expect(A.phases.has('crawl') && A.phases.has('freeze') && A.phases.has('idle')).toBe(true);
      }
      expect(mounts).toBeGreaterThanOrEqual(sc.length);
      // most of an unaware BB's time is spent off the floor
      expect(up / 60).toBeGreaterThan(sc.length * 100 * 0.3);
      if (level !== 'mall' && level !== 'reactor') expect(ceilings).toBeGreaterThanOrEqual(1); // (the mall's concourses and the reactor's halls are taller than its climb limit)
    }, 60000);
  }
});

describe('BB: the hunt and the pounce', () => {
  for (const level of LEVEL_IDS) {
    it(`${level}: cackle -> stare -> approach -> wind-up -> leap -> one hit -> recovery -> cooldown`, () => {
      const sc = scenes(level, 2);
      expect(sc.length).toBeGreaterThanOrEqual(1);
      for (const s of sc) {
        const sim = bbSim(layoutOf(level), {at: s.at, player: s.player});
        sim.run(40);
        const A = sim.audit, ev = A.events;
        clean(A, sim.b, `${level} hunt`);
        // the tell comes first: the cackle the moment it sees the player, then a stare before anything else
        expect(ev[0]).toMatch(/cackle$/);
        const first = (re: RegExp) => { const e = ev.find(x => re.test(x)); return e ? parseFloat(e) : NaN; };
        const tCackle = first(/cackle$/), tWind = first(/ windup /), tLeap = first(/ leap$/), tHit = first(/ hit$/), tLand = first(/ land /);
        expect(tWind - tCackle).toBeGreaterThanOrEqual(BB_SENSE.stareS);
        // the wind-up runs its full time before the leap, and the hit can only come inside the leap
        expect(tLeap - tWind).toBeGreaterThanOrEqual(BB_POUNCE.windupS - 1 / 60 - 1e-6);
        expect(tLeap - tWind).toBeLessThan(BB_POUNCE.windupS + 0.05);
        expect(tHit).toBeGreaterThan(tLeap);
        expect(tLand).toBeGreaterThan(tHit);
        expect(tHit - tLeap).toBeLessThanOrEqual(BB_POUNCE.maxFlightS);
        // a standing player is hit by most leaps, never more than once a leap; then it must rest
        expect(A.leaps).toBeGreaterThanOrEqual(4);
        expect(A.hits).toBeLessThanOrEqual(A.leaps);
        expect(A.hits).toBeGreaterThanOrEqual(Math.floor(A.leaps * 0.6));
        expect(A.minRestS).toBeGreaterThanOrEqual(BB_POUNCE.cooldownS - 1e-6);
        // 40 s at one hit per (wind-up + flight + cooldown) at the very most
        expect(A.hits).toBeLessThanOrEqual(Math.ceil(40 / (BB_POUNCE.windupS + BB_POUNCE.cooldownS)));
        expect(A.phases.has('windup') && A.phases.has('pounce') && A.phases.has('land')).toBe(true);
      }
    }, 60000);
  }

  it('it uses the walls and ceilings while it hunts: leaps start from the floor, from walls and from ceilings', () => {
    const from = new Set<string>();
    let offFloor = 0;
    for (const level of ['subway', 'office', 'bunker', 'reactor'] as LevelId[]) {
      for (const s of scenes(level, 3)) {
        const sim = bbSim(layoutOf(level), {at: s.at, player: s.player});
        sim.run(45);
        clean(sim.audit, sim.b, `${level} hunt surfaces`);
        for (const e of sim.audit.events) { const m = / windup on (\w+)/.exec(e); if (m) from.add(m[1]); }
        offFloor += sim.audit.wall + sim.audit.ceiling;
      }
    }
    expect([...from].sort()).toEqual(['ceiling', 'floor', 'wall']);
    expect(offFloor).toBeGreaterThan(600);
  }, 90000);

  it('a sidestep as it launches dodges it; standing still does not', () => {
    const tot = {still: {leaps: 0, hits: 0}, juke: {leaps: 0, hits: 0}};
    for (const level of ['subway', 'office', 'bunker'] as LevelId[]) {
      const layout = layoutOf(level), {L} = bbStatic(layout);
      for (const s of scenes(level, 2)) {
        for (const mode of ['still', 'juke'] as const) {
          const sim = bbSim(layout, {at: s.at, player: s.player});
          let seq = 0, jukeT = 0, dir = 1;
          sim.run(45, 1 / 60, () => {
            if (mode !== 'juke') return;
            const P = sim.player, b = sim.b, dx = P.x - b.x, dz = P.z - b.z, d = Math.hypot(dx, dz) || 1;
            // a sprint to the side for 0.45 s, starting the frame the leap launches
            if (b.pose.pounceSeq !== seq) { seq = b.pose.pounceSeq; jukeT = 0.45; dir = -dir; }
            if (jukeT <= 0) return;
            jukeT -= 1 / 60;
            const nx = P.x - dz / d * 5.8 * dir / 60, nz = P.z + dx / d * 5.8 * dir / 60;
            if (L.circleClear(nx, nz, 0.3, P.y)) { P.x = nx; P.z = nz; } else dir = -dir;
          });
          clean(sim.audit, sim.b, `${level} ${mode}`);
          tot[mode].leaps += sim.audit.leaps;
          tot[mode].hits += sim.audit.hits;
        }
      }
    }
    expect(tot.still.leaps).toBeGreaterThan(20);
    expect(tot.still.hits / tot.still.leaps).toBeGreaterThan(0.85);
    expect(tot.juke.leaps).toBeGreaterThan(20);
    expect(tot.juke.hits / tot.juke.leaps).toBeLessThan(0.4);
  }, 90000);

  it('a player walking into it is never hurt by touch: only a leap hurts, and a dead player is left alone', () => {
    const s = scenes('subway', 1)[0], sim = bbSim(layoutOf('subway'), {at: s.at, player: s.player});
    // the player walks straight at it and keeps pushing into it
    sim.run(20, 1 / 60, () => {
      const P = sim.player, b = sim.b, dx = b.x - P.x, dz = b.z - P.z, d = Math.hypot(dx, dz);
      if (d > 0.3) { P.x += dx / d * 3.4 / 60; P.z += dz / d * 3.4 / 60; }
    });
    clean(sim.audit, sim.b, 'walk into it', true);
    expect(sim.audit.hits).toBeLessThanOrEqual(sim.audit.leaps);
    // now the player is dead: no new wind-up ever begins
    sim.run(2);
    sim.player.alive = false;
    sim.run(1.5); // (a leap already in the air ends)
    const w0 = sim.audit.windups, h0 = sim.audit.hits;
    sim.run(20);
    expect(sim.audit.windups).toBe(w0);
    expect(sim.audit.hits).toBe(h0);
    clean(sim.audit, sim.b, 'dead player', true);
  }, 60000);
});

describe('BB: it knows only what it saw or heard', () => {
  it('a player behind a wall is not noticed, however near; no wind-up, no cackle', () => {
    let tried = 0;
    for (const level of ['office', 'bunker', 'subway'] as LevelId[]) {
      const layout = layoutOf(level);
      for (const s of scenes(level, 4)) {
        const p = hiddenNear(layout, s.at.x, s.at.z, s.at.y);
        if (!p) continue;
        tried++;
        const sim = bbSim(layout, {at: s.at, player: {x: p.x, z: p.z, y: s.at.y}});
        // 5 s of its calm roaming: it stays within the 3 m the hiding place was checked against
        sim.run(5, 1 / 60, () => Math.hypot(sim.b.x - s.at.x, sim.b.z - s.at.z) < 2.9);
        expect(sim.b.aware, `${level}: noticed a player it cannot see`).toBe(false);
        expect(sim.audit.windups + sim.audit.leaps + sim.audit.hits).toBe(0);
        expect(sim.b.pose.cackleSeq).toBe(0);
        expect(sim.b.pose.look).toBeNull();
      }
    }
    expect(tried).toBeGreaterThanOrEqual(3);
  }, 60000);

  it('losing the player, it goes to where it last saw them — not to where they are', () => {
    const level: LevelId = 'office', layout = layoutOf(level);
    let tried = 0;
    for (const s of scenes(level, 4)) {
      const sim = bbSim(layout, {at: s.at, player: s.player});
      sim.run(0.5); // it has seen the player (cackle), still staring
      expect(sim.b.aware).toBe(true);
      const seenAt = {x: sim.player.x, z: sim.player.z};
      // the player is gone: far away, out of sight and silent
      sim.player.x = s.at.x + 500; sim.player.z = s.at.z + 500;
      let nearest = Infinity;
      const w0 = sim.audit.windups;
      sim.run(30, 1 / 60, () => { nearest = Math.min(nearest, Math.hypot(sim.b.x - seenAt.x, sim.b.z - seenAt.z)); });
      clean(sim.audit, sim.b, 'lost player');
      tried++;
      // it went looking where it saw the player ...
      expect(nearest).toBeLessThan(3);
      // ... and never toward the player's real place, 700 m away; with nobody in sight there is nothing to leap at
      expect(Math.hypot(sim.b.x - seenAt.x, sim.b.z - seenAt.z)).toBeLessThan(25);
      expect(sim.audit.windups).toBe(w0);
      expect(sim.b.pose.look).toBeNull();
    }
    expect(tried).toBeGreaterThanOrEqual(2);
  }, 60000);

  it('a noise in earshot wakes it (cackle) and sends it to the NOISE; one out of earshot does nothing', () => {
    const s = scenes('bunker', 1)[0], layout = layoutOf('bunker');
    const far = bbSim(layout, {at: s.at, player: {x: s.at.x + 500, z: s.at.z + 500, y: s.at.y}});
    far.run(0.2);
    far.b.hear(s.player.x, s.player.z, 3, s.at.y); // 7 m away, loud to 3 m only
    far.run(0.2);
    expect(far.b.aware).toBe(false);
    expect(far.b.pose.cackleSeq).toBe(0);
    far.b.hear(s.player.x, s.player.z, 20, s.at.y);
    expect(far.b.aware).toBe(true);
    let nearest = Infinity;
    far.run(15, 1 / 60, () => { nearest = Math.min(nearest, Math.hypot(far.b.x - s.player.x, far.b.z - s.player.z)); });
    expect(far.b.pose.cackleSeq).toBe(1);
    expect(nearest).toBeLessThan(3);
    expect(far.audit.windups).toBe(0); // nobody there to leap at
    clean(far.audit, far.b, 'noise');
  }, 60000);
});

describe('BB: hits on it', () => {
  /** Run a calm BB until it sits on a wall or ceiling. */
  function perched(level: LevelId, index = 0) {
    const s = scenes(level, index + 1)[index];
    const sim = bbSim(layoutOf(level), {at: s.at, player: {x: s.at.x + 500, z: s.at.z + 500, y: s.at.y}});
    sim.run(60, 1 / 60, () => !(sim.b.offFloor && sim.b.doing.settled));
    expect(sim.b.offFloor && sim.b.doing.settled, `${level}: never perched`).toBe(true);
    return {sim, s};
  }

  it('a hard enough hit knocks it off its perch: it falls, lies recovering, and now hunts the shooter\'s place', () => {
    for (const level of ['subway', 'office'] as LevelId[]) {
      const {sim, s} = perched(level);
      const b = sim.b, up = b.centre().y - b.y;
      expect(up).toBeGreaterThan(1);
      expect(b.damage(BB_CLIMB.knockOffDamage - 1, s.player.x, s.player.z, s.at.y)).toBe(false);
      sim.run(0.1);
      expect(b.offFloor && b.pose.surface !== 'air', 'a light hit does not knock it off').toBe(true);
      expect(b.damage(BB_CLIMB.knockOffDamage, s.player.x, s.player.z, s.at.y)).toBe(false);
      sim.run(1 / 60);
      expect(b.pose.surface).toBe('air');
      expect(b.pose.phase).toBe('fall');
      let landed = -1;
      sim.run(3, 1 / 60, t => { if (landed < 0 && b.pose.phase === 'land') landed = t; return landed < 0; });
      expect(landed).toBeGreaterThan(0);
      expect(b.offFloor).toBe(false);
      expect(b.tally.knocks).toBe(1);
      // the recovery lasts its time: it lies there
      const t0 = sim.t;
      sim.run(2, 1 / 60, () => b.pose.phase === 'land');
      expect(sim.t - t0).toBeGreaterThan(BB_POUNCE.landS - 0.05);
      expect(b.alive && b.aware).toBe(true);
      expect(b.pose.cackleSeq).toBe(1);
      clean(sim.audit, b, `${level} knock-off`);
    }
  }, 60000);

  it('killed on a wall or ceiling, the body comes down and ends lying on the floor', () => {
    for (const level of ['subway', 'bunker'] as LevelId[]) {
      const {sim, s} = perched(level);
      const b = sim.b, floor = b.y;
      expect(b.damage(999, s.player.x, s.player.z, s.at.y)).toBe(true);
      expect(b.alive).toBe(false);
      expect(b.climbing).toBe(false);
      sim.run(3);
      expect(b.pose.phase).toBe('dead');
      expect(b.pose.surface).toBe('floor');
      expect(b.pose.y - floor).toBeLessThan(1.3); // on the floor, or on a thing standing on it
      expect(b.pose.uy).toBeGreaterThan(0.99);
      const y0 = b.pose.y;
      sim.run(1);
      expect(b.pose.y).toBe(y0); // at rest
      clean(sim.audit, b, `${level} death`);
    }
  }, 60000);

  it('a flinch on the floor calls the wind-up off', () => {
    // (floor-only: every wind-up is on the floor)
    const s = scenes('subway', 1)[0], sim = bbSim(layoutOf('subway'), {at: s.at, player: s.player, noCrawl: true});
    const b = sim.b;
    sim.run(20, 1 / 60, () => b.pose.phase !== 'windup');
    expect(b.pose.phase).toBe('windup');
    sim.run(0.2);
    const leaps = sim.audit.leaps;
    expect(b.damage(25, s.player.x, s.player.z, s.at.y)).toBe(false);
    expect(b.state).toBe('stagger');
    sim.run(BB_POUNCE.windupS + 0.3);
    expect(sim.audit.leaps, 'the interrupted wind-up still leapt').toBe(leaps);
    expect(b.cooldown).toBeGreaterThan(0);
    clean(sim.audit, b, 'flinch');
  }, 60000);
});

describe('BB: fallbacks and determinism', () => {
  it('without a CrawlWorld it stays on the floor (nothing to climb) and still pounces', () => {
    const s = scenes('office', 1)[0], sim = bbSim(layoutOf('office'), {at: s.at, player: s.player, noCrawl: true});
    sim.run(30);
    expect(sim.b.tally.mounts).toBe(0);
    expect(sim.audit.wall + sim.audit.ceiling).toBe(0);
    expect(sim.audit.leaps).toBeGreaterThanOrEqual(3);
    expect(sim.audit.freeHits + sim.audit.doubleHits + sim.audit.earlyLeaps).toBe(0);
  }, 60000);

  it('the same start gives the same run (its cadence and choices are seeded by its spawn, never by the clock)', () => {
    const s = scenes('bunker', 1)[0];
    const run = () => { const sim = bbSim(layoutOf('bunker'), {at: s.at, player: s.player}); sim.run(30); return {ev: sim.audit.events, x: sim.b.x, z: sim.b.z, tally: {...sim.b.tally}}; };
    expect(run()).toEqual(run());
  }, 60000);
});
