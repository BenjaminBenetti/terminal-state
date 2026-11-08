// Task studio-ui-subway-maps-20261108-074144-01: the CLOSE-UP READ of a Subway station map kiosk, the same behaviour as the Skyways directory
// boards (world/skywaysMapRead.ts, whose MAP_READ rules it shares). installSubwayMapRead(game) is called ONCE from the Game constructor
// and only REGISTERS (inert on every level without `subwayMapKiosk` placements):
//  - sectionHooks.build: the kiosks of the layout and its plan (world/subwayMapPlan.ts); teardown closes the view;
//  - frameHooks + promptProviders: standing at a kiosk's face (within MAP_READ.reach, in front of it, on its storey, looking toward it)
//    shows "[E] Read the station map"; walking off / turning away / leaving play closes an open view;
//  - interactHandlers (E): opens / closes a full-screen copy of THAT kiosk's face (its storey heads-up, its YOU ARE HERE) — a DOM canvas
//    over the game (no input capture; never the campaign network map).

import type {PropPlacement} from '../gen/props';
import type {StationLayout} from '../gen/stationTypes';
import {MAP_READ} from './skywaysMapRead';
import {KIOSK_FACE, drawKioskFace, subwayMapPlan, type SubwayMapPlan} from './subwayMapPlan';

export interface SubwayMapReadHost {
  player: {x: number; y: number; z: number; yaw: number};
  layout: StationLayout;
  state?: string;
  interactHandlers: (() => boolean)[];
  frameHooks: ((dt: number) => void)[];
  sectionHooks: {build?(layout: StationLayout): void; teardown?(): void}[];
  promptProviders?: (() => string | null)[];
}

/** The close-up's pixel scale over the face (KIOSK_FACE x 2). */
const VIEW_SCALE = 2;

const runtimes = new WeakMap<object, SubwayMapRead>();
/** The read runtime installed into a host (QA / tests). */
export const subwayMapReadOf = (host: object): SubwayMapRead | undefined => runtimes.get(host);

export class SubwayMapRead {
  kiosks: PropPlacement[] = [];
  plan: SubwayMapPlan | null = null;
  /** The kiosk in reach (null: none). */
  target: PropPlacement | null = null;
  /** The kiosk whose face is open (null: closed). */
  open: PropPlacement | null = null;
  readonly counts = {opens: 0, draws: 0};
  private el: HTMLElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private drawn: PropPlacement | null = null;

  constructor(readonly host: SubwayMapReadHost) {}

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
    this.kiosks = layout.props.filter(p => p.kind === 'subwayMapKiosk');
    this.plan = this.kiosks.length ? subwayMapPlan(layout) : null;
  }

  teardown(): void {
    this.close();
    this.kiosks = [];
    this.plan = null;
    this.target = null;
    this.drawn = null;
    this.el?.remove();
    this.el = null;
    this.canvas = null;
  }

  /** The kiosk the player stands at (reach, in front of its face, same storey, looking toward it), or null. */
  aimed(): PropPlacement | null {
    const p = this.host.player;
    let best: PropPlacement | null = null, bd = Infinity;
    for (const k of this.kiosks) {
      const dx = p.x - k.x, dz = p.z - k.z, d = Math.hypot(dx, dz);
      if (d > MAP_READ.reach || d < 1e-3 || Math.abs(p.y - k.y) > MAP_READ.storey) continue;
      if (dx * Math.sin(k.rot) + dz * Math.cos(k.rot) < MAP_READ.front) continue;
      // the view (forward = (-sin yaw, -cos yaw)) toward the kiosk
      const cos = (-Math.sin(p.yaw) * -dx + -Math.cos(p.yaw) * -dz) / d;
      if (Math.acos(Math.max(-1, Math.min(1, cos))) > MAP_READ.look) continue;
      if (d < bd) { bd = d; best = k; }
    }
    return best;
  }

  frame(): void {
    if (!this.kiosks.length) return;
    this.target = this.host.state && this.host.state !== 'playing' ? null : this.aimed();
    if (this.open && this.target !== this.open) this.close();
  }

  prompt(): string | null {
    if (this.open) return '<b>[E]</b> Close the station map';
    return this.target ? '<b>[E]</b> Read the station map' : null;
  }

  interact(): boolean {
    if (this.open) { this.close(); return true; }
    if (!this.target || !this.plan) return false;
    this.show(this.target);
    return true;
  }

  private show(k: PropPlacement): void {
    this.open = k;
    this.counts.opens++;
    const doc = typeof document !== 'undefined' ? document as Document & {body?: HTMLElement} : null;
    if (!doc?.body || !this.plan) return;
    if (!this.el) {
      const el = doc.createElement('div');
      el.id = 'subway-map-read';
      el.style.cssText = 'position:fixed;inset:0;z-index:15;display:flex;align-items:center;justify-content:center;pointer-events:none;background:rgba(5,7,9,0.55);';
      const c = doc.createElement('canvas');
      c.width = KIOSK_FACE.w * VIEW_SCALE;
      c.height = KIOSK_FACE.h * VIEW_SCALE;
      c.style.cssText = `height:min(90vh,${Math.round(90 * KIOSK_FACE.h / KIOSK_FACE.w)}vw);width:auto;aspect-ratio:${KIOSK_FACE.w} / ${KIOSK_FACE.h};box-shadow:0 0 0 8px #8c9297,0 0 0 11px #2b2f33,0 12px 40px rgba(0,0,0,0.6);`;
      el.appendChild(c);
      doc.body.appendChild(el);
      this.el = el;
      this.canvas = c;
    }
    if (this.drawn !== k && this.canvas) {
      const ctx = this.canvas.getContext('2d');
      if (ctx) {
        ctx.setTransform?.(VIEW_SCALE, 0, 0, VIEW_SCALE, 0, 0);
        drawKioskFace(ctx, this.plan, k);
        ctx.setTransform?.(1, 0, 0, 1, 0, 0);
        this.counts.draws++;
      }
      this.drawn = k;
    }
    this.el.style.display = 'flex';
  }

  private close(): void {
    this.open = null;
    if (this.el) this.el.style.display = 'none';
  }
}

/** Installs the close-up read into a Game (one call in the Game constructor). */
export function installSubwayMapRead(host: SubwayMapReadHost): SubwayMapRead {
  return new SubwayMapRead(host).install();
}
