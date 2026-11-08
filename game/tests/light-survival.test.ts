// Iteration 12 (LIGHT): flashlight battery (drain / linear flicker / dead / refill / refuse at full / pause), the body glow,
// light-source publishing, thrown flares (physics on the right storey, burn / fade / cap / cleanup, exactly one item per
// throw), the battery / flare items and their AUTHORED models. Deterministic (seeded rng, fixed dt), node only.

import * as THREE from 'three';
import {describe, expect, it} from 'vitest';
import {installCanvasShim} from './helpers/canvas2d';
import {mulberry32} from '../src/core/rng';
import {
  BATTERY, BEAM, BODY_GLOW, FLICKER, FlashlightBattery, MEAN_DIP, PlayerLight, applyBatteryItem, dipDuty, dipEnvelope, flickerAmount, meanGap,
} from '../src/player/flashlight';
import {LightSources} from '../src/world/lightSources';
import {FLARE, FlareSystem, flareEnvelope, throwOneFlare} from '../src/weapons/throwables';
import {PhysicsSystem} from '../src/physics/world';
import {levelsOf} from '../src/gen/levels';
import {FIX, levelFixture} from './helpers/levelFixture';
import {ITEMS, ITEM_DIMS, effectText, itemDef, throwHint, useHint} from '../src/items/items';
import {Inventory} from '../src/items/inventory';
import {ICONS} from '../src/ui/icons';
import {CONTROLS} from '../src/ui/hud';
import {BATTERY_DIMS, FLARE_DIMS, authoredItemModel, authoredSize, thrownFlareModel} from '../src/world/authoredItems';
import {itemModelSources, makeSupplyMesh} from '../src/world/pickups';
import {ConsumeView} from '../src/weapons/consumeView';

installCanvasShim(false);
{
  const ctx0 = (globalThis as unknown as {document: {createElement(t: string): {getContext(k: string): object}}}).document.createElement('canvas').getContext('2d');
  const proto = Object.getPrototypeOf(ctx0) as Record<string, unknown>;
  for (const k of ['clip', 'setLineDash', 'quadraticCurveTo', 'bezierCurveTo', 'ellipse']) if (typeof proto[k] !== 'function') proto[k] = () => {};
}

const DT = 1 / 60;

/** Simulates `seconds` of light-on time at a FIXED charge (no drain); returns the measured dimmed fraction etc. */
function flickerRun(charge: number, seconds: number, seed = 7) {
  const b = new FlashlightBattery(mulberry32(seed), 0);
  b.reset(charge);
  let off = 0, minOut = 1, transitions = 0, wasDip = false, frames = 0;
  for (let t = 0; t < seconds; t += DT) {
    b.update(DT);
    frames++;
    if (!b.emitting) off++;
    minOut = Math.min(minOut, b.output);
    if (b.dipping !== wasDip) { transitions++; wasDip = b.dipping; }
  }
  return {duty: b.stats.dipTime / Math.max(1e-9, b.stats.flickerTime), dips: b.stats.dips, offFrac: off / frames, minOut, perSecond: transitions / 2 / seconds, b};
}

describe('flashlight battery: drain, dead, refill, refuse at full, pause', () => {
  it('starts at 80 %, drains 1/420 per second only while on (a full battery = 7 min of light), freezes at dt 0', () => {
    const b = new FlashlightBattery(mulberry32(1));
    expect(BATTERY.start).toBe(0.8);
    expect(BATTERY.drainPerSec).toBeCloseTo(1 / BATTERY.fullSeconds, 12);
    expect(BATTERY.fullSeconds).toBe(420);
    expect(b.charge).toBe(0.8);
    expect(b.on).toBe(true);
    for (let i = 0; i < 60 * 60; i++) b.update(DT); // 60 s on
    expect(b.charge).toBeCloseTo(0.8 - 60 / 420, 6);
    const c = b.charge;
    expect(b.toggle()).toBe('off');
    for (let i = 0; i < 600; i++) b.update(DT); // 10 s off: no drain
    expect(b.charge).toBe(c);
    expect(b.output).toBe(0);
    b.toggle();
    for (let i = 0; i < 100; i++) b.update(0); // paused game: Game.update is not called; dt 0 changes nothing either
    expect(b.charge).toBe(c);
  });

  it('a full battery lasts 420 s of continuous light, then dies: off, F gives only "dead" until a battery is used', () => {
    const b = new FlashlightBattery(mulberry32(2));
    b.reset(1);
    const events: string[] = [];
    let t = 0;
    while (b.on && t < 1000) { events.push(...b.update(0.05)); t += 0.05; }
    expect(t).toBeGreaterThan(419.9);
    expect(t).toBeLessThan(420.2);
    expect(b.charge).toBe(0);
    expect(b.died).toBe(true);
    expect(b.output).toBe(0);
    expect(b.emitting).toBe(false);
    expect(events.filter(e => e === 'low')).toHaveLength(1);
    expect(events.filter(e => e === 'critical')).toHaveLength(1);
    expect(events.filter(e => e === 'died')).toHaveLength(1);
    expect(b.toggle()).toBe('dead');
    expect(b.on).toBe(false);
    b.update(1);
    expect(b.output).toBe(0);
    // a battery refills to 100 % and the dead light comes back on
    expect(b.refuseReason()).toBeNull();
    expect(b.refill(1)).toBe(true);
    expect(b.charge).toBe(1);
    expect(b.on).toBe(true);
    b.update(DT);
    expect(b.output).toBe(1);
  });

  it('refuses a battery at >= 99 % and accepts it below; a switched-off light stays off after a refill', () => {
    const b = new FlashlightBattery(mulberry32(3));
    b.reset(0.995);
    expect(b.refuseReason()).toMatch(/already full/);
    expect(b.refill()).toBe(false);
    b.reset(0.985);
    expect(b.refuseReason()).toBeNull();
    b.toggle(); // player switched it off
    expect(b.refill()).toBe(true);
    expect(b.on).toBe(false);
    expect(b.charge).toBe(1);
  });

  it('using battery items removes EXACTLY one per use and none when refused at full', () => {
    const inv = new Inventory();
    inv.add(inv.makeStack('battery', 3));
    const ref = inv.find(inv.hotbar.concat(inv.pack).find(s => s?.itemId === 'battery')!.uid)!;
    const b = new FlashlightBattery(mulberry32(4));
    b.reset(0.3);
    expect(applyBatteryItem(b, () => inv.consumeAt(ref))).toBeNull();
    expect(inv.count('battery')).toBe(2);
    expect(b.charge).toBe(1);
    // at full: refused, nothing consumed
    expect(applyBatteryItem(b, () => inv.consumeAt(ref))).toMatch(/already full/);
    expect(inv.count('battery')).toBe(2);
    // drain to 50 %, use again: one more
    b.reset(0.5);
    expect(applyBatteryItem(b, () => inv.consumeAt(ref))).toBeNull();
    expect(inv.count('battery')).toBe(1);
    // nothing to consume: the battery is not refilled
    b.reset(0.2);
    expect(applyBatteryItem(b, () => false)).toMatch(/No battery/);
    expect(b.charge).toBe(0.2);
    expect(inv.invariants()).toEqual([]);
  });

  it('reset() restores the start state (new station / retry / death)', () => {
    const b = new FlashlightBattery(mulberry32(5));
    b.reset(0);
    expect(b.on).toBe(false);
    b.reset();
    expect(b.charge).toBe(BATTERY.start);
    expect(b.on).toBe(true);
    expect(b.died).toBe(false);
    expect(b.dipping).toBe(false);
    expect(b.stats.dips).toBe(0);
  });
});

describe('flashlight flicker: linear in the remaining 0-25 %, restrained dips (not a strobe)', () => {
  it('flicker amount = (0.25 - charge) / 0.25, clamped; duty = 0.4 x amount', () => {
    for (const c of [1, 0.8, 0.5, 0.25, 0.26]) expect(flickerAmount(c)).toBe(0);
    for (const c of [0, 0.01, 0.0625, 0.1, 0.125, 0.2, 0.24, 0.2499]) {
      expect(flickerAmount(c)).toBeCloseTo((0.25 - c) / 0.25, 12);
      expect(dipDuty(c)).toBeCloseTo(FLICKER.dutyMax * (0.25 - c) / 0.25, 12);
    }
    // linear: equal charge steps give equal increments
    const steps = [0.25, 0.2, 0.15, 0.1, 0.05, 0].map(flickerAmount);
    for (let i = 1; i < steps.length; i++) expect(steps[i] - steps[i - 1]).toBeCloseTo(0.2, 12);
    // the renewal schedule: E[D] / (E[D] + E[G]) = duty exactly
    for (const a of [0.04, 0.25, 0.5, 1]) expect(MEAN_DIP / (MEAN_DIP + meanGap(a))).toBeCloseTo(FLICKER.dutyMax * a, 12);
    expect(dipEnvelope(0)).toBe(0);
    expect(dipEnvelope(0.4)).toBe(1);
    expect(dipEnvelope(1)).toBe(0);
  });

  it('above 25 % the light is perfectly stable', () => {
    for (const c of [1, 0.6, 0.26]) {
      const r = flickerRun(c, 120);
      expect(r.dips, `${c}`).toBe(0);
      expect(r.minOut, `${c}`).toBe(1);
      expect(r.offFrac).toBe(0);
    }
  });

  it('measured fraction of light-on time spent dimmed is 0.4 x amount (linear) at fixed charges', () => {
    const rows = [0.24, 0.2, 0.125, 0.05, 0.01].map(c => ({c, want: dipDuty(c), ...flickerRun(c, c >= 0.2 ? 6000 : 2500, 11)}));
    for (const r of rows) {
      expect(r.duty, `charge ${r.c}`).toBeGreaterThan(r.want * 0.88);
      expect(r.duty, `charge ${r.c}`).toBeLessThan(r.want * 1.12);
    }
    // linear fit through the measured points: slope ~ 0.4 per unit amount, intercept ~ 0
    const xs = rows.map(r => flickerAmount(r.c)), ys = rows.map(r => r.duty);
    const n = xs.length, mx = xs.reduce((a, b) => a + b) / n, my = ys.reduce((a, b) => a + b) / n;
    const slope = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0) / xs.reduce((s, x) => s + (x - mx) ** 2, 0);
    expect(slope).toBeGreaterThan(0.36);
    expect(slope).toBeLessThan(0.44);
    expect(Math.abs(my - slope * mx)).toBeLessThan(0.02);
    console.info('[light] flicker duty (charge: measured / 0.4a):', rows.map(r => `${r.c}: ${r.duty.toFixed(3)}/${r.want.toFixed(3)} (${(r.dips / (r.c >= 0.2 ? 6000 : 2500)).toFixed(2)} dips/s)`).join(', '));
  });

  it('is restrained: no rapid strobe; half-dims near 25 %, real cut-outs only near empty', () => {
    const hi = flickerRun(0.2, 600, 21), lo = flickerRun(0.01, 600, 21);
    expect(hi.perSecond).toBeLessThan(0.6); // ~1 dip per 2.4 s at 20 %
    expect(lo.perSecond).toBeLessThan(2.4); // even near empty: fewer than 2.4 dips per second, each >= 0.1 s with soft edges
    expect(hi.offFrac).toBe(0); // at 20 % the beam never cuts out, it only dims
    expect(hi.minOut).toBeGreaterThan(0.2);
    expect(lo.offFrac).toBeGreaterThan(0.03); // near empty some dips do cut out
    expect(lo.offFrac).toBeLessThan(0.3);
  });

  it('draining through the band (the last 105 s of light) flickers more and more: first half vs second half', () => {
    const halves = [0, 0, 0, 0]; // dip time / on time, first and second half of the band
    let seed = 31;
    for (let run = 0; run < 6; run++) {
      const b = new FlashlightBattery(mulberry32(seed++), BATTERY.drainPerSec);
      b.reset(0.25);
      let t = 0;
      while (b.on) {
        const dip0 = b.stats.dipTime, on0 = b.stats.flickerTime;
        b.update(DT);
        t += DT;
        const h = b.charge > 0.125 ? 0 : 1;
        halves[h * 2] += b.stats.dipTime - dip0;
        halves[h * 2 + 1] += b.stats.flickerTime - on0;
      }
      expect(t).toBeCloseTo(0.25 * BATTERY.fullSeconds, 0);
    }
    const first = halves[0] / halves[1], second = halves[2] / halves[3];
    // expected: 0.4 x mean amount over each half = 0.1 (a 0..0.5) and 0.3 (a 0.5..1)
    expect(first).toBeGreaterThan(0.07);
    expect(first).toBeLessThan(0.13);
    expect(second).toBeGreaterThan(0.25);
    expect(second).toBeLessThan(0.35);
  });
});

describe('player light: SpotLight output, body glow and light-source publishing', () => {
  function rig() {
    const cam = new THREE.PerspectiveCamera();
    const spot = new THREE.SpotLight(0xfff4e2, 0, 30, 0.58, 0.7, 1.2);
    spot.position.set(0.2, -0.15, 0.1);
    spot.target.position.set(0.04, -0.12, -6);
    cam.add(spot, spot.target);
    cam.position.set(5, 1.6, 5);
    cam.updateMatrixWorld(true);
    const pl = new PlayerLight(spot, 34, mulberry32(9));
    const sources = new LightSources();
    const world = {sources, eye: {x: 5, y: 1.6, z: 5}, feet: {x: 5, y: 0, z: 5}, yaw: 0, level: 0, raycast: () => 7};
    return {pl, spot, sources, world};
  }

  it('the body glow is a soft warm-orange, very short-range light that never attracts', () => {
    const {pl, sources, world} = rig();
    expect(pl.glow).toBeInstanceOf(THREE.PointLight);
    expect(BODY_GLOW.distance).toBeGreaterThanOrEqual(1.5);
    expect(BODY_GLOW.distance).toBeLessThanOrEqual(2.5);
    expect(pl.glow.intensity).toBeLessThan(0.5); // 34 cd flashlight vs 0.22 cd glow
    const c = pl.glow.color;
    expect(c.r).toBeGreaterThan(c.g);
    expect(c.g).toBeGreaterThan(c.b);
    pl.update(DT, world);
    const g = sources.list.find(s => s.kind === 'bodyGlow')!;
    expect(g.attractRange).toBe(0);
    expect(sources.attracting().some(s => s.kind === 'bodyGlow')).toBe(false);
    expect(g.y).toBeCloseTo(BODY_GLOW.height, 6); // chest height over the feet
    // irradiance at the feet vs 1.5 m away (three.js punctual light: I / d^2 x (1 - (d / cutoff)^4)^2): ~5 % at 1.5 m, 0 past 2.2 m
    const att = (d: number) => pl.glow.intensity / (d * d) * Math.max(0, 1 - (d / pl.glow.distance) ** 4) ** 2;
    expect(att(1.5) / att(BODY_GLOW.height)).toBeLessThan(0.3);
    expect(att(BODY_GLOW.distance + 0.05)).toBe(0);
  });

  it('publishes the flashlight beam (emitter, direction, spot at the raycast hit, range 20 m x output) and the glow, once each', () => {
    const {pl, spot, sources, world} = rig();
    pl.update(DT, world);
    expect(sources.list.map(s => s.kind).sort()).toEqual(['bodyGlow', 'flashlight']);
    const beam = sources.list.find(s => s.kind === 'flashlight')!;
    expect(beam.active).toBe(true);
    expect(beam.attractRange).toBeCloseTo(BEAM.attractRange, 6);
    expect(beam.intensity).toBe(1);
    expect(beam.cosHalfAngle).toBeCloseTo(Math.cos(0.58), 9);
    expect(spot.intensity).toBe(34);
    const d = beam.dir!;
    expect(Math.hypot(d.x, d.y, d.z)).toBeCloseTo(1, 6);
    expect(d.z).toBeLessThan(-0.99); // looking down -Z
    expect(beam.spot!.z).toBeCloseTo(5 + d.z * 7, 6);
    expect(beam.spot!.x).toBeCloseTo(5 + d.x * 7, 6);
    expect(sources.attracting().map(s => s.kind)).toEqual(['flashlight']);
    // switched off: inactive, nothing attracts, the SpotLight is dark
    pl.toggle();
    pl.update(DT, world);
    expect(beam.active).toBe(false);
    expect(beam.attractRange).toBe(0);
    expect(spot.intensity).toBe(0);
    expect(sources.attracting()).toEqual([]);
    // a cleared registry (new station) is re-populated on the next update without duplicates
    sources.clear();
    pl.toggle();
    pl.update(DT, world);
    pl.update(DT, world);
    expect(sources.list).toHaveLength(2);
  });

  it('a flicker-off dip makes the beam inactive for that instant; a flat battery never attracts', () => {
    const {pl, sources, world} = rig();
    pl.battery.reset(0.004);
    let sawOff = false, sawOn = false;
    for (let i = 0; i < 60 * 8 && pl.battery.on; i++) {
      pl.update(DT, world);
      const beam = sources.list.find(s => s.kind === 'flashlight')!;
      expect(beam.active).toBe(pl.battery.emitting);
      if (pl.battery.on && !pl.battery.emitting) sawOff = true;
      if (beam.active) { sawOn = true; expect(beam.attractRange).toBeCloseTo(BEAM.attractRange * pl.battery.output, 6); }
    }
    expect(sawOn).toBe(true);
    expect(sawOff).toBe(true);
    for (let i = 0; i < 60 * 60 && pl.battery.on; i++) pl.update(DT, world);
    expect(pl.battery.dead).toBe(true);
    pl.update(DT, world);
    expect(sources.attracting()).toEqual([]);
    expect(pl.toggle()).toBe('dead');
  });
});

// ---------------------------------------------------------------------------------------------
describe('flares: physical toss on the right storey, burn, cap, cleanup, exactly one item per throw', () => {
  const fx = levelFixture();
  const L = levelsOf(fx);
  function setup() {
    const ph = new PhysicsSystem(null);
    ph.build(fx);
    const scene = new THREE.Group();
    const sources = new LightSources();
    const fl = new FlareSystem(scene, ph, sources, mulberry32(77));
    const smoke: {added: number; stopped: number; moved: number; scatter: Set<THREE.PointLight>} = {added: 0, stopped: 0, moved: 0, scatter: new Set()};
    const audio = {ignite: 0, out: 0, loops: 0, loopStops: 0};
    fl.env = {
      levelAt: (x, z, y) => L.levelAt(x, z, y), lineOfSight: (a, b) => L.lineOfSight(a, b),
      smoke: {
        addSmokeEmitter: () => { smoke.added++; return {update: () => { smoke.moved++; }, stop: () => { smoke.stopped++; }}; },
        addScatterLight: l => smoke.scatter.add(l), removeScatterLight: l => smoke.scatter.delete(l),
      },
      audio: {flareIgnite: () => { audio.ignite++; }, flareOut: () => { audio.out++; }, flareBurnStart: () => { audio.loops++; return {setPos: () => {}, stop: () => { audio.loopStops++; }}; }},
    };
    const run = (s: number) => { for (let t = 0; t < s; t += DT) { ph.update(DT); fl.tick(DT); } };
    return {ph, scene, sources, fl, smoke, audio, run};
  }
  const eyeAt = (x: number, floor: number, z: number) => ({x, y: floor + 1.62, z});
  const norm = (x: number, y: number, z: number) => { const l = Math.hypot(x, y, z); return {x: x / l, y: y / l, z: z / l}; };

  it('a flare thrown on the upper deck flies, bounces and settles ON the deck (level 1), all positions in sync', () => {
    const {ph, fl, sources, run, smoke} = setup();
    const r = fl.throw(eyeAt(21, FIX.upperY, 5), norm(0, -0.15, 1));
    expect(r.ok).toBe(true);
    const f = fl.flares[0];
    expect(f.body).not.toBeNull();
    expect(ph.world!.bodies.includes(f.body!)).toBe(true);
    let maxDist = 0;
    for (let t = 0; t < 6 && f.body; t += DT) { ph.update(DT); fl.tick(DT); maxDist = Math.max(maxDist, f.pos.z - 5); }
    run(0.5);
    expect(f.body).toBeNull(); // settled: body left the world
    expect(maxDist).toBeGreaterThan(2); // it was actually thrown
    expect(f.pos.y).toBeGreaterThan(FIX.upperY);
    expect(f.pos.y).toBeLessThan(FIX.upperY + 0.08); // lying on the deck floor
    expect(f.pos.x).toBeGreaterThan(20);
    expect(f.pos.x).toBeLessThan(26);
    expect(L.levelAt(f.pos.x, f.pos.z, f.pos.y)).toBe(1);
    const src = sources.list.find(s => s.kind === 'flare')!;
    expect(src.level).toBe(1);
    expect([src.x, src.y, src.z]).toEqual([f.pos.x, f.pos.y, f.pos.z]);
    expect(src.spot).toEqual({x: f.pos.x, y: f.pos.y, z: f.pos.z});
    expect(src.dir).toBeNull();
    expect(src.attractRange).toBe(FLARE.attractRange);
    expect(f.light!.position.x).toBe(f.pos.x);
    expect(f.light!.position.y).toBeCloseTo(f.pos.y + FLARE.light.lift, 9);
    expect(f.light!.intensity).toBeGreaterThan(0);
    expect(smoke.added).toBe(1);
    expect(smoke.moved).toBeGreaterThan(10);
    expect(smoke.scatter.has(f.light!)).toBe(true);
  });

  it('thrown up under the deck it hits the slab underside and lands on platform A (level 0), not on the deck', () => {
    const {fl, run} = setup();
    expect(fl.throw(eyeAt(23, 0, 4), norm(0, 0.75, 0.66)).ok).toBe(true);
    run(7);
    const f = fl.flares[0];
    expect(f.body).toBeNull();
    expect(f.pos.y).toBeLessThan(0.08);
    expect(f.pos.y).toBeGreaterThan(-0.01);
    expect(L.levelAt(f.pos.x, f.pos.z, f.pos.y)).toBe(0);
  });

  it('thrown at a wall it bounces back and stays inside the station', () => {
    const {fl, run} = setup();
    expect(fl.throw(eyeAt(3.2, 0, 6), norm(-1, 0.05, 0)).ok).toBe(true);
    run(7);
    const f = fl.flares[0];
    expect(f.body).toBeNull();
    expect(f.pos.x).toBeGreaterThan(2); // platform A starts at x = 2 m (cell 4)
    expect(f.pos.y).toBeLessThan(0.08);
    expect(fl.counts.rescued).toBe(0);
  });

  // (task studio-general-armor-20261107-231448-01, user: "Increase duration 2x"): 50 -> 100 s (the strike / final fade / husk unchanged)
  it('burns ~100 s with a strike flare-up and a final fade, then goes out and is cleaned up after the husk time', () => {
    expect(flareEnvelope(0)).toBeCloseTo(0.5, 6);
    expect(flareEnvelope(1)).toBe(1);
    expect(flareEnvelope(FLARE.burn - FLARE.fade - 0.01)).toBe(1);
    expect(flareEnvelope(FLARE.burn - FLARE.fade / 2)).toBeCloseTo(0.5, 6);
    expect(flareEnvelope(FLARE.burn)).toBe(0);
    expect(FLARE.burn).toBe(100);
    expect([FLARE.fade, FLARE.ignite, FLARE.husk]).toEqual([6, 0.35, 20]);
    const {fl, sources, run, smoke, audio, scene} = setup();
    fl.throw(eyeAt(21, FIX.upperY, 5), norm(0, -0.2, 1));
    run(4);
    const f = fl.flares[0];
    const light = f.light!;
    expect(audio.ignite).toBe(1);
    expect(audio.loops).toBe(1);
    for (let t = 0; t < FLARE.burn - FLARE.fade - 4.5; t += 0.5) fl.tick(0.5);
    expect(f.burning).toBe(true);
    expect(sources.list.find(s => s.kind === 'flare')!.attractRange).toBe(FLARE.attractRange);
    fl.tick(FLARE.fade / 2 + 0.5);
    const mid = sources.list.find(s => s.kind === 'flare')!;
    expect(mid.attractRange).toBeLessThan(FLARE.attractRange * 0.75); // fading: the lure shrinks with the light
    expect(mid.attractRange).toBeGreaterThan(0);
    fl.tick(FLARE.fade);
    expect(f.burning).toBe(false);
    expect(light.intensity).toBe(0);
    expect(sources.list.filter(s => s.kind === 'flare')).toEqual([]);
    expect(smoke.stopped).toBe(1);
    expect(smoke.scatter.size).toBe(0);
    expect(audio.out).toBe(1);
    expect(audio.loopStops).toBe(1);
    expect(f.model.glow.visible).toBe(false);
    expect(fl.flares).toHaveLength(1); // the husk lies there a while
    fl.tick(FLARE.husk + 0.1);
    expect(fl.flares).toHaveLength(0);
    expect(scene.getObjectByName('flares')!.children).toHaveLength(0);
  });

  it('caps at 3 burning flares (refused, nothing consumed), frees a slot on burn-out; throws never lose or duplicate items', () => {
    const {fl, run} = setup();
    const inv = new Inventory();
    inv.add(inv.makeStack('flare', 3));
    inv.add(inv.makeStack('flare', 2));
    expect(inv.count('flare')).toBe(5);
    const take = () => inv.take('flare', 1) === 1, has = () => inv.count('flare') > 0;
    const throwAt = (i: number) => throwOneFlare(fl, take, has, eyeAt(21 + (i % 2) * 2, FIX.upperY, 4), norm(0, -0.1, 1));
    for (let i = 0; i < 3; i++) { expect(throwAt(i).ok, `throw ${i}`).toBe(true); run(FLARE.cooldown + 0.05); }
    expect(inv.count('flare')).toBe(2);
    expect(fl.burningCount).toBe(3);
    const r = throwAt(3);
    expect(r).toEqual({ok: false, reason: 'cap'});
    expect(inv.count('flare')).toBe(2); // refused: nothing removed
    expect(fl.flares).toHaveLength(3);
    // cooldown: an immediate second press is refused silently, nothing removed
    run(FLARE.burn); // all three burn out
    expect(fl.burningCount).toBe(0);
    expect(throwAt(4).ok).toBe(true);
    expect(throwAt(5)).toEqual({ok: false, reason: 'cooldown'});
    expect(inv.count('flare')).toBe(1);
    run(FLARE.cooldown + 0.05);
    expect(throwAt(6).ok).toBe(true);
    expect(inv.count('flare')).toBe(0);
    expect(throwAt(7)).toEqual({ok: false, reason: 'none'});
    expect(fl.counts.thrown).toBe(5);
    expect(inv.invariants()).toEqual([]);
    // the pooled lights are reused: never more than maxActive red lights exist
    expect(fl.lights).toHaveLength(FLARE.maxActive);
  });

  it('clear() (new station / retry) removes bodies, meshes, lights, smoke, loops and light sources', () => {
    const {ph, fl, sources, run, smoke, audio, scene} = setup();
    fl.throw(eyeAt(21, FIX.upperY, 5), norm(0, -0.1, 1));
    run(FLARE.cooldown + 0.05);
    fl.throw(eyeAt(23, FIX.upperY, 5), norm(0, 0.3, 1));
    run(0.1);
    expect(fl.awake).toBeGreaterThan(0);
    const bodies = fl.flares.map(f => f.body).filter(Boolean) as NonNullable<(typeof fl.flares)[0]['body']>[];
    fl.clear();
    expect(fl.flares).toHaveLength(0);
    for (const b of bodies) expect(ph.world!.bodies.includes(b)).toBe(false);
    expect(sources.list).toHaveLength(0);
    expect(fl.lights.every(l => l.intensity === 0)).toBe(true);
    expect(smoke.stopped).toBe(2);
    expect(smoke.scatter.size).toBe(0);
    expect(audio.loopStops).toBe(2);
    expect(audio.out).toBe(0); // silent cleanup
    expect(scene.getObjectByName('flares')!.children).toHaveLength(0);
    // the lights stay in the scene (constant light count: no shader recompiles) and are all free again
    expect(scene.children.filter(o => (o as THREE.PointLight).isPointLight)).toHaveLength(FLARE.maxActive);
    expect(fl.throw(eyeAt(21, FIX.upperY, 5), norm(0, -0.1, 1)).ok).toBe(true);
    // PhysicsSystem.build (next station) clears the flares too
    ph.build(fx);
    expect(fl.flares).toHaveLength(0);
    expect(sources.list).toHaveLength(0);
  });

  it('refuses without a physics world (between stations)', () => {
    const ph = new PhysicsSystem(null);
    const fl = new FlareSystem(new THREE.Group(), ph, new LightSources());
    expect(fl.throw({x: 0, y: 1.6, z: 0}, {x: 0, y: 0, z: -1})).toEqual({ok: false, reason: 'unavailable'});
  });
});

// ---------------------------------------------------------------------------------------------
describe('battery / flare items and their authored models', () => {
  it('defines the battery (consumable, verb use, refills to 100 %) and the flare (throwable, stack 10) with icons and dims', () => {
    const b = itemDef('battery'), f = itemDef('flare');
    expect(b).toMatchObject({kind: 'consumable', verb: 'use', recharge: 1, icon: 'battery'});
    expect(f).toMatchObject({kind: 'throwable', stackMax: 10, icon: 'flare'}); // task office-overhaul-20261030 (INTERACT #6): stacks of 10
    expect(ICONS.battery).toContain('<svg');
    expect(ICONS.flare).toContain('<svg');
    expect(ITEM_DIMS.battery.h).toBeCloseTo(0.0615, 4);
    expect(ITEM_DIMS.flare.w).toBeCloseTo(0.255, 4);
    expect(useHint(b)).toMatch(/Click to use · flashlight battery 100 %/);
    expect(effectText(b)).toBe('flashlight battery 100 %');
    expect(throwHint(f)).toMatch(/Hold click or G to ready .* release to throw/); // iteration 15: hold to ready, release to throw; INTERACT #6: G (was T)
    expect(Object.values(ITEMS).filter(d => d.kind === 'throwable').map(d => d.id)).toEqual(['flare']);
    expect(CONTROLS.some(([a, k]) => a === 'Throw equipped grenade' && k.startsWith('Hold G'))).toBe(true); // INTERACT #6: G (was T); campaign-save-controls-fix: item-agnostic
    expect(CONTROLS.some(([a, k]) => a === 'Use held item' && k === 'Left click')).toBe(true); // a battery is used like any held item (campaign-save-controls-fix: no item-specific rows)
  });

  it('the battery swap animation (consume view "insert") keeps the cell on screen in the lower half for the whole use', () => {
    const cam = new THREE.PerspectiveCamera(54, 16 / 9, 0.01, 20); // the viewmodel camera
    const cv = new ConsumeView({camera: cam}, makeSupplyMesh);
    cv.start('battery', itemDef('battery').useTime!, 'empty');
    const v = new THREE.Vector3();
    let frames = 0, inView = 0;
    for (let t = 0; t < itemDef('battery').useTime!; t += DT) {
      cv.update(DT);
      if (cv.phase !== 'use') continue;
      frames++;
      cam.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(cv.group);
      const c = box.getCenter(v).project(cam);
      if (Math.abs(c.x) < 0.8 && c.y < 0 && c.y > -0.85) inView++;
    }
    expect(frames).toBeGreaterThan(30);
    expect(inView / frames).toBeGreaterThan(0.95);
  });

  it('builds AUTHORED (procedural, not generated) models at real dimensions, origin bottom-centre', () => {
    const bs = authoredSize('battery');
    expect(bs.x).toBeCloseTo(2 * BATTERY_DIMS.r, 3);
    expect(bs.y).toBeCloseTo(BATTERY_DIMS.h + BATTERY_DIMS.nubH, 4);
    const fs = authoredSize('flare');
    expect(fs.x).toBeCloseTo(FLARE_DIMS.total, 3);
    expect(fs.y).toBeCloseTo(2 * FLARE_DIMS.capR, 3);
    expect(fs.x).toBeGreaterThan(0.24);
    expect(fs.x).toBeLessThan(0.27);
    for (const id of ['battery', 'flare'] as const) {
      const box = new THREE.Box3().setFromObject(authoredItemModel(id));
      expect(box.min.y, id).toBeCloseTo(0, 4);
      expect(Math.abs(box.min.x + box.max.x), id).toBeLessThan(0.002);
      expect(Math.abs(box.min.z + box.max.z), id).toBeLessThan(0.002);
      // the world pickup / icon / held model all come from the same authored template
      const m = makeSupplyMesh(id);
      let meshes = 0;
      m.traverse(o => { if ((o as THREE.Mesh).isMesh) { meshes++; expect(o.userData.shared, id).toBe(true); } });
      expect(meshes, id).toBeGreaterThanOrEqual(2);
      expect(itemModelSources()[id], id).toMatch(/authored procedural geometry/);
    }
    // labels are canvas textures on the label / paper materials
    const bat = authoredItemModel('battery').children[0] as THREE.Mesh;
    expect((bat.material as THREE.MeshStandardMaterial).map).toBeTruthy();
    const t = thrownFlareModel();
    expect(t.glow.visible).toBe(true);
    expect(t.headLocal.x).toBeGreaterThan(0.08);
    t.setBurning(false);
    expect(t.glow.visible).toBe(false);
    expect((t.head.material as THREE.MeshStandardMaterial).emissive.getHex()).toBe(0); // ash: no glow
  });
});
