// Task studio-surface-run-opus-rebuild-20261116-020827-01 (lane ACCESS): the way up / out of a Surface Run host station
// (gen/surface/access.ts, accessStair.ts, accessDoor.ts) through the level registry, with and without the station's surface version.
//  - presence <=> access: a station whose one roll is present gets its access at version 1, none at version 0 (a station visited before
//    the feature); an absent roll never does;
//  - RNG-neutral / append-only: the access-bearing layout equals the plain one except the appended access and the chosen exit hall's
//    documented in-place changes (Subway), one appended EXIT plate and the barricade pieces moved aside for a 1.2 m walk-up to the door
//    (Office), nothing (Mall: the usable exit is only named); a station without its access is byte-identical to the plain one;
//  - the Subway climb is a real stair: the station validator finds no new issue (every carved cell reachable, flights walkable, no prop
//    on the steps), ~9.5 m of STAIR flights to a top landing with the door, its return pose on the floor, clear of the ride tunnel;
//  - deterministic; the Mall's usable exit is drawn without its lock.
import {describe, expect, it} from 'vitest';
import {LEVELS} from '../src/levels/registry';
import {SURFACE_VERSION, surfacePresent, type SurfaceHost} from '../src/gen/surface/surfaceRun';
import {ACCESS_STAIR, surveySubwayAccess} from '../src/gen/surface/accessStair';
import {validateLayout, type StationLayout} from '../src/gen/station';
import {CELL, FLOOR} from '../src/gen/grid';
import {STAIR} from '../src/gen/traversal';
import {levelDistance} from '../src/gen/levelGen';
import {playerTrainPlacement} from '../src/gen/playerTrain';
import {RIDE_BOX, ridePortals} from '../src/world/ridePortal';
import {buildStreetExit, streetExitSpecs} from '../src/world/mallStreetExit';
import {installCanvasShim} from './helpers/canvas2d';
import {OFFICE_DOOR, OFFICE_PASSAGE} from '../src/gen/surface/accessDoor';
import {officePassageReport} from './helpers/officePassage';

const seeds = (host: SurfaceHost, present: boolean, n: number): number[] => {
  const out: number[] = [];
  for (let s = 1; out.length < n && s < 5000; s++) if (surfacePresent(host, s, SURFACE_VERSION) === present) out.push(s);
  return out;
};
const gen = (host: SurfaceHost, s: number, v?: number): StationLayout => LEVELS[host].generate('main', {levelSeed: s, ...(v !== undefined ? {surfaceVersion: v} : {})});
/** JSON-comparable copy (grids compared separately). */
const plain = (x: unknown) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));

describe('Surface Run access: presence', () => {
  for (const host of ['subway', 'office', 'mall'] as const) {
    it(`${host}: a present roll gets its access at version 1 only; an absent roll never`, () => {
      for (const s of seeds(host, true, 3)) {
        expect(gen(host, s, 1).surfaceAccess, `${host} ${s} v1`).toBeTruthy();
        expect(gen(host, s, 0).surfaceAccess, `${host} ${s} v0`).toBeUndefined();
        expect(gen(host, s).surfaceAccess, `${host} ${s} no version`).toBeUndefined();
      }
      for (const s of seeds(host, false, 2)) expect(gen(host, s, 1).surfaceAccess, `${host} ${s} absent`).toBeUndefined();
    }, 120_000);
  }

  it('subway: every one of 24 present stations finds room for its climb (nothing half-carved; 300 swept while building it)', () => {
    for (const s of seeds('subway', true, 24)) {
      const L = gen('subway', s, 1);
      expect(L.surfaceAccess?.kind, `seed ${s}`).toBe('subway-stair');
    }
  }, 240_000);
});

describe('Surface Run access: the Subway stairwell', () => {
  const S = seeds('subway', true, 3);

  it('append-only and RNG-neutral: everything of the plain station is unchanged except the opened hall', () => {
    for (const s of S) {
      const L0 = gen('subway', s), L1 = gen('subway', s, 1), a = L1.surfaceAccess!;
      expect(a.kind).toBe('subway-stair');
      const hall = a.hall!;
      // areas: the plain ones first (only the hall's label changes), the climb's appended
      expect(L1.areas.length).toBeGreaterThan(L0.areas.length);
      L0.areas.forEach((ar, i) => expect(plain({...L1.areas[i], label: i === hall ? ar.label : L1.areas[i].label}), `area ${i}`).toEqual(plain(ar)));
      expect(L1.areas[hall].label).not.toMatch(/closed/i);
      for (const id of a.areas.filter(id => id !== hall)) expect(id).toBeGreaterThanOrEqual(L0.areas.length);
      for (const k of ['doors', 'pickups', 'zombies', 'storefronts', 'decor', 'trenches', 'playerSpawn', 'levelLinks', 'hordes'] as const) expect(plain(L1[k]), k).toEqual(plain(L0[k]));
      // props: the same list; only the hall's grille block is retired
      expect(L1.props.length).toBe(L0.props.length);
      L0.props.forEach((p, i) => {
        const q = L1.props[i];
        if (p.kind === 'exitStair' && p.area === hall) { expect(q).toMatchObject({cargoGone: true, h: p.h, blocksSight: false, x: p.x, z: p.z}); return; }
        expect(plain(q), `prop ${i}`).toEqual(plain(p));
      });
      // lights / flights: a prefix of the plain list, appended after it
      expect(plain(L1.lights.slice(0, L0.lights.length))).toEqual(plain(L0.lights));
      expect(L1.lights.length).toBeGreaterThan(L0.lights.length);
      expect(plain(L1.traversal.stairs.slice(0, L0.traversal.stairs.length))).toEqual(plain(L0.traversal.stairs));
      // signs: two change in place (the hall's door sign, its grille notice), one plate appended
      expect(L1.signs.length).toBe(L0.signs.length + 1);
      const changed = L0.signs.map((g, i) => JSON.stringify(g) === JSON.stringify(L1.signs[i]) ? -1 : i).filter(i => i >= 0);
      expect(changed.length).toBe(2);
      expect(changed.map(i => L1.signs[i].text).sort()).toEqual([`${a.street!.toUpperCase()} · EXIT`, 'TO STREET'].sort());
      // grids: only the hall's far cells and the carved rock differ; every other storey grid is untouched
      const g0 = L0.grid, g1 = L1.grid, own = new Set(a.areas);
      for (let i = 0; i < g0.cells.length; i++) {
        if (g0.cells[i] !== g1.cells[i] || g0.floor[i] !== g1.floor[i] || g0.ceil[i] !== g1.ceil[i] || g0.area[i] !== g1.area[i]) expect(own.has(g1.area[i]), `cell ${i}`).toBe(true);
      }
      for (let k = 1; k < L0.levels.length; k++) {
        expect(Buffer.from(L1.levels[k].grid.cells).equals(Buffer.from(L0.levels[k].grid.cells))).toBe(true);
        expect(Buffer.from(L1.levels[k].grid.floor.buffer).equals(Buffer.from(L0.levels[k].grid.floor.buffer))).toBe(true);
      }
    }
  }, 120_000);

  it('a real climb: no new validator issue, STAIR flights ~9.5 m up, a top landing at the door, the return pose on it, reachable', () => {
    for (const s of S) {
      const L0 = gen('subway', s), L1 = gen('subway', s, 1), a = L1.surfaceAccess!;
      const base = new Set(validateLayout(L0));
      expect(validateLayout(L1).filter(x => !base.has(x))).toEqual([]);
      expect(a.rise!).toBeGreaterThanOrEqual(8);
      expect(a.rise!).toBeLessThanOrEqual(12);
      const fl = L1.traversal.stairs.slice(L0.traversal.stairs.length);
      expect(fl.length).toBeGreaterThanOrEqual(4);
      for (const f of fl) {
        expect(f.riser).toBeCloseTo(STAIR.riser, 6);
        expect(f.tread).toBeCloseTo(STAIR.tread, 6);
        expect(f.risers).toBeLessThanOrEqual(STAIR.maxRisers);
        expect(a.areas).toContain(f.area);
      }
      expect(Math.max(...fl.map(f => f.top.y))).toBeCloseTo(a.rise!, 4);
      const g = L1.grid, d = a.door!, p = a.returnPose;
      expect(d.y).toBeCloseTo(a.rise!, 4);
      expect(g.floorAt(p.x, p.z)).toBeCloseTo(p.y, 4);
      expect(g.circleClear(p.x, p.z, 0.4)).toBe(true);
      // the [E] box stands on the top landing in front of the door
      const tx = (a.trigger.x0 + a.trigger.x1) / 2, tz = (a.trigger.z0 + a.trigger.z1) / 2;
      expect(g.floorAt(tx, tz)).toBeCloseTo(a.rise!, 4);
      expect(a.trigger.y0).toBeLessThan(a.rise!);
      expect(a.trigger.y1).toBeGreaterThan(a.rise! + 1.8);
      // headroom for the door at the top
      expect(g.ceilAt(tx, tz)).toBeGreaterThanOrEqual(a.rise! + ACCESS_STAIR.vestibuleCeil - 1e-4);
      // reachable on foot from the player's spawn (the station's own reachability walk)
      const [sx, sy] = g.cellOf(L1.playerSpawn.x, L1.playerSpawn.z);
      const dist = levelDistance(L1.levels, sx, sy)[0];
      const [cx, cy] = g.cellOf(p.x, p.z);
      expect(dist[g.idx(cx, cy)]).toBeGreaterThan(0);
      for (const id of a.areas) {
        const ar = L1.areas[id];
        for (let y = ar.y; y < ar.y + ar.h; y++) for (let x = ar.x; x < ar.x + ar.w; x++) {
          const i = g.idx(x, y);
          if (g.cells[i] === FLOOR && !g.blocked[i]) expect(dist[i], `area ${id} cell ${x},${y}`).toBeGreaterThanOrEqual(0);
        }
      }
      // never where the player train's ride tunnel runs beyond the portals
      const tp = playerTrainPlacement(L1);
      if (tp) {
        const ports = ridePortals(L1, tp);
        for (const q of [ports.front, ports.rear]) for (const id of a.areas.filter(i => i !== a.hall)) {
          const ar = L1.areas[id], x0 = ar.x * CELL, x1 = (ar.x + ar.w) * CELL, z0 = ar.y * CELL, z1 = (ar.y + ar.h) * CELL;
          const qx0 = Math.min(q.x, q.x + q.out * 200), qx1 = Math.max(q.x, q.x + q.out * 200);
          expect(x1 > qx0 && x0 < qx1 && z1 > q.z - RIDE_BOX.half && z0 < q.z + RIDE_BOX.half, `area ${id} vs portal ${q.end}`).toBe(false);
        }
      }
    }
  }, 120_000);

  it('deterministic: the same station twice is the same climb; the planner weighs straight / turned / side shapes', () => {
    const s = S[0];
    const A = gen('subway', s, 1), B = gen('subway', s, 1);
    expect(plain(A.surfaceAccess)).toEqual(plain(B.surfaceAccess));
    expect(Buffer.from(A.grid.cells).equals(Buffer.from(B.grid.cells))).toBe(true);
    const shapes = new Set(surveySubwayAccess(gen('subway', s), s).map(c => c.shape.replace(/[+-]\d*$/, '')));
    expect([...shapes].sort()).toEqual(['side', 'straight', 'turn']);
  }, 60_000);
});

describe('Surface Run access: Office / Mall street doors', () => {
  it('office: the makeshift door in the boarded lobby entrance; one EXIT plate appended; a 1.2 m walk-up through the barricade', () => {
    // (follow-up 1) the barricade pieces in front of the door are MOVED aside (same index / kind / rotation / height; legal, grounded,
    // no overlap, no cell cut off, no new validator issue) — tests/helpers/officePassage.ts; 100 present seeds swept while building it
    let moved = 0;
    for (const s of seeds('office', true, 4)) {
      const L0 = gen('office', s), L1 = gen('office', s, 1), a = L1.surfaceAccess!;
      expect(a.kind).toBe('office-door');
      const ent = L1.office!.windows.find(w => w.kind === 'entrance')!;
      expect(a.door!.level).toBe(ent.level);
      expect(a.door!.x - OFFICE_DOOR.w / 2).toBeGreaterThan(ent.x0);
      expect(a.door!.x + OFFICE_DOOR.w / 2).toBeLessThan(ent.x1);
      expect(a.door!.z).toBeCloseTo(ent.z1, 6);
      expect(a.door!.y).toBeCloseTo(ent.baseY, 6);
      const r = officePassageReport(L0, L1);
      expect(r.problems, `seed ${s}`).toEqual([]);
      moved += r.moved.length;
      for (const i of r.moved) expect(OFFICE_PASSAGE.kinds as readonly string[], `seed ${s} prop ${i}`).toContain(L1.props[i].kind);
      const g = L1.levels[a.returnPose.level].grid, p = a.returnPose;
      expect(g.walkable(...g.cellOf(p.x, p.z))).toBe(true);
      expect(g.circleClear(p.x, p.z, 0.45)).toBe(true);
      expect(p.y).toBeCloseTo(ent.baseY, 6);
    }
    expect(moved, 'the barricade stood in front of the door: pieces were moved').toBeGreaterThan(0);
  }, 120_000);

  it('office: a light loose prop in the walk-up is slid aside only when the barricade alone cannot open one (seed 91)', () => {
    expect(surfacePresent('office', 91, SURFACE_VERSION)).toBe(true);
    const L0 = gen('office', 91), L1 = gen('office', 91, 1), r = officePassageReport(L0, L1);
    expect(r.problems).toEqual([]);
    expect(r.moved.map(i => L1.props[i].kind).filter(k => (OFFICE_PASSAGE.loose as readonly string[]).includes(k))).toEqual(['wetFloorSign']);
  }, 60_000);

  it('a station without its access is byte-identical to the plain one (absent roll at version 1, present roll at version 0)', () => {
    const bytes = (L: StationLayout) => JSON.stringify(L, (_k, v) => (ArrayBuffer.isView(v) ? Buffer.from(v.buffer, v.byteOffset, v.byteLength).toString('base64') : v));
    for (const host of ['subway', 'office', 'mall'] as const) {
      for (const s of seeds(host, false, 1)) expect(bytes(gen(host, s, 1)) === bytes(gen(host, s)), `${host} ${s} absent`).toBe(true);
      for (const s of seeds(host, true, 1)) expect(bytes(gen(host, s, 0)) === bytes(gen(host, s)), `${host} ${s} v0`).toBe(true);
    }
  }, 120_000);

  it('mall: one street exit named usable (hashed), the layout otherwise identical; drawn without its lock, same four meshes', () => {
    for (const s of seeds('mall', true, 2)) {
      const L0 = gen('mall', s), L1 = gen('mall', s, 1), a = L1.surfaceAccess!;
      expect(a.kind).toBe('mall-door');
      const e = L1.mall!.exits!.find(x => x.id === a.exit)!;
      expect(e).toBeTruthy();
      for (const k of ['areas', 'doors', 'props', 'lights', 'signs', 'pickups', 'zombies'] as const) expect(plain(L1[k]), k).toEqual(plain(L0[k]));
      expect(plain(L1.mall)).toEqual(plain(L0.mall));
      const p = a.returnPose, g = L1.levels[p.level].grid;
      expect(p.level).toBe(e.level);
      expect(g.walkable(...g.cellOf(p.x, p.z))).toBe(true);
      const specs = streetExitSpecs(L1, () => NaN);
      expect(specs.filter(x => x.usable).map(x => x.id)).toEqual([a.exit]);
      expect(streetExitSpecs(L0, () => NaN).some(x => x.usable)).toBe(false);
      const sp = specs.find(x => x.id === a.exit)!;
      const restore = installCanvasShim(false); // (the street atlas is a canvas texture)
      let open: ReturnType<typeof buildStreetExit>, locked: ReturnType<typeof buildStreetExit>;
      try { open = buildStreetExit(sp); locked = buildStreetExit({...sp, usable: undefined}); } finally { restore(); }
      expect(open.meshes.map(m => m.name).sort()).toEqual(locked.meshes.map(m => m.name).sort());
      const verts = (v: typeof open, k: string) => v.meshes.find(m => m.name.endsWith(k))!.geometry.getAttribute('position').count;
      expect(verts(open, 'frame')).toBeLessThan(verts(locked, 'frame')); // no chain, padlock, notices, board, lit face
      expect(verts(open, 'street')).toBe(verts(locked, 'street')); // (the seeded street beyond is the same)
    }
  }, 120_000);
});
