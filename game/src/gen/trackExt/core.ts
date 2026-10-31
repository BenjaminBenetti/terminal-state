// Track 2 (lane GEN): RE-FRAMING a finished layout — the same level in another grid frame: every level grid re-windowed (cells,
// areas, floors, ceilings, ramps, prop footprints, nav links), every record translated (areas / doors / storefronts / level plan /
// flights in cells; props / lights / signs / pickups / zombies / decor / spawn / trenches / ladders / links / rails in metres).
//
//  - finishExtensions (gen/trackExt/index.ts) EMBEDS the finished core into the larger grid its extensions need: every core
//    decision was made in the core's own frame (exactly as without extensions), the embedding is a pure translation.
//  - coreView takes it back out: the level exactly as it would have been generated without its extensions (extension cells back
//    to rock, appended areas / doors left out). Used by runtime fields that must treat the core exactly as before (world/decay.ts)
//    and by the translation-normalised golden proofs (tests/track-ext*.test.ts). Pure data; inputs are not modified.

import {CELL, Grid, type NavLink} from '../grid';
import {shiftPlan} from '../levelGen';
import type {Level} from '../levels';
import {shiftFlight, shiftRamp} from '../traversal';
import type {StationLayout} from '../stationTypes';
import {copyWindow} from './window';
import {isExtensionArea} from './types';

/**
 * The layout in a new grid frame of w x h cells whose cell (0, 0) is the old cell (ox, oy) (negative = the old grid lands inside
 * a larger one). Cells outside the old grid are rock. `keepAreas` < areas.length drops the areas from that id on (and their
 * cells on the main level, and the doors that touch them) — the appended extensions.
 */
export function reframe(layout: StationLayout, ox: number, oy: number, w: number, h: number, keepAreas = layout.areas.length): StationLayout {
  if (layout.office && (ox || oy)) throw new Error('reframe: an office layout keeps its origin (it only grows east / south)');
  const dx = ox * CELL, dz = oy * CELL;
  const nDoors = (() => { const k = layout.doors.findIndex(d => d.a >= keepAreas || d.b >= keepAreas); return k < 0 ? layout.doors.length : k; })();
  const W = layout.grid.w;
  const ramps = layout.grid.ramps.map(r => shiftRamp(r, ox, oy));
  const crop = (g: Grid): Grid => {
    const out = new Grid(w, h);
    copyWindow(g, out, ox, oy, true);
    if (keepAreas < layout.areas.length) for (let i = 0; i < out.cells.length; i++) if (out.area[i] >= keepAreas) { out.cells[i] = 0; out.area[i] = -1; out.floor[i] = 0; out.ceil[i] = 0; }
    out.voidFloor = g.voidFloor;
    out.ramps = ramps;
    const idx = (i: number) => { const x = i % W, y = (i - x) / W; return x - ox < 0 || y - oy < 0 || x - ox >= w || y - oy >= h ? -1 : (y - oy) * w + (x - ox); };
    for (const l of g.links) {
      const a = idx(l.a), b = idx(l.b);
      if (a < 0 || b < 0) continue;
      const nl: NavLink = {...l, a, b, pa: {x: l.pa.x - dx, y: l.pa.y, z: l.pa.z - dz}, pb: {x: l.pb.x - dx, y: l.pb.y, z: l.pb.z - dz}};
      out.addLink(nl);
    }
    return out;
  };
  const grids = new Map<Grid, Grid>();
  const gridOf = (g: Grid) => { let o = grids.get(g); if (!o) grids.set(g, (o = crop(g))); return o; };
  const p3 = <T extends {x: number; z: number}>(p: T): T => ({...p, x: p.x - dx, z: p.z - dz});
  const rail = <T extends {x0: number; z0: number; x1: number; z1: number}>(r: T): T => ({...r, x0: r.x0 - dx, z0: r.z0 - dz, x1: r.x1 - dx, z1: r.z1 - dz});
  const levels: Level[] = (layout.levels ?? []).map(L => {
    const out: Level = {...L, grid: gridOf(L.grid)};
    if (L.rails) out.rails = L.rails.map(rail);
    if (L.sky?.tops) {
      const tops = new Float32Array(w * h), src = L.sky.tops, H = layout.grid.h;
      for (let y = 0; y < h; y++) {
        const sy = y + oy;
        if (sy < 0 || sy >= H) continue;
        const sx0 = Math.max(0, ox), sx1 = Math.min(W, ox + w);
        if (sx1 > sx0) tops.set(src.subarray(sy * W + sx0, sy * W + sx1), y * w + (sx0 - ox));
      }
      out.sky = {...L.sky, tops};
    }
    return out;
  });
  const trench = (t: StationLayout['trench']): StationLayout['trench'] => ({...t, x0: t.x0 - dx, x1: t.x1 - dx, z0: t.z0 - dz, z1: t.z1 - dz, platformX0: t.platformX0 - dx, platformX1: t.platformX1 - dx, tracks: t.tracks.map(z => z - dz)});
  const view: StationLayout = {
    ...layout,
    grid: gridOf(layout.grid),
    areas: layout.areas.slice(0, keepAreas).map(a => ({...a, x: a.x - ox, y: a.y - oy})),
    doors: layout.doors.slice(0, nDoors).map(d => ({...d, x: d.x - ox, y: d.y - oy})),
    props: layout.props.map(p3),
    lights: layout.lights.map(p3),
    signs: layout.signs.map(p3),
    pickups: layout.pickups.map(p3),
    zombies: layout.zombies.map(p3),
    storefronts: layout.storefronts.map(s => ({...s, ox: s.ox - ox, oy: s.oy - oy, ux: s.ux - ox, uy: s.uy - oy})),
    decor: layout.decor.map(b => ({...b, x0: b.x0 - dx, x1: b.x1 - dx, z0: b.z0 - dz, z1: b.z1 - dz})),
    playerSpawn: p3(layout.playerSpawn),
    trench: trench(layout.trench),
    trenches: layout.trenches.map(trench),
    traversal: {
      stairs: layout.traversal.stairs.map(f => shiftFlight(f, ox, oy)),
      ladders: layout.traversal.ladders.map(l => ({...l, x: l.x - dx, faceZ: l.faceZ - dz, bottom: p3(l.bottom), top: p3(l.top)})),
      underpasses: layout.traversal.underpasses,
    },
    levels,
    levelLinks: layout.levelLinks.map(k => ({...k, bottom: p3(k.bottom), top: p3(k.top)})),
    rails: layout.rails.map(rail),
  };
  if (layout.levelPlan) view.levelPlan = shiftPlan(layout.levelPlan, ox, oy);
  if (keepAreas < layout.areas.length) delete view.extensions;
  return view;
}

/** True when the layout's grid is larger than its core (extensions widened it) or carries extension areas. */
export function hasExtensionGrowth(layout: StationLayout): boolean {
  const e = layout.extensions;
  return !!e && (e.core.x !== 0 || e.core.y !== 0 || e.core.w !== layout.grid.w || e.core.h !== layout.grid.h || layout.areas.some(a => isExtensionArea(a)));
}

/** The core level of a layout with extensions (see the file header); the layout itself when it has none. */
export function coreView(layout: StationLayout): StationLayout {
  const e = layout.extensions;
  if (!e || !hasExtensionGrowth(layout)) return layout;
  const first = layout.areas.findIndex(a => isExtensionArea(a));
  return reframe(layout, e.core.x, e.core.y, e.core.w, e.core.h, first < 0 ? layout.areas.length : first);
}
