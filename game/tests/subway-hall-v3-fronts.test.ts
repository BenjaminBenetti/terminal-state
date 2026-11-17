// Task studio-subway-rework-m2-finishing-20261117-111246-01 (lane GEN): the layout-version-3 grand hall's DESTINATIONS
// (gen/stationHallV3Dress.ts) on the grand-hall corpus (the first grand-hall plan-family seeds, generated at version 2 and 3):
//  - every hall records its ticket office, waiting groups and kiosk / service points as HallSection.fronts, fitted to the free floor
//    (aisle pockets are never zero where a free wall run holds one), inside the hall, off the spine and every door lane, not overlapping;
//  - the office's fascia plate, the waiting groups' hung wayfinding (beside the clock the kit hangs on them, off bay lines / centres,
//    apart) and the pockets' wall plates never cross an opening and are backed by wall;
//  - the clerestory's features (HallSection.upper) are purposeful and non-uniform: one clock, tablets (with their signs on the face)
//    over the office / gate banks / street exits, grilles, never in a transept crossing, never every bay;
//  - the version-3 grand halls' loot holders stay at the version-2 grand halls' mean (and in their range).

import {describe, expect, it} from 'vitest';
import {generateStation, type StationLayout} from '../src/gen/station';
import {CELL} from '../src/gen/grid';
import {planFamilyOf} from '../src/gen/stationPlans';
import {HALL_V3_HOLDER_CAP, HALL_V3_HOLDER_MIN, OFFICE_FASCIA, clerestoryBand, hallV3Summary} from '../src/gen/stationHallV3Dress';
import {hallSectionWorld} from '../src/gen/hallSection';
import {doorwayIntrusions, signDims, wallBacked} from '../src/gen/doorways';
import {doorSide} from '../src/gen/placeKit';
import {isLootHolderKind} from '../src/items/loot';
import type {Area, HallFront, SignPlacement} from '../src/gen/stationTypes';

/** The corpus: the first grand-hall plan-family seeds. */
const CORPUS: number[] = [];
for (let s = 1; CORPUS.length < 12; s++) if (planFamilyOf(s) === 'grand-hall') CORPUS.push(s);

const cache = new Map<string, StationLayout>();
const gen = (seed: number, version: number): StationLayout => {
  const k = `${seed}:${version}`;
  let L = cache.get(k);
  if (!L) cache.set(k, (L = generateStation(seed, {layoutVersion: version})));
  return L;
};
const grandHall = (L: StationLayout): Area => L.areas.find(a => a.role === 'grand-ticket-hall')!;
const WAITING_TEXTS = (t: string) => t.startsWith('TRAINS · ') || t === 'WAITING · ALL PLATFORMS';
const boxOverlap = (p: HallFront, q: {along: [number, number]; across: [number, number]}, eps = 0.01) =>
  p.along[0] < q.along[1] - eps && q.along[0] < p.along[1] - eps && p.across[0] < q.across[1] - eps && q.across[0] < p.across[1] - eps;
/** Points along a plate's width (world). */
const platePts = (s: SignPlacement): [number, number][] => {
  const hw = signDims(s).w / 2;
  return Array.from({length: 7}, (_, k) => { const t = -hw + (2 * hw * k) / 6; return [s.x + Math.cos(s.rot) * t, s.z - Math.sin(s.rot) * t] as [number, number]; });
};

describe('version-3 grand hall fronts (corpus)', () => {
  it('every hall records its office, waiting and kiosk / service fronts; aisle pockets are never zero where the floor holds one', () => {
    expect(CORPUS.length).toBe(12);
    for (const s of CORPUS) {
      const L = gen(s, 3), T = grandHall(L), S = hallSectionWorld(T)!;
      const tag = `seed ${s} (${S.variant})`;
      const sum = hallV3Summary(L).find(q => q.area === T.id)!;
      const fronts = S.fronts ?? [];
      const of = (k: HallFront['kind']) => fronts.filter(f => f.kind === k);
      expect(of('office').length, `${tag}: one ticket office`).toBe(1);
      expect(of('office')[0].wall, tag).toBe('N');
      expect(of('waiting').length, `${tag}: waiting groups`).toBeGreaterThanOrEqual(1);
      expect(of('kiosk').length + of('service').length, `${tag}: kiosk / service points`).toBeGreaterThanOrEqual(1);
      for (const k of ['office', 'waiting', 'kiosk', 'service'] as const) expect(sum.fronts[k], tag).toBe(of(k).length);
      // the aisle pockets: 2-4, a waiting group and a kiosk / service point wherever a free wall run holds one (every corpus hall has)
      const pockets = sum.pockets.retail + sum.pockets.service + sum.pockets.waiting;
      expect(sum.freeRun, `${tag}: free aisle wall`).toBeGreaterThanOrEqual(4.5);
      expect(pockets, `${tag}: aisle pockets`).toBeGreaterThanOrEqual(2);
      expect(pockets, tag).toBeLessThanOrEqual(4);
      expect(sum.pockets.waiting, `${tag}: an aisle waiting pocket`).toBeGreaterThanOrEqual(1);
      expect(sum.pockets.retail + sum.pockets.service, `${tag}: an aisle kiosk / service pocket`).toBeGreaterThanOrEqual(1);
      // the record is relative (hallSectionWorld converts) and labelled
      for (const f of T.hallSection!.fronts!) expect(f.along[0], tag).toBeLessThan(T.w * CELL + 1e-6);
      for (const f of fronts) expect(f.label, tag).toBeTruthy();
    }
  }, 120_000);

  it('fronts lie inside the hall, off the spine and every door lane, and do not overlap each other', () => {
    for (const s of CORPUS) {
      const L = gen(s, 3), T = grandHall(L), S = hallSectionWorld(T)!;
      const tag = `seed ${s}`;
      const ax0 = T.x * CELL, ax1 = (T.x + T.w) * CELL, az0 = T.y * CELL, az1 = (T.y + T.h) * CELL;
      // the reserved circulation (gen/stationHallV3Dress.ts reserveCirculation): the spine + a lane from every opening to it
      const lanes: {along: [number, number]; across: [number, number]}[] = [{along: [ax0, ax1], across: [S.spine[0], S.spine[1]]}];
      for (const d of L.doors.filter(q => q.a === T.id || q.b === T.id)) {
        const side = doorSide(d, T);
        if (side === 'N') lanes.push({along: [(d.x - 1) * CELL, (d.x + d.w + 1) * CELL], across: [az0, S.spine[0]]});
        else if (side === 'S') lanes.push({along: [(d.x - 1) * CELL, (d.x + d.w + 1) * CELL], across: [S.spine[1], az1]});
        else {
          const xs: [number, number] = side === 'W' ? [ax0, ax0 + 3] : [ax1 - 3, ax1];
          lanes.push({along: xs, across: [Math.min((d.y - 1) * CELL, S.spine[0]), Math.max((d.y + d.h + 1) * CELL, S.spine[1])]});
        }
      }
      const fronts = S.fronts!;
      fronts.forEach((f, i) => {
        const at = `${tag} ${f.kind}/${f.wall} ${f.along} x ${f.across}`;
        expect(f.along[0], at).toBeLessThan(f.along[1]);
        expect(f.across[0], at).toBeLessThan(f.across[1]);
        expect(f.along[0], at).toBeGreaterThanOrEqual(ax0 - 1e-6);
        expect(f.along[1], at).toBeLessThanOrEqual(ax1 + 1e-6);
        expect(f.across[0], at).toBeGreaterThanOrEqual(az0 - 1e-6);
        expect(f.across[1], at).toBeLessThanOrEqual(az1 + 1e-6);
        for (const l of lanes) expect(boxOverlap(f, l), `${at}: off lane ${l.along} x ${l.across}`).toBe(false);
        for (const g of fronts.slice(i + 1)) expect(boxOverlap(f, g), `${at} vs ${g.kind} ${g.along} x ${g.across}`).toBe(false);
        // a wall front backs onto its wall
        if (f.wall === 'N') expect(f.across[0], at).toBeCloseTo(az0, 6);
        if (f.wall === 'S') expect(f.across[1], at).toBeCloseTo(az1, 6);
      });
    }
  }, 120_000);

  it('the fronts\' signs: the office fascia, hung wayfinding beside each waiting group\'s clock, pocket plates; none crosses an opening', () => {
    for (const s of CORPUS) {
      const L = gen(s, 3), T = grandHall(L), S = hallSectionWorld(T)!;
      const tag = `seed ${s}`;
      const sum = hallV3Summary(L).find(q => q.area === T.id)!;
      const signs = L.signs.filter(q => q.area === T.id);
      expect(doorwayIntrusions(L).filter(x => x.source === 'sign' || x.source === 'signRod'), tag).toEqual([]);
      // the office fascia: centred on the office, in front of the kit's fascia box, over the 2.7 m booths
      const office = S.fronts!.find(f => f.kind === 'office')!;
      const fascia = signs.filter(q => q.text === OFFICE_FASCIA.text);
      expect(fascia.length, tag).toBe(1);
      expect(fascia[0].x, tag).toBeCloseTo((office.along[0] + office.along[1]) / 2, 2);
      expect(fascia[0].z, tag).toBeCloseTo(T.y * CELL + OFFICE_FASCIA.out, 3);
      expect(fascia[0].y, tag).toBe(OFFICE_FASCIA.y);
      expect(fascia[0].rot, tag).toBe(0);
      expect(fascia[0].hang, tag).toBeFalsy();
      expect(signDims(fascia[0]).w, tag).toBeLessThanOrEqual(Math.min(office.along[1] - office.along[0] - 1.2, OFFICE_FASCIA.maxW) + 1e-6);
      // wall plates of the hall (on its wall planes) are backed by wall
      for (const q of signs) {
        if (q.hang) continue;
        const side = Math.abs(q.rot) < 1e-6 ? 'N' : 'S';
        const plane = side === 'N' ? T.y * CELL + 0.02 : (T.y + T.h) * CELL - 0.02;
        if (Math.abs(q.z - plane) > 1e-6) continue;
        const {w, h} = signDims(q);
        expect(wallBacked(L.grid, T, side, q.x - w / 2, q.x + w / 2, q.y - h / 2), `${tag} "${q.text}"`).toBe(true);
      }
      // the waiting groups' hung plates: 1-4, each beside its group's centre (the clock), off bay lines / centres, apart from every
      // other hung plate of the hall
      const waiting = signs.filter(q => q.hang && WAITING_TEXTS(q.text));
      expect(waiting.length, tag).toBe(sum.waitingSigns);
      expect(waiting.length, tag).toBeGreaterThanOrEqual(1);
      expect(waiting.length, tag).toBeLessThanOrEqual(4);
      const centres = [T.x * CELL, ...S.lines, (T.x + T.w) * CELL].slice(1).map((q, i, xs) => (q + (i ? xs[i - 1] : T.x * CELL)) / 2);
      const groups = S.fronts!.filter(f => f.kind === 'waiting');
      for (const q of waiting) {
        const at = `${tag} "${q.text}" @${q.x},${q.z}`;
        const w = signDims(q).w, s0 = q.x - w / 2, s1 = q.x + w / 2;
        expect(q.rot, at).toBe(0);
        expect(['left', 'right', 'up'], at).toContain(q.arrow);
        for (const l of S.lines) expect(s1 <= l - 0.8 + 1e-6 || s0 >= l + 0.8 - 1e-6, `${at}: off bay line ${l}`).toBe(true);
        for (const c of centres) expect(s1 <= c - 0.6 + 1e-6 || s0 >= c + 0.6 - 1e-6, `${at}: off bay centre ${c}`).toBe(true);
        const g = groups.find(f => Math.abs((f.across[0] + f.across[1]) / 2 - q.z) < 0.01 && Math.abs((f.along[0] + f.along[1]) / 2 - q.x) < 4);
        expect(g, `${at}: beside a waiting group`).toBeTruthy();
        const c = (g!.along[0] + g!.along[1]) / 2;
        expect(Math.min(Math.abs(s0 - c), Math.abs(s1 - c)), `${at}: clear of the clock`).toBeGreaterThanOrEqual(0.8 - 1e-6);
        expect(s0 > c || s1 < c, `${at}: not over the clock`).toBe(true);
        expect(q.y, at).toBeLessThan(L.grid.ceilAt(q.x, q.z) - 0.5);
        for (const o of signs) {
          if (o === q || !o.hang) continue;
          let d = Infinity;
          for (const [ax, az] of platePts(q)) for (const [bx, bz] of platePts(o)) d = Math.min(d, Math.hypot(ax - bx, az - bz));
          expect(d, `${at} vs "${o.text}"`).toBeGreaterThanOrEqual(1.5 - 0.15); // (sampled plate points)
        }
      }
    }
  }, 120_000);

  it('the clerestory: one clock, tablets over the office / gate banks / street exits with their signs, grilles; non-uniform', () => {
    for (const s of CORPUS) {
      const L = gen(s, 3), T = grandHall(L), S = hallSectionWorld(T)!;
      const tag = `seed ${s} (${S.variant})`;
      const up = S.upper!;
      const kinds = new Set(up.map(u => u.kind));
      expect(kinds.size, `${tag}: >= 2 kinds`).toBeGreaterThanOrEqual(2);
      expect(up.filter(u => u.kind === 'clock').length, tag).toBe(1);
      expect(up.filter(u => u.kind === 'tablet').length, tag).toBeGreaterThanOrEqual(2);
      const faces = [S.nave[0], ...(S.aisles.length > 1 ? [S.nave[1]] : [])];
      const bays = [T.x * CELL, ...S.lines, (T.x + T.w) * CELL].slice(1).map((q, i, xs) => [i ? xs[i - 1] : T.x * CELL, q] as [number, number]);
      const [b0, b1] = clerestoryBand(S);
      for (const [fi, face] of faces.entries()) {
        const mine = up.filter(u => Math.abs(u.face - face) < 1e-6);
        expect(mine.length, `${tag} face ${fi}: some features`).toBeGreaterThan(0);
        expect(mine.length, `${tag} face ${fi}: not every bay`).toBeLessThan(bays.length);
        for (const u of mine) expect(u.facing, tag).toBe(fi === 0 ? 1 : -1);
        const keys = mine.map(u => u.along.join(','));
        expect(new Set(keys).size, `${tag}: one feature per bay`).toBe(keys.length);
      }
      // the two clerestories differ
      if (faces.length > 1) {
        const seq = (f: number) => bays.map(b => up.find(u => Math.abs(u.face - f) < 1e-6 && Math.abs(u.along[0] - b[0]) < 0.01)?.kind ?? '-').join('');
        expect(seq(faces[0]), tag).not.toBe(seq(faces[1]));
      }
      for (const u of up) {
        const at = `${tag} ${u.kind} ${u.along} face ${u.face}`;
        expect(faces.some(f => Math.abs(f - u.face) < 1e-6), at).toBe(true);
        expect(bays.some(b => Math.abs(b[0] - u.along[0]) < 0.01 && Math.abs(b[1] - u.along[1]) < 0.01), `${at}: a bay`).toBe(true);
        const c = (u.along[0] + u.along[1]) / 2;
        if (S.transept) expect(c > S.transept[0] && c < S.transept[1], `${at}: never in the crossing`).toBe(false);
        if (u.kind !== 'tablet') { expect(u.text, at).toBeUndefined(); continue; }
        // its sign: on the face plane (0.06 m proud, facing the nave), centred in the bay, inside the panel band
        const sg = L.signs.filter(q => q.area === T.id && !q.hang && q.text === u.text && Math.abs(q.z - (u.face + 0.06 * u.facing)) < 1e-3 && Math.abs(q.x - c) < 0.01);
        expect(sg.length, at).toBe(1);
        const {w, h} = signDims(sg[0]);
        expect(sg[0].rot, at).toBe(u.facing > 0 ? 0 : Math.PI);
        expect(sg[0].kind, at).toBe(u.text === 'WAY OUT' ? 'exit' : 'info');
        expect(w, at).toBeLessThanOrEqual(u.along[1] - u.along[0] - 1.6 + 1e-6);
        expect(sg[0].y - h / 2, at).toBeGreaterThanOrEqual(b0);
        expect(sg[0].y + h / 2, at).toBeLessThanOrEqual(b1);
      }
      // the office's and the gate banks' tablets face the gate side; the street exits' the exit side
      for (const u of up.filter(q => q.kind === 'tablet')) expect(u.facing, `${tag} ${u.text}`).toBe(u.text === 'WAY OUT' ? -1 : 1);
    }
  }, 120_000);

  it('loot holders: the version-3 grand halls stay at the version-2 grand halls\' mean and range', () => {
    const h2: number[] = [], h3: number[] = [];
    for (const s of CORPUS) {
      const a = gen(s, 2), b = gen(s, 3);
      const n = (L: StationLayout) => { const T = grandHall(L); return L.props.filter(p => p.area === T.id && isLootHolderKind(p.kind)).length; };
      h2.push(n(a)); h3.push(n(b));
      const sum = hallV3Summary(b).find(q => q.area === grandHall(b).id)!;
      expect(n(b), `seed ${s}`).toBe(sum.holdersAfter);
      expect(n(b), `seed ${s}`).toBeGreaterThanOrEqual(HALL_V3_HOLDER_MIN);
      expect(n(b), `seed ${s}`).toBeLessThanOrEqual(Math.max(HALL_V3_HOLDER_CAP, sum.holdersBefore));
      expect(grandHall(a).hallSection, `seed ${s}: version 2 has no section`).toBeUndefined();
    }
    const mean = (xs: number[]) => xs.reduce((p, q) => p + q, 0) / xs.length;
    expect(Math.abs(mean(h3) - mean(h2)), `v2 ${mean(h2).toFixed(2)} v3 ${mean(h3).toFixed(2)}`).toBeLessThanOrEqual(0.75);
    expect(Math.min(...h3)).toBeGreaterThanOrEqual(Math.min(6, ...h2));
    expect(Math.max(...h3)).toBeLessThanOrEqual(Math.max(13, ...h2));
  }, 120_000);

  it('deterministic: the same seed records the same fronts and clerestory features', () => {
    const s = CORPUS[1];
    const a = hallSectionWorld(grandHall(generateStation(s, {layoutVersion: 3})))!;
    const b = hallSectionWorld(grandHall(gen(s, 3)))!;
    expect(a.fronts).toEqual(b.fronts);
    expect(a.upper).toEqual(b.upper);
  }, 60_000);
});
