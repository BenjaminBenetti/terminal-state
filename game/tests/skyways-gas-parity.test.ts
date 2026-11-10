// Task studio-skyways-level-20261106-054448 (lane GAS): THE SKYWAYS GLAZING + its toxic gas (world/skywaysWindows.ts, world/gas/system.ts
// window sources) — the visibility test the root CLAUDE.md rule requires for a new gas source ("Toxic gas is always VISIBLE green
// volumetric fog": what hurts looks gassy, what looks gassy hurts, one field for both). On a SYNTHETIC Skyways layout (two buildings,
// a pre-breached +15 bridge between them, facade glazing on the street and skyway storeys; the lead's generator replaces it once it
// lands — the last block runs on the real level automatically when LEVELS.skyways exists):
//  - plan: no inert broken glass (intact / cracked breakable, or broken because breached), the breached spans pre-breached, stable ids;
//  - the builder cut on the REAL extracted wall faces (a facade doorway in the same run kept), the runtime build / culler / colliders /
//    teardown;
//  - parity with the REAL VolumetricAtmosphere's gas layers: a pre-breached bridge is gassed at load (exposure > threshold mid-bridge,
//    the skyway storey's layer non-zero there, the march's band = that storey) and a pane shot through the real hitscan breaches —
//    exposure at nearby cells == concentrationAt == the uploaded layer (x the shared height profile) > 0; the tongue into the concourse
//    thins on screen exactly as the hazard; the green look is dense across the bridge;
//  - the mask: dps 0, the exposure / layer / in-engine fallback unchanged;
//  - persistence ('skyways.windows' per-station lane store): revisit restores, never seeds twice; a fresh run seeds again;
//  - lane CAR's breakPaneNear; the Office path unchanged; the Game / builder wiring.
import {beforeAll, describe, expect, it, vi} from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import * as THREE from 'three';
import {installCanvasShim} from './helpers/canvas2d';
import {fakeEnvTextures} from './helpers/openablesFixture';
import {CELL, FLOOR, SOLID, Grid} from '../src/gen/grid';
import {levelsOf} from '../src/gen/levels';
import type {Area, StationLayout} from '../src/gen/stationTypes';
import type {SkywaysInfo, SkywaysWindow} from '../src/gen/skyways/skywaysTypes';
import {raycastWorld, type Vec3, type WorldHit} from '../src/combat/hitscan';
import {WorldMaterials} from '../src/world/materials';
import {LevelColumns, extractWallFaces, stationLevels} from '../src/world/levelGeometry';
import {paneBreakable, paneId} from '../src/world/officeWindows';
import {PANE_MAX_HP, WINDOWS_LANE, WINDOW_BREACH, paneCentre, type PaneRef} from '../src/world/windowBreach';
import {GAS, gasProfile} from '../src/world/gas/field';
import {installGas, paneDistance, prebreachRecord, type GasHost, type GasSystem} from '../src/world/gas/system';
import {
  SKYWAYS_WINDOWS_LANE, cutSkywaysWindows, cutWindowSpans, installSkywaysWindows, planSkywaysWindows, prebreachedPanes, skywaysPaneState,
  type SkywaysWindowRuntime,
} from '../src/world/skywaysWindows';
import {VolumetricAtmosphere} from '../src/render/volumetric';
import {gasOpacity, greenness} from '../src/world/gaslightRules';
import {WEAPONS, WeaponController} from '../src/weapons/weapons';
import {LEVELS} from '../src/levels/registry';
import type {LevelDef} from '../src/levels/types';

installCanvasShim(false);
let mats: WorldMaterials;
beforeAll(() => { mats = new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17}); });
const GAME = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ---------------------------------------------------------------------------------------------
// The synthetic Skyways layout (world m; CELL 0.5): building A (B0) x 4..26, building B (B1) x 44..66, both z 6..34, a street
// between them (solid on every storey), the +15 bridge K0 (deck x 26..44, z 18..22) joining them through two facade doorways.

const W = 150, H = 90;
const Y = {station: -6, street: 0, skyway: 5.5} as const;
const BRIDGE = {x0: 26, z0: 18, x1: 44, z1: 22};
const MID = {x: 35, z: 20};

function fixture(): StationLayout {
  const levels = [0, 1, 2].map(id => ({id, role: (id === 0 ? 'main' : 'upper') as 'main' | 'upper', grid: new Grid(W, H), baseY: [Y.station, Y.street, Y.skyway][id]}));
  const areas: Area[] = [];
  const area = (type: Area['type'], kind: Area['kind'], level: number, x: number, y: number, w: number, h: number, ceil: number): number => {
    const id = areas.length;
    areas.push({id, kind, type, label: `${type} ${id}`, ceil, parent: -1, depth: 0, publicSpace: true, lighting: 'lit', x, y, w, h, level, floorY: levels[level].baseY} as Area);
    return id;
  };
  const open = (lv: number, x0: number, y0: number, x1: number, y1: number, a: number, ceil: number) => {
    const g = levels[lv].grid;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = g.idx(x, y); g.cells[i] = FLOOR; g.area[i] = a; g.floor[i] = levels[lv].baseY; g.ceil[i] = ceil; }
  };
  const st = area('platform', 'platform', 0, 12, 16, 36, 16, Y.station + 4);
  open(0, 12, 16, 48, 32, st, Y.station + 4);
  const lobA = area('concourse', 'concourse', 1, 9, 13, 42, 54, 4.5), lobB = area('concourse', 'concourse', 1, 89, 13, 42, 54, 4.5);
  open(1, 9, 13, 51, 67, lobA, 4.5);
  open(1, 89, 13, 131, 67, lobB, 4.5);
  const conA = area('concourse', 'concourse', 2, 9, 13, 42, 54, Y.skyway + 3.5), conB = area('concourse', 'concourse', 2, 89, 13, 42, 54, Y.skyway + 3.5);
  const deck = area('passage', 'passage', 2, 52, 36, 36, 8, Y.skyway + 3);
  open(2, 9, 13, 51, 67, conA, Y.skyway + 3.5);
  open(2, 89, 13, 131, 67, conB, Y.skyway + 3.5);
  open(2, 52, 36, 88, 44, deck, Y.skyway + 3);
  open(2, 51, 37, 52, 43, deck, Y.skyway + 2.5); // the doorways through both facades (a lower head)
  open(2, 88, 37, 89, 43, deck, Y.skyway + 2.5);
  const win = (o: Partial<SkywaysWindow> & Pick<SkywaysWindow, 'x0' | 'z0' | 'x1' | 'z1' | 'side' | 'level'>): SkywaysWindow =>
    ({sill: 0.9, head: 2.6, kind: 'window', baseY: levels[o.level].baseY, host: {building: 'B0'}, ...o});
  const windows: SkywaysWindow[] = [];
  // K0: both bridge side walls, pre-breached (4 m spans, 0.5 m piers)
  for (const [a0, a1] of [[26.5, 30.5], [31, 35], [35.5, 39.5], [40, 43.5]]) {
    windows.push(win({x0: a0, x1: a1, z0: 17.5, z1: 18, side: 'N', level: 2, sill: 0.3, head: 2.6, host: {bridge: 'K0'}, breached: true}));
    windows.push(win({x0: a0, x1: a1, z0: 22, z1: 22.5, side: 'S', level: 2, sill: 0.3, head: 2.6, host: {bridge: 'K0'}, breached: true}));
  }
  // B0's north facade (+15 and street), its east facade on the +15 (the bridge doorway in the same wall run), B1's south facade
  for (const [a0, a1] of [[6, 10], [10.5, 14.5], [15, 19]]) windows.push(win({x0: a0, x1: a1, z0: 6, z1: 6.5, side: 'N', level: 2}));
  for (const [a0, a1] of [[6, 10], [10.5, 14.5]]) windows.push(win({x0: a0, x1: a1, z0: 6, z1: 6.5, side: 'N', level: 1, head: 2.8}));
  for (const [a0, a1] of [[8, 12], [12.5, 16.5], [23, 27]]) windows.push(win({x0: 25.5, x1: 26, z0: a0, z1: a1, side: 'E', level: 2}));
  for (const [a0, a1] of [[46, 50], [50.5, 54.5]]) windows.push(win({x0: a0, x1: a1, z0: 33.5, z1: 34, side: 'S', level: 2, host: {building: 'B1'}}));
  const skyways: SkywaysInfo = {
    version: 1, name: 'Fixture +15', groundY: Y.street,
    storeys: [{level: 0, role: 'station', label: 'Concourse', baseY: Y.station, clear: 4}, {level: 1, role: 'street', label: 'Street level', baseY: Y.street, clear: 4.5},
      {level: 2, role: 'skyway', label: '+15 Skyway', baseY: Y.skyway, clear: 3.5}],
    buildings: [{id: 'B0', name: 'Calder Place', role: 'station', rect: {x0: 4, z0: 6, x1: 26, z1: 34}, top: 60, levels: [0, 1, 2]},
      {id: 'B1', name: 'Bow Tower', role: 'tower', rect: {x0: 44, z0: 6, x1: 66, z1: 34}, top: 90, levels: [1, 2]}],
    bridges: [{id: 'K0', level: 2, area: deck, a: 'B0', b: 'B1', rect: BRIDGE, axis: 'x', width: 4, length: 18, breached: true}],
    streets: [{rect: {x0: 26, z0: 0, x1: 44, z1: 45}, axis: 'z'}],
    windows,
    addon: {id: 'convention', building: 'B1', level: 2, hall: {x0: 50, z0: 10, x1: 62, z1: 30}, areas: [conB], entry: {x: 47, z: 20, level: 2}, convention: {stage: {x0: 55, z0: 12, x1: 60, z1: 16}, statues: []}},
    restaurant: null, start: {x: 20, z: 12, yaw: 0, level: 0}, exterior: {x0: 4, z0: 6, x1: 66, z1: 34},
  };
  return {
    seed: 20261106, attempt: 0, name: 'Skyways fixture', archetype: 'side-mezzanine', towards: ['A', 'B'], grid: levels[0].grid, areas, doors: [], props: [], lights: [],
    signs: [], pickups: [], zombies: [], storefronts: [], decor: [], playerSpawn: {x: 20, z: 12, yaw: 0}, trench: {floorY: Y.station - 1.2}, trenches: [], platform: st,
    platforms: [st], levels, levelLinks: [], rails: [], skyways,
  } as unknown as StationLayout;
}

let cached: StationLayout | null = null;
const layout = () => (cached ??= fixture());

// ---------------------------------------------------------------------------------------------
// A fake Game: the glazing runtime (before GAS) + the gas system (its window source), a lane store, a real atmosphere's gas layers.

function game(L: StationLayout, o: {active?: boolean; store?: Map<string, unknown>} = {}) {
  const store = o.store ?? new Map<string, unknown>();
  const atmo = new VolumetricAtmosphere(null, {flashlight: new THREE.SpotLight()}, 'high');
  atmo.setStation(L, null);
  const fallbacks: number[] = [];
  const culler = {register: vi.fn()};
  let clock = 0;
  const h = {
    scene: new THREE.Scene(), mats, layout: L, world: {culler},
    player: {x: MID.x, z: MID.z, y: Y.skyway, eye: Y.skyway + 1.6, radius: 0.3, alive: true, takeDamage: vi.fn()},
    zombies: [] as {brain: {x: number; z: number; y: number; alive: boolean; stats: {radius: number}}; ragdolled?: boolean}[],
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
  const rt: SkywaysWindowRuntime = installSkywaysWindows(h as never);
  const sys: GasSystem = installGas(h as unknown as GasHost);
  sys.windowSources.push(() => rt.gasSource());
  const build = () => { for (const s of h.sectionHooks) s.build?.(L); };
  const teardown = () => { for (const s of h.sectionHooks) s.teardown?.(); };
  const step = (seconds: number, dt = 0.1) => { for (let t = 0; t < seconds - 1e-9; t += dt) { clock += dt; for (const f of h.frameHooks) f(dt); } };
  const eyeAt = (x: number, z: number, level = 2) => { Object.assign(h.player, {x, z, y: L.levels[level].baseY, eye: L.levels[level].baseY + 1.6}); for (const f of h.frameHooks) f(0); return sys.exposure; };
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

/** The layer value (0..1) of one cell on storey slot `s`. */
const cellLayer = (atmo: VolumetricAtmosphere, s: number, cx: number, cy: number) => {
  const m = atmo.densityMap!;
  return (atmo as unknown as {gasData: Uint8Array}).gasData[s * m.w * m.h + cy * m.w + cx] / 255;
};

const unit = (v: Vec3): Vec3 => { const l = Math.hypot(v.x, v.y, v.z); return {x: v.x / l, y: v.y / l, z: v.z / l}; };

// ---------------------------------------------------------------------------------------------

describe('skyways glazing: the plan, the builder cut, the runtime', () => {
  it('plans every span with NO inert broken glass; the breached spans are all breakable and pre-breached; ids are stable', () => {
    const L = layout(), info = L.skyways!;
    const plans = planSkywaysWindows(info, L.seed);
    expect(plans.length).toBe(info.windows.length);
    expect(plans.map(p => p.index)).toEqual(info.windows.map((_, i) => i));
    let breakable = 0, boarded = 0;
    for (const p of plans) {
      const breached = info.windows[p.index].breached === true;
      expect(p.level).toBe(info.windows[p.index].level);
      for (const pane of p.panes) {
        expect(pane.state).not.toBe('broken'); // never an inert hole: broken = breached (a gas source) only
        if (breached) expect(paneBreakable(p, pane)).toBe(true);
        if (paneBreakable(p, pane)) breakable++; else { expect(pane.state).toBe('boarded'); boarded++; }
      }
    }
    expect(breakable).toBeGreaterThan(30);
    expect(skywaysPaneState('broken', false)).toBe('cracked');
    expect(skywaysPaneState('boarded', false)).toBe('boarded');
    expect(skywaysPaneState('boarded', true)).toBe('intact');
    const pre = prebreachedPanes(plans, info);
    const bridgePanes = plans.filter(p => info.windows[p.index].breached).flatMap(p => p.panes.map(q => paneId(p, q)));
    expect(pre).toEqual(bridgePanes);
    expect(pre.length).toBeGreaterThanOrEqual(16); // 8 spans x 2+ panes (transom: 2.3 m tall glazing)
    expect(pre.every(id => id.startsWith('2:'))).toBe(true);
    // deterministic per level seed
    expect(planSkywaysWindows(info, L.seed).map(p => p.panes.map(q => `${paneId(p, q)}=${q.state}`))).toEqual(plans.map(p => p.panes.map(q => `${paneId(p, q)}=${q.state}`)));
    expect(prebreachRecord(pre).broken[pre[0]]).toBe(WINDOW_BREACH.AGE_CAP_S);
  });

  it('cuts the spans out of the REAL extracted room-side wall faces (the facade doorway in the same run kept), nothing else', () => {
    const L = layout(), levels = stationLevels(L), info = L.skyways!;
    const raw = extractWallFaces(L, levels, new LevelColumns(levels), {tileLowerHeight: mats.tileLowerHeight});
    const cut = cutSkywaysWindows(raw, L);
    expect(cutSkywaysWindows(raw, {})).toBe(raw); // no layout.skyways: untouched
    /** Face area covering point (s along, y) on the room-side plane of a span (per face plane / direction / storey). */
    const covers = (faces: typeof raw, w: SkywaysWindow, a: number, y: number) => faces.some(f => {
      const alongX = w.side === 'N' || w.side === 'S', fAlongX = Math.abs(f.z0 - f.z1) < 1e-9;
      const plane = w.side === 'N' ? w.z1 : w.side === 'S' ? w.z0 : w.side === 'W' ? w.x1 : w.x0;
      if (f.level !== w.level || fAlongX !== alongX || Math.abs((fAlongX ? f.z0 : f.x0) - plane) > 1e-6) return false;
      const s0 = Math.min(fAlongX ? f.x0 : f.z0, fAlongX ? f.x1 : f.z1), s1 = Math.max(fAlongX ? f.x0 : f.z0, fAlongX ? f.x1 : f.z1);
      if (a < s0 || a > s1 || y < f.y0 || y > f.y1) return false;
      return !f.openings.some(o => a > s0 + o.s0 && a < s0 + o.s1 && y < o.top); // inside a doorway: not covered
    });
    for (const w of info.windows) {
      const alongX = w.side === 'N' || w.side === 'S', a = alongX ? (w.x0 + w.x1) / 2 : (w.z0 + w.z1) / 2, edge = (alongX ? w.x0 : w.z0) - 0.25;
      expect(covers(raw, w, a, w.baseY + (w.sill + w.head) / 2), `raw ${w.side} ${a}`).toBe(true); // the solid wall run was there
      expect(covers(cut, w, a, w.baseY + (w.sill + w.head) / 2), `cut ${w.side} ${a}`).toBe(false); // the glazing hole
      expect(covers(cut, w, a, w.baseY + w.sill - 0.1)).toBe(true); // below the sill
      expect(covers(cut, w, a, w.baseY + w.head + 0.1)).toBe(true); // above the head
      expect(covers(cut, w, edge, w.baseY + (w.sill + w.head) / 2)).toBe(true); // the pier beside it
    }
    // the bridge doorway in B0's east facade run is still a doorway (its opening moved into the piece that holds it)
    const door = {x0: 25.5, x1: 26, z0: 18.5, z1: 21.5, side: 'E', level: 2, baseY: Y.skyway, sill: 0, head: 2} as SkywaysWindow;
    expect(covers(raw, door, 20, Y.skyway + 1)).toBe(false);
    expect(covers(cut, door, 20, Y.skyway + 1)).toBe(false);
    expect(covers(cut, door, 20, Y.skyway + 2.9)).toBe(true); // the lintel above it
    const lintel = cut.filter(f => f.level === 2 && Math.abs(f.x0 - 25.5) < 1e-6 && Math.abs(f.x1 - 25.5) < 1e-6 && f.openings.length);
    expect(lintel.length).toBeGreaterThan(0);
    // total wall area removed = the glazing area (no other face changed)
    const area = (fs: typeof raw) => fs.reduce((s, f) => s + Math.hypot(f.x1 - f.x0, f.z1 - f.z0) * (f.y1 - f.y0), 0);
    const glass = info.windows.reduce((s, w) => s + (w.side === 'N' || w.side === 'S' ? w.x1 - w.x0 : w.z1 - w.z0) * (w.head - w.sill), 0);
    expect(area(raw) - area(cut)).toBeCloseTo(glass, 4);
    // a doorway across a span is never cut (the face stays whole)
    const f = {level: 2, x0: 0, z0: 5, x1: 10, z1: 5, y0: 0, y1: 3, nx: 0, nz: 1, openings: [{s0: 4, s1: 6, top: 2.2}]};
    expect(cutWindowSpans([f], [{x0: 3, x1: 7, z0: 4.5, z1: 5, side: 'N', level: 2, baseY: 0, sill: 0.9, head: 2.4}])).toEqual([f]);
    const kept = cutWindowSpans([f], [{x0: 7, x1: 9, z0: 4.5, z1: 5, side: 'N', level: 2, baseY: 0, sill: 0.9, head: 2.4}]);
    expect(kept.find(k => k.x0 === 0 && k.x1 === 7)?.openings).toEqual([{s0: 4, s1: 6, top: 2.2}]);
    expect(cutWindowSpans([{...f, nz: -1}], [{x0: 7, x1: 9, z0: 4.5, z1: 5, side: 'N', level: 2, baseY: 0, sill: 0.9, head: 2.4}])).toHaveLength(1); // the other side
  });

  it('runtime: merged per-storey glass / frames / reveals registered with the culler + warm-up; colliders push bodies back; teardown disposes; inert elsewhere', () => {
    const L = layout();
    const {h, rt, culler, teardown, build} = game(L);
    const g = rt.glazing!;
    expect(g).not.toBe(null);
    expect(h.scene.children).toContain(g.root);
    expect(culler.register).toHaveBeenCalledWith(g.root);
    expect(h.warmRegistry.addPool).toHaveBeenCalledWith('skyways-windows', expect.any(Function));
    const pool = (h.warmRegistry.addPool.mock.calls[0][1] as () => THREE.Object3D[])();
    expect(pool).toEqual([g.root]);
    const meshes: THREE.Mesh[] = [];
    g.root.traverse(o => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
    expect(new Set(meshes.map(m => m.userData.level))).toEqual(new Set([1, 2]));
    expect(meshes.some(m => m.name === 'tower-window-glass')).toBe(true);
    expect(meshes.filter(m => m.name === 'skyways-window-reveals').map(m => m.userData.level).sort()).toEqual([1, 2]);
    expect(meshes.every(m => m.matrixAutoUpdate === false)).toBe(true);
    // every breakable pane has its pre-built looks; the breached ones show the broken look after the gas build
    for (const id of g.prebreached) expect(g.view.panes.get(id)?.look).toBe('broken');
    // a body pressed into a bridge window is pushed back onto the deck (nothing leaves through the glass, broken or not)
    Object.assign(h.player, {x: 33, z: 17.9, y: Y.skyway});
    for (const f of h.frameHooks) f(1 / 60);
    expect(h.player.z).toBeGreaterThanOrEqual(18 + h.player.radius - 1e-6);
    const z = {brain: {x: 37, z: 22.1, y: Y.skyway, alive: true, stats: {radius: 0.35}}};
    h.zombies.push(z);
    for (const f of h.frameHooks) f(1 / 60);
    expect(z.brain.z).toBeLessThanOrEqual(22 - 0.35 + 1e-6);
    // teardown: removed + disposed; the source is gone
    const geos = [...g.view.geometries, ...g.reveals.map(m => m.geometry)], spies = geos.map(x => vi.spyOn(x, 'dispose'));
    teardown();
    expect(rt.glazing).toBe(null);
    expect(h.scene.children).not.toContain(g.root);
    expect(spies.every(s => s.mock.calls.length === 1)).toBe(true);
    expect(rt.gasSource()).toBe(null);
    // a world without layout.skyways: nothing built, no gas field
    const plain = {...L, skyways: undefined} as StationLayout;
    for (const s of h.sectionHooks) s.build?.(plain);
    expect(rt.glazing).toBe(null);
    expect(rt.gasSource()).toBe(null);
    build();
    expect(rt.glazing).not.toBe(null);
    // the level's architecture may take the reveals over per storey (null: it builds them itself — never coplanar duplicates)
    rt.revealMaterial = lv => (lv === 1 ? null : mats.get('concrete'));
    build();
    expect(rt.glazing!.reveals.map(m => [m.userData.level, (m.material as THREE.Material) === mats.get('concrete')])).toEqual([[2, true]]);
  });
});

describe('skyways gas: hazard <-> visual parity (CLAUDE.md: toxic gas is always VISIBLE green volumetric fog)', () => {
  it('a pre-breached bridge is gassed AT LOAD: exposure > threshold mid-bridge == concentrationAt == the uploaded skyway layer (the march band)', () => {
    const L = layout();
    const {sys, atmo, eyeAt} = game(L);
    expect(sys.lane).toBe(SKYWAYS_WINDOWS_LANE);
    expect(sys.field).not.toBe(null);
    // gas already spread across the deck at arrival (aged breaches, fast-forwarded): no tick has run yet
    expect(sys.field!.ticks).toBeGreaterThan(100);
    const st = sys.field!.storey(2)!;
    expect(st.breaches.length).toBe(sys.windows!.breaches(0).length);
    expect(atmo.gasDebug().on).toBe(true);
    let n = 0;
    for (const x of [27, 30, 35, 39.5, 43]) for (const z of [18.6, 20, 21.4]) {
      const e = eyeAt(x, z), y = Y.skyway + 1.6;
      const d = drawnAt(atmo, x, y, z);
      expect(e.c, `exposure at ${x},${z}`).toBeGreaterThan(GAS.THRESHOLD);
      expect(e.source).toBe('field');
      expect(e.dps).toBeGreaterThan(0); // no mask: it hurts
      expect(e.c).toBeCloseTo(sys.field!.concentrationAt(x, y, z), 9); // ONE function
      expect(d.slot).toBe(2); // the march picks the skyway storey's band there
      expect(d.layer).toBeGreaterThan(0.1);
      expect(Math.abs(e.c - d.c), `drawn vs hazard at ${x},${z}`).toBeLessThan(0.02); // R8 + the band's quantised floor / ceiling
      n++;
    }
    expect(n).toBe(15);
    // mid-bridge it is dense: the breach look over the deck width / along it is visibly GREEN fog
    const c = eyeAt(MID.x, MID.z).c;
    expect(c).toBeGreaterThan(0.5);
    const look = {ext: GAS.EXT, emission: GAS.EMISSION, tint: GAS.TINT};
    expect(gasOpacity(look, c, BRIDGE.z1 - BRIDGE.z0)).toBeGreaterThan(0.5);
    expect(gasOpacity(look, c, 10)).toBeGreaterThan(0.9);
    expect(greenness(GAS.TINT)).toBeGreaterThan(1.2);
    // the street storey and the far building are clean: nothing drawn, nothing breathed
    for (const [x, z, lv] of [[15, 20, 1], [60, 30, 2], [60, 12, 2]] as const) {
      expect(eyeAt(x, z, lv).c).toBe(0);
      expect(drawnAt(atmo, x, L.levels[lv].baseY + 1.6, z).layer).toBe(0);
    }
    const m = atmo.densityMap!;
    let streetBytes = 0;
    for (let i = 0; i < m.w * m.h; i++) if (cellLayer(atmo, 1, i % m.w, Math.floor(i / m.w)) > 0) streetBytes++;
    expect(streetBytes).toBe(0);
  });

  it('the tongue into the concourse thins ON SCREEN exactly as the hazard drops (one field); every gassed cell is drawn on its storey', () => {
    const L = layout();
    const {sys, atmo, eyeAt} = game(L);
    let prev = Infinity, checked = 0;
    for (let x = 36; x > 18; x -= 0.75) {
      const e = eyeAt(x, 20), d = drawnAt(atmo, x, Y.skyway + 1.6, 20);
      expect(Math.abs(e.c - d.c), `x ${x}`).toBeLessThan(0.02);
      if (x < 25) { expect(e.c).toBeLessThanOrEqual(prev + 0.02); prev = e.c; } // past the doorway: falling
      checked++;
    }
    expect(eyeAt(18.5, 20).c).toBeLessThan(eyeAt(MID.x, MID.z).c * 0.3);
    expect(checked).toBeGreaterThan(20);
    // every field cell is in the uploaded layer (R8), and nothing else is
    const st = sys.field!.storey(2)!, r = sys.field!.rect, m = atmo.densityMap!;
    let cells = 0;
    for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) {
      const v = st.c[y * r.w + x], gx = r.x0 + x, gy = r.y0 + y;
      if (gx < 0 || gy < 0 || gx >= m.w || gy >= m.h) continue;
      expect(Math.abs(cellLayer(atmo, 2, gx, gy) - v)).toBeLessThanOrEqual(0.5 / 255 + 1e-6);
      if (v > 0) cells++;
    }
    expect(cells).toBeGreaterThan(250);
  });

  it('a pane SHOT through the real hitscan (PANE_MAX_HP of pistol rays) breaches: exposure near it == concentrationAt == the drawn layer > 0', () => {
    const L = layout();
    const {h, sys, atmo, step, eyeAt} = game(L);
    const levels = levelsOf(L);
    // B0's +15 north facade, the middle span: shoot its lower pane from 1.6 m inside
    const ref = [...sys.windows!.refs.values()].find(r => r.plan.level === 2 && r.plan.span.side === 'N' && r.plan.a0 === 10.5 && r.pane.row === 0)!;
    expect(ref).toBeTruthy();
    expect(sys.windows!.broken(ref.id)).toBe(false);
    const c = paneCentre(ref), back = 1.6 + Math.abs(ref.plan.glass - ref.plan.inner);
    const o = {x: c.x + c.nx * back, y: c.y, z: c.z + c.nz * back}, d = unit({x: c.x - o.x, y: 0, z: c.z - o.z});
    const before = eyeAt(c.x, c.z + 1.2).c;
    expect(before).toBe(0);
    let shots = 0;
    while (!sys.windows!.broken(ref.id) && shots < 10) {
      const wh = raycastWorld(levels, L.props, o, d, 60, L.trench.floorY);
      expect(wh.kind).toBe('wall');
      expect(wh.level).toBe(2);
      const point = new THREE.Vector3(o.x + d.x * wh.t, o.y + d.y * wh.t, o.z + d.z * wh.t);
      const dmg = WEAPONS.pistol.damage * WeaponController.falloff(WEAPONS.pistol, wh.t);
      expect(h.bulletHitHandlers.some(fn => fn(wh, point, new THREE.Vector3(d.x, d.y, d.z), ++shots, dmg))).toBe(true); // the glass took it (no crater)
    }
    expect(shots).toBe(Math.ceil(PANE_MAX_HP / WEAPONS.pistol.damage));
    expect(sys.windows!.broken(ref.id)).toBe(true);
    expect(sys.counts.broken).toBe(1);
    expect(h.sfx.breakage).toHaveBeenCalledWith('breakGlass', expect.any(Number), expect.any(Number), expect.any(Number), 1);
    step(12);
    let n = 0;
    for (const [dx, dz] of [[0, 1.0], [0.6, 1.4], [-0.7, 2.1], [0.2, 3.0]] as const) {
      const x = c.x + dx, z = c.z + dz, y = Y.skyway + 1.6, e = eyeAt(x, z), dr = drawnAt(atmo, x, y, z);
      expect(e.c, `exposure ${dx},${dz}`).toBeGreaterThan(0.05);
      expect(e.c).toBeCloseTo(sys.field!.concentrationAt(x, y, z), 9);
      expect(dr.slot).toBe(2);
      expect(dr.layer).toBeGreaterThan(0);
      expect(Math.abs(e.c - dr.c)).toBeLessThan(0.02);
      n++;
    }
    expect(n).toBe(4);
    // another bullet through the hole passes out (no crater, no damage)
    const wh = raycastWorld(levels, L.props, o, d, 60, L.trench.floorY), point = new THREE.Vector3(o.x + d.x * wh.t, o.y, o.z + d.z * wh.t);
    expect(h.bulletHitHandlers.some(fn => fn(wh, point, new THREE.Vector3(d.x, d.y, d.z), 99, 17))).toBe(true);
    expect(sys.counts.passThrough).toBeGreaterThan(0);
  });

  it('the mask protects the lungs only: dps 0, but the exposure c, the drawn layer and the in-engine fallback (pass off) are unchanged', () => {
    const L = layout();
    for (const active of [true, false]) {
      const {sys, atmo, eyeAt, fallbacks} = game(L, {active});
      const bare = eyeAt(MID.x, MID.z);
      const snap = {c: bare.c, dps: bare.dps, fb: fallbacks.at(-1)!, layer: drawnAt(atmo, MID.x, Y.skyway + 1.6, MID.z).layer};
      expect(snap.dps).toBeGreaterThan(0);
      sys.protection = () => true;
      const masked = eyeAt(MID.x, MID.z);
      expect(masked.protected).toBe(true);
      expect(masked.dps).toBe(0);
      expect(masked.c).toBeCloseTo(snap.c, 12);
      expect(drawnAt(atmo, MID.x, Y.skyway + 1.6, MID.z).layer).toBe(snap.layer);
      expect(fallbacks.at(-1)).toBe(snap.fb);
      // the WebGL2 / pass-off fallback draws the same eye concentration in-engine (never a CSS overlay); the pass draws the layers
      expect(snap.fb).toBe(active ? 0 : snap.c);
      expect(sys.hud.shown.haze).toBe(0);
    }
  });
});

describe('skyways gas: persistence, contact breaks, the Office path, the wiring', () => {
  it("revisit: teardown saves 'skyways.windows'; a rebuild restores looks + gas and never seeds twice; a fresh run seeds again", () => {
    const L = layout();
    const {sys, rt, store, step, teardown, build, eyeAt} = game(L);
    const pre = rt.glazing!.prebreached;
    const shot = [...sys.windows!.refs.values()].find(r => r.plan.level === 1)!;
    expect(sys.breakPane(shot.id)).toBe(true); // a street-level pane the player broke this visit
    step(20);
    const live = sys.field!.storey(2)!.stats(), liveMid = eyeAt(MID.x, MID.z).c;
    teardown();
    expect(store.has(WINDOWS_LANE)).toBe(false); // never the Office's record
    const rec = store.get(SKYWAYS_WINDOWS_LANE) as {v: number; broken: Record<string, number>};
    expect(rec.v).toBe(2);
    expect(Object.keys(rec.broken).sort()).toEqual([...pre, shot.id].sort());
    expect(Math.max(...Object.values(rec.broken))).toBeLessThanOrEqual(WINDOW_BREACH.AGE_CAP_S);
    const saved = structuredClone(rec);
    // travel away and back: the record restores (no pre-breach seeding on top), looks + gas come back
    build();
    expect(store.get(SKYWAYS_WINDOWS_LANE)).toEqual(saved); // a build never rewrites the record
    const W = sys.windows!;
    expect(W.breaches(0).map(b => b.ref.id).sort()).toEqual(Object.keys(saved.broken).sort());
    const st2 = sys.field!.storey(2)!;
    expect(new Set(st2.breaches).size).toBe(st2.breaches.length); // each breach seeded ONCE
    expect(st2.breaches.sort()).toEqual(pre.filter(id => id.startsWith('2:')).sort());
    expect(sys.field!.storey(1)!.breaches).toEqual([shot.id]);
    for (const id of pre) expect(rt.glazing!.view.panes.get(id)?.look).toBe('broken');
    expect(rt.glazing!.view.panes.get(shot.id)?.look).toBe('broken');
    const back = st2.stats();
    expect(Math.abs(back.poolMean - live.poolMean)).toBeLessThan(0.05);
    expect(Math.abs(eyeAt(MID.x, MID.z).c - liveMid)).toBeLessThan(0.05);
    // NewGame (an empty lane store): the first build again — the breached spans seeded, the shot pane intact
    teardown();
    store.clear();
    build();
    expect(sys.windows!.breaches(0).map(b => b.ref.id).sort()).toEqual([...pre].sort());
    expect(sys.windows!.broken(shot.id)).toBe(false);
    expect(eyeAt(MID.x, MID.z).c).toBeGreaterThan(GAS.THRESHOLD);
  });

  it('breakPaneNear (lane CAR): breaks only the unbroken panes within reach on that storey, once, with the break cue and its gas', () => {
    const L = layout();
    const {h, sys, step, eyeAt} = game(L);
    // B1's +15 south facade, first span: a car nose against the room-side face at its middle (glass ~0.28 m behind it)
    const plan = sys.windows!.plans.find(p => p.level === 2 && p.span.side === 'S' && p.a0 === 46)!;
    const x = 47, z = plan.inner - 0.02, y = Y.skyway + 1.2;
    expect(sys.breakPaneNear(1, x, y, z, 0.6)).toEqual([]); // another storey
    expect(sys.breakPaneNear(2, x, y, z, 0.1)).toEqual([]); // out of reach (the glass is behind the reveal)
    const ids = sys.breakPaneNear(2, x, y, z, 0.6);
    expect(ids.length).toBeGreaterThanOrEqual(1);
    for (const id of ids) {
      const ref = sys.windows!.refs.get(id)!;
      expect(ref.plan).toBe(plan);
      expect(paneDistance(ref, x, y, z)).toBeLessThanOrEqual(0.6);
      expect(sys.windows!.broken(id)).toBe(true);
    }
    expect(h.sfx.breakage).toHaveBeenCalledTimes(ids.length);
    expect(sys.breakPaneNear(2, x, y, z, 0.6)).toEqual([]); // already broken: once
    step(10);
    expect(eyeAt(47, plan.inner - 1.2).c).toBeGreaterThan(0.05);
    expect(paneDistance([...sys.windows!.refs.values()][0] as PaneRef, 1e3, 0, 1e3)).toBeGreaterThan(100);
  });

  it('the Office path is unchanged: the tower windows win (WINDOWS_LANE, their footprint), a world with neither has no field', () => {
    const L = layout();
    const store = new Map<string, unknown>();
    const plans = planSkywaysWindows(L.skyways!, L.seed);
    const tower = {office: {info: {exterior: {x0: 4, z0: 6, x1: 26, z1: 34}}, windows: {plans, view: null}}};
    const h = {
      player: {x: 0, z: 0, y: 0, eye: 1.6, alive: true, takeDamage() {}}, layout: L, tower,
      atmosphere: {active: true, setGasLayer: vi.fn()}, run: {laneStore: (k: string) => store.get(k), setLaneStore: (k: string, v: unknown) => store.set(k, v)},
      clock: 0, state: 'playing', frameHooks: [] as ((dt: number) => void)[], sectionHooks: [] as {build?(l: StationLayout): void; teardown?(): void}[],
    };
    const sys = installGas(h as unknown as GasHost);
    const other = vi.fn(() => ({plans, view: null, exterior: L.skyways!.exterior, lane: SKYWAYS_WINDOWS_LANE, prebreached: prebreachedPanes(plans, L.skyways!)}));
    sys.windowSources.push(other);
    h.sectionHooks[0].build!(L);
    expect(other).not.toHaveBeenCalled(); // the tower's own windows: the source list is never asked
    expect(sys.lane).toBe(WINDOWS_LANE);
    expect(sys.windows!.state.size).toBe(0); // the Office never pre-breaches
    expect(sys.field!.rect).toEqual({x0: 6, y0: 10, w: 48, h: 60});
    h.sectionHooks[0].teardown!();
    expect([...store.keys()]).toEqual([WINDOWS_LANE]);
    // neither a tower nor a source world (the Subway): no windows, no field
    (h as {tower: unknown}).tower = {office: null};
    sys.windowSources.length = 0;
    sys.windowSources.push(() => null, () => { throw new Error('a broken provider never breaks the build'); });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    h.sectionHooks[0].build!(L);
    warn.mockRestore();
    expect(sys.windows).toBe(null);
    expect(sys.field).toBe(null);
  });

  it('Game / builder wiring (source): the glazing runtime before GAS, its window source registered, the builder cut beside the Office cut', () => {
    const src = fs.readFileSync(path.join(GAME, 'src/game.ts'), 'utf8');
    const iTower = src.indexOf('this.tower = installTower(this)'), iSky = src.indexOf('this.skywaysWindows = installSkywaysWindows(this)'), iGas = src.indexOf('this.gas = installGas(this)');
    expect(iTower).toBeGreaterThan(0);
    expect(iSky).toBeGreaterThan(iTower);
    expect(iGas).toBeGreaterThan(iSky);
    expect(src.indexOf('this.gas.windowSources.push(() => this.skywaysWindows.gasSource())')).toBeGreaterThan(iGas);
    const b = fs.readFileSync(path.join(GAME, 'src/world/builder.ts'), 'utf8');
    // (task studio-perf-ao-train-continuity-20261110-022206-01, lane BUILD: the faces come from the stepped extractor first, then the same cuts)
    expect(b).toMatch(/const extracted = yield\* extractWallFacesSteps\([^\n]*\n[^\n]*\n\s*const cutFaces: BuiltFace\[\] = cutSkywaysWindows\(cutOfficeWindows\(extracted, layout\), layout\);/);
  });
});

// ---------------------------------------------------------------------------------------------
// The real Skyways level (lead's generator: gen/skyways/index.ts) — runs automatically once LEVELS.skyways is registered.

const realDef = (LEVELS as unknown as Record<string, LevelDef | undefined>).skyways;
describe.runIf(!!realDef)('skyways gas on the REAL generated level', () => {
  it('every span sits in a SOLID wall run with open room-side cells; each pre-breached bridge is gassed mid-deck at load (exposure == drawn)', () => {
    const L = realDef!.generate('main', {levelSeed: 20261106, startWeapon: 'pistol'} as never), info = L.skyways!;
    expect(info.windows.length).toBeGreaterThan(0);
    for (const w of info.windows) {
      const g = L.levels[w.level].grid, alongX = w.side === 'N' || w.side === 'S';
      const inward = w.side === 'N' || w.side === 'W' ? 1 : -1, inner = w.side === 'N' ? w.z1 : w.side === 'S' ? w.z0 : w.side === 'W' ? w.x1 : w.x0;
      for (let a = (alongX ? w.x0 : w.z0) + CELL / 2; a < (alongX ? w.x1 : w.z1); a += CELL) {
        const c = inner - inward * CELL / 2, cin = inner + inward * CELL / 2; // the wall cell behind the room-side face / the room cell
        const [wx, wz] = alongX ? [a, c] : [c, a], [rx, rz] = alongX ? [a, cin] : [cin, a];
        expect(g.cells[g.idx(Math.floor(wx / CELL), Math.floor(wz / CELL))], `wall cell of span at ${wx},${wz}`).toBe(SOLID);
        expect(g.cells[g.idx(Math.floor(rx / CELL), Math.floor(rz / CELL))], `room cell of span at ${rx},${rz}`).not.toBe(SOLID);
      }
    }
    const {sys, atmo, eyeAt} = game(L);
    for (const br of info.bridges.filter(b => b.breached)) {
      const x = (br.rect.x0 + br.rect.x1) / 2, z = (br.rect.z0 + br.rect.z1) / 2, base = L.levels[br.level].baseY;
      const e = eyeAt(x, z, br.level);
      expect(e.c, `bridge ${br.id}`).toBeGreaterThan(GAS.THRESHOLD);
      const d = drawnAt(atmo, x, base + 1.6, z);
      expect(d.slot).toBe(br.level);
      expect(Math.abs(e.c - d.c)).toBeLessThan(0.02);
    }
    expect(sys.lane).toBe(SKYWAYS_WINDOWS_LANE);
  });
});
