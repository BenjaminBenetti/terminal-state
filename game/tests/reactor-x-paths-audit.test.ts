// Task reactor-expansion-20261101 (lane PATHS): THE PATHWAY / COLLISION AUDIT on real generated Reactor layouts (8 seeds, both stair
// walls, single + twin towers) — user feedback "bars going through the stair wells", "the railing is not cut out for ladders", "large
// steel beams often intersect walk ways … a full audit". Pure (no renderer / DOM): world/reactor/pathsAudit.ts + gen/reactor/pathsGen.ts.
import {describe, expect, it} from 'vitest';
import * as THREE from 'three';
import {LEVELS} from '../src/levels/registry';
import {CELL, FLOOR, Grid, PathFinder, SOLID} from '../src/gen/grid';
import {levelsOf, type Level} from '../src/gen/levels';
import {deriveRails} from '../src/gen/levelGen';
import {ladderClimbPath, sampleClimb, CLIMB} from '../src/gen/traversal';
import {reactorIssues} from '../src/gen/reactor/validate';
import {LADDER_OPENING, ladderOpenings, railBase, walkableAt} from '../src/gen/reactor/pathsGen';
import {
  BODY, WalkVolume, auditModels, auditPlan, auditReactorPaths, obbAabbDepth, obbOf, pathAuditSummary, type PathAuditReport, type PathHit,
} from '../src/world/reactor/pathsAudit';
import type {StationLayout} from '../src/gen/stationTypes';
import {testMeshOf} from './reactor-x-paths-meshes';

/** Both stair walls, single + twin tower variants. */
const SEEDS = [9100, 218558, 637474, 1, 42, 777, 31337, 2026110];
const cache = new Map<number, StationLayout>();
const level = (seed: number) => {
  let L = cache.get(seed);
  if (!L) { L = LEVELS.reactor.generate('main', {levelSeed: seed}); cache.set(seed, L); }
  return L;
};

/**
 * Intrusions OWNED BY OTHER LANES of this task, each pinned at its measured worst penetration into the walkway (m, beyond the 0.1 m
 * edge tolerance) so nothing grows unnoticed. The lead drops / tightens an entry once that lane fixes it and the audit is re-run:
 *  - lane CONTROLS (machines placed from footprints): the switchgear sections' door plane sits ON the collider front, so the cabinet
 *    parts in front of it stand up to ~0.26 m past the collider; the console model ~0.24 m and the valve ~0.15 m past theirs;
 *  - lane BUNKER: the blast-door model reaches ~0.29 m past its leaf / frame colliders (the decontamination side); one bunk bed 3 cm;
 *  - (lane MINES fixed its two: the rubble chunks are clamped inside the rubble collider; the timber sets stay inside the drift's rock
 *    walls, their posts are collision boxes and keep off every opening's cells — task reactor-expansion-20261101, lane MINES);
 *  - lane CORE (user point 15): the procedural FALLBACK vessel plinth flares 0.2 m past the vessel's blocked circle (drawn only when the
 *    vessel model fails to load; the model is clear).
 */
const PATHS_OWNED_ELSEWHERE: readonly {re: RegExp; lane: string; max: number}[] = [
  {re: /^sites /, lane: 'CONTROLS', max: 0.2},
  {re: /^generators (bulb\|panelLamp|box\|yellow)$/, lane: 'CONTROLS', max: 0.02}, // the procedural-fallback start panel's lever / lamps: 8 mm
  {re: /^bunker model blastDoor$/, lane: 'BUNKER', max: 0.2},
  {re: /^bunker model bunkBed$/, lane: 'BUNKER', max: 0.04},
  {re: /^merged reactor-vessel/, lane: 'CORE', max: 0.25},
];
const ours = (hits: readonly PathHit[]) => hits.filter(h => !PATHS_OWNED_ELSEWHERE.some(o => o.re.test(h.kind) && h.depth <= o.max));

const reports = new Map<string, PathAuditReport>();
const audit = (seed: number, models: 'all' | 'none', walkAware = true) => {
  const k = `${seed}:${models}:${walkAware}`;
  let r = reports.get(k);
  if (!r) { r = auditReactorPaths(level(seed), {models, walkAware, meshOf: testMeshOf}); reports.set(k, r); }
  return r;
};

describe('Reactor pathway audit (lane PATHS): zero intrusions on real layouts', () => {
  for (const seed of SEEDS) {
    it(`seed ${seed}: no solid, rail or fixture in any walkway, stair run, landing, bridge, ladder climb or stand point (game models)`, () => {
      const L = level(seed), rep = audit(seed, 'all');
      expect(reactorIssues(L), `seed ${seed} validation`).toEqual([]);
      expect(rep.checked.boxes).toBeGreaterThan(15000);
      expect(rep.checked.instances).toBeGreaterThan(3000);
      expect(rep.checked.ladders).toBeGreaterThanOrEqual(5);
      expect(rep.checked.stands).toBeGreaterThan(30);
      const mine = ours(rep.hits);
      expect(mine, pathAuditSummary({...rep, hits: mine})).toEqual([]);
    }, 120_000);
  }

  it('the procedural fallback kit (no delivered model loaded) is clear too', () => {
    for (const seed of SEEDS.slice(0, 4)) {
      const rep = audit(seed, 'none'), mine = ours(rep.hits);
      expect(mine, `seed ${seed}\n${pathAuditSummary({...rep, hits: mine})}`).toEqual([]);
    }
  }, 240_000);

  it('the audit really sees the old faults: the same kit planned WITHOUT the walk volume puts steel in stair runs and walkways', () => {
    for (const seed of SEEDS.slice(0, 3)) {
      const rep = audit(seed, 'all', false);
      const kinds = Object.keys(rep.byKind).join(' | ');
      expect(rep.hits.filter(h => h.ramp).length, `seed ${seed}: steel in the stair runs`).toBeGreaterThan(0);
      expect(kinds, `seed ${seed}`).toMatch(/deck-brace|deck-fascia|wall ribs/);
    }
  }, 240_000);
});

describe('regression: no bars across the stairwells (user: "bars going through the stair wells")', () => {
  it('the aperture rule alone railed every stair-run mouth (the run lead on the lower grid meets the upper deck): those rails are gone', () => {
    for (const seed of SEEDS) {
      const L = level(seed);
      // a rail edge whose far side is a walkable floor at its base height is a seam between storeys, never a drop
      const seams = (rails: readonly {x0: number; z0: number; x1: number; z1: number; y0: number; y1: number; nx: number; nz: number}[]) => {
        let n = 0;
        for (const r of rails) {
          const len = Math.hypot(r.x1 - r.x0, r.z1 - r.z0);
          for (let s = CELL / 2; s < len; s += CELL) {
            const u = s / len, x = r.x0 + (r.x1 - r.x0) * u, z = r.z0 + (r.z1 - r.z0) * u, y = r.y0 + (r.y1 - r.y0) * u;
            if (walkableAt(L, x - r.nx * 0.15, z - r.nz * 0.15, y)) n++;
          }
        }
        return n;
      };
      expect(seams(deriveRails(L.levels)), `seed ${seed}: the aperture rule's mouth rails`).toBeGreaterThan(0);
      expect(seams(L.rails), `seed ${seed}: rails across a mouth`).toBe(0);
      // every stair link's top and bottom: open in the direction of travel (no rail within the body radius on the walking line)
      const Lv = levelsOf(L);
      for (const k of L.levelLinks.filter(q => q.kind === 'stairs')) {
        for (const p of [k.top, k.bottom]) {
          for (const r of Lv.rails) {
            const ex = r.x1 - r.x0, ez = r.z1 - r.z0, L2 = ex * ex + ez * ez || 1, t = Math.max(0, Math.min(1, ((p.x - r.x0) * ex + (p.z - r.z0) * ez) / L2));
            const d = Math.hypot(r.x0 + ex * t - p.x, r.z0 + ez * t - p.z), base = railBase(r, p.x, p.z);
            if (Math.abs(base - p.y) < 0.6) expect(d, `seed ${seed} link ${k.id} rail at the stand point`).toBeGreaterThan(BODY.r - 0.05);
          }
        }
      }
      expect(audit(seed, 'all').hits.filter(h => h.kind === 'rail across a path')).toEqual([]);
    }
  }, 240_000);

  it('no kit solid stands on a stair flight (the pitch-following body volume of every run cell is empty)', () => {
    for (const seed of SEEDS) expect(ours(audit(seed, 'all').hits).filter(h => h.ramp), `seed ${seed}`).toEqual([]);
  }, 240_000);
});

describe('regression: railing cut-outs at the ladders (user: "the railing is not cut out for ladders")', () => {
  it('every maintenance ladder head is a real opening in the collision AND drawn rails; the edge beside it stays railed', () => {
    for (const seed of SEEDS) {
      const L = level(seed), ops = ladderOpenings(L), lads = L.traversal.ladders.filter(l => l.kind === 'maintenance');
      expect(lads.length, `seed ${seed}`).toBeGreaterThanOrEqual(5);
      expect(ops.length).toBe(lads.length);
      const plan = auditPlan(L, auditModels('all'), new WalkVolume(L));
      const railParts = [...plan.parts.values()].flatMap(p => p.list.filter(i => i.tag === 'rails'));
      for (const l of lads) {
        const lv = l.topLevel!;
        const atHead = L.rails.filter(r => r.level === lv && Math.abs(r.z0 - l.faceZ) < 0.05 && Math.abs(r.z1 - l.faceZ) < 0.05 && Math.abs(railBase(r, l.x, l.faceZ) - l.topY) < 0.6);
        // collision: nothing within the opening; railed up to it on both sides (or the deck ends there)
        for (const r of atHead) {
          const xa = Math.min(r.x0, r.x1), xb = Math.max(r.x0, r.x1);
          expect(xb <= l.x - LADDER_OPENING + 1e-3 || xa >= l.x + LADDER_OPENING - 1e-3, `seed ${seed} ladder ${l.id} rail ${xa}..${xb}`).toBe(true);
        }
        expect(atHead.some(r => Math.abs(Math.max(r.x0, r.x1) - (l.x - LADDER_OPENING)) < 0.02) || atHead.some(r => Math.abs(Math.min(r.x0, r.x1) - (l.x + LADDER_OPENING)) < 0.02), `seed ${seed} ladder ${l.id} railed beside the opening`).toBe(true);
        // drawn: no rail member over the opening's middle 0.6 m (the body) at the head
        const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
        for (const inst of railParts) {
          inst.m.decompose(p, q, s);
          if (Math.abs(p.z - l.faceZ) < 0.1 && Math.abs(p.x - l.x) < BODY.r && p.y > l.topY - 0.2 && p.y < l.topY + 1.3) expect.fail(`seed ${seed} ladder ${l.id}: a drawn rail member at the head`);
        }
      }
    }
  }, 240_000);

  it('the climb (player and AI share ladderClimbPath) passes no rail and no solid; both stand points are clear; the AI routes over it', () => {
    for (const seed of SEEDS) {
      const L = level(seed), rep = audit(seed, 'all');
      expect(rep.hits.filter(h => h.source === 'ladder'), `seed ${seed}`).toEqual([]);
      expect(rep.hits.filter(h => /ladder \d+ (foot|head)/.test(h.label)), `seed ${seed}`).toEqual([]);
      const Lv = levelsOf(L), pf = new PathFinder(Lv);
      for (const l of L.traversal.ladders.filter(q => q.kind === 'maintenance')) {
        const link = L.levelLinks.find(k => k.kind === 'ladder' && k.traversalId === l.id);
        expect(link, `seed ${seed} ladder ${l.id} link`).toBeDefined();
        expect(Lv.crossLinks().some(c => c.id === l.id), `seed ${seed} ladder ${l.id} in the AI graph`).toBe(true);
        // an AI path from the head to the foot takes the ladder (waypoint with its link id)
        const path = pf.find(l.top.x, l.top.z, l.bottom.x, l.bottom.z, 0.3, 60000, {ay: l.topY, by: l.bottomY});
        expect(path, `seed ${seed} ladder ${l.id} AI path`).not.toBeNull();
        expect(path!.some(w => w[2] === l.id), `seed ${seed} ladder ${l.id}: the AI climbs it`).toBe(true);
        // the climb clears the head's rails for both speeds (the sweep the audit runs, asserted directly here)
        for (const sp of [CLIMB.player, CLIMB.zombie]) {
          const path3 = ladderClimbPath(l, false, {x: l.top.x, y: l.topY, z: l.top.z}, sp), pt = {x: 0, y: 0, z: 0};
          for (let t = 0; t <= path3.t[path3.t.length - 1]; t += 0.05) {
            sampleClimb(path3, t, pt);
            for (const r of Lv.rails) {
              const ex = r.x1 - r.x0, ez = r.z1 - r.z0, L2 = ex * ex + ez * ez || 1, u = Math.max(0, Math.min(1, ((pt.x - r.x0) * ex + (pt.z - r.z0) * ez) / L2));
              const d = Math.hypot(r.x0 + ex * u - pt.x, r.z0 + ez * u - pt.z), base = r.y0 + (r.y1 - r.y0) * u;
              if (d < 0.25 && base + (r.h ?? 1.1) > pt.y + 0.05 && base < pt.y + 1.8) expect.fail(`seed ${seed} ladder ${l.id}: the climb passes a rail at t ${t.toFixed(2)}`);
            }
          }
        }
      }
    }
  }, 240_000);
});

describe('regression: no steel across the walkways (user: "large steel beams often intersect walk ways")', () => {
  it('a deck record is the deck itself: every cell of every pit deck rect is flat deck of its storey or a reserved column (no run inside)', () => {
    for (const seed of SEEDS) {
      const L = level(seed), r = L.reactor!;
      for (const d of r.decks) {
        const g = L.levels[d.level].grid;
        // (the inline landings between a run's flights are not cell-aligned: sample the rect itself, 5 cm in from its edges)
        for (let z = d.rect.z0 + 0.05; z < d.rect.z1 - 0.04; z += 0.25) for (let x = d.rect.x0 + 0.05; x < d.rect.x1 - 0.04; x += 0.25) {
          const [cx, cy] = g.cellOf(x, z), i = g.idx(cx, cy);
          if (g.cells[i] === SOLID) continue; // a reserved column inside the deck (tower leg, organ bank): no walkway
          if (g.cells[i] !== FLOOR || Math.abs(g.floorAt(x, z) - d.y) > 0.02) expect.fail(`seed ${seed} ${d.kind} deck on level ${d.level}: ${x.toFixed(2)},${z.toFixed(2)} (cell ${cx},${cy}) is not flat deck at ${d.y}`);
        }
      }
    }
  }, 240_000);

  it('deck steel, knee braces, bridge trusses, tower bracing, pilasters, cables and lamps: none in any walkway (they were before)', () => {
    const steel = /^(deck-|bridge-truss|tower|towers|wall ribs|wall-strap|gen-cable|wall lamps|decks|generators)/;
    let before = 0;
    for (const seed of SEEDS) {
      expect(audit(seed, 'all').hits.filter(h => steel.test(h.kind)), `seed ${seed}`).toEqual([]);
      if (seed === SEEDS[0] || seed === SEEDS[2]) before += audit(seed, 'all', false).hits.filter(h => steel.test(h.kind)).length;
    }
    expect(before).toBeGreaterThan(20);
  }, 240_000);

  it('tower faces a walkway crosses are portals (header over the band, bracing only above / below it); towers keep their bracing', () => {
    for (const seed of SEEDS.slice(0, 4)) {
      const L = level(seed), plan = auditPlan(L, auditModels('all'), new WalkVolume(L));
      expect(plan.stats.towers).toBe(L.reactor!.towers.length);
      expect(plan.stats.decksSupported, `seed ${seed}: every deck keeps its steel`).toBe(plan.stats.decks);
      expect(plan.stats.braces, `seed ${seed}: knee braces kept where they clear`).toBeGreaterThan(40);
      expect(plan.stats.towerMembers, `seed ${seed}`).toBeGreaterThan(L.reactor!.towers.length * 40);
      const portals = [...plan.parts.values()].flatMap(p => p.list.filter(i => i.tag === 'tower-portal')).length;
      expect(portals, `seed ${seed}: the core floor round the tower foot + the bridge entries`).toBeGreaterThan(0);
    }
  }, 240_000);

  it('every extraction fan hangs clear of the walkways (its housing never over a deck or a flight)', () => {
    for (const seed of SEEDS) expect(audit(seed, 'all').hits.filter(h => /fan/.test(h.kind)), `seed ${seed}`).toEqual([]);
  }, 240_000);
});

describe('the audit is generic over layout areas (side complexes, rooms): re-run after merging the complexes', () => {
  it('runs on whatever side complexes exist (layout.reactor.complexes): their areas + entrances are clear', () => {
    let complexes = 0;
    for (const seed of SEEDS.slice(0, 4)) {
      const L = level(seed);
      expect(audit(seed, 'all').checked.extras, `seed ${seed}: the complexes' own visuals are audited`).toBeGreaterThan(0);
      for (const c of L.reactor!.complexes ?? []) {
        complexes++;
        const rep = auditReactorPaths(L, {models: 'all', areas: new Set(c.areas), meshOf: testMeshOf});
        expect(rep.checked.boxes, `${c.id}`).toBeGreaterThan(0);
        expect(ours(rep.hits), `seed ${seed} complex ${c.id}\n${pathAuditSummary(rep)}`).toEqual([]);
      }
    }
    expect(complexes).toBeGreaterThan(0);
  }, 240_000);

  it('portal-shaped models are judged by their real triangles (a timber set over a drift, the blast door in its doorway)', () => {
    const L = level(SEEDS[0]);
    const box = auditReactorPaths(L, {models: 'all'}), mesh = audit(SEEDS[0], 'all');
    const sets = (r: PathAuditReport) => r.hits.filter(h => h.kind === 'mines model timberSet' || h.kind === 'bunker model blastDoor').length;
    expect(sets(mesh)).toBeLessThanOrEqual(sets(box));
    const tris = testMeshOf('assets/models/reactor-timber-set.glb');
    expect(tris && tris.length / 9).toBeGreaterThan(1000);
  }, 120_000);

  it('an area-scoped audit sees only its areas (the rooms cut into the rock: doorways vs the pit-wall steel)', () => {
    const L = level(SEEDS[0]);
    const rooms = new Set(L.areas.filter(a => a.role === 'reactor-room').map(a => a.id));
    expect(rooms.size).toBeGreaterThanOrEqual(6);
    const rep = auditReactorPaths(L, {models: 'all', areas: rooms, meshOf: testMeshOf});
    expect(rep.checked.boxes).toBeGreaterThan(500);
    expect(rep.checked.boxes).toBeLessThan(audit(SEEDS[0], 'all').checked.boxes);
    expect(ours(rep.hits), pathAuditSummary(rep)).toEqual([]);
  }, 120_000);
});

describe('the walk volume (unit)', () => {
  /** A 12 x 6-cell corridor (6 x 3 m) at floor 0 on one storey; optional rail along z = 1.5 for x 1..2 m. */
  const corridor = (rails = false): StationLayout => {
    const g = new Grid(16, 8);
    for (let y = 1; y < 7; y++) for (let x = 2; x < 14; x++) { const i = g.idx(x, y); g.cells[i] = FLOOR; g.floor[i] = 0; g.ceil[i] = 4; g.area[i] = 0; }
    const levels: Level[] = [{id: 0, role: 'main', grid: g, baseY: 0}];
    return {grid: g, levels, rails: rails ? [{level: 0, x0: 1, z0: 1.5, x1: 7, z1: 1.5, y0: 0, y1: 0, nx: 0, nz: 1}] : [], areas: [{id: 0, label: 'corridor'}]} as unknown as StationLayout;
  };
  const bar = (x0: number, z0: number, x1: number, z1: number, y: number, w = 0.05) => {
    const m = new THREE.Matrix4().makeBasis(new THREE.Vector3(w, 0, 0), new THREE.Vector3(0, w, 0), new THREE.Vector3(0, 0, 1));
    const len = Math.hypot(x1 - x0, z1 - z0), yaw = Math.atan2(x1 - x0, z1 - z0);
    return new THREE.Matrix4().makeTranslation((x0 + x1) / 2, y, (z0 + z1) / 2).multiply(new THREE.Matrix4().makeRotationY(yaw)).multiply(m.multiply(new THREE.Matrix4().makeScale(1, 1, len)));
  };

  it('catches a thin bar across the walkway at chest height, not one above head height or flush on a wall', () => {
    const vol = new WalkVolume(corridor());
    expect(vol.intrudes(bar(3, 0.5, 3, 3.5, 1.2))).toBe(true); // across the corridor (z 0.5 .. 3.5), 1.2 m up
    expect(vol.intrudes(bar(3, 0.5, 3, 3.5, 2.1))).toBe(false); // over head height (1.9 m)
    expect(vol.intrudes(bar(1.5, 0.53, 6.5, 0.53, 1.2, 0.04))).toBe(false); // 3 cm off the north wall (z 0.5): an edge fixture
    expect(vol.intrudes(bar(1.5, 0.8, 6.5, 0.8, 1.2, 0.04))).toBe(true); // 0.3 m off it: in the walkway
    expect(vol.intrudes(bar(3, 0.5, 3, 3.5, 0.06, 0.1))).toBe(true); // a trip bar on the floor
  });

  it('a railing is a designed edge: members on its line are not intrusions, a rail across the corridor is reported by the audit', () => {
    const vol = new WalkVolume(corridor(true));
    expect(vol.intrudes(bar(1.2, 1.5, 6.8, 1.5, 1.0, 0.05))).toBe(false);
    const vol0 = new WalkVolume(corridor(false));
    expect(vol0.intrudes(bar(1.2, 1.5, 6.8, 1.5, 1.0, 0.05))).toBe(true);
  });

  it('oriented box vs box penetration: apart, touching, overlapping', () => {
    const o = obbOf(new THREE.Matrix4().makeRotationY(Math.PI / 4).setPosition(0, 0, 0), [-0.5, -0.5, -0.5], [0.5, 0.5, 0.5])!;
    expect(obbAabbDepth(o, [1, -1, -1, 2, 1, 1])).toBeLessThanOrEqual(0); // the rotated cube reaches x 0.707
    expect(obbAabbDepth(o, [0.6, -1, -1, 2, 1, 1])).toBeGreaterThan(0.09);
    expect(obbAabbDepth(o, [0.6, -1, -1, 2, 1, 1])).toBeLessThan(0.11);
  });
});
