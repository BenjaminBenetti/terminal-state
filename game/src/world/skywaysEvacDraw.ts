// Task studio-skywalk-events-20261115-193624-01 (layout version 7, lane EVAC): the Evac event's own drawing — its canvas PAINTERS (the
// graphics its kinds' faces name: locally painted per-variant screens / signs / cards — dynamic per-seed text over code shapes) and a
// drawer for any kind that needs more than the generic parts + faces of world/skywaysEventDraw.ts.
//  - 'evac-note': a note's paper (gen/skyways/events/evacNotes.ts by the variant's text index): a printed shelter notice, a lined pad page
//    or a torn scrap, its title / body / signature written in a handwriting-like face (DYNAMIC text over a plain paper fill: no
//    static texture art). The same text world/skywaysNotes.ts shows up close.
//  - 'evac-warn': the quarantine's hand-painted warning (gen/skyways/events/evacKinds.ts EVAC_WARN_TEXTS): letters brushed in red / black
//    over a whitewash coat on the plywood sheet (a plain fill: the sheet's plywood edges are the existing 'wood' shape material).

import type * as THREE from 'three';
import type {PropPlacement} from '../gen/props';
import type {StationLayout} from '../gen/stationTypes';
import {EVAC_NOTES, type EvacNote} from '../gen/skyways/events/evacNotes';
import {EVAC_WARN_TEXTS, evacNoteOf} from '../gen/skyways/events/evacKinds';
import type {WorldMaterials} from './materials';
import type {EventPainter} from './skywaysEventDraw'; // (type only: skywaysEventDraw imports this module's painters)

/** Handwriting-like font stacks (the browser picks the first it has; any cursive / sans fallback). */
export const EVAC_HAND_FONT = '"Segoe Print", "Bradley Hand", "Comic Sans MS", "Chalkboard SE", "Marker Felt", cursive';
const PRINT_FONT = '"Arial Narrow", "Helvetica Neue", Arial, sans-serif';
const TYPE_FONT = '"Courier New", Courier, monospace';
const MARKER_FONT = 'Impact, "Arial Black", "Helvetica Neue", sans-serif';

/** A tiny deterministic jitter stream per variant (no Math.random: the same note always looks the same). */
function jitter(seed: number): () => number {
  let s = (seed * 2654435761 + 0x9e3779b9) >>> 0;
  return () => { s = (s ^ (s << 13)) >>> 0; s = (s ^ (s >>> 17)) >>> 0; s = (s ^ (s << 5)) >>> 0; return (s % 10000) / 10000 - 0.5; };
}

/** Words of `text` wrapped to `maxW` px in the context's current font. */
export function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (line && ctx.measureText(next).width > maxW) { out.push(line); line = word; } else line = next;
    }
    out.push(line);
  }
  return out;
}

/** Sets the largest font (`size` px down to 10) at which one line of `text` fits `maxW` px; returns its size. */
function fitFont(ctx: CanvasRenderingContext2D, text: string, maxW: number, size: number, face: string, style = ''): number {
  let s = Math.round(size);
  for (; s > 10; s--) { ctx.font = `${style}${s}px ${face}`; if (ctx.measureText(text).width <= maxW) break; }
  ctx.font = `${style}${s}px ${face}`;
  return s;
}

/** Draws a note's paper and text (w x h px). */
export function drawEvacNote(ctx: CanvasRenderingContext2D, w: number, h: number, note: EvacNote, seed: number): void {
  const j = jitter(seed + 17);
  const m = w * 0.08;
  // the paper
  if (note.paper === 'notice') {
    ctx.fillStyle = '#f4f2ec'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#1f4e79'; ctx.fillRect(0, 0, w, h * 0.085);
    const head = 'EMERGENCY SHELTER · STAFF NOTICE';
    ctx.fillStyle = '#ffffff'; fitFont(ctx, head, w - m * 1.2, h * 0.04, PRINT_FONT, 'bold '); ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(head, m * 0.6, h * 0.043);
  } else if (note.paper === 'lined') {
    ctx.fillStyle = '#f6efc9'; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(70,110,170,0.45)'; ctx.lineWidth = Math.max(1, h * 0.002);
    for (let y = h * 0.12; y < h; y += h * 0.045) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
    ctx.strokeStyle = 'rgba(190,60,60,0.55)'; ctx.beginPath(); ctx.moveTo(m * 1.3, 0); ctx.lineTo(m * 1.3, h); ctx.stroke();
  } else {
    // a scrap: an off-white sheet folded in four (two faint creases; the whole quad is filled: the face material is opaque)
    ctx.fillStyle = '#ebe6da'; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(120,110,95,0.25)'; ctx.lineWidth = Math.max(1, w * 0.004);
    ctx.beginPath(); ctx.moveTo(0, h * (0.5 + 0.02 * j())); ctx.lineTo(w, h * (0.5 + 0.02 * j())); ctx.moveTo(w * (0.5 + 0.02 * j()), 0); ctx.lineTo(w * (0.5 + 0.02 * j()), h); ctx.stroke();
  }
  // the writing
  const typed = note.paper === 'notice';
  const ink = typed ? '#1d1d1f' : note.voice === 'medic' ? '#1b2f6b' : note.voice === 'maintenance' ? '#3a3a3a' : '#22305e';
  ctx.fillStyle = ink; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  const x0 = note.paper === 'lined' ? m * 1.6 : m, maxW = w - x0 - m * 0.8;
  let y = typed ? h * 0.15 : h * 0.1;
  if (note.title) {
    ctx.font = typed ? `bold ${Math.round(h * 0.05)}px ${PRINT_FONT}` : `bold ${Math.round(h * 0.048)}px ${EVAC_HAND_FONT}`;
    for (const ln of wrapLines(ctx, note.title, maxW)) { ctx.fillText(ln, x0, y); y += h * 0.06; }
    y += h * 0.012;
  }
  const size = Math.round(h * (typed ? 0.036 : 0.04));
  ctx.font = typed ? `${size}px ${TYPE_FONT}` : `${size}px ${EVAC_HAND_FONT}`;
  for (const ln of wrapLines(ctx, note.body, maxW)) {
    ctx.save();
    ctx.translate(x0 + (typed ? 0 : j() * w * 0.01), y);
    if (!typed) ctx.rotate(j() * 0.02);
    ctx.fillText(ln, 0, 0);
    ctx.restore();
    y += h * (typed ? 0.048 : 0.045);
    if (y > h * 0.94) break;
  }
  if (note.sign && y < h * 0.92) {
    const sign = `- ${note.sign}`;
    fitFont(ctx, sign, w - 2 * m, h * 0.038, EVAC_HAND_FONT, 'italic ');
    ctx.textAlign = 'right';
    ctx.fillText(sign, w - m, Math.min(h * 0.94, y + h * 0.05));
  }
}

/** Draws a warning board's painted letters over its whitewash coat. */
export function drawEvacWarn(ctx: CanvasRenderingContext2D, w: number, h: number, variant: number): void {
  const lines = EVAC_WARN_TEXTS[variant % EVAC_WARN_TEXTS.length], j = jitter(variant + 3);
  ctx.fillStyle = '#e4ded0'; ctx.fillRect(0, 0, w, h);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  lines.forEach((ln, k) => {
    // (fitted to the sheet: a wide fallback face shrinks instead of running off the board)
    const size = fitFont(ctx, ln, w * 0.9, h * (k === 0 ? 0.3 : 0.24), MARKER_FONT);
    ctx.fillStyle = k === 0 ? '#b3121b' : '#151515';
    ctx.save();
    ctx.translate(w / 2 + j() * w * 0.02, h * (k === 0 ? 0.34 : 0.72));
    ctx.rotate(j() * 0.06);
    ctx.fillText(ln, 0, 0);
    // a few drips under the letters
    for (let d = 0; d < 4; d++) ctx.fillRect((j() * 0.8) * w, size * 0.35, Math.max(2, w * 0.004), size * (0.15 + 0.3 * (j() + 0.5)));
    ctx.restore();
  });
}

export const EVAC_PAINTERS: Readonly<Record<string, EventPainter>> = {
  'evac-note': {px: [512, 662], draw: (ctx, w, h, variant) => { const n = EVAC_NOTES[evacNoteOf(variant).index]; if (n) drawEvacNote(ctx, w, h, n, variant); }},
  'evac-warn': {px: [768, 512], draw: drawEvacWarn},
};

/** Draws a kind this lane draws itself (returns its instance count), or null (the generic parts + faces: every Evac kind). */
export function drawEvacProp(group: THREE.Group, kind: string, list: readonly PropPlacement[], wm: WorldMaterials, layout?: StationLayout): number | null {
  void group; void kind; void list; void wm; void layout;
  return null;
}
