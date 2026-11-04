// Task studio-beta-campaign-save-controls-fix-20261104-034806-01 (user: "saving is throwing errors, when travailing between stations and
// also at the end of the game"): the Mall's medicine drawer cabinet has 35 compartments (33 drawers + a top cupboard + a door), and a
// holder record keeps which compartments the player has seen. The compact codec packed them into ONE `1 << i` mask (32-bit bitwise:
// bits 31..34 went negative / wrapped onto bits 0..2) and the validator allowed 1..30 compartments, so every save after opening that
// cabinet failed ("…holders.medicineDrawerCabinet@3:…[1]: 35 is out of range (1 to 30)") at departure, arrival and the ending.
// Now: ceil(len / 30) exact 30-bit words (integer maths); holders with <= 30 compartments keep the legacy one-word tuple byte for byte.
import {describe, expect, it} from 'vitest';
import {OPENABLE_SPECS} from '../src/world/openablesSpec';
import {createHolderState} from '../src/items/loot';
import {captureHolder, holderKey, type HolderRecord} from '../src/run/memory';
import {MAX_HOLDER_PARTS, SEEN_WORD_BITS, decodeHolder, encodeHolder, restoreRun, saveFileText, type SaveFileV1Like, type SavePoint} from '../src/save/serialize';
import {checksumOf} from '../src/save/checksum';
import {parseSaveText, validateSaveFile} from '../src/save/validate';
import {Harness, fillInventory, fillLockbox, fixtureCampaign, populateStation, sid} from './helpers/saveFixture';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- (test mutation of untrusted data)
type Any = any;

const SEEN_AT = [0, 5, 29, 30, 31, 32, 33, 34];
const CABINET_KEY = holderKey('medicineDrawerCabinet', 3, 568.12, 41.07);

/** The genuine producer: a real medicine-cabinet holder state (its spec's 35 compartments), some compartments seen, captured. */
function cabinetRecord(): HolderRecord {
  const st = createHolderState(7, 3, 'medicineDrawerCabinet', 'mall-pharmacy', []);
  expect(st.seen!.length).toBe(35);
  for (const i of SEEN_AT) st.seen![i] = true;
  st.searched = true;
  return captureHolder(st);
}

/** A campaign save whose visited station holds that cabinet record (plus the fixture's ordinary holders, items, Lockbox). */
function harness(): Harness {
  const h = new Harness(fixtureCampaign({current: sid(1), known: [sid(0), sid(1), sid(2)], visited: [sid(0), sid(1)]}));
  fillInventory(h);
  fillLockbox(h, 3);
  populateStation(h, {level: 'mall', section: 'main', station: sid(0)}, {seed: 5, holders: 20, layoutPickups: 4, dropped: 3, zombies: 8, bags: 1});
  h.run.memory({level: 'mall', section: 'main', station: sid(0)}).holders[CABINET_KEY] = cabinetRecord();
  h.run.current = {level: 'subway', section: 'main', station: sid(1)};
  h.run.memory().visits = 1;
  h.takeEntry();
  return h;
}

const memKey = `${sid(0)}:main`;

describe('holder compartments beyond 30 (the medicine drawer cabinet)', () => {
  it('every openable spec fits the record cap; the medicine drawer cabinet is the 35-compartment case', () => {
    const counts = Object.entries(OPENABLE_SPECS as unknown as Record<string, {parts: unknown[]}>).map(([k, s]) => [k, s.parts.length] as const);
    for (const [k, n] of counts) expect(n, k).toBeLessThanOrEqual(MAX_HOLDER_PARTS);
    expect(Object.fromEntries(counts).medicineDrawerCabinet).toBe(35);
  });

  it('the codec keeps every seen compartment exactly (two 30-bit words), and decode(encode(x)) is identity', () => {
    const rec = cabinetRecord();
    const t = encodeHolder(rec);
    expect(t.slice(0, 2)).toEqual([4 | 2, 35]);
    const words = t.slice(2, 4);
    expect(words[0]).toBe(2 ** 0 + 2 ** 5 + 2 ** 29);
    expect(words[1]).toBe(2 ** 0 + 2 ** 1 + 2 ** 2 + 2 ** 3 + 2 ** 4); // compartments 30..34
    for (const w of words) expect(Number.isInteger(w) && w >= 0 && w < 2 ** SEEN_WORD_BITS).toBe(true);
    expect(t.slice(4)).toEqual(rec.lots);
    expect(decodeHolder(t)).toEqual(rec);
    expect(decodeHolder(t).seen!.flatMap((v, i) => (v ? [i] : []))).toEqual(SEEN_AT);
  });

  it('holders with <= 30 compartments keep the legacy one-word tuple byte for byte (old saves decode unchanged)', () => {
    for (const len of [1, 2, 9, 15, 29, 30]) {
      const seen = Array.from({length: len}, (_, i) => i % 3 !== 1);
      const rec: HolderRecord = {lots: [4, 9, 11], open: false, searched: true, seen};
      const legacyMask = seen.reduce((m, v, i) => (v ? m + 2 ** i : m), 0);
      expect(encodeHolder(rec)).toEqual([4 | 2, len, legacyMask, 4, 9, 11]);
      expect(decodeHolder([4 | 2, len, legacyMask, 4, 9, 11])).toEqual(rec);
    }
    expect(encodeHolder({lots: [1, 2], open: true, searched: false})).toEqual([1, 1, 2]); // no compartments: unchanged
  });

  it('departure, arrival and ending saves with that cabinet validate, survive the text round trip and restore every compartment + item', () => {
    for (const point of ['departure', 'arrival', 'ending'] as SavePoint[]) {
      const h = harness();
      if (point === 'departure') h.run.campaign!.transit = {from: sid(1), to: sid(2), phase: 'departing', cheat: false};
      const file = h.file(point, 2);
      const v = validateSaveFile(structuredClone(file));
      expect(v.ok, `${point}: ${v.ok ? '' : v.error}`).toBe(true);
      const p = parseSaveText(saveFileText(file));
      expect(p.ok, point).toBe(true);
      const b = new Harness(fixtureCampaign({current: sid(1), known: [sid(0), sid(1), sid(2)], visited: [sid(0), sid(1)]}));
      restoreRun((p as {value: SaveFileV1Like}).value.run, b.target());
      const before = h.run.peekMemory({level: 'mall', section: 'main', station: sid(0)})!.holders[CABINET_KEY];
      const after = b.run.peekMemory({level: 'mall', section: 'main', station: sid(0)})!.holders[CABINET_KEY];
      expect(after, point).toEqual(before);
      expect(after.seen!.flatMap((s, i) => (s ? [i] : []))).toEqual(SEEN_AT);
      // nothing else lost: the inventory, the Lockbox and every other holder of that station come back exactly
      expect(b.inv.toJSON()).toEqual(h.inv.toJSON());
      expect(b.train.lockbox.toJSON()).toEqual(h.train.lockbox.toJSON());
      expect(Object.keys(b.run.peekMemory({level: 'mall', section: 'main', station: sid(0)})!.holders).sort())
        .toEqual(Object.keys(h.run.peekMemory({level: 'mall', section: 'main', station: sid(0)})!.holders).sort());
    }
  });

  it('untrusted data is still refused: too many compartments, an over-wide or negative word, missing words', () => {
    const base = harness().file('arrival', 1) as Any;
    const holders = base.run.memories[memKey].holders;
    const t = holders[CABINET_KEY] as number[];
    const rejects = (mut: (h: number[]) => number[], re: RegExp) => {
      const f = structuredClone(base);
      f.run.memories[memKey].holders[CABINET_KEY] = mut([...t]);
      f.checksum = checksumOf(f.run);
      const v = validateSaveFile(f);
      expect(v.ok).toBe(false);
      expect((v as {error: string}).error).toMatch(re);
    };
    rejects(h => { h[1] = MAX_HOLDER_PARTS + 1; return h; }, /out of range \(1 to 64\)/);
    rejects(h => { h[2] = 2 ** 30; return h; }, /out of range/); // first word wider than 30 bits
    rejects(h => { h[3] = 2 ** 5; return h; }, /out of range \(0 to 31\)/); // last word wider than its 5 compartments
    rejects(h => { h[2] = -1; return h; }, /out of range/);
    rejects(() => [4, 35, 3], /malformed holder/);
  });
});
