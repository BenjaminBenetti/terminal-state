// Task gasmask-breach-20261030 (lane GAS): QA hooks for short, bounded browser spot checks, spread into window.__LL by qa.ts.
// windows() lists the panes; windowAim(id) only PLACES the player (QA positioning, like the tower's go* helpers) in the room in
// front of a pane and aims the view at it — the shots are then fired through the normal input / Game.fire path (each ray's real
// damage counts against the pane's health, PANE_MAX_HP); windowBreak(id) is a DEBUG shortcut (as if its last damage landed now).
// gas() reports the exposure at the eye (breach field / the roof's outside air) and per gassed storey; gasTune() edits the gas
// term's look live (uniform values only, no rebuild). Task track1-siren-blightbelly-20261031 (lane BLIGHT): gas() also lists
// the temporary local puffs (Blightbelly death clouds) and their part of the eye concentration.

import type {GasSystem} from './system';
import {GAS} from './field';
import {PANE_MAX_HP, paneCentre} from '../windowBreach';
import type {GasLook} from '../../render/volumetric';

interface QaGame {
  gas: GasSystem;
  player: {x: number; z: number; y: number; yaw: number; pitch: number; eye: number; vy: number; grounded: boolean; climb: unknown; vx?: number; vz?: number};
  levels?: {grid(level: number): {floorAt(x: number, z: number): number}};
  camera: {updateMatrixWorld(force?: boolean): void; position?: {set(x: number, y: number, z: number): unknown}; rotation?: {set(x: number, y: number, z: number, order?: string): unknown; order?: string}};
  atmosphere?: {active: boolean; gasLook?: GasLook; gasDebug?(): unknown};
  readonly clock?: number;
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;

export function gasQaApi(game: unknown) {
  const g = game as QaGame;
  const sys = () => g.gas;
  return {
    /** Every breakable pane per storey: id, state (intact / cracked / broken), counted hits, centre on the glass, room normal. */
    windows: (level?: number) => {
      const W = sys().windows;
      if (!W) return {office: false, panes: []};
      const panes = [...W.refs.values()].filter(r => level === undefined || r.plan.level === level).map(r => {
        const s = W.state.get(r.id), c = paneCentre(r);
        const state = s?.broken ? 'broken' : (s?.damage ?? 0) > 0 || r.pane.state === 'cracked' ? 'cracked' : 'intact';
        return {id: r.id, level: r.plan.level, side: r.plan.span.side, state, generated: r.pane.state, damage: r3(s?.damage ?? 0), hp: r3(PANE_MAX_HP - (s?.damage ?? 0)), maxHp: PANE_MAX_HP, centre: [r3(c.x), r3(c.y), r3(c.z)], normal: [c.nx, c.nz]};
      });
      const perStorey: Record<number, number> = {};
      for (const p of panes) perStorey[p.level] = (perStorey[p.level] ?? 0) + 1;
      return {office: true, count: panes.length, perStorey, panes};
    },
    /**
     * QA positioning: stand on the pane's storey `dist` m into the room in front of it (default 1.6) and aim at its centre (a
     * point `offset` m along it, default 0). Shoot it with the normal input afterwards.
     */
    windowAim: (id: string, dist = 1.6, offset = 0) => {
      const ref = sys().windows?.refs.get(id);
      if (!ref) return {ok: false, id, reason: 'no such breakable pane'};
      const c = paneCentre(ref), p = ref.plan, P = g.player;
      const ax = p.along === 'x' ? offset : 0, az = p.along === 'x' ? 0 : offset;
      const sx = c.x + c.nx * (dist + Math.abs(p.glass - p.inner)) + ax, sz = c.z + c.nz * (dist + Math.abs(p.glass - p.inner)) + az;
      const y = g.levels?.grid(p.level).floorAt(sx, sz) ?? p.baseY;
      P.x = sx; P.z = sz; P.y = y; P.vy = 0; P.grounded = true; P.climb = null;
      if (P.vx !== undefined) P.vx = 0;
      if (P.vz !== undefined) P.vz = 0;
      P.eye = y + 1.62;
      const tx = c.x + ax, tz = c.z + az, dx = tx - P.x, dz = tz - P.z;
      P.yaw = Math.atan2(-dx, -dz);
      P.pitch = Math.atan2(c.y - P.eye, Math.hypot(dx, dz));
      g.camera.position?.set(P.x, P.eye, P.z);
      if (g.camera.rotation) { g.camera.rotation.order = 'YXZ'; g.camera.rotation.set(P.pitch, P.yaw, 0); }
      g.camera.updateMatrixWorld(true);
      return {ok: true, id, stand: [r3(P.x), r3(y), r3(P.z)], target: [r3(tx), r3(c.y), r3(tz)], distance: r3(Math.hypot(dx, dz, c.y - P.eye))};
    },
    /** DEBUG: break a pane now (shards, burst, cue, gas — as from its third impact). */
    windowBreak: (id: string) => ({ok: sys().breakPane(id), id}),
    /**
     * Gas state: the eye concentration, protected, dps, total gas damage, per gassed storey: active cells, max, mean of the
     * breach rooms' pool cells, cells over 0.15, asleep, active box; the tuning; the volumetric layers.
     */
    gas: () => {
      const s = sys(), f = s.field, e = s.exposure;
      return {
        office: !!f, eye: r3(e.c), protected: e.protected, dps: r3(e.dps), damage: r3(e.damage), threshold: GAS.THRESHOLD, dpsMax: GAS.DPS_MAX,
        source: e.source, outdoor: r3(e.outdoor), roof: !!s.roof, roofOutdoorC: GAS.ROOF_OUTDOOR_C,
        volumetric: g.atmosphere?.active ?? false, ticks: f?.ticks ?? 0, counts: {...s.counts}, hud: {...s.hud.shown},
        storeys: f ? f.storeys.map(st => { const x = st.stats(); return {...x, max: r3(x.max), poolMean: r3(x.poolMean)}; }) : [],
        // task track1-siren-blightbelly-20261031 (lane BLIGHT): the temporary local puffs (any level) and their part of the eye c
        puff: r3(e.puff ?? 0), puffs: s.puffs.stats().map(p => ({...p, x: r3(p.x), z: r3(p.z), age: r3(p.age), max: r3(p.max)})), puffCounts: {...s.puffs.counts},
        layers: g.atmosphere?.gasDebug?.() ?? null,
      };
    },
    /** Live look of the gas term: {ext, scatter, emission, noise, tint: [r, g, b] linear}. Returns the current look. */
    gasTune: (look: Partial<GasLook> = {}) => {
      const L = g.atmosphere?.gasLook;
      if (!L) return null;
      for (const k of ['ext', 'scatter', 'emission', 'noise'] as const) if (typeof look[k] === 'number') L[k] = look[k]!;
      if (Array.isArray(look.tint) && look.tint.length === 3) L.tint = [look.tint[0], look.tint[1], look.tint[2]];
      return {...L, tint: [...L.tint]};
    },
  };
}
