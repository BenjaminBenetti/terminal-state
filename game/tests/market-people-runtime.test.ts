// Task studio-survivor-market-20261108-005807-01 (lane HUMANS): the market's people at runtime (market/marketPeople.ts), driven in
// Node on a REAL generated station (levels, path finder, prop index, the parked train's placement) with a stand-in `layout.market`
// laid on its walkable platform floor, and the real cast GLB (textures stripped: Node has no image decoder).
//  - residents wander between spots along real paths: always on supported floor of the platform storey (never in the trench), never
//    inside the train's keep-out (car + platform-door aprons), keeping apart from each other and from the player;
//  - traders stay at their posts, face the counter front, turn toward a customer, greet on onTalk; traderAt reports the post;
//  - they are not enemies: nothing is added to a zombie list, no hit volumes / brains; teardown removes them; deterministic.
import {beforeAll, describe, expect, it} from 'vitest';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import * as THREE from 'three';
import {GLTFLoader, type GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {generateStation} from '../src/gen/station';
import {levelsOf} from '../src/gen/levels';
import {CELL, PathFinder} from '../src/gen/grid';
import {PropIndex} from '../src/core/physics';
import {playerTrainPlacement} from '../src/gen/playerTrain';
import {hashString, mulberry32} from '../src/core/rng';
import {MARKET_STALLS, type MarketLayout, type MarketSpot} from '../src/gen/market/marketTypes';
import type {StationLayout} from '../src/gen/stationTypes';
import {MarketPeople, MARKET_PEOPLE, trainKeepout, type MarketPeopleHost} from '../src/market/marketPeople';
import {MARKET_HUMAN_KEY, MARKET_HUMAN_MODEL_FILES, humanLookKey} from '../src/market/humanLooks';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');

async function loadCast(): Promise<GLTF> {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.read(path.join(ROOT, MARKET_HUMAN_MODEL_FILES[MARKET_HUMAN_KEY].url));
  for (const t of doc.getRoot().listTextures()) t.dispose(); // node has no image decoder
  const bin = await io.writeBinary(doc);
  return new Promise<GLTF>((res, rej) => new GLTFLoader().parse(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength) as ArrayBuffer, '', res, rej));
}

/** A stand-in market on the station's platform floor: walkable, clear cells at floor height 0 (never the track bed). */
function fakeMarket(layout: StationLayout, seed: number, keepoutProbe: {x: number; z: number} | null): MarketLayout {
  const g = layout.grid, rand = mulberry32(hashString('test-market', seed));
  const cells: [number, number][] = [];
  for (let cy = 2; cy < g.h - 2; cy++) for (let cx = 2; cx < g.w - 2; cx++) {
    if (!g.walkable(cx, cy) || Math.abs(g.cellFloor(cx, cy)) > 0.05) continue;
    const [x, z] = g.center(cx, cy);
    if (g.circleClear(x, z, 0.5)) cells.push([x, z]);
  }
  for (let i = cells.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [cells[i], cells[j]] = [cells[j], cells[i]]; }
  const far: [number, number][] = [];
  for (const c of cells) if (far.every(f => Math.hypot(f[0] - c[0], f[1] - c[1]) > 3)) far.push(c);
  const kinds: MarketSpot['kind'][] = ['idle', 'sit', 'work', 'cook', 'sleep', 'chat'];
  const stalls = MARKET_STALLS.map((id, i) => {
    const [x, z] = far[i];
    return {id, name: id, counter: {x0: x - 0.6, x1: x + 0.6, z0: z + 0.4, z1: z + 0.9, x, z: z + 0.65, y: 0, level: 0}, trader: {x, z, y: 0, level: 0, yaw: Math.PI}, front: {x, z: z + 1.4, y: 0, level: 0}, area: 0};
  });
  const spots: MarketSpot[] = far.slice(6, 22).map(([x, z], i) => ({x, z, y: 0, level: 0, yaw: rand() * Math.PI * 2, kind: kinds[i % kinds.length], area: 0}));
  // a spot in the doorway apron of the parked train: must never be used
  if (keepoutProbe) spots.push({x: keepoutProbe.x, z: keepoutProbe.z, y: 0, level: 0, yaw: 0, kind: 'idle', area: 0});
  return {v: 1, stalls, spots, residents: 12};
}

let cast: GLTF;
beforeAll(async () => { cast = await loadCast(); });

function world(seed: number) {
  const layout = generateStation(seed);
  const levels = levelsOf(layout);
  const pathfinder = new PathFinder(levels);
  const propIndex = new PropIndex(levels, layout.props);
  const trainPlacement = playerTrainPlacement(layout);
  const apron = trainKeepout(trainPlacement)[1] ?? null;
  const probe = apron ? {x: (apron.x0 + apron.x1) / 2, z: (apron.z0 + apron.z1) / 2} : null;
  layout.market = fakeMarket(layout, seed, probe);
  const scene = new THREE.Scene();
  const zombies: unknown[] = [];
  const host: MarketPeopleHost & {zombies: unknown[]} = {
    scene, levels, pathfinder, propIndex, trainPlacement, zombies,
    player: {x: -999, y: 0, z: -999, radius: 0.3},
    propModels: {get: k => (k === MARKET_HUMAN_KEY ? cast : undefined), catalogue: MARKET_HUMAN_MODEL_FILES},
    sectionHooks: [], frameHooks: [], sectionModelKeys: [],
  };
  const sys = new MarketPeople(host).install();
  return {layout, host, sys, probe};
}

describe('market people on a generated station', () => {
  it('installs a lazy model key hook, a section build / teardown and a frame hook', () => {
    const {host, layout} = world(11);
    expect(host.sectionModelKeys.length).toBe(1);
    expect(host.sectionModelKeys[0](layout as never)).toEqual([MARKET_HUMAN_KEY]);
    expect(host.sectionModelKeys[0]({...layout, market: undefined} as never)).toEqual([]);
    expect(host.sectionHooks.length).toBe(1);
    expect(host.frameHooks.length).toBe(1);
  });

  it('residents wander along real paths on the platform floor, never into the trench or the train keep-out; traders hold their posts', () => {
    const {layout, host, sys, probe} = world(11);
    host.sectionHooks[0].build!(layout as never);
    const M = layout.market!;
    expect(sys.traders.length).toBe(6);
    expect(sys.residents.length).toBe(12);
    expect(host.scene.children.length).toBe(18);
    // the doorway-apron spot is filtered out
    if (probe) expect(sys.spots.some(s => s.x === probe.x && s.z === probe.z)).toBe(false);
    const posts = sys.traders.map(t => ({x: t.actor.x, z: t.actor.z}));
    const visited = new Set<number>();
    const dt = 1 / 30;
    let minGap = Infinity, minY = 0;
    for (let f = 0; f < 30 * 150; f++) {
      host.frameHooks[0](dt);
      for (const r of sys.residents) {
        const a = r.actor;
        expect(sys.inKeepout(a.x, a.z, a.y), `resident ${r.index} in the train keep-out at ${a.x.toFixed(2)}, ${a.z.toFixed(2)}`).toBe(false);
        // never down in a track bed (stairs to an underpass are fine: those pass under the bed, far below its floor)
        const bed = layout.trenches.find(t => a.x > t.x0 && a.x < t.x1 && a.z > t.z0 && a.z < t.z1 && Math.abs(a.y - t.floorY) < 0.6);
        expect(bed, `resident ${r.index} in a track bed at ${a.x.toFixed(2)}, ${a.y.toFixed(2)}, ${a.z.toFixed(2)}`).toBeUndefined();
        minY = Math.min(minY, a.y);
        expect(host.levels.supportIn(a.x, a.z, a.y, 0.3), `resident ${r.index} off the floor at ${a.x.toFixed(2)}, ${a.z.toFixed(2)}`).not.toBeNull();
        // walkable on the storey it stands on (a route may take the stairs down to an underpass)
        const G = host.levels.grid(host.levels.levelAt(a.x, a.z, a.y)), [cx, cy] = G.cellOf(a.x, a.z);
        expect(G.walkable(cx, cy), `resident ${r.index} on a non-walkable cell`).toBe(true);
        if (r.state === 'idle') visited.add(r.spot);
        for (const o of sys.residents) if (o !== r) minGap = Math.min(minGap, Math.hypot(a.x - o.actor.x, a.z - o.actor.z));
      }
      if (f % 300 === 0) sys.traders.forEach((t, i) => { expect(t.actor.x).toBe(posts[i].x); expect(t.actor.z).toBe(posts[i].z); });
    }
    expect(sys.counts.arrivals, 'residents reached new spots').toBeGreaterThan(8);
    expect(visited.size).toBeGreaterThan(12);
    expect(sys.counts.pathFails).toBeLessThan(sys.counts.paths / 2);
    // separation keeps bodies apart (brief overlaps while passing are resolved within the frame)
    expect(minGap).toBeGreaterThan(MARKET_PEOPLE.radius);
    void M; void CELL; void minY;
  });

  it('steps away from the player and never pushes the player', () => {
    const {layout, host, sys} = world(11);
    host.sectionHooks[0].build!(layout as never);
    const r = sys.residents[0];
    host.player.x = r.actor.x + 0.05; host.player.z = r.actor.z; host.player.y = r.actor.y;
    const px = host.player.x, pz = host.player.z;
    host.frameHooks[0](1 / 30);
    expect(Math.hypot(r.actor.x - host.player.x, r.actor.z - host.player.z)).toBeGreaterThan(MARKET_PEOPLE.radius + host.player.radius);
    expect([host.player.x, host.player.z]).toEqual([px, pz]);
  });

  it('traders face the counter front, turn toward a customer, greet on onTalk and report their post', () => {
    const {layout, host, sys} = world(11);
    host.sectionHooks[0].build!(layout as never);
    const st = layout.market!.stalls[2];
    const at = sys.traderAt(st.id)!;
    expect(at).toMatchObject({x: st.trader.x, z: st.trader.z, y: st.trader.y});
    expect(Math.abs(Math.atan2(Math.sin(at.yaw - st.trader.yaw), Math.cos(at.yaw - st.trader.yaw)))).toBeLessThan(1e-6);
    const t = sys.traders[2];
    // a customer at the front, off to one side: the trader turns toward them (within the limit), talking
    host.player.x = st.front.x + 1.2; host.player.z = st.front.z; host.player.y = 0;
    for (let i = 0; i < 60; i++) host.frameHooks[0](1 / 30);
    const fwd = [Math.sin(t.actor.yaw), Math.cos(t.actor.yaw)], to = [host.player.x - t.actor.x, host.player.z - t.actor.z];
    expect(fwd[0] * to[0] + fwd[1] * to[1]).toBeGreaterThan(0.8 * Math.hypot(to[0], to[1]));
    expect(t.actor.loop).toBe('Talk');
    sys.onTalk(st.id);
    expect(t.actor.current).toBe('Greet');
    expect(sys.counts.greetings).toBe(1);
    for (let i = 0; i < 90; i++) host.frameHooks[0](1 / 30);
    expect(t.actor.current).toBe('Talk');
  });

  it('are never enemies: no zombie list entry, no hit volumes or brains; teardown removes every person', () => {
    const {layout, host, sys} = world(11);
    host.sectionHooks[0].build!(layout as never);
    for (let i = 0; i < 30; i++) host.frameHooks[0](1 / 30);
    expect(host.zombies.length).toBe(0);
    for (const a of sys.people) {
      for (const k of ['brain', 'hitVolumes', 'updateVolumes', 'beginRagdoll', 'hitFlash']) expect(k in a, k).toBe(false);
      expect([...a.root.children].length).toBeGreaterThan(0);
    }
    host.sectionHooks[0].teardown!();
    expect(host.scene.children.length).toBe(0);
    expect(sys.people.length).toBe(0);
  });

  it('a layout without a market spawns nobody', () => {
    const {layout, host, sys} = world(11);
    host.sectionHooks[0].build!({...layout, market: undefined} as never);
    expect(sys.people.length).toBe(0);
    host.frameHooks[0](1 / 30);
  });

  it('is deterministic per station seed (looks, posts, starting spots)', () => {
    const snap = (seed: number) => {
      const {layout, host, sys} = world(seed);
      host.sectionHooks[0].build!(layout as never);
      return sys.people.map(a => [humanLookKey(a.look), a.scale, +a.x.toFixed(4), +a.z.toFixed(4)]);
    };
    expect(snap(11)).toEqual(snap(11));
  });
});
