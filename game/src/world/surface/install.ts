// Task studio-surface-run-opus-rebuild-20261116-020827-01 (primary): SURFACE RUN's runtime installs, in order (Game constructor, after the
// GAS / Bunker installs and before the player train's — the train's build rebuilds game.propIndex over everything already there):
//  - ACCESS (world/surface/accessRuntime.ts): the [E] way up / out and back, prompts; the crossing itself is Game.crossSurface.
//  - LOOK (world/surface/look.ts): the district's streets, facades, roofs, far city, daylight / sky / mood, culling and warm-up.
//  - AIR (world/surface/air.ts): outdoor gas (visible green fog = exposure), building openings / doors, the truck cab's protection.
//  - LIFE (world/surface/life.ts): the outdoor replenisher, the checkpoint's planning map, the depot's recoverable train units / kits.
// The truck is THE vehicle controller (world/skywaysCar.ts, generalized per vehicle; lane TRUCK). Every install is inert outside a
// Surface Run layout.

import type {Game} from '../../game';
import {installSurfaceAccess} from './accessRuntime';
import {installSurfaceLook} from './look';
import {installSurfaceAir} from './air';
import {installSurfaceLife} from './life';

export function installSurfaceRun(game: Game): void {
  installSurfaceAccess(game);
  installSurfaceLook(game);
  installSurfaceAir(game);
  installSurfaceLife(game);
}
