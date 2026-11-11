// Lane MELEE (gameplay feedback 2026-11-11; user: "Improve large-melee wind-ups, especially the axe: draw the weapon back over the
// shoulder so its tip naturally leaves view. Preserve damage, reach and attack timing."): the LARGE melee weapons (weapons/meleeView.ts
// LARGE_MELEE_IDS: the heavy two-handed fire axe, sledgehammer and track shovel) wind up over the right shoulder (MeleePoses.back).
//  (a) at the wind-up peak (the held ready pose, sway included) the head / Tip is BEHIND the eye — out of the real Viewmodel camera's
//      frustum at any aspect — while the grip end stays in view; the windup carries it out of view and the swing brings it back over
//      the top onto the crosshair; across a whole cycle (and a cancelled hold easing back) no vertex of the real model comes near the
//      eye or the near plane inside the view, and nothing pops;
//  (b) the hit is unchanged: every melee WeaponDef's timing / damage / reach / cooldown numbers pinned at their main values, the real
//      WeaponController's contact still `strike` s after the release, the pose on the crosshair exactly at that moment;
//  (c) small melee unchanged: the knife, machete, crowbar and slugger have no over-the-shoulder pose and their poses are bit-for-bit
//      main's; the large weapons' other keys (carry / raised / contact / follow-through) are main's too.
// CPU only (the real Viewmodel + the shipped GLBs through GLTFLoader; no renderer, no browser).

import {describe, expect, it, vi} from 'vitest';
import * as THREE from 'three';
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
type MeleePoses = import('../src/weapons/meleeView').MeleePoses;
const {KNIFE_POSES, MELEE_POSES, LARGE_MELEE_IDS, VARIETY_MELEE_AIMS, VIEW_FOV_DEG, meleePoseOffset, shoulderPose, varietyTip} = await import('../src/weapons/meleeView');
const {CHOP_RAYS, SLEDGE_RAYS, MACHETE_RAYS, CROWBAR_RAYS, BAT_RAYS, SHOVEL_RAYS} = await import('../src/weapons/varietyMelee');
const {KNIFE_RAYS} = await import('../src/combat/melee');
const {Viewmodel} = await import('../src/weapons/viewmodel');
const {VARIETY_MELEE_IDS} = await import('../src/weapons/varietyIds');
const {WEAPON_VARIETY_MODELS} = await import('../src/assets/weaponVarietyModels.generated');
const {Inventory} = await import('../src/items/inventory');

const GAME = fileURLToPath(new URL('..', import.meta.url));
const DT = 1 / 60;
const NONE: TriggerInput = {held: false, pressed: false, reload: false, lowered: false};
const LARGE = ['fire_axe', 'sledgehammer', 'track_shovel'] as const;
/** The nearest a vertex of the held model may come to the eye, and the nearest an IN-VIEW vertex may be (the variety tests' 0.15 m). */
const NEAR_EYE = 0.15;

// ---------------------------------------------------------------------------------------------------------------------
describe('the large melee classification', () => {
  it('LARGE_MELEE_IDS = the heavy two-handed fire axe, sledgehammer and track shovel (each >= 0.9 m); the knife / machete / crowbar / slugger are not', () => {
    expect([...LARGE_MELEE_IDS]).toEqual([...LARGE]);
    for (const id of VARIETY_MELEE_IDS) {
      const m = WEAPONS[id].melee!, large = (LARGE_MELEE_IDS as readonly string[]).includes(id);
      expect(!!VARIETY_MELEE_AIMS[id].back, id).toBe(large);
      expect(!!MELEE_POSES[id].back, id).toBe(large);
      if (large) {
        expect(m.twoHanded, id).toBe(true);
        expect(WEAPON_VARIETY_MODELS[id]!.length, id).toBeGreaterThanOrEqual(0.9);
        expect(m.charge, id).toBeUndefined();
      }
    }
    // the one-handed machete / crowbar are not large; the two-handed slugger keeps its in-frame CHARGE pose (its visible charge cue)
    expect(WEAPONS.machete.melee!.twoHanded).toBeUndefined();
    expect(WEAPONS.crowbar.melee!.twoHanded).toBeUndefined();
    expect(WEAPONS.slugger.melee!.charge).toBeTruthy();
    expect(MELEE_POSES.slugger.charged).toBeTruthy();
    expect(MELEE_POSES.knife.back).toBeUndefined();
  });

  it('the back pose is aimed by the shaft direction: the Tip lands |Tip| m along `dir` from the Grip (up, back, right), +Y toward `up`', () => {
    for (const id of LARGE) {
      const a = VARIETY_MELEE_AIMS[id].back!, p = MELEE_POSES[id].back!, tipM = new THREE.Vector3(...varietyTip(id));
      expect(p).toEqual(shoulderPose(a, varietyTip(id), MELEE_POSES[id].raised.rot));
      const o = new THREE.Object3D();
      o.position.set(...p.pos); o.rotation.set(...p.rot); o.updateMatrixWorld(true);
      const tip = tipM.clone().applyMatrix4(o.matrixWorld), grip = new THREE.Vector3(...a.grip);
      expect(tip.distanceTo(grip), id).toBeCloseTo(tipM.length(), 9);
      expect(tip.clone().sub(grip).normalize().dot(new THREE.Vector3(...a.dir).normalize()), id).toBeCloseTo(1, 9);
      expect(a.dir[0], id).toBeGreaterThan(0); // the RIGHT shoulder
      expect(a.dir[1], id).toBeGreaterThan(0); // up
      expect(a.dir[2], id).toBeGreaterThan(0); // back, past the eye
      expect(new THREE.Vector3(0, 1, 0).transformDirection(o.matrixWorld).dot(new THREE.Vector3(...a.up).normalize()), id).toBeGreaterThan(0);
      // the angles continue from `raised` (the arcs' pass-through key): no wrap-around spin between the keys
      for (let k = 0; k < 3; k++) expect(Math.abs(p.rot[k] - MELEE_POSES[id].raised.rot[k]), `${id} rot ${k}`).toBeLessThan(Math.PI);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('(a) the over-the-shoulder wind-up through the REAL Viewmodel (54 deg camera, near 0.01) with the shipped models', async () => {
  async function gltfOf(url: string): Promise<GLTF> {
    const d = await new NodeIO().read(path.join(GAME, 'public', url));
    for (const t of d.getRoot().listTextures()) t.dispose();
    const bin = await new NodeIO().writeBinary(d);
    return new Promise<GLTF>((res, rej) => new GLTFLoader().parse(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength) as ArrayBuffer, '', res, rej));
  }
  const gltfs = Object.fromEntries(await Promise.all(LARGE.map(async id => [id, await gltfOf(WEAPON_VARIETY_MODELS[id]!.url)] as const)));
  const stub = {scene: new THREE.Group()} as unknown as GLTF;
  const base = {moving: 0, sprint: false, aiming: false, lookDX: 0, lookDY: 0, reloading: false, reloadProgress: 0, using: false, useProgress: 0, bobT: 0};

  function make(id: (typeof LARGE)[number], aspect = 16 / 9) {
    const vm = new Viewmodel({rifle: stub, shotgun: stub}, {});
    expect(vm.addModel(id, gltfs[id])).toBe(true);
    vm.setAspect(aspect);
    vm.setItem(id);
    vm.update(1, {...base, melee: {stage: null, t: 0}}); // the equip raise done
    const holder = vm.warmRoots().find(r => r.visible && r.getObjectByName('Tip'))!;
    const meshes: THREE.Mesh[] = [];
    holder.traverse(o => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
    // the head: the model's outer fifth toward the Tip (model frame, the Grip at the origin; tip / head toward -Z)
    const tipZ = varietyTip(id)[2];
    return {vm, holder, meshes, tipZ, id};
  }
  type Rig = ReturnType<typeof make>;
  /** Camera-space Tip / Grip, the Tip's NDC, and vertex stats of the REAL mesh: in-view share, head in view, nearest-to-eye, nearest in view. */
  function measure(k: Rig) {
    const {vm, holder, meshes, tipZ} = k;
    vm.scene.updateMatrixWorld(true);
    const cam = vm.camera, inv = cam.matrixWorldInverse;
    const toCam = (w: THREE.Vector3) => w.applyMatrix4(inv);
    const tip = toCam(holder.getObjectByName('Tip')!.getWorldPosition(new THREE.Vector3()));
    const grip = toCam(holder.getObjectByName('Grip')!.getWorldPosition(new THREE.Vector3()));
    const tanY = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)), tanX = tanY * cam.aspect;
    const inView = (p: THREE.Vector3) => -p.z > cam.near && Math.abs(p.x) <= -p.z * tanX && Math.abs(p.y) <= -p.z * tanY;
    let n = 0, on = 0, headOn = 0, minEye = Infinity, minInView = Infinity;
    const v = new THREE.Vector3(), mv = new THREE.Vector3(), toModel = new THREE.Matrix4();
    for (const mesh of meshes) {
      const P = mesh.geometry.attributes.position;
      toModel.copy(holder.matrixWorld).invert().multiply(mesh.matrixWorld); // mesh -> holder (the model frame: Grip at the origin)
      for (let i = 0; i < P.count; i++) {
        v.fromBufferAttribute(P, i);
        mv.copy(v).applyMatrix4(toModel);
        v.applyMatrix4(mesh.matrixWorld).applyMatrix4(inv);
        n++;
        minEye = Math.min(minEye, v.length());
        if (inView(v)) { on++; minInView = Math.min(minInView, -v.z); if (mv.z < 0.8 * tipZ) headOn++; }
      }
    }
    const ndc = (p: THREE.Vector3) => new THREE.Vector3(p.x / (-p.z * tanX), p.y / (-p.z * tanY), 0);
    return {tip, grip, tipNdc: ndc(tip), gripNdc: ndc(grip), tipInView: inView(tip), gripInView: inView(grip), on: on / n, headOn, minEye, minInView};
  }
  const pose = (k: Rig, stage: MeleeStage | null, t: number, dt = 0) => { k.vm.update(dt, {...base, melee: {stage, t}}); return measure(k); };

  for (const id of LARGE) {
    const m = WEAPONS[id].melee!;
    it(`${id}: at the wind-up peak the head / Tip is up and BEHIND the eye (out of view at 16:9, 4:3 and 21:9), the grip end in view`, () => {
      for (const aspect of [16 / 9, 4 / 3, 21 / 9]) {
        const k = make(id, aspect);
        expect(k.vm.camera.fov).toBe(VIEW_FOV_DEG);
        expect(k.vm.camera.near).toBe(0.01);
        const c = measure(k);
        expect(c.tipInView, `${id} carry`).toBe(true); // the head starts in view (carry: upper right)
        expect(c.headOn, `${id} carry`).toBeGreaterThan(0);
        for (let t = 0; t <= 2 + 1e-9; t += 0.05) { // the whole held peak, breathing sway included
          const r = pose(k, 'ready', t), label = `${id} ${aspect.toFixed(2)} ready ${t.toFixed(2)}`;
          expect(r.tip.z, label).toBeGreaterThan(0.1); // >= 10 cm BEHIND the eye: no projection can show it
          expect(r.tip.y, label).toBeGreaterThan(0.3); // up
          expect(r.tip.x, label).toBeGreaterThan(0.1); // over the RIGHT shoulder
          expect(r.tipInView, label).toBe(false);
          expect(r.headOn, label).toBe(0); // no vertex of the head in view
          expect(r.gripInView, label).toBe(true); // ... while the hands' end of the haft stays on screen
          expect(r.on, label).toBeGreaterThan(0.05);
          expect(r.minInView, label).toBeGreaterThan(NEAR_EYE);
          expect(r.minEye, label).toBeGreaterThan(NEAR_EYE);
        }
        // the windup carries it there: exactly the ready pose at its end; the head leaves the view on the way (no pop at the stage change)
        const w = pose(k, 'windup', m.windup), r0 = pose(k, 'ready', 0);
        expect(w.tip.distanceTo(r0.tip), id).toBeLessThan(1e-9);
        let left = -1;
        for (let t = 0; t <= m.windup + 1e-9; t += DT / 2) if (left < 0 && !pose(k, 'windup', t).tipInView) left = t;
        expect(left, id).toBeGreaterThan(0.25 * m.windup); // visibly raised first (through the old top-edge key) ...
        expect(left, id).toBeLessThan(0.8 * m.windup); // ... then drawn back out of view well before the peak
      }
    });

    it(`${id}: the swing comes back over the top — head out of view at the release, back on screen for the last stretch, ON the crosshair at contact`, () => {
      const k = make(id);
      const s0 = pose(k, 'swing', 0);
      expect(s0.tipInView).toBe(false);
      expect(s0.tip.distanceTo(pose(k, 'ready', 0).tip)).toBeLessThan(1e-9); // the swing starts from the held pose (no pop at the release)
      for (let t = 0.85 * m.strike; t <= m.strike + 1e-9; t += DT / 8) expect(pose(k, 'swing', t).tipInView, `${id} swing ${t.toFixed(3)}`).toBe(true);
      const hit = pose(k, 'swing', m.strike);
      expect(Math.hypot(hit.tipNdc.x, hit.tipNdc.y), id).toBeLessThan(1e-6); // the Tip exactly on the crosshair at the hit moment
      // the swing passes through the old raised key (the arcs' via point) — the head at the top edge, partly in view — on its way down
      const via = MELEE_POSES[id].raised, o = new THREE.Object3D();
      o.position.set(...via.pos); o.rotation.set(...via.rot); o.updateMatrixWorld(true);
      const viaTip = new THREE.Vector3(...varietyTip(id)).applyMatrix4(o.matrixWorld);
      expect(pose(k, 'swing', m.strike * Math.SQRT1_2).tip.distanceTo(viaTip), id).toBeLessThan(1e-6); // easeIn(t / strike) = 0.5 there
      expect(pose(k, 'windup', m.windup / 2).tip.distanceTo(viaTip), id).toBeLessThan(1e-6); // smooth(0.5) = 0.5: the windup passes it too
    });

    it(`${id}: a whole cycle (windup, 1 s hold, swing, recovery) and a cancelled hold easing back: no near-plane clipping, no pops`, () => {
      const k = make(id);
      const seq: [MeleeStage | null, number][] = [[null, 0]];
      for (let t = 0; t <= m.windup + 1e-9; t += DT) seq.push(['windup', t]);
      for (let t = 0; t <= 1; t += DT) seq.push(['ready', t]);
      for (let t = 0; t < m.sweep; t += DT / 4) seq.push(['swing', t]);
      for (let t = 0; t <= m.recovery + 1e-9; t += DT) seq.push(['recover', t]);
      let prev = measure(k), prevStep = 0;
      for (const [stage, t] of seq) {
        const v = pose(k, stage, t), label = `${id} ${stage} ${t.toFixed(4)}`;
        // no vertex near the eye, none inside the view nearer than 15 cm: the near plane (1 cm) never cuts the model where it shows
        expect(v.minEye, label).toBeGreaterThan(NEAR_EYE);
        expect(v.minInView, label).toBeGreaterThan(NEAR_EYE);
        // no pops: camera-space tip steps stay small (a frame; a quarter frame in the swing) and never jump against the previous step
        // (an ease from rest grows 1 : 3 : 5 ..., so a ratio above 3 over a few cm is a jump); while the tip is on screen in both
        // samples, the variety tests' screen-step bounds hold as before
        const step = v.tip.distanceTo(prev.tip);
        expect(step, label).toBeLessThan(stage === 'swing' ? 0.25 : 0.32);
        expect(step, label).toBeLessThan(Math.max(0.05, 3.2 * prevStep));
        if (v.tipInView && prev.tipInView) expect(v.tipNdc.distanceTo(prev.tipNdc), label).toBeLessThan(stage === 'swing' ? 0.5 : 0.25);
        prev = v; prevStep = step;
      }
      // a cancelled hold (menu, sprint, switch ...): Viewmodel's existing exponential ease (14 / s: 23 % of the way in a 60 fps frame)
      // takes the applied offset back to the carry — never near the eye, the hands moving a few cm a frame, the steps only shrinking
      // (the largest is the first, the head still out of view behind the shoulder)
      pose(k, 'ready', 0.4);
      prev = measure(k);
      let last = Infinity;
      for (let f = 0; f < 60; f++) {
        const v = pose(k, null, 0, DT), label = `${id} cancel frame ${f}`;
        expect(v.minEye, label).toBeGreaterThan(NEAR_EYE);
        expect(v.minInView, label).toBeGreaterThan(NEAR_EYE);
        const step = v.tip.distanceTo(prev.tip);
        expect(step, label).toBeLessThan(0.4);
        expect(step, label).toBeLessThan(last + 0.01);
        expect(v.grip.distanceTo(prev.grip), label).toBeLessThan(0.1);
        if (f === 0) expect(v.tipInView, label).toBe(false);
        if (v.tipInView && prev.tipInView) expect(v.tipNdc.distanceTo(prev.tipNdc), label).toBeLessThan(0.25);
        prev = v; last = step;
      }
      expect(prev.tip.distanceTo(pose(make(id), null, 0).tip), id).toBeLessThan(1e-3); // settled on the carry
    });
  }
});

// ---------------------------------------------------------------------------------------------------------------------
describe('(b) the hit is unchanged: timing, damage, reach and cooldown (main values), contact still `strike` s after the release', () => {
  // [windup, strike, sweep, recovery, interval (= cadence), damage, headMult, limbMult, range (reach), maxTargets, knockback, stagger, stamina]
  const MAIN: Record<string, readonly number[]> = {
    knife: [0.15, 0.08, 0.16, 0.34, 0.65, 30, 2, 1, 1.125, 1, 0, 0, 0],
    fire_axe: [0.45, 0.12, 0.26, 0.62, 1.33, 55, 2, 1, 1.6, 1, 0.35, 0.35, 18],
    machete: [0.12, 0.07, 0.18, 0.30, 0.60, 24, 2.1, 1, 1.35, 2, 0, 0, 6],
    sledgehammer: [0.60, 0.16, 0.32, 0.85, 1.77, 70, 1.6, 0.85, 1.7, 1, 1.1, 0.7, 24],
    crowbar: [0.25, 0.10, 0.20, 0.42, 0.87, 38, 2, 1, 1.35, 1, 0.2, 0.25, 9],
    slugger: [0.22, 0.10, 0.22, 0.45, 0.89, 36, 2, 1, 1.45, 1, 1.0, 0, 10],
    track_shovel: [0.32, 0.13, 0.26, 0.62, 1.20, 34, 1.8, 1, 2.0, 2, 0.6, 0.3, 14],
  };
  const RAYS: Record<string, readonly (readonly [number, number])[]> = {knife: KNIFE_RAYS, fire_axe: CHOP_RAYS, machete: MACHETE_RAYS, sledgehammer: SLEDGE_RAYS,
    crowbar: CROWBAR_RAYS, slugger: BAT_RAYS, track_shovel: SHOVEL_RAYS};
  const row = (d: WeaponDef) => { const m = d.melee!; return [m.windup, m.strike, m.sweep, m.recovery, d.interval, d.damage, d.headMult, d.limbMult, d.range, m.maxTargets ?? 1, m.knockback ?? 0, m.stagger ?? 0, m.stamina ?? 0]; };

  it('every melee WeaponDef: the timing / damage / reach / cooldown numbers and sweep rays are main\'s', () => {
    expect(Object.keys(MAIN).sort()).toEqual(Object.values(WEAPONS).filter(d => d.melee).map(d => d.id).sort());
    for (const [id, want] of Object.entries(MAIN)) {
      const d = WEAPONS[id], got = row(d);
      for (let i = 0; i < want.length; i++) expect(got[i], `${id} [${i}]`).toBeCloseTo(want[i], 9);
      expect(meleeCadence(d.melee!), id).toBeCloseTo(d.interval, 9);
      expect(d.falloffStart, id).toBe(d.range); // full damage out to the reach
      expect(d.melee!.rays, id).toBe(RAYS[id]);
    }
    expect(WEAPONS.slugger.melee!.charge).toEqual({time: 1.0, damage: [0.8, 1.9], knockback: [0.15, 1.0], stagger: [0, 0.5], stamina: [0.6, 1.6]});
    expect(KNIFE_RAYS).toEqual([[0, 0], [0.09, 0], [-0.09, 0], [0, 0.07], [0, -0.07], [0.18, 0], [-0.18, 0]]);
    expect(CHOP_RAYS).toEqual([[0, 0], [0, -0.09], [0, 0.09], [0.08, 0], [-0.08, 0], [0, -0.18], [0, 0.16], [0, -0.28]]);
    expect(SLEDGE_RAYS).toEqual([[0, 0], [0, -0.1], [0, 0.1], [0.1, 0], [-0.1, 0], [0, -0.2], [0, 0.18], [0, -0.3]]);
    expect(SHOVEL_RAYS).toEqual([[0, 0], [0.1, 0], [-0.1, 0], [0, 0.06], [0, -0.06], [0.2, 0], [-0.2, 0], [0.3, 0], [-0.3, 0], [0.42, 0], [-0.42, 0], [0, -0.14]]);
  });

  it('the real WeaponController (large melee): windup -> held -> release -> ONE contact `strike` s after the swing -> idle after sweep + recovery; a tap likewise', () => {
    for (const id of LARGE) {
      const d = WEAPONS[id], m = d.melee!;
      const inv = new Inventory(), wc = new WeaponController();
      wc.equip({uid: 1, itemId: id, count: 1, mag: 0}, {[id]: d});
      wc.update(2, NONE, inv);
      expect(wc.phase, id).toBe('idle');
      let t = 0;
      const log: {t: number; e: WeaponEvent}[] = [];
      const frame = (i: Partial<TriggerInput> = {}) => { t += DT; for (const e of wc.update(DT, {...NONE, ...i}, inv)) log.push({t, e}); };
      // held: press, hold 1 s (the ready pose; nothing attacks), release
      frame({pressed: true, held: true});
      for (let f = 0; f < 60; f++) frame({held: true});
      expect(log.map(x => x.e.type), id).toEqual(['windup']);
      expect(wc.meleePose.stage, id).toBe('ready');
      frame();
      const at = (type: WeaponEvent['type']) => log.filter(x => x.e.type === type).map(x => x.t);
      for (let f = 0; f < Math.ceil((m.sweep + m.recovery) / DT) + 2; f++) frame();
      expect(log.map(x => x.e.type), id).toEqual(['windup', 'swing', 'contact']);
      const [ts] = at('swing'), [tc] = at('contact');
      expect(tc - ts, id).toBeGreaterThanOrEqual(m.strike - DT - 1e-9); // the contact frame: the first whose end reaches `strike` s
      expect(tc - ts, id).toBeLessThan(m.strike + DT);
      expect(wc.phase, id).toBe('idle');
      // a tap: windup -> swing straight on at the end of the windup -> contact `strike` later (cadence = windup + sweep + recovery)
      log.length = 0;
      const t0 = t;
      frame({pressed: true, held: true}); frame();
      for (let f = 0; f < Math.ceil(meleeCadence(m) / DT) + 2; f++) frame();
      expect(log.map(x => x.e.type), id).toEqual(['windup', 'swing', 'contact']);
      expect(at('swing')[0] - t0, id).toBeCloseTo(m.windup + DT, 1);
      expect(at('contact')[0] - at('swing')[0], id).toBeLessThan(m.strike + DT);
      expect(wc.phase, id).toBe('idle');
    }
  });

  it('the visual hit moment is the logical one: the pose reaches the contact key (Tip on the crosshair) exactly at `strike`, not before', () => {
    const cam = new THREE.PerspectiveCamera(VIEW_FOV_DEG, 16 / 9, 0.01, 20);
    cam.updateMatrixWorld(true);
    for (const id of LARGE) {
      const m = WEAPONS[id].melee!, poses = MELEE_POSES[id] as MeleePoses, c = poses.carry;
      const tipAt = (t: number) => {
        const off = meleePoseOffset('swing', t, m, poses), o = new THREE.Object3D();
        o.position.set(c.pos[0] + off.x, c.pos[1] + off.y, c.pos[2] + off.z);
        o.rotation.set(c.rot[0] + off.rx, c.rot[1] + off.ry, c.rot[2] + off.rz);
        o.updateMatrixWorld(true);
        return new THREE.Vector3(...varietyTip(id)).applyMatrix4(o.matrixWorld);
      };
      const n = tipAt(m.strike).project(cam);
      expect(Math.hypot(n.x, n.y), id).toBeLessThan(1e-6);
      for (const f of [0.5, 0.8, 0.95]) { const p = tipAt(f * m.strike); const q = p.clone().project(cam); expect(p.z > 0 || Math.hypot(q.x, q.y) > 0.02, `${id} ${f}`).toBe(true); }
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('(c) small melee unchanged (and the large weapons\' other keys)', () => {
  // main's solved key poses (ffd98e8d), bit for bit
  const MAIN_KEYS = {
    fire_axe: {carry: {pos: [0, -0.4, -0.4], rot: [0.9323345976829075, -0.43880448074705947, -1.3408581579734864]}, raised: {pos: [0.15, -0.16, -0.36], rot: [0.9068848111072424, -0.3749302757695219, -0.6130967322135685]}, contact: {pos: [0.06, -0.3, -0.46], rot: [0.3721506459798031, 0.07185333645051728, -0.36440017539857417]}, through: {pos: [-0.02, -0.4, -0.36], rot: [-0.2930860606645469, 0.28683174429098085, -0.6530076294918754]}},
    machete: {carry: {pos: [0.18, -0.24, -0.38], rot: [0.8660860336099012, -0.03292407787159715, -0.3912550723244063]}, raised: {pos: [0.22, -0.08, -0.32], rot: [0.6982664161482272, -1.0103715770008102, -0.5957310593678709]}, contact: {pos: [0.16, -0.1, -0.34], rot: [0.1848988409159509, 0.3443919266281301, -1.3191117610203]}, through: {pos: [-0.08, -0.14, -0.36], rot: [0.3251294596885101, 1.0373241609971584, 0.4578696854159942]}, dip: 3},
    sledgehammer: {carry: {pos: [0, -0.44, -0.4], rot: [0.8702883008607567, -0.5037072355558501, -1.3779069696295378]}, raised: {pos: [0.15, -0.18, -0.36], rot: [0.9117958592004494, -0.3695475221011772, -0.6079544725208286]}, contact: {pos: [0.06, -0.32, -0.48], rot: [0.3802581182606638, 0.0708036484786885, -0.3647698788796913]}, through: {pos: [-0.02, -0.42, -0.36], rot: [-0.34593881852381725, 0.2220979934478748, -0.548583597156063]}},
    crowbar: {carry: {pos: [0.18, -0.26, -0.38], rot: [0.8916867871676586, -0.15999017649052683, -0.7280344220250935]}, raised: {pos: [0.26, -0.06, -0.32], rot: [0.7822049381797263, -0.3274524401736699, 0.2260728980293531]}, contact: {pos: [0.12, -0.14, -0.36], rot: [0.2666852073937702, 0.152704099193529, -0.827410816552632]}, through: {pos: [-0.06, -0.26, -0.34], rot: [0.01577657157307255, 0.8890882459280323, 0.33925382563207646]}, dip: 1.8},
    slugger: {carry: {pos: [0.12, -0.38, -0.38], rot: [0.9273307606782467, -0.2809541327313824, -0.2053965846332107]}, raised: {pos: [0.21, -0.2, -0.32], rot: [0.715265012229638, -0.4554778101584097, 0.3654115185484493]}, contact: {pos: [0.18, -0.12, -0.36], rot: [0.15300397281718953, 0.2275334992622283, -0.03469106378719386]}, through: {pos: [-0.1, -0.18, -0.34], rot: [0.48478783503882655, 0.9490256063873105, -0.4043728218110294]}, charged: {pos: [0.21, -0.11, -0.25], rot: [0.6999604046943986, -0.48962130942360327, 0.377502082368766]}, dip: 2.6},
    track_shovel: {carry: {pos: [0, -0.48, -0.34], rot: [0.8566869456963644, -0.45015131677926856, 1.081611681465893]}, raised: {pos: [0.18, -0.3, -0.3], rot: [0.5392250050341656, -0.6666865564118697, 0.5731561580082416]}, contact: {pos: [0.12, -0.26, -0.36], rot: [0.22221695059507224, 0.10361230079409296, -0.022877643649951828]}, through: {pos: [-0.1, -0.3, -0.32], rot: [0.36045534291529785, 0.8586813691095911, -0.27742477513193453]}, dip: 2.6},
  } as const;
  /** FNV-1a over a dense stage / time / charge grid of meleePoseOffset (7 decimals) — main's digests below (ffd98e8d). */
  function digest(id: string): string {
    const m = WEAPONS[id].melee!, poses = MELEE_POSES[id] as MeleePoses;
    let h = 2166136261 >>> 0, n = 0;
    for (const st of ['windup', 'ready', 'swing', 'recover', null] as (MeleeStage | null)[]) for (let i = 0; i <= 240; i++) for (const ch of [0, 0.5, 1]) {
      const o = meleePoseOffset(st, i * 0.005, m, poses, undefined, ch);
      const s = [o.x, o.y, o.z, o.rx, o.ry, o.rz].map(v => v.toFixed(7)).join(',');
      for (let k = 0; k < s.length; k++) { h ^= s.charCodeAt(k); h = Math.imul(h, 16777619) >>> 0; }
      n++;
    }
    return `${h.toString(16)}/${n}`;
  }

  it('the knife, machete, crowbar and slugger: no over-the-shoulder pose; every windup / ready / swing / recovery offset = main\'s (dense grid digest)', () => {
    expect(MELEE_POSES.knife).toBe(KNIFE_POSES);
    for (const id of ['knife', 'machete', 'crowbar', 'slugger']) expect(MELEE_POSES[id].back, id).toBeUndefined();
    expect(Object.fromEntries(['knife', 'machete', 'crowbar', 'slugger'].map(id => [id, digest(id)])))
      .toEqual({knife: 'd8fc1a88/3615', machete: '3e759810/3615', crowbar: '2d4d4792/3615', slugger: '3aa90f1e/3615'});
  });

  it('every variety weapon\'s carry / raised / contact / through (/ charged, dip) keys are main\'s bit for bit; the large ones only ADD `back`', () => {
    for (const id of VARIETY_MELEE_IDS) {
      const {back, ...keys} = MELEE_POSES[id];
      expect(keys, id).toEqual(MAIN_KEYS[id]);
      expect(!!back, id).toBe((LARGE_MELEE_IDS as readonly string[]).includes(id));
      // the carry = WeaponDef.view (unchanged hip / angles)
      expect(WEAPONS[id].view.hip, id).toEqual([...MAIN_KEYS[id].carry.pos]);
      expect([WEAPONS[id].view.hipPitch, WEAPONS[id].view.hipYaw, WEAPONS[id].view.hipRoll], id).toEqual([...MAIN_KEYS[id].carry.rot]);
    }
    // ... so the follow-through and the recovery of the large weapons are main's too (only the windup / ready / strike arc moved)
    for (const id of LARGE) {
      const m = WEAPONS[id].melee!, poses = MELEE_POSES[id] as MeleePoses, old: MeleePoses = {...poses};
      delete old.back; // main's poses of the weapon
      for (let t = m.strike; t <= m.sweep + 1e-9; t += 0.01) expect(meleePoseOffset('swing', t, m, poses), `${id} swing ${t}`).toEqual(meleePoseOffset('swing', t, m, old));
      for (let t = 0; t <= m.recovery + 1e-9; t += 0.02) expect(meleePoseOffset('recover', t, m, poses), `${id} recover ${t}`).toEqual(meleePoseOffset('recover', t, m, old));
      expect(meleePoseOffset(null, 0, m, poses)).toEqual(meleePoseOffset(null, 0, m, old));
    }
  });
});
