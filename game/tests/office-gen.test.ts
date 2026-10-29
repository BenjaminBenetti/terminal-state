// Iteration 16 (WORLD-GEN): office section generator (gen/office/*) — determinism, validity, the shared tower frame, the
// street station's size against the base Subway, populations, windows and the Subway's unchanged output.

import * as THREE from 'three';
import {describe, expect, it} from 'vitest';
import {installCanvasShim} from './helpers/canvas2d';
import {TEXTURE_FILES, type TextureKey} from '../src/assets/manifest';
import {WorldMaterials} from '../src/world/materials';
import {buildWorld} from '../src/world/builder';
import {
  OFFICE_FLOORS, OFFICE_SECTIONS, OFFICE_TOP_FLOOR, generateOfficeSection, officeIssues, sectionSeed, towerFrame,
} from '../src/gen/office/index';
import {MARGIN} from '../src/gen/office/frame';
import {OFFICE_ENEMIES, officeWeaponPlan} from '../src/gen/office/spawns';
import {isOfficeKind} from '../src/gen/office/kinds';
import {generateStation} from '../src/gen/station';
import {levelDistance, levelMetrics} from '../src/gen/levelGen';
import {CELL, FLOOR, VOID} from '../src/gen/grid';
import {PROP_DEFS} from '../src/gen/props';
import {ITEMS} from '../src/items/items';
import {cutOfficeWindows} from '../src/world/officeProps';
import type {StationLayout} from '../src/gen/stationTypes';

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
const gen = (levelSeed: number, section: string, startWeapon: 'rifle' | 'pistol' = 'pistol'): StationLayout => {
  const key = `${levelSeed}:${section}:${startWeapon}`;
  let l = cache.get(key);
  if (!l) cache.set(key, (l = generateOfficeSection(section, {levelSeed, startWeapon})));
  return l;
};

describe('office sections', () => {
  it('names: street + floor-2 … floor-8, floors 1..8', () => {
    expect(OFFICE_SECTIONS).toEqual(['street', 'floor-2', 'floor-3', 'floor-4', 'floor-5', 'floor-6', 'floor-7', 'floor-8']);
    expect(OFFICE_FLOORS).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(OFFICE_TOP_FLOOR).toBe(8);
    expect(() => generateOfficeSection('floor-9', {levelSeed: 1})).toThrow();
  });

  it('is deterministic per level seed + section (and seeds differ per section)', () => {
    for (const s of ['street', 'floor-4', 'floor-8']) {
      const a = generateOfficeSection(s, {levelSeed: 4242, startWeapon: 'pistol'});
      const b = generateOfficeSection(s, {levelSeed: 4242, startWeapon: 'pistol'});
      expect(fingerprint(a)).toBe(fingerprint(b));
      expect(a.seed).toBe(sectionSeed(4242, s));
    }
    expect(fingerprint(gen(11, 'floor-3'))).not.toBe(fingerprint(gen(11, 'floor-4')));
    expect(fingerprint(gen(11, 'floor-3'))).not.toBe(fingerprint(gen(222, 'floor-3')));
  });

  it('every section validates: reachability, arrivals, elevator, stair doors, windows, populations, shared rules', () => {
    for (const levelSeed of LEVEL_SEEDS) for (const s of OFFICE_SECTIONS) {
      const l = gen(levelSeed, s);
      expect(officeIssues(l, towerFrame(levelSeed)), `${levelSeed} ${s}`).toEqual([]);
    }
  });

  it('the tower frame is shared: elevator cab / door / shaft, stairwell door and footprint at the same X/Z on every floor', () => {
    for (const levelSeed of LEVEL_SEEDS) {
      const infos = OFFICE_SECTIONS.map(s => gen(levelSeed, s).office!);
      const ref = infos[0];
      infos.forEach((o, i) => {
        expect(o.floor).toBe(i + 1);
        expect(o.floors).toEqual([...OFFICE_FLOORS]);
        expect(o.elevator.cab).toEqual(ref.elevator.cab);
        expect(o.elevator.door).toEqual(ref.elevator.door);
        expect(o.elevator.shaft).toEqual(ref.elevator.shaft);
        expect(o.elevator.doorSide).toBe('N');
        expect(o.exterior).toEqual(ref.exterior);
        expect(o.floorHeight).toBe(ref.floorHeight);
        expect(o.name).toBe(ref.name);
        const sd = o.stairDoors[0];
        expect([sd.x, sd.z]).toEqual([ref.stairDoors[0].x, ref.stairDoors[0].z]);
        expect(o.elevator.floorY).toBe(o.baseY);
        expect(gen(levelSeed, OFFICE_SECTIONS[i]).levels[o.levelId].baseY).toBe(o.baseY);
      });
      // Stair doors: up only in the lobby, down only on the top floor, both between.
      expect(infos[0].stairDoors.map(d => `${d.dir}${d.toFloor}`)).toEqual(['up2']);
      expect(infos[7].stairDoors.map(d => `${d.dir}${d.toFloor}`)).toEqual(['down7']);
      expect(infos[3].stairDoors.map(d => `${d.dir}${d.toFloor}`).sort()).toEqual(['down3', 'up5']);
      // Arrivals per kind.
      expect(Object.keys(infos[0].arrivals).sort()).toEqual(['elevator', 'stairs-down', 'start']);
      expect(Object.keys(infos[3].arrivals).sort()).toEqual(['elevator', 'stairs-down', 'stairs-up']);
      expect(Object.keys(infos[7].arrivals).sort()).toEqual(['elevator', 'stairs-up']);
      // Cab clear of walls / props, inside the shaft, facing the door.
      const l = gen(levelSeed, 'floor-5'), o = l.office!, g = l.levels[o.levelId].grid;
      for (let z = o.elevator.cab.z0 + 0.25; z < o.elevator.cab.z1; z += 0.5) for (let x = o.elevator.cab.x0 + 0.25; x < o.elevator.cab.x1; x += 0.5) {
        const [cx, cy] = g.cellOf(x, z);
        expect(g.walkable(cx, cy)).toBe(true);
      }
      expect(o.arrivals.elevator!.yaw).toBe(0);
      expect(o.elevator.door.z).toBe(o.elevator.cab.z0);
    }
  });

  it('every arrival walks to the elevator door, the stair door and every room of its storey', () => {
    for (const levelSeed of LEVEL_SEEDS) for (const s of ['street', 'floor-2', 'floor-8']) {
      const l = gen(levelSeed, s), o = l.office!;
      for (const [kind, p] of Object.entries(o.arrivals)) {
        const g0 = l.levels[p!.level].grid, [x, y] = g0.cellOf(p!.x, p!.z);
        const d = levelDistance(l.levels, x, y, p!.level);
        const gO = l.levels[o.levelId].grid;
        const at = (wx: number, wz: number) => { const [cx, cy] = gO.cellOf(wx, wz); return d[o.levelId][gO.idx(cx, cy)]; };
        expect(at(o.elevator.door.x, o.elevator.door.z - 0.6), `${s} ${kind} -> elevator door`).toBeGreaterThanOrEqual(0);
        const sd = o.stairDoors[0];
        expect(at(sd.x + Math.sin(sd.yaw) * 0.6, sd.z + Math.cos(sd.yaw) * 0.6), `${s} ${kind} -> stair door`).toBeGreaterThanOrEqual(0);
        for (const a of l.areas) {
          const lv = a.level ?? 0, g = l.levels[lv].grid;
          let ok = false;
          for (let yy = a.y; yy < a.y + a.h && !ok; yy++) for (let xx = a.x; xx < a.x + a.w && !ok; xx++) if (d[lv][g.idx(xx, yy)] >= 0) ok = true;
          if (!ok && a.role === 'stair') continue; // the run is reached through its twin cells
          expect(ok, `${s} ${kind} -> ${a.label}`).toBe(true);
        }
      }
    }
  });

  it('windows lie on the perimeter wall ring only, and the builder cuts exactly those spans out of the facade faces', () => {
    for (const levelSeed of LEVEL_SEEDS) for (const s of OFFICE_SECTIONS) {
      const l = gen(levelSeed, s), o = l.office!, f = towerFrame(levelSeed);
      expect(o.windows.length).toBeGreaterThan(15);
      expect(o.windows.filter(w => w.kind === 'entrance').length).toBe(s === 'street' ? 1 : 0);
      for (const w of o.windows) {
        const onRing = w.side === 'N' ? w.z0 === o.exterior.z0 : w.side === 'S' ? w.z1 === o.exterior.z1 : w.side === 'W' ? w.x0 === o.exterior.x0 : w.x1 === o.exterior.x1;
        expect(onRing, `${s} window ${JSON.stringify(w)}`).toBe(true);
        expect(Math.abs((w.side === 'N' || w.side === 'S' ? w.z1 - w.z0 : w.x1 - w.x0) - CELL)).toBeLessThan(1e-9);
        expect(w.head).toBeGreaterThan(w.sill);
      }
      expect(o.exterior).toEqual({x0: (MARGIN - 1) * CELL, z0: (MARGIN - 1) * CELL, x1: (MARGIN + f.TW + 1) * CELL, z1: (MARGIN + f.TD + 1) * CELL});
    }
    // Face cut: one facade face spanning the whole north wall loses exactly the window rectangle.
    const info = gen(11, 'floor-2').office!;
    const w = info.windows.find(q => q.side === 'N' && q.kind === 'window')!;
    const face = {level: info.levelId, x0: w.x0 - 2, z0: w.z1, x1: w.x1 + 2, z1: w.z1, y0: 0, y1: 2.9, openings: [], finish: 'paint'};
    const cut = cutOfficeWindows([face], {office: {...info, windows: [w]}});
    const area = (q: typeof face) => (q.x1 - q.x0) * (q.y1 - q.y0);
    expect(cut.length).toBe(4);
    expect(cut.reduce((s, q) => s + area(q), 0)).toBeCloseTo(area(face) - (w.x1 - w.x0) * (w.head - w.sill), 6);
    expect(cutOfficeWindows([face], {})).toEqual([face]);
  });

  it('street: a compact station about one sixth of the base Subway, its upper storey the lobby, joined by a real stair run', () => {
    const subway = [1, 7, 42, 1234, 99999].map(seed => levelMetrics(generateStation(seed)).walkM2.reduce((a, b) => a + b, 0));
    const subwayMean = subway.reduce((a, b) => a + b, 0) / subway.length;
    const streets = LEVEL_SEEDS.concat([7, 99, 512]).map(levelSeed => gen(levelSeed, 'street'));
    const station = streets.map(l => levelMetrics(l).walkM2[0]);
    const ratio = station.reduce((a, b) => a + b, 0) / station.length / subwayMean;
    process.stdout.write(`\n[office-gen] subway mean walk ${subwayMean.toFixed(0)} m2; street station walk ${station.join(', ')} m2; ratio ${ratio.toFixed(3)}\n`);
    expect(ratio).toBeGreaterThanOrEqual(0.12);
    expect(ratio).toBeLessThanOrEqual(0.22);
    for (const l of streets) {
      expect(l.levels.map(L => L.role)).toEqual(['main', 'upper']);
      expect(l.office!.levelId).toBe(1);
      expect(l.levels[1].baseY).toBe(l.office!.baseY);
      expect(l.levelLinks.filter(k => k.kind === 'stairs' && k.lower === 0 && k.upper === 1).length).toBe(1);
      const k = l.levelLinks[0];
      for (const L of l.levels) expect(L.grid.rampIdx[L.grid.idx(L.grid.ramps[k.ramp!].x, L.grid.ramps[k.ramp!].y)]).toBe(k.ramp);
      // The station side keeps the station program: island platform + two beds, fare line, washrooms, agent office, ladders.
      expect(l.platforms.length).toBe(1);
      expect(l.trenches.length).toBe(2);
      expect(l.doors.some(d => d.fare)).toBe(true);
      expect(l.areas.filter(a => a.type === 'washroom' && !a.level).length).toBeGreaterThanOrEqual(2);
      expect(l.areas.some(a => a.type === 'agent-office')).toBe(true);
      expect(l.traversal.ladders.length).toBeGreaterThanOrEqual(4);
      expect(l.office!.arrivals.start).toEqual({x: l.playerSpawn.x, z: l.playerSpawn.z, yaw: l.playerSpawn.yaw, level: 0});
      expect(l.areas[l.grid.area[l.grid.idx(...l.grid.cellOf(l.playerSpawn.x, l.playerSpawn.z))]].kind).toBe('platform');
    }
  });

  it('engine limits: at most 4 storeys per section and 3 open bands over any column', () => {
    for (const levelSeed of LEVEL_SEEDS) for (const s of OFFICE_SECTIONS) {
      const l = gen(levelSeed, s);
      expect(l.levels.length).toBeLessThanOrEqual(4);
      const n = l.grid.cells.length;
      for (let i = 0; i < n; i++) {
        let bands = 0;
        for (const L of l.levels) { const c = L.grid.cells[i]; if (c === FLOOR || c === VOID) bands++; }
        expect(bands).toBeLessThanOrEqual(3);
      }
      for (const L of l.levels) expect([L.grid.w, L.grid.h]).toEqual([l.grid.w, l.grid.h]);
    }
  });

  it('populations: 5-8 enemies in the street, 3-6 per office floor; scarce loose loot; no gear; known items / props', () => {
    let floorEnemies = 0, floors = 0, pickups = 0;
    for (const levelSeed of LEVEL_SEEDS) for (const s of OFFICE_SECTIONS) {
      const l = gen(levelSeed, s);
      const [lo, hi] = s === 'street' ? OFFICE_ENEMIES.street : OFFICE_ENEMIES.floor;
      expect(l.zombies.length).toBeGreaterThanOrEqual(lo);
      expect(l.zombies.length).toBeLessThanOrEqual(hi);
      if (s !== 'street') { floorEnemies += l.zombies.length; floors++; }
      expect(l.zombies.every(z => z.archetype === 'zombie' || z.archetype === 'ratdog')).toBe(true);
      pickups += l.pickups.length;
      expect(l.pickups.length).toBeLessThanOrEqual(8);
      for (const p of l.pickups) {
        expect(ITEMS[p.itemId], p.itemId).toBeDefined();
        expect(ITEMS[p.itemId].kind).not.toBe('gear');
      }
      for (const p of l.props) expect(PROP_DEFS[p.kind], p.kind).toBeDefined();
      // Office furniture and holders exist; cubicles on office floors.
      if (s !== 'street' && s !== 'floor-8') {
        expect(l.props.filter(p => p.kind === 'cubiclePartition').length, `${levelSeed} ${s}`).toBeGreaterThan(10);
        expect(l.props.filter(p => p.kind === 'desk').length, `${levelSeed} ${s}`).toBeGreaterThan(8);
      } else if (s === 'floor-8') expect(l.props.some(p => p.kind === 'desk')).toBe(true);
      else expect(l.props.some(p => p.kind === 'receptionDesk')).toBe(true);
      expect(l.props.some(p => isOfficeKind(p.kind))).toBe(true);
    }
    const mean = floorEnemies / floors;
    expect(mean).toBeGreaterThan(3);
    expect(mean).toBeLessThan(6);
    expect(pickups / (LEVEL_SEEDS.length * OFFICE_SECTIONS.length)).toBeLessThan(5);
  });

  it('weapon finds are planned once per level: at most 2 copies per non-start weapon over the whole tower', () => {
    for (const levelSeed of [1, 2, 3, 4, 5, 6, 7, 8]) for (const sw of ['rifle', 'pistol'] as const) {
      const plan = officeWeaponPlan(levelSeed, sw);
      expect(Object.keys(plan)).toEqual([...OFFICE_SECTIONS]);
      const all = Object.values(plan).flat();
      for (const w of new Set(all)) expect(all.filter(x => x === w).length).toBeLessThanOrEqual(2);
      expect(all.includes(sw)).toBe(false);
      expect(officeWeaponPlan(levelSeed, sw)).toEqual(plan);
    }
    const l = gen(222, 'street', 'rifle');
    expect(l.pickups.some(p => p.itemId === 'rifle')).toBe(false);
  });

  it('lighting: troffer grids, a lit elevator cab on every floor, dim cool fixture-less daylight at the windows', () => {
    for (const s of OFFICE_SECTIONS) {
      const l = gen(222, s), o = l.office!;
      const cab = l.lights.filter(q => q.area === o.elevator.area && !q.virtual);
      expect(cab.length).toBeGreaterThanOrEqual(1);
      expect(cab.every(q => !q.broken && !q.dying)).toBe(true);
      const day = l.lights.filter(q => q.virtual);
      expect(day.length).toBeGreaterThan(10);
      for (const q of day) {
        expect(q.broken || q.flicker || q.dying).toBe(false);
        expect(q.power).toBeLessThan(0.5);
        expect(q.tint).toBeDefined();
        expect(q.level ?? 0).toBe(o.levelId);
      }
      const real = l.lights.filter(q => !q.virtual);
      expect(real.some(q => q.broken)).toBe(true);
      expect(real.length).toBeLessThan(220);
    }
  });
});

describe('office sections build (world/builder.ts + world/officeProps.ts, Node, no GPU)', () => {
  installCanvasShim(false);
  const fakeEnv = (): Record<TextureKey, THREE.Texture> => {
    const out = {} as Record<TextureKey, THREE.Texture>;
    for (const k of Object.keys(TEXTURE_FILES) as TextureKey[]) out[k] = new THREE.Texture({width: 64, height: 64} as unknown as HTMLImageElement);
    return out;
  };
  it('builds the street and an office floor: office props, carpet / drop ceiling / reveals, window holes, hidden daylight fixtures', () => {
    for (const s of ['street', 'floor-3']) {
      const l = gen(222, s), o = l.office!;
      const mats = new WorldMaterials(fakeEnv(), 7, {w: 1.2, h: 0.19, d: 0.17});
      const w = buildWorld(l, mats, {});
      const names = new Set<string>();
      w.group.traverse(q => names.add(q.name));
      for (const n of ['office-carpet', 'office-drop-ceiling', 'office-window-reveals']) expect(names.has(n), `${s} ${n}`).toBe(true);
      expect([...names].some(n => n.startsWith('prop-officeChair'))).toBe(true);
      if (s !== 'street') expect(names.has('prop-cubiclePartition')).toBe(true);
      // No built wall face covers a window opening (sill..head) on the facade plane.
      for (const win of o.windows) {
        const alongX = win.side === 'N' || win.side === 'S';
        const plane = win.side === 'N' ? win.z1 : win.side === 'S' ? win.z0 : win.side === 'W' ? win.x1 : win.x0;
        const s0 = alongX ? win.x0 : win.z0, s1 = alongX ? win.x1 : win.z1, y0 = o.baseY + win.sill, y1 = o.baseY + win.head;
        for (const f of w.wallFaces) {
          const fx = Math.abs(f.z0 - f.z1) < 1e-9;
          if (fx !== alongX || Math.abs((fx ? f.z0 : f.x0) - plane) > 1e-6) continue;
          const a0 = Math.min(fx ? f.x0 : f.z0, fx ? f.x1 : f.z1), a1 = Math.max(fx ? f.x0 : f.z0, fx ? f.x1 : f.z1);
          const overlap = Math.min(a1, s1) - Math.max(a0, s0) > 1e-4 && Math.min(f.y1, y1) - Math.max(f.y0, y0) > 1e-4;
          expect(overlap, `${s} face over window ${JSON.stringify(win)}`).toBe(false);
        }
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
    }
  });
});

describe('the Subway is unchanged', () => {
  // Fingerprints of generateStation captured from git HEAD (1c71045) before any iteration-16 WORLD-GEN edit.
  const HEAD: Record<string, string> = {
    '1:rifle': '19be9008', '1:pistol': 'd5505377', '7:rifle': 'fb9cd7e2', '7:pistol': 'dfed84f8',
    '42:rifle': 'fe4cbb13', '42:pistol': '28419591', '1234:rifle': '8828e751', '1234:pistol': '6ef9c6fa',
  };
  it('generateStation output for existing seeds is byte-identical to HEAD', () => {
    for (const [key, fp] of Object.entries(HEAD)) {
      const [seed, sw] = key.split(':');
      const l = generateStation(Number(seed), {startWeapon: sw as 'rifle' | 'pistol'});
      expect(fingerprint(l), key).toBe(fp);
      expect(l.office).toBeUndefined();
      expect(l.props.some(p => isOfficeKind(p.kind))).toBe(false);
      expect(l.lights.some(q => q.virtual || q.tint)).toBe(false);
    }
  });
});
