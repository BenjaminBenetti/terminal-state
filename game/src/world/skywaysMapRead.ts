// Task studio-skyways-rework-20261107-054512-01 (lane MAPS): the CLOSE-UP READ of a Skyways directory board. installSkywaysMapRead(game)
// is called ONCE from the Game constructor and only REGISTERS (inert on every level without `skywaysMapBoard` placements):
//  - sectionHooks.build: the boards of the layout and its plan (world/skywaysMapPlan.ts); teardown closes the view;
//  - frameHooks + promptProviders: standing at a board's face (within MAP_READ.reach of the face, in front of it, on its storey, looking
//    toward it) shows "[E] Read the directory"; walking off / turning away closes an open view;
//  - interactHandlers (E): opens / closes a full-screen view of the SAME face (world/skywaysMapBoards.ts drawSkywaysBoardComposite: the
//    storey plan, this board's YOU ARE HERE and floor line) — a DOM canvas over the game (no input capture, never a campaign map).

import type {PropPlacement} from '../gen/props';
import type {StationLayout} from '../gen/stationTypes';
import {skywaysBoardHere, skywaysMapPlan, type SkywaysMapPlan} from './skywaysMapPlan';
import {MAP_FACE, drawSkywaysBoardComposite} from './skywaysMapBoards';

export const MAP_READ = {
  /** Horizontal reach (m) from the board's centre; the player must stand in front of the face (this far forward of its plane, m). */
  reach: 1.9,
  front: 0.15,
  /** Largest angle (rad) between the view and the direction to the board. */
  look: 0.9,
  /** Same storey: the feet within this height of the board's base (m). */
  storey: 1.2,
} as const;

export interface SkywaysMapReadHost {
  player: {x: number; y: number; z: number; yaw: number};
  layout: StationLayout;
  state?: string;
  interactHandlers: (() => boolean)[];
  frameHooks: ((dt: number) => void)[];
  sectionHooks: {build?(layout: StationLayout): void; teardown?(): void}[];
  promptProviders?: (() => string | null)[];
}

const runtimes = new WeakMap<object, SkywaysMapRead>();
/** The read runtime installed into a host (QA / tests). */
export const skywaysMapReadOf = (host: object): SkywaysMapRead | undefined => runtimes.get(host);

export class SkywaysMapRead {
  boards: PropPlacement[] = [];
  plan: SkywaysMapPlan | null = null;
  /** The board in reach (null: none). */
  target: PropPlacement | null = null;
  /** The board whose face is open (null: closed). */
  open: PropPlacement | null = null;
  readonly counts = {opens: 0, draws: 0};
  private el: HTMLElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private drawn: PropPlacement | null = null;

  constructor(readonly host: SkywaysMapReadHost) {}

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
    this.boards = layout.props.filter(p => p.kind === 'skywaysMapBoard');
    this.plan = this.boards.length ? skywaysMapPlan(layout) : null;
  }

  teardown(): void {
    this.close();
    this.boards = [];
    this.plan = null;
    this.target = null;
    this.drawn = null;
    this.el?.remove();
    this.el = null;
    this.canvas = null;
  }

  /** The board the player stands at (reach, in front of its face, same storey, looking toward it), or null. */
  aimed(): PropPlacement | null {
    const p = this.host.player;
    let best: PropPlacement | null = null, bd = Infinity;
    for (const b of this.boards) {
      const dx = p.x - b.x, dz = p.z - b.z, d = Math.hypot(dx, dz);
      if (d > MAP_READ.reach || d < 1e-3 || Math.abs(p.y - b.y) > MAP_READ.storey) continue;
      if (dx * Math.sin(b.rot) + dz * Math.cos(b.rot) < MAP_READ.front) continue;
      // the view (forward = (-sin yaw, -cos yaw)) toward the board
      const cos = (-Math.sin(p.yaw) * -dx + -Math.cos(p.yaw) * -dz) / d;
      if (Math.acos(Math.max(-1, Math.min(1, cos))) > MAP_READ.look) continue;
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  }

  frame(): void {
    if (!this.boards.length) return;
    this.target = this.host.state && this.host.state !== 'playing' ? null : this.aimed();
    if (this.open && this.target !== this.open) this.close();
  }

  prompt(): string | null {
    if (this.open) return '<b>[E]</b> Close the directory';
    return this.target ? '<b>[E]</b> Read the directory' : null;
  }

  interact(): boolean {
    if (this.open) { this.close(); return true; }
    if (!this.target || !this.plan) return false;
    this.show(this.target);
    return true;
  }

  private show(b: PropPlacement): void {
    this.open = b;
    this.counts.opens++;
    const doc = typeof document !== 'undefined' ? document as Document & {body?: HTMLElement} : null;
    if (!doc?.body || !this.plan) return;
    if (!this.el) {
      const el = doc.createElement('div');
      el.id = 'skyways-map-read';
      el.style.cssText = 'position:fixed;inset:0;z-index:15;display:flex;align-items:center;justify-content:center;pointer-events:none;background:rgba(5,7,9,0.55);';
      const c = doc.createElement('canvas');
      c.width = c.height = MAP_FACE.px;
      c.style.cssText = 'width:min(86vh,86vw);height:min(86vh,86vw);border-radius:50%;box-shadow:0 0 0 10px #8c9297,0 0 0 13px #3a3f43,0 12px 40px rgba(0,0,0,0.6);';
      el.appendChild(c);
      doc.body.appendChild(el);
      this.el = el;
      this.canvas = c;
    }
    if (this.drawn !== b && this.canvas) {
      const ctx = this.canvas.getContext('2d');
      if (ctx) { drawSkywaysBoardComposite(ctx, this.plan, skywaysBoardHere(this.plan, b), 7300 + (b.level ?? 0) * 31 + (this.host.layout.seed ?? 0) % 997); this.counts.draws++; }
      this.drawn = b;
    }
    this.el.style.display = 'flex';
  }

  private close(): void {
    this.open = null;
    if (this.el) this.el.style.display = 'none';
  }
}

/** Installs the close-up read into a Game (one call in the Game constructor). */
export function installSkywaysMapRead(host: SkywaysMapReadHost): SkywaysMapRead {
  return new SkywaysMapRead(host).install();
}
