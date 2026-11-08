// Task track3-eaton-centre-20261031 (lane GEN): the mall (LevelId 'mall') generator tests.
// Task mall-playtest-revision-20261031 (lane GEN): REWRITTEN for the compact redesign (the six-ring tests are gone with the six rings):
// registration + the seeded "<Name> Center" (determinism, different-seed variation, UI helper agreement), station + three retail
// floors at real heights, area / unit budgets on a small fixed sample, the ten lot families (registry + coverage + sizes), the small
// irregular atrium (nested per-floor openings, the station-to-sky ray, glass only over the top opening), corridors / loops / dead-end
// branches per variant, >= 2 independent routes station <-> every floor, wayfinding, the patrol graph over corridors, Track2's seam
// (rockLevels [0], one east tunnel) — and a REAL Player (the game's own movement / stairs / support code, W key) walking from the
// station platform up to the top floor continuously without falling. Layouts are cached per file (3 variants x 1 seed + 1 extra seed).
// Task mall-round2-20261031 (lane GEN): M08 — six topologies (+ 'tee-junction' / 'twin-court' / 'offset-arcade'), every per-variant
// case runs on all six; the seed -> variant draw (originals keep their exact previous variant); the original three variants' core
// geometry for (SEED, variant) pinned to main 1366b95 and identical with / without the street-exit post-pass. M09 — locked street
// exits only on the street storey (floor 1), SOLID behind the glass, a view volume outside every storey, connectivity intact, and a
// real Player (walk / sprint / jump) that can never pass the glass; bullets / sight stop at it.

import {describe, expect, it} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {hashString} from '../src/core/rng';
import {levelDistance} from '../src/gen/levelGen';
import {LEVELS, LEVEL_IDS, arrivalPose, isLevelId, levelDisplayName, storeyLabel, travelTargets} from '../src/levels/registry';
import {TRACK_EXT_MALL, extensionIssues, trackExtCoverageIssues} from '../src/gen/trackExt/index';
import {generateMallLevel, mallIssues, mallRouteGroups, mallVoidCells, mallVariantOf, setMallVariantOverride, exitColliderCells, EXIT, MALL_GEN_STATS, MALL_STREET_LEVEL, MALL_VARIANTS, type MallVariant} from '../src/gen/mall/index';
import {MALL_GENERIC_NAME, MALL_NAME_HEADS, REAL_NAME_BLOCKLIST, mallNameCandidates, mallNameOf} from '../src/gen/mall/names';
import {MALL_LOTS, MALL_LOT_IDS, lotSuits, lotsForProgram} from '../src/gen/mall/lots';
import {MALL_PROGRAMS} from '../src/gen/mall/shops';
import {levelsOf} from '../src/gen/levels';
import {CELL, FLOOR, SOLID, PathFinder, type Waypoint} from '../src/gen/grid';
import {Player} from '../src/player/player';
import {FLOORS, MALL_VARIANTS_ADDED, MALL_VARIANTS_V2, STOREY} from '../src/gen/mall/frame';
import {MALL_FLOORS, type MallProgram} from '../src/gen/mall/mallTypes';
import type {StationLayout} from '../src/gen/stationTypes';
import {readTowerInfo} from '../src/world/towerShared';
import {planElevator} from '../src/world/elevator';
import {MALL_POSE_NAMES, mallQaPose} from '../src/gen/mall/qa';

const SEED = 0x7ea3c1;
const DT = 1 / 60;
/** Track3's six-ring mall, for the budget comparison (track3 GEN.done: ~43,300 m² walkable mean, 7 storeys, ~80 units, 36 m roof spring). */
const OLD = {walk: 43_300, units: 80, spring: 36};

class Keys {
  held = new Set<string>();
  /** A key pressed this frame (jump). */
  tap = '';
  down(c: string) { return this.held.has(c); }
  hit(c: string) { return c === this.tap; }
}

/**
 * GEN-owned core geometry of a mall layout (street-exit halls and Track2 extensions excluded; no props / programs / labels: other
 * lanes' data) — the M08 stability pin of the original variants.
 */
function coreGeometry(L: StationLayout): string {
  const halls = new Set((L.mall?.exits ?? []).filter(e => e.kind === 'entrance-hall').map(e => e.hall.area));
  const keep = (id: number) => !halls.has(id) && !L.areas[id]?.ext;
  const m = L.mall!;
  return createHash('sha1').update(JSON.stringify([
    L.areas.filter(a => keep(a.id)).map(a => [a.id, a.x, a.y, a.w, a.h, a.kind, a.type, a.level ?? 0, Math.round(a.ceil * 1000), a.parent, a.role ?? '', a.publicSpace]),
    // (task store-polish-20261103, lane STORE: a shop's OWN interior doorways (a === b: the lingerie changing suite's room / suite doors,
    // carved by the shop fit-out after the GEN pass) are not GEN geometry)
    L.doors.filter(d => keep(d.a) && keep(d.b) && d.a !== d.b).map(d => [d.x, d.y, d.w, d.h, d.a, d.b, Math.round(d.height * 1000), !!d.shopfront, !!d.staff, d.level ?? 0]),
    m.shops.map(q => [q.id, q.area, q.backroom ?? -1, q.level, q.lot, q.zone, q.frontages, q.salesArea, q.depth, q.width]),
    L.traversal.stairs.filter(f => keep(f.area)).map(f => [f.area, f.axis, f.s0, f.s1, f.h0, f.h1, f.a0, f.a1]),
    m.verticals, m.void, m.storeys, m.galleries, m.corridors, m.service, m.start,
  ])).digest('hex').slice(0, 16);
}
/** coreGeometry() of (SEED, variant) at main 1366b95 (before round 2), computed on the base generator with the same function. */
const BASE_CORE: Readonly<Record<string, string>> = {'terrace-cross': 'c6782ae4c690ad5a', 'arcade-loop': '5fee780212ff1967', 'elbow-branch': '1796f5f9f13a0065'};
/** World cells (street storey grid indices) of a world box. */
function boxCells(L: StationLayout, b: {x0: number; z0: number; x1: number; z1: number}): number[] {
  const g = L.grid, out: number[] = [];
  for (let y = Math.max(0, Math.round(b.z0 / CELL)); y < Math.min(g.h, Math.round(b.z1 / CELL)); y++) for (let x = Math.max(0, Math.round(b.x0 / CELL)); x < Math.min(g.w, Math.round(b.x1 / CELL)); x++) out.push(g.idx(x, y));
  return out;
}

const cache = new Map<string, {L: StationLayout; ms: number; attempts: number}>();
function gen(variant?: MallVariant, seed = SEED) {
  const key = `${variant ?? 'seed'}:${seed}`;
  let e = cache.get(key);
  if (!e) {
    const L = generateMallLevel({levelSeed: seed, startWeapon: 'rifle'}, variant ? {variant} : {});
    cache.set(key, (e = {L, ms: MALL_GEN_STATS.ms, attempts: MALL_GEN_STATS.attempts}));
  }
  return e;
}
const mall = (variant?: MallVariant, seed = SEED) => gen(variant, seed).L;

/** Walkable floor (m²) of the core (extension areas excluded) per storey. */
function coreWalk(L: StationLayout): number[] {
  return L.levels.map(lv => {
    const g = lv.grid;
    let n = 0;
    for (let i = 0; i < g.cells.length; i++) if (g.cells[i] === FLOOR && g.rampIdx[i] < 0 && !L.areas[g.area[i]]?.ext) n++;
    return n * CELL * CELL;
  });
}

describe('registration and the seeded name (U01)', () => {
  it('is a registered LevelId (tier 2) with a generic menu name, travel targets, labels and a real Track2 declaration', () => {
    expect(LEVEL_IDS).toEqual(['subway', 'office', 'mall', 'market', 'skyways', 'reactor']); // (+ reactor, tier 3: task reactor-build-20261101; + skyways: task studio-skyways-level-20261106-054448-01; + market: task studio-survivor-market-20261108-005807-01)
    expect(isLevelId('mall')).toBe(true);
    expect(LEVELS.mall.tier).toBe(2);
    expect(LEVELS.mall.name).toBe(MALL_GENERIC_NAME);
    expect(LEVELS.mall.name).not.toMatch(/Eaton/);
    expect(LEVELS.mall.sections(1)).toEqual(['main']);
    expect(travelTargets('mall')).toEqual(['subway', 'office', 'market', 'skyways', 'reactor']);
    expect(travelTargets('subway')).toEqual(['office', 'mall', 'market', 'skyways', 'reactor']);
    expect(LEVELS.mall.trackExtensions).toBe(TRACK_EXT_MALL);
    const L = mall();
    expect(L.mall?.version).toBe(2);
    expect(arrivalPose(L, {kind: 'start'})).toMatchObject({source: 'start', level: 0});
    expect(storeyLabel(L, 0)).toBe('Subway');
    expect(storeyLabel(L, FLOORS)).toBe(`Level ${FLOORS}`);
  });

  it('the name is "<fictional> Center", from the LEVEL seed only, identical in the layout, the UI helper and every regeneration', () => {
    const L = mall();
    const name = mallNameOf(SEED);
    expect(name).toMatch(/^[A-Z][a-z]+ Center$/);
    expect(L.mall!.name).toBe(name);
    expect(L.name).toBe(name);
    expect(levelDisplayName('mall', SEED)).toBe(name);
    expect(levelDisplayName('mall')).toBe(MALL_GENERIC_NAME);
    expect(levelDisplayName('office', SEED)).toBe(LEVELS.office.name);
    // every variant of the same level seed (a revisit / Travel regenerates it) keeps the name
    for (const v of MALL_VARIANTS) expect(mall(v).mall!.name).toBe(name);
    // a bounded different-seed sample varies; never a blocked real name
    const sample = Array.from({length: 24}, (_, i) => mallNameOf(1000 + i * 7919));
    expect(new Set(sample).size).toBeGreaterThanOrEqual(12);
    for (const n of mallNameCandidates()) expect(REAL_NAME_BLOCKLIST.has(n.toLowerCase())).toBe(false);
    expect(mallNameCandidates().length).toBeGreaterThan(MALL_NAME_HEADS.length * 8);
    expect(mallNameCandidates().some(n => /eaton/i.test(n))).toBe(false);
  });

  it('is deterministic per seed and differs between seeds', () => {
    const a = mall();
    const b = generateMallLevel({levelSeed: SEED, startWeapon: 'rifle'});
    expect(b.zombies).toEqual(a.zombies);
    expect(b.pickups).toEqual(a.pickups);
    expect(b.props.length).toBe(a.props.length);
    expect(b.mall).toEqual(a.mall);
    const c = mall(undefined, SEED + 1);
    expect(JSON.stringify(c.mall!.shops.map(s => s.frontage))).not.toBe(JSON.stringify(a.mall!.shops.map(s => s.frontage)));
  });
});

describe('lot families (D02 registry, gen/mall/lots.ts)', () => {
  it('ten genuinely different families; every catalogue program suits at least one; small families keep small / no stockrooms', () => {
    expect(MALL_LOT_IDS.length).toBe(10);
    expect(new Set(MALL_LOT_IDS.map(id => MALL_LOTS[id].shape)).size).toBe(10);
    for (const p of Object.keys(MALL_PROGRAMS) as MallProgram[]) expect(lotsForProgram(p).length, p).toBeGreaterThan(0);
    expect(lotsForProgram('kiosk')).toEqual(['kiosk-cell']);
    expect(lotSuits('kiosk-cell', 'department')).toBe(false);
    expect(lotSuits('anchor-deep', 'department')).toBe(true);
    expect(lotSuits('compact-square', 'cafe')).toBe(true); // a bakery / café is compact
    expect(lotSuits('compact-square', 'department')).toBe(false);
    expect(MALL_LOTS['kiosk-cell'].stock).toBe('none');
    for (const id of ['food-counter', 'compact-square', 'narrow-boutique', 'recessed-arcade'] as const) expect(MALL_LOTS[id].stockSize[1]).toBeLessThanOrEqual(2.5);
    // real size contrast: the anchor's sales floor is an order of magnitude above a kiosk's
    expect(MALL_LOTS['anchor-deep'].width[0] * MALL_LOTS['anchor-deep'].depth[0]).toBeGreaterThan(15 * MALL_LOTS['kiosk-cell'].width[1] * MALL_LOTS['kiosk-cell'].depth[1]);
  });
});

describe.each(MALL_VARIANTS.map(v => [v]))('variant %s', (variant: MallVariant) => {
  const {L, ms, attempts} = gen(variant);
  const info = L.mall!;
  const Lv = levelsOf(L);

  it('validates clean (incl. >= 2 independent routes to every floor) on the first attempt, fast', () => {
    expect(mallIssues(L)).toEqual([]);
    expect(info.variant).toBe(variant);
    expect(attempts).toBe(1);
    expect(ms).toBeLessThan(8000);
  });

  it('station + three retail floors at real heights, about half the old height', () => {
    expect(FLOORS).toBe(MALL_FLOORS);
    expect(FLOORS).toBe(3);
    expect(L.levels.map(l => l.id)).toEqual([0, 1, 2, 3]);
    expect(L.levels.map(l => l.baseY)).toEqual([0, STOREY, 2 * STOREY, 3 * STOREY]);
    expect(info.storeys.map(s => s.role)).toEqual(['station', 'ring', 'ring', 'ring']);
    expect(info.roof.springY).toBeLessThanOrEqual(OLD.spring * 0.6);
    expect(info.roof.apexY).toBeLessThan(30);
  });

  it('area / unit budget: well under half the old mall; ~20-30 frontages across the three floors, every unit has a lot family', () => {
    const walk = coreWalk(L), total = walk.reduce((a, b) => a + b, 0);
    expect(total).toBeLessThan(OLD.walk / 3);
    expect(walk[0]).toBeLessThan(2500);
    for (let k = 1; k <= FLOORS; k++) expect(walk[k]).toBeGreaterThan(900);
    const shops = info.shops;
    expect(shops.length).toBeGreaterThanOrEqual(18);
    expect(shops.length).toBeLessThanOrEqual(32);
    for (let k = 1; k <= FLOORS; k++) expect(shops.filter(s => s.level === k).length).toBeGreaterThanOrEqual(5);
    for (const s of shops) {
      const f = MALL_LOTS[s.lot!];
      expect(f, s.id).toBeDefined();
      expect(s.zone).toBeDefined();
      expect(s.frontages!.length).toBe(L.doors.filter(d => d.shopfront && (d.a === s.area || d.b === s.area)).length);
      // the record's numbers follow the family (end units may be wider than their range to span the corridor end)
      expect(s.depth, s.id).toBeGreaterThanOrEqual(f.depth[0] - 0.6);
      expect(s.depth, s.id).toBeLessThanOrEqual(f.depth[1] + 0.6);
      expect(s.width, s.id).toBeGreaterThanOrEqual(f.width[0] - 0.6);
      if (s.zone !== 'end') expect(s.width, s.id).toBeLessThanOrEqual(f.width[1] + 0.6);
      if (f.stock === 'none') expect(s.backroom).toBeUndefined();
      if (s.backroom !== undefined) expect(s.stockArea!, s.id).toBeLessThan(s.salesArea * 0.75);
      if (s.lot === 'corner-double') expect(s.frontages!.length).toBe(2);
    }
    expect(new Set(shops.map(s => s.lot)).size).toBeGreaterThanOrEqual(6);
    // small vs large contrast within one run
    const areas = shops.map(s => s.salesArea).sort((a, b) => a - b);
    expect(areas[areas.length - 1]).toBeGreaterThan(5 * areas[Math.floor(areas.length / 4)]);
  });

  it('the small irregular atrium: nested openings widening upward, the floor-1 column open to the roof, glass only over the top', () => {
    const ops = info.void.openings!;
    expect(ops.map(o => o.level)).toEqual([1, 2, 3]);
    for (let i = 1; i < ops.length; i++) expect(ops[i].area).toBeGreaterThan(ops[i - 1].area);
    expect(ops[0].area).toBeLessThan(400);
    expect(ops[2].area).toBeLessThan(900);
    // irregular: more than a rectangle on at least one floor (notches / bays / stepped corners)
    expect(ops.some(o => o.outline.length > 4)).toBe(true);
    const cells = mallVoidCells(L);
    expect(cells.length).toBeGreaterThan(200);
    for (const i of cells) for (let k = 1; k <= FLOORS; k++) expect(L.levels[k].grid.cells[i]).toBe(SOLID);
    // the start stands under the column: a vertical ray reaches the roof apex
    const s = info.start;
    const h = Lv.raycast({x: s.x, y: 1.6, z: s.z}, {x: 0, y: 1, z: 0}, 60);
    expect(h.kind).toBe('ceiling');
    expect(h.t + 1.6).toBeCloseTo(info.void.roofApexY, 1);
    expect(info.roof.polygon).toEqual(ops[2].outline);
    expect(info.roof.outline).toEqual(ops[2].bounds);
  });

  it('beyond the atrium: corridor wings on every floor, a dead end closed by a shop, more walkway on the lower floors', () => {
    for (let k = 1; k <= FLOORS; k++) {
      const cor = info.corridors!.find(c => c.level === k)!.areas;
      expect(cor.length, `floor ${k}`).toBeGreaterThan(0);
    }
    expect(info.shops.filter(s => s.zone === 'end').length).toBeGreaterThanOrEqual(3);
    const w = coreWalk(L);
    expect(w[1]).toBeGreaterThan(w[3]);
  });

  it('vertical links: a scissor escalator stack in the atrium, public stairs in the wings, two service cores, a 4-stop elevator', () => {
    const v = info.verticals;
    for (let k = 0; k < FLOORS; k++) {
      expect(v.filter(q => q.kind === 'escalator' && q.lower === k).length, `escalator ${k}`).toBeGreaterThan(0);
      expect(v.filter(q => q.kind === 'service-stair' && q.lower === k).length).toBe(2);
    }
    for (let k = 1; k < FLOORS; k++) expect(v.filter(q => q.kind === 'stair' && q.lower === k).length).toBeGreaterThan(0);
    const groups = mallRouteGroups(L);
    expect(groups.filter(g => g.kind === 'service-stair').length).toBe(2);
    const t = readTowerInfo(L)!;
    expect(t.elevator!.stops.map(s => s.floor)).toEqual([0, 1, 2, 3]);
    expect(planElevator(t.elevator!)).toBeTruthy();
    expect(info.elevators[0].stops.length).toBe(4);
  });

  it('wayfinding per storey: shops, links and a public station return chain ending on the station', () => {
    const wf = info.wayfinding!;
    expect(wf.map(w => w.level)).toEqual([0, 1, 2, 3]);
    for (const w of wf) {
      expect(w.links.length).toBeGreaterThan(0);
      if (w.level > 0) {
        expect(w.shops.length).toBeGreaterThan(0);
        expect(w.stationReturn.length).toBe(w.level);
        expect(w.stationReturn[w.stationReturn.length - 1].to).toBe(0);
      }
    }
  });

  it('QA poses stand on walkable floor of their storey', () => {
    for (const name of MALL_POSE_NAMES) {
      const q = mallQaPose(L, name);
      expect(q, name).not.toBeNull();
      const g = L.levels[q!.level].grid, [cx, cy] = g.cellOf(q!.x, q!.z);
      expect(g.walkable(cx, cy), name).toBe(true);
    }
    for (let k = 1; k <= FLOORS; k++) expect(mallQaPose(L, 'ring-edge', k)?.level).toBe(k);
  });

  it('the patrol graph covers corridors and every storey; edges path (PathFinder) incl. storey changes', () => {
    const pf = new PathFinder(Lv);
    const P = info.patrol;
    expect(P.length).toBeGreaterThan(40);
    const corridorAreas = new Set(info.corridors!.flatMap(c => c.areas));
    for (let k = 0; k <= FLOORS; k++) expect(P.filter(n => n.level === k).length, `storey ${k}`).toBeGreaterThan(3);
    let inCorridor = 0;
    for (const n of P) {
      const g = L.levels[n.level].grid, [cx, cy] = g.cellOf(n.x, n.z);
      expect(g.cells[g.idx(cx, cy)]).toBe(FLOOR);
      if (corridorAreas.has(g.area[g.idx(cx, cy)])) inCorridor++;
    }
    expect(inCorridor).toBeGreaterThan(5);
    const vias = new Set(P.flatMap(n => n.edges.map(e => e.via)));
    for (const v of ['gallery', 'escalator', 'stair']) expect(vias.has(v as never)).toBe(true);
    let tested = 0;
    for (const n of P) for (const e of n.edges) {
      if (e.to < n.id || (tested > 40 && e.via === 'gallery')) continue;
      const m = P[e.to];
      const path = pf.find(n.x, n.z, m.x, m.z, 0.3, 200000, {ay: L.levels[n.level].baseY, by: L.levels[m.level].baseY});
      expect(path, `edge ${n.id}-${m.id} (${e.via})`).not.toBeNull();
      tested++;
    }
  });

  it('Track2 seam (D09): rockLevels [0], one east tunnel off the bed, no extension issue, subway root derived', () => {
    expect(L.extensions).toBeDefined();
    expect(trackExtCoverageIssues('mall', LEVELS.mall.trackExtensions, L)).toEqual([]);
    expect(L.extensions!.rockLevels).toEqual([0]);
    expect(L.extensions!.tunnels.map(t => t.from)).toEqual(['x1']);
    expect(L.extensions!.annexes.length).toBeLessThanOrEqual(1);
    expect(extensionIssues(L)).toEqual([]);
    const r = info.subwayRoot;
    expect(r).toMatchObject({level: 'mall', storey: 0, platformY: 0});
    expect(r.tunnelMouths.map(m => m.axis).sort()).toEqual(['x+', 'x-']);
    expect(L.trenches.length).toBe(1);
    // no retail floor slab covers the atrium openings over the extension (openings stay SOLID on their floors)
    const ext = new Set(L.areas.filter(a => a.ext).map(a => a.id));
    for (const i of mallVoidCells(L)) expect(ext.has(L.grid.area[i])).toBe(false);
  });

  it('M09 street exits: only on the street storey (floor 1), locked, SOLID behind the glass, a view outside every storey, hall reachable', () => {
    const exits = info.exits ?? [];
    expect(exits.length).toBeGreaterThan(0); // (SEED has exits in every variant; some terrace-cross seeds have none: GEN.done limits)
    expect(exits.length).toBeLessThanOrEqual(EXIT.max);
    if ((MALL_VARIANTS_ADDED as readonly string[]).includes(variant)) expect(exits.some(e => e.kind === 'corridor-end'), 'a designed street arcade').toBe(true);
    else expect(exits.every(e => e.kind === 'entrance-hall')).toBe(true);
    // street level = the first storey above the rock storeys (the station box): floor 1
    expect(MALL_STREET_LEVEL).toBe(1);
    expect(Math.max(...L.extensions!.rockLevels!)).toBe(MALL_STREET_LEVEL - 1);
    const g0 = L.grid, [sx, sy] = g0.cellOf(info.start.x, info.start.z);
    const dist = levelDistance(L.levels, sx, sy, 0, L.levelLinks);
    for (const e of exits) {
      expect(e.level).toBe(MALL_STREET_LEVEL);
      expect(e.streetY).toBe(L.levels[MALL_STREET_LEVEL].baseY);
      expect(e.locked).toBe(true);
      expect(e.sign).toBe('EXIT CLOSED');
      const g = L.levels[e.level].grid, alongX = e.side === 'N' || e.side === 'S', out = e.side === 'N' || e.side === 'W' ? -1 : 1;
      const cellAt = (sAlong: number, d: number) => { const [x, z] = alongX ? [sAlong, e.door.plane + out * d] : [e.door.plane + out * d, sAlong]; const [cx, cy] = g.cellOf(x, z); return g.idx(cx, cy); };
      // the glazing plane: hall floor just inside (public walkway, reachable from the start), rock just outside on every storey >= street
      for (let a = e.door.s0 + 0.25; a < e.door.s1; a += 0.5) {
        const inn = cellAt(a, -0.25), outC = cellAt(a, 0.25);
        expect(g.cells[inn]).toBe(FLOOR);
        expect(L.areas[g.area[inn]].publicSpace).toBe(true);
        expect(dist[e.level][inn], 'hall reachable').toBeGreaterThanOrEqual(0);
        for (let lv = MALL_STREET_LEVEL; lv <= FLOORS; lv++) expect(L.levels[lv].grid.cells[outC]).toBe(SOLID);
      }
      expect(e.door.y1).toBeLessThanOrEqual(e.hall.ceil - 0.3 + 1e-6);
      expect(e.panels.filter(q => q.kind === 'door').length).toBeGreaterThanOrEqual(2);
      expect(Math.abs(e.facade - e.door.plane)).toBeCloseTo(e.vestibule, 6);
      // the collider = SOLID cells (unbreakable rock: no prop / Door / shop glazing) on every storey >= street, never reachable
      const col = exitColliderCells(L, e);
      expect(col.length).toBeGreaterThan(0);
      for (const i of col) for (let lv = MALL_STREET_LEVEL; lv <= FLOORS; lv++) { expect(L.levels[lv].grid.cells[i]).toBe(SOLID); expect(dist[lv][i]).toBe(-1); }
      // the view volume: outside the footprint of every storey >= street; nothing below reaches street level; nothing placed there
      for (const i of boxCells(L, e.view)) {
        for (let lv = MALL_STREET_LEVEL; lv <= FLOORS; lv++) expect(L.levels[lv].grid.cells[i], 'view over a storey').toBe(SOLID);
        if (g0.cells[i] !== SOLID) expect(g0.ceil[i]).toBeLessThanOrEqual(e.streetY - EXIT.slab + 1e-6);
      }
      const inBox = (b: {x0: number; z0: number; x1: number; z1: number}, x: number, z: number) => x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1;
      for (const b of [e.collider, e.view]) {
        expect(L.doors.some(d => (d.level ?? 0) === e.level && inBox(b, (d.x + d.w / 2) * CELL, (d.y + d.h / 2) * CELL))).toBe(false);
        for (const list of [L.props, L.pickups, L.zombies] as {x: number; z: number; level?: number}[][]) expect(list.some(q => (q.level ?? 0) >= e.level && inBox(b, q.x, q.z))).toBe(false);
      }
      // the hall: a public walkway area on the street storey, lit by the daylight through the glass
      const hall = L.areas[e.hall.area];
      expect(hall.level).toBe(MALL_STREET_LEVEL);
      expect(hall.publicSpace).toBe(true);
      expect(L.lights.some(l => l.virtual && l.level === e.level && Math.abs((alongX ? l.z : l.x) - e.door.plane) < 1.2)).toBe(true);
    }
    // the primary's QA pose stands in each hall facing its doors
    for (let i = 0; i < exits.length; i++) {
      const q = mallQaPose(L, 'street-exit', i)!;
      expect(q, `street-exit ${i}`).not.toBeNull();
      const g = L.levels[q.level].grid, [cx, cy] = g.cellOf(q.x, q.z);
      expect(q.level).toBe(MALL_STREET_LEVEL);
      expect(g.walkable(cx, cy)).toBe(true);
    }
    expect(mallQaPose(L, 'street-exit', exits.length)).toBeNull();
    for (let i = 1; i < exits.length; i++) {
      const c = (e: (typeof exits)[number]) => [e.side === 'N' || e.side === 'S' ? (e.door.s0 + e.door.s1) / 2 : e.door.plane, e.side === 'N' || e.side === 'S' ? e.door.plane : (e.door.s0 + e.door.s1) / 2];
      const [ax, az] = c(exits[0]), [bx, bz] = c(exits[i]);
      expect(Math.hypot(ax - bx, az - bz)).toBeGreaterThanOrEqual(EXIT.apart * CELL - 6);
    }
  });

  it('no enemy / loot in the void or on a run; no ceiling fixture in open air', () => {
    const cells = new Set(mallVoidCells(L));
    for (const z of L.zombies) {
      const lv = z.level ?? 0, g = L.levels[lv].grid, [cx, cy] = g.cellOf(z.x, z.z), i = g.idx(cx, cy);
      expect(g.rampIdx[i]).toBeLessThan(0);
      expect(L.areas[g.area[i]]?.role).not.toBe('stair');
      if (lv > 0) expect(cells.has(i)).toBe(false);
    }
    for (let k = 0; k <= FLOORS; k++) expect(L.zombies.some(z => (z.level ?? 0) === k)).toBe(true);
    for (const l of L.lights) {
      if (l.virtual) continue;
      const lv = l.level ?? L.areas[l.area]?.level ?? 0, g = L.levels[lv].grid;
      const c = g.ceilAt(l.x, l.z);
      if (Number.isFinite(c)) expect(l.y, `light ${l.x},${l.z} level ${lv}`).toBeGreaterThan(c - 1.0);
    }
  });
});

describe('variants differ in geometry, adjacency and routes (not decoration)', () => {
  it('different corridor topology, opening outlines, stair placement, route graph (loops / dead ends / junctions)', () => {
    const ms = MALL_VARIANTS.map(v => mall(v).mall!);
    // route graph of the patrol nodes: independent loops (E - V + 1 per component), dead ends (degree 1), junctions (degree >= 3)
    const route = (m: (typeof ms)[number]) => {
      const E = m.patrol.reduce((a, n) => a + n.edges.length, 0) / 2;
      return [E - m.patrol.length + 1, m.patrol.filter(n => n.edges.length === 1).length, m.patrol.filter(n => n.edges.length >= 3).length];
    };
    const sig = (m: (typeof ms)[number]) => JSON.stringify([
      m.corridors!.map(c => c.areas.length), m.void.openings!.map(o => o.outline.length),
      m.verticals.filter(v => v.kind === 'stair').map(v => [v.lower, Math.round(v.foot.x), Math.round(v.foot.z)]), route(m),
    ]);
    expect(new Set(ms.map(sig)).size).toBe(MALL_VARIANTS.length);
    // union coverage of the lot families over the runs
    expect(new Set(ms.flatMap(m => m.shops.map(s => s.lot))).size).toBeGreaterThanOrEqual(9);
  });
});

describe('variant selection (M08)', () => {
  it('six topologies; seeds staying on the originals keep their exact previous variant; ~1/6 each; ?mallVariant= takes the new ids', () => {
    expect(MALL_VARIANTS).toEqual([...MALL_VARIANTS_V2, ...MALL_VARIANTS_ADDED]);
    expect(MALL_VARIANTS_V2).toEqual(['terrace-cross', 'arcade-loop', 'elbow-branch']);
    const count: Record<string, number> = {};
    for (let i = 0; i < 600; i++) {
      const sd = (i * 2654435761) >>> 0, v = mallVariantOf(sd);
      count[v] = (count[v] ?? 0) + 1;
      if ((MALL_VARIANTS_V2 as readonly string[]).includes(v)) expect(v).toBe(MALL_VARIANTS_V2[hashString('mall-variant-v2', sd) % 3]);
    }
    for (const v of MALL_VARIANTS) { expect(count[v], v).toBeGreaterThan(60); expect(count[v], v).toBeLessThan(140); }
    try {
      for (const v of MALL_VARIANTS_ADDED) { expect(setMallVariantOverride(v)).toBe(v); expect(mallVariantOf(1)).toBe(v); }
    } finally { setMallVariantOverride(null); }
    expect(mallVariantOf(1)).toBe(MALL_VARIANTS_V2[hashString('mall-variant-v2', 1) % 3]);
  });
});

describe('the original variants are unchanged (M08 stability, M05 matched views)', () => {
  it.each(MALL_VARIANTS_V2.map(v => [v]))('%s: core geometry of (SEED, variant) = main 1366b95; the exit post-pass only appends', (variant: MallVariant) => {
    const L = mall(variant);
    expect(coreGeometry(L)).toBe(BASE_CORE[variant]);
    const P = generateMallLevel({levelSeed: SEED, startWeapon: 'rifle'}, {variant, streetExits: false});
    expect(P.mall!.exits).toBeUndefined();
    expect(coreGeometry(P)).toBe(BASE_CORE[variant]);
    // every core record keeps its index and value; the post-pass appends the hall areas + virtual daylight lights only
    expect(L.areas.slice(0, P.areas.length)).toEqual(P.areas);
    expect(L.areas.length - P.areas.length).toBe(L.mall!.exits!.filter(e => e.kind === 'entrance-hall').length);
    expect(L.lights.slice(0, P.lights.length)).toEqual(P.lights);
    expect(L.lights.slice(P.lights.length).every(l => l.virtual && l.level === MALL_STREET_LEVEL)).toBe(true);
    for (const k of ['doors', 'props', 'pickups', 'zombies', 'signs', 'rails', 'levelLinks', 'playerSpawn'] as const) expect(L[k], k).toEqual(P[k]);
    const {exits: _e, ...core} = L.mall!;
    expect(core).toEqual(P.mall);
    // grids: identical except the hall cells (rock before, hall floor after); connectivity of every core cell unchanged
    const halls = new Set(L.mall!.exits!.map(e => e.hall.area));
    const [sx, sy] = L.grid.cellOf(L.mall!.start.x, L.mall!.start.z);
    const dl = levelDistance(L.levels, sx, sy, 0, L.levelLinks), dp = levelDistance(P.levels, sx, sy, 0, P.levelLinks);
    L.levels.forEach((lv, li) => {
      const a = lv.grid, b = P.levels[li].grid;
      let diff = 0;
      for (let i = 0; i < a.cells.length; i++) {
        if (halls.has(a.area[i]) && li === MALL_STREET_LEVEL) { expect(b.cells[i]).toBe(SOLID); continue; }
        if (a.cells[i] !== b.cells[i] || a.area[i] !== b.area[i] || a.ceil[i] !== b.ceil[i] || a.floor[i] !== b.floor[i] || a.blocked[i] !== b.blocked[i] || dl[li][i] !== dp[li][i]) diff++;
      }
      expect(diff, `level ${li}`).toBe(0);
    });
    expect(mallIssues(P)).toEqual([]);
  });
});

describe('one world', () => {
  it('source guard: no mall code path travels, fades, loads or rebuilds a section', () => {
    for (const f of ['index.ts', 'carve.ts', 'skeleton.ts', 'structure.ts', 'validate.ts', 'elevator.ts', 'qa.ts', 'trackExt.ts', 'frame.ts', 'lots.ts', 'names.ts', 'exits.ts']) {
      const src = readFileSync(new URL(`../src/gen/mall/${f}`, import.meta.url), 'utf8');
      const code = src.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
      expect(code, f).not.toMatch(/\.travel\(|TowerFade|via:\s*'local'|sectionForFloor|'travelling'/);
    }
  });
});

describe.each(MALL_VARIANTS.map(v => [v]))('a real Player walks the mall (%s)', (variant: MallVariant) => {
  it('W key from the platform start up to the top floor (escalators / stairs), y continuous across every storey, never falls', () => {
    const L = mall(variant);
    const Lv = levelsOf(L);
    const pf = new PathFinder(Lv);
    const p = new Player();
    const s = L.mall!.start;
    p.spawn(s.x, s.z, s.yaw, Lv.grid(0).floorAt(s.x, s.z));
    const keys = new Keys();
    let maxDy = 0, minVy = 0, steps = 0;
    const visited = new Set<number>();
    const kinds = new Set<string>();
    const walk = (path: Waypoint[], capSteps: number) => {
      let i = 0;
      const cap = steps + capSteps;
      while (i < path.length && steps < cap) {
        const [wx, wz, , wy] = path[i];
        if (Math.hypot(wx - p.x, wz - p.z) < 0.35 && (wy === undefined || Math.abs(wy - p.y) < 0.9)) { i++; continue; }
        p.yaw = Math.atan2(-(wx - p.x), -(wz - p.z));
        keys.held.add('KeyW');
        const y0 = p.y;
        p.update(DT, keys, Lv, null, {aiming: false, speedMult: 1, canSprint: false});
        maxDy = Math.max(maxDy, Math.abs(p.y - y0));
        minVy = Math.min(minVy, p.vy);
        visited.add(Lv.levelAt(p.x, p.z, p.y + 0.05));
        steps++;
      }
      keys.held.clear();
      return i;
    };
    for (let k = 0; k < FLOORS; k++) {
      let path: Waypoint[] | null = null;
      const runs = L.mall!.verticals.filter(q => q.lower === k && (q.kind === 'escalator' || q.kind === 'stair'))
        .sort((a, b) => Math.hypot(a.foot.x - p.x, a.foot.z - p.z) - Math.hypot(b.foot.x - p.x, b.foot.z - p.z));
      for (const v of runs) {
        const q = pf.find(p.x, p.z, v.head.x, v.head.z, 0.3, 600000, {ay: p.y, by: v.head.y});
        if (q && q.every(w => w[2] === undefined)) { path = q; kinds.add(v.kind); break; }
      }
      expect(path, `route to storey ${k + 1}`).not.toBeNull();
      expect(walk(path!, 60 * 240), `reached storey ${k + 1} (${steps} steps)`).toBe(path!.length);
      expect(p.y).toBeCloseTo(L.levels[k + 1].baseY, 1);
    }
    // off the last run onto the top floor's walkway (its nearest patrol node)
    const top = L.mall!.patrol.filter(n => n.level === FLOORS).sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z))[0];
    const last = pf.find(p.x, p.z, top.x, top.z, 0.3, 200000, {ay: p.y, by: L.levels[FLOORS].baseY})!;
    expect(last).not.toBeNull();
    walk(last, 60 * 60);
    expect(Lv.levelAt(p.x, p.z, p.y + 0.05)).toBe(FLOORS);
    expect([...visited].sort((a, b) => a - b)).toEqual([0, 1, 2, 3]);
    expect(kinds.has('escalator')).toBe(true);
    expect(p.y).toBeGreaterThan(14);
    expect(maxDy).toBeLessThan(0.12); // no snap / teleport between storeys
    expect(minVy).toBeGreaterThan(-3); // never fell (no missing slab, no void drop)
    expect(p.alive).toBe(true);
  });
});

describe('a locked street exit stops a real Player and bullets (M09)', () => {
  it.each([['arcade-loop'], ['tee-junction']] as [MallVariant][])('%s: walking / sprinting / jumping into the glass never passes it', (variant) => {
    const L = mall(variant), Lv = levelsOf(L), e = L.mall!.exits![0];
    const alongX = e.side === 'N' || e.side === 'S', out = e.side === 'N' || e.side === 'W' ? -1 : 1;
    const at = (sAlong: number, d: number): [number, number] => (alongX ? [sAlong, e.door.plane + out * d] : [e.door.plane + out * d, sAlong]);
    const c = (e.door.s0 + e.door.s1) / 2;
    const keys = new Keys();
    // straight at the doors, sprinting + jumping at a leaf edge, diagonally across the opening toward a pier
    for (const [s0, aim, sprint, jump] of [[c, c, false, false], [c, e.door.s0 + 0.3, true, true], [e.door.s0 + 0.6, e.door.s1 + 1, true, false]] as const) {
      const p = new Player();
      const [px, pz] = at(s0, -2.5);
      p.spawn(px, pz, 0, e.streetY);
      let minGap = Infinity;
      for (let t = 0; t < 240; t++) {
        const [tx, tz] = at(aim, 4);
        p.yaw = Math.atan2(-(tx - p.x), -(tz - p.z));
        keys.held = new Set(['KeyW', ...(sprint ? ['ShiftLeft'] : [])]);
        keys.tap = jump && t % 25 === 0 ? 'Space' : '';
        p.update(DT, keys, Lv, null, {aiming: false, speedMult: 1, canSprint: true});
        const gap = -out * ((alongX ? p.z : p.x) - e.door.plane); // > 0: the hall side
        minGap = Math.min(minGap, gap);
        expect(gap, `t ${t}`).toBeGreaterThan(p.radius - 0.02);
        expect(Lv.levelAt(p.x, p.z, p.y + 0.05)).toBe(e.level);
      }
      expect(minGap, 'pressed against the glass').toBeLessThan(p.radius + 0.3);
      expect(p.y).toBeCloseTo(e.streetY, 1);
      expect(p.alive).toBe(true);
    }
    // bullets / sight stop at the glass: a ray from inside straight out hits the wall at the plane, at any height of the opening
    const [ox, oz] = at(c, -2);
    for (const y of [0.3, 1.4, 2.6]) {
      const h = Lv.raycast({x: ox, y: e.streetY + y, z: oz}, alongX ? {x: 0, y: 0, z: out} : {x: out, y: 0, z: 0}, 40);
      expect(h.kind).toBe('wall');
      expect(h.t).toBeCloseTo(2, 1);
    }
    expect(Lv.lineOfSight({x: ox, y: e.streetY + 1.6, z: oz}, (() => { const [bx, bz] = at(c, 6); return {x: bx, y: e.streetY + 1.6, z: bz}; })())).toBe(false);
  });
});
