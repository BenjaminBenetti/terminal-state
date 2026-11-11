// Lane S (iteration 05): Sound Lab-only audio. Every cue path plays a bundled clip; nothing synthesises.
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, expect, it} from 'vitest';
import {CUES, ClipBank, leadOffset} from '../src/audio/bank';
import {CLIP_BYTES as CLIP_BYTES_I05, CLIP_GAPS as CLIP_GAPS_I05, CLIP_MANIFEST as CLIP_MANIFEST_I05} from '../src/audio/manifest.generated';
import {CLIP_BYTES_I06, CLIP_GAPS_I06, CLIP_MANIFEST_I06} from '../src/audio/manifest.iteration06.generated';
import {CLIP_BYTES_I07K, CLIP_GAPS_I07K, CLIP_MANIFEST_I07K} from '../src/audio/manifest.iteration07k.generated';
import {CLIP_BYTES_I07Q, CLIP_GAPS_I07Q, CLIP_MANIFEST_I07Q} from '../src/audio/manifest.iteration07q.generated';
import {CLIP_BYTES_I11, CLIP_GAPS_I11, CLIP_MANIFEST_I11} from '../src/audio/manifest.iteration11.generated';
import {CLIP_BYTES_I12, CLIP_GAPS_I12, CLIP_MANIFEST_I12} from '../src/audio/manifest.iteration12.generated';
import {CLIP_BYTES_COUGH, CLIP_GAPS_COUGH, CLIP_MANIFEST_COUGH} from '../src/audio/manifest.cough.generated';
import {CLIP_BYTES_T1, CLIP_GAPS_T1, CLIP_MANIFEST_T1} from '../src/audio/manifest.track1.generated'; // Task track1-siren-blightbelly-20261031 (lane AUDIO)
import {CLIP_BYTES_STRAINER, CLIP_GAPS_STRAINER, CLIP_MANIFEST_STRAINER} from '../src/audio/manifest.strainer.generated'; // strainer squish set (lane AUDIO)
import {CLIP_BYTES_REACTOR, CLIP_GAPS_REACTOR, CLIP_MANIFEST_REACTOR} from '../src/audio/manifest.reactor.generated'; // task reactor-build-20261101: the Reactor machine set
import {CLIP_BYTES_REACTOR_STARTUP, CLIP_GAPS_REACTOR_STARTUP, CLIP_MANIFEST_REACTOR_STARTUP} from '../src/audio/manifest.reactorStartup.generated'; // task reactor-playtest-round2-20261102 (lane STARTUP)
import {CLIP_BYTES_REACTOR_ENDING, CLIP_GAPS_REACTOR_ENDING, CLIP_MANIFEST_REACTOR_ENDING} from '../src/audio/manifest.reactorEnding.generated'; // task reactor-surface-ending-20261102 (lane AUDIO)
import {CLIP_BYTES_FUEL, CLIP_GAPS_FUEL, CLIP_MANIFEST_FUEL} from '../src/audio/manifest.fuel.generated'; // task train-fuel-system-20261106 (lane PORT)
import {CLIP_BYTES_SKYWAYS_CAR, CLIP_GAPS_SKYWAYS_CAR, CLIP_MANIFEST_SKYWAYS_CAR} from '../src/audio/manifest.skywaysCar.generated'; // task skyways-level-20261106: the prize car set
import {CLIP_BYTES_SKYWAYS_DESTINATIONS, CLIP_GAPS_SKYWAYS_DESTINATIONS, CLIP_MANIFEST_SKYWAYS_DESTINATIONS} from '../src/audio/manifest.skywaysDestinations.generated'; // task skyways-destinations-20261106 (lane AUDIO)
import {CLIP_BYTES_HEAD_HIT, CLIP_GAPS_HEAD_HIT, CLIP_MANIFEST_HEAD_HIT} from '../src/audio/manifest.headHit.generated'; // task studio-general-armor-20261107-231448-01: the head-hit skull crack
import {CLIP_BYTES_MARKET_BAR, CLIP_GAPS_MARKET_BAR, CLIP_MANIFEST_MARKET_BAR} from '../src/audio/manifest.marketBar.generated'; // task studio-market-bar-20261108-225231-01 (lane AUDIO): the market set
import {CLIP_BYTES_GUN_VARIETY, CLIP_GAPS_GUN_VARIETY, CLIP_MANIFEST_GUN_VARIETY} from '../src/audio/manifest.gunVariety.generated'; // task studio-weapon-soundlab-audio-20261110-063407-01: the new guns' own shots / reloads
import {CLIP_BYTES_SCREACHER, CLIP_GAPS_SCREACHER, CLIP_MANIFEST_SCREACHER} from '../src/audio/manifest.screacher.generated'; // task studio-screacher-production-20261110-221858-01 (lane AUDIO): the Screacher's voice
import {CLIP_BYTES_CHIPPER, CLIP_GAPS_CHIPPER, CLIP_MANIFEST_CHIPPER} from '../src/audio/manifest.chipper.generated'; // task studio-corpse-chipper-fuel-20261110-235304-01 (lane AUDIO): the train chipper set

// Iteration 06 (Lane D): the runtime bank = iteration-05 manifest + the iteration-06 breaking cues.
// Iteration 07 (Lane K): + shot item / chunk / light prop landing cues (i07k).
// Iteration 07 (Lane Q): + rat/dog creature vocals + paw scrabble (i07q).
// Iteration 11: + the dedicated pistol shot. Iteration 12 (AUDIO): + battery insert, flare ignite / burn loop / out, flashlight flicker.
// Task track1-siren-blightbelly-20261031 (lane AUDIO): + Siren hum / scream, Blightbelly burst / gas hiss (t1).
// Task studio-alpha-strainer-reach-squish-20261101-201110-01 (lane AUDIO): + the Strainer's wet footfalls / swing / contact / squish.
const CLIP_MANIFEST: Record<string, readonly {url: string; dur: number; loop?: {start: number; length: number}; src: string}[]> = {...CLIP_MANIFEST_I05, ...CLIP_MANIFEST_I06, ...CLIP_MANIFEST_I07K, ...CLIP_MANIFEST_I07Q, ...CLIP_MANIFEST_I11, ...CLIP_MANIFEST_I12, ...CLIP_MANIFEST_COUGH, ...CLIP_MANIFEST_T1, ...CLIP_MANIFEST_STRAINER, ...CLIP_MANIFEST_REACTOR, ...CLIP_MANIFEST_REACTOR_STARTUP, ...CLIP_MANIFEST_REACTOR_ENDING, ...CLIP_MANIFEST_FUEL, ...CLIP_MANIFEST_SKYWAYS_CAR, ...CLIP_MANIFEST_SKYWAYS_DESTINATIONS, ...CLIP_MANIFEST_HEAD_HIT, ...CLIP_MANIFEST_MARKET_BAR, ...CLIP_MANIFEST_GUN_VARIETY, ...CLIP_MANIFEST_SCREACHER, ...CLIP_MANIFEST_CHIPPER};
const CLIP_GAPS = [...CLIP_GAPS_I05, ...CLIP_GAPS_I06, ...CLIP_GAPS_I07K, ...CLIP_GAPS_I07Q, ...CLIP_GAPS_I11, ...CLIP_GAPS_I12, ...CLIP_GAPS_COUGH, ...CLIP_GAPS_T1, ...CLIP_GAPS_STRAINER, ...CLIP_GAPS_REACTOR, ...CLIP_GAPS_REACTOR_STARTUP, ...CLIP_GAPS_REACTOR_ENDING, ...CLIP_GAPS_FUEL, ...CLIP_GAPS_SKYWAYS_CAR, ...CLIP_GAPS_SKYWAYS_DESTINATIONS, ...CLIP_GAPS_HEAD_HIT, ...CLIP_GAPS_MARKET_BAR, ...CLIP_GAPS_GUN_VARIETY, ...CLIP_GAPS_SCREACHER, ...CLIP_GAPS_CHIPPER];
const CLIP_BYTES = CLIP_BYTES_I05 + CLIP_BYTES_I06 + CLIP_BYTES_I07K + CLIP_BYTES_I07Q + CLIP_BYTES_I11 + CLIP_BYTES_I12 + CLIP_BYTES_COUGH + CLIP_BYTES_T1 + CLIP_BYTES_STRAINER + CLIP_BYTES_REACTOR + CLIP_BYTES_REACTOR_STARTUP + CLIP_BYTES_REACTOR_ENDING + CLIP_BYTES_FUEL + CLIP_BYTES_SKYWAYS_CAR + CLIP_BYTES_SKYWAYS_DESTINATIONS + CLIP_BYTES_HEAD_HIT + CLIP_BYTES_MARKET_BAR + CLIP_BYTES_GUN_VARIETY + CLIP_BYTES_SCREACHER + CLIP_BYTES_CHIPPER;
import {Sfx} from '../src/audio/sfx';
import {FakeCtx, fakeBank, fakeBuffer} from './helpers/fakeAudio';

const GAME = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = path.resolve(GAME, '..');
const settle = () => new Promise(r => setTimeout(r, 40));

/** MPEG-1/2 Layer III frame walk: returns frames, sample rate and samples (no decoding). */
function mp3Frames(b: Buffer): {frames: number; sampleRate: number; samples: number} {
  const BR1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320], BR2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
  const SR = {3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000]} as Record<number, number[]>;
  let off = 0, frames = 0, sampleRate = 0, samples = 0;
  if (b.toString('ascii', 0, 3) === 'ID3') off = 10 + ((b[6] << 21) | (b[7] << 14) | (b[8] << 7) | b[9]);
  while (off + 4 <= b.length) {
    if (b[off] !== 0xff || (b[off + 1] & 0xe0) !== 0xe0) throw new Error(`lost frame sync at byte ${off}`);
    const ver = (b[off + 1] >> 3) & 3, layer = (b[off + 1] >> 1) & 3, bri = b[off + 2] >> 4, sri = (b[off + 2] >> 2) & 3, pad = (b[off + 2] >> 1) & 1;
    if (layer !== 1 || bri === 0 || bri === 15 || sri === 3 || ver === 1) throw new Error(`not a Layer III frame at ${off}`);
    const sr = SR[ver][sri], kbps = (ver === 3 ? BR1 : BR2)[bri], spf = ver === 3 ? 1152 : 576;
    const len = Math.floor((spf / 8) * kbps * 1000 / sr) + pad;
    sampleRate = sr; samples += spf; frames++; off += len;
  }
  return {frames, sampleRate, samples};
}

describe('Sound Lab clip manifest + bundled assets', () => {
  it('covers every runtime cue (gaps listed explicitly) and nothing else', () => {
    const manifestCues = Object.keys(CLIP_MANIFEST);
    expect(new Set([...manifestCues, ...CLIP_GAPS])).toEqual(new Set(CUES));
    for (const c of manifestCues) expect(CUES as readonly string[]).toContain(c);
    for (const g of CLIP_GAPS) expect(CLIP_MANIFEST[g]?.length ?? 0).toBe(0);
    console.info(`[audio] ${manifestCues.length}/${CUES.length} cues have clips; silent gaps: ${CLIP_GAPS.length ? CLIP_GAPS.join(', ') : 'none'}`);
  });

  it('every clip is a valid relative MP3 under public/assets/audio within the size budget', () => {
    let bytes = 0;
    for (const [cue, refs] of Object.entries(CLIP_MANIFEST)) {
      for (const r of refs) {
        expect(r.url).toMatch(/^assets\/audio\/[a-z0-9-]+\.mp3$/);
        const f = path.join(GAME, 'public', r.url);
        expect(fs.existsSync(f), `${cue}: ${r.url}`).toBe(true);
        const b = fs.readFileSync(f);
        bytes += b.length;
        const m = mp3Frames(b);
        expect(m.sampleRate).toBe(44100);
        // encoded audio covers the clip (+ loop margins for beds)
        expect(m.samples / m.sampleRate).toBeGreaterThanOrEqual((r.loop ? r.loop.start + r.loop.length : r.dur) - 0.001);
        // ambience beds loop >= 5 s; the iteration-12 flare burn is a deliberately short (3-4 s) positional loop, and so are (task
        // reactor-playtest-round2-20261102, lane STARTUP) the control-rod drive (it runs only while the rods move: a 4 s hold) and the
        // beacon motor (a short mechanical cycle at one beacon) — the Reactor's machine BED stays under the >= 5 s bed rule
        const SHORT: Record<string, [number, number]> = {flareBurn: [3, 4], reactorRodLoop: [2, 3], reactorBeacon: [1.5, 2.5], cartRoll: [3, 4], // (+ task train-fuel-system, lane PORT: the fuel cart's positional rolling loop)
          carIdle: [2, 3], carDrive: [2, 3], // (+ task skyways-level-20261106, lane CAR2: the prize car's engine loops — a steady engine cycle, re-pitched every frame)
          carReverse: [1.2, 2], // (+ round 2, task skyways-vehicle-20261107 lane AUDIO: the reverse-gear whine — two of its ~0.7 s pulse periods)
          // (+ task skyways-destinations-20261106, lane AUDIO: positional LOCATION loops cut from 4 s takes — the clock tick is beat-aligned to 5 of
          // the take's tick intervals, the arcade / projector loops are the takes' whole steady spans; each sounds only near its one place)
          clockTick: [2, 3], arcadeAttract: [2.5, 3.5], projectorRun: [2, 3]};
        if (r.loop) expect(r.loop.length).toBeGreaterThan(SHORT[cue]?.[0] ?? 5);
        if (SHORT[cue]) expect(r.loop!.length).toBeLessThanOrEqual(SHORT[cue][1]);
      }
    }
    expect(bytes).toBe(CLIP_BYTES);
    expect(bytes).toBeLessThan(12e6);
    console.info(`[audio] ${(bytes / 1e6).toFixed(2)} MB of Sound Lab derivatives`);
  });

  it('provenance names a raw Sound Lab source (prompt, seed, hash) for every bundled clip', () => {
    const provs = ['audio-iteration05.json', 'audio-iteration06.json', 'audio-iteration07k.json', 'audio-iteration07-creature.json', 'audio-iteration11-pistol.json', 'audio-iteration12.json', 'audio-cough.json', 'audio-track1.json', 'audio-strainer.json', 'audio-reactor.json', 'audio-reactor-startup.json', 'audio-reactor-ending.json', 'audio-fuel.json', 'audio-skyways-car.json', 'audio-skyways-destinations.json', 'audio-head-hit.json', 'audio-market-bar.json', 'audio-gun-variety.json', 'audio-screacher.json', 'audio-chipper.json'].map(f => JSON.parse(fs.readFileSync(path.join(GAME, 'public/assets/derivatives', f), 'utf8')));
    for (const prov of provs) {
      expect(prov.license.gameReady).toBe(false);
      expect(prov.license.status).toMatch(/Conditional prototype/);
    }
    const prov = provs.reduce((acc, p) => ({...acc, derivatives: [...acc.derivatives, ...p.derivatives]}));
    const byUrl = new Map<string, {sha256: string; source: {clip: string; rawSha256: string; rawFile?: string; prompt?: string; promptSha256?: string; seed: number; jobId: string | null}}>(prov.derivatives.map((d: {url: string}) => [d.url, d]));
    // task studio-market-bar-20261108-225231-01 (lane AUDIO): the market set's public record names its raw takes by hashes only (the lane brief:
    // no prompts / paths) — the prompt's SHA-256 instead of its text, no raw path; its builder verified each raw against the runner sidecar
    // (+ task studio-weapon-soundlab-audio-20261110-063407-01: the weapon-variety gun set's record is hash-only too — its brief: the prompts stay private)
    // (+ task studio-screacher-production-20261110-221858-01, lane AUDIO: the Screacher voice set's record, hash-only as well)
    // (+ task studio-corpse-chipper-fuel-20261110-235304-01, lane AUDIO: the train chipper set's record is hash-only too)
    const hashOnly = new Set<string>(provs.filter(p => p.asset === 'audio-market-bar-20261108' || p.asset === 'audio-gun-variety-20261110' || p.asset === 'audio-screacher-20261110' || p.asset === 'audio-chipper-20261111').flatMap(p => p.derivatives.map((d: {url: string}) => d.url)));
    const rawChecked = new Set<string>();
    for (const refs of Object.values(CLIP_MANIFEST)) {
      for (const r of refs) {
        const d = byUrl.get(r.url);
        expect(d, r.url).toBeTruthy();
        expect(d!.source.clip).toBe(r.src);
        expect(d!.source.rawSha256).toMatch(/^[0-9a-f]{64}$/);
        if (hashOnly.has(r.url)) {
          expect(d!.source.promptSha256).toMatch(/^[0-9a-f]{64}$/);
          expect([d!.source.prompt, d!.source.rawFile]).toEqual([undefined, undefined]);
        } else expect(d!.source.prompt).toMatch(/^TrackType: SFX/);
        expect(Number.isInteger(d!.source.seed)).toBe(true);
        expect(d!.source.jobId).toMatch(/^\d{8}T\d{6}-\d+$/);
        expect(createHash('sha256').update(fs.readFileSync(path.join(GAME, 'public', r.url))).digest('hex')).toBe(d!.sha256);
        const raw = d!.source.rawFile ? path.join(ROOT, d!.source.rawFile) : '';
        if (raw && fs.existsSync(raw) && !rawChecked.has(raw)) { // reference mount present: raw bytes unchanged
          rawChecked.add(raw);
          expect(createHash('sha256').update(fs.readFileSync(raw)).digest('hex')).toBe(d!.source.rawSha256);
        }
      }
    }
    expect(prov.derivatives.length).toBe(Object.values(CLIP_MANIFEST).reduce((s, v) => s + v.length, 0));
  });
});

describe('no synthesis: every cue path plays a Sound Lab clip', () => {
  // Infrastructure (non-cue) members of Sfx; every OTHER prototype method must be exercised below.
  const INFRA = new Set(['constructor', 'init', 'create', 'ready', 'setVolume', 'setMuted', 'applyGain', 'suspend', 'resume', 'pause', 'sync', 'debugState', 'live',
    'setListener', 'setWorld', 'prune', 'release', 'take', 'dist', 'setPannerPos', 'makePanner', 'voice', 'playClip', 'play', 'buildReverb', 'ir', 'loadSlot', 'setRoom',
    'startAmbient', 'onCueReady', 'loopSource', 'attachBed', 'applyBeds', 'updateEmitter', 'duck', 'around', 'stopReload',
    // task studio-alpha-track2-round2-20261031-01 (R4): the annex fans' fixed channels (HVAC recording; fan-sound.test.ts)
    'updateFans',
    // iteration 12 (AUDIO): hit-confirm dip + flare-loop plumbing / lifecycle
    'dipForConfirm', 'loopFilter', 'updateLoops', 'endLoop', 'stopFlares', 'stopMachines', // (+ stopMachines: task reactor-build-20261101)
    // task office-overhaul-20261030 (lane AUDIO): enemy vocal gate (navigable route) + cross-storey step gate
    'setVocalReach', 'vocal', 'stepHeard',
    // task gas-mask-roof-feedback-20261030: silencing a sounding cough (plays nothing)
    'stopCough',
    // Task track1-siren-blightbelly-20261031 (lane AUDIO): hum / hiss fades + bookkeeping (play nothing)
    'sirenHumStop', 'stopTrack1Cues', 'sweepTrack1', 'fadeVoice',
    // Task mall-round2-20261031 (lane AUDIO, M01): releasing cardboard drag voices (plays nothing)
    'propDragStop', 'stopDrags',
    // Task studio-alpha-strainer-reach-squish-20261101-201110-01 (lane AUDIO): Strainer cue voice caps (play nothing)
    'sLive', 'strainerVoice',
    // Task studio-screacher-production-20261110-221858-01 (lane AUDIO): the Screacher cue voices' bounds — per-key rate limit, per-kind cap (plays nothing itself)
    'scrVoice',
    // Task train-fuel-system-20261106 (lane PORT): cutting a sounding pour / releasing the cart channel / QA state / the one-shot cut (play nothing)
    'stopFuelPour', 'stopCartRoll', 'fuelAudioState', 'cutVoice',
    // task skyways-level-20261106 (lane CAR2): releasing the car's engine channel / its QA state (play nothing)
    'stopCarEngine', 'carAudioState',
    // task skyways-destinations-20261106 (lane AUDIO): the location emitters' tick / gate / release / QA state (setLocationEmitters is exercised below)
    'locHeard', 'updateLocations', 'releaseLocation', 'trimLocationFades', 'locationAudioState',
    // task studio-market-bar-20261108-225231-01 (lane AUDIO): the crowd murmur channels' release / fade bound / stop and the QA state (play nothing)
    'stopCrowd', 'releaseCrowd', 'trimCrowdFades', 'marketAudioState',
    // task studio-perf-ao-train-continuity-20261110-022206-01 (lane PLAY): one slice of the reverb kernels' pre-generation (plays nothing; play-stutter-reverb-ir.test.ts)
    'irSlice']);

  it('never creates an oscillator or plays a non-bank buffer (all public cues, all areas)', async () => {
    const made: FakeCtx[] = [];
    const {bank, buffers} = fakeBank({variants: 3});
    const sfx = new Sfx(() => { const c = new FakeCtx(); made.push(c); return c as unknown as AudioContext; }, bank);
    sfx.init();
    sfx.suspend(false);
    await settle();
    const ctx = made[0], at = {x: 2, y: 1, z: 2}, z = {};
    const calls: Record<string, () => void> = {
      shot: () => { sfx.shot('rifle'); sfx.shot('shotgun'); sfx.shot('pistol', undefined, 'hornet'); sfx.shot('shotgun', 'none', 'coach_gun'); }, dry: () => { sfx.dry('rifle'); sfx.dry('shotgun'); }, click: () => sfx.click(1.4),
      reloadStart: () => { sfx.reloadStart('rifle', true); sfx.reloadStart('rifle', false); sfx.reloadStart('shotgun'); sfx.reloadStart('rifle', true, 2.9, 'overwatch'); sfx.reloadStart('shotgun', false, undefined, 'coach_gun'); },
      // task studio-weapon-soundlab-audio-20261110-063407-01: a break action closing — the gun's own barrels-shut cue, else the dry click
      breakClose: () => { sfx.breakClose('shotgun', 'coach_gun'); sfx.breakClose('shotgun'); },
      reloadEnd: () => { sfx.reloadStart('rifle', true); sfx.reloadEnd('rifle'); sfx.reloadStart('rifle'); sfx.reloadEnd('rifle'); sfx.reloadEnd('shotgun'); },
      shellIn: () => sfx.shellIn(), pump: () => sfx.pump(0.1), equip: () => sfx.equip(), pickup: () => sfx.pickup(), denied: () => sfx.denied(), heal: () => sfx.heal(),
      footstep: () => { for (const s of [false, true]) for (const c of [false, true]) sfx.footstep(s, c); }, ladder: () => { sfx.ladder(); sfx.ladder(at); },
      hitTick: () => { sfx.hitTick(false); sfx.hitTick(true); }, hurt: () => sfx.hurt(), jump: () => sfx.jump(), land: () => { sfx.land(0.1); sfx.land(1); },
      crouch: () => { sfx.crouch(true); sfx.crouch(false); },
      meleeSwing: () => sfx.meleeSwing(), // lane KNIFE: the knife slash reuses the Sound Lab 'crouch' rustle clip
      maskRustle: () => { sfx.maskRustle(true); sfx.maskRustle(false); }, // task gasmask-breach-20261030 (mask lane): Q don / doff reuses 'crouch' too
      containerOpen: () => { for (const k of ['cabinetTall', 'cabinetLow', 'crate', 'vending', 'fridge', 'shopCooler', 'desk', 'gunLocker', 'shelf']) sfx.containerOpen(k, at); },
      containerClose: () => { for (const k of ['cabinetTall', 'crate', 'vending', 'fridge', 'desk']) sfx.containerClose(k, at); }, pry: () => sfx.pry('vending', at),
      search: () => sfx.search(), eat: () => { for (const k of ['chips', 'chocolate', 'beans', 'noodles', 'other']) sfx.eat(k); },
      drink: () => { for (const k of ['cola', 'water', 'juice', 'other']) sfx.drink(k); }, death: () => sfx.death(), win: () => sfx.win(),
      impact: () => { for (const s of ['concrete', 'tile', 'metal', 'wood', 'flesh', 'glass', 'sheet'] as const) { ctx.currentTime += 1; sfx.impact(3, 1, 3, s); } },
      // task studio-market-rework-20261108-074144-01 (lane COMBAT): a hostile survivor's shot / reload — the player's own gun clips, positional
      npcShot: () => { for (const k of ['rifle', 'shotgun', 'pistol'] as const) { ctx.currentTime += 1; sfx.npcShot(k, 3, 1.4, 3); } },
      npcReload: () => { for (const k of ['rifle', 'shotgun', 'pistol'] as const) { ctx.currentTime += 1; sfx.npcReload(k, 3, 1.4, 3, 2, 4); } },
      hitConfirm: () => { ctx.currentTime += 1; sfx.hitConfirm(3, 1, 3); ctx.currentTime += 1; sfx.shot('pistol'); sfx.hitConfirm(70, 1, 3, z); },
      // Iteration 12 (AUDIO): flashlight battery + flare
      cough: () => { ctx.currentTime += 1; sfx.cough(); }, // gas-mask-roof feedback: the player's cough
      batteryInsert: () => sfx.batteryInsert(), flashlightFlicker: () => { ctx.currentTime += 1; sfx.flashlightFlicker(0.5); },
      flareIgnite: () => sfx.flareIgnite(2, 1.2, 2), flareOut: () => sfx.flareOut(6, 0.1, 6),
      flareBurnStart: () => { const h = sfx.flareBurnStart(6, 0.1, 6); h.setPos(6.5, 0.1, 6); h.stop(); },
      // task reactor-build-20261101 (primary): the Reactor's machine one-shots + loops
      reactorCue: () => { for (const c of ['reactorGeneratorStart', 'reactorBreaker', 'reactorFuse', 'reactorValve', 'reactorPump', 'reactorStartup', 'reactorSurge', 'reactorOnline', 'reactorRodStop', 'reactorStage', 'reactorBeam', 'chipperFeed', 'chipperStart', 'chipperStop'] as const) { ctx.currentTime += 1; sfx.reactorCue(c, 4, 1, 4, {gain: 0.8, rate: 0.9, delay: 0.1, ref: 8, maxDist: 120, pri: 2, filter: c === 'reactorBeam' ? {type: 'highpass', freq: 120} : undefined}); } },
      // task reactor-surface-ending-20261102 (lane AUDIO): the surface rain bed (one looping channel, created on first use)
      rainBed: () => { sfx.rainBed(1, 0); sfx.rainBed(0.5, 1); },
      reactorLoop: () => { for (const c of ['reactorGeneratorLoop', 'reactorFanLoop', 'reactorHum', 'reactorBed', 'reactorRodLoop', 'reactorBeacon', 'chipperMotor', 'chipperGrind'] as const) { const h = sfx.reactorLoop(c, 5, 1, 5, {level: 0.5, rate: 0.9}); h?.setPos(5.5, 1, 5); h?.setLevel(1, 0.2); h?.setRate(1.05, 0.2); h?.stop(); } },
      breakage: () => { for (const c of ['breakGlass', 'breakWood', 'debrisFall', 'fleshTear'] as const) { ctx.currentTime += 1; sfx.breakage(c, 3, 1, 3, 0.8); } },
      casing: () => { ctx.currentTime += 1; sfx.casing(1, 0, 1, 3, 'rifle'); sfx.casing(1, 0, 1, 3, 'shell'); }, bodyFall: () => { ctx.currentTime += 1; sfx.bodyFall(1, 0, 1, 0.9); },
      physImpact: () => { for (const f of ['can', 'light', 'heavy', 'prop', 'cardboard', 'flesh', 'stone', 'wood', 'glass', 'metal'] as const) { ctx.currentTime += 1; sfx.physImpact(2, 0.1, 2, 3, f); } },
      propDrag: () => { ctx.currentTime += 1; sfx.propDrag(2, 0, 2, 1.2, z); }, // M01 (lane AUDIO): a cardboard prop's drag tick
      groan: () => { sfx.groan(4, 1.6, 4, false); sfx.groan(4, 1.6, 4, true); }, zombieAttack: () => sfx.zombieAttack(3, 1.5, 3), zombieDeath: () => sfx.zombieDeath(3, 1.4, 3),
      zombieGait: () => { for (let i = 0; i < 20; i++) { ctx.currentTime += 0.2; sfx.zombieGait(z, 2, 2, 1.5, 0.2, i % 2 === 0); } },
      zombieStep: () => { ctx.currentTime += 1; sfx.zombieStep(2, 2, true); sfx.zombieStep(2, 2, false, 1, -1.15); },
      zombieClimb: () => { for (let i = 0; i < 10; i++) { ctx.currentTime += 0.2; sfx.zombieClimb(z, 3, -0.5, 3, 0.2); } },
      // Iteration 07 (Lane Q): rat/dog vocals + paw scrabble
      creature: () => { for (const c of ['growl', 'snarl', 'bite', 'yelp', 'death'] as const) { ctx.currentTime += 1; sfx.creature(c, 3, 0.35, 3); } },
      creatureGait: () => { for (let i = 0; i < 20; i++) { ctx.currentTime += 0.2; sfx.creatureGait(z, 2, 2, i % 2 ? 4.4 : 0.8, 0.2); } },
      // Task track1-siren-blightbelly-20261031 (lane AUDIO): Siren hum / wake scream, Blightbelly burst / gas hiss
      sirenHum: () => sfx.sirenHum({}, 3, 0.5, 3), sirenScream: () => sfx.sirenScream({}, 3, 0.5, 3),
      blightBurst: () => sfx.blightBurst({}, 3, 1.1, 3), blightHiss: () => sfx.blightHiss({}, 3, 1.1, 3, 0.15),
      // Task studio-alpha-strainer-reach-squish-20261101-201110-01 (lane AUDIO): the Strainer's wet footfalls / swing / contact / squish
      strainerGait: () => { for (let i = 0; i < 12; i++) { ctx.currentTime += 0.2; sfx.strainerGait(z, 2, 2, 1.35, 0.2, 'Run'); } },
      strainerSwing: () => { for (let i = 0; i < 12; i++) { ctx.currentTime += 0.1; sfx.strainerSwing(z, 1, 1.0, i ? 0.1 : 0, 3, 1.5, 3); } },
      strainerContact: () => sfx.strainerContact(3, 3), strainerSquish: () => sfx.strainerSquish({}, 3, 1.3, 3),
      // Task studio-screacher-production-20261110-221858-01 (lane AUDIO): the Screacher's echolocation scream and its other vocals
      screacherScream: () => sfx.screacherScream({}, 3, 1.7, 3),
      screacherVoice: () => { for (const k of ['wheeze', 'shriek', 'hurt', 'death'] as const) { const s0 = ctx.started.length; sfx.screacherVoice(k, {}, 3, 1.7, 3); expect(ctx.started.length, k).toBe(s0 + 1); } },
      // task campaign-polish (lane TRAIN, item 17): the moving train's rumble / air loops (non-positional, into the master)
      rideLoop: () => { for (const c of ['bedRumble', 'bedWind'] as const) { const h = sfx.rideLoop(c, {send: 0.1}); h?.setLevel(0.5); h?.setRate(1.1); h?.setLowpass(1200); h?.stop(0.3); } },
      // task train-fuel-system-20261106 (lane PORT): the engine stall, the fuel pour, the hose nozzle (reused clips), the cart rolling loop
      engineStall: () => sfx.engineStall(), fuelPour: () => { sfx.fuelPour(); sfx.stopFuelPour(); },
      hoseConnect: () => { sfx.hoseConnect(true, at); sfx.hoseConnect(false); },
      cartRoll: () => { sfx.cartRoll(0.6, at); sfx.cartRoll(1, at); sfx.cartRoll(0); sfx.stopCartRoll(); },
      // task skyways-level-20261106 (lane CAR2): the prize car's engine loops (one channel), tyre skid, door
      carEngine: () => { sfx.carEngine(0, 0, at, {rev: true}); sfx.carEngine(0.7, 1, at); sfx.carEngine(0.2, 1, at, {reverse01: 0.6}); sfx.stopCarEngine(); },
      carSkid: () => { ctx.currentTime += 1; sfx.carSkid(at); }, carDoor: () => sfx.carDoor(at),
      // (+ round 2, task skyways-vehicle-20261107 lane AUDIO: the brake-to-stop, the car's own contacts)
      carBrake: () => { ctx.currentTime += 2; sfx.carBrake(at, 0.5); }, carImpact: () => { ctx.currentTime += 1; sfx.carImpact(2, 0.6, 2, 6, 'car'); sfx.carImpact(2, 0.8, 2, 5, 'flesh'); },
      // task skyways-destinations-20261106 (lane AUDIO): a location emitter's loop channel starts at the next emitter tick
      // task studio-market-bar-20261108-225231-01 (lane AUDIO): the register, a person's scream / grunt (followed, then faded), the retch, the crowd murmur
      marketCash: () => sfx.marketCash(),
      marketVoice: () => { for (const k of ['scream', 'grunt'] as const) { const h = sfx.marketVoice(k, 3, 1.5, 3, {rate: 0.95}); h?.setPos(3.5, 1.5, 3); h?.stop(); } },
      marketRetch: () => { ctx.currentTime += 1; sfx.marketRetch(); },
      crowdChatter: () => { sfx.crowdChatter([{x: 4, y: 1.5, z: 4, level: 0.8, cue: 'marketChatter'}, {x: -6, y: 1.5, z: 2, level: 0.5, cue: 'marketBarChatter'}]); sfx.crowdChatter([]); },
      setLocationEmitters: () => { sfx.setLocationEmitters([{...at, cue: 'arcadeAttract', gain: 1, range: 20}]); for (let i = 0; i < 13; i++) sfx.setListener(2, 1.6, 3, 0); sfx.setLocationEmitters([]); },
      ambience: () => {
        for (const area of ['platform', 'service-corridor', 'washroom', 'food-court', 'utility']) { sfx.setRoom('medium', area); for (let i = 0; i < 400; i++) { ctx.currentTime += 0.25; sfx.ambience(0.25); } }
      },
      vitals: () => { for (let i = 0; i < 40; i++) { ctx.currentTime += 0.25; sfx.vitals(0.25, 0.1, 0.05); } },
    };
    const methods = Object.getOwnPropertyNames(Sfx.prototype).filter(n => !INFRA.has(n));
    expect(methods.filter(m => !(m in calls)), 'new Sfx cue methods must be added to this test').toEqual([]);
    for (const [name, f] of Object.entries(calls)) {
      ctx.currentTime += 5; // let earlier voices end (the voice cap is tested elsewhere)
      const s0 = ctx.started.length;
      f();
      expect(ctx.started.length, name).toBeGreaterThan(s0);
    }
    expect(ctx.oscillatorCalls).toBe(0);
    // every source that ever started played a decoded Sound Lab clip from the bank
    for (const s of ctx.started) expect(buffers.has(s.buffer), `source buffer not from the clip bank`).toBe(true);
    // the only createBuffer use is the 4 reverb kernels, and those only ever feed convolvers
    expect(ctx.createdBuffers.length).toBeLessThanOrEqual(4);
    for (const s of ctx.started) expect(ctx.createdBuffers).not.toContain(s.buffer);
    expect(sfx.debugState().bank.silentPlays).toBe(0);
  });

  it('a cue without a clip stays silent (counted), with no stand-in sound', async () => {
    const made: FakeCtx[] = [];
    const {bank} = fakeBank({only: ['rifleShot']});
    const sfx = new Sfx(() => { const c = new FakeCtx(); made.push(c); return c as unknown as AudioContext; }, bank);
    sfx.init();
    await settle();
    const ctx = made[0], s0 = ctx.started.length;
    sfx.groan(2, 1.6, 2, false);
    sfx.hurt();
    expect(ctx.started.length).toBe(s0);
    expect(ctx.oscillatorCalls).toBe(0);
    const st = sfx.debugState().bank;
    expect(st.silentPlays).toBe(2);
    expect(st.silentCues.sort()).toEqual(['hurt', 'zombieGroan']);
    expect(sfx.debugState().bedsPlaying).toEqual([]); // no bed clips -> no ambience at all (no noise bed)
    sfx.shot('rifle');
    expect(ctx.started.length).toBeGreaterThan(s0);
  });

  it('the audio sources contain no oscillator / noise-buffer generation', () => {
    for (const f of ['sfx.ts', 'bank.ts']) {
      const src = fs.readFileSync(path.join(GAME, 'src/audio', f), 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
      expect(src, f).not.toMatch(/createOscillator|createBuffer\(|createPeriodicWave|getChannelData\([^)]*\)\s*\[[^\]]*\]\s*=/);
    }
    expect(fs.existsSync(path.join(GAME, 'src/audio/synth.ts'))).toBe(false);
  });
});

describe('ClipBank loading', () => {
  it('decodes fetched clips, skips decoder priming, sets loop regions and reports failures', async () => {
    const manifest = {
      rifleShot: [{url: 'assets/audio/a.mp3', dur: 0.4, src: 'a'}],
      bedWind: [{url: 'assets/audio/b.mp3', dur: 10.6, loop: {start: 0.3, length: 10}, src: 'b'}],
      hurt: [{url: 'assets/audio/missing.mp3', dur: 0.5, src: 'm'}],
    };
    const fetched: string[] = [];
    const fetcher = async (u: string) => { fetched.push(u); if (u.includes('missing')) throw new Error('HTTP 404'); return new ArrayBuffer(8); };
    const bank = new ClipBank(manifest, fetcher);
    bank.prefetch();
    const lead = 20; // 20 silent priming samples at 400 Hz = 0.05 s
    const ctx = {decodeAudioData: (_d: ArrayBuffer, ok: (b: AudioBuffer) => void) => { const b = fakeBuffer(11, 400, 2, i => (i < lead ? 0 : 0.4)); ok(b as unknown as AudioBuffer); return Promise.resolve(b); }} as unknown as BaseAudioContext;
    const ready: string[] = [];
    bank.onCueReady = c => ready.push(c);
    await bank.load(ctx);
    expect(fetched.length).toBe(3); // prefetch + load share one request per file
    expect(bank.state).toBe('ready');
    expect(ready.sort()).toEqual(['bedWind', 'rifleShot']);
    const shot = bank.get('rifleShot')[0];
    expect(shot.offset).toBeCloseTo(0.05 - 0.0005, 4);
    expect(shot.dur).toBeCloseTo(0.4, 6);
    const bed = bank.get('bedWind')[0];
    expect(bed.loopStart).toBeCloseTo(shot.offset + 0.3, 6);
    expect(bed.loopEnd! - bed.loopStart!).toBeCloseTo(10, 6);
    expect(bank.failed.map(f => f.url)).toEqual(['assets/audio/missing.mp3']);
    expect(bank.pick('hurt')).toBeNull();
    expect(bank.stats()).toMatchObject({cues: 2, clips: 2, failed: 1, silentPlays: 1, silentCues: ['hurt']});
  });

  it('picks variants without immediate repeats and finds the first audible sample', () => {
    const {bank} = fakeBank({variants: 3, only: ['stepConcrete']});
    let prev = bank.pick('stepConcrete');
    for (let i = 0; i < 50; i++) { const c = bank.pick('stepConcrete'); expect(c).not.toBe(prev); prev = c; }
    const b = fakeBuffer(1, 1000, 1, i => (i < 100 ? 0.00001 : i === 100 ? 0.5 : 0.1));
    expect(leadOffset(b as unknown as AudioBuffer)).toBeCloseTo(0.1 - 0.0005, 6);
  });
});
