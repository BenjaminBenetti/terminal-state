# Flamethrower and fire — audio

The flamethrower's jet and the fire it leaves have seven cues of their own (ten clips) and reuse two existing ones. This page
covers the audio side only: which call plays what, how loud and how far, what bounds it, where the clips come from and what was
and was not checked.

The audio is **audio only**. Nothing here feeds gameplay: muting the game, a full voice pool or a missing clip never changes what
burns, what the stream hits or what enemies hear.

## The hook

The fire code talks to one interface, `FlameSound` (`game/src/fire/sound.ts`). `FlameAudio` (`game/src/audio/flameAudio.ts`)
implements it over the game's `Sfx`:

```ts
const sound: FlameSound = new FlameAudio(sfx);
```

| Call | What plays |
| --- | --- |
| `streamOn(x, y, z)` | The ignition whoomp at the muzzle, and the roar loop comes up at once under it. A second call while the stream is on does nothing. |
| `streamOff(dry)` | The roar fades in 0.12 s, an ignition that is still sounding is cut, and the cut-off take plays at the muzzle. `dry` (the tank ran empty) plays the same takes lower and slower. |
| `frame(dt, muzzle, fires)` | The roar follows the muzzle. Each burning place in `fires` (at most `FIRE_VOICES` = 3) gets one positional fire-bed loop at its `level`. |
| `ignite(x, y, z)` | A prop catching fire: a soft whoomp at the prop. |
| `burnOut(x, y, z)` | A burnt prop caving in: a heavy hit with an ember crackle layered over it. |
| `refill(seconds)` | The existing jerrycan pour, at most `seconds` of it. Returns a function that cuts that pour (a cancelled refill). |
| `dry()` | The existing dry click, at its lower rate. |
| `silence()` | Everything ends within 0.05 s. No cut-off cue. |

With audio paused, not started, or a clip missing, every call is a silent no-op. There is never a stand-in sound.

**The caller owes one thing:** when the last fire dies and the stream is off, call `frame` once more with an empty list (or call
`silence()`). That is what fades the fire beds. As a backstop, beds are released by the next call of any method once `frame` has
not run for 0.75 s.

## The cues

Mix gains are in `CUE_GAIN` (`game/src/audio/sfx.ts`, which spreads the builder's `FIRE_CUE_GAIN`). Distances and limits are in
`FLAME_AUDIO` (`game/src/audio/flameAudio.ts`).

| Cue | Played by | Clips | Length | Level at the source | Heard to |
| --- | --- | --- | --- | --- | --- |
| `flameIgnite` | `streamOn` | 2 | 0.87 s | −19.9 LUFS | 50 m |
| `flameRoar` (loop) | while the stream is on | 1 | 7 s loop | −24.0 LUFS | 45 m |
| `flameOut` | `streamOff` | 2 | 0.98 s, 0.45 s | −26.0 LUFS | 50 m |
| `fireBurn` (loop) | each burning place in `frame` | 1 | 7 s loop | −28.1 LUFS at full level | 22 m |
| `fireCatch` | `ignite` | 2 | 0.70 s, 0.87 s | −22.0 LUFS | 35 m |
| `fireCollapse` | `burnOut` | 1 | 0.61 s | −20.0 LUFS | 35 m |
| `fireEmbers` | `burnOut`, 0.03 s after the hit | 1 | 1.43 s | −25.0 LUFS | 35 m |
| `fuelPour` (existing) | `refill` | 1 | 2.58 s | unchanged | at the hands |
| `dryFire` (existing) | `dry` | existing | existing | unchanged | at the hands |

"Level at the source" is the cue's loudness after `CUE_GAIN`, before distance, occlusion and the master: the loudest 400 ms for a
one-shot, the integrated loudness for a loop. For comparison, from the same calibration: a zombie groan −18.5, a zombie attack
−20.3, the chipper's wet grind loop −25.1, the chipper's motor loop −27.9.

- **The roar** is the player's own weapon, so it plays at its source level: the muzzle is always inside the panner's 2.5 m
  reference distance. It sits 1 LU over the chipper's wet grind and 5.5 LU under a zombie groan's loudest 400 ms, and about 80 %
  of its energy is under 300 Hz, so enemy vocals stay over it.
- **A fire bed** follows the inverse-distance law from a 3 m reference: about −39 LUFS at 10 m and −45 LUFS at 20 m, silent
  beyond 22 m. A wall in between muffles it and lowers it by up to 5 dB. A fire's `level` (0–1) scales the bed between 30 % and
  100 % of the cue's level, so a dying patch still crackles.
- **The collapse** is two layers by design. No single take had both weight and crackle with the hit first, so the heavy hit and
  the ember crackle are separate clips started together.
- One-shots get a small spread per call (pitch ±2 %, level ±0.5 dB). Nothing can exceed the clips' −1 dBFS ceiling.

## Bounds

| Situation | Bound |
| --- | --- |
| Tapping the trigger | A new roar loop at most once per 0.2 s. A stopped roar is gone within 0.17 s, so at most two roar loops ever exist. Up to five taps a second each get their ignition, roar and cut-off. |
| Ignition | One at a time: a new one cuts the one still sounding. At most one per 0.2 s. |
| Cut-off | At most one per 0.2 s. |
| Fire beds | Three slots. Each slot requests a loop at most once per second, whatever the reason, and a released loop is gone within 0.85 s: at most two loops per slot. |
| A fire that creeps | A burning place within 2.5 m of a sounding bed keeps that bed; the loop glides there. A place farther away gets a new loop and the old one fades where it was. |
| Several props catching or collapsing in one frame | Staggered 0.07 s apart, five at most; further ones in the same burst are dropped. |
| Dry click | At most one per 0.15 s. |
| A lost loop | `Sfx.setWorld` stops machine loops on a world change, and the machine-loop pool can evict one. `frame` requests a loop that should sound again, at most once per second per loop. |
| Audio paused or not started | The same once-per-second limit applies: nothing is requested every frame. |

The roar and the fire beds live in the Sfx machine-loop pool (`MACHINE_LOOP.max`, raised from 12 to 16 for the roar plus three
beds on top of a full Reactor and the train chipper). The roar is requested with `keep`: when the pool is full it makes room with
another loop first. Fire beds are ordinary pool members.

`FlameAudio` allocates nothing per frame. A loop is created only on a press, for a new burning place, or on a rate-limited
re-request.

## What changed in `Sfx`

| Addition | Why |
| --- | --- |
| `flameIgnite(x, y, z, opts)`, `stopFlameIgnite(fadeS)` | The ignition take roars on for about 0.7 s after the whoomp. A trigger released inside it must cut it. |
| `reactorLoop(..., {keep})` | The roar is passed over when the full pool makes room. |
| `MACHINE_LOOP.max` 12 → 16 | Room for the roar and three fire beds. |
| `MachineLoopCue`, `MachineCue` | The new loops and one-shots play through `reactorLoop` / `reactorCue`. |
| `fuelPour(maxS)` | A pour shorter than the take fades out there. Without the argument it behaves as before. |

## Files

| What | Where |
| --- | --- |
| Clips | `game/public/assets/audio/fire-*.mp3` (10 files, 215,508 bytes) |
| Cue list, clips, mix gains (generated) | `game/src/audio/manifest.fire.generated.ts` |
| The glue class, distances and limits | `FlameAudio`, `FLAME_AUDIO` in `game/src/audio/flameAudio.ts` |
| The interface | `game/src/fire/sound.ts` |
| Provenance, structural metrics, mix calibration | `game/public/assets/derivatives/audio-fire.json` |
| Licence notice and credits | `game/public/assets/audio/NOTICE.md`, `game/public/assets/CREDITS.md` |
| Plan (ids, cues, durations, seeds) | `tools/audio-pipeline/fire-plan.py` |
| Builder (takes → clips, manifest, provenance) | `tools/audio-pipeline/fire-build.mjs` |
| Tests | `game/tests/fire-audio.test.ts` |

The clips were generated with the user's local Sound Lab under the flamethrower task's audio authorization: the free local
service only, nothing paid or external. Their status is **conditional prototype**, not production or commercial clearance; the
provenance file records `gameReady: false`. The prompt text and the raw takes are kept privately, outside Git, with an independent
backup. The public record names each take by job id, seed and hashes.

The builder makes no Sound Lab call. It only edits generated takes: mono, trim, short fades, loop crossfade, levelling, MP3. It is
deterministic: a rebuild from the same takes gives byte-identical files. To change a level, edit the `MIX` target in the builder
and rebuild; `CUE_GAIN` picks the new gain up from the generated manifest.

## What was checked, and what was not

**Not listened to.** The build worker has no audio output. Nobody has heard these clips yet. Whether the roar reads as a
flamethrower, whether the bed reads as a fire and whether the mix sits right in play all need an ear.

What was done instead is structural analysis of every take and every shipped clip: level envelopes, 0.5 s block levels, 50 ms
level spread, crackle transients, time to the loud part, spectrograms (viewed), spectral centroid and bands, peak, DC, edge
levels, loop seams and loudness. Every shipped clip passes a structural gate for its cue; the gates and measured values are in
the provenance file. They describe signal structure only.

The two loops are **not** judged by the pipeline's generic "noise wall" rule, because a flame is steady broadband noise by
nature. They are judged by steadiness (0.5 s blocks within 1.5 dB), turbulence, crackle transients, band shares, the loop seam
and the viewed spectrogram. Neither shipped loop would in fact trip the generic rule; its inputs are recorded with each loop.

Of 14 generated takes, 10 ship and 4 were rejected for structure: two roars that were a dark rumble with almost nothing above
1 kHz, one roar that was a thin hiss with no body, and one fire that came back as separate surges with silence between them. Each
is listed in the provenance file with its reason. No job failed or was lost.

Automated tests cover the registration, the files against their hashes and the release allowlist, the mix arithmetic, the glue
class on a fake Sfx and the Sfx additions on a fake Web Audio graph. No browser playback check was run.

Known limits, for the ear pass:

- **Cut-off** has no hot-metal ticks after the fall. Two wordings both returned a falling whoosh only.
- **Ignition** has no distinct valve hiss before the whoomp.
- **The roar** is low-heavy: its bright layer is about 12 dB under the whole.
- **Dry cut-off** is the normal cut-off played lower and slower, not a take of its own.
- **Refill** and **dry click** are existing clips: a jerrycan pour and a hammer click, not a tank valve.
- The levels are first estimates set against the existing calibration. They are tuned in one place: the builder's `MIX` table.
