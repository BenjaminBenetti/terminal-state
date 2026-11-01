// Task studio-alpha-beyond-station-round4-20261101-01 (lane FAMILY): QA hooks for the primary's SHORT serial browser spot check of
// THE STRAINER, spread into window.__LL by qa.ts (only with ?qa=1). Read-only state + positioning helpers and ONE clearly-labelled
// DEBUG exception: strainerSpawnNear(dist) adds ONE Strainer `dist` m in front of the player (same storey) through the normal
// Game.spawnEnemy path (its lazy model is fetched first) — not remembered by the run (no layout index). Without the model it is the
// counted zombie stand-in (createEnemyActor's fallback: `model: false`, `fallbacks` counts it).

import type {Game} from '../game';
import {archetypeOf} from './creatureArchetypes';
import {StrainerActor} from './strainerActor';
import {STRAINER_ASSET, STRAINER_STATS} from './strainer';
import {SERVICE_FAMILY_POOL, spawnContextOf, spawnProfile} from './spawnTables';

const r3 = (v: number) => Math.round(v * 1000) / 1000;

export function strainerQaApi(game: Game, lookAt: (x: number, y: number, z: number) => void, teleport: (x: number, z: number, yaw?: number, level?: number) => boolean) {
  const list = () => game.zombies.map((z, index) => ({z, index})).filter(e => archetypeOf(e.z) === 'strainer');
  const levelOf = (x: number, y: number, z: number) => (game.levels.count > 1 ? Math.max(0, game.levels.levelAt(x, z, y + 0.05)) : 0);
  const nearest = (i?: number) => {
    const all = list();
    if (i !== undefined) return all.find(e => e.index === i) ?? null;
    const p = game.player;
    return all.filter(e => e.z.brain.alive).sort((a, b) => Math.hypot(a.z.brain.x - p.x, a.z.brain.z - p.z) - Math.hypot(b.z.brain.x - p.x, b.z.brain.z - p.z))[0] ?? null;
  };
  return {
    /** Live / dead Strainers of this section, the layout's Strainer spawns (all in 'service' context), model state and fallbacks. */
    strainers: () => {
      const p = game.player, P = spawnProfile(game.run.current.level);
      return {
        stats: STRAINER_STATS, asset: STRAINER_ASSET, servicePool: SERVICE_FAMILY_POOL,
        actors: list().map(({z, index}) => {
          const a = z instanceof StrainerActor ? z : null;
          const head = z.hitVolumes.find(v => v.part === 'head');
          return {index, x: r3(z.brain.x), y: r3(z.brain.y), z: r3(z.brain.z), hp: r3(z.brain.hp), state: z.brain.state, alive: z.brain.alive,
            dist: r3(Math.hypot(z.brain.x - p.x, z.brain.z - p.z)), rigged: z.hasRig, model: !!a, clip: a?.clip ?? null, scale: r3(z.scale),
            ragdolled: z.ragdolled, volumes: z.hitVolumes.length, head: head ? {y: r3(head.a.y - z.brain.y), r: r3(head.r)} : null};
        }),
        layoutSpawns: game.layout.zombies.flatMap((s, i) => s.archetype === 'strainer' ? [{index: i, context: spawnContextOf(game.layout, P, i) ?? null}] : []),
        modelLoaded: game.propModels.has('enemy_strainer'), fallbacks: game.enemyFallbacks,
      };
    },
    /** QA positioning: stand `dist` m from a Strainer (nearest living, or index i) on its storey with sight of it, facing it. */
    strainerGo: (i?: number, dist = 5) => {
      const e = nearest(i);
      if (!e) return null;
      const b = e.z.brain, p = game.player, lv = levelOf(b.x, b.y, b.z), g = game.levels.grid(lv);
      for (let k = 0; k < 16; k++) {
        const ang = Math.atan2(p.x - b.x, p.z - b.z) + k * (Math.PI / 8);
        const x = b.x + Math.sin(ang) * dist, z = b.z + Math.cos(ang) * dist;
        if (Math.abs(g.floorAt(x, z) - b.y) > 0.4) continue;
        if (!game.levels.lineOfSight({x, y: b.y + 1.6, z}, {x: b.x, y: b.y + 1.4, z: b.z})) continue;
        if (!teleport(x, z, undefined, lv)) continue;
        lookAt(b.x, b.y + 1.4, b.z);
        return {index: e.index, level: lv, dist: r3(Math.hypot(p.x - b.x, p.z - b.z))};
      }
      return null;
    },
    /** Aim at a Strainer's hit volume ('head' | 'torso' | 'limb') — then shoot with the normal input. */
    strainerAim: (i?: number, part: 'head' | 'torso' | 'limb' = 'head') => {
      const e = nearest(i);
      const v = e?.z.hitVolumes.find(h => h.part === part);
      if (!e || !v) return null;
      const at = v.b ? {x: (v.a.x + v.b.x) / 2, y: (v.a.y + v.b.y) / 2, z: (v.a.z + v.b.z) / 2} : v.a;
      lookAt(at.x, at.y, at.z);
      return {index: e.index, part, at: {x: r3(at.x), y: r3(at.y), z: r3(at.z)}};
    },
    /** DEBUG ONLY: add one Strainer `dist` m in front of the player (walkable, same storey, in sight) via Game.spawnEnemy. Not in the layout. */
    strainerSpawnNear: async (dist = 5) => {
      await game.propModels.ensure(['enemy_strainer']);
      const p = game.player, lv = levelOf(p.x, p.y, p.z), g = game.levels.grid(lv);
      for (let k = 0; k < 16; k++) {
        const ang = p.yaw + Math.PI + (k % 2 ? 1 : -1) * Math.floor((k + 1) / 2) * 0.35; // camera looks along -Z of yaw
        const spot = game.snap(p.x + Math.sin(ang) * dist, p.z + Math.cos(ang) * dist, lv);
        if (!spot || Math.abs(g.floorAt(spot[0], spot[1]) - p.y) > 0.4 || !g.circleClear(spot[0], spot[1], STRAINER_STATS.radius)) continue;
        if (!game.levels.lineOfSight({x: p.x, y: p.eye, z: p.z}, {x: spot[0], y: p.y + 1.4, z: spot[1]})) continue;
        const z = game.spawnEnemy({x: spot[0], z: spot[1], yaw: Math.atan2(p.x - spot[0], p.z - spot[1]), type: 'shambler', area: g.areaAt(spot[0], spot[1]), archetype: 'strainer', level: lv, y: g.floorAt(spot[0], spot[1])}, game.zombies.length);
        return {index: game.zombies.indexOf(z), level: lv, x: r3(spot[0]), z: r3(spot[1]), archetype: archetypeOf(z), model: z instanceof StrainerActor, fallbacks: game.enemyFallbacks};
      }
      return null;
    },
  };
}
