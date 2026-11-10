// Task studio-weapon-variety-production-20261109-224355-01 (lane GUNS): the six weapon-variety guns (weapons/varietyGuns.ts) and the
// generic engine support they need. User: "the different guns should have different handling! ofc this is obvious!"
// Covers: the baseline pistol / rifle / shotgun / knife defs and per-shot maths byte-identical (snapshot); each new gun's distinct
// handling vs its family baseline (a table) and no strict upgrade; semi re-arm vs auto hold, strings (recoil climb), ADS settle; the
// BREAK action (two shots, partial / cancelled reloads, no third shot, no free ammo, never "6 of 2", nothing fires while open); the
// viewmodel's late model registration (addModel) and the reload part hooks (Magazine out -> in, Barrels about the Hinge); the scope's
// runtime lens on the Sight axis; the hold rules re-measured on the baseline GLBs; the game.ts wiring. No browser, no git history.
import {describe, expect, it, vi} from 'vitest';
import * as THREE from 'three';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

vi.mock('../src/world/canvasTextures', () => ({canvasTexture: () => new THREE.Texture()}));

const {WEAPONS, WeaponController, firingRecoil, weaponAmmoItem, reserveFor, STREAK_GAP} = await import('../src/weapons/weapons');
type TriggerInput = import('../src/weapons/weapons').TriggerInput;
type WeaponDef = import('../src/weapons/weapons').WeaponDef;
const {VARIETY_GUN_DEFS, HOLD_RULES, VARIETY_GUN_LENGTHS, derivedHip} = await import('../src/weapons/varietyGuns');
const {WEAPON_VARIETY_MODELS} = await import('../src/assets/weaponVarietyModels.generated');
const {VARIETY_GUN_IDS, VARIETY_WEAPONS} = await import('../src/weapons/varietyIds');
const {shotRecoil, shotBloom, bloomDecay, baseSpread, reloadCueTime, SHARED_BLOOM} = await import('../src/weapons/gunHandling');
const {GunParts, magazinePartPose, barrelsAngle, BREAK_ANGLE, MAG_PART} = await import('../src/weapons/gunParts');
const {Viewmodel} = await import('../src/weapons/viewmodel');
const {RifleOptic, APERTURE_GAP} = await import('../src/weapons/optic');
const {KNIFE_RAYS} = await import('../src/combat/melee');
const {carryView, KNIFE_POSES} = await import('../src/weapons/meleeView');
const {Inventory} = await import('../src/items/inventory');
const {EJECTION_PORTS, SHELL_EJECT_DELAY} = await import('../src/physics/world');

const GAME = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = (f: string) => fs.readFileSync(path.join(GAME, f), 'utf8');
const DT = 1 / 60;
const idle: TriggerInput = {held: false, pressed: false, reload: false, lowered: false};
const FAMILY = {hornet: 'pistol', longslide: 'pistol', stub: 'rifle', overwatch: 'rifle', coach_gun: 'shotgun', thresher: 'shotgun'} as const;

let uid = 70000;
/** A held gun with `mag` loaded and `reserve` rounds of its caliber in the inventory, equipped and ready. */
function rig(id: string, mag: number, reserve: number) {
  const inv = new Inventory();
  if (reserve) inv.add(inv.makeStack(weaponAmmoItem(WEAPONS[id])!, reserve));
  const stack = {uid: uid++, itemId: id, count: 1, mag};
  const wc = new WeaponController();
  wc.equip(stack as never);
  wc.update(2, idle, inv); // equip done
  expect(wc.phase).toBe('idle');
  return {inv, wc, stack};
}
type Ev = ReturnType<InstanceType<typeof WeaponController>['update']>[number];
function run(wc: InstanceType<typeof WeaponController>, inv: InstanceType<typeof Inventory>, seconds: number, input: Partial<TriggerInput> | ((i: number) => Partial<TriggerInput>) = {}): Ev[] {
  const out: Ev[] = [];
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) out.push(...wc.update(DT, {...idle, ...(typeof input === 'function' ? input(i) : input)}, inv));
  return out;
}
const count = (ev: Ev[], type: Ev['type']) => ev.filter(e => e.type === type).length;

// ------------------------------------------------------------------------------------------------------------------------------
describe('baseline guns: byte-identical (snapshot of the defs and of the per-shot maths)', () => {
  it('the pistol / rifle / shotgun / knife defs are exactly as before (no optional handling field present)', () => {
    expect(WEAPONS.rifle).toStrictEqual({
      id: 'rifle', itemId: 'rifle', caliber: '5.56x45mm', magazine: 30, auto: true, interval: 0.1,
      damage: 24, pellets: 1, spreadHip: 0.028, spreadAim: 0.004, spreadMove: 0.03,
      range: 90, falloffStart: 40, falloffMin: 0.7, headMult: 2.5, limbMult: 0.7, knockback: 0.25,
      reload: {kind: 'magazine', time: 2.1, emptyTime: 2.55},
      recoil: firingRecoil({pitch: 0.012, yaw: 0.006, kick: 0.035, recover: 9}),
      equipTime: 0.55, aimFov: 52, moveMult: 0.95, noise: 30, sound: 'rifle',
      view: {model: 'rifle', hip: [0.245, -0.41, -0.7], aim: [0.0, -0.283, -0.42], hipYaw: 0.12, hipPitch: 0.03, hipRoll: -0.05, length: 0.92, sightRelief: 0.26, sightLift: 0.04,
        optic: {eyeRelief: 0.105, aperture: {x: -0.0035, y: 0.1394, z: 0.0855, radius: 0.016}}},
    });
    expect(WEAPONS.shotgun).toStrictEqual({
      id: 'shotgun', itemId: 'shotgun', caliber: '12ga', magazine: 6, auto: false, interval: 0.82,
      damage: 15, pellets: 9, spreadHip: 0.075, spreadAim: 0.052, spreadMove: 0.02,
      range: 30, falloffStart: 7, falloffMin: 0.25, headMult: 1.8, limbMult: 0.75, knockback: 0.55,
      reload: {kind: 'shell', start: 0.38, each: 0.48, end: 0.42},
      recoil: firingRecoil({pitch: 0.06, yaw: 0.015, kick: 0.09, recover: 6}),
      equipTime: 0.6, aimFov: 60, moveMult: 0.92, noise: 38, sound: 'shotgun',
      view: {model: 'shotgun', hip: [0.235, -0.27, -0.66], aim: [0.0, -0.095, -0.45], hipYaw: 0.12, hipPitch: 0.03, hipRoll: -0.05, length: 1.0, sightRelief: 0.30, sightLift: 0.022},
    });
    expect(WEAPONS.pistol).toStrictEqual({
      id: 'pistol', itemId: 'pistol', caliber: '9x19mm', magazine: 15, auto: false, interval: 0.16,
      damage: 17, pellets: 1, spreadHip: 0.022, spreadAim: 0.006, spreadMove: 0.025,
      range: 60, falloffStart: 22, falloffMin: 0.6, headMult: 2.4, limbMult: 0.7, knockback: 0.18,
      reload: {kind: 'magazine', time: 1.4, emptyTime: 1.65},
      recoil: firingRecoil({pitch: 0.016, yaw: 0.005, kick: 0.03, recover: 11}),
      equipTime: 0.35, aimFov: 58, moveMult: 1.0, noise: 24, sound: 'pistol',
      view: {model: 'pistol', hip: [0.16, -0.17, -0.36], aim: [0.0, -0.08, -0.36], hipYaw: 0.08, hipPitch: 0.03, hipRoll: -0.04, length: 0.2, sightRelief: 0.28, sightLift: 0.014},
    });
    expect(WEAPONS.knife).toStrictEqual({
      id: 'knife', itemId: 'knife', magazine: 0, auto: false, interval: 0.65,
      damage: 30, pellets: 1, spreadHip: 0, spreadAim: 0, spreadMove: 0,
      range: 1.125, falloffStart: 1.125, falloffMin: 1, headMult: 2, limbMult: 1, knockback: 0,
      reload: {kind: 'magazine', time: 0, emptyTime: 0}, recoil: {pitch: 0, yaw: 0, kick: 0, recover: 8},
      equipTime: 0.3, aimFov: 75, moveMult: 1.0, noise: 5, sound: 'pistol',
      melee: {windup: 0.15, strike: 0.08, sweep: 0.16, recovery: 0.34, rays: KNIFE_RAYS},
      view: {model: 'knife', ...carryView(KNIFE_POSES.carry), length: 0.32},
    });
    // the baseline four come first, in their order; the variety guns follow
    expect(Object.keys(WEAPONS).slice(0, 4)).toEqual(['rifle', 'shotgun', 'pistol', 'knife']);
    for (const id of VARIETY_GUN_IDS) expect(WEAPONS[id], id).toBe(VARIETY_GUN_DEFS[id]);
  });

  it('per-shot maths for the baseline guns = the former inline expressions, bit for bit, with ONE RNG draw per shot', () => {
    for (const id of ['rifle', 'shotgun', 'pistol'] as const) {
      const def = WEAPONS[id];
      for (const kickMul of [1, 0.6, 0.6 * 0.7, 0.7]) for (const streak of [0, 3, 40]) {
        const draws = [0.137, 0.861];
        let k = 0;
        const rand = () => draws[k++];
        const r = shotRecoil(def, kickMul, streak, rand);
        expect(k, id).toBe(1);
        expect(r.pitch).toBe(def.recoil.pitch * kickMul);
        expect(r.yaw).toBe((0.137 - 0.5) * 2 * def.recoil.yaw * kickMul);
        expect(r.view).toBe(def.recoil.pitch * 0.3 * kickMul);
      }
      for (const b of [0, 0.001, 0.0299, 0.03]) expect(shotBloom(def, b)).toBe(def.pellets === 1 ? Math.min(0.03, b + 0.0035) : b);
      expect(bloomDecay(def)).toBe(0.06);
      expect(baseSpread(def, true, 0.5)).toBe(def.spreadAim); // no AimSettle: the settle never adds
      expect(baseSpread(def, false, 0.5)).toBe(def.spreadHip);
    }
    expect(bloomDecay(null)).toBe(0.06);
    expect(SHARED_BLOOM).toEqual({per: 0.0035, max: 0.03, decay: 0.06});
    // the reload cue timing the game now passes = the times the sfx used to hard-code for the baseline guns
    expect([reloadCueTime(WEAPONS.rifle, true), reloadCueTime(WEAPONS.rifle, false), reloadCueTime(WEAPONS.pistol, true), reloadCueTime(WEAPONS.pistol, false)]).toEqual([2.55, 2.1, 1.65, 1.4]);
    expect(reloadCueTime(WEAPONS.shotgun, true)).toBeUndefined();
  });

  it('the baseline controllers behave as before: rifle auto 10 rounds/s, pistol / shotgun one shot per press, shotgun shell reload', () => {
    const r = rig('rifle', 30, 60);
    let shots = 0; // (gameplay.test.ts: 0.01 s steps, 1 s at 600 rpm)
    for (let i = 0; i < 100; i++) shots += count(r.wc.update(0.01, {...idle, held: true, pressed: i === 0, aiming: true}, r.inv), 'fire');
    expect(shots).toBe(10);
    expect(r.wc.settleSpread).toBe(0);
    expect(r.wc.actionOpen).toBe(0);
    const p = rig('pistol', 15, 0);
    expect(count(run(p.wc, p.inv, 2, i => ({held: true, pressed: i === 0})), 'fire')).toBe(1);
    const s = rig('shotgun', 0, 3);
    s.wc.update(DT, {...idle, reload: true}, s.inv);
    const ev = run(s.wc, s.inv, 4);
    expect(count(ev, 'shellIn')).toBe(3);
    expect(s.stack.mag).toBe(3);
    expect(s.wc.actionOpen).toBe(0);
  });
});

// ------------------------------------------------------------------------------------------------------------------------------
describe('the six guns: distinct handling vs their family baseline (the table), every one viable, none a strict upgrade', () => {
  const reloadTime = (d: WeaponDef) => d.reload.kind === 'magazine' ? d.reload.time
    : d.reload.start + d.reload.each * d.magazine + d.reload.end; // full reload from empty, shell / break: every round
  const row = (d: WeaponDef) => ({
    mode: d.auto ? 'auto' : 'semi', interval: d.interval, magazine: d.magazine, reload: d.reload.kind, reloadTime: +reloadTime(d).toFixed(3),
    perShot: d.damage * d.pellets, dps: +(d.damage * d.pellets / d.interval).toFixed(1), hip: d.spreadHip, aim: d.spreadAim,
    settle: d.aimSettle?.time ?? 0, pitch: +d.recoil.pitch.toFixed(4), climb: d.recoilClimb?.climb ?? 0, moveMult: d.moveMult, equip: d.equipTime,
    range: d.range, falloffStart: d.falloffStart, aimFov: d.aimFov,
  });

  it('the handling table (exact values)', () => {
    const table = Object.fromEntries([...['pistol', 'rifle', 'shotgun'], ...VARIETY_GUN_IDS].map(id => [id, row(WEAPONS[id])]));
    expect(table).toEqual({
      pistol: {mode: 'semi', interval: 0.16, magazine: 15, reload: 'magazine', reloadTime: 1.4, perShot: 17, dps: 106.3, hip: 0.022, aim: 0.006, settle: 0, pitch: 0.024, climb: 0, moveMult: 1, equip: 0.35, range: 60, falloffStart: 22, aimFov: 58},
      rifle: {mode: 'auto', interval: 0.1, magazine: 30, reload: 'magazine', reloadTime: 2.1, perShot: 24, dps: 240, hip: 0.028, aim: 0.004, settle: 0, pitch: 0.018, climb: 0, moveMult: 0.95, equip: 0.55, range: 90, falloffStart: 40, aimFov: 52},
      shotgun: {mode: 'semi', interval: 0.82, magazine: 6, reload: 'shell', reloadTime: 3.68, perShot: 135, dps: 164.6, hip: 0.075, aim: 0.052, settle: 0, pitch: 0.09, climb: 0, moveMult: 0.92, equip: 0.6, range: 30, falloffStart: 7, aimFov: 60},
      hornet: {mode: 'auto', interval: 0.07, magazine: 30, reload: 'magazine', reloadTime: 1.7, perShot: 13, dps: 185.7, hip: 0.022, aim: 0.009, settle: 0, pitch: 0.0105, climb: 0.12, moveMult: 1, equip: 0.3, range: 45, falloffStart: 12, aimFov: 60},
      longslide: {mode: 'semi', interval: 0.28, magazine: 10, reload: 'magazine', reloadTime: 1.55, perShot: 27, dps: 96.4, hip: 0.03, aim: 0.0025, settle: 0.3, pitch: 0.045, climb: 0, moveMult: 1, equip: 0.4, range: 80, falloffStart: 35, aimFov: 52},
      stub: {mode: 'auto', interval: 0.09, magazine: 30, reload: 'magazine', reloadTime: 2.6, perShot: 22, dps: 244.4, hip: 0.02, aim: 0.008, settle: 0, pitch: 0.0165, climb: 0.04, moveMult: 0.98, equip: 0.42, range: 75, falloffStart: 30, aimFov: 56},
      overwatch: {mode: 'semi', interval: 0.36, magazine: 12, reload: 'magazine', reloadTime: 2.4, perShot: 46, dps: 127.8, hip: 0.05, aim: 0.0012, settle: 0.6, pitch: 0.0525, climb: 0, moveMult: 0.9, equip: 0.75, range: 120, falloffStart: 70, aimFov: 30},
      coach_gun: {mode: 'semi', interval: 0.2, magazine: 2, reload: 'break', reloadTime: 1.74, perShot: 160, dps: 800, hip: 0.08, aim: 0.056, settle: 0, pitch: 0.1125, climb: 0, moveMult: 0.93, equip: 0.55, range: 26, falloffStart: 7, aimFov: 62},
      thresher: {mode: 'semi', interval: 0.45, magazine: 8, reload: 'magazine', reloadTime: 2.7, perShot: 112, dps: 248.9, hip: 0.08, aim: 0.058, settle: 0, pitch: 0.105, climb: 0, moveMult: 0.88, equip: 0.8, range: 28, falloffStart: 6, aimFov: 62},
    });
  });

  it('the brief: cadence / mode / magazine / reload style per gun relative to the baseline', () => {
    const W = WEAPONS;
    // hornet: auto, the fastest cadence, lower damage per shot, magazine ~30, short falloff, the quickest equip
    expect(W.hornet.auto).toBe(true);
    for (const id of Object.keys(W)) if (id !== 'hornet' && !W[id].melee) expect(W.hornet.interval, id).toBeLessThan(W[id].interval);
    expect(W.hornet.damage).toBeLessThan(W.pistol.damage);
    expect(W.hornet.falloffStart).toBeLessThan(W.pistol.falloffStart);
    expect(W.hornet.range).toBeLessThan(W.pistol.range);
    expect(W.hornet.spreadHip).toBeLessThanOrEqual(W.pistol.spreadHip);
    expect(W.hornet.recoilClimb!.climb).toBeGreaterThan(0);
    expect(W.hornet.recoilClimb!.jitter).toBeGreaterThan(0);
    for (const id of VARIETY_GUN_IDS) if (id !== 'hornet') expect(W.hornet.equipTime, id).toBeLessThan(W[id].equipTime);
    expect(W.hornet.equipTime).toBeLessThan(W.pistol.equipTime);
    // longslide: semi, deliberate, harder hitting, small magazine, very tight aim that settles, longer range, sharper kick, narrower FOV
    expect(W.longslide.auto).toBe(false);
    expect(W.longslide.interval).toBeGreaterThan(W.pistol.interval);
    expect(W.longslide.damage).toBeGreaterThan(W.pistol.damage);
    expect(W.longslide.magazine).toBeLessThan(W.pistol.magazine);
    expect(W.longslide.spreadAim).toBeLessThan(W.pistol.spreadAim);
    expect(W.longslide.aimSettle!.time).toBeGreaterThan(0);
    expect(W.longslide.falloffStart).toBeGreaterThan(W.pistol.falloffStart);
    expect(W.longslide.recoil.pitch).toBeGreaterThan(W.pistol.recoil.pitch);
    expect(W.longslide.aimFov).toBeLessThan(W.pistol.aimFov);
    // stub: auto, a bit faster than the rifle, better hip / handling, worse aim, more jitter, a slower magazine change
    expect(W.stub.auto).toBe(true);
    expect(W.stub.interval).toBeLessThan(W.rifle.interval);
    expect(W.stub.spreadHip).toBeLessThan(W.rifle.spreadHip);
    expect(W.stub.spreadAim).toBeGreaterThan(W.rifle.spreadAim);
    expect(W.stub.equipTime).toBeLessThan(W.rifle.equipTime);
    expect(W.stub.moveMult).toBe(0.98);
    expect(W.stub.recoil.yaw).toBeGreaterThan(W.rifle.recoil.yaw);
    expect(W.stub.recoilClimb!.jitter).toBeGreaterThan(0);
    expect((W.stub.reload as {time: number}).time).toBeGreaterThan((W.rifle.reload as {time: number}).time);
    // overwatch: semi, slow, heavy hitting (+ head), 10-15 rounds, poor hip, very tight aim after a longer settle, scoped, heavy
    expect(W.overwatch.auto).toBe(false);
    expect(W.overwatch.damage).toBeGreaterThan(W.rifle.damage);
    expect(W.overwatch.headMult).toBeGreaterThan(W.rifle.headMult);
    expect(W.overwatch.magazine).toBeGreaterThanOrEqual(10);
    expect(W.overwatch.magazine).toBeLessThanOrEqual(15);
    expect(W.overwatch.spreadHip).toBeGreaterThan(W.rifle.spreadHip);
    for (const id of Object.keys(W)) if (id !== 'overwatch' && !W[id].melee) expect(W.overwatch.spreadAim, id).toBeLessThan(W[id].spreadAim);
    expect(W.overwatch.aimSettle!.time).toBeGreaterThan(W.longslide.aimSettle!.time);
    expect(W.overwatch.aimFov).toBeGreaterThanOrEqual(28);
    expect(W.overwatch.aimFov).toBeLessThanOrEqual(32);
    expect(W.overwatch.view.optic?.sightAperture).toBeTruthy();
    expect(W.overwatch.moveMult).toBe(0.9);
    expect(W.overwatch.equipTime).toBeGreaterThan(W.rifle.equipTime);
    // coach gun: exactly two, a fast follow-up, a bit more per shot than the pump, heavier kick, break reload
    expect(W.coach_gun.magazine).toBe(2);
    expect(W.coach_gun.interval).toBeLessThan(0.3);
    expect(W.coach_gun.pellets).toBeGreaterThan(W.shotgun.pellets);
    expect(W.coach_gun.damage * W.coach_gun.pellets).toBeGreaterThan(W.shotgun.damage * W.shotgun.pellets);
    expect(W.coach_gun.recoil.pitch).toBeGreaterThan(W.shotgun.recoil.pitch);
    expect(W.coach_gun.reload.kind).toBe('break');
    // thresher: semi, faster repeat than the pump, ~8 magazine reload, fewer pellets / less per shot, heavy recoil, the heaviest
    expect(W.thresher.auto).toBe(false);
    expect(W.thresher.interval).toBeLessThan(W.shotgun.interval);
    expect(W.thresher.magazine).toBe(8);
    expect(W.thresher.reload.kind).toBe('magazine');
    expect(W.thresher.pellets).toBeLessThan(W.shotgun.pellets);
    expect(W.thresher.damage).toBeLessThan(W.shotgun.damage);
    expect(W.thresher.recoil.pitch).toBeGreaterThan(W.shotgun.recoil.pitch);
    for (const id of Object.keys(W)) if (id !== 'thresher' && !W[id].melee) {
      expect(W.thresher.equipTime, id).toBeGreaterThan(W[id].equipTime);
      expect(W.thresher.moveMult, id).toBeLessThan(W[id].moveMult);
    }
  });

  it('ids, calibers, cues and view keys: the contract (no new caliber, no new audio set)', () => {
    for (const id of VARIETY_GUN_IDS) {
      const d = WEAPONS[id];
      expect(d.id).toBe(id);
      expect(d.itemId).toBe(id);
      expect(d.caliber, id).toBe(VARIETY_WEAPONS[id].caliber);
      expect(d.caliber, id).toBe(WEAPONS[FAMILY[id]].caliber); // the family's ammo pool
      expect(['pistol', 'rifle', 'shotgun']).toContain(d.sound);
      if (d.reloadCue) expect(['pistol', 'rifle', 'shotgun']).toContain(d.reloadCue);
      expect(d.melee).toBeUndefined();
      expect(d.view.model).toBe(id);
      expect(d.view.length).toBe(WEAPON_VARIETY_MODELS[id]?.length ?? VARIETY_GUN_LENGTHS[id]);
      expect(d.view.sightRelief).toBeGreaterThan(0);
      expect(Number.isFinite(d.view.hip[0] + d.view.hip[1] + d.view.hip[2])).toBe(true);
      expect(d.recoil.recover).toBeGreaterThan(0);
    }
    // 12-gauge semi-autos / break actions never rack a pump after a shot; the pump keeps its rack (default by cue set)
    expect([WEAPONS.coach_gun.shotCycle, WEAPONS.thresher.shotCycle, WEAPONS.shotgun.shotCycle]).toEqual(['none', 'none', undefined]);
    expect(WEAPONS.thresher.reloadCue).toBe('rifle'); // a box-magazine change uses the magazine cues
  });

  it('every gun is different from its family baseline in at least 8 handling dimensions, and worse in at least one (no strict upgrade)', () => {
    // higher = better for the player
    const metrics: Record<string, (d: WeaponDef) => number> = {
      perShot: d => d.damage * d.pellets, dps: d => d.damage * d.pellets / d.interval, magazine: d => d.magazine,
      reload: d => -(d.reload.kind === 'magazine' ? d.reload.time : d.reload.start + d.reload.each * d.magazine + d.reload.end) / d.magazine,
      hip: d => -d.spreadHip, aim: d => -d.spreadAim, kick: d => -d.recoil.pitch, move: d => d.moveMult, equip: d => -d.equipTime,
      range: d => d.falloffStart, settle: d => -(d.aimSettle?.time ?? 0),
    };
    for (const id of VARIETY_GUN_IDS) {
      const d = WEAPONS[id], b = WEAPONS[FAMILY[id]];
      const diff = Object.keys(metrics).filter(k => Math.abs(metrics[k](d) - metrics[k](b)) > 1e-9);
      const worse = Object.keys(metrics).filter(k => metrics[k](d) < metrics[k](b) - 1e-9);
      const better = Object.keys(metrics).filter(k => metrics[k](d) > metrics[k](b) + 1e-9);
      expect(diff.length, `${id} differs in ${diff}`).toBeGreaterThanOrEqual(8);
      expect(worse.length, `${id} worse in ${worse}`).toBeGreaterThanOrEqual(2);
      expect(better.length, `${id} better in ${better}`).toBeGreaterThanOrEqual(2);
    }
    // the two guns of a family differ from each other too (fire mode or cadence, magazine, reload, range)
    for (const [a, b] of [['hornet', 'longslide'], ['stub', 'overwatch'], ['coach_gun', 'thresher']] as const) {
      expect(WEAPONS[a].auto !== WEAPONS[b].auto || WEAPONS[a].interval !== WEAPONS[b].interval).toBe(true);
      expect(WEAPONS[a].magazine).not.toBe(WEAPONS[b].magazine);
    }
  });

  it('viable: a standard zombie (100 hp) dies in a handful of hits at close range; the DMR head shot is one hit', () => {
    for (const id of VARIETY_GUN_IDS) {
      const d = WEAPONS[id];
      const body = d.damage * d.pellets * WeaponController.falloff(d, 5);
      expect(Math.ceil(100 / body), id).toBeLessThanOrEqual(8);
      expect(d.magazine * body, id).toBeGreaterThan(100);
    }
    expect(WEAPONS.overwatch.damage * WEAPONS.overwatch.headMult).toBeGreaterThanOrEqual(100);
    expect(Math.ceil(100 / (WEAPONS.longslide.damage * WEAPONS.longslide.headMult))).toBe(2);
    expect(Math.ceil(100 / (WEAPONS.pistol.damage * WEAPONS.pistol.headMult))).toBe(3);
    // range: the hornet falls off early, the longslide / overwatch late
    expect(WeaponController.falloff(WEAPONS.hornet, 30)).toBeLessThan(WeaponController.falloff(WEAPONS.pistol, 30));
    expect(WeaponController.falloff(WEAPONS.longslide, 40)).toBeGreaterThan(WeaponController.falloff(WEAPONS.pistol, 40));
    expect(WeaponController.falloff(WEAPONS.overwatch, 80)).toBeGreaterThan(WeaponController.falloff(WEAPONS.rifle, 80));
  });
});

// ------------------------------------------------------------------------------------------------------------------------------
describe('trigger edges: semi re-arms on a new press, auto holds; strings climb; ADS settles', () => {
  it('semi guns: one shot per press (holding never refires), a press inside the cadence does not fire, the next press after it does', () => {
    for (const id of ['longslide', 'overwatch', 'coach_gun', 'thresher']) {
      const {wc, inv, stack} = rig(id, WEAPONS[id].magazine, 0);
      expect(count(run(wc, inv, 2, i => ({held: true, pressed: i === 0})), 'fire'), id).toBe(1);
      // a press 0.1 s after a shot (inside every semi cadence >= 0.2 s) is dropped; one after the cadence fires
      const ev = run(wc, inv, 1, i => ({pressed: i === 0 || i === 6 || i === Math.ceil(WEAPONS[id].interval / DT) + 2}));
      expect(count(ev, 'fire'), id).toBe(stack.mag === 0 ? 1 : 2);
    }
  });

  it('auto guns hold: cadence hornet > stub > rifle at 60 and 144 fps (the controller\'s frame-quantized cooldown, as the rifle); a one-frame click fires once; releasing stops', () => {
    const rate = (id: string, fps: number) => {
      const r = rig(id, 999, 0);
      let n = 0;
      for (let i = 0; i < fps * 3; i++) n += count(r.wc.update(1 / fps, {...idle, held: true, pressed: i === 0}, r.inv), 'fire');
      return n / 3;
    };
    for (const fps of [60, 144]) {
      const h = rate('hornet', fps), s = rate('stub', fps), r = rate('rifle', fps);
      expect(h, `${fps} fps`).toBeGreaterThan(s);
      expect(s, `${fps} fps`).toBeGreaterThan(r);
      expect(h).toBeLessThanOrEqual(1 / WEAPONS.hornet.interval + 0.5);
      expect(h).toBeGreaterThan(0.8 / WEAPONS.hornet.interval);
    }
    const c = rig('hornet', 30, 0);
    expect(count(run(c.wc, c.inv, 1, i => ({held: i === 0, pressed: i === 0})), 'fire')).toBe(1); // a click, released next frame
    // lowered (sprint / item use / climbing) or a wiped hold (menu / blur: held false) stops the string at once
    const l = rig('hornet', 30, 0);
    expect(count(run(l.wc, l.inv, 0.5, i => ({held: true, pressed: i === 0, lowered: i >= 10})), 'fire')).toBeLessThanOrEqual(3);
    const w = rig('hornet', 30, 0);
    expect(count(run(w.wc, w.inv, 0.5, i => ({held: i < 10, pressed: i === 0})), 'fire')).toBeLessThanOrEqual(3);
  });

  it('strings: WeaponController.streak counts shots inside the cadence (+ STREAK_GAP) and restarts after a pause; the hornet climbs to 2.2x', () => {
    const h = rig('hornet', 30, 0);
    const streaks: number[] = [];
    for (let i = 0; i < 60; i++) for (const e of h.wc.update(DT, {...idle, held: true, pressed: i === 0}, h.inv)) if (e.type === 'fire') streaks.push(h.wc.streak);
    expect(streaks.slice(0, 5)).toEqual([0, 1, 2, 3, 4]);
    run(h.wc, h.inv, WEAPONS.hornet.interval + STREAK_GAP + 0.05); // a pause
    const again: number[] = [];
    for (const e of h.wc.update(DT, {...idle, held: true, pressed: true}, h.inv)) if (e.type === 'fire') again.push(h.wc.streak);
    expect(again).toEqual([0]);
    const d = WEAPONS.hornet, rand = () => 0.5;
    expect(shotRecoil(d, 1, 0, rand).pitch).toBeCloseTo(d.recoil.pitch, 12);
    expect(shotRecoil(d, 1, 10, rand).pitch / d.recoil.pitch).toBeCloseTo(2.2, 9);
    expect(shotRecoil(d, 1, 99, rand).pitch / d.recoil.pitch).toBeCloseTo(2.2, 9); // capped
    // sideways jitter: a second draw, up to +-jitter on top of the def's yaw
    let k = 0;
    const draws = [1, 1];
    const r = shotRecoil(d, 1, 0, () => draws[k++]);
    expect(k).toBe(2);
    expect(r.yaw).toBeCloseTo(d.recoil.yaw + d.recoilClimb!.jitter, 12);
    // a semi gun without RecoilClimb never climbs, however fast it is fired
    expect(shotRecoil(WEAPONS.longslide, 1, 9, rand).pitch).toBe(WEAPONS.longslide.recoil.pitch);
  });

  it('ADS settle: the aimed cone starts wider and eases to spreadAim over `time` s of steady aim; a shot sets it back; hip resets it', () => {
    for (const id of ['longslide', 'overwatch'] as const) {
      const d = WEAPONS[id], a = d.aimSettle!;
      const {wc, inv} = rig(id, d.magazine, 0);
      wc.update(DT, {...idle, aiming: true}, inv);
      expect(wc.settleSpread, id).toBeGreaterThan(a.extra * 0.95);
      expect(baseSpread(d, true, wc.settleSpread)).toBeGreaterThan(d.spreadAim + a.extra * 0.95);
      run(wc, inv, a.time / 2, {aiming: true});
      expect(wc.settleSpread).toBeGreaterThan(0);
      expect(wc.settleSpread).toBeLessThan(a.extra);
      run(wc, inv, a.time / 2 + 0.05, {aiming: true});
      expect(wc.settleSpread, id).toBe(0);
      expect(baseSpread(d, true, wc.settleSpread)).toBe(d.spreadAim);
      // a shot while settled sets the hold back by shot x time
      expect(count(wc.update(DT, {...idle, aiming: true, pressed: true, held: true}, inv), 'fire')).toBe(1);
      expect(wc.settleSpread).toBeGreaterThan(0);
      run(wc, inv, a.time, {aiming: true});
      expect(wc.settleSpread).toBe(0);
      // leaving ADS (or a weapon change) starts the next ADS unsettled
      wc.update(DT, idle, inv);
      expect(wc.aimT).toBe(0);
      wc.update(DT, {...idle, aiming: true}, inv);
      expect(wc.settleSpread).toBeGreaterThan(a.extra * 0.95);
    }
    // the overwatch settles slower than the longslide and ends tighter
    expect(WEAPONS.overwatch.aimSettle!.time).toBeGreaterThan(WEAPONS.longslide.aimSettle!.time);
    expect(WEAPONS.overwatch.spreadAim).toBeLessThan(WEAPONS.longslide.spreadAim);
  });

  it('bloom: each gun its own growth / recovery; pellet guns without a Bloom keep none (the pump), the thresher blooms', () => {
    let b = 0;
    for (let i = 0; i < 40; i++) b = shotBloom(WEAPONS.hornet, b);
    expect(b).toBe(WEAPONS.hornet.bloom!.max);
    expect(shotBloom(WEAPONS.shotgun, 0)).toBe(0);
    expect(shotBloom(WEAPONS.coach_gun, 0)).toBe(0);
    expect(shotBloom(WEAPONS.thresher, 0)).toBe(WEAPONS.thresher.bloom!.per);
    expect(shotBloom(WEAPONS.stub, 0)).toBe(0.0035); // the shared rule
    expect(bloomDecay(WEAPONS.hornet)).toBeGreaterThan(0.06);
    expect(bloomDecay(WEAPONS.overwatch)).toBeLessThan(0.06);
  });

  it('magazine guns: a weapon switch mid-reload moves no rounds; the reload refills to each gun\'s own magazine from the shared pool', () => {
    const {wc, inv, stack} = rig('hornet', 4, 50);
    wc.update(DT, {...idle, reload: true}, inv);
    run(wc, inv, 1.0);
    expect(wc.reloading).toBe(true);
    const other = {uid: uid++, itemId: 'pistol', count: 1, mag: 15};
    wc.equip(other as never);
    expect(stack.mag).toBe(4);
    expect(inv.count('ammo_9mm')).toBe(50);
    wc.equip(stack as never);
    run(wc, inv, 1);
    wc.update(DT, {...idle, reload: true}, inv);
    run(wc, inv, WEAPONS.hornet.reload.kind === 'magazine' ? WEAPONS.hornet.reload.time + 0.1 : 0);
    expect(stack.mag).toBe(30);
    expect(inv.count('ammo_9mm')).toBe(24);
    // the thresher: a MAGAZINE change (no shell-by-shell events), 8 rounds
    const t = rig('thresher', 0, 20);
    t.wc.update(DT, {...idle, reload: true}, t.inv);
    const ev = run(t.wc, t.inv, 3.5);
    expect(count(ev, 'shellIn')).toBe(0);
    expect(count(ev, 'reloadEnd')).toBe(1);
    expect(t.stack.mag).toBe(8);
    expect(t.inv.count('ammo_12ga')).toBe(12);
  });
});

// ------------------------------------------------------------------------------------------------------------------------------
describe('the coach gun BREAK action', () => {
  const R = WEAPONS.coach_gun.reload as {kind: 'break'; start: number; eject: number; each: number; end: number};
  const total = (r: ReturnType<typeof rig>) => (r.stack.mag ?? 0) + r.inv.count('ammo_12ga');

  it('exactly two shots, a fast follow-up between the barrels, then dry (never a third)', () => {
    const r = rig('coach_gun', 2, 0);
    const ev = run(r.wc, r.inv, 2, i => ({held: true, pressed: i % 2 === 0}));
    expect(count(ev, 'fire')).toBe(2);
    expect(count(ev, 'dry')).toBeGreaterThan(0);
    expect(r.stack.mag).toBe(0);
    // the second barrel follows within ~0.2 s (the pump needs 0.82 s)
    const r2 = rig('coach_gun', 2, 0);
    const times: number[] = [];
    for (let i = 0; i < 60; i++) if (r2.wc.update(DT, {...idle, pressed: true, held: true}, r2.inv).some(e => e.type === 'fire')) times.push(i * DT);
    expect(times.length).toBe(2);
    expect(times[1] - times[0]).toBeLessThan(0.25);
  });

  it('open -> eject -> load 2 -> close: timing, events, progress and the action opening', () => {
    const r = rig('coach_gun', 0, 10);
    const ev0 = r.wc.update(DT, {...idle, reload: true}, r.inv);
    expect(ev0.map(e => e.type)).toEqual(['reloadStart']);
    const opens: number[] = [], shellsAt: number[] = [];
    let t = 0, endAt = -1;
    for (let i = 0; i < 200 && endAt < 0; i++) {
      t += DT;
      for (const e of r.wc.update(DT, idle, r.inv)) { if (e.type === 'shellIn') shellsAt.push(t); if (e.type === 'reloadEnd') endAt = t; }
      opens.push(r.wc.actionOpen);
    }
    expect(shellsAt.length).toBe(2);
    expect(shellsAt[0]).toBeCloseTo(R.start + R.each - DT, 1);
    expect(shellsAt[1] - shellsAt[0]).toBeCloseTo(R.each, 1);
    expect(endAt).toBeCloseTo(R.start + 2 * R.each + R.end - DT, 1);
    expect(r.stack.mag).toBe(2);
    expect(r.inv.count('ammo_12ga')).toBe(8);
    // the action: opens over `eject` s, stays open while loading, closes over `end`, closed once idle
    expect(Math.max(...opens)).toBe(1);
    const fullyOpenAt = opens.findIndex(o => o >= 1) * DT;
    expect(fullyOpenAt).toBeCloseTo(R.eject, 1);
    expect(opens.at(-1)).toBe(0);
    expect(r.wc.actionOpen).toBe(0);
    expect(r.wc.reloading).toBe(false);
  });

  it('one shell in reserve loads one; one barrel still loaded loads the other only; full -> no reload; never "6 of 2"', () => {
    const one = rig('coach_gun', 0, 1);
    one.wc.update(DT, {...idle, reload: true}, one.inv);
    run(one.wc, one.inv, 2);
    expect(one.stack.mag).toBe(1);
    expect(one.inv.count('ammo_12ga')).toBe(0);
    expect(one.wc.canReload(one.inv)).toBe(false);
    const half = rig('coach_gun', 1, 10);
    half.wc.update(DT, {...idle, reload: true}, half.inv);
    const ev = run(half.wc, half.inv, 2);
    expect(count(ev, 'shellIn')).toBe(1);
    expect(half.stack.mag).toBe(2);
    expect(half.inv.count('ammo_12ga')).toBe(9);
    const full = rig('coach_gun', 2, 10);
    expect(full.wc.canReload(full.inv)).toBe(false);
    expect(full.wc.update(DT, {...idle, reload: true}, full.inv)).toEqual([]);
    // spamming R / reloads through many cycles: the loaded count never exceeds 2
    const spam = rig('coach_gun', 0, 30);
    let maxMag = 0;
    for (let i = 0; i < 1200; i++) { spam.wc.update(DT, {...idle, reload: i % 3 === 0, pressed: i % 50 === 0, held: i % 50 === 0}, spam.inv); maxMag = Math.max(maxMag, spam.stack.mag ?? 0); }
    expect(maxMag).toBe(2);
  });

  it('nothing fires while the action is open; a press (with a shell loaded) closes it without loading more, then fires on a new press', () => {
    const r = rig('coach_gun', 1, 10);
    r.wc.update(DT, {...idle, reload: true}, r.inv);
    // press while opening: no fire; at the end of the opening it closes (no shell taken)
    const during = run(r.wc, r.inv, 0.2, i => ({pressed: i === 3, held: i === 3}));
    expect(count(during, 'fire')).toBe(0);
    const rest = run(r.wc, r.inv, R.start + R.end, {held: true});
    expect(count(rest, 'fire')).toBe(0); // still held, no new press: semi never fires
    expect(count(rest, 'shellIn')).toBe(0);
    expect(count(rest, 'reloadEnd')).toBe(1);
    expect(r.stack.mag).toBe(1);
    expect(r.inv.count('ammo_12ga')).toBe(10);
    expect(count(r.wc.update(DT, {...idle, pressed: true, held: true}, r.inv), 'fire')).toBe(1);
    // empty gun: a press while open cannot interrupt (nothing to fire): it loads both and closes; no fire meanwhile
    const e = rig('coach_gun', 0, 10);
    e.wc.update(DT, {...idle, reload: true}, e.inv);
    const ev = run(e.wc, e.inv, 2.5, i => ({pressed: i % 7 === 0, held: true}));
    const firstFire = ev.findIndex(x => x.type === 'fire'), endIx = ev.findIndex(x => x.type === 'reloadEnd');
    expect(endIx).toBeGreaterThanOrEqual(0);
    expect(firstFire === -1 || firstFire > endIx).toBe(true);
  });

  it('a weapon switch (or sprint / menu) mid-reload keeps exactly the shells already loaded: no free ammo, no lost ammo', () => {
    const r = rig('coach_gun', 0, 5);
    r.wc.update(DT, {...idle, reload: true}, r.inv);
    run(r.wc, r.inv, R.start + R.each + 0.05); // first shell in, second under way
    expect(r.stack.mag).toBe(1);
    expect(r.inv.count('ammo_12ga')).toBe(4);
    r.wc.equip({uid: uid++, itemId: 'pistol', count: 1, mag: 15} as never); // switch away mid-load
    expect(r.wc.actionOpen).toBe(0);
    r.wc.equip(r.stack as never);
    run(r.wc, r.inv, 1);
    expect(r.wc.reloading).toBe(false);
    expect(r.stack.mag).toBe(1);
    expect(r.inv.count('ammo_12ga')).toBe(4);
    const ev = run(r.wc, r.inv, 2, i => ({pressed: i % 20 === 0, held: i % 20 === 0}));
    expect(count(ev, 'fire')).toBe(1); // the one shell that went in, then dry -> auto reload
  });

  it('fuzz: over 20 000 random frames the rounds are conserved (loaded + reserve + fired), 0 <= loaded <= 2, no fire while open', () => {
    let seed = 1234567;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
    const r = rig('coach_gun', 2, 24);
    const start = total(r);
    let fired = 0;
    const other = {uid: uid++, itemId: 'pistol', count: 1, mag: 15};
    let held = false;
    for (let i = 0; i < 20000; i++) {
      const x = rnd();
      if (x < 0.002) { r.wc.equip(other as never); r.wc.equip(r.stack as never); }
      const pressed = x > 0.97;
      held = pressed || (held && x > 0.1);
      const openBefore = r.wc.reloading;
      const ev = r.wc.update(DT, {...idle, pressed, held, reload: x > 0.5 && x < 0.505, lowered: x > 0.6 && x < 0.62}, r.inv);
      const f = count(ev, 'fire');
      if (f) expect(openBefore, `frame ${i}`).toBe(false);
      fired += f;
      expect(r.stack.mag).toBeGreaterThanOrEqual(0);
      expect(r.stack.mag).toBeLessThanOrEqual(2);
      expect(total(r) + fired).toBe(start);
    }
    expect(fired).toBeGreaterThan(10);
    expect(reserveFor(WEAPONS.coach_gun, r.inv)).toBe(r.inv.count('ammo_12ga'));
  });

  it('the handling multiplier (gloves / arm injury) scales the whole break reload like the shell reload', () => {
    const slow = rig('coach_gun', 0, 5);
    slow.wc.handling = 1.25;
    slow.wc.update(DT, {...idle, reload: true}, slow.inv);
    run(slow.wc, slow.inv, (R.start + 2 * R.each + R.end) + 0.05);
    expect(slow.wc.reloading).toBe(true);
    run(slow.wc, slow.inv, 0.5);
    expect(slow.wc.reloading).toBe(false);
    expect(slow.stack.mag).toBe(2);
  });
});

// ------------------------------------------------------------------------------------------------------------------------------
/** A synthetic held gun in the cook convention (metres, +Y up, muzzle -Z; Grip / Muzzle / Sight / Eject markers; optional parts). */
function gunModel(o: {length: number; magazine?: boolean; barrels?: boolean; hinge?: boolean; scope?: boolean}): {scene: THREE.Group} {
  const scene = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.08, o.length), mat);
  body.name = 'body';
  scene.add(body);
  const marker = (name: string, x: number, y: number, z: number) => { const m = new THREE.Object3D(); m.name = name; m.position.set(x, y, z); scene.add(m); };
  marker('Grip', 0, -0.06, 0.1);
  marker('Muzzle', 0, 0.02, -o.length / 2);
  marker('Sight', 0, o.scope ? 0.07 : 0.05, o.scope ? 0.12 : 0.15);
  marker('Eject', 0.02, 0.03, 0);
  if (o.magazine) {
    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.12, 0.04), mat);
    mag.name = 'Magazine';
    mag.position.set(0, -0.1, -0.05);
    scene.add(mag);
  }
  if (o.barrels) {
    const g = new THREE.BoxGeometry(0.06, 0.04, o.length * 0.6);
    g.translate(0, 0, -o.length * 0.3); // the barrels' origin at their breech end
    const bar = new THREE.Mesh(g, mat);
    bar.name = 'Barrels';
    bar.position.set(0, 0.03, 0.02);
    scene.add(bar);
    if (o.hinge) marker('Hinge', 0, 0.005, 0.02);
  }
  if (o.scope) {
    const g = new THREE.CylinderGeometry(0.02, 0.02, 0.3, 24);
    g.rotateX(Math.PI / 2); // along Z: rear face at z = +0.15
    const sc = new THREE.Mesh(g, mat);
    sc.name = 'scope';
    sc.position.set(0, 0.07, 0);
    scene.add(sc);
  }
  scene.updateMatrixWorld(true);
  return {scene};
}
const viewState = (o: Partial<import('../src/weapons/viewmodel').ViewState> = {}) => ({moving: 0, sprint: false, aiming: false, lookDX: 0, lookDY: 0, reloading: false, reloadProgress: 0, using: false, useProgress: 0, bobT: 0, ...o});
const heldRoot = (vm: InstanceType<typeof Viewmodel>) => vm.warmRoots().find(r => r.visible && r.type === 'Group' && r.parent?.parent === vm.camera)!;

describe('reload part hooks (weapons/gunParts.ts) and the viewmodel', () => {
  it('magazine pose over a reload: seated -> pulled out -> gone -> the new one rises and seats by 62 %', () => {
    expect(magazinePartPose(null)).toEqual({out: 0, visible: true});
    expect(magazinePartPose(0.05)).toEqual({out: 0, visible: true});
    expect(magazinePartPose(0.2).out).toBeGreaterThan(0.3);
    expect(magazinePartPose(0.2).visible).toBe(true);
    expect(magazinePartPose(0.3 - 1e-9).out).toBeCloseTo(1, 6);
    expect(magazinePartPose(0.35)).toEqual({out: 1, visible: false});
    expect(magazinePartPose(0.5).visible).toBe(true);
    expect(magazinePartPose(0.5).out).toBeGreaterThan(0.3);
    expect(magazinePartPose(MAG_PART.in[1])).toEqual({out: 0, visible: true});
    expect(magazinePartPose(1)).toEqual({out: 0, visible: true});
    expect(barrelsAngle(0)).toBe(-0);
    expect(barrelsAngle(1)).toBeCloseTo(-BREAK_ANGLE, 12);
    expect(barrelsAngle(2)).toBeCloseTo(-BREAK_ANGLE, 12);
  });

  it('GunParts binds Magazine / Barrels (+ Hinge) and none on a model without them (the baseline guns: no parts)', () => {
    expect(GunParts.find(gunModel({length: 0.9}).scene)).toBeNull();
    const p = GunParts.find(gunModel({length: 0.6, magazine: true}).scene)!;
    expect(p.magazine).toBeTruthy();
    expect(p.barrels).toBeNull();
    const b = GunParts.find(gunModel({length: 0.95, barrels: true, hinge: true}).scene)!;
    expect(b.barrels).toBeTruthy();
    expect(b.magazine).toBeNull();
    // the baseline GLBs carry no part nodes (node names read from the GLB JSON chunk)
    for (const f of ['rifle-user.glb', 'shotgun-user.glb', 'pistol.glb', 'knife-user.glb']) {
      const names = glbJson(f).nodes.map((n: {name?: string}) => n.name);
      expect(names.filter((n: string) => ['Magazine', 'Barrels', 'Hinge'].includes(n)), f).toEqual([]);
    }
  });

  it('Viewmodel.addModel: a late model for any WEAPONS id; shown at once when it is the item asked for; replaces an earlier one; warm roots', () => {
    const vm = new Viewmodel({} as never, {});
    expect(vm.addModel('no_such_weapon', gunModel({length: 0.5}))).toBe(false);
    vm.setItem('hornet'); // asked for before the model arrived: nothing to hold yet
    expect(vm.heldItem).toBeNull();
    const roots0 = vm.warmRoots().length;
    expect(vm.addModel('hornet', gunModel({length: 0.62, magazine: true}))).toBe(true);
    expect(vm.heldItem).toBe('hornet');
    expect(vm.hasItem('hornet')).toBe(true);
    expect(vm.warmRoots().length).toBe(roots0 + 1);
    expect(vm.addModel('hornet', gunModel({length: 0.62, magazine: true}))).toBe(true); // replaced, still one holder
    expect(vm.warmRoots().length).toBe(roots0 + 1);
    expect(vm.heldItem).toBe('hornet');
    // not the wanted item: registered hidden
    vm.addModel('stub', gunModel({length: 0.7, magazine: true}));
    expect(vm.heldItem).toBe('hornet');
    vm.setItem('stub');
    expect(vm.heldItem).toBe('stub');
    // the hip pose comes from the def; ADS puts the Sight marker on the camera axis sightRelief ahead (+ sightLift)
    for (let i = 0; i < 40; i++) vm.update(0.05, viewState());
    const pivot = vm.camera.children.find(c => c.type === 'Group')!;
    pivot.position.toArray().forEach((v, k) => expect(v).toBeCloseTo(WEAPONS.stub.view.hip[k], 9));
  });

  it('a magazine reload moves the Magazine node out (down) and back; it is hidden while away, seated + visible after', () => {
    const vm = new Viewmodel({} as never, {});
    vm.addModel('stub', gunModel({length: 0.7, magazine: true}));
    vm.setItem('stub');
    const mag = heldRoot(vm).getObjectByName('Magazine')!;
    vm.update(0.016, viewState());
    const rest = mag.position.clone();
    vm.update(0.016, viewState({reloading: true, reloadProgress: 0.22}));
    expect(mag.position.y).toBeLessThan(rest.y - 0.05);
    expect(mag.visible).toBe(true);
    vm.update(0.016, viewState({reloading: true, reloadProgress: 0.36}));
    expect(mag.visible).toBe(false);
    vm.update(0.016, viewState({reloading: true, reloadProgress: 0.5}));
    expect(mag.visible).toBe(true);
    expect(mag.position.y).toBeLessThan(rest.y);
    vm.update(0.016, viewState({reloading: true, reloadProgress: 0.7}));
    expect(mag.position.distanceTo(rest)).toBeLessThan(1e-12);
    vm.update(0.016, viewState()); // reload cancelled / done: seated
    expect(mag.position.distanceTo(rest)).toBeLessThan(1e-12);
    expect(mag.visible).toBe(true);
  });

  it('a break action turns the Barrels about the Hinge: the hinge point stays put, the muzzle end drops; closed again after', () => {
    for (const hinge of [true, false]) {
      const vm = new Viewmodel({} as never, {});
      vm.addModel('coach_gun', gunModel({length: 0.95, barrels: true, hinge}));
      vm.setItem('coach_gun');
      const bar = heldRoot(vm).getObjectByName('Barrels')!;
      vm.update(0.016, viewState());
      const restQ = bar.quaternion.clone(), restP = bar.position.clone();
      const atParent = (local: THREE.Vector3) => local.clone().applyQuaternion(bar.quaternion).add(bar.position);
      const hingeLocal = new THREE.Vector3(0, hinge ? 0.005 - 0.03 : -0.02, 0); // the hinge (marker / rear-bottom fallback) in the barrels' frame
      const muzzleLocal = new THREE.Vector3(0, 0, -0.95 * 0.6);
      const h0 = atParent(hingeLocal), m0 = atParent(muzzleLocal);
      vm.update(0.016, viewState({reloading: true, reloadProgress: 0, actionOpen: 1}));
      const h1 = atParent(hingeLocal), m1 = atParent(muzzleLocal);
      expect(h1.distanceTo(h0), `hinge ${hinge}`).toBeLessThan(1e-6); // (float32 bounds for the fallback hinge)
      expect(m1.y).toBeLessThan(m0.y - 0.95 * 0.6 * Math.sin(BREAK_ANGLE) * 0.95);
      expect(bar.quaternion.angleTo(restQ)).toBeCloseTo(BREAK_ANGLE, 6);
      vm.update(0.016, viewState());
      expect(bar.quaternion.angleTo(restQ)).toBeLessThan(1e-9);
      expect(bar.position.distanceTo(restP)).toBeLessThan(1e-12);
    }
  });

  it('the game feeds the hooks: ViewState.actionOpen = WeaponController.actionOpen, magazine parts from reloadProgress', () => {
    const g = src('src/game.ts');
    expect(g).toMatch(/actionOpen: this\.weapon\.actionOpen,/);
    expect(g).toMatch(/reloading: this\.weapon\.reloading, reloadProgress: this\.weapon\.progress/);
  });
});

// ------------------------------------------------------------------------------------------------------------------------------
describe('the Overwatch scope: a runtime lens on the Sight axis, magnified aim', () => {
  it('sightApertureSpec: x / y on the Sight marker, z just behind the scope\'s rear-most surface around the axis', () => {
    const m = gunModel({length: 1.05, scope: true}).scene;
    const a = RifleOptic.sightApertureSpec(m, 0.016)!;
    expect(a.x).toBeCloseTo(0, 9);
    expect(a.y).toBeCloseTo(0.07, 9);
    expect(a.z).toBeCloseTo(0.15 + APERTURE_GAP, 6);
    expect(a.radius).toBe(0.016);
    const none = new THREE.Group();
    expect(RifleOptic.sightApertureSpec(none, 0.016)).toBeNull();
    // a Sight marker placed OVER the scope (not on its axis): no scope body around it -> no lens (the Sight ADS fallback)
    m.getObjectByName('Sight')!.position.y = 0.13;
    expect(RifleOptic.sightApertureSpec(m, 0.016)).toBeNull();
    expect(RifleOptic.attach(m, WEAPONS.overwatch.view.optic!)).toBeNull();
  });

  it('held in the viewmodel: the lens attaches, full ADS puts the eye on its axis eyeRelief behind it (crosshair hides); hip = dark lens', () => {
    const vm = new Viewmodel({} as never, {});
    vm.addModel('overwatch', gunModel({length: 1.05, scope: true, magazine: true}));
    vm.setItem('overwatch');
    expect(vm.heldOptic).not.toBeNull();
    for (let i = 0; i < 40; i++) vm.update(0.05, viewState());
    expect(vm.opticAim).toBeLessThan(0.05);
    for (let i = 0; i < 60; i++) vm.update(0.05, viewState({aiming: true}));
    expect(vm.opticAim).toBeGreaterThan(0.6); // game.ts hides the HUD crosshair above 0.6; the lens draws the reticle
    const eye = vm.heldOptic!.eye;
    expect(Math.hypot(eye.x, eye.y)).toBeLessThan(0.002);
    expect(eye.z).toBeCloseTo(WEAPONS.overwatch.view.optic!.eyeRelief, 3);
    expect(WEAPONS.overwatch.aimFov).toBe(30); // the main camera's magnification while aiming (game.ts updateCamera)
    // other guns without a scope: no lens
    vm.addModel('thresher', gunModel({length: 1.0, magazine: true}));
    vm.setItem('thresher');
    expect(vm.heldOptic).toBeNull();
  });
});

// ------------------------------------------------------------------------------------------------------------------------------
function glbJson(file: string) {
  const b = fs.readFileSync(path.join(GAME, 'public/assets/models', file));
  return JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)).toString());
}

describe('held-pose rules (HOLD_RULES) re-measured on the baseline user guns; derived hips once the cooked models land', () => {
  it('the long-gun / handgun rules reproduce the rifle / shotgun / pistol hip poses within 3 cm', () => {
    for (const [file, id, kind] of [['rifle-user.glb', 'rifle', 'long'], ['shotgun-user.glb', 'shotgun', 'long'], ['pistol.glb', 'pistol', 'handgun']] as const) {
      const j = glbJson(file);
      const node = (n: string) => j.nodes.find((x: {name: string}) => x.name === n);
      const G = node('Grip').translation as number[], S = node('Sight').translation as number[];
      const meshNode = j.nodes.find((x: {mesh?: number}) => x.mesh !== undefined);
      const acc = j.accessors[j.meshes[meshNode.mesh].primitives[0].attributes.POSITION];
      const mtx = new THREE.Matrix4().compose(new THREE.Vector3(...(meshNode.translation ?? [0, 0, 0])), new THREE.Quaternion(...(meshNode.rotation ?? [0, 0, 0, 1])), new THREE.Vector3(...(meshNode.scale ?? [1, 1, 1])));
      const box = new THREE.Box3(new THREE.Vector3(...acc.min), new THREE.Vector3(...acc.max)).applyMatrix4(mtx);
      const hip = WEAPONS[id].view.hip;
      if (kind === 'long') {
        const r = HOLD_RULES.long;
        expect(Math.abs(r.sightY - (S[1] - G[1]) - hip[1]), `${id} y`).toBeLessThan(0.03);
        expect(Math.abs(r.buttZ - (box.max.z - G[2]) - hip[2]), `${id} z`).toBeLessThan(0.03);
        expect(Math.abs(r.x - hip[0]), `${id} x`).toBeLessThan(0.03);
      } else {
        const r = HOLD_RULES.handgun;
        expect(Math.abs(r.sightY - (S[1] - G[1]) - hip[1]), `${id} y`).toBeLessThan(0.03);
        expect(r.gripZ).toBe(hip[2]);
        expect(r.x).toBe(hip[0]);
      }
    }
  });

  it('derivedHip: from a registry entry\'s markers / bounds by the rules; the fallback without one', () => {
    const entry = {id: 'G03', itemId: 'stub' as const, kind: 'gun' as const, url: 'x', length: 0.7, tris: 1, parts: ['Magazine'],
      bounds: {min: [-0.03, -0.15, -0.35] as [number, number, number], max: [0.03, 0.12, 0.35] as [number, number, number]},
      markers: {Grip: [0, -0.05, -0.02], Muzzle: [0, 0.03, -0.35], Sight: [0, 0.09, 0.05]} as Record<string, [number, number, number]>};
    const long = derivedHip(entry, 'long', [1, 2, 3]);
    expect(long[0]).toBe(HOLD_RULES.long.x);
    expect(long[1]).toBeCloseTo(HOLD_RULES.long.sightY - 0.14, 12);
    expect(long[2]).toBeCloseTo(HOLD_RULES.long.buttZ - 0.37, 12);
    const hand = derivedHip(entry, 'handgun', [1, 2, 3]);
    expect(hand).toEqual([HOLD_RULES.handgun.x, HOLD_RULES.handgun.sightY - 0.14, HOLD_RULES.handgun.gripZ]);
    expect(derivedHip(undefined, 'long', [1, 2, 3])).toEqual([1, 2, 3]);
    expect(derivedHip({...entry, markers: {Grip: [0, 0, 0]}}, 'long', [1, 2, 3])).toEqual([1, 2, 3]); // no Sight: fallback
    // each gun's def follows its delivered entry (the cook lane's registry), else keeps its fallback
    for (const id of VARIETY_GUN_IDS) {
      const m = WEAPON_VARIETY_MODELS[id];
      if (!m) continue;
      const kind = id === 'longslide' ? 'handgun' : 'long';
      const hip = WEAPONS[id].view.hip;
      expect(hip[1], id).toBeCloseTo(HOLD_RULES[kind].sightY - (m.markers.Sight[1] - m.markers.Grip[1]), 12);
      if (kind === 'long') expect(hip[2], id).toBeCloseTo(HOLD_RULES.long.buttZ - (m.bounds.max[2] - m.markers.Grip[2]), 12);
    }
  });
});

describe('casings and wiring', () => {
  it('ejection ports: brass for the 9mm / 5.56 guns, the thresher\'s hull at once (no pump stroke), none for the break action', () => {
    for (const id of ['hornet', 'longslide', 'stub', 'overwatch']) expect(EJECTION_PORTS[id]?.kind, id).toBe('rifle');
    expect(EJECTION_PORTS.thresher).toMatchObject({kind: 'shell', delay: 0});
    expect(EJECTION_PORTS.coach_gun).toBeUndefined();
    expect(EJECTION_PORTS.shotgun.delay).toBeUndefined(); // the pump keeps SHELL_EJECT_DELAY
    expect(SHELL_EJECT_DELAY).toBe(0.46);
  });

  it('game.ts: the controller gets the ADS state, fire() uses the per-gun recoil / bloom maths, the gun\'s cue set / timing / cycle', () => {
    const g = src('src/game.ts');
    expect(g).toMatch(/aiming: this\.aiming, lowered: p\.sprinting [^\n]*, clears: inp\.clears\}, this\.inv\)/);
    expect(g).toMatch(/const kick = shotRecoil\(def, kickMul, this\.weapon\.streak, this\.rand\);/);
    expect(g).toMatch(/this\.player\.pitch = Math\.min\(1\.45, this\.player\.pitch \+ kick\.view\);/);
    expect(g).toMatch(/this\.bloom = shotBloom\(def, this\.bloom\);/);
    expect(g).toMatch(/this\.bloom = Math\.max\(0, this\.bloom - dt \* bloomDecay\(wdef\)\);/);
    expect(g).toMatch(/baseSpread\(def, this\.aiming, this\.weapon\.def === def \? this\.weapon\.settleSpread : 0\)/);
    expect(g).toMatch(/this\.sfx\.shot\(def\.sound, def\.shotCycle\);/);
    expect(g).toMatch(/this\.sfx\.reloadStart\(e\.def\.reloadCue \?\? e\.def\.sound, e\.empty, reloadCueTime\(e\.def, e\.empty\)\)/);
    // the old inline recoil / bloom lines are gone (one source of truth)
    expect(g).not.toMatch(/this\.recoilPitch \+= def\.recoil\.pitch \* kickMul/);
    expect(g).not.toMatch(/Math\.min\(0\.03, this\.bloom \+ 0\.0035\)/);
  });
});

describe('weapon variety: scoped mouse look (lead integration)', () => {
  it('the Overwatch scope turns at the rifle aim\'s on-screen rate (0.65 x aimFov / 52); no other gun sets aimLook (the shared 0.65 stays)', () => {
    const ow = WEAPONS.overwatch;
    expect(ow.aimLook).toBeCloseTo(0.65 * ow.aimFov / 52, 12);
    expect(ow.aimLook!).toBeLessThan(0.65);
    for (const [id, d] of Object.entries(WEAPONS)) if (id !== 'overwatch') expect(d.aimLook, id).toBeUndefined();
  });
});
