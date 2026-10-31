// Task track3-eaton-centre-20261031 (lane ARCH): landmarks and navigation signage of The Eaton's Center — PURE data placement
// (no three.js), called once from gen/mall/index.ts after lane SHOPS' interiors (before the populations, so enemies / supplies avoid
// the new colliders). The brief: "landmarks, navigation signage".
//  - the PIT-PLAZA FOUNTAIN: a square stone basin with a broad sitting ledge (`fountainBasin`, 0.5 m) and a tiered bronze centrepiece
//    (`fountainSpire`, 2.3 m) in the 'Fountain court' under the atrium (the concentric terrazzo rings centre on it: world/mallArch.ts).
//    Dry / stagnant-water abandoned look (render). Anchored fixture: static with an honest reason (gen/mall/kinds.ts MALL_PHYS /
//    MALL_OPEN_AUDIT). Placed only where its footprint AND a full walkable ring around it are clear: a walkable ring round a convex
//    footprint can never disconnect the floor (validated again by mallIssues' reachability in tests), >= 4 m from every run mouth
//    (escalator / stair foot), >= 2 m from the track bed, never in a door zone or a stair approach;
//  - DIRECTORY PYLONS (`directoryPylon`, 0.9 x 0.3 x 2.1 m): one in the station court near the escalator feet and one on every ring
//    near an escalator head (3-8 m off the mouth), on public floor, never within 1.5 m of a railing (void / well edges), never in a
//    shopfront entry zone (3 m in front of a frontage) or a door zone; its faces are that storey's plan (canvas, world/mallArch.ts:
//    shop brands coloured by program, escalators / stairs / elevator / washrooms, a "You are here" dot at the pylon);
//  - WAYFINDING SIGNS (layout.signs, hung overhead, no collider): at every public run mouth — "Level N" up at the foot, "Level N" /
//    "Subway" down at the head — and "Washrooms" over every public washroom passage mouth on the rings.
// Task mall-playtest-revision-20261031 (lane ARCH): revised topology (station + 3 floors, corridor wings): a directory on EVERY storey
// (anchor fallbacks: escalator -> stair -> elevator landing -> wayfinding links), the station-return chain (lane GEN's
// wayfinding[].stationReturn) signed "Level k · Subway" at its run heads, and "Atrium · Escalators" signs inside every corridor wing
// where it meets the atrium court (the way back from the branches).
// Deterministic: candidates are scanned in a fixed order (no randomness; the rng parameter is reserved), so a seed always places the
// same landmarks.

import {CELL, FLOOR, VOID} from '../grid';
import type {Rng} from '../../core/rng';
import type {Area, SignPlacement, SignStyle, StationLayout} from '../stationTypes';
import type {RailRun} from '../levels';
import {forceProp, makePlaceCtx, propBlocksDoorway, type PlaceCtx} from '../placeKit';

/** Fountain basin (outer square half size, height incl. the coping) and the centrepiece (half size, height). */
export const FOUNTAIN = {half: 1.6, h: 0.5, ledge: 0.4, spireHalf: 0.85, spireH: 2.3, ring: 1.4, mouth: 4, bed: 2} as const;
/** The smaller fallback basin when no court spot fits the full one. */
export const FOUNTAIN_SMALL = {half: 1.25, ring: 1.2} as const;
/** Directory pylon box (w x d x h) and its placement distances. */
export const PYLON = {w: 0.9, d: 0.3, h: 2.1, ring: 0.8, near: 3, far: 8, rail: 1.5, mouth: 2.5, entry: 3} as const;
/** Wayfinding sign: hang height above the storey floor (centre), plate width, offset beyond the run mouth. */
export const WAYFINDING = {y: 2.6, w: 1.3, out: 0.9} as const;
/** The mall's wayfinding plate style (dark navy, cream text, amber rule). */
export const WAYFINDING_STYLE: SignStyle = {bg: 0x1f2b38, fg: 0xf2efe6, accent: 0xd9a520, font: 'sans'};

export interface LandmarkReport {
  fountain: {x: number; z: number; half: number; area: number; level: number} | null;
  pylons: {level: number; x: number; z: number; rot: number}[];
  /** Storeys that got no directory (diagnostics: anchor count, reject reasons while trying that storey). */
  pylonMiss: {level: number; anchors: number; rejects: Record<string, number>}[];
  signs: number;
  /** Candidates rejected per reason (diagnostics). */
  rejects: Record<string, number>;
}

type V = {x: number; z: number};
const d2 = (a: V, b: V) => (a.x - b.x) ** 2 + (a.z - b.z) ** 2;

/** Distance from a point to a rail run's segment (x / z). */
function railDist(r: RailRun, x: number, z: number): number {
  const dx = r.x1 - r.x0, dz = r.z1 - r.z0, L2 = dx * dx + dz * dz;
  const t = L2 > 0 ? Math.max(0, Math.min(1, ((x - r.x0) * dx + (z - r.z0) * dz) / L2)) : 0;
  return Math.hypot(x - (r.x0 + dx * t), z - (r.z0 + dz * t));
}

/** Run mouths (feet / heads of every public and service run) on storey `level`. */
function mouthsOn(layout: StationLayout, level: number): V[] {
  const out: V[] = [];
  for (const v of layout.mall?.verticals ?? []) {
    if (v.lower === level) out.push({x: v.foot.x, z: v.foot.z});
    if (v.upper === level) out.push({x: v.head.x, z: v.head.z});
  }
  for (const k of layout.levelLinks ?? []) {
    if (k.lower === level) out.push({x: k.bottom.x, z: k.bottom.z});
    if (k.upper === level) out.push({x: k.top.x, z: k.top.z});
  }
  return out;
}

/**
 * Whether a box (centre, half sizes) and a clearance ring around it are free on the storey grid: footprint cells open floor, never
 * blocked / on a ramp / in a door zone / a stair approach or an aperture setback, all in `allowed` areas; every ring cell walkable.
 */
function boxClear(ctx: PlaceCtx, x: number, z: number, hx: number, hz: number, ring: number, allowed: (a: number) => boolean, why: (r: string) => void): boolean {
  const g = ctx.g;
  const x0 = Math.floor((x - hx) / CELL), x1 = Math.ceil((x + hx) / CELL) - 1, y0 = Math.floor((z - hz) / CELL), y1 = Math.ceil((z + hz) / CELL) - 1;
  const r = Math.ceil(ring / CELL - 1e-6);
  for (let cy = y0 - r; cy <= y1 + r; cy++) for (let cx = x0 - r; cx <= x1 + r; cx++) {
    if (!g.inBounds(cx, cy)) { why('bounds'); return false; }
    const i = g.idx(cx, cy);
    const inside = cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1;
    if (inside) {
      if (g.cells[i] !== FLOOR || g.rampIdx[i] >= 0 || g.blocked[i]) { why('footprint'); return false; }
      if (!allowed(g.area[i])) { why('area'); return false; }
      if (ctx.zone[i] || ctx.doorCell[i] || ctx.edge[i] || ctx.keep[i]) { why('zone'); return false; }
    } else if (!g.walkable(cx, cy) || g.rampIdx[i] >= 0) { why('ring'); return false; }
  }
  return true;
}

/** Places the mall's fountain, directory pylons and wayfinding signs (see the header). */
export function placeMallLandmarks(layout: StationLayout, rng: Rng): LandmarkReport {
  void rng;
  const rep: LandmarkReport = {fountain: null, pylons: [], pylonMiss: [], signs: 0, rejects: {}};
  const why = (r: string) => { rep.rejects[r] = (rep.rejects[r] ?? 0) + 1; };
  const m = layout.mall;
  if (!m) return rep;
  const levels = layout.levels ?? [];
  const rails = layout.rails ?? [];
  const base = (lv: number) => levels[lv]?.baseY ?? 0;
  const ctxs = new Map<number, PlaceCtx>();
  const ctxOf = (lv: number) => { let c = ctxs.get(lv); if (!c) ctxs.set(lv, (c = makePlaceCtx(layout, rng, lv))); return c; };
  const vb = m.void.bounds, vc = {x: (vb.x0 + vb.x1) / 2, z: (vb.z0 + vb.z1) / 2};
  const galleries = new Set(m.galleries.flatMap(gl => gl.areas));
  const areaAt = (lv: number, x: number, z: number): number => { const g = levels[lv]?.grid ?? layout.grid; const [cx, cy] = g.cellOf(x, z); return g.inBounds(cx, cy) ? g.area[g.idx(cx, cy)] : -1; };
  const doorFree = (x: number, z: number, hx: number, hz: number, y: number) => !propBlocksDoorway(layout, x, z, hx + 0.6, hz + 0.6, y, 2.2);

  // --- the fountain: the court of the pit bottom labelled 'Fountain court' (else the first great hall), nearest the void's mid line
  // (task mall-playtest-revision: GEN's revised station courts may carry other roles — fall back to the public, non-platform station
  // areas within 10 m of the atrium, largest first)
  const pitPublic = layout.areas.filter(a => (a.level ?? 0) === m.void.floorLevel && a.publicSpace && a.kind !== 'platform' && !/track/i.test(a.label));
  const nearVoid = (a: Area) => (a.x + a.w) * CELL > vb.x0 - 10 && a.x * CELL < vb.x1 + 10 && (a.y + a.h) * CELL > vb.z0 - 10 && a.y * CELL < vb.z1 + 10;
  const courtAreas = layout.areas.filter(a => (a.level ?? 0) === m.void.floorLevel && a.role === 'great-hall');
  const named = courtAreas.filter(a => /fountain/i.test(a.label));
  const fallback = pitPublic.filter(nearVoid).sort((a, b) => b.w * b.h - a.w * a.h || a.id - b.id);
  // try the named court, the great halls, the public courts by the atrium, then any public station area (a crowded court: run mouths,
  // dressing) until the fountain and its walkable ring fit
  const courtSets: {lv: number; ids: Set<number>}[] = [named, courtAreas, fallback, pitPublic].filter(q => q.length).map(q => ({lv: m.void.floorLevel, ids: new Set(q.map(a => a.id))}));
  // the revised station may be platforms + a narrow court: then the first floor's atrium court (under the skylight)
  const floor1 = m.storeys.find(q => q.role === 'ring')?.level;
  const court1 = floor1 !== undefined ? m.courts?.find(q => q.level === floor1)?.areas ?? [] : [];
  if (floor1 !== undefined && court1.length) courtSets.push({lv: floor1, ids: new Set(court1)});
  let court = courtSets[0]?.ids ?? new Set<number>();
  for (const cset of courtSets) {
    if (rep.fountain) break;
    const cs = cset.ids;
    court = cs;
    const lv = cset.lv, ctx = ctxOf(lv), g = ctx.g;
    const mouths = mouthsOn(layout, lv);
    // track bed / platform-edge cells of the pit storey (keep 2 m off)
    const bed: V[] = [];
    for (let i = 0; i < g.cells.length; i++) if (g.cells[i] === VOID) { const cx = i % g.w, cy = (i - cx) / g.w; if ((cx + cy) % 2 === 0) bed.push({x: (cx + 0.5) * CELL, z: (cy + 0.5) * CELL}); }
    const cand: V[] = [];
    for (const a of layout.areas) if (court.has(a.id)) for (let cy = a.y; cy < a.y + a.h; cy++) for (let cx = a.x; cx < a.x + a.w; cx++) cand.push({x: (cx + 1) * CELL, z: (cy + 1) * CELL});
    cand.sort((p, q) => (Math.abs(p.x - vc.x) - Math.abs(q.x - vc.x)) || (p.z - q.z) || (p.x - q.x));
    for (const size of [{half: FOUNTAIN.half, ring: FOUNTAIN.ring}, FOUNTAIN_SMALL]) {
      for (const c of cand) {
        if (mouths.some(q => d2(q, c) < (FOUNTAIN.mouth + size.half) ** 2)) { why('fountain-mouth'); continue; }
        if (bed.some(q => Math.abs(q.x - c.x) < size.half + FOUNTAIN.bed && Math.abs(q.z - c.z) < size.half + FOUNTAIN.bed)) { why('fountain-bed'); continue; }
        if (!boxClear(ctx, c.x, c.z, size.half, size.half, size.ring, id => court.has(id) || (layout.areas[id]?.publicSpace ?? false) && layout.areas[id]?.kind !== 'platform', r => why(`fountain-${r}`))) continue;
        if (!doorFree(c.x, c.z, size.half, size.half, base(lv))) { why('fountain-door'); continue; }
        const ai = areaAt(lv, c.x, c.z);
        const a = layout.areas[ai] as Area;
        const basin = forceProp(ctx, a, 'fountainBasin', c.x, c.z, size.half, size.half, FOUNTAIN.h, false);
        basin.y = base(lv);
        const spire = forceProp(ctx, a, 'fountainSpire', c.x, c.z, FOUNTAIN.spireHalf, FOUNTAIN.spireHalf, FOUNTAIN.spireH, false);
        spire.y = base(lv);
        rep.fountain = {x: c.x, z: c.z, half: size.half, area: ai, level: lv};
        break;
      }
      if (rep.fountain) break;
    }
  }
  // the pylons' "court" = the station's court set (the fountain's when it stands there)
  court = (rep.fountain && rep.fountain.level === m.void.floorLevel ? courtSets.find(cs => cs.ids.has(rep.fountain!.area))?.ids : courtSets.find(cs => cs.lv === m.void.floorLevel)?.ids) ?? new Set<number>();

  // --- directory pylons: the pit court near its escalator feet, every ring near an escalator head ------------------------------
  const frontZones = m.shops.map(s => {
    const f = s.frontage, a = layout.areas[s.area];
    const alongX = Math.abs(f.x1 - f.x0) >= Math.abs(f.z1 - f.z0);
    const acx = a ? (a.x + a.w / 2) * CELL : 0, acz = a ? (a.y + a.h / 2) * CELL : 0;
    const sg = alongX ? Math.sign((f.z0 + f.z1) / 2 - acz) || 1 : Math.sign((f.x0 + f.x1) / 2 - acx) || 1;
    const e = PYLON.entry;
    return {level: s.level, x0: Math.min(f.x0, f.x1) - (alongX ? 0.5 : sg < 0 ? e : 0), x1: Math.max(f.x0, f.x1) + (alongX ? 0.5 : sg > 0 ? e : 0),
      z0: Math.min(f.z0, f.z1) - (alongX ? (sg < 0 ? e : 0) : 0.5), z1: Math.max(f.z0, f.z1) + (alongX ? (sg > 0 ? e : 0) : 0.5)};
  });
  for (const st of m.storeys) {
    const lv = st.level, ctx = ctxOf(lv);
    // anchors (task mall-playtest-revision: fallbacks so EVERY storey gets its directory): escalator heads (the station: feet), then
    // public stairs, then the elevator landing, then the storey's wayfinding link stand points
    const runEnd = (kind: string) => m.verticals.filter(v => v.kind === kind && (lv === m.void.floorLevel ? v.lower === lv : v.upper === lv))
      .map(v => (lv === m.void.floorLevel && v.lower === lv ? {x: v.foot.x, z: v.foot.z, dir: {x: v.foot.x - v.head.x, z: v.foot.z - v.head.z}} : {x: v.head.x, z: v.head.z, dir: {x: v.head.x - v.foot.x, z: v.head.z - v.foot.z}}));
    const lift = m.elevators.flatMap(e => {
      const c = {x: (e.shaft.x0 + e.shaft.x1) / 2, z: (e.shaft.z0 + e.shaft.z1) / 2}, vz = (m.void.bounds.z0 + m.void.bounds.z1) / 2;
      const n = c.z < vz ? -1 : 1, edge = n < 0 ? e.shaft.z0 : e.shaft.z1;
      return e.stops.some(q => q.level === lv) ? [{x: c.x, z: edge, dir: {x: 0, z: n}}] : [];
    });
    const links = (m.wayfinding?.find(w => w.level === lv)?.links ?? []).map(k => ({x: k.at.x, z: k.at.z, dir: {x: k.at.x - vc.x, z: k.at.z - vc.z}}));
    const anchors = [...runEnd('escalator'), ...runEnd('stair'), ...lift, ...links];
    const before = {...rep.rejects};
    if (!anchors.length) { rep.pylonMiss.push({level: lv, anchors: 0, rejects: {}}); continue; }
    const mouths = mouthsOn(layout, lv);
    const lvRails = rails.filter(r => r.level === lv);
    // public walkways: the galleries / courts / corridors of a floor; on the station storey any public court (never a platform)
    const ok = (id: number) => id >= 0 && (galleries.has(id) || court.has(id) || ((layout.areas[id]?.publicSpace ?? false)
      && (layout.areas[id]?.role === 'great-hall' || (lv === m.void.floorLevel && layout.areas[id]?.kind !== 'platform'))));
    let placed = false;
    const faceTo = (an: V, x: number, z: number) => { const toX = an.x - x, toZ = an.z - z; return Math.abs(toZ) >= Math.abs(toX) ? (toZ >= 0 ? 0 : Math.PI) : (toX >= 0 ? Math.PI / 2 : -Math.PI / 2); };
    // the last resort (a crowded court): every public cell within 12 m of an anchor, nearest to 4.5 m of one first
    const wide = {x: 0, z: 0, dir: {x: 0, z: 0}, wide: true};
    for (const an of [...anchors, wide]) {
      const cand: (V & {rot: number})[] = [];
      if ((an as {wide?: boolean}).wide) {
        const g = ctx.g;
        for (let cy = 0; cy < g.h; cy++) for (let cx = 0; cx < g.w; cx++) {
          const i = g.idx(cx, cy);
          if (g.cells[i] !== FLOOR || !ok(g.area[i])) continue;
          const x = (cx + 1) * CELL, z = (cy + 1) * CELL;
          let best: V | null = null, bd = Infinity;
          for (const a of anchors) { const d = Math.abs(Math.sqrt(d2(a, {x, z})) - 4.5); if (d < bd) { bd = d; best = a; } }
          if (best && Math.sqrt(d2(best, {x, z})) <= 12) cand.push({x, z, rot: faceTo(best, x, z)});
        }
        cand.sort((p, q) => Math.min(...anchors.map(a => Math.abs(Math.sqrt(d2(p, a)) - 4.5))) - Math.min(...anchors.map(a => Math.abs(Math.sqrt(d2(q, a)) - 4.5))) || p.x - q.x || p.z - q.z);
      } else {
        const dl = Math.hypot(an.dir.x, an.dir.z) || 1, ux = an.dir.x / dl, uz = an.dir.z / dl;
        // candidates: a fan beyond the mouth (along the run direction, then sideways), nearest to 4.5 m first
        for (let d = PYLON.near; d <= PYLON.far + 1e-6; d += 0.5) for (const side of [0, 1, -1, 2, -2, 3, -3, 4, -4]) {
          const x = an.x + ux * d - uz * side, z = an.z + uz * d + ux * side;
          cand.push({x: Math.round(x / CELL) * CELL, z: Math.round(z / CELL) * CELL, rot: faceTo(an, x, z)});
        }
        cand.sort((p, q) => Math.abs(Math.sqrt(d2(p, an)) - 4.5) - Math.abs(Math.sqrt(d2(q, an)) - 4.5) || p.x - q.x || p.z - q.z);
      }
      for (const c of cand) {
        const quarter = Math.abs(Math.sin(c.rot)) > 0.5;
        const hx = (quarter ? PYLON.d : PYLON.w) / 2, hz = (quarter ? PYLON.w : PYLON.d) / 2;
        if (mouths.some(q => d2(q, c) < PYLON.mouth ** 2)) { why('pylon-mouth'); continue; }
        if (lvRails.some(r => railDist(r, c.x, c.z) < PYLON.rail + Math.max(hx, hz))) { why('pylon-rail'); continue; }
        if (frontZones.some(f => f.level === lv && c.x + hx > f.x0 && c.x - hx < f.x1 && c.z + hz > f.z0 && c.z - hz < f.z1)) { why('pylon-entry'); continue; }
        // the fountain keeps its whole clearance ring (and the pylon its own beyond it)
        const fr = rep.fountain ? rep.fountain.half + (rep.fountain.half >= FOUNTAIN.half ? FOUNTAIN.ring : FOUNTAIN_SMALL.ring) + PYLON.ring : 0;
        if (rep.fountain && lv === rep.fountain.level && Math.abs(c.x - rep.fountain.x) < fr + hx && Math.abs(c.z - rep.fountain.z) < fr + hz) { why('pylon-fountain'); continue; }
        if (!boxClear(ctx, c.x, c.z, hx, hz, PYLON.ring, ok, r => why(`pylon-${r}`))) continue;
        if (!doorFree(c.x, c.z, hx, hz, base(lv))) { why('pylon-door'); continue; }
        const a = layout.areas[areaAt(lv, c.x, c.z)] as Area;
        const p = forceProp(ctx, a, 'directoryPylon', c.x, c.z, hx, hz, PYLON.h, false);
        p.y = base(lv);
        p.rot = c.rot;
        rep.pylons.push({level: lv, x: c.x, z: c.z, rot: c.rot});
        placed = true;
        break;
      }
      if (placed) break;
    }
    if (!placed) {
      const diff: Record<string, number> = {};
      for (const [k, n] of Object.entries(rep.rejects)) if (n !== (before[k] ?? 0)) diff[k] = n - (before[k] ?? 0);
      rep.pylonMiss.push({level: lv, anchors: anchors.length, rejects: diff});
    }
  }

  // --- wayfinding signs: every public run mouth (escalator banks, public stairs), washroom passage mouths on the rings -----------
  const banks = new Map<string, {kind: string; lower: number; upper: number; foot: V; head: V; n: number}>();
  for (const v of m.verticals) {
    if (v.kind !== 'escalator' && v.kind !== 'stair') continue;
    const key = `${v.kind}|${v.lower}|${v.upper}|${Math.round(v.foot.x / 4)}|${Math.round(v.foot.z / 4)}`;
    const b = banks.get(key);
    if (!b) banks.set(key, {kind: v.kind, lower: v.lower, upper: v.upper, foot: {x: v.foot.x, z: v.foot.z}, head: {x: v.head.x, z: v.head.z}, n: 1});
    else { b.foot.x += v.foot.x; b.foot.z += v.foot.z; b.head.x += v.head.x; b.head.z += v.head.z; b.n++; }
  }
  const label = (lv: number) => (lv === m.void.floorLevel ? 'Subway' : `Level ${lv}`);
  // task mall-playtest-revision (station-return wayfinding): the runs of each storey's public way down to the station (lane GEN's
  // wayfinding[].stationReturn) are signed "Level k · Subway" at their head, so the chain down is readable floor by floor
  const returnRun = new Set<string>();
  for (const w of m.wayfinding ?? []) for (const step of w.stationReturn) {
    const v = m.verticals[step.vertical];
    if (v && step.to !== m.void.floorLevel) returnRun.add(`${v.kind}|${v.lower}|${v.upper}|${Math.round(v.foot.x / 4)}|${Math.round(v.foot.z / 4)}`);
  }
  const sign = (lv: number, at: V, face: V, text: string, arrow: SignPlacement['arrow']) => {
    const ai = areaAt(lv, at.x, at.z);
    if (ai < 0) return;
    layout.signs.push({x: at.x, y: base(lv) + WAYFINDING.y, z: at.z, rot: Math.atan2(face.x, face.z), kind: 'info', text, area: ai, arrow, hang: true, w: WAYFINDING.w,
      level: lv, style: WAYFINDING_STYLE});
    rep.signs++;
  };
  for (const [key, b] of [...banks.entries()].sort(([, p], [, q]) => p.lower - q.lower || p.foot.x - q.foot.x || p.foot.z - q.foot.z)) {
    const foot = {x: b.foot.x / b.n, z: b.foot.z / b.n}, head = {x: b.head.x / b.n, z: b.head.z / b.n};
    const dl = Math.hypot(head.x - foot.x, head.z - foot.z) || 1, ux = (head.x - foot.x) / dl, uz = (head.z - foot.z) / dl;
    // at the foot (lower storey), beyond the mouth, facing the walker who approaches it: "Level <upper>" up
    sign(b.lower, {x: foot.x - ux * WAYFINDING.out, z: foot.z - uz * WAYFINDING.out}, {x: -ux, z: -uz}, label(b.upper), 'up');
    // at the head (upper storey): "Level <lower>" / "Subway" down ("Level <lower> · Subway" on the way back to the station)
    sign(b.upper, {x: head.x + ux * WAYFINDING.out, z: head.z + uz * WAYFINDING.out}, {x: ux, z: uz}, returnRun.has(key) ? `${label(b.lower)} · Subway` : label(b.lower), 'down');
  }
  // corridor wings / branches beyond the atrium: where a corridor meets the atrium court, a sign inside the corridor facing a walker
  // on the way out of it — "Atrium · Escalators" ahead (task mall-playtest-revision: the way back from every branch)
  for (const st of m.storeys) {
    const lv = st.level, g = levels[lv]?.grid;
    const corr = new Set(m.corridors?.find(q => q.level === lv)?.areas ?? []), courts = new Set(m.courts?.find(q => q.level === lv)?.areas ?? []);
    if (!g || !corr.size || !courts.size) continue;
    const joins = new Map<number, {x: number; z: number; nx: number; nz: number; n: number}>();
    for (let cy = 1; cy < g.h - 1; cy++) for (let cx = 1; cx < g.w - 1; cx++) {
      const i = g.idx(cx, cy), a = g.area[i];
      if (!corr.has(a) || g.cells[i] !== FLOOR) continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const j = g.idx(cx + dx, cy + dy);
        if (!courts.has(g.area[j]) || g.cells[j] !== FLOOR) continue;
        let q = joins.get(a);
        if (!q) joins.set(a, (q = {x: 0, z: 0, nx: 0, nz: 0, n: 0}));
        q.x += (cx + 0.5) * CELL; q.z += (cy + 0.5) * CELL; q.nx -= dx; q.nz -= dy; q.n++;
      }
    }
    for (const [a, q] of [...joins.entries()].sort((p, r) => p[0] - r[0])) {
      if (q.n < 3) continue;
      const jx = q.x / q.n, jz = q.z / q.n;
      // the dominant axis of the corridor's direction away from the court
      const n = Math.abs(q.nx) >= Math.abs(q.nz) ? {x: Math.sign(q.nx), z: 0} : {x: 0, z: Math.sign(q.nz)};
      const at = {x: jx + n.x * 2.5, z: jz + n.z * 2.5};
      if (areaAt(lv, at.x, at.z) !== a) continue;
      sign(lv, at, n, 'Atrium · Escalators', 'up');
    }
  }
  for (const a of layout.areas) {
    if (!a.publicSpace || !/washroom/i.test(a.label) || a.kind !== 'passage' || (a.level ?? 0) === m.void.floorLevel) continue;
    const lv = a.level ?? 0;
    for (const d of layout.doors) {
      if ((d.a !== a.id && d.b !== a.id) || ((d as {level?: number}).level ?? 0) !== lv) continue;
      const other = d.a === a.id ? d.b : d.a;
      if (!galleries.has(other)) continue;
      const cx = (d.x + d.w / 2) * CELL, cz = (d.y + d.h / 2) * CELL;
      const ac = {x: (a.x + a.w / 2) * CELL, z: (a.y + a.h / 2) * CELL};
      const alongX = d.w >= d.h;
      const sg = alongX ? Math.sign(cz - ac.z) || 1 : Math.sign(cx - ac.x) || 1;
      const out = alongX ? {x: 0, z: sg} : {x: sg, z: 0};
      sign(lv, {x: cx + out.x * 0.8, z: cz + out.z * 0.8}, out, 'Washrooms', 'up');
    }
  }
  return rep;
}
