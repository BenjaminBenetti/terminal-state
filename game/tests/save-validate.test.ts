// Task studio-alpha-campaign-foundation-20261102-230708-01 (lane SAVE): save/validate.ts — untrusted save data (an imported file, a
// localStorage value) is rejected with a readable error and NOTHING is applied: malformed JSON, a wrong format, a future version,
// oversize, prototype-pollution keys, NaN / Infinity, unknown item ids and illegal stacks, broken network graphs, bad station
// references, logical transit errors, a checksum mismatch, lying metadata.
import {describe, expect, it} from 'vitest';
import {LEVEL_IDS} from '../src/levels/registry';
import {ITEMS} from '../src/items/items';
import {isBagItem} from '../src/items/gear';
import {checksumOf, canonicalJson} from '../src/save/checksum';
import {restoreRun, saveFileText, type SaveFileV1Like} from '../src/save/serialize';
import {MIGRATIONS, SAVE_ARCHETYPES, migrateEnvelope, parseSaveText, validateSaveFile, type ValidateOptions} from '../src/save/validate';
import {BAG_LANE} from '../src/run/bagStore';
import {Harness, fillInventory, fillLockbox, fixtureCampaign, populateStation, sid} from './helpers/saveFixture';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- (test mutation of untrusted data)
type Any = any;

function small(): Harness {
  const h = new Harness(fixtureCampaign({current: sid(1), known: [sid(0), sid(1), sid(2)], visited: [sid(0), sid(1)]}));
  fillInventory(h);
  fillLockbox(h, 3);
  populateStation(h, {level: 'subway', section: 'main', station: sid(0)}, {seed: 3, holders: 12, layoutPickups: 5, dropped: 4, zombies: 10, bags: 1});
  h.run.current = {level: 'subway', section: 'main', station: sid(1)};
  h.run.memory().visits = 1;
  h.clock = 1920.125;
  h.run.playtime = 600.5;
  h.takeEntry();
  return h;
}

const BASE: SaveFileV1Like = small().file('arrival', 1);
const TEXT = saveFileText(BASE);

const resign = (f: Any): Any => { f.checksum = checksumOf(f.run); return f; };
const clone = (): Any => structuredClone(BASE);

function rejects(mut: (f: Any) => void, re: RegExp, o?: ValidateOptions): string {
  const f = clone();
  mut(f);
  resign(f);
  const r = validateSaveFile(f, o);
  expect(r.ok, `expected a rejection matching ${re}`).toBe(false);
  const error = r.ok ? '' : r.error;
  expect(error).toMatch(re);
  return error;
}

describe('save/validate: the envelope', () => {
  it('accepts a real save (text and parsed) and returns it typed', () => {
    const r = parseSaveText(TEXT);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.meta.station).toBe(fixtureCampaign().network.nodes[1].name);
    expect(validateSaveFile(JSON.parse(TEXT)).ok).toBe(true);
  });

  it('malformed / empty / foreign text is rejected readably', () => {
    const cut = parseSaveText(TEXT.slice(0, -40));
    expect(cut).toEqual({ok: false, error: expect.stringMatching(/not JSON/)});
    expect(parseSaveText('   ')).toEqual({ok: false, error: expect.stringMatching(/empty/)});
    for (const t of ['[]', '"hello"', '42', 'null', '{"format":"other-game","v":1}', '{}']) expect(parseSaveText(t)).toEqual({ok: false, error: 'This is not a Terminal State save file.'});
    expect(parseSaveText(12 as unknown as string).ok).toBe(false);
  });

  it('a future version is a friendly rejection; unknown versions too; v1 needs no migration', () => {
    const r = validateSaveFile({...clone(), v: 2});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/newer version of Terminal State \(save format v2\)/);
    for (const v of [0, -1, 1.5, '1']) expect(validateSaveFile({...clone(), v}).ok).toBe(false);
    expect(Object.keys(MIGRATIONS)).toEqual([]);
    const f = {format: 'terminal-state-save', v: 1};
    expect(migrateEnvelope(f)).toBe(f);
  });

  it('oversize text (> 2 MiB) is refused before parsing', () => {
    const big = TEXT.replace('{"format"', `{"pad":"${'x'.repeat(2 * 1024 * 1024)}","format"`);
    expect(parseSaveText(big)).toEqual({ok: false, error: expect.stringMatching(/too large \(2\.\d MiB; the limit is 2 MiB\)/)});
    const wide = TEXT.replace('"stats":{', `"stats":{"x":"${'é'.repeat(1_100_000)}",`); // < 2 Mi chars but > 2 MiB of UTF-8
    expect(wide.length).toBeLessThan(2 * 1024 * 1024);
    expect(parseSaveText(wide).ok).toBe(false);
  });

  it('prototype-pollution keys anywhere are rejected and pollute nothing', () => {
    for (const [find, put] of [
      ['"stats":{', '"stats":{"__proto__":{"polluted":1},'],
      ['"lanes":{', '"lanes":{"constructor":{"prototype":{"polluted":1}},'],
      ['"participants":{', '"participants":{"prototype":{"x":1},'],
      ['"meta":{', '"meta":{"__proto__":{"isAdmin":true},'],
    ]) {
      const r = parseSaveText(TEXT.replace(find, put));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/forbidden key '(__proto__|constructor|prototype)'/);
    }
    expect(({} as Any).polluted).toBeUndefined();
    expect(({} as Any).isAdmin).toBeUndefined();
    const sneaky = clone();
    Object.setPrototypeOf(sneaky.run.stats, {evil: true});
    expect(validateSaveFile(sneaky).ok).toBe(false); // a non-plain object handed in directly
  });

  it('NaN / Infinity (1e999 in text, NaN in an object) are rejected', () => {
    const r = parseSaveText(TEXT.replace(/"clock":[0-9.]+/, '"clock":1e999'));
    expect(r).toEqual({ok: false, error: expect.stringMatching(/run\.clock: a number is not finite/)});
    const f = clone();
    f.run.carry.vitals.hp = NaN;
    expect(validateSaveFile(f)).toEqual({ok: false, error: expect.stringMatching(/not finite/)});
    const g = clone();
    g.run.memories['st-00:main'].pickups[0][1] = Infinity;
    expect(validateSaveFile(g).ok).toBe(false);
  });

  it('a checksum mismatch (the run edited after writing) is rejected; key order does not matter', () => {
    const f = clone();
    f.run.clock += 1;
    expect(validateSaveFile(f)).toEqual({ok: false, error: expect.stringMatching(/damaged: its checksum does not match/)});
    const g = clone();
    g.checksum = 'fnv1a32-00000000';
    expect(validateSaveFile(g).ok).toBe(false);
    const reordered = JSON.parse(canonicalJson(BASE));
    expect(validateSaveFile(reordered).ok).toBe(true);
    const h = clone();
    h.checksum = 'crc-1234';
    expect(validateSaveFile(h)).toEqual({ok: false, error: expect.stringMatching(/checksum/)});
  });

  it('lying metadata is rejected (it must describe the saved run)', () => {
    for (const [k, v] of [['station', 'Elsewhere'], ['archetype', 'mall'], ['stationsVisited', 39], ['networkSeed', 1], ['won', true], ['playtime', 99999]] as const) {
      const f = clone();
      f.meta[k] = v;
      expect(validateSaveFile(f)).toEqual({ok: false, error: expect.stringMatching(/does not match the saved run/)});
    }
    for (const [k, v] of [['slot', 4], ['slot', 0], ['reason', 'cloud'], ['savedAt', 'yesterday'], ['revision', -1]] as const) {
      const f = clone();
      f.meta[k] = v;
      expect(validateSaveFile(f).ok).toBe(false);
    }
    const g = clone();
    g.meta.url = 'https://example.invalid';
    expect(validateSaveFile(g)).toEqual({ok: false, error: expect.stringMatching(/unexpected field 'url'/)});
  });

  it('archetypes match the level registry', () => {
    expect([...SAVE_ARCHETYPES]).toEqual([...LEVEL_IDS]);
  });
});

describe('save/validate: items', () => {
  it('unknown item ids are rejected wherever they hide', () => {
    rejects(f => { f.run.carry.inventory.hotbar[0].itemId = 'plasma_rifle'; }, /run\.carry\.inventory\.hotbar\[0\]\.itemId: unknown item 'plasma_rifle'/);
    rejects(f => { f.run.participants['player-train'].lockbox.slots[5].itemId = 'gold_bar'; }, /lockbox\.slots\[5\]\.itemId: unknown item/);
    rejects(f => { f.run.participants['player-train'].lockbox.slots[0].bag[3].itemId = 'nope'; }, /lockbox\.slots\[0\]\.bag\[3\]\.itemId: unknown item/);
    rejects(f => { f.run.memories['st-00:main'].pickups[0][0].itemId = 'constructor'; }, /unknown item 'constructor'/);
    rejects(f => { f.run.memories['st-00:main'].lanes[BAG_LANE].bags[0].stack.bag[0].itemId = 'toString'; }, /not an item id|unknown item/);
    rejects(f => { f.run.entry.inventory.pack[2].itemId = 'hasOwnProperty'; }, /not an item id|unknown item/);
    rejects(f => { f.run.carry.inventory.gear.helmet.itemId = '../../etc'; }, /not an item id/);
  });

  it('illegal stacks: counts, magazines, filters, bag nesting, record uids, duplicate uids', () => {
    rejects(f => { f.run.carry.inventory.hotbar[0].count = 2; }, /count: 2 is out of range \(1 to 1\)/); // a rifle stacks to 1
    rejects(f => { f.run.carry.inventory.pack[0].count = 0; }, /count/);
    rejects(f => { f.run.carry.inventory.pack[0] = {uid: 900_001, itemId: 'ammo_9mm', count: 1.5}; }, /not a whole number/);
    rejects(f => { f.run.carry.inventory.hotbar[0].mag = 999; }, /mag: 999 is out of range/);
    rejects(f => { f.run.carry.inventory.hotbar[3].mag = 5; }, /has no magazine/); // the medkit
    rejects(f => { f.run.carry.inventory.hotbar[3].filter = 5; }, /takes no filter/);
    rejects(f => { f.run.carry.inventory.gear.mask.filter = 9999; }, /filter/);
    rejects(f => { const bag = f.run.carry.inventory.gear.backpack; bag.bag[0] = structuredClone(bag); bag.bag[0].uid = 999_001; }, /backpack inside a backpack/);
    rejects(f => { f.run.carry.inventory.gear.backpack.bag.push(null); }, /too many entries/);
    rejects(f => { f.run.memories['st-00:main'].pickups[0][0].uid = 5; }, /unexpected field 'uid'/);
    rejects(f => { f.run.participants['player-train'].lockbox.slots[10].uid = f.run.carry.inventory.hotbar[0].uid; }, /duplicate item uid/);
    rejects(f => { f.run.carry.inventory.hotbar.push(null); }, /hotbar: too many entries/);
    rejects(f => { f.run.carry.inventory.gear.wings = null; }, /unknown gear slot 'wings'/);
    rejects(f => { f.run.carry.inventory.nextUid = -3; }, /nextUid/);
  });

  it('every registry item is accepted (no legal item is ever refused)', () => {
    const h = small();
    const mem = h.run.memory({level: 'subway', section: 'main', station: sid(0)});
    mem.pickups = Object.values(ITEMS).filter(d => !isBagItem(d.id)).map(d => ({stack: {itemId: d.id, count: d.stackMax}, pose: {p: [0, 0, 0], q: [0, 0, 0, 1]}, anchor: [0, 0, 0]}));
    const r = validateSaveFile(h.file());
    expect(r.ok, r.ok ? '' : r.error).toBe(true);
    expect(mem.pickups.length).toBeGreaterThan(20);
  });
});

describe('save/validate: the network graph and station references', () => {
  it('a broken graph is rejected (structural checks)', () => {
    const nodes = (f: Any) => f.run.campaign.network.nodes;
    rejects(f => { nodes(f)[3].id = sid(2); }, /duplicate station id st-02/);
    rejects(f => { nodes(f)[3].name = nodes(f)[2].name; }, /duplicate station name/);
    rejects(f => { nodes(f)[3].name = 'Bad\u0007Bell'; }, /control characters/);
    rejects(f => { f.run.campaign.network.edges.push([sid(1), 'st-99']); }, /station st-99 is not in the network/);
    rejects(f => { f.run.campaign.network.edges.push([sid(4), sid(4)]); }, /to itself/);
    rejects(f => { f.run.campaign.network.edges.push([...f.run.campaign.network.edges[0]].reverse()); }, /duplicate track/);
    rejects(f => { nodes(f)[7].archetype = 'reactor'; }, /exactly one Reactor/);
    rejects(f => { nodes(f)[0].archetype = 'office'; }, /start station is not a Subway/);
    rejects(f => { nodes(f)[39].archetype = 'subway'; }, /exactly one Reactor/);
    rejects(f => { nodes(f)[7].archetype = 'casino'; }, /is not one of subway \| office \| mall \| market \| bunker \| skyways \| reactor/);
    rejects(f => { const n = f.run.campaign.network; n.edges = n.edges.filter((e: string[]) => !e.includes(sid(39))); n.lines[1].stations.pop(); }, /not connected \(1 stations unreachable/);
    rejects(f => { f.run.campaign.network.lines[0].color = 'red'; }, /#rrggbb/);
    rejects(f => { nodes(f)[4].lines = ['purple']; }, /unknown line 'purple'/);
    rejects(f => { nodes(f)[4].levelSeed = -1; }, /levelSeed/);
    rejects(f => { nodes(f).push(...Array.from({length: 100}, (_, i) => ({...nodes(f)[1], id: `st-${200 + i}`, name: `Extra ${i}`}))); }, /too many entries/);
  });

  it('lane NET\'s injected validateNetwork is applied (string / object / throw); null passes', () => {
    rejects(() => {}, /line order broken/, {validateNetwork: () => 'line order broken'});
    rejects(() => {}, /a; b/, {validateNetwork: () => ({ok: false, errors: ['a', 'b']})});
    rejects(() => {}, /graph exploded/, {validateNetwork: () => { throw new Error('graph exploded'); }});
    rejects(() => {}, /invalid network/, {validateNetwork: () => false});
    let seen = 0;
    expect(validateSaveFile(BASE, {validateNetwork: n => { seen = n.nodes.length; return null; }}).ok).toBe(true);
    expect(seen).toBe(40);
    expect(validateSaveFile(BASE, {validateNetwork: () => ({ok: true})}).ok).toBe(true);
  });

  it('bad station references and logical campaign errors are rejected', () => {
    rejects(f => { f.run.campaign.current = 'st-77'; }, /current: station st-77 is not in the network/);
    rejects(f => { f.run.campaign.known.push('st-88'); }, /known\[\d+\]: station st-88/);
    rejects(f => { f.run.campaign.visited.push(sid(0)); }, /listed twice/);
    rejects(f => { f.run.campaign.current = sid(2); }, /was never visited/);
    rejects(f => { f.run.memories['st-77:main'] = f.run.memories['st-00:main']; }, /memory st-77:main: station st-77 is not in the network/);
    rejects(f => { f.run.memories['subway:main'] = f.run.memories['st-00:main']; }, /is not a station section key/);
    rejects(f => { f.run.memories['st-00:Main Hall'] = f.run.memories['st-00:main']; }, /is not a station section key/);
    rejects(f => { f.run.point = 'departure'; f.run.campaign.transit = {from: sid(1), to: 'st-55', phase: 'departing', cheat: false}; }, /transit\.to: station st-55/);
    rejects(f => { f.run.point = 'departure'; f.run.campaign.transit = {from: sid(0), to: sid(1), phase: 'departing', cheat: false}; }, /the train leaves st-00 but the current station is st-01/);
    rejects(f => { f.run.point = 'departure'; f.run.campaign.transit = {from: sid(1), to: sid(30), phase: 'departing', cheat: false}; }, /no track between st-01 and st-30/);
    rejects(f => { f.run.point = 'departure'; f.run.campaign.transit = {from: sid(1), to: sid(30), phase: 'departing', cheat: true}; }, /cheat journey without the map cheat/);
    rejects(f => { f.run.point = 'departure'; f.run.campaign.transit = {from: sid(1), to: sid(1), phase: 'departing', cheat: false}; }, /same station/);
    rejects(f => { f.run.point = 'departure'; f.run.campaign.transit = {from: sid(1), to: sid(2), phase: 'arrived', cheat: false}; }, /not a stored transit phase/);
    rejects(f => { f.run.campaign.transit = {from: sid(1), to: sid(2), phase: 'departing', cheat: false}; }, /an arrival save during a journey/);
    rejects(f => { f.run.point = 'departure'; }, /a departure save without a journey/);
    rejects(f => { f.run.campaign.won = {at: '2026-11-02T10:00:00.000Z', station: 'st-99', via: 'reactor'}; }, /won\.station/);
    rejects(f => { f.run.entry.level = 'office'; }, /st-01 is a subway station, not office/);
    rejects(f => { f.run.entry.memories['st-00:main'] = f.run.memories['st-00:main']; }, /is not part of station st-01/);
    // a cheat journey anywhere is fine with the cheat on; a track journey is fine without it
    const ok = (mut: (f: Any) => void) => { const f = clone(); mut(f); resign(f); const r = validateSaveFile(f); expect(r.ok, r.ok ? '' : r.error).toBe(true); };
    ok(f => { f.run.point = 'departure'; f.run.campaign.cheat = true; f.run.campaign.transit = {from: sid(1), to: sid(30), phase: 'departing', cheat: true}; });
    ok(f => { f.run.point = 'departure'; f.run.campaign.transit = {from: sid(1), to: sid(2), phase: 'departing', cheat: false}; });
  });

  it('out-of-range carry / pose / clock values are rejected', () => {
    rejects(f => { f.run.carry.vitals.hp = 0; }, /the player is dead/);
    rejects(f => { f.run.carry.vitals.hp = 150; }, /out of range/);
    rejects(f => { f.run.carry.survival.hunger = -1; }, /out of range/);
    rejects(f => { f.run.carry.battery.charge = 2; }, /out of range/);
    rejects(f => { f.run.carry.battery.on = 'yes'; }, /true \/ false/);
    rejects(f => { f.run.player.trainLocal.x = 500; }, /trainLocal\.x/);
    rejects(f => { f.run.player.trainLocal.pitch = 3; }, /pitch/);
    rejects(f => { f.run.clock = -5; }, /clock/);
    rejects(f => { f.run.seeds.subway = 2 ** 33; }, /seeds\.subway/);
    rejects(f => { f.run.stats['bad key'] = 1; }, /not a stat name/);
    rejects(f => { f.run.memories['st-00:main'].holders['../x'] = [0]; }, /not a holder key/);
    rejects(f => { f.run.memories['st-00:main'].holders[Object.keys(f.run.memories['st-00:main'].holders)[0]] = [9]; }, /out of range/);
    rejects(f => { const p = f.run.memories['st-00:main'].pickups[0]; p.length = 11; p.push(1, 2); }, /malformed loose item/);
    rejects(f => { f.run.extra = 1; }, /unexpected field 'extra'/);
  });
});

describe('save/validate: invalid data applies nothing', () => {
  it('the load path (validate -> restore) leaves the live state untouched for every rejected file', () => {
    const live = small();
    live.mask = {on: true};
    const snapshot = () => JSON.stringify({inv: live.inv.toJSON(), box: live.train.lockbox.toJSON(), p: live.player, s: [live.survival.hunger, live.survival.thirst], b: live.battery,
      mem: live.run.exportMemories(), c: live.clock, run: live.run.id, mask: live.mask, inj: live.injuries.snapshot()});
    const before = snapshot();
    const tryLoad = (text: string): boolean => {
      const r = parseSaveText(text);
      if (!r.ok) return false;
      restoreRun(r.value.run, live.target());
      return true;
    };
    const broken = [
      TEXT.slice(0, 100), TEXT.replace('"stats":{', '"stats":{"__proto__":{"x":1},'), TEXT.replace('"format":"terminal-state-save"', '"format":"x"'),
      TEXT.replace('"v":1,"meta"', '"v":3,"meta"'), TEXT.replace(/"clock":[0-9.]+/, '"clock":2'), TEXT.replace('"itemId":"rifle"', '"itemId":"railgun"'),
    ];
    for (const t of broken) expect(tryLoad(t)).toBe(false);
    expect(snapshot()).toBe(before);
    expect(tryLoad(TEXT)).toBe(true); // (and a valid one does apply)
    expect(snapshot()).not.toBe(before);
  });
});
