// QA hooks for the iteration-06 damage system (installed by src/qa.ts with ?qa=1 only).
// damage(): bounded-pool stats; aimDamage(type): aim (optionally stand) at a target of a damage
// type for the primary's browser check; qaDamageShot(): DEBUG ONLY — one hit through the real
// damage pipeline at the crosshair (no ammo spent, zombie HP untouched: visuals / pools only).

import * as THREE from 'three';
import type {Game} from '../game';
import {raycastWorld, rayCapsule, raySphere, type Vec3} from '../combat/hitscan';
import {DAMAGE_MATERIALS, STRUCTURAL_CLASS, propDamageSpec, structuralKeyAt} from './materials';
import type {PropPlacement} from '../gen/props';

type LookAt = (x: number, y: number, z: number) => void;
type Teleport = (x: number, z: number, yaw?: number) => boolean;

/** Damage QA target types. */
export const QA_DAMAGE_TYPES = ['wall', 'floor', 'ceiling', 'tile', 'concrete', 'plaster', 'glass', 'crate', 'vending', 'screen', 'carton', 'metal', 'zombie', 'corpse'] as const;

export function damageQaApi(game: Game, lookAt: LookAt, teleport: Teleport) {
  const eye = () => new THREE.Vector3(game.player.x, game.player.eye, game.player.z);
  const propMatch = (type: string) => (p: PropPlacement): boolean => {
    const s = propDamageSpec(p.kind);
    if (type.startsWith('prop:')) return p.kind === type.slice(5);
    switch (type) {
      case 'glass': return s.glass?.on === 'shatter';
      case 'screen': return s.glass?.cls === 'screen';
      case 'crate': return p.kind === 'crate';
      case 'vending': return p.kind === 'vending';
      case 'carton': return p.kind === 'cartonStack';
      case 'metal': return s.cls === 'sheetMetal' && !s.glass;
      default: return false;
    }
  };
  /** Nearest wall (structural class filter) by horizontal rays around the player. */
  const nearestWall = (cls?: string) => {
    const L = game.layout, e = eye();
    let best: {x: number; y: number; z: number; t: number; key: string} | null = null;
    for (let i = 0; i < 48; i++) {
      const a = i / 48 * Math.PI * 2, y = 1.0 + (i % 3) * 0.35;
      const d: Vec3 = {x: Math.sin(a), y: (y - e.y) / 6, z: Math.cos(a)};
      const l = Math.hypot(d.x, d.y, d.z); d.x /= l; d.y /= l; d.z /= l;
      const wh = raycastWorld(L.grid, L.props, e, d, 25, L.trench.floorY);
      if (wh.kind !== 'wall') continue;
      const x = e.x + d.x * wh.t, yy = e.y + d.y * wh.t, z = e.z + d.z * wh.t;
      const key = structuralKeyAt('wall', x, yy, z, wh.nx, wh.nz, {grid: L.grid, areas: L.areas, trenches: L.trenches});
      if (cls && STRUCTURAL_CLASS[key] !== cls) continue;
      if (!best || wh.t < best.t) best = {x, y: yy, z, t: wh.t, key};
    }
    return best;
  };

  const api = {
    /** Damage pools / counters: debris live (by shape), craters, damaged / detached / broken props, wounds per zombie. */
    damage: () => game.damage.stats(game.zombies),
    /**
     * Aim at a target of a damage type ({@link QA_DAMAGE_TYPES} or 'prop:<kind>'); teleport: stand in
     * front of it first. Returns what was aimed at (class, distance, prop index / zombie index).
     */
    aimDamage: (type: string, o: {teleport?: boolean} = {}) => {
      const L = game.layout, p = game.player;
      if (type === 'zombie' || type === 'corpse') {
        const list = game.zombies.map((z, i) => ({z, i})).filter(({z}) => z.brain.alive === (type === 'zombie'));
        list.sort((a, b) => Math.hypot(a.z.brain.x - p.x, a.z.brain.z - p.z) - Math.hypot(b.z.brain.x - p.x, b.z.brain.z - p.z));
        const t = list[0];
        if (!t) return null;
        const hips = t.z.bone('Hips'), at = new THREE.Vector3(t.z.brain.x, (t.z.brain.y ?? 0) + 1.2, t.z.brain.z);
        if (type === 'corpse' && hips) hips.getWorldPosition(at);
        if (o.teleport) { const dx = p.x - at.x, dz = p.z - at.z, d = Math.hypot(dx, dz) || 1; teleport(at.x + dx / d * 3, at.z + dz / d * 3); }
        lookAt(at.x, at.y, at.z);
        return {type, index: t.i, at: {x: at.x, y: at.y, z: at.z}, dist: Math.hypot(at.x - game.player.x, at.z - game.player.z), material: 'flesh'};
      }
      if (['wall', 'tile', 'concrete', 'plaster'].includes(type)) {
        const w = nearestWall(type === 'wall' ? undefined : type);
        if (!w) return null;
        lookAt(w.x, w.y, w.z);
        return {type, at: {x: w.x, y: w.y, z: w.z}, dist: w.t, key: w.key, material: STRUCTURAL_CLASS[w.key as keyof typeof STRUCTURAL_CLASS]};
      }
      if (type === 'floor' || type === 'ceiling') {
        const f = Math.sin(p.yaw), c = Math.cos(p.yaw);
        const x = p.x - f * 2.2, z = p.z - c * 2.2;
        const y = type === 'floor' ? L.grid.floorAt(x, z) : L.grid.ceilAt(x, z);
        lookAt(x, Number.isFinite(y) ? y : 3, z);
        return {type, at: {x, y, z}};
      }
      const match = propMatch(type);
      const cands = L.props.map((q, i) => ({q, i})).filter(({q}) => match(q) && q.h > 0.05);
      cands.sort((a, b) => Math.hypot(a.q.x - p.x, a.q.z - p.z) - Math.hypot(b.q.x - p.x, b.q.z - p.z));
      const t = cands[0];
      if (!t) return null;
      const q = t.q, fx = Math.sin(q.rot), fz = Math.cos(q.rot);
      const quarter = Math.round(q.rot / (Math.PI / 2)) & 1, half = quarter ? q.hx : q.hz;
      if (o.teleport) teleport(q.x + fx * (half + 1.6), q.z + fz * (half + 1.6));
      const at = {x: q.x + fx * half, y: q.y + Math.min(q.h * 0.55, 1.3), z: q.z + fz * half};
      lookAt(at.x, at.y, at.z);
      const st = game.damage.props.states.get(q);
      return {type, index: t.i, kind: q.kind, at, dist: Math.hypot(at.x - game.player.x, at.z - game.player.z), material: propDamageSpec(q.kind).cls,
        hp: st?.hp ?? propDamageSpec(q.kind).integrity, stage: st?.stage ?? 0, broken: st?.broken ?? false, glassBroken: st?.glassBroken ?? false};
    },
    /**
     * DEBUG ONLY (exception to the read-only rule, like qaKillNearest): one hit along the exact view
     * ray through the real damage pipeline — no ammo spent, no zombie HP change (wounds / debris /
     * craters / prop integrity only). weapon 'shotgun' = one pellet's damage.
     */
    qaDamageShot: (weapon: 'rifle' | 'shotgun' = 'rifle') => {
      game.camera.updateMatrixWorld(true);
      const origin = game.camera.getWorldPosition(new THREE.Vector3());
      const dir = game.camera.getWorldDirection(new THREE.Vector3());
      const o: Vec3 = {x: origin.x, y: origin.y, z: origin.z}, d: Vec3 = {x: dir.x, y: dir.y, z: dir.z};
      const L = game.layout;
      const wh = raycastWorld(L.grid, L.props, o, d, 90, L.trench.floorY);
      let bestT = wh.t, bz: (typeof game.zombies)[number] | null = null, part: 'head' | 'torso' | 'limb' = 'torso';
      for (const z of game.zombies) {
        if (!z.brain.alive) continue;
        for (const v of z.hitVolumes) { const t = v.b ? rayCapsule(o, d, v.a, v.b, v.r) : raySphere(o, d, v.a, v.r); if (t < bestT) { bestT = t; bz = z; part = v.part; } }
      }
      const corpse = game.damage.corpseHit(game.zombies, o, d, bestT);
      if (corpse) { bestT = corpse.t; bz = null; }
      game.damage.beginShot();
      const end = origin.clone().addScaledVector(dir, bestT);
      const shot = {damage: weapon === 'shotgun' ? 15 : 24, pellet: weapon === 'shotgun', weapon};
      const info = bz ? game.damage.hitZombie(bz, end, dir, part, shot) : corpse ? game.damage.hitZombie(corpse.z, end, dir, corpse.part, shot, true)
        : wh.kind !== 'none' ? game.damage.hitWorld(wh, end, dir, shot) : null;
      return info ? {...info, t: bestT, cls: DAMAGE_MATERIALS[info.material as keyof typeof DAMAGE_MATERIALS]?.label ?? info.material, stats: game.damage.stats(game.zombies)} : null;
    },
  };
  return api;
}
