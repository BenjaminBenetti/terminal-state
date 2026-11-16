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

import type {MapMarker, PlanningMap} from './mapModel';
import type {SRect} from '../../gen/surface/surfaceTypes';

const INK = '#2a2620', PENCIL = '#4a4740', RED = '#a8231c', BLUE = '#1f4e8c', GREEN = '#2f6b2f', PAPER = '#e8dfc6';
export const MAP_TONE_COLOUR: Readonly<Record<string, string>> = {hazard: RED, enemy: RED, supply: GREEN, route: BLUE, info: INK};

/** The sheet's frame around the district (m): margin left / top / bottom, the legend column on the right. */
export const SHEET = {margin: 30, title: 34, legend: 170} as const;

export function sheetBox(m: PlanningMap): {x: number; y: number; w: number; h: number} {
  const E = m.extent;
  return {x: E.x0 - SHEET.margin, y: E.z0 - SHEET.margin - SHEET.title, w: E.x1 - E.x0 + SHEET.margin * 2 + SHEET.legend, h: E.z1 - E.z0 + SHEET.margin * 2 + SHEET.title};
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const n = (v: number) => (Math.round(v * 10) / 10).toString();
const rect = (r: SRect, attrs: string) => `<rect x="${n(r.x0)}" y="${n(r.z0)}" width="${n(r.x1 - r.x0)}" height="${n(r.z1 - r.z0)}" ${attrs}/>`;

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

/** The full overlay sheet (an <svg> string; its viewBox is the sheet box in world metres). */
export function renderPlanningSvg(m: PlanningMap): string {
  const B = sheetBox(m), E = m.extent, out: string[] = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" class="spm-svg" viewBox="${n(B.x)} ${n(B.y)} ${n(B.w)} ${n(B.h)}" width="${n(B.w)}" height="${n(B.h)}" font-family="'Arial Narrow', 'Roboto Condensed', Arial, sans-serif">`);
  out.push(`<defs><pattern id="spm-fog" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="#58564c" fill-opacity="0.26"/><path d="M0 0 V6" stroke="#3f3d36" stroke-width="1.1" stroke-opacity="0.45"/></pattern>`
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
  // streets (carriageways), blocks, buildings
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
    const op = b.condition === 'damaged' ? 0.45 : 0.6;
    out.push(rect(b.rect, `class="spm-bldg" data-building="${b.id}" fill="${fill}" fill-opacity="${op}" stroke="${b.destination ? INK : '#7b725d'}" stroke-width="${b.destination ? 1.1 : 0.5}"${b.condition === 'collapsed' ? ' stroke-dasharray="2 2"' : ''}`));
  }
  out.push('</g>');
  // core (area of operations) outline
  out.push(rect(m.core, `fill="none" stroke="${BLUE}" stroke-width="1.6" stroke-dasharray="9 5"`));
  out.push(`<text x="${n(m.core.x0 + 3)}" y="${n(m.core.z0 - 3)}" font-size="7" fill="${BLUE}" font-weight="700">AO CORE</text>`);
  // the checkpoint compound + tent
  out.push(rect(m.checkpoint.rect, `fill="none" stroke="${BLUE}" stroke-width="1.2"`) + rect(m.checkpoint.tent, `fill="${BLUE}" fill-opacity="0.18" stroke="${BLUE}" stroke-width="0.8"`));
  // fog (unexplored ground)
  const F = m.fog;
  out.push(`<g class="spm-fog" fill="url(#spm-fog)">`);
  for (const [r, c0, c1] of F.runs) out.push(`<rect x="${n(F.x0 + c0 * F.cell)}" y="${n(F.z0 + r * F.cell)}" width="${n((c1 - c0 + 1) * F.cell)}" height="${n(F.cell)}"/>`);
  out.push('</g>');
  // street names (over the fog: the city plan is printed)
  out.push(`<g class="spm-street-names" fill="#4f4838" font-size="6" text-anchor="middle" letter-spacing="0.4">`);
  for (const s of m.streets) if (s.label) out.push(`<text x="${n(s.label.x)}" y="${n(s.label.z + 2)}"${s.label.vertical ? ` transform="rotate(-90 ${n(s.label.x)} ${n(s.label.z + 2)})"` : ''}>${esc(s.name.toUpperCase())}</text>`);
  out.push('</g>');
  // markers
  const stack = new Map<string, number>();
  const slot = (k: string) => { const v = stack.get(k) ?? 0; stack.set(k, v + 1); return v; };
  out.push('<g class="spm-markers">');
  for (const mk of m.markers) out.push(markerSvg(mk, slot));
  out.push('</g>');
  // title band, legend, scale, north
  out.push(`<text x="${n(E.x0)}" y="${n(E.z0 - SHEET.margin - 10)}" font-size="15" font-weight="700" fill="${INK}" letter-spacing="1.5">PLANNING MAP — ${esc(m.name.toUpperCase())}</text>`);
  out.push(`<text x="${n(E.x1)}" y="${n(E.z0 - SHEET.margin - 10)}" font-size="8" fill="${PENCIL}" text-anchor="end">CHECKPOINT COPY · GRID SQUARES = 1 BLOCK · EXPLORED ${Math.round(m.explored * 100)} %</text>`);
  out.push(legendSvg(E.x1 + SHEET.margin + 6, E.z0, m));
  out.push('</svg>');
  return out.join('');
}

function markerSvg(mk: MapMarker, slot: (k: string) => number): string {
  const t = `translate(${n(mk.x)} ${n(mk.z)})`, lab = esc(mk.label);
  switch (mk.kind) {
    case 'destination': case 'depot': {
      const entered = mk.entered ? `<path d="M5.6 -6.6 l1.4 1.6 l3 -3.4" fill="none" stroke="${GREEN}" stroke-width="1.1"/>` : '';
      return `<g class="spm-dest" data-ref="building:${mk.ref.type === 'building' ? mk.ref.id : ''}" transform="${t}"><rect x="-6" y="-4.5" width="12" height="9" fill="${PAPER}" fill-opacity="0.85" stroke="${INK}" stroke-width="0.9"/>${glyph(mk.symbol)}${entered}`
        + `<text x="0" y="12" font-size="6.4" text-anchor="middle" fill="${INK}" font-weight="700">${lab}</text><text x="0" y="18.5" font-size="4.6" text-anchor="middle" fill="${PENCIL}">${esc(mk.grid)}</text></g>`;
    }
    case 'checkpoint':
      return `<g class="spm-cp" transform="${t}"><rect x="-8" y="-5" width="16" height="10" fill="${PAPER}" fill-opacity="0.85" stroke="${BLUE}" stroke-width="1.2"/><path d="M-8 -5 L8 5 M8 -5 L-8 5" stroke="${BLUE}" stroke-width="0.8"/>`
        + `<text x="0" y="13" font-size="6.4" text-anchor="middle" fill="${BLUE}" font-weight="700">CHECKPOINT</text></g>`;
    case 'portal':
      return `<g class="spm-portal" transform="${t}"><circle r="4" fill="${PAPER}" stroke="${BLUE}" stroke-width="1"/><path d="M0 -2.4 v4.4 M-2 0.4 l2 2 l2 -2" fill="none" stroke="${BLUE}" stroke-width="0.9"/>`
        + `<text x="0" y="-6" font-size="5" text-anchor="middle" fill="${BLUE}">${lab}</text></g>`;
    case 'blocked':
      return `<g class="spm-blocked" transform="${t}"><rect x="-5" y="-5" width="10" height="10" fill="url(#spm-block)" stroke="${RED}" stroke-width="0.9"/><path d="M-5 -5 L5 5 M5 -5 L-5 5" stroke="${RED}" stroke-width="1.3"/></g>`;
    case 'note': {
      const c = MAP_TONE_COLOUR[mk.tone ?? 'info'] ?? RED, k = slot(`n${Math.round(mk.x)},${Math.round(mk.z)}`);
      return `<g class="spm-note" transform="${t}"><g transform="translate(0 ${n(-k * 9)})">${toneGlyph(mk.symbol, c)}<text x="5" y="2" font-size="6" fill="${c}" font-style="italic" font-family="'Segoe Print', 'Bradley Hand', 'Comic Sans MS', cursive">${lab}</text></g></g>`;
    }
    case 'report': {
      const c = MAP_TONE_COLOUR[mk.tone ?? 'info'] ?? PENCIL, k = slot(mk.ref.type === 'building' ? `b${mk.ref.id}` : `r${Math.round(mk.x)},${Math.round(mk.z)}`);
      return `<g class="spm-report" transform="${t}"><text x="0" y="${n(24.5 + k * 6)}" font-size="4.8" text-anchor="middle" fill="${c === INK ? PENCIL : c}">${lab}</text></g>`;
    }
    case 'truck': {
      const deg = headingDeg(mk.yaw ?? 0);
      return `<g class="spm-truck" transform="${t}"><g transform="rotate(${n(deg)})"><rect x="-2.6" y="-4.4" width="5.2" height="8.8" rx="1" fill="${BLUE}" fill-opacity="0.85"/><path d="M0 -9 L2.4 -5.4 H-2.4 Z" fill="${BLUE}"/></g>`
        + `<text x="6" y="-4" font-size="5.2" fill="${BLUE}" font-weight="700">TRUCK</text></g>`;
    }
    case 'player': {
      const deg = headingDeg(mk.yaw ?? 0);
      return `<g class="spm-player" transform="${t}"><circle r="4.2" fill="none" stroke="${RED}" stroke-width="1.1"/><g transform="rotate(${n(deg)})"><path d="M0 -9 L3 -2 L0 -3.6 L-3 -2 Z" fill="${RED}"/></g>`
        + `<text x="6" y="5" font-size="5.6" fill="${RED}" font-weight="700">YOU</text></g>`;
    }
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
  out.push(`<g transform="translate(7 ${yy})"><rect x="-6" y="-4" width="12" height="8" fill="url(#spm-fog)"/></g><text x="18" y="${yy + 2.5}" font-size="6" fill="${INK}">Not yet explored</text>`);
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
  fillText(s: string, x: number, y: number): void;
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
  // fog
  ctx.globalAlpha = 0.3;
  ctx.fillStyle = '#4c4a42';
  const F = m.fog;
  for (const [r, c0, c1] of F.runs) ctx.fillRect(X(F.x0 + c0 * F.cell), Y(F.z0 + r * F.cell), (c1 - c0 + 1) * F.cell * s, F.cell * s);
  ctx.globalAlpha = 1;
  // core + checkpoint
  ctx.strokeStyle = BLUE;
  ctx.lineWidth = Math.max(1.5, px / 400);
  R(m.core, 'stroke');
  R(m.checkpoint.rect, 'stroke');
  // markers
  const fs = Math.max(9, Math.round(px / 64));
  ctx.textAlign = 'center';
  for (const mk of m.markers) {
    const x = X(mk.x), y = Y(mk.z), r = Math.max(3, px / 110);
    if (mk.kind === 'destination' || mk.kind === 'depot') {
      ctx.fillStyle = PAPER; ctx.fillRect(x - r * 1.4, y - r, r * 2.8, r * 2); ctx.strokeStyle = INK; ctx.lineWidth = Math.max(1, px / 700); ctx.strokeRect(x - r * 1.4, y - r, r * 2.8, r * 2);
      ctx.fillStyle = INK; ctx.font = `bold ${fs}px Arial, sans-serif`; ctx.fillText(mk.label, x, y + r + fs);
    } else if (mk.kind === 'blocked' || mk.kind === 'note' || mk.kind === 'report') {
      if (mk.kind === 'report') continue; // (the table copy keeps the overlay's text reports off: too small to read there)
      ctx.strokeStyle = MAP_TONE_COLOUR[mk.tone ?? 'info'] ?? RED; ctx.lineWidth = Math.max(1.5, px / 500);
      ctx.beginPath(); ctx.moveTo(x - r, y - r); ctx.lineTo(x + r, y + r); ctx.moveTo(x + r, y - r); ctx.lineTo(x - r, y + r); ctx.stroke();
    } else if (mk.kind === 'truck' || mk.kind === 'player') {
      const c = mk.kind === 'truck' ? BLUE : RED, fx = -Math.sin(mk.yaw ?? 0), fz = -Math.cos(mk.yaw ?? 0), L = r * 2.4;
      ctx.fillStyle = c; ctx.beginPath(); ctx.moveTo(x + fx * L, y + fz * L); ctx.lineTo(x - fz * r, y + fx * r); ctx.lineTo(x + fz * r, y - fx * r); ctx.closePath(); ctx.fill();
      ctx.font = `bold ${fs}px Arial, sans-serif`; ctx.fillText(mk.kind === 'truck' ? 'TRUCK' : 'YOU', x, y - r * 2.6);
    } else if (mk.kind === 'checkpoint' || mk.kind === 'portal') {
      ctx.strokeStyle = BLUE; ctx.lineWidth = Math.max(1.5, px / 500); ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
    }
  }
  // grid references along the top / left
  ctx.fillStyle = BLUE;
  ctx.font = `bold ${fs}px Arial, sans-serif`;
  m.grid.cols.forEach((c, i) => ctx.fillText(c, X((m.grid.xs[i] + m.grid.xs[i + 1]) / 2), pad * 0.75));
  m.grid.rows.forEach((r, i) => ctx.fillText(r, pad * 0.5, Y((m.grid.zs[i] + m.grid.zs[i + 1]) / 2) + fs / 3));
  ctx.restore();
  return {scale: s};
}
