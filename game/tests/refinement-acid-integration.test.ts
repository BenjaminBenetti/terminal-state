// Task studio-refinement-batch-20261113-035659-01: the acid grenade (weapons/grenades.ts GrenadeSystem) against the REAL melt system
// (world/acidMelt.ts AcidMelt) in a real generated station (tests/helpers/acidMeltHost.ts: the built world, physics, holders, pickups,
// the train) — the seam both sides were written to, end to end: a canister thrown at a meltable prop sticks to it and its burst starts
// the melt; a pool beside a prop exposes it until it melts; each melted thing leaves exactly one salvage; the manual save waits while a
// melt is under way (AcidMelt.busy).
import {afterEach, describe, expect, it} from 'vitest';
import * as THREE from 'three';
import {installCanvasShim, ShimContext} from './helpers/canvas2d';
import {LEVELS} from '../src/levels/registry';
import type {StationLayout} from '../src/gen/stationTypes';
import type {PropPlacement} from '../src/gen/props';
import {ELECTRICAL_PARTS, SCRAP_METAL} from '../src/items/craftMaterials';
import {ACID_GRENADE} from '../src/items/grenades';
import {ACID, GrenadeSystem} from '../src/weapons/grenades';
import {MELT} from '../src/world/acidMelt';
import type {PlayerTrainRuntime} from '../src/world/playerTrain';
import {mulberry32} from '../src/core/rng';
import {enterStation, meltStation, pickupsOf, type MeltRig, type MeltWorld} from './helpers/acidMeltHost';

installCanvasShim(false);
(ShimContext.prototype as unknown as {clip(): void}).clip ??= () => {};

const SUB = (): StationLayout => LEVELS.subway.generate('main', {levelSeed: 4242});
const live: PlayerTrainRuntime[] = [];
afterEach(() => { for (const rt of live.splice(0)) if (rt.train) { rt.ride = null; rt.teardown(); } });
const DT = 1 / 60;
const SALVAGE = new Set<string>([ELECTRICAL_PARTS, SCRAP_METAL]);

function rig() {
  const c: MeltRig = meltStation(SUB());
  live.push(c.rt);
  const w: MeltWorld = enterStation(c, SUB());
  const sys = new GrenadeSystem(new THREE.Group(), w.ph, mulberry32(5));
  const levels = c.h.levels!;
  sys.env = {melt: () => c.melt, levelAt: (x, z, y) => levels.levelAt(x, z, y), lineOfSight: (a, b) => levels.lineOfSight(a, b)};
  const frames = (seconds: number) => { for (let t = 0; t < seconds - 1e-9; t += DT) { w.ph.update(DT); sys.tick(DT); c.melt.tick(DT); } };
  return {c, w, sys, levels, frames};
}

/** A lone meltable piece of furniture (nothing on / hosted by it) with open floor in front of its +Z face. */
function target(r: ReturnType<typeof rig>): {T: PropPlacement; floor: number} {
  const {c, w, levels} = r;
  for (const T of w.L.props) {
    if (c.melt.protection(T) !== null || w.ph.dynamicItems.isDynamicProp(T) || !(T.h > 0.5 && T.h < 1.3 && T.hx > 0.25 && T.hz > 0.2)) continue;
    const i = w.L.props.indexOf(T), top = T.y + T.h;
    if (w.L.props.some(q => q !== T && (q.host === i || (Math.abs(q.y - top) < 0.08 && Math.abs(q.x - T.x) < q.hx + T.hx && Math.abs(q.z - T.z) < q.hz + T.hz)))) continue;
    const s = levels.supportAt(T.x, T.z + T.hz + 0.9, T.y + 0.05, 0.35);
    if (!s || Math.abs(s.floor - T.y) > 0.02) continue;
    // the throw lane in front of it: nothing else there
    if (w.L.props.some(q => q !== T && q.h > 0.05 && Math.abs(q.x - T.x) < q.hx + 0.3 && q.z - q.hz < T.z + T.hz + 2.2 && q.z + q.hz > T.z + T.hz && q.y < T.y + 1.8)) continue;
    return {T, floor: s.floor};
  }
  throw new Error('no lone meltable prop with an open front');
}

describe('the acid grenade with the real melt system', () => {
  it('thrown at a meltable prop it STICKS, bursts after the fuse, and that prop melts — one salvage, the pool under it', () => {
    const r = rig();
    const {T, floor} = target(r);
    const eye = {x: T.x, y: T.y + T.h * 0.5 + 0.05, z: T.z + T.hz + 1.6};
    const res = r.sys.throw(ACID_GRENADE, eye, {x: 0, y: -0.02, z: -1});
    expect(res.ok).toBe(true);
    let n = 0;
    while (r.sys.canisters[0]?.state === 'flying' && n++ < 240) r.frames(DT);
    const can = r.sys.canisters[0];
    expect(can?.state, T.kind).toBe('stuck');
    expect(can!.stuck!.ref.key).toBe(`p:${r.w.L.props.indexOf(T)}`);
    expect(r.c.melt.counts.started).toBe(0);
    r.frames(ACID.stickFuse + 0.1);
    expect(r.sys.canisters).toHaveLength(0);
    expect(r.c.melt.counts.started).toBeGreaterThanOrEqual(1);
    expect(r.c.melt.busy).toBe(true); // (the train's Save terminal waits: Game.saveBlock 'acid')
    expect(r.sys.pools).toHaveLength(1);
    expect(r.sys.pools[0].y).toBeCloseTo(floor, 1);
    r.frames(MELT.seconds + 3);
    expect(T.h).toBe(0);
    expect(r.c.melt.busy).toBe(false);
    const salvage = pickupsOf(r.c).filter(p => SALVAGE.has(p.itemId));
    expect(salvage.length).toBe(r.c.melt.counts.salvage);
    expect(salvage.length).toBeGreaterThanOrEqual(1);
    expect(r.c.melt.counts.completed).toBe(r.c.melt.counts.started);
  }, 60000);

  it('a pool on the floor beside a prop exposes it until it melts (the pool\'s own disc, AcidMelt.inDisc / expose); nothing outside melts', () => {
    const r = rig();
    const {T} = target(r);
    // dropped straight down onto the open floor 0.9 m in front of the prop: it bursts there (no prop under it to stick to)
    const at = {x: T.x, y: T.y + 0.5, z: T.z + T.hz + 0.9};
    expect(r.sys.throw(ACID_GRENADE, at, {x: 0, y: -1, z: 0}).ok).toBe(true);
    let n = 0;
    while (!r.sys.pools.length && n++ < 600) r.frames(DT);
    expect(r.sys.pools).toHaveLength(1);
    const p = r.sys.pools[0];
    expect(Math.hypot(p.x - at.x, p.z - at.z)).toBeLessThan(0.5);
    const inside = r.c.melt.inDisc(p.x, p.y, p.z, ACID.poolR).map(x => x.key);
    expect(inside).toContain(`p:${r.w.L.props.indexOf(T)}`);
    // before MELT.exposure of contact nothing has started; well within the pool's 10 s it is gone
    r.frames(MELT.exposure * 0.5);
    expect(r.c.melt.counts.started).toBe(0);
    r.frames(MELT.exposure + MELT.seconds + 1);
    expect(T.h).toBe(0);
    // only what the pool's disc touched: every melted thing was a candidate of that disc, each with its one salvage
    expect(r.c.melt.counts.started).toBeLessThanOrEqual(inside.length);
    r.frames(ACID.poolSeconds);
    expect(r.sys.pools).toHaveLength(0);
    expect(r.c.melt.busy).toBe(false);
    expect(pickupsOf(r.c).filter(q => SALVAGE.has(q.itemId)).length).toBe(r.c.melt.counts.salvage);
  }, 60000);
});
