// Task studio-market-rework-20261108-074144-01 (lane COMBAT): THE MARKET FIGHTS BACK — Game.marketHostility (market/hostility.ts). User:
// "it should be possible to attack the survivors. If you shoot one, they all become hostile, about 70% will just run away, and the
// remaining ones will pull out random weapons and start firing back! Survivors have about the same health as a zombie, so this is
// extremely risky for the player." / theft: "the shop keeper will attack them, building on the hostility system".
//
//  - ATTACKABLE: every market person (market/marketPeople.ts, its own list — never game.zombies) has bone-attached hit volumes
//    (market/combat/body.ts) that the player's bullets / pellets (Game.fire: rayHit + pellet per ray, endShot once per trigger pull) and
//    knife (Game.meleeContact: meleeTargets + meleeHit) test exactly like an enemy's — the player's damage, falloff and head / limb
//    multipliers are unchanged; an ORDINARY zombie's 100 hp (roles.ts MARKET_HOSTILITY.hp). Blood / the hit confirm / a flinch, and on a
//    kill the physics ragdoll (fallback: the Death clip); the body stays, never searchable (no loot), never a kill / clear count.
//  - HOSTILITY, once and for good, per market station: the first successful attack on anyone (or a theft, provoke) turns the settlement
//    hostile — half draw their seeded real gun and fight, the rest flee (roles.ts; the robbed trader always fights). No reset / bribe /
//    reputation. canTrade(stall) is false from then on (and for a dead trader).
//  - FLEEING (task studio-market-bar-20261108-225231-01, lane PEOPLE; user: "Fleeing survivors must hide in homes, not disappear/despawn"):
//    a panicked flinch and a scream, then a run along path-finder routes (no ladders, never through the parked train's keep-out, never
//    past the player) through the real doors / stairs to the person's REFUGE (market/people/refuges.ts: its home, else the bunk room /
//    store rooms / another private room), screaming now and then; there it cowers in its hide slot out of the doorway's line, ALIVE and
//    PRESENT (still a target): the player close in sight -> a flinch / scream, never a vanishing act. A blocked way home (the player in it)
//    -> cower where it is and try again shortly (another refuge with room when its own cannot be reached). Nobody ever leaves the market.
//  - FIGHTING: the gun comes out (the player's own model in the right hand), the shooter turns to the player and fires the gun's real
//    cadence from the muzzle along the world ray (walls / slabs / props / the train stop it; nobody else is ever hit), with spread, a lagged
//    and jittered aim point, the magazine and reloads (into nearby cover when there is some), the player's own gun sounds (positional) and
//    a muzzle flash / smoke / tracer / impact. Out of sight or range it moves (paths) until it has a line again. Out of rounds it flees.
//    Every armed hostile animates every frame (no animation LOD). It grunts (Game.marketAudio) as it draws, when hit and now and then.
//  - DETECTION: the player's detectability (Game.beerEffects.perceptionMult: the Night Shift Porter's 0.75) scales the sight distance, ONCE.
//  - ITS HITS ON THE PLAYER go through Game.applyPlayerHit as an ENEMY hit (enemy: true): the global enemy x2 once, the worn armour pool,
//    the injury save and armour wear as for a zombie's claw (Game.gunshotPlayer: + the HUD direction, shake, hurt cue).
//  - PERSISTENCE (record.ts, lane store 'market.hostility' of the station, version 2): written at the provocation and on every change
//    (deaths, flight, rounds) + once a second while hostile; a station built again reads it: the dead lie where they fell, the rest resume
//    (fighters hunt; hiders cower in their refuge; a fleer the player left behind on a route it had found reached its refuge meanwhile).
//    A version-1 record's 'fled' people come back as hiders in a refuge (hp / gun / rounds / role kept). Retry / Continue follow the
//    section memory's own rules.
//  - The calm market is untouched until provoked: no zombies, no gas, the player is never pushed (people step away / around).
import * as THREE from 'three';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import type {MarketLayout, MarketStallId} from '../../gen/market/marketTypes';
import type {Levels} from '../../gen/levels';
import type {PropPlacement} from '../../gen/props';
import type {Waypoint} from '../../gen/grid';
import type {PropIndex} from '../../core/physics';
import {moveCircle} from '../../core/physics';
import {hashString, mulberry32} from '../../core/rng';
import {volumesBoxEntry, type RayPart, type RayVolume} from '../../combat/enemyRay';
import {rayCapsule, raySphere, type Vec3, type WorldHit} from '../../combat/hitscan';
import {raycastShot} from '../../physics/merchOnHost';
import {killImpulseStrength} from '../../physics/world';
import type {KillImpulse, RagdollTarget} from '../../physics/ragdoll';
import {DAMAGE_MATERIALS, propDamageSpec} from '../../damage/materials';
import type {PlayerHit, ResolvedHit} from '../../player/hits';
import {WeaponController, type WeaponDef} from '../../weapons/weapons';
import type {SectionKey} from '../../levels/types';
import type {MarketHostilityApi, MarketProvocation} from '../hostility';
import type {HumanActor} from '../humanActor';
import {MARKET_HUMAN_KEY} from '../humanLooks';
import {MARKET_PEOPLE, type MarketPeople} from '../marketPeople';
import type {Area} from '../../gen/stationTypes';
import {RefugeBook, marketRefuges} from '../people/refuges';
import {HumanCombatBody} from './body';
import {COMBAT_CLIP, COMBAT_TERMINAL, combatClips, combatOneShots, rigFromSkeleton, type CombatClipSet} from './combatClips';
import {NPC_GUNS, NpcGun, coneDir, npcRoundDamage, playerBulletHit, playerChest, type PlayerBody} from './npcGun';
import {MARKET_HOSTILITY_LANE, MARKET_HOSTILITY_VERSION, marketHostilityProblem, traderId, type MarketGunId, type MarketHostilityJSON, type MarketPersonRecord, type MarketPosture, type MarketRole} from './record';
import {MARKET_HOSTILITY, ammoFor, assignRoles, gunFor} from './roles';

/** Tuning. */
export const MARKET_COMBAT = {
  /** Seconds between a person's sight checks (staggered). */
  perceive: 0.22,
  /** Panic flinch before running (s), flight speed (m/s, x stature), an armed hostile's moving speed. */
  panic: [0.12, 0.6] as const, fleeSpeed: [3.0, 3.6] as const, moveSpeed: 2.5,
  /** Turn rates (rad/s): fleeing / an armed hostile. */
  turnFlee: 6, turnFight: 6.5,
  /** (lane PEOPLE) A hider flinches / screams when the player is this close and in sight (m), at most every `flinch` s. */
  reflee: 6.5, flinch: [2.5, 4.5] as const,
  /** A flight route never passes within `passGap` of the player (m); a stranded fleer tries again after `retry` s. */
  passGap: 2.2, retry: [1.2, 2.6] as const,
  /** Sight distance (m) before the player's detectability (Game.beerEffects.perceptionMult). */
  sight: 60,
  /** (lane PEOPLE) Voices (Game.marketAudio): a running fleer screams every `scream` s, a fighter in a firefight grunts every `grunt` s. */
  scream: [2.2, 4.5] as const, grunt: [3.5, 8] as const,
  /** An armed hostile: seconds without a line before it moves; re-plan every `repath` s; stands once within range x `standoff` with a line. */
  lostS: 0.6, repath: 1.4, standoff: 0.8,
  /** Cover for a reload: ring radii (m) x 8 directions round the shooter. */
  coverRings: [1.4, 2.6, 3.8] as const,
  /** People this far from the player (m) do not think (bounded cost; they keep their posture). */
  far: 70,
  /** Stuck: less than `stuckM` progress in `stuckS` seconds re-plans. */
  stuckM: 0.25, stuckS: 2.2,
  /** Record the live state at least this often while hostile (s). */
  persistEvery: 1,
  /** The player's shot shoves a hit person this far per pellet share (m), like a zombie's knockback. */
  knock: 0.12,
} as const;

export const MARKET_COMBAT_TEXT = {
  hostile: 'The market turns on you!',
  theft: 'Thief! The trader draws a gun',
} as const;

type Mode = 'calm' | 'panic' | 'flee' | 'hide' | 'draw' | 'engage' | 'move' | 'cover' | 'reload' | 'dead';

/** One market person in combat terms (its HumanActor stays a plain animated human). */
export interface MarketCombatant {
  readonly id: string;
  readonly actor: HumanActor;
  readonly body: HumanCombatBody;
  readonly stall?: MarketStallId;
  hp: number;
  state: 'alive' | 'dead';
  role: MarketRole;
  readonly gun: MarketGunId;
  readonly npc: NpcGun;
  readonly clips: CombatClipSet;
  mode: Mode;
  /** Timer of the current mode (s). */
  t: number;
  /** A one-off delay (draw reaction / panic). */
  delay: number;
  /** (lane PEOPLE) Hiding in its refuge slot (arrived): false while running there or stranded on the way. */
  hidden: boolean;
  /** (lane PEOPLE) A route to its refuge slot was found (a player who leaves finds it home on return). */
  routed: boolean;
  /** (lane PEOPLE) A stranded fleer's next try (s, against `t`), the hider's flinch cooldown, the next scream / grunt (s). */
  retry: number; flinchT: number; voiceT: number;
  /** (lane PEOPLE) Its own place when the station was built (its refuge is picked near it). */
  readonly home: Vec3;
  path: Waypoint[] | null; wp: number;
  goal: Vec3 | null;
  speed: number;
  /** Perception. */
  seeT: number; sees: boolean; clear: boolean; lostT: number; lastSeen: Vec3 | null;
  /** Aiming: time on target, the reaction it needs, the burst's aim point. */
  aimT: number; reaction: number; aimPt: Vec3 | null;
  repathT: number;
  checkT: number; checkX: number; checkZ: number;
  readonly rand: () => number;
  /** Moved this frame (m/s), for the run's playback rate. */
  moved: number;
  /** Died by a ragdoll (its pelvis position follows the body). */
  ragdolled: boolean;
}

/** What the combat needs from Game (structural: Node tests drive it with real levels / people and stand-ins for fx / audio / HUD). */
export interface MarketCombatHost {
  scene: THREE.Scene;
  player: {x: number; y: number; z: number; eye: number; yaw: number; radius: number; alive: boolean; vx?: number; vz?: number};
  levels: Levels;
  propIndex: PropIndex | null;
  layout: {props: PropPlacement[]; trench: {floorY: number}};
  run: {current: SectionKey; laneStore<T = unknown>(lane: string, key?: SectionKey): T | undefined; setLaneStore(lane: string, data: unknown, key?: SectionKey): void};
  propModels: {get(key: string): GLTF | undefined};
  /** The player's gun models (the held / pickup models: Game.assets.models). */
  assets?: {models: Partial<Record<string, GLTF>>} | null;
  sectionHooks: {build?(layout: never): void; teardown?(): void}[];
  frameHooks: ((dt: number) => void)[];
  state?: string;
  hud?: {toast(text: string, warn?: boolean): void} | null;
  sfx?: {hitConfirm?(x: number, y: number, z: number, enemy?: object, head?: boolean): void; impact?(x: number, y: number, z: number, surface: never): void; npcShot?(kind: MarketGunId, x: number, y: number, z: number): void; npcReload?(kind: MarketGunId, x: number, y: number, z: number, seconds: number, shells?: number): void} | null;
  fx?: {bodyHit?(pos: THREE.Vector3, dir: THREE.Vector3, floorY?: number): void; impact?(pos: THREE.Vector3, normal: THREE.Vector3, surface: never, opts?: object): void; muzzleFlash?(pos: THREE.Vector3, dir: THREE.Vector3, big: boolean): void; tracer?(from: THREE.Vector3, to: THREE.Vector3): void} | null;
  physics?: {ragdoll(target: RagdollTarget, impulse: KillImpulse | null): boolean} | null;
  damage?: {structuralClassAt?(kind: 'wall' | 'floor' | 'ceiling', level: number | undefined, point: THREE.Vector3, normal: THREE.Vector3): string} | null;
  warmRegistry?: {addPool(name: string, roots: () => readonly THREE.Object3D[]): void} | null;
  /** The one incoming-hit pipeline + its directional feedback (Game.gunshotPlayer). */
  gunshotPlayer(hit: PlayerHit, fromX: number, fromZ: number): ResolvedHit;
  /** Optional: flash the scene's muzzle light at a world point (Game.npcMuzzleLight). */
  npcMuzzleLight?(at: THREE.Vector3): void;
  marketPeople: MarketPeople;
  /** (task studio-market-bar-20261108-225231-01 seams) The player's detectability (1, or 0.75: the Night Shift Porter). */
  beerEffects?: {perceptionMult(): number} | null;
  /** (seams) The panic screams / angry grunts (the audio system caps / staggers / varies them). */
  marketAudio?: {scream(personId: string, x: number, y: number, z: number): void; grunt(personId: string, x: number, y: number, z: number): void} | null;
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const turnToward = (yaw: number, target: number, max: number) => { const d = wrap(target - yaw); return yaw + Math.max(-max, Math.min(max, d)); };
const between = (r: () => number, a: readonly [number, number]) => a[0] + r() * (a[1] - a[0]);
/** A HumanActor faces +Z: model yaw toward a direction. */
const yawTo = (dx: number, dz: number) => Math.atan2(dx, dz);

export class MarketCombat implements MarketHostilityApi {
  private hostileFlag = false;
  private cause: MarketProvocation | null = null;
  /** Everyone of this station (traders, then residents), in the record order. */
  readonly people: MarketCombatant[] = [];
  private allIds: string[] = [];
  private seed = 0;
  private key: SectionKey | null = null;
  private built = false;
  private frameNo = 0;
  private persistT = 0;
  /** (lane PEOPLE) The station's areas (refuges) and who hides where (built when first needed: the provocation / a hostile record). */
  private areas: readonly Area[] = [];
  private market: MarketLayout | null = null;
  private book: RefugeBook | null = null;
  /** The player's detectability this frame (perceptionMult, read once per frame). */
  private detect = 1;
  /** The player's shot being aggregated (one trigger pull). */
  private shot = new Map<MarketCombatant, {total: number; pellets: number; head: boolean; point: THREE.Vector3; dir: THREE.Vector3; weapon: string}>();
  /** The player's recent positions (an aim point lags them). */
  private trail: {t: number; x: number; y: number; z: number}[] = [];
  private clock = 0;
  /** QA / tests. */
  readonly counts = {provoked: 0, shots: 0, rounds: 0, playerHits: 0, reloads: 0, kills: 0, persisted: 0, ragdolls: 0, paths: 0, hidden: 0, screams: 0, grunts: 0, flinches: 0, migrated: 0};
  /** The last few rounds fired at the player (QA): who, distance, hit (location) or what stopped it. */
  readonly log: {id: string; gun: MarketGunId; dist: number; hit: string; t: number}[] = [];

  constructor(readonly host: MarketCombatHost) {}

  install(): this {
    const h = this.host;
    h.sectionHooks.push({build: (layout: never) => this.build(layout as {seed: number; market?: MarketLayout}), teardown: () => this.teardown()});
    h.frameHooks.push(dt => this.frame(dt));
    h.marketPeople.takeover = () => this.hostileFlag && this.built;
    // the guns in the people's hands are hidden until drawn: one per gun model compiles on the loading screen
    h.warmRegistry?.addPool('market-guns', () => this.gunPrototypes());
    return this;
  }

  // =================================================================================================================== the API

  get hostile(): boolean { return this.hostileFlag; }

  canTrade(stall: MarketStallId): boolean {
    if (this.hostileFlag) return false;
    const p = this.people.find(x => x.id === traderId(stall));
    return !p || p.state === 'alive';
  }

  provoke(cause: MarketProvocation): void {
    if (this.hostileFlag || !this.built) return;
    this.hostileFlag = true;
    const stall = cause.kind === 'theft' ? cause.stall : cause.stall ?? this.people.find(p => p.id === cause.person)?.stall;
    this.cause = {kind: cause.kind, ...(stall ? {stall} : {}), ...(cause.person ? {person: cause.person} : {})};
    this.counts.provoked++;
    const roles = assignRoles(this.seed, this.allIds, cause.kind === 'theft' ? stall : undefined);
    for (const p of this.people) p.role = roles.get(p.id) ?? 'flee';
    // (lane PEOPLE) every fleer's refuge: seeded over everyone with the flee role (the victim of the first shot included, so who was hit
    // never reshuffles the others' homes), then the dead give their slot back
    const book = this.refugeBook();
    book.assign(this.seed, this.people.filter(p => p.role === 'flee').map(p => ({id: p.id, ...p.home})));
    for (const p of this.people) if (p.state !== 'alive') book.release(p.id);
    for (const p of this.people) {
      if (p.state !== 'alive') continue;
      p.actor.cancelOneShot(0.1);
      if (p.role === 'fight') { this.setMode(p, 'draw'); p.delay = between(p.rand, [0.25, 0.9]) * (p.stall && p.stall === stall ? 0.5 : 1); }
      else { this.setMode(p, 'panic'); p.delay = between(p.rand, MARKET_COMBAT.panic); p.actor.play(COMBAT_CLIP.hit, 0.08); } // a startled flinch, then the run (and the scream)
    }
    this.host.hud?.toast(cause.kind === 'theft' ? MARKET_COMBAT_TEXT.theft : MARKET_COMBAT_TEXT.hostile, true);
    this.persist();
  }

  // =================================================================================================================== lifecycle

  build(layout: {seed: number; market?: MarketLayout; areas?: readonly Area[]}): void {
    this.reset();
    if (!layout?.market) return;
    const h = this.host, MP = h.marketPeople;
    this.seed = layout.seed >>> 0;
    this.key = {...h.run.current};
    this.areas = layout.areas ?? [];
    this.market = layout.market;
    const roster = MP.roster;
    this.allIds = roster.map(r => r.id);
    const owner = h.propModels.get(MARKET_HUMAN_KEY) ?? MP;
    for (const r of roster) {
      const gun = gunFor(this.seed, r.id), ammo = ammoFor(this.seed, r.id, gun);
      const body = new HumanCombatBody(r.actor);
      let clips: CombatClipSet;
      try {
        clips = combatClips(owner, r.actor.look.body, r.actor.prefix, gun, rigFromSkeleton(r.actor.meshes[0].skeleton, r.actor.prefix));
      } catch (err) { console.warn('market combat: no combat clips for', r.id, err); continue; }
      r.actor.addClips(clips.clips, {oneShots: combatOneShots(gun), terminal: COMBAT_TERMINAL, ground: {[COMBAT_CLIP.run]: clips.runSpeed, [COMBAT_CLIP.runArmed(gun)]: clips.runSpeed}});
      const gltf = h.assets?.models?.[gun];
      if (gltf) body.attachGun(gltf, gun, clips.grip);
      const rand = mulberry32(hashString(`market-combat:${r.id}`, this.seed));
      const p: MarketCombatant = {
        id: r.id, actor: r.actor, body, ...(r.stall ? {stall: r.stall} : {}), hp: MARKET_HOSTILITY.hp, state: 'alive', role: 'flee', gun,
        npc: new NpcGun(gun, ammo.mag, ammo.spare, rand), clips, mode: 'calm', t: 0, delay: 0,
        hidden: false, routed: false, retry: 0, flinchT: 0, voiceT: 0, home: {x: r.actor.x, y: r.actor.y, z: r.actor.z},
        path: null, wp: 0, goal: null, speed: between(rand, MARKET_COMBAT.fleeSpeed) * r.actor.scale,
        seeT: rand() * MARKET_COMBAT.perceive, sees: false, clear: false, lostT: 0, lastSeen: null,
        aimT: 0, reaction: between(rand, NPC_GUNS[gun].reaction), aimPt: null, repathT: 0, checkT: 0, checkX: r.actor.x, checkZ: r.actor.z, rand, moved: 0, ragdolled: false,
      };
      body.onMoved = (x, z) => { p.actor.x = x; p.actor.z = z; };
      this.people.push(p);
    }
    this.built = true;
    this.refugeBook(); // (lane PEOPLE: the refuges' line-of-sight ranking on the loading screen, never a hitch at the provocation)
    const rec = h.run.laneStore<MarketHostilityJSON>(MARKET_HOSTILITY_LANE, this.key);
    if (rec !== undefined) {
      const bad = marketHostilityProblem(rec);
      if (bad) console.warn('market combat: ignoring a malformed hostility record:', bad);
      else this.restore(rec);
    }
  }

  /**
   * A station built again: the hostile record applied to the freshly spawned people. (Lane PEOPLE) Hiders cower in their refuge; a fleer
   * recorded on its way resumes the run from where it was; a version-1 record's FLED people (alive, gone, no position) come back as hiders
   * in a refuge with their hp / gun / rounds / role; the dead stay dead. The record is rewritten at once in the current version.
   */
  private restore(rec: MarketHostilityJSON): void {
    this.hostileFlag = true;
    this.cause = {kind: rec.cause, ...(rec.stall ? {stall: rec.stall} : {})};
    const book = this.refugeBook();
    /** People to put in a refuge slot now (an old record's fled; anyone the record does not know). */
    const placeIn: MarketCombatant[] = [];
    for (const p of this.people) {
      const r = rec.people[p.id];
      if (!r) { p.role = 'flee'; placeIn.push(p); continue; } // (nobody joins a hostile market: never happens within a layout version)
      p.role = r.role; p.npc.mag = r.mag; p.npc.spare = r.spare;
      if (r.s === 'fled') { p.hp = r.hp > 0 ? r.hp : 0.01; placeIn.push(p); this.counts.migrated++; continue; }
      p.hp = r.hp;
      if (r.x !== undefined) { p.actor.x = r.x; p.actor.y = r.y!; p.actor.z = r.z!; p.actor.yaw = r.yaw!; }
      if (r.s === 'dead') { this.layDead(p); continue; }
      if (p.role === 'fight') { this.setMode(p, 'engage'); this.draw(p, true); }
      else {
        const ref = r.refuge !== undefined ? book.byId(r.refuge) : undefined;
        if (ref) book.claimNear(p.id, ref, p.actor.x, p.actor.z);
        if (ref && r.posture === 'hide' && book.claimOf(p.id) && book.inside(ref, p.actor.x, p.actor.y, p.actor.z)) this.hideNow(p, 0);
        else { this.setMode(p, 'flee'); p.path = null; p.actor.play(COMBAT_CLIP.cower, 0); } // (its run resumes on the first frame)
      }
      p.actor.sync();
    }
    // the fleers still without a slot get the seeded assignment; the ones to place appear in theirs (no refuge at all: their own place)
    book.assign(this.seed, this.people.filter(p => p.state === 'alive' && p.role === 'flee').map(p => ({id: p.id, ...p.home})));
    for (const p of placeIn) {
      const s = book.slotOf(p.id);
      const at = s ?? {...p.home, yaw: p.actor.yaw};
      p.actor.x = at.x; p.actor.y = at.y; p.actor.z = at.z; p.actor.yaw = at.yaw;
      if (p.role === 'fight') { this.setMode(p, 'engage'); this.draw(p, true); }
      else if (s) this.hideNow(p, 0);
      else { this.setMode(p, 'flee'); p.path = null; p.actor.play(COMBAT_CLIP.cower, 0); }
      p.actor.sync();
    }
    this.persist();
  }

  /** (lane PEOPLE) The station's refuges and who hides where (computed once per build, when first needed). */
  refugeBook(): RefugeBook {
    if (!this.book) this.book = new RefugeBook(this.market ? marketRefuges({areas: this.areas, market: this.market}, this.host.levels) : [], this.host.levels);
    return this.book;
  }

  private reset(): void {
    this.people.length = 0;
    this.allIds = [];
    this.areas = [];
    this.market = null;
    this.book = null;
    this.hostileFlag = false;
    this.cause = null;
    this.built = false;
    this.key = null;
    this.shot.clear();
    this.trail = [];
    this.persistT = 0;
  }

  teardown(): void {
    if (this.built && this.hostileFlag) {
      // (lane PEOPLE) a fleer on its way home along a route it had found used the player's absence to get there (into its slot); one that
      // never found a way stays where it was and runs on when the player is back. Nobody leaves the market.
      for (const p of this.people) {
        if (p.state !== 'alive' || p.role !== 'flee' || p.hidden || !p.routed) continue;
        const s = this.book?.slotOf(p.id);
        if (!s) continue;
        p.actor.x = s.x; p.actor.y = s.y; p.actor.z = s.z; p.actor.yaw = s.yaw;
        p.hidden = true; p.mode = 'hide'; p.path = null;
      }
      this.persist();
    }
    this.reset();
  }

  /** One prototype gun holder per gun model (hidden in a person's hand): the warm-up compiles them. */
  private gunPrototypes(): THREE.Object3D[] {
    const seen = new Set<MarketGunId>(), out: THREE.Object3D[] = [];
    for (const p of this.people) if (p.body.gunHolder && !seen.has(p.gun)) { seen.add(p.gun); out.push(p.body.gunHolder); }
    return out;
  }

  // =================================================================================================================== persistence

  private recordOf(p: MarketCombatant): MarketPersonRecord {
    const a = p.actor;
    const posture: MarketPosture = p.state === 'dead' ? 'down' : p.role === 'fight' ? 'fight' : p.mode === 'hide' && p.hidden ? 'hide' : 'flee';
    const r: MarketPersonRecord = {s: p.state, hp: p.state === 'dead' ? 0 : Math.max(0.01, Math.round(p.hp * 100) / 100), role: p.role, gun: p.gun, mag: p.npc.mag, spare: p.npc.spare, posture};
    r.x = +a.x.toFixed(3); r.y = +a.y.toFixed(3); r.z = +a.z.toFixed(3); r.yaw = +wrap(a.yaw).toFixed(4);
    const c = p.state === 'alive' ? this.book?.claimOf(p.id) : undefined;
    if (c) r.refuge = c.refuge.id;
    return r;
  }

  /** The station's hostility record -> its lane memory (only once hostile; never a calm record). */
  persist(): void {
    if (!this.hostileFlag || !this.key || !this.cause) return;
    const people: Record<string, MarketPersonRecord> = {};
    for (const p of this.people) people[p.id] = this.recordOf(p);
    const json: MarketHostilityJSON = {v: MARKET_HOSTILITY_VERSION, hostile: true, cause: this.cause.kind, ...(this.cause.stall ? {stall: this.cause.stall} : {}), people};
    this.host.run.setLaneStore(MARKET_HOSTILITY_LANE, json, this.key);
    this.counts.persisted++;
  }

  // =================================================================================================================== the player's attacks

  /** The person a player's shot / swing can hit (every alive one; any storey). */
  private targets(): MarketCombatant[] {
    return this.people.filter(p => p.state === 'alive');
  }

  /**
   * The nearest alive person's hit volume the unit ray o + d t crosses before `maxT` (Game.fire, per pellet, after the world / enemy
   * tests). null = nobody.
   */
  rayHit(o: Vec3, d: Vec3, maxT: number): {person: MarketCombatant; t: number; part: RayPart} | null {
    if (!this.built) return null;
    let best: {person: MarketCombatant; t: number; part: RayPart} | null = null, bestT = maxT;
    for (const p of this.targets()) {
      const a = p.actor;
      // cheap reject: the body's vertical segment farther than 2 m from the ray line (exact box test follows)
      const cx = a.x - o.x, cy = a.y + 1 - o.y, cz = a.z - o.z, along = cx * d.x + cy * d.y + cz * d.z;
      if (along < -1.5 || along > bestT + 1.5) continue;
      const qx = cx - d.x * along, qz = cz - d.z * along;
      if (qx * qx + qz * qz > 4) continue;
      const vols = p.body.hitVolumes(this.frameNo, true);
      if (volumesBoxEntry(o, d, vols) >= bestT) continue;
      for (const v of vols) {
        const t = v.b ? rayCapsule(o, d, v.a, v.b, v.r) : raySphere(o, d, v.a, v.r);
        if (t < bestT) { bestT = t; best = {person: p, t, part: v.part}; }
      }
    }
    return best;
  }

  /** One pellet / bullet of the player's shot reached a person: its damage (falloff x the weapon's part multiplier, Game.fire). */
  pellet(person: MarketCombatant, amount: number, point: THREE.Vector3, dir: THREE.Vector3, head: boolean, weapon: string): void {
    const e = this.shot.get(person) ?? {total: 0, pellets: 0, head: false, point: point.clone(), dir: dir.clone(), weapon};
    e.total += amount;
    e.pellets++;
    e.head ||= head;
    this.shot.set(person, e);
    this.host.fx?.bodyHit?.(point, dir, person.actor.y);
  }

  /** The trigger pull is over: each person hit takes its aggregated damage once. Returns whether anyone was hit / killed. */
  endShot(def: WeaponDef): {hit: boolean; kill: boolean} {
    let hit = false, kill = false;
    for (const [p, e] of this.shot) {
      hit = true;
      const killed = this.damage(p, e.total, e.head, e.point, e.dir, def.id, e.pellets, def.pellets);
      kill ||= killed;
      // the shot's shove along its direction (stays out of walls), like a zombie's knockback
      if (!killed && p.state === 'alive') {
        const k = MARKET_COMBAT.knock * def.knockback / 0.25 * (e.pellets / def.pellets);
        [p.actor.x, p.actor.z] = moveCircle(this.host.levels, this.host.propIndex, p.actor.x, p.actor.z, e.dir.x * k, e.dir.z * k, MARKET_PEOPLE.radius, p.actor.y, MARKET_PEOPLE.height);
      }
    }
    this.shot.clear();
    return {hit, kill};
  }

  /** Melee targets for combat/melee.ts resolveMelee (alive people, their volumes). */
  meleeTargets(): {id: MarketCombatant; alive: boolean; x: number; y: number; z: number; volumes: readonly RayVolume[]}[] {
    return this.built ? this.targets().map(p => ({id: p, alive: true, x: p.actor.x, y: p.actor.y, z: p.actor.z, volumes: p.body.hitVolumes(this.frameNo, true)})) : [];
  }

  isCombatant(v: unknown): v is MarketCombatant {
    return this.people.includes(v as MarketCombatant);
  }

  /** A knife hit on a person (Game.meleeContact): blood, the damage once. Returns killed. */
  meleeHit(p: MarketCombatant, amount: number, part: RayPart, point: THREE.Vector3, dir: THREE.Vector3, weapon: string): boolean {
    this.host.fx?.bodyHit?.(point, dir, p.actor.y);
    return this.damage(p, amount, part === 'head', point, dir, weapon, 1, 1);
  }

  /** Damage a person (the player's attack): the hit confirm, a flinch, the settlement turns hostile; a kill -> ragdoll / Death. */
  private damage(p: MarketCombatant, amount: number, head: boolean, point: THREE.Vector3, dir: THREE.Vector3, weapon: string, pelletsHit: number, pellets: number): boolean {
    if (p.state !== 'alive' || !(amount > 0)) return false;
    this.host.sfx?.hitConfirm?.(point.x, point.y, point.z, p, head);
    p.hp -= amount;
    const killed = p.hp <= 0;
    if (killed) {
      p.hp = 0;
      this.kill(p, {dir: {x: dir.x, y: dir.y, z: dir.z}, point: {x: point.x, y: point.y, z: point.z}, strength: killImpulseStrength(weapon, pelletsHit, pellets), bone: head ? 'head' : undefined});
    }
    if (!this.hostileFlag) this.provoke({kind: 'attack', person: p.id, ...(p.stall ? {stall: p.stall} : {})});
    else if (killed) this.persist();
    if (!killed) {
      // a flinch; an armed shooter loses its aim for a moment
      p.actor.play(p.body.gunShown ? COMBAT_CLIP.hitArmed(p.gun) : COMBAT_CLIP.hit, 0.06);
      p.aimT *= 0.3;
      if (p.role === 'fight') {
        if (p.mode === 'draw') p.delay = Math.min(p.delay, 0.2); // shot at: draws at once
        this.grunt(p);
      } else {
        // (lane PEOPLE) a scream; a hider stays in its refuge (cornered, still a target); a stranded one makes its run now
        this.scream(p);
        if (p.mode === 'hide' && !p.hidden) p.retry = Math.min(p.retry, p.t);
      }
    }
    return killed;
  }

  private kill(p: MarketCombatant, impulse: KillImpulse): void {
    p.state = 'dead';
    p.mode = 'dead';
    p.path = null;
    // (lane PEOPLE) a body outside its refuge gives its slot back (one that died in it keeps the corner it lies in)
    const c = this.book?.claimOf(p.id);
    if (c && !this.book!.inside(c.refuge, p.actor.x, p.actor.y, p.actor.z)) this.book!.release(p.id);
    this.counts.kills++;
    p.actor.cancelOneShot(0);
    // the physics ragdoll from the current pose (the last frames' bone motion carried on), shoved by the hit (falls back to the Death clip)
    const rag = this.host.physics?.ragdoll(p.body, impulse) ?? false;
    p.ragdolled = rag;
    if (rag) this.counts.ragdolls++;
    else p.actor.play(COMBAT_CLIP.death, 0.08);
  }

  /** A body from the record: lying where it fell (the Death clip's last frame). */
  private layDead(p: MarketCombatant): void {
    p.state = 'dead'; p.mode = 'dead'; p.hp = 0;
    p.actor.play(COMBAT_CLIP.death, 0);
    p.actor.animate(COMBAT_DEATH_END);
    p.actor.sync();
  }

  // =================================================================================================================== voices

  /** (lane PEOPLE) A fleer's panic scream at its head (Game.marketAudio caps / staggers / varies them). */
  private scream(p: MarketCombatant): void {
    const a = p.actor;
    this.host.marketAudio?.scream(p.id, a.x, a.y + a.heightM * 0.92, a.z);
    this.counts.screams++;
    p.voiceT = between(p.rand, MARKET_COMBAT.scream);
  }

  /** (lane PEOPLE) A fighter's angry grunt. */
  private grunt(p: MarketCombatant): void {
    const a = p.actor;
    this.host.marketAudio?.grunt(p.id, a.x, a.y + a.heightM * 0.92, a.z);
    this.counts.grunts++;
    p.voiceT = between(p.rand, MARKET_COMBAT.grunt);
  }

  // =================================================================================================================== frame

  frame(dt: number): void {
    if (!this.built || dt <= 0) return;
    this.frameNo++;
    if (!this.hostileFlag) return; // calm: market/marketPeople.ts runs the settlement
    this.clock += dt;
    const pl = this.host.player;
    this.trail.push({t: this.clock, x: pl.x, y: pl.y, z: pl.z});
    while (this.trail.length > 2 && this.trail[0].t < this.clock - 1.5) this.trail.shift();
    // the player's detectability (the Night Shift Porter): ONE factor this frame, used once — the sight distance in perceive()
    this.detect = this.host.beerEffects?.perceptionMult() ?? 1;
    for (const p of this.people) {
      p.moved = 0;
      if (p.state === 'alive') {
        const far = Math.hypot(p.actor.x - pl.x, p.actor.z - pl.z) > MARKET_COMBAT.far;
        if (!far) this.perceive(p, dt);
        else p.sees = p.clear = false;
        // (lane PEOPLE) far fighters keep their posture (bounded cost); a fleer keeps going home wherever the player is
        if (p.role === 'fight') { if (!far) this.fight(p, dt); }
        else this.flee(p, dt);
      }
    }
    this.separate();
    for (const p of this.people) {
      const a = p.actor;
      if (p.state === 'alive') this.host.marketPeople.settle(a);
      const dist = Math.hypot(a.x - pl.x, a.z - pl.z);
      // armed hostiles every frame (no animation LOD); the rest by distance like the calm market
      const stride = p.state === 'alive' && p.role === 'fight' ? 1 : dist < MARKET_PEOPLE.lod.near ? 1 : dist < MARKET_PEOPLE.lod.mid ? 2 : 4;
      a.animate(dt, p.moved, stride, this.frameNo);
      a.sync();
      if (p.state === 'alive' && dist < 30 && p.moved > 0.2) p.body.recordPose(dt);
    }
    this.persistT += dt;
    if (this.persistT >= MARKET_COMBAT.persistEvery) { this.persistT = 0; this.persist(); }
  }

  private setMode(p: MarketCombatant, m: Mode): void {
    p.mode = m;
    p.t = 0;
    if (m !== 'flee' && m !== 'move' && m !== 'cover') p.path = null;
  }

  /** Sight (eyes to the player's head / chest through every slab, wall and closed solid) and a clear line for a round, staggered. */
  private perceive(p: MarketCombatant, dt: number): void {
    p.seeT -= dt;
    if (p.seeT > 0) return;
    p.seeT = MARKET_COMBAT.perceive;
    const pl = this.host.player;
    if (!pl.alive) { p.sees = p.clear = false; return; }
    const eye = p.body.eyeWorld(), chest = playerChest(pl as PlayerBody);
    const head = {x: pl.x, y: pl.eye, z: pl.z};
    const L = this.host.levels;
    p.sees = Math.hypot(eye.x - pl.x, eye.y - pl.eye, eye.z - pl.z) < MARKET_COMBAT.sight * this.detect && (L.lineOfSight(eye, head) || L.lineOfSight(eye, chest));
    if (p.sees) p.lastSeen = {x: pl.x, y: pl.y, z: pl.z};
    p.clear = false;
    if (p.sees && p.role === 'fight') {
      // the round's own world ray from the muzzle (props / the train's walls count) to the chest
      const m = p.body.gunShown ? p.body.muzzleWorld() : new THREE.Vector3(eye.x, eye.y - 0.25, eye.z);
      const dx = chest.x - m.x, dy = chest.y - m.y, dz = chest.z - m.z, d = Math.hypot(dx, dy, dz);
      const wh = this.worldRay(m, {x: dx / d, y: dy / d, z: dz / d}, d);
      p.clear = wh.t >= d - 0.3;
    }
  }

  private worldRay(o: Vec3, d: Vec3, max: number): WorldHit {
    const lay = this.host.layout;
    return raycastShot(this.host.levels, lay.props, o, d, max, lay.trench.floorY);
  }

  // ------------------------------------------------------------------------------------------------------------------- fleeing

  /**
   * (Lane PEOPLE) A fleer: the startled look, the run home (screaming now and then), then hiding in its refuge slot for good — cowering,
   * facing its doorway, flinching (and screaming) when the player comes close in sight. A stranded one cowers and tries again shortly.
   */
  private flee(p: MarketCombatant, dt: number): void {
    const a = p.actor, pl = this.host.player;
    p.t += dt;
    p.voiceT -= dt;
    p.flinchT -= dt;
    if (p.mode === 'calm') this.setMode(p, 'panic');
    if (p.mode === 'panic') {
      a.yaw = turnToward(a.yaw, yawTo(pl.x - a.x, pl.z - a.z), MARKET_COMBAT.turnFlee * dt); // looks toward the shot
      if (p.t >= p.delay) { this.scream(p); this.runFor(p); }
      return;
    }
    if (p.mode === 'flee') {
      if (!p.path) { this.runFor(p); if (!p.path) return; }
      if (this.walk(p, dt, p.speed, MARKET_COMBAT.turnFlee)) { this.hideNow(p); return; }
      if (p.voiceT <= 0 && p.moved > 0.5) this.scream(p);
      return;
    }
    // hide
    if (a.loop !== COMBAT_CLIP.cower) a.play(COMBAT_CLIP.cower, 0.35);
    if (!p.hidden) { if (p.t >= p.retry) this.runFor(p); return; } // (stranded on its way: another try)
    const s = this.book?.slotOf(p.id);
    if (s) a.yaw = turnToward(a.yaw, s.yaw, 2.5 * dt);
    const d = Math.hypot(a.x - pl.x, a.z - pl.z);
    if (p.sees && d < MARKET_COMBAT.reflee && p.flinchT <= 0 && Math.abs(pl.y - a.y) < 2) {
      a.play(COMBAT_CLIP.hit, 0.08); // (a one-shot: back to the cower)
      this.scream(p);
      this.counts.flinches++;
      p.flinchT = between(p.rand, MARKET_COMBAT.flinch);
    }
  }

  /** (Lane PEOPLE) In its refuge: hiding (cowering) for good. */
  private hideNow(p: MarketCombatant, fade = 0.35): void {
    this.setMode(p, 'hide');
    p.hidden = true;
    p.goal = null;
    p.actor.play(COMBAT_CLIP.cower, fade);
    p.flinchT = Math.max(p.flinchT, 0.8);
    this.counts.hidden++;
  }

  /**
   * (Lane PEOPLE) Run for its refuge slot (its own refuge first, then another with room): the first route through the doors / stairs that
   * keeps clear of the parked train and never passes the player. None now: cower where it stands and try again in a moment.
   */
  private runFor(p: MarketCombatant): void {
    const a = p.actor, MP = this.host.marketPeople, book = this.refugeBook();
    p.hidden = false;
    for (const c of book.options(p.id, a.x, a.y, a.z, 3)) {
      const s = c.refuge.slots[c.slot];
      if (Math.hypot(s.x - a.x, s.z - a.z) < MARKET_PEOPLE.arrive && Math.abs(s.y - a.y) < 0.5) { book.claim(p.id, c.refuge, c.slot); p.routed = true; this.hideNow(p); return; }
      const path = MP.route(a.x, a.y, a.z, s.x, s.y, s.z);
      this.counts.paths++;
      if (!path || this.passesPlayer(a, path)) continue;
      book.claim(p.id, c.refuge, c.slot);
      this.setMode(p, 'flee');
      p.path = path; p.wp = 0; p.goal = {x: s.x, y: s.y, z: s.z}; p.routed = true;
      p.checkT = 0; p.checkX = a.x; p.checkZ = a.z;
      a.play(COMBAT_CLIP.run, 0.25);
      return;
    }
    // the way home is blocked (the player in it, a crowd): cower here, try again shortly
    this.setMode(p, 'hide');
    p.goal = null;
    p.retry = between(p.rand, MARKET_COMBAT.retry);
    a.play(COMBAT_CLIP.cower, 0.35);
  }

  /** (Lane PEOPLE) The person stands inside its claimed refuge. */
  private inRefuge(p: MarketCombatant): boolean {
    const c = this.book?.claimOf(p.id);
    return !!c && this.book!.inside(c.refuge, p.actor.x, p.actor.y, p.actor.z);
  }

  private passesPlayer(a: HumanActor, path: Waypoint[]): boolean {
    const pl = this.host.player, gap = MARKET_COMBAT.passGap;
    let px = a.x, pz = a.z;
    for (const w of path) {
      const n = Math.max(1, Math.ceil(Math.hypot(w[0] - px, w[1] - pz) / 0.5));
      for (let k = 1; k <= n; k++) {
        const x = px + (w[0] - px) * k / n, z = pz + (w[1] - pz) * k / n;
        if (Math.hypot(x - pl.x, z - pl.z) < gap && Math.abs((w[3] ?? a.y) - pl.y) < 1.5) return true;
      }
      px = w[0]; pz = w[1];
    }
    return false;
  }

  /** Follow the path; true on arrival. Stuck -> a re-plan (fleeing) / give up the route (moving). */
  private walk(p: MarketCombatant, dt: number, speed: number, turn: number): boolean {
    const a = p.actor, path = p.path!;
    p.wp = this.host.marketPeople.nextWaypoint(a, path, p.wp); // (lane PEOPLE: never cutting a stair's corner)
    const wp = path[p.wp];
    const last = p.wp >= path.length - 1;
    const dx = wp[0] - a.x, dz = wp[1] - a.z, d = Math.hypot(dx, dz);
    if (last && d < MARKET_PEOPLE.arrive) { p.path = null; return true; }
    a.yaw = turnToward(a.yaw, yawTo(dx, dz), turn * dt);
    const align = Math.cos(wrap(yawTo(dx, dz) - a.yaw));
    const sp = speed * Math.max(0.2, align) * (last ? Math.min(1, 0.4 + d) : 1);
    const ox = a.x, oz = a.z, step = Math.min(sp * dt, d);
    [a.x, a.z] = moveCircle(this.host.levels, this.host.propIndex, a.x, a.z, dx / (d || 1) * step, dz / (d || 1) * step, MARKET_PEOPLE.radius, this.host.marketPeople.stepFeet(a, wp), MARKET_PEOPLE.height);
    p.moved = Math.hypot(a.x - ox, a.z - oz) / dt;
    p.checkT += dt;
    if (p.checkT >= MARKET_COMBAT.stuckS) {
      const stuck = Math.hypot(a.x - p.checkX, a.z - p.checkZ) < MARKET_COMBAT.stuckM;
      p.checkT = 0; p.checkX = a.x; p.checkZ = a.z;
      if (stuck) {
        p.path = null;
        // (lane PEOPLE) a fleer held up inside its own refuge (the player in its corner) hides where it is; elsewhere it re-plans
        if (p.role === 'flee') { if (this.inRefuge(p)) this.hideNow(p); else this.runFor(p); }
        return false;
      }
    }
    return false;
  }

  // ------------------------------------------------------------------------------------------------------------------- fighting

  /** The gun comes out (instant: a restored shooter) with an angry grunt. */
  private draw(p: MarketCombatant, instant = false): void {
    p.body.gunShown = true;
    p.actor.play(COMBAT_CLIP.aim(p.gun), instant ? 0 : 0.45);
    if (!instant) this.grunt(p);
  }

  private fight(p: MarketCombatant, dt: number): void {
    const a = p.actor, pl = this.host.player, S = NPC_GUNS[p.gun];
    p.t += dt;
    p.voiceT -= dt;
    if (p.voiceT <= 0 && p.sees && p.mode !== 'draw' && p.body.gunShown) this.grunt(p); // (lane PEOPLE) now and then in a firefight
    if (p.npc.tick(dt) === 'reloaded') { this.counts.reloads++; this.persist(); this.setMode(p, 'engage'); a.play(COMBAT_CLIP.aim(p.gun), 0.3); }
    if (p.mode === 'calm') this.setMode(p, 'draw');
    if (p.mode === 'draw') {
      a.yaw = turnToward(a.yaw, yawTo(pl.x - a.x, pl.z - a.z), MARKET_COMBAT.turnFight * dt);
      if (p.t >= p.delay && !p.body.gunShown) this.draw(p);
      if (p.t >= p.delay + 0.45) this.setMode(p, 'engage');
      return;
    }
    if (p.npc.dry) { p.role = 'flee'; p.body.gunShown = false; this.runFor(p); this.persist(); return; } // out of rounds: runs for it
    if (p.mode === 'reload' || p.mode === 'cover') { this.reloading(p, dt); return; }
    if (p.npc.mag <= 0) { this.startReload(p); return; }
    const d = Math.hypot(pl.x - a.x, pl.z - a.z);
    const line = p.sees && p.clear;
    p.lostT = line ? 0 : p.lostT + dt;
    if (p.mode === 'move') {
      p.repathT -= dt;
      if (line && d <= S.range * MARKET_COMBAT.standoff) { this.setMode(p, 'engage'); a.play(COMBAT_CLIP.aim(p.gun), 0.25); return; }
      const goal = p.lastSeen ?? {x: pl.x, y: pl.y, z: pl.z};
      if (!p.path || p.repathT <= 0) {
        p.repathT = MARKET_COMBAT.repath;
        p.path = this.host.marketPeople.route(a.x, a.y, a.z, goal.x, goal.y, goal.z);
        this.counts.paths++;
        p.wp = 0; p.checkT = 0; p.checkX = a.x; p.checkZ = a.z;
        if (!p.path) { a.play(COMBAT_CLIP.aim(p.gun), 0.3); return; } // no way there now: hold, try again
        a.play(COMBAT_CLIP.runArmed(p.gun), 0.25);
      }
      if (this.walk(p, dt, MARKET_COMBAT.moveSpeed * a.scale, MARKET_COMBAT.turnFight)) { p.lastSeen = null; this.setMode(p, 'engage'); a.play(COMBAT_CLIP.aim(p.gun), 0.25); }
      return;
    }
    // engage: hold the line and shoot
    if (!line && p.lostT > MARKET_COMBAT.lostS || d > S.range) { this.setMode(p, 'move'); p.repathT = 0; return; }
    if (!line) { p.aimT = Math.max(0, p.aimT - dt); return; }
    const want = yawTo(pl.x - a.x, pl.z - a.z);
    a.yaw = turnToward(a.yaw, want, MARKET_COMBAT.turnFight * dt);
    const err = Math.abs(wrap(want - a.yaw));
    // the aim's pitch: muzzle height to the chest
    const chest = playerChest(pl as PlayerBody);
    p.body.aimPitch = Math.atan2(chest.y - (a.y + a.heightM * 0.8), Math.max(0.5, d));
    if (err < 0.22) p.aimT += dt;
    if (p.aimT >= p.reaction && p.npc.ready && err < 0.12 && this.host.state !== 'paused') this.shoot(p);
  }

  /** Out of the magazine: into cover nearby if there is some (out of the player's sight), then the reload. */
  private startReload(p: MarketCombatant): void {
    const a = p.actor;
    const cover = this.coverNear(p);
    if (cover) {
      const path = this.host.marketPeople.route(a.x, a.y, a.z, cover.x, cover.y, cover.z);
      this.counts.paths++;
      if (path) {
        this.setMode(p, 'cover');
        p.path = path; p.wp = 0; p.checkT = 0; p.checkX = a.x; p.checkZ = a.z;
        a.play(COMBAT_CLIP.runArmed(p.gun), 0.2);
        return;
      }
    }
    this.beginReload(p);
  }

  private beginReload(p: MarketCombatant): void {
    if (!p.npc.startReload()) { this.setMode(p, 'engage'); return; }
    this.setMode(p, 'reload');
    const a = p.actor, n = COMBAT_CLIP.reload(p.gun);
    a.play(n, 0.2);
    a.setRate(a.duration(n) / Math.max(0.3, p.npc.reloadTotal));
    const m = p.body.muzzleWorld();
    this.host.sfx?.npcReload?.(p.gun, m.x, m.y, m.z, p.npc.reloadTotal, Math.min(p.npc.def.magazine - p.npc.mag, p.npc.spare));
  }

  private reloading(p: MarketCombatant, dt: number): void {
    if (p.mode === 'cover') {
      if (!p.path || this.walk(p, dt, MARKET_COMBAT.moveSpeed * p.actor.scale, MARKET_COMBAT.turnFight)) this.beginReload(p);
      return;
    }
    // reloading: face the threat (tick() ends it)
    const pl = this.host.player, a = p.actor;
    a.yaw = turnToward(a.yaw, yawTo(pl.x - a.x, pl.z - a.z), MARKET_COMBAT.turnFight * 0.4 * dt);
  }

  /** A walkable point within a few metres the player cannot see (chest height), on the shooter's storey; nearest first. */
  private coverNear(p: MarketCombatant): Vec3 | null {
    const a = p.actor, pl = this.host.player, L = this.host.levels;
    const pe = {x: pl.x, y: pl.eye, z: pl.z};
    const lv = L.levelAt(a.x, a.z, a.y + 0.05), G = L.grid(lv);
    for (const r of MARKET_COMBAT.coverRings) {
      for (let k = 0; k < 8; k++) {
        const ang = (k / 8) * Math.PI * 2 + p.rand() * 0.3;
        const x = a.x + Math.sin(ang) * r, z = a.z + Math.cos(ang) * r;
        const [cx, cy] = G.cellOf(x, z);
        if (!G.walkable(cx, cy) || !G.circleClear(x, z, 0.36)) continue;
        const y = G.cellFloor(cx, cy);
        if (Math.abs(y - a.y) > 0.5 || this.host.marketPeople.inKeepout(x, z, y, MARKET_PEOPLE.radius)) continue;
        if (!L.lineOfSight(pe, {x, y: y + 1.2, z})) return {x, y, z};
      }
    }
    return null;
  }

  /** One round (a shotgun's pellets) from the muzzle at the player: the world ray, the player's body, the hit through the pipeline. */
  private shoot(p: MarketCombatant): void {
    const a = p.actor, pl = this.host.player, S = NPC_GUNS[p.gun], def = p.npc.def, r = p.rand;
    const muzzle = p.body.gunShown ? p.body.muzzleWorld() : p.body.eyeWorld();
    if (p.npc.burstStart || !p.aimPt) {
      // a fresh aim point: where the player WAS (lag), plus the shooter's error
      const lagT = this.clock - S.lag;
      const past = this.trail.find(s => s.t >= lagT) ?? this.trail[this.trail.length - 1] ?? {x: pl.x, y: pl.y, z: pl.z};
      const c = playerChest({...pl, x: past.x, y: past.y, z: past.z, eye: pl.eye - pl.y + past.y} as PlayerBody);
      const g = () => (r() + r() + r() - 1.5) * 1.15; // ~N(0, 1)
      const dist = Math.hypot(c.x - muzzle.x, c.z - muzzle.z);
      const err = S.aimError * (0.6 + Math.min(1.6, dist / 12));
      p.aimPt = {x: c.x + g() * err, y: c.y + g() * err * 0.7, z: c.z + g() * err};
    }
    const pellets = p.npc.fire();
    this.counts.shots++;
    const aim = p.aimPt!;
    const dx = aim.x - muzzle.x, dy = aim.y - muzzle.y, dz = aim.z - muzzle.z, dl = Math.hypot(dx, dy, dz) || 1;
    const d0 = {x: dx / dl, y: dy / dl, z: dz / dl};
    const spread = def.pellets > 1 ? def.spreadHip : S.spread * (p.moved > 0.3 ? 1.8 : 1);
    const body: PlayerBody = {x: pl.x, y: pl.y, z: pl.z, eye: pl.eye, yaw: pl.yaw, radius: pl.radius};
    let raw = 0, where: string | null = null, firstHitT = 0;
    const end = new THREE.Vector3();
    for (let i = 0; i < pellets; i++) {
      const d = coneDir(d0, spread, r);
      const wh = this.worldRay(muzzle, d, def.range);
      const ph = pl.alive ? playerBulletHit(muzzle, d, wh.t, body) : null;
      this.counts.rounds++;
      if (ph) {
        raw += npcRoundDamage(p.gun, ph.t);
        if (!where) { where = ph.location; firstHitT = ph.t; }
        end.set(muzzle.x + d.x * ph.t, muzzle.y + d.y * ph.t, muzzle.z + d.z * ph.t);
      } else {
        end.set(muzzle.x + d.x * wh.t, muzzle.y + d.y * wh.t, muzzle.z + d.z * wh.t);
        if (wh.kind !== 'none') this.impact(wh, end);
      }
      if (i < 2 && (pellets > 1 || this.counts.shots % 2 === 0)) this.host.fx?.tracer?.(new THREE.Vector3(muzzle.x, muzzle.y, muzzle.z), end.clone());
    }
    const md = new THREE.Vector3(d0.x, d0.y, d0.z), mp = new THREE.Vector3(muzzle.x, muzzle.y, muzzle.z);
    this.host.fx?.muzzleFlash?.(mp, md, p.gun === 'shotgun');
    this.host.npcMuzzleLight?.(mp);
    this.host.sfx?.npcShot?.(p.gun, muzzle.x, muzzle.y, muzzle.z);
    a.play(COMBAT_CLIP.fire(p.gun), 0.04);
    if (raw > 0 && where) {
      // ONE enemy hit per round (a shotgun's pellets together, like the player's pellets on a zombie): the player's pipeline
      this.counts.playerHits++;
      this.host.gunshotPlayer({amount: raw, source: 'other', enemy: true, location: where as PlayerHit['location'], attacker: `survivor-${p.gun}`}, a.x, a.z);
    }
    this.log.push({id: p.id, gun: p.gun, dist: +(firstHitT || Math.hypot(pl.x - a.x, pl.z - a.z)).toFixed(2), hit: where ?? 'miss', t: +this.clock.toFixed(2)});
    if (this.log.length > 12) this.log.shift();
  }

  /** A survivor's round on a surface: its material's impact (fx + positional sound); no lasting damage (only the player's guns do that). */
  private impact(wh: WorldHit, point: THREE.Vector3): void {
    const n = new THREE.Vector3(wh.nx, wh.ny, wh.nz);
    const props = this.host.layout.props;
    let spec = DAMAGE_MATERIALS.concrete;
    if (wh.kind === 'prop' && wh.prop !== undefined && props[wh.prop]) spec = DAMAGE_MATERIALS[propDamageSpec(props[wh.prop].kind).cls];
    else if ((wh.kind === 'wall' || wh.kind === 'floor' || wh.kind === 'ceiling') && this.host.damage?.structuralClassAt) {
      const cls = this.host.damage.structuralClassAt(wh.kind, wh.level, point, n) as keyof typeof DAMAGE_MATERIALS;
      spec = DAMAGE_MATERIALS[cls] ?? spec;
    }
    this.host.fx?.impact?.(point, n, spec.fx as never, {chips: 3});
    this.host.sfx?.impact?.(point.x, point.y, point.z, spec.sound as never);
  }

  // ------------------------------------------------------------------------------------------------------------------- bodies

  /** Living people keep apart from each other and step away from the player (never pushing the player). */
  private separate(): void {
    const pl = this.host.player, R = MARKET_PEOPLE.radius;
    const live = this.people.filter(p => p.state === 'alive');
    for (const p of live) {
      const a = p.actor;
      for (const o of live) {
        if (o === p || Math.abs(o.actor.y - a.y) > 1) continue;
        const dx = a.x - o.actor.x, dz = a.z - o.actor.z, d = Math.hypot(dx, dz), min = 2 * R;
        if (d > 1e-4 && d < min) { a.x += dx / d * (min - d) * 0.5; a.z += dz / d * (min - d) * 0.5; }
      }
      const dx = a.x - pl.x, dz = a.z - pl.z, d = Math.hypot(dx, dz), min = R + pl.radius + MARKET_PEOPLE.playerGap;
      if (d < min && Math.abs(pl.y - a.y) < 1) { if (d > 1e-4) { a.x += dx / d * (min - d); a.z += dz / d * (min - d); } else a.x += min; }
    }
  }

  // =================================================================================================================== QA

  qa() {
    return {
      hostile: this.hostileFlag, cause: this.cause, counts: {...this.counts},
      people: this.people.map(p => ({id: p.id, state: p.state, role: p.role, mode: p.mode, hidden: p.hidden, refuge: this.book?.claimOf(p.id)?.refuge.id ?? null, hp: +p.hp.toFixed(1), gun: p.gun, mag: p.npc.mag, spare: p.npc.spare, drawn: p.body.gunShown, x: +p.actor.x.toFixed(2), y: +p.actor.y.toFixed(2), z: +p.actor.z.toFixed(2), clip: p.actor.current})),
      refuges: this.book?.refuges.map(r => ({id: r.id, label: r.label, level: r.level, slots: r.slots.length, hidden: r.slots.filter(s => s.hidden).length, load: this.book!.load(r)})) ?? [],
      log: [...this.log],
    };
  }
}

/** Seconds that put the Death clip at its last frame (a body from the record). */
const COMBAT_DEATH_END = 5;

/** The player's damage of one pellet on a person's part (Game.fire's own formula: falloff x the weapon's multiplier). */
export function playerPelletDamage(def: WeaponDef, part: RayPart, t: number): number {
  const mult = part === 'head' ? def.headMult : part === 'limb' ? def.limbMult : 1;
  return def.damage * WeaponController.falloff(def, t) * mult;
}

/** Game wiring (Game's constructor, after the market people): Game.marketHostility. */
export function installMarketCombat(game: unknown): MarketCombat {
  return new MarketCombat(game as MarketCombatHost).install();
}

/** QA hooks (spread into window.__LL by qa.ts) for SHORT serial browser spot checks. */
export function marketCombatQaApi(sys: () => MarketCombat | null | undefined) {
  return {
    /** Hostility, cause, per person state / role / mode / hp / gun / rounds, the last rounds fired. */
    marketCombat: () => sys()?.qa() ?? null,
    /** Turn the settlement hostile as a theft at `stall` (or an attack). */
    marketProvoke: (stall?: MarketStallId, kind: 'attack' | 'theft' = 'theft') => sys()?.provoke({kind, ...(stall ? {stall} : {})}),
  };
}

