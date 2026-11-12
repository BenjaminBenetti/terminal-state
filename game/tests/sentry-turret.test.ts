// Task studio-train-crafting-v1-20261111-225628-01 (lane SENTRY): THE ROOF TURRET'S RUNTIME (world/sentryTurret.ts) on a generated Subway
// layout with the REAL parked train runtime (its car boxes in the bullet's world), the real Levels rays, the real Player body, real
// ZombieActors (their own hit volumes and brains) and a fake train-equipment system (helpers/sentryFixture.ts):
//  - targeting: the nearest enemy with a clear shot (one under the eaves is passed over), a wall between = no shot, the player's body
//    in the line = it holds fire, dead / ragdolled / dormant / rising enemies are skipped, the range limit, the head when the chest is
//    hidden by the roof;
//  - firing: one loaded round per shot (the round leaves first), the cadence, stops at 0 and stows; the rifle's damage numbers (part
//    multipliers, falloff from the pivot), an enemy in front takes the hit, a miss marks the world (lane handlers first); a kill = the
//    game's kill path once; the brain is hurt FROM THE TRAIN; gunfire noise at the train; the player's own shot statistics untouched;
//  - lifecycle: stowed and silent when unplugged / riding / empty / the player dead / not playing; redeploys on arrival; hidden
//    through a ride (it stays on the riding car); a rebuild keeps nothing stale; the warm pool; the view's pivots agree with the rules.
import * as THREE from 'three';
import {afterEach, beforeAll, describe, expect, it} from 'vitest';
import {installCanvasShim} from './helpers/canvas2d';
import {DT, loadZombieModels, placeZombie, sentryWorld, syncBody, teardownSentryWorlds, type SentryWorld} from './helpers/sentryFixture';
import type {EnemyActor} from '../src/ai/creatureArchetypes';
import {HEARING} from '../src/ai/brain';
import {TRAIN_TURRET_MEASURED as TM} from '../src/assets/trainEquipment.generated';
import {SENTRY, aimPoint, hullExit, ownHullClear, turretMuzzle, turretPivot, type V3} from '../src/craft/sentry';
import {turretMount} from '../src/craft/trainFixtures';
import {trainToWorld} from '../src/gen/playerTrain';
import {killImpulseStrength} from '../src/physics/world';
import {WarmupRegistry} from '../src/render/warmup';
import {WEAPONS, WeaponController} from '../src/weapons/weapons';
import {PLAYER_TRAIN_SPEC as SPEC} from '../src/world/playerTrainSpec';
import {SENTRY_TEXT, SentryTurretSystem, type SentryEnemy, type SentryHost} from '../src/world/sentryTurret';
import {SentryTurretView} from '../src/world/sentryTurretView';

installCanvasShim(false);
afterEach(teardownSentryWorlds);
beforeAll(loadZombieModels, 180000);

const HW = SPEC.width / 2, PIV = turretPivot(SPEC), DEF = WEAPONS.rifle;
/** No spread: every round goes down the aim line. */
const STRAIGHT = () => 0;

/** A real zombie standing at train-local (lx, lz) on the floor there, in the enemy list. */
function zombieAt(s: SentryWorld, lx: number, lz: number, hp = 1e6): EnemyActor {
  const f = s.stand(lx, lz);
  if (!f) throw new Error(`no floor at train-local (${lx}, ${lz})`);
  const z = placeZombie(f);
  z.brain.hp = hp;
  s.host.zombies.push(z);
  return z;
}

/** `body` as an enemy with only its `part` volumes (the same brain; its body still follows the brain). */
function only(body: EnemyActor, part: 'head' | 'limb'): EnemyActor {
  return Object.create(body, {
    hitVolumes: {get: () => body.hitVolumes.filter(v => v.part === part)},
    syncTransform: {value: () => body.syncTransform()},
    updateVolumes: {value: () => body.updateVolumes()},
  }) as EnemyActor;
}

/** Records what the brain is told (the calls still reach the real brain). */
function spy(z: EnemyActor) {
  const hits: {amount: number; x: number; z: number; y?: number}[] = [], heard: {x: number; z: number; r: number; y?: number}[] = [];
  const b = z.brain, dmg = b.damage.bind(b), hear = b.hear.bind(b);
  b.damage = (amount, fx, fz, fy, o) => { hits.push({amount, x: fx, z: fz, y: fy}); return dmg(amount, fx, fz, fy, o); };
  b.hear = (x, zz, r, y) => { heard.push({x, z: zz, r, y}); hear(x, zz, r, y); };
  return {hits, heard};
}

/** The aim point of a body part (world). */
function aim(z: SentryEnemy, part: 'torso' | 'head'): V3 {
  const o = {x: 0, y: 0, z: 0};
  expect(aimPoint(z.hitVolumes, part, o)).toBe(true);
  return o;
}

/** The world line pivot -> `to` clears the car's own roof (the pure rule), and where it leaves the outline. */
function hullLine(s: SentryWorld, to: V3): {clear: boolean; origin: V3 | null} {
  const piv = s.pivot(), d = Math.hypot(to.x - piv.x, to.y - piv.y, to.z - piv.z);
  const dw = {x: (to.x - piv.x) / d, y: (to.y - piv.y) / d, z: (to.z - piv.z) / d}, dl = {x: dw.x * s.p.front, y: dw.y, z: dw.z * s.p.front};
  const clear = ownHullClear(PIV, dl, d, SPEC), tx = hullExit(PIV, dl, d, SPEC);
  return {clear, origin: tx === null ? null : {x: piv.x + dw.x * tx, y: piv.y + dw.y * tx, z: piv.z + dw.z * tx}};
}

describe('sentry turret: targeting', () => {
  it('rises when plugged in and loaded, then fires at the NEAREST enemy with a clear shot — one under the eaves is passed over', () => {
    const s = sentryWorld({ammo: 60, rand: STRAIGHT});
    const eaves = zombieAt(s, PIV.x, -(HW + 1.0)), near = zombieAt(s, PIV.x + 1, -6.5, 60), far = zombieAt(s, PIV.x - 2, -9.5);
    const hp = far.brain.hp, hpE = eaves.brain.hp;
    // hidden in the roof, then rising over SENTRY.deployS: nothing is fired before it is up
    expect([s.sys.deploy, s.sys.view.root.visible]).toEqual([0, false]);
    s.run(SENTRY.deployS / 2);
    expect(s.sys.deploy).toBeGreaterThan(0.4); expect(s.sys.deploy).toBeLessThan(0.6);
    expect(s.sys.view.root.visible).toBe(true);
    expect(s.sys.view.root.position.y).toBeLessThan(turretMount(SPEC).y);
    expect(s.sys.counts.shots).toBe(0);
    s.run(SENTRY.deployS / 2 + 0.05);
    expect(s.sys.deploy).toBe(1);
    expect(s.sys.view.root.position.y).toBeCloseTo(turretMount(SPEC).y, 9);
    // the nearer of the two clear ones is the target; the one under the eaves (nearest of all) cannot be shot
    expect(hullLine(s, aim(eaves, 'torso')).clear).toBe(false);
    expect(hullLine(s, aim(eaves, 'head')).clear).toBe(false);
    s.run(1.2);
    expect(s.sys.target).toBe(near);
    expect(s.sys.counts.shots).toBeGreaterThan(0);
    expect(near.brain.hp).toBeLessThan(60);
    expect([far.brain.hp, eaves.brain.hp]).toEqual([hp, hpE]);
    // it dies (3 torso hits of 24 on 60 hp), the turret turns to the next nearest clear one
    s.run(2.5);
    expect(near.brain.alive).toBe(false);
    expect(s.sys.target).toBe(far);
    expect(far.brain.hp).toBeLessThan(hp);
    expect(eaves.brain.hp).toBe(hpE);
    expect(s.host.stats.kills).toBe(1);
  });

  it('a wall between the turret and the enemy: no target, no shot, the rounds stay — it only scans', () => {
    const s = sentryWorld({ammo: 30, rand: STRAIGHT});
    const z = zombieAt(s, -4, -19); // beyond the platform's back wall
    const chest = aim(z, 'torso'), line = hullLine(s, chest);
    expect(line.clear).toBe(true); // (not the roof: the wall)
    expect(s.levels.lineOfSight(line.origin!, chest)).toBe(false);
    s.deploy();
    const yaw = s.sys.yaw;
    s.run(3);
    expect(s.sys.deploy).toBe(1);
    expect(s.sys.target).toBeNull();
    expect([s.sys.counts.shots, s.unit.ammo, z.brain.hp]).toEqual([0, 30, 1e6]);
    expect(s.sys.yaw).not.toBe(yaw); // the idle sweep
    expect(s.sys.pitch).toBeCloseTo(SENTRY.scanPitch, 9);
    // the same enemy stepped out onto the platform: shot
    const f = s.stand(-4, -7)!;
    z.brain.x = f.x; z.brain.z = f.z; z.brain.y = f.y;
    syncBody(z);
    s.run(1.5);
    expect(s.sys.target).toBe(z);
    expect(s.sys.counts.shots).toBeGreaterThan(0);
  });

  it('holds fire while the player stands in or near the line; fires again once the player is clear; never with the player dead', () => {
    const s = sentryWorld({ammo: 30, rand: STRAIGHT});
    const z = zombieAt(s, PIV.x, -9);
    // the player on the platform between the car and the enemy: the line passes through the head
    const mid = s.stand(PIV.x, -7.5)!;
    s.player.spawn(mid.x, mid.z, 0, mid.y);
    s.run(3);
    expect(s.sys.deploy).toBe(1);
    expect([s.sys.counts.shots, s.unit.ammo]).toEqual([0, 30]);
    expect(s.sys.counts.holds).toBeGreaterThan(0);
    expect(s.sys.target).toBeNull();
    // a step short of the safe radius beside the line: still held; well beside it: fire
    const beside = s.stand(PIV.x + SENTRY.safeRadius - 0.15, -7.5)!;
    s.player.spawn(beside.x, beside.z, 0, beside.y);
    s.run(1.5);
    expect(s.sys.counts.shots).toBe(0);
    const clear = s.stand(PIV.x + 2.5, -7.5)!;
    s.player.spawn(clear.x, clear.z, 0, clear.y);
    s.run(1.5);
    expect(s.sys.target).toBe(z);
    const n = s.sys.counts.shots;
    expect(n).toBeGreaterThan(0);
    // the player dies: the turret stops firing (it keeps its rounds)
    s.player.alive = false;
    const ammo = s.unit.ammo;
    s.run(2);
    expect([s.sys.counts.shots, s.unit.ammo]).toEqual([n, ammo]);
  });

  it('skips the dead, the ragdolled, the dormant and the rising; only a living, standing, awake enemy is shot', () => {
    const s = sentryWorld({ammo: 40, rand: STRAIGHT});
    const dead = zombieAt(s, PIV.x - 1, -5.5), rag = zombieAt(s, PIV.x + 1, -5.5), dormant = zombieAt(s, PIV.x, -6), rising = zombieAt(s, PIV.x + 2, -6);
    const live = zombieAt(s, PIV.x - 1, -9.5);
    dead.brain.damage(1e9, 0, 0);
    expect(dead.brain.alive).toBe(false);
    rag.ragdolled = true;
    dormant.brain.state = 'dormant';
    rising.brain.state = 'rise';
    const spies = [dead, rag, dormant, rising].map(spy);
    s.run(3.5);
    expect(s.sys.target).toBe(live);
    expect(s.sys.counts.shots).toBeGreaterThan(3);
    expect(s.sys.counts.hits).toBe(s.sys.counts.shots); // every round reached the one it was aimed at
    expect(live.brain.hp).toBe(1e6 - s.sys.counts.shots * DEF.damage);
    for (const q of spies) expect(q.hits).toEqual([]);
    // woken: the nearer one is the target now
    dormant.brain.state = 'chase';
    s.run(1);
    expect(s.sys.target).toBe(dormant);
  });

  it('the range: an enemy with a clear line beyond SENTRY.range is left alone, inside it is shot; a chest hidden by the roof = the head', () => {
    const s = sentryWorld({ammo: 40, rand: STRAIGHT});
    const z = zombieAt(s, PIV.x + SENTRY.range + 1, -5);
    const piv = s.pivot();
    expect(Math.hypot(z.brain.x - piv.x, z.brain.z - piv.z)).toBeGreaterThan(SENTRY.range);
    expect(s.sys.clearTo(aim(z, 'torso'), s.p)).toBe(true); // (the line itself is clear: only the range excludes it)
    s.run(3);
    expect([s.sys.target, s.sys.counts.shots]).toEqual([null, 0]);
    const f = s.stand(PIV.x + SENTRY.range - 1.5, -5)!;
    z.brain.x = f.x; z.brain.z = f.z; z.brain.y = f.y;
    syncBody(z);
    expect(Math.hypot(z.brain.x - piv.x, z.brain.z - piv.z)).toBeLessThan(SENTRY.range);
    s.run(2);
    expect(s.sys.target).toBe(z);
    expect(s.sys.counts.shots).toBeGreaterThan(0);
    expect(s.sys.targetPart).toBe('torso');
    expect(['torso', 'limb']).toContain(s.sys.lastShot!.part); // (seen from the side an arm can be in front of the chest: the nearest volume takes it)
    expect(s.sys.lastShot!.result).toBe('enemy');
    // close beside the car: the chest is below the roof's edge, the head is not — it aims at the head
    const g = s.stand(PIV.x, -(HW + 2.7))!;
    z.brain.x = g.x; z.brain.z = g.z; z.brain.y = g.y;
    syncBody(z);
    expect(hullLine(s, aim(z, 'torso')).clear).toBe(false);
    expect(hullLine(s, aim(z, 'head')).clear).toBe(true);
    const hp = z.brain.hp, n = s.sys.counts.shots;
    s.until(() => s.sys.counts.shots > n);
    expect(s.sys.counts.shots).toBe(n + 1);
    expect(s.sys.target).toBe(z);
    expect(s.sys.targetPart).toBe('head');
    expect(s.sys.lastShot).toMatchObject({result: 'enemy', part: 'head', damage: DEF.damage * DEF.headMult});
    expect(hp - z.brain.hp).toBe(DEF.damage * DEF.headMult);
    // (each hit knocks it back: a few rounds later its chest is clear of the roof's edge and the turret aims there again)
    s.until(() => s.sys.targetPart === 'torso', 4);
    expect(s.sys.targetPart).toBe('torso');
    expect(hullLine(s, aim(z, 'torso')).clear).toBe(true);
  });

  it('picks at SENTRY.repick with a bounded number of line tests however many enemies there are', () => {
    const s = sentryWorld({ammo: 5, rand: STRAIGHT});
    for (let i = 0; i < 30; i++) zombieAt(s, -6 + (i % 10) * 0.6, -19 - Math.floor(i / 10) * 0.8); // 30 enemies behind the wall
    s.deploy();
    const picks = s.sys.counts.picks, tests = s.sys.counts.lineTests;
    s.run(5);
    const dp = s.sys.counts.picks - picks;
    expect(dp).toBeGreaterThanOrEqual(5 / SENTRY.repick - 2); expect(dp).toBeLessThanOrEqual(5 / SENTRY.repick + 2);
    expect(s.sys.counts.lineTests - tests).toBeLessThanOrEqual(dp * SENTRY.maxChecks * 2); // (torso, then head, per candidate)
    expect(s.sys.counts.shots).toBe(0);
  });
});

describe('sentry turret: firing', () => {
  it('one loaded round per shot (the round leaves first), SENTRY.interval apart; at 0 it stops, says so and stows', () => {
    const s = sentryWorld({ammo: 5, rand: STRAIGHT});
    const z = zombieAt(s, PIV.x, -7);
    const q = spy(z);
    s.deploy();
    const times = s.shotTimes(4);
    expect(times.length).toBe(5);
    for (let i = 1; i < times.length; i++) {
      expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(SENTRY.interval - 1e-9);
      expect(times[i] - times[i - 1]).toBeLessThanOrEqual(SENTRY.interval + 2 * DT);
    }
    expect(s.unit.asked).toEqual([4, 3, 2, 1, 0]); // exactly one round per shot, never below 0
    expect(s.unit.ammo).toBe(0);
    expect(s.sys.counts).toMatchObject({shots: 5, hits: 5, kills: 0, worldHits: 0, misses: 0, emptied: 1, noises: 5});
    expect(q.hits.length).toBe(5);
    // seen and heard, once per shot: the positional rifle shot at the muzzle, flash, tracer, the shared muzzle light
    expect(s.sfx.of('npcShot').map(c => c.args[0])).toEqual(['rifle', 'rifle', 'rifle', 'rifle', 'rifle']);
    expect([s.fx.count('muzzleFlash'), s.fx.count('tracer'), s.lights.length, s.dmg.count('beginShot'), s.dmg.count('hitZombie')]).toEqual([5, 5, 5, 5, 5]);
    const m = turretMuzzle(s.sys.yaw, s.sys.pitch), mw = trainToWorld(s.p, m.x, m.y, m.z), flash = s.fx.of('muzzleFlash')[4].args[0] as THREE.Vector3;
    expect(flash.distanceTo(new THREE.Vector3(mw.x, mw.y, mw.z))).toBeLessThan(0.05);
    const tr = s.fx.of('tracer')[4].args as THREE.Vector3[];
    expect(tr[0].distanceTo(flash)).toBeLessThan(1e-9);
    expect(tr[1].distanceTo(new THREE.Vector3(z.brain.x, aim(z, 'torso').y, z.brain.z))).toBeLessThan(0.9); // ends in the body (it was knocked back since)
    // the player's own shot statistics, hit marker and hit confirm are not the turret's
    expect(s.host.stats).toEqual({kills: 0, shots: 0, hits: 0, headshots: 0});
    for (const cue of ['hitConfirm', 'hitTick', 'shot']) expect(s.sfx.count(cue), cue).toBe(0);
    // empty: one toast, it sinks back into the roof and is hidden; nothing more happens
    expect(s.toasts.map(t => t.text)).toEqual([SENTRY_TEXT.empty('5.56mm')]);
    s.run(SENTRY.deployS + 0.1);
    expect([s.sys.deploy, s.sys.view.root.visible, s.sys.target]).toEqual([0, false, null]);
    s.run(3);
    expect([s.sys.counts.shots, s.unit.ammo, q.hits.length, s.toasts.length]).toEqual([5, 0, 5, 1]);
    // reloaded at the console: it rises and fires again
    s.host.inv.add(s.host.inv.makeStack('ammo_556', 3));
    expect(s.eq.uses.sentry!.tap(s.unit)).toBe(true);
    expect(s.shotTimes(4).length).toBe(3);
    expect(s.unit.ammo).toBe(0);
  });

  it('a crafted (empty) sentry never rises or fires, plugged in beside enemies', () => {
    const s = sentryWorld({ammo: 0, rand: STRAIGHT});
    const z = zombieAt(s, PIV.x, -7);
    s.run(4);
    expect([s.sys.deploy, s.sys.view.root.visible, s.sys.counts.shots, s.unit.ammo, z.brain.hp]).toEqual([0, false, 0, 0, 1e6]);
    expect(s.unit.asked).toEqual([]);
    expect(s.fx.calls.length + s.sfx.calls.length).toBe(0);
  });

  it("the rifle's damage: body x1, head x headMult, falloff by the distance from the pivot; the brain is hurt FROM THE TRAIN", () => {
    const s = sentryWorld({ammo: 40, rand: STRAIGHT});
    const z = zombieAt(s, PIV.x, -8);
    const q = spy(z);
    s.deploy();
    s.until(() => s.sys.counts.shots >= 2);
    const n = s.sys.counts.shots;
    expect(n).toBe(2);
    // torso, within the falloff start: the rifle's damage exactly, from the mount's x / z at the car floor's height
    const piv = s.pivot();
    expect(s.sys.lastShot).toMatchObject({result: 'enemy', part: 'torso', killed: false, damage: DEF.damage});
    for (const h of q.hits) expect(h).toEqual({amount: DEF.damage, x: piv.x, z: piv.z, y: s.p.floorY});
    expect(z.brain.hp).toBe(1e6 - n * DEF.damage);
    expect((z.brain as unknown as {lastKnown: number[]}).lastKnown).toEqual([piv.x, piv.z, s.p.floorY]);
    expect(z.brain.aware).toBe(true);
    expect(z.hitFlash).toBe(1);
    // the damage system got the same shot (wound / blood), the weapon named
    const hz = s.dmg.of('hitZombie')[0].args as [unknown, THREE.Vector3, THREE.Vector3, string, {damage: number; pellet: boolean; weapon: string}];
    expect(hz[0]).toBe(z); expect(hz[3]).toBe('torso'); expect(hz[4]).toEqual({damage: DEF.damage, pellet: false, weapon: 'rifle'});
    // the distance is measured from the pivot (the virtual origin is on the line, not the start of the bullet's travel)
    // (the body has been knocked back by that round since: its chest is DEF.knockback farther now; the round met its surface)
    const chest = aim(z, 'torso'), d = Math.hypot(chest.x - piv.x, chest.y - piv.y, chest.z - piv.z) - DEF.knockback;
    expect(s.sys.lastShot!.dist).toBeGreaterThan(d - 0.35); expect(s.sys.lastShot!.dist).toBeLessThan(d + 0.05);
    expect(Math.hypot(s.sys.lastShot!.origin.x - piv.x, s.sys.lastShot!.origin.z - piv.z)).toBeCloseTo(HW + SENTRY.hullPush, 3);
    // a falloff that starts before the target (the same formula as the player's rifle: WeaponController.falloff)
    const short = {...DEF, falloffStart: 2, range: 20, falloffMin: 0.5};
    (s.sys as unknown as {def: typeof DEF}).def = short;
    q.hits.length = 0;
    s.until(() => q.hits.length > 0);
    expect(q.hits.length).toBe(1);
    const want = DEF.damage * WeaponController.falloff(short, s.sys.lastShot!.dist);
    expect(want).toBeLessThan(DEF.damage * 0.9);
    expect(q.hits[q.hits.length - 1].amount).toBeCloseTo(want, 9);
    expect(s.sys.lastShot!.damage).toBeCloseTo(want, 9);
  });

  it('head x2.5 on a head-only target; an enemy in front of the target takes the round on the part it hits (limb x0.7)', () => {
    const s = sentryWorld({ammo: 40, rand: STRAIGHT});
    const body = zombieAt(s, PIV.x, -8);
    s.host.zombies[0] = only(body, 'head');
    const q = spy(body);
    s.deploy();
    s.until(() => s.sys.counts.shots >= 1);
    expect(s.sys.targetPart).toBe('head');
    expect(s.sys.lastShot).toMatchObject({result: 'enemy', part: 'head', damage: DEF.damage * DEF.headMult});
    expect(q.hits[0].amount).toBe(DEF.damage * DEF.headMult);
    // an arm in the line of fire (another enemy between the turret and the target): it is hit, at the limb multiplier
    s.host.zombies[0] = body;
    s.until(() => s.sys.lastShot?.part === 'torso');
    expect(s.sys.lastShot).toMatchObject({result: 'enemy', part: 'torso', damage: DEF.damage});
    const chest = aim(body, 'torso'), piv = s.pivot(), k = 0.7;
    const c = {x: piv.x + (chest.x - piv.x) * k, y: piv.y + (chest.y - piv.y) * k, z: piv.z + (chest.z - piv.z) * k};
    const other = zombieAt(s, PIV.x - 3, -9.5);
    const arm = Object.create(other, {hitVolumes: {get: () => [{part: 'limb' as const, a: {x: c.x - 0.2, y: c.y, z: c.z}, b: {x: c.x + 0.2, y: c.y, z: c.z}, r: 0.08}]}}) as EnemyActor;
    s.host.zombies[1] = arm;
    const qo = spy(other);
    q.hits.length = 0;
    s.until(() => qo.hits.length >= 2);
    expect(s.sys.target).toBe(body); // (the arm's owner has no chest / head to aim at here: never a target itself)
    expect(qo.hits.length).toBe(2);
    expect(qo.hits[0].amount).toBeCloseTo(DEF.damage * DEF.limbMult, 9);
    expect(q.hits).toEqual([]);
    expect(s.sys.lastShot).toMatchObject({result: 'enemy', part: 'limb'});
  });

  it('a kill is the game kill path, once: the tally, the death cue, a ragdoll shoved by the rifle round; then the next target or none', () => {
    const s = sentryWorld({ammo: 40, rand: STRAIGHT});
    const z = zombieAt(s, PIV.x, -7, 40); // two torso rounds
    const q = spy(z);
    s.deploy();
    s.run(3);
    expect(q.hits.length).toBe(2);
    expect(z.brain.alive).toBe(false);
    expect(s.host.stats).toEqual({kills: 1, shots: 0, hits: 0, headshots: 0});
    expect(s.sys.counts).toMatchObject({shots: 2, hits: 2, kills: 1});
    expect(s.unit.ammo).toBe(38);
    expect(s.sfx.count('zombieDeath')).toBe(1);
    expect(s.ragdolls.length).toBe(1);
    const r = s.ragdolls[0];
    expect(r.target).toBe(z);
    expect(r.impulse.strength).toBe(killImpulseStrength('rifle', 1, 1));
    expect(r.impulse.bone).toBeUndefined();
    expect(r.impulse.dir.length()).toBeCloseTo(1, 6);
    expect(r.impulse.dir.y).toBeLessThan(0); // down from the roof
    expect(r.impulse.point.distanceTo(new THREE.Vector3(z.brain.x, aim(z, 'torso').y, z.brain.z))).toBeLessThan(1.0);
    expect(s.sys.lastShot).toMatchObject({result: 'enemy', killed: true});
    expect(s.sys.target).toBeNull();
    // a head kill names the bone
    const h = zombieAt(s, PIV.x - 1, -8, 30);
    s.host.zombies[1] = only(h, 'head');
    s.run(2);
    expect(h.brain.alive).toBe(false);
    expect(s.host.stats.kills).toBe(2);
    expect(s.ragdolls.length).toBe(2);
    expect(s.ragdolls[1].impulse.bone).toBe('head');
    expect(s.unit.ammo).toBe(37);
  });

  it('gunfire noise at the train: enemies in earshot hear every shot from the car (muffled behind a wall), none beyond the radius', () => {
    const s = sentryWorld({ammo: 3, rand: STRAIGHT});
    const z = zombieAt(s, PIV.x, -7);
    const open = zombieAt(s, PIV.x + 8, -6); // in the open, farther than the target: not shot, but it hears
    const walled = zombieAt(s, -4, -19); // behind the platform's back wall
    const far = zombieAt(s, PIV.x + DEF.noise + 3, -5);
    const qs = [z, open, walled, far].map(spy);
    s.deploy();
    s.shotTimes(2);
    expect(s.sys.counts.shots).toBe(3);
    const piv = s.pivot();
    for (const q of qs.slice(0, 3)) {
      expect(q.heard.length).toBe(3);
      for (const h of q.heard) expect([h.x, h.z, h.y]).toEqual([piv.x, piv.z, s.p.floorY]);
    }
    expect(qs[0].heard[0].r).toBe(DEF.noise);
    expect(qs[1].heard[0].r).toBe(DEF.noise);
    expect(qs[2].heard[0].r).toBeCloseTo(DEF.noise * HEARING.wall, 9); // no sight line: the wall muffles it
    expect(qs[3].heard).toEqual([]);
    expect(open.brain.state).toBe('chase'); // it comes for the train
    expect((open.brain as unknown as {lastKnown: number[]}).lastKnown).toEqual([piv.x, piv.z, s.p.floorY]);
  });

  it('a round that misses marks the world: the lane handlers first (their own shot id below 0), else an impact with the material sound', () => {
    // a small target at long range and the widest spread: the round goes past it
    const wide = (() => { let i = 0; return () => (i++ % 2 === 0 ? 0.25 : 0.999); })();
    const s = sentryWorld({ammo: 2, rand: wide});
    const body = zombieAt(s, PIV.x + 24, -5.5);
    s.host.zombies[0] = only(body, 'head');
    const q = spy(body);
    const offered: {shot: number; damage: number; kind: string}[] = [];
    let take = false;
    s.host.bulletHitHandlers.push(((wh: {kind: string}, _p: THREE.Vector3, _d: THREE.Vector3, shot: number, damage: number) => { offered.push({shot, damage, kind: wh.kind}); return take; }) as never);
    s.deploy();
    s.until(() => s.sys.counts.shots >= 1);
    expect(s.sys.counts).toMatchObject({shots: 1, hits: 0, worldHits: 1});
    expect(q.hits).toEqual([]);
    expect(s.unit.ammo).toBe(1); // the round is spent all the same
    expect(s.sys.lastShot).toMatchObject({result: 'world', damage: 0, part: null});
    expect(offered).toEqual([{shot: -1, damage: DEF.damage * WeaponController.falloff(DEF, s.sys.lastShot!.dist), kind: offered[0].kind}]);
    expect(['wall', 'floor', 'prop', 'ceiling']).toContain(offered[0].kind);
    expect(s.fx.count('impact')).toBe(1);
    const imp = s.fx.of('impact')[0].args as [THREE.Vector3, THREE.Vector3, string, {chips: number}];
    expect(imp[0].distanceTo(new THREE.Vector3(s.sys.lastShot!.end.x, s.sys.lastShot!.end.y, s.sys.lastShot!.end.z))).toBeLessThan(1e-9);
    expect(imp[1].length()).toBeCloseTo(1, 6);
    expect(imp[3]).toEqual({chips: 3});
    expect(s.sfx.count('impact')).toBe(1);
    expect([s.fx.count('tracer'), s.fx.count('muzzleFlash'), s.sfx.count('npcShot')]).toEqual([1, 1, 1]);
    // a lane handler that takes the hit (window glass): no generic impact
    take = true;
    s.until(() => s.sys.counts.shots >= 2);
    expect(s.sys.counts).toMatchObject({shots: 2, worldHits: 2});
    expect(offered.length).toBe(2); expect(offered[1].shot).toBe(-2);
    expect([s.fx.count('impact'), s.sfx.count('impact')]).toEqual([1, 1]);
  });
});

describe('sentry turret: lifecycle', () => {
  it('unplugged: it sinks back and is silent; plugged in again it rises and fires; a second sentry on a higher plug has no turret of its own', () => {
    const s = sentryWorld({ammo: 30, rand: STRAIGHT});
    zombieAt(s, PIV.x, -7);
    s.deploy();
    s.run(1);
    const n = s.sys.counts.shots;
    expect(n).toBeGreaterThan(0);
    s.eq.disconnect(s.unit);
    s.run(DT * 3);
    expect(s.sys.deploy).toBeLessThan(1); expect(s.sys.deploy).toBeGreaterThan(0.9); // sinking, not snapped away
    s.run(SENTRY.deployS + 0.1);
    expect([s.sys.deploy, s.sys.view.root.visible, s.sys.target]).toEqual([0, false, null]);
    s.run(2);
    expect(s.sys.counts.shots).toBe(n);
    const ammo = s.unit.ammo;
    // another loaded sentry on plug 2, then the first one back on plug 0: the lowest plug's hopper feeds the one turret
    const second = s.eq.add('eq-2', 10, 2);
    s.run(2);
    expect(s.sys.deploy).toBe(1);
    expect(second.ammo).toBeLessThan(10);
    expect(s.unit.ammo).toBe(ammo);
    s.eq.connect(s.unit, 0);
    const left = second.ammo;
    s.run(2);
    expect(s.unit.ammo).toBeLessThan(ammo);
    expect(second.ammo).toBe(left);
    expect(s.sys.view.root.parent!.children.filter(c => c.name === 'train-turret').length).toBe(1);
  });

  it('a ride: sinks while the doors close, hidden at once when the car moves, stays on the riding car through the teardown, redeploys on arrival', () => {
    const s = sentryWorld({ammo: 30, rand: STRAIGHT});
    zombieAt(s, PIV.x, -7);
    s.deploy();
    s.run(1);
    const n = s.sys.counts.shots, viewRoot = s.rt.train!.view.root;
    expect(n).toBeGreaterThan(0);
    expect(s.sys.view.root.parent).toBe(viewRoot);
    // departure: riding (the benefit is off), the car not moving yet
    s.host.trainRide.riding = true;
    s.eq.parked = false;
    s.run(DT * 6);
    expect(s.sys.deploy).toBeLessThan(1); expect(s.sys.deploy).toBeGreaterThan(0.8);
    expect(s.sys.target).toBeNull();
    // the car moves: hidden at once
    s.host.trainRide.moving = true;
    s.run(DT);
    expect([s.sys.deploy, s.sys.view.root.visible]).toEqual([0, false]);
    // the old world goes: the turret stays on the riding car's view (hidden), nothing fires on the way
    s.sys.teardown();
    expect(s.sys.view.root.parent).toBe(viewRoot);
    expect(s.sys.view.root.visible).toBe(false);
    s.host.zombies.length = 0;
    s.run(3);
    expect([s.sys.counts.shots, s.sys.deploy, s.sys.view.root.visible]).toEqual([n, 0, false]);
    // arrival: a new world built round the same car; it is parked again
    s.sys.build();
    s.run(1);
    expect(s.sys.deploy).toBe(0); // still riding: stowed
    s.host.trainRide.riding = false; s.host.trainRide.moving = false;
    s.eq.parked = true;
    zombieAt(s, PIV.x, -7);
    s.run(SENTRY.deployS + 2);
    expect([s.sys.deploy, s.sys.view.root.visible]).toEqual([1, true]);
    expect(s.sys.counts.shots).toBeGreaterThan(n);
    expect(s.sys.view.root.parent).toBe(s.rt.train!.view.root);
  });

  it('a teardown / rebuild keeps nothing stale: target, pose, cooldown, last shot and the headroom answer start over; no duplicates', () => {
    const s = sentryWorld({ammo: 30, rand: STRAIGHT});
    const z = zombieAt(s, PIV.x + 3, -7);
    s.deploy();
    s.run(1.2);
    expect(s.sys.target).toBe(z);
    expect(s.sys.lastShot).not.toBeNull();
    expect(s.sys.yaw).not.toBe(0);
    const room = s.sys.headroom(), attached = s.sys.counts.attached;
    for (const h of s.host.sectionHooks) h.teardown?.();
    expect([s.sys.target, s.sys.deploy, s.sys.yaw, s.sys.lastShot, s.sys.view.root.visible, s.sys.view.root.parent]).toEqual([null, 0, 0, null, false, null]);
    expect(s.sys.headroom().ok).toBe(false); // no car here
    s.host.zombies.length = 0;
    for (const h of s.host.sectionHooks) h.build?.(s.lay);
    expect(s.sys.view.root.parent).toBe(s.rt.train!.view.root);
    expect(s.sys.counts.attached).toBe(attached + 1);
    expect(s.sys.headroom()).not.toBe(room); // asked again for this build
    expect(s.sys.headroom().ok).toBe(true);
    expect(s.sys.qa()).toMatchObject({unit: 'eq-1', plugged: true, ammo: s.unit.ammo, attached: true, deployed: false, visible: false, target: null, lastShot: null});
    // the old world's enemy is not remembered: with no enemies it only scans
    const n = s.sys.counts.shots;
    s.run(2.5);
    expect([s.sys.deploy, s.sys.target, s.sys.counts.shots]).toEqual([1, null, n]);
    expect(s.rt.train!.view.root.children.filter(c => c.name === 'train-turret').length).toBe(1);
    // every mesh carries the car's storey; the shadows were marked (once per look)
    s.sys.view.root.traverse(o => { if ((o as THREE.Mesh).isMesh) expect(o.userData.level).toBe(s.p.level); });
    expect(s.shadows.filter(r => r === s.sys.view.root).length).toBe(1);
  });

  it('not playing: nothing moves or fires; leaving play drops the target', () => {
    const s = sentryWorld({ammo: 30, rand: STRAIGHT});
    const z = zombieAt(s, PIV.x, -7);
    s.deploy();
    s.run(1);
    expect(s.sys.target).toBe(z);
    const n = s.sys.counts.shots;
    s.host.state = 'paused';
    for (const l of s.host.stateListeners) l('paused' as never, 'playing' as never);
    expect(s.sys.target).toBeNull();
    s.run(3);
    expect([s.sys.counts.shots, s.sys.deploy]).toEqual([n, 1]);
    s.host.state = 'playing';
    s.run(1);
    expect(s.sys.counts.shots).toBeGreaterThan(n);
  });

  it('registers only through the registries: one frame hook, one section hook pair, the warm pool, the console use, the QA report', () => {
    const s = sentryWorld({ammo: 12, noUnit: false});
    expect(s.host.warmRegistry.names.pools).toContain('train-turret');
    expect(s.host.warmRegistry.poolRoots()).toContain(s.sys.view.root);
    expect(Object.keys(s.eq.uses)).toEqual(['sentry']);
    expect(s.eq.plugListeners.length).toBe(1);
    const q = s.sys.qa();
    expect(q).toMatchObject({unit: 'eq-1', plugged: true, ammo: 12, cap: 300, attached: true, model: false, deployed: false, shots: 0});
    expect(q.headroom).toMatchObject({ok: true});
    // a host without the equipment system yet (or without a train here) is harmless
    const bare = {...s.host, trainEquipment: null, trainRuntime: undefined, frameHooks: [], sectionHooks: [], stateListeners: [], warmRegistry: new WarmupRegistry()};
    const sys = new SentryTurretSystem(bare as unknown as SentryHost).install();
    sys.build();
    for (let i = 0; i < 30; i++) sys.update(DT);
    expect([sys.deploy, sys.view.root.parent, sys.qa().unit]).toEqual([0, null, null]);
    sys.teardown();
  });
});

describe('sentry turret view', () => {
  /** A stand-in for the cooked model: base, yoke and head nodes in the documented frame, a marker at the muzzle. */
  function fakeModel(): THREE.Object3D {
    const root = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial();
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.1, 0.4), mat); base.name = 'turret-base'; base.position.y = 0.05;
    const yoke = new THREE.Group(); yoke.name = 'turret-yoke'; yoke.position.set(0.02, 0.1, -0.03); // (its own origin is not the axis)
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.6), mat); head.name = 'turret-head'; head.position.set(-0.02, 0.2, 0.1);
    const muzzle = new THREE.Object3D(); muzzle.name = 'muzzle-marker';
    muzzle.position.set(TM.muzzle.x - 0, TM.muzzle.y - 0.3, TM.muzzle.z - 0.07); // = the measured muzzle in the model frame
    head.add(muzzle); yoke.add(head); root.add(base, yoke);
    return root;
  }
  const worldOf = (o: THREE.Object3D) => { o.updateWorldMatrix(true, false); return new THREE.Vector3().setFromMatrixPosition(o.matrixWorld); };

  it('the stand-in: hidden when stowed (sunk into the roof, never through the ceiling lining), its barrel tip is the rules muzzle', () => {
    const v = new SentryTurretView(SPEC), m = turretMount(SPEC);
    expect(v.root.visible).toBe(false);
    expect(v.sink).toBeGreaterThan(0.3);
    expect(m.y - v.sink).toBeGreaterThan(SPEC.ceilingY); // the stowed base stays above the saloon's ceiling
    expect(v.root.position.y).toBeCloseTo(m.y - v.sink, 9);
    v.pose(0.5, 0, 0);
    expect(v.root.visible).toBe(true);
    expect(v.root.position.y).toBeCloseTo(m.y - v.sink / 2, 9);
    for (const [yaw, pitch] of [[0, 0], [1.2, 0.25], [-2.4, -0.55]]) {
      v.pose(1, yaw, pitch);
      const barrel = v.root.getObjectByName('turret-barrel') as THREE.Mesh;
      barrel.geometry.computeBoundingBox();
      const bb = barrel.geometry.boundingBox!, tip = new THREE.Vector3((bb.min.x + bb.max.x) / 2, (bb.min.y + bb.max.y) / 2, bb.max.z);
      barrel.updateWorldMatrix(true, false);
      tip.applyMatrix4(barrel.matrixWorld);
      const want = turretMuzzle(yaw, pitch);
      expect(tip.distanceTo(new THREE.Vector3(want.x, want.y, want.z))).toBeLessThan(1e-6);
    }
    v.pose(0, 0.3, 0.1);
    expect(v.root.visible).toBe(false);
    for (const o of v.root.children) expect(o).toBeDefined();
    v.dispose();
  });

  it('the cooked model: the yoke turns about the yaw axis, the head tilts about the measured pitch pivot (whatever the nodes origins)', () => {
    const v = new SentryTurretView(SPEC), src = fakeModel();
    expect(v.setModel(null)).toBe(false);
    expect(v.setModel(src)).toBe(true);
    expect(v.model).not.toBeNull();
    expect(v.model).not.toBe(src); // a clone: the library's scene is not moved
    expect(v.root.getObjectByName('turret-barrel')).toBeUndefined(); // the stand-in is gone
    expect(v.tilts).toBe(TM.pitch);
    const model = v.model!;
    expect(v.setModel(src)).toBe(true);
    expect(v.model).toBe(model); // the same source: not cloned again
    const marker = v.root.getObjectByName('muzzle-marker')!, base = v.root.getObjectByName('turret-base')!;
    v.pose(1, 0, 0);
    const base0 = worldOf(base);
    for (const [yaw, pitch] of [[0, 0], [0.9, 0.3], [-2.2, -0.5], [Math.PI, 0.1]]) {
      v.pose(1, yaw, pitch);
      const want = turretMuzzle(yaw, pitch);
      expect(worldOf(marker).distanceTo(new THREE.Vector3(want.x, want.y, want.z))).toBeLessThan(1e-6);
      expect(worldOf(base).distanceTo(base0)).toBeLessThan(1e-9); // the base ring does not turn
    }
    // every part is skipped by the interaction raycasts
    const rc = new THREE.Raycaster(new THREE.Vector3(PIV.x, 10, 0), new THREE.Vector3(0, -1, 0));
    expect(rc.intersectObject(v.root, true)).toEqual([]);
    v.dispose();
  });

  it('the system swaps the stand-in for the cooked model when the library has it', () => {
    let model: THREE.Object3D | null = null;
    const s = sentryWorld({ammo: 5, model: () => model});
    expect(s.sys.qa().model).toBe(false);
    model = fakeModel();
    s.run(1);
    expect(s.sys.qa().model).toBe(true);
    expect(s.sys.view.root.getObjectByName('muzzle-marker')).toBeDefined();
    s.sys.view.root.traverse(o => { if ((o as THREE.Mesh).isMesh) expect(o.userData.level).toBe(s.p.level); });
    expect(s.shadows.filter(r => r === s.sys.view.root).length).toBe(2); // the stand-in's, then the model's
    expect(s.host.warmRegistry.poolRoots()).toContain(s.sys.view.root);
    expect(s.sys.deploy).toBe(1);
  });
});
