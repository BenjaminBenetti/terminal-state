// Task studio-surface-run-opus-rebuild-20261116-020827-01 (lane LIFE): SURFACE RUN's district LIFE runtime, installed by
// world/surface/install.ts. Inert outside a Surface Run layout (`layout.surface`).
//  - the OUTDOOR REPLENISHER (world/surface/replenish.ts rules, replenishRuntime.ts adapter): a bounded outdoor zombie population that
//    replenishes indefinitely, off-camera and away from the player, never saved, never in the kill memory / clear counts — distinct from
//    the district's ordinary interior enemies (layout.zombies: permanent kills, never respawned; untouched here);
//  - the checkpoint's PLANNING MAP (world/surface/map*.ts): the map table's [E] full-screen planning map + its table-top copy, the
//    district's exploration record (lane 'surface.life' of the district memory), live player / truck markers, local notes and reports.
// The depot's recoverable train units are lane CARGO's (world/surface/cargo*.ts); this file installs only the two systems above.

import type {Game} from '../../game';
import {installSurfaceReplenish} from './replenishRuntime';
import {installSurfaceMap} from './mapRuntime';

export function installSurfaceLife(game: Game): void {
  installSurfaceReplenish(game);
  installSurfaceMap(game);
}
