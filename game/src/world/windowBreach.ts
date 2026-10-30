// Task gasmask-breach-20261030 (lane GAS): bullets crack and break the office tower's exterior window panes.
//
// Attribution (Game.fire -> bulletHitHandlers, BEFORE the damage system): bullets never hit the glass mesh — Levels.raycast
// stops at the room-side face of the solid window wall cell (kind 'wall' on storey `level`), ~0.28 m in front of the glass. A
// hit counts for a pane when that face is a window span's (within FACE_TOL of plan.inner, facing the room, inside the opening)
// and the ray, continued to the glass plane, lands inside the pane rectangle (minus a MULLION margin at its sides; y within
// its sill..transom..head). The nearest-hit pipeline already resolved occlusion (an enemy / corpse / prop / stock in front
// takes the bullet), and each pellet has exactly one world hit — so one pellet is at most one candidate.
//
// Counting: at most ONE impact per pane per trigger pull (the pull's shot id): 9 shotgun pellets on one pane = 1 impact (it
// needs 3 blasts like any gun); one blast across two panes counts one each. Panes count independently. The knife never
// reaches this (Game.meleeContact has its own surface path). HITS_TO_BREAK impacts break a pane, once: a broken pane never
// counts again (bullets pass out through the hole: no crater). Generated broken / boarded panes are inert (no count, no gas);
// a generated-cracked pane counts from 0. Collision is never changed (the wall cell stays solid, the span collider stays).
//
// State: hits / broken / breach time per touched pane, in memory for the office world (seamless: never rebuilt by floor
// travel); save() / restore() carry it across a rebuild (Subway <-> Office travel, Retry) through RUN's lane store.

import type {Vec3, WorldHit} from '../combat/hitscan';
import {CELL, SOLID} from '../gen/grid';
import {paneBreakable, paneId, setPaneLook, type PaneLook, type PanePlan, type WindowPlan, type WindowView} from './officeWindows';

export const WINDOW_BREACH = {
  /** Impacts (at most one per pane per trigger pull) that break a pane. */
  HITS_TO_BREAK: 3,
  /** A wall hit counts within this distance (m) of the window wall's room-side face. */
  FACE_TOL: 0.35,
  /** Frame / mullion margin (m) at a pane's sides. */
  MULLION: 0.03,
  /** Breach age (s) kept across a rebuild (the gas is fast-forwarded at most this far). */
  AGE_CAP_S: 90,
} as const;

/** RUN lane store key (per section memory) of the panes' state. */
export const WINDOWS_LANE = 'office.windows';

/** A breakable pane (plan + pane + identity). */
export interface PaneRef { id: string; plan: WindowPlan; pane: PanePlan }

/** Where a bullet met a window opening: a pane (at = the point on the glass plane) or, null pane, a frame / inert pane. */
export interface PaneHit { ref: PaneRef | null; plan: WindowPlan; pane: PanePlan | null; at: Vec3 }

/** The state of a touched pane. */
export interface PaneState { hits: number; broken: boolean; brokenAt: number; lastShot: number }

/** What one bullet did to a pane. */
export interface PaneImpact {
  /** This pull's first impact on the pane (counted toward the break). */
  counted: boolean;
  /** The pane's look changed (cracked after the first impact / broken on the last). */
  look: PaneLook | null;
  broke: boolean;
  hits: number;
}

/** Saved state (JSON-safe): hit counts of unbroken panes, ages (s, capped) of broken ones. */
export interface WindowsRecord { v: 1; hits: Record<string, number>; broken: Record<string, number> }

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
    if (!s) this.state.set(id, (s = {hits: 0, broken: false, brokenAt: 0, lastShot: -1}));
    return s;
  }

  /** The pane is broken (by bullets). */
  broken(id: string): boolean {
    return this.state.get(id)?.broken === true;
  }

  /**
   * One bullet / pellet of trigger pull `shot` on a breakable pane at game time `clock`: counts the pull's first impact on it,
   * cracks it on the first impact, breaks it on the HITS_TO_BREAK-th (once).
   */
  impact(ref: PaneRef, shot: number, clock: number): PaneImpact {
    const s = this.touch(ref.id);
    if (s.broken || s.lastShot === shot) return {counted: false, look: null, broke: false, hits: s.hits};
    s.lastShot = shot;
    s.hits++;
    if (s.hits >= WINDOW_BREACH.HITS_TO_BREAK) {
      s.broken = true;
      s.brokenAt = clock;
      this.show(ref.id, 'broken');
      return {counted: true, look: 'broken', broke: true, hits: s.hits};
    }
    return {counted: true, look: this.show(ref.id, 'cracked') ? 'cracked' : null, broke: false, hits: s.hits};
  }

  /** QA / debug: break a pane outright (as if its last impact landed now). False when unknown or already broken. */
  breakNow(id: string, clock: number): boolean {
    const ref = this.refs.get(id);
    if (!ref || this.broken(id)) return false;
    const s = this.touch(id);
    s.hits = WINDOW_BREACH.HITS_TO_BREAK;
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

  /** JSON-safe state for the lane store (breach ages capped at AGE_CAP_S). */
  save(clock: number): WindowsRecord {
    const hits: Record<string, number> = {}, broken: Record<string, number> = {};
    for (const [id, s] of this.state) {
      if (s.broken) broken[id] = Math.round(Math.min(WINDOW_BREACH.AGE_CAP_S, Math.max(0, clock - s.brokenAt)) * 1000) / 1000;
      else if (s.hits > 0) hits[id] = s.hits;
    }
    return {v: 1, hits, broken};
  }

  /**
   * Restore a saved state at game time `clock` (looks applied; unknown ids ignored). Returns the restored breaches with their
   * ages (the gas is fast-forwarded from them).
   */
  restore(rec: unknown, clock: number): Breach[] {
    const r = rec as Partial<WindowsRecord> | null;
    if (!r || r.v !== 1) return [];
    for (const [id, n] of Object.entries(r.hits ?? {})) {
      if (!this.refs.has(id) || !(n > 0)) continue;
      const s = this.touch(id);
      s.hits = Math.min(WINDOW_BREACH.HITS_TO_BREAK - 1, Math.floor(n));
      this.show(id, 'cracked');
    }
    const out: Breach[] = [];
    for (const [id, age] of Object.entries(r.broken ?? {})) {
      const ref = this.refs.get(id);
      if (!ref) continue;
      const a = Math.min(WINDOW_BREACH.AGE_CAP_S, Math.max(0, Number(age) || 0));
      const s = this.touch(id);
      s.hits = WINDOW_BREACH.HITS_TO_BREAK;
      s.broken = true;
      s.brokenAt = clock - a;
      this.show(id, 'broken');
      out.push({ref, age: a});
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
