// Task gasmask-breach-20261030 (lane GAS): bullets crack and break the office tower's exterior window panes (world/windowBreach.ts,
// world/officeWindows.ts looks, world/gas/system.ts bulletHit) on lane GEN's REAL generated office:
//  - pane identity `level:span:column:row` is deterministic per seed; only exterior window panes generated intact / cracked are
//    breakable (never the boarded street entrance, generated broken / boarded panes, other glass);
//  - attribution through the REAL hitscan (combat/hitscan raycastWorld -> Levels.raycast): the room-side face of the window wall
//    cell, the ray continued to the glass plane inside a pane (mullion margin); frames, interior walls, other storeys and the
//    outside face are not panes; a prop in front takes the bullet (nearest hit);
//  - counting: at most one impact per pane per trigger pull (9 shotgun pellets on one pane = 1; one blast across two panes =
//    one each), panes independent, the third impact breaks it once, later bullets pass out (no crater, no count, no cue);
//    generated broken / boarded panes are inert; a generated-cracked pane counts from 0;
//  - looks: every breakable pane's intact / cracked / broken looks are pre-built in the merged storey meshes and switched by
//    rewriting their vertex ranges (no new mesh / material / pipeline mid-play), glass rules kept;
//  - Game wiring (source): world hits only (after enemies / corpses / stock), never the knife; persistence of the hit counts.
import {beforeAll, describe, expect, it, vi} from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import * as THREE from 'three';
import {installCanvasShim} from './helpers/canvas2d';
import {fakeEnvTextures} from './helpers/openablesFixture';
import {generateOfficeLevel} from '../src/gen/office/index';
import {levelsOf, type Levels} from '../src/gen/levels';
import type {StationLayout} from '../src/gen/stationTypes';
import {raycastWorld, type Vec3, type WorldHit} from '../src/combat/hitscan';
import {WorldMaterials} from '../src/world/materials';
import {markShadows} from '../src/render/volumetric';
import {buildWindows, paneBreakable, paneId, planWindows, setPaneLook, type WindowPlan, type WindowView} from '../src/world/officeWindows';
import {readTowerInfo} from '../src/world/towerShared';
import {WINDOWS_LANE, WINDOW_BREACH, WindowBreaches, paneCentre, type PaneRef} from '../src/world/windowBreach';
import {installGas, type GasHost, type GasSystem} from '../src/world/gas/system';

installCanvasShim(false);
let mats: WorldMaterials;
beforeAll(() => { mats = new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17}); });

const GAME = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SEED = 12345;
const layouts = new Map<number, StationLayout>();
const office = (seed = SEED) => { let l = layouts.get(seed); if (!l) layouts.set(seed, (l = generateOfficeLevel({levelSeed: seed, startWeapon: 'pistol'} as never))); return l; };

interface World { L: StationLayout; levels: Levels; plans: WindowPlan[]; view: WindowView }
let world: World | null = null;
function getWorld(): World {
  if (world) return world;
  const L = office(), plans = planWindows(readTowerInfo(L)!);
  return (world = {L, levels: levelsOf(L), plans, view: buildWindows(plans, mats, null)});
}

/** A fake Game for the gas system: spies for the cues / fx / bursts, a lane store. */
function gasHost(w: World) {
  const store = new Map<string, unknown>();
  const sfx = {impact: vi.fn(), breakage: vi.fn()}, fx = {impact: vi.fn()}, damage = {burst: vi.fn(() => 3)};
  let clock = 0;
  const h = {
    player: {x: 0, z: 0, y: 0, eye: 1.6, alive: true, takeDamage: vi.fn()},
    layout: w.L, tower: {office: {info: readTowerInfo(w.L)!, windows: {plans: w.plans, view: w.view}}},
    atmosphere: {active: true, setGasLayer: vi.fn()}, sfx, fx, damage,
    run: {laneStore: (k: string) => store.get(k), setLaneStore: (k: string, v: unknown) => { if (v === undefined) store.delete(k); else store.set(k, structuredClone(v)); }},
    get clock() { return clock; }, set clock(v: number) { clock = v; },
    state: 'playing', frameHooks: [] as ((dt: number) => void)[], sectionHooks: [] as {build?(l: StationLayout): void; teardown?(): void}[],
    stateListeners: [] as ((s: never, p: never) => void)[],
    bulletHitHandlers: [] as ((wh: WorldHit, p: THREE.Vector3, d: THREE.Vector3, shot: number) => boolean)[],
  };
  const sys = installGas(h as unknown as GasHost);
  h.sectionHooks[0].build!(w.L);
  return {h, sys, store, sfx, fx, damage};
}

const sub = (a: Vec3, b: Vec3): Vec3 => ({x: a.x - b.x, y: a.y - b.y, z: a.z - b.z});
const unit = (v: Vec3): Vec3 => { const l = Math.hypot(v.x, v.y, v.z); return {x: v.x / l, y: v.y / l, z: v.z / l}; };

/** The eye `dist` m into the room in front of a pane (at the pane's centre height) and the point on its glass `da` m along it / `dy` up. */
function aimAt(ref: PaneRef, da = 0, dy = 0, dist = 1.6): {o: Vec3; at: Vec3} {
  const c = paneCentre(ref), p = ref.plan, back = dist + Math.abs(p.glass - p.inner);
  const o = {x: c.x + c.nx * back, y: c.y, z: c.z + c.nz * back};
  const at = {x: c.x + (p.along === 'x' ? da : 0), y: c.y + dy, z: c.z + (p.along === 'x' ? 0 : da)};
  return {o, at};
}

/** One bullet through the REAL hitscan: the world hit, its point and direction. */
function shoot(w: World, o: Vec3, at: Vec3): {wh: WorldHit; point: THREE.Vector3; dir: THREE.Vector3} {
  const d = unit(sub(at, o));
  const wh = raycastWorld(w.levels, w.L.props, o, d, 60, w.L.trench.floorY);
  return {wh, point: new THREE.Vector3(o.x + d.x * wh.t, o.y + d.y * wh.t, o.z + d.z * wh.t), dir: new THREE.Vector3(d.x, d.y, d.z)};
}

/** Breakable panes whose centre ray from 1.6 m inside reaches the window wall unobstructed (props can stand in the way). */
function clearPanes(w: World, W: WindowBreaches, filter: (r: PaneRef) => boolean = () => true): PaneRef[] {
  const out: PaneRef[] = [];
  for (const r of W.refs.values()) {
    if (!filter(r)) continue;
    const {o, at} = aimAt(r);
    const s = shoot(w, o, at);
    if (s.wh.kind === 'wall' && W.attribute(s.wh, s.point, s.dir)?.ref?.id === r.id) out.push(r);
  }
  return out;
}

/** A pull of `n` pellets (shot id `shot`) spread inside a pane through the real hitscan + the gas system's handler. */
function pull(w: World, h: ReturnType<typeof gasHost>['h'], ref: PaneRef, shot: number, n = 1, spread = 0.25): boolean[] {
  const out: boolean[] = [];
  for (let i = 0; i < n; i++) {
    const a = n === 1 ? 0 : Math.cos(i * 2.39996) * spread * Math.sqrt(i / n), y = n === 1 ? 0 : Math.sin(i * 2.39996) * spread * Math.sqrt(i / n);
    const {o, at} = aimAt(ref, a, y);
    const s = shoot(w, o, at);
    out.push(h.bulletHitHandlers.some(fn => fn(s.wh, s.point, s.dir, shot)));
  }
  return out;
}

// ---------------------------------------------------------------------------------------------

describe('pane identity: deterministic per office seed; only exterior window panes generated intact / cracked are breakable', () => {
  it('level:span:column:row — the same ids for the same seed (regenerated), unique, every office / lobby storey, lobby rows 0 / 1', () => {
    const a = planWindows(readTowerInfo(office())!);
    const b = planWindows(readTowerInfo(generateOfficeLevel({levelSeed: SEED, startWeapon: 'pistol'} as never))!);
    const ids = (plans: WindowPlan[]) => plans.flatMap(p => p.panes.map(q => paneId(p, q)));
    expect(ids(b)).toEqual(ids(a));
    expect(new Set(ids(a)).size).toBe(ids(a).length);
    for (const id of ids(a)) expect(id).toMatch(/^[1-8]:\d+:\d+:[01]$/);
    const levels = new Set(a.map(p => p.level));
    expect([...levels].sort((x, y) => x - y)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]); // never the station (0) or the roof (9)
    expect(ids(a).some(id => id.startsWith('1:') && id.endsWith(':1'))).toBe(true); // the lobby's transom row
    expect(ids(a).filter(id => !id.startsWith('1:')).every(id => id.endsWith(':0'))).toBe(true);
    // a different seed: a different tower
    expect(ids(planWindows(readTowerInfo(office(777))!))).not.toEqual(ids(a));
  });

  it('breakable = window spans x (intact | cracked); the boarded entrance, generated broken / boarded panes are not', () => {
    const plans = planWindows(readTowerInfo(office())!);
    const W = new WindowBreaches(plans);
    let intact = 0, cracked = 0;
    for (const p of plans) for (const q of p.panes) {
      const b = paneBreakable(p, q);
      expect(W.refs.has(paneId(p, q))).toBe(b);
      if (p.span.kind === 'entrance' || q.state === 'broken' || q.state === 'boarded') expect(b).toBe(false);
      else { expect(b).toBe(true); if (q.state === 'intact') intact++; else cracked++; }
    }
    expect(intact).toBeGreaterThan(100);
    expect(cracked).toBeGreaterThan(50);
    expect(W.refs.size).toBe(intact + cracked);
  });
});

describe('attribution through the REAL hitscan: the window wall face, continued to the glass, inside a pane', () => {
  it('a bullet at a pane centre from inside the room stops at the wall face (~0.28 m before the glass) and is attributed to exactly that pane', () => {
    const w = getWorld(), W = new WindowBreaches(w.plans);
    const sample = [...W.refs.values()].filter((_, i) => i % 7 === 0);
    let ok = 0;
    for (const r of sample) {
      const {o, at} = aimAt(r);
      const s = shoot(w, o, at);
      if (s.wh.kind !== 'wall') continue; // a prop / sign in front takes it (nearest hit)
      const c = r.plan.along === 'x' ? s.point.z : s.point.x;
      expect(Math.abs(c - r.plan.inner), r.id).toBeLessThan(0.02);
      expect(s.wh.level).toBe(r.plan.level);
      const hit = W.attribute(s.wh, s.point, s.dir)!;
      expect(hit?.ref?.id, r.id).toBe(r.id);
      expect(Math.abs((r.plan.along === 'x' ? hit.at.z : hit.at.x) - r.plan.glass)).toBeLessThan(1e-6);
      ok++;
    }
    expect(ok).toBeGreaterThan(sample.length * 0.6);
  });

  it('frames / mullions, interior walls, another storey and the outside face are never a pane', () => {
    const w = getWorld(), W = new WindowBreaches(w.plans);
    const [r] = clearPanes(w, W, x => x.plan.mullions.length > 0 && x.plan.level === 4);
    const p = r.plan;
    // the mullion between two panes (its centre line): a frame hit — the damage system as before
    const m = p.mullions[0], c = paneCentre(r), back = 1.6 + Math.abs(p.glass - p.inner);
    const o = {x: (p.along === 'x' ? m : c.x) + c.nx * back, y: c.y, z: (p.along === 'x' ? c.z : m) + c.nz * back};
    const mull = shoot(w, o, {x: p.along === 'x' ? m : c.x, y: c.y, z: p.along === 'x' ? c.z : m});
    expect(mull.wh.kind).toBe('wall');
    const mh = W.attribute(mull.wh, mull.point, mull.dir);
    expect(mh).not.toBe(null);
    expect(mh!.pane).toBe(null);
    // turning round: the room's other walls / props
    const {o: o2, at} = aimAt(r);
    const away = shoot(w, o2, {x: 2 * o2.x - at.x, y: o2.y, z: 2 * o2.z - at.z});
    expect(W.attribute(away.wh, away.point, away.dir)).toBe(null);
    // the same face reported on another storey: no pane (each storey's spans only)
    const s = shoot(w, o2, at);
    expect(W.attribute({...s.wh, level: p.level + 1}, s.point, s.dir)?.ref ?? null).toBe(null);
    // the outside face (normal pointing out of the building): no pane
    const outside = {...s.wh, nx: p.n[0], nz: p.n[1]};
    const op = s.point.clone().addScaledVector(new THREE.Vector3(p.n[0], 0, p.n[1]), 0.5);
    expect(W.attribute(outside, op, s.dir.clone().negate())).toBe(null);
    // not a wall hit at all (floor / prop / none)
    expect(W.attribute({...s.wh, kind: 'prop'}, s.point, s.dir)).toBe(null);
  });

  it('nearest hit: a prop standing in front of a pane takes the bullet (the pane is never offered the hit)', () => {
    const w = getWorld(), W = new WindowBreaches(w.plans);
    let blocked = 0;
    for (const r of W.refs.values()) {
      const {o, at} = aimAt(r, 0, -0.55, 1.2); // low: the lower part of the pane, over a desk / cabinet near the wall
      const s = shoot(w, o, at);
      if (s.wh.kind !== 'prop') continue;
      expect(W.attribute(s.wh, s.point, s.dir)).toBe(null);
      blocked++;
      if (blocked > 5) break;
    }
    expect(blocked).toBeGreaterThan(0);
  });
});

describe('counting: one impact per pane per trigger pull, third breaks once, inert generated panes', () => {
  it('shotgun: 9 pellets of one pull on a pane = 1 impact (1 glass cue, chips per pellet); 3 pulls break it; then pellets pass out', () => {
    const w = getWorld();
    const {h, sys, sfx, fx, damage} = gasHost(w);
    const [r] = clearPanes(w, sys.windows!, x => x.pane.state === 'intact' && x.plan.level === 3 && x.pane.a1 - x.pane.a0 > 1);
    expect(r).toBeDefined();
    expect(pull(w, h, r, 101, 9, 0.2).every(Boolean)).toBe(true); // every pellet on the glass: no crater
    expect(sys.windows!.state.get(r.id)!.hits).toBe(1);
    expect(sfx.impact).toHaveBeenCalledTimes(1);
    expect(sfx.impact.mock.calls[0][3]).toBe('glass');
    expect(fx.impact).toHaveBeenCalledTimes(9);
    expect(w.view.panes.get(r.id)!.look).toBe('cracked'); // the first impact cracks it
    pull(w, h, r, 102, 9, 0.2);
    expect(sys.windows!.state.get(r.id)!.hits).toBe(2);
    expect(sys.windows!.broken(r.id)).toBe(false);
    expect(sfx.breakage).not.toHaveBeenCalled();
    pull(w, h, r, 103, 9, 0.2);
    expect(sys.windows!.broken(r.id)).toBe(true);
    expect(w.view.panes.get(r.id)!.look).toBe('broken');
    expect(sfx.breakage).toHaveBeenCalledTimes(1);
    expect(sfx.breakage.mock.calls[0][0]).toBe('breakGlass');
    expect(sys.counts).toMatchObject({impacts: 3, broken: 1});
    expect(sys.field!.storey(r.plan.level)!.breaches).toEqual([r.id]); // its gas started, once
    const bursts = damage.burst.mock.calls.length;
    expect(bursts).toBeLessThanOrEqual(3 + 4); // a small burst per counted impact + 4 on the break (each bounded by the debris pool)
    // once broken: never counts / cues / bursts again; the bullets leave through the hole (no crater)
    expect(pull(w, h, r, 104, 9, 0.2).every(Boolean)).toBe(true);
    expect(sys.windows!.state.get(r.id)!.hits).toBe(WINDOW_BREACH.HITS_TO_BREAK);
    expect(sfx.breakage).toHaveBeenCalledTimes(1);
    expect(damage.burst.mock.calls.length).toBe(bursts);
    expect(sys.field!.storey(r.plan.level)!.breaches).toEqual([r.id]);
    expect(sys.counts.passThrough).toBe(8 + 9); // the breaking blast's 8 later pellets + the next blast
  });

  it('single-bullet guns: 3 trigger pulls = break; the same pull id never counts twice; panes count independently; one blast across two panes counts one each', () => {
    const w = getWorld();
    const {h, sys} = gasHost(w);
    const panes = clearPanes(w, sys.windows!, x => x.plan.level === 6 && x.pane.state === 'intact');
    const pair = panes.find(a => panes.some(b => b.plan === a.plan && b.pane.col === a.pane.col + 1 && b.pane.row === a.pane.row));
    expect(pair).toBeDefined();
    const A = pair!, B = panes.find(b => b.plan === A.plan && b.pane.col === A.pane.col + 1 && b.pane.row === A.pane.row)!;
    pull(w, h, A, 1); pull(w, h, A, 1); // the same pull twice (e.g. a duplicated callback): one impact
    expect(sys.windows!.state.get(A.id)!.hits).toBe(1);
    expect(sys.windows!.state.get(B.id)).toBeUndefined(); // independent
    // one "blast" (shot 2) with pellets on A and on B: one each
    pull(w, h, A, 2); pull(w, h, B, 2); pull(w, h, A, 2);
    expect(sys.windows!.state.get(A.id)!.hits).toBe(2);
    expect(sys.windows!.state.get(B.id)!.hits).toBe(1);
    pull(w, h, A, 3);
    expect(sys.windows!.broken(A.id)).toBe(true);
    expect(sys.windows!.broken(B.id)).toBe(false);
  });

  it('a generated-cracked pane counts from 0 (three pulls); generated broken panes let bullets out (no crater, no count, no gas); boarded panes stay the damage system\'s', () => {
    const w = getWorld();
    const {h, sys, sfx} = gasHost(w);
    const [c] = clearPanes(w, sys.windows!, x => x.pane.state === 'cracked' && x.plan.level === 5);
    expect(w.view.panes.get(c.id)!.look).toBe('cracked');
    pull(w, h, c, 1); pull(w, h, c, 2);
    expect(sys.windows!.broken(c.id)).toBe(false);
    pull(w, h, c, 3);
    expect(sys.windows!.broken(c.id)).toBe(true);
    // generated broken / boarded panes (inert): find ones the hitscan reaches
    const inert = (state: 'broken' | 'boarded') => {
      for (const p of w.plans) for (const q of p.panes) {
        if (q.state !== state || p.span.kind !== 'window') continue;
        const fake: PaneRef = {id: paneId(p, q), plan: p, pane: q};
        const {o, at} = aimAt(fake);
        const s = shoot(w, o, at);
        if (s.wh.kind === 'wall') return s;
      }
      return null;
    };
    const before = sfx.impact.mock.calls.length, br = sys.counts.broken;
    const hole = inert('broken')!;
    expect(h.bulletHitHandlers[0](hole.wh, hole.point, hole.dir, 50)).toBe(true); // out through the hole: no crater
    const boards = inert('boarded')!;
    expect(h.bulletHitHandlers[0](boards.wh, boards.point, boards.dir, 51)).toBe(false); // the boards: crater / chips as before
    expect(sfx.impact.mock.calls.length).toBe(before);
    expect(sys.counts.broken).toBe(br);
    expect(sys.field!.storeys.flatMap(s => s.breaches)).toEqual([c.id]);
  });

  it('pane hit counts persist through the lane store (2 hits saved -> restored -> the next pull breaks it); unknown ids are ignored', () => {
    const w = getWorld();
    const {h, sys, store} = gasHost(w);
    const [r] = clearPanes(w, sys.windows!, x => x.plan.level === 7 && x.pane.state === 'intact');
    pull(w, h, r, 1); pull(w, h, r, 2);
    h.sectionHooks[0].teardown!();
    const rec = store.get(WINDOWS_LANE) as {hits: Record<string, number>};
    expect(rec.hits[r.id]).toBe(2);
    store.set(WINDOWS_LANE, {...rec, hits: {...rec.hits, '9:999:0:0': 2}, broken: {'4:999:1:0': 10}});
    h.sectionHooks[0].build!(w.L);
    expect(sys.windows!.state.get(r.id)!.hits).toBe(2);
    expect(sys.windows!.state.size).toBe(1);
    expect(w.view.panes.get(r.id)!.look).toBe('cracked');
    pull(w, h, r, 3);
    expect(sys.windows!.broken(r.id)).toBe(true);
  });
});

describe('looks: pre-built per pane, switched by rewriting vertex ranges (no new mesh / material / pipeline), glass rules kept', () => {
  const area = (pos: THREE.BufferAttribute, start: number, count: number) => {
    let a = 0;
    const v = (i: number) => new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i));
    for (let i = start; i + 2 < start + count; i += 3) a += new THREE.Triangle(v(i), v(i + 1), v(i + 2)).getArea();
    return a;
  };
  it('every breakable pane has its looks; only the current one has area; switching touches only its ranges', () => {
    const plans = planWindows(readTowerInfo(office())!);
    const view = buildWindows(plans, mats, null);
    const meshes: THREE.Mesh[] = [], materials = new Set<THREE.Material>();
    view.root.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) { meshes.push(m); materials.add(m.material as THREE.Material); } });
    const W = new WindowBreaches(plans);
    expect(view.panes.size).toBe(W.refs.size);
    for (const [id, pv] of view.panes) {
      const ref = W.refs.get(id)!;
      expect(pv.look).toBe(ref.pane.state === 'cracked' ? 'cracked' : 'intact');
      expect(!!pv.looks.intact).toBe(ref.pane.state === 'intact');
      expect(pv.looks.cracked && pv.looks.broken).toBeTruthy();
      for (const k of ['intact', 'cracked', 'broken'] as const) {
        const r = pv.looks[k];
        if (r) expect(area(r.attr, r.start, r.count) > 1e-6, `${id} ${k}`).toBe(k === pv.look);
      }
    }
    // break one intact pane: crack, then break
    const id = [...view.panes.keys()].find(k => view.panes.get(k)!.look === 'intact')!;
    const pv = view.panes.get(id)!;
    const attr = pv.looks.cracked!.attr;
    const before = (attr.array as Float32Array).slice();
    expect(setPaneLook(view, id, 'cracked')).toBe(true);
    expect(setPaneLook(view, id, 'cracked')).toBe(false);
    expect(area(pv.looks.cracked!.attr, pv.looks.cracked!.start, pv.looks.cracked!.count)).toBeGreaterThan(0.1);
    expect(area(pv.looks.intact!.attr, pv.looks.intact!.start, pv.looks.intact!.count)).toBe(0);
    // only this pane's vertices changed (partial uploads of its ranges)
    const after = attr.array as Float32Array, r = pv.looks.cracked!;
    for (let i = 0; i < after.length; i++) if (after[i] !== before[i]) expect(i >= r.start * 3 && i < (r.start + r.count) * 3).toBe(true);
    expect(attr.updateRanges.some(u => u.start === r.start * 3 && u.count === r.count * 3)).toBe(true);
    expect(setPaneLook(view, id, 'broken')).toBe(true);
    expect(area(pv.looks.broken!.attr, pv.looks.broken!.start, pv.looks.broken!.count)).toBeGreaterThan(0.01);
    expect(area(pv.looks.cracked!.attr, pv.looks.cracked!.start, pv.looks.cracked!.count)).toBe(0);
    // the bounds cover every look (computed before collapsing): a look shown later is never culled
    const crackedMesh = meshes.find(m => m.geometry.getAttribute('position') === attr)!;
    const box = crackedMesh.geometry.boundingBox!;
    for (let i = r.start; i < r.start + r.count; i++) expect(box.containsPoint(new THREE.Vector3().fromArray(pv.looks.cracked!.base, i * 3))).toBe(true);
    // nothing was added: same meshes / materials (warm-up already covers every look)
    const now: THREE.Mesh[] = [];
    view.root.traverse(o => { if ((o as THREE.Mesh).isMesh) now.push(o as THREE.Mesh); });
    expect(now).toEqual(meshes);
    // glass rules: transparent, no depth write, never a shadow caster
    markShadows(view.root, true, false);
    for (const g of view.glass) {
      const m = g.material as THREE.Material;
      expect(m.transparent).toBe(true);
      expect(m.depthWrite).toBe(false);
      expect(g.castShadow).toBe(false);
    }
    expect(view.glass.some(g => g.name === 'tower-window-glass-cracked')).toBe(true);
    expect(materials.size).toBeLessThanOrEqual(5);
  });
});

describe('Game wiring (source): world hits only — after enemies / corpses / shelf stock — never the knife; installed after the tower', () => {
  const src = fs.readFileSync(path.join(GAME, 'src/game.ts'), 'utf8');
  const body = (name: string) => { const i = src.indexOf(`  private ${name}(`); return src.slice(i, src.indexOf('\n  }\n', i)); };
  it('fire(): the handlers get the world hit in the world branch only; meleeContact never; one pull id per trigger pull', () => {
    const fire = body('fire');
    expect(fire).toContain('if (!this.bulletHit(wh, end, dir)) this.damage.hitWorld(wh, end, dir, shot);');
    expect(fire.indexOf('this.bulletHit(wh, end, dir)')).toBeGreaterThan(fire.indexOf('} else if (corpse && !fh) {'));
    expect(fire.match(/this\.shotCounter\+\+/g)?.length).toBe(1);
    expect(body('meleeContact')).not.toContain('bulletHit');
    expect(body('bulletHit')).toContain('h(wh, point, dir, this.shotCounter)');
    expect(src.indexOf('this.gas = installGas(this)')).toBeGreaterThan(src.indexOf('this.tower = installTower(this)'));
  });
});

describe('the gas system offers no pane on the Subway', () => {
  it('no office windows: never claims a hit', () => {
    const w = getWorld();
    const {h, sys} = gasHost(w);
    h.sectionHooks[0].teardown!();
    (h.tower as {office: unknown}).office = null;
    h.sectionHooks[0].build!(w.L);
    expect((sys as GasSystem).windows).toBe(null);
    const [r] = [...new WindowBreaches(w.plans).refs.values()];
    const {o, at} = aimAt(r);
    const s = shoot(w, o, at);
    expect(h.bulletHitHandlers[0](s.wh, s.point, s.dir, 1)).toBe(false);
  });
});
