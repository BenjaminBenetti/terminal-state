// Task studio-flamethrower-fire-20261114-031614-01 (lane AUDIO): the FLAMETHROWER's and the FIRE's sound — the seven Sound Lab cues'
// registration (bank CUES / manifest / CUE_GAIN = the build's mix calibration / hash-only provenance / notice / credits / allowlist) and
// audio/flameAudio.ts (fire/sound.ts FlameSound) over a fake machine Sfx (press / release / tapping, the fire beds' assignment and
// release, a flickering fire list, the catch / collapse cues, the refill's cancel, silence, the re-request after a world change or an
// eviction) and over the real Sfx on the fake WebAudio context (the roar's `keep`, the cut ignition, the bounded pour). Nothing here
// listens to the clips.
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, expect, it} from 'vitest';
import {FLAME_AUDIO, FlameAudio} from '../src/audio/flameAudio';
import {CLIP_MANIFEST, CUES} from '../src/audio/bank';
import {CUE_GAIN, MACHINE_LOOP, Sfx, type MachineCue, type MachineLoopCue} from '../src/audio/sfx';
import {CLIP_BYTES_FIRE, CLIP_GAPS_FIRE, CLIP_MANIFEST_FIRE, FIRE_CUES, FIRE_CUE_GAIN} from '../src/audio/manifest.fire.generated';
import {FIRE_VOICES, type FireVoice, type FlameSound} from '../src/fire/sound';
import {FakeCtx, fakeBank} from './helpers/fakeAudio';

const GAME = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = path.resolve(GAME, '..');
const LOOPS = new Set<string>(['flameRoar', 'fireBurn']);
const settle = () => new Promise(r => setTimeout(r, 40));
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const prov = JSON.parse(fs.readFileSync(path.join(GAME, 'public/assets/derivatives/audio-fire.json'), 'utf8'));
const J = FLAME_AUDIO.jet, F = FLAME_AUDIO.fire;

describe('flame / fire cues: registration', () => {
  it('every cue of the set is a bank cue with its clips, the build\'s mix gain and a place in the Sfx API', () => {
    const loopCues: MachineLoopCue[] = ['flameRoar', 'fireBurn'];
    const oneShots: MachineCue[] = ['flameOut', 'fireCatch', 'fireCollapse', 'fireEmbers'];
    expect([...loopCues, ...oneShots, 'flameIgnite'].sort()).toEqual([...FIRE_CUES].sort()); // flameIgnite: Sfx.flameIgnite (it can be cut)
    expect(Object.keys(CLIP_MANIFEST_FIRE)).toEqual([...FIRE_CUES]);
    expect(CLIP_GAPS_FIRE).toEqual([]);
    const at = (CUES as readonly string[]).indexOf(FIRE_CUES[0]);
    expect((CUES as readonly string[]).slice(at, at + FIRE_CUES.length)).toEqual([...FIRE_CUES]); // one block of the decode order
    let bytes = 0;
    for (const cue of FIRE_CUES) {
      expect(CLIP_MANIFEST[cue]).toEqual(CLIP_MANIFEST_FIRE[cue]);
      expect(CLIP_MANIFEST[cue].length).toBe(LOOPS.has(cue) ? 1 : prov.mixCalibration.cues[cue].variants);
      for (const ref of CLIP_MANIFEST[cue]) {
        expect(ref.url).toMatch(/^assets\/audio\/fire-[a-z0-9-]+\.mp3$/);
        if (LOOPS.has(cue)) expect(ref.loop!.length).toBeGreaterThan(5); // the >= 5 s bed rule (audio-bank.test)
        else expect(ref.loop).toBeUndefined();
        bytes += fs.statSync(path.join(GAME, 'public', ref.url)).size;
      }
      expect(CUE_GAIN[cue]).toBeGreaterThan(0);
      expect(CUE_GAIN[cue]).toBeLessThanOrEqual(1);
      expect(CUE_GAIN[cue]).toBe(FIRE_CUE_GAIN[cue]);
      expect(CUE_GAIN[cue]).toBe(prov.mixCalibration.cues[cue].cueGain); // the build's loudness calibration is the mix
    }
    expect(bytes).toBe(CLIP_BYTES_FIRE);
    expect(bytes).toBeLessThan(260 * 1024);
    // a full Reactor (10) + the chipper's two + the roar + FIRE_VOICES fire beds never evict back and forth
    expect(MACHINE_LOOP.max).toBeGreaterThanOrEqual(12 + 1 + FIRE_VOICES);
  });

  it('shadows no cue of another build (no other generated manifest names one of these cues)', () => {
    const dir = path.join(GAME, 'src/audio');
    const others = fs.readdirSync(dir).filter(f => /^manifest\..*generated\.ts$/.test(f) && f !== 'manifest.fire.generated.ts');
    expect(others.length).toBeGreaterThan(15);
    for (const f of others) {
      const text = fs.readFileSync(path.join(dir, f), 'utf8');
      for (const cue of FIRE_CUES) expect(new RegExp(`^\\s*['"]?${cue}['"]?\\s*[:,]`, 'm').test(text), `${f}: ${cue}`).toBe(false);
    }
  });

  it('the mix sits where the build says: at its targets, the roar under the enemy vocals and at the chipper\'s close-range level', () => {
    const mc = prov.mixCalibration, c = mc.cues;
    for (const cue of FIRE_CUES) {
      expect(c[cue].atSourcePeakDbfs).toBeLessThanOrEqual(-1);
      if (c[cue].cueGain < 1) expect(Math.abs(c[cue].atSourceLufs - c[cue].targetLufs)).toBeLessThanOrEqual(0.15);
      else expect(c[cue].atSourceLufs).toBeLessThanOrEqual(c[cue].targetLufs + 0.15); // never boosted
    }
    expect(mc.references.zombieGroan - c.flameRoar.atSourceLufs).toBeGreaterThanOrEqual(4); // enemy vocals stay over the held roar
    expect(mc.references.zombieAttack - c.flameRoar.atSourceLufs).toBeGreaterThanOrEqual(3);
    expect(Math.abs(c.flameRoar.atSourceLufs - mc.references.chipperGrind)).toBeLessThanOrEqual(2);
    expect(Math.abs(c.fireBurn.atSourceLufs - mc.references.chipperMotor)).toBeLessThanOrEqual(1);
    expect(c.fireBurn.atSourceLufs).toBeLessThan(c.flameRoar.atSourceLufs); // one fire's bed under the jet
    // the hand-overs around the roar loop: the ignition's roaring part and the cut-off's start within a few dB of the loop
    for (const v of mc.handover.igniteHoldRmsDbfs) expect(Math.abs(v - mc.handover.roarRmsDbfs)).toBeLessThanOrEqual(3);
    for (const v of mc.handover.outStartRmsDbfs) expect(Math.abs(v - mc.handover.roarRmsDbfs)).toBeLessThanOrEqual(3);
  });

  it('provenance is hash-only (no prompt text, no private path), whole seconds, not auditioned, conditional licence; every job accounted for', () => {
    expect(prov).toMatchObject({asset: 'audio-fire-20261114', task: 'studio-flamethrower-fire-20261114-031614-01'});
    expect(prov.derivatives).toHaveLength(Object.values(CLIP_MANIFEST_FIRE).reduce((s, v) => s + v.length, 0));
    expect(prov.soundLab).toEqual({jobs: prov.derivatives.length + prov.notUsedRaws.length, accepted: prov.derivatives.length, rejected: prov.notUsedRaws.length, spare: 0, numericCap: null, paidOrExternal: 0});
    expect(prov.license).toMatchObject({gameReady: false, approved: false});
    expect(prov.license.status).toMatch(/Conditional prototype/);
    expect(prov.license.review).toMatch(/^NOT LISTENED TO/);
    expect(JSON.stringify(prov)).not.toMatch(/TrackType|reference\/|\.wav|https?:/);
    const jobs = new Set<string>();
    for (const d of [...prov.derivatives, ...prov.notUsedRaws]) {
      const s = d.source ?? d;
      expect(Number.isInteger(s.seconds)).toBe(true);
      expect([s.prompt, s.rawFile]).toEqual([undefined, undefined]);
      expect(s.promptSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(s.rawSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(s.jobId).toMatch(/^\d{8}T\d{6}-\d+$/);
      jobs.add(s.jobId);
    }
    expect(jobs.size).toBe(prov.soundLab.jobs); // one take per job, none counted twice
    for (const r of prov.notUsedRaws) {
      expect(r.kind).toBe('rejected');
      expect(r.reason.length).toBeGreaterThanOrEqual(40);
    }
    // the ember layer is the collapse request's other take, shipped under its own cue (recorded, the plan is append-only)
    expect(prov.derivatives.filter((d: {askedAs?: string}) => d.askedAs).map((d: {cue: string; askedAs: string}) => [d.cue, d.askedAs])).toEqual([['fireEmbers', 'fireCollapse']]);
  });

  it('the bundled files are the provenance\'s (hash), pass their structural gate (loops: seam, steadiness — not the noise-wall rule) and are allowlisted', () => {
    const allow = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/release/public-inputs.json'), 'utf8')) as {files: {path: string; bytes: number; sha256: string}[]};
    const listed = new Map(allow.files.map(f => [f.path, f]));
    for (const d of prov.derivatives) {
      const buf = fs.readFileSync(path.join(GAME, 'public', d.url));
      expect(sha(buf), d.url).toBe(d.sha256);
      expect(listed.get(d.url)).toEqual({path: d.url, bytes: buf.length, sha256: d.sha256});
      expect(CLIP_MANIFEST_FIRE[d.cue].map(r => r.url)).toContain(d.url);
      expect(d.gate.pass, d.url).toBe(true);
      expect(d.metrics.peakDbfs).toBeLessThanOrEqual(-0.9);
      if (d.loop) {
        expect(d.loop).toEqual(CLIP_MANIFEST_FIRE[d.cue][0].loop);
        expect(d.seam.wrapOverP99).toBeLessThanOrEqual(1); // no click at the wrap
        expect(Math.abs(d.seam.levelJumpDb)).toBeLessThanOrEqual(Math.min(6, Math.max(3, d.seam.adjacentJumpP95Db))); // no level step at the wrap
        expect(d.gate.blockStdDb).toBeLessThanOrEqual(1.5); // steady: no surges, no fade
        expect(d.gate.noiseWallRule.applied).toBe(false); // a flame is steady broadband noise: the generic rule is recorded, not used
      } else expect(d.seam).toBeUndefined();
    }
    expect(allow.files.filter(f => /^assets\/audio\/fire-/.test(f.path)).map(f => f.path).sort()).toEqual(prov.derivatives.map((d: {url: string}) => d.url).sort());
    for (const p of ['assets/derivatives/audio-fire.json', 'assets/audio/NOTICE.md', 'assets/CREDITS.md']) {
      const buf = fs.readFileSync(path.join(GAME, 'public', p));
      expect(listed.get(p), p).toEqual({path: p, bytes: buf.length, sha256: sha(buf)});
    }
    const notice = fs.readFileSync(path.join(GAME, 'public/assets/audio/NOTICE.md'), 'utf8');
    expect(notice).toMatch(/the flamethrower and fire set \([^)]*fire-\*\.mp3[^)]*\): \.\.\/derivatives\/audio-fire\.json/);
    expect(notice).toMatch(/Powered by Stability AI/);
    expect(notice).toMatch(/conditional prototype status, not production or commercial clearance/);
    const credits = fs.readFileSync(path.join(GAME, 'public/assets/CREDITS.md'), 'utf8');
    const block = /<!-- BEGIN flamethrower-fire-audio-20261114[^>]*-->([\s\S]*?)<!-- END flamethrower-fire-audio-20261114 -->/.exec(credits)?.[1] ?? '';
    expect(block).toMatch(/conditional prototype status, not production or commercial clearance/);
    expect(block).toMatch(/Powered by Stability AI/);
    for (const d of prov.derivatives) expect(block).toContain(`\`${d.url}\``);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// FlameAudio over a fake machine Sfx

class FakeLoop {
  stopped = false;
  stopFade: number | null = null;
  stoppedAt = Infinity;
  setPosCalls = 0;
  pos: [number, number, number];
  level: number;
  levels: [number, number | undefined][] = [];
  constructor(private readonly clock: {t: number}, readonly cue: string, x: number, y: number, z: number, readonly opts: {ref?: number; far?: number; level?: number; keep?: boolean}) {
    this.pos = [x, y, z];
    this.level = opts.level ?? 1;
  }
  setPos(x: number, y: number, z: number) { this.pos = [x, y, z]; this.setPosCalls++; }
  stop(f?: number) { if (!this.stopped) { this.stopped = true; this.stopFade = f ?? null; this.stoppedAt = this.clock.t; } }
  setLevel(k: number, tau?: number) { this.level = k; this.levels.push([k, tau]); }
  setRate() {}
  get playing() { return !this.stopped; }
  /** Still making sound at the clock: running, or inside its fade (+ the Sfx's 0.05 s stop margin). */
  get alive() { return !this.stopped || this.clock.t < this.stoppedAt + (this.stopFade ?? 0) + 0.05; }
}
interface CueCall { cue: string; at: [number, number, number]; ref?: number; maxDist?: number; pri?: number; gain?: number; rate?: number; delay?: number }
class FakeSfx {
  live = true;
  cues: CueCall[] = [];
  loops: FakeLoop[] = [];
  igniteStops: number[] = [];
  pours: (number | undefined)[] = [];
  pourStops = 0;
  dries: string[] = [];
  constructor(readonly clock: {t: number}) {}
  private rec(cue: string, x: number, y: number, z: number, o: Omit<CueCall, 'cue' | 'at'>) { this.cues.push({cue, at: [x, y, z], ref: o.ref, maxDist: o.maxDist, pri: o.pri, gain: o.gain, rate: o.rate, delay: o.delay}); }
  reactorCue(cue: string, x: number, y: number, z: number, o: Omit<CueCall, 'cue' | 'at'> = {}) { this.rec(cue, x, y, z, o); }
  flameIgnite(x: number, y: number, z: number, o: Omit<CueCall, 'cue' | 'at'> = {}) { this.rec('flameIgnite', x, y, z, o); return 0.87; }
  stopFlameIgnite(f: number) { this.igniteStops.push(f); }
  reactorLoop(cue: string, x: number, y: number, z: number, o: {ref?: number; far?: number; level?: number; keep?: boolean} = {}) {
    if (!this.live) return null;
    const l = new FakeLoop(this.clock, cue, x, y, z, {...o});
    this.loops.push(l);
    return l;
  }
  fuelPour(maxS?: number) { this.pours.push(maxS); return Math.min(2.58, maxS ?? Infinity); }
  stopFuelPour() { this.pourStops++; }
  dry(kind: string) { this.dries.push(kind); }
  /** Sfx.setWorld -> stopMachines: every machine loop ends. */
  setWorld() { for (const l of this.loops) l.stop(0.05); }
  playing(cue: string) { return this.loops.filter(l => l.cue === cue && l.playing); }
  alive(cue: string) { return this.loops.filter(l => l.cue === cue && l.alive); }
  count(cue: string) { return this.cues.filter(c => c.cue === cue).length; }
}
const MUZZLE = {x: 1, y: 1.4, z: 1};
const fire = (x: number, z: number, level = 1): FireVoice => ({x, y: 0.3, z, level});
function rig() {
  const clock = {t: 100};
  const sfx = new FakeSfx(clock);
  const audio = new FlameAudio(sfx as unknown as Sfx, () => clock.t);
  const sound: FlameSound = audio; // the lead's interface
  /** Run frames at 60 Hz for `s` seconds (the muzzle while `stream`, the given burning places). */
  const run = (s: number, fires: readonly FireVoice[] = [], stream = false, each?: () => void) => {
    for (let i = 0; i < Math.round(s * 60); i++) { clock.t += 1 / 60; sound.frame(1 / 60, stream ? MUZZLE : null, fires); each?.(); }
  };
  return {sfx, clock, audio, sound, run};
}

describe('FlameAudio: the jet (fake machine Sfx)', () => {
  it('streamOn: ONE ignition at the muzzle and ONE roar loop, kept in the pool, brought up at once; a second streamOn is a no-op; the roar follows the muzzle', () => {
    const {sfx, sound, audio, clock} = rig();
    sound.streamOn(1, 1.4, 1);
    expect(sfx.cues).toEqual([{cue: 'flameIgnite', at: [1, 1.4, 1], ref: J.ref, maxDist: J.maxDist, pri: 2, gain: undefined, rate: undefined, delay: undefined}]);
    expect(sfx.loops).toHaveLength(1);
    const roar = sfx.loops[0];
    expect([roar.cue, roar.pos, roar.opts.keep, roar.opts.ref, roar.opts.far]).toEqual(['flameRoar', [1, 1.4, 1], true, J.ref, J.far]);
    expect(roar.levels).toEqual([[1, J.roarInTauS]]); // past the pool's 1.2 s fade-in
    expect(J.roarInTauS).toBeLessThan(MACHINE_LOOP.fadeIn / 10);
    sound.streamOn(1.1, 1.4, 1);
    for (let i = 0; i < 300; i++) { clock.t += 1 / 60; sound.frame(1 / 60, {x: 1 + i * 0.01, y: 1.4, z: 1}, []); }
    expect(sfx.loops).toHaveLength(1);
    expect(sfx.count('flameIgnite')).toBe(1);
    expect(roar.pos[0]).toBeCloseTo(3.99, 6);
    expect(roar.setPosCalls).toBe(300);
    expect(audio.debugState()).toMatchObject({streaming: true, roar: true, beds: 0, ignites: 1, roarRequests: 1});
  });

  it('streamOff: the roar fades fast, a sounding ignition is cut, the cut-off plays at the last muzzle (lower and slower when dry); a second streamOff is silent', () => {
    const {sfx, sound, run} = rig();
    sound.streamOn(1, 1.4, 1);
    run(1.5, [], true);
    sound.streamOff(false);
    const roar = sfx.loops[0];
    expect([roar.stopped, roar.stopFade]).toEqual([true, J.roarOutS]);
    expect(J.roarOutS).toBeLessThanOrEqual(0.15);
    expect(sfx.igniteStops).toEqual([J.igniteCutS]);
    expect(sfx.cues[1]).toEqual({cue: 'flameOut', at: [MUZZLE.x, MUZZLE.y, MUZZLE.z], ref: J.ref, maxDist: J.maxDist, pri: 2, gain: 1, rate: 1, delay: undefined});
    sound.streamOff(false);
    run(2);
    expect(sfx.count('flameOut')).toBe(1);
    expect(sfx.loops).toHaveLength(1); // nothing comes back
    sound.streamOn(1, 1.4, 1);
    run(0.5, [], true);
    sound.streamOff(true); // the tank ran dry under the trigger
    const out = sfx.cues[sfx.cues.length - 1];
    expect([out.cue, out.gain, out.rate]).toEqual(['flameOut', J.dry.gain, J.dry.rate]);
    expect(J.dry.gain).toBeLessThan(1);
    expect(J.dry.rate).toBeLessThan(1);
  });

  it('tapping the trigger at 4 a second: every press gets its ignition and its roar at once, every release its cut-off; one roar at a time', () => {
    const {sfx, sound, clock, audio} = rig();
    let maxPlaying = 0;
    for (let tap = 0; tap < 8; tap++) {
      sound.streamOn(1, 1.4, 1);
      expect(sfx.playing('flameRoar'), `press ${tap}`).toHaveLength(1);
      for (let i = 0; i < 7; i++) { clock.t += 1 / 60; sound.frame(1 / 60, MUZZLE, []); }
      sound.streamOff(false);
      for (let i = 0; i < 8; i++) { clock.t += 1 / 60; sound.frame(1 / 60, null, []); maxPlaying = Math.max(maxPlaying, sfx.playing('flameRoar').length); }
    }
    expect(maxPlaying).toBe(0);
    expect(audio.debugState()).toMatchObject({ignites: 8, outs: 8, roarRequests: 8, roar: false, streaming: false});
    expect(sfx.loops).toHaveLength(8);
  });

  it('a trigger toggled every frame for 3 s: never more than two roar loops exist, cues are rate-limited, nothing is left running', () => {
    const {sfx, sound, clock, audio, run} = rig();
    let maxAlive = 0;
    for (let i = 0; i < 180; i++) {
      clock.t += 1 / 60;
      if (i % 2 === 0) sound.streamOn(1, 1.4, 1); else sound.streamOff(i % 4 === 1);
      sound.frame(1 / 60, i % 2 === 0 ? MUZZLE : null, []);
      maxAlive = Math.max(maxAlive, sfx.alive('flameRoar').length);
    }
    sound.streamOff(false);
    expect(maxAlive).toBeLessThanOrEqual(2);
    const st = audio.debugState();
    expect(st.roarRequests).toBeLessThanOrEqual(Math.ceil(3 / J.roarGapS) + 1);
    expect(st.ignites).toBeLessThanOrEqual(Math.ceil(3 / J.igniteGapS) + 1);
    expect(st.outs).toBeLessThanOrEqual(Math.ceil(3 / J.outGapS) + 1);
    expect(st.roarRequests).toBeGreaterThan(3); // not silenced either
    run(1);
    expect(sfx.alive('flameRoar')).toHaveLength(0);
    expect(sfx.loops.every(l => l.stopped)).toBe(true);
  });

  it('a world change (Sfx.setWorld stops machine loops) or an eviction while the trigger is held: frame() brings the roar back — no second ignition, rate-limited', () => {
    const {sfx, sound, run, audio} = rig();
    sound.streamOn(1, 1.4, 1);
    run(2, [], true);
    sfx.setWorld();
    expect(sfx.playing('flameRoar')).toHaveLength(0);
    run(1 / 60, [], true);
    expect(sfx.playing('flameRoar')).toHaveLength(1);
    expect(sfx.playing('flameRoar')[0].levels).toEqual([[1, J.roarInTauS]]);
    expect(sfx.count('flameIgnite')).toBe(1);
    sfx.playing('flameRoar')[0].stop(0.4); // the pool made room right away
    run(J.retryS - 0.1, [], true);
    expect(sfx.playing('flameRoar')).toHaveLength(0); // not every frame
    run(0.2, [], true);
    expect(sfx.playing('flameRoar')).toHaveLength(1);
    expect(audio.debugState().roarRequests).toBe(3);
  });

  it('while audio is not running (paused / before the first gesture) the held roar is requested at most once per retryS, and comes up when audio does', () => {
    const {sfx, sound, run, audio} = rig();
    sfx.live = false;
    sound.streamOn(1, 1.4, 1);
    run(4, [fire(5, 5)], true);
    const st = audio.debugState();
    expect(st.roarRequests).toBeGreaterThan(1);
    expect(st.roarRequests).toBeLessThanOrEqual(Math.ceil(4 / J.retryS) + 1);
    expect(st.bedRequests).toBeLessThanOrEqual(Math.ceil(4 / F.retryS) + 1);
    sfx.live = true;
    run(Math.max(J.retryS, F.retryS) + 0.1, [fire(5, 5)], true);
    expect(sfx.playing('flameRoar')).toHaveLength(1);
    expect(sfx.playing('fireBurn')).toHaveLength(1);
  });
});

describe('FlameAudio: the fire beds (fake machine Sfx)', () => {
  it('each burning place gets ONE positional bed loop at its level; at most FIRE_VOICES; the same places keep their loops', () => {
    const {sfx, run, audio} = rig();
    run(1 / 60, [fire(5, 5, 1)]);
    expect(sfx.loops).toHaveLength(1);
    const a = sfx.loops[0];
    expect([a.cue, a.pos, a.opts.ref, a.opts.far, a.opts.keep, a.level]).toEqual(['fireBurn', [5, 0.3, 5], F.ref, F.far, undefined, 1]);
    run(1, [fire(5, 5, 1), fire(-6, 2, 0.5), fire(9, -8, 0.2), fire(20, 20, 1), fire(30, 30, 1)]); // more than the pool: the caller's first three
    expect(sfx.playing('fireBurn')).toHaveLength(FIRE_VOICES);
    expect(sfx.loops.map(l => l.pos)).toEqual([[5, 0.3, 5], [-6, 0.3, 2], [9, 0.3, -8]]);
    expect(sfx.loops[1].level).toBeCloseTo(F.floor + (1 - F.floor) * 0.5, 9);
    expect(sfx.loops[2].level).toBeCloseTo(F.floor + (1 - F.floor) * 0.2, 9);
    run(5, [fire(9, -8, 0.2), fire(5, 5, 1), fire(-6, 2, 0.5)]); // the list's order changes: nothing moves, nothing restarts
    expect(sfx.loops).toHaveLength(3);
    expect(sfx.loops.every(l => l.playing && l.setPosCalls === 0 && l.levels.length === 0)).toBe(true);
    expect(F.far).toBeGreaterThanOrEqual(18);
    expect(F.far).toBeLessThanOrEqual(25); // audible to about 20 m
    expect(audio.debugState()).toMatchObject({beds: 3, bedsOn: 3, bedRequests: 3, roar: false});
  });

  it('a fire that creeps (a neighbouring patch takes over) keeps its bed: the loop glides there; a changed level is eased, small changes are not sent', () => {
    const {sfx, run} = rig();
    run(0.5, [fire(5, 5, 0.6)]);
    const a = sfx.loops[0];
    run(2 / 60, [fire(6.5, 5.5, 0.6)]); // 1.6 m away: inside sameM
    expect(a.pos[0]).toBeGreaterThan(5.1);
    expect(a.pos[0]).toBeLessThan(5.6); // on its way: no jump across the gap
    run(1, [fire(6.5, 5.5, 0.6)]);
    expect(sfx.loops).toHaveLength(1);
    expect(a.setPosCalls).toBeGreaterThan(5);
    expect(a.pos[0]).toBeCloseTo(6.5, 1);
    expect(a.pos[2]).toBeCloseTo(5.5, 1);
    expect(a.levels).toEqual([]);
    run(0.2, [fire(6.5, 5.5, 0.61)]); // under levelStep
    expect(a.levels).toEqual([]);
    run(0.2, [fire(6.5, 5.5, 1)]);
    expect(a.levels).toEqual([[1, F.levelTauS]]);
  });

  it('a place that leaves the list: its bed fades and is released, the others play on; an empty list fades them all; nothing comes back', () => {
    const {sfx, run, audio} = rig();
    const A = fire(5, 5), B = fire(-6, 2), C = fire(9, -8);
    run(2, [A, B, C]);
    run(1 / 60, [A, C]);
    const [a, b, c] = sfx.loops;
    expect([b.stopped, b.stopFade]).toEqual([true, F.fadeS]);
    expect([a.playing, c.playing]).toEqual([true, true]);
    run(1, [A, C]);
    expect(sfx.loops).toHaveLength(3);
    run(1 / 60, []);
    expect(sfx.loops.every(l => l.stopped && l.stopFade === F.fadeS)).toBe(true);
    run(3, []);
    expect(sfx.loops).toHaveLength(3);
    expect(audio.debugState()).toMatchObject({beds: 0, bedsOn: 0});
  });

  it('a new place when every bed is taken: the bed of the place that left is released there and starts again at the new one', () => {
    const {sfx, run} = rig();
    const A = fire(5, 5), B = fire(-6, 2), C = fire(9, -8), D = fire(-15, -12);
    run(2, [A, B, C]);
    run(1 / 60, [A, B, D]);
    expect(sfx.loops).toHaveLength(4);
    const [a, b, c, d] = sfx.loops;
    expect([a.playing, b.playing, c.playing, d.playing]).toEqual([true, true, false, true]);
    expect(c.stopFade).toBe(F.fadeS);
    expect(d.pos).toEqual([-15, 0.3, -12]); // a new loop at the new place: the old one is not dragged across the room
    expect(c.setPosCalls).toBe(0);
  });

  it('a fire list that flips between two far-apart sets every frame for 5 s: loop requests stay bounded, never more than two loops per bed', () => {
    const {sfx, run, audio} = rig();
    const S1 = [fire(5, 5), fire(-6, 2), fire(9, -8)], S2 = [fire(40, 40), fire(-40, 40), fire(40, -40)];
    let i = 0, maxAlive = 0;
    for (let k = 0; k < 300; k++) { run(1 / 60, i++ % 2 ? S2 : S1); maxAlive = Math.max(maxAlive, sfx.alive('fireBurn').length); }
    expect(audio.debugState().bedRequests).toBeLessThanOrEqual(FIRE_VOICES * (Math.ceil(5 / F.retryS) + 1));
    expect(maxAlive).toBeLessThanOrEqual(2 * FIRE_VOICES);
    expect(F.fadeS).toBeLessThan(F.retryS); // why two per bed is the bound: a released loop is gone before its bed may ask again
    run(1 / 60, []);
    run(2, []);
    expect(sfx.alive('fireBurn')).toHaveLength(0);
  });

  it('a world change or an eviction: frame() re-requests the beds that should sound, at their places and levels, once per retryS', () => {
    const {sfx, run, audio} = rig();
    const A = fire(5, 5, 1), B = fire(-6, 2, 0.4);
    run(2, [A, B]);
    sfx.setWorld();
    run(1 / 60, [A, B]);
    expect(sfx.playing('fireBurn').map(l => [l.pos, +l.level.toFixed(3)])).toEqual([[[5, 0.3, 5], 1], [[-6, 0.3, 2], +(F.floor + (1 - F.floor) * 0.4).toFixed(3)]]);
    sfx.playing('fireBurn')[1].stop(0.4); // the bounded pool made room with an ordinary loop
    run(F.retryS - 0.1, [A, B]);
    expect(sfx.playing('fireBurn')).toHaveLength(1);
    run(0.2, [A, B]);
    expect(sfx.playing('fireBurn')).toHaveLength(2);
    expect(audio.debugState().bedRequests).toBe(5);
  });

  it('beds whose owner stopped calling frame() are released by the next call (the backstop of the "one empty frame" contract)', () => {
    const {sfx, sound, run, clock} = rig();
    run(1, [fire(5, 5), fire(-6, 2)]);
    clock.t += F.staleS / 2;
    sound.dry();
    expect(sfx.playing('fireBurn')).toHaveLength(2); // a short hitch is not a stop
    clock.t += F.staleS;
    sound.ignite(3, 0.5, 3);
    expect(sfx.playing('fireBurn')).toHaveLength(0);
    expect(sfx.loops.every(l => l.stopFade === F.fadeS)).toBe(true);
  });

  it('invalid burning places (non-finite, level 0) are not voiced', () => {
    const {sfx, run} = rig();
    run(1, [{x: Number.NaN, y: 0, z: 0, level: 1}, fire(5, 5, 0), {x: 1, y: 0, z: Infinity, level: 1}]);
    expect(sfx.loops).toHaveLength(0);
  });
});

describe('FlameAudio: catching fire, collapse, refill, dry click, silence (fake machine Sfx)', () => {
  it('ignite: the catch whoomp at the prop; burnOut: the heavy hit and the ember crackle layer over it', () => {
    const {sfx, sound} = rig();
    sound.ignite(4, 0.6, -2);
    expect(sfx.cues).toEqual([{cue: 'fireCatch', at: [4, 0.6, -2], ref: F.ref, maxDist: F.maxDist, pri: undefined, gain: undefined, rate: undefined, delay: 0}]);
    sound.burnOut(4, 0.6, -2);
    expect(sfx.cues.slice(1).map(c => [c.cue, c.at, c.delay])).toEqual([['fireCollapse', [4, 0.6, -2], 0], ['fireEmbers', [4, 0.6, -2], F.embersDelayS]]);
    expect(sfx.loops).toHaveLength(0);
    sound.ignite(Number.NaN, 0, 0);
    sound.burnOut(0, Infinity, 0);
    expect(sfx.cues).toHaveLength(3);
  });

  it('several props catching (or caving in) in one frame are staggered, never stacked on one sample; a flood is dropped and counted', () => {
    const {sfx, sound, audio, clock} = rig();
    for (let i = 0; i < 9; i++) sound.ignite(i, 0.5, 0);
    const delays = sfx.cues.map(c => c.delay!);
    expect(delays).toHaveLength(F.staggerMax + 1);
    delays.forEach((d, i) => expect(d).toBeCloseTo(i * F.staggerS, 6));
    expect(audio.debugState()).toMatchObject({catches: F.staggerMax + 1, dropped: 9 - (F.staggerMax + 1)});
    for (let i = 0; i < 3; i++) sound.burnOut(i, 0.5, 0); // the collapse has its own queue
    const hits = sfx.cues.filter(c => c.cue === 'fireCollapse').map(c => c.delay!), embers = sfx.cues.filter(c => c.cue === 'fireEmbers').map(c => c.delay!);
    hits.forEach((d, i) => expect(d).toBeCloseTo(i * F.staggerS, 6));
    embers.forEach((d, i) => expect(d).toBeCloseTo(i * F.staggerS + F.embersDelayS, 6));
    clock.t += 1;
    sound.ignite(0, 0.5, 0);
    expect(sfx.cues[sfx.cues.length - 1].delay).toBe(0); // the queue drained
  });

  it('refill: the existing pour, at most `seconds` of it; the returned function cuts THAT pour while it sounds, once', () => {
    const {sfx, sound, clock, audio} = rig();
    const stop = sound.refill(2.6);
    expect(sfx.pours).toEqual([2.6]);
    expect(sfx.cues).toHaveLength(0); // no new clip: the jerrycan pour
    expect(audio.debugState().pouring).toBe(true);
    clock.t += 1;
    stop();
    stop();
    expect(sfx.pourStops).toBe(1);
    expect(audio.debugState().pouring).toBe(false);
    // a pour that already ended is not "cut" (the train's fuel port may be pouring by then)
    const done = sound.refill(2.6);
    clock.t += 3;
    done();
    expect(sfx.pourStops).toBe(1);
    // an older pour's function never cuts a newer pour
    const first = sound.refill(1.2);
    const second = sound.refill(2.6);
    first();
    expect(sfx.pourStops).toBe(1);
    second();
    expect(sfx.pourStops).toBe(2);
    expect(sfx.pours).toEqual([2.6, 2.6, 1.2, 2.6]);
    sound.refill(Number.NaN);
    expect(sfx.pours[4]).toBeUndefined(); // no usable length: the whole take
  });

  it('dry: the existing dry click (lower rate), not machine-gunned', () => {
    const {sfx, sound, clock} = rig();
    sound.dry();
    sound.dry();
    sound.dry();
    expect(sfx.dries).toEqual(['shotgun']);
    clock.t += J.dryGapS + 0.01;
    sound.dry();
    expect(sfx.dries).toEqual(['shotgun', 'shotgun']);
    expect(sfx.cues).toHaveLength(0);
    expect(sfx.loops).toHaveLength(0);
  });

  it('silence: the roar, the ignition, every bed and the pour end at once — no cut-off cue; idempotent; nothing comes back until asked', () => {
    const {sfx, sound, run, audio} = rig();
    sound.streamOn(1, 1.4, 1);
    run(1, [fire(5, 5), fire(-6, 2)], true);
    sound.refill(2.6);
    sound.silence();
    expect(sfx.loops).toHaveLength(3);
    expect(sfx.loops.every(l => l.stopped && l.stopFade === FLAME_AUDIO.silenceFadeS)).toBe(true);
    expect(sfx.igniteStops).toEqual([FLAME_AUDIO.silenceFadeS]);
    expect(sfx.pourStops).toBe(1);
    expect(sfx.count('flameOut')).toBe(0);
    sound.silence();
    expect(sfx.pourStops).toBe(1);
    sound.streamOff(false); // the stream is already off for the audio
    expect(sfx.count('flameOut')).toBe(0);
    expect(audio.debugState()).toMatchObject({streaming: false, roar: false, beds: 0, bedsOn: 0, pouring: false});
    // a new section: the same object sounds again
    sound.streamOn(1, 1.4, 1);
    run(1.2, [fire(5, 5)], true);
    expect(sfx.playing('flameRoar')).toHaveLength(1);
    expect(sfx.playing('fireBurn')).toHaveLength(1);
    expect(sfx.count('flameIgnite')).toBe(2);
  });

  it('never throws when the Sfx does, and ignores a non-finite muzzle', () => {
    const {sfx, sound, run} = rig();
    sound.streamOn(Number.NaN, 1, 1);
    expect(sfx.cues[0].at).toEqual([0, 0, 0]);
    sound.streamOff(false);
    sound.streamOn(2, 1.4, 2);
    run(0.5, [], true);
    sound.frame(1 / 60, {x: Number.NaN, y: 1, z: 1}, []);
    expect(sfx.playing('flameRoar')[0].pos).toEqual([MUZZLE.x, MUZZLE.y, MUZZLE.z]);
    const boom = () => { throw new Error('x'); };
    const broken = new FlameAudio({reactorCue: boom, reactorLoop: boom, flameIgnite: boom, stopFlameIgnite: boom, fuelPour: boom, stopFuelPour: boom, dry: boom} as unknown as Sfx, () => 50);
    expect(() => {
      broken.streamOn(0, 0, 0); broken.frame(1 / 60, MUZZLE, [fire(1, 1)]); broken.ignite(0, 0, 0); broken.burnOut(0, 0, 0);
      broken.refill(2)(); broken.dry(); broken.streamOff(true); broken.frame(Number.NaN, null, []); broken.silence();
    }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// the real Sfx on the fake WebAudio context

async function realSfx() {
  const made: FakeCtx[] = [];
  const {bank, buffers} = fakeBank({variants: 1});
  const sfx = new Sfx(() => { const c = new FakeCtx(); made.push(c); return c as unknown as AudioContext; }, bank);
  sfx.init();
  sfx.suspend(false);
  await settle();
  const ctx = made[0];
  const of = (cue: (typeof CUES)[number]) => ctx.started.filter(s => s.buffer === bank.get(cue)[0].buffer);
  /** A machine loop's own fade gain (source -> fade): its value is the level last set (the fake context applies targets at once). */
  const fadeOf = (src: {outputs: unknown[]}) => (src.outputs[0] as {gain: {value: number}}).gain.value;
  return {sfx, ctx, bank, buffers, of, fadeOf};
}

describe('FlameAudio over the real Sfx (fake WebAudio context + fake Sound Lab bank)', () => {
  it('plays only bank clips: ignition + roar loop at its mix level, bed loops at theirs, every one-shot, the reused pour and dry click; a world change brings the loops back', async () => {
    const {sfx, ctx, buffers, of, fadeOf} = await realSfx();
    const clock = {t: 0};
    const audio = new FlameAudio(sfx, () => clock.t);
    const step = (fires: readonly FireVoice[], stream: boolean) => { clock.t += 1 / 60; ctx.currentTime += 1 / 60; audio.frame(1 / 60, stream ? MUZZLE : null, fires); };
    const s0 = ctx.started.length;
    audio.streamOn(1, 1.4, 1);
    expect(ctx.started.length).toBe(s0 + 2);
    expect(of('flameIgnite')).toHaveLength(1);
    expect(of('flameRoar')).toHaveLength(1);
    expect(of('flameRoar')[0].loop).toBe(true);
    expect(fadeOf(of('flameRoar')[0])).toBeCloseTo(CUE_GAIN.flameRoar, 9); // level 1 = the build's mix gain, set at once
    const fires = [fire(6, 2, 1), fire(-4, 3, 0.5)];
    for (let i = 0; i < 60; i++) step(fires, true);
    expect(of('flameRoar')).toHaveLength(1);
    expect(of('fireBurn')).toHaveLength(2);
    expect(of('fireBurn').every(s => s.loop)).toBe(true);
    expect(of('fireBurn').map(s => +fadeOf(s).toFixed(6))).toEqual([CUE_GAIN.fireBurn, +(CUE_GAIN.fireBurn * (F.floor + (1 - F.floor) * 0.5)).toFixed(6)]);
    sfx.setWorld({occlusion: null}); // a new station
    clock.t += 2; ctx.currentTime += 2;
    step(fires, true);
    expect(of('flameRoar')).toHaveLength(2);
    expect(of('fireBurn')).toHaveLength(4);
    expect(of('flameIgnite')).toHaveLength(1);
    audio.ignite(6, 0.5, 2);
    audio.burnOut(6, 0.5, 2);
    audio.streamOff(false);
    const stop = audio.refill(0.3);
    stop();
    audio.dry();
    for (const cue of ['fireCatch', 'fireCollapse', 'fireEmbers', 'flameOut', 'fuelPour', 'dryFire'] as const) expect(of(cue), cue).toHaveLength(1);
    const started = ctx.started.length;
    audio.silence();
    for (let i = 0; i < 30; i++) step([], false);
    expect(ctx.started.length).toBe(started);
    for (const s of ctx.started) expect(buffers.has(s.buffer)).toBe(true);
    expect(ctx.oscillatorCalls).toBe(0);
    expect(sfx.debugState().bank.silentPlays).toBe(0);
  });

  it('reactorLoop keep: the full machine pool makes room with the oldest ORDINARY loop, never the roar; all kept = the oldest goes', async () => {
    const {sfx} = await realSfx();
    const roar = sfx.reactorLoop('flameRoar', 0, 1.4, 0, {keep: true})!;
    const others = Array.from({length: MACHINE_LOOP.max - 1}, (_, i) => sfx.reactorLoop('reactorHum', i, 1, 4)!);
    expect([roar, ...others].every(h => h.playing)).toBe(true);
    const bed = sfx.reactorLoop('fireBurn', 3, 0.3, 3)!; // one more than the pool holds
    expect(roar.playing).toBe(true);
    expect(others[0].playing).toBe(false);
    expect(others.slice(1).every(h => h.playing)).toBe(true);
    const bed2 = sfx.reactorLoop('fireBurn', 4, 0.3, 3)!; // fire beds are ordinary: they are evicted in their turn
    expect([roar.playing, others[1].playing, bed.playing, bed2.playing]).toEqual([true, false, true, true]);
    sfx.stopMachines(0);
    expect(roar.playing).toBe(false); // a world change still ends it
    const kept = Array.from({length: MACHINE_LOOP.max}, (_, i) => sfx.reactorLoop('flameRoar', i, 1, 0, {keep: true})!);
    const one = sfx.reactorLoop('flameRoar', 0, 1, 0, {keep: true})!;
    expect([kept[0].playing, kept[1].playing, one.playing]).toEqual([false, true, true]); // the bound holds
  });

  it('Sfx.flameIgnite: one ignition at a time (a second cuts the first), stopFlameIgnite plays nothing; silent while paused; fuelPour(maxS) bounds the pour', async () => {
    const {sfx, ctx, of} = await realSfx();
    expect(sfx.flameIgnite(1, 1.4, 1, {ref: J.ref, maxDist: J.maxDist, pri: 2})).toBeGreaterThan(0);
    const first = of('flameIgnite')[0];
    let stops = 0;
    first.stop = () => { stops++; };
    sfx.flameIgnite(1, 1.4, 1);
    expect(of('flameIgnite')).toHaveLength(2);
    expect(stops).toBe(1); // the first take's source was stopped
    const n = ctx.started.length;
    sfx.stopFlameIgnite();
    sfx.stopFlameIgnite(0.05);
    expect(ctx.started.length).toBe(n);
    const whole = sfx.fuelPour();
    expect(whole).toBeGreaterThan(0.2);
    expect(sfx.fuelPour(0.2)).toBeCloseTo(0.2, 9);
    expect(sfx.fuelPour(60)).toBe(whole); // longer than the take: the whole take
    expect(sfx.fuelPour(Number.NaN)).toBe(whole);
    sfx.pause();
    expect(sfx.flameIgnite(1, 1.4, 1)).toBe(0);
    expect(sfx.reactorLoop('flameRoar', 1, 1.4, 1, {keep: true})).toBeNull();
    expect(ctx.started.length).toBe(n + 4);
  });
});
