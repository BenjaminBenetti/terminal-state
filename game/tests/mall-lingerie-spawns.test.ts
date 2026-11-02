// Task mall-lingerie-20261102-221554 (lane CONTEXT): the mall lingerie store's STORE-LOCAL ordinary-zombie variants + look scoping.
//
// User: "make store-local ordinary-zombie variants using these specific bodies dressed in the supplied lingerie designs … Spawn these
// variants inside this store, especially in the changing area." Checks:
//  - placement (gen/mall/lingerieSpawns.ts): only inside the store, mostly in its walk-in changing area, walkable 3 x 3 cells, none
//    point-blank at the shopfront, never on a booth / changing-area opening, never sealing passage, one per booth first;
//  - accounting: appended after every other spawn (ambient, hordes, annex 'service'), tagged 'lingerie' (context + look), ordinary
//    zombies only (the store's own pool through the one family roll); without a lingerie store the level is identical to a generation
//    without the pass;
//  - looks (ai/spawnLook.ts): the lingerie set only for those spawns, the ordinary wardrobe pick for every other spawn of every level;
//    deterministic per (seed, index): stable across rebuilds; kills by index.
// Synthetic fixture: a real generated mall whose largest single-front retail store is re-purposed as a lingerie store with booths
// (partition cells blocked) + an aisle at its back wall — the pass on its own, independent of lane STORE's dressing.

import {describe, expect, it} from 'vitest';
import {Rng, hashString} from '../src/core/rng';
import {FLOOR} from '../src/gen/grid';
import {clearAround} from '../src/gen/stationDress';
import {generateMallLevel} from '../src/gen/mall/index';
import {LEVELS} from '../src/levels/registry';
import type {LevelId} from '../src/levels/types';
import {createMemory, enemiesToSpawn} from '../src/run/memory';
import type {MallRect} from '../src/gen/mall/mallTypes';
import {LINGERIE_PURPOSE, LINGERIE_SPAWN_RULES, lingerieStores, placeLingerieSpawns, type LingerieShop} from '../src/gen/mall/lingerieSpawns';
import {LINGERIE_CONTEXT, LINGERIE_FAMILY_POOL, MALL_SPAWN_PROFILE, sealsPassage, spawnContextOf, spawnProfile as spawnProfileOf, validateSpawnProfile} from '../src/ai/spawnTables';
import {assignEnemyArchetypes} from '../src/ai/creatureSpawn';
import {applyFamilySpacing} from '../src/ai/familySpacing';
import {chooseSpawnLook, lingerieLookUsable, lingerieModelKeysFor, type SpawnLookLibrary} from '../src/ai/spawnLook';
import {LINGERIE_BODY_IDS, LINGERIE_MODEL_FILES, lingerieLook} from '../src/ai/lingerie';
import {pickZombieLook, type LegacyZombieLook, type WardrobeAvailability, type ZombieLook} from '../src/ai/wardrobe';
import {ZOMBIE_BODIES, ZOMBIE_WEARABLES} from '../src/ai/outfits';
import type {StationLayout, ZombieSpawn} from '../src/gen/stationTypes';

const P = MALL_SPAWN_PROFILE;
type Grid = StationLayout['levels'][number]['grid'];

const rectDist = (r: MallRect, x: number, z: number) => Math.hypot(Math.max(r.x0 - x, 0, x - r.x1), Math.max(r.z0 - z, 0, z - r.z1));
const inRect = (r: MallRect, x: number, z: number) => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1;

// ---------------------------------------------------------------------------------------------------------------------------------
// Synthetic store fixture

interface Fixture { l: StationLayout; shop: LingerieShop; booths: MallRect[]; aisle: MallRect; doors: Set<number>; g: Grid; first: number }

/** Seed's mall with its largest single-front (N / S) retail store turned into a lingerie store: booths 2 x 2 m + a 1.5 m aisle. */
function fixture(seed: number): Fixture {
  const l = generateMallLevel({levelSeed: seed, startWeapon: 'pistol'});
  const shop = l.mall!.shops.filter(s => s.level >= 1 && s.kind === 'store' && (s.frontages?.length ?? 1) === 1 && (s.frontage.side === 'N' || s.frontage.side === 'S'))
    .sort((a, b) => b.salesArea - a.salesArea)[0] as LingerieShop & {changing?: MallRect[]};
  const a = l.areas[shop.area], g = l.levels[shop.level].grid;
  const north = shop.frontage.side === 'N';
  // rows from the back wall inward: booth interiors (4 rows), the front partition (1), the aisle (3)
  const row = (k: number) => (north ? a.y + a.h - 1 - k : a.y + k);
  const rows = (k0: number, k1: number) => [row(k0), row(k1)].sort((p, q) => p - q) as [number, number];
  const [by0, by1] = rows(0, 3), py = row(4), [ay0, ay1] = rows(5, 7);
  const booths: MallRect[] = [], doors = new Set<number>();
  const cellRect = (x0: number, y0: number, x1: number, y1: number): MallRect => ({x0: x0 * 0.5, z0: y0 * 0.5, x1: (x1 + 1) * 0.5, z1: (y1 + 1) * 0.5});
  const own = (x: number, y: number) => g.area[g.idx(x, y)] === shop.area && g.cells[g.idx(x, y)] === FLOOR;
  for (let y = Math.min(by0, ay0, py); y <= Math.max(by1, ay1, py); y++) for (let x = a.x; x < a.x + a.w; x++) if (own(x, y)) g.blocked[g.idx(x, y)] = 0;
  for (let bx = a.x; bx + 3 < a.x + a.w; bx += 5) {
    booths.push(cellRect(bx, by0, bx + 3, by1));
    for (let y = by0; y <= by1; y++) if (bx + 4 < a.x + a.w && own(bx + 4, y)) g.blocked[g.idx(bx + 4, y)] = 1; // side partition
    for (let x = bx - 1; x <= bx + 4; x++) {
      if (!g.inBounds(x, py) || !own(x, py)) continue;
      if (x === bx + 1 || x === bx + 2) doors.add(g.idx(x, py)); else g.blocked[g.idx(x, py)] = 1; // front partition, 2-cell curtain gap
    }
  }
  const aisle = cellRect(a.x, ay0, a.x + a.w - 1, ay1);
  shop.changing = [...booths, aisle];
  shop.fit = {...shop.fit!, purpose: LINGERIE_PURPOSE};
  a.purpose = LINGERIE_PURPOSE;
  return {l, shop, booths, aisle, doors, g, first: l.zombies.length};
}

const keepOf = (l: StationLayout) => l.levelLinks.flatMap(k => [{level: k.lower, x: k.bottom.x, z: k.bottom.z}, {level: k.upper, x: k.top.x, z: k.top.z}]);

describe('the store-local pass on a synthetic lingerie store', () => {
  const seeds = [11, 222, 3333];
  const fx = seeds.map(seed => {
    const f = fixture(seed);
    const reports = placeLingerieSpawns(f.l, new Rng(hashString('fixture', seed)), keepOf(f.l), P);
    return {...f, reports, added: f.l.zombies.slice(f.first)};
  });
  process.stdout.write(`\n[mall-lingerie-spawns] synthetic stores: ${fx.map(f => `seed ${f.l.seed} ${f.shop.id} (${f.booths.length} booths): ${JSON.stringify(f.reports[0])}`).join('\n   ')}\n`);

  it('one run per store: U{3..5}, all placed, mostly in the changing area (one per booth first), the rest on the sales floor', () => {
    for (const {l, shop, booths, aisle, reports, added} of fx) {
      expect(reports.map(r => r.shop)).toEqual([shop.id]);
      const r = reports[0];
      expect(r.count).toBeGreaterThanOrEqual(LINGERIE_CONTEXT.count[0]);
      expect(r.count).toBeLessThanOrEqual(LINGERIE_CONTEXT.count[1]);
      expect(r.placed, `${l.seed} ${JSON.stringify(r)}`).toBe(r.count);
      expect(added.length).toBe(r.placed);
      expect(r.quota.floor).toBe(Math.floor(r.count / LINGERIE_SPAWN_RULES.floorEvery));
      const inChanging = added.filter(z => [...booths, aisle].some(q => inRect(q, z.x, z.z)));
      expect(inChanging.length).toBe(r.changing);
      expect(r.changing, `${l.seed}: mostly in the changing area`).toBeGreaterThan(r.placed / 2);
      expect(r.changing + r.floor).toBe(r.placed);
      // the split holds unless the sales floor had no room for its share (then the changing area takes it)
      if (r.floor === r.quota.floor) expect(r.changing).toBe(r.quota.changing);
      else expect(r.changing).toBe(r.count - r.floor);
      // spread: no booth holds two while another booth with room holds none (one per booth per pass)
      const perBooth = booths.map(q => added.filter(z => inRect(q, z.x, z.z)).length);
      if (r.quota.changing <= booths.length) expect(Math.max(...perBooth), `${l.seed} ${perBooth}`).toBeLessThanOrEqual(1);
    }
  });

  it('strictly inside the store: own sales floor, walkable 3 x 3, reachable, off the shopfront, never on a booth opening, never sealing passage, spaced', () => {
    for (const {l, shop, booths, aisle, doors, g, added} of fx) {
      for (const z of added) {
        const [x, y] = g.cellOf(z.x, z.z), i = g.idx(x, y);
        expect(z.level).toBe(shop.level);
        expect(z.area).toBe(shop.area);
        expect(g.area[i]).toBe(shop.area);
        expect(g.walkable(x, y)).toBe(true);
        expect(clearAround(g as never, x, y, 1)).toBe(true);
        expect(z.y).toBe(g.floorOf(i));
        expect(Math.min(...(shop.frontages ?? [shop.frontage]).map(f => rectDist(f, z.x, z.z)))).toBeGreaterThanOrEqual(LINGERIE_SPAWN_RULES.entryKeepM);
        // never in a curtain gap nor on the cell either side of it (booth front row / aisle cell facing it)
        for (const [ox, oy] of [[0, 0], [0, 1], [0, -1]] as const) expect(doors.has(g.idx(x + ox, y + oy)), `${l.seed} spawn at a booth door`).toBe(false);
        expect(sealsPassage(g, z.x, z.z, LINGERIE_SPAWN_RULES.passageRadiusM)).toBe(false);
        const inside = [...booths, aisle].some(q => inRect(q, z.x, z.z));
        if (!inside) {
          // sales-floor spawns keep more than the margin off every changing-area cell
          for (const q of [...booths, aisle]) {
            const [qx0, qy0] = g.cellOf(q.x0, q.z0), [qx1, qy1] = g.cellOf(q.x1 - 0.01, q.z1 - 0.01);
            const dx = Math.max(qx0 - x, 0, x - qx1), dy = Math.max(qy0 - y, 0, y - qy1);
            expect(Math.max(dx, dy)).toBeGreaterThan(LINGERIE_SPAWN_RULES.changingMarginCells);
          }
        }
      }
      for (let a = 0; a < added.length; a++) for (const o of l.zombies) {
        if (o === added[a] || (o.level ?? 0) !== added[a].level) continue;
        if (l.zombies.indexOf(o) > l.zombies.indexOf(added[a])) continue; // spacing is against the enemies placed BEFORE
        expect(Math.hypot(o.x - added[a].x, o.z - added[a].z)).toBeGreaterThanOrEqual(LINGERIE_CONTEXT.placement.spacingM);
      }
    }
  });

  it('appended + tagged: the context and look are lingerie, shamblers, ordinary zombies only through the one family roll', () => {
    for (const {l, first, added} of fx) {
      added.forEach((z, k) => {
        expect(z.look).toBe('lingerie');
        expect(z.type).toBe('shambler');
        expect(z.horde).toBeUndefined();
        expect(spawnContextOf(l, P, first + k)).toBe('lingerie');
      });
      expect(l.zombies.slice(0, first).every(z => z.look === undefined)).toBe(true);
      // the one family roll (+ the Siren spacing) over the level: the store's spawns are zombies, every earlier spawn takes the family
      // it takes without them (their pool never draws a restricted family: nothing counts against a cap or a spacing)
      assignEnemyArchetypes(l, P);
      applyFamilySpacing(l, P);
      expect(added.every(z => z.archetype === 'zombie')).toBe(true);
      const withStore = l.zombies.slice(0, first).map(z => z.archetype);
      const tail = l.zombies.splice(first);
      assignEnemyArchetypes(l, P);
      applyFamilySpacing(l, P);
      expect(l.zombies.map(z => z.archetype)).toEqual(withStore);
      l.zombies.push(...tail);
    }
    expect(LINGERIE_FAMILY_POOL.filter(([, w]) => w > 0)).toEqual([['zombie', 1]]);
    expect(validateSpawnProfile(P)).toEqual([]);
  });

  it('deterministic: the same store, seed and fork give the same spawns; no profile context = no spawns', () => {
    const a = fixture(11), b = fixture(11);
    placeLingerieSpawns(a.l, new Rng(7), keepOf(a.l), P);
    placeLingerieSpawns(b.l, new Rng(7), keepOf(b.l), P);
    expect(JSON.stringify(a.l.zombies)).toBe(JSON.stringify(b.l.zombies));
    const c = fixture(11), n = c.l.zombies.length;
    const {lingerie: _, ...contexts} = P.contexts;
    expect(placeLingerieSpawns(c.l, new Rng(7), keepOf(c.l), {...P, contexts})).toEqual([]);
    expect(c.l.zombies.length).toBe(n);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// Looks (ai/spawnLook.ts)

/** The ordinary library stand-in: the registry defs, every pair fitted; it accepts ordinary looks only. */
const ORDINARY: SpawnLookLibrary = {
  available: {bodies: ZOMBIE_BODIES, wearables: ZOMBIE_WEARABLES, supports: () => true, outfits: ZOMBIE_WEARABLES.filter(w => w.slot === 'upper')} satisfies WardrobeAvailability,
  isValid: look => 'wear' in look && ZOMBIE_BODIES.some(b => b.id === look.body) && Object.values(look.wear).every(w => ZOMBIE_WEARABLES.some(x => x.id === w)),
};
/** A lingerie library stand-in that builds every look of the lingerie bodies with a top + a bottom of one design. */
const LINGERIE_LIB = {isValid: (look: ZombieLook | LegacyZombieLook) => 'wear' in look && (LINGERIE_BODY_IDS as readonly string[]).includes(look.body) && /^lingerie-[a-z]+-top$/.test(look.wear.upper ?? '') && look.wear.lower === look.wear.upper!.replace(/-top$/, '-bottom')};
const spawn = (look?: 'lingerie'): Pick<ZombieSpawn, 'type' | 'look'> => ({type: 'shambler', ...(look ? {look} : {})});

describe('spawn-time looks', () => {
  it('every untagged spawn keeps the ordinary wardrobe pick from the ordinary library (any seed / index / type), lingerie library or not', () => {
    for (let i = 0; i < 64; i++) for (const type of ['shambler', 'coated'] as const) {
      const ordinary = {look: pickZombieLook(1234, i, type, ORDINARY.available), library: 'ordinary'};
      expect(chooseSpawnLook(1234, i, {type}, ORDINARY, LINGERIE_LIB)).toEqual(ordinary);
      expect(chooseSpawnLook(1234, i, {type}, ORDINARY, null)).toEqual(ordinary);
      // the ordinary pool never yields a lingerie garment (they live in the separate library only)
      expect(Object.values(ordinary.look.wear).some(w => /^lingerie-/.test(w!))).toBe(false);
    }
  });

  it('a tagged spawn wears lingerieLook(seed, index) from the lingerie library only when buildable top AND bottom; else the ordinary, fully clothed pick', () => {
    const set: ZombieLook = {body: 'paleGaze', wear: {upper: 'lingerie-green-top', lower: 'lingerie-green-bottom'}};
    expect(lingerieLookUsable(set, LINGERIE_LIB)).toBe(true);
    expect(lingerieLookUsable(set, {isValid: () => false})).toBe(false);
    expect(lingerieLookUsable(set, null)).toBe(false);
    expect(lingerieLookUsable({body: 'paleGaze', wear: {upper: 'x'}}, {isValid: () => true})).toBe(false);
    expect(lingerieLookUsable({body: 'paleGaze', wear: {lower: 'x'}}, {isValid: () => true})).toBe(false);
    expect(lingerieLookUsable(null, {isValid: () => true})).toBe(false);
    for (let i = 0; i < 32; i++) {
      const l = lingerieLook(99, i, look => LINGERIE_LIB.isValid(look)), ordinary = {look: pickZombieLook(99, i, 'shambler', ORDINARY.available), library: 'ordinary'};
      expect(chooseSpawnLook(99, i, spawn('lingerie'), ORDINARY, LINGERIE_LIB)).toEqual(lingerieLookUsable(l, LINGERIE_LIB) ? {look: l, library: 'lingerie'} : ordinary);
      // garments not loaded (no lingerie library) / not fitted: the ordinary pick — never a bare or half-dressed body
      expect(chooseSpawnLook(99, i, spawn('lingerie'), ORDINARY, null)).toEqual(ordinary);
      expect(chooseSpawnLook(99, i, spawn('lingerie'), ORDINARY, {isValid: () => false})).toEqual(ordinary);
    }
  });

  it('lingerieLook is a pure function of (seed, index): a lingerie body with a top + a bottom', () => {
    for (let i = 0; i < 16; i++) {
      const l = lingerieLook(4242, i);
      expect(lingerieLook(4242, i)).toEqual(l);
      expect(LINGERIE_BODY_IDS as readonly string[]).toContain(l.body);
      expect(l.wear.upper && l.wear.lower).toBeTruthy();
    }
  });

  it('the lazy garment keys are asked only for a layout holding a lingerie-tagged spawn', () => {
    expect(lingerieModelKeysFor({zombies: [{x: 0, z: 0, yaw: 0, type: 'shambler', area: 0}]})).toEqual([]);
    expect(lingerieModelKeysFor({zombies: [{x: 0, z: 0, yaw: 0, type: 'shambler', area: 0, look: 'lingerie'}]})).toEqual(Object.keys(LINGERIE_MODEL_FILES).sort());
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// Generated levels: scope, accounting, parity without a store, determinism, persistence

/** Order-sensitive fingerprint of a whole layout (records + every typed array of the grids; shared references hashed once each time). */
function layoutHash(l: StationLayout): string {
  let h = 2166136261;
  const mix = (t: string) => { h = hashString(t, h); };
  const json = JSON.stringify(l, (_k, v) => {
    if (ArrayBuffer.isView(v)) { const b = new Uint8Array(v.buffer, v.byteOffset, v.byteLength); let x = 2166136261; for (let i = 0; i < b.length; i++) x = Math.imul(x ^ b[i], 16777619); return `#${b.length}:${x >>> 0}`; }
    return v;
  });
  mix(json);
  return (h >>> 0).toString(16);
}

const MALL_SEEDS = Array.from({length: 16}, (_, k) => (k % 2 === 0 ? 9100 + 104729 * (k >> 1) : 50021 + 7919 * (k >> 1)));
const malls = new Map<number, StationLayout>();
const mallOf = (seed: number) => { let l = malls.get(seed); if (!l) malls.set(seed, (l = generateMallLevel({levelSeed: seed, startWeapon: 'pistol'}))); return l; };
const {lingerie: _lingerie, ...CONTEXTS_WITHOUT} = P.contexts;
const WITHOUT = {...P, contexts: CONTEXTS_WITHOUT};

describe('generated malls: the store-local variants exist only inside a lingerie store', () => {
  it('every lingerie-tagged spawn stands in its store (own sales floor, walkable, off the shopfront), appended last, context lingerie, an ordinary zombie', () => {
    const report: string[] = [];
    for (const seed of MALL_SEEDS) {
      const l = mallOf(seed), stores = lingerieStores(l);
      const tagged = l.zombies.map((z, i) => [z, i] as const).filter(([z]) => z.look === 'lingerie');
      if (!stores.length) { expect(tagged, `seed ${seed}: no store, no variants`).toEqual([]); report.push(`seed ${seed}: no lingerie store`); continue; }
      expect(stores.length).toBeLessThanOrEqual(1);
      const shop = stores[0], first = l.zombies.findIndex(z => z.look === 'lingerie');
      expect(tagged.length, `seed ${seed}: ${shop.id}`).toBeGreaterThanOrEqual(1);
      expect(tagged.length).toBeLessThanOrEqual(LINGERIE_CONTEXT.count[1]);
      expect(tagged.map(([, i]) => i)).toEqual(tagged.map((_, k) => first + k)); // contiguous ...
      expect(first + tagged.length).toBe(l.zombies.length); // ... and last
      const g = l.levels[shop.level].grid, rects = shop.changing ?? [];
      let inChanging = 0;
      for (const [z, i] of tagged) {
        const [x, y] = g.cellOf(z.x, z.z);
        expect(z.level, `seed ${seed} #${i}`).toBe(shop.level);
        expect(g.area[g.idx(x, y)]).toBe(z.area);
        expect(z.area === shop.area || l.areas[z.area].purpose === shop.fit?.purpose).toBe(true);
        expect(z.area).not.toBe(shop.backroom);
        expect(g.walkable(x, y)).toBe(true);
        expect(clearAround(g as never, x, y, 1)).toBe(true);
        expect(Math.min(...(shop.frontages ?? [shop.frontage]).map(f => rectDist(f, z.x, z.z)))).toBeGreaterThanOrEqual(LINGERIE_SPAWN_RULES.entryKeepM);
        expect(sealsPassage(g, z.x, z.z, LINGERIE_SPAWN_RULES.passageRadiusM)).toBe(false);
        expect([z.type, z.archetype, z.horde]).toEqual(['shambler', 'zombie', undefined]);
        expect(spawnContextOf(l, P, i)).toBe('lingerie');
        if (rects.some(q => inRect(q, z.x, z.z))) inChanging++;
      }
      if (rects.length) expect(inChanging, `seed ${seed}: mostly in the changing area`).toBeGreaterThan(tagged.length / 2);
      report.push(`seed ${seed}: ${shop.id} L${shop.level} ${shop.lot}: ${tagged.length} variants (${inChanging} in the changing area)`);
    }
    process.stdout.write(`\n[mall-lingerie-spawns] generated malls:\n   ${report.join('\n   ')}\n`);
  });

  it('without a lingerie store the level is byte-identical to a generation without the pass; with one, only the appended variants differ', () => {
    for (const seed of MALL_SEEDS.slice(0, 8)) {
      const a = mallOf(seed), b = generateMallLevel({levelSeed: seed, startWeapon: 'pistol'}, {spawns: WITHOUT});
      const n = a.zombies.filter(z => z.look === 'lingerie').length;
      if (!lingerieStores(a).length) { expect(n).toBe(0); expect(layoutHash(a), `seed ${seed}`).toBe(layoutHash(b)); continue; }
      // the store's variants are the only difference: every other spawn (index, family, position) and every other record is identical
      expect(JSON.stringify(a.zombies.slice(0, a.zombies.length - n))).toBe(JSON.stringify(b.zombies));
      const tail = a.zombies.splice(a.zombies.length - n);
      try { expect(layoutHash(a), `seed ${seed}`).toBe(layoutHash(b)); } finally { a.zombies.push(...tail); }
      for (let i = 0; i < b.zombies.length; i++) expect(spawnContextOf(a, P, i)).toBe(spawnContextOf(b, WITHOUT, i));
    }
  });

  it('deterministic across rebuilds (revisit / streaming / Retry regenerate the same spawns and looks); kills by index never come back', () => {
    const seed = MALL_SEEDS.find(s => lingerieStores(mallOf(s)).length) ?? MALL_SEEDS[0];
    const a = mallOf(seed), b = generateMallLevel({levelSeed: seed, startWeapon: 'pistol'});
    expect(JSON.stringify(b.zombies)).toBe(JSON.stringify(a.zombies));
    const look = (l: StationLayout) => l.zombies.map((z, i) => chooseSpawnLook(l.seed, i, z, ORDINARY, LINGERIE_LIB));
    expect(look(b)).toEqual(look(a));
    look(a).forEach((c, i) => expect(c.library).toBe(a.zombies[i].look === 'lingerie' && lingerieLookUsable(lingerieLook(a.seed, i, look => LINGERIE_LIB.isValid(look)), LINGERIE_LIB) ? 'lingerie' : 'ordinary'));
    // a killed variant stays dead on the rebuilt section (per-index memory): no reroll, no duplicate respawn
    const mem = createMemory({level: 'mall', section: 'main'});
    const tagged = a.zombies.flatMap((z, i) => (z.look === 'lingerie' ? [i] : []));
    mem.killed.push(...tagged.slice(0, 2));
    const live = enemiesToSpawn(b.zombies.length, mem);
    expect(live.filter(i => tagged.slice(0, 2).includes(i))).toEqual([]);
    expect(live.length).toBe(b.zombies.length - Math.min(2, tagged.length));
    expect(new Set(live).size).toBe(live.length);
  });
});

describe('no lingerie leak to any other level', () => {
  const LEVELS_TO_SCAN: [LevelId, number[]][] = [['subway', [11, 222, 3333]], ['office', [11, 222]], ['reactor', [11, 222]]];
  it('Subway / Office / Reactor: no spawn carries the lingerie look or context; every look is the ordinary pick; no garment is fetched', () => {
    for (const [id, seeds] of LEVELS_TO_SCAN) for (const seed of seeds) {
      const l = LEVELS[id].generate('main', {levelSeed: seed, startWeapon: 'pistol'});
      expect(l.zombies.length, `${id} ${seed}`).toBeGreaterThan(0);
      expect(l.zombies.filter(z => z.look !== undefined), `${id} ${seed}`).toEqual([]);
      expect(lingerieStores(l)).toEqual([]);
      expect(lingerieModelKeysFor(l)).toEqual([]);
      l.zombies.forEach((z, i) => {
        expect(spawnContextOf(l, spawnProfileOf(id), i)).not.toBe('lingerie');
        expect(chooseSpawnLook(l.seed, i, z, ORDINARY, LINGERIE_LIB)).toEqual({look: pickZombieLook(l.seed, i, z.type, ORDINARY.available), library: 'ordinary'});
      });
    }
  });

  it('the mall: hordes, annex spawns, ambient spawns (other stores, even inside the lingerie store) keep the ordinary pick', () => {
    for (const seed of MALL_SEEDS) {
      const l = mallOf(seed);
      l.zombies.forEach((z, i) => {
        if (z.look === 'lingerie') return;
        expect(spawnContextOf(l, P, i)).not.toBe('lingerie');
        expect(chooseSpawnLook(l.seed, i, z, ORDINARY, LINGERIE_LIB).library).toBe('ordinary');
      });
      if (!lingerieStores(l).length) expect(lingerieModelKeysFor(l)).toEqual([]);
    }
  });
});
