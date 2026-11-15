import {describe, expect, it, vi} from 'vitest';
import {BoxGeometry, Group, Mesh, MeshBasicMaterial, Scene} from 'three';
import type {StackJSON} from '../src/items/inventory';
import type {SectionKey} from '../src/levels/types';
import {restoreCarry, restoreParticipants, type RunSnapshot} from '../src/run/snapshot';
import {runSurfaceBoundary} from '../src/run/surfaceBoundary';
import {SURFACE_VERSION_LANE} from '../src/run/surfaceRun';
import {parseSaveText} from '../src/save/validate';
import {restoreRun, saveFileText} from '../src/save/serialize';
import {SurfaceCargo} from '../src/world/surfaceTruckCargo';
import {SURFACE_TRUCK_LANE} from '../src/world/surfaceTruckSpec';
import {skywaysCarRecord} from '../src/world/skywaysCarStore';
import {SURFACE_EXPLORATION_LANE} from '../src/ui/surfaceMap';
import {fillInventory, fillLockbox, fixtureCampaign, Harness, populateStation, sid} from './helpers/saveFixture';

function expedition() {
  const h = new Harness(fixtureCampaign({transit: {from: sid(0), to: sid(1), phase: 'departing', cheat: false}}));
  const cargo = new SurfaceCargo(); h.participants.push(cargo.participant());
  const main: SectionKey = {level: 'subway', station: sid(0), section: 'main'}, surface: SectionKey = {...main, section: 'surface'};
  fillInventory(h); fillLockbox(h, 1);
  populateStation(h, main, {holders: 4, layoutPickups: 4, dropped: 2, zombies: 5, bags: 1});
  populateStation(h, {...main, station: sid(1)}, {holders: 2, layoutPickups: 2, dropped: 0, zombies: 3, bags: 0});
  const base = h.run.memory(main); base.killed = [1, 3]; base.lanes[SURFACE_VERSION_LANE] = {v: 1};
  const mem = h.run.memory(surface); mem.visits = 2; mem.killed = [0, 3]; mem.pickups = [];
  mem.lanes[SURFACE_EXPLORATION_LANE] = {v: 1, blocks: ['B7', 'C6'], destinations: ['SR-12']};
  const bag = h.inv.makeStack('backpack', 1), mask = h.inv.makeStack('gas_mask', 1), tank = h.inv.makeStack('airtank_backpack', 1);
  mask.filter = 7.25; tank.air = 33.75; bag.bag![0] = mask; bag.bag![1] = tank;
  const slots: (StackJSON | null)[] = new Array(16).fill(null);
  slots[0] = structuredClone(bag); slots[4] = structuredClone(h.inv.makeStack('pistol', 1, 3)); slots[8] = structuredClone(h.inv.makeStack('water', 2));
  mem.lanes[SURFACE_TRUCK_LANE] = skywaysCarRecord(115.25, 0, 178.5, 1.125, 0, {lights: true, trunk: slots});
  const station = `${sid(0)}:surface`;
  cargo.ensure(1234, station, ['armor', 'radar', 'scanner', 'sentry'].map((kind, i) =>
    ({id: kind, kind: kind as 'armor' | 'radar' | 'scanner' | 'sentry', x: 160 + i * 2, y: 0, z: 160, yaw: i * 0.125, level: 0})));
  expect(cargo.take(cargo.records[0].uid)).toBeNull();
  expect(cargo.recover(() => h.train.upgrades.fit('armor') ? {uid: 'armor'} : {error: 'already installed'})).toBeNull();
  expect(cargo.secure(cargo.records[1].uid, station)).toBeNull();
  expect(cargo.take(cargo.records[3].uid)).toBeNull();
  expect(cargo.drop(station, {x: 177.25, y: 0.27, z: 162.125, yaw: -1.25})).toBe(true);
  expect(cargo.take(cargo.records[2].uid)).toBeNull();
  h.train.parkAt(main); h.train.fuel.tank = 13;
  h.train.cargo.add({kind: 'item', stack: structuredClone(h.inv.makeStack('medkit', 1)), x: -0.45, y: 0.125, z: 1.75, q: [0, 0, 0, 1]});
  h.survival.hunger = 23.125; h.survival.thirst = 61.75; h.survival.time = 903.5;
  h.clock = 897; h.run.playtime = 205; h.run.current = {...main}; h.takeEntry();
  return {h, cargo, main, surface};
}

/** Small real disposable scene roots stand in for the two GPU worlds; state remains the ordinary Run/save fixture. */
function renderRoots() {
  const scene = new Scene(), live = new Set<Group>(), disposed = new Set<Group>();
  let peak = 0;
  return {
    scene, live, disposed,
    get peak() { return peak; },
    build(key: SectionKey, h: Harness) {
      const root = new Group(), geometry = new BoxGeometry(1, 1, 1), material = new MeshBasicMaterial();
      const mem = h.run.memory(key);
      root.userData = {seed: h.run.seedFor(key), killed: [...mem.killed], pickups: structuredClone(mem.pickups), holders: structuredClone(mem.holders)};
      root.add(new Mesh(geometry, material)); scene.add(root); live.add(root); peak = Math.max(peak, live.size);
      return {root, release: async () => {
        // Disposal can span an async renderer flush; target preparation must await it.
        await Promise.resolve();
        geometry.dispose(); material.dispose(); root.removeFromParent(); live.delete(root); disposed.add(root);
      }};
    },
  };
}

function restoreSnapshot(h: Harness, main: SectionKey, snapshot: RunSnapshot): void {
  h.run.restoreScopeMemories(main, snapshot.memories);
  h.inv = restoreCarry(snapshot, h);
  restoreParticipants(snapshot, h.participants);
  h.run.current = {...main}; h.run.arrival = {...snapshot.arrival};
}

describe('Surface Run releases one world before preparing another', () => {
  it.each(['target', 'asset', 'warmup'] as const)('rolls back a %s refusal without refilling or changing saved ownership', async stage => {
    const {h, cargo, main, surface} = expedition(), roots = renderRoots();
    const source = roots.build(main, h), renderedSource = structuredClone(source.root.userData);
    const before = h.file('departure').run;
    const refusal = new Error(`${stage} refused`);
    let snapshot: RunSnapshot | undefined, target: ReturnType<typeof roots.build> | undefined, restored: ReturnType<typeof roots.build> | undefined;
    const result = await runSurfaceBoundary({
      suspend: async () => {
        // This is the existing station snapshot after its runtime lanes have saved their records.
        h.takeEntry(); snapshot = h.run.entry!;
        await source.release();
      },
      enter: async () => {
        expect(roots.live.size).toBe(0); expect(source.root.parent).toBeNull(); expect(roots.disposed.has(source.root)).toBe(true);
        if (stage === 'target') throw refusal;
        await Promise.resolve(); // Destination asset preparation also starts with no outgoing world.
        expect(roots.live.size).toBe(0);
        if (stage === 'asset') throw refusal;
        h.run.current = {...surface}; h.run.memory(surface).visits++;
        // Partial initialization may have registered more finite depot cargo before the graphics warm-up fails.
        cargo.ensure(1234, `${sid(0)}:surface`, [{id: 'spare-radar', kind: 'radar', x: 164, y: 0, z: 162, yaw: 0, level: 0}]);
        target = roots.build(surface, h);
        await Promise.resolve(); throw refusal;
      },
      restore: async () => {
        await target?.release();
        expect(roots.live.size).toBe(0);
        restoreSnapshot(h, main, snapshot!);
        restored = roots.build(main, h);
        await Promise.resolve(); // A restored source is not ready until its full graphics warm-up resolves.
      },
    });
    expect(result).toEqual({ok: false, error: refusal, restored: true});
    expect(roots.peak).toBe(1); expect(roots.live.size).toBe(1); expect(roots.scene.children).toEqual([restored!.root]);
    expect(restored!.root.userData).toEqual(renderedSource);
    expect(h.file('departure').run).toEqual(before);
    const parsed = parseSaveText(saveFileText(h.file('departure')));
    expect(parsed.ok).toBe(true); if (!parsed.ok) throw new Error(parsed.error);
    const loaded = new Harness(), loadedCargo = new SurfaceCargo(); loaded.participants.push(loadedCargo.participant());
    expect(restoreRun(parsed.value.run, loaded.target()).failed).toEqual([]);
    expect(loaded.file('departure').run).toEqual(before);
    expect(loadedCargo.save()).toEqual(cargo.save());
    expect(loaded.train.upgrades.has('armor')).toBe(true);
    expect(loaded.run.campaign!.transit).toEqual({from: sid(0), to: sid(1), phase: 'departing', cheat: false});
    await restored!.release(); expect(roots.live.size).toBe(0);
  });

  it('reports readiness only after target warm-up, with the source render resources already released', async () => {
    const {h, main, surface} = expedition(), roots = renderRoots(), source = roots.build(main, h);
    let finishWarm!: () => void;
    const warmed = new Promise<void>(resolve => { finishWarm = resolve; });
    let target: ReturnType<typeof roots.build> | undefined, complete = false;
    const restore = vi.fn();
    const crossing = runSurfaceBoundary({
      suspend: () => source.release(),
      enter: async () => { target = roots.build(surface, h); await warmed; }, restore,
    }).then(result => { complete = true; return result; });
    await vi.waitFor(() => expect(target).toBeDefined());
    expect(complete).toBe(false); expect(roots.peak).toBe(1); expect(roots.disposed.has(source.root)).toBe(true);
    finishWarm(); expect(await crossing).toEqual({ok: true}); expect(restore).not.toHaveBeenCalled();
    await target!.release();
  });

  it.each(['before', 'suspended', 'enter-failed', 'entered'] as const)('does not reconstruct a stale generation cancelled at %s', async when => {
    let cancelled = when === 'before';
    const refusal = new Error('device replaced during target preparation'), restore = vi.fn(), suspend = vi.fn(async () => {
      if (when === 'suspended') cancelled = true;
    });
    const enter = vi.fn(async () => {
      cancelled = true;
      if (when === 'enter-failed') throw refusal;
    });
    const result = await runSurfaceBoundary({suspend, enter, restore, cancelled: () => cancelled});
    expect(result).toMatchObject({ok: false, restored: false, cancelled: true});
    expect(restore).not.toHaveBeenCalled();
    expect(suspend).toHaveBeenCalledTimes(when === 'before' ? 0 : 1);
    expect(enter).toHaveBeenCalledTimes(when === 'before' || when === 'suspended' ? 0 : 1);
    if (when === 'enter-failed' && !result.ok) expect(result.error).toBe(refusal);
  });

  it('preserves both errors if deterministic source restoration also fails', async () => {
    const error = new Error('target assets unavailable'), restoreError = new Error('device lost while restoring');
    const result = await runSurfaceBoundary({suspend() {}, enter() { throw error; }, async restore() { throw restoreError; }});
    expect(result).toEqual({ok: false, error, restored: false, restoreError});
  });

  it('propagates suspension failure without claiming the partially released source was restored', async () => {
    const error = new Error('source render flush failed'), enter = vi.fn(), restore = vi.fn();
    await expect(runSurfaceBoundary({suspend() { throw error; }, enter, restore})).rejects.toBe(error);
    expect(enter).not.toHaveBeenCalled(); expect(restore).not.toHaveBeenCalled();
  });
});
