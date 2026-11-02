// Task reactor-expansion-20261101 (lane BUNKER): a stand-alone COMPLEX SLOT fixture (until the host lands): a Kit with the rim (level 0)
// and tier 1 (level 1, floor -6 m), a pit-air gallery deck on tier 1, the pit wall row between it and a reserved rock region, an
// entrance span in that wall; any inward direction / region size. `layoutOf` crops it (fixed origin) into a minimal two-storey
// StationLayout so the station dresser and the bunker's dress hook run on the real placement code.

import {Rng} from '../src/core/rng';
import {Kit} from '../src/gen/stationKit';
import {cropKit} from '../src/gen/office/common';
import type {Level} from '../src/gen/levels';
import type {Rect, StationLayout} from '../src/gen/stationTypes';
import type {ComplexSlot} from '../src/gen/reactor/complex/types';

export const BASE = -6.0;
export const CANVAS = 240;

export interface Fixture { k: Kit; rng: Rng; slot: ComplexSlot; levelOpt: {level?: number} }

/**
 * `along` x `deep` cells of free rock behind the gallery, entering `inward`; the entrance (`ew` cells) at `at` (0..1) along the wall.
 * `edge`: the pit wall row is the region's near edge (true, the host's likely reservation) or just outside it.
 */
export function fixture(seed: number, inward: ComplexSlot['inward'], along = 80, deep = 64, o: {ew?: number; at?: number; edge?: boolean; ceil?: number} = {}): Fixture {
  const rng = new Rng(seed);
  const k = new Kit(rng, {levels: 2, w: CANVAS, h: CANVAS});
  const ew = o.ew ?? 6, at = o.at ?? 0.5, edge = o.edge ?? true;
  const lv = {level: 1, floorY: BASE};
  const P = 20; // canvas margin
  // canonical frame (inward 'S'): gallery rows [P, P + 10), wall row P + 10, the region below it
  const wallRow = P + 10;
  const e0 = Math.round(along * at - ew / 2);
  const canon = {gallery: {x: P - 4, y: P, w: along + 8, h: 10}, region: {x: P, y: edge ? wallRow : wallRow + 1, w: along, h: edge ? deep : deep - 1}, entrance: {x: P + Math.max(2, Math.min(along - ew - 2, e0)), y: wallRow, w: ew, h: 1}};
  // rotate / mirror the canonical rects into the requested inward direction (a square canvas: transpose / flip)
  const T = (r: Rect): Rect => {
    switch (inward) {
      case 'S': return r;
      case 'N': return {x: r.x, y: CANVAS - r.y - r.h, w: r.w, h: r.h};
      case 'E': return {x: r.y, y: r.x, w: r.h, h: r.w};
      default: return {x: CANVAS - r.y - r.h, y: r.x, w: r.h, h: r.w};
    }
  };
  const gallery = k.addArea(T(canon.gallery), 'concourse', 'concourse', BASE + 20, -1, {...lv, label: 'Gallery · Tier 1', role: 'reactor-gallery'});
  const slot: ComplexSlot = {id: 'bunker', zone: 0, level: 1, baseY: BASE, region: T(canon.region), entrance: T(canon.entrance), frontArea: gallery.id, inward, ceilMax: o.ceil ?? BASE + 5.65};
  return {k, rng: rng.fork('complex-bunker'), slot, levelOpt: {level: 1}};
}

/** The cropped two-storey layout of a carved fixture (fixed origin: canvas cells = grid cells). */
export function layoutOf(f: Fixture): StationLayout {
  const c = cropKit(f.k, [0, 1], 0, 0, CANVAS, CANVAS);
  const levels: Level[] = c.grids.map((grid, id) => ({id, role: id === 0 ? 'main' : 'ring', grid, baseY: id === 0 ? 0 : BASE}));
  return {
    seed: 1, attempt: 0, name: 'Bunker fixture', archetype: 'side-mezzanine', towards: ['A', 'B'], grid: c.grids[0], areas: f.k.areas, doors: f.k.doors,
    props: [], lights: [], signs: [], pickups: [], zombies: [], storefronts: [], decor: [], playerSpawn: {x: 0, z: 0, yaw: 0},
    trench: {x0: 0, x1: 0, z0: 0, z1: 0, floorY: -1.15, platformX0: 0, platformX1: 0, tracks: [], third: [], columns: false, ceil: 0}, trenches: [],
    platform: -1, platforms: [], traversal: {stairs: [], ladders: [], underpasses: []}, levels, levelLinks: [], rails: [],
  };
}
