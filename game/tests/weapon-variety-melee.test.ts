// Task studio-weapon-variety-production-20261109-224355-01 (lane MELEE): the six new melee weapons (fire axe, machete, sledgehammer,
// crowbar, slugger, track shovel) — the handling table against the UNCHANGED knife (each really different, none a flat upgrade), the
// slugger's charge (timing, scaling, every cancel path with no attack leak), the per-swing hit set (each target at most once, at most
// maxTargets, maxTargets 1 = the knife's resolveMelee exactly), occlusion (walls / props / slabs, nothing behind or beside the player),
// knockback by mass with the protected bosses resisting and no stun-lock, stamina, the key poses (tip on the crosshair at contact,
// no near-plane clipping, continuous) and a byte-for-byte knife snapshot. CPU only (no renderer, no browser).

import {describe, expect, it} from 'vitest';
import * as THREE from 'three';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {WEAPONS, WeaponController, meleeCadence, meleeChargeK, type TriggerInput, type WeaponDef, type WeaponEvent, type MeleeStage} from '../src/weapons/weapons';
import {KNIFE_RAYS, meleeDamage, meleeHitsToKill, meleeRayDirs, resolveMelee, resolveMeleeSweep, asMeleeSweep, type MeleeTarget} from '../src/combat/melee';
import {MELEE_KNOCK, MELEE_MASS, MELEE_PROTECTED, MELEE_WINDED, MeleeShoves, meleeHint, meleeHitDamage, meleeKillStrength, meleeKnockFor, meleeMassOf,
  meleePushDir, meleeShoveStep, meleeStaggerOpts, meleeStaminaCost, meleeSwing} from '../src/combat/meleeImpact';
import {KNIFE_POSES, MELEE_POSES, VARIETY_MELEE_AIMS, VARIETY_MELEE_LENGTHS, aimPose, meleePoseOffset, varietyTip, type MeleePoses} from '../src/weapons/meleeView';
import {VARIETY_MELEE_IDS, VARIETY_WEAPONS, type VarietyMeleeId} from '../src/weapons/varietyIds';
import {VARIETY_MELEE_DEFS} from '../src/weapons/varietyMelee';
import {WEAPON_VARIETY_MODELS} from '../src/assets/weaponVarietyModels.generated';
import {ZOMBIE_STATS, ZombieBrain, type BrainWorld} from '../src/ai/brain';
import {RATDOG_STATS} from '../src/ai/creatureActor';
import {STRAINER_STAGGER_MIN, StrainerBrain} from '../src/ai/strainer';
import {SirenBrain} from '../src/ai/siren';
import {ENEMY_ARCHETYPES} from '../src/ai/creatureArchetypes';
import {Inventory} from '../src/items/inventory';
import {Grid, FLOOR, SOLID, CELL} from '../src/gen/grid';
import {levelsOf} from '../src/gen/levels';
import {raycastWorld} from '../src/combat/hitscan';
import {moveCircle} from '../src/core/physics';
import {Player, STAMINA_REGEN_DELAY} from '../src/player/player';
import {levelFixture, FIX} from './helpers/levelFixture';

const GAME = fileURLToPath(new URL('..', import.meta.url));
const KNIFE = WEAPONS.knife;
const DT = 1 / 60;
const NONE: TriggerInput = {held: false, pressed: false, reload: false, lowered: false};
const IDS = [...VARIETY_MELEE_IDS];
const W = (id: VarietyMeleeId) => WEAPONS[id];

// ---------------------------------------------------------------------------------------------------------------------
describe('the knife is unchanged (byte-for-byte snapshot of its def, poses and every new helper on it)', () => {
  it('WeaponDef snapshot', () => {
    expect(JSON.stringify(KNIFE)).toBe(JSON.stringify({
      id: 'knife', itemId: 'knife', magazine: 0, auto: false, interval: 0.65,
      damage: 30, pellets: 1, spreadHip: 0, spreadAim: 0, spreadMove: 0,
      range: 1.125, falloffStart: 1.125, falloffMin: 1, headMult: 2, limbMult: 1, knockback: 0,
      reload: {kind: 'magazine', time: 0, emptyTime: 0},
      recoil: {pitch: 0, yaw: 0, kick: 0, recover: 8},
      equipTime: 0.3, aimFov: 75, moveMult: 1.0, noise: 5, sound: 'pistol',
      melee: {windup: 0.15, strike: 0.08, sweep: 0.16, recovery: 0.34, rays: [[0, 0], [0.09, 0], [-0.09, 0], [0, 0.07], [0, -0.07], [0.18, 0], [-0.18, 0]]},
      view: {model: 'knife', hip: [0.16, -0.19, -0.36], aim: [0.16, -0.19, -0.36], hipPitch: 0.915, hipYaw: 0.181, hipRoll: -0.753, length: 0.32},
    }));
    expect(KNIFE.melee!.rays).toBe(KNIFE_RAYS);
    expect(Object.keys(KNIFE.melee!).sort()).toEqual(['rays', 'recovery', 'strike', 'sweep', 'windup']); // none of the variety extensions
  });

  it('poses: MELEE_POSES.knife is KNIFE_POSES with its tuned numbers; a charge argument changes nothing for it', () => {
    expect(MELEE_POSES.knife).toBe(KNIFE_POSES);
    expect(JSON.stringify(KNIFE_POSES)).toBe(JSON.stringify({
      carry: {pos: [0.16, -0.19, -0.36], rot: [0.915, 0.181, -0.753]},
      raised: {pos: [0.30, -0.08, -0.33], rot: [1.976, 0.707, -1.044]},
      contact: {pos: [0.095, -0.14, -0.285], rot: [0.65, 0.51, -0.97]},
      through: {pos: [-0.03, -0.19, -0.34], rot: [0.425, 1.41, -1.27]},
    }));
    const m = KNIFE.melee!;
    for (const stage of ['windup', 'ready', 'swing', 'recover', null] as (MeleeStage | null)[]) {
      for (const t of [0, 0.03, 0.08, 0.12, 0.2, 0.34, 1.5]) expect(meleePoseOffset(stage, t, m, KNIFE_POSES, undefined, 1)).toEqual(meleePoseOffset(stage, t, m));
    }
  });

  it('impact helpers on the knife: x1 damage, no push / stagger / stamina / hint; its kill impulse stays 38', () => {
    expect(meleeSwing(KNIFE.melee!, 0, false)).toEqual({damageMult: 1, knockback: 0, stagger: 0});
    expect(meleeSwing(KNIFE.melee!, 1, false)).toEqual({damageMult: 1, knockback: 0, stagger: 0}); // no charge spec: a hold adds nothing
    expect(meleeStaminaCost(KNIFE.melee!, 1)).toBe(0);
    expect(meleeHint(KNIFE, true, 1)).toBeNull(); // Game keeps its 'Release to slash' lines
    for (const part of ['head', 'torso', 'limb'] as const) expect(meleeHitDamage(KNIFE, part, meleeSwing(KNIFE.melee!), 0)).toBe(meleeDamage(KNIFE, part));
    expect(meleeStaggerOpts(0)).toEqual({stagger: false});
    expect(meleeKillStrength(38, 0)).toBe(38);
    const p = new Player();
    p.stamina = 40;
    expect(p.spendStamina(meleeStaminaCost(KNIFE.melee!))).toBe(true);
    expect(p.stamina).toBe(40);
  });

  it('the knife controller emits no `charge` and never charges', () => {
    const r = rig(KNIFE);
    r.frame({pressed: true, held: true});
    r.secs(2, {held: true});
    expect(r.wc.chargeLevel).toBe(0);
    r.secs(1);
    const ev = r.log.filter(x => x.e.type === 'swing' || x.e.type === 'contact');
    expect(ev.length).toBe(2);
    for (const x of ev) expect('charge' in x.e).toBe(false);
    expect(r.wc.swingCharge).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
/** A controller with `def` equipped and ready, a 60 fps frame clock and an event log. */
function rig(def: WeaponDef) {
  const inv = new Inventory();
  const wc = new WeaponController();
  wc.equip({uid: 1, itemId: def.itemId, count: 1, mag: 0}, {[def.itemId]: def});
  wc.update(2, NONE, inv); // finish the equip
  expect(wc.phase).toBe('idle');
  let t = 0;
  const log: {t: number; e: WeaponEvent}[] = [];
  const frame = (i: Partial<TriggerInput> = {}) => { t += DT; const ev = wc.update(DT, {...NONE, ...i}, inv); for (const e of ev) log.push({t, e}); return ev; };
  const secs = (s: number, i: Partial<TriggerInput> = {}) => { for (let k = 0, n = Math.round(s / DT); k < n; k++) frame(i); };
  const types = () => log.map(x => x.e.type).filter(x => x !== 'equipped');
  return {wc, inv, frame, secs, log, types, now: () => t};
}

const handling = (d: WeaponDef) => {
  const m = d.melee!, hp = ZOMBIE_STATS.shambler.hp;
  return {cadence: meleeCadence(m), windup: m.windup, recovery: m.recovery, reach: d.range, body: meleeHitsToKill(d, 'torso', hp), head: meleeHitsToKill(d, 'head', hp),
    targets: m.maxTargets ?? 1, knock: m.knockback ?? 0, stagger: m.stagger ?? 0, stamina: m.stamina ?? 0};
};

describe('handling table vs the knife (windup 0.15 / swing 0.65 s, 30 body / 60 head = 4 / 2 hits, reach 1.125 m, one target)', () => {
  it('the six defs: ids / item ids / model keys = weapons/varietyIds.ts, melee only (no caliber / ammo / ADS), spread into WEAPONS after the baseline four', () => {
    expect(Object.keys(VARIETY_MELEE_DEFS)).toEqual(IDS);
    expect(Object.keys(WEAPONS).slice(0, 4)).toEqual(['rifle', 'shotgun', 'pistol', 'knife']);
    for (const id of IDS) {
      const d = W(id);
      expect(d).toBe(VARIETY_MELEE_DEFS[id]);
      expect([d.id, d.itemId, d.view.model]).toEqual([id, id, id]);
      expect(VARIETY_WEAPONS[id].family).toBe('knife');
      expect(d.melee, id).toBeTruthy();
      expect(d.caliber, id).toBeUndefined();
      expect([d.magazine, d.pellets, d.auto, d.knockback], id).toEqual([0, 1, false, 0]);
      expect(d.interval, id).toBeCloseTo(meleeCadence(d.melee!), 12); // the tap's swing-to-swing cadence
      expect(d.melee!.strike, id).toBeLessThan(d.melee!.sweep);
      expect(d.melee!.holdMax, id).toBeUndefined();
      expect(d.melee!.propHits, id).toBe(true);
      expect(d.view.length, id).toBe(WEAPON_VARIETY_MODELS[id]?.length ?? VARIETY_MELEE_LENGTHS[id]); // the cooked model's length once delivered
    }
  });

  it('the pinned table (shambler 100 hp hits-to-kill)', () => {
    const t = Object.fromEntries(['knife', ...IDS].map(id => [id, handling(WEAPONS[id])]));
    const r2 = (v: number) => Math.round(v * 100) / 100;
    expect(Object.fromEntries(Object.entries(t).map(([k, v]) => [k, {...v, cadence: r2(v.cadence)}]))).toEqual({
      knife: {cadence: 0.65, windup: 0.15, recovery: 0.34, reach: 1.125, body: 4, head: 2, targets: 1, knock: 0, stagger: 0, stamina: 0},
      fire_axe: {cadence: 1.33, windup: 0.45, recovery: 0.62, reach: 1.6, body: 2, head: 1, targets: 1, knock: 0.35, stagger: 0.35, stamina: 18},
      machete: {cadence: 0.6, windup: 0.12, recovery: 0.3, reach: 1.35, body: 5, head: 2, targets: 2, knock: 0, stagger: 0, stamina: 6},
      sledgehammer: {cadence: 1.77, windup: 0.6, recovery: 0.85, reach: 1.7, body: 2, head: 1, targets: 1, knock: 1.1, stagger: 0.7, stamina: 24},
      crowbar: {cadence: 0.87, windup: 0.25, recovery: 0.42, reach: 1.35, body: 3, head: 2, targets: 1, knock: 0.2, stagger: 0.25, stamina: 9},
      slugger: {cadence: 0.89, windup: 0.22, recovery: 0.45, reach: 1.45, body: 3, head: 2, targets: 1, knock: 1, stagger: 0, stamina: 10}, // (the def's base: a tap x0.8 = 4 body, full x1.9 = 2 body / 1 head; below)
      track_shovel: {cadence: 1.2, windup: 0.32, recovery: 0.62, reach: 2, body: 3, head: 2, targets: 2, knock: 0.6, stagger: 0.3, stamina: 14},
    });
  });

  it('fire axe: a long committed windup / slow recovery, ONE head or TWO body hits on a shambler, ~1.6 m reach, one target, a small push', () => {
    const a = W('fire_axe'), m = a.melee!;
    expect(m.windup).toBeGreaterThanOrEqual(3 * KNIFE.melee!.windup);
    expect(m.recovery).toBeGreaterThan(KNIFE.melee!.recovery);
    expect(meleeHitsToKill(a, 'head', 100)).toBe(1);
    expect(meleeHitsToKill(a, 'torso', 100)).toBe(2);
    expect(meleeHitsToKill(a, 'limb', 100)).toBe(2);
    expect(a.range).toBeGreaterThan(ZOMBIE_STATS.shambler.attackRange); // outreaches the shambler's swipe start (feet to feet)
    expect(m.maxTargets).toBe(1);
    expect(m.knockback).toBeGreaterThan(0);
    expect(m.knockback!).toBeLessThan(W('sledgehammer').melee!.knockback! / 2); // small
    expect(m.twoHanded).toBe(true);
    expect(m.stamina!).toBeGreaterThanOrEqual(15); // high
  });

  it('machete: fast (quicker than the knife), a WIDE arc striking up to two, no push / stagger — but weaker per body hit than the knife', () => {
    const d = W('machete'), m = d.melee!;
    expect(meleeCadence(m)).toBeLessThan(meleeCadence(KNIFE.melee!));
    expect(m.windup).toBeLessThan(KNIFE.melee!.windup);
    expect(d.range).toBeCloseTo(1.35, 9);
    expect(m.maxTargets).toBe(2);
    const yaws = m.rays.map(r => Math.abs(r[0]));
    expect(Math.max(...yaws)).toBeGreaterThanOrEqual(0.45); // ~2.7x the knife's +-0.18
    expect(Math.max(...yaws)).toBeGreaterThan(2.5 * Math.max(...KNIFE_RAYS.map(r => Math.abs(r[0]))));
    expect(m.knockback ?? 0).toBe(0);
    expect(m.stagger ?? 0).toBe(0);
    expect(meleeHitsToKill(d, 'torso', 100)).toBeGreaterThan(meleeHitsToKill(KNIFE, 'torso', 100));
  });

  it('sledgehammer: the slowest and heaviest — the longest windup / recovery, the strongest push and stagger, long reach', () => {
    const s = W('sledgehammer'), m = s.melee!;
    for (const id of IDS.filter(i => i !== 'sledgehammer')) {
      const o = W(id).melee!;
      expect(m.windup, id).toBeGreaterThan(o.windup);
      expect(m.recovery, id).toBeGreaterThan(o.recovery);
      expect(meleeCadence(m), id).toBeGreaterThan(meleeCadence(o));
      expect(m.knockback!, id).toBeGreaterThanOrEqual(meleeSwing(o, 1).knockback); // even a fully charged slugger
      expect(m.stagger!, id).toBeGreaterThan(meleeSwing(o, 1).stagger);
    }
    expect(s.range).toBeCloseTo(1.7, 9);
    expect(meleeDamage(s, 'torso')).toBeGreaterThan(Math.max(...IDS.filter(i => i !== 'sledgehammer').map(i => meleeDamage(W(i), 'torso'))));
  });

  it('crowbar: the balanced middle — every timing between the machete and the axe, a SHORT stagger, no prying / door utility', () => {
    const c = W('crowbar').melee!, mac = W('machete').melee!, axe = W('fire_axe').melee!;
    for (const k of ['windup', 'strike', 'sweep', 'recovery'] as const) { expect(c[k], k).toBeGreaterThan(mac[k]); expect(c[k], k).toBeLessThan(axe[k]); }
    expect(W('crowbar').range).toBeGreaterThan(KNIFE.range);
    expect(W('crowbar').range).toBeLessThan(W('fire_axe').range);
    expect(c.stagger!).toBeGreaterThan(0);
    expect(c.stagger!).toBeLessThan(0.35); // shorter than a gun hit's
    expect(c.maxTargets).toBe(1);
    // no utility: the openables / doors know no weapon (nothing there names a weapon-variety melee weapon or the held weapon)
    const src = (f: string) => fs.readFileSync(path.join(GAME, 'src', f), 'utf8');
    const files = fs.readdirSync(path.join(GAME, 'src/world')).filter(f => /^(openables|doors?)/i.test(f));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) expect(src(`world/${f}`), f).not.toMatch(/crowbar|track_shovel|fire_axe|sledgehammer|VARIETY_MELEE|weapon\.def|meleeDefOf/);
  });

  it('track shovel: the LONGEST reach, a wide flat sweep striking up to two, a shove, a slower committed recovery; no digging', () => {
    const d = W('track_shovel'), m = d.melee!;
    for (const id of IDS.filter(i => i !== 'track_shovel')) expect(d.range, id).toBeGreaterThan(W(id).range);
    expect(d.range).toBeCloseTo(2.0, 9);
    expect(m.maxTargets).toBe(2);
    expect(Math.max(...m.rays.map(r => Math.abs(r[0])))).toBeGreaterThanOrEqual(0.4);
    expect(m.knockback!).toBeGreaterThan(0.4);
    expect(m.recovery).toBeGreaterThan(1.5 * KNIFE.melee!.recovery);
    expect(Object.keys(m).some(k => /dig/i.test(k))).toBe(false);
  });

  it('really different and none a flat upgrade: no weapon (knife included) is matched or beaten in EVERY handling dimension by another', () => {
    // better = lower cadence / windup / body + head hits / stamina, higher reach / targets / push / stagger
    const v = (d: WeaponDef) => { const h = handling(d); const ch = meleeSwing(d.melee!, 1); return [-h.cadence, -h.windup, -h.body, -h.head, -h.stamina, h.reach, h.targets, ch.knockback, ch.stagger]; };
    const all = ['knife', ...IDS];
    for (const a of all) for (const b of all) {
      if (a === b) continue;
      const va = v(WEAPONS[a]), vb = v(WEAPONS[b]);
      const dominates = va.every((x, i) => x >= vb[i] - 1e-9) && va.some((x, i) => x > vb[i] + 1e-9);
      expect(dominates, `${a} dominates ${b}`).toBe(false);
    }
    // and each new weapon is WORSE than the knife somewhere besides stamina (cadence, commitment or body hits)
    for (const id of IDS) {
      const h = handling(W(id)), k = handling(KNIFE);
      expect(h.cadence > k.cadence || h.windup > k.windup || h.body > k.body, id).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('slugger CHARGE: hold the wound-up pose ~1 s; damage / push / stagger / stamina scale with it; clean cancels', () => {
  const S = W('slugger'), M = S.melee!, C = M.charge!;

  it('spec: ~1 s to full; a tap = a modest hit (x0.8: 4 body hits), full = x1.9 (2 body / 1 head) and a BIG push', () => {
    expect(C.time).toBeCloseTo(1.0, 9);
    const tap = meleeSwing(M, 0), full = meleeSwing(M, 1), half = meleeSwing(M, 0.5);
    expect(tap.damageMult).toBeCloseTo(0.8, 9);
    expect(full.damageMult).toBeCloseTo(1.9, 9);
    expect(half.damageMult).toBeCloseTo(1.35, 9);
    expect(meleeDamage(S, 'torso') * tap.damageMult).toBeLessThanOrEqual(KNIFE.damage); // a tap is no better than a knife hit
    expect(Math.ceil(100 / (meleeDamage(S, 'torso') * tap.damageMult))).toBe(4);
    expect(Math.ceil(100 / (meleeDamage(S, 'torso') * full.damageMult))).toBe(2);
    expect(Math.ceil(100 / (meleeDamage(S, 'head') * full.damageMult))).toBe(1);
    expect(tap.knockback).toBeLessThan(0.2);
    expect(full.knockback).toBeGreaterThanOrEqual(0.9);
    expect([tap.stagger, full.stagger]).toEqual([0, 0.5]);
    expect(meleeStaminaCost(M, 0)).toBeCloseTo(6, 9);
    expect(meleeStaminaCost(M, 1)).toBeCloseTo(16, 9);
    expect(meleeChargeK(C, 0.25)).toBeCloseTo(0.25, 9);
    expect(meleeChargeK(C, 5)).toBe(1);
  });

  it('timing: a tap releases with charge 0; holding past the windup builds the charge over 1 s (kept at 1 after); it rides the swing / contact', () => {
    for (const [hold, want] of [[0, 0], [0.5, 0.5], [1.0, 1], [3, 1]] as const) {
      const r = rig(S);
      if (hold === 0) r.frame({pressed: true});
      else { r.frame({pressed: true, held: true}); r.secs(M.windup + hold, {held: true}); expect(r.wc.chargeLevel).toBeCloseTo(want, 1); }
      r.frame({}); // release
      r.secs(1);
      const sw = r.log.find(x => x.e.type === 'swing')!.e as {charge?: number}, ct = r.log.find(x => x.e.type === 'contact')!.e as {charge?: number};
      expect(sw.charge, `hold ${hold}`).toBeCloseTo(want, 1);
      expect(ct.charge).toBe(sw.charge);
      expect(r.types()).toEqual(['windup', 'swing', 'contact']);
    }
  });

  it('live charge and pose input: chargeLevel / meleePose.charge rise while held, the swing keeps the release value, both 0 after', () => {
    const r = rig(S);
    r.frame({pressed: true, held: true});
    r.secs(M.windup, {held: true});
    const seen: number[] = [];
    for (let i = 0; i < 70; i++) { r.frame({held: true}); seen.push(r.wc.chargeLevel); expect(r.wc.meleePose.charge).toBe(r.wc.chargeLevel); }
    for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1]);
    expect(seen[29]).toBeGreaterThan(0.45);
    expect(seen[69]).toBe(1);
    r.frame({}); // release
    expect(r.wc.chargeLevel).toBe(0);
    expect(r.wc.meleePose).toMatchObject({stage: 'swing', charge: 1});
    r.secs(2);
    expect(r.wc.meleePose).toEqual({stage: null, t: 0, charge: 0});
    expect(r.wc.swingCharge).toBe(0);
  });

  it('HUD cue: the hint shows the charge in 10 % steps while held, FULL at 1; the other variety weapons say swing; the knife keeps its lines', () => {
    expect(meleeHint(S, false, 0)).toBe('Hold to charge · release to swing');
    expect(meleeHint(S, true, 0.47)).toBe('Charging 40 % · release');
    expect(meleeHint(S, true, 1)).toBe('FULL CHARGE · release');
    expect(meleeHint(W('fire_axe'), true, 0)).toBe('Release to swing');
    expect(meleeHint(W('machete'), false, 0)).toBe('Hold · release to swing');
    const game = fs.readFileSync(path.join(GAME, 'src/game.ts'), 'utf8');
    expect(game).toMatch(/hint = meleeHint\(wdef, this\.weapon\.winding, this\.weapon\.chargeLevel\) \?\? \(this\.weapon\.winding \? 'Release to slash' : 'Hold · release to slash'\)/);
  });

  /** Charge for 0.6 s, cancel through `cancel`, then release / wait (and a fresh press later): never a swing from the old hold. */
  function noLeak(cancel: (r: ReturnType<typeof rig>) => void, during: Partial<TriggerInput> = {}) {
    const r = rig(S);
    r.frame({pressed: true, held: true});
    r.secs(M.windup + 0.6, {held: true});
    expect(r.wc.chargeLevel).toBeGreaterThan(0.5);
    cancel(r);
    r.secs(0.4, {held: true, ...during});
    r.secs(1.5); // the button comes up: nothing
    expect(r.types()).toEqual(['windup']);
    expect(r.wc.swinging).toBe(false);
    expect(r.wc.chargeLevel).toBe(0);
    expect(r.wc.swingCharge).toBe(0);
    // a fresh press starts a NEW charge from zero (nothing carried over)
    r.frame({pressed: true});
    r.secs(2);
    const sw = r.log.filter(x => x.e.type === 'swing');
    expect(sw.length).toBe(1);
    expect((sw[0].e as {charge?: number}).charge).toBe(0);
  }

  it('menus / pause / inventory / death / teardown / travel (Game.setState -> cancelSwing)', () => noLeak(r => expect(r.wc.cancelSwing()).toBe(true)));
  it('pointer-lock / focus loss (Input.clears bumps): the wiped button is no release', () => noLeak(r => { r.frame({held: true, clears: 0}); r.frame({held: false, clears: 1}); }, {clears: 1}));
  it('weapon switch (equip): the charge never survives', () => noLeak(r => { r.wc.equip({uid: 2, itemId: 'knife', count: 1, mag: 0}, {knife: KNIFE}); r.wc.equip({uid: 1, itemId: 'slugger', count: 1, mag: 0}, {slugger: S}); r.wc.update(2, NONE, r.inv); }));
  it('item use / sprint / climbing / a lane owning the buttons — fuel pour, turnkey, cart grab, lockbox (lowered)', () => noLeak(r => r.frame({lowered: true, held: true}), {lowered: true}));
  it('the button latched away mid-charge (Game sends lowered: lmbLatch && winding)', () => noLeak(r => r.frame({held: false, lowered: true})));

  it('Game wiring: every one of those paths reaches the controller as before (cancelSwing on leaving play, lowered for lanes / use / latch, clears)', () => {
    const game = fs.readFileSync(path.join(GAME, 'src/game.ts'), 'utf8');
    expect(game).toMatch(/if \(s !== 'playing'\) \{[^\n]*this\.weapon\.cancelSwing\(\);[^\n]*this\.meleeShoves\.clear\(\);/);
    expect(game).toMatch(/lowered: p\.sprinting \|\| vmBusy \|\| p\.climbing \|\| \(!!wdef\.melee && \(laneOwns \|\| \(this\.lmbLatch && this\.weapon\.winding\)\)\), clears: inp\.clears\}/);
    for (const lane of ['world/fuelPort.ts', 'world/bunker/objective.ts', 'world/fuelCarts.ts']) {
      expect(fs.readFileSync(path.join(GAME, 'src', lane), 'utf8'), lane).toMatch(/inputOwners\?*\.push\(/); // fuel pour / turnkey hold / cart grab own the buttons
    }
    // the contact reads the committed swing's charge (never a live hold) and pays the stamina there
    const fn = game.slice(game.indexOf('  private meleeContact('), game.indexOf('  private meleeProps('));
    expect(fn).toMatch(/const charge = this\.weapon\.swingCharge;/);
    expect(fn).toMatch(/meleeSwing\(m, charge, !this\.player\.spendStamina\(meleeStaminaCost\(m, charge\)\)\)/);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
type Z = {name: string};
function zombieAt(name: string, x: number, z: number, y = 0): MeleeTarget<Z> {
  return {id: {name}, alive: true, x, y, z, volumes: [
    {part: 'head', a: {x, y: y + 1.65, z}, b: null, r: 0.12},
    {part: 'torso', a: {x, y: y + 0.95, z}, b: {x, y: y + 1.45, z}, r: 0.2},
    {part: 'limb', a: {x, y: y + 1.4, z: z + 0.25}, b: {x, y: y + 0.85, z: z + 0.3}, r: 0.06},
  ]};
}
function openGrid(solid: [number, number][] = []) {
  const g = new Grid(40, 40);
  for (let y = 1; y < 39; y++) for (let x = 1; x < 39; x++) g.cells[g.idx(x, y)] = FLOOR;
  for (const [x, y] of solid) g.cells[g.idx(x, y)] = SOLID;
  return g;
}
/** Ray directions of `rays` looking along (dx, dy, dz) from the eye. */
function dirsOf(rays: readonly (readonly [number, number])[], dx: number, dy: number, dz: number) {
  const l = Math.hypot(dx, dy, dz), f = {x: dx / l, y: dy / l, z: dz / l};
  const rl = Math.hypot(f.z, f.x) || 1, right = {x: -f.z / rl, y: 0, z: f.x / rl};
  const up = {x: right.y * f.z - right.z * f.y, y: right.z * f.x - right.x * f.z, z: right.x * f.y - right.y * f.x};
  return meleeRayDirs(f, right, up, rays);
}
const EYE = {x: 5, y: 1.62, z: 5};
const worldOf = (g: InstanceType<typeof Grid>, props: Parameters<typeof raycastWorld>[1] = []) =>
  (o: {x: number; y: number; z: number}, d: {x: number; y: number; z: number}, max: number) => raycastWorld(g, props, o, d, max, -1);

describe('the per-swing hit set: each target at most once, at most maxTargets, centre-most first', () => {
  const MAC = W('machete'), SHO = W('track_shovel');

  it('a machete sweep over three zombies side by side strikes TWO (the centre-most first), each exactly once although many rays reach them', () => {
    const g = openGrid();
    const ts = [zombieAt('left', 6.0, 4.65), zombieAt('mid', 6.0, 5.0), zombieAt('right', 6.0, 5.35)];
    const dirs = dirsOf(MAC.melee!.rays, 1, -0.35, 0);
    const s = resolveMeleeSweep(EYE, dirs, MAC.range, ts, worldOf(g), undefined, MAC.melee!.maxTargets);
    expect(s.hits.length).toBe(2);
    expect(s.hits[0].target.name).toBe('mid');
    expect(new Set(s.hits.map(h => h.target)).size).toBe(2);
    expect(s.contact).toBeNull();
    // more rays than that reach the three bodies, but the set never repeats one; an unlimited set strikes all three once
    const many = dirs.filter(d => resolveMelee(EYE, [d], MAC.range, ts, worldOf(g))?.kind === 'enemy').length;
    expect(many).toBeGreaterThan(3);
    const all = resolveMeleeSweep(EYE, dirs, MAC.range, ts, worldOf(g), undefined, 99);
    expect(all.hits.map(h => h.target.name).sort()).toEqual(['left', 'mid', 'right']);
  });

  it('a body shields the one behind it: two in a line are ONE hit even for a sweep (nothing passes through the first)', () => {
    const g = openGrid();
    const s = resolveMeleeSweep(EYE, dirsOf(SHO.melee!.rays, 1, -0.3, 0), SHO.range, [zombieAt('far', 6.5, 5), zombieAt('near', 5.9, 5)], worldOf(g), undefined, 2);
    expect(s.hits.map(h => h.target.name)).toEqual(['near']);
  });

  it('maxTargets 1 = the knife\'s resolveMelee EXACTLY (randomised scenes with walls, props, corpses, misses)', () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let n = 0; n < 300; n++) {
      const solid: [number, number][] = rnd() < 0.5 ? Array.from({length: 38}, (_, i) => [Math.floor((5.3 + rnd() * 1.5) / CELL), i + 1] as [number, number]) : [];
      const g = openGrid(solid);
      const ts = Array.from({length: 1 + Math.floor(rnd() * 4)}, (_, i) => ({...zombieAt(`z${i}`, 5 + (rnd() - 0.2) * 2.5, 5 + (rnd() - 0.5) * 2.5), alive: rnd() > 0.15}));
      const corpse = rnd() < 0.3 ? (_o: unknown, _d: unknown, maxT: number) => { const t = 0.4 + rnd() * 0.8; return t < maxT ? {t, tag: 'c'} : null; } : undefined;
      const rays = [KNIFE_RAYS, MAC.melee!.rays, SHO.melee!.rays][n % 3];
      const dirs = dirsOf(rays, Math.cos(rnd() * 6.28), (rnd() - 0.6) * 0.8, Math.sin(rnd() * 6.28));
      const reach = [1.125, 1.35, 2.0][n % 3];
      seed = (seed * 31 + n) % 2147483647; const s0 = seed;
      const one = resolveMelee(EYE, dirs, reach, ts, worldOf(g), corpse);
      seed = s0;
      const sw = resolveMeleeSweep(EYE, dirs, reach, ts, worldOf(g), corpse, 1);
      expect(sw, `scene ${n}`).toEqual(asMeleeSweep(one));
    }
  });

  it('Game: the knife resolves through resolveMelee (unchanged), a variety weapon through its hit set; each struck target takes the swing ONCE', () => {
    const game = fs.readFileSync(path.join(GAME, 'src/game.ts'), 'utf8');
    const fn = game.slice(game.indexOf('  private meleeContact('), game.indexOf('  private meleeProps('));
    expect(fn).toMatch(/const sweep = m\.maxTargets \? resolveMeleeSweep\(o, dirs, def\.range, targets, world, corpses, m\.maxTargets\) : asMeleeSweep\(resolveMelee\(o, dirs, def\.range, targets, world, corpses\)\);/);
    expect(fn).toMatch(/for \(const \[i, res\] of sweep\.hits\.entries\(\)\)/);
    expect((fn.match(/z\.brain\.damage\(/g) ?? []).length).toBe(1);
    expect((fn.match(/this\.marketCombat\.meleeHit\(/g) ?? []).length).toBe(1); // Market people are in the same set
    expect(fn).toMatch(/\.\.\.this\.marketCombat\.meleeTargets\(\)/);
    expect(fn).toMatch(/swing\.stagger > 0 \? meleeStaggerOpts\(swing\.stagger, arch\) : \{stagger: false\}/); // the knife's literal no-stagger
    expect(fn).not.toContain('bulletHit'); // never the window / lane bullet handlers
    expect(KNIFE.melee!.maxTargets).toBeUndefined();
    for (const id of IDS) expect(W(id).melee!.maxTargets, id).toBeGreaterThanOrEqual(1);
  });

  it('a sweep\'s second target takes the reduced hit; the first the full one', () => {
    const sw = meleeSwing(MAC.melee!);
    expect(meleeHitDamage(MAC, 'torso', sw, 0)).toBe(meleeDamage(MAC, 'torso'));
    expect(meleeHitDamage(MAC, 'torso', sw, 1)).toBeCloseTo(meleeDamage(MAC, 'torso') * MAC.melee!.secondaryMult!, 9);
    expect(MAC.melee!.secondaryMult!).toBeLessThan(1);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('occlusion: no hit through walls / props / slabs, nothing outside the forward fan', () => {
  it('every weapon\'s fan stays forward (|yaw| <= 0.6 rad, |pitch| <= 0.35 rad: inside the view), centre ray first', () => {
    for (const id of ['knife', ...IDS]) {
      const rays = WEAPONS[id].melee!.rays;
      expect(rays[0], id).toEqual([0, 0]);
      for (const [y, p] of rays) { expect(Math.abs(y), id).toBeLessThanOrEqual(0.6); expect(Math.abs(p), id).toBeLessThanOrEqual(0.35); }
    }
  });

  it('a target beside (90 deg) or behind the player is never struck, even by the widest sweep at the longest reach', () => {
    const g = openGrid();
    for (const id of IDS) {
      const d = W(id), dirs = dirsOf(d.melee!.rays, 1, -0.3, 0);
      for (const [x, z] of [[5, 5.8], [5, 4.2], [4.2, 5], [4.4, 5.6]]) {
        expect(resolveMeleeSweep(EYE, dirs, d.range, [zombieAt('x', x, z)], worldOf(g), undefined, 2).hits, `${id} ${x},${z}`).toEqual([]);
      }
    }
  });

  it('a wall between stops every ray (world contact, no enemy) — also for the 2 m shovel; a visible zombie beside it is still struck, the hidden one not', () => {
    const wallX = Math.floor(5.6 / CELL);
    const g = openGrid(Array.from({length: 5}, (_, i) => [wallX, Math.floor(4.2 / CELL) + i] as [number, number])); // a short wall segment ahead
    for (const id of IDS) {
      const d = W(id), dirs = dirsOf(d.melee!.rays, 1, -0.3, 0);
      const behind = resolveMeleeSweep(EYE, dirs, d.range, [zombieAt('behind', 6.4, 5)], worldOf(g), undefined, 2);
      expect(behind.hits, id).toEqual([]);
      expect(behind.contact?.kind, id).toBe('world');
    }
    // widest sweep: one zombie in the open at the side, one behind the wall straight ahead -> only the visible one
    const MAC = W('machete'), wide = dirsOf(MAC.melee!.rays, 1, -0.3, 0);
    const g2 = openGrid(Array.from({length: 2}, (_, i) => [Math.floor(5.6 / CELL), Math.floor(4.2 / CELL) + i] as [number, number])); // x 5.5-6.0, z 4.0-5.0
    const s = resolveMeleeSweep(EYE, wide, MAC.range, [zombieAt('hidden', 6.3, 4.5), zombieAt('open', 6.0, 5.6)], worldOf(g2), undefined, 2);
    expect(resolveMeleeSweep(EYE, wide, MAC.range, [zombieAt('hidden', 6.3, 4.5)], () => ({t: Infinity, kind: 'none'}), undefined, 2).hits.length).toBe(1); // control: the wall is what hides it
    expect(s.hits.map(h => h.target.name)).toEqual(['open']);
  });

  it('a prop box stops it (the bullets\' exact prop raycast)', () => {
    const g = openGrid();
    const crate = {kind: 'crate', x: 5.6, z: 5, y: 0, rot: 0, area: 0, hx: 0.25, hz: 1.2, h: 2.0, blocksSight: true, variant: 0} as Parameters<typeof raycastWorld>[1][number];
    const S = W('sledgehammer');
    const res = resolveMeleeSweep(EYE, dirsOf(S.melee!.rays, 1, -0.2, 0), S.range, [zombieAt('behind', 6.3, 5)], worldOf(g, [crate]), undefined, 1);
    expect(res.hits).toEqual([]);
    expect(res.contact).toMatchObject({kind: 'world', surface: 'prop'});
  });

  it('a slab between storeys stops the 2 m shovel straight down', () => {
    const fx = levelFixture(), L = levelsOf(fx);
    const x = 21, z = 6, eye = {x, y: FIX.upperY + 1.0, z};
    const below: MeleeTarget<Z> = {id: {name: 'below'}, alive: true, x, z, volumes: [{part: 'head', a: {x, y: FIX.underDeckCeil - 0.15, z}, b: null, r: 0.12}]};
    const down = [{x: 0, y: -1, z: 0}];
    const res = resolveMeleeSweep(eye, down, W('track_shovel').range, [below], (o, d, max) => raycastWorld(L, fx.props, o, d, max, fx.trench.floorY), undefined, 2);
    expect(res.hits).toEqual([]);
    expect(res.contact).toMatchObject({kind: 'world', surface: 'floor'});
    expect(resolveMeleeSweep(eye, down, W('track_shovel').range, [below], () => ({t: Infinity, kind: 'none'}), undefined, 2).hits.length).toBe(1); // control
  });
});

// ---------------------------------------------------------------------------------------------------------------------
const quietWorld = (): BrainWorld => ({px: 30, pz: 30, playerAlive: true, los: () => false, walkClear: () => true, findPath: () => [], randomNear: () => null, rand: () => 0.5});

describe('knockback by mass, protected bosses resist knockdown, stagger without stun-lock', () => {
  it('push scales with mass: shambler 1.1 m from the sledgehammer; coated / Blightbelly less; the rat / dog further but capped', () => {
    const k = W('sledgehammer').melee!.knockback!;
    expect(meleeKnockFor(k, 'zombie', 'shambler')).toBeCloseTo(1.1, 9);
    expect(meleeKnockFor(k, undefined, 'shambler')).toBeCloseTo(1.1, 9);
    expect(meleeKnockFor(k, 'zombie', 'coated')).toBeCloseTo(1.1 / MELEE_MASS.coated, 9);
    expect(meleeKnockFor(k, 'blightbelly')).toBeLessThan(0.6);
    expect(meleeKnockFor(k, 'ratdog')).toBe(MELEE_KNOCK.maxM);
    for (const a of ['zombie', 'blightbelly', 'ratdog', 'siren', 'strainer', 'screacher']) expect(meleeMassOf(a), a).toBeGreaterThan(0); // (+ the Screacher: task studio-screacher-production-20261110-221858-01)
    expect(Object.keys(ENEMY_ARCHETYPES).every(a => a in MELEE_MASS)).toBe(true); // every enemy family has a mass
    expect(meleeKnockFor(0, 'ratdog')).toBe(0);
  });

  it('the Strainer and the Siren are protected: a token push (<= 0.15 m even from a full charge / the sledgehammer) and never a longer stagger', () => {
    expect([...MELEE_PROTECTED].sort()).toEqual(['siren', 'strainer']);
    for (const boss of ['strainer', 'siren']) {
      for (const id of IDS) expect(meleeKnockFor(meleeSwing(W(id).melee!, 1).knockback, boss), `${boss} ${id}`).toBeLessThanOrEqual(0.15);
      expect(meleeStaggerOpts(0.7, boss)).toEqual({}); // their own rules
    }
    // the Strainer: a 70 sledgehammer hit staggers only under its own >= 45 rule and only for the ordinary 0.35 s
    const st = new StrainerBrain(0, 0, 0);
    expect(70).toBeGreaterThanOrEqual(STRAINER_STAGGER_MIN);
    st.damage(70, 1, 0, 0, meleeStaggerOpts(0.7, 'strainer'));
    expect(st.state).toBe('stagger');
    expect((st as unknown as {stateT: number}).stateT).toBeCloseTo(0.35, 9);
    const st2 = new StrainerBrain(0, 0, 0);
    st2.damage(38, 1, 0, 0, meleeStaggerOpts(0.25, 'strainer')); // a crowbar hit: below its threshold
    expect(st2.state).not.toBe('stagger');
    // a dormant Siren never staggers (she wakes); HP / AI untouched
    const si = new SirenBrain(0, 0, 0);
    si.damage(70, 1, 0, 0, meleeStaggerOpts(0.7, 'siren'));
    expect(si.state).not.toBe('stagger');
    expect(si.hp).toBe(si.stats.hp - 70);
  });

  it('stagger lengths go through the brain\'s own rules; every other hit is the ordinary 0.35 s / 0.9 s cooldown exactly as before', () => {
    const b = new ZombieBrain('shambler', 0, 0, 0, {...ZOMBIE_STATS.shambler, hp: 1e6});
    b.damage(70, 1, 0, 0, meleeStaggerOpts(0.7));
    expect(b.state).toBe('stagger');
    const priv = b as unknown as {stateT: number; staggerCd: number};
    expect([priv.stateT, priv.staggerCd]).toEqual([0.7, 1.25]);
    const g = new ZombieBrain('shambler', 0, 0, 0, {...ZOMBIE_STATS.shambler, hp: 1e6});
    g.damage(24, 1, 0, 0); // a gun hit: as ever
    expect([g.state, (g as unknown as {stateT: number}).stateT, (g as unknown as {staggerCd: number}).staggerCd]).toEqual(['stagger', 0.35, 0.9]);
    const k = new ZombieBrain('shambler', 0, 0, 0);
    k.damage(30, 1, 0, 0, {stagger: false}); // the knife
    expect(k.state).not.toBe('stagger');
  });

  it('no stun-lock: hammered every 0.3 s with 0.7 s staggers, a zombie is free >= 0.55 s between staggers and never staggered > 0.7 s at once', () => {
    const b = new ZombieBrain('shambler', 0, 0, 0, {...ZOMBIE_STATS.shambler, hp: 1e6});
    const w = quietWorld();
    let t = 0, nextHit = 0, run = 0, longest = 0, freeRun = 0, minFree = Infinity, wasStag = false, staggerT = 0;
    for (let i = 0; i < 20 * 60; i++) {
      if (t >= nextHit) { b.damage(70, 1, 0, 0, meleeStaggerOpts(0.7)); nextHit += 0.3; }
      const stag = b.state === 'stagger';
      if (stag) { run += DT; staggerT += DT; longest = Math.max(longest, run); if (!wasStag && freeRun > 0) minFree = Math.min(minFree, freeRun); freeRun = 0; } else { run = 0; freeRun += DT; }
      wasStag = stag;
      b.update(DT, w);
      t += DT;
    }
    expect(longest).toBeLessThanOrEqual(0.7 + 2 * DT);
    expect(minFree).toBeGreaterThanOrEqual(0.55 - 2 * DT);
    expect(staggerT / 20).toBeLessThan(0.6);
  });

  it('push direction: away from the player along the struck ray, a sweep adds its leftward share', () => {
    const [x, z] = meleePushDir({x: 0, z: -1}, {x: 1, z: 0}, 0);
    expect([x, z]).toEqual([0, -1]);
    const [sx, sz] = meleePushDir({x: 0, z: -1}, {x: 1, z: 0}, 0.35);
    expect(sx).toBeLessThan(0); // to the left of `right`
    expect(sz).toBeLessThan(0);
    expect(Math.hypot(sx, sz)).toBeCloseTo(1, 9);
  });

  it('shoves: the whole distance over 0.2 s in the open; a wall stops them (never through it); no footing (a ledge / outside) ends them; bounded', () => {
    const g = openGrid([[Math.floor(7 / CELL), Math.floor(5 / CELL)], [Math.floor(7 / CELL), Math.floor(5 / CELL) + 1], [Math.floor(7 / CELL), Math.floor(5 / CELL) - 1]]);
    const move = (r: number) => (x: number, z: number, dx: number, dz: number) => moveCircle(g, null, x, z, dx, dz, r, 0);
    const floor = (x: number, z: number) => { const [cx, cy] = g.cellOf(x, z); return g.inBounds(cx, cy) && g.passable(cx, cy) ? 0 : null; };
    const open = {x: 3, y: 0, z: 10, alive: true}, wall = {x: 6.2, y: 0, z: 5.2, alive: true};
    const sh = new MeleeShoves<object>();
    sh.add(open, 1, 0, 1.1);
    sh.add(wall, 1, 0, 1.4);
    for (let i = 0; i < 30; i++) sh.update(DT, (b, dx, dz) => meleeShoveStep(b as typeof open, dx, dz, move(0.33), floor));
    expect(open.x).toBeCloseTo(4.1, 3);
    expect(sh.size).toBe(0);
    expect(wall.x).toBeLessThan(7 - 0.33 + 1e-6); // pressed against the wall, never through it
    // a ledge: footing more than 0.35 m away ends the push at once
    const edge = {x: 3, y: 0, z: 3, alive: true};
    const sh2 = new MeleeShoves<object>();
    sh2.add(edge, 1, 0, 1);
    sh2.update(DT, (b, dx, dz) => meleeShoveStep(b as typeof edge, dx, dz, move(0.33), (x) => (x > 3.05 ? -1.2 : 0)));
    sh2.update(DT, (b, dx, dz) => meleeShoveStep(b as typeof edge, dx, dz, move(0.33), (x) => (x > 3.05 ? -1.2 : 0)));
    expect(edge.x).toBeLessThanOrEqual(3.05);
    expect(sh2.size).toBe(0);
    // dead / climbing bodies are never moved; at most MELEE_KNOCK.maxShoves at once; a new hit replaces the body's push
    expect(meleeShoveStep({x: 0, y: 0, z: 0, alive: false}, 1, 0, move(0.3), () => 0)).toBe(false);
    expect(meleeShoveStep({x: 0, y: 0, z: 0, alive: true, climbing: true}, 1, 0, move(0.3), () => 0)).toBe(false);
    const many = new MeleeShoves<object>();
    const bodies = Array.from({length: 20}, () => ({}));
    for (const b of bodies) many.add(b, 1, 0, 1);
    many.add(bodies[19], 0, 1, 0.5);
    expect(many.size).toBe(MELEE_KNOCK.maxShoves);
    expect(meleeKillStrength(38, 1.1)).toBeGreaterThan(38);
  });

  it('Game: the push is added only for a survivor, by mass; the shoves step with collision + footing and are cleared when play stops', () => {
    const game = fs.readFileSync(path.join(GAME, 'src/game.ts'), 'utf8');
    expect(game).toMatch(/const knock = meleeKnockFor\(swing\.knockback, arch, z\.brain\.type\);/);
    expect(game).toMatch(/\} else \{\s*enemyCues\(z\)\.hurt\(this\.sfx, z\);\s*if \(knock > 0\) \{ const \[px, pz\] = meleePushDir\(res\.dir, right, m\.knockSide\); this\.meleeShoves\.add\(z\.brain, px, pz, knock\); \}/);
    expect(game).toMatch(/moveCircle\(this\.levels, this\.propIndex, x, z, mx, mz, b\.stats\.radius, b\.y, b\.stats\.height \?\? BODY_CLEAR\)/);
    expect(game).toMatch(/this\.levels\.supportIn\(x, z, y \+ 0\.05, 0\.3\)\?\.floor/);
    expect(game).toMatch(/this\.stepMeleeShoves\(dt\);/);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('stamina: paid per swing, a short meter makes a winded swing', () => {
  it('Player.spendStamina drains the meter, restarts the regen pause, reports a short meter; 0 costs nothing', () => {
    const p = new Player();
    p.stamina = 50;
    expect(p.spendStamina(24)).toBe(true);
    expect(p.stamina).toBe(26);
    expect((p as unknown as {sprintCd: number}).sprintCd).toBe(STAMINA_REGEN_DELAY);
    expect(p.spendStamina(30)).toBe(false); // short: the meter empties, the swing is winded
    expect(p.stamina).toBe(0);
    expect(p.spendStamina(0)).toBe(true);
  });

  it('winded: x0.7 damage, x0.4 push, no stagger; costs: axe 18 / sledgehammer 24 / shovel 14 / crowbar 9 / machete 6 / slugger 6..16', () => {
    const w = meleeSwing(W('sledgehammer').melee!, 0, true);
    expect(w.damageMult).toBeCloseTo(MELEE_WINDED.damage, 9);
    expect(w.knockback).toBeCloseTo(1.1 * MELEE_WINDED.knockback, 9);
    expect(w.stagger).toBe(0);
    expect(IDS.map(id => meleeStaminaCost(W(id).melee!, 0))).toEqual([18, 6, 24, 9, 6, 14].map(v => expect.closeTo(v, 9)));
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('first-person key poses (aimed and solved for each model\'s length; three.js Euler XYZ through the 54 deg camera)', () => {
  const cam = new THREE.PerspectiveCamera(54, 16 / 9, 0.01, 20);
  cam.updateMatrixWorld(true);
  /** Model points (a stick from just behind the grip to the tip) through a pose offset, as Viewmodel.update applies it. */
  function view(id: VarietyMeleeId, stage: MeleeStage | null, t: number, charge = 0) {
    const poses = MELEE_POSES[id] as MeleePoses, c = poses.carry, off = meleePoseOffset(stage, t, W(id).melee!, poses, undefined, charge);
    const o = new THREE.Object3D();
    o.position.set(c.pos[0] + off.x, c.pos[1] + off.y, c.pos[2] + off.z);
    o.rotation.set(c.rot[0] + off.rx, c.rot[1] + off.ry, c.rot[2] + off.rz);
    o.updateMatrixWorld(true);
    const tipM = new THREE.Vector3(...varietyTip(id)), pts: THREE.Vector3[] = [];
    for (let k = -0.08; k <= 1.0001; k += 0.02) pts.push(tipM.clone().multiplyScalar(k).applyMatrix4(o.matrixWorld));
    const tip = tipM.clone().applyMatrix4(o.matrixWorld);
    const ndc = (p: THREE.Vector3) => p.clone().project(cam);
    const inView = (p: THREE.Vector3) => { const n = ndc(p); return -p.z > 0.01 && Math.abs(n.x) <= 1 && Math.abs(n.y) <= 1; };
    const on = pts.filter(inView).length / pts.length;
    /** Share of the shaft from `from` (x the tip distance, from the grip) to the tip that is in view (e.g. 0.4: the bat's barrel). */
    const part = (from: number) => { const q = pts.filter((_, i) => -0.08 + i * 0.02 >= from - 1e-9); return q.filter(inView).length / q.length; };
    return {tip: ndc(tip), grip: ndc(new THREE.Vector3().applyMatrix4(o.matrixWorld)), tipDepth: -tip.z, minDepth: Math.min(...pts.map(p => -p.z)), on, part};
  }
  /** NDC -> the QA renders' 960 x 540 pixels (lead QA, qa/fp metrics). */
  const px = (n: THREE.Vector3) => [(n.x + 1) / 2 * 960, (1 - n.y) / 2 * 540];

  it('aimPose: the tip lands on its aimed screen point at the model\'s real tip distance, its +Y toward `up`', () => {
    for (const id of IDS) {
      for (const k of ['carry', 'raised', 'contact', 'through'] as const) {
        const a = VARIETY_MELEE_AIMS[id][k], p = aimPose(a, varietyTip(id));
        const o = new THREE.Object3D();
        o.position.set(...p.pos); o.rotation.set(...p.rot); o.updateMatrixWorld(true);
        const tip = new THREE.Vector3(...varietyTip(id)).applyMatrix4(o.matrixWorld);
        expect(tip.distanceTo(new THREE.Vector3(...a.grip)), `${id} ${k}`).toBeCloseTo(Math.hypot(...varietyTip(id)), 6);
        const n = tip.clone().project(cam);
        expect(n.x, `${id} ${k}`).toBeCloseTo(a.tip[0], 3);
        expect(n.y, `${id} ${k}`).toBeCloseTo(a.tip[1], 3);
        const upW = new THREE.Vector3(0, 1, 0).transformDirection(o.matrixWorld);
        expect(upW.dot(new THREE.Vector3(...a.up).normalize()), `${id} ${k}`).toBeGreaterThan(0);
      }
    }
  });

  it('every swing puts the head ON the crosshair at contact, sweeps it on to the follow-through, and recovers exactly to the carry', () => {
    for (const id of IDS) {
      const m = W(id).melee!;
      const hit = view(id, 'swing', m.strike, m.charge ? 1 : 0);
      expect(Math.hypot(hit.tip.x, hit.tip.y), id).toBeLessThan(0.05);
      const through = view(id, 'swing', m.sweep - 1e-6);
      expect(Math.hypot(through.tip.x, through.tip.y), id).toBeGreaterThan(0.5);
      const carry = view(id, null, 0), end = view(id, 'recover', m.recovery);
      expect(end.tip.distanceTo(carry.tip), id).toBeLessThan(1e-6);
      expect(view(id, 'windup', m.windup).tip.distanceTo(view(id, 'ready', 0).tip), id).toBeLessThan(0.02);
    }
  });

  it('the overhead / mid wind-ups (axe, sledgehammer, crowbar) keep the head partly in view at the top edge (lead QA tweak)', () => {
    for (const id of ['fire_axe', 'sledgehammer', 'crowbar'] as const) {
      const r = view(id, 'ready', 0), c = view(id, null, 0);
      expect(r.part(0.75), id).toBeGreaterThan(0.5); // the outer quarter (the head) mostly in frame
      expect(r.tip.y, id).toBeGreaterThan(c.tip.y + 0.3); // still raised well above the carry
      expect(r.tip.y, id).toBeGreaterThan(0.8); // at the top edge: an overhead / high wind-up
    }
  });

  it('carry: the head in view upper right; the wound-up hold keeps part of the weapon in view; two-handed ones carry more centrally', () => {
    for (const id of IDS) {
      const c = view(id, null, 0), r = view(id, 'ready', 0);
      expect(c.tip.x, id).toBeGreaterThan(0.2);
      expect(c.tip.y, id).toBeGreaterThan(0.2);
      expect(Math.max(Math.abs(c.tip.x), Math.abs(c.tip.y)), id).toBeLessThan(1);
      expect(c.on, id).toBeGreaterThan(0.6);
      expect(r.on, id).toBeGreaterThan(0.1);
      expect(r.tip.x, id).toBeGreaterThan(c.tip.x); // drawn back to the right
      const grip = MELEE_POSES[id].carry.pos[0];
      if (W(id).melee!.twoHanded) expect(grip, id).toBeLessThan(KNIFE_POSES.carry.pos[0]);
    }
  });

  it('the slugger\'s FULL charge reads: pulled back and raised past the ready pose, the tip projecting ON SCREEN with the barrel in frame', () => {
    const r0 = view('slugger', 'ready', 0, 0), r1 = view('slugger', 'ready', 1, 1), half = view('slugger', 'ready', 0.5, 0.5);
    expect(MELEE_POSES.slugger.charged).toBeTruthy();
    // lead QA (2026-11-10, qa/fp SHEET-melee): the old full charge left only a 78 px strip at the right edge, tip at (970, -40) off screen.
    // Now: the tip inside the frame — in the lead's window x 820-900, y 20-80 px at 960 x 540 — and most of the barrel (the outer 60 %) on
    // screen, at ready and at full charge alike (the tremble included: t = 1 s)
    const [tx, ty] = px(r1.tip);
    expect(tx).toBeGreaterThanOrEqual(820);
    expect(tx).toBeLessThanOrEqual(900);
    expect(ty).toBeGreaterThanOrEqual(20);
    expect(ty).toBeLessThanOrEqual(80);
    expect(Math.abs(r1.tip.x)).toBeLessThan(1);
    expect(Math.abs(r1.tip.y)).toBeLessThan(1);
    expect(r1.part(0.4)).toBeGreaterThan(0.9);
    expect(r0.part(0.4)).toBeGreaterThan(0.9);
    for (let t = 0; t <= 2; t += DT) { const v = view('slugger', 'ready', t, Math.min(1, t)); expect(Math.max(Math.abs(v.tip.x), Math.abs(v.tip.y)), `t ${t.toFixed(2)}`).toBeLessThan(1); }
    // ... and it READS as the charge: the tip climbs up (and out to the right), the hands rise into view, drawn back toward the shoulder
    expect(r1.tip.y).toBeGreaterThan(r0.tip.y + 0.2);
    expect(r1.tip.x).toBeGreaterThan(r0.tip.x + 0.05);
    expect(r1.grip.y).toBeGreaterThan(r0.grip.y + 0.25);
    expect(MELEE_POSES.slugger.charged!.pos[2]).toBeGreaterThan(MELEE_POSES.slugger.raised.pos[2]); // nearer the shoulder
    expect(half.tip.y).toBeGreaterThan(r0.tip.y);
    expect(half.tip.y).toBeLessThan(r1.tip.y);
    expect(view('slugger', 'swing', 0, 1).tip.distanceTo(view('slugger', 'ready', 0, 1).tip)).toBeLessThan(0.03);
    expect(view('slugger', 'swing', 0, 0).tip.distanceTo(r0.tip)).toBeLessThan(0.03);
  });

  it('a whole cycle (windup, 1 s hold, swing, recovery): no near-plane clipping, no pops (sub-sampled), the recovery passes under the aim point', () => {
    for (const id of IDS) {
      const m = W(id).melee!, ch = m.charge ? 1 : 0;
      const seq: [MeleeStage | null, number, number][] = [[null, 0, 0]];
      for (let t = 0; t <= m.windup + 1e-9; t += DT) seq.push(['windup', t, 0]);
      for (let t = 0; t <= 1; t += DT) seq.push(['ready', t, m.charge ? Math.min(1, t / m.charge.time) : 0]);
      for (let t = 0; t < m.sweep; t += DT / 4) seq.push(['swing', t, ch]);
      for (let t = 0; t <= m.recovery + 1e-9; t += DT) seq.push(['recover', t, ch]);
      let prev = view(id, null, 0), minRec = Infinity;
      for (const [stage, t, c] of seq) {
        const v = view(id, stage, t, c), label = `${id} ${stage} ${t.toFixed(3)}`;
        expect(v.minDepth, label).toBeGreaterThan(0.15);
        expect(v.tip.distanceTo(prev.tip), label).toBeLessThan(stage === 'swing' ? 0.5 : 0.25);
        if (stage === 'recover' && t > 0.1 * m.recovery && t < 0.9 * m.recovery) minRec = Math.min(minRec, Math.hypot(v.tip.x, v.tip.y));
        prev = v;
      }
      expect(minRec, id).toBeGreaterThan(0.18); // (no head waved across the crosshair on the way back)
    }
  });

  it('poses follow the model: a delivered Tip marker / length re-solves them (scaled to length), the approved lengths until then', () => {
    expect(VARIETY_MELEE_LENGTHS).toEqual({fire_axe: 0.90, machete: 0.62, sledgehammer: 0.92, crowbar: 0.76, slugger: 0.84, track_shovel: 1.25});
    for (const id of IDS) {
      const mk = WEAPON_VARIETY_MODELS[id]?.markers, g = mk?.Grip ?? [0, 0, 0];
      if (mk?.Tip) expect(varietyTip(id), id).toEqual([mk.Tip[0] - g[0], mk.Tip[1] - g[1], mk.Tip[2] - g[2]]); // the delivered Tip, from the Grip
      else expect(varietyTip(id), id).toEqual([0, 0, -(WEAPON_VARIETY_MODELS[id]?.length ?? VARIETY_MELEE_LENGTHS[id])]);
    }
    // a longer model with the same aim lands its tip on the same screen point (farther out), the grip unchanged
    const a = VARIETY_MELEE_AIMS.fire_axe.contact;
    const p1 = aimPose(a, [0, 0, -0.9]), p2 = aimPose(a, [0, 0.05, -1.1]);
    expect(p2.pos).toEqual(p1.pos);
    expect(p2.rot).not.toEqual(p1.rot);
    const o = new THREE.Object3D(); o.rotation.set(...p2.rot); o.position.set(...p2.pos); o.updateMatrixWorld(true);
    const n = new THREE.Vector3(0, 0.05, -1.1).applyMatrix4(o.matrixWorld).project(cam);
    expect(Math.hypot(n.x, n.y)).toBeLessThan(1e-6);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('damage against the real enemies (stats unchanged)', () => {
  it('hits to kill per weapon: shambler / coated / rat-dog (body, head)', () => {
    const tab = Object.fromEntries(IDS.map(id => [id, [ZOMBIE_STATS.shambler.hp, ZOMBIE_STATS.coated.hp, RATDOG_STATS.hp].map(hp => [meleeHitsToKill(W(id), 'torso', hp), meleeHitsToKill(W(id), 'head', hp)])]));
    expect(tab).toEqual({
      fire_axe: [[2, 1], [3, 2], [1, 1]],
      machete: [[5, 2], [7, 4], [2, 1]],
      sledgehammer: [[2, 1], [3, 2], [1, 1]],
      crowbar: [[3, 2], [5, 3], [2, 1]],
      slugger: [[3, 2], [5, 3], [2, 1]], // (the def's base; the charge scales it x0.8 .. x1.9)
      track_shovel: [[3, 2], [5, 3], [2, 1]],
    });
    expect([ZOMBIE_STATS.shambler.hp, ZOMBIE_STATS.coated.hp, RATDOG_STATS.hp]).toEqual([100, 165, 44]);
  });
});
