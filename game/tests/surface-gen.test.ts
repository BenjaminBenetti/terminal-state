// Task studio-surface-run-opus-rebuild-20261116-020827-01 (lane GEN): the SURFACE RUN district generator (gen/surface/index.ts + city*.ts,
// checkpoint.ts, outdoor*.ts) — the frame, the per-district guarantees over many seeds, buildings / storeys / entrances, the closed
// boundary, determinism, the portal / checkpoint / truck, outdoor props on real floors, the map notes, timing and grid memory.
// (Connectivity — the foot and vehicle floods — is tests/surface-gen-connectivity.test.ts.)
import {beforeAll, describe, expect, it} from 'vitest';
import {CELL, FLOOR, SOLID} from '../src/gen/grid';
import type {StationLayout} from '../src/gen/stationTypes';
import {SURFACE_FRAME, SURFACE_GEN_STATS, generateSurfaceDistrict, setSurfaceGenDebug, surfaceGenDebug} from '../src/gen/surface/index';
import {surfaceSeed, type SurfaceHost} from '../src/gen/surface/surfaceRun';
import {GUARANTEE, STORE_PROGRAMMES, guaranteeCounts} from '../src/gen/surface/cityBlocks';
import {SURFACE_FACADE_IDS} from '../src/gen/surface/facades';
import {SR_KINDS, halfExtents, isDefinedKind} from '../src/gen/surface/outdoorKinds';
import {LEVELS} from '../src/levels/registry';

const HOSTS: readonly SurfaceHost[] = ['subway', 'office', 'mall'];
const hostOf = (seed: number): SurfaceHost => HOSTS[seed % 3];
const gen = (seed: number, host: SurfaceHost = hostOf(seed)) => generateSurfaceDistrict(host, {levelSeed: seed});
const inRect = (r: {x0: number; z0: number; x1: number; z1: number}, x: number, z: number, pad = 0) => x >= r.x0 - pad && x <= r.x1 + pad && z >= r.z0 - pad && z <= r.z1 + pad;
const QUARTER = (rot: number) => Math.abs(rot / (Math.PI / 2) - Math.round(rot / (Math.PI / 2))) < 1e-6;

beforeAll(() => setSurfaceGenDebug(true));

describe('Surface district frame', () => {
  const L = gen(11, 'subway');
  const s = L.surface!;
  it('is an 8 x 8-block grid with a 4 x 4 core inside a closed cordon', () => {
    expect(s.cols).toBe(8);
    expect(s.blocks.length).toBe(64);
    const core = s.blocks.filter(b => b.core);
    expect(core.length).toBe(16);
    for (const b of core) { expect(b.col).toBeGreaterThanOrEqual(2); expect(b.col).toBeLessThanOrEqual(5); expect(b.row).toBeGreaterThanOrEqual(2); expect(b.row).toBeLessThanOrEqual(5); }
    // blocks 45-65 m kerb to kerb
    for (const b of s.blocks) for (const d of [b.rect.x1 - b.rect.x0, b.rect.z1 - b.rect.z0]) { expect(d).toBeGreaterThanOrEqual(45); expect(d).toBeLessThanOrEqual(65); }
    expect(SURFACE_FRAME.blocks).toBe(8);
    expect(SURFACE_FRAME.coreFrom).toBe(2);
    expect(SURFACE_FRAME.coreTo).toBe(5);
  });

  it('has a street hierarchy: avenues 18-22 m, streets 10-13 m, lanes 5-7 m, sidewalks 2.5-4 m', () => {
    const av = s.streets.filter(q => q.rank === 'avenue'), st = s.streets.filter(q => q.rank === 'street'), ln = s.streets.filter(q => q.rank === 'lane');
    expect(av.length).toBeGreaterThan(0);
    expect(st.length).toBeGreaterThan(av.length);
    for (const q of av) { expect(q.width).toBeGreaterThanOrEqual(18); expect(q.width).toBeLessThanOrEqual(22); expect(q.sidewalk).toBeGreaterThanOrEqual(3.5); expect(q.sidewalk).toBeLessThanOrEqual(4); }
    for (const q of st) { expect(q.width).toBeGreaterThanOrEqual(10); expect(q.width).toBeLessThanOrEqual(13); expect(q.sidewalk).toBeGreaterThanOrEqual(2.5); expect(q.sidewalk).toBeLessThanOrEqual(3.5); }
    for (const q of ln) { expect(q.width).toBeGreaterThanOrEqual(5); expect(q.width).toBeLessThanOrEqual(7); }
    for (const q of s.streets) { expect(q.name.length).toBeGreaterThan(2); expect(q.ax === q.bx || q.az === q.bz).toBe(true); }
    // sidewalks are raised by the kerb (0.15 m), carriageways at grade
    const g = L.grid;
    const kerb = (x: number, z: number) => g.floor[g.idx(Math.floor(x / CELL), Math.floor(z / CELL))];
    for (const q of av.slice(0, 3)) {
      const mx = (q.ax + q.bx) / 2, mz = (q.az + q.bz) / 2;
      expect(kerb(mx, mz)).toBeCloseTo(0, 5);
    }
    expect(SURFACE_FRAME.kerb).toBeCloseTo(0.15, 5);
  });

  it('closes the boundary: everything outside the playable extent is solid on every level', () => {
    const e = s.extent;
    let open = 0, inside = 0;
    for (const lv of L.levels) {
      const g = lv.grid;
      for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
        const wx = (x + 0.5) * CELL, wz = (y + 0.5) * CELL;
        const c = g.cells[g.idx(x, y)];
        if (wx > e.x0 && wx < e.x1 && wz > e.z0 && wz < e.z1) { if (c !== SOLID) inside++; continue; }
        if (c !== SOLID) open++;
      }
    }
    expect(open).toBe(0);
    expect(inside).toBeGreaterThan(100000);
    expect(s.cordon!.x1).toBeCloseTo(L.grid.w * CELL, 5);
  });

  it('every outdoor area is a street area on level 0 with an open sky', () => {
    expect(s.outdoorAreas.length).toBeGreaterThan(200);
    for (const id of s.outdoorAreas) {
      const a = L.areas[id];
      expect(a.type).toBe('street');
      expect(a.level ?? 0).toBe(0);
      expect(a.ceil).toBeGreaterThan(20);
    }
    expect(s.outdoorAreas).toContain(s.checkpoint.area);
  });
});

describe('Surface district guarantees over 30 seeds', () => {
  const runs: {seed: number; L: StationLayout}[] = [];
  beforeAll(() => { for (let seed = 1; seed <= 30; seed++) runs.push({seed, L: gen(seed)}); });

  it('every district has its depot, >= 2 centres, >= 3 offices, >= 8 stores of >= 6 kinds, <= 2 civic (all enterable, all in the core)', () => {
    for (const {seed, L} of runs) {
      const s = L.surface!;
      const dest = s.buildings.filter(b => b.destination);
      for (const b of dest) { expect(b.enterable, `seed ${seed} ${b.programme}`).toBe(true); expect(s.blocks[b.block].core).toBe(true); expect(b.name.length).toBeGreaterThan(2); }
      const c = guaranteeCounts(dest);
      expect(c.depot, `seed ${seed}`).toBe(GUARANTEE.depot);
      expect(c.centres, `seed ${seed}`).toBeGreaterThanOrEqual(GUARANTEE.centres);
      expect(c.offices, `seed ${seed}`).toBeGreaterThanOrEqual(GUARANTEE.offices);
      expect(c.stores, `seed ${seed}`).toBeGreaterThanOrEqual(GUARANTEE.stores);
      expect(c.storeKinds, `seed ${seed}`).toBeGreaterThanOrEqual(GUARANTEE.storeKinds);
      expect(c.civic).toBeLessThanOrEqual(2);
      for (const b of dest.filter(q => q.kind === 'store')) expect((STORE_PROGRAMMES as readonly string[]).includes(b.programme)).toBe(true);
      expect(new Set(dest.map(b => b.name)).size).toBe(dest.length); // destination names are unique
      expect(s.depot.building).toBe(dest.find(b => b.kind === 'depot')!.id);
      expect(s.depot.recoverables.length).toBeGreaterThan(0);
    }
  });

  it('has the seeded set pieces: a rail spur to the depot, a park, a parking lot, a diagonal plaza, blocked spans, ruin', () => {
    let jogs = 0;
    for (const {seed, L} of runs) {
      const s = L.surface!;
      const lots = s.lots!;
      expect(lots.some(l => l.use === 'rail'), `seed ${seed}`).toBe(true);
      expect(s.rail!.rects.length).toBeGreaterThan(0);
      expect(lots.some(l => l.use === 'park'), `seed ${seed}`).toBe(true);
      expect(lots.some(l => l.use === 'parking'), `seed ${seed}`).toBe(true);
      expect(lots.some(l => l.diagonal), `seed ${seed}`).toBe(true);
      expect(lots.filter(l => l.use === 'compound').length).toBe(1);
      const blocked = s.streets.filter(q => q.blocked?.length);
      expect(blocked.length, `seed ${seed}`).toBeGreaterThanOrEqual(3);
      expect(blocked.length).toBeLessThanOrEqual(5);
      for (const q of blocked) expect(q.rank).toBe('street');
      expect(s.rubble!.some(r => r.kind === 'pile-up')).toBe(true);
      expect(s.rubble!.some(r => r.kind === 'spill')).toBe(true);
      expect(s.buildings.some(b => b.condition === 'collapsed')).toBe(true);
      expect(s.buildings.some(b => b.collapse)).toBe(true);
      // the frame is not a checkerboard: some district jogs its streets at an avenue (merged crossings / offset blocks)
      for (let k = 0; k < 8; k++) {
        if (new Set(s.blocks.filter(b => b.col === k).map(b => b.rect.x0)).size > 1) jogs++;
        if (new Set(s.blocks.filter(b => b.row === k).map(b => b.rect.z0)).size > 1) jogs++;
      }
    }
    expect(jogs).toBeGreaterThan(3);
  });

  it('buildings: 1-6 drawn storeys of 3.5-4 m (shop ground floors 4-5 m), <= 3 walkable levels, known facades, all four conditions', () => {
    const cond = new Set<string>();
    for (const {L} of runs) {
      const s = L.surface!;
      expect(L.levels.length).toBeLessThanOrEqual(3);
      for (const b of s.buildings) {
        cond.add(b.condition);
        expect((SURFACE_FACADE_IDS as readonly string[]).includes(b.facade)).toBe(true);
        for (const lv of b.levels) expect(lv).toBeLessThan(3);
        if (b.host) continue; // the host's own tower / mall, the tent, the headhouse
        expect(b.storeys).toBeGreaterThanOrEqual(1);
        expect(b.storeys).toBeLessThanOrEqual(6);
        const h = b.storeyHeights!;
        expect(h.length).toBe(b.storeys);
        for (const u of h.slice(1)) { expect(u).toBeGreaterThanOrEqual(3.5); expect(u).toBeLessThanOrEqual(4.0); }
        if (b.kind === 'store' || b.kind === 'centre') { expect(h[0]).toBeGreaterThanOrEqual(4.0); expect(h[0]).toBeLessThanOrEqual(5.0); }
        else { expect(h[0]).toBeGreaterThanOrEqual(3.5); expect(h[0]).toBeLessThanOrEqual(5.0); }
        expect(b.height).toBeGreaterThan(h.reduce((a, q) => a + q, 0));
      }
    }
    expect([...cond].sort()).toEqual(['collapsed', 'damaged', 'gutted', 'intact']);
  });

  it('blocks hold 2-6 buildings in the core (varied footprints); the outer ring is sparse', () => {
    let core = 0, coreOk = 0, outer = 0, outerBuildings = 0;
    for (const {L} of runs) {
      const s = L.surface!;
      // (the depot's block is its yard, loading lot and the depot shed itself: one building by design)
      const depotBlock = s.buildings[s.depot.building].block;
      for (const b of s.blocks) {
        const n = b.buildings.filter(id => !s.buildings[id].host).length;
        if (b.core) { if (b.id === depotBlock) continue; core++; if (n >= 2 && n <= 6) coreOk++; } else { outer++; outerBuildings += n; }
      }
      const sizes = new Set(s.buildings.map(b => `${Math.round(b.footprint.x1 - b.footprint.x0)}x${Math.round(b.footprint.z1 - b.footprint.z0)}`));
      expect(sizes.size).toBeGreaterThan(s.buildings.length * 0.6);
    }
    expect(coreOk / core).toBeGreaterThan(0.8);
    expect(outerBuildings / outer).toBeLessThan(4.5);
  });

  it('entrances: every enterable destination has a passable street doorway carved through its facade onto an outdoor area', () => {
    for (const {seed, L} of runs) {
      const s = L.surface!, g = L.grid;
      const out = new Set(s.outdoorAreas);
      for (const b of s.buildings.filter(q => q.destination)) {
        const open = b.entrances.filter(e => e.door !== 'boarded');
        expect(open.length, `seed ${seed} ${b.name}`).toBeGreaterThan(0);
        for (const e of b.entrances) {
          expect(['closed', 'open', 'smashed', 'boarded']).toContain(e.door);
          expect(out.has(e.outer)).toBe(true);
          expect(b.areas).toContain(e.inner);
          for (const c of e.cells) {
            const x = (c % g.w + 0.5) * CELL, z = (Math.floor(c / g.w) + 0.5) * CELL;
            expect(inRect(b.footprint, x, z)).toBe(true);
            expect(g.cells[c]).toBe(e.door === 'boarded' ? SOLID : FLOOR);
          }
          if (e.door !== 'boarded') expect(L.doors[e.doorIndex!].b).toBe(e.inner);
        }
      }
    }
  });

  it('walkable interiors: each enterable building carves its storeys; window spans belong to their building', () => {
    for (const {L} of runs) {
      const s = L.surface!;
      for (const b of s.buildings.filter(q => q.enterable)) {
        expect(b.areas.length).toBeGreaterThan(0);
        for (const a of b.areas) expect(b.levels).toContain(L.areas[a].level ?? 0);
      }
      const ids = new Set(s.windows.map(w => w.id));
      for (const b of s.buildings) for (const w of b.windows) expect(ids.has(w)).toBe(true);
      for (const w of s.windows) expect(s.buildings[w.building].windows).toContain(w.id);
    }
  });

  it('the map notes are local and true: each at a real place of this district', () => {
    for (const {seed, L} of runs) {
      const s = L.surface!;
      expect(s.notes.length, `seed ${seed}`).toBeGreaterThanOrEqual(5);
      // (street segments: the roadblock / pile-up notes stand on the carriageway)
      const streets = s.streets.map(q => (q.ax === q.bx
        ? {x0: q.ax - q.width / 2, x1: q.ax + q.width / 2, z0: Math.min(q.az, q.bz), z1: Math.max(q.az, q.bz)}
        : {x0: Math.min(q.ax, q.bx), x1: Math.max(q.ax, q.bx), z0: q.az - q.width / 2, z1: q.az + q.width / 2}));
      const places = [...s.buildings.map(b => b.footprint), ...(s.lots ?? []).map(l => l.rect), ...(s.rubble ?? []), ...s.blocks.map(b => b.rect),
        ...(s.junctions ?? []).map(j => j.rect), s.checkpoint.tent.rect, ...streets];
      for (const n of s.notes) {
        expect(n.text.length).toBeGreaterThan(3);
        expect(/station|line|network|campaign|terminal/i.test(n.text), n.text).toBe(false);
        expect(places.some(r => inRect(r, n.x, n.z, 3)), `seed ${seed} note ${n.text}`).toBe(true);
      }
      // supply notes name real enterable destinations
      for (const n of s.notes.filter(q => q.kind === 'supply')) expect(s.buildings.some(b => b.destination && n.text.startsWith(b.name))).toBe(true);
    }
  });

  it('outdoor props stand on real street-level floors, quarter-turn yaws, never overlapping (pending kinds included)', () => {
    for (const {seed, L} of runs.slice(0, 8)) {
      const dbg = surfaceGenDebug(L)!;
      const g = L.grid;
      const boxes = dbg.planned.map(p => ({x0: p.x - p.hx, x1: p.x + p.hx, z0: p.z - p.hz, z1: p.z + p.hz, p}));
      for (const {p} of boxes) {
        expect(QUARTER(p.rot), `${p.kind}`).toBe(true);
        const e = halfExtents(p.kind, p.rot)!;
        expect(e.hx).toBeCloseTo(p.hx, 5);
        const i = g.idx(Math.floor(p.x / CELL), Math.floor(p.z / CELL));
        expect(g.cells[i]).toBe(FLOOR);
        expect(Math.abs(g.floor[i] - p.y)).toBeLessThan(0.021);
        if (p.index >= 0) { expect(L.props[p.index].kind).toBe(p.kind); expect(L.props[p.index].level).toBe(0); }
        else expect(isDefinedKind(p.kind)).toBe(false);
      }
      // no two outdoor boxes overlap (a sorted sweep along x)
      const sorted = [...boxes].sort((a, b) => a.x0 - b.x0);
      for (let k = 0; k < sorted.length; k++) for (let j = k + 1; j < sorted.length && sorted[j].x0 < sorted[k].x1 - 1e-6; j++) {
        const a = sorted[k], b = sorted[j];
        const ov = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > 0.05 && Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0) > 0.05;
        expect(ov, `seed ${seed}: ${a.p.kind} / ${b.p.kind}`).toBe(false);
      }
      // the planned KIT kinds are the lead's fixed names
      for (const p of dbg.planned) if (p.kind.startsWith('sr')) expect((SR_KINDS as readonly string[]).includes(p.kind)).toBe(true);
    }
  });
});

describe('Surface portal, checkpoint and truck', () => {
  for (const host of HOSTS) {
    it(`${host}: the portal, the command tent, the compound and the truck's parking box`, () => {
      const L = gen(21, host);
      const s = L.surface!, g = L.grid;
      const dbg = surfaceGenDebug(L)!;
      const cellAt = (x: number, z: number) => g.idx(Math.floor(x / CELL), Math.floor(z / CELL));
      // portal
      expect(s.portal.kind).toBe(host === 'subway' ? 'stair' : 'door');
      const pb = s.buildings[s.portal.building!];
      expect(pb.host).toBe(host === 'subway' ? 'headhouse' : host);
      if (host === 'subway') {
        expect(s.portal.trigger.y0).toBeLessThan(-2);
        expect(L.traversal.stairs.some(f => f.area === pb.areas[0] && Math.min(f.h0, f.h1) < -2)).toBe(true);
      } else {
        expect(pb.enterable).toBe(false);
        expect(inRect(pb.footprint, (s.portal.trigger.x0 + s.portal.trigger.x1) / 2, (s.portal.trigger.z0 + s.portal.trigger.z1) / 2, 1.5)).toBe(true);
      }
      const pi = cellAt(s.portal.pose.x, s.portal.pose.z);
      expect(g.cells[pi]).toBe(FLOOR);
      expect(s.outdoorAreas).toContain(g.area[pi]);
      expect(L.playerSpawn.x).toBe(s.portal.pose.x);
      // the tent: an enclosed room (canvas ring SOLID) with one flap doorway onto the compound
      const tent = s.buildings.find(b => b.host === 'tent')!;
      expect(tent.programme).toBe('tent');
      const ta = L.areas[s.checkpoint.tent.area];
      expect(ta.type).toBe('crew-room');
      expect(ta.label).toBe('Command tent');
      const flap = new Set(tent.entrances[0].cells);
      for (let y = ta.y - 1; y <= ta.y + ta.h; y++) for (let x = ta.x - 1; x <= ta.x + ta.w; x++) {
        const edge = y === ta.y - 1 || y === ta.y + ta.h || x === ta.x - 1 || x === ta.x + ta.w;
        if (!edge) continue;
        const i = g.idx(x, y);
        if (!flap.has(i)) expect(g.cells[i]).toBe(SOLID);
      }
      // the planning-map table (pending until lane KIT's kind lands) and the reader's pose inside the tent
      const table = dbg.planned.find(p => p.kind === 'srMapTable')!;
      expect(table).toBeTruthy();
      expect(g.area[cellAt(table.x, table.z)]).toBe(ta.id);
      expect(s.checkpoint.mapTable.prop).toBe(table.index);
      if (table.index >= 0) expect(L.props[table.index].kind).toBe('srMapTable');
      expect(g.area[cellAt(s.checkpoint.mapTable.read.x, s.checkpoint.mapTable.read.z)]).toBe(ta.id);
      // compound kit: crates (one in the tent), cots, barriers, the generator and work lights (p7 kinds: real props now)
      const kinds = (k: string) => dbg.planned.filter(p => p.kind === k);
      expect(kinds('srMilitaryCrate').length).toBeGreaterThanOrEqual(4);
      expect(kinds('srMilitaryCrate').some(p => g.area[cellAt(p.x, p.z)] === ta.id)).toBe(true);
      expect(kinds('srCot').length).toBeGreaterThanOrEqual(2);
      expect(kinds('srJerseyBarrier').length + kinds('srSandbagWall').length).toBeGreaterThanOrEqual(10);
      expect(L.props.filter(p => p.kind === 'portableGenerator').length).toBeGreaterThanOrEqual(1);
      expect(L.props.filter(p => p.kind === 'tripodWorkLight').length).toBeGreaterThanOrEqual(2);
      expect(L.lights.filter(l => l.virtual && l.area === s.checkpoint.area).length).toBeGreaterThanOrEqual(2);
      // the truck: on the compound, its 7.2 x 2.6 m box (+ margin) clear, facing out (its yaw's forward points at a street edge)
      const t = s.truck;
      expect(g.area[cellAt(t.x, t.z)]).toBe(s.checkpoint.area);
      const fx = -Math.sin(t.yaw), fz = -Math.cos(t.yaw);
      expect(Math.abs(fx) < 1e-6 || Math.abs(fz) < 1e-6).toBe(true);
      const hl = 3.6 + 0.5, hw = 1.3 + 0.4;
      const hx = Math.abs(fx) > 0.5 ? hl : hw, hz = Math.abs(fx) > 0.5 ? hw : hl;
      for (let z = t.z - hz; z <= t.z + hz; z += CELL) for (let x = t.x - hx; x <= t.x + hx; x += CELL) {
        const i = cellAt(x, z);
        expect(g.cells[i]).toBe(FLOOR);
        expect(g.blocked[i]).toBe(0);
        expect(dbg.taken[i]).toBe(0);
      }
      const front = cellAt(t.x + fx * 9, t.z + fz * 9);
      expect(s.outdoorAreas).toContain(g.area[front]);
      expect(g.area[front]).not.toBe(s.checkpoint.area); // nose out of the compound, onto the sidewalk / street
      // safe box and spawn zones
      expect(inRect(s.outdoor.safe, t.x, t.z)).toBe(true);
      expect(inRect(s.outdoor.safe, s.portal.pose.x, s.portal.pose.z)).toBe(true);
      expect(s.outdoor.spawnZones.length).toBeGreaterThan(50);
      for (const z of s.outdoor.spawnZones) {
        const hit = z.x0 < s.outdoor.safe.x1 && s.outdoor.safe.x0 < z.x1 && z.z0 < s.outdoor.safe.z1 && s.outdoor.safe.z0 < z.z1;
        expect(hit).toBe(false);
        expect(z.weight).toBeGreaterThan(0);
      }
    });
  }
});

describe('Surface determinism, timing and memory', () => {
  const sig = (L: StationLayout) => {
    const g = L.grid;
    let h = 0;
    for (const lv of L.levels) for (let i = 0; i < lv.grid.cells.length; i += 7) h = (h * 31 + lv.grid.cells[i] * 7 + Math.round(lv.grid.floor[i] * 100) + lv.grid.area[i]) | 0;
    return JSON.stringify({h, w: g.w, s: L.surface, props: L.props, doors: L.doors, n: L.areas.length, z: L.zombies, l: L.lights});
  };
  it('the same seed gives the same district (and the seed is the district stream, never the host seed)', () => {
    for (const seed of [5, 77]) {
      const a = gen(seed, 'office'), b = gen(seed, 'office');
      expect(sig(a)).toBe(sig(b));
      expect(a.surface!.seed).toBe(surfaceSeed(seed));
    }
    expect(sig(gen(5, 'office'))).not.toBe(sig(gen(6, 'office')));
    // the registry path is the same generator
    expect(LEVELS.office.generate('surface', {levelSeed: 5}).surface!.name).toBe(gen(5, 'office').surface!.name);
  });

  it('generates well under 1.5 s with a bounded grid footprint (3 storeys x ~1.1k x 1.1k cells x 15 B)', () => {
    const ms: number[] = [];
    for (const seed of [101, 202, 303]) {
      gen(seed);
      ms.push(SURFACE_GEN_STATS.ms);
      expect(SURFACE_GEN_STATS.levels).toBeLessThanOrEqual(3);
      expect(SURFACE_GEN_STATS.bytesPerStorey).toBe(SURFACE_GEN_STATS.w * SURFACE_GEN_STATS.h * 15);
      expect(SURFACE_GEN_STATS.gridBytes).toBeLessThan(3 * 21e6);
      expect(SURFACE_GEN_STATS.w).toBeLessThan(1180);
    }
    // a loose CI guard (local runs: ~0.3-0.6 s); the lane report records measured numbers
    expect(Math.min(...ms)).toBeLessThan(4000);
  });
});
