import {describe, expect, it} from 'vitest';
import {Harness, sid} from './helpers/saveFixture';
import {SurfaceCargo, SURFACE_SALVAGE_PARTICIPANT} from '../src/world/surfaceTruckCargo';
import {SURFACE_TRUCK_LANE} from '../src/world/surfaceTruckSpec';
import {skywaysCarRecord} from '../src/world/skywaysCarStore';
import {SURFACE_VERSION_LANE} from '../src/run/surfaceRun';
import {SURFACE_EXPLORATION_LANE} from '../src/ui/surfaceMap';
import {parseSaveText, validateSaveFile} from '../src/save/validate';
import {restoreRun, saveFileText} from '../src/save/serialize';
import {checksumOf} from '../src/save/checksum';
import type {StackJSON} from '../src/items/inventory';

function expedition() {
  const h = new Harness(), cargo = new SurfaceCargo();
  h.participants.push(cargo.participant());
  const main = {level: 'subway' as const, station: sid(0), section: 'main'}, surface = {...main, section: 'surface'};
  const base = h.run.memory(main); base.visits = 1; base.killed = [2, 5]; base.pickups = [];
  base.lanes[SURFACE_VERSION_LANE] = {v: 1};
  const mem = h.run.memory(surface); mem.visits = 2; mem.killed = [0, 3]; mem.pickups = [];
  mem.lanes[SURFACE_EXPLORATION_LANE] = {v: 1, blocks: ['B7', 'C6'], destinations: ['SR-12']};
  const bag = h.inv.makeStack('backpack', 1), mask = h.inv.makeStack('gas_mask', 1), tank = h.inv.makeStack('airtank_backpack', 1);
  mask.filter = 7.25; tank.air = 33.75; bag.bag![0] = mask; bag.bag![1] = tank;
  const pistol = h.inv.makeStack('pistol', 1, 3);
  const slots: (StackJSON | null)[] = new Array(16).fill(null); slots[0] = structuredClone(bag); slots[8] = structuredClone(pistol);
  mem.lanes[SURFACE_TRUCK_LANE] = skywaysCarRecord(115.25, 0, 178.5, 1.125, 0, {lights: true, trunk: slots});
  cargo.ensure(1234, `${sid(0)}:surface`, [
    {id: 'armor', kind: 'armor', x: 160, y: 0, z: 160, yaw: 0, level: 0},
    {id: 'radar', kind: 'radar', x: 162, y: 0, z: 160, yaw: 1, level: 0},
  ]);
  expect(cargo.secure(cargo.records[0].uid, `${sid(0)}:surface`)).toBeNull();
  expect(cargo.take(cargo.records[1].uid)).toBeNull();
  return {h, cargo, main, surface, pistol};
}

describe('Surface Run saves conserve ownership and old station memory', () => {
  it('round-trips the exact truck pose, three stores, nested UIDs/charges, rack cargo and permanent interior kills', () => {
    const {h, cargo, main, surface} = expedition();
    const expectedBase = structuredClone(h.run.memory(main)), expectedSurface = structuredClone(h.run.memory(surface));
    const train = h.train.participant().save(), carried = cargo.save();
    const parsed = parseSaveText(saveFileText(h.file('manual')));
    expect(parsed.ok).toBe(true); if (!parsed.ok) throw new Error(parsed.error);
    const restored = new Harness(), restoredCargo = new SurfaceCargo(); restored.participants.push(restoredCargo.participant());
    const result = restoreRun(parsed.value.run, restored.target());
    expect(result.failed).toEqual([]);
    expect(restored.run.memory(main)).toEqual(expectedBase);
    expect(restored.run.memory(surface)).toEqual(expectedSurface);
    expect(restoredCargo.save()).toEqual(carried);
    expect(restored.train.participant().save()).toEqual(train);
    expect(restoredCargo.carried?.uid).toBe(cargo.carried?.uid);
    // First revisit never refills a recovered or attached package.
    restoredCargo.ensure(1234, `${sid(0)}:surface`, [{id: 'armor', kind: 'armor', x: 160, y: 0, z: 160, yaw: 0, level: 0}]);
    expect(restoredCargo.save()).toEqual(carried);
    const max = Math.max(...((expectedSurface.lanes[SURFACE_TRUCK_LANE] as {trunk: (StackJSON | null)[]}).trunk.flatMap(s => s ? [s.uid, ...(s.bag ?? []).flatMap(b => b ? [b.uid] : [])] : [])));
    expect(restored.inv.makeStack('water', 1).uid).toBeGreaterThan(max);
  });

  it('rejects a truck item UID duplicated in carried inventory and malformed cargo/exploration before applying anything', () => {
    const {h, pistol} = expedition(); h.inv.hotbar[0] = structuredClone(pistol);
    const duplicate = validateSaveFile(h.file('manual'));
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) expect(duplicate.error).toMatch(/uid|two places|duplicate/i);
    const good = expedition().h.file('manual');
    const bad = structuredClone(good);
    (bad.run.participants[SURFACE_SALVAGE_PARTICIPANT] as {records: {slot: number | null}[]}).records[0].slot = 99;
    bad.checksum = checksumOf(bad.run); expect(validateSaveFile(bad).ok).toBe(false);
    const map = structuredClone(good);
    map.run.memories[`${sid(0)}:surface`].lanes[SURFACE_EXPLORATION_LANE] = {v: 1, blocks: ['A1', 'A1'], destinations: []};
    map.checksum = checksumOf(map.run); expect(validateSaveFile(map).ok).toBe(false);
  });
});
