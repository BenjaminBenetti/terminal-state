// Task studio-screacher-production-20261110-221858-01: where WORLD NOISE for the blind Screacher comes from on the physics side
// (user: it reacts to the "player bumping things"). Pure wiring, no three.js.
//
// The physics systems report contacts to ONE audio sink (physics/world.ts PhysicsAudio: prop / item / shelf-stock / thrown-item
// impacts, dragged boxes, casings, body falls). noisyPhysicsAudio wraps that sink: every call reaches the sink unchanged, and a
// contact of a loose OBJECT (the callers that name their `source`; debris and flesh chunks name none) of at least
// SCREACHER_NOISE.impactMinSpeed is ALSO raised as a noise event at the place it happened — and so is a dragged box. The AI event is
// raised by the physics contact itself, never by the audio layer: the Sfx's distance culling, voice limits and mute state must not
// decide what an enemy hears.

import type {PhysicsAudio} from '../physics/world';
import {SCREACHER_NOISE, impactNoise, type ScreacherNoiseKind} from './screacher';

/** Raise one world noise at (x, feet-height y, z) of loudness `radius` m (the game: Game.worldNoise). */
export type RaiseNoise = (x: number, y: number, z: number, radius: number, kind: ScreacherNoiseKind) => void;

export function noisyPhysicsAudio(sink: PhysicsAudio, raise: RaiseNoise): PhysicsAudio {
  return {
    casing: (x, y, z, speed, kind) => sink.casing?.(x, y, z, speed, kind),
    bodyFall: (x, y, z, strength) => sink.bodyFall?.(x, y, z, strength),
    physImpact: (x, y, z, speed, family, mass, source) => {
      sink.physImpact?.(x, y, z, speed, family, mass, source);
      if (source !== undefined && family !== 'flesh') { const r = impactNoise(speed, family); if (r > 0) raise(x, y, z, r, 'impact'); }
    },
    propDrag: (x, y, z, speed, id) => { sink.propDrag?.(x, y, z, speed, id); raise(x, y, z, SCREACHER_NOISE.drag, 'drag'); },
    propDragStop: id => sink.propDragStop?.(id),
  };
}
