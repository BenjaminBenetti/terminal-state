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
//  7. Track 2 lane GEN-2, SUBWAY ONLY — CAUSE: "core reserve enabled (authorized incidence change)" (no loot / gear rule changed).
//     The Subway's TRACK_EXT.coreReserveM = 40 keeps 40 m of rock past every bed end still open after the archetype skeleton
//     (gen/trackExt/index.ts reserveTunnelRoom), so later station growth plans around it: a LAYOUT change of the core station
//     (rooms, holders, loose supplies and gear spots move with it). PROOF, every run: generated with the reserve OFF
//     ({...TRACK_EXT, coreReserveM: 0}, tests/helpers/trackExtCore.ts; the GEN-2 planner and service hatches otherwise live),
//     the core views reproduce stage 6's core values byte for byte (GOLDEN_CORE: subwayHolders f94f99ea, subwayPickups 574dd442,
//     gearPlaced 2bc1c5bb) — the extensions still carry no loot and never touch the core. The live layouts (reserve on) are
//     re-pinned: subwayHolders f94f99ea -> fdce066e, subwayPickups c335d6e0 -> 3787f796, gearPlaced f392f088 -> fee77ca3;
//     their core views as GOLDEN_RESERVE (fdce066e / 6883e55a / 3d2b40a1). Holder lots are holder-local, so the live and core
//     holder hashes agree. The Office (TRACK_EXT_OFFICE: no reserve), every Office hash and the gear ROLL are unchanged.
//  8. Track 2 integration, SUBWAY ONLY — CAUSE: "openable wall mounts are never placed hidden behind a tall floor prop" (root
//     CLAUDE.md prop rule 1; gen/props07Dress.ts tallInFront; evidence and seed list in tests/enemy-spawn-parity.test.ts pin
//     stage 6: every changed layout had a first-aid kit / AED cabinet the old code hid behind a tall floor prop). Changed corpus
//     stations: reserve off econ 9120 / 183338 (+ others in GEN's corpus), reserve on econ 48715. Re-pinned: GOLDEN_CORE (reserve
//     off) subwayHolders f94f99ea -> 2e86346d, subwayPickups 574dd442 -> 4afa77bf; GOLDEN_RESERVE fdce066e -> a978aeed /
//     6883e55a -> 745b6481; GOLDEN subwayHolders fdce066e -> a978aeed, subwayPickups 3787f796 -> e83c7811. gearPlaced (all three),
//     every Office hash and the gear ROLL are unchanged.
//  9. Track 2 — Beyond the Station (lane CONTENT): the service annexes (off tunnels and service hatches) are dressed and stocked
//     (gen/annexContent.ts, own fork `track-ext-content`, after finishExtensions): their holders (room purposes' tables for each
//     annex's deepest ~7 holders, the stash key ANNEX_STASH_KEY, the picked-over key ANNEX_PICKED_KEY for the rest) are APPENDED
//     after every core prop (core holder indices unchanged) and their loose floor program (items/lootTables.ts ANNEX_FLOOR) after
//     every core pickup (the Office's roof find stays the last CORE pickup; the annex finds follow it). Cause of the re-pin: the
//     LIVE hashes of layouts with an annex — subwayHolders, subwayPickups, officeHolders, officePickups (values below, previous ones
//     beside them). Proof, every run: the core views (coreView also filters the extensions' appended props / pickups) reproduce
//     GOLDEN_RESERVE / GOLDEN_CORE byte for byte (now incl. officeHolders c36c5fba / officePickups 1aa35d40 and the roof find
//     3ba3548d); the gear roll and every gear placement hash are unchanged (gear spacing ignores the annexes' finds).
// 10. Task track2-playtest-revision-20261031 (lane ROOMS) — CAUSE: "annex machinery halls + room signatures" (user feedback 4 / 5):
//     the annexes grow 2-3 larger machinery halls (gen/trackExt/carve.ts) and take room signatures with anchored machinery and
//     LEAN furniture (gen/annexRooms.ts: fewer, meaningful holders - the corpus' live holder count is now 5953 over 18 stations), so every
//     annex holder / floor find is re-laid and the crop translation of extended stations changes. Re-pinned LIVE hashes only:
//     subwayHolders e4c02d0b -> 63f11838, subwayPickups f3f6cbd3 -> 5ae2b384, officeHolders 595d8a54 -> f07d82e0, officePickups
//     b8b6ff4e -> 92a1d2ed, gearPlaced fee77ca3 -> 879dd375 (the live gear coordinates of translated stations; its core-frame
//     placement is unchanged). PROOF, every run: GOLDEN_CORE / GOLDEN_RESERVE (incl. both core gearPlaced hashes), the roof find
//     and the gear roll are byte-identical; no loot table, rule or roll changed.
// 11. Track 2 playtest revision (task studio-alpha-track2-playtest-revision-20261031-01, primary) — LIVE only. CAUSE: the user's two
//     fresh runs found no annex loot; diagnosis (reference/tasks/track2-playtest-revision-20261031/DIAGNOSIS-BASELINE.md): 94-98 % of
//     annex holders rolled empty (the picked-over / stash tables were cut a second time by the level-wide scarcity economy). Now the
//     annex tables roll exactly (LootSpec.exact), supply / scraps / searched-clean classes by depth band (gen/annexContent.ts
//     pickOver), one storage piece per bare annex room, the service budget / bands, the station-surface invitation art. Re-pinned:
//     subwayHolders 63f11838 -> fe63d0aa, subwayPickups 5ae2b384 -> 0467b2d6, officeHolders f07d82e0 -> 0c130bc9, officePickups
//     92a1d2ed -> 5fa98572. Every core view, the reserve-off proof, the Office roof find and the gear roll / placement are unchanged.
// 12. Same task, after merging main ce83b48 (mall revision) — LIVE holders only. CAUSE: CI found crafting materials in the annex
//     supply / scraps rows (a Subway must never hold a material: craft-materials / office-openables), so they are removed; the supply
//     depth bands are thirds of the annex ROOMS' door-hop range (was: its holders'), so "entry" means the first rooms walked into.
//     Re-pinned: subwayHolders fe63d0aa -> 5c456623, officeHolders 0c130bc9 -> 7e08e006 (holder and lot counts unchanged); every
//     pickup hash, core view, the reserve-off proof, the roof find and the gear roll / placement are unchanged.

import {describe, expect, it} from 'vitest';
import {generateStation} from '../src/gen/station';
import {generateOfficeLevel} from '../src/gen/office/index';
import {placeSectionGear, rollLevelGear} from '../src/gen/gearLoot';
import type {PickupPlacement, StationLayout} from '../src/gen/stationTypes';
import type {LevelId} from '../src/levels/types';
import {ECONOMY_CORPUS, layoutHolders} from './helpers/lootEconomy';
import {ROOF_FIND_KEY} from '../src/items/lootTables';
import {coreView} from '../src/gen/trackExt/index';
import {TRACK_EXT_RESERVE_OFF} from './helpers/trackExtCore';

/** Stage 4: office-props-physics-scale; stage 5: + the roof find (stages 1–3 in the header). */
/**
 * Stage 5 (main): the core views of the layouts generated with the core reserve OFF reproduce these byte for byte (stage 6 / 7
 * proof: the extensions never touch the core).
 */
const GOLDEN_CORE = {subwayHolders: '2e86346d', subwayPickups: '4afa77bf', gearPlaced: '2bc1c5bb', officeHolders: 'c36c5fba', officePickups: '1aa35d40'}; // stage 8 / 9
/** Stage 7 (GEN-2): the core views of the live layouts — the core stations with the reserve (a layout change). */
const GOLDEN_RESERVE = {subwayHolders: 'a978aeed', subwayPickups: '745b6481', gearPlaced: '3d2b40a1'}; // stage 8
const GOLDEN = {
  /** Stage 7 (GEN-2): the core stations with the reserve (the extensions carry no holders). */
  subwayHolders: '5c456623', // stage 12: was fe63d0aa; stage 11: was 63f11838; stage 10 (annex halls / signatures); stage 9: e4c02d0b (+ the service annexes' holders)
  /** Stage 6 (Track 2): translated stations' pickups; stage 7: + the core reserve; stage 8: + the hidden-mount fix. */
  subwayPickups: '0467b2d6', // stage 11: was 5ae2b384; stage 10; stage 9: f3f6cbd3 (+ the annexes' floor finds)
  officeHolders: '7e08e006', // stage 12: was 0c130bc9; stage 11: was f07d82e0; stage 10; stage 9: 595d8a54 (+ the annexes' holders)
  /** The Office's layout pickups WITHOUT the roof find's (stage 5: main's stage-4 hash, unchanged). */
  officePickups: '5fa98572', // stage 11: was 92a1d2ed; stage 10; stage 9: b8b6ff4e (+ the annexes' floor finds)
  /** Stage 5: the roof find's own pickups (PickupPlacement.reward). */
  officeRoofFind: '3ba3548d',
  gearRolls: '77148ba3',
  /** Stage 6 (Track 2): gear on translated stations; stage 7: + the core reserve. */
  gearPlaced: '879dd375', // stage 10 (translated live coordinates); was fee77ca3
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
/** Stage 7 proof: the same corpus with the core reserve OFF. */
const subwayOff = (() => { let c: StationLayout[] | null = null; return () => (c ??= ECONOMY_CORPUS.map(s => generateStation(s.seed, {startWeapon: 'pistol', trackExtensions: TRACK_EXT_RESERVE_OFF}))); })();
const OFFICE_SEEDS = [11, 222, 3333];
const office = (() => { let c: StationLayout[] | null = null; return () => (c ??= OFFICE_SEEDS.map(levelSeed => generateOfficeLevel({levelSeed, startWeapon: 'pistol'}))); })();
const report = (name: string, hash: string, extra = '') => process.stdout.write(`[loot-golden] ${name}: ${hash}${extra ? ` (${extra})` : ''}\n`);

describe('loot golden (baseline profiles reproduce dfb3a06 exactly)', () => {
  it('Subway holder lots + pickups over the 18-station economy corpus', () => {
    const fh = fnv(), fp = fnv(), fc = fnv(), fhc = fnv(), fo = fnv(), fho = fnv();
    let holders = 0, lots = 0, pickups = 0;
    for (const l of subway()) {
      const n = mixHolders(fh, l);
      holders += n.holders; lots += n.lots;
      mixPickups(fp, l.pickups);
      pickups += l.pickups.length;
      // the core view (Track 2 extensions out, translated back): the core station with the reserve (stage 7)
      const c = coreView(l);
      mixHolders(fhc, c);
      mixPickups(fc, c.pickups);
    }
    // stage 6 / 7 proof: with the core reserve OFF, the core view hashes exactly as main did
    for (const l of subwayOff()) { const c = coreView(l); mixHolders(fho, c); mixPickups(fo, c.pickups); }
    report('subwayHolders', fh.hex(), `${holders} holders, ${lots} lots`);
    report('subwayPickups', fp.hex(), `${pickups} pickups`);
    report('subwayHolders / subwayPickups (core view)', `${fhc.hex()} / ${fc.hex()}`);
    report('subwayHolders / subwayPickups (core view, reserve off)', `${fho.hex()} / ${fo.hex()}`);
    expect(fho.hex()).toBe(GOLDEN_CORE.subwayHolders);
    expect(fo.hex()).toBe(GOLDEN_CORE.subwayPickups);
    expect(fhc.hex()).toBe(GOLDEN_RESERVE.subwayHolders);
    expect(fc.hex()).toBe(GOLDEN_RESERVE.subwayPickups);
    expect(fh.hex()).toBe(GOLDEN.subwayHolders);
    expect(fp.hex()).toBe(GOLDEN.subwayPickups);
  });

  it('Office holder lots + pickups (level seeds 11 / 222 / 3333); the roof find hashed on its own (stage 4)', () => {
    const fh = fnv(), fp = fnv(), fr = fnv(), fhc = fnv(), fpc = fnv(), frc = fnv();
    let holders = 0, lots = 0, pickups = 0, finds = 0;
    const roofSplit = (list: readonly PickupPlacement[]) => ({own: list.filter(p => p.reward === ROOF_FIND_KEY), rest: list.filter(p => p.reward !== ROOF_FIND_KEY), first: list.findIndex(p => p.reward === ROOF_FIND_KEY)});
    for (const l of office()) {
      const n = mixHolders(fh, l);
      holders += n.holders; lots += n.lots;
      const live = roofSplit(l.pickups);
      mixPickups(fp, live.rest);
      pickups += live.rest.length;
      mixPickups(fr, live.own);
      finds += live.own.length;
      // the roof find comes LAST of the CORE's pickups: every earlier pickup keeps its index (stage 9: a service annex's own floor
      // finds follow it — appended after every core record, in extension areas); the core view hashes as stage 5
      const c = coreView(l), core = roofSplit(c.pickups);
      expect(c.pickups.slice(core.first).every(p => p.reward === ROOF_FIND_KEY)).toBe(true);
      expect(l.pickups.slice(0, c.pickups.length)).toEqual(c.pickups); // (the Office never translates)
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
    const fp = fnv(), fc = fnv(), fo = fnv();
    const place = (l: StationLayout, level: LevelId, levelSeed: number, f: ReturnType<typeof fnv> | null, core: ReturnType<typeof fnv>) => {
      const before = l.pickups.length, coreBefore = coreView(l).pickups.length; // (stage 9: the annexes' finds are not in the core view)
      const rolled = rollLevelGear(levelSeed, level, ['main']).main;
      const all = ['armor_vest', 'chest_rig', 'backpack', 'helmet', 'boots', 'gloves'].map(itemId => ({itemId}));
      const placed = placeSectionGear(l, [...rolled, ...all]);
      if (f) mixPickups(f, placed);
      // stage 6 proof: the same gear in the core frame (gear never lands in an extension)
      mixPickups(core, coreView(l).pickups.slice(coreBefore));
      l.pickups.length = before; // the cached layout stays as generated
    };
    subway().slice(0, 6).forEach((l, i) => place(l, 'subway', ECONOMY_CORPUS[i].seed, fp, fc));
    office().forEach((l, i) => place(l, 'office', OFFICE_SEEDS[i], fp, fc));
    // stage 7 proof: the reserve-off Subway corpus (+ the same Office levels) places main's gear in the core frame
    subwayOff().slice(0, 6).forEach((l, i) => place(l, 'subway', ECONOMY_CORPUS[i].seed, null, fo));
    office().forEach((l, i) => place(l, 'office', OFFICE_SEEDS[i], null, fo));
    report('gearPlaced', fp.hex());
    report('gearPlaced (core view / reserve off)', `${fc.hex()} / ${fo.hex()}`);
    expect(fo.hex()).toBe(GOLDEN_CORE.gearPlaced);
    expect(fc.hex()).toBe(GOLDEN_RESERVE.gearPlaced);
    expect(fp.hex()).toBe(GOLDEN.gearPlaced);
  });
});
