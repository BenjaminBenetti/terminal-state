// Data-driven weapon definitions plus the fire/reload state machine shared by every gun.
// Adding a weapon = adding a WeaponDef (and an item + viewmodel binding), no new code paths.

import type {Inventory, ItemStack} from '../items/inventory';
import type {OpticSpec} from './optic';

export interface MagazineReload { kind: 'magazine'; time: number; emptyTime: number }
export interface ShellReload { kind: 'shell'; start: number; each: number; end: number }

export interface WeaponDef {
  id: string;
  itemId: string;
  ammoItem: string;
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
   */
  view: {model: 'rifle' | 'shotgun' | 'pistol'; hip: [number, number, number]; aim: [number, number, number]; hipYaw: number; hipPitch: number; hipRoll: number; length: number; optic?: OpticSpec};
}

export const WEAPONS: Record<string, WeaponDef> = {
  rifle: {
    id: 'rifle', itemId: 'rifle', ammoItem: 'ammo_rifle', magazine: 30, auto: true, interval: 0.1,
    damage: 24, pellets: 1, spreadHip: 0.028, spreadAim: 0.004, spreadMove: 0.03,
    range: 90, falloffStart: 40, falloffMin: 0.7, headMult: 2.5, limbMult: 0.7, knockback: 0.25,
    reload: {kind: 'magazine', time: 2.1, emptyTime: 2.55},
    recoil: {pitch: 0.012, yaw: 0.006, kick: 0.035, recover: 9},
    equipTime: 0.55, aimFov: 52, moveMult: 0.95, noise: 30, sound: 'rifle',
    view: {model: 'rifle', hip: [0.245, -0.41, -0.7], aim: [0.0, -0.283, -0.42], hipYaw: 0.12, hipPitch: 0.03, hipRoll: -0.05, length: 0.92, optic: {eyeRelief: 0.105}},
  },
  shotgun: {
    id: 'shotgun', itemId: 'shotgun', ammoItem: 'ammo_shells', magazine: 6, auto: false, interval: 0.82,
    damage: 15, pellets: 9, spreadHip: 0.075, spreadAim: 0.052, spreadMove: 0.02,
    range: 30, falloffStart: 7, falloffMin: 0.25, headMult: 1.8, limbMult: 0.75, knockback: 0.55,
    reload: {kind: 'shell', start: 0.38, each: 0.48, end: 0.42},
    recoil: {pitch: 0.06, yaw: 0.015, kick: 0.09, recover: 6},
    equipTime: 0.6, aimFov: 60, moveMult: 0.92, noise: 38, sound: 'shotgun',
    view: {model: 'shotgun', hip: [0.235, -0.27, -0.66], aim: [0.0, -0.095, -0.45], hipYaw: 0.12, hipPitch: 0.03, hipRoll: -0.05, length: 1.0},
  },
  // Targeted pass 2026-10-28 (pistol lane): compact semi-auto sidearm, 9 mm (ammo_pistol). Starting weapon once
  // its real model is in (weapons/pistol.ts PISTOL_ART_READY); view offsets suit a short pistol held out in front.
  pistol: {
    id: 'pistol', itemId: 'pistol', ammoItem: 'ammo_pistol', magazine: 15, auto: false, interval: 0.16,
    damage: 17, pellets: 1, spreadHip: 0.022, spreadAim: 0.006, spreadMove: 0.025,
    range: 60, falloffStart: 22, falloffMin: 0.6, headMult: 2.4, limbMult: 0.7, knockback: 0.18,
    reload: {kind: 'magazine', time: 1.4, emptyTime: 1.65},
    recoil: {pitch: 0.016, yaw: 0.005, kick: 0.03, recover: 11},
    equipTime: 0.35, aimFov: 58, moveMult: 1.0, noise: 24, sound: 'pistol',
    view: {model: 'pistol', hip: [0.17, -0.2, -0.42], aim: [0.0, -0.08, -0.36], hipYaw: 0.08, hipPitch: 0.03, hipRoll: -0.04, length: 0.2},
  },
};

export type WeaponPhase = 'none' | 'equipping' | 'idle' | 'reloading';

export type WeaponEvent =
  | {type: 'fire'; def: WeaponDef}
  | {type: 'dry'; def: WeaponDef}
  | {type: 'reloadStart'; def: WeaponDef; empty: boolean}
  | {type: 'shellIn'; def: WeaponDef}
  | {type: 'reloadEnd'; def: WeaponDef}
  | {type: 'equipped'; def: WeaponDef};

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

  equip(stack: ItemStack | null, defs = WEAPONS): void {
    if (stack === this.stack && stack) return;
    this.stack = stack;
    this.def = stack ? defs[stack.itemId] ?? null : null;
    this.phase = this.def ? 'equipping' : 'none';
    this.phaseT = this.def ? this.def.equipTime : 0;
    this.cooldown = 0;
    this.progress = 0;
  }

  get reloading(): boolean {
    return this.phase === 'reloading';
  }

  canReload(inv: Inventory): boolean {
    const d = this.def, s = this.stack;
    return !!d && !!s && (s.mag ?? 0) < d.magazine && inv.count(d.ammoItem) > 0;
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
    if (this.phase === 'reloading') {
      if (input.pressed && d.reload.kind === 'shell' && (s.mag ?? 0) > 0) this.interruptReload = true;
      this.phaseT -= dt;
      if (d.reload.kind === 'magazine') {
        const total = (s.mag ?? 0) === 0 ? d.reload.emptyTime : d.reload.time;
        this.progress = 1 - Math.max(0, this.phaseT) / total;
        if (this.phaseT <= 0) {
          const need = d.magazine - (s.mag ?? 0);
          s.mag = (s.mag ?? 0) + inv.take(d.ammoItem, need);
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
            if (inv.take(d.ammoItem, 1) === 1) {
              s.mag = (s.mag ?? 0) + 1;
              inv.version++;
              ev.push({type: 'shellIn', def: d});
            }
            if ((s.mag ?? 0) >= d.magazine || inv.count(d.ammoItem) === 0 || this.interruptReload) {
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

  /** Damage multiplier by distance. */
  static falloff(d: WeaponDef, dist: number): number {
    if (dist <= d.falloffStart) return 1;
    if (dist >= d.range) return d.falloffMin;
    const t = (dist - d.falloffStart) / (d.range - d.falloffStart);
    return 1 + (d.falloffMin - 1) * t;
  }
}
