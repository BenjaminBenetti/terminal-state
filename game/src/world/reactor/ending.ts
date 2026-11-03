// Task studio-reactor-surface-ending-20261102 (lane ENDING): THE SURFACE EXIT at runtime — installReactorEnding(game) is called ONCE from
// the Game constructor and only REGISTERS (inert on every level without `layout.reactor.surface`):
//  - sectionHooks: build = read the persisted phase (runState.ts ReactorRunState.ending), build the exterior door (endingViews.ts) at
//    layout.reactor.surface.door and the parapet ring round the opening on the surface deck, SEAL the doorway while the phase is sealed
//    (its rim-grid cells closed: walking bodies, bullets and sight stop; the door's lamp red); teardown = restore the generated cells, save,
//    dispose. A rebuilt / revisited world with the doors open starts open and docked: nothing replays.
//  - frameHooks (play time only): THE TRIGGER — the reactor restarted and every gas zone fully clear (the core floor's jammed zone clears
//    only through the win's clearAll, now 20 s: REACTOR_AIR.CLEAR_ALL_S) -> the doors open once (persisted at once), the leaves slide
//    (ENDING.doorOpenS, the doorway walkable when they are open), the centre-screen "External doors open" message holds ENDING.centreS
//    play seconds and moves into the left objective area, where it IS the objective line (objectiveText.ts OBJECTIVE_TEXT.ending.doors,
//    through ReactorRestart.objectiveStage); standing on the surface storey -> the "surface reached" line.
//  - promptProviders: the sealed door's locked prompt; stateListeners: the message is hidden (and holds) outside play (pause, inventory).
// Limits: the AI path graph is built before the section hooks (game.ts), so enemies do not plan through a door that opens mid-visit until
// the next build (they never need to: the stair and the surface are a dead-end pocket behind it).

import * as THREE from 'three';
import type {StationLayout} from '../../gen/stationTypes';
import type {ReactorInfo, ReactorSurface} from '../../gen/reactor/reactorTypes';
import {SOLID} from '../../gen/grid';
import type {WorldMaterials} from '../materials';
import {reactorDress} from './archMaterials';
import {surfaceDoorCells} from '../../gen/reactor/surface';
import {REACTOR_LANE, loadReactorState, type ReactorEndingState} from './runState';
import {ENDING, coreAirCleared, doorOpenAt, endingStage, messageAt, openedEnding, type MessagePhase} from './endingLogic';
import {OBJECTIVE_TEXT} from './objectiveText';
import {buildDoorView, ringGeometry, type DoorView} from './endingViews';
import {controlSkin} from './controlsSkin';
import {reactorRestartOf} from './restart';
import {reactorAirRuntime} from './generators';
import {towerCue} from '../towerShared';

/** What the ending runtime needs from Game (structural: tests drive it with a fake host). */
export interface EndingHost {
  scene: THREE.Scene;
  camera: THREE.Camera;
  player: {x: number; y: number; z: number; alive: boolean};
  layout: StationLayout;
  levels: {levelAt(x: number, z: number, y: number): number};
  run: {laneStore<T = unknown>(lane: string): T | undefined; setLaneStore(lane: string, v: unknown): void};
  readonly clock: number;
  state: string;
  hud: {toast(text: string, warn?: boolean): void};
  sfx: unknown;
  sectionHooks: {build?(layout: StationLayout): void; teardown?(): void}[];
  frameHooks: ((dt: number) => void)[];
  promptProviders?: (() => string | null)[];
  stateListeners?: ((state: never, prev: never) => void)[];
  warmRegistry?: {addPool(name: string, roots: () => readonly THREE.Object3D[]): void};
  /** The world materials (the parapet ring's concrete: the kit's); absent = a plain stand-in. */
  mats?: unknown;
}

const runtimes = new WeakMap<object, ReactorEnding>();
/** The runtime installed into a host (QA / tests). */
export const reactorEndingOf = (host: object): ReactorEnding | undefined => runtimes.get(host);

/** Poll period of the persisted record when the live AIR / RESTART runtimes are not this host's (s). */
const POLL_S = 0.25;

export class ReactorEnding {
  info: ReactorInfo | null = null;
  surface: ReactorSurface | null = null;
  /** The live phase (persisted on every change). */
  ending: ReactorEndingState = {doors: false, openedAt: 0, announced: false, surfaced: false};
  root: THREE.Group | null = null;
  door: DoorView | null = null;
  ring: THREE.Group | null = null;
  /** The doorway's rim-grid cells and their generated state (restored on open / teardown). */
  private doorCells: number[] = [];
  private doorSaved: {cell: number; c: number; a: number; f: number; ceil: number}[] = [];
  private sealedNow = false;
  /** Seconds since the leaves started opening (null: not opening this world; open already = at rest). */
  private openT: number | null = null;
  /** Play seconds since the centre message appeared (null: none this world). */
  msgT: number | null = null;
  private msgPhase: MessagePhase = 'none';
  private msgEl: HTMLElement | null = null;
  prompt: string | null = null;
  private pollT = 0;
  private polled: {restarted: boolean; zoneClear: number[]} = {restarted: false, zoneClear: []};
  private readonly vEye = new THREE.Vector3();
  private readonly vDir = new THREE.Vector3();
  /** Counters (QA / tests). */
  readonly counts = {builds: 0, opened: 0, messages: 0, docked: 0, saves: 0, surfaced: 0, sealedBuilds: 0};

  constructor(readonly host: EndingHost) {}

  install(): this {
    const h = this.host;
    runtimes.set(h, this);
    h.sectionHooks.push({build: layout => this.build(layout), teardown: () => this.teardown()});
    h.frameHooks.push(dt => this.frame(dt));
    h.promptProviders?.push(() => this.prompt);
    h.stateListeners?.push(((s: string) => { this.showMessage(s === 'playing'); if (s !== 'playing') this.prompt = null; }) as (state: never, prev: never) => void);
    h.warmRegistry?.addPool('reactor-ending', () => (this.root ? [this.root] : []));
    return this;
  }

  // -------------------------------------------------------------------------------------------
  // World lifecycle

  build(layout: StationLayout): void {
    if (this.info) this.teardown();
    const info = layout.reactor, s = info?.surface;
    if (!info || !s) return;
    this.info = info;
    this.surface = s;
    this.counts.builds++;
    const st = loadReactorState(this.host.run.laneStore(REACTOR_LANE), info.generators.length, info.zones.length);
    this.ending = {...st.ending};
    this.polled = {restarted: st.restarted, zoneClear: st.zoneClear.slice()};
    const root = new THREE.Group();
    root.name = 'reactor-ending';
    this.door = buildDoorView(s);
    root.add(this.door.root);
    this.ring = buildRing(s, info, this.host.mats);
    if (this.ring) root.add(this.ring);
    this.host.scene.add(root);
    this.root = root;
    // the doorway: generated open; sealed until the phase opens it
    const g = layout.levels[s.door.level]?.grid ?? layout.grid;
    this.doorCells = surfaceDoorCells(s, g);
    this.doorSaved = this.doorCells.map(i => ({cell: i, c: g.cells[i], a: g.area[i], f: g.floor[i], ceil: g.ceil[i]}));
    this.openT = null;
    this.msgT = null;
    this.setMsgPhase('none');
    if (this.ending.doors) { this.unseal(); this.door.set(1); }
    else { this.seal(); this.door.set(0); this.counts.sealedBuilds++; }
    // opened but never announced (a record from elsewhere): the message shows once now
    if (this.ending.doors && !this.ending.announced) this.startMessage();
    this.hookObjective();
    this.prompt = null;
  }

  teardown(): void {
    if (!this.info) return;
    this.unseal(); // the layout's grids keep their generated state (a rebuild re-seals from the record)
    this.save();
    this.setMsgPhase('none');
    this.msgT = null;
    if (this.root) this.host.scene.remove(this.root);
    this.door?.dispose();
    this.ring?.traverse(o => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).geometry.dispose(); });
    this.root = null; this.door = null; this.ring = null;
    this.info = null; this.surface = null;
    this.doorCells = []; this.doorSaved = [];
    this.prompt = null;
    const rt = reactorRestartOf(this.host as object);
    if (rt && rt.objectiveStage === this.stageFn) rt.objectiveStage = null;
  }

  /** Persist the phase (read-merge-write of the shared record: AIR's / RESTART's fields kept as stored). */
  save(): void {
    const info = this.info;
    if (!info) return;
    try {
      const cur = loadReactorState(this.host.run.laneStore(REACTOR_LANE), info.generators.length, info.zones.length);
      if (!cur.restarted && this.ending.doors) return; // (never write an open door onto a record that is not restarted)
      cur.ending = {...this.ending};
      this.host.run.setLaneStore(REACTOR_LANE, cur);
      this.counts.saves++;
    } catch (err) { console.warn('reactor ending: saving the phase failed', err); }
  }

  private seal(): void {
    const g = this.grid();
    if (!g) return;
    for (const i of this.doorCells) g.cells[i] = SOLID;
    this.sealedNow = true;
  }

  private unseal(): void {
    const g = this.grid();
    if (!g || !this.sealedNow) return;
    for (const d of this.doorSaved) { g.cells[d.cell] = d.c; g.area[d.cell] = d.a; g.floor[d.cell] = d.f; g.ceil[d.cell] = d.ceil; }
    this.sealedNow = false;
  }

  private grid() {
    const s = this.surface;
    return s ? this.host.layout.levels?.[s.door.level]?.grid ?? this.host.layout.grid : null;
  }

  /** The doorway is closed to bodies / bullets / sight right now. */
  get sealed(): boolean {
    return this.sealedNow;
  }

  // -------------------------------------------------------------------------------------------
  // Per frame (play time)

  frame(dt: number): void {
    const info = this.info, s = this.surface;
    if (!info || !s) { this.prompt = null; return; }
    if (!this.ending.doors && this.clearDone(dt)) this.open();
    if (this.openT !== null) {
      this.openT += dt;
      const k = doorOpenAt(this.openT);
      this.door?.set(k);
      if (k >= 1) { this.openT = null; this.unseal(); towerCue(this.host.sfx, 'clank', this.doorAt(), {rate: 0.7, gain: 0.9}); }
    }
    if (this.msgT !== null) {
      this.msgT += dt;
      this.setMsgPhase(messageAt(this.msgT).phase);
    }
    // the surface reached (standing on its storey)
    if (this.ending.doors && !this.ending.surfaced) {
      const P = this.host.player;
      let lv = -1;
      try { lv = this.host.levels.levelAt(P.x, P.z, P.y); } catch { lv = -1; }
      if (lv === s.level && P.y > s.y - 0.5) { this.ending.surfaced = true; this.counts.surfaced++; this.save(); }
    }
    this.updatePrompt();
  }

  /** The trigger: the restart runtime's / AIR's live state when installed on this host, else the persisted record (4 Hz). */
  private clearDone(dt: number): boolean {
    const info = this.info!;
    const rt = reactorRestartOf(this.host as object), air = reactorAirRuntime(this.host as object)?.air;
    if (rt?.state && air) return coreAirCleared({restarted: rt.state.restarted, zoneClear: info.zones.map(z => air.clearOf(z.id))});
    this.pollT -= dt;
    if (this.pollT <= 0) {
      this.pollT = POLL_S;
      const st = loadReactorState(this.host.run.laneStore(REACTOR_LANE), info.generators.length, info.zones.length);
      this.polled = {restarted: (rt?.state?.restarted ?? false) || st.restarted, zoneClear: st.zoneClear};
    }
    return coreAirCleared(this.polled);
  }

  /** THE EVENT: the doors open (persisted at once), the leaves start, the centre message shows. */
  open(): void {
    if (!this.info || this.ending.doors) return;
    this.ending = openedEnding(this.ending, this.host.clock);
    this.save();
    this.counts.opened++;
    this.openT = 0;
    const at = this.doorAt();
    towerCue(this.host.sfx, 'clank', at, {rate: 0.55, gain: 1});
    towerCue(this.host.sfx, 'creak', at, {rate: 0.6, gain: 0.9, delay: 0.25});
    this.startMessage();
  }

  private doorAt(): {x: number; y: number; z: number} {
    const d = this.surface!.door;
    return {x: d.x + d.nx * 0.4, y: d.y + d.h * 0.6, z: d.z + d.nz * 0.4};
  }

  private startMessage(): void {
    this.msgT = 0;
    this.counts.messages++;
    if (!this.ending.announced) { this.ending.announced = true; this.save(); }
    this.setMsgPhase('centre');
  }

  // -------------------------------------------------------------------------------------------
  // The centre message (DOM; Node: the phases only)

  /** The message's phase now (QA / tests). */
  get messagePhase(): MessagePhase {
    return this.msgPhase;
  }

  private setMsgPhase(p: MessagePhase): void {
    if (p === this.msgPhase) return;
    const was = this.msgPhase;
    this.msgPhase = p;
    if (p === 'centre') this.mountMessage();
    else if (p === 'moving') this.moveMessage();
    else {
      this.unmountMessage();
      if (p === 'docked' && was !== 'none') { this.counts.docked++; flashObjective(); }
    }
  }

  private mountMessage(): void {
    if (typeof document === 'undefined' || typeof document.querySelector !== 'function') return;
    const hud = document.querySelector('#hud');
    if (!hud) return;
    ensureCss();
    const el = document.createElement('div');
    el.id = 'reactor-ending-msg';
    const t = document.createElement('div'), sub = document.createElement('div');
    t.className = 't'; t.textContent = OBJECTIVE_TEXT.ending.message;
    sub.className = 's'; sub.textContent = OBJECTIVE_TEXT.ending.hint;
    el.append(t, sub);
    hud.appendChild(el);
    this.msgEl = el;
    this.showMessage(this.host.state === 'playing');
  }

  /** Centre -> the left objective area: the box flies to #reactor-objective's line and shrinks into it. */
  private moveMessage(): void {
    const el = this.msgEl;
    if (!el || typeof document === 'undefined') return;
    const target = document.querySelector('#reactor-objective') ?? document.querySelector('#objective');
    const a = el.getBoundingClientRect(), b = target?.getBoundingClientRect();
    const dx = b ? b.left - a.left : -a.left + 22, dy = b ? b.top - a.top : -a.top + 18;
    const sc = b && a.width > 0 ? Math.max(0.3, Math.min(1, b.width / a.width)) : 0.4;
    el.style.transition = `transform ${ENDING.moveS}s cubic-bezier(.5,0,.3,1), opacity ${ENDING.moveS}s ease-in`;
    el.style.transformOrigin = '0 0';
    el.style.transform = `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px) scale(${sc.toFixed(3)})`;
    el.style.opacity = '0.35';
  }

  private unmountMessage(): void {
    this.msgEl?.remove?.();
    this.msgEl = null;
  }

  /** Outside play (pause, inventory, menus) the message is hidden — it holds (play time) and shows again on resume. */
  private showMessage(on: boolean): void {
    if (this.msgEl) this.msgEl.style.visibility = on ? 'visible' : 'hidden';
  }

  // -------------------------------------------------------------------------------------------
  // Objective + prompt

  /** The objective stage line (ReactorRestart.objectiveStage): null until the message docked. */
  readonly stageFn = (): string | null => {
    const st = endingStage(this.ending, this.msgPhase);
    return st === 'doors' ? OBJECTIVE_TEXT.ending.doors : st === 'surfaced' ? OBJECTIVE_TEXT.ending.surfaced : null;
  };

  private hookObjective(): void {
    const rt = reactorRestartOf(this.host as object);
    if (rt) rt.objectiveStage = this.stageFn;
  }

  /** The sealed door's prompt: aimed at it (in range, roughly facing it from the deck side). */
  private updatePrompt(): void {
    const s = this.surface;
    if (!s || this.host.state !== 'playing' || !this.sealedNow) { this.prompt = null; return; }
    const d = s.door, cx = d.x + d.nx * 0.3, cy = d.y + d.h / 2, cz = d.z + d.nz * 0.3;
    const cam = this.host.camera;
    if (typeof cam.getWorldPosition !== 'function') { this.prompt = null; return; }
    cam.getWorldPosition(this.vEye); cam.getWorldDirection(this.vDir);
    const ox = cx - this.vEye.x, oy = cy - this.vEye.y, oz = cz - this.vEye.z, L = Math.hypot(ox, oy, oz);
    const facing = (this.vEye.x - d.x) * d.nx + (this.vEye.z - d.z) * d.nz > 0; // on the deck side
    this.prompt = facing && L < ENDING.promptM && (ox * this.vDir.x + oy * this.vDir.y + oz * this.vDir.z) / Math.max(L, 1e-6) > ENDING.promptCos ? OBJECTIVE_TEXT.ending.sealed : null;
  }

  // -------------------------------------------------------------------------------------------
  // QA

  /** A compact report (QA / __LL.reactorEnding()). */
  qa(): object {
    const s = this.surface;
    return {
      surface: !!s, ending: {...this.ending}, sealed: this.sealedNow, opening: this.openT, message: {phase: this.msgPhase, t: this.msgT},
      stage: this.stageFn(), prompt: this.prompt, counts: {...this.counts},
      door: s ? {x: s.door.x, z: s.door.z, y: s.door.y, yaw: s.door.yaw, w: s.door.w, h: s.door.h} : null,
      stairs: s ? {bottom: s.stairs.bottom, top: s.stairs.top} : null, exit: s?.exit ?? null, plaza: s ? {y: s.y, bounds: s.bounds} : null,
    };
  }

  /** QA: open the doors now (the event, as if the air had just cleared); `skipMessage` docks the message at once. */
  qaOpen(skipMessage = false): boolean {
    if (!this.info) return false;
    if (!this.ending.doors) this.open();
    if (skipMessage && this.msgT !== null) { this.msgT = ENDING.centreS + ENDING.moveS; this.setMsgPhase('docked'); }
    return true;
  }
}

/** The barrier round the opening (apron + guard railing; null without a roof line): seen from the plaza and up the shaft. */
function buildRing(s: ReactorSurface, info: ReactorInfo, mats: unknown): THREE.Group | null {
  try {
    const {apron, rail} = ringGeometry(s, info.pit.roofY);
    let concrete: THREE.Material | null = null;
    // the roof curb's concrete (world/reactor/archMaterials.ts reactorDress: the kit's existing material; Node: a plain stand-in)
    if (mats && typeof document !== 'undefined') { try { concrete = reactorDress(mats as WorldMaterials).concrete ?? null; } catch { concrete = null; } }
    const grp = new THREE.Group();
    grp.name = 'reactor-ending-barrier';
    const a = new THREE.Mesh(apron, concrete ?? new THREE.MeshStandardMaterial({color: 0x6c6862, roughness: 0.95}));
    a.name = 'reactor-ending-barrier-apron';
    const r = new THREE.Mesh(rail, controlSkin('yellow'));
    r.name = 'reactor-ending-barrier-rail';
    for (const m of [a, r]) { m.matrixAutoUpdate = false; m.updateMatrix(); grp.add(m); }
    return grp;
  } catch (err) {
    console.warn('reactor ending: the barrier round the opening was skipped', err);
    return null;
  }
}

function ensureCss(): void {
  if (typeof document === 'undefined' || document.querySelector('#reactor-ending-css')) return;
  const st = document.createElement('style');
  st.id = 'reactor-ending-css';
  // the HUD's objective style (styles.css #objective / .obj-title), centred and larger
  st.textContent = '#reactor-ending-msg{position:absolute;left:50%;top:30%;transform:translate(-50%,-50%);background:rgba(20,22,24,0.62);'
    + 'border-left:4px solid var(--mustard,#d9b23a);padding:12px 22px 12px 18px;text-align:left;pointer-events:none;white-space:nowrap}'
    + '#reactor-ending-msg .t{font-size:26px;letter-spacing:.16em;text-transform:uppercase;color:var(--mustard,#d9b23a)}'
    + '#reactor-ending-msg .s{margin-top:4px;font-size:14px;color:var(--cream,#efe6cf);font-weight:500}'
    + '#reactor-objective.ending-new{animation:reactor-ending-new 1.6s ease-out}'
    + '@keyframes reactor-ending-new{0%{color:var(--mustard,#d9b23a)}100%{color:inherit}}';
  document.head?.appendChild(st);
}

function flashObjective(): void {
  if (typeof document === 'undefined' || typeof document.querySelector !== 'function') return;
  const el = document.querySelector('#reactor-objective') as HTMLElement | null;
  if (!el) return;
  el.classList.remove('ending-new');
  void el.offsetWidth;
  el.classList.add('ending-new');
}

/** Installs the ending runtime into a Game (one call in the Game constructor, after RESTART / AIR). */
export function installReactorEnding(host: EndingHost): ReactorEnding {
  return new ReactorEnding(host).install();
}
