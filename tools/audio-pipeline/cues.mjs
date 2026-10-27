// Every cue the runtime Sfx can play (one recipe each). game/tests/audio-bank.test.ts checks that the
// runtime cue list (game/src/audio/bank.ts CUES) equals manifest cues + listed gaps.
import {RECIPES} from './recipes.mjs';

export const CUES = Object.keys(RECIPES);
