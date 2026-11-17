// Task studio-mall-parking-glass-followup-20261117-043548-01: THE MALL's BREAKABLE PARKING-LOT GLAZING + its toxic gas (world/mallWindowPanes.ts
// on the Office's window contracts: world/windowBreach.ts, world/gas/system.ts window sources) — the visibility test the root CLAUDE.md rule
// requires for a new gas source ("Toxic gas is always VISIBLE green volumetric fog": what hurts looks gassy, what looks gassy hurts, one
// field for both). On REAL generated Malls (natural seeds of every plan family that glazes; the promenade's long wall carries the shots):
//  - plan: one WindowPlan per wall and glazed storey on the curtain wall's own grid, every pane intact + breakable, stable ids, the glass
//    behind the glazing plane inside the SOLID curtain cells, the walkway in front; version-1 / atrium Malls have none;
//  - runtime: buildWindows' Office glass materials and pre-built looks, tagged like the wall (storeys + aperture), culler + warm-up, teardown;
//  - loading gasses nothing (no record = every pane intact, no field storey, every layer zero);
//  - parity with the REAL VolumetricAtmosphere's gas layers: a pane shot through the real hitscan (PANE_MAX_HP of pistol rays; a mullion
//    is frame, not glass) breaches its storey only — exposure near it == concentrationAt == the drawn layer (x the shared height profile) >
//    0; it thins away into the mall; the pool stays inside the domain; another bullet passes out through the hole;
//  - the mask: dps 0, the exposure / layer / in-engine fallback unchanged;
//  - persistence ('mall.windows' per-station lane store): revisit restores looks + damage + gas, never refills / resets, unknown ids
//    ignored; a Mall with no record (new, or visited before this update) starts intact; a fresh run starts intact;
//  - the Game wiring (source order).
import {beforeAll, describe, expect, it, vi} from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import * as THREE from 'three';
import {installCanvasShim} from './helpers/canvas2d';
import {fakeEnvTextures} from './helpers/openablesFixture';
import {CELL, FLOOR, SOLID, VOID} from '../src/gen/grid';
import {levelsOf} from '../src/gen/levels';
import type {StationLayout} from '../src/gen/stationTypes';
import {generateMallLevel} from '../src/gen/mall/index';
import {raycastWorld, type Vec3, type WorldHit} from '../src/combat/hitscan';
import {WorldMaterials} from '../src/world/materials';
import {crackedGlassMaterial, officeGlassMaterial, paneBreakable, paneId} from '../src/world/officeWindows';
import {PANE_MAX_HP, WINDOWS_LANE, WINDOW_BREACH, paneCentre, type PaneRef} from '../src/world/windowBreach';
import {GAS, gasProfile} from '../src/world/gas/field';
import {installGas, type GasHost, type GasSystem} from '../src/world/gas/system';
import {MALL_GAS, MALL_WINDOWS_LANE, installMallWindows, mallGasClosed, mallGasDomain, planMallWindows, type MallWindowRuntime} from '../src/world/mallWindowPanes';
import {SKYWAYS_WINDOWS_LANE} from '../src/world/skywaysWindows';
import {windowApertureOf, windowWallSpecs} from '../src/world/mallWindows';
import {VolumetricAtmosphere} from '../src/render/volumetric';
import {WEAPONS, WeaponController} from '../src/weapons/weapons';

installCanvasShim(false);
let mats: WorldMaterials;
beforeAll(() => { mats = new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17}); });
const GAME = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Natural version-2 seeds that glaze (gen/mall/windows.ts): promenade 2 (one 88.5 m wall over storeys 1-3), galleria 5, crossroads 7. */
const PROMENADE = 2;
const GLAZED_SEEDS = [2, 5, 7];
const cache = new Map<string, StationLayout>();
const gen = (seed: number, version?: number): StationLayout => {
  const key = `${seed}:${version ?? 'cur'}`;
  let L = cache.get(key);
  if (!L) cache.set(key, (L = generateMallLevel({levelSeed: seed, startWeapon: 'pistol', ...(version !== undefined ? {layoutVersion: version} : {})})));
  return L;
};

// ---------------------------------------------------------------------------------------------
// A fake Game: the Mall glazing runtime (before GAS) + the gas system (its window source), a lane store, a real atmosphere's gas layers.

function game(L: StationLayout, o: {active?: boolean; store?: Map<string, unknown>} = {}) {
  const store = o.store ?? new Map<string, unknown>();
  const atmo = new VolumetricAtmosphere(null, {flashlight: new THREE.SpotLight()}, 'high');
  atmo.setStation(L, null);
  const fallbacks: number[] = [];
  const culler = {register: vi.fn()};
  let clock = 0;
  const lv1 = L.levels[1];
  const h = {
    scene: new THREE.Scene(), mats, layout: L, world: {culler},
    player: {x: 0, z: 0, y: lv1.baseY, eye: lv1.baseY + 1.6, radius: 0.3, alive: true, takeDamage: vi.fn()},
    warmRegistry: {addPool: vi.fn()}, tower: {office: null},
    atmosphere: {
      active: o.active ?? true, markShadows: vi.fn(),
      setGasLayer: (s: number, f: ArrayLike<number>, r: {x0: number; y0: number; w: number; h: number}) => atmo.setGasLayer(s, f, r),
      setGasFallback: (c: number) => { fallbacks.push(c); atmo.setGasFallback(c); },
    },
    sfx: {impact: vi.fn(), breakage: vi.fn()}, fx: {impact: vi.fn()}, damage: {burst: vi.fn(() => 3)},
    run: {laneStore: (k: string) => store.get(k), setLaneStore: (k: string, v: unknown) => { if (v === undefined) store.delete(k); else store.set(k, structuredClone(v)); }},
    get clock() { return clock; }, set clock(v: number) { clock = v; },
    state: 'playing', frameHooks: [] as ((dt: number) => void)[], sectionHooks: [] as {build?(l: StationLayout): void; teardown?(): void}[],
    sectionPreloads: [] as ((l: StationLayout) => Promise<void>)[], stateListeners: [] as ((s: never, p: never) => void)[],
    bulletHitHandlers: [] as ((wh: WorldHit, p: THREE.Vector3, d: THREE.Vector3, shot: number, damage: number) => boolean)[],
  };
  const rt: MallWindowRuntime = installMallWindows(h as never);
  const sys: GasSystem = installGas(h as unknown as GasHost);
  sys.windowSources.push(() => rt.gasSource());
  const build = () => { for (const s of h.sectionHooks) s.build?.(L); };
  const teardown = () => { for (const s of h.sectionHooks) s.teardown?.(); };
  const step = (seconds: number, dt = 0.1) => { for (let t = 0; t < seconds - 1e-9; t += dt) { clock += dt; for (const f of h.frameHooks) f(dt); } };
  const eyeAt = (x: number, z: number, level: number) => { Object.assign(h.player, {x, z, y: L.levels[level].baseY, eye: L.levels[level].baseY + 1.6}); for (const f of h.frameHooks) f(0); return sys.exposure; };
  build();
  return {h, rt, sys, atmo, store, culler, fallbacks, build, teardown, step, eyeAt};
}

/** The march's view of the gas at (x, y, z): the R8 layer of the band's slot, bilinear (texel centres = cell centres) x the profile. */
function drawnAt(atmo: VolumetricAtmosphere, x: number, y: number, z: number): {c: number; layer: number; slot: number} {
  const m = atmo.densityMap!, data = (atmo as unknown as {gasData: Uint8Array}).gasData, band = atmo.bandAt(x, y, z)!;
  const base = band.slot * m.w * m.h;
  const at = (a: number, b: number) => (a < 0 || b < 0 || a >= m.w || b >= m.h ? 0 : data[base + b * m.w + a] / 255);
  const u = x / CELL - 0.5, v = z / CELL - 0.5, iu = Math.floor(u), iv = Math.floor(v), fu = u - iu, fv = v - iv;
  const layer = (at(iu, iv) * (1 - fu) + at(iu + 1, iv) * fu) * (1 - fv) + (at(iu, iv + 1) * (1 - fu) + at(iu + 1, iv + 1) * fu) * fv;
  return {c: layer * gasProfile(y, band.floor, band.ceil), layer, slot: band.slot};
}
const layerSum = (atmo: VolumetricAtmosphere, slot: number) => {
  const m = atmo.densityMap!, data = (atmo as unknown as {gasData: Uint8Array}).gasData;
  let n = 0;
  for (let i = slot * m.w * m.h; i < (slot + 1) * m.w * m.h; i++) n += data[i];
  return n;
};
const unit = (v: Vec3): Vec3 => { const l = Math.hypot(v.x, v.y, v.z); return {x: v.x / l, y: v.y / l, z: v.z / l}; };

/** A shooting pose for a pane: `back` m into the mall from its glass, at the pane's centre height, aimed straight at it (and the ray). */
function aimAt(ref: PaneRef, back = 1.6, da = 0) {
  const c = paneCentre(ref), p = ref.plan;
  const ax = p.along === 'x' ? da : 0, az = p.along === 'x' ? 0 : da;
  const target = {x: c.x + ax, y: c.y, z: c.z + az};
  const o = {x: target.x + c.nx * (back + Math.abs(p.glass - p.inner)), y: c.y, z: target.z + c.nz * (back + Math.abs(p.glass - p.inner))};
  return {o, d: unit({x: target.x - o.x, y: 0, z: target.z - o.z}), c};
}

/** One pistol ray from `o` along `d` through the bullet handlers (Game.fire's order: world hit, then handlers before the damage system). */
function fire(L: StationLayout, h: ReturnType<typeof game>['h'], o: Vec3, d: Vec3, shot: number, damage?: number): {wh: WorldHit; took: boolean} {
  const wh = raycastWorld(levelsOf(L), L.props, o, d, 60, L.trench.floorY);
  const point = new THREE.Vector3(o.x + d.x * wh.t, o.y + d.y * wh.t, o.z + d.z * wh.t);
  const dmg = damage ?? WEAPONS.pistol.damage * WeaponController.falloff(WEAPONS.pistol, wh.t);
  return {wh, took: h.bulletHitHandlers.some(fn => fn(wh, point, new THREE.Vector3(d.x, d.y, d.z), shot, dmg))};
}

/** A middle pane of the promenade wall on `level` whose shooting lane from 1.6 m inside is clear to the glazing (no prop in the way). */
function clearPane(L: StationLayout, sys: GasSystem, level: number, row = 0): PaneRef {
  const refs = [...sys.windows!.refs.values()].filter(r => r.plan.level === level && r.pane.row === row).sort((a, b) => a.pane.col - b.pane.col);
  const mid = refs.length >> 1;
  for (let k = 0; k < refs.length; k++) {
    const r = refs[(mid + (k % 2 ? -(k + 1) / 2 : k / 2) + refs.length) % refs.length];
    const {o, d} = aimAt(r);
    const wh = raycastWorld(levelsOf(L), L.props, o, d, 60, L.trench.floorY);
    if (wh.kind === 'wall' && wh.level === level && Math.abs(wh.t - (1.6 + 0)) < 0.05) return r;
  }
  throw new Error(`no clear pane on L${level}`);
}

// ---------------------------------------------------------------------------------------------

describe('mall window walls: the pane plan (pure)', () => {
  it('one plan per wall and glazed storey on the curtain grid: every pane intact + breakable, stable ids, glass in the SOLID curtain, walkway in front', () => {
    for (const seed of GLAZED_SEEDS) {
      const L = gen(seed), specs = windowWallSpecs(L), plans = planMallWindows(L);
      expect(specs.length, `seed ${seed} walls`).toBeGreaterThan(0);
      expect(plans.length).toBe(specs.reduce((n, s) => n + s.bands.length, 0));
      const ids = new Set<string>();
      for (const p of plans) {
        const s = specs.find(q => q.index === p.index)!, out = p.n[0] + p.n[1], g = L.levels[p.level].grid;
        expect(s.bands.map(b => b.level)).toContain(p.level);
        expect(p.inner).toBe(s.plane);
        expect((p.glass - p.inner) * out, 'the glass behind the glazing plane').toBeGreaterThan(0.05);
        expect((p.glass - p.inner) * out).toBeLessThan(0.5); // (inside the one-cell curtain wall)
        expect(p.panes.length).toBeGreaterThan(2);
        for (const pane of p.panes) {
          expect(pane.state).toBe('intact');
          expect(paneBreakable(p, pane)).toBe(true);
          const id = paneId(p, pane);
          expect(ids.has(id), id).toBe(false);
          ids.add(id);
          expect(pane.a0 >= s.s0 - 0.05 && pane.a1 <= s.s1 + 0.05 && pane.y0 >= p.baseY && pane.y1 <= p.y1 + 0.05, `${id} in the span`).toBe(true);
          // the cell holding the glass is SOLID (collision: nothing walks / shoots / sees through), the cell in front is the walkway
          const a = (pane.a0 + pane.a1) / 2, cell = (c: number) => (p.along === 'x' ? g.idx(Math.floor(a / CELL), Math.floor(c / CELL)) : g.idx(Math.floor(c / CELL), Math.floor(a / CELL)));
          expect(g.cells[cell(p.glass)], `${id} glass cell`).toBe(SOLID);
          expect(g.cells[cell(p.inner - out * 0.25)], `${id} walkway`).toBe(FLOOR);
        }
      }
      expect(JSON.stringify(planMallWindows(gen(seed)))).toBe(JSON.stringify(plans)); // deterministic
    }
    for (const s of [1, 3, 11]) expect(planMallWindows(gen(s, 1))).toEqual([]); // version 1 (every visited old Mall): no window walls
  }, 120_000);

  it('the gas domain = each wall\'s neighbourhood (pool + spill margin) inside the grid; VOID cells (per storey) and lift shafts are closed', () => {
    const L = gen(PROMENADE), specs = windowWallSpecs(L), g0 = L.levels[0].grid;
    const d = mallGasDomain(specs, g0)!;
    expect(d.x0 >= 0 && d.y0 >= 0 && d.x1 <= g0.w && d.y1 <= g0.h).toBe(true);
    for (const s of specs) {
      const alongX = s.nz !== 0, out = s.nx + s.nz;
      const inX = (x: number) => x >= d.x0 * CELL && x <= d.x1 * CELL, inZ = (z: number) => z >= d.y0 * CELL && z <= d.y1 * CELL;
      const room = s.plane - out * (MALL_GAS.margin - 1);
      if (alongX) expect(inX(Math.max(0, s.s0 - MALL_GAS.margin + 1)) && inX(Math.min(g0.w * CELL, s.s1 + MALL_GAS.margin - 1)) && inZ(room) && inZ(s.plane)).toBe(true);
      else expect(inZ(Math.max(0, s.s0 - MALL_GAS.margin + 1)) && inZ(Math.min(g0.h * CELL, s.s1 + MALL_GAS.margin - 1)) && inX(room) && inX(s.plane)).toBe(true);
    }
    expect(MALL_GAS.margin).toBeGreaterThan(GAS.POOL_RADIUS_M + Math.sqrt(GAS.D / GAS.K_SPILL) * Math.log(1 / GAS.FLUSH));
    const closed = mallGasClosed(L);
    let voids = 0;
    for (const lv of L.levels) for (let i = 0; i < lv.grid.cells.length; i += 7) {
      const cx = i % lv.grid.w, cy = (i - cx) / lv.grid.w;
      if (lv.grid.cells[i] === VOID) { expect(closed(cx, cy, lv.id)).toBe(true); voids++; }
      else if (lv.grid.cells[i] === FLOOR && !(L.mall!.elevators ?? []).some(e => (cx + 0.5) * CELL > e.shaft.x0 && (cx + 0.5) * CELL < e.shaft.x1 && (cy + 0.5) * CELL > e.shaft.z0 && (cy + 0.5) * CELL < e.shaft.z1)) expect(closed(cx, cy, lv.id)).toBe(false);
    }
    expect(voids).toBeGreaterThan(0);
    for (const e of L.mall!.elevators ?? []) expect(closed(Math.floor((e.shaft.x0 + e.shaft.x1) / 2 / CELL), Math.floor((e.shaft.z0 + e.shaft.z1) / 2 / CELL), 1)).toBe(true);
  }, 120_000);
});

describe('mall window walls: the runtime', () => {
  it('builds every pane\'s looks on the Office glass path, tagged like the wall (storeys + aperture); culler + warm-up; nothing gassed at load', () => {
    const L = gen(PROMENADE);
    const {h, rt, sys, atmo, culler, eyeAt} = game(L);
    const g = rt.glazing!, specs = windowWallSpecs(L);
    expect(g.plans).toEqual(planMallWindows(L));
    const breakable = g.plans.reduce((n, p) => n + p.panes.length, 0);
    expect(g.view.panes.size).toBe(breakable);
    expect(sys.windows!.refs.size).toBe(breakable);
    for (const pv of g.view.panes.values()) expect(pv.look).toBe('intact');
    expect(h.scene.children).toContain(g.root);
    expect(culler.register).toHaveBeenCalledWith(g.root);
    expect(h.warmRegistry.addPool).toHaveBeenCalledWith('mall-windows', expect.any(Function));
    const pool = (h.warmRegistry.addPool.mock.calls[0][1] as () => THREE.Object3D[])();
    expect(pool).toEqual([g.root]);
    const meshes: THREE.Mesh[] = [];
    g.root.traverse(o => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
    const intact = officeGlassMaterial(mats), cracked = crackedGlassMaterial(null);
    for (const s of specs) {
      const mine = meshes.filter(m => m.userData.windowWall === s.id);
      expect(mine.length).toBe(2 * s.bands.length); // per storey: the intact glass + the cracked / broken looks
      for (const m of mine) {
        expect(m.userData.levels).toEqual(s.bands.map(b => b.level));
        expect(m.userData.aperture).toEqual(windowApertureOf(s));
        expect([intact, cracked]).toContain(m.material);
        expect(m.castShadow).toBe(false);
        expect(m.name.startsWith(`mall-window-${s.id}-glass`)).toBe(true);
        // every look of every pane lies in the SOLID curtain wall's box (visual = collision)
        const c = s.collider, P = m.geometry.getAttribute('position');
        m.geometry.computeBoundingBox();
        const b = m.geometry.boundingBox!;
        expect(b.min.x >= c.x0 - 1e-6 && b.max.x <= c.x1 + 1e-6 && b.min.z >= c.z0 - 1e-6 && b.max.z <= c.z1 + 1e-6 && b.min.y >= c.y0 - 1e-6 && b.max.y <= c.y1 + 1e-6, `${m.name} in the collider`).toBe(true);
        expect(P.count).toBeGreaterThan(0);
      }
    }
    // loading gasses nothing: no breach, no storey field, zero exposure at the glass, every layer zero
    expect(sys.field).not.toBeNull();
    expect(sys.field!.storeys.length).toBe(0);
    expect(sys.windows!.breaches(0)).toEqual([]);
    const ref = [...sys.windows!.refs.values()][0], c = paneCentre(ref);
    expect(eyeAt(c.x + c.nx, c.z + c.nz, ref.plan.level).c).toBe(0);
    for (let s = 0; s < L.levels.length; s++) expect(layerSum(atmo, s)).toBe(0);
  }, 120_000);

  it('teardown removes and disposes the glazing; a Mall without window walls (version 1) builds none and has no window world', () => {
    const L = gen(PROMENADE);
    const {h, rt, teardown} = game(L);
    const g = rt.glazing!, spies = g.view.geometries.map(q => vi.spyOn(q, 'dispose'));
    teardown();
    expect(rt.glazing).toBeNull();
    expect(h.scene.children).not.toContain(g.root);
    for (const s of spies) expect(s).toHaveBeenCalled();
    const old = game(gen(1, 1));
    expect(old.rt.glazing).toBeNull();
    expect(old.sys.windows).toBeNull();
    expect(old.sys.field).toBeNull();
  }, 120_000);
});

describe('mall window walls: shots, the breach gas, hazard <-> visual parity', () => {
  it('a pane SHOT through the real hitscan breaks after PANE_MAX_HP of pistol rays; exposure near it == concentrationAt == the drawn layer > 0; its storey only', () => {
    const L = gen(PROMENADE);
    const {h, sys, atmo, step, eyeAt} = game(L);
    const ref = clearPane(L, sys, 1);
    const {o, d, c} = aimAt(ref);
    let shots = 0;
    while (!sys.windows!.broken(ref.id) && shots < 10) {
      const {wh, took} = fire(L, h, o, d, ++shots);
      expect(wh.kind).toBe('wall');
      expect(wh.level).toBe(1);
      expect(took, 'the glass took it (no crater)').toBe(true);
      if (!sys.windows!.broken(ref.id)) expect(sys.windows!.state.get(ref.id)!.damage).toBeCloseTo(shots * WEAPONS.pistol.damage * WeaponController.falloff(WEAPONS.pistol, wh.t), 6);
    }
    expect(shots).toBe(Math.ceil(PANE_MAX_HP / WEAPONS.pistol.damage));
    expect(sys.windows!.broken(ref.id)).toBe(true);
    expect(sys.counts.broken).toBe(1);
    expect(h.sfx.breakage).toHaveBeenCalledWith('breakGlass', expect.any(Number), expect.any(Number), expect.any(Number), 1);
    expect(sys.windows!.breaches(0).map(b => b.ref.id)).toEqual([ref.id]); // its neighbours stay intact
    step(12);
    const y = L.levels[1].baseY + 1.6;
    let n = 0;
    for (const [da, dn] of [[0, 1.0], [0.6, 1.4], [-0.7, 2.1], [0.2, 3.0]] as const) {
      const along = ref.plan.along === 'x';
      const x = c.x + c.nx * dn + (along ? da : 0), z = c.z + c.nz * dn + (along ? 0 : da);
      const e = eyeAt(x, z, 1), dr = drawnAt(atmo, x, y, z);
      expect(e.c, `exposure ${da},${dn}`).toBeGreaterThan(0.05);
      expect(e.c).toBeCloseTo(sys.field!.concentrationAt(x, y, z), 9);
      expect(e.source).toBe('field');
      expect(dr.slot).toBe(1);
      expect(dr.layer).toBeGreaterThan(0);
      expect(Math.abs(e.c - dr.c), `parity ${da},${dn}`).toBeLessThan(0.02);
      n++;
    }
    expect(n).toBe(4);
    expect(eyeAt(c.x + c.nx * 1.4, c.z + c.nz * 1.4, 1).dps).toBeGreaterThan(0); // unprotected: it hurts
    // the storey above / below sees nothing: no field there, its layers stay zero
    expect(sys.field!.storeys.map(s => s.level)).toEqual([1]);
    for (const s of [0, 2, 3]) expect(layerSum(atmo, s)).toBe(0);
    expect(eyeAt(c.x + c.nx * 1.4, c.z + c.nz * 1.4, 2).c).toBe(0);
    // another bullet through the hole passes out (no crater, no damage)
    const pass = sys.counts.passThrough;
    expect(fire(L, h, o, d, 99).took).toBe(true);
    expect(sys.counts.passThrough).toBe(pass + 1);
  }, 120_000);

  it('a mullion is frame, not glass (the damage system takes it); the gas thins ON SCREEN as the hazard drops into the mall; the pool stays in the domain', () => {
    const L = gen(PROMENADE);
    const {h, sys, atmo, step, eyeAt} = game(L);
    const ref = clearPane(L, sys, 2);
    // a ray at the mullion between this pane and the next: no pane takes it (the frame); nothing breaks
    const p = ref.plan, a = p.mullions.find(m => Math.abs(m - ref.pane.a1) < 0.1 || Math.abs(m - ref.pane.a0) < 0.1)!;
    expect(a).toBeDefined();
    const {o, d} = aimAt(ref, 1.6, a - (ref.pane.a0 + ref.pane.a1) / 2);
    const mull = fire(L, h, o, d, 1, 500);
    expect(mull.wh.kind).toBe('wall');
    expect(mull.took).toBe(false);
    expect(sys.windows!.breaches(0)).toEqual([]);
    expect(sys.breakPane(ref.id)).toBe(true);
    step(30);
    const c = paneCentre(ref), y = L.levels[2].baseY + 1.6;
    let prev = Infinity, checked = 0;
    for (let dn = 0.8; dn < 14; dn += 0.6) {
      const x = c.x + c.nx * dn, z = c.z + c.nz * dn;
      if (L.levels[2].grid.cells[L.levels[2].grid.idx(Math.floor(x / CELL), Math.floor(z / CELL))] !== FLOOR) break;
      const e = eyeAt(x, z, 2), dr = drawnAt(atmo, x, y, z);
      expect(Math.abs(e.c - dr.c), `dn ${dn}`).toBeLessThan(0.02);
      expect(e.c).toBeLessThanOrEqual(prev + 0.02);
      prev = e.c;
      checked++;
    }
    expect(checked).toBeGreaterThan(5);
    // every field cell is in the uploaded layer (R8), and nothing else is; nothing reaches the domain's closed ring
    const st = sys.field!.storey(2)!, r = sys.field!.rect, m = atmo.densityMap!;
    let cells = 0, edge = 0;
    for (let yy = 0; yy < r.h; yy++) for (let xx = 0; xx < r.w; xx++) {
      const v = st.c[yy * r.w + xx], gx = r.x0 + xx, gy = r.y0 + yy;
      if (gx < 0 || gy < 0 || gx >= m.w || gy >= m.h) continue;
      const lay = (atmo as unknown as {gasData: Uint8Array}).gasData[2 * m.w * m.h + gy * m.w + gx] / 255;
      expect(Math.abs(lay - v)).toBeLessThanOrEqual(0.5 / 255 + 1e-6);
      if (v > 0) cells++;
      if (v > 0 && (xx <= 1 || yy <= 1 || xx >= r.w - 2 || yy >= r.h - 2)) edge++;
    }
    expect(cells).toBeGreaterThan(100);
    expect(edge).toBe(0);
  }, 120_000);

  it('the mask protects the lungs only: dps 0, but the exposure c, the drawn layer and the in-engine fallback (pass off) are unchanged', () => {
    const L = gen(PROMENADE);
    for (const active of [true, false]) {
      const {sys, atmo, eyeAt, step, fallbacks} = game(L, {active});
      const ref = clearPane(L, sys, 1);
      sys.breakPane(ref.id);
      step(10);
      const c = paneCentre(ref), x = c.x + c.nx * 1.2, z = c.z + c.nz * 1.2, y = L.levels[1].baseY + 1.6;
      const bare = eyeAt(x, z, 1);
      const snap = {c: bare.c, dps: bare.dps, fb: fallbacks.at(-1)!, layer: drawnAt(atmo, x, y, z).layer};
      expect(snap.dps).toBeGreaterThan(0);
      sys.protection = () => true;
      const masked = eyeAt(x, z, 1);
      expect(masked.protected).toBe(true);
      expect(masked.dps).toBe(0);
      expect(masked.c).toBeCloseTo(snap.c, 12);
      expect(drawnAt(atmo, x, y, z).layer).toBe(snap.layer);
      expect(fallbacks.at(-1)).toBe(snap.fb);
      // the WebGL2 / pass-off fallback draws the same eye concentration in-engine (never a CSS overlay); the pass draws the layers
      expect(snap.fb).toBe(active ? 0 : snap.c);
      expect(sys.hud.shown.haze).toBe(0);
    }
  }, 120_000);
});

describe('mall window walls: persistence', () => {
  it("teardown saves 'mall.windows'; a rebuild restores looks, damage and gas (never refilled / reset, breaches seeded once); unknown ids ignored", () => {
    const L = gen(PROMENADE);
    const {h, rt, sys, store, step, teardown, build, eyeAt} = game(L);
    const broken = clearPane(L, sys, 1), cracked = clearPane(L, sys, 3);
    const aim = aimAt(cracked);
    fire(L, h, aim.o, aim.d, 1); // one pistol bullet: cracked, not broken
    const dmg = sys.windows!.state.get(cracked.id)!.damage;
    expect(dmg).toBeGreaterThan(0);
    expect(rt.glazing!.view.panes.get(cracked.id)!.look).toBe('cracked');
    sys.breakPane(broken.id);
    step(20);
    const c = paneCentre(broken), ex = c.x + c.nx * 1.5, ez = c.z + c.nz * 1.5, live = eyeAt(ex, ez, 1).c;
    expect(live).toBeGreaterThan(GAS.THRESHOLD);
    teardown();
    expect(store.has(WINDOWS_LANE)).toBe(false); // never the Office's record
    expect(store.has(SKYWAYS_WINDOWS_LANE)).toBe(false);
    const rec = store.get(MALL_WINDOWS_LANE) as {v: number; damage: Record<string, number>; broken: Record<string, number>};
    expect(rec.v).toBe(2);
    expect(Object.keys(rec.broken)).toEqual([broken.id]);
    expect(rec.broken[broken.id]).toBeLessThanOrEqual(WINDOW_BREACH.AGE_CAP_S);
    expect(rec.damage[cracked.id]).toBeCloseTo(dmg, 2);
    const saved = structuredClone(rec);
    // leave and come back (or Continue a save carrying the record): restored, the record never rewritten by the build
    build();
    expect(store.get(MALL_WINDOWS_LANE)).toEqual(saved);
    expect(sys.windows!.breaches(0).map(b => b.ref.id)).toEqual([broken.id]);
    expect(rt.glazing!.view.panes.get(broken.id)!.look).toBe('broken');
    expect(rt.glazing!.view.panes.get(cracked.id)!.look).toBe('cracked');
    expect(sys.windows!.state.get(cracked.id)!.damage).toBeCloseTo(dmg, 2); // never refilled
    const st = sys.field!.storey(1)!;
    expect(st.breaches).toEqual([broken.id]); // seeded once
    expect(Math.abs(eyeAt(ex, ez, 1).c - live)).toBeLessThan(0.08); // the gas fast-forwarded from the saved age
    // the cracked pane needs only the rest of its health
    let more = 0;
    while (!sys.windows!.broken(cracked.id) && more < 5) fire(L, h, aim.o, aim.d, 10 + ++more);
    expect(more).toBe(Math.ceil((PANE_MAX_HP - dmg) / WEAPONS.pistol.damage - 1e-9));
    // a record with ids this layout does not have (another build's) restores nothing unknown and never throws
    teardown();
    store.set(MALL_WINDOWS_LANE, {v: 2, damage: {'9:9:9:9': 30}, broken: {'8:8:8:8': 10, [broken.id]: 5}});
    build();
    expect(sys.windows!.breaches(0).map(b => b.ref.id)).toEqual([broken.id]);
    expect(sys.windows!.refs.has('9:9:9:9')).toBe(false);
    // a Mall with NO record (a new one, or one visited before this update) / a fresh run: every pane intact, nothing gassed
    teardown();
    store.clear();
    build();
    expect(sys.windows!.breaches(0)).toEqual([]);
    expect(sys.windows!.state.size).toBe(0);
    expect(sys.field!.storeys.length).toBe(0);
    for (const pv of rt.glazing!.view.panes.values()) expect(pv.look).toBe('intact');
  }, 120_000);
});

describe('the Game wiring', () => {
  it('installMallWindows before installGas, its window source after the Skyways one; the vehicle model keys hook registered', () => {
    const src = fs.readFileSync(path.join(GAME, 'src/game.ts'), 'utf8');
    const iMall = src.indexOf('this.mallWindows = installMallWindows(this)'), iGas = src.indexOf('this.gas = installGas(this)');
    expect(iMall).toBeGreaterThan(0);
    expect(iMall).toBeLessThan(iGas);
    const iSky = src.indexOf('this.gas.windowSources.push(() => this.skywaysWindows.gasSource())'), iSrc = src.indexOf('this.gas.windowSources.push(() => this.mallWindows.gasSource())');
    expect(iSky).toBeGreaterThan(iGas);
    expect(iSrc).toBeGreaterThan(iSky);
    expect(src).toMatch(/sectionModelKeys[^\n]*mallVehicleModelKeysFor/);
  });
});
