// Task studio-flamethrower-fire-20261114-031614-01 (user: "Fire clings to actual surfaces/props, persists for limited active seconds, and
// produces convincing smoke ... Damage player, zombies and exposed world props (not only movable/cargo props); protect train structure and
// ALL fixed fixtures. Preserve contents/UIDs when props burn out. No unrequested acid-salvage windfalls or new smoke-survival mechanics.
// BB damage stays non-graphic"): THE FIRE — what the flamethrower's stream burns, the fire it leaves and what that fire burns.
//
// Pure rules (no rendering, no GL): the Game feeds it the stream (flame(): one call per fuel unit the weapon controller paid) and ticks
// it with the ACTIVE seconds (never paused / in menus), and gives it the world through FireEnv — the Node tests drive it the same way.
// fire/fireFx.ts draws what this holds (patches, burning props, burning bodies, the stream); fire/sound.ts is what it asks of the audio.
//
// THE STREAM. A cone along the aim ray from the eye: FLAME.radius0 wide at the lance, radius1 at FLAME.range, cut at the first wall /
// floor / ceiling / prop the ray meets. Every live enemy with a body volume inside the cone and a clear line from the eye takes
// FLAME.dps (eased to farMult at full range) for the paid seconds, and is ALIGHT: FLAME.burnDps for FLAME.burnSeconds after the last
// touch (touching fire again refreshes the time, never stacks). Fire never staggers (a burning body keeps coming).
//
// CLINGING FIRE. Where the stream lands — the floor, a wall, a ceiling, the face of a prop — it leaves a PATCH that burns there: fed by
// the seconds of stream it got (FIRE_PATCH.feed for full strength; a lick leaves a small short fire), alive FIRE_PATCH.life active
// seconds after it was last fed, dying down over its last FIRE_PATCH.fade. A stream that ends in open air drops part of its flame onto
// the floor below; burning drips fall under a running stream. The flame takes range / FLAME.speed to arrive (deposits are queued). At
// most FIRE_PATCH.max patches (the weakest gives way); deposits near one feed it. A patch on a prop follows the prop and falls to the
// floor as embers when the prop is gone.
//
// WHAT FIRE BURNS. Bodies standing in a patch or against a burning prop: FIRE_PATCH / PROP_FIRE dps (the strongest fire touching, never
// summed), in FLAME.burnEvery batches; enemies are alight afterwards, the PLAYER only burns while in the fire (takeDamage direct: not an
// attack — no armour, no injury roll; a pain cue at most every FLAME.painEvery). PROPS: the stream on a prop and a stream-fed patch
// touching one heat it (PROP_FIRE.catchSeconds, cooling at PROP_FIRE.cool); a hot one CATCHES and burns out through the melt engine
// (world/acidMelt.ts start(ref, 'fire'): its eligibility rules — the train's structure, fixed fixtures, building structure, objectives and
// trader stock never burn —, contents spilled with their uids, no salvage, the same record). A burnt-out prop leaves embers that set
// nothing else alight: fire spreads from where the player sprays it to what that fire touches, never on its own through a level.
//
// NOT here: fuel (weapons/weapons.ts updateStream pays it), noise (the Game), smoke as a hazard (there is none: smoke is drawn, never
// breathed — fire/fireFx.ts), saving (nothing of a fire is saved: a burn in progress completes through the melt engine's clear()).

import {FIRE_PATCH, FLAME, PROP_FIRE} from './flamethrowerSpec';
import {FIRE_VOICES, NO_FLAME_SOUND, type FireVoice, type FlameSound} from './sound';

export interface V3 { x: number; y: number; z: number }

/** An enemy body volume (ai/zombieActor.ts HitVolume): a sphere when `b` is null, else a capsule a-b. */
interface Volume { a: V3; b: V3 | null; r: number }

/** What fire burns (EnemyActor satisfies it). */
export interface FireEnemy {
  readonly brain: {
    readonly alive: boolean; x: number; y: number; z: number;
    readonly stats: {readonly radius: number; readonly height?: number};
    damage(amount: number, fromX: number, fromZ: number, fromY?: number, o?: {stagger?: boolean}): boolean;
  };
  readonly hitVolumes?: readonly Volume[];
  hitFlash: number;
  /** A body never shown hurt (BB): it takes the damage, nothing burns ON it (fire/fireFx.ts draws no flames on it). */
  readonly nonGraphic?: boolean;
}

export interface FireRef { readonly key: string; readonly x: number; readonly y: number; readonly z: number; readonly label: string }
export interface FireBurn {
  readonly ref: FireRef;
  readonly id: object;
  readonly box: {readonly min: V3; readonly max: V3};
  readonly base: V3;
  readonly age: number;
  readonly seconds: number;
}
/** The melt engine's seam (world/acidMelt.ts AcidMelt). */
export interface FireMelt {
  inDisc(x: number, y: number, z: number, r: number): FireRef[];
  atPoint(x: number, y: number, z: number, r?: number): FireRef | null;
  start(ref: FireRef, cause: 'fire'): boolean;
  alive(ref: FireRef): boolean;
  where(ref: FireRef, out: V3): boolean;
  burning(out?: FireBurn[]): FireBurn[];
  causeOf?(ref: FireRef): 'acid' | 'fire' | null;
  fire: {ignite?(b: FireBurn): void; out?(b: FireBurn): void} | null;
}

/** The aim ray's first world hit (combat/hitscan.ts WorldHit). */
export interface FireRayHit { t: number; kind: 'wall' | 'floor' | 'ceiling' | 'prop' | 'none'; nx: number; ny: number; nz: number }

/** What the rules ask of the presentation (fire/fireFx.ts; absent in the Node tests). */
export interface FireView {
  /** Soot left on a surface (bounded, fading; never saved). */
  scorch(x: number, y: number, z: number, nx: number, ny: number, nz: number, r: number): void;
  /** A puff of flame and sparks (a prop catching, a burn-out collapsing). */
  burst(x: number, y: number, z: number, size: number): void;
}

export interface FireEnv {
  /** The live enemies (Game.zombies). */
  enemies?(): readonly FireEnemy[];
  /** The player (Game.player): y = the feet. Fire burns go straight to takeDamage. */
  player?(): {x: number; y: number; z: number; alive: boolean; radius?: number; takeDamage(amount: number): void} | null;
  /** A body the fire killed: the game's kill bookkeeping + ragdoll (Game.blastKill). */
  kill?(z: FireEnemy, dir: V3, point: V3, strength: number): void;
  /** A body the fire hurt (its hurt cue; at most about once a second per body). */
  hurt?(z: FireEnemy): void;
  /** The player stepped into fire (a HUD hint, once per stay). */
  playerBurn?(): void;
  /** Fire hurt the player (HUD pain pulse + grunt; throttled here). */
  playerHurt?(amount: number): void;
  /** The world along a ray (walls, floors, ceilings, props): combat's bullet ray. */
  ray?(o: V3, d: V3, max: number): FireRayHit;
  /** 3D line of sight (walls / slabs). */
  los?(a: V3, b: V3): boolean;
  /** The floor under a point (null: none within reach below — a wall cell, a void). */
  floorAt?(x: number, z: number, y: number): number | null;
  melt?(): FireMelt | null;
  sound?: FlameSound | null;
  view?: FireView | null;
  /** [0, 1) (drips; default Math.random). */
  rand?(): number;
}

export type PatchFace = 'floor' | 'wall' | 'ceiling';

/** Fire clinging to a surface. */
export interface FirePatch {
  readonly id: number;
  x: number; y: number; z: number;
  /** The surface's outward normal. */
  nx: number; ny: number; nz: number;
  face: PatchFace;
  /** Active seconds it still burns. */
  fuel: number;
  /** Seconds of stream it has been fed (capped at FIRE_PATCH.feed: full strength). */
  fed: number;
  age: number;
  /** Stream-fed (heats what it touches); false: embers of a burnt-out prop, a fallen patch. */
  heats: boolean;
  /** The prop it clings to (it follows it), with its offset from that prop's base. */
  ref: FireRef | null;
  ox: number; oy: number; oz: number;
}

/** Strength 0..1 of a patch: how much it was fed x how far it has died down. */
export function patchStrength(p: {fuel: number; fed: number}): number {
  return Math.max(0, Math.min(1, p.fed / FIRE_PATCH.feed)) * Math.max(0, Math.min(1, p.fuel / FIRE_PATCH.fade));
}
/** Radius (m) of a patch at its strength. */
export function patchRadius(p: {fuel: number; fed: number}): number {
  return FIRE_PATCH.radius * (0.45 + 0.55 * patchStrength(p));
}
/** The stream's radius (m) at distance s along it. */
export function streamRadius(s: number): number {
  return FLAME.radius0 + (FLAME.radius1 - FLAME.radius0) * Math.max(0, Math.min(1, s / FLAME.range));
}
/** The stream's damage factor at distance s (1 at the lance, FLAME.farMult at full range). */
export function streamFalloff(s: number): number {
  return 1 - (1 - FLAME.farMult) * Math.max(0, Math.min(1, s / FLAME.range));
}

interface Deposit { at: number; x: number; y: number; z: number; nx: number; ny: number; nz: number; seconds: number; heats: boolean; prop: boolean }
interface Alight { left: number; acc: number }
interface Heat { ref: FireRef; s: number; at: number }

/** The stream as last fed (fire/fireFx.ts draws it; `reach`: where the flame stops along the aim). */
export interface StreamState {
  on: boolean;
  ox: number; oy: number; oz: number;
  dx: number; dy: number; dz: number;
  reach: number;
  /** What stops it at `reach` ('none': open air at full range) and that surface's normal. */
  kind: FireRayHit['kind'];
  nx: number; ny: number; nz: number;
}

const MAX_DEPOSITS = 24;
const PROP_PASS = 0.2;
const TMP: V3 = {x: 0, y: 0, z: 0};
const LOS_A: V3 = {x: 0, y: 0, z: 0}, LOS_B: V3 = {x: 0, y: 0, z: 0};

export class FireSystem {
  env: FireEnv = {};
  readonly patches: FirePatch[] = [];
  /** Enemies alight now (fire/fireFx.ts: flames on them — never on a nonGraphic body). */
  readonly alight = new Map<FireEnemy, Alight>();
  /** Props burning out now (refreshed every tick from the melt engine). */
  readonly burns: FireBurn[] = [];
  readonly stream: StreamState = {on: false, ox: 0, oy: 0, oz: 0, dx: 0, dy: 0, dz: 1, reach: 0, kind: 'none', nx: 0, ny: 1, nz: 0};
  private readonly deposits: Deposit[] = [];
  private readonly heat = new Map<string, Heat>();
  /** The props flame reached since the last prop pass (key -> ref): each heats once in that pass. */
  private readonly touched = new Map<string, FireRef>();
  /** Fire damage owed to a body since the last batch (the strongest fire touching it, over the frames). */
  private readonly touch = new Map<FireEnemy, number>();
  private readonly hurtAt = new WeakMap<object, number>();
  private playerOwed = 0;
  private playerOut = 1e9;
  private painAt = -1e9;
  private batchT = 0;
  private propT = 0;
  private dripT = 0;
  private clock = 0;
  private nextId = 1;
  private hooked: FireMelt | null = null;
  private readonly voices: FireVoice[] = [];
  /** The audio was last given a stream / fires (it gets one more, empty, frame when everything is out). */
  private voiced = false;
  /** The loudest burning places as of the last tick (fires within 3 m are one; at most FIRE_VOICES): the audio's beds, the smoke plumes. */
  get spots(): readonly FireVoice[] { return this.voices; }
  /** QA / tests. */
  readonly counts = {flameS: 0, streamHits: 0, kills: 0, deposits: 0, patches: 0, merged: 0, evicted: 0, burntOut: 0, fell: 0, drips: 0, propsCaught: 0, propsOut: 0, playerS: 0, playerDamage: 0, enemyDamage: 0, cleared: 0};

  private get sound(): FlameSound { return this.env.sound ?? NO_FLAME_SOUND; }
  private rand(): number { return (this.env.rand ?? Math.random)(); }

  /** Anything burning or in flight (the Game may skip the frame work otherwise). */
  get active(): boolean {
    return this.stream.on || this.patches.length > 0 || this.alight.size > 0 || this.deposits.length > 0 || this.burns.length > 0 || this.heat.size > 0 || this.touch.size > 0;
  }

  // ---------------------------------------------------------------------------------------------------------------------
  // The stream

  /** The stream lit (the weapon controller's streamStart). */
  streamStart(muzzle: V3): void {
    this.stream.on = true;
    this.dripT = FIRE_PATCH.dripEvery * (0.5 + 0.5 * this.rand());
    this.sound.streamOn(muzzle.x, muzzle.y, muzzle.z);
  }

  /** The stream went out (`dry`: the tank ran empty under the trigger). */
  streamEnd(dry: boolean): void {
    if (!this.stream.on) return;
    this.stream.on = false;
    this.sound.streamOff(dry);
  }

  /**
   * `seconds` of PAID flame along the aim ray (eye `o`, unit direction `d`): the cone's damage now, the fire it leaves when the flame
   * arrives. One call per fuel unit burned (WeaponController 'flame' ticks x FLAME_FUEL.unitSeconds) — never called without the fuel.
   */
  flame(o: V3, d: V3, seconds: number): void {
    if (!(seconds > 0)) return;
    const hit: FireRayHit = this.env.ray?.(o, d, FLAME.range) ?? {t: FLAME.range, kind: 'none', nx: 0, ny: 1, nz: 0};
    const open = hit.kind === 'none' || !(hit.t < FLAME.range);
    const reach = open ? FLAME.range : Math.max(0, hit.t);
    const s = this.stream;
    s.ox = o.x; s.oy = o.y; s.oz = o.z; s.dx = d.x; s.dy = d.y; s.dz = d.z;
    s.reach = reach; s.kind = open ? 'none' : hit.kind; s.nx = hit.nx; s.ny = hit.ny; s.nz = hit.nz;
    this.counts.flameS += seconds;
    // 1. every body in the cone
    for (const z of this.env.enemies?.() ?? []) {
      if (!z.brain.alive) continue;
      const at = this.inStream(z, o, d, reach);
      if (at === null) continue;
      this.counts.streamHits++;
      this.ignite(z);
      this.hurtEnemy(z, FLAME.dps * seconds * streamFalloff(at), o.x, o.z, o.y);
    }
    // 2. the fire it leaves, when the flame gets there
    const fly = reach / FLAME.speed;
    if (!open) {
      const back = Math.max(0, reach - 0.04);
      this.queue({at: this.clock + fly, x: o.x + d.x * back, y: o.y + d.y * back, z: o.z + d.z * back, nx: hit.nx, ny: hit.ny, nz: hit.nz, seconds, heats: true, prop: hit.kind === 'prop'});
    } else {
      const ex = o.x + d.x * reach, ey = o.y + d.y * reach, ez = o.z + d.z * reach;
      const f = this.env.floorAt?.(ex, ez, ey) ?? null;
      if (f !== null && f <= ey + 0.05 && ey - f < 6) this.queue({at: this.clock + fly + FIRE_PATCH.fall, x: ex, y: f, z: ez, nx: 0, ny: 1, nz: 0, seconds: seconds * FIRE_PATCH.airFeed, heats: true, prop: false});
    }
    // 3. drips under the running stream
    this.dripT -= seconds;
    if (this.dripT <= 0) {
      this.dripT += FIRE_PATCH.dripEvery * (0.7 + 0.6 * this.rand());
      const at = reach * (0.3 + 0.5 * this.rand());
      if (at > 1.2) {
        const x = o.x + d.x * at, y = o.y + d.y * at, z = o.z + d.z * at;
        const f = this.env.floorAt?.(x, z, y) ?? null;
        if (f !== null && f <= y + 0.05 && y - f < 4) { this.counts.drips++; this.queue({at: this.clock + at / FLAME.speed + FIRE_PATCH.fall, x, y: f, z, nx: 0, ny: 1, nz: 0, seconds: FIRE_PATCH.dripFeed, heats: true, prop: false}); }
      }
    }
  }

  /**
   * Where along the stream (m from the eye) a body is inside the cone with a clear line from the eye; null: not in it. Its volumes (a
   * capsule's ends and middle, a sphere's centre) — else, a body without volumes, three points up its height.
   */
  private inStream(z: FireEnemy, o: V3, d: V3, reach: number): number | null {
    const best = {s: -1, x: 0, y: 0, z: 0, slack: Infinity};
    const probe = (x: number, y: number, zz: number, r: number) => {
      const along = (x - o.x) * d.x + (y - o.y) * d.y + (zz - o.z) * d.z;
      if (along < -r || along > reach + r) return;
      const s = Math.max(0, Math.min(reach, along));
      const px = o.x + d.x * s - x, py = o.y + d.y * s - y, pz = o.z + d.z * s - zz;
      const gap = Math.sqrt(px * px + py * py + pz * pz) - r - streamRadius(s);
      if (gap <= 0 && gap < best.slack) { best.slack = gap; best.s = s; best.x = x; best.y = y; best.z = zz; }
    };
    const vols = z.hitVolumes;
    if (vols?.length) {
      for (const v of vols) {
        probe(v.a.x, v.a.y, v.a.z, v.r);
        if (v.b) { probe(v.b.x, v.b.y, v.b.z, v.r); probe((v.a.x + v.b.x) / 2, (v.a.y + v.b.y) / 2, (v.a.z + v.b.z) / 2, v.r); }
      }
    } else {
      const b = z.brain, r = b.stats.radius, h = b.stats.height ?? 1.7;
      for (const f of [0.2, 0.55, 0.9]) probe(b.x, b.y + h * f, b.z, r);
    }
    if (best.s < 0) return null;
    if (this.env.los && !this.env.los(o, best)) return null;
    return best.s;
  }

  private queue(dep: Deposit): void {
    if (this.deposits.length >= MAX_DEPOSITS) this.land(this.deposits.shift()!); // (never dropped: the oldest lands a moment early)
    this.deposits.push(dep);
  }

  // ---------------------------------------------------------------------------------------------------------------------
  // Clinging fire

  private land(dep: Deposit): void {
    this.counts.deposits++;
    const melt = this.env.melt?.() ?? null;
    // the prop under the flame heats (the engine decides what may burn: null for structure, the train, fixtures, objectives, stock)
    const ref = dep.prop && melt ? melt.atPoint(dep.x, dep.y, dep.z, 0.12) : null;
    if (ref && dep.heats) this.touched.set(ref.key, ref); // (it heats in the next prop pass: once, however many flames reach it)
    this.feed(dep.x, dep.y, dep.z, dep.nx, dep.ny, dep.nz, dep.seconds, dep.heats, ref, melt);
  }

  /** Feed the patch at a surface point `seconds` of stream (a new one, or the one already burning within FIRE_PATCH.merge on that face). */
  private feed(x: number, y: number, z: number, nx: number, ny: number, nz: number, seconds: number, heats: boolean, ref: FireRef | null, melt: FireMelt | null): FirePatch {
    const face: PatchFace = ny > 0.6 ? 'floor' : ny < -0.6 ? 'ceiling' : 'wall';
    let p: FirePatch | null = null, bd: number = FIRE_PATCH.merge;
    for (const q of this.patches) {
      if (q.face !== face || q.ref !== ref || q.nx * nx + q.ny * ny + q.nz * nz < 0.5) continue;
      const dist = Math.hypot(q.x - x, q.y - y, q.z - z);
      if (dist <= bd) { bd = dist; p = q; }
    }
    if (p) this.counts.merged++;
    else {
      if (this.patches.length >= FIRE_PATCH.max) {
        let w = 0;
        for (let i = 1; i < this.patches.length; i++) if (this.patches[i].fuel < this.patches[w].fuel) w = i;
        this.patches.splice(w, 1);
        this.counts.evicted++;
      }
      p = {id: this.nextId++, x, y, z, nx, ny, nz, face, fuel: 0, fed: 0, age: 0, heats, ref, ox: 0, oy: 0, oz: 0};
      if (ref && melt && melt.where(ref, TMP)) { p.ox = x - TMP.x; p.oy = y - TMP.y; p.oz = z - TMP.z; }
      else p.ref = null;
      this.patches.push(p);
      this.counts.patches++;
      this.env.view?.scorch(x, y, z, nx, ny, nz, FIRE_PATCH.radius * 0.9);
    }
    p.fed = Math.min(FIRE_PATCH.feed, p.fed + seconds);
    p.fuel = Math.min(FIRE_PATCH.life, p.fuel + seconds * (FIRE_PATCH.life / FIRE_PATCH.feed));
    p.heats ||= heats;
    return p;
  }

  private heatUp(ref: FireRef, seconds: number, melt: FireMelt): void {
    if (melt.causeOf?.(ref)) return; // (already burning / dissolving)
    let h = this.heat.get(ref.key);
    if (!h || h.ref !== ref) this.heat.set(ref.key, (h = {ref, s: 0, at: this.clock}));
    h.s += seconds;
    h.at = this.clock;
    if (h.s < PROP_FIRE.catchSeconds) return;
    this.heat.delete(ref.key);
    if (melt.start(ref, 'fire')) this.counts.propsCaught++;
  }

  // ---------------------------------------------------------------------------------------------------------------------
  // Damage

  /** The body is alight for FLAME.burnSeconds from now (refreshed, never stacked). */
  private ignite(z: FireEnemy): void {
    const a = this.alight.get(z);
    if (a) a.left = FLAME.burnSeconds;
    else this.alight.set(z, {left: FLAME.burnSeconds, acc: 0});
  }

  /** Fire damage to an enemy from (fx, fy, fz) (its brain's `damage`: aware, no stagger); a kill crumples it. */
  private hurtEnemy(z: FireEnemy, amount: number, fx: number, fz: number, fy: number): void {
    if (!(amount > 0)) return;
    const b = z.brain;
    if (!b.alive) return;
    this.counts.enemyDamage += amount;
    const killed = b.damage(amount, fx, fz, fy, {stagger: false});
    z.hitFlash = Math.max(z.hitFlash, 0.6);
    if (killed) {
      this.counts.kills++;
      this.alight.delete(z);
      this.touch.delete(z);
      let dx = b.x - fx, dz = b.z - fz;
      const l = Math.hypot(dx, dz);
      if (l < 0.4) { dx = 0; dz = 0; } else { dx /= l; dz /= l; }
      const dl = Math.hypot(dx, 0.5, dz);
      this.env.kill?.(z, {x: dx / dl, y: 0.5 / dl, z: dz / dl}, {x: b.x, y: b.y + 0.9, z: b.z}, FLAME.killImpulse);
    } else if (this.clock - (this.hurtAt.get(z) ?? -1e9) >= 1.1) {
      this.hurtAt.set(z, this.clock);
      this.env.hurt?.(z);
    }
  }

  /** The strongest fire (dps) touching a body at its feet (x, y, z) of radius r and height h. */
  private fireAt(x: number, y: number, z: number, r: number, h: number, patchDps: number, propDps: number): number {
    let dps = 0;
    for (const p of this.patches) {
      const k = patchStrength(p);
      if (k <= 0.02) continue;
      const pr = patchRadius(p) + r;
      const dx = p.x - x, dz = p.z - z;
      if (dx * dx + dz * dz > pr * pr) continue;
      // (a floor fire burns up to FIRE_PATCH.height over it; fire on a wall / a prop's face around its point, licking upward; a ceiling's hangs a little)
      const lo = p.face === 'floor' ? p.y - 0.25 : p.face === 'wall' ? p.y - patchRadius(p) : p.y - 0.5;
      const hi = p.face === 'floor' ? p.y + FIRE_PATCH.height : p.face === 'wall' ? p.y + patchRadius(p) + 0.5 : p.y + 0.1;
      if (y + h < lo || y > hi) continue;
      // never through what it clings to or stands beside: fire on a wall or a prop's face burns on its open side only, and every patch
      // needs a clear line from just off its surface to the body (a floor fire at the foot of a partition leaves the next room alone)
      if (p.face === 'wall' && (x - p.x) * p.nx + (z - p.z) * p.nz < -FIRE_PATCH.behind) continue;
      if (this.env.los) {
        LOS_A.x = p.x + p.nx * FIRE_PATCH.sightLift; LOS_A.y = p.y + p.ny * FIRE_PATCH.sightLift; LOS_A.z = p.z + p.nz * FIRE_PATCH.sightLift;
        LOS_B.x = x; LOS_B.y = y + h * 0.5; LOS_B.z = z;
        if (!this.env.los(LOS_A, LOS_B)) continue;
      }
      dps = Math.max(dps, patchDps * k);
    }
    for (const b of this.burns) {
      const dx = Math.max(b.box.min.x - x, 0, x - b.box.max.x), dz = Math.max(b.box.min.z - z, 0, z - b.box.max.z);
      const reach = PROP_FIRE.reach + r;
      if (dx * dx + dz * dz > reach * reach || y + h < b.box.min.y - 0.1 || y > b.box.max.y + 0.8) continue;
      dps = Math.max(dps, propDps);
    }
    return dps;
  }

  // ---------------------------------------------------------------------------------------------------------------------

  /** One frame of ACTIVE time: flames arrive, fires burn down, bodies and props burn. */
  tick(dt: number): void {
    const step = Math.max(0, Math.min(0.25, Number.isFinite(dt) ? dt : 0));
    const melt = this.env.melt?.() ?? null;
    this.hook(melt);
    if (melt) melt.burning(this.burns); else this.burns.length = 0;
    if (!this.active) { if (this.voiced) this.voice(step); return; } // (one last frame for the audio: an empty list fades its fire beds)
    this.clock += step;
    // flames in flight land
    while (this.deposits.length && this.deposits[0].at <= this.clock) this.land(this.deposits.shift()!);
    // patches burn down; one on a prop follows it, and falls as embers when the prop is gone
    for (let i = this.patches.length - 1; i >= 0; i--) {
      const p = this.patches[i];
      p.age += step;
      p.fuel -= step;
      if (p.ref && melt) {
        if (melt.where(p.ref, TMP)) { p.x = TMP.x + p.ox; p.y = TMP.y + p.oy; p.z = TMP.z + p.oz; }
        else {
          const f = this.env.floorAt?.(p.x, p.z, p.y) ?? null;
          if (f === null) p.fuel = 0;
          else { p.y = f; p.nx = 0; p.ny = 1; p.nz = 0; p.face = 'floor'; p.ref = null; p.heats = false; p.fuel = Math.min(p.fuel, FIRE_PATCH.emberSeconds); this.counts.fell++; }
        }
      }
      if (p.fuel <= 0) { this.patches.splice(i, 1); this.counts.burntOut++; }
    }
    // bodies in fire: what each is owed this frame (the strongest fire touching it)
    if (this.patches.length || this.burns.length) {
      for (const z of this.env.enemies?.() ?? []) {
        const b = z.brain;
        if (!b.alive) continue;
        const dps = this.fireAt(b.x, b.y, b.z, b.stats.radius, b.stats.height ?? 1.7, FIRE_PATCH.enemyDps, PROP_FIRE.enemyDps);
        if (dps > 0) { this.touch.set(z, (this.touch.get(z) ?? 0) + dps * step); this.ignite(z); }
      }
      const pl = this.env.player?.();
      const dps = pl?.alive ? this.fireAt(pl.x, pl.y, pl.z, pl.radius ?? 0.3, 1.7, FIRE_PATCH.playerDps, PROP_FIRE.playerDps) : 0;
      if (dps > 0) {
        this.playerOwed += dps * step;
        this.counts.playerS += step;
        if (this.playerOut > 2.5) this.env.playerBurn?.();
        this.playerOut = 0;
      } else this.playerOut += step;
    } else this.playerOut += step;
    for (const a of this.alight.values()) { const live = Math.max(0, Math.min(step, a.left)); a.acc += FLAME.burnDps * live; a.left -= step; } // (never a negative last step: the afterburn pays its whole FLAME.burnSeconds)
    this.batchT += step;
    if (this.batchT >= FLAME.burnEvery - 1e-9) this.batch();
    // props: stream-fed patches heat what they touch; heat fades where nothing feeds it
    this.propT += step;
    if (this.propT >= PROP_PASS - 1e-9) {
      if (melt) {
        // every prop in flame since the last pass — under the stream, or touched by a stream-fed patch — gains the pass's seconds ONCE:
        // a prop's heat is its time in flame, never a sum over the flames on it
        const hot = this.touched;
        for (const p of this.patches) {
          if (!p.heats || patchStrength(p) < 0.25) continue;
          // (the prop it clings to; what stands in a floor fire; else what a wall / ceiling fire's point touches)
          if (p.ref) hot.set(p.ref.key, p.ref);
          if (p.face === 'floor') { for (const ref of melt.inDisc(p.x, p.y, p.z, patchRadius(p))) hot.set(ref.key, ref); }
          else if (!p.ref) { const ref = melt.atPoint(p.x, p.y, p.z, 0.2); if (ref) hot.set(ref.key, ref); }
        }
        for (const ref of hot.values()) this.heatUp(ref, this.propT, melt);
      }
      this.touched.clear();
      for (const [k, h] of this.heat) {
        if (this.clock - h.at <= PROP_PASS + 0.1) continue;
        h.s -= PROP_FIRE.cool * this.propT;
        if (h.s <= 0) this.heat.delete(k);
      }
      this.propT = 0;
    }
    this.voice(step);
  }

  /** One damage batch: every burning / fire-touched body takes what it is owed since the last one; the player too. */
  private batch(): void {
    this.batchT = 0;
    for (const [z, owed] of this.touch) {
      const b = z.brain;
      this.hurtEnemy(z, owed, b.x, b.z, b.y); // (from its own feet: aware, not drawn to the fire's middle)
    }
    this.touch.clear();
    for (const [z, a] of this.alight) {
      const b = z.brain;
      if (!b.alive) { this.alight.delete(z); continue; }
      const owed = a.acc;
      a.acc = 0;
      if (a.left <= 0) this.alight.delete(z);
      this.hurtEnemy(z, owed, b.x, b.z, b.y);
    }
    const pl = this.env.player?.();
    if (this.playerOwed > 0 && pl?.alive) {
      const amount = this.playerOwed;
      pl.takeDamage(amount);
      this.counts.playerDamage += amount;
      if (this.clock - this.painAt >= FLAME.painEvery - 1e-9) { this.painAt = this.clock; this.env.playerHurt?.(amount); }
    }
    this.playerOwed = 0;
  }

  /** The melt engine's burn cues are ours (a prop catching: the whoomp + a burst; burnt out: the crumble, embers, soot). */
  private hook(melt: FireMelt | null): void {
    if (melt === this.hooked) return;
    this.hooked = melt;
    if (!melt) return;
    melt.fire = {
      ignite: b => {
        const y = (b.box.min.y + b.box.max.y) / 2;
        this.sound.ignite(b.base.x, y, b.base.z);
        this.env.view?.burst(b.base.x, y, b.base.z, Math.max(0.4, Math.min(1.4, (b.box.max.x - b.box.min.x + b.box.max.z - b.box.min.z) / 2)));
      },
      out: b => {
        this.counts.propsOut++;
        this.sound.burnOut(b.base.x, b.base.y + 0.2, b.base.z);
        const r = Math.max(0.35, Math.min(1.2, (b.box.max.x - b.box.min.x + b.box.max.z - b.box.min.z) / 4 + 0.15));
        const f = this.env.floorAt?.(b.base.x, b.base.z, b.base.y + 0.1) ?? null;
        this.env.view?.burst(b.base.x, b.base.y + 0.25, b.base.z, r);
        if (f === null || b.base.y - f > 0.6) return; // (it hung on a wall / stood on a counter: nothing to lie in)
        this.env.view?.scorch(b.base.x, f, b.base.z, 0, 1, 0, r * 1.5);
        const p = this.feed(b.base.x, f, b.base.z, 0, 1, 0, FIRE_PATCH.feed * 0.6, false, null, null);
        if (p.age === 0 && !p.heats) p.fuel = Math.min(p.fuel, FIRE_PATCH.emberSeconds); // (a fire already burning there keeps its own time)
      },
    };
  }

  /** The loudest burning places for the audio: fires within 3 m of one another are one voice. */
  private voice(dt: number): void {
    const out = this.voices;
    out.length = 0;
    const pl = this.env.player?.() ?? null;
    const add = (x: number, y: number, z: number, level: number) => {
      for (const v of out) if (Math.hypot(v.x - x, v.z - z) < 3 && Math.abs(v.y - y) < 2.5) { if (level > v.level) { v.x = x; v.y = y; v.z = z; } v.level = Math.min(1, v.level + level * 0.5); return; }
      out.push({x, y, z, level});
    };
    for (const b of this.burns) add(b.base.x, (b.box.min.y + b.box.max.y) / 2, b.base.z, 1);
    for (const p of this.patches) { const k = patchStrength(p); if (k > 0.05) add(p.x, p.y + 0.3, p.z, k); }
    if (out.length > 1 && pl) {
      const score = (v: FireVoice) => v.level / (1 + 0.04 * ((v.x - pl.x) ** 2 + (v.y - pl.y) ** 2 + (v.z - pl.z) ** 2));
      out.sort((a, b) => score(b) - score(a));
    }
    if (out.length > FIRE_VOICES) out.length = FIRE_VOICES;
    const s = this.stream;
    this.voiced = s.on || out.length > 0;
    this.sound.frame(dt, s.on ? {x: s.ox + s.dx * 0.6, y: s.oy + s.dy * 0.6 - 0.2, z: s.oz + s.dz * 0.6} : null, out);
  }

  /** Everything out at once (section teardown, Retry, travel, a new game): nothing of a fire outlives its world. */
  clear(): void {
    const was = this.active;
    this.stream.on = false;
    this.patches.length = 0;
    this.alight.clear();
    this.touch.clear();
    this.deposits.length = 0;
    this.heat.clear();
    this.touched.clear();
    this.burns.length = 0;
    this.playerOwed = 0;
    this.playerOut = 1e9;
    this.batchT = 0;
    this.propT = 0;
    this.voiced = false;
    this.sound.silence();
    if (was) this.counts.cleared++;
  }

  /** QA: a compact state report. */
  qa(): unknown {
    return {
      stream: this.stream.on ? {reach: Math.round(this.stream.reach * 100) / 100, kind: this.stream.kind} : null,
      patches: this.patches.map(p => ({id: p.id, face: p.face, at: [p.x, p.y, p.z].map(v => Math.round(v * 100) / 100), k: Math.round(patchStrength(p) * 100) / 100, fuel: Math.round(p.fuel * 100) / 100, on: p.ref?.key ?? null})),
      alight: this.alight.size, burning: this.burns.map(b => b.ref.key), heating: [...this.heat.values()].map(h => ({key: h.ref.key, s: Math.round(h.s * 100) / 100})),
      counts: {...this.counts},
    };
  }
}
