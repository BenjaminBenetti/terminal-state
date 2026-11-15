// Task studio-skywalk-events-20261115-193624-01 (layout version 7, lane GOLF-PLAY): the mini-golf ball and putter through the NORMAL
// persistence paths (user: "Preserve ball/putter IDs, positions and holed state through normal save/unload/cargo paths as applicable;
// retrieval/reset, if offered, moves the SAME ball rather than spawning duplicates"). No golf-specific save code exists: a ball / putter is
// an ordinary loose pickup / stack, so these drive the real run/memory.ts pickupPlan + run/worldMemory.ts capturePickups / restorePickup
// (the section build / leave Game does), the real RunState save export / import, the real Game.dropRef (a shell on Game.prototype), the
// Inventory / Lockbox snapshots and the cargo stack records, over the synthetic lane (tests/helpers/golfPlayCourse.ts, real physics):
//  - a HOLED ball comes back in its cup (the very pose) after unload -> save JSON -> load -> reload, and stays there when it simulates
//    again; a ball left rolling is remembered where it was; the layout never respawns a ball or a taken putter (no duplicate, ever);
//  - take and drop move the SAME stack (uid, count 1): dropped on the course it lies ON the turf (never inside the deck), one ball;
//  - the inventory (the putter in the melee slot), the Lockbox and the train-cargo stack JSON keep item, count and uid.
import {describe, expect, it} from 'vitest';
import * as THREE from 'three';
import {LANE_Z, ON_TURF, TURF, golfLane, golfWorld, puttAndRun} from './helpers/golfPlayCourse';
import {GOLF_BALL_ITEM, GOLF_BALL_R, PUTTER_ITEM} from '../src/gen/skyways/events/golfContract';
import {capturePickups, restorePickup} from '../src/run/worldMemory';
import {pickupPlan, takenLayoutPickups, type SectionMemory} from '../src/run/memory';
import {RunState} from '../src/run/runState';
import type {SectionKey} from '../src/levels/types';
import {Inventory, stackFromJSON, stackToJSON, type ItemStack} from '../src/items/inventory';
import {TrainLockbox} from '../src/run/trainLockbox';
import {levelsOf} from '../src/gen/levels';
import {PropIndex} from '../src/core/physics';
import type {Pickup} from '../src/world/pickups';

const CUP = 6.25;
const KEY = {level: 'skyways', section: 'main', station: 'st-07'} as unknown as SectionKey;
/** The section's generated pickups: a ball on the tee, the putter by the course (layout.pickups). */
const LAYOUT = [{itemId: GOLF_BALL_ITEM, x: 4.5, y: TURF, z: LANE_Z}, {itemId: PUTTER_ITEM, x: 4.5, y: 0, z: LANE_Z + 1.2}];

/** Enter the lane section as Game builds one (pickupPlan: the layout's pickups on a first visit, else exactly the remembered list). */
function enter(mem: SectionMemory, inv: Inventory) {
  const w = golfWorld(golfLane({cupX: CUP}));
  const index = new Map<Pickup, number>();
  const plan = pickupPlan(LAYOUT.length, mem);
  for (const i of plan.fromLayout) { const l = LAYOUT[i]; index.set(w.pm.add(inv.makeStack(l.itemId, 1), l.x, l.y, l.z, 0), i); }
  for (const rec of plan.restored) { const p = restorePickup(w.pm, inv, rec); if (rec.layoutIndex !== undefined) index.set(p, rec.layoutIndex); }
  mem.visits++;
  return {w, index, plan, leave: () => { mem.pickups = capturePickups(w.pm.list, p => index.get(p)); }};
}
const balls = (w: ReturnType<typeof golfWorld>) => w.pm.list.filter(p => p.stack.itemId === GOLF_BALL_ITEM);
const close = (a: readonly number[], b: readonly number[], eps = 1e-9) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= eps);
const run = () => new RunState({seeds: {} as never, start: KEY});

describe('unload / save / reload: the remembered ball, exactly', () => {
  it('a HOLED ball comes back in its cup (its very pose) through unload -> save JSON -> load -> reload; the taken putter never respawns', () => {
    const inv = new Inventory(), r1 = run();
    const s1 = enter(r1.memory(KEY), inv);
    expect(s1.plan.fromLayout).toEqual([0, 1]);
    const [ball] = balls(s1.w);
    puttAndRun(s1.w, ball, 1, 0, 1.75);
    expect(s1.w.inCup(ball)).toBe(true);
    const holed = s1.w.centre(ball).clone();
    expect(holed.y).toBeCloseTo(GOLF_BALL_R, 3);
    // the putter is taken (E: Inventory.add + PickupManager.remove — the same stack object)
    const putter = s1.w.pm.list.find(p => p.stack.itemId === PUTTER_ITEM)!, putterUid = putter.stack.uid;
    expect(inv.add(putter.stack)).toBe(0);
    s1.w.pm.remove(putter);
    expect(inv.meleeSlot[0]?.uid).toBe(putterUid);
    s1.leave();
    const mem1 = r1.memory(KEY);
    expect(mem1.pickups!.map(p => [p.stack.itemId, p.layoutIndex])).toEqual([[GOLF_BALL_ITEM, 0]]);
    expect(takenLayoutPickups(LAYOUT.length, mem1)).toEqual([1]);
    // the save: every section memory as JSON, loaded into a new run
    const saved = JSON.parse(JSON.stringify(r1.exportMemories())) as ReturnType<RunState['exportMemories']>;
    const r2 = run();
    r2.importMemories(saved);
    const s2 = enter(r2.memory(KEY), new Inventory());
    expect(s2.plan.fromLayout).toEqual([]); // the layout never spawns again: no second ball, no second putter
    expect(s2.w.pm.list.length).toBe(1);
    const [back] = balls(s2.w);
    const rec = mem1.pickups![0];
    expect(close(back.obj.position.toArray(), rec.pose.p)).toBe(true);
    expect(close(back.obj.quaternion.toArray(), rec.pose.q)).toBe(true);
    expect(s2.w.centre(back).distanceTo(holed)).toBeLessThan(1e-9);
    expect(s2.w.inCup(back)).toBe(true);
    expect(s2.index.get(back)).toBe(0); // still the layout's ball (its identity in the section)
    expect(back.stack).toMatchObject({itemId: GOLF_BALL_ITEM, count: 1});
    // it simulates again (woken: a knock, a walker) and stays in its cup, on the floor
    expect(s2.w.ph.dynamicItems.wakePickup(back)).toBe(true);
    s2.w.step(3);
    expect(s2.w.inCup(back)).toBe(true);
    expect(s2.w.centre(back).y).toBeCloseTo(GOLF_BALL_R, 3);
    // and a third visit still has exactly that one ball
    s2.leave();
    const s3 = enter(r2.memory(KEY), new Inventory());
    expect(balls(s3.w).length).toBe(1);
    expect(s3.w.inCup(balls(s3.w)[0])).toBe(true);
    expect(r2.memory(KEY).visits).toBe(3); // (the saved visit count came along)
  });

  it('a ball left ROLLING is remembered where it was (no reset to its tee, no copy) and lies there on the turf', () => {
    const inv = new Inventory(), r = run();
    const s1 = enter(r.memory(KEY), inv);
    const [ball] = balls(s1.w);
    expect(s1.w.ph.dynamicItems.putt(ball, 1, 0, 2.5)).toBe(true);
    s1.w.step(0.6);
    const at = s1.w.centre(ball).clone();
    expect(at.x).toBeGreaterThan(5.5); // on its way
    s1.leave();
    const s2 = enter(r.memory(KEY), inv);
    const [back] = balls(s2.w);
    expect(balls(s2.w).length).toBe(1);
    expect(s2.w.centre(back).distanceTo(at)).toBeLessThan(1e-9);
    expect(Math.abs(s2.w.centre(back).y - ON_TURF)).toBeLessThan(2e-3);
    s2.w.step(1);
    expect(s2.w.centre(back).distanceTo(at)).toBe(0); // a remembered ball lies still until something moves it
  });
});

describe('take and drop: the SAME ball moves, never a copy', () => {
  it('taken, it is that stack in the inventory; dropped (Game.dropRef) it is that stack again, lying ON the turf; one ball', async () => {
    const {Game} = await import('../src/game');
    const w = golfWorld(golfLane()), inv = new Inventory();
    const ball = w.ball(5.2, LANE_Z), st = ball.stack, uid = st.uid;
    expect(inv.add(st)).toBe(0); // E
    w.pm.remove(ball);
    expect(w.pm.list.length).toBe(0);
    expect(inv.find(uid)).not.toBeNull();
    const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.05, 200);
    camera.position.set(4.6, TURF + 1.6, LANE_Z);
    camera.lookAt(5.6, TURF, LANE_Z);
    camera.updateMatrixWorld(true);
    const toasts: string[] = [];
    const shell = {
      inv, use: null, hud: {toast: (t: string) => { toasts.push(t); }}, sfx: {denied: () => {}}, syncHeld: () => {}, cancelUse: () => {},
      trainRide: null, trainCargo: null, player: {x: 4.6, y: TURF, z: LANE_Z, yaw: -Math.PI / 2}, camera,
      levels: levelsOf(w.layout), layout: w.layout, propIndex: new PropIndex(levelsOf(w.layout), w.layout.props), pickups: w.pm,
    };
    Object.setPrototypeOf(shell, Game.prototype);
    (shell as unknown as {dropRef(ref: unknown): void}).dropRef(inv.find(uid)!);
    expect(inv.find(uid)).toBeNull();
    expect(toasts).toEqual(['Dropped Golf ball']);
    expect(w.pm.list.length).toBe(1);
    const dropped = w.pm.list[0];
    expect(dropped.stack).toBe(st); // the very stack: same uid, count 1
    expect(dropped.stack).toEqual({uid, itemId: GOLF_BALL_ITEM, count: 1});
    const c = w.centre(dropped);
    expect(c.x).toBeGreaterThan(4.6);
    expect(Math.abs(c.z - LANE_Z)).toBeLessThan(0.25);
    expect(c.y).toBeCloseTo(ON_TURF, 4); // ON the turf top (golfRestY), never inside the 6 cm deck
    // it simulates from there: putt it and it rolls on the turf, still the one ball
    const r = puttAndRun(w, dropped, 1, 0, 1.2);
    expect(r.dist).toBeGreaterThan(0.8);
    expect(r.end.y).toBeCloseTo(ON_TURF, 3);
    expect(w.pm.list.length).toBe(1);
    // taken again: that stack again
    expect(inv.add(dropped.stack)).toBe(0);
    w.pm.remove(dropped);
    expect(inv.allStacks(true).filter(s => s.itemId === GOLF_BALL_ITEM)).toEqual([st]);
  });
});

describe('the stack snapshots: inventory, Lockbox, train cargo', () => {
  it('the putter (melee slot) and a ball (pocket) keep item, count and uid through the inventory JSON; the Lockbox and cargo records too', () => {
    const inv = new Inventory();
    const putter = inv.makeStack(PUTTER_ITEM, 1), ball = inv.makeStack(GOLF_BALL_ITEM, 1);
    expect(inv.add(putter)).toBe(0);
    expect(inv.add(ball)).toBe(0);
    expect(inv.meleeSlot[0]).toBe(putter);
    const back = Inventory.fromJSON(JSON.parse(JSON.stringify(inv.toJSON())));
    expect(back.meleeSlot[0]).toEqual(putter);
    const ids = (i: Inventory) => i.allStacks(true).map(s => [s.itemId, s.count, s.uid]).sort();
    expect(ids(back)).toEqual(ids(inv));
    expect(back.invariants()).toEqual([]);
    expect(back.makeStack(GOLF_BALL_ITEM, 1).uid).toBeGreaterThan(Math.max(putter.uid, ball.uid)); // no uid reused
    // the train's Lockbox
    const box = new TrainLockbox();
    box.slots[0] = ball; box.slots[1] = putter;
    const box2 = new TrainLockbox();
    box2.load(JSON.parse(JSON.stringify(box.toJSON())));
    expect(box2.slots.slice(0, 2)).toEqual([ball, putter]);
    // loose cargo aboard the train records its stacks as stack JSON (world/trainCargo.ts CargoItemJSON.stack)
    for (const s of [ball, putter] as ItemStack[]) expect(stackFromJSON(JSON.parse(JSON.stringify(stackToJSON(s))))).toEqual(s);
  });
});
