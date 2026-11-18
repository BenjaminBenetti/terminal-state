// Task studio-subway-architecture-materials-rework-20261117-072826-01: the CEILING FORM of a Subway station area (pure data, no three.js).
//
// User: the station's ceiling treatment "is not a believable station"; it wants "ribs / bays / arches / coffers or suitable structural forms,
// purposeful ceiling transitions". The ceiling a version-2+ station SHOWS is decided here, once, from the layout alone (identity theme,
// area role, size, height) and read by both sides:
//  - the renderer's architectural kit (world/subwayKit.ts) draws it — transverse beams on the hall's bay lines (gen/subwayBays.ts), coffer
//    grids, shallow jack-arch vaults between beams, a barrel vault over an interchange, a rock vault over a cavern;
//  - the generator's hall lighting (gen/subwayHallLights.ts) hangs its fixtures from the VISIBLE soffit (soffitAt) and puts the concealed
//    coves where the kit draws their ledges (coveY / springY), so no fixture ends up above a vault or inside a beam.
// It is purely visual: the grid's cell ceilings (collision, headroom, the light field's columns) are not changed by a form; every form
// keeps at least FORM_MIN_CLEAR of clear height above the floor (taller than any door head or MIN_HEADROOM).
// Version-1 stations (no identity) and every non-public / extension / stair area are 'flat' (drawn exactly as before).

import {CELL, SOLID, type Grid} from './grid';
import {hallBays, type HallBays} from './subwayBays';
import {PENDANT_Y, type Area, type StationLayout} from './stationTypes';

export type CeilingKind = 'flat' | 'beams' | 'coffer' | 'jack' | 'vault' | 'rock';

export interface CeilingForm {
  kind: CeilingKind;
  /** The area's (highest) ceiling the form hangs from, absolute (m). */
  ceil: number;
  /** The area's floor (absolute, m). */
  floor: number;
  /** Transverse beam depth below the ceiling (m; 0 = none) and width (m). */
  beam: number; beamW: number;
  /** Coffer rib depth (m) and module (m) between beams ('coffer'). */
  rib: number; module: number;
  /** Vault rise (m): 'jack' = between two beams along the long axis; 'vault' / 'rock' = across the hall's width. */
  rise: number;
  /** 'vault' / 'rock': the springing height along both long walls (absolute, m; the drawn vault is VAULT_GAP lower throughout). */
  spring: number;
  /** The bay rhythm the form follows. */
  bays: HallBays;
}

/** Every form keeps at least this much clear height above the floor (m). */
export const FORM_MIN_CLEAR = 3.4;
/** Areas lower than this (floor to ceiling, m) stay flat. */
const FORM_MIN_HEIGHT = 3.9;
/**
 * A vault ('vault' / 'rock') springs at least this high above the floor: above every dresser pendant (PENDANT_Y) with room for its body,
 * so no existing fixture of a reloaded station ends up above (inside) the vault.
 */
const VAULT_MIN_SPRING = PENDANT_Y + 0.4;
/** A drawn vault stays this far below the flat cell ceiling it hangs from (no coplanar crown). */
export const VAULT_GAP = 0.04;

const STAIRISH: ReadonlySet<string> = new Set(['stair', 'end-stair', 'stair-core', 'landing', 'escalator', 'crossover', 'catwalk', 'upper-concourse', 'overlook']);
const r2 = (v: number) => Math.round(v * 100) / 100;

/** The area's floor (main-level areas: 0 unless floorY is set). */
export const areaFloor = (a: Area): number => a.floorY ?? 0;

/** Theme family of a station identity (null: no identity = a version-1 station). */
function themeKind(layout: Pick<StationLayout, 'identity'>): 'heritage' | 'civic' | 'municipal' | 'terracotta' | 'moderne' | 'brutalist' | 'cavern' | null {
  const t = layout.identity?.theme;
  if (!t) return null;
  if (t.startsWith('cavern')) return 'cavern';
  return (['heritage', 'civic', 'municipal', 'terracotta', 'moderne', 'brutalist'] as const).find(k => k === t) ?? 'civic';
}

/** Does an area take an architectural ceiling form at all? */
function formable(layout: Pick<StationLayout, 'identity'>, a: Area): boolean {
  if (!layout.identity || !a.publicSpace || a.ext || a.type === 'shop' || a.type === 'eatery') return false;
  if (a.role && STAIRISH.has(a.role)) return false;
  if (a.type === 'passage' || a.type === 'underpass' || a.type === 'exit-stair' || a.type === 'washroom' || a.type === 'stair-core') return false;
  if (a.type === 'food-court' || a.type === 'retail-arcade') return false;
  return a.ceil - areaFloor(a) >= FORM_MIN_HEIGHT;
}

/**
 * Are an area's two long sides walls (a vault springs from them)? False when more than a quarter of either side is open — a platform's
 * track bed, a hall open to a neighbouring space — where a vault's edge would hang in mid-air.
 */
function longSidesClosed(layout: Partial<Pick<StationLayout, 'levels' | 'grid'>>, a: Area, b: HallBays): boolean {
  const g = layout.levels?.[a.level ?? 0]?.grid ?? layout.grid;
  if (!g) return true;
  let open = 0, n = 0;
  for (let s = b.a0 + 0.75; s < b.a1 - 0.5; s += 1) {
    for (const c of [b.c0 - CELL / 2, b.c1 + CELL / 2]) {
      const x = Math.floor((b.alongX ? s : c) / CELL), z = Math.floor((b.alongX ? c : s) / CELL);
      n++;
      if (x >= 0 && z >= 0 && x < g.w && z < g.h && g.cells[z * g.w + x] !== SOLID) open++;
    }
  }
  return n === 0 || open / n <= 0.25;
}

/** The ceiling form of an area (deterministic from the layout; 'flat' for version-1 stations). */
export function ceilingFormOf(layout: Pick<StationLayout, 'identity' | 'props'> & Partial<Pick<StationLayout, 'levels' | 'grid'>>, a: Area): CeilingForm {
  const floor = areaFloor(a), ceil = a.ceil, H = ceil - floor;
  const bays = hallBays(layout, a);
  const flat: CeilingForm = {kind: 'flat', ceil, floor, beam: 0, beamW: 0, rib: 0, module: 0, rise: 0, spring: ceil, bays};
  if (!formable(layout, a)) return flat;
  const theme = themeKind(layout)!;
  const width = bays.c1 - bays.c0;
  // beam depth by height: a deep beam reads in a tall hall, a shallow one keeps a low platform's headroom
  const beam = r2(Math.min(H - FORM_MIN_CLEAR, H >= 7 ? 0.9 : H >= 5.5 ? 0.7 : H >= 4.6 ? 0.5 : 0.4));
  if (beam < 0.25) return flat;
  const beamW = H >= 6 ? 0.6 : 0.45;
  const with_ = (o: Partial<CeilingForm>): CeilingForm => ({...flat, beam, beamW, ...o});
  // the cavern family: every formable public space sits in painted rock — a rock vault across its width
  // (a vault needs walls to spring from: never over a platform, whose track side is open, nor a hall open along a long side)
  const closed = a.type !== 'platform' && longSidesClosed(layout, a, bays);
  // a version-4 gallery hall: beams over its full-height cells (the kit clips them there), no vault reaching down over the gallery
  if (a.galleried) return with_({kind: 'beams'});
  if (theme === 'cavern') {
    const rise = r2(Math.max(0, Math.min(width * 0.22, H - VAULT_MIN_SPRING, 3.2)));
    return rise >= 0.6 && closed ? with_({kind: 'rock', beam: 0, beamW: 0, rise, spring: r2(ceil - rise)}) : with_({kind: 'beams'});
  }
  // signature halls
  if (a.role === 'interchange-hall' && closed) {
    const rise = r2(Math.max(0, Math.min(width * 0.18, H - VAULT_MIN_SPRING, 3.0)));
    if (rise >= 0.8) return with_({kind: 'vault', beam: 0.3, beamW: 0.5, rise, spring: r2(ceil - rise)});
  }
  if (a.role === 'grand-ticket-hall' || a.role === 'waiting-hall' || theme === 'brutalist') {
    if (a.type !== 'platform' || theme === 'brutalist') return with_({kind: 'coffer', rib: H >= 7 ? 0.38 : 0.28, module: H >= 7 ? 2.6 : 2.2});
  }
  if (a.role === 'gate-gallery') return with_({kind: 'beams'});
  // the tile themes: shallow jack arches between steel beams (the old tiled stations), or plain beams with a flat soffit (civic / moderne)
  if (theme === 'heritage' || theme === 'terracotta' || theme === 'municipal') return with_({kind: 'jack', rise: r2(Math.min(0.35, beam * 0.6))});
  return with_({kind: 'beams'});
}

/** The cell ceiling at a world point of a grid (Infinity outside / no ceiling). */
function cellCeil(g: Pick<Grid, 'w' | 'h' | 'ceil'>, x: number, z: number): number {
  const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
  if (cx < 0 || cz < 0 || cx >= g.w || cz >= g.h) return Infinity;
  const c = g.ceil[cz * g.w + cx];
  return c !== 0 ? c : Infinity;
}

/**
 * The VISIBLE soffit height at a world point of an area under its form (the underside a fixture hangs from): the cell's own ceiling
 * where it is lower than the form's (a version-3 aisle), the beam's underside on a bay line, the vault surface under a vault.
 */
export function soffitAt(form: CeilingForm, x: number, z: number, grid?: Pick<Grid, 'w' | 'h' | 'ceil'>): number {
  const local = grid ? Math.min(form.ceil, cellCeil(grid, x, z)) : form.ceil;
  if (local < form.ceil - 0.3 || form.kind === 'flat') return local;
  const b = form.bays, along = b.alongX ? x : z, across = b.alongX ? z : x;
  if (form.kind === 'vault' || form.kind === 'rock') {
    const t = Math.max(0, Math.min(1, (across - b.c0) / Math.max(1e-6, b.c1 - b.c0)));
    return r2(form.ceil - VAULT_GAP - form.rise * (2 * t - 1) * (2 * t - 1));
  }
  const onBeam = b.lines.some(l => Math.abs(along - l) <= form.beamW / 2);
  if (onBeam) return r2(form.ceil - form.beam);
  if (form.kind === 'jack') {
    // between the two bay lines around `along`: a segmental rise from the beam's bottom flange to the crown
    const edges = [b.a0, ...b.lines, b.a1];
    let lo = b.a0, hi = b.a1;
    for (let i = 0; i + 1 < edges.length; i++) if (along >= edges[i] && along <= edges[i + 1]) { lo = edges[i]; hi = edges[i + 1]; break; }
    const t = (along - lo) / Math.max(1e-6, hi - lo);
    const springY = form.ceil - form.beam + 0.12;
    const crown = form.ceil - 0.04;
    return r2(springY + (crown - springY) * (1 - (2 * t - 1) * (2 * t - 1)));
  }
  if (form.kind === 'coffer') return r2(form.ceil - form.rib);
  return local;
}

/** Height of the concealed cove ledges along the beams' sides ('beams' / 'coffer' / 'jack'), absolute (m). */
export const coveY = (form: CeilingForm): number => r2(form.ceil - Math.max(0.2, form.beam * 0.55));
/** The across positions (world) of a vault's two springing coves (just inside each long wall). */
export function springCoves(form: CeilingForm): [number, number] {
  return [r2(form.bays.c0 + 0.45), r2(form.bays.c1 - 0.45)];
}
