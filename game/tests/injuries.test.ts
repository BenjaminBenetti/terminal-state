// Iteration 16 (lane INJURY): limb injuries — triggers (seeded hit / landing sampling, bounds, no death spiral), modifiers
// (exact, from base, no stacking), the aim sway (bounded, smooth, zero when healthy, ADS), treatment (right limb only, refusal,
// exactly-once consumption, bandages / med kits never cure), snapshot / restore, and the loot frequency of the treatments.
import {describe, expect, it} from 'vitest';
import {mulberry32} from '../src/core/rng';
import {GRAVITY, JUMP_HEIGHT} from '../src/player/player';
import {BASE_MODIFIERS, combineModifiers, type ModifierSource} from '../src/player/modifiers';
import {meleeHitLocation, type ResolvedHit} from '../src/player/hits';
import {
  AimSway, INJURY, InjurySystem, biteHitLocation, hitInjuryChance, injuryStatusHtml, injuryStatusText, injuryToast, installInjuries,
  landingInjuryChance, type InjuryHost, type InjurySnapshot,
} from '../src/player/injuries';
import {ITEMS, effectText, itemDef, useLabel} from '../src/items/items';
import {ARM_SLING, LEG_SPLINT, LIMB_TREATMENT_IDS, MEDICAL_DIMS, MEDICAL_ITEMS, TRAUMA_KIT} from '../src/items/medical';
import {Inventory} from '../src/items/inventory';
import {HP_MED, LIMB_ECONOMY, econCat} from '../src/items/lootEconomy';
import {holderFinds, isContainerKind, isLootHolderKind, type HolderKind} from '../src/items/loot';
import {ICONS} from '../src/ui/icons';
import {openableActive} from '../src/world/openablesSpec';
import {ECONOMY_CORPUS, stationEconomy} from './helpers/lootEconomy';
import {generateStation, type StationLayout} from '../src/gen/station';

const hit = (o: Partial<ResolvedHit>): ResolvedHit => ({amount: 15, applied: 15, absorbed: 0, source: 'zombie', location: 'arm', ...o});
/** A system whose every roll is `v` (0 = always injures, 0.999 = never). */
const fixed = (v: number) => new InjurySystem(() => v);

describe('triggers: hits', () => {
  it('chance scales with the HP damage taken, bounded, limbs only, never for absorbed hits', () => {
    expect(hitInjuryChance(hit({applied: 15}))).toBeCloseTo(0.33, 6); // the 25-40 % band for a 15-damage hit
    expect(hitInjuryChance(hit({applied: 10, location: 'leg'}))).toBeCloseTo(0.22, 6);
    expect(hitInjuryChance(hit({applied: 100}))).toBe(INJURY.hitChanceMax);
    expect(hitInjuryChance(hit({location: 'torso'}))).toBe(0);
    expect(hitInjuryChance(hit({location: 'head'}))).toBe(0);
    expect(hitInjuryChance(hit({applied: 0, absorbed: 15}))).toBe(0); // fully absorbed
    expect(hitInjuryChance(hit({applied: 0.5}))).toBe(0);
    // rat / dog bite on a leg tears more; on an arm it does not
    expect(hitInjuryChance(hit({applied: 7, location: 'leg', source: 'creature'}))).toBeCloseTo(7 * 0.022 * 1.4, 6);
    expect(hitInjuryChance(hit({applied: 7, location: 'arm', source: 'creature'}))).toBeCloseTo(7 * 0.022, 6);
  });

  it('seeded sampling matches the chance (fresh system per trial), and the limb / cause / side are recorded', () => {
    const r = mulberry32(1601);
    const n = 6000;
    let arm = 0, leg = 0;
    for (let i = 0; i < n; i++) {
      const s = new InjurySystem(r);
      if (s.onHit(hit({applied: 15, location: 'arm'})) === 'arm') arm++;
      const t = new InjurySystem(r);
      if (t.onHit(hit({applied: 7, location: 'leg', source: 'creature'})) === 'leg') { leg++; expect(t.limbs.leg?.cause).toBe('bite'); }
    }
    expect(arm / n).toBeGreaterThan(0.33 - 0.025); expect(arm / n).toBeLessThan(0.33 + 0.025);
    expect(leg / n).toBeGreaterThan(0.2156 - 0.025); expect(leg / n).toBeLessThan(0.2156 + 0.025);
    const s = fixed(0);
    expect(s.onHit(hit({}))).toBe('arm');
    expect(s.limbs.arm).toEqual({side: 'left', cause: 'hit'});
    expect(fixed(0.7).onHit(hit({applied: 100}))).toBeNull(); // 0.7 >= 0.45 cap
  });

  it('real hit locations: ~13 % of 15-damage zombie swipes and ~9 % of 10-damage ones injure a limb; bites go low', () => {
    const r = mulberry32(77);
    const rate = (dmg: number, n = 8000) => {
      let k = 0;
      for (let i = 0; i < n; i++) if (new InjurySystem(r).onHit(hit({applied: dmg, location: meleeHitLocation(r())}))) k++;
      return k / n;
    };
    expect(rate(15)).toBeGreaterThan(0.4 * 0.33 - 0.02); expect(rate(15)).toBeLessThan(0.4 * 0.33 + 0.02);
    expect(rate(10)).toBeGreaterThan(0.4 * 0.22 - 0.02); expect(rate(10)).toBeLessThan(0.4 * 0.22 + 0.02);
    const loc = {leg: 0, arm: 0, head: 0, torso: 0};
    const crouch = {leg: 0, arm: 0, head: 0, torso: 0};
    for (let i = 0; i < 10000; i++) { loc[biteHitLocation(r())]++; crouch[biteHitLocation(r(), true)]++; }
    expect(loc.leg / 1e4).toBeGreaterThan(0.55); expect(loc.leg / 1e4).toBeLessThan(0.61);
    expect(crouch.leg).toBeLessThan(loc.leg);
    expect(crouch.head).toBeGreaterThan(loc.head);
  });

  it('no death spiral: no stacking on an injured limb, at most arm + leg, a 20 s cooldown after every injury', () => {
    const s = fixed(0);
    expect(s.onHit(hit({location: 'arm'}))).toBe('arm');
    const v = s.version;
    expect(s.onHit(hit({location: 'leg'}))).toBeNull(); // cooldown
    s.tick(INJURY.cooldown - 0.1);
    expect(s.onHit(hit({location: 'leg'}))).toBeNull();
    expect(s.onLanding(20)).toBeNull();
    s.tick(0.2);
    expect(s.onHit(hit({location: 'arm'}))).toBeNull(); // already injured: nothing changes
    expect(s.version).toBe(v);
    expect(s.onHit(hit({location: 'leg'}))).toBe('leg');
    s.tick(60);
    for (const location of ['arm', 'leg', 'torso', 'head'] as const) expect(s.onHit(hit({location, applied: 100}))).toBeNull();
    expect(s.onLanding(30)).toBeNull();
    expect([s.injured('arm'), s.injured('leg')]).toEqual([true, true]);
  });
});

describe('triggers: hard landings', () => {
  it('routine drops are safe; risk from 8.5 m/s (≈ 2.1 m) rising to 85 % at 13 m/s', () => {
    const v = (h: number) => Math.sqrt(2 * GRAVITY * h);
    expect(landingInjuryChance(v(JUMP_HEIGHT))).toBe(0); // a jump
    expect(landingInjuryChance(v(1.15 + JUMP_HEIGHT))).toBe(0); // jumping off the platform into the track bed
    expect(landingInjuryChance(0.8)).toBe(0); // ladder climb end
    expect(landingInjuryChance(8.5)).toBeCloseTo(0.2, 6);
    expect(landingInjuryChance(13)).toBeCloseTo(0.85, 6);
    expect(landingInjuryChance(40)).toBeCloseTo(0.85, 6);
    expect(landingInjuryChance(v(4.5))).toBeGreaterThan(0.6); // a full storey
    const r = mulberry32(9);
    let k = 0;
    for (let i = 0; i < 6000; i++) if (new InjurySystem(r).onLanding(10.75) === 'leg') k++;
    expect(k / 6000).toBeGreaterThan(0.525 - 0.025); expect(k / 6000).toBeLessThan(0.525 + 0.025);
    const s = fixed(0);
    expect(s.onLanding(12)).toBe('leg');
    expect(s.limbs.leg?.cause).toBe('fall');
    expect(s.limbs.arm).toBeNull(); // landings only hurt legs
  });
});

describe('effects: modifiers from base, no stacking', () => {
  it('healthy -> base; leg 0.7 speed; arm 1.25 spread, 1.3 handling, 0.009 rad sway; exact every frame; treatment -> base', () => {
    const s = fixed(0);
    const gear: ModifierSource = () => ({speedMult: 1.05, spreadMult: 0.92, handlingMult: 0.92});
    expect(combineModifiers([s.source])).toEqual({...BASE_MODIFIERS});
    s.onLanding(12);
    for (let i = 0; i < 50; i++) expect(combineModifiers([s.source]).speedMult).toBe(0.7);
    s.tick(INJURY.cooldown);
    s.onHit(hit({}));
    const m = combineModifiers([s.source]);
    expect(m).toEqual({...BASE_MODIFIERS, speedMult: 0.7, spreadMult: 1.25, handlingMult: 1.3, swayAmp: 0.009, swayHz: 0.35});
    const g = combineModifiers([gear, s.source]);
    expect(g.speedMult).toBeCloseTo(0.735, 9); expect(g.spreadMult).toBeCloseTo(1.15, 9); expect(g.handlingMult).toBeCloseTo(1.196, 9);
    expect(combineModifiers([gear, s.source])).toEqual(g); // recomputed, never accumulated
    s.completeTreatment(itemDef(TRAUMA_KIT), () => true);
    expect(combineModifiers([s.source])).toEqual({...BASE_MODIFIERS});
    expect(combineModifiers([gear, s.source]).speedMult).toBe(1.05);
  });
});

describe('aim sway', () => {
  const run = (sw: AimSway, secs: number, amp: number, o: {aiming?: boolean; crouched?: boolean} = {}, dt = 1 / 60) => {
    let maxYaw = 0, maxPitch = 0, maxRate = 0, prev = sw.yaw, prevP = sw.pitch;
    for (let t = 0; t < secs; t += dt) {
      const r = sw.update(dt, amp, INJURY.armSwayHz, o);
      maxYaw = Math.max(maxYaw, Math.abs(r.yaw)); maxPitch = Math.max(maxPitch, Math.abs(r.pitch));
      maxRate = Math.max(maxRate, Math.abs(r.yaw - prev) / dt, Math.abs(r.pitch - prevP) / dt);
      prev = r.yaw; prevP = r.pitch;
    }
    return {maxYaw, maxPitch, maxRate};
  };

  it('zero when healthy; bounded (yaw <= 0.009, pitch smaller), smooth, eases in; ADS steadier; capped whatever is asked', () => {
    const sw = new AimSway();
    expect(run(sw, 20, 0)).toEqual({maxYaw: 0, maxPitch: 0, maxRate: 0});
    const a = run(sw, 30, INJURY.armSwayAmp);
    expect(a.maxYaw).toBeLessThanOrEqual(INJURY.armSwayAmp + 1e-9);
    expect(a.maxYaw).toBeGreaterThan(0.006); // a visible ~0.4-0.5 degree side-to-side
    expect(a.maxPitch).toBeLessThan(a.maxYaw * 0.5);
    expect(a.maxRate).toBeLessThan(0.05); // rad/s: never jerky (eased in from 0)
    const ads = run(sw, 30, INJURY.armSwayAmp, {aiming: true});
    expect(ads.maxRate).toBeLessThan(0.05); // toggling ADS changes the amplitude smoothly
    const adsSteady = run(sw, 30, INJURY.armSwayAmp, {aiming: true});
    expect(adsSteady.maxYaw).toBeLessThanOrEqual(INJURY.armSwayAmp * INJURY.swayAds + 1e-9);
    expect(adsSteady.maxYaw).toBeGreaterThan(0.5 * INJURY.armSwayAmp);
    const big = run(new AimSway(), 30, 1);
    expect(big.maxYaw).toBeLessThanOrEqual(INJURY.swayCap + 1e-9);
    // eases out after treatment, and big frame steps (50 ms) stay smooth
    const out = run(sw, 6, 0, {}, 0.05);
    expect(out.maxRate).toBeLessThan(0.05);
    expect(Math.abs(sw.yaw)).toBeLessThan(0.0005);
    run(sw, 20, 0);
    expect(sw.amp).toBe(0);
    expect(sw.yaw).toBe(0);
  });

  it('installed: Game.aimOffset follows the COMBINED mods, zero when healthy, zero after reset; HUD + toasts + bite / landing', () => {
    const host = fakeHost();
    const sys = installInjuries(host, {aiming: () => false}, fixed(0));
    expect(host.modifierSources).toContain(sys.source);
    const frame = (secs = 1, dt = 1 / 60) => {
      for (let i = 0, n = Math.max(1, Math.round(secs / dt)); i < n; i++) { host.mods = combineModifiers(host.modifierSources); for (const f of host.frameHooks) f(dt); }
    };
    frame(5);
    expect(host.aimOffset).toEqual({yaw: 0, pitch: 0});
    expect(host.limbCalls.at(-1)).toEqual([null, null]);
    for (const f of host.hitListeners) f(hit({location: 'arm'}));
    expect(host.toasts.at(-1)).toEqual({text: injuryToast('arm', sys.limbs.arm!), warn: true});
    frame(10);
    expect(Math.abs(host.aimOffset.yaw)).toBeGreaterThan(0);
    expect(Math.abs(host.aimOffset.yaw)).toBeLessThanOrEqual(INJURY.armSwayAmp);
    expect(host.limbCalls.at(-1)).toEqual([{side: 'left', cause: 'hit'}, null]);
    // hard landing through the frame hook (after the cooldown): leg + hurt sound + toast
    frame(INJURY.cooldown);
    host.player.justLanded = true; host.player.landSpeed = 12;
    frame(1 / 60);
    host.player.justLanded = false;
    expect(sys.limbs.leg?.cause).toBe('fall');
    expect(host.hurts).toBe(1);
    expect(host.toasts.at(-1)!.text).toMatch(/^Bad landing — left leg injured/);
    // injured leg: sprints drain extra stamina
    host.player.sprinting = true; host.player.stamina = 100;
    frame(1, 0.1);
    expect(host.player.stamina).toBeCloseTo(100 - INJURY.legSprintDrain, 6);
    host.player.sprinting = false;
    // a dead player rolls nothing
    sys.reset();
    expect(host.aimOffset).toEqual({yaw: 0, pitch: 0});
    host.player.alive = false;
    for (const f of host.hitListeners) f(hit({location: 'leg', applied: 100}));
    expect(sys.any).toBe(false);
    frame(5);
    expect(host.aimOffset).toEqual({yaw: 0, pitch: 0});
  });
});

describe('treatment', () => {
  it('items: dedicated treatments only; bandage / med kit / food never treat; HP-free; wording; icons; dims', () => {
    expect(itemDef(LEG_SPLINT).treats).toEqual(['leg']);
    expect(itemDef(ARM_SLING).treats).toEqual(['arm']);
    expect(itemDef(TRAUMA_KIT).treats).toEqual(['arm', 'leg']);
    for (const id of LIMB_TREATMENT_IDS) {
      const d = itemDef(id);
      expect(d.kind).toBe('consumable');
      expect(d.heal ?? 0).toBe(0);
      expect(d.useTime!).toBeGreaterThanOrEqual(3.5); // exposure
      expect(ICONS[d.icon], id).toMatch(/^<svg/);
      expect(MEDICAL_DIMS[id]).toBeDefined();
      expect(econCat(id)).toBe('med');
    }
    for (const d of Object.values(ITEMS)) if (!LIMB_TREATMENT_IDS.includes(d.id as never)) expect(d.treats, d.id).toBeUndefined();
    expect(Object.keys(MEDICAL_ITEMS).sort()).toEqual([...LIMB_TREATMENT_IDS].sort());
    expect(effectText(itemDef(LEG_SPLINT))).toBe('treats a leg injury');
    expect(effectText(itemDef(TRAUMA_KIT))).toBe('treats arm and leg injuries');
    expect(useLabel(itemDef(ARM_SLING))).toBe('Applying arm sling…');
    expect(useLabel(itemDef('bandage'))).toBe('Using bandage…'); // unchanged
  });

  it('refusal without a matching injury; cures the right limb only; consumed exactly once; re-checked at completion', () => {
    const s = fixed(0);
    const inv = new Inventory();
    inv.add(inv.makeStack(LEG_SPLINT, 2));
    inv.add(inv.makeStack(ARM_SLING, 1));
    const ref = (id: string) => inv.find(inv.hotbar.concat(inv.pack).find(x => x?.itemId === id)!.uid)!;
    expect(s.refuseReason(itemDef(LEG_SPLINT))).toBe('No leg injury to treat');
    expect(s.refuseReason(itemDef(ARM_SLING))).toBe('No arm injury to treat');
    expect(s.refuseReason(itemDef(TRAUMA_KIT))).toBe('No arm or leg injury to treat');
    expect(s.refuseReason(itemDef('bandage'))).toBeNull(); // not a treatment: the HP check applies instead
    let calls = 0;
    const consume = (id: string) => () => { calls++; return inv.consumeAt(ref(id)); };
    expect(s.completeTreatment(itemDef(LEG_SPLINT), consume(LEG_SPLINT))).toEqual({ok: false, text: 'No leg injury to treat', cured: []});
    expect(calls).toBe(0);
    s.onHit(hit({location: 'arm'}));
    s.tick(INJURY.cooldown);
    s.onHit(hit({location: 'leg'}));
    expect(s.refuseReason(itemDef(LEG_SPLINT))).toBeNull();
    const r = s.completeTreatment(itemDef(LEG_SPLINT), consume(LEG_SPLINT));
    expect(r.ok).toBe(true);
    expect(r.cured).toEqual(['leg']);
    expect(r.text).toBe('Left leg splinted — walking and sprinting normally again');
    expect(calls).toBe(1);
    expect(inv.count(LEG_SPLINT)).toBe(1);
    expect(s.injured('arm')).toBe(true); // the arm is untouched
    // a second completion (no leg injury left): refused, nothing consumed
    expect(s.completeTreatment(itemDef(LEG_SPLINT), consume(LEG_SPLINT)).ok).toBe(false);
    expect(calls).toBe(1);
    expect(inv.count(LEG_SPLINT)).toBe(1);
    // the item vanished mid-use (dropped / moved): nothing cured
    expect(s.completeTreatment(itemDef(ARM_SLING), () => false)).toEqual({ok: false, text: '', cured: []});
    expect(s.injured('arm')).toBe(true);
    expect(s.completeTreatment(itemDef(ARM_SLING), consume(ARM_SLING)).cured).toEqual(['arm']);
    expect(inv.count(ARM_SLING)).toBe(0);
    expect(s.any).toBe(false);
    expect(inv.invariants()).toEqual([]);
  });

  it('a cancelled use (hit / sprint / menu) consumes nothing: only completion consumes; bandages and med kits never cure', () => {
    // Game.startUse checks refuseReason, a cancel just drops the use (game.ts cancelUse), completion calls completeTreatment.
    const s = fixed(0);
    s.onHit(hit({location: 'leg'}));
    const inv = new Inventory();
    inv.add(inv.makeStack(LEG_SPLINT, 1));
    inv.add(inv.makeStack('bandage', 2));
    inv.add(inv.makeStack('medkit', 1));
    const before = JSON.stringify([inv.hotbar, inv.pack]);
    expect(s.refuseReason(itemDef(LEG_SPLINT))).toBeNull(); // start
    // ... cancelled: completeTreatment is never called
    expect(JSON.stringify([inv.hotbar, inv.pack])).toBe(before);
    expect(s.injured('leg')).toBe(true);
    // HP items: not treatments — completeTreatment refuses to treat with them and never consumes them
    for (const id of ['bandage', 'medkit']) {
      let used = false;
      expect(s.completeTreatment(itemDef(id), () => (used = true))).toEqual({ok: false, text: '', cured: []});
      expect(used).toBe(false);
    }
    expect(s.injured('leg')).toBe(true);
    expect(s.healNote()).toBe(' · the leg still needs a splint');
    expect(inv.count('bandage')).toBe(2);
    // trauma kit: both at once
    s.tick(INJURY.cooldown);
    s.onHit(hit({location: 'arm'}));
    const k = s.completeTreatment(itemDef(TRAUMA_KIT), () => true);
    expect(k.cured).toEqual(['arm', 'leg']);
    expect(k.text).toBe('Left arm strapped up · Left leg splinted — moving and aiming normally again');
    expect(s.healNote()).toBe('');
  });

  it('hints and status text', () => {
    const s = fixed(0);
    expect(s.treatmentHint(itemDef(LEG_SPLINT))).toBe('No leg injury — keep it for later');
    expect(injuryStatusText(s)).toBe('Limbs OK — no arm or leg injuries');
    expect(injuryStatusHtml(s)).toBe('<span class="limbs" title="No arm or leg injuries">Limbs <b>OK</b></span>');
    s.onHit(hit({location: 'leg', source: 'creature'}));
    expect(s.treatmentHint(itemDef(TRAUMA_KIT))).toBe('Click to apply · treats your left leg');
    expect(injuryStatusText(s)).toBe('Left leg injured (limping, short sprints) — leg splint or trauma kit');
    expect(injuryStatusHtml(s)).toContain('class="limbs crit"');
    expect(injuryStatusHtml(s.snapshot())).toBe(injuryStatusHtml(s));
    expect(injuryToast('leg', s.limbs.leg!)).toBe('Bitten — left leg injured: limping, short sprints. Treat with a leg splint or trauma kit');
  });
});

describe('treatment models (Meshy A7 / A8 derivatives in the item frame)', () => {
  it('fitted into the item dims: grounded, centred, splint roll along X, sling packet lying flat print-up and readable', async () => {
    const THREE = await import('three');
    const {fitMedicalDerivative, MEDICAL_MODEL_ASSET} = await import('../src/world/medicalItems');
    const {OFFICE_ASSETS} = await import('../src/assets/officeAssets');
    /** A stand-in derivative: a box of the delivered dims (grounded, centred) + a marker on its front (-Z) face, near its top. */
    const fake = (x: number, y: number, z: number) => {
      const scene = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(x, y, z));
      body.position.y = y / 2;
      const front = new THREE.Object3D();
      front.name = 'front-marker';
      front.position.set(0, y * 0.9, -z / 2);
      scene.add(body, front);
      return {scene, front};
    };
    for (const id of [LEG_SPLINT, ARM_SLING]) {
      const asset = OFFICE_ASSETS[MEDICAL_MODEL_ASSET[id]];
      const [x, y, z] = asset.dims ?? (id === LEG_SPLINT ? [0.1539, 0.1846, 0.24] : [0.1604, 0.2, 0.0813]);
      const f = fake(x, y, z);
      const g = fitMedicalDerivative(f, id);
      g.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(g);
      const size = box.getSize(new THREE.Vector3());
      const d = MEDICAL_DIMS[id];
      expect(box.min.y).toBeCloseTo(0, 6);
      expect((box.min.x + box.max.x) / 2).toBeCloseTo(0, 6);
      expect((box.min.z + box.max.z) / 2).toBeCloseTo(0, 6);
      expect(size.y).toBeCloseTo(d.h, 3); // height exact
      expect(size.x).toBeLessThanOrEqual(d.w * 1.25 + 1e-6);
      expect(size.z).toBeLessThanOrEqual(d.d * 1.25 + 1e-6);
      expect(Math.abs(size.x / d.w - 1)).toBeLessThan(0.05); // the dims match the delivered proportions
      expect(Math.abs(size.z / d.d - 1)).toBeLessThan(0.05);
      const m = g.getObjectByName('front-marker')!.getWorldPosition(new THREE.Vector3()); // the fitted model holds a clone
      if (id === ARM_SLING) {
        expect(m.y).toBeCloseTo(size.y, 3); // the printed front faces up
        expect(m.z).toBeLessThan(0); // its top edge away from the viewer (+Z): readable from the front
      } else expect(size.x).toBeGreaterThan(size.z); // the roll's length along X
    }
  });
});

describe('persistence (lane RUN)', () => {
  it('snapshot / restore round trip (JSON-safe, deep), invalid input = healthy, reset = NewGame', () => {
    const s = fixed(0);
    s.onHit(hit({location: 'arm', source: 'creature'}));
    s.tick(3);
    const snap = s.snapshot();
    expect(snap).toEqual({v: 1, arm: {side: 'left', cause: 'bite'}, leg: null, cooldown: INJURY.cooldown - 3});
    const t = fixed(0.99);
    t.restore(JSON.parse(JSON.stringify(snap)) as InjurySnapshot);
    expect(t.snapshot()).toEqual(snap);
    expect(t.modifiers()).toEqual(s.modifiers());
    snap.arm!.side = 'right'; // a deep copy: the live state is untouched
    expect(s.limbs.arm!.side).toBe('left');
    expect(structuredClone(t.snapshot())).toEqual(t.snapshot());
    for (const bad of [null, undefined, {}, {v: 2, arm: {side: 'left', cause: 'hit'}}, {v: 1, arm: {side: 'up'}, leg: 7, cooldown: 'x'}] as unknown[]) {
      t.restore(bad as InjurySnapshot);
      expect(t.any).toBe(false);
      expect(t.cooldown).toBe(0);
    }
    t.restore({v: 1, arm: null, leg: {side: 'right', cause: 'weird'} as never, cooldown: 1e9});
    expect(t.limbs.leg).toEqual({side: 'right', cause: 'hit'});
    expect(t.cooldown).toBe(INJURY.cooldown);
    s.reset();
    expect(s.snapshot()).toEqual({v: 1, arm: null, leg: null, cooldown: 0});
  });
});

// ---------------------------------------------------------------------------------------
// Loot frequency

const ALL_MODELS = new Proxy({}, {get: () => ({}), has: () => true}) as Record<string, unknown>;
interface MedCount { bandage: number; medkit: number; leg_splint: number; arm_sling: number; trauma_kit: number }
const zero = (): MedCount => ({bandage: 0, medkit: 0, leg_splint: 0, arm_sling: 0, trauma_kit: 0});
function medCount(l: StationLayout): MedCount {
  const c = zero();
  for (const e of stationEconomy(l)) if (e.itemId in c) c[e.itemId as keyof MedCount] += e.count;
  return c;
}

describe('loot: treatments are findable, ≈ as common as med kits, rarer than bandages', () => {
  it('the conversion only touches HP-med finds and leaves every other find of every holder exactly as before', () => {
    const share = LIMB_ECONOMY.share as Record<string, number>, holder = LIMB_ECONOMY.holder as Record<string, number>;
    const saved = {...share}, savedHolder = {...holder};
    const layouts = [generateStation(ECONOMY_CORPUS[0].seed, {startWeapon: 'pistol'}), generateStation(ECONOMY_CORPUS[9].seed, {startWeapon: 'pistol'})];
    const finds = (l: StationLayout) => {
      const out: {itemId: string; count: number; source: string}[][] = [];
      let ci = 0, si = 0;
      const oi = new Map<string, number>();
      for (const p of l.props) {
        if (!isLootHolderKind(p.kind)) continue;
        const isC = isContainerKind(p.kind);
        let index: number;
        if (isC && openableActive(p.kind, ALL_MODELS)) { index = oi.get(p.kind) ?? 0; oi.set(p.kind, index + 1); } else index = isC ? ci++ : si++;
        const a = l.areas[p.area];
        out.push(holderFinds(l.seed, index, p.kind as HolderKind, p.purpose ?? a?.purpose ?? a?.type ?? 'default', true));
      }
      return out;
    };
    let converted = 0, med = 0;
    try {
      for (const l of layouts) {
        const now = finds(l);
        for (const k of Object.keys(share)) share[k] = 0;
        for (const k of Object.keys(holder)) holder[k] = 0;
        const before = finds(l);
        Object.assign(share, saved); Object.assign(holder, savedHolder);
        expect(now.length).toBe(before.length);
        now.forEach((h, i) => {
          expect(h.length).toBe(before[i].length);
          h.forEach((f, j) => {
            const b = before[i][j];
            if (HP_MED.has(b.itemId)) med++;
            if (f.itemId === b.itemId) { expect(f).toEqual(b); return; }
            expect(HP_MED.has(b.itemId)).toBe(true);
            expect(LIMB_TREATMENT_IDS).toContain(f.itemId as never);
            expect(f.count).toBe(1);
            converted++;
          });
        });
      }
    } finally {
      Object.assign(share, saved); Object.assign(holder, savedHolder);
    }
    for (const id of LIMB_TREATMENT_IDS) expect(econCat(id)).toBe('med');
    expect(converted).toBeGreaterThan(0);
    expect(converted / med).toBeGreaterThan(0.1); expect(converted / med).toBeLessThan(0.35);
  });

  it('Subway: measured per station over the fixed 18-station corpus (3 per family; deterministic)', () => {
    const per = zero();
    const picks = ECONOMY_CORPUS;
    for (const c of picks) {
      const m = medCount(generateStation(c.seed, {startWeapon: 'pistol'}));
      for (const k of Object.keys(per) as (keyof MedCount)[]) per[k] += m[k];
    }
    const n = picks.length;
    const f = (k: keyof MedCount) => per[k] / n;
    const treatments = f('leg_splint') + f('arm_sling') + f('trauma_kit');
    console.info(`[injury loot] Subway per station (n=${n}): bandage ${f('bandage').toFixed(2)} · medkit ${f('medkit').toFixed(2)} · leg splint ${f('leg_splint').toFixed(2)} · arm sling ${f('arm_sling').toFixed(2)} · trauma kit ${f('trauma_kit').toFixed(2)} · treatments ${treatments.toFixed(2)}`);
    // measured 2026-10-29: bandage 7.67 · medkit 1.61 · leg splint 1.06 · arm sling 1.11 · trauma kit 0.17 · treatments 2.33
    expect(treatments).toBeGreaterThan(1.5);
    expect(treatments).toBeLessThan(2.8);
    expect(treatments / f('medkit')).toBeGreaterThan(0.8); // ≈ med kits
    expect(treatments / f('medkit')).toBeLessThan(1.7);
    expect(f('bandage')).toBeGreaterThan(2.5 * treatments); // rarer than bandages
    expect(f('leg_splint') + f('trauma_kit')).toBeGreaterThan(0.75); // each limb has about one cure per station
    expect(f('arm_sling') + f('trauma_kit')).toBeGreaterThan(0.75);
    expect(f('trauma_kit')).toBeLessThan(0.5 * f('leg_splint')); // the rarer kit
    expect(f('trauma_kit')).toBeGreaterThan(0);
  });
});

// Opt-in measurement (INJURY_REPORT=1): the full 18-station Subway corpus + Office levels (every section of the level through the
// levels registry: WORLD-GEN's generator once it lands, RUN's placeholder before) — the numbers in lanes/injury.done.
describe.skipIf(process.env.INJURY_REPORT !== '1')('injury loot report', () => {
  it('per Subway station and per Office level', async () => {
    const sum = (ls: StationLayout[]) => { const c = zero(); for (const l of ls) { const m = medCount(l); for (const k of Object.keys(c) as (keyof MedCount)[]) c[k] += m[k]; } return c; };
    const fmt = (c: MedCount, n: number) => {
      const t = c.leg_splint + c.arm_sling + c.trauma_kit;
      return `bandage ${(c.bandage / n).toFixed(2)} · medkit ${(c.medkit / n).toFixed(2)} · leg splint ${(c.leg_splint / n).toFixed(2)} · arm sling ${(c.arm_sling / n).toFixed(2)} · trauma kit ${(c.trauma_kit / n).toFixed(2)} · TREATMENTS ${(t / n).toFixed(2)} (leg-capable ${((c.leg_splint + c.trauma_kit) / n).toFixed(2)}, arm-capable ${((c.arm_sling + c.trauma_kit) / n).toFixed(2)})`;
    };
    const subway = ECONOMY_CORPUS.map(c => generateStation(c.seed, {startWeapon: 'pistol'}));
    console.info(`[injury loot report] Subway per station (n=${subway.length}): ${fmt(sum(subway), subway.length)}`);
    // rolled finds (before placement) vs placed lots: an item too big for a holder's surfaces is not placed
    const rolled = zero();
    for (const l of subway) {
      let ci = 0, si = 0;
      const oi = new Map<string, number>();
      for (const p of l.props) {
        if (!isLootHolderKind(p.kind)) continue;
        const isC = isContainerKind(p.kind);
        let index: number;
        if (isC && openableActive(p.kind, ALL_MODELS)) { index = oi.get(p.kind) ?? 0; oi.set(p.kind, index + 1); } else index = isC ? ci++ : si++;
        const a = l.areas[p.area];
        for (const f of holderFinds(l.seed, index, p.kind as HolderKind, p.purpose ?? a?.purpose ?? a?.type ?? 'default', true)) if (f.itemId in rolled) rolled[f.itemId as keyof MedCount] += f.count;
      }
    }
    const placed = sum(subway);
    console.info(`[injury loot report] Subway placed / rolled (holders): ${(Object.keys(rolled) as (keyof MedCount)[]).map(k => `${k} ${placed[k] - (k === 'bandage' || k === 'medkit' ? subway.reduce((n, l) => n + l.pickups.filter(q => q.itemId === k).length, 0) : 0)}/${rolled[k]}`).join(' · ')}`);
    const {LEVELS} = await import('../src/levels/registry');
    // The registry's office generator (WORLD-GEN's generateOfficeSection)
    const gen = LEVELS.office.generate;
    const levels = Number(process.env.INJURY_OFFICE_LEVELS ?? 4);
    const office: StationLayout[] = [];
    let realSections = 0;
    for (let i = 0; i < levels; i++) {
      const levelSeed = (90001 + i * 7919) >>> 0;
      for (const section of LEVELS.office.sections(levelSeed)) {
        const l = gen(section, {levelSeed, startWeapon: 'pistol'});
        if ((l as {office?: unknown}).office) realSections++;
        office.push(l);
      }
    }
    console.info(`[injury loot report] Office per LEVEL (n=${levels} levels, ${office.length} sections, ${realSections ? `WORLD-GEN generator, ${realSections} real office sections` : 'RUN placeholder stations — not the real office'}): ${fmt(sum(office), levels)}`);
  });
});

// ---------------------------------------------------------------------------------------

interface FakeHost extends InjuryHost {
  toasts: {text: string; warn?: boolean}[];
  limbCalls: unknown[][];
  hurts: number;
  player: InjuryHost['player'] & {alive: boolean; justLanded: boolean; landSpeed: number; sprinting: boolean; stamina: number};
}
function fakeHost(): FakeHost {
  const h: FakeHost = {
    modifierSources: [], hitListeners: [], frameHooks: [], aimOffset: {yaw: 0, pitch: 0},
    player: {alive: true, justLanded: false, landSpeed: 0, sprinting: false, crouched: false, stamina: 100},
    mods: {...BASE_MODIFIERS},
    toasts: [], limbCalls: [], hurts: 0,
    hud: {toast: (text, warn) => { h.toasts.push({text, warn}); }, setLimbs: (arm, leg) => { h.limbCalls.push([arm, leg]); }},
    sfx: {hurt: () => { h.hurts++; }},
  };
  return h;
}
