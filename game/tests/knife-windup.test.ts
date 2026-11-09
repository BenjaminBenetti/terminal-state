// Lane FEEL (task knife-windup-20261030; user: "click, and that holds it up behind your head ... when you let go it swings,
// but if you just tap it quickly it still plays the whole animation ... this wind up mechanic will let us do heavier weapons
// like clubs and crowbars"; "two hits to the head ... take twenty five percent of the range away"): the data-driven melee
// windup / ready / swing / recovery cycle of WeaponController (weapons.ts MeleeSpec) — held vs released vs quick tap
// (incl. down + up inside one frame), the minimum-windup queue, no auto-repeat while held, cadence / cooldown, every
// cancellation path with NO delayed attack, exactly one contact per swing, the 30 / 60 damage and 1.125 m reach, the
// Game wiring (input latch, cues at the stages), and the first-person pose at every stage (upright carry, raised windup, tip
// on screen, no near-plane clipping, no pops). CPU only (no renderer, no browser).

import {describe, expect, it, vi} from 'vitest';
import * as THREE from 'three';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {NodeIO} from '@gltf-transform/core';
import {GLTFLoader, type GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {installCanvasShim} from './helpers/canvas2d';

vi.mock('../src/world/canvasTextures', async orig => ({...(await orig<object>()), canvasTexture: () => new THREE.Texture()}));
installCanvasShim(false);

const {WEAPONS, WeaponController, meleeCadence} = await import('../src/weapons/weapons');
type TriggerInput = import('../src/weapons/weapons').TriggerInput;
type WeaponEvent = import('../src/weapons/weapons').WeaponEvent;
type WeaponDef = import('../src/weapons/weapons').WeaponDef;
type MeleeStage = import('../src/weapons/weapons').MeleeStage;
const {meleeDamage, meleeHitsToKill} = await import('../src/combat/melee');
const {KNIFE_POSES, MELEE_POSES, meleePoseOffset} = await import('../src/weapons/meleeView');
const {Viewmodel} = await import('../src/weapons/viewmodel');
const {Inventory} = await import('../src/items/inventory');
const {MODEL_FILES} = await import('../src/assets/manifest');
const {ZOMBIE_STATS} = await import('../src/ai/brain');
const {VARIETY_MELEE_IDS} = await import('../src/weapons/varietyIds');

const GAME = fileURLToPath(new URL('..', import.meta.url));
const KNIFE = WEAPONS.knife;
const M = KNIFE.melee!;
const DT = 1 / 60;
const NONE: TriggerInput = {held: false, pressed: false, reload: false, lowered: false};

type Ev = {t: number; e: WeaponEvent};
/** A knife controller (equipped and ready) with a frame clock; `frame` feeds one 60 fps frame of input. */
function rig(def: WeaponDef = KNIFE) {
  const inv = new Inventory();
  const wc = new WeaponController();
  wc.equip({uid: 1, itemId: 'knife', count: 1, mag: 0}, {knife: def});
  wc.update(1, NONE, inv); // finish the 0.3 s equip
  expect(wc.phase).toBe('idle');
  let t = 0;
  const log: Ev[] = [];
  const frame = (i: Partial<TriggerInput> = {}) => {
    t += DT;
    const ev = wc.update(DT, {...NONE, ...i}, inv);
    for (const e of ev) log.push({t, e});
    return ev;
  };
  const frames = (n: number, i: Partial<TriggerInput> = {}) => { for (let k = 0; k < n; k++) frame(i); };
  const secs = (s: number, i: Partial<TriggerInput> = {}) => frames(Math.round(s / DT), i);
  const types = () => log.map(x => x.e.type);
  const at = (type: WeaponEvent['type']) => log.filter(x => x.e.type === type).map(x => x.t);
  return {wc, inv, frame, frames, secs, log, types, at, now: () => t};
}

// ---------------------------------------------------------------------------------------------------------------------
describe('knife tuning (lane FEEL): damage halved, reach -25 %, phase timing', () => {
  it('30 body / 60 head (2 head / 4 body hits on a standard 100 hp zombie), reach exactly 1.125 m', () => {
    expect(meleeDamage(KNIFE, 'torso')).toBe(30);
    expect(meleeDamage(KNIFE, 'limb')).toBe(30);
    expect(meleeDamage(KNIFE, 'head')).toBe(60);
    expect(meleeHitsToKill(KNIFE, 'head', ZOMBIE_STATS.shambler.hp)).toBe(2);
    expect(meleeHitsToKill(KNIFE, 'torso', ZOMBIE_STATS.shambler.hp)).toBe(4);
    expect(KNIFE.range).toBe(1.125);
    expect(KNIFE.range / 1.5).toBeCloseTo(0.75, 12);
    expect(KNIFE.knockback).toBe(0);
    expect(KNIFE.caliber).toBeUndefined();
  });

  it('the phase spec: 0.15 s windup, contact 0.08 s after the release, sweep 0.16 s, recovery 0.34 s; cadence 0.65 s; no hold limit', () => {
    expect([M.windup, M.strike, M.sweep, M.recovery]).toEqual([0.15, 0.08, 0.16, 0.34]);
    expect(M.strike).toBeLessThan(M.sweep);
    expect(meleeCadence(M)).toBeCloseTo(0.65, 9);
    expect(KNIFE.interval).toBeCloseTo(meleeCadence(M), 9);
    expect(M.holdMax).toBeUndefined();
    expect(KNIFE.auto).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('hold to wind up, release to swing', () => {
  it('press + hold: the windup raises, the ready pose is kept for as long as it is held, and NOTHING attacks', () => {
    const r = rig();
    r.frame({pressed: true, held: true});
    expect(r.types()).toEqual(['windup']);
    expect(r.wc.meleeStage).toBe('windup');
    expect(r.wc.winding).toBe(true);
    r.secs(M.windup, {held: true});
    expect(r.wc.meleeStage).toBe('ready');
    r.secs(5, {held: true});
    expect(r.types()).toEqual(['windup']); // no swing, no contact, no repeat
    expect(r.wc.meleeStage).toBe('ready');
    expect(r.wc.winding).toBe(true);
  });

  it('the release commits ONE swing at once (the whoosh), its ONE contact `strike` s later, then the recovery back to the carry', () => {
    const r = rig();
    r.frame({pressed: true, held: true});
    r.secs(1, {held: true});
    const tRelease = r.now() + DT;
    r.frame({}); // released
    expect(r.at('swing')).toEqual([tRelease]);
    expect(r.wc.meleeStage).toBe('swing');
    r.secs(1);
    expect(r.types()).toEqual(['windup', 'swing', 'contact']);
    const contact = r.at('contact')[0] - tRelease;
    expect(contact).toBeGreaterThanOrEqual(M.strike - DT - 1e-9); // the release frame already counts toward the swing
    expect(contact).toBeLessThanOrEqual(M.strike + 1e-9);
    expect(r.wc.meleeStage).toBeNull();
    expect(r.wc.swinging).toBe(false);
  });

  it('a longer hold gives no extra damage or reach: every swing is the same def and resolves the same way', () => {
    const short = rig(), long = rig();
    for (const [r, hold] of [[short, 0], [long, 3]] as const) {
      r.frame({pressed: true, held: true});
      r.secs(M.windup + hold, {held: true});
      r.secs(1);
      const c = r.log.filter(x => x.e.type === 'contact');
      expect(c.length).toBe(1);
      expect((c[0].e as {def: WeaponDef}).def).toBe(KNIFE);
    }
    expect(meleeDamage(KNIFE, 'head')).toBe(60); // unchanged by any hold
  });

  it('quick tap — down and up inside ONE frame (pressed without held): the full windup -> swing -> recovery still plays', () => {
    const r = rig();
    const stages: (MeleeStage | null)[] = [];
    r.frame({pressed: true}); // the button is already up again when the frame runs
    stages.push(r.wc.meleeStage);
    while (r.wc.meleeStage) { r.frame({}); stages.push(r.wc.meleeStage); }
    expect(r.types()).toEqual(['windup', 'swing', 'contact']);
    expect(stages).toContain('windup');
    expect(stages).toContain('swing');
    expect(stages).toContain('recover');
    // the swing starts exactly when the minimum windup is done; the cycle takes the cadence
    const [tw] = r.at('windup'), [ts] = r.at('swing'), [tc] = r.at('contact');
    expect(ts - tw).toBeCloseTo(M.windup, 6);
    expect(tc - ts).toBeGreaterThanOrEqual(M.strike - 1e-9);
    expect(tc - ts).toBeLessThan(M.strike + DT);
    expect(r.now() - tw).toBeGreaterThanOrEqual(meleeCadence(M) - DT - 1e-9);
    expect(r.now() - tw).toBeLessThan(meleeCadence(M) + DT);
  });

  it('released before the minimum windup: the swing is queued and fires right after it (not at the release, not lost)', () => {
    const r = rig();
    r.frame({pressed: true, held: true});
    r.frames(3, {held: true}); // 0.05 s
    r.frame({}); // released early
    expect(r.at('swing')).toEqual([]);
    expect(r.wc.meleeStage).toBe('windup');
    expect(r.wc.winding).toBe(false); // released: it is no longer a hold
    r.secs(1);
    expect(r.types()).toEqual(['windup', 'swing', 'contact']);
    expect(r.at('swing')[0] - r.at('windup')[0]).toBeCloseTo(M.windup, 6);
  });

  it('no auto-repeat while held: after a swing, keeping (or re-holding) the button never swings again without a NEW press', () => {
    const r = rig();
    r.frame({pressed: true});
    r.secs(1); // a full tap cycle
    r.secs(3, {held: true}); // the button held down without a press edge (e.g. latched / held through a switch)
    expect(r.types()).toEqual(['windup', 'swing', 'contact']);
    r.frame({pressed: true, held: true}); // a new press: one new windup, held -> ready, still no swing
    r.secs(2, {held: true});
    expect(r.types()).toEqual(['windup', 'swing', 'contact', 'windup']);
  });

  it('cadence: a press during the swing / recovery is remembered and winds up only after the recovery; taps cannot beat 0.65 s', () => {
    const r = rig();
    r.frame({pressed: true});
    r.secs(M.windup + 0.04); // into the swing
    r.frame({pressed: true}); // a click during the swing
    r.secs(0.2);
    expect(r.at('windup').length).toBe(1); // remembered, not started yet (recovery still running)
    r.secs(1);
    const w = r.at('windup'), s = r.at('swing');
    expect(w.length).toBe(2);
    expect(s.length).toBe(2);
    expect(s[1] - s[0]).toBeGreaterThanOrEqual(meleeCadence(M) - 1e-6);
    expect(s[1] - s[0]).toBeLessThan(meleeCadence(M) + DT);
    // spamming: 3 s of a press every other frame -> at most one swing per 0.65 s
    const q = rig();
    for (let i = 0; i < 180; i++) q.frame(i % 2 ? {} : {pressed: true, held: true});
    const qs = q.at('swing');
    for (let i = 1; i < qs.length; i++) expect(qs[i] - qs[i - 1]).toBeGreaterThanOrEqual(meleeCadence(M) - 1e-6);
    expect(qs.length).toBeLessThanOrEqual(Math.floor(3 / meleeCadence(M)) + 1);
  });

  it('exactly one contact per swing, numbered like its swing, across held / tapped / spammed input', () => {
    const r = rig();
    for (let k = 0; k < 4; k++) { r.frame({pressed: true, held: true}); r.secs(0.3 + k * 0.1, {held: true}); r.secs(0.7); }
    for (let i = 0; i < 120; i++) r.frame(i % 3 ? {} : {pressed: true});
    r.secs(1);
    const swings = r.log.filter(x => x.e.type === 'swing').map(x => (x.e as {swing: number}).swing);
    const contacts = r.log.filter(x => x.e.type === 'contact').map(x => (x.e as {swing: number}).swing);
    expect(swings.length).toBeGreaterThan(5);
    expect(contacts).toEqual(swings);
    expect(new Set(contacts).size).toBe(contacts.length);
    expect(r.log.some(x => x.e.type === 'fire' || x.e.type === 'dry' || x.e.type === 'reloadStart')).toBe(false); // never gunfire
  });

  it('data-driven: a slower club-like spec only changes numbers (windup / hold limit / strike / sweep / recovery); no new weapon', () => {
    const club: WeaponDef = {...KNIFE, melee: {...M, windup: 0.5, holdMax: 1.0, strike: 0.2, sweep: 0.35, recovery: 0.6}};
    const r = rig(club);
    r.frame({pressed: true}); // a tap still plays the whole (slow) windup
    r.secs(2);
    expect(r.types()).toEqual(['windup', 'swing', 'contact']);
    expect(r.at('swing')[0] - r.at('windup')[0]).toBeCloseTo(0.5, 6);
    expect(r.at('contact')[0] - r.at('swing')[0]).toBeGreaterThanOrEqual(0.2 - 1e-9);
    expect(meleeCadence(club.melee!)).toBeCloseTo(1.45, 9);
    // holdMax: held past the limit, the arm relaxes with NO attack, and the later release does nothing
    const h = rig(club);
    h.frame({pressed: true, held: true});
    h.secs(0.5 + 1.0 + 0.1, {held: true});
    expect(h.wc.meleeStage).toBeNull();
    h.secs(1);
    expect(h.types()).toEqual(['windup']);
    // no club was added by this spec — the melee weapons are the knife plus the six user-approved weapon-variety additions (task
    // studio-weapon-variety-production-20261109-224355-01, weapons/varietyIds.ts; re-pinned by lane MELEE: weapon-variety-melee.test.ts)
    expect(Object.keys(WEAPONS).filter(k => WEAPONS[k].melee)).toEqual(['knife', ...VARIETY_MELEE_IDS]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('cancellation: no path leaves a delayed attack for a later release', () => {
  /** Hold into the ready pose, or tap (release queued), then run `cancel`, then release / wait: never a swing or contact. */
  function noDelayedAttack(cancel: (r: ReturnType<typeof rig>) => void, during: Partial<TriggerInput> = {}) {
    for (const mode of ['ready', 'windup-held', 'tap-queued'] as const) {
      const r = rig();
      if (mode === 'tap-queued') r.frame({pressed: true});
      else { r.frame({pressed: true, held: true}); r.secs(mode === 'ready' ? 0.5 : 0.05, {held: true}); }
      expect(r.wc.swinging).toBe(true);
      cancel(r);
      r.secs(0.5, {held: mode !== 'tap-queued', ...during});
      r.secs(1.5); // the mouse comes up / time passes
      expect(r.types().filter(x => x !== 'equipped'), mode).toEqual(['windup']); // (a re-equip reports 'equipped')
      expect(r.wc.swinging).toBe(false);
    }
  }

  it('pause / menu / inventory / death / travel / restart (Game.setState -> cancelSwing): returns true, nothing follows', () => {
    noDelayedAttack(r => expect(r.wc.cancelSwing()).toBe(true));
  });

  it('focus / pointer-lock loss (Input.clear -> clears changes): the wiped button does not read as a release that swings', () => {
    noDelayedAttack(r => { r.frame({held: true, clears: 0}); r.frame({held: false, clears: 1}); }, {clears: 1});
  });

  it('weapon / slot change (equip): the windup never survives it, and the next weapon gets no trigger from it', () => {
    noDelayedAttack(r => { r.wc.equip({uid: 2, itemId: 'knife', count: 1, mag: 0}, {knife: KNIFE}); r.wc.equip({uid: 1, itemId: 'knife', count: 1, mag: 0}, {knife: KNIFE}); });
    const r = rig();
    r.frame({pressed: true, held: true});
    r.secs(0.3, {held: true});
    const pistol = {uid: 9, itemId: 'pistol', count: 1, mag: 15};
    r.wc.equip(pistol);
    r.secs(1, {held: false}); // the release (Game latches it anyway)
    expect(r.types()).toEqual(['windup', 'equipped']);
    expect(pistol.mag).toBe(15);
  });

  it('sprint / climb / item use / a lane UI owning the buttons (lowered): cancels the windup, the hold and a queued tap', () => {
    noDelayedAttack(r => r.frame({lowered: true, held: true}), {lowered: true});
  });

  it('a click consumed by an elevator panel / UI (Game clears `pressed` and latches the button): no windup at all', () => {
    const r = rig();
    r.frame({pressed: false, held: false}); // what the knife sees for a consumed + latched press
    r.secs(1, {held: false});
    expect(r.types()).toEqual([]);
    // the latch arriving mid-windup is sent as `lowered` by Game (lmbLatch && winding): a cancel, not a release
    const q = rig();
    q.frame({pressed: true, held: true});
    q.secs(0.3, {held: true});
    q.frame({held: false, lowered: true});
    q.secs(1);
    expect(q.types()).toEqual(['windup']);
  });

  it('a swing already released keeps its ONE contact unless cancelled before it; after contact the recovery just runs out', () => {
    const r = rig();
    r.frame({pressed: true, held: true});
    r.secs(0.3, {held: true});
    r.frame({});
    r.secs(1, {lowered: true}); // sprinting right after the release, before contact: cancelled
    expect(r.at('contact')).toEqual([]);
    const q = rig();
    q.frame({pressed: true});
    q.secs(M.windup + M.strike + 2 * DT);
    expect(q.at('contact').length).toBe(1);
    q.secs(1, {lowered: true});
    expect(q.at('contact').length).toBe(1);
  });

  it('Game wiring: the press latch path, consumed clicks, held-through-switch latch, cancel on leaving play, cues at the stages', () => {
    const src = fs.readFileSync(path.join(GAME, 'src/game.ts'), 'utf8');
    const inp = fs.readFileSync(path.join(GAME, 'src/player/input.ts'), 'utf8');
    // Input keeps a press for the whole frame (a down + up between two frames still reads as pressed), cleared at the frame end
    expect(inp).toMatch(/this\.mouse\[e\.button\] = true; this\.mousePressed\[e\.button\] = true;/);
    expect(inp).toMatch(/endFrame\(\): void \{[\s\S]{0,80}this\.mousePressed\.fill\(false\)/);
    // a consumed in-world click clears the press and latches the button before the weapon update
    expect(src).toMatch(/if \(inp\.mousePressed\[0\] && this\.pointerHandlers\.some\(h => h\(\)\)\) \{ inp\.mousePressed\[0\] = false; this\.lmbLatch = true; \}/);
    expect(src.indexOf('this.pointerHandlers.some(h => h())')).toBeLessThan(src.indexOf('this.weapon.update(dt'));
    expect(src).toMatch(/held: inp\.mouse\[0\] && !flareOwns(?: && !rideHolster)?, pressed: inp\.mousePressed\[0\] && !flareOwns/);
    expect(src).toMatch(/if \(this\.input\.mouse\[0\] && \(this\.weapon\.def\?\.melee \|\| WEAPONS\[def\.weaponId!\]\?\.melee\)\) this\.lmbLatch = true/);
    expect(src).toMatch(/if \(s !== 'playing'\) \{[^\n]*this\.weapon\.cancelSwing\(\);/);
    expect(src).toMatch(/clears: inp\.clears\}/);
    // cues: the whoosh only on 'swing' (the release), nothing on 'windup', the hit only on 'contact'; no gunfire path for melee
    expect(src).toMatch(/e\.type === 'swing'\) this\.sfx\.meleeSwing\(\)/);
    // (task hitch-attribution-recorder-20261105: the dispatch may be wrapped in the weapon.melee profiler span — timing only)
    expect(src).toMatch(/e\.type === 'contact'\) (?:\{ prof\.begin\(SPAN\.melee\); )?this\.meleeContact\(e\.def\)/);
    expect((src.match(/sfx\.meleeSwing\(/g) ?? []).length).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('first-person pose at every stage (the real knife-user.glb through the 54 deg viewmodel camera)', async () => {
  async function gltfOf(url: string): Promise<GLTF> {
    const d = await new NodeIO().read(path.join(GAME, 'public', url));
    for (const t of d.getRoot().listTextures()) t.dispose();
    const bin = await new NodeIO().writeBinary(d);
    return new Promise<GLTF>((res, rej) => new GLTFLoader().parse(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength) as ArrayBuffer, '', res, rej));
  }
  const knife = await gltfOf(MODEL_FILES.knife.url);
  const stub = {scene: new THREE.Group()} as unknown as GLTF;
  const base = {moving: 0, sprint: false, aiming: false, lookDX: 0, lookDY: 0, reloading: false, reloadProgress: 0, using: false, useProgress: 0, bobT: 0};
  function make() {
    const vm = new Viewmodel({rifle: stub, shotgun: stub, knife}, {});
    vm.setAspect(16 / 9);
    vm.setItem('knife');
    vm.update(1, {...base, melee: {stage: null, t: 0}});
    const holder = vm.warmRoots().find(r => r.getObjectByName('knife') && r.getObjectByName('Tip'))!;
    const mesh = holder.getObjectByProperty('isMesh', true) as THREE.Mesh;
    return {vm, holder, mesh};
  }
  /** Tip NDC, the blade direction (grip -> tip) in camera space, the nearest vertex depth and the on-screen vertex share. */
  function measure(k: ReturnType<typeof make>) {
    k.vm.scene.updateMatrixWorld(true);
    const tipW = k.holder.getObjectByName('Tip')!.getWorldPosition(new THREE.Vector3());
    const gripW = k.holder.getObjectByName('Grip')!.getWorldPosition(new THREE.Vector3());
    const P = k.mesh.geometry.attributes.position, v = new THREE.Vector3();
    let minDepth = Infinity, on = 0;
    for (let i = 0; i < P.count; i++) {
      v.fromBufferAttribute(P, i).applyMatrix4(k.mesh.matrixWorld);
      minDepth = Math.min(minDepth, -v.z);
      const n = v.clone().project(k.vm.camera);
      if (Math.abs(n.x) <= 1 && Math.abs(n.y) <= 1 && n.z > -1 && n.z < 1) on++;
    }
    return {tip: tipW.clone().project(k.vm.camera), grip: gripW.clone().project(k.vm.camera), blade: tipW.clone().sub(gripW).normalize(), minDepth, on: on / P.count};
  }
  const pose = (k: ReturnType<typeof make>, stage: MeleeStage | null, t: number, dt = 0) => { k.vm.update(dt, {...base, melee: {stage, t}}); return measure(k); };

  it('upright carry: the blade stands up (mostly +Y, leaning a little forward and in), right of the crosshair, the guard in view', () => {
    const k = make();
    const c = measure(k);
    expect(c.blade.y).toBeGreaterThan(0.75); // "more up and down"
    expect(c.blade.z).toBeLessThan(0); // leaning forward, never back at the eye
    expect(Math.abs(c.blade.x)).toBeLessThan(0.3);
    const screenAngle = Math.atan2(Math.abs(c.tip.x - c.grip.x) * 16 / 9, c.tip.y - c.grip.y);
    expect(screenAngle).toBeLessThan(0.45); // < ~26 deg from vertical on screen (the old carry was ~45 deg, sideways)
    expect(c.tip.x).toBeGreaterThan(0.1);
    expect(c.tip.x).toBeLessThan(0.6);
    expect(Math.abs(c.tip.y)).toBeLessThan(0.3);
    expect(c.on).toBeGreaterThan(0.45);
    expect(KNIFE.view.hip).toEqual([...KNIFE_POSES.carry.pos]);
    expect([KNIFE.view.hipPitch, KNIFE.view.hipYaw, KNIFE.view.hipRoll]).toEqual([...KNIFE_POSES.carry.rot]);
    expect(MELEE_POSES.knife).toBe(KNIFE_POSES);
  });

  it('windup raises it: the ready pose is up and right (beside the head), cocked back, the tip still on screen', () => {
    const k = make();
    const c = measure(k);
    const r = pose(k, 'ready', 0);
    expect(r.tip.y).toBeGreaterThan(c.tip.y + 0.5);
    expect(r.tip.x).toBeGreaterThan(c.tip.x + 0.2);
    expect(r.grip.y).toBeGreaterThan(c.grip.y + 0.3); // the hand comes up
    expect(KNIFE_POSES.raised.pos[2]).toBeGreaterThan(KNIFE_POSES.carry.pos[2]); // drawn back toward the shoulder
    expect(r.blade.z).toBeGreaterThan(0); // the blade tipped back over the shoulder
    expect(Math.abs(r.tip.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(r.tip.y)).toBeLessThanOrEqual(1);
    // the windup reaches exactly the ready pose; the ready breathing stays tiny
    const w = pose(k, 'windup', M.windup);
    expect(w.tip.distanceTo(r.tip)).toBeLessThan(1e-6);
    for (let t = 0; t < 3; t += 0.1) expect(pose(k, 'ready', t).tip.distanceTo(r.tip)).toBeLessThan(0.03);
  });

  it('every frame of a full cycle (windup, 1 s held, swing, recovery): tip on screen, no near-plane clipping, knife visible, no pops', () => {
    const k = make();
    const near = k.vm.camera.near;
    expect(near).toBe(0.01);
    const seq: [MeleeStage, number][] = [];
    for (let t = 0; t <= M.windup + 1e-9; t += DT) seq.push(['windup', t]);
    for (let t = 0; t <= 1; t += DT) seq.push(['ready', t]);
    for (let t = 0; t < M.sweep; t += DT / 4) seq.push(['swing', t]);
    for (let t = 0; t <= M.recovery + 1e-9; t += DT) seq.push(['recover', t]);
    let prev = measure(k);
    for (const [stage, t] of seq) {
      const m = pose(k, stage, t);
      const label = `${stage} ${t.toFixed(3)}`;
      expect(Math.abs(m.tip.x), label).toBeLessThanOrEqual(1);
      expect(Math.abs(m.tip.y), label).toBeLessThanOrEqual(1);
      expect(m.minDepth, label).toBeGreaterThan(near + 0.15); // nothing near the near plane (min ~0.24 m)
      expect(m.on, label).toBeGreaterThan(0.12); // never vanishes (the recovery dip is the lowest share)
      // no pop: at 60 fps the tip moves < 0.5 NDC per frame even in the slash (sub-sampled 4x there)
      expect(m.tip.distanceTo(prev.tip), label).toBeLessThan(stage === 'swing' ? 0.5 : 0.25);
      prev = m;
    }
    // the swing: the tip reaches the crosshair at contact, then sweeps down-left; recovery ends exactly at the carry
    const hit = pose(k, 'swing', M.strike);
    expect(Math.hypot(hit.tip.x, hit.tip.y)).toBeLessThan(0.12);
    const through = pose(k, 'swing', M.sweep - 1e-6);
    expect(through.tip.x).toBeLessThan(-0.5);
    expect(through.tip.y).toBeLessThan(-0.5);
    const end = pose(k, 'recover', M.recovery);
    const carry = pose(k, null, 0, 1);
    expect(end.tip.distanceTo(carry.tip)).toBeLessThan(1e-3);
  });

  it('a cancelled windup / swing eases back to the carry (no snap), and a new held item starts from its carry', () => {
    const k = make();
    const carry = measure(k);
    const ready = pose(k, 'ready', 0.2);
    const f1 = pose(k, null, 0, DT); // cancelled: stage gone
    expect(f1.tip.distanceTo(ready.tip)).toBeGreaterThan(0.01);
    expect(f1.tip.distanceTo(carry.tip)).toBeGreaterThan(0.5 * ready.tip.distanceTo(carry.tip)); // not snapped
    for (let i = 0; i < 30; i++) pose(k, null, 0, DT);
    expect(measure(k).tip.distanceTo(carry.tip)).toBeLessThan(0.01);
    pose(k, 'ready', 0.2);
    k.vm.setItem(null);
    k.vm.setItem('knife');
    expect(pose(k, null, 0, 1).tip.distanceTo(carry.tip)).toBeLessThan(1e-3);
    // pure helper: zero for the carry, exact keys at the stage ends
    expect(meleePoseOffset(null, 0, M)).toEqual({x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0});
    const end = meleePoseOffset('recover', M.recovery, M);
    for (const v of Object.values(end)) expect(Math.abs(v)).toBeLessThan(1e-9);
  });
});
