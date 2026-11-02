// Task reactor-expansion-20261101 (lane CORE): the reactor's GLOW LIGHTS — user: "there is no green glow from the reactor like shown in the
// art. When standing at the top of the pit, green reactor glow should be visible, it should also illuminate the fog" + "I want substantial
// light cast from the green and blue liquids". Real, bounded, unshadowed PointLights that CAST on the structure and light the fog:
//  - 2 GREEN lights low over the goop (opposite sides of the pool, the widest free arcs: coreHero.ts lights.green), ~34 m reach —
//    dormant but clearly green before the restart (~90 cd), x4 when the core wakes;
//  - 1 BLUE light over the vessel's CRDM platform (the coolant loops round it), ~30 m — dark until the valve pressurises the loops (a
//    faint blue), strong once the pump runs, stronger still with the core alive.
// Created ONCE at install and kept in the scene at intensity 0 everywhere else (the light set never changes: docs/rendering-warmup.md;
// no shader rebuild per level), moved to the layout's points on a Reactor build. The first green and the blue light are the volumetric
// march's SCATTER lights with `userData.vfOpen` (render/volumetric.ts: no occlusion window — they light the whole pit's haze and the
// green gas strata within their reach: the glow reads from the rim). The baked part (the goop's virtual green light-field sources, half
// on the powered circuit) is gen/reactor/coreFloor.ts. Intensities follow world/reactor/coreVisuals.ts (stage levels) each frame.

import * as THREE from 'three';
import type {StationLayout} from '../../gen/stationTypes';
import type {KitPlan} from './archKit';
import {coreHeroOf} from './coreHero';
import {CORE_LOOK} from './coreStages';
import {activeCoreVisuals, setActiveCoreVisuals} from './coreVisuals';

/** The light objects' fixed parameters (colour, cutoff m, decay). */
export const CORE_LIGHTS = {
  green: {color: 0x52ff5e, distance: 34, decay: 1.5, count: 2},
  blue: {color: 0x3d8dff, distance: 30, decay: 1.5, count: 1},
} as const;

interface CoreLightsHost {
  scene: THREE.Scene;
  sectionHooks: {build?(layout: StationLayout): void; teardown?(): void}[];
  frameHooks: ((dt: number) => void)[];
  atmosphere?: {addScatterLight?(l: THREE.PointLight): unknown; removeScatterLight?(l: THREE.PointLight): unknown};
  world?: {reactorArch?: {plan: KitPlan | null}} | null;
}

export class CoreLights {
  readonly green: THREE.PointLight[] = [];
  readonly blue: THREE.PointLight[] = [];
  readonly all: THREE.PointLight[] = [];
  active = false;
  private scattered: THREE.PointLight[] = [];

  constructor(private readonly host: CoreLightsHost) {
    for (const [kind, spec] of [['green', CORE_LIGHTS.green], ['blue', CORE_LIGHTS.blue]] as const) {
      for (let i = 0; i < spec.count; i++) {
        const l = new THREE.PointLight(spec.color, 0, spec.distance, spec.decay);
        l.name = `reactor-${kind}-glow-${i}`;
        l.castShadow = false;
        l.userData.vfOpen = true; // (lane GASLIGHT contract) lights the whole pit's haze / gas strata, no occlusion window
        (kind === 'green' ? this.green : this.blue).push(l);
        this.all.push(l);
      }
    }
  }

  /** Adds the lights to the scene (once, at boot) and registers the hooks. */
  install(): this {
    const h = this.host;
    for (const l of this.all) h.scene.add(l);
    h.sectionHooks.push({build: layout => this.build(layout), teardown: () => this.teardown()});
    h.frameHooks.push(() => this.frame());
    return this;
  }

  build(layout: StationLayout): void {
    this.teardown();
    const hero = (layout as {reactor?: unknown}).reactor ? coreHeroOf(this.host.world?.reactorArch?.plan ?? null) : null;
    if (!hero) { setActiveCoreVisuals(null); return; }
    const place = (ls: THREE.PointLight[], pts: readonly {x: number; y: number; z: number}[]) => ls.forEach((l, i) => {
      const p = pts[i % Math.max(1, pts.length)];
      if (p) { l.position.set(p.x, p.y, p.z); l.updateMatrixWorld(); }
    });
    place(this.green, hero.lights.green);
    place(this.blue, hero.lights.blue);
    this.active = true;
    // the volumetric march's scatter lights (two of its four slots; the burning flares keep the rest)
    const atm = this.host.atmosphere;
    for (const l of [this.green[0], this.blue[0]]) if (l && atm?.addScatterLight?.(l)) this.scattered.push(l);
    this.frame();
  }

  teardown(): void {
    for (const l of this.all) l.intensity = 0;
    for (const l of this.scattered) this.host.atmosphere?.removeScatterLight?.(l);
    this.scattered = [];
    this.active = false;
  }

  /** Per frame: the stage's candela (dormant green without the core visuals). */
  frame(): void {
    if (!this.active) return;
    const v = activeCoreVisuals();
    const L = v ? v.lightLook() : {green: CORE_LOOK.greenDormant, blue: 0};
    for (const l of this.green) l.intensity = L.green;
    for (const l of this.blue) l.intensity = L.blue;
  }

  qa(): object {
    const p = (l: THREE.PointLight) => ({name: l.name, intensity: +l.intensity.toFixed(1), at: [+l.position.x.toFixed(2), +l.position.y.toFixed(2), +l.position.z.toFixed(2)], distance: l.distance, scatter: this.scattered.includes(l)});
    return {active: this.active, lights: this.all.map(p)};
  }
}

let installed: CoreLights | null = null;
/** Installs the reactor glow lights (call once at startup; inert outside the Reactor). */
export function installReactorCoreLights(host: CoreLightsHost): CoreLights {
  return (installed = new CoreLights(host).install());
}
export function reactorCoreLights(): CoreLights | null { return installed; }
