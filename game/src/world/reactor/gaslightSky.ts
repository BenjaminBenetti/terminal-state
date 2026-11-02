// Task reactor-expansion-20261101 (lane GASLIGHT): WHAT YOU SEE THROUGH THE PIT ROOF. Task reactor-submit-roof-fog-20261102 (lane ROOF,
// user: "I want a single hole above the reactor not a totally open roof"): the roof is SOLID now with ONE round opening over the core
// (gen/reactor/roofOpening.ts roofOpeningOf; levels[0].sky.open opens only its cells; world/reactor/roofKit.ts draws the curb ring and
// the trimmed beam grid under the slab). This draws what you see through that opening — and, since the slab / curb / walls cover
// everything else, ONLY through it:
//  - the SKY: the Office's exterior murk dome (world/mallExterior.ts mallSkyMaterial — the same infectious green sky the Office roof and
//    the mall's glass roof show; unlit, never fogged, no depth write, drawn first: every surface in front of it covers it), centred
//    over the opening at the roof line;
//  - the OUTSIDE GAS with depth: the same drifting gas sheets / low layer / curtain the mall shows over its roof (buildMallExteriorGas,
//    reused unchanged over the pit rect — depth-tested, so the slab hides them except through the hole, where they keep their
//    parallax as you move round the rim; the low layer floats just above the curb's 0.6 m upstand);
//  - the VOLUMETRIC part is the march's regional term: the toxic air above the roof line (world/gaslightRules.ts reactorOutdoorGas —
//    exposure reads the same function, and nothing walkable reaches it; the march stops at the slab, so it shows through the hole
//    only) lit by the shaft of sky light falling through the opening (gaslightRules.ts PIT_SHAFTS / shaftAt).
// No city or outdoor travel: the dome is sky only. Built once per Reactor world into its group (culled with every pit storey).

import * as THREE from 'three';
import type {ReactorInfo} from '../../gen/reactor/reactorTypes';
import {roofOpeningOf, type RoofOpening} from '../../gen/reactor/roofOpening';
import {MALL_EXT_ORDER, buildMallExteriorGas, mallSkyMaterial} from '../mallExterior';

/**
 * Sky dome radius (m). Every point of the dome must stay inside the Reactor's far plane (world/reactor/archInstall.ts REACTOR_FOG.far
 * 230) from ANYWHERE in the pit — the core floor sits up to ~50 m below / ~35 m beside the dome centre (the opening over the core) —
 * or the zenith would clip to the clear colour (an exposed void through the opening): 150 + 60 < 230.
 */
export const PIT_SKY = {radius: 150} as const;

export interface PitSkyStats { dome: boolean; gasLayers: number; curtainOpacity: number; triangles: number; opening: RoofOpening }

/** The roof opening's sky + outside gas into `group` (null stats: the pit roof has no opening). */
export function buildPitSky(group: THREE.Group, info: ReactorInfo, levels: readonly number[]): PitSkyStats | null {
  const p = info.pit, b = p.bounds;
  const o = roofOpeningOf(info);
  if (!o) return null;
  const dome = new THREE.SphereGeometry(PIT_SKY.radius, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2);
  const sky = new THREE.Mesh(dome, mallSkyMaterial());
  sky.position.set(o.x, p.roofY, o.z);
  sky.name = 'pit-sky';
  sky.renderOrder = MALL_EXT_ORDER.sky;
  sky.userData.levels = [...levels];
  sky.frustumCulled = false;
  sky.matrixAutoUpdate = false;
  sky.updateMatrix();
  group.add(sky);
  const ext = buildMallExteriorGas({roof: {...b}, vault: null, deckY: p.roofY, springY: p.roofY, apexY: p.roofY});
  for (const m of ext.meshes) { m.name = m.name.replace('mall-', 'pit-'); m.userData.levels = [...levels]; group.add(m); }
  return {dome: true, gasLayers: ext.stats.layers, curtainOpacity: ext.stats.curtainOpacity, triangles: ext.stats.triangles + (dome.index ? dome.index.count / 3 : 0), opening: o};
}
