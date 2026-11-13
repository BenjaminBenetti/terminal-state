// Task studio-refinement-batch-20261113-035659-01 (lane DROPS; user: "Multi-item inventory drops: modest bounded scatter instead of one
// coincident point, using valid floor positions without passing through walls. Preserve normal stacks, rounds, quantities, UIDs and
// ownership."): world/dropScatter.ts through the REAL Game.dropRef (a minimal shell on Game.prototype) and the REAL riding drop
// (TrainCargoSystem.dropRiding) on a generated Subway station with the real parked train, Levels, PropIndex, PickupManager, Inventory:
//  - N successive drops lie on N distinct spots of the bounded pattern round today's drop point (the first one exactly there), each
//    passing today's validity rule (own floor within 0.45 m, in sight, on the tread), within DROP_SCATTER.radius;
//  - a wall right in front (the parked car's side from inside, its shell from the platform, a station wall) is never crossed;
//  - every stack lies as itself (uid, count, the magazine's rounds, a filter's wear); a fuel-can stack lies as single cans, the total exact,
//    the second can where the old 0.26 m row put it; the ownership follows where each lies (inside the parked car: the train's);
//  - riding: the drops scatter on the car floor inside the clamped interior, never through a partition, never on another riding item.
import {afterEach, describe, expect, it} from 'vitest';
import * as THREE from 'three';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {installCanvasShim, ShimContext} from './helpers/canvas2d';
import {LEVELS} from '../src/levels/registry';
import type {StationLayout} from '../src/gen/stationTypes';
import {trainToWorld, worldToTrain} from '../src/gen/playerTrain';
import {PLAYER_TRAIN_SPEC as SPEC} from '../src/world/playerTrainSpec';
import {PickupManager, type Pickup} from '../src/world/pickups';
import {Inventory, stackToJSON, type ItemStack} from '../src/items/inventory';
import {TrainCargoSystem, TRAIN_CARGO} from '../src/world/trainCargo';
import {DROP_SCATTER, groundDropSpots, pickScatter, scatterOffsets} from '../src/world/dropScatter';
import {FUEL} from '../src/fuel/fuel';
import type {PlayerTrainRuntime} from '../src/world/playerTrain';
import {lookAt, run, stationHost, syncCamera} from './helpers/fuelCartsHost';

installCanvasShim(false);
(ShimContext.prototype as unknown as {clip(): void}).clip ??= () => {}; // (item stand-in label atlases clip their cells)

const D = DROP_SCATTER, I = SPEC.interior;
const MID = (I.x0 + I.x1) / 2 - 3;
const cache = new Map<string, StationLayout>();
const SUBWAY = () => { let l = cache.get('s'); if (!l) cache.set('s', (l = LEVELS.subway.generate('main', {levelSeed: 4242}))); return l; };
const live: PlayerTrainRuntime[] = [];
afterEach(() => { for (const rt of live.splice(0)) if (rt.train) { rt.ride = null; rt.teardown(); } });

/** The station with the parked car, the real pickups / inventory / cargo, and Game.dropRef on a minimal shell of Game.prototype. */
async function station() {
  const {Game} = await import('../src/game');
  const s = stationHost(SUBWAY());
  live.push(s.rt);
  const h = s.h as typeof s.h & {inv: Inventory; pickups: PickupManager; syncHeld(): void};
  const inv = new Inventory(), pickups = new PickupManager({}), toasts: string[] = [];
  h.scene.add(pickups.group);
  Object.assign(h, {inv, pickups, syncHeld: () => {}});
  (h as unknown as {gear: Record<string, unknown>}).gear ??= {};
  Object.assign((h as unknown as {gear: Record<string, unknown>}).gear, {bags: [], recorded: () => [], adoptBag: () => null, releaseBag: () => null});
  const cargo = new TrainCargoSystem(h as never).install();
  const shell = {
    inv, use: null, hud: {toast: (t: string) => { toasts.push(t); }}, sfx: {denied: () => {}}, syncHeld: () => {}, cancelUse: () => {},
    get trainRide() { return h.trainRide; }, trainCargo: cargo, player: h.player, camera: h.camera,
    get levels() { return h.levels; }, get layout() { return h.layout; }, get propIndex() { return h.propIndex; }, pickups,
  };
  Object.setPrototypeOf(shell, Game.prototype);
  const drop = (st: ItemStack): Pickup[] => {
    const before = pickups.list.length;
    inv.add(st);
    (shell as unknown as {dropRef(ref: unknown): void}).dropRef(inv.find(st.uid)!);
    expect(inv.find(st.uid), 'out of the inventory').toBeFalsy();
    return pickups.list.slice(before);
  };
  return {...s, h, inv, pickups, cargo, drop, toasts};
}
type St = Awaited<ReturnType<typeof station>>;

function stack(inv: Inventory, id: string, count = 1, extra: Partial<ItemStack> = {}): ItemStack {
  const s = inv.makeStack(id, count);
  s.count = count;
  return Object.assign(s, extra);
}

/** Stand at train-local (lx, lz) (in the car: on its floor; else on the platform, world y 0) looking at a world point. */
function standAt(c: St, lx: number, lz: number, car: boolean, look: THREE.Vector3): void {
  const w = trainToWorld(c.h.trainPlacement!, lx, SPEC.floorY, lz);
  c.h.player.spawn(w.x, w.z, 0, car ? w.y : 0);
  lookAt(c.h, look.x, look.y, look.z);
  syncCamera(c.h);
}
const atL = (c: St, lx: number, lz: number, y: number) => { const w = trainToWorld(c.h.trainPlacement!, lx, 0, lz); return new THREE.Vector3(w.x, y, w.z); };
const flat = (a: {x: number; z: number}, b: {x: number; z: number}) => Math.hypot(a.x - b.x, a.z - b.z);

/** Today's validity rule of a ground drop spot (the pre-scatter Game.dropRef), re-stated: own floor within 0.45 m, in sight, no railing. */
function validSpot(c: St, x: number, z: number): boolean {
  const L = c.h.levels!, g = c.h.layout!.grid, p = c.h.player;
  if (L.count > 1) {
    const s = L.supportIn(x, z, p.y + 0.05);
    return !!s && L.grid(s.level).passable(...g.cellOf(x, z)) && Math.abs(s.floor - p.y) <= 0.45 && L.lineOfSight({x: p.x, y: p.y + 0.6, z: p.z}, {x, y: p.y + 0.6, z}) && !L.railCrosses(p.x, p.z, x, z, 0.05, p.y);
  }
  return g.passable(...g.cellOf(x, z)) && Math.abs(g.floorAt(x, z) - p.y) <= 0.45 && g.lineOfSight(p.x, p.z, x, z);
}

describe('inventory drop scatter: the pattern', () => {
  it('the drop point first, then two rings within the bound, the spots back toward the player first; deterministic', () => {
    for (const yaw of [0, 0.7, -2.1, Math.PI]) {
      const o = scatterOffsets(yaw);
      expect(o[0]).toEqual([0, 0]);
      expect(o.length).toBe(1 + D.rings.reduce((n, r) => n + r[1], 0));
      for (const [x, z] of o) expect(Math.hypot(x, z)).toBeLessThanOrEqual(D.radius + 1e-9);
      expect(new Set(o.map(([x, z]) => `${x.toFixed(4)},${z.toFixed(4)}`)).size).toBe(o.length); // (distinct)
      // the first ring spot: straight back toward the player (forward = (-sin, -cos)), the old fuel-can row's 0.26 m
      expect(o[1][0]).toBeCloseTo(Math.sin(yaw) * 0.26, 9);
      expect(o[1][1]).toBeCloseTo(Math.cos(yaw) * 0.26, 9);
      expect(scatterOffsets(yaw)).toEqual(o);
    }
    // pickScatter: the first free valid spot; all occupied: the valid one farthest from its nearest; none valid: null
    const any = (x: number, z: number) => ({x, y: 0, z});
    expect(pickScatter(0, 0, 0, any, [])).toEqual({x: 0, y: 0, z: 0});
    expect(pickScatter(0, 0, 0, any, [{x: 0, y: 0, z: 0}])).toEqual({x: expect.closeTo(0, 9), y: 0, z: expect.closeTo(0.26, 9)});
    expect(pickScatter(0, 0, 0, any, [{x: 0, y: 2, z: 0}])).toEqual({x: 0, y: 0, z: 0}); // (another storey's pickup does not count)
    expect(pickScatter(0, 0, 0, () => null, [])).toBeNull();
    const crowd = scatterOffsets(0).map(([x, z]) => ({x, y: 0, z}));
    const s = pickScatter(0, 0, 0, any, crowd)!;
    expect(Math.hypot(s.x, s.z)).toBeLessThanOrEqual(D.radius + 1e-9);
  });
});

describe('inventory drop scatter: the REAL Game.dropRef', () => {
  it('N successive drops on the platform: N distinct valid spots within the bound round today\'s point; every stack exactly as it was', async () => {
    const c = await station(), {inv} = c;
    const pl = -(SPEC.width / 2 + 1.8);
    standAt(c, MID, pl, false, atL(c, MID, pl - 3, 0.2)); // (on the platform facing away from the car, looking a little down)
    const p = c.h.player, f = c.h.camera.getWorldDirection(new THREE.Vector3());
    const today = {x: p.x + f.x * D.ahead, z: p.z + f.z * D.ahead};
    expect(validSpot(c, today.x, today.z), 'the test spot is open floor').toBe(true);
    // (loose stacks: a loaded gun, partial ammo stacks, consumables; worn gear — bags, masks, tanks — leaves its own slot, not this way)
    const stacks = [stack(inv, 'pistol', 1, {mag: 7}), stack(inv, 'medkit', 2), stack(inv, 'water', 3), stack(inv, 'ammo_9mm', 37),
      stack(inv, 'ammo_12ga', 9), stack(inv, 'pistol', 1, {mag: 0}), stack(inv, 'medkit', 1)];
    const json = stacks.map(s => stackToJSON(s));
    const got = stacks.map(st => { const out = c.drop(st); expect(out.length).toBe(1); return out[0]; });
    // each stack lies as itself
    got.forEach((pk, k) => { expect(pk.stack).toBe(stacks[k]); expect(stackToJSON(pk.stack)).toEqual(json[k]); });
    expect(c.toasts.at(-1)).toBe('Dropped Med kit');
    // the first exactly at today's point; all distinct, apart, within the bound, each a valid spot on its floor
    expect(flat(got[0].obj.position, today)).toBeLessThan(1e-9);
    for (let a = 0; a < got.length; a++) {
      const q = got[a].obj.position;
      expect(flat(q, today)).toBeLessThanOrEqual(D.radius + 1e-6);
      expect(validSpot(c, q.x, q.z), `spot ${a} valid`).toBe(true);
      for (let b = 0; b < a; b++) expect(flat(q, got[b].obj.position), `spots ${a} / ${b} apart`).toBeGreaterThanOrEqual(D.spacing - 1e-9);
    }
    // the station's (not in the car); no uid twice
    expect(got.every(pk => !c.cargo.ownsPickup(pk))).toBe(true);
    expect(new Set(c.pickups.list.map(pk => pk.stack.uid)).size).toBe(c.pickups.list.length);
  });

  it('a fuel-can stack lies as single cans (the total exact; the second can where the old row put it); a later drop takes a free spot', async () => {
    const c = await station(), {inv} = c;
    const pl = -(SPEC.width / 2 + 1.8);
    standAt(c, MID + 2, pl, false, atL(c, MID + 2, pl - 3, 0.2));
    const f = c.h.camera.getWorldDirection(new THREE.Vector3());
    const cans = stack(inv, FUEL.canItem, 2);
    const out = c.drop(cans);
    expect(out.map(pk => pk.stack.count)).toEqual([1, 1]);
    expect(out[0].stack.uid).toBe(cans.uid);
    expect(out[1].stack.uid).not.toBe(cans.uid);
    expect(out.every(pk => pk.stack.itemId === FUEL.canItem)).toBe(true);
    expect(c.toasts.at(-1)).toBe('Dropped 2 × Fuel');
    // (the old row: 0.26 m back toward the player from the first)
    const fl = Math.hypot(f.x, f.z);
    expect(flat(out[1].obj.position, {x: out[0].obj.position.x - f.x / fl * 0.26, z: out[0].obj.position.z - f.z / fl * 0.26})).toBeLessThan(1e-6);
    // a third drop does not land on either can
    const w = c.drop(stack(inv, 'water', 1))[0];
    for (const pk of out) expect(flat(w.obj.position, pk.obj.position)).toBeGreaterThanOrEqual(D.spacing - 1e-9);
  });

  it('a wall right in front is never crossed: the car\'s side from inside (the train\'s), its shell from the platform, a station wall', async () => {
    const c = await station(), {inv} = c, P = c.h.trainPlacement!;
    // inside the car, 0.45 m from its -Z side wall, facing it: today's point (0.9 m) is beyond the wall — every drop stays inside
    standAt(c, MID - 1.5, -(I.halfWidth - 0.45), true, atL(c, MID - 1.5, -(I.halfWidth + 0.5), 0.6));
    const inCar: Pickup[] = [];
    for (let k = 0; k < 6; k++) inCar.push(...c.drop(stack(inv, 'water', 1)));
    for (const pk of inCar) {
      const l = worldToTrain(P, pk.obj.position.x, pk.obj.position.y, pk.obj.position.z);
      expect(Math.abs(l.z), 'inside the car').toBeLessThan(I.halfWidth);
      expect(c.cargo.ownsPickup(pk), 'the train\'s').toBe(true);
    }
    for (let a = 0; a < inCar.length; a++) for (let b = 0; b < a; b++) expect(flat(inCar[a].obj.position, inCar[b].obj.position)).toBeGreaterThan(0.05);
    // on the platform 0.5 m from the car's outer shell, facing it: every drop stays on the platform side
    standAt(c, MID - 1.5, -(SPEC.width / 2 + 0.5), false, atL(c, MID - 1.5, 0, 0.6));
    for (let k = 0; k < 6; k++) {
      const pk = c.drop(stack(inv, 'medkit', 1))[0], l = worldToTrain(P, pk.obj.position.x, pk.obj.position.y, pk.obj.position.z);
      expect(l.z, 'outside the car').toBeLessThan(-(I.halfWidth + 0.1));
      expect(c.cargo.ownsPickup(pk)).toBe(false);
    }
    // a station wall: walk away from the car along the platform's width until a wall cell, stand 0.45 m before it facing it
    const L = c.h.levels!, g = c.h.layout!.grid;
    let lz = -(SPEC.width / 2 + 1.0);
    while (lz > -40 && g.passable(...g.cellOf(atL(c, MID, lz - 0.1, 0).x, atL(c, MID, lz - 0.1, 0).z))) lz -= 0.1;
    expect(lz).toBeGreaterThan(-40);
    standAt(c, MID, lz + 0.45, false, atL(c, MID, lz - 1, 0.6));
    const p = c.h.player;
    for (let k = 0; k < 6; k++) {
      const pk = c.drop(stack(inv, 'water', 1))[0], q = pk.obj.position;
      expect(g.passable(...g.cellOf(q.x, q.z)), 'on open floor').toBe(true);
      expect(L.lineOfSight({x: p.x, y: p.y + 0.6, z: p.z}, {x: q.x, y: p.y + 0.6, z: q.z}), 'in sight: not through the wall').toBe(true);
    }
  });

  it('groundDropSpots: no valid spot at all -> the player\'s own feet for every drop (today\'s fallback), never an invalid spot', () => {
    const w = {
      levels: {count: 1, supportIn: () => null, grid: () => ({passable: () => true}), lineOfSight: () => true, railCrosses: () => false, stepAt: () => 0},
      grid: {cellOf: (): [number, number] => [0, 0], passable: () => false, floorAt: () => 0, lineOfSight: () => true, stepAt: () => 0.02},
    };
    const spots = groundDropSpots(w, {x: 3, y: 0, z: 4, yaw: 0}, {x: 0, y: 0, z: -1}, 3, []);
    expect(spots).toEqual([{x: 3, y: 0.02, z: 4}, {x: 3, y: 0.02, z: 4}, {x: 3, y: 0.02, z: 4}]);
  });

  it('source pin: Game.dropRef places ground drops through groundDropSpots (the riding drop through TrainCargoSystem.dropRiding)', () => {
    const src = readFileSync(fileURLToPath(new URL('../src/game.ts', import.meta.url)), 'utf8');
    const body = src.slice(src.indexOf('  dropRef(ref: SlotRef'), src.indexOf('this.syncHeld();\n  }', src.indexOf('  dropRef(ref: SlotRef')));
    expect(body).toMatch(/groundDropSpots\(/);
    expect(body).toMatch(/this\.trainCargo\.dropRiding\(st\)/);
    expect(body).not.toMatch(/x \+ bx \* k/); // (the old coincident-point / can-row placement is gone)
  });
});

describe('inventory drop scatter: riding', () => {
  it('riding drops scatter on the car floor inside the clamped interior, apart, never through a partition; every stack as itself', async () => {
    const c = await station(), {inv, cargo, h} = c, ride = h.trainRide!;
    void ride.depart();
    run(h, 80, () => ride.phase === 'transit');
    expect(ride.phase).toBe('transit');
    const T = TRAIN_CARGO;
    const inside = (r: {x: number; z: number}) => r.x >= I.x0 + T.margin - 1e-6 && r.x <= I.x1 - T.margin + 1e-6 && Math.abs(r.z) <= I.halfWidth - T.margin + 1e-6;
    // mid-car: 6 drops (a fuel-can pair among them)
    ride.local.x = MID; ride.local.z = 0; ride.local.yaw = Math.PI / 2; ride.writePlayer();
    const stacks = [stack(inv, 'pistol', 1, {mag: 5}), stack(inv, 'water', 3), stack(inv, FUEL.canItem, 2), stack(inv, 'medkit', 2), stack(inv, 'gas_mask', 1, {filter: 3})];
    const json = stacks.map(s => stackToJSON(s));
    for (const st of stacks) expect(cargo.dropRiding(st)).toBe(true);
    const rs = cargo.riding.slice();
    expect(rs.length).toBe(6);
    const base = rs[0];
    for (let a = 0; a < rs.length; a++) {
      expect(inside(rs[a]), `riding drop ${a} inside`).toBe(true);
      expect(rs[a].y).toBe(SPEC.floorY);
      expect(flat(rs[a], base)).toBeLessThanOrEqual(D.radius + 1e-6);
      for (let b = 0; b < a; b++) expect(flat(rs[a], rs[b]), `riding drops ${a} / ${b} apart`).toBeGreaterThanOrEqual(D.spacing - 1e-9);
    }
    expect(stackToJSON(rs[0].stack)).toEqual(json[0]);
    expect(stackToJSON(rs[1].stack)).toEqual(json[1]);
    expect(rs.filter(r => r.stack.itemId === FUEL.canItem).map(r => r.stack.count)).toEqual([1, 1]);
    expect(stackToJSON(rs[4].stack)).toEqual(json[3]);
    expect(stackToJSON(rs[5].stack)).toEqual(json[4]);
    // at the cab's partition facing it (not its doorway): nothing lies in the cab
    const D0 = SPEC.cab.doorway, zw = D0.z0 > -I.halfWidth + 0.5 ? (D0.z0 - I.halfWidth) / 2 : (D0.z1 + I.halfWidth) / 2;
    ride.local.x = SPEC.cab.x0 - 0.35; ride.local.z = zw; ride.local.yaw = -Math.PI / 2; ride.writePlayer(); // (forward = +X: toward the cab)
    const n0 = cargo.riding.length;
    for (let k = 0; k < 4; k++) expect(cargo.dropRiding(stack(inv, 'water', 1))).toBe(true);
    for (const r of cargo.riding.slice(n0)) {
      expect(r.x, 'on the saloon side of the cab partition').toBeLessThan(SPEC.cab.x0);
      expect(inside(r)).toBe(true);
    }
    // against the side wall: inside the margin
    ride.local.x = MID + 1.5; ride.local.z = I.halfWidth - 0.3; ride.local.yaw = Math.PI; ride.writePlayer(); // (forward = +Z)
    const n1 = cargo.riding.length;
    for (let k = 0; k < 4; k++) expect(cargo.dropRiding(stack(inv, 'medkit', 1))).toBe(true);
    for (const r of cargo.riding.slice(n1)) expect(inside(r)).toBe(true);
    // every uid once
    const uids = cargo.riding.map(r => r.stack.uid);
    expect(new Set(uids).size).toBe(uids.length);
  }, 120000);
});
