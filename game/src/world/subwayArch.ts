// Task studio-subway-station-variety-20261117-043926-01: THE SUBWAY STATION IDENTITY — the finish mapper of a version-2 Subway station (the
// builder's arch chain asks SubwayArch exactly like OfficeArch / MallArch / ReactorArch / SkywaysArch / MarketArch / BunkerArch on their
// levels; null without layout.identity — every version-1 station and every other level draws exactly as before). Pure style from the
// station's EXISTING materials, no new art:
//  - 'tile' stations: the public walls' glazed tile set (upper / lower / base crops) as a TINTED CLONE — a colour uniform on the shared
//    node graph (no new shader program; the light bake reads map mean x colour, world/surfaceAlbedo.ts);
//  - 'rock' stations (the cavern family): public walls, the track-bed walls and (finishCeiling) the public ceilings / the bed's roof in
//    PAINTED BLASTED ROCK — the existing mine-rock set (the Reactor family's, already shared with the Bunker / the Market crevice:
//    assets/levelAssets.ts), linearly tinted to the station's paint colour;
//  - 'concrete' stations (brutalist grand halls / interchanges): public walls and ceilings in the existing board-formed pit-concrete set;
//  - until a set is loaded (Node tests, a failed fetch) a tinted clone of the station's own tunnel lining stands in (the crevice rule).
// The sets load behind the loading screen (installSubwayIdentityTextures: a section preload, like world/marketTextures.ts); the station's
// accent colour is read by world/wallDetailPlan.ts (tile band, pilasters, frieze), its plate colours by world/builder.ts signTexture
// (subwayPlate below).

import * as THREE from 'three';
import type {Level} from '../gen/levels';
import type {Area, StationIdentity, StationLayout} from '../gen/stationTypes';
import type {BuiltFace} from './levelGeometry';
import {cloneSurfaceMaterial, type MatKey, type WorldMaterials} from './materials';
import {DECAY_PROFILES, applyDecay, type DecayProfile} from './decay';
import {CREVICE_TEXTURES, creviceMaterial, setCreviceTexture, type CreviceSlot, type MarketTexHost} from './marketTextures';

/** The identity's arch-owned finish keys (world/finishAt.ts reports them; damage/impactFinish.ts classes them). */
export const SUBWAY_KEYS = {
  tileUpper: 'subway-tileUpper', tileLower: 'subway-tileLower', tileBase: 'subway-tileBase',
  rock: 'subway-rock', rockCeil: 'subway-rock-ceil', concrete: 'subway-concrete', concreteCeil: 'subway-concrete-ceil',
} as const;
export type SubwayKey = typeof SUBWAY_KEYS[keyof typeof SUBWAY_KEYS];
const TILE_BASE: Readonly<Record<string, MatKey>> = {[SUBWAY_KEYS.tileUpper]: 'tileUpper', [SUBWAY_KEYS.tileLower]: 'tileLower', [SUBWAY_KEYS.tileBase]: 'tileBase'};
const TILE_KEY: Readonly<Record<string, SubwayKey>> = {tileUpper: SUBWAY_KEYS.tileUpper, tileLower: SUBWAY_KEYS.tileLower, tileBase: SUBWAY_KEYS.tileBase};
const KEY_SET: ReadonlySet<string> = new Set(Object.values(SUBWAY_KEYS));
/** userData flag of the identity's WALL materials: world/wallDetail.ts cuts them like the base walls (lost tiles, spalls, breaches). */
export const SUBWAY_WALL_TAG = 'subwayWall';
export const isSubwayKey = (k: string): k is SubwayKey => KEY_SET.has(k);

/** Does a layout draw the existing rock / cast-concrete sets (its section preload loads them)? */
export function identitySlots(layout: Pick<StationLayout, 'identity'>): CreviceSlot[] {
  const w = layout.identity?.walls;
  return w === 'rock' ? ['rock'] : w === 'concrete' ? ['concrete'] : [];
}

const hexOf = (h: number) => `#${h.toString(16).padStart(6, '0')}`;
/** The wayfinding plate colours of a version-2 station (null: the builder's default dark plate). CSS strings for the canvas. */
export function subwayPlate(layout: Pick<StationLayout, 'identity'>): {bg: string; fg: string; accent: string} | null {
  const id = layout.identity;
  return id ? {bg: hexOf(id.plate.bg), fg: hexOf(id.plate.fg), accent: hexOf(id.accent)} : null;
}

/** Rock / concrete looks over the existing sets: a LINEAR tint (x the identity's paint), decay like the tunnel lining. */
const ROCK_DECAY: DecayProfile = {...DECAY_PROFILES.tunnel, grime: 0.35, streaks: 0.6, efflor: 0.45, cracks: 0.15};
const CONCRETE_DECAY: DecayProfile = {...DECAY_PROFILES.tunnel, grime: 0.4, streaks: 0.7, efflor: 0.35, stains: 0.3, cracks: 0.3};
/**
 * Linear mean albedo of each set's colour map (measured: 128 x 128 mean of mine-rock-color.jpg / pit-concrete-color.jpg; the station
 * tunnel lining's tunnel-working-face-color.jpg for the stand-in). The tint divides it out: the paint colour, not the rock's brown,
 * sets the hue, and the texture keeps its own relative variation.
 */
export const SET_MEAN: Readonly<Record<'rock' | 'concrete' | 'tunnel', readonly [number, number, number]>> = {
  rock: [0.070, 0.045, 0.026], concrete: [0.091, 0.070, 0.049], tunnel: [0.284, 0.271, 0.229],
};
/** Target albedo = the identity colour (linear) x this: painted rock / cast concrete near the glazed tile's mean (~0.2). */
const SET_VALUE: Readonly<Record<'rock' | 'concrete', number>> = {rock: 0.5, concrete: 0.4};
const CEIL_SHADE = 0.72;
/** The glazed tile keeps its brightness: the tint is normalised to luminance 1 (no channel past this). */
const TILE_TINT_MAX = 1.5;

/** The linear multiplier of a tinted tile clone (luminance-preserving: a civic blue station is as bright as a heritage cream one). */
export function tileTint(hex: number): [number, number, number] {
  const c = new THREE.Color().setHex(hex);
  const lum = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  const k = 1 / Math.max(1e-3, lum), top = Math.max(c.r, c.g, c.b) * k, s = top > TILE_TINT_MAX ? TILE_TINT_MAX / top : 1;
  return [c.r * k * s, c.g * k * s, c.b * k * s];
}
/** The linear target albedo of a rock / concrete finish (x CEIL_SHADE on a ceiling). */
export function setTarget(hex: number, slot: 'rock' | 'concrete', ceil: boolean): [number, number, number] {
  const c = new THREE.Color().setHex(hex), v = SET_VALUE[slot] * (ceil ? CEIL_SHADE : 1);
  return [c.r * v, c.g * v, c.b * v];
}

const tinted = new WeakMap<WorldMaterials, Map<string, THREE.Material>>();
function cached(mats: WorldMaterials, name: string, make: () => THREE.Material): THREE.Material {
  let per = tinted.get(mats);
  if (!per) tinted.set(mats, (per = new Map()));
  let m = per.get(name);
  if (!m) per.set(name, (m = make()));
  return m;
}

export class SubwayArch {
  readonly identity: StationIdentity;
  stats = {faces: {} as Record<string, number>};
  private readonly scl = new Map<string, {u: number; v: number}>();

  static for(layout: StationLayout, mats: WorldMaterials, levels: readonly Level[]): SubwayArch | null {
    return layout.identity && levels.length ? new SubwayArch(layout, mats) : null;
  }

  private constructor(readonly layout: StationLayout, readonly mats: WorldMaterials) {
    this.identity = layout.identity!;
  }

  private count(k: string): void { this.stats.faces[k] = (this.stats.faces[k] ?? 0) + 1; }

  /** A core public hall / platform / passage (not a storefront unit's interior, not a track-extension area). */
  private publicArea(a: Area | undefined): boolean {
    return !!a && a.publicSpace && !a.ext && a.type !== 'shop' && a.type !== 'eatery';
  }

  /** Wall finishes of the public spaces (and a cavern's track-bed walls); everything else keeps the builder's rule. */
  remapFaces<F extends BuiltFace>(faces: F[]): F[] {
    const id = this.identity;
    // kind 'tile' = a public, non-extension, non-storefront area's wall (world/levelGeometry.ts kindOf); 'tunnel' on a non-extension
    // area = the track bed's walls (an extension tunnel's lining is its own shell: world/trackExt/view.ts)
    return faces.map(f => {
      const a = f.area >= 0 ? this.layout.areas[f.area] : undefined;
      let key: string | null = null;
      if (f.kind === 'tile' && TILE_KEY[f.finish]) key = id.walls === 'tile' ? (id.wallTint !== 0xffffff ? TILE_KEY[f.finish] : null) : id.walls === 'rock' ? SUBWAY_KEYS.rock : SUBWAY_KEYS.concrete;
      else if (id.walls === 'rock' && f.kind === 'tunnel' && f.finish === 'tunnel' && !(a && a.ext)) key = SUBWAY_KEYS.rock;
      if (!key) return f;
      this.count(key);
      return {...f, finish: key};
    });
  }

  /** Floors keep the builder's rule (terrazzo, platform slab, ballast). */
  floorKey(_L: number, _i: number): string | null { return null; }

  /** Public ceilings (and the track bed's roof: area -1) of a rock / concrete station with finishCeiling. */
  ceilKey(_L: number, areaId: number): string | null {
    const id = this.identity;
    if (!id.finishCeiling || id.walls === 'tile') return null;
    const a = areaId >= 0 ? this.layout.areas[areaId] : undefined;
    if (areaId >= 0 && !this.publicArea(a)) return null;
    return id.walls === 'rock' ? SUBWAY_KEYS.rockCeil : SUBWAY_KEYS.concreteCeil;
  }

  /** Door soffits between two public spaces take the ceiling finish (null: the builder's rule). */
  doorCeilKey(_L: number, a: Area | undefined, b: Area | undefined): string | null {
    return this.publicArea(a) && this.publicArea(b) ? this.ceilKey(0, b!.id) : null;
  }

  doorTrimKey(_level: number, _a: Area | undefined): string | null { return null; }

  scale(key: string): {u: number; v: number} | undefined {
    if (!isSubwayKey(key)) return undefined;
    if (TILE_BASE[key]) return this.mats.scale[TILE_BASE[key]];
    if (!this.scl.has(key)) this.material(key);
    return this.scl.get(key);
  }

  material(key: string): THREE.Material | undefined {
    if (!isSubwayKey(key)) return undefined;
    const id = this.identity;
    const base = TILE_BASE[key];
    if (base) {
      // a tinted clone of the shared tile material (same program; the decay profile and reflection tag carried over)
      return cached(this.mats, `${key}#${hexOf(id.wallTint)}`, () => {
        const m = cloneSurfaceMaterial(this.mats.get(base)) as THREE.Material & {color?: THREE.Color};
        const t = tileTint(id.wallTint);
        m.color?.setRGB(t[0], t[1], t[2]);
        m.name = key;
        m.userData[SUBWAY_WALL_TAG] = true;
        applyDecay(m, DECAY_PROFILES[base as keyof typeof DECAY_PROFILES]);
        return m;
      });
    }
    const slot: 'rock' | 'concrete' = key === SUBWAY_KEYS.rock || key === SUBWAY_KEYS.rockCeil ? 'rock' : 'concrete';
    const ceil = key === SUBWAY_KEYS.rockCeil || key === SUBWAY_KEYS.concreteCeil;
    const want = setTarget(id.wallTint, slot, ceil);
    const decay = slot === 'rock' ? ROCK_DECAY : CONCRETE_DECAY;
    const mean = SET_MEAN[slot], tint: [number, number, number] = [want[0] / mean[0], want[1] / mean[1], want[2] / mean[2]];
    const tex = creviceMaterial(this.mats, slot, `${key}#${hexOf(id.wallTint)}`, {tint, role: 'wall', macro: slot === 'rock' ? 0.3 : 0.25, grime: [0.3, 1.4], decay});
    // (the bake / traced bounce read userData.lightAlbedo: world/surfaceAlbedo.ts — the target paint, whether or not the map is readable)
    if (tex) { this.scl.set(key, {u: 1, v: 1}); tex.userData.lightAlbedo = want; if (!ceil) tex.userData[SUBWAY_WALL_TAG] = true; return tex; }
    // stand-in (the set not loaded: Node, a failed fetch): the station's own tunnel lining, tinted to the same target albedo
    this.scl.set(key, this.mats.scale.tunnel);
    return cached(this.mats, `${key}#${hexOf(id.wallTint)}#standin`, () => {
      const m = cloneSurfaceMaterial(this.mats.get('tunnel')) as THREE.Material & {color?: THREE.Color};
      const tm = SET_MEAN.tunnel;
      m.color?.setRGB(want[0] / tm[0], want[1] / tm[1], want[2] / tm[2]);
      m.name = key;
      m.userData.lightAlbedo = want;
      if (!ceil) m.userData[SUBWAY_WALL_TAG] = true;
      applyDecay(m, decay);
      return m;
    });
  }
}

// ---------------------------------------------------------------------------------------------
// The sets' section preload (behind the loading screen; never rejects)

/** The level the sets load as (assets/levelAssets.ts lets the Subway load exactly the mine-rock / pit-concrete sets). */
const LEVEL = 'subway';
/** How long the loading screen waits for the identity's sets (then the stand-in draws: never a stall). */
export const SUBWAY_IDENTITY_TEX_WAIT_MS = 6000;

export class SubwayIdentityTextures {
  readonly counts = {loaded: 0, missing: 0};
  constructor(readonly host: MarketTexHost) {}

  install(): this {
    this.host.sectionPreloads?.push(layout => (identitySlots(layout).length ? Promise.race([this.preload(layout), new Promise<void>(r => setTimeout(r, SUBWAY_IDENTITY_TEX_WAIT_MS))]) : Promise.resolve()));
    return this;
  }

  /** The rock / concrete set of a version-2 station (colour sRGB, normal + ORM linear), loaded as the Subway's own level resources. */
  async preload(layout: Pick<StationLayout, 'identity'>): Promise<void> {
    const slots = identitySlots(layout);
    for (const s of slots) for (const m of ['color', 'normal', 'orm'] as const) setCreviceTexture(s, m, null);
    await Promise.all(slots.flatMap(s => (['color', 'normal', 'orm'] as const).map(async m => {
      const t = await this.host.levelResources.load(LEVEL, CREVICE_TEXTURES[s][m], {srgb: m === 'color', repeat: true, anisotropy: m === 'color' ? 8 : 4}).catch(() => null);
      setCreviceTexture(s, m, t);
      if (t) this.counts.loaded++; else this.counts.missing++;
    })));
  }
}

/** Installs the identity sets' preload into a Game (one call in the Game constructor). */
export function installSubwayIdentityTextures(host: MarketTexHost): SubwayIdentityTextures {
  return new SubwayIdentityTextures(host).install();
}
