// Task studio-surface-run-opus-rebuild-20261116-020827-01 (lane LIFE): THE PLANNING MAP'S DRAWING — pure (strings / a minimal 2D-context
// interface; no DOM, no three.js). DYNAMIC content drawn in code (the map is per-run state: allowed by the texture rule); the sheet under
// it in the overlay is the existing approved paper texture (ui/paperMap.ts DEFAULT_PAPER_TEXTURE), never a new one.
//  - renderPlanningSvg(model): the full-screen overlay's sheet — military planning style: a lettered / numbered grid of squares (one block
//    with half its streets each) with its references in the margin, the area-of-operations core outline, block outlines, building
//    footprints by condition, the carriageways with their printed names, blocked spans (red cross-hatch), destinations framed with their
//    type symbol and real name, the checkpoint (friendly frame) and the way back, the local notes in grease pencil, derived reports in
//    graphite, unexplored ground hatched over, the live truck and "YOU" with their headings, a legend, scale bar and north arrow.
//  - drawPlanningCanvas(ctx, model, px): the same sheet, simplified, on the map table's top (a runtime canvas texture).
// World frame: x -> right, z -> down (north = -z, the top of the sheet).
//
// Task studio-surface-map-tent-cab-20261119-025201-01 (lane MAP): LEGIBILITY. User: "the diagonal lines and overlapping text make it hard
// to read" — "I like the vibe! a lot!" (their sheet: an Office host early in a run, nearly all of it unexplored). Same paper, ink, grease
// pencil, grid, frames and legend; what changed:
//  - unexplored ground (MAP_FOG) is a quiet wash with a sparse fine hatch (was a dark 45-degree line every 6 m over a grey tint) and a
//    light dashed pencil edge where it meets explored ground (fogEdges); buildings under it are filled lighter than explored ones. The
//    table-top canvas draws the same wash, hatch and edge; the legend swatch is the same pattern and edge;
//  - every symbol stays at its real place (the model is untouched); every TEXT is placed by the pure label placer (mapLabels.ts) in
//    priority order — YOU, TRUCK, the checkpoint callout, the way back, destinations (name, grid square and their building's reports),
//    notes, other reports, street names — clear of each other, of every symbol, the AO CORE tag and the title, inside the sheet, with a
//    thin leader when it stands off its symbol; long notes and names wrap to two lines; street names slide along their street;
//  - the checkpoint is its compound outline and tent at the real place plus a compact CALLOUT beside it (the friendly frame, CHECKPOINT
//    and the checkpoint's own notes) with a leader — the YOU / TRUCK arrows and the way back keep their real poses inside it;
//  - co-located note glyphs (two notes at the depot door, a blocked-street note on its blocked span) sit side by side at the spot;
//  - the label statistics ride on the <svg> as data-label-* attributes (QA: displaced / leaders / fallback / crossed / overlap /
//    street-skipped).

import type {MapMarker, PlanningMap} from './mapModel';
import type {SRect} from '../../gen/surface/surfaceTypes';
import {LINE, boxAt, overlaps, placeLabels, textWidth, wrapText, type FontSpec, type LBox, type LabelDir, type LabelReq, type LabelStats, type Obstacle, type PlacedLabel, type StreetRun} from './mapLabels';

const INK = '#2a2620', PENCIL = '#4a4740', RED = '#a8231c', BLUE = '#1f4e8c', GREEN = '#2f6b2f', PAPER = '#e8dfc6';
export const MAP_TONE_COLOUR: Readonly<Record<string, string>> = {hazard: RED, enemy: RED, supply: GREEN, route: BLUE, info: INK};

/**
 * Unexplored ground (task studio-surface-map-tent-cab-20261119-025201-01, lane MAP): a light wash, a sparse fine 45-degree hatch (spacing m,
 * line width m) and a dashed pencil edge against explored ground. (Before: a 6 m hatch of 1.1 m lines at 0.45 over a 0.26 grey tint —
 * the dominant texture of an early-run sheet.) `building` = the fill opacity of a building on unexplored ground (explored: 0.6).
 */
export const MAP_FOG = {
  wash: '#5b584d', washOpacity: 0.12,
  hatch: '#3f3d36', spacing: 16, line: 0.4, lineOpacity: 0.3,
  edge: '#4a4740', edgeWidth: 0.5, edgeOpacity: 0.6, edgeDash: '3 2',
  building: 0.3,
} as const;

/** The text styles of the sheet (sizes in metres of the sheet). */
export const MAP_FONT = {
  name: {size: 7, bold: true}, grid: {size: 5.2}, report: {size: 5.4}, note: {size: 6.6, cursive: true}, street: {size: 6, track: 0.4},
  you: {size: 6.6, bold: true}, truck: {size: 6.2, bold: true}, cp: {size: 6.8, bold: true}, portal: {size: 5.6}, core: {size: 7, bold: true},
  title: {size: 15, bold: true, track: 1.5}, sub: {size: 8},
} as const satisfies Record<string, FontSpec>;

/** Wrap limits (characters): a note / a destination name longer than this takes two lines. */
export const MAP_WRAP = {note: 26, name: 20} as const;

const CURSIVE_FAMILY = `'Segoe Print', 'Bradley Hand', 'Comic Sans MS', cursive`;

/** The sheet's frame around the district (m): margin left / top / bottom, the legend column on the right. */
export const SHEET = {margin: 30, title: 34, legend: 170} as const;

export function sheetBox(m: PlanningMap): {x: number; y: number; w: number; h: number} {
  const E = m.extent;
  return {x: E.x0 - SHEET.margin, y: E.z0 - SHEET.margin - SHEET.title, w: E.x1 - E.x0 + SHEET.margin * 2 + SHEET.legend, h: E.z1 - E.z0 + SHEET.margin * 2 + SHEET.title};
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const n = (v: number) => (Math.round(v * 10) / 10).toString();
// (' />', not '/>': a template piece that starts with '/' reads as a root-absolute URL to the release packager)
const rect = (r: SRect, attrs: string) => `<rect x="${n(r.x0)}" y="${n(r.z0)}" width="${n(r.x1 - r.x0)}" height="${n(r.z1 - r.z0)}" ${attrs} />`;

/** A destination's type glyph (inside its frame, centred on 0,0, about 10 m across). */
function glyph(kind: string): string {
  switch (kind) {
    case 'store': return `<path d="M-3.5 -1.5 h7 l-1 4 h-5 z M-2 -1.5 v-1.5 a2 2 0 0 1 4 0 v1.5" fill="none" stroke="${INK}" stroke-width="0.8"/>`;
    case 'centre': return `<path d="M-4 3 v-4 l2 -2 l2 2 l2 -2 l2 2 v4 z" fill="none" stroke="${INK}" stroke-width="0.8"/>`;
    case 'office': return `<path d="M-2 3.5 v-7 h4 v7 M-1 -2 h2 M-1 0 h2 M-1 2 h2" fill="none" stroke="${INK}" stroke-width="0.8"/>`;
    case 'depot': return `<path d="M-4.5 -1.5 h9 M-4.5 1.5 h9 M-3 -2.5 v5 M0 -2.5 v5 M3 -2.5 v5" fill="none" stroke="${INK}" stroke-width="0.8"/>`;
    case 'civic': return `<path d="M-4 3 h8 M-3 3 v-4 M0 3 v-4 M3 3 v-4 M-4.5 -1 l4.5 -3 l4.5 3 z" fill="none" stroke="${INK}" stroke-width="0.8"/>`;
    case 'industrial': return `<path d="M-4 3 v-3 l3 -2 v2 l3 -2 v2 l2 -1 v-2 h1 v6 z" fill="none" stroke="${INK}" stroke-width="0.8"/>`;
    case 'residential': return `<path d="M-3.5 3 v-3.5 l3.5 -3 l3.5 3 v3.5 z" fill="none" stroke="${INK}" stroke-width="0.8"/>`;
    case 'parking': return `<text x="0" y="2.6" font-size="7" text-anchor="middle" font-weight="700" fill="${INK}">P</text>`;
    default: return `<circle r="2.2" fill="none" stroke="${INK}" stroke-width="0.8"/>`;
  }
}

/** A note / report tone symbol (about 6 m), centred on 0,0. */
function toneGlyph(tone: string, c: string): string {
  switch (tone) {
    case 'hazard': return `<path d="M0 -3.4 L3.2 2.4 H-3.2 Z" fill="none" stroke="${c}" stroke-width="0.9"/><path d="M0 -1.2 v2" stroke="${c}" stroke-width="0.8"/>`;
    case 'enemy': return `<path d="M0 -3.4 L3.4 0 L0 3.4 L-3.4 0 Z" fill="none" stroke="${c}" stroke-width="0.9"/>`;
    case 'supply': return `<rect x="-2.8" y="-2.4" width="5.6" height="4.8" fill="none" stroke="${c}" stroke-width="0.9"/><path d="M-2.8 -0.6 h5.6" stroke="${c}" stroke-width="0.7"/>`;
    case 'route': return `<path d="M-3 1.6 L0 -2.6 L3 1.6" fill="none" stroke="${c}" stroke-width="0.9"/>`;
    default: return `<circle r="2.6" fill="none" stroke="${c}" stroke-width="0.9"/><circle r="0.6" fill="${c}"/>`;
  }
}

/** Heading of a marker in SVG degrees (0 = up / north = -z, clockwise). Camera yaw: forward = (-sin yaw, -cos yaw). */
export function headingDeg(yaw: number): number {
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
  return Math.atan2(fx, -fz) * 180 / Math.PI;
}

// --- the label layout (pure: the tests read it) --------------------------------------------------------------------------------

/** A line of label text as drawn: its text, style, colour and width (the placer's estimate; the SVG pins it with textLength). */
export interface MapTextLine { text: string; font: FontSpec; fill: string; w: number; prefix?: 'cp' | string }

export type MapLabelKind = 'player' | 'truck' | 'callout' | 'portal' | 'dest' | 'note' | 'report' | 'street';

export interface MapLabel {
  id: string;
  kind: MapLabelKind;
  /** The model markers whose text this label prints (a street name: none). */
  markers: string[];
  lines: MapTextLine[];
  align: 'start' | 'middle' | 'end';
  vertical: boolean;
  colour: string;
  placed: PlacedLabel;
}

/** A symbol drawn at its real place (its box is what no text may cover). `x, z` = where it is drawn; the marker's point is `at`. */
export interface MapIcon { id: string; kind: string; x: number; z: number; at: {x: number; z: number}; box: LBox }

export interface MapLabelLayout {
  icons: MapIcon[];
  /** The fixed text boxes the labels keep clear of (AO CORE, the title). */
  fixed: LBox[];
  labels: MapLabel[];
  /** Street labels skipped because the same name is printed nearby (never anything else). */
  skipped: string[];
  stats: LabelStats;
  /** Where each note's glyph is drawn (its point, or beside a symbol already standing there); callout notes have none. */
  glyphs: Map<string, {x: number; z: number}>;
  /** The checkpoint callout's member markers (CHECKPOINT and the notes / reports on the checkpoint). */
  callout: string[];
}

const LINE_H = (f: FontSpec) => f.size * LINE.lead;
const lineOf = (text: string, font: FontSpec, fill: string, prefix?: string): MapTextLine => ({text, font, fill, w: textWidth(text, font) + (prefix ? PREFIX_W[prefix === 'cp' ? 'cp' : 'tone'] : 0), prefix});
const PREFIX_W = {cp: 15.5, tone: 7.5} as const;
const blockSize = (lines: readonly MapTextLine[]) => ({w: Math.max(...lines.map(l => l.w)), h: lines.reduce((s, l) => s + LINE_H(l.font), 0)});

/** The drawn box of a rotated arrow marker (truck / player) at (x, z): its outline points rotated by the heading, padded. */
function arrowBox(kind: 'truck' | 'player', x: number, z: number, yaw: number): LBox {
  const a = headingDeg(yaw) * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  const pts: [number, number][] = kind === 'truck' ? [[-2.6, -4.4], [2.6, -4.4], [2.6, 4.4], [-2.6, 4.4], [0, -9], [2.4, -5.4], [-2.4, -5.4]] : [[0, -9], [3, -2], [-3, -2]];
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const [px, pz] of pts) { const rx = px * c - pz * s, rz = px * s + pz * c; x0 = Math.min(x0, rx); x1 = Math.max(x1, rx); z0 = Math.min(z0, rz); z1 = Math.max(z1, rz); }
  if (kind === 'player') { x0 = Math.min(x0, -4.8); x1 = Math.max(x1, 4.8); z0 = Math.min(z0, -4.8); z1 = Math.max(z1, 4.8); }
  return {x0: x + x0 - 0.6, z0: z + z0 - 0.6, x1: x + x1 + 0.6, z1: z + z1 + 0.6};
}

/** The box of a text drawn at (x, baseline y) with an anchor (the AO CORE tag / the title). */
function textBox(text: string, f: FontSpec, x: number, y: number, anchor: 'start' | 'end'): LBox {
  const w = textWidth(text, f);
  return {x0: anchor === 'start' ? x : x - w, z0: y - f.size * LINE.ascent, x1: anchor === 'start' ? x + w : x, z1: y + f.size * LINE.descent};
}

const TITLE = (m: PlanningMap) => `PLANNING MAP — ${m.name.toUpperCase()}`;

/**
 * The sheet's symbols and every label's place (the placer over the model; pure, deterministic). Labels: YOU, TRUCK, the checkpoint
 * callout, the way back, destinations (+ their building's reports), notes, the other reports (one block per point), street names.
 */
export function layoutPlanningLabels(m: PlanningMap): MapLabelLayout {
  const E = m.extent, bounds: LBox = {x0: E.x0 + 1, z0: E.z0 + 1, x1: E.x1 - 1, z1: E.z1 - 1};
  const icons: MapIcon[] = [];
  const icon = (mk: MapMarker, box: LBox, x = mk.x, z = mk.z) => { const ic = {id: mk.id, kind: mk.kind, x, z, at: {x: mk.x, z: mk.z}, box}; icons.push(ic); return ic; };
  const byId = new Map(m.markers.map(k => [k.id, k]));
  // fixed symbols at their real places
  for (const mk of m.markers) {
    if (mk.kind === 'destination' || mk.kind === 'depot') icon(mk, {x0: mk.x - 6.5, z0: mk.z - (mk.entered ? 8.9 : 5), x1: mk.x + (mk.entered ? 10.6 : 6.5), z1: mk.z + 5});
    else if (mk.kind === 'portal') icon(mk, boxAt(mk.x, mk.z, 9.4, 9.4));
    else if (mk.kind === 'blocked') icon(mk, boxAt(mk.x, mk.z, 11.2, 11.2));
    else if (mk.kind === 'truck' || mk.kind === 'player') icon(mk, arrowBox(mk.kind, mk.x, mk.z, mk.yaw ?? 0));
  }
  // the checkpoint callout's members: CHECKPOINT and the notes / reports standing on the checkpoint
  const C = m.checkpoint.rect, onCp = (mk: MapMarker) => (mk.kind === 'note' || mk.kind === 'report') && (mk.ref.type === 'checkpoint' || (mk.x >= C.x0 && mk.x <= C.x1 && mk.z >= C.z0 && mk.z <= C.z1));
  const cp = m.markers.find(k => k.kind === 'checkpoint');
  const callout = cp ? [cp.id, ...m.markers.filter(onCp).map(k => k.id)] : [];
  // note glyphs: at their point; one that would sit on a symbol already there (a blocked span's own note, two notes at one door) goes
  // beside it — the nearest free place in 4.5 m steps
  const glyphs = new Map<string, {x: number; z: number}>();
  const steps: [number, number][] = [[1, 0], [-1, 0], [0, -1], [0, 1], [1, -1], [1, 1], [-1, -1], [-1, 1]];
  const fixedIcons = icons.filter(ic => ic.kind !== 'truck' && ic.kind !== 'player'); // (the live arrows move: notes do not dodge them)
  for (const mk of m.markers) {
    if (mk.kind !== 'note' || (cp && onCp(mk))) continue;
    let at = {x: mk.x, z: mk.z};
    const clear = (x: number, z: number) => { const b = boxAt(x, z, 7.6, 7.6); return b.x0 >= bounds.x0 && b.x1 <= bounds.x1 && b.z0 >= bounds.z0 && b.z1 <= bounds.z1 && !fixedIcons.some(ic => overlaps(b, ic.box, 0.3)); };
    if (!clear(at.x, at.z)) {
      search: for (let k = 1; k <= 8; k++) for (const [dx, dz] of steps) if (clear(mk.x + dx * 4.5 * k, mk.z + dz * 4.5 * k)) { at = {x: mk.x + dx * 4.5 * k, z: mk.z + dz * 4.5 * k}; break search; }
    }
    glyphs.set(mk.id, at);
    fixedIcons.push(icon(mk, boxAt(at.x, at.z, 7.6, 7.6), at.x, at.z));
  }
  // fixed text + the checkpoint compound (only YOU / TRUCK / the way back may print over it)
  // (AO CORE keeps a word space clear on its right: a street name butted against it would read as one phrase)
  const ao = textBox('AO CORE', MAP_FONT.core, m.core.x0 + 3, m.core.z0 - 3, 'start');
  const fixed = [{...ao, x1: ao.x1 + 4}, textBox(TITLE(m), MAP_FONT.title, E.x0, E.z0 - SHEET.margin - 10, 'start')];
  const obstacles: Obstacle[] = [...icons.map(ic => ({box: ic.box, tag: 'icon'})), ...fixed.map(box => ({box, tag: 'text'})), {box: m.checkpoint.rect, tag: 'checkpoint'}];

  const reqs: {req: LabelReq; label: Omit<MapLabel, 'placed'>}[] = [];
  const iconOf = (id: string) => icons.find(ic => ic.id === id);
  const add = (id: string, kind: MapLabelKind, markers: string[], lines: MapTextLine[], anchor: LBox, ax: number, az: number, dirs: readonly LabelDir[], colour: string, extra: Partial<LabelReq> = {}) => {
    const {w, h} = blockSize(lines);
    reqs.push({req: {id, ax, az, anchor, w, h, dirs, ...extra}, label: {id, kind, markers, lines, align: 'middle', vertical: false, colour}});
  };
  const AROUND_E: LabelDir[] = ['E', 'W', 'NE', 'SE', 'NW', 'SW', 'N', 'S'], AROUND_S: LabelDir[] = ['S', 'N', 'E', 'W', 'SE', 'SW', 'NE', 'NW'];
  const inCp = ['checkpoint'];
  // YOU, TRUCK
  for (const kind of ['player', 'truck'] as const) {
    const mk = m.markers.find(k => k.kind === kind), ic = mk && iconOf(mk.id);
    if (mk && ic) add(mk.id, kind, [mk.id], [lineOf(mk.label.toUpperCase(), kind === 'player' ? MAP_FONT.you : MAP_FONT.truck, kind === 'player' ? RED : BLUE)], ic.box, mk.x, mk.z, AROUND_E, kind === 'player' ? RED : BLUE, {ignore: inCp});
  }
  // the checkpoint callout: the friendly frame + CHECKPOINT, then its notes (tone glyph + grease pencil) and reports
  if (cp) {
    const lines = [lineOf('CHECKPOINT', MAP_FONT.cp, BLUE, 'cp')];
    for (const id of callout.slice(1)) {
      const mk = byId.get(id)!, c = MAP_TONE_COLOUR[mk.tone ?? 'info'] ?? RED;
      if (mk.kind === 'note') wrapText(mk.label, MAP_WRAP.note).forEach((t, i) => lines.push(lineOf(t, MAP_FONT.note, c, i === 0 ? mk.symbol : undefined)));
      else lines.push(lineOf(mk.label, MAP_FONT.report, c === INK ? PENCIL : c));
    }
    add(cp.id, 'callout', callout, lines, C, (C.x0 + C.x1) / 2, (C.z0 + C.z1) / 2, ['S', 'W', 'N', 'E', 'SW', 'NW', 'SE', 'NE'], BLUE);
  }
  // the way back
  const portal = m.markers.find(k => k.kind === 'portal'), pic = portal && iconOf(portal.id);
  if (portal && pic && portal.label) add(portal.id, 'portal', [portal.id], [lineOf(portal.label, MAP_FONT.portal, BLUE)], pic.box, portal.x, portal.z, ['N', 'S', 'E', 'W', 'NE', 'NW', 'SE', 'SW'], BLUE, {ignore: inCp});
  // destinations: name (two lines when long), grid square, then the reports on that building
  const destOf = new Map<number, MapMarker>();
  for (const mk of m.markers) if ((mk.kind === 'destination' || mk.kind === 'depot') && mk.ref.type === 'building') destOf.set(mk.ref.id, mk);
  const joined = new Map<string, MapMarker[]>();
  for (const mk of m.markers) {
    if (mk.kind !== 'report' || callout.includes(mk.id) || mk.ref.type !== 'building' || !destOf.has(mk.ref.id)) continue;
    const d = destOf.get(mk.ref.id)!;
    joined.set(d.id, [...(joined.get(d.id) ?? []), mk]);
  }
  for (const mk of m.markers) {
    if (mk.kind !== 'destination' && mk.kind !== 'depot') continue;
    const ic = iconOf(mk.id)!, reps = joined.get(mk.id) ?? [];
    const lines = [...wrapText(mk.label, MAP_WRAP.name).map(t => lineOf(t, MAP_FONT.name, INK)), lineOf(mk.grid, MAP_FONT.grid, PENCIL)];
    for (const r of reps) { const c = MAP_TONE_COLOUR[r.tone ?? 'info'] ?? PENCIL; lines.push(lineOf(r.label, MAP_FONT.report, c === INK ? PENCIL : c)); }
    add(mk.id, 'dest', [mk.id, ...reps.map(r => r.id)], lines, ic.box, mk.x, mk.z, AROUND_S, INK);
  }
  // notes (beside their glyph)
  for (const mk of m.markers) {
    const at = glyphs.get(mk.id);
    if (mk.kind !== 'note' || !at) continue;
    const c = MAP_TONE_COLOUR[mk.tone ?? 'info'] ?? RED;
    add(mk.id, 'note', [mk.id], wrapText(mk.label, MAP_WRAP.note).map(t => lineOf(t, MAP_FONT.note, c)), boxAt(at.x, at.z, 7.6, 7.6), at.x, at.z, ['E', 'W', 'SE', 'NE', 'S', 'N', 'SW', 'NW'], c);
  }
  // the other reports: one block per point
  const repAt = new Map<string, MapMarker[]>();
  for (const mk of m.markers) {
    if (mk.kind !== 'report' || callout.includes(mk.id) || [...joined.values()].some(l => l.includes(mk))) continue;
    const key = `${Math.round(mk.x)},${Math.round(mk.z)}`;
    repAt.set(key, [...(repAt.get(key) ?? []), mk]);
  }
  for (const list of repAt.values()) {
    const p = list[0], c = (r: MapMarker) => { const t = MAP_TONE_COLOUR[r.tone ?? 'info'] ?? PENCIL; return t === INK ? PENCIL : t; };
    const pt = boxAt(p.x, p.z, 1.6, 1.6);
    obstacles.push({box: pt, tag: 'point'}); // (no other text covers the point a report's leader would end on)
    add(p.id, 'report', list.map(r => r.id), list.map(r => lineOf(r.label, MAP_FONT.report, c(r))), pt, p.x, p.z, AROUND_S, PENCIL);
  }
  // street names: along their own carriageway, then the same street's other segments nearby
  const soft: LBox[] = [];
  const runOf = (s: PlanningMap['streets'][number], w: number): StreetRun => {
    const vertical = Math.abs(s.bz - s.az) > Math.abs(s.bx - s.ax), a = vertical ? Math.min(s.az, s.bz) : Math.min(s.ax, s.bx), b = vertical ? Math.max(s.az, s.bz) : Math.max(s.ax, s.bx);
    // a name that fits stays clear of the cross streets at the segment's ends; a longer one keeps most of itself on the segment
    const keep = w + 14 <= b - a ? w / 2 + 7 : 2 - w / 4, mid = (a + b) / 2;
    return {x: vertical ? (s.ax + s.bx) / 2 : mid, z: vertical ? mid : (s.az + s.bz) / 2, vertical, lo: a + keep, hi: b - keep};
  };
  for (const s of m.streets) {
    if (!s.label || !s.name) continue;
    const text = s.name.toUpperCase(), f = MAP_FONT.street, w = textWidth(text, f), h = f.size * (LINE.ascent + LINE.descent);
    const run = runOf(s, w), own: StreetRun = run.vertical ? {...run, z: s.label.z} : {...run, x: s.label.x}; // (slides from the model's point)
    const others = m.streets.filter(q => q !== s && q.name === s.name && Math.abs(q.bz - q.az) > Math.abs(q.bx - q.ax) === own.vertical)
      .map(q => runOf(q, w)).filter(r => r.hi >= r.lo && Math.hypot(r.x - own.x, r.z - own.z) < 160)
      .sort((a, b) => Math.hypot(a.x - own.x, a.z - own.z) - Math.hypot(b.x - own.x, b.z - own.z));
    soft.push(own.vertical ? boxAt(own.x, own.z, h, w) : boxAt(own.x, own.z, w, h));
    const id = `s${s.id}`;
    reqs.push({req: {id, ax: own.x, az: own.z, anchor: boxAt(own.x, own.z, 0.5, 0.5), w, h, dirs: [], street: {name: s.name, runs: [own, ...others]}},
      label: {id, kind: 'street', markers: [], lines: [{text, font: f, fill: '#4f4838', w}], align: 'middle', vertical: own.vertical, colour: '#776d58'}});
  }
  const res = placeLabels(reqs.map(r => r.req), obstacles, bounds, soft);
  const placedById = new Map(res.placed.map(p => [p.id, p]));
  const labels: MapLabel[] = [];
  for (const {label} of reqs) {
    const p = placedById.get(label.id);
    if (!p) continue;
    const dir = p.dir;
    const align = label.kind === 'callout' ? 'start' : dir === 'E' || dir === 'NE' || dir === 'SE' ? 'start' : dir === 'W' || dir === 'NW' || dir === 'SW' ? 'end' : 'middle';
    labels.push({...label, align: label.kind === 'street' ? 'middle' : align, placed: p});
  }
  return {icons, fixed, labels, skipped: res.skipped, stats: res.stats, glyphs, callout};
}

// --- the SVG sheet -------------------------------------------------------------------------------------------------------------

/** The fog grid's edges between unexplored and explored cells (merged segments x0, z0, x1, z1; none along the grid's own border). */
export function fogEdges(F: PlanningMap['fog']): [number, number, number, number][] {
  const fog = new Uint8Array(F.w * F.h);
  for (const [r, c0, c1] of F.runs) fog.fill(1, r * F.w + c0, r * F.w + c1 + 1);
  const out: [number, number, number, number][] = [];
  for (let r = 1; r < F.h; r++) { // horizontal edges (between rows r-1 and r)
    let c0 = -1;
    for (let c = 0; c <= F.w; c++) {
      const e = c < F.w && fog[(r - 1) * F.w + c] !== fog[r * F.w + c];
      if (e && c0 < 0) c0 = c;
      if (!e && c0 >= 0) { out.push([F.x0 + c0 * F.cell, F.z0 + r * F.cell, F.x0 + c * F.cell, F.z0 + r * F.cell]); c0 = -1; }
    }
  }
  for (let c = 1; c < F.w; c++) { // vertical edges (between columns c-1 and c)
    let r0 = -1;
    for (let r = 0; r <= F.h; r++) {
      const e = r < F.h && fog[r * F.w + c - 1] !== fog[r * F.w + c];
      if (e && r0 < 0) r0 = r;
      if (!e && r0 >= 0) { out.push([F.x0 + c * F.cell, F.z0 + r0 * F.cell, F.x0 + c * F.cell, F.z0 + r * F.cell]); r0 = -1; }
    }
  }
  return out;
}

/** The fog pattern (the sheet's and the legend's). */
function fogPattern(): string {
  const S = MAP_FOG.spacing;
  return `<pattern id="spm-fog" width="${S}" height="${S}" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="${S}" height="${S}" fill="${MAP_FOG.wash}" fill-opacity="${MAP_FOG.washOpacity}"/>`
    + `<path d="M${S / 2} 0 V${S}" stroke="${MAP_FOG.hatch}" stroke-width="${MAP_FOG.line}" stroke-opacity="${MAP_FOG.lineOpacity}"/></pattern>`;
}

/** The paper-white halo under placed text (knocks the hatch, grid and block lines out from behind the letters; ~invisible in multiply). */
const HALO = `stroke="#fbf8ef" stroke-width="1" stroke-opacity="0.9" stroke-linejoin="round" paint-order="stroke"`;

/** One label's text (a <g> of <text> lines; prefixes and leaders are drawn by the caller). */
function labelSvg(L: MapLabel): string {
  const b = L.placed.box, out: string[] = [];
  const font = (f: FontSpec) => `font-size="${f.size}"${f.bold ? ' font-weight="700"' : ''}${f.cursive ? ` font-style="italic" font-family="${CURSIVE_FAMILY}"` : ''}${f.track ? ` letter-spacing="${f.track}"` : ''}`;
  out.push(`<g class="spm-label spm-label-${L.kind}" data-label="${esc(L.id)}" data-markers="${esc(L.markers.join(' '))}">`);
  if (L.kind === 'street') {
    const l = L.lines[0], cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2, y = cz + l.font.size * (LINE.ascent - LINE.descent) / 2;
    out.push(`<text x="${n(cx)}" y="${n(y)}" text-anchor="middle" ${font(l.font)} fill="${l.fill}" textLength="${n(l.w)}" lengthAdjust="spacingAndGlyphs"${L.vertical ? ` transform="rotate(-90 ${n(cx)} ${n(cz)})"` : ''}>${esc(l.text)}</text>`);
  } else {
    let top = b.z0;
    for (const l of L.lines) {
      const pre = l.prefix ? PREFIX_W[l.prefix === 'cp' ? 'cp' : 'tone'] : 0, tw = l.w - pre, y = top + l.font.size * LINE.ascent;
      const [x, anchor] = L.align === 'start' ? [b.x0 + pre, 'start'] : L.align === 'end' ? [b.x1, 'end'] : [(b.x0 + b.x1) / 2 + pre / 2, 'middle'];
      out.push(`<text x="${n(x)}" y="${n(y)}" text-anchor="${anchor}" ${font(l.font)} fill="${l.fill}" textLength="${n(tw)}" lengthAdjust="spacingAndGlyphs">${esc(l.text)}</text>`);
      top += LINE_H(l.font);
    }
  }
  out.push('</g>');
  return out.join('');
}

/** A callout line's prefix symbol (the friendly frame / a note's tone glyph), left of its text. */
function prefixSvg(L: MapLabel): string {
  const out: string[] = [];
  let top = L.placed.box.z0;
  for (const l of L.lines) {
    const cz = top + LINE_H(l.font) / 2 - l.font.size * 0.08, x0 = L.placed.box.x0;
    if (l.prefix === 'cp') out.push(`<g transform="translate(${n(x0 + 6.5)} ${n(cz)})"><rect x="-6.5" y="-4" width="13" height="8" fill="${PAPER}" fill-opacity="0.85" stroke="${BLUE}" stroke-width="1.1"/><path d="M-6.5 -4 L6.5 4 M6.5 -4 L-6.5 4" stroke="${BLUE}" stroke-width="0.7"/></g>`);
    else if (l.prefix) out.push(`<g transform="translate(${n(x0 + 3.2)} ${n(cz)})">${toneGlyph(l.prefix, l.fill)}</g>`);
    top += LINE_H(l.font);
  }
  return out.join('');
}

/** The full overlay sheet (an <svg> string; its viewBox is the sheet box in world metres). */
export function renderPlanningSvg(m: PlanningMap): string {
  const B = sheetBox(m), E = m.extent, out: string[] = [];
  const Lay = layoutPlanningLabels(m), S = Lay.stats;
  // (no xmlns: the sheet is parsed as inline HTML, where <svg> is in the SVG namespace already — and the release packager rejects URL
  // literals in the bundle)
  out.push(`<svg class="spm-svg" viewBox="${n(B.x)} ${n(B.y)} ${n(B.w)} ${n(B.h)}" width="${n(B.w)}" height="${n(B.h)}" font-family="'Arial Narrow', 'Roboto Condensed', Arial, sans-serif"`
    + ` data-labels="${S.labels}" data-label-displaced="${S.displaced}" data-label-leaders="${S.leaders}" data-label-fallback="${S.fallback}" data-label-crossed="${S.crossed}" data-label-overlap="${S.overlap}" data-street-skipped="${S.streetSkipped}">`);
  out.push(`<defs>${fogPattern()}`
    + `<pattern id="spm-block" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)"><path d="M0 0 V5" stroke="${RED}" stroke-width="1.2"/></pattern>`
    + `<pattern id="spm-gutted" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><path d="M0 0 V4" stroke="${PENCIL}" stroke-width="0.6" stroke-opacity="0.7"/></pattern></defs>`);
  // grid squares + references in the margin
  const G = m.grid;
  out.push(`<g class="spm-grid" stroke="${BLUE}" stroke-width="0.7" stroke-opacity="0.75">`);
  for (const x of G.xs) out.push(`<line x1="${n(x)}" y1="${n(E.z0)}" x2="${n(x)}" y2="${n(E.z1)}"/>`);
  for (const z of G.zs) out.push(`<line x1="${n(E.x0)}" y1="${n(z)}" x2="${n(E.x1)}" y2="${n(z)}"/>`);
  out.push('</g><g class="spm-gridref" fill="' + BLUE + '" font-size="9" text-anchor="middle" font-weight="700">');
  G.cols.forEach((c, i) => { const x = (G.xs[i] + G.xs[i + 1]) / 2; out.push(`<text x="${n(x)}" y="${n(E.z0 - 8)}">${c}</text><text x="${n(x)}" y="${n(E.z1 + 18)}">${c}</text>`); });
  G.rows.forEach((r, i) => { const z = (G.zs[i] + G.zs[i + 1]) / 2 + 3; out.push(`<text x="${n(E.x0 - 14)}" y="${n(z)}">${r}</text><text x="${n(E.x1 + 14)}" y="${n(z)}">${r}</text>`); });
  out.push('</g>');
  // streets (carriageways), blocks, buildings (lighter on unexplored ground)
  out.push(`<g class="spm-streets">`);
  for (const s of m.streets) {
    const h = s.width / 2, r = {x0: Math.min(s.ax, s.bx) - h, z0: Math.min(s.az, s.bz) - h, x1: Math.max(s.ax, s.bx) + h, z1: Math.max(s.az, s.bz) + h};
    out.push(rect(r, `fill="#f3ecd9" fill-opacity="0.55" stroke="#776d58" stroke-width="0.5"`));
    if (s.rank === 'avenue') out.push(`<line x1="${n(s.ax)}" y1="${n(s.az)}" x2="${n(s.bx)}" y2="${n(s.bz)}" stroke="#776d58" stroke-width="0.6" stroke-dasharray="4 3"/>`);
  }
  out.push('</g><g class="spm-blocks">');
  for (const b of m.blocks) out.push(rect(b.rect, `fill="none" stroke="#6d6450" stroke-width="${b.core ? 0.9 : 0.5}"`));
  for (const b of m.buildings) {
    const fill = b.condition === 'collapsed' ? 'none' : b.condition === 'gutted' ? 'url(#spm-gutted)' : '#bdb091';
    const op = (b.condition === 'damaged' ? 0.45 : 0.6) * (b.explored || b.entered ? 1 : MAP_FOG.building / 0.6);
    out.push(rect(b.rect, `class="spm-bldg" data-building="${b.id}" fill="${fill}" fill-opacity="${n2(op)}" stroke="${b.destination ? INK : '#7b725d'}" stroke-width="${b.destination ? 1.1 : 0.5}"${b.condition === 'collapsed' ? ' stroke-dasharray="2 2"' : ''}`));
  }
  out.push('</g>');
  // core (area of operations) outline
  out.push(rect(m.core, `fill="none" stroke="${BLUE}" stroke-width="1.6" stroke-dasharray="9 5"`));
  out.push(`<text x="${n(m.core.x0 + 3)}" y="${n(m.core.z0 - 3)}" font-size="${MAP_FONT.core.size}" fill="${BLUE}" font-weight="700" ${HALO}>AO CORE</text>`);
  // the checkpoint compound + tent at the real place (its frame, name and notes are the callout beside it)
  const cp = m.markers.find(k => k.kind === 'checkpoint');
  out.push(`<g class="spm-cp"${cp ? ` data-marker="${cp.id}" data-at="${n(cp.x)},${n(cp.z)}"` : ''}>${rect(m.checkpoint.rect, `fill="none" stroke="${BLUE}" stroke-width="1.2"`)}${rect(m.checkpoint.tent, `fill="${BLUE}" fill-opacity="0.18" stroke="${BLUE}" stroke-width="0.8"`)}</g>`);
  // fog (unexplored ground): the wash + sparse hatch, and its edge against explored ground
  const F = m.fog;
  out.push(`<g class="spm-fog" fill="url(#spm-fog)" shape-rendering="crispEdges">`);
  for (const [r, c0, c1] of F.runs) out.push(`<rect x="${n(F.x0 + c0 * F.cell)}" y="${n(F.z0 + r * F.cell)}" width="${n((c1 - c0 + 1) * F.cell)}" height="${n(F.cell)}"/>`);
  out.push('</g>');
  const edges = fogEdges(F).map(([x0, z0, x1, z1]) => {
    const c = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
    return `M${n(c(x0, E.x0, E.x1))} ${n(c(z0, E.z0, E.z1))}L${n(c(x1, E.x0, E.x1))} ${n(c(z1, E.z0, E.z1))}`;
  });
  if (edges.length) out.push(`<path class="spm-fog-edge" d="${edges.join('')}" fill="none" stroke="${MAP_FOG.edge}" stroke-width="${MAP_FOG.edgeWidth}" stroke-opacity="${MAP_FOG.edgeOpacity}" stroke-dasharray="${MAP_FOG.edgeDash}"/>`);
  // street names (over the fog: the city plan is printed), placed
  out.push(`<g class="spm-street-names" ${HALO}>`);
  for (const L of Lay.labels) if (L.kind === 'street') out.push(labelSvg(L));
  out.push('</g>');
  // leaders (under the symbols and text): a thin line from the text to its symbol; a point label (no symbol) gets a dot at its point
  out.push('<g class="spm-leaders" fill="none" stroke-width="0.45" stroke-opacity="0.85">');
  for (const L of Lay.labels) {
    const l = L.placed.leader;
    if (!l) continue;
    out.push(`<path d="M${n(l[0])} ${n(l[1])}L${n(l[2])} ${n(l[3])}" stroke="${L.colour}"/>`);
    if (L.kind === 'report' || L.kind === 'street') out.push(`<circle cx="${n(l[2])}" cy="${n(l[3])}" r="0.9" fill="${L.colour}" stroke="none"/>`);
  }
  out.push('</g>');
  // symbols at their real places (the live arrows last, on top)
  out.push('<g class="spm-markers">');
  for (const ic of Lay.icons) if (ic.kind !== 'truck' && ic.kind !== 'player') out.push(iconSvg(m.markers.find(k => k.id === ic.id)!, ic));
  for (const ic of Lay.icons) if (ic.kind === 'truck' || ic.kind === 'player') out.push(iconSvg(m.markers.find(k => k.id === ic.id)!, ic));
  out.push('</g>');
  // the placed text (callout prefixes first)
  out.push(`<g class="spm-labels" ${HALO}>`);
  for (const L of Lay.labels) if (L.kind !== 'street') { if (L.kind === 'callout') out.push(`<g class="spm-callout-icons" stroke="none">${prefixSvg(L)}</g>`); out.push(labelSvg(L)); }
  out.push('</g>');
  // title band, legend, scale, north
  // (the subline ends at the sheet's right edge, over the key, clear of a long district name; both pinned to their estimated width)
  const sub = `CHECKPOINT COPY · GRID SQUARES = 1 BLOCK · EXPLORED ${Math.round(m.explored * 100)} %`;
  out.push(`<text x="${n(E.x0)}" y="${n(E.z0 - SHEET.margin - 10)}" font-size="${MAP_FONT.title.size}" font-weight="700" fill="${INK}" letter-spacing="${MAP_FONT.title.track}" textLength="${n(textWidth(TITLE(m), MAP_FONT.title))}" lengthAdjust="spacingAndGlyphs">${esc(TITLE(m))}</text>`);
  out.push(`<text x="${n(B.x + B.w - SHEET.margin / 2)}" y="${n(E.z0 - SHEET.margin - 10)}" font-size="${MAP_FONT.sub.size}" fill="${PENCIL}" text-anchor="end" textLength="${n(textWidth(sub, MAP_FONT.sub))}" lengthAdjust="spacingAndGlyphs">${sub}</text>`);
  out.push(legendSvg(E.x1 + SHEET.margin + 6, E.z0, m));
  out.push('</svg>');
  return out.join('');
}

const n2 = (v: number) => (Math.round(v * 100) / 100).toString();

/** A marker's symbol (no text: the labels are placed separately). `data-at` = the marker's real point (the model's). */
function iconSvg(mk: MapMarker, ic: MapIcon): string {
  const t = `translate(${n(ic.x)} ${n(ic.z)})`, at = `data-marker="${esc(mk.id)}" data-at="${n(mk.x)},${n(mk.z)}"`;
  switch (mk.kind) {
    case 'destination': case 'depot': {
      const entered = mk.entered ? `<path d="M5.6 -6.6 l1.4 1.6 l3 -3.4" fill="none" stroke="${GREEN}" stroke-width="1.1"/>` : '';
      return `<g class="spm-dest" ${at} data-ref="building:${mk.ref.type === 'building' ? mk.ref.id : ''}" transform="${t}"><rect x="-6" y="-4.5" width="12" height="9" fill="${PAPER}" fill-opacity="0.85" stroke="${INK}" stroke-width="0.9"/>${glyph(mk.symbol)}${entered}</g>`;
    }
    case 'portal':
      return `<g class="spm-portal" ${at} transform="${t}"><circle r="4" fill="${PAPER}" stroke="${BLUE}" stroke-width="1"/><path d="M0 -2.4 v4.4 M-2 0.4 l2 2 l2 -2" fill="none" stroke="${BLUE}" stroke-width="0.9"/></g>`;
    case 'blocked':
      return `<g class="spm-blocked" ${at} transform="${t}"><rect x="-5" y="-5" width="10" height="10" fill="url(#spm-block)" stroke="${RED}" stroke-width="0.9"/><path d="M-5 -5 L5 5 M5 -5 L-5 5" stroke="${RED}" stroke-width="1.3"/></g>`;
    case 'note': {
      const c = MAP_TONE_COLOUR[mk.tone ?? 'info'] ?? RED, d = Math.hypot(ic.x - mk.x, ic.z - mk.z);
      // (a glyph set further than one step beside its point keeps a pencil tick back to it)
      const tick = d > 12 ? `<path d="M0 0 L${n(mk.x - ic.x)} ${n(mk.z - ic.z)}" stroke="${c}" stroke-width="0.4" stroke-opacity="0.7"/>` : '';
      return `<g class="spm-note" ${at} transform="${t}">${tick}${toneGlyph(mk.symbol, c)}</g>`;
    }
    case 'truck': {
      const deg = headingDeg(mk.yaw ?? 0);
      return `<g class="spm-truck" ${at} transform="${t}"><g transform="rotate(${n(deg)})"><rect x="-2.6" y="-4.4" width="5.2" height="8.8" rx="1" fill="${BLUE}" fill-opacity="0.85"/><path d="M0 -9 L2.4 -5.4 H-2.4 Z" fill="${BLUE}"/></g></g>`;
    }
    case 'player': {
      const deg = headingDeg(mk.yaw ?? 0);
      return `<g class="spm-player" ${at} transform="${t}"><circle r="4.2" fill="none" stroke="${RED}" stroke-width="1.1"/><g transform="rotate(${n(deg)})"><path d="M0 -9 L3 -2 L0 -3.6 L-3 -2 Z" fill="${RED}"/></g></g>`;
    }
    default: return '';
  }
}

function legendSvg(x: number, y: number, m: PlanningMap): string {
  const rows: [string, string][] = [
    ['store', 'Store'], ['centre', 'Shopping centre'], ['office', 'Offices'], ['depot', 'Rail depot'], ['civic', 'Civic'], ['industrial', 'Industrial'],
  ];
  const out: string[] = [`<g class="spm-legend" transform="translate(${n(x)} ${n(y)})"><text x="0" y="0" font-size="8" font-weight="700" fill="${INK}">KEY</text>`];
  let yy = 12;
  for (const [k, label] of rows) {
    out.push(`<g transform="translate(7 ${yy})"><rect x="-6" y="-4.5" width="12" height="9" fill="none" stroke="${INK}" stroke-width="0.8"/>${glyph(k)}</g><text x="18" y="${yy + 2.5}" font-size="6" fill="${INK}">${label}</text>`);
    yy += 13;
  }
  const tones: [string, string][] = [['hazard', 'Hazard'], ['enemy', 'Hostiles'], ['supply', 'Supplies'], ['route', 'Route / blocked'], ['info', 'Info']];
  for (const [k, label] of tones) { out.push(`<g transform="translate(7 ${yy})">${toneGlyph(k, MAP_TONE_COLOUR[k])}</g><text x="18" y="${yy + 2.5}" font-size="6" fill="${INK}">${label}</text>`); yy += 11; }
  // (the sheet's own fog: the same pattern, its edge drawn round the swatch)
  out.push(`<g class="spm-legend-fog" transform="translate(7 ${yy})"><rect x="-6" y="-4" width="12" height="8" fill="url(#spm-fog)" stroke="${MAP_FOG.edge}" stroke-width="${MAP_FOG.edgeWidth}" stroke-opacity="${MAP_FOG.edgeOpacity}" stroke-dasharray="${MAP_FOG.edgeDash}"/></g><text x="18" y="${yy + 2.5}" font-size="6" fill="${INK}">Not yet explored</text>`);
  yy += 13;
  out.push(`<g transform="translate(7 ${yy})"><rect x="-6" y="-4" width="12" height="8" fill="url(#spm-block)" stroke="${RED}" stroke-width="0.8"/></g><text x="18" y="${yy + 2.5}" font-size="6" fill="${INK}">Blocked span</text>`);
  yy += 22;
  // scale bar (100 m) + north arrow
  out.push(`<g transform="translate(0 ${yy})"><path d="M0 0 h100 M0 -3 v6 M50 -2 v4 M100 -3 v6" stroke="${INK}" stroke-width="0.9"/><text x="0" y="11" font-size="6" fill="${INK}">0</text><text x="100" y="11" font-size="6" fill="${INK}" text-anchor="end">100 m</text></g>`);
  yy += 34;
  out.push(`<g transform="translate(20 ${yy})"><path d="M0 -14 L5 4 L0 0 L-5 4 Z" fill="${INK}"/><text x="0" y="14" font-size="8" text-anchor="middle" font-weight="700" fill="${INK}">N</text></g>`);
  out.push(`<text x="0" y="${yy + 34}" font-size="5.4" fill="${PENCIL}">${esc(m.name)} · local area only</text></g>`);
  return out.join('');
}

// --- the table-top canvas ------------------------------------------------------------------------------------------------------

/** The 2D context calls the table-top drawing uses (CanvasRenderingContext2D satisfies it; tests use a recording fake). */
export interface MapCtx {
  fillStyle: string | unknown; strokeStyle: string | unknown; lineWidth: number; font: string; textAlign: string; globalAlpha: number;
  save(): void; restore(): void; setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  fillRect(x: number, y: number, w: number, h: number): void; strokeRect(x: number, y: number, w: number, h: number): void;
  beginPath(): void; moveTo(x: number, y: number): void; lineTo(x: number, y: number): void; closePath(): void; fill(): void; stroke(): void;
  arc(x: number, y: number, r: number, a0: number, a1: number): void;
  /** (maxWidth: the label placer's width for the line — the canvas squeezes a wider font into it) */
  fillText(s: string, x: number, y: number, maxWidth?: number): void;
}

/**
 * The same planning map, simplified, on a `px` x `px` canvas (the map table's top). The district's extent is fitted into the square with
 * a small margin; text is limited to the destination names, the grid references and the YOU / TRUCK tags (legible from the table).
 */
export function drawPlanningCanvas(ctx: MapCtx, m: PlanningMap, px: number): {scale: number} {
  const E = m.extent, pad = px * 0.05, s = (px - pad * 2) / Math.max(E.x1 - E.x0, E.z1 - E.z0);
  const X = (x: number) => pad + (x - E.x0) * s, Y = (z: number) => pad + (z - E.z0) * s;
  const R = (r: SRect, mode: 'fill' | 'stroke') => (mode === 'fill' ? ctx.fillRect(X(r.x0), Y(r.z0), (r.x1 - r.x0) * s, (r.z1 - r.z0) * s) : ctx.strokeRect(X(r.x0), Y(r.z0), (r.x1 - r.x0) * s, (r.z1 - r.z0) * s));
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, px, px);
  // streets, blocks, buildings
  ctx.fillStyle = '#f4eedc';
  for (const st of m.streets) { const h = st.width / 2; R({x0: Math.min(st.ax, st.bx) - h, z0: Math.min(st.az, st.bz) - h, x1: Math.max(st.ax, st.bx) + h, z1: Math.max(st.az, st.bz) + h}, 'fill'); }
  ctx.strokeStyle = '#6d6450';
  ctx.lineWidth = Math.max(1, px / 900);
  for (const b of m.blocks) R(b.rect, 'stroke');
  for (const b of m.buildings) {
    ctx.fillStyle = b.condition === 'collapsed' ? '#d7ccb0' : b.condition === 'gutted' ? '#c9bda0' : '#b9ab8a';
    R(b.rect, 'fill');
    if (b.destination) { ctx.strokeStyle = INK; R(b.rect, 'stroke'); ctx.strokeStyle = '#6d6450'; }
  }
  // grid
  ctx.strokeStyle = BLUE;
  ctx.globalAlpha = 0.6;
  for (const x of m.grid.xs) { ctx.beginPath(); ctx.moveTo(X(x), Y(E.z0)); ctx.lineTo(X(x), Y(E.z1)); ctx.stroke(); }
  for (const z of m.grid.zs) { ctx.beginPath(); ctx.moveTo(X(E.x0), Y(z)); ctx.lineTo(X(E.x1), Y(z)); ctx.stroke(); }
  // fog: the overlay's wash, sparse hatch (the same 45-degree lines: x + z = sqrt2 (S/2 + kS)) and dashed edge against explored ground
  const F = m.fog, FG = MAP_FOG, step = FG.spacing * Math.SQRT2, off = step / 2;
  ctx.globalAlpha = FG.washOpacity;
  ctx.fillStyle = FG.wash;
  for (const [r, c0, c1] of F.runs) ctx.fillRect(X(F.x0 + c0 * F.cell), Y(F.z0 + r * F.cell), (c1 - c0 + 1) * F.cell * s, F.cell * s);
  ctx.globalAlpha = FG.lineOpacity;
  ctx.strokeStyle = FG.hatch;
  ctx.lineWidth = Math.max(1, FG.line * s);
  ctx.beginPath();
  for (const [r, c0, c1] of F.runs) {
    const x0 = F.x0 + c0 * F.cell, x1 = F.x0 + (c1 + 1) * F.cell, z0 = F.z0 + r * F.cell, z1 = z0 + F.cell;
    for (let c = Math.ceil((x0 + z0 - off) / step) * step + off; c <= x1 + z1; c += step) {
      const xa = Math.max(x0, c - z1), xb = Math.min(x1, c - z0);
      if (xb > xa) { ctx.moveTo(X(xa), Y(c - xa)); ctx.lineTo(X(xb), Y(c - xb)); }
    }
  }
  ctx.stroke();
  ctx.globalAlpha = FG.edgeOpacity;
  ctx.strokeStyle = FG.edge;
  ctx.lineWidth = Math.max(1, FG.edgeWidth * s);
  ctx.beginPath();
  const [on, gap] = FG.edgeDash.split(' ').map(Number);
  for (const [x0, z0, x1, z1] of fogEdges(F)) {
    const len = Math.hypot(x1 - x0, z1 - z0), ux = (x1 - x0) / len, uz = (z1 - z0) / len;
    for (let t = 0; t < len; t += on + gap) { const t1 = Math.min(len, t + on); ctx.moveTo(X(x0 + ux * t), Y(z0 + uz * t)); ctx.lineTo(X(x0 + ux * t1), Y(z0 + uz * t1)); }
  }
  ctx.stroke();
  ctx.globalAlpha = 1;
  // core + checkpoint
  ctx.strokeStyle = BLUE;
  ctx.lineWidth = Math.max(1.5, px / 400);
  R(m.core, 'stroke');
  R(m.checkpoint.rect, 'stroke');
  // markers: the symbols at their real places, then their labels placed clear of every symbol and of each other (the overlay's placer
  // in canvas pixels; lane MAP): YOU, TRUCK, then the destination names (two lines when long), a leader when one stands off its frame
  const fs = Math.max(9, Math.round(px / 64)), r = Math.max(3, px / 110), font: FontSpec = {size: fs, bold: true};
  const obstacles: Obstacle[] = [], reqs: LabelReq[] = [], texts = new Map<string, {lines: string[]; fill: string}>();
  for (const mk of m.markers) {
    const x = X(mk.x), y = Y(mk.z);
    if (mk.kind === 'destination' || mk.kind === 'depot') {
      ctx.fillStyle = PAPER; ctx.fillRect(x - r * 1.4, y - r, r * 2.8, r * 2); ctx.strokeStyle = INK; ctx.lineWidth = Math.max(1, px / 700); ctx.strokeRect(x - r * 1.4, y - r, r * 2.8, r * 2);
      obstacles.push({box: {x0: x - r * 1.4, z0: y - r, x1: x + r * 1.4, z1: y + r}, tag: 'icon'});
    } else if (mk.kind === 'blocked' || mk.kind === 'note') { // (the table copy keeps the overlay's text reports off: too small to read there)
      ctx.strokeStyle = MAP_TONE_COLOUR[mk.tone ?? 'info'] ?? RED; ctx.lineWidth = Math.max(1.5, px / 500);
      ctx.beginPath(); ctx.moveTo(x - r, y - r); ctx.lineTo(x + r, y + r); ctx.moveTo(x + r, y - r); ctx.lineTo(x - r, y + r); ctx.stroke();
      obstacles.push({box: boxAt(x, y, r * 2, r * 2), tag: 'icon'});
    } else if (mk.kind === 'checkpoint' || mk.kind === 'portal') {
      ctx.strokeStyle = BLUE; ctx.lineWidth = Math.max(1.5, px / 500); ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
      obstacles.push({box: boxAt(x, y, r * 2, r * 2), tag: 'icon'});
    }
  }
  for (const kind of ['player', 'truck'] as const) { // (the live arrows on top; YOU's label first)
    const mk = m.markers.find(k => k.kind === kind);
    if (!mk) continue;
    const x = X(mk.x), y = Y(mk.z), c = kind === 'truck' ? BLUE : RED, fx = -Math.sin(mk.yaw ?? 0), fz = -Math.cos(mk.yaw ?? 0), L = r * 2.4;
    const pts: [number, number][] = [[x + fx * L, y + fz * L], [x - fz * r, y + fx * r], [x + fz * r, y - fx * r]];
    ctx.fillStyle = c; ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); ctx.lineTo(pts[1][0], pts[1][1]); ctx.lineTo(pts[2][0], pts[2][1]); ctx.closePath(); ctx.fill();
    const box = {x0: Math.min(...pts.map(p => p[0])) - 1, z0: Math.min(...pts.map(p => p[1])) - 1, x1: Math.max(...pts.map(p => p[0])) + 1, z1: Math.max(...pts.map(p => p[1])) + 1};
    obstacles.push({box, tag: 'icon'});
    const t = mk.label.toUpperCase();
    texts.set(mk.id, {lines: [t], fill: c});
    reqs.push({id: mk.id, ax: x, az: y, anchor: box, w: textWidth(t, font), h: fs * LINE.lead, dirs: ['N', 'S', 'E', 'W', 'NE', 'NW', 'SE', 'SW']});
  }
  for (const mk of m.markers) {
    if (mk.kind !== 'destination' && mk.kind !== 'depot') continue;
    const lines = wrapText(mk.label, MAP_WRAP.name), x = X(mk.x), y = Y(mk.z);
    texts.set(mk.id, {lines, fill: INK});
    reqs.push({id: mk.id, ax: x, az: y, anchor: {x0: x - r * 1.4, z0: y - r, x1: x + r * 1.4, z1: y + r}, w: Math.max(...lines.map(l => textWidth(l, font))), h: lines.length * fs * LINE.lead, dirs: ['S', 'N', 'E', 'W', 'SE', 'SW', 'NE', 'NW']});
  }
  const lab = placeLabels(reqs, obstacles, {x0: pad, z0: pad, x1: px - pad, z1: px - pad}, [], s);
  ctx.font = `bold ${fs}px Arial, sans-serif`;
  for (const p of lab.placed) {
    const t = texts.get(p.id)!, b = p.box;
    if (p.leader) { ctx.strokeStyle = t.fill; ctx.lineWidth = Math.max(1, px / 900); ctx.globalAlpha = 0.8; ctx.beginPath(); ctx.moveTo(p.leader[0], p.leader[1]); ctx.lineTo(p.leader[2], p.leader[3]); ctx.stroke(); ctx.globalAlpha = 1; }
    const align = p.dir === 'E' || p.dir === 'NE' || p.dir === 'SE' ? 'left' : p.dir === 'W' || p.dir === 'NW' || p.dir === 'SW' ? 'right' : 'center';
    ctx.textAlign = align;
    ctx.fillStyle = t.fill;
    t.lines.forEach((l, i) => ctx.fillText(l, align === 'left' ? b.x0 : align === 'right' ? b.x1 : (b.x0 + b.x1) / 2, b.z0 + fs * (LINE.lead * i + LINE.ascent), textWidth(l, font)));
  }
  ctx.textAlign = 'center';
  // grid references along the top / left
  ctx.fillStyle = BLUE;
  ctx.font = `bold ${fs}px Arial, sans-serif`;
  m.grid.cols.forEach((c, i) => ctx.fillText(c, X((m.grid.xs[i] + m.grid.xs[i + 1]) / 2), pad * 0.75));
  m.grid.rows.forEach((r, i) => ctx.fillText(r, pad * 0.5, Y((m.grid.zs[i] + m.grid.zs[i + 1]) / 2) + fs / 3));
  ctx.restore();
  return {scale: s};
}
