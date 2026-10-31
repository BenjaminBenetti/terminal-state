// Track 2 — Beyond the Station (lane GEN): CORE PRESERVATION. Track extensions are planned on their own rng fork before the crop,
// the crop and every core pass run exactly as without them, and the finished core is then re-framed into the extended grid (a
// pure translation when an extension reaches west / north; the Office only grows east / south). Proof: the core view of every
// extended layout (gen/trackExt/core.ts coreView — grid window, records translated back, extension areas / doors / cells out)
// equals the layout generated with trackExtensions 'none' (= main's generator, byte for byte apart from the extensions'
// existence), in canonical form (tests/helpers/trackExtCore.ts). Plus the level-registry path (gear + masks placed after
// generation), the decay field's core window, wall-face seeds and shelf-stock seeds in the core frame.
// GEN-2: the Subway's TRACK_EXT enables the CORE RESERVE (coreReserveM 40, the authorized incidence change) — the only
// core-changing knob. Proofs: (i) with the reserve OFF ({...TRACK_EXT, coreReserveM: 0}; the GEN-2 planner and service hatches
// otherwise live) the core view still equals the station without extensions (= main) byte for byte; (ii) with the reserve ON the
// core view does not depend on the extension plan (two different plans on the same reserve give the same core), so the reserve
// is the only change to the core; it actually re-lays stations whose skeleton leaves a bed end open, and leaves the others.
import {describe, expect, it} from 'vitest';
import {generateStation} from '../src/gen/station';
import {generateOfficeLevel} from '../src/gen/office/index';
import {coreView, isExtensionArea} from '../src/gen/trackExt/index';
import {LEVELS} from '../src/levels/registry';
import {isMaskLootItem, placeMaskLoot, placeSectionGear, rollLevelGear} from '../src/levels/gearAdapter';
import {buildDecayField} from '../src/world/decay';
import {extractWallFaces, LevelColumns, stationLevels} from '../src/world/levelGeometry';
import {holderStockSeed} from '../src/world/shelfStockLayout';
import {TRACK_EXT_RESERVE_OFF, canonDiff, canonLayout} from './helpers/trackExtCore';
import {TRACK_EXT, type TrackExtConfig} from '../src/gen/trackExt/index';
import type {StationLayout} from '../src/gen/stationTypes';
import type {LevelId} from '../src/levels/types';

/** Subway seeds of the census corpus whose extensions exist (several translate the core west / north). */
const SUBWAY = [3041725023, 4055629249, 3429001940, 1788470405, 1161843096, 2175747322, 3189651548, 2563024239];
const OFFICE = [3, 7922, 15841];

function sameCore(ext: StationLayout, none: StationLayout, tag: string): void {
  expect(ext.extensions, `${tag}: extensions`).toBeTruthy();
  const d = canonDiff(canonLayout(coreView(ext)), canonLayout(coreView(none)));
  expect(d, `${tag}: core view differs from the layout without extensions`).toEqual([]);
}

/**
 * GEN-2: ANOTHER extension plan on the SAME core reserve — short straight tunnels only, no annex, no hatch (the reserve depends
 * only on coreReserveM, tunnel.length[0], capDepth and margin.core, all as TRACK_EXT).
 */
const OTHER_PLAN: TrackExtConfig = {
  ...TRACK_EXT,
  tunnel: {...TRACK_EXT.tunnel, length: [TRACK_EXT.tunnel.length[0], TRACK_EXT.tunnel.length[0] + 2], arcWeights: [1, 0, 0]},
  annex: {...TRACK_EXT.annex, count: [1, 0, 0]},
  hatch: undefined,
};

describe('track extensions — the core level is unchanged', () => {
  it('Subway, core reserve OFF: the core view of every extended station equals the station without extensions (incl. translated cores)', () => {
    let translated = 0;
    for (const seed of SUBWAY) {
      const ext = generateStation(seed, {trackExtensions: TRACK_EXT_RESERVE_OFF}), none = generateStation(seed, {trackExtensions: 'none'});
      expect(ext.extensions!.tunnels.length, `${seed}: has tunnels`).toBeGreaterThan(0);
      if (ext.extensions!.core.x || ext.extensions!.core.y) translated++;
      // the same attempt (extensions never decide a retry) and the core records come first
      expect(ext.attempt).toBe(none.attempt);
      expect(ext.areas.slice(0, none.areas.length).some(isExtensionArea)).toBe(false);
      expect(ext.areas.slice(none.areas.length).every(isExtensionArea)).toBe(true);
      expect(ext.props.length).toBe(none.props.length);
      expect(ext.pickups.length).toBe(none.pickups.length);
      expect(ext.zombies.length).toBe(none.zombies.length);
      sameCore(ext, none, `Subway ${seed}`);
    }
    expect(translated).toBeGreaterThanOrEqual(4);
  });

  it('Subway, core reserve ON (live): the core does not depend on the extension plan; the reserve re-lays only stations with an open bed end', () => {
    let changed = 0, kept = 0, translated = 0;
    for (const seed of [...SUBWAY, 1234, 2654448106]) {
      const ext = generateStation(seed), other = generateStation(seed, {trackExtensions: OTHER_PLAN});
      if (ext.extensions!.core.x || ext.extensions!.core.y) translated++;
      // the same attempt and core records whatever the plan; only the plan's appended records differ
      expect(ext.attempt, `${seed}`).toBe(other.attempt);
      expect(ext.props.length).toBe(other.props.length);
      expect(ext.pickups.length).toBe(other.pickups.length);
      expect(ext.zombies.length).toBe(other.zombies.length);
      expect(other.extensions!.annexes).toEqual([]);
      sameCore(ext, other, `Subway ${seed} (reserve on: two plans)`);
      // the reserve itself: compared with the station without extensions (main)
      const none = generateStation(seed, {trackExtensions: 'none'});
      if (canonDiff(canonLayout(coreView(ext)), canonLayout(none)).length) changed++; else kept++;
    }
    expect(translated).toBeGreaterThanOrEqual(3);
    expect(changed).toBeGreaterThan(0);
    expect(kept).toBeGreaterThan(0); // 1234 / 2654448106: no bed end open after the skeleton, the reserve keeps nothing
  });

  it('Office: same origin, grid grown east / south only, core identical', () => {
    for (const levelSeed of OFFICE) {
      const ext = generateOfficeLevel({levelSeed}), none = generateOfficeLevel({levelSeed}, undefined, undefined, 'none');
      expect(ext.extensions!.core).toEqual({x: 0, y: 0, w: none.grid.w, h: none.grid.h});
      expect(ext.grid.w * ext.grid.h).toBeGreaterThan(none.grid.w * none.grid.h);
      expect(ext.attempt).toBe(none.attempt);
      sameCore(ext, none, `Office ${levelSeed}`);
    }
  });

  it('the level registry path (gear + masks placed on the finished layout) keeps the core: gear never lands in an extension', () => {
    for (const [level, seed] of [['subway', 2563024239], ['subway', 1161843096], ['subway', 1549120013], ['office', 7922]] as [LevelId, number][]) {
      const gear = rollLevelGear(seed, level, ['main']).main;
      const all = [...gear, ...['armor_vest', 'chest_rig', 'backpack', 'helmet'].map(itemId => ({itemId}))];
      const ext = LEVELS[level].generate('main', {levelSeed: seed, startWeapon: 'pistol', gear: all});
      // (GEN-2: the Subway's core carries the reserve: compared with another extension plan on the same reserve)
      const none = level === 'subway' ? generateStation(seed, {startWeapon: 'pistol', trackExtensions: OTHER_PLAN}) : generateOfficeLevel({levelSeed: seed, startWeapon: 'pistol'}, undefined, undefined, 'none');
      placeSectionGear(none, all.filter(g => !isMaskLootItem(g.itemId)));
      placeMaskLoot(none, all.filter(g => isMaskLootItem(g.itemId)));
      sameCore(ext, none, `${level} ${seed} (+ gear)`);
      for (const p of ext.pickups) expect(isExtensionArea(ext.areas[p.area]), `${level} ${seed}: ${p.itemId}`).toBe(false);
    }
  });

  it('runtime fields: the decay field core window, wall-face seeds and shelf-stock seeds stay the core\'s', () => {
    // its extensions reach west and north: the core is translated (GEN-2: reserve off, so the core is main's)
    const seed = 1788470405;
    const ext = generateStation(seed, {trackExtensions: TRACK_EXT_RESERVE_OFF}), none = generateStation(seed, {trackExtensions: 'none'});
    const e = ext.extensions!;
    expect(e.core.x).toBeGreaterThan(0);
    expect(e.core.y).toBeGreaterThan(0);
    // decay: every texel of the core window equals the field of the station without extensions
    const fe = buildDecayField(ext, stationLevels(ext)), fn = buildDecayField(none, stationLevels(none));
    let diff = 0;
    for (let L = 0; L < fn.levels; L++) for (let y = 0; y < fn.h; y++) for (let x = 0; x < fn.w; x++) {
      const a = (L * fn.w * fn.h + y * fn.w + x) * 4, b = (L * fe.w * fe.h + (y + e.core.y) * fe.w + x + e.core.x) * 4;
      for (let c = 0; c < 4; c++) if (fn.data[a + c] !== fe.data[b + c]) diff++;
    }
    expect(diff).toBe(0);
    // wall faces: a face of the core station keeps its seed in the extended grid (faces at the tunnel mouths change: < 2 %)
    const facesOf = (l: StationLayout) => extractWallFaces(l, stationLevels(l), new LevelColumns(stationLevels(l)), {tileLowerHeight: 1.2});
    const key = (f: {level: number; x0: number; z0: number; x1: number; z1: number; finish: string; y0: number}, dx: number, dz: number) =>
      `${f.level}:${(f.x0 - dx).toFixed(3)},${(f.z0 - dz).toFixed(3)},${(f.x1 - dx).toFixed(3)},${(f.z1 - dz).toFixed(3)}:${f.finish}:${f.y0.toFixed(3)}`;
    const seedOf = new Map(facesOf(none).map(f => [key(f, 0, 0), f.seed]));
    let matched = 0, same = 0;
    for (const f of facesOf(ext)) {
      const s = seedOf.get(key(f, e.shift.x, e.shift.z));
      if (s === undefined) continue;
      matched++;
      if (s === f.seed) same++;
    }
    expect(matched).toBeGreaterThan(seedOf.size * 0.98);
    expect(same).toBe(matched);
    // shelf stock: the seed of every core holder is its seed in the station without extensions (exact core-frame positions)
    const xz = e.coreXZ!.props!;
    expect(xz.length).toBe(2 * none.props.length);
    for (let i = 0; i < none.props.length; i++) {
      const a = ext.props[i], b = none.props[i];
      expect(Math.abs(a.x - e.shift.x - b.x)).toBeLessThan(1e-9);
      expect(holderStockSeed(ext.seed, a.kind, xz[2 * i], xz[2 * i + 1], a.y)).toBe(holderStockSeed(none.seed, b.kind, b.x, b.z, b.y));
    }
  });
});
