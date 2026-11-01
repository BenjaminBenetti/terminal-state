// Task reactor-build-20261101 (lane RESTART): the restart RUNTIME on a fake host (world/reactor/restart.ts) — aiming at a control
// (reach, walls, enemies in front), press vs HOLD-E (ring, release / look away / hit let go with nothing done), parts consumed once,
// every change persisted at once and restored on rebuild (travel; Retry's entry snapshot), the in-world overlays (seated cartridge,
// key in the switch, lamps), the screens (redrawn only on change) and the HUD objective line; inert without layout.reactor.
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import * as THREE from 'three';
import {installCanvasShim, ShimCanvas} from './helpers/canvas2d';
import {REACTOR_LANE, emptyReactorState, loadReactorState} from '../src/world/reactor/runState';
import {FUSE_CARTRIDGE_ID, REACTOR_KEY_ID} from '../src/world/reactor/restartLogic';
import {ReactorRestart} from '../src/world/reactor/restart';
import {drawReactorScreen, screenKey, screenPixels, type ReactorScreenId, type ScreenModel} from '../src/world/reactor/restartScreens';
import {VENT_TOWERS} from '../src/world/reactor/restartWin';
import {aimAt, buildRestart, fakeHost, reactorInfoFixture} from './helpers/reactorRestartFixture';
import type {StationLayout} from '../src/gen/stationTypes';

let uninstall: () => void = () => {};
beforeAll(() => { uninstall = installCanvasShim(false); });
afterAll(() => uninstall());

const give = (h: ReturnType<typeof fakeHost>, id: string, n = 1) => h.inv.add(h.inv.makeStack(id, n));
const lastToast = (h: ReturnType<typeof fakeHost>) => h.toasts[h.toasts.length - 1];

describe('restart controls in the world', () => {
  it('builds an overlay per restart control and a plane per screen; ignores unknown control ids', () => {
    const h = fakeHost();
    const rt = buildRestart(h);
    expect(rt.controls.map(c => c.id)).toEqual(['fuse-0', 'fuse-1', 'breaker', 'valve', 'pump', 'keyswitch', 'rods']);
    expect(rt.screens.map(s => s.id)).toEqual(['pitBoard', 'switchgearBoard', 'pumpBoard', 'controlMonitor']);
    expect(h.scene.getObjectByName('reactor-restart')).toBe(rt.root);
    // every overlay mesh is tagged with its storey (level culling)
    const untagged: string[] = [];
    rt.root!.traverse(o => { if ((o as THREE.Mesh).isMesh && typeof o.userData.level !== 'number') untagged.push(o.name); });
    expect(untagged).toEqual([]);
    // a screen faces its viewers (contract yaw: forward = (-sin yaw, -cos yaw) -> +z here) and sits 1.5 cm off the frame
    const pit = rt.screens[0].mesh;
    const n = new THREE.Vector3(0, 0, 1).applyQuaternion(pit.quaternion);
    expect(n.z).toBeCloseTo(1, 5);
    expect(pit.position.z).toBeCloseTo(2.015, 5);
  });

  it('press controls: aim + E operates (part consumed once), a refusal says why and changes nothing', () => {
    const h = fakeHost();
    const rt = buildRestart(h);
    aimAt(h, rt, 'fuse-0');
    rt.frame(0.016);
    expect(rt.target?.id).toBe('fuse-0');
    expect(rt.prompt).toContain('burnt out');
    expect(rt.interact()).toBe(true);
    expect(lastToast(h)).toMatchObject({warn: true, text: expect.stringContaining('Tier 2 stores')});
    expect(rt.state!.fuses).toEqual([false, false]);
    give(h, FUSE_CARTRIDGE_ID, 1);
    rt.frame(0.016);
    expect(rt.prompt).toContain('Fit a fuse cartridge');
    expect(rt.interact()).toBe(true);
    expect(rt.state!.fuses).toEqual([true, false]);
    expect(h.inv.count(FUSE_CARTRIDGE_ID)).toBe(0);
    expect(rt.root!.getObjectByName('reactor-control-fuse-0')!.getObjectByName('seated-cartridge')!.visible).toBe(true);
    // persisted at once (no teardown needed)
    expect(loadReactorState(h.run.laneStore(REACTOR_LANE), 2, 2).fuses).toEqual([true, false]);
    // E again on the seated slot: a status line, nothing consumed
    give(h, FUSE_CARTRIDGE_ID, 1);
    expect(rt.interact()).toBe(true);
    expect(h.inv.count(FUSE_CARTRIDGE_ID)).toBe(1);
    expect(lastToast(h).text).toMatch(/cartridge seated/);
  });

  it('HOLD controls: the ring fills, the handwheel turns, releasing early / looking away / a hit lets go with nothing done', () => {
    const h = fakeHost();
    const rt = buildRestart(h);
    const wheel = rt.root!.getObjectByName('reactor-control-valve')!.children.find(c => c.type === 'Group')!;
    aimAt(h, rt, 'valve');
    h.keys.add('KeyE');
    expect(rt.interact()).toBe(true);
    for (let i = 0; i < 10; i++) rt.frame(0.1); // 1 s of 3
    expect(rt.hold?.e.id).toBe('valve');
    expect(h.ring[h.ring.length - 1]).toBeCloseTo(1 / 3, 1);
    expect(wheel.rotation.z).toBeGreaterThan(1);
    expect(rt.prompt).toMatch(/Turning the handwheel… 3\d %/);
    expect(h.inputOwners![0]()).toBe(true); // no shot / ADS while holding
    h.keys.delete('KeyE');
    rt.frame(0.1);
    expect(rt.hold).toBeNull();
    expect(rt.state!.valve).toBe(false);
    expect(h.ring[h.ring.length - 1]).toBeNull();
    expect(wheel.rotation.z).toBe(0);
    // look away mid-hold
    h.keys.add('KeyE');
    rt.interact();
    rt.frame(0.5);
    h.camera.lookAt(h.camera.position.x + 5, h.camera.position.y, h.camera.position.z); h.camera.updateMatrixWorld(true);
    rt.frame(0.1);
    expect(rt.hold).toBeNull();
    expect(rt.state!.valve).toBe(false);
    // a hit lets go
    aimAt(h, rt, 'valve');
    rt.interact();
    rt.frame(1);
    (h.hitListeners![0] as (hit: {amount: number}) => void)({amount: 12});
    expect(rt.hold).toBeNull();
    expect(lastToast(h).text).toMatch(/Hit! You let go of the main coolant valve/);
    // the full 3 s hold opens it
    rt.interact();
    for (let i = 0; i < 31; i++) rt.frame(0.1);
    expect(rt.state!.valve).toBe(true);
    expect(wheel.rotation.z).toBeCloseTo(2.5 * Math.PI * 2, 5);
    expect(loadReactorState(h.run.laneStore(REACTOR_LANE), 2, 2).valve).toBe(true);
  });

  it('never operates through a wall, beyond reach or past a living enemy in front of it', () => {
    const h = fakeHost();
    const rt = buildRestart(h);
    aimAt(h, rt, 'valve');
    h.wall = true;
    rt.frame(0.016);
    expect(rt.target).toBeNull();
    expect(rt.interact()).toBe(false);
    h.wall = false;
    rt.frame(0.016);
    expect(rt.target?.id).toBe('valve');
    // a zombie between the eye and the valve
    const e = rt.controls.find(c => c.id === 'valve')!;
    (h.zombies as unknown as object[]).push({brain: {x: e.c.at.x, z: e.c.at.z + 0.5, y: e.c.at.y - 1.2, alive: true, stats: {radius: 0.3}}});
    rt.frame(0.016);
    expect(rt.target).toBeNull();
    (h.zombies as unknown as object[]).length = 0;
    // out of reach
    h.camera.position.z += 3; h.camera.updateMatrixWorld(true);
    rt.frame(0.016);
    expect(rt.target).toBeNull();
  });

  it('restores after a rebuild (travel): seated parts stay seated, the key stays in, nothing is consumed again', () => {
    const h = fakeHost();
    const rt = buildRestart(h);
    give(h, FUSE_CARTRIDGE_ID, 2); give(h, REACTOR_KEY_ID, 1);
    for (const id of ['fuse-0', 'fuse-1', 'breaker', 'keyswitch'] as const) expect(rt.qaOperate(id).ok).toBe(true);
    rt.teardown();
    expect(h.scene.getObjectByName('reactor-restart')).toBeUndefined();
    // another level (no layout.reactor): inert
    for (const s of h.sectionHooks) s.build?.({levels: [], seed: 1} as unknown as StationLayout);
    expect(rt.info).toBeNull();
    rt.frame(0.1);
    expect(rt.prompt).toBeNull();
    expect(rt.interact()).toBe(false);
    for (const s of h.sectionHooks) s.teardown?.();
    // back on the Reactor
    for (const s of h.sectionHooks) s.build?.(h.layout);
    expect(rt.state).toMatchObject({fuses: [true, true], breaker: true, keyInserted: true, valve: false});
    expect(rt.root!.getObjectByName('inserted-key')!.visible).toBe(true);
    expect(h.inv.count(FUSE_CARTRIDGE_ID)).toBe(0);
    expect(h.inv.count(REACTOR_KEY_ID)).toBe(0);
  });

  it('Retry: the level-entry snapshot of the section memory brings the record back with the inventory it had', () => {
    const h = fakeHost();
    const rt = buildRestart(h);
    give(h, FUSE_CARTRIDGE_ID, 1);
    const entry = h.run.levelMemories('reactor' as never);
    const invAtEntry = h.inv.count(FUSE_CARTRIDGE_ID);
    rt.qaOperate('fuse-1');
    rt.teardown(); // Game.retryLevel: leaveSection (lane teardown saves) THEN restoreLevelMemories
    h.run.restoreLevelMemories('reactor' as never, entry);
    rt.build(h.layout);
    expect(rt.state!.fuses).toEqual([false, false]);
    expect(invAtEntry).toBe(1); // (the run snapshot restores the inventory the same way: the cartridge is back in the pockets)
  });

  it('screens redraw only when what they show changes; the HUD line ticks the tasks and names the tier', () => {
    const h = fakeHost();
    const rt = buildRestart(h);
    const after = rt.counts.redraws;
    expect(after).toBe(4);
    for (let i = 0; i < 30; i++) rt.frame(0.05);
    expect(rt.counts.redraws).toBe(4); // nothing changed: no redraw, no per-frame canvas work
    rt.qaOperate('valve');
    rt.frame(0.05);
    expect(rt.counts.redraws).toBe(8); // every board shows the valve (pit board's next step / tasks too)
    expect(rt.objective).toContain('Restart the reactor');
    expect(rt.objective).toContain('<div class="tier">Tier 2</div>');
    // AIR starts a generator: only the pit board redraws (4 Hz poll of the shared record)
    const rec = emptyReactorState(2, 2);
    rec.valve = true;
    rec.generators[0] = {started: true, startedAt: 1};
    h.run.setLaneStore(REACTOR_LANE, rec);
    for (let i = 0; i < 6; i++) rt.frame(0.05);
    expect(rt.counts.redraws).toBe(9);
  });

  it('inert on other levels; the install registers the hooks once', () => {
    const h = fakeHost();
    const rt = new ReactorRestart(h).install();
    expect([h.sectionHooks.length, h.frameHooks.length, h.interactHandlers.length, h.promptProviders!.length, h.inputOwners!.length]).toEqual([1, 1, 1, 1, 1]);
    h.layout = {levels: [], seed: 3} as unknown as StationLayout;
    for (const s of h.sectionHooks) s.build?.(h.layout);
    rt.frame(0.1);
    expect(h.scene.children).toHaveLength(0);
    expect(h.lightPool.circuitLevel).toBeNull(); // other levels' lighting untouched
  });
});

describe('screen drawing', () => {
  it('draws every screen in every phase without throwing; keys move only with their content', () => {
    const info = reactorInfoFixture();
    const s = emptyReactorState(2, 2);
    const m: ScreenModel = {state: s, tiers: info.tiers, zones: info.zones, winT: null, towers: VENT_TOWERS.map(() => 'standby'), core: 0, pumpK: 0, next: 'Next: find the startup key'};
    const ids: ReactorScreenId[] = ['pitBoard', 'switchgearBoard', 'pumpBoard', 'controlMonitor'];
    const phases = [() => {}, () => { s.fuses = [true, true]; s.breaker = true; }, () => { s.valve = true; s.pump = true; m.pumpK = 1; s.keyInserted = true; },
      () => { s.rods = true; s.restarted = true; m.winT = 12; m.core = 1; m.towers = ['online', 'power', 'standby', 'standby', 'standby', 'standby']; }];
    const keys = new Map<ReactorScreenId, string[]>();
    for (const step of phases) {
      step();
      for (const id of ids) {
        const {pw, ph} = screenPixels(1.6, 1.0);
        const c = new ShimCanvas(true);
        c.width = pw; c.height = ph;
        drawReactorScreen(c.getContext() as unknown as CanvasRenderingContext2D, id, m, pw, ph);
        let lit = 0;
        for (let i = 0; i < c.data.length; i += 4) if (c.data[i] + c.data[i + 1] + c.data[i + 2] > 60) lit++;
        expect(lit, id).toBeGreaterThan(200);
        keys.set(id, [...(keys.get(id) ?? []), screenKey(id, m)]);
      }
    }
    for (const id of ids) expect(new Set(keys.get(id)).size, id).toBe(4);
    expect(screenKey('switchgearBoard', m)).toBe(screenKey('switchgearBoard', {...m, pumpK: 0.3}));
  });
});
