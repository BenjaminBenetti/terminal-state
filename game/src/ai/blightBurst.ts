// Task track1-siren-blightbelly-20261031 (lane BLIGHT): the Blightbelly death burst. installBlightBurst(game) is called ONCE
// from the Game constructor and only REGISTERS (like world/gas/system.ts):
//  - adopt(actor) (Game.spawnEnemy, every actor): a Blightbelly's brain reports its death ONCE (BlightbellyBrain.damage ->
//    onDeath; ai/blightbelly.ts) into a bounded queue (the kill point + storey captured at the killing hit);
//  - a frame hook (play dt only — menus / loading / death screens never tick it): after BLIGHTBELLY_BURST.delayS each queued
//    death BURSTS exactly once (a WeakSet guards it too), at most maxPerFrame per frame:
//      1. VFX: the largest pustule clusters (extras burst points, <= maxPops) pop — DamageSystem.burst flesh pieces + the
//         Effects soft-particle pus spray / green mist (existing pools: no new material, nothing to warm) — and the pustule
//         domes are hidden (popped);
//      2. audio: Sfx.blightBurst + Sfx.blightHiss (lane AUDIO: once per id, positional, occluded);
//      3. BLAST to the player: blastMax x falloff(nearest body point distance) x the fraction of body samples (feet+0.25,
//         +0.75, +1.15, eye) the burst centre SEES through raycastWorld (walls, slabs, props: real cover, storey isolation);
//         a 'blast' hit through Game.blastPlayer (armour, injuries, HUD direction, shake) — the gas mask is irrelevant here;
//      4. the same blast to OTHER living enemies (enemyMax, LOS): staggers / wounds; a kill is a normal kill (Game.blastKill:
//         death cue, ragdoll) — a Blightbelly killed by it bursts in turn (once, queued: a chain is bounded and paced);
//      5. the pop is loud: enemies within `noise` hear it (walls x0.6, slabs x0.35 each, as gunfire);
//      6. a temporary local toxic puff through the EXISTING gas system (GasSystem.addPuff, world/gas/puff.ts) on the burst
//         storey — any level, the Subway too; the mask + filter protect against THAT.
//  - section hooks: build / teardown drop the queue (no burst after leaving, on load, or for a corpse revisited — killed
//    indices are never re-spawned, run/memory.ts). Spawning / disposing actors never reports a death.
// QA: `log` (last 8 bursts with the blast / puff numbers) and `counts`.

import * as THREE from 'three';
import {raycastWorld} from '../combat/hitscan';
import type {PropPlacement} from '../gen/props';
import type {Levels} from '../gen/levels';
import type {PlayerHit} from '../player/hits';
import type {PuffSpec} from '../world/gas/puff';
import {BLIGHTBELLY_BURST, BlightbellyBrain, blastDamage, blastFalloff, blastHitLocation, bodyDistance} from './blightbelly';
import {hearingMuffle, slabsBetween, type ZombieBrain} from './brain';

/** The enemy surface the burst reads (EnemyActor satisfies it; BlightbellyActor adds the pustule hooks). */
export interface BlightEnemy {
  readonly brain: ZombieBrain;
  readonly archetype?: string;
  readonly ragdolled?: boolean;
  pustulePoints?(max: number): {p: THREE.Vector3; n: THREE.Vector3; r: number}[];
  popPustules?(): boolean;
}

/** What the burst needs from Game (structural: tests drive it with a fake host). */
export interface BlightHost {
  player: {x: number; y: number; z: number; eye: number; alive: boolean; crouched?: boolean};
  layout: {props: readonly PropPlacement[]; trench: {floorY: number}};
  levels: Levels;
  zombies: readonly BlightEnemy[];
  gas: {addPuff(spec: PuffSpec): boolean};
  fx?: {blightBurst?(pos: THREE.Vector3, normal: THREE.Vector3, k?: number, cloud?: boolean): void} | null;
  damage?: {burst(point: THREE.Vector3, normal: THREE.Vector3, dir: THREE.Vector3, cls: 'flesh', surface: THREE.Color, k?: number, sizeK?: number): number} | null;
  sfx?: {blightBurst?(id: object, x: number, y: number, z: number): boolean; blightHiss?(id: object, x: number, y: number, z: number, delayS?: number): boolean} | null;
  frameHooks: ((dt: number) => void)[];
  sectionHooks: {build?(layout: never): void; teardown?(): void}[];
  /** Game.blastPlayer: the hit pipeline (armour / injuries) + HUD direction / shake / hurt cue. */
  blastPlayer(hit: PlayerHit, fromX: number, fromZ: number): {applied: number};
  /** Game.blastKill: an enemy the blast killed — the normal kill bookkeeping (death cue, ragdoll, stats). */
  blastKill?(z: BlightEnemy, dir: THREE.Vector3, point: THREE.Vector3): void;
  readonly clock: number;
}

/** One queued death (captured at the killing hit). */
interface Pending { z: BlightEnemy; t: number; x: number; y: number; zz: number; level: number }

/** QA / tests: what one burst did. */
export interface BurstRecord {
  serial: number;
  at: [number, number, number];
  level: number;
  time: number;
  pops: number;
  blast: {distance: number; visible: number; damage: number; applied: number; location: string | null};
  enemies: {hit: number; killed: number; heard: number};
  puff: boolean;
  audio: {burst: boolean; hiss: boolean};
}

const PUS = new THREE.Color(0xb3b04c);
const tv = new THREE.Vector3(), td = new THREE.Vector3();

export class BlightBurstSystem {
  private queue: Pending[] = [];
  private readonly done = new WeakSet<object>();
  private serial = 0;
  readonly counts = {adopted: 0, reported: 0, bursts: 0, dropped: 0, ignored: 0, blasts: 0, enemyHits: 0, enemyKills: 0, puffs: 0};
  readonly log: BurstRecord[] = [];

  private readonly rand: () => number;

  /** `opts.rand`: the hit-location roll (Game passes its seeded station rand; default Math.random). */
  constructor(readonly host: BlightHost, opts: {rand?: () => number} = {}) {
    this.rand = opts.rand ?? Math.random;
  }

  install(): this {
    this.host.frameHooks.push(dt => this.frame(dt));
    this.host.sectionHooks.push({build: () => this.reset(), teardown: () => this.reset()});
    return this;
  }

  /** Game.spawnEnemy: a Blightbelly's brain reports its (single) death here. Other actors are ignored. */
  adopt(z: BlightEnemy): void {
    const b = z.brain;
    if (!(b instanceof BlightbellyBrain)) return;
    b.onDeath = () => this.report(z);
    this.counts.adopted++;
  }

  /** Queued deaths (QA). */
  get pending(): number {
    return this.queue.length;
  }

  /** The (single) death of a Blightbelly: queue its burst at the kill point. Never twice for one actor. */
  report(z: BlightEnemy): void {
    if (this.done.has(z) || this.queue.some(q => q.z === z)) { this.counts.ignored++; return; }
    if (this.queue.length >= BLIGHTBELLY_BURST.maxQueued) { this.counts.dropped++; return; }
    const b = z.brain;
    this.queue.push({z, t: BLIGHTBELLY_BURST.delayS, x: b.x, y: b.y, zz: b.z, level: this.levelOf(b.x, b.y, b.z)});
    this.counts.reported++;
  }

  /** Storey (layout.levels index) of a feet point: the supporting level, else the highest base at or below it. */
  private levelOf(x: number, y: number, z: number): number {
    const L = this.host.levels;
    if (L.count <= 1) return 0;
    const lv = L.levelAt(x, z, y + 0.05);
    if (lv >= 0) return lv;
    let best = 0, by = -Infinity;
    L.list.forEach((l, i) => { if (l.baseY <= y + 0.3 && l.baseY > by) { by = l.baseY; best = i; } });
    return best;
  }

  /** Drops every queued burst (section build / teardown). */
  reset(): void {
    this.queue = [];
  }

  frame(dt: number): void {
    if (!this.queue.length) return;
    for (const q of this.queue) q.t -= dt;
    let n = 0;
    while (n < BLIGHTBELLY_BURST.maxPerFrame) {
      const i = this.queue.findIndex(q => q.t <= 0);
      if (i < 0) break;
      const [q] = this.queue.splice(i, 1);
      this.burst(q);
      n++;
    }
  }

  /** Visible fraction of the player's body the point (cx, cy, cz) sees (raycastWorld: walls, slabs, props). */
  visibleFraction(cx: number, cy: number, cz: number): number {
    const h = this.host, P = h.player, samples = [...BLIGHTBELLY_BURST.bodySamples.map(s => Math.min(P.y + s, P.eye - 0.1)), P.eye]; // (crouched: below the eye)
    let seen = 0;
    for (const sy of samples) if (this.clear(cx, cy, cz, P.x, sy, P.z)) seen++;
    return seen / samples.length;
  }

  /** Unobstructed straight line between two points (the bullets' world: structure of every storey + props). */
  private clear(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
    const dx = bx - ax, dy = by - ay, dz = bz - az, dist = Math.hypot(dx, dy, dz);
    if (dist < 1e-4) return true;
    const h = this.host;
    const wh = raycastWorld(h.levels, h.layout.props, {x: ax, y: ay, z: az}, {x: dx / dist, y: dy / dist, z: dz / dist}, dist, h.layout.trench.floorY);
    return wh.kind === 'none' || wh.t >= dist - 0.05;
  }

  private burst(q: Pending): void {
    const h = this.host, B = BLIGHTBELLY_BURST, z = q.z;
    if (this.done.has(z)) { this.counts.ignored++; return; }
    this.done.add(z);
    this.counts.bursts++;
    const cx = q.x, cy = q.y + B.centreY, cz = q.zz;
    const rec: BurstRecord = {serial: ++this.serial, at: [r3(cx), r3(cy), r3(cz)], level: q.level, time: r3(h.clock), pops: 0,
      blast: {distance: -1, visible: 0, damage: 0, applied: 0, location: null}, enemies: {hit: 0, killed: 0, heard: 0}, puff: false, audio: {burst: false, hiss: false}};
    // 1. VFX: the pustule clusters pop (bounded), the domes are hidden, a slow green cloud at the belly
    const pts = z.pustulePoints?.(B.maxPops) ?? [];
    for (const p of pts) {
      h.damage?.burst(p.p, p.n, td.copy(p.n), 'flesh', PUS, 0.45, 0.8);
      h.fx?.blightBurst?.(p.p, p.n, Math.min(1.3, 0.6 + p.r * 4));
      rec.pops++;
    }
    h.fx?.blightBurst?.(tv.set(cx, cy, cz), td.set(0, 1, 0), 0.5, true);
    z.popPustules?.();
    // 2. audio (lane AUDIO: once per id)
    rec.audio.burst = !!h.sfx?.blightBurst?.(z, cx, q.y + 1.1, cz);
    rec.audio.hiss = !!h.sfx?.blightHiss?.(z, cx, q.y + 0.6, cz, 0.15);
    // 3. blast to the player: falloff x visible fraction (cover / LOS / storey isolation through the world raycast)
    const P = h.player;
    if (P.alive) {
      const d = bodyDistance(cx, cy, cz, P.x, P.y, P.eye, P.z);
      rec.blast.distance = r3(d);
      if (d < B.blastRadius) {
        const vis = this.visibleFraction(cx, cy, cz);
        const dmg = blastDamage(d, vis);
        rec.blast.visible = r3(vis);
        rec.blast.damage = r3(dmg);
        if (dmg >= 0.5) {
          const location = blastHitLocation(this.rand(), !!P.crouched);
          const res = h.blastPlayer({amount: dmg, source: 'blast', location, attacker: 'blightbelly'}, cx, cz);
          rec.blast.applied = r3(res.applied);
          rec.blast.location = location;
          this.counts.blasts++;
        }
      }
    }
    // 4 + 5. other enemies: the blast (LOS) and the noise (walls / slabs muffle)
    const L = h.levels, multi = L.count > 1, bases = multi ? L.list.map(l => l.baseY) : null;
    for (const o of h.zombies) {
      const b = o.brain;
      if (o === z || !b.alive) continue;
      const d = Math.hypot(b.x - cx, b.y + 1.0 - cy, b.z - cz);
      if (d < B.blastRadius && this.clear(cx, cy, cz, b.x, b.y + 1.0, b.z)) {
        const amount = B.enemyMax * blastFalloff(d);
        if (amount > 0.5) {
          rec.enemies.hit++;
          this.counts.enemyHits++;
          const killed = b.damage(amount, cx, cz, q.y);
          if (killed) {
            rec.enemies.killed++;
            this.counts.enemyKills++;
            const dir = new THREE.Vector3(b.x - cx, 0.4, b.z - cz).normalize();
            h.blastKill?.(o, dir, new THREE.Vector3(b.x, b.y + 1.0, b.z));
          }
          continue;
        }
      }
      if (Math.hypot(b.x - cx, b.y - q.y, b.z - cz) > B.noise) continue;
      const los = multi ? L.lineOfSight({x: cx, y: cy, z: cz}, {x: b.x, y: b.y + 1.5, z: b.z}) : this.clear(cx, cy, cz, b.x, b.y + 1.5, b.z);
      const muffle = hearingMuffle(los, bases ? slabsBetween(bases, q.y, b.y) : 0);
      const before = b.state;
      b.hear(cx, cz, B.noise * muffle, q.y);
      if (b.state !== before) rec.enemies.heard++;
    }
    // 6. the temporary local toxic cloud through the existing gas system (any storey, the Subway too)
    rec.puff = h.gas.addPuff({id: `blightbelly-${rec.serial}`, level: q.level, x: cx, y: q.y, z: cz, radius: B.gasRadius, peak: B.gasPeak, durationS: B.gasDurationS});
    if (rec.puff) this.counts.puffs++;
    this.log.push(rec);
    if (this.log.length > 8) this.log.shift();
  }
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** Installs the Blightbelly death burst into a Game (one call in the Game constructor, after installGas). */
export function installBlightBurst(host: BlightHost, opts: {rand?: () => number} = {}): BlightBurstSystem {
  return new BlightBurstSystem(host, opts).install();
}
