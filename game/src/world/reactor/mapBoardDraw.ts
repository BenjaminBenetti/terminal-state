// Task reactor-expansion-20261101 (lane CONTROLS): the FLOOR-MAP BOARD's canvas — DYNAMIC runtime content (the standing art rule's
// exemption: a plan drawn from the level grid + live markers, redrawn only when what it shows changes). Pure drawing on a 2D context
// (tests use the canvas shim). Layout of the face (px, MAP_PX): a hazard-yellow header with the storey shown, the north-up plan of that
// storey (walkable decks / galleries, stairs, rooms, the side complexes, the pit outline, ladders, room names), the markers (X = still
// needed here, a check = done, an amber ring = carried: use it here), "you are here" + facing, a legend of this storey's markers, and
// the storey labels beside the 3D storey buttons (mapBoard.ts) in the right column (with the count of open X marks per storey).

import {CELL} from '../../gen/grid';
import {fitSize} from './restartScreens';
import {MAP_BOARD, MARKER_LETTER, MARKER_NAME, PLAN, type MapMarker, type MapPlan, type StoreyPlan} from './mapBoardPlan';

type Ctx = CanvasRenderingContext2D;
const FONT = '"DejaVu Sans Mono", "Courier New", monospace';

export interface MapFace {
  plan: MapPlan;
  /** The storey shown. */
  storey: StoreyPlan;
  /** Markers of the shown storey. */
  markers: readonly MapMarker[];
  /** Storey buttons top-down: level, label, open X marks on it, selected. */
  floors: readonly {level: number; label: string; need: number; selected: boolean; here: boolean}[];
  /** The player on the shown storey (world x / z, camera yaw) or null. */
  you: {x: number; z: number; yaw: number} | null;
  /** The board's own position on the shown storey (or null). */
  board: {x: number; z: number} | null;
}

function text(ctx: Ctx, s: string, x: number, y: number, size: number, color: string, align: CanvasTextAlign, maxW: number, weight = 'bold'): void {
  const px = fitSize(ctx, s, size, maxW, weight);
  ctx.font = `${weight} ${px}px ${FONT}`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillText(s, x, y);
}

const COL: Record<number, string> = {[PLAN.floor]: '#56635a', [PLAN.stairs]: '#9a8642', [PLAN.room]: '#5f7486', [PLAN.complex]: '#6c5d82'};

/** Canvas rects of the face: header, map, right column, legend (px). */
export function mapFaceLayout(W: number, H: number): {head: number; map: {x: number; y: number; w: number; h: number}; col: number; legend: {y: number; h: number}} {
  const head = Math.round(H * 0.085), col = Math.round(W * 0.2), legendH = Math.round(H * 0.16);
  return {head, map: {x: 10, y: head + 10, w: W - col - 20, h: H - head - legendH - 20}, col, legend: {y: H - legendH - 4, h: legendH}};
}

/** Canvas y of storey button k of n (matches mapButtons: the column centred on the board). */
export function buttonCanvasY(k: number, n: number, H: number): number {
  return H / 2 - (((n - 1) / 2 - k) * MAP_BOARD.buttonPitch / MAP_BOARD.h) * H;
}
export const buttonCanvasX = (W: number): number => W - (MAP_BOARD.buttonInset / MAP_BOARD.w) * W;

export function drawMapFace(ctx: Ctx, W: number, H: number, f: MapFace): void {
  ctx.save();
  const L = mapFaceLayout(W, H);
  // panel + header
  ctx.fillStyle = '#161c1f'; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = '#3a4248'; ctx.lineWidth = 4; ctx.strokeRect(2, 2, W - 4, H - 4);
  ctx.fillStyle = '#d9a72b'; ctx.fillRect(4, 4, W - 8, L.head);
  const depth = f.storey.baseY === 0 ? 'RIM 0 M' : `${f.storey.baseY.toFixed(0)} M`;
  text(ctx, `FLOOR MAP — ${f.storey.label.toUpperCase()} · ${depth}`, W / 2, 4 + L.head / 2, Math.round(L.head * 0.5), '#15181a', 'center', W - 24);
  // --- the plan
  const P = f.plan, M = L.map;
  const k = Math.min(M.w / (P.x1 - P.x0), M.h / (P.z1 - P.z0));
  const ox = M.x + (M.w - (P.x1 - P.x0) * k) / 2, oz = M.y + (M.h - (P.z1 - P.z0) * k) / 2;
  const U = (x: number) => ox + (x - P.x0) * k, V = (z: number) => oz + (z - P.z0) * k;
  ctx.fillStyle = '#0e1214'; ctx.fillRect(M.x, M.y, M.w, M.h);
  const r = f.storey.runs, c = CELL * k;
  for (let i = 0; i < r.length; i += 4) {
    ctx.fillStyle = COL[r[i + 3]] ?? COL[PLAN.floor];
    ctx.fillRect(U(r[i] * CELL), V(r[i + 2] * CELL), (r[i + 1] - r[i]) * c + 0.5, c + 0.5);
  }
  // the pit outline (dashed green: the open shaft)
  if (P.pit.length >= 3) {
    ctx.strokeStyle = '#63d36e'; ctx.lineWidth = 2;
    ctx.setLineDash?.([8, 6]);
    ctx.beginPath();
    P.pit.forEach((p, i) => (i ? ctx.lineTo(U(p.x), V(p.z)) : ctx.moveTo(U(p.x), V(p.z))));
    ctx.closePath(); ctx.stroke();
    ctx.setLineDash?.([]);
  }
  // ladders (H) and room names
  for (const l of f.storey.ladders) text(ctx, l.up && l.down ? 'H' : l.up ? 'H↑' : 'H↓', U(l.x), V(l.z), 14, '#e8e2d0', 'center', 40);
  // (lead merge fix: a room near the map's edge — e.g. a side complex at the frame's edge — keeps its whole label inside the map)
  for (const rm of f.storey.rooms) {
    const mw = Math.max(60, 9 * c);
    ctx.font = `bold ${fitSize(ctx, rm.label, 13, mw, 'bold')}px ${FONT}`;
    const hw = Math.min(ctx.measureText(rm.label).width, M.w - 8) / 2; // the label's real half width at its fitted size
    const lx = Math.min(Math.max(U(rm.x), M.x + hw + 4), M.x + M.w - hw - 4), ly = Math.min(Math.max(V(rm.z), M.y + 10), M.y + M.h - 10);
    text(ctx, rm.label, lx, ly, 13, '#dfe6ea', 'center', mw);
  }
  // north arrow
  text(ctx, 'N ↑', M.x + M.w - 8, M.y + 14, 14, '#9fb0b8', 'right', 60);
  // --- the markers
  for (const m of f.markers) marker(ctx, U(m.x), V(m.z), m);
  // --- you are here (+ facing) and the board itself
  if (f.board) { ctx.fillStyle = '#7fc8ff'; ctx.fillRect(U(f.board.x) - 4, V(f.board.z) - 4, 8, 8); }
  if (f.you) {
    const x = U(f.you.x), y = V(f.you.z), dx = -Math.sin(f.you.yaw), dz = -Math.cos(f.you.yaw), s = 13;
    ctx.fillStyle = '#7fc8ff'; ctx.strokeStyle = '#0b2030'; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x + dx * s, y + dz * s);
    ctx.lineTo(x - dx * s * 0.6 - dz * s * 0.6, y - dz * s * 0.6 + dx * s * 0.6);
    ctx.lineTo(x - dx * s * 0.6 + dz * s * 0.6, y - dz * s * 0.6 - dx * s * 0.6);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    text(ctx, 'YOU ARE HERE', x, y + 22, 12, '#7fc8ff', 'center', 140);
  }
  // --- the storey column (labels beside the 3D buttons)
  const bx = buttonCanvasX(W), n = f.floors.length;
  text(ctx, 'FLOOR', W - L.col / 2 - 4, M.y + 4, 15, '#c9c2b0', 'center', L.col - 12);
  f.floors.forEach((fl, i) => {
    const y = buttonCanvasY(i, n, H);
    if (fl.selected) { ctx.fillStyle = 'rgba(232,177,58,0.22)'; ctx.fillRect(W - L.col, y - 24, L.col - 6, 48); }
    const label = fl.label.toUpperCase().replace('CORE FLOOR', 'CORE');
    text(ctx, label, bx - 28, y - 6, 15, fl.selected ? '#ffd27a' : '#d8d2c2', 'right', L.col - 40);
    if (fl.need > 0) text(ctx, `${fl.need} ×`, bx - 28, y + 12, 13, '#e0503c', 'right', L.col - 40);
    else text(ctx, '—', bx - 28, y + 12, 12, '#6f7a7e', 'right', L.col - 40, 'normal');
    if (fl.here) text(ctx, '●', W - L.col + 8, y, 12, '#7fc8ff', 'left', 20);
  });
  // --- the legend of this storey
  const LY = L.legend.y, lw = W - L.col - 20;
  ctx.fillStyle = '#20282c'; ctx.fillRect(10, LY, lw, L.legend.h);
  text(ctx, 'X STILL NEEDED   ✓ DONE   ◯ CARRIED: USE HERE   ▲ YOU', 18, LY + 16, 14, '#d8d2c2', 'left', lw - 16);
  const groups = new Map<string, {m: MapMarker; n: number}>();
  for (const m of f.markers) { const key = `${m.kind}${m.state}`; const g = groups.get(key); if (g) g.n++; else groups.set(key, {m, n: 1}); }
  const items = [...groups.values()];
  if (!items.length) text(ctx, 'Nothing needed on this floor — pick another floor with the buttons', 18, LY + 44, 14, '#9fb0b8', 'left', lw - 16, 'normal');
  const colW = lw / 2;
  items.slice(0, 8).forEach(({m, n: cnt}, i) => {
    const x = 18 + (i % 2) * colW, y = LY + 40 + Math.floor(i / 2) * 20;
    const st = m.state === 'done' ? '✓' : m.state === 'use' ? '◯' : 'X';
    const name = m.kind === 'generator' ? `${MARKER_NAME.generator}${m.state === 'done' ? ' (running)' : ' (start it)'}` : MARKER_NAME[m.kind];
    text(ctx, `${st} ${MARKER_LETTER[m.kind]}  ${name}${cnt > 1 ? ` ×${cnt}` : ''}`, x, y, 14, m.state === 'done' ? '#63d36e' : m.state === 'use' ? '#e8b13a' : '#ff6a50', 'left', colW - 12);
  });
  ctx.restore();
}

/** One marker: an X (needed), a check (done) or an amber ring (carried: use here), with its letter tag. */
function marker(ctx: Ctx, x: number, y: number, m: MapMarker): void {
  const s = 9;
  ctx.lineWidth = 4;
  if (m.state === 'done') {
    ctx.strokeStyle = '#63d36e';
    ctx.beginPath(); ctx.moveTo(x - s, y); ctx.lineTo(x - s * 0.3, y + s * 0.8); ctx.lineTo(x + s, y - s); ctx.stroke();
  } else {
    ctx.strokeStyle = '#120a08'; ctx.lineWidth = 7;
    ctx.beginPath(); ctx.moveTo(x - s, y - s); ctx.lineTo(x + s, y + s); ctx.moveTo(x + s, y - s); ctx.lineTo(x - s, y + s); ctx.stroke();
    ctx.strokeStyle = m.state === 'use' ? '#e8b13a' : '#ff4a32'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(x - s, y - s); ctx.lineTo(x + s, y + s); ctx.moveTo(x + s, y - s); ctx.lineTo(x - s, y + s); ctx.stroke();
    if (m.state === 'use') { ctx.beginPath(); ctx.arc(x, y, s * 1.6, 0, Math.PI * 2); ctx.stroke(); }
  }
  const tag = MARKER_LETTER[m.kind] + (m.kind === 'generator' && m.id !== undefined ? String(m.id + 1) : '');
  ctx.fillStyle = 'rgba(10,14,16,0.85)'; ctx.fillRect(x + s + 2, y - s - 10, 10 + tag.length * 9, 18);
  text(ctx, tag, x + s + 6, y - s - 1, 14, m.state === 'done' ? '#9fe6a8' : '#ffd2c8', 'left', 40);
}
