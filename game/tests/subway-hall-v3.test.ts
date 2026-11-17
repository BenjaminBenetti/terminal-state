// Task studio-subway-architecture-materials-rework-20261117-072826-01 (lane HALL): the Subway's LAYOUT VERSION 3 — the grand-hall family's
// sectioned "basilica concourse" (gen/stationHallV3.ts, gen/stationHallV3Dress.ts) and the architectural HALL LIGHT PLAN of every
// plan-family station (gen/subwayHallLights.ts).
//  - a recorded version-2 station regenerates every record byte for byte except its hall LIGHTS (lights are never saved): the
//    everything-but-lights hashes of grand-hall / cavern / hub seeds are pinned to the build before this task;
//  - version 3 changes nothing but the grand-hall family: cavern, hub and classic seeds build their version-2 layouts exactly;
//  - the version-3 great hall at a natural seed of each variant: the macro plan of version 2, the nave / aisle section in the grid's cell
//    ceilings, arcade columns on the boundaries (the bay lines come from them), the clear spine, the furnished subdivisions within the
//    version-2 holder range, valid, the player's train, the track extensions, the Surface Run access, the generation budget;
//  - the light plan: every relit hall's fixtures are styled and sit in its bay rhythm, under the visible soffit, mostly working.
// Every ceiling number comes from the gen/subwayCeilings.ts API (never hard-coded here).

import {describe, expect, it} from 'vitest';
import {generateStation, validateLayout, type StationLayout} from '../src/gen/station';
import {CELL, FLOOR} from '../src/gen/grid';
import {planFamilyOf} from '../src/gen/stationPlans';
import {SUBWAY_HALL_V3_MIN_VERSION, SUBWAY_LAYOUT_VERSION} from '../src/gen/subwayLayoutVersion';
import {arcadeLines} from '../src/gen/stationHallV3';
import {HALL_V3_HOLDER_CAP, HALL_V3_HOLDER_MIN, hallV3Summary} from '../src/gen/stationHallV3Dress';
import {hallSectionWorld} from '../src/gen/hallSection';
import {COVE_INSET, DRUM_CLEAR, DRUM_MIN_Y, MAX_HALL_SOURCES, coveOffset, relitHall} from '../src/gen/subwayHallLights';
import {bayBounds, hallBays} from '../src/gen/subwayBays';
import {ceilingFormOf, coveY, soffitAt, springCoves} from '../src/gen/subwayCeilings';
import {playerTrainPlacement} from '../src/gen/playerTrain';
import {SURFACE_VERSION} from '../src/gen/surface/surfaceRun';
import {isLootHolderKind} from '../src/items/loot';
import {LEVELS} from '../src/levels/registry';
import type {Area} from '../src/gen/stationTypes';

/** Natural version-3 grand-hall seeds, one per variant (nothing forced). Seed 15 also rolls the Surface Run access. */
const VARIANT_SEEDS = {transept: 3, 'gate-aisle': 4, basilica: 15} as const;
/**
 * The everything-but-lights hashes of version-2 stations (the game's registry call, Surface Run version 1), taken with the generator
 * before this task: grand halls {3, 4, 7, 15}, caverns {2, 8, 13}, hubs {16, 28, 67}. A version-2 save must regenerate exactly these
 * records; only the relit halls' lights may differ. (Re-pin only with proof that a change came from main, never from this lane's code.)
 */
const V2_PINS: Record<number, string> = {
  3: '213460:477c38ef', 4: '193324:83bd127e', 7: '202807:d7269f31', 15: '250021:35b3a86c',
  2: '172767:ad111d0b', 8: '223154:98fa3f88', 13: '154926:871e1d4a',
  16: '195940:7574130c', 28: '195169:56d62d44', 67: '230163:150dab3e',
};

const cache = new Map<string, StationLayout>();
/** The game's own call: the registry with the station's layout version and a Surface Run version. */
const gen = (seed: number, version: number, surface = SURFACE_VERSION): StationLayout => {
  const key = `${seed}:${version}:${surface}`;
  let L = cache.get(key);
  if (!L) cache.set(key, (L = LEVELS.subway.generate('main', {levelSeed: seed, surfaceVersion: surface, layoutVersion: version})));
  return L;
};

function layoutHash(l: unknown): string {
  const json = JSON.stringify(l, (_k, v) => {
    if (ArrayBuffer.isView(v)) { const b = new Uint8Array(v.buffer, v.byteOffset, v.byteLength); let x = 2166136261; for (let i = 0; i < b.length; i++) x = Math.imul(x ^ b[i], 16777619); return `#${b.length}:${x >>> 0}`; }
    return v;
  });
  let x = 2166136261;
  for (let i = 0; i < json.length; i++) x = Math.imul(x ^ json.charCodeAt(i), 16777619);
  return `${json.length}:${(x >>> 0).toString(16)}`;
}
const grandHall = (L: StationLayout): Area => L.areas.find(a => a.role === 'grand-ticket-hall')!;

/** Every relit hall's lights in the bay rhythm of its ceiling form, under the visible soffit, mostly working. */
function expectLightRhythm(L: StationLayout, label: string): void {
  const halls = L.areas.filter(relitHall);
  expect(halls.length, label).toBeGreaterThan(0);
  for (const a of halls) {
    const tag = `${label} ${a.role ?? a.type}#${a.id}`;
    const g = L.levels?.[a.level ?? 0]?.grid ?? L.grid;
    const form = ceilingFormOf(L, a), b = form.bays;
    const vaulted = form.kind === 'vault' || form.kind === 'rock';
    const centres = bayBounds(b).map(([p, q]) => (p + q) / 2);
    const lines = b.lines.filter(l => l > b.a0 + 0.5 && l < b.a1 - 0.5);
    const own = L.lights.filter(l => l.area === a.id);
    expect(own.length, tag).toBeGreaterThan(0);
    expect(own.length, `${tag}: <= MAX_HALL_SOURCES`).toBeLessThanOrEqual(MAX_HALL_SOURCES);
    for (const l of own) {
      const along = b.alongX ? l.x : l.z, across = b.alongX ? l.z : l.x;
      const at = `${tag} ${l.style} @${l.x},${l.y},${l.z}`;
      expect(['drum', 'cove', 'downlight'], at).toContain(l.style);
      const i = g.idx(Math.floor(l.x / CELL), Math.floor(l.z / CELL));
      expect(g.area[i], at).toBe(a.id);
      if (g.hasCeil(i)) expect(l.y, `${at}: under the cell ceiling`).toBeLessThan(g.ceil[i]);
      if (l.style === 'drum') {
        expect(Math.min(...centres.map(c => Math.abs(c - along))), `${at}: a bay centre`).toBeLessThan(0.01);
        expect(l.y, `${at}: >= DRUM_MIN_Y over the floor`).toBeGreaterThanOrEqual(form.floor + DRUM_MIN_Y - 0.01);
        expect(l.y, `${at}: DRUM_CLEAR under the soffit`).toBeLessThanOrEqual(soffitAt(form, l.x, l.z, g) - DRUM_CLEAR + 0.01);
      } else if (l.style === 'cove') {
        if (vaulted) expect(Math.min(...springCoves(form).map(c => Math.abs(c - across))), `${at}: a springing ledge`).toBeLessThan(0.01);
        else {
          // beside the beam (never inside it: the kit centres the strip + ledge on the source), on the beam's cove ledge
          expect(Math.min(...lines.map(c => Math.abs(Math.abs(c - along) - coveOffset(form)))), `${at}: beside a bay line`).toBeLessThan(0.01);
          if (form.beamW > 0) {
            expect(Math.min(...lines.map(c => Math.abs(c - along))), `${at}: clear of the beam`).toBeGreaterThan(form.beamW / 2 + 0.1);
            expect(l.y, `${at}: the cove ledge`).toBeCloseTo(coveY(form), 2);
          }
        }
      } else {
        expect(vaulted, `${at}: no downlight under a vault`).toBe(false);
        expect(Math.min(...centres.map(c => Math.abs(c - along))), `${at}: a bay centre`).toBeLessThan(0.01);
        expect(l.y, `${at}: just under the visible soffit`).toBeLessThanOrEqual(soffitAt(form, l.x, l.z, g));
      }
    }
    const working = own.filter(l => !l.broken && !l.dying).length;
    expect(working / own.length, `${tag}: >= 60 % working`).toBeGreaterThanOrEqual(0.6);
  }
}

describe('version 2 keeps every record but its hall lights', () => {
  it('the everything-but-lights hashes of grand-hall, cavern and hub seeds are the build before this task', () => {
    for (const [s, pin] of Object.entries(V2_PINS)) {
      const L = gen(Number(s), 2, 1);
      expect(layoutHash({...L, lights: undefined}), `seed ${s} (${L.archetype})`).toBe(pin);
      expect(L.areas.some(a => a.hallSection), `seed ${s}: no version-3 section`).toBe(false);
    }
  }, 240_000);

  it('the relit halls of version-2 stations are lit in their bay rhythm (grand hall, cavern end hall, hub interchange)', () => {
    for (const s of [3, 2, 16]) expectLightRhythm(gen(s, 2, 1), `v2 seed ${s}`);
  }, 120_000);
});

describe('version 3 changes only the grand-hall family', () => {
  it('the version-3 roll is version 2\'s; cavern, hub and classic seeds build their version-2 layouts exactly (lights included)', () => {
    expect(SUBWAY_LAYOUT_VERSION).toBe(SUBWAY_HALL_V3_MIN_VERSION);
    for (const s of [2, 16, 1, 6]) {
      const a = gen(s, 2), b = gen(s, 3);
      expect(b.archetype, `seed ${s}`).toBe(a.archetype);
      expect(layoutHash(b), `seed ${s} (${b.archetype})`).toBe(layoutHash(a));
    }
  }, 120_000);

  it('a version-3 grand hall keeps version 2\'s macro plan (the same areas and openings; the hall gets its section and nave height)', () => {
    for (const s of Object.values(VARIANT_SEEDS)) {
      const a = gen(s, 2), b = gen(s, 3);
      expect(b.archetype).toBe('grand-hall');
      const rect = (q: Area) => `${q.id}:${q.type}:${q.role ?? ''}:${q.x},${q.y},${q.w},${q.h}`;
      expect(b.areas.filter(q => !q.ext).map(rect), `seed ${s}`).toEqual(a.areas.filter(q => !q.ext).map(rect));
      const door = (d: StationLayout['doors'][number]) => `${d.a}-${d.b}:${d.x},${d.y},${d.w},${d.h}:${d.fare ? 'F' : ''}`;
      expect(b.doors.map(door), `seed ${s}`).toEqual(a.doors.map(door));
      expect(grandHall(a).hallSection).toBeUndefined();
      expect(grandHall(b).hallSection?.variant).toBeTruthy();
    }
  }, 120_000);
});

describe('the version-3 great hall at natural seeds', () => {
  for (const [variant, seed] of Object.entries(VARIANT_SEEDS)) {
    it(`${variant} (seed ${seed}): the section, arcades, bays, spine, furnishing, lights; valid, the train, the extensions`, () => {
      expect(planFamilyOf(seed)).toBe('grand-hall');
      const L = gen(seed, 3);
      expect(L.archetype).toBe('grand-hall');
      expect(validateLayout(L)).toEqual([]);
      expect(playerTrainPlacement(L), 'the player train').not.toBeNull();
      expect(L.extensions?.tunnels.length ?? 0, 'a track tunnel').toBeGreaterThanOrEqual(1);
      const T = grandHall(L), S = hallSectionWorld(T)!, g = L.grid;
      expect(S.variant).toBe(variant);
      const D = T.h * CELL, nave = S.nave[1] - S.nave[0];
      // the section: a tall nave (>= 12 m deep; 40-55 % of the hall with two aisles), 5.5-8 m aisles at 4.2-4.6 m
      expect(nave).toBeGreaterThanOrEqual(12);
      expect(S.naveCeil).toBe(T.ceil);
      expect(S.naveCeil).toBeGreaterThanOrEqual(8.4);
      expect(S.naveCeil).toBeLessThanOrEqual(9.6);
      expect(S.aisleCeil).toBeGreaterThanOrEqual(4.2);
      expect(S.aisleCeil).toBeLessThanOrEqual(4.6);
      expect(S.aisles.length).toBe(variant === 'gate-aisle' ? 1 : 2);
      for (const [p, q] of S.aisles) { expect(q - p).toBeGreaterThanOrEqual(5.5); expect(q - p).toBeLessThanOrEqual(8); }
      if (variant !== 'gate-aisle') { expect(nave / D).toBeGreaterThanOrEqual(0.4); expect(nave / D).toBeLessThanOrEqual(0.55); }
      expect(variant === 'transept').toBe(!!S.transept);
      // the grid's cell ceilings: the aisles low (the transept's crossing keeps the nave height), the nave at the full height
      const inTransept = (x: number) => !!S.transept && x > S.transept[0] && x < S.transept[1];
      let aisleCells = 0;
      for (let y = T.y; y < T.y + T.h; y++) for (let x = T.x; x < T.x + T.w; x++) {
        const i = g.idx(x, y);
        if (g.area[i] !== T.id || g.cells[i] !== FLOOR) continue;
        const cx = (x + 0.5) * CELL, cz = (y + 0.5) * CELL;
        const aisle = S.aisles.some(([p, q]) => cz > p && cz < q) && !inTransept(cx);
        if (aisle) aisleCells++;
        expect(g.ceil[i], `cell ${x},${y}`).toBeCloseTo(aisle ? S.aisleCeil : T.ceil, 4); // (float32 cells)
      }
      expect(aisleCells).toBeGreaterThan(0);
      // the arcades: a column on every bay line of each nave / aisle boundary, none in the nave; the bays come from them
      const cols = L.props.filter(p => p.kind === 'column' && p.area === T.id);
      expect(cols.length).toBe(S.arcades.length * S.lines.length);
      for (const c of cols) {
        expect(Math.min(...S.arcades.map(z => Math.abs(z - c.z))), `column ${c.x},${c.z}`).toBeLessThan(0.01);
        expect(Math.min(...S.lines.map(x => Math.abs(x - c.x))), `column ${c.x},${c.z}`).toBeLessThan(0.01);
        expect(c.z < S.nave[0] || c.z > S.nave[1], 'no column in the nave').toBe(true);
      }
      const spacing = S.lines.slice(1).map((x, i) => x - S.lines[i]).filter(d => d < 12);
      for (const d of spacing) { expect(d).toBeGreaterThanOrEqual(7.9); expect(d).toBeLessThanOrEqual(9.1); }
      const bays = hallBays(L, T);
      expect(bays.fromColumns).toBe(true);
      expect(bays.lines).toEqual(S.lines.map(x => Math.round(x * 100) / 100));
      // the spine: 6 m down the nave, clear end to end
      expect(S.spine[1] - S.spine[0]).toBe(6);
      expect(S.spine[0]).toBeGreaterThanOrEqual(S.nave[0]);
      expect(S.spine[1]).toBeLessThanOrEqual(S.nave[1]);
      for (let y = Math.round(S.spine[0] / CELL); y < Math.round(S.spine[1] / CELL); y++) for (let x = T.x; x < T.x + T.w; x++) {
        const i = g.idx(x, y);
        expect(g.cells[i] === FLOOR && g.area[i] === T.id && !g.blocked[i], `spine cell ${x},${y}`).toBe(true);
      }
      // the furnishing: gate banks (the version-2 rule), a ticket office, nave signs, islands; holders in the version-2 range
      const sum = hallV3Summary(L).find(q => q.area === T.id)!;
      const fares = L.doors.filter(d => d.fare && (d.a === T.id || d.b === T.id));
      expect(sum.columns).toBe(cols.length);
      expect(sum.gateBooths, 'a booth at every gate bank').toBe(fares.length);
      expect(sum.officeBooths, 'the ticket office').toBeGreaterThanOrEqual(2);
      expect(sum.machines).toBeGreaterThanOrEqual(2 * fares.length);
      expect(sum.signs, 'hung nave signs').toBe(3);
      expect(L.signs.filter(q => q.area === T.id && q.hang && q.y < S.aisleCeil).length).toBeGreaterThanOrEqual(3);
      const islands = sum.islands.seating + sum.islands.info + sum.islands.news + sum.islands.food;
      expect(islands, 'nave islands').toBeGreaterThanOrEqual(2);
      const holders = L.props.filter(p => p.area === T.id && isLootHolderKind(p.kind)).length;
      expect(holders).toBe(sum.holdersAfter);
      expect(holders).toBeGreaterThanOrEqual(HALL_V3_HOLDER_MIN);
      expect(holders).toBeLessThanOrEqual(Math.max(HALL_V3_HOLDER_CAP, sum.holdersBefore));
      expectLightRhythm(L, `v3 seed ${seed}`);
      // the cove rows: one along position per bay line (the kit's same-row test), inside the nave less COVE_INSET (clear of the arcades)
      const coves = L.lights.filter(l => l.area === T.id && l.style === 'cove');
      expect(coves.length).toBeGreaterThan(0);
      const rows = new Map<number, number[]>();
      for (const l of coves) {
        expect(l.z, `cove ${l.x},${l.z}`).toBeGreaterThanOrEqual(S.nave[0] + COVE_INSET);
        expect(l.z, `cove ${l.x},${l.z}`).toBeLessThanOrEqual(S.nave[1] - COVE_INSET);
        const line = S.lines.reduce((p, q) => (Math.abs(q - l.x) < Math.abs(p - l.x) ? q : p));
        rows.set(line, [...(rows.get(line) ?? []), l.x]);
      }
      for (const xs of rows.values()) expect(new Set(xs).size, 'one along position per cove row').toBe(1);
    }, 120_000);
  }

  it('the arcade lines: 8-9 m apart, centred, on cell centres', () => {
    const xs = arcadeLines(10, 100, 8.5);
    expect(xs.length).toBe(Math.floor(94 / 8.5));
    for (const x of xs) expect(Math.abs(((x / CELL) % 1) - 0.5)).toBeLessThan(1e-9);
    expect(Math.abs((xs[0] - 10) - (110 - xs[xs.length - 1]))).toBeLessThanOrEqual(CELL);
  });

  it('the player train at the placement test seeds (11, 9001) and the Surface Run access (seed 15)', () => {
    for (const s of [11, 9001]) {
      const L = generateStation(s, {archetype: 'grand-hall', layoutVersion: 3});
      expect(grandHall(L).hallSection, `${s}`).toBeTruthy();
      expect(validateLayout(L), `${s}`).toEqual([]);
      expect(playerTrainPlacement(L), `${s}`).not.toBeNull();
    }
    // each Surface Run version explicitly (as subway-plan-families): version 1 opens the closed exit's stairwell, version 2 puts its
    // cargo lift at the far end of a closed exit hall
    const L0 = gen(VARIANT_SEEDS.basilica, 3, 0);
    expect(L0.surfaceAccess).toBeUndefined();
    const base = new Set(validateLayout(L0));
    for (const [v, kind] of [[1, 'subway-stair'], [2, 'lift']] as const) {
      const L1 = gen(VARIANT_SEEDS.basilica, 3, v);
      const a = L1.surfaceAccess!;
      expect(a?.kind, `v${v}`).toBe(kind);
      expect(L1.areas[a.hall!].type, `v${v}`).toBe('exit-stair');
      expect(validateLayout(L1).filter(x => !base.has(x)), `v${v}`).toEqual([]);
    }
  }, 240_000);

  it('deterministic, and within the generation budget (warm)', () => {
    const s = VARIANT_SEEDS.transept;
    generateStation(101, {archetype: 'grand-hall', layoutVersion: 3});
    const t0 = performance.now();
    const L = generateStation(s, {layoutVersion: 3});
    expect(performance.now() - t0).toBeLessThan(2500);
    expect(layoutHash(generateStation(s, {layoutVersion: 3}))).toBe(layoutHash(L));
  }, 120_000);
});
