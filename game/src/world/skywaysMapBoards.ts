// Task studio-skyways-rework-20261107-054512-01 (lane MAPS): draws the Skyways LOCAL DIRECTORY BOARDS (`skywaysMapBoard`,
// gen/skyways/mapBoardKind.ts; placed by gen/skyways/mapBoards.ts) — called by world/builder.ts for that kind only (one tagged line).
//
//  - BODY: procedural geometry in the existing shape materials (a steel ring rim, a painted-steel drum, one column, a round base plate),
//    merged per material and instanced per storey (`prop-skywaysMapBoard-<material>`: damage marks / the culler find each instance).
//  - FACE: a code-drawn plan of THIS generated network (world/skywaysMapPlan.ts): a per-layout, runtime-composited DATA texture (the
//    Codex rule's dynamic exemption — nothing here is authored art), modelled on the mall directory (world/mallArch.ts
//    directoryPlanTexture: canvas, fonts, palette) and adapted to a round face. ONE face texture per STOREY (its own spaces solid, the
//    other storeys faint, every network line, run and destination), shared by that storey's boards (one instanced face per storey).
//  - Each board's OWN part — the YOU ARE HERE marker at its projected position and its floor context line ("You are on the +15 Skyway
//    level, <building>") — is a small quad over the face from ONE shared overlay atlas (marker sprites + one strip per distinct line),
//    merged into one mesh per storey. So a map of N boards costs storeys x (2 body + 1 face + 1 overlay) draws and storeys + 1 textures.
//  - drawSkywaysBoardComposite draws the same face with one board's marker and strip into any 2D canvas (the close-up / QA).
// Textures and materials are released with the world (the face meshes' dispose event: game.ts leaveSection disposes instanced meshes).
// Every mesh carries userData.level (the level culler).

import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import type {PropPlacement} from '../gen/props';
import type {StationLayout} from '../gen/stationTypes';
import {SKYWAYS_MAP_BOARD} from '../gen/skyways/mapBoardKind';
import {mulberry32} from '../core/rng';
import {shapeMaterials} from './shapeMaterials';
import {SurfaceNodeMaterial, type WorldMaterials} from './materials';
import {skywaysBoardHere, skywaysMapPlan, storeyTag, type MapLabel, type MapSpaceKind, type SkywaysBoardHere, type SkywaysMapPlan} from './skywaysMapPlan';

type Ctx = CanvasRenderingContext2D;

/** The face canvas (px, square; the printed circle fills it) and its regions (px). */
export const MAP_FACE = {
  px: 1024,
  /** Printed circle radius (the rim's lip hides the outer few px). */
  r: 506,
  /** The plan: fitted inside this circle, at most maxW x maxH. */
  plan: {cx: 512, cy: 474, r: 432, maxW: 850, maxH: 600},
  header: {title: 92, sub: 130},
  north: {x: 814, y: 138, r: 24},
  legendY: 800,
  /** The floor context strip (each board's own: an overlay quad). */
  strip: {x: 222, y: 826, w: 580, h: 80},
  /** The YOU ARE HERE sprite (dot + label plate; an overlay quad, the dot at the board's projected position). */
  marker: {w: 262, h: 62, dot: 31},
} as const;

const FONT = '"Helvetica Neue", Arial, sans-serif';
const PAL = {
  face: '#1a222a', city: '#141b22', street: '#1d262e', streetLine: '#2b3640',
  building: '#232e38', buildingEdge: '#5a6d7d', name: '#e9eef1',
  skyway: '#5fd3c6', pedway: '#e3a63c', here: '#e23b2e',
  text: '#eef2f4', dim: '#93a1ac', plate: 'rgba(9,13,17,0.74)',
} as const;
/** Fill of a space on its own storey (solid) by kind. */
export const SPACE_FILL: Readonly<Record<MapSpaceKind, string>> = {
  hub: '#4d7385', shop: '#2c3843', anchor: '#7a5f30', food: '#76462f', washroom: '#2f5d80', event: '#5f4276', office: '#3d4c66', platform: '#46525c',
  stair: '#5a6874', pedway: '#6d5a26', bridge: '#2f7c80',
};
/** The faint fill of another storey's public space. */
export const OTHER_STOREY_FILL = 'rgba(130,165,185,0.10)';
/** The chip colour of a destination label by kind. */
const CHIP: Readonly<Record<MapLabel['kind'], string>> = {event: '#b67fe2', anchor: '#e0a945', office: '#93acd8', landmark: '#8fd27a', restaurant: '#e7684c', food: '#ec8c3a', station: '#4aa3e0'};
const LABEL_ORDER: readonly MapLabel['kind'][] = ['station', 'event', 'landmark', 'anchor', 'office', 'restaurant', 'food'];

// ---------------------------------------------------------------------------------------------
// Projection (north up: canvas x = world x, canvas y = world z; z is south)

export interface FaceProjector { k: number; X(x: number): number; Y(z: number): number; box: {x0: number; y0: number; x1: number; y1: number} }

/** The plan of a storey's face fitted into the face's plan circle (its whole bounds box inside, aspect kept). */
export function faceProjector(plan: SkywaysMapPlan, level: number): FaceProjector {
  const pad = 3, b = plan.boundsOf[level] ?? plan.bounds;
  const bw = Math.max(1, b.x1 - b.x0 + 2 * pad), bh = Math.max(1, b.z1 - b.z0 + 2 * pad), a = bw / bh, P = MAP_FACE.plan;
  let w = Math.min(P.maxW, 2 * P.r * a / Math.sqrt(1 + a * a)), h = w / a;
  if (h > P.maxH) { h = P.maxH; w = h * a; }
  const k = w / bw, x0 = P.cx - w / 2, y0 = P.cy - h / 2;
  return {k, X: x => x0 + (x - b.x0 + pad) * k, Y: z => y0 + (z - b.z0 + pad) * k, box: {x0, y0, x1: x0 + w, y1: y0 + h}};
}

/** A board's YOU ARE HERE point on its face (px). */
export function hereOnFace(plan: SkywaysMapPlan, here: {x: number; z: number; level: number}): {x: number; y: number} {
  const P = faceProjector(plan, here.level);
  return {x: P.X(here.x), y: P.Y(here.z)};
}

// ---------------------------------------------------------------------------------------------
// Drawing helpers (only what every Canvas 2D backend and the Node test shim support)

function rrect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r); ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h); ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
}
const dash = (ctx: Ctx, d: number[]) => (ctx as Ctx & {setLineDash?: (d: number[]) => void}).setLineDash?.(d);
const text = (ctx: Ctx, s: string, x: number, y: number, font: string, fill: string, align: CanvasTextAlign = 'left') => {
  ctx.font = font; ctx.fillStyle = fill; ctx.textAlign = align; ctx.textBaseline = 'middle'; ctx.fillText(s, x, y);
};
const disc = (ctx: Ctx, x: number, y: number, r: number, fill: string) => { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill(); };

/** Stair / escalator glyph in a rounded chip (centre x, y; size s). */
function runIcon(ctx: Ctx, x: number, y: number, s: number, kind: 'stairs' | 'escalator' | 'mixed', alpha = 1): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  rrect(ctx, x - s / 2, y - s / 2, s, s, s * 0.22); ctx.fillStyle = '#d9dee2'; ctx.fill();
  ctx.strokeStyle = '#1b232a'; ctx.lineWidth = Math.max(1.5, s * 0.1); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const q = s * 0.3;
  if (kind === 'escalator') {
    ctx.beginPath(); ctx.moveTo(x - q, y + q); ctx.lineTo(x + q, y - q); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x + q, y - q); ctx.lineTo(x + q * 0.1, y - q); ctx.moveTo(x + q, y - q); ctx.lineTo(x + q, y - q * 0.1); ctx.stroke();
  } else {
    ctx.beginPath(); ctx.moveTo(x - q, y + q);
    for (let i = 0; i < 3; i++) { const sx = x - q + (2 * q / 3) * i, sy = y + q - (2 * q / 3) * i; ctx.lineTo(sx, sy - 2 * q / 3); ctx.lineTo(sx + 2 * q / 3, sy - 2 * q / 3); }
    ctx.stroke();
    if (kind === 'mixed') { ctx.beginPath(); ctx.moveTo(x - q, y - q * 0.2); ctx.lineTo(x - q * 0.2, y - q); ctx.stroke(); }
  }
  ctx.restore();
}

/** The destination chip of a label kind (a small coloured symbol). */
function chip(ctx: Ctx, kind: MapLabel['kind'], x: number, y: number, s: number, alpha = 1): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  const c = CHIP[kind];
  if (kind === 'landmark') {
    // a five-point star
    ctx.beginPath();
    for (let i = 0; i < 10; i++) { const r = i % 2 ? s * 0.24 : s * 0.55, a = -Math.PI / 2 + i * Math.PI / 5; const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r; if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); }
    ctx.closePath(); ctx.fillStyle = c; ctx.fill();
  } else if (kind === 'station') {
    // a rounded square with a train front (two windows, a bumper)
    rrect(ctx, x - s / 2, y - s / 2, s, s, s * 0.25); ctx.fillStyle = c; ctx.fill();
    ctx.fillStyle = '#0f1820'; ctx.fillRect(x - s * 0.3, y - s * 0.28, s * 0.25, s * 0.22); ctx.fillRect(x + s * 0.05, y - s * 0.28, s * 0.25, s * 0.22);
    ctx.fillRect(x - s * 0.3, y + s * 0.12, s * 0.6, s * 0.1);
  } else if (kind === 'restaurant' || kind === 'food') {
    disc(ctx, x, y, s * 0.5, c);
    ctx.strokeStyle = '#2a1a12'; ctx.lineWidth = Math.max(1.2, s * 0.09);
    ctx.beginPath(); ctx.moveTo(x - s * 0.18, y - s * 0.28); ctx.lineTo(x - s * 0.18, y + s * 0.28); ctx.moveTo(x + s * 0.16, y - s * 0.28); ctx.lineTo(x + s * 0.16, y + s * 0.28); ctx.stroke();
  } else if (kind === 'event') {
    ctx.beginPath(); ctx.moveTo(x, y - s * 0.55); ctx.lineTo(x + s * 0.55, y); ctx.lineTo(x, y + s * 0.55); ctx.lineTo(x - s * 0.55, y); ctx.closePath(); ctx.fillStyle = c; ctx.fill();
  } else {
    rrect(ctx, x - s * 0.45, y - s * 0.45, s * 0.9, s * 0.9, s * 0.12); ctx.fillStyle = c; ctx.fill();
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------------------------
// The storey face (shared by every board of the storey)

interface Box { x0: number; y0: number; x1: number; y1: number }
const hit = (a: Box, b: Box) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;

/** Draws the storey face of the plan (everything but a board's own marker and context strip). */
export function drawSkywaysMapFace(ctx: Ctx, plan: SkywaysMapPlan, level: number, seed: number): void {
  const S = MAP_FACE.px, C = S / 2, R = MAP_FACE.r, rnd = mulberry32(seed);
  const P = faceProjector(plan, level), X = P.X, Y = P.Y, k = P.k;
  // ground: the dark face, a darker ring at the rim
  ctx.fillStyle = '#0d1115'; ctx.fillRect(0, 0, S, S);
  disc(ctx, C, C, R, PAL.face);
  // the plan's city: the plan circle's ground, the streets
  const PC = MAP_FACE.plan;
  disc(ctx, PC.cx, PC.cy, PC.r + 22, PAL.city);
  ctx.save();
  ctx.beginPath(); ctx.arc(PC.cx, PC.cy, PC.r + 22, 0, Math.PI * 2);
  (ctx as Ctx & {clip?: () => void}).clip?.();
  for (const st of plan.streets) {
    const r = st.rect;
    ctx.fillStyle = PAL.street; ctx.fillRect(X(r.x0), Y(r.z0), (r.x1 - r.x0) * k, (r.z1 - r.z0) * k);
    ctx.strokeStyle = PAL.streetLine; ctx.lineWidth = 1.5; dash(ctx, [10, 9]);
    ctx.beginPath();
    if (st.axis === 'x') { const y = Y((r.z0 + r.z1) / 2); ctx.moveTo(X(r.x0), y); ctx.lineTo(X(r.x1), y); } else { const x = X((r.x0 + r.x1) / 2); ctx.moveTo(x, Y(r.z0)); ctx.lineTo(x, Y(r.z1)); }
    ctx.stroke(); dash(ctx, []);
  }
  ctx.restore();
  // building footprints
  for (const b of plan.buildings) {
    const r = b.rect, x = X(r.x0), y = Y(r.z0), w = (r.x1 - r.x0) * k, h = (r.z1 - r.z0) * k;
    ctx.fillStyle = PAL.building; ctx.fillRect(x, y, w, h);
  }
  // the other storeys' public spaces, faint; this storey's, solid
  for (const s of plan.spaces) {
    if (s.level === level || s.kind === 'platform' || s.kind === 'stair') continue;
    ctx.fillStyle = OTHER_STOREY_FILL;
    ctx.fillRect(X(s.rect.x0), Y(s.rect.z0), (s.rect.x1 - s.rect.x0) * k, (s.rect.z1 - s.rect.z0) * k);
  }
  for (const s of plan.spaces) {
    if (s.level !== level) continue;
    ctx.fillStyle = SPACE_FILL[s.kind];
    ctx.fillRect(X(s.rect.x0), Y(s.rect.z0), (s.rect.x1 - s.rect.x0) * k, (s.rect.z1 - s.rect.z0) * k);
    if (s.kind === 'shop' || s.kind === 'anchor' || s.kind === 'food' || s.kind === 'washroom' || s.kind === 'event' || s.kind === 'office') {
      ctx.strokeStyle = 'rgba(150,175,190,0.45)'; ctx.lineWidth = 1;
      ctx.strokeRect(X(s.rect.x0) + 0.5, Y(s.rect.z0) + 0.5, (s.rect.x1 - s.rect.x0) * k - 1, (s.rect.z1 - s.rect.z0) * k - 1);
    }
  }
  for (const b of plan.buildings) {
    const r = b.rect;
    ctx.strokeStyle = PAL.buildingEdge; ctx.lineWidth = 2;
    ctx.strokeRect(X(r.x0), Y(r.z0), (r.x1 - r.x0) * k, (r.z1 - r.z0) * k);
  }
  // the network: the pedways (concourse storey) dashed amber, the +15 skyway teal; this storey's lines bold, the others thinner
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const pass of ['pedway', 'skyway'] as const) for (const l of plan.lines) {
    if (l.kind !== pass || l.pts.length < 2) continue;
    const own = l.level === level;
    ctx.save();
    ctx.globalAlpha = own ? 1 : 0.5;
    ctx.strokeStyle = pass === 'skyway' ? PAL.skyway : PAL.pedway;
    ctx.lineWidth = own ? 7 : 4;
    if (pass === 'pedway') dash(ctx, [14, 9]);
    ctx.beginPath(); l.pts.forEach((p, i) => (i ? ctx.lineTo(X(p.x), Y(p.z)) : ctx.moveTo(X(p.x), Y(p.z)))); ctx.stroke();
    ctx.restore();
    if (own && pass === 'skyway') for (const p of [l.pts[0], l.pts[l.pts.length - 1]]) { disc(ctx, X(p.x), Y(p.z), 6, PAL.skyway); disc(ctx, X(p.x), Y(p.z), 3, PAL.face); }
  }
  dash(ctx, []);
  // reserved boxes for the label placement: the run icons (fixed spots) first, then the building names (a free corner of the footprint)
  const taken: Box[] = [];
  // (labels stay inside the plan circle, under the header and above the legend row)
  const inPlan = (b: Box) => b.y0 >= MAP_FACE.header.sub + 26 && b.y1 <= MAP_FACE.legendY - 16 && [[b.x0, b.y0], [b.x1, b.y0], [b.x0, b.y1], [b.x1, b.y1]].every(([x, y]) => Math.hypot(x - PC.cx, y - PC.cy) <= PC.r + 30);
  const free = (b: Box) => !taken.some(t => hit(t, b));
  for (const run of plan.runs) {
    if (run.lower !== level && run.upper !== level) continue;
    const x = X(run.x), y = Y(run.z), s = 20;
    runIcon(ctx, x, y, s, run.kind);
    // a small up / down tick: where it goes from here
    text(ctx, run.upper === level ? '▼' : '▲', x + s / 2 + 7, y, `bold 11px ${FONT}`, '#d9dee2', 'center');
    taken.push({x0: x - s / 2 - 1, y0: y - s / 2 - 1, x1: x + s / 2 + 13, y1: y + s / 2 + 1});
  }
  for (const b of plan.buildings) {
    const r = b.rect, w = (r.x1 - r.x0) * k - 12;
    const name = b.name.toUpperCase();
    let fs = 19;
    ctx.font = `bold ${fs}px ${FONT}`;
    while (fs > 12 && ctx.measureText(name).width > w) { fs--; ctx.font = `bold ${fs}px ${FONT}`; }
    const lines = ctx.measureText(name).width > w && name.includes(' ') ? [name.slice(0, name.lastIndexOf(' ')), name.slice(name.lastIndexOf(' ') + 1)] : [name];
    const tw = Math.min(w, Math.max(...lines.map(q => ctx.measureText(q).width))), th = lines.length * (fs + 3) + 4, bw = tw + (b.station ? 32 : 6) + 3;
    const corners = [[X(r.x0) + 6, Y(r.z0) + 6], [X(r.x1) - 6 - bw + 3, Y(r.z0) + 6], [X(r.x0) + 6, Y(r.z1) - 6 - th + 2], [X(r.x1) - 6 - bw + 3, Y(r.z1) - 6 - th + 2]];
    const boxAt = ([x, y]: number[]): Box => ({x0: x - 3, y0: y - 2, x1: x - 3 + bw, y1: y - 2 + th});
    const [x, y] = corners.find(c => free(boxAt(c))) ?? corners[0];
    rrect(ctx, x - 3, y - 2, tw + 8, th, 4); ctx.fillStyle = 'rgba(9,13,17,0.62)'; ctx.fill();
    lines.forEach((q, i) => text(ctx, q, x + 1, y + fs / 2 + 1 + i * (fs + 3), `bold ${fs}px ${FONT}`, PAL.name));
    if (b.station) chip(ctx, 'station', x + tw + 18, y + fs / 2 + 1, 18);
    taken.push(boxAt([x, y]));
  }
  // washrooms on this storey: a small WC chip (no text)
  for (const s of plan.spaces) {
    if (s.level !== level || s.kind !== 'washroom') continue;
    const cx = X((s.rect.x0 + s.rect.x1) / 2), cy = Y((s.rect.z0 + s.rect.z1) / 2);
    // (inside the washroom's own rect when it is big enough; never over a name / icon)
    const spot = [[0, 0], [0, 14], [0, -14], [16, 0], [-16, 0]].map(([dx, dy]) => ({x: cx + dx, y: cy + dy})).find(q => !taken.some(t => hit(t, {x0: q.x - 13, y0: q.y - 9, x1: q.x + 13, y1: q.y + 9})));
    if (!spot) continue;
    rrect(ctx, spot.x - 13, spot.y - 9, 26, 18, 4); ctx.fillStyle = '#9fc6d8'; ctx.fill();
    text(ctx, 'WC', spot.x, spot.y + 0.5, `bold 11px ${FONT}`, '#14212b', 'center');
    taken.push({x0: spot.x - 13, y0: spot.y - 9, x1: spot.x + 13, y1: spot.y + 9});
  }
  // destination labels: this storey's bright on plates, the other storeys' dim with their storey tag; no overlaps
  const own = plan.labels.filter(l => l.level === level).sort((a, b) => LABEL_ORDER.indexOf(a.kind) - LABEL_ORDER.indexOf(b.kind));
  const others = plan.labels.filter(l => l.level !== level && !own.some(o => o.text === l.text)).sort((a, b) => LABEL_ORDER.indexOf(a.kind) - LABEL_ORDER.indexOf(b.kind));
  const seen = new Set<string>();
  for (const [list, bright] of [[own, true], [others, false]] as const) for (const l of list) {
    const key = `${l.text}|${bright}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const x = X(l.x), y = Y(l.z), cs = bright ? 16 : 12;
    const str = bright ? l.text : `${l.text} (${storeyTag(l.level)})`;
    let placed = false;
    for (const fs of bright ? [16, 14, 12] : [13, 12]) {
      const font = `${bright ? '600 ' : ''}${fs}px ${FONT}`;
      ctx.font = font;
      const tw = ctx.measureText(str).width, th = fs + 8;
      const chipBox = {x0: x - cs / 2, y0: y - cs / 2, x1: x + cs / 2, y1: y + cs / 2};
      // the chip marks the spot (never on a name, an icon or another label); when the spot is taken, a plate alone just beside it
      const chipOk = free(chipBox), w = tw + 10;
      const tries: Box[] = chipOk ? [
        {x0: x + cs / 2 + 3, y0: y - th / 2, x1: x + cs / 2 + 3 + w, y1: y + th / 2},
        {x0: x - cs / 2 - 3 - w, y0: y - th / 2, x1: x - cs / 2 - 3, y1: y + th / 2},
        {x0: x - w / 2, y0: y + cs / 2 + 2, x1: x + w / 2, y1: y + cs / 2 + 2 + th},
        {x0: x - w / 2, y0: y - cs / 2 - 2 - th, x1: x + w / 2, y1: y - cs / 2 - 2},
      ] : [0, th + 2, -(th + 2), 2 * (th + 2), -2 * (th + 2)].map(dy => ({x0: x - w / 2, y0: y - th / 2 + dy, x1: x + w / 2, y1: y + th / 2 + dy}));
      const box = tries.find(b => inPlan(b) && free(b));
      if (!box) continue;
      if (chipOk) { chip(ctx, l.kind, x, y, cs, bright ? 1 : 0.6); taken.push(chipBox); }
      rrect(ctx, box.x0, box.y0, box.x1 - box.x0, box.y1 - box.y0, 4); ctx.fillStyle = bright ? PAL.plate : 'rgba(9,13,17,0.45)'; ctx.fill();
      text(ctx, str, box.x0 + 5, (box.y0 + box.y1) / 2 + 0.5, font, bright ? PAL.text : PAL.dim);
      taken.push(box);
      placed = true;
      break;
    }
    // (no free spot: this storey's destination keeps its chip — never an overlapping label; another storey's is left out)
    if (!placed && bright) {
      const cb = {x0: x - cs / 2, y0: y - cs / 2, x1: x + cs / 2, y1: y + cs / 2};
      if (free(cb)) { chip(ctx, l.kind, x, y, cs); taken.push(cb); }
    }
  }
  // header: the complex's name, what this is, this storey
  text(ctx, plan.name.toUpperCase(), C, MAP_FACE.header.title, `bold 40px ${FONT}`, '#f2f4f5', 'center');
  text(ctx, 'PEDWAY · STREET · SKYWALK DIRECTORY', C, MAP_FACE.header.sub, `600 17px ${FONT}`, PAL.skyway, 'center');
  {
    const lab = `THIS LEVEL · ${(plan.storeys.find(s => s.level === level)?.label ?? `Level ${level}`).toUpperCase()}`;
    ctx.font = `bold 15px ${FONT}`;
    const w = ctx.measureText(lab).width + 22, x = 252 - w / 2, y = 150;
    rrect(ctx, x, y - 14, w, 28, 14); ctx.fillStyle = '#26404a'; ctx.fill();
    text(ctx, lab, x + w / 2, y + 0.5, `bold 15px ${FONT}`, '#bfeee8', 'center');
  }
  // north arrow
  {
    const {x, y, r} = MAP_FACE.north;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.strokeStyle = '#c9d2d8'; ctx.lineWidth = 2; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x, y - r + 4); ctx.lineTo(x + r * 0.42, y + r * 0.35); ctx.lineTo(x, y + r * 0.12); ctx.lineTo(x - r * 0.42, y + r * 0.35); ctx.closePath();
    ctx.fillStyle = '#e9eef1'; ctx.fill();
    text(ctx, 'N', x, y - r - 12, `bold 16px ${FONT}`, '#e9eef1', 'center');
  }
  // legend
  {
    const y = MAP_FACE.legendY;
    const items: [string, (x: number) => void][] = [
      ['Skywalk', x => { ctx.strokeStyle = PAL.skyway; ctx.lineWidth = 6; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 26, y); ctx.stroke(); }],
      ['Pedway', x => { ctx.strokeStyle = PAL.pedway; ctx.lineWidth = 5; dash(ctx, [8, 5]); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 26, y); ctx.stroke(); dash(ctx, []); }],
      ['Stairs', x => runIcon(ctx, x + 11, y, 20, 'stairs')],
      ['Escalators', x => runIcon(ctx, x + 11, y, 20, 'escalator')],
      ['You are here', x => { disc(ctx, x + 11, y, 9, '#ffffff'); disc(ctx, x + 11, y, 6.5, PAL.here); }],
    ];
    ctx.font = `14px ${FONT}`;
    const widths = items.map(([t]) => 34 + ctx.measureText(t).width + 18);
    let x = C - widths.reduce((s, w) => s + w, 0) / 2;
    items.forEach(([t, icon], i) => { icon(x); text(ctx, t, x + 33, y + 0.5, `14px ${FONT}`, '#c4ccd2'); x += widths[i]; });
  }
  // the context strip's place stays dark (each board's own strip is laid over it)
  {
    const s = MAP_FACE.strip;
    rrect(ctx, s.x, s.y, s.w, s.h, 10); ctx.fillStyle = '#10161b'; ctx.fill();
  }
  ageFace(ctx, rnd);
}

/** Thirty years on: dust toward the rim, grime from the bottom, scratches, a hairline crack, specks (never hiding the plan). */
function ageFace(ctx: Ctx, rnd: () => number): void {
  const S = MAP_FACE.px, C = S / 2, R = MAP_FACE.r;
  const g = ctx.createRadialGradient(C, C, R * 0.55, C, C, R);
  g.addColorStop(0, 'rgba(60,52,40,0)'); g.addColorStop(1, 'rgba(60,52,40,0.28)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
  const gb = ctx.createLinearGradient(0, S * 0.62, 0, S);
  gb.addColorStop(0, 'rgba(40,34,26,0)'); gb.addColorStop(1, 'rgba(40,34,26,0.32)');
  ctx.fillStyle = gb; ctx.fillRect(0, 0, S, S);
  ctx.lineCap = 'round';
  for (let i = 0; i < 26; i++) {
    const a = rnd() * Math.PI * 2, d = rnd() * R * 0.92, x = C + Math.cos(a) * d, y = C + Math.sin(a) * d, l = 20 + rnd() * 110, t = rnd() * Math.PI;
    ctx.strokeStyle = `rgba(220,226,230,${0.05 + rnd() * 0.09})`; ctx.lineWidth = 0.8 + rnd();
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(t) * l, y + Math.sin(t) * l); ctx.stroke();
  }
  // one hairline crack from the rim inward
  {
    const a = rnd() * Math.PI * 2;
    let x = C + Math.cos(a) * R, y = C + Math.sin(a) * R;
    ctx.strokeStyle = 'rgba(225,232,236,0.32)'; ctx.lineWidth = 1.3;
    ctx.beginPath(); ctx.moveTo(x, y);
    const steps = 6 + Math.floor(rnd() * 5);
    for (let i = 0; i < steps; i++) {
      const dir = a + Math.PI + (rnd() - 0.5) * 0.9;
      x += Math.cos(dir) * (14 + rnd() * 22); y += Math.sin(dir) * (14 + rnd() * 22);
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  for (let i = 0; i < 160; i++) {
    const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * R;
    ctx.fillStyle = `rgba(${rnd() < 0.5 ? '200,190,170' : '20,18,14'},${0.05 + rnd() * 0.12})`;
    ctx.fillRect(C + Math.cos(a) * d, C + Math.sin(a) * d, 1 + rnd() * 2.5, 1 + rnd() * 2.5);
  }
}

// ---------------------------------------------------------------------------------------------
// A board's own part: the YOU ARE HERE marker and the floor context strip

/** The YOU ARE HERE sprite at (x, y) = its top-left (dot on the left, or on the right when `flip`). */
export function drawHereMarker(ctx: Ctx, x: number, y: number, flip: boolean): void {
  const M = MAP_FACE.marker, cy = y + M.h / 2, dx = flip ? x + M.w - M.dot : x + M.dot;
  ctx.save();
  ctx.beginPath(); ctx.arc(dx, cy, 27, 0, Math.PI * 2); ctx.fillStyle = 'rgba(226,59,46,0.28)'; ctx.fill();
  disc(ctx, dx, cy, 16, '#ffffff'); disc(ctx, dx, cy, 12, PAL.here); disc(ctx, dx, cy, 4, '#ffffff');
  ctx.font = `bold 18px ${FONT}`;
  const tw = ctx.measureText('YOU ARE HERE').width + 16, px = flip ? dx - 22 - tw : dx + 22;
  rrect(ctx, px, cy - 15, tw, 30, 7); ctx.fillStyle = PAL.here; ctx.fill();
  text(ctx, 'YOU ARE HERE', px + tw / 2, cy + 1, `bold 18px ${FONT}`, '#ffffff', 'center');
  ctx.restore();
}

/** The floor context strip at (x, y) (MAP_FACE.strip size). */
export function drawContextStrip(ctx: Ctx, x: number, y: number, here: Pick<SkywaysBoardHere, 'lines'>): void {
  const s = MAP_FACE.strip;
  rrect(ctx, x, y, s.w, s.h, 10); ctx.fillStyle = '#10161b'; ctx.fill();
  ctx.strokeStyle = 'rgba(95,211,198,0.55)'; ctx.lineWidth = 2; rrect(ctx, x + 1.5, y + 1.5, s.w - 3, s.h - 3, 9); ctx.stroke();
  disc(ctx, x + 30, y + s.h / 2, 11, '#ffffff'); disc(ctx, x + 30, y + s.h / 2, 8, PAL.here);
  let fs = 25;
  ctx.font = `600 ${fs}px ${FONT}`;
  while (fs > 16 && ctx.measureText(here.lines[0]).width > s.w - 70) { fs--; ctx.font = `600 ${fs}px ${FONT}`; }
  text(ctx, here.lines[0], x + 52, y + 24, `600 ${fs}px ${FONT}`, '#e9eef1');
  let fb = 27;
  ctx.font = `bold ${fb}px ${FONT}`;
  while (fb > 16 && ctx.measureText(here.lines[1]).width > s.w - 70) { fb--; ctx.font = `bold ${fb}px ${FONT}`; }
  text(ctx, here.lines[1], x + 52, y + 56, `bold ${fb}px ${FONT}`, PAL.skyway);
}

/** Which side the marker's label goes (false: right of the dot) so the sprite stays on the printed circle. */
export function markerFlip(p: {x: number; y: number}): boolean {
  const M = MAP_FACE.marker, C = MAP_FACE.px / 2, R = MAP_FACE.r - 6;
  const fits = (x0: number) => [[x0, p.y - M.h / 2], [x0 + M.w, p.y - M.h / 2], [x0, p.y + M.h / 2], [x0 + M.w, p.y + M.h / 2]].every(([x, y]) => Math.hypot(x - C, y - C) <= R);
  return !fits(p.x - M.dot) && fits(p.x - (M.w - M.dot));
}

/** The whole face of ONE board (its storey face, its marker, its strip) into a MAP_FACE.px canvas: the close-up / QA view. */
export function drawSkywaysBoardComposite(ctx: Ctx, plan: SkywaysMapPlan, here: SkywaysBoardHere, seed: number): void {
  drawSkywaysMapFace(ctx, plan, here.level, seed);
  drawContextStrip(ctx, MAP_FACE.strip.x, MAP_FACE.strip.y, here);
  const p = hereOnFace(plan, here), flip = markerFlip(p), M = MAP_FACE.marker;
  drawHereMarker(ctx, flip ? p.x - (M.w - M.dot) : p.x - M.dot, p.y - M.h / 2, flip);
}

// ---------------------------------------------------------------------------------------------
// Geometry (prop frame: origin bottom centre, front +Z, metres)

const B = SKYWAYS_MAP_BOARD;
const T = B.tilt, ct = Math.cos(T), st = Math.sin(T);
/** Face centre, its in-plane up axis and its normal (prop frame). */
const FC = new THREE.Vector3(0, B.centerY, B.centerZ), EY = new THREE.Vector3(0, ct, -st), EN = new THREE.Vector3(0, st, ct);
/** Face px -> prop frame point, lifted `off` m along the normal. */
export function facePoint(px: number, py: number, off: number): THREE.Vector3 {
  const s = B.faceD / MAP_FACE.px, u = (px - MAP_FACE.px / 2) * s, v = (MAP_FACE.px / 2 - py) * s;
  return FC.clone().addScaledVector(EY, v).addScaledVector(EN, off).add(new THREE.Vector3(u, 0, 0));
}
const toFace = (g: THREE.BufferGeometry) => { g.rotateX(-T); g.translate(FC.x, FC.y, FC.z); return g; };

/** The body parts merged per shape material (prop frame). */
export function skywaysMapBoardBody(): {steelDark: THREE.BufferGeometry; steelBright: THREE.BufferGeometry} {
  const rimR0 = B.faceD / 2 - 0.006, rimR1 = B.rimD / 2;
  const ring = new THREE.LatheGeometry([new THREE.Vector2(rimR0, -B.rimBack), new THREE.Vector2(rimR1, -B.rimBack), new THREE.Vector2(rimR1, B.rimLip), new THREE.Vector2(rimR0, B.rimLip), new THREE.Vector2(rimR0, -B.rimBack)], 56);
  ring.rotateX(Math.PI / 2); toFace(ring);
  const drum = new THREE.CylinderGeometry(B.drumD / 2, B.drumD / 2, B.drumT, 48);
  drum.translate(0, -B.drumT / 2 - 0.001, 0); drum.rotateX(Math.PI / 2); toFace(drum);
  // the column: from the base plate up into the drum's back (its front edge just inside the drum)
  const back = FC.clone().addScaledVector(EN, -B.drumT);
  const colTop = back.y + 0.05, colZ = back.z - B.colR + 0.012, colH = colTop - B.plateT;
  const col = new THREE.CylinderGeometry(B.colR, B.colR * 1.12, colH, 18);
  col.translate(0, B.plateT + colH / 2, colZ);
  const plate = new THREE.CylinderGeometry(B.plateR, B.plateR, B.plateT, 32);
  plate.translate(0, B.plateT / 2, 0);
  const collar = new THREE.CylinderGeometry(B.colR * 1.6, B.colR * 1.8, 0.05, 18);
  collar.translate(0, B.plateT + 0.025, colZ);
  const dark = mergeGeometries([drum, col, plate, collar].map(g => g.toNonIndexed()), false)!;
  for (const g of [drum, col, plate, collar]) g.dispose();
  const bright = ring.toNonIndexed();
  ring.dispose();
  return {steelDark: dark, steelBright: bright};
}

/** The printed face disc (prop frame): uv 0..1 over the face canvas square. */
export function skywaysMapFaceGeometry(): THREE.BufferGeometry {
  const g = new THREE.CircleGeometry(B.faceD / 2, 72);
  g.translate(0, 0, 0.002);
  return toFace(g);
}

// ---------------------------------------------------------------------------------------------
// Build

const placeM = (p: PropPlacement) => new THREE.Matrix4().compose(new THREE.Vector3(p.x, p.y, p.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.rot), new THREE.Vector3(1, 1, 1));
const byLevel = (list: readonly PropPlacement[]) => {
  const m = new Map<number, PropPlacement[]>();
  for (const p of list) { const l = m.get(p.level ?? 0); if (l) l.push(p); else m.set(p.level ?? 0, [p]); }
  return m;
};
const hasCanvas = () => typeof document !== 'undefined' && typeof document.createElement === 'function';
function canvasOf(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}
function faceTexture(c: HTMLCanvasElement): THREE.Texture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.anisotropy = 8;
  return t;
}

/** Build stats of the last call (QA / tests). */
export const SKYWAYS_MAP_BOARD_BUILD = {boards: 0, storeys: 0, textures: 0, meshes: 0, strips: 0};

/** Renders the directory boards (body, storey faces, each board's marker + strip). Returns the instance count. */
export function buildSkywaysMapBoards(group: THREE.Group, list: readonly PropPlacement[], wm: WorldMaterials, layout?: StationLayout): number {
  Object.assign(SKYWAYS_MAP_BOARD_BUILD, {boards: 0, storeys: 0, textures: 0, meshes: 0, strips: 0});
  if (!list.length) return 0;
  const plan = layout ? skywaysMapPlan(layout) : null;
  const pm = shapeMaterials(wm), body = skywaysMapBoardBody(), faceGeo = skywaysMapFaceGeometry();
  const owned: {dispose(): void}[] = [];
  const meshes: THREE.Object3D[] = [];
  const add = (o: THREE.Mesh, level: number, name: string) => { o.name = name; o.userData.level = level; group.add(o); meshes.push(o); SKYWAYS_MAP_BOARD_BUILD.meshes++; };
  const instanced = (geo: THREE.BufferGeometry, mat: THREE.Material, ps: readonly PropPlacement[], level: number, name: string) => {
    geo.computeBoundingSphere();
    const im = new THREE.InstancedMesh(geo, mat, ps.length);
    ps.forEach((p, i) => im.setMatrixAt(i, placeM(p)));
    im.computeBoundingSphere();
    add(im, level, name);
    return im;
  };
  const levels = byLevel(list);
  const canvas = hasCanvas() && !!plan;
  // the overlay atlas: the two marker sprites, then one strip per distinct context line
  const heres = new Map<PropPlacement, SkywaysBoardHere>();
  if (plan) for (const p of list) heres.set(p, skywaysBoardHere(plan, p));
  const lines = [...new Set([...heres.values()].map(h => h.lines.join('\n')))];
  const S = MAP_FACE.strip, M = MAP_FACE.marker, ROW = S.h + 8, AW = 1024, AH = 8 + Math.max(2 * (M.h + 8), lines.length * ROW);
  const stripAt = (i: number) => ({x: 4, y: 4 + i * ROW});
  const markerAt = (flip: boolean) => ({x: AW - M.w - 4, y: 4 + (flip ? M.h + 8 : 0)});
  let atlasMat: THREE.Material | null = null;
  if (canvas) {
    const c = canvasOf(AW, AH), ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, AW, AH);
    lines.forEach((l, i) => { const a = stripAt(i), [l0, l1] = l.split('\n'); drawContextStrip(ctx, a.x, a.y, {lines: [l0, l1]}); });
    for (const flip of [false, true]) { const a = markerAt(flip); drawHereMarker(ctx, a.x, a.y, flip); }
    const tex = faceTexture(c);
    const m = new SurfaceNodeMaterial({map: tex, roughness: 0.34, metalness: 0, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.16, alphaTest: 0.5});
    m.polygonOffset = true; m.polygonOffsetFactor = -2; m.polygonOffsetUnits = -2;
    m.name = 'skyways-map-board-overlay';
    owned.push(tex, m);
    atlasMat = m;
    SKYWAYS_MAP_BOARD_BUILD.textures++;
    SKYWAYS_MAP_BOARD_BUILD.strips = lines.length;
  }
  for (const [level, ps] of [...levels].sort((a, b) => a[0] - b[0])) {
    SKYWAYS_MAP_BOARD_BUILD.storeys++;
    instanced(body.steelDark, pm.steelDark, ps, level, 'prop-skywaysMapBoard-steelDark');
    instanced(body.steelBright, pm.steelBright, ps, level, 'prop-skywaysMapBoard-steelBright');
    // the storey face (one texture per storey)
    let faceMat: THREE.Material;
    if (canvas) {
      const c = canvasOf(MAP_FACE.px, MAP_FACE.px);
      drawSkywaysMapFace(c.getContext('2d')!, plan!, level, 7300 + level * 31 + (layout?.seed ?? 0) % 997);
      const tex = faceTexture(c);
      faceMat = new SurfaceNodeMaterial({map: tex, roughness: 0.3, metalness: 0, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.16});
      owned.push(tex);
      SKYWAYS_MAP_BOARD_BUILD.textures++;
    } else faceMat = new SurfaceNodeMaterial({color: 0x1a222a, roughness: 0.3, metalness: 0});
    faceMat.name = `skyways-map-board-face-L${level}`;
    owned.push(faceMat);
    const face = instanced(faceGeo, faceMat, ps, level, 'prop-skywaysMapBoard-face');
    // (the world's release: game.ts leaveSection disposes the instanced meshes -> this build's textures / materials go with them)
    if (level === Math.min(...levels.keys())) face.addEventListener('dispose', () => { for (const o of owned) o.dispose(); owned.length = 0; });
    // each board's marker + strip: quads over the face, merged per storey
    if (atlasMat && plan) {
      const pos: number[] = [], uv: number[] = [], nor: number[] = [], idx: number[] = [];
      const quad = (m4: THREE.Matrix4, fx: number, fy: number, w: number, h: number, ax: number, ay: number) => {
        const base = pos.length / 3, n = EN.clone().transformDirection(m4);
        for (const [cx, cy] of [[0, 1], [1, 1], [1, 0], [0, 0]] as const) {
          const v = facePoint(fx + cx * w, fy + cy * h, 0.0045).applyMatrix4(m4);
          pos.push(v.x, v.y, v.z); nor.push(n.x, n.y, n.z);
          uv.push((ax + cx * w) / AW, 1 - (ay + cy * h) / AH);
        }
        idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      };
      for (const p of ps) {
        const here = heres.get(p)!, m4 = placeM(p);
        const a = stripAt(lines.indexOf(here.lines.join('\n')));
        quad(m4, S.x, S.y, S.w, S.h, a.x, a.y);
        const q = hereOnFace(plan, here), flip = markerFlip(q), mk = markerAt(flip);
        quad(m4, flip ? q.x - (M.w - M.dot) : q.x - M.dot, q.y - M.h / 2, M.w, M.h, mk.x, mk.y);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      geo.setIndex(idx);
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, atlasMat);
      mesh.matrixAutoUpdate = false;
      add(mesh, level, `skyways-map-board-overlay-L${level}`);
    }
    SKYWAYS_MAP_BOARD_BUILD.boards += ps.length;
  }
  void meshes;
  return list.length;
}
