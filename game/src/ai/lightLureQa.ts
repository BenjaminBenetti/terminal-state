// Iteration 12 (AI lane): QA hooks for "light attracts enemies", spread into window.__LL by qa.ts (only with ?qa=1).
//   lightLure()                 — attracting lights + every enemy investigating one (index, target, distance, state, phase, speed)
//   lureProbe(i?)               — why enemy i (default: nearest alive) does / does not notice each light (range, cone, FOV, LOS)
//   goLureVantage({index, dist, ahead}) — QA setup only: stand `dist` m from an idle / wandering enemy (beyond its sight range,
//                                 in its view, same storey, clear 3D sight) aiming at a floor point `ahead` m in front of it
//   DEBUG qaLureLight({...}) / qaLureLightSet(id, {...}) — a stand-in omni light in the registry for checking the AI on its
//                                 own (the real flare / flashlight come from the light lane; prefer those for the browser check)
// Read-only except the two DEBUG helpers and the setup teleport.

import type {Game} from '../game';
import {archetypeOf} from './creatureArchetypes';
import {LURE, LURE_EYE, lureRange, lureWorld, probeLights} from './lightLure';
import type {LightSource} from '../world/lightSources';

const r2 = (v: number) => Math.round(v * 100) / 100;
const pt = (p: {x: number; y: number; z: number}) => ({x: r2(p.x), y: r2(p.y), z: r2(p.z)});

export function lightLureQaApi(game: Game, lookAt: (x: number, y: number, z: number) => void, teleport: (x: number, z: number, yaw?: number, level?: number) => boolean) {
  const see = () => lureWorld(game.levels, game.lightSources).seePoint;
  const nearestAlive = (i?: number) => {
    if (i !== undefined) return game.zombies[i] ? i : -1;
    const p = game.player;
    let best = -1, bd = Infinity;
    game.zombies.forEach((z, k) => { const d = Math.hypot(z.brain.x - p.x, z.brain.z - p.z); if (z.brain.alive && d < bd) { bd = d; best = k; } });
    return best;
  };
  const api = {
    /** Attracting lights and every enemy currently investigating one (also mid-climb on the way). */
    lightLure: () => {
      const p = game.player;
      const investigating = game.zombies.map((z, index) => ({z, index})).filter(e => e.z.brain.alive && e.z.brain.lure).map(({z, index}) => {
        const b = z.brain, l = b.lure!;
        return {index, archetype: archetypeOf(z), state: b.state, phase: l.phase, light: {id: l.lightId, kind: l.kind, part: l.part},
          target: pt(l), goal: {x: r2(l.gx), y: r2(l.gy), z: r2(l.gz)}, at: {x: r2(b.x), y: r2(b.y), z: r2(b.z)},
          dist: r2(Math.hypot(l.x - b.x, l.z - b.z)), playerDist: r2(Math.hypot(p.x - b.x, p.z - b.z)), lostFor: r2(b.t - l.seenT), investigatingFor: r2(b.t - l.startT),
          speed: r2(b.speedCmd), wanderSpeed: b.stats.wanderSpeed, chaseSpeed: b.stats.chaseSpeed, aware: b.aware};
      });
      const by = (ph: string) => investigating.filter(e => e.phase === ph).length;
      return {
        lights: game.lightSources.list.map(s => ({id: s.id, kind: s.kind, active: s.active, intensity: r2(s.intensity), attractRange: s.attractRange, lureRange: r2(lureRange(s)),
          at: pt(s), spot: s.spot ? pt(s.spot) : null, level: s.level ?? null, qa: !!(s as {qa?: boolean}).qa})),
        attracting: game.lightSources.attracting().filter(s => lureRange(s) > 0).length,
        investigating,
        counts: {investigating: investigating.length, approach: by('approach'), hold: by('hold'), linger: by('linger'),
          chasing: game.zombies.filter(z => z.brain.alive && (z.brain.state === 'chase' || z.brain.state === 'attack')).length, alive: game.zombies.filter(z => z.brain.alive).length},
        totals: {starts: game.zombies.reduce((n, z) => n + z.brain.lureStarts, 0), checks: game.zombies.reduce((n, z) => n + z.brain.lureChecks, 0)},
        tuning: LURE,
      };
    },
    /** Per-light perception checks for enemy `i` (default: nearest living enemy): range, beam cone, self, field of view, 3D sight. */
    lureProbe: (i?: number) => {
      const k = nearestAlive(i);
      const z = game.zombies[k];
      if (!z) return null;
      const b = z.brain;
      // (lane LURE, refinement batch 2026-11-13: a followed lure SCENT's id is an emitter id, not a light id — game.scents.qa())
      const light = b.lure && b.lure.kind !== 'scent' ? b.lure.lightId : null;
      return {index: k, archetype: archetypeOf(z), state: b.state, aware: b.aware, yaw: r2(b.yaw), eye: {x: r2(b.x), y: r2(b.y + LURE_EYE), z: r2(b.z)},
        tracking: light, scent: b.lure?.kind === 'scent' ? b.lure.lightId : null,
        lights: probeLights(b, game.lightSources.list, see(), b.state === 'investigate' ? light : null)};
    },
    /**
     * QA-only setup (not behaviour proof): stand `dist` m (default: the enemy's sight range + 4) from a living idle / wandering enemy
     * (`index`, default the nearest suitable), on its storey, in front of it, with clear 3D sight between the eyes, aiming at a floor
     * point `ahead` m (default 6) in front of it toward the player. Turning the flashlight on then lands its spot there (spot lure);
     * aiming at the enemy shows its lens (emitter lure, if the flashlight's lure range reaches); walking within its sight range shows
     * the player priority (chase).
     */
    goLureVantage: (o: {index?: number; dist?: number; ahead?: number} = {}) => {
      const L = game.levels;
      const cands = o.index !== undefined ? [o.index] : game.zombies.map((_, k) => k).filter(k => ['idle', 'wander'].includes(game.zombies[k].brain.state))
        .sort((a, b) => Math.hypot(game.zombies[a].brain.x - game.player.x, game.zombies[a].brain.z - game.player.z) - Math.hypot(game.zombies[b].brain.x - game.player.x, game.zombies[b].brain.z - game.player.z));
      for (const k of cands) {
        const z = game.zombies[k];
        if (!z || !z.brain.alive) continue;
        const b = z.brain, lv = L.levelAt(b.x, b.z, b.y + 0.05);
        const dist = o.dist ?? b.stats.sightRange + 4;
        for (let s = 0; s < 24; s++) {
          // fan out from straight ahead of the enemy, alternating sides
          const ang = b.yaw + (s % 2 ? 1 : -1) * Math.ceil(s / 2) * (Math.PI / 12);
          const spot = game.snap(b.x + Math.sin(ang) * dist, b.z + Math.cos(ang) * dist, Math.max(0, lv));
          if (!spot) continue;
          const sup = L.supportAt(spot[0], spot[1], b.y + 0.5);
          if (!sup || sup.level !== lv || Math.abs(sup.floor - b.y) > 1.2) continue;
          const d = Math.hypot(spot[0] - b.x, spot[1] - b.z);
          if (d <= b.stats.sightRange + 0.5) continue;
          if (!L.lineOfSight({x: spot[0], y: sup.floor + 1.6, z: spot[1]}, {x: b.x, y: b.y + LURE_EYE, z: b.z})) continue;
          if (!teleport(spot[0], spot[1], undefined, Math.max(0, lv))) continue;
          const ahead = Math.min(o.ahead ?? 6, d - 2);
          const ux = (spot[0] - b.x) / d, uz = (spot[1] - b.z) / d;
          const aim = {x: b.x + ux * ahead, y: b.y + 0.05, z: b.z + uz * ahead};
          lookAt(aim.x, aim.y, aim.z);
          const p = game.player;
          return {index: k, archetype: archetypeOf(z), enemy: {x: r2(b.x), y: r2(b.y), z: r2(b.z), state: b.state, sightRange: b.stats.sightRange}, stand: pt(p), dist: r2(Math.hypot(p.x - b.x, p.z - b.z)), aimSpot: pt(aim),
            hint: 'flashlight on (F): its spot lands `ahead` m in front of the enemy (within the 20 m spot range) -> lightLure() lists it investigating (phase approach -> hold, speed = wander x 1.2); ' +
              'walk inside its sightRange: chase (player priority); flashlight off: linger at the spot -> wander; a thrown flare (28 m) near it does the same and gathers it'};
        }
      }
      return null;
    },
    /**
     * DEBUG ONLY (exception to the read-only rule): add a stand-in omni light ("flare", tagged qa) to the registry `ahead` m in
     * front of the player on the floor (or at x / y / z), with attract range `range` (default 30). Returns its id.
     */
    qaLureLight: (o: {x?: number; y?: number; z?: number; ahead?: number; range?: number; intensity?: number} = {}) => {
      const p = game.player;
      let x = o.x, y = o.y, z = o.z;
      if (x === undefined || z === undefined) {
        const a = o.ahead ?? 8;
        const s = game.snap(p.x - Math.sin(p.yaw) * a, p.z - Math.cos(p.yaw) * a, Math.max(0, game.levels.levelAt(p.x, p.z, p.y + 0.05)));
        if (!s) return null;
        [x, z] = s;
      }
      if (y === undefined) y = (game.levels.supportAt(x, z, p.y + 0.5)?.floor ?? p.y) + 0.05;
      const init = {kind: 'flare' as const, active: true, x, y, z, level: game.levels.levelAt(x, z, y + 0.05), dir: null, cosHalfAngle: 1, spot: {x, y, z}, attractRange: o.range ?? 30, intensity: o.intensity ?? 1};
      const s = game.lightSources.add({...init, qa: true} as typeof init);
      return {id: s.id, at: pt(s)};
    },
    /** DEBUG ONLY: switch / move / remove a stand-in light added by qaLureLight (`remove: true` deletes it). */
    qaLureLightSet: (id: number, o: {active?: boolean; x?: number; y?: number; z?: number; remove?: boolean} = {}) => {
      const s = game.lightSources.list.find(q => q.id === id && (q as LightSource & {qa?: boolean}).qa);
      if (!s) return null;
      if (o.remove) { game.lightSources.remove(s); return {id, removed: true}; }
      if (o.active !== undefined) s.active = o.active;
      if (o.x !== undefined) s.x = o.x;
      if (o.y !== undefined) s.y = o.y;
      if (o.z !== undefined) s.z = o.z;
      s.spot = {x: s.x, y: s.y, z: s.z};
      return {id, active: s.active, at: pt(s)};
    },
  };
  return api;
}
