// Task reactor-build-20261101 (lane RESTART): QA hooks for THE RESTART, spread into window.__LL by qa.ts (only with ?qa=1), for the
// lead's single short serial browser spot check:
//   __LL.reactorRestart()                    state, tasks, controls (at / stand / done), screens, target / prompt, hold, win, light
//                                            circuit, objective line, counters, visuals / air registration, cue registration
//   __LL.reactorGoControl(id)                stand at a control's stand pose and look at it (then E / hold E works for real)
//   __LL.reactorControl(id, {give: true})    operate a control through the real rules (no aim / hold time); `give` = DEBUG: add the
//                                            part it needs first ('fuse-0' / 'fuse-1' / 'keyswitch')
//   __LL.reactorWinFinish()                  jump a running win sequence to its end state

import type {Game} from '../../game';
import {reactorRestartOf} from './restart';
import {reactorMapBoardsOf} from './mapBoard';

export function reactorRestartQaApi(game: Game, lookAt: (x: number, y: number, z: number) => void, teleport: (x: number, z: number, yaw?: number, level?: number) => boolean) {
  const rt = () => reactorRestartOf(game);
  return {
    reactorRestart: () => rt()?.qa() ?? {reactor: false, installed: false},
    reactorGoControl: (id: string): {ok: boolean; why?: string} => {
      const r = rt(), e = r?.controls.find(x => x.id === id);
      if (!r || !e) return {ok: false, why: r?.info ? `no control '${id}' in this layout` : 'not on the Reactor'};
      const ok = teleport(e.c.stand.x, e.c.stand.z, e.c.stand.yaw, e.c.stand.level);
      lookAt(e.m.pick.x, e.m.pick.y, e.m.pick.z); // (task reactor-expansion-20261101, lane CONTROLS: the control mounted on its host face)
      return {ok};
    },
    // task reactor-expansion-20261101 (lane CONTROLS): the floor-map boards (placement, markers, target, counters) and a walk-up:
    // stand 0.9 m in front of the map board beside `screen` (default the pit board) looking at its face
    reactorMaps: () => reactorMapBoardsOf(game)?.qa() ?? {installed: false},
    reactorGoMap: (screen = 'pitBoard'): {ok: boolean; why?: string} => {
      const b = reactorMapBoardsOf(game)?.boards.find(q => q.pose.screen === screen);
      if (!b) return {ok: false, why: `no map board beside '${screen}'`};
      const p = b.pose, ok = teleport(p.x + p.nx * 0.9, p.z + p.nz * 0.9, Math.atan2(p.nx, p.nz), p.level);
      lookAt(p.x, p.y, p.z);
      return {ok};
    },
    reactorControl: (id: string, opts: {give?: boolean} = {}): {ok: boolean; why?: string} => {
      const r = rt();
      if (!r?.info) return {ok: false, why: 'not on the Reactor'};
      const give = opts.give ? (itemId: string) => { game.inv.add(game.inv.makeStack(itemId, 1)); } : undefined;
      return r.qaOperate(id, give);
    },
    reactorWinFinish: (): boolean => rt()?.qaFinishWin() ?? false,
  };
}
