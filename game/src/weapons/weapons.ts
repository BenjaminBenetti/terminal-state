// Data-driven weapon definitions plus the fire/reload state machine shared by every gun.
// Adding a weapon = adding a WeaponDef (and an item + viewmodel binding), no new code paths.

import type {Inventory, ItemStack} from '../items/inventory';
import {ammoItemFor, CALIBERS, type Caliber} from '../items/calibers';
import type {OpticSpec} from './optic';
import {KNIFE_RAYS} from '../combat/melee'; // lane KNIFE

export interface MagazineReload { kind: 'magazine'; time: number; emptyTime: number }
export interface ShellReload { kind: 'shell'; start: number; each: number; end: number }

export interface WeaponDef {
  id: string;
  itemId: string;
  /**
   * Lane AMMO (knife-melee-20261030): the caliber the weapon chambers (items/calibers.ts). Reload / reserve / dry-fire resolve the
   * ammo item through it (weaponAmmoItem), so every weapon of a caliber shares one pool. Absent = uses no ammo (melee).
   */
  caliber?: Caliber;
  magazine: number;
  auto: boolean;
  /** Seconds between shots. */
  interval: number;
  damage: number;
  pellets: number;
  /** Cone half-angle (radians) for hip fire, aiming, and the extra added while moving. */
  spreadHip: number;
  spreadAim: number;
  spreadMove: number;
  range: number;
  falloffStart: number;
  falloffMin: number;
  headMult: number;
  limbMult: number;
  /** Push applied to zombies per pellet (m/s). */
  knockback: number;
  reload: MagazineReload | ShellReload;
  recoil: {pitch: number; yaw: number; kick: number; recover: number};
  equipTime: number;
  aimFov: number;
  moveMult: number;
  /** Loudness radius (m) for alerting zombies. */
  noise: number;
  sound: 'rifle' | 'shotgun' | 'pistol';
  /**
   * Viewmodel placement in camera space, pivoting at the model's Grip marker. Aim offsets come
   * from measured derivative geometry: shotgun rib ~0.07 m above the stock wrist (iron sights).
   * Hip pose (iteration 02): carried low-right with the stock running out of frame toward the
   * shoulder; the top of the gun sits ~62-64% down the screen at 16:9, the muzzle yawed in
   * (hipYaw) and pitched slightly up (hipPitch) toward the crosshair, small cant (hipRoll).
   * `optic` (iteration 04): when the loaded model has a see-through optic (rifle-optic.glb:
   * OpticGlassRear + OpticRear anchor) ADS is derived from it instead — the eye on the optic axis
   * `eyeRelief` behind the rear glass (weapons/optic.ts). `aim` stays the fallback for a model
   * without one (the original opaque rifle.glb: optic top ~0.28 m above the grip, sight over it).
   * `sightRelief` (user weapon models, 2026-10-28): when the loaded model has a `Sight` marker (and no see-through
   * optic) ADS puts that sight point on the camera axis `sightRelief` m in front of the eye:
   * aim = (0, 0, -sightRelief) - (Sight + (0, sightLift, 0) - Grip). `sightLift` (m) puts the eye line just OVER a solid
   * part: the user rifle's red dot has an opaque lens, so the optic sits just under the crosshair instead of filling the view.
   * `aim` stays the fallback for a model without a Sight marker.
   */
  view: {model: 'rifle' | 'shotgun' | 'pistol' | 'knife'; hip: [number, number, number]; aim: [number, number, number]; hipYaw: number; hipPitch: number; hipRoll: number; length: number; optic?: OpticSpec; sightRelief?: number; sightLift?: number};
  /**
   * Lane KNIFE (knife-melee-20261030): a MELEE weapon. Its swing replaces the gun's fire / magazine / reload cycle in
   * WeaponController (no ammo is ever counted or taken, R does nothing, no ADS). The shared fields keep their meaning:
   * `interval` = seconds per swing (cadence), `range` = reach from the eye (m), `damage` / `headMult` / `limbMult` = the hit,
   * `noise` = loudness of a blade hit (gunshots 24-38 m), `knockback` 0, `auto` = holding the button keeps swinging.
   */
  melee?: MeleeSpec;
}

/** Lane KNIFE: melee-only timing / sweep (combat/melee.ts resolves the contact). */
export interface MeleeSpec {
  /** Seconds from the click to blade contact — the ONE moment the swing is resolved (windup; the rest is recovery). */
  windup: number;
  /** Sweep rays: [yaw, pitch] offsets (radians) from the crosshair, tried centre first (combat/melee.ts KNIFE_RAYS). */
  rays: readonly (readonly [number, number])[];
}

/**
 * Iteration 15 (user: "increase the recoil a little bit basically across the board ... fifty percent recoil to
 * everything"): every gun's FIRING recoil amplitudes x1.5, applied ONCE here at the definition — camera kick (pitch, yaw)
 * and the viewmodel's visual kick (kick); the application code (game.fire, Viewmodel.fire) is unchanged, so nothing is
 * scaled twice. Recovery rate, damage, spread, fire rate, ammo, knockback and every other motion are unchanged.
 * Base values (iteration 14) stay readable at each def.
 */
export const RECOIL_SCALE = 1.5;
export function firingRecoil(base: WeaponDef['recoil']): WeaponDef['recoil'] {
  return {pitch: base.pitch * RECOIL_SCALE, yaw: base.yaw * RECOIL_SCALE, kick: base.kick * RECOIL_SCALE, recover: base.recover};
}

export const WEAPONS: Record<string, WeaponDef> = {
  rifle: {
    id: 'rifle', itemId: 'rifle', caliber: '5.56x45mm', magazine: 30, auto: true, interval: 0.1,
    damage: 24, pellets: 1, spreadHip: 0.028, spreadAim: 0.004, spreadMove: 0.03,
    range: 90, falloffStart: 40, falloffMin: 0.7, headMult: 2.5, limbMult: 0.7, knockback: 0.25,
    reload: {kind: 'magazine', time: 2.1, emptyTime: 2.55},
    recoil: firingRecoil({pitch: 0.012, yaw: 0.006, kick: 0.035, recover: 9}),
    equipTime: 0.55, aimFov: 52, moveMult: 0.95, noise: 30, sound: 'rifle',
    // Iteration 15 (user: "the scope doesn't work anymore after we replaced the model"): the iteration-04 see-through optic
    // is back (same eye relief 0.105 m) on the user's red-dot rifle via a runtime rear aperture (weapons/optic.ts), measured
    // from rifle-user.glb: the sight is a solid capped cylinder on axis (-0.0035, 0.1394), rear cap face r ~24 mm ending at
    // z 0.0833; the glass sits 2.2 mm eye-side of it, r 16 mm (an 8 mm housing rim stays). `sightRelief` / `sightLift`
    // remain the fallback for a rifle model without that sight.
    view: {model: 'rifle', hip: [0.245, -0.41, -0.7], aim: [0.0, -0.283, -0.42], hipYaw: 0.12, hipPitch: 0.03, hipRoll: -0.05, length: 0.92, sightRelief: 0.26, sightLift: 0.04,
      optic: {eyeRelief: 0.105, aperture: {x: -0.0035, y: 0.1394, z: 0.0855, radius: 0.016}}},
  },
  shotgun: {
    id: 'shotgun', itemId: 'shotgun', caliber: '12ga', magazine: 6, auto: false, interval: 0.82,
    damage: 15, pellets: 9, spreadHip: 0.075, spreadAim: 0.052, spreadMove: 0.02,
    range: 30, falloffStart: 7, falloffMin: 0.25, headMult: 1.8, limbMult: 0.75, knockback: 0.55,
    reload: {kind: 'shell', start: 0.38, each: 0.48, end: 0.42},
    recoil: firingRecoil({pitch: 0.06, yaw: 0.015, kick: 0.09, recover: 6}),
    equipTime: 0.6, aimFov: 60, moveMult: 0.92, noise: 38, sound: 'shotgun',
    view: {model: 'shotgun', hip: [0.235, -0.27, -0.66], aim: [0.0, -0.095, -0.45], hipYaw: 0.12, hipPitch: 0.03, hipRoll: -0.05, length: 1.0, sightRelief: 0.30, sightLift: 0.022},
  },
  // Targeted pass 2026-10-28 (pistol lane): compact semi-auto sidearm, 9mm (9×19mm; lane AMMO: item ammo_9mm). The starting weapon now that
  // the user's pistol.glb is in (weapons/pistol.ts PISTOL_ART_READY); hip brings the 0.185 m pistol in close at the grip.
  pistol: {
    id: 'pistol', itemId: 'pistol', caliber: '9x19mm', magazine: 15, auto: false, interval: 0.16,
    damage: 17, pellets: 1, spreadHip: 0.022, spreadAim: 0.006, spreadMove: 0.025,
    range: 60, falloffStart: 22, falloffMin: 0.6, headMult: 2.4, limbMult: 0.7, knockback: 0.18,
    reload: {kind: 'magazine', time: 1.4, emptyTime: 1.65},
    recoil: firingRecoil({pitch: 0.016, yaw: 0.005, kick: 0.03, recover: 11}),
    equipTime: 0.35, aimFov: 58, moveMult: 1.0, noise: 24, sound: 'pistol',
    // Iteration 12 (LIGHT, user #6 "move the pistol lower and slightly more in towards the camera during ADS"): the sights now
    // sit 14 mm under the screen centre (~2.9 deg, the crosshair stays the aim point) and 40 mm closer (relief 0.32 -> 0.28).
    view: {model: 'pistol', hip: [0.16, -0.17, -0.36], aim: [0.0, -0.08, -0.36], hipYaw: 0.08, hipPitch: 0.03, hipRoll: -0.04, length: 0.2, sightRelief: 0.28, sightLift: 0.014},
  },
  // Lane KNIFE (knife-melee-20261030; user: "one swipe to the head and two swipes to the body", "trading life for killing a
  // zombie"): the user's survival knife (knife-user.glb), the first MELEE weapon — in every NewGame kit next to the pistol.
  // No caliber (never counts / takes ammo). Tuning vs ai/brain.ts ZOMBIE_STATS: a standard zombie (shambler, 100 hp) dies to
  // ONE head hit (60 x 2 = 120) or TWO body hits (60 + 60; torso and limbs alike, limbMult 1); the tougher coated zombie (165 hp)
  // takes two head / three body hits; rats / dogs (44 hp) die to any hit. Reach 1.5 m from the eye (a zombie starts its swipe
  // at 1.35-1.4 m feet to feet and lands it out to ~1.8 m), one swing per 0.65 s with contact 0.18 s after the click: closing
  // in means trading a hit for a kill. No knockback and no hit stagger (game.ts meleeContact) — contact stays dangerous.
  knife: {
    id: 'knife', itemId: 'knife', magazine: 0, auto: true, interval: 0.65,
    damage: 60, pellets: 1, spreadHip: 0, spreadAim: 0, spreadMove: 0,
    range: 1.5, falloffStart: 1.5, falloffMin: 1, headMult: 2, limbMult: 1, knockback: 0,
    reload: {kind: 'magazine', time: 0, emptyTime: 0}, // never used: a melee def returns before any reload logic
    recoil: {pitch: 0, yaw: 0, kick: 0, recover: 8}, // no firing recoil (not a gun; RECOIL_SCALE does not apply)
    equipTime: 0.3, aimFov: 75, moveMult: 1.0, noise: 5,
    sound: 'pistol', // placeholder for the gun-only cue type: a knife never calls shot / dry / reload cues (swing: sfx.meleeSwing)
    melee: {windup: 0.18, rays: KNIFE_RAYS},
    // Carry pose: grip (the hand) low right, just under the frame; blade up-left toward the crosshair with its flat to the eye
    // (spine / serrations upper right, edge lower left). Swing offsets: weapons/meleeView.ts (the tip crosses the crosshair at contact).
    view: {model: 'knife', hip: [0.14, -0.15, -0.28], aim: [0.14, -0.15, -0.28], hipYaw: 0.41, hipPitch: 0.575, hipRoll: -1.02, length: 0.32},
  },
};

/** Lane KNIFE: the weapon def of an item id when it is a melee weapon (knife), else null. */
export function meleeDefOf(itemId: string | null | undefined, defs: Record<string, WeaponDef> = WEAPONS): WeaponDef | null {
  const d = itemId ? Object.values(defs).find(w => w.itemId === itemId) : undefined;
  return d?.melee ? d : null;
}

// ---- Lane AMMO (knife-melee-20261030): caliber-based ammo -----------------------------------------------------------------

/** The ammo item a weapon loads from (resolved through its caliber), or null for a weapon that uses no ammo (melee). */
export function weaponAmmoItem(def: WeaponDef): string | null {
  return def.caliber ? ammoItemFor(def.caliber) : null;
}

/** Rounds of the weapon's caliber in the inventory (quick slots + pockets; shared by every weapon of that caliber). */
export function reserveFor(def: WeaponDef, inv: Pick<Inventory, 'count'>): number {
  const id = weaponAmmoItem(def);
  return id ? inv.count(id) : 0;
}

/** Player-facing caliber label of a weapon ('9mm', '5.56mm', '12-gauge'), or '' without ammo. */
export function caliberLabel(def: WeaponDef): string {
  return def.caliber ? CALIBERS[def.caliber].label : '';
}

/** Weapons that chamber a caliber (inventory tooltips: what an ammo item loads). */
export function weaponsForCaliber(c: Caliber, defs: Record<string, WeaponDef> = WEAPONS): WeaponDef[] {
  return Object.values(defs).filter(d => d.caliber === c);
}

/** Lane KNIFE: 'swinging' = a melee swing in progress (windup -> contact -> recovery). */
export type WeaponPhase = 'none' | 'equipping' | 'idle' | 'reloading' | 'swinging';

export type WeaponEvent =
  | {type: 'fire'; def: WeaponDef}
  | {type: 'dry'; def: WeaponDef}
  | {type: 'reloadStart'; def: WeaponDef; empty: boolean}
  | {type: 'shellIn'; def: WeaponDef}
  | {type: 'reloadEnd'; def: WeaponDef}
  | {type: 'equipped'; def: WeaponDef}
  // Lane KNIFE (melee only): a swing started (whoosh / animation) and — exactly once per swing, `melee.windup` s later unless
  // cancelled first — the blade's contact moment, when the game resolves the hit (game.ts meleeContact). `swing` numbers them.
  | {type: 'swing'; def: WeaponDef; swing: number}
  | {type: 'contact'; def: WeaponDef; swing: number};

export interface TriggerInput {
  /** Trigger currently held. */
  held: boolean;
  /** Trigger went down this frame. */
  pressed: boolean;
  reload: boolean;
  /** Sprinting/using items keeps the gun lowered. */
  lowered: boolean;
}

export class WeaponController {
  def: WeaponDef | null = null;
  stack: ItemStack | null = null;
  phase: WeaponPhase = 'none';
  phaseT = 0;
  cooldown = 0;
  /** Reload sub-state for shell-by-shell loading. */
  private shellStage: 'start' | 'load' | 'end' = 'start';
  private interruptReload = false;
  /** 0..1 progress for HUD/viewmodel. */
  progress = 0;
  /** Iteration 16 (lane GEAR): reload time multiplier — gloves x0.92, an arm injury slower (Game.mods.handlingMult, set every frame). */
  handling = 1;
  /** Lane KNIFE: seconds into the current melee swing (meaningful while phase === 'swinging'). */
  swingT = 0;
  /** Lane KNIFE: swings started by this controller (the id carried by its 'swing' / 'contact' events). */
  swingId = 0;
  /** Lane KNIFE: this swing's contact has not happened yet (cleared at contact or by cancelSwing). */
  private contactPending = false;

  equip(stack: ItemStack | null, defs = WEAPONS): void {
    if (stack === this.stack && stack) return;
    this.stack = stack;
    this.def = stack ? defs[stack.itemId] ?? null : null;
    this.phase = this.def ? 'equipping' : 'none';
    this.phaseT = this.def ? this.def.equipTime : 0;
    this.cooldown = 0;
    this.progress = 0;
    this.swingT = 0; // lane KNIFE: a swing never survives a weapon change (no stale contact)
    this.contactPending = false;
  }

  get reloading(): boolean {
    return this.phase === 'reloading';
  }

  /** Lane KNIFE: a melee swing is in progress. */
  get swinging(): boolean {
    return this.phase === 'swinging';
  }

  /** Lane KNIFE: seconds into the running swing, or -1 (viewmodel animation). */
  get swingTime(): number {
    return this.phase === 'swinging' ? this.swingT : -1;
  }

  /**
   * Lane KNIFE: abort a running swing (menus / pause / focus loss / death / travel / sprint-use-climb before contact): its
   * contact will never fire. The remaining swing time stays as cooldown (re-opening a menu never skips the recovery).
   * Returns true when a contact was still pending.
   */
  cancelSwing(): boolean {
    if (this.phase !== 'swinging') return false;
    const pending = this.contactPending;
    this.phase = 'idle';
    this.contactPending = false;
    this.swingT = 0;
    this.progress = 0;
    return pending;
  }

  canReload(inv: Inventory): boolean {
    const d = this.def, s = this.stack;
    if (d?.melee) return false; // lane KNIFE: nothing to reload
    return !!d && !!s && (s.mag ?? 0) < d.magazine && reserveFor(d, inv) > 0;
  }

  update(dt: number, input: TriggerInput, inv: Inventory): WeaponEvent[] {
    const ev: WeaponEvent[] = [];
    const d = this.def, s = this.stack;
    if (!d || !s) return ev;
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (this.phase === 'equipping') {
      this.phaseT -= dt;
      this.progress = 1 - Math.max(0, this.phaseT) / d.equipTime;
      if (this.phaseT <= 0) {
        this.phase = 'idle';
        ev.push({type: 'equipped', def: d});
      }
      return ev;
    }
    if (d.melee) return this.updateMelee(dt, input, ev); // lane KNIFE: swing cycle instead of fire / magazine / reload
    if (this.phase === 'reloading') {
      if (input.pressed && d.reload.kind === 'shell' && (s.mag ?? 0) > 0) this.interruptReload = true;
      this.phaseT -= dt / Math.max(0.25, this.handling); // Iteration 16: handling scales the whole reload (magazine and shell by shell)
      if (d.reload.kind === 'magazine') {
        const total = (s.mag ?? 0) === 0 ? d.reload.emptyTime : d.reload.time;
        this.progress = 1 - Math.max(0, this.phaseT) / total;
        if (this.phaseT <= 0) {
          const need = d.magazine - (s.mag ?? 0), ammo = weaponAmmoItem(d);
          s.mag = (s.mag ?? 0) + (ammo ? inv.take(ammo, need) : 0);
          inv.version++;
          this.phase = 'idle';
          ev.push({type: 'reloadEnd', def: d});
        }
      } else {
        const r = d.reload;
        while (this.phaseT <= 0 && this.phase === 'reloading') {
          if (this.shellStage === 'start') {
            this.shellStage = 'load';
            this.phaseT += r.each;
          } else if (this.shellStage === 'load') {
            const ammo = weaponAmmoItem(d);
            if (ammo && inv.take(ammo, 1) === 1) {
              s.mag = (s.mag ?? 0) + 1;
              inv.version++;
              ev.push({type: 'shellIn', def: d});
            }
            if ((s.mag ?? 0) >= d.magazine || reserveFor(d, inv) === 0 || this.interruptReload) {
              this.shellStage = 'end';
              this.phaseT += r.end;
            } else this.phaseT += r.each;
          } else {
            this.phase = 'idle';
            ev.push({type: 'reloadEnd', def: d});
          }
        }
        this.progress = (s.mag ?? 0) / d.magazine;
      }
      return ev;
    }
    // idle
    if (input.reload && this.canReload(inv)) {
      this.startReload(ev);
      return ev;
    }
    if (input.lowered) return ev;
    const wants = d.auto ? input.held : input.pressed;
    if (wants && this.cooldown <= 0) {
      if ((s.mag ?? 0) > 0) {
        s.mag = (s.mag ?? 0) - 1;
        inv.version++;
        this.cooldown = d.interval;
        ev.push({type: 'fire', def: d});
      } else if (input.pressed) {
        this.cooldown = 0.25;
        ev.push({type: 'dry', def: d});
        if (this.canReload(inv)) this.startReload(ev);
      }
    }
    return ev;
  }

  private startReload(ev: WeaponEvent[]): void {
    const d = this.def!, s = this.stack!;
    this.phase = 'reloading';
    this.interruptReload = false;
    this.progress = 0;
    if (d.reload.kind === 'magazine') this.phaseT = (s.mag ?? 0) === 0 ? d.reload.emptyTime : d.reload.time;
    else { this.shellStage = 'start'; this.phaseT = d.reload.start; }
    ev.push({type: 'reloadStart', def: d, empty: (s.mag ?? 0) === 0});
  }

  /**
   * Lane KNIFE: the melee cycle. A click (held: `auto`) starts a swing when the cadence allows; `melee.windup` s later the
   * ONE 'contact' event of that swing fires; the swing (and its cooldown) lasts `interval` s. A lowered weapon (sprint /
   * item use / climbing) before contact cancels it. Nothing here reads, counts or takes ammo; reload input is ignored.
   */
  private updateMelee(dt: number, input: TriggerInput, ev: WeaponEvent[]): WeaponEvent[] {
    const d = this.def!, m = d.melee!;
    if (this.phase === 'swinging') {
      if (input.lowered && this.contactPending) { this.cancelSwing(); return ev; }
      this.swingT += dt;
      if (this.contactPending && this.swingT >= m.windup) {
        this.contactPending = false;
        ev.push({type: 'contact', def: d, swing: this.swingId});
      }
      this.progress = Math.min(1, this.swingT / d.interval);
      if (this.swingT < d.interval - 1e-6) return ev; // (epsilon: frame-summed time hits the cadence exactly at 60 fps)
      this.phase = 'idle';
      this.swingT = 0;
      this.progress = 0;
    }
    if (this.phase !== 'idle' || input.lowered) return ev;
    const wants = d.auto ? input.held : input.pressed;
    if (wants && this.cooldown <= 1e-6) {
      this.phase = 'swinging';
      this.swingT = 0;
      this.contactPending = true;
      this.cooldown = d.interval;
      this.swingId++;
      ev.push({type: 'swing', def: d, swing: this.swingId});
    }
    return ev;
  }

  /** Damage multiplier by distance. */
  static falloff(d: WeaponDef, dist: number): number {
    if (dist <= d.falloffStart) return 1;
    if (dist >= d.range) return d.falloffMin;
    const t = (dist - d.falloffStart) / (d.range - d.falloffStart);
    return 1 + (d.falloffMin - 1) * t;
  }
}
