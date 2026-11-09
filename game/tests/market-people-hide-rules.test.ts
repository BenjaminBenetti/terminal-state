// Task studio-market-bar-20261108-225231-01 (lane PEOPLE): the pure rules of the market's hostility after the bar task —
//  - user: "Increase attackers to 50%": half fight, half flee over many stations, seeded and stable per station + person; the robbed trader
//    (the bartender too) is still a forced fighter inside the same split;
//  - user: "Fleeing survivors must hide in homes, not disappear/despawn": the REFUGES of real generated markets (v2: the homes first on
//    both storeys, then the bunk room / store rooms / other private rooms; v1, which has no homes: its under-deck rooms) — never a stall,
//    a lane or anything public; hide slots inside the refuge's own floor, clear of every doorway, out of its line where the room allows;
//  - the seeded assignment: homes first, near each person, spread (one slot per person), stable, capacity-bound, fallbacks;
//  - the hostility record: version 2 (a refuge per alive fleer, no 'fled') written now, version 1 (with 'fled') still accepted; the
//    bartender's id / stall.
import {describe, expect, it} from 'vitest';
import {generateMarketLevel} from '../src/gen/market/index';
import {levelsOf} from '../src/gen/levels';
import {MARKET_STALLS, type MarketStallId} from '../src/gen/market/marketTypes';
import {MARKET_HOSTILITY, assignRoles, fighterCount} from '../src/market/combat/roles';
import {MARKET_HOSTILITY_VERSION, marketHostilityProblem, residentId, traderId, type MarketHostilityJSON} from '../src/market/combat/record';
import {REFUGE, RefugeBook, marketRefuges, refugeKindOf, type Refuge} from '../src/market/people/refuges';
import type {StationLayout} from '../src/gen/stationTypes';

const ids = (residents: number, extra: string[] = []) => [...MARKET_STALLS.map(traderId), ...extra, ...Array.from({length: residents}, (_, i) => residentId(i))];

describe('50 / 50: half the settlement fights, half flees', () => {
  it('fightShare 0.5: round(n / 2) fighters (at least one) of every station, each person ~50 % of the time over seeds', () => {
    expect(MARKET_HOSTILITY.fightShare).toBe(0.5);
    expect([fighterCount(0), fighterCount(1), fighterCount(2), fighterCount(7), fighterCount(14), fighterCount(17), fighterCount(19)]).toEqual([0, 1, 1, 4, 7, 9, 10]);
    for (const n of [8, 10, 12]) {
      const list = ids(n), tally = new Map(list.map(id => [id, 0]));
      const N = 400;
      for (let s = 1; s <= N; s++) {
        const r = assignRoles(s * 7919 + n, list);
        const f = [...r.values()].filter(v => v === 'fight').length;
        expect(f).toBe(fighterCount(list.length));
        expect(Math.abs(f - (list.length - f))).toBeLessThanOrEqual(1); // half and half (an odd count rounds toward the fighters)
        for (const [id, role] of r) if (role === 'fight') tally.set(id, tally.get(id)! + 1);
      }
      for (const [id, k] of tally) { expect(k / N, id).toBeGreaterThan(0.4); expect(k / N, id).toBeLessThan(0.62); }
    }
  });

  it('seeded and stable per station + person; a theft: the robbed trader (the bartender as well) fights in a fighter\'s place', () => {
    const list = ids(10, ['trader:bar']);
    for (let s = 1; s <= 120; s++) {
      expect([...assignRoles(s, list).entries()]).toEqual([...assignRoles(s, list).entries()]);
      for (const stall of [...MARKET_STALLS, 'bar' as MarketStallId]) {
        const r = assignRoles(s, list, stall);
        expect(r.get(traderId(stall)), `seed ${s} ${stall}`).toBe('fight');
        expect([...r.values()].filter(v => v === 'fight').length).toBe(fighterCount(list.length));
        // everyone else keeps the role the plain split gave them, but the one fighter the robbed trader replaced
        const plain = assignRoles(s, list);
        const changed = list.filter(id => r.get(id) !== plain.get(id));
        expect(changed.length === 0 || changed.length === 2).toBe(true);
      }
    }
  });
});

const markets = new Map<string, StationLayout>();
function market(seed: number, v: 1 | 2): StationLayout {
  const k = `${seed}:${v}`;
  if (!markets.has(k)) markets.set(k, generateMarketLevel({levelSeed: seed, layoutVersion: v}));
  return markets.get(k)!;
}

describe('the refuges of real markets', () => {
  it('version 2: the homes on both storeys first, then the bunk room / store rooms / private rooms; never a stall, lane or public area', () => {
    for (const seed of [808, 1234, 31, 5150]) {
      const L = market(seed, 2), levels = levelsOf(L), R = marketRefuges(L, levels);
      const stallAreas = new Set(L.market!.stalls.map(s => s.area));
      const homes = R.filter(r => r.kind === 'home');
      expect(homes.length, `seed ${seed}`).toBeGreaterThanOrEqual(8);
      expect(new Set(homes.map(r => r.level))).toEqual(new Set([0, 1])); // ground-floor homes and the homes up on the catwalks
      expect(R.some(r => r.kind === 'bunks')).toBe(true);
      expect(R.some(r => r.kind === 'store')).toBe(true);
      for (const r of R) {
        const a = L.areas[r.area];
        expect(a.kind).toBe('room');
        expect(a.publicSpace).toBe(false);
        expect(stallAreas.has(a.id)).toBe(false);
        expect(r.tier).toBe({home: 0, bunks: 1, store: 2, room: 3}[r.kind]);
        expect(r.id).toBe(`${r.kind}:${r.area}`);
      }
      // homes are the first choice (tier 0), and the label decides: 'Home' / 'Ground-floor home'
      for (const a of L.areas) if (/home$/i.test(a.label) && a.kind === 'room') expect(refugeKindOf(a, stallAreas)).toBe('home');
    }
  });

  it('hide slots: on the refuge\'s own clear floor, >= mouthGap from every doorway cell, apart; most homes hide their people out of the doorway\'s line', () => {
    let homeSlots = 0, hiddenHomeSlots = 0;
    for (const seed of [808, 1234, 31]) {
      const L = market(seed, 2), levels = levelsOf(L), R = marketRefuges(L, levels);
      for (const r of R) {
        expect(r.slots.length).toBeGreaterThanOrEqual(1);
        expect(r.slots.length).toBeLessThanOrEqual(REFUGE.maxSlots);
        const G = levels.grid(r.level);
        for (const s of r.slots) {
          const [cx, cy] = G.cellOf(s.x, s.z);
          expect(G.area[G.idx(cx, cy)], r.id).toBe(r.area);
          expect(G.walkable(cx, cy)).toBe(true);
          expect(G.circleClear(s.x, s.z, REFUGE.clear)).toBe(true);
          expect(Math.abs(G.cellFloor(cx, cy) - s.y)).toBeLessThan(1e-3);
          for (const m of r.mouths) expect(Math.hypot(m.x - s.x, m.z - s.z)).toBeGreaterThanOrEqual(REFUGE.mouthGap - 1e-6);
          for (const o of r.slots) if (o !== s) expect(Math.hypot(o.x - s.x, o.z - s.z)).toBeGreaterThanOrEqual(REFUGE.slotGap - 1e-6);
          // facing a doorway
          const m = r.mouths.reduce((p, q) => (Math.hypot(q.x - s.x, q.z - s.z) < Math.hypot(p.x - s.x, p.z - s.z) ? q : p));
          expect(Math.cos(Math.atan2(m.x - s.x, m.z - s.z) - s.yaw)).toBeGreaterThan(0.99);
        }
        // the first slot is the best one: hidden whenever any is
        if (r.slots.some(s => s.hidden)) expect(r.slots[0].hidden).toBe(true);
        if (r.kind === 'home') { homeSlots += r.slots.length; hiddenHomeSlots += r.slots.filter(s => s.hidden).length; if (r.slots.some(s => s.hidden)) expect(r.slots[0].hidden).toBe(true); }
      }
    }
    expect(hiddenHomeSlots / homeSlots).toBeGreaterThan(0.45);
  });

  it('version 1 (no homes): the under-deck workshop, bunk room and kitchen — slots inside, off the open front', () => {
    for (const seed of [808, 77]) {
      const L = market(seed, 1), levels = levelsOf(L), R = marketRefuges(L, levels);
      expect(R.map(r => r.label).sort()).toEqual(['Bunk room', 'Communal kitchen', 'Workshop']);
      expect(R.find(r => r.label === 'Bunk room')!.kind).toBe('bunks');
      for (const r of R) {
        expect(r.slots.length).toBeGreaterThanOrEqual(2);
        expect(r.mouths.length).toBeGreaterThan(10); // (an open front onto the square, not a door)
        const a = L.areas[r.area];
        for (const s of r.slots) {
          expect(s.x / 0.5).toBeGreaterThan(a.x); expect(s.x / 0.5).toBeLessThan(a.x + a.w);
          expect(s.z / 0.5).toBeGreaterThan(a.y); expect(s.z / 0.5).toBeLessThan(a.y + a.h);
        }
      }
    }
  });

  it('a layout without a market, or a stall-only market, has no refuges', () => {
    const L = market(808, 2), levels = levelsOf(L);
    expect(marketRefuges({areas: L.areas}, levels)).toEqual([]);
    const allStalls = {...L.market!, stalls: L.market!.stalls.map(s => s)};
    const onlyStalls = {areas: L.areas.filter(a => L.market!.stalls.some(s => s.area === a.id)), market: allStalls};
    expect(marketRefuges(onlyStalls, levels)).toEqual([]);
  });
});

describe('the refuge assignment (RefugeBook)', () => {
  const book = (seed = 808) => { const L = market(seed, 2), levels = levelsOf(L); return {L, levels, R: marketRefuges(L, levels), b: new RefugeBook(marketRefuges(L, levels), levels)}; };

  it('homes first, one slot per person, spread over the refuges, near the person\'s own place; stable per station + person', () => {
    const {L, b, R} = book();
    const people = L.market!.spots.slice(0, 10).map((s, i) => ({id: residentId(i), x: s.x, y: s.y, z: s.z}));
    b.assign(42, people);
    const claims = people.map(p => b.claimOf(p.id)!);
    expect(claims.every(c => c && c.refuge.kind === 'home')).toBe(true);
    const keys = claims.map(c => `${c.refuge.id}#${c.slot}`);
    expect(new Set(keys).size).toBe(keys.length);
    // spread: with more homes than people, no home takes two
    const homes = R.filter(r => r.kind === 'home').length;
    expect(homes).toBeGreaterThanOrEqual(people.length);
    expect(new Set(claims.map(c => c.refuge.id)).size).toBe(people.length);
    // stable: the same station + people -> the same refuges, in any order
    const b2 = new RefugeBook(R, levelsOf(L));
    b2.assign(42, [...people].reverse());
    for (const p of people) expect(`${b2.claimOf(p.id)!.refuge.id}#${b2.claimOf(p.id)!.slot}`).toBe(`${b.claimOf(p.id)!.refuge.id}#${b.claimOf(p.id)!.slot}`);
    // a person takes a near home, not the far side of the market: within the nearer half of the homes by distance
    for (const p of people) {
      const c = b.claimOf(p.id)!.refuge, d = (r: Refuge) => Math.hypot(r.cx - p.x, r.cz - p.z, (r.cy - p.y) * REFUGE.climb);
      const rank = R.filter(r => r.kind === 'home').map(d).sort((x, y) => x - y).indexOf(d(c));
      expect(rank, p.id).toBeLessThan(Math.ceil(homes * 0.75));
    }
  });

  it('when the homes are full the others go to the bunk room / store rooms / private rooms; when every slot is taken, nobody more', () => {
    const {L, b, R} = book(1234);
    const total = R.reduce((s, r) => s + r.slots.length, 0);
    const homeSlots = R.filter(r => r.kind === 'home').reduce((s, r) => s + r.slots.length, 0);
    const spot = L.market!.spots[0];
    const people = Array.from({length: total + 3}, (_, i) => ({id: `resident:${i}`, x: spot.x, y: spot.y, z: spot.z}));
    b.assign(7, people);
    const claimed = people.filter(p => b.claimOf(p.id));
    expect(claimed.length).toBe(total);
    expect(claimed.filter(p => b.claimOf(p.id)!.refuge.kind === 'home').length).toBe(homeSlots);
    // every slot exactly once
    expect(new Set(claimed.map(p => `${b.claimOf(p.id)!.refuge.id}#${b.claimOf(p.id)!.slot}`)).size).toBe(total);
  });

  it('options: the own claim first, then other refuges with a free slot (homes first, nearest); claim / release / claimNear keep one owner per slot', () => {
    const {L, b, R} = book();
    const s0 = L.market!.spots[0];
    b.assign(1, [{id: 'resident:0', x: s0.x, y: s0.y, z: s0.z}]);
    const own = b.claimOf('resident:0')!;
    const opts = b.options('resident:0', s0.x, s0.y, s0.z, 4);
    expect(opts[0]).toBe(own);
    expect(opts.length).toBe(4);
    expect(opts.slice(1).every(o => o.refuge !== own.refuge)).toBe(true);
    expect(opts[1].refuge.tier).toBe(0);
    // another person cannot take a held slot
    expect(() => b.claim('resident:1', own.refuge, own.slot)).toThrow();
    b.release('resident:0');
    b.claim('resident:1', own.refuge, own.slot);
    expect(b.free(own.refuge)).not.toContain(own.slot);
    // claimNear: the free slot nearest a point; a full refuge refuses
    const r = R.find(q => q.slots.length >= 2)!;
    const far = r.slots[r.slots.length - 1];
    expect(b.claimNear('resident:2', r, far.x, far.z)).toBe(true);
    expect(b.slotOf('resident:2')).toBe(far);
    const one = R.find(q => q.slots.length === 1 && q !== r && q !== own.refuge)!;
    expect(b.claimNear('resident:3', one, 0, 0)).toBe(true);
    expect(b.claimNear('resident:4', one, 0, 0)).toBe(false);
    // inside(): the refuge's own floor on its storey
    expect(b.inside(r, far.x, far.y, far.z)).toBe(true);
    expect(b.inside(r, far.x, far.y + 3, far.z)).toBe(false);
    expect(b.inside(r, r.mouths[0].x + 5, far.y, r.mouths[0].z + 5)).toBe(false);
  });
});

describe('the hostility record: version 2 (refuges, nobody fled), version 1 still read', () => {
  const v2 = (): MarketHostilityJSON => ({v: 2, hostile: true, cause: 'theft', stall: 'bar' as MarketStallId, people: {
    'trader:bar': {s: 'alive', hp: 64.5, role: 'fight', gun: 'shotgun', mag: 3, spare: 6, posture: 'fight', x: 1, y: 2.95, z: 2, yaw: 0.5},
    'resident:3': {s: 'dead', hp: 0, role: 'flee', gun: 'pistol', mag: 15, spare: 30, posture: 'down', x: 4, y: 3.2, z: -1, yaw: -2},
    'resident:4': {s: 'alive', hp: 100, role: 'flee', gun: 'rifle', mag: 30, spare: 60, posture: 'hide', x: 9, y: 2.95, z: 7, yaw: 1, refuge: 'home:41'},
    'resident:5': {s: 'alive', hp: 80, role: 'flee', gun: 'rifle', mag: 30, spare: 60, posture: 'flee', x: 2, y: 0, z: 7, yaw: 1, refuge: 'bunks:32'},
  }});
  const v1 = (): MarketHostilityJSON => ({v: 1, hostile: true, cause: 'attack', people: {
    'trader:gun': {s: 'alive', hp: 64.5, role: 'fight', gun: 'shotgun', mag: 3, spare: 6, posture: 'fight', x: 1, y: 0, z: 2, yaw: 0.5},
    'resident:4': {s: 'fled', hp: 100, role: 'flee', gun: 'rifle', mag: 30, spare: 60, posture: 'flee'},
  }});

  it('the current version is 2; both versions are well-formed; the bartender (trader:bar, stall bar) is a person like any trader', () => {
    expect(MARKET_HOSTILITY_VERSION).toBe(2);
    expect(marketHostilityProblem(v2())).toBeNull();
    expect(marketHostilityProblem(v1())).toBeNull();
  });

  it('refuses the malformed: fled in version 2, a refuge in version 1 / for the dead / badly named, an unknown version or stall', () => {
    const bad: [string, () => unknown][] = [
      ['fled in v2', () => { const r = v2(); r.people['resident:5'] = {s: 'fled', hp: 80, role: 'flee', gun: 'rifle', mag: 30, spare: 60, posture: 'flee'}; return r; }],
      ['refuge in v1', () => { const r = v1(); r.people['trader:gun'].refuge = 'home:3'; return r; }],
      ['refuge of the dead', () => { const r = v2(); r.people['resident:3'].refuge = 'home:3'; return r; }],
      ['bad refuge id', () => { const r = v2(); r.people['resident:4'].refuge = 'palace:1'; return r; }],
      ['refuge not a string', () => { const r = v2(); (r.people['resident:4'] as unknown as {refuge: number}).refuge = 41; return r; }],
      ['no position in v2', () => { const r = v2(); for (const k of ['x', 'y', 'z', 'yaw'] as const) delete r.people['resident:4'][k]; return r; }],
      ['version 3', () => ({...v2(), v: 3})],
      ['unknown stall', () => ({...v2(), stall: 'bank'})],
      ['unknown trader', () => { const r = v2(); r.people['trader:bank'] = r.people['trader:bar']; return r; }],
    ];
    for (const [why, f] of bad) expect(marketHostilityProblem(f()), why).not.toBeNull();
  });
});
