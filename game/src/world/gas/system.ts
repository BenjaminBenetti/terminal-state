// Task gasmask-breach-20261030 (lane GAS): breached office windows let the infectious green fog in. installGas(game) is called
// ONCE from the Game constructor (after installTower: its section build reads the tower's windows) and only REGISTERS:
// - bulletHitHandlers (Game.fire, before the damage system): a bullet / pellet ray into an office window opening, with the
//   damage Game.fire deals for it — world/windowBreach.ts attributes it to a pane and subtracts that real damage from the
//   pane's health once (task gas-mask-roof-feedback-20261030: PANE_MAX_HP = 3 pistol bullets; no per-pull counting); the
//   pull's first ray on a pane plays the existing glass impact cue + a small burst, every ray glass chips; the first damage
//   cracks the pane, reaching PANE_MAX_HP breaks it (shards, a bounded glass burst, the existing breakGlass cue) and starts its
//   gas. Pane hits leave no plaster crater in the opening;
// - frameHooks (play dt only: menus / loading / warm-up / death never tick): the gas field's fixed 10 Hz tick
//   (world/gas/field.ts) — off-camera storeys keep simulating — uploads of the changed storeys' layers to the volumetric
//   pass (render/volumetric.ts setGasLayer), and ONE exposure calculation at the eye: c = max(concentrationAt(eye), the roof's
//   outside atmosphere GAS.ROOF_OUTDOOR_C · roofBlend(eye) — task gas-mask-roof-feedback-20261030, item 10: the roof deck is
//   outdoors, the same weight as its green fog, ramping through the hatch, 0 on every indoor floor);
//   dps = DPS_MAX · clamp((c − THRESHOLD) / (1 − THRESHOLD), 0, 1) -> player.takeDamage(dps · dt) unless `protection()`
//   (never the hit pipeline: no limb trauma; never per breach / per source); `exposure` (c, protected, dps, source) for QA and
//   the cough feedback; the HUD tag / hint / green vignette (ui/gasHud.ts) and, when the volumetric pass is not running, a green
//   haze ∝ the eye concentration of the breach gas;
// - sectionHooks: build = the office world's panes (the tower built its windows just before) + the saved pane state from RUN's
//   lane store WINDOWS_LANE, with the gas fast-forwarded from the saved breaches (ages capped at AGE_CAP_S, coarse steps);
//   teardown = save it (Subway <-> Office travel; Retry restores the level-entry memories, NewGame starts a fresh run);
// - stateListeners: leaving play hides the HUD.
// The Subway (no office windows, no roof) is inert: no handler ever claims a hit, no field exists, no outdoor exposure.
// No infection state, enemy effect or AI change; intact windows and the green sky do nothing.
//
// Task track1-siren-blightbelly-20261031 (lane BLIGHT): TEMPORARY LOCAL PUFFS (world/gas/puff.ts) — addPuff({id, level, x, y,
// z, radius?, peak?, durationS?}) on ANY level / storey, the Subway too (a Blightbelly's death cloud). Each puff is a small
// bounded field round its burst on that storey's grid (walls, storey isolation, the same diffusion / tick), created on demand
// and disposed when it expires; the breach field, the roof and the window handling are unchanged. ONE exposure calculation:
// c = max(min(GAS.CAP, breach field + puffs) at the eye, roof outdoor) -> the same threshold / dps / protection (mask + filter)
// / HUD / cough path; the puffs' cells share their storey's volumetric gas layer, composed with the breach field on upload.
// No puff: one more boolean in the fast path. Section build / teardown clear the puffs (never saved: no re-emission).

import * as THREE from 'three';
import type {Vec3, WorldHit} from '../../combat/hitscan';
import type {StationLayout} from '../../gen/stationTypes';
import {CELL} from '../../gen/grid';
import type {WindowPlan, WindowView} from '../officeWindows';
import {WINDOWS_LANE, WindowBreaches, paneCentre, sourceCells, type Breach, type PaneRef} from '../windowBreach';
import {roofAirOf, roofBlend, type RoofAir} from '../roofAir'; // task gas-mask-roof-feedback-20261030 (item 10): the toxic roof
import {GasHud} from '../../ui/gasHud';
import {GAS, GasField} from './field';
import {GasPuffs, type PuffGrid, type PuffSpec} from './puff'; // task track1-siren-blightbelly-20261031 (lane BLIGHT)

/** What the gas system needs from Game (structural: tests drive it with a fake host). */
export interface GasHost {
  player: {x: number; z: number; y: number; eye: number; alive: boolean; takeDamage(amount: number): void};
  layout: StationLayout;
  /** The office tower runtime (its windows: plans + merged view; null on the Subway). */
  tower: {office: {info: {exterior: {x0: number; z0: number; x1: number; z1: number}}; windows: {plans: WindowPlan[]; view: WindowView} | null} | null};
  atmosphere: {active: boolean; setGasLayer(slot: number, field: ArrayLike<number>, rect: {x0: number; y0: number; w: number; h: number}): void};
  atmosphereBypass?: string | null;
  fx?: {impact(pos: THREE.Vector3, normal: THREE.Vector3, surface: 'glass', opts?: {decal?: boolean; chips?: number; dust?: number}): void} | null;
  damage?: {burst(point: THREE.Vector3, normal: THREE.Vector3, dir: THREE.Vector3, cls: 'glass', surface: THREE.Color, k?: number, sizeK?: number): number} | null;
  sfx?: {impact(x: number, y: number, z: number, surface: 'glass'): void; breakage(cue: 'breakGlass', x: number, y: number, z: number, strength?: number): void} | null;
  /** RUN (Game.run is replaced by NewGame: always read through the host). */
  run: {laneStore<T = unknown>(lane: string): T | undefined; setLaneStore(lane: string, data: unknown): void};
  /** Game time (advances only while the world updates). */
  readonly clock: number;
  state: string;
  frameHooks: ((dt: number) => void)[];
  sectionHooks: {build?(layout: StationLayout): void; teardown?(): void}[];
  stateListeners?: ((state: never, prev: never) => void)[];
  /** `shot` = the trigger pull; `damage` = what Game.fire deals for this ray (weapon damage x range falloff). */
  bulletHitHandlers?: ((wh: WorldHit, point: THREE.Vector3, dir: THREE.Vector3, shot: number, damage: number) => boolean)[];
}

/** Where this frame's exposure comes from: the breach-gas field, the roof's outside atmosphere, or nothing (clean air). */
export type GasSource = 'field' | 'outdoor' | null;

/**
 * This frame's exposure (QA / HUD / the cough player): `c` = max(field c at the eye, outdoor c), `outdoor` = the outdoor part
 * (GAS.ROOF_OUTDOOR_C x the roof blend), `source` = which one `c` is (null below GAS.HUD_MIN), `dps` = the damage being applied
 * (0 when protected / below the threshold), `damage` = total gas damage dealt.
 */
export interface GasExposure {
  c: number; protected: boolean; dps: number; damage: number; outdoor: number; source: GasSource;
  /** Task track1-siren-blightbelly-20261031 (lane BLIGHT): the temporary puffs' part of `c` (QA; already inside c). */
  puff?: number;
}

const GLASS = new THREE.Color(0xc9d8dc);
const tv = new THREE.Vector3(), tn = new THREE.Vector3(), td = new THREE.Vector3();

export class GasSystem {
  /** The office world's panes (null on the Subway / between worlds). */
  windows: WindowBreaches | null = null;
  /** The gas of the office world (null on the Subway / between worlds). */
  field: GasField | null = null;
  /**
   * Integration point (lane MASK / primary): the player is protected from the gas right now (mask on the face, transition
   * complete, filter > 0). Default: never protected.
   */
  protection: () => boolean = () => false;
  /** Integration point: the HUD hint while in gas ("Put on your gas mask (Q)" / "No filter" …). */
  hintFor: (protectedNow: boolean) => string = p => (p ? '' : 'Put on your gas mask (Q)');
  /** This frame's exposure. */
  readonly exposure: GasExposure = {c: 0, protected: false, dps: 0, damage: 0, outdoor: 0, source: null, puff: 0};
  /** Task track1-siren-blightbelly-20261031 (lane BLIGHT): temporary local puffs of the current world (any level / storey). */
  readonly puffs = new GasPuffs();
  /** Task gas-mask-roof-feedback-20261030 (item 10): the office roof (its outside atmosphere; null on the Subway / between worlds). */
  roof: RoofAir | null = null;
  /** Counters (QA / tests). */
  readonly counts = {impacts: 0, damage: 0, cracked: 0, broken: 0, passThrough: 0, uploads: 0};
  readonly hud = new GasHud();

  constructor(readonly host: GasHost) {}

  install(): this {
    const h = this.host;
    h.sectionHooks.push({build: layout => this.build(layout), teardown: () => this.teardown()});
    h.frameHooks.push(dt => this.frame(dt));
    h.bulletHitHandlers?.push((wh, point, dir, shot, damage) => this.bulletHit(wh, point, dir, shot, damage));
    h.stateListeners?.push(((s: string) => { if (s !== 'playing') this.hud.clear(); }) as (state: never, prev: never) => void);
    return this;
  }

  // -------------------------------------------------------------------------------------------
  // World lifecycle

  build(layout: StationLayout): void {
    this.clear();
    this.roof = roofAirOf(layout);
    // the elevator shaft is closed on every storey (breach field and puffs alike)
    const shaft = layout.office?.elevator?.shaft;
    const closed = shaft ? (cx: number, cy: number) => {
      const x = (cx + 0.5) * CELL, z = (cy + 0.5) * CELL;
      return x > shaft.x0 && x < shaft.x1 && z > shaft.z0 && z < shaft.z1;
    } : undefined;
    // lane BLIGHT: puffs may start on any storey of this world (layout.levels index; a single-level station = its grid)
    const levels = layout.levels?.length ? layout.levels : [{id: 0, grid: layout.grid}];
    this.puffs.world = {grid: lv => (levels[lv]?.grid as PuffGrid | undefined) ?? null, closed};
    const o = this.host.tower.office, w = o?.windows;
    if (!o || !w) return;
    this.windows = new WindowBreaches(w.plans, w.view);
    // the fields cover the tower footprint (+ the closed ring)
    const ex = o.info.exterior;
    const domain = {x0: Math.floor(ex.x0 / CELL) - 1, y0: Math.floor(ex.z0 / CELL) - 1, x1: Math.ceil(ex.x1 / CELL) + 1, y1: Math.ceil(ex.z1 / CELL) + 1};
    const storeys = new Set(w.plans.map(p => p.level));
    this.field = new GasField(layout.levels.filter(l => storeys.has(l.id)).map(l => ({id: l.id, grid: l.grid})), {domain, closed});
    const rec = this.host.run.laneStore(WINDOWS_LANE);
    if (rec !== undefined) this.fastForward(this.windows.restore(rec, this.host.clock));
    this.upload();
  }

  teardown(): void {
    if (this.windows) {
      try { this.host.run.setLaneStore(WINDOWS_LANE, this.windows.save(this.host.clock)); } catch (err) { console.warn('gas: saving the window state failed', err); }
    }
    this.clear();
  }

  private clear(): void {
    this.windows = null;
    this.field = null;
    this.roof = null;
    this.puffs.clear(); // lane BLIGHT: temporary puffs never outlive their world (never saved: no re-emission on a revisit)
    this.puffs.world = null;
    Object.assign(this.exposure, {c: 0, protected: false, dps: 0, damage: 0, outdoor: 0, source: null, puff: 0});
    this.hud.clear();
  }

  /**
   * Restored breaches: replay the gas from the oldest (capped) breach age in coarse steps, each breach starting at its own
   * age — bounded by AGE_CAP_S whatever the real time away.
   */
  private fastForward(list: readonly Breach[]): void {
    const f = this.field;
    if (!f || !list.length) return;
    const sorted = [...list].sort((a, b) => b.age - a.age);
    const T = Math.min(GAS.AGE_CAP_S, sorted[0].age);
    let t = 0;
    for (const b of sorted) {
      const start = T - Math.min(GAS.AGE_CAP_S, b.age);
      if (start > t) { f.advance(start - t); t = start; }
      this.startGas(b.ref);
    }
    if (T > t) f.advance(T - t);
  }

  private startGas(ref: PaneRef): boolean {
    const f = this.field, grid = this.host.layout.levels[ref.plan.level]?.grid;
    if (!f || !grid) return false;
    return f.addBreach({id: ref.id, level: ref.plan.level, cells: sourceCells(ref, grid)});
  }

  /**
   * Changed storeys' fields -> their volumetric layers (at most once per tick each). Lane BLIGHT: a storey with live puffs
   * uploads the breach field + its puffs (saturating at GAS.CAP); a changed / just-expired puff uploads its own rect composed
   * with the breach field there (an expired one clears its cells once). Without puffs: exactly the old uploads.
   */
  private upload(): void {
    const f = this.field, P = this.puffs;
    const puffLevels = P.active ? P.levels() : null;
    if (f) {
      const rect = f.rect;
      for (const s of f.drainChanged()) {
        this.host.atmosphere.setGasLayer(s.level, puffLevels?.has(s.level) ? this.compose(s.level, rect, s.c) : s.c, rect);
        this.counts.uploads++;
      }
    }
    for (const p of P.drainChanged()) {
      const rect = p.rect, st = f?.storey(p.level);
      this.host.atmosphere.setGasLayer(p.level, this.compose(p.level, rect, st ? null : undefined), rect);
      this.counts.uploads++;
    }
  }

  private scratch = new Float32Array(0);
  /**
   * Lane BLIGHT: the layer values of `rect` on storey `level` = min(GAS.CAP, breach field + live puffs). `base` = the breach
   * storey's own array over `rect` (its full upload), `null` = sample the breach storey into the rect, undefined = no breach gas.
   * Cost: a copy of the rect + the puffs' own cells (each puff domain is at most 31 x 31 cells).
   */
  private compose(level: number, rect: {x0: number; y0: number; w: number; h: number}, base: Float32Array | null | undefined): Float32Array {
    const n = rect.w * rect.h;
    if (this.scratch.length < n) this.scratch = new Float32Array(n);
    const out = this.scratch.subarray(0, n);
    if (base) out.set(base.subarray(0, n)); else out.fill(0);
    const st = base === null ? this.field?.storey(level) ?? null : null;
    if (st) {
      const fr = this.field!.rect;
      for (let y = 0; y < rect.h; y++) {
        const ly = rect.y0 + y - fr.y0;
        if (ly < 0 || ly >= fr.h) continue;
        for (let x = 0; x < rect.w; x++) {
          const lx = rect.x0 + x - fr.x0;
          if (lx >= 0 && lx < fr.w) out[y * rect.w + x] = st.c[ly * fr.w + lx];
        }
      }
    }
    for (const p of this.puffs.list) {
      if (p.level !== level) continue;
      const x0 = Math.max(rect.x0, p.ox), y0 = Math.max(rect.y0, p.oy), x1 = Math.min(rect.x0 + rect.w, p.ox + p.dw), y1 = Math.min(rect.y0 + rect.h, p.oy + p.dh);
      for (let cy = y0; cy < y1; cy++) for (let cx = x0; cx < x1; cx++) {
        const i = (cy - rect.y0) * rect.w + (cx - rect.x0), v = out[i] + p.c[(cy - p.oy) * p.dw + (cx - p.ox)];
        out[i] = v > GAS.CAP ? GAS.CAP : v;
      }
    }
    return out;
  }

  /**
   * Lane BLIGHT: a temporary local toxic puff (a Blightbelly's death cloud) on storey `spec.level` of the current world — any
   * level, the Subway too. Bounded / coalesced (world/gas/puff.ts PUFF); false without a world or an open cell there.
   */
  addPuff(spec: PuffSpec): boolean {
    const p = this.puffs.add(spec);
    if (p) this.upload();
    return !!p;
  }

  // -------------------------------------------------------------------------------------------
  // Bullets (Game.fire)

  /**
   * A bullet / pellet ray's world hit dealing `damage` (Game.fire: weapon damage x range falloff for that ray): true = a window
   * opening took it (no crater). On a breakable pane the ray's damage counts once (windowBreach.ts PANE_MAX_HP).
   */
  bulletHit(wh: WorldHit, point: THREE.Vector3, dir: THREE.Vector3, shot: number, damage: number): boolean {
    const W = this.windows;
    if (!W) return false;
    const hit = W.attribute(wh, point, dir);
    if (!hit || !hit.pane) return false; // not an opening / a frame or mullion: the damage system as before
    const p = hit.plan, at = tv.set(hit.at.x, hit.at.y, hit.at.z), normal = tn.set(-p.n[0], 0, -p.n[1]);
    if (!hit.ref) {
      // a generated broken pane: the bullet leaves through the hole; boarded: the boards take it (damage system, as before)
      if (hit.pane.state === 'broken') { this.counts.passThrough++; return true; }
      return false;
    }
    if (W.broken(hit.ref.id)) { this.counts.passThrough++; return true; } // out through the breach
    const r = W.impact(hit.ref, damage, shot, this.host.clock);
    // every ray on the glass: a few chips at the glass; the pull's first ray on this pane: the glass cue + a small burst (cosmetic
    // once per pane per pull — the damage of every ray counts)
    this.host.fx?.impact(at, normal, 'glass', {decal: false, chips: 1});
    if (r.applied > 0) { this.counts.impacts++; this.counts.damage += r.applied; }
    if (r.first) {
      this.host.sfx?.impact(at.x, at.y, at.z, 'glass');
      this.host.damage?.burst(at, normal, td.copy(dir), 'glass', GLASS, 0.5);
    }
    if (r.look === 'cracked') this.counts.cracked++;
    if (r.broke) this.onBreak(hit.ref, dir);
    return true;
  }

  /** A pane just broke: shards (look already set), a bounded glass burst, the break cue, its gas. */
  private onBreak(ref: PaneRef, dir: Vec3 | null): void {
    this.counts.broken++;
    const c = paneCentre(ref), normal = tn.set(c.nx, 0, c.nz);
    const d = td.set(dir?.x ?? -c.nx, dir?.y ?? 0, dir?.z ?? -c.nz).normalize();
    this.host.sfx?.breakage('breakGlass', c.x, c.y, c.z, 1);
    // four bursts spread over the pane (each a few existing glass pieces; the debris pool bounds the total)
    const w = (ref.pane.a1 - ref.pane.a0) * 0.3, hh = (ref.pane.y1 - ref.pane.y0) * 0.3, p = ref.plan;
    for (const [ka, ky] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
      const a = (ref.pane.a0 + ref.pane.a1) / 2 + ka * w;
      tv.set(p.along === 'x' ? a : c.x, c.y + ky * hh, p.along === 'x' ? c.z : a);
      this.host.damage?.burst(tv, normal, d, 'glass', GLASS, 1.2, 1.3);
    }
    this.startGas(ref);
    this.upload();
  }

  /** QA / debug: break a pane outright (its shards, burst, cue and gas as from its last damage). */
  breakPane(id: string): boolean {
    const W = this.windows;
    if (!W || !W.breakNow(id, this.host.clock)) return false;
    this.onBreak(W.refs.get(id)!, null);
    return true;
  }

  // -------------------------------------------------------------------------------------------
  // Per frame (play dt)

  frame(dt: number): void {
    const f = this.field, roof = this.roof, P = this.puffs;
    if (!f && !roof && !P.active) { this.hud.clear(); return; } // lane BLIGHT: + one boolean (no puff)
    if (f) f.tick(dt);
    if (P.active) P.tick(dt);
    this.upload();
    // ONE exposure calculation per frame at the eye: the breach-gas field and (task gas-mask-roof-feedback-20261030, item 10) the
    // roof's outside atmosphere — c = max(field, outdoor), never a sum (the field has no storey on the roof, the outdoor weight is
    // 0 below the hatch: indoor floors never see the outside air)
    const e = this.exposure;
    const pl = this.host.player;
    // lane BLIGHT: the breach field + the temporary puffs share the gas (saturating at the cap, never stacking beyond it)
    const cPuff = pl.alive && P.active ? P.concentrationAt(pl.x, pl.eye, pl.z) : 0;
    const cField = pl.alive ? Math.min(GAS.CAP, (f ? f.concentrationAt(pl.x, pl.eye, pl.z) : 0) + cPuff) : 0;
    const cOut = pl.alive && roof ? GAS.ROOF_OUTDOOR_C * roofBlend(pl.x, pl.eye, pl.z, roof) : 0;
    const c = Math.max(cField, cOut);
    const raw = GAS.DPS_MAX * Math.min(1, Math.max(0, (c - GAS.THRESHOLD) / (1 - GAS.THRESHOLD)));
    const prot = c >= Math.min(GAS.HUD_MIN, GAS.THRESHOLD) ? this.protection() : false;
    const dps = prot ? 0 : raw;
    e.c = c; e.protected = prot; e.dps = dps; e.outdoor = cOut; e.puff = cPuff;
    e.source = c < GAS.HUD_MIN ? null : cOut > cField ? 'outdoor' : 'field';
    if (dps > 0 && dt > 0 && pl.alive) { pl.takeDamage(dps * dt); e.damage += dps * dt; }
    // the fallback haze stands in for the volumetric breach gas only: the roof's outdoor murk is the scene fog, always drawn
    const haze = (!!this.host.atmosphereBypass || !this.host.atmosphere.active) && e.source === 'field';
    this.hud.update({c, protected: prot, dps, dpsMax: GAS.DPS_MAX, min: GAS.HUD_MIN, hint: c >= GAS.HUD_MIN ? this.hintFor(prot) : '', haze});
  }
}

/** Installs the breached-window gas into a Game (one call in the Game constructor, after installTower). */
export function installGas(host: GasHost): GasSystem {
  return new GasSystem(host).install();
}
