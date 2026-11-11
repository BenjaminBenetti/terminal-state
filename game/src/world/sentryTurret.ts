// Task studio-train-crafting-v1-20261111-225628-01 (lane SENTRY): THE DEFENSE SENTRY — [E] on the plugged console loads real 5.56 mm
// rounds (the unit's `ammo`), the roof turret (craft/trainFixtures.ts turretMount) deploys while the sentry is active and loaded, and
// shoots the zombies it can see near the parked train with the game's normal hitscan combat, one loaded round per shot.
//
// LEAD STUB: lane SENTRY replaces the internals; `installSentryTurret` and the class name stay.

import type {Game} from '../game';

export class SentryTurretSystem {
  constructor(readonly host: unknown) {}
  install(): this { return this; }
}

/** Installs the sentry (one call in the Game constructor, after the train equipment; registries only). */
export function installSentryTurret(game: Game): SentryTurretSystem {
  return new SentryTurretSystem(game).install();
}
