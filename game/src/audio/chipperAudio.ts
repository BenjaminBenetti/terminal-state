// Task studio-corpse-chipper-fuel-20261110-235304-01: the train CHIPPER'S SOUND — positional at the machine (it rides in the train: the
// runtime passes its world position every frame). Cues are Sound Lab derivatives (audio/bank.ts); a missing clip is silent.
// CONTRACT STUB (lane AUDIO fills it in; world/chipper.ts calls exactly these methods):
//  - start(): the motor spins up and its loop runs (reactorLoop-style handle; Sfx.setWorld stops machine loops on a world change, so
//    frame() re-requests a running loop that was stopped);
//  - feed(): a body drops into the hopper (one-shot);
//  - grind(on): the wet grinding layer over the motor (a loop while a body is being processed);
//  - stop(): the motor winds down (one-shot) and every loop ends;
//  - frame(x, y, z): the machine's world position this frame (moves the loops);
//  - silence(): end everything at once (pause / teardown / a load), no wind-down cue.

import type {Sfx} from './sfx';

export class ChipperAudio {
  constructor(readonly sfx: Sfx) {}
  start(_x: number, _y: number, _z: number): void { /* lane AUDIO */ }
  feed(_x: number, _y: number, _z: number): void { /* lane AUDIO */ }
  grind(_on: boolean): void { /* lane AUDIO */ }
  stop(_x: number, _y: number, _z: number): void { /* lane AUDIO */ }
  frame(_x: number, _y: number, _z: number): void { /* lane AUDIO */ }
  silence(): void { /* lane AUDIO */ }
}
