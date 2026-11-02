// Task reactor-build-20261101 (lane RESTART): THE REACTOR's restart runtime — the industrial controls, their in-world feedback, the
// status screens, the HUD objective line and THE WIN. installReactorRestart(game) is called ONCE from the Game constructor and only
// REGISTERS (like world/towerRuntime.ts / gear/system.ts); it is inert on every level without `layout.reactor`:
// - sectionHooks: build = read the persisted record (runState.ts REACTOR_LANE, RESTART's fields), build the
//   control overlays (world/reactor/restartViews.ts) at layout.reactor.sites[].controls and the canvas screens at
//   layout.reactor.screens, restore the visuals (a restarted reactor comes back restarted with its lights on: no replay); teardown =
//   save + dispose. Travel keeps the record (section memory), Retry restores the level-entry snapshot, NewGame starts clean.
// - interactHandlers (E) + frameHooks: the control under the crosshair (within REACH, in sight — a Levels ray to a point just in front
//   of the panel, so no control is ever operated through a wall — and no living enemy in front of it); press controls act at once,
//   HOLD controls (breaker 1 s, valve 3 s, rods 4 s) fill the crosshair hold ring (hud.setHoldRing) and animate the handle / handwheel
//   — releasing E, looking away, taking a hit, climbing, a menu or death lets go with nothing done. Every completed action is
//   persisted immediately (read-modify-write of the shared record: lane AIR's generators / zoneClear are kept as stored).
// - promptProviders: the control's prompt; inputOwners: no shot / ADS while a hold runs; hitListeners: a hit lets go;
//   stateListeners: leaving play lets go; warmRegistry pool 'reactor-restart' (hidden seated cartridges / the key in the switch).
// - THE WIN (world/reactor/restartWin.ts WinSequence): the core glows up, tier lighting + fans sequence up the pit bottom-up
//   (reactorVisuals().setCoreGlow / setTierPower / setFanSpeed), the light pool's powered circuit 2 ramps with it
//   (world/lights.ts StationLighting.circuitLevel — the generator marks the powered fixtures `dying`: no re-bake, no shader change),
//   lane AIR's reactorClearAll (world/reactor/generators.ts) once — a rebuilt restarted world is resumed by AIR itself from the
//   stored restartedAt —, the monitors switch to the SURFACE VENTILATION NETWORK, two toasts, and the persistent local milestone
//   (run/milestones.ts) is written once. The run goes on: no forced end, no reset.
// Audio: the lead's Sound Lab machine set through Sfx.reactorCue ('reactorFuse' / 'reactorBreaker' / 'reactorValve' / 'reactorPump' /
// 'reactorStartup') and Sfx.reactorLoop('reactorHum') at the core while the reactor runs (one handle, re-requested while audio is not
// running yet); both are silent when audio / a clip is missing. The key switch uses the existing 'click'.

import * as THREE from 'three';
import type {StationLayout} from '../../gen/stationTypes';
import type {ReactorControl, ReactorInfo} from '../../gen/reactor/reactorTypes';
import {REACTOR_LANE, reactorTasks, type ReactorRunState} from './runState';
import {reactorVisuals, type ReactorVisuals} from './visuals';
import {reactorClearAll} from './generators';
import {
  CONTROL_NAME, HOLD_S, blocker, controlDone, controlPrompt, doneText, isRestartControl, nextStepText, operate, readRestartState,
  taskLine, writeRestartState, type RestartControlId, type RestartEvent, type RestartHints, type RestartInventory, type RestartRun,
} from './restartLogic';
import {VENT_TOWERS, WinSequence, coreGlowAt, planWin, tierPowerAt, type WinPlan, type WinSink} from './restartWin';
import {drawReactorScreen, screenKey, screenPixels, type ScreenModel} from './restartScreens';
import {buildControlView, buildScreenView, fallbackMount, type ControlView, type ScreenView} from './restartViews';
import {preloadReactorItemModels} from './restartItems';
import {reactorMounts, type MountedControl} from './controlsMount'; // task reactor-expansion-20261101 (lane CONTROLS): controls ON their host faces
import {valveWheelPart} from './controlsModel';
import {recordReactorRestarted} from '../../run/milestones';
import {rayCylinder, towerCue, type P3} from '../towerShared';
import {JAM_TEXT, reactorJam, type ReactorJam} from '../../gen/reactor/gasJam'; // task reactor-playtest-round2-20261102 (lane GAS)

export {preloadReactorItemModels};

/** Reach (m, eye to the control's centre) and pick radius per control (m). */
export const RESTART_REACH = 2.3;
const PICK_R: Readonly<Record<RestartControlId, number>> = {'fuse-0': 0.17, 'fuse-1': 0.17, breaker: 0.24, valve: 0.38, pump: 0.24, keyswitch: 0.16, rods: 0.3}; // (lane CONTROLS: valve = the model's wheel, r 0.43 x its fit scale ~0.78)
/** The hold ring shows after this much of a hold (a quick tap never flashes it). */
const RING_DELAY_S = 0.1;
/** AIR's record / the HUD tier line are polled this often (s). */
const POLL_S = 0.25;

/** What the restart runtime needs from Game (structural: tests drive it with a fake host). */
export interface RestartHost {
  scene: THREE.Scene;
  camera: THREE.Camera;
  player: {x: number; y: number; z: number; alive: boolean; climbing?: boolean};
  zombies: readonly {brain: {x: number; z: number; y: number; alive: boolean; stats: {radius: number}}; ragdolled?: boolean}[];
  levels: {raycast(o: P3, d: P3, maxDist: number): {kind: string; t: number}; levelAt(x: number, z: number, y: number): number};
  layout: StationLayout;
  inv: RestartInventory & {version?: number};
  input: {down(code: string): boolean; clears: number};
  hud: {toast(text: string, warn?: boolean): void; setHoldRing?(progress: number | null): void};
  sfx: unknown;
  /** RUN (Game.run is replaced by NewGame: always read through the host). */
  run: RestartRun & {seeds?: Readonly<Record<string, number>>};
  readonly clock: number;
  state: string;
  /** The station lighting (world/lights.ts; replaced per world build). */
  lightPool?: {circuitLevel: [number | null, number | null, number | null] | null} | null;
  interactHandlers: (() => boolean)[];
  frameHooks: ((dt: number) => void)[];
  sectionHooks: {build?(layout: StationLayout): void; teardown?(): void}[];
  promptProviders?: (() => string | null)[];
  stateListeners?: ((state: never, prev: never) => void)[];
  inputOwners?: (() => boolean)[];
  hitListeners?: ((hit: never) => void)[];
  warmRegistry?: {addPool(name: string, roots: () => readonly THREE.Object3D[]): void};
  world?: {culler?: unknown} | null;
}

/** A built control: `m` = its mount on the host face (lane CONTROLS); the pick sphere / cues / in-sight point use m.pick, not c.at. */
interface ControlEntry { id: RestartControlId; c: ReactorControl; level: number; view: ControlView; fx: number; fz: number; r: number; m: MountedControl }

/** The lead's Sfx machine API (audio/sfx.ts MachineCue / MachineLoopCue): duck-typed so tests / an older Sfx stay silent. */
type RestartCue = 'reactorBreaker' | 'reactorFuse' | 'reactorValve' | 'reactorPump' | 'reactorStartup';
interface LoopHandle { setPos(x: number, y: number, z: number): void; stop(fadeS?: number): void; readonly playing: boolean }
interface MachineSfx { reactorCue?(cue: RestartCue, x: number, y: number, z: number): void; reactorLoop?(cue: 'reactorHum', x: number, y: number, z: number): LoopHandle | null }

const runtimes = new WeakMap<object, ReactorRestart>();
/** The runtime installed into a host (QA). */
export const reactorRestartOf = (host: object): ReactorRestart | undefined => runtimes.get(host);

export class ReactorRestart {
  info: ReactorInfo | null = null;
  state: ReactorRunState | null = null;
  readonly controls: ControlEntry[] = [];
  readonly screens: ScreenView[] = [];
  root: THREE.Group | null = null;
  target: ControlEntry | null = null;
  prompt: string | null = null;
  hold: {e: ControlEntry; t: number; clears: number} | null = null;
  win: WinSequence | null = null;
  /** Counters (QA / tests). */
  readonly counts = {presses: 0, holds: 0, completed: 0, refused: 0, letGo: 0, airCalls: 0, milestones: 0, saves: 0, redraws: 0};
  /** Milestone writer (tests replace it): true when written now. */
  recordMilestone: (levelSeed: number) => boolean = seed => recordReactorRestarted(seed);
  /** Lane AIR's whole-pit clearing (tests replace it): false while no Reactor air is built (retried next frame). */
  clearAir: (durationS: number) => boolean = d => reactorClearAll(d);
  /** The restarted core's hum loop (Sfx.reactorLoop handle) or null. */
  humLoop: LoopHandle | null = null;
  /** The powered circuit level last sent (0..1). */
  circuit = 0;
  private plan: WinPlan | null = null;
  private pumpEntry: ControlEntry | null = null;
  private hints: RestartHints = {};
  private version = 0;
  private drawn = -1;
  private airPending: number | null = null;
  private restoring = false;
  private applied: ReactorVisuals | null = null;
  private pollT = 0;
  private airSig = -1;
  private tierLabel = '';
  private objHtml = '';
  /** Task reactor-playtest-round2-20261102 (lane GAS): this world's jammed final generator (the core floor stays gassed until online). */
  private jam: ReactorJam | null = null;
  private objEl: HTMLElement | null = null;
  private coreQ = -1;
  private pumpQ = -1;
  private humT = 0;
  private ring = false;
  private hintT = 0;
  private promptKey = {id: '', version: -1, inv: -1, pct: -1};
  private time = 0;
  private readonly vEye = new THREE.Vector3();
  private readonly vDir = new THREE.Vector3();
  private readonly eye: P3 = {x: 0, y: 0, z: 0};
  private readonly dir: P3 = {x: 0, y: 0, z: 0};
  private readonly qDir: P3 = {x: 0, y: 0, z: 0};
  private readonly model: ScreenModel = {state: null as unknown as ReactorRunState, tiers: [], zones: [], winT: null, towers: [], core: 0, pumpK: 0, next: ''};

  constructor(readonly host: RestartHost) {}

  /** Registers every hook (called once from the Game constructor). */
  install(): this {
    const h = this.host;
    runtimes.set(h, this);
    void preloadReactorItemModels(); // the parts' kit GLBs download with the boot assets (Game.load awaits them)
    h.sectionHooks.push({build: layout => this.build(layout), teardown: () => this.teardown()});
    h.frameHooks.push(dt => this.frame(dt));
    h.interactHandlers.push(() => this.interact());
    h.promptProviders?.push(() => this.prompt);
    h.inputOwners?.push(() => !!this.hold);
    h.hitListeners?.push(((hit: {amount?: number}) => { if (this.hold && (hit?.amount ?? 1) > 0) this.letGo('hit'); }) as (hit: never) => void);
    h.stateListeners?.push(((s: string) => { if (s !== 'playing') { if (this.hold) this.letGo('state'); this.target = null; this.prompt = null; } }) as (state: never, prev: never) => void);
    h.warmRegistry?.addPool('reactor-restart', () => (this.root ? [this.root] : []));
    return this;
  }

  // -------------------------------------------------------------------------------------------
  // World lifecycle

  build(layout: StationLayout): void {
    if (this.info) this.teardown();
    const info = layout.reactor;
    if (!info) return;
    const h = this.host;
    this.info = info;
    this.state = readRestartState(h.run, REACTOR_LANE, info.generators.length, info.zones.length);
    this.hints = {fuse: info.components.find(c => c.item === 'fuse_cartridge')?.where, key: info.components.find(c => c.item === 'reactor_key')?.where};
    this.plan = planWin(info.tiers, info.fans);
    const root = new THREE.Group();
    root.name = 'reactor-restart';
    // task reactor-expansion-20261101 (lane CONTROLS): every control ON its host model's measured face (controlsMount.ts — the same
    // placements lane ARCH's kit draws the machines with), the valve turning the model's own wheel (controlsModel.ts)
    const mounts = reactorMounts(info);
    for (const ms of mounts.sites) {
      const site = ms.site;
      for (const c of site.controls) {
        if (!isRestartControl(c.id) || this.controls.some(e => e.id === c.id)) continue;
        const m = ms.mounts.find(q => q.id === c.id) ?? fallbackMount(c);
        const host = m.placement >= 0 ? ms.hosts[m.placement] : undefined;
        const view = buildControlView(c.id, c, m, host, c.id === 'valve' ? valveWheelPart() : null);
        view.root.traverse(o => { if ((o as THREE.Mesh).isMesh) o.userData.level = site.level; });
        root.add(view.root);
        this.controls.push({id: c.id, c, level: site.level, view, fx: m.fx, fz: m.fz, r: PICK_R[c.id], m});
      }
    }
    const openAt = (x: number, z: number, level: number): boolean => {
      const g = layout.levels?.[level]?.grid ?? (level === 0 ? layout.grid : null);
      if (!g) return true;
      const [cx, cy] = g.cellOf(x, z);
      return g.inBounds(cx, cy) && g.passable(cx, cy);
    };
    for (const sc of info.screens) {
      const {pw, ph} = screenPixels(sc.w, sc.h);
      const v = buildScreenView(sc, pw, ph, openAt);
      root.add(v.mesh);
      this.screens.push(v);
    }
    h.scene.add(root);
    this.root = root;
    this.pumpEntry = this.controls.find(e => e.id === 'pump') ?? null;
    const culler = h.world?.culler as {register?(root: THREE.Object3D): void} | undefined;
    if (culler && typeof culler.register === 'function') culler.register(root);
    // the model's static parts
    const m = this.model;
    m.tiers = info.tiers;
    m.zones = info.zones;
    this.jam = reactorJam(info); // (lane GAS)
    m.jamZone = this.jam?.zone ?? -1;
    m.state = this.state;
    // restore: a restarted reactor is back at its end state (no replay); else every tier dark, the core dormant
    this.win = null;
    this.airPending = null;
    this.circuit = 0;
    if (this.state.restarted) {
      this.win = new WinSequence(this.plan, this.sink);
      this.restoring = true; // lane AIR resumes its own whole-pit clearing from the stored restartedAt: no second clearAll
      this.win.finish();
      this.restoring = false;
    }
    this.setCircuit(this.state.restarted ? 1 : 0);
    this.applyVisuals();
    this.syncViews();
    this.version++;
    this.drawn = -1;
    this.pollT = 0;
    this.airSig = -1;
    this.tierLabel = '';
    this.humT = 1;
    this.ensureObjective();
    this.redrawScreens();
  }

  teardown(): void {
    if (this.info && this.state) this.save();
    if (this.hold) this.letGo('state');
    this.target = null;
    this.prompt = null;
    if (this.root) this.host.scene.remove(this.root);
    for (const s of this.screens) s.dispose();
    this.screens.length = 0;
    this.controls.length = 0;
    this.pumpEntry = null;
    this.root = null;
    this.info = null;
    this.state = null;
    this.win = null;
    this.plan = null;
    this.applied = null;
    this.airPending = null;
    this.humLoop?.stop(0.6);
    this.humLoop = null;
    this.removeObjective();
  }

  /** Persist RESTART's fields now (read-merge-write of the shared record: AIR's keys kept as stored). */
  save(): void {
    const info = this.info, s = this.state;
    if (!info || !s) return;
    try {
      writeRestartState(this.host.run, REACTOR_LANE, info.generators.length, info.zones.length, s);
      this.counts.saves++;
    } catch (err) {
      console.warn('reactor restart: saving the restart state failed', err);
    }
  }

  // -------------------------------------------------------------------------------------------
  // Visuals (ARCH's hooks may register after this build: re-sent whenever the registered object changes)

  private readonly sink: WinSink = {
    coreGlow: k => reactorVisuals().setCoreGlow(k),
    tierPower: (level, k) => reactorVisuals().setTierPower(level, k),
    fanSpeed: (id, k) => reactorVisuals().setFanSpeed(id, k),
    circuit: k => this.setCircuit(k),
    clearAir: d => { if (this.restoring) return; this.airPending = d; this.flushAir(); },
    toast: text => this.host.hud.toast(text),
    towers: () => { this.version++; },
  };

  private setCircuit(k: number): void {
    this.circuit = k;
    const lp = this.host.lightPool;
    if (!lp) return;
    if (!lp.circuitLevel) lp.circuitLevel = [null, null, k];
    else lp.circuitLevel[2] = k;
  }

  /** Hands the pending whole-pit clearing to lane AIR (kept pending, retried each frame, until AIR's air is built). */
  private flushAir(): void {
    if (this.airPending === null) return;
    let ok = false;
    try { ok = this.clearAir(this.airPending); } catch (err) { console.warn('reactor restart: clearing the gas failed', err); ok = true; }
    if (!ok) return;
    this.airPending = null;
    this.counts.airCalls++;
  }

  /** Sends the full current visual state to the registered ARCH visuals. */
  private applyVisuals(): void {
    const v = reactorVisuals(), s = this.state, plan = this.plan;
    this.applied = v;
    if (!s || !plan) return;
    const n = plan.tiers.length, t = this.win ? this.win.t : -1;
    v.setRestartState?.(s, true); // task reactor-expansion-20261101 (lane CORE): the hero's stage, restored instantly (build / reload / new visuals)
    v.setCoreGlow(t >= 0 ? coreGlowAt(t) : 0);
    for (let r = 0; r < n; r++) v.setTierPower(plan.tiers[r], t >= 0 ? tierPowerAt(t, r, n) : 0);
    if (t >= 0) for (const id of plan.fans) if (tierPowerAt(t, plan.fanRank.get(id) ?? 0, n) > 0) v.setFanSpeed(id, 1);
  }

  private syncViews(): void {
    const s = this.state;
    if (!s) return;
    const tasks = reactorTasks(s);
    for (const e of this.controls) e.view.sync(s, tasks);
  }

  // -------------------------------------------------------------------------------------------
  // Per frame (while playing)

  frame(dt: number): void {
    this.time += dt;
    const info = this.info, s = this.state;
    if (!info || !s) { this.prompt = null; return; }
    if (reactorVisuals() !== this.applied) this.applyVisuals();
    this.flushAir();
    if (this.win && !this.win.done) {
      this.win.step(dt);
      const q = Math.round(coreGlowAt(this.win.t) * 20);
      if (q !== this.coreQ) { this.coreQ = q; this.version++; }
    }
    this.updateTarget();
    this.updateHold(dt);
    for (const e of this.controls) e.view.animate(dt, this.hold?.e === e ? Math.min(1, this.hold.t / HOLD_S[e.id]) : 0);
    const pump = this.pumpEntry;
    const pq = pump ? Math.round(pump.view.spool * 20) : s.pump ? 20 : 0;
    if (pq !== this.pumpQ) { this.pumpQ = pq; this.version++; }
    this.pollT -= dt;
    if (this.pollT <= 0) { this.pollT = POLL_S; this.poll(); }
    if (this.version !== this.drawn) this.redrawScreens();
    this.hum(dt);
  }

  /** 4 Hz: lane AIR's generator / clearing record (pit board lamps), the HUD objective + tier line. */
  private poll(): void {
    const info = this.info!, s = this.state!;
    const raw = this.host.run.laneStore<{generators?: {started?: boolean}[]; zoneClear?: number[]}>(REACTOR_LANE);
    let sig = 0;
    if (raw && typeof raw === 'object') {
      const g = Array.isArray(raw.generators) ? raw.generators : [], z = Array.isArray(raw.zoneClear) ? raw.zoneClear : [];
      for (let i = 0; i < info.generators.length; i++) {
        const on = g[i]?.started === true;
        sig = (sig * 3 + (on ? 1 : 2)) % 1e9;
        if (s.generators[i]) { s.generators[i].started = on; }
      }
      for (let i = 0; i < info.zones.length; i++) {
        const c = typeof z[i] === 'number' && Number.isFinite(z[i]) ? Math.max(0, Math.min(1, z[i])) : 0;
        s.zoneClear[i] = c;
        sig = (sig * 11 + Math.round(c * 10)) % 1e9;
      }
    }
    if (sig !== this.airSig) { this.airSig = sig; this.version++; }
    // the tier the player is on (HUD)
    const P = this.host.player;
    let lv = -1;
    try { lv = this.host.levels.levelAt(P.x, P.z, P.y); } catch { lv = -1; }
    const tier = info.tiers.find(t => t.level === lv);
    this.tierLabel = tier ? tier.label : this.tierLabel;
    this.updateObjective();
  }

  /** The restarted core's hum: ONE Sfx.reactorLoop handle at the core (re-requested about once a second while audio is not up). */
  private hum(dt: number): void {
    const s = this.state!, info = this.info!;
    if (!s.restarted || (this.humLoop && this.humLoop.playing)) return;
    this.humT -= dt;
    if (this.humT > 0) return;
    this.humT = 1;
    const sfx = this.host.sfx as MachineSfx | null;
    if (typeof sfx?.reactorLoop !== 'function') return;
    this.humLoop = sfx.reactorLoop('reactorHum', info.core.x, (info.core.y0 + info.core.y1) / 2, info.core.z);
  }

  // -------------------------------------------------------------------------------------------
  // Targeting / interaction

  /**
   * The control under the crosshair: the nearest pick sphere the view ray enters within RESTART_REACH, in sight (a Levels ray from
   * the eye to a point 0.18 m in front of the panel is clear), no living enemy in front of it. Allocation-free.
   */
  pick(): ControlEntry | null {
    const h = this.host;
    if (!h.player.alive || !this.controls.length) return null;
    h.camera.getWorldPosition(this.vEye); h.camera.getWorldDirection(this.vDir);
    const E = this.eye, D = this.dir;
    E.x = this.vEye.x; E.y = this.vEye.y; E.z = this.vEye.z;
    D.x = this.vDir.x; D.y = this.vDir.y; D.z = this.vDir.z;
    let best: ControlEntry | null = null, bt = Infinity;
    for (const e of this.controls) {
      const a = e.m.pick, ox = a.x - E.x, oy = a.y - E.y, oz = a.z - E.z; // (lane CONTROLS: the mounted overlay's centre)
      const dist2 = ox * ox + oy * oy + oz * oz;
      if (dist2 > RESTART_REACH * RESTART_REACH) continue;
      const tca = ox * D.x + oy * D.y + oz * D.z;
      if (tca <= 0) continue;
      const d2 = dist2 - tca * tca, r2 = e.r * e.r;
      if (d2 > r2) continue;
      const t = tca - Math.sqrt(r2 - d2);
      if (t < bt) { bt = t; best = e; }
    }
    if (!best) return null;
    // in sight: a point just in front of the panel (room side), so a wall between never lets you operate it
    const a = best.m.pick, qx = a.x + best.fx * 0.18, qz = a.z + best.fz * 0.18;
    const Q = this.qDir;
    Q.x = qx - E.x; Q.y = a.y - E.y; Q.z = qz - E.z;
    const len = Math.hypot(Q.x, Q.y, Q.z);
    if (len > 1e-3) {
      Q.x /= len; Q.y /= len; Q.z /= len;
      const hit = h.levels.raycast(E, Q, len);
      if (hit.kind !== 'none' && hit.t < len - 0.03) return null;
    }
    // a living enemy in front of the control takes the press (you can always shoot what stands before a panel)
    for (const z of h.zombies) {
      const zb = z.brain;
      if (!zb.alive || z.ragdolled) continue;
      const dx = zb.x - E.x, dz = zb.z - E.z;
      if (dx * dx + dz * dz > (bt + 1) * (bt + 1)) continue;
      if (rayCylinder(E, D, zb.x, zb.z, zb.stats.radius + 0.05, zb.y, zb.y + 1.9, bt) !== null) return null;
    }
    return best;
  }

  private updateTarget(): void {
    const t = this.host.state === 'playing' ? this.pick() : null;
    this.target = t;
    const s = this.state!;
    const e = this.hold ? this.hold.e : t;
    if (!e) { this.prompt = null; this.promptKey.id = ''; return; }
    const pct = this.hold ? Math.floor(Math.min(1, this.hold.t / HOLD_S[e.id]) * 100) : -1;
    const iv = this.host.inv.version ?? -2;
    const k = this.promptKey;
    if (k.id === e.id && k.version === this.version && k.inv === iv && k.pct === pct && this.prompt) return;
    k.id = e.id; k.version = this.version; k.inv = iv; k.pct = pct;
    this.prompt = controlPrompt(s, e.id, this.host.inv, this.hold ? pct / 100 : null);
  }

  /** E (Game.interactHandlers): operate / start holding the control under the crosshair; true = handled. */
  interact(): boolean {
    if (!this.info || !this.state || this.host.state !== 'playing') return false;
    if (this.hold) return true;
    const e = this.pick();
    if (!e) return false;
    this.counts.presses++;
    const s = this.state;
    const at = this.cueAt(e);
    if (controlDone(s, e.id)) {
      this.host.hud.toast(doneText(s, e.id));
      towerCue(this.host.sfx, 'click', at, {rate: 1.3, gain: 0.6});
      return true;
    }
    const why = blocker(s, e.id, this.host.inv, this.hints);
    if (why) {
      this.counts.refused++;
      this.host.hud.toast(why, true);
      towerCue(this.host.sfx, 'denied', at, {gain: 0.8});
      return true;
    }
    if (HOLD_S[e.id] > 0) {
      this.hold = {e, t: 0, clears: this.host.input.clears};
      this.counts.holds++;
      if (e.id === 'valve') towerCue(this.host.sfx, 'creak', at, {rate: 0.8, gain: 0.8});
      else towerCue(this.host.sfx, 'click', at, {rate: 0.9, gain: 0.7});
      return true;
    }
    this.complete(e.id);
    return true;
  }

  private updateHold(dt: number): void {
    const H = this.hold, h = this.host;
    if (H) {
      const need = HOLD_S[H.e.id];
      if (!h.input.down('KeyE')) { if (H.t < need) this.letGo('released'); }
      else if (h.input.clears !== H.clears || !h.player.alive || h.player.climbing || this.target !== H.e) this.letGo('away');
      else {
        H.t += dt;
        if (H.t >= need) { this.hold = null; this.complete(H.e.id); }
      }
    }
    const R = this.hold;
    const show = !!R && R.t >= RING_DELAY_S;
    if (show) { h.hud.setHoldRing?.(Math.min(1, R!.t / HOLD_S[R!.e.id])); this.ring = true; }
    else if (this.ring) { h.hud.setHoldRing?.(null); this.ring = false; }
  }

  /** Let go of a hold with nothing done. */
  letGo(why: 'released' | 'away' | 'hit' | 'state'): void {
    const H = this.hold;
    if (!H) return;
    this.hold = null;
    this.counts.letGo++;
    if (this.ring) { this.host.hud.setHoldRing?.(null); this.ring = false; }
    if (why === 'hit') this.host.hud.toast(`Hit! You let go of the ${CONTROL_NAME[H.e.id]}`, true);
    else if (why === 'released' && this.time - this.hintT > 2.5) { this.hintT = this.time; this.host.hud.toast(`Keep holding E — the ${CONTROL_NAME[H.e.id]} takes ${HOLD_S[H.e.id]} s`); }
  }

  private cueAt(e: ControlEntry): P3 {
    return {x: e.m.pick.x + e.fx * 0.1, y: e.m.pick.y, z: e.m.pick.z + e.fz * 0.1};
  }

  /** A completed press / hold: the rules (restartLogic.operate: the part is consumed exactly once), persistence, feedback, the win. */
  complete(id: RestartControlId): {ok: boolean; why?: string; event?: RestartEvent} {
    const s = this.state, info = this.info;
    if (!s || !info) return {ok: false, why: 'no reactor here'};
    const res = operate(s, id, this.host.inv, this.host.clock, this.hints);
    if (!res.ok) { this.counts.refused++; this.host.hud.toast(res.why, !res.done); return {ok: false, why: res.why}; }
    this.counts.completed++;
    this.save();
    reactorVisuals().setRestartState?.(s, false); // task reactor-expansion-20261101 (lane CORE): every state change -> the hero's stage visuals
    this.syncViews();
    this.version++;
    const e = this.controls.find(x => x.id === id);
    const at = e ? this.cueAt(e) : {x: info.core.x, y: info.core.y1, z: info.core.z};
    const toast = (t: string) => this.host.hud.toast(t);
    switch (res.event.type) {
      case 'fuse':
        this.cue('reactorFuse', at, ['clank', {rate: 1.5, gain: 0.6}]);
        toast(res.event.installed >= s.fuses.length ? 'Fuse cartridge seated — both slots filled: close the main breaker' : `Fuse cartridge seated (${res.event.installed} of ${s.fuses.length})`);
        break;
      case 'breaker': this.cue('reactorBreaker', at, ['clank', {rate: 0.7, gain: 1}]); toast('Main breaker closed — control power ON'); break;
      case 'valve': this.cue('reactorValve', at, ['clank', {rate: 1.1, gain: 0.8}]); toast('Main coolant valve open'); break;
      case 'pump': this.cue('reactorPump', at, ['trainDistant', {rate: 1.6, gain: 0.5}]); toast('Circulation pump started — coolant flowing'); break;
      case 'key': towerCue(this.host.sfx, 'click', at, {rate: 1.1, gain: 0.9}); towerCue(this.host.sfx, 'click', at, {rate: 0.8, gain: 0.8, delay: 0.18}); toast('Startup key in — switched to RUN'); break;
      case 'rods': this.startWin(); break;
    }
    return {ok: true, event: res.event};
  }

  private startWin(): void {
    const info = this.info!;
    this.win = new WinSequence(this.plan!, this.sink);
    this.coreQ = -1;
    this.cue('reactorStartup', {x: info.core.x, y: (info.core.y0 + info.core.y1) / 2, z: info.core.z}, ['trainDistant', {rate: 0.6, gain: 1}]);
    this.host.hud.toast('Control rods withdrawn — the core is waking');
    this.humT = 2.5; // the hum swells in after the startup cue
    const run = this.host.run as {seeds?: {reactor?: number}; seedFor?: () => number};
    const seed = run.seedFor?.() ?? run.seeds?.reactor ?? this.host.layout.seed; // (campaign: the Reactor NODE's own seed)
    try { if (this.recordMilestone(seed)) this.counts.milestones++; } catch { /* storage is optional */ }
  }

  /** The lead's Sound Lab machine one-shot (Sfx.reactorCue); an Sfx without it: an existing accepted cue, pitched, as the stand-in. */
  private cue(name: RestartCue, at: P3, fallback: [string, {rate?: number; gain?: number}]): void {
    const sfx = this.host.sfx as MachineSfx | null;
    if (typeof sfx?.reactorCue === 'function') sfx.reactorCue(name, at.x, at.y, at.z);
    else towerCue(this.host.sfx, fallback[0], at, fallback[1]);
  }

  // -------------------------------------------------------------------------------------------
  // Screens + HUD

  private screenModel(): ScreenModel {
    const m = this.model, s = this.state!;
    m.state = s;
    m.winT = s.restarted ? (this.win ? this.win.t : Infinity) : null;
    m.towers = this.win ? this.win.towerStates() : VENT_TOWERS.map(() => 'standby');
    m.core = this.win ? coreGlowAt(this.win.t) : 0;
    const pump = this.pumpEntry;
    m.pumpK = s.pump ? (pump ? pump.view.spool : 1) : 0;
    m.next = nextStepText(s, this.info!, this.host.inv, this.jamGassed() ? {levels: this.jam!.levels, note: JAM_TEXT.next} : null); // (lane GAS: + the mask note)
    return m;
  }

  /** (lane GAS) The jammed zone is still gassed: the reactor is not online and its air not cleared. */
  private jamGassed(): boolean {
    const s = this.state, j = this.jam;
    return !!s && !!j && !s.restarted && (s.zoneClear[j.zone] ?? 0) < 1;
  }

  /** Redraw the screens whose content changed (only after a state / AIR / win-step change — never per frame). */
  redrawScreens(): void {
    this.drawn = this.version;
    if (!this.screens.length || !this.state) return;
    const m = this.screenModel();
    for (const v of this.screens) {
      const key = screenKey(v.id, m);
      if (key === v.key) continue;
      v.key = key;
      const ctx = typeof v.canvas?.getContext === 'function' ? v.canvas.getContext('2d') as CanvasRenderingContext2D | null : null;
      if (!ctx) continue;
      drawReactorScreen(ctx, v.id, m, v.pw, v.ph);
      v.texture.needsUpdate = true;
      this.counts.redraws++;
    }
  }

  private ensureObjective(): void {
    if (typeof document === 'undefined' || typeof document.querySelector !== 'function') return;
    const host = document.querySelector('#objective');
    if (!host) return;
    if (!document.querySelector('#reactor-obj-css')) {
      const st = document.createElement('style');
      st.id = 'reactor-obj-css';
      st.textContent = '#reactor-objective{margin-top:4px;font-size:12px;letter-spacing:.04em;color:var(--cream-dim,#b9b2a1)}'
        + '#reactor-objective .rt.done{color:#7fd38a}#reactor-objective .rt.ready{color:var(--cream,#efe6cf)}#reactor-objective .rt.blocked{opacity:.55}'
        + '#reactor-objective .tier{margin-top:2px;font-size:11px;opacity:.85}'
        + '#reactor-objective .jam{margin-top:2px;font-size:11px;color:#ff8a6a}'; // (lane GAS)
      document.head?.appendChild(st);
    }
    let el = document.querySelector('#reactor-objective') as HTMLElement | null;
    if (!el) { el = document.createElement('div'); el.id = 'reactor-objective'; host.appendChild(el); }
    this.objEl = el;
    this.objHtml = '';
    this.updateObjective();
  }

  private updateObjective(): void {
    const s = this.state;
    if (!s) return;
    const line = s.restarted
      ? (this.win && !this.win.done ? 'Reactor restarted — surface ventilation towers powering up' : 'Reactor running · surface ventilation towers online')
      : `Restart the reactor — ${taskLine(s).html}`;
    const jam = this.jamGassed() ? `<div class="jam">${JAM_TEXT.objective}</div>` : ''; // (lane GAS) the core floor needs the mask
    const html = `<div>${line}</div>${jam}${this.tierLabel ? `<div class="tier">${this.tierLabel}</div>` : ''}`;
    if (html === this.objHtml) return;
    this.objHtml = html;
    if (this.objEl) this.objEl.innerHTML = html;
  }

  private removeObjective(): void {
    this.objEl?.remove?.();
    this.objEl = null;
    this.objHtml = '';
  }

  /** The HUD objective markup (QA / tests). */
  get objective(): string {
    return this.objHtml;
  }

  // -------------------------------------------------------------------------------------------
  // QA

  /** A compact state report (QA / __LL.reactorRestart()). */
  qa(): object {
    const s = this.state;
    return {
      reactor: !!this.info, state: s ? {fuses: [...s.fuses], breaker: s.breaker, valve: s.valve, pump: s.pump, keyInserted: s.keyInserted, rods: s.rods, restarted: s.restarted, restartedAt: s.restartedAt} : null,
      tasks: s ? reactorTasks(s) : null, controls: this.controls.map(e => ({id: e.id, level: e.level, at: e.c.at, pick: e.m.pick, host: e.m.host, stand: e.c.stand, done: s ? controlDone(s, e.id) : false})),
      screens: this.screens.map(v => ({id: v.id, drawn: v.key !== ''})), target: this.target?.id ?? null, prompt: this.prompt,
      hold: this.hold ? {id: this.hold.e.id, t: +this.hold.t.toFixed(2)} : null,
      win: this.win ? {t: +this.win.t.toFixed(2), done: this.win.done, towers: this.win.towerStates()} : null,
      circuit: +this.circuit.toFixed(3), lightCircuit: this.host.lightPool?.circuitLevel ?? null, objective: this.objHtml, counts: {...this.counts},
      visualsRegistered: this.applied !== null, airPending: this.airPending, hum: this.humLoop ? this.humLoop.playing : null,
      machineAudio: typeof (this.host.sfx as MachineSfx | null)?.reactorCue === 'function',
    };
  }

  /**
   * QA / tests: operate a control by id through the same rules as a real press / completed hold (no aim / reach / hold time). `give`
   * adds the part it needs first (DEBUG: the level's own parts stay where they are).
   */
  qaOperate(id: string, give?: (itemId: string) => void): {ok: boolean; why?: string} {
    if (!isRestartControl(id)) return {ok: false, why: `unknown control ${id}`};
    if (give && (id === 'fuse-0' || id === 'fuse-1') && this.host.inv.count('fuse_cartridge') < 1) give('fuse_cartridge');
    if (give && id === 'keyswitch' && this.host.inv.count('reactor_key') < 1) give('reactor_key');
    const r = this.complete(id);
    return {ok: r.ok, why: r.why};
  }

  /** QA: jump the running win sequence to its end. */
  qaFinishWin(): boolean {
    if (!this.win) return false;
    this.win.finish();
    this.version++;
    return true;
  }
}

/** Installs the restart runtime into a Game (one call in the Game constructor). */
export function installReactorRestart(host: RestartHost): ReactorRestart {
  return new ReactorRestart(host).install();
}
