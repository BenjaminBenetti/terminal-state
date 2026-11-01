// Iteration 16 (lane RUN): logical levels, run carryover, section memory, Retry-level snapshots and travel gating.
// Pure modules + the real Inventory / Survival / battery / PickupManager / ContainerManager (no renderer, no DOM).

import * as THREE from 'three';
import {describe, expect, it} from 'vitest';
import {installCanvasShim} from './helpers/canvas2d';
import {levelFixture} from './helpers/levelFixture';
import {TEXTURE_FILES, type TextureKey} from '../src/assets/manifest';
import {generateStation} from '../src/gen/station';
import {rollLevelGear} from '../src/gen/gearLoot';
import {Inventory} from '../src/items/inventory';
import {WEAPONS} from '../src/weapons/weapons';
import {Survival} from '../src/player/survival';
import {FlashlightBattery} from '../src/player/flashlight';
import {Player} from '../src/player/player';
import {LEVELS, arrivalPose, otherLevel, storeyLabel} from '../src/levels/registry';
import {sectionId, type LevelId, type TravelRequest} from '../src/levels/types';
import {createRun, RunState} from '../src/run/runState';
import {createMemory, enemiesToSpawn, mergeKilled, pickupPlan, takenLayoutPickups, type SectionMemory} from '../src/run/memory';
import {cloneInventory, resetParticipants, restoreCarry, restoreParticipants, takeSnapshot, type RunParticipant} from '../src/run/snapshot';
import {starterInventory} from '../src/run/starter';
import {applyHolders, captureHolders, capturePickups, restorePickup} from '../src/run/worldMemory';
import {BAG_LANE, parseSectionId, runBagStore} from '../src/run/bagStore';
import {SingleFlight, travelRefusal, type TravelGateState} from '../src/run/travelGate';
import {WorldMaterials} from '../src/world/materials';
import {ContainerManager} from '../src/world/containers';
import {PickupManager, type Pickup} from '../src/world/pickups';

installCanvasShim(false);

const SEEDS = {subway: 0x1234abcd, office: 0x0badf00d, mall: 0x3a11c0de, reactor: 0x5eac7012}; // (+ mall: task track3-eaton-centre-20261031, lane GEN)

function fakeEnvTextures(): Record<TextureKey, THREE.Texture> {
  const out = {} as Record<TextureKey, THREE.Texture>;
  for (const k of Object.keys(TEXTURE_FILES) as TextureKey[]) out[k] = new THREE.Texture({width: 64, height: 64} as unknown as HTMLImageElement);
  return out;
}

// task office-overhaul-20261030 (INTERACT #6): + the grenade slot (the starter flare goes there now)
const invItems = (inv: Inventory) => inv.hotbar.concat(inv.pack, inv.throwSlot ?? []).filter(Boolean).map(s => `${s!.itemId}x${s!.count}${s!.mag !== undefined ? `@${s!.mag}` : ''}`).sort();
const countOf = (inv: Inventory, id: string) => inv.count(id);

describe('levels registry', () => {
  it('subway generate is generateStation unchanged (identical output for sample seeds; no gear = no change)', () => {
    for (const seed of [20261029, 0x5eed]) {
      const a = LEVELS.subway.generate('main', {levelSeed: seed, startWeapon: 'pistol'});
      const b = generateStation(seed, {startWeapon: 'pistol'});
      expect(a.name).toBe(b.name);
      expect(a.pickups).toEqual(b.pickups);
      expect(a.zombies).toEqual(b.zombies);
      expect(a.props.length).toBe(b.props.length);
      expect(a).toEqual(b);
      const c = LEVELS.subway.generate('main', {levelSeed: seed, startWeapon: 'pistol', gear: []});
      expect(c.pickups).toEqual(b.pickups);
    }
  });

  it('subway gear is appended after generation (the generated layout is otherwise untouched)', () => {
    const seed = 777;
    const base = generateStation(seed, {startWeapon: 'pistol'});
    const geared = LEVELS.subway.generate('main', {levelSeed: seed, startWeapon: 'pistol', gear: [{itemId: 'helmet'}, {itemId: 'boots'}]});
    expect(geared.pickups.slice(0, base.pickups.length)).toEqual(base.pickups);
    const extra = geared.pickups.slice(base.pickups.length).map(p => p.itemId).sort();
    expect(extra).toEqual(['boots', 'helmet']);
    expect(geared.zombies).toEqual(base.zombies);
    expect(geared.props).toEqual(base.props);
  });

  it('describes both logical levels: each is ONE continuous world (section main)', () => {
    expect(LEVELS.subway.sections(1)).toEqual(['main']);
    expect(LEVELS.subway.entry).toBe('main');
    expect(LEVELS.office.entry).toBe('main');
    expect(LEVELS.office.sections(1)).toEqual(['main']);
    expect(otherLevel('subway')).toBe('office');
    expect(otherLevel('office')).toBe('subway');
    expect(() => LEVELS.subway.generate('floor-2', {levelSeed: 1})).toThrow();
    expect(() => LEVELS.office.generate('floor-5', {levelSeed: 1})).toThrow(); // iteration 17: no per-floor sections
    expect(() => LEVELS.office.generate('street', {levelSeed: 1})).toThrow();
  });

  it('Office Space comes from GEN through the registry: one world (station + lobby + floors 2-8), deterministic, gear appended once', () => {
    const levelSeed = 0x0ff1ce;
    const office = LEVELS.office.generate('main', {levelSeed, startWeapon: 'pistol'});
    expect(office.office?.storeys.map(s => s.floor)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(office.levels.length).toBe(10); // task office-overhaul-20261030 (lane STRUCT): + the roof (level 9)
    expect(storeyLabel(office, 1)).toBe('L');
    expect(storeyLabel(office, 5)).toBe('5');
    expect(storeyLabel(office, 0)).toBe('');
    expect(arrivalPose(office, {kind: 'start'})).toMatchObject({source: 'start', level: 0});
    const again = LEVELS.office.generate('main', {levelSeed, startWeapon: 'pistol'});
    expect(again.pickups).toEqual(office.pickups);
    expect(again.zombies).toEqual(office.zombies);
    const geared = LEVELS.office.generate('main', {levelSeed, startWeapon: 'pistol', gear: [{itemId: 'gloves'}]});
    expect(geared.pickups.slice(0, office.pickups.length)).toEqual(office.pickups);
    expect(geared.pickups.slice(office.pickups.length).map(p => p.itemId)).toEqual(['gloves']);
  });

  it('the start pose is layout.office.start, else playerSpawn', () => {
    const l = generateStation(99, {startWeapon: 'pistol'});
    const sp = l.playerSpawn;
    expect(arrivalPose(l, {kind: 'start'})).toMatchObject({x: sp.x, z: sp.z, yaw: sp.yaw, source: 'playerSpawn'});
    expect(arrivalPose(l, {kind: 'return'})).toMatchObject({x: sp.x, z: sp.z, source: 'playerSpawn'});
    const office = Object.assign(l, {office: {start: {x: 1, z: 2, yaw: 0.5, level: 0}}}) as unknown as typeof l;
    expect(arrivalPose(office, {kind: 'start'})).toMatchObject({x: 1, z: 2, yaw: 0.5, level: 0, source: 'start'});
    expect(arrivalPose(office, {kind: 'return'})).toMatchObject({x: 1, z: 2, source: 'start'});
  });
});

describe('run state: NewGame vs travel', () => {
  const newRun = (seeds = SEEDS, level: LevelId = 'subway') => createRun({seeds, start: {level, section: LEVELS[level].entry}, levels: LEVELS, rollGear: rollLevelGear});

  it('a run holds one seed per logical level and ONE level-wide gear roll per level (all in its one section)', () => {
    const r = newRun();
    expect(r.seeds).toEqual(SEEDS);
    expect(Object.keys(r.gear.subway!)).toEqual(['main']);
    expect(Object.keys(r.gear.office!)).toEqual(['main']);
    const again = newRun();
    expect(again.gear).toEqual(r.gear); // deterministic for the seeds
    expect(again.id).toBeGreaterThan(r.id);
    expect(r.gearFor({level: 'office', section: 'main'})).toEqual(r.gear.office!.main);
  });

  it('travel keeps every section memory; a NewGame run starts with none', () => {
    const r = newRun();
    const main = r.memory({level: 'subway', section: 'main'});
    main.killed = [0, 2];
    main.pickups = [];
    r.setLaneStore('gear.bags', {bags: [{id: 1}]});
    // travel: subway -> office -> back
    r.current = {level: 'office', section: 'main'};
    r.memory().visits++;
    expect(r.sectionId).toBe('office:main');
    r.current = {level: 'subway', section: 'main'};
    expect(r.memory().killed).toEqual([0, 2]);
    expect(r.laneStore('gear.bags')).toEqual({bags: [{id: 1}]});
    expect(r.memoryIds()).toEqual(['office:main', 'subway:main']);
    const fresh = newRun({subway: 1, office: 2, mall: 3, reactor: 4});
    expect(fresh.memoryIds()).toEqual([]);
    expect(fresh.peekMemory({level: 'subway', section: 'main'})).toBeUndefined();
    expect(fresh.entry).toBeNull();
  });

  it('level memories are deep copies; restoring one level never touches the other', () => {
    const r = newRun();
    const O = {level: 'office', section: 'main'} as const;
    r.memory(O).killed = [1];
    r.memory(O).pickups = [];
    r.memory({level: 'subway', section: 'main'}).killed = [4];
    const entry = r.levelMemories('office'); // taken when the level is entered
    expect(Object.keys(entry)).toEqual(['office:main']);
    const probe = r.levelMemories('office');
    probe['office:main'].killed.push(9);
    expect(r.memory(O).killed).toEqual([1]);
    // later in the level: more kills, the level cleared
    r.memory(O).killed = [1, 2, 3];
    r.memory(O).cleared = true;
    r.restoreLevelMemories('office', entry); // Retry level
    expect(r.memory(O).killed).toEqual([1]);
    expect(r.memory(O).pickups).toEqual([]);
    expect(r.memory(O).cleared).toBe(false);
    expect(r.memory({level: 'subway', section: 'main'}).killed).toEqual([4]);
    // the snapshot itself is never handed out: restoring again gives the same state
    r.memory(O).killed.push(5);
    r.restoreLevelMemories('office', entry);
    expect(r.memory(O).killed).toEqual([1]);
  });

  it('a level counts as clear when its one world was cleared', () => {
    const r = newRun();
    expect(r.levelCleared('subway', ['main'])).toBe(false);
    r.memory({level: 'subway', section: 'main'}).cleared = true;
    expect(r.levelCleared('subway', ['main'])).toBe(true);
    expect(r.levelCleared('office', LEVELS.office.sections(1))).toBe(false);
    r.memory({level: 'office', section: 'main'}).cleared = true;
    expect(r.levelCleared('office', LEVELS.office.sections(1))).toBe(true);
  });
});

describe('carry state: starter kit, Retry snapshot, participants', () => {
  it('travel places the player without touching vitals; only a NewGame spawn restores them', () => {
    const p = new Player();
    p.spawn(1, 2, 0.5, 0);
    p.takeDamage(37);
    p.stamina = 22;
    p.crouched = true; p.vy = -3; p.grounded = false;
    p.place(10, 20, 1.5, 4.75); // travel arrival
    expect([p.x, p.z, p.yaw, p.y, p.vy, p.grounded, p.crouched, p.climb]).toEqual([10, 20, 1.5, 4.75, 0, true, false, null]);
    expect([p.hp, p.stamina, p.alive, p.damageTaken]).toEqual([63, 22, true, 37]);
    p.spawn(0, 0, 0, 0); // NewGame
    expect([p.hp, p.stamina, p.alive, p.damageTaken]).toEqual([p.maxHp, 100, true, 0]);
  });

  it('NewGame hands out exactly the iteration-15 starter kit', () => {
    const inv = starterInventory('pistol');
    expect(inv.hotbar[0]).toMatchObject({itemId: 'pistol', count: 1, mag: WEAPONS.pistol.magazine});
    expect(inv.hotbar[4]).toMatchObject({itemId: 'bandage', count: 1});
    expect(countOf(inv, 'ammo_9mm')).toBe(45);
    expect(countOf(inv, 'flare')).toBe(1);
    expect(inv.selected).toBe(0);
    // lane KNIFE (knife-melee-20261030): + the knife, in addition to the unchanged kit (no ammo: mag 0) — since task
    // knife-windup-20261030 (lane SLOT) in the dedicated melee slot (~), not quick slot 3 (which stays empty)
    expect(inv.melee).toMatchObject({itemId: 'knife', count: 1});
    expect(inv.hotbar[2]).toBeNull();
    expect(invItems(inv)).toEqual(['ammo_9mmx45', 'bandagex1', 'flarex1', `pistolx1@${WEAPONS.pistol.magazine}`]); // quick slots / pockets / grenade slot
    expect(inv.allStacks().map(s => s.itemId).sort()).toEqual(['ammo_9mm', 'bandage', 'flare', 'knife', 'pistol']);
    expect(inv.invariants()).toEqual([]);
    const rifle = starterInventory('rifle');
    expect(rifle.hotbar[0]).toMatchObject({itemId: 'rifle', mag: 30});
    expect(countOf(rifle, 'ammo_556')).toBe(60);
  });

  it('a level-entry snapshot restores the carry state exactly, any number of times (no free heal / refill)', () => {
    const inv = starterInventory('pistol');
    inv.add(inv.makeStack('water', 1));
    inv.hotbar[0]!.mag = 6; // a partly spent magazine
    const player = {hp: 63, stamina: 41, damageTaken: 37};
    const survival = new Survival();
    survival.hunger = 42; survival.thirst = 18; survival.time = 900;
    const battery = new FlashlightBattery(() => 0.5);
    battery.reset(0.31); battery.on = false;
    let limb: {arm: string | null} = {arm: 'left'};
    const resets: string[] = [];
    const injuries: RunParticipant = {id: 'injuries', save: () => ({...limb}), load: d => { limb = {...(d as typeof limb)}; }, reset: () => { limb = {arm: null}; resets.push('injuries'); }};
    const stats = {shots: 12, hits: 7, kills: 2, time: 900, headshots: 1, healed: 10, itemsUsed: 3};
    const snap = takeSnapshot({level: 'office', section: 'main', arrival: {kind: 'start'}}, {inv, player, survival, battery, participants: [injuries], stats}, {});
    const at = invItems(inv);

    // play on: use things, get hurt, drain, injure the other arm
    inv.take('ammo_9mm', 30); inv.take('water', 1); inv.hotbar[0]!.mag = 0;
    player.hp = 5; player.stamina = 0; player.damageTaken = 95;
    survival.hunger = 3; survival.thirst = 0; battery.charge = 0.02; battery.on = true;
    limb = {arm: 'right'};
    stats.kills = 9;

    for (let round = 0; round < 2; round++) {
      const restored = restoreCarry(snap, {player, survival, battery, stats});
      restoreParticipants(snap, [injuries]);
      expect(invItems(restored)).toEqual(at);
      expect(restored.hotbar[0]!.mag).toBe(6);
      expect(restored.invariants()).toEqual([]);
      expect(player).toEqual({hp: 63, stamina: 41, damageTaken: 37});
      expect([survival.hunger, survival.thirst, survival.time]).toEqual([42, 18, 900]);
      expect([battery.charge, battery.on]).toEqual([0.31, false]);
      expect(limb).toEqual({arm: 'left'});
      expect(stats.kills).toBe(2);
      // mutate the restored copies: the snapshot stays intact for the next retry
      restored.take('ammo_9mm', 45);
      restored.hotbar[0]!.mag = 1;
      limb.arm = 'both';
    }
    expect(resets).toEqual([]); // Retry never calls reset; NewGame does
    resetParticipants([injuries]);
    expect(limb).toEqual({arm: null});
  });

  it('inventory snapshots are deep (gear / backpack contents included through Inventory.clone) and keep uids unique', () => {
    const inv = starterInventory('pistol');
    inv.add(inv.makeStack('backpack', 1));
    const copy = cloneInventory(inv);
    expect(invItems(copy)).toEqual(invItems(inv));
    expect(copy).not.toBe(inv);
    copy.take('ammo_9mm', 45);
    expect(countOf(inv, 'ammo_9mm')).toBe(45);
    const fresh = copy.makeStack('bandage', 1);
    const uids = copy.hotbar.concat(copy.pack).filter(Boolean).map(s => s!.uid);
    expect(uids).not.toContain(fresh.uid);
  });

  it('a participant missing from a snapshot is reset on restore; save errors never break the snapshot', () => {
    let late = 'hurt';
    const lateP: RunParticipant = {id: 'late', save: () => late, load: d => { late = d as string; }, reset: () => { late = 'fresh'; }};
    const broken: RunParticipant = {id: 'broken', save: () => { throw new Error('nope'); }, load: () => {}, reset: () => {}};
    const snap = takeSnapshot({level: 'subway', section: 'main', arrival: {kind: 'start'}},
      {inv: new Inventory(), player: {hp: 1, stamina: 1, damageTaken: 0}, survival: new Survival(), battery: new FlashlightBattery(), participants: [broken], stats: {}}, {});
    restoreParticipants(snap, [lateP, broken]);
    expect(late).toBe('fresh');
  });
});

describe('section memory: taken loot stays taken, dropped items come back exactly once, kills stay dead', () => {
  const mats = new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17});
  type Visit = {pm: PickupManager; cm: ContainerManager; layoutIdx: Map<Pickup, number>};
  /** What Game.buildSection does with the memory (pickups + holders), on the real managers. */
  const visit = (layout: ReturnType<typeof levelFixture>, mem: SectionMemory, inv: Inventory): Visit => {
    const pm = new PickupManager({});
    const cm = new ContainerManager({}, mats, () => inv);
    cm.build(layout);
    applyHolders(cm, mem.holders);
    const layoutIdx = new Map<Pickup, number>();
    const plan = pickupPlan(layout.pickups.length, mem);
    for (const i of plan.fromLayout) { const p = layout.pickups[i]; layoutIdx.set(pm.add(inv.makeStack(p.itemId, p.count), p.x, p.y, p.z, 0.3 * i), i); }
    for (const rec of plan.restored) { const pk = restorePickup(pm, inv, rec); if (rec.layoutIndex !== undefined) layoutIdx.set(pk, rec.layoutIndex); }
    mem.visits++;
    return {pm, cm, layoutIdx};
  };
  /** What Game.saveSectionMemory does. */
  const leave = (v: Visit, mem: SectionMemory) => {
    mem.pickups = capturePickups(v.pm.list, p => v.layoutIdx.get(p));
    mem.holders = captureHolders(v.cm);
  };
  const lotTotal = (cm: ContainerManager) => cm.all.reduce((n, h) => n + h.state.lots.reduce((k, l) => k + l.count, 0), 0);
  const looseTotal = (pm: PickupManager) => pm.list.reduce((n, p) => n + p.stack.count, 0);
  const invTotal = (inv: Inventory) => inv.hotbar.concat(inv.pack).reduce((n, s) => n + (s ? s.count : 0), 0);

  it('round trip over three visits: no respawn, no duplication, no loss; exact poses, counts and magazines', () => {
    const layout = levelFixture();
    const inv = starterInventory('pistol');
    const mem = createMemory({level: 'subway', section: 'main'});
    const v1 = visit(layout, mem, inv);
    expect(v1.pm.list.length).toBe(3);
    const grand0 = invTotal(inv) + looseTotal(v1.pm) + lotTotal(v1.cm);

    // take layout pickup 0 entirely, take part of pickup 2 (8 rounds: leave 3), drop the pistol (mag 6) and 20 rounds
    const p0 = v1.pm.list.find(p => v1.layoutIdx.get(p) === 0)!;
    expect(inv.add(p0.stack)).toBe(0);
    v1.pm.remove(p0);
    const p2 = v1.pm.list.find(p => v1.layoutIdx.get(p) === 2)!;
    p2.stack.count = 3;
    inv.add(inv.makeStack('ammo_556', 5));
    inv.hotbar[0]!.mag = 6;
    const gun = inv.detach({bar: 'hotbar', index: 0})!;
    const dropped = v1.pm.add(gun, 4.2, 0, 6.4, 1.1);
    dropped.obj.quaternion.setFromEuler(new THREE.Euler(0.2, 1.1, 0.05));
    const ammoRef = inv.find(inv.pack.find(s => s?.itemId === 'ammo_9mm')!.uid)!;
    v1.pm.add(inv.detach(ammoRef, 20)!, 4.6, 0, 6.1, 0.4);
    // open a door / lid holder that has loot and take what fits (at least one interaction: it is opened / searched)
    const cab = v1.cm.all.find(h => h.group === 'container' && h.state.lots.length > 0) ?? v1.cm.all.find(h => h.group === 'container')!;
    const cabRolled = cab.state.lots.length;
    for (let i = 0; i < 6 && (i === 0 || cab.state.lots.length); i++) v1.cm.interact(cab);
    expect(cab.state.searched).toBe(true);
    const cabLeft = cab.state.lots.map(l => l.id);
    if (cabRolled > 0) expect(cabLeft.length).toBeLessThan(cabRolled);
    const grand1 = invTotal(inv) + looseTotal(v1.pm) + lotTotal(v1.cm);
    expect(grand1).toBe(grand0);
    leave(v1, mem);
    expect(takenLayoutPickups(layout.pickups.length, mem)).toEqual([0]);

    // come back (fresh managers, fresh roll): exactly what was left
    const v2 = visit(layout, mem, inv);
    const items = (pm: PickupManager) => pm.list.map(p => `${p.stack.itemId}x${p.stack.count}${p.stack.mag !== undefined ? `@${p.stack.mag}` : ''}`).sort();
    expect(items(v2.pm)).toEqual(['ammo_556x3', 'ammo_9mmx20', 'bandagex1', 'pistolx1@6']); // not the taken 12 rifle rounds
    const gun2 = v2.pm.list.find(p => p.stack.itemId === 'pistol')!;
    expect(gun2.obj.position.toArray()).toEqual([4.2, 0, 6.4]);
    expect(gun2.obj.quaternion.angleTo(dropped.obj.quaternion)).toBeLessThan(1e-6);
    expect([gun2.x, gun2.y, gun2.z]).toEqual([dropped.x, dropped.y, dropped.z]);
    const cab2 = v2.cm.all.find(h => h.kind === cab.kind && h.prop.x === cab.prop.x && h.prop.y === cab.prop.y && h.prop.z === cab.prop.z)!;
    expect(cab2.state.lots.map(l => l.id)).toEqual(cabLeft);
    expect(cab2.state.searched).toBe(true);
    expect(invTotal(inv) + looseTotal(v2.pm) + lotTotal(v2.cm)).toBe(grand1);
    // uids stay unique between the inventory and the restored pickups
    const uids = [...inv.hotbar, ...inv.pack].filter(Boolean).map(s => s!.uid).concat(v2.pm.list.map(p => p.stack.uid));
    expect(new Set(uids).size).toBe(uids.length);

    // leave again untouched, come back a third time: still exactly once each
    leave(v2, mem);
    const v3 = visit(layout, mem, inv);
    expect(items(v3.pm)).toEqual(items(v2.pm));
    expect(invTotal(inv) + looseTotal(v3.pm) + lotTotal(v3.cm)).toBe(grand1);
    expect(mem.visits).toBe(3);
  });

  it('taken lots never return and remembered ids that are not in the rolled holder are ignored (never added)', () => {
    const layout = levelFixture();
    const inv = new Inventory();
    const mem = createMemory({level: 'office', section: 'main'});
    const v1 = visit(layout, mem, inv);
    leave(v1, mem);
    const key = Object.keys(mem.holders).find(k => mem.holders[k].lots.length > 0)!;
    expect(key).toBeTruthy();
    const kept = mem.holders[key].lots.slice(1);
    mem.holders[key] = {...mem.holders[key], lots: [...kept, 999999]};
    const v2 = visit(layout, mem, inv);
    expect(captureHolders(v2.cm)[key].lots).toEqual(kept);
  });

  it('killed enemies are never spawned again; kills only accumulate', () => {
    const mem = createMemory({level: 'subway', section: 'main'});
    expect(enemiesToSpawn(5, mem)).toEqual([0, 1, 2, 3, 4]);
    mem.killed = mergeKilled(mem.killed, [3, 1]);
    expect(enemiesToSpawn(5, mem)).toEqual([0, 2, 4]);
    mem.killed = mergeKilled(mem.killed, [1, 4]); // the same kill twice is one kill
    expect(mem.killed).toEqual([1, 3, 4]);
    expect(enemiesToSpawn(5, mem)).toEqual([0, 2]);
  });
});

describe('grounded bags live in the run memory (lane GEAR store adapter)', () => {
  it('per level, deep copies, cleared with the run, restored with a level on Retry', () => {
    const run = new RunState({seeds: SEEDS, start: {level: 'office', section: 'main'}});
    const store = runBagStore(() => run);
    const rec = {bags: [{x: 1, z: 2, contents: [{itemId: 'water', count: 1}]}]};
    store.save('office:main', rec);
    rec.bags[0].x = 99;
    expect((store.load('office:main') as typeof rec).bags[0].x).toBe(1);
    expect(store.load('subway:main')).toBeUndefined();
    expect(run.laneStore(BAG_LANE, {level: 'office', section: 'main'})).toBeTruthy();
    expect(parseSectionId('office:main')).toEqual({level: 'office', section: 'main'});
    const entry = run.levelMemories('office'); // level-entry snapshot
    store.save('office:main', {bags: []}); // the bag was picked up later
    store.save('subway:main', {bags: [{x: 0, z: 0, contents: []}]});
    run.restoreLevelMemories('office', entry); // Retry level (the Subway's memory is untouched)
    expect((store.load('office:main') as typeof rec).bags[0].x).toBe(1);
    expect((store.load('subway:main') as {bags: unknown[]}).bags).toHaveLength(1);
    expect(Object.keys(store.toJSON()).sort()).toEqual(['office:main', 'subway:main']);
    store.clear();
    expect(store.toJSON()).toEqual({});
  });
});

describe('travel gating', () => {
  const req: TravelRequest = {to: {level: 'office', section: 'main'}, arrival: {kind: 'start'}, label: 'Travelling to Office Space', via: 'menu'};
  const ok: TravelGateState = {busy: false, alive: true, state: 'playing', ready: true, sections: l => LEVELS[l].sections(1), current: 'subway'};

  it('dead players never travel; one travel at a time; only from gameplay / pause / clear screens; only to ANOTHER level', () => {
    expect(travelRefusal(req, ok)).toBeNull();
    expect(travelRefusal(req, {...ok, alive: false})).toBe('dead');
    expect(travelRefusal(req, {...ok, state: 'dead'})).toBe('dead');
    expect(travelRefusal(req, {...ok, busy: true})).toBe('busy');
    for (const state of ['title', 'loading', 'error']) expect(travelRefusal(req, {...ok, state})).toBe('not-ready');
    for (const state of ['paused', 'won', 'inventory']) expect(travelRefusal(req, {...ok, state})).toBeNull();
    expect(travelRefusal(req, {...ok, ready: false})).toBe('not-ready');
    // iteration 17: there are no floor sections, and nothing inside a level is a travel
    expect(travelRefusal({...req, to: {level: 'office', section: 'floor-3'}}, ok)).toBe('unknown-section');
    expect(travelRefusal({...req, to: {level: 'office', section: 'street'}}, ok)).toBe('unknown-section');
    expect(travelRefusal(req, {...ok, current: 'office'})).toBe('same-level');
    expect(travelRefusal({...req, to: {level: 'subway', section: 'main'}}, ok)).toBe('same-level');
    expect(travelRefusal({...req, to: {level: 'subway', section: 'main'}}, {...ok, current: 'office'})).toBeNull();
    expect(sectionId(req.to)).toBe('office:main');
  });

  it('single flight: a second operation while one runs is refused; the slot frees afterwards, also after a failure', async () => {
    const sf = new SingleFlight();
    let release!: () => void;
    const first = sf.run(() => new Promise<string>(r => { release = () => r('done'); }));
    expect(first).not.toBeNull();
    expect(sf.busy).toBe(true);
    expect(sf.run(async () => 'second')).toBeNull();
    release();
    await expect(first).resolves.toBe('done');
    expect(sf.busy).toBe(false);
    const failing = sf.run(async () => { throw new Error('boom'); });
    await expect(failing).rejects.toThrow('boom');
    expect(sf.busy).toBe(false);
    await expect(sf.run(async () => 3)).resolves.toBe(3);
  });
});
