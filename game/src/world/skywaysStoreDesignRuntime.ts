// Task studio-alpha-skyways-shops-20261107-054512-01 (lane STORE-DESIGN): the Larch & Loom Home framed prints' texture, loaded behind
// the loading screen. Called from the destinations runtime's section preload (world/skywaysDestRuntime.ts) for a Skyways layout that
// placed skyDsArtPrint props: the store's Codex print atlas (gen/skyways/stores/designArt.ts; level-only textures/skyways/** through
// LevelResources: released with the level) -> one matte SurfaceNodeMaterial handed to the renderer (world/skywaysStoreDesignDraw.ts
// setDesignArtMaterial) before the world is built. A missing / failed atlas leaves the plain board (never drawn substitute art).

import * as THREE from 'three';
import type {StationLayout} from '../gen/stationTypes';
import {DESIGN_ART} from '../gen/skyways/stores/designArt';
import {SurfaceNodeMaterial} from './materials';
import {setDesignArtMaterial} from './skywaysStoreDesignDraw';

/** The LevelResources owner key (a named constant: the release packager reads a literal first `load(...)` argument as an asset path). */
const LEVEL = 'skyways';

export interface DesignArtHost {
  levelResources: {load(level: string, url: string, spec: {srgb: boolean; repeat: boolean}): Promise<THREE.Texture | null>; own<T extends {dispose(): void}>(level: string, r: T): T};
}

const mats = new WeakMap<THREE.Texture, THREE.Material>();
/** Counters (QA / tests). */
export const designArtCounts = {loaded: 0, missing: 0};

/** Loads the print atlas when the layout hung prints (else nothing); never rejects. */
export async function preloadSkywaysStoreDesign(host: DesignArtHost, layout: StationLayout): Promise<void> {
  if (!layout.props.some(p => p.kind === 'skyDsArtPrint')) return;
  const url = DESIGN_ART.url;
  const tex = await host.levelResources.load(LEVEL, url, {srgb: true, repeat: false}).catch(() => null);
  if (!tex) { setDesignArtMaterial(null); designArtCounts.missing++; return; }
  // the same texture (a Retry of the level keeps its resources): the same material
  let m = mats.get(tex);
  if (!m) {
    m = host.levelResources.own(LEVEL, new SurfaceNodeMaterial({map: tex, roughness: 0.82, metalness: 0}));
    m.name = 'store-design-prints';
    mats.set(tex, m);
  }
  setDesignArtMaterial(m);
  designArtCounts.loaded++;
}
