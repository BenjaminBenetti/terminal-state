// Task gasmask-breach-20261030 (lane GAS): bullets crack and break the office tower's exterior window panes.
//
// Attribution (Game.fire -> bulletHitHandlers, BEFORE the damage system): bullets never hit the glass mesh — Levels.raycast
// stops at the room-side face of the solid window wall cell (kind 'wall' on storey `level`), ~0.28 m in front of the glass. A
// hit counts for a pane when that face is a window span's (within FACE_TOL of plan.inner, facing the room, inside the opening)
// and the ray, continued to the glass plane, lands inside the pane rectangle (minus a MULLION margin at its sides; y within
// its sill..transom..head). The nearest-hit pipeline already resolved occlusion (an enemy / corpse / prop / stock in front
// takes the bullet), and each pellet has exactly one world hit — so one pellet ray is at most one contribution to one pane.
//
// Health (task gas-mask-roof-feedback-20261030, user item 2: "Just give the windows health tuned to 3 pistol shots"): a pane
// has PANE_MAX_HP = 3 x the weapon table's ordinary pistol bullet damage (WEAPONS.pistol.damage 17 -> 51; derived, never a
// literal). Every unobstructed bullet / pellet ray attributed to it subtracts that ray's REAL damage once — exactly what
// Game.fire deals there (def.damage x range falloff; no fake pellet multiplier). So 3 pistol bullets break it, a rifle needs 3
// (2 x 24 = 48 < 51), a shotgun blast breaks it when >= 4 of its 15-damage pellets land on it (a well-centred blast does), and
// a blast with only some pellets on the pane contributes only those. The old one-impact-per-pane-per-pull rule is gone (the
// pull id only keeps the glass cue / small burst to once per pane per pull — cosmetics, never the damage). Panes take damage
// independently; the pane looks cracked from its first damage and breaks once at >= PANE_MAX_HP, once: a broken pane never
// takes damage again (bullets pass out through the hole: no crater). The knife never reaches this (Game.meleeContact has its
// own surface path). Generated broken / boarded panes are inert (no damage, no gas); a generated-cracked pane starts at full
// health. Collision is never changed (the wall cell stays solid, the span collider stays).
//
// State: damage / broken / breach time per touched pane, in memory for the office world (seamless: never rebuilt by floor
// travel); save() / restore() carry it across a rebuild (Subway <-> Office travel, Retry) through RUN's lane store (v 2:
// `damage`; a legacy v 1 `hits` counter converts to damage = min(PANE_MAX_HP, hits x PANE_MAX_HP / 3) — never refilled).

import type {Vec3, WorldHit} from '../combat/hitscan';
import {CELL, SOLID} from '../gen/grid';
import {WEAPONS} from '../weapons/weapons';
import {paneBreakable, paneId, setPaneLook, type PaneLook, type PanePlan, type WindowPlan, type WindowView} from './officeWindows';

export const WINDOW_BREACH = {
  /** Ordinary pistol bullets a pane's health is worth (PANE_MAX_HP = this x WEAPONS.pistol.damage). */
  PISTOL_SHOTS: 3,
  /** Legacy v 1 records only: the trigger-pull impacts that broke a pane under the old counter (hits -> damage conversion). */
  LEGACY_HITS_TO_BREAK: 3,
  /** A wall hit counts within this distance (m) of the window wall's room-side face. */
  FACE_TOL: 0.35,
  /** Frame / mullion margin (m) at a pane's sides. */
  MULLION: 0.03,
  /** Breach age (s) kept across a rebuild (the gas is fast-forwarded at most this far). */
  AGE_CAP_S: 90,
} as const;

/** A pane's health (damage points): three ordinary pistol bullets, derived from the weapon table (3 x 17 = 51). */
export const PANE_MAX_HP: number = WINDOW_BREACH.PISTOL_SHOTS * WEAPONS.pistol.damage;
/** Accumulated damage within this of PANE_MAX_HP breaks the pane (float sums of falloff-scaled pellets). */
const HP_EPS = 1e-6;

/** RUN lane store key (per section memory) of the panes' state. */
export const WINDOWS_LANE = 'office.windows';

/** A breakable pane (plan + pane + identity). */
export interface PaneRef { id: string; plan: WindowPlan; pane: PanePlan }

/** Where a bullet met a window opening: a pane (at = the point on the glass plane) or, null pane, a frame / inert pane. */
export interface PaneHit { ref: PaneRef | null; plan: WindowPlan; pane: PanePlan | null; at: Vec3 }

/**
 * The state of a touched pane: accumulated damage (0..PANE_MAX_HP), broken, breach time; `lastShot` = the last trigger pull that
 * touched it (cosmetics only: the glass cue / small burst once per pane per pull).
 */
export interface PaneState { damage: number; broken: boolean; brokenAt: number; lastShot: number }

/** What one bullet / pellet ray did to a pane. */
export interface PaneImpact {
  /** Damage this ray contributed (0: already broken / no damage). */
  applied: number;
  /** This pull's first ray on the pane (the glass cue + small burst play once per pane per pull). */
  first: boolean;
  /** The pane's look changed (cracked on its first damage / broken at full damage). */
  look: PaneLook | null;
  broke: boolean;
  /** The pane's accumulated damage after this ray. */
  damage: number;
}

/** Saved state (JSON-safe, v 2): accumulated damage of unbroken panes, ages (s, capped) of broken ones. */
export interface WindowsRecord { v: 2; damage: Record<string, number>; broken: Record<string, number> }
/** The pre-health record (v 1): trigger-pull impact counts of unbroken panes (restore converts them; never written again). */
export interface LegacyWindowsRecord { v: 1; hits: Record<string, number>; broken: Record<string, number> }

/** A breach (a pane bullets broke) and its age. */
export interface Breach { ref: PaneRef; age: number }

export class WindowBreaches {
  /** Every breakable pane by id. */
  readonly refs = new Map<string, PaneRef>();
  /** Touched panes. */
  readonly state = new Map<string, PaneState>();
  private readonly byLevel = new Map<number, WindowPlan[]>();

  constructor(readonly plans: readonly WindowPlan[], private readonly view: WindowView | null = null) {
    for (const p of plans) {
      let l = this.byLevel.get(p.level);
      if (!l) this.byLevel.set(p.level, (l = []));
      l.push(p);
      for (const pane of p.panes) if (paneBreakable(p, pane)) { const id = paneId(p, pane); this.refs.set(id, {id, plan: p, pane}); }
    }
  }

  /**
   * The window opening a bullet's world hit went into (`point` = the hit on the wall face, `dir` = unit ray direction), or
   * null when it is not a window opening (the damage system handles it as before).
   */
  attribute(wh: WorldHit, point: Vec3, dir: Vec3): PaneHit | null {
    if (wh.kind !== 'wall' || wh.level === undefined || wh.level < 0) return null;
    const list = this.byLevel.get(wh.level);
    if (!list) return null;
    const M = WINDOW_BREACH.MULLION;
    for (const p of list) {
      // the room-side face of this span's wall: facing the room, within FACE_TOL of plan.inner, inside the opening
      if (-(wh.nx * p.n[0] + wh.nz * p.n[1]) < 0.7) continue;
      const c = p.along === 'x' ? point.z : point.x, a = p.along === 'x' ? point.x : point.z;
      if (Math.abs(c - p.inner) > WINDOW_BREACH.FACE_TOL) continue;
      if (a < p.a0 - 0.01 || a > p.a1 + 0.01 || point.y < p.y0 - 0.01 || point.y > p.y1 + 0.01) continue;
      // continue the ray to the glass plane (it travels outward through the reveal)
      const out = p.n[0] + p.n[1], dc = p.along === 'x' ? dir.z : dir.x;
      if (dc * out <= 1e-4) continue;
      const t = (p.glass - c) / dc;
      const at: Vec3 = {x: point.x + dir.x * t, y: point.y + dir.y * t, z: point.z + dir.z * t};
      const ga = p.along === 'x' ? at.x : at.z;
      for (const pane of p.panes) {
        if (ga < pane.a0 + M || ga > pane.a1 - M || at.y < pane.y0 || at.y > pane.y1) continue;
        const ref = paneBreakable(p, pane) ? this.refs.get(paneId(p, pane)) ?? null : null;
        return {ref, plan: p, pane, at};
      }
      return {ref: null, plan: p, pane: null, at};
    }
    return null;
  }

  /** A pane's state (created on first touch). */
  private touch(id: string): PaneState {
    let s = this.state.get(id);
    if (!s) this.state.set(id, (s = {damage: 0, broken: false, brokenAt: 0, lastShot: -1}));
    return s;
  }

  /** The pane is broken (by bullets). */
  broken(id: string): boolean {
    return this.state.get(id)?.broken === true;
  }

  /**
   * One bullet / pellet ray of trigger pull `shot` on a breakable pane at game time `clock`, dealing `damage` (what Game.fire deals
   * for that ray: weapon damage x range falloff): its damage counts once, the pane cracks on its first damage and breaks (once)
   * when the accumulated damage reaches PANE_MAX_HP. A broken pane takes nothing.
   */
  impact(ref: PaneRef, damage: number, shot: number, clock: number): PaneImpact {
    const s = this.touch(ref.id);
    if (s.broken) return {applied: 0, first: false, look: null, broke: false, damage: s.damage};
    const first = s.lastShot !== shot;
    s.lastShot = shot;
    const d = Number.isFinite(damage) && damage > 0 ? damage : 0;
    if (d <= 0) return {applied: 0, first, look: null, broke: false, damage: s.damage};
    s.damage = Math.min(PANE_MAX_HP, s.damage + d);
    if (s.damage >= PANE_MAX_HP - HP_EPS) {
      s.damage = PANE_MAX_HP;
      s.broken = true;
      s.brokenAt = clock;
      this.show(ref.id, 'broken');
      return {applied: d, first, look: 'broken', broke: true, damage: s.damage};
    }
    return {applied: d, first, look: this.show(ref.id, 'cracked') ? 'cracked' : null, broke: false, damage: s.damage};
  }

  /** QA / debug: break a pane outright (as if its last damage landed now). False when unknown or already broken. */
  breakNow(id: string, clock: number): boolean {
    const ref = this.refs.get(id);
    if (!ref || this.broken(id)) return false;
    const s = this.touch(id);
    s.damage = PANE_MAX_HP;
    s.broken = true;
    s.brokenAt = clock;
    this.show(id, 'broken');
    return true;
  }

  private show(id: string, look: PaneLook): boolean {
    return this.view ? setPaneLook(this.view, id, look) : false;
  }

  /** Broken panes with their age at `clock` (s). */
  breaches(clock: number): Breach[] {
    const out: Breach[] = [];
    for (const [id, s] of this.state) if (s.broken) { const ref = this.refs.get(id); if (ref) out.push({ref, age: Math.max(0, clock - s.brokenAt)}); }
    return out;
  }

  /** JSON-safe state for the lane store (v 2: damage to 1e-3, breach ages capped at AGE_CAP_S). */
  save(clock: number): WindowsRecord {
    const damage: Record<string, number> = {}, broken: Record<string, number> = {};
    for (const [id, s] of this.state) {
      if (s.broken) broken[id] = Math.round(Math.min(WINDOW_BREACH.AGE_CAP_S, Math.max(0, clock - s.brokenAt)) * 1000) / 1000;
      else if (s.damage > 0) damage[id] = Math.max(0.001, Math.round(s.damage * 1000) / 1000);
    }
    return {v: 2, damage, broken};
  }

  /**
   * Restore a saved state at game time `clock` (looks applied; unknown ids ignored). v 2 `damage` comes back as saved (capped at
   * PANE_MAX_HP); a legacy v 1 `hits` counter becomes damage = min(PANE_MAX_HP, hits x PANE_MAX_HP / LEGACY_HITS_TO_BREAK).
   * Broken stays broken, whatever else the record says; nothing is refilled. Returns the restored breaches with their ages (the
   * gas is fast-forwarded from them).
   */
  restore(rec: unknown, clock: number): Breach[] {
    const r = rec as {v?: unknown; damage?: Record<string, unknown>; hits?: Record<string, unknown>; broken?: Record<string, unknown>} | null;
    if (!r || typeof r !== 'object' || (r.v !== 1 && r.v !== 2)) return [];
    const dmg = new Map<string, number>();
    const add = (id: string, d: number) => { if (this.refs.has(id) && d > 0) dmg.set(id, Math.max(dmg.get(id) ?? 0, Math.min(PANE_MAX_HP, d))); };
    for (const [id, n] of Object.entries(r.hits ?? {})) add(id, Math.floor(Number(n) || 0) * PANE_MAX_HP / WINDOW_BREACH.LEGACY_HITS_TO_BREAK);
    if (r.v === 2) for (const [id, d] of Object.entries(r.damage ?? {})) add(id, Number(d) || 0);
    const out: Breach[] = [];
    for (const [id, age] of Object.entries(r.broken ?? {})) {
      const ref = this.refs.get(id);
      if (!ref) continue;
      const a = Math.min(WINDOW_BREACH.AGE_CAP_S, Math.max(0, Number(age) || 0));
      const s = this.touch(id);
      s.damage = PANE_MAX_HP;
      s.broken = true;
      s.brokenAt = clock - a;
      this.show(id, 'broken');
      out.push({ref, age: a});
      dmg.delete(id);
    }
    for (const [id, d] of dmg) {
      const s = this.touch(id);
      s.damage = d;
      this.show(id, 'cracked');
    }
    return out;
  }
}

/** The pane's centre on the glass plane and its room-facing normal (x, z). */
export function paneCentre(ref: PaneRef): {x: number; y: number; z: number; nx: number; nz: number} {
  const p = ref.plan, a = (ref.pane.a0 + ref.pane.a1) / 2, y = (ref.pane.y0 + ref.pane.y1) / 2;
  return {x: p.along === 'x' ? a : p.glass, y, z: p.along === 'x' ? p.glass : a, nx: -p.n[0], nz: -p.n[1]};
}

/**
 * Gas source cells of a broken pane: the open cells of its storey grid on the room side of the window wall whose centres lie
 * along the pane (grid indices). Falls back to the nearest open cell straight into the room (≤ 1 m).
 */
export function sourceCells(ref: PaneRef, grid: {w: number; h: number; cells: ArrayLike<number>}): number[] {
  const p = ref.plan, out = p.n[0] + p.n[1];
  const open = (cx: number, cy: number) => cx >= 0 && cy >= 0 && cx < grid.w && cy < grid.h && grid.cells[cy * grid.w + cx] !== SOLID;
  const cells: number[] = [];
  for (let step = 0; step < 3 && !cells.length; step++) {
    const c = p.inner - out * CELL * (step + 0.5);
    for (let k = Math.floor(ref.pane.a0 / CELL); k * CELL < ref.pane.a1; k++) {
      const mid = (k + 0.5) * CELL;
      if (mid < ref.pane.a0 || mid > ref.pane.a1) continue;
      const cx = p.along === 'x' ? k : Math.floor(c / CELL), cy = p.along === 'x' ? Math.floor(c / CELL) : k;
      if (open(cx, cy)) cells.push(cy * grid.w + cx);
    }
  }
  return cells;
}
