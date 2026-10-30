// Task office-interactions-layout-20261030 (lane LAYOUT): genuine floor-plan variation of the office floors (items 4 + 5).
// Before: every office floor 2..8 shared ONE skeleton (the full corridor ring, the same two end-zone rooms, the same core strip of two
// washrooms + three 2 x 3 m closets) and many large rooms stood nearly empty; floor 8's roof access closet kept its ELECTRICAL plate
// under the ROOF ACCESS one. Now each floor carves a seeded plan (gen/office/floorplan.ts): corridor topology (ring / one-sided loop /
// open work commons), core support rooms, end-zone splits — the core, stairwell, shaft and landing strip identical on every storey.
// Node only, a bounded seed set (no browser).
import {describe, expect, it} from 'vitest';
import {generateOfficeLevel, officeIssues, towerFrame, OFFICE_GEN_STATS} from '../src/gen/office/index';
import {ROOM_MIN_CELLS, STRIPS, floorPlans, planKey, type FloorPlan} from '../src/gen/office/floorplan';
import {MARGIN, OFFICE_TOP_FLOOR, landingRect} from '../src/gen/office/frame';
import {elevatorLandingStrip, floorPlanPose} from '../src/gen/office/index';
import {FILL_MIN_M2, furnishedShare, signOverlaps} from '../src/gen/office/dress';
import {doorSide} from '../src/gen/placeKit';
import {signDims} from '../src/gen/doorways';
import {CELL, SOLID} from '../src/gen/grid';
import type {Area, StationLayout} from '../src/gen/stationTypes';

const SEEDS = [11, 222, 3333, 7, 99, 512];
const cache = new Map<number, StationLayout>();
const times: number[] = [];
function gen(levelSeed: number): StationLayout {
  let l = cache.get(levelSeed);
  if (!l) { cache.set(levelSeed, (l = generateOfficeLevel({levelSeed, startWeapon: 'pistol'}))); times.push(OFFICE_GEN_STATS.ms); }
  return l;
}
const FLOORS = [2, 3, 4, 5, 6, 7, 8];
const topo = (p: FloorPlan) => (p.topology === 'loopW' || p.topology === 'loopE' ? 'loop' : p.topology);
/** A room of a tower storey (not a corridor / hall / stair landing or run). */
const isRoom = (a: Area) => (a.level ?? 0) >= 1 && (a.level ?? 0) <= OFFICE_TOP_FLOOR && a.kind !== 'passage' && a.type !== 'office-corridor'
  && a.type !== 'office-stair' && a.type !== 'office-lobby' && a.role !== 'stair';

/**
 * The structural WALL SKELETON of an office floor from its real geometry: the corridor rects, every area inside the core / end-zone
 * rows, and a full-width commons — the band segments (random widths on every floor already before) left out on purpose.
 */
function skeleton(l: StationLayout, seed: number, n: number): string {
  const f = towerFrame(seed);
  const inCore = (a: Area) => a.y >= f.cy0 + MARGIN && a.y + a.h <= f.cy1 + MARGIN;
  const commons = (a: Area) => a.type === 'office-open' && a.y === f.cy1 + 1 + MARGIN && a.w === f.TW;
  return l.areas.filter(a => a.level === n && a.role !== 'stair' && a.type !== 'office-stair' && (a.type === 'office-corridor' || inCore(a) || commons(a)))
    .map(a => `${a.type}:${a.x},${a.y},${a.w},${a.h}`).sort().join('|');
}
/** Corridor topology read from the geometry: number of corridor areas + whether a work commons replaces the S corridor. */
function corridorTopology(l: StationLayout, seed: number, n: number): string {
  const f = towerFrame(seed);
  const corr = l.areas.filter(a => a.level === n && a.type === 'office-corridor');
  const commons = l.areas.some(a => a.level === n && a.type === 'office-open' && a.y === f.cy1 + 1 + MARGIN && a.w === f.TW);
  const south = corr.some(a => a.y === f.cy1 + 1 + MARGIN && a.w === f.TW);
  const sides = corr.filter(a => a.y === f.cy0 - 1 + MARGIN).length;
  return `${south ? 'S' : ''}${commons ? 'C' : ''}${sides}`;
}
/** The support rooms of a floor: the core strip's rooms + the extra rooms of split end zones (purpose / label kinds). */
function supportSet(l: StationLayout, seed: number, n: number): string {
  const f = towerFrame(seed);
  return l.areas.filter(a => a.level === n && a.y >= f.cy0 + MARGIN && a.y + a.h <= f.cy1 + MARGIN && a.type !== 'office-stair' && a.type !== 'office-corridor')
    .map(a => a.purpose ?? a.type).sort().join(',');
}

describe('floor plans (pure data, 200 level seeds)', () => {
  it('deterministic; >= 3 topologies per level; consecutive floors differ; every strip fits the core with rooms >= 2.5 m; floor 8 has the roof room', () => {
    const keys = new Set<string>();
    for (let s = 0; s < 200; s++) {
      const seed = s * 7919 + 13, f = towerFrame(seed);
      expect(floorPlans(seed, {K: f.K, sB: f.sB, cx0: f.cx0, cx1: f.cx1, top: OFFICE_TOP_FLOOR})).toEqual(f.plans);
      const plans = FLOORS.map(n => f.plans[n]);
      expect(new Set(plans.map(topo)).size, `${seed} topologies`).toBeGreaterThanOrEqual(3);
      for (let i = 1; i < plans.length; i++) {
        expect(plans[i].topology === plans[i - 1].topology && plans[i].strip === plans[i - 1].strip, `${seed} floors ${i + 1}/${i + 2} identical`).toBe(false);
      }
      for (const p of plans) {
        keys.add(planKey(p));
        // contiguous units with 1-cell walls from cx0 to cx1, each >= ROOM_MIN_CELLS (and the washrooms >= 7)
        expect(p.units[0].x0).toBe(f.cx0);
        expect(p.units[p.units.length - 1].x1).toBe(f.cx1);
        for (let i = 1; i < p.units.length; i++) expect(p.units[i].x0).toBe(p.units[i - 1].x1 + 1);
        for (const u of p.units) expect(u.x1 - u.x0, `${seed} ${u.kind}`).toBeGreaterThanOrEqual(u.kind.startsWith('wc') ? 7 : ROOM_MIN_CELLS + 1);
        expect(p.units.filter(u => u.kind === 'wc-m').length).toBe(1);
        expect(p.units.filter(u => u.kind === 'wc-w').length).toBe(1);
        expect(p.units.filter(u => u.kind === 'roof').length).toBe(p.floor === OFFICE_TOP_FLOOR ? 1 : 0);
        if (p.topology === 'commons') { expect(p.commons).toBeGreaterThanOrEqual(10); expect(f.sB + f.K - p.commons).toBeGreaterThanOrEqual(8); } else expect(p.commons).toBe(0);
        if (p.topology === 'loopW') expect(p.ends.E).not.toBe('single');
        if (p.topology === 'loopE') expect(p.ends.W).not.toBe('single');
      }
      // every strip program fits the 32-cell core exactly
      for (const prog of Object.values(STRIPS)) expect(prog.reduce((a, [, w]) => a + w, 0) + prog.length - 1).toBe(f.cx1 - f.cx0);
    }
    process.stdout.write(`\n[office-floorplans] ${keys.size} distinct plan keys over 200 levels x 7 floors\n`);
    expect(keys.size).toBeGreaterThan(150);
  });
});

describe('generated floors (6 level seeds)', () => {
  it('validate (reachability, landings, shaft, windows, roof, tenants, room sizes, plates) in reasonable time', () => {
    for (const s of SEEDS) expect(officeIssues(gen(s), towerFrame(s)), `${s}`).toEqual([]);
    const sorted = times.slice().sort((a, b) => a - b);
    process.stdout.write(`[office-floorplans] generateOfficeLevel ms ${times.map(t => t.toFixed(0)).join(', ')} (median ${sorted[sorted.length >> 1].toFixed(0)})\n`);
    expect(sorted[sorted.length >> 1]).toBeLessThan(2000);
  }, 120000);

  it('floors differ in WALL LAYOUT (skeletons), corridor topology and support-room sets — not just labels', () => {
    let sk = 0, tp = 0, sup = 0;
    for (const s of SEEDS) {
      const l = gen(s);
      const skel = new Set(FLOORS.map(n => skeleton(l, s, n)));
      const topos = new Set(FLOORS.map(n => corridorTopology(l, s, n)));
      const sets = new Set(FLOORS.map(n => supportSet(l, s, n)));
      expect(skel.size, `${s} skeletons`).toBeGreaterThanOrEqual(6);
      expect(topos.size, `${s} corridor topologies`).toBeGreaterThanOrEqual(3);
      expect(sets.size, `${s} support-room sets`).toBeGreaterThanOrEqual(4);
      // the geometry matches the plan: commons floors have no S corridor, loop floors one side corridor; the QA pose reads it too
      const f = towerFrame(s);
      for (const n of FLOORS) {
        const t = corridorTopology(l, s, n), p = f.plans[n];
        expect(t, `${s} floor ${n} ${planKey(p)}`).toBe(p.topology === 'ring' ? 'S2' : p.topology === 'commons' ? 'C2' : 'S1');
        const pose = floorPlanPose(l, n)!;
        expect(pose.kind, `${s} floor ${n} pose`).toBe(topo(p));
        const g = l.levels[n].grid;
        expect(g.walkable(...g.cellOf(pose.x, pose.z)), `${s} floor ${n} pose walkable`).toBe(true);
        expect(pose.y).toBe(l.levels[n].baseY);
      }
      sk += skel.size; tp += topos.size; sup += sets.size;
    }
    process.stdout.write(`[office-floorplans] per level (of 7 floors): ${(sk / SEEDS.length).toFixed(1)} distinct skeletons, ${(tp / SEEDS.length).toFixed(1)} corridor topologies, ${(sup / SEEDS.length).toFixed(1)} support-room sets (before: 1 / 1 / 1)\n`);
  });

  it('the core never moves: landings, well, shaft (solid) and the elevator landing strip at the same X/Z on every storey', () => {
    for (const s of SEEDS) {
      const l = gen(s), f = towerFrame(s), o = l.office!;
      const strip = elevatorLandingStrip(f);
      for (const st of o.storeys) {
        const g = l.levels[st.levelId].grid, lr = landingRect(f, st.floor);
        const land = l.areas[g.area[g.idx(lr.x + MARGIN + 1, lr.y + MARGIN + 1)]];
        expect([land.type, land.x, land.y, land.w, land.h], `${s} storey ${st.floor} landing`).toEqual(['office-stair', lr.x + MARGIN, lr.y + MARGIN, lr.w, lr.h]);
        for (let y = f.shaft.y; y < f.shaft.y + f.shaft.h; y++) for (let x = f.shaft.x; x < f.shaft.x + f.shaft.w; x++) expect(g.cells[g.idx(x + MARGIN, y + MARGIN)]).toBe(SOLID);
        for (let z = strip.z0 + CELL / 2; z < strip.z1; z += CELL) for (let x = strip.x0 + CELL / 2; x < strip.x1; x += CELL) {
          const [cx, cy] = g.cellOf(x, z);
          expect(g.walkable(cx, cy), `${s} storey ${st.floor} strip ${x},${z}`).toBe(true);
        }
      }
      expect(o.stairs.well).toEqual({x0: (f.well.x + MARGIN) * CELL, z0: (f.well.y + MARGIN) * CELL, x1: (f.well.x + f.well.w + MARGIN) * CELL, z1: (f.well.y + f.well.h + MARGIN) * CELL});
      expect(new Set(o.windows.map(w => w.level)).size).toBe(8);
    }
  });

  it('small rooms are usable: every room >= 2.5 m on its short side; rooms < 16 m2 keep the door swing free and a 1.5 m turning square', () => {
    let small = 0;
    for (const s of SEEDS) {
      const l = gen(s);
      for (const a of l.areas.filter(isRoom)) {
        expect(Math.min(a.w, a.h), `${s} ${a.label} ${a.w}x${a.h}`).toBeGreaterThanOrEqual(ROOM_MIN_CELLS);
        if (a.w * a.h * CELL * CELL >= 16) continue;
        small++;
        const lv = a.level!, g = l.levels[lv].grid;
        const free = (x: number, y: number) => g.inBounds(x, y) && g.area[g.idx(x, y)] === a.id && g.walkable(x, y);
        for (const d of l.doors.filter(q => (q.a === a.id || q.b === a.id) && (q.level ?? 0) === lv)) {
          const side = doorSide(d, a), across = side === 'N' || side === 'S';
          for (let k = 0; k < (across ? d.w : d.h); k++) for (const depth of [0, 1]) {
            const x = across ? d.x + k : side === 'W' ? a.x + depth : a.x + a.w - 1 - depth;
            const y = across ? (side === 'N' ? a.y + depth : a.y + a.h - 1 - depth) : d.y + k;
            expect(free(x, y), `${s} ${a.label}: door swing cell ${x},${y}`).toBe(true);
          }
        }
        let turn = false;
        for (let y = a.y; y + 2 < a.y + a.h && !turn; y++) for (let x = a.x; x + 2 < a.x + a.w && !turn; x++) {
          let ok = true;
          for (let oy = 0; oy < 3 && ok; oy++) for (let ox = 0; ox < 3; ox++) if (!free(x + ox, y + oy)) { ok = false; break; }
          turn = ok;
        }
        expect(turn, `${s} ${a.label} ${a.w}x${a.h}: 1.5 m turning square`).toBe(true);
      }
    }
    expect(small).toBeGreaterThan(SEEDS.length * 20);
  });

  it('large rooms are furnished on purpose: no empty outliers (share of floor covered by free-standing furniture)', () => {
    const shares: number[] = [];
    for (const s of SEEDS) {
      const l = gen(s);
      for (const a of l.areas.filter(q => isRoom(q) && (q.level ?? 0) >= 2 && q.w * q.h * CELL * CELL >= FILL_MIN_M2)) {
        const sh = furnishedShare(l, a);
        shares.push(sh);
        expect(sh, `${s} ${a.label} ${a.w}x${a.h}`).toBeGreaterThanOrEqual(0.05);
      }
    }
    shares.sort((a, b) => a - b);
    const median = shares[shares.length >> 1], low = shares.filter(q => q < 0.08).length;
    process.stdout.write(`[office-floorplans] ${shares.length} rooms >= ${FILL_MIN_M2} m2: furnished share min ${shares[0].toFixed(3)}, p10 ${shares[Math.floor(shares.length / 10)].toFixed(3)}, median ${median.toFixed(3)}, ${low} below 0.08 (before: median 0.102, 29 % below 0.08)\n`);
    expect(median).toBeGreaterThanOrEqual(0.12);
    expect(low / shares.length).toBeLessThan(0.03);
  });

  it('item 4: floor 8\'s roof access room carries exactly ONE plate (ROOF ACCESS), never an ELECTRICAL one; real electrical rooms keep theirs; no overlapping plates', () => {
    let electrical = 0;
    for (const s of SEEDS) {
      const l = gen(s);
      const rooms = l.areas.filter(a => a.level === OFFICE_TOP_FLOOR && a.purpose === 'office-roof-access');
      expect(rooms.length, `${s}`).toBe(1);
      const r = rooms[0];
      expect(r.label).toContain('Roof access');
      // the ladder foot stands in it
      const lad = l.traversal.ladders.find(q => q.kind === 'roof')!, g8 = l.levels[OFFICE_TOP_FLOOR].grid;
      expect(g8.area[g8.idx(...g8.cellOf(lad.bottom.x, lad.bottom.z))]).toBe(r.id);
      const plates = l.signs.filter(q => q.level === OFFICE_TOP_FLOOR && q.text === 'ROOF ACCESS');
      expect(plates.length, `${s} ROOF ACCESS plates`).toBe(1);
      for (const d of l.doors.filter(q => (q.a === r.id || q.b === r.id) && q.level === OFFICE_TOP_FLOOR)) {
        const cx = (d.x + d.w / 2) * CELL, cz = (d.y + d.h / 2) * CELL;
        const near = l.signs.filter(q => q.level === OFFICE_TOP_FLOOR && Math.hypot(q.x - cx, q.z - cz) < 2.5);
        expect(near.filter(q => q.text === 'ROOF ACCESS').length, `${s} plate at the roof door`).toBe(1);
        expect(near.some(q => /ELECTRICAL/.test(q.text)), `${s} ELECTRICAL at the roof door`).toBe(false);
      }
      electrical += l.signs.filter(q => /ELECTRICAL/.test(q.text)).length;
      // no two plates overlap on one wall face of any storey
      for (const q of l.signs) {
        const lv = q.level ?? 0;
        if (lv >= 1) expect(signOverlaps(l, lv, q, q.y, signDims(q), q, {w: -0.01, h: -0.01}), `${s} '${q.text}' level ${lv}`).toBe(false);
      }
    }
    // the lobby riser / the floors whose plan keeps an electrical riser still say so
    expect(electrical).toBeGreaterThan(SEEDS.length);
  });
});
