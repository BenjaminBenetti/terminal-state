// Task track1-siren-blightbelly-20261031 (lane BLIGHT): QA hooks for the primary's SHORT serial browser spot check, spread into
// window.__LL by qa.ts (only with ?qa=1). Read-only state + positioning helpers, and two clearly-labelled DEBUG exceptions:
//  - blightSpawnNear(dist): adds ONE Blightbelly `dist` m in front of the player (any level, same storey) through the normal
//    Game.spawnEnemy path (its lazy model is fetched first) — not remembered by the run (no layout index);
//  - blightKill(i): kills the nearest living Blightbelly as if shot from the player (brain.damage + the normal ragdoll) — the
//    burst then runs through the real path. Shooting it with the normal input is the preferred check.
// blight() reports the live Blightbellies, the burst counters / last bursts (blast distance / visible fraction / damage /
// applied, pops, puff, audio) and the gas exposure (eye c, the puffs' part, dps, protected) + live puffs.

import * as THREE from 'three';
import type {Game} from '../game';
import {archetypeOf} from './creatureArchetypes';
import {BlightbellyActor} from './blightbellyActor';
import {BLIGHTBELLY_BURST, BLIGHTBELLY_STATS} from './blightbelly';
import {PUFF} from '../world/gas/puff';
import {GAS} from '../world/gas/field';
import {killImpulseStrength} from '../physics/world';

const r3 = (v: number) => Math.round(v * 1000) / 1000;

export function blightbellyQaApi(game: Game, lookAt: (x: number, y: number, z: number) => void, teleport: (x: number, z: number, yaw?: number, level?: number) => boolean) {
  const list = () => game.zombies.map((z, index) => ({z, index})).filter(e => archetypeOf(e.z) === 'blightbelly');
  const levelOf = (x: number, y: number, z: number) => (game.levels.count > 1 ? Math.max(0, game.levels.levelAt(x, z, y + 0.05)) : 0);
  const nearest = (i?: number) => {
    const all = list();
    if (i !== undefined) return all.find(e => e.index === i) ?? null;
    const p = game.player;
    return all.filter(e => e.z.brain.alive).sort((a, b) => Math.hypot(a.z.brain.x - p.x, a.z.brain.y - p.y, a.z.brain.z - p.z) - Math.hypot(b.z.brain.x - p.x, b.z.brain.y - p.y, b.z.brain.z - p.z))[0] ?? null;
  };
  const exposure = () => {
    const e = game.gas.exposure;
    return {eye: r3(e.c), puff: r3(e.puff ?? 0), dps: r3(e.dps), protected: e.protected, damage: r3(e.damage), source: e.source, threshold: GAS.THRESHOLD,
      puffs: game.gas.puffs.stats().map(p => ({id: p.id, level: p.level, x: r3(p.x), z: r3(p.z), age: r3(p.age), phase: p.phase, max: r3(p.max), over012: p.over012, sourceCells: p.sourceCells})),
      puffCounts: {...game.gas.puffs.counts}};
  };
  const api = {
    /** Live / dead Blightbellies of this section, the burst counters, the last bursts and the gas exposure. */
    blight: () => {
      const p = game.player;
      return {
        stats: BLIGHTBELLY_STATS, burst: BLIGHTBELLY_BURST, puff: PUFF,
        actors: list().map(({z, index}) => {
          const a = z instanceof BlightbellyActor ? z : null;
          return {index, x: r3(z.brain.x), y: r3(z.brain.y), z: r3(z.brain.z), level: levelOf(z.brain.x, z.brain.y, z.brain.z), hp: r3(z.brain.hp), state: z.brain.state,
            alive: z.brain.alive, dist: r3(Math.hypot(z.brain.x - p.x, z.brain.y - p.y, z.brain.z - p.z)), rigged: z.hasRig, model: !!a, clip: a?.clip ?? null,
            popped: a?.popped ?? false, ragdolled: z.ragdolled, volumes: z.hitVolumes.length, scale: r3(z.scale)};
        }),
        layoutSpawns: game.layout.zombies.filter(s => s.archetype === 'blightbelly').length,
        modelLoaded: game.propModels.has('enemy_blightbelly'), fallbacks: game.enemyFallbacks,
        counts: {...game.blight.counts}, pending: game.blight.pending, bursts: game.blight.log.map(r => ({...r})),
        player: {x: r3(p.x), y: r3(p.y), z: r3(p.z), hp: r3(p.hp), alive: p.alive},
        gas: exposure(),
      };
    },
    /** QA positioning: stand `dist` m from a Blightbelly (nearest living, or index i) on its storey with sight of it, facing it. */
    blightGo: (i?: number, dist = 6) => {
      const e = nearest(i);
      if (!e) return null;
      const b = e.z.brain, p = game.player, lv = levelOf(b.x, b.y, b.z), g = game.levels.grid(lv);
      for (let k = 0; k < 16; k++) {
        const ang = Math.atan2(p.x - b.x, p.z - b.z) + k * (Math.PI / 8);
        const x = b.x + Math.sin(ang) * dist, z = b.z + Math.cos(ang) * dist;
        if (Math.abs(g.floorAt(x, z) - b.y) > 0.4) continue;
        if (!game.levels.lineOfSight({x, y: b.y + 1.6, z}, {x: b.x, y: b.y + 1.2, z: b.z})) continue;
        if (!teleport(x, z, undefined, lv)) continue;
        lookAt(b.x, b.y + 1.0, b.z);
        return {index: e.index, level: lv, blightbelly: {x: r3(b.x), y: r3(b.y), z: r3(b.z)}, player: {x: r3(p.x), y: r3(p.y), z: r3(p.z)}, dist: r3(Math.hypot(p.x - b.x, p.z - b.z))};
      }
      return null;
    },
    /** Aim at a Blightbelly's belly (the torso volume nearest its centre) — then shoot with the normal input. */
    blightAim: (i?: number) => {
      const e = nearest(i);
      const vols = e?.z.hitVolumes.filter(v => v.part === 'torso') ?? [];
      const v = vols.find(h => !h.b) ?? vols[0];
      if (!e || !v) return null;
      const at = v.b ? {x: (v.a.x + v.b.x) / 2, y: (v.a.y + v.b.y) / 2, z: (v.a.z + v.b.z) / 2} : v.a;
      lookAt(at.x, at.y, at.z);
      return {index: e.index, at: {x: r3(at.x), y: r3(at.y), z: r3(at.z)}};
    },
    /**
     * DEBUG ONLY: add one Blightbelly `dist` m in front of the player (walkable, same storey, in sight), facing the player, via
     * Game.spawnEnemy (its lazy model fetched first). Not part of the layout / run memory.
     */
    blightSpawnNear: async (dist = 5) => {
      await game.propModels.ensure(['enemy_blightbelly']);
      const p = game.player, lv = levelOf(p.x, p.y, p.z), g = game.levels.grid(lv);
      for (let k = 0; k < 16; k++) {
        const ang = p.yaw + Math.PI + (k % 2 ? 1 : -1) * Math.floor((k + 1) / 2) * 0.35; // camera looks along -Z of yaw
        const spot = game.snap(p.x + Math.sin(ang) * dist, p.z + Math.cos(ang) * dist, lv);
        if (!spot || Math.abs(g.floorAt(spot[0], spot[1]) - p.y) > 0.4 || !g.circleClear(spot[0], spot[1], BLIGHTBELLY_STATS.radius)) continue;
        if (!game.levels.lineOfSight({x: p.x, y: p.eye, z: p.z}, {x: spot[0], y: p.y + 1.2, z: spot[1]})) continue;
        const z = game.spawnEnemy({x: spot[0], z: spot[1], yaw: Math.atan2(p.x - spot[0], p.z - spot[1]), type: 'shambler', area: g.areaAt(spot[0], spot[1]), archetype: 'blightbelly', level: lv, y: g.floorAt(spot[0], spot[1])}, game.zombies.length);
        return {index: game.zombies.indexOf(z), level: lv, x: r3(spot[0]), z: r3(spot[1]), archetype: archetypeOf(z), model: z instanceof BlightbellyActor};
      }
      return null;
    },
    /** DEBUG ONLY: kill the nearest living Blightbelly (or index i) as if shot from the player (rifle impulse); the burst follows. */
    blightKill: (i?: number) => {
      const e = nearest(i);
      if (!e || !e.z.brain.alive) return null;
      const p = game.player, b = e.z.brain;
      const point = new THREE.Vector3(b.x, b.y + 1.0, b.z), dir = new THREE.Vector3(b.x - p.x, b.y + 1.0 - p.eye, b.z - p.z).normalize();
      const killed = b.damage(b.hp + 1, p.x, p.z, p.y);
      const ragdoll = killed ? game.physics.ragdoll(e.z, {dir, point, strength: killImpulseStrength('rifle', 1, 1)}) : false;
      return {index: e.index, killed, ragdoll, at: {x: r3(b.x), y: r3(b.y), z: r3(b.z)}, dist: r3(Math.hypot(b.x - p.x, b.z - p.z))};
    },
    /** Gas exposure at the eye (the puffs' part included) and the live puffs. */
    blightGas: () => exposure(),
  };
  return api;
}
