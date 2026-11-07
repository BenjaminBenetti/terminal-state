// Task mall-round2-20261031 (lane AUDIO, M01; user: "cardboard boxes play the metal clanking sound when being pushed around, should
// actually be more of a cardboard sound" — a general statement, every level). Node tests (cannon-es + the fake WebAudio, no browser):
//  - classification: the loose cardboard kinds of every level (Mall cardboard box, Office archive boxes, Subway newspaper bundles)
//    strike as 'cardboard'; every other loose prop keeps 'prop' (the steel trash can propTopple was recorded for, chairs, bins …);
//    the bullet route of cardboard (impactWood / breakWood) is unchanged;
//  - physics routing: walked into, each cardboard kind sends only 'cardboard' impacts (with its mass) and paced drag ticks while it
//    slides, then exactly one release; a steel trash can (negative control) still strikes as 'prop' and never drags;
//  - Sfx: a cardboard thud plays the accepted 'land' + 'jump' clips through flat lowpasses (no propTopple), heavier = lower; metal /
//    wood / glass / prop / item families play exactly their previous cues unfiltered; drag ticks are one voice per prop, at most
//    CARDBOARD_AUDIO.drag.maxVoices at once, bucket-bounded, truncated to maxDur, released on propDragStop / a new station.
// Structural only: none of this is a listening test (the sound itself was not auditioned).
import * as THREE from 'three';
import {describe, expect, it} from 'vitest';
import {FLOOR, Grid, SOLID} from '../src/gen/grid';
import {PROP_DEFS, footprint, type PropKind, type PropPlacement} from '../src/gen/props';
import {ALL_PROP_KINDS, DAMAGE_MATERIALS, propDamageSpec, propPhysics} from '../src/damage/materials';
import {PhysicsSystem} from '../src/physics/world';
import {PROP_DRAG, dynamicKind, propImpactFamily, type Walker} from '../src/physics/dynamicItems';
import type {ImpactFamily} from '../src/physics/chunks';
import {CARDBOARD_AUDIO, PHYS_CUE, Sfx, cardboardThudRate} from '../src/audio/sfx';
import type {CueId} from '../src/audio/bank';
import {FakeCtx, fakeBank, type Src} from './helpers/fakeAudio';

const DT = 1 / 60;
// (task studio-skyways-level-20261106-054448, lane ADDON: + the Skyways convention's boxed figure — a cardboard window box)
// (task studio-skyways-destinations-20261106-170011-01, lane SHOPS-A: + the bookshop's loose hardcover stacks and the hobby shop's boxed model kits)
// (task studio-alpha-skyways-shops-20261107-054512-01, lane STORE-MUSIC: + the record store's filed sleeves in the bins and the faced-out LPs)
const CARDBOARD_KINDS = ['archiveBoxes', 'cardboardBoxFlaps', 'newspaperBundles', 'skyDBookStack', 'skyDModelKits', 'skyMuBinRecords', 'skyMuFacedRecords', 'skywaysConFigureBox'];

describe('M01 classification: which loose props are cardboard (every level)', () => {
  it('exactly the dynamic kinds of damage class cardboard strike as cardboard; every other loose prop keeps prop', () => {
    const dyn = ALL_PROP_KINDS.filter(k => dynamicKind(k));
    const card = dyn.filter(k => propImpactFamily(k) === 'cardboard').sort();
    expect(card).toEqual(CARDBOARD_KINDS);
    for (const k of dyn) expect(propImpactFamily(k), k).toBe(propDamageSpec(k).cls === 'cardboard' ? 'cardboard' : 'prop');
    // negative controls: the steel trash can the propTopple take was recorded for, plastic / metal / wooden loose props
    for (const k of ['bin', 'wheelieBin', 'storageTote', 'plasticStackChair', 'foldingChair', 'fireExtinguisher', 'rollingSuitcase', 'trashBagPile'] as PropKind[]) {
      expect(dyn, k).toContain(k); // a real loose prop (the control is not vacuous)
      expect(propImpactFamily(k), k).toBe('prop');
    }
    // static cardboard (a carton stack collapses, a parcel pallet is too heavy) never moves: the family is moot but stays honest
    expect(dynamicKind('cartonStack')).toBe(false);
    console.info(`[M01] cardboard loose kinds: ${card.map(k => `${k} ${propPhysics(k).mass} kg`).join(', ')}; other loose kinds: ${dyn.length - card.length}`);
  });

  it('the bullet / break route of cardboard is unchanged (impactWood / breakWood), and so are the other contact cues', () => {
    expect(DAMAGE_MATERIALS.cardboard.sound).toBe('wood');
    expect(DAMAGE_MATERIALS.cardboard.breakSound).toBe('breakWood');
    expect(PHYS_CUE).toEqual({can: 'itemCan', light: 'itemLight', heavy: 'impactMetal', prop: 'propTopple', cardboard: 'land', flesh: 'chunkFlesh',
      stone: 'debrisFall', wood: 'impactWood', glass: 'impactGlass', metal: 'impactSheetMetal'});
  });
});

// ---------------------------------------------------------------------------------------------
// Physics routing on the shared path (a lone prop in a 24 x 16 m room, as tests/contact-physics.test.ts)

interface AudioLog {impacts: {t: number; fam: ImpactFamily; mass?: number}[]; drags: {t: number; speed: number; id: object}[]; stops: {t: number; id: object}[]}

function lone(kind: PropKind) {
  const {hx, hz} = footprint(kind, 0);
  const p: PropPlacement = {kind, x: 10, z: 8, y: 0, rot: 0, area: 0, hx, hz, h: PROP_DEFS[kind].h, blocksSight: false, variant: 0};
  const g = new Grid(48, 32);
  for (let y = 0; y < 32; y++) for (let x = 0; x < 48; x++) g.set(x, y, x < 2 || y < 2 || x >= 46 || y >= 30 ? SOLID : FLOOR);
  const ph = new PhysicsSystem(null);
  ph.build({grid: g, props: [p], trench: {floorY: -1.15}});
  ph.dynamicItems.contactWake = null;
  const m = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), new THREE.MeshStandardMaterial());
  ph.dynamicItems.detacher = {detachForPhysics: q => {
    m.matrixAutoUpdate = false;
    m.matrix.compose(new THREE.Vector3(q.x, q.y, q.z), new THREE.Quaternion(), new THREE.Vector3(1, 1, 1));
    return [m];
  }};
  const log: AudioLog = {impacts: [], drags: [], stops: []};
  const clock = {t: 0};
  ph.audio = {
    physImpact: (_x, _y, _z, _v, fam, mass) => log.impacts.push({t: clock.t, fam, mass}),
    propDrag: (_x, _y, _z, speed, id) => log.drags.push({t: clock.t, speed, id}),
    propDragStop: id => log.stops.push({t: clock.t, id}),
  };
  const step = () => { ph.update(DT); clock.t += DT; };
  const pose = () => new THREE.Vector3().setFromMatrixPosition(m.matrix);
  return {p, ph, log, step, pose, clock};
}

/** A walker (the player) walks 2.5 s into the prop's west face at `speed`, then stops; 20 s more to rest. */
function walkIn(r: ReturnType<typeof lone>, speed = 1.4): {pushEnd: number} {
  const w: Walker = {id: {}, x: r.p.x - r.p.hx - 1.1, z: r.p.z, y: 0, r: 0.3, wake: true};
  r.ph.dynamicItems.walkers = () => [w];
  for (let i = 0; i < 150; i++) { w.x += speed * DT; r.step(); }
  const pushEnd = r.clock.t;
  r.ph.dynamicItems.walkers = () => [];
  for (let i = 0; i < 1200; i++) r.step();
  return {pushEnd};
}

describe('M01 physics routing: cardboard props thud / drag on the shared contact path, others unchanged', () => {
  // (lane ADDON: floor kinds only — on-host decor such as the convention's boxed figure stands on a table top, out of a walker's legs' reach)
  for (const kind of (CARDBOARD_KINDS as PropKind[]).filter(k => !propPhysics(k).onHost)) {
    it(`${kind} walked into: only cardboard impacts (its mass), paced drag ticks while it slides, then one release`, () => {
      const r = lone(kind);
      const {pushEnd} = walkIn(r);
      const st = r.ph.dynamicItems.stats();
      expect(st.counts.contacts).toBe(1); // woken by the walk-in (no shot)
      expect(st.propsAwake).toBe(0); // at rest again
      const moved = r.pose().x - 10;
      console.info(`[M01 walk] ${kind}: moved ${moved.toFixed(2)} m, impacts ${r.log.impacts.map(i => i.fam).join(',') || 'none'}, drags ${r.log.drags.length}, stops ${r.log.stops.length}`);
      // never the metal trash-can family
      for (const i of r.log.impacts) { expect(i.fam).toBe('cardboard'); expect(i.mass).toBe(propPhysics(kind).mass); }
      // it slid while pushed: drag ticks, all for this prop, never closer than the fastest gap (no per-frame retrigger)
      expect(r.log.drags.length).toBeGreaterThanOrEqual(2);
      for (const d of r.log.drags) { expect(d.id).toBe(r.p); expect(d.speed).toBeGreaterThanOrEqual(PROP_DRAG.release); }
      for (let i = 1; i < r.log.drags.length; i++) expect(r.log.drags[i].t - r.log.drags[i - 1].t).toBeGreaterThanOrEqual(PROP_DRAG.fastGap - 1e-9);
      // a steady push is one drag: released once (a hop over a bump within PROP_DRAG.hold does not stutter it off / on)
      expect(r.log.stops.length).toBe(1);
      // released: a stop after the last tick, nothing after the push ended + its coast; one stop per slide (ticks between stops)
      expect(r.log.stops.length).toBeGreaterThanOrEqual(1);
      const lastDrag = r.log.drags[r.log.drags.length - 1].t, lastStop = r.log.stops[r.log.stops.length - 1].t;
      expect(lastStop).toBeGreaterThan(lastDrag);
      expect(lastStop).toBeLessThan(pushEnd + 3);
      for (const s of r.log.stops) expect(s.id).toBe(r.p);
      expect(st.counts.drags).toBe(r.log.drags.length);
      expect(st.counts.dragStops).toBe(r.log.stops.length);
    });
  }

  it('a cardboard box knocked flying by a shot lands with cardboard thuds (never prop)', () => {
    const r = lone('cardboardBoxFlaps');
    expect(r.ph.dynamicItems.shootProp(r.p, 0, new THREE.Vector3(r.p.x - r.p.hx, 0.2, r.p.z), new THREE.Vector3(1, 0.6, 0).normalize(), 10)).toBe(true);
    for (let i = 0; i < 900; i++) r.step();
    expect(r.log.impacts.length).toBeGreaterThanOrEqual(1);
    for (const i of r.log.impacts) expect(i.fam).toBe('cardboard');
    expect(r.ph.dynamicItems.stats().propsAwake).toBe(0);
  });

  it('negative control: the steel trash can still strikes as prop (propTopple) and never sends a drag', () => {
    const walked = lone('bin');
    walkIn(walked);
    expect(walked.ph.dynamicItems.stats().counts.contacts).toBe(1);
    const shot = lone('bin');
    expect(shot.ph.dynamicItems.shootProp(shot.p, 0, new THREE.Vector3(shot.p.x - shot.p.hx, 0.2, shot.p.z), new THREE.Vector3(1, 0.6, 0).normalize(), 25)).toBe(true);
    for (let i = 0; i < 900; i++) shot.step();
    expect(shot.log.impacts.length).toBeGreaterThanOrEqual(1);
    for (const r of [walked, shot]) {
      for (const i of r.log.impacts) expect(i.fam).toBe('prop');
      expect(r.log.drags.length).toBe(0);
      expect(r.log.stops.length).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// Sfx: what each family plays (fake WebAudio + a fake decoded bank)

const settle = () => new Promise(res => setTimeout(res, 40));
async function rig() {
  const made: FakeCtx[] = [];
  const {bank} = fakeBank({variants: 3});
  const sfx = new Sfx(() => { const c = new FakeCtx(); made.push(c); return c as unknown as AudioContext; }, bank);
  sfx.init();
  sfx.suspend(false);
  await settle();
  const ctx = made[0];
  const cueOf = new Map<unknown, CueId>();
  for (const cue of Object.keys(PHYS_CUE).map(f => PHYS_CUE[f as ImpactFamily]).concat(['jump', 'land', 'propTopple', 'impactWood'] as CueId[])) for (const c of bank.get(cue)) cueOf.set(c.buffer, cue);
  const filters = () => ctx.nodes.filter(n => (n as unknown as {frequency?: unknown}).frequency !== undefined) as unknown as {type: string; frequency: {value: number}; Q: {value: number}}[];
  return {sfx, ctx, cueOf, filters};
}

describe('M01 Sfx: cardboard thud / drag on accepted clips; other families unchanged', () => {
  it('a cardboard thud = land body + short jump slap through flat lowpasses; heavier props play lower; never propTopple', async () => {
    const {sfx, ctx, cueOf, filters} = await rig();
    const rates: Record<string, number[]> = {};
    for (const mass of [3, 12, 28]) {
      ctx.currentTime += 5;
      const s0 = ctx.started.length, f0 = filters().length;
      sfx.physImpact(2, 0.1, 2, 3, 'cardboard', mass);
      const played = ctx.started.slice(s0);
      expect(played.map(s => cueOf.get(s.buffer))).toEqual(['land', 'jump']);
      const fs = filters().slice(f0).filter(f => f.type === 'lowpass');
      expect(fs.map(f => f.frequency.value)).toEqual([CARDBOARD_AUDIO.thud.body.lowpass, CARDBOARD_AUDIO.thud.slap.lowpass]);
      for (const f of fs) expect(f.Q.value).toBeLessThan(0); // flat (Butterworth) — no resonant bump
      rates[mass] = played.map(s => s.playbackRate.value);
      const want = cardboardThudRate(mass, 3 / 5), j = CARDBOARD_AUDIO.thud.jitter;
      expect(played[0].playbackRate.value).toBeGreaterThanOrEqual(want * (1 - j) - 1e-9);
      expect(played[0].playbackRate.value).toBeLessThanOrEqual(want * (1 + j) + 1e-9);
    }
    expect(cardboardThudRate(3, 0.6)).toBeGreaterThan(cardboardThudRate(12, 0.6));
    expect(cardboardThudRate(12, 0.6)).toBeGreaterThan(cardboardThudRate(28, 0.6));
    expect(cardboardThudRate(undefined, 0.6)).toBe(cardboardThudRate(3, 0.6));
    console.info(`[M01 thud] rates body/slap: ${Object.entries(rates).map(([m, r]) => `${m} kg ${r.map(v => v.toFixed(2)).join('/')}`).join(', ')}`);
  });

  it('negative controls: prop / metal / wood / glass / heavy / light / can play exactly their previous cue, unfiltered', async () => {
    const {sfx, ctx, cueOf, filters} = await rig();
    for (const fam of ['prop', 'metal', 'wood', 'glass', 'heavy', 'light', 'can', 'stone', 'flesh'] as ImpactFamily[]) {
      ctx.currentTime += 5;
      const s0 = ctx.started.length, f0 = filters().length;
      sfx.physImpact(2, 0.1, 2, 3, fam, 7);
      expect(ctx.started.slice(s0).map(s => cueOf.get(s.buffer)), fam).toEqual([PHYS_CUE[fam]]);
      expect(filters().length, fam).toBe(f0);
    }
    // a bullet into cardboard keeps the wood impact
    ctx.currentTime += 5;
    const s0 = ctx.started.length;
    sfx.impact(2, 0.5, 2, DAMAGE_MATERIALS.cardboard.sound);
    expect(ctx.started.slice(s0).map(s => cueOf.get(s.buffer))).toEqual(['impactWood']);
  });

  it('thud overlap is bounded by the fall bucket (a burst of contacts at one instant)', async () => {
    const {sfx, ctx, cueOf} = await rig();
    ctx.currentTime += 5;
    const s0 = ctx.started.length;
    for (let i = 0; i < 10; i++) sfx.physImpact(2, 0.1, 2, 3, 'cardboard', 3);
    expect(ctx.started.slice(s0).filter(s => cueOf.get(s.buffer) === 'land').length).toBe(3); // BUCKETS.fall burst
  });

  it('drag: one voice per prop even when called every frame; <= maxVoices props at once; bucket-bounded starts', async () => {
    const {sfx, ctx, cueOf} = await rig();
    ctx.currentTime += 5;
    const D = CARDBOARD_AUDIO.drag, a = {}, s0 = ctx.started.length;
    let maxOne = 0;
    for (let i = 0; i < 120; i++) { ctx.currentTime += DT; sfx.propDrag(2, 0, 2, 1.2, a); maxOne = Math.max(maxOne, sfx.debugState().drag.voices); }
    const one = ctx.started.slice(s0);
    for (const s of one) expect(cueOf.get(s.buffer)).toBe(D.cue);
    expect(maxOne).toBe(1);
    expect(one.length).toBeLessThanOrEqual(3 + 10 * 2 + 1); // BUCKETS.drag [10/s, burst 3] over 2 s
    // six props sliding at once, every frame
    ctx.currentTime += 5;
    const ids = Array.from({length: 6}, () => ({})), s1 = ctx.started.length;
    let maxAll = 0;
    for (let i = 0; i < 120; i++) { ctx.currentTime += DT; for (const id of ids) sfx.propDrag(2, 0, 2, 1.2, id); maxAll = Math.max(maxAll, sfx.debugState().drag.voices); }
    expect(maxAll).toBeLessThanOrEqual(D.maxVoices);
    expect(ctx.started.length - s1).toBeLessThanOrEqual(3 + 10 * 2 + 1);
    expect(sfx.debugState().drag.capped).toBeGreaterThan(0);
  });

  it('drag at the physics cadence: every tick plays, truncated to maxDur, lowpassed, slower when slow; far props are culled', async () => {
    const {sfx, ctx, cueOf, filters} = await rig();
    ctx.currentTime += 5;
    const D = CARDBOARD_AUDIO.drag, id = {}, s0 = ctx.started.length, f0 = filters().length;
    for (let i = 0; i < 8; i++) { sfx.propDrag(2, 0, 2, i < 4 ? 0.4 : 2.5, id); ctx.currentTime += PROP_DRAG.fastGap; }
    const played = ctx.started.slice(s0) as Src[];
    expect(played.length).toBe(8);
    for (const s of played) expect(cueOf.get(s.buffer)).toBe('jump');
    expect(filters().slice(f0).filter(f => f.type === 'lowpass' && f.frequency.value === D.lowpass).length).toBe(8);
    // rate from speed (jitter-bounded per tick): slow pushes play slower / lower than fast ones
    const rateAt = (speed: number) => D.rate[0] + (D.rate[1] - D.rate[0]) * Math.min(1, speed / D.fast);
    played.forEach((s, i) => {
      const want = rateAt(i < 4 ? 0.4 : 2.5);
      expect(s.playbackRate.value).toBeGreaterThanOrEqual(want * (1 - D.jitter) - 1e-9);
      expect(s.playbackRate.value).toBeLessThanOrEqual(want * (1 + D.jitter) + 1e-9);
    });
    expect(rateAt(0.4)).toBeLessThan(rateAt(2.5));
    // truncated: the fake clip lasts 0.45 s / rate (~0.47-0.56 s); the voice ends after maxDur
    ctx.currentTime += 1;
    const t = ctx.currentTime;
    sfx.propDrag(2, 0, 2, 1, {});
    ctx.currentTime = t + D.maxDur + 0.03;
    expect(sfx.debugState().drag.voices).toBe(0);
    // far: culled before any voice
    const s1 = ctx.started.length;
    sfx.propDrag(30, 0, 2, 1, {});
    expect(ctx.started.length).toBe(s1);
  });

  it('release: propDragStop fades the sounding drag out within `release` s (idempotent); a new station releases every drag', async () => {
    const {sfx, ctx} = await rig();
    ctx.currentTime += 5;
    const D = CARDBOARD_AUDIO.drag, a = {}, b = {};
    sfx.propDrag(2, 0, 2, 1.2, a);
    sfx.propDrag(2, 0, 3, 1.2, b);
    expect(sfx.debugState().drag.voices).toBe(2);
    sfx.propDragStop(a);
    sfx.propDragStop(a);
    expect(sfx.debugState().drag.stops).toBe(1);
    ctx.currentTime += D.release + 0.035;
    expect(sfx.debugState().drag.voices).toBe(1); // a released, b (not stopped, maxDur 0.26 s) still sounding
    sfx.propDragStop({}); // never dragged: nothing to do
    expect(sfx.debugState().drag.stops).toBe(1);
    // new station (setWorld with occlusion): every drag fades
    sfx.propDrag(2, 0, 2, 1.2, a);
    expect(sfx.debugState().drag.voices).toBe(2);
    sfx.setWorld({occlusion: () => 0});
    ctx.currentTime += 0.09;
    expect(sfx.debugState().drag.voices).toBe(0);
  });
});
