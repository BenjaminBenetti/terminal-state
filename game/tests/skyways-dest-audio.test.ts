// Task studio-skyways-destinations-20261106-170011-01 (lane AUDIO): the destinations' LOCATION sounds. STRUCTURAL evidence — the emitter
// list derived from a REAL generated Skyways layout (a Clock Court, the Starfall Arcade, the Aurora Picture House with its auditorium) and
// the location channels / clock chime on a fake WebAudio context (start / ease / stop, nearest-two bound, storey gate, chime pacing,
// pause and world lifecycle). NOT an audition: nobody listened to the clips on the build worker (derivatives/audio-skyways-destinations.json).
import {describe, expect, it} from 'vitest';
import {CUES} from '../src/audio/bank';
import {CLIP_MANIFEST_SKYWAYS_DESTINATIONS} from '../src/audio/manifest.skywaysDestinations.generated';
import {CUE_GAIN, LOCATION_AUDIO, Sfx, type LocationEmitter} from '../src/audio/sfx';
import {CELL} from '../src/gen/grid';
import type {StationLayout} from '../src/gen/stationTypes';
import {LEVELS} from '../src/levels/registry';
import {SKYWAYS_DEST_AUDIO, installSkywaysDestAudio, skywaysLocationEmitters} from '../src/world/skywaysDestAudio';
import {FakeCtx, fakeBank, type Node, type Src} from './helpers/fakeAudio';

/** Seed 33: a Clock Court, the arcade (hall) and the cinema (multi-zone: lobby + auditorium) in one map; seed 7: none of them. */
const SEED_ALL = 33, SEED_NONE = 7;
const cache = new Map<number, StationLayout>();
const gen = (s: number): StationLayout => { let l = cache.get(s); if (!l) cache.set(s, (l = LEVELS.skyways.generate('main', {levelSeed: s, startWeapon: 'pistol'}))); return l; };
const settle = () => new Promise(r => setTimeout(r, 40));
const LOC_CUES = ['clockTick', 'clockChime', 'arcadeAttract', 'projectorRun'] as const;

async function setup(only: readonly (typeof CUES)[number][] = LOC_CUES) {
  const made: FakeCtx[] = [];
  const {bank} = fakeBank({variants: 1, only});
  const sfx = new Sfx(() => { const c = new FakeCtx(); made.push(c); return c as unknown as AudioContext; }, bank);
  sfx.init();
  sfx.suspend(false);
  await settle();
  const ctx = made[0];
  const bufs = (cue: (typeof LOC_CUES)[number]) => new Set(bank.has(cue) ? bank.get(cue).map(c => c.buffer as unknown) : []);
  const srcsOf = (cue: (typeof LOC_CUES)[number]) => { const b = bufs(cue); return ctx.started.filter(s => b.has(s.buffer)); };
  return {sfx, ctx, srcsOf};
}
/** One emitter tick: `dt` s pass, then 12 listener updates (the tick runs once per 12). */
const step = (sfx: Sfx, ctx: FakeCtx, p: {x: number; y: number; z: number}, dt = 0.25) => { ctx.currentTime += dt; for (let k = 0; k < 12; k++) sfx.setListener(p.x, p.y, p.z, 0); };
const gainOf = (s: Src) => (s.outputs[0] as unknown as {gain: {value: number}}).gain.value;
const pannerOf = (s: Src) => { let n: Node = s.outputs[0]; while (n && n.kind !== 'panner') n = n.outputs[0]; return n as unknown as Node & {positionX: {value: number}; positionY: {value: number}; positionZ: {value: number}; refDistance: number}; };
/** Record stop() calls on a started source (the fake's stop is a no-op). */
const stops = (s: Src) => { const at: number[] = []; s.stop = (t?: number) => { at.push(t ?? 0); }; return at; };

describe('Skyways destinations: location emitters from a real generated layout', () => {
  it('the four clips are bank cues with mix gains; the three loops are loops, the chime a one-shot', () => {
    for (const c of LOC_CUES) {
      expect(CUES as readonly string[]).toContain(c);
      expect(CUE_GAIN[c]).toBeGreaterThan(0);
      expect(CLIP_MANIFEST_SKYWAYS_DESTINATIONS[c]).toHaveLength(1);
    }
    for (const c of ['clockTick', 'arcadeAttract', 'projectorRun']) expect(CLIP_MANIFEST_SKYWAYS_DESTINATIONS[c][0].loop).toBeTruthy();
    expect(CLIP_MANIFEST_SKYWAYS_DESTINATIONS.clockChime[0].loop).toBeUndefined();
  });

  it('clock -> clockTick at the centrepiece (+3 m), arcade -> arcadeAttract at its floor centre, cinema -> projectorRun at the auditorium back wall', () => {
    const L = gen(SEED_ALL), sk = L.skyways!;
    const clock = sk.landmarks!.find(m => m.family === 'clock')!, arcade = sk.anchors!.find(a => a.family === 'arcade')!, cinema = sk.anchors!.find(a => a.family === 'cinema')!;
    expect(clock && arcade && cinema).toBeTruthy();
    expect(cinema.format).toBe('multi-zone');
    const em = skywaysLocationEmitters(L);
    expect(em.map(e => e.cue).sort()).toEqual(['arcadeAttract', 'clockTick', 'projectorRun']);
    expect(skywaysLocationEmitters(L)).toEqual(em); // pure / deterministic
    // clock: at the centrepiece, the movement 3 m up; an atrium court: no storey gate (heard from the gallery above)
    const ct = em.find(e => e.cue === 'clockTick')!;
    expect(clock.atrium).toBe(true);
    expect([ct.x, ct.z]).toEqual([clock.x, clock.z]);
    expect(ct.y).toBeCloseTo(clock.y + SKYWAYS_DEST_AUDIO.clock.lift, 6);
    expect(ct.floorY).toBeUndefined();
    expect(ct.range).toBeGreaterThanOrEqual(LOCATION_AUDIO.chime.range);
    // arcade: the centre of its sales floor (inside the anchor's footprint), speaker height, gated to its storey, range over the floor + the lobby in front
    const ar = em.find(e => e.cue === 'arcadeAttract')!, fl = L.areas[arcade.floor];
    const fx0 = fl.x * CELL, fz0 = fl.y * CELL, fx1 = (fl.x + fl.w) * CELL, fz1 = (fl.y + fl.h) * CELL;
    expect(ar.x).toBeCloseTo((fx0 + fx1) / 2, 3);
    expect(ar.z).toBeCloseTo((fz0 + fz1) / 2, 3);
    expect(ar.x).toBeGreaterThan(arcade.rect.x0); expect(ar.x).toBeLessThan(arcade.rect.x1);
    expect(ar.z).toBeGreaterThan(arcade.rect.z0); expect(ar.z).toBeLessThan(arcade.rect.z1);
    expect(ar.floorY).toBe(L.levels[fl.level ?? 0].baseY);
    expect(ar.y).toBeCloseTo(ar.floorY! + SKYWAYS_DEST_AUDIO.arcade.lift, 6);
    expect(ar.range).toBeGreaterThan(Math.hypot(fx1 - fx0, fz1 - fz0) / 2);
    // projector: inside the auditorium (zones[0]), 0.6 m from the wall toward the cinema's lobby (its front side), centred along it,
    // under the auditorium ceiling, gated to its storey, range over the whole auditorium
    const pr = em.find(e => e.cue === 'projectorRun')!, au = L.areas[cinema.zones[0]];
    expect(au.label).toMatch(/^Auditorium/);
    const ax0 = au.x * CELL, az0 = au.y * CELL, ax1 = (au.x + au.w) * CELL, az1 = (au.y + au.h) * CELL;
    expect(pr.x).toBeGreaterThanOrEqual(ax0); expect(pr.x).toBeLessThanOrEqual(ax1);
    expect(pr.z).toBeGreaterThanOrEqual(az0); expect(pr.z).toBeLessThanOrEqual(az1);
    const wall = {N: pr.z - az0, S: az1 - pr.z, W: pr.x - ax0, E: ax1 - pr.x}[cinema.front];
    expect(wall).toBeCloseTo(SKYWAYS_DEST_AUDIO.projector.inset, 3);
    const along = cinema.front === 'N' || cinema.front === 'S' ? [pr.x, (ax0 + ax1) / 2] : [pr.z, (az0 + az1) / 2];
    expect(along[0]).toBeCloseTo(along[1], 3);
    // the lobby (the cinema's sales floor) lies beyond that wall; the far wall (the screen's) is the opposite side
    const lf = L.areas[cinema.floor], lz = (lf.y + lf.h / 2) * CELL, lx = (lf.x + lf.w / 2) * CELL;
    const toLobby = {N: lz < az0, S: lz > az1, W: lx < ax0, E: lx > ax1}[cinema.front];
    expect(toLobby).toBe(true);
    expect(pr.floorY).toBe(L.levels[au.level ?? 0].baseY);
    expect(pr.y).toBeLessThan(au.ceil);
    expect(pr.y - pr.floorY!).toBeGreaterThan(1.2);
    expect(pr.range).toBeGreaterThanOrEqual(Math.max(ax1 - ax0, az1 - az0));
    // every emitter is a valid LOCATION_AUDIO emitter
    for (const e of em) { expect(e.gain).toBeGreaterThan(0); expect(e.range).toBeGreaterThan(0); expect([e.x, e.y, e.z].every(Number.isFinite)).toBe(true); }
  });

  it('inert elsewhere: a Skyways map without these destinations, a layout without layout.skyways; the section hook sets / clears', () => {
    expect(skywaysLocationEmitters(gen(SEED_NONE))).toEqual([]);
    expect(skywaysLocationEmitters({areas: [], levels: [], skyways: undefined})).toEqual([]);
    const got: (readonly LocationEmitter[])[] = [];
    const host = {sectionHooks: [] as {build?(l: StationLayout): void; teardown?(): void}[], sfx: {setLocationEmitters: (l: readonly LocationEmitter[]) => { got.push(l); }}};
    installSkywaysDestAudio(host);
    expect(host.sectionHooks).toHaveLength(1);
    host.sectionHooks[0].build!(gen(SEED_ALL));
    host.sectionHooks[0].teardown!();
    host.sectionHooks[0].build!(gen(SEED_NONE));
    expect(got.map(l => l.length)).toEqual([3, 0, 0]);
  });
});

describe('Skyways destinations: the location channels (fake WebAudio)', () => {
  const E = (x: number, cue: LocationEmitter['cue'], o: Partial<LocationEmitter> = {}): LocationEmitter => ({x, y: 1.2, z: 0, cue, gain: 1, range: 20, ...o});

  it('starts a loop through a panner on the ambient bus when in range, eases it with distance, fades and stops it out of range', async () => {
    const {sfx, ctx, srcsOf} = await setup();
    const before = ctx.started.length;
    sfx.setLocationEmitters([E(10, 'arcadeAttract')]);
    step(sfx, ctx, {x: 60, y: 1.6, z: 0}); // out of range: nothing
    expect(ctx.started.length).toBe(before);
    expect(sfx.locationAudioState()).toMatchObject({emitters: 1, sounding: []});
    step(sfx, ctx, {x: 4, y: 1.6, z: 0});
    const [s] = srcsOf('arcadeAttract');
    expect(s).toBeTruthy();
    expect(s.loop).toBe(true);
    expect(sfx.locationAudioState().sounding).toEqual(['arcadeAttract']);
    const pan = pannerOf(s);
    expect([pan.positionX.value, pan.positionY.value, pan.positionZ.value]).toEqual([10, 1.2, 0]);
    expect(pan.refDistance).toBe(LOCATION_AUDIO.ref.arcadeAttract);
    // the chain ends on the ambient bus (a gain into the page master), never straight into the master
    const bus = pan.outputs[0] as unknown as Node & {gain: {value: number}};
    expect(bus.outputs).toHaveLength(1);
    const near = gainOf(s);
    expect(near).toBeCloseTo(CUE_GAIN.arcadeAttract, 6); // well inside the range: the full mix level
    step(sfx, ctx, {x: 26, y: 1.6, z: 0}); // 16 m: inside the last quarter of the 20 m range -> the edge fade
    expect(gainOf(s)).toBeLessThan(near);
    expect(gainOf(s)).toBeGreaterThan(0);
    const st = stops(s);
    step(sfx, ctx, {x: 60, y: 1.6, z: 0});
    expect(gainOf(s)).toBe(0);
    expect(st.length).toBe(1);
    expect(sfx.locationAudioState()).toMatchObject({sounding: [], fading: 1, starts: 1, stops: 1});
    for (let k = 0; k < 8; k++) step(sfx, ctx, {x: 60, y: 1.6, z: 0});
    expect(sfx.locationAudioState().fading).toBe(0); // released after its fade
    expect(ctx.oscillatorCalls).toBe(0);
  });

  it('the nearest two in range sound; never more than two sounding + two fading; walking between them hands over', async () => {
    const {sfx, ctx} = await setup();
    sfx.setLocationEmitters([E(0, 'arcadeAttract'), E(6, 'projectorRun'), E(12, 'clockTick'), E(40, 'arcadeAttract')]);
    step(sfx, ctx, {x: 1, y: 1.6, z: 0});
    expect(sfx.locationAudioState().sounding.sort()).toEqual(['arcadeAttract', 'projectorRun']);
    let maxCh = 0;
    for (let k = 0; k < 60; k++) {
      step(sfx, ctx, {x: k % 2 ? 1 : 30, y: 1.6, z: 0}, 0.05);
      const s = sfx.locationAudioState();
      expect(s.sounding.length).toBeLessThanOrEqual(LOCATION_AUDIO.voices);
      expect(s.fading).toBeLessThanOrEqual(LOCATION_AUDIO.voices);
      maxCh = Math.max(maxCh, s.sounding.length + s.fading);
    }
    expect(maxCh).toBeLessThanOrEqual(2 * LOCATION_AUDIO.voices);
    expect(sfx.locationAudioState().cuts).toBeGreaterThan(0); // the bound actually bit
    step(sfx, ctx, {x: 30, y: 1.6, z: 0});
    expect(sfx.locationAudioState().sounding.sort()).toEqual(['arcadeAttract', 'clockTick']); // x 12 and x 40
  });

  it('a storey gate: an emitter with a floor is silent from another storey; without one (the atrium clock) it is not', async () => {
    const {sfx, ctx} = await setup();
    sfx.setLocationEmitters([E(3, 'projectorRun', {floorY: 0}), E(-3, 'clockTick', {y: 3, z: 0})]);
    step(sfx, ctx, {x: 0, y: 1.6, z: 0});
    expect(sfx.locationAudioState().sounding.sort()).toEqual(['clockTick', 'projectorRun']);
    step(sfx, ctx, {x: 0, y: 6.6, z: 0}); // the storey above (feet 5 m up)
    expect(sfx.locationAudioState().sounding).toEqual(['clockTick']);
  });

  it('missing / still-decoding clips stay silent without counting silent plays per tick; invalid emitters are dropped', async () => {
    const {sfx, ctx} = await setup(['rifleShot']);
    const n0 = ctx.started.length;
    sfx.setLocationEmitters([E(2, 'arcadeAttract'), {...E(2, 'projectorRun'), range: Number.NaN}, {...E(2, 'clockTick'), cue: 'nope' as never}]);
    expect(sfx.locationAudioState().emitters).toBe(1);
    for (let k = 0; k < 5; k++) step(sfx, ctx, {x: 0, y: 1.6, z: 0});
    expect(ctx.started.length).toBe(n0);
    expect(sfx.debugState().bank.silentPlays).toBe(0);
  });

  it('the clock chime: first strike 6-14 s after arriving, then every 60-90 s of in-range time; frozen out of range and while paused; seeded', async () => {
    const {sfx, ctx, srcsOf} = await setup();
    const clock = E(0, 'clockTick', {y: 4.6, range: 26});
    sfx.setLocationEmitters([clock]);
    const first = sfx.locationAudioState().chimeIn;
    expect(first).toBeGreaterThanOrEqual(LOCATION_AUDIO.chime.firstS[0]);
    expect(first).toBeLessThanOrEqual(LOCATION_AUDIO.chime.firstS[1]);
    const strikes: number[] = [];
    const run = (seconds: number, p: {x: number; y: number; z: number}) => {
      for (let t = 0; t < seconds; t += 0.25) { const c0 = sfx.locationAudioState().chimes; step(sfx, ctx, p); if (sfx.locationAudioState().chimes > c0) strikes.push(ctx.currentTime); }
    };
    const t0 = ctx.currentTime;
    run(320, {x: 8, y: 1.6, z: 0}); // in the court (8 m from the clock)
    expect(strikes.length).toBeGreaterThanOrEqual(4);
    expect(strikes[0] - t0).toBeGreaterThanOrEqual(LOCATION_AUDIO.chime.firstS[0]);
    expect(strikes[0] - t0).toBeLessThanOrEqual(LOCATION_AUDIO.chime.firstS[1] + 0.5);
    for (let i = 1; i < strikes.length; i++) {
      expect(strikes[i] - strikes[i - 1]).toBeGreaterThanOrEqual(LOCATION_AUDIO.chime.minS - 0.3);
      expect(strikes[i] - strikes[i - 1]).toBeLessThanOrEqual(LOCATION_AUDIO.chime.maxS + 0.3);
    }
    // each strike: one clockChime one-shot positioned at the clock
    const chimes = srcsOf('clockChime');
    expect(chimes).toHaveLength(strikes.length);
    expect(chimes.every(s => s.loop === false)).toBe(true);
    const cp = pannerOf(chimes[0]);
    expect([cp.positionX.value, cp.positionY.value, cp.positionZ.value]).toEqual([0, 4.6, 0]);
    // out of the 25 m chime range: no strike, the countdown keeps its remainder
    const n = strikes.length, left = sfx.locationAudioState().chimeIn;
    run(200, {x: 40, y: 1.6, z: 0});
    expect(strikes.length).toBe(n);
    expect(sfx.locationAudioState().chimeIn).toBeCloseTo(left, 6);
    // paused (menu): nothing counts, nothing strikes; the loops ride the muted ambient bus
    sfx.suspend(true);
    await settle();
    run(200, {x: 8, y: 1.6, z: 0});
    expect(strikes.length).toBe(n);
    expect(sfx.locationAudioState().chimeIn).toBeCloseTo(left, 6);
    sfx.suspend(false);
    await settle();
    run(left + 0.75, {x: 8, y: 1.6, z: 0}); // the remainder runs out: exactly one strike (the next is >= 60 s on)
    expect(strikes.length).toBe(n + 1);
    // seeded: the same clock list gives the same countdown on another Sfx; a different clock another one
    const other = await setup();
    other.sfx.setLocationEmitters([clock]);
    expect(other.sfx.locationAudioState().chimeIn).toBe(first);
    other.sfx.setLocationEmitters([{...clock, x: 37.5}]);
    expect(other.sfx.locationAudioState().chimeIn).not.toBe(first);
    other.sfx.setLocationEmitters([E(0, 'arcadeAttract')]);
    expect(other.sfx.locationAudioState().chimeIn).toBe(Infinity); // no clock, no chime
  });

  it('a new section / world clears the emitters and releases the channels; the real layout list drives the right loops', async () => {
    const {sfx, ctx} = await setup();
    const em = skywaysLocationEmitters(gen(SEED_ALL));
    sfx.setLocationEmitters(em);
    const ar = em.find(e => e.cue === 'arcadeAttract')!, pr = em.find(e => e.cue === 'projectorRun')!;
    step(sfx, ctx, {x: ar.x, y: ar.floorY! + 1.6, z: ar.z});
    expect(sfx.locationAudioState().sounding).toContain('arcadeAttract');
    step(sfx, ctx, {x: pr.x, y: pr.floorY! + 1.6, z: pr.z});
    expect(sfx.locationAudioState().sounding).toContain('projectorRun');
    sfx.setWorld({occlusion: null});
    expect(sfx.locationAudioState()).toMatchObject({emitters: 0, sounding: []});
    step(sfx, ctx, {x: pr.x, y: pr.floorY! + 1.6, z: pr.z});
    expect(sfx.locationAudioState().sounding).toEqual([]);
    sfx.setLocationEmitters(em);
    step(sfx, ctx, {x: pr.x, y: pr.floorY! + 1.6, z: pr.z});
    expect(sfx.locationAudioState().sounding).toContain('projectorRun');
    sfx.setLocationEmitters([]);
    expect(sfx.locationAudioState()).toMatchObject({emitters: 0, sounding: []});
  });
});
