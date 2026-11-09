// Task studio-bunker-level-20261109-072224-01: THE BUNKER's local gas leaks (layout.bunker.gasZones -> world/gas/zones.ts -> the gas
// system's zone sources) — the visibility test the root CLAUDE.md rule requires for a new gas source ("Toxic gas is always VISIBLE green
// volumetric fog": what hurts looks gassy, what looks gassy hurts, ONE field for both), on real generated Bunker layouts with the REAL
// VolumetricAtmosphere's gas layers:
//  - every zone is gassed at arrival: the exposure at its seed cells is over the damage threshold, == the field's concentrationAt ==
//    the uploaded storey layer x the shared height profile (the march's band = the zone's storey); other storeys stay clean there;
//  - strengths read on screen and in the exposure alike (weak < medium < strong), the strong leak near the cap;
//  - the mask: dps 0, the layers / exposure / fallback unchanged (a mask never hides the gas);
//  - the clean routes: with every cell the field holds above the strong band shut, every generator's front and the core cluster's front
//    are still reached from the platform start;
//  - the Office's breach path is unchanged (a breach without a strength is the original arithmetic).
// (Task studio-bunker-rework-20261109-205115-01: these pin VERSION 1 explicitly — an entered station keeps it; version 2 has its own tests.)
import {beforeAll, describe, expect, it, vi} from 'vitest';
import * as THREE from 'three';
import {installCanvasShim} from './helpers/canvas2d';
import {CELL, FLOOR} from '../src/gen/grid';
import {levelDistance} from '../src/gen/levelGen';
import type {StationLayout} from '../src/gen/stationTypes';
import {generateBunkerLevel} from '../src/gen/bunker/index';
import {GAS_STRONG} from '../src/gen/bunker/hazards';
import {frontCells} from '../src/gen/bunker/validate';
import {GAS, GasField, gasProfile} from '../src/world/gas/field';
import {installGas, type GasHost, type GasSystem} from '../src/world/gas/system';
import {bunkerGasSource} from '../src/world/gas/zones';
import {VolumetricAtmosphere} from '../src/render/volumetric';

installCanvasShim(false);

const SEEDS = [9001, 24839, 56515];
const layouts = new Map<number, StationLayout>();
const bunker = (s: number) => { let l = layouts.get(s); if (!l) layouts.set(s, (l = generateBunkerLevel({levelSeed: s, layoutVersion: 1}))); return l; };

function game(L: StationLayout, protect = false) {
  const atmo = new VolumetricAtmosphere(null, {flashlight: new THREE.SpotLight()}, 'high');
  atmo.setStation(L, null);
  const fallbacks: number[] = [];
  const h = {
    layout: L, tower: {office: null},
    player: {x: 0, z: 0, y: 0, eye: 1.6, alive: true, takeDamage: vi.fn()},
    atmosphere: {
      active: true,
      setGasLayer: (s: number, f: ArrayLike<number>, r: {x0: number; y0: number; w: number; h: number}) => atmo.setGasLayer(s, f, r),
      setGasFallback: (c: number) => { fallbacks.push(c); atmo.setGasFallback(c); },
    },
    run: {laneStore: () => undefined, setLaneStore: vi.fn()},
    clock: 0, state: 'playing', frameHooks: [] as ((dt: number) => void)[], sectionHooks: [] as {build?(l: StationLayout): void; teardown?(): void}[],
    stateListeners: [], bulletHitHandlers: [],
  };
  const sys: GasSystem = installGas(h as unknown as GasHost);
  sys.zoneSources.push(bunkerGasSource);
  if (protect) sys.protection = () => true;
  for (const s of h.sectionHooks) s.build?.(L);
  const eyeAt = (x: number, z: number, level: number) => {
    const base = L.levels[level].baseY;
    Object.assign(h.player, {x, z, y: base, eye: base + 1.6});
    for (const f of h.frameHooks) f(0);
    return {...sys.exposure};
  };
  return {h, sys, atmo, eyeAt, fallbacks};
}

/** The march's view of the gas at (x, y, z): the R8 layer of the band's slot, bilinear x the profile. */
function drawnAt(atmo: VolumetricAtmosphere, x: number, y: number, z: number): {c: number; layer: number; slot: number} {
  const m = atmo.densityMap!, data = (atmo as unknown as {gasData: Uint8Array}).gasData, band = atmo.bandAt(x, y, z)!;
  const base = band.slot * m.w * m.h;
  const at = (a: number, b: number) => (a < 0 || b < 0 || a >= m.w || b >= m.h ? 0 : data[base + b * m.w + a] / 255);
  const u = x / CELL - 0.5, v = z / CELL - 0.5, iu = Math.floor(u), iv = Math.floor(v), fu = u - iu, fv = v - iv;
  const layer = (at(iu, iv) * (1 - fu) + at(iu + 1, iv) * fu) * (1 - fv) + (at(iu, iv + 1) * (1 - fu) + at(iu + 1, iv + 1) * fu) * fv;
  return {c: layer * gasProfile(y, band.floor, band.ceil), layer, slot: band.slot};
}

/** World centre of a zone's seed block. */
function zoneCentre(L: StationLayout, cells: readonly number[]): {x: number; z: number} {
  const g = L.grid;
  let sx = 0, sz = 0;
  for (const i of cells) { const x = i % g.w, y = (i - x) / g.w; sx += (x + 0.5) * CELL; sz += (y + 0.5) * CELL; }
  return {x: sx / cells.length, z: sz / cells.length};
}

describe('bunker gas zones: visible where they hurt, one field', () => {
  beforeAll(() => { for (const s of SEEDS) bunker(s); });

  it('every zone is gassed at arrival: exposure == field == the drawn layer (its storey only)', () => {
    for (const s of SEEDS) {
      const L = bunker(s), G = game(L);
      expect(G.sys.field).not.toBeNull();
      for (const z of L.bunker!.gasZones) {
        const p = zoneCentre(L, z.cells), base = L.levels[z.level].baseY, eye = base + 1.6;
        const e = G.eyeAt(p.x, p.z, z.level);
        expect(e.c, `${s} ${z.id} exposure`).toBeGreaterThan(GAS.THRESHOLD);
        expect(e.source).toBe('field');
        expect(e.dps).toBeGreaterThan(0);
        expect(e.c).toBeCloseTo(G.sys.field!.concentrationAt(p.x, eye, p.z), 6);
        const d = drawnAt(G.atmo, p.x, eye, p.z);
        expect(d.slot, `${z.id} band slot`).toBe(z.level);
        expect(d.layer).toBeGreaterThan(0);
        expect(Math.abs(d.c - e.c), `${s} ${z.id} drawn ${d.c} vs exposure ${e.c}`).toBeLessThan(0.02);
        // storey isolation: the storeys above / below at the same column hold no gas from this leak
        for (const o of [z.level - 1, z.level + 1]) {
          if (o < 0 || o >= L.levels.length || L.bunker!.gasZones.some(q => q.level === o)) continue;
          expect(G.sys.field!.storey(o)).toBeNull();
        }
      }
    }
  });

  it('strengths read alike on screen and in the exposure: weak < medium < strong', () => {
    for (const s of SEEDS) {
      const L = bunker(s), G = game(L);
      const at = L.bunker!.gasZones.map(z => {
        const p = zoneCentre(L, z.cells);
        return {z, c: G.eyeAt(p.x, p.z, z.level).c, layer: drawnAt(G.atmo, p.x, L.levels[z.level].baseY + 1.6, p.z).layer};
      }).sort((a, b) => a.z.strength - b.z.strength);
      for (let i = 1; i < at.length; i++) if (at[i].z.strength > at[i - 1].z.strength + 0.15) {
        expect(at[i].c, `${s}: ${at[i].z.id} vs ${at[i - 1].z.id}`).toBeGreaterThan(at[i - 1].c);
        expect(at[i].layer).toBeGreaterThan(at[i - 1].layer);
      }
      const strong = at.filter(a => a.z.strength >= GAS_STRONG);
      expect(strong.length).toBeGreaterThan(0);
      for (const a of strong) expect(a.layer).toBeGreaterThan(0.7);
      for (const a of at) expect(a.layer).toBeLessThanOrEqual(a.z.strength + 0.02);
    }
  });

  it('a worn mask stops the damage only: the layers, exposure and fallback are unchanged', () => {
    const L = bunker(SEEDS[0]);
    const A = game(L), B = game(L, true);
    const da = (A.atmo as unknown as {gasData: Uint8Array}).gasData, db = (B.atmo as unknown as {gasData: Uint8Array}).gasData;
    expect(db).toEqual(da);
    for (const z of L.bunker!.gasZones) {
      const p = zoneCentre(L, z.cells);
      const ea = A.eyeAt(p.x, p.z, z.level), eb = B.eyeAt(p.x, p.z, z.level);
      expect(eb.c).toBeCloseTo(ea.c, 9);
      expect(eb.protected).toBe(true);
      expect(eb.dps).toBe(0);
      expect(eb.fallback).toBe(ea.fallback);
    }
  });

  it('a route clear of the strong gas reaches every generator front and the core front', () => {
    for (const s of SEEDS) {
      const L = bunker(s), G = game(L), f = G.sys.field!;
      const shut: [number, number][] = [];
      for (const st of f.storeys) {
        const g = L.levels[st.level].grid;
        for (let i = 0; i < g.cells.length; i++) {
          if (g.cells[i] !== FLOOR || g.blocked[i]) continue;
          const x = i % g.w, y = (i - x) / g.w;
          if (st.sample((x + 0.5) * CELL, (y + 0.5) * CELL) >= GAS_STRONG * 0.5) { g.blocked[i] = 1; shut.push([st.level, i]); }
        }
      }
      try {
        const g0 = L.grid, [sx, sy] = g0.cellOf(L.bunker!.start.x, L.bunker!.start.z);
        const d = levelDistance(L.levels, sx, sy, 0, L.levelLinks);
        const reached = (lv: number, prop: number) => frontCells(L.levels[lv].grid, L.props[prop], 3).some(i => d[lv][i] >= 0);
        for (const gen of L.bunker!.generators) expect(reached(gen.level, gen.prop), `${s} ${gen.id}`).toBe(true);
        expect(reached(L.bunker!.core.level, L.bunker!.core.prop), `${s} core`).toBe(true);
        expect(shut.length).toBeGreaterThan(0);
      } finally { for (const [lv, i] of shut) L.levels[lv].grid.blocked[i] = 0; }
    }
  });

  it("the Office's full-strength breach keeps the original arithmetic", () => {
    const L = bunker(SEEDS[0]), z = L.bunker!.gasZones[0];
    const lv = [{id: z.level, grid: L.levels[z.level].grid}];
    const a = new GasField(lv), b = new GasField(lv);
    a.addBreach({id: 'x', level: z.level, cells: z.cells});
    b.addBreach({id: 'x', level: z.level, cells: z.cells, strength: GAS.CAP});
    a.advance(20); b.advance(20);
    expect(Array.from(b.storey(z.level)!.c)).toEqual(Array.from(a.storey(z.level)!.c));
  });
});
