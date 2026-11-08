// Task studio-market-rework-20261108-074144-01 (lane COMBAT): fixtures of the market combat tests — a REAL generated Survivor Market
// (gen/market generateMarketLevel: levels, path finder, prop index, the parked train), the real cast GLB and the player's real gun models
// (textures stripped: Node has no image decoder), the market people + the combat controller on the save fixture's Harness (real RunState /
// Inventory), and a player-hit sink that is Game.applyPlayerHit line for line (the enemy multiplier, the worn armour pool + wear).
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import * as THREE from 'three';
import {GLTFLoader, type GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {generateMarketLevel} from '../../src/gen/market/index';
import {levelsOf} from '../../src/gen/levels';
import {PathFinder} from '../../src/gen/grid';
import {PropIndex} from '../../src/core/physics';
import {playerTrainPlacement} from '../../src/gen/playerTrain';
import {mulberry32} from '../../src/core/rng';
import type {StationLayout} from '../../src/gen/stationTypes';
import {MarketPeople, type MarketPeopleHost} from '../../src/market/marketPeople';
import {MARKET_HUMAN_KEY, MARKET_HUMAN_MODEL_FILES} from '../../src/market/humanLooks';
import {MarketCombat, type MarketCombatHost} from '../../src/market/combat/marketCombat';
import {incomingHit, type PlayerHit, type ResolvedHit} from '../../src/player/hits';
import {armorHit} from '../../src/player/armor';
import {STAND_EYE} from '../../src/player/player';
import {Harness, fixtureCampaign, sid} from './saveFixture';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public');

async function loadGlb(rel: string): Promise<GLTF> {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.read(path.join(ROOT, rel));
  for (const t of doc.getRoot().listTextures()) t.dispose(); // node has no image decoder
  const bin = await io.writeBinary(doc);
  return new Promise<GLTF>((res, rej) => new GLTFLoader().parse(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength) as ArrayBuffer, '', res, rej));
}

export interface CombatAssets { cast: GLTF; guns: Record<string, GLTF> }
let assets: Promise<CombatAssets> | null = null;
/** The cast + the player's three gun models (assets/manifest.ts files), loaded once per test file. */
export function loadCombatAssets(): Promise<CombatAssets> {
  assets ??= (async () => ({
    cast: await loadGlb(MARKET_HUMAN_MODEL_FILES[MARKET_HUMAN_KEY].url),
    guns: {pistol: await loadGlb('assets/models/pistol.glb'), rifle: await loadGlb('assets/models/rifle-user.glb'), shotgun: await loadGlb('assets/models/shotgun-user.glb')},
  }))();
  return assets;
}

export const COMBAT_STATION = sid(3);
const layouts = new Map<number, StationLayout>();

/** A market world + its people + the combat on a save Harness. */
export function combatWorld(a: CombatAssets, seed = 808, o: {harness?: Harness; physics?: MarketCombatHost['physics']} = {}) {
  let layout = layouts.get(seed);
  if (!layout) { layout = generateMarketLevel({levelSeed: seed}); layouts.set(seed, layout); }
  const L = layout;
  const levels = levelsOf(L), pathfinder = new PathFinder(levels), propIndex = new PropIndex(levels, L.props);
  const trainPlacement = playerTrainPlacement(L);
  const h = o.harness ?? new Harness(fixtureCampaign({current: COMBAT_STATION, known: [sid(0), COMBAT_STATION], visited: [sid(0), COMBAT_STATION]}));
  const scene = new THREE.Scene();
  const hits: {raw: PlayerHit; resolved: ResolvedHit; from: [number, number]}[] = [];
  const toasts: string[] = [];
  const sfx = {shots: 0, reloads: 0, confirms: 0, impacts: 0};
  const fx = {flashes: 0, tracers: 0, impacts: 0, blood: 0};
  const player = {x: -999, y: 0, z: -999, eye: STAND_EYE, yaw: 0, radius: 0.3, alive: true, vx: 0, vz: 0, hp: 100,
    takeDamage(n: number) { this.hp = Math.max(0, this.hp - n); if (this.hp <= 0) this.alive = false; }};
  const wearRand = mulberry32(5);
  const host = {
    scene, levels, pathfinder, propIndex, trainPlacement, layout: L,
    get run() { return h.run; },
    player,
    propModels: {get: (k: string) => (k === MARKET_HUMAN_KEY ? a.cast : undefined), catalogue: MARKET_HUMAN_MODEL_FILES},
    assets: {models: a.guns},
    sectionHooks: [] as {build?(l: never): void; teardown?(): void}[], frameHooks: [] as ((dt: number) => void)[], sectionModelKeys: [] as ((l: never) => readonly string[])[],
    zombies: [] as unknown[],
    state: 'playing',
    hud: {toast: (t: string) => { toasts.push(t); }},
    sfx: {hitConfirm: () => { sfx.confirms++; }, impact: () => { sfx.impacts++; }, npcShot: () => { sfx.shots++; }, npcReload: () => { sfx.reloads++; }},
    fx: {bodyHit: () => { fx.blood++; }, impact: () => { fx.impacts++; }, muzzleFlash: () => { fx.flashes++; }, tracer: () => { fx.tracers++; }},
    physics: o.physics ?? null,
    /** Game.gunshotPlayer -> Game.blastPlayer -> Game.applyPlayerHit, line for line (the HUD / shake parts aside). */
    gunshotPlayer(raw: PlayerHit, fromX: number, fromZ: number): ResolvedHit {
      const hit = incomingHit(raw);
      const {resolved} = armorHit(hit, h.inv.gear, wearRand);
      player.takeDamage(resolved.applied);
      hits.push({raw, resolved, from: [fromX, fromZ]});
      return resolved;
    },
    marketPeople: null as unknown as MarketPeople,
  };
  host.marketPeople = new MarketPeople(host as unknown as MarketPeopleHost).install();
  const combat = new MarketCombat(host as unknown as MarketCombatHost).install();
  const build = () => { for (const s of host.sectionHooks) s.build?.(L as never); };
  const teardown = () => { for (const s of host.sectionHooks) s.teardown?.(); };
  const frame = (dt = 1 / 30) => { for (const f of host.frameHooks) f(dt); };
  const run = (seconds: number, dt = 1 / 30) => { for (let t = 0; t < seconds; t += dt) frame(dt); };
  return {layout: L, h, host, people: host.marketPeople, combat, player, hits, toasts, sfx, fx, build, teardown, frame, run};
}

/** A unit ray from `o` toward `p` (and its length). */
export function rayTo(o: THREE.Vector3, p: THREE.Vector3): {o: {x: number; y: number; z: number}; d: {x: number; y: number; z: number}; len: number} {
  const d = p.clone().sub(o), len = d.length();
  d.normalize();
  return {o: {x: o.x, y: o.y, z: o.z}, d: {x: d.x, y: d.y, z: d.z}, len};
}
