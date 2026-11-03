// Task studio-alpha-campaign-foundation-20261102-230708-01 (lane SAVE): save/slots.ts on a fake Storage with a quota — exactly three
// slots, overwrites only when explicit, a quota failure keeps the old save and every other key, blocked storage is a clear error,
// another tab's newer revision is never replaced silently, lastSlot / Continue, delete one slot only, export -> import round trip,
// import into the chosen slot only (replacing only with confirmation).
import {describe, expect, it} from 'vitest';
import {SAVE_SLOTS, STORAGE_KEYS} from '../src/campaign/types';
import {SaveSlots, exportFilename, isQuotaError, isSecurityError, type CommitResult} from '../src/save/slots';
import {saveFileText, type SaveFileV1Like} from '../src/save/serialize';
import {FakeStorage, Harness, fillInventory, fixtureCampaign, populateStation, sid} from './helpers/saveFixture';

const T0 = new Date('2026-11-02T23:30:00.000Z');
let tick = 0;
const clock = () => new Date(T0.getTime() + 60_000 * tick++);

function run(station = 1, hp = 80): SaveFileV1Like {
  const h = new Harness(fixtureCampaign({current: sid(station), known: [sid(0), sid(station)], visited: station === 0 ? [sid(0)] : [sid(0), sid(station)]}));
  fillInventory(h);
  h.player.hp = hp;
  populateStation(h, {level: 'subway', section: 'main', station: sid(0)}, {seed: station, holders: 10, zombies: 8});
  h.run.current = {level: h.run.node(sid(station))!.archetype, section: 'main', station: sid(station)};
  h.run.playtime = 100 * station + 0.5;
  h.takeEntry();
  return h.file('arrival', 1);
}

const ok = (r: CommitResult) => { expect(r.ok, r.ok ? '' : r.error).toBe(true); return r as Extract<CommitResult, {ok: true}>; };
const settingsValue = '{"quality":"low","volume":0.5}';

function setup(quota?: number) {
  const storage = new FakeStorage(quota);
  storage.setItem(STORAGE_KEYS.settings, settingsValue);
  const slots = new SaveSlots({storage, now: clock, listen: false});
  return {storage, slots};
}

describe('save/slots: three named slots', () => {
  it('lists exactly three slots with human-readable metadata; slot numbers outside 1..3 are refused', () => {
    const {slots} = setup();
    expect(SAVE_SLOTS).toBe(3);
    expect(slots.list().map(v => [v.slot, v.empty, v.valid, v.meta, v.error])).toEqual([[1, true, false, null, null], [2, true, false, null, null], [3, true, false, null, null]]);
    const c = ok(slots.commit(2, run(1, 70)));
    expect(c.meta).toMatchObject({slot: 2, revision: 1, station: fixtureCampaign().network.nodes[1].name, archetype: 'subway', stationsVisited: 2, networkSeed: 424242, won: false, reason: 'arrival', playtime: 101});
    expect(c.meta.build).toMatch(/^terminal-state /);
    expect(Number.isFinite(Date.parse(c.meta.savedAt))).toBe(true);
    const views = slots.list();
    expect(views.map(v => [v.slot, v.empty, v.valid, v.last])).toEqual([[1, true, false, false], [2, false, true, true], [3, true, false, false]]);
    expect(views[1].chars).toBeGreaterThan(1000);
    for (const bad of [0, 4, -1, 1.5, NaN]) {
      expect(slots.commit(bad, run()).ok).toBe(false);
      expect(slots.read(bad)).toMatchObject({ok: false, code: 'bad-slot'});
    }
  });

  it('New Game writes an empty slot; a used slot is overwritten only when explicitly confirmed', () => {
    const {slots, storage} = setup();
    ok(slots.commit(1, run(1)));
    const before = storage.getItem(STORAGE_KEYS.slot(1));
    const refused = slots.commit(1, run(2));
    expect(refused).toMatchObject({ok: false, code: 'occupied', error: expect.stringMatching(/already holds a save\. Confirm to overwrite/)});
    expect(storage.getItem(STORAGE_KEYS.slot(1))).toBe(before);
    const c = ok(slots.commit(1, run(2), {overwrite: true}));
    expect(c.meta.revision).toBe(2);
    expect(c.meta.station).toBe(fixtureCampaign().network.nodes[2].name);
  });

  it('an autosave (expectRevision) continues its own slot; a stale expectation is refused', () => {
    const {slots} = setup();
    const a = ok(slots.commit(1, run(1)));
    const b = ok(slots.commit(1, run(2), {expectRevision: a.meta.revision}));
    expect(b.meta.revision).toBe(2);
    expect(slots.commit(1, run(3), {expectRevision: 1})).toMatchObject({ok: false, code: 'conflict', error: expect.stringMatching(/newer save in another tab/)});
  });

  it('a quota failure keeps the previous save, the other slots and the settings, and is never reported as saved', () => {
    const small = run(1);
    const big = (() => {
      const h = new Harness(fixtureCampaign({current: sid(1), visited: [sid(0), sid(1)]}));
      fillInventory(h);
      for (let i = 0; i < 3; i++) populateStation(h, {level: 'subway', section: 'main', station: sid(i)}, {seed: 20 + i, holders: 400, dropped: 60, bags: 3});
      h.run.current = {level: 'subway', section: 'main', station: sid(1)};
      return h.file('arrival', 1);
    })();
    const s = saveFileText(small).length, b = saveFileText(big).length;
    expect(b).toBeGreaterThan(s * 4); // (so the quota below holds both small saves + settings, but not the big one in slot 1)
    const {slots, storage} = setup(Math.floor(s * 2.5 + b * 0.5));
    ok(slots.commit(1, small));
    ok(slots.commit(2, run(2)));
    const keep = new Map(storage.map);
    const r = slots.commit(1, big, {expectRevision: 1});
    expect(r).toMatchObject({ok: false, code: 'quota', error: expect.stringMatching(/storage for the game is full.*Slot 1 still holds its previous save/)});
    expect(r.ok).toBe(false);
    expect(new Map(storage.map)).toEqual(keep); // slot 1 unchanged, slot 2 and the settings untouched
    expect(storage.getItem(STORAGE_KEYS.settings)).toBe(settingsValue);
    expect(slots.read(1)).toMatchObject({ok: true});
    expect(isQuotaError(new DOMException('x', 'QuotaExceededError'))).toBe(true);
    expect(isQuotaError({code: 22})).toBe(true);
    expect(isQuotaError({name: 'NS_ERROR_DOM_QUOTA_REACHED'})).toBe(true);
  });

  it('storage disabled (no localStorage / SecurityError on access) is a clear error on every operation', async () => {
    const none = new SaveSlots({storage: null, listen: false});
    expect(none.available).toBe(false);
    expect(none.commit(1, run())).toMatchObject({ok: false, code: 'unavailable', error: expect.stringMatching(/blocks site storage/)});
    expect(none.read(1)).toMatchObject({ok: false, code: 'unavailable'});
    expect(none.list().every(v => v.empty && !v.valid && v.error)).toBe(true);
    expect(await none.importFile(1, saveFileText(run()))).toMatchObject({ok: false, code: 'unavailable'});
    expect(none.continueSlot()).toBeNull();
    const {slots, storage} = setup();
    ok(slots.commit(1, run()));
    storage.disabled = true;
    expect(slots.commit(2, run())).toMatchObject({ok: false, code: 'unavailable'});
    expect(slots.read(1)).toMatchObject({ok: false, code: 'unavailable'});
    expect(slots.delete(1)).toMatchObject({ok: false, code: 'unavailable'});
    expect(slots.exportFile(1)).toMatchObject({ok: false, code: 'unavailable'});
    expect(slots.lastSlot()).toBeNull();
    expect(isSecurityError(new DOMException('x', 'SecurityError'))).toBe(true);
    storage.disabled = false;
    expect(slots.read(1)).toMatchObject({ok: true}); // nothing was lost
  });

  it('two tabs: a newer revision written by the other tab is never replaced silently (storage event + revision compare)', () => {
    const storage = new FakeStorage();
    const tabA = new SaveSlots({storage, now: clock, listen: false}), tabB = new SaveSlots({storage, now: clock, listen: false});
    const a1 = ok(tabA.commit(1, run(1)));
    // tab B loads the same slot and keeps playing (autosaves)
    const rb = tabB.read(1);
    expect(rb.ok).toBe(true);
    const b2 = ok(tabB.commit(1, run(2), {expectRevision: a1.meta.revision}));
    const events: unknown[] = [];
    tabA.onChange(c => events.push(c));
    tabA.handleStorageEvent({key: STORAGE_KEYS.slot(1), newValue: storage.getItem(STORAGE_KEYS.slot(1))});
    expect(events).toEqual([{slot: 1, external: true}]);
    tabA.handleStorageEvent({key: 'unrelated', newValue: 'x'});
    expect(events).toHaveLength(1);
    // tab A's autosave of its older run is refused; the newer save stays
    const stale = tabA.commit(1, run(3), {expectRevision: a1.meta.revision});
    expect(stale).toEqual({ok: false, code: 'conflict', error: expect.stringMatching(/^Not saved — newer save in another tab \(slot 1 is at revision 2; this game last saw revision 1\)/)});
    expect(tabA.read(1)).toMatchObject({ok: true, file: {meta: {revision: b2.meta.revision, station: b2.meta.station}}});
    expect(tabA.revision(1)).toBe(2);
    // the slot deleted in the other tab: an autosave does not resurrect it silently
    tabB.delete(1);
    expect(tabA.commit(1, run(3), {expectRevision: 2})).toMatchObject({ok: false, code: 'conflict', error: expect.stringMatching(/deleted in another tab/)});
    expect(storage.getItem(STORAGE_KEYS.slot(1))).toBeNull();
  });

  it('lastSlot / Continue: the last-used valid slot, else the newest valid one; set on load', () => {
    const {slots, storage} = setup();
    expect(slots.continueSlot()).toBeNull();
    ok(slots.commit(2, run(1)));
    ok(slots.commit(3, run(2)));
    ok(slots.commit(1, run(3)));
    expect([slots.lastSlot(), slots.continueSlot()]).toEqual([1, 1]);
    storage.setItem(STORAGE_KEYS.slot(1), '{"format":"terminal-state-save","v":1,"meta":{}}'); // damaged
    expect(slots.list()[0]).toMatchObject({valid: false, empty: false, last: true, error: expect.stringMatching(/cannot be loaded/)});
    expect(slots.continueSlot()).toBe(3); // the newest valid save
    expect(slots.setLastSlot(2)).toBe(true);
    expect(slots.continueSlot()).toBe(2);
    expect(slots.setLastSlot(9)).toBe(false);
  });

  it('delete removes only the chosen slot (and the Continue pointer if it named it)', () => {
    const {slots, storage} = setup();
    ok(slots.commit(1, run(1)));
    ok(slots.commit(2, run(2)));
    ok(slots.commit(3, run(3)));
    const two = storage.getItem(STORAGE_KEYS.slot(2)), three = storage.getItem(STORAGE_KEYS.slot(3));
    expect(slots.delete(1)).toEqual({ok: true});
    expect(storage.getItem(STORAGE_KEYS.slot(1))).toBeNull();
    expect([storage.getItem(STORAGE_KEYS.slot(2)), storage.getItem(STORAGE_KEYS.slot(3))]).toEqual([two, three]);
    expect(slots.lastSlot()).toBe(3);
    expect(slots.delete(3)).toEqual({ok: true});
    expect(slots.lastSlot()).toBeNull();
    expect(storage.getItem(STORAGE_KEYS.settings)).toBe(settingsValue);
    expect(slots.list().map(v => v.empty)).toEqual([true, false, true]);
  });

  it('export -> import round trip; import goes into the CHOSEN slot only, replacing only after confirmation', async () => {
    const {slots, storage} = setup();
    ok(slots.commit(1, run(1, 55)));
    ok(slots.commit(2, run(2, 66)));
    const ex = slots.exportFile(1);
    if (!ex.ok) throw new Error(ex.error);
    expect(ex.filename).toMatch(/^terminal-state-slot1-\d{4}-\d{2}-\d{2}-\d{4}\.json$/);
    expect(ex.blob.type).toBe('application/json');
    expect(await ex.blob.text()).toBe(storage.getItem(STORAGE_KEYS.slot(1)));
    expect(slots.exportFile(3)).toMatchObject({ok: false, code: 'empty'});
    // into the empty slot 3: no confirmation needed; slots 1 / 2 untouched
    const one = storage.getItem(STORAGE_KEYS.slot(1)), two = storage.getItem(STORAGE_KEYS.slot(2));
    const imp = ok(await slots.importFile(3, ex.blob));
    expect(imp.meta).toMatchObject({slot: 3, reason: 'import', revision: 1});
    expect([storage.getItem(STORAGE_KEYS.slot(1)), storage.getItem(STORAGE_KEYS.slot(2))]).toEqual([one, two]);
    const r3 = slots.read(3), r1 = slots.read(1);
    if (!r3.ok || !r1.ok) throw new Error('read');
    expect(r3.file.run).toEqual(r1.file.run);
    expect(r3.file.run.carry.vitals.hp).toBe(55);
    // into the used slot 2: refused without confirmation (slot 2 unchanged), replaced with it
    expect(await slots.importFile(2, ex.text)).toMatchObject({ok: false, code: 'occupied', error: expect.stringMatching(/Confirm to replace/)});
    expect(storage.getItem(STORAGE_KEYS.slot(2))).toBe(two);
    const rep = ok(await slots.importFile(2, ex.text, {confirmReplace: true}));
    expect(rep.meta).toMatchObject({slot: 2, revision: 2, reason: 'import'});
    const r2 = slots.read(2);
    expect(r2.ok && r2.file.run.carry.vitals.hp).toBe(55);
    // an invalid or oversize file is refused and nothing is written
    const writes = storage.writes;
    expect(await slots.importFile(2, ex.text.replace('"v":1,"meta"', '"v":7,"meta"'), {confirmReplace: true})).toMatchObject({ok: false, code: 'invalid', error: expect.stringMatching(/newer version/)});
    expect(await slots.importFile(2, new Blob(['x'.repeat(2 * 1024 * 1024 + 10)]), {confirmReplace: true})).toMatchObject({ok: false, code: 'too-large'});
    expect(await slots.importFile(2, new Blob(['not json']), {confirmReplace: true})).toMatchObject({ok: false, code: 'invalid'});
    expect(storage.writes).toBe(writes);
    // inspectFile shows the candidate's metadata without writing
    const insp = await slots.inspectFile(ex.blob);
    expect(insp.ok && insp.file.meta.station).toBe(fixtureCampaign().network.nodes[1].name);
    expect(storage.writes).toBe(writes);
  });

  it('a file\'s metadata is never trusted on import: it is re-derived from the run', async () => {
    const {slots} = setup();
    const f = run(1);
    const text = saveFileText({...f, meta: {...f.meta, slot: 3, revision: 77, reason: 'arrival'}});
    const r = ok(await slots.importFile(1, text));
    expect(r.meta).toMatchObject({slot: 1, revision: 1, reason: 'import', station: f.meta.station});
  });

  it('usage() counts UTF-16 code units of keys + values; export filenames are dated', () => {
    const {slots, storage} = setup();
    ok(slots.commit(1, run(1)));
    const u = slots.usage();
    expect(u.slots[0]).toBe(STORAGE_KEYS.slot(1).length + storage.getItem(STORAGE_KEYS.slot(1))!.length);
    expect(u.total).toBe(storage.used());
    expect(u.budget).toBe(5 * 1024 * 1024);
    expect(exportFilename(2, '2026-11-02T07:05:00.000Z')).toBe('terminal-state-slot2-2026-11-02-0705.json');
    expect(exportFilename(1, 'junk')).toBe('terminal-state-slot1-undated.json');
  });
});
