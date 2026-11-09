#!/usr/bin/env python3
"""MARKET BAR audio — Sound Lab generation plan (task studio-market-bar-20261108-225231-01, lane AUDIO).

User: "Subtle cash-register sound on buy/sell." "Background chatter; screams from fleeing survivors and angry grunts from attackers."
(+ the lane brief's optional retch for the player's throw-up.)

Reuse first (audio/bank.ts): the bank has no cash register (pickup = a backpack rustle, drawerOpen = a desk drawer, click = a flashlight
switch), no crowd / voices bed (every bed is machinery / wind / rain), no human panic scream (sirenScream is the Siren monster's wake
scream), no angry effort grunt (hurt = the PLAYER's own pain grunt: reusing it for hostile survivors would read as the player being hit)
and no retch (the coughs are smoke coughs). So six cues are generated, ONE take each: variants come from trimming a take into several
clips (processing), never from a job per variant.

Authority: the lane brief — up to 12 FRESH local Stable Audio 3 Small-SFX jobs for this task only (a ceiling, not a target: the first
acceptable set), the existing service through the proven runner (SOUND_LAB_MAX_POSTS=12 durable cap, /tmp/ll-soundlab.lock), whole
seconds only, structural QC only (nothing is listened to), no restart / other provider / retries beyond the allowance.

Writes the planned queue (append-only) and PLAN.json to SOUND_LAB_AUDIO_DIR (the private raw archive:
reference/tasks/market-bar-20261108-225231/audio — never in Git). Seeds deterministic. WHOLE seconds only.

Python 3 standard library only. Usage: SOUND_LAB_AUDIO_DIR=<dir> python3 -I tools/audio-pipeline/market-audio-plan.py [--dry-run] [--batch B]
"""
from __future__ import annotations

import hashlib
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
AUDIO = Path(os.environ.get("SOUND_LAB_AUDIO_DIR") or ROOT / "reference/tasks/market-bar-20261108-225231/audio")
QUEUE = AUDIO / "queue.json"
PLAN_JSON = AUDIO / "PLAN.json"
TASK = "studio-market-bar-20261108-225231-01"
STEPS, CFG = 8, 1.0  # upstream: rf_denoiser distilled for 8 steps; CFG 1 = guidance off (single pass)
DRY = "close mic, recorded dry with no echo or reverb, no music, no background noise."
MAX_JOBS = 12


def seed_for(clip_id: str) -> int:
    return int(hashlib.sha256(f"terminal-state-market-bar-20261108:{clip_id}".encode()).hexdigest()[:8], 16) & 0x7FFFFFFF


# (id, cue, seconds, prompt). Order = priority.
BATCH_A: list[tuple[str, str, float, str]] = [
    ("market-cash-01", "marketCash", 3.0,
     "TrackType: SFX, an old mechanical cash register on a shop counter: two quick key clacks, one small bright bell ding and the cash "
     "drawer sliding open with a soft metal clunk, then silence, no words, " + DRY),
    ("market-chatter-01", "marketChatter", 12.0,
     "TrackType: SFX, ambience of a busy indoor market hall: a steady low murmur of many adult voices talking at once, a soft wordless "
     "crowd walla with no clear words, quiet footsteps and movement, constant level, no shouting, no laughter, no announcements, no music."),
    ("market-chatter-bar-01", "marketBarChatter", 12.0,
     "TrackType: SFX, ambience of a crowded small bar room: a steady low murmur of adult voices chatting at tables, a soft wordless walla "
     "with no clear words, an occasional quiet clink of glass bottles, constant level, no shouting, no television, no music."),
    ("market-scream-01", "marketScream", 8.0,
     "TrackType: SFX, frightened adults screaming in panic while running away: four separate short terrified screams from different men "
     "and women, each scream followed by a moment of silence, no words, " + DRY),
    ("market-grunt-01", "marketGrunt", 6.0,
     "TrackType: SFX, an angry man in a fight: five separate short aggressive grunts and growls of effort and rage, each followed by a "
     "short pause, no words, " + DRY),
    ("market-retch-01", "marketRetch", 3.0,
     "TrackType: SFX, a man retching and throwing up: one strained gagging heave and a wet splash of vomit, no words, " + DRY),
]
# Batch B is filled in only after QC, to replace a structurally rejected take (same cue, adjusted prompt) or to add a second take where
# trimming the first gave too few variants — never a reroll of an acceptable one; total jobs stay <= MAX_JOBS (the runner's
# SOUND_LAB_MAX_POSTS enforces it durably).
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
        print(f"refusing: {len(merged)} clips exceed the {MAX_JOBS}-job allowance", file=sys.stderr)
        return 2
    if len(merged) == len(existing):
        print(f"queue unchanged ({len(existing)} clips)")
        return 0
    write_atomic(QUEUE, {
        "task": TASK, "lane": "AUDIO (market bar: cash register, crowd murmur x2, panic screams, angry grunts, retch)",
        "endpoint": "http://10.0.0.59:7871",
        "contract": "tools/audio-pipeline/soundlab_runner.py (SOUND_LAB_AUDIO_DIR = this folder, SOUND_LAB_MAX_POSTS=12 durable cap, "
                    "flock /tmp/ll-soundlab.lock); POST /api/generate {prompt,negative_prompt,seconds,steps,cfg,seed} -> 202 {job}",
        "note": "Planned before any request. Entries are append-only; ids never rewritten. Whole-second durations only.",
        "clips": merged})
    write_atomic(PLAN_JSON, {
        "task": TASK, "authorization": "the lane brief: up to 12 FRESH local Stable Audio 3 Small-SFX jobs for this task only (a ceiling, "
        "not a target; first acceptable set), the existing service through the proven runner + lock, whole seconds, structural QC only. "
        "Paid budget 0; no other provider; no new service / account / install / restart; no synthesis. Old allowances are closed.",
        "reuseCheck": "no existing bank cue fits: no register, no voices bed, no human panic scream, no effort grunt (hurt = the player's), no retch",
        "maxJobs": MAX_JOBS, "batches": batches,
        "clips": [{"id": c["id"], "cue": c["cue"], "seconds": c["seconds"], "seed": c["seed"]} for c in merged],
        "listening": "worker cannot listen: structural QC only (envelope / quiet fraction / spectrogram / clipping / loudness); the user taste-tests in game"})
    print(f"queue: {len(existing)} -> {len(merged)} clips")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
