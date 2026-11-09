// Task studio-bunker-rework-20261109-205115-01: THE BUNKER v2 — storey 0, the STATION (gen/bunker/v2/floor0.ts + floor0Dress.ts) over a
// bounded seed set: the whole level valid; the admission programme present; the scale rhythm (the one tall vault hall, the low side
// halls, the constrained rooms); the spine's anchors served (the vault hall over the vault apron, the platform openings); the blast door
// seen from the start down the aisle; the vault side opening off the vestibule only; no hazards on the station; the budgets; determinism.

import {describe, expect, it} from 'vitest';
import {generateBunkerLevel, bunkerIssues} from '../src/gen/bunker/index';
import {BUNKER_V2_STATS} from '../src/gen/bunker/v2/index';
import {bunkerV2Issues} from '../src/gen/bunker/v2/validate';
import {bunkerSpine} from '../src/gen/bunker/v2/spine';
import {F0_AXIS, F0_CLEAR, F0_KEYS, F0_LABELS, type F0Key} from '../src/gen/bunker/v2/floor0Spec';
import {FLOOR_0} from '../src/gen/bunker/v2/floor0';
import {CELL, FLOOR} from '../src/gen/grid';
import {isLootHolderKind} from '../src/items/loot';
import type {Area, StationLayout} from '../src/gen/stationTypes';

const SEEDS = Array.from({length: 8}, (_, k) => 9001 + k * 7919);
const cache = new Map<number, {l: StationLayout; ms: number}>();
const gen = (seed: number) => {
  let e = cache.get(seed);
  if (!e) { const l = generateBunkerLevel({levelSeed: seed}); e = {l, ms: BUNKER_V2_STATS.ms}; cache.set(seed, e); }
  return e.l;
};
const l0Areas = (l: StationLayout) => l.areas.filter(a => (a.level ?? 0) === 0);
const byLabel = (l: StationLayout, k: F0Key): Area => {
  const a = l0Areas(l).find(q => q.label === F0_LABELS[k]);
  if (!a) throw new Error(`no ${F0_LABELS[k]}`);
  return a;
};
const m2 = (a: Area) => a.w * a.h * CELL * CELL;
const sp = bunkerSpine(), S = sp.station;

describe('bunker v2 storey 0: the station', () => {
  it('the whole level is valid for every seed (bunkerIssues + bunkerV2Issues), within the time budget', () => {
    const bad: string[] = [];
    for (const s of SEEDS) {
      const l = gen(s);
      const issues = [...bunkerIssues(l), ...bunkerV2Issues(l)];
      if (issues.length) bad.push(`${s}: ${issues.slice(0, 4).join(' | ')}`);
      expect(cache.get(s)!.ms).toBeLessThan(6000);
    }
    expect(bad).toEqual([]);
  });

  it('carries the admission programme: every area, by purpose, on the station storey', () => {
    for (const s of SEEDS) {
      const l = gen(s);
      for (const k of F0_KEYS) expect(byLabel(l, k).level ?? 0).toBe(0);
      expect(byLabel(l, 'marshals').purpose).toBe('security-office');
      expect(byLabel(l, 'medical').purpose).toBe('first-aid-room');
      expect(byLabel(l, 'property').purpose).toBe('lost-property');
      expect(byLabel(l, 'receiving').purpose).toBe('storage');
      expect(byLabel(l, 'billeting').purpose).toBe('agent-office');
      // the registration counter (admission kits), the waiting hall's benches, the observation ward's beds, the vault hall's booths
      const kinds = (k: F0Key) => l.props.filter(p => p.area === byLabel(l, k).id).map(p => p.kind);
      expect(kinds('registration').filter(k => k === 'shopCounter').length).toBeGreaterThanOrEqual(2);
      expect(kinds('waiting').filter(k => k === 'bench').length).toBeGreaterThanOrEqual(3);
      expect(kinds('observation').filter(k => k === 'palletBed').length).toBeGreaterThanOrEqual(3);
      expect(kinds('vaultHall').filter(k => k === 'booth').length).toBeGreaterThanOrEqual(1);
      expect(kinds('vaultHall').filter(k => k === 'column').length).toBeGreaterThanOrEqual(2);
      // the shelter's name over the door, in its own (seeded) words
      expect(l.signs.some(g => g.area === byLabel(l, 'vaultHall').id && g.kind === 'station')).toBe(true);
    }
  });

  it('has a real scale rhythm: one tall vault hall, low side halls, constrained rooms', () => {
    for (const s of SEEDS) {
      const l = gen(s), hall = byLabel(l, 'vaultHall');
      expect(hall.ceil).toBeGreaterThanOrEqual(F0_CLEAR.vaultHall - 0.01);
      expect(m2(hall)).toBeGreaterThanOrEqual(170);
      // the largest of the floor's own areas is the vault hall; nothing of the storey rises higher
      const mine = F0_KEYS.map(k => byLabel(l, k));
      expect(Math.max(...mine.map(m2))).toBe(m2(hall));
      for (const a of l0Areas(l)) expect(a.ceil).toBeLessThanOrEqual(6.4 + 1e-6);
      // the side halls are low and big; at least three rooms are small and closed
      for (const k of ['registration', 'waiting'] as const) { const a = byLabel(l, k); expect(a.ceil).toBeLessThanOrEqual(3.8); expect(m2(a)).toBeGreaterThanOrEqual(60); }
      expect(mine.filter(a => m2(a) <= 110 && a.ceil <= 3.6).length).toBeGreaterThanOrEqual(3);
      // a dead end: the observation ward has exactly one door
      expect(l.doors.filter(d => d.a === byLabel(l, 'observation').id || d.b === byLabel(l, 'observation').id).length).toBe(1);
    }
  });

  it('serves the anchors: the vault hall covers the vault apron; platform openings >= 2, each >= 6 cells, one on the vault axis', () => {
    const ap = sp.storeys[0].anchors.find(a => a.id === 'vaultHall')!.apron;
    for (const s of SEEDS) {
      const l = gen(s), g = l.levels[0].grid, hall = byLabel(l, 'vaultHall');
      for (let y = ap.y; y < ap.y + ap.h; y++) for (let x = ap.x; x < ap.x + ap.w; x++) {
        expect(g.cells[g.idx(x, y)]).toBe(FLOOR);
        expect(g.area[g.idx(x, y)]).toBe(hall.id);
      }
      expect(hall.ceil).toBeGreaterThanOrEqual(4.8);
      const P = l.areas[l.platform];
      const open = l.doors.filter(d => (d.a === P.id || d.b === P.id) && d.y === P.y + P.h && d.h === 1);
      expect(open.length).toBeGreaterThanOrEqual(2);
      for (const d of open) { expect(d.w).toBeGreaterThanOrEqual(6); expect(d.x).toBeGreaterThanOrEqual(20); expect(d.x + d.w).toBeLessThanOrEqual(92); }
      expect(open.some(d => Math.abs(d.x + d.w / 2 - (S.lane.x + S.lane.w / 2)) < 0.01)).toBe(true);
      // the start stands on the platform in front of the central portal
      expect(Math.abs(l.playerSpawn.x - F0_AXIS)).toBeLessThan(2.0);
    }
  });

  it('shows the blast door from the start: a clear line of sight down the aisle to the lane', () => {
    for (const s of SEEDS) {
      const l = gen(s), g = l.levels[0].grid;
      const [sx, sy] = g.cellOf(l.playerSpawn.x, l.playerSpawn.z);
      const tx = S.lane.x + 1, ty = S.bulkhead.y - 1;
      const n = Math.max(Math.abs(tx - sx), Math.abs(ty - sy));
      for (let k = 0; k <= n; k++) {
        const x = Math.round(sx + (tx - sx) * k / n), y = Math.round(sy + (ty - sy) * k / n), i = g.idx(x, y);
        expect(g.cells[i], `seed ${s} cell ${x},${y}`).toBe(FLOOR);
        expect(g.sightBlocked[i], `seed ${s} cell ${x},${y}`).toBe(0);
      }
    }
  });

  it('opens the vault side off the vestibule only (no way through the bulkhead but the lane)', () => {
    for (const s of SEEDS) {
      const l = gen(s);
      const vest = l0Areas(l).find(a => a.label === 'Vault vestibule')!;
      const side = new Set([byLabel(l, 'receiving').id, byLabel(l, 'billeting').id]);
      for (const d of l.doors) {
        if (!side.has(d.a) && !side.has(d.b)) continue;
        const other = side.has(d.a) ? d.b : d.a;
        expect(other === vest.id || side.has(other)).toBe(true);
      }
      for (const id of side) expect(l.areas[id].y).toBeGreaterThan(S.bulkhead.y + S.bulkhead.h - 1);
    }
  });

  it('declares no hazards on the station (no gas, no damp)', () => {
    for (const s of SEEDS) {
      const l = gen(s);
      expect(l.bunker!.gasZones.filter(z => z.level === 0)).toEqual([]);
      const mine = new Set(F0_KEYS.map(k => byLabel(l, k).id));
      expect(l.bunker!.damp.filter(id => mine.has(id))).toEqual([]);
    }
  });

  it('stays within the storey budgets and keeps the retail stock out of the admission halls', () => {
    for (const s of SEEDS) {
      const l = gen(s);
      const props = l.props.filter(p => (p.level ?? 0) === 0);
      expect(props.length).toBeLessThanOrEqual(165);
      expect(l.lights.filter(x => !(x as {level?: number}).level).length).toBeLessThanOrEqual(75);
      const holders = props.filter(p => isLootHolderKind(p.kind)).length;
      expect(holders).toBeGreaterThanOrEqual(20);
      expect(holders).toBeLessThanOrEqual(55);
      expect(l.decor.filter(d => d.y0 > -1).length).toBeLessThanOrEqual(150);
      const hall = byLabel(l, 'vaultHall').id;
      for (const p of props) if (p.area === hall) expect(['shoeShineChair', 'capsuleToyMachine', 'atmKiosk', 'newspaperVendingBox']).not.toContain(p.kind);
    }
  });

  it('is deterministic per seed', () => {
    const a = gen(SEEDS[0]);
    const b = generateBunkerLevel({levelSeed: SEEDS[0]});
    const pick = (l: StationLayout) => JSON.stringify({areas: l0Areas(l).map(q => [q.label, q.x, q.y, q.w, q.h, q.ceil]), props: l.props.filter(p => (p.level ?? 0) === 0).map(p => [p.kind, p.x, p.z, p.rot]), signs: l.signs.filter(g => !g.level).map(g => g.text)});
    expect(pick(b)).toBe(pick(a));
    expect(FLOOR_0.level).toBe(0);
  });
});
