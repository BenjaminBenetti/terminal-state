#!/usr/bin/env python3
"""BB's VOICE — Sound Lab generation plan (task studio-bb-production-20261112-234540-01, lane AUDIO).

BB: a small crawling undead with four looks that share ONE voice set (game/src/ai/bb.ts, audio/sfx.ts bbVoice / BB_AUDIO). Cues
(runtime ids): bbCackle (the loud eerie cackle when it notices the player: the gameplay tell), bbGiggle (a quiet short giggle now
and then while one is near), bbPounce (the gleeful squeal of its pounce: the cue starts with the wind-up tell and is loudest at the
launch), bbHurt (a short warped toy-like squeak when it is shot), bbDeath (a laugh that winds down like a broken wind-up toy). The
tone is a creepy doll / haunted-nursery laugh: non-graphic, and hurt / death are creature- and toy-like, never a suffering child.

Reuse first (game/src/audio/bank.ts): every enemy vocal in the bank is a groan, growl, snarl, hum, scream, shriek, wheeze or gurgle;
the market set's voices are adult screams and grunts. Nothing in it laughs, so the five cues are generated.

Authority: the task's audio authorization (the user approved generating this laugh set with the EXISTING FREE LOCAL Sound Lab inside
the task: no separate approval and no fixed attempt cap; no paid or external audio service of any kind; normal serialization,
private masters, hash-only public provenance, honest QA reporting). The runner: tools/audio-pipeline/soundlab_runner.py
(SOUND_LAB_AUDIO_DIR = the task's private audio folder, SOUND_LAB_MAX_POSTS = the durable cap of each bounded run,
flock /tmp/ll-soundlab.lock held for the run). MAX_JOBS below is this lane's own ceiling, not a permission.

The prompt TEXT stays private: it is read from PROMPTS.json in SOUND_LAB_AUDIO_DIR (the private raw archive, never in Git); this
file holds the ids, cues, whole-second durations and deterministic seeds (sha256 of the clip id). Writes the planned queue
(append-only: existing ids are never rewritten) and PLAN.json to SOUND_LAB_AUDIO_DIR. Durations are WHOLE seconds (fractional
requests have come back as broadband noise); the derivative builder (tools/audio-pipeline/bb-build.mjs) trims later. Prompts:
`TrackType: SFX`, source, action + decay, close mic, a DRY take (the game's convolver adds the room).

Batches are appended only after the structural QC of the earlier one (the worker cannot listen): further takes of an accepted
request (the same prompt, a new seed) and replacements of structurally rejected takes — never a reroll of an acceptable one.

Python 3 standard library only. Usage: SOUND_LAB_AUDIO_DIR=<dir> python3 -I tools/audio-pipeline/bb-plan.py [--dry-run] [--through A|B|...]
"""
from __future__ import annotations

import hashlib
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
AUDIO = Path(os.environ.get("SOUND_LAB_AUDIO_DIR") or ROOT / "reference/tasks/bb-production-20261112-234540/audio")
QUEUE = AUDIO / "queue.json"
PLAN_JSON = AUDIO / "PLAN.json"
PROMPTS = AUDIO / "PROMPTS.json"
TASK = "studio-bb-production-20261112-234540-01"
STEPS, CFG = 8, 1.0  # upstream: rf_denoiser distilled for 8 steps; CFG 1 = guidance off (single pass) - as every earlier plan
MAX_JOBS = 48


def seed_for(clip_id: str) -> int:
    return int(hashlib.sha256(f"terminal-state-bb-20261112:{clip_id}".encode()).hexdigest()[:8], 16) & 0x7FFFFFFF


# (id, cue, seconds). Order = priority. The prompt for each id is PROMPTS.json[id] (private).
BATCHES: dict[str, list[tuple[str, str, float]]] = {
    # A: a first reading of every cue — two wordings each for the cackle, the giggle and the pounce squeal.
    "A": [
        ("bb-cackle-01", "bbCackle", 3.0),
        ("bb-cackle-02", "bbCackle", 3.0),
        ("bb-giggle-01", "bbGiggle", 2.0),
        ("bb-giggle-02", "bbGiggle", 2.0),
        ("bb-pounce-01", "bbPounce", 2.0),
        ("bb-pounce-02", "bbPounce", 2.0),
        ("bb-hurt-01", "bbHurt", 2.0),
        ("bb-death-01", "bbDeath", 3.0),
    ],
    # Structural QC of batch A (private QC.json / qc/*.png; NOT listened to):
    #  - cackle-01: 15 bursts at 6.8 / s that thin out and decay over 2 s, a high partial near 1 kHz, mostly noisy (voiced 8 %); a
    #    separate steady sound at 2.2-2.45 s after it. cackle-02: 12 regular bursts at 5.5 / s (interval spread 19 %) that decay,
    #    pitched syllables at 500-750 Hz under bright breath noise. Both read as burst trains; further takes of both requests.
    #  - giggle-01 / 02: 5-6 voiced syllables each (f0 about 400-600 Hz) at 5.3-6.7 / s inside 0.65-1.0 s, then silence. One more of each.
    #  - pounce-01: ONE continuous 1.08 s event that starts at once, glides upward (the strongest partial 2 -> 3.7 kHz) and is loudest
    #    in its last 0.2 s before a sharp stop. pounce-02: six separate voiced syllables that get louder (the loud ones 1.2-1.75 s).
    #  - hurt-01: three separate squeaks (a 0.24 s noisy one with a fast attack; a 0.37 s steady 1.17 kHz one that swells).
    #  - death-01: ten unvoiced clicks that slow down and decay (a ratchet running out): a mechanism, no laugh in it. New wordings.
    # B: further takes of the accepted requests (the same prompt, a new seed) + new wordings for the hurt squeak and the wind-down.
    "B": [
        ("bb-cackle-03", "bbCackle", 3.0),
        ("bb-cackle-04", "bbCackle", 3.0),
        ("bb-cackle-05", "bbCackle", 3.0),
        ("bb-giggle-03", "bbGiggle", 2.0),
        ("bb-giggle-04", "bbGiggle", 2.0),
        ("bb-pounce-03", "bbPounce", 2.0),
        ("bb-pounce-04", "bbPounce", 2.0),
        ("bb-pounce-05", "bbPounce", 2.0),
        ("bb-hurt-02", "bbHurt", 2.0),
        ("bb-hurt-03", "bbHurt", 2.0),
        ("bb-death-02", "bbDeath", 3.0),
        ("bb-death-03", "bbDeath", 3.0),
    ],
    # Structural QC of batch B (NOT listened to):
    #  - cackle-03 / 04: the family of cackle-02 (10 bursts in 1.77 s at 5.6-5.9 / s, the same rhythm within 40 ms, pitched 520-780 Hz);
    #    cackle-05: the family of cackle-01 (12 bursts in 2 s, the pitch stepping down 1.08 kHz -> 680 -> 430 Hz).
    #  - giggle-03 / 04: the families of giggle-01 / 02 (4-5 voiced syllables in 0.67-0.69 s + a late quieter one).
    #  - pounce-03: the continuous rising glide of pounce-01 (0.87 s, loudest in its last 0.17 s, a sharp stop) + a second 0.3 s squeal
    #    0.1 s later. pounce-04: the same glide but loudest 0.27 s after its start, then declining (no build). pounce-05: quiet
    #    syllables, then one loud 0.25 s shriek 1.35 s in (nothing audible at once before it).
    #  - hurt-02 / 03: as hurt-01 — a 0.2-0.24 s noisy squawk with a 25-45 ms attack, then a separate steady 1.14-1.19 kHz squeak.
    #  - death-02: voiced laugh syllables whose pitch steps down 600 -> 480 -> 220 -> 155 Hz over 1.47-2.3 s. death-03: a fixed-pitch
    #    (650 Hz) pulse train whose bursts get quieter (-10 dB over 1 s) and longer: a toy running down.
    # C: three further takes of the rising-squeal request (the pounce cue needs takes that build to their loudest part).
    "C": [
        ("bb-pounce-06", "bbPounce", 2.0),
        ("bb-pounce-07", "bbPounce", 2.0),
        ("bb-pounce-08", "bbPounce", 2.0),
    ],
    # Structural QC of batch C (NOT listened to):
    #  - pounce-06: the glide again, but loudest 0.23 s after its start (no build). pounce-07 / 08: the family of pounce-03 — a steady
    #    squeal (main partial 3.1-3.3 kHz) that steps up about 10 dB to its loudest part 0.7-0.9 s into the event.
    # Outcome (tools/audio-pipeline/bb-build.mjs; 23 jobs): 16 takes shipped (cackle 02-05, giggle 01-04, pounce 03 / 07 / 08,
    # hurt 01-03, death 02 / 03), 5 structurally rejected (pounce 02 / 04 / 05 / 06, death 01), 2 usable spares not shipped
    # (cackle 01, pounce 01). No further batch was planned.
}


def build(through: str, prompts: dict[str, str]) -> list[dict]:
    rows: list[tuple[str, str, float]] = []
    for name in BATCHES:
        rows += BATCHES[name]
        if name == through:
            break
    out, seen = [], set()
    for cid, cue, seconds in rows:
        prompt = prompts.get(cid)
        assert isinstance(prompt, str) and prompt.startswith("TrackType: SFX"), (cid, "PROMPTS.json entry missing / not an SFX prompt")
        assert len(prompt) <= 600, (cid, len(prompt))
        assert float(seconds).is_integer() and 1.0 <= seconds <= 30.0, (cid, seconds)  # WHOLE seconds only
        assert cid not in seen, cid
        seen.add(cid)
        out.append({"id": cid, "cue": cue, "prompt": prompt, "negative_prompt": "", "seconds": seconds,
                    "steps": STEPS, "cfg": CFG, "seed": seed_for(cid)})
    assert len(out) <= MAX_JOBS, len(out)
    return out


def write_atomic(path: Path, obj) -> None:
    tmp = path.with_name("." + path.name + ".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, indent=1)
        f.write("\n")
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)


def main(argv: list[str]) -> int:
    through = argv[argv.index("--through") + 1] if "--through" in argv else "A"
    if through not in BATCHES:
        print(f"unknown batch {through}", file=sys.stderr)
        return 2
    if not PROMPTS.exists():
        print(f"missing {PROMPTS} (the private prompt file)", file=sys.stderr)
        return 2
    prompts = json.loads(PROMPTS.read_text(encoding="utf-8"))
    plan = build(through, prompts)
    if "--dry-run" in argv:
        print(json.dumps({"through": through, "clips": len(plan), "audioSeconds": sum(c["seconds"] for c in plan), "ids": [c["id"] for c in plan],
                          "promptChars": [len(c["prompt"]) for c in plan], "seeds": [c["seed"] for c in plan]}, indent=1))
        return 0
    AUDIO.mkdir(parents=True, exist_ok=True)
    existing = json.loads(QUEUE.read_text(encoding="utf-8"))["clips"] if QUEUE.exists() else []
    by_id = {c["id"]: c for c in existing}
    for c in plan:
        if c["id"] in by_id and by_id[c["id"]] != c:
            print(f"refusing: queue entry {c['id']} differs from plan; entries are never rewritten", file=sys.stderr)
            return 2
    merged = existing + [c for c in plan if c["id"] not in by_id]
    if len(merged) > MAX_JOBS:
        print(f"refusing: {len(merged)} clips exceed this lane's {MAX_JOBS}-job ceiling", file=sys.stderr)
        return 2
    if len(merged) == len(existing):
        print(f"queue unchanged ({len(existing)} clips)")
        return 0
    write_atomic(QUEUE, {
        "task": TASK, "lane": "AUDIO (BB's voice: cackle, giggle, pounce squeal, hurt squeak, wind-down death)",
        "endpoint": "http://10.0.0.59:7871",
        "contract": "tools/audio-pipeline/soundlab_runner.py (SOUND_LAB_AUDIO_DIR = this folder, SOUND_LAB_MAX_POSTS = each bounded run's "
                    "durable cap, flock /tmp/ll-soundlab.lock); POST /api/generate {prompt,negative_prompt,seconds,steps,cfg,seed} -> 202 {job}",
        "note": "Planned before any request. Entries are append-only; ids never rewritten. Whole-second durations only.",
        "clips": merged})
    write_atomic(PLAN_JSON, {
        "task": TASK, "authorization": "the task's audio authorization: the existing FREE LOCAL Sound Lab inside this task, no separate "
        "approval and no fixed attempt cap; the existing service through the proven runner + lock in bounded batches. Paid / external 0; "
        "no other provider; no new service / account / install / restart; no synthesis.",
        "reuseCheck": "no bank cue laughs (enemy vocals are groans, growls, snarls, hums, screams, shrieks, wheezes, gurgles; the market "
        "voices are adult screams / grunts)",
        "laneCeiling": MAX_JOBS, "through": through,
        "clips": [{"id": c["id"], "cue": c["cue"], "seconds": c["seconds"], "seed": c["seed"]} for c in merged],
        "listening": "the worker cannot listen: structural QC only (envelope / laugh bursts / quiet fraction / attack / spectrum / pitch "
        "track / peak / DC / loudness, spectrogram images); the user hears it in game"})
    print(f"queue: {len(existing)} -> {len(merged)} clips")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
