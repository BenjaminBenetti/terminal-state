// Task studio-gi-mood-bounce-loading-20261115-081523-01 (lane LOAD): how three's compileAsync yields during the BLOCKING warm-up, and
// where a warm-up's compile time goes.
//
// three r186's compileAsync awaits yieldToMain() after every object, and NodeBuilder.buildAsync after every shader stage of every build
// stage (9 per new build): ~11 000 yields in a station load. yieldToMain is the browser's scheduler.yield() where it has one and ONE
// requestAnimationFrame per yield everywhere else — a whole display refresh of waiting per yield with nothing to draw (the loading
// warm-up holds the game's frames), and no progress at all in a hidden tab, which gets no animation frames. Measured with the real Game
// in Node at 16 ms per frame: the same station's materials stage reached 816 of 1518 items before the 120 s budget cut it, 58.6 s of
// that waiting for frames.
//
// installTaskYield() gives three a yield that ends at the next TASK instead — a MessageChannel post (no timer clamp; the browser paints
// and handles input between tasks as it sees fit) — only where scheduler.yield is missing, and only until restore(): the warm-up
// installs it around each of its compileAsync calls and restores it in a finally. A browser that has scheduler.yield is left exactly
// as it is. NEVER during play or the journey: there three's yields must keep following the browser's own scheduling (the in-play
// compile pacing: render/journeyCompile.ts).
//
// observeCompile() reads where a compile call's time went from three's node manager / pipelines (private fields, read defensively:
// anything missing and that part stays null): node builds started and their wall time, pipelines requested asynchronously and the
// time waited for them — so a capture can tell JavaScript from waiting on the GPU process.

interface SchedulerLike { yield?: unknown }
interface SelfLike { scheduler?: SchedulerLike }

/** scheduler: the browser's own scheduler.yield (untouched). task: the warm-up's task-boundary yield. frame: three's animation-frame fallback (nothing could be installed). */
export type YieldMode = 'scheduler' | 'task' | 'frame';

export interface TaskYield {
  readonly mode: YieldMode;
  /** Yields taken through the installed yield and the time waited in them (ms). Zero unless mode is 'task'. */
  yields: number;
  waitMs: number;
  /** Put everything back (idempotent). Yields still pending resolve as usual. */
  restore(): void;
}

/** The global three reads scheduler.yield from (`self`); null where there is none. */
function host(): SelfLike | null {
  try { return typeof self !== 'undefined' ? (self as unknown as SelfLike) : null; } catch { return null; }
}

/** Whether the browser has its own scheduler.yield (three uses it as is). */
export function hasSchedulerYield(): boolean {
  const s = host()?.scheduler;
  return !!s && typeof s.yield !== 'undefined';
}

/**
 * Install a task-boundary yield for three's yieldToMain where scheduler.yield is missing (see the file comment). Always returns a
 * handle: call restore() in a finally.
 */
export function installTaskYield(now: () => number = () => performance.now()): TaskYield {
  const h = host();
  const out: TaskYield = {mode: 'frame', yields: 0, waitMs: 0, restore() {}};
  if (!h) return out;
  if (hasSchedulerYield()) return {...out, mode: 'scheduler'};
  const waiting: (() => void)[] = [];
  let restored = false;
  let port: {post(): void; close(): void} | null = null;
  const next = (): void => { const f = waiting.shift(); if (f) f(); if (restored && waiting.length === 0) { port?.close(); port = null; } };
  try {
    if (typeof MessageChannel === 'function') {
      const ch = new MessageChannel();
      ch.port1.onmessage = next;
      port = {post: () => ch.port2.postMessage(0), close: () => { ch.port1.onmessage = null; ch.port1.close(); ch.port2.close(); }};
    }
  } catch { port = null; }
  const taskYield = (): Promise<void> => new Promise<void>(resolve => {
    const t = now();
    out.yields++;
    waiting.push(() => { out.waitMs += now() - t; resolve(); });
    if (port) port.post(); else setTimeout(next, 0);
  });
  // on the browser's own scheduler object where there is one without yield (it keeps its postTask), else a scheduler of our own
  const existing = h.scheduler;
  const own = existing ?? ({} as SchedulerLike);
  try {
    Object.defineProperty(own, 'yield', {value: taskYield, configurable: true, writable: true, enumerable: false});
    if (!existing) Object.defineProperty(h, 'scheduler', {value: own, configurable: true, writable: true, enumerable: false});
  } catch {
    try { delete own.yield; } catch { /* a sealed scheduler: three keeps its animation-frame fallback */ }
    port?.close();
    return out;
  }
  if (host()?.scheduler?.yield !== taskYield) { port?.close(); return out; } // (the assignment did not take: nothing installed)
  (out as {mode: YieldMode}).mode = 'task';
  out.restore = () => {
    if (restored) return;
    restored = true;
    try {
      if (own.yield === taskYield) delete own.yield;
      if (!existing && h.scheduler === own) delete h.scheduler;
    } catch { /* leave what cannot be removed: a task yield is still a correct yield */ }
    if (waiting.length === 0) { port?.close(); port = null; }
  };
  return out;
}

/** Where a compile's time went (render/warmup.ts WarmupResult.compile). */
export interface CompileSplit {
  /** How three yielded between build stages and objects. */
  yield: YieldMode;
  /** Node builds started and their wall time (ms; the yields inside a build included). Null: three's node manager could not be read. */
  builds: number | null;
  buildMs: number | null;
  /** Pipelines requested asynchronously and the time waited for them (ms: the GPU process / driver). Null: not readable. */
  pipelines: number | null;
  pipelineWaitMs: number | null;
  /** Yields taken and the time waited in them (ms). Null with the browser's own scheduler.yield or animation frames (not instrumented). */
  yields: number | null;
  yieldWaitMs: number | null;
}

export const emptyCompileSplit = (mode: YieldMode = 'frame'): CompileSplit =>
  ({yield: mode, builds: null, buildMs: null, pipelines: null, pipelineWaitMs: null, yields: null, yieldWaitMs: null});

interface NodesLike { _createNodeBuilder?: (...a: unknown[]) => unknown; _createNodeBuilderState?: (...a: unknown[]) => unknown }
interface PipelinesLike { getForRender?: (renderObject: unknown, promises?: unknown[] | null) => unknown }

/**
 * Count into `split` while the returned function has not been called: node builds (from the builder's creation to its finished
 * state) and asynchronous pipeline requests (from the request to the promises' settlement). Wraps instance methods of `renderer`'s
 * node manager / pipelines and puts back exactly what was there. Call the returned function in a finally.
 */
export function observeCompile(renderer: unknown, split: CompileSplit, now: () => number = () => performance.now()): () => void {
  const r = renderer as {_nodes?: NodesLike | null; _pipelines?: PipelinesLike | null} | null;
  const undo: (() => void)[] = [];
  let live = true;
  const wrap = <T extends object>(obj: T, name: keyof T & string, make: (inner: (...a: unknown[]) => unknown) => (...a: unknown[]) => unknown): void => {
    const o = obj as unknown as Record<string, unknown>;
    const inner = o[name] as (...a: unknown[]) => unknown;
    const own = Object.prototype.hasOwnProperty.call(o, name);
    const wrapper = make(inner);
    o[name] = wrapper;
    undo.push(() => { if (o[name] !== wrapper) return; if (own) o[name] = inner; else delete o[name]; });
  };
  const nodes = r?._nodes, pipes = r?._pipelines;
  if (nodes && typeof nodes._createNodeBuilder === 'function' && typeof nodes._createNodeBuilderState === 'function') {
    split.builds ??= 0;
    split.buildMs ??= 0;
    let t0 = -1;
    wrap(nodes, '_createNodeBuilder', inner => function (this: unknown, ...a: unknown[]) { if (live && t0 < 0) t0 = now(); return inner.apply(this, a); });
    wrap(nodes, '_createNodeBuilderState', inner => function (this: unknown, ...a: unknown[]) {
      const res = inner.apply(this, a);
      if (live && t0 >= 0) { split.builds = (split.builds ?? 0) + 1; split.buildMs = (split.buildMs ?? 0) + (now() - t0); }
      t0 = -1;
      return res;
    });
  }
  if (pipes && typeof pipes.getForRender === 'function') {
    split.pipelines ??= 0;
    split.pipelineWaitMs ??= 0;
    wrap(pipes, 'getForRender', inner => function (this: unknown, ...a: unknown[]) {
      const promises = a[1] as unknown[] | null | undefined;
      const n0 = Array.isArray(promises) ? promises.length : 0;
      const res = inner.apply(this, a);
      if (live && Array.isArray(promises) && promises.length > n0) {
        const added = promises.slice(n0), t = now();
        split.pipelines = (split.pipelines ?? 0) + added.length;
        const done = () => { split.pipelineWaitMs = (split.pipelineWaitMs ?? 0) + (now() - t); };
        void Promise.all(added).then(done, done);
      }
      return res;
    });
  }
  return () => { live = false; for (let i = undo.length - 1; i >= 0; i--) undo[i](); undo.length = 0; };
}
