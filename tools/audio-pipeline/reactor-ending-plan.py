#!/usr/bin/env python3
"""Reactor ENDING set — Sound Lab generation plan (task studio-reactor-surface-ending-20261102-213051-01, lane AUDIO).

User (play test, Reactor 2): "the reactor needs to have a noise when the blue beam shoots out the top!" and, for the new surface
ending: "It should be raining!".

Authority: the task's approval (USER-GENERATION-APPROVAL.json localSoundLabMaxJobs 6) and the lane brief authorize lane AUDIO ONLY to
use the EXISTING local Sound Lab (http://10.0.0.59:7871) through tools/audio-pipeline/soundlab_runner.py for the blue-beam ignition
and the surface rain ambience: at most 6 jobs for the whole task (SOUND_LAB_MAX_POSTS=6, durable), /tmp/ll-soundlab.lock held for
the run, no new service / account / install / restart / provider, no paid API. Stop at the first acceptable take per sound; the
rest stay in reserve.

Writes the planned clip queue (append-only: existing ids are never rewritten) and PLAN.json to SOUND_LAB_AUDIO_DIR
  (the brief: reference/tasks/reactor-surface-ending-20261102-213051/audio/raw — private raw archive, never in Git).
Seeds are deterministic (sha256 of the clip id). Durations are WHOLE seconds (known Sound Lab gotcha: fractional seconds came back as
broadband noise); the derivative builder (reactor-ending-build.mjs) trims / loops later. Prompts follow the upstream guide (source,
action + decay, mic + room, `TrackType: SFX`); the ignition asks for a DRY take (the game's convolver adds the pit's space).

Python 3 standard library only. Usage: SOUND_LAB_AUDIO_DIR=<dir> python3 -I tools/audio-pipeline/reactor-ending-plan.py [--dry-run] [--batch B]
"""
from __future__ import annotations

import hashlib
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
AUDIO = Path(os.environ.get("SOUND_LAB_AUDIO_DIR") or ROOT / "reference/tasks/reactor-surface-ending-20261102-213051/audio/raw")
QUEUE = AUDIO / "queue.json"
PLAN_JSON = AUDIO / "PLAN.json"
TASK = "studio-reactor-surface-ending-20261102-213051-01"
STEPS, CFG = 8, 1.0  # upstream: rf_denoiser distilled for 8 steps; CFG 1 = guidance off (single pass)
DRY = "recorded dry with no echo or reverb, no words, no music, no background noise."
MAX_JOBS = 6


def seed_for(clip_id: str) -> int:
    return int(hashlib.sha256(f"terminal-state-reactor-ending-20261102:{clip_id}".encode()).hexdigest()[:8], 16) & 0x7FFFFFFF


# (id, cue, seconds, prompt). Order = priority.
BATCH_A: list[tuple[str, str, float, str]] = [
    ("reactor-beam-01", "reactorBeam", 5.0,
     "TrackType: SFX, a giant blue energy beam igniting and blasting straight up into the sky: one sharp deep electric impact boom "
     "with a bright crackling zap, then a powerful rising whoosh into a roaring electrical plasma column hum that slowly fades out, "
     "close mic, " + DRY),
    ("surface-rain-01", "bedRain", 10.0,
     "TrackType: SFX, ambience of steady heavy rain falling outdoors on an empty city street: a dense constant hiss of raindrops "
     "with soft pattering splashes on concrete, puddles and metal debris, constant intensity, no changes, no thunder, no wind, "
     "no traffic, no voices, no music."),
]
# Batch B is filled in only after QC, to replace a structurally rejected take (same cue, adjusted prompt), never as a reroll of an
# acceptable one; total jobs stay <= MAX_JOBS (the runner's SOUND_LAB_MAX_POSTS enforces it durably).
BATCH_B: list[tuple[str, str, float, str]] = []


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
        "task": TASK, "lane": "AUDIO (the blue-beam ignition one-shot, the surface rain ambience loop)",
        "endpoint": "http://10.0.0.59:7871",
        "contract": "tools/audio-pipeline/soundlab_runner.py (SOUND_LAB_AUDIO_DIR = this folder, SOUND_LAB_MAX_POSTS=6 durable cap, "
                    "flock /tmp/ll-soundlab.lock); POST /api/generate {prompt,negative_prompt,seconds,steps,cfg,seed} -> 202 {job}",
        "note": "Planned before any request. Entries are append-only; ids never rewritten. Whole-second durations only.",
        "clips": merged})
    write_atomic(PLAN_JSON, {
        "task": TASK, "authorization": "Task approval 2026-11-02 (localSoundLabMaxJobs 6) + the lane AUDIO brief: the existing local Sound "
        "Lab for the blue-beam ignition and the surface rain only, under the lock, <= 6 jobs TOTAL for the task (stop at the first "
        "acceptable take per sound, the rest in reserve). Paid budget 0; no other provider; no new service / account / install / "
        "restart; no synthesis.",
        "maxJobs": MAX_JOBS, "batches": batches,
        "clips": [{"id": c["id"], "cue": c["cue"], "seconds": c["seconds"], "seed": c["seed"]} for c in merged],
        "listening": "worker cannot listen: structural QC only (envelope / quiet fraction / spectral centroid / spectrogram); the user taste-tests in game"})
    print(f"queue: {len(existing)} -> {len(merged)} clips")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
