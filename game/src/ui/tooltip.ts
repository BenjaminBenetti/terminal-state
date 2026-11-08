// Task studio-ui-subway-maps-20261108-074144-01 (user: "the tool tips on the inventory menu remain open after the user closes the menu if
// they are hovering an item when the menu closes. Lets use in game tooltipos"): the game's own tooltip, replacing the browser's native
// `title` tooltips in menus. A native tooltip belongs to the browser and outlives the panel it came from when the cursor does not move.
// This one belongs to the game, so every way a panel goes away also takes the tooltip with it.
//
// Markup (no per-view wiring): any element with `data-tip` gets the tooltip. Build the attributes with tipAttrs() in HTML templates, or
// setTip() on a live element.
//   data-tip        the heading (required; an item's name)
//   data-tip-body   detail lines, separated by "\n" (quantity, condition, stats)
//   data-tip-hint   a dim last line: how to use it (click / drag / keys)
//   data-tip-tone   'warn' (amber) or 'danger' (red, e.g. "Steal"); default: the cream info tone
// Content always goes in as text (textContent; never parsed as HTML), and the attribute helpers escape it.
//
// Lifecycle (installTooltips(), once at boot; one document-level listener set, one element mounted lazily on <body>):
//  - shows on hover (pointerover / pointermove with no button held) or on keyboard focus (focusin after a key) of a [data-tip] element;
//    follows the pointer; for focus it sits beside the element. Clamped inside the viewport. role="tooltip"; the anchor gets
//    aria-describedby while shown.
//  - hides on: leaving the anchor, any key, a button press (drag / click / held use own the pointer; it comes back on the next plain
//    move), the wheel, window blur, the tab hidden, the pointer being locked (play), hideTooltip() (Game.setState, every panel's hide /
//    close and the map's close call it), and the frame check: while shown it checks each animation frame that its anchor is still in
//    the document and visible (not inside .hidden / .pm-hidden / [hidden], has layout boxes). A panel that closes under a still cursor
//    therefore never leaves its tooltip behind.
//  - a re-render that replaces the hovered element (views write slots with innerHTML) re-binds to the new element under the still
//    pointer (refreshTooltip(), also from the frame check), so its text stays current; nothing under the pointer: hidden.
// Never a `.slot`, never takes pointer events (drop targets use elementFromPoint / .slot hit tests).

export type TipTone = 'info' | 'warn' | 'danger';

/** A tooltip's content. */
export interface TipContent {
  /** The heading (an item's name). */
  head: string;
  /** Detail lines. */
  lines?: readonly string[];
  /** A dim last line: how to use it. */
  hint?: string;
  tone?: TipTone;
}

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** The attributes for an HTML template (leading space; '' for no content): `<div class="slot"${tipAttrs(c)}>`. */
export function tipAttrs(c: TipContent | null | undefined): string {
  if (!c || !c.head) return '';
  const body = (c.lines ?? []).filter(Boolean).join('\n');
  return ` data-tip="${esc(c.head)}"${body ? ` data-tip-body="${esc(body)}"` : ''}${c.hint ? ` data-tip-hint="${esc(c.hint)}"` : ''}${c.tone && c.tone !== 'info' ? ` data-tip-tone="${c.tone}"` : ''}`;
}

/** Set (or clear, with null) the tooltip of a live element. */
export function setTip(el: Element, c: TipContent | null | undefined): void {
  const set = (k: string, v: string | undefined) => {
    if (v) el.setAttribute(k, v);
    else if (typeof el.removeAttribute === 'function') el.removeAttribute(k);
    else if (el.getAttribute?.(k)) el.setAttribute(k, ''); // (a minimal DOM: an empty value reads as no tooltip)
  };
  set('data-tip', c?.head || undefined);
  set('data-tip-body', c ? (c.lines ?? []).filter(Boolean).join('\n') || undefined : undefined);
  set('data-tip-hint', c?.hint || undefined);
  set('data-tip-tone', c?.tone && c.tone !== 'info' ? c.tone : undefined);
  if (ctl.anchor === el) ctl.fill();
}

/** The content an element carries (null: none). */
export function tipOf(el: Element | null | undefined): TipContent | null {
  const head = el?.getAttribute?.('data-tip');
  if (!el || !head) return null;
  const body = el.getAttribute('data-tip-body');
  const tone = el.getAttribute('data-tip-tone');
  return {head, lines: body ? body.split('\n') : [], hint: el.getAttribute('data-tip-hint') ?? undefined, tone: tone === 'warn' || tone === 'danger' ? tone : 'info'};
}

const TIP_CSS = `
#game-tip { position: fixed; left: 0; top: 0; z-index: 90; max-width: 340px; padding: 7px 10px 8px; pointer-events: none; background: rgba(14, 16, 18, 0.96);
  border: 1px solid #3a3f44; border-left: 3px solid var(--cream, #ece4cf); color: var(--cream, #ece4cf); font-size: 12px; line-height: 1.4;
  letter-spacing: 0.02em; box-shadow: 0 6px 18px rgba(0, 0, 0, 0.55); }
#game-tip.gt-hidden { display: none; }
#game-tip .gt-head { display: block; font-weight: 700; letter-spacing: 0.06em; }
#game-tip .gt-body { white-space: pre-line; margin-top: 2px; }
#game-tip .gt-hint { margin-top: 4px; color: var(--cream-dim, #b9b19c); font-size: 11px; }
#game-tip .gt-body:empty, #game-tip .gt-hint:empty { display: none; }
#game-tip.gt-warn { border-left-color: var(--mustard, #d9a520); }
#game-tip.gt-warn .gt-head { color: var(--mustard, #d9a520); }
#game-tip.gt-danger { border-left-color: var(--red, #c2463a); }
#game-tip.gt-danger .gt-head { color: var(--red, #c2463a); }`;

/** The game's hidden classes (a panel with one is not on screen). */
const HIDDEN_CLASSES = ['hidden', 'pm-hidden'];
const OFFSET = {x: 16, y: 20};

type Via = 'pointer' | 'focus';

class TooltipController {
  el: HTMLElement | null = null;
  anchor: Element | null = null;
  via: Via | null = null;
  /** Last pointer position (client px). */
  x = 0;
  y = 0;
  /** A button is held (drag / held use) or the pointer is locked: no hover tooltip. */
  pressed = false;
  locked = false;
  /** The last input was a key: focus may show the tooltip. */
  keyboard = false;
  /** The document the listeners are on (a new document — a test DOM — installs afresh). */
  installed: Document | null = null;
  private raf = 0;
  private mountedOn: Document | null = null;
  private prevDescribedBy: string | null = null;

  install(): void {
    if (typeof document === 'undefined' || this.installed === document) return;
    this.installed = document;
    this.el = null;
    this.anchor = null;
    this.via = null;
    const doc = document, win = typeof window !== 'undefined' ? window : null;
    const opt = {capture: true, passive: true} as AddEventListenerOptions;
    doc.addEventListener('pointerover', e => this.onOver(e as PointerEvent), opt);
    doc.addEventListener('pointermove', e => this.onMove(e as PointerEvent), opt);
    doc.addEventListener('pointerout', e => this.onOut(e as PointerEvent), opt);
    doc.addEventListener('pointerdown', () => { this.pressed = true; this.keyboard = false; this.hide(); }, opt);
    const release = () => { this.pressed = false; };
    doc.addEventListener('pointerup', release, opt);
    doc.addEventListener('pointercancel', release, opt);
    doc.addEventListener('focusin', e => this.onFocusIn(e as FocusEvent), opt);
    doc.addEventListener('focusout', () => { if (this.via === 'focus') this.hide(); }, opt);
    doc.addEventListener('wheel', () => this.hide(), opt);
    doc.addEventListener('visibilitychange', () => this.hide(), opt);
    doc.addEventListener('pointerlockchange', () => { this.locked = !!doc.pointerLockElement; if (this.locked) this.hide(); }, opt);
    // keys first (window capture, before the views' own key listeners): Tab / Esc / E close panels, so the tooltip goes with the key
    win?.addEventListener('keydown', () => { this.keyboard = true; this.hide(); }, {capture: true});
    win?.addEventListener('blur', () => { this.pressed = false; this.hide(); });
  }

  private target(e: Event): Element | null {
    const t = e.target as Element | null;
    return t && typeof t.closest === 'function' ? t.closest('[data-tip]') : null;
  }

  private onOver(e: PointerEvent): void {
    this.x = e.clientX ?? this.x;
    this.y = e.clientY ?? this.y;
    if (this.pressed || this.locked || (e.buttons ?? 0) !== 0) return;
    const a = this.target(e);
    if (a) { if (a !== this.anchor || this.via !== 'pointer') this.show(a, 'pointer'); else this.place(); }
    else if (this.via === 'pointer') this.hide();
  }

  private onMove(e: PointerEvent): void {
    this.x = e.clientX ?? this.x;
    this.y = e.clientY ?? this.y;
    this.keyboard = false;
    if ((e.buttons ?? 0) !== 0) { this.pressed = true; return; }
    this.pressed = false;
    if (this.locked) return;
    if (this.anchor && this.via === 'pointer') { this.place(); return; }
    const a = this.target(e);
    if (a) this.show(a, 'pointer');
  }

  private onOut(e: PointerEvent): void {
    if (this.via !== 'pointer' || !this.anchor) return;
    const to = e.relatedTarget as Node | null;
    if (to && typeof (this.anchor as Element).contains === 'function' && this.anchor.contains(to)) return;
    if (to && (to as Element).closest?.('[data-tip]') === this.anchor) return;
    this.hide();
  }

  private onFocusIn(e: FocusEvent): void {
    if (!this.keyboard || this.pressed) return;
    const a = this.target(e);
    if (a) this.show(a, 'focus');
  }

  private mount(): HTMLElement | null {
    if (this.el && this.mountedOn === document) return this.el;
    if (typeof document === 'undefined' || !document.body) return null;
    const st = document.createElement('style');
    st.id = 'game-tip-css';
    st.textContent = TIP_CSS;
    document.head?.appendChild(st);
    const el = document.createElement('div');
    el.id = 'game-tip';
    el.className = 'gt-hidden';
    el.setAttribute('role', 'tooltip');
    el.innerHTML = '<span class="gt-head"></span><div class="gt-body"></div><div class="gt-hint"></div>';
    document.body.appendChild(el);
    this.el = el;
    this.mountedOn = document;
    return el;
  }

  show(anchor: Element, via: Via): void {
    if (!visible(anchor)) { this.hide(); return; }
    const el = this.mount();
    if (!el) return;
    if (this.anchor !== anchor) this.unlinkAnchor();
    this.anchor = anchor;
    this.via = via;
    if (this.prevDescribedBy === null) {
      this.prevDescribedBy = anchor.getAttribute('aria-describedby') ?? '';
      anchor.setAttribute('aria-describedby', 'game-tip');
    }
    this.fill();
    el.classList.remove('gt-hidden');
    this.place();
    this.watch();
  }

  /** Write the anchor's content into the tooltip. */
  fill(): void {
    const el = this.el, c = tipOf(this.anchor);
    if (!el || !c) { this.hide(); return; }
    const part = (sel: string) => el.querySelector(sel) as HTMLElement | null;
    const head = part('.gt-head'), body = part('.gt-body'), hint = part('.gt-hint');
    if (head) head.textContent = c.head;
    if (body) body.textContent = (c.lines ?? []).join('\n');
    if (hint) hint.textContent = c.hint ?? '';
    el.classList.toggle('gt-warn', c.tone === 'warn');
    el.classList.toggle('gt-danger', c.tone === 'danger');
  }

  /** Beside the pointer (or under the focused element), clamped inside the viewport. */
  place(): void {
    const el = this.el;
    if (!el || !this.anchor) return;
    const vw = typeof window !== 'undefined' && window.innerWidth ? window.innerWidth : 1280;
    const vh = typeof window !== 'undefined' && window.innerHeight ? window.innerHeight : 720;
    const r = el.getBoundingClientRect?.() ?? {width: 0, height: 0};
    const w = r.width || 0, h = r.height || 0;
    let x: number, y: number;
    if (this.via === 'focus') {
      const a = this.anchor.getBoundingClientRect?.() ?? {left: 0, right: 0, top: 0, bottom: 0};
      x = a.left;
      y = a.bottom + 6;
      if (y + h > vh - 8) y = a.top - h - 6;
    } else {
      x = this.x + OFFSET.x;
      y = this.y + OFFSET.y;
      if (x + w > vw - 8) x = this.x - w - 12;
      if (y + h > vh - 8) y = this.y - h - 12;
    }
    x = Math.max(8, Math.min(vw - w - 8, x));
    y = Math.max(8, Math.min(vh - h - 8, y));
    el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  }

  private unlinkAnchor(): void {
    const a = this.anchor;
    if (a && this.prevDescribedBy !== null) {
      if (this.prevDescribedBy) a.setAttribute('aria-describedby', this.prevDescribedBy);
      else a.removeAttribute('aria-describedby');
    }
    this.prevDescribedBy = null;
  }

  hide(): void {
    this.unlinkAnchor();
    this.anchor = null;
    this.via = null;
    this.el?.classList.add('gt-hidden');
    if (this.raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  /** The anchor was re-rendered (or its panel closed): re-bind to what is under the still pointer, or hide. */
  refresh(): void {
    if (!this.anchor) return;
    if (visible(this.anchor)) { this.fill(); return; }
    const via = this.via;
    const under = via === 'pointer' && typeof document.elementFromPoint === 'function' ? document.elementFromPoint(this.x, this.y)?.closest?.('[data-tip]') : null;
    if (under && visible(under)) this.show(under, 'pointer');
    else this.hide();
  }

  private watch(): void {
    if (this.raf || typeof requestAnimationFrame !== 'function') return;
    const tick = () => {
      this.raf = 0;
      if (!this.anchor) return;
      this.refresh();
      if (this.anchor) this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }
}

/** In the document (isConnected; a test DOM without it: contained by the document element). */
function connected(el: Element): boolean {
  if (typeof el.isConnected === 'boolean') return el.isConnected;
  const root = typeof document !== 'undefined' ? document.documentElement : null;
  return root && typeof root.contains === 'function' ? root.contains(el) : true;
}

/** On screen: in the document, not inside a hidden panel (a hidden class or the hidden attribute), and (in a real browser) laid out. */
function visible(el: Element): boolean {
  if (!connected(el)) return false;
  for (let n: Element | null = el; n; n = n.parentElement) {
    if (HIDDEN_CLASSES.some(c => n!.classList?.contains(c))) return false;
    if (typeof n.getAttribute === 'function' && n.getAttribute('hidden') !== null) return false;
  }
  if (typeof el.getClientRects === 'function') {
    const rects = el.getClientRects();
    if (rects && typeof rects.length === 'number' && rects.length === 0 && typeof (el as HTMLElement).offsetParent !== 'undefined') return false;
  }
  return true;
}

const ctl = new TooltipController();

/** Install the document listeners (once; main.ts at boot). Safe to call again. */
export function installTooltips(): void {
  ctl.install();
}

/** Hide the tooltip now (a panel closed / hid, a state change, a scene load). */
export function hideTooltip(): void {
  ctl.hide();
}

/** A view re-rendered: keep the tooltip on the element now under the pointer (its new text), or hide it. */
export function refreshTooltip(): void {
  ctl.refresh();
}

/** What is shown (tests / QA): null when hidden. */
export function tooltipState(): {anchor: Element; via: Via; content: TipContent} | null {
  if (!ctl.anchor || !ctl.via || !ctl.el || ctl.el.classList.contains('gt-hidden')) return null;
  const content = tipOf(ctl.anchor);
  return content ? {anchor: ctl.anchor, via: ctl.via, content} : null;
}

/** The tooltip element (tests): null until first shown. */
export function tooltipElement(): HTMLElement | null {
  return ctl.el;
}
