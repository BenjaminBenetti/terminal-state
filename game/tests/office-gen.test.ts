// Seamless Office Space (lane GEN): the ONE office layout (gen/office/*) — determinism, validity, the 9 storeys at their real
// contiguous heights, the scissor stair (every storey reachable on foot from the platform), the solid elevator shaft with its
// stops, windows / daylight per storey, whole-level populations, the station's size against the base Subway, the N-grid Kit
// option, the builder hooks, and the Subway's unchanged (pinned) output.

import * as THREE from 'three';
import {describe, expect, it} from 'vitest';
import {installCanvasShim} from './helpers/canvas2d';
import {TEXTURE_FILES, type TextureKey} from '../src/assets/manifest';
import {WorldMaterials} from '../src/world/materials';
import {buildWorld} from '../src/world/builder';
import {
  OFFICE_FLOORS, OFFICE_GEN_STATS, OFFICE_SECTIONS, OFFICE_TOP_FLOOR, generateOfficeLevel, generateOfficeSection, officeIssues, officeSeed, towerFrame,
} from '../src/gen/office/index';
import {FLOOR_HEIGHT, MARGIN, OFFICE_ROOF_LEVEL, SCISSOR_STAIR, WELL, landingEnd} from '../src/gen/office/frame';
import {ANNEX_CACHE_GEAR_KEY, ROOF_FIND_KEY} from '../src/items/lootTables';
import {OFFICE_ENEMIES, officeWeaponPlan} from '../src/gen/office/spawns';
import {isOfficeKind} from '../src/gen/office/kinds';
import {generateStation} from '../src/gen/station';
import {Kit} from '../src/gen/stationKit';
import {levelDistance, levelMetrics} from '../src/gen/levelGen';
import {levelsOf} from '../src/gen/levels';
import {CELL, FLOOR, SOLID, VOID} from '../src/gen/grid';
import {PROP_DEFS} from '../src/gen/props';
import {ITEMS} from '../src/items/items';
import {Rng} from '../src/core/rng';
import {cutOfficeWindows} from '../src/world/officeProps';
import type {StationLayout} from '../src/gen/stationTypes';
import {corpusTotals} from './helpers/lootEconomy';
import {LEGACY_AMMO_IDS} from '../src/items/calibers';
import {coreView, isExtensionArea} from '../src/gen/trackExt/index';
import {TRACK_EXT_RESERVE_OFF} from './helpers/trackExtCore';

/** Canonical dump hash of everything a generator produces (grids, areas, doors, props, lights, signs, loot, spawns). */
function fingerprint(l: StationLayout): string {
  let h = 0x811c9dc5 >>> 0;
  const mix = (s: string) => { for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } };
  const r = (v: number) => (Math.round(v * 1000) / 1000).toString();
  mix(`${l.seed}|${l.attempt}|${l.name}|${l.archetype}|${l.grid.w}x${l.grid.h}`);
  for (const L of l.levels) { mix(`L${L.id}${L.role}${r(L.baseY)}`); const g = L.grid; for (let i = 0; i < g.cells.length; i++) if (g.cells[i]) mix(`${i}:${g.cells[i]}:${g.area[i]}:${r(g.floor[i])}:${r(g.ceil[i])}:${g.blocked[i]}${g.sightBlocked[i]}`); }
  for (const a of l.areas) mix(`A${a.id}${a.type}${a.kind}${a.x},${a.y},${a.w},${a.h}${a.purpose ?? ''}${a.lighting}${a.label}`);
  for (const d of l.doors) mix(`D${d.x},${d.y},${d.w},${d.h}${d.a}-${d.b}`);
  for (const p of l.props) mix(`P${p.kind}${r(p.x)},${r(p.y)},${r(p.z)},${r(p.rot)}v${p.variant}${p.purpose ?? ''}${p.host ?? ''}`);
  for (const p of l.lights) mix(`Li${r(p.x)},${r(p.y)},${r(p.z)}${p.broken}${p.flicker}${p.warm}${r(p.power)}${p.dying}`);
  for (const s of l.signs) mix(`S${s.kind}${s.text}${r(s.x)},${r(s.y)},${r(s.z)}`);
  for (const p of l.pickups) mix(`K${p.itemId}${p.count}${r(p.x)},${r(p.y)},${r(p.z)}`);
  for (const z of l.zombies) mix(`Z${z.type}${z.archetype}${r(z.x)},${r(z.z)},${r(z.yaw)}`);
  mix(`sp${r(l.playerSpawn.x)},${r(l.playerSpawn.z)},${r(l.playerSpawn.yaw)}`);
  for (const s of l.storefronts) mix(`F${s.name}${s.use}${s.ox},${s.oy}`);
  return h.toString(16);
}

const LEVEL_SEEDS = [11, 222, 3333];
const cache = new Map<string, StationLayout>();
const times: number[] = [];
const gen = (levelSeed: number, startWeapon: 'rifle' | 'pistol' = 'pistol'): StationLayout => {
  const key = `${levelSeed}:${startWeapon}`;
  let l = cache.get(key);
  if (!l) {
    cache.set(key, (l = generateOfficeLevel({levelSeed, startWeapon})));
    times.push(OFFICE_GEN_STATS.ms);
  }
  return l;
};
const floorsOf = (l: StationLayout) => l.office!.storeys.map(s => s.levelId);

describe('office level (one continuous layout)', () => {
  it('one section; floors 1..8; the section shim returns the same level', () => {
    expect(OFFICE_SECTIONS).toEqual(['main']);
    expect(OFFICE_FLOORS).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(OFFICE_TOP_FLOOR).toBe(8);
    expect(fingerprint(generateOfficeSection('main', {levelSeed: 222, startWeapon: 'pistol'}))).toBe(fingerprint(gen(222)));
  });

  it('is deterministic per (level seed, start weapon); seeds differ; generation stays well under 2 s', () => {
    const a = generateOfficeLevel({levelSeed: 4242, startWeapon: 'pistol'});
    const b = generateOfficeLevel({levelSeed: 4242, startWeapon: 'pistol'});
    expect(fingerprint(a)).toBe(fingerprint(b));
    expect(a.seed).toBe(officeSeed(4242));
    expect(fingerprint(gen(11))).not.toBe(fingerprint(gen(222)));
    for (const s of LEVEL_SEEDS) gen(s);
    const sorted = times.slice().sort((p, q) => p - q);
    process.stdout.write(`\n[office-gen] generateOfficeLevel ms: ${times.map(t => t.toFixed(0)).join(', ')} (median ${sorted[sorted.length >> 1].toFixed(0)})\n`);
    expect(sorted[sorted.length >> 1]).toBeLessThan(2000);
  });

  it('every level validates (reachability, storeys, scissor stair, shaft, landings, windows, populations, shared rules)', () => {
    for (const levelSeed of [...LEVEL_SEEDS, 0x5ea1e55]) {
      const l = gen(levelSeed);
      expect(officeIssues(l, towerFrame(levelSeed)), `${levelSeed}`).toEqual([]);
    }
  });

  it('storeys: station 0, lobby 1, floors 2..8 at hu + 4.4 (n - 1); levelId === floor; one grid size; tower at the same X/Z', () => {
    for (const levelSeed of LEVEL_SEEDS) {
      const l = gen(levelSeed), o = l.office!, f = towerFrame(levelSeed);
      // Task office-overhaul-20261030 (lane STRUCT's roof, expectation updated by lane TENANTS): + levels[9] = the roof.
      expect(l.levels.map(L => L.role)).toEqual(['main', 'upper', 'office', 'office', 'office', 'office', 'office', 'office', 'office', 'roof']);
      expect(l.levels.map(L => L.id)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
      const hu = l.levels[1].baseY;
      expect(hu).toBeGreaterThanOrEqual(5.4);
      expect(hu).toBeLessThanOrEqual(5.9);
      for (let n = 2; n <= 8; n++) expect(l.levels[n].baseY).toBeCloseTo(hu + FLOOR_HEIGHT * (n - 1), 6);
      expect(l.levels[8].baseY).toBeGreaterThan(36);
      expect(o.version).toBe(2);
      expect(o.storeys.map(s => [s.floor, s.levelId, s.label])).toEqual(OFFICE_FLOORS.map(n => [n, n, n === 1 ? 'L' : String(n)]));
      for (const s of o.storeys) expect(s.baseY).toBe(l.levels[s.levelId].baseY);
      expect(o.groundY).toBe(hu);
      expect(o.floorHeight).toBe(FLOOR_HEIGHT);
      for (const L of l.levels) expect([L.grid.w, L.grid.h]).toEqual([l.grid.w, l.grid.h]);
      expect(o.exterior).toEqual({x0: (MARGIN - 1) * CELL, z0: (MARGIN - 1) * CELL, x1: (MARGIN + f.TW + 1) * CELL, z1: (MARGIN + f.TD + 1) * CELL});
      // Footprint ~37-42 x 26-30 m.
      expect(f.TW * CELL).toBeGreaterThanOrEqual(37);
      expect(f.TW * CELL).toBeLessThanOrEqual(42);
      expect(f.TD * CELL).toBeGreaterThanOrEqual(26);
      expect(f.TD * CELL).toBeLessThanOrEqual(30);
      // Every tower storey's grid has its interior at the same cells (the perimeter ring solid, the interior corner open).
      for (const n of floorsOf(l)) {
        const g = l.levels[n].grid;
        expect(g.cells[g.idx(MARGIN - 1, MARGIN + 3)]).toBe(SOLID);
        expect(l.areas[g.area[g.idx(MARGIN + 1, MARGIN + 1)]]?.level).toBe(n);
      }
      // The start is on the platform (station level 0).
      expect(o.start).toEqual({x: l.playerSpawn.x, z: l.playerSpawn.z, yaw: l.playerSpawn.yaw, level: 0});
      expect(l.areas[l.grid.area[l.grid.idx(...l.grid.cellOf(l.playerSpawn.x, l.playerSpawn.z))]].kind).toBe('platform');
    }
  });

  it('scissor stair: one 24-riser run per storey pair in alternating lanes, landings alternating ends, all reachable on foot', () => {
    for (const levelSeed of LEVEL_SEEDS) {
      const l = gen(levelSeed), o = l.office!, f = towerFrame(levelSeed);
      expect(o.stairs.runs.map(r => [r.lower, r.upper, r.lane])).toEqual([[1, 2, 'A'], [2, 3, 'B'], [3, 4, 'A'], [4, 5, 'B'], [5, 6, 'A'], [6, 7, 'B'], [7, 8, 'A']]);
      // Station → lobby run first (unchanged), then one LevelLink per scissor run.
      expect(l.levelLinks[0]).toMatchObject({kind: 'stairs', lower: 0, upper: 1});
      for (const r of o.stairs.runs) {
        const k = l.levelLinks[r.link];
        expect(k).toMatchObject({kind: 'stairs', lower: r.lower, upper: r.upper});
        const R = l.grid.ramps[k.ramp!];
        // Carved into exactly its two storey grids.
        for (const L of l.levels) expect(L.grid.rampIdx[L.grid.idx(R.x, R.y)] === k.ramp, `run ${r.lower}-${r.upper} level ${L.id}`).toBe(L.id === r.lower || L.id === r.upper);
        expect(k.bottom.y).toBeCloseTo(l.levels[r.lower].baseY, 6);
        expect(k.top.y).toBeCloseTo(l.levels[r.upper].baseY, 6);
        const flights = l.traversal.stairs.filter(q => l.areas[q.area].level === r.lower && l.areas[q.area].role === 'stair');
        expect(flights.map(q => q.risers)).toEqual([12, 12]);
        for (const q of flights) {
          expect(q.riser).toBeCloseTo(FLOOR_HEIGHT / 24, 9);
          expect(q.riser).toBeLessThanOrEqual(0.19);
          expect(q.tread).toBe(0.28);
          expect(q.headroom).toBe(SCISSOR_STAIR.headroom);
          expect(q.a1 - q.a0).toBeCloseTo(WELL.lane * CELL, 6);
        }
      }
      // Landings: odd floors at one end of the well, even floors at the other; each opens onto its storey through a doorway.
      const ends = o.stairs.landings.map(p => landingEnd(f, p.floor));
      expect(new Set(ends.filter((_, i) => i % 2 === 0)).size).toBe(1);
      expect(new Set(ends.filter((_, i) => i % 2 === 1)).size).toBe(1);
      expect(ends[0]).not.toBe(ends[1]);
      expect(new Set(o.stairs.landings.filter(p => p.floor % 2).map(p => p.x)).size).toBe(1);
      for (const p of o.stairs.landings) {
        const g = l.levels[p.levelId].grid, a = l.areas[g.area[g.idx(...g.cellOf(p.x, p.z))]];
        expect(a.type).toBe('office-stair');
        expect(a.level).toBe(p.levelId);
        expect(l.doors.some(d => (d.a === a.id || d.b === a.id) && d.level === p.levelId && !d.fare)).toBe(true);
      }
      // Walking distance from the platform start rises storey by storey (stairs only: the elevator is not in the grids).
      const [sx, sy] = l.grid.cellOf(o.start.x, o.start.z);
      const d = levelDistance(l.levels, sx, sy, 0);
      const at = o.stairs.landings.map(p => { const g = l.levels[p.levelId].grid; return d[p.levelId][g.idx(...g.cellOf(p.x, p.z))]; });
      for (let i = 0; i < at.length; i++) {
        expect(at[i], `landing ${i + 1}`).toBeGreaterThan(0);
        if (i) expect(at[i]).toBeGreaterThan(at[i - 1]);
      }
      process.stdout.write(`[office-gen] ${levelSeed}: walk (cells) start -> landing L..8 ${at.join(' ')}\n`);
      // The runtime nav graph (gen/levels.ts Levels, no drops) agrees: every landing and every elevator landing strip is reachable.
      const L = levelsOf(l), reach = L.reachable(0, sx, sy, {drops: false});
      for (const p of [...o.stairs.landings, ...o.elevator.stops.map(q => ({levelId: q.levelId, ...q.landing}))]) {
        const g = l.levels[p.levelId].grid;
        expect(reach[L.node(p.levelId, g.idx(...g.cellOf(p.x, p.z)))], `nav to ${p.levelId} ${p.x},${p.z}`).toBeGreaterThanOrEqual(0);
      }
      // No void falls anywhere (every walkable edge facing a drop is walled or railed).
      expect(levelsOf(l).unrailedDrops()).toEqual([]);
    }
  });

  it('elevator: one shaft at the same X/Z, SOLID on every tower storey; a stop per floor with a clear landing strip', () => {
    for (const levelSeed of LEVEL_SEEDS) {
      const l = gen(levelSeed), e = l.office!.elevator;
      expect(e.doorSide).toBe('N');
      expect(e.cab.x1 - e.cab.x0).toBeCloseTo(2.5, 6);
      expect(e.cab.z1 - e.cab.z0).toBeCloseTo(2.0, 6);
      expect(e.shaft).toEqual({x0: e.cab.x0 - CELL, z0: e.cab.z0 - CELL, x1: e.cab.x1 + CELL, z1: e.cab.z1 + CELL});
      expect(e.door.z).toBe(e.cab.z0);
      expect(e.door.width).toBe(1.5);
      expect(e.cabHeight).toBe(2.6);
      expect(e.panel.dy).toBe(1.2);
      expect(e.panel.x).toBeGreaterThan(e.cab.x0);
      expect(e.panel.x).toBeLessThan(e.cab.x1);
      expect(e.stops.map(s => s.floor)).toEqual([...OFFICE_FLOORS]);
      for (const s of e.stops) {
        expect(s.levelId).toBe(s.floor);
        expect(s.y).toBe(l.levels[s.levelId].baseY);
        expect(s.callPanel.y).toBeCloseTo(s.y + 1.2, 6);
        const g = l.levels[s.levelId].grid;
        for (let z = e.shaft.z0 + 0.25; z < e.shaft.z1; z += 0.5) for (let x = e.shaft.x0 + 0.25; x < e.shaft.x1; x += 0.5) expect(g.cells[g.idx(...g.cellOf(x, z))], `shaft ${s.floor}`).toBe(SOLID);
        // Landing strip: 2.5 m x 1.5 m of walkable, prop-free floor at the stop height in front of the door.
        for (let z = e.shaft.z0 - 1.25; z < e.shaft.z0; z += 0.5) for (let x = e.door.x - 1.0; x <= e.door.x + 1.0; x += 0.5) {
          const [cx, cy] = g.cellOf(x, z);
          expect(g.walkable(cx, cy), `strip ${s.floor} ${x},${z}`).toBe(true);
          expect(g.floorOf(g.idx(cx, cy))).toBeCloseTo(s.y, 4); // grid floors are Float32
        }
        // No prop stands on it (> 0.1 m intrusion; high wall mounts on the corridor's far wall are overhead, not on the strip).
        expect(l.props.some(p => (p.level ?? 0) === s.levelId && !(p.mounted && p.y - s.y >= 2.0 && Math.abs(p.z - e.shaft.z0) > 0.6)
          && Math.abs(p.x - e.door.x) < 1.25 + p.hx - 0.1 && p.z + p.hz > e.shaft.z0 - 1.5 + 0.1 && p.z - p.hz < e.shaft.z1)).toBe(false);
        // A working, steady fixture lights every landing.
        const lit = l.lights.filter(q => (q.level ?? 0) === s.levelId && !q.virtual && Math.hypot(q.x - s.landing.x, q.z - s.landing.z) < 3.2);
        expect(lit.length).toBeGreaterThan(0);
        expect(lit.every(q => !q.broken && !q.dying && !q.flicker)).toBe(true);
      }
    }
  });

  it('windows lie on the perimeter ring of their own storey; the builder cuts exactly those spans out of that storey\'s faces', () => {
    for (const levelSeed of LEVEL_SEEDS) {
      const l = gen(levelSeed), o = l.office!;
      for (const n of floorsOf(l)) {
        const own = o.windows.filter(w => w.level === n);
        expect(own.length, `storey ${n}`).toBeGreaterThan(15);
        expect(own.filter(w => w.kind === 'entrance').length).toBe(n === 1 ? 1 : 0);
        for (const w of own) {
          expect(w.baseY).toBe(l.levels[n].baseY);
          const onRing = w.side === 'N' ? w.z0 === o.exterior.z0 : w.side === 'S' ? w.z1 === o.exterior.z1 : w.side === 'W' ? w.x0 === o.exterior.x0 : w.x1 === o.exterior.x1;
          expect(onRing).toBe(true);
          expect(w.head).toBeGreaterThan(w.sill);
          expect(w.head).toBeLessThan(n === 1 ? 4.0 : 2.9);
        }
      }
    }
    // Face cut: a facade face on floor 5 loses exactly the window rectangle; the same plane on floor 4 is untouched.
    const info = gen(11).office!;
    const w = info.windows.find(q => q.side === 'N' && q.kind === 'window' && q.level === 5)!;
    const face = {level: 5, x0: w.x0 - 2, z0: w.z1, x1: w.x1 + 2, z1: w.z1, y0: w.baseY, y1: w.baseY + 2.9, openings: [], finish: 'paint'};
    const cut = cutOfficeWindows([face], {office: {...info, windows: [w]}});
    const area = (q: typeof face) => (q.x1 - q.x0) * (q.y1 - q.y0);
    expect(cut.length).toBe(4);
    expect(cut.reduce((s, q) => s + area(q), 0)).toBeCloseTo(area(face) - (w.x1 - w.x0) * (w.head - w.sill), 6);
    const other = {...face, level: 4, y0: w.baseY - FLOOR_HEIGHT, y1: w.baseY - FLOOR_HEIGHT + 2.9};
    expect(cutOfficeWindows([other], {office: {...info, windows: [w]}})).toEqual([other]);
    expect(cutOfficeWindows([face], {})).toEqual([face]);
  });

  it('station: a compact stop about one sixth of the base Subway, joined to the lobby by its straight stair run', () => {
    // Track 2 (lane GEN): the CORE stations (gen/trackExt coreView: tunnels / annexes are reported by tests/track-ext*.test.ts)
    const subway = [1, 7, 42, 1234, 99999].map(seed => levelMetrics(coreView(generateStation(seed))).walkM2.reduce((a, b) => a + b, 0));
    const subwayMean = subway.reduce((a, b) => a + b, 0) / subway.length;
    const all = LEVEL_SEEDS.concat([7, 99, 512]).map(levelSeed => gen(levelSeed));
    const station = all.map(l => levelMetrics(coreView(l)).walkM2[0]);
    const ratio = station.reduce((a, b) => a + b, 0) / station.length / subwayMean;
    const m = levelMetrics(all[0]).walkM2;
    process.stdout.write(`[office-gen] subway mean walk ${subwayMean.toFixed(0)} m2; station walk ${station.join(', ')} m2; ratio ${ratio.toFixed(3)}; storeys (seed 11) ${m.join(' / ')} m2\n`);
    expect(ratio).toBeGreaterThanOrEqual(0.12);
    expect(ratio).toBeLessThanOrEqual(0.22);
    for (const l of all) {
      const m2 = levelMetrics(l).walkM2;
      for (const n of floorsOf(l)) expect(m2[n], `storey ${n}`).toBeGreaterThan(800);
      expect(l.platforms.length).toBe(1);
      expect(l.trenches.length).toBe(2);
      expect(l.doors.some(d => d.fare)).toBe(true);
      expect(l.areas.filter(a => a.type === 'washroom' && !a.level).length).toBeGreaterThanOrEqual(2);
      expect(l.areas.some(a => a.type === 'agent-office')).toBe(true);
      expect(l.traversal.ladders.length).toBeGreaterThanOrEqual(4);
      const k = l.levelLinks[0];
      for (const L of l.levels) expect(L.grid.rampIdx[L.grid.idx(L.grid.ramps[k.ramp!].x, L.grid.ramps[k.ramp!].y)] === k.ramp).toBe(L.id <= 1);
    }
  });

  it('populations are whole-level: 5-8 on the station + lobby, 3-6 per office floor; scarce loot; no gear; known items / props', () => {
    let floorEnemies = 0, floors = 0, pickups = 0;
    for (const levelSeed of LEVEL_SEEDS) {
      const l = gen(levelSeed);
      // (Track 2, lane CONTENT: the core contexts' spawns; the service annexes' zone budget is separate — tests/annex-content.test.ts)
      const core = l.zombies.filter(z => !isExtensionArea(l.areas[z.area]));
      const per = (lvs: number[]) => core.filter(z => lvs.includes(z.level ?? 0)).length;
      expect(per([0, 1])).toBeGreaterThanOrEqual(OFFICE_ENEMIES.street[0]);
      expect(per([0, 1])).toBeLessThanOrEqual(OFFICE_ENEMIES.street[1]);
      for (let n = 2; n <= 8; n++) {
        expect(per([n])).toBeGreaterThanOrEqual(OFFICE_ENEMIES.floor[0]);
        expect(per([n])).toBeLessThanOrEqual(OFFICE_ENEMIES.floor[1]);
        floorEnemies += per([n]);
        floors++;
      }
      expect(core.length).toBeLessThanOrEqual(8 + 7 * 6 + 2); // + office-overhaul: 0-2 on the roof (gen/office/roof.ts)
      // task track1-siren-blightbelly-20261031 (lane SPAWN): + the Blightbelly and the (Office-only) Siren families
      expect(l.zombies.every(z => ['zombie', 'blightbelly', 'siren', 'ratdog'].includes(z.archetype ?? 'zombie'))).toBe(true);
      for (const z of l.zombies) if (z.level) expect(z.y).toBeCloseTo(l.levels[z.level].baseY, 4);
      pickups += l.pickups.length;
      for (const p of l.pickups) {
        expect(ITEMS[p.itemId], p.itemId).toBeDefined();
        // (task gas-mask-roof-feedback-20261030: the roof find may be a gear piece — the explicit roof exception, on the roof only)
        if (p.reward === ROOF_FIND_KEY) { expect(p.level).toBe(OFFICE_ROOF_LEVEL); continue; }
        // (round 3, lane HIDEOUT) the service annex hideout's gear piece (gen/annexCache.ts ANNEX_CACHE_GEAR): in the annex only
        if (p.reward === ANNEX_CACHE_GEAR_KEY) { expect(isExtensionArea(l.areas[p.area])).toBe(true); continue; }
        expect(ITEMS[p.itemId].kind).not.toBe('gear');
      }
      for (const p of l.props) expect(PROP_DEFS[p.kind], p.kind).toBeDefined();
      // Office furniture per storey: cubicle farms / desks on the office floors, the reception desk in the lobby.
      const on = (n: number, kind: string) => l.props.filter(p => (p.level ?? 0) === n && p.kind === kind).length;
      // Task office-overhaul-20261030 (lane TENANTS): company floors trade some cubicle desks for their own work surfaces (trading
      // desks, lab benches, drafting tables, consoles, exam tables …): count every work surface, not only the `desk` kind.
      const WORK = ['desk', 'receptionDesk', 'executiveDesk', 'tradingDesk', 'labBench', 'draftingTable', 'mixingConsole', 'cctvConsole', 'newsDesk', 'monitorDesk', 'examTable', 'consoleStation', 'table'];
      for (let n = 2; n <= 8; n++) expect(WORK.reduce((s, k) => s + on(n, k), 0), `${levelSeed} floor ${n} work surfaces`).toBeGreaterThan(3);
      // (TENANTS: open studios / trading floors / labs are partition-free; cubicle farms remain where the company keeps them.)
      expect([2, 3, 4, 5, 6, 7].reduce((s, n) => s + on(n, 'cubiclePartition') + on(n, 'desk'), 0)).toBeGreaterThan(40);
      expect(on(1, 'receptionDesk')).toBe(1);
      expect(l.props.some(p => isOfficeKind(p.kind))).toBe(true);
      // Unique ids across storeys: one list per kind in one layout (indices are the ids).
      expect(new Set(l.areas.map(a => a.id)).size).toBe(l.areas.length);
      expect(l.areas.every((a, i) => a.id === i)).toBe(true);
    }
    const mean = floorEnemies / floors;
    expect(mean).toBeGreaterThan(3);
    expect(mean).toBeLessThan(6);
    // About one Subway station's worth of loose loot over the whole level (iteration-16 totals: ~1 box per storey).
    expect(pickups / LEVEL_SEEDS.length).toBeGreaterThan(8);
    expect(pickups / LEVEL_SEEDS.length).toBeLessThan(40);
  });

  it('loot census (holders + loose pickups): the whole office level holds about one Subway station\'s worth', () => {
    const office = corpusTotals(LEVEL_SEEDS.concat([7]).map(s => gen(s)));
    const subway = corpusTotals([1, 7, 42, 1234].map(seed => generateStation(seed, {startWeapon: 'pistol'})));
    const per = (t: typeof office) => Object.fromEntries(Object.entries(t.units).map(([k, v]) => [k, Math.round(v / t.stations * 100) / 100]));
    const o = per(office), sw = per(subway);
    process.stdout.write(`[office-gen] loot per level (mean of ${office.stations}): office ${JSON.stringify(o)} · one Subway station ${JSON.stringify(sw)} · holders ${(office.holders / office.stations).toFixed(0)} vs ${(subway.holders / subway.stations).toFixed(0)}\n`);
    const nonAmmo = (u: Record<string, number>) => u.food + u.drink + u.med;
    expect(nonAmmo(o)).toBeGreaterThan(0.4 * nonAmmo(sw));
    expect(nonAmmo(o)).toBeLessThan(1.8 * nonAmmo(sw));
    expect(o.ammo).toBeGreaterThan(0.4 * sw.ammo);
    expect(o.ammo).toBeLessThan(1.8 * sw.ammo);
    expect(o.weapon).toBeLessThanOrEqual(6);
  });

  it('weapon finds are planned once per level (keyed by storey): at most 2 copies per non-start weapon, never the start weapon', () => {
    for (const levelSeed of [1, 2, 3, 4, 5, 6, 7, 8]) for (const sw of ['rifle', 'pistol'] as const) {
      const plan = officeWeaponPlan(levelSeed, sw);
      expect(Object.keys(plan).map(Number)).toEqual([...OFFICE_FLOORS]);
      const all = Object.values(plan).flat();
      for (const w of new Set(all)) expect(all.filter(x => x === w).length).toBeLessThanOrEqual(2);
      expect(all.includes(sw)).toBe(false);
      expect(officeWeaponPlan(levelSeed, sw)).toEqual(plan);
    }
    const l = gen(222, 'rifle');
    expect(l.pickups.some(p => p.itemId === 'rifle')).toBe(false);
    const plan = officeWeaponPlan(222, 'rifle');
    const want = Object.values(plan).flat().sort();
    // (the planned weapon finds; the roof find — task gas-mask-roof-feedback-20261030 — is its own curated source, never the start weapon)
    const got = l.pickups.filter(p => ITEMS[p.itemId]?.kind === 'weapon' && !p.reward).map(p => p.itemId).sort();
    expect(got.length).toBeLessThanOrEqual(want.length);
  });

  it('lighting per storey: troffers, dim cool fixture-less daylight at each storey\'s windows', () => {
    const l = gen(222), o = l.office!;
    for (const n of floorsOf(l)) {
      const day = l.lights.filter(q => q.virtual && (q.level ?? 0) === n);
      expect(day.length, `storey ${n}`).toBeGreaterThan(10);
      for (const q of day) {
        expect(q.broken || q.flicker || q.dying).toBe(false);
        expect(q.power).toBeLessThan(0.5);
        expect(q.tint).toBeDefined();
        expect(q.y).toBeGreaterThan(l.levels[n].baseY);
        expect(q.y).toBeLessThan(l.levels[n].baseY + 4.0);
      }
      const real = l.lights.filter(q => !q.virtual && (q.level ?? l.areas[q.area]?.level ?? 0) === n);
      expect(real.some(q => q.broken)).toBe(true);
      expect(real.length).toBeLessThan(220);
    }
    expect(o.gearSpots!.length).toBeGreaterThan(40);
    for (const s of o.gearSpots!) expect(s.y).toBe(l.levels[s.level].baseY);
  });

  it('Kit: N level grids on request (sharing one ramps list); the default stays the Subway\'s three', () => {
    const k3 = new Kit(new Rng(1));
    expect(k3.levelGrids.length).toBe(3);
    expect([k3.g.w, k3.g.h]).toEqual([720, 580]);
    const k9 = new Kit(new Rng(1), {levels: 9, w: 64, h: 48});
    expect(k9.levelGrids.length).toBe(9);
    expect(k9.levelGrids[0]).toBe(k9.g);
    for (const g of k9.levelGrids) { expect([g.w, g.h]).toEqual([64, 48]); expect(g.ramps).toBe(k9.g.ramps); }
    expect(k9.reserved.length).toBe(64 * 48);
  });

  it('bands per column stay within the storey count (≤ 9 open grids; stair runs are one band in their two grids)', () => {
    const l = gen(11);
    let maxBands = 0;
    for (let i = 0; i < l.grid.cells.length; i++) {
      const b = new Set<string>();
      for (const L of l.levels) { const g = L.grid, c = g.cells[i]; if (c === FLOOR || c === VOID) b.add(`${g.floor[i].toFixed(3)}:${g.ceil[i].toFixed(3)}`); }
      maxBands = Math.max(maxBands, b.size);
    }
    expect(maxBands).toBeLessThanOrEqual(9);
  });
});

describe('office level build (world/builder.ts + world/officeProps.ts, Node, no GPU)', () => {
  installCanvasShim(false);
  const fakeEnv = (): Record<TextureKey, THREE.Texture> => {
    const out = {} as Record<TextureKey, THREE.Texture>;
    for (const k of Object.keys(TEXTURE_FILES) as TextureKey[]) out[k] = new THREE.Texture({width: 64, height: 64} as unknown as HTMLImageElement);
    return out;
  };
  it('builds the whole level once: office props, carpet / drop ceiling / reveals per storey, window holes, hidden daylight fixtures', () => {
    const l = gen(222), o = l.office!;
    const mats = new WorldMaterials(fakeEnv(), 7, {w: 1.2, h: 0.19, d: 0.17});
    const w = buildWorld(l, mats, {});
    const byName = new Map<string, Set<number>>();
    w.group.traverse(q => { let s = byName.get(q.name); if (!s) byName.set(q.name, (s = new Set())); s.add(q.userData.level ?? -1); });
    // Carpet / drop ceilings on every tower storey (the lobby: its security office).
    for (const n of ['office-carpet', 'office-drop-ceiling']) expect([...(byName.get(n) ?? [])].sort(), n).toEqual([...OFFICE_FLOORS]);
    expect([...(byName.get('office-window-reveals') ?? [])].sort()).toEqual([...OFFICE_FLOORS]);
    expect([...byName.keys()].some(n => n.startsWith('prop-receptionDesk'))).toBe(true);
    expect([...byName.keys()].some(n => n.startsWith('prop-officeChair'))).toBe(true);
    expect(byName.has('prop-cubiclePartition')).toBe(true);
    // No built wall face covers a window opening (sill..head) on its storey's facade plane.
    for (const win of o.windows) {
      const alongX = win.side === 'N' || win.side === 'S';
      const plane = win.side === 'N' ? win.z1 : win.side === 'S' ? win.z0 : win.side === 'W' ? win.x1 : win.x0;
      const s0 = alongX ? win.x0 : win.z0, s1 = alongX ? win.x1 : win.z1, y0 = win.baseY + win.sill, y1 = win.baseY + win.head;
      for (const f of w.wallFaces) {
        const fx = Math.abs(f.z0 - f.z1) < 1e-9;
        if (fx !== alongX || Math.abs((fx ? f.z0 : f.x0) - plane) > 1e-6) continue;
        const a0 = Math.min(fx ? f.x0 : f.z0, fx ? f.x1 : f.z1), a1 = Math.max(fx ? f.x0 : f.z0, fx ? f.x1 : f.z1);
        const overlap = Math.min(a1, s1) - Math.max(a0, s0) > 1e-4 && Math.min(f.y1, y1) - Math.max(f.y0, y0) > 1e-4;
        expect(overlap, `face over window ${JSON.stringify(win)}`).toBe(false);
      }
    }
    // The elevator doorway is cut out of every stop's landing-side shaft face (the cells stay SOLID; lane LIFT lines it).
    const e = o.elevator;
    for (const s of e.stops) {
      const hits = w.wallFaces.filter(f => f.level === s.levelId && Math.abs(f.z0 - e.shaft.z0) < 1e-6 && Math.abs(f.z1 - e.shaft.z0) < 1e-6 && f.nz < 0
        && f.openings.some(q => Math.abs(Math.min(f.x0, f.x1) + q.s0 - (e.door.x - e.door.width / 2)) < 1e-6 && Math.abs(Math.min(f.x0, f.x1) + q.s1 - (e.door.x + e.door.width / 2)) < 1e-6 && Math.abs(q.top - (s.y + 2.2)) < 1e-4));
      expect(hits.length, `shaft doorway face on storey ${s.floor}`).toBeGreaterThan(0);
    }
    // Daylight sources: no visible fixture (zero-scale tube), no glow (power 0 fixture).
    const m = new THREE.Matrix4(), v = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
    l.lights.forEach((lt, i) => {
      if (!lt.virtual) return;
      w.tubes!.getMatrixAt(i, m);
      m.decompose(v, q, sc);
      expect(sc.x).toBeLessThan(0.01);
      expect(w.fixtures[i].power).toBe(0);
    });
  });
});

describe('the Subway is unchanged', () => {
  // Fingerprints of generateStation. Captured from git HEAD (1c71045) before any iteration-16 WORLD-GEN edit and still
  // identical after the seamless N-grid Kit option; re-pinned for the Meshy T2.5 model replacement (2026-10-30): the host
  // surfaces were re-measured on the new meshes (shop counter top 1.045 -> 1.05 m, stall counter 0.93 -> 0.923 m and its
  // z span, back counter, stretcher, iteration-07 support surfaces), so countertop items (cash registers, grinders, toasters,
  // slush machines …) sit on the new geometry: verified against a7a646a for these 8 seeds — areas, doors, grid, lights,
  // zombies and pickups byte-identical; 13–29 hosted props per seed moved by |dy| <= 0.049 m, |dz| <= 0.028 m, dx = 0,
  // same kinds / rotations / counts.
  const LEGACY_NAME = Object.fromEntries(Object.entries(LEGACY_AMMO_IDS).map(([o, n]) => [n, o])) as Record<string, string>;
  const HEAD: Record<string, string> = {
    '1:rifle': 'f50fc2e7', '1:pistol': '94a7f554', '7:rifle': 'bdd4de2a', '7:pistol': '5f455d00',
    '42:rifle': '57dcd13b', '42:pistol': 'fd258bb9', '1234:rifle': '85bc7a40', '1234:pistol': '145c9083',
  };
  // Track 2 — Beyond the Station (lane GEN): the live stations carry their track extensions (tunnels past the bed ends, service
  // annexes), appended after every core pass; a station whose extension reaches west / north has its finished core re-framed
  // (translated) into the larger grid. Every core decision is made in main's frame: the translation-normalised proof below — the
  // same fingerprint over gen/trackExt coreView(layout) (core window, records translated back at their exact core-frame
  // positions, extension records filtered) — reproduces HEAD byte for byte for every seed. LIVE = the fingerprints of the
  // extended stations (grid size, translated coordinates, extension cells / areas / doors): only seeds with extensions differ.
  // Track 2 lane GEN-2 — CAUSE: "core reserve enabled (authorized incidence change)": the Subway's TRACK_EXT.coreReserveM = 40
  // keeps rock past the bed ends still open after the archetype skeleton, so the core stations are re-laid (a layout change).
  // PROOF (every run): generated with the reserve OFF ({...TRACK_EXT, coreReserveM: 0}), the core view reproduces HEAD byte for
  // byte for every seed. CORE = the core view of the live stations (reserve on): 1234 keeps HEAD (its skeleton left no bed end
  // open: the reserve kept nothing). LIVE (was {...HEAD, 42:rifle 8aa759c8, 42:pistol 28d8c06f}) = the live stations.
  const CORE: Record<string, string> = {
    '1:rifle': '2b009238', '1:pistol': 'caf6ec41', '7:rifle': 'f7bce5d9', '7:pistol': 'dd675be3',
    '42:rifle': '811b8141', '42:pistol': '7434701e', '1234:rifle': '85bc7a40', '1234:pistol': '145c9083',
  };
  // Track 2 (lane CONTENT): the extensions are now populated (gen/annexContent.ts, own fork, appended after every core record:
  // tunnel fixtures on every extended station; annex dressing / plates / fixtures / loose finds / service spawns) - every LIVE
  // fingerprint moves (was 1 c427820b / 5ecb0be6, 7 97780ab3 / 97757449, 42 8f75cf60 / 67c40d1a, 1234 2f49e529 / 7597a315); the
  // core view still equals CORE and the reserve-off core view HEAD (asserted below; coreView filters the appended records).
  // Task track2-playtest-revision-20261031 (lane ROOMS) — CAUSE: "annex machinery halls + room signatures": the annexes are re-laid
  // (larger, taller halls in the room graph; signature machinery records + collision-only boxes; lean annex furniture), so the LIVE
  // fingerprints of the annex-bearing seeds move (was 7 b402c09e / 35870a80, 42 f1d3aed2 / 43e5c856, 1234 f4b97ce1 / 8d0d8135);
  // seed 1 (no annex) and every CORE / reserve-off HEAD fingerprint are unchanged (asserted below).
  // (playtest revision, primary: annex loot classes / room storage / service bands + the station-surface invitation art on the
  // merged ROOMS + ART lanes; stage before: 7 bcabf2ef / 5c7e39d9, 42 868cb75f / 7a6f4ce4, 1234 8136ba0b / 522bba4a; CORE unchanged)
  // (same task, after merging main ce83b48: the service budget 5-6 (the registry contract's per-storey bound: the compact mall's is
  // 6), the O(1) earshot test, supply bands over the annex rooms' depth range, no crafting materials in the annex tables; stage
  // before: 7 b96c5d08 / ef6fdaba, 1234 8351ab93 / 901c3c60; 42 drew the same; CORE unchanged)
  // (round 2, task studio-alpha-track2-round2-20261031-01 — CAUSE: R5 survivor caches (bed / storage / camp props appended, the
  // cache room's lit fixture), R6 service family pool, the signature lockers without materials; stage before: 7 3275dde8 / c0e8c846,
  // 42 62c4187f / da0b79d6, 1234 67a308e5 / fcda47b2; seed 1 (no annex) and CORE unchanged)
  // (round 3 — CAUSE: the logical annex layout (spine, lined rooms, districts, hideout room) + the survivor hideout's props / lantern
  // light / gear pickup; stage before: 7 e3af4b69 / 7e118e47, 42 608b33e4 / e7fb9e97, 1234 87eba43d / 35497900; seed 1 and CORE unchanged)
  // (round 4, task studio-alpha-beyond-station-round4-20261101-01 lane AREA — CAUSE: the Beyond the Station area exists only where the
  // level's ONE seeded roll succeeds (20 %, gen/trackExt/config.ts btsAreaRoll). PROOF: 7 / 42 roll it ABSENT (u = 0.3195 / 0.7858):
  // their annexes and annex content are gone, the tunnels stay; 1234 (0.0955) rolls it PRESENT with the same plan and 1 had none —
  // both unchanged; CORE and the reserve-off HEAD proof unchanged (asserted below). Stage before: 7 6dfe8a80 / ea7d8213, 42 bc5c9cde /
  // 809464c2)
  const LIVE: Record<string, string> = {
    '1:rifle': '7f9ed442', '1:pistol': '7a1932f', '7:rifle': '8701b11c', '7:pistol': 'b2cdc4c6',
    '42:rifle': '5be7cbc8', '42:pistol': '6ab7d217', '1234:rifle': '1bc68a4', '1234:pistol': '640ce0e0',
  };
  it('generateStation output for existing seeds is byte-identical to HEAD (reserve-off core view; core = + reserve; live = + track extensions)', () => {
    let replaced = 0;
    const core: Record<string, string> = {}, live: Record<string, string> = {};
    for (const [key, fp] of Object.entries(HEAD)) {
      const [seed, sw] = key.split(':');
      const l = generateStation(Number(seed), {startWeapon: sw as 'rifle' | 'pistol'});
      const off = generateStation(Number(seed), {startWeapon: sw as 'rifle' | 'pistol', trackExtensions: TRACK_EXT_RESERVE_OFF});
      // lane AMMO (knife-melee-20261030): the ammo item ids became caliber ids (ammo_rifle -> ammo_556, ...); with the old names
      // mapped back, the generated station must still be byte-identical (floor boxes / weapon-find companions are unchanged)
      // Task track1-siren-blightbelly-20261031 (lane SPAWN): the new families REPLACE zombie slots (same roll, rat/dogs identical);
      // mapped back to 'zombie' the station is still byte-identical (enemy-spawn-parity.test.ts holds the invariant pins too)
      const legacy = (q: StationLayout) => ({
        ...q,
        zombies: q.zombies.map(z => (z.archetype === 'blightbelly' || z.archetype === 'siren' ? (replaced++, {...z, archetype: 'zombie' as const}) : z)),
        pickups: q.pickups.map(p => ({...p, itemId: LEGACY_NAME[p.itemId] ?? p.itemId})),
      });
      expect(fingerprint(legacy(coreView(off))), `${key} core (reserve off)`).toBe(fp);
      core[key] = fingerprint(legacy(coreView(l)));
      live[key] = fingerprint(legacy(l));
      expect(l.office).toBeUndefined();
      expect(l.props.some(p => isOfficeKind(p.kind))).toBe(false);
      // (round 3, lane HIDEOUT) the only fixture-less sources: the annex hideout lanterns' warm light (gen/annexCache.ts), untinted
      expect(l.lights.some(q => q.tint || (q.virtual && !(q.warm && isExtensionArea(l.areas[q.area]))))).toBe(false);
    }
    expect(replaced, 'the corpus exercises the family mapping').toBeGreaterThan(0);
    expect(core).toEqual(CORE);
    expect(live).toEqual(LIVE);
  });
});
