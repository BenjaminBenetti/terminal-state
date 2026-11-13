// Task studio-bb-production-20261112-234540-01: QA hooks for a SHORT serial browser spot check of BB, spread into window.__LL by
// qa.ts (only with ?qa=1). Read-only state + positioning helpers and one clearly-labelled DEBUG exception: bbSpawnNear(dist, variant)
// adds ONE BB in front of the player through the normal Game.spawnEnemy path (its lazy look model is fetched first; not remembered
// by the run). Nothing here runs without ?qa=1.

import type {Game} from '../game';
import {archetypeOf} from './creatureArchetypes';
import {rosterOf} from './enemyRoster';
import {BB_ASSET, BB_CADENCE, BB_CLIMB, BB_POUNCE, BB_SENSE, BB_STATS, BB_VARIANTS, BbBrain, bbVariantOf, type BbVariantId} from './bb';
import {BbActor} from './bbActor';

const r3 = (v: number) => Math.round(v * 1000) / 1000;

export function bbQaApi(game: Game, lookAt: (x: number, y: number, z: number) => void, teleport: (x: number, z: number, yaw?: number, level?: number) => boolean) {
  const list = () => game.zombies.map((z, index) => ({z, index})).filter(e => archetypeOf(e.z) === 'bb');
  const levelOf = (x: number, y: number, z: number) => (game.levels.count > 1 ? Math.max(0, game.levels.levelAt(x, z, y + 0.05)) : 0);
  const nearest = (i?: number) => {
    const all = list();
    if (i !== undefined) return all.find(e => e.index === i) ?? null;
    const p = game.player;
    return all.filter(e => e.z.brain.alive).sort((a, b) => Math.hypot(a.z.brain.x - p.x, a.z.brain.z - p.z) - Math.hypot(b.z.brain.x - p.x, b.z.brain.z - p.z))[0] ?? null;
  };
  return {
    /** Live / dead BBs of this section: where the body really is (its pose: surface, phase), what it is doing, its tallies; the layout's roster. */
    bbs: () => {
      const p = game.player;
      return {
        stats: BB_STATS, asset: BB_ASSET, cadence: BB_CADENCE, climb: BB_CLIMB, pounce: BB_POUNCE, sense: BB_SENSE,
        roster: rosterOf(game.layout) ?? null,
        actors: list().map(({z, index}) => {
          const a = z instanceof BbActor ? z : null, b = z.brain instanceof BbBrain ? z.brain : null, P = b?.pose ?? null;
          return {index, x: r3(z.brain.x), y: r3(z.brain.y), z: r3(z.brain.z), hp: r3(z.brain.hp), state: z.brain.state, alive: z.brain.alive,
            dist: r3(Math.hypot(z.brain.x - p.x, z.brain.z - p.z)), rigged: z.hasRig, model: !!a, variant: a?.variant ?? null, clip: a?.clip ?? null, scale: r3(z.scale),
            ragdolled: z.ragdolled, volumes: z.hitVolumes.map(v => v.part), head: z.hitVolumes.some(v => v.part === 'head'),
            body: P ? {x: r3(P.x), y: r3(P.y), z: r3(P.z), up: [r3(P.ux), r3(P.uy), r3(P.uz)], fwd: [r3(P.fx), r3(P.fy), r3(P.fz)], surface: P.surface, phase: P.phase} : null,
            doing: b?.doing ?? null, seeing: b?.seeing ?? false, cooldown: b ? r3(b.cooldown) : null, climbing: b?.climbing ?? false,
            seqs: P ? {cackle: P.cackleSeq, twitch: P.twitchSeq, windup: P.windupSeq, pounce: P.pounceSeq, land: P.landSeq} : null,
            tally: b ? {...b.tally} : null, speed: r3(z.brain.speedCmd)};
        }),
        layoutSpawns: game.layout.zombies.flatMap((s, i) => s.archetype === 'bb' ? [{index: i, variant: bbVariantOf(s)}] : []),
        modelsLoaded: Object.fromEntries(Object.entries(BB_VARIANTS).map(([id, v]) => [id, game.propModels.has(v.model)])),
        fallbacks: game.enemyFallbacks,
      };
    },
    /** QA positioning: stand `dist` m from a BB (nearest living, or index i) on its storey with a clear line to its body, facing it. */
    bbGo: (i?: number, dist = 5) => {
      const e = nearest(i);
      if (!e) return null;
      const b = e.z.brain, p = game.player, lv = levelOf(b.x, b.y, b.z), g = game.levels.grid(lv);
      const at = b instanceof BbBrain ? b.pose : {x: b.x, y: b.y + 0.3, z: b.z};
      for (let k = 0; k < 16; k++) {
        const ang = Math.atan2(p.x - b.x, p.z - b.z) + k * (Math.PI / 8);
        const x = b.x + Math.sin(ang) * dist, z = b.z + Math.cos(ang) * dist;
        if (Math.abs(g.floorAt(x, z) - b.y) > 0.4) continue;
        if (!game.levels.lineOfSight({x, y: b.y + 1.6, z}, {x: at.x, y: at.y, z: at.z})) continue;
        if (!teleport(x, z, undefined, lv)) continue;
        lookAt(at.x, at.y, at.z);
        return {index: e.index, level: lv, dist: r3(Math.hypot(p.x - b.x, p.z - b.z))};
      }
      return null;
    },
    /** DEBUG ONLY: add one BB `dist` m in front of the player (walkable, same storey, in sight) via Game.spawnEnemy. Not in the layout. */
    bbSpawnNear: async (dist = 6, variant: BbVariantId = 'binky') => {
      await game.propModels.ensure([BB_VARIANTS[variant].model]);
      const p = game.player, lv = levelOf(p.x, p.y, p.z), g = game.levels.grid(lv);
      for (let k = 0; k < 16; k++) {
        const ang = p.yaw + Math.PI + (k % 2 ? 1 : -1) * Math.floor((k + 1) / 2) * 0.35; // camera looks along -Z of yaw
        const spot = game.snap(p.x + Math.sin(ang) * dist, p.z + Math.cos(ang) * dist, lv);
        if (!spot || Math.abs(g.floorAt(spot[0], spot[1]) - p.y) > 0.4 || !g.circleClear(spot[0], spot[1], BB_STATS.radius)) continue;
        if (!game.levels.lineOfSight({x: p.x, y: p.eye, z: p.z}, {x: spot[0], y: p.y + 0.3, z: spot[1]})) continue;
        const z = game.spawnEnemy({x: spot[0], z: spot[1], yaw: Math.atan2(p.x - spot[0], p.z - spot[1]), type: 'shambler', area: g.areaAt(spot[0], spot[1]), archetype: 'bb', variant, level: lv, y: g.floorAt(spot[0], spot[1])}, -1);
        return {index: game.zombies.indexOf(z), level: lv, x: r3(spot[0]), z: r3(spot[1]), archetype: archetypeOf(z), model: z instanceof BbActor, variant, fallbacks: game.enemyFallbacks};
      }
      return null;
    },
  };
}
