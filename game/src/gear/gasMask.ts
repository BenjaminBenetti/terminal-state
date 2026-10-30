// Task gasmask-breach-20261030 (mask lane): the GAS MASK system — Q on / off, filter charge, auto-fitting spares, the HUD Q slot
// state and the camera mask overlay.
//
// installGasMask(game, access) is called ONCE from the Game constructor (after installGear); it only REGISTERS into the
// iteration-16 registries, like installGear / installInjuries:
// - frameHooks: the state machine (play dt only), filter drain, auto-fit, warnings, HUD Q slot + camera overlay;
// - inputOwners: no fire / ADS / melee / flare / click-use while the mask goes on or comes off (a running reload continues);
// - stateListeners + sectionHooks: any state but 'playing' (pause, Tab, death, loading) and every section build / teardown
//   (travel, Retry, NewGame) cancel a transition — it ends OFF (a donning mask goes back off, a doffing one finishes off);
// - runParticipants: lane 'gas.mask' = whether the mask is ON the face (Retry restores it, NewGame resets it to off);
// - invUI.gear.changed (wrapped): taking the mask off / swapping / dropping it in the inventory screen forces it off;
// - warmRegistry pool 'gas-mask': a hidden filter-canister prototype (a dropped / carried-over filter never compiles cold; the
//   mask itself is in the gear pool with every gear model).
//
// EQUIPPED != ON THE FACE. The mask worn in the gear slot 'mask' is equipped (a picked-up mask goes there when it is empty, OFF
// the face). Q (game.ts -> press()) toggles the face state: off -> donning (GAS_MASK.donS) -> on -> doffing (GAS_MASK.doffS)
// -> off. The selected slot / weapon / magazine never change.
// Q ARBITRATION: only while playing and alive; ignored mid-transition, during a committed knife swing (a held, unreleased windup
// is dropped instead: knife-windup-20261030), while the grounded-bag transfer view (or an E hold on a bag) owns input. No mask equipped: "No gas mask" toast + sfx.denied(), nothing created. Otherwise it
// cancels a timed use (eat / drink / bandage) and a G flare hold, slings a readied backpack (6) back on through the gear
// system's own path, then starts the transition. (The elevator panels are in-world buttons — a click, not a mode — so they own
// no input Q could collide with.)
// FILTER: the fitted filter's seconds live on the MASK'S STACK (`ItemStack.filter`, persisted in StackJSON), so off / on,
// unequip / re-equip, swapping masks, drop / pick-up, travel and Retry can never refill or duplicate it. It drains only while
// the mask is fully ON, in play dt (frame hooks never run in menus, loading, warm-up or death; a guard re-checks), gas or not.
// At 0 (or donned with 0) one `gas_filter` is taken with inv.take — quick slots + pockets + grenade slot only, NEVER a worn
// backpack's contents — fitted instantly (sfx.batteryInsert + "Filter changed — N spare"). Low (<= 20 %) and empty warnings.
// PROTECTION (protects()): fully on the face AND the fitted filter > 0. Donning is unprotected until complete, doffing at once;
// an on-face mask with an empty filter is UNPROTECTED. The gas lane asks game.gasMask.protects() once per frame.

import type * as THREE from 'three';
import type {Game} from '../game';
import {FILTER_LIFE_S, isFilterMask} from '../items/gear';
import {makeSupplyMesh} from '../world/pickups';
import type {ItemStack} from '../items/inventory';
import type {RunParticipant} from '../run/snapshot';
import {MaskOverlay, type MaskTone} from '../ui/maskOverlay';

/** Gas-mask tuning (first pass; all in one place). */
export const GAS_MASK = {
  /** Seconds one filter lasts on the face (items/gear.ts FILTER_LIFE_S = 150). */
  filterLifeS: FILTER_LIFE_S,
  /** Pulling the mask on (unprotected until done). */
  donS: 0.6,
  /** Taking it off (unprotected at once). */
  doffS: 0.45,
  /** "Filter low" at or below this fraction of one filter (amber). */
  lowFrac: 0.2,
  /** The spare-filter item drawn automatically. */
  filterItem: 'gas_filter',
  /** RunParticipant id (Retry restores the on-face flag, NewGame resets it). */
  lane: 'gas.mask',
} as const;

export type MaskState = 'off' | 'donning' | 'on' | 'doffing';
/** What a Q press did. */
export type MaskPress = 'donning' | 'doffing' | 'no-mask' | 'ignored';

/** The HUD Q slot's live view (ui/hud.ts setMask). */
export interface MaskHudView {
  state: MaskState;
  /** 0 = off the face .. 1 = fully on (the transition's progress). */
  cover: number;
  protects: boolean;
  tone: MaskTone;
}

/** Game internals the mask needs (private there; handed over by the Game constructor like installInjuries' access). */
export interface GasMaskAccess {
  cancelUse(reason: string): void;
  cancelFlareHold(): void;
}

interface GearLike {
  readied?: boolean;
  viewOpen?: boolean;
  holdProgress?: number | null;
  cancelReady?(resync: boolean): void;
}

interface HostRegistries {
  stateListeners?: ((s: string, prev: string) => void)[];
  inputOwners?: (() => boolean)[];
  runParticipants?: RunParticipant[];
  invUI?: {gear: {dropBag(): string | null; changed(): void} | null};
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

export class GasMaskSystem {
  state: MaskState = 'off';
  /** Seconds into the running transition. */
  t = 0;
  /** Uid of the mask stack this face state belongs to (-1 none). */
  private faceUid = -1;
  private wornUid = -1;
  private lowWarned = false;
  private emptyWarned = false;
  /** inv.version of the last failed spare draw (no retry until the inventory changes). */
  private drawFailedAt = -1;
  private protos: THREE.Object3D[] | null = null;
  /** The HUD view (one object, refreshed in place every frame). */
  private readonly view: MaskHudView = {state: 'off', cover: 0, protects: false, tone: 'ok'};
  readonly overlay = new MaskOverlay();

  constructor(private readonly game: Game, private readonly access: GasMaskAccess) {}

  // --- registration --------------------------------------------------------------------------------------------------

  install(): this {
    const g = this.game;
    const reg = g as unknown as HostRegistries;
    g.frameHooks.push(dt => this.update(dt));
    g.sectionHooks.push({build: () => this.cancelTransition(), teardown: () => this.cancelTransition()});
    reg.stateListeners?.push(s => { if (s !== 'playing') this.cancelTransition(); });
    reg.inputOwners?.push(() => this.transitioning);
    reg.runParticipants?.push(this.participant());
    g.warmRegistry.addPool('gas-mask', () => this.warmPrototypes());
    const ui = reg.invUI;
    const prev = ui?.gear;
    if (ui && prev) ui.gear = {...prev, changed: () => { prev.changed(); this.checkWorn(); }};
    return this;
  }

  /** RunParticipant 'gas.mask': only the on-face flag (the mask and its filter charge ride the Inventory). */
  participant(): RunParticipant {
    return {
      id: GAS_MASK.lane,
      save: () => ({v: 1, on: this.state === 'on'}),
      load: d => this.restore(!!(d as {on?: unknown} | null)?.on),
      reset: () => this.restore(false),
    };
  }

  /** Retry / NewGame: the face state as saved (on only with a mask equipped); no transition, warnings re-armed. */
  restore(on: boolean): void {
    const m = this.worn;
    this.state = on && m ? 'on' : 'off';
    this.t = 0;
    this.faceUid = m?.uid ?? -1;
    this.wornUid = m?.uid ?? -1;
    this.lowWarned = this.emptyWarned = false;
    this.drawFailedAt = -1;
    this.present();
  }

  // --- queries ---------------------------------------------------------------------------------------------------------

  /** The equipped mask (gear slot 'mask'), or null. */
  get worn(): ItemStack | null {
    const m = this.game.inv.worn('mask');
    return m && isFilterMask(m.itemId) ? m : null;
  }

  /** The mask is going on or coming off (inputs blocked). */
  get transitioning(): boolean {
    return this.state === 'donning' || this.state === 'doffing';
  }

  /** Fully on the face (transition complete) — protected only with filter charge (protects()). */
  get on(): boolean {
    return this.state === 'on';
  }

  /** Seconds left on the fitted filter of the equipped mask (0 without one). */
  get filterSeconds(): number {
    return Math.max(0, this.worn?.filter ?? 0);
  }

  /** Spare filters in accessible inventory (quick slots, pockets, grenade slot; never a worn backpack's contents). */
  get spares(): number {
    return this.game.inv.count(GAS_MASK.filterItem);
  }

  /** Mask on the face (transition complete) AND its fitted filter has charge: infectious gas does no damage. */
  protects(): boolean {
    const m = this.worn;
    return this.state === 'on' && !!m && m.uid === this.faceUid && (m.filter ?? 0) > 0;
  }

  /** 0 = off the face .. 1 = on (the overlay / transition progress). */
  get cover(): number {
    if (this.state === 'on') return 1;
    if (this.state === 'donning') return clamp01(this.t / GAS_MASK.donS);
    if (this.state === 'doffing') return 1 - clamp01(this.t / GAS_MASK.doffS);
    return 0;
  }

  /** The visor-edge / HUD warning tone: empty (on the face, no charge), low (<= lowFrac), ok. */
  get tone(): MaskTone {
    const m = this.worn;
    if (!m) return 'ok';
    const frac = (m.filter ?? 0) / GAS_MASK.filterLifeS;
    return frac <= 0 ? 'empty' : frac <= GAS_MASK.lowFrac ? 'low' : 'ok';
  }

  // --- Q -------------------------------------------------------------------------------------------------------------

  /** Q (game.ts; QA maskToggle): put the mask on / take it off under the arbitration rules (header). */
  press(): MaskPress {
    const g = this.game;
    if (g.state !== 'playing' || !g.player.alive) return 'ignored';
    if (this.transitioning) return 'ignored';
    // lane KNIFE: never mid-slash. Task knife-windup-20261030: a knife held wound up (not released) is no attack yet — Q goes ahead
    // and the transition's input ownership lowers the knife, which drops the windup (no swing on a later release); a released /
    // queued swing (committed) still ignores Q until its recovery ends.
    if (g.weapon.swinging && !g.weapon.winding) return 'ignored';
    const gear = g.gear as unknown as GearLike | undefined;
    if (gear?.viewOpen || (gear?.holdProgress ?? null) !== null) return 'ignored'; // the bag view / an E hold owns input
    const m = this.worn;
    if (!m) {
      g.hud.toast('No gas mask — find one and wear it (Tab: gear)', true);
      g.sfx.denied();
      return 'no-mask';
    }
    this.access.cancelUse('mask');
    this.access.cancelFlareHold();
    if (gear?.readied) gear.cancelReady?.(true); // the readied backpack goes back on (gear system's path), then the mask
    const going: MaskState = this.state === 'off' ? 'donning' : 'doffing';
    this.state = going;
    this.t = 0;
    this.faceUid = m.uid;
    this.wornUid = m.uid;
    (g.sfx as {maskRustle?: (on: boolean) => void}).maskRustle?.(going === 'donning');
    this.present();
    return going;
  }

  // --- per frame (while playing) ---------------------------------------------------------------------------------------

  update(dt: number): void {
    const g = this.game;
    this.checkWorn();
    // play time only: frame hooks run only while playing; the guard keeps pause / death / menus from ever draining
    if (g.state === 'playing' && g.player.alive && dt > 0) {
      if (this.state === 'donning') {
        this.t += dt;
        if (this.t >= GAS_MASK.donS) { this.state = 'on'; this.t = 0; }
      } else if (this.state === 'doffing') {
        this.t += dt;
        if (this.t >= GAS_MASK.doffS) { this.state = 'off'; this.t = 0; }
      } else if (this.state === 'on') this.drain(dt);
      if (this.state === 'on') this.fitSpare(); // donned with 0, or drained to 0 this frame
    }
    this.present();
  }

  /** On the face: the fitted filter drains by play dt; the low warning once per filter. */
  private drain(dt: number): void {
    const m = this.worn;
    if (!m) return;
    const left = Math.max(0, (m.filter ?? 0) - dt);
    m.filter = left;
    if (left > 0 && left / GAS_MASK.filterLifeS <= GAS_MASK.lowFrac && !this.lowWarned) {
      this.lowWarned = true;
      const n = this.spares;
      this.game.hud.toast(`Gas mask filter low — ${Math.ceil(left / GAS_MASK.filterLifeS * 100)} % · ${n ? `${n} spare` : 'no spare filter'}`, true);
    }
  }

  /** An empty fitted filter on the face: take one spare from accessible inventory (instant), else warn once. */
  private fitSpare(): void {
    const g = this.game, m = this.worn;
    if (!m || (m.filter ?? 0) > 0) return;
    if (this.drawFailedAt === g.inv.version) return; // nothing new to draw from since the last try
    if (g.inv.take(GAS_MASK.filterItem, 1) === 1) {
      m.filter = GAS_MASK.filterLifeS;
      this.lowWarned = this.emptyWarned = false;
      this.drawFailedAt = -1;
      (g.sfx as {batteryInsert?: () => void}).batteryInsert?.();
      const n = this.spares;
      g.hud.toast(`Filter changed — ${n} spare`);
      return;
    }
    this.drawFailedAt = g.inv.version;
    if (!this.emptyWarned) {
      this.emptyWarned = true;
      g.hud.toast('NO FILTER — the gas mask is not protecting you', true);
    }
  }

  /** The equipped mask left the slot or changed (unequip / swap / drop): it is off the face at once. */
  checkWorn(): void {
    const m = this.worn, uid = m?.uid ?? -1;
    if (this.state !== 'off' && uid !== this.faceUid) {
      this.state = 'off';
      this.t = 0;
      this.present();
    }
    if (uid !== this.wornUid) {
      this.wornUid = uid;
      this.lowWarned = this.emptyWarned = false;
      this.drawFailedAt = -1;
    }
  }

  /** Lifecycle (state left 'playing', section build / teardown): a running transition ends OFF. */
  cancelTransition(): void {
    if (!this.transitioning) return;
    this.state = 'off';
    this.t = 0;
    this.present();
  }

  /** HUD Q slot + camera overlay (each writes the DOM only on change). */
  present(): void {
    const v = this.view;
    v.state = this.state;
    v.cover = this.cover;
    v.protects = this.protects();
    v.tone = this.tone;
    (this.game.hud as {setMask?: (v: MaskHudView) => void}).setMask?.(v);
    this.overlay.set(v.cover, this.state === 'off' ? 'ok' : v.tone);
  }

  /** Hidden filter-canister prototype for the loading-screen warm-up (same factory + material clones as a pickup). */
  warmPrototypes(): THREE.Object3D[] {
    if (!this.protos) {
      const root = makeSupplyMesh(GAS_MASK.filterItem);
      root.name = 'gas-mask-warm-prototype-filter';
      root.position.set(0, -1000, 0);
      root.traverse(o => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        m.material = Array.isArray(m.material) ? m.material.map(x => x.clone()) : m.material.clone(); // like a pickup
        m.visible = false;
        m.raycast = () => {};
      });
      this.game.scene.add(root);
      this.protos = [root];
    }
    return this.protos;
  }

  /** QA / tests: a compact state report. */
  qa(): {state: MaskState; on: boolean; protects: boolean; transition: number; equipped: string | null; uid: number | null; filterS: number; filterFrac: number; spares: number; tone: MaskTone; overlay: number} {
    const m = this.worn;
    return {
      state: this.state, on: this.on, protects: this.protects(), transition: +this.cover.toFixed(3), equipped: m?.itemId ?? null, uid: m?.uid ?? null,
      filterS: +this.filterSeconds.toFixed(2), filterFrac: +(this.filterSeconds / GAS_MASK.filterLifeS).toFixed(4), spares: this.spares, tone: this.tone, overlay: this.overlay.shown,
    };
  }
}

/** Create the gas-mask system and register it into the Game (call once from the Game constructor, after installGear). */
export function installGasMask(game: Game, access: GasMaskAccess): GasMaskSystem {
  return new GasMaskSystem(game, access).install();
}
