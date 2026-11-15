// Task studio-skywalk-events-20261115-193624-01 (layout version 7, lane EVAC): the CLOSE-UP READ of the evacuation centre's discoverable
// NOTES (gen/skyways/events/evacKinds.ts `evacNote`; texts gen/skyways/events/evacNotes.ts). installSkywaysNotes(game) is called ONCE
// from the Game constructor and only REGISTERS (inert on every level without `evacNote` placements):
//  - sectionHooks.build: the notes of the layout; teardown closes the view;
//  - frameHooks + promptProviders: standing near a note (within NOTE_READ.reach, on its storey, looking toward it, nothing solid
//    between; a note pinned to a board only from in front of the board) shows "[E] Read the note"; walking off / turning away / leaving
//    play closes an open view;
//  - interactHandlers (E): opens / closes a full-screen view of the note's text on a paper card (a DOM overlay over the game: no input
//    capture; Esc closes it too). Environmental storytelling ONLY: reading unlocks nothing, records nothing, gives no intel or loot.

import type {PropPlacement} from '../gen/props';
import type {StationLayout} from '../gen/stationTypes';
import {CELL, FLOOR} from '../gen/grid';
import {evacNoteOf} from '../gen/skyways/events/evacKinds';
import {EVAC_NOTES, type EvacNote} from '../gen/skyways/events/evacNotes';
import {EVAC_HAND_FONT} from './skywaysEvacDraw';

export const NOTE_READ = {
  /** Horizontal reach (m) from the note. */
  reach: 1.6,
  /** A pinned note: the player stands this far in front of the board's face (m). */
  front: 0.1,
  /** Largest angle (rad) between the view and the direction to the note (horizontal). */
  look: 0.85,
  /** The note's height above the player's feet (m): from the floor (a dropped note) up to a high pin. */
  below: -0.5, above: 2.2,
} as const;

export interface SkywaysNotesHost {
  player: {x: number; y: number; z: number; yaw: number};
  layout: StationLayout;
  state?: string;
  interactHandlers: (() => boolean)[];
  frameHooks: ((dt: number) => void)[];
  sectionHooks: {build?(layout: StationLayout): void; teardown?(): void}[];
  promptProviders?: (() => string | null)[];
}

const runtimes = new WeakMap<object, SkywaysNotes>();
/** The read runtime installed into a host (QA / tests). */
export const skywaysNotesOf = (host: object): SkywaysNotes | undefined => runtimes.get(host);

/** The note a prop shows (its text index / pinned flag from the variant). */
export const noteOfProp = (p: PropPlacement): EvacNote | undefined => EVAC_NOTES[evacNoteOf(p.variant ?? 0).index];

const PAPER = {
  notice: {bg: '#f4f2ec', ink: '#1d1d1f', font: '"Courier New", Courier, monospace', head: '#1f4e79'},
  lined: {bg: '#f6efc9', ink: '#22305e', font: EVAC_HAND_FONT, head: ''},
  scrap: {bg: '#ebe6da', ink: '#22305e', font: EVAC_HAND_FONT, head: ''},
} as const;

export class SkywaysNotes {
  notes: PropPlacement[] = [];
  /** The note in reach (null: none). */
  target: PropPlacement | null = null;
  /** The note whose text is open (null: closed). */
  open: PropPlacement | null = null;
  readonly counts = {opens: 0, closes: 0};
  private el: HTMLElement | null = null;
  private card: HTMLElement | null = null;
  private keyBound = false;

  constructor(readonly host: SkywaysNotesHost) {}

  install(): this {
    const h = this.host;
    runtimes.set(h, this);
    h.sectionHooks.push({build: layout => this.build(layout), teardown: () => this.teardown()});
    h.frameHooks.push(() => this.frame());
    h.interactHandlers.push(() => this.interact());
    h.promptProviders?.push(() => this.prompt());
    return this;
  }

  build(layout: StationLayout): void {
    this.teardown();
    this.notes = layout.props.filter(p => p.kind === 'evacNote' && !p.cargoGone && noteOfProp(p));
  }

  teardown(): void {
    this.close();
    this.notes = [];
    this.target = null;
    this.el?.remove();
    this.el = null;
    this.card = null;
  }

  /** Nothing solid between the player and the note (the floor grid of the note's storey, sampled every 0.1 m). */
  private clear(n: PropPlacement, px: number, pz: number): boolean {
    const L = this.host.layout, g = L.levels?.[n.level ?? 0]?.grid ?? L.grid;
    if (!g) return true;
    const d = Math.hypot(n.x - px, n.z - pz), steps = Math.max(1, Math.ceil(d / 0.1));
    for (let k = 0; k <= steps; k++) {
      const t = k / steps, cx = Math.floor((px + (n.x - px) * t) / CELL), cy = Math.floor((pz + (n.z - pz) * t) / CELL);
      if (!g.inBounds(cx, cy) || g.cells[g.idx(cx, cy)] !== FLOOR) return false;
    }
    return true;
  }

  /** The note the player stands at (reach, storey, looking toward it, nothing solid between; pinned: in front of its board), or null. */
  aimed(): PropPlacement | null {
    const p = this.host.player;
    let best: PropPlacement | null = null, bd = Infinity;
    for (const n of this.notes) {
      const dx = p.x - n.x, dz = p.z - n.z, d = Math.hypot(dx, dz), up = n.y - p.y;
      if (d > NOTE_READ.reach || up < NOTE_READ.below || up > NOTE_READ.above) continue;
      if (n.mounted && dx * Math.sin(n.rot) + dz * Math.cos(n.rot) < NOTE_READ.front) continue;
      if (d > 0.25) {
        // the view (forward = (-sin yaw, -cos yaw)) toward the note
        const cos = (Math.sin(p.yaw) * dx + Math.cos(p.yaw) * dz) / d;
        if (Math.acos(Math.max(-1, Math.min(1, cos))) > NOTE_READ.look) continue;
      }
      if (!this.clear(n, p.x, p.z)) continue;
      if (d < bd) { bd = d; best = n; }
    }
    return best;
  }

  frame(): void {
    if (!this.notes.length) return;
    this.target = this.host.state && this.host.state !== 'playing' ? null : this.aimed();
    if (this.open && this.target !== this.open) this.close();
  }

  prompt(): string | null {
    if (this.open) return '<b>[E]</b> Put the note down';
    return this.target ? '<b>[E]</b> Read the note' : null;
  }

  interact(): boolean {
    if (this.open) { this.close(); return true; }
    if (!this.target) return false;
    this.show(this.target);
    return true;
  }

  /** The text shown for a note prop (title / body / signature), or null. */
  textOf(p: PropPlacement): {title?: string; body: string; sign?: string; paper: EvacNote['paper']} | null {
    const n = noteOfProp(p);
    return n ? {title: n.title, body: n.body, sign: n.sign, paper: n.paper} : null;
  }

  private show(p: PropPlacement): void {
    this.open = p;
    this.counts.opens++;
    const t = this.textOf(p);
    const doc = typeof document !== 'undefined' ? document as Document & {body?: HTMLElement} : null;
    if (!doc?.body || !t) return;
    if (!this.keyBound && typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('keydown', e => { if ((e as KeyboardEvent).key === 'Escape' && this.open) this.close(); });
      this.keyBound = true;
    }
    if (!this.el) {
      const el = doc.createElement('div');
      el.id = 'skyways-note-read';
      el.style.cssText = 'position:fixed;inset:0;z-index:15;display:flex;align-items:center;justify-content:center;pointer-events:none;background:rgba(5,7,9,0.55);';
      const card = doc.createElement('div');
      el.appendChild(card);
      doc.body.appendChild(el);
      this.el = el;
      this.card = card;
    }
    const card = this.card!, paper = PAPER[t.paper];
    card.style.cssText = `width:min(520px,82vw);max-height:80vh;overflow:hidden;padding:30px 34px 26px;background:${paper.bg};color:${paper.ink};`
      + `font:20px/1.5 ${paper.font};box-shadow:0 14px 40px rgba(0,0,0,0.6);transform:rotate(${t.paper === 'scrap' ? -1.2 : 0.4}deg);white-space:pre-wrap;`
      + (paper.head ? `border-top:26px solid ${paper.head};` : '');
    for (const c of Array.from((card as unknown as {children: ArrayLike<HTMLElement>}).children)) c.remove();
    const line = (text: string, css: string) => { const e = doc.createElement('div'); e.textContent = text; e.style.cssText = css; card.appendChild(e); };
    if (t.title) line(t.title, 'font-weight:bold;margin-bottom:10px;');
    line(t.body, '');
    if (t.sign) line(`- ${t.sign}`, 'text-align:right;font-style:italic;margin-top:12px;');
    this.el.style.display = 'flex';
  }

  private close(): void {
    if (this.open) this.counts.closes++;
    this.open = null;
    if (this.el) this.el.style.display = 'none';
  }
}

/** Installs the close-up read into a Game (one call in the Game constructor). */
export function installSkywaysNotes(host: SkywaysNotesHost): SkywaysNotes {
  return new SkywaysNotes(host).install();
}
