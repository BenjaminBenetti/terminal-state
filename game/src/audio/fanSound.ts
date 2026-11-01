// Task studio-alpha-track2-round2-20261031-01 (R4, audio): the service annexes' ventilation fans make a plausible mechanical /
// airflow noise. User (round 2): "ventaliation fan should spin, and make noise."
//
// Source: an ACCEPTED EXISTING recording only — `bed-hvac-02-loop.mp3` (cue bedHvac; Sound Lab prompt "a steady ventilation
// system, air rushing through ducts and a constant fan hum", provenance game/public/assets/derivatives/audio-iteration05.json).
// The bounded local edit is runtime-only: a per-fan playback rate (motor speed variety), a band-limit and the shared distance /
// occlusion filtering. No new file, no synthesis, no provider audio. Not auditioned by ear on the build worker (NOTICE.md).
//
// This module is pure (no Web Audio): where the fans are, and which ones the listener hears. audio/sfx.ts owns the voices.

import type {StationLayout} from '../gen/stationTypes';

/** One fan as a sound source: world position of its hub / drum, its floor height (storey gate) and a stable per-fan rate. */
export interface FanSource {
  x: number; y: number; z: number;
  /** The fan's floor (absolute m): the storey gate compares the listener's feet with it. */
  floorY: number;
  kind: 'fanWall' | 'fanUnit';
  /** Playback rate of the shared loop for this fan (0.9–1.1, seeded): two fans never drone in unison. */
  rate: number;
}

/**
 * Audible range (m) and the storey band (listener feet within this of the fan's floor). Round 3 (task
 * studio-alpha-track2-round3-20261031-01; user: "ventilation fan sound effect does not play in a large enough radius. should be maybe
 * 5x the current radius"): the whole distance law is scaled by FAN_RADIUS_SCALE — the cut-off 14 -> 70 m AND the panner's reference
 * distance 1.4 -> 7 m (inverse model, same rolloff), so the level heard at 5 d now equals the level heard at d before (round 2's
 * 14 m cut-off sat where the inverse law had already fallen to ~8 %: the fan was audible only within ~6-8 m).
 */
export const FAN_RADIUS_SCALE = 5;
export const FAN_SOUND = {maxDist: 14 * FAN_RADIUS_SCALE, storeyBand: 2.4, voices: 2, gain: 0.42, ref: 1.4 * FAN_RADIUS_SCALE, rolloff: 1.3, lowpassHz: 5200, highpassHz: 70} as const;

/** Fan hub positions from the annex machinery records (gen/annexRooms.ts AnnexMachine; same local frame as world/trackExt/machines.ts). */
export function fanSources(layout: Pick<StationLayout, 'extensions'>): FanSource[] {
  const out: FanSource[] = [];
  for (const m of layout.extensions?.machines ?? []) {
    if (m.kind !== 'fanWall' && m.kind !== 'fanUnit') continue;
    const hd = m.d / 2, R = (m.p?.[0] ?? 1.6) / 2;
    // fanWall: the hub on the wall-normal axis (local Z) at 0.30 + R; fanUnit: the casing drum centre (local X axis)
    const [lx, ly, lz] = m.kind === 'fanWall' ? [0, 0.3 + R, -hd + 0.25] : [0, 0.95, -hd + 0.85];
    // three.js Y rotation by m.rot (front = local +Z -> (sin rot, cos rot))
    const c = Math.cos(m.rot), s = Math.sin(m.rot);
    const h = ((m.seed >>> 0) % 1000) / 1000;
    out.push({x: m.x + lx * c + lz * s, y: m.y + ly, z: m.z - lx * s + lz * c, floorY: m.y, kind: m.kind, rate: 0.9 + 0.2 * h});
  }
  return out;
}

/**
 * The fans the listener hears: on the listener's storey (feet within FAN_SOUND.storeyBand of the fan's floor — no phantom fan
 * through a slab), within FAN_SOUND.maxDist, nearest first, at most `max` (the fixed voice pool). Pure; called at the emitter tick.
 */
export function audibleFans(fans: readonly FanSource[], L: {x: number; y: number; z: number}, feetY: number, max: number = FAN_SOUND.voices): {fan: FanSource; dist: number}[] {
  const near: {fan: FanSource; dist: number}[] = [];
  const r2 = FAN_SOUND.maxDist * FAN_SOUND.maxDist;
  for (const f of fans) {
    if (Math.abs(feetY - f.floorY) > FAN_SOUND.storeyBand) continue;
    const dx = f.x - L.x, dy = f.y - L.y, dz = f.z - L.z, d2 = dx * dx + dy * dy + dz * dz;
    if (d2 <= r2) near.push({fan: f, dist: Math.sqrt(d2)});
  }
  near.sort((a, b) => a.dist - b.dist);
  return near.slice(0, max);
}
