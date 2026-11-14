// Task studio-train-crafting-v1-20261111-225628-01 (lane SCANNER; user: "Item/enemy scanner: … A movable plugged console opens a
// black/green 360-degree radar around the train, approximately 100m range. About every 30 active seconds a sweep refreshes snapshot
// blips … No floorplan/map or continuous live tracking; it should give broad awareness rather than precise navigation." / "radar/scanner
// have no new battery or fuel upkeep."): THE SCANNER'S RUNTIME (Game.itemScanner). The rules and every number are craft/scanner.ts
// (SCANNER, takeSnapshot, scanBlips, SweepClock); the scope is ui/scannerView.ts (drawScanner, ScannerScope). The scanner as a physical
// unit — the hand truck, the plugs, moving it — is the equipment system's (world/trainEquipment.ts): this module only reads
// craft/equipmentApi.ts EquipmentSystemLike (active('scanner'), a unit's plug / worldPose / display) and registers its own use
// (`uses.scanner`) and a plug listener there.
//
// Task studio-scanner-console-refinements-20261114-031614-01 (user: "cycle through exactly this order: All → Food/Water → Ammo → Fuel →
// Weapon → Equipment → Material → All. ALL means all RESOURCES ONLY … Provide a clear mode label and straightforward cycling control in
// the existing scanner UI without breaking quick-E/hold-E dragging, rotation or normal UI input ownership … Filter the captured resource
// snapshot when changing mode rather than inventing live tracking or an extra scan. Handle old scanner records safely with an All
// default; persist the selected mode appropriately."): a RESOURCE scanner with MODES —
//  - the mode is the scanner UNIT's own (EquipmentUnit.display: one of craft/scanner.ts SCAN_MODES; ALL when its record has none): it
//    is saved with the unit's equipment record, so it rides along, survives a save / Continue / Retry / import-export with the unit,
//    and every older record (no mode) opens on ALL;
//  - while a scope is open, X (SCANNER.modeKey — bound to nothing else in play) cycles THAT unit's mode one step. The key is read only
//    then: E keeps its own rules (a tap opens / closes the scope, a hold drags the hand truck, R turns a grabbed one — the equipment
//    system's), the mouse, movement and every other key stay the player's, nothing is paused, no input owner is registered;
//  - a mode change re-filters the snapshot already captured (scanBlips) and redraws: no sweep, no read of the world, no live tracking.
//
// installItemScanner(game) is called ONCE from the Game constructor (after the train equipment); it only REGISTERS:
//  - trainEquipment.uses.scanner: a TAP of E anywhere on the unit — the prompt line and the tap that opens / closes the scope
//    (holding E drags the hand truck: the equipment system's own rule, never asked here);
//  - frameHooks (they run in active play only: not paused, not in a menu, not in the gap between two stations): the sweep clock ticks
//    while a scanner is ACTIVE (plugged into the PARKED train in a live world: not unplugged, not on the ride) and takes one snapshot
//    when a sweep is due; the open scope's close rules, its mode key and its redraw;
//  - interactHandlers / promptProviders (both FIRST: while the scope is open E only closes it — it never also takes an item or opens a
//    container — and the prompt says so, with the mode key); stateListeners / hitListeners / plugListeners (close); sectionHooks (a new
//    world).
//
// SWEEPS: every SCANNER.period ACTIVE seconds one snapshot of the world's RESOURCES at once (takeSnapshot: the loose pickups, the holders
// that still hold lots, the grounded bags, the stations' fuel carts with fuel; within SCANNER.range of the car's centre, every storey
// flattened, the train's own cargo and market wares left out; no enemy is read). Between sweeps NOTHING on the scope moves: no live
// tracking. Unplugging / replugging neither resets nor advances the clock (the elapsed part is kept: no free sweep). A NEW WORLD (station
// build, Retry, load, arrival) clears the snapshot and arms the first sweep SCANNER.warmup active seconds after a scanner is active
// there. The snapshot is never saved; no battery, fuel or other upkeep; a sweep makes no noise and alerts nothing.
//
// THE SCOPE (a DOM canvas over the game, pointer-events none): it does NOT pause the game and takes neither the mouse nor the movement
// keys — the player keeps full control. It closes on E (captured), Esc / Tab / any menu (the state leaves 'playing'), walking more than
// SCANNER.closeDist from the scanner, a hit, death, the scanner no longer active (unplugged / grabbed / the ride starting) and a
// teardown. A scanner that is not plugged in has no scope: its prompt says so and a tap of E does nothing (holding E drags it, as ever).

import type {Game} from '../game';
import type {EquipmentSystemLike, EquipmentUnit} from '../craft/equipmentApi';
import {
  SCANNER, SCAN_DEFAULT_MODE, SCAN_MODES, SCAN_MODE_LABEL, SweepClock, isScanMode, nextScanMode, scanBlips, takeSnapshot,
  type ScanBag, type ScanBlip, type ScanCart, type ScanFrame, type ScanHolder, type ScanMode, type ScanPickup, type ScanSnapshot,
} from '../craft/scanner';
import {worldToTrain} from '../gen/playerTrain';
import {MODE_KEY_LABEL, ScannerScope, type ScannerModel} from '../ui/scannerView';

/** Prompt texts. */
export const SCANNER_TEXT = {
  open: (seconds: number, mode: ScanMode = SCAN_DEFAULT_MODE) => `<b>[E]</b> Scanner scope · ${SCAN_MODE_LABEL[mode]} · next sweep in ${seconds} s`,
  close: (mode: ScanMode = SCAN_DEFAULT_MODE) => `<b>[E]</b> Close the scanner scope · <b>[${MODE_KEY_LABEL}]</b> Mode: ${SCAN_MODE_LABEL[mode]}`,
  unplugged: 'Item scanner — plug it into a train socket',
} as const;

/** Why the scope closed (QA / tests). */
export type ScannerClose = 'key' | 'state' | 'dead' | 'hit' | 'away' | 'inactive' | 'ride' | 'teardown';

/** What the scanner needs from Game (structural: Node tests drive it with fakes). Lists are read at sweep time, never kept. */
export interface ScannerHost {
  state: string;
  player: {x: number; y: number; z: number; alive: boolean};
  pickups?: {readonly list: readonly ScanPickup[]} | null;
  containers?: {readonly all: readonly ScanHolder[]} | null;
  gear?: {readonly bags: readonly ScanBag[]} | null;
  /** The fuel carts (world/fuelCarts.ts): a station's cart with fuel in it is a resource; the train's own never is. */
  fuelCarts?: {all(): readonly ScanCart[]} | null;
  /** The train's loose cargo (world/trainCargo.ts): what lies in the parked car is the train's, never a find. */
  trainCargo?: {ownsPickup(p: never): boolean; ownsBag?(b: never): boolean; insideCar?(lx: number, ly: number, lz: number): boolean} | null;
  trainRuntime?: {train: {placement: ScanFrame & {railTopY: number}} | null} | null;
  trainEquipment?: EquipmentSystemLike | null;
  trainRide?: {riding: boolean} | null;
  /** The keyboard (player/input.ts Input): the mode key is read only while a scope is open. */
  input?: {hit?(code: string): boolean} | null;
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

/** A unit's mode (its display; anything else — a fake, a kind without modes — shows ALL). */
export const scanModeOf = (u: EquipmentUnit | null | undefined): ScanMode => (u && isScanMode(u.display) ? u.display : SCAN_DEFAULT_MODE);

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
  readonly counts = {sweeps: 0, opens: 0, closes: 0, worlds: 0, modes: 0, filters: 0};
  /** The model the scope draws (one object, refreshed in place). */
  private readonly view: ScannerModel = {active: false, mode: SCAN_DEFAULT_MODE, blips: null, serial: 0, left: SCANNER.warmup};
  /** The snapshot filtered for one mode (refiltered only when the snapshot or the mode changed). */
  private readonly filtered: {snap: ScanSnapshot | null; mode: ScanMode | ''; blips: ScanBlip[]; dropped: number} = {snap: null, mode: '', blips: [], dropped: 0};
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
    h.promptProviders?.unshift(() => (this.openUnit ? SCANNER_TEXT.close(scanModeOf(this.openUnit)) : null));
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
      pickups: h.pickups?.list, holders: h.containers?.all, bags: h.gear?.bags, carts: h.fuelCarts?.all(),
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
    if (h.input?.hit?.(SCANNER.modeKey)) this.cycleMode();
    this.scope.draw(this.model());
  }

  /** The player's horizontal distance to the scanner (Infinity: it has no place in the world / it is on another level). */
  private distance(u: EquipmentUnit): number {
    const at = u.worldPose(), p = this.host.player;
    if (!at || Math.abs(p.y - at.y) > SCANNER.closeDy) return Infinity;
    return Math.hypot(p.x - at.x, p.z - at.z);
  }

  /** The current snapshot as `mode` shows it (the filter: re-run only when the snapshot or the mode changed; never a sweep). */
  filter(mode: ScanMode): {blips: ScanBlip[]; dropped: number} | null {
    const f = this.filtered, s = this.snap;
    if (!s) return null;
    if (f.snap !== s || f.mode !== mode) {
      const r = scanBlips(s, mode);
      f.snap = s; f.mode = mode; f.blips = r.blips; f.dropped = r.dropped;
      this.counts.filters++;
    }
    return f;
  }

  private model(): ScannerModel {
    const v = this.view, mode = scanModeOf(this.openUnit);
    v.active = true;
    v.mode = mode;
    v.blips = this.filter(mode)?.blips ?? null;
    v.left = this.clock.left;
    return v;
  }

  // --- the console (E) and the mode key ---------------------------------------------------------------------------------------------

  /** The console's look-at prompt (EquipmentUse.prompt). */
  prompt(u: EquipmentUnit): string {
    if (this.openUnit === u) return SCANNER_TEXT.close(scanModeOf(u));
    return this.unitActive(u) ? SCANNER_TEXT.open(this.clock.seconds, scanModeOf(u)) : SCANNER_TEXT.unplugged;
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

  /**
   * The mode key on the open scope: that unit's mode one step on (All → Food/Water → … → Material → All), kept on the unit (its record);
   * the captured snapshot is re-filtered and redrawn at once. Null: no scope open (nothing changed).
   */
  cycleMode(): ScanMode | null {
    const u = this.openUnit;
    if (!u) return null;
    const next = nextScanMode(scanModeOf(u));
    if (!u.setDisplay(next)) return null;
    this.counts.modes++;
    this.scope.draw(this.model());
    return next;
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

  /** QA / tests: a compact report (`mode`: the open scope's, else the active scanner's; `blips` / `dropped`: dots per mode of the snapshot). */
  qa(): {active: boolean; open: boolean; mode: ScanMode; nextSweepIn: number; sweeps: number; blips: Record<ScanMode, number> | null;
    seen: ScanSnapshot['seen'] | null; dropped: Record<ScanMode, number> | null; lastClose: ScannerClose | null; draws: number; modeChanges: number} {
    const s = this.snap, eq = this.host.trainEquipment, act = eq?.active('scanner') ?? null;
    let blips: Record<ScanMode, number> | null = null, dropped: Record<ScanMode, number> | null = null;
    if (s) {
      blips = {} as Record<ScanMode, number>; dropped = {} as Record<ScanMode, number>;
      for (const m of SCAN_MODES) { const r = scanBlips(s, m); blips[m] = r.blips.length; dropped[m] = r.dropped; }
    }
    return {
      active: act !== null, open: !!this.openUnit, mode: scanModeOf(this.openUnit ?? act), nextSweepIn: +this.clock.left.toFixed(2), sweeps: this.clock.sweeps,
      blips, seen: s ? {...s.seen} : null, dropped, lastClose: this.lastClose, draws: this.scope.draws, modeChanges: this.counts.modes,
    };
  }
}

/** Installs the scanner (one call in the Game constructor, after the train equipment; registries only). No cast: the compiler checks Game against ScannerHost. */
export function installItemScanner(game: Game): ItemScannerSystem {
  return new ItemScannerSystem(game).install();
}

/**
 * QA (window.__LL, qa.ts): scanner() — the state; scannerMode() — the open scope's mode one step on (as its key does); DEBUG
 * scannerSweep() — a sweep now around the parked train (the countdown restarts).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function scannerQaApi(game: unknown): Record<string, (...a: any[]) => unknown> {
  const g = game as {itemScanner?: ItemScannerSystem};
  return {
    /** The scanner: active, the scope open, seconds to the next sweep, sweeps in this world, the last snapshot's blips / things seen / cells cut. */
    scanner: () => g.itemScanner?.qa() ?? null,
    /** The open scope's mode one step on, exactly as its key does (false: no scope open); the state after. */
    scannerMode: () => (g.itemScanner?.cycleMode() ? g.itemScanner.qa() : false),
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
