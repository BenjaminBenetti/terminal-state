#!/usr/bin/env python3
"""SKYWAYS prize-car set, round 2 — Sound Lab generation plan (task studio-beta-skyways-vehicle-20261107-054512-01, lane AUDIO).

Why new takes (measured, structural only — reference/tasks/skyways-vehicle-20261107-054512/audio/ROOT-CAUSE.md): the round-1 engine loops
(car-engine-idle-01 / car-engine-drive-01, "a deep smooth burbling rumble ... heard from the driver seat inside the cabin") are sub-bass
only — spectral centroid 48 Hz / 76 Hz, 85 % roll-off 62 Hz / 97 Hz, 99.8 % of the energy under 300 Hz; at the game's gain the idle's
content above 180 Hz sits at -47.7 dBFS (-20 dB under its own total). Laptop speakers / earbuds reproduce almost nothing there and the ear
is ~25 dB less sensitive at 50 Hz than in the mid-range: the engine was effectively inaudible. No gain / rate / filter can create the
missing mid-range, so the engine loops are regenerated with prompts that ask for the mid-range engine note (close to the engine /
exhaust, not inside a cabin), plus the arcade cues the car lacked: an engine start, a reverse-gear whine loop and a brake-to-stop.
The skid / door takes of round 1 are kept (structurally fine: centroid 1128 Hz / 414 Hz).

Authority: reference/tasks/skyways-rework-20261107-054512/USER-GENERATION-APPROVAL.json (localSoundLabJobsMax 8: the Beta vehicle lane
ONLY, the EXISTING local Stable Audio 3 Small-SFX Sound Lab through the proven runner + lock, only if reuse / the wiring fix is insufficient,
stop at the first acceptable take, close unused, structural QC — never an audition). This plan's batch A uses 5 of the 8; batch B
(<= 3) is filled in only after QC, to replace a structurally rejected take (same cue, adjusted prompt) — never a reroll of an acceptable
one. The runner: tools/audio-pipeline/soundlab_runner.py (SOUND_LAB_AUDIO_DIR = this folder, SOUND_LAB_MAX_POSTS=8 durable cap, flock
/tmp/ll-soundlab.lock held for the run).

Writes the planned clip queue (append-only) and PLAN.json to SOUND_LAB_AUDIO_DIR (the private raw archive:
reference/tasks/skyways-vehicle-20261107-054512/audio — never in Git). Seeds are deterministic (sha256 of the clip id). Durations are
WHOLE seconds. Prompts: `TrackType: SFX`, source, action, close mic, a DRY take (the game's convolver adds the room).

Python 3 standard library only. Usage: SOUND_LAB_AUDIO_DIR=<dir> python3 -I tools/audio-pipeline/skyways-car2-plan.py [--dry-run] [--batch B]
"""
from __future__ import annotations

import hashlib
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
AUDIO = Path(os.environ.get("SOUND_LAB_AUDIO_DIR") or ROOT / "reference/tasks/skyways-vehicle-20261107-054512/audio")
QUEUE = AUDIO / "queue.json"
PLAN_JSON = AUDIO / "PLAN.json"
TASK = "studio-beta-skyways-vehicle-20261107-054512-01"
STEPS, CFG = 8, 1.0  # upstream: rf_denoiser distilled for 8 steps; CFG 1 = guidance off (single pass)
DRY = "close mic, recorded dry with no echo or reverb, no words, no music, no background noise."
MAX_JOBS = 8


def seed_for(clip_id: str) -> int:
    return int(hashlib.sha256(f"terminal-state-skyways-car2-20261107:{clip_id}".encode()).hexdigest()[:8], 16) & 0x7FFFFFFF


# (id, cue, seconds, prompt). Order = priority.
BATCH_A: list[tuple[str, str, float, str]] = [
    ("car-engine-idle-02", "carIdle", 6.0,
     "TrackType: SFX, a sports car engine idling steadily with the car standing still, recorded outdoors with the microphone close to "
     "the exhaust tailpipe: a clear lumpy exhaust burble with distinct firing pulses, a raspy mid-range engine note and a light "
     "mechanical valve tick, constant rpm, steady and continuous, no revving, no start, no stop, " + DRY),
    ("car-engine-drive-02", "carDrive", 6.0,
     "TrackType: SFX, a sports car engine held at a steady high rpm under load, recorded with the microphone close to the engine and "
     "exhaust: a loud bright raspy engine howl with a strong exhaust rasp and intake roar, rich harmonics, constant pitch, steady and "
     "continuous, no gear changes, no tyre noise, " + DRY),
    ("car-engine-start-01", "carStart", 3.0,
     "TrackType: SFX, a sports car engine started with the key, microphone close to the engine: the electric starter motor whirrs and "
     "cranks for half a second, the engine catches with a loud bark and one short rev, then settles into a steady burbling idle, " + DRY),
    ("car-reverse-01", "carReverse", 4.0,
     "TrackType: SFX, a car rolling slowly backwards in reverse gear: the steady high-pitched whine of the gearbox in reverse over a "
     "soft low engine hum, constant speed, continuous, no beeping, no tyre squeal, " + DRY),
    ("car-brake-01", "carBrake", 2.0,
     "TrackType: SFX, a car braking to a stop on a smooth stone floor: a short sharp brake squeal and a soft tyre scrub, then the car "
     "body rocks on its springs with a dull suspension clunk, " + DRY),
]
# Batch B: replacements for structurally rejected batch-A takes only (filled after QC; total <= MAX_JOBS, enforced durably by the runner).
# QC of batch A (structural): idle-02 REJECTED — sub-bass again (centroid 58 Hz, 85 % roll-off 78 Hz, the 180-355 Hz octave -19 dB under
# the total; "exhaust burble / tailpipe" pulls the model to the same rumble as round 1). drive-02 / start-01 / reverse-01 / brake-01
# accepted (drive-02: mid-range, centroid ~300 Hz in its steadiest 2 s window; start-01's post-catch idle sits at ~300 Hz — the engine
# BAY wording works). So the idle is asked for at the engine block with mechanical mid-range detail and no exhaust / rumble words.
BATCH_B: list[tuple[str, str, float, str]] = [
    ("car-engine-idle-03", "carIdle", 6.0,
     "TrackType: SFX, a sports car engine running at a steady idle with the bonnet open, microphone close to the engine block: a busy "
     "mechanical idle with rattling ticking valves, a buzzy throbbing motor note and a faint belt whirr, constant rpm, steady and "
     "continuous, no revving, no start, no stop, " + DRY),
    # QC of idle-03 (structural): mid-range at last (centroid ~1.7 kHz, steady: 0.1 s level std ~1 dB) but little firing rhythm (10 Hz
    # envelope modulation, depth ~0.09) — accepted as the idle's audible layer, with idle-02's lumpy sub-bass (21 Hz firing pulses,
    # depth ~0.19) mixed under it as the body (skyways-car-build.mjs `mix`). drive-02 re-examined for its loop: NOT stationary — it
    # revs up and back down (0.25 s centroid 91 -> 395 -> 83 Hz; every 2.4 s window drifts ~0.6 octave, even 1 s windows 0.1-0.34 oct):
    # a loop of it would wobble in pitch every cycle. One steady take asked for, the pitch held explicitly.
    ("car-engine-drive-03", "carDrive", 6.0,
     "TrackType: SFX, a sports car engine revving at one constant high rpm while parked, the throttle held perfectly steady, "
     "microphone close to the engine bay: a loud bright raspy engine howl with a strong intake roar and rich harmonics, the same pitch "
     "from start to end, no rev up, no rev down, no gear changes, " + DRY),
    # QC of drive-03 (structural): REJECTED — a rev up and back down again despite the wording (YIN f0 62 -> 158 Hz over 1.0-1.8 s, then
    # 149 -> 41 Hz over 2.7-4.5 s; "revving" / "high rpm" pull the model to sweeps). What stayed steady in every take: "idling" /
    # "cruising at a constant speed" (drive-01 was steady, only its cabin wording made it sub-bass); what brought the mid-range: the
    # microphone at the engine bay + "loud bright raspy". The LAST job of the 8 combines the two; if it fails, drive-02's steadiest 1.2 s
    # window (1.35 s, centroid ~320 Hz, -0.1 octave drift) is the fallback loop.
    ("car-engine-drive-04", "carDrive", 6.0,
     "TrackType: SFX, a sports car cruising at a constant speed with the engine pulling steadily at medium-high rpm, microphone mounted "
     "close to the engine bay under the bonnet: a loud bright raspy engine note with intake roar and rich harmonics, constant speed, "
     "steady and continuous, no gear changes, no acceleration, no tyre noise, " + DRY),
]


def build(batches: list[str]) -> list[dict]:
    rows = BATCH_A + (BATCH_B if "B" in batches else [])
    out, seen = [], set()
    for cid, cue, seconds, prompt in rows:
        assert len(prompt) <= 600, (cid, len(prompt))
        assert float(seconds).is_integer() and 1.0 <= seconds <= 30.0, (cid, seconds)  # WHOLE seconds only
        assert cid not in seen, cid
        seen.add(cid)
        out.append({"id": cid, "cue": cue, "prompt": prompt, "negative_prompt": "", "seconds": seconds,
                    "steps": STEPS, "cfg": CFG, "seed": seed_for(cid)})
    assert len(out) <= MAX_JOBS
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
    batches = ["A"] + (["B"] if "--batch" in argv and argv[argv.index("--batch") + 1:][:1] == ["B"] else [])
    plan = build(batches)
    if "--dry-run" in argv:
        print(json.dumps({"clips": len(plan), "audioSeconds": sum(c["seconds"] for c in plan), "ids": [c["id"] for c in plan],
                          "promptChars": [len(c["prompt"]) for c in plan]}, indent=1))
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
        print(f"refusing: {len(merged)} clips exceed the {MAX_JOBS}-job allowance", file=sys.stderr)
        return 2
    if len(merged) == len(existing):
        print(f"queue unchanged ({len(existing)} clips)")
        return 0
    write_atomic(QUEUE, {
        "task": TASK, "lane": "AUDIO (prize car round 2: mid-range engine idle / drive loops, engine start, reverse whine, brake stop)",
        "endpoint": "http://10.0.0.59:7871",
        "contract": "tools/audio-pipeline/soundlab_runner.py (SOUND_LAB_AUDIO_DIR = this folder, SOUND_LAB_MAX_POSTS=8 durable cap, "
                    "flock /tmp/ll-soundlab.lock); POST /api/generate {prompt,negative_prompt,seconds,steps,cfg,seed} -> 202 {job}",
        "note": "Planned before any request. Entries are append-only; ids never rewritten. Whole-second durations only.",
        "clips": merged})
    write_atomic(PLAN_JSON, {
        "task": TASK, "authorization": "reference/tasks/skyways-rework-20261107-054512/USER-GENERATION-APPROVAL.json (sha256 "
        "c7856220a0416642f189f2843c9dcb2876491ab054c1981ae83a36c8cd154475; localSoundLabJobsMax 8, the Beta vehicle lane only, if "
        "reuse / the wiring fix is insufficient): the existing local Sound Lab, <= 8 jobs, stop at the first acceptable take per sound, "
        "close unused, structural QC only. Paid budget 0; no other provider; no new service / account / install / restart; no synthesis.",
        "maxJobs": MAX_JOBS, "batches": batches,
        "clips": [{"id": c["id"], "cue": c["cue"], "seconds": c["seconds"], "seed": c["seed"]} for c in merged],
        "listening": "worker cannot listen: structural QC only (band levels / centroid / envelope / loop seam); the user taste-tests in game"})
    print(f"queue: {len(existing)} -> {len(merged)} clips")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
