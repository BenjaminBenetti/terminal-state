// Task studio-market-bar-20261108-225231-01 (lane SHELVES, the throw-up action; user: "A second timed beer makes player vomit, physical
// chunks like bullet casings."): THE PLAYER THROWS UP — Game.vomit (market/beer/effectsApi.ts VomitApi). The BEER lane calls start()
// when a second timed beer is drunk (the buff replacement is theirs); anything else may too.
//
// start() (false, nothing happens: dead, not playing — any menu / pause / map —, riding the moving train, driving the Skyways car, or
// already throwing up) runs ONE action of VOMIT.duration seconds:
//  - BODY / CAMERA: a gag, then three heaves — the view pitches down and the head dips with each (the camera follows the player's own
//    pitch / eye: the action adds its offset to Player.pitch / Player.eye and takes exactly that back, so the player's own look is never
//    lost), hunched in between, then the view comes back up;
//  - THE HELD ITEM: lowered out of view at the gag and brought back up in the recovery (Game feeds `holster` to the viewmodel after the
//    consume view: whichever lowers it more wins — the consume flow's own state is never touched);
//  - MOVEMENT slowed to VOMIT.speedMult (a ModifierSource) and every action blocked while it lasts: the mouse buttons (an input owner:
//    no shot, swing, aim, flare or item use; a button still held at the end is latched — Game.lmbLatch), and Game's vmBusy / E /
//    startUse guards read `active` (no reload, no interaction, no timed use);
//  - THE CHUNKS: physical food chunks from the mouth, forward and down, with each heave (player/vomitChunks.ts: a bounded pool
//    integrated like the casings, a physics BodySource: cleared with the station);
//  - THE RETCH: game.marketAudio?.retch() once at the start (the AUDIO lane's sound).
// Never an inventory / loot / cargo change: the action holds no item, stack or slot (the consume flow — selected uid, the final unit's
// return, the left-button latch — runs exactly as before; the BEER lane may call start() from inside it). Death or leaving the section
// ends it at once (the offsets taken back).
import * as THREE from 'three';
import type {VomitApi} from '../market/beer/effectsApi';
import type {BodySource} from '../physics/world';
import type {StaticQuery} from '../physics/staticQuery';
import type {PlayerModifiers} from './modifiers';
import {PITCH_LIMIT} from './mouseLook';
import {VomitChunks} from './vomitChunks';

/** The action's timeline (s) and amplitudes. */
export const VOMIT = {
  duration: 2.6,
  /** The held item is lowered over the gag and brought back over the recovery. */
  stow: [0, 0.4] as const,
  restore: [2.05, 2.6] as const,
  /** Hunched posture between the gag and the recovery (rad, + = look down). */
  hunch: 0.14,
  /** The heaves: start time, pitch (rad down), head dip (m), chunks thrown. */
  heaves: [
    {t: 0.5, pitch: 0.42, dip: 0.1, chunks: 9},
    {t: 1.1, pitch: 0.32, dip: 0.08, chunks: 6},
    {t: 1.62, pitch: 0.22, dip: 0.05, chunks: 4},
  ] as const,
  /** One heave's length (s); the chunks leave over its [throw0, throw1] fraction. */
  heaveLen: 0.38,
  throw: [0.2, 0.62] as const,
  /** Ground movement while it lasts (x base), eased back to 1 over the recovery. */
  speedMult: 0.15,
  /** The chunks' throw: speed (m/s), the angle below the horizontal (rad), the mouth below / ahead of the eye (m). */
  throwSpeed: 2.3,
  throwDown: 0.62,
  mouth: {down: 0.11, ahead: 0.14},
} as const;

/** What the action needs from Game (structural: Node tests drive it with a small host). */
export interface VomitHost {
  state: string;
  player: {alive: boolean; pitch: number; eye: number; yaw: number; vx: number; vz: number};
  camera: THREE.Camera;
  scene: THREE.Object3D;
  trainRide?: {riding: boolean} | null;
  skywaysCar?: {driving: boolean} | null;
  physics?: {readonly statics: StaticQuery | null; addSource(s: BodySource): void} | null;
  marketAudio?: {retch(): void} | null;
  frameHooks: ((dt: number) => void)[];
  sectionHooks: {build?(layout: never): void; teardown?(): void}[];
  modifierSources: (() => Partial<PlayerModifiers>)[];
  inputOwners: (() => boolean)[];
}

const smooth = (a: number, b: number, t: number) => { const k = Math.max(0, Math.min(1, (t - a) / (b - a))); return k * k * (3 - 2 * k); };

/** The view's pitch offset (rad, + = down) at time t of the action. */
export function vomitPitch(t: number): number {
  if (t <= 0 || t >= VOMIT.duration) return 0;
  let a = VOMIT.hunch * smooth(0.05, 0.45, t) * (1 - smooth(VOMIT.restore[0] - 0.15, VOMIT.restore[1], t));
  for (const h of VOMIT.heaves) {
    const u = (t - h.t) / VOMIT.heaveLen;
    if (u > 0 && u < 1) a += h.pitch * Math.sin(Math.PI * u) ** 2;
  }
  return a;
}

/** The head's dip (m) at time t. */
export function vomitDip(t: number): number {
  let d = 0;
  for (const h of VOMIT.heaves) {
    const u = (t - h.t) / VOMIT.heaveLen;
    if (u > 0 && u < 1) d += h.dip * Math.sin(Math.PI * u);
  }
  return d;
}

/** The held item's lowering (0 normal .. 1 out of view) at time t. */
export function vomitHolster(t: number): number {
  if (t <= 0 || t >= VOMIT.duration) return 0;
  return smooth(VOMIT.stow[0], VOMIT.stow[1], t) * (1 - smooth(VOMIT.restore[0], VOMIT.restore[1], t));
}

/** The movement multiplier at time t. */
export function vomitSpeed(t: number): number {
  if (t <= 0 || t >= VOMIT.duration) return 1;
  return VOMIT.speedMult + (1 - VOMIT.speedMult) * smooth(VOMIT.restore[0], VOMIT.duration, t);
}

const EYE = new THREE.Vector3(), FWD = new THREE.Vector3(), DIR = new THREE.Vector3(), AT = new THREE.Vector3();

export class VomitAction implements VomitApi {
  /** Seconds into the running action (-1: none). */
  private t = -1;
  /** The pitch / eye offsets put on the player this frame (taken back exactly). */
  private pitchOn = 0;
  /** Chunks thrown per heave so far. */
  private thrown: number[] = [];
  readonly chunks: VomitChunks;
  /** QA / tests. */
  readonly counts = {started: 0, refused: 0, completed: 0, cancelled: 0, chunks: 0, retches: 0};
  lastRefusal = '';

  constructor(readonly host: VomitHost) {
    this.chunks = new VomitChunks(() => this.host.physics?.statics ?? null);
  }

  install(): this {
    const h = this.host;
    h.scene.add(this.chunks.group);
    h.physics?.addSource(this.chunks); // (stepped every frame, cleared with the station)
    h.frameHooks.push(dt => this.frame(dt));
    h.sectionHooks.push({build: () => this.cancel('section'), teardown: () => this.cancel('section')}); // (never carried into a Retry / Load / the next stop)
    h.modifierSources.push(() => (this.active ? {speedMult: vomitSpeed(this.t)} : {}));
    h.inputOwners.push(() => this.active); // (the mouse buttons: no shot / swing / aim / flare / item use while it lasts)
    return this;
  }

  get active(): boolean { return this.t >= 0; }
  /** Seconds into the action (0 when none). */
  get elapsed(): number { return Math.max(0, this.t); }
  /** How far the held item is lowered (0 .. 1; Game's viewmodel reads it after the consume view). */
  get holster(): number { return this.active ? vomitHolster(this.t) : 0; }

  /** Why it cannot start now ('' = it can). */
  refusal(): string {
    const h = this.host;
    if (this.active) return 'busy';
    if (!h.player.alive) return 'dead';
    if (h.state !== 'playing') return 'menu';
    if (h.trainRide?.riding) return 'riding';
    if (h.skywaysCar?.driving) return 'driving';
    return '';
  }

  start(): boolean {
    const why = this.refusal();
    if (why) { this.lastRefusal = why; this.counts.refused++; return false; }
    this.t = 0;
    this.pitchOn = 0;
    this.thrown = VOMIT.heaves.map(() => 0);
    this.counts.started++;
    try { this.host.marketAudio?.retch(); this.counts.retches++; } catch (err) { console.warn('vomit: retch failed', err); }
    return true;
  }

  /** Per frame (a Game frame hook: after the player's step, before the camera). */
  frame(dt: number): void {
    if (!this.active) return;
    const h = this.host, p = h.player;
    if (!p.alive || h.trainRide?.riding || h.skywaysCar?.driving) { this.cancel(!p.alive ? 'dead' : 'riding'); return; }
    this.t = Math.min(VOMIT.duration, this.t + Math.max(0, Math.min(0.1, dt)));
    this.applyPose();
    this.throwChunks(this.t);
    if (this.t >= VOMIT.duration) { this.finish(); this.counts.completed++; }
  }

  /** The view: the player's own pitch plus this frame's offset (clamped; exactly that much is taken back later), the head's dip. */
  private applyPose(): void {
    const p = this.host.player;
    const base = p.pitch + this.pitchOn; // (+ = the offset looks DOWN: the player's pitch goes negative)
    const next = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, base - vomitPitch(this.t)));
    this.pitchOn = base - next;
    p.pitch = next;
    p.eye -= vomitDip(this.t); // (Player.update writes the eye fresh every frame: this never accumulates)
  }

  /** Each heave throws its chunks over the first part of the heave, from the mouth, forward and down. */
  private throwChunks(t: number): void {
    const h = this.host, p = h.player;
    VOMIT.heaves.forEach((hv, i) => {
      const a = hv.t + VOMIT.heaveLen * VOMIT.throw[0], b = hv.t + VOMIT.heaveLen * VOMIT.throw[1];
      if (t <= a) return;
      const due = t >= b ? hv.chunks : Math.ceil(hv.chunks * (t - a) / (b - a));
      for (; this.thrown[i] < due; this.thrown[i]++) {
        h.camera.updateMatrixWorld();
        h.camera.getWorldPosition(EYE);
        FWD.set(-Math.sin(p.yaw), 0, -Math.cos(p.yaw));
        AT.copy(EYE).addScaledVector(FWD, VOMIT.mouth.ahead);
        AT.y -= VOMIT.mouth.down;
        DIR.copy(FWD).multiplyScalar(Math.cos(VOMIT.throwDown));
        DIR.y = -Math.sin(VOMIT.throwDown);
        if (this.chunks.spawn(AT, DIR, VOMIT.throwSpeed, {x: p.vx, y: 0, z: p.vz})) this.counts.chunks++;
      }
    });
  }

  /** The end (or a cancel): the pitch offset taken back, nothing held, the item free to come back. */
  private finish(): void {
    const p = this.host.player;
    if (this.pitchOn) p.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, p.pitch + this.pitchOn));
    this.pitchOn = 0;
    this.t = -1;
  }

  /** Ends it at once (death, the section going, QA). The chunks already thrown stay (the station clears them). */
  cancel(_why = 'cancel'): void {
    if (!this.active) return;
    this.finish();
    this.counts.cancelled++;
  }

  qa() {
    return {active: this.active, t: +this.elapsed.toFixed(3), holster: +this.holster.toFixed(3), pitchOn: +this.pitchOn.toFixed(4), chunks: this.chunks.live, counts: {...this.counts},
      lastRefusal: this.lastRefusal};
  }
}

/** QA hooks (spread into window.__LL by qa.ts) for SHORT serial browser spot checks. */
export function vomitQaApi(sys: () => VomitApi | null | undefined) {
  const own = () => { const s = sys(); return s instanceof VomitAction ? s : null; };
  return {
    /** The action's state (active, time, held-item lowering, live chunks, counts). */
    vomit: () => own()?.qa() ?? null,
    /** Start it as the beer would (false: refused — see vomit().lastRefusal). */
    vomitStart: () => sys()?.start() ?? false,
    /** The live chunks (position, radius / rest height, mode 0 air / 1 sliding / 2 resting). */
    vomitChunks: () => own()?.chunks.list() ?? [],
  };
}

/** Installs the throw-up action into a Game (one call in the Game constructor; Game.vomit). */
export function installVomit(game: unknown): VomitAction {
  return new VomitAction(game as VomitHost).install();
}
