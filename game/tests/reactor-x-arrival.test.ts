// Task reactor-playtest-round2-20261102 (lane ARRIVAL): THE ARRIVAL APPROACH and the Reactor-wide seeded flow on REAL generated layouts.
// User (play test 2): "the reactor pit is to close to the subway stop. You should have to traverse through a small station area, before
// going through a hole in a wall, through a small tunnel, then you hit the reactor area!" and "the layout of reactor / reactor side
// areas is much to normal right now … logical rooms flowing in to one another … exploring a coherent space for the first time every
// time". gen/reactor/arrival.ts (platform -> station area -> breach -> tunnel -> rim reveal), gen/reactor/suites.ts (the seeded rock
// suites), complex/host.ts (seeded entrance placement). Pure (no renderer / DOM).
import {describe, expect, it} from 'vitest';
import {generateReactorLevel, reactorIssues} from '../src/gen/reactor/index';
import {ARRIVAL, ARRIVAL_RECIPES} from '../src/gen/reactor/arrival';
import {ARRIVAL_SEP} from '../src/gen/reactor/frame';
import {CELL, FLOOR, SOLID, VOID, type Grid} from '../src/gen/grid';
import {playerTrainPlacement} from '../src/gen/playerTrain';
import {arrivalPose} from '../src/levels/registry';
import type {Rect, StationLayout} from '../src/gen/stationTypes';
import type {ReactorRect} from '../src/gen/reactor/reactorTypes';

/** 16 seeds: both stair walls, single / twin towers, the lead's QA seeds and the reactor-level / paths-audit corpora. */
const SEEDS = [9100, 218558, 637474, 1, 2, 3, 4, 5, 6, 7, 8, 21, 22, 23, 42, 777];
const cache = new Map<number, StationLayout>();
const gen = (seed: number) => {
  let L = cache.get(seed);
  if (!L) { L = generateReactorLevel({levelSeed: seed}); cache.set(seed, L); }
  return L;
};
const cells = (r: ReactorRect): Rect => ({x: Math.round(r.x0 / CELL), y: Math.round(r.z0 / CELL), w: Math.round((r.x1 - r.x0) / CELL), h: Math.round((r.z1 - r.z0) / CELL)});

/** BFS on the rim storey over walkable flat cells from the start: predecessor per cell (-1 start, -2 unseen). */
function walk(L: StationLayout, blocked?: Rect): Int32Array {
  const g = L.levels[0].grid, prev = new Int32Array(g.w * g.h).fill(-2);
  const st = L.reactor!.start, [sx, sy] = g.cellOf(st.x, st.z), s = g.idx(sx, sy);
  const shut = (x: number, y: number) => !!blocked && x >= blocked.x && y >= blocked.y && x < blocked.x + blocked.w && y < blocked.y + blocked.h;
  prev[s] = -1;
  const q = [s];
  for (let h = 0; h < q.length; h++) {
    const i = q[h], x = i % g.w, y = (i / g.w) | 0;
    for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + ox, ny = y + oy;
      if (!g.inBounds(nx, ny) || shut(nx, ny)) continue;
      const j = g.idx(nx, ny);
      if (prev[j] !== -2 || g.cells[j] !== FLOOR || g.blocked[j] || g.rampIdx[j] >= 0) continue;
      prev[j] = i; q.push(j);
    }
  }
  return prev;
}

/** Conservative see-through at the rim's eye band: open on the rim storey, or any storey's open band reaching above -0.5 m. */
function seeThrough(L: StationLayout): (x: number, y: number) => boolean {
  const g0 = L.levels[0].grid;
  return (x, y) => {
    if (!g0.inBounds(x, y)) return false;
    const i = g0.idx(x, y);
    if (g0.cells[i] === FLOOR || g0.cells[i] === VOID) return true;
    for (const lv of L.levels) if (lv.id && lv.grid.cells[i] !== SOLID && lv.grid.ceil[i] > -0.5) return true;
    return false;
  };
}

/** Any straight sight line (quarter-cell sampling) from a cell centre of `from` to a target point through see-through cells. */
function sees(open: (x: number, y: number) => boolean, from: Rect, targets: readonly [number, number][]): string | null {
  for (let y = from.y; y < from.y + from.h; y++) for (let x = from.x; x < from.x + from.w; x++) {
    const sx = x + 0.5, sy = y + 0.5;
    for (const [tx, ty] of targets) {
      const n = Math.ceil(Math.hypot(tx - sx, ty - sy) * 4);
      let ok = true;
      for (let k = 1; k < n && ok; k++) ok = open(Math.floor(sx + (tx - sx) * k / n), Math.floor(sy + (ty - sy) * k / n));
      if (ok) return `${x},${y} -> ${tx.toFixed(2)},${ty.toFixed(2)}`;
    }
  }
  return null;
}

describe('the Reactor arrival: platform -> small station area -> breach -> short tunnel -> the rim reveal (lane ARRIVAL)', () => {
  for (const seed of SEEDS) {
    it(`seed ${seed}: one physical, walkable route; the tunnel is the only way to the pit; no sight of the pit from the platform`, () => {
      const L = gen(seed), R = L.reactor!, ap = R.approach!, g = L.levels[0].grid, P = L.areas[L.platform];
      expect(reactorIssues(L), `seed ${seed}`).toEqual([]);
      expect(ARRIVAL_RECIPES).toContain(ap.recipe);
      // separated: the pit's north edge lies >= 14 m south of the platform's south edge (the band of rock + the station area)
      const gap = R.pit.bounds.z0 - (P.y + P.h) * CELL;
      expect(gap).toBeGreaterThanOrEqual((ARRIVAL_SEP[0] + 1) * CELL - 1e-6);
      expect(gap).toBeLessThanOrEqual((ARRIVAL_SEP[1] + 1) * CELL + 1e-6);
      // the platform opens only into the ticket hall (1-2 openings), never onto a pit deck
      const pd = L.doors.filter(d => d.a === P.id || d.b === P.id);
      expect(pd.length).toBeGreaterThanOrEqual(1);
      expect(pd.length).toBeLessThanOrEqual(2);
      for (const d of pd) expect(d.a === P.id ? d.b : d.a).toBe(ap.hall);
      expect(ap.doors.length).toBe(pd.length);
      // a SMALL station area: the hall + 0-3 rooms (+ a service corridor), 60-320 m² of floor, all on the rim storey
      let m2 = 0;
      for (const id of ap.station) { const a = L.areas[id]; expect(a.level ?? 0).toBe(0); m2 += a.w * a.h * CELL * CELL; }
      expect(m2).toBeGreaterThanOrEqual(60);
      expect(m2).toBeLessThanOrEqual(320);
      expect(L.areas[ap.hall].label).toBe('Ticket hall');
      // the walk: start -> hall -> (breached room) -> the tunnel segments -> the reveal -> the rim gallery, in that order
      const prev = walk(L);
      let goal = -1;
      const rv = cells(ap.reveal);
      for (let y = rv.y + rv.h; y < rv.y + rv.h + 2 && goal < 0; y++) for (let x = rv.x; x < rv.x + rv.w; x++) if (prev[g.idx(x, y)] !== -2 && g.area[g.idx(x, y)] === ap.revealDeck) { goal = g.idx(x, y); break; }
      expect(goal, `seed ${seed}: the rim gallery beyond the reveal is reached on foot`).toBeGreaterThanOrEqual(0);
      const seq: number[] = [];
      for (let i = goal; i >= 0; i = prev[i]) { const a = g.area[i]; if (seq[seq.length - 1] !== a) seq.push(a); }
      seq.reverse();
      expect(seq[0]).toBe(P.id);
      expect(seq[1]).toBe(ap.hall);
      expect(seq[seq.length - 1]).toBe(ap.revealDeck);
      const station = new Set(ap.station), tunnel = new Set(ap.tunnel);
      const iT = seq.findIndex(a => tunnel.has(a));
      expect(iT).toBeGreaterThan(1);
      for (const a of seq.slice(1, iT)) expect(station.has(a), `seed ${seed}: ${L.areas[a]?.label} before the breach`).toBe(true);
      expect(seq[iT - 1]).toBe(ap.breachFrom);
      for (const a of seq.slice(iT, -1)) expect(tunnel.has(a), `seed ${seed}: ${L.areas[a]?.label} in the tunnel`).toBe(true);
      // the breach is a hole (no door record, no frame) and the ONE way in: closed, no pit deck of the rim is reachable
      const br = cells(ap.breach);
      expect(L.doors.some(d => (d.level ?? 0) === 0 && d.x < br.x + br.w && br.x < d.x + d.w && d.y < br.y + br.h && br.y < d.y + d.h)).toBe(false);
      const cut = walk(L, br);
      const pitDeck = (id: number) => { const r = L.areas[id]?.role; return !!r && r.startsWith('reactor-') && r !== 'reactor-room'; };
      for (let i = 0; i < cut.length; i++) if (cut[i] !== -2) expect(pitDeck(g.area[i]), `seed ${seed}: pit deck reached around the breach`).toBe(false);
      // the tunnel: 10-30 m along its centreline, at least one real bend (>= 60 degrees), 2-3 m wide segments sharing >= 1.5 m seams
      expect(ap.length).toBeGreaterThanOrEqual(ARRIVAL.lengthM[0]);
      expect(ap.length).toBeLessThanOrEqual(ARRIVAL.lengthM[1]);
      let bend = 0;
      for (let i = 1; i + 1 < ap.path.length; i++) {
        const a = ap.path[i - 1], b = ap.path[i], c = ap.path[i + 1];
        const u = Math.atan2(b.z - a.z, b.x - a.x), v = Math.atan2(c.z - b.z, c.x - b.x);
        bend = Math.max(bend, Math.abs(Math.atan2(Math.sin(v - u), Math.cos(v - u))));
      }
      expect(bend).toBeGreaterThan(Math.PI / 3);
      const segs = ap.tunnel.map(id => L.areas[id]);
      for (const s of segs) {
        expect(Math.min(s.w, s.h)).toBeGreaterThanOrEqual(ARRIVAL.bore[0]);
        expect(s.label).toBe('Breach tunnel');
      }
      for (let i = 1; i < segs.length; i++) {
        const a = segs[i - 1], b = segs[i];
        const sx = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), sy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        expect(Math.max(sx, sy), `seed ${seed}: seam ${i}`).toBeGreaterThanOrEqual(3);
        expect(Math.min(sx, sy), `seed ${seed}: seam ${i} touches`).toBeGreaterThanOrEqual(0);
      }
      // support + collision: every tunnel cell flat floor at the rim, >= 2.8 m clear, never blocked (no invisible barrier, no prop)
      for (const s of segs) for (let y = s.y; y < s.y + s.h; y++) for (let x = s.x; x < s.x + s.w; x++) {
        const i = g.idx(x, y);
        if (g.area[i] !== s.id) continue;
        expect(g.cells[i]).toBe(FLOOR);
        expect(g.floorOf(i)).toBe(0);
        expect(g.ceil[i]).toBeGreaterThanOrEqual(2.8);
        expect(g.blocked[i], `seed ${seed}: blocked tunnel cell ${x},${y}`).toBe(0);
      }
      for (const p of L.props) if ((p.level ?? 0) === 0) { const [cx, cy] = g.cellOf(p.x, p.z); expect(tunnel.has(g.area[g.idx(cx, cy)]), `seed ${seed}: ${p.kind} in the tunnel`).toBe(false); }
      // no line of sight from ANY platform cell to the reveal or to the rim gallery's first row (every view into the pit crosses it)
      const open = seeThrough(L), targets: [number, number][] = [];
      for (let x = rv.x; x < rv.x + rv.w; x++) targets.push([x + 0.5, rv.y + 0.5]);
      const row0 = Math.round(R.pit.bounds.z0 / CELL), x0 = Math.round(R.pit.bounds.x0 / CELL), x1 = Math.round(R.pit.bounds.x1 / CELL);
      for (let x = x0; x < x1; x++) targets.push([x + 0.5, row0 + 0.5]);
      expect(sees(open, P, targets), `seed ${seed}: the platform sees the pit`).toBeNull();
      // wayfinding: "RIM ACCESS" over every platform opening
      expect(L.signs.filter(s => s.text === 'RIM ACCESS').length).toBe(pd.length);
    }, 60_000);
  }

  it('the shared train still parks at the rim platform and a start arrival spawns in the car; the start faces the ticket hall', () => {
    for (const seed of SEEDS.slice(0, 6)) {
      const L = gen(seed), R = L.reactor!, p = playerTrainPlacement(L);
      expect(p, `seed ${seed}`).not.toBeNull();
      expect(p!.platformArea).toBe(L.platform);
      expect(p!.x0).toBeGreaterThanOrEqual(R.arrival.stop0 - 1e-6);
      expect(p!.x1).toBeLessThanOrEqual(R.arrival.stop1 + 1e-6);
      expect(arrivalPose(L, {kind: 'start'}, p).source).toBe('train');
      // the platform start (no train) looks south toward an opening into the hall, within a few metres
      const d = R.approach!.doors.map(r => Math.hypot((r.x0 + r.x1) / 2 - R.start.x, r.z0 - R.start.z));
      expect(Math.min(...d)).toBeLessThan(4);
      expect(R.start.yaw).toBeCloseTo(Math.PI);
    }
  });

  it('the rim objective adapts: the rim office and its key are reached on foot from the reveal; a plate beside the reveal points at the office', () => {
    let plates = 0;
    for (const seed of SEEDS) {
      const L = gen(seed), R = L.reactor!, g = L.levels[0].grid, prev = walk(L);
      const key = R.components.find(c => c.item === 'reactor_key')!, kp = L.pickups[key.pickup];
      const [kx, ky] = g.cellOf(kp.x, kp.z);
      expect(prev[g.idx(kx, ky)], `seed ${seed}: key reached on foot`).not.toBe(-2);
      const office = R.sites.find(s => s.id === 'rimOffice')!;
      const sign = L.signs.find(s => s.text === 'RIM CONTROL OFFICE');
      if (sign) {
        plates++;
        const ox = (office.rect.x0 + office.rect.x1) / 2;
        if (Math.abs(ox - sign.x) > 6) expect(sign.arrow, `seed ${seed}`).toBe(ox > sign.x ? 'right' : 'left');
      }
    }
    expect(plates).toBeGreaterThanOrEqual(SEEDS.length - 2);
  });
});

describe('the Reactor-wide seeded flow (lane ARRIVAL): station recipes, rock suites, complex entrances', () => {
  /** A topology signature: the arrival recipe / shape, every storey's suites (wall, T / L, loop, rooms, links), the complex fronts. */
  const signature = (L: StationLayout): string => {
    const R = L.reactor!, ap = R.approach!;
    const arr = `${ap.recipe}:${ap.station.length}:${ap.tunnel.length}:${Math.round(ap.length)}`;
    const su = (R.suites ?? []).map(s => `${s.level}${s.wall}${s.shape}${s.loop ? 'o' : ''}${s.rooms.length}.${s.links.length}`).sort().join(',');
    const cx = (R.complexes ?? []).map(c => `${c.id}@${c.slot!.inward}:${L.areas[c.slot!.frontArea].role}`).join(',');
    return `${arr}|${su}|${cx}`;
  };

  it('differs on every one of >= 12 seeds, and every dimension of the grammar actually varies over the corpus', () => {
    const sigs = new Set(SEEDS.map(s => signature(gen(s))));
    expect(sigs.size).toBe(SEEDS.length);
    const all = SEEDS.map(s => gen(s).reactor!);
    expect(new Set(all.map(r => r.approach!.recipe)).size).toBeGreaterThanOrEqual(2);
    const suites = all.flatMap(r => r.suites ?? []);
    expect(new Set(suites.map(s => s.shape))).toEqual(new Set(['T', 'L']));
    expect(new Set(suites.map(s => s.wall)).size).toBe(4);
    expect(suites.some(s => s.loop)).toBe(true);
    expect(suites.some(s => s.links.length > s.rooms.length)).toBe(true); // an enfilade / back door beyond the room doors
    for (let lv = 1; lv <= 5; lv++) expect(new Set(all.map(r => (r.suites ?? []).filter(s => s.level === lv).length)).size, `storey ${lv} suite counts`).toBeGreaterThanOrEqual(2);
    // room counts per suite vary; every themed storey shows at least two themes over the corpus
    expect(new Set(suites.map(s => s.rooms.length)).size).toBeGreaterThanOrEqual(3);
    for (let lv = 1; lv <= 5; lv++) expect(new Set(suites.filter(s => s.level === lv).map(s => s.theme)).size, `storey ${lv} themes`).toBeGreaterThanOrEqual(2);
    // the complexes open off different deck kinds (landings / galleries / terraces), not always the stair landing's centre
    const fronts = new Set(SEEDS.flatMap(s => { const L = gen(s); return (L.reactor!.complexes ?? []).map(c => L.areas[c.slot!.frontArea].role); }));
    expect(fronts.size).toBeGreaterThanOrEqual(2);
  });

  it('coherent: every suite room opens onto its corridor, the entry onto a deck of its storey, rooms follow the storey theme, never in a complex region of the storey', () => {
    for (const seed of SEEDS.slice(0, 8)) {
      const L = gen(seed), R = L.reactor!;
      for (const s of R.suites ?? []) {
        const tag = `seed ${seed} L${s.level} ${s.theme}`;
        const [entry, cross] = s.corridors.map(id => L.areas[id]);
        expect(entry.level ?? 0, tag).toBe(s.level);
        // the deck door: entry <-> a pit deck of the same storey
        const deckDoor = L.doors.find(d => (d.a === entry.id || d.b === entry.id) && L.areas[d.a === entry.id ? d.b : d.a].role?.startsWith('reactor-') && L.areas[d.a === entry.id ? d.b : d.a].role !== 'reactor-room');
        expect(deckDoor, tag).toBeTruthy();
        for (const id of s.rooms) {
          const a = L.areas[id];
          expect(a.role, tag).toBe('reactor-room');
          expect(a.level ?? 0, tag).toBe(s.level);
          expect(L.doors.some(d => (d.a === cross.id && d.b === id) || (d.b === cross.id && d.a === id)), `${tag}: ${a.label} opens onto the corridor`).toBe(true);
          expect(a.purpose, tag).toBeTruthy();
        }
        if (s.loop) expect(s.deckDoors.length, tag).toBe(2);
        for (const c of R.complexes ?? []) if (c.level === s.level) {
          const reg = cells(c.slot!.region);
          for (const id of [...s.corridors, ...s.rooms]) {
            const a = L.areas[id];
            expect(a.x + a.w <= reg.x || reg.x + reg.w <= a.x || a.y + a.h <= reg.y || reg.y + reg.h <= a.y, `${tag} in ${c.id}`).toBe(true);
          }
        }
      }
    }
  });

  it('is deterministic from the level seed (the same world on every revisit) and differs between seeds', () => {
    for (const seed of [9100, 4]) {
      const a = generateReactorLevel({levelSeed: seed}), b = gen(seed);
      expect(JSON.stringify(a.reactor!.approach)).toBe(JSON.stringify(b.reactor!.approach));
      expect(JSON.stringify(a.reactor!.suites)).toBe(JSON.stringify(b.reactor!.suites));
      expect(JSON.stringify(a.areas)).toBe(JSON.stringify(b.areas));
      expect(JSON.stringify(a.doors)).toBe(JSON.stringify(b.doors));
      const ga = a.levels[0].grid as Grid, gb = b.levels[0].grid as Grid;
      expect(Buffer.from(ga.cells.buffer).equals(Buffer.from(gb.cells.buffer))).toBe(true);
    }
    expect(JSON.stringify(gen(1).reactor!.approach)).not.toBe(JSON.stringify(gen(2).reactor!.approach));
  });
});
