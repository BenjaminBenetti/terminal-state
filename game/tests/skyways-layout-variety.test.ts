// Task studio-skyways-layout-variety-20261106-054448-01: the Skyways LAYOUT VARIETY pass — the frame varies its structure (families of
// block grids with empty lots, bridge topologies, per-building floor plans, pedways, programmes, the add-on's storey / approach /
// host) and every variation stays COHERENT: each building climbs by its own stairs, every bridge opens into both its buildings, every
// pedway ends in a stair well inside its building, the add-on stays on its one-bridge branch (a street-level ballroom is double height
// with nothing carved above it; a foyer joins the lobby to the hall), the food court is lined with counters and seated.
import {describe, expect, it} from 'vitest';
import {LEVELS} from '../src/levels/registry';
import type {StationLayout} from '../src/gen/stationTypes';
import {skywaysIssues} from '../src/gen/skyways/validate';
import {skywaysAddonLevelOf, skywaysAddonOf, skywaysFrame} from '../src/gen/skyways/frame';
import type {SkywaysRect} from '../src/gen/skyways/skywaysTypes';
import {CELL, FLOOR} from '../src/gen/grid';

const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const cache = new Map<number, StationLayout>();
const gen = (s: number): StationLayout => { let l = cache.get(s); if (!l) cache.set(s, (l = LEVELS.skyways.generate('main', {levelSeed: s, startWeapon: 'pistol'}))); return l; };
const inside = (r: SkywaysRect, x: number, z: number, pad = 0) => x >= r.x0 - pad && x <= r.x1 + pad && z >= r.z0 - pad && z <= r.z1 + pad;
const centre = (l: StationLayout, id: number): [number, number] => { const a = l.areas[id]; return [(a.x + a.w / 2) * CELL, (a.y + a.h / 2) * CELL]; };

describe('Skyways layout variety: the frame', () => {
  it('varies the structure over the seeds: every family, plan, topology, pedway count and add-on storey / approach occurs', () => {
    const fam = new Map<string, number>(), plans = new Set<string>(), topo = new Set<string>(), peds = new Set<number>(), conv = new Set<number>(), appr = new Set<string>();
    let nonCorner = 0, fc = 0;
    const N = 400;
    for (let s = 0; s < N; s++) {
      const f = skywaysFrame(s);
      fam.set(f.family, (fam.get(f.family) ?? 0) + 1);
      for (const b of f.buildings) plans.add(b.plan);
      topo.add(f.topology);
      peds.add(f.lowerLinks.length);
      appr.add(f.addonApproach);
      if (f.foodCourt) fc++;
      if (f.addon === 'convention') conv.add(f.addonLevel); else expect(f.addonLevel).toBe(2); // the car drives the skyway level
      const host = f.buildings.find(b => b.id === f.addonHost)!;
      if (!((host.col === 0 || host.col === f.cols - 1) && (host.row === 0 || host.row === f.rows - 1))) nonCorner++;
      // the localized branch: exactly ONE bridge to the host; the rest of the network connected without it
      expect(f.bridges.filter(e => e.a === host.id || e.b === host.id).length).toBe(1);
      expect(f.buildings.length).toBeGreaterThanOrEqual(4);
      expect(f.buildings.length).toBeLessThanOrEqual(6);
      expect(f.bridges.length).toBeGreaterThanOrEqual(f.buildings.length - 1);
      // the add-on and its storey never move with a retry
      expect(skywaysFrame(s, 5).addon).toBe(f.addon);
      expect(skywaysFrame(s, 5).addonLevel).toBe(f.addonLevel);
      expect(f.addonLevel).toBe(skywaysAddonLevelOf(s, skywaysAddonOf(s)));
    }
    expect([...fam.keys()].sort()).toEqual(['block-2x2', 'block-2x3', 'block-3x2', 'chain-4x2', 'cluster-3x3']);
    for (const n of fam.values()) expect(n / N).toBeGreaterThan(0.05);
    expect([...plans].sort()).toEqual(['court', 'cross', 'galleria', 'offset']);
    expect([...topo].sort()).toEqual(['looped', 'tree']);
    expect([...peds].sort()).toEqual([0, 1, 2]);
    expect([...conv].sort()).toEqual([1, 2]);
    expect([...appr].sort()).toEqual(['direct', 'foyer']);
    expect(nonCorner).toBeGreaterThan(N * 0.1); // arm ends of L / T / chain networks, not only grid corners
    expect(fc / N).toBeGreaterThan(0.6);
  });
});

describe('Skyways layout variety: generated layouts stay coherent', () => {
  it('validate, and the carved variety occurs over the sample (plans, pedways, foyers, a street-level ballroom, food courts)', () => {
    const plans = new Set<string>(), placements = new Set<string>(), fams = new Set<string>();
    let pedways = 0, foodCourts = 0;
    for (const s of SEEDS) {
      const l = gen(s), info = l.skyways!;
      expect(skywaysIssues(l), `seed ${s}`).toEqual([]);
      for (const b of info.buildings) plans.add(b.plan!);
      placements.add(`${info.addon.id}@${info.addon.level}/${info.addon.approach}`);
      fams.add(info.family!);
      pedways += info.pedways?.length ?? 0;
      if (info.buildings.some(b => b.foodCourt)) foodCourts++;
    }
    expect([...plans].sort()).toEqual(['court', 'cross', 'galleria', 'offset']);
    expect(fams.size).toBeGreaterThanOrEqual(3);
    expect(placements.size).toBeGreaterThanOrEqual(4);
    expect([...placements].some(p => p.startsWith('convention@1'))).toBe(true);
    expect([...placements].some(p => p.endsWith('/foyer'))).toBe(true);
    expect(pedways).toBeGreaterThan(0);
    expect(foodCourts).toBeGreaterThan(0);
  });

  it('every building climbs by its own stairs; every bridge opens into both of its buildings; every pedway ends in a stair inside its building', () => {
    for (const s of SEEDS) {
      const l = gen(s), info = l.skyways!;
      for (const b of info.buildings) {
        const ups = l.levelLinks.filter(k => k.lower === 1 && k.upper === 2 && k.kind === 'stairs' && inside(b.rect, k.top.x, k.top.z));
        expect(ups.length, `seed ${s} ${b.id} (${b.plan}): a street -> skyway stair of its own`).toBeGreaterThan(0);
      }
      for (const br of info.bridges) {
        const doors = l.doors.filter(d => d.a === br.area || d.b === br.area);
        const ends = new Set(doors.map(d => {
          const [x, z] = centre(l, d.a === br.area ? d.b : d.a);
          return info.buildings.find(b => inside(b.rect, x, z))?.id;
        }));
        expect([...ends].sort(), `seed ${s} bridge ${br.id}`).toEqual([br.a, br.b].sort());
      }
      for (const id of info.pedways ?? []) {
        const b = info.buildings.find(q => q.id === id)!;
        expect(l.levelLinks.some(k => k.lower === 0 && k.upper === 1 && inside(b.rect, k.top.x, k.top.z)), `seed ${s}: the pedway stair up into ${id}`).toBe(true);
        expect(l.areas.some(a => a.role === 'transfer' && a.label === `Pedway to ${b.name}`), `seed ${s}: the pedway to ${b.name}`).toBe(true);
      }
      // the station transit well rises inside the station building
      const st = info.buildings.find(b => b.role === 'station')!;
      expect(l.levelLinks.some(k => k.lower === 0 && k.upper === 1 && inside(st.rect, k.top.x, k.top.z))).toBe(true);
    }
  });

  it('the ONE add-on stays on its host (a one-bridge branch): a ballroom is double height with nothing above it, a foyer joins the lobby to the hall', () => {
    for (const s of SEEDS) {
      const l = gen(s), info = l.skyways!, ad = info.addon;
      const host = info.buildings.find(b => b.id === ad.building)!;
      expect(info.bridges.filter(b => b.a === host.id || b.b === host.id).length).toBe(1);
      for (const id of ad.areas) { const [x, z] = centre(l, id); expect(inside(host.rect, x, z), `seed ${s}: add-on area ${l.areas[id].label} on its host`).toBe(true); }
      const hall = l.areas[ad.areas[0]];
      expect(hall.level ?? 0).toBe(ad.level);
      if (ad.id === 'convention' && ad.level === 1) {
        expect(hall.label).toBe('Ballroom');
        expect(hall.ceil).toBeGreaterThan(l.levels[2].baseY + 0.4); // double height: up through the skyway storey
        const g2 = l.levels[2].grid;
        for (let y = hall.y - 1; y < hall.y + hall.h + 1; y++) for (let x = hall.x - 1; x < hall.x + hall.w + 1; x++) expect(g2.cells[g2.idx(x, y)], `seed ${s}: nothing carved above the ballroom`).not.toBe(FLOOR);
      }
      if (ad.approach === 'foyer') {
        const foyer = ad.areas.map(id => l.areas[id]).find(a => a.id !== hall.id && a.kind === 'concourse')!;
        expect(foyer, `seed ${s}: the foyer`).toBeTruthy();
        expect(l.doors.some(d => (d.a === hall.id && d.b === foyer.id) || (d.b === hall.id && d.a === foyer.id)), `seed ${s}: hall <-> foyer door`).toBe(true);
        // open (no wall) onto a lobby area of the host that is not the add-on's
        const g = l.levels[ad.level].grid, own = new Set(ad.areas);
        let opens = false;
        for (let y = foyer.y - 1; y <= foyer.y + foyer.h && !opens; y++) for (let x = foyer.x - 1; x <= foyer.x + foyer.w; x++) {
          const i = g.idx(x, y);
          if (g.cells[i] === FLOOR && !own.has(g.area[i]) && l.areas[g.area[i]]?.publicSpace) { opens = true; break; }
        }
        expect(opens, `seed ${s}: the foyer opens onto the lobby`).toBe(true);
      }
      if (ad.id === 'prize-car') expect(ad.car!.level).toBe(2);
    }
  });

  it('the food court: a court lined with food counters and seated with café sets', () => {
    let n = 0;
    for (const s of SEEDS) {
      const l = gen(s);
      for (const b of l.skyways!.buildings) {
        if (!b.foodCourt) continue;
        n++;
        const a = l.areas[b.foodCourt.area];
        expect(a.label.startsWith('Food court')).toBe(true);
        expect(a.level ?? 0).toBe(b.foodCourt.level);
        expect(l.storefronts.filter(sf => sf.hall === a.id && sf.food).length, `seed ${s}: counters round the court`).toBeGreaterThanOrEqual(3);
        expect(l.props.filter(p => p.area === a.id && p.kind === 'foodCourtTableSet').length, `seed ${s}: seating`).toBeGreaterThanOrEqual(2);
      }
    }
    expect(n).toBeGreaterThan(0);
  });
});
