// Task studio-skyways-level-20261106-054448 (lane CAR): the prize car in a world (world/skywaysCar.ts) with the REAL Player / ZombieBrain on
// the hand-built hall (tests/helpers/skywaysCarHost.ts): get in by a door (prompt, refusals), the driver's seat (first-person eye, look
// clamp, the hands busy: input owner / no item use / no set-down), get out (stopped; left -> right -> front / back; "No room to get
// out"), death / state change / teardown; zombies rammed through the real kill path, pushed / slowed / crushed slower, same storey only,
// kept out of the parked car; loose props shoved (bounded) and fixed props stopping it; window panes + prop glass at speed; bullets;
// persistence (record validator + save validation, restore, no duplicate, teardown idempotent); the view (stand-in, the model's paint /
// trim twin / glass, the turning wheel); the audio hook.
import {describe, expect, it} from 'vitest';
import * as THREE from 'three';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {CAR_RT, CAR_TEXT} from '../src/world/skywaysCar';
import {CAR_SPEC, carToWorld} from '../src/world/skywaysCarSpec';
import {CAR_PHYS, nearestCircle} from '../src/world/skywaysCarPhysics';
import {SKYWAYS_CAR_LANE, skywaysCarProblem, skywaysCarRecord} from '../src/world/skywaysCarStore';
import {WHEEL_RATIO, buildCarView, setSkywaysCarModelsForTests, setWheel} from '../src/world/skywaysCarModel';
import {MAX_SHOT_DV} from '../src/physics/dynamicItems';
import {checksumOf} from '../src/save/checksum';
import {validateSaveFile} from '../src/save/validate';
import {levelOfAsset} from '../src/assets/levelAssets';
import {PropIndex} from '../src/core/physics';
import {Harness, fixtureCampaign, sid} from './helpers/saveFixture';
import {HALL, prop} from './helpers/skywaysCarWorld';
import {DT, build, carHost, frame, lookAt, press, run, teardown, zombie, type CarTestHost} from './helpers/skywaysCarHost';
import type {SkywaysCar} from '../src/world/skywaysCar';

const S = CAR_SPEC;

/** Stand at a door's stand point (default the driver's, left), look at the door, press E. */
function getIn(h: CarTestHost, car: SkywaysCar, side: 'left' | 'right' = 'left'): void {
  const b = car.body!, e = S.exits[side], sx = side === 'left' ? -1 : 1;
  const d = carToWorld(b.x, b.z, b.yaw, e.x, e.z), door = carToWorld(b.x, b.z, b.yaw, sx * (S.width / 2 - 0.05), e.z);
  h.player.place(d.x, d.z, 0, b.y);
  frame(h, car);
  lookAt(h, door.x, b.y + 0.9, door.z);
  frame(h, car);
  expect(car.prompt).toBe(CAR_TEXT.getIn);
  press(h, car, 'KeyE');
  expect(car.driving).toBe(true);
}
const stop = (h: CarTestHost, car: SkywaysCar) => { h.keys.held.clear(); h.keys.held.add('KeyS'); run(h, car, 3, () => Math.abs(car.body!.v) < 0.05); h.keys.held.clear(); run(h, car, 0.2); };

describe('skyways car: getting in and out', () => {
  it('[E] by a door, looking at the car: in the driver seat (eye on the left seat, the controls hint); refused far / looking away', () => {
    const {h, car} = carHost();
    expect(car.body).toMatchObject({x: 15, z: 15, yaw: 0, level: 0});
    expect(car.source).toBe('spawn');
    // far away, looking at it: nothing
    h.player.place(15, 24, 0, 0);
    frame(h, car);
    lookAt(h, 15, 0.8, 15);
    frame(h, car);
    expect(car.prompt).toBeNull();
    expect(car.onInteract()).toBe(false);
    // at the door, looking away
    const d = carToWorld(15, 15, 0, S.exits.left.x, S.exits.left.z);
    h.player.place(d.x, d.z, Math.PI / 2, 0); // facing -X (away from the car)
    frame(h, car);
    expect(car.prompt).toBeNull();
    getIn(h, car);
    const eye = carToWorld(15, 15, 0, S.eye.x, S.eye.z);
    expect(h.player.x).toBeCloseTo(eye.x, 6);
    expect(h.player.z).toBeCloseTo(eye.z, 6);
    expect(h.player.y).toBe(0);
    expect(h.player.eye).toBeCloseTo(S.eye.y, 6);
    expect(h.camera.position.y).toBeCloseTo(S.eye.y, 6); // the camera IS the driver's eye
    expect(car.prompt).toBe(CAR_TEXT.driving);
    expect(h.promptProviders[0]()).toBe(CAR_TEXT.driving); // the car's prompt goes first
    expect(h.sfxCalls).toContain('open:fridge'); // the door cue
    expect(car.counts.enters).toBe(1);
  });

  it('refuses getting in while another lane owns the hands, while using an item, dead or climbing', () => {
    const {h, car} = carHost();
    const busy = {on: true};
    h.inputOwners.push(() => busy.on);
    const b = car.body!, d = carToWorld(b.x, b.z, b.yaw, S.exits.left.x, S.exits.left.z);
    h.player.place(d.x, d.z, -Math.PI / 2, 0);
    frame(h, car);
    lookAt(h, b.x - S.width / 2 + 0.05, 0.9, b.z);
    frame(h, car);
    expect(car.prompt).toBeNull();
    expect(car.onInteract()).toBe(false);
    busy.on = false;
    h.use = {itemId: 'bandage'};
    frame(h, car);
    expect(car.onInteract()).toBe(false);
    h.use = null;
    frame(h, car);
    expect(car.prompt).toBe(CAR_TEXT.getIn);
  });

  it('while driving: the hands are busy (input owner, no item use, no set-down), the held item lowers; all released on exit', () => {
    const {h, car} = carHost();
    getIn(h, car);
    expect(h.inputOwners.some(f => f())).toBe(true); // Game: no fire / melee / ADS / flare throws
    expect(car.refuseUse()).toBe(true); // Game.startUse: no item use (H / inventory / click)
    expect(h.toasts).toContain(CAR_TEXT.hands);
    expect(h.gear.placeRules.map(r => r(0, 0, 0, 0))).toContain(CAR_TEXT.placeRule);
    run(h, car, CAR_RT.holsterTime + 0.05);
    expect(car.holster).toBe(1);
    h.keys.mousePressed[0] = true; // a trigger pull: the note (rate-limited), nothing else
    frame(h, car);
    press(h, car, 'KeyE');
    expect(car.driving).toBe(false);
    expect(h.inputOwners.some(f => f())).toBe(false);
    expect(car.refuseUse()).toBe(false);
    expect(h.gear.placeRules.map(r => r(0, 0, 0, 0))).toEqual([null]);
    run(h, car, CAR_RT.holsterTime + 0.05);
    expect(car.holster).toBe(0);
  });

  it('mouse look is relative to the car and clamped to ±150°; the view turns with the car', () => {
    const {h, car} = carHost();
    getIn(h, car);
    const b = car.body!;
    h.player.yaw = b.yaw + 3; // the mouse turned the view ~172° round
    frame(h, car);
    expect(car.lookYaw).toBeCloseTo(CAR_RT.lookYaw, 9);
    h.player.yaw = b.yaw + 0.4;
    frame(h, car);
    expect(car.lookYaw).toBeCloseTo(0.4, 9);
    h.keys.held.add('KeyW'); h.keys.held.add('KeyA');
    run(h, car, 1);
    expect(b.yaw).toBeGreaterThan(0.2);
    expect(h.player.yaw - b.yaw).toBeCloseTo(0.4, 9); // the look kept its angle to the car while it turned
    const eye = carToWorld(b.x, b.z, b.yaw, S.eye.x, S.eye.z);
    expect(h.player.x).toBeCloseTo(eye.x, 9);
    expect(h.player.z).toBeCloseTo(eye.z, 9);
  });

  it('gets out only (nearly) stopped: at the left door, else the right, the front, the back; none -> "No room to get out"', () => {
    // the car hard against the west wall (its left side): the left stand point is in the wall -> the right door
    const {h, car} = carHost({spawn: {x: HALL.wall + 1.0, z: 15}});
    getIn(h, car, 'right'); // (in by the passenger door: the driver slides over)
    h.keys.held.add('KeyW');
    run(h, car, 0.6);
    expect(car.body!.v).toBeGreaterThan(CAR_RT.exitSpeed);
    press(h, car, 'KeyE');
    expect(car.driving).toBe(true);
    expect(h.toasts).toContain(CAR_TEXT.slowDown);
    stop(h, car);
    press(h, car, 'KeyE');
    expect(car.driving).toBe(false);
    const b = car.body!, right = carToWorld(b.x, b.z, b.yaw, S.exits.right.x, S.exits.right.z);
    expect(h.player.x).toBeCloseTo(right.x, 6);
    expect(h.player.z).toBeCloseTo(right.z, 6);
    expect(nearestCircle(S, b.x, b.z, b.yaw, h.player.x, h.player.z).d).toBeGreaterThan(h.player.radius);
    expect(h.player.eye).toBeCloseTo(h.player.y + 1.62, 6);
    expect(h.sfxCalls).toContain('close:fridge');
    // boxed in on all four sides by crates (the player squeezed in by the left door first): no room
    const crates = ([[S.exits.left.x, S.exits.left.z], [S.exits.right.x, S.exits.right.z], [0, -S.length / 2 - 0.55], [0, S.length / 2 + 0.55]] as const)
      .map(([lx, lz]) => carToWorld(15, 15, 0, lx, lz)).map(p => prop('crate', p.x, p.z, 0.3, 0.3, 1.2));
    const o = carHost();
    getIn(o.h, o.car);
    o.h.propIndex = new PropIndex(o.h.levels!, crates);
    press(o.h, o.car, 'KeyE');
    expect(o.car.driving).toBe(true);
    expect(o.h.toasts).toContain(CAR_TEXT.noRoom);
    expect(o.h.sfxCalls).toContain('denied');
    expect(o.car.counts.exitRefused).toBe(1);
  });

  it('death, a state change and a teardown take the player out (the car parks, the controls clear); teardown is idempotent', () => {
    const {h, car} = carHost();
    getIn(h, car);
    h.keys.held.add('KeyW');
    run(h, car, 0.5);
    h.player.alive = false;
    frame(h, car);
    expect(car.driving).toBe(false);
    expect(car.body!.v).toBe(0);
    h.player.alive = true;
    h.keys.held.clear();
    getIn(h, car);
    for (const f of h.stateListeners) (f as (s: string, p: string) => void)('paused', 'playing');
    expect(car.driving).toBe(true); // a pause keeps the driver seated (the world is frozen)
    for (const f of h.stateListeners) (f as (s: string, p: string) => void)('title', 'paused');
    expect(car.driving).toBe(false);
    getIn(h, car);
    teardown(h);
    expect(car.driving).toBe(false);
    expect(car.worldLive).toBe(false);
    expect(car.counts.teardowns).toBe(1);
    teardown(h);
    expect(car.counts.teardowns).toBe(1);
    expect(car.view).toBeNull();
    expect(car.onInteract()).toBe(false);
    car.frame(DT); // between worlds: nothing happens
    expect(car.prompt).toBeNull();
  });
});

describe('skyways car: zombies (the real kill path)', () => {
  it('rammed faster than killSpeed: the brain dies, Game.blastKill gets it with the car\'s velocity, the car loses a little speed', () => {
    const {h, car} = carHost();
    const z = zombie(15, 6);
    h.zombies.push(z);
    getIn(h, car);
    h.keys.held.add('KeyW');
    let vBefore = 0;
    run(h, car, 2.5, () => { if (z.brain.alive) vBefore = car.body!.v; return !z.brain.alive; });
    expect(z.brain.alive).toBe(false); // (Game.saveSectionMemory records it: never respawned)
    expect(z.brain.hp).toBe(0);
    expect(h.kills).toHaveLength(1);
    expect(h.kills[0].z).toBe(z);
    expect(h.kills[0].dir.z).toBeLessThan(-0.8); // along the car's travel (north)
    expect(vBefore).toBeGreaterThan(CAR_RT.killSpeed);
    expect(car.body!.v).toBeLessThan(vBefore);
    expect(car.counts.kills).toBe(1);
    expect(h.sfxCalls.some(c => c.startsWith('impact:flesh'))).toBe(true);
  });

  it('slower contact shoves the body ahead (alive) and slows the car; a body on another storey is never touched', () => {
    const {h, car} = carHost();
    const z = zombie(15, 11.8), upstairs = zombie(15, 12.4, 5);
    h.zombies.push(z, upstairs);
    getIn(h, car);
    h.keys.held.add('KeyW');
    let top = 0;
    run(h, car, 0.5, () => { top = Math.max(top, car.body!.v); return false; });
    h.keys.held.clear();
    run(h, car, 1.5);
    expect(top).toBeLessThan(CAR_RT.killSpeed); // pushing it held the car back
    expect(z.brain.alive).toBe(true);
    expect(z.brain.z).toBeLessThan(11.8 - 0.3); // shoved north
    expect(nearestCircle(S, car.body!.x, car.body!.z, car.body!.yaw, z.brain.x, z.brain.z).d).toBeGreaterThan(z.brain.stats.radius - 0.02);
    expect(car.counts.pushes).toBeGreaterThan(0);
    expect(upstairs.brain.x).toBe(15);
    expect(upstairs.brain.z).toBe(12.4);
    expect(h.kills).toHaveLength(0);
  });

  it('a body pinned against the wall while the car presses on is crushed (the same kill path)', () => {
    const {h, car} = carHost({spawn: {z: 4.2}});
    const z = zombie(15, 1.0);
    h.zombies.push(z);
    getIn(h, car);
    h.keys.held.add('KeyW');
    run(h, car, 3, () => !z.brain.alive);
    expect(z.brain.alive).toBe(false);
    expect(car.counts.crushed).toBe(1);
    expect(h.kills).toHaveLength(1);
    expect(z.brain.z).toBeGreaterThanOrEqual(HALL.wall + z.brain.stats.radius - 1e-6); // never pushed into the wall
  });

  it('the parked car keeps zombies (and the walking player) out of its body', () => {
    const {h, car} = carHost();
    const z = zombie(16.1, 15); // overlapping the parked car's right side
    h.zombies.push(z);
    h.player.place(13.4, 15, -Math.PI / 2, 0);
    h.keys.held.add('KeyW'); // walk east into the car's left side
    run(h, car, 1.5);
    const b = car.body!;
    expect(nearestCircle(S, b.x, b.z, b.yaw, z.brain.x, z.brain.z).d).toBeGreaterThanOrEqual(z.brain.stats.radius - 1e-6);
    expect(z.brain.alive).toBe(true);
    expect(nearestCircle(S, b.x, b.z, b.yaw, h.player.x, h.player.z).d).toBeGreaterThanOrEqual(h.player.radius - 1e-6);
    expect(b.x).toBe(15); // the parked car never moves
  });
});

describe('skyways car: props, glass, bullets', () => {
  it('loose props in the path are shoved (impulse ∝ speed, bounded per frame / per prop) and stop blocking; fixed props stop the car', () => {
    const chairs = [10, 9.4, 8.8, 8.2, 7.6, 7.0].map(z => prop('foldingChair', 15, z, 0.22, 0.22, 0.85));
    const {h, car} = carHost({props: chairs});
    getIn(h, car);
    h.keys.held.add('KeyW');
    let walkers = 0;
    run(h, car, 2, () => { walkers = Math.max(walkers, h.physics!.dynamicItems.walkers!().length); return false; });
    expect(h.shoves.length).toBe(chairs.length); // every chair, once
    expect(new Set(h.shoves.map(s => s.prop)).size).toBe(chairs.length);
    const perFrame = new Map<number, number>();
    for (const s of h.shoves) perFrame.set(s.t, (perFrame.get(s.t) ?? 0) + 1);
    expect(Math.max(...perFrame.values())).toBeLessThanOrEqual(CAR_RT.kick.perFrame);
    for (const s of h.shoves) {
      expect(s.index).toBe(chairs.indexOf(s.prop)); // the layout index (shootProp / detach need it)
      expect(s.impulse).toBeGreaterThan(0);
      expect(s.impulse).toBeLessThanOrEqual(4 * MAX_SHOT_DV + 1e-9); // foldingChair: 4 kg
    }
    expect(car.body!.z).toBeLessThan(5); // drove on through them
    expect(walkers).toBe(1 + S.circles.length); // the moving car's circles shove as walkers too
    // a counter (not a loose kind) stops it
    const counter = prop('shopCounter', 15, 8, 1.5, 0.4, 0.95);
    const o = carHost({props: [counter]});
    getIn(o.h, o.car);
    o.h.keys.held.add('KeyW');
    run(o.h, o.car, 2);
    expect(o.h.shoves).toHaveLength(0);
    expect(o.car.body!.z).toBeGreaterThan(8.4 + 0.9);
  });

  it('hitting a window wall fast breaks the panes at the contact through the gas system (none slowly; the wall still stops it)', () => {
    const panes = [
      {id: 'p1', level: 0, along: 'x' as const, glass: 0.25, a0: 14, a1: 15.5, y0: 0.9, y1: 2.4},
      {id: 'p2', level: 0, along: 'x' as const, glass: 0.25, a0: 15.5, a1: 17, y0: 0.9, y1: 2.4},
      {id: 'far', level: 0, along: 'x' as const, glass: 0.25, a0: 8, a1: 9.5, y0: 0.9, y1: 2.4},
      {id: 'high', level: 0, along: 'x' as const, glass: 0.25, a0: 14, a1: 15.5, y0: 1.6, y1: 2.8},
      {id: 'upstairs', level: 1, along: 'x' as const, glass: 0.25, a0: 14, a1: 15.5, y0: 5.9, y1: 7.4},
    ];
    const {h, car} = carHost({panes});
    getIn(h, car);
    h.keys.held.add('KeyW');
    run(h, car, 3, () => (car.lastImpact?.speed ?? 0) > CAR_RT.glassSpeed);
    expect(car.lastImpact!.speed).toBeGreaterThan(CAR_RT.glassSpeed);
    run(h, car, 1); // pressing on against the wall: nothing more breaks
    expect(h.broken.sort()).toEqual(['p1', 'p2']);
    expect(car.counts.panes).toBe(2);
    const front = carToWorld(car.body!.x, car.body!.z, car.body!.yaw, 0, S.circles[0].z);
    expect(front.z - S.circles[0].r).toBeGreaterThanOrEqual(HALL.wall - 1e-6); // the wall cells still stop it
    expect(h.sfxCalls.some(c => c.startsWith('impact:prop'))).toBe(true); // the crash cue
    // a slow bump: nothing breaks
    const o = carHost({panes, spawn: {z: 4}});
    getIn(o.h, o.car);
    o.h.keys.held.add('KeyW');
    run(o.h, o.car, 2);
    expect(o.h.broken).toEqual([]);
  });

  it('a glazed prop met fast takes the hit through damage.hitWorld (its layout index); a plain one does not', () => {
    const counter = prop('shopCounter', 8, 6, 1.5, 0.4, 0.95), glazing = prop('shopGlazing', 15, 6, 1.5, 0.05, 2.5);
    const {h, car} = carHost({props: [counter, glazing]});
    getIn(h, car);
    h.keys.held.add('KeyW');
    run(h, car, 2);
    expect(h.propHits.length).toBeGreaterThanOrEqual(2);
    expect(h.propHits.every(p => p.prop === 1)).toBe(true);
    expect(Math.min(...h.propHits.map(p => p.damage))).toBeGreaterThan(CAR_RT.glassDamage + CAR_RT.glassPerMs * CAR_RT.glassSpeed - 1e-6);
    expect(car.counts.propGlass).toBe(1); // once per contact (cooldown)
    expect(car.body!.z).toBeGreaterThan(6.05 + 0.9); // the glazing's box still stops the car
  });

  it('a bullet whose world hit lies behind the car stops on it', () => {
    const {h, car} = carHost();
    const shoot = (z: number) => {
      const dir = new THREE.Vector3(1, -0.02, 0).normalize(), t = (HALL.w - HALL.wall - 5) / dir.x;
      const point = new THREE.Vector3(5, 1.0, z).addScaledVector(dir, t);
      return h.bulletHitHandlers!.some(f => (f as (wh: unknown, p: THREE.Vector3, d: THREE.Vector3, s: number, dmg: number) => boolean)({t, kind: 'wall'}, point, dir, 1, 30));
    };
    expect(shoot(15)).toBe(true);
    expect(shoot(25)).toBe(false);
    expect(car.counts.bullets).toBe(1);
  });
});

describe('skyways car: persistence', () => {
  it('the record validator: exact keys, finite bounded numbers', () => {
    const ok = skywaysCarRecord(12.34567, 4.2, -8, 7, 2);
    expect(ok).toEqual({v: 1, x: 12.3457, y: 4.2, z: -8, yaw: +(7 - 2 * Math.PI).toFixed(4), level: 2});
    expect(skywaysCarProblem(ok)).toBeNull();
    for (const [bad, re] of [
      [null, /object/], [[], /object/], [{...ok, extra: 1}, /unexpected car field 'extra'/], [{v: 1, x: 0, y: 0, z: 0, yaw: 0}, /missing car field 'level'/],
      [{...ok, v: 2}, /version/], [{...ok, x: Number.NaN}, /position/], [{...ok, z: 1e6}, /position/], [{...ok, y: '1'}, /height/],
      [{...ok, yaw: 9}, /heading/], [{...ok, level: 1.5}, /storey/], [{...ok, level: -1}, /storey/], [{...ok, level: 64}, /storey/],
    ] as [unknown, RegExp][]) expect(skywaysCarProblem(bad), JSON.stringify(bad)).toMatch(re);
  });

  it('a save carrying the car lane validates; a malformed one is refused', () => {
    const hs = new Harness(fixtureCampaign({current: sid(1), known: [sid(0), sid(1), sid(2)], visited: [sid(0), sid(1)]}));
    hs.run.current = {level: 'subway', section: 'main', station: sid(1)};
    hs.run.memory().visits = 1;
    hs.run.setLaneStore(SKYWAYS_CAR_LANE, skywaysCarRecord(15, 0, 9, 0.3, 0));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- (test mutation of untrusted data)
    const base = hs.file('arrival', 1) as any;
    const good = validateSaveFile(structuredClone(base));
    expect(good.ok, good.ok ? '' : (good as {error: string}).error).toBe(true);
    const f = structuredClone(base);
    f.run.memories[`${sid(1)}:main`].lanes[SKYWAYS_CAR_LANE].yaw = 'north';
    f.checksum = checksumOf(f.run);
    const r = validateSaveFile(f);
    expect(r.ok).toBe(false);
    expect((r as {error: string}).error).toMatch(/skyways\.car.*heading/);
  });

  it('stored at teardown / on getting out; restored on the next build; a bad or off-floor record falls back to the spawn; never a duplicate', () => {
    const {h, car} = carHost();
    getIn(h, car);
    h.keys.held.add('KeyW');
    run(h, car, 1);
    stop(h, car);
    press(h, car, 'KeyE');
    expect(car.driving).toBe(false);
    const rec = h.store.get(SKYWAYS_CAR_LANE) as {x: number; z: number; yaw: number};
    expect(skywaysCarProblem(rec)).toBeNull();
    expect(rec.z).toBeCloseTo(car.body!.z, 3);
    const parked = {...car.body!};
    teardown(h);
    build(h);
    expect(car.source).toBe('record');
    expect(car.body!.x).toBeCloseTo(parked.x, 3);
    expect(car.body!.z).toBeCloseTo(parked.z, 3);
    expect(car.root.children).toHaveLength(1); // exactly one car
    expect(h.scene.getObjectsByProperty('name', 'skyways-car')).toHaveLength(1);
    build(h); // a build without a teardown in between: still one
    expect(car.root.children).toHaveLength(1);
    // malformed / off the floor (over the drop) -> the generator's spawn
    teardown(h);
    h.store.set(SKYWAYS_CAR_LANE, {...rec, extra: 1});
    build(h);
    expect(car.source).toBe('spawn');
    teardown(h);
    h.store.set(SKYWAYS_CAR_LANE, skywaysCarRecord(HALL.drop + 2, 0, 15, 0, 0));
    build(h);
    expect(car.source).toBe('spawn');
    expect(car.body).toMatchObject({x: 15, z: 15});
    expect(car.settled()).toBe(true);
    // a layout without the add-on: no car at all
    teardown(h);
    (h as {layout: unknown}).layout = {props: []};
    build(h);
    expect(car.body).toBeNull();
    expect(car.root.children).toHaveLength(0);
    expect(car.onInteract()).toBe(false);
  });

  it('the car GLB is a Skyways-only asset', () => {
    expect(levelOfAsset(S.url)).toBe('skyways');
    expect(levelOfAsset('assets/textures/skyways/glass.jpg')).toBe('skyways');
    expect(levelOfAsset('assets/models/skyways.glb')).toBeNull();
  });
});

describe('skyways car: the view', () => {
  it('without the model: the stand-in body + the procedural cockpit (dash, wheel, two seats); the wheel turns with the steering', () => {
    setSkywaysCarModelsForTests({car: null, cockpit: null});
    const v = buildCarView(S);
    expect(v.standIn).toBe(true);
    expect(v.group.getObjectByName('skyways-car-stand-in')).toBeTruthy();
    expect(v.group.getObjectByName('skyways-car-dash')).toBeTruthy();
    expect(v.group.getObjectsByProperty('name', 'skyways-car-seat')).toHaveLength(2);
    setWheel(v, 0.3);
    expect(v.wheel!.rotation.z).toBeCloseTo(0.3 * WHEEL_RATIO, 9);
    v.group.updateMatrixWorld(true);
    const bb = new THREE.Box3().setFromObject(v.body);
    expect(bb.min.y).toBeCloseTo(0, 1);
    expect(bb.max.z - bb.min.z).toBeCloseTo(S.length, 1);
    // the cockpit sits in the cabin box and keeps the view ahead free: only the seat backs (behind the eye) reach eye height
    const cb = new THREE.Box3().setFromObject(v.cockpit);
    expect(cb.min.y).toBeGreaterThanOrEqual(S.interior.y0 - 0.05);
    expect(cb.min.z).toBeGreaterThanOrEqual(S.interior.z0 - 0.15);
    v.cockpit.traverse(o => {
      if (!(o as THREE.Mesh).isMesh) return;
      const mb = new THREE.Box3().setFromObject(o, true);
      if (mb.min.z < S.eye.z) expect(mb.max.y, o.name).toBeLessThan(S.eye.y - 0.02); // ahead of the eye: below the eye line
    });
    expect(new THREE.Box3().setFromObject(v.group.getObjectByName('skyways-car-dash')!).max.y).toBeLessThan(S.eye.y - 0.08);
  });

  it('with the model: paint FrontSide + a BackSide trim twin per body mesh (same geometry), the glass both sides in one pass', () => {
    const scene = new THREE.Group();
    const paint = new THREE.MeshStandardMaterial({color: 0xaa1111, side: THREE.DoubleSide}); paint.name = 'paint';
    const glassMat = new THREE.MeshStandardMaterial({transparent: true, opacity: 0.4}); glassMat.name = 'glass';
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.9, 1.2, 4.7), paint); body.name = 'body';
    const glass = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.4, 2), glassMat); glass.name = 'glass';
    scene.add(body, glass);
    setSkywaysCarModelsForTests({car: {scene} as unknown as GLTF, cockpit: null});
    try {
      const v = buildCarView(S);
      expect(v.standIn).toBe(false);
      const meshes: THREE.Mesh[] = [];
      v.body.traverse(o => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
      const outer = meshes.find(m => m.userData.carPart === 'paint')!, trim = meshes.find(m => m.userData.carPart === 'trim')!, g = meshes.find(m => m.userData.carPart === 'glass')!;
      expect((outer.material as THREE.Material).side).toBe(THREE.FrontSide);
      expect(trim.geometry).toBe(outer.geometry); // no extra bytes
      expect((trim.material as THREE.Material).side).toBe(THREE.BackSide);
      expect(trim.parent).toBe(outer);
      expect((g.material as THREE.Material).side).toBe(THREE.DoubleSide);
      expect((g.material as THREE.Material).forceSinglePass).toBe(true);
      expect(g.castShadow).toBe(false);
      // a world built now draws the model; the car's own trim twins / glass cast no shadow
      const {car} = carHost();
      expect(car.view!.standIn).toBe(false);
    } finally { setSkywaysCarModelsForTests({car: null, cockpit: null}); }
  });

  it('the physics numbers are the brief\'s (arcade, not a simulation)', () => {
    expect(CAR_PHYS.accel).toBe(7);
    expect(CAR_PHYS.brake).toBe(14);
    expect(CAR_PHYS.reverseMax).toBe(5);
    expect(CAR_PHYS.forwardMax).toBe(15);
    expect(CAR_RT.killSpeed).toBe(4);
    expect(CAR_RT.lookYaw).toBeCloseTo((150 * Math.PI) / 180, 9);
  });
});
