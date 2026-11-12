// Task studio-train-crafting-v1-20261111-225628-01 (lane SCANNER; user: "A movable plugged console opens a black/green 360-degree radar
// around the train … About every 30 active seconds a sweep refreshes snapshot blips … No floorplan/map or continuous live tracking" /
// "Their benefits require being plugged in. Moving/unplugging/reconnecting is free; radar/scanner have no new battery or fuel
// upkeep."): the scanner's RUNTIME (world/itemScanner.ts) on a fake host — the game's own registries, a fake of the equipment
// system's interface (craft/equipmentApi.ts) and a fake clock (the frame hooks' dt):
//  - the console: the prompt copy, E opens / closes the scope only while the scanner is plugged into the parked train;
//  - sweeps: the first one 4 ACTIVE seconds into a world, then one every 30; unplugged / riding / paused time does not count and
//    replugging gives no early sweep; between sweeps the picture does not change although the world does; a new world clears it;
//  - the scope: it owns no input and pauses nothing; it closes on E (captured), any state but 'playing', a hit, death, walking away,
//    the scanner unplugged / grabbed, the ride, a teardown; it redraws at 10 Hz, not every frame.
// Node only.

import {describe, expect, it} from 'vitest';
import {EQUIPMENT, type EquipmentDef, type EquipmentKind} from '../src/craft/equipment';
import type {EquipmentStore, EquipmentSystemLike, EquipmentUnit, EquipmentUse} from '../src/craft/equipmentApi';
import {SCANNER, type ScanBag, type ScanEnemy, type ScanHolder, type ScanPickup} from '../src/craft/scanner';
import {ScannerScope, type ScopeEnv} from '../src/ui/scannerView';
import {ItemScannerSystem, SCANNER_TEXT, installItemScanner, scannerQaApi, type ScannerHost} from '../src/world/itemScanner';

// --- fakes --------------------------------------------------------------------------------------------------------------------------

/** A unit as the equipment system hands it out (the fields are writable here: the fake system moves / plugs it). */
class FakeUnit implements EquipmentUnit {
  readonly def: EquipmentDef;
  mode: 'world' | 'cargo' | 'held' = 'world';
  plug: number | null = null;
  ammo = 0;
  slots = null;
  storeVersion = 0;
  pose: {x: number; y: number; z: number; yaw: number; level: number} | null;
  poses = 0;
  constructor(readonly uid: string, readonly kind: EquipmentKind, x = 100, z = 49) {
    this.def = EQUIPMENT[kind];
    this.pose = {x, y: 1.1, z, yaw: 0, level: 0};
  }
  setAmmo(n: number): number { return (this.ammo = n); }
  touchStore(): void {}
  setOpen(): void {}
  worldPose() { this.poses++; return this.pose ? {...this.pose} : null; }
}

/** The equipment system's interface: plugs are free and instant; a benefit is active only while the train is parked in a live world. */
class FakeEquipment implements EquipmentSystemLike {
  readonly uses: Partial<Record<EquipmentKind, EquipmentUse>> = {};
  readonly plugListeners: ((u: EquipmentUnit, plugged: boolean) => void)[] = [];
  readonly list: FakeUnit[] = [];
  parked = true;
  asked = 0;
  units(): readonly EquipmentUnit[] { return this.list; }
  plugged(kind: EquipmentKind): EquipmentUnit | null { return [...this.list].filter(u => u.kind === kind && u.plug !== null).sort((a, b) => a.plug! - b.plug!)[0] ?? null; }
  active(kind: EquipmentKind): EquipmentUnit | null { this.asked++; return this.parked ? this.plugged(kind) : null; }
  craftBlock(): string | null { return null; }
  craft(): EquipmentUnit | null { return null; }
  storesAboard(): EquipmentStore[] { return []; }
  add(kind: EquipmentKind, plug: number | null = null, x?: number, z?: number): FakeUnit {
    const u = new FakeUnit(`eq-${this.list.length + 1}`, kind, x, z);
    this.list.push(u);
    if (plug !== null) this.plugIn(u, plug);
    return u;
  }
  plugIn(u: FakeUnit, plug: number): void { u.plug = plug; for (const l of this.plugListeners) l(u, true); }
  unplug(u: FakeUnit): void { u.plug = null; for (const l of this.plugListeners) l(u, false); }
}

class FakeCanvasCtx {
  texts: string[] = [];
  fillStyle: unknown = ''; strokeStyle: unknown = ''; globalAlpha = 1; lineWidth = 1; font = '10px m'; textAlign = ''; textBaseline = '';
  save(): void {} restore(): void {} setTransform(): void {} beginPath(): void {} moveTo(): void {} lineTo(): void {} closePath(): void {} arc(): void {}
  fill(): void {} stroke(): void {} fillRect(): void {}
  fillText(t: string): void { this.texts.push(t); }
  measureText(t: string): {width: number} { return {width: t.length * 8}; }
}

/** A page with a body: the scope builds one holder + canvas into it. */
function page() {
  const ctx = new FakeCanvasCtx();
  type El = {tag: string; id: string; style: Record<string, unknown>; children: El[]; width: number; height: number; appendChild(c: El): El; remove(): void; getContext(): FakeCanvasCtx};
  const body = {children: [] as El[], appendChild(c: El) { body.children.push(c); return c; }};
  const doc = {body, createElement: (tag: string): El => { const el: El = {tag, id: '', style: {}, children: [], width: 0, height: 0, appendChild(c) { el.children.push(c); return c; }, remove() {}, getContext: () => ctx}; return el; }};
  const env: ScopeEnv = {doc: () => doc as never, width: () => 1280, height: () => 720, dpr: () => 1};
  return {env, body, ctx};
}

const CAR = {x: 100, z: 50, front: 1 as const, railTopY: 0.3};
const enemy = (x: number, z: number): {brain: {alive: boolean; x: number; z: number}; ragdolled: boolean} => ({brain: {alive: true, x, z}, ragdolled: false});
const pickup = (itemId: string, x: number, z: number, owner?: string): ScanPickup => ({stack: {itemId}, x, z, ...(owner ? {owner} : {})});
const holder = (x: number, z: number, lots: string[], y = 0): ScanHolder => ({prop: {x, y, z}, state: {lots: lots.map(itemId => ({itemId}))}});

function world(o: {scanner?: 'plugged' | 'loose' | 'none'; equipment?: boolean} = {}) {
  const eq = new FakeEquipment();
  const toasts: string[] = [];
  const pg = page();
  const host = {
    state: 'playing',
    player: {x: 100, y: 1.1, z: 50, alive: true},
    hud: {toast: (t: string) => { toasts.push(t); }},
    zombies: [enemy(130, 50), enemy(100, 20)] as ScanEnemy[],
    pickups: {list: [pickup('beans', 60, 50), pickup('rifle', 100, 90)] as ScanPickup[]},
    containers: {all: [holder(140, 80, ['water', 'ammo_9mm'])] as ScanHolder[]} as {all: ScanHolder[]} | null,
    gear: {bags: [] as ScanBag[]},
    trainCargo: {ownsPickup: (_p: ScanPickup) => false, ownsBag: (_b: ScanBag) => false, insideCar: (_x: number, _y: number, _z: number) => false},
    trainRuntime: {train: {placement: CAR} as {placement: typeof CAR} | null},
    trainEquipment: o.equipment === false ? null : eq,
    trainRide: {riding: false},
    frameHooks: [] as ((dt: number) => void)[],
    interactHandlers: [] as (() => boolean)[],
    pointerHandlers: [] as (() => boolean)[],
    inputOwners: [] as (() => boolean)[],
    promptProviders: [] as (() => string | null)[],
    sectionHooks: [] as {build?(l: never): void; teardown?(): void}[],
    stateListeners: [] as ((s: never, prev: never) => void)[],
    hitListeners: [] as ((h: never) => void)[],
    runParticipants: [] as unknown[],
    modifierSources: [] as unknown[],
  };
  // registries other lanes filled before the scanner installs
  const other = {interacts: 0, prompt: null as string | null};
  host.interactHandlers.push(() => { other.interacts++; return true; });
  host.promptProviders.push(() => other.prompt);
  const sys = new ItemScannerSystem(host as ScannerHost, {scope: new ScannerScope(pg.env)}).install();
  const unit = o.scanner === 'none' ? null : eq.add('scanner', o.scanner === 'loose' ? null : 1);
  /** The game's frame: the hooks run in active play only (Game.update is not called in a menu / paused / loading). */
  const frame = (dt: number) => { if (host.state === 'playing') for (const f of host.frameHooks) f(dt); };
  const run = (seconds: number, dt = 0.5) => { for (let i = 0, n = Math.round(seconds / dt); i < n; i++) frame(dt); };
  const setState = (s: string) => { const prev = host.state; host.state = s; for (const l of host.stateListeners) (l as (a: string, b: string) => void)(s, prev); };
  /** E as Game.interact does it: the handlers in order, the first true wins. */
  const pressE = (): number => host.interactHandlers.findIndex(h => h());
  const prompt = (): string | null => { for (const p of host.promptProviders) { const t = p(); if (t) return t; } return null; };
  const rebuild = () => { for (const h of host.sectionHooks) h.teardown?.(); for (const h of host.sectionHooks) h.build?.(undefined as never); };
  return {host, eq, sys, unit: unit!, toasts, pg, other, frame, run, setState, pressE, prompt, rebuild, use: () => eq.uses.scanner!};
}

// --- tests ----------------------------------------------------------------------------------------------------------------------------

describe('the console: the scanner\'s use on the equipment system', () => {
  it('registers its use, a plug listener and the game registries — and nothing that could own the mouse, pause or save', () => {
    const w = world();
    expect(Object.keys(w.eq.uses)).toEqual(['scanner']);
    expect(typeof w.use().prompt).toBe('function');
    expect(typeof w.use().tap).toBe('function');
    expect(w.use().hold).toBeUndefined(); // a tap acts on the press
    expect(w.eq.plugListeners).toHaveLength(1);
    expect([w.host.frameHooks.length, w.host.interactHandlers.length, w.host.promptProviders.length, w.host.sectionHooks.length, w.host.stateListeners.length, w.host.hitListeners.length]).toEqual([1, 2, 2, 1, 1, 1]);
    expect([w.host.inputOwners.length, w.host.pointerHandlers.length, w.host.runParticipants.length, w.host.modifierSources.length]).toEqual([0, 0, 0, 0]);
    expect(w.pg.body.children).toHaveLength(0); // no DOM until the scope is first opened
    expect(w.toasts).toEqual([]);
  });

  it('the copy: plugged in — "[E] Scanner scope · next sweep in N s"; not plugged in — "plug it into a train socket"', () => {
    const w = world();
    expect(w.use().prompt(w.unit)).toBe('<b>[E]</b> Scanner scope · next sweep in 4 s');
    w.run(1.5);
    expect(w.use().prompt(w.unit)).toBe('<b>[E]</b> Scanner scope · next sweep in 3 s');
    w.run(2.5); // the first sweep
    expect(w.use().prompt(w.unit)).toBe('<b>[E]</b> Scanner scope · next sweep in 30 s');
    w.run(12.5);
    expect(w.use().prompt(w.unit)).toBe('<b>[E]</b> Scanner scope · next sweep in 18 s');
    w.eq.unplug(w.unit);
    expect(w.use().prompt(w.unit)).toBe('Item scanner — plug it into a train socket');
    expect(SCANNER_TEXT.unplugged).toBe('Item scanner — plug it into a train socket');
    // plugged in but the train is not parked in a live world (riding): no benefit
    w.eq.plugIn(w.unit, 0);
    w.eq.parked = false;
    expect(w.use().prompt(w.unit)).toBe(SCANNER_TEXT.unplugged);
  });

  it('E on the console opens the scope only while the scanner is plugged in; not plugged in, the tap is the default action (grab)', () => {
    const w = world({scanner: 'loose'});
    expect(w.use().tap(w.unit)).toBe(false); // false: the equipment system grabs the hand truck
    expect([w.sys.openUnit, w.sys.scope.isOpen, w.pg.body.children.length]).toEqual([null, false, 0]);
    w.eq.plugIn(w.unit, 2);
    expect(w.use().tap(w.unit)).toBe(true);
    expect([w.sys.openUnit, w.sys.scope.isOpen]).toEqual([w.unit, true]);
    expect(w.pg.body.children.map(e => [e.id, e.style.display, e.children.map(c => c.tag)])).toEqual([['scanner-scope', 'flex', ['canvas']]]);
    expect(w.sys.scope.draws).toBe(1); // painted at once
    expect(w.use().prompt(w.unit)).toBe('<b>[E]</b> Close the scanner scope');
    // a second tap on the console closes it
    expect(w.use().tap(w.unit)).toBe(true);
    expect([w.sys.openUnit, w.sys.scope.isOpen, w.pg.body.children[0].style.display, w.sys.lastClose]).toEqual([null, false, 'none', 'key']);
    // never in a menu / when dead
    w.setState('paused');
    w.sys.open(w.unit);
    expect(w.sys.openUnit).toBeNull();
    w.setState('playing');
    w.host.player.alive = false;
    w.sys.open(w.unit);
    expect(w.sys.openUnit).toBeNull();
  });

  it('a second plugged scanner works like the first; a radar or sentry never counts as one', () => {
    const w = world();
    const second = w.eq.add('scanner', 2, 104, 51);
    expect(w.use().tap(second)).toBe(true);
    expect(w.sys.openUnit).toBe(second);
    w.sys.close('key');
    const none = world({scanner: 'none'});
    none.eq.add('radar', 0);
    none.eq.add('sentry', 1);
    none.run(40);
    expect([none.sys.active, none.sys.snap, none.sys.clock.left]).toEqual([false, null, SCANNER.warmup]);
  });

  it('without an equipment system (or a scanner) it is inert: no sweep, no scope, no crash', () => {
    for (const w of [world({equipment: false}), world({scanner: 'none'})]) {
      w.run(100);
      expect([w.sys.active, w.sys.snap, w.sys.counts.sweeps, w.sys.clock.left]).toEqual([false, null, 0, SCANNER.warmup]);
      expect(w.pressE()).toBe(1); // E goes on to the other handlers
      expect(w.prompt()).toBeNull();
      w.rebuild();
      w.setState('paused');
    }
  });
});

describe('sweeps: one snapshot every 30 ACTIVE seconds', () => {
  it('the first sweep 4 s after the scanner is active in a world, then every 30 s — nothing in between', () => {
    const w = world();
    const at: number[] = [];
    let t = 0;
    for (let i = 0; i < 200; i++) { const n = w.sys.counts.sweeps; w.frame(0.5); t += 0.5; if (w.sys.counts.sweeps !== n) at.push(t); }
    expect(at).toEqual([4, 34, 64, 94]);
    expect(w.sys.snap!.seen).toEqual({enemy: 2, item: 2, gear: 1});
    expect(w.sys.qa()).toMatchObject({active: true, open: false, sweeps: 4, blips: {enemy: 2, item: 2, gear: 1}, dropped: {enemy: 0, item: 0, gear: 0}});
    expect(w.toasts).toEqual([]); // a sweep is silent: no toast, no upkeep
  });

  it('a snapshot is the scope\'s picture of the game\'s own lists around the parked car', () => {
    const w = world();
    w.host.gear.bags.push({pose: {x: 100, z: 60}, grounded: true});
    w.run(4);
    const cell = (v: number) => (Math.floor(v / SCANNER.cell) + 0.5) * SCANNER.cell;
    // the car stands at (100, 50) facing +X: train-local = world - (100, 50)
    expect(w.sys.snap!.enemy).toEqual([{x: cell(0), z: cell(-30), n: 1}, {x: cell(30), z: cell(0), n: 1}]); // (equally far: the cell index decides)
    expect(w.sys.snap!.item.map(b => [b.x, b.z])).toEqual([[cell(-40), cell(0)], [cell(40), cell(30)]]);
    expect(w.sys.snap!.gear.map(b => [b.x, b.z])).toEqual([[cell(0), cell(10)], [cell(0), cell(40)]]);
    // the same world from a car that stands the other way round: everything is a half turn
    const v = world();
    v.host.trainRuntime.train = {placement: {...CAR, front: -1 as never}};
    v.host.gear.bags.push({pose: {x: 100, z: 60}, grounded: true});
    v.run(4);
    expect(v.sys.snap!.gear.map(b => [b.x, b.z])).toEqual([[cell(0), cell(-10)], [cell(0), cell(-40)]]);
    expect(v.sys.snap!.enemy.map(b => [b.x, b.z])).toEqual([[cell(-30), cell(0)], [cell(0), cell(30)]]);
  });

  it('only ACTIVE time counts: unplugged, riding and paused seconds do not; replugging neither resets nor advances the clock', () => {
    const w = world();
    w.run(3); // 3 of the 4 warm-up seconds
    expect([w.sys.counts.sweeps, w.sys.clock.left]).toEqual([0, 1]);
    // unplugged for a minute
    w.eq.unplug(w.unit);
    w.run(60);
    expect([w.sys.counts.sweeps, w.sys.clock.left, w.sys.active]).toEqual([0, 1, false]);
    // replugged (another socket): no sweep now — the part already waited is kept, the rest is still owed
    w.eq.plugIn(w.unit, 0);
    w.frame(0.5);
    expect([w.sys.counts.sweeps, w.sys.clock.left]).toEqual([0, 0.5]);
    w.frame(0.5);
    expect(w.sys.counts.sweeps).toBe(1);
    // replugging over and over mid-period buys nothing
    w.run(10);
    for (let i = 0; i < 50; i++) { w.eq.unplug(w.unit); w.frame(0.5); w.eq.plugIn(w.unit, i % 3); }
    expect([w.sys.counts.sweeps, w.sys.clock.left]).toEqual([1, 20]);
    // the train riding (the unit keeps its plug, the benefit is off): frames pass, the clock stands
    w.eq.parked = false;
    w.run(45);
    expect([w.sys.counts.sweeps, w.sys.clock.left, w.sys.active]).toEqual([1, 20, false]);
    w.eq.parked = true;
    // paused / inventory / the map: the game runs no frame hooks at all
    w.setState('paused');
    w.run(45);
    w.setState('inventory');
    w.run(45);
    expect([w.sys.counts.sweeps, w.sys.clock.left]).toEqual([1, 20]);
    w.setState('playing');
    w.run(19.5);
    expect(w.sys.counts.sweeps).toBe(1);
    w.frame(0.5);
    expect(w.sys.counts.sweeps).toBe(2); // exactly 30 active seconds after the first
  });

  it('NO LIVE TRACKING: between two sweeps the picture does not change although everything moved, died or was taken', () => {
    const w = world();
    w.run(4);
    const first = w.sys.snap!, copy = JSON.stringify(first);
    expect(first.seen).toEqual({enemy: 2, item: 2, gear: 1});
    // the world changes completely
    const z0 = w.host.zombies[0] as {brain: {alive: boolean; x: number; z: number}; ragdolled: boolean};
    z0.brain.x = 60; z0.brain.z = 10; // walked off
    (w.host.zombies[1] as typeof z0).brain.alive = false; // killed
    w.host.zombies.push(enemy(101, 51)); // a new one right at the train
    w.host.pickups.list.length = 0; // everything loose was taken
    (w.host.containers!.all[0].state.lots as {itemId: string}[]).length = 0; // the holder emptied
    for (let t = 0; t < 29.5; t += 0.5) {
      w.frame(0.5);
      expect(w.sys.snap).toBe(first); // the very same snapshot object
    }
    expect(JSON.stringify(first)).toBe(copy); // and nobody edited it
    w.frame(0.5); // the next sweep: the world as it is NOW
    expect(w.sys.snap).not.toBe(first);
    expect(w.sys.snap!.seen).toEqual({enemy: 2, item: 0, gear: 0});
    expect(JSON.stringify(first)).toBe(copy); // the old picture was replaced, never patched
    const cell = (v: number) => (Math.floor(v / SCANNER.cell) + 0.5) * SCANNER.cell;
    expect(w.sys.snap!.enemy).toEqual([{x: cell(1), z: cell(1), n: 1}, {x: cell(-40), z: cell(-40), n: 1}]);
  });

  it('reads the game\'s lists at the sweep (they are replaced with every world), never before', () => {
    const w = world();
    const reads = {zombies: 0, pickups: 0, holders: 0};
    const zs = w.host.zombies, ps = w.host.pickups.list, hs = w.host.containers!.all;
    Object.defineProperty(w.host, 'zombies', {get() { reads.zombies++; return zs; }, configurable: true});
    Object.defineProperty(w.host.pickups, 'list', {get() { reads.pickups++; return ps; }, configurable: true});
    Object.defineProperty(w.host.containers, 'all', {get() { reads.holders++; return hs; }, configurable: true});
    w.run(3.5);
    expect(reads).toEqual({zombies: 0, pickups: 0, holders: 0}); // a frame without a sweep reads nothing of the world
    w.run(0.5);
    expect(reads).toEqual({zombies: 1, pickups: 1, holders: 1});
    w.run(29.5);
    expect(reads).toEqual({zombies: 1, pickups: 1, holders: 1});
    // a level without containers / gear
    Object.defineProperty(w.host, 'containers', {value: null, configurable: true});
    Object.defineProperty(w.host, 'gear', {value: undefined, configurable: true});
    w.run(0.5);
    expect(w.sys.snap!.seen).toEqual({enemy: 2, item: 1, gear: 1});
  });

  it('the train\'s own cargo and a stall\'s wares are never blips', () => {
    const w = world();
    const inCar = pickup('shotgun', 101, 50), ware = pickup('medkit', 120, 60, 'stall-2');
    const bagInCar: ScanBag = {pose: {x: 99, z: 50}, grounded: true}, crate = holder(102, 50.5, ['pistol'], 1.15);
    w.host.pickups.list.push(inCar, ware);
    w.host.gear.bags.push(bagInCar, {pose: {x: 90, z: 20}, grounded: true});
    w.host.containers!.all.push(crate);
    const asked: unknown[] = [];
    w.host.trainCargo.ownsPickup = p => { asked.push(p); return p === inCar; };
    w.host.trainCargo.ownsBag = b => b === bagInCar;
    // (the car's interior in its own frame: the holder at world (102, 50.5, 1.15) is local (2, 0.5, 0.85))
    w.host.trainCargo.insideCar = (lx, ly, lz) => { asked.push([lx, +ly.toFixed(2), lz]); return Math.abs(lx) < 9 && Math.abs(lz) < 1.3 && ly > 0.5 && ly < 3; };
    w.run(4);
    expect(w.sys.snap!.seen).toEqual({enemy: 2, item: 2, gear: 2}); // + the far bag only
    expect(asked).toContainEqual([2, 0.85, 0.5]);
    expect(asked).not.toContain(ware); // an owned ware is out before anyone is asked
    // without a cargo system everything loose counts
    const v = world();
    v.host.pickups.list.push(inCar);
    (v.host as {trainCargo: unknown}).trainCargo = null;
    v.run(4);
    expect(v.sys.snap!.seen.gear).toBe(2);
  });

  it('no parked car, no picture: the sweep is skipped and nothing is invented', () => {
    const w = world();
    w.host.trainRuntime.train = null;
    w.run(4);
    expect([w.sys.snap, w.sys.counts.sweeps]).toEqual([null, 0]);
    expect(w.sys.sweep()).toBeNull();
  });

  it('a NEW WORLD (station build, Retry, load, arrival) clears the picture and arms the first sweep again', () => {
    const w = world();
    w.run(20);
    expect(w.sys.snap).not.toBeNull();
    w.use().tap(w.unit);
    expect(w.sys.scope.isOpen).toBe(true);
    w.rebuild();
    expect([w.sys.snap, w.sys.clock.left, w.sys.clock.sweeps, w.sys.scope.isOpen, w.sys.openUnit, w.sys.lastClose]).toEqual([null, SCANNER.warmup, 0, false, null, 'teardown']);
    expect(w.use().prompt(w.unit)).toBe('<b>[E]</b> Scanner scope · next sweep in 4 s');
    // the new world's things, 4 active seconds in
    w.host.zombies = [enemy(110, 50)];
    w.run(3.5);
    expect(w.sys.snap).toBeNull();
    w.frame(0.5);
    expect(w.sys.snap!.seen.enemy).toBe(1);
    // the warm-up waits for the scanner too: a world entered with it unplugged sweeps 4 s after it is plugged in
    w.eq.unplug(w.unit);
    w.rebuild();
    w.run(120);
    expect([w.sys.snap, w.sys.clock.left]).toEqual([null, SCANNER.warmup]);
    w.eq.plugIn(w.unit, 1);
    w.run(4);
    expect(w.sys.counts.sweeps).toBe(3);
    // nothing of it is state to save
    expect(Object.keys(w.host).filter(k => /save|participant/i.test(k))).toEqual(['runParticipants']);
    expect(w.host.runParticipants).toEqual([]);
  });
});

describe('the scope: open while playing, never in the way', () => {
  /** A world with the scope open at the console (the player 1 m from the scanner). */
  function open(leftOver = 10) {
    const w = world();
    w.host.player.x = w.unit.pose!.x; w.host.player.z = w.unit.pose!.z + 1;
    w.run(4 + leftOver);
    expect(w.use().tap(w.unit)).toBe(true);
    expect(w.sys.scope.isOpen).toBe(true);
    return w;
  }

  it('the game goes on behind it: frames run, the clock ticks, a sweep lands on the open scope', () => {
    const w = open(25);
    const before = w.sys.snap;
    w.host.zombies.push(enemy(100, 60));
    w.run(5);
    expect(w.sys.scope.isOpen).toBe(true);
    expect(w.sys.snap).not.toBe(before);
    expect(w.sys.snap!.seen.enemy).toBe(3);
    expect(w.host.state).toBe('playing');
    expect(w.host.inputOwners).toHaveLength(0); // it never owns the mouse buttons: the player can shoot with it open
    expect(w.pg.ctx.texts).toContain('NEXT SWEEP IN 30 s');
    expect(w.pg.ctx.texts.filter(t => t === 'ENEMY').length).toBeGreaterThan(1);
  });

  it('E closes it and is consumed — nothing else interacts on that press; closed, E is everyone else\'s again', () => {
    const w = open();
    expect(w.prompt()).toBe('<b>[E]</b> Close the scanner scope'); // whatever else is under the crosshair
    w.other.prompt = '<b>[E]</b> Take Beans';
    expect(w.prompt()).toBe('<b>[E]</b> Close the scanner scope');
    expect(w.pressE()).toBe(0); // the scanner's handler, first in line
    expect([w.sys.scope.isOpen, w.other.interacts, w.sys.lastClose]).toEqual([false, 0, 'key']);
    expect(w.prompt()).toBe('<b>[E]</b> Take Beans');
    expect(w.pressE()).toBe(1);
    expect(w.other.interacts).toBe(1);
    expect(w.sys.scope.isOpen).toBe(false); // and that press did not reopen it
  });

  it('Esc / Tab / the map / death: any state but playing closes it', () => {
    for (const s of ['paused', 'inventory', 'map', 'dead', 'loading', 'title', 'won', 'error']) {
      const w = open();
      w.setState(s);
      expect([s, w.sys.scope.isOpen, w.sys.lastClose]).toEqual([s, false, s === 'dead' ? 'dead' : 'state']);
      w.setState('playing');
      expect(w.sys.scope.isOpen).toBe(false); // it does not come back by itself
    }
    const w = open();
    w.host.player.alive = false; // died this frame, before the state changes
    w.frame(0.016);
    expect([w.sys.scope.isOpen, w.sys.lastClose]).toEqual([false, 'dead']);
  });

  it('a hit closes it (a hit that did nothing does not)', () => {
    const w = open();
    for (const l of w.host.hitListeners) (l as (h: {amount: number}) => void)({amount: 0});
    expect(w.sys.scope.isOpen).toBe(true);
    for (const l of w.host.hitListeners) (l as (h: {amount: number}) => void)({amount: 7});
    expect([w.sys.scope.isOpen, w.sys.lastClose]).toEqual([false, 'hit']);
    // closed: a hit is nothing to it
    for (const l of w.host.hitListeners) (l as (h: {amount: number}) => void)({amount: 7});
    expect(w.sys.counts.closes).toBe(1);
  });

  it('walking more than 2.6 m from the scanner closes it; staying near (or another level\'s floor above it) decides', () => {
    const w = open();
    const at = w.unit.pose!;
    const stand = (d: number, dy = 0) => { w.host.player.x = at.x + d; w.host.player.z = at.z; w.host.player.y = at.y + dy; w.run(0.5, 1 / 60); };
    stand(2.5);
    expect(w.sys.scope.isOpen).toBe(true);
    stand(-2.55);
    expect(w.sys.scope.isOpen).toBe(true);
    stand(2.7);
    expect([w.sys.scope.isOpen, w.sys.lastClose]).toEqual([false, 'away']);
    expect(SCANNER.closeDist).toBe(2.6);
    // the scanner pushed away from the player closes it just the same
    const v = open();
    v.unit.pose = {...v.unit.pose!, x: v.unit.pose!.x + 4};
    v.run(0.5, 1 / 60);
    expect(v.sys.lastClose).toBe('away');
    // straight above / below the scanner on another floor is away too
    const u = open();
    const p = u.unit.pose!;
    u.host.player.x = p.x; u.host.player.z = p.z; u.host.player.y = p.y + 3;
    u.run(0.5, 1 / 60);
    expect(u.sys.lastClose).toBe('away');
    // opened from farther than 2.6 m (a long reach): it closes only when the player walks off from THERE
    const far = world();
    far.host.player.x = far.unit.pose!.x + 3;
    far.host.player.z = far.unit.pose!.z;
    far.run(5);
    far.use().tap(far.unit);
    far.run(1, 1 / 60);
    expect(far.sys.scope.isOpen).toBe(true);
    far.host.player.x += 0.5;
    far.run(0.5, 1 / 60);
    expect(far.sys.lastClose).toBe('away');
  });

  it('the scanner unplugged / grabbed, lost, or the train leaving closes it', () => {
    const a = open();
    a.eq.unplug(a.unit); // (grabbing the hand truck unplugs it: the equipment system's listener call)
    expect([a.sys.scope.isOpen, a.sys.lastClose]).toEqual([false, 'inactive']);
    // even if no listener call came: the next frame notices
    const b = open();
    b.unit.plug = null;
    b.frame(0.016);
    expect([b.sys.scope.isOpen, b.sys.lastClose]).toEqual([false, 'inactive']);
    // another unit being unplugged is nothing to the open one
    const c = open();
    const other = c.eq.add('scanner', 2);
    c.eq.unplug(other);
    c.frame(0.016);
    expect(c.sys.scope.isOpen).toBe(true);
    // the ride starting
    c.host.trainRide.riding = true;
    c.frame(0.016);
    expect([c.sys.scope.isOpen, c.sys.lastClose]).toEqual([false, 'ride']);
    const d = open();
    d.eq.parked = false; // (the benefit off: the train no longer parked in a live world)
    d.frame(0.016);
    expect(d.sys.lastClose).toBe('inactive');
    // the unit has no place in the world any more
    const e = open();
    e.unit.pose = null;
    e.run(0.5, 1 / 60);
    expect(e.sys.lastClose).toBe('away');
    // a teardown
    const f = open();
    for (const h of f.host.sectionHooks) h.teardown?.();
    expect([f.sys.scope.isOpen, f.sys.lastClose]).toEqual([false, 'teardown']);
  });

  it('redraws at about 10 Hz while open and not at all while closed; the distance is checked at that pace too', () => {
    const w = open();
    const d0 = w.sys.scope.draws, p0 = w.unit.poses;
    w.run(2, 1 / 60); // 120 frames
    expect(w.sys.scope.draws - d0).toBeGreaterThanOrEqual(19);
    expect(w.sys.scope.draws - d0).toBeLessThanOrEqual(21);
    expect(w.unit.poses - p0).toBeGreaterThanOrEqual(15);
    expect(w.unit.poses - p0).toBeLessThanOrEqual(22);
    w.pressE();
    const d1 = w.sys.scope.draws, p1 = w.unit.poses, asked = w.eq.asked;
    w.run(2, 1 / 60);
    expect([w.sys.scope.draws, w.unit.poses]).toEqual([d1, p1]); // closed: no canvas work, no pose asked
    expect(w.eq.asked - asked).toBe(120); // one cheap question a frame: is a scanner active?
  });
});

describe('QA and the install seam', () => {
  it('window.__LL: scanner() reports the state; scannerSweep() takes a picture now and restarts the countdown', () => {
    const w = world();
    const api = scannerQaApi({itemScanner: w.sys});
    expect(api.scanner()).toMatchObject({active: true, open: false, nextSweepIn: 4, sweeps: 0, blips: null, seen: null, lastClose: null});
    expect(api.scannerSweep()).toMatchObject({active: true, nextSweepIn: 30, sweeps: 1, blips: {enemy: 2, item: 2, gear: 1}, seen: {enemy: 2, item: 2, gear: 1}});
    w.run(29.5);
    expect(w.sys.counts.sweeps).toBe(1);
    w.frame(0.5);
    expect(w.sys.counts.sweeps).toBe(2);
    w.host.trainRuntime.train = null;
    expect(api.scannerSweep()).toBe(false);
    expect(scannerQaApi({}).scanner()).toBeNull();
    expect(scannerQaApi({}).scannerSweep()).toBe(false);
  });

  it('installItemScanner(game) registers on the game it is given', () => {
    const w = world({equipment: false});
    const eq = new FakeEquipment();
    const host = {...w.host, trainEquipment: eq, frameHooks: [] as ((dt: number) => void)[], interactHandlers: [], promptProviders: [], sectionHooks: [], stateListeners: [], hitListeners: []};
    const sys = installItemScanner(host as never);
    expect(sys).toBeInstanceOf(ItemScannerSystem);
    expect(typeof eq.uses.scanner?.tap).toBe('function');
    expect(eq.plugListeners).toHaveLength(1);
    expect(host.frameHooks).toHaveLength(1);
    // no units: nothing is ever active, nothing sweeps, the default scope of a Node process never draws
    for (let i = 0; i < 100; i++) for (const f of host.frameHooks) f(0.5);
    expect([sys.active, sys.snap, sys.scope.draws]).toEqual([false, null, 0]);
  });
});
