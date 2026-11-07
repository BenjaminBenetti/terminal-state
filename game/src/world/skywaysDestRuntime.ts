// Task studio-skyways-destinations-20261106-170011-01 (lane LANDMARKS (A)): the destinations' section runtime, installed into Game like
// the add-on's (world/skywaysAddonRuntime.ts), inert without layout.skyways or without placed posters / plaques:
//  - preload (Game.sectionPreloads, behind the loading screen): lane ART2D's Codex art atlases the placed skyDPoster / skyDPlaque show
//    (level-only textures/skyways/*.jpg through LevelResources: released with the level) -> one SurfaceNodeMaterial per atlas, handed to
//    the renderer (world/skywaysDestinations.ts setSkywaysDestArtMaterial) before the world is built. A missing table entry or a failed /
//    slow atlas leaves the plain board stand-in (never substitute drawn art). Nothing per frame.

import * as THREE from 'three';
import type {StationLayout} from '../gen/stationTypes';
import {destArtAtlas, type DestArtAtlasKey} from '../gen/skyways/destinations/skywaysDestArtMap';
import {SurfaceNodeMaterial} from './materials';
import {setSkywaysDestArtMaterial, skywaysDestAtlases} from './skywaysDestinations';
import {preloadScienceArt} from './skywaysStoreScienceArt'; // task studio-alpha-skyways-shops-20261107-054512-01 (lane STORE-SCIENCE)
import {preloadStoreMusicArt} from './skywaysStoreMusic'; // lane STORE-MUSIC (task studio-alpha-skyways-shops-20261107-054512-01)

/** Longest wait for the art atlases before the world is built (then: the plain boards). */
export const SKYWAYS_DEST_ART_WAIT_MS = 6000;
/** The LevelResources owner key (a named constant: the release packager reads a literal first `load(...)` argument as an asset path). */
const LEVEL = 'skyways';

export interface SkywaysDestHost {
  levelResources: {load(level: string, url: string, spec: {srgb: boolean; repeat: boolean}): Promise<THREE.Texture | null>; own<T extends {dispose(): void}>(level: string, r: T): T};
  sectionPreloads?: ((layout: StationLayout) => Promise<void>)[];
}

export class SkywaysDestRuntime {
  /** Counters (QA / tests). */
  readonly counts = {artLoaded: 0, artMissing: 0};
  /** Atlas material per loaded texture (released with the level by LevelResources). */
  private readonly artMats = new WeakMap<THREE.Texture, THREE.Material>();

  constructor(readonly host: SkywaysDestHost) {}

  install(): this {
    this.host.sectionPreloads?.push(layout => (layout.skyways ? Promise.race([this.preload(layout), new Promise<void>(r => setTimeout(r, SKYWAYS_DEST_ART_WAIT_MS))]) : Promise.resolve()));
    // lane STORE-MUSIC (task studio-alpha-skyways-shops-20261107-054512-01): the record store's cover / sign atlases, same wait
    this.host.sectionPreloads?.push(layout => (layout.skyways ? Promise.race([preloadStoreMusicArt(this.host, layout).then(() => undefined), new Promise<void>(r => setTimeout(r, SKYWAYS_DEST_ART_WAIT_MS))]) : Promise.resolve()));
    return this;
  }

  /** The atlases this layout's posters / plaques show -> one material each (released with the level). Never rejects. */
  async preload(layout: StationLayout): Promise<void> {
    const atlases = skywaysDestAtlases(new Set(layout.props.map(p => p.kind)));
    // (+ lane STORE-SCIENCE: the science store's wall-art atlas, when placed — in parallel)
    await Promise.all([preloadScienceArt(layout, this.host), ...atlases.map(async (atlas: DestArtAtlasKey) => {
      const rec = destArtAtlas(atlas);
      const tex = rec ? await this.host.levelResources.load(LEVEL, rec.url, {srgb: true, repeat: false}).catch(() => null) : null;
      if (!tex) { setSkywaysDestArtMaterial(atlas, null); this.counts.artMissing++; return; }
      // the same texture (a Retry of the level keeps its resources): the same material
      let m = this.artMats.get(tex);
      if (!m) {
        // paper posters matte; the cast plaques a little burnished
        m = this.host.levelResources.own(LEVEL, new SurfaceNodeMaterial(atlas === 'plaques' ? {map: tex, roughness: 0.55, metalness: 0.25} : {map: tex, roughness: 0.78, metalness: 0}));
        m.name = `skyways-dest-art-${atlas}`;
        this.artMats.set(tex, m);
      }
      setSkywaysDestArtMaterial(atlas, m);
      this.counts.artLoaded++;
    })]);
  }
}

/** Installs the destinations runtime into a Game (one call in the Game constructor). */
export function installSkywaysDestinations(host: SkywaysDestHost): SkywaysDestRuntime {
  return new SkywaysDestRuntime(host).install();
}
