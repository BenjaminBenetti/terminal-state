// Task studio-baked-lighting-reflections-20261114-050258-01: the COLOUR OF THE STATION'S FIXED SURFACES, per light-field cell — what the
// enhanced bake's bounced light picks up (world/lightFieldGather.ts) and what the reflection probes show (world/reflectionProbes.ts).
//
// It is read from what the architecture pass really DREW (world/builder.ts records every floor / ceiling rect and wall face with its
// finish key: BuiltWorld.drawn), never from a rule that mirrors the builder: a level whose arch remaps the finishes (Office carpet and
// drywall, the mall's per-shop finish rows, Skyways plaster, market container paint ...) and any future one is covered without a line
// here. A finish's colour is its material's base colour times its texture's mean (the bullet-chip colour path: damage/sample.ts), the
// mall's finish-table row, or a material's own `userData.lightAlbedo` ([r, g, b] linear) when it knows better.
// Where nothing was drawn by that pass (stair flights, the tunnel shells) a neutral concrete stands in; a ceiling the builder left OPEN
// (the mall's glass vault, a roof deck) is black: light that reaches it is gone.
// Movable things have no colour here: props, doors, characters and the train are not surfaces of the bake.

import * as THREE from 'three';
import {CELL, VOID} from '../gen/grid';
import type {Level} from '../gen/levels';
import {textureMean} from '../damage/sample';
import {mallTableData} from './mallSurfaces';
import type {ColumnGeometry} from './lightField';

/** What the architecture pass drew (world/builder.ts BuiltWorld.drawn). */
export interface DrawnSurfaces {
  /** Finish keys ('terrazzo', 'shop:quarryTile', 'office-wall-3', 'mall-floor|12' ...). */
  keys: string[];
  /** Per rect [level, x0, z0, x1, z1, y, key]: key = index into `keys`; a ceiling's -1 = no ceiling there (open sky, a glass roof). */
  floors: number[];
  ceils: number[];
  faces: readonly {level: number; x0: number; z0: number; x1: number; z1: number; y0: number; y1: number; nx: number; nz: number; finish: string}[];
  /** The material the builder drew a key with. */
  material(key: string): THREE.Material | undefined;
}

/** Bytes per cell of a slot's albedo: floor rgb, ceiling rgb, wall rgb. */
export const ALBEDO_STRIDE = 9;
export const ALB_FLOOR = 0, ALB_CEIL = 3, ALB_WALL = 6;

export interface SurfaceAlbedo {
  /** Per level slot, per cell: ALBEDO_STRIDE bytes, each round(sqrt(linear) * 255). A black ceiling = none. */
  slots: Uint8Array[];
  stats: {keys: number; floors: number; ceils: number; open: number; walls: number; defaults: number};
}

/** Linear value of an albedo byte. */
export const ALBEDO_LUT: Float32Array = (() => { const t = new Float32Array(256); for (let i = 0; i < 256; i++) t[i] = (i / 255) ** 2; return t; })();
const enc = (v: number): number => Math.round(Math.sqrt(Math.min(1, Math.max(0, v))) * 255);

const C = new THREE.Color();
const lin = (hex: number): [number, number, number] => { C.setHex(hex, THREE.SRGBColorSpace); return [C.r, C.g, C.b]; };

/** No material bounces everything: the brightest albedo a surface may have (fresh white paint is about 0.8). */
const ALBEDO_MAX = 0.8;

/**
 * A finish's colour where its texture cannot be read (Node; an image that is not decoded): the station kit's measured means
 * (tests/helpers/lightPreview.ts uses the same). Any other key takes its material's plain colour, or the neutral defaults.
 */
const KEY_ALBEDO: Readonly<Record<string, [number, number, number]>> = {
  terrazzo: lin(0x8a8478), platformSlab: lin(0x7f7b72), concrete: lin(0x6c6963), 'shop:quarryTile': lin(0x8a4a36), ballast: lin(0x45413c),
  tileLower: lin(0xc6bea6), tileUpper: lin(0xc6bea6), paint: lin(0x8a8d84), 'shop:tileShop': lin(0xd0ccc0), tunnel: lin(0x34322f),
  platformFace: lin(0x6f6b63), ceiling: lin(0x8c877d), ceilingService: lin(0x77736b), safetyEdge: lin(0xa88f3c),
};
const DEFAULT_FLOOR = lin(0x6c6963), DEFAULT_BED = lin(0x45413c), DEFAULT_CEIL = lin(0x77736b), DEFAULT_WALL = lin(0x6c6963), DEFAULT_BED_WALL = lin(0x34322f);

/** Linear colour of one finish (null: unknown, the neutral default stands in). */
export function finishAlbedo(key: string, mat: THREE.Material | undefined): [number, number, number] | null {
  const clamp = (c: readonly number[]): [number, number, number] => [Math.min(ALBEDO_MAX, Math.max(0, c[0])), Math.min(ALBEDO_MAX, Math.max(0, c[1])), Math.min(ALBEDO_MAX, Math.max(0, c[2]))];
  const bar = key.indexOf('|');
  if (bar > 0 && key.startsWith('mall-')) {
    // the mall's finish row (world/mallSurfaces.ts wallRow / floorRow / ceilRow): texel 0 and 1 are its two main colours
    const row = Number(key.slice(bar + 1)), t = mallTableData();
    if (Number.isInteger(row) && row >= 0 && (row * 4 + 2) * 4 <= t.length) {
      const o = row * 16, w = key.startsWith('mall-wall') ? 0.6 : key.startsWith('mall-floor') ? 0.7 : 0.85;
      return clamp([t[o] * w + t[o + 4] * (1 - w), t[o + 1] * w + t[o + 5] * (1 - w), t[o + 2] * w + t[o + 6] * (1 - w)]);
    }
  }
  const m = mat as (THREE.MeshStandardMaterial & {ofA?: unknown; colorNode?: unknown}) | undefined;
  const own = m?.userData?.lightAlbedo as readonly number[] | undefined;
  if (own && own.length >= 3) return clamp(own);
  // the office / Skyways surface materials: their paint (the map is a mean-normalised detail tone)
  if (m?.ofA instanceof THREE.Color) return clamp([m.ofA.r * 0.9, m.ofA.g * 0.9, m.ofA.b * 0.9]);
  const mean = m?.map ? textureMean(m.map, C) : null;
  if (mean && m?.color) return clamp([mean.r * m.color.r, mean.g * m.color.g, mean.b * m.color.b]);
  const known = KEY_ALBEDO[key];
  if (known) return known;
  if (!m?.color) return null;
  // an unread texture, or a white material drawn by its own colour node: its real colour is unknown here
  if (m.map || (m.colorNode && m.color.r > 0.98 && m.color.g > 0.98 && m.color.b > 0.98)) return null;
  return clamp([m.color.r, m.color.g, m.color.b]);
}

/**
 * The per-cell surface colours of a built station. `drawn` null (tests; a world built without the record): the neutral defaults.
 * Cheap (a pass over the drawn rects and faces): it runs on every load, and its bytes are part of the derived cache's key.
 */
export function surfaceAlbedo(W: number, H: number, levels: readonly Level[], geos: readonly ColumnGeometry[], drawn: DrawnSurfaces | null | undefined): SurfaceAlbedo {
  const n = W * H, S = geos.length;
  const slots = geos.map(() => new Uint8Array(n * ALBEDO_STRIDE));
  const set = geos.map(() => new Uint8Array(n)); // bit 0 floor, bit 1 ceiling
  const wallAcc = geos.map(() => new Float32Array(n * 4));
  const stats = {keys: drawn?.keys.length ?? 0, floors: 0, ceils: 0, open: 0, walls: 0, defaults: 0};
  if (drawn) {
    const cols: ([number, number, number] | null)[] = drawn.keys.map(k => {
      let m: THREE.Material | undefined;
      try { m = drawn.material(k); } catch { m = undefined; }
      try { return finishAlbedo(k, m); } catch { return KEY_ALBEDO[k] ?? null; }
    });
    const byKey = new Map(drawn.keys.map((k, i) => [k, i]));
    const rects = (list: number[], off: number, bit: number): void => {
      for (let q = 0; q + 6 < list.length; q += 7) {
        const s = list[q], key = list[q + 6];
        if (s < 0 || s >= S || !(s === Math.floor(s))) continue;
        const col = key >= 0 ? cols[key] : null;
        if (key >= 0 && !col) continue; // unknown colour: the default below
        const x0 = Math.max(0, Math.ceil(list[q + 1] / CELL - 0.5 - 1e-6)), x1 = Math.min(W - 1, Math.ceil(list[q + 3] / CELL - 0.5 - 1e-6) - 1);
        const z0 = Math.max(0, Math.ceil(list[q + 2] / CELL - 0.5 - 1e-6)), z1 = Math.min(H - 1, Math.ceil(list[q + 4] / CELL - 0.5 - 1e-6) - 1);
        const A = slots[s], st = set[s], open = geos[s].open;
        const r = col ? enc(col[0]) : 0, g = col ? enc(col[1]) : 0, b = col ? enc(col[2]) : 0;
        for (let cz = z0; cz <= z1; cz++) for (let cx = x0; cx <= x1; cx++) {
          const i = cz * W + cx;
          if (!open[i]) continue;
          const o = i * ALBEDO_STRIDE + off;
          A[o] = r; A[o + 1] = g; A[o + 2] = b;
          if (!(st[i] & bit)) { st[i] |= bit; if (bit === 1) stats.floors++; else if (col) stats.ceils++; else stats.open++; }
        }
      }
    };
    rects(drawn.floors, ALB_FLOOR, 1);
    rects(drawn.ceils, ALB_CEIL, 2);
    for (const f of drawn.faces) {
      const s = f.level;
      if (!(s >= 0 && s < S)) continue;
      const ki = byKey.get(f.finish);
      let col = ki !== undefined ? cols[ki] : undefined;
      if (col === undefined) {
        let m: THREE.Material | undefined;
        try { m = drawn.material(f.finish); } catch { m = undefined; }
        try { col = finishAlbedo(f.finish, m); } catch { col = KEY_ALBEDO[f.finish] ?? null; }
        byKey.set(f.finish, cols.length); cols.push(col);
      }
      if (!col) continue;
      const alongX = Math.abs(f.z0 - f.z1) < 1e-9, h = Math.max(0.05, f.y1 - f.y0);
      const acc = wallAcc[s], open = geos[s].open;
      if (alongX) {
        const cz = Math.floor((f.z0 + f.nz * 0.25) / CELL);
        if (cz < 0 || cz >= H) continue;
        const a = Math.min(f.x0, f.x1), b = Math.max(f.x0, f.x1);
        for (let cx = Math.max(0, Math.ceil(a / CELL - 0.5 - 1e-6)); cx <= Math.min(W - 1, Math.ceil(b / CELL - 0.5 - 1e-6) - 1); cx++) {
          const i = cz * W + cx;
          if (!open[i]) continue;
          acc[i * 4] += col[0] * h; acc[i * 4 + 1] += col[1] * h; acc[i * 4 + 2] += col[2] * h; acc[i * 4 + 3] += h;
        }
      } else {
        const cx = Math.floor((f.x0 + f.nx * 0.25) / CELL);
        if (cx < 0 || cx >= W) continue;
        const a = Math.min(f.z0, f.z1), b = Math.max(f.z0, f.z1);
        for (let cz = Math.max(0, Math.ceil(a / CELL - 0.5 - 1e-6)); cz <= Math.min(H - 1, Math.ceil(b / CELL - 0.5 - 1e-6) - 1); cz++) {
          const i = cz * W + cx;
          if (!open[i]) continue;
          acc[i * 4] += col[0] * h; acc[i * 4 + 1] += col[1] * h; acc[i * 4 + 2] += col[2] * h; acc[i * 4 + 3] += h;
        }
      }
    }
  }
  for (let s = 0; s < S; s++) {
    const A = slots[s], st = set[s], acc = wallAcc[s], open = geos[s].open, cells = levels[s]?.grid.cells;
    for (let i = 0; i < n; i++) {
      if (!open[i]) continue;
      const o = i * ALBEDO_STRIDE, bed = !!cells && cells[i] === VOID;
      if (!(st[i] & 1)) { const d = bed ? DEFAULT_BED : DEFAULT_FLOOR; A[o] = enc(d[0]); A[o + 1] = enc(d[1]); A[o + 2] = enc(d[2]); stats.defaults++; }
      if (!(st[i] & 2)) { const d = bed ? DEFAULT_BED_WALL : DEFAULT_CEIL; A[o + 3] = enc(d[0]); A[o + 4] = enc(d[1]); A[o + 5] = enc(d[2]); }
      const w = acc[i * 4 + 3];
      if (w > 0) { A[o + 6] = enc(acc[i * 4] / w); A[o + 7] = enc(acc[i * 4 + 1] / w); A[o + 8] = enc(acc[i * 4 + 2] / w); stats.walls++; }
      else { const d = bed ? DEFAULT_BED_WALL : DEFAULT_WALL; A[o + 6] = enc(d[0]); A[o + 7] = enc(d[1]); A[o + 8] = enc(d[2]); }
    }
  }
  return {slots, stats};
}
