// Task studio-reactor-surface-ending-20261102 (lane ENDING): __LL.reactorEnding(cmd) — the surface exit's QA for the lead's serial spot
// checks. QA-only setup (not traversal proof): force the clear-complete state, open the doors, skip the message, stand at a named pose.
//   __LL.reactorEnding()                              the report: phase (doors / announced / surfaced), sealed, the message phase + t,
//                                                     the objective stage line, the prompt, door / stair / exit / plaza poses
//   __LL.reactorEnding({online: true})                the restart chain (parts given), the win finished, the pit air cleared: the doors
//                                                     open on the next frame through the REAL trigger, the centre message starts
//   __LL.reactorEnding({open: true, skipMessage})     open the doors now (the event), optionally dock the message at once
//   __LL.reactorEnding({go: 'door' | 'stairs' | 'top' | 'exit' | 'hole'})
//                                                     stand 2.2 m in front of the door / at the stair foot / at the stair head / 2 m out
//                                                     of the exit on the plaza / at the opening's parapet looking down at the core

import type {Game} from '../../game';
import {reactorEndingOf} from './ending';
import {reactorRestartOf} from './restart';
import {reactorAirRuntime} from './generators';
import {RESTART_CONTROL_IDS} from './restartLogic';

export type EndingPose = 'door' | 'stairs' | 'top' | 'exit' | 'hole';

export function reactorEndingQaApi(game: Game, lookAt: (x: number, y: number, z: number) => void, teleport: (x: number, z: number, yaw?: number, level?: number) => boolean) {
  return {
    reactorEnding: (cmd: {online?: boolean; open?: boolean; skipMessage?: boolean; go?: EndingPose} = {}): object => {
      const e = reactorEndingOf(game), s = e?.surface;
      if (!e || !s) return {installed: !!e, surface: false};
      if (cmd.online) {
        const r = reactorRestartOf(game);
        if (r?.info && !r.state?.restarted) {
          const give = (itemId: string) => { game.inv.add(game.inv.makeStack(itemId, 1)); };
          for (const id of RESTART_CONTROL_IDS) r.qaOperate(id, give);
        }
        r?.qaFinishWin();
        reactorAirRuntime(game)?.clearAll(0.05); // the pit air: cleared within a frame (the trigger then fires by itself)
      }
      if (cmd.open || cmd.skipMessage) e.qaOpen(!!cmd.skipMessage);
      if (cmd.go) {
        const d = s.door, ex = s.exit, fx = -Math.sin(ex.yaw), fz = -Math.cos(ex.yaw);
        if (cmd.go === 'door') { teleport(d.x + d.nx * 2.2, d.z + d.nz * 2.2, Math.atan2(d.nx, d.nz), d.level); lookAt(d.x, d.y + 1.4, d.z); }
        else if (cmd.go === 'stairs') teleport(s.stairs.bottom.x, s.stairs.bottom.z, undefined, s.stairs.bottom.level);
        else if (cmd.go === 'top') teleport(s.stairs.top.x, s.stairs.top.z, undefined, s.stairs.top.level);
        else if (cmd.go === 'exit') teleport(ex.x + fx * 2, ex.z + fz * 2, ex.yaw, s.level);
        else {
          const h = s.hole, ax = ex.x - h.x, az = ex.z - h.z, L = Math.hypot(ax, az) || 1, R = h.keepR + 0.9;
          const px = h.x + ax / L * R, pz = h.z + az / L * R;
          teleport(px, pz, Math.atan2(ax, az), s.level);
          const c = e.info!.core;
          lookAt(c.x, c.y1, c.z);
        }
      }
      return e.qa();
    },
  };
}
