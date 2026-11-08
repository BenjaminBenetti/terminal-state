// Task studio-market-bar-20261108-225231-01 (lane BEER): THE BEER EFFECTS — Game.beerEffects (market/beer/effectsApi.ts BeerEffectsApi).
//
// User (verbatim, controlling): "Speed beer +25% run speed 10 min, 20 ties. Pickup beer 10% duplicate chance 10 min, 20 ties. Temporary
// armor beer 5 armor 10 min, 20 ties. Detection beer 25% harder to detect 10 min, 20 ties. Food/water beer sets both to 200%, 40 ties;
// overlapping green overfill bar. Only 1 timed beer active; food/water beer isn't an effect. A second timed beer makes player vomit".
// Final answers: armour = 5 PIPS (0.125 absolute); a second timed beer (the same one too) REPLACES the old buff, with the vomiting.
//
//  - drink(itemId) is THE commit, called once by Game.completeUse after the stack's unit was consumed (the existing consume flow — its
//    selected uid, final-unit consumable return, LMB latch, manual cancel and missing-source safety — is unchanged; nothing here runs on
//    purchase, equip, hover or cancel). A TIMED beer takes the one slot {itemId, remaining = BEER_TUNING.activeSeconds}; with a timed beer
//    already active (any, the same one too) Game.vomit.start() runs first (the VOMIT action; absent: no animation) and the new beer
//    REPLACES the old one with a fresh 600 s. Second Supper Bock is INSTANT: Survival.overfill SETS food and water to 200 — it never
//    touches the slot and never makes the player throw up.
//  - The slot ticks in a frame hook — Game.update runs only in live play (state 'playing'; pause, inventory, menus, the map, death, the
//    win screen and the travel gap stop it) — the survival clock's own rule (player/survival.ts survivalTicks). The run participant
//    'market.beer' (market/beer/beerSave.ts) saves the remaining seconds exactly with every save / Continue / Retry snapshot / import /
//    export / pending journey; buying another bottle never touches it.
//  - Express Line Lager: speedMult() 1.25 as ONE ModifierSource (player/modifiers.ts: multiplied once into Game.mods.speedMult, the
//    player's walk / sprint / crouch / aim speed together; injuries / gear / weight / collision still apply; stamina untouched). It
//    never moves the train, a car or the AI, and pulling a fuel cart keeps the cart's own pace (no beer boost while one is grabbed).
//  - Lucky Switch Pilsner: acquired() — the ONE shared acquisition hook (Game.interact world pickups, the holders' taken lots, the
//    market's stolen wares, a generated grounded backpack): an eligible source never rolled before rolls ONCE, durably (its key hash
//    joins `rolled`, saved), deterministically per run + source (a reload cannot re-roll it), 10 %. A success adds a clone of exactly
//    what was taken with FRESH uids (bag contents too) through the inventory's normal add; what does not fit lies at the player's feet
//    as an ordinary pickup (a backpack: an ordinary grounded bag) with a toast. Never: trades / purchases, Rail Ties, reactor parts, the
//    bonus itself, the player's own dropped / split / merged / moved items (no generated origin), the wallet migration.
//  - Ironclad Stout: tempArmor() 0.125 (= 5 pips), added by Game.applyPlayerHit into the ONE worn armour pool (player/armor.ts armorHit
//    `temp`: same cap, same injury save; wear only ever lowers a worn item) and shown by the HUD's pips (armorTemp).
//  - Night Shift Porter: perceptionMult() 0.75 — the ONE detectability factor (ai/brain.ts BrainWorld.detect: an unaware zombie's
//    notice distances, the player's noise radius); the market's people read it here (the PEOPLE lane).
import {BEERS, BEER_TUNING, beerEffectText, isBeer, type BeerId, type TimedBeerEffect} from '../../items/beers';
import {ITEMS} from '../../items/items';
import {isBagItem} from '../../items/gear';
import {stackFromJSON, stackToJSON, type ItemStack} from '../../items/inventory';
import {hashString} from '../../core/rng';
import {survivalTicks} from '../../player/survival';
import type {RunParticipant} from '../../run/snapshot';
import type {AcquireSource, ActiveBeer, BeerEffectsApi, VomitApi} from './effectsApi';
import {BEER_PARTICIPANT, BEER_ROLLED_MAX, beerSaveProblem, type BeerSaveV1} from './beerSave';

/** What the beer effects need from Game (structural: Node tests drive it with a plain host). */
export interface BeerHost {
  survival: {overfill(level?: number): {hunger: number; thirst: number}};
  inv: {allocUid(): number; add(s: ItemStack): number};
  player: {x: number; y: number; z: number; yaw: number};
  state: string;
  hud: {toast(text: string, warn?: boolean): void};
  /** The VOMIT lane's throw-up action (read at the moment of the second beer; absent: the buff is still replaced). */
  vomit?: VomitApi | null;
  run?: {current?: {level: string; section: string; station?: string}; seeds?: {subway?: number}} | null;
  frameHooks: ((dt: number) => void)[];
  runParticipants?: RunParticipant[];
  modifierSources?: (() => {speedMult?: number})[];
  /** A grabbed fuel cart keeps its own pace (world/fuelCarts.ts). */
  fuelCarts?: {grab: unknown} | null;
  pickups?: {add(stack: ItemStack, x: number, y: number, z: number, yaw?: number): unknown} | null;
  levels?: {count: number; stepAt(x: number, z: number, y: number): number; levelAt(x: number, z: number, y: number): number} | null;
  layout?: {grid?: {stepAt(x: number, z: number): number}} | null;
  gear?: {adoptBag?(id: string, stack: ItemStack, pose: {x: number; y: number; z: number; yaw: number; level: number}): unknown} | null;
  trainRide?: {riding: boolean} | null;
  trainCargo?: {dropRiding?(st: ItemStack): boolean} | null;
  sfx?: {pickup?(): void} | null;
  syncHeld?(): void;
}

const NO_MODS = Object.freeze({});
const SPEED_MODS = Object.freeze({speedMult: BEER_TUNING.speedMult});

/** murmur3's 32-bit finaliser (spreads FNV's low-entropy bits). */
function fmix32(h: number): number {
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** The durable roll memory's id of a source key (uint32). */
export const sourceHash = (key: string): number => fmix32(hashString(key));

/** The roll of a source in [0, 1): a pure function of the run's seed and the source (the same source never rolls differently). */
export const dupRoll = (seed: number, key: string): number => fmix32(hashString(key, (seed ^ 0x9e3779b9) >>> 0)) / 4294967296;

/**
 * The key of an acquisition source within its station section (`scope`), or null when the source is not eligible: a world pickup with no
 * generated origin (the player's own drop, a bonus at the feet, train cargo …) or a grounded backpack that is not an untouched find.
 * A lot shot / spilled off its holder keys like the same lot taken from the holder (one roll for both).
 */
export function sourceKey(scope: string, s: AcquireSource): string | null {
  switch (s.kind) {
    case 'lot': return `${scope}|lot:${s.holder}#${s.lot}`;
    case 'pickup': return s.layoutIndex !== undefined ? `${scope}|pick:${s.layoutIndex}` : s.lot ? `${scope}|lot:${s.lot.holder}#${s.lot.lot}` : null;
    case 'ware': return `${scope}|ware:${s.stall}:${s.uid}`;
    case 'bag': return s.id.startsWith('found:') && s.empty ? `${scope}|bag:${s.id}` : null;
  }
}

/** Items the Pilsner may double: anything but the market's money (Rail Ties) and the reactor's restart parts (and unknown ids). */
export function dupEligibleItem(itemId: string): boolean {
  const k = ITEMS[itemId]?.kind;
  return k !== undefined && k !== 'currency' && k !== 'part';
}

/** A deep copy of a stack with FRESH uids from `alloc` (its bag contents too): never aliasing the original. */
export function cloneFresh(st: ItemStack, alloc: () => number, count = st.count): ItemStack {
  const c = stackFromJSON(stackToJSON(st))!;
  const renew = (s: ItemStack): void => {
    s.uid = alloc();
    if (s.bag) for (const x of s.bag) if (x) renew(x);
  };
  renew(c);
  c.count = count;
  return c;
}

/** "Bandage", "3 × Bandage". */
const label = (st: {itemId: string; count: number}): string => `${st.count > 1 ? `${st.count} × ` : ''}${ITEMS[st.itemId]?.name ?? st.itemId}`;
/** A timed beer's toast effect line ("+25 % ground speed for 10 min"). */
const toastFx = (id: BeerId): string => beerEffectText(id).replace(/ \(timed beer\)$/, '');

export class BeerEffects implements BeerEffectsApi {
  /** The one timed beer (null: none). */
  private slot: {itemId: BeerId; remaining: number} | null = null;
  /** The Pilsner's durable roll memory (source hashes, oldest first) and its set. */
  private rolled: number[] = [];
  private readonly rolledSet = new Set<number>();
  /** QA / tests. */
  readonly counts = {drinks: 0, timed: 0, overfills: 0, replaced: 0, vomits: 0, expired: 0, rolls: 0, dups: 0, atFeet: 0};
  lastDup: {key: string; itemId: string; count: number; atFeet: number} | null = null;

  constructor(readonly host: BeerHost) {}

  install(): this {
    const h = this.host;
    h.frameHooks.push(dt => { if (survivalTicks(h.state)) this.tick(dt); });
    h.runParticipants?.push(this.participant());
    // Express Line Lager: ONE modifier source (multiplied once into Game.mods.speedMult); a grabbed fuel cart keeps its own pace
    h.modifierSources?.push(() => (this.speedMult() !== 1 && !h.fuelCarts?.grab ? SPEED_MODS : NO_MODS));
    return this;
  }

  // ---------------------------------------------------------------------------------------------------------------------
  // The slot and its effects (BeerEffectsApi)

  get active(): ActiveBeer | null {
    const s = this.slot;
    return s ? {itemId: s.itemId, effect: BEERS[s.itemId].effect as TimedBeerEffect, remaining: s.remaining} : null;
  }

  private effect(): TimedBeerEffect | null {
    return this.slot ? (BEERS[this.slot.itemId].effect as TimedBeerEffect) : null;
  }

  speedMult(): number { return this.effect() === 'speed' ? BEER_TUNING.speedMult : 1; }
  perceptionMult(): number { return this.effect() === 'stealth' ? BEER_TUNING.perceptionMult : 1; }
  tempArmor(): number { return this.effect() === 'armor' ? BEER_TUNING.tempArmor : 0; }

  /** THE consume commit of one beer (see the header). Returns the toast line. */
  drink(itemId: BeerId): string {
    if (!isBeer(itemId)) return '';
    const spec = BEERS[itemId];
    this.counts.drinks++;
    if (spec.effect === 'overfill') {
      this.host.survival.overfill(BEER_TUNING.overfill);
      this.counts.overfills++;
      return `Drank ${spec.name}: food and water ${BEER_TUNING.overfill} %`;
    }
    const prev = this.slot;
    if (prev) {
      // a second timed beer (any, the same one too): the throw-up first, then the new one REPLACES the old (a fresh 600 s)
      let threw = false;
      try { threw = this.host.vomit?.start() ?? false; } catch (err) { console.warn('beer: vomit.start failed', err); }
      if (threw) this.counts.vomits++;
      this.counts.replaced++;
    }
    this.slot = {itemId, remaining: BEER_TUNING.activeSeconds};
    this.counts.timed++;
    return prev ? `You threw up — ${spec.name} replaces ${BEERS[prev.itemId].name}: ${toastFx(itemId)}` : `Drank ${spec.name}: ${toastFx(itemId)}`;
  }

  /** Active gameplay seconds pass (the frame hook; only in live play). */
  tick(dt: number): void {
    const s = this.slot;
    if (!s || !(dt > 0)) return;
    s.remaining -= dt;
    if (s.remaining > 0) return;
    this.slot = null;
    this.counts.expired++;
    this.host.hud.toast(`${BEERS[s.itemId].name} wore off`);
  }

  // ---------------------------------------------------------------------------------------------------------------------
  // Lucky Switch Pilsner: the one acquisition hook

  /** The live station section (the key scope). */
  private scope(): string {
    const c = this.host.run?.current;
    return c ? `${c.station ?? c.level}:${c.section}` : 'run';
  }

  private remember(h: number): void {
    this.rolled.push(h);
    this.rolledSet.add(h);
    while (this.rolled.length > BEER_ROLLED_MAX) this.rolledSet.delete(this.rolled.shift()!);
  }

  /** Has this source already been rolled in this run? (QA / tests) */
  hasRolled(source: AcquireSource): boolean {
    const key = sourceKey(this.scope(), source);
    return !!key && this.rolledSet.has(sourceHash(key));
  }

  acquired(source: AcquireSource, taken: ItemStack): void {
    if (this.effect() !== 'pickup' || !taken || !(taken.count > 0) || !dupEligibleItem(taken.itemId)) return;
    const key = sourceKey(this.scope(), source);
    if (!key) return;
    const h = sourceHash(key);
    if (this.rolledSet.has(h)) return; // rolled once already (re-grabbing never re-rolls)
    this.remember(h);
    this.counts.rolls++;
    if (dupRoll(this.host.run?.seeds?.subway ?? 0, key) >= BEER_TUNING.pickupDupChance) return;
    this.give(key, cloneFresh(taken, () => this.host.inv.allocUid()));
  }

  /** The bonus through the inventory's normal add; what does not fit lies at the player's feet (never lost, never charged). */
  private give(key: string, bonus: ItemStack): void {
    const h = this.host, n = bonus.count, what = label(bonus);
    const left = h.inv.add(bonus);
    this.counts.dups++;
    let atFeet = 0;
    if (left > 0) {
      bonus.count = left; // (the part inv.add did not take: it only ever stores copies of a partly added stack)
      if (this.placeAtFeet(bonus)) atFeet = left;
      this.counts.atFeet += atFeet;
    }
    this.lastDup = {key, itemId: bonus.itemId, count: n, atFeet};
    h.sfx?.pickup?.();
    h.syncHeld?.();
    h.hud.toast(atFeet ? `Lucky Switch: a second ${what}! No room — it is at your feet` : `Lucky Switch: a second ${what}!`);
  }

  /** An ordinary player-reachable world item at the player's feet (a backpack: an ordinary grounded bag); on the moving train: its cargo. */
  private placeAtFeet(st: ItemStack): boolean {
    const h = this.host, p = h.player;
    if (h.trainRide?.riding && h.trainCargo?.dropRiding?.(st)) return true;
    let y = p.y, level = 0;
    const L = h.levels;
    if (L && L.count > 1) {
      const s = L.stepAt(p.x, p.z, p.y + 0.05);
      if (Number.isFinite(s)) y = s;
      level = Math.max(0, L.levelAt(p.x, p.z, y + 0.05));
    } else {
      const s = h.layout?.grid?.stepAt(p.x, p.z);
      if (s !== undefined && Number.isFinite(s)) y = s;
    }
    if (isBagItem(st.itemId) && h.gear?.adoptBag) { h.gear.adoptBag(`bag:${st.uid}`, st, {x: p.x, y, z: p.z, yaw: p.yaw, level}); return true; }
    if (!h.pickups) return false;
    h.pickups.add(st, p.x, y, p.z, p.yaw);
    return true;
  }

  // ---------------------------------------------------------------------------------------------------------------------
  // The run participant 'market.beer'

  save(): BeerSaveV1 {
    return {v: 1, active: this.slot ? {itemId: this.slot.itemId, remaining: this.slot.remaining} : null, rolled: [...this.rolled]};
  }

  load(d: unknown): void {
    const p = beerSaveProblem(d);
    this.reset();
    if (p) { console.warn(`beer: run record ignored (${p})`); return; }
    const r = d as BeerSaveV1;
    this.slot = r.active ? {itemId: r.active.itemId, remaining: r.active.remaining} : null;
    for (const h of r.rolled) this.remember(h);
  }

  reset(): void {
    this.slot = null;
    this.rolled = [];
    this.rolledSet.clear();
  }

  participant(): RunParticipant {
    return {id: BEER_PARTICIPANT, save: () => this.save(), load: d => this.load(d), reset: () => this.reset()};
  }

  /** QA: the slot, the roll memory size, the counters, the last bonus. */
  qa() {
    return {active: this.active, rolled: this.rolled.length, counts: {...this.counts}, lastDup: this.lastDup,
      mods: {speed: this.speedMult(), perception: this.perceptionMult(), tempArmor: this.tempArmor()}};
  }
}

/** Installs Game.beerEffects (one call in the Game constructor). */
export function installBeerEffects(game: unknown): BeerEffects {
  const sys = new BeerEffects(game as BeerHost).install();
  (game as {beerEffects?: BeerEffectsApi}).beerEffects = sys;
  return sys;
}
