// Task studio-surface-run-opus-rebuild-20261116-020827-01 (lane ACCESS): QA hooks of the Surface Run crossing — `__LL.surface` (qa.ts):
//   access()            the section's way (host: layout.surfaceAccess; district: the portal) + whether the player is at it
//   go()                stand in the way's [E] box looking at its door / portal (teleport; QA setup, not traversal proof)
//   cross(dir?)         Game.crossSurface() ('up' / 'down' must match the section's way, else refused) -> its result
//   refusal()           why a crossing would be refused now (null: it would start)
//   state()             current key, the crossing in flight + counters, the train record / placement, the resident level resources,
//                       district objects in the scene (userData.surface / names 'surface-*'), the access door meshes, frame hooks
//   find(level, from?, to?)  the first campaign-free level seed in [from, to) whose station rolls a Surface Run (for dev starts)
// Task studio-surface-run-field-followup-20261116-211729-01 (lane ACCESS), version 2 (the cargo lift ride; world/surface/liftRuntime.ts):
//   lift()              the ride: phase ('idle' | 'closing' | 'travel' | 'waiting' | 'opening' | 'reopening'), doors, travel, ready /
//                       reposed, whether the player is held in the car, the drawn site / held end, the car's y (null: no lift here)
//   liftGo()            go() for a lift way: stand in the car facing its gate (false: this section's way is not a lift)
//   ride(dir?)          liftGo() then cross(dir): the ride itself (refused when this section's way is not a lift)
//   tent()              the district's command tent: rect, door, the flap's state (t / target / gas source running), the player inside
//                       the tent / the car, the eye's gas exposure (null: not in a district)
// Task studio-surface-host-ground-connectors-20261118-053602-01, version 2 Office / Mall (the walked connector tube;
// world/surface/connectorRuntime.ts):
//   connector()         the tube: phase ('idle' | 'crossing'), held / flaps / ready / reposed / armed / refusal / sealed, the tube-local pose,
//                       this world's record, counters (null: no connector here)
//   connectorGo(back?)  stand on this world's walk-in side just outside the tube's take zone, facing into it (back: s metres further out;
//                       teleport — QA setup; the walk itself is real input)

import type {Game} from '../../game';
import {SURFACE_SECTION, isSurfaceKey, surfacePresent, SURFACE_VERSION, type SurfaceHost} from '../../gen/surface/surfaceRun';
import {surfaceAccessOf} from './accessRuntime';
import type {SurfaceCrossResult} from './crossing';
import {surfaceLiftOf} from './liftRuntime';
import {surfaceConnectorOf} from './connectorRuntime';
import {connectorToWorld} from '../../gen/surface/connectorShape';
import {surfaceAirRuntime} from './air';

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
  const goWay = (): boolean => {
    const w = rt()?.way;
    if (!w) return false;
    const t = w.trigger, cx = (t.x0 + t.x1) / 2, cz = (t.z0 + t.z1) / 2;
    const L = game.layout?.surfaceAccess?.returnPose ?? game.layout?.surface?.portal.pose;
    const yaw = Math.atan2(-(w.focus.x - cx), -(w.focus.z - cz));
    const ok = teleport(cx, cz, yaw, L?.level ?? 0);
    rt()?.frame();
    return ok;
  };
  const cross = (dir?: 'up' | 'down'): Promise<SurfaceCrossResult> => {
    const up = !isSurfaceKey(game.run.current);
    if (dir && (dir === 'up') !== up) return Promise.resolve({ok: false, reason: 'no-access', error: `No way ${dir} from here.`});
    return game.crossSurface();
  };
  const liftHere = (): boolean => !!surfaceLiftOf(game)?.site && rt()?.way?.inside === true;
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
    go: goWay,
    cross,
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
    lift: () => surfaceLiftOf(game)?.qa() ?? null,
    connector: () => surfaceConnectorOf(game)?.qa() ?? null,
    connectorGo: (back = 1.2): boolean => {
      const c = surfaceConnectorOf(game)?.record();
      if (!c || surfaceConnectorOf(game)?.holding) return false;
      const host = c.end === 'host', s = host ? -c.door.depth - back : c.len + back;
      const [x, z] = connectorToWorld(c, s, 0);
      // facing into the tube: +s from the host side (yaw = the record's), -s from the tent side
      const ok = teleport(x, z, host ? c.yaw : c.yaw + Math.PI, c.level);
      rt()?.frame();
      return ok;
    },
    liftGo: (): boolean => liftHere() && goWay(),
    ride: (dir?: 'up' | 'down'): Promise<SurfaceCrossResult> => {
      if (!liftHere() || !goWay()) return Promise.resolve({ok: false, reason: 'no-access', error: 'No cargo lift here.'});
      return cross(dir);
    },
    tent: () => {
      const S = game.layout?.surface;
      if (!S) return null;
      const t = S.checkpoint.tent, P = game.player, l = S.portal.lift;
      const flap = surfaceAirRuntime()?.air?.doors.find(d => d.plan.tent) ?? null;
      const inRect = (r: {x0: number; z0: number; x1: number; z1: number}) => P.x > r.x0 && P.x < r.x1 && P.z > r.z0 && P.z < r.z1;
      return {
        rect: {...t.rect}, door: {...t.door}, portal: S.portal.kind,
        flap: flap ? {t: flap.t, target: flap.target, gas: flap.gas, width: flap.plan.width, a: flap.plan.a, c: flap.plan.c} : null,
        player: {x: P.x, z: P.z, inTent: inRect(t.rect), inCar: !!l && inRect(l.cab)},
        exposure: game.gas?.exposure?.c ?? null,
      };
    },
  };
}
