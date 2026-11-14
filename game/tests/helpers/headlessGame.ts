// Task studio-death-retry-render-fix-20261114-044607-01: the REAL Game (src/game.ts: every lane install, the asset boot, the campaign
// lifecycle, the warm-up, the atmosphere pipeline) running in Node on three r186's real WebGPURenderer over the VALIDATING no-op device
// (helpers/validatingWebgpu.ts). The browser surface it needs is faked here: a registry DOM (one element per selector), document /
// window events + pointer lock, a frame-batched requestAnimationFrame driven by timers (every queued callback of a frame runs with the
// same timestamp, as in a browser), fetch of game/public, <img> loads that "decode" at once, localStorage and a silent AudioContext.
// Nothing is drawn: what a test reads is the device log (dropped submits and why) and the game's own state.
import {existsSync, readFileSync, statSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {vi} from 'vitest';
import {ShimCanvas} from './canvas2d';
import {FakeCtx, fakeBuffer} from './fakeAudio';
import {stubValidatingWebgpu, type GpuLog} from './validatingWebgpu';

const PUBLIC = fileURLToPath(new URL('../../public/', import.meta.url));

type Listener = (e: unknown) => void;
class Events {
  readonly listeners = new Map<string, Listener[]>();
  addEventListener(t: string, f: Listener): void { const l = this.listeners.get(t) ?? []; l.push(f); this.listeners.set(t, l); }
  removeEventListener(t: string, f: Listener): void { const l = this.listeners.get(t); if (l) { const i = l.indexOf(f); if (i >= 0) l.splice(i, 1); } }
  dispatchEvent(e: {type: string}): boolean { for (const f of [...(this.listeners.get(e.type) ?? [])]) { try { f.call(this, e); } catch (err) { console.warn('headless listener', e.type, err); } } return true; }
  emit(type: string, extra: Record<string, unknown> = {}): void { this.dispatchEvent({type, target: this, preventDefault() {}, stopPropagation() {}, ...extra} as {type: string}); }
}

/** A forgiving element: one per selector (registry), children, classes, attributes, events; no layout. */
export class El extends Events {
  readonly children: El[] = [];
  readonly dataset: Record<string, string> = {};
  readonly style: Record<string, unknown> = {setProperty() {}, removeProperty() {}, getPropertyValue: () => ''};
  readonly attrs = new Map<string, string>();
  parent: El | null = null;
  textContent = ''; title = ''; id = ''; value = ''; checked = false; disabled = false; hidden = false; type = ''; href = ''; download = ''; rel = '';
  tabIndex = 0; open = false; src = ''; alt = ''; selectedIndex = 0; placeholder = ''; name = ''; htmlFor = '';
  scrollTop = 0; scrollLeft = 0; offsetWidth = 0; offsetHeight = 0; clientWidth = 0; clientHeight = 0; scrollHeight = 0; scrollWidth = 0;
  private cls = new Set<string>();
  constructor(readonly tagName = 'DIV', readonly registry?: Map<string, El>) { super(); }
  get className(): string { return [...this.cls].join(' '); }
  set className(v: string) { this.cls = new Set(String(v).split(/\s+/).filter(Boolean)); }
  readonly classList = {
    add: (...c: string[]) => { for (const x of c) this.cls.add(x); },
    remove: (...c: string[]) => { for (const x of c) this.cls.delete(x); },
    toggle: (c: string, on?: boolean) => { const want = on ?? !this.cls.has(c); if (want) this.cls.add(c); else this.cls.delete(c); return want; },
    contains: (c: string) => this.cls.has(c),
    replace: (a: string, b: string) => { this.cls.delete(a); this.cls.add(b); },
  };
  get options(): El[] { return this.children; }
  private html = '';
  get innerHTML(): string { return this.html; }
  /** As helpers/fakeDom.ts: top-level `<div class="…slot…" data-…>` slots become child elements (the HUD / inventory pattern). */
  set innerHTML(v: string) {
    this.html = v;
    this.children.length = 0;
    const re = /<div class="([^"]*)"((?:\s+[\w-]+="[^"]*")*)[^>]*>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(v))) {
      if (!/\bslot\b/.test(m[1])) continue;
      const c = new El('DIV', this.registry);
      c.className = m[1];
      for (const a of m[2].matchAll(/([\w-]+)="([^"]*)"/g)) {
        if (a[1].startsWith('data-')) c.dataset[a[1].slice(5).replace(/-(\w)/g, (_, x: string) => x.toUpperCase())] = a[2];
        else if (a[1] === 'title') c.title = a[2];
        else c.attrs.set(a[1], a[2]);
      }
      c.parent = this;
      this.children.push(c);
    }
  }
  querySelector(sel: string): El | null {
    const r = this.registry;
    if (!r) return null;
    let e = r.get(sel);
    if (!e) { e = new El('DIV', r); if (sel.startsWith('#')) e.id = sel.slice(1); r.set(sel, e); }
    return e;
  }
  querySelectorAll(): El[] { return []; }
  getElementsByClassName(): El[] { return []; }
  getElementsByTagName(): El[] { return []; }
  appendChild<T extends El>(c: T): T { c.parent = this; this.children.push(c); return c; }
  append(...c: (El | string)[]): void { for (const x of c) if (typeof x !== 'string') this.appendChild(x); }
  prepend(...c: (El | string)[]): void { for (const x of c) if (typeof x !== 'string') { x.parent = this; this.children.unshift(x); } }
  insertBefore<T extends El>(c: T, ref?: El | null): T { const i = ref ? this.children.indexOf(ref) : -1; if (i < 0) return this.appendChild(c); c.parent = this; this.children.splice(i, 0, c); return c; }
  insertAdjacentElement(_w: string, c: El): El { return this.appendChild(c); }
  insertAdjacentHTML(): void {}
  removeChild<T extends El>(c: T): T { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); c.parent = null; return c; }
  replaceChildren(...c: El[]): void { this.children.length = 0; this.append(...c); }
  replaceWith(): void {}
  remove(): void { this.parent?.removeChild(this); }
  contains(): boolean { return false; }
  closest(): El | null { return null; }
  matches(): boolean { return false; }
  cloneNode(): El { return new El(this.tagName, this.registry); }
  setAttribute(k: string, v: string): void { this.attrs.set(k, String(v)); }
  getAttribute(k: string): string | null { return this.attrs.get(k) ?? null; }
  hasAttribute(k: string): boolean { return this.attrs.has(k); }
  removeAttribute(k: string): void { this.attrs.delete(k); }
  toggleAttribute(k: string, on?: boolean): boolean { const want = on ?? !this.attrs.has(k); if (want) this.attrs.set(k, ''); else this.attrs.delete(k); return want; }
  getBoundingClientRect() { return {left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0}; }
  getClientRects(): unknown[] { return []; }
  animate() { return {cancel() {}, finished: Promise.resolve(), onfinish: null}; }
  getAnimations(): {cancel(): void}[] { return []; }
  focus(): void {} blur(): void {} click(): void { this.emit('click'); } scrollIntoView(): void {} scrollTo(): void {} select(): void {}
  showModal(): void { this.open = true; } show(): void { this.open = true; } close(): void { this.open = false; }
  setPointerCapture(): void {} releasePointerCapture(): void {} hasPointerCapture(): boolean { return false; }
  getContext(): null { return null; }
  get firstChild(): El | null { return this.children[0] ?? null; }
  get lastChild(): El | null { return this.children[this.children.length - 1] ?? null; }
  get firstElementChild(): El | null { return this.firstChild; }
  get lastElementChild(): El | null { return this.lastChild; }
  get childElementCount(): number { return this.children.length; }
  get parentElement(): El | null { return this.parent; }
  get parentNode(): El | null { return this.parent; }
  get nextElementSibling(): El | null { return null; }
  get previousElementSibling(): El | null { return null; }
  get isConnected(): boolean { return true; }
  get ownerDocument(): unknown { return (globalThis as {document?: unknown}).document; }
}

/** An <img> that "decodes" on the next tick (16 x 16): three's ImageLoader / TextureLoader path. */
class FakeImg extends Events {
  width = 16; height = 16; naturalWidth = 16; naturalHeight = 16; complete = false; crossOrigin: string | null = null; decoding = 'async';
  private s = '';
  get src(): string { return this.s; }
  set src(v: string) { this.s = v; setTimeout(() => { this.complete = true; this.emit('load'); }, 0); }
  decode(): Promise<void> { return Promise.resolve(); }
}

/** A memory Storage. */
export class MemStorage {
  readonly map = new Map<string, string>();
  get length(): number { return this.map.size; }
  key(i: number): string | null { return [...this.map.keys()][i] ?? null; }
  getItem(k: string): string | null { return this.map.get(k) ?? null; }
  setItem(k: string, v: string): void { this.map.set(k, String(v)); }
  removeItem(k: string): void { this.map.delete(k); }
  clear(): void { this.map.clear(); }
}

class SilentAudio extends FakeCtx {
  decodeAudioData(_b: ArrayBuffer, ok?: (b: unknown) => void): Promise<unknown> { const b = fakeBuffer(0.5); ok?.(b); return Promise.resolve(b); }
  createScriptProcessor() { return {connect() {}, disconnect() {}, onaudioprocess: null}; }
  createAnalyser() { return {connect() {}, disconnect() {}, fftSize: 32, frequencyBinCount: 16, getFloatTimeDomainData() {}, getByteFrequencyData() {}}; }
  createWaveShaper() { return {connect() {}, disconnect() {}, curve: null}; }
  createChannelMerger() { return {connect() {}, disconnect() {}}; }
  createChannelSplitter() { return {connect() {}, disconnect() {}}; }
  close(): Promise<void> { return Promise.resolve(); }
}

export interface Headless {
  canvas: HTMLCanvasElement;
  log: GpuLog;
  doc: El & Record<string, unknown>;
  storage: MemStorage;
  /** Frames delivered so far (each = one batch of rAF callbacks). */
  frames(): number;
  /** Resolves after `n` more frame batches. */
  waitFrames(n: number): Promise<void>;
  /** Stops the frame driver. */
  stop(): void;
  /** window.innerWidth / innerHeight + a 'resize' event (the game's resize listener). */
  resizeWindow(w: number, h: number): void;
}

/** Install every global the game boot touches. `storage` = a pre-filled localStorage (a "fresh page" over an existing save). */
export function installHeadless(o: {storage?: MemStorage; width?: number; height?: number; frameMs?: number} = {}): Headless {
  let queue: {h: number; cb: FrameRequestCallback}[] = [];
  let handle = 1, frames = 0, stopped = false;
  const cancelled = new Set<number>();
  const waiters: {at: number; res: () => void}[] = [];
  const raf = (cb: FrameRequestCallback) => { const h = handle++; queue.push({h, cb}); return h; };
  const caf = (h: number) => { cancelled.add(h); };
  const {canvas, log} = stubValidatingWebgpu({raf, cancelRaf: caf, width: o.width ?? 1280, height: o.height ?? 720});
  const tick = () => {
    if (stopped) return;
    const q = queue;
    queue = [];
    const now = performance.now();
    for (const {h, cb} of q) if (!cancelled.has(h)) { try { cb(now); } catch (err) { console.warn('headless rAF callback threw', err); } }
    frames++;
    for (let i = waiters.length - 1; i >= 0; i--) if (frames >= waiters[i].at) { waiters[i].res(); waiters.splice(i, 1); }
    setTimeout(tick, o.frameMs ?? 4);
  };
  setTimeout(tick, 0);

  const registry = new Map<string, El>();
  const doc = new El('#document', registry) as El & Record<string, unknown>;
  const make = (t: string) => (t.toLowerCase() === 'canvas' ? new ShimCanvas(false) : new El(t.toUpperCase(), registry));
  Object.assign(doc, {
    head: new El('HEAD', registry), body: new El('BODY', registry), documentElement: new El('HTML', registry),
    createElement: make, createElementNS: (_ns: string, t: string) => (t === 'img' ? new FakeImg() : make(t)),
    createTextNode: (t: string) => ({textContent: t}), createDocumentFragment: () => new El('#fragment', registry),
    getElementById: (id: string) => doc.querySelector('#' + id),
    baseURI: 'http://localhost/', hidden: false, visibilityState: 'visible', activeElement: null, pointerLockElement: null, fullscreenElement: null,
    hasFocus: () => true, fonts: {ready: Promise.resolve(), load: () => Promise.resolve([])},
    exitPointerLock: () => { if (doc.pointerLockElement) { doc.pointerLockElement = null; setTimeout(() => doc.emit('pointerlockchange'), 0); } },
    exitFullscreen: () => Promise.resolve(),
  });
  (canvas as unknown as {requestPointerLock: () => Promise<void>}).requestPointerLock = () => {
    doc.pointerLockElement = canvas;
    setTimeout(() => doc.emit('pointerlockchange'), 0);
    return Promise.resolve();
  };
  const c = canvas as unknown as Record<string, unknown>;
  c.focus = () => {}; c.blur = () => {}; c.parentElement = doc.body; c.dataset = {}; c.classList = {add() {}, remove() {}, toggle() {}, contains: () => false};

  const win = new Events() as Events & Record<string, unknown>;
  const storage = o.storage ?? new MemStorage();
  vi.stubGlobal('document', doc);
  vi.stubGlobal('localStorage', storage);
  vi.stubGlobal('sessionStorage', new MemStorage());
  vi.stubGlobal('location', {search: '', hash: '', href: 'http://localhost/', origin: 'http://localhost', pathname: '/', host: 'localhost', hostname: 'localhost', protocol: 'http:', reload() {}});
  vi.stubGlobal('isSecureContext', true);
  vi.stubGlobal('innerWidth', o.width ?? 1280);
  vi.stubGlobal('innerHeight', o.height ?? 720);
  vi.stubGlobal('devicePixelRatio', 1);
  vi.stubGlobal('AudioContext', SilentAudio);
  vi.stubGlobal('Image', FakeImg);
  vi.stubGlobal('HTMLCanvasElement', ShimCanvas);
  vi.stubGlobal('HTMLImageElement', FakeImg);
  vi.stubGlobal('HTMLElement', El);
  vi.stubGlobal('Element', El);
  vi.stubGlobal('Node', El);
  vi.stubGlobal('matchMedia', () => ({matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}}));
  vi.stubGlobal('getComputedStyle', () => ({getPropertyValue: () => '', width: '0px', height: '0px'}));
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('addEventListener', win.addEventListener.bind(win));
  vi.stubGlobal('removeEventListener', win.removeEventListener.bind(win));
  vi.stubGlobal('dispatchEvent', win.dispatchEvent.bind(win));
  vi.stubGlobal('window', globalThis);
  const nav = (globalThis as unknown as {navigator: Record<string, unknown>}).navigator;
  Object.assign(nav, {getGamepads: () => [], language: 'en-CA', languages: ['en-CA'], hardwareConcurrency: 8, deviceMemory: 8, platform: 'Linux', vendor: '', maxTouchPoints: 0, storage: {estimate: () => Promise.resolve({})}});
  const realFetch = globalThis.fetch;
  vi.stubGlobal('fetch', async (input: unknown, init?: unknown) => {
    const url = typeof input === 'string' ? input : (input as {url?: string})?.url ?? String(input);
    const u = new URL(url, 'http://localhost/');
    if (u.protocol === 'blob:' || u.protocol === 'data:') return realFetch(url, init as RequestInit);
    const p = join(PUBLIC, decodeURIComponent(u.pathname));
    if (!existsSync(p) || statSync(p).isDirectory()) return new Response('not found', {status: 404, statusText: 'Not Found'});
    const body = readFileSync(p);
    return new Response(body, {status: 200, headers: {'content-length': String(body.byteLength)}});
  });
  return {
    canvas, log, doc, storage,
    frames: () => frames,
    waitFrames: n => new Promise<void>(res => waiters.push({at: frames + n, res})),
    stop: () => { stopped = true; },
    resizeWindow: (w, h) => { vi.stubGlobal('innerWidth', w); vi.stubGlobal('innerHeight', h); win.emit('resize'); },
  };
}
