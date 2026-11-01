// Task studio-alpha-strainer-reach-squish-20261101-201110-01 (lane AUDIO; user: "It needs unique 'squishy sounds' to really sell its
// swamp creature feel."): the Strainer's own Sound Lab set — registration, shipped derivatives + provenance + allowlist, and the cue
// behaviour on a fake WebAudio context: wet footfalls on its REAL steps only (the foot plants of its Walk / Run clip at the real
// ground speed; silent standing still), one arm-swing whoosh per swing peaking on the claw's impact, the contact squelch only for a
// connecting claw (never a miss), the rate-limited hit squish, and the voice caps. The clips were NOT listened to (structural QC).
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {describe, expect, it} from 'vitest';
import {CLIP_MANIFEST, CUES, ClipBank, type Clip, type CueId} from '../src/audio/bank';
import {CLIP_BYTES_STRAINER, CLIP_GAPS_STRAINER, CLIP_MANIFEST_STRAINER, STRAINER_SWING_PEAK_S} from '../src/audio/manifest.strainer.generated';
import {CUE_GAIN, STRAINER_AUDIO, STRAINER_CUE_IDS, Sfx} from '../src/audio/sfx';
import {STRAINER_CUES, STRAINER_STATS} from '../src/ai/strainer';
import {ZOMBIE_CUES, type EnemyActor} from '../src/ai/creatureArchetypes';
import {FakeCtx, fakeBank, fakeBuffer, type Node, type Src} from './helpers/fakeAudio';

const GAME = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = path.resolve(GAME, '..');
const pub = (p: string) => path.join(GAME, 'public', p);
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const settle = () => new Promise(r => setTimeout(r, 40));
const S4 = ['strainerStep', 'strainerSwing', 'strainerContact', 'strainerSquish'] as const;
const DT = 1 / 60;

interface Deriv {
  url: string; bytes: number; sha256: string; cue: string; durationS: number; kbps: number; peakFromAudibleStartS?: number;
  source: {clip: string; rawSha256: string; rawFile: string; prompt: string; seed: number; seconds: number; jobId: string; model: string; profile: string; rawVerdict: {pass: boolean}};
  structural: {peakDbfs: number; verdict: {pass: boolean; kind: string}};
  ops: {op: string}[];
}
const provText = fs.readFileSync(pub('assets/derivatives/audio-strainer.json'), 'utf8');
const prov = JSON.parse(provText) as {
  task: string; auditioned: boolean; license: {status: string; gameReady: boolean; approved: boolean; review: string}; soundLab: {model: string; jobs: number};
  usage: {allowanceJobs: number; posts: number; submitted: number; succeeded: number; failed: number; structurallyRejected: string[];
    jobs: {clip: string; seconds: number; seed: number; prompt: string; posts: number; state: string; jobId: string; shipped: string[]}[]};
  excluded: {clip: string; reason: string}[]; gaps: string[]; derivatives: Deriv[]; totals: {bytes: number}; swingPeaks: Record<string, number>;
  mixCalibration: {new: Record<string, {cueGain: number; mixEventLevelDb: number; mixPeakDbfs: number}>; reference: Record<string, {mixEventLevelDb: number}>};
};

/** Every cue gets two fake clips; `over` replaces some (e.g. swing clips carrying the REAL srcs, so their peaks resolve). */
function bankWith(over: Partial<Record<CueId, Clip[]>> = {}, only?: readonly CueId[]): ClipBank {
  const {bank} = fakeBank({variants: 2, only});
  const clips: Partial<Record<CueId, Clip[]>> = {};
  for (const c of only ?? CUES) clips[c] = [...bank.get(c)];
  return ClipBank.fromClips({...clips, ...over});
}
const swingClip = (src: string): Clip => ({buffer: fakeBuffer(1.2) as unknown as AudioBuffer, offset: 0.01, dur: 1.15, src});
const realSwings = (srcs = Object.keys(STRAINER_SWING_PEAK_S)) => ({strainerSwing: srcs.map(swingClip)});

async function setup(bank: ClipBank = bankWith()) {
  const made: FakeCtx[] = [];
  const sfx = new Sfx(() => { const c = new FakeCtx(); made.push(c); return c as unknown as AudioContext; }, bank);
  sfx.init();
  sfx.suspend(false);
  await settle();
  const ctx = made[0];
  sfx.setListener(0, 1.6, 0, 0);
  const of = (cue: CueId) => { const b = new Set(bank.get(cue).map(c => c.buffer as unknown)); return ctx.started.filter(s => b.has(s.buffer)); };
  const srcOf = (s: Src) => bank.get('strainerSwing').find(c => c.buffer === s.buffer)?.src ?? '';
  return {sfx, ctx, of, srcOf, bank};
}
/** The voice input a clip source feeds, and the panner after it (no air-absorption filter this close). */
const pannerOf = (s: Src) => (s.outputs[0].outputs[0] as Node).outputs[0] as unknown as {kind: string; positionX: {value: number}; positionY: {value: number}; positionZ: {value: number}};

/** Run the gait for `seconds` of 60 fps frames; returns the start times of the footfalls. */
function walk(t: Awaited<ReturnType<typeof setup>>, id: object, speed: number, clip: string | null, seconds: number, x = 2, z = 2): number[] {
  const before = t.of('strainerStep').length;
  for (let i = 0; i < Math.round(seconds / DT); i++) { t.ctx.currentTime += DT; t.sfx.strainerGait(id, x, z, speed, DT, clip); }
  return t.of('strainerStep').slice(before).map(s => s.startArgs[0]);
}

/** One simulated attack: strainerSwing every frame for `seconds` (the brain stays in 'attack'); returns the swing starts. */
function swing(t: Awaited<ReturnType<typeof setup>>, id: object, seq: number, impactS: number, seconds = 2, at = [3, 1.5, 3]): {t0: number; starts: Src[]} {
  const before = t.of('strainerSwing').length, t0 = t.ctx.currentTime;
  for (let k = 0; k < Math.round(seconds / DT); k++) {
    t.ctx.currentTime = t0 + k * DT;
    t.sfx.strainerSwing(id, seq, impactS, k ? DT : 0, at[0], at[1], at[2]);
  }
  return {t0, starts: t.of('strainerSwing').slice(before)};
}

describe('Strainer squish set: registration + shipped Sound Lab derivatives', () => {
  it('registers the four cues (bank CUES, CUE_GAIN = provenance calibration, merged manifest) with no silent gap', () => {
    expect(STRAINER_CUE_IDS).toEqual(S4);
    for (const c of S4) {
      expect(CUES).toContain(c);
      expect(CLIP_MANIFEST[c]).toBe(CLIP_MANIFEST_STRAINER[c]);
      expect(CUE_GAIN[c]).toBeGreaterThan(0);
      expect(prov.mixCalibration.new[c].cueGain, c).toBe(CUE_GAIN[c]);
    }
    expect(CLIP_GAPS_STRAINER).toEqual([]);
    expect(Object.fromEntries(S4.map(c => [c, CLIP_MANIFEST_STRAINER[c].length]))).toEqual({strainerStep: 8, strainerSwing: 2, strainerContact: 2, strainerSquish: 2});
  });

  it('clips: relative MP3s matching provenance + the public-input allowlist; footfalls shorter than its chase footfall interval', () => {
    const allow = new Map((JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/release/public-inputs.json'), 'utf8')) as {files: {path: string; bytes: number; sha256: string}[]}).files.map(f => [f.path, f]));
    const band: Record<string, [number, number]> = {strainerStep: [0.12, 0.55], strainerSquish: [0.1, 0.4], strainerSwing: [0.3, 1.4], strainerContact: [0.15, 0.7]};
    let bytes = 0;
    for (const c of S4) for (const r of CLIP_MANIFEST_STRAINER[c]) {
      expect(r.url).toMatch(/^assets\/audio\/strainer-[a-z0-9-]+\.mp3$/);
      const b = fs.readFileSync(pub(r.url));
      bytes += b.length;
      const d = prov.derivatives.find(x => x.url === r.url)!;
      expect(d, r.url).toBeTruthy();
      expect(sha(b)).toBe(d.sha256);
      expect(d.bytes).toBe(b.length);
      expect(d.cue).toBe(c);
      expect(r.dur).toBe(d.durationS);
      expect(r.dur).toBeGreaterThanOrEqual(band[c][0]);
      expect(r.dur).toBeLessThanOrEqual(band[c][1]);
      expect(allow.get(r.url), r.url).toEqual({path: r.url, bytes: b.length, sha256: sha(b)});
    }
    // the Run clip plants a foot every half cycle: 0.8 s at the 1.35 m/s chase — every footfall has died away before the next
    const G = STRAINER_AUDIO.gait;
    expect(Math.max(...CLIP_MANIFEST_STRAINER.strainerStep.map(r => r.dur))).toBeLessThan(G.Run.cycleS / 2 * Math.min(1, G.Run.groundSpeed / STRAINER_STATS.chaseSpeed) + 1e-9);
    expect(bytes).toBe(CLIP_BYTES_STRAINER);
    expect(bytes).toBe(prov.totals.bytes);
    expect(bytes).toBeLessThan(200_000);
    for (const rel of ['assets/derivatives/audio-strainer.json', 'assets/audio/NOTICE.md']) {
      const b = fs.readFileSync(pub(rel));
      expect(allow.get(rel), rel).toEqual({path: rel, bytes: b.length, sha256: sha(b)});
    }
    const notice = fs.readFileSync(pub('assets/audio/NOTICE.md'), 'utf8');
    expect(notice).toContain('strainer-*.mp3');
    expect(notice).toContain('../derivatives/audio-strainer.json');
    expect(notice).toMatch(/Powered by Stability AI/);
  });

  it('provenance: the exact local Sound Lab usage (7 jobs <= the 8 allowed, all done, whole seconds), the rejected swing excluded, NOT auditioned', () => {
    expect(prov.task).toBe('studio-alpha-strainer-reach-squish-20261101-201110-01');
    expect(prov.soundLab.model).toBe('stabilityai/stable-audio-3-small-sfx');
    expect(prov.usage).toMatchObject({allowanceJobs: 8, posts: 7, submitted: 7, succeeded: 7, failed: 0, structurallyRejected: ['strainer-swing-02']});
    expect(prov.soundLab.jobs).toBe(7);
    for (const j of prov.usage.jobs) {
      expect(Number.isInteger(j.seconds), j.clip).toBe(true); // Sound Lab gotcha: fractional seconds came back as noise
      expect(j.posts).toBe(1);
      expect(j.state).toBe('done');
      expect(j.jobId).toMatch(/^20261101T\d{6}-\d+$/);
      expect(j.prompt).toMatch(/^TrackType: SFX, /);
    }
    expect(prov.usage.jobs.find(j => j.clip === 'strainer-swing-02')!.shipped).toEqual([]);
    expect(prov.excluded.some(e => e.clip === 'strainer-swing-02' && /raw structural gate/.test(e.reason))).toBe(true);
    expect(prov.license.status).toMatch(/Conditional prototype/);
    expect(prov.license).toMatchObject({gameReady: false, approved: false});
    expect(prov.auditioned).toBe(false);
    expect(prov.license.review).toMatch(/NOT LISTENED/);
    expect(prov.gaps).toEqual([]);
    expect(provText).not.toMatch(/\/workspaces?\/|\/home\//); // repository-relative paths only
    expect(prov.derivatives.length).toBe(14);
    for (const d of prov.derivatives) {
      expect(d.source.clip).not.toBe('strainer-swing-02');
      expect(d.source.rawVerdict.pass).toBe(true);
      expect(d.structural.verdict.pass, d.url).toBe(true);
      expect(d.structural.peakDbfs).toBeLessThanOrEqual(-0.9);
      expect(d.source.model).toBe('stabilityai/stable-audio-3-small-sfx');
      expect(d.source.profile).toBe('w8a8');
      expect(d.ops.map(o => o.op)).toEqual(['downmix', 'trim', 'fade', 'normalise', 'encode']);
      expect(d.kbps).toBe(128);
      const raw = path.join(ROOT, d.source.rawFile); // private raw (reference mount, never in Git): bytes unchanged when present
      if (fs.existsSync(raw)) expect(sha(fs.readFileSync(raw))).toBe(d.source.rawSha256);
    }
    // each swing variant's peak (aligned to the impact) is recorded and fits before the claw lands
    const swings = prov.derivatives.filter(d => d.cue === 'strainerSwing');
    expect(Object.keys(STRAINER_SWING_PEAK_S).sort()).toEqual(swings.map(d => d.source.clip).sort());
    for (const d of swings) {
      expect(STRAINER_SWING_PEAK_S[d.source.clip]).toBe(d.peakFromAudibleStartS);
      expect(d.peakFromAudibleStartS!).toBeGreaterThan(0);
      expect(d.peakFromAudibleStartS!).toBeLessThanOrEqual(STRAINER_STATS.attackImpact);
    }
  });
});

describe('Strainer footfalls: on its real steps only', () => {
  it('gait spec = the Strainer Walk / Run clip specs the actor animates (cycle, authored ground speed)', async () => {
    const {CLIP_SPECS} = await import(pathToFileURL(path.join(ROOT, 'tools/asset-pipeline/enemy/lib/strainer-clips.mjs')).href);
    for (const k of ['Walk', 'Run'] as const) {
      expect(STRAINER_AUDIO.gait[k].cycleS, k).toBe(CLIP_SPECS[k].duration);
      expect(STRAINER_AUDIO.gait[k].groundSpeed, k).toBe(CLIP_SPECS[k].groundSpeed);
    }
  });

  it('one wet footfall per foot plant of the Run clip at the real ground speed: every 0.8 s at the 1.35 m/s chase, 1.6 s at half speed', async () => {
    const t = await setup();
    const run = walk(t, {}, 1.35, 'Run', 3.3);
    expect(run.length).toBe(4);
    for (let i = 1; i < run.length; i++) expect(run[i] - run[i - 1]).toBeCloseTo(0.8, 1);
    const slow = walk(t, {}, 0.675, 'Run', 3.3);
    expect(slow.length).toBe(2);
    expect(slow[1] - slow[0]).toBeCloseTo(1.6, 1);
    const wander = walk(t, {}, 0.42, 'Walk', 2.7);
    expect(wander.length).toBe(2);
    expect(wander[1] - wander[0]).toBeCloseTo(1.3, 1);
    expect(t.sfx.debugState().strainer.steps).toBe(8);
    expect(t.of('zombieStep').length + t.of('zombieStepHeavy').length).toBe(0); // not the borrowed zombie gait
  });

  it('silent standing still (the clip still idles at its minimum time scale) and outside the Walk / Run clips', async () => {
    const t = await setup();
    expect(walk(t, {}, 0, 'Walk', 6)).toEqual([]);
    expect(walk(t, {}, 0.1, 'Run', 6)).toEqual([]); // below STRAINER_AUDIO.gait.minSpeed (shoved / settling)
    for (const clip of ['Idle', 'Attack', 'Hit', 'Death', null]) expect(walk(t, {}, 1.35, clip, 3), String(clip)).toEqual([]);
  });

  it('several Strainers never stack: at most STRAINER_AUDIO.step.max footfalls sound at once', async () => {
    const t = await setup();
    const ids = Array.from({length: 8}, () => ({}));
    for (let i = 0; i < Math.round(0.85 / DT); i++) { t.ctx.currentTime += DT; for (const id of ids) t.sfx.strainerGait(id, 2, 2, 1.35, DT, 'Run'); }
    expect(t.of('strainerStep').length).toBe(STRAINER_AUDIO.step.max);
    expect(t.sfx.debugState().strainer.voices.step).toBeLessThanOrEqual(STRAINER_AUDIO.step.max);
    expect(t.sfx.debugState().strainer.capped).toBeGreaterThan(0);
  });
});

describe('Strainer arm swing / claw contact / hit squish', () => {
  it('one whoosh per swing, its loudest 20 ms on the claw\'s impact frame; variants alternate', async () => {
    const t = await setup(bankWith(realSwings()));
    const impact = STRAINER_STATS.attackImpact, id = {}, used: string[] = [];
    for (let seq = 1; seq <= 4; seq++) {
      const {t0, starts} = swing(t, id, seq, impact);
      expect(starts.length, `swing ${seq}`).toBe(1);
      const src = t.srcOf(starts[0]);
      used.push(src);
      expect(Math.abs(starts[0].startArgs[0] + STRAINER_SWING_PEAK_S[src] - (t0 + impact)), src).toBeLessThanOrEqual(DT + 1e-6);
      t.ctx.currentTime += 1;
    }
    for (let i = 1; i < used.length; i++) expect(used[i]).not.toBe(used[i - 1]);
    expect(swing(t, id, 4, impact).starts.length).toBe(0); // the same swing never sounds twice
  });

  it('a swing cut before its whoosh starts (stagger / death) stays silent; a short impact only uses variants that fit', async () => {
    const [early, peak] = Object.entries(STRAINER_SWING_PEAK_S).reduce((p, q) => (q[1] < p[1] ? q : p));
    const t = await setup(bankWith(realSwings()));
    expect(swing(t, {}, 1, STRAINER_STATS.attackImpact, DT).starts.length).toBe(0); // cut on its first frame: no variant has started
    const one = await setup(bankWith(realSwings([early])));
    expect(swing(one, {}, 1, 1.0, 1.0 - peak - 0.2).starts.length).toBe(0); // cut 0.2 s before this variant would start
    expect(swing(one, {}, 2, 1.0).starts.length).toBe(1); // ... a full swing sounds
    for (let seq = 1; seq <= 4; seq++) {
      const {starts} = swing(t, {}, seq, peak + 0.05); // an impact too early for the other variant's build-up
      expect(starts.length).toBe(1);
      expect(t.srcOf(starts[0])).toBe(early);
    }
  });

  it('at most STRAINER_AUDIO.swing.max whooshes at once', async () => {
    const t = await setup(bankWith(realSwings()));
    const ids = Array.from({length: 4}, () => ({})), t0 = t.ctx.currentTime;
    for (let k = 0; k < 120; k++) { t.ctx.currentTime = t0 + k * DT; for (const id of ids) t.sfx.strainerSwing(id, 1, 1.0, k ? DT : 0, 3, 1.5, 3); }
    expect(t.of('strainerSwing').length).toBe(STRAINER_AUDIO.swing.max);
  });

  it('the claw contact plays at the player\'s chest toward the attacker, survives a full shared voice cap, capped at contact.max', async () => {
    const t = await setup();
    expect(t.sfx.strainerContact(3, 0)).toBe(true);
    const s = t.of('strainerContact')[0], p = pannerOf(s);
    expect(p.kind).toBe('panner');
    expect(p.positionX.value).toBeCloseTo(STRAINER_AUDIO.contact.offsetM, 5);
    expect(p.positionY.value).toBeCloseTo(1.6 - STRAINER_AUDIO.contact.chestDropM, 5);
    expect(p.positionZ.value).toBeCloseTo(0, 5);
    t.ctx.currentTime += 2;
    for (let i = 0; i < 60; i++) t.sfx.pickup(); // fill the shared 44-voice cap
    expect(t.sfx.strainerContact(-2, 1)).toBe(true); // pri 2
    expect(t.sfx.strainerContact(-2, 1)).toBe(true);
    expect(t.sfx.strainerContact(-2, 1)).toBe(false); // own cap
    expect(t.of('strainerContact').length).toBe(1 + STRAINER_AUDIO.contact.max);
  });

  it('never on a miss: no cue of the adapter plays it; game.ts plays it only in hurtPlayer, which runs only for out.attackHit', async () => {
    const t = await setup(bankWith(realSwings()));
    const a = actor();
    STRAINER_CUES.alert(t.sfx, a);
    a.brain.state = 'attack'; a.brain.attackSeq = 1;
    STRAINER_CUES.attack(t.sfx, a);
    for (let k = 0; k < 120; k++) { t.ctx.currentTime += DT; STRAINER_CUES.tick(t.sfx, a, DT, 0, 4, () => 0.5); } // a whole swing (hit or miss alike)
    STRAINER_CUES.hurt(t.sfx, a);
    STRAINER_CUES.death(t.sfx, a);
    expect(t.of('strainerSwing').length).toBe(1);
    expect(t.of('strainerContact').length).toBe(0);
    const src = fs.readFileSync(path.join(GAME, 'src/game.ts'), 'utf8');
    expect(src.match(/strainerContact\(/g)?.length).toBe(1);
    const body = src.slice(src.indexOf('private hurtPlayer('), src.indexOf('\n  }\n', src.indexOf('private hurtPlayer(')));
    expect(body).toMatch(/archetypeOf\(z\) === 'strainer'\) this\.sfx\.strainerContact\(z\.brain\.x, z\.brain\.z\)/);
    expect([...src.matchAll(/this\.hurtPlayer\(/g)].map(m => src.slice(src.lastIndexOf('\n', m.index!), m.index!).trim())).toEqual(['if (out.attackHit)']);
  });

  it('hit squish: at most one per squish.minGapS per Strainer (pellets / bursts), capped across Strainers', async () => {
    const t = await setup();
    const a = actor(), b = actor(), c = actor();
    for (let i = 0; i < 6; i++) { STRAINER_CUES.hurt(t.sfx, a); t.ctx.currentTime += 0.02; }
    expect(t.of('strainerSquish').length).toBe(1);
    t.ctx.currentTime += STRAINER_AUDIO.squish.minGapS;
    STRAINER_CUES.hurt(t.sfx, a);
    expect(t.of('strainerSquish').length).toBe(2);
    t.ctx.currentTime += 1;
    for (const x of [a, b, c]) STRAINER_CUES.hurt(t.sfx, x);
    expect(t.of('strainerSquish').length).toBe(2 + STRAINER_AUDIO.squish.max);
    expect(t.sfx.debugState().strainer.limited).toBe(5);
  });
});

describe('Strainer cue adapter + everything else unchanged', () => {
  it('voice stays the zombie calls (deep groan, attack snarl, death); footfalls only while it really moves', async () => {
    const t = await setup();
    const a = actor();
    STRAINER_CUES.alert(t.sfx, a);
    STRAINER_CUES.attack(t.sfx, a);
    STRAINER_CUES.death(t.sfx, a);
    expect([t.of('zombieGroanDeep').length, t.of('zombieAttack').length, t.of('zombieDeath').length]).toEqual([1, 1, 1]);
    t.ctx.currentTime += 3;
    a.brain.state = 'chase';
    for (let k = 0; k < Math.round(3.3 / DT); k++) { t.ctx.currentTime += DT; STRAINER_CUES.tick(t.sfx, a, DT, 1.35, 4, () => 0.5); }
    expect(t.of('strainerStep').length).toBe(4);
    for (let k = 0; k < Math.round(3 / DT); k++) { t.ctx.currentTime += DT; STRAINER_CUES.tick(t.sfx, a, DT, 0, 4, () => 0.5); } // standing
    expect(t.of('strainerStep').length).toBe(4);
    a.clip = 'Idle';
    for (let k = 0; k < Math.round(2 / DT); k++) { t.ctx.currentTime += DT; STRAINER_CUES.tick(t.sfx, a, DT, 1.35, 4, () => 0.5); }
    expect(t.of('strainerStep').length).toBe(4);
    expect(t.of('zombieStep').length + t.of('zombieStepHeavy').length + t.of('strainerSwing').length + t.of('strainerContact').length).toBe(0);
  });

  it('the zombie cue adapter never plays a Strainer cue', async () => {
    const t = await setup();
    const z = actor();
    (z as {archetype?: string}).archetype = undefined;
    ZOMBIE_CUES.alert(t.sfx, z);
    ZOMBIE_CUES.attack(t.sfx, z);
    for (let k = 0; k < 240; k++) { t.ctx.currentTime += DT; ZOMBIE_CUES.tick(t.sfx, z, DT, 2.5, 4, () => 0.5); }
    ZOMBIE_CUES.hurt(t.sfx, z);
    ZOMBIE_CUES.death(t.sfx, z);
    expect(S4.reduce((n, c) => n + t.of(c).length, 0)).toBe(0);
    expect(t.of('zombieStep').length).toBeGreaterThan(0);
  });

  it('paused audio or a missing clip stays silent (no stand-in sound)', async () => {
    const t = await setup(bankWith({}, ['rifleShot']));
    walk(t, {}, 1.35, 'Run', 2);
    swing(t, {}, 1, 1.0);
    expect(t.sfx.strainerContact(2, 2)).toBe(false);
    expect(t.sfx.strainerSquish({}, 2, 1.3, 2)).toBe(false);
    expect(t.ctx.oscillatorCalls).toBe(0);
    expect(t.sfx.debugState().bank.silentCues.sort()).toEqual(['strainerContact', 'strainerSquish', 'strainerStep', 'strainerSwing']);
    const p = await setup();
    p.sfx.suspend(true);
    const s0 = p.ctx.started.length;
    walk(p, {}, 1.35, 'Run', 2);
    swing(p, {}, 1, 1.0);
    expect(p.sfx.strainerContact(2, 2)).toBe(false);
    expect(p.sfx.strainerSquish({}, 2, 1.3, 2)).toBe(false);
    expect(p.ctx.started.length).toBe(s0);
  });
});

/** A minimal Strainer actor for the cue adapter (brain fields the adapter reads + the actor's current clip). */
function actor(): EnemyActor & {clip: string | null; brain: {state: string; attackSeq: number}} {
  return {
    archetype: 'strainer', groanT: 99, scale: 1, clip: 'Run',
    brain: {alive: true, aware: true, state: 'idle', attackSeq: 0, stats: STRAINER_STATS, x: 3, y: 0, z: 3, type: 'shambler', climbing: false},
  } as unknown as EnemyActor & {clip: string | null; brain: {state: string; attackSeq: number}};
}
