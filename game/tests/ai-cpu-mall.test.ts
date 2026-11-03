// Task studio-performance-recorder-20261103-043629-01 (lane AI-CPU). User: "stuttering on new visuals is defiantly worse now,
// especially turning the camera around in the mall causes the spike. CPU spike for sure." / "I think it could also be NPC / path
// find related."
//
// MEASURED (Node, tests/helpers/aiCpuSim.ts: Game.updateZombies on the REAL generated Mall with the REAL enemy actors — wardrobe
// zombies incl. the lingerie store's variants, dormant Sirens, Blightbellies, rat/dogs —, the horde director, the path service on
// a frame budget, the chase share, the vocal-reach field and the flashlight lure; the player walking / turning with gunfire):
//  - the Mall's AI spike frames are single SYNCHRONOUS PATH SEARCHES (top-10 AI frames: 76-92 % path; one search 20-35 ms, the
//    worst 52-95 ms); brains / sight, motor, the vocal field and animation are a steady 1-2 ms with no spikes of their own;
//  - camera turning reaches the AI only through the FLASHLIGHT (the lure): its sweeping spot sends enemies investigating — an
//    immediate (never deferred) full search re-planned every 0.8 s while the spot moves > 1.5 m (59 of 354 searches, 360 ms in a
//    tour); without the flashlight the AI does not depend on the camera at all;
//  - where the time went: string pulling (75 % of a heavy search: 1,000-1,800 walk probes, 99 % failing — 62 % of them at the
//    probe's own start, 81 % of the rest at a railing), and an A* loop running inside a generator (engines do not OSR it: the same
//    22k-expansion search 45-92 ms where the plain loop runs in 8-15 ms).
// FIXED (gen/grid.ts PathFinder, gen/levels.ts walk tests) with IDENTICAL results — the same paths, expansions, yields; nothing
// about counts, timing semantics, RNG or behaviour changes:
//  - probes whose shared first sample (the anchor itself) is blocked are not run (they could only fail);
//  - inside a string-pulling batch, walk tests read per-column summaries instead of four level grids per sample, evaluate the
//    same conjunction cheapest-first (feet chain + every 6th circle, end height, the other circles, the segment's rails);
//  - railCrosses tests each rail once per query (they are listed in every column of their box), segSegDist without closures;
//  - the A* loop is a plain method (heap + heuristic on locals), resumed across the same chunk boundaries.
// PINNED HERE: exact equality with an executable pre-change reference (tests/helpers/pathRef.ts) on the real Mall / Subway / Office
// / Reactor; batch vs plain walks with an elevator volume; chunked = unchunked; the real-actor Mall sim behaves identically with
// and without the walk batches (every frame: states, positions, yaws, the search sequence, RNG draws) and runs far fewer walk
// probes / circle tests; no allocation per probe / search; one skeleton per actor (the lingerie garments add no mixer / skeleton).
// Timings are reported (LL_AICPU_OUT=/tmp/x.txt), never asserted (Node on a shared pod: trends, not native frame times).

import {appendFileSync, writeFileSync} from 'node:fs';
import * as THREE from 'three';
import {beforeAll, describe, expect, it} from 'vitest';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {installCanvasShim} from './helpers/canvas2d';
import {LEVELS} from '../src/levels/registry';
import {codeToSeed, mulberry32} from '../src/core/rng';
import {Levels, WALK_STRIDE, type DynamicVolume} from '../src/gen/levels';
import {CELL, PathFinder, type NavLevels, type PathOpts, type Waypoint} from '../src/gen/grid';
import type {StationLayout} from '../src/gen/stationTypes';
import {refCircleClear, refFind, refRailCrosses, type RefStats} from './helpers/pathRef';
import {aiCpuSim, dist, loadEnemyModels, routeThrough, type FrameCost, type SimRoutePoint} from './helpers/aiCpuSim';

installCanvasShim(false);
const OUT = process.env.LL_AICPU_OUT;
const out = (s: string) => { if (OUT) appendFileSync(OUT, s + '\n'); };
if (OUT) writeFileSync(OUT, '');

const gen = (lv: string, seed: number) => (LEVELS as unknown as Record<string, {generate(s: string, c: object): StationLayout}>)[lv].generate('main', {levelSeed: seed, startWeapon: 'pistol'});
const levelsOfLayout = (layout: StationLayout) => layout.levels?.length ? new Levels(layout.levels, layout.levelLinks ?? [], layout.rails) : new Levels([{id: 0, role: 'main', grid: layout.grid, baseY: 0}], layout.levelLinks ?? [], layout.rails);
const T3A = codeToSeed('t3a')!; // the lead's Mall QA seed (browser repro: ?level=mall&mallSeed=t3a)

/** The same levels WITHOUT the walk batch / start test (PathFinder then string-pulls with plain walkLineClear calls). */
function plain(L: Levels): NavLevels {
  return {list: L.list, crossLinks: () => L.crossLinks(), supportIn: (x, z, y, t) => L.supportIn(x, z, y, t),
    walkLineClear: (ax, ay, az, bx, bz, r, by) => L.walkLineClear(ax, ay, az, bx, bz, r, by), blockedEdges: () => L.blockedEdges()};
}

/** Seeded queries between standable points (random storeys; half of them local), the game's search options / bounds. */
function queries(L: Levels, seed: number, n: number): {a: [number, number, number, number]; op: PathOpts; exp: number}[] {
  const rand = mulberry32(seed), pts: {x: number; z: number; y: number}[] = [];
  for (let k = 0; pts.length < 300 && k < 200000; k++) {
    const g = L.grid(Math.floor(rand() * L.count)), cx = Math.floor(rand() * g.w), cy = Math.floor(rand() * g.h);
    if (!g.passable(cx, cy)) continue;
    const [x, z] = g.center(cx, cy);
    pts.push({x: x + (rand() - 0.5) * 0.4, z: z + (rand() - 0.5) * 0.4, y: g.cellFloor(cx, cy)});
  }
  const qs: {a: [number, number, number, number]; op: PathOpts; exp: number}[] = [];
  while (qs.length < n) {
    const a = pts[Math.floor(rand() * pts.length)];
    const near = pts.filter(p => Math.hypot(p.x - a.x, p.z - a.z) < 10);
    const b = rand() < 0.5 && near.length ? near[Math.floor(rand() * near.length)] : pts[Math.floor(rand() * pts.length)];
    const local = rand() < 0.25;
    qs.push({a: [a.x, a.z, b.x, b.z], op: {ay: a.y, by: b.y, ...(rand() < 0.6 ? {drops: true} : {}), ...(rand() < 0.2 ? {noLinks: true} : {}), ...(local ? {local: true} : {})} as PathOpts, exp: local ? 1200 : 26000});
  }
  return qs;
}

/** A resumable search to the end: [yields, result]. */
function chunked(P: PathFinder, q: {a: [number, number, number, number]; op: PathOpts; exp: number}, chunk: number): [number, Waypoint[] | null] {
  const it = P.search(q.a[0], q.a[1], q.a[2], q.a[3], 0.34, q.exp, q.op, chunk);
  let y = 0, r = it.next();
  while (!r.done) { y++; r = it.next(); }
  return [y, r.value];
}

const WORLDS: [string, number][] = [['mall', T3A], ['mall', 32451], ['subway', 1], ['office', 4242], ['reactor', 70]];

describe('path search: identical to the pre-change search (tests/helpers/pathRef.ts)', () => {
  for (const [lv, seed] of WORLDS) {
    it(`${lv} ${seed}: the same paths and expansions as the reference; chunked (1000 / 37 units) = unchunked`, () => {
      const layout = gen(lv, seed), L = levelsOfLayout(layout), R = levelsOfLayout(layout);
      const P = new PathFinder(L), F = P.fork(), ref = new PathFinder(R);
      let tNew = 0, tRef = 0, probesRef = 0, probesNew = 0, counting = false;
      const walk = L.walkLineClear.bind(L);
      (L as {walkLineClear: Levels['walkLineClear']}).walkLineClear = (...a) => { if (counting) probesNew++; return walk(...a); };
      const qs = queries(R, seed ^ 0x51, 90);
      qs.forEach((q, k) => {
        const st: RefStats = {expanded: 0, probes: 0};
        let t = performance.now();
        const want = refFind(ref, R, q.a[0], q.a[1], q.a[2], q.a[3], 0.34, q.exp, q.op, st);
        tRef += performance.now() - t;
        probesRef += st.probes;
        counting = true;
        t = performance.now();
        const got = P.find(q.a[0], q.a[1], q.a[2], q.a[3], 0.34, q.exp, q.op);
        tNew += performance.now() - t;
        counting = false;
        expect(got, `${lv} q${k} ${JSON.stringify(q)}`).toEqual(want);
        if (want) expect(P.lastExpanded, `${lv} q${k} expansions`).toBe(st.expanded);
        if (k % 6 === 0) {
          const [y1000, r1000] = chunked(F, q, 1000), [y37, r37] = chunked(F, q, 37);
          expect(r1000).toEqual(want);
          expect(r37).toEqual(want);
          expect(y37).toBeGreaterThanOrEqual(y1000);
        }
      });
      out(`[pathRef] ${lv} ${seed}: ${qs.length} queries identical; search ms ref ${tRef.toFixed(0)} -> ${tNew.toFixed(0)} (x${(tRef / tNew).toFixed(2)}), walk probes ${probesRef} -> ${probesNew}`);
      expect(probesNew).toBeLessThanOrEqual(probesRef); // never more probes (blocked anchors run none)
    }, 120000);
  }

  it('walk primitives: circleClear / railCrosses equal the pre-change forms at random points, feet and radii (Mall t3a, Office)', () => {
    for (const [lv, seed] of [['mall', T3A], ['office', 4242]] as const) {
      const L = levelsOfLayout(gen(lv, seed)), rand = mulberry32(seed), g0 = L.main;
      const floors = [...new Set(L.list.flatMap(l => [l.baseY, l.baseY + 0.2, l.baseY + 1.3]))];
      for (let k = 0; k < 20000; k++) {
        const x = rand() * g0.w * CELL, z = rand() * g0.h * CELL, feet = floors[Math.floor(rand() * floors.length)] + (rand() - 0.5) * 0.6, r = [0.17, 0.3, 0.34, 0.45][k % 4];
        expect(L.circleClear(x, z, r, feet), `${lv} circle ${x} ${z} ${r} ${feet}`).toBe(refCircleClear(L, x, z, r, feet));
        const x2 = x + (rand() - 0.5) * 12, z2 = z + (rand() - 0.5) * 12;
        expect(L.railCrosses(x, z, x2, z2, r * 0.5, feet), `${lv} rails ${x} ${z} ${x2} ${z2}`).toBe(refRailCrosses(L, x, z, x2, z2, r * 0.5, feet));
      }
    }
  });

  it('with a dynamic volume (an elevator cab in the Mall pit, gate open / closed): batched string pulling = plain walks', () => {
    const layout = gen('mall', T3A), L = levelsOfLayout(layout);
    const v = layout.mall!.void.bounds, cx = Math.round((v.x0 + v.x1) / 2), cz = Math.round((v.z0 + v.z1) / 2);
    const floor = L.grid(0).floorAt(cx, cz);
    const vol: DynamicVolume = {x0: cx - 1, z0: cz - 1, x1: cx + 1, z1: cz + 1, floorY: floor, ceilY: floor + 2.6, level: 0, gates: [{side: 'N', a0: cx - 0.5, a1: cx + 0.5, depth: 0.5, height: 2.2, open: true}]};
    L.addDynamicVolume(vol);
    const P = new PathFinder(L), Q = new PathFinder(plain(L));
    const qs = queries(L, 0x7e1, 60).map(q => ({...q, a: [q.a[0], q.a[1], cx + (q.a[2] - cx) * 0.15, cz + (q.a[3] - cz) * 0.15] as [number, number, number, number]}));
    for (const open of [true, false]) {
      vol.gates[0].open = open;
      for (const q of qs) {
        expect(P.find(q.a[0], q.a[1], q.a[2], q.a[3], 0.34, q.exp, q.op)).toEqual(Q.find(q.a[0], q.a[1], q.a[2], q.a[3], 0.34, q.exp, q.op));
        expect(P.lastExpanded).toBe(Q.lastExpanded);
      }
    }
  });

  it('no allocation per probe or per search: the walk batch tables, the feet chain and the A* heap are reused', () => {
    const layout = gen('mall', T3A), L = levelsOfLayout(layout), P = new PathFinder(L);
    const qs = queries(L, 0xa110c, 40);
    for (const q of qs) P.find(q.a[0], q.a[1], q.a[2], q.a[3], 0.34, q.exp, q.op); // warm-up: tables sized
    const priv = () => { const l = L as unknown as {walkMemoStore: object; walkFeet: object; walkMemo: object | null}, p = P as unknown as {heap: object; heapF: object}; return [l.walkMemoStore, l.walkFeet, p.heap, p.heapF]; };
    const before = priv();
    for (let rep = 0; rep < 2; rep++) for (const q of qs) P.find(q.a[0], q.a[1], q.a[2], q.a[3], 0.34, q.exp, q.op);
    expect(priv()).toEqual(before);
    priv().forEach((o, k) => expect(o, `table ${k}`).toBe(before[k]));
    expect((L as unknown as {walkMemo: object | null}).walkMemo, 'no batch left open').toBeNull();
    expect(WALK_STRIDE).toBeGreaterThan(1);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------
// The real Mall with the real enemy actors

let models: Record<string, GLTF>;
beforeAll(async () => { models = await loadEnemyModels(); }, 300000);

/** The same Levels without the walk batch / start test (the A/B baseline: PathFinder string-pulls with plain walks). */
class PlainLevels extends Levels {
  constructor(...a: ConstructorParameters<typeof Levels>) {
    super(...a);
    const self = this as unknown as Record<string, unknown>;
    self.walkStartClear = undefined; self.beginWalkBatch = undefined; self.endWalkBatch = undefined;
  }
}

function tourRoute(layout: StationLayout): SimRoutePoint[] {
  const L = levelsOfLayout(layout), v = layout.mall!.void.bounds, cx = (v.x0 + v.x1) / 2, cz = (v.z0 + v.z1) / 2, sp = layout.playerSpawn;
  const stops: SimRoutePoint[] = [{x: sp.x, z: sp.z, y: L.grid(0).floorAt(sp.x, sp.z)}];
  for (const lv of [1, 2, 3]) {
    const n = layout.mall!.patrol.filter(p => p.level === lv).sort((a, b) => Math.hypot(a.x - cx, a.z - cz) - Math.hypot(b.x - cx, b.z - cz))[0];
    if (n) stops.push({x: n.x, z: n.z, y: L.grid(lv).floorAt(n.x, n.z)});
  }
  const shop = layout.mall!.shops.find(s => (s as {program?: string}).program === 'lingerie') as unknown as {level: number; changingEntry?: {x: number; z: number}} | undefined;
  if (shop?.changingEntry) stops.push({x: shop.changingEntry.x, z: shop.changingEntry.z, y: L.grid(shop.level).floorAt(shop.changingEntry.x, shop.changingEntry.z)});
  return routeThrough(L, stops);
}

function costLine(c: FrameCost[]): string {
  const f = (k: keyof FrameCost) => dist(c.map(x => x[k] as number)), ai = f('ai'), path = f('path'), anim = f('anim');
  const top = [...c].sort((a, b) => b.ai - a.ai).slice(0, 10), share = top.reduce((s, x) => s + x.path, 0) / Math.max(1e-9, top.reduce((s, x) => s + x.ai, 0));
  return `AI ms avg ${ai.avg.toFixed(2)} p95 ${ai.p95.toFixed(2)} p99 ${ai.p99.toFixed(2)} max ${ai.max.toFixed(2)}; path max ${path.max.toFixed(2)}; anim avg ${anim.avg.toFixed(2)} max ${anim.max.toFixed(2)}; searches/frame max ${Math.max(...c.map(x => x.searches))}; top-10 frames ${(share * 100).toFixed(0)} % path`;
}

describe('the real Mall (t3a, real actors): walking / turning with the flashlight on, gunfire', () => {
  it('identical behaviour with and without the walk batches (every frame); far fewer walk probes / circle tests; costs reported', () => {
    const layout = gen('mall', T3A), route = tourRoute(layout), SECS = 40;
    const runs = ([null, PlainLevels] as const).map(Impl => {
      const sim = aiCpuSim(layout, {actors: models, route, turnRate: 2, flashlight: true, shots: [12, 12.6, 13.2, 30], clock: 'virtual',
        ...(Impl ? {impl: {Levels: Impl as never, PathFinder: PathFinder as never}} : {})});
      // work counters (observe only) inside the synchronous searches: circle tests, and the per-level band loops (cellClear /
      // supportFloorCol: every level grid read for one column)
      let circles = 0, bands = 0, inFind = false;
      const LL = sim.L as unknown as Record<string, (...a: unknown[]) => unknown>;
      const cc = LL.circleClear.bind(sim.L), cl = LL.cellClear.bind(sim.L), sc = LL.supportFloorCol.bind(sim.L);
      LL.circleClear = (...a) => { if (inFind) circles++; return cc(...a); };
      LL.cellClear = (...a) => { if (inFind) bands++; return cl(...a); };
      LL.supportFloorCol = (...a) => { if (inFind) bands++; return sc(...a); };
      const find = sim.pf.find.bind(sim.pf);
      (sim.pf as {find: PathFinder['find']}).find = (...a) => { inFind = true; try { return find(...a); } finally { inFind = false; } };
      const digests: string[] = [];
      for (let f = 0; f < SECS * 60; f++) { sim.step(); digests.push(sim.digest()); }
      return {sim, digests, circles, bands, probes: sim.costs.reduce((s, x) => s + x.probes, 0)};
    });
    const [opt, base] = runs;
    for (let f = 0; f < opt.digests.length; f++) if (opt.digests[f] !== base.digests[f]) expect(opt.digests[f], `frame ${f + 1}`).toBe(base.digests[f]);
    expect(opt.sim.requests.map(r => [r.frame, r.cls, r.args, r.expanded, r.wps])).toEqual(base.sim.requests.map(r => [r.frame, r.cls, r.args, r.expanded, r.wps]));
    expect(opt.sim.draws).toBe(base.sim.draws);
    expect(opt.sim.requests.length).toBeGreaterThan(40); // the scenario does search (chases after the shots, lure investigations, wanders)
    out(`  work: probes ${base.probes} -> ${opt.probes}, circle tests ${base.circles} -> ${opt.circles}, per-level band loops ${base.bands} -> ${opt.bands}`);
    expect(opt.probes).toBeLessThan(base.probes * 0.6);
    expect(opt.circles).toBeLessThan(base.circles * 0.7);
    expect(opt.bands).toBeLessThan(base.bands * 0.05);
    // path searches per frame stay bounded under the gunfire burst (the existing per-frame chase cap; lure / wander searches are not deferrable)
    expect(Math.max(...opt.sim.costs.map(c => c.searches))).toBeLessThanOrEqual(6);
    out(`[mall t3a sim] ${layout.zombies.length} enemies, ${SECS} s, ${opt.sim.requests.length} synchronous searches; walk probes ${base.probes} -> ${opt.probes}, circle tests ${base.circles} -> ${opt.circles}`);
    out(`  plain walks: ${costLine(base.sim.costs.slice(60))}`);
    out(`  walk batch:  ${costLine(opt.sim.costs.slice(60))}`);
    const by: Record<string, number> = {};
    for (const r of opt.sim.requests) by[r.cls.split(':').slice(0, 2).join(':')] = (by[r.cls.split(':').slice(0, 2).join(':')] ?? 0) + 1;
    out(`  searches by requester: ${JSON.stringify(by)}`);
    out(`  animation per kind (mixer + hit volumes, µs per animated actor-frame; skinned meshes per actor): ${Object.entries(opt.sim.animBy).map(([k, e]) => `${k} x${e.actors}: ${(e.ms / Math.max(1, e.frames) * 1000).toFixed(1)} µs, ${(e.meshes / e.actors).toFixed(1)} meshes`).join(' | ')}`);
  }, 300000);

  it('lingerie variants: body + both garments are skinned meshes bound to ONE skeleton (no extra mixer / skeleton / per-frame outfit work)', () => {
    const layout = gen('mall', 32451);
    expect(layout.zombies.some(z => z.look === 'lingerie')).toBe(true);
    const sim = aiCpuSim(layout, {actors: models, clock: 'virtual'});
    let checked = 0;
    sim.zombies.forEach((z, i) => {
      if (layout.zombies[i].look !== 'lingerie') return;
      const skinned: THREE.SkinnedMesh[] = [];
      z.root.traverse(o => { if ((o as THREE.SkinnedMesh).isSkinnedMesh && o.visible) skinned.push(o as THREE.SkinnedMesh); });
      expect(skinned.length, `variant ${i}`).toBeGreaterThanOrEqual(3);
      expect(new Set(skinned.map(m => m.skeleton)).size, `variant ${i} skeletons`).toBe(1);
      checked++;
    });
    expect(checked).toBeGreaterThan(0);
    sim.run(2);
    // every enemy's hit volumes follow its pose every frame (the AI loop has no render-visibility input: nothing is skipped off-screen)
    for (const z of sim.zombies) if (z.brain.alive) expect(z.hitVolumes.length).toBeGreaterThan(0);
  }, 120000);
});
