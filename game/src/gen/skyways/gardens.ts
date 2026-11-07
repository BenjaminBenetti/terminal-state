// Task studio-skyways-rework-20261107-054512-01 (lane ARCH): PLANTED GALLERIES and COURTS of a Skyways level (layout version 3, the
// live generator only; runs after the station dresser and the Skyways dressers, before the populations):
//  - GALLERY PLANTERS (the references: dense shrubs in a trough along a gallery railing; planting round a glazed atrium): along every
//    atrium opening's skyway-level edge, on the gallery floor's first row against the balustrade, continuous troughs of
//    skyArchGalleryPlanter segments (1.5 m each, end to end). A cell takes a trough only when it is open public gallery floor right at
//    the opening's edge (the rail is there), never a stair / escalator cell or its approach, a level link's landing, a door's zone
//    (bridge mouths and corridors open through doors), a landmark's clear disc, an anchor / add-on / shop area or an occupied cell, and
//    when GARDEN.walk of open floor stays behind it (the walkway is never pinched). Gaps fall where a cell fails;
//  - COURT BENCH-PLANTERS (the reference: built-in timber bench-planters round a skylit brick court): a few skyArchBenchPlanter in the
//    large skyway courts (the skylight candidates) and in each atrium court below its glass, through the station placement kit (a
//    walking ring kept round each, door zones / stairs / landmark discs respected).
// Existing approved assets only: the planters are procedural bodies with the office's potted-plant foliage model (world/skywaysGardens.ts).

import type {Rng} from '../../core/rng';
import {CELL, FLOOR} from '../grid';
import {areaConnected, makePlaceCtx, markCell, tryPlaceProp, type PlaceCtx} from '../placeKit';
import {PROP_DEFS, footprint, type PropKind, type PropPlacement} from '../props';
import type {StationLayout} from '../stationTypes';
import {keepLandmarkClear} from './destinations/landmarks';
import {SKYLIGHT, skylightCandidate} from './skylights';
import {SKYWAYS_LEVEL} from './skywaysTypes';

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const TROUGH: PropKind = 'skyArchGalleryPlanter', BENCH: PropKind = 'skyArchBenchPlanter';

/** Trough segment length (cells), open walkway kept behind a trough (cells), a stair's mouth (cells), bench-planters per court. */
export const GARDEN = {seg: 3, walk: 5, mouth: 4, linkPad: 2, benches: {atrium: [1, 2] as const, court: [1, 3] as const}, ring: 1.0} as const;

export interface GardenStats { troughs: number; benches: number; edgeCells: number; refused: number }

/** Places the gallery troughs and the court bench-planters. Returns its counts (QA / tests). */
export function dressSkywaysGardens(layout: StationLayout, rng: Rng): GardenStats {
  const st: GardenStats = {troughs: 0, benches: 0, edgeCells: 0, refused: 0};
  const info = layout.skyways;
  if (!info) return st;
  galleryTroughs(layout, rng.fork('troughs'), st);
  courtBenches(layout, rng.fork('benches'), st);
  return st;
}

/**
 * The circulation the station dresser's holds kept clear (gen/skyways/index.ts holds(): released before this pass), re-marked as the
 * kit's keep cells: every bridge deck's middle lane on into its concourses, the run mouths (GARDEN.mouth cells beyond every flight
 * end), the add-on's entry; plus every storefront's opening strip (anchor entries included).
 */
function keepCirculation(ctx: PlaceCtx, layout: StationLayout): void {
  const g = ctx.g, lv = ctx.level, info = layout.skyways!;
  const keep = (x0: number, y0: number, x1: number, y1: number) => { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (g.inBounds(x, y)) markCell(ctx, ctx.keep, g.idx(x, y)); };
  if (lv === SKYWAYS_LEVEL.skyway) for (const b of info.bridges) {
    const x0 = Math.round(b.rect.x0 / CELL), y0 = Math.round(b.rect.z0 / CELL), x1 = Math.round(b.rect.x1 / CELL), y1 = Math.round(b.rect.z1 / CELL);
    if (b.axis === 'x') keep(x0 - 6, y0 + 2, x1 + 6, y1 - 2); else keep(x0 + 2, y0 - 6, x1 - 2, y1 + 6);
  }
  const M = GARDEN.mouth;
  for (const r of g.ramps) {
    if (r.axis === 'x') { keep(r.x - M, r.y - 1, r.x, r.y + r.h + 1); keep(r.x + r.w, r.y - 1, r.x + r.w + M, r.y + r.h + 1); }
    else { keep(r.x - 1, r.y - M, r.x + r.w + 1, r.y); keep(r.x - 1, r.y + r.h, r.x + r.w + 1, r.y + r.h + M); }
  }
  if (info.addon.level === lv) {
    const [cx, cy] = g.cellOf(info.addon.entry.x, info.addon.entry.z);
    keep(cx - 4, cy - 4, cx + 5, cy + 5);
    // the add-on's hall / the prize display zone (+ 1 m), and the prize car's way out fore and aft (its body discs + a 3.2 m lane)
    const h = info.addon.hall;
    keep(Math.floor(h.x0 / CELL) - 2, Math.floor(h.z0 / CELL) - 2, Math.ceil(h.x1 / CELL) + 2, Math.ceil(h.z1 / CELL) + 2);
    const car = info.addon.car;
    if (car && car.level === lv) {
      const fx = -Math.sin(car.yaw), fz = -Math.cos(car.yaw);
      for (let t = -7; t <= 7; t += 0.5) for (let w = -1.8; w <= 1.8; w += 0.5) {
        const [x, y] = g.cellOf(car.x + fx * t - fz * w, car.z + fz * t + fx * w);
        keep(x, y, x + 1, y + 1);
      }
    }
  }
  for (const sf of layout.storefronts ?? []) {
    const hall = layout.areas[sf.hall];
    if (!hall || (hall.level ?? 0) !== lv) continue;
    keep(sf.ox - 2, sf.oy - 2, sf.ox + sf.ow + 2, sf.oy + sf.oh + 2);
  }
}

/** Areas the gardens never touch: bridges, the add-on, anchors (and their pieces), shops / eateries, back of house. */
function excludedAreas(layout: StationLayout): Set<number> {
  const info = layout.skyways!, out = new Set<number>([...info.bridges.map(b => b.area), ...info.addon.areas]);
  for (const an of info.anchors ?? []) for (const id of [an.floor, ...(an.upper !== undefined ? [an.upper] : []), ...an.zones, ...an.stock]) out.add(id);
  for (const a of layout.areas) if (!a.publicSpace || a.type === 'shop' || a.type === 'eatery' || /^office-/.test(a.type as string) || out.has(a.parent)) out.add(a.id);
  return out;
}

function galleryTroughs(layout: StationLayout, rng: Rng, st: GardenStats): void {
  const info = layout.skyways!, lv = SKYWAYS_LEVEL.skyway, g = layout.levels[lv]?.grid;
  if (!g) return;
  const ctx = makePlaceCtx(layout, rng, lv);
  keepLandmarkClear(ctx, layout);
  keepCirculation(ctx, layout);
  const excluded = excludedAreas(layout);
  // stairs and their mouths, level-link landings (their own mask: the kit's `edge` also flags the balustrade row itself)
  const stair = new Uint8Array(g.w * g.h);
  const mark = (x: number, y: number) => { if (g.inBounds(x, y)) stair[g.idx(x, y)] = 1; };
  for (let i = 0; i < stair.length; i++) if (g.rampIdx[i] >= 0) { const x = i % g.w, y = (i - x) / g.w; for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) mark(x + ox, y + oy); }
  for (const r of g.ramps) {
    const M = GARDEN.mouth;
    if (r.axis === 'x') { for (let y = r.y - 1; y <= r.y + r.h; y++) for (let k = 1; k <= M; k++) { mark(r.x - k, y); mark(r.x + r.w - 1 + k, y); } }
    else for (let x = r.x - 1; x <= r.x + r.w; x++) for (let k = 1; k <= M; k++) { mark(x, r.y - k); mark(x, r.y + r.h - 1 + k); }
  }
  for (const k of layout.levelLinks) for (const p of [k.lower === lv ? k.bottom : null, k.upper === lv ? k.top : null]) {
    if (!p) continue;
    const [cx, cy] = g.cellOf(p.x, p.z);
    for (let oy = -GARDEN.linkPad; oy <= GARDEN.linkPad; oy++) for (let ox = -GARDEN.linkPad; ox <= GARDEN.linkPad; ox++) mark(cx + ox, cy + oy);
  }
  const open = (x: number, y: number) => g.inBounds(x, y) && g.cells[g.idx(x, y)] === FLOOR && !g.blocked[g.idx(x, y)];
  const okCell = (x: number, y: number, dx: number, dy: number): boolean => {
    if (!open(x, y)) return false;
    const i = g.idx(x, y);
    if (excluded.has(g.area[i]) || ctx.keep[i] || ctx.zone[i] || ctx.doorCell[i] || stair[i]) return false;
    // the opening side really is open (no floor at this storey: the rail stands on this edge)
    if (g.inBounds(x - dx, y - dy) && g.cells[g.idx(x - dx, y - dy)] === FLOOR) return false;
    for (let k = 1; k <= GARDEN.walk; k++) if (!open(x + dx * k, y + dy * k)) return false;
    return true;
  };
  for (const b of info.buildings) {
    if (!b.atrium) continue;
    const r = b.atrium.rect;
    const X0 = Math.round(r.x0 / CELL), X1 = Math.round(r.x1 / CELL), Y0 = Math.round(r.z0 / CELL), Y1 = Math.round(r.z1 / CELL);
    // [cells along the edge, the gallery row / column, walkway direction, rotation (the trough's front +Z toward the walkway)]
    const edges: {along: 'x' | 'z'; t0: number; t1: number; c: number; dx: number; dy: number; rot: number}[] = [
      {along: 'x', t0: X0, t1: X1, c: Y0 - 1, dx: 0, dy: -1, rot: Math.PI}, {along: 'x', t0: X0, t1: X1, c: Y1, dx: 0, dy: 1, rot: 0},
      {along: 'z', t0: Y0, t1: Y1, c: X0 - 1, dx: -1, dy: 0, rot: -Math.PI / 2}, {along: 'z', t0: Y0, t1: Y1, c: X1, dx: 1, dy: 0, rot: Math.PI / 2},
    ];
    for (const e of edges) {
      let t = e.t0;
      while (t < e.t1) {
        const cell = (q: number): [number, number] => (e.along === 'x' ? [q, e.c] : [e.c, q]);
        if (!okCell(...cell(t), e.dx, e.dy)) { t++; continue; }
        let u = t;
        while (u < e.t1 && okCell(...cell(u), e.dx, e.dy)) u++;
        st.edgeCells += u - t;
        // segments of GARDEN.seg cells end to end, the leftover split at both ends of the run
        const n = Math.floor((u - t) / GARDEN.seg), lead = Math.floor(((u - t) - n * GARDEN.seg) / 2);
        for (let s = 0; s < n; s++) {
          const q0 = t + lead + s * GARDEN.seg;
          const mid = (q0 + GARDEN.seg / 2) * CELL, across = (e.c + 0.5) * CELL;
          const [x, z] = e.along === 'x' ? [mid, across] : [across, mid];
          const [cx, cy] = cell(q0);
          const i = g.idx(cx, cy), area = g.area[i];
          const {hx, hz} = footprint(TROUGH, e.rot);
          const p: PropPlacement = {kind: TROUGH, x: r3(x), z: r3(z), y: r3(g.floorOf(i)), rot: r3(e.rot), area, hx, hz, h: PROP_DEFS[TROUGH].h, blocksSight: false, variant: rng.int(0, 9999), level: lv};
          const cells = Array.from({length: GARDEN.seg}, (_, k) => { const [bx, by] = cell(q0 + k); return g.idx(bx, by); });
          for (const c of cells) g.blocked[c] = 1;
          // never trap a cell (a gap left beside another fixture): the gallery area stays one connected walk
          if (!areaConnected(ctx, layout.areas[area])) { for (const c of cells) g.blocked[c] = 0; st.refused++; continue; }
          layout.props.push(p);
          st.troughs++;
        }
        t = u;
      }
    }
  }
}

function courtBenches(layout: StationLayout, rng: Rng, st: GardenStats): void {
  const info = layout.skyways!;
  const place = (lv: number, area: number, rect: {x0: number; z0: number; x1: number; z1: number}, n: number) => {
    const a = layout.areas[area], g = layout.levels[lv]?.grid;
    if (!a || !g || n <= 0) return;
    const ctx = makePlaceCtx(layout, rng, lv);
    keepLandmarkClear(ctx, layout);
    keepCirculation(ctx, layout);
    const p0 = layout.props.length;
    for (let t = 0; t < n * 14 && layout.props.length - p0 < n; t++) {
      const rot = rng.pick([0, Math.PI / 2, Math.PI, -Math.PI / 2]);
      const x = Math.round(rng.range(rect.x0 + 2, rect.x1 - 2) / CELL) * CELL, z = Math.round(rng.range(rect.z0 + 2, rect.z1 - 2) / CELL) * CELL;
      if (layout.props.slice(p0).some(q => Math.hypot(q.x - x, q.z - z) < 5)) continue;
      if (tryPlaceProp(ctx, a, BENCH, r3(x), r3(z), rot, {ring: GARDEN.ring})) { st.benches++; } else st.refused++;
    }
    for (let k = p0; k < layout.props.length; k++) {
      const p = layout.props[k];
      const [cx, cy] = g.cellOf(p.x, p.z);
      p.y = r3(p.y + (g.inBounds(cx, cy) ? g.floorOf(g.idx(cx, cy)) : layout.levels[lv].baseY));
      p.level = lv;
    }
  };
  // the atrium courts below the glass (street level: the court area under the opening's centre)
  const g1 = layout.levels[SKYWAYS_LEVEL.street]?.grid;
  if (g1) for (const b of info.buildings) {
    if (!b.atrium) continue;
    const r = b.atrium.rect;
    const [cx, cy] = g1.cellOf((r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2);
    if (!g1.inBounds(cx, cy)) continue;
    place(SKYWAYS_LEVEL.street, g1.area[g1.idx(cx, cy)], r, rng.int(...GARDEN.benches.atrium));
  }
  // the large skyway courts (the skylight candidates)
  const excluded = excludedAreas(layout);
  for (const a of layout.areas) {
    if ((a.level ?? 0) !== SKYWAYS_LEVEL.skyway || excluded.has(a.id) || !skylightCandidate(layout, a)) continue;
    const big = a.w * a.h * CELL * CELL >= 2.5 * SKYLIGHT.minArea;
    place(SKYWAYS_LEVEL.skyway, a.id, {x0: a.x * CELL, z0: a.y * CELL, x1: (a.x + a.w) * CELL, z1: (a.y + a.h) * CELL}, big ? rng.int(...GARDEN.benches.court) : 1);
  }
}
