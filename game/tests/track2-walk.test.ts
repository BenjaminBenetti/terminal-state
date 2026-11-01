// Track 2 (Beyond the Station, primary): a REAL Player walks from the platform start into a service annex and back — the game's
// own movement, collision (props included), falls, support and ladder-climb code on the generated level, steered with the W key
// along the game's own PathFinder routes (as qaWalk.ts does in the browser; seamless-traversal.test.ts is the Office twin). No
// teleport. Loot is opened / taken through the game's ContainerManager targeting + interact ([E]) from the reached stand point.
//
// Two annex entries: a TUNNEL annex (FRESH.subwayTunnel: platform -> drop into the bed -> tunnel -> side door) and a SERVICE-HATCH annex
// (FRESH.subwayHatch, annex 1: a door in the bed's outer wall). The way back is a bed rescue ladder up to the platform.
// (2026-11-01, lane AREA: the area exists only where the level's one roll succeeds; the old seeds 1043 / 1002 roll it absent — FRESH,
// tests/helpers/btsArea.ts, holds the first seeds at / after them rolling PRESENT in the same role.)
// Proves: reachable on foot both ways; height changes continuously (falls / climbs, no snap); never below the track-bed floor or
// off the map; no damage; loot in the annex is targetable and takeable after the walk, and taking it leaves the holder emptier.

import * as THREE from 'three';
import {beforeAll, describe, expect, it} from 'vitest';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {installCanvasShim, ShimContext} from './helpers/canvas2d';
import {fakeEnvTextures, openableModels} from './helpers/openablesFixture';
import {LEVELS} from '../src/levels/registry';
import {levelsOf, type Levels} from '../src/gen/levels';
import {PathFinder} from '../src/gen/grid';
import {Player, STAND_EYE, type MoveInput} from '../src/player/player';
import {PropIndex} from '../src/core/physics';
import {ladderTarget, type Ladder} from '../src/gen/traversal';
import {Inventory} from '../src/items/inventory';
import {WorldMaterials} from '../src/world/materials';
import {ContainerManager, type Holder} from '../src/world/containers';
import type {StationLayout} from '../src/gen/stationTypes';
import type {ServiceAnnex} from '../src/gen/trackExt/types';
import {FRESH} from './helpers/btsArea';

installCanvasShim(false);
(ShimContext.prototype as unknown as {clip?: () => void}).clip ??= () => {};

const DT = 1 / 60;
const opts = {aiming: false, speedMult: 1, canSprint: false};
class Keys implements MoveInput {
  held = new Set<string>();
  down(c: string) { return this.held.has(c); }
  hit() { return false; }
}
let models: Record<string, GLTF> = {};
beforeAll(async () => { models = await openableModels(); }, 120000);

interface Walker { p: Player; L: Levels; props: PropIndex; pf: PathFinder; layout: StationLayout; maxDy: number; minY: number; frames: number }

function walker(layout: StationLayout): Walker {
  const L = levelsOf(layout), p = new Player(), sp = layout.playerSpawn;
  p.spawn(sp.x, sp.z, sp.yaw, layout.grid.floorAt(sp.x, sp.z));
  return {p, L, props: new PropIndex(L, layout.props), pf: new PathFinder(L), layout, maxDy: 0, minY: Infinity, frames: 0};
}

/** Walk (W held toward each waypoint of the game's route) to (x, z) on the storey near y. Returns true on arrival. */
function walkTo(w: Walker, x: number, z: number, y: number, capS = 120): boolean {
  const {p, L, layout} = w;
  const route = w.pf.find(p.x, p.z, x, z, 0.3, 400000, {ay: p.y, by: y});
  expect(route, `route to ${x.toFixed(1)},${z.toFixed(1)}`).not.toBeNull();
  const keys = new Keys();
  keys.held.add('KeyW');
  let i = 0;
  for (let f = 0; f < capS / DT; f++) {
    while (i < route!.length && Math.hypot(route![i][0] - p.x, route![i][1] - p.z) < 0.35 && (route![i][3] === undefined || Math.abs(route![i][3]! - p.y) < 0.9)) i++;
    if (i >= route!.length) return true;
    p.yaw = Math.atan2(-(route![i][0] - p.x), -(route![i][1] - p.z));
    const y0 = p.y;
    p.update(DT, keys, L, w.props, opts);
    w.maxDy = Math.max(w.maxDy, Math.abs(p.y - y0));
    w.minY = Math.min(w.minY, p.y);
    w.frames++;
    const [cx, cz] = layout.grid.cellOf(p.x, p.z);
    expect(cx >= 0 && cz >= 0 && cx < layout.grid.w && cz < layout.grid.h, 'on the map').toBe(true);
  }
  return false;
}

const areaAt = (w: Walker) => { const g = w.layout.grid, [cx, cz] = g.cellOf(w.p.x, w.p.z); return w.layout.areas[g.area[g.idx(cx, cz)]]; };
const inAnnex = (w: Walker, a: ServiceAnnex) => a.areas.includes(areaAt(w)?.id ?? -1);

/** Walk into the annex, take loot from its nearest stocked holder ([E] through the game's targeting), walk back up a bed ladder. */
function annexRoundTrip(layout: StationLayout, a: ServiceAnnex, viaTunnel: boolean) {
  const w = walker(layout), {p} = w, startHp = p.hp, fy = a.floorY;
  const ext = layout.extensions!;
  if (viaTunnel) {
    // platform -> bed -> into the tunnel (a point 6 m in) -> the tunnel side of the annex door
    const t = ext.tunnels[a.tunnel];
    const at = (s: number) => { let acc = 0; for (let i = 1; i < t.path.length; i++) { const q0 = t.path[i - 1], q1 = t.path[i], d = Math.hypot(q1.x - q0.x, q1.z - q0.z); if (acc + d >= s) { const f = (s - acc) / d; return {x: q0.x + (q1.x - q0.x) * f, z: q0.z + (q1.z - q0.z) * f}; } acc += d; } return t.path[t.path.length - 1]; };
    const in6 = at(6);
    expect(walkTo(w, in6.x, in6.z, fy), 'platform -> bed -> tunnel').toBe(true);
    expect((areaAt(w) as {ext?: string}).ext).toBe('tunnel');
    expect(p.y).toBeCloseTo(t.floorY, 2);
  }
  // through the annex door into the entry corridor, then on to the nearest stocked holder's stand point
  expect(walkTo(w, a.exit.x, a.exit.z, fy), 'to the annex door').toBe(true);
  const corridor = layout.areas[a.areas[0]];
  const cc = {x: (corridor.x + corridor.w / 2) * 0.5, z: (corridor.y + corridor.h / 2) * 0.5};
  expect(walkTo(w, cc.x, cc.z, fy), 'through the door into the annex').toBe(true);
  expect(inAnnex(w, a)).toBe(true);
  const inv = new Inventory();
  const cm = new ContainerManager(models, new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17}), () => inv);
  cm.build(layout);
  const stocked = cm.all.filter(h => a.areas.includes(h.prop.area) && h.state.lots.length > 0)
    .sort((h1, h2) => Math.hypot(h1.prop.x - p.x, h1.prop.z - p.z) - Math.hypot(h2.prop.x - p.x, h2.prop.z - p.z));
  expect(stocked.length, 'stocked holders in the annex').toBeGreaterThan(0);
  let looted: {kind: string; itemId: string; lotsBefore: number; lotsAfter: number} | null = null;
  for (const h of stocked.slice(0, 6)) {
    const {aim, stand} = cm.aimPoint(h);
    if (!walkTo(w, stand.x, stand.z, fy, 60)) continue;
    const eye = new THREE.Vector3(p.x, p.y + STAND_EYE, p.z), dir = new THREE.Vector3(aim.x, aim.y, aim.z).sub(eye).normalize();
    const tgt = cm.target(eye, dir, w.L);
    if (tgt?.container !== h) continue;
    looted = takeOne(cm, h, inv);
    if (looted) break;
  }
  expect(looted, 'took an item from an annex holder after the walk').not.toBeNull();
  expect(looted!.lotsAfter).toBeLessThan(looted!.lotsBefore);
  expect(inv.count(looted!.itemId)).toBeGreaterThan(0);
  // back: the nearest rescue ladder of the bed the annex hangs off, climbed up to its platform
  const trench = viaTunnel ? ext.tunnels[a.tunnel].trench : a.bed!.trench;
  const lads = layout.traversal.ladders.filter((l: Ladder) => l.trench === trench && (l.kind ?? 'rescue') === 'rescue')
    .sort((l1, l2) => Math.hypot(l1.bottom.x - a.exit.x, l1.bottom.z - a.exit.z) - Math.hypot(l2.bottom.x - a.exit.x, l2.bottom.z - a.exit.z));
  expect(lads.length).toBeGreaterThan(0);
  const lad = lads[0];
  expect(walkTo(w, lad.bottom.x, lad.bottom.z - lad.dir * 0.3, lad.bottomY, 180), 'annex -> bed ladder').toBe(true);
  p.yaw = lad.dir > 0 ? Math.PI : 0;
  const look = new THREE.Vector3(-Math.sin(p.yaw), Math.sin(-0.3), -Math.cos(p.yaw)).normalize();
  const aim = ladderTarget(layout.traversal.ladders, {x: p.x, y: p.y + STAND_EYE, z: p.z}, look, p.y);
  expect(aim?.ladder.id).toBe(lad.id);
  expect(aim?.up).toBe(true);
  p.startClimb(lad, true);
  const keys = new Keys();
  for (let f = 0; p.climbing && f < 600; f++) { const y0 = p.y; p.update(DT, keys, w.L, w.props, opts); w.maxDy = Math.max(w.maxDy, Math.abs(p.y - y0)); }
  expect(p.climbing).toBe(false);
  expect(p.y).toBeCloseTo(lad.topY, 2);
  expect(areaAt(w)?.id).toBe(lad.platform);
  expect(w.maxDy, 'height changes continuously (falls / climbs, no snap)').toBeLessThan(0.12);
  expect(w.minY, 'never below the track-bed floor').toBeGreaterThan(fy - 0.02);
  expect(p.alive).toBe(true);
  expect(p.hp).toBe(startHp);
  return {looted, seconds: +(w.frames * DT).toFixed(1)};
}

/** [E] on the holder (opens an openable compartment / a closed holder), then [E] on one of its lots. */
function takeOne(cm: ContainerManager, h: Holder, inv: Inventory) {
  const lotsBefore = h.state.lots.length;
  if (h.open || !h.state.open) cm.interact({container: h, t: 1, lot: null, part: h.open ? 0 : undefined} as never);
  for (let t = 0; t < 1.5; t += DT) cm.update(DT, t);
  const lot = h.state.lots.find(l => !h.open || l.part === undefined || (h.open.parts[l.part]?.t ?? 0) > 0.5) ?? h.state.lots[0];
  if (!lot) return null;
  const before = inv.count(lot.itemId);
  cm.interact({container: h, t: 1, lot, part: lot.part} as never);
  for (let t = 0; t < 0.5; t += DT) cm.update(DT, t);
  if (inv.count(lot.itemId) <= before) return null;
  return {kind: h.kind, itemId: lot.itemId, lotsBefore, lotsAfter: h.state.lots.length};
}

describe('Track 2: a real player walks into a service annex, loots it and climbs back to the platform', () => {
  it(`tunnel annex (seed ${FRESH.subwayTunnel}): platform -> bed -> tunnel -> side door -> loot -> bed ladder -> platform`, () => {
    const layout = LEVELS.subway.generate('main', {levelSeed: FRESH.subwayTunnel, startWeapon: 'pistol'} as never);
    const a = layout.extensions!.annexes.find(q => q.tunnel >= 0)!;
    expect(a).toBeDefined();
    annexRoundTrip(layout, a, true);
  }, 120000);

  it(`service-hatch annex (seed ${FRESH.subwayHatch}): platform -> bed -> hatch in the bed wall -> loot -> bed ladder -> platform`, () => {
    const layout = LEVELS.subway.generate('main', {levelSeed: FRESH.subwayHatch, startWeapon: 'pistol'} as never);
    const a = layout.extensions!.annexes.find(q => q.tunnel < 0)!;
    expect(a, `seed ${FRESH.subwayHatch} has a hatch annex`).toBeDefined();
    expect(a.bed).toBeDefined();
    annexRoundTrip(layout, a, false);
  }, 120000);
});
