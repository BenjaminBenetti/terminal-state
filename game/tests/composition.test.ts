// Iteration 08 (Lane P): COMPOSED dressing (gen/compose.ts) on generated multi-level stations — clusters complete and anchored to
// architecture, spacing, zone identity, landmarks on sightlines, deliberate open floor (lanes, plazas, density caps), props on the
// right level's floor (never on stairs, stair approaches, landings or aperture edges), door / aisle clearance on every level,
// finite unique loot holders, determinism and per-station budgets. Plus a hand-built two-level fixture for the level-aware kit.
import {describe, expect, it} from 'vitest';
import {coreView} from '../src/gen/trackExt/index'; // Track 2 (lane CONTENT): the core station's budgets
import {ANNEX_CONTENT} from '../src/gen/annexContent'; // Track 2 (lane CONTENT): each annex's own allowance
import {Rng} from '../src/core/rng';
import {ARCHETYPES, generateStation, type Area, type StationLayout} from '../src/gen/station';
import {CELL, FLOOR, Grid, SOLID, VOID} from '../src/gen/grid';
import type {Level} from '../src/gen/levels';
import {PROP_DEFS, type PropKind, type PropPlacement} from '../src/gen/props';
import {P7_MODELS} from '../src/gen/props07.catalog';
import {isP7Kind} from '../src/gen/props07';
import {
  CLUSTERS, COMPOSED_ZONES, STRUCTURE_KINDS, ZONE_RULES, compositionOf, compositionSummary, floorCoverage, zoneOf, type ClusterId, type Zone,
} from '../src/gen/compose';
import {
  OPENABLE_FRONT, STAIR_APPROACH, STOCK_DISPLAY_KINDS, STOCK_OPEN_FRONT, areaLevel, backed, cellsOfBox, levelGrid, levelsOf, makePlaceCtx,
  propBlocksDoorway, tryPlaceProp,
} from '../src/gen/placeKit';
import {createHolderState, isContainerKind, isLootHolderKind, type HolderKind} from '../src/items/loot';
import {holderSurfaces} from '../src/items/lootLayout';

const SEEDS = Array.from({length: 8}, (_, i) => (i * 2654435761 + 777) >>> 0);
const cache = new Map<string, StationLayout>();
const gen = (seed: number, archetype?: (typeof ARCHETYPES)[number]) => {
  const key = `${seed}:${archetype ?? ''}`;
  let l = cache.get(key);
  if (!l) cache.set(key, (l = generateStation(seed, archetype ? {archetype} : {})));
  return l;
};
const SAMPLE = () => [...SEEDS.map(s => gen(s)), ...ARCHETYPES.map((a, i) => gen(31 + i * 7919, a))];
const M = P7_MODELS as Record<string, {tris: number; gpuBytes: number; bytes: number}>;

/** Footprint cells of a prop on a grid (the dresser's 4 cm inset). */
function cells(g: Grid, p: PropPlacement): number[] {
  const [x0, y0, x1, y1] = cellsOfBox(p.x, p.z, p.hx, p.hz);
  const out: number[] = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (g.inBounds(x, y)) out.push(g.idx(x, y));
  return out;
}
const floorProp = (p: PropPlacement) => p.host === undefined && !p.mounted;
const kindsOf = (type: ClusterId) => new Set<string>([...CLUSTERS[type].slots.flatMap(s => s.k), ...(CLUSTERS[type].mounts ?? []).flatMap(m => m.k), ...(CLUSTERS[type].hangs ?? []).flatMap(h => h.k), 'platformClock']);

describe('composition catalogue', () => {
  it('clusters name real props, valid zones; zone landmarks are clusters allowed in that zone', () => {
    const zones = new Set(Object.keys(ZONE_RULES));
    for (const [id, c] of Object.entries(CLUSTERS)) {
      expect(c.id).toBe(id);
      expect(c.spacing).toBeGreaterThan(0);
      expect(c.slots.length + (c.mounts?.length ?? 0)).toBeGreaterThan(0);
      for (const z of c.zones) expect(zones.has(z), `${id} zone ${z}`).toBe(true);
      for (const k of kindsOf(id as ClusterId)) expect(PROP_DEFS[k as PropKind], `${id}: ${k}`).toBeDefined();
      // A cluster always has something it cannot do without.
      expect(c.slots.some(s => s.need) || (c.mounts ?? []).some(m => m.need), id).toBe(true);
    }
    for (const [z, r] of Object.entries(ZONE_RULES)) {
      for (const [id] of r.landmarks) expect(CLUSTERS[id].zones, `${z} landmark ${id}`).toContain(z);
      expect(r.cap).toBeGreaterThan(0);
    }
  });
});

describe('composed stations', () => {
  it('is deterministic per seed (props, clusters, landmarks)', () => {
    const a = generateStation(SEEDS[1]), b = generateStation(SEEDS[1]);
    expect(a.props.map(p => [p.kind, p.x, p.y, p.z, p.rot, p.cluster ?? -1, p.level ?? 0])).toEqual(b.props.map(p => [p.kind, p.x, p.y, p.z, p.rot, p.cluster ?? -1, p.level ?? 0]));
    expect(compositionSummary(a)).toEqual(compositionSummary(b));
  });

  it('clusters are complete, anchored to walls / columns, spaced; zones keep their identity', () => {
    const seenByZone = new Map<Zone, Set<ClusterId>>();
    for (const l of SAMPLE()) {
      const sum = compositionOf(l)!;
      expect(sum.clusters.length, `${l.seed} clusters`).toBeGreaterThanOrEqual(20);
      const members = new Map<number, PropPlacement[]>();
      for (const p of l.props) if (p.cluster !== undefined) { let m = members.get(p.cluster); if (!m) members.set(p.cluster, (m = [])); m.push(p); }
      const ctxs = levelsOf(l).map(L => makePlaceCtx(l, new Rng(1), L.id));
      for (const c of sum.clusters) {
        const ps = members.get(c.id) ?? [];
        const spec = CLUSTERS[c.type];
        const a = l.areas[c.area];
        expect(ps.length, `${l.seed} ${c.type} has members`).toBe(c.members);
        expect(spec.zones, `${c.type} in ${c.zone}`).toContain(zoneOf(l, a));
        expect(c.level).toBe(areaLevel(a));
        let s = seenByZone.get(c.zone); if (!s) seenByZone.set(c.zone, (s = new Set())); s.add(c.type);
        // Required members present (narrow / tiny areas only keep wall mounts, so their required floor slots never appear).
        for (const sl of spec.slots) if (sl.need) expect(ps.some(p => sl.k.includes(p.kind)), `${l.seed} ${c.type} lacks ${sl.k.join('|')}`).toBe(true);
        for (const m of spec.mounts ?? []) if (m.need) expect(ps.some(p => m.k.includes(p.kind)), `${l.seed} ${c.type} lacks mount ${m.k.join('|')}`).toBe(true);
        for (const p of ps) {
          expect(kindsOf(c.type).has(p.kind), `${c.type} member ${p.kind}`).toBe(true);
          expect(p.area).toBe(c.area);
          expect(p.level ?? 0).toBe(c.level);
        }
        const ctx = ctxs[c.level];
        if (spec.form === 'wall') {
          // Floor members (and wall mounts) stand with their back (or long side) to the cluster's wall, backed by solid wall.
          const side = c.side!;
          for (const p of ps) {
            if (p.kind === 'platformClock') continue;   // hung in front of the vignette
            const gap = side === 'N' ? p.z - p.hz - a.y * CELL : side === 'S' ? (a.y + a.h) * CELL - p.z - p.hz : side === 'W' ? p.x - p.hx - a.x * CELL : (a.x + a.w) * CELL - p.x - p.hx;
            expect(gap, `${l.seed} ${c.type} ${p.kind} off its wall`).toBeGreaterThanOrEqual(-0.01);
            expect(gap, `${l.seed} ${c.type} ${p.kind} off its wall`).toBeLessThan(0.1);
            const ns = side === 'N' || side === 'S';
            const t = ns ? p.x : p.z, half = ns ? p.hx : p.hz;
            // Heights are absolute after dressing: a floor member is backed at its floor, a wall mount at its own height.
            expect(backed(ctx, a, side, t - half + 0.01, t + half - 0.01, p.mounted ? p.y : (a.floorY ?? 0)), `${l.seed} ${c.type} ${p.kind} not wall-backed`).toBe(true);
          }
        } else if (spec.form === 'bay') {
          // Platform bay items sit on the column line between columns.
          const cols = l.props.filter(p => p.area === c.area && p.kind === 'column');
          for (const p of ps) expect(cols.some(q => Math.abs(q.z - p.z) < 0.2 && Math.abs(q.x - p.x) < 4.5), `${l.seed} ${c.type} ${p.kind} off the column line`).toBe(true);
        } else if (spec.form === 'open') {
          // Islands keep 0.9 m clear of the area's walls.
          for (const p of ps) {
            expect(p.x - p.hx - a.x * CELL, `${l.seed} ${c.type} island near W wall`).toBeGreaterThanOrEqual(0.85);
            expect((a.x + a.w) * CELL - p.x - p.hx).toBeGreaterThanOrEqual(0.85);
            expect(p.z - p.hz - a.y * CELL).toBeGreaterThanOrEqual(0.85);
            expect((a.y + a.h) * CELL - p.z - p.hz).toBeGreaterThanOrEqual(0.85);
          }
        }
      }
      // Spacing on each level: same type >= its spacing, any two vignettes >= 3 m apart (centres).
      for (const c of sum.clusters) for (const d of sum.clusters) {
        if (d.id <= c.id || d.level !== c.level) continue;
        const dist = Math.hypot(c.x - d.x, c.z - d.z);
        expect(dist, `${l.seed} ${c.type}/${d.type} crowd`).toBeGreaterThanOrEqual(3 - 1e-6);
        if (c.type === d.type) expect(dist, `${l.seed} ${c.type} repeats`).toBeGreaterThanOrEqual(CLUSTERS[c.type].spacing - 1e-6);
      }
    }
    // Zone identity: each zone's signature vignettes appear across the sample; service vignettes never in public halls and vice versa.
    const has = (z: Zone, ids: ClusterId[]) => ids.some(id => seenByZone.get(z)?.has(id));
    expect(has('platform', ['bayWaiting', 'workZone'])).toBe(true);
    expect(has('ticketing', ['securityPost', 'validators'])).toBe(true);
    expect(has('concourse', ['infoPoint', 'waiting', 'vendingBank'])).toBe(true);
    expect(has('service', ['maintenanceBay', 'workLight', 'serviceCart'])).toBe(true);
    for (const z of ['platform', 'concourse', 'ticketing', 'retail', 'food', 'upper'] as Zone[]) for (const id of ['plantSkid', 'electricalBank', 'maintenanceBay', 'refuse'] as ClusterId[]) expect(seenByZone.get(z)?.has(id) ?? false, `${id} in ${z}`).toBe(false);
    for (const id of ['waiting', 'infoPoint', 'capsuleCorner', 'shoeShine', 'busing'] as ClusterId[]) expect(seenByZone.get('lower')?.has(id) ?? false, `${id} in lower`).toBe(false);
    if (SAMPLE().some(l => levelsOf(l).length > 1)) {
      expect(has('lower', ['plantSkid', 'electricalBank', 'maintenanceBay'])).toBe(true);
      expect(has('upper', ['waiting', 'infoPoint', 'newsCorner', 'vendingBank'])).toBe(true);
    }
  });

  it('landmarks sit at the end of a real sightline (>= 7 m from the arrival), on the zone list', () => {
    let n = 0;
    for (const l of SAMPLE()) {
      const sum = compositionOf(l)!;
      expect(sum.landmarks.length, `${l.seed} landmarks`).toBeGreaterThanOrEqual(3);
      for (const lm of sum.landmarks) {
        const c = sum.clusters[lm.cluster];
        expect(c.landmark).toBe(true);
        const zone = zoneOf(l, l.areas[lm.area]);
        if (zone === 'platform') expect(c.type).toBe('workZone');
        else expect(ZONE_RULES[zone].landmarks.map(q => q[0]), `${zone} landmark ${c.type}`).toContain(c.type);
        if (zone !== 'platform') expect(lm.len).toBeGreaterThanOrEqual(7);
        n++;
      }
    }
    expect(n).toBeGreaterThan(30);
  });

  it('circulation: nothing on desire lines; nothing composed in plazas; density caps hold', () => {
    for (const l of SAMPLE()) {
      const sum = compositionOf(l)!;
      for (const [i, p] of l.props.entries()) {
        if (!floorProp(p)) continue;
        const L = p.level ?? 0, g = levelGrid(l, L), m = sum.masks[L];
        if (!m) continue;
        const cs = cells(g, p).filter(c => g.area[c] === p.area);
        // Lanes were routed around everything already standing, and nothing placed later may take a lane cell.
        expect(cs.some(c => m.lane[c]), `${l.seed} ${p.kind} on a lane`).toBe(false);
        // Plazas: open floor for everything placed by / after the composer.
        if (i >= sum.propsBefore) expect(cs.some(c => m.plaza[c]), `${l.seed} ${p.kind} in a plaza (${l.areas[p.area].label})`).toBe(false);
      }
      // Centre plazas: only structure (columns, booths) and the legacy kiosk islands inside them.
      for (const r of sum.plazas.filter(q => q.kind === 'centre')) {
        for (const p of l.props) {
          if (p.area !== r.area || !floorProp(p) || STRUCTURE_KINDS.has(p.kind) || p.kind === 'stall' || p.kind === 'hotdogCart') continue;
          const inside = p.x + p.hx > r.x0 + 0.05 && p.x - p.hx < r.x1 - 0.05 && p.z + p.hz > r.z0 + 0.05 && p.z - p.hz < r.z1 - 0.05;
          expect(inside, `${l.seed} ${p.kind} in the centre plaza of ${l.areas[r.area].label}`).toBe(false);
        }
      }
      // Density: what the composer adds stays under the zone cap (legacy fixtures + spaced wall infrastructure get 2 % slack).
      for (const r of sum.areas) {
        if (r.cap >= 1) continue;
        const a = l.areas[r.area];
        const composed = l.props.filter(p => p.area === a.id && p.cluster !== undefined && floorProp(p) && !STRUCTURE_KINDS.has(p.kind)).reduce((s, p) => s + p.hx * p.hz * 4, 0) / (a.w * a.h * CELL * CELL);
        expect(composed, `${l.seed} ${a.label} composed coverage`).toBeLessThanOrEqual(r.cap + 1e-6);
        // Whole area: never above the cap (or what legacy fixtures already covered) + 3 % for spaced wall infrastructure.
        expect(floorCoverage(l, a), `${l.seed} ${a.label} coverage`).toBeLessThanOrEqual(Math.max(r.cap, r.before) + 0.03 + 1 / (a.w * a.h * CELL * CELL));
      }
    }
  });

  it('props stand on their own level: right grid, floor height, under the ceiling; never on stairs, approaches, landings, aperture edges', () => {
    for (const l of SAMPLE()) {
      const ctxs = levelsOf(l).map(L => makePlaceCtx(l, new Rng(1), L.id));
      for (const p of l.props) {
        const L = p.level ?? 0, g = levelGrid(l, L), a = l.areas[p.area];
        expect(areaLevel(a), `${l.seed} ${p.kind} level vs its area`).toBe(L);
        if (p.kind === 'fareGate' || p.kind === 'shopGlazing' || p.kind === 'shopShutter') continue;
        const [cx, cy] = g.cellOf(p.x, p.z);
        const i = g.idx(cx, cy);
        if (p.kind === 'column' && g.cells[i] === VOID) continue;   // steel columns between the tracks
        expect(g.cells[i], `${l.seed} ${p.kind} (L${L}) over a wall / void`).toBe(FLOOR);
        if (!floorProp(p)) continue;
        expect(g.area[i], `${l.seed} ${p.kind} outside its area`).toBe(p.area);
        if (p.y - g.floorAt(p.x, p.z) > 0.05) continue;   // stacked on another prop (none today)
        expect(Math.abs(p.y - g.floorAt(p.x, p.z)), `${l.seed} ${p.kind} (L${L}) not on its floor`).toBeLessThan(0.02);
        const ceil = Math.min(...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz]) => g.ceilAt(p.x + sx * (p.hx - 0.05), p.z + sz * (p.hz - 0.05))));
        if (p.kind !== 'column' && Number.isFinite(ceil)) expect(p.y + p.h, `${l.seed} ${p.kind} (L${L}) through the ceiling`).toBeLessThanOrEqual(ceil + 0.05);
        for (const c of cells(g, p)) {
          expect(g.rampIdx[c], `${l.seed} ${p.kind} on a stair`).toBeLessThan(0);
          // Stair flights +1 cell, 1.5 m approaches, landings / ladder ends and aperture edges are kept clear on every level.
          if (p.kind !== 'column' && p.kind !== 'exitStair') expect(ctxs[L].edge[c], `${l.seed} ${p.kind} (L${L}) in a stair approach / landing / aperture edge (${a.label})`).toBe(0);
        }
      }
      for (const pk of l.pickups) {
        const L = pk.level ?? 0, g = levelGrid(l, L);
        const [cx, cy] = g.cellOf(pk.x, pk.z);
        expect(g.rampIdx[g.idx(cx, cy)], `${l.seed} pickup ${pk.itemId} on stairs`).toBeLessThan(0);
      }
    }
  });

  it('doors and aisles: openings clear on every level, >= 1 m aisles join every composed area\'s portals', () => {
    for (const l of SAMPLE()) {
      for (const p of l.props) {
        if (p.kind === 'fareGate' || p.kind === 'shopGlazing' || p.kind === 'shopShutter') continue;
        expect(propBlocksDoorway(l, p.x, p.z, p.hx, p.hz, p.y + (p.lift ?? 0), p.h - (p.lift ?? 0)), `${l.seed} ${p.kind} blocks a doorway`).toBeNull();
      }
      for (const d of l.doors) {
        if (d.fare || d.shopfront) continue;
        const g = levelGrid(l, areaLevel(l.areas[d.a]));
        const horiz = d.h === 1;
        for (let k = 0; k < (horiz ? d.w : d.h); k++) expect(g.walkable(horiz ? d.x + k : d.x, horiz ? d.y : d.y + k), `${l.seed} door ${d.id}`).toBe(true);
      }
      // 1 m aisles: windows of 2 x 2 walkable cells of the area, joined edge to edge, link all the area's door approaches.
      for (const a of l.areas) {
        if (!COMPOSED_ZONES.has(zoneOf(l, a)) || Math.min(a.w, a.h) * CELL < 2) continue;
        const g = levelGrid(l, areaLevel(a));
        const ok = (x: number, y: number) => x >= a.x && y >= a.y && x < a.x + a.w - 1 && y < a.y + a.h - 1 && [g.idx(x, y), g.idx(x + 1, y), g.idx(x, y + 1), g.idx(x + 1, y + 1)].every(i => g.area[i] === a.id && g.cells[i] === FLOOR && !g.blocked[i]);
        const ports: number[][] = [];
        for (const d of l.doors) {
          if ((d.a !== a.id && d.b !== a.id) || d.fare || d.shopfront || areaLevel(l.areas[d.a]) !== areaLevel(a)) continue;
          const wins: number[] = [];
          for (let y = d.y - 3; y <= d.y + d.h + 2; y++) for (let x = d.x - 3; x <= d.x + d.w + 2; x++) if (ok(x, y)) wins.push(y * g.w + x);
          if (wins.length) ports.push(wins);
        }
        if (ports.length < 2) continue;
        const seen = new Set<number>(ports[0]);
        const q = [...ports[0]];
        while (q.length) {
          const j = q.pop()!, x = j % g.w, y = (j - x) / g.w;
          for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const k = (y + oy) * g.w + x + ox; if (!seen.has(k) && ok(x + ox, y + oy)) { seen.add(k); q.push(k); } }
        }
        for (const w of ports.slice(1)) expect(w.some(j => seen.has(j)), `${l.seed} ${a.label}: no 1 m aisle between its doors`).toBe(true);
      }
    }
  });

  it('openables keep their swing strip; stocked displays never face a wall within 1.5 m', () => {
    for (const l of SAMPLE()) {
      for (const p of l.props) {
        if (!floorProp(p)) continue;
        const g = levelGrid(l, p.level ?? 0);
        const fx = Math.round(Math.sin(p.rot)), fz = Math.round(Math.cos(p.rot));
        const d = PROP_DEFS[p.kind];
        const swing = OPENABLE_FRONT[p.kind];
        if (swing) {
          // The swing / drawer strip in front stays open floor over the full width (sampled just past the prop's own cell).
          for (const t of [-0.45, 0, 0.45]) {
            const along = t * (d.w - 0.1), out = d.d / 2 + Math.min(swing, 0.55);
            const [cx, cy] = g.cellOf(p.x + fx * out + fz * along, p.z + fz * out + fx * along);
            expect(g.walkable(cx, cy), `${l.seed} ${p.kind} swing blocked (${l.areas[p.area].label})`).toBe(true);
          }
        }
        if (STOCK_DISPLAY_KINDS.has(p.kind)) {
          for (let u = d.d / 2 + 0.3; u <= d.d / 2 + STOCK_OPEN_FRONT - 0.1; u += 0.25) {
            const [cx, cy] = g.cellOf(p.x + fx * u, p.z + fz * u);
            expect(g.get(cx, cy), `${l.seed} ${p.kind} faces a wall`).not.toBe(SOLID);
          }
        }
      }
    }
  });

  it('loot: unique holders on every level, finite seeded contents (no reroll), caches and rewards off the main level', () => {
    let rewardsOff = 0, stations = 0;
    for (const l of SAMPLE()) {
      const holders = l.props.filter(p => isLootHolderKind(p.kind));
      const keys = holders.map(p => `${p.level ?? 0}|${p.x.toFixed(2)}|${p.y.toFixed(2)}|${p.z.toFixed(2)}`);
      expect(new Set(keys).size, `${l.seed} duplicate holders`).toBe(keys.length);
      const roll = () => { let ci = 0, si = 0; return holders.map(p => { const k = p.kind as HolderKind; const a = l.areas[p.area]; return createHolderState(l.seed, isContainerKind(k) ? ci++ : si++, k, p.purpose ?? a.purpose ?? a.type, holderSurfaces(k, PROP_DEFS[k])).lots.map(x => `${x.id}:${x.itemId}:${x.count}`); }); };
      expect(roll()).toEqual(roll());
      const sum = compositionOf(l)!;
      expect(l.props.some(p => p.kind === 'crate' && p.purpose === 'storage' && p.cluster !== undefined), `${l.seed} has a cache`).toBe(true);
      if (levelsOf(l).length > 1) {
        stations++;
        if (sum.clusters.some(c => c.level !== 0 && c.reward)) rewardsOff++;
      }
      const pk = l.pickups.map(p => `${p.level ?? 0}|${p.x.toFixed(2)}|${p.z.toFixed(2)}|${p.itemId}`);
      expect(new Set(pk).size).toBe(pk.length);
    }
    if (stations) expect(rewardsOff / stations).toBeGreaterThan(0.6);
  });

  it('budgets: placements, distinct kinds, draw-call estimate, triangles and texture memory stay bounded', () => {
    const metrics = (props: readonly PropPlacement[]) => {
      const p7 = props.filter(p => isP7Kind(p.kind));
      const kinds = new Set(p7.map(p => p.kind));
      const chunks = new Map<string, Set<string>>();
      for (const p of props) { let s = chunks.get(p.kind); if (!s) chunks.set(p.kind, (s = new Set())); s.add(`${Math.floor(p.x / 18)},${Math.floor(p.z / 18)}`); }
      return {placements: props.length, draws: [...chunks.values()].reduce((s, c) => s + c.size, 0), kinds: kinds.size,
        mb: [...kinds].reduce((s, k) => s + M[k].gpuBytes, 0) / 1e6, tris: p7.reduce((s, p) => s + M[p.kind].tris, 0)};
    };
    for (const l of SEEDS.map(s => gen(s))) {
      // Iteration-07 maxima over the same seeds: 718 placements, 428 draws, 60 p7 kinds, 230 MB, 0.84 M tris — +25 % for the levels.
      // Track 2 (lane CONTENT): those caps hold for the CORE station (its core view); each seeded service annex adds its own
      // explicit allowance (gen/annexContent.ts budgets; measured per annex ~150-160 placements, ~65-80 draw chunks, ~20-32k p7
      // triangles; the annexes use the station's own p7 palette: no new kinds / textures beyond it).
      const c = metrics(coreView(l).props), live = metrics(l.props);
      expect(c.placements, `${l.seed} placements`).toBeLessThanOrEqual(900);
      expect(c.draws, `${l.seed} draws`).toBeLessThanOrEqual(540);
      expect(c.kinds, `${l.seed} p7 kinds`).toBeLessThanOrEqual(64);
      expect(c.mb, `${l.seed} p7 texture MB`).toBeLessThanOrEqual(260);
      expect(c.tris, `${l.seed} p7 tris`).toBeLessThanOrEqual(1.05e6);
      const annexes = l.extensions?.annexes ?? [], m2 = annexes.reduce((s, n) => s + n.areaM2, 0);
      expect(live.placements, `${l.seed} placements (+ annexes)`).toBeLessThanOrEqual(c.placements + Math.ceil(1.25 * m2 / ANNEX_CONTENT.m2PerProp));
      expect(live.draws, `${l.seed} draws (+ annexes)`).toBeLessThanOrEqual(540 + 90 * annexes.length);
      expect(live.kinds, `${l.seed} p7 kinds (+ annexes)`).toBeLessThanOrEqual(64);
      expect(live.mb, `${l.seed} p7 texture MB (+ annexes)`).toBeLessThanOrEqual(260);
      expect(live.tris, `${l.seed} p7 tris (+ annexes)`).toBeLessThanOrEqual(1.05e6 + 60e3 * annexes.length);
    }
  });
});

describe('level-aware placement kit (hand-built two-level fixture)', () => {
  // 40 x 24 cells (20 x 12 m). Main level: a hall over the whole floor (floor 0, ceil 7). Upper level (floor 4.4): a deck over the north half
  // with a 4 x 8 cell light well cut into it (closed on the upper grid while the main band rises through it) and a stair from the
  // main floor up onto the deck carved in both grids.
  function fixture(): {layout: StationLayout; hall: Area; deck: Area} {
    const W = 40, H = 24;
    const g0 = new Grid(W, H), g1 = new Grid(W, H);
    const hall: Area = {id: 0, x: 1, y: 1, w: 38, h: 22, kind: 'concourse', type: 'concourse', label: 'Hall', ceil: 7, parent: -1, depth: 0, publicSpace: true, lighting: 'lit'};
    const deck: Area = {id: 1, x: 1, y: 1, w: 38, h: 9, kind: 'concourse', type: 'concourse', label: 'Deck', ceil: 7.6, parent: 0, depth: 1, publicSpace: true, lighting: 'lit', level: 1, floorY: 4.4};
    for (let y = 1; y < 23; y++) for (let x = 1; x < 39; x++) { const i = g0.idx(x, y); g0.cells[i] = FLOOR; g0.area[i] = 0; g0.ceil[i] = y < 10 ? 4.05 : 7; }
    for (let y = 1; y < 10; y++) for (let x = 1; x < 39; x++) { const i = g1.idx(x, y); g1.cells[i] = FLOOR; g1.area[i] = 1; g1.floor[i] = 4.4; g1.ceil[i] = 7.6; }
    // Light well: closed on the upper level; the hall below reaches up to the upper ceiling there.
    for (let y = 3; y < 7; y++) for (let x = 16; x < 24; x++) { const i = g1.idx(x, y); g1.cells[i] = SOLID; g1.area[i] = -1; g0.ceil[i] = 7.6; }
    const levels: Level[] = [{id: 0, role: 'main', grid: g0, baseY: 0}, {id: 1, role: 'upper', grid: g1, baseY: 4.4}];
    const layout = {
      seed: 1, attempt: 0, name: 'Fixture', archetype: 'side-mezzanine', towards: ['A', 'B'], grid: g0, areas: [hall, deck], doors: [], props: [], lights: [], signs: [], pickups: [], zombies: [],
      storefronts: [], decor: [], playerSpawn: {x: 30, z: 18, yaw: 0}, trench: undefined as never, trenches: [], platform: 0, platforms: [0],
      traversal: {stairs: [], ladders: [], underpasses: []}, levels, levelLinks: [{id: 0, kind: 'stairs', lower: 0, upper: 1, bottom: {x: 4, y: 0, z: 9}, top: {x: 4, y: 4.4, z: 2}}], rails: [],
    } as unknown as StationLayout;
    return {layout, hall, deck};
  }

  it('the upper context sees the light well as an aperture: no backing on it, setback around it, landings kept clear', () => {
    const {layout, deck} = fixture();
    const up = makePlaceCtx(layout, new Rng(2), 1), main = makePlaceCtx(layout, new Rng(2), 0);
    const g1 = levelGrid(layout, 1);
    // The well's rim (closed cells beside deck floor) is the aperture edge; its interior has no deck floor beside it.
    expect(up.aperture[g1.idx(16, 4)]).toBe(1);
    expect(up.aperture[g1.idx(18, 4)]).toBe(0);
    expect(main.aperture.some(v => v === 1)).toBe(false);
    // Deck floor cells next to the well keep a one-cell setback; the stair landings (level-link ends) are kept clear too.
    expect(up.edge[g1.idx(15, 4)]).toBe(1);
    expect(up.edge[g1.idx(18, 8)]).toBe(0);
    expect(up.edge[g1.cellOf(4, 2)[1] * g1.w + g1.cellOf(4, 2)[0]]).toBe(1);
    expect(main.edge[main.g.cellOf(4, 9)[1] * main.g.w + main.g.cellOf(4, 9)[0]]).toBe(1);
    // A sign / prop may back onto the deck's outer wall, never onto the well's edge seen from inside a recess.
    const wellArea: Area = {...deck, id: 1, x: 16, y: 7, w: 8, h: 3};
    expect(backed(up, wellArea, 'N', 16.5 * CELL, 19 * CELL, 4.4)).toBe(false);
    expect(backed(up, deck, 'N', 10, 12, 4.4)).toBe(true);
  });

  it('props placed on the upper context are tagged with their level and kept off the aperture edge', () => {
    const {layout, deck} = fixture();
    const up = makePlaceCtx(layout, new Rng(3), 1);
    const bin = tryPlaceProp(up, deck, 'bin', 14, 1.5, 0, {});
    expect(bin?.level).toBe(1);
    // Hard against the well (aperture setback): refused.
    expect(tryPlaceProp(up, deck, 'bin', 15.5 * CELL, 4.5 * CELL, 0, {})).toBeNull();
    // A main-level prop under the deck is fine and untagged.
    const {hall} = fixture();
    const main = makePlaceCtx(layout, new Rng(3), 0);
    const crate = tryPlaceProp(main, hall, 'crate', 10, 9, 0, {});
    expect(crate && crate.level === undefined).toBe(true);
    expect(STAIR_APPROACH).toBeGreaterThanOrEqual(1.5);
  });
});
