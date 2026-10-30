// Task office-overhaul-20261030 (lane INTERACT): a deliberately tiny fake DOM for Node tests of ui/hud.ts, ui/inventoryUI.ts and
// ui/gearStyles.ts — no layout, no events. `querySelector(sel)` returns ONE persistent element per selector (so the HUD's
// '#hotbar' is the same object every call); setting `innerHTML` parses top-level `<div class="…" data-bar="…" data-index="…">`
// slots into child elements (the pattern ui/hud.ts and ui/inventoryUI.ts write), so tests can read slot classes / contents.

export class FakeEl {
  readonly children: FakeEl[] = [];
  readonly dataset: Record<string, string> = {};
  readonly style: Record<string, unknown> = {setProperty() {}, removeProperty() {}};
  readonly attrs = new Map<string, string>();
  readonly listeners = new Map<string, ((e: unknown) => void)[]>();
  parent: FakeEl | null = null;
  textContent = '';
  title = '';
  id = '';
  disabled = false;
  private html = '';
  private cls = new Set<string>();
  constructor(readonly tag = 'div', readonly registry?: Map<string, FakeEl>) {}

  get className(): string { return [...this.cls].join(' '); }
  set className(v: string) { this.cls = new Set(v.split(/\s+/).filter(Boolean)); }
  readonly classList = {
    add: (...c: string[]) => { for (const x of c) this.cls.add(x); },
    remove: (...c: string[]) => { for (const x of c) this.cls.delete(x); },
    toggle: (c: string, on?: boolean) => { const want = on ?? !this.cls.has(c); if (want) this.cls.add(c); else this.cls.delete(c); return want; },
    contains: (c: string) => this.cls.has(c),
  };

  get innerHTML(): string { return this.html; }
  set innerHTML(v: string) {
    this.html = v;
    this.children.length = 0;
    const re = /<div class="([^"]*)"((?:\s+[\w-]+="[^"]*")*)[^>]*>/g;
    let m: RegExpExecArray | null;
    // top-level slots only: each slot is written as `<div class="slot…" data-bar=… data-index=…>…</div>`
    while ((m = re.exec(v))) {
      if (!/\bslot\b/.test(m[1])) continue;
      const c = new FakeEl('div', this.registry);
      c.className = m[1];
      for (const a of m[2].matchAll(/([\w-]+)="([^"]*)"/g)) {
        if (a[1].startsWith('data-')) c.dataset[a[1].slice(5).replace(/-(\w)/g, (_, x: string) => x.toUpperCase())] = a[2];
        else if (a[1] === 'title') c.title = a[2];
        else c.attrs.set(a[1], a[2]);
      }
      c.parent = this;
      this.children.push(c);
    }
    // a slot's own markup (key, icon, name, count) for content checks: the text up to the next top-level slot
    const starts = [...v.matchAll(/<div class="[^"]*\bslot\b[^"]*"/g)].map(x => x.index!);
    starts.forEach((s, i) => { const child = this.children[i]; if (child) child.html = v.slice(s, starts[i + 1] ?? v.length); });
  }

  querySelector(sel: string): FakeEl | null {
    const r = this.registry;
    if (!r) return null;
    let e = r.get(sel);
    if (!e) { e = new FakeEl('div', r); r.set(sel, e); }
    return e;
  }
  querySelectorAll(): FakeEl[] { return []; }
  addEventListener(type: string, fn: (e: unknown) => void): void { const l = this.listeners.get(type) ?? []; l.push(fn); this.listeners.set(type, l); }
  removeEventListener(): void {}
  appendChild<T extends FakeEl>(c: T): T { c.parent = this; this.children.push(c); return c; }
  /** Task gasmask-breach-20261030 (mask lane): honours the reference child (the camera mask goes first in #hud), else appends. */
  insertBefore<T extends FakeEl>(c: T, ref?: FakeEl | null): T {
    const i = ref ? this.children.indexOf(ref) : -1;
    if (i < 0) return this.appendChild(c);
    c.parent = this;
    this.children.splice(i, 0, c);
    return c;
  }
  get firstChild(): FakeEl | null { return this.children[0] ?? null; }
  remove(): void { if (this.parent) { const i = this.parent.children.indexOf(this); if (i >= 0) this.parent.children.splice(i, 1); } }
  closest(): FakeEl | null { return null; }
  setAttribute(k: string, v: string): void { this.attrs.set(k, v); }
  getAttribute(k: string): string | null { return this.attrs.get(k) ?? null; }
  getBoundingClientRect() { return {left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0}; }
  animate() { return {cancel() {}}; }
  getAnimations(): {cancel(): void}[] { return []; }
  focus(): void {}
  get previousElementSibling(): FakeEl | null { return null; }
  get parentElement(): FakeEl | null { return this.parent; }
}

export interface FakeDom { doc: FakeEl & {head: FakeEl; body: FakeEl; createElement(t: string): FakeEl; activeElement: null}; el(sel: string): FakeEl; uninstall(): void }

/** Install a fake `document` / `window` on globalThis (only where absent); returns accessors and an uninstall. */
export function installFakeDom(): FakeDom {
  const g = globalThis as unknown as Record<string, unknown>;
  const prevDoc = g.document, prevWin = g.window;
  const registry = new Map<string, FakeEl>();
  const doc = new FakeEl('document', registry) as FakeDom['doc'];
  doc.head = new FakeEl('head', registry);
  doc.body = new FakeEl('body', registry);
  doc.createElement = (t: string) => new FakeEl(t, registry);
  (doc as unknown as {activeElement: null}).activeElement = null;
  g.document = doc;
  g.window = g.window ?? {addEventListener() {}, removeEventListener() {}, innerHeight: 720, innerWidth: 1280};
  return {
    doc,
    el: (sel: string) => doc.querySelector(sel)!,
    uninstall: () => { g.document = prevDoc; g.window = prevWin; },
  };
}
