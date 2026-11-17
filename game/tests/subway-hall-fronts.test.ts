// Task studio-subway-rework-m2-finishing-20261117-111246-01 (lane FRONTS): a version-3 grand hall's FUNCTIONAL FRONTS and PURPOSEFUL
// CLERESTORY BAYS in the render kit (world/subwayKitFronts.ts) and in the hall light plan (gen/subwayHallLights.ts), the transept crossing's
// fixtures and the per-scheme fixture colour.
//  - against SYNTHETIC records (until the dresser writes them): a real version-3 hall of each variant gets an office, wall / nave waiting
//    groups, a kiosk and a service point (HallSection.fronts, placed on its own booths / benches) and a clock / tablet / grille bay
//    (HallSection.upper); the kit draws the office fascia / canopy / piers, the hung clocks, the backdrop, the inlays and headers, the
//    three features in place of their bays' blind panels — none of it in a booth or an opening;
//  - the light plan: each front gets its own fixtures in place of its bays' generic downlights, the hall stays <= MAX_HALL_SOURCES and
//    >= 60 % working; the transept's crossing hangs lanterns (no downlight up in its coffers); the scheme tints reach the field;
//  - version 2: every light's position, style, state and count exactly as before (only the scheme tint is new).

import * as THREE from 'three';
import {describe, expect, it} from 'vitest';
import {installCanvasShim} from './helpers/canvas2d';
import {fakeEnvTextures} from './helpers/openablesFixture';
import {LEVELS} from '../src/levels/registry';
import {CELL, FLOOR, Grid} from '../src/gen/grid';
import {hallSectionWorld} from '../src/gen/hallSection';
import {ceilingFormOf, soffitAt} from '../src/gen/subwayCeilings';
import {DRUM_CLEAR, DRUM_MIN_Y, MAX_HALL_SOURCES, NAVE_CLOCK_CLEAR, NAVE_LANTERN_REACH, SCHEME_TINT, SIGN_CLEAR, planHallLights, relitHall} from '../src/gen/subwayHallLights';
import {OFFICE_FASCIA, STATION_CLOCK, frontClockSpot} from '../src/gen/hallFrontGeometry';
import {PROP_DEFS} from '../src/gen/props';
import {bayBounds} from '../src/gen/subwayBays';
import type {Area, HallFront, HallSection, HallUpperFeature, LightPlacement, StationLayout} from '../src/gen/stationTypes';
import {WorldMaterials} from '../src/world/materials';
import {buildWorld, layoutFixture, type BuiltWorld} from '../src/world/builder';
import {buildSubwayKit, hallKit, type KitStats} from '../src/world/subwayKit';
import {HallFrontsKit, type FrontHall} from '../src/world/subwayKitFronts';
import {normalizeFaces} from '../src/world/wallDetailFaces';
import {bakeLightField, fixtureTint, sampleField} from '../src/world/lightField';

installCanvasShim(false);

/** Natural version-3 grand halls (subway-hall-v3.test.ts VARIANT_SEEDS): transept / brutalist, gate-aisle / civic, basilica / moderne. */
const V3 = {transept: 3, 'gate-aisle': 4, basilica: 15} as const;
/**
 * The whole light list of version-2 stations (position, rotation, area, state, style, level — NOT the new scheme tint) taken with the
 * plan before this lane: a version-2 save keeps every fixture where it was. (Re-pin only with proof the change came from main.)
 */
const V2_LIGHT_PINS: Record<number, string> = {3: '424:9667c219', 2: '348:b9413906', 16: '386:7fbd84be', 4: '402:3bb67ea5', 15: '465:dfa6399'};

const gen = (seed: number, version: number): StationLayout => LEVELS.subway.generate('main', {levelSeed: seed, layoutVersion: version});
const lightsHash = (ls: readonly LightPlacement[]) => {
  const json = JSON.stringify(ls.map(l => [l.x, l.y, l.z, l.rot, l.area, l.broken, l.flicker, l.warm, l.power, l.dying, l.style ?? null, l.level ?? 0]));
  let x = 2166136261;
  for (let i = 0; i < json.length; i++) x = Math.imul(x ^ json.charCodeAt(i), 16777619);
  return `${ls.length}:${(x >>> 0).toString(16)}`;
};
const mats = () => new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17});
/** The station with its great hall's dresser records (fronts / upper) and the clerestory tablets' signs taken off, its lights re-planned. */
function withoutRecords(L: StationLayout): StationLayout {
  const T = grandHall(L), S = hallSectionWorld(T)!;
  T.hallSection = {...T.hallSection!, fronts: undefined, upper: undefined};
  L.signs = L.signs.filter(q => !(q.area === T.id && !q.hang && S.nave.some(f => Math.abs(q.z - f) < 0.2)));
  planHallLights(L);
  return L;
}
const grandHall = (L: StationLayout): Area => L.areas.find(a => a.role === 'grand-ticket-hall')!;

interface Injected { L: StationLayout; T: Area; S: HallSection; fronts: HallFront[]; upper: HallUpperFeature[]; tabletSign: number }

/**
 * A real version-3 station with synthetic fronts / upper features on its great hall (world records converted to the stored relative
 * ones), placed on its own furniture: the office over its booth row, a wall waiting group over a bench pair, a nave seating island, a kiosk
 * on a south-aisle stall / cart (else a free bay), a service point on a ticket machine bank; a clock, a tablet (with its sign) and a grille.
 */
function inject(seed: number): Injected {
  const L = withoutRecords(gen(seed, 3)), T = grandHall(L), S0 = hallSectionWorld(T)!;
  const al = T.x * CELL, ac = T.y * CELL, zN = T.y * CELL, zS = (T.y + T.h) * CELL;
  const props = L.props.filter(p => p.area === T.id);
  const fronts: HallFront[] = [];
  // the office: the longest run of booths at a 3 m pitch against the north wall
  const booths = props.filter(p => p.kind === 'booth' && Math.abs(p.z - p.hz - zN) < 0.1).sort((p, q) => p.x - q.x);
  let run: typeof booths = [], best: typeof booths = [];
  for (const b of booths) { if (run.length && Math.abs(b.x - run[run.length - 1].x - 3) > 0.05) run = []; run.push(b); if (run.length > best.length) best = run.slice(); }
  expect(best.length, `seed ${seed}: an office row`).toBeGreaterThanOrEqual(2);
  fronts.push({kind: 'office', wall: 'N', along: [best[0].x - 1.5, best[best.length - 1].x + 1.5], across: [zN, zN + 2.2 + 1.7], label: 'TICKETS'});
  // a wall waiting group: two benches side by side against the south wall (or the south strip of a one-aisle hall)
  const wall = props.filter(p => p.kind === 'bench' && Math.abs(p.z + p.hz - zS) < 0.1).sort((p, q) => p.x - q.x);
  const pair = wall.find((b, i) => wall[i + 1] && wall[i + 1].x - b.x < 2.5);
  if (pair) fronts.push({kind: 'waiting', wall: 'S', along: [pair.x - 1.2, pair.x + 2.32 + 1.2], across: [zS - 1.8, zS], label: 'WAITING'});
  // a nave seating island (two back-to-back pairs)
  const isl = props.filter(p => p.kind === 'bench' && p.z > S0.nave[0] && p.z < S0.nave[1]).sort((p, q) => p.x - q.x)[0];
  if (isl) fronts.push({kind: 'waiting', wall: 'nave', along: [isl.x - 1.5, isl.x + 3.3], across: [isl.z - 1.2, isl.z + 1.7]});
  // a kiosk on the south side (a stall / cart pocket, else a free bay's wall), a service point on the north wall's machines
  const lines = S0.lines, bays = lines.slice(1).map((x, i) => [lines[i], x] as [number, number]);
  const stall = props.find(p => (p.kind === 'stall' || p.kind === 'hotdogCart') && p.z > S0.nave[1]);
  const kb = stall ? [stall.x - 2.2, stall.x + 2.2] as [number, number] : [bays[1][0] + 1, bays[1][1] - 1] as [number, number];
  fronts.push({kind: 'kiosk', wall: 'S', along: kb, across: [zS - 3.5, zS], label: 'NEWS'});
  const tm = props.filter(p => p.kind === 'ticketMachine' && Math.abs(p.z - p.hz - zN) < 0.2).sort((p, q) => p.x - q.x)[0];
  if (tm) fronts.push({kind: 'service', wall: 'N', along: [tm.x - 1.0, tm.x + 3.0], across: [zN, zN + 2.0], label: 'INFORMATION'});
  // the clerestory: a clock over the north arcade, a tablet over the south one (two-aisle halls; else the north), a grille
  const faceN = S0.nave[0], faceS = S0.aisles.length > 1 ? S0.nave[1] : S0.nave[0];
  // (bays with a clerestory: never the transept's crossing, whose aisle cells keep the nave ceiling)
  const clere = bays.filter(([p, q]) => !S0.transept || q <= S0.transept[0] + 0.01 || p >= S0.transept[1] - 0.01);
  const pick = (k: number) => clere[Math.min(clere.length - 1, k)];
  const upper: HallUpperFeature[] = [
    {kind: 'clock', face: faceN, facing: 1, along: pick(2)},
    {kind: 'tablet', face: faceS, facing: faceS === faceN ? 1 : -1, along: pick(4), text: 'TICKETS · TRAINS'},
    {kind: 'grille', face: faceN, facing: 1, along: pick(6)},
  ];
  // the tablet's sign (the dresser's job): centred on the bay, 0.06 m proud of the face (the dresser's own tablets were taken off)
  const [t0, t1] = upper[1].along, tw = Math.min(t1 - t0 - 1.6, 4.5);
  L.signs.push({x: (t0 + t1) / 2, y: S0.aisleCeil + 1.9, z: faceS + upper[1].facing * 0.06, rot: upper[1].facing > 0 ? 0 : Math.PI, kind: 'info', text: 'TICKETS · TRAINS', area: T.id, w: tw});
  const rel = <F extends {along: [number, number]}>(f: F, acr: (v: number) => number, k: 'across' | 'face') => ({...f, along: [f.along[0] - al, f.along[1] - al], ...(k === 'across' ? {across: (f as unknown as HallFront).across.map(acr)} : {face: acr((f as unknown as HallUpperFeature).face)})});
  T.hallSection = {...T.hallSection!, fronts: fronts.map(f => rel(f, v => v - ac, 'across') as HallFront), upper: upper.map(u => rel(u, v => v - ac, 'face') as HallUpperFeature)};
  planHallLights(L);
  const S = hallSectionWorld(T)!;
  return {L, T, S, fronts: S.fronts!, upper: S.upper!, tabletSign: L.signs.length - 1};
}

/** A recording kit sink: every box / geometry with its material and world bounds. */
function recorder() {
  const items: {mat: string; geo: boolean; min: THREE.Vector3; max: THREE.Vector3}[] = [];
  return {
    items,
    sink: {
      box: (mat: string, cx: number, cy: number, cz: number, sx: number, sy: number, sz: number) => items.push({mat, geo: false, min: new THREE.Vector3(cx - sx / 2, cy - sy / 2, cz - sz / 2), max: new THREE.Vector3(cx + sx / 2, cy + sy / 2, cz + sz / 2)}),
      geo: (mat: string, g: THREE.BufferGeometry) => { g.computeBoundingBox(); items.push({mat, geo: true, min: g.boundingBox!.min.clone(), max: g.boundingBox!.max.clone()}); },
    },
  };
}
const overlaps = (a: {min: THREE.Vector3; max: THREE.Vector3}, b: {min: THREE.Vector3; max: THREE.Vector3}, e = 1e-3) =>
  a.min.x < b.max.x - e && a.max.x > b.min.x + e && a.min.y < b.max.y - e && a.max.y > b.min.y + e && a.min.z < b.max.z - e && a.max.z > b.min.z + e;

const built = new Map<number, {inj: Injected; w: BuiltWorld}>();
function station(seed: number) {
  let s = built.get(seed);
  if (!s) { const inj = inject(seed); built.set(seed, (s = {inj, w: buildWorld(inj.L, mats(), {})})); }
  return s;
}
/** The fronts kit alone over a built station (its boxes / geometries recorded). */
function frontsOnly(L: StationLayout, w: BuiltWorld) {
  const rec = recorder();
  const halls = new Map<number, FrontHall>();
  for (const a of L.areas) { const k = w.subwayArch!.publicArea(a) ? hallKit(L, a) : null; if (k) halls.set(a.id, {a, form: k.form, g: L.levels?.[a.level ?? 0]?.grid ?? L.grid}); }
  const faces = normalizeFaces(w.wallFaces).filter(f => !f.slope && /^subway-/.test(f.finish));
  const fk = new HallFrontsKit(rec.sink.box, rec.sink.geo, L, w.subwayArch!, halls, faces);
  fk.fronts();
  return {fk, items: rec.items};
}
const kitOf = (L: StationLayout, w: BuiltWorld) => {
  const rec = recorder();
  const stats: KitStats = buildSubwayKit(rec.sink, {layout: L, gridOf: lv => L.levels?.[lv]?.grid ?? L.grid, faces: w.wallFaces, sub: w.subwayArch!});
  return {stats, items: rec.items};
};

describe('the fronts kit (synthetic records on real version-3 halls)', () => {
  for (const [variant, seed] of Object.entries(V3)) {
    it(`${variant} (seed ${seed}): office fascia / canopy / piers, clocks, backdrop, inlays, headers — clear of booths and openings`, () => {
      const {inj, w} = station(seed);
      const {L, T, fronts} = inj;
      const {fk, items} = frontsOnly(L, w);
      const st = fk.stats;
      const sub = w.subwayArch!;
      expect(st.fascias, 'the office fascia').toBeGreaterThanOrEqual(1);
      expect(st.canopies).toBe(st.fascias);
      expect(st.piers, 'framing piers').toBeGreaterThanOrEqual(1);
      expect(st.clocks, 'a hung clock per waiting front').toBe(fronts.filter(f => f.kind === 'waiting').length);
      expect(st.inlays, 'kiosk / service inlays').toBe(fronts.filter(f => f.kind === 'kiosk' || f.kind === 'service').length);
      if (fronts.some(f => f.kind === 'waiting' && f.wall !== 'nave')) expect(st.backdrops).toBeGreaterThanOrEqual(1);
      expect(st.fronts).toBe(fronts.length);
      // existing finish keys only
      const keys = new Set([sub.accentKey(), sub.pierKey(T), sub.trimKey(), sub.baseKey(), sub.zoneFinish('ceil', T).key, 'steel']);
      for (const it of items) expect(keys.has(it.mat), it.mat).toBe(true);
      // the office pieces: the fascia band 2.85-3.35 m (+ lip), 0.3 m out; nothing of the kit below 2.85 m over the office's booths
      const floor = T.floorY ?? 0;
      const booths = L.props.filter(p => p.area === T.id && p.kind === 'booth').map(p => ({min: new THREE.Vector3(p.x - p.hx, p.y, p.z - p.hz), max: new THREE.Vector3(p.x + p.hx, p.y + PROP_DEFS.booth.h, p.z + p.hz)}));
      expect(booths.length).toBeGreaterThan(0);
      for (const it of items) for (const b of booths) expect(overlaps(it, b), `${it.mat} ${it.min.toArray()} - ${it.max.toArray()} in a booth`).toBe(false);
      const office = fronts.find(f => f.kind === 'office')!;
      const zN = T.y * CELL;
      const fascia = items.filter(it => it.mat === sub.accentKey() && !it.geo && it.min.y >= floor + OFFICE_FASCIA.y0 - 1e-6 && it.max.y <= floor + OFFICE_FASCIA.y1 + 0.1 && it.min.x >= office.along[0] - 0.5 && it.max.x <= office.along[1] + 0.5);
      expect(fascia.length).toBeGreaterThan(0);
      for (const f of fascia) expect(f.min.z).toBeGreaterThanOrEqual(zN - 1e-6);
      // every piece stands on / in front of its wall and out of every door opening below the door's head
      const doors = L.doors.map(d => ({min: new THREE.Vector3(d.x * CELL + 0.06, floor, d.y * CELL + 0.06), max: new THREE.Vector3((d.x + d.w) * CELL - 0.06, floor + d.height, (d.y + d.h) * CELL - 0.06)}));
      for (const it of items) for (const d of doors) expect(overlaps(it, d), `${it.mat} ${it.min.toArray()} in a doorway`).toBe(false);
      // the hung clocks: the drum's underside >= 2.6 m, the rod up to the ceiling above it, dials facing along the hall
      for (const f of fronts.filter(q => q.kind === 'waiting')) {
        const c = frontClockSpot(T, inj.S, f);
        const drum = items.find(it => it.geo && it.mat === sub.accentKey() && Math.abs((it.min.x + it.max.x) / 2 - c.along) < 0.02 && Math.abs((it.min.z + it.max.z) / 2 - c.across) < 0.02);
        expect(drum, `the clock of ${f.wall} waiting`).toBeTruthy();
        expect(drum!.min.y - floor).toBeGreaterThanOrEqual(STATION_CLOCK.minY - 1e-6);
        expect(drum!.max.x - drum!.min.x, 'dial normal along the hall').toBeCloseTo(STATION_CLOCK.t, 2);
        expect(drum!.max.z - drum!.min.z).toBeCloseTo(STATION_CLOCK.d, 2);
        const rod = items.find(it => !it.geo && it.mat === 'steel' && it.max.x - it.min.x < 0.05 && Math.abs((it.min.x + it.max.x) / 2 - c.along) < 0.01 && Math.abs((it.min.z + it.max.z) / 2 - c.across) < 0.01);
        expect(rod, 'the rod').toBeTruthy();
        const g = L.grid, i = g.idx(Math.floor(c.along / CELL), Math.floor(c.across / CELL));
        expect(rod!.max.y, 'the rod meets the ceiling over it').toBeCloseTo(Math.min(g.ceil[i], T.ceil), 2);
        // twelve batons + two hands a face (thin steel bars), a dial a face
        const bars = items.filter(it => it.geo && it.mat === 'steel' && Math.abs((it.min.x + it.max.x) / 2 - c.along) < 0.2 && Math.abs((it.min.z + it.max.z) / 2 - c.across) < 0.5 && it.min.y > drum!.min.y - 0.01 && it.max.y < drum!.max.y + 0.01);
        expect(bars.length, 'batons, hands and bezel rings').toBe(2 * (12 + 2 + 1));
      }
      // the inlays: 6 mm on the hall's floor, on its own open floor cells only
      const inlays = items.filter(it => !it.geo && it.max.y - it.min.y < 0.007 + 1e-6);
      expect(inlays.length).toBeGreaterThan(0);
      for (const it of inlays) {
        expect(it.min.y).toBeCloseTo(floor, 6);
        const cx = Math.floor((it.min.x + it.max.x) / 2 / CELL), cz = Math.floor((it.min.z + it.max.z) / 2 / CELL), i = L.grid.idx(cx, cz);
        expect(L.grid.cells[i] === FLOOR && L.grid.area[i] === T.id).toBe(true);
      }
      // deterministic
      expect(frontsOnly(L, w).items.length).toBe(items.length);
    }, 240_000);
  }

  it('the clerestory: a clock / tablet / grille in place of their bays\' blind panels, framed inside the bay, out of openings', () => {
    for (const seed of [V3.transept, V3.basilica]) {
      const {inj, w} = station(seed);
      const {L, T} = inj;
      const sub = w.subwayArch!;
      const withF = kitOf(L, w);
      // the same station without the upper records: three more blind panels, no features
      const keep = T.hallSection!;
      T.hallSection = {...keep, upper: undefined};
      const without = kitOf(L, w);
      T.hallSection = keep;
      expect(withF.stats.features, `seed ${seed}`).toBe(3);
      expect(without.stats.features).toBe(0);
      expect(without.stats.panels - withF.stats.panels, 'each feature replaces its blind panel').toBe(3);
      expect(withF.stats.clocks).toBeGreaterThanOrEqual(1);
      // the feature pieces (the difference of the two runs) stay above the aisle ceiling, against their faces, inside their bays
      const key = (it: {mat: string; min: THREE.Vector3; max: THREE.Vector3}) => `${it.mat}|${it.min.toArray().map(v => v.toFixed(3))}|${it.max.toArray().map(v => v.toFixed(3))}`;
      const base = new Map<string, number>();
      for (const it of without.items) base.set(key(it), (base.get(key(it)) ?? 0) + 1);
      const added = withF.items.filter(it => { const k = key(it), n = base.get(k) ?? 0; if (n > 0) { base.set(k, n - 1); return false; } return true; });
      expect(added.length).toBeGreaterThan(30);
      const near = (it: {min: THREE.Vector3; max: THREE.Vector3}, q: HallUpperFeature) => (q.facing > 0 ? it.min.z - q.face : q.face - it.max.z);
      const far = (it: {min: THREE.Vector3; max: THREE.Vector3}, q: HallUpperFeature) => (q.facing > 0 ? it.max.z - q.face : q.face - it.min.z);
      for (const it of added) {
        expect(it.min.y, `${it.mat} above the aisle ceiling`).toBeGreaterThan(inj.S.aisleCeil + 0.24);
        const u = inj.upper.find(q => it.min.x >= Math.min(...q.along) - 0.01 && it.max.x <= Math.max(...q.along) + 0.01 && near(it, q) > -0.02 && far(it, q) < 0.4);
        expect(u, `${it.mat} ${it.min.toArray()} - ${it.max.toArray()} inside a feature bay, on its face, proud of it`).toBeTruthy();
      }
      // the tablet surround frames its sign plate (the plate inside the border, the border clear of the plate)
      const sign = L.signs[inj.tabletSign];
      const tab = inj.upper.find(q => q.kind === 'tablet')!;
      const border = added.filter(it => it.mat === sub.accentKey() && it.min.x >= Math.min(...tab.along) && it.max.x <= Math.max(...tab.along) && Math.abs(far(it, tab) - 0.09) < 1e-3);
      expect(border.length).toBe(4);
      const bx0 = Math.min(...border.map(b => b.min.x)), bx1 = Math.max(...border.map(b => b.max.x));
      expect(bx0).toBeLessThan(sign.x - sign.w! / 2);
      expect(bx1).toBeGreaterThan(sign.x + sign.w! / 2);
      // the grille: 8-12 steel slats
      const gr = inj.upper.find(q => q.kind === 'grille')!;
      const slats = added.filter(it => it.geo && it.mat === 'steel' && it.min.x >= Math.min(...gr.along) && it.max.x <= Math.max(...gr.along));
      expect(slats.length).toBeGreaterThanOrEqual(8);
      expect(slats.length).toBeLessThanOrEqual(12);
    }
  }, 240_000);

  it('the builder carries the kit\'s front / clock / feature counts', () => {
    const {w} = station(V3.basilica);
    const k = w.subwayArch!.kit!;
    expect(k.fronts).toBeGreaterThanOrEqual(4);
    expect(k.clocks).toBeGreaterThanOrEqual(2);
    expect(k.features).toBe(3);
  }, 240_000);
});

describe('the dresser\'s real records (lane GEN) at the natural seeds', () => {
  for (const [variant, seed] of Object.entries(V3)) {
    it(`${variant} (seed ${seed}): the kit frames every front and draws every clerestory feature; the plan lights every front`, () => {
      const L = gen(seed, 3), T = grandHall(L), S = hallSectionWorld(T)!;
      const fronts = S.fronts ?? [], upper = S.upper ?? [];
      expect(fronts.length, 'recorded fronts').toBeGreaterThanOrEqual(3);
      expect(upper.length, 'recorded clerestory features').toBeGreaterThanOrEqual(2);
      const w = buildWorld(L, mats(), {});
      const {fk, items} = frontsOnly(L, w);
      expect(fk.stats.fronts, 'every front drew its pieces').toBe(fronts.length);
      expect(fk.stats.clocks).toBe(fronts.filter(f => f.kind === 'waiting').length);
      if (fronts.some(f => f.kind === 'office')) { expect(fk.stats.fascias).toBeGreaterThanOrEqual(1); expect(fk.stats.piers).toBeGreaterThanOrEqual(1); }
      const k = w.subwayArch!.kit!;
      expect(k.features, 'every clerestory feature drawn').toBe(upper.length);
      // nothing in a booth / a doorway / another prop's footprint up to its height (the floor inlays excepted: 6 mm on the floor)
      const floor = T.floorY ?? 0;
      const solid = L.props.filter(p => p.area === T.id && p.kind !== 'column').map(p => ({kind: p.kind, min: new THREE.Vector3(p.x - p.hx, p.y, p.z - p.hz), max: new THREE.Vector3(p.x + p.hx, p.y + p.h, p.z + p.hz)}));
      const doors = L.doors.map(d => ({min: new THREE.Vector3(d.x * CELL + 0.06, floor, d.y * CELL + 0.06), max: new THREE.Vector3((d.x + d.w) * CELL - 0.06, floor + d.height, (d.y + d.h) * CELL - 0.06)}));
      for (const it of items) {
        if (it.max.y - it.min.y < 0.007 + 1e-6) continue;
        for (const p of solid) expect(overlaps(it, p), `${it.mat} ${it.min.toArray()} - ${it.max.toArray()} in a ${p.kind}`).toBe(false);
        for (const d of doors) expect(overlaps(it, d), `${it.mat} ${it.min.toArray()} in a doorway`).toBe(false);
      }
      // the clocks hang from the LOCAL ceiling (an aisle group's 4.2-4.6 m one), never through a wall sign / hung plate
      for (const f of fronts.filter(q => q.kind === 'waiting')) {
        const c = frontClockSpot(T, S, f);
        const i = L.grid.idx(Math.floor(c.along / CELL), Math.floor(c.across / CELL));
        const rod = items.find(it => !it.geo && it.mat === 'steel' && it.max.x - it.min.x < 0.05 && Math.abs((it.min.x + it.max.x) / 2 - c.along) < 0.01 && Math.abs((it.min.z + it.max.z) / 2 - c.across) < 0.01);
        expect(rod, `the clock rod of ${f.wall} waiting @${c.along},${c.across}`).toBeTruthy();
        expect(rod!.max.y).toBeCloseTo(Math.min(L.grid.ceil[i], T.ceil), 2);
        for (const sg of L.signs.filter(q => q.area === T.id && q.hang)) {
          const h = (sg.w ?? 1.4) / 2;
          expect(Math.abs(sg.z - c.across) > 0.3 || Math.abs(sg.x - c.along) - h > STATION_CLOCK.t / 2, `hung plate ${sg.text} through the clock`).toBe(true);
        }
      }
      // the light plan: <= 60, >= 60 % working, every wall / aisle front lit by its own fixture, clear of the hung plates
      const own = L.lights.filter(l => l.area === T.id);
      expect(own.length).toBeLessThanOrEqual(MAX_HALL_SOURCES);
      expect(own.filter(l => !l.broken && !l.dying).length / own.length).toBeGreaterThanOrEqual(0.6);
      const hung = L.signs.filter(q => q.area === T.id && q.hang);
      const inZone = (l: LightPlacement, f: HallFront) => l.x >= Math.min(...f.along) - 0.35 && l.x <= Math.max(...f.along) + 0.35 && l.z >= Math.min(...f.across) - 0.05 && l.z <= Math.max(...f.across) + 0.05;
      let lit = 0, wallish = 0;
      for (const f of fronts) {
        const c = (f.across[0] + f.across[1]) / 2;
        if (f.wall === 'nave' && !S.aisles.some(([p, q]) => c > p && c < q)) continue;
        wallish++;
        if (own.some(l => inZone(l, f))) lit++;
      }
      // (a hall at its budget trims a front's extras first: every front keeps at least its first fixture unless the rhythm itself is 60)
      expect(lit, 'wall / aisle fronts with their own fixture').toBe(wallish);
      const frontLights = own.filter(l => fronts.some(f => inZone(l, f)) && !(l.style === 'downlight' && bayBounds(ceilingFormOf(L, T).bays).some(([p, q]) => Math.abs(l.x - (p + q) / 2) < 0.01)));
      for (const l of frontLights) for (const sg of hung) {
        const h = (sg.w ?? 1.4) / 2, dx = Math.cos(sg.rot) * h, dz = -Math.sin(sg.rot) * h;
        const vx = 2 * dx, vz = 2 * dz, t = Math.max(0, Math.min(1, ((l.x - sg.x + dx) * vx + (l.z - sg.z + dz) * vz) / (vx * vx + vz * vz)));
        expect(Math.hypot(l.x - (sg.x - dx) - vx * t, l.z - (sg.z - dz) - vz * t), `front fixture @${l.x},${l.z} vs ${sg.text}`).toBeGreaterThanOrEqual(SIGN_CLEAR - 0.01);
      }
    }, 240_000);
  }
});

describe('the hall light plan: fronts, the transept crossing, scheme colour', () => {
  it('the transept crossing hangs lanterns at the nave drum height: no downlight up in its coffers', () => {
    const real = gen(V3.transept, 3), RT = grandHall(real), RS = hallSectionWorld(RT)!;
    // (the real plan, fronts included: no downlight up in the crossing's coffers either)
    for (const l of real.lights.filter(q => q.area === RT.id && q.style === 'downlight')) expect(l.y, `downlight @${l.x},${l.z}`).toBeLessThanOrEqual(RS.aisleCeil + 0.5);
    const L = withoutRecords(gen(V3.transept, 3)), T = grandHall(L), S = hallSectionWorld(T)!, form = ceilingFormOf(L, T), g = L.grid;
    expect(S.variant).toBe('transept');
    const own = L.lights.filter(l => l.area === T.id);
    for (const l of own.filter(q => q.style === 'downlight')) expect(l.y, `downlight @${l.x},${l.z}`).toBeLessThanOrEqual(S.aisleCeil + 0.5);
    // the crossing's aisle bands: a lantern each, at the drum rule's height under the visible soffit
    const crossing = own.filter(l => l.x > S.transept![0] && l.x < S.transept![1] && S.aisles.some(([p, q]) => l.z > p && l.z < q));
    expect(crossing.length).toBe(S.aisles.length);
    for (const l of crossing) {
      expect(l.style).toBe('drum');
      expect(l.y).toBeGreaterThanOrEqual(form.floor + DRUM_MIN_Y - 0.01);
      expect(l.y).toBeLessThanOrEqual(soffitAt(form, l.x, l.z, g) - DRUM_CLEAR + 0.01);
    }
    expect(own.length).toBeLessThanOrEqual(MAX_HALL_SOURCES);
  });

  for (const [variant, seed] of Object.entries(V3)) {
    it(`${variant} (seed ${seed}): every front gets its own fixtures in place of its bays' generic downlights; <= 60 sources, >= 60 % working`, () => {
      const plain = withoutRecords(gen(seed, 3));
      const {L, T, S, fronts} = inject(seed);
      const own = L.lights.filter(l => l.area === T.id), before = plain.lights.filter(l => l.area === T.id);
      const bays = bayBounds(ceilingFormOf(L, T).bays);
      expect(own.length).toBeLessThanOrEqual(MAX_HALL_SOURCES);
      expect(own.filter(l => !l.broken && !l.dying).length / own.length).toBeGreaterThanOrEqual(0.6);
      const inZone = (l: LightPlacement, f: HallFront, pad = 0.05) => l.x >= Math.min(...f.along) - pad && l.x <= Math.max(...f.along) + pad && l.z >= Math.min(...f.across) - pad && l.z <= Math.max(...f.across) + pad;
      for (const f of fronts) {
        if (f.wall === 'nave') {
          // the island's bay lantern hangs over it (beside a waiting island's clock), still at its bay centre
          const c = (f.across[0] + f.across[1]) / 2, mid = (f.along[0] + f.along[1]) / 2;
          const bay = bays.find(([p, q]) => mid >= p && mid < q)!;
          const drum = own.find(l => l.style === 'drum' && Math.abs(l.x - (bay[0] + bay[1]) / 2) < 0.01);
          expect(drum, `nave ${f.kind}: its bay's lantern`).toBeTruthy();
          // (already under it within NAVE_LANTERN_REACH: kept on the line; a waiting island's lantern never on its clock)
          const line = (S.nave[0] + S.nave[1]) / 2, d = Math.abs(line - c);
          if (f.kind === 'waiting') expect(Math.abs(drum!.z - c), `nave waiting`).toBeCloseTo(d < NAVE_CLOCK_CLEAR || d > NAVE_LANTERN_REACH ? NAVE_CLOCK_CLEAR : d, 2);
          else expect(drum!.z, `nave ${f.kind}`).toBeCloseTo(d > NAVE_LANTERN_REACH ? c : line, 2);
          continue;
        }
        const mine = own.filter(l => inZone(l, f));
        expect(mine.length, `${f.kind} ${f.wall}: its own fixtures`).toBeGreaterThanOrEqual(1);
        if (f.kind === 'office') {
          // one per booth window (trimmed, extras first, only when the hall is at its budget)
          const n = Math.max(1, Math.min(4, Math.round((Math.max(...f.along) - Math.min(...f.along)) / 3)));
          expect(mine.length).toBeLessThanOrEqual(n);
          if (own.length < MAX_HALL_SOURCES) expect(mine.length).toBe(n);
        }
        for (const l of mine) {
          // under the visible soffit: a downlight in the aisle ceiling, a lantern under a full height
          const form = ceilingFormOf(L, T), s = soffitAt(form, l.x, l.z, L.grid);
          if (l.style === 'downlight') { expect(l.y).toBeLessThan(s); expect(l.y).toBeGreaterThan(s - 0.1); expect(s).toBeLessThanOrEqual(S.aisleCeil + 0.5); }
          else { expect(l.style).toBe('drum'); expect(l.y).toBeLessThanOrEqual(s - DRUM_CLEAR + 0.01); }
        }
        // a waiting front's fixture keeps clear of its clock
        if (f.kind === 'waiting') {
          const c = frontClockSpot(T, S, f);
          for (const l of mine) expect(Math.hypot(l.x - c.along, l.z - c.across)).toBeGreaterThan(1.0);
        }
        // the generic aisle-centre downlights of the bays it covers are gone (replaced, not added on top)
        const c = (f.across[0] + f.across[1]) / 2, band = S.aisles.find(([p, q]) => c > p && c < q);
        if (!band) continue;
        const lo = Math.min(...f.along), hi = Math.max(...f.along), bc = (band[0] + band[1]) / 2;
        let gone = 0;
        for (const [p, q] of bays) {
          if (Math.min(hi, q) - Math.max(lo, p) < 0.35 * (q - p)) continue;
          const at = (l: LightPlacement) => l.style === 'downlight' && Math.abs(l.x - (p + q) / 2) < 0.01 && Math.abs(l.z - bc) < 0.01;
          if (!before.some(at)) continue;
          expect(own.some(at), `${f.kind}: the generic downlight of bay ${p}-${q}`).toBe(false);
          gone++;
        }
        if (f.kind === 'office') expect(gone, `${f.kind} ${f.wall}: replaced at least one generic downlight`).toBeGreaterThanOrEqual(1);
      }
    });
  }

  it('styled fixtures take their scheme\'s colour temperature; the warm schemes keep the warm default; it reaches the field and the runtime fixture', () => {
    const cases: [number, number, string][] = [[V3.transept, 3, 'brutalist'], [V3['gate-aisle'], 3, 'civic'], [V3.basilica, 3, 'moderne'], [16, 2, 'terracotta'], [2, 2, 'cavernRed'], [3, 2, 'brutalist']];
    for (const [seed, v, theme] of cases) {
      const L = gen(seed, v);
      expect(L.identity!.theme, `seed ${seed}`).toBe(theme);
      const styled = L.lights.map((l, i) => ({l, i})).filter(q => q.l.style);
      expect(styled.length).toBeGreaterThan(0);
      for (const {l, i} of styled) {
        if (SCHEME_TINT[theme]) {
          expect(l.tint, `${theme} ${l.style}`).toEqual(SCHEME_TINT[theme]);
          expect(fixtureTint(l)).toEqual(SCHEME_TINT[theme]);
          expect(layoutFixture(l, i).tint).toEqual(SCHEME_TINT[theme]);
        } else expect(l.tint, `${theme} ${l.style}`).toBeUndefined();
      }
      // unstyled fixtures are untouched
      for (const l of L.lights.filter(q => !q.style)) expect(l.tint).toBeUndefined();
    }
    // ~unit luminance; civic neutral (blue / red ~0.83), brutalist cool (blue > red)
    for (const t of Object.values(SCHEME_TINT)) expect(0.2126 * t[0] + 0.7152 * t[1] + 0.0722 * t[2]).toBeCloseTo(1, 1);
    expect(SCHEME_TINT.brutalist[2]).toBeGreaterThan(SCHEME_TINT.brutalist[0]);
    expect(SCHEME_TINT.civic[2] / SCHEME_TINT.civic[0]).toBeGreaterThan(0.75);
    // the baked field takes the colour: a brutalist lantern bakes bluer than the default warm one
    const grid = (): Grid => { const w = 40, gg = new Grid(w, w); for (let y = 1; y < w - 1; y++) for (let x = 1; x < w - 1; x++) { gg.set(x, y, FLOOR); gg.ceil[y * w + x] = 9; gg.area[y * w + x] = 0; } return gg; };
    const lamp = (tint?: readonly [number, number, number]): LightPlacement => ({x: 10.25, y: 5, z: 10.25, rot: 0, area: 0, broken: false, flicker: false, warm: true, power: 0.9, dying: false, style: 'drum', ...(tint ? {tint} : {})});
    const ratio = (l: LightPlacement) => { const f = bakeLightField({grid: grid(), lights: [l], trenchFloorY: -1.15}); const s = sampleField(f, 10.25, 0.1, 10.25, [1, 1, 1], [0, 1, 0]); const c = s.amb.map((v, k) => v + s.dirColor[k]); return c[2] / c[0]; };
    expect(ratio(lamp(SCHEME_TINT.brutalist))).toBeGreaterThan(ratio(lamp()) * 2);
  }, 120_000);

  it('version 2: every light where it was (position, style, state, count); only the scheme tint is new', () => {
    for (const [s, pin] of Object.entries(V2_LIGHT_PINS)) {
      const L = gen(Number(s), 2);
      expect(L.areas.some(a => a.hallSection), `seed ${s}`).toBe(false);
      expect(lightsHash(L.lights), `seed ${s} (${L.identity?.theme})`).toBe(pin);
      expect(L.areas.filter(relitHall).length).toBeGreaterThan(0);
    }
  }, 120_000);
});
