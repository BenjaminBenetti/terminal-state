// Task studio-flamethrower-fire-20261114-031614-01 (user: "Fire clings to actual surfaces/props, persists for limited active seconds ...
// Damage player, zombies and exposed world props ... No unrequested acid-salvage windfalls or new smoke-survival mechanics. BB damage
// stays non-graphic"): fire/fireSystem.ts as pure rules over a stub world (the real melt engine: fire-props.test.ts):
//  - the stream: every body in the widening cone with a clear line burns (dps eased with range), bodies behind what stops it do not;
//    a touched body is alight for FLAME.burnSeconds (refreshed, never stacked); fire never staggers; a kill is handed to the game once;
//  - clinging fire: the flame arrives after its flight, leaves a patch on the surface it hit (floor / wall / ceiling), fed by the
//    seconds of stream, alive FIRE_PATCH.life after the last feed, merged within FIRE_PATCH.merge, at most FIRE_PATCH.max;
//  - bodies in fire take the strongest fire touching them (never a sum); the player burns only while in it, with throttled pain;
//  - props: stream / stream-fed patches heat a prop until it catches (the melt engine's start(ref, 'fire'), once); embers heat nothing;
//  - presentation rules: no green smoke, nothing burning ON a non-graphic body; clear() leaves nothing.
import {describe, expect, it} from 'vitest';
import * as THREE from 'three';
import {FIRE_PATCH, FLAME, FLAME_FUEL, PROP_FIRE} from '../src/fire/flamethrowerSpec';
import {FireSystem, patchRadius, patchStrength, streamFalloff, streamRadius, type FireBurn, type FireEnemy, type FireEnv, type FireMelt, type FireRayHit, type FireRef, type V3} from '../src/fire/fireSystem';
import {FIRE_FX, FireFx, fireNoiseTexture} from '../src/fire/fireFx';
import {FIRE_VOICES, type FireVoice, type FlameSound} from '../src/fire/sound';

const EYE: V3 = {x: 0, y: 1.6, z: 0};
const FWD: V3 = {x: 0, y: 0, z: 1};
const TICK = FLAME_FUEL.unitSeconds;

interface Body extends FireEnemy { hp: number; calls: {amount: number; o: unknown}[] }
function body(x: number, z: number, hp = 1000, extra: Partial<FireEnemy> = {}): Body {
  const b: Body = {
    hp, calls: [], hitFlash: 0,
    brain: {
      alive: true, x, y: 0, z, stats: {radius: 0.3, height: 1.7},
      damage(amount: number, _fx: number, _fz: number, _fy?: number, o?: {stagger?: boolean}) {
        b.calls.push({amount, o});
        b.hp -= amount;
        if (b.hp <= 0) (b.brain as {alive: boolean}).alive = false;
        return b.hp <= 0;
      },
    },
    ...extra,
  };
  return b;
}
const taken = (b: Body) => b.calls.reduce((n, c) => n + c.amount, 0);

function sound() {
  const log: string[] = [];
  const frames: {muzzle: unknown; fires: FireVoice[]}[] = [];
  const s: FlameSound = {
    streamOn: () => { log.push('on'); }, streamOff: dry => { log.push(dry ? 'off-dry' : 'off'); },
    frame: (_dt, muzzle, fires) => { frames.push({muzzle, fires: fires.map(f => ({...f}))}); },
    ignite: () => { log.push('ignite'); }, burnOut: () => { log.push('burnOut'); },
    refill: () => () => {}, dry: () => { log.push('dry'); }, silence: () => { log.push('silence'); },
  };
  return {s, log, frames};
}

/** A flat world: floor at y 0, an optional wall at z = wallZ (normal -z), an optional ceiling. */
function world(o: {wallZ?: number; ceilY?: number; floor?: boolean; enemies?: Body[]; player?: {x: number; y: number; z: number; alive: boolean; hp: number}; melt?: FireMelt | null; los?: (a: V3, b: V3) => boolean} = {}) {
  const sys = new FireSystem();
  const kills: {z: FireEnemy; strength: number}[] = [], hurts: FireEnemy[] = [], pain: number[] = [];
  let burnHints = 0;
  const snd = sound();
  const pl = o.player ? {...o.player, takeDamage(n: number) { this.hp -= n; }} : null;
  const env: FireEnv = {
    enemies: () => o.enemies ?? [],
    player: () => pl,
    kill: (z, _dir, _point, strength) => { kills.push({z, strength}); },
    hurt: z => { hurts.push(z); },
    playerBurn: () => { burnHints++; },
    playerHurt: n => { pain.push(n); },
    ray: (a, d, max): FireRayHit => {
      let best: FireRayHit = {t: max, kind: 'none', nx: 0, ny: 1, nz: 0};
      if (o.wallZ !== undefined && d.z > 1e-6) { const t = (o.wallZ - a.z) / d.z; if (t > 0 && t < best.t) best = {t, kind: 'wall', nx: 0, ny: 0, nz: -1}; }
      if (o.floor !== false && d.y < -1e-6) { const t = -a.y / d.y; if (t > 0 && t < best.t) best = {t, kind: 'floor', nx: 0, ny: 1, nz: 0}; }
      if (o.ceilY !== undefined && d.y > 1e-6) { const t = (o.ceilY - a.y) / d.y; if (t > 0 && t < best.t) best = {t, kind: 'ceiling', nx: 0, ny: -1, nz: 0}; }
      return best;
    },
    los: o.los ?? (() => true),
    floorAt: () => (o.floor === false ? null : 0),
    melt: () => o.melt ?? null,
    sound: snd.s,
    rand: () => 0.5,
  };
  sys.env = env;
  const run = (seconds: number, dt = 1 / 60) => { for (let t = 0; t < seconds - 1e-9; t += dt) sys.tick(dt); };
  /** Hold the trigger for `seconds`: one paid tick every TICK, the world ticking between. */
  const spray = (seconds: number, eye: V3 = EYE, dir: V3 = FWD) => {
    for (let t = 0; t < seconds - 1e-9; t += TICK) { sys.flame(eye, dir, TICK); run(TICK); }
  };
  return {sys, env, kills, hurts, pain, snd, pl, run, spray, hints: () => burnHints};
}
const norm = (v: V3): V3 => { const l = Math.hypot(v.x, v.y, v.z); return {x: v.x / l, y: v.y / l, z: v.z / l}; };
/** The patches where the stream itself landed (not the small drip fires on the floor under it). */
const landed = (sys: FireSystem, face: 'floor' | 'wall' | 'ceiling', near?: {x: number; z: number}) =>
  sys.patches.filter(p => p.face === face && (!near || Math.hypot(p.x - near.x, p.z - near.z) < 0.3));

describe('fire: the stream', () => {
  it('the cone widens from radius0 to radius1 and its damage eases to farMult at full range', () => {
    expect(streamRadius(0)).toBe(FLAME.radius0);
    expect(streamRadius(FLAME.range)).toBeCloseTo(FLAME.radius1, 9);
    expect(streamRadius(FLAME.range * 5)).toBeCloseTo(FLAME.radius1, 9);
    expect(streamFalloff(0)).toBe(1);
    expect(streamFalloff(FLAME.range)).toBeCloseTo(FLAME.farMult, 9);
    expect(streamFalloff(FLAME.range / 2)).toBeCloseTo((1 + FLAME.farMult) / 2, 9);
  });

  it('every body inside the cone burns at once (dps x seconds x falloff); bodies beside or beyond it do not', () => {
    const near = body(0, 2), far = body(0.5, 7.5), side = body(2.2, 4), behind = body(0, -2), beyond = body(0, FLAME.range + 1.2);
    const w = world({enemies: [near, far, side, behind, beyond]});
    w.sys.flame(EYE, FWD, TICK);
    expect(taken(near)).toBeCloseTo(FLAME.dps * TICK * streamFalloff(2), 6);
    expect(taken(far)).toBeGreaterThan(0);
    expect(taken(far)).toBeLessThan(taken(near));
    expect(taken(far)).toBeGreaterThanOrEqual(FLAME.dps * TICK * FLAME.farMult - 1e-9);
    for (const b of [side, behind, beyond]) expect(taken(b)).toBe(0);
    // a second of stream = FLAME.dps on a body at the lance (a body count does not divide it)
    const a = body(0, 0.8), b2 = body(0.2, 1.2);
    const w2 = world({enemies: [a, b2]});
    for (let i = 0; i < 10; i++) w2.sys.flame(EYE, FWD, TICK);
    expect(taken(a)).toBeCloseTo(FLAME.dps * streamFalloff(0.8), 4);
    expect(taken(b2)).toBeGreaterThan(FLAME.dps * 0.85);
    // fire never staggers
    for (const c of [...near.calls, ...a.calls]) expect(c.o).toEqual({stagger: false});
  });

  it('what stops the stream shields what is behind it; no clear line from the eye = no burn; nothing without paid seconds', () => {
    const front = body(0, 2), back = body(0, 5);
    const w = world({wallZ: 3.5, enemies: [front, back]});
    w.sys.flame(EYE, FWD, TICK);
    expect(taken(front)).toBeGreaterThan(0);
    expect(taken(back)).toBe(0);
    expect(w.sys.stream.reach).toBeCloseTo(3.5, 6);
    expect(w.sys.stream.kind).toBe('wall');
    const hidden = body(0.6, 3);
    const w2 = world({enemies: [hidden], los: () => false});
    w2.sys.flame(EYE, FWD, TICK);
    expect(taken(hidden)).toBe(0);
    const z = body(0, 2);
    const w3 = world({enemies: [z]});
    w3.sys.flame(EYE, FWD, 0);
    w3.sys.flame(EYE, FWD, -1);
    w3.sys.flame(EYE, FWD, NaN);
    expect(taken(z)).toBe(0);
    expect(w3.sys.active).toBe(false);
  });

  it('a touched body is alight: burnDps for burnSeconds after the LAST touch — refreshed, never stacked', () => {
    const z = body(0, 2, 1e6);
    const w = world({enemies: [z], floor: false});
    w.sys.flame(EYE, FWD, TICK);
    const direct = taken(z);
    expect(w.sys.alight.has(z)).toBe(true);
    w.run(FLAME.burnSeconds + 1);
    expect(taken(z) - direct).toBeCloseTo(FLAME.burnDps * FLAME.burnSeconds, 1);
    expect(w.sys.alight.size).toBe(0);
    expect(w.sys.active).toBe(false);
    // touched again 2 s in: 2 s + a fresh burnSeconds, not two burns at once
    const y = body(0, 2, 1e6);
    const w2 = world({enemies: [y], floor: false});
    w2.sys.flame(EYE, FWD, TICK);
    w2.run(2);
    w2.sys.flame(EYE, FWD, TICK);
    w2.run(FLAME.burnSeconds + 1);
    expect(taken(y) - 2 * FLAME.dps * TICK * streamFalloff(2)).toBeCloseTo(FLAME.burnDps * (2 + FLAME.burnSeconds), 1);
    // the hurt cue at most about once a second while it burns
    expect(w2.hurts.length).toBeGreaterThanOrEqual(5);
    expect(w2.hurts.length).toBeLessThanOrEqual(8);
  });

  it('the afterburn pays its whole burnSeconds at any frame length (the last, partial step never takes damage back)', () => {
    for (const dt of [1 / 60, 1 / 30, 1 / 144, 0.013, 0.07, 0.11, 0.25]) {
      const z = body(0, 2, 1e6);
      const w = world({enemies: [z], floor: false});
      w.sys.flame(EYE, FWD, TICK);
      const direct = taken(z);
      w.run(FLAME.burnSeconds + 1.5, dt);
      expect(taken(z) - direct, `dt ${dt}`).toBeCloseTo(FLAME.burnDps * FLAME.burnSeconds, 6);
      expect(w.sys.alight.size, `dt ${dt}`).toBe(0);
    }
  });

  it('a kill is handed to the game exactly once (a small shove), the body stops burning; BB burns as any body (damage only)', () => {
    const z = body(0, 2, 30), bb = body(0.3, 3, 55, {nonGraphic: true});
    const w = world({enemies: [z, bb], floor: false});
    w.spray(1.5);
    w.run(FLAME.burnSeconds + 1);
    expect(z.brain.alive).toBe(false);
    expect(bb.brain.alive).toBe(false);
    expect(w.kills.map(k => k.z)).toEqual([z, bb]);
    for (const k of w.kills) expect(k.strength).toBe(FLAME.killImpulse);
    expect(w.sys.alight.size).toBe(0);
    expect(w.sys.counts.kills).toBe(2);
    const dead = taken(z);
    w.spray(0.5);
    expect(taken(z)).toBe(dead); // (a dead body takes nothing more)
  });

  it('the stream sound follows it; the audio hears at most FIRE_VOICES burning places, the strongest near the player first', () => {
    const w = world({wallZ: 4, player: {x: 0, y: 0, z: 0, alive: true, hp: 100}});
    w.sys.streamStart(EYE);
    w.spray(1);
    expect(w.sys.stream.on).toBe(true);
    w.sys.streamEnd(true);
    w.sys.streamEnd(true); // (idempotent)
    expect(w.snd.log).toEqual(['on', 'off-dry']);
    // fires in six separate places: only FIRE_VOICES voices
    for (let i = 0; i < 6; i++) { const d = norm({x: (i - 2.5) * 1.6, y: -0.35, z: 1}); for (let k = 0; k < 6; k++) w.sys.flame(EYE, d, TICK); }
    w.run(1.5);
    expect(w.sys.patches.length).toBeGreaterThanOrEqual(4);
    const last = w.snd.frames[w.snd.frames.length - 1];
    expect(last.fires.length).toBe(FIRE_VOICES);
    for (const f of last.fires) { expect(f.level).toBeGreaterThan(0); expect(f.level).toBeLessThanOrEqual(1); }
    expect(last.muzzle).toBeNull();
    // everything burnt out: one last frame with no fires (the beds fade), then no more work
    w.run(FIRE_PATCH.life + 2);
    expect(w.snd.frames[w.snd.frames.length - 1].fires).toEqual([]);
    expect(w.sys.active).toBe(false);
  });
});

describe('fire: clinging to surfaces', () => {
  it('the flame takes its flight time to arrive, then burns ON the surface it hit — wall, floor or ceiling — for limited active seconds', () => {
    const w = world({wallZ: 6});
    w.sys.flame(EYE, FWD, TICK);
    expect(w.sys.patches).toHaveLength(0);
    w.run(6 / FLAME.speed - 0.05);
    expect(landed(w.sys, 'wall')).toHaveLength(0);
    w.run(0.1);
    expect(landed(w.sys, 'wall')).toHaveLength(1);
    const p = landed(w.sys, 'wall')[0];
    expect([p.nx, p.ny, p.nz]).toEqual([0, 0, -1]);
    expect(p.z).toBeGreaterThan(5.9);
    expect(p.z).toBeLessThan(6); // (just off the wall, on the stream's side)
    expect(p.y).toBeCloseTo(1.6, 6);
    // a floor and a ceiling
    const f = world({});
    f.spray(0.3, EYE, norm({x: 0, y: -0.5, z: 1}));
    f.run(0.5);
    const fp = landed(f.sys, 'floor', {x: 0, z: 3.2});
    expect(fp).toHaveLength(1);
    expect(fp[0].y).toBeCloseTo(0.04 * 0.5 / Math.hypot(0.5, 1), 2);
    expect(f.sys.patches.every(q => q.face === 'floor')).toBe(true);
    const c = world({ceilY: 3});
    c.spray(0.3, EYE, norm({x: 0, y: 0.6, z: 1}));
    c.run(0.5);
    expect(landed(c.sys, 'ceiling')).toHaveLength(1);
    expect(landed(c.sys, 'ceiling')[0].y).toBeLessThan(3);
    // limited: gone FIRE_PATCH.life after the last feed, never longer
    w.run(FIRE_PATCH.life + 0.5);
    expect(w.sys.patches).toHaveLength(0);
    expect(w.sys.counts.burntOut).toBe(w.sys.counts.patches);
  });

  it('a lick leaves a small short fire; FIRE_PATCH.feed of stream a full one that lasts FIRE_PATCH.life and dies down at the end', () => {
    const lick = world({wallZ: 3});
    lick.sys.flame(EYE, FWD, TICK);
    lick.run(0.3);
    const a = landed(lick.sys, 'wall')[0];
    expect(patchStrength(a)).toBeGreaterThan(0.05);
    expect(patchStrength(a)).toBeLessThan(0.25);
    expect(a.fuel).toBeLessThan(FIRE_PATCH.life * 0.25);
    const full = world({wallZ: 3});
    full.spray(FIRE_PATCH.feed + 0.2);
    full.run(0.25);
    const b = landed(full.sys, 'wall')[0];
    expect(landed(full.sys, 'wall')).toHaveLength(1); // (the same spot: fed, not stacked)
    expect(patchStrength(b)).toBe(1);
    expect(patchRadius(b)).toBeCloseTo(FIRE_PATCH.radius, 6);
    expect(b.fuel).toBeGreaterThan(FIRE_PATCH.life - 0.5);
    expect(b.fuel).toBeLessThanOrEqual(FIRE_PATCH.life);
    // more stream never banks more than FIRE_PATCH.life
    full.spray(3);
    expect(b.fuel).toBeLessThanOrEqual(FIRE_PATCH.life);
    // it dies down over its last FIRE_PATCH.fade seconds
    full.run(FIRE_PATCH.life - FIRE_PATCH.fade / 2);
    expect(landed(full.sys, 'wall')).toEqual([b]);
    const k = patchStrength(b);
    expect(k).toBeGreaterThan(0.1);
    expect(k).toBeLessThan(0.6);
    expect(patchRadius(b)).toBeLessThan(FIRE_PATCH.radius);
  });

  it('deposits within FIRE_PATCH.merge feed one patch; apart they are separate; at most FIRE_PATCH.max (the weakest gives way)', () => {
    const w = world({wallZ: 5});
    w.spray(0.3, EYE, FWD);
    w.spray(0.3, EYE, norm({x: 0.05, y: 0, z: 1})); // 0.25 m along the wall
    w.run(0.5);
    expect(landed(w.sys, 'wall')).toHaveLength(1);
    w.spray(0.3, EYE, norm({x: 0.4, y: 0, z: 1})); // 2 m along
    w.run(0.5);
    expect(landed(w.sys, 'wall')).toHaveLength(2);
    // a sweep across a long wall: capped
    const s = world({wallZ: 6});
    for (let i = 0; i < 40; i++) for (let k = 0; k < 6; k++) s.sys.flame({x: -30 + i * 1.5, y: 1.6, z: 0}, FWD, TICK);
    s.run(0.6);
    expect(s.sys.counts.patches).toBeGreaterThanOrEqual(40);
    expect(s.sys.patches.length).toBe(FIRE_PATCH.max);
    expect(s.sys.counts.evicted).toBe(s.sys.counts.patches - FIRE_PATCH.max);
    expect(s.sys.counts.deposits).toBe(40 * 6 + s.sys.counts.drips); // (a full flight queue lands its oldest early: no flame is dropped)
  });

  it('a stream ending in open air drops part of its flame on the floor below; over a void it leaves nothing; drips fall under it', () => {
    const w = world({});
    w.spray(0.6);
    w.run(1.2);
    const end = w.sys.patches.filter(p => Math.abs(p.z - FLAME.range) < 0.1);
    expect(end).toHaveLength(1);
    expect(end[0].face).toBe('floor');
    expect(end[0].y).toBe(0);
    expect(end[0].fed).toBeCloseTo(0.6 * FIRE_PATCH.airFeed, 6);
    expect(w.sys.counts.drips).toBeGreaterThanOrEqual(1);
    const drip = w.sys.patches.find(p => p.z < FLAME.range - 1)!;
    expect(drip.y).toBe(0);
    expect(patchStrength(drip)).toBeLessThan(0.3);
    const v = world({floor: false});
    v.spray(1);
    v.run(1.5);
    expect(v.sys.patches).toHaveLength(0);
  });
});

describe('fire: what it burns', () => {
  it('a body in a patch takes the patch dps x its strength and is alight; two overlapping patches do not add up', () => {
    const w = world({});
    const down = norm({x: 0, y: -1.6, z: 3});
    w.spray(FIRE_PATCH.feed + 0.2, EYE, down);
    w.run(0.3);
    const p = w.sys.patches.find(q => q.face === 'floor' && Math.abs(q.z - 3) < 0.2)!;
    expect(patchStrength(p)).toBe(1);
    const z = body(p.x, p.z, 1e6), out = body(p.x + 3, p.z, 1e6);
    (w.env as {enemies: () => Body[]}).enemies = () => [z, out];
    w.run(1);
    // 1 s in a full patch: enemyDps, + the burn it started (burnDps)
    expect(taken(z)).toBeGreaterThan(FIRE_PATCH.enemyDps * 0.9 + FLAME.burnDps * 0.7);
    expect(taken(z)).toBeLessThan(FIRE_PATCH.enemyDps * 1.05 + FLAME.burnDps * 1.05);
    expect(taken(out)).toBe(0);
    expect(w.sys.alight.has(z)).toBe(true);
    // a second full patch right beside it, overlapping the body: the same rate
    const w2 = world({});
    w2.spray(FIRE_PATCH.feed + 0.2, EYE, down);
    w2.spray(FIRE_PATCH.feed + 0.2, {x: 0.7, y: 1.6, z: 0}, down);
    w2.run(0.3);
    expect(w2.sys.patches.filter(q => Math.abs(q.z - 3) < 0.2).length).toBe(2);
    const y = body(0.35, 3, 1e6);
    (w2.env as {enemies: () => Body[]}).enemies = () => [y];
    w2.run(1);
    expect(taken(y)).toBeLessThan(FIRE_PATCH.enemyDps * 1.05 + FLAME.burnDps * 1.05);
  });

  it('fire never burns through what it clings to: a wall fire on its open side only; a floor fire at a partition leaves the next room alone', () => {
    // 1. fire on a wall (normal -z): a body in front of it burns, a body just behind the wall does not
    const w = world({wallZ: 5});
    w.spray(FIRE_PATCH.feed + 0.2);
    w.run(0.4);
    const wall = landed(w.sys, 'wall')[0];
    expect(wall).toBeDefined();
    expect(patchStrength(wall)).toBe(1);
    expect(wall.nz).toBeLessThan(-0.9);
    const open = body(0, 5 - 0.45, 1e6), behindIt = body(0, 5 + 0.45, 1e6);
    (w.env as {enemies: () => Body[]}).enemies = () => [open, behindIt];
    w.run(1);
    expect(taken(open)).toBeGreaterThan(FIRE_PATCH.enemyDps * 0.8);
    expect(taken(behindIt)).toBe(0);
    expect(w.sys.alight.has(behindIt)).toBe(false);
    // 2. a floor fire at the foot of a partition (sight blocked across z = 5): bodies and the player in the next room are untouched
    const crosses = (a: V3, b: V3) => (a.z - 5) * (b.z - 5) < 0;
    const w2 = world({wallZ: 5, los: (a, b) => !crosses(a, b), player: {x: 0.3, y: 0, z: 5.5, alive: true, hp: 100}});
    w2.spray(FIRE_PATCH.feed + 0.2, EYE, norm({x: 0, y: -1.6, z: 4.8}));
    w2.run(0.4);
    const floor = landed(w2.sys, 'floor', {x: 0, z: 4.8})[0];
    expect(floor).toBeDefined();
    expect(patchRadius(floor)).toBeGreaterThan(0.6);
    const same = body(0, 4.3, 1e6), next = body(0, 5.5, 1e6);
    (w2.env as {enemies: () => Body[]}).enemies = () => [same, next];
    w2.run(1);
    expect(taken(same)).toBeGreaterThan(FIRE_PATCH.enemyDps * 0.8);
    expect(taken(next)).toBe(0);
    expect(w2.pl!.hp).toBe(100);
    expect(w2.sys.counts.playerS).toBe(0);
    // (the same fire with nothing in the way reaches both: the rule is the line, not the distance)
    const w3 = world({});
    w3.spray(FIRE_PATCH.feed + 0.2, EYE, norm({x: 0, y: -1.6, z: 4.8}));
    w3.run(0.4);
    const near = body(0, 4.3, 1e6), far = body(0, 5.5, 1e6);
    (w3.env as {enemies: () => Body[]}).enemies = () => [near, far];
    w3.run(1);
    expect(taken(near)).toBeGreaterThan(0);
    expect(taken(far)).toBeGreaterThan(0);
  });

  it('the player burns only while in the fire (takeDamage direct, pain throttled, one hint per stay) — and not from the stream itself', () => {
    const w = world({player: {x: 0, y: 0, z: 0, alive: true, hp: 100}});
    const down = norm({x: 0, y: -1.6, z: 3});
    w.spray(FIRE_PATCH.feed + 0.2, EYE, down);
    w.run(0.3);
    expect(w.pl!.hp).toBe(100); // spraying hurts nobody behind the lance
    w.pl!.z = 3;
    w.run(2);
    const lost = 100 - w.pl!.hp;
    expect(lost).toBeGreaterThan(FIRE_PATCH.playerDps * 1.8);
    expect(lost).toBeLessThan(FIRE_PATCH.playerDps * 2.1);
    expect(w.hints()).toBe(1);
    expect(w.pain.length).toBeGreaterThanOrEqual(2);
    expect(w.pain.length).toBeLessThanOrEqual(3); // (every FLAME.painEvery at most)
    // stepping out: it stops at once — the player is never left alight
    w.pl!.z = 0;
    const hp = w.pl!.hp;
    w.run(1);
    expect(hp - w.pl!.hp).toBeLessThan(FIRE_PATCH.playerDps * FLAME.burnEvery + 1e-6);
    const hp2 = w.pl!.hp;
    w.run(2);
    expect(w.pl!.hp).toBe(hp2);
    // above the flames (a floor patch reaches FIRE_PATCH.height) nothing burns
    w.pl!.z = 3; w.pl!.y = FIRE_PATCH.height + 0.3;
    w.run(1);
    expect(w.pl!.hp).toBe(hp2);
    // a dead player takes nothing
    w.pl!.y = 0; w.pl!.alive = false;
    w.run(1);
    expect(w.pl!.hp).toBe(hp2);
  });

  /** A stub melt engine: one prop box at (0, 0, 4), 1 m wide, 1 m tall; refs by identity. */
  function meltStub(o: {eligible?: boolean} = {}) {
    const ref: FireRef = {key: 'p:1', x: 0, y: 0, z: 4, label: 'crate'};
    const st = {started: [] as string[], burning: false, gone: false, pos: {x: 0, y: 0, z: 4}};
    const melt: FireMelt = {
      inDisc: (x, _y, z, r) => (o.eligible !== false && !st.burning && !st.gone && Math.hypot(x - st.pos.x, z - st.pos.z) <= r + 0.5 ? [ref] : []),
      atPoint: (x, y, z, r = 0.3) => (o.eligible !== false && !st.gone && Math.abs(x - st.pos.x) <= 0.5 + r && Math.abs(z - st.pos.z) <= 0.5 + r && y <= 1 + r ? ref : null),
      start: (rf, cause) => { st.started.push(`${rf.key}:${cause}`); st.burning = true; return true; },
      alive: () => !st.gone,
      where: (_rf, out) => { if (st.gone) return false; out.x = st.pos.x; out.y = st.pos.y; out.z = st.pos.z; return true; },
      burning: (out: FireBurn[] = []) => {
        out.length = 0;
        if (st.burning && !st.gone) out.push({ref, id: st, box: {min: {x: st.pos.x - 0.5, y: 0, z: st.pos.z - 0.5}, max: {x: st.pos.x + 0.5, y: 1, z: st.pos.z + 0.5}}, base: {x: st.pos.x, y: 0, z: st.pos.z}, age: 1, seconds: PROP_FIRE.burnSeconds});
        return out;
      },
      causeOf: () => (st.burning ? 'fire' : null),
      fire: null,
    };
    return {melt, ref, st};
  }
  /** The stub world's ray with the prop's front face (z = 3.5) in the way. */
  function withProp(w: ReturnType<typeof world>) {
    const base = w.env.ray!;
    w.env.ray = (a, d, max) => {
      const h = base(a, d, max);
      if (d.z > 1e-6) { const t = (3.5 - a.z) / d.z, y = a.y + d.y * t, x = a.x + d.x * t; if (t > 0 && t < h.t && y >= 0 && y <= 1 && Math.abs(x) <= 0.5) return {t, kind: 'prop', nx: 0, ny: 0, nz: -1}; }
      return h;
    };
  }

  it('fire on a prop heats it: it catches after PROP_FIRE.catchSeconds of it (start(ref, fire), once); a brief lick cools off again', () => {
    const m = meltStub();
    const w = world({melt: m.melt});
    withProp(w);
    const at = norm({x: 0, y: -1.1, z: 3.5});
    // a lick (one fuel unit): a small fire on its face that dies in a second or two — too weak to light it, however often it comes
    for (let i = 0; i < 4; i++) {
      w.sys.flame(EYE, at, TICK);
      w.run(PROP_FIRE.catchSeconds / PROP_FIRE.cool + 4);
      expect(m.st.started).toEqual([]);
      expect(w.sys.patches).toHaveLength(0);
    }
    // the stream held on it: its heat is its TIME in flame — the stream and the fire now clinging to its face are one flame, never a
    // sum — so it catches after catchSeconds of it (+ the flame's flight and one prop pass), not sooner
    let caughtAt = -1;
    for (let t = 0; t < 4 && caughtAt < 0; t += TICK) { w.sys.flame(EYE, at, TICK); w.run(TICK); if (m.st.started.length) caughtAt = t + TICK; }
    expect(caughtAt).toBeGreaterThanOrEqual(PROP_FIRE.catchSeconds);
    expect(caughtAt).toBeLessThanOrEqual(PROP_FIRE.catchSeconds + 0.6);
    // ... exactly once however long it goes on
    w.run(0.4);
    expect(m.st.started).toEqual(['p:1:fire']);
    w.spray(2, EYE, at);
    expect(m.st.started).toEqual(['p:1:fire']);
    expect(w.sys.counts.propsCaught).toBe(1);
    // the fire on its face clings to the prop (it follows it when it moves)
    const on = w.sys.patches.find(p => p.ref === m.ref)!;
    expect(on).toBeTruthy();
    m.st.pos.x = 2;
    w.run(0.1);
    expect(on.x).toBeGreaterThan(1.4);
  });

  it('a protected prop (the engine returns no ref) never catches: the fire clings to its face and burns out', () => {
    const m = meltStub({eligible: false});
    const w = world({melt: m.melt});
    withProp(w);
    w.spray(PROP_FIRE.catchSeconds * 4, EYE, norm({x: 0, y: -1.1, z: 3.5}));
    w.run(0.5);
    expect(m.st.started).toEqual([]);
    expect(w.sys.patches.length).toBeGreaterThanOrEqual(1);
    expect(w.sys.patches.every(p => p.ref === null)).toBe(true);
    w.run(FIRE_PATCH.life + 1);
    expect(w.sys.patches).toHaveLength(0);
    expect(m.st.started).toEqual([]);
  });

  it('a stream-fed floor fire sets alight what stands in it; a burning prop burns bodies against it; its embers heat nothing', () => {
    const m = meltStub();
    const w = world({melt: m.melt});
    // the floor right in front of the prop (no ray hit on the prop itself)
    w.spray(FIRE_PATCH.feed + 0.4, EYE, norm({x: 0, y: -1.6, z: 3.2}));
    w.run(PROP_FIRE.catchSeconds + 1);
    expect(m.st.started).toEqual(['p:1:fire']);
    // burning: a body against it burns at PROP_FIRE dps, one 2 m away does not
    w.run(FIRE_PATCH.life + 1); // (the floor fire is out; only the prop burns now)
    expect(w.sys.patches).toHaveLength(0);
    const z = body(0.7, 4, 1e6), far = body(3, 4, 1e6);
    (w.env as {enemies: () => Body[]}).enemies = () => [z, far];
    w.run(1);
    expect(taken(z)).toBeGreaterThan(PROP_FIRE.enemyDps * 0.9);
    expect(taken(far)).toBe(0);
    // burnt out: the engine's cue leaves embers on the floor (a cue + soot through the view), which light nothing
    const burn = m.melt.burning()[0];
    m.st.gone = true;
    m.st.burning = false;
    m.melt.fire!.out!(burn);
    expect(w.snd.log).toContain('burnOut');
    const ember = w.sys.patches[w.sys.patches.length - 1];
    expect(ember.heats).toBe(false);
    expect(ember.fuel).toBeLessThanOrEqual(FIRE_PATCH.emberSeconds);
    const m2 = meltStub();
    m2.st.pos.z = 4.4; // a second prop touching the embers
    (w.env as {melt: () => FireMelt}).melt = () => m2.melt;
    w.run(FIRE_PATCH.emberSeconds + 1);
    expect(m2.st.started).toEqual([]);
    expect(w.sys.patches).toHaveLength(0);
  });

  it('fire on a prop that is gone falls to the floor as embers (never left hanging in the air)', () => {
    const m = meltStub();
    const w = world({melt: m.melt});
    withProp(w);
    w.spray(0.5, EYE, norm({x: 0, y: -0.8, z: 3.5}));
    w.run(0.4);
    const on = w.sys.patches.find(p => p.ref === m.ref)!;
    expect(on.y).toBeGreaterThan(0.5);
    m.st.gone = true;
    w.run(0.1);
    expect(on.ref).toBeNull();
    expect(on.y).toBe(0);
    expect(on.face).toBe('floor');
    expect(on.heats).toBe(false);
    expect(on.fuel).toBeLessThanOrEqual(FIRE_PATCH.emberSeconds);
    expect(w.sys.counts.fell).toBe(1);
  });

  it('the audio gets one last EMPTY frame when the last burn ends without embers (a burn completed by clear(): its bed fades)', () => {
    const m = meltStub();
    const w = world({melt: m.melt});
    m.st.burning = true; // (a prop burning, nothing else: no patch, no stream)
    w.run(0.5);
    expect(w.sys.burns).toHaveLength(1);
    expect(w.snd.frames[w.snd.frames.length - 1].fires).toHaveLength(1);
    m.st.gone = true; // (the engine finished it without its `out` hook: no embers are left)
    const n = w.snd.frames.length;
    w.run(0.5);
    expect(w.sys.active).toBe(false);
    expect(w.snd.frames.length).toBe(n + 1);
    expect(w.snd.frames[n]).toEqual({muzzle: null, fires: []});
  });

  it('clear() leaves nothing burning, owed or in flight, and silences the fire', () => {
    const z = body(0, 2, 1e6);
    const w = world({wallZ: 5, enemies: [z], player: {x: 0, y: 0, z: 4.6, alive: true, hp: 100}});
    w.sys.streamStart(EYE);
    w.spray(1);
    expect(w.sys.active).toBe(true);
    const hp = w.pl!.hp, dmg = taken(z);
    w.sys.clear();
    expect(w.sys.active).toBe(false);
    expect([w.sys.patches.length, w.sys.alight.size, w.sys.stream.on]).toEqual([0, 0, false]);
    expect(w.snd.log[w.snd.log.length - 1]).toBe('silence');
    w.run(3);
    expect(w.pl!.hp).toBe(hp);
    expect(taken(z)).toBe(dmg);
  });
});

describe('fire: presentation rules', () => {
  it('smoke is never green and never a gas: the plume / puff colours are neutral-warm; the noise is a full-range data texture', () => {
    const c = new THREE.Color(FIRE_FX.plume.color);
    expect(c.r).toBeGreaterThanOrEqual(c.g);
    expect(c.g).toBeGreaterThanOrEqual(c.b);
    const l = new THREE.Color(FIRE_FX.light.color);
    expect(l.r).toBeGreaterThan(l.g);
    expect(l.g).toBeGreaterThan(l.b);
    const t = fireNoiseTexture(32);
    const d = t.image.data as Uint8Array;
    let lo = 255, hi = 0;
    for (let i = 0; i < d.length; i += 4) { lo = Math.min(lo, d[i]); hi = Math.max(hi, d[i]); }
    expect([lo, hi]).toEqual([0, 255]);
    expect(t.wrapS).toBe(THREE.RepeatWrapping);
  });

  it('the look follows the state: flames / smoke / glow / the pooled light while it burns, nothing ON a non-graphic body, all off after clear()', () => {
    const scene = new THREE.Scene();
    const fx = new FireFx(scene);
    // boot state: the rings and the light exist (constant light set), hidden / dark
    expect(scene.getObjectByName('fire-light')).toBe(fx.light);
    expect(fx.light.intensity).toBe(0);
    const hidden = () => ['fire-flames', 'fire-smoke', 'fire-glows', 'fire-soot'].map(n => scene.getObjectByName(n)!.visible);
    expect(hidden()).toEqual([false, false, false, false]);
    expect(fx.warmRoots()).toEqual([fx.group]);
    expect(fx.group.visible).toBe(true); // (a visible root over hidden meshes: the warm-up compiles them)
    const added: string[] = [];
    fx.smoke = {
      addSmokeEmitter: o => { added.push(`plume ${new THREE.Color(o.color).getHexString()}`); return {setPos() {}, stop() { added.push('stop'); }}; },
      addScatterLight: () => { added.push('scatter+'); return true; }, removeScatterLight: () => { added.push('scatter-'); return true; },
    };
    const bb = body(0.4, 3, 1e6, {nonGraphic: true});
    const w = world({wallZ: 5, enemies: [bb], player: {x: 0, y: 0, z: 0, alive: true, hp: 100}});
    w.env.view = fx;
    const eye = {x: 0, y: 1.6, z: 0};
    w.sys.streamStart(EYE);
    for (let i = 0; i < 20; i++) { w.sys.flame(EYE, FWD, TICK); for (let k = 0; k < 6; k++) { w.sys.tick(1 / 60); fx.frame(1 / 60, w.sys, {muzzle: {x: 0.2, y: 1.4, z: 0.4}, pilot: true, eye}); } }
    expect(w.sys.alight.has(bb)).toBe(true);
    expect(fx.live.flames).toBeGreaterThan(40);
    expect(fx.live.smoke).toBeGreaterThan(0);
    expect(hidden()).toEqual([true, true, true, true]);
    expect(fx.light.intensity).toBeGreaterThan(1);
    expect(fx.light.position.z).toBeGreaterThan(3);
    expect(added).toContain('scatter+');
    expect(added.some(a => a.startsWith('plume'))).toBe(true);
    expect(fx.counts.soot).toBeGreaterThanOrEqual(1);
    // nothing ON the non-graphic body: with only it alight (no stream, no patches) no flame is spawned
    w.sys.streamEnd(false);
    w.sys.patches.length = 0;
    const before = fx.counts.flames;
    for (let k = 0; k < 30; k++) fx.frame(1 / 60, w.sys, {muzzle: null, pilot: false, eye});
    expect(w.sys.alight.has(bb)).toBe(true);
    expect(fx.counts.flames).toBe(before);
    // an ordinary body alight does get flames
    const z = body(0, 2, 1e6);
    w.sys.alight.set(z, {left: 3, acc: 0} as never);
    for (let k = 0; k < 30; k++) fx.frame(1 / 60, w.sys, {muzzle: null, pilot: false, eye});
    expect(fx.counts.flames).toBeGreaterThan(before);
    fx.clear();
    expect(hidden()).toEqual([false, false, false, false]);
    expect(fx.light.intensity).toBe(0);
    expect(fx.live).toEqual({flames: 0, smoke: 0});
    expect(added).toContain('scatter-');
    expect(added).toContain('stop');
  });
});
