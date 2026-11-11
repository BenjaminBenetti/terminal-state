// Task studio-screacher-production-20261110-221858-01: WHERE THE SCREACHER'S SOUNDS COME FROM — user: it "only reacts to sound (player
// bumping things, firing gun, running)". The physics contacts of loose objects (ai/screacherNoise.ts noisyPhysicsAudio over the real
// physics systems, a REAL Player walking into real props), the player's own qualifying sounds (a sprinting step, a real landing) and
// gunfire (the existing alertZombies). Walking, crouch-walking and standing still raise nothing: sneaking past is possible.
import {describe, expect, it} from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {fileURLToPath} from 'node:url';
import {installCanvasShim} from './helpers/canvas2d';
import {DT, approach, contactRig, renderPose, settle, stand, walkForward, type ContactRig} from './helpers/contactWalk';
import {generateOfficeLevel} from '../src/gen/office/index';
import type {PropPlacement} from '../src/gen/props';
import type {PhysicsAudio} from '../src/physics/world';
import {noisyPhysicsAudio} from '../src/ai/screacherNoise';
import {IMPACT_FAMILY_LOUDNESS, SCREACHER_NOISE, ScreacherBrain, deliverNoise, impactNoise, type ScreacherNoiseKind} from '../src/ai/screacher';
import {WEAPONS} from '../src/weapons/weapons';

installCanvasShim(false);
{
  const ctx = (document as unknown as {createElement(t: string): {getContext(k: string): object}}).createElement('canvas').getContext('2d');
  const proto = Object.getPrototypeOf(ctx) as {clip?: () => void};
  proto.clip ??= () => {};
}
const fresh = <T extends {props: PropPlacement[]}>(l: T): T => ({...l, props: l.props.map(p => ({...p}))});
const game = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/game.ts'), 'utf8');

describe('Screacher noise: the physics audio adapter', () => {
  it('every call reaches the audio sink unchanged; only a NAMED loose-object contact (not flesh, fast enough) and a drag raise noise', () => {
    const sunk: unknown[][] = [], raised: [number, number, number, number, ScreacherNoiseKind][] = [];
    const sink: PhysicsAudio = {
      casing: (...a) => { sunk.push(['casing', ...a]); }, bodyFall: (...a) => { sunk.push(['bodyFall', ...a]); },
      physImpact: (...a) => { sunk.push(['physImpact', ...a]); }, propDrag: (...a) => { sunk.push(['propDrag', ...a]); }, propDragStop: (...a) => { sunk.push(['propDragStop', ...a]); },
    };
    const a = noisyPhysicsAudio(sink, (...r) => raised.push(r));
    const id = {};
    a.casing!(1, 2, 3, 4, 'rifle');
    a.bodyFall!(1, 2, 3, 0.5);
    a.physImpact!(1, 0, 3, 3, 'prop', 12, 'item'); // a prop the player walked into
    a.physImpact!(4, 0, 5, 3, 'stone'); // a debris chunk: no source
    a.physImpact!(4, 0, 5, 3, 'flesh', undefined, 'item'); // soft flesh: never
    a.physImpact!(6, 0, 7, 0.8, 'prop', 3, 'item'); // too soft
    a.physImpact!(8, 0, 9, 5, 'light', undefined, 'thrown'); // a thrown flare landing
    a.physImpact!(8, 1, 9, 2, 'can', undefined, 'stock'); // shelf stock falling
    a.propDrag!(2, 0, 2, 1.1, id);
    a.propDragStop!(id);
    expect(sunk).toEqual([
      ['casing', 1, 2, 3, 4, 'rifle'], ['bodyFall', 1, 2, 3, 0.5], ['physImpact', 1, 0, 3, 3, 'prop', 12, 'item'], ['physImpact', 4, 0, 5, 3, 'stone', undefined, undefined],
      ['physImpact', 4, 0, 5, 3, 'flesh', undefined, 'item'], ['physImpact', 6, 0, 7, 0.8, 'prop', 3, 'item'], ['physImpact', 8, 0, 9, 5, 'light', undefined, 'thrown'],
      ['physImpact', 8, 1, 9, 2, 'can', undefined, 'stock'], ['propDrag', 2, 0, 2, 1.1, id], ['propDragStop', id],
    ]);
    expect(raised).toEqual([
      [1, 0, 3, impactNoise(3, 'prop'), 'impact'], [8, 0, 9, impactNoise(5, 'light'), 'impact'], [8, 1, 9, impactNoise(2, 'can'), 'impact'], [2, 0, 2, SCREACHER_NOISE.drag, 'drag'],
    ]);
    // casings and body falls never raise noise (tiny tinkles; an enemy's own collapse)
    expect(raised.some(r => r[0] === 1 && r[1] === 2)).toBe(false);
    // soft / light families carry less than hard ones at the same speed
    expect(impactNoise(4, 'light')).toBeCloseTo(impactNoise(4, 'prop') * IMPACT_FAMILY_LOUDNESS.light, 6);
    expect(impactNoise(4, 'light')).toBeLessThan(impactNoise(4, 'prop'));
    expect(impactNoise(4)).toBe(impactNoise(4, 'prop'));
  });

  it('the physics callers name their source (items / props, shelf stock, thrown items); debris and flesh chunks do not', () => {
    const src = (rel: string) => fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src', rel), 'utf8');
    expect(src('physics/dynamicItems.ts')).toMatch(/physImpact\?\.\(body\.position\.x, body\.position\.y, body\.position\.z, v, e\.fam, e\.mass, 'item'\)/);
    expect(src('physics/fillerStock.ts')).toMatch(/physImpact\?\.\(body\.position\.x, body\.position\.y, body\.position\.z, v, s\.fam, undefined, 'stock'\)/);
    expect(src('weapons/throwables.ts')).toMatch(/physImpact\?\.\(body\.position\.x, body\.position\.y, body\.position\.z, v, 'light', undefined, 'thrown'\)/);
    expect(src('physics/chunks.ts')).toMatch(/physImpact\?\.\(body\.position\.x, body\.position\.y, body\.position\.z, v, rec\.fam\);/);
    // and the game hands the wrapped Sfx to the physics systems
    expect(game).toMatch(/readonly physics = new PhysicsSystem\(this\.scene, this\.physicsAudio\(\)\);/);
    expect(game).toMatch(/return noisyPhysicsAudio\(this\.sfx, \(x, y, z, radius, kind\) => this\.worldNoise\(x, y, z, radius, kind\)\);/);
  });
});

describe('Screacher noise: a REAL Player bumping into real props (the game\'s own physics)', () => {
  function rigWithEars(): {rig: ContactRig; raised: {x: number; y: number; z: number; radius: number; kind: ScreacherNoiseKind}[]} {
    const rig = contactRig(fresh(generateOfficeLevel({levelSeed: 11, startWeapon: 'pistol'})));
    const raised: {x: number; y: number; z: number; radius: number; kind: ScreacherNoiseKind}[] = [];
    rig.ph.audio = noisyPhysicsAudio({}, (x, y, z, radius, kind) => raised.push({x, y, z, radius, kind}));
    return {rig, raised};
  }
  const chairOf = (rig: ContactRig): {p: PropPlacement; at: NonNullable<ReturnType<typeof approach>>} => {
    for (const p of rig.layout.props) {
      if (p.kind !== 'officeChair' || (p.level ?? 0) < 1 || !rig.ph.dynamicItems.isDynamicProp(p) || !renderPose(rig, p)) continue;
      const at = approach(rig, p, 1.0, 0.8);
      if (at) return {p, at};
    }
    throw new Error('no reachable office chair');
  };

  it('walking into an office chair is HEARD: a Screacher 7 m away now believes the sound is at the chair, not at the player', () => {
    const {rig, raised} = rigWithEars();
    const {p: chair, at} = chairOf(rig);
    stand(rig, at);
    const ear = new ScreacherBrain(chair.x + 7, chair.z, 0);
    ear.y = at.y;
    ear.echoT = 1e6;
    const cx = chair.x, cz = chair.z;
    let delivered = 0;
    walkForward(rig, 1.0, () => {
      while (delivered < raised.length) { const n = raised[delivered++]; deliverNoise([ear], n, n.radius, n.kind, () => true, null); }
    });
    settle(rig, 2);
    while (delivered < raised.length) { const n = raised[delivered++]; deliverNoise([ear], n, n.radius, n.kind, () => true, null); }
    expect(raised.length).toBeGreaterThanOrEqual(1);
    expect(raised.every(n => n.kind === 'impact' || n.kind === 'drag')).toBe(true);
    const loudest = Math.max(...raised.map(n => n.radius));
    expect(loudest).toBeGreaterThanOrEqual(7); // a bumped chair carries at least as far as the listener stood
    expect(loudest).toBeLessThanOrEqual(SCREACHER_NOISE.impactMax * 1.1 + 1e-9);
    expect(ear.heard).toBeGreaterThanOrEqual(1);
    expect(ear.belief).not.toBeNull();
    expect(ear.belief!.kind).toBe('impact');
    // the belief is where the chair was struck / came to rest (within a few metres of it), which is NOT the player's position
    expect(Math.hypot(ear.belief!.x - cx, ear.belief!.z - cz)).toBeLessThan(4);
    expect(ear.state).toBe('chase');
  });

  it('standing still, and walking where nothing is in the way, raise no noise at all', () => {
    const {rig, raised} = rigWithEars();
    const {at} = chairOf(rig);
    stand(rig, at);
    settle(rig, 3); // standing still beside the chair
    expect(raised).toEqual([]);
    // walk AWAY from the chair (turn round): open floor behind the stand point
    stand(rig, {...at, yaw: at.yaw + Math.PI});
    const before = raised.length;
    for (let i = 0; i < Math.round(0.4 / DT); i++) { rig.keys.held.add('KeyW'); rig.player.update(DT, rig.keys, rig.L, rig.index, {aiming: false, speedMult: 1, canSprint: false}); rig.ph.update(DT); }
    rig.keys.held.clear();
    expect(raised.length).toBe(before);
  });
});

describe('Screacher noise: the player\'s own sounds and gunfire (game wiring)', () => {
  it('only a SPRINTING step and a real landing are reported; walking / crouching / standing report nothing; not while riding or driving', () => {
    expect(game).toMatch(/if \(this\.screacherBrains\.length && !this\.trainRide\.riding && !this\.skywaysCar\.driving\) \{/);
    expect(game).toMatch(/if \(step && p\.sprinting\) this\.worldNoise\(p\.x, p\.y, p\.z, SCREACHER_NOISE\.run \* k, 'run'\);/);
    expect(game).toMatch(/if \(p\.justLanded\) this\.worldNoise\(p\.x, p\.y, p\.z, landNoise\(p\.landSpeed\) \* k, 'land'\);/);
    // no other player-movement noise source exists
    expect(game.match(/this\.worldNoise\(/g)!.length).toBe(3); // run, land, the physics adapter's raise
    // the player's one detectability factor (Night Shift Porter) applies once, as to gunfire
    expect(game).toMatch(/const k = this\.beerEffects\?\.perceptionMult\(\) \?\? 1;\n\s+if \(step && p\.sprinting\)/);
  });

  it('gunfire and melee contact keep their existing path and radii (alertZombies once per trigger pull); every gun out-shouts a sprint', () => {
    expect(game.match(/this\.alertZombies\(def\.noise\);/g)!.length).toBe(2); // fire() and meleeContact()
    for (const def of Object.values(WEAPONS)) {
      if (def.melee) expect(def.noise).toBeLessThan(SCREACHER_NOISE.run); // a blade / club hit is quieter than a sprint step
      else expect(def.noise).toBeGreaterThan(SCREACHER_NOISE.run * 2); // a gunshot: 24-40 m
    }
  });

  it('world noise reaches Screachers only, is merged per burst, and costs nothing in a level without one', () => {
    expect(game).toMatch(/if \(!\(radius > 0\) \|\| !this\.screacherBrains\.length \|\| !this\.layout\) return;/);
    expect(game).toMatch(/if \(\(kind === 'impact' \|\| kind === 'drag'\) && this\.time - \(this\.noiseAt\[kind\] \?\? -1\) < 0\.08\) return;/);
    expect(game).toMatch(/deliverNoise\(this\.screacherBrains, \{x, y, z\}, radius, kind,/);
    expect(game).toMatch(/if \(z\.brain instanceof ScreacherBrain\) this\.screacherBrains\.push\(z\.brain\);/);
    expect(game).toMatch(/this\.screacherBrains\.length = 0;/);
  });
});
