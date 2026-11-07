#!/usr/bin/env python3
"""HEAD-HIT feedback — Sound Lab generation plan (task studio-general-armor-20261107-231448-01).

User: "lets have a different impact sound when you hit the zombies head ... This will give better feedback when you hit the weak spot."
Every confirmed enemy hit already plays the impactFlesh confirm ("a short wet meaty thwack"); the bank has no skull / bone hit: impactWood is
a splintering crate crack with falling splinters, hitTick (already on every hit) a tiny plastic tick, hitKill the KILL thump. So ONE new
cue is generated: a sharp bony skull crack, layered over the flesh confirm only on a confirmed head hit (game/src/audio/sfx.ts headHit).

Authority: the task's brief (up to 4 local Stable Audio 3 Small-SFX jobs ONLY for the head-hit sound if existing clips are inadequate;
first acceptable set, not a spending target; the existing service through the proven runner + lock; structural QC only, no paid fallback,
no new service / restart). Two jobs queued (two takes of the one cue); the rest of the allowance stays unused unless QC rejects a take.

Writes the planned queue (append-only) and PLAN.json to SOUND_LAB_AUDIO_DIR (the private raw archive:
reference/tasks/skywalk-and-general-feedback-20261107-231448/general/audio — never in Git). Seeds deterministic. WHOLE seconds only.

Python 3 standard library only. Usage: SOUND_LAB_AUDIO_DIR=<dir> python3 -I tools/audio-pipeline/headhit-plan.py [--dry-run] [--batch B]
"""
from __future__ import annotations

import hashlib
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
AUDIO = Path(os.environ.get("SOUND_LAB_AUDIO_DIR") or ROOT / "reference/tasks/skywalk-and-general-feedback-20261107-231448/general/audio")
QUEUE = AUDIO / "queue.json"
PLAN_JSON = AUDIO / "PLAN.json"
TASK = "studio-general-armor-20261107-231448-01"
STEPS, CFG = 8, 1.0  # upstream: rf_denoiser distilled for 8 steps; CFG 1 = guidance off (single pass)
DRY = "close mic, recorded dry with no echo or reverb, no words, no music, no background noise."
MAX_JOBS = 4


def seed_for(clip_id: str) -> int:
    return int(hashlib.sha256(f"terminal-state-head-hit-20261107:{clip_id}".encode()).hexdigest()[:8], 16) & 0x7FFFFFFF


# (id, cue, seconds, prompt). Order = priority.
HEAD = ("TrackType: SFX, a bullet striking a human skull at close range: one sharp hard bony crack with a short wet crunch of bone, a "
        "single hit with a fast decay, no splinters, no metal, " )
BATCH_A: list[tuple[str, str, float, str]] = [
    ("head-hit-01", "headHit", 2.0, HEAD + DRY),
    ("head-hit-02", "headHit", 2.0, HEAD + DRY),
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
        "task": TASK, "lane": "GENERAL (head-hit skull crack: two takes of one cue)",
        "endpoint": "http://10.0.0.59:7871",
        "contract": "tools/audio-pipeline/soundlab_runner.py (SOUND_LAB_AUDIO_DIR = this folder, SOUND_LAB_MAX_POSTS=4 durable cap, "
                    "flock /tmp/ll-soundlab.lock); POST /api/generate {prompt,negative_prompt,seconds,steps,cfg,seed} -> 202 {job}",
        "note": "Planned before any request. Entries are append-only; ids never rewritten. Whole-second durations only.",
        "clips": merged})
    write_atomic(PLAN_JSON, {
        "task": TASK, "authorization": "the task brief: up to 4 local Stable Audio 3 Small-SFX jobs ONLY for the head-hit sound (existing "
        "clips inadequate: no skull / bone hit in the bank), first acceptable set, structural QC only. Paid budget 0; no other provider; no "
        "new service / account / install / restart; no synthesis.",
        "maxJobs": MAX_JOBS, "batches": batches,
        "clips": [{"id": c["id"], "cue": c["cue"], "seconds": c["seconds"], "seed": c["seed"]} for c in merged],
        "listening": "worker cannot listen: structural QC only (envelope / quiet fraction / spectral centroid); the user taste-tests in game"})
    print(f"queue: {len(existing)} -> {len(merged)} clips")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
