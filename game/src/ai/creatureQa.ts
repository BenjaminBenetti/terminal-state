// Iteration 07 (Lane Q): QA hooks for the rat/dog creature, spread into window.__LL by qa.ts (only with
// ?qa=1). Read-only state + aim/teleport helpers; `qaSpawnCreature` is a DEBUG exception (adds one
// rat/dog spawn near the player for the browser check — stations may legitimately have none).

import type {Game} from '../game';
import {archetypeOf} from './creatureArchetypes';
import {CreatureActor} from './creatureActor';
import {ENEMY_POOL} from './creatureSpawn';

export function creatureQaApi(game: Game, lookAt: (x: number, y: number, z: number) => void, teleport: (x: number, z: number, yaw?: number) => boolean) {
  const creatures = () => game.zombies.map((z, index) => ({z, index})).filter(e => archetypeOf(e.z) !== 'zombie');
  const nearest = (i?: number) => {
    const list = creatures();
    if (i !== undefined) return list.find(e => e.index === i) ?? null;
    const p = game.player;
    return list.filter(e => e.z.brain.alive).sort((a, b) => Math.hypot(a.z.brain.x - p.x, a.z.brain.z - p.z) - Math.hypot(b.z.brain.x - p.x, b.z.brain.z - p.z))[0] ?? list[0] ?? null;
  };
  const api = {
    /** Every non-zombie enemy with its state, clip and hit volumes. */
    creatures: () => creatures().map(({z, index}) => {
      const c = z instanceof CreatureActor ? z : null;
      const head = z.hitVolumes.find(v => v.part === 'head');
      return {index, archetype: archetypeOf(z), x: z.brain.x, y: z.brain.y, z: z.brain.z, yaw: z.brain.yaw, hp: z.brain.hp, state: z.brain.state, alive: z.brain.alive, aware: z.brain.aware,
        clip: c?.clip ?? null, attackElapsed: c ? c.brain.attackElapsed : null, ragdolled: z.ragdolled, rigged: z.hasRig, scale: z.scale, volumes: z.hitVolumes.length,
        head: head ? head.a : null, stats: z.brain.stats};
    }),
    /** Archetype mix of the current station (layout spawn tags vs built actors) and the pool weights. */
    enemyMix: () => {
      const by: Record<string, number> = {};
      for (const z of game.zombies) by[archetypeOf(z)] = (by[archetypeOf(z)] ?? 0) + 1;
      return {total: game.zombies.length, byArchetype: by, layout: game.layout.zombies.map(s => s.archetype ?? 'zombie'), fallbacks: game.enemyFallbacks, pool: ENEMY_POOL};
    },
    /** Teleport the player `dist` m from a creature (nearest living, or index i), facing it. */
    goCreature: (i?: number, dist = 3.2) => {
      const e = nearest(i);
      if (!e) return null;
      const b = e.z.brain, p = game.player;
      for (let k = 0; k < 12; k++) {
        const ang = Math.atan2(p.x - b.x, p.z - b.z) + k * (Math.PI / 6);
        const x = b.x + Math.sin(ang) * dist, z = b.z + Math.cos(ang) * dist;
        if (Math.abs(game.layout.grid.floorAt(x, z) - b.y) > 0.4 || !game.layout.grid.lineOfSight(x, z, b.x, b.z)) continue;
        if (!teleport(x, z)) continue;
        lookAt(b.x, b.y + 0.3, b.z);
        return {index: e.index, creature: {x: b.x, y: b.y, z: b.z}, player: {x: p.x, z: p.z}, dist: Math.hypot(p.x - b.x, p.z - b.z)};
      }
      return null;
    },
    /** Aim at a creature's body part volume ('torso' | 'head' | 'limb'). */
    aimCreature: (i?: number, part: 'torso' | 'head' | 'limb' = 'torso') => {
      const e = nearest(i);
      const v = e?.z.hitVolumes.find(h => h.part === part);
      if (!e || !v) return null;
      const at = v.b ? {x: (v.a.x + v.b.x) / 2, y: (v.a.y + v.b.y) / 2, z: (v.a.z + v.b.z) / 2} : v.a;
      lookAt(at.x, at.y, at.z);
      return {index: e.index, part, at};
    },
    /**
     * DEBUG ONLY: add one rat/dog spawn `dist` m in front of the player (walkable, same level),
     * facing the player. Returns its enemy index (the station's own ~5 % draw is unchanged).
     */
    qaSpawnCreature: (dist = 5) => {
      const p = game.player, g = game.layout.grid;
      for (let k = 0; k < 16; k++) {
        const ang = p.yaw + Math.PI + (k % 2 ? 1 : -1) * Math.floor((k + 1) / 2) * 0.35; // camera looks along -Z of yaw
        const spot = game.snap(p.x + Math.sin(ang) * dist, p.z + Math.cos(ang) * dist);
        if (!spot || Math.abs(g.floorAt(spot[0], spot[1]) - p.y) > 0.4 || !g.lineOfSight(p.x, p.z, spot[0], spot[1]) || !g.circleClear(spot[0], spot[1], 0.3)) continue;
        const z = game.spawnEnemy({x: spot[0], z: spot[1], yaw: Math.atan2(p.x - spot[0], p.z - spot[1]), type: 'shambler', area: g.areaAt(spot[0], spot[1]), archetype: 'ratdog'}, game.zombies.length);
        return {index: game.zombies.indexOf(z), x: spot[0], z: spot[1], archetype: archetypeOf(z)};
      }
      return null;
    },
  };
  return api;
}
