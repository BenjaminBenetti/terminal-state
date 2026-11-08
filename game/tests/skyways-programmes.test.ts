// Task studio-skywalk-variety-20261107-231448-01 (user: "Overall layout is still very samy, most buildings have a stair way down, and a
// down stairs area, which is usually small shops with one big shop … We need each building to have a real distinct architectural feel,
// and different layouts, and a little more open. Every time you cross a bridge it should feel like an adventure."): the layout
// version 4 building PROGRAMMES (gen/skyways/skywaysTypes.ts SkywaysProgramme, frame.ts / carve.ts) on real seeds:
//  - variety: every map mixes programmes, most bridges join two different ones, all four occur;
//  - a BRIDGE HOUSE (gallery): the bridge level only — no street floor, no run — a promenade with lookouts over the streets;
//  - a MARKET HALL (hall): one tall hall open from its floor to the glass (an opening over most of it), counters round its floor;
//  - an office TOWER LOBBY (tower): a free-standing GRAND STAIR in the middle of the lobby (floor on all four sides of it), a tall shell;
//  - every map validates.
import {describe, expect, it} from 'vitest';
import {LEVELS} from '../src/levels/registry';
import type {StationLayout} from '../src/gen/stationTypes';
import {CELL, FLOOR} from '../src/gen/grid';
import {skywaysIssues} from '../src/gen/skyways/validate';
import type {SkywaysProgramme} from '../src/gen/skyways/skywaysTypes';

const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const cache = new Map<number, StationLayout>();
const gen = (s: number): StationLayout => { let l = cache.get(s); if (!l) cache.set(s, (l = LEVELS.skyways.generate('main', {levelSeed: s, startWeapon: 'pistol'} as never) as StationLayout)); return l; };
const inside = (r: {x0: number; z0: number; x1: number; z1: number}, x: number, z: number, pad = 0) => x >= r.x0 - pad && x <= r.x1 + pad && z >= r.z0 - pad && z <= r.z1 + pad;
const areaCentre = (a: {x: number; y: number; w: number; h: number}) => ({x: (a.x + a.w / 2) * CELL, z: (a.y + a.h / 2) * CELL});

describe('Skyways layout version 4: building programmes', () => {
  it('variety: every map mixes programmes, most bridges change the programme, all four occur over the seeds; every map validates', () => {
    const seen = new Set<SkywaysProgramme>();
    let bridges = 0, changes = 0;
    for (const s of SEEDS) {
      const l = gen(s), info = l.skyways!;
      expect(skywaysIssues(l), `seed ${s}`).toEqual([]);
      const prog = new Map(info.buildings.map(b => [b.id, b.programme ?? 'classic']));
      for (const p of prog.values()) seen.add(p);
      if (info.buildings.length >= 4) expect(new Set(prog.values()).size, `seed ${s}: ${[...prog.values()].join(' ')}`).toBeGreaterThanOrEqual(3);
      for (const br of info.bridges) { bridges++; if (prog.get(br.a) !== prog.get(br.b)) changes++; }
    }
    expect([...seen].sort()).toEqual(['classic', 'gallery', 'hall', 'tower']);
    expect(changes / bridges, `${changes}/${bridges} bridges join two different programmes`).toBeGreaterThanOrEqual(0.7);
  });

  it('a bridge house: the bridge level only (no street floor, no run), a promenade, lookouts over the streets', () => {
    let n = 0;
    for (const s of SEEDS) {
      const l = gen(s), info = l.skyways!;
      for (const b of info.buildings.filter(q => q.programme === 'gallery')) {
        n++;
        expect(b.levels, `seed ${s} ${b.id}`).toEqual([2]);
        // nothing public on its street floor, no run up into it
        const street = l.areas.filter(a => (a.level ?? 0) === 1 && a.publicSpace && inside(b.rect, areaCentre(a).x, areaCentre(a).z));
        expect(street.map(a => a.label), `seed ${s} ${b.id}`).toEqual([]);
        expect(l.levelLinks.some(k => inside(b.rect, k.top.x, k.top.z)), `seed ${s} ${b.id} run`).toBe(false);
        // the promenade: a long public hall on the bridge level (its name may be a landmark court's / the food court's)
        const long = Math.max(b.rect.x1 - b.rect.x0, b.rect.z1 - b.rect.z0);
        expect(l.areas.some(a => (a.level ?? 0) === 2 && a.publicSpace && a.kind === 'concourse' && Math.max(a.w, a.h) * CELL >= 0.6 * long && inside(b.rect, areaCentre(a).x, areaCentre(a).z)), `seed ${s} ${b.id} promenade`).toBe(true);
        expect(info.windows.some(w => w.level === 2 && (w.host as {building?: string}).building === b.id), `seed ${s} ${b.id} lookout`).toBe(true);
        expect(info.bridges.some(q => q.a === b.id || q.b === b.id), `seed ${s} ${b.id} bridged`).toBe(true);
      }
    }
    expect(n).toBeGreaterThan(0);
  });

  it('a market hall: open from its floor to the glass over its middle (a gallery ring), far more open than a classic atrium, counters round its floor, a low glazed shell', () => {
    let n = 0;
    const shareOf = (b: {rect: {x0: number; z0: number; x1: number; z1: number}; atrium?: {rect: {x0: number; z0: number; x1: number; z1: number}}}) =>
      ((b.atrium!.rect.x1 - b.atrium!.rect.x0) * (b.atrium!.rect.z1 - b.atrium!.rect.z0)) / ((b.rect.x1 - b.rect.x0) * (b.rect.z1 - b.rect.z0));
    const halls: number[] = [], classic: number[] = [];
    for (const s of SEEDS) for (const b of gen(s).skyways!.buildings.filter(q => q.atrium)) (b.programme === 'hall' ? halls : classic).push(shareOf(b));
    const mean = (v: number[]) => v.reduce((p, q) => p + q, 0) / v.length;
    expect(mean(halls), `halls ${mean(halls).toFixed(2)} vs classic atria ${mean(classic).toFixed(2)}`).toBeGreaterThanOrEqual(1.5 * mean(classic));
    for (const s of SEEDS) {
      const l = gen(s), info = l.skyways!;
      for (const b of info.buildings.filter(q => q.programme === 'hall' && q.atrium)) {
        n++;
        const r = b.rect;
        // (a hall whose stair wells take a side keeps a smaller opening: never less than about a sixth of the footprint)
        expect(shareOf(b), `seed ${s} ${b.id}: the hall's opening`).toBeGreaterThanOrEqual(0.15);
        expect(l.areas.some(q => (q.level ?? 0) === 1 && /^(Market hall|Food court)/.test(q.label) && inside(r, areaCentre(q).x, areaCentre(q).z)), `seed ${s} ${b.id}`).toBe(true);
        const halls = l.areas.filter(q => (q.level ?? 0) === 1 && q.publicSpace && inside(r, areaCentre(q).x, areaCentre(q).z)).map(q => q.id);
        expect(l.storefronts.filter(sf => halls.includes(sf.hall)).length, `seed ${s} ${b.id}: counters round the hall`).toBeGreaterThanOrEqual(3);
        expect(b.top, `seed ${s} ${b.id}: the shell stops just over its glass`).toBeLessThanOrEqual(b.atrium!.roofY + 3.5);
      }
    }
    expect(n).toBeGreaterThan(0);
  });

  it('an office tower lobby: a free-standing grand stair in the middle (floor on all four sides), a tall shell, no street-floor shop arcade', () => {
    let n = 0, grand = 0;
    for (const s of SEEDS) {
      const l = gen(s), info = l.skyways!, g1 = l.levels[1].grid;
      for (const b of info.buildings.filter(q => q.programme === 'tower')) {
        n++;
        expect(b.top - info.groundY, `seed ${s} ${b.id}: a tall tower`).toBeGreaterThanOrEqual(60);
        expect(l.areas.some(a => (a.level ?? 0) === 1 && /Arcade ·/.test(a.label) && inside(b.rect, areaCentre(a).x, areaCentre(a).z)), `seed ${s} ${b.id} arcade`).toBe(false);
        // its run's stair core: the floor of a public lobby beyond each of its four sides at street level
        const link = l.levelLinks.find(k => k.lower === 1 && k.upper === 2 && inside(b.rect, k.top.x, k.top.z));
        const core = link ? l.areas[l.traversal.stairs[link.traversalId ?? -1]?.area ?? -1] : undefined;
        expect(core, `seed ${s} ${b.id}: its run`).toBeTruthy();
        const sides = [[core!.x + Math.floor(core!.w / 2), core!.y - 1], [core!.x + Math.floor(core!.w / 2), core!.y + core!.h], [core!.x - 1, core!.y + Math.floor(core!.h / 2)], [core!.x + core!.w, core!.y + Math.floor(core!.h / 2)]];
        const open = sides.filter(([x, y]) => { const i = g1.idx(x, y), a = l.areas[g1.area[i]]; return g1.cells[i] === FLOOR && !!a?.publicSpace && a.type !== 'stair-core'; }).length;
        if (open === 4) grand++;
      }
    }
    expect(n).toBeGreaterThan(0);
    // (a lobby too shallow for the grand stair keeps an edge run: most towers have it)
    expect(grand / n, `${grand}/${n} towers with a free-standing grand stair`).toBeGreaterThanOrEqual(0.6);
  });

  it('deterministic: the same seed generates the same programmes and plan', () => {
    const a = gen(3), b = LEVELS.skyways.generate('main', {levelSeed: 3, startWeapon: 'pistol'} as never) as StationLayout;
    expect(b.skyways!.buildings.map(q => [q.id, q.programme, q.top])).toEqual(a.skyways!.buildings.map(q => [q.id, q.programme, q.top]));
    expect(b.areas.length).toBe(a.areas.length);
  });
});
