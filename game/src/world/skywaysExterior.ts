// Task studio-skyways-level-20261106-054448 (lane VIEW): WHAT THE SKYWAYS GLASS SHOWS — the city outside the pedway (SCENERY ONLY:
// the streets are solid in the grid, never walkable), a section runtime installed into Game like the tower runtime
// (world/towerRuntime.ts), inert without layout.skyways and disposed on teardown. Layers, all in real world coordinates:
//  - the STREET GROUND at groundY between the buildings (the exterior rect minus every footprint: no coplanar overlap with a lobby
//    floor), drawn with the Office's city-map ground material (world/exterior.ts): the Skyways streets are painted onto the plan's
//    city map as roads (their lane markings included) and a sidewalk band round every footprint, with dark curb stones along the
//    sidewalk edges (vertex-coloured, the exterior's stand-in prop material);
//  - the building SHELLS: each footprint from groundY to its `top` in the Office tower's curtain-wall facade material, ON the outer
//    wall faces (the builder draws no outward face there; the window reveals / glass sit inside the wall thickness, so nothing is
//    coplanar), facing outward (never drawn from inside a building); holes exactly where a bridge tube joins (the builder's own
//    facade faces inside the tube); an atrium building is a podium up to its atrium roof line (a cap with the opening cut out: the
//    glazed vault rises above it) and its tower over the largest strip beside the atrium, so the sky and the tower show through the
//    roof glass;
//  - the BRIDGE EXTERIORS: deck slab underside, roof, the side fascias with the window spans cut out, dark steel posts and chords
//    outside the glazing and an outward-facing glazing sheet in every span (the mall's roof glass, front side only: never seen from
//    inside; not on pre-breached bridges) — a bridge seen from another bridge is a closed glass tube;
//  - STREET WRECKS (lane ASSET-A's skyways-wreck-*.glb, nose +X like the Office car wreck): a seeded handful per street on the road
//    (never on a sidewalk, never under a bridge deck), instanced per model part;
//  - the FAR CITY, sky and green outdoor murk: world/exterior.ts planExterior / buildExterior around layout.skyways.exterior (ring
//    road, ruined blocks, the Office's Meshy heroes / bus / rubble when fetched — its ring-road cars the Skyways' lightest wreck —, the
//    skyline ghost, the dome following the eye), the camera far plane raised like the Office's.
// Fog: every exterior material is the Office's exteriorFog (indoor FogExp2 over the part of the ray inside EXT_U.box, the green height
// fog over the rest): per frame the box is the footprint the eye stands in (a bridge deck on a bridge); inside an atrium building every
// exterior ray counts as outdoor (EXT_U.roofY under the eye) so the sky through the vault is not swallowed by the indoor fog.
// Visibility: the whole exterior is hidden in the station / below the street and while no window span (the GAS lane's glazing plans)
// or atrium roof is in view (checked every SKYWAYS_EXT.checkS, in line of sight), like the tower's city. Not registered with the level
// culler (always-visible scenery with its own gate); registered as a warm-up pool (compiled even while hidden).
// Budget: shells 1 draw, bridges + curbs 1, bridge glazing 1, inner ground 1, wrecks 1 instanced draw per model part, + the Office city.
// (Task studio-skywalk-variety-20261107-231448-01, lane FACADE: the buildings' facade relief — world/skywaysFacade.ts — is merged
// into those same meshes: its curtain-wall panels into the shells, its vertex-coloured boxes into the bridges + curbs: no new draw.)
// Lighting: never the station light field (unlit, the exterior's fake outdoor light).

import * as THREE from 'three';
import {GLTFLoader, type GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {CELL} from '../gen/grid';
import {mulberry32} from '../core/rng';
import type {Side, StationLayout} from '../gen/stationTypes';
import type {SkywaysBridge, SkywaysInfo, SkywaysRect} from '../gen/skyways/skywaysTypes';
import {SKYWAYS_PROP_MODELS, type SkywaysPropModelKey} from '../assets/skywaysProps.generated';
import {loadOfficeAsset, loadOfficeTexture, type OfficeAssetId} from '../assets/officeAssets';
import {assetUrl} from '../assets/loader';
import type {WarmupRegistry} from '../render/warmup';
import type {WindowPlan} from './officeWindows';
import {
  EXTERIOR, EXT_U, buildExterior, facadeMaterial, fallbackPropGeometry, modelMaterial, modelParts, planExterior, propMaterial, setExteriorEye,
  setExteriorFootprint, setSkylineTexture, type ExteriorModels, type ExteriorPlan, type ExteriorView, type StreetRect,
} from './exterior';
import {preloadOfficeArch} from './officeArch';
import {roofGlass} from './mallArch';
import {emitFacadeBox, planSkywaysFacades, type SkywaysFacadePlan} from './skywaysFacade';

// ---------------------------------------------------------------------------------------------
// Constants

export const SKYWAYS_EXT = {
  /** Sidewalk band round every footprint (m). */
  sidewalk: 3,
  /** Curb stones: width (into the sidewalk) x height (m). */
  curb: {w: 0.18, h: 0.14},
  /** Bridge deck slab under the deck floor, roof over the ceiling (m). */
  deckDepth: 0.55, roofDepth: 0.45,
  /** Bridge steel outside the glazing: post width, depth proud of the fascia, chord height (m). */
  post: 0.2, frameDepth: 0.1, chord: 0.16,
  /** Wrecks per street (inclusive range) and their spacing pad (m). */
  wrecksMin: 2, wrecksMax: 3, wreckPad: 0.6,
  /** Clearance of a wreck from a bridge deck footprint (m). */
  bridgeClear: 1.5,
  /** Exterior visibility check period (s) and reach (m). */
  checkS: 0.12, reach: 80,
  /** Longest wait for the exterior assets before the world is built (ms; then: procedural stand-ins). */
  waitMs: 8000,
} as const;

/** Vertex colours (linear albedo) of the stand-in material parts. */
const CONCRETE: [number, number, number] = [0.3, 0.29, 0.27], STEEL: [number, number, number] = [0.07, 0.075, 0.08], CURB: [number, number, number] = [0.24, 0.235, 0.22];

/** The street wrecks (lane ASSET-A; SKYWAYS_PROP_MODELS dims: w = length along X, d = width) and their pick weights. */
export const WRECK_KEYS = ['skyways_wreck_sedan_stripped', 'skyways_wreck_sedan_rust', 'skyways_wreck_sedan_burnt', 'skyways_wreck_suv', 'skyways_wreck_army_truck'] as const satisfies readonly SkywaysPropModelKey[];
export type WreckKey = (typeof WRECK_KEYS)[number];
const WRECK_WEIGHTS: Record<WreckKey, number> = {skyways_wreck_sedan_stripped: 3, skyways_wreck_sedan_rust: 3, skyways_wreck_sedan_burnt: 3, skyways_wreck_suv: 3, skyways_wreck_army_truck: 1};

/**
 * The Office city's models (shared office assets, module-cached by assets/officeAssets.ts). Its ring-road cars are the Skyways' own
 * lightest wreck (CITY_CAR: the stripped sedan, 3.5k tris; same nose-+X convention) instead of the Office car wreck.
 */
const CITY_MODEL_IDS: Record<Exclude<keyof ExteriorModels, 'car'>, OfficeAssetId> = {bus: 'bus-wreck', rubble: 'rubble-pile', tower: 'ruined-tower', midrise: 'ruined-midrise'};
const CITY_CAR: WreckKey = 'skyways_wreck_sedan_stripped';

// ---------------------------------------------------------------------------------------------
// Plan (pure, deterministic per level seed)

/** An axis-aligned rectangle on a plane: axis 'x' (x = c; s = z, t = y), 'z' (z = c; s = x, t = y), 'y' (y = c; s = x, t = z); n = normal sign. */
export interface PlaneRect { axis: 'x' | 'y' | 'z'; c: number; s0: number; s1: number; t0: number; t1: number; n: 1 | -1 }
/** A box (stand-in parts: curbs, bridge steel) with its vertex colour. */
export interface ColorBox { x0: number; y0: number; z0: number; x1: number; y1: number; z1: number; color: [number, number, number] }

export interface ShellHole { side: Side; s0: number; s1: number; y0: number; y1: number; bridge: string }
export interface ShellPlan {
  building: string;
  /** Top of the full-footprint box (the building top, or the atrium roof line of an atrium building's podium). */
  podiumTop: number;
  /** An atrium building's tower over the largest strip beside its atrium (null: none / not an atrium building). */
  tower: SkywaysRect | null;
  top: number;
  holes: ShellHole[];
  faces: PlaneRect[];
}
export interface BridgePlan {
  bridge: string;
  axis: 'x' | 'z';
  /** Tube outer rect (the deck + its side wall cells), deck floor / ceiling, slab underside / roof top. */
  outer: SkywaysRect;
  deckY: number; ceilY: number; y0: number; y1: number;
  faces: PlaneRect[];
  steel: ColorBox[];
  /** Outward glazing sheets (uv: metres scaled so the bars land on the GAS lane's pane columns). */
  glass: {rect: PlaneRect; panes: number}[];
}
export interface WreckPlace { key: WreckKey; x: number; z: number; yaw: number; len: number; wid: number; street: number }

export interface SkywaysExteriorPlan {
  groundY: number;
  exterior: SkywaysRect;
  shells: ShellPlan[];
  bridges: BridgePlan[];
  /** Inner ground (the exterior rect minus every footprint) at groundY. */
  ground: SkywaysRect[];
  curbs: ColorBox[];
  wrecks: WreckPlace[];
  /** Roads + sidewalks painted onto the city map (added to `city.streets`). */
  streets: StreetRect[];
  /** The Office city around the complex (world/exterior.ts planExterior; `streets` appended). */
  city: ExteriorPlan;
  /** (lane FACADE) Each building's facade relief (world/skywaysFacade.ts), merged into the shells / bridges meshes. */
  facades: SkywaysFacadePlan[];
}

const inRect = (r: SkywaysRect, x: number, z: number, pad = 0) => x >= r.x0 - pad && x <= r.x1 + pad && z >= r.z0 - pad && z <= r.z1 + pad;
const grow = (r: SkywaysRect, d: number): SkywaysRect => ({x0: r.x0 - d, z0: r.z0 - d, x1: r.x1 + d, z1: r.z1 + d});
const area = (r: SkywaysRect) => Math.max(0, r.x1 - r.x0) * Math.max(0, r.z1 - r.z0);

/** [a, b] minus the given intervals (sorted, merged; pieces shorter than `min` dropped). */
export function subtractIntervals(a: number, b: number, cut: readonly [number, number][], min = 1e-3): [number, number][] {
  const cs = cut.map(([p, q]) => [Math.max(a, p), Math.min(b, q)] as [number, number]).filter(([p, q]) => q > p).sort((u, v) => u[0] - v[0]);
  const out: [number, number][] = [];
  let cur = a;
  for (const [p, q] of cs) { if (p > cur + min) out.push([cur, p]); cur = Math.max(cur, q); }
  if (b > cur + min) out.push([cur, b]);
  return out;
}

/** Rect (s0..s1 x t0..t1) minus holes: vertical slabs at the holes' s boundaries, each minus the t ranges covering it. */
export function subtractRects(s0: number, s1: number, t0: number, t1: number, holes: readonly {s0: number; s1: number; t0: number; t1: number}[]): {s0: number; s1: number; t0: number; t1: number}[] {
  const hs = holes.filter(h => h.s1 > s0 + 1e-6 && h.s0 < s1 - 1e-6 && h.t1 > t0 + 1e-6 && h.t0 < t1 - 1e-6);
  if (!hs.length) return [{s0, s1, t0, t1}];
  const xs = [...new Set([s0, s1, ...hs.flatMap(h => [Math.max(s0, h.s0), Math.min(s1, h.s1)])])].sort((a, b) => a - b);
  const out: {s0: number; s1: number; t0: number; t1: number}[] = [];
  for (let i = 0; i + 1 < xs.length; i++) {
    const a = xs[i], b = xs[i + 1];
    if (b - a < 1e-6) continue;
    const m = (a + b) / 2;
    for (const [p, q] of subtractIntervals(t0, t1, hs.filter(h => h.s0 <= m && h.s1 >= m).map(h => [h.t0, h.t1] as [number, number]))) {
      // merge with the previous slab when its t range is the same (fewer quads)
      const last = out.find(r => Math.abs(r.s1 - a) < 1e-6 && Math.abs(r.t0 - p) < 1e-6 && Math.abs(r.t1 - q) < 1e-6);
      if (last) last.s1 = b; else out.push({s0: a, s1: b, t0: p, t1: q});
    }
  }
  return out;
}

/** The exterior rect minus every footprint (x slabs at the footprint edges, merged when equal). */
export function groundRects(ext: SkywaysRect, foots: readonly SkywaysRect[]): SkywaysRect[] {
  return subtractRects(ext.x0, ext.x1, ext.z0, ext.z1, foots.map(f => ({s0: f.x0, s1: f.x1, t0: f.z0, t1: f.z1}))).map(r => ({x0: r.s0, z0: r.t0, x1: r.s1, z1: r.t1}));
}

/** The four walls (outward) of a box + its cap (minus `capHoles`), minus the wall holes (per side). */
function boxFaces(r: SkywaysRect, y0: number, y1: number, holes: readonly ShellHole[], capHoles: readonly SkywaysRect[], cap = true): PlaneRect[] {
  const out: PlaneRect[] = [];
  const wall = (side: Side) => {
    const axis = side === 'N' || side === 'S' ? 'z' : 'x';
    const c = side === 'N' ? r.z0 : side === 'S' ? r.z1 : side === 'W' ? r.x0 : r.x1;
    const n: 1 | -1 = side === 'S' || side === 'E' ? 1 : -1;
    const [s0, s1] = axis === 'z' ? [r.x0, r.x1] : [r.z0, r.z1];
    for (const q of subtractRects(s0, s1, y0, y1, holes.filter(h => h.side === side).map(h => ({s0: h.s0, s1: h.s1, t0: h.y0, t1: h.y1})))) out.push({axis, c, n, ...q});
  };
  for (const s of ['N', 'S', 'W', 'E'] as const) wall(s);
  if (cap) for (const q of subtractRects(r.x0, r.x1, r.z0, r.z1, capHoles.map(h => ({s0: h.x0, s1: h.x1, t0: h.z0, t1: h.z1})))) out.push({axis: 'y', c: y1, n: 1, ...q});
  return out;
}

/** The bridge holes in a building's facade: the tube's inner cross-section where a bridge deck meets its outer face. */
function bridgeHoles(b: {id: string; rect: SkywaysRect}, bridges: readonly BridgeRec[]): ShellHole[] {
  const out: ShellHole[] = [];
  const r = b.rect, e = 0.05;
  for (const br of bridges) {
    const d = br.rect;
    if (br.axis === 'z') {
      if (d.x1 <= r.x0 || d.x0 >= r.x1) continue;
      if (Math.abs(d.z0 - r.z1) < e) out.push({side: 'S', s0: d.x0, s1: d.x1, y0: br.deckY, y1: br.ceilY, bridge: br.id});
      if (Math.abs(d.z1 - r.z0) < e) out.push({side: 'N', s0: d.x0, s1: d.x1, y0: br.deckY, y1: br.ceilY, bridge: br.id});
    } else {
      if (d.z1 <= r.z0 || d.z0 >= r.z1) continue;
      if (Math.abs(d.x0 - r.x1) < e) out.push({side: 'E', s0: d.z0, s1: d.z1, y0: br.deckY, y1: br.ceilY, bridge: br.id});
      if (Math.abs(d.x1 - r.x0) < e) out.push({side: 'W', s0: d.z0, s1: d.z1, y0: br.deckY, y1: br.ceilY, bridge: br.id});
    }
  }
  return out;
}

/** (springY: task studio-skyways-rework-20261107-054512-01, lane ARCH — a glazed roof springs there: no opaque roof, fascias stop under it) */
interface BridgeRec { id: string; axis: 'x' | 'z'; rect: SkywaysRect; deckY: number; ceilY: number; breached: boolean; springY?: number }

/** An atrium building's tower: the largest strip of the footprint beside the atrium (at least 6 m deep), else null. */
export function towerStrip(r: SkywaysRect, atrium: SkywaysRect): SkywaysRect | null {
  const gap = 1.5; // the tower stands back from the opening
  const strips: SkywaysRect[] = [
    {x0: r.x0, z0: r.z0, x1: r.x1, z1: atrium.z0 - gap}, {x0: r.x0, z0: atrium.z1 + gap, x1: r.x1, z1: r.z1},
    {x0: r.x0, z0: r.z0, x1: atrium.x0 - gap, z1: r.z1}, {x0: atrium.x1 + gap, z0: r.z0, x1: r.x1, z1: r.z1},
  ].filter(s => s.x1 - s.x0 >= 6 && s.z1 - s.z0 >= 6);
  strips.sort((a, b) => area(b) - area(a) || a.x0 - b.x0 || a.z0 - b.z0);
  return strips[0] ?? null;
}

/** Plans the whole exterior of a Skyways layout (deterministic per layout.seed). */
export function planSkywaysExterior(layout: StationLayout): SkywaysExteriorPlan {
  const info = layout.skyways!;
  const gy = info.groundY, ext = info.exterior;
  const storeyY = (lv: number) => info.storeys.find(s => s.level === lv)?.baseY ?? lv * 5;
  const bridges: BridgeRec[] = info.bridges.map(b => {
    const deckY = storeyY(b.level);
    const ceil = layout.areas[b.area]?.ceil;
    return {id: b.id, axis: b.axis, rect: b.rect, deckY, ceilY: ceil !== undefined && ceil > deckY + 2 ? ceil : deckY + 3.5, breached: b.breached, ...(b.roof ? {springY: b.roof.springY} : {})};
  });
  // --- shells ---
  const shells: ShellPlan[] = info.buildings.map(b => {
    const holes = bridgeHoles(b, bridges);
    if (b.atrium) {
      const podiumTop = Math.max(b.atrium.roofY, storeyY(2) + 4);
      const tower = b.top > podiumTop + 3 ? towerStrip(b.rect, b.atrium.rect) : null;
      const faces = boxFaces(b.rect, gy, podiumTop, holes, [b.atrium.rect]);
      if (tower) faces.push(...boxFaces(tower, podiumTop, b.top, [], []));
      return {building: b.id, podiumTop, tower, top: tower ? b.top : podiumTop, holes, faces};
    }
    return {building: b.id, podiumTop: b.top, tower: null, top: b.top, holes, faces: boxFaces(b.rect, gy, b.top, holes, [])};
  });
  // --- bridges ---
  const plans: BridgePlan[] = bridges.map(br => planBridge(br, info));
  // --- ground, sidewalks, curbs ---
  const foots = info.buildings.map(b => b.rect);
  const walks = foots.map(f => grow(f, SKYWAYS_EXT.sidewalk));
  const ground = groundRects(ext, foots);
  const curbs = planCurbs(ext, foots, walks, gy);
  const streets: StreetRect[] = [
    ...info.streets.map(s => ({kind: 'road' as const, ...s.rect})),
    ...walks.map(w => ({kind: 'walk' as const, ...w})),
  ];
  // --- wrecks ---
  const wrecks = planWrecks(info, walks, (layout.seed ^ 0x5c1e7a) >>> 0);
  // --- the Office city around the complex ---
  const city = planExterior({foot: ext, groundY: gy, eyeAbove: storeyY(2) + 1.6 - gy, seed: layout.seed >>> 0});
  city.streets.push(...streets);
  // --- (lane FACADE) the facade relief, clear of every bridge tube (outer cross-section, slab underside to roof glass / slab) ---
  const tubes = bridges.map(br => {
    const apex = info.bridges.find(q => q.id === br.id)?.roof?.apexY ?? -Infinity;
    return {id: br.id, rect: bridgeOuter(br), y0: br.deckY - SKYWAYS_EXT.deckDepth, y1: Math.max(apex + 0.3, br.ceilY + SKYWAYS_EXT.roofDepth)};
  });
  const facades = planSkywaysFacades(info, layout.seed >>> 0, {shells, tubes});
  return {groundY: gy, exterior: {...ext}, shells, bridges: plans, ground, curbs, wrecks, streets, city, facades};
}

/** One bridge tube's exterior: slab underside, roof, side fascias minus the window spans, steel posts / chords, glazing sheets. */
function planBridge(br: BridgeRec, info: SkywaysInfo): BridgePlan {
  const d = br.rect, alongZ = br.axis === 'z';
  const [lat0, lat1] = alongZ ? [d.x0, d.x1] : [d.z0, d.z1];
  const [al0, al1] = alongZ ? [d.z0, d.z1] : [d.x0, d.x1];
  const o0 = lat0 - CELL, o1 = lat1 + CELL;
  // (task studio-skyways-rework-20261107-054512-01, lane ARCH) a glazed roof (world/skywaysBridgeRoofs.ts, seen from inside and out):
  // no opaque roof slab; the fascias / posts stop under the roof's wall plate at the springing line
  const y0 = br.deckY - SKYWAYS_EXT.deckDepth, y1 = br.springY !== undefined ? br.springY - 0.03 : br.ceilY + SKYWAYS_EXT.roofDepth;
  const outer: SkywaysRect = alongZ ? {x0: o0, z0: al0, x1: o1, z1: al1} : {x0: al0, z0: o0, x1: al1, z1: o1};
  const faces: PlaneRect[] = [];
  // underside / roof (axis y: s = x, t = z)
  faces.push({axis: 'y', c: y0, n: -1, s0: outer.x0, s1: outer.x1, t0: outer.z0, t1: outer.z1});
  if (br.springY === undefined) faces.push({axis: 'y', c: y1, n: 1, s0: outer.x0, s1: outer.x1, t0: outer.z0, t1: outer.z1});
  const steel: ColorBox[] = [], glass: BridgePlan['glass'] = [];
  const sideAxis: 'x' | 'z' = alongZ ? 'x' : 'z';
  const box = (a0: number, a1: number, c0: number, c1: number, ya: number, yb: number): ColorBox => (alongZ
    ? {x0: Math.min(c0, c1), x1: Math.max(c0, c1), z0: a0, z1: a1, y0: ya, y1: yb, color: STEEL}
    : {x0: a0, x1: a1, z0: Math.min(c0, c1), z1: Math.max(c0, c1), y0: ya, y1: yb, color: STEEL});
  for (const [plane, n, side] of [[o0, -1, alongZ ? 'W' : 'N'], [o1, 1, alongZ ? 'E' : 'S']] as const) {
    const spans = info.windows.filter(w => 'bridge' in w.host && w.host.bridge === br.id && w.side === side)
      .map(w => ({a0: alongZ ? w.z0 : w.x0, a1: alongZ ? w.z1 : w.x1, ya: w.baseY + w.sill, yb: w.baseY + w.head})).sort((p, q) => p.a0 - q.a0);
    for (const q of subtractRects(al0, al1, y0, y1, spans.map(s => ({s0: s.a0, s1: s.a1, t0: s.ya, t1: s.yb})))) faces.push({axis: sideAxis, c: plane, n: n as 1 | -1, ...q});
    // steel outside the fascia: posts at both ends and on every pier between spans, chords under / over the glazing band
    const out0 = plane, out1 = plane + n * SKYWAYS_EXT.frameDepth;
    const posts = [al0 + SKYWAYS_EXT.post / 2, al1 - SKYWAYS_EXT.post / 2];
    for (let i = 0; i + 1 < spans.length; i++) posts.push((spans[i].a1 + spans[i + 1].a0) / 2);
    for (const p of posts) steel.push(box(p - SKYWAYS_EXT.post / 2, p + SKYWAYS_EXT.post / 2, out0, out1, y0, y1));
    if (spans.length) {
      const ya = Math.min(...spans.map(s => s.ya)), yb = Math.max(...spans.map(s => s.yb));
      steel.push(box(al0, al1, out0, out1, ya - 0.02 - SKYWAYS_EXT.chord, ya - 0.02));
      steel.push(box(al0, al1, out0, out1, yb + 0.02, yb + 0.02 + SKYWAYS_EXT.chord));
    }
    if (!br.breached) for (const s of spans) glass.push({rect: {axis: sideAxis, c: plane - n * 0.03, n: n as 1 | -1, s0: s.a0, s1: s.a1, t0: s.ya, t1: s.yb}, panes: Math.max(1, Math.round((s.a1 - s.a0) / 1.5))});
  }
  return {bridge: br.id, axis: br.axis, outer, deckY: br.deckY, ceilY: br.ceilY, y0, y1, faces, steel, glass};
}

/** Curb stones along the sidewalk bands' edges where they meet the road (inside the exterior rect). */
function planCurbs(ext: SkywaysRect, foots: readonly SkywaysRect[], walks: readonly SkywaysRect[], gy: number): ColorBox[] {
  const out: ColorBox[] = [];
  const {w, h} = SKYWAYS_EXT.curb;
  walks.forEach((E, i) => {
    // horizontal edges (z = const) and vertical edges (x = const); `dir` = the side the sidewalk lies on
    const edges: {alongX: boolean; c: number; a0: number; a1: number; dir: 1 | -1}[] = [
      {alongX: true, c: E.z0, a0: E.x0, a1: E.x1, dir: 1}, {alongX: true, c: E.z1, a0: E.x0, a1: E.x1, dir: -1},
      {alongX: false, c: E.x0, a0: E.z0, a1: E.z1, dir: 1}, {alongX: false, c: E.x1, a0: E.z0, a1: E.z1, dir: -1},
    ];
    for (const e of edges) {
      const [lo, hi] = e.alongX ? [ext.z0, ext.z1] : [ext.x0, ext.x1];
      if (e.c <= lo + 0.05 || e.c >= hi - 0.05) continue; // on / beyond the complex edge: the city's flat ring walk
      const [b0, b1] = e.alongX ? [ext.x0, ext.x1] : [ext.z0, ext.z1];
      const cuts: [number, number][] = [];
      // inside (or touching) another sidewalk band or a footprint: no curb there
      [...walks.filter((_, j) => j !== i), ...foots].forEach(r => {
        const [c0, c1, s0, s1] = e.alongX ? [r.z0, r.z1, r.x0, r.x1] : [r.x0, r.x1, r.z0, r.z1];
        if (e.c >= c0 - 1e-6 && e.c <= c1 + 1e-6) cuts.push([s0, s1]);
      });
      for (const [a, b] of subtractIntervals(Math.max(e.a0, b0), Math.min(e.a1, b1), cuts, 0.3)) {
        const c0 = e.c, c1 = e.c + e.dir * w;
        out.push(e.alongX
          ? {x0: a, x1: b, z0: Math.min(c0, c1), z1: Math.max(c0, c1), y0: gy, y1: gy + h, color: CURB}
          : {x0: Math.min(c0, c1), x1: Math.max(c0, c1), z0: a, z1: b, y0: gy, y1: gy + h, color: CURB});
      }
    }
  });
  return out;
}

/** Seeded wrecks per street, on the road only (off every sidewalk band / footprint, clear of the bridge decks, apart). */
function planWrecks(info: SkywaysInfo, walks: readonly SkywaysRect[], seed: number): WreckPlace[] {
  const rnd = mulberry32(seed);
  const ext = info.exterior, out: WreckPlace[] = [];
  const decks = info.bridges.map(b => grow(b.rect, SKYWAYS_EXT.bridgeClear));
  const total = WRECK_KEYS.reduce((s, k) => s + WRECK_WEIGHTS[k], 0);
  const pick = (): WreckKey => { let r = rnd() * total; for (const k of WRECK_KEYS) { r -= WRECK_WEIGHTS[k]; if (r <= 0) return k; } return WRECK_KEYS[0]; };
  const onRoad = (x: number, z: number) => inRect(ext, x, z, -0.3) && !walks.some(r => inRect(r, x, z, 0.3)) && !decks.some(r => inRect(r, x, z));
  info.streets.forEach((s, si) => {
    const alongX = s.axis === 'x';
    const r = s.rect;
    const [a0, a1] = alongX ? [Math.max(r.x0, ext.x0), Math.min(r.x1, ext.x1)] : [Math.max(r.z0, ext.z0), Math.min(r.z1, ext.z1)];
    const [l0, l1] = alongX ? [r.z0, r.z1] : [r.x0, r.x1];
    if (a1 - a0 < 10 || l1 - l0 < 6) return;
    const want = Math.min(SKYWAYS_EXT.wrecksMin + Math.floor(rnd() * (SKYWAYS_EXT.wrecksMax - SKYWAYS_EXT.wrecksMin + 1)), Math.floor((a1 - a0) / 9));
    for (let n = 0, tries = 0; n < want && tries < want * 40; tries++) {
      const key = pick(), m = SKYWAYS_PROP_MODELS[key];
      const len = m.w, wid = m.d;
      const along = a0 + len / 2 + rnd() * Math.max(0, a1 - a0 - len);
      const lat = l0 + rnd() * (l1 - l0);
      const crash = rnd() < 0.35;
      const heading = (alongX ? 0 : Math.PI / 2) + (rnd() < 0.5 ? 0 : Math.PI);
      const yaw = heading + (rnd() - 0.5) * (crash ? 1.6 : 0.24);
      const x = alongX ? along : lat, z = alongX ? lat : along;
      // footprint samples: centre, corners, edge midpoints (nose +X: X axis -> (cos yaw, -sin yaw))
      const cx = Math.cos(yaw), sx = -Math.sin(yaw);
      let ok = true;
      for (const [u, v] of [[0, 0], [1, 1], [1, -1], [-1, 1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const lu = u * len / 2, lv = v * wid / 2;
        // local (lu along X, lv along Z) -> world: X -> (cx, sx), Z -> (-sx, cx)
        if (!onRoad(x + lu * cx - lv * sx, z + lu * sx + lv * cx)) { ok = false; break; }
      }
      if (!ok) continue;
      if (out.some(o => Math.hypot(o.x - x, o.z - z) < (o.len + len) / 2 + SKYWAYS_EXT.wreckPad)) continue;
      out.push({key, x: r3(x), z: r3(z), yaw: r3(yaw), len, wid, street: si});
      n++;
    }
  });
  return out;
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;

// ---------------------------------------------------------------------------------------------
// three.js

/** Merged positions / normals (+ optional colours / uvs). */
class Geo {
  pos: number[] = []; nor: number[] = []; col: number[] = []; uv: number[] = []; idx: number[] = [];
  /** A plane rect wound counter-clockwise toward its normal; uv in metres (s, t) scaled by `us`, `vs`. */
  rect(q: PlaneRect, color?: [number, number, number], us = 1, vs = 1, uo = 0, vo = 0): void {
    const P = (s: number, t: number): number[] => (q.axis === 'x' ? [q.c, t, s] : q.axis === 'z' ? [s, t, q.c] : [s, q.c, t]);
    const n = q.axis === 'x' ? [q.n, 0, 0] : q.axis === 'z' ? [0, 0, q.n] : [0, q.n, 0];
    const p = [P(q.s0, q.t0), P(q.s1, q.t0), P(q.s1, q.t1), P(q.s0, q.t1)];
    const uvs = [[q.s0, q.t0], [q.s1, q.t0], [q.s1, q.t1], [q.s0, q.t1]].map(([s, t]) => [(s - uo) * us, (t - vo) * vs]);
    const ax = p[1][0] - p[0][0], ay = p[1][1] - p[0][1], az = p[1][2] - p[0][2], bx = p[2][0] - p[0][0], by = p[2][1] - p[0][1], bz = p[2][2] - p[0][2];
    const order = (ay * bz - az * by) * n[0] + (az * bx - ax * bz) * n[1] + (ax * by - ay * bx) * n[2] < 0 ? [0, 3, 2, 1] : [0, 1, 2, 3];
    const b = this.pos.length / 3;
    for (const i of order) { this.pos.push(...p[i]); this.nor.push(...n); this.uv.push(...uvs[i]); if (color) this.col.push(...color); }
    this.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  /** An axis box's six faces (vertex-coloured). */
  box(b: ColorBox): void {
    const {x0, y0, z0, x1, y1, z1} = b;
    this.rect({axis: 'x', c: x0, n: -1, s0: z0, s1: z1, t0: y0, t1: y1}, b.color);
    this.rect({axis: 'x', c: x1, n: 1, s0: z0, s1: z1, t0: y0, t1: y1}, b.color);
    this.rect({axis: 'z', c: z0, n: -1, s0: x0, s1: x1, t0: y0, t1: y1}, b.color);
    this.rect({axis: 'z', c: z1, n: 1, s0: x0, s1: x1, t0: y0, t1: y1}, b.color);
    this.rect({axis: 'y', c: y1, n: 1, s0: x0, s1: x1, t0: z0, t1: z1}, b.color);
    this.rect({axis: 'y', c: y0, n: -1, s0: x0, s1: x1, t0: z0, t1: z1}, b.color);
  }
  geometry(o: {uv?: boolean} = {}): THREE.BufferGeometry | null {
    if (!this.idx.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    if (this.col.length) g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    if (o.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    return g;
  }
}

let bridgeGlassMat: THREE.Material | null = null;
/** The bridges' outward glazing: the mall's roof glass, front side only (never seen from inside a bridge). */
export function skywaysBridgeGlass(): THREE.Material {
  if (!bridgeGlassMat) {
    const m = roofGlass();
    m.side = THREE.FrontSide;
    m.name = 'skyways-bridge-glass';
    bridgeGlassMat = m;
  }
  return bridgeGlassMat;
}

export interface SkywaysExteriorModels {
  /** The Office city's models (null / missing: procedural). */
  city?: ExteriorModels;
  /** Lane ASSET-A's wrecks (missing: procedural stand-ins). */
  wrecks?: Partial<Record<WreckKey, GLTF | null>>;
}

/** (facadeBoxes / facadeTris: lane FACADE's relief, counted inside the shells / bridges meshes' triangles.) */
export interface SkywaysExteriorStats { meshes: number; draws: number; triangles: number; shells: number; bridges: number; wrecks: number; wreckModels: number; cityTris: number; facadeBoxes: number; facadeTris: number }

export interface SkywaysExteriorView {
  root: THREE.Group;
  city: ExteriorView;
  /** Geometries this view owns (shared GLB geometries are NOT listed). */
  geometries: THREE.BufferGeometry[];
  instanced: THREE.InstancedMesh[];
  stats: SkywaysExteriorStats;
}

const triCount = (g: THREE.BufferGeometry): number => (g.index ? g.index.count : g.attributes.position.count) / 3;

/** Builds the exterior for a plan (procedural stand-ins for anything not delivered). */
export function buildSkywaysExterior(plan: SkywaysExteriorPlan, models: SkywaysExteriorModels = {}): SkywaysExteriorView {
  const root = new THREE.Group();
  root.name = 'skyways-exterior';
  const geometries: THREE.BufferGeometry[] = [], instanced: THREE.InstancedMesh[] = [];
  const stats: SkywaysExteriorStats = {meshes: 0, draws: 0, triangles: 0, shells: plan.shells.length, bridges: plan.bridges.length, wrecks: plan.wrecks.length, wreckModels: 0, cityTris: 0, facadeBoxes: 0, facadeTris: 0};
  // the Office city (ring road, ruined blocks, heroes, the dome) round the complex, its city map painted with the Skyways streets
  const city = buildExterior(plan.city, models.city ?? {});
  city.root.name = 'skyways-city';
  root.add(city.root);
  stats.cityTris = city.tris;
  const add = (g: THREE.BufferGeometry | null, mat: THREE.Material, name: string): void => {
    if (!g) return;
    geometries.push(g);
    const m = new THREE.Mesh(g, mat);
    m.name = name;
    root.add(m);
    stats.meshes++; stats.draws++; stats.triangles += triCount(g);
  };
  // inner ground: the city ground material (its map holds the Skyways roads / sidewalks)
  const groundMesh = city.root.getObjectByName('tower-ext-ground') as THREE.Mesh | undefined;
  if (groundMesh) {
    const g = new Geo();
    for (const r of plan.ground) g.rect({axis: 'y', c: plan.groundY, n: 1, s0: r.x0, s1: r.x1, t0: r.z0, t1: r.z1});
    add(g.geometry(), groundMesh.material as THREE.Material, 'skyways-ext-ground');
  }
  // building shells (+ lane FACADE's curtain-wall panels: projecting bay fronts, setback walls)
  {
    const g = new Geo();
    for (const s of plan.shells) for (const q of s.faces) g.rect(q);
    for (const f of plan.facades) for (const q of f.panels) g.rect(q);
    add(g.geometry(), facadeMaterial(), 'skyways-ext-shells');
  }
  // bridge exteriors + curbs (vertex-coloured stand-in material) + lane FACADE's relief boxes and setback roofs
  {
    const g = new Geo();
    for (const b of plan.bridges) { for (const q of b.faces) g.rect(q, CONCRETE); for (const s of b.steel) g.box(s); }
    for (const c of plan.curbs) g.box(c);
    for (const f of plan.facades) {
      for (const b of f.boxes) stats.facadeTris += emitFacadeBox(g, b, plan.groundY);
      for (const r of f.roofs) { g.rect(r.q, r.color); stats.facadeTris += 2; }
      stats.facadeBoxes += f.boxes.length;
    }
    stats.facadeTris += plan.facades.reduce((s, f) => s + f.panels.length * 2, 0);
    add(g.geometry(), propMaterial(), 'skyways-ext-bridges');
  }
  // bridge glazing (uv metres: bars on the pane columns, one row)
  {
    const g = new Geo();
    for (const b of plan.bridges) for (const {rect, panes} of b.glass) {
      const pw = (rect.s1 - rect.s0) / panes;
      g.rect(rect, undefined, 1.5 / pw, 1.2 / Math.max(0.1, rect.t1 - rect.t0), rect.s0, rect.t0);
    }
    add(g.geometry({uv: true}), skywaysBridgeGlass(), 'skyways-ext-bridge-glass');
  }
  // street wrecks (instanced per model part; nose +X)
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1), tv = new THREE.Vector3();
  const place = (w: WreckPlace) => m4.compose(tv.set(w.x, plan.groundY, w.z), q.setFromAxisAngle(up, w.yaw), one).clone();
  const inst = (name: string, geo: THREE.BufferGeometry, mat: THREE.Material, mats: THREE.Matrix4[]) => {
    const im = new THREE.InstancedMesh(geo, mat, mats.length);
    im.name = name;
    mats.forEach((m, i) => im.setMatrixAt(i, m));
    im.instanceMatrix.needsUpdate = true;
    im.computeBoundingSphere();
    instanced.push(im);
    root.add(im);
    stats.meshes++; stats.draws++; stats.triangles += triCount(geo) * mats.length;
  };
  let fallback: THREE.BufferGeometry | null = null;
  for (const key of WRECK_KEYS) {
    const list = plan.wrecks.filter(w => w.key === key);
    if (!list.length) continue;
    const gltf = models.wrecks?.[key];
    if (gltf) {
      stats.wreckModels++;
      for (const part of modelParts(gltf)) inst(`skyways-ext-wreck-${key}`, part.geometry, modelMaterial(part.material), list.map(w => place(w).multiply(part.matrix)));
    } else {
      // the exterior's procedural car (Z-long, ~4.3 m): turned onto +X, scaled to the wreck's length / width
      if (!fallback) geometries.push((fallback = fallbackPropGeometry('car')));
      const m = SKYWAYS_PROP_MODELS[key];
      const fit = new THREE.Matrix4().makeRotationY(Math.PI / 2).multiply(new THREE.Matrix4().makeScale(m.d / 1.8, m.h / 1.3, m.w / 4.36));
      inst(`skyways-ext-wreck-${key}`, fallback, propMaterial(), list.map(w => place(w).multiply(fit)));
    }
  }
  // exterior render order (after the opaque interior, before the dome), never a shadow caster
  for (const c of root.children) if (c !== city.root) c.traverse(o => { o.renderOrder = 5; o.castShadow = false; o.receiveShadow = false; });
  root.traverse(o => { if (o !== city.dome) { o.matrixAutoUpdate = false; o.updateMatrix(); } });
  root.updateMatrixWorld(true);
  stats.meshes += countMeshes(city.root);
  stats.draws += countMeshes(city.root);
  stats.triangles += city.tris;
  return {root, city, geometries, instanced, stats};
}

function countMeshes(o: THREE.Object3D): number {
  let n = 0;
  o.traverse(c => { if ((c as THREE.Mesh).isMesh) n++; });
  return n;
}

// ---------------------------------------------------------------------------------------------
// Wreck models (level-only skyways-*.glb: loaded behind the Skyways loading screen, released when another level is built)

const wreckJobs = new Map<WreckKey, Promise<GLTF | null>>();
const wreckModels = new Map<WreckKey, GLTF>();

/** Fetches the wreck GLBs once (cached until released); never rejects. `load` is injectable for tests. */
export function loadSkywaysWrecks(load: (url: string) => Promise<GLTF> = defaultLoad): Promise<void> {
  return Promise.all(WRECK_KEYS.map(k => {
    let job = wreckJobs.get(k);
    if (!job) {
      job = load(SKYWAYS_PROP_MODELS[k].url).then(g => { wreckModels.set(k, g); return g; }, err => { console.warn(`skyways exterior: wreck ${k} not loaded`, err); return null; });
      wreckJobs.set(k, job);
    }
    return job;
  })).then(() => undefined);
}

/** The loaded wrecks (QA / build). */
export function skywaysWrecks(): Partial<Record<WreckKey, GLTF>> {
  return Object.fromEntries(wreckModels) as Partial<Record<WreckKey, GLTF>>;
}

/** Disposes the cached wreck models (geometry, materials, textures); returns how many. Only between worlds (nothing may use them). */
export function releaseSkywaysWrecks(): number {
  let n = 0;
  for (const g of wreckModels.values()) {
    g.scene.traverse(o => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.geometry.dispose();
      for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
        for (const v of Object.values(mat)) if ((v as THREE.Texture | null)?.isTexture) (v as THREE.Texture).dispose();
        mat.dispose();
      }
    });
    n++;
  }
  wreckModels.clear();
  wreckJobs.clear();
  return n;
}

function defaultLoad(url: string): Promise<GLTF> {
  return new Promise((resolve, reject) => new GLTFLoader().load(assetUrl(url), resolve, undefined, reject));
}

// ---------------------------------------------------------------------------------------------
// Runtime

interface P3 { x: number; y: number; z: number }

/** What the runtime needs from Game (structural: tests drive it with a fake host). */
export interface SkywaysExteriorHost {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  levels?: {lineOfSight(a: P3, b: P3, opts?: {slack?: number}): boolean} | null;
  warmRegistry: Pick<WarmupRegistry, 'addPool'>;
  frameHooks: ((dt: number) => void)[];
  sectionHooks: {build?(layout: StationLayout): void; teardown?(): void}[];
  sectionPreloads?: ((layout: StationLayout) => Promise<void>)[];
  /** The built world (its Skyways architecture supplies the reveal finish). */
  world?: {skywaysArch?: {revealMaterial(level: number): THREE.Material}} | null;
  /** The GAS lane's glazing runtime (its plans gate the exterior; its reveal material is wired here). */
  skywaysWindows?: {glazing: {plans: readonly WindowPlan[]} | null; revealMaterial: (level: number) => THREE.Material | null};
}

export class SkywaysExteriorRuntime {
  /** The current world's exterior (null without layout.skyways / between worlds). */
  view: SkywaysExteriorView | null = null;
  plan: SkywaysExteriorPlan | null = null;
  info: SkywaysInfo | null = null;
  /** Counters (QA / tests). */
  readonly counts = {builds: 0, teardowns: 0, checks: 0, released: 0};
  /** The rect the indoor fog applies inside (QA / tests): 'atrium' = every exterior ray outdoor. */
  fogBox: {kind: 'building' | 'bridge' | 'atrium' | 'complex'; id: string} | null = null;
  private readonly city: ExteriorModels = {};
  private retired: (() => void)[] = [];
  private farWas: number | null = null;
  private checkT = 0;
  private boxes: THREE.Box3[] = [];
  private readonly frustum = new THREE.Frustum();
  private readonly pm = new THREE.Matrix4();
  private readonly eye = new THREE.Vector3();
  private readonly vaultBoxes: {rect: SkywaysRect; box: THREE.Box3; roofY: number}[] = [];

  constructor(readonly host: SkywaysExteriorHost) {}

  install(): this {
    const h = this.host;
    h.sectionHooks.push({build: layout => this.build(layout), teardown: () => this.teardown()});
    h.frameHooks.push(dt => this.frame(dt));
    h.warmRegistry.addPool('skyways-exterior', () => (this.view ? [this.view.root] : []));
    h.sectionPreloads?.push(layout => (layout.skyways ? Promise.race([this.preload(), new Promise<void>(r => setTimeout(r, SKYWAYS_EXT.waitMs))]) : Promise.resolve()));
    // the reveals of the GAS lane's glazing take the Skyways public wall paint (the station paint elsewhere: its default)
    const sw = h.skywaysWindows;
    if (sw) {
      const fallback = sw.revealMaterial;
      sw.revealMaterial = lv => h.world?.skywaysArch?.revealMaterial(lv) ?? fallback(lv);
    }
    return this;
  }

  /** The Office city's models, skyline, the office surface textures (the Skyways finishes) and the wrecks; never rejects. */
  preload(): Promise<void> {
    const jobs: Promise<unknown>[] = [];
    for (const [k, id] of Object.entries(CITY_MODEL_IDS) as [Exclude<keyof ExteriorModels, 'car'>, OfficeAssetId][]) jobs.push(loadOfficeAsset(id).then(g => { this.city[k] = g; }));
    jobs.push(loadOfficeTexture('skyline').then(t => { if (t) setSkylineTexture(t); }));
    jobs.push(preloadOfficeArch());
    jobs.push(loadSkywaysWrecks());
    return Promise.all(jobs).then(() => undefined, () => undefined);
  }

  build(layout: StationLayout): void {
    if (this.view) this.teardown();
    this.flushRetired();
    const info = layout.skyways;
    if (!info) { this.counts.released += releaseSkywaysWrecks(); return; }
    const h = this.host;
    const plan = planSkywaysExterior(layout);
    const wrecks = skywaysWrecks();
    const view = buildSkywaysExterior(plan, {city: {...this.city, car: wrecks[CITY_CAR] ?? null}, wrecks});
    h.scene.add(view.root);
    this.view = view; this.plan = plan; this.info = info;
    // the city / skyline lie beyond the station's 70 m far plane: raise it while the Skyways world is built
    if (this.farWas === null) this.farWas = h.camera.far;
    h.camera.far = Math.max(this.farWas, EXTERIOR.far);
    h.camera.updateProjectionMatrix();
    setExteriorFootprint(info.exterior);
    this.fogBox = null;
    this.boxes = [];
    this.vaultBoxes.length = 0;
    for (const b of info.buildings) if (b.atrium) {
      const r = b.atrium.rect;
      this.vaultBoxes.push({rect: b.rect, roofY: b.atrium.roofY, box: new THREE.Box3(new THREE.Vector3(r.x0, b.atrium.roofY - 0.5, r.z0), new THREE.Vector3(r.x1, b.atrium.roofY + 3.5, r.z1))});
    }
    this.checkT = 0;
    this.counts.builds++;
  }

  teardown(): void {
    const v = this.view;
    this.view = null; this.plan = null; this.info = null; this.fogBox = null;
    if (this.farWas !== null) { this.host.camera.far = this.farWas; this.host.camera.updateProjectionMatrix(); this.farWas = null; }
    setExteriorFootprint(null);
    EXT_U.roofY.value = 1e9;
    if (!v) return;
    this.host.scene.remove(v.root);
    for (const g of v.geometries) g.dispose();
    for (const g of v.city.geometries) g.dispose();
    const inst = [...v.instanced, ...v.city.instanced];
    this.retired.push(() => { for (const im of inst) im.dispose(); });
    this.counts.teardowns++;
  }

  /** Releases queued after the next frame or before the next build. */
  private flushRetired(): void {
    if (!this.retired.length) return;
    const list = this.retired;
    this.retired = [];
    for (const fn of list) { try { fn(); } catch (err) { console.warn('skyways exterior: releasing previous-world resources failed', err); } }
  }

  frame(dt: number): void {
    this.flushRetired();
    const v = this.view, info = this.info;
    if (!v || !info) return;
    const cam = this.host.camera, eye = cam.getWorldPosition(this.eye);
    v.city.dome.position.copy(eye);
    v.city.dome.updateMatrix();
    v.city.dome.updateMatrixWorld();
    setExteriorEye(eye.y - info.groundY);
    this.updateFogBox(eye, info);
    this.checkT -= dt;
    if (this.checkT > 0) return;
    this.checkT = SKYWAYS_EXT.checkS;
    this.counts.checks++;
    // down in the station (below the street) the city is never visible
    v.root.visible = eye.y > info.groundY - 2 && (this.atriumVisible(eye) || this.windowVisible(eye));
  }

  /** EXT_U.box = the footprint / bridge deck the eye is in; inside an atrium building every exterior ray counts as outdoor. */
  private updateFogBox(eye: THREE.Vector3, info: SkywaysInfo): void {
    let kind: 'building' | 'bridge' | 'atrium' | 'complex' = 'complex', id = '', rect: SkywaysRect = info.exterior;
    const b = info.buildings.find(q => inRect(q.rect, eye.x, eye.z));
    if (b) { kind = b.atrium && eye.y > info.groundY - 1 ? 'atrium' : 'building'; id = b.id; rect = b.rect; }
    else {
      const br = info.bridges.find(q => inRect(bridgeOuter(q), eye.x, eye.z));
      if (br) { kind = 'bridge'; id = br.id; rect = br.rect; }
    }
    if (this.fogBox && this.fogBox.kind === kind && this.fogBox.id === id) return;
    this.fogBox = {kind, id};
    setExteriorFootprint(rect);
    // (lane ARCH) under a glazed bridge roof every exterior ray is outdoor too (the sky through the roof glass, as in an atrium)
    const glazed = kind === 'bridge' && !!info.bridges.find(q => q.id === id)?.roof;
    EXT_U.roofY.value = kind === 'atrium' || glazed ? -1e9 : 1e9;
  }

  /** The eye stands in an atrium building above the street and its vault is in the view frustum (within reach). */
  atriumVisible(eye: THREE.Vector3): boolean {
    if (!this.vaultBoxes.length) return false;
    const info = this.info!;
    const hit = this.vaultBoxes.filter(v => inRect(v.rect, eye.x, eye.z) && eye.y > info.groundY - 0.5 && eye.y < v.roofY);
    if (!hit.length) return false;
    this.updateFrustum();
    return hit.some(v => v.box.distanceToPoint(eye) < SKYWAYS_EXT.reach && this.frustum.intersectsBox(v.box));
  }

  /** Some window span of the eye's storey is in the view frustum, within reach and in line of sight (slabs / walls hide it). */
  windowVisible(eye: THREE.Vector3): boolean {
    const plans = this.host.skywaysWindows?.glazing?.plans;
    if (!plans?.length) return false;
    if (this.boxes.length !== plans.length) this.boxes = plans.map(p => (p.along === 'x'
      ? new THREE.Box3(new THREE.Vector3(p.a0, p.y0, Math.min(p.glass, p.inner) - 0.15), new THREE.Vector3(p.a1, p.y1, Math.max(p.glass, p.inner) + 0.15))
      : new THREE.Box3(new THREE.Vector3(Math.min(p.glass, p.inner) - 0.15, p.y0, p.a0), new THREE.Vector3(Math.max(p.glass, p.inner) + 0.15, p.y1, p.a1))));
    this.updateFrustum();
    const L = this.host.levels;
    for (let i = 0; i < plans.length; i++) {
      const p = plans[i], b = this.boxes[i];
      if (Math.abs(p.baseY + 1.5 - eye.y) > 6) continue; // another storey: behind its slab
      if (b.distanceToPoint(eye) > SKYWAYS_EXT.reach || !this.frustum.intersectsBox(b)) continue;
      if (!L) return true;
      const a = Math.max(p.a0 + 0.1, Math.min(p.a1 - 0.1, p.along === 'x' ? eye.x : eye.z));
      const y = Math.max(p.y0 + 0.1, Math.min(p.y1 - 0.1, eye.y));
      const c = p.inner - (p.n[0] + p.n[1]) * 0.3;
      const mid = (p.a0 + p.a1) / 2;
      const pts: P3[] = [p.along === 'x' ? {x: a, y, z: c} : {x: c, y, z: a}, p.along === 'x' ? {x: mid, y: (p.y0 + p.y1) / 2, z: c} : {x: c, y: (p.y0 + p.y1) / 2, z: mid}];
      for (const q of pts) if (L.lineOfSight({x: eye.x, y: eye.y, z: eye.z}, q, {slack: 0.25})) return true;
    }
    return false;
  }

  private updateFrustum(): void {
    const cam = this.host.camera;
    cam.updateMatrixWorld();
    this.pm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.pm);
  }

  /** Summary (QA / tests). */
  summary(): {stats: SkywaysExteriorStats; fogBox: SkywaysExteriorRuntime['fogBox']; visible: boolean; far: number} | null {
    return this.view ? {stats: {...this.view.stats}, fogBox: this.fogBox, visible: this.view.root.visible, far: this.host.camera.far} : null;
  }
}

/** A bridge tube's outer rect (the deck + its side wall cells). */
export function bridgeOuter(b: Pick<SkywaysBridge, 'rect' | 'axis'>): SkywaysRect {
  const d = b.rect;
  return b.axis === 'z' ? {x0: d.x0 - CELL, z0: d.z0, x1: d.x1 + CELL, z1: d.z1} : {x0: d.x0, z0: d.z0 - CELL, x1: d.x1, z1: d.z1 + CELL};
}

/** Installs the Skyways exterior runtime into a Game (one call in the Game constructor, after the Skyways glazing). */
export function installSkywaysExterior(host: SkywaysExteriorHost): SkywaysExteriorRuntime {
  return new SkywaysExteriorRuntime(host).install();
}
