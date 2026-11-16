// Task studio-skywalk-events-20261115-193624-01 (lead): the Skyways MAJOR-EVENT POOL at layout version 7. User: "Extend the existing
// localized major-event selection/save conventions alongside anime convention/prize car; these are pool additions, NOT themes over the
// whole map or ordinary shop replacements. Keep the existing event count/other content. Visited layouts/enemies/kills/loot stay exact;
// new/unvisited Skywalks can receive the new events once." Pins:
//  - versions 1-6 draw from the old two-event pool exactly (skywaysAddonOf), version 7 from five equal-weight events (convention / prize
//    car / tech expo / mini-golf / evacuation centre), one per level seed, never moved by a frame retry;
//  - a version-7 station that keeps its convention / prize-car draw regenerates byte-identical to version 6 (props, enemies, loot, grid);
//  - a visited station keeps the version recorded in its memory (an old convention stays a convention), an unvisited one takes the current
//    version (7; 8 since task studio-skywalk-loot-performance-20261116-022934-01, the same draw);
//  - a new event takes the convention's venue carve unchanged (same cells / roles on a seed whose version-6 draw was the convention) under
//    its own room names, keeps its washrooms, stays on its host's bridge storey, validates, and leaves the rest of the map ordinary;
//  - its crowd (gen/skyways/events/eventCrowd.ts): ordinary floor enemies after the hordes (before the annex) on the public event floor, deterministic.
import {describe, expect, it} from 'vitest';
import {LEVELS} from '../src/levels/registry';
import type {StationLayout} from '../src/gen/stationTypes';
import {skywaysAddonFor, skywaysAddonOf, skywaysFrame, skywaysIssues} from '../src/gen/skyways/index';
import {SKYWAYS_ADDONS, SKYWAYS_ADDON_POOL_V7, SKYWAYS_EVENT_ADDONS, isSkywaysEventAddon, skywaysVenueShaped} from '../src/gen/skyways/skywaysTypes';
import {SKYWAYS_EVENTS_MIN_VERSION, SKYWAYS_LAYOUT_LANE, SKYWAYS_LAYOUT_VERSION, skywaysLayoutVersionFor} from '../src/gen/skyways/layoutVersion';
import {EVENT_ROOM_NAMES} from '../src/gen/skyways/events/eventVenue';
import {EVENT_CROWD_RULES, eventCrowdAreas, eventCrowdOf} from '../src/gen/skyways/events/eventCrowd';
import {SKYWAYS_SPAWN_PROFILE, spawnContextOf} from '../src/ai/spawnTables';
import {createMemory, enemiesToSpawn} from '../src/run/memory';

const cache = new Map<string, StationLayout>();
const gen = (seed: number, layoutVersion: number): StationLayout => {
  const k = `${seed}:${layoutVersion}`;
  let l = cache.get(k);
  if (!l) cache.set(k, (l = LEVELS.skyways.generate('main', {levelSeed: seed, startWeapon: 'pistol', layoutVersion} as never)));
  return l;
};
/** FNV-1a over a string. */
const fnv = (s: string, h = 0x811c9dc5) => { for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0; return h; };
/** Everything a visit sees: areas, props, enemies, loot, signs, the add-on record and every storey's cells / blocking / heights. */
function fingerprint(l: StationLayout): string {
  const parts: string[] = [JSON.stringify(l.areas), JSON.stringify(l.props), JSON.stringify(l.zombies), JSON.stringify(l.pickups),
    JSON.stringify((l as {signs?: unknown}).signs ?? null), JSON.stringify(l.skyways ?? null)];
  for (const lv of l.levels) {
    const g = lv.grid as unknown as Record<string, unknown>;
    for (const key of ['cells', 'blocked', 'area', 'floorH', 'heights']) {
      const a = g[key] as ArrayLike<number> | undefined;
      if (a && typeof a.length === 'number') parts.push(`${key}:${fnv(Array.prototype.join.call(a, ','))}`);
    }
  }
  return parts.map(p => fnv(p).toString(16)).join('.');
}

describe('Skyways event pool: the draw', () => {
  it('versions 1-6 draw the two-event pool exactly; version 7 five events at equal weights; one per seed, retry-proof', () => {
    expect(SKYWAYS_LAYOUT_VERSION).toBe(8); // (task studio-skywalk-loot-performance-20261116-022934-01: version 8 adds the new events' supplies; the draw is version 7's)
    expect(SKYWAYS_EVENTS_MIN_VERSION).toBe(7);
    expect([...SKYWAYS_ADDONS]).toEqual(['convention', 'prize-car']); // (the frozen frames read it)
    expect([...SKYWAYS_ADDON_POOL_V7].sort()).toEqual(['convention', 'evac-centre', 'mini-golf', 'prize-car', 'tech-expo']);
    for (let s = 0; s < 1500; s++) for (let v = 1; v < 7; v++) expect(skywaysAddonFor(s, v)).toBe(skywaysAddonOf(s));
    const n = new Map<string, number>(), N = 4000;
    for (let s = 0; s < N; s++) {
      const id = skywaysAddonFor(s, 7);
      n.set(id, (n.get(id) ?? 0) + 1);
      // an old event drawn at version 7 is the seed's own version-6 event (an event seed never swaps convention <-> prize car)
      if (!isSkywaysEventAddon(id)) expect(id).toBe(skywaysAddonOf(s));
    }
    expect([...n.keys()].sort()).toEqual([...SKYWAYS_ADDON_POOL_V7].sort());
    for (const [id, c] of n) expect(Math.abs(c / N - 0.2), id).toBeLessThan(0.025);
    for (const s of [3, 5, 6, 17, 4242]) expect(skywaysFrame(s, 4, {version: 7}).addon).toBe(skywaysFrame(s, 0, {version: 7}).addon);
    // the venue-shaped events take a hotel host like the convention; the prize car keeps its hub court
    for (const id of SKYWAYS_ADDON_POOL_V7) expect(skywaysVenueShaped(id)).toBe(id !== 'prize-car');
  });

  it('a visited station keeps its recorded version (and event); an unvisited one takes the current version and its new event', () => {
    const lanes = (v: number) => ({[SKYWAYS_LAYOUT_LANE]: {v}});
    expect(skywaysLayoutVersionFor(undefined)).toBe(8);
    expect(skywaysLayoutVersionFor({visits: 0, lanes: {}})).toBe(8);
    expect(skywaysLayoutVersionFor({visits: 2, lanes: lanes(6)})).toBe(6);
    expect(skywaysLayoutVersionFor({visits: 2, lanes: lanes(7)})).toBe(7);
    expect(skywaysLayoutVersionFor({visits: 2, lanes: lanes(8)})).toBe(8);
    // seed 5: a convention entered at version 6 stays the convention; the same seed never entered becomes the mini-golf
    expect(gen(5, skywaysLayoutVersionFor({visits: 1, lanes: lanes(6)})).skyways!.addon.id).toBe('convention');
    expect(gen(5, skywaysLayoutVersionFor({visits: 0, lanes: {}})).skyways!.addon.id).toBe('mini-golf');
  }, 120000);
});

describe('Skyways event pool: old events at version 7', () => {
  it('a convention / prize-car seed regenerates byte-identical to version 6 (props, enemies, loot, signs, cells)', () => {
    for (const [seed, id] of [[4, 'convention'], [1, 'prize-car'], [9, 'convention'], [3, 'prize-car']] as const) {
      const a = gen(seed, 6), b = gen(seed, 7);
      expect(b.skyways!.addon.id, `seed ${seed}`).toBe(id);
      expect(fingerprint(b), `seed ${seed}`).toBe(fingerprint(a));
    }
  }, 240000);
});

describe('Skyways event pool: the new events', () => {
  const EVENT_SEEDS = {'tech-expo': [6, 10], 'mini-golf': [5, 12], 'evac-centre': [2, 7]} as const;

  it('each new event: one add-on on its host bridge storey, the venue carve under its own room names, washrooms kept, valid', () => {
    for (const id of SKYWAYS_EVENT_ADDONS) {
      const names = EVENT_ROOM_NAMES[id];
      for (const seed of EVENT_SEEDS[id]) {
        const l = gen(seed, 7), a = l.skyways!.addon;
        expect(a.id, `seed ${seed}`).toBe(id);
        expect(skywaysIssues(l), `seed ${seed}`).toEqual([]);
        expect(a.level, `seed ${seed}`).toBe(2);
        const venue = a.venue ?? [];
        const roles = new Set(venue.map(v => v.role));
        for (const r of ['main-hall', 'exhibitors', 'registration', 'panel', 'washrooms']) expect(roles.has(r as never), `seed ${seed} ${id} ${r}`).toBe(true);
        for (const v of venue) {
          const q = l.areas[v.area];
          expect(q.level ?? 0, `seed ${seed} ${v.role}`).toBe(a.level);
          if (v.role === 'main-hall') expect(q.label).toBe(names.hall);
          if (v.role === 'exhibitors') expect(q.label.startsWith(names.exhibitors), q.label).toBe(true);
          if (v.role === 'panel') expect(names.panels).toContain(q.label);
          if (v.role === 'photo-lounge') expect(q.label).toBe(names.lounge);
          if (v.role === 'washrooms') expect(q.label).toBe('Washrooms');
          // never the convention's own names on a new event
          expect(q.label, `seed ${seed}`).not.toMatch(/^(Main stage|Exhibitors'|Panel room|Photo lounge)/);
        }
        expect(a.stage, `seed ${seed}`).toBeDefined(); // (the carve's stage box: the event dressers' main-hall anchor)
        // exactly one event on the map: no other area carries an event's room names
        const eventAreas = new Set([...a.areas, ...venue.map(v => v.area)]);
        const named = l.areas.filter(q => q.label === names.hall);
        expect(named.every(q => eventAreas.has(q.id)), `seed ${seed}`).toBe(true);
        expect(l.skyways!.buildings.filter(b => b.id === a.building).length).toBe(1);
      }
    }
  }, 300000);

  it('the event crowd: ordinary floor enemies after the hordes, before the annex, on the public event floor, fair, deterministic, kills remembered', () => {
    for (const id of SKYWAYS_EVENT_ADDONS) for (const seed of EVENT_SEEDS[id]) {
      const l = gen(seed, 7), [lo, hi] = EVENT_CROWD_RULES.count[id];
      const hosts = new Set(eventCrowdAreas(l)), crowd = eventCrowdOf(l);
      // the crowd = one run of 'floor' spawns right after the last horde member (only annex 'service' spawns after it), every one in a
      // hosting area of the event's storey
      expect(crowd, `seed ${seed} ${id}`).not.toBeNull();
      const {first, n} = crowd!, ctx = l.zombies.map((_z, i) => spawnContextOf(l, SKYWAYS_SPAWN_PROFILE, i));
      expect(n, `seed ${seed} ${id}`).toBeGreaterThanOrEqual(Math.min(lo, 2));
      expect(n, `seed ${seed} ${id}`).toBeLessThanOrEqual(hi);
      expect(ctx.lastIndexOf('horde'), `seed ${seed} ${id}: after the hordes`).toBeLessThan(first);
      expect(ctx.slice(first + n).every(c => c === 'service'), `seed ${seed} ${id}: only annex spawns follow`).toBe(true);
      const g = l.levels[l.skyways!.addon.level].grid;
      for (const [k, z] of l.zombies.slice(first, first + n).entries()) {
        expect(ctx[first + k]).toBe('floor');
        expect(hosts.has(z.area!), `seed ${seed}: in a hosting area`).toBe(true);
        expect(z.level ?? 0).toBe(l.skyways!.addon.level);
        const [cx, cy] = g.cellOf(z.x, z.z);
        expect(g.walkable(cx, cy), `seed ${seed}`).toBe(true);
        expect(z.look, `seed ${seed}`).not.toBe('cosplay');
        expect(Math.hypot(z.x - l.skyways!.addon.entry.x, z.z - l.skyways!.addon.entry.z)).toBeGreaterThanOrEqual(EVENT_CROWD_RULES.doorKeepM);
      }
      // regenerates identically (revisit / streaming / Retry); a killed crowd member stays dead (the per-index kill memory)
      const again = LEVELS.skyways.generate('main', {levelSeed: seed, startWeapon: 'pistol', layoutVersion: 7} as never) as StationLayout;
      expect(JSON.stringify(again.zombies)).toBe(JSON.stringify(l.zombies));
      const mem = createMemory({level: 'skyways', section: 'main'});
      mem.killed = [first + n - 1];
      expect(enemiesToSpawn(l.zombies.length, mem)).not.toContain(first + n - 1);
    }
  }, 300000);

  it('the convention venue carve is reused unchanged: on a version-6 convention seed the new event holds the same venue cells', () => {
    for (const seed of [5, 7]) { // (version 6: the convention; version 7: the mini-golf / evacuation centre)
      const a = gen(seed, 6).skyways!.addon, b = gen(seed, 7).skyways!.addon;
      expect(a.id).toBe('convention');
      expect(isSkywaysEventAddon(b.id), `seed ${seed}`).toBe(true);
      const rects = (l: StationLayout, ad: typeof a) => (ad.venue ?? []).map(v => { const q = l.areas[v.area]; return `${v.role}:${q.x},${q.y},${q.w},${q.h}`; });
      expect(rects(gen(seed, 7), b), `seed ${seed}`).toEqual(rects(gen(seed, 6), a));
      expect(b.building).toBe(a.building);
      expect(b.hall).toEqual(a.hall);
    }
  }, 240000);
});
