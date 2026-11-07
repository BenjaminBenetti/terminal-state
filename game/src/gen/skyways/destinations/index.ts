// Task studio-skyways-destinations-20261106-170011-01: the Skyways DESTINATIONS dressing entry — the large ANCHOR shops
// (layout.skyways.anchors: one family each, gen/skyways/carve.ts ANCHOR_FAMILIES) and the LANDMARK courts (layout.skyways.landmarks).
// Called once from gen/skyways/index.ts after the station dresser (its storefront pass drew each anchor's front only: Storefront.anchor)
// and the add-on / atrium / ramen dressers, before the populations and lighting. Each family's kit dresser lives beside this file.
//
// Every anchor floor / upper floor / zone gets its ceiling light grid here (the station dresser leaves their interiors to us).

import type {Rng} from '../../../core/rng';
import {CELL} from '../../grid';
import type {LightPlacement, StationLayout} from '../../stationTypes';
import {SHOPS_A_FAMILIES, dressShopsA} from './shopsA';
import {SHOPS_B_FAMILIES, dressShopsB} from './shopsB';
import {dressLandmark} from './landmarks';
import {SKYWAYS_STORES_MIN_VERSION, dressSkywaysStore} from '../stores/index'; // task studio-alpha-skyways-shops-20261107-054512-01

const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** Light grid pitch (m) inside anchor rooms. */
export const ANCHOR_LIGHT_PITCH = 4.5;

export interface DestinationsResult { anchors: number; landmarks: number; lights: number; props: number }

/**
 * Dresses every anchor shop and landmark court of a Skyways layout (no-op without layout.skyways). `version` = the layout version the
 * station is generated at (gen/skyways/layoutVersion.ts; task studio-alpha-skyways-shops-20261107-054512-01: from version 3 the anchors
 * are the ten major stores, gen/skyways/stores/; older stations keep this pass's dressers byte for byte).
 */
export function dressSkywaysDestinations(layout: StationLayout, rng: Rng, opts: {version?: number} = {}): DestinationsResult {
  const info = layout.skyways;
  const res: DestinationsResult = {anchors: 0, landmarks: 0, lights: 0, props: 0};
  if (!info) return res;
  for (const an of info.anchors ?? []) {
    for (const id of [an.floor, ...(an.upper !== undefined ? [an.upper] : []), ...an.zones]) res.lights += lightGrid(layout, id, rng);
    // each family on its own rng fork (a family's dresser never moves another's)
    const r = rng.fork(`anchor-${an.family}`);
    if ((opts.version ?? 2) >= SKYWAYS_STORES_MIN_VERSION) res.props += dressSkywaysStore(layout, r, an);
    else res.props += SHOPS_A_FAMILIES.includes(an.family) ? dressShopsA(layout, r, an) : SHOPS_B_FAMILIES.includes(an.family) ? dressShopsB(layout, r, an) : 0;
    res.anchors++;
  }
  for (const lm of info.landmarks ?? []) { res.props += dressLandmark(layout, rng.fork(`landmark-${lm.family}`), lm); res.landmarks++; }
  return res;
}

/** A ceiling light grid over an area (its own storey, just under its ceiling), a few broken / flickering like the rest of the network. */
function lightGrid(layout: StationLayout, areaId: number, rng: Rng): number {
  const a = layout.areas[areaId];
  if (!a) return 0;
  const lv = a.level ?? 0, g = layout.levels[lv]?.grid;
  if (!g) return 0;
  let n = 0;
  const x0 = a.x * CELL, z0 = a.y * CELL, W = a.w * CELL, D = a.h * CELL;
  const nx = Math.max(1, Math.round(W / ANCHOR_LIGHT_PITCH)), nz = Math.max(1, Math.round(D / ANCHOR_LIGHT_PITCH));
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
    const x = x0 + W * (i + 0.5) / nx, z = z0 + D * (j + 0.5) / nz;
    const [cx, cy] = g.cellOf(x, z);
    if (!g.inBounds(cx, cy) || g.area[g.idx(cx, cy)] !== a.id) continue;
    const l: LightPlacement = {x: r3(x), y: r3(a.ceil - 0.08), z: r3(z), rot: W >= D ? 0 : Math.PI / 2, area: a.id, broken: rng.chance(0.12), flicker: rng.chance(0.1), warm: rng.chance(0.4), power: 0.7, dying: rng.chance(0.08)};
    if (lv) l.level = lv;
    layout.lights.push(l);
    n++;
  }
  return n;
}
