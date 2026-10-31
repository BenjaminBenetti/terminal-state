// Track 2 (lane GEN): canonical form of a layout for the core-preservation proofs — every record (areas, doors, props, lights,
// signs, pickups, zombies, storefronts, decor, spawn, trenches, traversal, levels, links, rails, level plan) as plain JSON with
// numbers rounded to 1e-6 (a crop translation re-adds the same offset in floating point), plus a digest of every level grid's
// cells / areas / floors / ceilings / ramps / blocked / sight-blocked arrays. Two layouts with equal canonical forms are the same
// level.
import type {Grid} from '../../src/gen/grid';
import type {StationLayout} from '../../src/gen/stationTypes';

const round = (v: number) => (Number.isFinite(v) ? Math.round(v * 1e6) / 1e6 : v);

function plain(v: unknown): unknown {
  if (typeof v === 'number') return round(v) === 0 ? 0 : round(v);
  if (Array.isArray(v)) return v.map(plain);
  if (ArrayBuffer.isView(v)) return `typed:${digest(v as unknown as ArrayLike<number>)}`;
  if (v && typeof v === 'object') {
    const o: Record<string, unknown> = {};
    for (const k of Object.keys(v).sort()) {
      const x = (v as Record<string, unknown>)[k];
      if (x === undefined || typeof x === 'function') continue;
      o[k] = plain(x);
    }
    return o;
  }
  return v;
}

export function digest(a: ArrayLike<number>): string {
  let h = 0x811c9dc5 >>> 0;
  for (let i = 0; i < a.length; i++) {
    const v = Math.round(a[i] * 1e6);
    h ^= v & 0xff; h = Math.imul(h, 16777619) >>> 0;
    h ^= (v >>> 8) & 0xff; h = Math.imul(h, 16777619) >>> 0;
    h ^= (v >>> 16) & 0xff; h = Math.imul(h, 16777619) >>> 0;
    h ^= (v >>> 24) & 0xff; h = Math.imul(h, 16777619) >>> 0;
  }
  return `${a.length}:${h.toString(16)}`;
}

export function gridDigest(g: Grid): Record<string, string | number> {
  return {
    w: g.w, h: g.h, voidFloor: g.voidFloor,
    cells: digest(g.cells), area: digest(g.area), floor: digest(g.floor), ceil: digest(g.ceil), ramp: digest(g.rampIdx),
    blocked: digest(g.blocked), sight: digest(g.sightBlocked),
    ramps: JSON.stringify(plain(g.ramps)), links: JSON.stringify(plain(g.links)),
  };
}

/** Canonical JSON-able form of a layout (see the file header). */
export function canonLayout(l: StationLayout): Record<string, unknown> {
  const {grid, levels, extensions, ...rest} = l as StationLayout & Record<string, unknown>;
  void extensions;
  return {
    ...(plain(rest) as Record<string, unknown>),
    grid: gridDigest(grid),
    levels: (levels ?? []).map(L => ({id: L.id, role: L.role, baseY: round(L.baseY), grid: gridDigest(L.grid), rails: plain(L.rails), sky: plain(L.sky)})),
  };
}

/** Keys whose canonical values differ (for readable failures). */
export function canonDiff(a: Record<string, unknown>, b: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const x = JSON.stringify(a[k]), y = JSON.stringify(b[k]);
    if (x !== y) out.push(`${k}: ${x?.slice(0, 160)} != ${y?.slice(0, 160)}`);
  }
  return out;
}
