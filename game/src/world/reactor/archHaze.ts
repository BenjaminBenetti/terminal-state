// Task reactor-build-20261101 (lane ARCH): the Reactor's volumetric MEDIUM (render/atmosphere.ts atmosphereFor applies it on a
// layout.reactor): B's deep, hazy industrial cathedral — a denser base haze that falls off slowly with height (tall columns of murk
// between the tiers, so depth reads tier by tier), flatter layered patches (strata-like), slower drift, and the sodium / cage lamps
// lighting it more strongly. The yellow-green gas strata are lane AIR's separate depth term (render/volumetric.ts); the olive scene
// fog is archInstall.ts REACTOR_FOG. Pure data (type-only imports).
//
// Task reactor-playtest-round2-20261102 (lane GAS; user: "side areas (the ones with generators) have really heavy white fog … Its like
// a fog machine party in there!"). Root cause: the rooms cut into the rock never got the lighter room haze this file meant for them.
// The `areaDensity` keys below are area ROLES ('reactor-room' …), but render/atmosphere.ts looks an area up by its TYPE / kind, so they
// never matched. The complexes' rooms fell back to the Subway's back-of-house multipliers instead: utility 1.4, service corridor 1.35,
// storage 1.2. On top of that came the 'service' class group (never clear, half of them dense x 1.4), the Reactor's denser base
// (0.026) and its 1.1 m ground layer (x the multiplier again). With a multiplier >= 1.6 the patch coverage also saturates (70 % dense
// patches at 2.3x). So a complex room held ~0.06-0.075 / m at walking height without the patches (pit galleries ~0.01-0.027), about
// 5x a normal room. Now every room cut into the rock (reactorRockRooms: the side complexes' areas + the pit's side rooms) takes
// `rockRoom`: a normal-room multiplier and the ordinary room class odds (some clear, a quarter dense). The pit galleries, the rim
// station and the green toxic strata are untouched.

import type {AtmosphereParams} from '../../render/atmosphere';
import type {StationLayout} from '../../gen/stationTypes';

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
  // GEN's reactor room types (if present): open pit galleries / bridges hazier than the rooms cut into the rock. (lane GAS: these are
  // area ROLES, so the type lookup never matches them; kept as-is so the pit's look does not change. The rooms use `rockRoom`.)
  areaDensity: {'reactor-gallery': 1.15, 'reactor-bridge': 1.2, 'reactor-room': 0.85, 'reactor-control': 0.7} as AtmosphereParams['areaDensity'],
  // (lane GAS) rooms cut into the rock: a normal room's haze (x 0.8 of the Reactor base ~= the Subway's normal room), room class odds
  rockRoom: {density: 0.8, group: 'room'},
  // task studio-reactor-surface-ending-20261102 (lane SURFACE, user: "the fog is now cleared! The surface is habitable again!"): the
  // open-air SURFACE storey (lane ENDING's layout.reactor.surface level, role 'roof') takes a light outdoor haze — the Reactor's base x
  // 0.08 (~0.002 / m: ~10 % over the march's 52 m, was the shared roof default x 0.35: ~40 %), so the march never veils the city. The
  // pit storeys have no 'roof' role: unchanged.
  levelDensity: {roof: 0.08},
};

const ROCK = new WeakMap<object, {n: number; set: ReadonlySet<number>}>();

/**
 * Task reactor-playtest-round2-20261102 (lane GAS): the area ids of the Reactor's ROOMS CUT INTO THE ROCK. These are every side
 * complex's areas (layout.reactor.complexes[].areas, whatever their carver) and every pit side room (role 'reactor-room'). Empty on
 * any other layout. Cached per areas array (rebuilt if it grew).
 */
export function reactorRockRooms(layout: Pick<StationLayout, 'areas'> & {reactor?: StationLayout['reactor']}): ReadonlySet<number> {
  const key = layout.areas as object;
  const hit = ROCK.get(key);
  if (hit && hit.n === layout.areas.length) return hit.set;
  const set = new Set<number>();
  if (layout.reactor) {
    for (const c of layout.reactor.complexes ?? []) for (const a of c.areas) set.add(a);
    layout.areas.forEach((a, i) => { if (a.role === 'reactor-room') set.add(i); });
  }
  ROCK.set(key, {n: layout.areas.length, set});
  return set;
}
