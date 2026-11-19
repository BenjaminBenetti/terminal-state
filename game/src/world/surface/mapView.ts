// Task studio-surface-run-opus-rebuild-20261116-020827-01 (lane LIFE): THE PLANNING MAP OVERLAY — the full-screen view the checkpoint's map
// table opens (ui/paperMap.ts's pattern: a lazily mounted dialog over #app, the sheet = the existing approved paper texture with the
// SVG ink over it in a multiply blend, a window CAPTURE key listener only while open, the opening key closing it only after a release).
// Read-only: there is nothing to select, travel to or claim (no quest system). Keys: Esc / E / Tab close (a fresh press), + / − / wheel
// zoom at the cursor, drag pans, F fits the sheet. The host (mapRuntime.ts) freezes the game in the 'map' state while it is open.

import {renderPlanningSvg, sheetBox} from './mapDraw';
import type {PlanningMap} from './mapModel';
import {DEFAULT_PAPER_TEXTURE} from '../../ui/paperMap';
import {isTypingTarget} from '../../player/input';

export interface PlanningMapOpen {
  /** Keys still physically down from the press that opened it (they close it only after a release + a fresh press). */
  heldKeys?: readonly string[];
  /** The player closed it (`key` = the closing key, to be suppressed until released; none = Esc / the button). */
  onClose(key?: string): void;
}

export type PlanningKey = {kind: 'pass'} | {kind: 'swallow'} | {kind: 'close'} | {kind: 'closeKey'; code: string} | {kind: 'zoom'; dir: 1 | -1} | {kind: 'fit'} | {kind: 'pan'; dx: number; dy: number};

/** What a keydown does while the planning map is open (pure: tests). */
export function planningKeyAction(e: {code: string; key?: string; repeat?: boolean; ctrlKey?: boolean; altKey?: boolean; metaKey?: boolean; target?: unknown}): PlanningKey {
  if (isTypingTarget(e.target) || e.ctrlKey || e.altKey || e.metaKey || /^F\d{1,2}$/.test(e.code)) return {kind: 'pass'};
  if (e.code === 'Escape') return {kind: 'close'};
  if (e.code === 'KeyE' || e.code === 'Tab') return e.repeat ? {kind: 'swallow'} : {kind: 'closeKey', code: e.code};
  if (e.code === 'Equal' || e.code === 'NumpadAdd' || e.key === '+') return {kind: 'zoom', dir: 1};
  if (e.code === 'Minus' || e.code === 'NumpadSubtract' || e.key === '-') return {kind: 'zoom', dir: -1};
  if (e.code === 'KeyF' || e.code === 'Home') return {kind: 'fit'};
  const pan: Record<string, [number, number]> = {ArrowLeft: [60, 0], ArrowRight: [-60, 0], ArrowUp: [0, 60], ArrowDown: [0, -60], KeyA: [60, 0], KeyD: [-60, 0], KeyW: [0, 60], KeyS: [0, -60]};
  if (pan[e.code]) return {kind: 'pan', dx: pan[e.code][0], dy: pan[e.code][1]};
  return {kind: 'swallow'}; // (nothing reaches the game while the map is open: no hotbar digit, no binding)
}

const CSS = `
#surface-planning-map{position:fixed;inset:0;z-index:60;background:rgba(14,16,12,.86);display:flex;flex-direction:column;font-family:'Arial Narrow','Roboto Condensed',Arial,sans-serif;color:#e8e2cf;outline:none}
#surface-planning-map.spm-hidden{display:none}
#surface-planning-map .spm-bar{display:flex;align-items:center;gap:14px;padding:8px 14px;background:#1c1f18;border-bottom:1px solid #3d4232;letter-spacing:.06em}
#surface-planning-map .spm-bar b{font-size:15px;text-transform:uppercase}
#surface-planning-map .spm-sub{opacity:.75;font-size:13px}
#surface-planning-map .spm-tools{margin-left:auto;display:flex;gap:6px}
#surface-planning-map button{background:#2f3427;color:#e8e2cf;border:1px solid #545b45;padding:4px 10px;font:inherit;font-size:13px;cursor:pointer}
#surface-planning-map button:hover{background:#3d4433}
#surface-planning-map .spm-stage{position:relative;flex:1;overflow:hidden;cursor:grab}
#surface-planning-map .spm-stage.spm-drag{cursor:grabbing}
#surface-planning-map .spm-sheet{position:absolute;left:0;top:0;transform-origin:0 0;background-size:100% 100%;background-color:#d9cfb3;box-shadow:0 10px 40px rgba(0,0,0,.6)}
#surface-planning-map .spm-sheet svg{display:block;width:100%;height:100%;mix-blend-mode:multiply}
#surface-planning-map .spm-help{padding:6px 14px;font-size:12px;opacity:.7;background:#1c1f18;border-top:1px solid #3d4232}
`;
let styled = false;

export class PlanningMapView {
  private root: HTMLElement | null = null;
  private stage: HTMLElement | null = null;
  private sheet: HTMLElement | null = null;
  private openFlag = false;
  private args: PlanningMapOpen | null = null;
  private held = new Set<string>();
  private model: PlanningMap | null = null;
  private view = {s: 1, x: 0, y: 0};
  private sheetPx = {w: 1, h: 1};
  private drag: {x: number; y: number; vx: number; vy: number} | null = null;
  readonly counts = {opens: 0, closes: 0, renders: 0};
  /** The last SVG printed (QA / tests). */
  svg = '';

  constructor(readonly opts: {parent?: HTMLElement | null; paperTexture?: string} = {}) {}

  get isOpen(): boolean { return this.openFlag; }

  open(model: PlanningMap, o: PlanningMapOpen): void {
    if (this.openFlag) this.detach();
    this.args = o;
    this.model = model;
    this.held = new Set(o.heldKeys ?? []);
    this.openFlag = true;
    this.counts.opens++;
    this.svg = renderPlanningSvg(model);
    this.counts.renders++;
    this.mount();
    if (this.sheet) this.sheet.innerHTML = this.svg;
    const sub = this.root?.querySelector?.('.spm-sub');
    if (sub) sub.textContent = `${model.name} · explored ${Math.round(model.explored * 100)} %`;
    this.attach();
    this.root?.classList.remove('spm-hidden');
    this.fit();
    (this.root as {focus?: () => void} | null)?.focus?.();
  }

  close(): void {
    if (!this.openFlag) return;
    this.openFlag = false;
    this.counts.closes++;
    this.detach();
    this.drag = null;
    this.root?.classList.add('spm-hidden');
  }

  /** Remove the overlay's element entirely (section teardown). */
  dispose(): void {
    this.close();
    this.root?.remove?.();
    this.root = this.stage = this.sheet = null;
  }

  private userClose(key?: string): void {
    const a = this.args;
    this.close();
    a?.onClose(key);
  }

  private mount(): void {
    if (this.root || typeof document === 'undefined') return;
    if (!styled) {
      styled = true;
      const st = document.createElement('style');
      st.id = 'surface-planning-map-styles';
      st.textContent = CSS;
      document.head.appendChild(st);
    }
    const el = document.createElement('section');
    el.id = 'surface-planning-map';
    el.className = 'spm-hidden';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', 'Planning map');
    el.setAttribute('tabindex', '-1');
    el.innerHTML = `<header class="spm-bar"><b>Planning map</b><span class="spm-sub"></span><span class="spm-tools"><button type="button" class="spm-out" aria-label="Zoom out">−</button><button type="button" class="spm-in" aria-label="Zoom in">+</button><button type="button" class="spm-fit">Fit</button><button type="button" class="spm-close">Close</button></span></header>
      <div class="spm-stage"><div class="spm-sheet"></div></div>
      <div class="spm-help">Drag or arrows to pan · wheel or + and − zoom · F fits the sheet · Esc, E or Tab closes</div>`;
    (this.opts.parent ?? document.querySelector('#app') ?? document.body).appendChild(el);
    this.root = el;
    this.stage = el.querySelector<HTMLElement>('.spm-stage');
    this.sheet = el.querySelector<HTMLElement>('.spm-sheet');
    const tex = this.opts.paperTexture ?? DEFAULT_PAPER_TEXTURE;
    if (this.sheet && tex) this.sheet.style.backgroundImage = `url("${tex.replace(/"/g, '%22')}")`;
    el.addEventListener('click', e => {
      const t = (e as MouseEvent).target as HTMLElement | null, cls = t?.classList;
      if (!cls) return;
      if (cls.contains('spm-close')) this.userClose();
      else if (cls.contains('spm-in')) this.zoomBy(1.35);
      else if (cls.contains('spm-out')) this.zoomBy(1 / 1.35);
      else if (cls.contains('spm-fit')) this.fit();
    });
    this.stage?.addEventListener('pointerdown', e => this.pointerDown(e as PointerEvent));
    this.stage?.addEventListener('wheel', e => {
      const we = e as WheelEvent;
      we.preventDefault();
      we.stopPropagation();
      this.zoomBy(Math.exp(-Math.max(-300, Math.min(300, we.deltaY * (we.deltaMode === 1 ? 33 : 1))) * 0.0018), we.clientX, we.clientY);
    }, {passive: false});
  }

  private readonly onKey = (e: KeyboardEvent): void => this.handleKey(e);
  private readonly onKeyUp = (e: KeyboardEvent): void => { this.held.delete(e.code); };
  private readonly onBlur = (): void => { this.held.clear(); this.drag = null; };
  private readonly onResize = (): void => this.fit();
  private readonly onMove = (e: PointerEvent): void => {
    const d = this.drag;
    if (!d) return;
    this.view.x = d.vx + (e.clientX - d.x);
    this.view.y = d.vy + (e.clientY - d.y);
    this.apply();
  };
  private readonly onUp = (): void => {
    this.drag = null;
    this.stage?.classList.remove('spm-drag');
    if (typeof window !== 'undefined') { window.removeEventListener('pointermove', this.onMove); window.removeEventListener('pointerup', this.onUp); }
  };

  private pointerDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    this.drag = {x: e.clientX, y: e.clientY, vx: this.view.x, vy: this.view.y};
    this.stage?.classList.add('spm-drag');
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
  }

  /** The window keydown capture listener (installed only while open). */
  handleKey(e: Pick<KeyboardEvent, 'code' | 'key' | 'repeat' | 'ctrlKey' | 'altKey' | 'metaKey' | 'target' | 'preventDefault' | 'stopImmediatePropagation'>): void {
    if (!this.openFlag) return;
    const a = planningKeyAction(e);
    if (a.kind === 'pass') return;
    e.stopImmediatePropagation();
    e.preventDefault();
    switch (a.kind) {
      case 'close': this.userClose(); break;
      case 'closeKey': if (!this.held.has(a.code)) this.userClose(a.code); break;
      case 'zoom': this.zoomBy(a.dir > 0 ? 1.35 : 1 / 1.35); break;
      case 'fit': this.fit(); break;
      case 'pan': this.view.x += a.dx; this.view.y += a.dy; this.apply(); break;
      default: break;
    }
  }

  private attach(): void {
    if (typeof window === 'undefined') return;
    window.addEventListener('keydown', this.onKey, {capture: true});
    window.addEventListener('keyup', this.onKeyUp, {capture: true});
    window.addEventListener('blur', this.onBlur);
    window.addEventListener('resize', this.onResize);
  }

  private detach(): void {
    if (typeof window === 'undefined') return;
    window.removeEventListener('keydown', this.onKey, {capture: true});
    window.removeEventListener('keyup', this.onKeyUp, {capture: true});
    window.removeEventListener('blur', this.onBlur);
    window.removeEventListener('resize', this.onResize);
    this.onUp();
  }

  /** Fit the whole sheet into the stage. */
  fit(): void {
    if (!this.model) return;
    const B = sheetBox(this.model);
    const sw = this.stage?.clientWidth || (typeof window !== 'undefined' ? window.innerWidth : 1280), sh = this.stage?.clientHeight || (typeof window !== 'undefined' ? window.innerHeight - 80 : 720);
    // the sheet's own pixel size keeps the aspect of the viewBox (1 px per world metre x 2 for crisp ink before zooming out)
    this.sheetPx = {w: B.w * 2, h: B.h * 2};
    const s = Math.min((sw - 24) / this.sheetPx.w, (sh - 24) / this.sheetPx.h);
    this.view = {s, x: (sw - this.sheetPx.w * s) / 2, y: (sh - this.sheetPx.h * s) / 2};
    this.apply();
  }

  private zoomBy(f: number, cx?: number, cy?: number): void {
    const v = this.view, s1 = Math.max(0.08, Math.min(6, v.s * f));
    const rect = (this.stage as {getBoundingClientRect?: () => {left: number; top: number; width: number; height: number}} | null)?.getBoundingClientRect?.();
    const px = cx !== undefined && rect ? cx - rect.left : (rect?.width ?? 1280) / 2, py = cy !== undefined && rect ? cy - rect.top : (rect?.height ?? 720) / 2;
    v.x = px - (px - v.x) * (s1 / v.s);
    v.y = py - (py - v.y) * (s1 / v.s);
    v.s = s1;
    this.apply();
  }

  private apply(): void {
    const el = this.sheet;
    if (!el) return;
    el.style.width = `${this.sheetPx.w}px`;
    el.style.height = `${this.sheetPx.h}px`;
    el.style.transform = `translate(${this.view.x}px, ${this.view.y}px) scale(${this.view.s})`;
  }

  qa(): Record<string, unknown> {
    const m = this.model;
    // (lane MAP, task studio-surface-map-tent-cab-20261119-025201-01: the label placer's figures as printed on the sheet)
    const labels = Object.fromEntries([...this.svg.slice(0, 1200).matchAll(/data-(labels|label-[a-z]+|street-skipped)="(\d+)"/g)].map(g => [g[1], Number(g[2])]));
    return {open: this.openFlag, counts: {...this.counts}, view: {...this.view}, markers: m?.markers.length ?? 0, kinds: m ? m.markers.reduce<Record<string, number>>((c, k) => ({...c, [k.kind]: (c[k.kind] ?? 0) + 1}), {}) : {}, explored: m?.explored ?? 0, svgChars: this.svg.length, labels};
  }
}
