// Task studio-screacher-production-20261110-221858-01: THE SCREACHER'S BRAIN (ai/screacher.ts ScreacherBrain) — blind, sound-driven,
// with a periodic echo scan. User: "cannot see, only reacts to sound (player bumping things, firing gun, running). Moves towards last
// sound. Multiple quick sounds -> quite fast / aggressive. Player can sneak by or fight head on. Screams about once [per] 60 seconds
// for echolocation." (the echo locates the player in range but not through walls: one snapshot, no continuous tracking).
// Pure Node: the real brain driven through a small BrainWorld on an open floor; the motor below is the game's turn + move rule.
import {describe, expect, it} from 'vitest';
import {ZombieBrain, alertListeners, type BrainOutput, type BrainWorld} from '../src/ai/brain';
import {
  SCREACHER_AGGRO, SCREACHER_ECHO, SCREACHER_NOISE, SCREACHER_SENSE, SCREACHER_SPEED, SCREACHER_STATS, ScreacherBrain, deliverNoise, impactNoise, landNoise,
} from '../src/ai/screacher';

const DT = 1 / 60;
interface Sim { px: number; pz: number; py?: number; alive?: boolean; echo?: (x: number, y: number, z: number, range: number) => {x: number; z: number; y: number} | null; los?: boolean; paths?: unknown[];
  /** No wander target is ever found: an idle one stays where it stands. */
  still?: boolean }
function world(s: Sim): BrainWorld {
  return {
    px: s.px, pz: s.pz, py: s.py ?? 0, playerAlive: s.alive ?? true,
    los: () => s.los ?? true,
    walkClear: () => true,
    findPath: (_ax, _az, bx, bz, opts) => { s.paths?.push(opts); return [[bx, bz, undefined, 0]]; },
    randomNear: (x, z) => (s.still ? null : [x + 1.5, z + 1.5]),
    rand: () => 0.5,
    ...(s.echo ? {echo: s.echo} : {}),
  };
}
/** One frame: the brain, then the game's turn rule and a straight move (open floor). */
function step(b: ScreacherBrain | ZombieBrain, s: Sim, dt = DT): BrainOutput {
  const out = b.update(dt, world(s));
  if (out.face !== null) {
    let d = out.face - b.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    const turn = (b.state === 'attack' ? Math.max(7, b.stats.turnRate ?? 0) : b.stats.turnRate ?? 4.5) * dt;
    b.yaw += Math.max(-turn, Math.min(turn, d));
  }
  b.x += out.dirX * out.speed * dt;
  b.z += out.dirZ * out.speed * dt;
  return out;
}
const run = (b: ScreacherBrain, s: Sim, seconds: number, each?: (out: BrainOutput, t: number) => void): void => {
  for (let t = 0; t < seconds; t += DT) each ? each(step(b, s), t) : step(b, s);
};
/** A Screacher whose first scream is far away in time (so a test of something else is not interrupted). */
const quiet = (x = 0, z = 0, yaw = 0): ScreacherBrain => { const b = new ScreacherBrain(x, z, yaw); b.echoT = 1e6; return b; };

describe('Screacher brain: it cannot see', () => {
  it('published stats: blind (sightRange 0), a long reach, no head-related number anywhere', () => {
    expect(SCREACHER_STATS.sightRange).toBe(0);
    expect(SCREACHER_STATS.attackRange).toBeGreaterThan(1.35);
    expect(SCREACHER_STATS.chaseSpeed).toBe(SCREACHER_SPEED.frenzy);
    expect(SCREACHER_SPEED.investigate).toBeLessThan(SCREACHER_SPEED.hunt);
    expect(SCREACHER_SPEED.hunt).toBeLessThan(SCREACHER_SPEED.frenzy);
    expect(SCREACHER_SPEED.frenzy).toBeGreaterThan(3.4); // faster than a walking player (3.4 m/s) ...
    expect(SCREACHER_SPEED.frenzy).toBeLessThan(5.8); // ... slower than a sprinting one (5.8 m/s)
  });

  it('a silent player in plain view (in front of it, in the open, for 40 s) is never noticed', () => {
    const b = quiet(0, 0, 0);
    const s: Sim = {px: 0, pz: 4};
    let chased = 0, alerted = 0;
    run(b, s, 40, out => { if (b.state === 'chase' || b.state === 'attack') chased++; if (out.alerted) alerted++; });
    expect([chased, alerted, b.belief, b.aware]).toEqual([0, 0, null, false]);
  });

  it('its whole behaviour is independent of where a silent player is (outside touch): two different player paths, identical brain', () => {
    const trace = (path: (t: number) => [number, number]): string => {
      const b = quiet(0, 0, 0);
      const rows: string[] = [];
      b.hearNoise(6, 6, 20, 0, 'impact'); // the same sound in both runs
      for (let t = 0; t < 30; t += DT) {
        const [px, pz] = path(t);
        const out = step(b, {px, pz});
        rows.push([b.x.toFixed(5), b.z.toFixed(5), b.yaw.toFixed(5), b.state, out.anim, out.speed.toFixed(3), out.attackHit].join(','));
      }
      return rows.join('|');
    };
    const a = trace(t => [-12 + t * 0.3, 9]); // strolling past on one side
    const c = trace(t => [14, -20 + t * 1.1]); // somewhere else entirely, moving the other way
    expect(a).toBe(c);
  });

  it('no light lure and no sight line is ever asked of the world: the sub-world has no lights and answers los from the belief only', () => {
    const b = quiet(0, 0, 0);
    let losCalls = 0;
    const w: BrainWorld = {...world({px: 0, pz: 3}), los: () => { losCalls++; return true; }, lights: [{id: 1} as never], seePoint: () => { throw new Error('seePoint must never be called'); }};
    for (let i = 0; i < 600; i++) b.update(DT, w);
    expect(losCalls).toBe(0); // the real world line is only tested at a swing's impact frame
    expect(b.lureStarts).toBe(0);
  });
});

describe('Screacher brain: sound', () => {
  it('walks to the SOURCE of a heard sound (not to the player), swings at that spot, finds nothing and searches', () => {
    const b = quiet(0, 0, 0);
    const s: Sim = {px: -10, pz: 10}; // the player is somewhere else, silent
    expect(b.hearNoise(8, 0, 12, 0, 'impact')).toBe(true);
    expect(b.belief).toMatchObject({x: 8, z: 0, kind: 'impact'});
    expect(b.state).toBe('chase');
    const d0 = Math.hypot(b.x - 8, b.z);
    let walked = 0, hits = 0, swings = 0, maxSpeed = 0, anims = new Set<string>();
    const seq0 = b.attackSeq;
    run(b, s, 12, out => { if (out.speed > 0) { walked++; maxSpeed = Math.max(maxSpeed, out.speed); if (b.state === 'chase') anims.add(out.anim); } if (out.attackHit) hits++; });
    swings = b.attackSeq - seq0;
    expect(walked).toBeGreaterThan(60);
    expect(Math.hypot(b.x - 8, b.z)).toBeLessThan(d0 - 4); // it went to the sound
    expect(Math.hypot(b.x - s.px, b.z - s.pz)).toBeGreaterThan(8); // not to the player
    expect(anims).toEqual(new Set(['Walk'])); // one sound: the stalking walk
    expect(swings).toBe(1); // it struck the spot once ...
    expect(hits).toBe(0); // ... and hit nothing: the player was never there
    expect(b.belief).toBeNull();
    expect(['search', 'idle', 'wander']).toContain(b.state);
  });

  it('out of earshot = not heard; the caller\'s muffled radius decides (3D distance)', () => {
    const b = quiet(0, 0, 0);
    expect(b.hearNoise(20, 0, 11, 0, 'run')).toBe(false);
    expect(b.hearNoise(6, 0, 11, 8, 'run')).toBe(true); // hypot(6, 8) = 10 <= 11
    const c = quiet(0, 0, 0);
    expect(c.hearNoise(6, 0, 9.9, 8, 'run')).toBe(false);
    expect([b.heard, c.heard]).toEqual([1, 0]);
  });

  it('multiple quick DISTINCT sounds make it fast: one = investigate, two shots = hunt, three = frenzy (run pace + a shriek)', () => {
    const b = quiet(0, 0, 0);
    const s: Sim = {px: 30, pz: 30};
    b.hearNoise(20, 0, 40, 0, 'gunshot');
    step(b, s);
    expect(b.tier).toBe('investigate');
    run(b, s, 0.4);
    b.hearNoise(20, 0, 40, 0, 'gunshot');
    step(b, s);
    expect(b.tier).toBe('hunt');
    run(b, s, 0.4);
    const shrieks = b.shriekSeq;
    b.hearNoise(20, 0, 40, 0, 'gunshot');
    const out = step(b, s);
    expect(b.tier).toBe('frenzy');
    expect(b.shriekSeq).toBe(shrieks + 1);
    expect(out.speed).toBe(SCREACHER_SPEED.frenzy);
    expect(out.anim).toBe('Run');
    expect(b.heat).toBeLessThanOrEqual(SCREACHER_AGGRO.heatMax);
  });

  it('one event is one sound: nine contacts in the same instant (pellets, one crash) add the heat of ONE; heat is capped', () => {
    const b = quiet(0, 0, 0);
    for (let i = 0; i < 9; i++) b.hearNoise(5, 0, 12, 0, 'impact');
    expect(b.counted).toBe(1);
    expect(b.heat).toBe(SCREACHER_AGGRO.weight.impact);
    // sustained full-auto fire (10 shots / s for 5 s) counts only distinct sounds and never passes the cap
    const s: Sim = {px: 30, pz: 30};
    for (let k = 0; k < 50; k++) { b.hearNoise(5, 0, 40, 0, 'gunshot'); run(b, s, 0.1); }
    expect(b.heat).toBeLessThanOrEqual(SCREACHER_AGGRO.heatMax);
    expect(b.counted).toBeLessThan(30);
    expect(b.tier).toBe('frenzy');
  });

  it('a sprint of about a second is enough for a frenzy; walking / crouching raise no event at all (the game reports none)', () => {
    const b = quiet(0, 0, 0);
    const s: Sim = {px: 8, pz: 0};
    for (let k = 0; k < 4; k++) { b.hearNoise(8, 0, SCREACHER_NOISE.run, 0, 'run'); run(b, s, 0.26); } // 4 sprint steps (3.9 / s)
    expect(b.tier).toBe('frenzy');
  });

  it('quiet cools it down: about ten seconds of silence bring a frenzied one back to the calm tier', () => {
    const b = quiet(0, 0, 0);
    const s: Sim = {px: 40, pz: 40};
    for (let k = 0; k < 4; k++) { b.hearNoise(30, 0, 60, 0, 'gunshot'); run(b, s, 0.3); }
    expect(b.tier).toBe('frenzy');
    run(b, s, SCREACHER_AGGRO.quietHoldS - 0.5);
    expect(b.tier).toBe('frenzy'); // the hold
    run(b, s, 4);
    expect(b.tier).not.toBe('frenzy');
    run(b, s, 6);
    expect(b.tier).toBe('investigate');
    expect(b.heat).toBe(0);
  });

  it('a quieter sound right after a gunshot does not move the belief (its ricochet / debris); later it does', () => {
    const b = quiet(0, 0, 0);
    const s: Sim = {px: 30, pz: 30};
    b.hearNoise(10, 0, 40, 0, 'gunshot');
    run(b, s, 0.3);
    b.hearNoise(-6, 3, 12, 0, 'impact');
    expect(b.belief).toMatchObject({x: 10, z: 0, kind: 'gunshot'});
    run(b, s, SCREACHER_SENSE.holdS);
    b.hearNoise(-6, 3, 12, 0, 'impact');
    expect(b.belief).toMatchObject({x: -6, z: 3, kind: 'impact'});
    // an equal or louder class always replaces
    b.hearNoise(4, 4, 40, 0, 'gunshot');
    expect(b.belief).toMatchObject({x: 4, z: 4, kind: 'gunshot'});
  });

  it('gunfire reaches it through the game\'s existing alertListeners (the shooter\'s position is the sound source)', () => {
    const b = quiet(0, 0, 0), z = new ZombieBrain('shambler', 2, 2, 0);
    alertListeners([b, z], {x: 12, y: 0, z: 0}, 30, () => true, null);
    expect(b.belief).toMatchObject({x: 12, z: 0, kind: 'gunshot'});
    expect(b.state).toBe('chase');
    expect(z.state).toBe('chase'); // the ordinary zombie hears gunfire as it always did
  });

  it('deliverNoise: only Screachers listen; a wall between muffles x0.6, each floor slab x0.35; the dead hear nothing', () => {
    const near = quiet(6, 0, 0), walled = quiet(0, 6, 0), below = quiet(0, 0, 0), dead = quiet(1, 0, 0), z = new ZombieBrain('shambler', 1, 1, 0);
    below.y = -5;
    dead.damage(1e6, 0, 0, 0);
    const heard = deliverNoise([near, walled, below, dead, z], {x: 0, y: 0, z: 0}, 9, 'impact', b => b === near, [-5, 0]); // (a clear line only to `near`)
    expect(heard).toBe(1);
    expect(near.belief).not.toBeNull(); // 6 m, clear line: within 9
    expect(walled.belief).toBeNull(); // 6 m behind a wall: 9 x 0.6 = 5.4 < 6
    expect(below.belief).toBeNull(); // 5 m straight below through one slab: 9 x 0.35 = 3.15 < 5
    expect(z.state).toBe('idle'); // other enemies are not touched by world noise
    expect(deliverNoise([near], {x: 0, y: 0, z: 0}, 0, 'impact', () => true, null)).toBe(0);
  });

  it('loudness helpers: a jump\'s landing carries, a kerb step does not; impacts scale with speed and are capped', () => {
    expect(landNoise(1.5)).toBe(0);
    expect(landNoise(4.1)).toBeCloseTo(SCREACHER_NOISE.landBase + SCREACHER_NOISE.landPerMs * 4.1, 6);
    expect(landNoise(30)).toBe(SCREACHER_NOISE.landMax);
    expect(impactNoise(0.8)).toBe(0);
    expect(impactNoise(2)).toBeCloseTo(SCREACHER_NOISE.impactBase + SCREACHER_NOISE.impactPerMs * 2, 6);
    expect(impactNoise(50)).toBe(SCREACHER_NOISE.impactMax);
  });

  it('never asks for a ladder route (every path request ignores ladder links)', () => {
    const b = quiet(0, 0, 0);
    const paths: unknown[] = [];
    const s: Sim = {px: 20, pz: 20, paths};
    const w = (): BrainWorld => ({...world(s), walkClear: () => false});
    b.hearNoise(9, 0, 20, 0, 'impact');
    for (let i = 0; i < 240; i++) b.update(DT, w());
    expect(paths.length).toBeGreaterThan(0);
    for (const o of paths) expect((o as {noLinks?: boolean}).noLinks).toBe(true);
  });

  it('an unreachable sound is given up (no path: it stops, forgets it and goes back to listening)', () => {
    const b = quiet(0, 0, 0);
    const w: BrainWorld = {...world({px: 30, pz: 30}), walkClear: () => false, findPath: () => null};
    b.hearNoise(9, 0, 20, 0, 'impact');
    let ranInPlace = 0;
    for (let t = 0; t < 14; t += DT) { const out = b.update(DT, w); if (out.anim === 'Run' || out.anim === 'Walk') { if (out.speed === 0 && b.state === 'chase') ranInPlace++; } }
    expect(ranInPlace).toBe(0);
    expect(b.belief).toBeNull();
    expect(['idle', 'wander', 'search']).toContain(b.state);
  });

  it('bounded memory: a belief it cannot act on is forgotten after beliefTtlS', () => {
    const b = quiet(0, 0, 0);
    b.hearNoise(5, 0, 20, 0, 'impact');
    b.clock += 0; // (documented clock: seconds of updates)
    // keep it busy elsewhere: frozen in a long scream-free stagger is not available, so test the rule directly through update's clock
    const w: BrainWorld = {...world({px: 30, pz: 30}), walkClear: () => true, findPath: () => undefined}; // a queued path: it waits
    for (let t = 0; t < SCREACHER_SENSE.beliefTtlS + 1; t += DT) b.update(DT, w);
    expect(b.belief).toBeNull();
  });
});

describe('Screacher brain: touch and the swing are physical', () => {
  it('feels a player it bumps into (contact distance) and attacks: the hit lands when the player is really there', () => {
    const b = quiet(0, 0, 0);
    const s: Sim = {px: 0, pz: 0.8};
    let hits = 0;
    run(b, s, 1.5, out => { if (out.attackHit) hits++; });
    expect(b.attackSeq).toBeGreaterThanOrEqual(1);
    expect(hits).toBe(1); // exactly one hit per swing
    expect(b.belief).toMatchObject({kind: 'touch'});
  });

  it('a player 1.2 m away, silent, is NOT felt (outside contact) even face to face', () => {
    const b = quiet(0, 0, 0);
    const s: Sim = {px: 0, pz: SCREACHER_SENSE.touchM + 0.3, still: true};
    run(b, s, 20);
    expect([b.attackSeq, b.belief]).toEqual([0, null]);
  });

  it('swings at where it BELIEVES the player is: stepping away quietly before the impact frame makes it miss', () => {
    const b = quiet(0, 0, 0);
    const s: Sim = {px: 0, pz: 1.3};
    b.hearNoise(0, 1.3, 11, 0, 'run');
    let hits = 0, swung = false;
    for (let t = 0; t < 3; t += DT) {
      const out = step(b, s);
      if (b.attackSeq > 0 && !swung) { swung = true; s.px = 4; s.pz = -3; } // the player slips away as the swing starts
      if (out.attackHit) hits++;
    }
    expect(swung).toBe(true);
    expect(hits).toBe(0);
    expect(b.belief).toBeNull(); // it struck where the sound was: nothing there
  });

  it('the claw is real: a player standing inside the swing is hit even if the belief was a little off; a wall between stops it', () => {
    const hitWith = (los: boolean): number => {
      const b = quiet(0, 0, 0);
      const s: Sim = {px: 0.5, pz: 1.25, los}; // within reach, in front
      b.hearNoise(0, 1.3, 11, 0, 'impact'); // the sound was beside the player
      let hits = 0;
      run(b, s, 2.5, out => { if (out.attackHit) hits++; });
      return hits;
    };
    expect(hitWith(true)).toBeGreaterThanOrEqual(1);
    expect(hitWith(false)).toBe(0);
  });

  it('a player on another floor is neither felt nor hit', () => {
    const b = quiet(0, 0, 0);
    const s: Sim = {px: 0, pz: 0.5, py: 5};
    let hits = 0;
    run(b, s, 6, out => { if (out.attackHit) hits++; });
    expect([hits, b.belief, b.attackSeq]).toEqual([0, null, 0]);
  });

  it('pain: a far bullet tells it nothing about the shooter (the shot\'s SOUND does, when in earshot); a melee hit does', () => {
    const far = quiet(0, 0, 0);
    far.damage(20, 60, 0, 0);
    expect(far.belief).toBeNull();
    expect(far.heat).toBeGreaterThan(0);
    const near = quiet(0, 0, 0);
    near.damage(20, 1.5, 0.5, 0, {stagger: false});
    expect(near.belief).toMatchObject({x: 1.5, z: 0.5, kind: 'touch'});
    // it dies like anything else, and a dead one hears nothing
    const b = quiet(0, 0, 0);
    expect(b.damage(SCREACHER_STATS.hp, 3, 0, 0)).toBe(true);
    expect(b.hearNoise(1, 0, 20, 0, 'gunshot')).toBe(false);
    expect(b.update(DT, world({px: 0, pz: 1})).anim).toBe('Death');
  });
});

describe('Screacher brain: the echo', () => {
  it('first scream at a deterministic per-spawn offset in [10, 60) s; two Screachers do not scream in unison', () => {
    const a = new ScreacherBrain(3, 4, 0), a2 = new ScreacherBrain(3, 4, 0), c = new ScreacherBrain(20, -7, 0);
    expect(a.echoT).toBe(a2.echoT);
    for (const b of [a, c]) { expect(b.echoT).toBeGreaterThanOrEqual(SCREACHER_ECHO.firstMinS); expect(b.echoT).toBeLessThan(SCREACHER_ECHO.firstMinS + SCREACHER_ECHO.firstSpanS); }
    expect(Math.abs(a.echoT - c.echoT)).toBeGreaterThan(0.5);
  });

  it('about once per 60 s of UPDATED time: 10 minutes of play = 9-11 screams, one scan each, standing still while it screams', () => {
    const b = new ScreacherBrain(0, 0, 0);
    let scans = 0, movedWhileScreaming = 0;
    const s: Sim = {px: 100, pz: 100, still: true, echo: () => { scans++; return null; }};
    const starts: number[] = [];
    let last = b.screamSeq;
    run(b, s, 600, (out, t) => { if (b.screamSeq !== last) { last = b.screamSeq; starts.push(t); } if (b.screaming && out.speed > 0) movedWhileScreaming++; });
    expect(b.screamSeq).toBeGreaterThanOrEqual(9);
    expect(b.screamSeq).toBeLessThanOrEqual(11);
    expect(scans).toBe(b.echoScans);
    expect(b.echoScans).toBe(b.screamSeq); // exactly one scan per scream
    expect(movedWhileScreaming).toBe(0);
    for (let i = 1; i < starts.length; i++) {
      const gap = starts[i] - starts[i - 1];
      expect(gap).toBeGreaterThan(SCREACHER_ECHO.periodS - SCREACHER_ECHO.jitterS - 0.1);
      expect(gap).toBeLessThan(SCREACHER_ECHO.periodS + SCREACHER_ECHO.jitterS + SCREACHER_ECHO.holdS + 0.1);
    }
    expect(b.belief).toBeNull(); // the world answered "nothing in range / behind a wall" every time
  });

  it('no catch-up: time that is not updated (pause, menus, a hidden tab) never counts — a long gap gives no burst of screams', () => {
    const b = new ScreacherBrain(0, 0, 0);
    const s: Sim = {px: 100, pz: 100, echo: () => null};
    run(b, s, 5);
    const before = b.screamSeq, timer = b.echoT;
    // ... the game is paused for an hour: update is simply not called ...
    run(b, s, 1);
    expect(b.screamSeq).toBe(before);
    expect(b.echoT).toBeCloseTo(timer - 1, 1);
  });

  it('the scan happens once, at the cue instant, and takes ONE snapshot: the belief does not follow the player afterwards', () => {
    const b = quiet(0, 0, 0);
    b.echoT = 0.01;
    const calls: number[] = [];
    const s: Sim = {px: 6, pz: 2, echo: (_x, _y, _z, range) => { calls.push(b.screamTime); expect(range).toBe(SCREACHER_ECHO.rangeM); return {x: s.px, z: s.pz, y: 0}; }};
    run(b, s, 0.2);
    expect(b.screaming).toBe(true);
    expect(calls).toEqual([]); // not before the cue
    run(b, s, SCREACHER_ECHO.cueS);
    expect(calls.length).toBe(1);
    expect(calls[0]).toBeGreaterThanOrEqual(SCREACHER_ECHO.cueS);
    expect(calls[0]).toBeLessThan(SCREACHER_ECHO.cueS + 0.05);
    expect(b.belief).toMatchObject({x: 6, z: 2, kind: 'echo'});
    // the player walks away silently: the belief stays the snapshot, and it walks to the snapshot
    s.px = -15; s.pz = -9;
    run(b, s, SCREACHER_ECHO.holdS);
    expect(b.screaming).toBe(false);
    expect(calls.length).toBe(1);
    expect(b.belief).toMatchObject({x: 6, z: 2, kind: 'echo'});
    run(b, s, 2);
    expect(Math.hypot(b.x - 6, b.z - 2)).toBeLessThan(Math.hypot(6, 2));
    expect(Math.hypot(b.x - s.px, b.z - s.pz)).toBeGreaterThan(Math.hypot(15, 9));
    expect(b.echoHits).toBe(1);
  });

  it('a world that answers null (out of range, a wall / floor / closed door between) gives it nothing; no world echo = nothing', () => {
    for (const echo of [() => null, undefined]) {
      const b = quiet(0, 0, 0);
      b.echoT = 0.01;
      const s: Sim = {px: 3, pz: 0, ...(echo ? {echo} : {})};
      run(b, s, SCREACHER_ECHO.holdS + 0.5);
      expect(b.screamSeq).toBe(1);
      expect(b.belief).toBeNull();
      expect(b.echoHits).toBe(0);
    }
  });

  it('its own scream is not a sound to it, and screaming changes no heat', () => {
    const b = quiet(0, 0, 0);
    b.echoT = 0.01;
    run(b, {px: 50, pz: 50, echo: () => null}, SCREACHER_ECHO.holdS + 1);
    expect([b.heard, b.counted, b.heat]).toEqual([0, 0, 0]);
  });

  it('a swing or a stagger delays a due scream; a scream cut by a staggering hit before its scan is retried soon', () => {
    const b = quiet(0, 0, 0);
    const s: Sim = {px: 0, pz: 0.8, echo: () => null};
    run(b, s, 0.3); // touching: it attacks
    expect(b.state).toBe('attack');
    b.echoT = 0;
    step(b, s);
    expect(b.screaming).toBe(false); // not mid-swing
    // a scream cut short
    const c = quiet(0, 0, 0);
    c.echoT = 0.01;
    const sc: Sim = {px: 40, pz: 40, echo: () => null};
    run(c, sc, 0.2);
    expect(c.screaming).toBe(true);
    c.damage(40, 30, 0, 0); // a staggering hit (>= 20) before the cue
    expect(c.screaming).toBe(false);
    expect(c.echoScans).toBe(0);
    expect(c.echoT).toBe(SCREACHER_ECHO.retryS);
  });

  it('a dead player is never located', () => {
    const b = quiet(0, 0, 0);
    b.echoT = 0.01;
    let asked = 0;
    run(b, {px: 2, pz: 0, alive: false, echo: () => { asked++; return {x: 2, z: 0, y: 0}; }}, SCREACHER_ECHO.holdS + 0.5);
    expect([asked, b.belief]).toEqual([0, null]);
  });
});
