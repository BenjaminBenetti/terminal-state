// Task studio-surface-run-opus-rebuild-20261116-020827-01 (primary): SURFACE RUN's runtime installs, in order (Game constructor, after the
// GAS / Bunker installs and before the player train's — the train's build rebuilds game.propIndex over everything already there):
//  - ACCESS (world/surface/accessRuntime.ts): the [E] way up / out and back, prompts; the crossing itself is Game.crossSurface.
//  - LIFT / CONNECTOR (world/surface/liftRuntime.ts, connectorRuntime.ts): the Subway's cargo lift ride and the Office / Mall walked tube.
//  - LOOK (world/surface/look.ts): the district's streets, facades, roofs, far city, daylight / sky / mood, culling and warm-up.
//  - AIR (world/surface/air.ts): outdoor gas (visible green fog = exposure), building openings / doors, the truck cab's protection.
//  - LIFE (world/surface/life.ts): the outdoor replenisher, the checkpoint's planning map, the depot's recoverable train units / kits.
// The truck is THE vehicle controller (world/skywaysCar.ts, generalized per vehicle; lane TRUCK). Every install is inert outside a
// Surface Run layout.

import type {Game} from '../../game';
import {installSurfaceAccess} from './accessRuntime';
import {installSurfaceLift} from './liftRuntime';
import {installSurfaceConnector} from './connectorRuntime';
import {installSurfaceLook} from './look';
import {installSurfaceAir} from './air';
import {installSurfaceLife} from './life';
import {installSurfaceCargo} from './cargo';
import {installSurfaceFog} from './fogRuntime';

export function installSurfaceRun(game: Game): void {
  installSurfaceAccess(game);
  installSurfaceLift(game); // (lane ACCESS follow-up, version 2: the cargo lift ends + the ride that is the crossing)
  installSurfaceConnector(game); // (task studio-surface-host-ground-connectors-20261118-053602-01, version 2: the Office / Mall on-foot connector tube)
  installSurfaceLook(game);
  installSurfaceAir(game);
  installSurfaceFog(game); // (task studio-surface-run-field-followup-20261116-211729-01, lane FOG) a v2 district's pressure sound + QA (inert elsewhere)
  installSurfaceLife(game);
  // (lane CARGO) the depot recoverables, the truck's attachment points, the upgrade kit, the crossing participant 'cargo' — BEFORE the
  // train equipment's install (Game order): its build seeds the lane the equipment's build reads
  installSurfaceCargo(game);
}
