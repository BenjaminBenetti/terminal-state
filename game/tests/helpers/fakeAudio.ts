// Minimal fake WebAudio + fake Sound Lab clip bank for audio tests (Lane S, iteration 05).
// suspend() settles slower than resume() and the state flips when each op settles, so an
// overlapping pause -> resume completes OUT OF ORDER (the race Sfx must survive).
// createOscillator() THROWS: no cue may synthesise sound.

import {CUES, ClipBank, type Clip, type CueId} from '../../src/audio/bank';

export class Param { value = 0; setValueAtTime() { return this; } exponentialRampToValueAtTime() { return this; } linearRampToValueAtTime() { return this; } setTargetAtTime(v: number) { this.value = v; return this; } cancelScheduledValues() { return this; } }
export class Node {
  outputs: Node[] = [];
  kind = 'node';
  constructor(readonly context: FakeCtx) { context.nodes.push(this); }
  connect<T extends Node | Param>(n: T): T { if (n instanceof Node) this.outputs.push(n); return n; }
  disconnect() { this.outputs = []; }
}
export class Src extends Node {
  kind = 'source';
  buffer: unknown = null; loop = false; loopStart = 0; loopEnd = 0; playbackRate = new Param();
  onended: (() => void) | null = null;
  startArgs: number[] = [];
  start(...a: number[]) { this.startArgs = a; this.context.started.push(this); }
  stop() {}
}
export class Panner extends Node {
  kind = 'panner'; panningModel = ''; distanceModel = ''; refDistance = 1; rolloffFactor = 1; maxDistance = 1;
  positionX = new Param(); positionY = new Param(); positionZ = new Param();
}
export class Convolver extends Node { kind = 'convolver'; buffer: unknown = null; normalize = true; }

export interface FakeBuffer { length: number; numberOfChannels: number; sampleRate: number; duration: number; getChannelData(i: number): Float32Array }
export function fakeBuffer(seconds: number, sampleRate = 400, channels = 1, fill?: (i: number) => number): FakeBuffer {
  const len = Math.max(1, Math.round(seconds * sampleRate));
  const d = Array.from({length: channels}, () => Float32Array.from({length: len}, (_, i) => fill ? fill(i) : 0.5));
  return {length: len, numberOfChannels: channels, sampleRate, duration: len / sampleRate, getChannelData: (i: number) => d[i] ?? d[0]};
}

export class FakeCtx {
  state: 'suspended' | 'running' | 'closed' = 'suspended';
  currentTime = 0;
  sampleRate = 400;
  nodes: Node[] = [];
  started: Src[] = [];
  /** Buffers made by createBuffer (only reverb kernels may use it). */
  createdBuffers: FakeBuffer[] = [];
  oscillatorCalls = 0;
  destination = new Node(this);
  // Firefox-style listener: no AudioParams, only the legacy setters.
  listener = {pos: [0, 0, 0], setPosition(x: number, y: number, z: number) { this.pos = [x, y, z]; }, setOrientation() {}};
  private listeners: (() => void)[] = [];
  createGain() { return Object.assign(new Node(this), {gain: new Param()}); }
  createDynamicsCompressor() { return Object.assign(new Node(this), {threshold: new Param(), ratio: new Param()}); }
  createBiquadFilter() { return Object.assign(new Node(this), {type: '', frequency: new Param(), Q: new Param()}); }
  createStereoPanner() { return Object.assign(new Node(this), {pan: new Param()}); }
  createPanner() { return new Panner(this); }
  createConvolver() { return new Convolver(this); }
  createDelay() { return Object.assign(new Node(this), {delayTime: new Param()}); }
  createBufferSource() { return new Src(this); }
  createOscillator(): never { this.oscillatorCalls++; throw new Error('createOscillator: synthesis is not allowed (Sound Lab clips only)'); }
  createBuffer(c: number, len: number, sr = this.sampleRate) { const b = fakeBuffer(len / sr, sr, c, () => 0); this.createdBuffers.push(b); return b; }
  addEventListener(type: string, f: () => void) { if (type === 'statechange') this.listeners.push(f); }
  resume() { return this.op('running', 1); }
  suspend() { return this.op('suspended', 6); }
  private op(s: 'running' | 'suspended', ms: number): Promise<void> {
    return new Promise(r => setTimeout(() => { if (this.state !== s) { this.state = s; this.listeners.forEach(f => f()); } r(); }, ms));
  }
}

const LOOP_CUES = new Set<CueId>(['bedWind', 'bedRumble', 'bedHvac', 'bedFridge', 'bedBuzz']);

/** A decoded-looking bank: every cue (or the given ones) gets `variants` fake clips. */
export function fakeBank(opts: {variants?: number; only?: readonly CueId[]} = {}): {bank: ClipBank; buffers: Set<unknown>} {
  const buffers = new Set<unknown>();
  const clips: Partial<Record<CueId, Clip[]>> = {};
  for (const cue of opts.only ?? CUES) {
    clips[cue] = Array.from({length: opts.variants ?? 2}, (_, i) => {
      const loop = LOOP_CUES.has(cue);
      const buffer = fakeBuffer(loop ? 10.6 : 0.5) as unknown as AudioBuffer;
      buffers.add(buffer);
      return loop ? {buffer, offset: 0.01, dur: 10.6, loopStart: 0.31, loopEnd: 10.31, src: `${cue}-${i}`} : {buffer, offset: 0.01, dur: 0.45, src: `${cue}-${i}`};
    });
  }
  return {bank: ClipBank.fromClips(clips), buffers};
}
