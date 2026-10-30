// Task loot-tables-20261030 (lane LOOT): GOLDEN loot hashes, captured at main dfb3a06 BEFORE the loot-table refactor
// (items/lootTables.ts: per-logical-level profiles, slot categories, resolution API). The baseline profiles must reproduce
// today's loot byte for byte, so these hashes must never change with a pure refactor:
//  - holder lots (id, item, count, compartment, surface, x / y / z, yaw, orientation) of every loot holder, rolled with the
//    ContainerManager.build index rules (tests/helpers/lootEconomy.ts layoutHolders), over the 18-station Subway economy corpus
//    and three Office levels (seeds 11 / 222 / 3333, pistol start);
//  - the generated layout.pickups (loose floor supplies, level-moved supplies, weapon finds + paired ammo) of the same layouts;
//  - the rare-gear roll of both logical levels (key `gear-roll:${levelId}`, 400 level seeds each) and its placement on the layouts.
// A deliberate tuning change WILL move them: then explain the cause in the change (what moved and why) before re-pinning.
// Never re-pin to make a refactor pass. Bounded corpus: 18 stations + 3 office levels (~ the loot-economy suite's cost).
//
// PIN HISTORY (two stages):
//  1. Refactor-only parity at main dfb3a06 (captured BEFORE any lane LOOT source change, unchanged after the refactor):
//     subwayHolders 13fea6a9, subwayPickups 11e78cc6, officeHolders ca913cb0, officePickups 77bb9b0e, gearRolls 77148ba3,
//     gearPlaced 1a7b07f0.
//  2. Post-merge parity with main 4adb91c (PR #5 knife + caliber ammo: ammo_9mm / ammo_556 / ammo_12ga, generic ~1/3 ammo rows,
//     new 9mm box sizes; PR #6 debug overlay): main's own hashes, computed with this unchanged test in a main worktree, are
//     reproduced byte for byte by the merged tree (the calibre data ported into items/lootTables.ts). The change from stage 1 is
//     attributable to the authorized calibre-ammo merge #5, not to the loot-table refactor; gear is unchanged.
//  3. Task office-interactions-layout-20261030 (deliberate Office content / geometry changes; Subway and the gear ROLL unchanged):
//     officeHolders 0dedc0d9 -> bebd9642: nine office storage kinds became openable holders with container-themed tables (lane
//     OPEN), the roof cache reward crate (lane ROOF), and the new seeded floor plans / furnishing (lane LAYOUT: different rooms,
//     holders and index order; incl. the compact-room adjustment made for main's gas field, PR #8: paired end-zone rooms,
//     <= 76 m² rooms, >= 86 m² open plans, one normal door in shallow-band rooms); officePickups 7b266d40 -> f0e0d3d4 and
//     gearPlaced 1a7b07f0 -> da46e2b8: the same floor-plan
//     change moves the loose floor supplies and gear spots (the per-storey supply programs and the one gear roll per logical
//     level are unchanged). Subway hashes f94f99ea / 574dd442 and gearRolls 77148ba3 are byte-identical.

import {describe, expect, it} from 'vitest';
import {generateStation} from '../src/gen/station';
import {generateOfficeLevel} from '../src/gen/office/index';
import {placeSectionGear, rollLevelGear} from '../src/gen/gearLoot';
import type {PickupPlacement, StationLayout} from '../src/gen/stationTypes';
import type {LevelId} from '../src/levels/types';
import {ECONOMY_CORPUS, layoutHolders} from './helpers/lootEconomy';

/** Stage 3: office-interactions-layout (stages 1 / 2 in the header). */
const GOLDEN = {
  subwayHolders: 'f94f99ea',
  subwayPickups: '574dd442',
  officeHolders: 'bebd9642',
  officePickups: 'f0e0d3d4',
  gearRolls: '77148ba3',
  gearPlaced: 'da46e2b8',
};

function fnv() {
  let h = 0x811c9dc5 >>> 0;
  return {
    mix(s: string) { for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } },
    hex: () => h.toString(16).padStart(8, '0'),
  };
}
const r = (v: number) => (Math.round(v * 1000) / 1000).toString();

function mixHolders(f: ReturnType<typeof fnv>, l: StationLayout): {holders: number; lots: number} {
  let lots = 0;
  const hs = layoutHolders(l);
  f.mix(`L${l.seed}`);
  for (const h of hs) {
    f.mix(`H${h.kind}#${h.index}@${h.areaType}:`);
    for (const t of h.lots) {
      lots++;
      f.mix(`${t.id}${t.itemId}x${t.count}p${t.part ?? '-'}s${t.surface}(${r(t.x)},${r(t.y)},${r(t.z)})${r(t.yaw)}${t.orient};`);
    }
  }
  return {holders: hs.length, lots};
}
function mixPickups(f: ReturnType<typeof fnv>, list: readonly PickupPlacement[]): void {
  for (const p of list) f.mix(`K${p.itemId}x${p.count}(${r(p.x)},${r(p.y)},${r(p.z)})a${p.area}l${p.level ?? 0};`);
}

const subway = (() => { let c: StationLayout[] | null = null; return () => (c ??= ECONOMY_CORPUS.map(s => generateStation(s.seed, {startWeapon: 'pistol'}))); })();
const OFFICE_SEEDS = [11, 222, 3333];
const office = (() => { let c: StationLayout[] | null = null; return () => (c ??= OFFICE_SEEDS.map(levelSeed => generateOfficeLevel({levelSeed, startWeapon: 'pistol'}))); })();
const report = (name: string, hash: string, extra = '') => process.stdout.write(`[loot-golden] ${name}: ${hash}${extra ? ` (${extra})` : ''}\n`);

describe('loot golden (baseline profiles reproduce dfb3a06 exactly)', () => {
  it('Subway holder lots + pickups over the 18-station economy corpus', () => {
    const fh = fnv(), fp = fnv();
    let holders = 0, lots = 0, pickups = 0;
    for (const l of subway()) {
      const n = mixHolders(fh, l);
      holders += n.holders; lots += n.lots;
      mixPickups(fp, l.pickups);
      pickups += l.pickups.length;
    }
    report('subwayHolders', fh.hex(), `${holders} holders, ${lots} lots`);
    report('subwayPickups', fp.hex(), `${pickups} pickups`);
    expect(fh.hex()).toBe(GOLDEN.subwayHolders);
    expect(fp.hex()).toBe(GOLDEN.subwayPickups);
  });

  it('Office holder lots + pickups (level seeds 11 / 222 / 3333)', () => {
    const fh = fnv(), fp = fnv();
    let holders = 0, lots = 0, pickups = 0;
    for (const l of office()) {
      const n = mixHolders(fh, l);
      holders += n.holders; lots += n.lots;
      mixPickups(fp, l.pickups);
      pickups += l.pickups.length;
    }
    report('officeHolders', fh.hex(), `${holders} holders, ${lots} lots`);
    report('officePickups', fp.hex(), `${pickups} pickups`);
    expect(fh.hex()).toBe(GOLDEN.officeHolders);
    expect(fp.hex()).toBe(GOLDEN.officePickups);
  });

  it('rare gear: one roll per logical level (400 seeds each) and its placement on the layouts', () => {
    const fr = fnv();
    let items = 0;
    for (const level of ['subway', 'office'] as LevelId[]) {
      for (let seed = 0; seed < 400; seed++) {
        const g = rollLevelGear(seed * 7919 + 13, level, ['main']).main;
        items += g.length;
        fr.mix(`${level}${seed}:${g.map(x => x.itemId).join(',')};`);
      }
    }
    report('gearRolls', fr.hex(), `${items} items`);
    expect(fr.hex()).toBe(GOLDEN.gearRolls);
    // Placement of each layout's real level roll (plus the full set, so placement is exercised even when the roll is empty).
    const fp = fnv();
    const place = (l: StationLayout, level: LevelId, levelSeed: number) => {
      const before = l.pickups.length;
      const rolled = rollLevelGear(levelSeed, level, ['main']).main;
      const all = ['armor_vest', 'chest_rig', 'backpack', 'helmet', 'boots', 'gloves'].map(itemId => ({itemId}));
      mixPickups(fp, placeSectionGear(l, [...rolled, ...all]));
      l.pickups.length = before; // the cached layout stays as generated
    };
    subway().slice(0, 6).forEach((l, i) => place(l, 'subway', ECONOMY_CORPUS[i].seed));
    office().forEach((l, i) => place(l, 'office', OFFICE_SEEDS[i]));
    report('gearPlaced', fp.hex());
    expect(fp.hex()).toBe(GOLDEN.gearPlaced);
  });
});
