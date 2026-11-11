// Task studio-corpse-chipper-fuel-20261110-235304-01: WORLD NOISE — a sound made by something in the world (a machine), not by the player,
// heard at the SOURCE'S position. One call: the existing enemies hear it through the established rule (ai/brain.ts alertListeners: 3D
// radius, line of sight + slab muffling; nothing spawned, no AI change), then every registered listener gets the same event
// (Game.worldNoiseListeners: e.g. a hunter that hears through its own belief model). Callers emit at a controlled cadence (a start, a
// feed, a grind pulse every few seconds), never per audio frame, and a listener never re-emits (no echo feedback).

import {alertListeners, type ZombieBrain} from './brain';

export type WorldNoiseKind = 'machine-start' | 'machine-feed' | 'machine-grind' | 'machine-stop';

export interface WorldNoise {
  /** World position of the source (m; y = the sound's height). */
  x: number; y: number; z: number;
  /** Loudness: the hearing radius (m) before muffling. */
  radius: number;
  kind: WorldNoiseKind;
  /** Who made it (QA / listeners), e.g. 'train-chipper'. */
  source: string;
}

export interface WorldNoiseHost {
  zombies?: readonly {brain: ZombieBrain}[];
  levels?: {lineOfSight?(a: {x: number; y: number; z: number}, b: {x: number; y: number; z: number}): boolean; count?: number; list?: readonly {baseY: number}[]} | null;
  worldNoiseListeners?: readonly ((n: WorldNoise) => void)[];
}

const HEAD = {x: 0, y: 0, z: 0};

/** Emit one world noise: the enemies hear it (alertListeners at the source), then each listener. Returns the listener count. */
export function emitWorldNoise(host: WorldNoiseHost, n: WorldNoise): number {
  const L = host.levels, zs = host.zombies ?? [];
  if (zs.length && L && typeof L.lineOfSight === 'function') {
    const src = {x: n.x, y: n.y, z: n.z}, los = L.lineOfSight.bind(L);
    const bases = (L.count ?? 0) > 1 && L.list ? L.list.map(l => l.baseY) : null;
    alertListeners(zs.map(z => z.brain), src, n.radius, b => { HEAD.x = b.x; HEAD.y = b.y + 1.5; HEAD.z = b.z; return los(src, HEAD); }, bases);
  }
  const ls = host.worldNoiseListeners ?? [];
  for (const l of ls) l(n);
  return ls.length;
}
