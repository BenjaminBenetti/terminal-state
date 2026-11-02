// Task reactor-surface-ending-20261102 (lane AUDIO): THE SURFACE RAIN AMBIENCE — user: "... towards a surface area, where the player
// may emerge in to the outside world! ... It should be raining! And the fog is now cleared!". One Sound Lab rain loop (audio/sfx.ts
// Sfx.rainBed: a single page-lifetime channel on the ambient bus) driven per frame by this director, which the Reactor's startup runtime
// (startup.ts) owns. Pure decisions here; no nodes, no state persisted.
//  - ONLY AFTER THE WIN: the level is gated by the ONLINE sky's clearing (startupPlan.ts skyClearAt: 0 until the reactor is online,
//    1 once the sky over the roof has cleared; a restored / revisited world is at 1 at once). Before the win: silent, always.
//  - OUTSIDE vs SHELTERED: the listener's exposure {level 0..1, muffle 0..1}. Lane SURFACE / ENDING own the surface zone and its
//    shelter (the rain visuals' "sheltered indoors"): they register the real function with setRainExposure(host, fn) — one source of
//    truth for what is outside. Without one (or when it returns null) the default reads the eye against the roof line: in the open
//    above the roof slab (the surface storey) the full rain; just below it (the stairwell up, the rim storey under the roof) muffled
//    and fading with depth; deeper inside the building: nothing.
//  - Silent when audio is not running (Sfx no-ops); a torn-down world sets the bed to 0.

import type {ReactorInfo} from '../../gen/reactor/reactorTypes';

interface P3 { x: number; y: number; z: number }
/** How much rain reaches the listener: `level` 0..1 (0 = none), `muffle` 0..1 (0 = in the open, 1 = sheltered: low-passed, quieter). */
export interface RainExposure { level: number; muffle: number }
/** A surface zone's exposure at the eye (null = no opinion: the default rule applies). */
export type RainExposureFn = (eye: Readonly<P3>) => RainExposure | null;

/** The default exposure rule (m, relative to the pit roof line `roofY`, eye heights). */
export const RAIN_AUDIO = {
  /** Fully outside once the eye is this far over the roof line (feet on the roof slab / the surface storey). */
  openAboveM: 1.2,
  /** Sheltered (muffle 1) at or under this height re the roof line; between it and openAboveM the rain opens up (the top of the stairs). */
  shelterBelowM: -0.4,
  /** Under the roof the muffled rain fades to nothing over this depth (the storey right under the roof hears it on the slab). */
  indoorBandM: 8,
  /** The muffled level just under the roof (x the bed's shelter level in sfx.ts RAIN_BED). */
  indoorLevel: 0.6,
  /** The director sends a change (> `epsilon`) at most every `sendS`, and re-sends a sounding bed every `refreshS` (audio started /
   *  the clip decoded since: Sfx.rainBed is a no-op until then and cheap when unchanged) (s). */
  sendS: 0.1, epsilon: 0.01, refreshS: 1,
} as const;

const clamp01 = (v: number) => (v <= 0 ? 0 : v >= 1 ? 1 : v);

/** The default rule: the eye height vs the roof line. */
export function defaultRainExposure(eyeY: number, roofY: number): RainExposure {
  const h = eyeY - roofY, R = RAIN_AUDIO;
  if (h >= R.openAboveM) return {level: 1, muffle: 0};
  if (h > R.shelterBelowM) { const k = (h - R.shelterBelowM) / (R.openAboveM - R.shelterBelowM); return {level: R.indoorLevel + (1 - R.indoorLevel) * k, muffle: 1 - k}; }
  const d = R.shelterBelowM - h;
  return d >= R.indoorBandM ? {level: 0, muffle: 1} : {level: R.indoorLevel * (1 - d / R.indoorBandM), muffle: 1};
}

/** The bed's final {level, muffle}: the exposure, gated by the win (the sky's clearing 0..1). */
export function rainMix(e: RainExposure | null, clear: number): RainExposure {
  const gate = clamp01(Number.isFinite(clear) ? clear : 0);
  if (!e || gate <= 0) return {level: 0, muffle: e ? clamp01(e.muffle) : 1};
  return {level: clamp01(e.level) * gate, muffle: clamp01(e.muffle)};
}

const providers = new WeakMap<object, RainExposureFn>();
/** Lane SURFACE / ENDING: register (or clear with null) the surface zone's exposure function for a host (the Game). */
export function setRainExposure(host: object, fn: RainExposureFn | null): void {
  if (fn) providers.set(host, fn); else providers.delete(host);
}
/** The registered exposure function of a host (tests / QA). */
export const rainExposureOf = (host: object): RainExposureFn | undefined => providers.get(host);

/** What the director needs from audio/sfx.ts (duck-typed: tests record; an older Sfx stays silent). */
export interface RainSfx { rainBed?(level: number, muffle: number): void }

export class RainAudio {
  /** The last sent bed (QA / tests) and why. */
  readonly shown = {level: 0, muffle: 1, source: 'none' as 'none' | 'surface' | 'default', sends: 0};
  private next = 0;
  private refresh = 0;
  private time = 0;

  constructor(private readonly host: object, private readonly sfx: () => RainSfx | null) {}

  /** Per frame (while playing): the eye, the ONLINE sky's clearing (0 = not won yet), the Reactor (null: no roof line -> surface only). */
  frame(dt: number, eye: Readonly<P3>, clear: number, info: Pick<ReactorInfo, 'pit'> | null): void {
    this.time += dt;
    let e: RainExposure | null = null, source: 'none' | 'surface' | 'default' = 'none';
    const fn = providers.get(this.host);
    if (fn) { try { e = fn(eye); } catch { e = null; } if (e) source = 'surface'; }
    if (!e && info) { e = defaultRainExposure(eye.y, info.pit.roofY); source = 'default'; }
    const m = rainMix(e, clear), s = this.shown;
    s.source = source;
    if (m.level === 0 && s.level === 0) return; // silent stays silent (whatever the shelter)
    const onOff = (m.level === 0) !== (s.level === 0); // the rain starts / stops: at once
    const changed = onOff || Math.abs(m.level - s.level) > RAIN_AUDIO.epsilon || Math.abs(m.muffle - s.muffle) > RAIN_AUDIO.epsilon;
    if (onOff || (changed ? this.time >= this.next : this.time >= this.refresh)) this.send(m.level, m.muffle);
  }

  /** The world is gone (teardown): the rain fades out. */
  stop(): void {
    this.send(0, this.shown.muffle);
    this.shown.source = 'none';
  }

  private send(level: number, muffle: number): void {
    const s = this.shown;
    s.level = level; s.muffle = muffle; s.sends++;
    this.next = this.time + RAIN_AUDIO.sendS;
    this.refresh = this.time + RAIN_AUDIO.refreshS;
    try { this.sfx()?.rainBed?.(level, muffle); } catch { /* audio is never fatal */ }
  }
}
