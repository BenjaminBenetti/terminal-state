// Task studio-train-crafting-v1-20261111-225628-01 (lane SCANNER; user: "Item/enemy scanner: … A movable plugged console opens a
// black/green 360-degree radar around the train, approximately 100m range. About every 30 active seconds a sweep refreshes snapshot
// blips: red enemies, green ordinary items, gold weapons/gear. No floorplan/map or continuous live tracking; it should give broad
// awareness rather than precise navigation." / "radar/scanner have no new battery or fuel upkeep."): THE SCANNER'S RUNTIME
// (Game.itemScanner). The rules and every number are craft/scanner.ts (SCANNER, takeSnapshot, SweepClock); the scope is
// ui/scannerView.ts (drawScanner, ScannerScope). The scanner as a physical unit — the hand truck, the plugs, moving it — is the
// equipment system's (world/trainEquipment.ts): this module only reads craft/equipmentApi.ts EquipmentSystemLike (active('scanner'),
// a unit's plug / worldPose) and registers its own use (`uses.scanner`) and a plug listener there.
//
// installItemScanner(game) is called ONCE from the Game constructor (after the train equipment); it only REGISTERS:
//  - trainEquipment.uses.scanner: a TAP of E anywhere on the unit — the prompt line and the tap that opens / closes the scope
//    (holding E drags the hand truck: the equipment system's own rule, never asked here);
//  - frameHooks (they run in active play only: not paused, not in a menu, not in the gap between two stations): the sweep clock ticks
//    while a scanner is ACTIVE (plugged into the PARKED train in a live world: not unplugged, not on the ride) and takes one snapshot
//    when a sweep is due; the open scope's close rules and its redraw;
//  - interactHandlers / promptProviders (both FIRST: while the scope is open E only closes it — it never also takes an item or opens a
//    container — and the prompt says so); stateListeners / hitListeners / plugListeners (close); sectionHooks (a new world).
//
// SWEEPS: every SCANNER.period ACTIVE seconds one snapshot of the whole world at once (takeSnapshot: Game.zombies, the loose pickups,
// the holders that still hold lots, the grounded bags; within SCANNER.range of the car's centre, every storey flattened, the train's
// own cargo and market wares left out). Between sweeps NOTHING on the scope moves: no live tracking. Unplugging / replugging neither
// resets nor advances the clock (the elapsed part is kept: no free sweep). A NEW WORLD (station build, Retry, load, arrival) clears the
// snapshot and arms the first sweep SCANNER.warmup active seconds after a scanner is active there. Nothing is saved; no battery, fuel
// or other upkeep; a sweep makes no noise and alerts nothing.
//
// THE SCOPE (a DOM canvas over the game, pointer-events none): it does NOT pause the game and takes neither the mouse nor the movement
// keys — the player keeps full control. It closes on E (captured), Esc / Tab / any menu (the state leaves 'playing'), walking more than
// SCANNER.closeDist from the scanner, a hit, death, the scanner no longer active (unplugged / grabbed / the ride starting) and a
// teardown. A scanner that is not plugged in has no scope: its prompt says so and a tap of E does nothing (holding E drags it, as ever).

import type {Game} from '../game';
import type {EquipmentSystemLike, EquipmentUnit} from '../craft/equipmentApi';
import {SCANNER, SweepClock, takeSnapshot, type ScanBag, type ScanEnemy, type ScanFrame, type ScanHolder, type ScanPickup, type ScanSnapshot} from '../craft/scanner';
import {worldToTrain} from '../gen/playerTrain';
import {ScannerScope, type ScannerModel} from '../ui/scannerView';

/** Prompt texts. */
export const SCANNER_TEXT = {
  open: (seconds: number) => `<b>[E]</b> Scanner scope · next sweep in ${seconds} s`,
  close: '<b>[E]</b> Close the scanner scope',
  unplugged: 'Item scanner — plug it into a train socket',
} as const;

/** Why the scope closed (QA / tests). */
export type ScannerClose = 'key' | 'state' | 'dead' | 'hit' | 'away' | 'inactive' | 'ride' | 'teardown';

/** What the scanner needs from Game (structural: Node tests drive it with fakes). Lists are read at sweep time, never kept. */
export interface ScannerHost {
  state: string;
  player: {x: number; y: number; z: number; alive: boolean};
  zombies?: readonly ScanEnemy[];
  pickups?: {readonly list: readonly ScanPickup[]} | null;
  containers?: {readonly all: readonly ScanHolder[]} | null;
  gear?: {readonly bags: readonly ScanBag[]} | null;
  /** The train's loose cargo (world/trainCargo.ts): what lies in the parked car is the train's, never a find. */
  trainCargo?: {ownsPickup(p: never): boolean; ownsBag?(b: never): boolean; insideCar?(lx: number, ly: number, lz: number): boolean} | null;
  trainRuntime?: {train: {placement: ScanFrame & {railTopY: number}} | null} | null;
  trainEquipment?: EquipmentSystemLike | null;
  trainRide?: {riding: boolean} | null;
  frameHooks: ((dt: number) => void)[];
  interactHandlers: (() => boolean)[];
  sectionHooks: {build?(layout: never): void; teardown?(): void}[];
  promptProviders?: (() => string | null)[];
  stateListeners?: ((s: never, prev: never) => void)[];
  hitListeners?: ((hit: never) => void)[];
}

export interface ItemScannerOptions {
  /** The scope (default: the DOM one; tests pass one on a fake page). */
  scope?: ScannerScope;
}

export class ItemScannerSystem {
  readonly clock = new SweepClock();
  readonly scope: ScannerScope;
  /** The last snapshot of this world (null: none yet / a new world). */
  snap: ScanSnapshot | null = null;
  /** A scanner was active on the last frame. */
  active = false;
  /** The scanner whose scope is open (null: closed). */
  openUnit: EquipmentUnit | null = null;
  lastClose: ScannerClose | null = null;
  readonly counts = {sweeps: 0, opens: 0, closes: 0, worlds: 0};
  /** The model the scope draws (one object, refreshed in place). */
  private readonly view: ScannerModel = {active: false, snap: null, serial: 0, left: SCANNER.warmup};
  private checkT = 0;
  private limit: number = SCANNER.closeDist;

  constructor(readonly host: ScannerHost, opts: ItemScannerOptions = {}) {
    this.scope = opts.scope ?? new ScannerScope();
  }

  // --- registration --------------------------------------------------------------------------------------------------------------

  install(): this {
    const h = this.host, eq = h.trainEquipment;
    if (eq) {
      eq.uses.scanner = {prompt: u => this.prompt(u), tap: u => this.tap(u)};
      eq.plugListeners.push((u, plugged) => { if (!plugged && this.openUnit === u) this.close('inactive'); });
    }
    h.frameHooks.push(dt => this.update(dt));
    // first in line: while the scope is open E closes it and does nothing else (as world/corpses.ts carrying / the Skyways car driving)
    h.interactHandlers.unshift(() => this.onInteract());
    h.promptProviders?.unshift(() => (this.openUnit ? SCANNER_TEXT.close : null));
    h.stateListeners?.push((s: string) => { if (s !== 'playing') this.close(s === 'dead' ? 'dead' : 'state'); });
    h.hitListeners?.push((hit: {amount?: number}) => { if (this.openUnit && (hit.amount ?? 1) > 0) this.close('hit'); });
    h.sectionHooks.push({build: () => this.newWorld(), teardown: () => this.newWorld()});
    return this;
  }

  // --- the world ------------------------------------------------------------------------------------------------------------------

  /** A world was built / torn down: the scope closes, the snapshot goes, the first sweep is armed. */
  newWorld(): void {
    this.close('teardown');
    this.snap = null;
    this.view.serial++;
    this.active = false;
    this.clock.arm();
    this.counts.worlds++;
  }

  /** Whether `u` works now: plugged in, and the train parked in a live world. */
  unitActive(u: EquipmentUnit): boolean {
    return u.plug !== null && !!this.host.trainEquipment && this.host.trainEquipment.active(u.kind) !== null;
  }

  /** ONE snapshot now (the positions at this instant), around the parked car. Null: no parked car to centre on (nothing changes). */
  sweep(): ScanSnapshot | null {
    const h = this.host, pl = h.trainRuntime?.train?.placement, cargo = h.trainCargo;
    if (!pl) return null;
    this.snap = takeSnapshot({
      enemies: h.zombies, pickups: h.pickups?.list, holders: h.containers?.all, bags: h.gear?.bags,
      cargoPickup: cargo ? p => cargo.ownsPickup(p as never) : undefined,
      cargoBag: cargo?.ownsBag ? b => cargo.ownsBag!(b as never) : undefined,
      cargoHolder: cargo?.insideCar ? c => { const q = worldToTrain(pl, c.prop.x, c.prop.y ?? pl.railTopY, c.prop.z); return cargo.insideCar!(q.x, q.y, q.z); } : undefined,
    }, pl);
    this.view.serial++;
    this.counts.sweeps++;
    return this.snap;
  }

  // --- per frame (active play only) -----------------------------------------------------------------------------------------------

  update(dt: number): void {
    const eq = this.host.trainEquipment;
    this.active = !!eq && eq.active('scanner') !== null;
    if (this.active && this.clock.tick(dt)) this.sweep();
    if (this.openUnit) this.updateOpen(dt);
  }

  private updateOpen(dt: number): void {
    const h = this.host, u = this.openUnit!;
    if (h.state !== 'playing') { this.close('state'); return; }
    if (!h.player.alive) { this.close('dead'); return; }
    if (h.trainRide?.riding) { this.close('ride'); return; }
    if (!this.unitActive(u)) { this.close('inactive'); return; }
    // (the distance at ~10 Hz: worldPose() hands out a new object)
    if ((this.checkT -= dt) <= 0) {
      this.checkT = 1 / SCANNER.redrawHz;
      if (this.distance(u) > this.limit) { this.close('away'); return; }
    }
    this.scope.draw(this.model());
  }

  /** The player's horizontal distance to the scanner (Infinity: it has no place in the world / it is on another level). */
  private distance(u: EquipmentUnit): number {
    const at = u.worldPose(), p = this.host.player;
    if (!at || Math.abs(p.y - at.y) > SCANNER.closeDy) return Infinity;
    return Math.hypot(p.x - at.x, p.z - at.z);
  }

  private model(): ScannerModel {
    const v = this.view;
    v.active = true;
    v.snap = this.snap;
    v.left = this.clock.left;
    return v;
  }

  // --- the console (E) ------------------------------------------------------------------------------------------------------------

  /** The console's look-at prompt (EquipmentUse.prompt). */
  prompt(u: EquipmentUnit): string {
    if (this.openUnit === u) return SCANNER_TEXT.close;
    return this.unitActive(u) ? SCANNER_TEXT.open(this.clock.seconds) : SCANNER_TEXT.unplugged;
  }

  /** E tapped on the unit (EquipmentUse.tap): toggle the scope. False (not plugged in): nothing happens. */
  tap(u: EquipmentUnit): boolean {
    if (this.openUnit === u) { this.close('key'); return true; }
    if (!this.unitActive(u)) return false;
    this.open(u);
    return true;
  }

  /** E (Game.interactHandlers, first): consumed exactly while the scope is open — it closes. */
  onInteract(): boolean {
    if (!this.openUnit) return false;
    this.close('key');
    return true;
  }

  open(u: EquipmentUnit): void {
    const h = this.host;
    if (h.state !== 'playing' || !h.player.alive) return;
    if (this.openUnit) this.close('key');
    this.openUnit = u;
    this.counts.opens++;
    // opened from wherever the console can be reached: walking off from THERE closes it
    const d = this.distance(u);
    this.limit = Math.max(SCANNER.closeDist, Number.isFinite(d) ? d + 0.4 : 0);
    this.checkT = 1 / SCANNER.redrawHz;
    this.scope.open();
    this.scope.draw(this.model());
  }

  close(why: ScannerClose): void {
    if (!this.openUnit) return;
    this.openUnit = null;
    this.lastClose = why;
    this.counts.closes++;
    this.scope.close();
  }

  // --- QA -------------------------------------------------------------------------------------------------------------------------

  /** QA / tests: a compact report. */
  qa(): {active: boolean; open: boolean; nextSweepIn: number; sweeps: number; blips: {enemy: number; item: number; gear: number} | null;
    seen: ScanSnapshot['seen'] | null; dropped: ScanSnapshot['dropped'] | null; lastClose: ScannerClose | null; draws: number} {
    const s = this.snap, eq = this.host.trainEquipment;
    return {
      active: !!eq && eq.active('scanner') !== null, open: !!this.openUnit, nextSweepIn: +this.clock.left.toFixed(2), sweeps: this.clock.sweeps,
      blips: s ? {enemy: s.enemy.length, item: s.item.length, gear: s.gear.length} : null, seen: s ? {...s.seen} : null, dropped: s ? {...s.dropped} : null,
      lastClose: this.lastClose, draws: this.scope.draws,
    };
  }
}

/** Installs the scanner (one call in the Game constructor, after the train equipment; registries only). No cast: the compiler checks Game against ScannerHost. */
export function installItemScanner(game: Game): ItemScannerSystem {
  return new ItemScannerSystem(game).install();
}

/** QA (window.__LL, qa.ts): scanner() — the state; DEBUG scannerSweep() — a sweep now around the parked train (the countdown restarts). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function scannerQaApi(game: unknown): Record<string, (...a: any[]) => unknown> {
  const g = game as {itemScanner?: ItemScannerSystem};
  return {
    /** The scanner: active, the scope open, seconds to the next sweep, sweeps in this world, the last snapshot's blips / things seen / cells cut. */
    scanner: () => g.itemScanner?.qa() ?? null,
    /** DEBUG: take a sweep now, plugged in or not (false: no parked train); the countdown starts over. */
    scannerSweep: () => {
      const s = g.itemScanner;
      if (!s || !s.sweep()) return false;
      s.clock.left = SCANNER.period;
      s.clock.sweeps++;
      return s.qa();
    },
  };
}
