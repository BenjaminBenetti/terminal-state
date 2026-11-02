// Task studio-alpha-campaign-foundation-20261102-230708-01 (lane NET): a small but real-enough DOM for Node tests of ui/paperMap.ts
// (no layout, no CSS). Elements with attributes / classes / dataset / style / children; an innerHTML parser for well-formed markup
// (tags, double-quoted attributes, text, the five basic entities); selectors (tag, #id, .class, [attr], [attr="v"], compound and
// descendant, comma lists) for querySelector(All) / matches / closest; contains / focus / document.activeElement; events dispatched
// in the browser's order — window capture -> document -> ancestors -> target -> bubble back to window — with preventDefault,
// stopPropagation and stopImmediatePropagation. installMiniDom() puts `document` / `window` on globalThis (restored by uninstall).

type Fn = (e: MiniEvent) => void;
interface Listener { fn: Fn; capture: boolean }

export class MiniEvent {
  target: unknown = null;
  currentTarget: unknown = null;
  defaultPrevented = false;
  stopped = false;
  immediate = false;
  readonly bubbles: boolean;
  [k: string]: unknown;
  constructor(readonly type: string, init: Record<string, unknown> = {}) {
    this.bubbles = init.bubbles !== false;
    for (const [k, v] of Object.entries(init)) if (k !== 'bubbles') this[k] = v;
  }
  preventDefault(): void { this.defaultPrevented = true; }
  stopPropagation(): void { this.stopped = true; }
  stopImmediatePropagation(): void { this.stopped = true; this.immediate = true; }
}

class Target {
  readonly listeners = new Map<string, Listener[]>();
  addEventListener(type: string, fn: Fn, o?: boolean | {capture?: boolean; passive?: boolean}): void {
    const capture = typeof o === 'boolean' ? o : !!o?.capture;
    const l = this.listeners.get(type) ?? [];
    if (!l.some(x => x.fn === fn && x.capture === capture)) l.push({fn, capture});
    this.listeners.set(type, l);
  }
  removeEventListener(type: string, fn: Fn, o?: boolean | {capture?: boolean}): void {
    const capture = typeof o === 'boolean' ? o : !!o?.capture;
    const l = this.listeners.get(type);
    if (l) this.listeners.set(type, l.filter(x => !(x.fn === fn && x.capture === capture)));
  }
  count(type: string, capture?: boolean): number {
    return (this.listeners.get(type) ?? []).filter(x => capture === undefined || x.capture === capture).length;
  }
  /** Run this node's listeners of one phase (at the target: capture listeners first, then the others). */
  fire(e: MiniEvent, phase: 'capture' | 'target' | 'bubble'): void {
    const list = (this.listeners.get(e.type) ?? []).slice();
    const order = phase === 'target' ? [...list.filter(l => l.capture), ...list.filter(l => !l.capture)] : list.filter(l => l.capture === (phase === 'capture'));
    e.currentTarget = this;
    for (const l of order) {
      l.fn(e);
      if (e.immediate) return;
    }
  }
}

export class MiniText {
  parent: MiniEl | null = null;
  constructor(public data: string) {}
  get textContent(): string { return this.data; }
}

const decode = (s: string) => s.replace(/&(amp|lt|gt|quot|#39);/g, (_, n: string) => ({amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'"})[n] ?? '');
const VOID = new Set(['input', 'br', 'img', 'meta', 'link', 'hr']);

interface Compound { tag?: string; id?: string; classes: string[]; attrs: {name: string; value?: string}[] }

function parseSelector(sel: string): Compound[][] {
  return sel.split(',').map(part => part.trim().split(/\s+/).filter(Boolean).map(tok => {
    const c: Compound = {classes: [], attrs: []};
    const re = /^([\w-]+|\*)|#([\w-]+)|\.([\w-]+)|\[([\w-]+)(?:="([^"]*)")?\]/g;
    let m: RegExpExecArray | null;
    let used = 0;
    while ((m = re.exec(tok)) && m[0]) {
      if (m.index !== used) break;
      used += m[0].length;
      if (m[1] && m[1] !== '*') c.tag = m[1].toUpperCase();
      else if (m[2]) c.id = m[2];
      else if (m[3]) c.classes.push(m[3]);
      else if (m[4]) c.attrs.push({name: m[4], value: m[5]});
      re.lastIndex = used;
    }
    if (used !== tok.length) throw new Error(`miniDom: unsupported selector ${sel}`);
    return c;
  }));
}

export class MiniEl extends Target {
  parent: MiniEl | null = null;
  children: (MiniEl | MiniText)[] = [];
  readonly attrs = new Map<string, string>();
  readonly style: Record<string, unknown> & {setProperty(k: string, v: string): void; removeProperty(k: string): void};
  readonly tagName: string;
  constructor(readonly doc: MiniDocument | null, tag: string) {
    super();
    this.tagName = tag.toUpperCase();
    const style: Record<string, unknown> = {};
    style.setProperty = (k: string, v: string) => { style[k] = v; };
    style.removeProperty = (k: string) => { delete style[k]; };
    this.style = style as MiniEl['style'];
  }

  get id(): string { return this.attrs.get('id') ?? ''; }
  set id(v: string) { this.attrs.set('id', v); }
  get className(): string { return this.attrs.get('class') ?? ''; }
  set className(v: string) { this.attrs.set('class', v); }
  private get cls(): string[] { return this.className.split(/\s+/).filter(Boolean); }
  readonly classList = {
    add: (...c: string[]) => { this.className = [...new Set([...this.cls, ...c])].join(' '); },
    remove: (...c: string[]) => { this.className = this.cls.filter(x => !c.includes(x)).join(' '); },
    toggle: (c: string, on?: boolean) => { const want = on ?? !this.cls.includes(c); if (want) this.classList.add(c); else this.classList.remove(c); return want; },
    contains: (c: string) => this.cls.includes(c),
  };
  get dataset(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [k, v] of this.attrs) if (k.startsWith('data-')) out[k.slice(5).replace(/-(\w)/g, (_, x: string) => x.toUpperCase())] = v;
    return out;
  }
  getAttribute(k: string): string | null { return this.attrs.get(k) ?? null; }
  setAttribute(k: string, v: string): void { this.attrs.set(k, String(v)); }
  removeAttribute(k: string): void { this.attrs.delete(k); }
  hasAttribute(k: string): boolean { return this.attrs.has(k); }

  appendChild<T extends MiniEl | MiniText>(c: T): T {
    if (c.parent) c.parent.children.splice(c.parent.children.indexOf(c), 1);
    c.parent = this;
    this.children.push(c);
    return c;
  }
  removeChild<T extends MiniEl | MiniText>(c: T): T {
    const i = this.children.indexOf(c);
    if (i >= 0) { this.children.splice(i, 1); c.parent = null; }
    return c;
  }
  remove(): void { this.parent?.removeChild(this); }
  get parentElement(): MiniEl | null { return this.parent; }
  get firstChild(): MiniEl | MiniText | null { return this.children[0] ?? null; }
  get elements(): MiniEl[] { return this.children.filter((c): c is MiniEl => c instanceof MiniEl); }
  contains(o: unknown): boolean {
    for (let n = o as MiniEl | MiniText | null; n; n = n.parent) if (n === this) return true;
    return false;
  }

  get textContent(): string { return this.children.map(c => c.textContent).join(''); }
  set textContent(v: string) { for (const c of this.children) c.parent = null; this.children = []; if (v) this.appendChild(new MiniText(String(v))); }

  get innerHTML(): string { return this.children.map(c => (c instanceof MiniText ? c.data : c.outerHTML)).join(''); }
  set innerHTML(html: string) {
    for (const c of this.children) c.parent = null;
    this.children = [];
    const stack: MiniEl[] = [this];
    const re = /<!--[\s\S]*?-->|<\/([\w:-]+)\s*>|<([\w:-]+)((?:\s+[\w:-]+(?:="[^"]*")?)*)\s*(\/?)>|([^<]+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html))) {
      const top = stack[stack.length - 1];
      if (m[1]) {
        const tag = m[1].toUpperCase();
        const at = stack.map(s => s.tagName).lastIndexOf(tag);
        if (at > 0) stack.length = at;
      } else if (m[2]) {
        const el = new MiniEl(this.doc, m[2]);
        for (const a of m[3].matchAll(/([\w:-]+)(?:="([^"]*)")?/g)) el.attrs.set(a[1], decode(a[2] ?? ''));
        top.appendChild(el);
        if (!m[4] && !VOID.has(m[2].toLowerCase())) stack.push(el);
      } else if (m[5] !== undefined) top.appendChild(new MiniText(decode(m[5])));
    }
  }
  get outerHTML(): string {
    const a = [...this.attrs].map(([k, v]) => ` ${k}="${v.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"`).join('');
    return `<${this.tagName.toLowerCase()}${a}>${this.innerHTML}</${this.tagName.toLowerCase()}>`;
  }

  private matchesCompound(c: Compound): boolean {
    if (c.tag && this.tagName !== c.tag) return false;
    if (c.id && this.id !== c.id) return false;
    for (const k of c.classes) if (!this.classList.contains(k)) return false;
    for (const a of c.attrs) { if (!this.attrs.has(a.name)) return false; if (a.value !== undefined && this.attrs.get(a.name) !== a.value) return false; }
    return true;
  }
  private matchesChain(chain: Compound[]): boolean {
    if (!this.matchesCompound(chain[chain.length - 1])) return false;
    let i = chain.length - 2;
    for (let p = this.parent; p && i >= 0; p = p.parent) if (p.matchesCompound(chain[i])) i--;
    return i < 0;
  }
  matches(sel: string): boolean { return parseSelector(sel).some(ch => this.matchesChain(ch)); }
  closest(sel: string): MiniEl | null {
    const chains = parseSelector(sel);
    for (let n: MiniEl | null = this; n; n = n.parent) if (chains.some(ch => n!.matchesChain(ch))) return n;
    return null;
  }
  querySelectorAll(sel: string): MiniEl[] {
    const chains = parseSelector(sel), out: MiniEl[] = [];
    const walk = (e: MiniEl) => { for (const c of e.elements) { if (chains.some(ch => c.matchesChain(ch))) out.push(c); walk(c); } };
    walk(this);
    return out;
  }
  querySelector(sel: string): MiniEl | null { return this.querySelectorAll(sel)[0] ?? null; }

  focus(): void { if (this.doc) this.doc.activeElement = this; }
  blur(): void { if (this.doc && this.doc.activeElement === this) this.doc.activeElement = this.doc.body; }
  getBoundingClientRect() { return {left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0}; }

  /** Dispatch along window -> document -> ancestors -> this (capture), this (target), back up (bubble). */
  dispatchEvent(e: MiniEvent): boolean {
    e.target = this;
    const anc: Target[] = [];
    for (let p = this.parent; p; p = p.parent) anc.unshift(p);
    const doc = this.doc;
    const path: Target[] = [...(doc ? [doc.window, doc] : []), ...anc];
    for (const n of path) { n.fire(e, 'capture'); if (e.stopped) return !e.defaultPrevented; }
    this.fire(e, 'target');
    if (e.stopped || !e.bubbles) return !e.defaultPrevented;
    for (const n of path.reverse()) { n.fire(e, 'bubble'); if (e.stopped) break; }
    return !e.defaultPrevented;
  }
}

export class MiniWindow extends Target {
  innerWidth: number;
  innerHeight: number;
  constructor(w: number, h: number) { super(); this.innerWidth = w; this.innerHeight = h; }
  dispatchEvent(e: MiniEvent): boolean {
    e.target = this;
    this.fire(e, 'target');
    return !e.defaultPrevented;
  }
}

export class MiniDocument extends Target {
  readonly documentElement: MiniEl;
  readonly head: MiniEl;
  readonly body: MiniEl;
  activeElement: MiniEl | null;
  fullscreenElement: null = null;
  pointerLockElement: null = null;
  hidden = false;
  constructor(readonly window: MiniWindow) {
    super();
    this.documentElement = new MiniEl(this, 'html');
    this.head = this.documentElement.appendChild(new MiniEl(this, 'head'));
    this.body = this.documentElement.appendChild(new MiniEl(this, 'body'));
    this.activeElement = this.body;
  }
  createElement(tag: string): MiniEl { return new MiniEl(this, tag); }
  createElementNS(_ns: string, tag: string): MiniEl { return new MiniEl(this, tag); }
  createTextNode(t: string): MiniText { return new MiniText(t); }
  querySelector(sel: string): MiniEl | null { return this.documentElement.querySelector(sel); }
  querySelectorAll(sel: string): MiniEl[] { return this.documentElement.querySelectorAll(sel); }
  getElementById(id: string): MiniEl | null { return this.documentElement.querySelector(`#${id}`); }
  dispatchEvent(e: MiniEvent): boolean { return this.documentElement.dispatchEvent(e); }
}

export interface MiniDom {
  doc: MiniDocument;
  win: MiniWindow;
  /** keydown (+ keyup) on the focused element (the body when nothing is focused); returns the keydown event. */
  key(code: string, o?: Record<string, unknown>): MiniEvent;
  /** Type characters as Digit / Key codes. */
  type(chars: string): MiniEvent[];
  /** A click on an element (bubbles). */
  click(el: MiniEl | null): MiniEvent;
  uninstall(): void;
}

/** Install a fresh document / window (viewport w x h) on globalThis. */
export function installMiniDom(w = 1280, h = 720): MiniDom {
  const g = globalThis as Record<string, unknown>;
  const prev = {document: g.document, window: g.window};
  const win = new MiniWindow(w, h);
  const doc = new MiniDocument(win);
  g.window = win;
  g.document = doc;
  const key = (code: string, o: Record<string, unknown> = {}) => {
    const el = doc.activeElement ?? doc.body;
    const e = new MiniEvent('keydown', {code, key: o.key ?? code, repeat: false, ctrlKey: false, altKey: false, metaKey: false, shiftKey: false, cancelable: true, ...o});
    el.dispatchEvent(e);
    el.dispatchEvent(new MiniEvent('keyup', {code, key: o.key ?? code}));
    return e;
  };
  return {
    doc, win, key,
    type: chars => [...chars].map(c => key(/[0-9]/.test(c) ? `Digit${c}` : `Key${c.toUpperCase()}`, {key: c})),
    click: el => { const e = new MiniEvent('click', {button: 0}); if (!el) throw new Error('miniDom: click on null'); el.dispatchEvent(e); return e; },
    uninstall: () => { g.document = prev.document; g.window = prev.window; },
  };
}
