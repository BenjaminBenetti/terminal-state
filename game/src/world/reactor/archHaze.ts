// Task reactor-build-20261101 (lane ARCH): the Reactor's volumetric MEDIUM (render/atmosphere.ts atmosphereFor applies it on a
// layout.reactor): B's deep, hazy industrial cathedral — a denser base haze that falls off slowly with height (tall columns of murk
// between the tiers, so depth reads tier by tier), flatter layered patches (strata-like), slower drift, and the sodium / cage lamps
// lighting it more strongly. The yellow-green gas strata are lane AIR's separate depth term (render/volumetric.ts); the olive scene
// fog is archInstall.ts REACTOR_FOG. Pure data (type-only imports).

import type {AtmosphereParams} from '../../render/atmosphere';

export const REACTOR_ATMOSPHERE: Partial<AtmosphereParams> = {
  density: 0.026,
  heightFalloff: 0.1,
  coverage: 0.42,
  noiseAnisotropy: 2.6,
  fixtureScatter: 1.4,
  flashlightScatter: 0.45,
  maxDistance: 52,
  drift: 0.12,
  rise: 0.02,
  ground: 1.3,
  groundHeight: 1.1,
  // GEN's reactor room types (if present): open pit galleries / bridges hazier than the rooms cut into the rock
  areaDensity: {'reactor-gallery': 1.15, 'reactor-bridge': 1.2, 'reactor-room': 0.85, 'reactor-control': 0.7} as AtmosphereParams['areaDensity'],
};
