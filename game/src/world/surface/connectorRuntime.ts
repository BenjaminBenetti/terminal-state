// Task studio-surface-host-ground-connectors-20261118-053602-01: SURFACE RUN version 2 — the Office / Mall CONNECTOR, walked.
// User: "Replace Office/Mall Surface elevators BOTH WAYS with believable level-ground ON-FOOT connectors … The most important thing is the
// CONTINUOUS SEAMLESS FEEL: responsive movement and yaw/pitch through a continuously rendered, physically coherent passage …"
//
//  - THE SITE (a section whose layout has a connector: layout.surfaceAccess.connector / layout.surface.portal.connector): the tube's view
//    (world/surface/connectorView.ts) at that world's record, in its world group (built at the section build's hooks step: it compiles
//    with the warm-up).
//  - THE WALK: the player steps into the tube from this world's WALK-IN side (the host doorway — the Office boarding's cut, the Mall's
//    vestibule — or the tent floor) and is HELD on the tube's own collision model (gen/surface/connectorShape.ts connectorModel:
//    Player.update in the tube's frame — look, walk, crouch and jump as anywhere; no sprint under the low roof) until they step back out
//    on that side or, after a crossing, out of the far mouth into the other world. The walk-in flap rolls up as the player comes near it
//    and down behind them; the far flap stays down. The player in the tube proper breathes the tube's air (sealed canvas: gas shelter).
//  - THE CROSSING (Game.walkSurfaceConnector, started when the held player has walked a metre in with the walk-in flap down behind them):
//    both flaps latched shut — the tube is SEALED (Game.render draws its view only: drawSealed) — the old world left with the tube's view
//    kept and drawn, the destination prepared, its record's tube placed (identical inside: only the world placement differs) and the
//    player carried over in the tube's frame, the destination built PACED and its first view prepared while the player keeps walking and
//    looking in the tube; only then (markReady) the far flap — now the destination's walk-in flap — rolls up as the player comes near it,
//    and they walk out. Never an [E], a loading screen or a camera cut on the normal path. A refusal (a crossing participant's "set it
//    down first", …) keeps the flaps as they are with the reason in the prompt: the player walks back out. A failure is the Game's
//    recovery (the section left rebuilt, the player at its way back).
//  - Bounded: at most two views exist (the held one and, for one call, the new one); one frame hook, no light.

import * as THREE from 'three';
import type {Game} from '../../game';
import type {StationLayout} from '../../gen/stationTypes';
import type {SurfaceConnector} from '../../gen/surface/surfaceTypes';
import {CONNECTOR, connectorModel, connectorStepYaw, connectorToStep, connectorToWorld, connectorWorldYaw, stepToConnector, worldToConnector, type ConnectorModel} from '../../gen/surface/connectorShape';
import {STAND_EYE, type MoveInput} from '../../player/player';
import {CULL_LAYER} from '../levelCulling';
import {towerCue} from '../towerShared';
import {CONNECTOR_LOOK, buildConnectorView, loadConnectorTextures, type ConnectorView} from './connectorView';

/** The walk's tuning (m, s). */
export const CONNECTOR_WALK = {
  /** The held player's radius against the tube's flaps (the model's walls use Player.update's own). */
  radius: 0.3,
  /** A flap rolls up when the player is this close to its plane on either side (within the apron's width), and down beyond it. */
  near: 1.3,
  /** Flap travel (fraction per s) and the open fraction a player may pass under. */
  flapRate: 2.2, pass: 0.95,
  /** The take zone: the player's centre this close (m) to the walk-in side's wall plane / mouth, within the doorway's width. */
  take: 0.42,
  /** Release: back on the walk-in side this far beyond the doorway's inner plane / the tent mouth, or this far outside the doorway's width. */
  release: 0.5, releaseSide: 0.15,
  /** The seam: the held player at least this far into the tube from the walk-in flap's plane, the flap fully down. */
  seam: 1.0,
  /** Re-arm: a disarmed walk (just arrived / refused) arms again within this distance of the walk-in flap's plane. */
  rearm: 1.0,
  /** How often (s) an armed walk at the seam re-reads a 'busy' gate (any other refusal disarms it). */
  refusalEvery: 0.3,
} as const;

/** One world's drawn tube. */
interface ConnectorEnd {
  rec: SurfaceConnector;
  view: ConnectorView;
  model: ConnectorModel;
  /** Owned by the section's world group (true) or held by a crossing (false). */
  inWorld: boolean;
}

/** The connector of a layout (null: none). */
export function connectorOfLayout(layout: Pick<StationLayout, 'surfaceAccess' | 'surface'> | null | undefined): SurfaceConnector | null {
  return layout?.surfaceAccess?.connector ?? layout?.surface?.portal.connector ?? null;
}

/** The flap index of a record's walk-in side (0 the host mouth, 1 the tent mouth) and its plane's s. */
export const walkInFlap = (r: Pick<SurfaceConnector, 'end'>): 0 | 1 => (r.end === 'host' ? 0 : 1);
/** A point on this world's own floor just past the walk-in mouth (world x / z; `t` clamped inside the opening): the culler's eye there. */
function mouthPoint(q: SurfaceConnector, t: number): [number, number] {
  const ds = q.end === 'host' ? -q.door.depth - 0.35 : q.len + 0.35, half = (q.end === 'host' ? q.door.width : CONNECTOR.width) / 2 - 0.1;
  return connectorToWorld(q, ds, Math.max(-half, Math.min(half, t)));
}
export const flapPlane = (r: Pick<SurfaceConnector, 'len'>, f: 0 | 1): number => (f === 0 ? CONNECTOR_LOOK.flapIn : r.len - CONNECTOR_LOOK.flapIn);

const SEAL_MASK = (1 << CULL_LAYER) >>> 0;
const sameRec = (a: SurfaceConnector, b: SurfaceConnector) => JSON.stringify(a) === JSON.stringify(b);
const runtimes = new WeakMap<object, SurfaceConnectorRuntime>();
/** The connector runtime of a game (QA / tests). */
export const surfaceConnectorOf = (game: object): SurfaceConnectorRuntime | undefined => runtimes.get(game);

export class SurfaceConnectorRuntime {
  /** The current section's tube (null: none). */
  site: ConnectorEnd | null = null;
  /** The crossing's held tube (out of any world group) while the old world is left / the new one built; adopted by the destination. */
  private held: ConnectorEnd | null = null;
  /** 'crossing': Game.walkSurfaceConnector is in flight (begin .. markReady / reset). */
  phase: 'idle' | 'crossing' = 'idle';
  /** The player is held in the tube (Game.update / updateTransitGap step them through stepPlayer). */
  holding = false;
  /** Flap open fractions (host mouth, tent mouth): 0 down .. 1 rolled up. */
  flap: [number, number] = [0, 0];
  /** The crossing goes out (host -> tent) / in. */
  out = true;
  /** The destination is ready (built, its first view prepared): its walk-in flap may roll up. Set by the Game. */
  ready = false;
  /** The destination's tube was placed (the view swapped). */
  reposed = false;
  /** The seam may fire: the held player came in through this world's walk-in side (a just-arrived / refused walk is disarmed). */
  armed = false;
  /** (Game, during a crossing) the truthful status line while the far flap waits for the destination (HUD prompt; null: none). */
  progress: (() => string) | null = null;
  /** A refusal that keeps the seam from firing (shown in the prompt while the player stays in the tube). */
  refusal: string | null = null;
  private refusalT = 0;
  /** The held player's tube-local pose (s along, t across, y above the floor, yaw = world yaw - the record's), velocity (s, t). */
  private local = {s: 0, t: 0, y: 0, yaw: 0, vs: 0, vt: 0};
  private model: ConnectorModel | null = null;
  /** The culler's eye proxy while the eye is in the tube (decides from the walk-in side's doorway). */
  private proxy: ((e: THREE.Vector3) => void) | null = null;
  private proxied: {eyeProxy: ((e: THREE.Vector3) => void) | null} | null = null;
  private waiters: ((ok: boolean) => void)[] = [];
  readonly counts = {sites: 0, adopted: 0, views: 0, disposed: 0, takes: 0, releases: 0, seams: 0, refusals: 0, crossings: 0, reposes: 0, readies: 0, resets: 0, heldFrames: 0, sealedFrames: 0, sealedMax: 0, flapOpens: 0};

  constructor(readonly game: Game) {}

  install(): this {
    const g = this.game;
    runtimes.set(g, this);
    (g as unknown as {surfaceConnector: SurfaceConnectorRuntime | null}).surfaceConnector = this;
    g.sectionHooks.push({build: layout => this.build(layout as StationLayout), teardown: () => this.teardown()});
    g.frameHooks.push(dt => this.tick(dt));
    g.promptProviders.unshift(() => this.statusLine());
    // the canvas set: fetched before the build of any section with a connector (bounded: then the fallback set)
    g.sectionPreloads?.push(layout => (connectorOfLayout(layout)
      ? Promise.race([loadConnectorTextures().then(() => undefined), new Promise<void>(r => setTimeout(r, CONNECTOR_LOOK.waitMs))]) : Promise.resolve()));
    return this;
  }

  /** The tube drawn now (held during a crossing, else the site). */
  private current(): ConnectorEnd | null {
    return this.held ?? this.site;
  }

  /** QA / Game: the record of the tube drawn now. */
  record(): SurfaceConnector | null {
    return this.current()?.rec ?? null;
  }

  /** The status line (the HUD prompt) while held: a crossing's progress until ready, a refusal. */
  statusLine(): string | null {
    if (!this.holding) return null;
    if (this.phase === 'crossing' && !this.ready && this.progress) return this.progress() || null;
    return this.refusal;
  }

  /** The tube is SEALED: a crossing in flight with both flaps down — nothing of either world can be seen from inside it. */
  get sealed(): boolean {
    return this.phase === 'crossing' && this.flap[0] <= 0 && this.flap[1] <= 0 && !!this.current();
  }

  /** The player breathes the tube's air: held in the tube proper (between the mouths). */
  sheltered(): boolean {
    return this.holding && this.local.s >= 0 && this.local.s <= (this.current()?.rec.len ?? 0);
  }

  /**
   * Draw one frame sealed (Game.render): every renderable of `scene` outside the tube's view and the `keep` roots moves to CULL_LAYER
   * for that call only (as the cargo lift's sealed car: world/surface/liftRuntime.ts drawSealed).
   */
  drawSealed(scene: THREE.Object3D, keep: readonly THREE.Object3D[], draw: () => void): void {
    const e = this.current();
    if (!e) { draw(); return; }
    const objs = this.sealObjs, masks = this.sealMasks, stack = this.sealStack;
    objs.length = masks.length = stack.length = 0;
    for (const c of scene.children) stack.push(c);
    while (stack.length) {
      const o = stack.pop()!;
      if (o === e.view.root || keep.includes(o)) continue;
      const r = o as THREE.Mesh & {isPoints?: boolean; isLine?: boolean; isSprite?: boolean};
      if ((r.isMesh || r.isPoints || r.isLine || r.isSprite) && o.layers.mask !== SEAL_MASK) { objs.push(o); masks.push(o.layers.mask); o.layers.mask = SEAL_MASK; }
      for (const c of o.children) stack.push(c);
    }
    this.counts.sealedFrames++;
    this.counts.sealedMax = Math.max(this.counts.sealedMax, objs.length);
    try { draw(); } finally {
      for (let i = 0; i < objs.length; i++) objs[i].layers.mask = masks[i];
      objs.length = masks.length = 0;
    }
  }
  private readonly sealObjs: THREE.Object3D[] = [];
  private readonly sealMasks: number[] = [];
  private readonly sealStack: THREE.Object3D[] = [];

  // -------------------------------------------------------------------------------------------
  // The site

  /** The district's host-name plate text (the host station's own name). */
  private hostName(): string {
    const g = this.game as unknown as {surfaceStationName?: (k: unknown) => string; run?: {current: {level: string; station?: string}}};
    try {
      const cur = g.run?.current;
      return cur && g.surfaceStationName ? g.surfaceStationName({level: cur.level, section: 'main', station: cur.station}) : '';
    } catch { return ''; }
  }

  private makeEnd(rec: SurfaceConnector): ConnectorEnd {
    const view = buildConnectorView(rec, rec.end === 'tent' ? {name: this.hostName()} : {});
    this.game.atmosphere?.markShadows(view.root, false);
    this.counts.views++;
    return {rec, view, model: connectorModel(rec), inWorld: false};
  }

  build(layout: StationLayout): void {
    const g = this.game, rec = connectorOfLayout(layout);
    if (this.site && this.site.inWorld) this.site = null; // (stale: its world group is gone)
    if (!rec || !g.world) return;
    const h = this.held;
    if (h && sameRec(h.rec, rec)) {
      // the crossing's destination tube: adopted by this world (drawn on; disposed with it)
      h.view.root.removeFromParent();
      g.world.group.add(h.view.root);
      h.inWorld = true;
      this.site = h;
      this.held = null;
      this.counts.adopted++;
      return;
    }
    const e = this.makeEnd(rec);
    g.world.group.add(e.view.root);
    e.inWorld = true;
    this.site = e;
    this.flap = [0, 0];
    e.view.setFlap(0, 0);
    e.view.setFlap(1, 0);
    this.counts.sites++;
  }

  teardown(): void {
    // (a held tube is the crossing's: holdForLeave took it out of the site before Game.leaveSection)
    if (this.site?.inWorld) this.disposeEnd(this.site);
    this.site = null;
    this.unproxy();
  }

  private disposeEnd(e: ConnectorEnd): void {
    e.view.dispose();
    this.counts.disposed++;
  }

  // -------------------------------------------------------------------------------------------
  // The crossing (driven by Game.walkSurfaceConnector)

  /** A crossing may start here: the tube is drawn, nothing in flight, the player held in it. */
  canCross(): boolean {
    return !!this.site && this.phase === 'idle' && !this.held && this.holding;
  }

  /** The crossing starts: both flaps latched down (they are: the seam fired with them down). */
  begin(out: boolean): void {
    this.out = out;
    this.ready = false;
    this.reposed = false;
    this.phase = 'crossing';
    this.refusal = null;
    this.counts.crossings++;
  }

  /** Before Game.leaveSection: the site's view leaves the world group (kept, drawn: the crossing's). */
  holdForLeave(): void {
    const s = this.site;
    if (!s) return;
    s.view.root.removeFromParent();
    this.game.scene.add(s.view.root);
    s.inWorld = false;
    this.held = s;
    this.site = null;
    this.unproxy();
  }

  /**
   * The destination's tube (from its generated layout): its view built at the destination record, the held origin view disposed, the
   * player carried over in the tube frame (the same s / t / yaw; the world pose from the new record). After this the destination's site
   * adopts the held view.
   */
  repose(dest: SurfaceConnector): boolean {
    const from = this.held;
    if (!from || Math.abs(from.rec.len - dest.len) > 1e-3) return false;
    if (this.holding) this.foldLook(from);
    const e = this.makeEnd(dest);
    this.game.scene.add(e.view.root);
    e.view.setFlap(0, 0);
    e.view.setFlap(1, 0);
    this.held = e;
    this.disposeEnd(from);
    this.model = e.model;
    this.reposed = true;
    this.counts.reposes++;
    if (this.holding) this.writePlayer(e);
    return true;
  }

  /** The destination is ready (built, its first view prepared): its walk-in flap may roll up; the crossing is over. */
  markReady(): void {
    this.ready = true;
    this.phase = 'idle';
    this.armed = false; // (the player walks out; to go back they first come to this world's walk-in flap)
    this.counts.readies++;
    this.flush(true);
  }

  /** Failure / cancel: a held view disposed, the player released, idle (the site, if any, as it was). */
  reset(): void {
    if (this.held) this.disposeEnd(this.held);
    this.held = null;
    this.release();
    this.phase = 'idle';
    this.ready = false;
    this.armed = false;
    this.counts.resets++;
    this.flush(false);
  }

  /** Resolves when the crossing ends (markReady: true; reset: false). */
  ended(): Promise<boolean> {
    if (this.phase !== 'crossing') return Promise.resolve(this.ready);
    return new Promise(r => this.waiters.push(r));
  }

  private flush(ok: boolean): void {
    const w = this.waiters;
    this.waiters = [];
    for (const r of w) r(ok);
  }

  // -------------------------------------------------------------------------------------------
  // Per frame (a frame hook in play; Game.updateTransitGap in the transit gap)

  tick(dt: number): void {
    const e = this.current(), g = this.game, P = g.player;
    if (!e) { if (this.holding) this.release(); return; }
    const rec = e.rec, wi = walkInFlap(rec);
    const [s, t] = this.holding ? [this.local.s, this.local.t] : worldToConnector(rec, P.x, P.z);
    const level = this.holding || Math.abs(P.y - rec.y) < 0.6; // (on the tube's floor: the walk-in side's floor is the record's)
    const playing = g.state === 'playing' || this.phase === 'crossing';
    // the flaps: the walk-in one rolls up for a player near it (not while a crossing is unfinished), the far one stays down
    const pw = flapPlane(rec, wi), near = level && Math.abs(t) < CONNECTOR.apronHalf && Math.abs(s - pw) < CONNECTOR_WALK.near;
    const openWalkIn = near && playing && this.phase === 'idle';
    const targets: [number, number] = [0, 0];
    targets[wi] = openWalkIn ? 1 : 0;
    for (const f of [0, 1] as const) {
      const was = this.flap[f], to = targets[f];
      const k = to > was ? Math.min(to, was + dt * CONNECTOR_WALK.flapRate) : Math.max(to, was - dt * CONNECTOR_WALK.flapRate);
      if (k !== was) {
        if (was <= 0 && k > 0) { this.counts.flapOpens++; this.cue(e, f, true); }
        if (k <= 0 && was > 0) this.cue(e, f, false);
        this.flap[f] = k;
        e.view.setFlap(f, k);
      }
    }
    if (!playing) return;
    if (!this.holding) {
      // take: in the walk-in side's take zone, on its floor
      if (this.phase === 'idle' && level && this.inTakeZone(rec, s, t) && !(P as {climbing?: boolean}).climbing) this.takePlayer(e, s, t);
    } else {
      const L = this.local;
      if (this.phase === 'idle' && this.releasable(rec, L.s, L.t)) { this.release(); return; }
      // the seam: armed, the walk-in flap down behind them, a metre in
      const into = wi === 0 ? L.s - pw : pw - L.s;
      if (this.phase === 'idle') {
        if (!this.armed && into < CONNECTOR_WALK.rearm && this.flap[wi] > 0) { this.armed = true; this.refusal = null; this.refusalT = 0; }
        if (this.armed && this.flap[wi] <= 0 && into >= CONNECTOR_WALK.seam) this.fireSeam(dt);
      }
      this.foldLook(e);
      this.writePlayer(e);
      this.setProxy();
    }
  }

  /** The walk-in side's take zone (tube-local). */
  private inTakeZone(r: SurfaceConnector, s: number, t: number): boolean {
    if (r.end === 'host') return s >= -r.door.depth - CONNECTOR_WALK.take && s < CONNECTOR_LOOK.flapIn && Math.abs(t) < r.door.width / 2;
    return s <= r.len + CONNECTOR_WALK.take && s > r.len - CONNECTOR_LOOK.flapIn && Math.abs(t) < CONNECTOR.width / 2;
  }

  /** Back out on the walk-in side (tube-local): beyond the release line, or stepped sideways out of the doorway's column. */
  private releasable(r: SurfaceConnector, s: number, t: number): boolean {
    const W = CONNECTOR_WALK;
    if (r.end === 'host') return s < -r.door.depth - W.release || (s < -r.door.depth - 0.05 && Math.abs(t) > r.door.width / 2 + W.releaseSide);
    return s > r.len + W.release || (s > r.len + 0.05 && Math.abs(t) > CONNECTOR.width / 2 + W.releaseSide);
  }

  /**
   * The seam fired: ask the Game to cross. A refusal DISARMS the walk with its reason (shown while held; the player walks back out, or
   * comes back to the walk-in flap to try again: tick's re-arm), so a cause that clears later never crosses a player who turned back;
   * only 'busy' (a moment's lifecycle step) is re-read now and then.
   */
  private fireSeam(dt: number): void {
    const g = this.game as unknown as {surfaceCrossRefusal(): {code: string; text: string} | null; crossSurface(): Promise<{ok: boolean; error?: string}>; surfaceCrossing: unknown};
    if (g.surfaceCrossing) return;
    this.refusalT -= dt;
    if (this.refusalT > 0) return;
    this.refusalT = CONNECTOR_WALK.refusalEvery;
    const r = g.surfaceCrossRefusal();
    if (r) {
      if (r.code === 'busy') return;
      this.counts.refusals++;
      this.refusal = r.text;
      this.armed = false;
      return;
    }
    this.refusal = null;
    this.armed = false; // (one crossing per walk-in)
    this.counts.seams++;
    void g.crossSurface().then(res => { if (!res.ok && res.error && this.holding && this.phase === 'idle') this.refusal = res.error; });
  }

  private cue(e: ConnectorEnd, f: 0 | 1, open: boolean): void {
    const s = flapPlane(e.rec, f), [x, z] = connectorToWorld(e.rec, s, 0);
    towerCue(this.game.sfx, open ? 'cabinetOpen' : 'cabinetClose', {x, y: e.rec.y + 1.4, z}, {rate: open ? 1.35 : 1.2, gain: 0.22});
  }

  // -------------------------------------------------------------------------------------------
  // The held player (the tube's frame)

  private takePlayer(e: ConnectorEnd, s: number, t: number): void {
    const P = this.game.player;
    this.model = e.model;
    this.local = {s, t, y: 0, yaw: connectorStepYaw(e.rec, P.yaw), vs: 0, vt: 0};
    // the world velocity into the tube's frame (forward f, right r)
    const c = Math.cos(e.rec.yaw), sn = Math.sin(e.rec.yaw), fx = -sn, fz = -c, rx = -fz, rz = fx;
    this.local.vs = (P.vx ?? 0) * fx + (P.vz ?? 0) * fz;
    this.local.vt = (P.vx ?? 0) * rx + (P.vz ?? 0) * rz;
    this.holding = true;
    this.armed = true;
    this.refusal = null;
    this.refusalT = 0;
    this.counts.takes++;
  }

  private release(): void {
    if (!this.holding) return;
    this.holding = false;
    this.model = null;
    this.refusal = null;
    this.counts.releases++;
    this.unproxy();
  }

  /** Game.update / updateTransitGap instead of Player.update while held: Player.update on the tube's model, then the world pose. */
  stepPlayer(dt: number, input: MoveInput, opts: {aiming: boolean; speedMult: number; canSprint: boolean}): boolean {
    const e = this.current(), P = this.game.player, M = this.model;
    if (!e || !M) return false;
    this.counts.heldFrames++;
    const L = this.local;
    L.yaw = connectorStepYaw(e.rec, P.yaw); // (the mouse look was applied to the world yaw)
    const [sx, sz] = connectorToStep(M, L.s, L.t);
    const s0 = L.s;
    P.x = sx; P.z = sz; P.y = L.y; P.yaw = L.yaw;
    P.vx = L.vt; P.vz = -L.vs; // (the step frame: x = t, z = -s)
    let step = false;
    try {
      step = P.update(Math.min(dt, 0.05), input, M.levels, null, {...opts, canSprint: false});
    } finally {
      const [s, t] = stepToConnector(M, P.x, P.z);
      L.s = s; L.t = t;
      L.y = P.grounded && Math.abs(P.y) < 1e-4 ? 0 : P.y;
      L.yaw = P.yaw; L.vt = P.vx; L.vs = -P.vz;
      this.clampFlaps(e.rec, s0);
      this.writePlayer(e);
    }
    return step;
  }

  /** A flap not rolled up stops the player at its plane, on the side they came from. */
  private clampFlaps(r: SurfaceConnector, s0: number): void {
    const L = this.local, R = CONNECTOR_WALK.radius;
    for (const f of [0, 1] as const) {
      if (this.flap[f] >= CONNECTOR_WALK.pass) continue;
      const p = flapPlane(r, f);
      if (s0 >= p && L.s < p + R) { L.s = p + R; if (L.vs < 0) L.vs = 0; }
      else if (s0 < p && L.s > p - R) { L.s = p - R; if (L.vs > 0) L.vs = 0; }
    }
  }

  /** The look since the last step (applied to the world yaw) into the tube's frame (the order of the frame's steps is irrelevant). */
  private foldLook(e: ConnectorEnd): void {
    this.local.yaw = connectorStepYaw(e.rec, this.game.player.yaw);
  }

  private writePlayer(e: ConnectorEnd): void {
    const P = this.game.player, L = this.local, r = e.rec;
    const [x, z] = connectorToWorld(r, L.s, L.t);
    P.x = x; P.z = z; P.y = r.y + L.y;
    P.yaw = connectorWorldYaw(r, L.yaw);
    const c = Math.cos(r.yaw), sn = Math.sin(r.yaw), fx = -sn, fz = -c, rx = -fz, rz = fx;
    P.vx = fx * L.vs + rx * L.vt; P.vz = fz * L.vs + rz * L.vt;
    P.eye = P.stanceEye + P.y - P.landDip;
  }

  /**
   * Where the walker comes out (lane READY's CrossingExit, render/firstView.ts): the eye just past this world's walk-in mouth on its own
   * floor (the host lobby inside the doorway / the tent in front of its mouth), facing out of the tube. Null: no tube drawn.
   */
  exitPoint(): {x: number; y: number; z: number; yaw: number} | null {
    const e = this.current();
    if (!e) return null;
    const [x, z] = mouthPoint(e.rec, 0);
    return {x, y: e.rec.y + STAND_EYE, z, yaw: e.rec.end === 'host' ? e.rec.yaw + Math.PI : e.rec.yaw};
  }

  /** The level culler decides from the walk-in side's doorway while the eye is in the tube (in the host world it is off the grid). */
  private setProxy(): void {
    const cul = (this.game.world as unknown as {culler?: {eyeProxy: ((v: THREE.Vector3) => void) | null}} | null)?.culler;
    if (!cul || !('eyeProxy' in cul)) return;
    if (this.proxied && this.proxied !== cul) this.unproxy();
    if (cul.eyeProxy && cul.eyeProxy !== this.proxy) return; // (another runtime's: never two)
    this.proxy ??= (v: THREE.Vector3) => {
      const c = this.current();
      if (!c || !this.holding) return;
      const q = c.rec, [s, t] = worldToConnector(q, v.x, v.z);
      if (q.end === 'host' ? s < -q.door.depth : s > q.len) return; // (on the world's own floor)
      const [x, z] = mouthPoint(q, t);
      v.x = x; v.z = z;
    };
    cul.eyeProxy = this.proxy;
    this.proxied = cul;
  }

  private unproxy(): void {
    const cul = this.proxied;
    if (cul && cul.eyeProxy === this.proxy) cul.eyeProxy = null;
    this.proxied = null;
  }

  /** QA: the walk's state. */
  qa() {
    const e = this.current();
    return {phase: this.phase, holding: this.holding, flap: [...this.flap] as [number, number], out: this.out, ready: this.ready, reposed: this.reposed, armed: this.armed,
      refusal: this.refusal, sealed: this.sealed, local: {...this.local}, record: e ? structuredClone(e.rec) : null, site: this.site ? {inWorld: this.site.inWorld} : null, held: !!this.held,
      counts: {...this.counts}};
  }
}

export function installSurfaceConnector(game: Game): void {
  new SurfaceConnectorRuntime(game).install();
}
