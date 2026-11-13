# BB — audio (the laugh set)

BB has one voice for all four looks: five cues, sixteen short clips. This page covers the audio side only: which cue plays when,
how loud and how far, what bounds it, where the clips come from and what was and was not checked. BB itself (looks, behaviour,
roster) is described in `docs/bb.md`.

The audio is **audio only**. Nothing here feeds the AI: muting the game, the voice limits, the route gates or distance culling
never change what a BB notices or does.

## The hook

`Sfx.bbVoice(kind, key, x, y, z, gateY)` (`game/src/audio/sfx.ts`), called by the brain's cue table (`BB_CUES`, `game/src/ai/bb.ts`).

| Argument | Meaning |
| --- | --- |
| `kind` | `'cackle' \| 'giggle' \| 'pounce' \| 'hurt' \| 'death'` (`BbVoiceKind`) |
| `key` | the BB itself: its own rate limits and its own throat |
| `x, y, z` | the mouth in world space. It may hang under a ceiling or sit on a wall. The sound comes from here. |
| `gateY` | the height of the floor below the body. The route and storey gates are asked there (see below). |

It returns nothing. With audio paused, not started, or a clip missing it is a silent no-op; there is never a stand-in sound.

## The cues

Ranges and limits are in `BB_AUDIO`, mix gains in `CUE_GAIN` (both `game/src/audio/sfx.ts`).

| Kind | When the brain fires it | Cue | Takes | Clip length | Level at the source | Heard to | Gate | Voice-cap priority |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `cackle` | it notices the player; again at most every 7 s (`BB_SENSE.cackleGapS`) | `bbCackle` | 4 | 1.8–2.0 s | −16.5 LUFS | 36 m | navigable route (alert law) | 2: never dropped |
| `giggle` | every 5–10 s while within 16 m and not winding up or leaping | `bbGiggle` | 4 | 0.9–1.25 s | −24.9 LUFS | 17 m | navigable route (idle law) + the shared vocal cap | 1 |
| `pounce` | once, at the START of the wind-up tell, 0.55 s before the leap launches | `bbPounce` | 3 | 1.06–1.11 s | −16.5 LUFS at its loudest part | 28 m | none | 2: never dropped |
| `hurt` | shot but not killed | `bbHurt` | 3 | 0.22–0.26 s | −21.5 LUFS | 26 m | none | 1 |
| `death` | killed | `bbDeath` | 2 | 1.03–1.11 s | −19.5 LUFS | 34 m | none | 1 |

"Level at the source" is the cue's loudest 400 ms (momentary-max loudness) after `CUE_GAIN`, before distance, occlusion and the
master. For comparison, from the same calibration: a zombie groan −18.5, a zombie attack −20.3, a zombie death −17.1, the Siren's
wake scream −15.8, the Siren's hum −24.3.

Each call adds a small spread so repeats do not sound identical: pitch ±3–8 % and level ±0.5–1.5 dB depending on the kind. No
call can exceed the clips' −1 dBFS ceiling.

### How far it carries

Dry level by the distance law, from the calibrated source levels:

| Cue | At | About |
| --- | --- | --- |
| cackle | 28 m | −37 LUFS: about 6 dB over a zombie groan at the groan's own 34 m limit |
| cackle | 34 m of route | fading: the route law fades it out over the last 8 m before 38 m |
| giggle | 12 m | −46 LUFS: quiet |
| giggle | 2 m | −29 LUFS |
| pounce, loudest part | 3 m | −18 LUFS |

A wall between you and a cackling BB muffles the cackle and lowers it by about 4 dB. It does not silence it, so it stays
present through a doorway or round a corner.

## The gates use the floor below the body

Enemy vocals are heard along the navigable route, not through slabs. The route field finds a voice's floor by looking at most
2.7 m below it. A BB on a ceiling or high on a wall is further above its floor than that, so its mouth alone would never be found.

So the cackle and the giggle ask the route at `gateY` + 0.3 m: where the mouth of a BB crawling on the floor below would be. A BB
on a ceiling is heard like one on the floor under it. The panner, the straight-line distance and the line-of-sight test stay at the
real mouth, so the sound still comes from above.

- **Cackle.** Route-gated by the alert law: silent on another storey with no route in range, lowered by a long way round, heard
  by the straight line when in clear sight. It is outside the shared cap of three enemy vocals that thins groans, so three
  groaning zombies beside you cannot swallow the tell.
- **Giggle.** An ordinary idle enemy vocal: route gate, the shared vocal cap, storey rules.
- **Pounce, hurt, death.** Combat cues. Never route-gated.

## Bounds

| Bound | cackle | giggle | pounce | hurt | death |
| --- | --- | --- | --- | --- | --- |
| Per BB, at most one every | 4 s | 2.5 s | 1.5 s | 0.4 s | 5 s |
| Sounding at once, whole level | 2 | 2 | 3 | 2 | 2 |

- The per-BB limits are below the brain's own cadence, so they never thin it. They only stop a caller bug from stacking a cue.
- Past the cap a new cue is dropped. Cackles are the exception: the nearest win. A nearer cackle fades out the farthest
  sounding one; a farther new one is dropped.
- **One throat.**
  - No giggle while that BB is still voicing anything.
  - No cackle while that BB's own pounce squeal is sounding.
  - The pounce squeal takes the throat: that BB's sounding cackle or giggle fades out under it in 0.1 s, so the warning is not
    masked by its own laugh.
  - Death fades everything that BB was still voicing.
  - The hurt squawk cuts nothing.
- A cue that is dropped by a gate, a cap or the one-throat rule does not use up the BB's rate limit.
- All clips are one-shots. Nothing loops and nothing is decoded per call.

## The pounce timing

The pounce clip starts with the wind-up, not with the leap. Each take is audible from its first frame, sits about 10 dB under its
loudest part for the first half second, and reaches that loudest part 0.50–0.56 s after its start: at the launch
(`BB_POUNCE.windupS` = 0.55 s). `game/tests/bb-audio.test.ts` pins this against `BB_POUNCE.windupS`; if the wind-up changes, the
clips need re-cutting in `tools/audio-pipeline/bb-build.mjs`.

## Files

| What | Where |
| --- | --- |
| Clips | `game/public/assets/audio/bb-*.mp3` (16 files, 256 KB) |
| Cue list, clips, mix gains (generated) | `game/src/audio/manifest.bb.generated.ts` |
| Ranges, limits, the hook | `BB_AUDIO`, `bbVoice` in `game/src/audio/sfx.ts` |
| Provenance, structural metrics, mix calibration | `game/public/assets/derivatives/audio-bb.json` |
| Licence notice and credits | `game/public/assets/audio/NOTICE.md`, `game/public/assets/CREDITS.md` |
| Plan (ids, cues, durations, seeds) | `tools/audio-pipeline/bb-plan.py` |
| Builder (takes → clips, manifest, provenance) | `tools/audio-pipeline/bb-build.mjs` |
| Tests | `game/tests/bb-audio.test.ts` |

The clips were generated with the user's local Sound Lab under the BB task's audio authorization: the free local service only,
nothing paid or external. Their status is **conditional prototype**, not production or commercial clearance; the provenance file
records `gameReady: false`. The prompt text and the raw takes are kept privately, outside Git. The public record names each take by
job id, seed and hashes.

The builder makes no Sound Lab call. It only edits generated takes: mono, trim, short fades, peak −1 dBFS, the takes of a cue
matched in loudness, MP3. It is deterministic: a rebuild from the same takes gives byte-identical files. To change a level, edit
the `MIX` target in the builder and rebuild, then copy the new gain into `CUE_GAIN`; the tests fail if the two differ.

## What was checked, and what was not

**Not listened to.** The build worker has no audio output. Nobody has heard these clips yet. Whether a burst train reads as a
laugh, whether it is eerie rather than silly, and whether the mix sits right in play all need an ear.

What was done instead is structural analysis of every take and every shipped clip: level envelopes, burst count / rate / depth,
time to the loud part, spectrograms (viewed), spectral centroid and bands, pitch tracks, peak, DC, edge levels and loudness.
Every shipped clip passes a structural gate for its cue; the gates and measured values are in the provenance file. They describe
signal structure only.

Of 23 generated takes, 16 ship, 5 were rejected for structure and 2 usable spares were left out. Each unused take is listed in the
provenance file with its reason.

Automated tests cover the registration, the files against their hashes and the release allowlist, the mix arithmetic and the Sfx
behaviour on a fake Web Audio graph. No browser playback check was run.

Known limits, for the ear pass:

- **Hurt** clips are 0.22–0.26 s, under the 0.3–0.6 s first asked for. The takes hold a short squawk and then a separate steady
  squeak; only the squawk is used.
- **Pounce** builds mostly in level (about 10 dB). Its pitch rises only 1.5–3 semitones into the loud part.
- **Cackle** takes 1–3 come from one request and share almost the same rhythm (ten bursts in 1.8 s); take 4 differs.
- **Death** take 2 winds down in level, not in pitch. Take 1 drops in pitch by more than an octave.
- The levels are first estimates set against the existing calibration. They are tuned in one place: `CUE_GAIN`.
