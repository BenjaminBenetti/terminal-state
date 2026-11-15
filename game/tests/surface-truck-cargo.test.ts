import {describe, expect, it} from 'vitest';
import {SurfaceCargo, surfaceCargoProblem} from '../src/world/surfaceTruckCargo';
import type {SurfaceDepotCargo} from '../src/gen/surface/types';

const list: SurfaceDepotCargo[] = (['armor', 'radar', 'scanner', 'sentry'] as const).map((kind, i) =>
  ({id: `SR-salvage-${kind}`, kind, x: 20 + i, y: 0, z: 24, yaw: 0, level: 0}));

describe('finite physical surface salvage ownership', () => {
  it('gives each origin one finite UID, including two stations with the same seed', () => {
    const cargo = new SurfaceCargo();
    cargo.ensure(7, 'st-01:surface', list); cargo.ensure(7, 'st-01:surface', list); cargo.ensure(7, 'st-02:surface', list);
    expect(cargo.records).toHaveLength(8); expect(new Set(cargo.records.map(r => r.uid)).size).toBe(8);
    expect(surfaceCargoProblem(cargo.save())).toBeNull();
  });
  it('four secure attachment points are real finite ownership; full rack refuses without losing the carried case', () => {
    const cargo = new SurfaceCargo(); cargo.ensure(7, 'st-01:surface', list); cargo.ensure(8, 'st-02:surface', list);
    for (const r of cargo.records.slice(0, 4)) expect(cargo.secure(r.uid, 'st-01:surface')).toBeNull();
    expect(cargo.records.slice(0, 4).map(r => r.slot)).toEqual([0, 1, 2, 3]);
    expect(cargo.take(cargo.records[4].uid)).toBeNull();
    const before = cargo.save(); expect(cargo.secure(cargo.carried!.uid, 'st-01:surface')).toMatch(/occupied/);
    expect(cargo.save()).toEqual(before); expect(surfaceCargoProblem(cargo.save())).toBeNull();
  });
  it('detach, carry across the access, drop and reload keep UID/pose; returning never creates a second depot find', () => {
    const cargo = new SurfaceCargo(); cargo.ensure(7, 'st-01:surface', list);
    const uid = cargo.records[0].uid;
    cargo.secure(uid, 'st-01:surface'); cargo.take(uid);
    expect(cargo.drop('st-01:main', {x: 9.25, y: 0, z: 18.5, yaw: 1.2})).toBe(true);
    const saved = cargo.save(), restored = new SurfaceCargo(); restored.load(saved);
    restored.ensure(7, 'st-01:surface', list);
    expect(restored.save()).toEqual(saved); expect(restored.records[0]).toMatchObject({uid, station: 'st-01:main', state: 'ground', slot: null, x: 9.25, z: 18.5, yaw: 1.2});
    expect(restored.take(uid)).toBeNull(); expect(restored.secure(uid, 'st-01:surface')).toBeNull();
    expect(restored.records.filter(r => r.uid === uid)).toHaveLength(1);
  });
  it('recovery changes ownership only after the existing installation succeeds; refusal and a second install are safe', () => {
    const cargo = new SurfaceCargo(); cargo.ensure(7, 'st-01:surface', list); const uid = cargo.records[0].uid;
    cargo.take(uid); const before = cargo.save();
    expect(cargo.recover(() => ({error: 'Armour already fitted'}))).toMatch(/already fitted/); expect(cargo.save()).toEqual(before);
    let installs = 0;
    expect(cargo.recover(kind => { expect(kind).toBe('armor'); installs++; return {uid: 'armor'}; })).toBeNull();
    expect(cargo.take(uid)).toMatch(/unavailable/); expect(cargo.recover(() => { installs++; return {uid: 'armor'}; })).toMatch(/No salvage/);
    expect(installs).toBe(1); expect(cargo.records[0]).toMatchObject({state: 'installed', recoveredUid: 'armor'});
  });
  it('rejects duplicate UIDs, duplicate rack slots and malformed recovered references', () => {
    const cargo = new SurfaceCargo(); cargo.ensure(7, 'st-01:surface', list);
    const duplicate = cargo.save(); duplicate.records[1].uid = duplicate.records[0].uid; expect(surfaceCargoProblem(duplicate)).toMatch(/duplicate/);
    cargo.secure(cargo.records[0].uid, 'st-01:surface'); cargo.secure(cargo.records[1].uid, 'st-01:surface');
    const rack = cargo.save(); rack.records[1].slot = rack.records[0].slot; expect(surfaceCargoProblem(rack)).toMatch(/occupied twice/);
    const ref = cargo.save(); Object.assign(ref.records[0], {state: 'installed', slot: null, recoveredUid: 'unknown'}); expect(surfaceCargoProblem(ref)).toMatch(/recovered/);
  });
});
