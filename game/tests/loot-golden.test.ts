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
// PIN HISTORY (seven stages):
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
//  4. Task office-props-physics-scale-20261030 (user feedback 5–9: deliberate Office content / geometry changes; Subway hashes and
//     the gear ROLL unchanged): officeHolders bebd9642 -> c36c5fba, officePickups f0e0d3d4 -> 1aa35d40, gearPlaced da46e2b8 ->
//     2bc1c5bb. Causes: the server rack r2 (0.6 x 2.0 x 1.0 m, was 1.23 x 2.0 x 1.48) with its own bays and SERVER rows (electrical
//     parts / scrap metal); furniture-only rescales (lab bench, trading desk, bean bag, bakery case, foosball / ping-pong legs,
//     drafting table, espresso machine onto a sideboard counter, mixing console on a riser) that move company placements; the
//     bakery case as a bread holder; bio mater in lab drawers; host-top clutter kinds; and a 1.5 m turning square reserved inside
//     small office rooms (placeKit.makePlaceCtx). Different furniture sizes re-route the seeded office dressing, so the loose floor
//     supplies and gear spots move with it (the per-storey programs and the one gear roll per logical level are unchanged).
//  5. Task gas-mask-roof-feedback-20261030 (+ merge of main a0cf99a, after stage 4) (user item 10, the explicit ROOF exception): the Office appends its roof FIND (one gun +
//     its own ammo box, or a gear piece: PickupPlacement.reward = ROOF_FIND_KEY) LAST in layout.pickups. Every other hash is
//     byte-identical to main's stage 4 — officeHolders c36c5fba, gearRolls 77148ba3, gearPlaced 2bc1c5bb, both Subway hashes — and
//     officePickups 1aa35d40 is now pinned over the NON-reward pickups (identical: no storey's floor supplies / weapon finds moved); the roof
//     find's own pickups get the new pin officeRoofFind 3ba3548d (4 pickups over the 3 seeds; all pickups together would read
//     8fe99b7a).
//  6. Track 2 — Beyond the Station (lane GEN, track extensions; no loot / gear rule changed): tunnels past the bed ends + service
//     annexes are appended AFTER every core pass and carry no loot yet; when one reaches west / north the finished core station
//     is re-framed (translated) into the larger grid, so absolute pickup x / z of those stations move (subwayPickups 574dd442 ->
//     c335d6e0) and the gear placed on them too (gearPlaced 2bc1c5bb -> f392f088: placed in the core frame — gen/gearLoot.ts placeGear
//     on coreView — then translated; the same areas / cells; gear never lands in an extension — gearAreaWeight). Translation-normalised proof, every run: the same hashes over
//     gen/trackExt coreView(layout) (the core window, records translated back to the core frame at their exact core-frame
//     positions, extension records filtered) reproduce stage 5 byte for byte (GOLDEN_CORE = the stage-5 values). Holder lots
//     (holder-local positions), the Office (grows east / south, never translated) and the gear ROLL are unchanged.
//  7. Track 2 — Beyond the Station (lane CONTENT): the service annexes are dressed and stocked (gen/annexContent.ts, own fork
//     `track-ext-content`, after finishExtensions): their holders (room purposes' tables for each annex's deepest ~8 holders, the
//     stash key ANNEX_STASH_KEY, the picked-over key ANNEX_PICKED_KEY for the rest) are APPENDED after every core prop (holder
//     indices of the core unchanged) and their loose floor program (items/lootTables.ts ANNEX_FLOOR) after every core pickup (the
//     Office's roof find stays the last CORE pickup; the annex finds follow it). Cause of the re-pin: the LIVE hashes of layouts
//     with an annex — subwayHolders f94f99ea -> 99f2eb41, subwayPickups c335d6e0 -> 7f51f46b, officeHolders c36c5fba -> 595d8a54,
//     officePickups 1aa35d40 -> b8b6ff4e. Proof, every run: the core views (coreView now also filters the extensions' appended
//     props / pickups) reproduce stage 6 / 5 byte for byte (GOLDEN_CORE: subwayHolders f94f99ea, subwayPickups 574dd442,
//     officeHolders c36c5fba, officePickups 1aa35d40, the roof find 3ba3548d, gearPlaced 2bc1c5bb); the gear roll 77148ba3 and the
//     live gear placement f392f088 are unchanged (gear spacing ignores the annexes' finds: gen/gearLoot.ts).

import {describe, expect, it} from 'vitest';
import {generateStation} from '../src/gen/station';
import {generateOfficeLevel} from '../src/gen/office/index';
import {placeSectionGear, rollLevelGear} from '../src/gen/gearLoot';
import type {PickupPlacement, StationLayout} from '../src/gen/stationTypes';
import type {LevelId} from '../src/levels/types';
import {ECONOMY_CORPUS, layoutHolders} from './helpers/lootEconomy';
import {ROOF_FIND_KEY} from '../src/items/lootTables';
import {coreView} from '../src/gen/trackExt/index';

/** Stage 4: office-props-physics-scale; stage 5: + the roof find (stages 1–3 in the header). */
/** Stage 5 (main): the core views of the live layouts reproduce these byte for byte (stage 6 proof). */
const GOLDEN_CORE = {subwayHolders: 'f94f99ea', subwayPickups: '574dd442', gearPlaced: '2bc1c5bb', officeHolders: 'c36c5fba', officePickups: '1aa35d40'};
const GOLDEN = {
  /** Stage 7 (Track 2 CONTENT): + the service annexes' holders (core view: GOLDEN_CORE.subwayHolders; stage 6 f94f99ea). */
  subwayHolders: '99f2eb41',
  /** Stage 7: + the annexes' floor finds (stage 6: translated stations' pickups c335d6e0; core view: GOLDEN_CORE.subwayPickups). */
  subwayPickups: '7f51f46b',
  /** Stage 7: + the annexes' holders (stage 5 / 6 c36c5fba = GOLDEN_CORE.officeHolders). */
  officeHolders: '595d8a54',
  /** The Office's layout pickups WITHOUT the roof find's; stage 7: + the annexes' floor finds (stage 5 / 6 1aa35d40 = core view). */
  officePickups: 'b8b6ff4e',
  /** Stage 5: the roof find's own pickups (PickupPlacement.reward). */
  officeRoofFind: '3ba3548d',
  gearRolls: '77148ba3',
  /** Stage 6 (Track 2): gear on translated stations (core view: GOLDEN_CORE.gearPlaced). */
  gearPlaced: 'f392f088',
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
    const fh = fnv(), fp = fnv(), fc = fnv(), fhc = fnv();
    let holders = 0, lots = 0, pickups = 0;
    for (const l of subway()) {
      const n = mixHolders(fh, l);
      holders += n.holders; lots += n.lots;
      mixPickups(fp, l.pickups);
      pickups += l.pickups.length;
      // stage 6 proof: the core view (Track 2 extensions out, translated back) hashes exactly as main did
      const c = coreView(l);
      mixHolders(fhc, c);
      mixPickups(fc, c.pickups);
    }
    report('subwayHolders', fh.hex(), `${holders} holders, ${lots} lots`);
    report('subwayPickups', fp.hex(), `${pickups} pickups`);
    report('subwayPickups (core view)', fc.hex());
    report('subwayHolders (core view)', fhc.hex());
    expect(fhc.hex()).toBe(GOLDEN_CORE.subwayHolders);
    expect(fc.hex()).toBe(GOLDEN_CORE.subwayPickups);
    expect(fh.hex()).toBe(GOLDEN.subwayHolders);
    expect(fp.hex()).toBe(GOLDEN.subwayPickups);
  });

  it('Office holder lots + pickups (level seeds 11 / 222 / 3333); the roof find hashed on its own (stage 4)', () => {
    const fh = fnv(), fp = fnv(), fr = fnv(), fhc = fnv(), fpc = fnv(), frc = fnv();
    let holders = 0, lots = 0, pickups = 0, finds = 0;
    const roofSplit = (list: readonly PickupPlacement[]) => {
      // the roof find comes LAST of the core's pickups: every earlier pickup keeps its index (stage 7: the service annexes' own
      // floor finds follow it — appended after every core record, in extension areas)
      const own = list.filter(p => p.reward === ROOF_FIND_KEY), first = list.findIndex(p => p.reward === ROOF_FIND_KEY);
      const rest = list.filter(p => p.reward !== ROOF_FIND_KEY);
      return {own, rest, first};
    };
    for (const l of office()) {
      const n = mixHolders(fh, l);
      holders += n.holders; lots += n.lots;
      const live = roofSplit(l.pickups);
      mixPickups(fp, live.rest);
      pickups += live.rest.length;
      mixPickups(fr, live.own);
      finds += live.own.length;
      // stage 7 proof: the core view (the annexes' holders / finds out) hashes exactly as stage 5, its roof find last
      const c = coreView(l), core = roofSplit(c.pickups);
      expect(c.pickups.slice(core.first).every(p => p.reward === ROOF_FIND_KEY)).toBe(true);
      expect(l.pickups.slice(0, c.pickups.length)).toEqual(c.pickups); // (the Office never translates: same objects' values)
      mixHolders(fhc, c);
      mixPickups(fpc, core.rest);
      mixPickups(frc, core.own);
    }
    report('officeHolders', fh.hex(), `${holders} holders, ${lots} lots`);
    report('officePickups', fp.hex(), `${pickups} pickups`);
    report('officeRoofFind', fr.hex(), `${finds} pickups`);
    report('officeHolders / officePickups / officeRoofFind (core view)', `${fhc.hex()} / ${fpc.hex()} / ${frc.hex()}`);
    expect(fhc.hex()).toBe(GOLDEN_CORE.officeHolders);
    expect(fpc.hex()).toBe(GOLDEN_CORE.officePickups);
    expect(frc.hex()).toBe(GOLDEN.officeRoofFind);
    expect(fh.hex()).toBe(GOLDEN.officeHolders);
    expect(fp.hex()).toBe(GOLDEN.officePickups);
    expect(fr.hex()).toBe(GOLDEN.officeRoofFind);
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
    const fp = fnv(), fc = fnv();
    const place = (l: StationLayout, level: LevelId, levelSeed: number) => {
      const before = l.pickups.length, coreBefore = coreView(l).pickups.length; // (stage 7: the annexes' finds are not in the core view)
      const rolled = rollLevelGear(levelSeed, level, ['main']).main;
      const all = ['armor_vest', 'chest_rig', 'backpack', 'helmet', 'boots', 'gloves'].map(itemId => ({itemId}));
      const placed = placeSectionGear(l, [...rolled, ...all]);
      mixPickups(fp, placed);
      // stage 6 proof: the same gear in the core frame (gear never lands in an extension)
      mixPickups(fc, coreView(l).pickups.slice(coreBefore));
      l.pickups.length = before; // the cached layout stays as generated
    };
    subway().slice(0, 6).forEach((l, i) => place(l, 'subway', ECONOMY_CORPUS[i].seed));
    office().forEach((l, i) => place(l, 'office', OFFICE_SEEDS[i]));
    report('gearPlaced', fp.hex());
    report('gearPlaced (core view)', fc.hex());
    expect(fc.hex()).toBe(GOLDEN_CORE.gearPlaced);
    expect(fp.hex()).toBe(GOLDEN.gearPlaced);
  });
});
