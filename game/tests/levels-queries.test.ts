// Iteration 08 (Lane B): y-aware world queries on stacked levels (gen/levels.ts) — support / bands /
// ceilings on overlapping storeys, band collision (slab edges, soffits, railings), the 3D raycast and
// line of sight (slab between storeys vs an open aperture), railings, (level, cell) nav — on the
// hand-made fixture (tests/helpers/levelFixture.ts), plus single-level regression against the
// iteration-05..07 implementations on generated stations (main grid as one level).

import {describe, expect, it} from 'vitest';
import {CELL, FLOOR, Grid, PathFinder, SOLID, VOID, STEP_UP, type Waypoint} from '../src/gen/grid';
import {Levels, RAIL_DROP, asLevels, levelsOf, singleLevel} from '../src/gen/levels';
import {cellBlocks, moveCircle} from '../src/core/physics';
import {raycastWorld, raycastWorldLegacy} from '../src/combat/hitscan';
import {ARCHETYPES, generateStation} from '../src/gen/station';
import {FIX, levelFixture} from './helpers/levelFixture';

const fx = levelFixture();
const L = levelsOf(fx);

function mulberry(a: number): () => number {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

describe('Levels: support, bands and ceilings on overlapping storeys', () => {
  it('under the deck / on the deck / mid-air: each height resolves to its own storey (no snapping through the slab)', () => {
    const x = 22, z = 6; // platform A under the deck
    expect(L.bands(x, z).map(b => [b.level, b.floor, +b.ceil.toFixed(2)])).toEqual([[0, 0, 4.4], [1, FIX.upperY, FIX.upperCeil]]);
    expect(L.supportAt(x, z, 0)?.level).toBe(0);
    expect(L.supportAt(x, z, FIX.upperY)?.level).toBe(1);
    expect(L.supportAt(x, z, 3.0)?.floor).toBe(0); // jumping / thrown under the slab: still the platform
    expect(L.supportAt(x, z, FIX.upperY + 0.3)?.floor).toBe(FIX.upperY); // just above the deck
    expect(L.supportIn(x, z, 4.55, 0.1)).toBeNull(); // inside the 0.35 m slab: strict support refuses (callers keep their height)
    expect(L.supportIn(x, z, 4.55)?.level).toBe(1); // ... but a body within STEP_UP below the deck surface steps onto it
    expect(L.levelAt(x, z, 0)).toBe(0);
    expect(L.areaAt(x, z, FIX.upperY)).toBe(2);
    expect(L.ceilAt(x, z, 0)).toBeCloseTo(FIX.underDeckCeil, 5);
    expect(L.ceilAt(x, z, FIX.upperY)).toBeCloseTo(FIX.upperCeil, 5);
    // the lower crossing under platform A (and the platform above it)
    expect(L.supportAt(6.5, 6, FIX.lowerY)?.level).toBe(2);
    expect(L.supportAt(6.5, 6, 0)?.level).toBe(0);
    expect(L.ceilAt(6.5, 6, FIX.lowerY)).toBeCloseTo(FIX.lowerCeil, 5);
    // the aperture: the deck has a hole; from deck height the support is the track bed below
    expect(L.supportAt(23, 12, FIX.upperY)?.floor).toBeCloseTo(FIX.bedY, 5);
    expect(L.isFree(23, 6, 12)).toBe(true); // the light well
    expect(L.isFree(22, 4.6, 6)).toBe(false); // the slab
    expect(L.isFree(6.5, -1.3, 12)).toBe(false); // the slab under the track bed over the crossing
  });

  it('stairs between storeys: one band carved into both grids, both levels agree; the hand-over has no step', () => {
    for (const k of fx.levelLinks) {
      const f = fx.traversal.stairs[k.traversalId!];
      const s = (f.s0 + f.s1) / 2, a = (f.a0 + f.a1) / 2;
      const b = L.bands(s, a);
      expect(b.length).toBe(2);
      expect(new Set(b.map(q => q.level))).toEqual(new Set([k.lower, k.upper]));
      expect(b[0].floor).toBeCloseTo(b[1].floor, 9);
      expect(b[0].ceil).toBeCloseTo(b[1].ceil, 9);
      // walking the centre line from the bottom stand point to the top one: support never jumps (2 cm steps)
      let y = k.bottom.y;
      const n = Math.ceil(Math.abs(k.top.x - k.bottom.x) / 0.02), sx = Math.sign(k.top.x - k.bottom.x);
      for (let j = 0; j <= n; j++) {
        const x = k.bottom.x + sx * Math.min(j * 0.02, Math.abs(k.top.x - k.bottom.x));
        const s2 = L.supportIn(x, k.bottom.z, y, STEP_UP);
        expect(s2, `support at ${x.toFixed(2)}`).not.toBeNull();
        expect(Math.abs(s2!.floor - y)).toBeLessThan(0.02);
        y = s2!.floor;
      }
      expect(y).toBeCloseTo(k.top.y, 3);
      expect(L.levelAt(k.top.x, k.top.z, y)).toBe(L.supportAt(k.top.x, k.top.z, y)!.level);
    }
  });

  it('band collision: slab edges, risers and low soffits block; drops and stepping down do not; stance height matters', () => {
    // from the hall (feet 0) the deck slab is overhead, the platform continues under it: no wall
    expect(L.blocksAt(Math.floor(26.2 / CELL), Math.floor(6 / CELL), 26.3, 6, 0, 1.74)).toBe(false);
    // at deck height in the hall (e.g. falling past the deck edge at 4.2 m): the slab edge is a wall
    expect(L.blocksAt(Math.floor(25.9 / CELL), Math.floor(6 / CELL), 26.1, 6, 4.2, 1.74)).toBe(true);
    // lower crossing (feet -5): the platform column beside it is a wall (riser 5 m up)
    expect(L.blocksAt(Math.floor(4.9 / CELL), Math.floor(6 / CELL), 5.1, 6, FIX.lowerY, 1.74)).toBe(true);
    // a 1.4 m soffit: a standing body (1.74) is blocked, a crouched one (1.14) fits
    const g = new Grid(8, 8);
    for (let y = 1; y < 7; y++) for (let x = 1; x < 7; x++) { const i = g.idx(x, y); g.cells[i] = FLOOR; g.ceil[i] = x >= 4 ? 1.4 : 3; }
    const S = singleLevel(g);
    expect(S.blocksAt(4, 3, 1.9, 1.75, 0, 1.74)).toBe(true);
    expect(S.blocksAt(4, 3, 1.9, 1.75, 0, 1.14)).toBe(false);
    expect(S.ceilingOver(2.3, 1.75, 0.3, 0)).toBeCloseTo(1.4, 5);
    // legacy Grid path is unchanged: no ceiling test there
    expect(cellBlocks(g, 4, 3, 1.9, 1.75, 0)).toBe(false);
    // moveCircle through Levels stops a standing body at the soffit
    const [x1] = moveCircle(S, null, 1.5, 1.75, 1.2, 0, 0.3, 0, 1.74);
    expect(x1).toBeLessThanOrEqual(2.0 - 0.3 + 1e-6);
    const [x2] = moveCircle(S, null, 1.5, 1.75, 1.2, 0, 0.3, 0, 1.14);
    expect(x2).toBeGreaterThan(2.5);
  });

  it('ceilingOver follows the band holding the feet: slab underside below the deck, deck ceiling on it', () => {
    expect(L.ceilingOver(22, 6, 0.3, 0)).toBeCloseTo(FIX.underDeckCeil, 5);
    expect(L.ceilingOver(22, 6, 0.3, FIX.upperY)).toBeCloseTo(FIX.upperCeil, 5);
    expect(L.ceilingOver(28, 6, 0.3, 0)).toBeCloseTo(FIX.mainCeil, 5);
    expect(L.ceilingOver(6.5, 12, 0.3, FIX.lowerY)).toBeCloseTo(FIX.lowerCeil, 5);
  });
});

describe('Levels: railings', () => {
  it('derived rails line the deck edges over the hall, the light well and the stairwells — never the platform edge', () => {
    const rails = L.rails;
    expect(rails.length).toBeGreaterThan(10);
    const on = (lv: number, test: (r: (typeof rails)[number]) => boolean) => rails.some(r => r.level === lv && test(r));
    // deck west edge x = 20 over the hall (between the U landings), facing +x (walkable side)
    expect(on(1, r => r.x0 === 20 && r.x1 === 20 && r.nx === 1 && Math.abs(r.y0 - FIX.upperY) < 1e-6 && Math.min(r.z0, r.z1) <= 6 && Math.max(r.z0, r.z1) >= 6.5)).toBe(true);
    // deck east edge x = 26
    expect(on(1, r => r.x0 === 26 && r.nx === -1)).toBe(true);
    // all four sides of the aperture (x 22..24, z 11..13)
    expect(on(1, r => r.x0 === 22 && r.x1 === 22 && r.nx === -1)).toBe(true);
    expect(on(1, r => r.x0 === 24 && r.x1 === 24 && r.nx === 1)).toBe(true);
    expect(on(1, r => r.z0 === 11 && r.z1 === 11 && r.nz === -1)).toBe(true);
    expect(on(1, r => r.z0 === 13 && r.z1 === 13 && r.nz === 1)).toBe(true);
    // no railing where the U stairs land on the deck (x = 20, z 2.5..4.5)
    expect(rails.some(r => r.level === 1 && r.x0 === 20 && r.x1 === 20 && Math.max(r.z0, r.z1) > 2.6 && Math.min(r.z0, r.z1) < 4.4)).toBe(false);
    // the platform edges into the track bed (1.15 m) stay open
    expect(rails.some(r => r.level === 0 && (r.z0 === 10 || r.z0 === 14) && r.z0 === r.z1)).toBe(false);
    expect(RAIL_DROP).toBeGreaterThan(1.15);
  });

  it('a generator list is authoritative: with layout.rails = [] every edge is an open drop (unrailedDrops reports them)', () => {
    const open = levelFixture({rails: 'none'});
    const O = levelsOf(open);
    expect(O.rails.length).toBe(0);
    expect(O.unrailedDrops().length).toBeGreaterThan(5);
    expect(L.unrailedDrops().length).toBe(0); // the derived list covers every drop
  });

  it('railings block straight walks at their deck height only', () => {
    // across the deck edge toward the hall at deck height: blocked; the same line on the platform below: clear
    expect(L.walkLineClear(21.5, FIX.upperY, 6.5, 18.5, 6.5, 0.3)).toBe(false);
    expect(L.walkLineClear(28, 0, 6.5, 22, 6.5, 0.3)).toBe(true);
    expect(L.railCrosses(21.5, 6.5, 19.5, 6.5, 0.1, FIX.upperY)).toBe(true);
    expect(L.railCrosses(21.5, 6.5, 19.5, 6.5, 0.1, 0)).toBe(false);
  });
});

describe('Levels.raycast / lineOfSight', () => {
  const ray = (o: {x: number; y: number; z: number}, to: {x: number; y: number; z: number}, max = 60) => {
    const d = {x: to.x - o.x, y: to.y - o.y, z: to.z - o.z}, l = Math.hypot(d.x, d.y, d.z);
    return L.raycast(o, {x: d.x / l, y: d.y / l, z: d.z / l}, max, {props: fx.props, trenchY: FIX.bedY});
  };
  it('a slab between shooter and target blocks: deck floor from above, slab underside from below (right normals)', () => {
    const down = ray({x: 22.6, y: FIX.upperY + 1.62, z: 7}, {x: 22.6, y: 1, z: 7.4});
    expect(down.kind).toBe('floor');
    expect(down.level).toBe(1);
    expect(down.ny).toBe(1);
    expect(FIX.upperY + 1.62 + (1 - FIX.upperY - 1.62) / Math.hypot(0.4, 1 - FIX.upperY - 1.62) * down.t).toBeCloseTo(FIX.upperY, 3);
    const up = L.raycast({x: 22.6, y: 1.62, z: 7}, {x: 0, y: 1, z: 0}, 30);
    expect(up.kind).toBe('ceiling');
    expect(up.level).toBe(0);
    expect(up.ny).toBe(-1);
    expect(1.62 + up.t).toBeCloseTo(FIX.underDeckCeil, 5);
    expect(L.lineOfSight({x: 22.6, y: FIX.upperY + 1.5, z: 7}, {x: 22.6, y: 1.5, z: 7.4})).toBe(false);
  });

  it('an open aperture / stairwell does not block: through the light well into the bed; down an open stairwell', () => {
    const o = {x: 21.9, y: FIX.upperY + 1.62, z: 12}; // on the deck at the railing west of the well
    const h = ray(o, {x: 23.5, y: FIX.bedY, z: 12});
    expect(h.kind).toBe('floor');
    expect(h.level).toBe(0);
    expect(o.y + (FIX.bedY - o.y) / Math.hypot(23.5 - 21.9, FIX.bedY - o.y) * h.t).toBeCloseTo(FIX.bedY, 3);
    expect(L.lineOfSight(o, {x: 23, y: FIX.bedY + 1.5, z: 12.2})).toBe(true);
    // from platform B down into the D1 stairwell (open to the hall): sees a body on the flight
    expect(L.lineOfSight({x: 13, y: 1.62, z: 18.9}, {x: 12, y: -2.3, z: 20.2})).toBe(true);
    // the lower crossing is hidden from the platform above by its slab
    expect(L.lineOfSight({x: 6.5, y: 1.62, z: 6}, {x: 6.5, y: FIX.lowerY + 1.5, z: 9})).toBe(false);
  });

  it('walls / slab edges / props: the deck edge face at slab height, platform A <-> B under the deck, props on another storey', () => {
    // from the hall at slab height toward the deck edge: hits the slab edge face (+x normal)
    const e = L.raycast({x: 28, y: 4.55, z: 6}, {x: -1, y: 0, z: 0}, 30);
    expect(e.kind).toBe('wall');
    expect(e.nx).toBe(1);
    expect(28 - e.t).toBeCloseTo(26, 5);
    // across the track bed under the deck (platform A -> platform B)
    expect(L.lineOfSight({x: 25, y: 1.6, z: 8}, {x: 25, y: 1.6, z: 16})).toBe(true);
    // the deck's crate does not catch a shot on the platform below (the slab is in between)
    const p = ray({x: 20.5, y: 0.3, z: 3.4}, {x: 25, y: 0.3, z: 3.4});
    expect(p.kind).toBe('prop');
    expect(fx.props[p.prop!].kind).toBe('bench'); // the bench under the deck, not the crate on it
    const q = ray({x: 20.5, y: FIX.upperY + 0.2, z: 3.45}, {x: 25, y: FIX.upperY + 0.2, z: 3.45});
    expect(q.kind).toBe('prop');
    expect(fx.props[q.prop!].kind).toBe('crate');
    expect(q.kind === 'prop' ? fx.props[q.prop!].kind : q.kind).not.toBe('bench');
  });

  it('a long prop is solid at its ends too: a short ray beside its far end hits it (the cheap reject reaches as far as the prop does)', () => {
    // a 5.6 m machine along z, in the open air over the track bed; a 0.5 m ray into its side 2.5 m from its middle. Rejecting by
    // "centre further than the ray's reach + 2 m" skipped it there: bullets and bodies passed through the ends of long props.
    const machine = {...fx.props[0], x: 24.3, z: 12, y: 1.2, hx: 0.4, hz: 2.8, h: 0.8, round: undefined};
    const o = {x: 25, y: 1.6, z: 14.5}, d = {x: -1, y: 0, z: 0};
    expect(L.raycast(o, d, 0.5).kind).toBe('none'); // (nothing else is there)
    for (const z of [9.5, 12, 14.5]) {
      const h = L.raycast({...o, z}, d, 0.5, {props: [machine], trenchY: FIX.bedY});
      expect(h.kind, `at z ${z}`).toBe('prop');
      expect(h.t).toBeCloseTo(0.3, 6);
      expect(h.nx).toBe(1);
      expect(raycastWorld(L, [machine], {...o, z}, d, 0.5, FIX.bedY).kind).toBe('prop');
    }
    // beyond its end it is not there
    expect(L.raycast({...o, z: 15}, d, 0.5, {props: [machine], trenchY: FIX.bedY}).kind).toBe('none');
  });

  it('raycastWorld routes through Levels (level + cell on the hit)', () => {
    const h = raycastWorld(L, fx.props, {x: 22.6, y: 1.62, z: 7}, {x: 0, y: 1, z: 0}, 30, FIX.bedY);
    expect(h.kind).toBe('ceiling');
    expect(h.level).toBe(0);
    expect(h.cell).toBe(L.cellIndex(22.6, 7));
  });
});

describe('single-level regression (main grid as one level == iteration 05..07 code)', () => {
  const layouts = ARCHETYPES.map((a, i) => generateStation(9001 + i * 7919, {archetype: a}));
  it('raycastWorld matches the legacy hitscan on random rays in every archetype', () => {
    let n = 0, same = 0;
    const bad: string[] = [];
    for (const l of layouts) {
      const g = l.grid, R = mulberry(l.seed);
      const open: number[] = [];
      for (let i = 0; i < g.cells.length; i++) if (g.cells[i] !== SOLID) open.push(i);
      for (let k = 0; k < 1500; k++) {
        const i = open[Math.floor(R() * open.length)];
        const cx = i % g.w, cy = Math.floor(i / g.w);
        const ox = (cx + R()) * CELL, oz = (cy + R()) * CELL;
        const o = {x: ox, y: g.floorAt(ox, oz) + 0.2 + R() * 2.2, z: oz};
        const a = R() * Math.PI * 2, el = (R() - 0.5) * 1.6;
        const d = {x: Math.cos(el) * Math.sin(a), y: Math.sin(el), z: Math.cos(el) * Math.cos(a)};
        const A = raycastWorldLegacy(g, l.props, o, d, 60, l.trench.floorY);
        const B = raycastWorld(g, l.props, o, d, 60, l.trench.floorY);
        n++;
        const ok = A.kind === B.kind && Math.abs(A.t - B.t) < 1e-6 && (A.kind !== 'prop' || A.prop === B.prop) && (A.kind !== 'floor' && A.kind !== 'ceiling' || A.ny === B.ny);
        if (ok) same++;
        else if (bad.length < 6) bad.push(`${l.archetype} ${A.kind}@${A.t.toFixed(3)} vs ${B.kind}@${B.t.toFixed(3)}`);
      }
    }
    console.info(`[levels] raycast regression: ${same}/${n} identical${bad.length ? ' — ' + bad.join('; ') : ''}`);
    expect(same / n).toBeGreaterThan(0.995);
  });

  it('band collision on one level matches the legacy height-aware collision on random walks (no ceiling-limited cells)', () => {
    let n = 0, same = 0;
    for (const l of layouts.slice(0, 3)) {
      const g = l.grid, S = singleLevel(g), R = mulberry(l.seed + 1);
      for (let k = 0; k < 400; k++) {
        const cx = Math.floor(R() * g.w), cy = Math.floor(R() * g.h);
        if (!g.passable(cx, cy)) continue;
        const x = (cx + 0.5) * CELL, z = (cy + 0.5) * CELL, feet = g.floorAt(x, z);
        const dx = (R() - 0.5) * 1.6, dz = (R() - 0.5) * 1.6;
        const A = moveCircle(g, null, x, z, dx, dz, 0.3, feet), B = moveCircle(S, null, x, z, dx, dz, 0.3, feet, 1.6);
        n++;
        if (Math.hypot(A[0] - B[0], A[1] - B[1]) < 1e-9) same++;
      }
    }
    console.info(`[levels] collision regression: ${same}/${n} identical`);
    expect(same / n).toBeGreaterThan(0.995);
  });

  it('asLevels / levelsOf wrap a plain grid once (cached) and keep its answers', () => {
    const l = layouts[0];
    const A = asLevels(l.grid), B = asLevels(l.grid);
    expect(A).toBe(B);
    expect(A.count).toBe(1);
    expect(levelsOf(l).main).toBe(l.grid); // the layout's levels[0] is its main grid
    expect(levelsOf(l)).toBe(levelsOf(l));
    const P = l.areas[l.platform];
    const x = (P.x + P.w / 2) * CELL, z = (P.y + P.h / 2) * CELL;
    expect(A.floorAt(x, z, 0)).toBe(l.grid.floorAt(x, z));
    expect(A.areaAt(x, z, 0)).toBe(l.grid.areaAt(x, z));
  });
});

describe('PathFinder over (level, cell) nodes', () => {
  const pf = new PathFinder(L);
  const check = (path: Waypoint[] | null, from: {x: number; y: number; z: number}) => {
    expect(path).not.toBeNull();
    // every straight leg is walkable from the previous point at its height (no leg through a slab)
    let px = from.x, py = from.y, pz = from.z;
    for (const w of path!) {
      expect(w[3], 'waypoints carry their floor height').toBeTypeOf('number');
      expect(L.walkLineClear(px, py, pz, w[0], w[1], 0.2, w[3]), `leg ${px.toFixed(2)},${py.toFixed(2)},${pz.toFixed(2)} -> ${w.map(v => v?.toFixed(2)).join(',')}`).toBe(true);
      px = w[0]; pz = w[1]; py = w[3]!;
    }
    return path!;
  };
  it('platform A -> deck uses the stairs; deck -> lower crossing goes down two runs; timing', () => {
    const t0 = performance.now();
    const a = check(pf.find(4, 8.5, 23, 18, 0.34, 26000, {ay: 0, by: FIX.upperY}), {x: 4, y: 0, z: 8.5});
    const t1 = performance.now();
    expect(a[a.length - 1][3]).toBeCloseTo(FIX.upperY, 3);
    // the route climbs a U flight (string pulling may make the whole flight one straight leg)
    const inRect = (x: number, z: number, r: {x: number; y: number; w: number; h: number}) => x >= r.x * CELL && x <= (r.x + r.w) * CELL && z >= r.y * CELL && z <= (r.y + r.h) * CELL;
    let onFlight = false, qx = 4, qz = 8.5;
    for (const w of a) { for (let s = 0; s <= 1; s += 0.05) { const x = qx + (w[0] - qx) * s, z = qz + (w[1] - qz) * s; if (inRect(x, z, FIX.U1) || inRect(x, z, FIX.U2)) onFlight = true; } qx = w[0]; qz = w[1]; }
    expect(onFlight).toBe(true);
    const b = check(pf.find(23, 18, 6.5, 12, 0.34, 26000, {ay: FIX.upperY, by: FIX.lowerY}), {x: 23, y: FIX.upperY, z: 18});
    const t2 = performance.now();
    expect(b[b.length - 1][3]).toBeCloseTo(FIX.lowerY, 3);
    // goal directly under the start (platform below the deck): must walk round by the stairs
    const c = check(pf.find(23, 6, 23, 6.5, 0.34, 26000, {ay: FIX.upperY, by: 0}), {x: 23, y: FIX.upperY, z: 6});
    expect(c.length).toBeGreaterThan(2);
    const t3 = performance.now();
    console.info(`[levels] fixture paths: deck ${(t1 - t0).toFixed(2)} ms (${a.length} wp), lower ${(t2 - t1).toFixed(2)} ms (${b.length} wp), under ${(t3 - t2).toFixed(2)} ms; expanded ${pf.lastExpanded}`);
    expect(t3 - t0).toBeLessThan(150);
  });

  it('every walkable cell of every level is reachable from platform A (stairs both ways, connected loop)', () => {
    const d = L.reachable(0, 8, 16);
    let open = 0, reached = 0;
    for (let k = 0; k < L.count; k++) {
      const g = L.grid(k);
      for (let i = 0; i < g.cells.length; i++) {
        if ((g.cells[i] !== FLOOR && g.cells[i] !== VOID) || g.blocked[i]) continue;
        open++;
        if (d[k * g.cells.length + i] >= 0) reached++;
      }
    }
    // the track bed is reachable only by drops in this fixture (no ladders): count it with drops
    const dd = L.reachable(0, 8, 16, {drops: true});
    let reachedD = 0;
    for (let k = 0; k < L.count; k++) { const g = L.grid(k); for (let i = 0; i < g.cells.length; i++) if ((g.cells[i] === FLOOR || g.cells[i] === VOID) && !g.blocked[i] && dd[k * g.cells.length + i] >= 0) reachedD++; }
    expect(reachedD).toBe(open);
    expect(reached).toBeGreaterThan(open * 0.8);
    // a loop: deck and lower crossing both reachable without the track bed
    expect(d[L.node(1, L.cellIndex(23, 18))]).toBeGreaterThan(0);
    expect(d[L.node(2, L.cellIndex(6.5, 12))]).toBeGreaterThan(0);
    void Levels;
  });
});
