// Task studio-surface-run-field-followup-20261116-211729-01 (lane FACADE; user: "Improve facades with the existing architectural assets /
// materials and coherent variety / detail, not blank box fronts"): THE FACADE DETAIL PASS of a district building — decided once per
// building after its look plan (archPlan.ts planBuilding), PURE data (no three.js), drawn by the surface arch (arch.ts buildBuilding)
// with the district's existing finishes only (the facade families, trims, boards, shutters, the office fabric as awning canvas, steel).
// Its own hash stream per building (FACADE_DETAIL_TAG): no draw of the plan's streams moves; no layout cell changes (render side only,
// every district version).
//
//  - ROW REPAIR: an 'industrial-shed' style's window row stands `win.sill` (5.2 m) above each storey floor — a row for one tall shed
//    storey. On GEN's storeys (a 4-5 m ground storey and more above; warehouses, the depot, every parking garage) that row fell into the
//    next storey and was clipped to the storey's top: ~600 decorative openings a district were inverted (head below sill), cut nothing
//    and drew only stray sills: the sheds and garages were blank boxes (a face audit: 2/3 of all blank storey rows). Inverted / sliver
//    openings are dropped; a shed gets ONE clerestory row under its roof line, a parking garage its open deck bays (a spandrel and a
//    slab edge per storey, columns between the bays).
//  - CLOSED WINDOWS (blinds): the window grid skips storeys with a carved interior behind the facade (a decorative opening would cut
//    into the room). Those storeys now carry the grid's windows CLOSED, drawn ON the wall (never cut): boarded, shuttered, infilled
//    (a newer, darker infill of the facade's own finish) or, on a curtain wall, an opaque spandrel panel. The room behind keeps its wall,
//    so inside and outside agree (a closed window); GEN's live spans (AIR's panes) keep their openings — the grid never covers one.
//  - AWNINGS over glazed shop bays (intact / damaged shops; a damaged one may be just its bare steel frame), one canvas colour per
//    building from a small palette (the office fabric, tinted: the canvas family).
//  - RELIEF: pilasters / quoins at the ends of a masonry side, a base course (plinth) along the street, the civic style's pilasters
//    between window bays, the precast centre's panel fins — the side's own finish (tinted darker for the plinth), never over an opening;
//    a shed's steel columns at its bays and a sealed personnel door (a steel leaf, planks nailed across: visibly not a way in).
//
// The arch draws all of it in the facade accumulators it already has (one more family: the awning canvas): a few draws a district and a
// few percent of its facade triangles (tests/surface-facade-detail.test.ts pins both).

import {mulberry32} from '../../core/rng';
import type {Side, StationLayout} from '../../gen/stationTypes';
import type {SurfaceBuilding} from '../../gen/surface/surfaceTypes';
import {entranceFloor, rollHole, topAt, type BuildingLook, type FacadeHole} from './archPlan';

/** A closed (never cut) window on a facade: world s along its side, absolute y. */
export type BlindKind = 'boarded' | 'shutter' | 'infill' | 'panel' | 'door';
export interface BlindWindow { side: Side; s0: number; s1: number; y0: number; y1: number; kind: BlindKind; storey: number }
/** A shop awning: the bay it shades (s), the top edge's height at the wall, its projection; `key` its canvas member key; torn: frame only. */
export interface Awning { side: Side; s0: number; s1: number; y: number; depth: number; drop: number; key: string; torn: boolean }
/**
 * A relief strip on a facade: a pilaster / fin ('pier'), the base course ('plinth') or a shed's steel column ('column'), s0..s1 x
 * y0..y1, standing `out` proud.
 */
export interface Relief { side: Side; s0: number; s1: number; y0: number; y1: number; out: number; kind: 'pier' | 'plinth' | 'column' }
export interface FacadeDetail {
  blinds: BlindWindow[];
  awnings: Awning[];
  relief: Relief[];
  /**
   * The finish keys of the facade's own parts: a closed window's infill, a curtain wall's spandrel panel, the base course — darker
   * MEMBERS of the facade's tint family (shadeMemberKey: a real member key, so every tinted vertex is a member's colour); stucco (no
   * family): its own key, its trim for the base course.
   */
  keys: {infill: string; panel: string; plinth: string};
  /** Row repair (QA): decorative openings dropped (inverted / slivers), clerestory and garage-bay openings added. */
  dropped: number; added: number;
}
const NO_KEYS = Object.freeze({infill: '', panel: '', plinth: ''});
export const EMPTY_FACADE_DETAIL: FacadeDetail = Object.freeze({
  blinds: Object.freeze([]) as unknown as BlindWindow[], awnings: Object.freeze([]) as unknown as Awning[], relief: Object.freeze([]) as unknown as Relief[],
  keys: NO_KEYS, dropped: 0, added: 0,
});

const TINTED_MEMBER = /^surface-facade-(brick|concrete|stone|metal|curtain|canvas)-([0-9a-f]{6})$/;
const toLin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toSrgb = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);
/**
 * A darker member of a tinted facade family: 'surface-facade-<wall>-<hex>' with its colour scaled by `k` in LINEAR light (with the
 * district's textures loaded a member's colour is linear in its hex's linear value for every wall: archMaterials.ts rel / lin; the
 * untextured fallbacks — Node, a failed fetch — mix in or keep their own base colour), else null (not a tinted member).
 */
export function shadeMemberKey(key: string, k: number): string | null {
  const m = TINTED_MEMBER.exec(key);
  if (!m) return null;
  const hex = parseInt(m[2], 16);
  const ch = [16, 8, 0].map(s => Math.max(0, Math.min(255, Math.round(toSrgb(toLin(((hex >> s) & 255) / 255) * k) * 255))));
  return `surface-facade-${m[1]}-${((ch[0] << 16) | (ch[1] << 8) | ch[2]).toString(16).padStart(6, '0')}`;
}
/** Every tinted-family member key a building's detail draws (its shaded facade members, the awning canvases; tests). */
export function facadeDetailMembers(d: FacadeDetail): string[] {
  const out = new Set<string>();
  for (const k of [d.keys.infill, d.keys.panel, d.keys.plinth, ...d.awnings.map(a => a.key)]) if (TINTED_MEMBER.test(k)) out.add(k);
  return [...out];
}

/** The detail pass's own hash stream tag (per building: + id). Far from the plan's tags (11, 23, 1000 + 7 id, 5000 + id). */
export const FACADE_DETAIL_TAG = 40000;
/** Awning canvas colours (sRGB): faded red, bottle green, navy, sand, plum — 'surface-facade-canvas-<hex>' (the fabric family). */
export const AWNING_TINTS: readonly number[] = [0x7d3a32, 0x3d5b47, 0x37465e, 0x8c7a56, 0x5a4058];
/** Thinnest decorative opening kept (m): below it an opening cuts nothing and draws only its sill. */
export const MIN_OPENING = 0.4;

const MASONRY = new Set(['brick', 'stucco', 'stone', 'concrete']);
const BLIND_ODDS: Readonly<Record<SurfaceBuilding['condition'], readonly [BlindKind, number][]>> = {
  intact: [['shutter', 0.45], ['boarded', 0.3], ['infill', 0.25]],
  damaged: [['boarded', 0.45], ['shutter', 0.25], ['infill', 0.3]],
  gutted: [['boarded', 0.55], ['infill', 0.45]],
  collapsed: [['boarded', 0.55], ['infill', 0.45]],
};
const stream = (seed: number, tag: number) => mulberry32(((seed ^ Math.imul(tag + 0x9e37, 0x85ebca6b)) >>> 0) || 1);

/**
 * The detail of building `bl` (and its row repair: `bl.holes` is edited in place — dropped / added decorative openings). Call once,
 * right after planBuilding (archPlan.ts).
 */
export function planFacadeDetail(layout: StationLayout, bl: BuildingLook, seed: number): FacadeDetail {
  const st = bl.style;
  if (st.wall === 'canvas' || !bl.sides.length) return {blinds: [], awnings: [], relief: [], keys: NO_KEYS, dropped: 0, added: 0};
  const r = stream(seed, FACADE_DETAIL_TAG + bl.id);
  const b = bl.b, cond: SurfaceBuilding['condition'] = b.condition;
  const base0 = bl.storeyY[0] ?? 0;
  const keys = {infill: shadeMemberKey(bl.key, 0.8) ?? bl.key, panel: shadeMemberKey(bl.key, 0.55) ?? bl.key, plinth: shadeMemberKey(bl.key, 0.62) ?? bl.trimKey};
  const out: FacadeDetail = {blinds: [], awnings: [], relief: [], keys, dropped: 0, added: 0};
  // --- row repair: inverted / sliver decorative openings cut nothing ---
  const before = bl.holes.length;
  bl.holes = bl.holes.filter(h => h.kind === 'air' || h.kind === 'door-boarded' || h.y1 - h.y0 >= MIN_OPENING);
  out.dropped = before - bl.holes.length;
  const inInterior = (y0: number, y1: number) => bl.interiors.some(([a, c]) => y1 > a + 0.05 && y0 < c - 0.05);
  const storeyOf = (y: number) => Math.max(0, bl.storeyY.findIndex((v, k) => y >= v - 0.05 && y < v + bl.storeyHs[k]));
  const roll = (odds: readonly [BlindKind, number][]): BlindKind => { let u = r(); for (const [k, p] of odds) if ((u -= p) <= 0) return k; return odds[odds.length - 1][0]; };
  const blindKind = (): BlindKind => (st.windows === 'curtain' ? 'panel' : roll(BLIND_ODDS[cond] ?? BLIND_ODDS.intact));
  for (const sd of bl.sides) {
    if (!sd.open) continue;
    const L = sd.s1 - sd.s0;
    const topHere = (s0: number, s1: number) => Math.min(topAt(sd, s0, bl.top), topAt(sd, s1, bl.top), topAt(sd, (s0 + s1) / 2, bl.top));
    /** Whether s0..s1 x y0..y1 (+ margins) is clear of the side's openings, entrances, signs and placed blinds. */
    const clear = (s0: number, s1: number, y0: number, y1: number, ms = 0.35, my = 0.2) => {
      if (s0 < sd.s0 + 0.5 || s1 > sd.s1 - 0.5 || y1 > topHere(s0, s1) - 0.35) return false;
      for (const h of bl.holes) if (h.side === sd.side && s1 > h.s0 - ms && s0 < h.s1 + ms && y1 > h.y0 - my && y0 < h.y1 + my) return false;
      // (the closed windows of one row stand at the grid's own pitch: a band / curtain row's panes are closer than `ms`)
      for (const w of out.blinds) if (w.side === sd.side && s1 > w.s0 - 0.05 && s0 < w.s1 + 0.05 && y1 > w.y0 - my && y0 < w.y1 + my) return false;
      for (const sg of bl.signs) if (sg.side === sd.side && s1 > sg.s0 - 0.1 && s0 < sg.s1 + 0.1 && y1 > sg.y0 - 0.1 && y0 < sg.y1 + 0.1) return false;
      for (const e of b.entrances) {
        if (e.side !== sd.side) continue;
        const c = sd.alongX ? e.x : e.z, f = entranceFloor(layout, e);
        if (s1 > c - e.width / 2 - 0.5 && s0 < c + e.width / 2 + 0.5 && y0 < f + e.height + 0.4 && y1 > f) return false;
      }
      return true;
    };
    const opening = (s0: number, s1: number, y0: number, y1: number, kind: FacadeHole['kind']) => {
      if (!clear(s0, s1, y0, y1)) return;
      if (inInterior(y0, y1)) { out.blinds.push({side: sd.side, s0, s1, y0, y1, kind: blindKind(), storey: storeyOf(y0)}); return; }
      bl.holes.push({side: sd.side, s0, s1, y0, y1, kind, storey: storeyOf(y0)});
      out.added++;
    };
    if (b.kind === 'parking') {
      // the garage's open decks: per storey a spandrel (1.05 m) and a slab edge (0.45 m) round long bays between columns (~7.5 m)
      const nb = Math.max(1, Math.round((L - 1) / 7.5)), bw = (L - 1) / nb;
      for (let k = 0; k < bl.storeys; k++) {
        if (k === 0 && sd.frontage) continue; // the dock / ramp doors
        const yb = bl.storeyY[k], y0 = yb + 1.05, y1 = yb + bl.storeyHs[k] - 0.45;
        if (y1 - y0 < 1.1) continue;
        for (let j = 0; j < nb; j++) opening(sd.s0 + 0.5 + j * bw + 0.25, sd.s0 + 0.5 + (j + 1) * bw - 0.25, y0, y1, 'dark');
      }
    } else if (st.windows === 'high' && !bl.holes.some(h => h.side === sd.side && h.kind !== 'air' && h.kind !== 'door-boarded' && h.kind !== 'shutter')) {
      // a shed's clerestory: one row under the roof line (the eaves 0.45 m above its head), clear of the dock doors
      const wn = st.win, y1 = Math.min(bl.deck, bl.top) - 0.45, y0 = y1 - wn.h;
      if (y0 >= base0 + 3.2) {
        const nwin = Math.floor((L - 1.6) / wn.pitch);
        const c0 = sd.s0 + (L - (nwin - 1) * wn.pitch) / 2;
        for (let j = 0; j < nwin; j++) opening(c0 + j * wn.pitch - wn.w / 2, c0 + j * wn.pitch + wn.w / 2, y0, y1, rollHole(r, cond));
      }
    }
    // --- closed windows: the grid's storeys the plan skipped for the interior behind ---
    if (st.windows !== 'none' && st.windows !== 'high' && b.kind !== 'parking') {
      const wn = st.win, pitch = st.windows === 'band' ? wn.w + 0.32 : wn.pitch;
      const nwin = Math.floor((L - 1.6) / pitch);
      for (let k = 0; k < bl.storeys && nwin >= 1; k++) {
        const yb = bl.storeyY[k], hk = bl.storeyHs[k];
        if (k === 0 && st.ground !== 'none' && st.ground !== 'plinth' && sd.frontage) continue;
        const y0 = yb + wn.sill, y1 = Math.min(y0 + wn.h, yb + hk - 0.08);
        if (y0 + wn.h > yb + hk - 0.15 && st.windows !== 'curtain') continue;
        if (y1 - y0 < MIN_OPENING || !inInterior(y0, y1)) continue;
        const c0 = sd.s0 + (L - (nwin - 1) * pitch) / 2, hw = (st.windows === 'curtain' ? pitch - 0.1 : wn.w) / 2;
        for (let j = 0; j < nwin; j++) {
          const c = c0 + j * pitch;
          if (clear(c - hw, c + hw, y0, y1)) out.blinds.push({side: sd.side, s0: c - hw, s1: c + hw, y0, y1, kind: blindKind(), storey: k});
        }
      }
    }
    // --- awnings over the glazed shop bays ---
    const awnOdds = cond === 'intact' ? 0.55 : cond === 'damaged' ? 0.4 : 0;
    if (awnOdds > 0) {
      const key = `surface-facade-canvas-${AWNING_TINTS[Math.floor(r() * AWNING_TINTS.length) % AWNING_TINTS.length].toString(16).padStart(6, '0')}`;
      for (const h of bl.holes) {
        if (h.side !== sd.side || h.kind !== 'shop' || h.storey !== 0 || r() >= awnOdds) continue;
        // its top edge just under the fascia sign (or 0.3 m over the bay), projecting over the sidewalk, never above the roof line
        const sign = bl.signs.find(sg => sg.side === sd.side && sg.s1 > h.s0 && sg.s0 < h.s1);
        const y = sign ? sign.y0 - 0.07 : h.y1 + 0.3;
        const drop = 0.42;
        if (y + 0.2 > topHere(h.s0, h.s1) || y - drop < base0 + 2.25) continue;
        out.awnings.push({side: sd.side, s0: h.s0 - 0.12, s1: h.s1 + 0.12, y, depth: 1.05, drop, key, torn: cond === 'damaged' && r() < 0.4});
      }
    }
    if (st.wall === 'metal' && L >= 6) {
      // a shed's steel columns at its bays (~6 m; stopped under a clerestory pane) and a sealed personnel door on a side wall
      const nc = b.kind === 'parking' ? -1 : Math.max(1, Math.round(L / 6)); // (a garage's columns stand between its deck bays)
      for (let j = 0; j <= nc; j++) {
        const c = Math.min(sd.s1 - 0.14, Math.max(sd.s0 + 0.14, sd.s0 + (L * j) / nc)), s0 = c - 0.13, s1 = c + 0.13, y0 = base0 - 0.15;
        let y1 = topHere(s0, s1) - 0.05;
        for (const h of bl.holes) if (h.side === sd.side && s1 > h.s0 - 0.1 && s0 < h.s1 + 0.1) y1 = Math.min(y1, h.y0 - 0.1);
        for (const e of b.entrances) if (e.side === sd.side) { const ec = sd.alongX ? e.x : e.z; if (s1 > ec - e.width / 2 - 0.2 && s0 < ec + e.width / 2 + 0.2) y1 = -Infinity; }
        if (y1 - y0 > 2.4) out.relief.push({side: sd.side, s0, s1, y0, y1, out: 0.16, kind: 'column'});
      }
      if (!sd.frontage && L >= 10 && r() < 0.6) {
        const c = sd.s0 + L * (0.25 + r() * 0.5), y0 = base0 + 0.02, y1 = base0 + 2.15;
        if (clear(c - 0.55, c + 0.55, y0, y1)) out.blinds.push({side: sd.side, s0: c - 0.55, s1: c + 0.55, y0, y1, kind: 'door', storey: 0});
      }
      continue;
    }
    // --- relief: masonry only (not the curtain / sheet-metal / canvas walls) ---
    if (!MASONRY.has(st.wall) || L < 6) continue;
    const pierFree = (s0: number, s1: number, y0: number, y1: number) => {
      for (const h of bl.holes) if (h.side === sd.side && s1 > h.s0 - 0.12 && s0 < h.s1 + 0.12 && y1 > h.y0 && y0 < h.y1) return false;
      for (const w of out.blinds) if (w.side === sd.side && s1 > w.s0 - 0.12 && s0 < w.s1 + 0.12 && y1 > w.y0 && y0 < w.y1) return false;
      for (const e of b.entrances) if (e.side === sd.side) { const c = sd.alongX ? e.x : e.z; if (s1 > c - e.width / 2 - 0.2 && s0 < c + e.width / 2 + 0.2) return false; }
      for (const sg of bl.signs) if (sg.side === sd.side && s1 > sg.s0 - 0.1 && s0 < sg.s1 + 0.1 && y1 > sg.y0 && y0 < sg.y1) return false;
      return true;
    };
    const capOf = (s0: number, s1: number) => {
      const t = topHere(s0, s1);
      return Math.abs(t - bl.top) < 1e-3 && st.cornice.h > 0 ? t - st.cornice.h - 0.08 : t - 0.02;
    };
    const pier = (s0: number, s1: number, y0: number, out_: number) => {
      const y1 = capOf(s0, s1);
      if (y1 - y0 > 1.2 && pierFree(s0, s1, y0, y1)) out.relief.push({side: sd.side, s0, s1, y0, y1, out: out_, kind: 'pier'});
    };
    // quoins / end pilasters
    const pw = st.wall === 'stone' ? 0.6 : 0.36;
    pier(sd.s0, sd.s0 + pw, base0 - 0.15, 0.1);
    pier(sd.s1 - pw, sd.s1, base0 - 0.15, 0.1);
    if (st.id === 'civic-stone' && bl.storeys >= 2) {
      // pilasters between the window bays above the ground storey
      const pitch = st.win.pitch, nwin = Math.floor((L - 1.6) / pitch), c0 = sd.s0 + (L - (nwin - 1) * pitch) / 2;
      for (let j = 0; j + 1 < nwin; j++) { const c = c0 + (j + 0.5) * pitch; pier(c - 0.27, c + 0.27, bl.storeyY[1] - 0.1, 0.14); }
    } else if (st.windows === 'none' && st.id === 'precast-centre') {
      // precast panel fins over the ground storey (the bays and their signs below)
      const nf = Math.max(1, Math.round(L / 6.5)), y0 = base0 + (bl.storeyHs[0] ?? 4.6);
      for (let j = 1; j < nf; j++) { const c = sd.s0 + (L * j) / nf; pier(c - 0.18, c + 0.18, y0, 0.08); }
    }
    // the base course along the street: split round every opening / entrance reaching below its top
    const ph = st.wall === 'stone' ? 0.9 : 0.5, py0 = base0 - 0.15, py1 = base0 + ph;
    const cuts: [number, number][] = [];
    for (const h of bl.holes) if (h.side === sd.side && h.y0 < py1 + 0.1) cuts.push([h.s0 - 0.12, h.s1 + 0.12]);
    for (const e of b.entrances) if (e.side === sd.side) { const c = sd.alongX ? e.x : e.z; cuts.push([c - e.width / 2 - 0.14, c + e.width / 2 + 0.14]); }
    cuts.sort((p, q) => p[0] - q[0]);
    let s = sd.s0;
    const run = (a: number, e: number) => { if (e - a > 0.3) out.relief.push({side: sd.side, s0: a, s1: e, y0: py0, y1: py1, out: 0.05, kind: 'plinth'}); };
    for (const [a, e] of cuts) { if (a > s) run(s, Math.min(a, sd.s1)); s = Math.max(s, e); }
    if (s < sd.s1) run(s, sd.s1);
  }
  return out;
}

/** Relief / blind / awning counts of a building (QA). */
export function facadeDetailSummary(d: FacadeDetail): Record<string, number> {
  return {blinds: d.blinds.length, awnings: d.awnings.length, piers: d.relief.filter(x => x.kind === 'pier').length,
    plinths: d.relief.filter(x => x.kind === 'plinth').length, dropped: d.dropped, added: d.added};
}
