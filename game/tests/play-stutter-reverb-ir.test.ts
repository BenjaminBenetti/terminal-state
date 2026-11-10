// Task studio-perf-ao-train-continuity-20261110-022206-01 (lane PLAY): the reverb room kernels are generated in bounded slices
// from audio start (audio/reverb.ts startIR, Sfx.irSlice) instead of one whole kernel per timer task / per first use of a room.
// Pinned here: the sliced kernels are makeIR's bit for bit on every room kind at 44.1 and 48 kHz whatever the slice sizes; a slice
// writes at most IR_SLICE_SAMPLES noise samples and there is one slice per timer task; after the slices ran every kind is ready and
// a room change neither creates a buffer nor generates; a kind needed before its slices are done is finished at once (counted) and
// is still identical. (Node only: the browser's own cost of assigning a buffer to a ConvolverNode is not visible here.)
import {describe, expect, it} from 'vitest';
import {ROOMS, Sfx, type RoomKind} from '../src/audio/sfx';
import {IR_SLICE_SAMPLES, makeIR, startIR} from '../src/audio/reverb';
import {FakeCtx, fakeBank, type FakeBuffer} from './helpers/fakeAudio';

const KINDS = Object.keys(ROOMS) as RoomKind[];
const RATES = [44100, 48000];

function ctxAt(sampleRate: number): FakeCtx {
  const c = new FakeCtx();
  c.sampleRate = sampleRate;
  return c;
}
const audio = (c: FakeCtx) => c as unknown as BaseAudioContext;
/** The reference kernel of a kind (makeIR, unchanged) on its own context. */
const reference = (kind: RoomKind, sampleRate: number) => makeIR(audio(ctxAt(sampleRate)), ROOMS[kind]) as unknown as FakeBuffer;
const samplesOf = (kind: RoomKind, sampleRate: number) => Math.max(16, Math.floor(ROOMS[kind].len * sampleRate));
const slicesOf = (kind: RoomKind, sampleRate: number) => Math.ceil(2 * samplesOf(kind, sampleRate) / IR_SLICE_SAMPLES);

/** Bit-for-bit equality of two kernels (length, channels and every sample's bytes). */
function sameBits(a: FakeBuffer, b: FakeBuffer): boolean {
  if (a.length !== b.length || a.numberOfChannels !== b.numberOfChannels || a.sampleRate !== b.sampleRate) return false;
  for (let c = 0; c < a.numberOfChannels; c++) {
    const x = a.getChannelData(c), y = b.getChannelData(c);
    if (!Buffer.from(x.buffer, x.byteOffset, x.byteLength).equals(Buffer.from(y.buffer, y.byteOffset, y.byteLength))) return false;
  }
  return true;
}

/** An Sfx on a fake context at `sampleRate` whose kernel slices run only when the test runs them. */
function makeSfx(sampleRate: number) {
  const ctx = ctxAt(sampleRate);
  const sfx = new Sfx(() => ctx as unknown as AudioContext, fakeBank().bank);
  const timers: {fn: () => void; ms: number}[] = [];
  sfx.irTimer = (fn, ms) => { timers.push({fn, ms}); };
  /** Runs the next timer task; false when none is waiting. */
  const tick = (): boolean => { const t = timers.shift(); if (!t) return false; t.fn(); return true; };
  const convolverBuffers = () => ctx.nodes.filter(n => n.kind === 'convolver').map(n => (n as unknown as {buffer: FakeBuffer | null}).buffer);
  return {sfx, ctx, timers, tick, convolverBuffers};
}

describe('sliced reverb kernels (audio/reverb.ts startIR)', () => {
  it('are makeIR bit for bit on every room kind at 44.1 and 48 kHz, in slices of at most IR_SLICE_SAMPLES', () => {
    for (const sr of RATES) for (const kind of KINDS) {
      const ref = reference(kind, sr);
      const job = startIR(audio(ctxAt(sr)), ROOMS[kind]);
      expect(job.total, `${kind} ${sr}`).toBe(2 * samplesOf(kind, sr));
      let slices = 0, done = false;
      while (!done) {
        const before = job.written;
        expect(job.done).toBe(false);
        done = job.step();
        slices++;
        expect(job.written - before, `${kind} ${sr} slice ${slices}`).toBeLessThanOrEqual(IR_SLICE_SAMPLES);
        expect(job.written - before).toBeGreaterThan(0);
      }
      expect(job.done).toBe(true);
      expect(job.written).toBe(job.total);
      expect(slices, `${kind} ${sr}`).toBe(slicesOf(kind, sr));
      expect(sameBits(job.buffer as unknown as FakeBuffer, ref), `${kind} ${sr}`).toBe(true);
      expect(job.step()).toBe(true); // (a finished job stays finished and writes nothing more)
      expect(sameBits(job.buffer as unknown as FakeBuffer, ref)).toBe(true);
    }
  });

  it('do not depend on where the slices fall (odd sizes, a slice ending on a channel boundary, one slice for everything)', () => {
    const sr = 48000;
    for (const kind of KINDS) {
      const ref = reference(kind, sr), n = samplesOf(kind, sr);
      for (const size of [977, 4096, n, n + 1, 2 * n, 10 * n]) {
        const job = startIR(audio(ctxAt(sr)), ROOMS[kind]);
        let steps = 0;
        while (!job.step(size)) steps++;
        expect(steps + 1, `${kind} slice ${size}`).toBe(Math.ceil(2 * n / size));
        expect(sameBits(job.buffer as unknown as FakeBuffer, ref), `${kind} slice ${size}`).toBe(true);
      }
    }
    // an unfinished kernel is not the reference yet (the comparison above is not vacuous)
    const part = startIR(audio(ctxAt(sr)), ROOMS.tunnel);
    part.step();
    expect(sameBits(part.buffer as unknown as FakeBuffer, reference('tunnel', sr))).toBe(false);
  });
});

describe('Sfx pre-generates every room kernel in slices from audio start', () => {
  it('one slice per timer task; then every kind is ready, identical, and a room change generates nothing', () => {
    for (const sr of RATES) {
      const {sfx, ctx, timers, tick, convolverBuffers} = makeSfx(sr);
      expect(sfx.debugState().ir).toEqual({ready: 0, pending: 0, slices: 0, sync: 0});
      sfx.init();
      // audio start: the current room's kernel is needed by the convolver at once (as before), the other three wait for their slices
      expect(sfx.debugState().ir).toEqual({ready: 1, pending: 3, slices: 0, sync: 1});
      expect(ctx.createdBuffers.length).toBe(1);
      expect(timers.map(t => t.ms)).toEqual([30]);
      let tasks = 0;
      while (timers.length) {
        expect(timers.length).toBe(1); // never two slices waiting: they cannot pile up in one frame
        const slices = sfx.debugState().ir.slices;
        tick();
        tasks++;
        expect(sfx.debugState().ir.slices).toBe(slices + 1);
        if (timers.length) expect(timers[0].ms).toBe(16);
      }
      expect(tasks).toBe(slicesOf('tunnel', sr) + slicesOf('large', sr) + slicesOf('small', sr));
      expect(sfx.debugState().ir).toEqual({ready: 4, pending: 0, slices: tasks, sync: 1});
      // the four kernels, in the order they were started, are makeIR's
      const order: RoomKind[] = ['medium', 'tunnel', 'large', 'small'];
      expect(ctx.createdBuffers.length).toBe(4);
      order.forEach((kind, i) => expect(sameBits(ctx.createdBuffers[i], reference(kind, sr)), `${kind} ${sr}`).toBe(true));

      // play: room changes over every kind only swap the ready buffers
      const byKind = new Map(order.map((kind, i) => [kind, ctx.createdBuffers[i]]));
      for (let round = 0; round < 3; round++) for (const kind of ['tunnel', 'small', 'large', 'medium', 'small', 'tunnel', 'medium', 'large'] as RoomKind[]) {
        sfx.setRoom(kind, 'platform');
        expect(convolverBuffers()).toContain(byKind.get(kind));
      }
      expect(ctx.createdBuffers.length).toBe(4);
      expect(timers.length).toBe(0);
      expect(sfx.debugState().ir).toEqual({ready: 4, pending: 0, slices: tasks, sync: 1});
      expect(sfx.debugState().convolvers).toBe(2);
    }
  });

  it('a kind needed while its slices are under way is finished at once, counted and identical; the rest goes on in slices', () => {
    const sr = 48000;
    const {sfx, ctx, timers, tick, convolverBuffers} = makeSfx(sr);
    sfx.init();
    for (let i = 0; i < 3; i++) tick(); // the tunnel kernel is under way (3 of its slices)
    expect(slicesOf('tunnel', sr)).toBeGreaterThan(4);
    expect(sfx.debugState().ir).toEqual({ready: 1, pending: 3, slices: 3, sync: 1});
    sfx.setRoom('tunnel', 'platform');
    expect(sfx.debugState().ir).toEqual({ready: 2, pending: 2, slices: 3, sync: 2});
    expect(ctx.createdBuffers.length).toBe(2); // the kernel under way was finished, not started again
    expect(sameBits(ctx.createdBuffers[1], reference('tunnel', sr))).toBe(true);
    expect(convolverBuffers()).toContain(ctx.createdBuffers[1]);
    // a kind whose slices have not started yet, while another kernel is under way
    tick(); // large under way
    sfx.setRoom('small', 'supply-closet');
    expect(sfx.debugState().ir).toEqual({ready: 3, pending: 1, slices: 4, sync: 3});
    expect(sameBits(ctx.createdBuffers[3], reference('small', sr))).toBe(true);
    expect(convolverBuffers()).toContain(ctx.createdBuffers[3]);
    let tasks = 4;
    while (tick()) tasks++;
    expect(tasks).toBe(3 + slicesOf('large', sr)); // (tunnel: 3 slices before it was needed; small: none)
    expect(sfx.debugState().ir).toEqual({ready: 4, pending: 0, slices: tasks, sync: 3});
    expect(ctx.createdBuffers.length).toBe(4);
    expect(sameBits(ctx.createdBuffers[2], reference('large', sr))).toBe(true);
    expect(sameBits(ctx.createdBuffers[0], reference('medium', sr))).toBe(true);
    expect(timers.length).toBe(0);
    for (const kind of KINDS) sfx.setRoom(kind, 'platform');
    expect(ctx.createdBuffers.length).toBe(4);
    expect(sfx.debugState().ir.sync).toBe(3);
  });

  it('a room chosen before audio starts is the one built first; the other three follow in slices', () => {
    const sr = 44100;
    const {sfx, ctx, tick} = makeSfx(sr);
    sfx.setRoom('large', 'track'); // (no context yet: only remembered)
    sfx.init();
    expect(sfx.debugState().ir).toEqual({ready: 1, pending: 3, slices: 0, sync: 1});
    expect(sameBits(ctx.createdBuffers[0], reference('large', sr))).toBe(true);
    let tasks = 0;
    while (tick()) tasks++;
    expect(tasks).toBe(slicesOf('tunnel', sr) + slicesOf('small', sr) + slicesOf('medium', sr));
    expect(sfx.debugState().ir).toEqual({ready: 4, pending: 0, slices: tasks, sync: 1});
    (['tunnel', 'small', 'medium'] as RoomKind[]).forEach((kind, i) => expect(sameBits(ctx.createdBuffers[i + 1], reference(kind, sr)), kind).toBe(true));
  });

  it('runs on real timers by default (no injected timer): every kind ready shortly after audio start', async () => {
    const ctx = new FakeCtx(); // 400 Hz: each kernel is one slice
    const sfx = new Sfx(() => ctx as unknown as AudioContext, fakeBank().bank);
    sfx.init();
    expect(sfx.debugState().ir).toMatchObject({ready: 1, sync: 1});
    for (let i = 0; i < 100 && sfx.debugState().ir.ready < 4; i++) await new Promise(r => setTimeout(r, 20));
    expect(sfx.debugState().ir).toEqual({ready: 4, pending: 0, slices: 3, sync: 1});
    expect(ctx.createdBuffers.length).toBe(4);
  });
});
