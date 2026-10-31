// Task track1-siren-blightbelly-20261031 (lane SIREN): the Siren's positional audio (ai/creatureArchetypes.ts EnemyCues adapter).
//
//  - DORMANT: no groans; short hum PHRASES from her world position (lane AUDIO's Sfx.sirenHum: an enemy VOCAL through the existing
//    navigable-route gate / vocal cap / occlusion / storey rules). The cadence is ours and bounded: the first phrase SIREN_HUM_PACE
//    .first s after the spawn (seeded per actor), then the next only after the phrase length + a SIREN_HUM_PACE.gap pause; nothing
//    is asked beyond SIREN_HUM_PACE.maxDist m (straight line), and a gated / culled request retries after retryS. The hum invites
//    curiosity; it never moves the player or touches the controls.
//  - WAKE: the brain hands out the scream exactly once (SirenBrain.takeScream()); lane AUDIO's Sfx.sirenScream stops her hum and
//    plays one scream (once per actor on its side too) through the master compressor / limiter.
//  - AWAKE: no vocals at all (no groan / alert on re-sighting); claw swing = the existing zombie swing whoosh; footfalls = the
//    zombie gait; death = the existing zombie death cue (+ any hum fades).
// Missing clips stay silent (Sfx no-ops).

import {SIREN_HUM, type Sfx} from '../audio/sfx';
import type {EnemyActor, EnemyCues} from './creatureArchetypes';
import {SirenBrain} from './siren';

/** Hum pacing (s / m); see the header. `maxDist` = lane AUDIO's hum voice cull distance (audio/sfx.ts SIREN_HUM). */
export const SIREN_HUM_PACE = {first: [0.5, 3.5], gap: [2.5, 5.0], retryS: 1.5, maxDist: SIREN_HUM.maxDist} as const;
/** Voice heights over her feet (m): mouth while hunched / rising, standing. */
export const SIREN_VOICE = {hunched: 0.5, standing: 1.5} as const;

/** First hum delay for a new actor (s) from a 0..1 roll. */
export function firstHumDelay(roll: number): number {
  const [a, b] = SIREN_HUM_PACE.first;
  return a + (b - a) * roll;
}

export const SIREN_CUES: EnemyCues = {
  alert: () => {}, // the scream belongs to the wake (tick), never to re-sighting the player
  attack: (sfx, z) => sfx.zombieAttack(z.brain.x, z.brain.y + SIREN_VOICE.standing, z.brain.z),
  tick(sfx, z, dt, moved, dist, rand) {
    const b = z.brain;
    if (!b.alive) return;
    if (b instanceof SirenBrain && b.takeScream()) sfx.sirenScream(z, b.x, b.y + SIREN_VOICE.hunched, b.z);
    if (b.state === 'dormant') {
      z.groanT -= dt;
      if (z.groanT <= 0) {
        const dur = dist <= SIREN_HUM_PACE.maxDist ? sfx.sirenHum(z, b.x, b.y + SIREN_VOICE.hunched, b.z) : 0;
        const [g0, g1] = SIREN_HUM_PACE.gap;
        z.groanT = dur > 0 ? dur + g0 + (g1 - g0) * rand() : SIREN_HUM_PACE.retryS;
      }
      return;
    }
    if (b.state === 'rise') return;
    if (!b.climbing) sfx.zombieGait(z, b.x, b.z, moved, dt, false, b.y);
  },
  hurt: () => {},
  death: (sfx, z) => {
    sfx.sirenHumStop(z);
    const asleep = z.brain instanceof SirenBrain && z.brain.wakes === 0; // killed in her sleep: still hunched
    sfx.zombieDeath(z.brain.x, z.brain.y + (asleep ? SIREN_VOICE.hunched : 1.2), z.brain.z);
  },
};

/** Fade a Siren's hum (section teardown / despawn); harmless when none sounds. */
export function stopSirenHum(sfx: Sfx, z: EnemyActor): void {
  sfx.sirenHumStop(z);
}
