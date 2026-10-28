// Iteration 12: shared registry of PLAYER-MADE light that the world reacts to (primary-authored contract;
// see reference/tasks/atmosphere-light-survival-20261028/design.md).
//  - written by the light lane: the flashlight (each frame: on/off by battery + flicker, emitter at the eye, beam
//    direction, the spot where the beam lands), thrown flares (landed position, burning/out) and the body glow;
//  - read by the AI lane (enemies that can SEE a light slowly investigate it; seeing the player takes priority) and by
//    the atmosphere lane (extra in-scattering lights in the volumetric fog).
// Positions are world metres with absolute y; `level` is the storey the light is on (gen/levels.ts) when known.

export type LightSourceKind = 'flashlight' | 'flare' | 'bodyGlow';

export interface LightSource {
  readonly id: number;
  kind: LightSourceKind;
  /** On and emitting this frame (battery empty / flicker-off / burnt out => false). */
  active: boolean;
  /** Emitter position. */
  x: number; y: number; z: number;
  level?: number;
  /** Beam direction (unit) for spot lights; null for omni lights. */
  dir: {x: number; y: number; z: number} | null;
  /** cos(half cone angle) for spot lights (1 = omni). */
  cosHalfAngle: number;
  /** Where the light visibly lands (beam hit point / the flare itself): what an enemy would notice. */
  spot: {x: number; y: number; z: number} | null;
  /** Distance (m) within which an enemy with line of sight can notice this light; 0 = never attracts. */
  attractRange: number;
  /** 0..1 current brightness (flicker / battery / burn-out fade). */
  intensity: number;
}

export class LightSources {
  private nextId = 1;
  readonly list: LightSource[] = [];

  add(init: Omit<LightSource, 'id'>): LightSource {
    const s: LightSource = {id: this.nextId++, ...init};
    this.list.push(s);
    return s;
  }

  remove(s: LightSource | number): void {
    const id = typeof s === 'number' ? s : s.id;
    const i = this.list.findIndex(q => q.id === id);
    if (i >= 0) this.list.splice(i, 1);
  }

  /** Lights that can currently attract enemies (active, bright enough, positive range). */
  attracting(minIntensity = 0.05): LightSource[] {
    return this.list.filter(s => s.active && s.attractRange > 0 && s.intensity >= minIntensity);
  }

  /** Remove everything (new station / retry / death). */
  clear(): void {
    this.list.length = 0;
  }
}
