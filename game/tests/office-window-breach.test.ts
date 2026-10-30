// Task gasmask-breach-20261030 (lane GAS): bullets crack and break the office tower's exterior window panes (world/windowBreach.ts,
// world/officeWindows.ts looks, world/gas/system.ts bulletHit) on lane GEN's REAL generated office:
//  - pane identity `level:span:column:row` is deterministic per seed; only exterior window panes generated intact / cracked are
//    breakable (never the boarded street entrance, generated broken / boarded panes, other glass);
//  - attribution through the REAL hitscan (combat/hitscan raycastWorld -> Levels.raycast): the room-side face of the window wall
//    cell, the ray continued to the glass plane inside a pane (mullion margin); frames, interior walls, other storeys and the
//    outside face are not panes; a prop in front takes the bullet (nearest hit);
//  - health (task gas-mask-roof-feedback-20261030, user item 2): PANE_MAX_HP = 3 x the weapon table's pistol damage; every
//    unobstructed bullet / pellet ray on a pane contributes ITS real damage (Game.fire's def.damage x range falloff) once — 3
//    pistol shots break it, a rifle needs 3 (2 x 24 < 51), a centred shotgun blast (>= 4 pellets on the glass) breaks it, a
//    partial blast contributes only its pellets on the pane, misses / blocked rays nothing; panes independent; it breaks once
//    and later bullets pass out (no crater, no damage, no cue); generated broken / boarded panes are inert; a generated-cracked
//    pane starts at full health;
//  - looks: every breakable pane's intact / cracked / broken looks are pre-built in the merged storey meshes and switched by
//    rewriting their vertex ranges (no new mesh / material / pipeline mid-play), glass rules kept;
//  - Game wiring (source): world hits only (after enemies / corpses / stock), never the knife, each ray offered once with its
//    damage; persistence of the pane damage (v 2) and the legacy hit-count conversion (v 1), never refilled.
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
import {PANE_MAX_HP, WINDOWS_LANE, WINDOW_BREACH, WindowBreaches, paneCentre, type PaneRef} from '../src/world/windowBreach';
import {installGas, type GasHost, type GasSystem} from '../src/world/gas/system';
import {WEAPONS, WeaponController, type WeaponDef} from '../src/weapons/weapons';
import {mulberry32} from '../src/core/rng';

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
    bulletHitHandlers: [] as ((wh: WorldHit, p: THREE.Vector3, d: THREE.Vector3, shot: number, damage: number) => boolean)[],
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

/** The damage Game.fire deals for one ray of `def` whose nearest hit is `t` m away (def.damage x range falloff). */
const rayDamage = (def: WeaponDef, t: number) => def.damage * WeaponController.falloff(def, t);

type Host = ReturnType<typeof gasHost>['h'];

/** One ray through the real hitscan offered to the handlers with Game.fire's damage for it (false: not a window's: a crater). */
function ray(w: World, h: Host, o: Vec3, at: Vec3, shot: number, def: WeaponDef): boolean {
  const s = shoot(w, o, at);
  return h.bulletHitHandlers.some(fn => fn(s.wh, s.point, s.dir, shot, rayDamage(def, s.wh.t)));
}

/** `n` rays of trigger pull `shot` (weapon `def`) spread inside a pane (golden-angle points within `spread` m of its centre). */
function pull(w: World, h: Host, ref: PaneRef, shot: number, def: WeaponDef = WEAPONS.pistol, n = 1, spread = 0.25): boolean[] {
  const out: boolean[] = [];
  for (let i = 0; i < n; i++) {
    const a = n === 1 ? 0 : Math.cos(i * 2.39996) * spread * Math.sqrt(i / n), y = n === 1 ? 0 : Math.sin(i * 2.39996) * spread * Math.sqrt(i / n);
    const {o, at} = aimAt(ref, a, y);
    out.push(ray(w, h, o, at, shot, def));
  }
  return out;
}

/**
 * One trigger pull of `def` from the eye `dist` m into the room, aimed at the pane's centre, with Game.fire's own pellet pattern
 * (dir = fwd + right·tan(r)·cos(a) + up·tan(r)·sin(a), r = spread·sqrt(u), hip spread), seeded. Returns per pellet whether a
 * window opening took it.
 */
function blast(w: World, h: Host, ref: PaneRef, shot: number, def: WeaponDef, seed: number, dist = 1.6): boolean[] {
  const {o, at} = aimAt(ref, 0, 0, dist), rand = mulberry32(seed);
  const fwd = new THREE.Vector3(at.x - o.x, at.y - o.y, at.z - o.z).normalize();
  const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize(), up = new THREE.Vector3().crossVectors(right, fwd).normalize();
  const out: boolean[] = [];
  for (let i = 0; i < def.pellets; i++) {
    const a = rand() * Math.PI * 2, r = def.spreadHip * Math.sqrt(rand());
    const d = fwd.clone().addScaledVector(right, Math.tan(r) * Math.cos(a)).addScaledVector(up, Math.tan(r) * Math.sin(a)).normalize();
    out.push(ray(w, h, o, {x: o.x + d.x, y: o.y + d.y, z: o.z + d.z}, shot, def));
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

const dmgOf = (sys: GasSystem, id: string) => sys.windows!.state.get(id)?.damage ?? 0;

describe('pane health: 3 pistol bullets of damage; every ray its real damage once; breaks once; inert generated panes', () => {
  it('PANE_MAX_HP = 3 x the weapon table\'s pistol damage (derived); pistol 3 shots, rifle 3 (2 is not enough), shotgun >= 4 pellets; falloff counts', () => {
    expect(WINDOW_BREACH.PISTOL_SHOTS).toBe(3);
    expect(PANE_MAX_HP).toBe(3 * WEAPONS.pistol.damage);
    expect(PANE_MAX_HP).toBe(51); // pistol 17 today (a pistol retune moves the panes with it)
    const W = new WindowBreaches(getWorld().plans);
    const refs = [...W.refs.values()].filter(r => r.pane.state === 'intact');
    const shots = (def: WeaponDef, ref: PaneRef, dist: number) => {
      let n = 0;
      while (!W.broken(ref.id) && n < 50) W.impact(ref, rayDamage(def, dist), 1000 + n++, 0);
      return n;
    };
    // point blank (inside every gun's falloff start): the design table
    expect(shots(WEAPONS.pistol, refs[0], 3)).toBe(3);
    expect(shots(WEAPONS.rifle, refs[1], 3)).toBe(3);
    expect(2 * WEAPONS.rifle.damage).toBeLessThan(PANE_MAX_HP); // 48 < 51
    expect(shots(WEAPONS.shotgun, refs[2], 3)).toBe(4); // pellets: 4 x 15 = 60 >= 51, 3 x 15 = 45 < 51
    // range falloff is real damage too: a pistol bullet from 40 m deals 17 x 0.81 ≈ 13.8 -> 4 bullets
    expect(rayDamage(WEAPONS.pistol, 40)).toBeLessThan(17);
    expect(shots(WEAPONS.pistol, refs[3], 40)).toBe(4);
    // a broken pane takes nothing; zero / non-finite damage contributes nothing (and never cracks)
    expect(W.impact(refs[0], 17, 2000, 0)).toMatchObject({applied: 0, broke: false});
    expect(W.impact(refs[4], 0, 2001, 0)).toMatchObject({applied: 0, look: null});
    expect(W.impact(refs[4], Number.NaN, 2002, 0)).toMatchObject({applied: 0, look: null});
    expect(W.state.get(refs[4].id)!.damage).toBe(0);
  });

  it('pistol through the real hitscan: 3 bullets crack then break it (once); later bullets pass out — no crater, no damage, no cue', () => {
    const w = getWorld();
    const {h, sys, sfx, damage} = gasHost(w);
    const [r] = clearPanes(w, sys.windows!, x => x.pane.state === 'intact' && x.plan.level === 2);
    expect(r).toBeDefined();
    expect(pull(w, h, r, 1)).toEqual([true]);
    expect(dmgOf(sys, r.id)).toBe(17);
    expect(w.view.panes.get(r.id)!.look).toBe('cracked'); // the first damage cracks it
    pull(w, h, r, 2);
    expect(dmgOf(sys, r.id)).toBe(34);
    expect(sys.windows!.broken(r.id)).toBe(false);
    expect(sfx.breakage).not.toHaveBeenCalled();
    pull(w, h, r, 3);
    expect(sys.windows!.broken(r.id)).toBe(true);
    expect(w.view.panes.get(r.id)!.look).toBe('broken');
    expect(sfx.breakage).toHaveBeenCalledTimes(1);
    expect(sfx.breakage.mock.calls[0][0]).toBe('breakGlass');
    expect(sfx.impact).toHaveBeenCalledTimes(3); // the glass cue: once per pull on the pane
    expect(sys.counts).toMatchObject({impacts: 3, damage: 51, broken: 1, cracked: 1});
    expect(sys.field!.storey(r.plan.level)!.breaches).toEqual([r.id]); // its gas started, once
    const bursts = damage.burst.mock.calls.length;
    expect(pull(w, h, r, 4)).toEqual([true]); // out through the hole
    expect(dmgOf(sys, r.id)).toBe(PANE_MAX_HP);
    expect(sfx.breakage).toHaveBeenCalledTimes(1);
    expect(damage.burst.mock.calls.length).toBe(bursts);
    expect(sys.counts.passThrough).toBe(1);
  });

  it('rifle through the real hitscan: 2 rounds (48) do not break it, the 3rd does', () => {
    const w = getWorld();
    const {h, sys} = gasHost(w);
    const [r] = clearPanes(w, sys.windows!, x => x.pane.state === 'intact' && x.plan.level === 4);
    pull(w, h, r, 1, WEAPONS.rifle); pull(w, h, r, 2, WEAPONS.rifle);
    expect(dmgOf(sys, r.id)).toBe(48);
    expect(sys.windows!.broken(r.id)).toBe(false);
    pull(w, h, r, 3, WEAPONS.rifle);
    expect(sys.windows!.broken(r.id)).toBe(true);
  });

  it('shotgun: a centred hip blast (Game.fire\'s pellet pattern) breaks a pane in ONE pull — every pellet counts until the break, the rest pass out; chips per pellet, one glass cue', () => {
    const w = getWorld();
    const {h, sys, sfx, fx} = gasHost(w);
    const panes = clearPanes(w, sys.windows!, x => x.pane.state === 'intact' && x.plan.level === 3 && x.pane.a1 - x.pane.a0 > 1);
    expect(panes.length).toBeGreaterThan(2);
    let broken = 0;
    for (const [k, r] of panes.slice(0, 3).entries()) {
      const before = {pass: sys.counts.passThrough, impacts: sys.counts.impacts};
      const took = blast(w, h, r, 100 + k, WEAPONS.shotgun, 77 + k);
      expect(took.every(Boolean), r.id).toBe(true); // every pellet on the glass: no crater
      expect(sys.windows!.broken(r.id), r.id).toBe(true);
      // 15-damage pellets: the 4th breaks it (60 >= 51), the other 5 leave through the hole
      expect(sys.counts.impacts - before.impacts).toBe(4);
      expect(sys.counts.passThrough - before.pass).toBe(WEAPONS.shotgun.pellets - 4);
      broken++;
    }
    expect(broken).toBe(3);
    expect(sfx.breakage).toHaveBeenCalledTimes(3);
    expect(sfx.impact).toHaveBeenCalledTimes(3); // one glass cue per pane per pull
    expect(fx.impact).toHaveBeenCalledTimes(3 * 4); // chips: every pellet that hit glass
  });

  it('shotgun partial hits and misses: only the pellets on the pane count (3 pellets = 45 crack it; misses / frame hits add nothing); the next pellet breaks it', () => {
    const w = getWorld();
    const {h, sys} = gasHost(w);
    const [r] = clearPanes(w, sys.windows!, x => x.pane.state === 'intact' && x.plan.level === 7 && x.plan.mullions.length > 0);
    const p = r.plan, c = paneCentre(r), {o} = aimAt(r);
    // one blast: 3 pellets on the pane, 2 on the mullion / frame (a crater: the damage system), 4 into the room's far side
    const S = WEAPONS.shotgun, shot = 300;
    expect(pull(w, h, r, shot, S, 3, 0.15)).toEqual([true, true, true]);
    const m = p.mullions.reduce((best, x) => Math.abs(x - (r.pane.a0 + r.pane.a1) / 2) < Math.abs(best - (r.pane.a0 + r.pane.a1) / 2) ? x : best);
    const onFrame = (dy: number) => ray(w, h, o, {x: p.along === 'x' ? m : c.x, y: c.y + dy, z: p.along === 'x' ? c.z : m}, shot, S);
    expect([onFrame(0), onFrame(0.2)]).toEqual([false, false]);
    for (let i = 0; i < 4; i++) expect(ray(w, h, o, {x: 2 * o.x - c.x + i * 0.3, y: c.y, z: 2 * o.z - c.z + i * 0.3}, shot, S)).toBe(false);
    expect(dmgOf(sys, r.id)).toBe(45);
    expect(sys.windows!.broken(r.id)).toBe(false);
    expect(w.view.panes.get(r.id)!.look).toBe('cracked');
    // the next blast: one pellet on it -> 60 >= 51
    pull(w, h, r, shot + 1, S, 1);
    expect(sys.windows!.broken(r.id)).toBe(true);
  });

  it('blocked rays contribute nothing (a prop in front takes the bullet: the pane is never offered it); every ray at most once, to at most one pane', () => {
    const w = getWorld();
    const {h, sys} = gasHost(w);
    let blocked = 0;
    for (const r of sys.windows!.refs.values()) {
      const {o, at} = aimAt(r, 0, -0.55, 1.2);
      const s = shoot(w, o, at);
      if (s.wh.kind !== 'prop') continue;
      expect(h.bulletHitHandlers[0](s.wh, s.point, s.dir, 1, 17)).toBe(false); // the damage system's (the prop's) hit
      expect(sys.windows!.state.has(r.id)).toBe(false);
      if (++blocked > 5) break;
    }
    expect(blocked).toBeGreaterThan(0);
    // rays swept across a span's panes and mullions (one ray = one nearest hit = at most one pane): the summed pane damage equals
    // the damage of the rays that were attributed to a pane — no ray ever counts twice or on two panes
    const W = new WindowBreaches(w.plans);
    const [r] = clearPanes(w, W, x => x.plan.level === 5 && x.plan.mullions.length > 1 && x.pane.state === 'intact');
    const p = r.plan, c = paneCentre(r), back = 1.6 + Math.abs(p.glass - p.inner);
    let attributed = 0, total = 0;
    for (let a = p.a0 + 0.05, k = 0; a < p.a1 - 0.05; a += 0.037, k++) {
      const o = {x: (p.along === 'x' ? a : c.x) + c.nx * back, y: c.y, z: (p.along === 'x' ? c.z : a) + c.nz * back};
      const s = shoot(w, o, {x: p.along === 'x' ? a : c.x, y: c.y, z: p.along === 'x' ? c.z : a});
      const hit = W.attribute(s.wh, s.point, s.dir);
      if (!hit?.ref) continue;
      attributed++;
      W.impact(hit.ref, 1, k, 0); // 1 damage per ray: the total is the number of contributions
    }
    for (const st of W.state.values()) total += st.damage;
    expect(attributed).toBeGreaterThan(10);
    expect(total).toBe(attributed);
  });

  it('panes take damage independently (one blast across two panes: each gets its own pellets)', () => {
    const w = getWorld();
    const {h, sys} = gasHost(w);
    const panes = clearPanes(w, sys.windows!, x => x.plan.level === 6 && x.pane.state === 'intact');
    const pair = panes.find(a => panes.some(b => b.plan === a.plan && b.pane.col === a.pane.col + 1 && b.pane.row === a.pane.row));
    expect(pair).toBeDefined();
    const A = pair!, B = panes.find(b => b.plan === A.plan && b.pane.col === A.pane.col + 1 && b.pane.row === A.pane.row)!;
    const S = WEAPONS.shotgun;
    pull(w, h, A, 1, S, 3, 0.15); pull(w, h, B, 1, S, 2, 0.15); // one blast: 3 pellets on A, 2 on B
    expect(dmgOf(sys, A.id)).toBe(45);
    expect(dmgOf(sys, B.id)).toBe(30);
    pull(w, h, B, 2); pull(w, h, B, 3); // two pistol bullets on B: 64
    expect(sys.windows!.broken(B.id)).toBe(true);
    expect(sys.windows!.broken(A.id)).toBe(false);
    expect(dmgOf(sys, A.id)).toBe(45);
  });

  it('a generated-cracked pane starts at full health (three pistol bullets); generated broken panes let bullets out (no crater, no damage, no gas); boarded panes stay the damage system\'s', () => {
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
    expect(h.bulletHitHandlers[0](hole.wh, hole.point, hole.dir, 50, 17)).toBe(true); // out through the hole: no crater
    const boards = inert('boarded')!;
    expect(h.bulletHitHandlers[0](boards.wh, boards.point, boards.dir, 51, 17)).toBe(false); // the boards: crater / chips as before
    expect(sfx.impact.mock.calls.length).toBe(before);
    expect(sys.counts.broken).toBe(br);
    expect(sys.field!.storeys.flatMap(s => s.breaches)).toEqual([c.id]);
  });

  it('pane damage persists through the lane store (v 2: saved -> restored -> the next bullet breaks it; revisits never refill); unknown ids are ignored', () => {
    const w = getWorld();
    const {h, sys, store} = gasHost(w);
    const [r, s] = clearPanes(w, sys.windows!, x => x.plan.level === 7 && x.pane.state === 'intact');
    pull(w, h, r, 1); pull(w, h, r, 2); // 2 pistol bullets: 34
    pull(w, h, s, 3, WEAPONS.shotgun, 3, 0.12); // 3 shotgun pellets: 45
    h.sectionHooks[0].teardown!();
    const rec = store.get(WINDOWS_LANE) as {v: number; damage: Record<string, number>; broken: Record<string, number>};
    expect(rec).toEqual({v: 2, damage: {[r.id]: 34, [s.id]: 45}, broken: {}});
    store.set(WINDOWS_LANE, {...rec, damage: {...rec.damage, '9:999:0:0': 20}, broken: {'4:999:1:0': 10}});
    h.sectionHooks[0].build!(w.L);
    expect(dmgOf(sys, r.id)).toBe(34);
    expect(dmgOf(sys, s.id)).toBe(45);
    expect(sys.windows!.state.size).toBe(2);
    expect(w.view.panes.get(r.id)!.look).toBe('cracked');
    pull(w, h, r, 4); // 51: breaks
    expect(sys.windows!.broken(r.id)).toBe(true);
    // revisit (Subway <-> Office travel rebuilds the world): broken stays broken, the damaged pane keeps its damage
    h.sectionHooks[0].teardown!();
    h.sectionHooks[0].build!(w.L);
    expect(sys.windows!.broken(r.id)).toBe(true);
    expect(w.view.panes.get(r.id)!.look).toBe('broken');
    expect(dmgOf(sys, s.id)).toBe(45);
    expect(sys.field!.storey(r.plan.level)!.breaches).toEqual([r.id]);
  });

  it('a legacy v 1 record (the old trigger-pull counter) converts safely: damage = min(max, hits x max / 3), broken stays broken, never refilled', () => {
    const w = getWorld();
    const {h, sys, store} = gasHost(w);
    const [a, b, c, d] = clearPanes(w, sys.windows!, x => x.plan.level === 8 && x.pane.state === 'intact');
    expect(d).toBeDefined();
    h.sectionHooks[0].teardown!();
    store.set(WINDOWS_LANE, {v: 1, hits: {[a.id]: 1, [b.id]: 2, [c.id]: 7, [d.id]: 2, '9:999:0:0': 2}, broken: {[d.id]: 12}});
    h.sectionHooks[0].build!(w.L);
    expect(dmgOf(sys, a.id)).toBeCloseTo(PANE_MAX_HP / 3, 9); // 17
    expect(dmgOf(sys, b.id)).toBeCloseTo(2 * PANE_MAX_HP / 3, 9); // 34
    expect(dmgOf(sys, c.id)).toBe(PANE_MAX_HP); // capped: not broken yet, the next damage breaks it
    expect(sys.windows!.broken(c.id)).toBe(false);
    expect(sys.windows!.broken(d.id)).toBe(true); // broken wins over its hit count
    for (const p of [a, b, c]) expect(w.view.panes.get(p.id)!.look).toBe('cracked');
    pull(w, h, a, 1); // 34: still whole
    expect(sys.windows!.broken(a.id)).toBe(false);
    pull(w, h, b, 2); // 51: breaks — exactly as 2 old hits + 1 more bullet did
    pull(w, h, c, 3, WEAPONS.shotgun, 1);
    expect(sys.windows!.broken(b.id)).toBe(true);
    expect(sys.windows!.broken(c.id)).toBe(true);
    // the next save is the v 2 record
    h.sectionHooks[0].teardown!();
    expect((store.get(WINDOWS_LANE) as {v: number}).v).toBe(2);
    // unknown versions / junk: nothing restored, nothing thrown
    for (const junk of [null, 5, 'x', {v: 3, damage: {[a.id]: 10}}, {v: 2, damage: {[a.id]: 'lots'}, broken: {[b.id]: 'old'}}]) {
      store.set(WINDOWS_LANE, junk);
      h.sectionHooks[0].build!(w.L);
      expect(sys.windows!.state.has(a.id)).toBe(false);
      h.sectionHooks[0].teardown!();
    }
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
  it('fire(): the handlers get the world hit in the world branch only, with the ray\'s real damage (def.damage x falloff); meleeContact never; one pull id per trigger pull', () => {
    const fire = body('fire');
    // the ray's damage = what hitWorld / a zombie hit would get for it: `shot.damage` = def.damage x WeaponController.falloff(def, bestT)
    expect(fire).toContain('const shot = {damage: def.damage * WeaponController.falloff(def, bestT), pellet: def.pellets > 1, weapon: def.id};');
    expect(fire).toContain('if (!this.bulletHit(wh, end, dir, shot.damage)) this.damage.hitWorld(wh, end, dir, shot);');
    expect(fire.indexOf('this.bulletHit(wh, end, dir, shot.damage)')).toBeGreaterThan(fire.indexOf('} else if (corpse && !fh) {'));
    // one offer per ray at most: the two call sites are exclusive branches of the same pellet (`fh` set: the stock / cooler path
    // only; `!fh`: the world branch only) — no duplicate contribution from one ray
    expect(fire.match(/this\.bulletHit\(/g)?.length).toBe(2);
    expect(fire).toContain('} else if (!fh && wh.kind !== \'none\') {');
    expect(fire.indexOf('if (fh.glass) {')).toBeGreaterThan(fire.indexOf('if (!fh) this.damage.knockPickups('));
    expect(fire.indexOf('if (fh.glass) {')).toBeLessThan(fire.indexOf('if (bestZ) {'));
    expect(fire.match(/this\.shotCounter\+\+/g)?.length).toBe(1);
    expect(body('meleeContact')).not.toContain('bulletHit');
    expect(body('bulletHit')).toContain('h(wh, point, dir, this.shotCounter, damage)');
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
    expect(h.bulletHitHandlers[0](s.wh, s.point, s.dir, 1, 17)).toBe(false);
  });
});
