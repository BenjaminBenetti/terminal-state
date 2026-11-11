#!/usr/bin/env python3
"""Train CHIPPER set — Sound Lab generation plan (task studio-corpse-chipper-fuel-20261110-235304-01, lane AUDIO).

The electric woodchipper fixed inside the player's train: the player feeds it dead bodies one at a time and it grinds each for about
20 s (game/src/audio/chipperAudio.ts). It needs an electric motor running (a seamless loop), the motor's spin-up, a heavy wet body
dropping onto its steel hopper, the wet grinding of flesh and bone (a loop layered over the motor) and the wind-down.

Reuse first (game/src/audio/bank.ts): the Reactor / Bunker machine cues are a DIESEL generator (start + running loop), an extraction
fan's air roar, a geared control-rod servo with ratchet clicks, a small beacon motor with gear ticks and an electric pump whose
spin-up carries water surging through pipes; none is a belt-driven electric chipper motor, its spin-up or its coast-down. The body
impact (bodyFall) is a dry thud on concrete, impactSheetMetal a bullet ping, chunkFlesh a small chunk landing: no heavy wet body on
thick steel. Nothing in the bank grinds wet flesh and bone. So five cues are generated, ONE take each; a structurally rejected take is
replaced through batch B (same cue, adjusted prompt), never rerolled when acceptable.

Authority: the task's local audio authority (12 local Stable Audio 3 Small-SFX jobs TOTAL including retries, one counter for the
whole task, only the chipper motor / spin-up / feed / grind / stop cues; the existing service through the proven runner + lock;
structural QC only, nothing is listened to; no paid or other provider, no new service / restart; unused jobs are closed). The runner:
tools/audio-pipeline/soundlab_runner.py (SOUND_LAB_AUDIO_DIR = the task's private audio folder, SOUND_LAB_MAX_POSTS=12 durable cap,
flock /tmp/ll-soundlab.lock held for the run).

The prompt TEXT stays private: it is read from PROMPTS.json in SOUND_LAB_AUDIO_DIR (the private raw archive, never in Git); this
file holds the ids, cues, whole-second durations and deterministic seeds (sha256 of the clip id). Writes the planned queue
(append-only: existing ids are never rewritten) and PLAN.json to SOUND_LAB_AUDIO_DIR. Prompts: `TrackType: SFX`, source, action +
decay, close mic, a DRY take (the game's convolver adds the room).

Python 3 standard library only. Usage: SOUND_LAB_AUDIO_DIR=<dir> python3 -I tools/audio-pipeline/chipper-plan.py [--dry-run] [--batch B]
"""
from __future__ import annotations

import hashlib
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
AUDIO = Path(os.environ.get("SOUND_LAB_AUDIO_DIR") or ROOT / "reference/tasks/corpse-chipper-fuel-20261110-235304/audio")
QUEUE = AUDIO / "queue.json"
PLAN_JSON = AUDIO / "PLAN.json"
PROMPTS = AUDIO / "PROMPTS.json"
TASK = "studio-corpse-chipper-fuel-20261110-235304-01"
STEPS, CFG = 8, 1.0  # upstream: rf_denoiser distilled for 8 steps; CFG 1 = guidance off (single pass)
MAX_JOBS = 12


def seed_for(clip_id: str) -> int:
    return int(hashlib.sha256(f"terminal-state-train-chipper-20261111:{clip_id}".encode()).hexdigest()[:8], 16) & 0x7FFFFFFF


# (id, cue, seconds). Order = priority. The prompt for each id is PROMPTS.json[id] (private).
BATCH_A: list[tuple[str, str, float]] = [
    ("chipper-motor-loop-01", "chipperMotor", 10.0),   # the motor + belt + empty rotor running: the steadiest window becomes the loop
    ("chipper-grind-loop-01", "chipperGrind", 10.0),   # the rotor chewing flesh and bone, wet slurry: a loop over the motor
    ("chipper-feed-01", "chipperFeed", 3.0),           # a heavy wet body onto the steel hopper (one-shot)
    ("chipper-start-01", "chipperStart", 5.0),         # switch clunk + spin-up into the running hum (one-shot, hands over to the loop)
    ("chipper-stop-01", "chipperStop", 6.0),           # switch clunk + coast-down to silence (one-shot)
]
# Batch B is filled in only after QC, to replace a structurally rejected take (same cue, adjusted prompt), never as a reroll of an
# acceptable one; total jobs stay <= MAX_JOBS (the runner's SOUND_LAB_MAX_POSTS enforces it durably).
BATCH_B: list[tuple[str, str, float]] = []


def build(batches: list[str], prompts: dict[str, str]) -> list[dict]:
    rows = BATCH_A + (BATCH_B if "B" in batches else [])
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
    if not PROMPTS.exists():
        print(f"missing {PROMPTS} (the private prompt file)", file=sys.stderr)
        return 2
    prompts = json.loads(PROMPTS.read_text(encoding="utf-8"))
    plan = build(batches, prompts)
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
        "task": TASK, "lane": "AUDIO (train chipper: motor loop, grind loop, body feed, spin-up, wind-down)",
        "endpoint": "http://10.0.0.59:7871",
        "contract": "tools/audio-pipeline/soundlab_runner.py (SOUND_LAB_AUDIO_DIR = this folder, SOUND_LAB_MAX_POSTS=12 durable cap, "
                    "flock /tmp/ll-soundlab.lock); POST /api/generate {prompt,negative_prompt,seconds,steps,cfg,seed} -> 202 {job}",
        "note": "Planned before any request. Entries are append-only; ids never rewritten. Whole-second durations only.",
        "clips": merged})
    write_atomic(PLAN_JSON, {
        "task": TASK, "authorization": "the task's local audio authority: 12 local Stable Audio 3 Small-SFX jobs TOTAL including retries, "
        "one counter for the task, only the chipper motor / spin-up / feed / grind / stop cues, the existing service through the proven "
        "runner + lock, first acceptable take per cue, structural QC only. Paid budget 0; no other provider; no new service / account / "
        "install / restart; no synthesis. Unused jobs are closed.",
        "reuseCheck": "no bank cue is a belt-driven electric chipper motor, its spin-up or coast-down (diesel generator, fan air, servo "
        "ratchet, beacon motor, pump with water); bodyFall is a dry thud on concrete; nothing grinds wet flesh and bone",
        "maxJobs": MAX_JOBS, "batches": batches,
        "clips": [{"id": c["id"], "cue": c["cue"], "seconds": c["seconds"], "seed": c["seed"]} for c in merged],
        "listening": "worker cannot listen: structural QC only (envelope / quiet fraction / spectrum / clipping / loop seam); the user taste-tests in game"})
    print(f"queue: {len(existing)} -> {len(merged)} clips")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
