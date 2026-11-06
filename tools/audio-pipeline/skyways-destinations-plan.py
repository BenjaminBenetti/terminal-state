#!/usr/bin/env python3
"""SKYWAYS DESTINATIONS set — Sound Lab generation plan (task studio-skyways-destinations-20261106-170011-01, lead).

The destinations' landmark courts and anchor shops need a few location sounds the bank lacks (it has machine beds, doors, impacts, but no
clock, no arcade attract mode, no projector): the Clock Court's tower tick and its chime, the arcade's attract-mode bleeps, the cinema
projector's whirr. Everything else reuses the bank.

Authority: the task's USER-GENERATION-APPROVAL.json (localSoundLabMaxJobs 8: the EXISTING local Stable Audio 3 small SFX Sound Lab through
the proven runner + lock, reuse first, stop at the first acceptable take, structural QC only, no paid fallback or new service). This plan
uses at most 4 of the 8. The runner: tools/audio-pipeline/soundlab_runner.py (SOUND_LAB_AUDIO_DIR = this folder, SOUND_LAB_MAX_POSTS=4
durable cap, flock /tmp/ll-soundlab.lock held for the run).

Writes the planned clip queue (append-only) and PLAN.json to SOUND_LAB_AUDIO_DIR (the private raw archive:
reference/tasks/skyways-destinations-20261106-170011/audio — never in Git). Seeds are deterministic (sha256 of the clip id). Durations are
WHOLE seconds. Prompts: `TrackType: SFX`, source, action, close mic, a DRY take (the game's convolver adds the room).

Python 3 standard library only. Usage: SOUND_LAB_AUDIO_DIR=<dir> python3 -I tools/audio-pipeline/skyways-destinations-plan.py [--dry-run] [--batch B]
"""
from __future__ import annotations

import hashlib
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
AUDIO = Path(os.environ.get("SOUND_LAB_AUDIO_DIR") or ROOT / "reference/tasks/skyways-destinations-20261106-170011/audio")
QUEUE = AUDIO / "queue.json"
PLAN_JSON = AUDIO / "PLAN.json"
TASK = "studio-skyways-destinations-20261106-170011-01"
STEPS, CFG = 8, 1.0  # upstream: rf_denoiser distilled for 8 steps; CFG 1 = guidance off (single pass)
DRY = "close mic, recorded dry with no echo or reverb, no words, no music, no background noise."
MAX_JOBS = 4


def seed_for(clip_id: str) -> int:
    return int(hashlib.sha256(f"terminal-state-skyways-destinations-20261106:{clip_id}".encode()).hexdigest()[:8], 16) & 0x7FFFFFFF


# (id, cue, seconds, prompt). Order = priority.
BATCH_A: list[tuple[str, str, float, str]] = [
    ("clock-tick-01", "clockTick", 4.0,
     "TrackType: SFX, a large old mechanical tower clock movement ticking steadily: slow heavy regular brass escapement ticks with a "
     "faint gear rumble, constant tempo, continuous, " + DRY),
    ("clock-chime-01", "clockChime", 6.0,
     "TrackType: SFX, a large public clock bell striking three slow deep bronze tolls, each ringing out and decaying, " + DRY),
    ("arcade-attract-01", "arcadeAttract", 4.0,
     "TrackType: SFX, old video arcade cabinets in attract mode: soft electronic bleeps, blips and synth jingles from several machines "
     "at once, steady and continuous, no voices, " + DRY),
    ("projector-run-01", "projectorRun", 4.0,
     "TrackType: SFX, a vintage 35 mm film projector running: a steady mechanical clatter of the film gate and a whirring motor, "
     "constant and continuous, " + DRY),
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
        "task": TASK, "lane": "lead (destinations: clock tick loop, clock chime, arcade attract loop, projector loop)",
        "endpoint": "http://10.0.0.59:7871",
        "contract": "tools/audio-pipeline/soundlab_runner.py (SOUND_LAB_AUDIO_DIR = this folder, SOUND_LAB_MAX_POSTS=4 durable cap, "
                    "flock /tmp/ll-soundlab.lock); POST /api/generate {prompt,negative_prompt,seconds,steps,cfg,seed} -> 202 {job}",
        "note": "Planned before any request. Entries are append-only; ids never rewritten. Whole-second durations only.",
        "clips": merged})
    write_atomic(PLAN_JSON, {
        "task": TASK, "authorization": "USER-GENERATION-APPROVAL.json (localSoundLabMaxJobs 8; this plan <= 4): the existing local Sound Lab, reuse first, "
        "<= 4 jobs here, stop at the first acceptable take per sound, structural QC only. Paid budget 0; no other provider; no "
        "new service / account / install / restart; no synthesis.",
        "maxJobs": MAX_JOBS, "batches": batches,
        "clips": [{"id": c["id"], "cue": c["cue"], "seconds": c["seconds"], "seed": c["seed"]} for c in merged],
        "listening": "worker cannot listen: structural QC only (envelope / quiet fraction / spectral centroid); the user taste-tests in game"})
    print(f"queue: {len(existing)} -> {len(merged)} clips")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
