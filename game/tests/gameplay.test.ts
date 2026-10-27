import {describe, expect, it} from 'vitest';
import {Inventory, HOTBAR_SIZE, PACK_SIZE} from '../src/items/inventory';
import {WEAPONS, WeaponController, type TriggerInput} from '../src/weapons/weapons';
import {ZombieBrain, type BrainWorld} from '../src/ai/brain';
import {Grid, FLOOR, CELL} from '../src/gen/grid';
import {moveCircle, PropIndex} from '../src/core/physics';
import {rayCapsule, raycastWorld} from '../src/combat/hitscan';
import {generateStation} from '../src/gen/station';

const idle: TriggerInput = {held: false, pressed: false, reload: false, lowered: false};

describe('inventory', () => {
  it('puts weapons in the hotbar, ammo in the pack, merges stacks and respects caps', () => {
    const inv = new Inventory();
    expect(inv.add(inv.makeStack('rifle', 1))).toBe(0);
    expect(inv.add(inv.makeStack('shotgun', 1))).toBe(0);
    expect(inv.hotbar[0]?.itemId).toBe('rifle');
    expect(inv.hotbar[1]?.itemId).toBe('shotgun');
    inv.add(inv.makeStack('ammo_rifle', 100));
    inv.add(inv.makeStack('ammo_rifle', 50));
    expect(inv.count('ammo_rifle')).toBe(150);
    expect(inv.pack.filter(Boolean).length).toBe(2); // 120 + 30
    expect(inv.invariants()).toEqual([]);
  });

  it('moves, swaps and merges between hotbar and backpack', () => {
    const inv = new Inventory();
    inv.add(inv.makeStack('rifle', 1));
    inv.add(inv.makeStack('bandage', 2));
    const bandageRef = inv.find(inv.hotbar[1]!.uid)!;
    inv.move(bandageRef, {bar: 'pack', index: 3});
    expect(inv.pack[3]?.itemId).toBe('bandage');
    inv.add(inv.makeStack('bandage', 2)); // merges into the existing stack
    expect(inv.pack[3]?.count).toBe(4);
    inv.move({bar: 'pack', index: 3}, {bar: 'hotbar', index: 0}); // swap with rifle
    expect(inv.hotbar[0]?.itemId).toBe('bandage');
    expect(inv.pack[3]?.itemId).toBe('rifle');
    expect(inv.invariants()).toEqual([]);
  });

  it('reports leftovers when full and never exceeds slot counts', () => {
    const inv = new Inventory();
    for (let i = 0; i < HOTBAR_SIZE + PACK_SIZE; i++) inv.add(inv.makeStack('medkit', 3));
    expect(inv.add(inv.makeStack('medkit', 2))).toBe(2);
    expect(inv.hasRoomFor('medkit')).toBe(false);
    expect(inv.take('medkit', 4)).toBe(4);
    expect(inv.hasRoomFor('medkit')).toBe(true);
    expect(inv.invariants()).toEqual([]);
  });
});

describe('weapons', () => {
  const setup = (id: string, ammo: number) => {
    const inv = new Inventory();
    inv.add(inv.makeStack(id, 1));
    inv.add(inv.makeStack(WEAPONS[id].ammoItem, ammo));
    const wc = new WeaponController();
    wc.equip(inv.hotbar[0]);
    wc.update(1, idle, inv); // finish equip
    return {inv, wc};
  };

  it('rifle fires automatically at its rate and empties the magazine', () => {
    const {inv, wc} = setup('rifle', 60);
    let shots = 0;
    for (let i = 0; i < 100; i++) shots += wc.update(0.01, {...idle, held: true, pressed: i === 0}, inv).filter(e => e.type === 'fire').length;
    expect(shots).toBe(10); // 1 s at 600 rpm
    for (let i = 0; i < 400; i++) wc.update(0.01, {...idle, held: true}, inv);
    expect(wc.stack!.mag).toBe(0);
  });

  it('magazine reload takes time and draws ammo from inventory', () => {
    const {inv, wc} = setup('rifle', 20);
    wc.stack!.mag = 5;
    wc.update(0.01, {...idle, reload: true}, inv);
    expect(wc.reloading).toBe(true);
    wc.update(1.0, idle, inv);
    expect(wc.stack!.mag).toBe(5);
    wc.update(1.2, idle, inv);
    expect(wc.reloading).toBe(false);
    expect(wc.stack!.mag).toBe(25);
    expect(inv.count('ammo_rifle')).toBe(0);
  });

  it('shotgun is semi-auto, fires 9 pellets worth, reloads shell by shell and can be interrupted', () => {
    const {inv, wc} = setup('shotgun', 3);
    expect(WEAPONS.shotgun.pellets).toBe(9);
    let fires = 0;
    for (let i = 0; i < 300; i++) fires += wc.update(0.01, {...idle, held: true, pressed: i === 0}, inv).filter(e => e.type === 'fire').length;
    expect(fires).toBe(1); // holding the trigger does not refire
    wc.stack!.mag = 0;
    wc.update(0.01, {...idle, reload: true}, inv);
    const shells = [];
    for (let i = 0; i < 400; i++) shells.push(...wc.update(0.01, idle, inv).filter(e => e.type === 'shellIn'));
    expect(shells.length).toBe(3);
    expect(wc.stack!.mag).toBe(3);
    expect(wc.reloading).toBe(false);
  });

  it('dry fire on empty without ammo, auto reload on empty with ammo', () => {
    const {inv, wc} = setup('rifle', 0);
    wc.stack!.mag = 0;
    const ev = wc.update(0.01, {...idle, held: true, pressed: true}, inv);
    expect(ev.map(e => e.type)).toEqual(['dry']);
    inv.add(inv.makeStack('ammo_rifle', 10));
    const ev2 = wc.update(0.5, {...idle, held: true, pressed: true}, inv);
    expect(ev2.map(e => e.type)).toEqual(['dry', 'reloadStart']);
  });

  it('cannot fire while lowered (sprinting) and falloff reduces damage with distance', () => {
    const {inv, wc} = setup('rifle', 0);
    expect(wc.update(0.01, {...idle, held: true, pressed: true, lowered: true}, inv)).toEqual([]);
    expect(WeaponController.falloff(WEAPONS.shotgun, 3)).toBe(1);
    expect(WeaponController.falloff(WEAPONS.shotgun, 30)).toBeCloseTo(0.25);
  });
});

function openWorld(): {grid: Grid; world: BrainWorld & {px: number; pz: number}} {
  const grid = new Grid(40, 40);
  for (let y = 1; y < 39; y++) for (let x = 1; x < 39; x++) grid.cells[grid.idx(x, y)] = FLOOR;
  // wall with a gap
  for (let y = 1; y < 39; y++) if (y < 18 || y > 21) grid.cells[grid.idx(20, y)] = 0;
  let seed = 1;
  const world = {
    px: 15 * CELL, pz: 10 * CELL, playerAlive: true,
    los: (ax: number, az: number, bx: number, bz: number) => grid.lineOfSight(ax, az, bx, bz),
    walkClear: (ax: number, az: number, bx: number, bz: number, r: number) => grid.walkLineClear(ax, az, bx, bz, r),
    findPath: () => null,
    randomNear: (x: number, z: number) => [x + 1, z] as [number, number],
    rand: () => ((seed = (seed * 16807) % 2147483647) / 2147483647),
  };
  return {grid, world};
}

describe('zombie brain', () => {
  it('notices a visible player, chases, attacks in range and lands a hit once per swing', () => {
    const {world} = openWorld();
    const z = new ZombieBrain('shambler', 5 * CELL, 10 * CELL, Math.PI / 2);
    let out = z.update(0.05, world);
    expect(out.alerted).toBe(true);
    expect(z.state).toBe('chase');
    expect(out.speed).toBeGreaterThan(2);
    // move next to the player
    z.x = world.px - 1.0; z.z = world.pz; z.yaw = Math.PI / 2;
    out = z.update(0.05, world);
    expect(z.state).toBe('attack');
    let hits = 0;
    for (let i = 0; i < 30; i++) hits += z.update(0.05, world).attackHit ? 1 : 0;
    expect(hits).toBe(1);
  });

  it('does not see through walls and is alerted by gunfire', () => {
    const {world} = openWorld();
    world.px = 30 * CELL; world.pz = 5 * CELL; // behind the wall
    const z = new ZombieBrain('coated', 10 * CELL, 5 * CELL, Math.PI / 2);
    z.update(0.05, world);
    expect(z.state).not.toBe('chase');
    z.hear(world.px, world.pz, 30);
    expect(z.state).toBe('chase');
  });

  it('takes damage, staggers, dies and stays dead', () => {
    const {world} = openWorld();
    const z = new ZombieBrain('shambler', 5 * CELL, 10 * CELL, 0);
    expect(z.damage(30, world.px, world.pz)).toBe(false);
    expect(z.state).toBe('stagger');
    expect(z.damage(80, world.px, world.pz)).toBe(true);
    expect(z.alive).toBe(false);
    expect(z.update(0.1, world).anim).toBe('Death');
    expect(z.damage(10, 0, 0)).toBe(false);
  });
});

describe('collision and hitscan', () => {
  it('circles cannot pass through walls even when moving fast', () => {
    const {grid} = openWorld();
    let x = 18 * CELL, z = 5 * CELL;
    for (let i = 0; i < 60; i++) [x, z] = moveCircle(grid, null, x, z, 0.4, 0, 0.3);
    expect(x).toBeLessThan(20 * CELL - 0.29);
    // through the gap is fine
    let gx = 18 * CELL, gz = 20 * CELL;
    for (let i = 0; i < 20; i++) [gx, gz] = moveCircle(grid, null, gx, gz, 0.3, 0, 0.3);
    expect(gx).toBeGreaterThan(21 * CELL);
  });

  it('player collides with generated station walls and props', () => {
    const l = generateStation(777);
    const idx = new PropIndex(l.grid, l.props);
    for (const p of l.props.filter(p => p.y === 0).slice(0, 20)) {
      // walk from 2 m away straight into the prop center
      let x = p.x - p.hx - 1.5, z = p.z;
      for (let i = 0; i < 40; i++) [x, z] = moveCircle(l.grid, idx, x, z, 0.1, 0, 0.3);
      expect(x < p.x - p.hx - 0.29 || Math.abs(z - p.z) > p.hz).toBe(true);
    }
  });

  it('ray tests hit capsules and stop at walls', () => {
    const t = rayCapsule({x: 0, y: 1, z: 0}, {x: 0, y: 0, z: -1}, {x: 0, y: 0.5, z: -5}, {x: 0, y: 1.5, z: -5}, 0.25);
    expect(t).toBeCloseTo(4.75, 2);
    const {grid} = openWorld();
    const hit = raycastWorld(grid, [], {x: 5 * CELL, y: 1.5, z: 5 * CELL}, {x: 1, y: 0, z: 0}, 50, -1);
    expect(hit.kind).toBe('wall');
    expect(hit.t).toBeCloseTo(20 * CELL - 5 * CELL, 3);
  });
});
