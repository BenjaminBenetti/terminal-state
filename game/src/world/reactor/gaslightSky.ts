// Task reactor-expansion-20261101 (lane GASLIGHT): THE REACTOR's OPEN PIT TOP (user: "I want the roof to be open, with visible toxic gas
// out side"). The generator opens the pit at its roof line (gen/reactor/gaslightLamps.ts openPitRoof: levels[0].sky — no roof slab, rays
// leave into the sky; the roof's open I-beam grid stays, world/reactor/archKit.ts planRoof); this draws what you see through it:
//  - the SKY: the Office's exterior murk dome (world/mallExterior.ts mallSkyMaterial — the same infectious green sky the Office roof and
//    the mall's glass roof show; unlit, never fogged, drawn first), centred over the pit at the roof line;
//  - the OUTSIDE GAS with depth: the same drifting gas sheets / low layer / curtain the mall shows over its roof (buildMallExteriorGas,
//    reused unchanged with the pit opening as the roof: parallax as you move round the rim);
//  - the VOLUMETRIC part is the march's regional term: the toxic air above the roof line (world/gaslightRules.ts reactorOutdoorGas —
//    exposure reads the same function, and nothing walkable reaches it) lit by the shafts of sky light falling into the pit.
// No city or outdoor travel: the dome is sky only. Built once per Reactor world into its group (culled with every pit storey).

import * as THREE from 'three';
import type {ReactorInfo} from '../../gen/reactor/reactorTypes';
import {MALL_EXT_ORDER, buildMallExteriorGas, mallSkyMaterial} from '../mallExterior';

/** Sky dome radius (m: inside the Reactor's far plane, world/reactor/archInstall.ts REACTOR_FOG.far 230, from anywhere in the pit). */
export const PIT_SKY = {radius: 190} as const;

export interface PitSkyStats { dome: boolean; gasLayers: number; curtainOpacity: number; triangles: number }

/** The open pit top's sky + outside gas into `group` (null stats: the pit has no roof opening). */
export function buildPitSky(group: THREE.Group, info: ReactorInfo, levels: readonly number[]): PitSkyStats | null {
  const p = info.pit, b = p.bounds;
  if (!(p.roofY > p.rimY + 2)) return null;
  const dome = new THREE.SphereGeometry(PIT_SKY.radius, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2);
  const sky = new THREE.Mesh(dome, mallSkyMaterial());
  sky.position.set((b.x0 + b.x1) / 2, p.roofY, (b.z0 + b.z1) / 2);
  sky.name = 'pit-sky';
  sky.renderOrder = MALL_EXT_ORDER.sky;
  sky.userData.levels = [...levels];
  sky.frustumCulled = false;
  sky.matrixAutoUpdate = false;
  sky.updateMatrix();
  group.add(sky);
  const ext = buildMallExteriorGas({roof: {...b}, vault: null, deckY: p.roofY, springY: p.roofY, apexY: p.roofY});
  for (const m of ext.meshes) { m.name = m.name.replace('mall-', 'pit-'); m.userData.levels = [...levels]; group.add(m); }
  return {dome: true, gasLayers: ext.stats.layers, curtainOpacity: ext.stats.curtainOpacity, triangles: ext.stats.triangles + (dome.index ? dome.index.count / 3 : 0)};
}
