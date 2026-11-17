// Task studio-surface-run-field-followup-20261116-211729-01 (lane FIXES): SURFACE RUN's LARGE DOORS (world/surface/airDoors.ts doorAimHit /
// doorSweeps, world/surface/air.ts aimedDoor / sweepBlocked). User: "Large doors must be closable while aiming at the actual door/leaf from
// a clear position, not only at the opening centre where the player blocks closing. Retain real obstruction/safety rules rather than
// deleting those checks." On the synthetic district (helpers/surfaceAirFixture.ts: the REAL gas system + air runtime), B1's street door
// widened to 3 / 4 / 6 m (two leaves of half the width each, swinging in along the jambs), B0's narrowed to a 1.5 m single leaf:
//  - the crosshair on EITHER leaf (at its pose) or the opening within reach, from clear spots inside (beside the back of an open leaf) and
//    outside (the street; a shut door's far leaf end, out of the old 2.1 m-from-the-centre reach) -> the door is the target, [E] works;
//  - a wall between the eye and the leaf: no target;
//  - the closing rule is each leaf's real path: the player / a zombie / a train unit / a movable prop in it -> refused (a zombie stepping
//    in mid-swing re-opens it); clear of it -> shuts; a BB on the wall, an anchored prop: no body in the path;
//  - enemies still push a shut wide door open; a narrow single door works as before;
//  - the gas follows the leaves (open = a breach, shut = the source stops), and the state persists per district memory;
//  - the leaves fill the doorway to its head (the depot's 4.2 m doorway: no gap over the shut leaves).
import {beforeAll, describe, expect, it} from 'vitest';
import * as THREE from 'three';
import {installCanvasShim} from './helpers/canvas2d';
import {fakeEnvTextures} from './helpers/openablesFixture';
import {surfaceAirFixture, surfaceAirGame} from './helpers/surfaceAirFixture';
import {CELL, FLOOR} from '../src/gen/grid';
import type {PropPlacement} from '../src/gen/props';
import type {StationLayout} from '../src/gen/stationTypes';
import type {SurfaceEntrance} from '../src/gen/surface/surfaceTypes';
import {propPhysics} from '../src/damage/materials';
import {WorldMaterials} from '../src/world/materials';
import {DOOR_RT, SURFACE_DOORS_LANE, doorAimHit, doorBoxes, doorSweeps, leafHeight, leafPose, planSurfaceDoors, type SurfaceDoorState} from '../src/world/surface/airDoors';

installCanvasShim(false);
let mats: WorldMaterials;
beforeAll(() => { mats = new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17}); });

type G = ReturnType<typeof surfaceAirGame>;
const HZ = 20 - DOOR_RT.inset; // B1 / B0 south facade z = 20: the leaves' hinge line
const MID = 41; // B1's doorway centre

/** Re-cut entrance `id`'s doorway (facade-ring cells carved FLOOR with the interior's area, GEN's rule) over x0..x1 (m), head `height`. */
function recut(L: StationLayout, id: string, x0: number, x1: number, height = 2.6): void {
  const S = L.surface!, g0 = L.levels[0].grid;
  for (const b of S.buildings) for (const e of b.entrances as SurfaceEntrance[]) {
    if (e.id !== id) continue;
    const row = e.side === 'S' ? Math.round(e.z / CELL) - 1 : Math.round(e.z / CELL);
    for (const i of e.cells) { g0.cells[i] = 0; g0.area[i] = -1; }
    const cells: number[] = [];
    for (let x = Math.round(x0 / CELL); x < Math.round(x1 / CELL); x++) {
      const i = g0.idx(x, row);
      g0.cells[i] = FLOOR; g0.area[i] = e.inner; g0.floor[i] = 0; g0.ceil[i] = height;
      cells.push(i);
    }
    Object.assign(e, {x: (x0 + x1) / 2, width: x1 - x0, height, cells, door: 'closed'});
  }
}

/** The fixture with B1's door `w` m wide (centred on x 41) and B0's a 1.5 m single door (x 14..15.5). */
function world(w: number, o: {props?: PropPlacement[]; store?: Map<string, unknown>} = {}) {
  const L = surfaceAirFixture();
  recut(L, 'b1-e0', MID - w / 2, MID + w / 2);
  recut(L, 'b0-e0', 14, 15.5);
  if (o.props) L.props.push(...o.props);
  const g = surfaceAirGame(L, mats, {store: o.store, at: {x: MID, z: 24}});
  return {g, L, d: door(g, 'b1-e0'), narrow: door(g, 'b0-e0')};
}

const door = (g: G, id: string): SurfaceDoorState => g.air.air!.doors.find(d => d.plan.id === id)!;

/** Stand at (x, z) with the crosshair on point `at` (the camera's YXZ yaw / pitch, as Game.updateCamera); one frame; the target. */
function aim(g: G, x: number, z: number, at: {x: number; y: number; z: number}): SurfaceDoorState | null {
  const dx = at.x - x, dy = at.y - 1.6, dz = at.z - z;
  g.place(x, z, 0, Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz)));
  for (const f of g.h.frameHooks) f(0);
  return g.air.target;
}

/** Open the door (as [E] would) and let it swing fully open, the player standing well clear on the street. */
function openFully(g: G, d: SurfaceDoorState): void {
  g.place(MID, 24, 0, 0);
  if (d.target !== 1) expect(g.air.open(d, 'qa')).toBe(true);
  g.step(DOOR_RT.time + 0.2);
  expect(d.t).toBe(1);
  d.auto = false; // (held open: no self-closing while the test works it)
}

/** A point on a leaf's face at height y, `along` (0..1) from its hinge, at its current pose. */
function onLeaf(d: SurfaceDoorState, k: number, along: number, y = 1.2) {
  const l = d.plan.leaves[k], q = leafPose(d.plan, l, d.t), s = (along - 0.5) * l.width;
  return {x: q.x + q.dx * s, y, z: q.z + q.dz * s};
}

const press = (g: G): boolean => g.h.interactHandlers.some(f => f());

describe('surface doors: a wide door is aimed at its actual leaves (3 / 4 / 6 m)', () => {
  for (const w of [3, 4, 6]) {
    it(`${w} m: two leaves; from clear spots inside (behind either open leaf) and outside the crosshair on a leaf / the opening closes it`, () => {
      const {g, d} = world(w);
      expect(d.plan.leaves.map(l => [l.hinge, l.dir, l.width])).toEqual([[MID - w / 2, 1, w / 2], [MID + w / 2, -1, w / 2]]);
      const spots = [
        // inside, beside the BACK of the left / right open leaf (the wall side: the leaf swings away from it), aiming at its middle
        {name: 'inside behind the left leaf', at: (q: SurfaceDoorState) => ({x: MID - w / 2 - 0.7, z: HZ - w / 4, aim: onLeaf(q, 0, 0.5)})},
        {name: 'inside behind the right leaf', at: (q: SurfaceDoorState) => ({x: MID + w / 2 + 0.7, z: HZ - w / 4, aim: onLeaf(q, 1, 0.5)})},
        // outside on the street in front of the doorway, at either side of it, aiming into the opening / at the left leaf near its hinge
        {name: 'outside left', at: () => ({x: MID - w / 4, z: 21.4, aim: {x: MID - w / 4, y: 1.3, z: HZ}})},
        {name: 'outside right', at: () => ({x: MID + w / 4, z: 21.4, aim: {x: MID + w / 4, y: 1.3, z: HZ}})},
        {name: 'outside at the left jamb, onto the open leaf', at: (q: SurfaceDoorState) => ({x: MID - w / 2 + 0.4, z: 20.9, aim: onLeaf(q, 0, 0.15)})},
      ];
      for (const s of spots) {
        openFully(g, d);
        const p = s.at(d);
        // the spot is clear of both leaves' paths (the player's circle)
        expect(doorSweeps(d.plan, d.t, 0, p.x, p.z, g.h.player.radius), `${s.name}: clear`).toBe(false);
        expect(aim(g, p.x, p.z, p.aim), `${s.name}: the target`).toBe(d);
        expect(g.air.prompt()).toBe('<b>[E]</b> Close the door');
        const closes = g.air.counts.closes;
        expect(press(g), s.name).toBe(true);
        expect([d.target, g.air.counts.closes], s.name).toEqual([0, closes + 1]);
        g.step(DOOR_RT.time + 0.2);
        expect([d.t, d.gas], `${s.name}: shut, the gas source stopped`).toEqual([0, false]);
      }
      expect(g.air.counts.refusals).toBe(0);
      expect(g.h.hud.toast).not.toHaveBeenCalledWith('Something is in the doorway');
      g.teardown();
    });
  }

  it("a leaf aim is a leaf hit (pure): behind an open leaf the ray meets it and not the opening; the old 2.1 m-from-the-centre reach could not", () => {
    const {g, d} = world(6);
    openFully(g, d);
    const eye = {x: MID - 3 - 0.7, y: 1.6, z: HZ - 1.5};
    const dir = new THREE.Vector3(1, -0.25, 0).normalize();
    const t = doorAimHit(d.plan, d.t, eye, dir, DOOR_RT.reach)!;
    expect(t).toBeGreaterThan(0.5);
    expect(t).toBeLessThan(0.75);
    expect(eye.x + dir.x * t).toBeCloseTo(MID - 3 - DOOR_RT.thick / 2 - DOOR_RT.aimPad, 3); // the back of the left leaf's slab
    expect(Math.hypot(d.plan.x - eye.x, d.plan.z - eye.z)).toBeGreaterThan(2.1); // (out of the old centre reach)
    // out of reach along the ray: nothing
    expect(doorAimHit(d.plan, d.t, {x: MID - 3 - 2.6, y: 1.6, z: HZ - 1.5}, new THREE.Vector3(1, 0, 0), DOOR_RT.reach)).toBe(null);
    // looking away: nothing
    expect(doorAimHit(d.plan, d.t, eye, new THREE.Vector3(-1, 0, 0), DOOR_RT.reach)).toBe(null);
    g.teardown();
  });

  it('a SHUT wide door opens from the street aimed at its far leaf end (beyond the old reach of its centre)', () => {
    const {g, d} = world(6);
    expect([d.t, d.target]).toEqual([0, 0]);
    const x = MID - 3 + 0.3, z = 21.3;
    expect(Math.hypot(d.plan.x - x, d.plan.z - z)).toBeGreaterThan(2.1);
    expect(aim(g, x, z, {x, y: 1.1, z: HZ})).toBe(d);
    expect(g.air.prompt()).toBe('<b>[E]</b> Open the door');
    expect(press(g)).toBe(true);
    g.step(DOOR_RT.time + 0.1);
    expect([d.t, d.gas]).toEqual([1, true]);
    g.teardown();
  });

  it('nothing structural in between: the facade wall between the eye and an open leaf -> no target', () => {
    const {g, d} = world(4);
    openFully(g, d);
    // on the street beside the doorway, the crosshair through the facade ring onto the back of the left open leaf
    const leaf = onLeaf(d, 0, 0.45);
    const at = {x: leaf.x - 0.1, y: 1.2, z: leaf.z};
    expect(doorAimHit(d.plan, d.t, {x: MID - 2 - 1.2, y: 1.6, z: 20.7}, new THREE.Vector3(at.x - (MID - 3.2), -0.4, at.z - 20.7).normalize(), DOOR_RT.reach)).not.toBe(null);
    expect(aim(g, MID - 2 - 1.2, 20.7, at)).toBe(null);
    // the same leaf from inside, no wall: the target
    expect(aim(g, MID - 2 - 0.7, HZ - 1, onLeaf(d, 0, 0.5))).toBe(d);
    g.teardown();
  });
});

describe('surface doors: the closing rule is each leaf\'s real path (never shuts on a body)', () => {
  it('the player in a leaf\'s path: refused with the toast, the door stays open; clear of it: shuts', () => {
    const {g, d} = world(6);
    openFully(g, d);
    // inside the left leaf's quarter (between the open leaf and the doorway's middle), aiming at the leaf's inner face
    const x = MID - 3 + 1.2, z = HZ - 1.2;
    expect(doorSweeps(d.plan, 1, 0, x, z, 0.3)).toBe(true);
    expect(aim(g, x, z, onLeaf(d, 0, 0.4))).toBe(d);
    expect(press(g)).toBe(true);
    expect(g.h.hud.toast).toHaveBeenCalledWith('Something is in the doorway');
    expect([d.target, g.air.counts.refusals]).toEqual([1, 1]);
    // in the threshold (the shut leaves' line): refused too
    g.place(MID - 1, 19.9, 0, 0);
    expect(g.air.close(d)).toBe(false);
    // the player walks into the path while it swings shut: it swings open again
    g.place(MID, 23, 0, 0);
    expect(g.air.close(d)).toBe(true);
    g.step(0.15);
    expect(d.t).toBeGreaterThan(0.3);
    g.place(MID - 3 + 1.0, HZ - 0.6, 0, 0);
    g.step(0.1);
    expect(d.target).toBe(1);
    expect(g.air.counts.reopens).toBeGreaterThanOrEqual(1);
    g.teardown();
  });

  it('a zombie in the path refuses (and re-opens mid-swing); a BB on the wall and a dead / ragdolled one do not', () => {
    const {g, d} = world(6);
    openFully(g, d);
    const clear = {x: MID - 3 - 0.7, z: HZ - 1.5};
    g.place(clear.x, clear.z, 0, -Math.PI / 2);
    const z = {brain: {x: MID - 1, z: HZ - 1.1, y: 0, alive: true, stats: {radius: 0.35}}} as {brain: {x: number; z: number; y: number; alive: boolean; climbing?: boolean; stats: {radius: number}}; ragdolled?: boolean; placesRoot?: boolean};
    g.h.zombies.push(z);
    expect(g.air.close(d)).toBe(false);
    // a BB on the wall / ceiling above that spot: no body in a doorway (its y is the floor below it)
    Object.assign(z, {placesRoot: true});
    z.brain.climbing = true;
    expect(g.air.close(d)).toBe(true);
    // (on its feet again, it walks into the path while the door swings): the door re-opens
    z.brain.climbing = false;
    g.step(0.1);
    expect(d.target).toBe(1);
    g.step(DOOR_RT.time);
    z.ragdolled = true;
    expect(g.air.close(d)).toBe(true);
    g.step(DOOR_RT.time + 0.1);
    expect(d.t).toBe(0);
    // a zombie well inside, between the two leaves' arcs (a 6 m door's 3 m leaves clear it): not in the path
    g.h.zombies.length = 0;
    openFully(g, d);
    g.h.zombies.push({brain: {x: MID, z: HZ - 3.6, y: 0, alive: true, stats: {radius: 0.35}}});
    g.place(clear.x, clear.z, 0, -Math.PI / 2);
    expect(g.air.close(d)).toBe(true);
    g.teardown();
  });

  it('a train unit / fuel cart standing in the path holds the door (the lift doors\' rule); out of it, it does not', () => {
    const {g, d} = world(4);
    openFully(g, d);
    const unit = {x: MID - 1, y: 0, z: HZ - 0.8, r: 0.45};
    (g.h as unknown as {trainEquipment: unknown}).trainEquipment = {anyAt: (t: (x: number, y: number, z: number, r: number) => boolean) => t(unit.x, unit.y, unit.z, unit.r)};
    g.place(MID, 23, 0, 0);
    expect(g.air.close(d)).toBe(false);
    unit.z = HZ - 3.5; // (well inside, past the leaves' 2 m arcs)
    expect(g.air.close(d)).toBe(true);
    g.step(DOOR_RT.time + 0.1);
    expect(d.t).toBe(0);
    // a fuel cart likewise
    openFully(g, d);
    (g.h as unknown as {fuelCarts: unknown}).fuelCarts = {anyAt: (t: (x: number, y: number, z: number, r: number) => boolean) => t(MID + 1, 0, HZ - 0.5, 0.5)};
    g.place(MID, 23, 0, 0);
    expect(g.air.close(d)).toBe(false);
    g.teardown();
  });

  it('a movable (dynamic-class) prop in the path holds it — at its current spot once shoved; an anchored prop is the building\'s own', () => {
    const kind = 'bin';
    expect(propPhysics(kind).dynamic).toBe(true);
    expect(propPhysics('column').dynamic).toBe(false);
    const bin = {kind, x: MID - 1.2, z: HZ - 0.9, y: 0, rot: 0, area: 0, hx: 0.28, hz: 0.28, h: 0.95, blocksSight: false, variant: 0, level: 0} as unknown as PropPlacement;
    const post = {...bin, kind: 'column', x: MID + 1.2} as unknown as PropPlacement;
    const {g, d} = world(4, {props: [bin, post]});
    openFully(g, d);
    g.place(MID, 23, 0, 0);
    expect(g.air.close(d)).toBe(false); // the bin
    // shoved out of the way (a loose prop's placement follows its body: x / z)
    bin.x = MID - 3.6; bin.z = HZ - 2.6; bin.h = 0;
    expect(g.air.close(d)).toBe(true); // (the anchored post in the other leaf's sweep does not block)
    g.step(DOOR_RT.time + 0.1);
    expect(d.t).toBe(0);
    // gone (melted / carried off): never a body
    openFully(g, d);
    bin.x = MID - 1.2; bin.z = HZ - 0.9; bin.cargoGone = true;
    g.place(MID, 23, 0, 0);
    expect(g.air.close(d)).toBe(true);
    g.teardown();
  });

  it('the sweep geometry (pure): the target pose is in the path; behind the starting pose is not; the tip arc and the street side padded', () => {
    const {g, d} = world(4);
    const p = d.plan, l = p.leaves[0], R = 0.3;
    // shut line (threshold): a body straddling it is in the shutting path, one 0.3 m out on the street is not
    expect(doorSweeps(p, 1, 0, MID - 1, 20, R)).toBe(true);
    expect(doorSweeps(p, 1, 0, MID - 1, 20 + 0.3 + 0.01, R)).toBe(false);
    // the quarter: in; past the tip arc: out
    expect(doorSweeps(p, 1, 0, l.hinge + 1.2, HZ - 1.2, R)).toBe(true);
    expect(doorSweeps(p, 1, 0, l.hinge + 1.75, HZ - 1.75, R)).toBe(false);
    // behind the open leaf (the wall side): out of its path when it shuts (it swings away from there)
    expect(doorSweeps(p, 1, 0, l.hinge - 0.32, HZ - 1, R)).toBe(false);
    // half-way shut: only what lies between the leaf now and the shut line
    expect(doorSweeps(p, 0.5, 0, l.hinge + 0.3, HZ - 1.6, R)).toBe(false); // (swept already, vacated)
    expect(doorSweeps(p, 0.5, 0, l.hinge + 1.5, HZ - 0.4, R)).toBe(true);
    g.teardown();
  });
});

describe('surface doors: what stays as it was', () => {
  it('enemies still push a shut wide door open from the street; the auto-close still waits for a clear path', () => {
    const {g, d} = world(6);
    const p = {brain: {x: MID - 1.5, z: 20 + 0.05 + 0.35 + 0.05, y: 0, alive: true, stats: {radius: 0.35}}};
    g.h.zombies.push(p);
    g.step(DOOR_RT.pushOpen - 0.3);
    expect(d.target).toBe(0);
    g.step(0.5);
    expect([d.target, g.air.counts.pushOpens]).toEqual([1, 1]);
    g.h.zombies.length = 0;
    g.step(DOOR_RT.time);
    expect(d.auto).toBe(true);
    // a body in the path holds the self-closing door open; once it leaves, it shuts by itself
    g.place(MID - 2, HZ - 1, 0, 0);
    g.step(DOOR_RT.autoClose + 1);
    expect(d.target).toBe(1);
    g.place(MID, 24, 0, 0);
    g.step(DOOR_RT.autoClose + DOOR_RT.time + 0.5);
    expect([d.t, g.air.counts.autoCloses]).toEqual([0, 1]);
    g.teardown();
  });

  it('a narrow single door (1.5 m): aimed from the front it opens / shuts; in its threshold or its leaf\'s path: refused', () => {
    const {g, narrow: n} = world(3);
    expect(n.plan.leaves.length).toBe(1);
    const l = n.plan.leaves[0];
    expect(aim(g, 14.75, 21.2, {x: 14.75, y: 1.2, z: HZ})).toBe(n);
    expect(press(g)).toBe(true);
    g.step(DOOR_RT.time + 0.1);
    expect(n.t).toBe(1);
    n.auto = false;
    // in the threshold: refused; inside its leaf's quarter: refused
    g.place(14.75, 19.95, 0, 0);
    expect(g.air.close(n)).toBe(false);
    g.place(l.hinge + l.dir * 0.8, HZ - 0.7, 0, 0);
    expect(g.air.close(n)).toBe(false);
    // from the street, clear: aimed through the opening, [E] shuts it
    expect(aim(g, 14.75, 21.3, {x: 14.75, y: 1.2, z: HZ})).toBe(n);
    expect(g.air.prompt()).toBe('<b>[E]</b> Close the door');
    expect(press(g)).toBe(true);
    g.step(DOOR_RT.time + 0.1);
    expect([n.t, n.gas]).toEqual([0, false]);
    g.teardown();
  });

  it('the gas follows the leaves and the state persists per district memory (an aimed close / open)', () => {
    const store = new Map<string, unknown>();
    const {g, d} = world(6, {store});
    // opened from the street at a leaf end
    expect(aim(g, MID + 3 - 0.3, 21.3, {x: MID + 3 - 0.3, y: 1.1, z: HZ})).toBe(d);
    press(g);
    g.step(DOOR_RT.time + 0.1);
    expect([d.t, d.gas]).toEqual([1, true]);
    d.auto = false;
    g.step(3);
    g.teardown();
    const rec = store.get(SURFACE_DOORS_LANE) as {v: number; doors: Record<string, {open: number; age?: number}>};
    expect(rec.doors['b1-e0'].open).toBe(1);
    // revisit: open, its gas running; shut from behind the right leaf (clear): stored shut
    const L2 = surfaceAirFixture();
    recut(L2, 'b1-e0', MID - 3, MID + 3);
    recut(L2, 'b0-e0', 14, 15.5);
    const g2 = surfaceAirGame(L2, mats, {store, at: {x: MID, z: 24}});
    const d2 = door(g2, 'b1-e0');
    expect([d2.t, d2.target, d2.gas]).toEqual([1, 1, true]);
    expect(aim(g2, MID + 3 + 0.7, HZ - 1.5, onLeaf(d2, 1, 0.5))).toBe(d2);
    press(g2);
    g2.step(DOOR_RT.time + 0.1);
    expect([d2.t, d2.gas]).toEqual([0, false]);
    g2.teardown();
    expect((store.get(SURFACE_DOORS_LANE) as typeof rec).doors['b1-e0']).toEqual({open: 0});
  });

  it('the leaves fill the doorway to its head: a 4.2 m depot doorway\'s shut leaves (view, box, aim) reach 4.17 m; the flap keeps its own', () => {
    const L = surfaceAirFixture();
    recut(L, 'b1-e0', MID - 3, MID + 3, 4.2);
    const plans = planSurfaceDoors(L.surface!, L.levels[0].grid, L.levels);
    const p = plans.find(q => q.id === 'b1-e0')!, tent = plans.find(q => q.tent)!;
    expect(p.height).toBe(4.2);
    expect(leafHeight(p)).toBeCloseTo(4.2 - DOOR_RT.headGap, 9);
    expect(doorBoxes(p)[0].h).toBeCloseTo(4.17, 9);
    expect(leafHeight(tent)).toBeCloseTo(DOOR_RT.flapHeight - DOOR_RT.headGap, 9);
    // the drawn leaf is that tall
    const g = surfaceAirGame(L, mats, {at: {x: MID, z: 24}});
    const view = g.air.air!.doorView!, i = g.air.air!.doors.findIndex(q => q.plan.id === 'b1-e0');
    const slab = view.leaves[g.air.air!.viewIndex[i]][0].children[0] as THREE.Mesh;
    expect((slab.geometry as THREE.BoxGeometry).parameters.height).toBeCloseTo(4.17, 9);
    g.teardown();
  });
});
