// Task studio-flamethrower-fire-20261114-031614-01: what the fire code asks of the audio (audio/flameAudio.ts implements it over Sfx;
// Node tests pass a stub). Every call is optional to honour: a missing clip or a full voice pool is silence, never an error.

/** A burning place the listener can hear this frame: world position + loudness 0..1 (a fire patch's strength, a burning prop = 1). */
export interface FireVoice { x: number; y: number; z: number; level: number }

export interface FlameSound {
  /** The stream lit (ignition whoosh, then the roar holds until streamOff). Position = the muzzle. */
  streamOn(x: number, y: number, z: number): void;
  /** The stream went out (the roar's tail). `dry`: the tank ran empty under the trigger (a sputter). */
  streamOff(dry: boolean): void;
  /**
   * Once a frame while anything burns or the stream runs: the muzzle position while streaming (else null) and the loudest burning
   * places (already bounded by the caller: at most FIRE_VOICES, nearest / strongest first). An empty list fades every fire bed out.
   */
  frame(dt: number, muzzle: {x: number; y: number; z: number} | null, fires: readonly FireVoice[]): void;
  /** A prop caught fire (a soft whoomp). */
  ignite(x: number, y: number, z: number): void;
  /** A burning prop collapsed (crackling crumble). */
  burnOut(x: number, y: number, z: number): void;
  /** A fuel can started pouring into the worn tank (`seconds` long); returns a stop function for a cancelled pour. */
  refill(seconds: number): () => void;
  /** Trigger pulled with no tank / an empty tank (a dry valve click). */
  dry(): void;
  /** Everything silent at once (section teardown, death, travel). */
  silence(): void;
}

/** The burning places `frame` is given at most (the audio's fire-bed pool). */
export const FIRE_VOICES = 3;

/** A silent FlameSound (tests, and until the audio is installed). */
export const NO_FLAME_SOUND: FlameSound = {
  streamOn() {}, streamOff() {}, frame() {}, ignite() {}, burnOut() {}, refill: () => () => {}, dry() {}, silence() {},
};
