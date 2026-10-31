// Task track1-siren-blightbelly-20261031 (lane SIREN): QA hooks for the Siren, spread into window.__LL by qa.ts (only with ?qa=1).
// Read-only state + setup helpers for the primary's short serial browser spot check (go to the nearest Siren outside her 2 m wake
// radius, read her state / wake reason / veins, light her with the flashlight, aim at her). `qaSpawnSiren` / `sirenWake` are DEBUG
// exceptions (an Office section may legitimately hold none, and the Subway never does).

import type {Game} from '../game';
import {archetypeOf} from './creatureArchetypes';
import {SIREN_CLAW, SIREN_STATS, SIREN_WAKE, SirenBrain, sirenBodyPoints, sirenLitBy, type SirenLightProbe} from './siren';
import {SirenActor, SIREN_MODEL_KEY} from './sirenActor';
import {SIREN_HUM_PACE} from './sirenCues';
import {SIREN_LANE} from './sirenSystem';
import {SIREN_VEINS} from '../world/sirenVeins';
import {lureWorld} from './lightLure';

const r2 = (v: number) => Math.round(v * 100) / 100;

export function sirenQaApi(game: Game, lookAt: (x: number, y: number, z: number) => void, teleport: (x: number, z: number, yaw?: number, level?: number) => boolean) {
  const all = () => game.zombies.map((z, index) => ({z, index})).filter(e => archetypeOf(e.z) === 'siren' && e.z.brain instanceof SirenBrain);
  const pick = (i?: number) => {
    const list = all();
    if (i !== undefined) return list.find(e => e.index === i) ?? null;
    const p = game.player;
    return list.filter(e => e.z.brain.alive).sort((a, b) => Math.hypot(a.z.brain.x - p.x, a.z.brain.z - p.z) - Math.hypot(b.z.brain.x - p.x, b.z.brain.z - p.z))[0] ?? list[0] ?? null;
  };
  const info = (z: Game['zombies'][number], index: number) => {
    const b = z.brain as SirenBrain, p = game.player, v = game.sirens.veins.get(z);
    const tracked = game.sirens.list.find(t => t.actor === z);
    return {index, layoutIndex: tracked?.persist ? tracked.index : null, state: b.state, dormant: b.dormant, alive: b.alive, aware: b.aware,
      wakeReason: b.wakeReason, wakeT: r2(b.wakeT), wakes: b.wakes, screams: b.screams, hp: r2(b.hp), maxHp: b.stats.hp,
      at: {x: r2(b.x), y: r2(b.y), z: r2(b.z)}, yaw: r2(b.yaw), playerDist: r2(Math.hypot(p.x - b.x, p.z - b.z)), playerDy: r2(p.y - b.y),
      clip: z instanceof SirenActor ? z.clip : null, rigged: z.hasRig, riseS: r2(b.riseS), attackElapsed: r2(b.attackElapsed),
      speed: r2(b.speedCmd), lightChecks: b.lightChecks, lightRays: b.lightRays, wakeLight: b.wakeLight, humT: r2(z.groanT),
      veins: v ? {cells: v.footprint.cells.length, level: v.footprint.level, floor: r2(v.footprint.floor), fade: r2(v.fade), fading: v.fading} : null};
  };
  const api = {
    /** Every Siren of the live section: state, wake reason / time, screams, hp, clip, veins, flashlight checks. */
    sirens: () => all().map(({z, index}) => info(z, index)),
    /** System view: model loaded, skipped spawns, remembered awake indices, vein patches, tuning. */
    sirenSystem: () => ({
      model: !!game.propModels.get(SIREN_MODEL_KEY), skippedHere: game.sirens.skippedHere, skippedTotal: game.sirens.skippedTotal,
      recordedWakes: game.sirens.recordedWakes, store: game.run.laneStore(SIREN_LANE) ?? null, layoutSirens: game.layout.zombies.filter(s => s.archetype === 'siren').length,
      veins: {patches: game.sirens.veins.count, ...game.sirens.veins.stats}, tuning: {stats: SIREN_STATS, wake: SIREN_WAKE, claw: SIREN_CLAW, hum: SIREN_HUM_PACE, veins: SIREN_VEINS},
    }),
    /**
     * QA-only setup: stand `dist` m (default 4, i.e. outside the 2 m wake radius) from a Siren (nearest living / index i) on her
     * storey with a clear sight line. `face`: look at her (WITH THE TORCH ON THIS WAKES HER within ~0.1 s) — default false: face away.
     */
    goSiren: (i?: number, dist = 4, face = false) => {
      const e = pick(i);
      if (!e) return null;
      const b = e.z.brain, L = game.levels;
      const level = Math.max(0, L.levelAt(b.x, b.z, b.y + 0.05));
      for (let k = 0; k < 16; k++) {
        const ang = b.yaw + k * (Math.PI / 8);
        const x = b.x + Math.sin(ang) * dist, z = b.z + Math.cos(ang) * dist;
        const s = L.supportIn(x, z, b.y + 0.05);
        if (!s || s.level !== level || Math.abs(s.floor - b.y) > 0.3) continue;
        if (!L.lineOfSight({x, y: s.floor + 1.5, z}, {x: b.x, y: b.y + 0.5, z: b.z})) continue;
        if (!teleport(x, z, undefined, level)) continue;
        const p = game.player;
        if (face) lookAt(b.x, b.y + 0.45, b.z);
        else { p.yaw = Math.atan2(-(b.x - p.x), -(b.z - p.z)) + Math.PI; p.pitch = 0; } // back to her (lookAt's yaw + pi)
        return {...info(e.z, e.index), player: {x: r2(p.x), y: r2(p.y), z: r2(p.z)}, dist: r2(Math.hypot(p.x - b.x, p.z - b.z)), facing: face, torch: game.flashlightOn};
      }
      return null;
    },
    /** Aim the view at her torso sample point (the flashlight follows the view: with the torch on, the next check wakes her). */
    sirenLight: (i?: number) => {
      const e = pick(i);
      if (!e) return null;
      const [pt] = sirenBodyPoints(e.z.brain, (e.z.brain as SirenBrain).bodyScale);
      lookAt(pt.x, pt.y, pt.z);
      return {index: e.index, at: {x: r2(pt.x), y: r2(pt.y), z: r2(pt.z)}, torch: game.flashlightOn};
    },
    /** Per light / body point: range, beam cone, lens-to-point ray (casts every ray; the current registry, 1 frame old). */
    sirenProbe: (i?: number) => {
      const e = pick(i);
      if (!e) return null;
      const b = e.z.brain as SirenBrain, probes: SirenLightProbe[] = [];
      const lit = sirenLitBy(b, game.lightSources.attracting(), lureWorld(game.levels, game.lightSources).seePoint, b.bodyScale, undefined, probes);
      return {index: e.index, state: b.state, lit: lit?.id ?? null, probes: probes.map(p => ({...p, dist: r2(p.dist), range: r2(p.range), cos: r2(p.cos)}))};
    },
    /** Aim at a Siren's body part volume ('torso' | 'head' | 'limb'). */
    aimSiren: (i?: number, part: 'torso' | 'head' | 'limb' = 'torso') => {
      const e = pick(i);
      const v = e?.z.hitVolumes.find(h => h.part === part);
      if (!e || !v) return null;
      const at = v.b ? {x: (v.a.x + v.b.x) / 2, y: (v.a.y + v.b.y) / 2, z: (v.a.z + v.b.z) / 2} : v.a;
      lookAt(at.x, at.y, at.z);
      return {index: e.index, part, at};
    },
    /** DEBUG ONLY: wake a dormant Siren now (reason 'qa'; the scream plays on the next frame). */
    sirenWake: (i?: number) => {
      const e = pick(i);
      return e ? (e.z.brain as SirenBrain).wake('qa') : false;
    },
    /**
     * DEBUG ONLY: add one Siren `dist` m in front of the player (same storey, sight line), dormant by default, facing the player.
     * Needs her model loaded (an Office section with a Siren placed, or one fetched earlier); null otherwise. Never persisted.
     */
    qaSpawnSiren: (dist = 5) => {
      if (!game.propModels.get(SIREN_MODEL_KEY)) return null;
      const p = game.player, L = game.levels;
      for (let k = 0; k < 16; k++) {
        const ang = p.yaw + Math.PI + (k % 2 ? 1 : -1) * Math.floor((k + 1) / 2) * 0.35; // camera looks along -Z of yaw
        const x = p.x + Math.sin(ang) * dist, z = p.z + Math.cos(ang) * dist;
        const s = L.supportIn(x, z, p.y + 0.05);
        if (!s || s.volume || Math.abs(s.floor - p.y) > 0.3 || !L.lineOfSight({x: p.x, y: p.eye, z: p.z}, {x, y: s.floor + 0.5, z}) || !L.circleClear(x, z, 0.32, s.floor)) continue;
        const z0 = game.spawnEnemy({x, z, yaw: Math.atan2(p.x - x, p.z - z), type: 'shambler', area: s.area, archetype: 'siren', level: s.level, y: s.floor}, game.zombies.length);
        return {index: game.zombies.indexOf(z0), x: r2(x), z: r2(z), archetype: archetypeOf(z0), state: z0.brain.state};
      }
      return null;
    },
  };
  return api;
}
