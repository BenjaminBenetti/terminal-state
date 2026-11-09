// Task studio-bunker-rework-20261109-205115-01: THE BUNKER v2 — storey 5, the CENTRAL PROCESSING CORE (gen/bunker/v2/floor5.ts, its dressing
// gen/bunker/v2/floor5Dress.ts) over a bounded seed set: the whole level valid, the programme present, the nave over the V45 void with
// the core cluster terminating its axis, the straight freight axis, the mix of scales (tall halls, tight technical rooms), the anchors
// served, the hazard (a weak leak in the dead-end chiller room), the storey's loot reading as computing / records, budgets, determinism.

import {describe, expect, it} from 'vitest';
import {appendFileSync, writeFileSync} from 'node:fs';
import {generateBunkerLevel} from '../src/gen/bunker/index';
import {bunkerIssues, frontCells} from '../src/gen/bunker/validate';
import {BUNKER_CORE_KIND} from '../src/gen/bunker/bunkerTypes';
import {BUNKER_V2_STATS} from '../src/gen/bunker/v2/index';
import {bunkerV2Issues} from '../src/gen/bunker/v2/validate';
import {bunkerSpine, V2_BASES, V2_CORE_LEVEL} from '../src/gen/bunker/v2/spine';
import {F5_AXIS} from '../src/gen/bunker/v2/floor5';
import {F5_DRESS_STATS} from '../src/gen/bunker/v2/floor5Dress';
import {BUNKER_PURPOSE} from '../src/gen/reactor/complex/bunkerPurposes';
import {GAS_STRENGTH} from '../src/gen/bunker/hazards';
import {spawnProfile} from '../src/ai/spawnTables';
import {isLootHolderKind} from '../src/items/loot';
import {CELL, FLOOR} from '../src/gen/grid';
import type {Area, StationLayout} from '../src/gen/stationTypes';

const LOG = '/tmp/bunker-v2-floor5.log';
const log = (s: string) => appendFileSync(LOG, s + '\n');
const SEEDS = Array.from({length: 8}, (_, k) => 9001 + k * 7919);
const L5 = V2_CORE_LEVEL;
const LABELS = {
  nave: 'Central processing hall', narthex: 'Clean-room lobby', gallery: 'Operators\' gallery', control: 'Core control room', cooling: 'Cooling plant',
  chiller: 'Chiller room', switch: 'Switch room', bay: 'Freight lobby', library: 'Tape library', commons: 'Operators\' commons', bunks: 'Night-shift bunk room',
  wash: 'Operators\' washroom', cableway: 'Cable way', battery: 'UPS battery room',
} as const;
type Key = keyof typeof LABELS;

interface Gen { layout: StationLayout; ms: number; dress: typeof F5_DRESS_STATS }
const cache = new Map<number, Gen>();
function gen(seed: number): Gen {
  let g = cache.get(seed);
  if (!g) {
    const layout = generateBunkerLevel({levelSeed: seed});
    g = {layout, ms: BUNKER_V2_STATS.ms, dress: {...F5_DRESS_STATS, skipped: [...F5_DRESS_STATS.skipped]}};
    cache.set(seed, g);
    const n = layout.props.filter(p => (p.level ?? 0) === L5).length;
    log(`seed ${seed}: ${g.ms.toFixed(0)} ms, attempts ${BUNKER_V2_STATS.attempts}, L5 props ${n}, dress ${JSON.stringify(g.dress)}`);
  }
  return g;
}
const areasOf = (l: StationLayout): Record<Key, Area> => {
  const out = {} as Record<Key, Area>;
  for (const k of Object.keys(LABELS) as Key[]) {
    const a = l.areas.find(q => (q.level ?? 0) === L5 && q.label === LABELS[k]);
    if (a) out[k] = a;
  }
  return out;
};
const m2 = (a: Area) => a.w * a.h * CELL * CELL;
const clear = (a: Area) => a.ceil - V2_BASES[L5];
const props = (l: StationLayout, a: Area, kind?: string) => l.props.filter(p => (p.level ?? 0) === L5 && p.area === a.id && (!kind || p.kind === kind));
const doorsBetween = (l: StationLayout, a: Area, b: Area) => l.doors.filter(d => (d.a === a.id && d.b === b.id) || (d.a === b.id && d.b === a.id));

describe('bunker v2 storey 5 — the central processing core', () => {
  writeFileSync(LOG, '');
  const sp = bunkerSpine(), frame = sp.storeys[L5];

  it('the whole level is valid for every seed (bunkerIssues + bunkerV2Issues), within the generation budget', () => {
    const startCells = spawnProfile('bunker').contexts.station?.placement.startCells ?? 36;
    for (const seed of SEEDS) {
      const {layout, ms, dress} = gen(seed);
      const issues = [...bunkerIssues(layout, {startCells}), ...bunkerV2Issues(layout)];
      if (issues.length) log(`seed ${seed} issues ${JSON.stringify(issues.slice(0, 8))}`);
      expect(issues, `seed ${seed}`).toEqual([]);
      expect(dress.skipped, `seed ${seed} dress steps`).toEqual([]);
      expect(ms, `seed ${seed} ms`).toBeLessThan(6000);
    }
  }, 600_000);

  it('the programme: every room, with its purpose, inside the envelope', () => {
    const P: Record<Key, string> = {
      nave: 'office-server', narthex: 'locker-room', gallery: BUNKER_PURPOSE.lock, control: BUNKER_PURPOSE.radio, cooling: 'ventilation-plant', chiller: 'pump-room',
      switch: 'electrical-room', bay: BUNKER_PURPOSE.lock, library: 'office-server', commons: 'staff-room', bunks: BUNKER_PURPOSE.dorm, wash: 'washroom',
      cableway: BUNKER_PURPOSE.lock, battery: 'electrical-closet',
    };
    for (const seed of SEEDS) {
      const {layout} = gen(seed);
      const A = areasOf(layout);
      for (const k of Object.keys(LABELS) as Key[]) {
        expect(A[k], `seed ${seed} ${k}`).toBeDefined();
        expect(A[k].purpose, `seed ${seed} ${k} purpose`).toBe(P[k]);
        const e = frame.envelope;
        expect(A[k].x >= e.x && A[k].y >= e.y && A[k].x + A[k].w <= e.x + e.w && A[k].y + A[k].h <= e.y + e.h, `seed ${seed} ${k} envelope`).toBe(true);
      }
    }
  }, 600_000);

  it('the nave covers the V45 void exactly at 11.6 m; ranks of tape cabinets and racks, the coolant risers, the operators\' desks', () => {
    const v = sp.voids.find(q => q.id === 'V45')!;
    for (const seed of SEEDS) {
      const {layout} = gen(seed);
      const {nave} = areasOf(layout);
      expect({x: nave.x, y: nave.y, w: nave.w, h: nave.h}).toEqual(v.rect);
      expect(Math.abs(nave.ceil - v.ceil)).toBeLessThan(1e-6);
      const tape = props(layout, nave, 'bunkerMainframe').length, racks = props(layout, nave, 'serverRack').length;
      expect(tape + racks, `seed ${seed} ranks`).toBeGreaterThanOrEqual(18);
      expect(tape, `seed ${seed} tape cabinets`).toBeGreaterThanOrEqual(10);
      expect(racks, `seed ${seed} racks`).toBeGreaterThanOrEqual(3);
      expect(props(layout, nave, 'bunkerPipeBank').length, `seed ${seed} risers`).toBe(1);
      const desks = props(layout, nave, 'desk');
      expect(desks.length, `seed ${seed} desks`).toBeGreaterThanOrEqual(3);
      // every desk carries its CRT terminal (a separate loose prop on the desk top, never part of the desk)
      for (const d of desks) expect(layout.props.some(p => p.kind === 'crtTerminal' && p.host === layout.props.indexOf(d))).toBe(true);
      // the ranks stand on the 1 m cell-pair pitch: no two units share a grid cell
      const g = layout.levels[L5].grid, seen = new Set<number>();
      for (const p of [...props(layout, nave, 'bunkerMainframe'), ...props(layout, nave, 'serverRack')]) {
        const [c0, r0] = g.cellOf(p.x - p.hx + 0.045, p.z - p.hz + 0.045), [c1, r1] = g.cellOf(p.x + p.hx - 0.045, p.z + p.hz - 0.045);
        for (let y = r0; y <= r1; y++) for (let x = c0; x <= c1; x++) { const i = g.idx(x, y); expect(seen.has(i), `seed ${seed} shared cell`).toBe(false); seen.add(i); }
      }
    }
  }, 600_000);

  it('the core cluster stands against the nave\'s east wall on its long axis, facing the west portal, its front clear', () => {
    for (const seed of SEEDS) {
      const {layout} = gen(seed);
      const {nave, narthex} = areasOf(layout);
      const c = layout.bunker!.core, p = layout.props[c.prop];
      expect(c.level).toBe(L5);
      expect(c.area).toBe(nave.id);
      expect(p.kind).toBe(BUNKER_CORE_KIND);
      expect(Math.abs(p.x + p.hx - (nave.x + nave.w) * CELL), `seed ${seed} back to the east wall`).toBeLessThan(0.1);
      expect(Math.round(Math.sin(p.rot))).toBe(-1); // front toward -x (west)
      // the west portal faces it on the same axis (rows overlap the cluster's middle)
      const portal = doorsBetween(layout, nave, narthex);
      expect(portal.length).toBe(1);
      const pz = (portal[0].y + portal[0].h / 2) * CELL;
      expect(Math.abs(pz - p.z), `seed ${seed} axis`).toBeLessThan(1.0);
      // its 3 m front strip: open floor of the nave, unblocked
      const g = layout.levels[L5].grid;
      const front = frontCells(g, p, 6);
      expect(front.every(i => g.cells[i] === FLOOR && g.area[i] === nave.id && !g.blocked[i]), `seed ${seed} front`).toBe(true);
    }
  }, 600_000);

  it('the straight freight axis: lift lobby -> cooling plant -> core control -> gallery -> nave through doors on the same columns', () => {
    for (const seed of SEEDS) {
      const {layout} = gen(seed);
      const A = areasOf(layout);
      for (const [a, b] of [[A.bay, A.cooling], [A.cooling, A.control], [A.control, A.gallery], [A.gallery, A.nave]] as const) {
        const ds = doorsBetween(layout, a, b).filter(d => d.h === 1);
        expect(ds.length, `seed ${seed} ${a.label} -> ${b.label}`).toBe(1);
        expect(ds[0].x).toBe(F5_AXIS.x);
        expect(ds[0].w).toBe(F5_AXIS.w);
      }
    }
  }, 600_000);

  it('a real mix of scales: tall halls, a long low gallery, tight technical rooms; nothing but the nave above 6.7 m', () => {
    for (const seed of SEEDS) {
      const {layout} = gen(seed);
      const A = areasOf(layout);
      expect(m2(A.nave)).toBeGreaterThanOrEqual(200);
      expect(clear(A.nave)).toBeGreaterThan(11);
      // the second and third big volumes: the cooling plant (6.4 m) and the commons (5.2 m)
      expect(m2(A.cooling)).toBeGreaterThanOrEqual(150);
      expect(clear(A.cooling)).toBeGreaterThanOrEqual(6.0);
      expect(m2(A.commons)).toBeGreaterThanOrEqual(140);
      expect(clear(A.commons)).toBeGreaterThanOrEqual(5.0);
      // the gallery: >= 25 m long and low; the tight rooms: at least four rooms under 50 m2 at <= 3.4 m
      expect(Math.max(A.gallery.w, A.gallery.h) * CELL).toBeGreaterThanOrEqual(25);
      expect(clear(A.gallery)).toBeLessThanOrEqual(3.4);
      const tight = (['narthex', 'chiller', 'switch', 'bunks', 'wash', 'battery'] as Key[]).filter(k => m2(A[k]) < 50 && clear(A[k]) <= 3.4);
      expect(tight.length, `seed ${seed} tight rooms`).toBeGreaterThanOrEqual(4);
      // the cable way behind the core: 2 m wide, 2.8 m clear, >= 10 m long — the tightest space of the storey beside its tallest
      expect(Math.min(A.cableway.w, A.cableway.h) * CELL).toBeLessThanOrEqual(2.0);
      expect(Math.max(A.cableway.w, A.cableway.h) * CELL).toBeGreaterThanOrEqual(10);
      expect(clear(A.cableway)).toBeLessThanOrEqual(2.8);
      // nothing else on the storey rises into storey 4 (stair runs excepted)
      for (const a of layout.areas) if ((a.level ?? 0) === L5 && a.id !== A.nave.id && a.role !== 'stair') expect(clear(a), `seed ${seed} ${a.label}`).toBeLessThanOrEqual(6.7);
    }
  }, 600_000);

  it('every anchor apron is open floor of the right area: main stair -> gallery, service stair -> commons, cargo lift -> freight lobby', () => {
    const who: Record<string, Key> = {stairA: 'gallery', stairB: 'commons', lift: 'bay'};
    for (const seed of SEEDS) {
      const {layout} = gen(seed);
      const A = areasOf(layout), g = layout.levels[L5].grid;
      for (const an of frame.anchors) {
        const want = A[who[an.id]];
        for (let y = an.apron.y; y < an.apron.y + an.apron.h; y++) for (let x = an.apron.x; x < an.apron.x + an.apron.w; x++) {
          const i = g.idx(x, y);
          expect(g.cells[i] === FLOOR && g.area[i] === want.id && !g.blocked[i], `seed ${seed} ${an.id} (${x},${y})`).toBe(true);
        }
      }
    }
  }, 600_000);

  it('hazards: one weak refrigerant leak in the dead-end chiller room (one door); the tape library aged; no damp here', () => {
    const [lo, hi] = GAS_STRENGTH.weak;
    for (const seed of SEEDS) {
      const {layout} = gen(seed);
      const A = areasOf(layout), b = layout.bunker!, g = layout.levels[L5].grid;
      const zones = b.gasZones.filter(z => z.level === L5);
      expect(zones.length, `seed ${seed} zones`).toBe(1);
      expect(zones[0].cells.every(i => g.area[i] === A.chiller.id)).toBe(true);
      expect(zones[0].strength).toBeGreaterThanOrEqual(lo - 1e-6);
      expect(zones[0].strength).toBeLessThanOrEqual(hi + 1e-6);
      expect(layout.doors.filter(d => d.a === A.chiller.id || d.b === A.chiller.id).length).toBe(1);
      expect(['dim', 'dark']).toContain(A.library.lighting);
      expect(b.damp.some(id => (layout.areas[id].level ?? 0) === L5)).toBe(false);
    }
  }, 600_000);

  it('the rooms are dressed for their use; the loot holders sit in programme rooms (computing / records / electrical), not in plain halls', () => {
    for (const seed of SEEDS) {
      const {layout} = gen(seed);
      const A = areasOf(layout);
      expect(props(layout, A.cooling, 'bunkerCoolantPump').length, `seed ${seed} pumps`).toBeGreaterThanOrEqual(2);
      expect(props(layout, A.control).some(p => p.kind === 'bunkerControlConsole' || p.kind === 'radioConsole'), `seed ${seed} console`).toBe(true);
      expect(props(layout, A.library, 'shelf').length, `seed ${seed} shelving`).toBeGreaterThanOrEqual(4);
      expect(props(layout, A.commons, 'planterTree').length, `seed ${seed} garden`).toBe(4);
      expect(props(layout, A.bunks, 'bunkBed').length, `seed ${seed} bunks`).toBeGreaterThanOrEqual(4);
      const holders = layout.props.filter(p => (p.level ?? 0) === L5 && isLootHolderKind(p.kind));
      const plain = holders.filter(p => layout.areas[p.area].purpose === BUNKER_PURPOSE.lock);
      expect(plain.length, `seed ${seed} holders in plain halls`).toBeLessThanOrEqual(2);
      const tech = holders.filter(p => ['office-server', 'electrical-room', 'electrical-closet', BUNKER_PURPOSE.radio].includes(layout.areas[p.area].purpose ?? ''));
      expect(tech.length, `seed ${seed} computing / records / electrical holders`).toBeGreaterThanOrEqual(15);
      // food stays with the shared passes: no fridge / kitchenette / vending outside the commons' staff-room purpose
      for (const p of layout.props) if ((p.level ?? 0) === L5 && ['fridge', 'kitchenette', 'vending'].includes(p.kind)) expect(layout.areas[p.area].purpose).toBe('staff-room');
    }
  }, 600_000);

  it('storey budgets: props <= 170, decor <= 150, lights <= 75', () => {
    for (const seed of SEEDS) {
      const {layout} = gen(seed);
      const base = V2_BASES[L5];
      const n = layout.props.filter(p => (p.level ?? 0) === L5).length;
      // (storey 5's decor starts below storey 4's floor; the nave's tall pieces rise past it)
      const decor = layout.decor.filter(d => d.y0 >= base - 0.05 && d.y0 < V2_BASES[L5 - 1] - 0.05).length;
      const lights = layout.lights.filter(l => (l as {level?: number}).level === L5).length;
      log(`seed ${seed}: L5 props ${n} decor ${decor} lights ${lights}`);
      expect(n).toBeLessThanOrEqual(170);
      expect(decor).toBeLessThanOrEqual(150);
      expect(lights).toBeLessThanOrEqual(75);
    }
  }, 600_000);

  it('is deterministic: the same seed builds the same storey', () => {
    const seed = SEEDS[1];
    const a = gen(seed).layout, b = generateBunkerLevel({levelSeed: seed});
    const sig = (l: StationLayout) => JSON.stringify({
      areas: l.areas.filter(q => (q.level ?? 0) === L5).map(q => [q.label, q.x, q.y, q.w, q.h, q.ceil, q.purpose]),
      props: l.props.filter(p => (p.level ?? 0) === L5).map(p => [p.kind, p.x, p.z, p.y, p.rot]),
      doors: l.doors.filter(d => (d.level ?? 0) === L5).map(d => [d.x, d.y, d.w, d.h, d.height]),
    });
    expect(sig(b)).toBe(sig(a));
  }, 600_000);
});
