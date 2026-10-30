// Task office-overhaul-20261030 (lane ARCH): office architecture — feedback item 3 ("The office building uses the same walls
// as the subway station! The office building should... well look like an office building") and the tenant palettes.
//
// Root cause (before): levelGeometry.extractWallFaces gives every wall a finish from its area alone (public -> the station's
// glazed 'tile' with its dado, back-of-house -> the station's painted 'paint' block with the teal dado), the floors were the
// station's terrazzo / concrete under a carpet overlay, the ceilings the station's PBR 'ceilingService' under a drop-ceiling
// overlay, and the wall-detail pass gave office walls the station recipes (conduits, switch boxes, pipes, tile pilasters,
// spalled block). The Codex T4 office-wall texture was never loaded.
//
// Now every surface of the OFFICE storeys (the lobby, floors 2..8 and the roof: layout levels >= 1 of an office layout whose
// area is an office-storey area) resolves to an office finish key instead (the builder's office branches ask OfficeArch):
//  - walls: painted plasterboard (T4, its flaked patches show grey board where the paint has failed) per storey in the
//    tenant's wall colour, with skirting and the finish family's lower wall (chair-rail band, wood panelling, wet-room tile,
//    stone or board-marked concrete); ONE accent / feature wall per major room in the accent finish; washrooms tiled to door
//    height; the stair / closet core painted concrete with a dark lower band; the roof's parapets weathered precast concrete;
//  - floors: carpet tiles (T1, tenant-tinted) in offices / meeting rooms / corridors; hard floors where an office has them
//    (vinyl tiles in labs / clinics, ceramic in kitchens / break rooms, mosaic in washrooms, raised-floor tiles in server rooms,
//    sealed concrete in stores / closets / stair landings, stone in the lobby and luxury receptions, timber / polished
//    concrete in creative / industrial open plan, membrane + gravel on the roof);
//  - ceilings: suspended T-bar grid with T2 acoustic tiles (a few missing / water-stained), plain plaster (lobby, washrooms,
//    luxury, executive), exposed painted slab (industrial open plan), painted concrete (core); the roof has none;
//  - door frames: the tenant's trim colour (painted) or wood (warm-wood / luxury), not the station's steel.
// The lobby is company-neutral (light greige walls over a stone base, an oak feature wall, stone floor, plaster ceiling).
// Level 0 (the office's station storey) and the Subway never reach this module: their output is unchanged.
//
// Budget: materials per office storey = wall + accent + carpet (+ trim, + clinical vinyl), the rest are shared; every wall
// material is ONE program (the same TSL graph, per-material values read through materialReference), likewise every floor and
// every ceiling material; each layered with the 30-year decay hook (world/decay.ts). Materials are created once per
// WorldMaterials and re-valued per build (no rebuild). All are in the scene before the warm-up (render/warmup.ts discovers them).

import * as THREE from 'three';
import type {Node} from 'three/webgpu';
import {Fn, abs, clamp, dot, float, floor, fract, materialColor, max, min, mix, positionWorld, smoothstep, step, uv, vec2, vec3, vec4} from 'three/tsl';
import {CELL} from '../gen/grid';
import type {Level} from '../gen/levels';
import type {Area, StationLayout} from '../gen/stationTypes';
import type {CompanyId, TenantFinish, TenantPalette} from '../gen/office/overhaulTypes';
import {COMPANIES} from '../gen/office/companies';
import {loadOfficeTexture, type OfficeTextureId} from '../assets/officeAssets';
import {OFFICE_SURFACE_MEAN, officeSurface, type OfficeSurfaceName} from './canvasTextures';
import {SurfaceNodeMaterial, surfaceMaterial, thinTrim, type WorldMaterials} from './materials';
import {applyDecay, type DecayProfile} from './decay';
import {matRef, skipInShadowPass, wmHash, wmNoise} from './surfaceNodes';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyNode = any;

// ---------------------------------------------------------------------------------------------
// Styles (pure data: palette + finish family -> material parameters)

/** Finish family of an office storey: the tenant's, or the neutral lobby. */
export type OfficeFinishFamily = TenantFinish | 'lobby';

/** Lower-wall finish codes of the wall shader (ofP.w). */
export const LOWER = {none: 0, paint: 1, wood: 2, tile: 3, stone: 4, concrete: 5} as const;

/** One wall material's parameters (colours sRGB hex). */
export interface WallSpec {
  /** Upper wall paint. */
  paint: number;
  /** Lower wall / full-height feature finish colour. */
  lower: number;
  /** Skirting and rail colour. */
  trim: number;
  /** LOWER code of the lower wall. */
  kind: number;
  /** Top of the lower wall above the floor (m; >= 3.5 = full height). */
  lowerTop: number;
  /** Skirting height (m; 0 = none). */
  skirt: number;
  /** Rail / cap thickness at lowerTop (m; 0 = none). */
  rail: number;
  /** How much of the T4 paint failure shows (0..1). */
  peel: number;
  /** Panel / board width (m): wood panelling grooves, concrete board marks. */
  panel: number;
}

export type FloorKind = 'carpet' | 'vinyl' | 'tile' | 'wet' | 'stone' | 'concrete' | 'wood' | 'server' | 'core' | 'roof';
export type CeilingKind = 'grid' | 'plain' | 'raw' | 'core';

export interface OfficeStyle {
  finish: OfficeFinishFamily;
  wall: WallSpec;
  accent: WallSpec;
  /** Carpet tint (sRGB hex). */
  carpet: number;
  /** Clinical vinyl tint (sRGB hex; clinical storeys only). */
  vinyl: number;
  /** Floor of the open-plan areas, corridors and receptions / showrooms. */
  open: FloorKind;
  corridor: FloorKind;
  feature: FloorKind;
  /** Ceiling of the work areas (rooms always get a suspended ceiling: 'raw' -> 'grid' in rooms). */
  ceiling: CeilingKind;
  /** Door frame colour (sRGB hex) and whether it is timber. */
  trim: number;
  trimWood: boolean;
}

/** Neutral corporate palette (an office storey without tenant data). */
export const NEUTRAL_PALETTE: TenantPalette = {wall: 0xd6d2c8, accent: 0x55687a, floor: 0x5a626c, trim: 0x3b3e42, sign: 0xf2f2f2};
/** The company-neutral lobby. */
export const LOBBY_PALETTE: TenantPalette = {wall: 0xd8d0c2, accent: 0x8f6a44, floor: 0x5d6168, trim: 0x5e4e3c, sign: 0xf2efe8};

const OAK = 0x9a7148, WALNUT = 0x553a26, TRAVERTINE = 0xcdc3b1, MARBLE = 0xd8d3c9, CONCRETE = 0x8e8c86;

const HSL = {h: 0, s: 0, l: 0};
/** Clamp a colour's sRGB lightness / saturation (walls never neon or black, carpets never white). */
export function boundColor(hex: number, lMin: number, lMax: number, sMax: number): number {
  const c = new THREE.Color().setHex(hex, THREE.SRGBColorSpace);
  c.getHSL(HSL, THREE.SRGBColorSpace);
  c.setHSL(HSL.h, Math.min(HSL.s, sMax), Math.min(lMax, Math.max(lMin, HSL.l)), THREE.SRGBColorSpace);
  return c.getHex(THREE.SRGBColorSpace);
}
/** sRGB mix of two hex colours. */
export function mixColor(a: number, b: number, t: number): number {
  const ch = (x: number, s: number) => (x >> s) & 255;
  const m = (s: number) => Math.round(ch(a, s) + (ch(b, s) - ch(a, s)) * t) << s;
  return (m(16) | m(8) | m(0)) >>> 0;
}
const shade = (hex: number, k: number) => mixColor(hex, 0, 1 - k);

/** Material parameters of a storey from its tenant palette + finish family (bounded: see boundColor). */
export function officeStyle(p: TenantPalette, finish: OfficeFinishFamily): OfficeStyle {
  const wall = boundColor(p.wall, 0.22, 0.92, 0.4);
  const accent = boundColor(p.accent, 0.22, 0.72, 0.6);
  const carpet = boundColor(p.floor, 0.1, 0.62, 0.45);
  const trim = boundColor(p.trim, 0.1, 0.85, 0.35);
  const vinyl = boundColor(mixColor(p.floor, 0xf4f4f0, 0.55), 0.6, 0.88, 0.3);
  const W = (o: Partial<WallSpec>): WallSpec => ({paint: wall, lower: shade(wall, 0.84), trim, kind: LOWER.paint, lowerTop: 0.9, skirt: 0.1, rail: 0.035, peel: 0.45, panel: 0.6, ...o});
  const A = (o: Partial<WallSpec>): WallSpec => W({paint: accent, lower: accent, kind: LOWER.paint, lowerTop: 4, rail: 0, peel: 0.35, ...o});
  const base = {finish, carpet, vinyl, trim, trimWood: false, open: 'carpet' as FloorKind, corridor: 'carpet' as FloorKind, feature: 'carpet' as FloorKind, ceiling: 'grid' as CeilingKind};
  switch (finish) {
    case 'warm-wood': {
      const oak = mixColor(OAK, p.trim, 0.2);
      return {...base, wall: W({paint: boundColor(mixColor(wall, 0xe8d9bf, 0.25), 0.6, 0.9, 0.3), lower: oak, trim: shade(oak, 0.7), kind: LOWER.wood, lowerTop: 1.05, rail: 0.05, panel: 0.6}),
        accent: A({paint: oak, lower: mixColor(oak, 0xc79a68, 0.25), trim: shade(oak, 0.7), kind: LOWER.wood, panel: 0.15, peel: 0.2}), feature: 'wood', trim: shade(oak, 0.8), trimWood: true};
    }
    case 'industrial': {
      const raw = mixColor(CONCRETE, wall, 0.2);
      return {...base, wall: W({paint: raw, lower: raw, trim: 0x2e3134, kind: LOWER.concrete, lowerTop: 4, rail: 0, skirt: 0.08, peel: 0.15, panel: 1.2}),
        accent: A({trim: 0x2e3134, skirt: 0.08}), open: 'concrete', corridor: 'concrete', feature: 'concrete', ceiling: 'raw', trim: 0x2e3134};
    }
    case 'clinical': {
      const white = boundColor(mixColor(wall, 0xf4f4f2, 0.6), 0.8, 0.92, 0.12);
      const mint = boundColor(mixColor(accent, 0x9fd8c6, 0.45), 0.55, 0.8, 0.4);
      return {...base, wall: W({paint: white, lower: mint, trim: 0xc8ccc9, kind: LOWER.paint, lowerTop: 1.0, rail: 0.08, skirt: 0.1, peel: 0.35}),
        accent: A({paint: mint, lower: mint, trim: 0xc8ccc9}), open: 'vinyl', corridor: 'vinyl', feature: 'vinyl', trim: 0xc8ccc9};
    }
    case 'creative': {
      const bold = boundColor(p.accent, 0.3, 0.7, 0.7);
      return {...base, wall: W({kind: LOWER.none, lowerTop: 0, rail: 0, skirt: 0.08}), accent: A({paint: bold, lower: bold}), open: 'wood', feature: 'concrete'};
    }
    case 'luxury': {
      const greige = boundColor(mixColor(wall, 0xcfc4b2, 0.3), 0.6, 0.86, 0.22);
      return {...base, wall: W({paint: greige, lower: WALNUT, trim: shade(WALNUT, 0.75), kind: LOWER.wood, lowerTop: 1.1, rail: 0.06, panel: 0.45, peel: 0.3}),
        accent: A({paint: MARBLE, lower: mixColor(MARBLE, accent, 0.12), trim: shade(WALNUT, 0.75), kind: LOWER.stone, peel: 0.1}),
        feature: 'stone', corridor: 'carpet', ceiling: 'plain', trim: WALNUT, trimWood: true};
    }
    case 'lobby':
      return {...base, wall: W({paint: wall, lower: TRAVERTINE, trim: shade(0x5e4e3c, 0.9), kind: LOWER.stone, lowerTop: 1.2, rail: 0.03, skirt: 0, peel: 0.25}),
        accent: A({paint: OAK, lower: OAK, trim: shade(OAK, 0.7), kind: LOWER.wood, panel: 0.12, peel: 0.15, skirt: 0}),
        open: 'stone', corridor: 'stone', feature: 'stone', ceiling: 'plain', trim: 0x5e4e3c, trimWood: true};
    case 'corporate':
    default:
      return {...base, wall: W({}), accent: A({})};
  }
}

/** Shared walls: washroom tile, stair / closet core, roof parapets. */
export const WET_WALL: WallSpec = {paint: 0xe0ded8, lower: 0xd3d6d4, trim: 0x8d908f, kind: LOWER.tile, lowerTop: 2.1, skirt: 0, rail: 0.02, peel: 0.3, panel: 0.6};
export const CORE_WALL: WallSpec = {paint: 0xbdb9ae, lower: 0x6b726e, trim: 0x2f3133, kind: LOWER.paint, lowerTop: 1.0, skirt: 0.1, rail: 0.03, peel: 0.55, panel: 0.6};
export const ROOF_WALL: WallSpec = {paint: 0x8a8780, lower: 0x8a8780, trim: 0x2a2a2a, kind: LOWER.concrete, lowerTop: 9, skirt: 0.15, rail: 0, peel: 0, panel: 1.5};

/** Floor shader codes (ofP.w) and parameters per floor kind (colours sRGB hex; tile w x d m; seam m). */
const FLOOR_SPEC: Record<Exclude<FloorKind, 'carpet'>, {code: number; color: number; seam: number; w: number; d: number; tone: number; vary: number; rough: number; tile: number}> = {
  vinyl: {code: 1, color: 0xbcb6a9, seam: 0.002, w: 0.3, d: 0.3, tone: 0.07, vary: 0.35, rough: 0.5, tile: 0.3},
  tile: {code: 4, color: 0xa9a59c, seam: 0.006, w: 0.3, d: 0.3, tone: 0.08, vary: 0.3, rough: 0.4, tile: 0.3},
  wet: {code: 4, color: 0x8e9392, seam: 0.005, w: 0.2, d: 0.2, tone: 0.1, vary: 0.3, rough: 0.45, tile: 0.2},
  stone: {code: 2, color: 0xc4bdb1, seam: 0.003, w: 1.2, d: 0.6, tone: 0.12, vary: 0.5, rough: 0.32, tile: 0},
  concrete: {code: 3, color: 0x8e8b85, seam: 0.004, w: 2.4, d: 2.4, tone: 0.05, vary: 0.6, rough: 0.62, tile: 0},
  wood: {code: 5, color: 0x8a6a48, seam: 0.002, w: 1.2, d: 0.18, tone: 0.18, vary: 0.7, rough: 0.55, tile: 0},
  server: {code: 6, color: 0x9a9ea1, seam: 0.008, w: 0.6, d: 0.6, tone: 0.06, vary: 0.25, rough: 0.5, tile: 0.6},
  core: {code: 3, color: 0x6f726e, seam: 0, w: 50, d: 50, tone: 0, vary: 0.5, rough: 0.7, tile: 0},
  roof: {code: 7, color: 0x5d5b56, seam: 0.01, w: 1.0, d: 3.0, tone: 0.08, vary: 0.9, rough: 0.95, tile: 0},
};
const CEIL_SPEC: Record<CeilingKind, {code: number; color: number; bar: number; grid: number; missing: number; stain: number; rough: number}> = {
  grid: {code: 0, color: 0xf3efe7, bar: 0xd6d5cf, grid: 0.6, missing: 0.035, stain: 0.1, rough: 0.95},
  plain: {code: 1, color: 0xd9d5cc, bar: 0xd9d5cc, grid: 1, missing: 0, stain: 0, rough: 0.9},
  raw: {code: 2, color: 0x45484a, bar: 0x2f3133, grid: 2.4, missing: 0, stain: 0, rough: 0.85},
  core: {code: 3, color: 0x9a9890, bar: 0x9a9890, grid: 1, missing: 0, stain: 0, rough: 0.9},
};

// ---------------------------------------------------------------------------------------------
// Area classes (by type / purpose / label; robust to the tenant programs' new purposes)

export type AreaClass = 'work' | 'room' | 'corridor' | 'feature' | 'lobby' | 'kitchen' | 'lab' | 'utility' | 'server' | 'wet' | 'core' | 'roof';

/** What an office area is, for its finishes. `roof`: the area is on the roof storey. */
export function areaClass(a: Area | undefined, o: {roof?: boolean; lobby?: boolean} = {}): AreaClass {
  if (o.roof) return 'roof';
  if (!a) return 'work';
  const t = a.type as string;
  const s = `${t} ${a.purpose ?? ''} ${a.label ?? ''}`.toLowerCase();
  if (t === 'office-stair' || t === 'office-elevator' || t === 'stair-core' || t === 'exit-stair' || a.kind === 'closet' || t === 'janitor-closet' || t === 'supply-closet'
    || a.role === 'stair' || a.role === 'landing' || /stair|closet|riser|janitor|electrical|ladder|hatch/.test(s)) return 'core';
  if (t === 'washroom' || /wash ?room|toilet|restroom|\bwc\b|shower|locker/.test(s)) return 'wet';
  if (/server|data cent|data-cent|network|comms|\bit room/.test(s)) return 'server';
  if (/break(?!out)|kitchen|pantry|caf[eé]|canteen|dining|bakery|coffee|espresso|\bbar\b|test-kitchen/.test(s)) return 'kitchen';
  if (/\blab\b|laborator|clinic|medical|workshop|atelier|maker|garage|vet\b|grooming/.test(s)) return 'lab';
  if (/storage|archive|copy|mail|utility|supply|stock|plant room|mechanical|loading|vault/.test(s)) return 'utility';
  if (t === 'office-lobby') return o.lobby ? 'lobby' : 'feature';
  if (/reception|showroom|gallery|lobby/.test(s)) return o.lobby ? 'lobby' : 'feature';
  if (t === 'office-corridor' || a.kind === 'passage') return 'corridor';
  if (t === 'office-open') return 'work';
  return t === 'office-room' ? 'room' : 'work';
}

/** Floor kind of an area class in a storey style. */
export function floorKindFor(c: AreaClass, st: OfficeStyle): FloorKind {
  switch (c) {
    case 'roof': return 'roof';
    case 'core': return 'core';
    case 'wet': return 'wet';
    case 'server': return 'server';
    case 'kitchen': return 'tile';
    case 'lab': case 'utility': return 'vinyl';
    case 'lobby': return 'stone';
    case 'feature': return st.feature;
    case 'corridor': return st.corridor;
    case 'room': return 'carpet'; // private / meeting / executive rooms are carpeted in every finish
    case 'work': default: return st.open;
  }
}

/** Ceiling kind of an area class in a storey style (null = none: open sky). */
export function ceilingKindFor(c: AreaClass, st: OfficeStyle, area?: Area): CeilingKind | null {
  switch (c) {
    case 'roof': return null;
    case 'core': return 'core';
    case 'wet': case 'lobby': return 'plain';
    case 'room': return /exec/.test(`${area?.purpose ?? ''}`) || st.ceiling === 'plain' ? 'plain' : 'grid';
    case 'server': case 'kitchen': case 'lab': case 'utility': return st.ceiling === 'raw' ? 'grid' : st.ceiling;
    default: return st.ceiling;
  }
}

// ---------------------------------------------------------------------------------------------
// Shaders (module singletons: every office wall / floor / ceiling material shares one program per kind)

/** Texture span (m) of the office wall maps; wall uv x span = metres along / above the face base. */
export const OFFICE_WALL_SPAN = 2.4;
export const OFFICE_FLOOR_SPAN = 2.0;
export const OFFICE_CEIL_SPAN = 2.4;
const LUMA: AnyNode = vec3(0.2126, 0.7152, 0.0722);

/** The office surface material: per-material colours / parameters read by the shared office graphs. */
export class OfficeSurfaceMaterial extends SurfaceNodeMaterial {
  /** Primary colour (wall paint / floor tint / ceiling tint), linear. */
  readonly ofA = new THREE.Color(1, 1, 1);
  /** Secondary colour (lower wall / seam or grout / T-bar), linear. */
  readonly ofB = new THREE.Color(0.5, 0.5, 0.5);
  /** Trim colour (skirting / rail), linear. */
  readonly ofC = new THREE.Color(0.2, 0.2, 0.2);
  /** Wall: (skirt, lowerTop, rail, kind). Floor: (tile w, tile d, seam, kind). Ceiling: (grid, missing, stained, kind). */
  readonly ofP = new THREE.Vector4(0, 0, 0, 0);
  /** Wall: (peel, panel, map mean, -). Floor: (pattern strength, tone variation, map mean, -). Ceiling: (-, -, map mean, -). */
  readonly ofQ = new THREE.Vector4(0, 0.6, 0.4, 0);

  copy(source: this): this {
    super.copy(source);
    if (source.ofA) { this.ofA.copy(source.ofA); this.ofB.copy(source.ofB); this.ofC.copy(source.ofC); this.ofP.copy(source.ofP); this.ofQ.copy(source.ofQ); }
    return this;
  }
}

const ofA: AnyNode = matRef('ofA', 'color'), ofB: AnyNode = matRef('ofB', 'color'), ofC: AnyNode = matRef('ofC', 'color');
const ofP: AnyNode = matRef('ofP', 'vec4'), ofQ: AnyNode = matRef('ofQ', 'vec4');
/** 1 where the kind code equals k (codes are small integers held in floats). */
const isK = (kind: AnyNode, k: number): AnyNode => float(1).sub(step(0.5, abs(kind.sub(k))));
/** Distance (m) from a point in a cell of size `size` to the nearest cell edge. */
const edgeDist = (q: AnyNode, size: AnyNode): AnyNode => { const f = fract(q) as AnyNode; return min(min(f.x, f.x.oneMinus()).mul(size.x), min(f.y, f.y.oneMinus()).mul(size.y)); };

const shadowSafe = (full: AnyNode): AnyNode => skipInShadowPass(full as Node<'vec4'>, vec4(1, 1, 1, 1) as unknown as Node<'vec4'>, 'vec4');

/** Office wall colour: tinted plasterboard (T4), flaked paint to grey board, lower-wall finish, skirting, rail. */
const WALL_COLOR: AnyNode = shadowSafe(Fn(() => {
  const base = materialColor as AnyNode;
  const U = uv().mul(OFFICE_WALL_SPAN).toVar('ofWallUv');
  const s = U.x, h = U.y;
  const lum = dot(base.rgb, LUMA).toVar('ofLum');
  const detail = clamp(lum.div(max(ofQ.z, 0.05)), 0.55, 1.35).toVar('ofDetail');
  const pw = positionWorld as AnyNode;
  const nLow = (wmNoise(pw.mul(0.42)) as AnyNode).toVar('ofNLow');
  const panelW = max(ofQ.y, 0.05);
  const nGrain = (wmNoise((vec3 as AnyNode)(s.mul(6.5), h.mul(0.45), floor(s.div(panelW)).mul(1.7))) as AnyNode).toVar('ofNGrain');
  // The paint failed where T4 shows bare board, clustered by a broad noise (ofQ.x = how much of it shows).
  const peel = smoothstep(0.31, 0.23, lum).mul(smoothstep(0.62, 0.78, nLow.add(ofQ.x.mul(0.5)))).toVar('ofPeel');
  const board = vec3(0.3, 0.295, 0.28).mul(detail);
  const paint = mix(ofA.mul(detail), board, peel);
  const kind = ofP.w;
  const lowerPaint = mix(ofB.mul(detail), board, peel);
  // Wood panelling: vertical grain, grooves every panel width, a little T4 grime.
  const fs = fract(s.div(panelW));
  const groove = float(1).sub(smoothstep(0.004, 0.012, min(fs, fs.oneMinus()).mul(panelW)));
  const wood = ofB.mul(mix(0.78, 1.15, nGrain)).mul(mix(1, 0.45, groove)).mul(mix(1, detail, 0.3));
  // Wet-room tile: 200 mm squares, grey grout.
  const grout = float(1).sub(smoothstep(0.002, 0.005, edgeDist(vec2(s, h).div(0.2), vec2(0.2, 0.2))));
  const tile = mix(ofB.mul(mix(0.94, 1.04, nGrain)), ofB.mul(0.55), grout).mul(mix(1, detail, 0.25));
  // Stone panels 1.2 x 0.6 m: per-panel tone, soft veins, fine joints.
  const sq = vec2(s.div(1.2), h.div(0.6));
  const joint = float(1).sub(smoothstep(0.002, 0.006, edgeDist(sq, vec2(1.2, 0.6))));
  const vein = smoothstep(0.46, 0.5, nGrain).mul(float(1).sub(smoothstep(0.5, 0.54, nGrain)));
  const tone = wmHash((vec3 as AnyNode)(floor(sq.x), floor(sq.y), 5)) as AnyNode;
  const stone = ofB.mul(tone.mul(0.2).add(0.9)).mul(float(1).sub(vein.mul(0.25))).mul(float(1).sub(joint.mul(0.5))).mul(mix(1, detail, 0.2));
  // Board-marked concrete: mottle, tie holes on a 0.6 m grid, board joints every panel width.
  const tq = fract(vec2(s, h).div(0.6)).sub(0.5);
  const hole = float(1).sub(smoothstep(0.01, 0.016, tq.length().mul(0.6)));
  const boardJ = float(1).sub(smoothstep(0.003, 0.008, edgeDist(vec2(s.div(panelW), h.div(2.4)), vec2(panelW, 2.4))));
  const concrete = ofB.mul(mix(0.8, 1.12, nLow.mul(0.6).add(nGrain.mul(0.4)))).mul(mix(1, detail, 0.5)).mul(float(1).sub(hole.mul(0.55))).mul(float(1).sub(boardJ.mul(0.3)));
  const lower = paint.mul(isK(kind, LOWER.none)).add(lowerPaint.mul(isK(kind, LOWER.paint))).add(wood.mul(isK(kind, LOWER.wood)))
    .add(tile.mul(isK(kind, LOWER.tile))).add(stone.mul(isK(kind, LOWER.stone))).add(concrete.mul(isK(kind, LOWER.concrete)));
  const inLower = float(1).sub(step(ofP.y, h));
  const col = mix(paint, lower, inLower).toVar('ofWallCol');
  const rail = float(1).sub(step(ofP.z.mul(0.5), abs(h.sub(ofP.y)))).mul(step(0.001, ofP.z));
  const skirt = float(1).sub(step(ofP.x, h));
  const trim = ofC.mul(mix(0.92, 1.06, nGrain));
  const withTrim = mix(col, trim, max(rail, skirt));
  // Contact shadow just above the skirting.
  const above = h.sub(ofP.x);
  const line = float(1).sub(smoothstep(0.0, 0.025, above)).mul(step(0.0, above)).mul(step(0.001, ofP.x));
  return vec4(withTrim.mul(float(1).sub(line.mul(0.25))), base.a);
}, 'vec4')());

/** Office floor colour: carpet tiles (T1) or a hard floor over the neutral grain, joints / grout, per-tile tone. */
const FLOOR_COLOR: AnyNode = shadowSafe(Fn(() => {
  const base = materialColor as AnyNode;
  const P = (positionWorld as AnyNode).xz.toVar('ofFloorP');
  const kind = ofP.w;
  const size = max(ofP.xy, vec2(0.05, 0.05)).toVar('ofFloorSize');
  const row = floor(P.y.div(size.y));
  // Stone runs in half-bond, timber planks in a random bond; the rest stack-bonded.
  const stagger = isK(kind, 2).mul(0.5).add(isK(kind, 5).mul(fract(row.mul(0.371))));
  const Q = vec2(P.x.div(size.x).add(row.mul(stagger)), P.y.div(size.y)).toVar('ofFloorQ');
  const cell = floor(Q) as AnyNode;
  const d = edgeDist(Q, size);
  const seam = float(1).sub(smoothstep(ofP.z.mul(0.5), max(ofP.z, 1e-4), d)).mul(step(0.0005, ofP.z));
  const r = wmHash((vec3 as AnyNode)(cell.x, cell.y, 11)) as AnyNode;
  // Carpet tiles alternate their pile direction (checker of slightly different tones).
  const checker = fract(cell.x.add(cell.y).mul(0.5)).mul(4).sub(1).mul(isK(kind, 0)).mul(0.04);
  const tone = r.sub(0.5).mul(2).mul(ofQ.y).add(1).add(checker);
  const lum = dot(base.rgb, LUMA);
  const detail = clamp(lum.div(max(ofQ.z, 0.02)), 0.2, 2.6);
  const carpet = isK(kind, 0);
  const tex = mix(mix(1, detail, 0.55), mix(1, detail, 0.85), carpet);
  // Pattern noise: along the planks for timber, isotropic otherwise; gravel speckle on the roof.
  const ax = mix(2.2, 1.1, isK(kind, 5)), az = mix(2.2, 22, isK(kind, 5));
  const nF = wmNoise((vec3 as AnyNode)(P.x.mul(ax), P.y.mul(az), cell.y.mul(isK(kind, 5)).add(3))) as AnyNode;
  const vein = smoothstep(0.47, 0.5, nF).mul(float(1).sub(smoothstep(0.5, 0.53, nF))).mul(isK(kind, 2));
  // roof gravel: the grain map's speckle pushed hard (no extra noise on every other floor)
  const gravel = mix(1, clamp(detail.mul(detail), 0.3, 2.2), isK(kind, 7));
  const pattern = mix(1, mix(0.84, 1.14, nF), ofQ.x).mul(float(1).sub(vein.mul(0.3))).mul(gravel);
  const col = ofA.mul(tone).mul(tex).mul(pattern);
  return vec4(mix(col, ofB, seam), base.a);
}, 'vec4')());

/** Office ceiling colour: T-bar grid of T2 tiles (missing / stained ones), plain plaster, exposed slab, painted concrete. */
const CEIL_COLOR: AnyNode = shadowSafe(Fn(() => {
  const base = materialColor as AnyNode;
  const P = (positionWorld as AnyNode).xz.toVar('ofCeilP');
  const kind = ofP.w;
  const grid = max(ofP.x, 0.05);
  const Q = P.div(grid);
  const cell = floor(Q) as AnyNode;
  const d = edgeDist(Q, vec2(grid, grid));
  const gridK = isK(kind, 0);
  const bar = float(1).sub(smoothstep(0.008, 0.014, d)).mul(gridK);
  const r = wmHash((vec3 as AnyNode)(cell.x, cell.y, 21)) as AnyNode;
  const missing = step(r, ofP.y).mul(gridK);
  const stained = step(r, ofP.z).mul(float(1).sub(missing)).mul(gridK);
  const lum = dot(base.rgb, LUMA);
  const tileCol = base.rgb.mul(ofA).mul(mix(vec3(1, 1, 1), vec3(0.78, 0.7, 0.55), stained)).mul(r.mul(0.08).add(0.96));
  const gridCol = mix(mix(tileCol, vec3(0.012, 0.012, 0.013), missing), ofB, bar);
  const flat = ofA.mul(mix(1, clamp(lum.div(max(ofQ.z, 0.05)), 0.5, 1.6), 0.4));
  const bx = fract(P.x.div(2.4));
  const beam = float(1).sub(smoothstep(0.08, 0.1, min(bx, bx.oneMinus()).mul(2.4)));
  const raw = flat.mul(float(1).sub(beam.mul(0.35)));
  const col = gridCol.mul(gridK).add(flat.mul(isK(kind, 1).add(isK(kind, 3)))).add(raw.mul(isK(kind, 2)));
  return vec4(col, base.a);
}, 'vec4')());

// ---------------------------------------------------------------------------------------------
// Decay profiles (30-year patina on top of the office finishes)

const DP = (o: Partial<DecayProfile> & {tint: [number, number, number]}): DecayProfile =>
  ({grime: 0, streaks: 0, efflor: 0, stains: 0, wear: 0, dust: 0, cracks: 0, peel: 0, tile: 0, tileLoss: 0, fade: 0, paintWear: 0, ...o});
export const OFFICE_DECAY = {
  wall: DP({grime: 0.45, streaks: 0.35, efflor: 0.1, stains: 0.3, cracks: 0.18, fade: 0.3, tint: [0.6, 0.55, 0.47]}),
  carpet: DP({grime: 0.3, wear: 0.55, dust: 0.7, stains: 0.6, tint: [0.5, 0.45, 0.38]}),
  hard: DP({grime: 0.35, wear: 0.5, dust: 0.6, stains: 0.5, efflor: 0.1, cracks: 0.3, tileLoss: 0.04, tint: [0.5, 0.46, 0.4]}),
  ceiling: DP({grime: 0.3, stains: 0.75, efflor: 0.15, cracks: 0.2, peel: 0.25, fade: 0.2, tint: [0.6, 0.53, 0.42]}),
} as const;

const hardProfiles = new Map<number, DecayProfile>();
/** Hard-floor decay with per-tile damage on the floor's tile grid (one profile object per grid: applied once). */
function hardDecay(tile: number): DecayProfile {
  let p = hardProfiles.get(tile);
  if (!p) hardProfiles.set(tile, (p = tile > 0 ? {...OFFICE_DECAY.hard, tile} : OFFICE_DECAY.hard));
  return p;
}

// ---------------------------------------------------------------------------------------------
// Textures (Codex T1 / T2 / T4 when loaded, procedural canvas stand-ins otherwise)

const OFFICE_TEX: OfficeTextureId[] = ['office-wall', 'office-carpet', 'ceiling-tile'];
const loaded = new Map<OfficeTextureId, THREE.Texture>();
const MEAN: Record<OfficeTextureId, number> = {'office-wall': 0.4, 'office-carpet': 0.105, 'ceiling-tile': 0.42, 'cubicle-fabric': 0.2, skyline: 0.1, 'window-glass': 0.5};

/** Loads the office architecture textures (T4 wall, T1 carpet, T2 ceiling) once; never rejects. Register as a section preload. */
export async function preloadOfficeArch(layout?: Pick<StationLayout, 'office'> | null): Promise<void> {
  if (layout && !layout.office) return;
  await Promise.all(OFFICE_TEX.map(async id => { const t = await loadOfficeTexture(id); if (t) loaded.set(id, t); }));
}

/** Map (and its mean linear luminance) for an office surface: the loaded Codex texture, else the canvas stand-in, else none. */
function officeMap(id: OfficeTextureId | null, fallback: OfficeSurfaceName): {map: THREE.Texture | null; mean: number} {
  const t = id ? loaded.get(id) : undefined;
  if (t) return {map: t, mean: MEAN[id!]};
  if (typeof document === 'undefined') return {map: null, mean: 1};
  try { return {map: officeSurface(fallback), mean: OFFICE_SURFACE_MEAN[fallback]}; } catch { return {map: null, mean: 1}; }
}

// ---------------------------------------------------------------------------------------------
// Material registry (once per WorldMaterials; re-valued per build)

type Kind = 'wall' | 'floor' | 'ceiling';
const registries = new WeakMap<WorldMaterials, Map<string, THREE.Material>>();
const lin = (c: THREE.Color, hex: number) => c.setHex(hex, THREE.SRGBColorSpace);

function officeMaterial(mats: WorldMaterials, key: string, kind: Kind): OfficeSurfaceMaterial {
  let reg = registries.get(mats);
  if (!reg) registries.set(mats, (reg = new Map()));
  let m = reg.get(key) as OfficeSurfaceMaterial | undefined;
  if (m) return m;
  m = new OfficeSurfaceMaterial({roughness: 0.9, metalness: 0});
  m.name = key;
  m.colorNode = kind === 'wall' ? WALL_COLOR : kind === 'floor' ? FLOOR_COLOR : CEIL_COLOR;
  m.userData.officeArch = kind;
  reg.set(key, m);
  return m;
}

function setMap(m: OfficeSurfaceMaterial, src: {map: THREE.Texture | null; mean: number}): void {
  if (m.map !== src.map) { m.map = src.map; m.needsUpdate = true; }
  m.ofQ.z = src.mean;
}

function decayOnce(m: THREE.Material, p: DecayProfile): void {
  if (m.userData.officeDecay === p) return;
  m.userData.officeDecay = p;
  applyDecay(m, p);
}

export function wallMaterial(mats: WorldMaterials, key: string, w: WallSpec): OfficeSurfaceMaterial {
  const m = officeMaterial(mats, key, 'wall');
  setMap(m, officeMap('office-wall', 'drywall'));
  lin(m.ofA, w.paint); lin(m.ofB, w.lower); lin(m.ofC, w.trim);
  m.ofP.set(w.skirt, w.lowerTop, w.rail, w.kind);
  m.ofQ.x = w.peel; m.ofQ.y = w.panel;
  m.roughness = w.kind === LOWER.stone ? 0.55 : w.kind === LOWER.tile ? 0.4 : 0.88;
  decayOnce(m, OFFICE_DECAY.wall);
  return m;
}

export function floorMaterial(mats: WorldMaterials, key: string, kind: FloorKind, tint?: number): OfficeSurfaceMaterial {
  const m = officeMaterial(mats, key, 'floor');
  if (kind === 'carpet') {
    setMap(m, officeMap('office-carpet', 'carpet'));
    lin(m.ofA, tint ?? NEUTRAL_PALETTE.floor);
    // the carpet map is a mid-blue-grey loop pile: tint relative to its own tone (mean-normalised luminance)
    lin(m.ofB, shade(tint ?? NEUTRAL_PALETTE.floor, 0.72));
    m.ofP.set(0.5, 0.5, 0.004, 0);
    m.ofQ.x = 0; m.ofQ.y = 0.06;
    m.roughness = 1;
    decayOnce(m, OFFICE_DECAY.carpet);
  } else {
    const f = FLOOR_SPEC[kind];
    setMap(m, officeMap(null, 'grain'));
    lin(m.ofA, tint ?? f.color);
    lin(m.ofB, shade(tint ?? f.color, kind === 'tile' || kind === 'wet' ? 0.5 : 0.62));
    m.ofP.set(f.w, f.d, f.seam, f.code);
    m.ofQ.x = f.vary; m.ofQ.y = f.tone;
    m.roughness = f.rough;
    decayOnce(m, hardDecay(f.tile));
  }
  return m;
}

export function ceilingMaterial(mats: WorldMaterials, key: string, kind: CeilingKind): OfficeSurfaceMaterial {
  const m = officeMaterial(mats, key, 'ceiling');
  const c = CEIL_SPEC[kind];
  setMap(m, kind === 'grid' ? officeMap('ceiling-tile', 'ceilingTile') : officeMap(null, 'grain'));
  lin(m.ofA, c.color); lin(m.ofB, c.bar);
  m.ofP.set(c.grid, c.missing, c.stain, c.code);
  m.roughness = c.rough;
  decayOnce(m, OFFICE_DECAY.ceiling);
  return m;
}

/** Door frame trim of a storey (world-mapped painted panel or veneer: the existing world-mapped program). */
function trimMaterial(mats: WorldMaterials, key: string, color: number, wood: boolean): THREE.Material {
  let reg = registries.get(mats);
  if (!reg) registries.set(mats, (reg = new Map()));
  const k = `${key}|${wood ? 'wood' : 'paint'}`;
  let m = reg.get(k) as SurfaceNodeMaterial | undefined;
  if (!m) {
    m = thinTrim(surfaceMaterial(wood ? 'woodVeneer' : 'paintedPanel', {roughness: 1}, {grime: [0.2, 0.4], macro: 0.1}));
    m.name = key;
    reg.set(k, m);
  }
  m.color.setHex(wood ? mixColor(color, 0xffffff, 0.35) : color, THREE.SRGBColorSpace);
  return m;
}

// ---------------------------------------------------------------------------------------------
// The builder's view of the office architecture

const isOfficeKey = (k: string) => k.startsWith('office-');
const CARPET_RE = /^office-carpet@/;

interface FaceLike {
  level: number; area: number; finish: string; x0: number; z0: number; x1: number; z1: number; nx: number; nz: number;
  y0: number; y1: number; openings: {s0: number; s1: number; top: number}[]; slope?: unknown; vb0?: number; vb1?: number;
}

/**
 * Office architecture of one layout: storey styles (tenant palettes), surface key resolution for the builder's office
 * branches, the materials behind those keys and the window reveals. `OfficeArch.for` returns null without layout.office.
 */
export class OfficeArch {
  /** Roof deck y (the roof storey), or null. */
  readonly roofY: number | null;
  readonly roofLevel: number | null;
  readonly lobbyLevel: number;
  /** Storey style per level id (lobby + office floors + roof). */
  readonly styles = new Map<number, OfficeStyle>();
  /** Floor number per level id. */
  private readonly floorOf = new Map<number, number>();
  private readonly materials = new Map<string, THREE.Material>();
  private readonly specs = new Map<string, () => THREE.Material>();
  /** Accent faces chosen per area (diagnostics / tests). */
  readonly accents = new Map<number, string>();
  /** Floor key per (level, area) (the builder asks per cell). */
  private readonly floorCache = new Map<number, string | null>();

  static for(layout: StationLayout, mats: WorldMaterials, levels: readonly Level[]): OfficeArch | null {
    return layout.office ? new OfficeArch(layout, mats, levels) : null;
  }

  private constructor(readonly layout: StationLayout, readonly mats: WorldMaterials, readonly levels: readonly Level[]) {
    const info = layout.office!;
    for (const s of info.storeys) this.floorOf.set(s.levelId, s.floor);
    this.lobbyLevel = info.storeys.find(s => s.floor === 1)?.levelId ?? 1;
    const roofRole = levels.find(l => (l.role as string) === 'roof');
    this.roofLevel = info.roof?.level ?? roofRole?.id ?? null;
    this.roofY = info.roof?.baseY ?? (roofRole ? roofRole.baseY : null);
    // Tenant of each storey: layout.office.tenants (lane TENANTS), else the company stamped on its areas (Area.tenant).
    const tenants = new Map<number, {palette: TenantPalette; finish: TenantFinish}>((info.tenants ?? []).map(t => [t.floor, t]));
    const byArea = new Map<number, CompanyId>();
    for (const a of layout.areas) if (a.tenant && !byArea.has(a.level ?? 0)) byArea.set(a.level ?? 0, a.tenant);
    for (const L of levels) {
      if (L.id < 1) continue;
      const floor = this.floorOf.get(L.id) ?? L.id;
      const company = byArea.has(L.id) ? COMPANIES[byArea.get(L.id)!] : undefined;
      const t = tenants.get(floor) ?? (company ? {palette: company.palette, finish: company.finish} : undefined);
      const st = L.id === this.lobbyLevel ? officeStyle(LOBBY_PALETTE, 'lobby') : t ? officeStyle(t.palette, t.finish) : officeStyle(NEUTRAL_PALETTE, 'corporate');
      this.styles.set(L.id, st);
    }
  }

  /** The level an area / cell belongs to for finishes, or -1 when it is not an office-storey surface (station, Subway). */
  private officeLevel(area: Area | undefined, gridLevel: number): number {
    if (gridLevel < 1) return -1;
    if (area && (area.level ?? 0) < 1) return -1; // a station area seen on an upper grid (the transit flights): station look
    return area?.level ?? gridLevel;
  }

  private classOf(area: Area | undefined, level: number): AreaClass {
    return areaClass(area, {roof: level === this.roofLevel, lobby: level === this.lobbyLevel});
  }

  styleOf(level: number): OfficeStyle {
    return this.styles.get(level) ?? officeStyle(NEUTRAL_PALETTE, 'corporate');
  }

  /** Register a lazily built material behind a key. */
  private def(key: string, make: () => THREE.Material): string {
    if (!this.specs.has(key)) this.specs.set(key, make);
    return key;
  }

  private wallKey(level: number, cls: AreaClass, accent = false): string {
    if (cls === 'roof') return this.def('office-roof', () => wallMaterial(this.mats, 'office-roof', ROOF_WALL));
    if (cls === 'core') return this.def('office-core', () => wallMaterial(this.mats, 'office-core', CORE_WALL));
    if (cls === 'wet') return this.def('office-wet', () => wallMaterial(this.mats, 'office-wet', WET_WALL));
    const st = this.styleOf(level);
    const key = `office-${accent ? 'accent' : 'wall'}@${level}`;
    return this.def(key, () => wallMaterial(this.mats, key, accent ? st.accent : st.wall));
  }

  private floorKeyOf(level: number, kind: FloorKind): string {
    const st = this.styleOf(level);
    if (kind === 'carpet') { const key = `office-carpet@${level}`; return this.def(key, () => floorMaterial(this.mats, key, 'carpet', st.carpet)); }
    if (kind === 'vinyl' && st.finish === 'clinical') { const key = `office-vinyl@${level}`; return this.def(key, () => floorMaterial(this.mats, key, 'vinyl', st.vinyl)); }
    const key = `office-floor-${kind}`;
    return this.def(key, () => floorMaterial(this.mats, key, kind));
  }

  private ceilKeyOf(kind: CeilingKind): string {
    const key = `office-ceil-${kind}`;
    return this.def(key, () => ceilingMaterial(this.mats, key, kind));
  }

  // --- builder hooks ------------------------------------------------------------------------

  /**
   * Office finishes for the builder's wall faces (station / Subway faces pass unchanged): the storey wall, the accent wall
   * (one per major room), washroom tile, the core, the roof. Faces split at the station tile line keep one texture base.
   */
  remapFaces<F extends FaceLike>(faces: F[], tileLowerHeight: number): F[] {
    const areas = this.layout.areas;
    const out = faces.map(f => {
      const a = f.area >= 0 ? areas[f.area] : undefined;
      const lv = this.officeLevel(a, f.level);
      if (lv < 0) return f;
      const cls = f.slope ? 'core' : this.classOf(a, lv);
      const finish = this.wallKey(lv, cls);
      const up = /tileUpper/.test(f.finish) && f.vb0 !== undefined ? {vb0: f.vb0 - tileLowerHeight, vb1: (f.vb1 ?? f.vb0) - tileLowerHeight} : {};
      return {...f, finish, ...up};
    });
    this.pickAccents(out);
    return out;
  }

  /** One accent / feature wall per major room: its longest solid, full-height, interior (non-facade) wall. */
  private pickAccents<F extends FaceLike>(faces: F[]): void {
    const info = this.layout.office!;
    const facade = new Set(info.windows.map(w => {
      const alongX = w.side === 'N' || w.side === 'S';
      const plane = w.side === 'N' ? w.z1 : w.side === 'S' ? w.z0 : w.side === 'W' ? w.x1 : w.x0;
      return `${w.level}|${alongX ? 'z' : 'x'}|${plane.toFixed(2)}`;
    }));
    // Group the faces of one wall (tile-line splits share level / area / plane / span).
    const groups = new Map<string, number[]>();
    faces.forEach((f, i) => {
      if (!/^office-wall@/.test(f.finish) || f.slope) return;
      const k = `${f.level}|${f.area}|${f.nx}|${f.nz}|${f.x0.toFixed(3)}|${f.z0.toFixed(3)}|${f.x1.toFixed(3)}|${f.z1.toFixed(3)}`;
      let g = groups.get(k);
      if (!g) groups.set(k, (g = []));
      g.push(i);
    });
    const best = new Map<number, {k: string; score: number}>();
    for (const [k, idx] of groups) {
      const f0 = faces[idx[0]];
      const a = this.layout.areas[f0.area];
      if (!a) continue;
      const lv = this.officeLevel(a, f0.level);
      const cls = this.classOf(a, lv);
      if (!(cls === 'room' || cls === 'work' || cls === 'feature' || cls === 'lobby' || cls === 'kitchen')) continue;
      if (a.w * a.h * CELL * CELL < 10) continue;
      const alongX = Math.abs(f0.z0 - f0.z1) < 1e-9;
      if (facade.has(`${f0.level}|${alongX ? 'z' : 'x'}|${(alongX ? f0.z0 : f0.x0).toFixed(2)}`)) continue;
      const y0 = Math.min(...idx.map(i => faces[i].y0)), y1 = Math.max(...idx.map(i => faces[i].y1));
      if (idx.some(i => faces[i].openings.length)) continue;
      const base = faces[idx[0]].vb0 ?? y0;
      if (y0 > base + 0.05 || y1 - y0 < 2.0) continue;
      const len = Math.hypot(f0.x1 - f0.x0, f0.z1 - f0.z0);
      if (len < 2.0) continue;
      const score = len + ((f0.x0 * 7.3 + f0.z0 * 3.1) % 1) * 0.01;
      const cur = best.get(f0.area);
      if (!cur || score > cur.score) best.set(f0.area, {k, score});
    }
    for (const [area, {k}] of best) {
      const lv = this.officeLevel(this.layout.areas[area], faces[groups.get(k)![0]].level);
      for (const i of groups.get(k)!) (faces[i] as {finish: string}).finish = this.wallKey(lv, 'work', true);
      this.accents.set(area, k);
    }
  }

  /** Floor key of an open cell of level index L (null: not an office surface, the builder's own rule applies). */
  floorKey(L: number, i: number): string | null {
    const lvl = this.levels[L];
    if (!lvl || lvl.id < 1) return null;
    const id = lvl.grid.area[i];
    const ck = lvl.id * 1048576 + id + 1;
    let k = this.floorCache.get(ck);
    if (k === undefined) {
      const a = id >= 0 ? this.layout.areas[id] : undefined;
      const lv = this.officeLevel(a, lvl.id);
      k = lv < 0 ? null : this.floorKeyOf(lv, floorKindFor(this.classOf(a, lv), this.styleOf(lv)));
      this.floorCache.set(ck, k);
    }
    return k;
  }

  /** Ceiling key of a ceiling run (null: builder rule; false: no ceiling, the open roof). */
  ceilKey(L: number, areaId: number, i?: number): string | false | null {
    const lvl = this.levels[L];
    if (!lvl || lvl.id < 1) return null;
    const a = areaId >= 0 ? this.layout.areas[areaId] : undefined;
    const lv = this.officeLevel(a, lvl.id);
    if (lv < 0) return null;
    const cls = this.classOf(a, lv);
    const kind = ceilingKindFor(cls, this.styleOf(lv), a);
    if (kind === null) {
      // The open roof deck has no ceiling; an enclosed low structure on the roof (a hatch housing) keeps one.
      const g = lvl.grid;
      if (i !== undefined && g.hasCeil(i) && g.ceil[i] - g.floorOf(i) < 3.2) return this.ceilKeyOf('core');
      return false;
    }
    return this.ceilKeyOf(kind);
  }

  /** Soffit of a door opening on an office storey: plain plaster (core in the core). */
  doorCeilKey(L: number, a: Area | undefined, b: Area | undefined): string | null {
    const lvl = this.levels[L];
    if (!lvl || lvl.id < 1 || this.officeLevel(a, lvl.id) < 0 || this.officeLevel(b, lvl.id) < 0) return null;
    const core = this.classOf(a, lvl.id) === 'core' && this.classOf(b, lvl.id) === 'core';
    return this.ceilKeyOf(core ? 'core' : 'plain');
  }

  /** Door frame trim of an office storey door (null: the station's steel). */
  doorTrimKey(level: number, a: Area | undefined): string | null {
    if (level < 1 || this.officeLevel(a, level) < 0) return null;
    const st = this.styleOf(level);
    const core = this.classOf(a, level) === 'core';
    const key = `office-trim@${core ? 'core' : level}`;
    return this.def(key, () => trimMaterial(this.mats, key, core ? 0x3a3d40 : st.trim, core ? false : st.trimWood));
  }

  /** Texture scale (m per repeat) of an office key; undefined for any other key. */
  scale(key: string): {u: number; v: number} | undefined {
    if (!isOfficeKey(key)) return undefined;
    if (/^office-(carpet|vinyl|floor)/.test(key)) return {u: OFFICE_FLOOR_SPAN, v: OFFICE_FLOOR_SPAN};
    if (/^office-ceil/.test(key)) return {u: OFFICE_CEIL_SPAN, v: OFFICE_CEIL_SPAN};
    if (/^office-trim/.test(key)) return {u: 1, v: 1};
    return {u: OFFICE_WALL_SPAN, v: OFFICE_WALL_SPAN};
  }

  /** The material behind an office key (built on first use); undefined for any other key. */
  material(key: string): THREE.Material | undefined {
    if (!isOfficeKey(key)) return undefined;
    let m = this.materials.get(key);
    if (!m) {
      const make = this.specs.get(key);
      if (!make) return undefined;
      this.materials.set(key, (m = make()));
    }
    return m;
  }

  /** Mesh name for an office key's architecture meshes (carpet / suspended ceilings keep the iteration-16 names). */
  meshName(key: string): string | undefined {
    if (CARPET_RE.test(key)) return 'office-carpet';
    if (key === 'office-ceil-grid' || key === 'office-ceil-plain') return 'office-drop-ceiling';
    return undefined;
  }

  /** Every office material this build uses so far (diagnostics / tests). */
  usedMaterials(): Map<string, THREE.Material> {
    for (const k of this.specs.keys()) this.material(k);
    return new Map(this.materials);
  }

  /** Window reveals (head soffit, sill, jambs) in the storey wall finish, the entrance threshold in concrete. Returns meshes added. */
  buildReveals(group: THREE.Group): number {
    const info = this.layout.office!;
    let n = 0;
    const byLevel = new Map<number, {rev: Quads; thr: Quads}>();
    const S = OFFICE_WALL_SPAN;
    for (const w of info.windows) {
      let q = byLevel.get(w.level);
      if (!q) byLevel.set(w.level, (q = {rev: new Quads(), thr: new Quads()}));
      const {rev, thr} = q;
      const ya = w.baseY + w.sill, yb = w.baseY + w.head;
      const alongX = w.side === 'N' || w.side === 'S';
      const [i0, i1] = alongX ? [w.z0, w.z1] : [w.x0, w.x1];
      const [s0, s1] = alongX ? [w.x0, w.x1] : [w.z0, w.z1];
      const P = (s: number, y: number, d: number): number[] => (alongX ? [s, y, d] : [d, y, s]);
      // v held above every lower-wall finish (h = 3.2 .. 3.7 m in the wall shader): reveals read as plain paint.
      const uvs = (a: number, b: number, c: number, d: number) => [[a / S, (3.2 + b - i0) / S], [c / S, (3.2 + b - i0) / S], [c / S, (3.2 + d - i0) / S], [a / S, (3.2 + d - i0) / S]];
      rev.quad([P(s0, yb, i0), P(s1, yb, i0), P(s1, yb, i1), P(s0, yb, i1)], [0, -1, 0], uvs(s0, i0, s1, i1));
      (w.sill > 0.01 ? rev : thr).quad([P(s0, ya, i1), P(s1, ya, i1), P(s1, ya, i0), P(s0, ya, i0)], [0, 1, 0], w.sill > 0.01 ? uvs(s0, i0, s1, i1) : [[s0 / 2, i0 / 2], [s1 / 2, i0 / 2], [s1 / 2, i1 / 2], [s0 / 2, i1 / 2]]);
      for (const [s, sgn] of [[s0, 1], [s1, -1]] as const) {
        const nrm = alongX ? [sgn, 0, 0] : [0, 0, sgn];
        // jambs: v compressed into the same paint band (h = 3.2 .. 3.7 m) whatever the opening height
        const jv = (y: number) => (3.2 + 0.2 * (y - ya)) / S;
        rev.quad([P(s, ya, i0), P(s, ya, i1), P(s, yb, i1), P(s, yb, i0)], nrm, [[i0 / S, jv(ya)], [i1 / S, jv(ya)], [i1 / S, jv(yb)], [i0 / S, jv(yb)]]);
      }
    }
    for (const [lv, {rev, thr}] of [...byLevel].sort((a, b) => a[0] - b[0])) {
      const wall = this.material(this.wallKey(lv, 'work'))!;
      const conc = this.material(this.floorKeyOf(lv, 'core'))!;
      const r = rev.mesh(wall, 'office-window-reveals', lv);
      if (r) { group.add(r); n++; }
      const t = thr.mesh(conc, 'office-entrance-threshold', lv);
      if (t) { group.add(t); n++; }
    }
    return n;
  }

  /** Summary (QA / tests): storey styles and the material count. */
  summary(): {storeys: {level: number; finish: OfficeFinishFamily; wall: string; accent: string; carpet: string}[]; materials: number; accents: number} {
    const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
    return {
      storeys: [...this.styles].map(([level, s]) => ({level, finish: s.finish, wall: hex(s.wall.paint), accent: hex(s.accent.paint), carpet: hex(s.carpet)})),
      materials: this.usedMaterials().size, accents: this.accents.size,
    };
  }
}

/** Merged quads (wound counter-clockwise toward the normal). */
class Quads {
  pos: number[] = []; nor: number[] = []; uv: number[] = []; idx: number[] = [];
  quad(p: number[][], n: readonly number[], uv: number[][]): void {
    const ax = p[1][0] - p[0][0], ay = p[1][1] - p[0][1], az = p[1][2] - p[0][2];
    const bx = p[2][0] - p[0][0], by = p[2][1] - p[0][1], bz = p[2][2] - p[0][2];
    const dot3 = (ay * bz - az * by) * n[0] + (az * bx - ax * bz) * n[1] + (ax * by - ay * bx) * n[2];
    if (dot3 < 0) { p = [p[0], p[3], p[2], p[1]]; uv = [uv[0], uv[3], uv[2], uv[1]]; }
    const b = this.pos.length / 3;
    for (let i = 0; i < 4; i++) { this.pos.push(...p[i]); this.nor.push(...n); this.uv.push(...uv[i]); }
    this.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  mesh(mat: THREE.Material, name: string, level: number): THREE.Mesh | null {
    if (!this.idx.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, mat);
    m.name = name;
    m.userData.level = level;
    m.matrixAutoUpdate = false;
    m.updateMatrix();
    return m;
  }
}
