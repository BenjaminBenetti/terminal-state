// Task studio-screacher-production-20261110-221858-01: QA hooks for a SHORT serial browser spot check of THE SCREACHER, spread into
// window.__LL by qa.ts (only with ?qa=1). Read-only state + positioning helpers and clearly-labelled DEBUG exceptions:
// screacherSpawnNear(dist, variant) adds ONE Screacher in front of the player through the normal Game.spawnEnemy path (its lazy variant
// model is fetched first; not remembered by the run), screacherEcho(i, s) brings its next scream forward, screacherNoise(dist, radius)
// raises one world noise at a point in front of the player. Nothing here runs without ?qa=1.

import type {Game} from '../game';
import {archetypeOf} from './creatureArchetypes';
import {rosterOf} from './enemyRoster';
import {SCREACHER_AGGRO, SCREACHER_ASSET, SCREACHER_ECHO, SCREACHER_NOISE, SCREACHER_STATS, SCREACHER_VARIANTS, ScreacherBrain, screacherVariantOf, type ScreacherVariantId} from './screacher';
import {ScreacherActor} from './screacherActor';

const r3 = (v: number) => Math.round(v * 1000) / 1000;

export function screacherQaApi(game: Game, lookAt: (x: number, y: number, z: number) => void, teleport: (x: number, z: number, yaw?: number, level?: number) => boolean) {
  const list = () => game.zombies.map((z, index) => ({z, index})).filter(e => archetypeOf(e.z) === 'screacher');
  const levelOf = (x: number, y: number, z: number) => (game.levels.count > 1 ? Math.max(0, game.levels.levelAt(x, z, y + 0.05)) : 0);
  const nearest = (i?: number) => {
    const all = list();
    if (i !== undefined) return all.find(e => e.index === i) ?? null;
    const p = game.player;
    return all.filter(e => e.z.brain.alive).sort((a, b) => Math.hypot(a.z.brain.x - p.x, a.z.brain.z - p.z) - Math.hypot(b.z.brain.x - p.x, b.z.brain.z - p.z))[0] ?? null;
  };
  return {
    /** Live / dead Screachers of this section: what each BELIEVES, its heat / tier, its echo timer; the layout's roster; noise counters. */
    screachers: () => {
      const p = game.player;
      return {
        stats: SCREACHER_STATS, asset: SCREACHER_ASSET, echo: SCREACHER_ECHO, aggro: SCREACHER_AGGRO, noise: SCREACHER_NOISE,
        roster: rosterOf(game.layout) ?? null,
        actors: list().map(({z, index}) => {
          const a = z instanceof ScreacherActor ? z : null, b = z.brain instanceof ScreacherBrain ? z.brain : null;
          return {index, x: r3(z.brain.x), y: r3(z.brain.y), z: r3(z.brain.z), hp: r3(z.brain.hp), state: z.brain.state, alive: z.brain.alive,
            dist: r3(Math.hypot(z.brain.x - p.x, z.brain.z - p.z)), rigged: z.hasRig, model: !!a, variant: a?.variant ?? null, clip: a?.clip ?? null, scale: r3(z.scale),
            ragdolled: z.ragdolled, volumes: z.hitVolumes.map(v => v.part), head: z.hitVolumes.some(v => v.part === 'head'),
            belief: b?.belief ? {x: r3(b.belief.x), z: r3(b.belief.z), y: r3(b.belief.y), kind: b.belief.kind, age: r3(b.clock - b.belief.t)} : null,
            heat: b ? r3(b.heat) : null, tier: b?.tier ?? null, screaming: b?.screaming ?? false, echoIn: b ? r3(b.echoT) : null,
            screams: b?.screamSeq ?? 0, echoScans: b?.echoScans ?? 0, echoHits: b?.echoHits ?? 0, heard: b?.heard ?? 0, speed: r3(z.brain.speedCmd)};
        }),
        layoutSpawns: game.layout.zombies.flatMap((s, i) => s.archetype === 'screacher' ? [{index: i, variant: screacherVariantOf(s)}] : []),
        modelsLoaded: Object.fromEntries(Object.entries(SCREACHER_VARIANTS).map(([id, v]) => [id, game.propModels.has(v.model)])),
        fallbacks: game.enemyFallbacks, counts: {...game.noiseCounts},
      };
    },
    /** QA positioning: stand `dist` m from a Screacher (nearest living, or index i) on its storey with a clear line to it, facing it. */
    screacherGo: (i?: number, dist = 5) => {
      const e = nearest(i);
      if (!e) return null;
      const b = e.z.brain, p = game.player, lv = levelOf(b.x, b.y, b.z), g = game.levels.grid(lv);
      for (let k = 0; k < 16; k++) {
        const ang = Math.atan2(p.x - b.x, p.z - b.z) + k * (Math.PI / 8);
        const x = b.x + Math.sin(ang) * dist, z = b.z + Math.cos(ang) * dist;
        if (Math.abs(g.floorAt(x, z) - b.y) > 0.4) continue;
        if (!game.levels.lineOfSight({x, y: b.y + 1.6, z}, {x: b.x, y: b.y + 1.4, z: b.z})) continue;
        if (!teleport(x, z, undefined, lv)) continue;
        lookAt(b.x, b.y + 1.3, b.z);
        return {index: e.index, level: lv, dist: r3(Math.hypot(p.x - b.x, p.z - b.z))};
      }
      return null;
    },
    /** DEBUG ONLY: add one Screacher `dist` m in front of the player (walkable, same storey, in sight) via Game.spawnEnemy. Not in the layout. */
    screacherSpawnNear: async (dist = 6, variant: ScreacherVariantId = 'sc01') => {
      await game.propModels.ensure([SCREACHER_VARIANTS[variant].model]);
      const p = game.player, lv = levelOf(p.x, p.y, p.z), g = game.levels.grid(lv);
      for (let k = 0; k < 16; k++) {
        const ang = p.yaw + Math.PI + (k % 2 ? 1 : -1) * Math.floor((k + 1) / 2) * 0.35; // camera looks along -Z of yaw
        const spot = game.snap(p.x + Math.sin(ang) * dist, p.z + Math.cos(ang) * dist, lv);
        if (!spot || Math.abs(g.floorAt(spot[0], spot[1]) - p.y) > 0.4 || !g.circleClear(spot[0], spot[1], SCREACHER_STATS.radius)) continue;
        if (!game.levels.lineOfSight({x: p.x, y: p.eye, z: p.z}, {x: spot[0], y: p.y + 1.4, z: spot[1]})) continue;
        const z = game.spawnEnemy({x: spot[0], z: spot[1], yaw: Math.atan2(p.x - spot[0], p.z - spot[1]), type: 'shambler', area: g.areaAt(spot[0], spot[1]), archetype: 'screacher', variant, level: lv, y: g.floorAt(spot[0], spot[1])}, -1);
        return {index: game.zombies.indexOf(z), level: lv, x: r3(spot[0]), z: r3(spot[1]), archetype: archetypeOf(z), model: z instanceof ScreacherActor, variant, fallbacks: game.enemyFallbacks};
      }
      return null;
    },
    /** DEBUG ONLY: bring a Screacher's next scream forward to `inS` seconds from now (its cadence afterwards is the normal one). */
    screacherEcho: (i?: number, inS = 0.5) => {
      const e = nearest(i), b = e?.z.brain;
      if (!e || !(b instanceof ScreacherBrain)) return null;
      b.echoT = Math.max(0.05, inS);
      return {index: e.index, echoIn: r3(b.echoT)};
    },
    /** DEBUG ONLY: raise one world noise (an 'impact') `dist` m in front of the player with loudness `radius` m; returns the counters. */
    screacherNoise: (dist = 4, radius = 12) => {
      const p = game.player, ang = p.yaw + Math.PI;
      game.worldNoise(p.x + Math.sin(ang) * dist, p.y, p.z + Math.cos(ang) * dist, radius, 'impact');
      return {...game.noiseCounts};
    },
  };
}
