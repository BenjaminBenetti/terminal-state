// Task reactor-build-20261101 (lane AIR): QA hooks for the lead's short, bounded browser spot check, spread into window.__LL by qa.ts.
// reactorAir() reports the depth gas (zones, clear fractions / stages, the table, the eye exposure, the render term), the
// generators and the HUD line; reactorGoGenerator(id) only PLACES the player at a generator's use point facing its panel (QA
// positioning — the start then goes through the normal hold [E]); reactorStartGenerator(id) is a DEBUG shortcut (as if the hold
// completed now); reactorClearAll(s) is lane RESTART's win clearing; reactorDepthAt(y, x?, z?) samples the depth gas;
// reactorGasTune({...}) edits the depth term's look live (uniform values only, no rebuild).

import {GAS} from '../gas/field';
import type {DepthGasLook} from '../../render/volumetric';
import {reactorAirRuntime} from './generators';

interface QaGame {
  player: {x: number; z: number; y: number; yaw: number; pitch: number; eye: number; place?(x: number, z: number, yaw: number, y?: number): void};
  gas?: {exposure: {c: number; dps: number; protected: boolean; source: string | null; depth?: number}};
  atmosphere?: {active: boolean; depthLook?: DepthGasLook; depthDebug?(): unknown};
  camera?: {updateMatrixWorld(force?: boolean): void};
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;

export function reactorAirQaApi(game: unknown) {
  const g = game as QaGame;
  const rt = () => reactorAirRuntime(game as object);
  return {
    /** Depth gas + generators + HUD line + the render term (null air: not on the Reactor). */
    reactorAir: () => {
      const r = rt(), a = r?.air ?? null, e = g.gas?.exposure;
      const s = a?.stats();
      return {
        reactor: !!a, threshold: GAS.THRESHOLD,
        eye: e ? {c: r3(e.c), depth: r3(e.depth ?? 0), dps: r3(e.dps), protected: e.protected, source: e.source} : null,
        zones: s?.zones.map(z => ({...z, yTop: r3(z.yTop), yBottom: r3(z.yBottom), cTop: r3(z.cTop), cBottom: r3(z.cBottom), clear: r3(z.clear)})) ?? [],
        range: s ? [r3(s.yLo), r3(s.yHi)] : null, tableMax: s ? r3(s.tableMax) : 0, version: s?.version ?? 0, clearingAll: s?.clearingAll ?? false,
        table: a ? Array.from(a.table, r3) : [],
        generators: r?.generators().map(q => ({...q, startedAt: r3(q.startedAt), since: r3(q.since), spool: r3(q.spool)})) ?? [],
        target: r?.target ?? -1, hold: r?.holdProgress ?? null, prompt: r?.prompt() ?? null, hud: r ? {...r.hud.shown} : null, counts: r ? {...r.counts} : null,
        render: g.atmosphere?.depthDebug?.() ?? null,
      };
    },
    /** QA positioning: stand on generator `id`'s use point facing its control panel (start it with the normal hold [E]). */
    reactorGoGenerator: (id = 0) => {
      const r = rt(), gen = r?.info?.generators.find(q => q.id === id);
      if (!r || !gen) return {ok: false, id, reason: r?.info ? 'no such generator' : 'not on the Reactor'};
      const P = g.player, x = gen.use.x, z = gen.use.z;
      const dx = gen.panel.x - x, dz = gen.panel.z - z;
      const yaw = Math.atan2(-dx, -dz);
      if (P.place) P.place(x, z, yaw, gen.y); else { P.x = x; P.z = z; P.y = gen.y; P.yaw = yaw; }
      P.eye = gen.y + 1.62;
      P.pitch = Math.atan2(gen.panel.y - P.eye, Math.hypot(dx, dz));
      g.camera?.updateMatrixWorld(true);
      return {ok: true, id, zone: gen.zone, level: gen.level, stand: [r3(x), r3(gen.y), r3(z)], panel: [r3(gen.panel.x), r3(gen.panel.y), r3(gen.panel.z)], depthAtEye: r3(r.air?.depthGasAt(x, P.eye, z) ?? 0)};
    },
    /** DEBUG: start generator `id` now (as if its hold completed: crank, cue, alert, persisted). */
    reactorStartGenerator: (id = 0) => ({ok: rt()?.start(id, 'qa') ?? false, id}),
    /** Lane RESTART's win clearing: every zone clears over `s` seconds. */
    reactorClearAll: (s?: number) => ({ok: rt()?.clearAll(s) ?? false}),
    /** The depth gas at height y (x / z default: the player's). */
    reactorDepthAt: (y: number, x?: number, z?: number) => r3(rt()?.air?.depthGasAt(x ?? g.player.x, y, z ?? g.player.z) ?? 0),
    /** Live look of the depth term: {ext, scatter, emission, wisps, sheets, sheetXZ, sheetY, tint: [r, g, b] linear}. */
    reactorGasTune: (look: Partial<DepthGasLook> = {}) => {
      const L = g.atmosphere?.depthLook;
      if (!L) return null;
      for (const k of ['ext', 'scatter', 'emission', 'wisps', 'sheets', 'sheetXZ', 'sheetY'] as const) if (typeof look[k] === 'number') L[k] = look[k]!;
      if (Array.isArray(look.tint) && look.tint.length === 3) L.tint = [look.tint[0], look.tint[1], look.tint[2]];
      return {...L, tint: [...L.tint]};
    },
  };
}
