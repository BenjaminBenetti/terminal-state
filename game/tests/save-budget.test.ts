// Task studio-alpha-campaign-foundation-20261102-230708-01 (lane SAVE): the localStorage SIZE BUDGET — three slots of a heavily
// played campaign (all 40 stations visited, every loot holder of REAL generated layouts remembered as captureHolders records them,
// every generated pickup + 30 dropped / spilled items per station with full-precision poses, kills, two full grounded backpacks per
// station, office windows / sirens / reactor lane stores, a full carried kit, a full 50-slot Lockbox of full (18-slot) backpacks, the Retry
// entry) must fit Chrome's ~5 Mi UTF-16 code units per origin (keys + values) with the settings, with margin, and every slot must
// stay under the 2 MiB import limit (so an export always imports again). Sizes are written to /tmp/save-lane/budget.json.
import {describe, expect, it} from 'vitest';
import {mkdirSync, writeFileSync} from 'node:fs';
import {LEVELS} from '../src/levels/registry';
import {createHolderState, isContainerKind, isLootHolderKind, type HolderKind} from '../src/items/loot';
import {holderSurfaces, type Dims} from '../src/items/lootLayout';
import {PROP_DEFS} from '../src/gen/props';
import {lootProfile} from '../src/items/lootTables';
import {holderKey} from '../src/run/memory';
import {emptyReactorState, REACTOR_LANE} from '../src/world/reactor/runState';
import {WINDOWS_LANE} from '../src/world/windowBreach';
import {STORAGE_KEYS, type CampaignState} from '../src/campaign/types';
import type {LevelId} from '../src/levels/types';
import {saveFileText} from '../src/save/serialize';
import {SAVE_LIMITS} from '../src/save/validate';
import {SaveSlots, STORAGE_BUDGET_CHARS} from '../src/save/slots';
import {LOCKBOX_SLOTS} from '../src/run/trainLockbox';
import {utf8Bytes} from '../src/save/checksum';
import {FakeStorage, Harness, archetypeOf, fillInventory, fillLockbox, fixtureNetwork, populateStation, sid, type RolledHolder} from './helpers/saveFixture';

interface LayoutCounts { rolled: RolledHolder[]; lots: number; pickups: number; zombies: number }

/** A real layout's holders with their rolled lots (as the loot-economy census rolls them: index per group, the holder's purpose). */
function layoutCounts(level: LevelId, seed: number): LayoutCounts {
  const lay = LEVELS[level].generate('main', {levelSeed: seed});
  const profile = lootProfile(level);
  let ci = 0, si = 0, fallback = 0;
  const seen = new Set<string>(), rolled: RolledHolder[] = [];
  for (const p of lay.props) {
    const kind = p.kind as string;
    if (!isLootHolderKind(kind)) continue;
    const index = isContainerKind(kind) ? ci++ : si++;
    const key = holderKey(kind, p.level, p.x, p.z);
    if (seen.has(key)) continue;
    seen.add(key);
    const area = lay.areas[p.area];
    try {
      const def = (PROP_DEFS as unknown as Record<string, Dims | undefined>)[kind] ?? {w: 1, d: 1, h: 1};
      const st = createHolderState(lay.seed, index, kind as HolderKind, p.purpose ?? area?.purpose ?? area?.type ?? 'default', holderSurfaces(kind as never, def), undefined, profile);
      rolled.push({key, lots: st.lots.map(l => l.id), open: st.open, searched: st.searched, ...(st.seen ? {seen: [...st.seen]} : {})});
    } catch {
      fallback++;
      rolled.push({key, lots: [index * 1000, index * 1000 + 1, index * 1000 + 2], open: false, searched: false});
    }
  }
  expect(fallback).toBeLessThan(rolled.length * 0.2);
  return {rolled, lots: rolled.reduce((a, h) => a + h.lots.length, 0), pickups: lay.pickups.length, zombies: lay.zombies.length};
}

/** A run with all 40 stations visited and heavily played, departing st-38 for the Reactor. */
function heavyRun(counts: Record<string, LayoutCounts[]>, seed: number): Harness {
  const network = fixtureNetwork();
  const all = network.nodes.map(n => n.id);
  const campaign: CampaignState = {v: 1, network, current: sid(38), known: all, visited: all, cheat: false, won: null, transit: {from: sid(38), to: sid(39), phase: 'departing', cheat: false}};
  const h = new Harness(campaign);
  fillInventory(h, seed);
  fillLockbox(h, LOCKBOX_SLOTS, seed + 1); // every Lockbox slot (50; 40 before task gameplay-feedback-20261111): full backpacks (nested items)
  for (let i = 0; i < 40; i++) {
    const level = archetypeOf(i), c = counts[level][i % counts[level].length];
    const lanes: Record<string, unknown> = {};
    if (level === 'office') {
      lanes[WINDOWS_LANE] = {v: 2, damage: Object.fromEntries(Array.from({length: 40}, (_, j) => [`f${2 + (j % 7)}-w${j}`, 17 + (j % 3) * 9.5])),
        broken: Object.fromEntries(Array.from({length: 20}, (_, j) => [`f${2 + (j % 7)}-b${j}`, 12.25 + j]))};
    }
    if (level === 'reactor') {
      const r = emptyReactorState(4, 3);
      r.generators = r.generators.map((_, j) => ({started: j < 3, startedAt: j < 3 ? 1200.5 + j * 61.25 : 0}));
      r.zoneClear = [1, 1, 0.66];
      lanes[REACTOR_LANE] = r;
    }
    populateStation(h, {level, section: 'main', station: sid(i)}, {seed: seed * 100 + i, rolled: c.rolled, layoutPickups: c.pickups, dropped: 30, zombies: c.zombies, bags: 2, lanes});
  }
  h.run.current = {level: 'subway', section: 'main', station: sid(38)};
  h.run.playtime = 5 * 3600 + 1234.5;
  h.clock = h.run.playtime + 10.25;
  h.stats = {shots: 9100, hits: 5200, kills: 1250, time: h.run.playtime, headshots: 400, healed: 2100, itemsUsed: 800};
  for (let i = 0; i < 80; i++) h.run.entered.push(archetypeOf(i % 40));
  h.takeEntry();
  return h;
}

describe('save budget: three heavily played 40-station slots fit localStorage', () => {
  it('measures one slot, three slots + settings, the margin, and the compaction win', () => {
    const counts: Record<string, LayoutCounts[]> = {
      subway: [layoutCounts('subway', 12345), layoutCounts('subway', 987654)],
      office: [layoutCounts('office', 12345)], mall: [layoutCounts('mall', 12345)], reactor: [layoutCounts('reactor', 12345)],
    };
    const storage = new FakeStorage(STORAGE_BUDGET_CHARS);
    storage.setItem(STORAGE_KEYS.settings, JSON.stringify({quality: 'high', volume: 0.8, sens: 1.1, fov: 75, binds: Object.fromEntries(Array.from({length: 40}, (_, i) => [`action${i}`, `Key${String.fromCharCode(65 + (i % 26))}`]))}));
    storage.setItem('terminal-state.milestones.v1', JSON.stringify({reactorRestarted: {at: '2026-11-02T10:00:00.000Z', levelSeed: 123456789}}));
    const slots = new SaveSlots({storage, listen: false});
    const sizes: {slot: number; chars: number; bytes: number; memoriesCompact: number; memoriesVerbose: number; entry: number; carry: number; participants: number; campaign: number}[] = [];
    const t0 = performance.now();
    let captureMs = 0, commitMs = 0;
    for (const slot of [1, 2, 3]) {
      const h = heavyRun(counts, slot);
      const c0 = performance.now();
      const file = h.file('departure', slot, {x: -2.5, z: 0.4, yaw: 1.2, pitch: 0, crouched: false});
      captureMs += performance.now() - c0;
      const text = saveFileText(file);
      const m0 = performance.now();
      const r = slots.commit(slot, file);
      commitMs += performance.now() - m0;
      expect(r.ok, r.ok ? '' : r.error).toBe(true);
      sizes.push({
        slot, chars: STORAGE_KEYS.slot(slot).length + text.length, bytes: utf8Bytes(text),
        memoriesCompact: JSON.stringify(file.run.memories).length, memoriesVerbose: JSON.stringify(h.run.exportMemories()).length,
        entry: JSON.stringify(file.run.entry).length, carry: JSON.stringify(file.run.carry).length,
        participants: JSON.stringify(file.run.participants).length, campaign: JSON.stringify(file.run.campaign).length,
      });
    }
    const used = storage.used(), saves = sizes.reduce((a, s) => a + s.chars, 0);
    const report = {
      layouts: Object.fromEntries(Object.entries(counts).map(([l, cs]) => [l, cs.map(c => ({holders: c.rolled.length, rolledLots: c.lots, pickups: c.pickups, zombies: c.zombies}))])),
      perSlot: sizes, threeSlotsChars: saves, totalStorageChars: used, budgetChars: STORAGE_BUDGET_CHARS,
      usedFraction: +(used / STORAGE_BUDGET_CHARS).toFixed(4), marginChars: STORAGE_BUDGET_CHARS - used,
      importLimitBytes: SAVE_LIMITS.fileBytes, largestSlotBytes: Math.max(...sizes.map(s => s.bytes)),
      ms: {total: Math.round(performance.now() - t0), capture: Math.round(captureMs / 3), commit: Math.round(commitMs / 3)},
    };
    mkdirSync('/tmp/save-lane', {recursive: true});
    writeFileSync('/tmp/save-lane/budget.json', JSON.stringify(report, null, 1));
    console.log('save budget', JSON.stringify(report));
    // every slot imports again after an export, and three slots + settings leave a wide margin
    for (const s of sizes) expect(s.bytes).toBeLessThan(SAVE_LIMITS.fileBytes * 0.75);
    expect(used).toBeLessThan(STORAGE_BUDGET_CHARS * 0.7);
    // the compact memory codec is what makes it fit (holders dominate a station)
    for (const s of sizes) expect(s.memoriesCompact).toBeLessThan(s.memoriesVerbose * 0.6);
    expect(slots.list().every(v => v.valid)).toBe(true);
  }, 120000);
});
