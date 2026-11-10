// Task studio-perf-ao-train-continuity-20261110-022206-01 (lane BUILD; user: less STUTTER): the journey's next station is prepared
// without stopping the picture. Game.travelToStation used to build the destination synchronously while the car ran through the transit
// tunnel (Node: ~1.5-4 s of builders per station in two or three blocks — seconds of frozen frames). The long builders are GENERATORS now
// (world/builder.ts buildWorldSteps, Game.buildSectionSteps, ContainerManager.buildSteps, ShelfStock.buildSteps, the light field bake,
// the fog maps): every `yield` marks a point where the build MAY pause — legal to resume at once or a frame later, never with shared
// state half-written where a frame could read it — and each keeps a synchronous wrapper (drainSync) that runs the identical steps to
// completion, so every other caller (new game, Continue, Retry, menu travel: behind a loading screen; tests; tools) is unchanged: same
// code, same order, same result.
//
// runPaced drains such a generator in SLICES (the journey route only): steps run until `sliceMs` of real time is used, then it waits
// for the next frame to be drawn — requestAnimationFrame, then a zero timer, so the next slice runs after that frame's paint, in the
// idle time before the following one — and continues. A frame that never comes (a hidden / throttled tab: rAF stops) is replaced by a
// timer after `fallbackMs`; while the page is hidden nothing is drawn, so the rest runs at once (a journey never hangs on a background
// tab). The result is the generator's return value, exactly once; a throw inside the build rejects with that error (the generator is
// finished); `alive() === false` before a slice (the world generation changed under the build) closes the generator (its finally blocks
// run) and rejects with PacedBuildCancelled. A slice is never cut inside a step: its length is `sliceMs` plus at most one step, so the
// builders yield at least every few ms of work (tests/paced-build*.test.ts). Stats are main-thread durations (Node or browser), never
// GPU time.

/** A build as steps: `yield` = a possible pause (an optional stage label for diagnostics), the return value = the build's result. */
export type BuildSteps<T> = Generator<string | void, T, void>;

/** Runs every step of `steps` now, in order (the synchronous wrapper of a stepped builder): exactly the work of a paced run. */
export function drainSync<T>(steps: BuildSteps<T>): T {
  let r = steps.next();
  while (!r.done) r = steps.next();
  return r.value;
}

/** Game defaults (tests override per call). */
export const PACED_BUILD = {
  /** Real time a slice may use before it waits for the next frame (ms): a 60 Hz frame keeps ~10 ms for the ride's own frame + the browser. */
  sliceMs: 6,
  /** A frame that has not come after this long (ms; rAF stopped: hidden / throttled tab) is replaced by a timer. */
  fallbackMs: 120,
  /** Per-slice durations kept in the stats (bounded). */
  maxSamples: 4096,
} as const;

/** Thrown (rejected) when `alive()` turned false before a slice: the build was abandoned and its generator closed. */
export class PacedBuildCancelled extends Error {
  constructor() { super('paced build cancelled (the world generation changed)'); this.name = 'PacedBuildCancelled'; }
}

export interface PacedBuildStats {
  /** Slices run (each followed by a wait for a frame, except the last). */
  slices: number;
  /** Generator steps (next() calls) run. */
  steps: number;
  /** Main-thread time inside the build (ms; the sum of the slices). */
  workMs: number;
  /** Longest slice / longest single step (ms). */
  maxSliceMs: number;
  maxStepMs: number;
  /** Waits for a frame; waits that ended on the fallback timer; steps run without a wait while the page was hidden. */
  waits: number;
  fallbacks: number;
  hiddenSteps: number;
  /** Per-slice durations (ms; the first PACED_BUILD.maxSamples). */
  sliceMs: number[];
  /** Stage label -> main-thread ms (a labelled yield starts a stage: its steps up to the next labelled yield; '(start)' before the first). */
  stages: Record<string, number>;
}

export const newPacedStats = (): PacedBuildStats => ({slices: 0, steps: 0, workMs: 0, maxSliceMs: 0, maxStepMs: 0, waits: 0, fallbacks: 0, hiddenSteps: 0, sliceMs: [], stages: {}});

export interface PacedBuildOptions {
  sliceMs?: number;
  fallbackMs?: number;
  /** Main-thread clock (ms; default performance.now). */
  now?: () => number;
  /** Calls `go` once the next frame was drawn (default: requestAnimationFrame, then a zero timer; setTimeout 16 ms without rAF). */
  frame?: (go: () => void) => void;
  /** Timer for the fallback (default setTimeout / clearTimeout). */
  timer?: (go: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  /** True while nothing is drawn (default: document.visibilityState === 'hidden'). */
  hidden?: () => boolean;
  /** False = the build must stop (checked before every slice). */
  alive?: () => boolean;
  /** Filled while the build runs (default: a fresh object, discarded). */
  stats?: PacedBuildStats;
}

const defaultFrame = (go: () => void): void => {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => { setTimeout(go, 0); });
  else setTimeout(go, 16);
};
const defaultHidden = (): boolean => typeof document !== 'undefined' && document.visibilityState === 'hidden';

/** Drains `steps` in slices of about `sliceMs` between drawn frames; resolves with its result (see the file comment). */
export async function runPaced<T>(steps: BuildSteps<T>, o: PacedBuildOptions = {}): Promise<T> {
  const now = o.now ?? (() => performance.now());
  const sliceMs = o.sliceMs ?? PACED_BUILD.sliceMs, hidden = o.hidden ?? defaultHidden;
  const st = o.stats ?? newPacedStats();
  let finished = false, stage = '(start)';
  try {
    for (;;) {
      if (o.alive && !o.alive()) throw new PacedBuildCancelled();
      const t0 = now();
      let t = t0, r: IteratorResult<string | void, T>;
      for (;;) {
        r = steps.next();
        const t1 = now(), d = t1 - t;
        t = t1;
        st.steps++;
        if (d > st.maxStepMs) st.maxStepMs = d;
        st.stages[stage] = (st.stages[stage] ?? 0) + d;
        if (r.done) break;
        if (typeof r.value === 'string') stage = r.value; // a labelled yield starts the next stage
        if (t - t0 >= sliceMs) {
          if (!hidden()) break;
          st.hiddenSteps++; // nothing is drawn: no reason to wait for a frame
        }
      }
      const ms = t - t0;
      st.slices++;
      st.workMs += ms;
      if (ms > st.maxSliceMs) st.maxSliceMs = ms;
      if (st.sliceMs.length < PACED_BUILD.maxSamples) st.sliceMs.push(ms);
      if (r.done) { finished = true; return r.value; }
      await nextFrame(o, st);
    }
  } finally {
    if (!finished) { try { steps.return(undefined as never); } catch { /* the build's own error is the one that propagates */ } }
  }
}

/** One wait: the next drawn frame, or the fallback timer when no frame comes. */
function nextFrame(o: PacedBuildOptions, st: PacedBuildStats): Promise<void> {
  const frame = o.frame ?? defaultFrame;
  const timer = o.timer ?? ((go: () => void, ms: number) => setTimeout(go, ms));
  const clear = o.clearTimer ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>));
  st.waits++;
  return new Promise<void>(resolve => {
    let done = false, handle: unknown = null;
    const go = (viaTimer: boolean) => {
      if (done) return;
      done = true;
      if (viaTimer) st.fallbacks++; else if (handle !== null) clear(handle);
      resolve();
    };
    handle = timer(() => go(true), o.fallbackMs ?? PACED_BUILD.fallbackMs);
    frame(() => go(false));
  });
}
