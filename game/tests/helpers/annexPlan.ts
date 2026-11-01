// Task studio-alpha-track2-round3-20261031-01 (lane LAYOUT): a CPU TOP-DOWN PLAN of one service annex (evidence only, never in the
// game): the grid raster (rock / core floor / bed / tunnel / annex areas coloured by purpose zone) plus an SVG overlay (doors, room
// labels with their door-hop depth, the hideout outlined). Rendered with sharp (already a dev dependency) into qa-artifacts/.
import {CELL, FLOOR, VOID} from '../../src/gen/grid';
import type {ServiceAnnex} from '../../src/gen/trackExt/types';
import type {StationLayout} from '../../src/gen/stationTypes';

const PURPOSE: Record<string, [string, string]> = {
  'service-corridor': ['#d8cf9c', ''],
  'workshop': ['#6fae5f', 'WS'], 'storage': ['#4f8f45', 'STO'], 'custodial-room': ['#86c27a', 'CUST'], 'first-aid-room': ['#a6e095', 'AID'],
  'electrical-room': ['#e8b04a', 'ELEC'], 'generator-room': ['#d07a1a', 'GEN'], 'turbine-hall': ['#9c5a2c', 'TURB'],
  'pump-room': ['#79b4e0', 'PUMP'], 'sewage-room': ['#3f7dbd', 'SEW'], 'overflow-chamber': ['#2c5d99', 'OVF'], 'spillway': ['#22487d', 'SPILL'],
  'boiler-room': ['#c4403c', 'BOIL'], 'ventilation-plant': ['#3cb4b0', 'VENT'],
  'janitor-closet': ['#b7c7a6', 'jan'], 'supply-closet': ['#c9c2a3', 'sup'], 'electrical-closet': ['#eccb86', 'ecl'],
};
const hex = (h: string): [number, number, number] => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

/** The legend rows (colour, label) of the plan pictures. */
export const PLAN_LEGEND = Object.entries(PURPOSE).map(([pid, [c, l]]) => ({pid, colour: c, label: l || 'corridor'}));

/**
 * Renders one annex's plan to a PNG buffer. `px` pixels per grid cell (0.5 m). `title` is drawn in the top-left corner.
 */
export async function annexPlanPng(layout: StationLayout, n: ServiceAnnex, title: string, px = 6): Promise<Buffer> {
  const sharp = (await import('sharp')).default;
  const g = layout.grid, ids = new Set(n.areas);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const id of n.areas) { const a = layout.areas[id]; x0 = Math.min(x0, a.x); y0 = Math.min(y0, a.y); x1 = Math.max(x1, a.x + a.w); y1 = Math.max(y1, a.y + a.h); }
  const d0 = layout.doors[n.door];
  x0 = Math.min(x0, d0.x - 8); y0 = Math.min(y0, d0.y - 8); x1 = Math.max(x1, d0.x + d0.w + 8); y1 = Math.max(y1, d0.y + d0.h + 8);
  const M = 6, TOP = 34;
  x0 = Math.max(0, x0 - M); y0 = Math.max(0, y0 - M); x1 = Math.min(g.w, x1 + M); y1 = Math.min(g.h, y1 + M);
  const W = (x1 - x0) * px, H = (y1 - y0) * px + TOP;
  const buf = Buffer.alloc(W * H * 4);
  for (let i = 0; i < W * H; i++) { buf[i * 4] = 24; buf[i * 4 + 1] = 24; buf[i * 4 + 2] = 26; buf[i * 4 + 3] = 255; }
  const hid = (n as ServiceAnnex & {hideout?: number}).hideout;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = g.idx(x, y), ar = g.area[i], a = ar >= 0 ? layout.areas[ar] : undefined;
    let c: [number, number, number] = [44, 44, 46];
    if (g.cells[i] === VOID) c = [20, 22, 44];
    else if (g.cells[i] === FLOOR) {
      if (a && ids.has(a.id)) c = hex(PURPOSE[a.purpose ?? '']?.[0] ?? '#bbbbbb');
      else if (a?.ext === 'tunnel') c = [96, 98, 118];
      else if (a?.ext === 'annex') c = [110, 90, 110];
      else c = [78, 78, 80];
    }
    if (g.blocked[i] && a && ids.has(a.id)) c = [Math.round(c[0] * 0.72), Math.round(c[1] * 0.72), Math.round(c[2] * 0.72)];
    for (let yy = 0; yy < px; yy++) for (let xx = 0; xx < px; xx++) {
      const o = (((y - y0) * px + yy + TOP) * W + (x - x0) * px + xx) * 4;
      buf[o] = c[0]; buf[o + 1] = c[1]; buf[o + 2] = c[2];
    }
  }
  const sx = (x: number) => (x - x0) * px, sy = (y: number) => (y - y0) * px + TOP;
  const parts: string[] = [];
  for (const d of layout.doors) {
    if (!ids.has(d.a) && !ids.has(d.b)) continue;
    parts.push(`<rect x="${sx(d.x)}" y="${sy(d.y)}" width="${d.w * px}" height="${d.h * px}" fill="#ffffff" fill-opacity="0.9"/>`);
  }
  for (const id of n.areas) {
    const a = layout.areas[id], [col, lab] = PURPOSE[a.purpose ?? ''] ?? ['#bbb', a.purpose ?? '?'];
    void col;
    const cx = sx(a.x + a.w / 2), cy = sy(a.y + a.h / 2);
    if (id === hid) parts.push(`<rect x="${sx(a.x) + 2}" y="${sy(a.y) + 2}" width="${a.w * px - 4}" height="${a.h * px - 4}" fill="none" stroke="#ff2bd6" stroke-width="4"/>`);
    if (a.extHall) parts.push(`<rect x="${sx(a.x) + 1}" y="${sy(a.y) + 1}" width="${a.w * px - 2}" height="${a.h * px - 2}" fill="none" stroke="#ffffff" stroke-width="1.5" stroke-dasharray="6 4"/>`);
    const fs = a.kind === 'service' ? 10 : Math.max(9, Math.min(15, Math.min(a.w, a.h) * px / 3));
    const text = a.kind === 'service' ? `${a.depth}` : `${lab}${id === hid ? '*' : ''} ${a.depth}`;
    parts.push(`<text x="${cx}" y="${cy + fs / 3}" font-family="DejaVu Sans, sans-serif" font-size="${fs}" text-anchor="middle" fill="${a.kind === 'service' ? '#5a5030' : '#ffffff'}" stroke="${a.kind === 'service' ? 'none' : '#000'}" stroke-width="${a.kind === 'service' ? 0 : 0.6}">${text}</text>`);
  }
  parts.push(`<text x="8" y="22" font-family="DejaVu Sans, sans-serif" font-size="15" fill="#ffffff">${title} — ${Math.round(n.areaM2)} m², ${n.areas.length} areas (1 cell = ${CELL} m; label = purpose + door-hop depth; * magenta = hideout; dashed = hall)</text>`);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${parts.join('')}</svg>`;
  return sharp(buf, {raw: {width: W, height: H, channels: 4}}).composite([{input: Buffer.from(svg), top: 0, left: 0}]).png().toBuffer();
}
