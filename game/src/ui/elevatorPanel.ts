// Iteration 16 (lane TOWER): the elevator floor list / stairwell choice (a small in-world list: the world keeps
// running, pointer lock stays) and the short stairwell fade.
// Keyboard only works: 1-9 pick a floor directly (1 = lobby), arrows / mouse wheel move the highlight, E / Enter /
// left click confirm, Esc / Tab / Backspace / right click close. While open, those keys are captured (window capture
// phase) so they never reach the game's Input (no weapon switch, no inventory). Items are also clickable buttons when
// a cursor is visible. Logic (ChoiceModel) is DOM-free for tests.

export interface ChoiceItem {
  id: string;
  label: string;
  /** Direct hotkey digit (e.g. the floor number). */
  key?: number;
  current?: boolean;
  disabled?: boolean;
}

export type ChoiceAction = {type: 'pick'; id: string} | {type: 'close'} | {type: 'move'} | null;

/** DOM-free list state: highlight, hotkeys, confirm. */
export class ChoiceModel {
  index = 0;
  constructor(readonly items: readonly ChoiceItem[], start = 0) {
    this.index = Math.max(0, Math.min(items.length - 1, start));
    if (this.items[this.index]?.disabled) this.move(1);
  }
  move(d: number): void {
    const n = this.items.length;
    if (!n) return;
    for (let k = 0; k < n; k++) {
      this.index = (this.index + (d >= 0 ? 1 : -1) + n) % n;
      if (!this.items[this.index].disabled) return;
    }
  }
  /** A key code -> action (null: not handled). */
  key(code: string): ChoiceAction {
    const m = /^(?:Digit|Numpad)(\d)$/.exec(code);
    if (m) {
      const d = Number(m[1]);
      const it = this.items.find(i => i.key === d && !i.disabled);
      return it ? {type: 'pick', id: it.id} : {type: 'move'};
    }
    if (code === 'ArrowUp') { this.move(-1); return {type: 'move'}; }
    if (code === 'ArrowDown') { this.move(1); return {type: 'move'}; }
    if (code === 'KeyE' || code === 'Enter' || code === 'NumpadEnter') {
      const it = this.items[this.index];
      return it && !it.disabled ? {type: 'pick', id: it.id} : {type: 'move'};
    }
    if (code === 'Escape' || code === 'Tab' || code === 'Backspace') return {type: 'close'};
    return null;
  }
}

/** A real DOM is present (node tests may stub `document` with a canvas-only shim). */
const hasDom = (): boolean => typeof document !== 'undefined' && typeof (document as Partial<Document>).getElementById === 'function' && typeof (document as Partial<Document>).body !== 'undefined';

/** Keys the open list swallows (the game never sees them). Movement keys (WASD, Space, C, Shift) still reach the game. */
const CAPTURED = /^(Digit\d|Numpad\d|ArrowUp|ArrowDown|ArrowLeft|ArrowRight|KeyE|Enter|NumpadEnter|Escape|Tab|Backspace)$/;

export class TowerChoice {
  private model: ChoiceModel | null = null;
  private el: HTMLElement | null = null;
  private onPick: ((id: string) => void) | null = null;
  private onClose: (() => void) | null = null;
  private installed = false;

  /** `active`: the game is in play (otherwise the list closes and captures nothing: menus keep their keys). */
  constructor(private readonly active: () => boolean = () => true) {}

  /** Closes the list when play stopped; true while it may capture input. */
  private live(): boolean {
    if (!this.model) return false;
    if (!this.active()) { this.close(); return false; }
    return true;
  }

  get isOpen(): boolean { return this.model !== null; }
  get highlighted(): string | null { return this.model ? this.model.items[this.model.index]?.id ?? null : null; }

  open(title: string, items: ChoiceItem[], start: number, onPick: (id: string) => void, onClose?: () => void): void {
    this.model = new ChoiceModel(items, start);
    this.onPick = onPick;
    this.onClose = onClose ?? null;
    this.install();
    this.render(title);
  }

  close(): void {
    if (!this.model) return;
    this.model = null;
    this.el?.classList.add('hidden');
    const cb = this.onClose;
    this.onPick = this.onClose = null;
    cb?.();
  }

  /** Route a key (also used by tests); true when consumed. */
  handleKey(code: string): boolean {
    if (!this.model) return false;
    const a = this.model.key(code);
    if (!a) return CAPTURED.test(code);
    if (a.type === 'pick') { const cb = this.onPick; this.close(); cb?.(a.id); }
    else if (a.type === 'close') this.close();
    else this.paint();
    return true;
  }

  private install(): void {
    if (this.installed || typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
    this.installed = true;
    window.addEventListener('keydown', e => {
      if (!this.live()) return;
      const repeatOk = e.code === 'ArrowUp' || e.code === 'ArrowDown';
      const consumed = e.repeat && !repeatOk ? CAPTURED.test(e.code) : this.handleKey(e.code);
      if (consumed) { e.preventDefault(); e.stopImmediatePropagation(); }
    }, {capture: true});
    window.addEventListener('wheel', e => {
      if (!this.live() || !this.model) return;
      this.model.move(Math.sign(e.deltaY));
      this.paint();
      e.stopImmediatePropagation();
    }, {capture: true, passive: true});
    window.addEventListener('mousedown', e => {
      if (!this.live()) return;
      const t = e.target as HTMLElement | null;
      if (t && this.el?.contains(t)) return; // a real click on an item (cursor visible): handled by the button
      if (e.button === 0) { const id = this.highlighted; const cb = this.onPick; this.close(); if (id && cb) cb(id); }
      else if (e.button === 2) this.close();
      e.preventDefault(); e.stopImmediatePropagation();
    }, {capture: true});
  }

  private ensureEl(): HTMLElement | null {
    if (this.el || !hasDom()) return this.el;
    const host = document.getElementById('hud') ?? document.body;
    const el = document.createElement('div');
    el.id = 'tower-choice';
    el.className = 'hidden';
    el.setAttribute('role', 'listbox');
    host.appendChild(el);
    this.el = el;
    return el;
  }

  private titleText = '';
  private render(title: string): void {
    this.titleText = title;
    this.paint();
  }

  private paint(): void {
    const el = this.ensureEl();
    const m = this.model;
    if (!el || !m) return;
    el.classList.remove('hidden');
    el.replaceChildren();
    const h = document.createElement('div'); h.className = 'tc-title'; h.textContent = this.titleText; el.appendChild(h);
    const list = document.createElement('div'); list.className = 'tc-list';
    m.items.forEach((it, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `tc-item${i === m.index ? ' sel' : ''}${it.current ? ' cur' : ''}`;
      b.disabled = !!it.disabled;
      b.textContent = it.label;
      b.addEventListener('click', ev => { ev.stopPropagation(); const cb = this.onPick; this.close(); cb?.(it.id); });
      list.appendChild(b);
    });
    el.appendChild(list);
    const hint = document.createElement('div'); hint.className = 'tc-hint';
    hint.textContent = '1–9 or ↑↓ + E / click · Esc closes';
    el.appendChild(hint);
  }
}

/** Full-screen fade for the stairwell (CSS opacity transition). */
export class TowerFade {
  private el: HTMLElement | null = null;
  private ensure(): HTMLElement | null {
    if (this.el || !hasDom()) return this.el;
    const el = document.createElement('div');
    el.id = 'tower-fade';
    (document.getElementById('app') ?? document.body).appendChild(el);
    this.el = el;
    return el;
  }
  /** Fade to black (resolves after `ms`). */
  out(ms = 320): Promise<void> {
    const el = this.ensure();
    if (!el) return Promise.resolve();
    el.style.transitionDuration = `${ms}ms`;
    el.classList.add('on');
    return new Promise(r => setTimeout(r, ms));
  }
  /** Fade back in. */
  in(ms = 520): void {
    const el = this.ensure();
    if (!el) return;
    el.style.transitionDuration = `${ms}ms`;
    el.classList.remove('on');
  }
  get dark(): boolean { return !!this.el?.classList.contains('on'); }
}
