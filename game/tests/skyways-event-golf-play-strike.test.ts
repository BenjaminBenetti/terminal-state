// Task studio-skywalk-events-20261115-193624-01 (layout version 7, lane GOLF-PLAY): the PUTTER's stroke from the REAL swing path — the
// real WeaponController with PUTTER_DEF (press -> windup -> hold = charge -> release -> ONE 'contact') handing its contact to the REAL
// Game.meleeContact / puttGolfBall (a minimal shell on Game.prototype) over the synthetic lane (tests/helpers/golfPlayCourse.ts: the real
// PhysicsSystem, PickupManager, golf-ball pickups):
//  - the power: a tap putts at PUTT_POWER.minSpeed, the full 2 s hold at maxSpeed, the speed grows as sqrt (the roll distance linearly);
//  - the ball in the head's low sector in front of the feet leaves ALONG THE FACING (not the line to the ball) at puttSpeed(charge) with
//    its rolling spin and rolls on the turf; one ball per stroke (the nearest, then the most centred);
//  - nothing is struck behind, beside (past 40 deg), too far / near, up on a table top, or behind a wall (the swing is a plain club swing);
//  - enemies take the light club through the normal ray fan (20 body / 40 head x the charge's damage scale, one target), in the same
//    stroke as a putt; the hint; owned wares are never struck.
import {describe, expect, it, vi} from 'vitest';
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {DT, LANE_Z, TURF, golfLane, golfWorld, type GolfLane, type GolfWorld} from './helpers/golfPlayCourse';
import {WEAPONS, WeaponController, type TriggerInput, type WeaponDef, type WeaponEvent} from '../src/weapons/weapons';
import {PUTTER_DEF, PUTTER_MELEE, PUTT_POWER, puttSpeed} from '../src/weapons/putter';
import {PUTT_SECTOR, isPuttable} from '../src/combat/putterStrike';
import {meleeDamage} from '../src/combat/melee';
import {meleeHint, meleeHitDamage, meleeSwing} from '../src/combat/meleeImpact';
import {GOLF_BALL_ITEM, GOLF_BALL_R, PUTTER_ITEM} from '../src/gen/skyways/events/golfContract';
import {levelsOf} from '../src/gen/levels';
import {Inventory} from '../src/items/inventory';
import {GOLF_ROLL} from '../src/physics/golfBall';
import type {Pickup} from '../src/world/pickups';

const GAME_SRC = fileURLToPath(new URL('../src/game.ts', import.meta.url));
const NONE: TriggerInput = {held: false, pressed: false, reload: false, lowered: false};
const EYE = 1.6;

/**
 * A stand-in enemy (the fields Game.meleeContact reads): the head / torso / limb volumes of weapon-variety-melee.test.ts; `lean` (m) puts
 * the body that far behind the head along +x (a lunging one: its head alone in the club's reach).
 */
function zed(x: number, z: number, lean = 0, y = TURF) {
  const hits: {amount: number}[] = [];
  const brain = {alive: true, x, y, z, hp: 100, type: 'walker', stats: {radius: 0.3},
    damage(amount: number) { hits.push({amount}); brain.hp -= amount; if (brain.hp <= 0) brain.alive = false; return !brain.alive; }};
  const bx = x + lean;
  return {brain, hits, hitFlash: 0, nonGraphic: false, hitVolumes: [
    {part: 'head', a: {x, y: y + 1.65, z}, b: null, r: 0.12},
    {part: 'torso', a: {x: bx, y: y + 0.95, z}, b: {x: bx, y: y + 1.45, z}, r: 0.2},
    {part: 'limb', a: {x: bx, y: y + 1.4, z: z + 0.25}, b: {x: bx, y: y + 0.85, z: z + 0.3}, r: 0.06},
  ]};
}
type Zed = ReturnType<typeof zed>;

/** The lane + a player standing on the turf at (x, z) + Game.meleeContact on a shell of Game.prototype. */
async function rig(o: {lane?: GolfLane; x?: number; z?: number; zombies?: Zed[]} = {}) {
  const {Game} = await import('../src/game');
  const w = golfWorld(o.lane ?? golfLane());
  const px = o.x ?? 6, pz = o.z ?? LANE_Z;
  const player = {alive: true, x: px, y: TURF, z: pz, spendStamina: () => true};
  const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.05, 200);
  camera.position.set(px, TURF + EYE, pz);
  const sfx: string[] = [], alerts: number[] = [];
  const weapon = new WeaponController();
  const shell = {
    player, camera, state: 'playing', levels: levelsOf(w.layout), layout: w.layout, zombies: o.zombies ?? [],
    marketCombat: {meleeTargets: () => [], isCombatant: () => false}, weapon, pickups: w.pm,
    physics: {dynamicItems: w.ph.dynamicItems, ragdoll: vi.fn()},
    sfx: new Proxy({}, {get: (_t, k) => () => { sfx.push(String(k)); }}),
    damage: {beginShot: () => {}, hitZombie: vi.fn(), corpseHit: () => null, knockPickups: () => 0, hitWorld: vi.fn(), structuralClassAt: () => 'concrete'},
    corpses: null, stock: {pelletHit: () => null, shoot: vi.fn()}, fx: {impact: vi.fn()}, hud: {hitmarker: vi.fn()}, stats: {kills: 0},
    prof: {begin: () => {}, end: () => {}}, meleeShoves: {add: vi.fn()}, meleeLog: [] as {kind: string; [k: string]: unknown}[], time: 0,
    alertZombies: (r: number) => { alerts.push(r); },
  };
  Object.setPrototypeOf(shell, Game.prototype);
  const contact = (def: WeaponDef) => (shell as unknown as {meleeContact(d: WeaponDef): void}).meleeContact(def);
  const look = (x: number, y: number, z: number) => { camera.lookAt(x, y, z); camera.updateMatrixWorld(true); };
  /** One swing of the equipped putter: a tap (hold 0) or a press held `hold` s, then released; its contact goes to Game.meleeContact. */
  const swing = (hold: number): WeaponEvent[] => {
    const inv = new Inventory(), all: WeaponEvent[] = [];
    if (weapon.def?.id !== PUTTER_ITEM) weapon.equip(inv.makeStack(PUTTER_ITEM, 1));
    for (let i = 0; i < 60 && weapon.phase === 'equipping'; i++) weapon.update(DT, NONE, inv);
    expect(weapon.def).toBe(PUTTER_DEF);
    let t = 0;
    const frame = (inp: TriggerInput) => { for (const e of weapon.update(DT, inp, inv)) { all.push(e); if (e.type === 'contact') contact(e.def); } t += DT; };
    frame({...NONE, pressed: true, held: hold > 0});
    while (t < hold - 1e-9) frame({...NONE, held: true});
    for (let i = 0; i < 120 && weapon.phase === 'swinging'; i++) frame(NONE);
    return all;
  };
  const sphere = (): CANNON.Body | undefined => w.ph.world?.bodies.find(b => b.shapes[0] instanceof CANNON.Sphere);
  return {w, shell, player, camera, sfx, alerts, look, swing, sphere, putts: () => w.ph.dynamicItems.stats().counts.putts};
}

const pose = (p: Pickup) => [...p.obj.position.toArray(), ...p.obj.quaternion.toArray()];

describe('the power: the swing\'s hold sets the putt (real WeaponController)', () => {
  it('a tap = PUTT_POWER.minSpeed, the full 2 s hold = maxSpeed; v = sqrt(min^2 + (max^2 - min^2) k): the roll distance grows linearly', () => {
    expect(puttSpeed(0)).toBe(PUTT_POWER.minSpeed);
    expect(puttSpeed(1)).toBeCloseTo(PUTT_POWER.maxSpeed, 12);
    expect(puttSpeed(2)).toBeCloseTo(PUTT_POWER.maxSpeed, 12); // clamped
    expect(puttSpeed(Number.NaN)).toBe(PUTT_POWER.minSpeed);
    const roll = (k: number) => puttSpeed(k) ** 2 / (2 * GOLF_ROLL.decel);
    for (const k of [0.1, 0.3, 0.6, 0.9]) expect(roll(k + 0.1) - roll(k)).toBeCloseTo(roll(0.1) - roll(0), 9); // linear in the hold
    expect(roll(0)).toBeLessThan(0.2); // a tap: a hand span
    expect(roll(1)).toBeGreaterThan(14); // the full hold: the length of a long hole
    expect(PUTTER_MELEE.charge!.time).toBe(2);
    expect(PUTTER_DEF.interval).toBeCloseTo(PUTTER_MELEE.windup + PUTTER_MELEE.sweep + PUTTER_MELEE.recovery, 12);
  });

  it('the controller: a tap contacts with charge 0, a 1.2 s hold with ~0.5, a 2.6 s hold with 1; one contact per swing, strike s after the release', async () => {
    const r = await rig();
    r.look(7, 0, LANE_Z);
    for (const [hold, k] of [[0, 0], [1.2, 0.5], [2.6, 1]] as const) {
      const ev = r.swing(hold);
      const contacts = ev.filter(e => e.type === 'contact'), swings = ev.filter(e => e.type === 'swing');
      expect(contacts.length, `hold ${hold}`).toBe(1);
      expect(swings.length).toBe(1);
      const c = contacts[0] as Extract<WeaponEvent, {type: 'contact'}>;
      expect(c.def.id).toBe(PUTTER_ITEM);
      expect(c.charge!, `hold ${hold}`).toBeCloseTo(k, 1);
    }
  });

  it('the hotbar hint: hold to set the power, the live power in tens of percent while wound up', () => {
    expect(meleeHint(PUTTER_DEF, false, 0)).toBe('Hold to set the putt power · release to putt');
    expect(meleeHint(PUTTER_DEF, true, 0.57)).toBe('Putt power 50 % · release to putt');
    expect(meleeHint(PUTTER_DEF, true, 1)).toBe('Putt power 100 % · release to putt');
  });
});

describe('the stroke: Game.meleeContact -> puttGolfBall on the real pickups / physics', () => {
  it('the ball in the head sector leaves ALONG THE FACING at puttSpeed(charge) with its rolling spin, rolls on the turf; tap and full hold', async () => {
    for (const [hold, k] of [[0, 0], [2.6, 1]] as const) {
      const r = await rig();
      const ball = r.w.ball(6.6, LANE_Z + 0.15); // 0.62 m ahead, 14 deg off the facing
      r.look(6.6, TURF + GOLF_BALL_R, LANE_Z); // looking down the lane (+x), at the ball's distance
      const ev = r.swing(hold); // (the swing's recovery frames run no physics: the ball's velocity is still the launch's)
      expect(ev.some(e => e.type === 'contact')).toBe(true);
      expect(r.putts(), `hold ${hold}`).toBe(1);
      const body = r.sphere();
      expect(body, 'the ball simulates').toBeDefined();
      const at = {v: body!.velocity.clone(), w: body!.angularVelocity.clone()};
      const log = r.shell.meleeLog.at(-1)!;
      expect(log.kind).toBe('putt');
      expect(log.speed as number).toBeCloseTo(puttSpeed(k), 3);
      expect(log.charge as number).toBeCloseTo(k, 1);
      expect(r.sfx).toContain('impact'); // the click
      expect(r.alerts, 'a putt is no fight noise').toEqual([]);
      // launched straight down the lane (the facing), not along the line to the ball (+14 deg)
      expect(Math.abs(Math.atan2(at.v.z, at.v.x))).toBeLessThan(1e-6);
      expect(Math.hypot(at.v.x, at.v.z)).toBeCloseTo(puttSpeed(k), 6);
      expect(at.w.z).toBeCloseTo(-puttSpeed(k) / GOLF_BALL_R, 3); // rolling along +x: omega = (up x v) / r
      const z0 = r.w.centre(ball).z;
      r.w.step(hold ? 12 : 3);
      const c = r.w.centre(ball);
      expect(Math.abs(c.z - z0), 'kept its line').toBeLessThan(hold ? 0.12 : 1e-3);
      expect(c.y).toBeCloseTo(TURF + GOLF_BALL_R, 3);
      if (hold) expect(r.w.ph.dynamicItems.stats().counts.ballCcd).toBeGreaterThan(0); // the long putt met the far end rail
      else { expect(c.x - 6.6).toBeGreaterThan(0.05); expect(c.x - 6.6).toBeLessThan(0.3); }
    }
  });

  it('nothing is struck behind, beside past 40 deg, too far / too near, up on a table top or behind a wall: then it is a plain club swing', async () => {
    const half = PUTT_SECTOR.halfAngle + 0.15, d = 0.6;
    const cases: [string, number, number, number?][] = [
      ['behind', 6 - d, LANE_Z],
      ['beside', 6 + d * Math.cos(half), LANE_Z + d * Math.sin(half), 0], // off the lane, on the floor
      ['too far', 6 + PUTT_SECTOR.maxR + 0.1, LANE_Z],
      ['too near', 6 + PUTT_SECTOR.minR - 0.06, LANE_Z],
      ['table top', 6.6, LANE_Z, 0.6],
    ];
    for (const [name, x, z, y] of cases) {
      const r = await rig();
      const ball = r.w.ball(x, z, y ?? TURF), before = pose(ball);
      r.look(6.6, TURF + GOLF_BALL_R, LANE_Z);
      r.swing(0);
      expect(r.putts(), name).toBe(0);
      expect(r.shell.meleeLog.some(e => e.kind === 'putt'), name).toBe(false);
      expect(r.shell.meleeLog.length, `${name}: the swing still happened`).toBe(1);
      r.w.step(0.5);
      expect(pose(ball), name).toEqual(before);
    }
    // a wall (cells x 7.0 .. 7.5 across the lane) between the player at 6.6 and a ball at 7.75 (1.15 m: in the sector) — and the control
    for (const wall of [true, false]) {
      const r = await rig({lane: golfLane({solid: wall ? [[14, 15], [14, 16]] : []}), x: 6.6});
      r.w.ball(7.75, LANE_Z);
      r.look(7.75, TURF + GOLF_BALL_R, LANE_Z);
      r.swing(0);
      expect(r.putts(), `wall ${wall}`).toBe(wall ? 0 : 1);
    }
  });

  it('ONE ball per stroke: the nearest in the sector, then the most centred; the other lies untouched', async () => {
    {
      const r = await rig();
      const near = r.w.ball(6.5, LANE_Z), far = r.w.ball(6.95, LANE_Z + 0.1), before = pose(far);
      r.look(6.6, TURF, LANE_Z);
      r.swing(0);
      expect(r.putts()).toBe(1);
      expect(r.w.ph.world!.bodies.filter(b => b.shapes[0] instanceof CANNON.Sphere).length).toBe(1);
      r.w.step(1.5); // a tap rolls ~0.13 m: it never reaches the far ball
      expect(r.w.centre(near).x).toBeGreaterThan(6.55);
      expect(pose(far)).toEqual(before);
    }
    {
      const r = await rig();
      const d = 0.6, a = 10 * Math.PI / 180, b = 25 * Math.PI / 180;
      const centred = r.w.ball(6 + d * Math.cos(a), LANE_Z - d * Math.sin(a)), wide = r.w.ball(6 + d * Math.cos(b), LANE_Z + d * Math.sin(b)), before = pose(wide);
      r.look(6.6, TURF, LANE_Z);
      r.swing(0);
      expect(r.putts()).toBe(1);
      r.w.step(1);
      expect(pose(wide)).toEqual(before);
      expect(r.w.centre(centred).x).toBeGreaterThan(6 + d * Math.cos(a) + 0.05);
    }
  });

  it('enemies take the light club through the normal ray fan: 20 body / 40 head x the charge\'s damage scale, one target — in the same stroke as a putt', async () => {
    expect(meleeDamage(PUTTER_DEF, 'torso')).toBe(20);
    expect(meleeDamage(PUTTER_DEF, 'head')).toBe(40);
    for (const [part, hold] of [['head', 0], ['torso', 0], ['torso', 2.6], ['head', 2.6]] as const) {
      // the club's low fan meets the near torso first; a lunging one (its body 0.6 m behind, out of reach) offers the head alone
      const lean = part === 'head' ? 0.6 : 0, z1 = zed(6.9, LANE_Z, lean), z2 = zed(6.9, LANE_Z + 0.45, lean);
      const r = await rig({zombies: [z1, z2]});
      r.w.ball(6.6, LANE_Z); // at the feet, in the head sector: putted by the same stroke
      r.look(6.9, part === 'head' ? TURF + 1.65 : TURF + 1.2, LANE_Z);
      r.swing(hold);
      const k = hold ? 1 : 0;
      const enemy = r.shell.meleeLog.filter(e => e.kind === 'enemy');
      expect(enemy.length, `${part} ${hold}`).toBe(1); // maxTargets 1
      expect(enemy[0].part).toBe(part);
      expect(z1.hits.length + z2.hits.length).toBe(1);
      const amount = meleeHitDamage(PUTTER_DEF, part, meleeSwing(PUTTER_MELEE, k, false), 0);
      expect([...z1.hits, ...z2.hits][0].amount).toBeCloseTo(amount, 9);
      expect(amount).toBeCloseTo((part === 'head' ? 40 : 20) * (hold ? 1.25 : 0.9), 9);
      expect(r.putts(), 'and the ball at the feet').toBe(1);
      expect(r.alerts).toEqual([PUTTER_DEF.noise]); // a club hit: the melee's quiet noise
      expect(r.shell.hud.hitmarker).toHaveBeenCalledTimes(1);
    }
  });

  it('owned wares are never struck; only golf balls are puttable; the stroke sits after the charge / stamina and before the ray-fan results', async () => {
    expect(isPuttable({stack: {itemId: GOLF_BALL_ITEM}})).toBe(true);
    expect(isPuttable({stack: {itemId: GOLF_BALL_ITEM}, owner: {stall: 1}})).toBe(false);
    expect(isPuttable({stack: {itemId: 'bandage'}})).toBe(false);
    const r = await rig();
    const ball = r.w.ball(6.6, LANE_Z), before = pose(ball);
    (ball as Pickup & {owner?: unknown}).owner = {stall: 3};
    r.look(6.6, TURF, LANE_Z);
    r.swing(0);
    expect(r.putts()).toBe(0);
    expect(pose(ball)).toEqual(before);
    // the putter is an ordinary melee weapon in the registry (equip / swing like every other)
    expect(WEAPONS[PUTTER_ITEM]).toBe(PUTTER_DEF);
    const src = readFileSync(GAME_SRC, 'utf8');
    const fn = src.slice(src.indexOf('  private meleeContact('), src.indexOf('  private meleeProps('));
    const stroke = fn.indexOf('if (def.id === PUTTER_ITEM && this.puttGolfBall(fwd, charge) && !sweep.hits.length) return;');
    expect(stroke).toBeGreaterThan(fn.indexOf('const swing = meleeSwing(m, charge, !this.player.spendStamina(meleeStaminaCost(m, charge)));'));
    expect(stroke).toBeLessThan(fn.indexOf('const res0 = sweep.contact;'));
    expect(src).toMatch(/balls: \(\) => this\.pickups\.list\.filter\(isPuttable\)/);
  });
});
