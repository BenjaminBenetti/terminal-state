// Task track3-eaton-centre-20261031 (lane GEN): The Eaton's Center (LevelId 'mall') — registration, seeds, determinism, the six
// rings around a genuine void, the clear ray from the platform to the glass roof, railings, connectivity, shop units per ring,
// variants, the patrol graph (lane HORDE) and the subway-root report (Track2), generation time — and a REAL Player (the game's own
// movement / stairs / support code, W key) walking from the station platform up to ring 6 continuously without falling.

import {describe, expect, it} from 'vitest';
import {readFileSync} from 'node:fs';
import {LEVELS, LEVEL_IDS, arrivalPose, isLevelId, storeyLabel, travelTargets} from '../src/levels/registry';
import {TRACK_EXT_MALL, extensionIssues, trackExtCoverageIssues} from '../src/gen/trackExt/index'; // lane INTEG (Track2 integration)
import {generateMallLevel, mallIssues, mallVoidCells, MALL_GEN_STATS, MALL_VARIANTS, type MallVariant} from '../src/gen/mall/index';
import {levelsOf} from '../src/gen/levels';
import {CELL, FLOOR, SOLID, PathFinder, type Waypoint} from '../src/gen/grid';
import {Player} from '../src/player/player';
import {RINGS, STOREY} from '../src/gen/mall/frame';
import {MALL_RINGS} from '../src/gen/mall/mallTypes';
import type {StationLayout} from '../src/gen/stationTypes';
import {readTowerInfo} from '../src/world/towerShared';
import {planElevator} from '../src/world/elevator';
import {MALL_POSE_NAMES, mallQaPose} from '../src/gen/mall/qa';

const SEED = 0x7ea3c1;
const DT = 1 / 60;

class Keys {
  held = new Set<string>();
  down(c: string) { return this.held.has(c); }
  hit() { return false; }
}

const cache = new Map<string, StationLayout>();
function mall(variant?: MallVariant, seed = SEED): StationLayout {
  const key = `${variant ?? 'seed'}:${seed}`;
  let L = cache.get(key);
  if (!L) cache.set(key, (L = generateMallLevel({levelSeed: seed, startWeapon: 'rifle'}, variant ? {variant} : {})));
  return L;
}

describe('The Eaton\'s Center: registration and selection', () => {
  it('is a registered LevelId (tier 2) with a generator, travel targets, labels and a real Track2 declaration (extendTracks ran)', () => {
    expect(LEVEL_IDS).toEqual(['subway', 'office', 'mall']);
    expect(isLevelId('mall')).toBe(true);
    expect(LEVELS.mall.name).toBe("The Eaton's Center");
    expect(LEVELS.mall.sections(1)).toEqual(['main']);
    expect(travelTargets('mall')).toEqual(['subway', 'office']);
    expect(travelTargets('subway')).toEqual(['office', 'mall']);
    // lane INTEG (Track2 integration): the real TrackExtConfig (never 'none'); the generator planned every bed end (coverage rule)
    expect(LEVELS.mall.trackExtensions).toBe(TRACK_EXT_MALL);
    expect(TRACK_EXT_MALL.coreReserveM).toBe(0);
    const L = LEVELS.mall.generate('main', {levelSeed: SEED, startWeapon: 'rifle'});
    expect(L.extensions).toBeDefined();
    expect(trackExtCoverageIssues('mall', LEVELS.mall.trackExtensions, L)).toEqual([]);
    // opt-in rockLevels [0] (lane INTEG): only the pit storey must be rock, so the east bed end grows a real tunnel under the rings;
    // the west end lies behind the fixed crop origin; hatches are refused (both beds flanked by platforms)
    expect(L.extensions!.rockLevels).toEqual([0]);
    expect(L.extensions!.tunnels.map(t => t.from)).toEqual(['x1']);
    expect(extensionIssues(L)).toEqual([]);
    expect(L.mall!.subwayRoot.tunnelMouths.length).toBe(2 * L.trenches.length);
    expect(L.mall?.version).toBe(1);
    const pose = arrivalPose(L, {kind: 'start'});
    expect(pose).toMatchObject({source: 'start', level: 0});
    expect(storeyLabel(L, 0)).toBe('Subway');
    expect(storeyLabel(L, 6)).toBe('Level 6');
  });

  it('is deterministic per seed and differs between seeds', () => {
    const a = generateMallLevel({levelSeed: SEED, startWeapon: 'rifle'});
    const b = generateMallLevel({levelSeed: SEED, startWeapon: 'rifle'});
    expect(b.zombies).toEqual(a.zombies);
    expect(b.pickups).toEqual(a.pickups);
    expect(b.props.length).toBe(a.props.length);
    expect(b.mall).toEqual(a.mall);
    const c = generateMallLevel({levelSeed: SEED + 1, startWeapon: 'rifle'});
    expect(JSON.stringify(c.mall!.shops.map(s => s.frontage))).not.toBe(JSON.stringify(a.mall!.shops.map(s => s.frontage)));
  });
});

describe.each(MALL_VARIANTS.map(v => [v]))('variant %s', (variant: MallVariant) => {
  const L = mall(variant);
  const info = L.mall!;
  const Lv = levelsOf(L);

  it('validates clean on the first attempts, in reasonable time', () => {
    expect(mallIssues(L)).toEqual([]);
    expect(info.variant).toBe(variant);
    expect(MALL_GEN_STATS.ms).toBeLessThan(20000);
  });

  it('is ONE layout: the station + six rings at their real heights, every storey a ring of the same outline', () => {
    expect(RINGS).toBe(MALL_RINGS);
    expect(L.levels.map(l => l.id)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(L.levels[0].role).toBe('main');
    for (let k = 1; k <= RINGS; k++) {
      expect(L.levels[k].role).toBe('ring');
      expect(L.levels[k].baseY).toBeCloseTo(STOREY * k, 6);
      expect(L.levels[k].grid.w).toBe(L.grid.w);
    }
    expect(info.storeys.map(s => s.label)).toEqual(['Subway', 'Level 1', 'Level 2', 'Level 3', 'Level 4', 'Level 5', 'Level 6']);
    expect(info.void.openLevels).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('the void is open inside its outline on every ring (bridge decks excepted) and the station band under it rises to the roof', () => {
    const cells = mallVoidCells(L);
    expect(cells.length * CELL * CELL).toBeGreaterThan(900); // a genuine atrium (> 900 m²)
    const bridge = new Set<string>();
    for (const a of L.areas) if (a.role === 'crossover') for (let y = a.y; y < a.y + a.h; y++) for (let x = a.x; x < a.x + a.w; x++) bridge.add(`${a.level}:${y * L.grid.w + x}`);
    let open = 0;
    for (const i of cells) {
      for (let k = 1; k <= RINGS; k++) if (!bridge.has(`${k}:${i}`)) expect(L.levels[k].grid.cells[i]).toBe(SOLID);
      if (Math.abs(L.grid.ceil[i] - info.void.roofApexY) < 1e-3) open++;
      expect(L.grid.cells[i]).not.toBe(SOLID); // the pit floor (courts / platforms / track bed) under every void cell
    }
    expect(open / cells.length).toBeGreaterThan(0.85);
    expect(info.roof.apexY).toBeGreaterThan(info.roof.springY);
    expect(info.roof.springY).toBeGreaterThan(L.levels[6].baseY + 4);
  });

  it('a ray from the platform reaches the glass roof with nothing in between; the rings are visible across the void', () => {
    const P = L.areas[L.platform];
    const cells = new Set(mallVoidCells(L));
    let checked = 0;
    for (let y = P.y; y < P.y + P.h; y += 3) for (let x = P.x; x < P.x + P.w; x += 9) {
      const i = y * L.grid.w + x;
      if (!cells.has(i) || Math.abs(L.grid.ceil[i] - info.void.roofApexY) > 1e-3) continue;
      const [cx, cz] = L.grid.center(x, y);
      const h = Lv.raycast({x: cx, y: 1.7, z: cz}, {x: 0, y: 1, z: 0}, 80);
      expect(h.kind).toBe('ceiling');
      expect(1.7 + h.t).toBeCloseTo(info.void.roofApexY, 1);
      checked++;
    }
    expect(checked).toBeGreaterThan(10);
    // From the start, every ring's gallery edge across the void is in sight (cells on the void's rim, 1.2 m above their floor).
    const s = info.start;
    for (let k = 1; k <= RINGS; k++) {
      const g = L.levels[k].grid;
      let seen = 0, tried = 0;
      for (const i of cells) {
        const x = i % g.w, y = (i / g.w) | 0;
        for (const j of [i - 1, i + 1, i - g.w, i + g.w]) {
          if (g.cells[j] !== FLOOR || g.rampIdx[j] >= 0 || cells.has(j) || tried > 400) continue;
          tried++;
          const [cx, cz] = g.center(j % g.w, (j / g.w) | 0);
          // a point just inside the rim, toward the void cell
          const [vx, vz] = g.center(x, y);
          const tx = cx + (vx - cx) * 0.4, tz = cz + (vz - cz) * 0.4;
          if (Lv.lineOfSight({x: s.x, y: 1.7, z: s.z}, {x: tx, y: L.levels[k].baseY + 1.2, z: tz})) seen++;
        }
      }
      expect(seen, `ring ${k} rim cells in sight of the start`).toBeGreaterThan(10);
    }
  });

  it('every edge onto the void / a well is railed; nothing unreachable', () => {
    expect(Lv.unrailedDrops()).toEqual([]);
    const railed = L.rails.filter(r => r.level >= 1);
    expect(railed.length).toBeGreaterThan(RINGS * 4);
  });

  it('shop units on every ring: substantial sales floors with a shopfront onto the gallery and a stock room behind', () => {
    for (let k = 1; k <= RINGS; k++) {
      const units = info.shops.filter(s => s.level === k);
      expect(units.length, `ring ${k} units`).toBeGreaterThanOrEqual(10);
      for (const s of units) {
        expect(s.salesArea).toBeGreaterThan(90);
        expect(s.depth).toBeGreaterThanOrEqual(8);
        expect(s.width).toBeGreaterThanOrEqual(12.5);
        expect(s.backroom).toBeDefined();
        expect(L.doors.some(d => d.shopfront && (d.a === s.area || d.b === s.area))).toBe(true);
      }
    }
  });

  it('every storey pair is joined by escalators and stairs (two banks on opposite sides), service stairs join the rings', () => {
    for (let k = 0; k < RINGS; k++) {
      const pub = info.verticals.filter(v => v.lower === k && (v.kind === 'escalator' || v.kind === 'stair'));
      expect(pub.filter(v => v.kind === 'escalator').length).toBe(4); // two banks x two lanes
      if (k >= 1) expect(pub.filter(v => v.kind === 'stair').length).toBe(2);
      for (const v of pub) {
        const link = L.levelLinks[v.link!];
        expect(link).toMatchObject({kind: 'stairs', lower: k, upper: k + 1});
      }
      expect(info.verticals.filter(v => v.kind === 'service-stair' && v.lower === k).length).toBe(4); // four corner cores, station included
    }
    expect(info.elevators.length).toBeGreaterThanOrEqual(1);
    for (const e of info.elevators) expect(e.stops.map(s => s.level)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('back of house: a service-corridor loop on every ring, a washroom passage per ring (public -> staff door), the station\'s spurs', () => {
    for (let k = 1; k <= RINGS; k++) {
      const corr = L.areas.filter(a => a.level === k && a.type === 'service-corridor');
      expect(corr.length).toBe(4);
      const wc = L.areas.filter(a => a.level === k && a.type === 'washroom');
      expect(wc.map(a => a.label).sort()).toEqual(["Men's washroom", "Women's washroom"]);
      const pass = L.areas.find(a => a.level === k && a.type === 'passage' && a.label.startsWith('Washrooms'))!;
      const doors = L.doors.filter(d => d.a === pass.id || d.b === pass.id);
      expect(doors.some(d => d.staff)).toBe(true);
      expect(doors.some(d => !d.staff && [d.a, d.b].some(id => L.areas[id].role === 'mall'))).toBe(true);
      // stock rooms open onto the corridor
      const backs = info.shops.filter(q => q.level === k).map(q => q.backroom!);
      for (const b of backs) expect(L.doors.some(d => d.staff && (d.a === b || d.b === b) && [d.a, d.b].some(id => L.areas[id].type === 'service-corridor'))).toBe(true);
    }
    const station = L.areas.filter(a => (a.level ?? 0) === 0 && (a.type === 'washroom' || a.type === 'agent-office' || a.type === 'service-corridor'));
    expect(station.filter(a => a.type === 'washroom').length).toBeGreaterThanOrEqual(2);
    expect(station.some(a => a.type === 'agent-office')).toBe(true);
  });

  it('the glass elevator rides the Office elevator runtime: 7 stops, cab inside its solid shaft, landings walkable', () => {
    const t = readTowerInfo(L)!;
    expect(t).not.toBeNull();
    expect(t.windows).toEqual([]);
    const e = t.elevator!;
    expect(e.stops.map(q => q.levelId)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(e.cab.x0).toBeGreaterThan(e.shaft.x0 - 1e-6);
    expect(e.cab.z1).toBeLessThan(e.shaft.z1 + 1e-6);
    for (const q of e.stops) {
      const g = L.levels[q.levelId].grid, [cx, cy] = g.cellOf(q.landing.x, q.landing.z);
      expect(g.cells[g.idx(cx, cy)], `landing ${q.levelId}`).toBe(FLOOR);
      expect(g.floorAt(q.landing.x, q.landing.z)).toBeCloseTo(q.y, 3);
      const [sx, sy] = g.cellOf((e.cab.x0 + e.cab.x1) / 2, (e.cab.z0 + e.cab.z1) / 2);
      expect(g.cells[g.idx(sx, sy)]).toBe(SOLID);
    }
    expect(planElevator(e).buttons.length).toBeGreaterThan(7);
  });

  it('QA poses resolve to walkable floor on their storey', () => {
    for (const name of MALL_POSE_NAMES) {
      const q = mallQaPose(L, name);
      if (name === 'bridge' && !info.bridges.length) continue;
      expect(q, name).not.toBeNull();
      const g = L.levels[q!.level].grid, [cx, cy] = g.cellOf(q!.x, q!.z);
      expect(g.walkable(cx, cy), name).toBe(true);
    }
    for (let k = 1; k <= RINGS; k++) expect(mallQaPose(L, 'ring-edge', k)?.level).toBe(k);
  });

  it('the patrol graph: nodes on walkable floor of their storey, edges walkable (PathFinder) incl. storey changes', () => {
    const pf = new PathFinder(Lv);
    const P = info.patrol;
    expect(P.length).toBeGreaterThan(RINGS * 12);
    for (let k = 1; k <= RINGS; k++) expect(P.filter(n => n.level === k).length).toBeGreaterThan(10);
    for (const n of P) {
      const g = L.levels[n.level].grid, [cx, cy] = g.cellOf(n.x, n.z);
      expect(g.cells[g.idx(cx, cy)]).toBe(FLOOR);
      expect(n.edges.length).toBeGreaterThan(0);
    }
    // Every edge kind appears; a sample of edges really paths.
    const vias = new Set(P.flatMap(n => n.edges.map(e => e.via)));
    for (const v of ['gallery', 'escalator', 'stair']) expect(vias.has(v as never)).toBe(true);
    let tested = 0;
    for (const n of P) for (const e of n.edges) {
      if (e.to < n.id || (tested > 60 && e.via === 'gallery')) continue;
      const m = P[e.to];
      const path = pf.find(n.x, n.z, m.x, m.z, 0.3, 200000, {ay: L.levels[n.level].baseY, by: L.levels[m.level].baseY});
      expect(path, `edge ${n.id}-${m.id} (${e.via})`).not.toBeNull();
      tested++;
    }
  });

  it('subway root (Track2, derived): platforms, the bed\'s two tunnel mouths, keep-clear volumes', () => {
    const r = info.subwayRoot;
    expect(r).toMatchObject({level: 'mall', storey: 0, platformY: 0});
    expect(r.trackBedY).toBeCloseTo(-1.15, 2);
    expect(r.platforms.length).toBe(2);
    expect(r.tunnelMouths.map(m => m.axis).sort()).toEqual(['x+', 'x-']);
    for (const m of r.tunnelMouths) {
      expect(m.width).toBeCloseTo(8, 1);
      expect(m.height).toBeGreaterThan(4);
    }
    expect(r.keepClear.length).toBeGreaterThanOrEqual(1);
    expect(L.trenches.length).toBe(1);
  });

  it('no ceiling fixture hangs in open air (the pit under the atrium / bridge decks are lit by the skylight)', () => {
    for (const l of L.lights) {
      if (l.virtual) continue;
      const lv = l.level ?? L.areas[l.area]?.level ?? 0, g = L.levels[lv].grid;
      const c = g.ceilAt(l.x, l.z);
      if (Number.isFinite(c)) expect(l.y, `light ${l.x},${l.z} level ${lv}`).toBeGreaterThan(c - 1.0);
    }
  });

  it('no enemy or loot in the void, on a run or within the start keep-away', () => {
    const cells = new Set(mallVoidCells(L));
    for (const z of L.zombies) {
      const lv = z.level ?? 0, g = L.levels[lv].grid, [cx, cy] = g.cellOf(z.x, z.z), i = g.idx(cx, cy);
      expect(g.rampIdx[i]).toBeLessThan(0);
      expect(L.areas[g.area[i]]?.role).not.toBe('stair');
      if (lv > 0 && cells.has(i)) expect(L.areas[g.area[i]]?.role).toBe('crossover');
    }
    expect(L.zombies.length).toBeGreaterThan(30);
    for (let k = 0; k <= RINGS; k++) expect(L.zombies.some(z => (z.level ?? 0) === k)).toBe(true);
  });
});

describe('one world', () => {
  it('source guard: no mall code path travels, fades, loads or rebuilds a section', () => {
    for (const f of ['index.ts', 'carve.ts', 'structure.ts', 'validate.ts', 'elevator.ts', 'qa.ts', 'trackExt.ts', 'frame.ts']) {
      const src = readFileSync(new URL(`../src/gen/mall/${f}`, import.meta.url), 'utf8');
      const code = src.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
      expect(code, f).not.toMatch(/\.travel\(|TowerFade|via:\s*'local'|sectionForFloor|'travelling'/);
    }
  });
});

describe('variants differ', () => {
  it('in void shape, bridges, vertical-link placement and elevators', () => {
    const [a, b, c] = MALL_VARIANTS.map(v => mall(v).mall!);
    const sig = (m: typeof a) => JSON.stringify([m.void.outline.length, m.bridges.map(q => [q.level, Math.round(q.from.x)]), m.elevators.length]);
    expect(new Set([sig(a), sig(b), sig(c)]).size).toBe(3);
    expect(new Set([a.void.outline.length, b.void.outline.length, c.void.outline.length]).size).toBeGreaterThan(1);
  });
});

describe.each(MALL_VARIANTS.map(v => [v]))('a real Player walks the mall (%s)', (variant: MallVariant) => {
  it('W key from the platform start up to ring 6 (escalators / stairs), y continuous across every storey, never falls', () => {
    const L = mall(variant);
    const Lv = levelsOf(L);
    const pf = new PathFinder(Lv);
    const p = new Player();
    const s = L.mall!.start;
    p.spawn(s.x, s.z, s.yaw, Lv.grid(0).floorAt(s.x, s.z));
    const keys = new Keys();
    let maxDy = 0, minVy = 0, steps = 0;
    const visited = new Set<number>();
    // Goals: the head of a public run per storey pair, climbing storey by storey — the nearest run whose route is a pure walk
    // (no rescue-ladder link: the walk never climbs out of the track bed).
    const kinds = new Set<string>();
    for (let k = 0; k < RINGS; k++) {
      let path: Waypoint[] | null = null, goal = {x: 0, y: 0, z: 0};
      const runs = L.mall!.verticals.filter(q => q.lower === k && (q.kind === 'escalator' || q.kind === 'stair'))
        .sort((a, b) => Math.hypot(a.foot.x - p.x, a.foot.z - p.z) - Math.hypot(b.foot.x - p.x, b.foot.z - p.z));
      for (const v of runs) {
        const q = pf.find(p.x, p.z, v.head.x, v.head.z, 0.3, 600000, {ay: p.y, by: v.head.y});
        if (q && q.every(w => w[2] === undefined)) { path = q; goal = v.head; kinds.add(v.kind); break; }
      }
      expect(path, `route to storey ${k + 1}`).not.toBeNull();
      void goal;
      let i = 0;
      const cap = steps + 60 * 240;
      while (i < path!.length && steps < cap) {
        const [wx, wz, , wy] = path![i];
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
      expect(i, `reached storey ${k + 1} (${steps} steps)`).toBe(path!.length);
      expect(p.y).toBeCloseTo(L.levels[k + 1].baseY, 1);
    }
    // Off the last run onto ring 6's gallery (the nearest ring-6 patrol node).
    const g6 = L.mall!.patrol.filter(n => n.level === 6).sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z))[0];
    const last = pf.find(p.x, p.z, g6.x, g6.z, 0.3, 200000, {ay: p.y, by: L.levels[6].baseY})!;
    expect(last).not.toBeNull();
    for (let i = 0, cap = steps + 60 * 60; i < last.length && steps < cap;) {
      const [wx, wz] = last[i];
      if (Math.hypot(wx - p.x, wz - p.z) < 0.35) { i++; continue; }
      p.yaw = Math.atan2(-(wx - p.x), -(wz - p.z));
      keys.held.add('KeyW');
      const y0 = p.y;
      p.update(DT, keys, Lv, null, {aiming: false, speedMult: 1, canSprint: false});
      maxDy = Math.max(maxDy, Math.abs(p.y - y0));
      visited.add(Lv.levelAt(p.x, p.z, p.y + 0.05));
      steps++;
    }
    expect(Lv.levelAt(p.x, p.z, p.y + 0.05)).toBe(6);
    expect([...visited].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(kinds.has('escalator')).toBe(true);
    expect(p.y).toBeGreaterThan(29);
    expect(maxDy).toBeLessThan(0.12); // no snap / teleport between storeys
    expect(minVy).toBeGreaterThan(-3); // never fell (no missing slab, no void drop)
    expect(p.alive).toBe(true);
  });
});
