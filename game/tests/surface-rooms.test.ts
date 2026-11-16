// Task studio-surface-run-opus-rebuild-20261116-020827-01 (lane ROOMS): the Surface Run building interiors (gen/surface/rooms) on
// synthetic GEN-like plots (tests/helpers/surfaceRoomsFixture.ts) — every programme:
//  - plans a valid interior inside its footprint (the facade ring untouched, every room labelled "<building> · <room>");
//  - is CONNECTED: every room of every storey is reachable on foot from the street through the main entrance (stairs included), and
//    every kept entrance opens onto a room;
//  - is its OWN layout: programmes differ in their rooms and their furniture, seeds differ, the same seed plans the same interior;
//  - has upper storeys only where the plot lists them, linked by stair runs carved in both level grids;
//  - furnishes with classified kinds only (openables audit + physics audit), nothing floating / sunk / overlapping, hosted decor on
//    its host, loot holders themed by their rooms (fridges food & drink, the dispensary medicine …);
//  - places its permanent enemies and loose finds on free floor, off doorways; lights in the darker interior mood; windows in the
//    facade ring on exposed walls only.

import {describe, expect, it} from 'vitest';
import {CELL, FLOOR, SOLID} from '../src/gen/grid';
import {PROP_DEFS, type PropPlacement} from '../src/gen/props';
import {OPENABLE_AUDIT} from '../src/world/openablesSpec';
import {PROP_PHYSICS_AUDIT} from '../src/damage/physicsAudit';
import {propPhysics} from '../src/damage/materials';
import {BUNKER_MODEL_KINDS, BUNKER_OBJECTIVE_KINDS} from '../src/gen/bunker/bunkerKinds';
import {CORPSE_DEN_KINDS} from '../src/gen/market/v4/denKinds';
import {createHolderState, isContainerKind, isLootHolderKind, type HolderKind} from '../src/items/loot';
import {holderSurfaces} from '../src/items/lootLayout';
import {HOLDER_SLOTS, econCat, type EconCat} from '../src/items/lootTables';
import {SURFACE_PROGRAMME_IDS, resolveProgramme} from '../src/gen/surface/rooms/programmes';
import type {InteriorPlan} from '../src/gen/surface/rooms/api';
import {areaCells, makePlot, planFixture, programmeCases, reach, type Fixture} from './helpers/surfaceRoomsFixture';

const EPS = 1e-3;
/**
 * Floor-prop penetration (m, the shallower axis) of `a` into `b`, with a dynamic prop's physics body fit (damage/materials.ts propPhysics
 * `fit`): the office physics test's rule — a loose-able prop never starts inside a neighbour deeper than 2 cm (no pop when it wakes); two
 * fixed pieces may share at most the station placement kit's cell inset (gen/placeKit.ts cellsOfBox: 4 cm per side).
 */
const penetration = (a: PropPlacement, b: PropPlacement) => {
  const fa = propPhysics(a.kind).dynamic ? propPhysics(a.kind).fit ?? 1 : 1, fb = propPhysics(b.kind).dynamic ? propPhysics(b.kind).fit ?? 1 : 1;
  const ox = Math.min(a.x + a.hx * fa, b.x + b.hx * fb) - Math.max(a.x - a.hx * fa, b.x - b.hx * fb);
  const oz = Math.min(a.z + a.hz * fa, b.z + b.hz * fb) - Math.max(a.z - a.hz * fa, b.z - b.hz * fb);
  return ox > 0 && oz > 0 ? Math.min(ox, oz) : 0;
};
const DYNAMIC_PEN = 0.02, FIXED_PEN = 0.081;
const SEEDS = [11, 2026];

interface Case { f: Fixture; plan: InteriorPlan; tag: string; ms: number }
const CACHE = new Map<string, Case[]>();
function cases(programme: string): Case[] {
  let c = CACHE.get(programme);
  if (!c) {
    c = [];
    for (const seed of SEEDS) for (const o of programmeCases(programme, seed)) {
      const f = makePlot(o);
      const t0 = performance.now(), plan = planFixture(f), ms = performance.now() - t0;
      c.push({f, plan, ms, tag: `${programme} seed ${seed} ${o.frontage}x${o.depth} ${o.storeys.length}st front ${o.front}`});
    }
    CACHE.set(programme, c);
  }
  return c;
}
const ALL = () => SURFACE_PROGRAMME_IDS.flatMap(p => cases(p));
const roomLabel = (s: string) => s.replace(/^Halsey Test · /, '');

describe('Surface Run interiors: every programme plans a valid connected interior', () => {
  it('rooms fill the footprint inside the facade ring, labelled, on the storeys the plot lists', () => {
    for (const {f, plan, tag} of ALL()) {
      const {kit, rect} = f;
      expect(plan.areas.length, tag).toBeGreaterThanOrEqual(f.opts.storeys.length > 1 ? 4 : 2);
      const levels = new Set(f.plot.floors.map(q => q.level));
      for (const id of plan.areas) {
        const a = kit.areas[id];
        expect(a.label.startsWith('Halsey Test · '), `${tag}: ${a.label}`).toBe(true);
        expect(levels.has(a.level ?? 0), `${tag}: ${a.label} level`).toBe(true);
        expect(a.x >= rect.x + 1 && a.y >= rect.y + 1 && a.x + a.w <= rect.x + rect.w - 1 && a.y + a.h <= rect.y + rect.h - 1, `${tag}: ${a.label} inside the ring`).toBe(true);
        expect(areaCells(kit.grid(a.level ?? 0), a).length, `${tag}: ${a.label} cells`).toBeGreaterThan(0);
      }
      // the facade ring stays SOLID on every storey except the doorways GEN carved
      const doorCells = new Set(plan.entrances.flatMap(e => e.cells));
      for (const g of kit.levelGrids) for (let x = rect.x; x < rect.x + rect.w; x++) for (const y of [rect.y, rect.y + rect.h - 1]) {
        const i = g.idx(x, y);
        if (g !== kit.g || !doorCells.has(i)) expect(g.cells[i], `${tag}: ring ${x},${y}`).toBe(SOLID);
      }
      // the street storey's floor is the plot's (the kerb), upper storeys their own
      for (const id of plan.areas) {
        const a = kit.areas[id];
        if (a.type === 'stair-core' && /–/.test(a.label)) continue;
        const g = kit.grid(a.level ?? 0), fl = f.plot.floors.find(q => q.level === (a.level ?? 0))!;
        for (const i of areaCells(g, a)) if (g.rampIdx[i] < 0) expect(Math.abs(g.floorOf(i) - fl.y), `${tag}: ${a.label} floor`).toBeLessThan(0.01);
      }
    }
  });

  it('every room of every storey is reachable from the street; every kept entrance opens onto a room', () => {
    for (const c of ALL()) {
      const {f, plan, tag} = c;
      const main = plan.entrances.find(e => f.plot.entrances.some(p => p.main && p.cells.some(q => e.cells.includes(f.kit.g.idx(q.x, q.y)))));
      expect(main, `${tag}: main entrance kept`).toBeTruthy();
      const {dist} = reach(f, plan);
      for (const id of plan.areas) {
        const a = f.kit.areas[id], lv = a.level ?? 0, g = f.kit.grid(lv);
        const reached = areaCells(g, a).some(i => dist[lv][i] >= 0);
        expect(reached, `${tag}: ${a.label} (level ${lv}) reachable`).toBe(true);
      }
      for (const e of plan.entrances) {
        const r = f.kit.areas[e.inner];
        expect(plan.areas.includes(e.inner) && r.type !== 'stair-core', `${tag}: entrance ${e.id} -> ${r?.label}`).toBe(true);
        expect(e.cells.every(i => dist[0][i] >= 0), `${tag}: entrance ${e.id} walkable`).toBe(true);
      }
      // upper storeys exist only where the plot lists them; each one is linked to the one below by a stair run in both grids
      const lv = new Set(plan.areas.map(id => f.kit.areas[id].level ?? 0));
      for (const l of lv) expect(l < f.opts.storeys.length, tag).toBe(true);
      for (const l of lv) if (l > 0) expect(plan.links.some(k => k.upper === l && k.kind === 'stairs'), `${tag}: link to level ${l}`).toBe(true);
      for (const k of plan.links) {
        const fl = f.kit.flights[k.traversalId!];
        expect(fl, tag).toBeTruthy();
        const lo = f.kit.grid(k.lower), hi = f.kit.grid(k.upper), [cx, cy] = lo.cellOf(fl.bottom.x, fl.bottom.z);
        void cx; void cy;
        expect(lo.ramps === hi.ramps && lo.rampIdx.some(r => r === fl.ramp) && hi.rampIdx.some(r => r === fl.ramp), `${tag}: ramp in both grids`).toBe(true);
      }
    }
  }, 120_000);

  it('a programme only plans upper storeys where they fit (a narrow store keeps its street storey) and never fails on a small plot', () => {
    for (const programme of SURFACE_PROGRAMME_IDS) {
      const f = makePlot({programme, frontage: 22, depth: 20, storeys: [4.4, 3.4], seed: 5});
      const plan = planFixture(f);
      expect(plan.areas.length, programme).toBeGreaterThan(0);
      expect(plan.entrances.length, programme).toBeGreaterThan(0);
      const {dist} = reach(f, plan);
      for (const id of plan.areas) {
        const a = f.kit.areas[id], g = f.kit.grid(a.level ?? 0);
        expect(areaCells(g, a).some(i => dist[a.level ?? 0][i] >= 0), `${programme}: ${a.label}`).toBe(true);
      }
    }
    // an unknown programme id resolves by its building kind; a fully unknown one still plans a plain room
    expect(resolveProgramme('office-tower', 'office')).toBe('office-block');
    expect(resolveProgramme('mystery', 'store')).toBe('convenience');
    const odd = makePlot({programme: 'mystery', kind: 'residential', frontage: 30, depth: 30, storeys: [4.0], seed: 3});
    expect(planFixture(odd).areas.length).toBeGreaterThan(0);
  });
});

describe('Surface Run interiors: distinct layouts, deterministic', () => {
  const signature = (c: Case) => {
    const rooms = c.plan.areas.map(id => roomLabel(c.f.kit.areas[id].label).replace(/ \d+$/, '')).filter(l => !l.startsWith('Stairs'));
    const kinds = new Map<string, number>();
    for (const p of c.plan.props) kinds.set(p.kind, (kinds.get(p.kind) ?? 0) + 1);
    return {rooms: new Set(rooms), kinds};
  };
  it('no two programmes plan the same box: their room programmes and furniture differ', () => {
    const sig = SURFACE_PROGRAMME_IDS.map(p => ({p, s: signature(cases(p).at(-1)!)}));
    for (let i = 0; i < sig.length; i++) for (let j = i + 1; j < sig.length; j++) {
      const A = sig[i].s, B = sig[j].s;
      const sameRooms = A.rooms.size === B.rooms.size && [...A.rooms].every(r => B.rooms.has(r));
      const ka = new Set(A.kinds.keys()), kb = new Set(B.kinds.keys());
      const inter = [...ka].filter(k => kb.has(k)).length, uni = new Set([...ka, ...kb]).size;
      const jac = inter / Math.max(1, uni);
      expect(!sameRooms || jac < 0.75, `${sig[i].p} vs ${sig[j].p}: rooms ${[...A.rooms].join('/')} kinds jaccard ${jac.toFixed(2)}`).toBe(true);
    }
    // and every programme has a back of house: rooms beyond its front-of-house floor
    for (const {p, s} of sig) expect(s.rooms.size, `${p}: ${[...s.rooms].join(', ')}`).toBeGreaterThanOrEqual(4);
  });

  it('seeds differ; the same seed plans the identical interior', () => {
    for (const programme of SURFACE_PROGRAMME_IDS) {
      const o = programmeCases(programme, 11).at(-1)!;
      const a = planFixture(makePlot(o)), b = planFixture(makePlot(o));
      expect(JSON.stringify(b), programme).toBe(JSON.stringify(a));
      const c = planFixture(makePlot({...o, seed: 12}));
      expect(JSON.stringify(c.props.map(p => [p.kind, p.x, p.z])) === JSON.stringify(a.props.map(p => [p.kind, p.x, p.z])), `${programme}: seed 12 vs 11`).toBe(false);
    }
  });
});

describe('Surface Run interiors: props, holders, enemies, finds, lights, windows', () => {
  it('every kind is classified (openables audit + physics audit) and exists', () => {
    const open = new Set(OPENABLE_AUDIT.map(r => r.kind));
    const used = new Set(ALL().flatMap(c => c.plan.props.map(p => p.kind)));
    // the district's asset family ('surface': mall-* / reactor-* / skyways-* / shared files) never loads the Bunker's or the Market's own models
    const foreign = new Set<string>([...BUNKER_MODEL_KINDS, ...BUNKER_OBJECTIVE_KINDS, ...CORPSE_DEN_KINDS]);
    for (const k of used) {
      expect(PROP_DEFS[k], k).toBeTruthy();
      expect(open.has(k), `${k} in OPENABLE_AUDIT`).toBe(true);
      expect(PROP_PHYSICS_AUDIT[k], `${k} in PROP_PHYSICS_AUDIT`).toBeTruthy();
      expect(foreign.has(k), `${k}: a Bunker / Market model`).toBe(false);
    }
  });

  it('nothing floats, sinks or overlaps; hosted decor sits on its host; every prop stays in its room', () => {
    for (const {f, plan, tag} of ALL()) {
      const floor: PropPlacement[] = [];
      for (const p of plan.props) {
        const a = f.kit.areas[p.area];
        expect(plan.areas.includes(p.area), `${tag}: ${p.kind} area`).toBe(true);
        expect(p.level ?? 0, `${tag}: ${p.kind} level`).toBe(a.level ?? 0);
        const g = f.kit.grid(p.level ?? 0), [cx, cy] = g.cellOf(p.x, p.z), i = g.idx(cx, cy);
        if (p.host !== undefined) {
          const h = plan.props[p.host];
          expect(h, `${tag}: ${p.kind} host`).toBeTruthy();
          expect(p.y, `${tag}: ${p.kind} on ${h.kind}`).toBeGreaterThanOrEqual(h.y - EPS);
          continue;
        }
        expect(g.cells[i], `${tag}: ${p.kind} on floor`).toBe(FLOOR);
        if (p.mounted) { expect(p.y, `${tag}: mounted ${p.kind}`).toBeGreaterThan(g.floorOf(i)); continue; }
        expect(Math.abs(p.y - g.floorOf(i)), `${tag}: ${p.kind} at y ${p.y} vs floor ${g.floorOf(i)}`).toBeLessThan(0.002);
        floor.push(p);
      }
      const bad: string[] = [];
      for (let x = 0; x < floor.length; x++) for (let y = x + 1; y < floor.length; y++) {
        const p = floor[x], q = floor[y];
        if ((p.level ?? 0) !== (q.level ?? 0) || Math.abs(p.x - q.x) >= p.hx + q.hx || Math.abs(p.z - q.z) >= p.hz + q.hz) continue;
        const lim = propPhysics(p.kind).dynamic || propPhysics(q.kind).dynamic ? DYNAMIC_PEN : FIXED_PEN;
        const pen = penetration(p, q);
        if (pen >= lim) bad.push(`${p.kind} x ${q.kind} at ${p.x},${p.z} / ${q.x},${q.z} (level ${p.level ?? 0}): ${pen.toFixed(3)} m`);
      }
      expect(bad, `${tag}: overlapping floor pieces`).toEqual([]);
    }
  }, 120_000);

  it('loot holders are themed by their room: fridges food & drink, dispensaries medicine, the depot salvage, no stray ammo', () => {
    const cats = (c: Case, pred: (p: PropPlacement) => boolean) => {
      const out = new Map<EconCat | 'other', number>();
      let ci = 0, si = 0;
      for (const p of c.plan.props) {
        if (!isLootHolderKind(p.kind)) continue;
        const k = p.kind as HolderKind, a = c.f.kit.areas[p.area];
        const st = createHolderState(1234, isContainerKind(k) ? ci++ : si++, k, p.purpose ?? a.purpose ?? a.type, holderSurfaces(k, PROP_DEFS[k]));
        if (!pred(p)) continue;
        // LOTS (finds), not item counts: one ammo lot of 12 rounds is one find, like one can of beans
        for (const l of st.lots) { const e = econCat(l.itemId) ?? 'other'; out.set(e, (out.get(e) ?? 0) + 1); }
      }
      return out;
    };
    const total = (m: Map<string, number>) => [...m.values()].reduce((s, v) => s + v, 0);
    for (const c of ALL()) {
      // every holder's room has a purpose (the loot key) and fridges / coolers carry only food & drink
      for (const p of c.plan.props) if (isLootHolderKind(p.kind)) expect(c.f.kit.areas[p.area].purpose, `${c.tag}: ${p.kind} room purpose`).toBeTruthy();
      const cold = cats(c, p => p.kind === 'fridge' || p.kind === 'shopCooler' || p.kind === 'chestFreezer');
      for (const [k] of cold) expect(['food', 'drink'], `${c.tag}: ${k} in a fridge`).toContain(k);
    }
    // programme themes over all their cases
    const share = (programme: string, cat: EconCat, pred: (p: PropPlacement, c: Case) => boolean = () => true) => {
      let n = 0, all = 0;
      for (const c of cases(programme)) { const m = cats(c, p => pred(p, c)); n += m.get(cat) ?? 0; all += total(m); }
      return all ? n / all : 0;
    };
    const workshop = (p: PropPlacement, c: Case) => (p.purpose ?? c.f.kit.areas[p.area].purpose) === 'workshop';
    expect(share('pharmacy', 'med'), 'pharmacy medicine').toBeGreaterThan(0.35);
    expect(share('clinic', 'med'), 'clinic medicine').toBeGreaterThan(0.35);
    for (const p of ['grocery', 'convenience', 'diner', 'cafe']) expect(share(p, 'food') + share(p, 'drink'), `${p}: food & drink`).toBeGreaterThan(0.45);
    // the depot's workshop holders carry the station workshop's scrap / wiring salvage (the base salvage rule), more than the shops
    expect(share('rail-depot', 'material', workshop), 'depot workshop salvage').toBeGreaterThan(0.1);
    for (const p of ['grocery', 'clothing', 'cafe', 'diner', 'convenience']) expect(share('rail-depot', 'material'), `depot vs ${p} salvage`).toBeGreaterThan(share(p, 'material'));
    // ARMS holders (gun lockers / racks / safes: the 'arms' slot) only where a programme deliberately has an armoury, or by the Mall's
    // existing rules for the room they stand in (gen/mall/shopsDress.ts dressBack's stock-room extras: the outfitter's rifle safe, the
    // jeweller's vault, the gun shop's stock room; the security office's gun locker)
    const ARMS = new Set(['gunstore', 'sporting-goods', 'police']);
    const armsRoom = (purpose: string) => purpose === 'mall-security' || /^mall-[a-z-]+-back$/.test(purpose);
    for (const programme of SURFACE_PROGRAMME_IDS) for (const c of cases(programme)) for (const p of c.plan.props) {
      if (!isLootHolderKind(p.kind) || HOLDER_SLOTS[p.kind as HolderKind] !== 'arms') continue;
      const purpose = p.purpose ?? c.f.kit.areas[p.area].purpose ?? '';
      expect(ARMS.has(programme) || armsRoom(purpose), `${c.tag}: ${p.kind} in ${purpose}`).toBe(true);
    }
    // the armouries are where the ammo is; elsewhere only the station back rooms' existing generic rows (lockers, crates, cabinets)
    for (const programme of ['grocery', 'clothing', 'bookstore', 'cafe', 'diner', 'office-block', 'clinic', 'convenience', 'pharmacy', 'liquor', 'strip-centre', 'arcade']) {
      expect(share(programme, 'ammo'), `${programme}: ammo share`).toBeLessThan(Math.min(0.35, share('gunstore', 'ammo') / 2));
    }
    expect(share('gunstore', 'ammo'), 'the gun store is the ammo shop').toBeGreaterThan(0.5);
  }, 120_000);

  it('interior enemies and loose finds stand on free floor of the plan, off doorways and stairs', () => {
    for (const {f, plan, tag} of ALL()) {
      expect(plan.zombies.length, `${tag}: enemies`).toBeGreaterThan(0);
      for (const z of [...plan.zombies, ...plan.pickups]) {
        const lv = z.level ?? 0, g = f.kit.grid(lv), [cx, cy] = g.cellOf(z.x, z.z), i = g.idx(cx, cy);
        expect(g.walkable(cx, cy), `${tag}: at ${z.x},${z.z}`).toBe(true);
        expect(g.rampIdx[i], tag).toBe(-1);
        expect(plan.areas.includes(g.area[i]), `${tag}: in the plan`).toBe(true);
        expect(Math.abs((z.y ?? 0) - g.floorOf(i)), `${tag}: y`).toBeLessThan(0.01);
        for (const d of f.kit.doors) if (d.level === (lv || undefined) && plan.areas.includes(d.b)) {
          const inside = cx >= d.x && cx < d.x + d.w && cy >= d.y && cy < d.y + d.h;
          expect(inside, `${tag}: in a doorway`).toBe(false);
        }
      }
      // permanent ordinary zombies (layout spawns): sensible per-programme counts
      expect(plan.zombies.length, tag).toBeLessThanOrEqual(20);
    }
  });

  it('lights: the darker mood (most fixtures dim / broken), daylight behind the windows; windows in the facade ring', () => {
    let lit = 0, all = 0;
    for (const {f, plan, tag} of ALL()) {
      for (const l of plan.lights) {
        expect(plan.areas.includes(l.area), tag).toBe(true);
        const a = f.kit.areas[l.area];
        expect(l.y, `${tag}: light under its ceiling`).toBeLessThanOrEqual(a.ceil + EPS);
        if (l.virtual) continue;
        all++;
        if (!l.broken && l.power >= 0.9) lit++;
      }
      for (const w of plan.windows) {
        const r = f.rect;
        const onRing = w.side === 'N' ? Math.abs(w.z0 - r.y * CELL) < EPS : w.side === 'S' ? Math.abs(w.z1 - (r.y + r.h) * CELL) < EPS
          : w.side === 'W' ? Math.abs(w.x0 - r.x * CELL) < EPS : Math.abs(w.x1 - (r.x + r.w) * CELL) < EPS;
        expect(onRing, `${tag}: window ${w.id} in the ring`).toBe(true);
        expect(w.head, tag).toBeGreaterThan(w.sill);
        expect(w.panes.length, tag).toBeGreaterThan(0);
        expect(plan.areas.includes(w.room), tag).toBe(true);
      }
      expect(plan.windows.length, `${tag}: windows`).toBeGreaterThan(0);
    }
    expect(lit / Math.max(1, all), 'share of fully lit fixtures').toBeLessThan(0.1);
  });

  it('planning cost per programme (reported, not a budget: GEN plans every enterable building of a district)', () => {
    const rows = SURFACE_PROGRAMME_IDS.map(p => {
      const cs = cases(p);
      return `${p} ${(cs.reduce((s, c) => s + c.ms, 0) / cs.length).toFixed(0)} ms / ${(cs.reduce((s, c) => s + c.plan.props.length, 0) / cs.length).toFixed(0)} props`;
    });
    console.info(`[surface-rooms] mean plan time: ${rows.join('; ')}`);
    expect(rows.length).toBe(SURFACE_PROGRAMME_IDS.length);
  });

  it('an intact building is sealed (no broken panes); a gutted one has broken / boarded panes', () => {
    for (const programme of ['grocery', 'office-block', 'strip-centre']) {
      const o = programmeCases(programme, 11)[0];
      const intact = planFixture(makePlot({...o, condition: 'intact'}));
      expect(intact.windows.every(w => w.panes.every(p => p === 'intact' || p === 'cracked')), programme).toBe(true);
      const gutted = planFixture(makePlot({...o, condition: 'gutted'}));
      expect(gutted.windows.some(w => w.panes.some(p => p === 'broken' || p === 'boarded')), programme).toBe(true);
    }
  });
});
