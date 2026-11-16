// Task studio-surface-run-opus-rebuild-20261116-020827-01 (lane ACCESS): QA hooks of the Surface Run crossing — `__LL.surface` (qa.ts):
//   access()            the section's way (host: layout.surfaceAccess; district: the portal) + whether the player is at it
//   go()                stand in the way's [E] box looking at its door / portal (teleport; QA setup, not traversal proof)
//   cross(dir?)         Game.crossSurface() ('up' / 'down' must match the section's way, else refused) -> its result
//   refusal()           why a crossing would be refused now (null: it would start)
//   state()             current key, the crossing in flight + counters, the train record / placement, the resident level resources,
//                       district objects in the scene (userData.surface / names 'surface-*'), the access door meshes, frame hooks
//   find(level, from?, to?)  the first campaign-free level seed in [from, to) whose station rolls a Surface Run (for dev starts)

import type {Game} from '../../game';
import {SURFACE_SECTION, isSurfaceKey, surfacePresent, SURFACE_VERSION, type SurfaceHost} from '../../gen/surface/surfaceRun';
import {surfaceAccessOf} from './accessRuntime';
import type {SurfaceCrossResult} from './crossing';

type Teleport = (x: number, z: number, yaw?: number, level?: number) => boolean;

export function surfaceAccessQaApi(game: Game, teleport: Teleport) {
  const rt = () => surfaceAccessOf(game);
  const sceneCounts = () => {
    let district = 0, doors = 0, objects = 0;
    game.scene?.traverse(o => {
      objects++;
      if (o.userData?.surface || o.name.startsWith('surface-') && !o.userData?.surfaceAccess) district++;
      if (o.userData?.surfaceAccess && (o as {isMesh?: boolean}).isMesh) doors++;
    });
    return {objects, district, accessDoorMeshes: doors};
  };
  return {
    access: () => {
      const r = rt(), w = r?.way;
      const L = game.layout;
      return {
        installed: !!r, section: {...game.run.current}, way: w ? {...w, trigger: {...w.trigger}, focus: {...w.focus}} : null, aimed: r?.aimed ?? false,
        access: L?.surfaceAccess ? structuredClone(L.surfaceAccess) : null,
        portal: L?.surface ? structuredClone(L.surface.portal) : null,
        prompt: r?.prompt() ?? null,
      };
    },
    go: (): boolean => {
      const w = rt()?.way;
      if (!w) return false;
      const t = w.trigger, cx = (t.x0 + t.x1) / 2, cz = (t.z0 + t.z1) / 2;
      const L = game.layout?.surfaceAccess?.returnPose ?? game.layout?.surface?.portal.pose;
      const yaw = Math.atan2(-(w.focus.x - cx), -(w.focus.z - cz));
      const ok = teleport(cx, cz, yaw, L?.level ?? 0);
      rt()?.frame();
      return ok;
    },
    cross: (dir?: 'up' | 'down'): Promise<SurfaceCrossResult> => {
      const up = !isSurfaceKey(game.run.current);
      if (dir && (dir === 'up') !== up) return Promise.resolve({ok: false, reason: 'no-access', error: `No way ${dir} from here.`});
      return game.crossSurface();
    },
    refusal: () => game.surfaceCrossRefusal(),
    state: () => ({
      current: {...game.run.current}, isSurface: isSurfaceKey(game.run.current), state: game.state,
      crossing: game.surfaceCrossing ? {...game.surfaceCrossing} : null, counts: {...game.surfaceCrossCounts}, runtime: rt() ? {...rt()!.counts} : null,
      train: {at: game.playerTrain.state.at ? {...game.playerTrain.state.at} : null, placement: !!game.trainPlacement},
      resources: game.levelResources.summary(),
      scene: sceneCounts(),
      frameHooks: game.frameHooks.length,
      memories: game.run.memoryIds().filter(k => k.endsWith(`:${SURFACE_SECTION}`)),
    }),
    find: (level: SurfaceHost, from = 1, to = 2000): number | null => {
      for (let s = from; s < to; s++) if (surfacePresent(level, s, SURFACE_VERSION)) return s;
      return null;
    },
  };
}
