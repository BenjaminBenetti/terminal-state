// Task studio-bunker-level-20261109-072224-01 (lane OBJECTIVE): THE BUNKER's OPTIONAL OBJECTIVE — the runtime. installBunkerObjective(game)
// is called ONCE from the Game constructor and only REGISTERS (inert on every level without layout.bunker: one null check per hook):
//  - sectionHooks: build = the station's BUNKER_LANE record (world/bunker/objectiveState.ts), the generator / core views (world/bunker/
//    objectiveViews.ts) on the LEVEL lane's placements, the claim's knowledge re-unioned into campaign.known (idempotent); teardown =
//    cancel any pour / hold, save, dispose. sectionModelKeys: the Reactor kit's generator / switchgear / console on a Bunker layout.
//    warmRegistry pool 'bunker-objective': every view (the hidden pour view, the neck's hidden opening) before the section warm-up.
//  - frameHooks: the aim (the crosshair on a generator's control box region or on the core cluster, in reach, standing in front,
//    unoccluded, no living enemy in front), the timed POUR, the turnkey HOLD, the status lamps / key / vibration, exhaust + audio
//    (2 Hz), the core screen (a state key + a light animation tick only while the player is near), the close-up read.
//  - interactHandlers (E) / pointerHandlers (left click) / promptProviders / inputOwners / hitListeners / stateListeners.
//
// NEVER A GATE: nothing here locks a door, the exit or the train; the objective is optional. Separate from the Reactor: never
// reactorVisuals(), never layout.reactor, never 'reactor.state', never its win / tiers / milestones / ending / credits.
//
// FUEL POUR (world/fuelPort.ts FuelPortSystem's press / stepPour / complete / cancel semantics, replicated): one press (E, or a held fuel
// can + left click) on an OFFLINE generator starts a FUEL_PORT.pourS timed pour (the world/fuelPourView.ts can lifts, tips into the
// panel's filler neck, pours, settles). Refused with a toast and nothing used: riding the train, the generator already fuelled / online,
// no fuel can at hand (one only in the worn backpack gets its own message), hands busy. While it pours inputOwners owns the buttons (no
// fire / ADS / item use / flare) and every left press is the pour's (Game consumes + latches it). Looking away longer than
// FUEL_PORT.awayGraceS, walking out of reach, sprinting, a hit, a menu / input clear, climbing, death, a state change of the generator
// or a teardown CANCEL it ("Pour stopped — nothing used"). complete() clears the pour first, re-checks, then takes EXACTLY ONE can —
// the selected quick slot's can when it is in the hand (inv.consumeAt(selectedRef)), else inv.take(FUEL.canItem, 1) === 1 (pockets /
// quick slots / grenade / melee slot: never a worn backpack) — and only then the generator becomes 'fuelled' (saved at once).
//
// TURNKEY START (like the Reactor's REACTOR_GEN hold: same HOLD_S / ring / cancel rules): hold [E] on a FUELLED generator — the key
// turns with the hold ring; release / look-away / moving / a menu / death / climbing cancel it and it stays FUELLED (nothing is ever
// charged by a start). Completed: 'online' (saved), the generator start clip (positional), cranking for BUNKER_GEN.CRANK_S (amber
// blinking lamp, a lighter vibration), then running (green lamp, vibration, the generator loop, an exhaust plume for the nearest one).
// The start is loud: one alert pulse to the existing enemies (line of sight / slab muffling as the Reactor's start). An online
// generator takes no more fuel (refused), never refunds, never duplicates.
//
// CORE: [E] at the cluster opens the close-up of its face (a DOM canvas over the game, pointer-events none; [E] again / walking off /
// a menu closes it). Low power: the diagnostic. All online and not claimed yet: [E] CLAIMS the intel first (exactly once per station:
// objectiveState.chooseBunkerIntel at claim time, campaign/discovery.ts revealStations = knowledge only), then shows it. A run without a
// campaign network: "No network uplink" (nothing claimed, no crash).
//
// PERSISTENCE (BUNKER_LANE in the station's section memory: written on every change and at teardown, read on build): save / load /
// import / export / Continue / journeys carry it with the inventory (both are captured at the same autosave moment; a can leaves the
// inventory in the same call that marks the generator fuelled). RETRY restores the section memory snapshot taken at entry together with
// the inventory (a can poured after entry comes back with the generator 'off' again: the pair stays consistent). The intel claim is map
// KNOWLEDGE, which Retry never takes back (campaign.known is not part of the snapshot), so the claim is written into the entry snapshot's
// copy of this lane too (claim only, the generators keep their entry states): Retry can never re-claim / re-roll / farm it.

import type {FuelHoseTarget} from '../fuelCarts'; // task studio-bunker-rework-20261109-205115-01
import * as THREE from 'three';
import type {Game} from '../../game';
import type {StationLayout} from '../../gen/stationTypes';
import type {BunkerInfo} from '../../gen/bunker/bunkerTypes';
import type {CampaignState} from '../../campaign/types';
import type {SectionKey} from '../../levels/types';
import {sectionId} from '../../levels/types';
import type {RunSnapshot} from '../../run/snapshot';
import {createMemory} from '../../run/memory';
import {revealStations, visibleEdges, visibleNodes} from '../../campaign/discovery';
import {FUEL} from '../../fuel/fuel';
import {alertListeners, type ZombieBrain} from '../../ai/brain';
import {rayCylinder, towerCue} from '../towerShared';
import {FUEL_PORT, rayBoxT} from '../fuelPort';
import {FuelPourView, POUR_VIEW} from '../fuelPourView';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import type {SmokeEmitterOptions, SmokeHandle} from '../../render/smoke';
import {
  BUNKER_LANE, addGenFuel, bunkerIntelText, bunkerStateJSON, chooseBunkerIntel, coreAlive, fuelNeeded, loadBunkerState, onlineCount,
  type BunkerGenState, type BunkerIntelJSON, type BunkerStateJSON,
} from './objectiveState';
import {CORE_SCREEN_PX, drawCoreScreen, type CoreScreenModel} from './coreScreen';
import {
  BUNKER_OBJECTIVE_MODELS, BunkerCoreView, BunkerGeneratorView, CORE_AIM, CORE_USE, GEN_AIM, GEN_EXHAUST, GEN_PANEL, GEN_USE,
  genNeckMouth, genToWorld, toPourFrame, worldToLocal,
} from './objectiveViews';

/** Tuning (one place). The hold / reach / noise values are the Reactor generator's (world/reactor/generators.ts REACTOR_GEN). */
export const BUNKER_GEN = {
  /** Hold E this long to turn the key; the ring shows after RING_DELAY_S (a tap never flashes it). */
  HOLD_S: 2.0,
  RING_DELAY_S: 0.1,
  /** Eye -> aim box reach along the view ray; the feet must be within STAND_M (plan) / STAND_DY of the use point / deck. */
  REACH_M: 2.6,
  STAND_M: 2.4,
  STAND_DY: 1.3,
  /** The hold cancels when the feet moved this far from where it started. */
  MOVE_CANCEL_M: 0.35,
  /** Visual run level while cranking, and the crank's length (s: the start clip cranks, catches, runs ~5.6 s). */
  CRANK_LEVEL: 0.35,
  CRANK_S: 4.5,
  /** The running loop starts once the one-shot start clip is nearly done; a loop that could not start is retried this often. */
  LOOP_AFTER_S: 5.2,
  AUDIO_RETRY_S: 2,
  /** The start's noise radius (one pulse: the existing enemies hear it). */
  ALERT_START_M: 40,
  /** Only the nearest running generator within this of the player has an exhaust plume (one smoke emitter); checked at 2 Hz. */
  EXHAUST_M: 35,
  SLOW_S: 0.5,
  /** Running generators vibrate within this distance of the player. */
  VIBRATE_M: 30,
} as const;

/** The core's interaction / screen tuning. */
export const BUNKER_CORE = {
  REACH_M: 2.8,
  STAND_M: 2.8,
  STAND_DY: 1.3,
  /** The screen animates (alive: 4 frames / s; low power: the cursor blinks at 1 Hz) only while the player is this near (m). */
  ANIMATE_M: 22,
  ALIVE_FPS: 4,
  /** The close-up's pixel scale over the face. */
  READ_SCALE: 2,
} as const;

/** The tower runtime's cargo-lift seams (world/towerRuntime.ts TowerRuntime.liftPower / placeCar). */
interface LiftTower { liftPower: {on(): boolean; offline(): string; park?(floor: number): void} | null; placeCar(floor: number): boolean }

type CancelReason = 'away' | 'hit' | 'sprint' | 'menu' | 'riding' | 'busy' | 'teardown' | 'state';
/** What a press at a generator did. */
export type BunkerPress = 'pouring' | 'fuelled' | 'online' | 'no-can' | 'riding' | 'busy' | 'ignored';
/** What the crosshair is on. */
export type BunkerTarget = {kind: 'gen'; index: number; t: number} | {kind: 'core'; t: number};

interface V3 { x: number; y: number; z: number }
/** The optional machine-audio seam (audio/sfx.ts reactorCue / reactorLoop: the accepted generator clips; absent = silent). */
interface MachineSfx {
  reactorCue(cue: 'reactorGeneratorStart', x: number, y: number, z: number): unknown;
  reactorLoop(cue: 'reactorGeneratorLoop', x: number, y: number, z: number): {stop(fadeS?: number): void; readonly playing?: boolean} | null;
}
/** Game parts read lazily / optionally (structural for Node shells). */
interface HostExtras {
  trainRide?: {riding: boolean};
  levels?: {raycast(o: V3, d: V3, max: number): {kind: string; t: number}; lineOfSight?(a: V3, b: V3): boolean; readonly list?: readonly {baseY: number}[]; readonly count?: number} | null;
  consumeView?: {busy: boolean};
  gasMask?: {transitioning: boolean};
  gear?: {readied?: boolean};
  fuelPort?: {heldObj?: THREE.Object3D | null} | null;
  propModels?: {get(key: string): GLTF | undefined};
  world?: {culler?: unknown} | null;
  atmosphere?: {addSmokeEmitter?(o: SmokeEmitterOptions): SmokeHandle};
  sectionModelKeys?: ((layout: StationLayout) => readonly string[])[];
  zombies?: readonly {brain: ZombieBrain; ragdolled?: boolean}[];
  pointerHandlers?: (() => boolean)[];
  promptProviders?: (() => string | null)[];
  inputOwners?: (() => boolean)[];
  stateListeners?: ((s: string, prev: string) => void)[];
  viewmodel?: {camera?: {fov?: number}; heldItem?: string | null; setItem?(id: string | null): void};
  syncHeld?: () => void;
}
type Run = {current: SectionKey; campaign: CampaignState | null; entry: RunSnapshot | null; laneStore<T = unknown>(lane: string, key?: SectionKey): T | undefined; setLaneStore(lane: string, data: unknown, key?: SectionKey): void};

const LETTERS = 'ABCDEFGH';
const runtimes = new WeakMap<object, BunkerObjective>();
let lastInstalled: BunkerObjective | null = null;
/** The objective runtime installed into `host` (QA / tests), or the last installed one. */
export function bunkerObjectiveOf(host?: object): BunkerObjective | null { return host ? runtimes.get(host) ?? null : lastInstalled; }

export class BunkerObjective {
  info: BunkerInfo | null = null;
  /** The live record of this station (null: not a Bunker). */
  state: BunkerStateJSON | null = null;
  /** The section the record belongs to (the key at build) and the station id the intel choice is keyed by. */
  key: SectionKey | null = null;
  stationId = '';
  readonly gens: BunkerGeneratorView[] = [];
  core: BunkerCoreView | null = null;
  root: THREE.Group | null = null;
  /** The crosshair's target this frame. */
  target: BunkerTarget | null = null;
  /** The running pour (null: none). */
  pour: {gen: number; t: number; total: number; clears: number; away: number} | null = null;
  /** The turnkey hold in progress (null: none). */
  hold: {gen: number; t: number; x: number; z: number; clears: number} | null = null;
  /** The core close-up is open. */
  readOpen = false;
  /** The visible pour (one, re-parented to the pouring generator's frame; built at the first Bunker build, then kept). */
  pourView: FuelPourView | null = null;
  readonly counts = {pours: 0, refused: 0, cancelled: 0, starts: 0, holdCancels: 0, claims: 0, reads: 0, saves: 0, alerts: 0, cues: 0, loops: 0, exhausts: 0, noUplink: 0, hoseUnits: 0};
  /** The generators' hose targets registered with the fuel carts (this build). */
  private readonly hoseTargets: FuelHoseTarget[] = [];
  /** The cargo lift's power source this build gave the tower runtime (null: no lift). */
  private liftPower: LiftTower['liftPower'] = null;
  lastCancel: CancelReason | null = null;
  private crankUntil: number[] = [];
  private loopAt: number[] = [];
  private loops = new Map<number, {h: {stop(fadeS?: number): void; readonly playing?: boolean} | null; retry: number}>();
  private exhaust: {gen: number; h: SmokeHandle} | null = null;
  private slowT = 0;
  private screenModel: CoreScreenModel | null = null;
  private screenSig = '';
  private readEl: HTMLElement | null = null;
  private readCanvas: HTMLCanvasElement | null = null;
  private readonly vEye = new THREE.Vector3();
  private readonly vDir = new THREE.Vector3();
  private readonly vHand = new THREE.Vector3();
  private readonly qCam = new THREE.Quaternion();
  private readonly qFrame = new THREE.Quaternion();
  private readonly qHeld = new THREE.Quaternion().setFromEuler(new THREE.Euler(FUEL_PORT.held.pitch, FUEL_PORT.held.yaw, FUEL_PORT.held.roll));
  private readonly eye: V3 = {x: 0, y: 0, z: 0};
  private readonly dir: V3 = {x: 0, y: 0, z: 0};
  private readonly le: V3 = {x: 0, y: 0, z: 0};
  private readonly ld: V3 = {x: 0, y: 0, z: 0};
  private readonly tmp: V3 = {x: 0, y: 0, z: 0};

  constructor(private readonly game: Game) {}

  private get host(): Game & HostExtras { return this.game as Game & HostExtras; }
  private get run(): Run { return (this.game as unknown as {run: Run}).run; }
  private get ids(): string[] { return this.info ? this.info.generators.map(g => g.id) : []; }

  // --- registration --------------------------------------------------------------------------------------------------------------

  install(): this {
    const g = this.host;
    g.frameHooks.push(dt => this.update(dt));
    g.interactHandlers.push(() => this.onInteract());
    g.pointerHandlers?.push(() => this.onPointer());
    g.promptProviders?.push(() => this.prompt());
    g.inputOwners?.push(() => !!this.pour || !!this.hold); // (the Reactor's hold owns the buttons too: no shot while turning the key)
    g.hitListeners.push(hit => { if (this.pour && hit.amount > 0) this.cancel('hit'); });
    g.stateListeners?.push(s => { if (s !== 'playing') { if (this.pour) this.cancel('menu'); this.cancelHold(); this.closeRead(); this.target = null; } });
    g.sectionHooks.push({build: layout => this.build(layout as StationLayout), teardown: () => this.teardown()});
    g.sectionModelKeys?.push(layout => (layout.bunker ? Object.values(BUNKER_OBJECTIVE_MODELS) : []));
    g.warmRegistry.addPool('bunker-objective', () => this.warmRoots());
    runtimes.set(g, this);
    lastInstalled = this;
    return this;
  }

  // --- world lifecycle -----------------------------------------------------------------------------------------------------------

  build(layout: StationLayout): void {
    this.clear();
    const info = layout.bunker;
    if (!info) return;
    const run = this.run;
    this.info = info;
    this.key = {...run.current};
    this.stationId = run.current.station ?? sectionId(run.current);
    this.state = loadBunkerState(run.laneStore(BUNKER_LANE, this.key), this.ids);
    // the claim is knowledge: re-unioned into the map on every build (idempotent — a save that somehow lost it gets it back)
    const nodeId = this.state.intel?.nodeId;
    if (nodeId && run.campaign) run.campaign = revealStations(run.campaign, [nodeId]);
    // views
    const models = this.host.propModels;
    const root = new THREE.Group();
    root.name = 'bunker-objective';
    info.generators.forEach((slot, i) => {
      const v = new BunkerGeneratorView(slot, models?.get(BUNKER_OBJECTIVE_MODELS.generator), i);
      root.add(v.root);
      this.gens.push(v);
    });
    this.core = new BunkerCoreView(info.core, {switchgear: models?.get(BUNKER_OBJECTIVE_MODELS.switchgear), console: models?.get(BUNKER_OBJECTIVE_MODELS.console)});
    root.add(this.core.root);
    this.root = root;
    this.host.scene.add(root);
    this.crankUntil = info.generators.map(() => -Infinity); // restored online generators run at once (no re-crank, no re-start sound)
    this.loopAt = info.generators.map(() => -Infinity);
    this.ensurePourView();
    this.registerHoseTargets();
    this.connectLift();
    const culler = this.host.world?.culler as {register?(o: THREE.Object3D): void} | undefined;
    root.updateMatrixWorld(true); // (the culler measures each registered mesh's world box now: the placements' transforms must be in)
    if (culler && typeof culler.register === 'function') { for (const v of this.gens) culler.register(v.body); culler.register(this.core.root); }
    this.screenSig = '';
    this.sendVisuals(0);
    this.updateScreen(true);
  }

  teardown(): void {
    if (this.pour) this.cancel('teardown');
    this.save();
    this.clear();
  }

  /**
   * Task studio-bunker-rework-20261109-205115-01: every generator's filler is a fuel TARGET of the carts' hose (world/fuelCarts.ts
   * FuelHoseTarget) — the same physical rules as at the train's cap; one unit per tick, committed here before it leaves the drum.
   */
  private registerHoseTargets(): void {
    const carts = (this.host as {fuelCarts?: {targets: FuelHoseTarget[]}}).fuelCarts;
    if (!carts || !this.info) return;
    this.info.generators.forEach((slot, i) => {
      const L = LETTERS[i] ?? '?', id = slot.id, at = {x: 0, y: 0, z: 0};
      const t: FuelHoseTarget = {
        id: `bunker:${id}`,
        label: `auxiliary generator ${L}`,
        cap: () => genToWorld(slot, genNeckMouth(), at),
        // (no hose fuel while a can is being poured into the same filler: the pour re-checks the need at its end)
        room: () => (this.state && this.pour?.gen !== i ? fuelNeeded(this.state, id) : 0),
        take: () => this.hoseFuel(i),
        fullText: `Auxiliary generator ${L} fuelled — hose disconnected · hold [E] to turn the key`,
      };
      carts.targets.push(t);
      this.hoseTargets.push(t);
    });
  }

  /**
   * Task studio-bunker-rework-20261109-205115-01: a version-2 Bunker's CARGO LIFT runs on the three auxiliary generators — powered
   * exactly while all three are online (never by the intel claim, a visit or fuel per ride), refusing every call before that with the
   * reason; its stop is remembered in this station's record (the car is parked there on the next build: revisit / load / Retry).
   */
  private connectLift(): void {
    const tower = (this.host as {tower?: LiftTower}).tower;
    if (!tower || !this.info?.lift) return;
    const power: NonNullable<LiftTower['liftPower']> = {
      on: () => this.alive,
      offline: () => {
        const n = this.state ? onlineCount(this.state, this.ids) : 0;
        return `The cargo lift runs on the shelter's auxiliary generators — ${n}/${this.ids.length} online · the stairs still go everywhere`;
      },
      park: floor => { if (this.state) { this.state.lift = {stop: floor}; this.save(); } },
    };
    tower.liftPower = power;
    this.liftPower = power;
    const stop = this.state?.lift?.stop;
    if (stop !== undefined) tower.placeCar(stop);
  }

  /** One unit from a cart's hose into generator `i` (true: committed and saved; the cart debits it in the same tick). */
  private hoseFuel(i: number): boolean {
    const id = this.info?.generators[i]?.id;
    if (!id || !this.state || this.pour?.gen === i) return false;
    if (addGenFuel(this.state, id, 1) !== 1) return false;
    this.counts.hoseUnits++;
    this.save();
    this.sendVisuals(this.host.clock);
    this.updateScreen(true);
    return true;
  }

  private clear(): void {
    const tower = (this.host as {tower?: LiftTower}).tower;
    if (tower && this.liftPower && tower.liftPower === this.liftPower) tower.liftPower = null;
    this.liftPower = null;
    const carts = (this.host as {fuelCarts?: {targets: FuelHoseTarget[]}}).fuelCarts;
    if (carts) for (const t of this.hoseTargets.splice(0)) { const k = carts.targets.indexOf(t); if (k >= 0) carts.targets.splice(k, 1); }
    this.hoseTargets.length = 0;
    this.cancelHold();
    this.closeRead();
    if (this.pour) { this.pour = null; this.showPour(false); }
    for (const l of this.loops.values()) l.h?.stop(0.2);
    this.loops.clear();
    this.exhaust?.h.stop(1);
    this.exhaust = null;
    if (this.pourView?.root.parent) this.pourView.root.parent.remove(this.pourView.root);
    if (this.root) this.host.scene.remove(this.root);
    for (const v of this.gens) v.dispose();
    this.core?.dispose();
    this.gens.length = 0;
    this.core = null;
    this.root = null;
    this.info = null;
    this.state = null;
    this.key = null;
    this.target = null;
    this.screenModel = null;
  }

  /** Write the record into the station's lane (every change, teardown). */
  save(): void {
    if (!this.state || !this.key) return;
    try {
      this.run.setLaneStore(BUNKER_LANE, bunkerStateJSON(this.state), this.key);
      this.counts.saves++;
    } catch (err) { console.warn('bunker objective: saving the record failed', err); }
  }

  /** The visible pour, built once (after the boot assets: the item template is the loaded can) as a hidden child of a generator frame. */
  ensurePourView(): FuelPourView {
    if (!this.pourView) {
      const P = GEN_PANEL;
      // limits: the posed can stays in front of the panel's lamp / key (4 cm proud of the plate), its spout corner in front of the body face
      this.pourView = new FuelPourView(FUEL.canItem, toPourFrame(genNeckMouth()), {plateZ: -(P.frontZ + 0.04), skinZ: -P.bodyZ}, (pos, q) => this.handPose(pos, q));
    }
    const at = this.pour ? this.gens[this.pour.gen] : this.gens[0];
    if (at && this.pourView.root.parent !== at.pourFrame) {
      at.pourFrame.add(this.pourView.root);
      this.pourView.root.traverse(o => { if ((o as THREE.Mesh).isMesh) o.userData.level = at.slot.level; }); // (the generator's storey; never level-registered: it moves)
    }
    return this.pourView;
  }

  /** Warm-up roots: every view (with the hidden pour view in the first generator's frame). */
  warmRoots(): THREE.Object3D[] {
    if (!this.info || !this.root) return [];
    this.ensurePourView();
    return [this.root];
  }

  // --- aim -----------------------------------------------------------------------------------------------------------------------

  /** The generator / core under the crosshair (in reach, standing in front, unoccluded, no living enemy in front), or null. */
  aim(): BunkerTarget | null {
    const g = this.host, info = this.info;
    if (!info || !g.player?.alive || g.state !== 'playing') return null;
    const cam = g.camera;
    cam.updateMatrixWorld();
    cam.getWorldPosition(this.vEye);
    cam.getWorldDirection(this.vDir);
    const E = this.eye, D = this.dir, p = g.player;
    E.x = this.vEye.x; E.y = this.vEye.y; E.z = this.vEye.z;
    D.x = this.vDir.x; D.y = this.vDir.y; D.z = this.vDir.z;
    let best: BunkerTarget | null = null, bt: number = BUNKER_GEN.REACH_M;
    for (let i = 0; i < info.generators.length; i++) {
      const s = info.generators[i];
      const u = genToWorld(s, {x: GEN_USE.x, y: 0, z: GEN_USE.z}, this.tmp);
      if (Math.hypot(p.x - u.x, p.z - u.z) > BUNKER_GEN.STAND_M || Math.abs(p.y - s.y) > BUNKER_GEN.STAND_DY) continue;
      const t = rayBoxT(worldToLocal(s, E, false, this.le), worldToLocal(s, D, true, this.ld), {x: GEN_AIM.x0, y: GEN_AIM.y0, z: GEN_AIM.z0}, {x: GEN_AIM.x1, y: GEN_AIM.y1, z: GEN_AIM.z1}, bt);
      if (t !== null && t < bt) { bt = t; best = {kind: 'gen', index: i, t}; }
    }
    const c = info.core, cu = genToWorld(c, {x: CORE_USE.x, y: 0, z: CORE_USE.z}, this.tmp);
    if (Math.hypot(p.x - cu.x, p.z - cu.z) <= BUNKER_CORE.STAND_M && Math.abs(p.y - c.y) <= BUNKER_CORE.STAND_DY && worldToLocal(c, p, false, this.le).z > CORE_AIM.z1 - 0.3) {
      const t = rayBoxT(worldToLocal(c, E, false, this.le), worldToLocal(c, D, true, this.ld), {x: CORE_AIM.x0, y: CORE_AIM.y0, z: CORE_AIM.z0}, {x: CORE_AIM.x1, y: CORE_AIM.y1, z: CORE_AIM.z1}, Math.max(bt, BUNKER_CORE.REACH_M));
      if (t !== null && (!best || t < bt)) { bt = t; best = {kind: 'core', t}; }
    }
    if (!best) return null;
    // unobstructed: nothing more than a panel's depth in front of the aimed box (the prop's own collision stands at its face)
    const hit = g.levels?.raycast?.(E, D, best.t + 0.02);
    if (hit && hit.kind !== 'none' && hit.t < best.t - 0.3) return null;
    for (const z of g.zombies ?? []) {
      const b = z.brain;
      if (!b.alive || z.ragdolled) continue;
      const dx = b.x - E.x, dz = b.z - E.z;
      if (dx * dx + dz * dz > (best.t + 1) * (best.t + 1)) continue;
      if (rayCylinder(E, D, b.x, b.z, b.stats.radius + 0.05, b.y, b.y + 1.9, best.t) !== null) return null;
    }
    return best;
  }

  private aimedGen(): number { return this.target?.kind === 'gen' ? this.target.index : -1; }

  // --- input ---------------------------------------------------------------------------------------------------------------------

  /** E (Game.interactHandlers): consumed only while a generator / the core is the target (or a pour / hold of ours runs). */
  onInteract(): boolean {
    if (!this.info || this.host.state !== 'playing') return false;
    if (this.pour) { const t = this.target ?? this.aim(); return t?.kind === 'gen' && t.index === this.pour.gen; } // a second press while pouring: nothing (consumed)
    if (this.hold) return true;
    if (this.readOpen) { this.closeRead(); return true; }
    const t = this.target ?? this.aim();
    if (!t) return false;
    this.target = t;
    if (t.kind === 'core') { this.useCore(); return true; }
    const st = this.genState(t.index);
    if (st === 'fuelled') { this.beginHold(t.index); return true; }
    this.press(t.index);
    return true;
  }

  /**
   * Left click (Game.pointerHandlers): a fuel can in the hand on an aimed generator pours like E (or is refused); anything else is not
   * ours — except that WHILE a pour runs every press is (it never fires a gun the moment the pour ends: Game consumes + latches it).
   */
  onPointer(): boolean {
    const g = this.host;
    if (!this.info || g.state !== 'playing') return false;
    if (this.pour) return true;
    if (g.inv.meleeSelected || g.inv.selectedStack()?.itemId !== FUEL.canItem) return false;
    const t = this.target ?? this.aim();
    if (!t || t.kind !== 'gen') return false;
    this.target = t;
    this.press(t.index);
    return true;
  }

  /** The generator state of view `i`. */
  genState(i: number): BunkerGenState {
    const id = this.info?.generators[i]?.id;
    return (id && this.state?.gens[id]) || 'off';
  }

  /** A press at generator `i`: start a pour, or refuse with a short toast (nothing used). */
  press(i: number): BunkerPress {
    const g = this.host;
    if (this.pour || this.hold || !this.info || !this.state || !this.gens[i]) return 'ignored';
    const refuse = (text: string, why: BunkerPress): BunkerPress => { g.hud.toast(text, true); g.sfx.denied(); this.counts.refused++; return why; };
    if (g.trainRide?.riding) return refuse('Not while moving', 'riding');
    const L = LETTERS[i] ?? '?', st = this.genState(i);
    if (st === 'online') return refuse(`Auxiliary generator ${L} is running — it needs no more fuel`, 'online');
    if (st === 'fuelled') return refuse(`Auxiliary generator ${L} is already fuelled — hold [E] to turn the key`, 'fuelled');
    // (a can holds one quarter-tank unit — exactly the generator's need; a cart's hose is the other source: world/fuelCarts.ts)
    if (fuelNeeded(this.state, this.info.generators[i].id) < FUEL.canUnits) return refuse(`Auxiliary generator ${L} needs less than a can — use a fuel cart's hose`, 'fuelled');
    if (g.inv.count(FUEL.canItem) <= 0) {
      const inBag = (g.inv.wornBag()?.bag ?? []).some(s => s?.itemId === FUEL.canItem);
      return refuse(inBag ? 'No fuel can at hand — the ones in your backpack need it set down' : 'No fuel — pour a fuel can or connect a fuel cart\'s hose', 'no-can');
    }
    if (g.player.climbing || g.consumeView?.busy || g.gasMask?.transitioning || g.gear?.readied) return refuse('Hands busy', 'busy');
    this.pour = {gen: i, t: 0, total: FUEL_PORT.pourS, clears: g.input.clears, away: 0};
    (g.sfx as {fuelPour?: () => number}).fuelPour?.();
    this.showPour(true);
    return 'pouring';
  }

  /** The visible pour on / off (the held can hidden meanwhile: no duplicate; the inventory selection is never touched). */
  private showPour(on: boolean): void {
    const held = this.host.fuelPort?.heldObj ?? null;
    if (on) {
      const v = this.ensurePourView();
      v.begin();
      v.update(0, FUEL_PORT.pourS);
      if (held) held.visible = false;
      return;
    }
    this.pourView?.end();
    for (const v of this.gens) v.setUncapped(false);
    if (held && !held.visible) {
      held.visible = true;
      const vm = this.host.viewmodel;
      if (vm?.heldItem === FUEL.canItem && typeof vm.setItem === 'function') { vm.setItem(null); vm.setItem(FUEL.canItem); } // replay the raise
    }
  }

  /**
   * Where the hand holds the can, in the pouring generator's pour frame: the viewmodel's held pose (FUEL_PORT.held, camera space)
   * re-projected into the world camera (as world/fuelPort.ts handPose), never inside the generator's body.
   */
  handPose(pos: THREE.Vector3, q: THREE.Quaternion): boolean {
    const g = this.host, cam = g.camera, v = this.pourView, gen = this.gens[this.pour?.gen ?? 0];
    if (!cam || !v || !gen) return false;
    cam.updateMatrixWorld();
    gen.pourFrame.updateWorldMatrix(true, false);
    const vmFov = g.viewmodel?.camera?.fov ?? FUEL_PORT.viewmodelFov;
    const k = Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2) / Math.tan(THREE.MathUtils.degToRad(vmFov) / 2);
    const H = FUEL_PORT.held.hip;
    const c = this.vHand.set(H[0], H[1], H[2] / k);
    cam.localToWorld(c);
    gen.pourFrame.worldToLocal(c);
    cam.getWorldQuaternion(this.qCam);
    gen.pourFrame.getWorldQuaternion(this.qFrame);
    q.copy(this.qFrame.invert()).multiply(this.qCam).multiply(this.qHeld);
    const lim = -GEN_PANEL.bodyZ - v.radius;
    if (c.z > lim) c.z = lim;
    v.originFromCentre(c, q, pos);
    return true;
  }

  private stepPour(dt: number): void {
    const g = this.host, p = this.pour!;
    if (g.state !== 'playing' || g.input.clears !== p.clears) { this.cancel('menu'); return; }
    if (g.trainRide?.riding) { this.cancel('riding'); return; }
    if (!g.player.alive || g.player.climbing || g.consumeView?.busy) { this.cancel('busy'); return; }
    if (g.player.sprinting) { this.cancel('sprint'); return; }
    if (this.genState(p.gen) !== 'off') { this.cancel('state'); return; }
    const slot = this.info!.generators[p.gen], m = genToWorld(slot, genNeckMouth(), this.tmp);
    g.camera.getWorldPosition(this.vEye);
    if (Math.hypot(m.x - this.vEye.x, m.y - this.vEye.y, m.z - this.vEye.z) > BUNKER_GEN.REACH_M + FUEL_PORT.reachSlack) { this.cancel('away'); return; }
    p.away = this.aimedGen() === p.gen ? 0 : p.away + dt;
    if (p.away > FUEL_PORT.awayGraceS) { this.cancel('away'); return; }
    p.t += dt;
    if (p.t >= p.total) { this.complete(); return; }
    this.pourView?.update(p.t, p.total);
    this.gens[p.gen].setUncapped(p.t >= 0.6 * POUR_VIEW.liftS);
  }

  /** The pour ran its time: re-check, take exactly one can (the hand's first), the generator is fuelled (saved). */
  private complete(): void {
    const g = this.host, i = this.pour!.gen;
    this.pour = null;
    this.showPour(false);
    const id = this.info?.generators[i]?.id;
    if (!id || !this.state || this.genState(i) !== 'off' || fuelNeeded(this.state, id) < FUEL.canUnits) { g.hud.toast('Already fuelled — nothing used', true); g.sfx.denied(); this.counts.refused++; return; }
    const held = !g.inv.meleeSelected ? g.inv.selectedStack() : null;
    const fromHand = held?.itemId === FUEL.canItem;
    const took = fromHand ? g.inv.consumeAt(g.inv.selectedRef()) : g.inv.take(FUEL.canItem, 1) === 1;
    if (!took) { g.hud.toast('No fuel can', true); g.sfx.denied(); this.counts.refused++; return; }
    addGenFuel(this.state, id, FUEL.canUnits); // (one can = one unit = the whole need: the generator is fuelled)
    this.counts.pours++;
    this.save();
    this.sendVisuals(this.host.clock);
    this.updateScreen(true);
    const left = g.inv.count(FUEL.canItem);
    g.hud.toast(`Fuel in — auxiliary generator ${LETTERS[i] ?? '?'} fuelled · hold [E] to turn the key · ${left ? `${left} can${left > 1 ? 's' : ''} left` : 'no cans left'}`);
    if (fromHand) g.syncHeld?.();
  }

  /** Stop the running pour: nothing is used. */
  cancel(why: CancelReason): void {
    if (!this.pour) return;
    this.pour = null;
    this.showPour(false);
    this.lastCancel = why;
    this.counts.cancelled++;
    const g = this.host;
    (g.sfx as {stopFuelPour?: () => void}).stopFuelPour?.();
    if (why === 'riding') g.hud.toast('Not while moving', true);
    else if (why === 'hit' || why === 'away' || why === 'sprint') g.hud.toast('Pour stopped — nothing used', true);
  }

  // --- the turnkey start ---------------------------------------------------------------------------------------------------------

  private beginHold(i: number): void {
    const p = this.host.player;
    this.hold = {gen: i, t: 0, x: p.x, z: p.z, clears: this.host.input.clears};
  }

  private cancelHold(): void {
    if (!this.hold) return;
    this.hold = null;
    this.counts.holdCancels++;
    this.host.hud.setHoldRing?.(null);
  }

  /** The E hold: complete after HOLD_S; cancelled on release / look-away / moving / clears / death / climbing / a state change. */
  private updateHold(dt: number): void {
    const hd = this.hold, h = this.host;
    if (!hd) return;
    const p = h.player;
    const cancel = h.state !== 'playing' || h.input.clears !== hd.clears || !h.input.down('KeyE') || this.aimedGen() !== hd.gen || !p.alive || p.climbing
      || Math.hypot(p.x - hd.x, p.z - hd.z) > BUNKER_GEN.MOVE_CANCEL_M || this.genState(hd.gen) !== 'fuelled';
    if (cancel) { this.cancelHold(); return; }
    hd.t += dt;
    if (hd.t >= BUNKER_GEN.HOLD_S) {
      this.hold = null;
      h.hud.setHoldRing?.(null);
      this.start(hd.gen);
      return;
    }
    h.hud.setHoldRing?.(hd.t >= BUNKER_GEN.RING_DELAY_S ? Math.min(1, hd.t / BUNKER_GEN.HOLD_S) : null);
  }

  /** E-hold progress 0..1 (null: no hold) — QA / tests. */
  get holdProgress(): number | null { return this.hold ? Math.min(1, this.hold.t / BUNKER_GEN.HOLD_S) : null; }

  /** Start fuelled generator `i` (the completed hold): online (saved), the start clip, the noise, cranking visuals. Never charges anything. */
  start(i: number): boolean {
    const info = this.info, st = this.state, slot = info?.generators[i];
    if (!info || !st || !slot || st.gens[slot.id] !== 'fuelled') return false;
    st.gens[slot.id] = 'online';
    const clock = this.host.clock;
    this.crankUntil[i] = clock + BUNKER_GEN.CRANK_S;
    this.loopAt[i] = clock + BUNKER_GEN.LOOP_AFTER_S;
    this.counts.starts++;
    this.save();
    const c = genToWorld(slot, {x: 1.95, y: 1.2, z: 0.9}, this.tmp);
    this.cue(c.x, c.y, c.z);
    this.alert(slot, BUNKER_GEN.ALERT_START_M);
    const ids = this.ids, n = onlineCount(st, ids);
    this.sendVisuals(clock);
    this.updateScreen(true);
    this.host.hud.toast(n === ids.length
      ? `Auxiliary generator ${LETTERS[i] ?? '?'} started — auxiliary power ${n}/${ids.length}: the core is powered. The noise will draw the infected.`
      : `Auxiliary generator ${LETTERS[i] ?? '?'} started — auxiliary power ${n}/${ids.length}. The noise will draw the infected.`);
    return true;
  }

  /** A noise at the generator's front (head height) heard by the existing enemies: line of sight / slab muffling (nothing spawned). */
  private alert(slot: BunkerInfo['generators'][number], radius: number): void {
    const h = this.host, L = h.levels, zs = h.zombies ?? [];
    if (!L || typeof L.lineOfSight !== 'function' || !zs.length) return;
    const src = genToWorld(slot, {x: GEN_USE.x, y: 1.5, z: GEN_USE.z}, {x: 0, y: 0, z: 0}), head = {x: 0, y: 0, z: 0};
    const bases = (L.count ?? 0) > 1 && L.list ? L.list.map(l => l.baseY) : null;
    alertListeners(zs.map(z => z.brain), src, radius, b => { head.x = b.x; head.y = b.y + 1.5; head.z = b.z; return L.lineOfSight!(src, head); }, bases);
    this.counts.alerts++;
  }

  private cue(x: number, y: number, z: number): void {
    const sfx = this.host.sfx as Partial<MachineSfx> | null | undefined;
    if (typeof sfx?.reactorCue !== 'function') return;
    try { sfx.reactorCue('reactorGeneratorStart', x, y, z); this.counts.cues++; } catch { /* audio is never fatal */ }
  }

  // --- the core ------------------------------------------------------------------------------------------------------------------

  /** The core is powered (every generator of this layout online). */
  get alive(): boolean { return !!this.state && coreAlive(this.state, this.ids); }

  /** [E] at the core: the close-up (low power: the diagnostic); powered and not claimed yet: claim first. */
  private useCore(): void {
    if (this.alive && this.state && !this.state.intel) this.claim();
    this.openRead();
  }

  /**
   * THE CLAIM (exactly once per station): the intel is chosen now from the current campaign knowledge, stored in the lane (and in the
   * Retry snapshot's copy of it), and its station revealed on the map (knowledge only). No network: "No network uplink", nothing stored.
   */
  claim(): BunkerIntelJSON | null {
    const st = this.state, run = this.run;
    if (!st || !this.alive) return null;
    if (st.intel) return st.intel;
    const c = run.campaign;
    if (!c) {
      this.counts.noUplink++;
      this.host.hud.toast('No network uplink — the core cannot reach a station network', true);
      return null;
    }
    const choice = chooseBunkerIntel(c, this.stationId);
    const intel: BunkerIntelJSON = {claimedAt: new Date().toISOString(), kind: choice.kind, ...(choice.nodeId ? {nodeId: choice.nodeId} : {})};
    st.intel = intel;
    this.counts.claims++;
    this.save();
    this.patchEntry(intel);
    if (intel.nodeId) run.campaign = revealStations(c, [intel.nodeId]);
    this.updateScreen(true);
    this.host.hud.toast(bunkerIntelText(intel, c.network).toast);
    towerCue(this.host.sfx, 'click', {x: this.info!.core.x, y: this.info!.core.y + 1.2, z: this.info!.core.z}, {rate: 1.2, gain: 0.7});
    return intel;
  }

  /** Write the claim (only) into the Retry snapshot's copy of this lane — Retry never takes map knowledge back, so it never re-claims. */
  private patchEntry(intel: BunkerIntelJSON): void {
    const e = this.run.entry, k = this.key;
    if (!e || !k || e.level !== k.level || e.section !== k.section || (e.station ?? '') !== (k.station ?? '')) return;
    const id = sectionId(k);
    const mem = (e.memories[id] ??= createMemory(k));
    const prev = loadBunkerState(mem.lanes[BUNKER_LANE], this.ids);
    if (prev.intel) return;
    prev.intel = {...intel};
    mem.lanes[BUNKER_LANE] = bunkerStateJSON(prev);
  }

  /** The screen's model (rebuilt only when its sources changed). */
  private model(): CoreScreenModel | null {
    const info = this.info, st = this.state;
    if (!info || !st) return null;
    const c = this.run.campaign;
    const sig = `${info.generators.map(g => st.gens[g.id] ?? 'off').join(',')}|${st.intel?.kind ?? ''}:${st.intel?.nodeId ?? ''}|${c ? `${c.known.length}:${+c.cheat}` : '-'}`;
    if (this.screenModel && sig === this.screenSig) return this.screenModel;
    this.screenSig = sig;
    const ids = this.ids, txt = st.intel ? bunkerIntelText(st.intel, c?.network) : null;
    let map: CoreScreenModel['map'] = null;
    if (c) {
      const nodes = visibleNodes(c), index = new Map(nodes.map((n, i) => [n.id, i] as const));
      map = {nodes: nodes.map(n => ({x: n.x, y: n.y})), edges: visibleEdges(c).map(([a, b]) => [index.get(a)!, index.get(b)!] as const), hi: st.intel?.nodeId ? index.get(st.intel.nodeId) ?? -1 : -1};
    }
    this.screenModel = {
      gens: info.generators.map((g, i) => ({letter: LETTERS[i] ?? '?', label: g.label, state: st.gens[g.id] ?? 'off'})),
      online: onlineCount(st, ids), total: ids.length, alive: coreAlive(st, ids), uplink: !!c,
      intel: st.intel && txt ? {kind: st.intel.kind, head: txt.head, line: txt.line} : null, map,
    };
    return this.screenModel;
  }

  /** Redraw the big screen on a state change, and its light animation tick while the player is near. */
  private updateScreen(force: boolean): void {
    const core = this.core, info = this.info, m = this.model();
    if (!core || !info || !m) return;
    const p = this.host.player, near = Math.hypot(p.x - info.core.x, p.z - info.core.z) < BUNKER_CORE.ANIMATE_M && Math.abs(p.y - info.core.y) < 4;
    const clock = this.host.clock;
    const frame = near ? Math.floor(clock * (m.alive ? BUNKER_CORE.ALIVE_FPS : 1)) : 0;
    if (core.draw(m, frame) && this.readOpen && force) this.drawRead();
  }

  private openRead(): void {
    this.readOpen = true;
    this.counts.reads++;
    this.drawRead();
    if (this.readEl) this.readEl.style.display = 'flex';
  }

  private closeRead(): void {
    this.readOpen = false;
    if (this.readEl) this.readEl.style.display = 'none';
  }

  /** The close-up: the same face, drawn larger on a DOM canvas over the game (no input capture). */
  private drawRead(): void {
    const doc = typeof document !== 'undefined' ? document as Document & {body?: HTMLElement} : null;
    const m = this.model();
    if (!doc?.body || !m) return;
    if (!this.readEl) {
      const el = doc.createElement('div');
      el.id = 'bunker-core-read';
      el.style.cssText = 'position:fixed;inset:0;z-index:15;display:none;align-items:center;justify-content:center;pointer-events:none;background:rgba(5,7,9,0.55);';
      const c = doc.createElement('canvas');
      c.width = CORE_SCREEN_PX.w * BUNKER_CORE.READ_SCALE;
      c.height = CORE_SCREEN_PX.h * BUNKER_CORE.READ_SCALE;
      c.style.cssText = `width:min(92vw,${Math.round(88 * CORE_SCREEN_PX.w / CORE_SCREEN_PX.h)}vh);height:auto;aspect-ratio:${CORE_SCREEN_PX.w} / ${CORE_SCREEN_PX.h};box-shadow:0 0 0 8px #2c3134,0 0 0 11px #15181a,0 12px 40px rgba(0,0,0,0.6);`;
      el.appendChild(c);
      doc.body.appendChild(el);
      this.readEl = el;
      this.readCanvas = c;
    }
    const ctx = this.readCanvas?.getContext('2d');
    if (!ctx) return;
    ctx.setTransform?.(BUNKER_CORE.READ_SCALE, 0, 0, BUNKER_CORE.READ_SCALE, 0, 0);
    drawCoreScreen(ctx, m, CORE_SCREEN_PX.w, CORE_SCREEN_PX.h, 0);
    ctx.setTransform?.(1, 0, 0, 1, 0, 0);
  }

  // --- per frame -----------------------------------------------------------------------------------------------------------------

  update(dt: number): void {
    if (!this.info || !this.state) return;
    const g = this.host, clock = g.clock;
    this.target = g.state === 'playing' ? this.aim() : null;
    if (this.pour) this.stepPour(dt);
    this.updateHold(dt);
    if (this.readOpen && this.target?.kind !== 'core') this.closeRead();
    this.sendVisuals(clock);
    this.slowT -= dt;
    if (this.slowT <= 0) { this.slowT = BUNKER_GEN.SLOW_S; this.updateExhaust(); this.updateLoops(); }
    this.updateScreen(false);
  }

  /** Lamps (state / cranking blink), keys (the hold's turn; turned while running) and running vibration near the player. */
  private sendVisuals(clock: number): void {
    const info = this.info;
    if (!info || !this.state) return;
    const p = this.host.player;
    for (let i = 0; i < this.gens.length; i++) {
      const v = this.gens[i], s = info.generators[i], st = this.genState(i), cranking = st === 'online' && clock < this.crankUntil[i];
      v.setStatus(st, cranking, clock);
      v.setKey(this.hold?.gen === i ? Math.min(1, this.hold.t / BUNKER_GEN.HOLD_S) : st === 'online' ? 1 : 0);
      const near = Math.hypot(p.x - s.x, p.y - s.y, p.z - s.z) < BUNKER_GEN.VIBRATE_M;
      v.vibrate(st === 'online' && near ? (cranking ? BUNKER_GEN.CRANK_LEVEL : 1) : 0, clock);
    }
  }

  /** One exhaust plume: the nearest running generator within EXHAUST_M of the player (re-added if the smoke pool evicted it). */
  private updateExhaust(): void {
    const info = this.info, add = this.host.atmosphere?.addSmokeEmitter;
    if (!info || !add) return;
    const p = this.host.player;
    let best = -1, bd: number = BUNKER_GEN.EXHAUST_M;
    info.generators.forEach((s, i) => {
      if (this.genState(i) !== 'online') return;
      const d = Math.hypot(s.x - p.x, s.y - p.y, s.z - p.z);
      if (d < bd) { bd = d; best = i; }
    });
    const ex = this.exhaust;
    if (ex && (best < 0 || ex.gen !== best || !ex.h.alive)) { ex.h.stop(3); this.exhaust = null; }
    if (best >= 0 && !this.exhaust) {
      const o = genToWorld(info.generators[best], GEN_EXHAUST, {x: 0, y: 0, z: 0});
      this.exhaust = {gen: best, h: add.call(this.host.atmosphere, {x: o.x, y: o.y, z: o.z, color: 0x5a5a52, rate: 0.9, radius: 1.3, life: 6, density: 0.55})};
      this.counts.exhausts++;
    }
  }

  /** Positional running loops (one per running generator once its start clip is nearly done). Silent without the seam. */
  private updateLoops(): void {
    const info = this.info, sfx = this.host.sfx as Partial<MachineSfx> | null | undefined;
    if (!info || typeof sfx?.reactorLoop !== 'function') return;
    const now = this.host.clock;
    info.generators.forEach((s, i) => {
      if (this.genState(i) !== 'online' || now < this.loopAt[i]) return;
      const l = this.loops.get(i);
      if (l && (l.h?.playing ?? !!l.h)) return;
      if (l && now < l.retry) return;
      let h: {stop(fadeS?: number): void; readonly playing?: boolean} | null = null;
      try { h = sfx.reactorLoop!('reactorGeneratorLoop', s.x, s.y + 1.2, s.z); } catch { h = null; }
      this.loops.set(i, {h, retry: now + BUNKER_GEN.AUDIO_RETRY_S});
      if (h && (h.playing ?? true)) this.counts.loops++;
    });
  }

  // --- prompt --------------------------------------------------------------------------------------------------------------------

  prompt(): string | null {
    if (!this.info || !this.state) return null;
    if (this.pour) return `<b>Pouring fuel…</b> ${Math.min(99, Math.floor(this.pour.t / this.pour.total * 100))} %`;
    const ids = this.ids, n = onlineCount(this.state, ids);
    if (this.hold) return `<b>Hold [E]</b> Turning the key — starting auxiliary generator ${LETTERS[this.hold.gen] ?? '?'}…`;
    if (this.readOpen) return '<b>[E]</b> Close the core terminal';
    const t = this.target;
    if (!t) return null;
    if (t.kind === 'core') {
      if (!this.alive) return `<b>[E]</b> Read the core terminal · auxiliary power ${n}/${ids.length}`;
      if (this.state.intel) return '<b>[E]</b> Read the core terminal · map intel retrieved';
      return this.run.campaign ? '<b>[E]</b> Retrieve map intel from the core' : '<b>[E]</b> Core terminal · no network uplink';
    }
    const L = LETTERS[t.index] ?? '?', st = this.genState(t.index), label = this.info.generators[t.index].label;
    if (st === 'online') return `Auxiliary generator ${L} ONLINE · auxiliary power ${n}/${ids.length}`;
    if (st === 'fuelled') return `<b>Hold [E]</b> Turn the key — start auxiliary generator ${L} · FUELLED`;
    const cans = this.host.inv.count(FUEL.canItem);
    return cans ? `<b>[E]</b> Pour a fuel can · auxiliary generator ${L} (${label}) OFFLINE · needs ¼ tank · ${cans} can${cans > 1 ? 's' : ''}` : `<b>[E]</b> Auxiliary generator ${L} (${label}) OFFLINE · needs ¼ tank of fuel — a fuel can or a fuel cart's hose`;
  }

  /** QA / tests: a compact report. */
  qa(): {gens: {id: string; state: BunkerGenState; view: ReturnType<BunkerGeneratorView['qa']>}[]; alive: boolean; intel: BunkerIntelJSON | null; target: BunkerTarget | null;
    pouring: number | null; hold: number | null; readOpen: boolean; counts: BunkerObjective['counts']; lastCancel: CancelReason | null; screen: {redraws: number; brightness: number} | null} {
    return {
      gens: this.gens.map((v, i) => ({id: v.slot.id, state: this.genState(i), view: v.qa()})), alive: this.alive, intel: this.state?.intel ?? null,
      target: this.target, pouring: this.pour ? +(this.pour.t / this.pour.total).toFixed(3) : null, hold: this.holdProgress, readOpen: this.readOpen,
      counts: {...this.counts}, lastCancel: this.lastCancel, screen: this.core ? {redraws: this.core.redraws, brightness: this.core.brightness} : null,
    };
  }
}

/** Create the Bunker objective and register it into the Game (call once from the Game constructor; inert off the Bunker). */
export function installBunkerObjective(game: Game): BunkerObjective {
  return new BunkerObjective(game).install();
}
