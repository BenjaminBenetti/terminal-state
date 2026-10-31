// Task track3-eaton-centre-20261031 (lane HORDE): QA hooks for the roaming hordes, spread into window.__LL by qa.ts (?qa=1 only).
//   hordes()                    — every group: phase, storey, anchor, patrol node / target, lag, legs, roster (leader / followers /
//                                 engaged / returning / detached / dead) with each member's state and slot error; placement record
//   goHorde({group, ahead, look}) — QA SETUP ONLY (not behaviour proof): stand on group `group`'s storey `ahead` m (default 22) in
//                                 front of its anchor along its patrol (its next node, else the nearest node ahead), facing it —
//                                 then watch it approach, step aside / retreat to avoid it, or shoot to see members break formation
//   hordeKillCheck()            — the run memory's view: initial members per group, killed (remembered), alive now (persistence)
// Read-only except the setup teleport.

import type {Game} from '../game';
import {HORDE_AI} from './horde';

const r2 = (v: number) => Math.round(v * 100) / 100;

export function hordeQaApi(game: Game, lookAt: (x: number, y: number, z: number) => void, teleport: (x: number, z: number, yaw?: number, level?: number) => boolean) {
  const api = {
    /** Every roaming group and its members (null: this level has no hordes). */
    hordes: () => {
      const H = game.hordes, p = game.player;
      if (!H) return {hordes: false, placed: game.layout?.hordes?.length ?? 0};
      return {
        hordes: true, placed: game.layout.hordes?.length ?? 0, time: r2(H.time),
        counters: {thinks: H.thinks, alertsCalled: H.alertsCalled, callsHeard: H.callsHeard, groansAllowed: H.groansAllowed, groansDeferred: H.groansDeferred},
        player: {x: r2(p.x), y: r2(p.y), z: r2(p.z)},
        groups: H.summary({x: p.x, y: p.y, z: p.z}),
        tuning: HORDE_AI,
      };
    },
    /** QA setup: stand `ahead` m in front of group `group` on its patrol, looking at it. */
    goHorde: (o: {group?: number; ahead?: number; look?: boolean} = {}) => {
      const H = game.hordes;
      if (!H) return {ok: false, why: 'no hordes in this level'};
      const live = H.groups.filter(g => g.phase !== 'dead');
      const g = o.group !== undefined ? H.groups[o.group] : live[0];
      if (!g || g.phase === 'dead') return {ok: false, why: 'no living group with that id'};
      const ahead = o.ahead ?? 22;
      const lv = game.levels.levelAt(g.ax, g.az, g.ay + 0.05);
      // candidate points: the patrol nodes on the anchor's storey, scored by being ~`ahead` m away in the heading direction
      const hx = Math.sin(g.heading), hz = Math.cos(g.heading);
      let best: {x: number; z: number; s: number} | null = null;
      for (const n of game.layout.mall?.patrol ?? []) {
        if (n.level !== lv) continue;
        const dx = n.x - g.ax, dz = n.z - g.az, d = Math.hypot(dx, dz);
        const fwd = (dx * hx + dz * hz) / (d || 1);
        const s = Math.abs(d - ahead) - fwd * 8 + (n.id === g.target ? -6 : 0);
        if (!best || s < best.s) best = {x: n.x, z: n.z, s};
      }
      const at = best ?? {x: g.ax + hx * ahead, z: g.az + hz * ahead};
      const snap = game.snap(at.x, at.z, lv);
      if (!snap) return {ok: false, why: 'no walkable point near the chosen spot'};
      // camera yaw convention: forward = (-sin yaw, -cos yaw) -> face the anchor
      const yaw = Math.atan2(-(g.ax - snap[0]), -(g.az - snap[1]));
      const ok = teleport(snap[0], snap[1], yaw, lv);
      if (ok && o.look !== false) lookAt(g.ax, g.ay + 1.4, g.az);
      return {ok, group: g.spec.id, level: lv, at: {x: r2(snap[0]), z: r2(snap[1])}, anchor: {x: r2(g.ax), y: r2(g.ay), z: r2(g.az)},
        dist: r2(Math.hypot(g.ax - snap[0], g.az - snap[1])), alive: g.members.filter(m => m.brain.alive).length,
        hint: 'watch __LL.hordes() each second: the anchor walks toward / past you; step out of sight to avoid, or fire to see members break formation'};
    },
    /** Persistence view: initial members, remembered kills and the living members per group. */
    hordeKillCheck: () => {
      const L = game.layout, mem = game.run.peekMemory(game.run.current);
      const killed = new Set(mem?.killed ?? []);
      return (L?.hordes ?? []).map(h => ({
        id: h.id, initial: h.members.length, killedRemembered: h.members.filter(i => killed.has(i)).length,
        aliveNow: game.hordes?.groups[h.id]?.members.filter(m => m.brain.alive).length ?? 0,
        phase: game.hordes?.groups[h.id]?.phase ?? 'none',
      }));
    },
  };
  return api;
}
