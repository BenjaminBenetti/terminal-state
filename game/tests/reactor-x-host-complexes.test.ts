// Task reactor-expansion-20261101 (lane HOST): THE SIDE-COMPLEX HOST of the Reactor generator (gen/reactor/complex/host.ts) — the
// slots (free rock beside the pit, entrance facing a deck, canvas growth), the shipped null stubs (today's valid level), and the host
// path end to end with a SAMPLE carver (tests/reactor-x-host-fixture.ts, never shipped): generator moved into the complex, cable
// out through the entrance, layout.reactor.complexes, stairs-only reach to the use point through the entrance, the no-deadlock air
// rule, determinism, generation time, the "substantial" floor. Focused (no browser).
import {describe, expect, it} from 'vitest';
import {generateReactorLevel, reactorFrame, reactorIssues, reactorSeed, REACTOR_GEN_STATS, REACTOR_LEVELS} from '../src/gen/reactor/index';
import {carveReactor, reactorCanvas} from '../src/gen/reactor/carve';
import {COMPLEX_HOST_STATS, COMPLEX_SLOT, complexIssues} from '../src/gen/reactor/complex/host';
import {COMPLEX_OF_ZONE} from '../src/gen/reactor/complex/types';
import {GENSET, ORG} from '../src/gen/reactor/frame';
import {Kit} from '../src/gen/stationKit';
import {Rng} from '../src/core/rng';
import {CELL, FLOOR, SOLID} from '../src/gen/grid';
import {SLAB, levelDistance} from '../src/gen/levelGen';
import type {StationLayout} from '../src/gen/stationTypes';
import {GAS} from '../src/world/gas/field';
import {CROUCH_EYE, STAND_EYE} from '../src/player/player';
import {ReactorAir} from '../src/world/reactor/air';
import {emptyReactorState} from '../src/world/reactor/runState';
import {layoutRect} from '../src/world/reactor/generators';
import {btsAreaPresent} from '../src/gen/trackExt/index';
import {sampleCarver} from './reactor-x-host-fixture';
import {CEILING_CABLE, ceilingCableIssues} from '../src/gen/reactor/complex/propsCable';

const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];
const S = sampleCarver();
const SAMPLE = {complexCarvers: {bunker: S, mines: S, waste: S}};
// task reactor-expansion-20261101 (lane MINES): 'null' = explicit null carvers (the lanes' real carvers are wired in complex/*.ts now)
const NULLS = {complexCarvers: {bunker: () => null, mines: () => null, waste: () => null}};
const cache = new Map<string, StationLayout>();
const gen = (seed: number, mode: 'null' | 'sample' = 'sample') => {
  const key = `${mode}:${seed}`;
  let L = cache.get(key);
  if (!L) { L = generateReactorLevel({levelSeed: seed}, mode === 'sample' ? SAMPLE : NULLS); cache.set(key, L); }
  return L;
};
const DIR = {N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0]} as const;

/** FNV-1a over the records + every storey grid. */
function fingerprint(L: StationLayout): string {
  let h = 2166136261 >>> 0;
  const eat = (u8: Uint8Array) => { for (let i = 0; i < u8.length; i++) { h ^= u8[i]; h = Math.imul(h, 16777619) >>> 0; } };
  for (const lv of L.levels) for (const a of [lv.grid.cells, lv.grid.area, lv.grid.floor, lv.grid.ceil, lv.grid.blocked]) eat(new Uint8Array(a.buffer, a.byteOffset, a.byteLength));
  eat(new TextEncoder().encode(JSON.stringify({areas: L.areas, doors: L.doors, props: L.props, lights: L.lights, pickups: L.pickups, zombies: L.zombies, reactor: L.reactor})));
  return h.toString(16);
}

describe('Reactor side-complex host: slots (lane HOST)', () => {
  it('reserves one 80 x 64 cell region per zone on its storey beside the pit: in the canvas core, disjoint, solid on its storey, band-safe on the others, never under the station', () => {
    const walls = new Map<string, Set<string>>();
    for (const seed of SEEDS) for (const v of ['W', 'E']) {
      const f = reactorFrame(seed, v), cv = reactorCanvas(f);
      const k = new Kit(new Rng(reactorSeed(seed)), {levels: REACTOR_LEVELS, w: cv.W, h: cv.H});
      const rc = carveReactor(k, new Rng(reactorSeed(seed)), f);
      if (!rc) continue; // a frame whose program does not fit re-rolls in generateReactorLevel
      const tag = `seed ${seed} ${v}`;
      expect(rc.slots.map(s => [s.id, s.zone, s.level]), tag).toEqual([['bunker', 0, 1], ['mines', 1, 2], ['waste', 2, 4]]);
      for (const s of rc.slots) {
        const t = `${tag} ${s.id}`, R = s.region;
        (walls.get(s.id) ?? walls.set(s.id, new Set()).get(s.id)!).add(s.inward);
        expect([R.w, R.h].sort((a, b) => a - b), t).toEqual([COMPLEX_SLOT.deep, COMPLEX_SLOT.along]);
        expect(R.x >= ORG && R.y >= ORG && R.x + R.w <= cv.coreW - ORG && R.y + R.h <= cv.coreH - ORG, t).toBe(true);
        expect(s.baseY).toBe(rc.bases[s.level]);
        expect(s.ceilMax).toBeCloseTo(Math.floor((rc.bases[s.level - 1] - SLAB) * 100) / 100, 6);
        expect(COMPLEX_OF_ZONE[s.zone]).toBe(s.id);
        // never over the pit
        const pitX0 = Math.min(rc.cx(0), rc.cx(rc.PW - 1));
        expect(R.x + R.w <= pitX0 || R.x >= pitX0 + rc.PW || R.y + R.h <= rc.PZ0 || R.y >= rc.PZ0 + rc.PD, t).toBe(true);
        for (const o of rc.slots) if (o !== s) expect(R.x + R.w <= o.region.x || o.region.x + o.region.w <= R.x || R.y + R.h <= o.region.y || o.region.y + o.region.h <= R.y, `${t} vs ${o.id}`).toBe(true);
        for (let lv = 0; lv < REACTOR_LEVELS; lv++) {
          const g = k.grid(lv);
          for (let y = R.y; y < R.y + R.h; y++) for (let x = R.x; x < R.x + R.w; x++) {
            const i = g.idx(x, y);
            if (g.cells[i] === SOLID) continue;
            // its own storey stays rock and the rim station never lies over it (a rim ROOM may: band-safe); a room of another storey
            // keeps a slab to the complex band
            expect(lv !== s.level, `${t} level ${lv} open at ${x},${y}`).toBe(true);
            if (lv === 0) expect(k.areas[g.area[i]]?.role, `${t} rim cell ${x},${y}`).toBe('reactor-room');
            if (rc.bases[lv] > s.baseY) expect(g.floorOf(i)).toBeGreaterThanOrEqual(s.ceilMax + SLAB - 1e-3);
            else expect(g.ceil[i]).toBeLessThanOrEqual(s.baseY - SLAB + 1e-3);
          }
        }
        // the entrance: a 6-cell span of the region's pit-side row, flat cells of ONE deck area in front of it (+ deck corners)
        const E = s.entrance, [dx, dy] = DIR[s.inward];
        expect([E.w, E.h].sort((a, b) => a - b), t).toEqual([1, COMPLEX_SLOT.door]);
        expect(E.x >= R.x && E.y >= R.y && E.x + E.w <= R.x + R.w && E.y + E.h <= R.y + R.h, t).toBe(true);
        const pitSide = s.inward === 'W' ? E.x === R.x + R.w - 1 : s.inward === 'E' ? E.x === R.x : s.inward === 'S' ? E.y === R.y : E.y === R.y + R.h - 1;
        expect(pitSide, t).toBe(true);
        const g = k.grid(s.level), deck = rc.decks.find(d => d.area === s.frontArea);
        expect(deck?.level, t).toBe(s.level);
        const n = Math.max(E.w, E.h), ax = E.w > 1 ? 1 : 0, ay = 1 - ax;
        for (let q = -1; q <= n; q++) {
          const x = E.x + ax * q - dx, y = E.y + ay * q - dy, i = g.idx(x, y);
          expect(g.cells[i], `${t} front ${q}`).toBe(FLOOR);
          expect(g.rampIdx[i]).toBe(-1);
          if (q >= 0 && q < n) { expect(g.area[i]).toBe(s.frontArea); expect(g.floor[i]).toBeCloseTo(s.baseY, 3); }
        }
      }
      // every room of a slot's storey avoids its region
      for (const r of rc.rooms) for (const s of rc.slots) if (s.level === r.level) {
        const a = r.rect, R = s.region;
        expect(a.x + a.w <= R.x || R.x + R.w <= a.x || a.y + a.h <= R.y || R.y + R.h <= a.y, `${tag} room ${r.key} in ${s.id}`).toBe(true);
      }
    }
    // the seeded wall choice varies: every complex opens off at least two different walls over the sample frames
    for (const id of ['bunker', 'mines', 'waste']) expect(walls.get(id)!.size, id).toBeGreaterThanOrEqual(2);
  });
});

describe('Reactor side-complex host: the shipped stubs (null carvers) keep today\'s level', () => {
  it('valid on every sample seed, no complexes, every generator on its shaft landing with the stair-wall cable', () => {
    for (const seed of SEEDS.slice(0, 6)) {
      const L = gen(seed, 'null'), R = L.reactor!;
      expect(reactorIssues(L), `seed ${seed}`).toEqual([]);
      expect(R.complexes).toEqual([]);
      expect(R.generators.map(g => [g.id, g.zone, g.level])).toEqual([[0, 0, 1], [1, 1, 2], [2, 2, 4]]);
      for (const g of R.generators) {
        const d = R.decks.find(q => q.level === g.level && q.kind === 'landing' && g.x > q.rect.x0 && g.x < q.rect.x1 && g.z > q.rect.z0 && g.z < q.rect.z1);
        expect(d, `seed ${seed} generator ${g.id}`).toBeTruthy();
        expect(g.cable[0]).toEqual(g.panel);
        expect(L.areas[g.area].label).toMatch(/^Generator landing/);
      }
      expect(L.grid.w * L.grid.h).toBeLessThanOrEqual(90_000);
    }
  });
});

describe('Reactor side-complex host: the host path end to end (sample carver)', () => {
  it('valid on >= 6 seeds with all three complexes (reactorIssues incl. complexIssues empty), first attempt, grid in budget', () => {
    for (const seed of SEEDS) {
      const L = gen(seed), R = L.reactor!;
      expect(reactorIssues(L), `seed ${seed}`).toEqual([]);
      expect(complexIssues(L)).toEqual([]);
      expect(R.complexes!.map(c => [c.id, c.zone, c.level])).toEqual([['bunker', 0, 1], ['mines', 1, 2], ['waste', 2, 4]]);
      expect(L.grid.w * L.grid.h).toBeLessThanOrEqual(90_000);
    }
  });

  it('moves each zone generator into its complex: the landing generator is gone, the foot is blocked, the use point clear, the panel faces it', () => {
    for (const seed of SEEDS.slice(0, 6)) {
      const L = gen(seed), R = L.reactor!;
      expect(R.generators.map(g => [g.id, g.zone, g.level])).toEqual([[0, 0, 1], [1, 1, 2], [2, 2, 4]]);
      for (const c of R.complexes!) {
        const g = R.generators[c.generator], grid = L.levels[g.level].grid;
        expect(g.zone).toBe(c.zone);
        expect(c.areas).toContain(g.area);
        expect(L.areas[g.area].role === undefined || L.areas[g.area].role !== 'reactor-landing').toBe(true);
        // its collision prop (anchored annexMachine) over the foot; no generator prop left on any deck
        const p = L.props.find(q => q.kind === 'annexMachine' && q.area === g.area && Math.abs(q.x - g.x) < 1e-3 && Math.abs(q.z - g.z) < 1e-3);
        expect(p, `seed ${seed} ${c.id}`).toBeTruthy();
        expect(grid.blocked[grid.idx(...grid.cellOf(g.x, g.z))]).toBe(1);
        expect(g.size.w).toBeGreaterThanOrEqual(GENSET.w - 1e-6);
        expect(g.size.d).toBeGreaterThanOrEqual(GENSET.d - 1e-6);
        const [ux, uy] = grid.cellOf(g.use.x, g.use.z);
        expect(grid.walkable(ux, uy)).toBe(true);
        expect(grid.circleClear(g.use.x, g.use.z, 0.3)).toBe(true);
        // panel on the foot edge nearest the use point, 1.2 m up; the use yaw looks at it
        expect(g.panel.y).toBeCloseTo(g.y + 1.2, 3);
        expect(Math.hypot(g.panel.x - g.use.x, g.panel.z - g.use.z)).toBeLessThan(1.6);
        const fx = -Math.sin(g.use.yaw), fz = -Math.cos(g.use.yaw);
        expect(fx * (g.panel.x - g.use.x) + fz * (g.panel.z - g.use.z)).toBeGreaterThan(0.2);
      }
      for (const q of L.props) if (q.kind === 'annexMachine') expect(L.areas[q.area].role, `seed ${seed}: machine on a deck`).not.toBe('reactor-landing');
      // the apron deck that held the generator is now the complex's entrance landing
      for (const c of R.complexes!) expect(L.areas[c.slot!.frontArea].label).not.toMatch(/^Generator landing/);
    }
  });

  // task reactor-playtest-round2-20261102 (lane PROPS, intent change from the user's "cables … should be along the roof. Right now they
  // clip awkwardly through the doorways"): the cable hangs under the ceilings and crosses every wall OVER the door's lintel or through
  // the wall beside its jamb (complex/propsCable.ts) — no longer through the door openings under their heads
  it('routes each complex generator cable from its panel along the ceilings, out through the entrance wall, to the zone\'s fans', () => {
    for (const seed of SEEDS.slice(0, 6)) {
      const L = gen(seed), R = L.reactor!;
      for (const c of R.complexes!) {
        const g = R.generators[c.generator], grid = L.levels[g.level].grid, ids = new Set(c.areas), front = c.slot!.frontArea;
        const base = L.levels[c.level].baseY, cc = {level: c.level, baseY: base, frontArea: front, areas: c.areas};
        expect(g.cable[0]).toEqual(g.panel);
        // the exit: the first point (after the panel's riser) on a pit-deck cell beyond the entrance wall
        const inDoor = (cx: number, cy: number) => L.doors.some(d => (ids.has(d.a) || ids.has(d.b)) && cx >= d.x && cx < d.x + d.w && cy >= d.y && cy < d.y + d.h);
        const k = g.cable.findIndex((p, i) => { if (i < 2) return false; const [cx, cy] = grid.cellOf(p.x, p.z), j = grid.idx(cx, cy); return grid.cells[j] === FLOOR && !ids.has(grid.area[j]) && !inDoor(cx, cy); });
        expect(k, `seed ${seed} ${c.id}`).toBeGreaterThan(1);
        expect(ceilingCableIssues(L, cc, g, k), `seed ${seed} ${c.id}`).toEqual([]);
        // every interior sample hangs over complex floor, or crosses a wall at a doorway (over its lintel / beside its jamb)
        for (let i = 1; i < k; i++) {
          const a = g.cable[i], b = g.cable[i + 1];
          for (let t = 0; t <= 1; t += 0.05) {
            const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t, [cx, cy] = grid.cellOf(x, z), j = grid.idx(cx, cy);
            const nearDoor = L.doors.some(d => (ids.has(d.a) || ids.has(d.b)) && cx >= d.x - CEILING_CABLE.besideReach - 1 && cx < d.x + d.w + CEILING_CABLE.besideReach + 1 && cy >= d.y - CEILING_CABLE.besideReach - 1 && cy < d.y + d.h + CEILING_CABLE.besideReach + 1);
            expect((grid.cells[j] === FLOOR && (ids.has(grid.area[j]) || grid.area[j] === front)) || nearDoor, `seed ${seed} ${c.id} segment ${i}`).toBe(true);

          }
        }
        // then out along the pit walls to every fan of its zone
        for (const fid of R.zones[c.zone].fans) {
          const f = R.fans[fid];
          expect(g.cable.some(p => Math.abs(p.x - f.x) < 1e-3 && Math.abs(p.y - f.y) < 1e-3 && Math.abs(p.z - f.z) < 1e-3), `seed ${seed} fan ${fid}`).toBe(true);
        }
      }
    }
  });

  it('fills layout.reactor.complexes (name, storey, zone, generator, areas entry-first, rooms, entrance on the deck, bounds in the region, the slot)', () => {
    for (const seed of SEEDS.slice(0, 4)) {
      const L = gen(seed), R = L.reactor!;
      for (const c of R.complexes!) {
        expect(c.name).toMatch(/^Sample /);
        expect(c.areas.length).toBe(6);
        expect(c.rooms.map(r => r.area)).toEqual(c.areas);
        expect(c.rooms[0].role).toBe('entry');
        expect(c.rooms.filter(r => r.role === 'generator').length).toBe(1);
        for (const id of c.areas) expect(L.areas[id].level).toBe(c.level);
        const g = L.levels[c.level].grid, [ex, ey] = g.cellOf(c.entrance.x, c.entrance.z);
        expect(g.area[g.idx(ex, ey)]).toBe(c.slot!.frontArea);
        expect(c.entrance.level).toBe(c.level);
        const r = c.slot!.region, b = c.bounds;
        expect(b.x0 >= r.x0 && b.z0 >= r.z0 && b.x1 <= r.x1 && b.z1 <= r.z1).toBe(true);
        expect(c.slot!.ceilMax).toBeLessThan(R.tiers[c.level - 1].baseY);
        // the entrance door: deck <-> entry, >= 2 m wide and >= 2.6 m clear
        const d = L.doors.find(q => (q.a === c.slot!.frontArea && q.b === c.areas[0]) || (q.b === c.slot!.frontArea && q.a === c.areas[0]))!;
        expect(d).toBeTruthy();
        expect(Math.max(d.w, d.h) * CELL).toBeGreaterThanOrEqual(2);
        expect(d.height).toBeGreaterThanOrEqual(2.6);
      }
    }
  });

  it('walks by STAIRS from the start through the entrance to every generator use point, never below the generator\'s storey; no gas deadlock', () => {
    for (const seed of SEEDS.slice(0, 6)) {
      const L = gen(seed), R = L.reactor!, g0 = L.grid, [sx, sy] = g0.cellOf(R.start.x, R.start.z);
      const stairs = L.levelLinks.filter(k => k.kind === 'stairs');
      for (const c of R.complexes!) {
        const gen0 = R.generators[c.generator], lv = c.level, grid = L.levels[lv].grid, [ux, uy] = grid.cellOf(gen0.use.x, gen0.use.z);
        // storeys at or above the generator's only (the route never needs a deeper, gassier storey)
        const upper = L.levels.slice(0, lv + 1);
        const d = levelDistance(upper, sx, sy, 0, stairs.filter(k => k.lower <= lv));
        expect(d[lv][grid.idx(ux, uy)], `seed ${seed} ${c.id}`).toBeGreaterThanOrEqual(0);
        // the entrance is the way in: with its doorway blocked the use point is cut off
        const E = c.slot!.entrance, saved: number[] = [];
        const cells: number[] = [];
        for (let z = E.z0 + CELL / 2; z < E.z1; z += CELL) for (let x = E.x0 + CELL / 2; x < E.x1; x += CELL) cells.push(grid.idx(...grid.cellOf(x, z)));
        for (const i of cells) { saved.push(grid.blocked[i]); grid.blocked[i] = 1; }
        const cut = levelDistance(upper, sx, sy, 0, stairs.filter(k => k.lower <= lv));
        cells.forEach((i, q) => { grid.blocked[i] = saved[q]; });
        expect(cut[lv][grid.idx(ux, uy)], `seed ${seed} ${c.id} without the entrance`).toBe(-1);
        // the no-deadlock air rule: zones < k cleared, generator k's use point breathes below the damage threshold standing (and
        // crouched for k >= 1: zone k-1 is clear; generator 0 stands in tier 1's thin top haze exactly as on today's landing — the
        // depth gas is a function of y only, so the complex is never worse than the landing it replaces)
        const k = gen0.zone, st = emptyReactorState(R.generators.length, R.zones.length);
        for (let i = 0; i < k; i++) st.zoneClear[i] = 1;
        const air = new ReactorAir(R, layoutRect(L), st);
        air.update(0, true);
        const N = gen(seed, 'null').reactor!.generators[k];
        for (const eye of [STAND_EYE, CROUCH_EYE]) {
          const here = air.depthGasAt(gen0.use.x, gen0.y + eye, gen0.use.z);
          if (k > 0 || eye === STAND_EYE) expect(here, `seed ${seed} gen ${gen0.id} eye ${eye}`).toBeLessThan(GAS.THRESHOLD);
          expect(here).toBeLessThanOrEqual(air.depthGasAt(N.use.x, N.y + eye, N.use.z) + 1e-9);
        }
      }
    }
  });

  it('keeps enemies off the generator use points and the entrances (spawn keep points); runs the dress hook once in world metres', () => {
    for (const seed of SEEDS.slice(0, 4)) {
      const L = gen(seed), R = L.reactor!;
      for (const c of R.complexes!) {
        const g = R.generators[c.generator];
        for (const z of L.zombies) {
          if ((z.level ?? 0) !== c.level) continue;
          expect(Math.hypot(z.x - g.use.x, z.z - g.use.z), `seed ${seed} ${c.id} use`).toBeGreaterThan(1.5);
          expect(Math.hypot(z.x - c.entrance.x, z.z - c.entrance.z), `seed ${seed} ${c.id} entrance`).toBeGreaterThan(1.5);
        }
        // the sample hook adds one fixture per room at base + 2.9 (absolute, level-tagged); none in the entrance doorway
        for (const r of c.rooms) expect(L.lights.some(l => l.area === r.area && l.level === c.level && Math.abs(l.y - (R.tiers[c.level].baseY + 2.9)) < 1e-6), `seed ${seed} ${r.key}`).toBe(true);
        const E = c.slot!.entrance;
        for (const l of L.lights) if ((l.level ?? 0) === c.level) expect(l.x > E.x0 - 0.4 && l.x < E.x1 + 0.4 && l.z > E.z0 - 0.4 && l.z < E.z1 + 0.4, `seed ${seed} lamp in the ${c.id} doorway`).toBe(false);
        // the generator room is lit steadily
        expect(L.areas[g.area].lighting).toBe('lit');
        expect(L.lights.some(l => l.area === g.area && !l.broken && !l.dying)).toBe(true);
      }
    }
  });

  it('is deterministic (records + every storey grid) and the null / sample paths differ only by the complexes', () => {
    const a = generateReactorLevel({levelSeed: 3}, SAMPLE), b = generateReactorLevel({levelSeed: 3}, SAMPLE);
    expect(fingerprint(a)).toBe(fingerprint(b));
    expect(fingerprint(a)).not.toBe(fingerprint(gen(3, 'null')));
  });

  it('flags an undersized complex (the "substantial" floor: >= 6 areas, >= 500 m² walkable)', () => {
    const small = sampleCarver({small: true});
    const L = generateReactorLevel({levelSeed: 2}, {complexCarvers: {bunker: small, mines: null, waste: null}});
    const iss = complexIssues(L);
    expect(iss.some(s => /complex bunker: \d+ m² walkable \(< 500\)/.test(s)), iss.join(' | ')).toBe(true);
    expect(L.reactor!.complexes!.map(c => c.id)).toEqual(['bunker']);
    // the zones without a complex keep their landing generators
    expect(L.reactor!.generators.filter(g => g.zone > 0).every(g => /^Generator landing/.test(L.areas[g.area].label))).toBe(true);
  });

  it('a level whose Beyond-the-Station roll succeeds keeps its annex next to the three shipped complexes (regression: tunnel bounding boxes are not overlaps)', () => {
    // present-roll seeds that lost their annex when complexIssues compared a curved tunnel's area RECT (its bounding box) with the
    // complexes' rooms: the extension planner keeps a rock margin to every open cell of every storey, so only real cells may count
    for (const seed of [4201601321, 920538251, 350413600]) {
      expect(btsAreaPresent(seed)).toBe(true);
      const L = generateReactorLevel({levelSeed: seed, startWeapon: 'pistol'});
      expect(L.extensions!.annexes.length, `seed ${seed}`).toBeGreaterThanOrEqual(1);
      expect(L.extensions!.log.some(g => /dropped/.test(g.result)), `seed ${seed}`).toBe(false);
      expect((L.reactor!.complexes ?? []).map(c => c.id)).toEqual(['bunker', 'mines', 'waste']);
      expect(reactorIssues(L)).toEqual([]);
      // and no extension cell lies in any complex room's columns on any storey
      const ext = new Set(L.areas.filter(a => a.ext).map(a => a.id));
      for (const c of L.reactor!.complexes!) for (const id of c.areas) {
        const a = L.areas[id];
        for (const lv of L.levels) for (let y = a.y; y < a.y + a.h; y++) for (let x = a.x; x < a.x + a.w; x++) {
          const i = lv.grid.idx(x, y);
          expect(lv.grid.cells[i] !== SOLID && ext.has(lv.grid.area[i])).toBe(false);
        }
      }
    }
  });

  it('generates fast with three complexes (report; target < 800 ms per call in Node)', () => {
    gen(1);
    const times: number[] = [];
    for (const seed of [21, 22, 23]) { generateReactorLevel({levelSeed: seed}, SAMPLE); times.push(REACTOR_GEN_STATS.ms); }
    process.stdout.write(`[reactor-host] generateReactorLevel ms (sample complexes): ${times.map(t => t.toFixed(0)).join(', ')}; carve ms ${JSON.stringify(COMPLEX_HOST_STATS.ms)}\n`);
    times.sort((p, q) => p - q);
    expect(times[1]).toBeLessThan(1500); // CI headroom (slow runners); the Node target is < 800 ms
  });
});
