// Task studio-market-bar-20261108-225231-01: the market's sound seam (implemented by the AUDIO lane as Game.marketAudio): the cash
// register, the panic / anger voices of hostile people, the player's retch. The background chatter (and its ducking once the settlement
// is hostile) is the audio system's own: it reads the market's people and Game.marketHostility itself. Callers use optional chaining.

export interface MarketAudioApi {
  /** One subtle register cue for ONE successful buy / sell (Ctrl+click included) — never a preview, refusal, cancel or theft. */
  cash(): void;
  /** A fleeing person's panic scream at its position (the audio system staggers, varies and caps them). */
  scream(personId: string, x: number, y: number, z: number): void;
  /** A fighter's angry grunt at its position (staggered, varied, capped). */
  grunt(personId: string, x: number, y: number, z: number): void;
  /** The player's retch (the throw-up action). */
  retch(): void;
}
