// Task reactor-surface-ending-20261102 (lane AUDIO): THE SURFACE RAIN AMBIENCE — user: "... towards a surface area, where the player
// may emerge in to the outside world! ... It should be raining! And the fog is now cleared!". One Sound Lab rain loop (audio/sfx.ts
// Sfx.rainBed: a single page-lifetime channel on the ambient bus) driven per frame by this director, which the Reactor's startup runtime
// (startup.ts) owns. Pure decisions here; no nodes, no state persisted.
//  - ONLY AFTER THE WIN: the level is gated by the ONLINE sky's clearing (startupPlan.ts skyClearAt: 0 until the reactor is online,
//    1 once the sky over the roof has cleared; a restored / revisited world is at 1 at once). Before the win: silent, always (and the
//    surface is sealed until the gas has cleared after ONLINE anyway).
//  - OUTSIDE vs SHELTERED: the listener's exposure {level 0..1, muffle 0..1}, read from lane ENDING's surface contract
//    (layout.reactor.surface, gen/reactor/reactorTypes.ts ReactorSurface — its area ids, the stair, the head house, the exit):
//      the PLAZA (outdoors)                         full rain, open;
//      the UPPER passage (the stair head house)     muffled, louder and opening up towards the exit onto the plaza;
//      the STAIR                                    muffled, fading in as they climb;
//      the LOWER passage behind the open door       faint and muffled;
//      anywhere else (the pit, every storey)        nothing.
//    One source of truth: lane SURFACE (whose rain visuals shelter indoors) can read the same rule (surfaceRainExposure) or replace it
//    with its own outdoor amount through the hook setRainExposure(host, eye => ({level, muffle}) | null) — a registered function wins
//    (null = no opinion). A Reactor without a surface contract (older layouts / fixtures) falls back to the roof line: outside only
//    with the eye over the roof slab, muffled just under it.
//  - Silent when audio is not running (Sfx no-ops); a torn-down world sets the bed to 0.

import type {ReactorInfo, ReactorRect, ReactorSurface} from '../../gen/reactor/reactorTypes';

interface P3 { x: number; y: number; z: number }
/** How much rain reaches the listener: `level` 0..1 (0 = none), `muffle` 0..1 (0 = in the open, 1 = sheltered: low-passed, quieter). */
export interface RainExposure { level: number; muffle: number }
/** A surface zone's exposure at the eye (null = no opinion: the default rule applies). */
export type RainExposureFn = (eye: Readonly<P3>) => RainExposure | null;
/** The grids the surface rule reads (layout.levels[i].grid.areaAt). */
type AreaGrids = readonly ({grid: {areaAt(wx: number, wz: number): number}} | undefined)[];

/** The exposure rules (m: eye heights / distances; levels x the bed's RAIN_BED gain in sfx.ts). */
export const RAIN_AUDIO = {
  /** Eye over the surface deck at least this high = on the surface storey (a crouched eye is ~1 m up). */
  deckEyeM: 0.6,
  /** Eye height over the feet (the stair progress / the door storey). */
  eyeM: 1.6,
  /** The head house (upper passage): its level / muffle deep inside -> at its exit onto the plaza, over `exitM`. */
  headLevel: [0.5, 0.85] as readonly [number, number], headMuffle: [0.95, 0.4] as readonly [number, number], exitM: 4,
  /** The stair: its level from the foot to the head (muffle 1). */
  stairLevel: [0.15, 0.5] as readonly [number, number],
  /** The lower passage behind the open door (muffle 1). */
  lowerLevel: 0.08,
  /** Roof-line fallback (no surface contract): fully outside once the eye is `openAboveM` over pit.roofY; sheltered at or under
   *  `shelterBelowM`; under the roof the muffled rain (`indoorLevel`) fades to nothing over `indoorBandM`. */
  openAboveM: 1.2, shelterBelowM: -0.4, indoorBandM: 3, indoorLevel: 0.5,
  /** The director sends a change (> `epsilon`) at most every `sendS`, and re-sends a sounding bed every `refreshS` (audio started /
   *  the clip decoded since: Sfx.rainBed is a no-op until then and cheap when unchanged) (s). */
  sendS: 0.1, epsilon: 0.01, refreshS: 1,
} as const;

const clamp01 = (v: number) => (v <= 0 ? 0 : v >= 1 ? 1 : v);
const lerp = (r: readonly [number, number], k: number) => r[0] + (r[1] - r[0]) * k;
const inRect = (r: ReactorRect, x: number, z: number, m = 0) => x >= r.x0 - m && x <= r.x1 + m && z >= r.z0 - m && z <= r.z1 + m;
const SILENT: RainExposure = {level: 0, muffle: 1};

/** The surface rule (lane ENDING's contract): plaza open, head house / stair muffled and fading in as they climb, nothing elsewhere. */
export function surfaceRainExposure(s: ReactorSurface, levels: AreaGrids, eye: Readonly<P3>): RainExposure {
  const R = RAIN_AUDIO, A = s.areas;
  if (eye.y >= s.y + R.deckEyeM) { // on the surface storey
    const a = levels[s.level]?.grid.areaAt(eye.x, eye.z) ?? -1;
    if (a === A.upper || (a !== A.plaza && a !== A.stair && inRect(s.head.rect, eye.x, eye.z) && eye.y < s.head.top)) {
      const k = clamp01(1 - Math.hypot(eye.x - s.exit.x, eye.z - s.exit.z) / R.exitM);
      return {level: lerp(R.headLevel, k), muffle: lerp(R.headMuffle, k)};
    }
    if (a === A.stair) return {level: R.stairLevel[1], muffle: 1};
    return {level: 1, muffle: 0}; // the plaza (and anything else up in the open air)
  }
  const feet = eye.y - R.eyeM, st = s.stairs;
  if (inRect(st.rect, eye.x, eye.z, 0.25) && feet >= st.bottom.y - 0.5) {
    const k = clamp01((feet - st.bottom.y) / Math.max(0.5, st.top.y - st.bottom.y));
    return {level: lerp(R.stairLevel, k), muffle: 1};
  }
  if (Math.abs(feet - s.door.y) < 2.5 && levels[s.door.level]?.grid.areaAt(eye.x, eye.z) === A.lower) return {level: R.lowerLevel, muffle: 1};
  return SILENT;
}

/** The roof-line fallback (a Reactor without a surface contract): the eye height vs pit.roofY. */
export function defaultRainExposure(eyeY: number, roofY: number): RainExposure {
  const h = eyeY - roofY, R = RAIN_AUDIO;
  if (h >= R.openAboveM) return {level: 1, muffle: 0};
  if (h > R.shelterBelowM) { const k = (h - R.shelterBelowM) / (R.openAboveM - R.shelterBelowM); return {level: R.indoorLevel + (1 - R.indoorLevel) * k, muffle: 1 - k}; }
  const d = R.shelterBelowM - h;
  return d >= R.indoorBandM ? SILENT : {level: R.indoorLevel * (1 - d / R.indoorBandM), muffle: 1};
}

/** The bed's final {level, muffle}: the exposure, gated by the win (the sky's clearing 0..1). */
export function rainMix(e: RainExposure | null, clear: number): RainExposure {
  const gate = clamp01(Number.isFinite(clear) ? clear : 0);
  if (!e || gate <= 0) return {level: 0, muffle: e ? clamp01(e.muffle) : 1};
  return {level: clamp01(e.level) * gate, muffle: clamp01(e.muffle)};
}

const providers = new WeakMap<object, RainExposureFn>();
/** THE HOOK (lane SURFACE / ENDING): register (or clear with null) a host's outdoor exposure function; it wins over the default rule. */
export function setRainExposure(host: object, fn: RainExposureFn | null): void {
  if (fn) providers.set(host, fn); else providers.delete(host);
}
/** The registered exposure function of a host (tests / QA). */
export const rainExposureOf = (host: object): RainExposureFn | undefined => providers.get(host);

/** What the director needs from audio/sfx.ts (duck-typed: tests record; an older Sfx stays silent). */
export interface RainSfx { rainBed?(level: number, muffle: number): void }

export class RainAudio {
  /** The last sent bed (QA / tests) and why. */
  readonly shown = {level: 0, muffle: 1, source: 'none' as 'none' | 'hook' | 'surface' | 'roofline', sends: 0};
  private next = 0;
  private refresh = 0;
  private time = 0;

  constructor(private readonly host: object, private readonly sfx: () => RainSfx | null) {}

  /**
   * Per frame (while playing): the eye, the ONLINE sky's clearing (0 = not won yet), the Reactor (its surface contract / roof line;
   * null = none) and the layout's levels (the surface rule's area grids).
   */
  frame(dt: number, eye: Readonly<P3>, clear: number, info: Pick<ReactorInfo, 'pit' | 'surface'> | null, levels: AreaGrids = []): void {
    this.time += dt;
    let e: RainExposure | null = null, source: RainAudio['shown']['source'] = 'none';
    const fn = providers.get(this.host);
    if (fn) { try { e = fn(eye); } catch { e = null; } if (e) source = 'hook'; }
    if (!e && info?.surface) { e = surfaceRainExposure(info.surface, levels, eye); source = 'surface'; }
    else if (!e && info) { e = defaultRainExposure(eye.y, info.pit.roofY); source = 'roofline'; }
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
