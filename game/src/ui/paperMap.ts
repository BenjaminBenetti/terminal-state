// Task studio-alpha-campaign-foundation-20261102-230708-01 (lane NET): THE MAP OVERLAY — an old printed subway map on crumpled paper.
//
// The paper is ONE static texture (assets/textures/paper-map.jpg: a Codex-generated sheet with a printed double border and an empty
// title band; used as is, never redrawn). Everything on it is drawn DYNAMICALLY as SVG ink over it with a multiply blend, so the
// paper's creases and stains show through the print: track lines in their printed inks, station dots, condensed printed labels
// placed with collision avoidance, the title + line legend + symbol key in the title band, the Reactor's mark, "YOU ARE HERE".
//
// Rules (campaign/discovery.ts decides what is known / reachable):
//  - Only KNOWN stations and edges with both ends known are printed (with the 1337 cheat: everything); the Reactor's mark and name
//    appear only once it is known. The layout is fitted to the WHOLE network once, so the print never shifts as stations appear.
//  - travel mode (the train console): known stations one stop away are selectable (any station with the cheat). Clicking (or
//    Enter on) a station SELECTS it and opens the details panel; travel happens only on the explicit "Depart" button (onConfirm);
//    Cancel clears the selection. Hover never selects, a click never departs. view mode (title / pause "view map"): read-only.
//  - Pan (drag), zoom (wheel at the cursor, + / - keys and buttons), F = fit the known stations, Home = the whole sheet.
//  - Keyboard: arrows move between selectable stations by direction, Tab / Shift+Tab cycle them, Enter selects, Esc closes.
//  - While open, the map owns the keyboard (a window capture listener, installed on open and removed on close): typing 1 3 3 7
//    (Digit or Numpad keys) calls onCheat — the host persists enableCheat(state) — and the map re-renders with everything revealed.
//    No digit ever reaches the hotbar; the sequence resets on a wrong key, close, blur or a hidden tab. The Lockbox's own 1337 is
//    untouched: with the map closed its listener is gone.
//
// Task studio-beta-campaign-polish-20261103-063841-01 (lane MAP), items 10-14:
//  - the selected station's details are a CARD beside its node (placeCard: world -> screen through the pan / zoom, right of the node,
//    else left / below / above, clamped inside the viewport; re-placed on pan / zoom / resize; an overlay that never moves the print);
//  - every station prints its TYPE ICON (stationGlyph: Subway dot, Office tower, Mall bag, Reactor trefoil, Maintenance Route hex
//    nut; filled = visited) with a concise key; only known stations print, so the discovery mask holds (no Reactor spoiler);
//  - label placement never depends on the selection / keyboard focus: selecting never moves, wraps or hides a station name;
//  - travel mode also selects VISITED stations reachable over visited track (campaign/discovery.ts travelPlan): the card names the
//    route, a pencil line traces it; a cut-off visited station says "not available" (no fake path);
//  - the Maintenance Route's service line prints as a dashed graphite track (not an interchange ink).

import type {CampaignState, StationId, StationNode, SubwayNetwork} from '../campaign/types';
import {MAINTENANCE_ROUTE, archetypeLabel, isServiceLine} from '../campaign/network';
import {canTravel, enableCheat, neighbors, reactorKnown, travelBlock, travelPlan, visibleEdges, visibleNodes} from '../campaign/discovery';
import {DEV_GRANT_SEQUENCE, SequenceMatcher, digitOfCode} from '../items/devGrant';
import {isTypingTarget} from '../player/input';
import {seedToCode} from '../core/rng';

/** The paper texture (runtime URL, relative like every other asset URL). */
export const DEFAULT_PAPER_TEXTURE = 'assets/textures/paper-map.jpg';

/** The sheet in texture pixels: the printed title band, the area inside the border, the box the network is fitted into. */
export const PAPER = {
  w: 1152,
  h: 768,
  band: {x0: 30, y0: 30, x1: 1121, y1: 82},
  area: {x0: 34, y0: 96, x1: 1117, y1: 730},
  draw: {x0: 84, y0: 132, x1: 1068, y1: 698},
} as const;

const INK = '#221d18';
const RED = '#b3261e';
const LINE_W = 7.5;
const DOT_R = 6.2, HUB_R = 8.6, REACTOR_R = 12;
/** Station label size on the paper; labels grow on the paper when zoomed out so they never print below MIN_LABEL_PX on screen. */
const LABEL_FS = 13.5, MIN_LABEL_PX = 10.5;
/** Hit areas: never under 30 screen px across. */
const HIT_R = 17, MIN_HIT_PX = 15;
const MAX_ZOOM = 5;

export interface Rect { x0: number; y0: number; x1: number; y1: number }
export interface Pt { x: number; y: number }

// --- layout (pure) ------------------------------------------------------------------------------------------------------------

/** Paper positions of every station: the whole network's bounding box fitted (uniform scale, centred) into PAPER.draw. */
export function paperLayout(net: SubwayNetwork): Map<StationId, Pt> {
  const xs = net.nodes.map(n => n.x), ys = net.nodes.map(n => n.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const d = PAPER.draw, bw = Math.max(1, maxX - minX), bh = Math.max(1, maxY - minY);
  const k = Math.min((d.x1 - d.x0) / bw, (d.y1 - d.y0) / bh, 14);
  const ox = (d.x0 + d.x1) / 2 - ((minX + maxX) / 2) * k, oy = (d.y0 + d.y1) / 2 - ((minY + maxY) / 2) * k;
  return new Map(net.nodes.map(n => [n.id, {x: ox + n.x * k, y: oy + n.y * k}]));
}

const dir8 = (dx: number, dy: number) => { const a = Math.atan2(dy, dx); return ((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8; };
const dirDist = (a: number, b: number) => { const d = Math.abs(a - b) % 8; return d > 4 ? 8 - d : d; };

export interface LabelLine { text: string; fs: number; cls: string }
/** A label to place: the dot (centre, clearance radius, its track directions) and its text variants (lines + extra cost). */
export interface LabelItem { id: string; x: number; y: number; r: number; dirs: number[]; force: boolean; variants: {lines: LabelLine[]; cost: number}[] }
export interface PlacedLabel { id: string; lines: LabelLine[]; box: Rect; anchor: 'start' | 'middle' | 'end'; tx: number; ty: number; overlap: boolean }
export interface LabelWorld { bounds: Rect; markers: {id: string; box: Rect}[]; segs: [Pt, Pt][]; blocked: Rect[] }

/** Estimated printed width of a label line (condensed sans; deliberately generous). */
export const textWidth = (l: LabelLine) => l.text.length * l.fs * (l.cls.includes('caps') ? 0.8 : 0.56) + 2;
const lineH = (l: LabelLine) => l.fs * 1.16;

// candidate positions around a dot: [direction index, x sign, y sign, base cost, alignment of a label above / below (-1 left of the
// dot, 0 centred, 1 right of it)]
const CANDS: readonly [number, number, number, number, number][] = [
  [0, 1, 0, 0, 0], [4, -1, 0, 0.15, 0], [7, 1, -1, 0.3, 0], [1, 1, 1, 0.35, 0], [5, -1, -1, 0.45, 0], [3, -1, 1, 0.5, 0],
  [6, 0, -1, 0.6, 0], [2, 0, 1, 0.65, 0], [6, 0, -1, 0.75, 1], [6, 0, -1, 0.8, -1], [2, 0, 1, 0.85, 1], [2, 0, 1, 0.9, -1],
];

function candidateBox(it: LabelItem, lines: LabelLine[], ux: number, uy: number, align: number): {box: Rect; anchor: PlacedLabel['anchor']; tx: number; ty: number} {
  const w = Math.max(...lines.map(textWidth)), h = lines.reduce((s, l) => s + lineH(l), 0);
  const gap = it.r + 4, g = ux && uy ? gap * 0.72 : gap;
  const x0 = ux > 0 ? it.x + g : ux < 0 ? it.x - g - w : align > 0 ? it.x - 4 : align < 0 ? it.x + 4 - w : it.x - w / 2;
  const y0 = uy > 0 ? it.y + g : uy < 0 ? it.y - g - h : it.y - h / 2;
  const anchor = ux > 0 || (!ux && align > 0) ? 'start' : ux < 0 || (!ux && align < 0) ? 'end' : 'middle';
  const box = {x0, y0, x1: x0 + w, y1: y0 + h};
  return {box, anchor, tx: anchor === 'start' ? x0 : anchor === 'end' ? x0 + w : x0 + w / 2, ty: y0 + lines[0].fs * 0.86};
}

export const rectsOverlap = (a: Rect, b: Rect, pad = 0) => a.x0 < b.x1 + pad && b.x0 < a.x1 + pad && a.y0 < b.y1 + pad && b.y0 < a.y1 + pad;
const inside = (a: Rect, b: Rect) => a.x0 >= b.x0 && a.y0 >= b.y0 && a.x1 <= b.x1 && a.y1 <= b.y1;

/** Whether segment p-q crosses rectangle r (Liang-Barsky). */
export function segHitsRect(p: Pt, q: Pt, r: Rect): boolean {
  let t0 = 0, t1 = 1;
  const dx = q.x - p.x, dy = q.y - p.y;
  for (const [pp, qq] of [[-dx, p.x - r.x0], [dx, r.x1 - p.x], [-dy, p.y - r.y0], [dy, r.y1 - p.y]] as const) {
    if (pp === 0) { if (qq < 0) return false; continue; }
    const t = qq / pp;
    if (pp < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; }
  }
  return t0 <= t1;
}

/**
 * Greedy label placement in item order: 12 positions around each dot x the item's text variants (one / two lines, smaller print
 * when the zoom keeps it legible), never over another label, a station dot, the title band or outside the border; costs prefer
 * the right, then the left, the diagonals, above / below, away from the station's own track directions and off other track. An
 * item that fits nowhere is hidden (null) unless forced (current / selected / Reactor), which takes its cheapest spot.
 */
export function placeLabels(items: readonly LabelItem[], world: LabelWorld): Map<string, PlacedLabel | null> {
  const out = new Map<string, PlacedLabel | null>();
  const placed: Rect[] = [];
  for (const it of items) {
    let best: PlacedLabel | null = null, bestCost = Infinity, fallback: PlacedLabel | null = null, fallbackCost = Infinity;
    for (const {lines, cost: vcost} of it.variants) {
      for (const [d, ux, uy, base, align] of CANDS) {
        const c = candidateBox(it, lines, ux, uy, align);
        if (!inside(c.box, world.bounds) || world.blocked.some(b => rectsOverlap(b, c.box))) continue;
        let cost = base + vcost;
        for (const e of it.dirs) { const dd = dirDist(d, e); cost += dd === 0 ? 2.5 : dd === 1 ? 0.45 : 0; }
        for (const [p, q] of world.segs) if (segHitsRect(p, q, c.box)) cost += 1.4;
        const hard = placed.some(b => rectsOverlap(b, c.box, 1.5)) || world.markers.some(m => m.id !== it.id && rectsOverlap(m.box, c.box, 1));
        const cand: PlacedLabel = {id: it.id, lines, box: c.box, anchor: c.anchor, tx: c.tx, ty: c.ty, overlap: hard};
        if (!hard && cost < bestCost) { bestCost = cost; best = cand; }
        if (cost + (hard ? 10 : 0) < fallbackCost) { fallbackCost = cost + (hard ? 10 : 0); fallback = cand; }
      }
    }
    const pick: PlacedLabel | null = best ?? (it.force ? fallback : null);
    if (pick) placed.push(pick.box);
    out.set(it.id, pick);
  }
  return out;
}

/** The best target from `from` in an arrow direction: within 67.5 degrees of it, nearest with an angle penalty. */
export function pickByDirection(from: Pt, cands: readonly {id: string; x: number; y: number}[], dir: 'left' | 'right' | 'up' | 'down'): string | null {
  const v = {left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1]}[dir];
  let best: string | null = null, bestScore = Infinity;
  for (const c of cands) {
    const dx = c.x - from.x, dy = c.y - from.y, dist = Math.hypot(dx, dy);
    if (dist < 1) continue;
    const cos = (dx * v[0] + dy * v[1]) / dist;
    if (cos < Math.cos((67.5 * Math.PI) / 180)) continue;
    const score = dist * (1 + 2 * (1 - cos));
    if (score < bestScore) { bestScore = score; best = c.id; }
  }
  return best;
}

// --- station types and the details card (pure; lane MAP) ---------------------------------------------------------------------

/** What a station's icon shows: its archetype, or the Maintenance Route (an ordinary Subway node printed as the Reactor's bypass). */
export type StationKind = 'subway' | 'office' | 'mall' | 'reactor' | 'maintenance';

export function stationKind(node: StationNode, net: SubwayNetwork): StationKind {
  if (node.id === net.reactor || node.archetype === 'reactor') return 'reactor';
  if (node.name === MAINTENANCE_ROUTE.name && node.archetype === 'subway') return 'maintenance';
  return node.archetype === 'office' ? 'office' : node.archetype === 'mall' ? 'mall' : 'subway';
}

/** The printed wording of a kind (key, card, hit titles). */
export function kindLabel(k: StationKind): string {
  return k === 'maintenance' ? MAINTENANCE_ROUTE.name : k === 'office' ? 'Office tower' : k === 'mall' ? 'Shopping mall' : k === 'reactor' ? 'Reactor' : 'Subway station';
}

/**
 * The ink of one station icon centred at p (radius r): a round dot (Subway), a square tower with windows (Office), a shopping bag
 * with its handle (Mall), the radiation trefoil (Reactor), a hex nut (Maintenance Route). `filled` = visited (solid ink, the paper
 * showing through the details); otherwise a paper-white body in an ink outline. Shapes differ, so the type never relies on colour.
 */
export function stationGlyph(kind: StationKind, p: Pt, r: number, filled: boolean, hub = false): string {
  const fill = filled ? INK : '#ffffff', detail = filled ? '#ffffff' : INK, sw = hub ? 3.2 : 2.2;
  const x = p.x, y = p.y;
  switch (kind) {
    case 'reactor': return trefoil(p, r);
    case 'office': {
      const h = r * 0.92, w = r * 0.18;
      const win = [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([i, j]) => `<rect x="${n1(x + i * h * 0.38 - w)}" y="${n1(y + j * h * 0.38 - w)}" width="${n1(2 * w)}" height="${n1(2 * w)}" fill="${detail}"/>`).join('');
      return `<rect x="${n1(x - h)}" y="${n1(y - h)}" width="${n1(2 * h)}" height="${n1(2 * h)}" rx="1.2" fill="${fill}" stroke="${INK}" stroke-width="${sw}"/>${win}`;
    }
    case 'mall': {
      const w = r * 0.95, top = y - r * 0.35, bot = y + r * 0.95, hr = r * 0.45;
      return `<path d="M${n1(x - hr)} ${n1(top)} A${n1(hr)} ${n1(hr)} 0 0 1 ${n1(x + hr)} ${n1(top)}" fill="none" stroke="${INK}" stroke-width="${n1(sw * 0.8)}"/>`
        + `<path d="M${n1(x - w)} ${n1(top)} L${n1(x + w)} ${n1(top)} L${n1(x + w * 0.86)} ${n1(bot)} L${n1(x - w * 0.86)} ${n1(bot)} Z" fill="${fill}" stroke="${INK}" stroke-width="${sw}" stroke-linejoin="round"/>`;
    }
    case 'maintenance': {
      const R = r * 1.08;
      const pts = Array.from({length: 6}, (_, i) => `${n1(x + R * Math.cos((i * Math.PI) / 3))},${n1(y + R * Math.sin((i * Math.PI) / 3))}`).join(' ');
      return `<polygon points="${pts}" fill="${fill}" stroke="${INK}" stroke-width="${sw}" stroke-linejoin="round"/><circle cx="${n1(x)}" cy="${n1(y)}" r="${n1(r * 0.36)}" fill="#ffffff" stroke="${INK}" stroke-width="1.4"/>`;
    }
    default:
      return `<circle cx="${n1(x)}" cy="${n1(y)}" r="${n1(r)}" fill="${fill}" stroke="${INK}" stroke-width="${sw}"/>`
        + (filled && hub ? `<circle cx="${n1(x)}" cy="${n1(y)}" r="${n1(r * 0.38)}" fill="#ffffff"/>` : '');
  }
}

export interface CardPlacement { x: number; y: number; side: 'right' | 'left' | 'below' | 'above' | 'clamped' }

/**
 * Where the details card goes (screen px): beside the node at `anchor` (its marker `r` px around it) — right, else left, else below,
 * else above; vertically (horizontally) centred on the node and clamped inside the viewport below the bar; when no side fits (a tiny
 * screen) the side with the most room, clamped (it may then cover the node). Pure (map-card.test.ts).
 */
void travelBlock; // (used by the overlay below)
export function placeCard(anchor: Pt, r: number, card: {w: number; h: number}, view: {w: number; h: number; top: number}, o: {gap?: number; margin?: number} = {}): CardPlacement {
  const gap = o.gap ?? 14, m = o.margin ?? 10;
  const lo = {x: m, y: view.top + m}, hi = {x: view.w - m - card.w, y: view.h - m - card.h};
  const clamp = (v: number, a: number, b: number) => (b < a ? a : Math.min(b, Math.max(a, v)));
  const cy = clamp(anchor.y - card.h / 2, lo.y, hi.y), cx = clamp(anchor.x - card.w / 2, lo.x, hi.x);
  const right = anchor.x + r + gap, left = anchor.x - r - gap - card.w, below = anchor.y + r + gap, above = anchor.y - r - gap - card.h;
  if (right <= hi.x) return {x: right, y: cy, side: 'right'};
  if (left >= lo.x) return {x: left, y: cy, side: 'left'};
  if (below <= hi.y) return {x: cx, y: below, side: 'below'};
  if (above >= lo.y) return {x: cx, y: above, side: 'above'};
  const room = [view.w - (anchor.x + r), anchor.x - r, view.h - (anchor.y + r), anchor.y - r - view.top];
  const best = room.indexOf(Math.max(...room));
  const want = [{x: right, y: cy}, {x: left, y: cy}, {x: cx, y: below}, {x: cx, y: above}][best];
  return {x: clamp(want.x, lo.x, hi.x), y: clamp(want.y, lo.y, hi.y), side: 'clamped'};
}

// --- the key scope (pure) -----------------------------------------------------------------------------------------------------

export type PaperMapKey =
  | {kind: 'pass'} // not the map's (browser shortcuts, F-keys, typing in a field)
  | {kind: 'digit'; digit: string} // the cheat matcher only
  | {kind: 'swallow'} // consumed, nothing (auto-repeat, bare modifiers)
  | {kind: 'close'}
  | {kind: 'select'}
  | {kind: 'native'} // Enter / Space on a focused map button: consumed for the game, the browser still clicks the button
  | {kind: 'tab'; back: boolean}
  | {kind: 'arrow'; dir: 'left' | 'right' | 'up' | 'down'; pan: boolean}
  | {kind: 'zoom'; dir: 1 | -1}
  | {kind: 'fit'}
  | {kind: 'sheet'}
  | {kind: 'cancel'}
  | {kind: 'other'}; // consumed; the code starts over

const MODIFIERS = new Set(['ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight', 'CapsLock', 'AltGraph']);
const ARROWS: Record<string, 'left' | 'right' | 'up' | 'down'> = {ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down'};

export interface KeyLike { code: string; key?: string; repeat?: boolean; ctrlKey?: boolean; altKey?: boolean; metaKey?: boolean; shiftKey?: boolean; target?: unknown }

/** What a keydown does while the map is open. */
export function paperMapKeyAction(e: KeyLike, onButton = false): PaperMapKey {
  if (isTypingTarget(e.target) || e.ctrlKey || e.altKey || e.metaKey || /^F\d{1,2}$/.test(e.code)) return {kind: 'pass'};
  if (MODIFIERS.has(e.code)) return {kind: 'swallow'};
  const d = digitOfCode(e.code);
  if (d !== null) return e.repeat ? {kind: 'swallow'} : {kind: 'digit', digit: d};
  if (e.code === 'Escape') return {kind: 'close'};
  if (e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Space') return onButton ? {kind: 'native'} : e.repeat ? {kind: 'swallow'} : {kind: 'select'};
  if (e.code === 'Tab') return {kind: 'tab', back: !!e.shiftKey};
  if (ARROWS[e.code]) return {kind: 'arrow', dir: ARROWS[e.code], pan: !!e.shiftKey};
  if (e.code === 'Equal' || e.code === 'NumpadAdd' || e.key === '+') return {kind: 'zoom', dir: 1};
  if (e.code === 'Minus' || e.code === 'NumpadSubtract' || e.key === '-') return {kind: 'zoom', dir: -1};
  if (e.code === 'KeyF') return {kind: 'fit'};
  if (e.code === 'Home') return {kind: 'sheet'};
  if (e.code === 'Backspace' || e.code === 'Delete') return {kind: 'cancel'};
  return {kind: 'other'};
}

// --- the drawing model (pure) -------------------------------------------------------------------------------------------------

export type MapMode = 'travel' | 'view';

export interface MapStation {
  node: StationNode;
  p: Pt;
  r: number;
  hub: boolean;
  visited: boolean;
  current: boolean;
  reactor: boolean;
  /** The icon (lane MAP): archetype or the Maintenance Route. */
  kind: StationKind;
  /** Selectable in this mode (travel: a destination — one stop away, or visited over visited track; view: any visible station but the current one). */
  can: boolean;
  /** Travel mode: a destination ONE stop away (the pencilled "one stop away" ring). */
  adjacent: boolean;
}

export interface MapModel {
  stations: MapStation[];
  runs: {color: string; pts: Pt[]; service?: boolean}[];
  labels: Map<string, PlacedLabel | null>;
  legend: {color: string; name: string}[];
  fs: number;
  hitR: number;
  cheat: boolean;
  reactorShown: boolean;
  /** The Maintenance Route is on the map (its key entry and dashed service track). */
  maintenanceShown: boolean;
  /** Travel mode, a selected multi-hop destination: the paper points of its route (current station first), else null. */
  route: Pt[] | null;
}

/** The base printed name of a line (a branch prints as its parent). */
const baseLineName = (name: string) => name.replace(/ \([^)]*\)$/, '');

/**
 * Everything the map prints for `state` at screen scale `scale` (paper px -> screen px). The label layout depends on the state, the
 * mode and the scale only — NEVER on `selected` / `focused` (lane MAP item 12: selecting never moves / wraps / hides a station name);
 * those two only add pencil marks and the route trace.
 */
export function buildMapModel(state: CampaignState, mode: MapMode, scale: number, selected: StationId | null, focused: StationId | null, layout = paperLayout(state.network)): MapModel {
  void focused; // the keyboard focus only draws a pencil ring (renderInk); it never reaches the label layout
  const net = state.network;
  const nodes = visibleNodes(state);
  const vis = new Set(nodes.map(n => n.id));
  const colourOf = new Map(net.lines.filter(l => !isServiceLine(l)).map(l => [l.id, l.color]));
  const here = new Set(neighbors(net, state.current));
  const stations: MapStation[] = nodes.map(node => {
    const hub = new Set(node.lines.filter(l => colourOf.has(l)).map(l => colourOf.get(l))).size > 1;
    const reactor = node.id === net.reactor;
    const current = node.id === state.current;
    const can = mode === 'travel' ? travelPlan(state, node.id) !== null : !current;
    return {
      node, p: layout.get(node.id)!, hub, reactor, current, visited: state.visited.includes(node.id), kind: stationKind(node, net),
      r: reactor ? REACTOR_R : hub ? HUB_R : DOT_R,
      can, adjacent: mode === 'travel' && can && here.has(node.id),
    };
  });
  // track: per line, the runs of consecutive visible edges (the Maintenance Route's service line prints dashed)
  const edgeKeys = new Set(visibleEdges(state).map(([a, b]) => `${a}|${b}`));
  const shown = (a: string, b: string) => edgeKeys.has(a < b ? `${a}|${b}` : `${b}|${a}`);
  const runs: MapModel['runs'] = [];
  for (const l of net.lines) {
    const st = l.loop ? [...l.stations, l.stations[0]] : l.stations;
    const service = isServiceLine(l);
    let cur: Pt[] = [];
    const flush = () => { if (cur.length) runs.push(service ? {color: l.color, pts: cur, service} : {color: l.color, pts: cur}); cur = []; };
    for (let i = 0; i + 1 < st.length; i++) {
      if (shown(st[i], st[i + 1])) {
        if (!cur.length) cur.push(layout.get(st[i])!);
        cur.push(layout.get(st[i + 1])!);
      } else flush();
    }
    flush();
  }
  const segs: [Pt, Pt][] = runs.flatMap(r => r.pts.slice(1).map((p, i) => [r.pts[i], p] as [Pt, Pt]));
  // labels
  const fs = Math.min(30, Math.max(LABEL_FS, MIN_LABEL_PX / Math.max(1e-3, scale)));
  const dirsOf = (id: string) => neighbors(net, id).filter(n => vis.has(n) && shown(id, n)).map(n => {
    const a = layout.get(id)!, b = layout.get(n)!;
    return dir8(b.x - a.x, b.y - a.y);
  });
  const prio = (s: MapStation) => (s.current ? 0 : s.reactor ? 1 : s.adjacent ? 2 : s.kind === 'maintenance' ? 3 : s.hub ? 4 : s.visited ? 5 : 6);
  // smaller print only where the zoom keeps it at least MIN_LABEL_PX on screen
  const sizes = [1, 0.84, 0.7].filter((k, i) => !i || fs * k * scale >= MIN_LABEL_PX);
  const items: LabelItem[] = stations.slice().sort((a, b) => prio(a) - prio(b) || (a.node.id < b.node.id ? -1 : 1)).map(s => {
    const variants: LabelItem['variants'] = [];
    sizes.forEach((k, si) => {
      const f = fs * k;
      const name = {text: s.node.name, fs: s.reactor ? f * 1.2 : f, cls: s.reactor ? 'pm-l-reactor' : s.hub || s.current ? 'pm-l-hub' : 'pm-l'};
      const sub = s.current ? {text: s.reactor ? 'YOU ARE HERE · REACTOR' : 'YOU ARE HERE', fs: f * 0.86, cls: 'pm-l-you caps'}
        : s.reactor ? {text: 'REACTOR', fs: f * 0.8, cls: 'pm-l-sub caps'} : null;
      const words = s.node.name.split(' ');
      variants.push({lines: sub ? [name, sub] : [name], cost: si * 1.6});
      if (words.length > 1) {
        let best = 1, diff = Infinity;
        for (let i = 1; i < words.length; i++) { const d = Math.abs(words.slice(0, i).join(' ').length - words.slice(i).join(' ').length); if (d < diff) { diff = d; best = i; } }
        const two = [{...name, text: words.slice(0, best).join(' ')}, {...name, text: words.slice(best).join(' ')}];
        variants.push({lines: sub ? [...two, sub] : two, cost: si * 1.6 + 0.35});
      }
    });
    // clear the pencil marks around the dot that do not depend on the selection: the "one stop away" ring, the you-are-here ring
    const clear = s.adjacent ? 8 : s.current ? 6 : 0;
    return {id: s.node.id, x: s.p.x, y: s.p.y, r: s.r + clear, dirs: dirsOf(s.node.id), force: s.current || s.reactor, variants};
  });
  const markers = stations.map(s => ({id: s.node.id, box: {x0: s.p.x - s.r - 1, y0: s.p.y - s.r - 1, x1: s.p.x + s.r + 1, y1: s.p.y + s.r + 1}}));
  const labels = placeLabels(items, {bounds: PAPER.area, markers, segs, blocked: [{x0: PAPER.band.x0, y0: PAPER.band.y0, x1: PAPER.band.x1, y1: PAPER.band.y1 + 8}]});
  // legend: the lines serving a visible station, one entry per ink (the service line is in the symbol key, with its station)
  const legend: MapModel['legend'] = [];
  for (const l of net.lines) {
    if (isServiceLine(l) || !l.stations.some(s => vis.has(s)) || legend.some(e => e.color === l.color)) continue;
    const trunk = net.lines.find(o => o.color === l.color && !/\(.*branch\)$/.test(o.name)) ?? l;
    legend.push({color: l.color, name: baseLineName(trunk.name)});
  }
  const plan = mode === 'travel' && selected ? travelPlan(state, selected) : null;
  return {
    stations, runs, labels, legend, fs, hitR: Math.max(HIT_R, MIN_HIT_PX / Math.max(1e-3, scale)), cheat: state.cheat, reactorShown: reactorKnown(state),
    maintenanceShown: stations.some(s => s.kind === 'maintenance'), route: plan && plan.hops > 1 ? plan.route.map(id => layout.get(id)!) : null,
  };
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const n1 = (v: number) => (Math.round(v * 10) / 10).toString();

/** The radiation trefoil (the Reactor's printed mark), centred at p. */
function trefoil(p: Pt, r: number): string {
  const blade = (a: number) => {
    const a0 = a - Math.PI / 6, a1 = a + Math.PI / 6, ri = r * 0.28, ro = r * 0.9;
    const pt = (rr: number, aa: number) => `${n1(p.x + rr * Math.cos(aa))} ${n1(p.y + rr * Math.sin(aa))}`;
    return `M${pt(ri, a0)} L${pt(ro, a0)} A${n1(ro)} ${n1(ro)} 0 0 1 ${pt(ro, a1)} L${pt(ri, a1)} A${n1(ri)} ${n1(ri)} 0 0 0 ${pt(ri, a0)} Z`;
  };
  const a = -Math.PI / 2;
  return `<circle cx="${n1(p.x)}" cy="${n1(p.y)}" r="${n1(r)}" fill="#ffffff" stroke="${RED}" stroke-width="2.6"/>`
    + `<path d="${blade(a)} ${blade(a + (2 * Math.PI) / 3)} ${blade(a + (4 * Math.PI) / 3)}" fill="${RED}"/>`
    + `<circle cx="${n1(p.x)}" cy="${n1(p.y)}" r="${n1(r * 0.17)}" fill="${RED}"/>`;
}

/** A hand-pencilled ring (an open arc with a slight overshoot). */
function pencilRing(p: Pt, r: number, color: string, w: number): string {
  const a0 = -2.2, a1 = a0 + 2 * Math.PI + 0.35;
  const pt = (a: number, rr: number) => `${n1(p.x + rr * Math.cos(a))} ${n1(p.y + rr * 0.94 * Math.sin(a))}`;
  return `<path d="M${pt(a0, r * 1.04)} A${n1(r)} ${n1(r * 0.94)} 0 1 1 ${pt(a0 + Math.PI, r)} A${n1(r)} ${n1(r * 0.94)} 0 0 1 ${pt(a1, r * 0.97)}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round"/>`;
}

/** The title band's key rows: the line inks (row 1) and the symbols (row 2), laid out left to right, shrunk to fit when needed. */
function keyRow(cells: {w: number; svg: string}[], x0: number, x1: number, y: number): string {
  const gap = 22, total = cells.reduce((t, c) => t + c.w, 0) + gap * Math.max(0, cells.length - 1);
  const k = total > x1 - x0 ? (x1 - x0) / total : 1;
  let x = 0;
  const out = cells.map(c => { const g = `<g transform="translate(${n1(x)} 0)">${c.svg}</g>`; x += c.w + gap; return g; }).join('');
  return `<g transform="translate(${n1(x0)} ${n1(y)})${k < 1 ? ` scale(${k.toFixed(3)})` : ''}">${out}</g>`;
}

const keyText = (t: string, fs: number) => t.length * fs * 0.56 + 2;

/** The SVG ink layer of a model (paper coordinates; the sheet transform pans / zooms it with the paper). */
export function renderInk(m: MapModel, net: SubwayNetwork, mode: MapMode, selected: StationId | null, focused: StationId | null): string {
  const o: string[] = [`<svg class="pm-ink" viewBox="0 0 ${PAPER.w} ${PAPER.h}" width="${PAPER.w}" height="${PAPER.h}" aria-hidden="true">`];
  // the title band: title, line legend, symbol key
  const b = PAPER.band;
  o.push(`<g class="pm-band">`);
  o.push(`<text class="pm-title" x="${b.x0 + 16}" y="${b.y0 + 27}" font-size="21">CITY RAPID TRANSIT</text>`);
  o.push(`<text class="pm-subtitle" x="${b.x0 + 17}" y="${b.y0 + 44}" font-size="10.5">Network map · not to scale · issue ${esc(seedToCode(net.seed))}</text>`);
  const lines = m.legend.map(e => ({w: 33 + keyText(e.name, 12), svg: `<rect x="0" y="-7" width="26" height="7" rx="2" fill="${esc(e.color)}"/><text x="33" y="0" font-size="12">${esc(e.name)}</text>`}));
  // the symbol key: the station types (the Reactor / the Maintenance Route only once on the map), filled = visited, the travel ring
  const sym = (kind: StationKind, label: string, extra = '') => ({w: 18 + keyText(label, 11) + (extra ? 30 : 0),
    svg: `<g class="pm-key-${kind}">${extra}${stationGlyph(kind, {x: (extra ? 30 : 0) + 6, y: -4}, kind === 'reactor' ? 7 : 5, kind !== 'reactor')}</g><text x="${(extra ? 30 : 0) + 17}" y="0" font-size="11">${esc(label)}</text>`});
  const symbols = [sym('subway', 'Subway'), sym('office', 'Office'), sym('mall', 'Mall')];
  if (m.reactorShown) symbols.push(sym('reactor', 'Reactor'));
  if (m.maintenanceShown) symbols.push(sym('maintenance', MAINTENANCE_ROUTE.name, `<line x1="0" y1="-4" x2="24" y2="-4" stroke="${MAINTENANCE_ROUTE.color}" stroke-width="3" stroke-dasharray="5 3"/>`));
  symbols.push({w: 30 + keyText('Visited / not yet', 11), svg: `${stationGlyph('subway', {x: 5, y: -4}, 4.6, true)}${stationGlyph('subway', {x: 17, y: -4}, 4.6, false)}<text x="27" y="0" font-size="11">Visited / not yet</text>`});
  if (mode === 'travel') symbols.push({w: 18 + keyText('One stop away', 11), svg: `<circle cx="6" cy="-3.5" r="7" fill="none" stroke="#4a4038" stroke-width="1.4" stroke-dasharray="2.5 2.5"/><text x="18" y="0" font-size="11">One stop away</text>`});
  o.push(keyRow(lines, 390, b.x1 - 12, b.y0 + 21));
  o.push(`<g class="pm-key">${keyRow(symbols, 390, b.x1 - 12, b.y0 + 43)}</g>`);
  o.push(`</g>`);
  o.push(`<text class="pm-issue" x="${PAPER.area.x0 + 10}" y="${PAPER.area.y1 - 8}" font-size="9.5">Printed for the travelling public · keep this copy</text>`);
  if (m.cheat) o.push(`<g class="pm-stamp" transform="translate(${PAPER.area.x1 - 150} ${PAPER.area.y0 + 30}) rotate(-7)"><rect x="-8" y="-17" width="140" height="24" fill="none" stroke="${RED}" stroke-width="2"/><text x="62" y="0" text-anchor="middle" font-size="13" fill="${RED}">ALL STATIONS OPEN</text></g>`);
  // track (the Maintenance Route's service line: a thinner dashed graphite track)
  o.push(`<g class="pm-track" fill="none" stroke-linecap="round" stroke-linejoin="round">`);
  for (const r of m.runs) {
    const pts = r.pts.map(p => `${n1(p.x)},${n1(p.y)}`).join(' ');
    o.push(r.service ? `<polyline class="pm-service" points="${pts}" stroke="${esc(r.color)}" stroke-width="${n1(LINE_W * 0.62)}" stroke-dasharray="11 7"/>` : `<polyline points="${pts}" stroke="${esc(r.color)}" stroke-width="${LINE_W}"/>`);
  }
  o.push(`</g>`);
  // reachable hints (pencil, travel mode): the stations one stop away
  o.push(`<g class="pm-hints" fill="none">`);
  if (mode === 'travel') for (const s of m.stations) if (s.adjacent) o.push(`<circle cx="${n1(s.p.x)}" cy="${n1(s.p.y)}" r="${n1(s.r + 6)}" stroke="#4a4038" stroke-width="1.5" stroke-dasharray="3 3"/>`);
  o.push(`</g>`);
  // stations: the type icons
  o.push(`<g class="pm-stops">`);
  for (const s of m.stations) {
    const cls = `pm-stop pm-kind-${s.kind}${s.visited ? ' pm-visited' : ''}${s.hub ? ' pm-hub' : ''}${s.current ? ' pm-current' : ''}${s.reactor ? ' pm-reactor' : ''}`;
    o.push(`<g class="${cls}" data-id="${esc(s.node.id)}">${stationGlyph(s.kind, s.p, s.r, s.visited, s.hub)}</g>`);
  }
  o.push(`</g>`);
  // marks (under the labels, so a pencil mark never hides a name): the selected route, you are here, selection, keyboard focus
  o.push(`<g class="pm-marks">`);
  if (m.route) o.push(`<polyline class="pm-route" points="${m.route.map(p => `${n1(p.x)},${n1(p.y)}`).join(' ')}" fill="none" stroke="#262320" stroke-width="3" stroke-dasharray="1 6" stroke-linecap="round" stroke-linejoin="round"/>`);
  for (const s of m.stations) {
    if (s.current) o.push(`<circle class="pm-you" cx="${n1(s.p.x)}" cy="${n1(s.p.y)}" r="${n1(s.r + 5)}" fill="none" stroke="${RED}" stroke-width="3.4"/>`);
    if (s.node.id === selected) o.push(`<g class="pm-selected">${pencilRing(s.p, s.r + 12, '#262320', 2.6)}</g>`);
    if (s.node.id === focused && focused !== selected) o.push(`<g class="pm-focused">${pencilRing(s.p, s.r + 11, '#1f4f8f', 2)}</g>`);
  }
  o.push(`</g>`);
  // labels
  o.push(`<g class="pm-labels">`);
  for (const s of m.stations) {
    const l = m.labels.get(s.node.id);
    if (!l) continue;
    let y = l.ty;
    const spans = l.lines.map((ln, i) => {
      if (i) y += ln.fs * 1.16;
      return `<tspan x="${n1(l.tx)}" y="${n1(y)}" font-size="${n1(ln.fs)}" class="${ln.cls}">${esc(ln.text)}</tspan>`;
    }).join('');
    o.push(`<text class="pm-label${s.can ? ' pm-can' : ''}" data-station="${esc(s.node.id)}" text-anchor="${l.anchor}">${spans}</text>`);
  }
  o.push(`</g>`);
  // hit areas (>= 30 screen px across)
  o.push(`<g class="pm-hits">`);
  for (const s of m.stations) {
    const label = `${s.node.name}, ${s.kind === 'maintenance' ? `${kindLabel(s.kind)} (${archetypeLabel(s.node.archetype)})` : archetypeLabel(s.node.archetype)}${s.current ? ', you are here' : s.adjacent ? ', one stop away' : s.can && mode === 'travel' ? ', visited' : ''}`;
    o.push(`<circle class="pm-hit${s.can ? ' pm-can' : ''}" data-station="${esc(s.node.id)}" cx="${n1(s.p.x)}" cy="${n1(s.p.y)}" r="${n1(m.hitR)}"><title>${esc(label)}</title></circle>`);
  }
  o.push(`</g></svg>`);
  return o.join('');
}

// --- the overlay (DOM) --------------------------------------------------------------------------------------------------------

export interface PaperMapOptions {
  /** Paper texture URL (default DEFAULT_PAPER_TEXTURE); '' prints on the flat placeholder colour. */
  paperTexture?: string;
  /** Mount point (default #app, else the body). */
  parent?: HTMLElement | null;
}

export interface PaperMapOpen {
  state: CampaignState;
  /** 'travel' (train console: select + Depart) or 'view' (read-only). Default 'travel'. */
  mode?: MapMode;
  /** Depart confirmed for `to` (the map has closed itself first). */
  onConfirm?: (to: StationId) => void;
  /** The player closed the map (Esc / Close). Not called for host close() or after a confirm. */
  onClose?: () => void;
  /** 1337 typed: the host persists enableCheat(state); a returned state is shown, else the map applies enableCheat to its copy. */
  onCheat?: () => CampaignState | void;
}

const CSS = `
#papermap { position: fixed; inset: 0; z-index: 70; background: rgba(10, 9, 8, 0.9); color: var(--cream, #ece4cf); overflow: hidden; outline: none; user-select: none; -webkit-user-select: none; touch-action: none; }
#papermap.pm-hidden, #papermap .pm-hidden { display: none; }
#papermap .pm-stage { position: absolute; inset: 0; cursor: grab; }
#papermap .pm-stage.pm-dragging { cursor: grabbing; }
#papermap .pm-sheet { position: absolute; left: 0; top: 0; width: ${PAPER.w}px; height: ${PAPER.h}px; transform-origin: 0 0; background-color: #e2d3ae; background-size: 100% 100%; background-repeat: no-repeat; box-shadow: 0 16px 50px rgba(0, 0, 0, 0.7); }
#papermap .pm-ink { position: absolute; left: 0; top: 0; width: 100%; height: 100%; mix-blend-mode: multiply; overflow: visible; }
#papermap .pm-ink text { font-family: "Gill Sans", "Gill Sans MT", "Trebuchet MS", "Segoe UI", "DejaVu Sans Condensed", "Liberation Sans Narrow", "Arial Narrow", sans-serif; fill: ${INK}; letter-spacing: 0.01em; }
#papermap .pm-ink .pm-title { font-family: "Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua", Georgia, serif; font-weight: 700; letter-spacing: 0.14em; }
#papermap .pm-ink .pm-subtitle, #papermap .pm-ink .pm-issue { font-family: "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif; font-style: italic; fill: #3a332c; }
#papermap .pm-ink .pm-l-hub { font-weight: 700; }
#papermap .pm-ink .pm-l-reactor { font-weight: 800; fill: ${RED}; letter-spacing: 0.03em; }
#papermap .pm-ink .caps { text-transform: uppercase; letter-spacing: 0.12em; font-weight: 700; }
#papermap .pm-ink .pm-l-you { fill: ${RED}; }
#papermap .pm-ink .pm-l-sub { fill: ${RED}; }
#papermap .pm-ink .pm-stamp text { font-family: "Courier New", Courier, monospace; font-weight: 700; letter-spacing: 0.08em; fill: ${RED}; }
#papermap .pm-label.pm-can { cursor: pointer; }
#papermap .pm-hit { fill: transparent; stroke: none; pointer-events: all; }
#papermap .pm-hit.pm-can { cursor: pointer; }
#papermap .pm-hit.pm-can:hover { stroke: #3a3028; stroke-width: 1.4; stroke-dasharray: 2 3; }
#papermap .pm-bar { position: absolute; left: 0; right: 0; top: 0; height: 46px; display: flex; align-items: center; gap: 14px; padding: 0 12px; background: rgba(16, 18, 20, 0.94); border-bottom: 1px solid #3a3f44; font-size: 14px; }
#papermap .pm-bar b { letter-spacing: 0.06em; font-size: 15px; }
#papermap .pm-mode { color: var(--cream-dim, #b9b19c); font-size: 12.5px; flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#papermap .pm-tools { display: flex; gap: 6px; }
#papermap .pm-tools button { padding: 5px 11px; font-size: 14px; min-width: 34px; min-height: 32px; }
#papermap .pm-panel { position: absolute; right: 14px; bottom: 40px; width: min(330px, calc(100vw - 28px)); background: rgba(16, 18, 20, 0.95); border: 1px solid #3a3f44; border-top: 3px solid var(--teal, #4f8a87); padding: 11px 14px 12px; box-shadow: 0 10px 30px rgba(0, 0, 0, 0.6); font-size: 13px; }
#papermap .pm-p-name { font-size: 18px; font-weight: 700; letter-spacing: 0.02em; }
#papermap .pm-p-kind { color: var(--mustard, #d9a520); font-size: 12px; letter-spacing: 0.1em; text-transform: uppercase; margin-top: 2px; }
#papermap .pm-p-kind.pm-reactor-kind { color: #e0574b; }
#papermap .pm-p-lines { display: flex; flex-wrap: wrap; gap: 4px 12px; margin-top: 8px; color: var(--cream-dim, #b9b19c); }
#papermap .pm-p-lines i { display: inline-block; width: 18px; height: 6px; border-radius: 2px; margin-right: 6px; vertical-align: middle; }
#papermap .pm-p-state { margin-top: 8px; }
#papermap .pm-p-note { margin-top: 4px; color: var(--cream-dim, #b9b19c); font-size: 12px; }
#papermap .pm-p-actions { display: flex; gap: 8px; margin-top: 10px; }
#papermap .pm-p-actions button { flex: 1; padding: 9px 12px; }
#papermap .pm-help { position: absolute; left: 12px; bottom: 10px; right: 360px; color: var(--cream-dim, #b9b19c); font-size: 11.5px; text-shadow: 0 1px 2px #000; pointer-events: none; }
#papermap .pm-note { position: absolute; left: 50%; top: 56px; transform: translateX(-50%); background: rgba(16, 18, 20, 0.92); border: 1px solid #3a3f44; padding: 6px 12px; font-size: 13px; color: var(--mustard, #d9a520); pointer-events: none; }
#papermap .pm-live { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
@media (max-width: 720px) { #papermap .pm-help { display: none; } #papermap .pm-panel { right: 8px; left: 8px; width: auto; bottom: 8px; } }
`;
let styled = false;

const BAR_H = 46;

export class PaperMap {
  private root: HTMLElement | null = null;
  private stage: HTMLElement | null = null;
  private sheet: HTMLElement | null = null;
  private panel: HTMLElement | null = null;
  private state: CampaignState | null = null;
  private layout: Map<StationId, Pt> | null = null;
  private layoutNet: SubwayNetwork | null = null;
  private args: PaperMapOpen | null = null;
  private openFlag = false;
  private view = {s: 1, tx: 0, ty: 0};
  private drag: {id: number; x: number; y: number; tx: number; ty: number; moved: boolean} | null = null;
  private suppressClick = false;
  private noteTimer: ReturnType<typeof setTimeout> | null = null;
  private model: MapModel | null = null;
  /** The 1337 cheat matcher (reset on open / close / blur / a hidden tab / a wrong key). */
  readonly matcher = new SequenceMatcher(DEV_GRANT_SEQUENCE);
  selected: StationId | null = null;
  focused: StationId | null = null;
  mode: MapMode = 'travel';
  /** The last note shown (QA / tests). */
  note = '';

  private readonly onKey = (e: KeyboardEvent) => this.handleKey(e);
  private readonly onBlur = () => this.matcher.reset();
  private readonly onVisibility = () => this.matcher.reset();
  private readonly onResize = () => { if (this.openFlag) { this.clampView(); this.render(); } };
  private readonly onMove = (e: PointerEvent) => this.pointerMove(e);
  private readonly onUp = (e: PointerEvent) => this.pointerUp(e);

  constructor(private readonly opts: PaperMapOptions = {}) {}

  get isOpen(): boolean {
    return this.openFlag;
  }

  /** Current campaign state shown (after any cheat applied by the map). */
  get shownState(): CampaignState | null {
    return this.state;
  }

  /** Open the map (travel or read-only) over everything; keyboard captured until close. */
  open(o: PaperMapOpen): void {
    if (this.openFlag) this.detach();
    this.args = o;
    this.mode = o.mode ?? 'travel';
    this.state = o.state;
    this.selected = null;
    this.focused = null;
    this.note = '';
    this.model = null; // a reopen always re-prints (the view may be unchanged while the state is not)
    this.matcher.reset();
    this.openFlag = true;
    this.mount();
    this.attach();
    this.root?.classList.remove('pm-hidden');
    this.fitKnown();
    this.renderPanel();
    this.root?.focus?.();
  }

  /** Host close (no callback). */
  close(): void {
    if (!this.openFlag) return;
    this.openFlag = false;
    this.detach();
    this.matcher.reset();
    this.selected = null;
    this.focused = null;
    this.cancelDrag();
    this.root?.classList.add('pm-hidden');
  }

  /** The host's state changed (e.g. after enableCheat / a reveal): re-render, dropping a selection that is no longer valid. */
  update(state: CampaignState): void {
    this.state = state;
    if (this.selected && !this.selectable(this.selected)) this.selected = null;
    if (this.focused && !this.selectable(this.focused)) this.focused = null;
    this.render();
    this.renderPanel();
  }

  /** Remove the overlay from the page. */
  destroy(): void {
    this.close();
    this.root?.remove();
    this.root = this.stage = this.sheet = this.panel = null;
  }

  // --- selection ------------------------------------------------------------------------------------------------------------

  /** Whether `id` can be selected now (travel: a destination; view: any visible station but the current one). */
  selectable(id: StationId): boolean {
    const st = this.state;
    if (!st) return false;
    if (!visibleNodes(st).some(n => n.id === id)) return false;
    return this.mode === 'travel' ? canTravel(st, id) : id !== st.current;
  }

  /** Select a station (details panel). False (with a note) for a station that is not selectable. Never travels. */
  select(id: StationId): boolean {
    const st = this.state;
    if (!this.openFlag || !st) return false;
    if (!this.selectable(id)) {
      const n = st.network.nodes.find(x => x.id === id);
      if (n && visibleNodes(st).some(x => x.id === id)) this.say(id === st.current ? `You are here: ${n.name}` : `${n.name} is not one stop from here`);
      return false;
    }
    this.selected = id;
    this.focused = id;
    this.render();
    this.renderPanel();
    this.ensureVisible(id);
    const n = st.network.nodes.find(x => x.id === id)!;
    this.announce(`${n.name} selected. ${this.mode === 'travel' ? 'Depart to travel there, or cancel.' : ''}`);
    (this.panel?.querySelector('.pm-depart') as HTMLElement | null)?.focus?.();
    return true;
  }

  /** Clear the selection (the Cancel button). */
  cancel(): void {
    if (!this.selected) return;
    this.selected = null;
    this.render();
    this.renderPanel();
    this.root?.focus?.();
  }

  /** "Depart": travel mode, a selected destination -> close, then onConfirm(to). */
  confirm(): boolean {
    const st = this.state, to = this.selected;
    if (!this.openFlag || !st || this.mode !== 'travel' || !to || !canTravel(st, to)) return false;
    const cb = this.args?.onConfirm;
    this.close();
    cb?.(to);
    return true;
  }

  /** The player's close (Esc / Close): close, then onClose. */
  userClose(): void {
    if (!this.openFlag) return;
    const cb = this.args?.onClose;
    this.close();
    cb?.();
  }

  /** Stations the keyboard moves between. */
  private focusables(): MapStation[] {
    return (this.model?.stations ?? []).filter(s => s.can);
  }

  /** Tab order: clockwise around the current station from north (travel), reading order (view). */
  private tabOrder(): MapStation[] {
    const list = this.focusables();
    const cur = this.model?.stations.find(s => s.current)?.p ?? {x: PAPER.w / 2, y: PAPER.h / 2};
    if (this.mode === 'travel') {
      const ang = (p: Pt) => { const a = Math.atan2(p.x - cur.x, -(p.y - cur.y)); return a < 0 ? a + 2 * Math.PI : a; };
      return list.sort((a, b) => ang(a.p) - ang(b.p) || Math.hypot(a.p.x - cur.x, a.p.y - cur.y) - Math.hypot(b.p.x - cur.x, b.p.y - cur.y));
    }
    return list.sort((a, b) => Math.round(a.p.y / 24) - Math.round(b.p.y / 24) || a.p.x - b.p.x);
  }

  /** Move the keyboard focus (Tab order) by +1 / -1. */
  focusNext(step: 1 | -1): StationId | null {
    const order = this.tabOrder();
    if (!order.length) { this.say(this.mode === 'travel' ? 'No station one stop from here is on the map yet' : 'No other station on the map yet'); return null; }
    const i = order.findIndex(s => s.node.id === this.focused);
    const next = order[i < 0 ? (step > 0 ? 0 : order.length - 1) : (i + step + order.length) % order.length];
    return this.setFocus(next.node.id);
  }

  /**
   * Move the keyboard focus by arrow direction: in travel mode (the destinations ring the train) the destination in that direction
   * FROM THE CURRENT STATION; in view mode / with the cheat, the next station in that direction from the focused one.
   */
  focusDir(dir: 'left' | 'right' | 'up' | 'down'): StationId | null {
    const ms = this.model?.stations ?? [];
    const radial = this.mode === 'travel' && !this.state?.cheat;
    const here = ms.find(s => s.current)?.p;
    const from = radial ? here : ms.find(s => s.node.id === this.focused)?.p ?? here;
    const cands = this.focusables().filter(s => radial || s.node.id !== this.focused).map(s => ({id: s.node.id, x: s.p.x, y: s.p.y}));
    if (!from || !cands.length) return this.focusNext(1);
    const id = pickByDirection(from, cands, dir);
    return id ? this.setFocus(id) : this.focused;
  }

  private setFocus(id: StationId): StationId {
    this.focused = id;
    this.render();
    this.ensureVisible(id);
    const n = this.state?.network.nodes.find(x => x.id === id);
    if (n) this.announce(`${n.name}, ${archetypeLabel(n.archetype)}. Enter selects.`);
    return id;
  }

  // --- view (pan / zoom) ----------------------------------------------------------------------------------------------------

  private viewport(): {w: number; h: number} {
    const w = typeof window !== 'undefined' && window.innerWidth ? window.innerWidth : 1280;
    const h = typeof window !== 'undefined' && window.innerHeight ? window.innerHeight : 720;
    return {w, h};
  }

  /** The scale that shows the whole sheet. */
  sheetScale(): number {
    const {w, h} = this.viewport();
    return Math.max(0.05, Math.min((w - 16) / PAPER.w, (h - BAR_H - 16) / PAPER.h));
  }

  /** Show the whole sheet. */
  fitSheet(): void {
    const {w, h} = this.viewport(), s = this.sheetScale();
    this.setView(s, (w - PAPER.w * s) / 2, BAR_H + (h - BAR_H - PAPER.h * s) / 2);
  }

  /** Frame the known stations (zoomed in up to 1.7x the whole-sheet scale, so the sheet still reads as a map; never below it). */
  fitKnown(): void {
    const st = this.state;
    if (!st) return;
    const lay = this.paperPositions();
    const pts = visibleNodes(st).map(n => lay.get(n.id)!).filter(Boolean);
    if (!pts.length) { this.fitSheet(); return; }
    const pad = 110;
    const x0 = Math.min(...pts.map(p => p.x)) - pad, x1 = Math.max(...pts.map(p => p.x)) + pad;
    const y0 = Math.min(...pts.map(p => p.y)) - pad, y1 = Math.max(...pts.map(p => p.y)) + pad;
    const {w, h} = this.viewport(), base = this.sheetScale();
    const s = Math.min(base * 1.7, Math.max(base, Math.min((w - 16) / (x1 - x0), (h - BAR_H - 16) / (y1 - y0))));
    // centred on the known stations, but the sheet keeps covering the screen along any axis where it is larger than it
    const cover = (t: number, size: number, lo: number, hi: number) => (size > hi - lo ? Math.min(lo, Math.max(hi - size, t)) : lo + (hi - lo - size) / 2);
    const tx = cover(w / 2 - ((x0 + x1) / 2) * s, PAPER.w * s, 0, w), ty = cover(BAR_H + (h - BAR_H) / 2 - ((y0 + y1) / 2) * s, PAPER.h * s, BAR_H, h);
    this.setView(s, tx, ty);
  }

  /** Zoom by `f` around the screen point (cx, cy) (default: the viewport centre). */
  zoomBy(f: number, cx?: number, cy?: number): void {
    const {w, h} = this.viewport();
    const px = cx ?? w / 2, py = cy ?? BAR_H + (h - BAR_H) / 2;
    const base = this.sheetScale();
    const s = Math.min(Math.max(base * 0.9, this.view.s * f), Math.max(base * MAX_ZOOM, 2.5));
    const k = s / this.view.s;
    this.setView(s, px - (px - this.view.tx) * k, py - (py - this.view.ty) * k);
  }

  panBy(dx: number, dy: number): void {
    this.setView(this.view.s, this.view.tx + dx, this.view.ty + dy);
  }

  /** The current view (paper px -> screen px: screen = paper * s + t). */
  get viewState(): {s: number; tx: number; ty: number} {
    return {...this.view};
  }

  private setView(s: number, tx: number, ty: number): void {
    const rescale = Math.abs(s - this.view.s) > 1e-6;
    this.view = {s, tx, ty};
    this.clampView();
    if (rescale || !this.model) this.render();
    else this.applyTransform();
  }

  /** Keep at least a quarter of the sheet on screen. */
  private clampView(): void {
    const {w, h} = this.viewport(), v = this.view;
    const sw = PAPER.w * v.s, sh = PAPER.h * v.s;
    const mx = Math.min(sw, w) * 0.25, my = Math.min(sh, h) * 0.25;
    v.tx = Math.min(w - mx, Math.max(mx - sw, v.tx));
    v.ty = Math.min(h - my, Math.max(BAR_H + my - sh, v.ty));
  }

  private applyTransform(): void {
    if (this.sheet) this.sheet.style.transform = `translate(${n1(this.view.tx)}px, ${n1(this.view.ty)}px) scale(${this.view.s.toFixed(4)})`;
  }

  /** Pan so that station `id` is on screen (clear of the bar and the details panel). */
  private ensureVisible(id: StationId): void {
    const p = this.paperPositions().get(id);
    if (!p) return;
    const {w, h} = this.viewport(), v = this.view;
    const sx = p.x * v.s + v.tx, sy = p.y * v.s + v.ty;
    const right = w > 720 ? w - 360 : w - 30, bottom = w > 720 ? h - 40 : h - 230;
    let dx = 0, dy = 0;
    if (sx < 40) dx = 40 - sx; else if (sx > right) dx = right - sx;
    if (sy < BAR_H + 40) dy = BAR_H + 40 - sy; else if (sy > bottom) dy = bottom - sy;
    if (dx || dy) this.panBy(dx, dy);
  }

  private paperPositions(): Map<StationId, Pt> {
    const net = this.state!.network;
    if (!this.layout || this.layoutNet !== net) { this.layout = paperLayout(net); this.layoutNet = net; }
    return this.layout;
  }

  // --- rendering ------------------------------------------------------------------------------------------------------------

  private mount(): void {
    if (this.root || typeof document === 'undefined') return;
    if (!styled) {
      styled = true;
      const st = document.createElement('style');
      st.id = 'papermap-styles';
      st.textContent = CSS;
      document.head.appendChild(st);
    }
    const el = document.createElement('section');
    el.id = 'papermap';
    el.className = 'pm-hidden';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', 'Network map');
    el.setAttribute('tabindex', '-1');
    el.innerHTML = `<div class="pm-stage"><div class="pm-sheet"></div></div>
      <header class="pm-bar"><b>Network map</b><span class="pm-mode"></span><span class="pm-tools"><button type="button" class="pm-zoom-out" aria-label="Zoom out" title="Zoom out (-)">−</button><button type="button" class="pm-zoom-in" aria-label="Zoom in" title="Zoom in (+)">+</button><button type="button" class="pm-fit" title="Fit the known stations (F)">Fit</button><button type="button" class="pm-close" title="Close (Esc)">Close</button></span></header>
      <aside class="pm-panel pm-hidden" aria-live="polite"></aside>
      <div class="pm-note pm-hidden"></div>
      <div class="pm-help">Drag to pan · wheel or + and − zoom · F fits · arrows or Tab pick a station · Enter selects · Esc closes</div>
      <div class="pm-live" aria-live="polite"></div>`;
    (this.opts.parent ?? document.querySelector('#app') ?? document.body).appendChild(el);
    this.root = el;
    this.stage = el.querySelector<HTMLElement>('.pm-stage');
    this.sheet = el.querySelector<HTMLElement>('.pm-sheet');
    this.panel = el.querySelector<HTMLElement>('.pm-panel');
    const tex = this.opts.paperTexture ?? DEFAULT_PAPER_TEXTURE;
    if (this.sheet && tex) this.sheet.style.backgroundImage = `url("${tex.replace(/"/g, '%22')}")`;
    el.addEventListener('click', e => this.onClick(e as MouseEvent));
    this.stage?.addEventListener('pointerdown', e => this.pointerDown(e as PointerEvent));
    this.stage?.addEventListener('wheel', e => {
      const we = e as WheelEvent;
      we.preventDefault();
      we.stopPropagation();
      this.zoomBy(Math.exp(-Math.max(-300, Math.min(300, we.deltaY * (we.deltaMode === 1 ? 33 : 1))) * 0.0018), we.clientX, we.clientY);
    }, {passive: false});
    el.addEventListener('dragstart', e => e.preventDefault());
  }

  private attach(): void {
    if (typeof window === 'undefined') return;
    window.addEventListener('keydown', this.onKey, {capture: true});
    window.addEventListener('blur', this.onBlur);
    window.addEventListener('resize', this.onResize);
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.onVisibility);
  }

  private detach(): void {
    if (typeof window === 'undefined') return;
    window.removeEventListener('keydown', this.onKey, {capture: true});
    window.removeEventListener('blur', this.onBlur);
    window.removeEventListener('resize', this.onResize);
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.onVisibility);
  }

  /** Re-print the ink for the current state / view. */
  render(): void {
    const st = this.state;
    if (!st || !this.openFlag) return;
    if (this.selected && !this.selectable(this.selected)) this.selected = null;
    this.model = buildMapModel(st, this.mode, this.view.s, this.selected, this.focused, this.paperPositions());
    if (this.sheet) this.sheet.innerHTML = renderInk(this.model, st.network, this.mode, this.selected, this.focused);
    this.applyTransform();
    const mode = this.root?.querySelector('.pm-mode');
    if (mode) {
      const here = st.network.nodes.find(n => n.id === st.current);
      mode.textContent = this.mode === 'travel'
        ? `${here ? `At ${here.name}` : ''} · pick a station one stop away, then Depart${st.cheat ? ' · ALL STATIONS OPEN' : ''}`
        : `View only — travel from the train's console${st.cheat ? ' · ALL STATIONS OPEN' : ''}`;
    }
  }

  private renderPanel(): void {
    const p = this.panel, st = this.state;
    if (!p || !st) return;
    const id = this.selected;
    const n = id ? st.network.nodes.find(x => x.id === id) : null;
    if (!n) { p.classList.add('pm-hidden'); p.innerHTML = ''; return; }
    const lines = st.network.lines.filter(l => n.lines.includes(l.id));
    const seen = new Set<string>();
    const lineHtml = lines.filter(l => !seen.has(l.name) && (seen.add(l.name), true)).map(l => `<span><i style="background:${esc(l.color)}"></i>${esc(l.name)}</span>`).join('');
    const adjacent = neighbors(st.network, st.current).includes(n.id);
    const visited = st.visited.includes(n.id);
    const state = `${visited ? 'Visited' : 'Not visited yet'}${adjacent ? ' · one stop from here' : st.cheat ? ' · far away (cheat route)' : ''}`;
    const reactor = n.archetype === 'reactor';
    const actions = this.mode === 'travel' && canTravel(st, n.id)
      ? `<div class="pm-p-actions"><button type="button" class="pm-depart primary">Depart</button><button type="button" class="pm-cancel">Cancel</button></div>`
      : `<div class="pm-p-note">View only — travel from the train's console.</div><div class="pm-p-actions"><button type="button" class="pm-cancel">Close details</button></div>`;
    p.innerHTML = `<div class="pm-p-name">${esc(n.name)}</div><div class="pm-p-kind${reactor ? ' pm-reactor-kind' : ''}">${esc(archetypeLabel(n.archetype))}</div>`
      + `<div class="pm-p-lines">${lineHtml}</div><div class="pm-p-state">${esc(state)}</div>`
      + (reactor ? `<div class="pm-p-note">The Reactor: the end of the line.</div>` : '') + actions;
    p.classList.remove('pm-hidden');
  }

  private say(text: string): void {
    this.note = text;
    const el = this.root?.querySelector('.pm-note');
    if (!el) return;
    el.textContent = text;
    el.classList.remove('pm-hidden');
    if (this.noteTimer) clearTimeout(this.noteTimer);
    this.noteTimer = setTimeout(() => el.classList.add('pm-hidden'), 2200);
  }

  private announce(text: string): void {
    const el = this.root?.querySelector('.pm-live');
    if (el) el.textContent = text;
  }

  // --- input ----------------------------------------------------------------------------------------------------------------

  private onClick(e: MouseEvent): void {
    if (!this.openFlag) return;
    const t = e.target as HTMLElement | null;
    const hit = (sel: string) => !!t?.closest?.(sel);
    if (hit('.pm-close')) { this.userClose(); return; }
    if (hit('.pm-zoom-in')) { this.zoomBy(1.35); return; }
    if (hit('.pm-zoom-out')) { this.zoomBy(1 / 1.35); return; }
    if (hit('.pm-fit')) { this.fitKnown(); return; }
    if (hit('.pm-depart')) { this.confirm(); return; }
    if (hit('.pm-cancel')) { this.cancel(); return; }
    if (!hit('.pm-stage') || this.suppressClick) return;
    const id = this.stationAt(e, t);
    if (id) this.select(id);
  }

  /** The station under a click: the nearest visible station within the hit radius (screen coordinates), else the target's. */
  private stationAt(e: MouseEvent, t: HTMLElement | null): StationId | null {
    const own = (t?.closest?.('[data-station]') as HTMLElement | null)?.getAttribute('data-station') ?? null;
    if (typeof e.clientX !== 'number' || typeof e.clientY !== 'number' || !this.model) return own;
    const v = this.view, px = (e.clientX - v.tx) / v.s, py = (e.clientY - v.ty) / v.s;
    let best: MapStation | null = null, bd = Infinity;
    for (const s of this.model.stations) {
      const d = Math.hypot(s.p.x - px, s.p.y - py);
      if (d < bd && d <= this.model.hitR) { bd = d; best = s; }
    }
    return best?.node.id ?? own;
  }

  private pointerDown(e: PointerEvent): void {
    if (e.button !== 0 || (e.target as HTMLElement | null)?.closest?.('button')) return;
    this.drag = {id: e.pointerId, x: e.clientX, y: e.clientY, tx: this.view.tx, ty: this.view.ty, moved: false};
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('pointercancel', this.onUp);
  }

  private pointerMove(e: PointerEvent): void {
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 5) return;
    d.moved = true;
    this.stage?.classList.add('pm-dragging');
    this.view.tx = d.tx + dx;
    this.view.ty = d.ty + dy;
    this.clampView();
    this.applyTransform();
  }

  private pointerUp(e: PointerEvent): void {
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    if (d.moved) { this.suppressClick = true; setTimeout(() => { this.suppressClick = false; }, 0); }
    this.cancelDrag();
  }

  private cancelDrag(): void {
    this.drag = null;
    this.stage?.classList.remove('pm-dragging');
    if (typeof window === 'undefined') return;
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    window.removeEventListener('pointercancel', this.onUp);
  }

  /** The window keydown capture listener (installed only while open). */
  handleKey(e: Pick<KeyboardEvent, 'code' | 'key' | 'repeat' | 'ctrlKey' | 'altKey' | 'metaKey' | 'shiftKey' | 'target' | 'preventDefault' | 'stopPropagation' | 'stopImmediatePropagation'>): void {
    if (!this.openFlag) return;
    const t = e.target as HTMLElement | null;
    const onButton = !!t && t.tagName === 'BUTTON' && !!this.root?.contains?.(t);
    const a = paperMapKeyAction(e, onButton);
    if (a.kind === 'pass') return;
    e.stopImmediatePropagation(); // never reaches the game (quick slots, pause, any binding) nor a later capture listener
    if (a.kind !== 'native') e.preventDefault();
    if (a.kind !== 'digit' && a.kind !== 'swallow') this.matcher.reset();
    switch (a.kind) {
      case 'digit': this.digit(a.digit); break;
      case 'close': this.userClose(); break;
      case 'select': if (this.focused) this.select(this.focused); else this.focusNext(1); break;
      case 'tab': this.root?.focus?.(); this.focusNext(a.back ? -1 : 1); break;
      case 'arrow': if (a.pan) this.panBy({left: 60, right: -60, up: 0, down: 0}[a.dir], {left: 0, right: 0, up: 60, down: -60}[a.dir]); else this.focusDir(a.dir); break;
      case 'zoom': this.zoomBy(a.dir > 0 ? 1.35 : 1 / 1.35); break;
      case 'fit': this.fitKnown(); break;
      case 'sheet': this.fitSheet(); break;
      case 'cancel': this.cancel(); break;
      default: break;
    }
  }

  /** One digit typed while open; true when it completed 1 3 3 7. */
  digit(d: string): boolean {
    if (!this.openFlag || !this.matcher.push(d)) return false;
    const st = this.state;
    if (!st || st.cheat) return true; // repeated code: already open, nothing more to do
    const got = this.args?.onCheat?.();
    this.state = got ?? enableCheat(st);
    this.render();
    this.renderPanel();
    this.say('Service override: every station is on the map and open');
    this.announce('All stations revealed');
    return true;
  }

  /** QA: a compact report. */
  qa() {
    const m = this.model;
    return {
      open: this.openFlag, mode: this.mode, selected: this.selected, focused: this.focused, note: this.note, progress: this.matcher.progress,
      cheat: !!this.state?.cheat, reactorShown: !!m?.reactorShown, view: this.viewState,
      shown: m?.stations.map(s => s.node.id) ?? [], selectable: m?.stations.filter(s => s.can).map(s => s.node.id) ?? [],
      labels: m ? [...m.labels.values()].filter(Boolean).length : 0, hiddenLabels: m ? [...m.labels].filter(([, l]) => !l).map(([id]) => id) : [],
    };
  }
}
