// Task mall-round2-20261031 (lane RUNTIME, M06): "zombie hordes constantly raise and lower their arms at long view distances".
// CAUSE (traced with the real zombie rig, tests below): the zombie clips are Idle = "arms hanging" and Walk = "arms raised forward"
// (public/assets/derivatives/zombie-rigged.json). A walking horde member's formation slot is refreshed every
// HORDE_AI.validateEvery (0.3 s), so the member caught up with the stale slot inside HORDE_AI.arriveR just before each refresh and
// STOOD for a frame (brain clip Idle), then walked again: an Idle <-> Walk flip every 0.3 s at every distance, ~270 per member per
// minute. ZombieActor.play restarts the incoming clip (reset + fade in from weight 0), so each one-frame Idle blip dropped the arms
// and re-raised them over the 0.22 s crossfade. The far animation LOD (every 3rd frame) only aliased the flips (fewer, still
// ~160 / min); crossing its 32 m threshold or the director's 45 m stride threshold adds no flips of its own. Calm (patrolling)
// hordes are mostly SEEN at long range — nearer ones see the player and chase — which is where the user noticed it.
// FIX (ai/horde.ts HordeMember.steer): stand <-> walk hysteresis — a walking member keeps walking until it is within
// HORDE_AI.settleR of its slot; a standing one walks again beyond arriveR. Attacks / chase / AI timing / animation code untouched.
// Old levels have no hordes (no patrol graph): Subway / Office unaffected; Siren / Blightbelly / rat-dog actors are not horde
// members and their animation paths are not touched.

import {describe, expect, it} from 'vitest';
import {fileURLToPath} from 'node:url';
import {GLTFLoader, type GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {NodeIO} from '@gltf-transform/core';
import {ringMallFixture} from './helpers/hordeMallFixture';
import {Rng, mulberry32} from '../src/core/rng';
import {levelsOf} from '../src/gen/levels';
import {CELL, PathFinder} from '../src/gen/grid';
import {PropIndex} from '../src/core/physics';
import {ZombieBrain, type BrainOutput, type BrainWorld} from '../src/ai/brain';
import {moveZombie, sameLevel, settleZombie} from '../src/ai/motor';
import {HORDE_AI, HordeDirector} from '../src/ai/horde';
import {placeHordes} from '../src/ai/hordePlace';
import {MALL_HORDE_RULES, type HordeRules} from '../src/ai/hordeSpec';
import {searchExpand} from '../src/ai/chaseShare';
import {lureWorld} from '../src/ai/lightLure';
import {ZombieActor} from '../src/ai/zombieActor';

const DT = 1 / 60;

/** One group of `size` on ring storey 1..2 of the compact ring fixture (the mall's pool / pace; no storey changes). */
function fixtureRules(size: number): HordeRules {
  const {routeMPerMember: _r, startClearM: _s, ...placement} = MALL_HORDE_RULES.placement;
  return {...MALL_HORDE_RULES, groups: [1, 1], size: [size, size], placement: {...placement, startM: 12, groupSpacingM: 10}, patrol: {...MALL_HORDE_RULES.patrol, storeyChange: 0}};
}

function worldOf(L: ReturnType<typeof levelsOf>, pf: PathFinder, player: {x: number; y: number; z: number; alive: boolean}): BrainWorld {
  const rand = mulberry32(99);
  return {
    px: player.x, pz: player.z, py: player.y, playerAlive: player.alive,
    los: (ax, az, bx, bz, ay, by) => L.lineOfSight({x: ax, y: (ay ?? 0) + 1.5, z: az}, {x: bx, y: (by ?? 0) + 1.5, z: bz}),
    walkClear: (ax, az, bx, bz, r, ay, by) => L.walkLineClear(ax, ay ?? 0, az, bx, bz, r, by),
    findPath: (ax, az, bx, bz, op) => pf.find(ax, az, bx, bz, 0.34, searchExpand(op), op),
    randomNear: (x, z, r, y) => {
      const G = L.grid(y !== undefined ? L.levelAt(x, z, y + 0.05) : 0);
      for (let i = 0; i < 14; i++) {
        const [cx, cy] = G.cellOf(x + (rand() * 2 - 1) * r, z + (rand() * 2 - 1) * r);
        if (G.walkable(cx, cy) && G.circleClear((cx + 0.5) * CELL, (cy + 0.5) * CELL, 0.36)) { const c = G.center(cx, cy); return [c[0], c[1], G.cellFloor(cx, cy)]; }
      }
      return null;
    },
    rand, ...lureWorld(L, {attracting: () => []}), atrium: true,
  };
}

describe('horde formation steering: stand <-> walk hysteresis (ai/horde.ts)', () => {
  it('a walking member keeps walking inside arriveR until settleR; a standing one walks again only beyond arriveR', () => {
    expect(HORDE_AI.settleR).toBeLessThan(HORDE_AI.arriveR);
    const fx = ringMallFixture({storeys: 3});
    placeHordes(fx.layout, fixtureRules(6), new Rng(4242), {patrol: fx.patrol, ringStoreys: [1, 2]});
    const brains = fx.layout.zombies.map(s => { const b = new ZombieBrain(s.type, s.x, s.z, s.yaw); b.y = s.y ?? 0; return b; });
    const L = levelsOf(fx.layout);
    const H = new HordeDirector(fx.layout, L, i => brains[i], MALL_HORDE_RULES.patrol, fx.patrol);
    const m = H.groups[0].members[2], b = m.brain;
    const w = {...worldOf(L, new PathFinder(L), {x: -100, y: 0, z: -100, alive: false}), walkClear: () => true} as BrainWorld;
    const at = (d: number): BrainOutput['anim'] => {
      m.hasSlot = true; m.sx = b.x + d; m.sz = b.z; m.sy = b.y;
      const out: BrainOutput = {dirX: 0, dirZ: 0, speed: 0, face: null, anim: 'Idle', attackHit: false, alerted: false};
      m.steer(b, out, DT, w, 0.01);
      expect(out.speed > 0, `speed matches the clip at d ${d}`).toBe(out.anim === 'Walk');
      return out.anim;
    };
    const {arriveR, settleR} = HORDE_AI, band = (arriveR + settleR) / 2;
    const flips0 = m.gaitFlips;
    expect(at(band)).toBe('Idle');               // standing inside arriveR: stays
    expect(at(arriveR + 0.2)).toBe('Walk');      // beyond arriveR: walks
    expect(at(band)).toBe('Walk');               // walking inside arriveR (the stale-slot zone): keeps walking (was: stood for a frame)
    expect(at(settleR + 0.01)).toBe('Walk');
    expect(at(settleR - 0.05)).toBe('Idle');     // within settleR: stands
    expect(at(arriveR - 0.05)).toBe('Idle');     // standing: not yet beyond arriveR
    expect(at(arriveR + 0.05)).toBe('Walk');
    expect(m.gaitFlips - flips0).toBe(3);
  });

  it('the animation LOD still conserves time (far / crossing 32 m) and leaves non-members alone', () => {
    const fx = ringMallFixture({storeys: 3});
    placeHordes(fx.layout, fixtureRules(6), new Rng(7), {patrol: fx.patrol, ringStoreys: [1, 2]});
    const brains = fx.layout.zombies.map(s => { const b = new ZombieBrain(s.type, s.x, s.z, s.yaw); b.y = s.y ?? 0; return b; });
    const L = levelsOf(fx.layout);
    const H = new HordeDirector(fx.layout, L, i => brains[i], MALL_HORDE_RULES.patrol, fx.patrol);
    const b = H.groups[0].members[1].brain;
    const w = worldOf(L, new PathFinder(L), {x: -100, y: 0, z: -100, alive: false});
    for (const dist of [() => 40, (f: number) => (f % 2 ? 31.5 : 32.5), (f: number) => 32 + 3 * Math.sin(f / 20)]) {
      let sum = 0, calls = 0;
      for (let f = 0; f < 600; f++) { H.update(DT, w, {x: -100, y: 0, z: -100}); const a = H.animStep(b, DT, dist(f)); if (a > 0) { sum += a; calls++; } }
      sum += H.animStep(b, DT, 0); // drain (near): every skipped second is applied, never lost or doubled
      expect(sum).toBeCloseTo(601 * DT, 9);
      expect(calls).toBeGreaterThan(190);
    }
    // a non-member (any other enemy) animates every frame with its own dt
    expect(H.animStep(new ZombieBrain('shambler', 0, 0, 0), DT, 99)).toBe(DT);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------
// The near / far / crossing trace with the real rig

async function loadRig(): Promise<GLTF> {
  // zombie-rigged.glb without its JPEG textures (no DOM image decoding in node), as tests/physics.test.ts
  const io = new NodeIO();
  const doc = await io.read(fileURLToPath(new URL('../public/assets/models/zombie-rigged.glb', import.meta.url)));
  for (const t of doc.getRoot().listTextures()) t.dispose();
  const bin = await io.writeBinary(doc);
  return new Promise<GLTF>((res, rej) => new GLTFLoader().parse(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength) as ArrayBuffer, '', res, rej));
}

type Actor = ZombieActor;
/** The clip the actor is playing (ZombieActor.current is private: read for the trace only). */
const clipOf = (z: ZombieActor): string | null => (z as unknown as {current: string | null}).current;
/** Mean hand height above the feet (model metres): the arm pose ("raised forward" in Walk / Attack, "hanging" in Idle). */
const handH = (z: ZombieActor): number => {
  const l = z.bone('L_Hand')!, r = z.bone('R_Hand')!;
  return ((l.matrixWorld.elements[13] + r.matrixWorld.elements[13]) / 2 - z.root.position.y) / z.scale;
};

interface Run { armPerMin: number; flipsPerMin: number; walked: number; walkShare: number; inPlace: number; phaseFlips: number; maxArm: number }

/**
 * Game.updateZombies minus rendering / audio (brain, turn, motor, separation, settle, then H.animStep -> ZombieActor.animate ->
 * syncTransform / updateVolumes) for one group; the player (not perceivable: the members stay calm, as a horde across the atrium)
 * stands `off(t)` m from the group's anchor, so the members' distances are near / far / crossing the LOD thresholds.
 */
function trace(gltf: GLTF, off: (t: number) => number, seconds: number, thr: {lo: number; hi: number}, attack = false) {
  const fx = ringMallFixture({storeys: 3});
  placeHordes(fx.layout, fixtureRules(8), new Rng(4242), {patrol: fx.patrol, ringStoreys: [1, 2]});
  const layout = fx.layout, L = levelsOf(layout), props = new PropIndex(L, layout.props), pf = new PathFinder(L);
  let s = 7;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const actors: Actor[] = layout.zombies.map(sp => { const z = new ZombieActor(gltf, {x: sp.x, z: sp.z, yaw: sp.yaw, type: sp.type, area: 0}, rnd) as Actor; z.brain.y = sp.y ?? 0; return z; });
  const H = new HordeDirector(layout, L, i => actors[i]?.brain, MALL_HORDE_RULES.patrol, fx.patrol);
  const g = H.groups[0];
  const player = {x: 0, y: 0, z: 0, alive: false};
  const w = worldOf(L, pf, player);
  const st = actors.map(() => ({up: null as boolean | null, arm: 0, flips: 0, last: '', walk: 0, frames: 0, inPlace: 0}));
  let phaseFlips = 0, lastPhase = g.phase;
  const warm = 8 * 60, T = Math.round(seconds * 60);
  const step = (meas: boolean, onActor?: (z: Actor, out: BrainOutput, adt: number) => void) => {
    w.px = player.x; w.pz = player.z; w.py = player.y; w.playerAlive = player.alive;
    H.update(DT, w, player);
    if (meas && g.phase !== lastPhase) phaseFlips++;
    lastPhase = g.phase;
    for (let i = 0; i < actors.length; i++) {
      const z = actors[i], b = z.brain;
      if (!b.alive) continue;
      const out = b.update(DT, w);
      if (out.face !== null) { let d = out.face - b.yaw; d = Math.atan2(Math.sin(d), Math.cos(d)); const turn = (b.state === 'attack' ? Math.max(7, b.stats.turnRate ?? 0) : b.stats.turnRate ?? 4.5) * DT; b.yaw += Math.max(-turn, Math.min(turn, d)); }
      const moved = moveZombie(b, out, DT, L, props);
      if (!b.climbing) {
        for (const o of actors) {
          if (o === z || !o.brain.alive || !sameLevel(b.y, o.brain.y)) continue;
          const dx = b.x - o.brain.x, dz = b.z - o.brain.z, d = Math.hypot(dx, dz), mn = b.stats.radius + o.brain.stats.radius;
          if (d > 1e-4 && d < mn) { const p = (mn - d) * 0.5; b.x += dx / d * p; b.z += dz / d * p; }
        }
        settleZombie(b, L, props);
      }
      const adt = H.animStep(b, DT, Math.hypot(b.x - player.x, b.z - player.z));
      if (adt > 0) z.animate(adt, out.anim, moved);
      z.syncTransform();
      z.root.position.y = b.y;
      if (adt > 0) z.updateVolumes();
      onActor?.(z, out, adt);
      if (!meas) continue;
      const S = st[i];
      S.frames++;
      if (out.anim === 'Walk') { S.walk++; if (moved < 0.08) S.inPlace++; }
      if (out.anim !== S.last) { if (S.last) S.flips++; S.last = out.anim; }
      const h = handH(z);
      const up = S.up === null ? h > (thr.lo + thr.hi) / 2 : S.up ? h > thr.lo : h > thr.hi;
      if (S.up !== null && up !== S.up) S.arm++;
      S.up = up;
    }
  };
  for (let f = 0; f < warm + T; f++) {
    const o = off(f * DT);
    player.x = g.ax + o; player.z = g.az; player.y = g.ay;
    step(f >= warm);
  }
  const n = actors.length, mins = seconds / 60, sum = (k: 'arm' | 'flips' | 'walk' | 'frames' | 'inPlace') => st.reduce((a, x) => a + x[k], 0);
  const run: Run = {armPerMin: sum('arm') / n / mins, flipsPerMin: sum('flips') / n / mins, walked: g.distance, walkShare: sum('walk') / sum('frames'), inPlace: sum('inPlace') / sum('frames'), phaseFlips, maxArm: Math.max(...st.map(x => x.arm))};
  if (!attack) return {run, attack: null};
  // --- then the player steps into the crowd (alive, at the anchor): real attacks still raise the arms, with unchanged timing ---
  Object.assign(player, {x: g.ax, y: g.ay, z: g.az, alive: true});
  const seq = new Map(actors.map(z => [z, z.brain.attackSeq])), swingAt = new Map<Actor, number>();
  let attacks = 0, hits = 0, armUp = 0, attackClip = 0;
  const impacts: number[] = [];
  for (let f = 0; f < 6 * 60; f++) {
    step(false, (z, out) => {
      if (z.brain.attackSeq !== seq.get(z)) { attacks++; seq.set(z, z.brain.attackSeq); swingAt.set(z, f); } // a swing started this frame
      if (out.attackHit) { hits++; const f0 = swingAt.get(z); if (f0 !== undefined) impacts.push((f - f0) * DT); }
      if (clipOf(z) === 'Attack') { attackClip++; if (handH(z) > thr.hi) armUp++; }
    });
  }
  return {run, attack: {attacks, hits, armUp, attackClip, impacts}};
}

describe('distant ordinary-horde arms: near / far / crossing trace on the real rig (ai/horde.ts + game.ts animation gating)', () => {
  it('the base rule (no hysteresis) cycles the arms at every distance; the fix keeps calm walking members walking, arms steady', async () => {
    const gltf = await loadRig();
    // calibrate the arm pose of the clips: Idle (hanging) vs Walk (raised forward)
    let s = 3;
    const cal = new ZombieActor(gltf, {x: 0, z: 0, yaw: 0, type: 'shambler', area: 0}, () => ((s = (s * 16807) % 2147483647) / 2147483647));
    const hs: Record<'Idle' | 'Walk', number[]> = {Idle: [], Walk: []};
    for (const clip of ['Idle', 'Walk'] as const) for (let i = 0; i < 200; i++) { cal.animate(DT, clip, 0.5); cal.updateVolumes(); if (i > 30) hs[clip].push(handH(cal)); }
    const idleMax = Math.max(...hs.Idle), walkMin = Math.min(...hs.Walk);
    expect(walkMin - idleMax, 'Walk raises the hands well above Idle').toBeGreaterThan(0.15);
    const gap = walkMin - idleMax, thr = {lo: idleMax + gap * 0.3, hi: walkMin - gap * 0.3};
    const NEAR = () => 20, FAR = () => 55, CROSS32 = (t: number) => 32 + 4 * Math.sin(t * Math.PI / 3), CROSS45 = (t: number) => 45 + 4 * Math.sin(t * Math.PI / 3);
    const SECS = 40;
    // BEFORE: the base 1366b95 rule (settleR === arriveR is exactly the old `d < arriveR` stand test)
    const knob = HORDE_AI as unknown as {settleR: number};
    const keep = knob.settleR;
    let before: {near: Run; far: Run};
    try {
      knob.settleR = HORDE_AI.arriveR;
      before = {near: trace(gltf, NEAR, SECS, thr).run, far: trace(gltf, FAR, SECS, thr).run};
    } finally { knob.settleR = keep; }
    const after = {near: trace(gltf, NEAR, SECS, thr, true), far: trace(gltf, FAR, SECS, thr).run, cross32: trace(gltf, CROSS32, SECS, thr).run, cross45: trace(gltf, CROSS45, SECS, thr).run};
    const fmt = (r: Run) => `arm events ${r.armPerMin.toFixed(1)}/min (max member ${r.maxArm}), clip flips ${r.flipsPerMin.toFixed(1)}/min, walk ${(r.walkShare * 100).toFixed(0)} %, in place ${(r.inPlace * 100).toFixed(2)} %, walked ${r.walked.toFixed(1)} m, group stop/go ${r.phaseFlips}`;
    console.info(`[horde arms] ${SECS} s, 8 members, calm (player not perceivable)\n  BEFORE near: ${fmt(before.near)}\n  BEFORE far:  ${fmt(before.far)}\n` +
      `  AFTER near:  ${fmt(after.near.run)}\n  AFTER far:   ${fmt(after.far)}\n  AFTER x32:   ${fmt(after.cross32)}\n  AFTER x45:   ${fmt(after.cross45)}\n  attack: ${JSON.stringify(after.near.attack)}`);
    // reproduced: the old rule flips the clip every validate period, at every distance (aliased, not removed, by the far LOD)
    expect(before.near.armPerMin).toBeGreaterThan(100);
    expect(before.far.armPerMin).toBeGreaterThan(60);
    // fixed: near, far and both threshold crossings stay at the real stop / go rate (group pauses, corners), far below the bug
    for (const r of [after.near.run, after.far, after.cross32, after.cross45]) {
      expect(r.armPerMin).toBeLessThan(15);
      expect(r.armPerMin).toBeLessThan(before.near.armPerMin / 10);
      expect(r.flipsPerMin).toBeLessThan(15);
      expect(r.walkShare).toBeGreaterThan(0.6);      // locomotion continues (Walk clip while moving)
      expect(r.inPlace).toBeLessThan(0.02);          // no walking on the spot
      expect(r.walked).toBeGreaterThan(before.near.walked * 0.9); // the crowd keeps its patrol pace
    }
    // real attacks still raise the arms, with the brain's own timing (impact at attackImpact into the swing)
    const a = after.near.attack!;
    expect(a.attacks).toBeGreaterThan(0);
    expect(a.attackClip).toBeGreaterThan(0);
    expect(a.armUp).toBeGreaterThan(0);
    expect(a.hits).toBeGreaterThan(0);
    const impact = new ZombieBrain('shambler', 0, 0, 0).stats.attackImpact;
    expect(a.impacts.length).toBeGreaterThan(0);
    for (const t of a.impacts) expect(Math.abs(t - impact)).toBeLessThanOrEqual(DT * 1.5);
  }, 120_000);
});
