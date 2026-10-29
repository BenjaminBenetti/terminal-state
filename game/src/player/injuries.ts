// Iteration 16 (lane INJURY): limb injuries — an injured LEG slows you down and cuts sprints short, an injured ARM makes the aim
// sway gently side to side, widens the spread and slows reloads / item use. Only the dedicated treatment items fix them
// (items/medical.ts: leg splint, arm sling, rarer trauma kit); bandages and med kits restore HP only.
//
// State: one injury per limb PAIR (`arm`, `leg`) with a side ('left' | 'right') that is flavour only (HUD silhouette, text):
// at most two injuries at once, no severity. Pure logic here (no DOM / three.js; unit-tested in Node); `installInjuries`
// wires it into the Game through the iteration-16 registries — one hit listener, one frame hook, one ModifierSource.
//
// Triggers (real gameplay only):
//  - hits through Game.hitListeners (player/hits.ts): an ARM / LEG hit injures that limb with a chance that scales with the HP
//    damage actually taken (after armor: a fully absorbed hit never injures) — 0.022 per point, capped at 0.45: a 10-damage
//    zombie swipe 22 %, a 15-damage coated swipe 33 %; a rat / dog bite on a leg tears more (x1.4; bites mostly land low,
//    biteHitLocation). Head / torso hits never injure a limb.
//  - hard landings (Player.justLanded / landSpeed): no risk below 8.5 m/s touchdown (≈ a 2.1 m fall — the 1.15 m platform drop
//    into the track bed, even with a jump on top, lands at ≤ 7.5 m/s), 20 % there, rising to 85 % at 13 m/s (≈ 5 m).
// No death spiral: an injured limb cannot be injured again (no stacking), at most arm + leg, and after any injury no new one
//  for 20 s of play (cooldown). Effects are a ModifierSource, so Game recomputes them from BASE values every frame (treatment /
//  travel / reset can never leave a stacked penalty behind).
// Effects: leg — speedMult 0.7 (walk / crouch / aim / sprint), +16 stamina/s drain while sprinting (≈ 2.5 s limping bursts
//  instead of ≈ 4 s); arm — spreadMult 1.25, handlingMult 1.3 (reload / item use; lane GEAR applies the combined handlingMult
//  once for both lanes), aim sway 0.009 rad
//  at 0.35 Hz (camera aimOffset: shots, crosshair and the optic dot follow it — honest), x0.8 while aiming down sights (braced),
//  x0.85 crouched, eased in / out (never jumps). Recoil (iteration 15: x1.5) and the optic alignment are untouched.
// Persistence: snapshot() / restore() for lane RUN (travel carries the state; "Retry level" restores the entry snapshot);
//  reset() only for NewGame. Treatment is the only other way out.

import {mulberry32} from '../core/rng';
import type {HitLocation, ResolvedHit} from './hits';
import type {ModifierSource, PlayerModifiers} from './modifiers';
import {LIMBS, treatsText, type Limb} from '../items/medical';
import type {ItemDef} from '../items/items';

export type {Limb};
export type LimbSide = 'left' | 'right';
export type InjuryCause = 'hit' | 'bite' | 'fall';
export interface LimbInjury { side: LimbSide; cause: InjuryCause }

/** JSON-safe state for lane RUN (run carryover / level-entry snapshot). */
export interface InjurySnapshot {
  v: 1;
  arm: LimbInjury | null;
  leg: LimbInjury | null;
  /** Seconds of play before another injury may happen. */
  cooldown: number;
}

/** Tunables (documented in the module header and lanes/injury.done). */
export const INJURY = {
  hitChancePerDamage: 0.022,
  hitChanceMax: 0.45,
  biteLegMult: 1.4,
  /** HP damage below this never injures (a grazing / absorbed hit). */
  minDamage: 1,
  landSafe: 8.5,
  landChanceAtSafe: 0.2,
  landHard: 13,
  landChanceMax: 0.85,
  cooldown: 20,
  legSpeedMult: 0.7,
  legSprintDrain: 16,
  armSpreadMult: 1.25,
  armHandlingMult: 1.3,
  armSwayAmp: 0.009,
  armSwayHz: 0.35,
  /** Hard bound of the yaw sway (rad), whatever the sources ask for. */
  swayCap: 0.012,
  swayPitch: 0.4,
  swayAds: 0.8,
  swayCrouch: 0.85,
  /** Amplitude follow rate (1/s): the sway eases in when injured and out when treated. */
  swayRate: 1.6,
} as const;

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

/** Chance that a resolved arm / leg hit injures that limb (0 for head / torso, absorbed or tiny hits). */
export function hitInjuryChance(hit: Pick<ResolvedHit, 'location' | 'applied' | 'source'>): number {
  if (hit.location !== 'arm' && hit.location !== 'leg') return 0;
  if (!(hit.applied >= INJURY.minDamage)) return 0;
  const mult = hit.source === 'creature' && hit.location === 'leg' ? INJURY.biteLegMult : 1;
  return Math.min(INJURY.hitChanceMax, INJURY.hitChancePerDamage * hit.applied * mult);
}

/** Chance that a touchdown at `speed` m/s injures a leg. */
export function landingInjuryChance(speed: number): number {
  if (!(speed >= INJURY.landSafe)) return 0;
  const t = Math.min(1, (speed - INJURY.landSafe) / (INJURY.landHard - INJURY.landSafe));
  return INJURY.landChanceAtSafe + (INJURY.landChanceMax - INJURY.landChanceAtSafe) * t;
}

/**
 * Where a rat / dog bite lands (deterministic from a 0..1 roll, like hits.ts meleeHitLocation): legs 58 %, arm 18 %, head 2 %,
 * torso 22 % standing; crouched the animal reaches higher (legs 40 %, arm 26 %, head 6 %, torso 28 %).
 */
export function biteHitLocation(roll: number, crouched = false): HitLocation {
  const leg = crouched ? 0.4 : 0.58, arm = crouched ? 0.26 : 0.18, head = crouched ? 0.06 : 0.02;
  if (roll < leg) return 'leg';
  if (roll < leg + arm) return 'arm';
  if (roll < leg + arm + head) return 'head';
  return 'torso';
}

/**
 * Restrained side-to-side aim sway (pure). Two incommensurate sines per axis on a phase that integrates the frequency (so a
 * frequency change never jumps), an amplitude that eases toward its target, |yaw| <= amplitude <= swayCap, pitch smaller.
 */
export class AimSway {
  amp = 0;
  phase = 0;
  yaw = 0;
  pitch = 0;

  update(dt: number, targetAmp: number, hz: number, o: {aiming?: boolean; crouched?: boolean} = {}): {yaw: number; pitch: number} {
    const step = Math.max(0, Math.min(0.25, dt || 0));
    let target = Math.max(0, Math.min(INJURY.swayCap, Number.isFinite(targetAmp) ? targetAmp : 0));
    if (o.aiming) target *= INJURY.swayAds;
    if (o.crouched) target *= INJURY.swayCrouch;
    this.amp += (target - this.amp) * Math.min(1, INJURY.swayRate * step);
    if (target === 0 && this.amp < 1e-6) this.amp = 0;
    const f = Number.isFinite(hz) && hz > 0 ? Math.min(1.5, hz) : INJURY.armSwayHz;
    this.phase = (this.phase + step * f * Math.PI * 2) % (Math.PI * 2000);
    const ph = this.phase;
    if (this.amp === 0) { this.yaw = this.pitch = 0; return {yaw: 0, pitch: 0}; } // healthy: exactly zero (no -0)
    this.yaw = this.amp * (0.65 * Math.sin(ph) + 0.35 * Math.sin(1.73 * ph + 1.3));
    this.pitch = this.amp * INJURY.swayPitch * (0.6 * Math.sin(0.83 * ph + 0.7) + 0.4 * Math.sin(2.11 * ph + 2.1));
    return {yaw: this.yaw, pitch: this.pitch};
  }

  reset(): void {
    this.amp = this.phase = this.yaw = this.pitch = 0;
  }
}

export interface TreatmentResult {
  /** The item was used (consumed exactly once) and cured something. */
  ok: boolean;
  /** HUD toast ('' = nothing to say). */
  text: string;
  cured: Limb[];
}

const sideText = (i: LimbInjury | null) => (i ? i.side : '');

export class InjurySystem {
  readonly limbs: Record<Limb, LimbInjury | null> = {arm: null, leg: null};
  /** Seconds of play before another injury may happen. */
  cooldown = 0;
  /** Seconds of play simulated (QA). */
  clock = 0;
  readonly sway = new AimSway();
  /** Camera aim offset this system drives (installInjuries attaches Game.aimOffset); zeroed on reset. */
  aim: {yaw: number; pitch: number} | null = null;
  /** Bumped on every change (HUD / UI redraw key). */
  version = 0;
  private readonly rand: () => number;

  constructor(rand?: () => number) {
    this.rand = rand ?? mulberry32((Math.random() * 0x100000000) >>> 0);
  }

  injured(limb: Limb): boolean {
    return this.limbs[limb] !== null;
  }

  get any(): boolean {
    return this.limbs.arm !== null || this.limbs.leg !== null;
  }

  private canInjure(limb: Limb): boolean {
    return this.cooldown <= 0 && this.limbs[limb] === null;
  }

  private injure(limb: Limb, cause: InjuryCause): Limb {
    this.limbs[limb] = {side: this.rand() < 0.5 ? 'left' : 'right', cause};
    this.cooldown = INJURY.cooldown;
    this.version++;
    return limb;
  }

  /** A resolved hit on the player (Game.hitListeners). Returns the limb that got injured, if any. */
  onHit(hit: ResolvedHit): Limb | null {
    const limb = hit.location === 'arm' || hit.location === 'leg' ? hit.location : null;
    if (!limb || !this.canInjure(limb)) return null;
    const p = hitInjuryChance(hit);
    if (p <= 0 || this.rand() >= p) return null;
    return this.injure(limb, hit.source === 'creature' ? 'bite' : hit.source === 'fall' ? 'fall' : 'hit');
  }

  /** A touchdown at `speed` m/s (Player.justLanded / landSpeed). Returns 'leg' when it injured the leg. */
  onLanding(speed: number): Limb | null {
    const p = landingInjuryChance(speed);
    if (p <= 0 || !this.canInjure('leg')) return null;
    if (this.rand() >= p) return null;
    return this.injure('leg', 'fall');
  }

  /** QA / spot checks only (`__game.injuries.force('leg')` with ?qa): injure a limb now, bypassing the roll and the cooldown. */
  force(limb: Limb, side: LimbSide = 'right', cause: InjuryCause = 'hit'): void {
    this.limbs[limb] = {side, cause};
    this.version++;
  }

  /** Advance play time (only while playing: the frame hook). */
  tick(dt: number): void {
    if (!(dt > 0)) return;
    this.clock += dt;
    this.cooldown = Math.max(0, this.cooldown - dt);
  }

  /** This system's ModifierSource contribution (from its state alone; Game combines from base values every frame). */
  modifiers(): Partial<PlayerModifiers> {
    const m: Partial<PlayerModifiers> = {};
    if (this.limbs.leg) m.speedMult = INJURY.legSpeedMult;
    if (this.limbs.arm) {
      m.spreadMult = INJURY.armSpreadMult;
      m.handlingMult = INJURY.armHandlingMult;
      m.swayAmp = INJURY.armSwayAmp;
      m.swayHz = INJURY.armSwayHz;
    }
    return m;
  }

  /** Bound ModifierSource (push into Game.modifierSources). */
  readonly source: ModifierSource = () => this.modifiers();

  // ---------------------------------------------------------------------------------------
  // Treatment (Game.startUse / use completion)

  /** Why a treatment item cannot be used now (null = OK; also null for items that treat nothing). */
  refuseReason(def: Pick<ItemDef, 'treats'>): string | null {
    const t = def.treats;
    if (!t?.length) return null;
    if (t.some(l => this.limbs[l])) return null;
    return `No ${treatsText(t).replace(' and ', ' or ')} injury to treat`;
  }

  /**
   * Finish a treatment use: re-checks the injury (gone -> refused, nothing used), then consumes the item exactly once via
   * `consume` (false -> nothing cured) and cures ONLY the limbs the item treats.
   */
  completeTreatment(def: Pick<ItemDef, 'treats' | 'short'>, consume: () => boolean): TreatmentResult {
    const refused = this.refuseReason(def);
    if (refused) return {ok: false, text: refused, cured: []};
    const treats = def.treats ?? [];
    if (!treats.length || !consume()) return {ok: false, text: '', cured: []};
    const cured = LIMBS.filter(l => treats.includes(l) && this.limbs[l]);
    const parts = cured.map(l => `${cap(sideText(this.limbs[l]))} ${l} ${l === 'leg' ? 'splinted' : 'strapped up'}`);
    for (const l of cured) this.limbs[l] = null;
    this.version++;
    const after = cured.length === 2 ? 'moving and aiming normally again' : cured[0] === 'leg' ? 'walking and sprinting normally again' : 'steady aim and normal reloads again';
    return {ok: true, text: `${parts.join(' · ')} — ${after}`, cured};
  }

  /** Weapon-panel hint while a treatment item is held. */
  treatmentHint(def: Pick<ItemDef, 'treats'>): string {
    const t = def.treats ?? [];
    const hurt = LIMBS.filter(l => t.includes(l) && this.limbs[l]);
    if (!hurt.length) return `No ${treatsText(t).replace(' and ', ' or ')} injury — keep it for later`;
    return `Click to apply · treats your ${hurt.map(l => `${sideText(this.limbs[l])} ${l}`).join(' and ')}`;
  }

  /** Appended to a bandage / med kit toast while a limb is still injured ("bandages don't fix limbs"). */
  healNote(): string {
    const hurt = LIMBS.filter(l => this.limbs[l]);
    if (!hurt.length) return '';
    return ` · the ${hurt.join(' and ')} still need${hurt.length === 1 ? 's' : ''} ${hurt.map(l => (l === 'leg' ? 'a splint' : 'a sling')).join(' / ')}`;
  }

  // ---------------------------------------------------------------------------------------
  // Persistence (lane RUN)

  snapshot(): InjurySnapshot {
    const copy = (i: LimbInjury | null) => (i ? {side: i.side, cause: i.cause} : null);
    return {v: 1, arm: copy(this.limbs.arm), leg: copy(this.limbs.leg), cooldown: this.cooldown};
  }

  /** Restore a snapshot (invalid / missing input = healthy). The sway eases back in on the next frames. */
  restore(s: InjurySnapshot | null | undefined): void {
    const ok = (i: unknown): LimbInjury | null => {
      const o = i as Partial<LimbInjury> | null;
      if (!o || (o.side !== 'left' && o.side !== 'right')) return null;
      const cause: InjuryCause = o.cause === 'bite' || o.cause === 'fall' ? o.cause : 'hit';
      return {side: o.side, cause};
    };
    const valid = !!s && typeof s === 'object' && s.v === 1;
    this.limbs.arm = valid ? ok(s!.arm) : null;
    this.limbs.leg = valid ? ok(s!.leg) : null;
    this.cooldown = valid && Number.isFinite(s!.cooldown) ? Math.max(0, Math.min(INJURY.cooldown, s!.cooldown)) : 0;
    this.version++;
  }

  /** NewGame: healthy, no cooldown, no sway. */
  reset(): void {
    this.limbs.arm = this.limbs.leg = null;
    this.cooldown = 0;
    this.clock = 0;
    this.sway.reset();
    if (this.aim) this.aim.yaw = this.aim.pitch = 0;
    this.version++;
  }
}

// ---------------------------------------------------------------------------------------
// Text (HUD tooltip, toasts, inventory vitals)

const EFFECT: Record<Limb, string> = {arm: 'aim sways, wider spread, slower reloads', leg: 'limping, short sprints'};
const TREAT: Record<Limb, string> = {arm: 'arm sling or trauma kit', leg: 'leg splint or trauma kit'};
const LEAD: Record<InjuryCause, string> = {hit: '', bite: 'Bitten — ', fall: 'Bad landing — '};

type InjuryView = Pick<InjurySystem, 'limbs'> | InjurySnapshot;
const limbOf = (v: InjuryView, l: Limb): LimbInjury | null => ('limbs' in v ? v.limbs[l] : v[l]) ?? null;

/** Toast when a limb gets injured. */
export function injuryToast(limb: Limb, i: LimbInjury): string {
  return `${LEAD[i.cause]}${i.cause === 'hit' ? cap(i.side) : i.side} ${limb} injured: ${EFFECT[limb]}. Treat with a ${TREAT[limb]}`;
}

/** Tooltip / plain text status ("Limbs OK", "Left leg injured (limping, short sprints) — leg splint or trauma kit"). */
export function injuryStatusText(v: InjuryView): string {
  const hurt = LIMBS.filter(l => limbOf(v, l));
  if (!hurt.length) return 'Limbs OK — no arm or leg injuries';
  return hurt.map(l => `${cap(limbOf(v, l)!.side)} ${l} injured (${EFFECT[l]}) — ${TREAT[l]}`).join(' · ');
}

/** #inv-vitals fragments (lane GEAR renders them after Water): `.crit` turns the <b> red. */
export function injuryStatusHtml(v: InjuryView): string {
  const hurt = LIMBS.filter(l => limbOf(v, l));
  if (!hurt.length) return '<span class="limbs" title="No arm or leg injuries">Limbs <b>OK</b></span>';
  return hurt.map(l => {
    const i = limbOf(v, l)!;
    return `<span class="limbs crit" title="${EFFECT[l]} — treat with a ${TREAT[l]}">${cap(i.side)} ${l} <b>injured</b> · ${l === 'leg' ? 'splint' : 'sling'}</span>`;
  }).join('');
}

// ---------------------------------------------------------------------------------------
// Game wiring

/** The slice of Game the injury system uses (structural, so tests can drive it without a renderer / DOM). */
export interface InjuryHost {
  readonly modifierSources: ModifierSource[];
  readonly hitListeners: ((hit: ResolvedHit) => void)[];
  readonly frameHooks: ((dt: number) => void)[];
  readonly aimOffset: {yaw: number; pitch: number};
  readonly player: {alive: boolean; justLanded: boolean; landSpeed: number; sprinting: boolean; crouched: boolean; stamina: number};
  mods: Pick<PlayerModifiers, 'swayAmp' | 'swayHz'>;
  readonly hud: {toast(text: string, warn?: boolean): void; setLimbs?(arm: LimbInjury | null, leg: LimbInjury | null, tip: string): void};
  readonly sfx: {hurt(): void};
}

/** Private Game state the frame hook reads (passed by the Game constructor). */
export interface InjuryAccess {
  aiming(): boolean;
}

/**
 * Installs the injury system into the Game (one call in the Game constructor): a ModifierSource, a hit listener (arm / leg
 * hits), a frame hook (play clock / cooldown, hard landings, the injured-leg sprint drain, the aim sway -> Game.aimOffset from
 * the COMBINED mods.swayAmp / swayHz, the HUD limb indicator).
 */
export function installInjuries(game: InjuryHost, access: InjuryAccess, sys = new InjurySystem()): InjurySystem {
  sys.aim = game.aimOffset;
  game.modifierSources.push(sys.source);
  const announce = (limb: Limb) => {
    const i = sys.limbs[limb];
    if (i) game.hud.toast(injuryToast(limb, i), true);
  };
  game.hitListeners.push(hit => {
    if (!game.player.alive) return;
    const limb = sys.onHit(hit);
    if (limb) announce(limb);
  });
  let tipVersion = -1, tip = '';
  game.frameHooks.push(dt => {
    const p = game.player;
    sys.tick(dt);
    if (p.justLanded && p.alive) {
      const limb = sys.onLanding(p.landSpeed);
      if (limb) { game.sfx.hurt(); announce(limb); }
    }
    if (sys.limbs.leg && p.sprinting) p.stamina = Math.max(0, p.stamina - INJURY.legSprintDrain * dt);
    const o = sys.sway.update(dt, game.mods.swayAmp, game.mods.swayHz, {aiming: access.aiming(), crouched: p.crouched});
    game.aimOffset.yaw = o.yaw;
    game.aimOffset.pitch = o.pitch;
    if (tipVersion !== sys.version) { tipVersion = sys.version; tip = injuryStatusText(sys); }
    game.hud.setLimbs?.(sys.limbs.arm, sys.limbs.leg, tip); // writes the DOM only on change (Hud.set cache)
  });
  return sys;
}
