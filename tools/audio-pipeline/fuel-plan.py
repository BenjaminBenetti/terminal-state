#!/usr/bin/env python3
"""Train FUEL set — Sound Lab generation plan (task studio-beta-train-fuel-system-20261106-024923-01, lane PORT).

The fuel system needs an engine that refuses to start for want of fuel (a departure refused at the console), a jerrycan pouring into
the train's filler neck, and a loaded hand-truck fuel cart rolling on a platform. The existing bank has no crank-and-die take (the
Reactor generator start is a flat -20 dB crank-to-roar with no stall in it), no liquid pour and no wheel-rolling loop, so these three
are generated; the hose nozzle click reuses existing clicks (game/src/audio/sfx.ts hoseConnect).

Authority: the task's GENERATION-POLICY.json (localSoundLabMaxJobs 6: the EXISTING local Stable Audio 3 small SFX Sound Lab through the
proven runner + lock, reuse first, <= 6 jobs TOTAL for the task, stop at the first acceptable take, structural QC only, no paid fallback
or new service). The runner: tools/audio-pipeline/soundlab_runner.py (SOUND_LAB_AUDIO_DIR = this folder, SOUND_LAB_MAX_POSTS=6 durable
cap, flock /tmp/ll-soundlab.lock held for the run).

Writes the planned clip queue (append-only: existing ids are never rewritten) and PLAN.json to SOUND_LAB_AUDIO_DIR (the private raw
archive: reference/tasks/train-fuel-system-20261106-024923/audio — never in Git). Seeds are deterministic (sha256 of the clip id).
Durations are WHOLE seconds (fractional seconds came back as broadband noise). Prompts: `TrackType: SFX`, source, action + decay, close
mic, a DRY take (the game's convolver adds the room).

Python 3 standard library only. Usage: SOUND_LAB_AUDIO_DIR=<dir> python3 -I tools/audio-pipeline/fuel-plan.py [--dry-run] [--batch B]
"""
from __future__ import annotations

import hashlib
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
AUDIO = Path(os.environ.get("SOUND_LAB_AUDIO_DIR") or ROOT / "reference/tasks/train-fuel-system-20261106-024923/audio")
QUEUE = AUDIO / "queue.json"
PLAN_JSON = AUDIO / "PLAN.json"
TASK = "studio-beta-train-fuel-system-20261106-024923-01"
STEPS, CFG = 8, 1.0  # upstream: rf_denoiser distilled for 8 steps; CFG 1 = guidance off (single pass)
DRY = "close mic, recorded dry with no echo or reverb, no words, no music, no background noise."
MAX_JOBS = 6


def seed_for(clip_id: str) -> int:
    return int(hashlib.sha256(f"terminal-state-train-fuel-20261106:{clip_id}".encode()).hexdigest()[:8], 16) & 0x7FFFFFFF


# (id, cue, seconds, prompt). Order = priority.
BATCH_A: list[tuple[str, str, float, str]] = [
    ("fuel-engine-stall-01", "engineStall", 4.0,
     "TrackType: SFX, a big old diesel train engine that fails to start because it is out of fuel: the electric starter motor cranks "
     "and whines, the engine coughs and sputters weakly twice, then dies, the starter winds down and stops, ending in silence, " + DRY),
    ("fuel-pour-01", "fuelPour", 3.0,
     "TrackType: SFX, diesel fuel poured from a full steel jerrycan into a metal fuel tank filler neck: a steady heavy glugging liquid "
     "pour with gurgles and air bubbles through the spout, splashing into a hollow metal tank, then the flow stops with a few drips, " + DRY),
    ("fuel-cart-roll-01", "cartRoll", 6.0,
     "TrackType: SFX, a heavy steel hand truck carrying a metal fuel drum pushed at a steady walking pace across a concrete floor: "
     "hard rubber wheels rolling with a constant low rumble and small rattles of the metal frame, constant speed, no stopping, " + DRY),
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
        "task": TASK, "lane": "PORT (engine stall one-shot, fuel pour one-shot, fuel cart rolling loop)",
        "endpoint": "http://10.0.0.59:7871",
        "contract": "tools/audio-pipeline/soundlab_runner.py (SOUND_LAB_AUDIO_DIR = this folder, SOUND_LAB_MAX_POSTS=6 durable cap, "
                    "flock /tmp/ll-soundlab.lock); POST /api/generate {prompt,negative_prompt,seconds,steps,cfg,seed} -> 202 {job}",
        "note": "Planned before any request. Entries are append-only; ids never rewritten. Whole-second durations only.",
        "clips": merged})
    write_atomic(PLAN_JSON, {
        "task": TASK, "authorization": "GENERATION-POLICY.json (localSoundLabMaxJobs 6): the existing local Sound Lab, reuse first, <= 6 "
        "jobs TOTAL for the task, stop at the first acceptable take per sound, structural QC only. Paid budget 0; no other provider; no "
        "new service / account / install / restart; no synthesis.",
        "maxJobs": MAX_JOBS, "batches": batches,
        "clips": [{"id": c["id"], "cue": c["cue"], "seconds": c["seconds"], "seed": c["seed"]} for c in merged],
        "listening": "worker cannot listen: structural QC only (envelope / quiet fraction / spectral centroid); the user taste-tests in game"})
    print(f"queue: {len(existing)} -> {len(merged)} clips")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
