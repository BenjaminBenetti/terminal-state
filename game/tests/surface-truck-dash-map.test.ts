// Task studio-surface-map-tent-cab-20261119-025201-01 (lane CAB): THE PLANNING MAP ON THE TRUCK'S PASSENGER-SIDE DASHBOARD
// (world/surface/truckDashMap.ts; user: "Move the truck's existing map INTO THE CAB, on the PASSENGER-SIDE DASHBOARD (not outside on the
// right). Looking at it and pressing E opens a closer readable view; closing returns naturally to the cab/seat and normal controls. Keep
// its map content/knowledge consistent with the tent map. Ensure cab glass/geometry and competing truck interactions do not block the
// intended prompt or view; no accidental exit/repair/action. Do not change truck gas safety, inventory/cargo, damage or fuel rules."):
//  - geometry: a sheet in a low holder resting on the dash top on the passenger half, inside the cab, facing the seated eye; clear of the
//    glass, the A-pillar, the cab's parts (binnacle, centre stack, gear lever), the FOG PRESSURE readout and the steering wheel; the
//    driver's own windscreen pane and the forward view stay clear; part of the cockpit (it moves with the truck, no shadow);
//  - aim: from the seated eye the crosshair on the sheet reads it within reach, with no glass / cab part / the wheel in between; looking
//    ahead, to the driver's side or at the binnacle does not;
//  - [E] seated: aimed -> the planning map (never the exit, a repair, a compartment or a later [E] handler: cargo, the map table), at any
//    speed; not aimed -> gets out exactly as before (its speed gate); on foot it never reads;
//  - closing (the REAL map runtime's open() / onClose): the driver stays seated through the 'map' state, the closing E is kept from the
//    game until released and never gets out, the driving controls come back; speed, lamps, the closed cab (air), condition and storage
//    unchanged;
//  - content: the sheet draws the map runtime's own live model — the tent table's drawing — and redraws seated when it changes;
//  - classified in the audits (not storage; a static built-in part of the vehicle); its shared resources released with the truck.
import * as THREE from 'three';
import {describe, expect, it} from 'vitest';
import {installCanvasShim} from './helpers/canvas2d';
import {LEVELS} from '../src/levels/registry';
import type {StationLayout} from '../src/gen/stationTypes';
import {surfaceKeyOf} from '../src/gen/surface/surfaceRun';
import {createRun} from '../src/run/runState';
import {PROP_DEFS} from '../src/gen/props';
import {OPENABLE_AUDIT, VEHICLE_OPEN_AUDIT} from '../src/world/openablesSpec';
import {PROP_PHYSICS_AUDIT, VEHICLE_PHYSICS_AUDIT} from '../src/damage/physicsAudit';
import {mapSignature, type PlanningMap} from '../src/world/surface/mapModel';
import {SurfaceMapRuntime, TABLE} from '../src/world/surface/mapRuntime';
import {carToWorld} from '../src/world/skywaysCarSpec';
import type {SkywaysCar} from '../src/world/skywaysCar';
import {TRUCK_ANCHORS} from '../src/world/surface/truckAnchors.generated';
import {TRUCK_FIXED_PARTS, truckAuditKind} from '../src/world/surface/truckAudit';
import {truckCabLayout} from '../src/world/surface/truckCab';
import {TRUCK_DASH_MAP, TRUCK_DASH_MAP_TEXT, buildTruckDashMap, truckDashMapLayout, truckDashMapSignature} from '../src/world/surface/truckDashMap';
import type {TruckView} from '../src/world/surface/truckModel';
import {buildTruckDash} from '../src/world/surface/truckPressureDash';
import {TRUCK_RT, TRUCK_SPEC, TRUCK_TEXT} from '../src/world/surface/truckSpec';
import {build, frame, lookAt, press, run, teardown} from './helpers/skywaysCarHost';
import {getInTruck, setTruckLayout, stopTruck} from './helpers/surfaceTruckHost';
import {fieldHost, type FieldTestHost} from './helpers/surfaceTruckFieldHost';

installCanvasShim(false); // (the sheet's / the table's runtime canvases; no rasterising: structural)

type V3 = {x: number; y: number; z: number};
const A = TRUCK_ANCHORS, L = truckDashMapLayout(), CAB = truckCabLayout();
const v3 = (p: V3) => new THREE.Vector3(p.x, p.y, p.z);
const dashBox = CAB.boxes.find(b => b.name === 'dash')!;
const pane = (n: string) => A.glass.find(g => g.name === n)!;
const paneBox = (g: (typeof A.glass)[number], pad = 0.005) => new THREE.Box3(new THREE.Vector3(g.x0 - pad, g.y0 - pad, g.z0 - pad), new THREE.Vector3(g.x1 + pad, g.y1 + pad, g.z1 + pad));
const cabBox = (b: {x0: number; x1: number; y0: number; y1: number; z0: number; z1: number}) => new THREE.Box3(new THREE.Vector3(b.x0, b.y0, b.z0), new THREE.Vector3(b.x1, b.y1, b.z1));
/** A point on the sheet (truck frame): `u` across (toward the tail), `v` up the slope (toward the passenger door), from its centre. */
const sheetPoint = (u: number, v: number) => v3(L.centre).addScaledVector(v3(L.right), u).addScaledVector(v3(L.up), v);
/** The dash map's bounds in the truck frame (a standalone build: the cab group sits at the view's origin). */
function mapBounds(): THREE.Box3 {
  const g = buildTruckDashMap().group;
  g.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(g);
}
/** Does the segment from `o` to `p` meet `box` before reaching `p`? */
function blocks(o: THREE.Vector3, p: THREE.Vector3, box: THREE.Box3): boolean {
  const hit = new THREE.Ray(o, p.clone().sub(o).normalize()).intersectBox(box, new THREE.Vector3());
  return !!hit && hit.distanceTo(o) < p.distanceTo(o) - 1e-6;
}
/** The closest distance from the segment o -> p to the point q. */
function segDist(o: THREE.Vector3, p: THREE.Vector3, q: THREE.Vector3): number {
  const d = p.clone().sub(o), t = Math.max(0, Math.min(1, q.clone().sub(o).dot(d) / d.lengthSq()));
  return o.clone().addScaledVector(d, t).distanceTo(q);
}
/** A truck-frame point in the world (the truck never pitches). */
function toWorld(car: SkywaysCar, p: V3): V3 {
  const b = car.body!, w = carToWorld(b.x, b.z, b.yaw, p.x, p.z);
  return {x: w.x, y: b.y + p.y, z: w.z};
}
/** Seated: turn the view onto a truck-frame point, then one frame (the controller's prompt follows). */
function look(h: FieldTestHost, car: SkywaysCar, p: V3): void {
  const w = toWorld(car, p);
  lookAt(h, w.x, w.y, w.z);
  frame(h, car);
}
/** Seated: the view `yaw` (rad, relative to the truck: + = to the left) and `pitch`, then one frame. */
function lookRel(h: FieldTestHost, car: SkywaysCar, yaw: number, pitch: number): void {
  h.player.yaw = car.body!.yaw + yaw;
  h.player.pitch = pitch;
  frame(h, car);
}

/**
 * The REAL planning-map runtime on a generated district (the tent's map: its table + the full-screen view), on a game sharing the truck
 * host's state, player and controller: setState runs every state listener (the controller's too) and clears the held keys like
 * Game.setState's input.clear(); enterPlay resumes play. The full-screen view is a recorder (no DOM): `args.onClose(key)` is what
 * PlanningMapView calls when the player closes it (Esc: no key; E / Tab: a fresh press after the opening key was released).
 */
function districtMap(h: FieldTestHost, car: SkywaysCar) {
  const layout = LEVELS.subway.generate('surface', {levelSeed: 7}) as StationLayout;
  const key = surfaceKeyOf({level: 'subway', section: 'main', station: 'st-1'});
  const runState = createRun({seeds: {subway: 1, office: 2, mall: 3, market: 4, bunker: 5, skyways: 6, reactor: 7}, start: key, levels: LEVELS});
  runState.current = key;
  const suppressed: string[] = [];
  const listeners: ((s: string, prev: string) => void)[] = [];
  const game = {
    run: runState, layout, player: h.player, get state() { return h.state; }, zombies: [], containers: null, skywaysCar: car,
    levels: {areaAt: () => -1}, scene: {add() {}},
    sectionHooks: [] as {build?(l: StationLayout): void; teardown?(): void}[], frameHooks: [] as ((dt: number) => void)[], interactHandlers: [] as (() => boolean)[],
    promptProviders: [] as (() => string | null)[], stateListeners: listeners, layoutIndexOf: () => undefined,
    input: {down: (c: string) => h.keys.down(c), suppressUntilRelease: (c: string) => { suppressed.push(c); h.keys.held.delete(c); }},
    setState(s: string) {
      const prev = h.state;
      (h as {state: string}).state = s;
      if (s !== 'playing') h.keys.held.clear(); // (Game.setState: input.clear())
      for (const f of [...(h.stateListeners as unknown as ((s: string, p: string) => void)[]), ...listeners]) f(s, prev);
    },
    enterPlay() { this.setState('playing'); return Promise.resolve(); },
  };
  const view = {
    isOpen: false, opens: 0, closes: 0, model: null as PlanningMap | null, args: null as {heldKeys?: readonly string[]; onClose(key?: string): void} | null,
    open(m: PlanningMap, o: {heldKeys?: readonly string[]; onClose(key?: string): void}) { this.isOpen = true; this.opens++; this.model = m; this.args = o; },
    close() { if (this.isOpen) this.closes++; this.isOpen = false; },
    qa: () => null,
  };
  const rt = new SurfaceMapRuntime(game as never).install();
  rt.view = view as never;
  rt.build(layout);
  return {rt, view, suppressed, layout};
}

/** The field host wired to the real map runtime exactly like installSurfaceTruck (its live model and open()), seated in the truck. */
function seatedWithMap() {
  let rt: SurfaceMapRuntime | null = null;
  const f = fieldHost({map: () => rt?.model() ?? null, open: () => rt?.open() ?? false});
  getInTruck(f.h, f.car);
  const d = districtMap(f.h, f.car);
  rt = d.rt;
  return {...f, ...d};
}

describe('the dash map: on the passenger-side dashboard, inside the cab', () => {
  it('a sheet in a low holder resting on the dash top of the passenger half, inside the cab, facing the seated eye; a cockpit part', () => {
    const {car} = fieldHost();
    const v = car.view as TruckView;
    expect(v.dashMap).not.toBeNull();
    const {group, sheet, holder} = v.dashMap!;
    expect(group.parent).toBe(v.cockpit); // (in the cab: it moves with the truck; the controller keeps cockpit parts out of the shadow pass)
    for (const m of [sheet, holder]) { expect(m.userData.carPart).toBe('cockpit'); expect(m.castShadow).toBe(false); }
    expect(group.position.length() + group.rotation.x + group.rotation.y + group.rotation.z).toBe(0);
    const box = mapBounds(), I = A.interior;
    expect(box.min.x > I.x0 && box.max.x < I.x1 && box.min.y > I.y0 && box.max.y < I.y1 && box.min.z > I.z0 && box.max.z < I.z1).toBe(true);
    // on the passenger half, in front of the passenger seat (its centre over the seat cushion's span), not on the driver's side
    expect(box.min.x).toBeGreaterThan(CAB.cabCx + 0.1);
    const seat = CAB.boxes.find(b => b.name === 'seat-passenger-cushion')!;
    expect(L.centre.x > seat.x0 && L.centre.x < seat.x1).toBe(true);
    // resting on the dash top (no float, not sunk), its front over the dash, the holder's base over the dash's depth
    expect(box.min.y).toBeGreaterThan(dashBox.y1);
    expect(box.min.y - dashBox.y1).toBeLessThan(0.005);
    expect(L.holder.z0).toBeGreaterThanOrEqual(dashBox.z0);
    expect(L.holder.z0).toBeLessThan(dashBox.z1 - 0.1);
    // low: under 0.15 m over the dash top
    expect(box.max.y - dashBox.y1).toBeLessThan(0.15);
    // a 0.30-0.40 m sheet, drawn on the mesh at the layout's pose
    expect(L.size).toBeGreaterThanOrEqual(0.3);
    expect(L.size).toBeLessThanOrEqual(0.4);
    expect(sheet.scale.x * sheet.scale.y).toBeCloseTo(L.size * L.size, 9);
    const n = new THREE.Vector3(0, 0, 1).applyQuaternion(sheet.quaternion), up = new THREE.Vector3(0, 1, 0).applyQuaternion(sheet.quaternion);
    expect(n.distanceTo(v3(L.normal))).toBeLessThan(1e-9);
    expect(sheet.position.distanceTo(v3(L.centre))).toBeLessThan(1e-9);
    // facing the seated eye (from its centre and every corner); the canvas upright to the driver (its top away from the eye) and not mirrored
    for (const [u, w] of [[0, 0], [-0.15, -0.15], [0.15, -0.15], [-0.15, 0.15], [0.15, 0.15]]) {
      const p = sheetPoint(u * L.size / 0.3, w * L.size / 0.3), toEye = v3(A.eye).sub(p).normalize();
      expect(n.dot(toEye), `${u}, ${w}`).toBeGreaterThan(0.5);
    }
    const toEye = v3(A.eye).sub(v3(L.centre));
    expect(up.dot(new THREE.Vector3(toEye.x, 0, toEye.z))).toBeLessThan(0);
    expect(v3(L.right).cross(v3(L.up)).distanceTo(v3(L.normal))).toBeLessThan(1e-9);
  });

  it('clear of the glass, the A-pillar, the cab\'s parts, the FOG PRESSURE readout and the steering wheel; the driver\'s forward view clear', () => {
    const box = mapBounds(), E = v3(A.eye);
    for (const g of A.glass) expect(box.intersectsBox(paneBox(g, 0.01)), g.name).toBe(false);
    const wr = pane('windscreen-right');
    expect(box.min.z).toBeGreaterThan(wr.z1 + 0.01); // (behind the passenger pane's inner face)
    expect(box.max.x).toBeLessThan(wr.x1 - 0.3); // (well inboard of the right A-pillar)
    for (const b of CAB.boxes) expect(box.intersectsBox(cabBox(b)), b.name).toBe(false);
    const readout = buildTruckDash().group;
    readout.updateMatrixWorld(true);
    expect(box.intersectsBox(new THREE.Box3().setFromObject(readout))).toBe(false);
    const W = CAB.wheel, hub = new THREE.Vector3(W.x, W.y, W.z);
    expect(box.distanceToPoint(hub)).toBeGreaterThan(W.r + 0.2);
    // the driver's own windscreen pane: every sight line from the seated eye through it misses the dash map
    const wl = pane('windscreen-left');
    for (let i = 0; i <= 20; i++) for (let j = 0; j <= 20; j++) {
      const p = new THREE.Vector3(wl.x0 + (wl.x1 - wl.x0) * i / 20, wl.y0 + (wl.y1 - wl.y0) * j / 20, (wl.z0 + wl.z1) / 2);
      expect(blocks(E, p, box), `left pane ${i}, ${j}`).toBe(false);
    }
    // the forward view: ±35° of straight ahead, from 30° down to 10° up — nothing of it
    for (let a = -35; a <= 35; a += 2.5) for (let b = -30; b <= 10; b += 2.5) {
      const ya = (a * Math.PI) / 180, pb = (b * Math.PI) / 180, d = new THREE.Vector3(-Math.sin(ya) * Math.cos(pb), Math.sin(pb), -Math.cos(ya) * Math.cos(pb));
      expect(new THREE.Ray(E, d).intersectsBox(box), `forward ${a}, ${b}`).toBe(false);
    }
    // the passenger pane: at most a sliver of its lowest edge, far to the right (the meshes themselves: the holder's wedge, the sheet)
    const g = buildTruckDashMap().group, rc = new THREE.Raycaster();
    g.updateMatrixWorld(true);
    let hidden = 0, all = 0, top = 0, inner = Infinity;
    for (let i = 0; i <= 20; i++) for (let j = 0; j <= 20; j++) {
      const p = new THREE.Vector3(wr.x0 + (wr.x1 - wr.x0) * i / 20, wr.y0 + (wr.y1 - wr.y0) * j / 20, (wr.z0 + wr.z1) / 2);
      all++;
      rc.set(E, p.clone().sub(E).normalize());
      rc.far = p.distanceTo(E);
      if (rc.intersectObject(g, true).length) { hidden++; top = Math.max(top, p.y); inner = Math.min(inner, p.x); }
    }
    expect(hidden / all).toBeLessThan(0.05); // (measured 4.3 %: the holder's raised outer edge over the pane's bottom 8 cm)
    expect(top - wr.y0).toBeLessThan(0.1);
    expect(inner).toBeGreaterThan(wr.x0 + 0.25); // (not by the pane's inner edge, the view ahead-right)
  });
});

describe('the dash map: read from the driver\'s seat', () => {
  it('the crosshair on the sheet reads it within reach; no glass, cab part, the readout or the wheel in between; ahead / the driver\'s side / the binnacle do not', () => {
    const {h, car, sys} = fieldHost();
    getInTruck(h, car);
    const E = v3(A.eye), readout = buildTruckDash().group;
    readout.updateMatrixWorld(true);
    const rb = new THREE.Box3().setFromObject(readout), W = CAB.wheel, hub = new THREE.Vector3(W.x, W.y, W.z), k = L.size / 2 - 0.03;
    for (const [u, v] of [[0, 0], [-k, -k], [k, -k], [-k, k], [k, k]]) {
      const p = sheetPoint(u, v);
      look(h, car, p);
      const hit = sys.dashMap.aimHit();
      expect(hit, `${u}, ${v}`).not.toBeNull();
      expect(hit!.t).toBeLessThanOrEqual(TRUCK_DASH_MAP.reach);
      expect(Math.abs(hit!.t - p.distanceTo(E))).toBeLessThan(0.08);
      expect(sys.dashMap.aimed()).toBe(true);
      expect(car.prompt).toBe(TRUCK_DASH_MAP_TEXT.read);
      for (const g of A.glass) expect(blocks(E, p, paneBox(g)), `${g.name} before ${u}, ${v}`).toBe(false);
      for (const b of CAB.boxes) expect(blocks(E, p, cabBox(b)), `${b.name} before ${u}, ${v}`).toBe(false);
      expect(blocks(E, p, rb)).toBe(false);
      expect(segDist(E, p, hub)).toBeGreaterThan(W.r + 0.05);
    }
    expect(Math.max(...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([a, b]) => sheetPoint(a * L.size / 2, b * L.size / 2).distanceTo(E)))).toBeLessThan(TRUCK_DASH_MAP.reach);
    // not the sheet: the road ahead, the driver's side window, the binnacle, the passenger seat — the controls line
    lookRel(h, car, 0, -0.1);
    expect([sys.dashMap.aimed(), car.prompt]).toEqual([false, TRUCK_TEXT.driving]);
    lookRel(h, car, Math.PI / 2, -0.1);
    expect([sys.dashMap.aimed(), car.prompt]).toEqual([false, TRUCK_TEXT.driving]);
    const bin = CAB.boxes.find(b => b.name === 'binnacle')!;
    look(h, car, {x: (bin.x0 + bin.x1) / 2, y: bin.y1, z: (bin.z0 + bin.z1) / 2});
    expect([sys.dashMap.aimed(), car.prompt]).toEqual([false, TRUCK_TEXT.driving]);
    const seat = CAB.boxes.find(b => b.name === 'seat-passenger-cushion')!;
    look(h, car, {x: (seat.x0 + seat.x1) / 2, y: seat.y1, z: (seat.z0 + seat.z1) / 2});
    expect([sys.dashMap.aimed(), car.prompt]).toEqual([false, TRUCK_TEXT.driving]);
    // and back on it
    look(h, car, L.centre);
    expect(car.prompt).toBe(TRUCK_DASH_MAP_TEXT.read);
  });

  it('[E] aimed opens the planning map and nothing else — never the exit, a repair, a compartment or a later [E] handler; at any speed', () => {
    const {h, car, map, storage, sys} = fieldHost();
    sys.condition.setCondition(0.9); // (a repair is due — E at the nose would start one on foot — while the truck still runs at full)
    const later: string[] = [];
    h.interactHandlers.push(() => { later.push('E'); return false; }); // (cargo, the map table, a pickup… after the controller)
    getInTruck(h, car);
    later.length = 0;
    const toasts = h.toasts.length;
    look(h, car, L.centre);
    press(h, car, 'KeyE');
    expect(map.opens).toBe(1);
    expect(sys.dashMap.counts.opens).toBe(1);
    expect(car.driving).toBe(true);
    expect([car.counts.exits, car.counts.exitRefused, car.counts.forced]).toEqual([0, 0, 0]);
    expect(storage.isOpen).toBe(false);
    expect(sys.repair.counts).toEqual({repairs: 0, refused: 0, holds: 0, cancelled: 0, taps: 0});
    expect(later).toEqual([]);
    expect(h.toasts.length).toBe(toasts);
    // rolling well above the exit speed: still the map (the 'map' state holds the world like a pause), never the slow-down note
    h.keys.held.add('KeyW');
    run(h, car, 2);
    expect(Math.abs(car.body!.v)).toBeGreaterThan(TRUCK_RT.exitSpeed * 2);
    look(h, car, L.centre);
    press(h, car, 'KeyE');
    expect(map.opens).toBe(2);
    expect(car.driving).toBe(true);
    expect([car.counts.exits, car.counts.exitRefused]).toEqual([0, 0]);
    expect(h.toasts.length).toBe(toasts);
    // not aimed while rolling: the get-out rule as before (the slow-down note, still seated)
    lookRel(h, car, 0, -0.1);
    press(h, car, 'KeyE');
    expect(car.driving).toBe(true);
    expect(h.toasts.at(-1)).toBe(TRUCK_TEXT.slowDown);
    expect(map.opens).toBe(2);
    // stopped, not aimed: gets out as before
    stopTruck(h, car);
    lookRel(h, car, 0, -0.1);
    press(h, car, 'KeyE');
    expect(car.driving).toBe(false);
    expect(car.counts.exits).toBe(1);
    expect(map.opens).toBe(2);
    expect(later).toEqual([]); // (every press was the controller's)
    expect(sys.repair.counts.repairs + sys.repair.counts.holds).toBe(0);
  });

  it('on foot it never reads: not through the passenger window, not from beside the cab; [E] there is the doors rule', () => {
    const {h, car, map, sys} = fieldHost();
    const b = car.body!, e = TRUCK_SPEC.exits.right, at = carToWorld(b.x, b.z, b.yaw, e.x, e.z);
    h.player.place(at.x, at.z, 0, b.y);
    frame(h, car);
    const c = toWorld(car, L.centre);
    lookAt(h, c.x, c.y, c.z);
    frame(h, car);
    expect(sys.dashMap.aimed()).toBe(false);
    expect(car.prompt).not.toBe(TRUCK_DASH_MAP_TEXT.read);
    expect(sys.dashMap.open()).toBe(false);
    press(h, car, 'KeyE');
    expect(map.opens).toBe(0);
    expect(car.driving).toBe(true); // (the doors rule: in by the passenger door, the driver's seat)
    // seated now: the same sheet reads
    look(h, car, L.centre);
    expect(car.prompt).toBe(TRUCK_DASH_MAP_TEXT.read);
    // outside play / dead / without the truck: refused
    (h as {state: string}).state = 'paused';
    expect(sys.dashMap.aimed()).toBe(false);
    expect(sys.dashMap.open()).toBe(false);
    (h as {state: string}).state = 'playing';
    stopTruck(h, car);
    teardown(h);
    setTruckLayout(h, null);
    build(h);
    expect(sys.dashMap.anchor()).toBeNull();
    expect(sys.dashMap.open()).toBe(false);
    expect(map.opens).toBe(0);
  });
});

describe('the dash map: the planning map opened from the seat and closed again (the real map runtime)', () => {
  it('the driver stays seated through the map; closing with E is kept from the game and never gets out; the controls come back; nothing else changed', () => {
    const {h, car, sys, storage, rt, view, suppressed} = seatedWithMap();
    h.keys.held.add('KeyW');
    run(h, car, 1.5);
    look(h, car, L.centre);
    expect(car.prompt).toBe(TRUCK_DASH_MAP_TEXT.read);
    expect(Math.abs(car.body!.v)).toBeGreaterThan(TRUCK_RT.exitSpeed);
    const lights = !car.lights;
    car.onLightKey(); // (the lamps on: kept through the map)
    expect(car.lights).toBe(lights);
    const store = JSON.stringify(car.storageJSON), cond = sys.condition.condition;
    // the press: E physically down while the frame reads it
    h.keys.held.add('KeyE');
    press(h, car, 'KeyE');
    expect(h.state).toBe('map');
    expect(view.isOpen).toBe(true);
    expect(view.args!.heldKeys).toEqual(['KeyE']); // (the opening E closes it only after a release)
    expect(mapSignature(view.model!)).toBe(mapSignature(rt.model()!)); // (the tent's planning map)
    expect(car.driving).toBe(true);
    expect([car.counts.exits, car.counts.forced]).toEqual([0, 0]);
    expect(car.enclosed).toBe(true); // (the closed cab: the air rules see the driver inside)
    const held = {v: car.body!.v, x: car.body!.x, z: car.body!.z, yaw: car.body!.yaw};
    // (no frame runs in the 'map' state: the world holds) — the player releases E and presses it again: closed with that key
    view.args!.onClose('KeyE');
    expect(suppressed).toEqual(['KeyE']); // (player/input.ts: kept from the game until released — no interact, no exit)
    expect(h.state).toBe('playing');
    expect(view.isOpen).toBe(false);
    expect(car.driving).toBe(true);
    const b = car.body!;
    expect({v: b.v, x: b.x, z: b.z, yaw: b.yaw}).toEqual(held);
    const seatEye = toWorld(car, A.eye);
    expect(Math.hypot(h.player.x - seatEye.x, h.player.z - seatEye.z)).toBeLessThan(1e-9);
    expect(h.player.eye).toBeCloseTo(seatEye.y, 9);
    expect(car.lights).toBe(lights);
    expect(car.enclosed).toBe(true);
    expect(sys.condition.condition).toBe(cond);
    expect(JSON.stringify(car.storageJSON)).toBe(store);
    expect(storage.isOpen).toBe(false);
    // the closing E held (suppressed: no fresh press reaches the game), then released: frames run, still seated
    h.keys.held.add('KeyE');
    run(h, car, 0.3);
    h.keys.held.delete('KeyE');
    run(h, car, 0.3);
    expect(car.driving).toBe(true);
    expect(car.counts.exits).toBe(0);
    // the driving controls: W drives on, the prompt reads the sheet / the controls line again
    expect(car.prompt).toBe(TRUCK_DASH_MAP_TEXT.read);
    const x0 = car.body!.x;
    h.keys.held.add('KeyW');
    run(h, car, 1);
    h.keys.held.clear();
    expect(car.body!.x).toBeGreaterThan(x0 + 1); // (forward = +X here)
    lookRel(h, car, 0, -0.1);
    expect(car.prompt).toBe(TRUCK_TEXT.driving);
    // again, closed with Esc (no key to keep back): seated, playing
    look(h, car, L.centre);
    press(h, car, 'KeyE');
    expect([h.state, view.opens]).toEqual(['map', 2]);
    view.args!.onClose();
    expect([h.state, car.driving, suppressed.length]).toEqual(['playing', true, 1]);
    // and out the normal way once stopped
    stopTruck(h, car);
    lookRel(h, car, 0, -0.1);
    press(h, car, 'KeyE');
    expect([car.driving, car.counts.exits]).toEqual([false, 1]);
  });
});

describe('the dash map: the tent map\'s content', () => {
  it('draws the map runtime\'s own live model — the table\'s drawing — redrawn seated when it changes, never when nothing changed', () => {
    const {h, car, sys, rt} = seatedWithMap();
    expect(rt.table).not.toBeNull(); // (the tent's table-top copy, drawn at the build)
    expect(sys.dashMap.counts.draws).toBe(0); // (no map yet while getting in)
    frame(h, car);
    expect(sys.dashMap.counts.draws).toBe(1);
    expect(truckDashMapSignature()).toBe(rt.table!.sig); // (the same drawing as the tent's table: same model, same canvas size)
    expect(truckDashMapSignature()).toBe(mapSignature(rt.model()!));
    expect(TRUCK_DASH_MAP.px).toBe(TABLE.px);
    run(h, car, TRUCK_DASH_MAP.redrawS * 2 + 0.1);
    expect(sys.dashMap.counts.draws).toBe(1); // (nothing changed: not redrawn)
    // driving on: the YOU / TRUCK markers move -> redrawn (seated: whatever the distance), then it settles on the live model
    h.keys.held.add('KeyW');
    run(h, car, 2.5);
    stopTruck(h, car);
    run(h, car, TRUCK_DASH_MAP.redrawS + 0.1);
    expect(sys.dashMap.counts.draws).toBeGreaterThanOrEqual(2);
    expect(truckDashMapSignature()).toBe(mapSignature(rt.model()!));
  });

  it('on foot: drawn near the truck only; a rebuild always redraws', () => {
    let calls = 0, rt: SurfaceMapRuntime | null = null;
    const f = fieldHost({map: () => { calls++; return rt?.model() ?? null; }});
    const {h, car, sys} = f;
    rt = districtMap(h, car).rt;
    const b = car.body!, side = carToWorld(b.x, b.z, b.yaw, TRUCK_SPEC.width / 2 + 1.2, A.doorZ);
    h.player.place(side.x, side.z, 0, b.y);
    run(h, car, 0.1);
    expect(sys.dashMap.counts.draws).toBe(1);
    // far off (the hall's farthest corner from the truck): no work
    const a = sys.dashMap.anchor()!;
    const corner = [[1.5, 1.5], [38.5, 1.5], [1.5, 28.5], [38.5, 28.5]].sort((p, q) => Math.hypot(q[0] - a.x, q[1] - a.z) - Math.hypot(p[0] - a.x, p[1] - a.z))[0];
    h.player.place(corner[0], corner[1], 0, 0);
    expect(Math.hypot(h.player.x - a.x, h.player.z - a.z)).toBeGreaterThan(TRUCK_DASH_MAP.nearM);
    const before = calls;
    run(h, car, TRUCK_DASH_MAP.redrawS * 2 + 0.1);
    expect(sys.dashMap.counts.draws).toBe(1);
    expect(calls).toBe(before);
    teardown(h);
    build(h);
    h.player.place(side.x, side.z, 0, b.y);
    run(h, car, 0.1);
    expect(sys.dashMap.counts.draws).toBe(2);
  });
});

describe('the dash map: audits and resources', () => {
  it('classified: not storage (openables none / equipment), a static built-in part of the vehicle; not a prop kind', () => {
    for (const p of TRUCK_FIXED_PARTS) {
      const k = truckAuditKind(p.id);
      const o = VEHICLE_OPEN_AUDIT.filter(r => r.kind === k), ph = VEHICLE_PHYSICS_AUDIT.filter(r => r.kind === k);
      expect(o).toHaveLength(1);
      expect(ph).toHaveLength(1);
      expect([o[0].cls, o[0].role]).toEqual(['none', 'equipment']);
      expect(o[0].how).toMatch(/not storage/);
      expect(o[0].how).toMatch(/passenger-side dashboard/);
      expect([ph[0].cls, ph[0].why, ph[0].src]).toEqual(['static', 'built-in', 'surface']);
      expect(ph[0].how).toMatch(/never detaching/);
      expect(k in PROP_DEFS).toBe(false);
      expect(OPENABLE_AUDIT.some(e => e.kind === k)).toBe(false);
      expect(k in PROP_PHYSICS_AUDIT).toBe(false);
    }
    expect(TRUCK_FIXED_PARTS.map(p => p.id)).toEqual(['dashMap']);
  });

  it('nothing of the map is left outside the cab (the bed\'s side board is gone)', () => {
    const {car} = fieldHost();
    const v = car.view as TruckView;
    const outside: string[] = [];
    v.group.traverse(o => { if (/map-board/.test(o.name)) outside.push(o.name); });
    expect(outside).toEqual([]);
    const maps: string[] = [];
    v.group.traverse(o => { if (/dash-map/.test(o.name) && (o as THREE.Mesh).isMesh) maps.push(o.name); });
    expect(maps.sort()).toEqual(['surface-truck-dash-map-holder', 'surface-truck-dash-map-sheet']);
    for (const name of maps) {
      let p: THREE.Object3D | null = v.group.getObjectByName(name)!;
      while (p && p !== v.cockpit) p = p.parent;
      expect(p, name).toBe(v.cockpit);
    }
  });

  it('its shared material / texture / geometry go with the truck (a world without it) and come back with the next truck world', () => {
    const {h, car} = fieldHost();
    const mat = (car.view as TruckView).dashMap!.sheet.material as THREE.Material;
    const tex = (mat as THREE.MeshStandardMaterial).map!, geo = (car.view as TruckView).dashMap!.holder.geometry;
    let gone = 0;
    mat.addEventListener('dispose', () => { gone++; });
    tex.addEventListener('dispose', () => { gone++; });
    geo.addEventListener('dispose', () => { gone++; });
    teardown(h);
    build(h); // (the truck again: kept)
    expect(gone).toBe(0);
    expect((car.view as TruckView).dashMap!.sheet.material).toBe(mat);
    teardown(h);
    setTruckLayout(h, null);
    build(h); // (a world without it: released)
    expect(gone).toBe(3);
    teardown(h);
    setTruckLayout(h, {x: 8, z: 15, yaw: -Math.PI / 2, level: 0, y: 0});
    build(h);
    expect((car.view as TruckView).dashMap!.sheet.material).not.toBe(mat);
  });
});
