// Task studio-surface-host-ground-connectors-20261118-053602-01: the INDEX-STABILITY pins of the Surface Run version-2 Office / Mall
// connectors (tests/surface-connector-pins.test.ts). One digest per list / grid of a host station ('main') or a district ('surface') at
// SURFACE_VERSION, NORMALIZED so the lift-era layouts (taken before the connector replaced the Office / Mall lift: the baseline in
// tests/helpers/surfaceConnectorBaseline.ts) and the connector layouts compare equal exactly when the only differences are the intended
// ones:
//  - host, lift era: the appended lift's area / landing light / 'LIFT TO STREET' sign dropped, the lift shaft's cells masked;
//  - host, connector: every moved prop back at its memory anchor (PropPlacement.memAt), a loose pickup lying on a moved piece's top moved
//    back with it, the grid's prop masks re-derived over the moved pieces' cells, the appended 'EXIT · STREET' plate (Office) dropped;
//  - district: the lift shaft's and the connector footprint's cells masked (the planned footprint rect is part of the baseline), the
//    portal / the spawn (= the portal pose) left out.
// Pure Node (no three.js).

import {createHash} from 'node:crypto';
import {CELL} from '../../src/gen/grid';
import {cellsOfBox} from '../../src/gen/placeKit';
import {holderKey} from '../../src/run/memory';
import {isLootHolderKind} from '../../src/items/loot';
import type {StationLayout} from '../../src/gen/stationTypes';
import type {PropPlacement} from '../../src/gen/props';
import type {SRect} from '../../src/gen/surface/surfaceTypes';

const json = (v: unknown) => JSON.stringify(v, (_k, x) => (ArrayBuffer.isView(x) ? Buffer.from(x.buffer, x.byteOffset, x.byteLength).toString('base64') : x));
export const sha = (v: unknown): string => createHash('sha256').update(json(v) ?? 'undefined').digest('hex').slice(0, 16);
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v ?? null)) as T;

/** A masked rect on a storey (world m; a cell is masked when its centre lies inside). */
export interface MaskRect extends SRect { level: number }

/** Per-storey digests of the grid's arrays, the masked cells' values replaced by a sentinel. */
export function gridPins(L: StationLayout, mask: readonly MaskRect[], masks?: {blocked: Uint8Array; sight: Uint8Array}[]): Record<string, string> {
  const out: Record<string, string> = {};
  const levels = L.levels?.length ? L.levels : [{id: 0, grid: L.grid, baseY: 0}];
  levels.forEach((lv, k) => {
    const g = lv.grid, n = g.w * g.h;
    const off = new Uint8Array(n);
    for (const r of mask) {
      if (r.level !== k) continue;
      for (let cy = Math.max(0, Math.floor(r.z0 / CELL)); cy < Math.min(g.h, Math.ceil(r.z1 / CELL)); cy++) for (let cx = Math.max(0, Math.floor(r.x0 / CELL)); cx < Math.min(g.w, Math.ceil(r.x1 / CELL)); cx++) {
        const x = (cx + 0.5) * CELL, z = (cy + 0.5) * CELL;
        if (x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1) off[cy * g.w + cx] = 1;
      }
    }
    const m = <A extends ArrayLike<number>>(a: A): number[] => { const o: number[] = new Array(n); for (let i = 0; i < n; i++) o[i] = off[i] ? -999 : Number(a[i]); return o; };
    const b = masks?.[k];
    out[`L${k}`] = sha({w: g.w, h: g.h, cells: m(g.cells), area: m(g.area), floor: m(g.floor), ceil: m(g.ceil), ramp: m(g.rampIdx), ramps: g.ramps, links: g.links, voidFloor: g.voidFloor});
    out[`L${k}:masks`] = sha({blocked: m(b ? b.blocked : g.blocked), sight: m(b ? b.sight : g.sightBlocked)});
    out[`L${k}:meta`] = sha({id: lv.id, baseY: lv.baseY, role: (lv as {role?: string}).role});
  });
  return out;
}

/** Holder memory keys of every loot-holder prop (run/memory.ts holderKey at its memory anchor), in layout order. */
export function holderKeys(props: readonly PropPlacement[]): string[] {
  return props.filter(p => isLootHolderKind(p.kind)).map(p => holderKey(p.kind, p.level, p.memAt?.x ?? p.x, p.memAt?.z ?? p.z));
}

/** Everything of a layout outside the pinned lists (any other change shows here). */
function restOf(L: StationLayout): string {
  const skip = new Set(['props', 'pickups', 'zombies', 'lights', 'areas', 'signs', 'doors', 'grid', 'levels', 'surfaceAccess', 'surface', 'playerSpawn']);
  return sha(Object.fromEntries(Object.entries(L).filter(([k]) => !skip.has(k))));
}

/**
 * A connector host's layout with the intended differences undone: every prop with a memory anchor back at it (and its anchor field
 * dropped), the pickups lying on a moved piece's top back with it (world/surface rule of gen/surface/accessDoor.ts applyMoves), the
 * grid's prop masks re-derived over the moved pieces' old and new cells. Returns the restored lists and masks (the layout untouched).
 */
export function restoreMoves(L: StationLayout): {props: PropPlacement[]; pickups: StationLayout['pickups']; masks: {blocked: Uint8Array; sight: Uint8Array}[]; moved: number[]} {
  const props = clone(L.props), pickups = clone(L.pickups);
  const moved: number[] = [];
  props.forEach((p, i) => { if (p.memAt) moved.push(i); });
  // the pickups on a moved piece's top (its NEW box), by the piece's delta (hosted decor carries its own anchor)
  for (const i of moved) {
    const p = L.props[i];
    if (p.host !== undefined) continue;
    const dx = p.memAt!.x - p.x, dz = p.memAt!.z - p.z, top = p.y + p.h;
    L.pickups.forEach((k, j) => {
      if ((k.level ?? 0) !== (p.level ?? 0) || Math.abs(k.x - p.x) > p.hx || Math.abs(k.z - p.z) > p.hz || k.y < top - 0.05 || k.y > top + 0.6) return;
      pickups[j].x = Math.round((k.x + dx) * 1000) / 1000; pickups[j].z = Math.round((k.z + dz) * 1000) / 1000;
    });
  }
  for (const i of moved) { const p = props[i]; p.x = p.memAt!.x; p.z = p.memAt!.z; delete p.memAt; }
  const levels = L.levels?.length ? L.levels : [{id: 0, grid: L.grid, baseY: 0}];
  const masks = levels.map((lv, k) => {
    const g = lv.grid, blocked = g.blocked.slice(), sight = g.sightBlocked.slice();
    const touched: [number, number, number, number][] = [];
    for (const i of moved) {
      if ((L.props[i].level ?? 0) !== k) continue;
      const a = L.props[i], b = props[i];
      touched.push(cellsOfBox(a.x, a.z, a.hx, a.hz), cellsOfBox(b.x, b.z, b.hx, b.hz));
    }
    if (!touched.length) return {blocked, sight};
    for (const [x0, y0, x1, y1] of touched) for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) if (g.inBounds(cx, cy)) { blocked[g.idx(cx, cy)] = 0; sight[g.idx(cx, cy)] = 0; }
    for (const q of props) {
      if ((q.level ?? 0) !== k || q.mounted || q.host !== undefined || q.cargoGone || q.h <= 0.05) continue;
      const bb = cellsOfBox(q.x, q.z, q.hx, q.hz);
      if (!touched.some(t => bb[0] <= t[2] && bb[2] >= t[0] && bb[1] <= t[3] && bb[3] >= t[1])) continue;
      for (const t of touched) for (let cy = Math.max(bb[1], t[1]); cy <= Math.min(bb[3], t[3]); cy++) for (let cx = Math.max(bb[0], t[0]); cx <= Math.min(bb[2], t[2]); cx++) {
        if (!g.inBounds(cx, cy)) continue;
        blocked[g.idx(cx, cy)] = 1; if (q.blocksSight) sight[g.idx(cx, cy)] = 1;
      }
    }
    return {blocked, sight};
  });
  return {props, pickups, masks, moved};
}

export type HostMode = 'lift' | 'connector';

/** A host station's pins (normalized per `mode`), `mask` = the lift shaft's cells (the baseline's). */
export function hostPins(L: StationLayout, mode: HostMode, mask: readonly MaskRect[]): Record<string, string> {
  const a = L.surfaceAccess;
  let props: PropPlacement[] = L.props, pickups = L.pickups, areas = L.areas, lights = L.lights, signs = L.signs;
  let masks: {blocked: Uint8Array; sight: Uint8Array}[] | undefined;
  if (mode === 'lift' && a?.kind === 'lift') {
    // (the retired gen/surface/accessLiftHost.ts finish: one area, one light, one sign appended last)
    areas = L.areas.slice(0, -1); lights = L.lights.slice(0, -1); signs = L.signs.slice(0, -1);
  }
  if (mode === 'connector') {
    const r = restoreMoves(L);
    props = r.props; pickups = r.pickups; masks = r.masks;
    if (a?.kind === 'connector' && a.connector?.host === 'office') signs = L.signs.slice(0, -1); // (the appended EXIT · STREET plate)
  }
  return {
    props: sha(props), pickups: sha(pickups), zombies: sha(L.zombies), lights: sha(lights), areas: sha(areas), signs: sha(signs), doors: sha(L.doors),
    spawn: sha(L.playerSpawn), holders: sha(holderKeys(props)), rest: restOf(L), ...gridPins(L, mask, masks),
  };
}

/** A district's pins: `mask` = the lift shaft's and the connector footprint's cells (the baseline's). */
export function districtPins(L: StationLayout, mask: readonly MaskRect[]): Record<string, string> {
  const S = L.surface!;
  const {portal: _portal, ...surface} = S;
  void _portal;
  return {
    props: sha(L.props), pickups: sha(L.pickups), zombies: sha(L.zombies), lights: sha(L.lights), areas: sha(L.areas), signs: sha(L.signs), doors: sha(L.doors),
    surface: sha(surface), holders: sha(holderKeys(L.props)), rest: restOf(L), ...gridPins(L, mask),
  };
}

/** The full-layout digest (tests/surface-v1-compat.test.ts bytes): the Subway's v2 worlds are untouched. */
export const layoutDigest = (L: StationLayout): string => sha(L);
