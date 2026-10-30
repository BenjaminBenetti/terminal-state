// Task office-overhaul-20261030 (lane AUDIO), user feedback #4: "In the office you can hear the zombies moaning that are above
// you … You should only hear enemies within a reasonable pathfind distance of you."
//
// On the REAL generated office level (one layout: station, lobby, floors 2-8 and whatever storeys / links the other lanes
// add): the shared navigable-distance field (ai/vocalReach.ts) and the Sfx vocal gate (audio/sfx.ts vocal()). CPU only; the
// audio checks use the fake WebAudio graph (they are not a listening test).

import {describe, expect, it} from 'vitest';
import {LEVELS} from '../src/levels/registry';
import {Levels, levelsOf, type DynamicVolume, type VolumeGate} from '../src/gen/levels';
import {CELL, PathFinder, type Waypoint} from '../src/gen/grid';
import {VOCAL_GATE, VOCAL_REACH, VocalReach, vocalGain} from '../src/ai/vocalReach';
import {Sfx, type VocalReachQuery} from '../src/audio/sfx';
import {FakeCtx, type Node, fakeBank} from './helpers/fakeAudio';

const SEED = 0x5ea1e55;
const layout = LEVELS.office.generate('main', {levelSeed: SEED, startWeapon: 'pistol'});
const office = layout.office!;
const L = levelsOf(layout);
const base = (lv: number) => layout.levels[lv].baseY;
const MOUTH = 1.6;
const EYE = 1.6;
const GROAN = {ref: 2.2, rolloff: 1.1};

/** Start a build at (x, y, z) and run it to completion; returns the number of update() calls it took. */
function settle(r: VocalReach, x: number, y: number, z: number): number {
  let n = 1;
  r.update(1, x, y, z);
  while (r.building && n < 5000) { r.update(1 / 60, x, y, z); n++; }
  return n;
}

const well = office.stairs.well;
const fromWell = (x: number, z: number) => Math.hypot(Math.max(well.x0 - x, 0, x - well.x1), Math.max(well.z0 - z, 0, z - well.z1));
const g = (lv: number) => L.grid(lv);
const flat = (lv: number, cx: number, cy: number) => g(lv).walkable(cx, cy) && Math.abs(g(lv).cellFloor(cx, cy) - base(lv)) < 0.05 && g(lv).rampIdx[cy * g(lv).w + cx] < 0;

/** Columns open (flat, prop-free) on storey F and on F + 1, farthest from the stairwell first. */
function stackedColumns(F: number): {x: number; z: number; d: number}[] {
  const out: {x: number; z: number; d: number}[] = [];
  const G = g(F);
  for (let cy = 0; cy < G.h; cy += 3) for (let cx = 0; cx < G.w; cx += 3) {
    if (!flat(F, cx, cy) || !flat(F + 1, cx, cy)) continue;
    const [x, z] = G.center(cx, cy);
    out.push({x, z, d: fromWell(x, z)});
  }
  return out.sort((a, b) => b.d - a.d);
}

/** Fake-context Sfx with the given reach + occlusion; listener at (x, eye, z). */
async function audio(reach: VocalReachQuery | null, occlusion: ((x: number, z: number, y?: number) => number) | null, at = {x: 0, y: EYE, z: 0}) {
  const made: FakeCtx[] = [];
  const {bank} = fakeBank({variants: 3});
  const sfx = new Sfx(() => { const c = new FakeCtx(); made.push(c); return c as unknown as AudioContext; }, bank);
  sfx.init();
  sfx.suspend(false);
  await new Promise(r => setTimeout(r, 40));
  const ctx = made[0];
  sfx.setListener(at.x, at.y, at.z, 0);
  sfx.setWorld({occlusion});
  sfx.setVocalReach(reach);
  const groans = new Set(['zombieGroan', 'zombieGroanDeep', 'creatureGrowl', 'creatureSnarl'].flatMap(c => bank.get(c as 'zombieGroan').map(k => k.buffer as unknown)));
  return {sfx, ctx, vocals: () => ctx.started.filter(s => groans.has(s.buffer)).length};
}

/** The voice input gain feeding a panner (voice in -> [air / occlusion lowpass] -> panner). */
function voiceGain(ctx: FakeCtx, panner: Node): number {
  let n: Node | undefined = ctx.nodes.find(m => m.outputs.includes(panner));
  if (n && 'frequency' in n) n = ctx.nodes.find(m => m.outputs.includes(n!));
  return (n as unknown as {gain: {value: number}}).gain.value;
}
const panners = (ctx: FakeCtx) => ctx.nodes.filter(n => n.kind === 'panner');

describe('vocal reach: the navigable-distance field on the real office level', () => {
  it('snapshots every storey of the level without searching (cheap construction, bounded memory)', () => {
    const t0 = performance.now();
    const r = new VocalReach(L);
    const ms = performance.now() - t0;
    process.stdout.write(`\n[vocal-reach] office grid ${r.W}x${r.H} x ${r.NL} levels = ${r.W * r.H * r.NL} nodes; construct ${ms.toFixed(1)} ms\n`);
    expect(r.NL).toBe(layout.levels.length);
    expect(r.NL).toBeGreaterThanOrEqual(9);
    expect(r.ready).toBe(false);
    expect(r.pathTo(office.start.x, MOUTH, office.start.z)).toBe(Infinity); // no field yet: nothing is "near"
    expect(r.stats.builds).toBe(0);
  });

  it('an enemy directly above the player (next floor, long stair route) is silent or strongly attenuated', () => {
    const r = new VocalReach(L);
    const F = 4;
    const cols = stackedColumns(F);
    expect(cols.length).toBeGreaterThan(20);
    // the column farthest from the stairwell: the classic "zombie moaning right above me"
    const far = cols[0];
    settle(r, far.x, base(F), far.z);
    const above = r.pathTo(far.x, base(F + 1) + MOUTH, far.z);
    const straight = base(F + 1) - base(F);
    process.stdout.write(`[vocal-reach] above (well ${far.d.toFixed(1)} m away): route ${above.toFixed(1)} m vs straight ${straight.toFixed(1)} m\n`);
    expect(above).toBeGreaterThan(VOCAL_GATE.idle.limit); // beyond the idle limit (or Infinity): not played at all
    expect(vocalGain(above, straight, VOCAL_GATE.idle.limit, VOCAL_GATE.idle.fade, GROAN.ref, GROAN.rolloff)).toBe(0);
    // every column at least 8 m from the stairwell: strongly attenuated (>= 12 dB below the straight line) or silent
    let worst = 0, silent = 0, n = 0;
    for (const c of cols.filter(c => c.d >= 8).slice(0, 40)) {
      settle(r, c.x, base(F), c.z);
      const p = r.pathTo(c.x, base(F + 1) + MOUTH, c.z);
      const gain = vocalGain(p, straight, VOCAL_GATE.idle.limit, VOCAL_GATE.idle.fade, GROAN.ref, GROAN.rolloff);
      worst = Math.max(worst, gain);
      if (gain === 0) silent++;
      n++;
    }
    process.stdout.write(`[vocal-reach] ${n} stacked columns >= 8 m from the well: worst gain ${worst.toFixed(3)}, silent ${silent}\n`);
    expect(n).toBeGreaterThan(5);
    expect(worst).toBeLessThan(0.25);
    // two floors up through two slabs: never heard
    settle(r, far.x, base(F), far.z);
    expect(r.pathTo(far.x, base(F + 2) + MOUTH, far.z)).toBe(Infinity);
  });

  it('an enemy on the same floor 10 m away along an open line is audible at (nearly) full level', () => {
    const r = new VocalReach(L);
    let found: {x: number; z: number; F: number} | null = null;
    for (let F = 2; F <= 8 && !found; F++) {
      const G = g(F);
      for (let cy = 2; cy < G.h - 2 && !found; cy += 2) for (let cx = 2; cx + 20 < G.w && !found; cx += 2) {
        let ok = true;
        for (let k = 0; k <= 20 && ok; k++) ok = flat(F, cx + k, cy) && flat(F, cx + k, cy - 1) && flat(F, cx + k, cy + 1);
        if (ok) { const [x, z] = G.center(cx, cy); found = {x, z, F}; }
      }
    }
    expect(found).not.toBeNull();
    const {x, z, F} = found!;
    settle(r, x, base(F), z);
    const p = r.pathTo(x + 10, base(F) + MOUTH, z);
    expect(p).toBeGreaterThan(9.5);
    expect(p).toBeLessThan(10.6);
    expect(vocalGain(p, 10, VOCAL_GATE.idle.limit, VOCAL_GATE.idle.fade, GROAN.ref, GROAN.rolloff)).toBeGreaterThan(0.95);
  });

  it('a same-floor enemy behind a long detour is attenuated by the route length (matches the game PathFinder route)', () => {
    const r = new VocalReach(L);
    const pf = new PathFinder(L);
    let best: {px: number; pz: number; qx: number; qz: number; F: number; path: number; straight: number} | null = null;
    for (let F = 2; F <= 8 && !best; F++) {
      const G = g(F);
      for (let cy = 4; cy < G.h - 4 && !best; cy += 7) for (let cx = 4; cx < G.w - 4 && !best; cx += 7) {
        if (!flat(F, cx, cy)) continue;
        const [px, pz] = G.center(cx, cy);
        settle(r, px, base(F), pz);
        for (let oy = -12; oy <= 12 && !best; oy++) for (let ox = -12; ox <= 12; ox++) {
          const s = Math.hypot(ox, oy) * CELL;
          if (s < 3 || s > 6 || !flat(F, cx + ox, cy + oy)) continue;
          const [qx, qz] = G.center(cx + ox, cy + oy);
          const p = r.pathTo(qx, base(F) + MOUTH, qz);
          if (Number.isFinite(p) && p >= 4 * s) { best = {px, pz, qx, qz, F, path: p, straight: s}; break; }
        }
      }
    }
    expect(best, 'a wall with a long way round on some floor').not.toBeNull();
    const b = best!;
    // the independent check: the game's own A* route between the same two points
    const route: Waypoint[] | null = pf.find(b.px, b.pz, b.qx, b.qz, 0.3, 400000, {ay: base(b.F), by: base(b.F)});
    expect(route).not.toBeNull();
    let len = 0, ax = b.px, az = b.pz;
    for (const [wx, wz] of route!) { len += Math.hypot(wx - ax, wz - az); ax = wx; az = wz; }
    process.stdout.write(`[vocal-reach] detour on floor ${b.F}: straight ${b.straight.toFixed(1)} m, field ${b.path.toFixed(1)} m, A* route ${len.toFixed(1)} m\n`);
    expect(b.path).toBeGreaterThan(len * 0.85 - 1);
    expect(b.path).toBeLessThan(len * 1.25 + 1.5);
    const gain = vocalGain(b.path, b.straight, VOCAL_GATE.idle.limit, VOCAL_GATE.idle.fade, GROAN.ref, GROAN.rolloff);
    expect(gain).toBeLessThan(0.5); // >= 6 dB below what the straight line through the wall gave
  });

  it('rebuilds at a bounded rate over a simulated walk (station -> lobby -> floor 3) and never while standing still', () => {
    const r = new VocalReach(L);
    const pf = new PathFinder(L);
    const landing = office.stairs.landings.find(l => l.floor === 3)!;
    const route = pf.find(office.start.x, office.start.z, landing.x, landing.z, 0.3, 400000, {ay: base(office.start.level), by: base(landing.levelId)});
    expect(route).not.toBeNull();
    // walk the polyline at 3.4 m/s, 60 fps (feet on each waypoint's floor height, linearly between)
    const DT = 1 / 60, SPEED = 3.4;
    let x = office.start.x, z = office.start.z, y = base(office.start.level), t = 0, frames = 0;
    for (const [wx, wz, , wy] of route!) {
      const ty = wy ?? y;
      for (;;) {
        const d = Math.hypot(wx - x, wz - z);
        if (d < 1e-6) break;
        const s = Math.min(d, SPEED * DT), k = s / d;
        x += (wx - x) * k; z += (wz - z) * k; y += (ty - y) * k;
        r.update(DT, x, y, z); t += DT; frames++;
      }
    }
    const walked = r.stats.builds;
    process.stdout.write(`[vocal-reach] walk ${t.toFixed(1)} s, ${frames} frames: ${walked} builds (${(walked / t).toFixed(2)} Hz), ${r.stats.completed} completed, max ${r.stats.maxStep} settles / frame, max ${r.stats.maxStepMs.toFixed(2)} ms / frame, field ${r.stats.nodes} nodes\n`);
    expect(t).toBeGreaterThan(10);
    expect(walked).toBeGreaterThan(t * 0.8); // it does follow the player
    expect(walked).toBeLessThanOrEqual(Math.ceil(t / VOCAL_REACH.minInterval) + 1); // <= 2.5 Hz
    expect(walked).toBeLessThan(frames / 15); // nowhere near once per frame
    expect(r.stats.maxStep).toBeLessThanOrEqual(r.budget);
    // standing still: after the build that catches up with the stop, no rebuild at all
    for (let i = 0; i < 60; i++) r.update(DT, x, y, z);
    const caught = r.stats.builds;
    expect(caught).toBeLessThanOrEqual(walked + 1);
    for (let i = 0; i < 600; i++) r.update(DT, x, y, z);
    expect(r.stats.builds).toBe(caught);
    // arrived on floor 3: a zombie on floor 3's landing area is near, one in the station far below is not
    expect(r.pathTo(landing.x + 1, base(3) + MOUTH, landing.z)).toBeLessThan(4);
    expect(r.pathTo(office.start.x, base(0) + MOUTH, office.start.z)).toBe(Infinity);
    // warm (JIT-compiled) cost per frame: walk the route back down (diagnostic print; no wall-clock assertion on the shared pod)
    r.stats.maxStepMs = 0;
    for (const [wx, wz, , wy] of route!.slice().reverse()) {
      const ty = wy ?? y;
      for (;;) {
        const d = Math.hypot(wx - x, wz - z);
        if (d < 1e-6) break;
        const s = Math.min(d, SPEED * DT), k = s / d;
        x += (wx - x) * k; z += (wz - z) * k; y += (ty - y) * k;
        r.update(DT, x, y, z);
      }
    }
    process.stdout.write(`[vocal-reach] warm walk back: max ${r.stats.maxStepMs.toFixed(2)} ms / frame (budget ${r.budget} settles)\n`);
    expect(r.stats.maxStep).toBeLessThanOrEqual(r.budget);
  });

  it('per-frame cost is bounded: settles per update <= budget, field nodes <= cap, a build spans frames', () => {
    const small = new VocalReach(L, {budget: 400, maxNodes: 2500});
    const F = 5, c = stackedColumns(F)[0];
    const updates = settle(small, c.x, base(F), c.z);
    expect(small.ready).toBe(true);
    expect(small.stats.maxStep).toBeLessThanOrEqual(400);
    expect(small.stats.nodes).toBeLessThanOrEqual(2500);
    expect(updates).toBeGreaterThan(1); // time-sliced over several frames
    // the cap keeps the NEAREST nodes: right here is known, the far end of the floor is not
    expect(small.pathTo(c.x, base(F) + MOUTH, c.z)).toBeLessThan(1);
    // the default field on the same spot stays within its own caps
    const r = new VocalReach(L);
    settle(r, c.x, base(F), c.z);
    expect(r.stats.nodes).toBeLessThanOrEqual(VOCAL_REACH.maxNodes);
    expect(r.stats.maxStep).toBeLessThanOrEqual(VOCAL_REACH.budget);
    process.stdout.write(`[vocal-reach] default field at floor ${F}: ${r.stats.nodes} nodes, ${r.stats.completed} build, max ${r.stats.maxStepMs.toFixed(2)} ms / update\n`);
  });

  it('a build in progress keeps the previous field answering (double buffer) and a teleport drops a stale field', () => {
    const r = new VocalReach(L, {budget: 300});
    const F = 3, a = stackedColumns(F).find(c => { const [cx, cy] = g(F).cellOf(c.x, c.z); return flat(F + 3, cx, cy); })!;
    expect(a).toBeTruthy();
    settle(r, a.x, base(F), a.z);
    const here = r.pathTo(a.x, base(F) + MOUTH, a.z);
    expect(here).toBeLessThan(1);
    // step 2 m: a new build starts; until it completes the old field answers (no Infinity flicker)
    r.update(1, a.x + 2, base(F), a.z);
    if (r.building) expect(r.pathTo(a.x, base(F) + MOUTH, a.z)).toBe(here);
    // teleport to another floor: the old field is dropped at once (nothing wrongly "near")
    r.update(1, a.x, base(F + 3), a.z);
    expect(r.stats.invalidated).toBeGreaterThan(0);
    settle(r, a.x, base(F + 3), a.z);
    expect(r.pathTo(a.x, base(F + 3) + MOUTH, a.z)).toBeLessThan(1);
    expect(r.pathTo(a.x, base(F) + MOUTH, a.z)).toBe(Infinity);
  });
});

describe('vocal reach: the elevator cab (lane LIFT dynamic volume)', () => {
  // A private Levels (the shared levelsOf cache stays volume-free for the other tests), with the cab volume as
  // world/towerRuntime.ts registers it.
  const E = office.elevator;
  const LV = new Levels(layout.levels, layout.levelLinks, layout.rails);
  const [nx, nz] = E.doorSide === 'N' ? [0, -1] : E.doorSide === 'S' ? [0, 1] : E.doorSide === 'W' ? [-1, 0] : [1, 0];
  const along = nx !== 0 ? E.door.z : E.door.x;
  const depth = nx > 0 ? E.shaft.x1 - E.cab.x1 : nx < 0 ? E.cab.x0 - E.shaft.x0 : nz > 0 ? E.shaft.z1 - E.cab.z1 : E.cab.z0 - E.shaft.z0;
  const gate: VolumeGate = {side: E.doorSide, a0: along - E.door.width / 2, a1: along + E.door.width / 2, depth: depth > 0.05 ? depth : 0.5, height: 2.2, open: false};
  const stop = E.stops.find(s => s.floor === 4)!;
  const vol: DynamicVolume = {x0: E.cab.x0, z0: E.cab.z0, x1: E.cab.x1, z1: E.cab.z1, floorY: stop.y, ceilY: stop.y + E.cabHeight, level: stop.levelId, gates: [gate], stops: E.stops.map(s => s.y), name: 'elevator-cab'};
  LV.addDynamicVolume(vol);
  const cab = {x: (E.cab.x0 + E.cab.x1) / 2, z: (E.cab.z0 + E.cab.z1) / 2};
  const out = {x: stop.landing.x, z: stop.landing.z}; // the walkable stand point just outside the doors (a zombie / the player)

  it('in the cab with the doors shut, an enemy just outside on the landing is not near; doors open, it is', () => {
    const r = new VocalReach(LV);
    vol.floorY = stop.y; vol.ceilY = stop.y + E.cabHeight; gate.open = false;
    settle(r, cab.x, stop.y, cab.z);
    expect(r.ready).toBe(true);
    expect(r.pathTo(out.x, stop.y + MOUTH, out.z)).toBe(Infinity);
    gate.open = true;
    r.update(1, cab.x, stop.y, cab.z); // the seed set changed (open gate): rebuild
    settle(r, cab.x, stop.y, cab.z);
    const d = r.pathTo(out.x, stop.y + MOUTH, out.z);
    process.stdout.write(`[vocal-reach] cab doors open: landing enemy route ${d.toFixed(1)} m (straight ${Math.hypot(out.x - cab.x, out.z - cab.z).toFixed(1)} m)\n`);
    expect(d).toBeLessThan(Math.hypot(out.x - cab.x, out.z - cab.z) + 3);
    gate.open = false;
  });

  it('an enemy in the same moving cab is near; from the landing, an enemy in the cab is reached only through open doors', () => {
    const r = new VocalReach(LV);
    // riding between floors 4 and 5, doors shut
    vol.floorY = stop.y + 2; vol.ceilY = vol.floorY + E.cabHeight; gate.open = false;
    settle(r, cab.x - 0.4, vol.floorY, cab.z);
    expect(r.pathTo(cab.x + 0.4, vol.floorY + MOUTH, cab.z)).toBeLessThan(2.5);
    // player on floor 4's landing, the cab at the stop with an enemy inside
    vol.floorY = stop.y; vol.ceilY = stop.y + E.cabHeight;
    const r2 = new VocalReach(LV);
    settle(r2, out.x, stop.y, out.z);
    expect(r2.pathTo(cab.x, stop.y + MOUTH, cab.z)).toBe(Infinity); // shut doors
    gate.open = true;
    expect(r2.pathTo(cab.x, stop.y + MOUTH, cab.z)).toBeLessThan(Math.hypot(out.x - cab.x, out.z - cab.z) + 3);
    gate.open = false;
  });
});

describe('vocal gate in the Sfx (fake WebAudio graph)', () => {
  it('on the real office field: the groan directly above is not played, the same-floor one 10 m away plays at full level', async () => {
    const r = new VocalReach(L);
    const F = 4, c = stackedColumns(F)[0];
    settle(r, c.x, base(F), c.z);
    const ear = {x: c.x, y: base(F) + EYE, z: c.z}; // the game's soundOccluded(): 3D sight from the player's eye
    const occlusion = (x: number, z: number, y?: number) => (L.lineOfSight(ear, {x, y: (y ?? 0) + 0.05, z}, {slack: 0.3}) ? 0 : 1);
    const {sfx, ctx, vocals} = await audio(r, occlusion, ear);
    sfx.groan(c.x, base(F + 1) + MOUTH, c.z, false);
    expect(vocals()).toBe(0);
    expect(sfx.debugState().vocal.gated).toBe(1);
    // same floor, an open run of floor 10 m from a flat cell: plays, gain ~1 (straight route, in sight)
    const G = g(F);
    let spot: [number, number] | null = null;
    for (let cy = 2; cy < G.h - 2 && !spot; cy++) for (let cx = 2; cx + 20 < G.w && !spot; cx++) {
      let ok = true;
      for (let k = 0; k <= 20 && ok; k++) ok = flat(F, cx + k, cy) && flat(F, cx + k, cy - 1) && flat(F, cx + k, cy + 1);
      if (ok) spot = G.center(cx, cy);
    }
    expect(spot).not.toBeNull();
    const [sx, sz] = spot!;
    settle(r, sx, base(F), sz);
    ear.x = sx; ear.z = sz;
    sfx.setListener(sx, base(F) + EYE, sz, 0);
    const p0 = panners(ctx).length;
    ctx.currentTime += 5;
    sfx.groan(sx + 10, base(F) + MOUTH, sz, false);
    expect(vocals()).toBe(1);
    expect(panners(ctx).length).toBe(p0 + 1);
    expect(voiceGain(ctx, panners(ctx).at(-1)!)).toBeGreaterThan(0.95);
  });

  it('caps simultaneous enemy vocals; the nearest win (a nearer one fades out the farthest)', async () => {
    const straight: VocalReachQuery = {pathTo: (x, y, z) => Math.hypot(x, y - EYE, z)};
    // descending distances: every new one is nearer -> takes the farthest slot
    {
      const {sfx, vocals} = await audio(straight, () => 0);
      for (const d of [24, 21, 18, 15, 12, 9, 6, 3]) sfx.groan(d, MOUTH, 0, false);
      const v = sfx.debugState().vocal;
      expect(v.voices).toBe(VOCAL_GATE.cap);
      expect(v.stolen).toBe(5);
      expect(v.capped).toBe(0);
      expect(vocals()).toBe(8); // each started, the farther ones were faded out
    }
    // ascending distances: the cap holds the nearest three, the farther ones never start
    {
      const {sfx, vocals} = await audio(straight, () => 0);
      for (const d of [3, 6, 9, 12, 15, 18, 21, 24]) sfx.groan(d, MOUTH, 0, false);
      const v = sfx.debugState().vocal;
      expect(v.voices).toBe(VOCAL_GATE.cap);
      expect(v.capped).toBe(5);
      expect(vocals()).toBe(3);
    }
    // the cap also holds without a reach source (straight-line worlds), and a finished vocal frees its slot
    {
      const {sfx, ctx, vocals} = await audio(null, null);
      for (let i = 0; i < 10; i++) sfx.creature('growl', 2 + i, 0.35, 0);
      expect(sfx.debugState().vocal.voices).toBe(VOCAL_GATE.cap);
      ctx.currentTime += 5;
      sfx.creature('snarl', 4, 0.35, 0, true);
      expect(vocals()).toBe(VOCAL_GATE.cap + 1);
    }
  });

  it('combat / hit-confirm / pain / attack / death cues are never gated, even with every route out of reach', async () => {
    const none: VocalReachQuery = {pathTo: () => Infinity};
    const {sfx, ctx, vocals} = await audio(none, () => 1); // nothing in sight either
    const z = {};
    const calls: Record<string, () => void> = {
      shot: () => sfx.shot('rifle'), impact: () => sfx.impact(3, 1, 3, 'concrete'), breakage: () => sfx.breakage('breakGlass', 3, 1, 3),
      hitConfirm: () => { sfx.shot('pistol'); sfx.hitConfirm(0, 1.4, -20, z); }, hitTick: () => sfx.hitTick(true), hurt: () => sfx.hurt(), death: () => sfx.death(),
      zombieAttack: () => sfx.zombieAttack(1, 1.5, 1), zombieDeath: () => sfx.zombieDeath(3, 1.4, 3), bodyFall: () => sfx.bodyFall(2, 0, 2, 1),
      bite: () => sfx.creature('bite', 1, 0.32, 1), yelp: () => sfx.creature('yelp', 3, 0.35, 3), creatureDeath: () => sfx.creature('death', 3, 0.3, 3),
      sameStoreyStep: () => sfx.zombieStep(2, 2, false, 1, 0),
    };
    for (const [name, f] of Object.entries(calls)) {
      ctx.currentTime += 5;
      const s0 = ctx.started.length;
      f();
      expect(ctx.started.length, name).toBeGreaterThan(s0);
    }
    // the vocals and a footfall on the storey above are gated
    ctx.currentTime += 5;
    const s0 = ctx.started.length;
    sfx.groan(3, MOUTH, 3, false);
    sfx.groan(3, MOUTH, 3, true, true);
    sfx.creature('growl', 3, 0.35, 3);
    sfx.creature('snarl', 3, 0.35, 3, true);
    sfx.zombieStep(2, 2, true, 1, 4.4);
    expect(ctx.started.length).toBe(s0);
    expect(vocals()).toBe(0);
    expect(sfx.debugState().vocal.gated).toBe(4);
    expect(sfx.debugState().vocal.steps).toBe(1);
  });

  it('a vocal source in clear line of sight is heard by the straight line even when its route is long', async () => {
    const none: VocalReachQuery = {pathTo: () => Infinity};
    const {sfx, vocals} = await audio(none, () => 0);
    sfx.groan(6, MOUTH + 2, 0, false, true); // across an open stairwell, in sight
    expect(vocals()).toBe(1);
    expect(sfx.debugState().vocal.sight).toBe(1);
  });

  it('attenuates by the route: the same source is quieter along a long detour than along a straight route', async () => {
    let route = 8;
    const r: VocalReachQuery = {pathTo: () => route};
    const {sfx, ctx} = await audio(r, () => 0);
    sfx.groan(8, MOUTH, 0, false);
    const straightGain = voiceGain(ctx, panners(ctx).at(-1)!);
    route = 26;
    ctx.currentTime += 5;
    sfx.groan(8, MOUTH, 0, false);
    const detourGain = voiceGain(ctx, panners(ctx).at(-1)!);
    expect(straightGain).toBeGreaterThan(0.95);
    expect(detourGain).toBeLessThan(straightGain * 0.35);
    expect(detourGain).toBeCloseTo(vocalGain(26, 8, VOCAL_GATE.idle.limit, VOCAL_GATE.idle.fade, GROAN.ref, GROAN.rolloff), 5);
  });
});

describe('vocal reach on the Subway (same engine; only the vocal gate changes there)', () => {
  it('builds a bounded field from the platform start and reaches the station around the player', () => {
    const sub = LEVELS.subway.generate('main', {levelSeed: 20261030, startWeapon: 'pistol'});
    const SL = levelsOf(sub);
    const r = new VocalReach(SL);
    const s = sub.playerSpawn;
    const y = SL.grid(0).floorAt(s.x, s.z);
    settle(r, s.x, y, s.z);
    expect(r.ready).toBe(true);
    expect(r.stats.nodes).toBeGreaterThan(200);
    expect(r.stats.nodes).toBeLessThanOrEqual(VOCAL_REACH.maxNodes);
    expect(r.pathTo(s.x, y + MOUTH, s.z)).toBeLessThan(1);
    process.stdout.write(`[vocal-reach] subway ${r.W}x${r.H} x ${r.NL}: field ${r.stats.nodes} nodes\n`);
  });
});
