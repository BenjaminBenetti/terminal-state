// Task frame-budget-deferral-20261030 (lane MEASURE): opt-in profiler of the game's frame callback, split into named spans
// (Game.frame(): the world update's phases in order, the render's culling / submission, the deferred background chunks;
// nested spans for path searches, the vocal-reach field, per-enemy brain / motor / animation, every frame hook). Pure — no
// DOM, no renderer — so it is unit tested (tests/update-profile.test.ts).
//
// Cost contract:
//  - OFF (the default, and always outside `?qa=1`): every call is ONE boolean check and returns — no clock read, no write,
//    no allocation. The arrays below exist from construction (fixed size) so turning it on allocates nothing per frame.
//  - ON: performance.now() at each span boundary; per-frame accumulators and a fixed ring of `capacity` frames in typed
//    arrays (Float32 ms + Uint16 call counts per span per frame). Reporting (`report()`) allocates — it is the QA read-out.
//
// What a span measures: main-thread milliseconds between its boundaries, INCLUSIVE of everything called inside (a nested
// span's time is also in its parent). `lap(id)` closes the running sequential span and opens `id` (the update's phases tile
// the update with no gap); `begin(id)` / `end(id)` time a nested span and count its calls. Browser clocks are coarse
// (Firefox: ~1 ms without cross-origin isolation, Chromium ~0.1 ms): read windows of many frames — averages and the
// dominant spans of spike frames are meaningful, sub-millisecond p95 of small spans in a coarse-clock browser are not.

/** Span ids (stable; `SPAN_NAMES[id]` is the reported name; PARENT[id] the enclosing span, -1 = top level of the frame). */
export const S = {
  // sequential laps of Game.frame() / update()
  idle: 0, input: 1, player: 2, weapon: 3, survival: 4, ai: 5, hooks: 6, physics: 7, flares: 8, camera: 9, targets: 10,
  items: 11, lights: 12, fx: 13, audio: 14, view: 15, hud: 16, rules: 17, cull: 18, draw: 19, deferred: 20, other: 21,
  // nested inside 'ai'
  vocal: 22, brain: 23, path: 24, motor: 25, anim: 26,
  // nested inside 'hooks': the frame hooks in registration order (Game.frameHookNames names them)
  hook0: 27,
  // task hitch-attribution-recorder-20261105: nested inside 'weapon' — the shot / hit path at its real function boundaries
  // (appended after the hook slots: every earlier id is unchanged)
  fire: 35, melee: 36, fireFx: 37, fireRays: 38, hitWorld: 39, hitZombie: 40, tearChunk: 41, extractPatch: 42, ragdoll: 43, alert: 44,
} as const;
/** Frame hooks timed individually (more share the last slot). */
export const HOOK_SLOTS = 8;
/** First id after the frame-hook slots (the shot / hit spans). */
const HIT0 = S.hook0 + HOOK_SLOTS;
export const SPAN_COUNT = S.alert + 1;

const BASE_NAMES = ['idle', 'input', 'player', 'weapon', 'survival', 'ai', 'hooks', 'physics', 'flares', 'camera', 'targets',
  'items', 'lights', 'fx', 'audio', 'view', 'hud', 'rules', 'render.cull', 'render.draw', 'deferred', 'other',
  'ai.vocalReach', 'ai.brain', 'ai.path', 'ai.motor', 'ai.anim'];
const HIT_NAMES = ['weapon.fire', 'weapon.melee', 'fire.fx', 'fire.rays', 'hit.world', 'hit.zombie', 'hit.tearChunk', 'hit.extractPatch', 'hit.ragdoll', 'hit.alert'];

/** What each sequential span covers (Game.update order; QA read-out `about`). */
export const SPAN_ABOUT: Readonly<Record<string, string>> = {
  idle: 'frame() before the update (dt, frame-budget hold) and anything outside a named span',
  input: 'modifiers, look, slot keys, key actions (E interact, Q mask, F light, H heal), pointer handlers',
  player: 'flare hold, player movement / collision, footstep cues',
  weapon: 'weapon update incl. fire (hitscan, damage, alerts) and melee contact; timed item use',
  survival: 'hunger / thirst clocks',
  ai: 'updateZombies: vocal-reach field, every enemy brain (+ path searches), motor, separation, cues, animation',
  hooks: 'lane frame hooks (injuries, gear, gas mask, tower / elevator, office atmosphere, gas field + exposure, …)',
  physics: 'cannon step (only when something is awake) + casings / chunks / dynamic items / sources',
  flares: 'thrown flares', camera: 'recoil / bloom decay and the camera pose',
  targets: 'crosshair targets: pickups, containers, ladders',
  items: 'pickups glow, containers (openables animation, visible-lot refresh)',
  lights: 'muzzle flash, flashlight battery / flicker, station light circuits',
  fx: 'effects and damage debris', audio: 'listener, reverb room, vitals, ambience',
  view: 'consume view and viewmodel pose', hud: 'stance, HUD text / bars, crosshair',
  rules: 'death / section-clear checks',
  'render.cull': 'LevelCuller.update (portal / fog culling; skipped while the camera is still)',
  'render.draw': 'render submission (scene + atmosphere + viewmodel overlay): CPU encoding, not GPU execution',
  deferred: 'frame-budget background chunks run after the render (lane SCHED)',
  other: 'the rest of frame() after the named spans',
  'ai.vocalReach': 'VocalReach.update (route field for enemy vocals; time-sliced build)',
  'ai.brain': 'every enemy brain update (sight, state machine; includes its path searches)',
  'ai.path': 'PathFinder.find calls (A* + string pulling); count = searches',
  'ai.motor': 'moveZombie + body separation + settle',
  'ai.anim': 'enemy cues (vocals / swings / steps), hits on the player, animation, transforms, hit volumes',
  'hook.*': 'one lane frame hook each (Game.prof.hookNames, registration order); an unnamed one is the QA walker',
  'weapon.fire': 'Game.fire: one trigger pull (every pellet, its hits, kills and the gunfire alert)',
  'weapon.melee': 'Game.meleeContact: one melee contact (its hits, kills and the alert)',
  'fire.fx': 'Game.fire before the pellets: shot sound, viewmodel kick, recoil / camera, muzzle flash, casing ejection (physics.onFire)',
  'fire.rays': 'Game.fire per pellet: raycastWorld + nearestEnemyHit + damage.corpseHit + stock.pelletHit (count = pellets)',
  'hit.world': 'Game.bulletHit (lane handlers, e.g. office window panes) + DamageSystem.hitWorld (craters, prop damage / breaking, fx, sound)',
  'hit.zombie': 'DamageSystem.hitZombie: wound, body-hit fx, flesh debris and the torn chunk (fire and melee; count = hits)',
  'hit.tearChunk': 'DamageSystem.tearChunk inside hit.zombie: the torn piece (patch attempts + chunk spawn + wound tear)',
  'hit.extractPatch': 'fleshPatch.extractPatch inside hit.tearChunk (count = attempts: up to 3 widening radii)',
  'hit.ragdoll': 'PhysicsSystem.ragdoll on a kill (fire and melee)',
  'hit.alert': 'Game.alertZombies after a shot / swing (hearing + wake-ups; their path searches run later, in ai.path)',
};

/**
 * Parent span id of each id (-1 = a top-level lap). The shot / hit spans nest: weapon > weapon.fire / weapon.melee >
 * fire.fx / fire.rays / hit.world; hit.zombie / hit.ragdoll / hit.alert run inside weapon.fire OR weapon.melee, so their parent
 * is the 'weapon' lap; hit.zombie > hit.tearChunk > hit.extractPatch. Every span is inclusive: never sum a span with its parent.
 */
export const PARENT: readonly number[] = Array.from({length: SPAN_COUNT}, (_, i) => {
  if (i === S.path) return S.brain;
  if (i >= S.vocal && i <= S.anim) return S.ai;
  if (i >= S.hook0 && i < HIT0) return S.hooks;
  if (i === S.fireFx || i === S.fireRays || i === S.hitWorld) return S.fire;
  if (i === S.tearChunk) return S.hitZombie;
  if (i === S.extractPatch) return S.tearChunk;
  if (i >= HIT0) return S.weapon;
  return -1;
});

/** The frame-hook slot ids (nested in 'hooks'). */
export const isHookSpan = (id: number): boolean => id >= S.hook0 && id < HIT0;

export interface SpanStat {
  name: string;
  parent: string | null;
  /** ms per frame over the window (frames where it did not run count as 0). */
  avg: number;
  p95: number;
  max: number;
  /** Frames of the window in which the span took any time / was entered. */
  frames: number;
  /** Nested spans: calls over the window (path searches, brain updates …); laps: frames entered. */
  count: number;
  /** Share of the window's total frame time (inclusive; nested spans are also inside their parent). */
  share: number;
}

export interface SpikeFrame {
  /** Frames ago (0 = the newest recorded frame). */
  age: number;
  /** Whole frame callback ms (all laps). */
  ms: number;
  /** The update's laps only (input .. rules). */
  updateMs: number;
  /** Largest spans of that frame (nested spans included, the 'hooks' / 'ai' parents only when nothing nested explains them). */
  dominant: {name: string; ms: number; count: number}[];
}

export interface UpdateProfileReport {
  on: boolean;
  /** Frames recorded in the window / ring capacity. */
  frames: number;
  capacity: number;
  /** Frame callback ms over the window. */
  frame: {avg: number; p95: number; max: number};
  update: {avg: number; p95: number; max: number};
  spans: SpanStat[];
  spikes: SpikeFrame[];
  hookNames: string[];
  clock: string;
}

const now: () => number = typeof performance !== 'undefined' ? () => performance.now() : () => Date.now();

export class UpdateProfiler {
  /** Recording. Every hook call is a no-op while false. */
  on = false;
  readonly capacity: number;
  /** ms per span per recorded frame (ring: slot * SPAN_COUNT + span). */
  readonly ms: Float32Array;
  /** Calls (nested) / entries (laps) per span per recorded frame. */
  readonly calls: Uint16Array;
  /** Whole frame ms per slot. */
  readonly total: Float32Array;
  /** Next slot / filled slots. */
  head = 0;
  count = 0;
  /** Names of the timed frame hooks (Game sets them; hook slot i). */
  hookNames: string[] = [];
  // current frame
  private readonly acc = new Float64Array(SPAN_COUNT);
  private readonly n = new Uint16Array(SPAN_COUNT);
  private readonly t0 = new Float64Array(SPAN_COUNT);
  private cur: number = S.idle;
  private t = 0;
  private start = 0;
  private open = false;

  constructor(capacity = 600) {
    this.capacity = Math.max(2, Math.floor(capacity));
    this.ms = new Float32Array(this.capacity * SPAN_COUNT);
    this.calls = new Uint16Array(this.capacity * SPAN_COUNT);
    this.total = new Float32Array(this.capacity);
  }

  /** Start recording (clears the window). */
  startRecording(): void {
    this.reset();
    this.on = true;
  }

  stopRecording(): void {
    this.on = false;
    this.open = false;
  }

  /** Forget the recorded frames (keeps on / off). */
  reset(): void {
    this.head = this.count = 0;
    this.ms.fill(0);
    this.calls.fill(0);
    this.total.fill(0);
    this.acc.fill(0);
    this.n.fill(0);
    this.open = false;
  }

  /** Start of a frame callback: the 'idle' lap opens. */
  frameBegin(): void {
    if (!this.on) return;
    const t = now();
    this.acc.fill(0);
    this.n.fill(0);
    this.start = this.t = t;
    this.cur = S.idle;
    this.n[S.idle] = 1;
    this.open = true;
  }

  /** Close the running sequential span and open `id`. */
  lap(id: number): void {
    if (!this.on || !this.open) return;
    const t = now();
    this.acc[this.cur] += t - this.t;
    this.t = t;
    this.cur = id;
    if (this.n[id] < 65535) this.n[id]++;
  }

  /** Nested span start (inside the running lap). */
  begin(id: number): void {
    if (!this.on || !this.open) return;
    this.t0[id] = now();
  }

  /** Nested span end: adds its time and one call. */
  end(id: number): void {
    if (!this.on || !this.open) return;
    this.acc[id] += now() - this.t0[id];
    if (this.n[id] < 65535) this.n[id]++;
  }

  /**
   * End of the frame callback: closes the running lap and stores the frame. `record` = false drops it; default: recorded when
   * the world updated in it (the 'input' lap opened — menus' 4 Hz redraws and warm-up frames are not play frames).
   */
  frameEnd(record = this.n[S.input] > 0): void {
    if (!this.on || !this.open) return;
    const t = now();
    this.acc[this.cur] += t - this.t;
    this.open = false;
    if (!record) return;
    const slot = this.head, o = slot * SPAN_COUNT;
    for (let i = 0; i < SPAN_COUNT; i++) { this.ms[o + i] = this.acc[i]; this.calls[o + i] = this.n[i]; }
    this.total[slot] = t - this.start;
    this.head = (slot + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;
  }

  /** Slot of the k-th newest frame. */
  private slot(k: number): number {
    return (this.head - 1 - k + this.capacity * 2) % this.capacity;
  }

  name(id: number): string {
    if (id < S.hook0) return BASE_NAMES[id];
    if (id >= HIT0) return HIT_NAMES[id - HIT0] ?? `span${id}`;
    const k = id - S.hook0, label = this.hookNames[k];
    return `hook.${label ?? k}${k === HOOK_SLOTS - 1 && this.hookNames.length > HOOK_SLOTS ? '+' : ''}`;
  }

  /** The window's statistics (allocates: QA read-out). `window` = newest frames to include (default: all recorded). */
  report(o: {window?: number; spikes?: number} = {}): UpdateProfileReport {
    const n = Math.max(0, Math.min(this.count, Math.floor(o.window ?? this.count)));
    const col = new Float64Array(n);
    const pct = (a: Float64Array, q: number) => {
      if (!a.length) return 0;
      const s = Float64Array.from(a).sort();
      return s[Math.min(s.length - 1, Math.floor(q * (s.length - 1) + 0.5))];
    };
    const summary = (a: Float64Array) => {
      let sum = 0, max = 0;
      for (const v of a) { sum += v; if (v > max) max = v; }
      return {avg: a.length ? sum / a.length : 0, p95: pct(a, 0.95), max};
    };
    const frameMs = new Float64Array(n), updMs = new Float64Array(n);
    let frameSum = 0;
    for (let k = 0; k < n; k++) {
      const s = this.slot(k), o2 = s * SPAN_COUNT;
      frameMs[k] = this.total[s];
      frameSum += this.total[s];
      let u = 0;
      for (let id = S.input; id <= S.rules; id++) u += this.ms[o2 + id];
      updMs[k] = u;
    }
    const spans: SpanStat[] = [];
    for (let id = 0; id < SPAN_COUNT; id++) {
      let frames = 0, calls = 0, sum = 0;
      for (let k = 0; k < n; k++) {
        const o2 = this.slot(k) * SPAN_COUNT + id;
        col[k] = this.ms[o2];
        sum += col[k];
        if (this.calls[o2] > 0) frames++;
        calls += this.calls[o2];
      }
      if (isHookSpan(id) && id - S.hook0 >= this.hookNames.length && calls === 0) continue; // an unused, unnamed hook slot
      if (id >= HIT0 && calls === 0) continue; // a shot / hit span that never ran in the window
      const st = summary(col);
      spans.push({name: this.name(id), parent: PARENT[id] >= 0 ? this.name(PARENT[id]) : null, avg: st.avg, p95: st.p95, max: st.max, frames, count: calls,
        share: frameSum > 0 ? sum / frameSum : 0});
    }
    // spike frames: the slowest frames with their dominant spans (leaf spans first; a parent only beyond its children)
    const order = Array.from({length: n}, (_, k) => k).sort((a, b) => frameMs[b] - frameMs[a]).slice(0, Math.max(0, o.spikes ?? 5));
    const spikes: SpikeFrame[] = order.map(k => {
      const s = this.slot(k), o2 = s * SPAN_COUNT;
      const items: {name: string; ms: number; count: number}[] = [];
      for (let id = 0; id < SPAN_COUNT; id++) {
        let v = this.ms[o2 + id];
        if (id === S.ai) v -= this.ms[o2 + S.vocal] + this.ms[o2 + S.brain] + this.ms[o2 + S.motor] + this.ms[o2 + S.anim];
        else if (id === S.brain) v -= this.ms[o2 + S.path]; // path searches run inside brain updates
        else if (id === S.hooks) for (let h = S.hook0; h < HIT0; h++) v -= this.ms[o2 + h];
        else if (id === S.weapon) v -= this.ms[o2 + S.fire] + this.ms[o2 + S.melee]; // (the hit spans are inside those two)
        if (v > 0.0005) items.push({name: id === S.ai ? 'ai (rest)' : id === S.brain ? 'ai.brain (excl. path)' : id === S.hooks ? 'hooks (rest)' : id === S.weapon ? 'weapon (rest)' : this.name(id), ms: v, count: this.calls[o2 + id]});
      }
      items.sort((a, b) => b.ms - a.ms);
      return {age: k, ms: frameMs[k], updateMs: updMs[k], dominant: items.slice(0, 4)};
    });
    const clockRes = typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated ? 'cross-origin isolated (fine clock)' : 'browser default clock (may be coarsened: Firefox ~1 ms, Chromium ~0.1 ms)';
    return {on: this.on, frames: n, capacity: this.capacity, frame: summary(frameMs), update: summary(updMs), spans, spikes, hookNames: [...this.hookNames], clock: clockRes};
  }
}
