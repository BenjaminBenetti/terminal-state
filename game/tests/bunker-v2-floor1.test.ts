// Task studio-bunker-rework-20261109-205115-01: THE BUNKER v2, storey 1 (ENTRY & SECURITY; gen/bunker/v2/floor1.ts + floor1Dress.ts)
// over a bounded seed set: the whole level valid, the admission line and the security wing present, the storey's mix of scales (the
// tall intake hall, the gallery ring round the commons well vs the screening lanes, the 2 m guard corridor, the holding cells), the
// well left open with a railed rim on both long sides, the anchors served, the weak decontamination leak, the budgets, determinism.

import {describe, expect, it} from 'vitest';
import {appendFileSync, writeFileSync} from 'node:fs';
import {generateBunkerLevel} from '../src/gen/bunker/index';
import {bunkerIssues} from '../src/gen/bunker/validate';
import {bunkerV2Issues} from '../src/gen/bunker/v2/validate';
import {BUNKER_V2_STATS} from '../src/gen/bunker/v2/index';
import {bunkerSpine} from '../src/gen/bunker/v2/spine';
import {F1_DRESS_STATS} from '../src/gen/bunker/v2/floor1Dress';
import {F1_LANES} from '../src/gen/bunker/v2/floor1Plan';
import {GAS_STRENGTH} from '../src/gen/bunker/hazards';
import {CELL, FLOOR} from '../src/gen/grid';
import {isLootHolderKind} from '../src/items/loot';
import type {Area, StationLayout} from '../src/gen/stationTypes';

const LOG = '/tmp/bunker-v2-floor1.log';
const log = (s: string) => appendFileSync(LOG, s + '\n');
const SEEDS = [9001, 16920, 1, 77, 1234, 31337, 424242, 5555];
const SP = bunkerSpine();
const FR = SP.storeys[1];
const WELL = FR.well!.rect;

describe('bunker v2 storey 1 (entry & security)', () => {
  writeFileSync(LOG, '');
  const cache = new Map<number, {l: StationLayout; ms: number; dress: typeof F1_DRESS_STATS}>();
  const gen = (seed: number) => {
    let r = cache.get(seed);
    if (!r) {
      const l = generateBunkerLevel({levelSeed: seed});
      r = {l, ms: BUNKER_V2_STATS.ms, dress: {...F1_DRESS_STATS, skipped: [...F1_DRESS_STATS.skipped]}};
      cache.set(seed, r);
      const p1 = l.props.filter(p => (p.level ?? 0) === 1);
      log(`seed ${seed}: ${r.ms.toFixed(0)} ms, attempts ${BUNKER_V2_STATS.attempts}, storey-1 props ${p1.length} holders ${p1.filter(p => isLootHolderKind(p.kind)).length} lights ${l.lights.filter(q => (q.level ?? 0) === 1).length} dress ${JSON.stringify(r.dress)}`);
    }
    return r;
  };
  const areasOf = (l: StationLayout) => l.areas.filter(a => (a.level ?? 0) === 1);
  const byLabel = (l: StationLayout, label: string): Area | undefined => areasOf(l).find(a => a.label === label);
  const doorsOf = (l: StationLayout, a: Area) => l.doors.filter(d => d.a === a.id || d.b === a.id);
  const propsIn = (l: StationLayout, a: Area) => l.props.filter(p => p.area === a.id);
  const rel = (a: Area) => a.ceil - (a.floorY ?? 0);

  it('the whole level is valid for every seed (bunkerIssues + bunkerV2Issues) within the generation budget', () => {
    const bad: string[] = [];
    for (const s of SEEDS) {
      const {l, ms} = gen(s);
      const issues = [...bunkerIssues(l), ...bunkerV2Issues(l)];
      if (issues.length) bad.push(`${s}: ${issues.slice(0, 4).join(' | ')}`);
      expect(ms).toBeLessThan(6000);
    }
    expect(bad).toEqual([]);
  });

  it('the programme: decontamination, the intake hall, three screening lanes + booths, the search room, operations, the warden, the guard room + its dead-end armoury, the duty hall lockers, latrines, four holding cells', () => {
    for (const s of SEEDS) {
      const {l} = gen(s);
      const need = ['Decontamination', 'Intake hall', 'Screening lane 1', 'Screening lane 2', 'Screening lane 3', 'Guard booth 1', 'Guard booth 2', 'Search room',
        'Operations room', "Warden's office", 'Guard room', 'Armoury', 'Duty hall', 'Latrines', 'Confiscated property', 'Registry', 'Freight lobby', 'Guard corridor', 'Arrival lobby',
        'Muster gallery', 'Overlook gallery', 'East gallery walk', 'West gallery walk', 'Holding cell 1', 'Holding cell 2', 'Holding cell 3', 'Holding cell 4'];
      for (const n of need) expect(byLabel(l, n), `${s}: ${n}`).toBeDefined();
      const decon = byLabel(l, 'Decontamination')!;
      expect(decon.purpose).toBe('reactor-bunker-decon');
      expect(propsIn(l, decon).filter(p => p.kind === 'bunkerDeconShower').length).toBeGreaterThanOrEqual(2);
      // the armoury: a dead end (one door, into the guard room) holding openable storage
      const arm = byLabel(l, 'Armoury')!, guard = byLabel(l, 'Guard room')!;
      expect(arm.purpose).toBe('reactor-bunker-armoury');
      const ad = doorsOf(l, arm);
      expect(ad.length).toBe(1);
      expect([ad[0].a, ad[0].b]).toContain(guard.id);
      expect(propsIn(l, arm).filter(p => ['gunLocker', 'cabinetTall', 'crate'].includes(p.kind)).length).toBeGreaterThanOrEqual(3);
      expect(guard.purpose).toBe('security-office');
      const ops = byLabel(l, 'Operations room')!;
      expect(propsIn(l, ops).map(p => p.kind)).toEqual(expect.arrayContaining(['radioConsole', 'bunkerControlConsole']));
      expect(propsIn(l, byLabel(l, 'Duty hall')!).filter(p => p.kind === 'staffLockers').length).toBeGreaterThanOrEqual(2);
      expect(byLabel(l, 'Latrines')!.purpose).toBe('washroom');
      expect(byLabel(l, 'Confiscated property')!.purpose).toBe('lost-property');
      expect(byLabel(l, 'Registry')!.purpose).toBe('agent-office');
      // every lane: its detector against the planned wall, the 1.5 m walkway beside it open between the two doorways
      for (let i = 0; i < 3; i++) {
        const ln = byLabel(l, `Screening lane ${i + 1}`)!;
        const det = propsIn(l, ln).filter(p => p.kind === 'metalDetector');
        expect(det.length, `${s}: lane ${i + 1} detector`).toBe(1);
        expect(F1_LANES[i] === 'W' ? det[0].x < (ln.x + ln.w / 2) * CELL : det[0].x > (ln.x + ln.w / 2) * CELL).toBe(true);
        const g = l.levels[1].grid, wx = F1_LANES[i] === 'W' ? ln.x + 4 : ln.x;
        for (let y = ln.y; y < ln.y + ln.h; y++) for (let x = wx; x < wx + 3; x++) expect(g.blocked[g.idx(x, y)], `${s}: lane ${i + 1} walkway ${x},${y}`).toBe(0);
        expect(doorsOf(l, ln).filter(d => d.x === wx && d.w === 3).length).toBe(2);
      }
    }
  });

  it('a real mix of scales: the tall intake hall and the gallery ring vs the lanes, the 2 m guard corridor and the 3 m holding cells', () => {
    for (const s of SEEDS) {
      const {l} = gen(s);
      const intake = byLabel(l, 'Intake hall')!;
      const m2 = (a: Area) => a.w * a.h * CELL * CELL;
      expect(m2(intake)).toBeGreaterThanOrEqual(150);
      expect(rel(intake)).toBeGreaterThanOrEqual(5.5);
      const ring = ['Muster gallery', 'Overlook gallery', 'East gallery walk', 'West gallery walk'].map(n => byLabel(l, n)!);
      expect(ring.reduce((t, a) => t + m2(a), 0)).toBeGreaterThanOrEqual(280);
      for (const a of ring) expect(rel(a)).toBeCloseTo(FR.well!.ceil - FR.base, 2);
      // the largest single room on the storey is one of the generous spaces
      const big = [...areasOf(l)].filter(a => a.role !== 'stair' && a.role !== 'landing').sort((p, q) => m2(q) - m2(p))[0];
      expect(['Intake hall', 'Muster gallery']).toContain(big.label);
      const corr = byLabel(l, 'Guard corridor')!;
      expect(Math.min(corr.w, corr.h) * CELL).toBeLessThanOrEqual(2.0);
      expect(Math.max(corr.w, corr.h) * CELL).toBeGreaterThanOrEqual(18);
      for (let i = 1; i <= 4; i++) { const c = byLabel(l, `Holding cell ${i}`)!; expect(m2(c)).toBeLessThanOrEqual(9.5); expect(doorsOf(l, c).length).toBe(1); }
      for (let i = 1; i <= 3; i++) { const ln = byLabel(l, `Screening lane ${i}`)!; expect(ln.w * CELL).toBeLessThanOrEqual(3.5); expect(rel(ln)).toBeLessThanOrEqual(3.0); }
      // at least four distinct clear heights on the storey (lanes 3.0 / lobby 3.4 / gallery 4.6 / intake 6.0 …)
      expect(new Set(areasOf(l).filter(a => a.role !== 'stair' && a.role !== 'landing').map(a => Math.round(rel(a) * 10))).size).toBeGreaterThanOrEqual(4);
    }
  });

  it('the V12 well stays open; its rim is walkable gallery along BOTH long sides, railed, with the reveal ahead of every lane', () => {
    for (const s of SEEDS) {
      const {l} = gen(s);
      const g = l.levels[1].grid;
      for (let y = WELL.y; y < WELL.y + WELL.h; y++) for (let x = WELL.x; x < WELL.x + WELL.w; x++) expect(g.cells[g.idx(x, y)]).not.toBe(FLOOR);
      const n = byLabel(l, 'Muster gallery')!, so = byLabel(l, 'Overlook gallery')!;
      for (let x = WELL.x; x < WELL.x + WELL.w; x++) {
        expect(g.area[g.idx(x, WELL.y - 1)]).toBe(n.id);
        expect(g.area[g.idx(x, WELL.y + WELL.h)]).toBe(so.id);
      }
      // railings along both long edges (the derived well rails on storey 1)
      const railM = (z: number) => (l.rails ?? []).filter(r => r.level === 1 && Math.abs(r.z0 - z) < 0.05 && Math.abs(r.z1 - z) < 0.05)
        .reduce((t, r) => t + Math.abs(r.x1 - r.x0), 0);
      expect(railM(WELL.y * CELL)).toBeGreaterThanOrEqual(WELL.w * CELL - 0.5);
      expect(railM((WELL.y + WELL.h) * CELL)).toBeGreaterThanOrEqual(WELL.w * CELL - 0.5);
      // the reveal: from each lane's overlook doorway straight to the rail, the gallery floor is open (nothing blocks the first view)
      for (let i = 1; i <= 3; i++) {
        const ln = byLabel(l, `Screening lane ${i}`)!;
        const d = doorsOf(l, ln).find(q => q.a === so.id || q.b === so.id)!;
        for (let y = WELL.y + WELL.h; y < d.y; y++) for (let x = d.x; x < d.x + d.w; x++) expect(g.blocked[g.idx(x, y)], `${s}: reveal ${x},${y}`).toBe(0);
      }
      // the ring's corners are frameless full-width joins
      const ring = new Set([n.id, so.id, byLabel(l, 'East gallery walk')!.id, byLabel(l, 'West gallery walk')!.id]);
      expect(l.doors.filter(d => ring.has(d.a) && ring.has(d.b) && d.noFrame).length).toBe(4);
    }
  });

  it('every storey-1 anchor apron is open floor of one of the storey\'s own areas, kept clear', () => {
    const own: Record<string, string> = {stairA: 'Arrival lobby', stairB: 'Duty hall', lift: 'Freight lobby'};
    for (const s of SEEDS) {
      const {l} = gen(s);
      const g = l.levels[1].grid;
      for (const an of FR.anchors) {
        const a = byLabel(l, own[an.id])!;
        for (let y = an.apron.y; y < an.apron.y + an.apron.h; y++) for (let x = an.apron.x; x < an.apron.x + an.apron.w; x++) {
          const i = g.idx(x, y);
          expect(g.cells[i]).toBe(FLOOR);
          expect(g.area[i], `${s}: ${an.id} ${x},${y}`).toBe(a.id);
          expect(g.blocked[i]).toBe(0);
        }
      }
    }
  });

  it('hazards: the weak decontamination-residue leak on storey 1, nothing else of the storey\'s', () => {
    for (const s of SEEDS) {
      const {l} = gen(s);
      const zs = l.bunker!.gasZones.filter(z => z.level === 1);
      expect(zs.length).toBe(1);
      const g = l.levels[1].grid, decon = byLabel(l, 'Decontamination')!;
      for (const i of zs[0].cells) expect(g.area[i]).toBe(decon.id);
      expect(zs[0].strength).toBeGreaterThanOrEqual(GAS_STRENGTH.weak[0] - 1e-9);
      expect(zs[0].strength).toBeLessThanOrEqual(GAS_STRENGTH.weak[1] + 1e-9);
    }
  });

  it('storey budgets: props, lights, decor, loot holders; no food holders of its own', () => {
    for (const s of SEEDS) {
      const {l} = gen(s);
      const p1 = l.props.filter(p => (p.level ?? 0) === 1);
      expect(p1.length).toBeLessThanOrEqual(180);
      expect(l.lights.filter(q => (q.level ?? 0) === 1).length).toBeLessThanOrEqual(80);
      const holders = p1.filter(p => isLootHolderKind(p.kind));
      expect(holders.length).toBeGreaterThanOrEqual(55);
      expect(holders.length).toBeLessThanOrEqual(90);
      for (const p of p1) expect(['fridge', 'kitchenette', 'vending', 'snackRack', 'shopCooler', 'chestFreezer']).not.toContain(p.kind);
      expect(l.decor.filter(d => d.y0 > FR.base - 0.5 && d.y0 < FR.base + 6.9).length).toBeLessThanOrEqual(150);
    }
  });

  it('is deterministic (the same seed twice: the same storey 1)', () => {
    const snap = (l: StationLayout) => JSON.stringify({
      a: areasOf(l).map(a => [a.label, a.x, a.y, a.w, a.h, a.ceil, a.purpose]),
      p: l.props.filter(p => (p.level ?? 0) === 1).map(p => [p.kind, p.x, p.y, p.z, p.rot]),
      li: l.lights.filter(q => (q.level ?? 0) === 1).map(q => [q.x, q.y, q.z, q.broken]),
    });
    const a = snap(gen(SEEDS[0]).l);
    const b = snap(generateBunkerLevel({levelSeed: SEEDS[0]}));
    expect(b).toBe(a);
  });
});
