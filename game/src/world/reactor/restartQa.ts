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

export function reactorRestartQaApi(game: Game, lookAt: (x: number, y: number, z: number) => void, teleport: (x: number, z: number, yaw?: number, level?: number) => boolean) {
  const rt = () => reactorRestartOf(game);
  return {
    reactorRestart: () => rt()?.qa() ?? {reactor: false, installed: false},
    reactorGoControl: (id: string): {ok: boolean; why?: string} => {
      const r = rt(), e = r?.controls.find(x => x.id === id);
      if (!r || !e) return {ok: false, why: r?.info ? `no control '${id}' in this layout` : 'not on the Reactor'};
      const ok = teleport(e.c.stand.x, e.c.stand.z, e.c.stand.yaw, e.c.stand.level);
      lookAt(e.c.at.x, e.c.at.y, e.c.at.z);
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
