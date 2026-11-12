// Task studio-weapon-soundlab-audio-20261110-063407-01: a gun's OWN Sound Lab voice (user: "the guns all use the same default gun
// noises ... please use that!"). The held weapon's id finds its cues by naming convention — `gun` + PascalCase(weapon id) + part, e.g.
// coach_gun -> gunCoachGunShot / gunCoachGunBreakOpen — so there is no second list of guns: a weapon routes to its own cues exactly when the
// bank has clips for them (manifest.gunVariety.generated.ts, built by tools/audio-pipeline/gun-variety-build.mjs), and otherwise keeps its
// sound set's shared cues (audio/sfx.ts WEAPON_SHOT_CUES, the rifle / pistol magazine cues). The baseline pistol / rifle / shotgun have no
// such cues (gunPistolShot is not pistolShot), so they keep theirs unchanged.

import {CLIP_MANIFEST, CUES, type CueId} from './bank';
import {GUN_VARIETY_CUE_GAIN} from './manifest.gunVariety.generated';

/** The parts a gun's own voice may have: its shot, a magazine's out / in, a break action's open / close. */
export type GunVoicePart = 'Shot' | 'MagOut' | 'MagIn' | 'BreakOpen' | 'BreakClose';

/** Mix gains of the gun-voice cues (merged into sfx.ts CUE_GAIN; measured against the baseline families by the build). */
export const GUN_VOICE_GAINS = GUN_VARIETY_CUE_GAIN;

const KNOWN: ReadonlySet<string> = new Set(CUES);

/** The convention's cue id for a weapon id + part (whether or not the bank has it). */
export function gunCueId(weaponId: string, part: GunVoicePart): string {
  return `gun${weaponId.split(/[^A-Za-z0-9]+/).filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join('')}${part}`;
}

/**
 * Task studio-turnstile-user-model-20261112-004550-01: parts a gun SHARES from another gun's existing voice (no new audio, no generation).
 * The Turnstile's top break opens and snaps shut with the Coach Gun's break cues (the same break-action reload); its shot is the shotgun
 * set's shared shot (no own Shot: shotCycle 'none', so no pump rack) and its shells the shared insert. A gun's OWN cue for a part wins.
 */
export const GUN_VOICE_SHARES: Readonly<Record<string, Partial<Record<GunVoicePart, string>>>> = {
  turnstile: {BreakOpen: 'coach_gun', BreakClose: 'coach_gun'},
};

/** The cue of `weaponId`'s own clips for `part` (null: the bank has none). */
function ownCue(weaponId: string, part: GunVoicePart): CueId | null {
  const id = gunCueId(weaponId, part);
  return KNOWN.has(id) && (CLIP_MANIFEST[id]?.length ?? 0) > 0 ? (id as CueId) : null;
}

/**
 * The weapon's own cue for `part` — or the one it shares from another gun (GUN_VOICE_SHARES) — or null (no id, or neither has clips for
 * it: the caller keeps the shared cue).
 */
export function gunCue(weaponId: string | null | undefined, part: GunVoicePart): CueId | null {
  if (!weaponId) return null;
  const from = GUN_VOICE_SHARES[weaponId]?.[part];
  return ownCue(weaponId, part) ?? (from ? ownCue(from, part) : null);
}
