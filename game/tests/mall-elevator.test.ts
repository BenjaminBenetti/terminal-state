// Task mall-playtest-revision-20261031 (lane ARCH, U07): the mall's glass elevator — "needs ropes pulling it up and down ... a little
// bit more detailing ... there is a wall where the door should be, and you can just walk through the wall when the door is open".
//  - the Office elevator view is byte-for-byte what it was (pinned signature taken BEFORE the change; glass-only additions);
//  - the glass car's suspension (world/elevator.ts planGlassRig + the view): hoist ropes from a FIXED top (the traction sheave under
//    the machine head) to the car's crosshead hitch at every stop and in motion; the counterweight moves opposite (1:1 roping:
//    car rope + counterweight rope = constant); every rig piece stays inside the shaft between the pit floor and the machine head;
//    the counterweight never meets the car; the travelling cable's loop stays above the pit floor;
//  - the real runtime on the synthetic revised mall (tests/helpers/mallFixture.ts) with the REAL Player body: the shut doorway blocks (collision + the shut landing
//    leaves fill the aperture), call -> doors open -> walk in through the aperture -> ride to the top stop (continuous, carried) ->
//    walk out; the cab's landing leaves are clear of the aperture while open.
// (The wall-face aperture itself — no painted wall in the doorway — is asserted on the real built mall in mall-arch.test.ts.)
import {describe, expect, it, vi} from 'vitest';
import * as THREE from 'three';
import {installCanvasShim} from './helpers/canvas2d';
import {fakeEnvTextures} from './helpers/openablesFixture';
import {WorldMaterials} from '../src/world/materials';
import {CAB_SPEED, DOOR_TIME, GLASS_RIG, buildElevatorView, planElevator, planGlassRig, rigCableBend, rigCarRope, rigCwTop} from '../src/world/elevator';
import {gateLocal, gateWorld, readTowerInfo} from '../src/world/towerShared';
import {mallFixture} from './helpers/mallFixture';
import type {StationLayout} from '../src/gen/stationTypes';
import {levelsOf} from '../src/gen/levels';
import {WarmupRegistry} from '../src/render/warmup';
import {markShadows} from '../src/render/volumetric';
import {installTower, type TowerHost} from '../src/world/towerRuntime';
import {Player} from '../src/player/player';
import {PickupManager} from '../src/world/pickups';

installCanvasShim(false);

const mats = new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17});

// ---------------------------------------------------------------------------------------------
// The Office elevator (synthetic v2 record): its view must not change at all

const OFFICE = {
  seed: 4242, grid: {w: 1, h: 1}, levels: [1, 2, 3, 4].map(f => ({id: f, baseY: 5.6 + 4.4 * (f - 1), grid: {w: 1, h: 1}})),
  office: {
    version: 2, floors: [1, 2, 3, 4], floorHeight: 4.4, groundY: 5.6,
    storeys: [1, 2, 3, 4].map(f => ({floor: f, levelId: f, baseY: 5.6 + 4.4 * (f - 1), label: f === 1 ? 'L' : String(f), clear: f === 1 ? 4 : 2.9})),
    elevator: {
      cab: {x0: 10, z0: 10, x1: 12.5, z1: 12}, shaft: {x0: 9.5, z0: 9.5, x1: 13, z1: 12.5}, doorSide: 'N', door: {x: 11.25, z: 10, width: 1.5}, cabHeight: 2.6,
      panel: {x: 12.2, dy: 1.2, z: 10.02},
      stops: [1, 2, 3, 4].map(f => ({floor: f, levelId: f, y: 5.6 + 4.4 * (f - 1), area: -1, callPanel: {x: 12.6, y: 5.6 + 4.4 * (f - 1) + 1.2, z: 9.5}, landing: {x: 11.25, z: 8.6}})),
    },
    windows: [], exterior: {x0: 0, z0: 0, x1: 30, z1: 25}, stairs: {well: null, landings: []}, name: 'T',
  },
};

/** Mesh names, vertex counts, material names and a world-position checksum of every mesh under root. */
function viewSignature(root: THREE.Object3D): string {
  const out: string[] = [];
  root.updateMatrixWorld(true);
  const v = new THREE.Vector3();
  root.traverse(o => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const p = m.geometry.attributes.position;
    let s = 0;
    for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld); s += v.x * 1.3 + v.y * 2.7 + v.z * 0.7; }
    out.push(`${m.name}:${p.count}:${(m.material as THREE.Material).name}:${s.toFixed(2)}`);
  });
  return out.join('|');
}
const fnv = (s: string): string => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16); };

describe('the Office elevator is unchanged (shared ElevatorLogic / view; the rig is glass-only)', () => {
  it('the Office car + landings build exactly as before (signature pinned before the change) and carry no rig mesh', () => {
    const info = readTowerInfo(OFFICE as never)!;
    const plan = planElevator(info.elevator!);
    const v = buildElevatorView(plan, mats, {});
    v.setCab(info.elevator!.stops[2].y, 0.4);
    v.setLanding(2, 0.4);
    const sig = viewSignature(v.root);
    expect(sig.length).toBe(2820);
    expect(fnv(sig)).toBe('ac7729aa');
    const names: string[] = [];
    v.root.traverse(o => names.push(o.name));
    expect(names.some(n => /tower-rig|tower-cab-sling/.test(n))).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
// The mall's glass car (the synthetic revised mall: station + 3 rings, the shaft in the gallery, door N; lane GEN's real record
// goes through the same mallTowerRecord -> readTowerInfo path)

let cached: StationLayout | null = null;
const mallLayout = (): StationLayout => (cached ??= mallFixture().layout);

const worldBox = (o: THREE.Object3D): THREE.Box3 => { let r = o; while (r.parent) r = r.parent; r.updateMatrixWorld(true); return new THREE.Box3().setFromObject(o); };

describe('the glass car: ropes from a fixed top anchor to the moving car; counterweight; detailing', () => {
  it('at every stop and in between: rope bottom = the crosshead hitch, rope top fixed at the sheave; the counterweight moves opposite', () => {
    const layout = mallLayout();
    const info = readTowerInfo(layout)!;
    expect(info.elevator, 'the mall has its glass elevator').toBeTruthy();
    const plan = planElevator(info.elevator!);
    const rig = planGlassRig(plan);
    const view = buildElevatorView(plan, mats, {glass: true});
    const byName = (n: string) => view.root.getObjectByName(n) as THREE.Mesh;
    for (const n of ['tower-rig-static', 'tower-rig-sheaves', 'tower-rig-rope-run', 'tower-rig-ropes-car', 'tower-rig-cable-car', 'tower-rig-cable-wall', 'tower-rig-cable-bend', 'tower-cab-sling']) expect(byName(n), n).toBeTruthy();
    const ys = info.elevator!.stops.map(s => s.y);
    expect(ys.length).toBeGreaterThanOrEqual(3);
    const samples = [...ys];
    for (let i = 0; i + 1 < ys.length; i++) samples.push(ys[i] + (ys[i + 1] - ys[i]) * 0.37);
    const [ropeX, ropeZ] = gateWorld(plan.gate, -rig.car.w, rig.car.l);
    const sheaves = worldBox(byName('tower-rig-sheaves'));
    const shaft = info.elevator!.shaft;
    let constant: number | null = null;
    for (const y of samples) {
      view.setCab(y, 0);
      const r = worldBox(byName('tower-rig-ropes-car'));
      // top fixed at the traction sheave (inside its box), bottom on the car's hitch (moves with the car)
      expect(r.max.y).toBeCloseTo(rig.sheaveY, 4);
      expect(r.min.y).toBeCloseTo(y + rig.car.hitch, 4);
      expect([r.min.y, r.max.y]).toEqual(rigCarRope(rig, y).map(v => expect.closeTo(v, 4)));
      expect(rig.sheaveY).toBeGreaterThan(sheaves.min.y);
      expect(rig.sheaveY).toBeLessThan(sheaves.max.y);
      expect((r.min.x + r.max.x) / 2).toBeCloseTo(ropeX, 3);
      expect((r.min.z + r.max.z) / 2).toBeCloseTo(ropeZ, 3);
      // the car's sling (crosshead + shackles) reaches the rope bottom: connected, not floating
      const sling = worldBox(byName('tower-cab-sling'));
      expect(sling.max.y).toBeGreaterThanOrEqual(r.min.y);
      expect(sling.max.y - r.min.y).toBeLessThan(0.1);
      // counterweight: 1:1 roping (car rope + counterweight rope = constant), it hangs between the pit and the deflector
      if (rig.cw) {
        const cw = worldBox(byName('tower-rig-counterweight')), cr = worldBox(byName('tower-rig-ropes-cw'));
        expect(cw.max.y).toBeCloseTo(rigCwTop(rig, y) + 0.12, 3); // the shackles' top
        expect(cr.max.y).toBeCloseTo(rig.defl!.y, 4);
        const sum = (r.max.y - r.min.y) + (cr.max.y - cr.min.y);
        constant ??= sum;
        expect(sum).toBeCloseTo(constant, 4);
        expect(cw.min.y).toBeGreaterThan(rig.pitY + 0.3);
        // it never meets the car (separated along the side gap)
        const cab = worldBox(view.cab);
        const sep = Math.max(cw.min.x - cab.max.x, cab.min.x - cw.max.x, cw.min.z - cab.max.z, cab.min.z - cw.max.z);
        if (cw.max.y > cab.min.y && cw.min.y < cab.max.y) expect(sep, `counterweight clears the car at y ${y}`).toBeGreaterThan(0.02);
      }
      // the travelling cable: loop bottom above the pit floor, both legs going up from it
      const bendY = rigCableBend(rig, y);
      expect(bendY).toBeGreaterThan(rig.pitY);
      expect(worldBox(byName('tower-rig-cable-bend')).min.y).toBeGreaterThan(rig.pitY);
      expect(worldBox(byName('tower-rig-cable-car')).max.y).toBeCloseTo(y - GLASS_RIG.plank + 0.02, 3);
      expect(worldBox(byName('tower-rig-cable-wall')).max.y).toBeCloseTo(rig.cable.fixY, 3);
      // everything stays inside the shaft footprint, between the pit floor and the machine head
      view.root.updateMatrixWorld(true);
      view.root.traverse(o => {
        const m = o as THREE.Mesh;
        if (!m.isMesh || !/tower-rig|tower-cab/.test(m.name) || /hover/.test(m.name)) return;
        const b = new THREE.Box3().setFromObject(m);
        expect(b.min.x, m.name).toBeGreaterThanOrEqual(shaft.x0 - 1e-3);
        expect(b.max.x, m.name).toBeLessThanOrEqual(shaft.x1 + 1e-3);
        expect(b.min.z, m.name).toBeGreaterThanOrEqual(shaft.z0 - 1e-3);
        expect(b.max.z, m.name).toBeLessThanOrEqual(shaft.z1 + 1e-3);
        expect(b.min.y, m.name).toBeGreaterThanOrEqual(rig.pitY - 0.06);
        expect(b.max.y, m.name).toBeLessThanOrEqual(rig.headY + 0.01);
      });
    }
    // the car rope really shortens going up and lengthens going down (the top never moves)
    view.setCab(ys[0], 0);
    const low = worldBox(byName('tower-rig-ropes-car'));
    view.setCab(ys[ys.length - 1], 0);
    const high = worldBox(byName('tower-rig-ropes-car'));
    expect(low.max.y).toBeCloseTo(high.max.y, 6);
    expect(low.max.y - low.min.y).toBeGreaterThan(high.max.y - high.min.y + (ys[ys.length - 1] - ys[0]) - 1e-3);
    // bounded: the rig adds a handful of meshes (static merged; ropes / weight / cable)
    let rigMeshes = 0, tris = 0;
    view.root.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh && /tower-rig/.test(m.name)) { rigMeshes++; tris += (m.geometry.index?.count ?? m.geometry.attributes.position.count) / 3; } });
    expect(rigMeshes).toBeLessThanOrEqual(10);
    expect(tris).toBeLessThan(12000);
  });
});

// ---------------------------------------------------------------------------------------------
// The runtime with the real Player body on the mall fixture

function makeHost(layout: StationLayout, player: Player) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.05, 70);
  scene.add(camera);
  const host = {
    scene, camera, player, zombies: [], levels: levelsOf(layout as never), layout, mats, sfx: null,
    hud: {toast: () => {}}, warmRegistry: new WarmupRegistry(),
    atmosphere: {markShadows: (root: THREE.Object3D, s: boolean) => { markShadows(root, true, s); }},
    interactHandlers: [] as (() => boolean)[], pointerHandlers: [] as (() => boolean)[], frameHooks: [] as ((dt: number) => void)[],
    sectionHooks: [] as {build?(l: StationLayout): void; teardown?(): void}[], promptProviders: [] as (() => string | null)[],
    stateListeners: [] as ((s: never, p: never) => void)[], sectionPreloads: [] as ((l: StationLayout) => Promise<void>)[],
    state: 'playing', warming: false, prepareBeforeShow: async () => {},
    pickups: new PickupManager({}), world: {culler: {enabled: true, register: vi.fn()}},
    travel: vi.fn(async () => ({ok: true})), setState: vi.fn(), fade: vi.fn(),
  };
  return host;
}

const DT = 1 / 30;
const keys = (...k: string[]) => ({down: (c: string) => k.includes(c), hit: () => false, clears: 0});

describe('the glass elevator runtime on the mall fixture (real Player): a shut doorway blocks, an open one is a real aperture', () => {
  it('shut: blocked and filled by the landing leaves; call -> open -> walk in -> ride to the top (continuous) -> walk out; no travel ever', () => {
    const layout = mallLayout();
    const P = new Player();
    const host = makeHost(layout, P);
    const rt = installTower(host as unknown as TowerHost);
    host.sectionHooks[0].build!(layout);
    const e = rt.office!.elevator!, L = host.levels, G = e.plan.gate, info = e.plan.info;
    const s0 = info.stops[0], top = info.stops[info.stops.length - 1];
    const step = (k: string[]) => { P.update(DT, keys(...k), L, null, {aiming: false, speedMult: 1, canSprint: true}); for (const f of host.frameHooks) f(DT); };
    // facing the doors from the landing: yaw 0 faces -z (towerRuntime convention), the gate normal points cab -> landing
    const inYaw = G.nz > 0 ? 0 : G.nz < 0 ? Math.PI : G.nx > 0 ? Math.PI / 2 : -Math.PI / 2;
    const outYaw = inYaw + Math.PI;
    const [lx, lz] = gateWorld(G, G.depth + 0.6, 0);
    P.spawn(lx, lz, inYaw, s0.y);
    for (let i = 0; i < 3; i++) step([]);
    // --- SHUT: the doorway is solid (collision + sight) and the shut landing leaves fill the aperture ---
    expect(e.gate.open).toBe(false);
    const eye = {x: lx, y: s0.y + 1.5, z: lz};
    const [cx, cz] = gateWorld(G, -0.8, 0);
    const hit = L.raycast(eye, (() => { const d = new THREE.Vector3(cx - lx, 0, cz - lz).normalize(); return {x: d.x, y: 0, z: d.z}; })(), 3);
    expect(hit.kind).not.toBe('none');
    for (let i = 0; i < 45; i++) step(['KeyW']);
    expect(rt.playerInCab()).toBe(false);
    expect(gateLocal(G, P.x, P.z)[0], 'stopped at the shut doors (outside the landing plane)').toBeGreaterThan(G.depth - 0.05);
    const leaves = new THREE.Box3();
    for (const n of ['tower-door-landing-l', 'tower-door-landing-r']) leaves.expandByObject(e.view.landings[0].getObjectByName(n)!);
    const along = (x: number, z: number) => gateLocal(G, x, z)[1];
    const span = [along(leaves.min.x, leaves.min.z), along(leaves.max.x, leaves.max.z)].sort((a, b) => a - b);
    expect(span[0]).toBeLessThanOrEqual(-G.hw + 1e-3);
    expect(span[1]).toBeGreaterThanOrEqual(G.hw - 1e-3);
    expect(leaves.max.y - s0.y).toBeGreaterThan(e.plan.doorH - 0.02);
    // --- call: the doors open (the cab waits at the bottom stop) ---
    expect(rt.callFloor(s0.floor)).toBe(true);
    for (let t = 0; t < DOOR_TIME + 0.3; t += DT) step([]);
    expect(e.logic.state).toBe('open');
    expect(e.gate.open).toBe(true);
    // the landing leaves are out of the aperture (just inside their pockets)
    for (const n of ['tower-door-landing-l', 'tower-door-landing-r']) {
      const b = worldBox(e.view.landings[0].getObjectByName(n)!);
      const inner = Math.min(Math.abs(along(b.min.x, b.min.z)), Math.abs(along(b.max.x, b.max.z)));
      expect(inner, n).toBeGreaterThanOrEqual(G.hw - 1e-3);
    }
    // --- walk in through the aperture (real movement / collision) ---
    P.yaw = inYaw;
    for (let i = 0; i < 60 && !rt.playerInCab(); i++) step(['KeyW']);
    for (let i = 0; i < 8; i++) step(['KeyW']);
    expect(rt.playerInCab()).toBe(true);
    for (let i = 0; i < 10; i++) step([]);
    // --- ride to the top stop (the cab panel's button through the logic), carried, continuous ---
    expect(rt.panelPick(top.floor)).toBe(true);
    let moved = false, last = P.y;
    for (let i = 0; i < 30 * 60 && !(moved && !e.logic.moving && e.logic.state === 'open'); i++) {
      step([]);
      if (e.logic.moving) { moved = true; expect(e.gate.open).toBe(false); }
      expect(Math.abs(P.y - last)).toBeLessThanOrEqual(CAB_SPEED * DT + 1e-6);
      expect(P.y).toBeGreaterThanOrEqual(e.logic.y - 1e-6);
      last = P.y;
    }
    expect(moved).toBe(true);
    expect(e.logic.y).toBe(top.y);
    expect(P.y).toBeCloseTo(top.y, 5);
    // ropes followed: the car rope's bottom is on the car's hitch at the top stop
    const rig = planGlassRig(e.plan);
    const ropes = worldBox(e.view.root.getObjectByName('tower-rig-ropes-car')!);
    expect(ropes.min.y).toBeCloseTo(top.y + rig.car.hitch, 4);
    // --- walk out onto the top storey ---
    P.yaw = outYaw;
    for (let i = 0; i < 60; i++) step(['KeyW']);
    expect(rt.playerInCab()).toBe(false);
    expect(gateLocal(G, P.x, P.z)[0]).toBeGreaterThan(G.depth);
    expect(L.levelAt(P.x, P.z, P.y)).toBe(top.levelId);
    expect(host.travel).not.toHaveBeenCalled();
    expect(host.setState).not.toHaveBeenCalled();
    expect(host.fade).not.toHaveBeenCalled();
  });
});
