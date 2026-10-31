// Track 2 — Beyond the Station (lane GEN): track extensions — traversable tunnels past the bed ends and service annexes off
// them. Determinism, a census over seed corpora of BOTH track-bearing levels (tunnels per level, lengths, bends, caps, annex count
// distribution incl. 0 / 1 / 2-annex seeds, annex areas and their ratio to the measured Subway baseline, generation time),
// occupancy / omission rules, reachability both ways (PathFinder), clue validity and the baseline constant itself.
// The core-preservation proofs live in tests/track-ext-core.test.ts, the level coverage in tests/track-ext-coverage.test.ts.
import {describe, expect, it} from 'vitest';
import {generateStation, STATION_EXT_MAX_CELLS} from '../src/gen/station';
import {generateOfficeLevel, OFFICE_EXT_MAX_CELLS} from '../src/gen/office/index';
import {CELL, FLOOR, PathFinder, SOLID, VOID} from '../src/gen/grid';
import {
  SUBWAY_WALK_BASELINE_M2, TRACK_EXT, TRACK_EXT_STATS, extensionIssues, isExtensionArea, type TrackExtensions,
} from '../src/gen/trackExt/index';
import {buildPath, pointAt, project, walkCells, tubeCells} from '../src/gen/trackExt/path';
import type {StationLayout} from '../src/gen/stationTypes';

const SUBWAY_SEEDS = Array.from({length: 24}, (_, i) => (i * 2654435761 + 12345) >>> 0);
const OFFICE_SEEDS = [3, 7922, 15841, 23760, 31679, 39598];
/** Seeds by annex count (found by the census; deterministic). */
const SUBWAY_ANNEX = {0: 12345, 1: 4055629249, 2: 2563024239};
const OFFICE_ANNEX = {0: 31679, 1: 3, 2: 7922};

const subCache = new Map<number, StationLayout>(), offCache = new Map<number, StationLayout>();
const sub = (seed: number) => { let l = subCache.get(seed); if (!l) subCache.set(seed, (l = generateStation(seed))); return l; };
const off = (levelSeed: number) => { let l = offCache.get(levelSeed); if (!l) offCache.set(levelSeed, (l = generateOfficeLevel({levelSeed}))); return l; };
const report = (s: string) => process.stdout.write(`[track-ext] ${s}\n`);

/** Walkable floor (m²) of the core: FLOOR cells with an area id over every level grid, beds excluded (the baseline basis). */
function walkM2(l: StationLayout, ext: boolean): number {
  let n = 0;
  for (const L of l.levels) for (let i = 0; i < L.grid.cells.length; i++) {
    const a = L.grid.area[i];
    if (L.grid.cells[i] === FLOOR && a >= 0 && isExtensionArea(l.areas[a]) === ext) n++;
  }
  return n * CELL * CELL;
}

describe('track extensions — path math', () => {
  it('rasterises a bed-aligned straight exactly as wide as the bed and a bend conservatively inside its smooth walls', () => {
    // a two-track bed (8 m) ending at x = 10 m, rows z 2..10 m: the tunnel's first column holds every bed row (no lip)
    const half = 4, start = {x: 10, z: 6};
    const straight = buildPath(start, {x: 1, z: 0}, [{line: 40}]);
    const tube = tubeCells(straight, half, 30, 1.5);
    const walk = walkCells(straight, half, 30, tube);
    const col = walk.x.map((x, i) => [x, walk.y[i]]).filter(([x]) => x === 20).map(([, y]) => y).sort((a, b) => a - b);
    expect(col).toEqual(Array.from({length: 16}, (_, i) => 4 + i));
    expect(Math.max(...walk.x)).toBe(79); // s = 30 m: the last column ends exactly at the cap plane
    // a 45 degree bend (R 14 m): every walkable cell corner lies inside the walls; cells straddling the wall are solid
    const bent = buildPath(start, {x: 1, z: 0}, [{line: 8}, {arc: {r: 14, turnDeg: 45}}, {line: 30}]);
    const bt = tubeCells(bent, half, 40, 1.5), bw = walkCells(bent, half, 40, bt);
    for (let i = 0; i < bw.x.length; i++) {
      for (const [cx, cz] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        const q = project(bent, (bw.x[i] + cx) * CELL, (bw.y[i] + cz) * CELL)!;
        expect(Math.abs(q.lat)).toBeLessThanOrEqual(half + 1e-9);
      }
    }
    // the bend turns left (toward -Z when travelling +X) and keeps the tunnel's width
    const end = pointAt(bent, 40);
    expect(end.d.x).toBeCloseTo(Math.cos(Math.PI / 4), 9);
    expect(end.d.z).toBeCloseTo(-Math.sin(Math.PI / 4), 9);
    expect(bw.x.length).toBeGreaterThan(40 / CELL * 13);
  });
});

describe('track extensions — generation', () => {
  it('measures the Subway walkable baseline the annex target is a share of (constant within 6 % of a fresh sample)', () => {
    const vals = SUBWAY_SEEDS.slice(0, 16).map(s => walkM2(generateStation(s, {trackExtensions: 'none'}), false));
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    report(`Subway walkable baseline sample (16 seeds): mean ${mean.toFixed(0)} m² (constant ${SUBWAY_WALK_BASELINE_M2} m²), min ${Math.min(...vals)} max ${Math.max(...vals)}`);
    expect(Math.abs(mean / SUBWAY_WALK_BASELINE_M2 - 1)).toBeLessThan(0.06);
  });

  it('is deterministic per seed (records, cells, log) on both levels', () => {
    for (const [a, b] of [[generateStation(SUBWAY_ANNEX[2]), generateStation(SUBWAY_ANNEX[2])], [generateOfficeLevel({levelSeed: OFFICE_ANNEX[2]}), generateOfficeLevel({levelSeed: OFFICE_ANNEX[2]})]]) {
      expect(JSON.stringify(a.extensions)).toBe(JSON.stringify(b.extensions));
      expect(Buffer.from(a.grid.cells).equals(Buffer.from(b.grid.cells))).toBe(true);
      expect(Buffer.from(a.grid.area.buffer).equals(Buffer.from(b.grid.area.buffer))).toBe(true);
      expect(a.areas.filter(isExtensionArea)).toEqual(b.areas.filter(isExtensionArea));
    }
  });

  it('census: tunnels, lengths, bends, caps, annex counts / areas / ratios, grid budgets, timing (Subway + Office)', () => {
    const rescued0 = TRACK_EXT_STATS.rescued;
    const t0 = TRACK_EXT_STATS.ms, c0 = TRACK_EXT_STATS.calls;
    const lines: string[] = [];
    for (const [name, list, budget] of [['Subway', SUBWAY_SEEDS.map(sub), STATION_EXT_MAX_CELLS], ['Office', OFFICE_SEEDS.map(off), OFFICE_EXT_MAX_CELLS]] as const) {
      let ends = 0, tunnels = 0, levelsWith = 0, bends = 0, translated = 0;
      const lens: number[] = [], annexDist = [0, 0, 0], areas: number[] = [], caps: Record<string, number> = {}, cells: number[] = [];
      for (const l of list) {
        const e = l.extensions as TrackExtensions;
        expect(e, `${name} ${l.seed}: extensions`).toBeTruthy();
        expect(extensionIssues(l), `${name} ${l.seed}`).toEqual([]);
        ends += l.trenches.length * 2;
        tunnels += e.tunnels.length;
        if (e.tunnels.length) levelsWith++;
        if (e.core.x || e.core.y) translated++;
        cells.push(l.grid.w * l.grid.h);
        expect(l.grid.w * l.grid.h, `${name} ${l.seed}: grid budget`).toBeLessThanOrEqual(Math.max(budget, e.core.w * e.core.h));
        for (const t of e.tunnels) {
          lens.push(t.length);
          bends += t.arcs.length;
          caps[t.cap.kind] = (caps[t.cap.kind] ?? 0) + 1;
          expect(t.length).toBeGreaterThanOrEqual(TRACK_EXT.tunnel.length[0]);
          expect(t.length).toBeLessThanOrEqual(TRACK_EXT.tunnel.length[1]);
          expect(t.arcs.length).toBeLessThanOrEqual(2);
          expect(t.arcs.reduce((s, a) => s + Math.abs(a.turnDeg), 0)).toBeLessThanOrEqual(TRACK_EXT.tunnel.maxTurnDeg + 1e-6);
          for (const a of t.arcs) expect(a.radius).toBeGreaterThanOrEqual(14);
          expect(t.cap.s).toBe(t.length);
          // the path starts ON the bed end face, at the bed centre, samples <= 0.5 m apart, total = length
          const tr = l.trenches[t.trench];
          expect(t.path[0].x).toBeCloseTo(t.from === 'x1' ? tr.x1 : tr.x0, 6);
          expect(t.path[0].z).toBeCloseTo((tr.z0 + tr.z1) / 2, 6);
          let len = 0;
          for (let i = 1; i < t.path.length; i++) { const d = Math.hypot(t.path[i].x - t.path[i - 1].x, t.path[i].z - t.path[i - 1].z); expect(d).toBeLessThanOrEqual(CELL + 1e-6); len += d; }
          expect(Math.abs(len - t.length)).toBeLessThan(0.05);
          expect(t.width).toBeCloseTo(tr.z1 - tr.z0, 9);
          expect(t.floorY).toBe(tr.floorY);
          expect(t.ceilY).toBe(tr.ceil);
          expect(t.rails.length).toBe(tr.tracks.length);
        }
        annexDist[e.annexes.length]++;
        expect(e.annexes.length).toBeLessThanOrEqual(TRACK_EXT.annex.max);
        expect(new Set(e.annexes.map(a => a.tunnel)).size).toBe(e.annexes.length);
        for (const a of e.annexes) {
          areas.push(a.areaM2);
          expect(a.areaM2).toBeGreaterThanOrEqual(TRACK_EXT.annex.minShare * SUBWAY_WALK_BASELINE_M2 - 1e-6);
          expect(a.areaM2).toBeLessThanOrEqual(TRACK_EXT.annex.share * TRACK_EXT.annex.jitter[1] * SUBWAY_WALK_BASELINE_M2 * 1.06);
          expect(a.ceilY - a.floorY).toBeGreaterThanOrEqual(2.4 - 1e-6);
          expect(a.ceilY - a.floorY).toBeLessThanOrEqual(2.8 + 1e-6);
        }
      }
      const r2 = (v: number) => Math.round(v * 100) / 100;
      const ratios = areas.map(a => r2(a / SUBWAY_WALK_BASELINE_M2));
      lines.push(`${name} (${list.length} levels): tunnels ${tunnels}/${ends} bed ends, levels with >= 1 tunnel ${levelsWith}/${list.length}, translated cores ${translated}, ` +
        `length min ${Math.min(...lens)} mean ${r2(lens.reduce((a, b) => a + b, 0) / Math.max(1, lens.length))} max ${Math.max(...lens)} m, bends ${bends}, caps ${JSON.stringify(caps)}; ` +
        `annexes per level 0/1/2 = ${annexDist.join('/')}, areas ${areas.map(Math.round).join(', ')} m², ratio to the baseline ${ratios.join(', ')} ` +
        `(mean ${r2(ratios.reduce((a, b) => a + b, 0) / Math.max(1, ratios.length))}); grid cells max ${Math.max(...cells)} (budget ${budget})`);
      expect(tunnels, `${name}: some tunnels`).toBeGreaterThan(0);
    }
    lines.push(`extendTracks: ${TRACK_EXT_STATS.calls - c0} calls (incl. retried attempts), ${((TRACK_EXT_STATS.ms - t0) / Math.max(1, TRACK_EXT_STATS.calls - c0)).toFixed(1)} ms per call`);
    for (const s of lines) report(s);
    // no layout had to drop an invalid extension to pass validation
    expect(TRACK_EXT_STATS.rescued - rescued0).toBe(0);
  });

  it('seeded 0 / 1 / 2-annex levels exist on both levels', () => {
    for (const [n, seed] of Object.entries(SUBWAY_ANNEX)) expect(sub(seed).extensions!.annexes.length, `Subway ${seed}`).toBe(Number(n));
    for (const [n, seed] of Object.entries(OFFICE_ANNEX)) expect(off(seed).extensions!.annexes.length, `Office ${seed}`).toBe(Number(n));
  });

  it('occupancy: extensions never overlap the core or each other (margins), and failed attempts leave nothing behind', () => {
    for (const l of [sub(SUBWAY_ANNEX[2]), sub(SUBWAY_ANNEX[1]), off(OFFICE_ANNEX[2]), off(OFFICE_ANNEX[1])]) {
      const e = l.extensions!, g = l.grid, W = g.w;
      const groupOf = new Map<number, number>();
      for (const t of e.tunnels) for (const a of t.areas) groupOf.set(a, t.id);
      for (const n of e.annexes) for (const a of n.areas) groupOf.set(a, n.tunnel);
      // every extension area is referenced by exactly one record; every extension door joins areas of one group
      const ext = l.areas.filter(isExtensionArea);
      expect(ext.length).toBe(groupOf.size);
      const firstExt = ext[0]?.id ?? l.areas.length;
      expect(l.areas.slice(firstExt).every(isExtensionArea)).toBe(true);
      const extDoors = l.doors.filter(d => d.a >= firstExt || d.b >= firstExt);
      for (const d of extDoors) expect(groupOf.get(d.a), `door ${d.id}`).toBe(groupOf.get(d.b));
      expect(extDoors.filter(d => l.areas[d.a].ext === 'tunnel').length).toBe(e.annexes.length);
      // margins: no core open cell (any level) and no other group's cell within the margin of an extension cell, except a
      // tunnel mouth onto its own bed
      const extCell = (i: number) => g.area[i] >= firstExt;
      let bad = 0;
      for (let i = 0; i < g.cells.length; i++) {
        if (!extCell(i)) continue;
        const grp = groupOf.get(g.area[i])!, x = i % W, y = (i - x) / W, a = l.areas[g.area[i]];
        const m = Math.max(TRACK_EXT.margin.core, TRACK_EXT.margin.ext);
        for (let oy = -m; oy <= m; oy++) for (let ox = -m; ox <= m; ox++) {
          const j = (y + oy) * W + (x + ox);
          const cheb = Math.max(Math.abs(ox), Math.abs(oy));
          if (extCell(j)) { if (groupOf.get(g.area[j]) !== grp && cheb <= TRACK_EXT.margin.ext) bad++; continue; }
          if (cheb > TRACK_EXT.margin.core) continue;
          const open = l.levels.some(L => L.grid.cells[j] !== SOLID);
          if (!open) continue;
          // the tunnel's own bed at its mouth
          const t = a.ext === 'tunnel' ? e.tunnels[a.extId!] : null;
          const tr = t ? l.trenches[t.trench] : null;
          if (tr && g.cells[j] === VOID && (x + ox) * CELL >= tr.x0 - 1e-6 && (x + ox) * CELL < tr.x1 && (y + oy) * CELL >= tr.z0 - 1e-6 && (y + oy) * CELL < tr.z1) continue;
          bad++;
        }
      }
      expect(bad, `${l.seed}: margin violations`).toBe(0);
      // clean omission: every log entry about an omitted annex left no annex area behind
      expect(e.log.filter(g2 => g2.result.startsWith('annex ')).length).toBe(e.annexes.length);
    }
  });

  it('reachability both ways: platform -> bed -> tunnel -> annex door -> the farthest annex cell, and back to a bed ladder (PathFinder)', () => {
    for (const l of [sub(SUBWAY_ANNEX[2]), off(OFFICE_ANNEX[2])]) {
      const e = l.extensions!, g = l.grid;
      // the platform, track beds, tunnels and annexes are all on the main level grid (rescue ladders = its nav links)
      const finder = new PathFinder(g);
      const start = l.office?.start ?? l.playerSpawn;
      for (const n of e.annexes) {
        // the annex cell farthest (straight line) from its door
        let far = -1, best = -1;
        for (const id of n.areas) { const a = l.areas[id]; for (let y = a.y; y < a.y + a.h; y++) for (let x = a.x; x < a.x + a.w; x++) { const [cx, cz] = g.center(x, y), d = Math.hypot(cx - n.exit.x, cz - n.exit.z); if (d > best) { best = d; far = g.idx(x, y); } } }
        const [fx, fz] = g.center(far % g.w, Math.floor(far / g.w));
        // in: from the platform with drops (the platform edge into the bed) and ladders
        const into = finder.find(start.x, start.z, fx, fz, 0.3, 400000, {drops: true});
        expect(into, `${l.seed} annex ${n.id}: platform -> annex`).not.toBeNull();
        // out: from the annex back to a rescue ladder foot of the tunnel's own bed WITHOUT drops, then up its link
        const tr = e.tunnels[n.tunnel].trench;
        const lad = l.traversal.ladders.filter(q => q.trench === tr && q.kind !== 'roof');
        expect(lad.length).toBeGreaterThan(0);
        const back = finder.find(fx, fz, lad[0].bottom.x, lad[0].bottom.z, 0.3, 400000, {drops: false, noLinks: true});
        expect(back, `${l.seed} annex ${n.id}: annex -> ladder`).not.toBeNull();
        // and the whole walk out reaches the platform (ladder link)
        expect(finder.find(fx, fz, start.x, start.z, 0.3, 400000, {drops: false}), `${l.seed} annex ${n.id}: annex -> platform`).not.toBeNull();
      }
      // every tunnel's last cell back to the platform without drops
      for (const t of e.tunnels) {
        const p = t.path[Math.max(0, t.path.length - 3)];
        expect(finder.find(p.x, p.z, start.x, start.z, 0.3, 400000, {drops: false}), `${l.seed} tunnel ${t.id}: end -> platform`).not.toBeNull();
      }
    }
  });

  it('clues only on tunnels that lead to an annex door, all before it and pointing toward it', () => {
    let clued = 0, annexTunnels = 0;
    for (const l of [...SUBWAY_SEEDS.map(sub), ...OFFICE_SEEDS.map(off)]) {
      for (const t of l.extensions!.tunnels) {
        if (!t.doors.length) { expect(t.clues, `${l.seed} tunnel ${t.id}`).toEqual([]); continue; }
        annexTunnels++;
        if (t.clues.length) clued++;
        const door = Math.min(...t.doors.map(d => d.s));
        for (const c of t.clues) {
          expect(c.toward).toBe(1);
          expect(c.s).toBeGreaterThanOrEqual(0);
          expect(c.s).toBeLessThan(door);
          expect(c.s).toBeLessThanOrEqual(t.firstStraight);
        }
        for (const d of t.doors) {
          expect(d.s).toBeGreaterThanOrEqual(TRACK_EXT.annex.doorMinS - 1e-6);
          expect(d.s).toBeLessThanOrEqual(t.length - TRACK_EXT.annex.doorEndClear + 1e-6);
          expect(d.s).toBeLessThanOrEqual(t.firstStraight);
        }
      }
    }
    report(`clues: ${clued}/${annexTunnels} tunnels with an annex door carry graffiti (chance ${TRACK_EXT.clues.chance})`);
    expect(annexTunnels).toBeGreaterThan(0);
  });

  it('extension cells: tunnel floors at the bed floor, flush mouths, solid caps, annex ceilings 2.4-2.8 m, >= 2.2 m clearance', () => {
    for (const l of [sub(SUBWAY_ANNEX[2]), off(OFFICE_ANNEX[2])]) {
      const g = l.grid, e = l.extensions!;
      for (const t of e.tunnels) {
        const tr = l.trenches[t.trench], a = l.areas[t.areas[0]];
        expect(a.floorY).toBe(tr.floorY);
        // mouth: the first column past the face holds every bed row, at the bed's floor (no step)
        const fx = Math.round((t.from === 'x1' ? tr.x1 : tr.x0) / CELL) + (t.from === 'x1' ? 0 : -1);
        for (let y = Math.round(tr.z0 / CELL); y < Math.round(tr.z1 / CELL); y++) {
          const i = g.idx(fx, y);
          expect(g.cells[i]).toBe(FLOOR);
          expect(g.area[i]).toBe(a.id);
          expect(Math.abs(g.floorOf(i) - g.floorOf(g.idx(fx + (t.from === 'x1' ? -1 : 1), y)))).toBeLessThan(1e-6);
        }
      }
      for (let i = 0; i < g.cells.length; i++) {
        const a = l.areas[g.area[i]];
        if (!a || !isExtensionArea(a)) continue;
        expect(g.ceil[i] - g.floor[i]).toBeGreaterThanOrEqual(2.2 - 1e-6);
      }
    }
  });
});
