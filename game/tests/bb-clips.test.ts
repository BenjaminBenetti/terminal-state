// Task studio-bb-production-20261112-234540-01 (lane ACTOR): BB's RUNTIME CLIPS (ai/bbClips.ts) — the BB bodies carry no baked
// animation, so every pose the game shows is solved here from a body's own bind joints. Checked on the four REAL bodies
// (enemy-bb-lullaby / -binky / -teddy / -changeling.glb) and on two stand-in proportions the solver was never tuned on (a 2 m
// Screacher body on the same joints; a synthetic short-limbed, big-headed 0.85 m skeleton without contract extras):
//   * planted palms and knees stay ON the surface and do not slide: a cycle covers exactly its declared metres, so at a pace v the
//     planted limbs move back at v (the actor advances the cycle by distance: ai/bbActor.ts);
//   * a cycle is periodic and its two halves mirror each other (exactly, on a symmetric skeleton);
//   * every clip stays inside the audited joint envelope (BB-ASSET-CONTRACT poseEnvelope; bb-asset.test.ts ENVELOPE) and above the
//     surface; no NaN anywhere;
//   * the tables the actor samples reproduce the solved poses.
// All lengths below are in model metres x the body's size against the contract's 0.85 m (`k`), so one set of bounds serves every body.

import {beforeAll, describe, expect, it} from 'vitest';
import * as THREE from 'three';
import {
  BB_ANIMATED, BB_CLIP_NAMES, BB_CLIPS, BB_FRAME_FLOATS, BB_GAIT, BB_JOINTS, bbAngles, bbAnimationClip, bbArmLocal, bbClipSetFor, bbContacts, bbGaitAt, bbGaitDown,
  bbPoseAt, bbRigFromBind, bbRigOf, bbWorld, buildBbClipSet, frameOfSample, mirrorFrame, sampleBbClip,
  type BbClipName, type BbClipSet, type BbFrame, type BbRig, type BbSide, type V3,
} from '../src/ai/bbClips';
import {BB_ASSET, BB_BODY, BB_POUNCE, BB_STATS, BB_CLIMB} from '../src/ai/bb';
import {BB_IDS, SYNTHETIC_BIND, SYNTHETIC_EXTRAS, bbGltf, rigOfGltf, screacherGltf, syntheticBb, syntheticRig} from './helpers/bbBodies';

const SIDES: readonly BbSide[] = ['L', 'R'];
const PARTS = ['palm', 'knee'] as const;

/** The bodies: [label, real BB?, exactly left/right symmetric?, loader]. */
const BODIES: readonly (readonly [string, boolean, boolean, () => Promise<BbRig | null>])[] = [
  ...BB_IDS.map(v => [`BB ${v}`, true, false, async () => rigOfGltf(await bbGltf(v))] as const),
  ['stand-in: Screacher body (2 m adult)', false, true, async () => rigOfGltf(await screacherGltf(), {})],
  ['stand-in: synthetic short-limbed big head', false, true, async () => syntheticRig()],
];

/** The audited envelope in bbAngles' terms (degrees), with the small solver residuals named where they are known. */
const ENVELOPE = {
  hipFlexion: [-25, 110], kneeFlexion: [0, 135], elbowFlexion: [0, 125], trunkBend: [-25, 35], headExtension: [-30, 75],
  // abduction is audited from 0: a planted thigh crossing just inside its hip joint reads a few degrees negative
  hipAbduction: [-6, 40], shoulderAbduction: [-6, 110],
  // shoulder flexion from hanging -30 .. 170: never further behind the chest than 30, never raised past 170
  shoulderBack: [-90, 30], shoulderRaise: [0, 170],
} as const;

function allFinite(f: BbFrame): boolean {
  return f.hips.every(Number.isFinite) && BB_ANIMATED.every(n => f.rot[n] !== undefined && f.rot[n].every(Number.isFinite));
}
function expectInEnvelope(rig: BbRig, f: BbFrame, what: string): void {
  const A = bbAngles(rig, f) as unknown as Record<string, number | Record<BbSide, number>>;
  for (const [key, [lo, hi]] of Object.entries(ENVELOPE)) {
    const v = A[key];
    for (const x of typeof v === 'number' ? [v] : [v.L, v.R]) {
      expect(x, `${what} ${key}`).toBeGreaterThanOrEqual(lo - 0.5);
      expect(x, `${what} ${key}`).toBeLessThanOrEqual(hi + 0.5);
    }
  }
  const a = bbAngles(rig, f);
  expect(a.trunkTurn, `${what} trunkTurn`).toBeLessThanOrEqual(25.5); // twist +-25 / side bend +-20
  expect(a.headTurn, `${what} headTurn`).toBeLessThanOrEqual(70.5);
}
/** The lowest contact point of a frame (palms, knees, toes) and the underside of the skull. */
function lows(rig: BbRig, f: BbFrame): {limb: number; skull: number} {
  const C = bbContacts(rig, f);
  let limb = Infinity;
  for (const s of SIDES) limb = Math.min(limb, C.palm[s][1], C.knee[s][1], C.toe[s][1]);
  return {limb, skull: C.head.c[1] - C.head.r};
}
const jointDist = (rig: BbRig, a: BbFrame, b: BbFrame): number => {
  const A = bbWorld(rig, a).pos, B = bbWorld(rig, b).pos;
  let d = 0;
  for (const [n] of BB_JOINTS) d = Math.max(d, Math.hypot(A[n][0] - B[n][0], A[n][1] - B[n][1], A[n][2] - B[n][2]));
  return d;
};

describe.each(BODIES)('BB runtime clips on %s', (_label, isBb, symmetric, load) => {
  let rig: BbRig, set: BbClipSet, k: number;
  beforeAll(async () => {
    const r = await load();
    expect(r).not.toBeNull();
    rig = r!;
    set = buildBbClipSet(rig);
    k = rig.sizeK;
  }, 120_000);

  it('solves an all-fours geometry from the body\'s own bind: strokes, metres per cycle, stance shares', () => {
    const m = rig.m;
    for (const v of Object.values(m)) expect(Number.isFinite(v)).toBe(true);
    expect(k).toBeCloseTo(rig.heightM / BB_ASSET.heightM, 9);
    if (isBb) expect(k).toBeCloseTo(1, 6); // the contract's 0.85 m standing bind
    expect(m.stroke).toBeGreaterThan(0.3 * m.thigh);
    // a limb is planted for one stroke of each cycle: stance share x metres per cycle = the stroke, in both gears
    expect(m.crawlDuty * m.crawlM).toBeCloseTo(m.stroke, 9);
    expect(m.scuttleDuty * m.scuttleM).toBeCloseTo(m.stroke, 9);
    for (const d of [m.crawlDuty, m.scuttleDuty]) { expect(d).toBeGreaterThanOrEqual(BB_GAIT.minDuty - 1e-9); expect(d).toBeLessThanOrEqual(BB_GAIT.maxDuty + 1e-9); }
    expect(m.scuttleM).toBeGreaterThan(1.5 * m.crawlM); // the fast gear covers clearly more ground per cycle
    expect(set).toMatchObject({crawlM: m.crawlM, scuttleM: m.scuttleM, crawlDuty: m.crawlDuty, scuttleDuty: m.scuttleDuty});
    // knees apart, hands under the shoulders ahead of them; the airborne trunk at the brain's body-centre height
    expect(m.kneeX).toBeGreaterThan(0);
    expect(m.palmFront).toBeGreaterThan(m.kneeFront);
    expect(m.centreY).toBeCloseTo(BB_BODY.centreUp * k, 9);
    // the neutral gaze: as far up as the neck reaches over a level back, never above the horizon
    expect(m.headPitch).toBeLessThanOrEqual(0);
    expect(m.headPitch).toBeGreaterThan(-25);
  });

  it('every clip is a full table of finite, unit rotations; loops close; the table reproduces the solved pose', () => {
    expect(Object.keys(set.tables)).toEqual([...BB_CLIP_NAMES]);
    const row = new Float32Array(BB_FRAME_FLOATS);
    for (const name of BB_CLIP_NAMES) {
      const t = set.tables[name], C = BB_CLIPS[name];
      expect(t).toMatchObject({name, duration: C.duration, loop: C.loop, frames: C.frames});
      expect(t.data.length, name).toBe((C.frames + 1) * BB_FRAME_FLOATS);
      let bad = 0, offUnit = 0;
      for (let i = 0; i < t.data.length; i++) if (!Number.isFinite(t.data[i])) bad++;
      for (let f = 0; f <= C.frames; f++) for (let j = 0; j < BB_ANIMATED.length; j++) {
        const o = f * BB_FRAME_FLOATS + j * 4;
        if (Math.abs(Math.hypot(t.data[o], t.data[o + 1], t.data[o + 2], t.data[o + 3]) - 1) > 1e-4) offUnit++;
      }
      expect(bad, `${name} NaN`).toBe(0);
      expect(offUnit, `${name} unit`).toBe(0);
      if (C.loop) for (let i = 0; i < BB_FRAME_FLOATS; i++) expect(t.data[C.frames * BB_FRAME_FLOATS + i], `${name} loop`).toBeCloseTo(t.data[i], 6);
      // on a table frame the sample IS the solved pose (same joints in the same places)
      for (const f of [0, Math.floor(C.frames / 3), C.frames - 1]) {
        sampleBbClip(t, f / C.frames, row);
        expect(jointDist(rig, frameOfSample(row), bbPoseAt(rig, name, C.duration * f / C.frames)), `${name} frame ${f}`).toBeLessThan(2e-5 * Math.max(1, k));
      }
    }
  });

  it.each([['Crawl', false], ['Scuttle', true]] as const)('%s: planted palms and knees stay ON the surface and do not slide; a cycle covers its declared metres', (name, fast) => {
    const M = fast ? rig.m.scuttleM : rig.m.crawlM, duty = fast ? rig.m.scuttleDuty : rig.m.crawlDuty, N = 240;
    type Run = {phi0: number; z0: number; x0: number; phi: number; z: number; n: number};
    const runs = new Map<string, Run>();
    let band = 0, drift = 0, low = Infinity, swingTop = 0, covered = 0, stances = 0;
    for (let i = 0; i < 2 * N; i++) { // (two cycles: every stance is seen whole, wherever it wraps)
      const phi = i / N, f = bbGaitAt(rig, phi, fast), d = bbGaitDown(rig, phi, fast), C = bbContacts(rig, f);
      expect(allFinite(f), `${name} ${phi}`).toBe(true);
      low = Math.min(low, lows(rig, f).limb);
      for (const s of SIDES) for (const part of PARTS) {
        const key = part + s, c = C[part][s], run = runs.get(key);
        if (!d[part][s]) {
          swingTop = Math.max(swingTop, c[1]);
          if (run) { // a stance just ended: it carried its contact back one stroke, at the cycle's metres per unit phase
            if (run.n > 3) { covered += (run.z0 - run.z) / ((run.phi - run.phi0) * M); stances++; }
            runs.delete(key);
          }
          continue;
        }
        band = Math.max(band, Math.abs(c[1]));
        if (!run) { runs.set(key, {phi0: phi, z0: c[2], x0: c[0], phi, z: c[2], n: 1}); continue; }
        // where a point fixed to the surface is in the body's frame, this far into the stance
        drift = Math.max(drift, Math.abs(c[2] - (run.z0 - M * (phi - run.phi0))), Math.abs(c[0] - run.x0));
        run.phi = phi; run.z = c[2]; run.n++;
      }
    }
    expect(band, 'planted height').toBeLessThan(0.002 * k); // ON the surface (the brief's bound is 2 cm)
    expect(drift, 'planted slide').toBeLessThan(0.003 * k);
    expect(low, 'nothing under the surface').toBeGreaterThan(-0.002 * k);
    expect(stances).toBeGreaterThanOrEqual(6);
    expect(covered / stances, 'ground speed of the planted limbs / the declared pace').toBeCloseTo(1, 1.7); // within ~1 %
    expect(swingTop, 'a swinging limb is picked up').toBeGreaterThan(0.012 * k);
    // the pairs alternate: pair A (left hand + right knee) lands at 0, pair B half a cycle later, each down for `duty`
    expect(bbGaitDown(rig, 0.01, fast)).toEqual({palm: {L: true, R: false}, knee: {R: true, L: false}});
    expect(bbGaitDown(rig, 0.51, fast)).toEqual({palm: {L: false, R: true}, knee: {R: false, L: true}});
    expect(bbGaitDown(rig, duty + 0.02, fast).knee).toEqual({R: false, L: false}); // a hop between the pairs
  });

  it.each([['Crawl', false], ['Scuttle', true]] as const)('%s: the cycle is periodic and its two halves mirror each other', (_name, fast) => {
    let per = 0, sym = 0, contactSym = 0, step = 0;
    for (let i = 0; i < 48; i++) {
      const phi = i / 48, f = bbGaitAt(rig, phi, fast), g = bbGaitAt(rig, phi + 0.5, fast), mf = mirrorFrame(f);
      per = Math.max(per, jointDist(rig, f, bbGaitAt(rig, phi + 1, fast)), jointDist(rig, f, bbGaitAt(rig, phi - 2, fast)));
      sym = Math.max(sym, jointDist(rig, mf, g));
      // the planted contacts mirror on every body: the same marks on the surface, left and right
      const d = bbGaitDown(rig, phi, fast), A = bbContacts(rig, f), B = bbContacts(rig, g);
      for (const s of SIDES) for (const part of PARTS) if (d[part][s]) {
        const o: BbSide = s === 'L' ? 'R' : 'L';
        contactSym = Math.max(contactSym, Math.hypot(A[part][s][0] + B[part][o][0], A[part][s][1] - B[part][o][1], A[part][s][2] - B[part][o][2]));
      }
      // continuous: no joint jumps between neighbouring phases (a 48th of a cycle)
      step = Math.max(step, jointDist(rig, f, bbGaitAt(rig, phi + 1 / 48, fast)));
    }
    expect(per).toBeLessThan(1e-9);
    expect(contactSym).toBeLessThan(0.003 * k);
    // an exactly symmetric skeleton mirrors exactly; a generated body's left and right limbs differ by millimetres, and each side is
    // solved on its own lengths (the contacts above are what must agree)
    if (symmetric) expect(sym).toBeLessThan(1e-6);
    else expect(sym).toBeLessThan(0.06 * k);
    expect(step).toBeLessThan(0.3 * (fast ? rig.m.scuttleM : rig.m.crawlM));
    // the tables: half a cycle on = the mirrored sample
    const t = set.tables[fast ? 'Scuttle' : 'Crawl'], a = new Float32Array(BB_FRAME_FLOATS), b = new Float32Array(BB_FRAME_FLOATS);
    sampleBbClip(t, 0.2, a, true);
    sampleBbClip(t, 0.7, b);
    if (symmetric) expect(jointDist(rig, frameOfSample(a), frameOfSample(b))).toBeLessThan(1e-5 * Math.max(1, k));
    expect(jointDist(rig, frameOfSample(a), mirrorFrame(bbGaitAt(rig, 0.2, fast)))).toBeLessThan(2e-5 * Math.max(1, k));
  });

  it('every clip stays inside the audited joint envelope, above the surface, and finite', () => {
    for (const name of BB_CLIP_NAMES) {
      const C = BB_CLIPS[name];
      for (let i = 0; i <= 60; i++) {
        const t = C.duration * i / 60, f = bbPoseAt(rig, name, t), what = `${name} @${t.toFixed(3)}`;
        expect(allFinite(f), what).toBe(true);
        expectInEnvelope(rig, f, what);
        const L = lows(rig, f);
        expect(L.limb, `${what} lowest palm / knee / toe`).toBeGreaterThan(-0.005 * k);
        expect(L.skull, `${what} skull`).toBeGreaterThan(-0.002 * k);
      }
    }
  });

  it('the grounded clips keep their knees down; the hands leave the surface only where the clip says so', () => {
    const at = (name: BbClipName, u: number) => bbContacts(rig, bbPoseAt(rig, name, BB_CLIPS[name].duration * u));
    const top = (name: BbClipName, part: 'palm' | 'knee'): number => { let m = -Infinity; for (let i = 0; i <= 60; i++) { const C = at(name, i / 60); m = Math.max(m, C[part].L[1], C[part].R[1]); } return m; };
    // knees: the pivot of every settled pose (both down: one may ride a few millimetres high on a body whose legs differ)
    for (const name of ['Idle', 'Poise', 'Cackle', 'Windup', 'Hit'] as const) expect(top(name, 'knee'), name).toBeLessThan(0.02 * k);
    // hands flat on the surface while it idles and while it is frozen mid-stride
    for (const name of ['Idle', 'Poise'] as const) expect(top(name, 'palm'), name).toBeLessThan(0.004 * k);
    // the cackle: up on its haunches, both hands well off the surface at its height, back down at the end
    const mid = at('Cackle', 0.45), end = at('Cackle', 1);
    for (const s of SIDES) { expect(mid.palm[s][1], 'cackle hands up').toBeGreaterThan(0.1 * k); expect(end.palm[s][1], 'cackle ends planted').toBeLessThan(0.004 * k); }
    expect(mid.head.c[1], 'cackle rears').toBeGreaterThan(at('Cackle', 0).head.c[1]);
    // the wind-up, two beats: the chest dips between the elbows (hands still down), then it rears onto its haunches with the hands
    // off the surface and the head up at its target
    const chestY = (u: number): number => bbWorld(rig, bbPoseAt(rig, 'Windup', BB_CLIPS.Windup.duration * u)).pos.Chest[1];
    const dip = at('Windup', 0.4), coiled = at('Windup', 1);
    expect(chestY(0.4), 'windup dip').toBeLessThan(chestY(0) - (isBb ? 0.015 : 0.004) * k); // (a short-armed body has less to dip)
    for (const s of SIDES) { expect(dip.palm[s][1], 'windup dip: hands down').toBeLessThan(0.004 * k); expect(coiled.palm[s][1], 'windup: hands cocked').toBeGreaterThan(0.08 * k); }
    expect(coiled.head.c[1], 'windup rears').toBeGreaterThan(dip.head.c[1] + 0.03 * k);
    // the leap: stretched out, nothing on the surface; the fall: limbs out, nothing under it
    const leap = at('Pounce', 0.3);
    for (const s of SIDES) expect(leap.palm[s][1]).toBeGreaterThan(0.08 * k);
    // the landing ends on all fours again; the death ends low
    const landed = at('Land', 1);
    for (const s of SIDES) { expect(landed.palm[s][1]).toBeLessThan(0.02 * k); expect(landed.knee[s][1]).toBeLessThan(0.02 * k); }
    const dead = at('Death', 1), up = at('Idle', 0);
    expect(dead.head.c[1]).toBeLessThan(0.75 * up.head.c[1]);
  });

  it('one-shot clips hold their ends, loops wrap, a mirrored sample is the mirrored pose', () => {
    const a = new Float32Array(BB_FRAME_FLOATS), b = new Float32Array(BB_FRAME_FLOATS);
    const same = (x: Float32Array, y: Float32Array): number => { let d = 0; for (let i = 0; i < x.length; i++) d = Math.max(d, Math.abs(x[i] - y[i])); return d; };
    for (const name of BB_CLIP_NAMES) {
      const t = set.tables[name];
      if (t.loop) {
        sampleBbClip(t, 0.3, a); sampleBbClip(t, 1.3, b);
        expect(same(a, b), name).toBeLessThan(2e-6);
        sampleBbClip(t, -0.7, b);
        expect(same(a, b), name).toBeLessThan(2e-6);
      } else {
        sampleBbClip(t, 1, a); sampleBbClip(t, 7, b);
        expect(same(a, b), name).toBe(0);
        sampleBbClip(t, 0, a); sampleBbClip(t, -3, b);
        expect(same(a, b), name).toBe(0);
      }
      // between two frames: unit rotations still
      sampleBbClip(t, 0.5 / t.frames + 0.25, a);
      for (let j = 0; j < BB_ANIMATED.length; j++) expect(Math.hypot(a[j * 4], a[j * 4 + 1], a[j * 4 + 2], a[j * 4 + 3]), name).toBeCloseTo(1, 6);
      sampleBbClip(t, 0.4, a); sampleBbClip(t, 0.4, b, true);
      expect(jointDist(rig, mirrorFrame(frameOfSample(a)), frameOfSample(b)), name).toBeLessThan(1e-6 * Math.max(1, k));
    }
  });

  it('exports each table as an AnimationClip on the shared joints, and a free arm pose inside the envelope', () => {
    for (const name of ['Crawl', 'Death'] as const) {
      const c = bbAnimationClip(set, name);
      expect(c.name).toBe(name);
      expect(c.duration).toBeCloseTo(BB_CLIPS[name].duration, 6);
      expect(c.tracks.map(t => t.name)).toEqual([...BB_ANIMATED.map(n => `${n}.quaternion`), 'Hips.position']);
      for (const t of c.tracks) expect(t.times.length).toBe(BB_CLIPS[name].frames + 1);
    }
    for (const s of SIDES) {
      const p = bbArmLocal(rig, s, 112, 14, 62);
      for (const q of [p.upper, p.fore, p.hand]) expect(Math.hypot(q[0], q[1], q[2], q[3])).toBeCloseTo(1, 9);
      // laid over the settled stance it is a picked-up hand (the twitch's paw): off the surface, the joints still in range
      const f = bbPoseAt(rig, 'Poise', 0);
      f.rot[`${s}_UpperArm`] = p.upper; f.rot[`${s}_Forearm`] = p.fore; f.rot[`${s}_Hand`] = p.hand;
      expect(bbContacts(rig, f).palm[s][1]).toBeGreaterThan(0.01 * k);
      expectInEnvelope(rig, f, `paw ${s}`);
    }
  });
});

describe('BB runtime clips: the four real bodies', () => {
  const rigs = new Map<string, BbRig>();
  beforeAll(async () => { for (const v of BB_IDS) rigs.set(v, rigOfGltf(await bbGltf(v))!); }, 120_000);

  it('each look keeps its own proportions (four different solutions), at the same cadence targets', () => {
    expect([...rigs.keys()]).toEqual([...BB_IDS]);
    const sig = new Set<string>();
    for (const [v, rig] of rigs) {
      const m = rig.m;
      sig.add(`${m.pitch.toFixed(2)}/${m.stroke.toFixed(4)}/${m.kneeX.toFixed(4)}/${m.shoulderY.toFixed(4)}`);
      // the crawl: 4 cycles a second at 1.4 m/s; the scuttle at the brain's full pace: 5-6.5 a second (a short-legged body's stroke
      // caps its metres per cycle) — and still a scuttle at the wall / ceiling pace
      expect(BB_GAIT.crawl.mps / m.crawlM, `${v} crawl Hz`).toBeCloseTo(BB_GAIT.crawl.hz, 1);
      const full = BB_STATS.chaseSpeed / m.scuttleM, wall = BB_CLIMB.speed / m.scuttleM;
      expect(full, `${v} scuttle Hz`).toBeGreaterThanOrEqual(BB_GAIT.scuttle.hz - 0.05);
      expect(full, `${v} scuttle Hz`).toBeLessThan(6.5);
      expect(wall, `${v} wall Hz`).toBeGreaterThan(3.4);
      // the gears: the wander pace crawls, the chase / climb paces scuttle (bbActor shifts at BB_GAIT.shiftUpMps / shiftDownMps)
      expect(BB_STATS.wanderSpeed).toBeLessThan(BB_GAIT.shiftDownMps);
      expect(BB_CLIMB.calmSpeed).toBeLessThan(BB_GAIT.shiftDownMps);
      expect(Math.min(BB_STATS.chaseSpeed, BB_CLIMB.speed)).toBeGreaterThan(BB_GAIT.shiftUpMps);
      // the measured contract values are the ones in use (not the BB_ASSET fall-backs)
      expect(rig.head.radius, v).toBeGreaterThan(0.06);
      expect(rig.hit.torso, v).not.toBe(BB_ASSET.hitRadii.torso);
      // a small body on all fours: the back about level, the skull well clear of the surface, under half a metre tall
      expect(m.pitch, v).toBeGreaterThan(80); expect(m.pitch, v).toBeLessThan(96);
      const C = bbContacts(rig, bbPoseAt(rig, 'Idle', 0));
      expect(C.head.c[1] - C.head.r, v).toBeGreaterThan(0.15);
      expect(C.head.c[1] + C.head.r, v).toBeLessThan(0.6);
    }
    expect(sig.size).toBe(4);
  });

  it('the clip lengths the brain times are the brain\'s own numbers', () => {
    expect(BB_CLIPS.Windup.duration).toBe(BB_POUNCE.windupS);
    expect(BB_CLIPS.Land.duration).toBe(BB_POUNCE.landS);
    expect(BB_CLIPS.Pounce.duration).toBeGreaterThanOrEqual(BB_POUNCE.maxFlightS);
    expect(BB_GAIT.shiftDownMps).toBeLessThan(BB_GAIT.shiftUpMps); // a dead band: no gear hunting at one pace
    for (const n of BB_CLIP_NAMES) expect(BB_CLIPS[n].frames).toBeGreaterThanOrEqual(12);
  });
});

describe('BB runtime clips: what is not a BB rig', () => {
  const bind = (): Record<string, V3> => Object.fromEntries(Object.entries(SYNTHETIC_BIND).map(([n, p]) => [n, [...p] as V3]));

  it('bbRigFromBind: a missing joint, a non-finite joint or a zero-length limb gives no rig', () => {
    expect(bbRigFromBind(bind(), SYNTHETIC_EXTRAS)).not.toBeNull();
    const a = bind(); delete a.L_Hand;
    expect(bbRigFromBind(a, SYNTHETIC_EXTRAS)).toBeNull();
    const b = bind(); b.Chest = [0, NaN, 0];
    expect(bbRigFromBind(b, SYNTHETIC_EXTRAS)).toBeNull();
    const c = bind(); c.R_Shin = [...c.R_Thigh] as V3;
    expect(bbRigFromBind(c, SYNTHETIC_EXTRAS)).toBeNull();
  });

  it('bbRigOf: a skeleton that is not at rest as the clips assume gives no rig; bbClipSetFor builds once per body model', () => {
    const g = syntheticBb();
    expect(bbRigOf(g.scene, SYNTHETIC_EXTRAS)).not.toBeNull();
    const turned = syntheticBb();
    turned.scene.getObjectByName('Spine')!.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.3);
    expect(bbRigOf(turned.scene, SYNTHETIC_EXTRAS)).toBeNull();
    const renamed = syntheticBb();
    renamed.scene.getObjectByName('L_Foot')!.name = 'LeftFoot';
    expect(bbRigOf(renamed.scene, SYNTHETIC_EXTRAS)).toBeNull();
    const set = bbClipSetFor(g.scene, g.scene, SYNTHETIC_EXTRAS);
    expect(set).not.toBeNull();
    expect(bbClipSetFor(g.scene, g.scene, SYNTHETIC_EXTRAS)).toBe(set);
    expect(bbClipSetFor(turned.scene, turned.scene, SYNTHETIC_EXTRAS)).toBeNull();
    expect(bbClipSetFor(turned.scene, g.scene, SYNTHETIC_EXTRAS)).toBeNull(); // (the answer is remembered per model)
  });

  it('without contract extras the rig falls back to the bind and BB_ASSET, scaled to the body', () => {
    const rig = bbRigFromBind(bind(), {})!;
    expect(rig.heightM).toBeCloseTo(SYNTHETIC_BIND.Head[1] * 1.3, 9);
    expect(rig.hit.torso).toBeCloseTo(BB_ASSET.hitRadii.torso * rig.sizeK, 9);
    expect(rig.head.radius).toBeCloseTo(BB_ASSET.headRadius * rig.sizeK, 9);
    for (const s of SIDES) { expect(rig.kneeR[s]).toBeGreaterThan(0); expect(Math.hypot(...rig.fingers[s])).toBeGreaterThan(0.01); }
  });
});
