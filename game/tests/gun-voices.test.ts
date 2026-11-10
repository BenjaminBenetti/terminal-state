// Task studio-weapon-soundlab-audio-20261110-063407-01 (user: "the guns all use the same default gun noises, the sound lab server we setup
// is still available, please use that!"): the six weapon-variety guns play their OWN Sound Lab cues — a shot per gun and its reload
// mechanics (magazine out / in; the Coach Gun's break open / close) — found by the held weapon's id (audio/gunVoices.ts), while the
// baseline pistol / rifle / shotgun keep their cues, levels and behaviour. These tests check routing, the Web Audio graph with a fake
// context and the build's structural / loudness record — they are not a listening test.
import fs from 'node:fs';
import {describe, expect, it} from 'vitest';
import {CUE_GAIN, Sfx, WEAPON_SHOT_CUES} from '../src/audio/sfx';
import {CLIP_MANIFEST, CUES, type CueId} from '../src/audio/bank';
import {GUN_VOICE_GAINS, gunCue, gunCueId, type GunVoicePart} from '../src/audio/gunVoices';
import {CLIP_MANIFEST_GUN_VARIETY, GUN_VARIETY_CUES} from '../src/audio/manifest.gunVariety.generated';
import {WEAPONS} from '../src/weapons/weapons';
import {FakeCtx, fakeBank} from './helpers/fakeAudio';

const settle = () => new Promise(r => setTimeout(r, 40));
const NEW_GUNS = ['hornet', 'longslide', 'stub', 'overwatch', 'coach_gun', 'thresher'];
const PARTS: GunVoicePart[] = ['Shot', 'MagOut', 'MagIn', 'BreakOpen', 'BreakClose'];
const prov = JSON.parse(fs.readFileSync(new URL('../public/assets/derivatives/audio-gun-variety.json', import.meta.url), 'utf8'));

async function setup() {
  const made: FakeCtx[] = [];
  const {bank} = fakeBank({variants: 2});
  const sfx = new Sfx(() => { const c = new FakeCtx(); made.push(c); return c as unknown as AudioContext; }, bank);
  sfx.init();
  sfx.suspend(false);
  await settle();
  const ctx = made[0];
  const owner = new Map<unknown, CueId>();
  for (const cue of CUES) for (const c of bank.get(cue)) owner.set(c.buffer, cue);
  /** Cues started since the mark, with their start time and gain (a source feeds its own gain node). */
  const played = (from = 0) => ctx.started.slice(from).map(s => ({cue: owner.get(s.buffer), at: s.startArgs[0], gain: (s.outputs[0] as unknown as {gain: {value: number}}).gain.value}));
  return {sfx, ctx, played};
}

describe('gun voices: a weapon finds its own cues by id (no second list of guns)', () => {
  it('the convention: gun + PascalCase(weapon id) + part', () => {
    expect(gunCueId('hornet', 'Shot')).toBe('gunHornetShot');
    expect(gunCueId('coach_gun', 'BreakOpen')).toBe('gunCoachGunBreakOpen');
    expect(gunCue('coach_gun', 'BreakClose')).toBe('gunCoachGunBreakClose');
    expect(gunCue(undefined, 'Shot')).toBeNull();
    expect(gunCue('no_such_gun', 'Shot')).toBeNull();
  });

  it('every one of the six new guns has its own shot; a magazine gun its magazine out / in, the break action its open / close', () => {
    for (const id of NEW_GUNS) {
      const def = WEAPONS[id];
      expect(def, id).toBeTruthy();
      expect(gunCue(id, 'Shot'), id).not.toBeNull();
      const brk = def.reload.kind === 'break';
      expect([gunCue(id, 'MagOut') !== null, gunCue(id, 'MagIn') !== null], id).toEqual([!brk, !brk]);
      expect([gunCue(id, 'BreakOpen') !== null, gunCue(id, 'BreakClose') !== null], id).toEqual([brk, brk]);
    }
    expect(WEAPONS.coach_gun.reload.kind).toBe('break');
  });

  it('registry-wide: every weapon with its own voice has the parts its reload needs, and every gun cue belongs to a weapon', () => {
    const reached = new Set<string>();
    for (const [id, def] of Object.entries(WEAPONS)) {
      for (const p of PARTS) { const c = gunCue(id, p); if (c) reached.add(c); }
      if (!gunCue(id, 'Shot')) continue;
      if (def.reload.kind === 'magazine') expect([gunCue(id, 'MagOut'), gunCue(id, 'MagIn')].every(Boolean), id).toBe(true);
      if (def.reload.kind === 'break') expect([gunCue(id, 'BreakOpen'), gunCue(id, 'BreakClose')].every(Boolean), id).toBe(true);
    }
    expect([...reached].sort()).toEqual([...GUN_VARIETY_CUES].sort());
  });

  it('the baseline pistol / rifle / shotgun / knife have no own voice: they keep their shared cues (gunPistolShot is not pistolShot)', () => {
    for (const id of ['pistol', 'rifle', 'shotgun', 'knife']) for (const p of PARTS) expect(gunCue(id, p), `${id} ${p}`).toBeNull();
    expect(WEAPON_SHOT_CUES).toEqual({rifle: {cue: 'rifleShot', rate: 1, gain: 1}, shotgun: {cue: 'shotgunShot', rate: 1, gain: 1}, pistol: {cue: 'pistolShot', rate: 1, gain: 0.9}});
    for (const [c, g] of Object.entries({rifleShot: 1, shotgunShot: 1, pistolShot: 1, shotgunPump: 0.42, shellInsert: 0.4, rifleMagOut: 0.38, rifleMagIn: 0.42, rifleCharge: 0.45, rifleMagDrop: 0.3, dryFire: 0.35, equip: 0.28, headHit: 0.5})) {
      expect(CUE_GAIN[c as CueId], c).toBe(g);
    }
  });

  it('the cues are in the bank (decoded through the ClipBank like every cue), with their measured gains, never above 1', () => {
    for (const c of GUN_VARIETY_CUES) {
      expect(CUES, c).toContain(c);
      expect(CLIP_MANIFEST[c]).toEqual(CLIP_MANIFEST_GUN_VARIETY[c]);
      expect(CUE_GAIN[c]).toBe(GUN_VOICE_GAINS[c]);
      expect(CUE_GAIN[c]).toBeGreaterThan(0.1);
      expect(CUE_GAIN[c]).toBeLessThanOrEqual(1);
    }
    // two takes for the two full-auto guns (rapid fire varies without a machine-gun repeat of one take)
    expect([CLIP_MANIFEST.gunHornetShot.length, CLIP_MANIFEST.gunStubShot.length]).toEqual([2, 2]);
  });
});

describe('gun voices: Sfx routing (fake Web Audio graph)', () => {
  it('a new gun fires its own shot; the same kind without an id (the baseline gun) fires the shared one, at its old level', async () => {
    const {sfx, ctx, played} = await setup();
    const cases: [Parameters<Sfx['shot']>, CueId][] = [
      [['pistol', undefined, 'hornet'], 'gunHornetShot'], [['pistol', undefined, 'longslide'], 'gunLongslideShot'],
      [['rifle', undefined, 'stub'], 'gunStubShot'], [['rifle', undefined, 'overwatch'], 'gunOverwatchShot'],
      [['shotgun', 'none', 'coach_gun'], 'gunCoachGunShot'], [['shotgun', 'none', 'thresher'], 'gunThresherShot'],
      [['pistol', undefined, 'pistol'], 'pistolShot'], [['rifle', undefined, 'rifle'], 'rifleShot'], [['shotgun', undefined, 'shotgun'], 'shotgunShot'],
      [['pistol'], 'pistolShot'], [['rifle'], 'rifleShot'],
    ];
    for (const [args, cue] of cases) {
      ctx.currentTime += 5;
      const n = ctx.started.length;
      sfx.shot(...args);
      const first = played(n)[0];
      expect(first.cue, args.join(' ')).toBe(cue);
      // the shot's own gain: CUE_GAIN (x the shared set's 0.9 for the baseline pistol) within the existing +-1 dB jitter
      const g = CUE_GAIN[cue] * (cue === 'pistolShot' ? 0.9 : 1);
      expect(first.gain).toBeGreaterThanOrEqual(g * Math.pow(10, -1.001 / 20));
      expect(first.gain).toBeLessThanOrEqual(g * Math.pow(10, 1.001 / 20));
    }
  });

  it('no pump rack after the Coach Gun / Thresher (semi / break); the baseline shotgun still racks', async () => {
    const {sfx, ctx, played} = await setup();
    for (const [cycle, gun, pump] of [['none', 'coach_gun', false], ['none', 'thresher', false], [undefined, undefined, true]] as const) {
      ctx.currentTime += 5;
      const n = ctx.started.length;
      sfx.shot('shotgun', cycle, gun);
      expect(played(n).some(p => p.cue === 'shotgunPump'), String(gun)).toBe(pump);
    }
  });

  it('a magazine gun\'s reload: its own magazine out now, in at half its reload time (an empty one also drops the spent magazine)', async () => {
    const {sfx, ctx, played} = await setup();
    for (const [kind, gun, empty] of [['pistol', 'hornet', false], ['pistol', 'longslide', true], ['rifle', 'stub', false], ['rifle', 'overwatch', true], ['rifle', 'thresher', false]] as const) {
      ctx.currentTime += 5;
      const t0 = ctx.currentTime, n = ctx.started.length, def = WEAPONS[gun];
      if (def.reload.kind !== 'magazine') throw new Error(gun);
      const T = empty ? def.reload.emptyTime : def.reload.time;
      sfx.reloadStart(kind, empty, T, gun);
      const p = played(n);
      expect(p.map(x => x.cue), gun).toEqual([gunCueId(gun, 'MagOut'), ...(empty ? ['rifleMagDrop'] : []), gunCueId(gun, 'MagIn')]);
      expect(p[p.length - 1].at - t0).toBeCloseTo(T * 0.5, 6);
      // the magazine-in slice ends before the reload does (the end cue stays the one end sound)
      expect(CLIP_MANIFEST[gunCueId(gun, 'MagIn')][0].dur, gun).toBeLessThan(T * 0.5);
      // the end of the reload is unchanged: the seat click, or the charging handle after an empty magazine
      const m = ctx.started.length;
      sfx.reloadEnd(kind);
      expect(played(m).map(x => x.cue)).toEqual([empty ? 'rifleCharge' : 'dryFire']);
    }
  });

  it('the Coach Gun\'s break reload: barrels open at the start, shells go in, barrels snap shut at the end (no pump, no magazine)', async () => {
    const {sfx, ctx, played} = await setup();
    ctx.currentTime += 5;
    const n = ctx.started.length;
    sfx.reloadStart('shotgun', true, undefined, 'coach_gun');
    sfx.shellIn();
    sfx.shellIn();
    sfx.breakClose('shotgun', 'coach_gun');
    expect(played(n).map(x => x.cue)).toEqual(['gunCoachGunBreakOpen', 'shellInsert', 'shellInsert', 'gunCoachGunBreakClose']);
    // a break action without its own voice keeps the old click
    const m = ctx.started.length;
    sfx.breakClose('shotgun');
    expect(played(m).map(x => x.cue)).toEqual(['dryFire']);
  });

  it('the baseline reloads are unchanged (no id = the shared magazine cues / the shotgun pump)', async () => {
    const {sfx, ctx, played} = await setup();
    ctx.currentTime += 5;
    let n = ctx.started.length;
    sfx.reloadStart('rifle', false);
    expect(played(n).map(x => x.cue)).toEqual(['rifleMagOut', 'rifleMagIn']);
    n = ctx.started.length;
    sfx.reloadStart('pistol', false, undefined, 'pistol');
    expect(played(n).map(x => x.cue)).toEqual(['rifleMagOut', 'rifleMagIn']);
    n = ctx.started.length;
    sfx.reloadStart('shotgun', false, undefined, 'shotgun');
    sfx.reloadEnd('shotgun');
    expect(played(n).map(x => x.cue)).toEqual(['equip', 'shotgunPump']);
  });
});

describe('gun voices: the build record (structural QC — not a listening test)', () => {
  it('hash-only public provenance from the local Sound Lab, within the 24-job allowance; NOT listened to', () => {
    expect(prov.license.gameReady).toBe(false);
    expect(prov.license.review).toMatch(/NOT LISTENED TO/);
    const jobs = new Set<string>([...prov.derivatives.map((d: {source: {jobId: string}}) => d.source.jobId), ...prov.rejectedRaws.map((r: {jobId: string}) => r.jobId)]);
    expect(jobs.size).toBeLessThanOrEqual(24);
    for (const d of prov.derivatives) {
      expect(d.source.prompt).toBeUndefined();
      expect(d.source.rawFile).toBeUndefined();
      expect(d.source.promptSha256).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(JSON.stringify(prov)).not.toMatch(/TrackType|reference\/|\.wav|https?:/);
  });

  it('new generations, not re-used baseline takes: no gun-variety clip shares a Sound Lab job with the baseline gun cues', () => {
    const i05 = JSON.parse(fs.readFileSync(new URL('../public/assets/derivatives/audio-iteration05.json', import.meta.url), 'utf8'));
    const i11 = JSON.parse(fs.readFileSync(new URL('../public/assets/derivatives/audio-iteration11-pistol.json', import.meta.url), 'utf8'));
    const base = new Set<string>([...i05.derivatives, ...i11.derivatives].map((d: {source: {jobId: string}}) => d.source.jobId));
    for (const d of prov.derivatives) expect(base.has(d.source.jobId), d.url).toBe(false);
  });

  it('each shot is one report (no second attack), short (no huge tail), unclipped; the levels sit at the baseline families\'', () => {
    for (const d of prov.derivatives) {
      expect(d.gate.peakDbfs).toBeLessThanOrEqual(-1);
      expect(d.gate.clipped).toBe(false);
      if (/Shot$/.test(d.cue)) {
        expect(d.gate.secondReportDb, d.url).toBeNull();
        expect(d.dur, d.url).toBeLessThanOrEqual(0.8);
      }
    }
    for (const [cue, m] of Object.entries(prov.mixCalibration.cues as Record<string, {cueGain: number; targetLufs: number; atSourceLufs: number}>)) {
      expect(CUE_GAIN[cue as CueId]).toBe(m.cueGain);
      expect(Math.abs(m.atSourceLufs - m.targetLufs), cue).toBeLessThanOrEqual(2); // capped at gain 1: the Hornet sits 1.8 LU under
    }
    // rapid fire: twelve shots at the gun's cycle sum below full scale (before the master compressor)
    for (const [cue, r] of Object.entries(prov.mixCalibration.rapidFire as Record<string, {intervalS: number; sumPeakDbfs: number}>)) {
      expect(r.sumPeakDbfs, cue).toBeLessThan(0);
      expect(r.intervalS).toBe(WEAPONS[cue === 'gunHornetShot' ? 'hornet' : 'stub'].interval);
    }
  });
});
