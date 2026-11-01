#!/usr/bin/env python3
"""Strainer squish set — Sound Lab generation plan (task studio-alpha-strainer-reach-squish-20261101-201110-01, lane AUDIO).

User (2026-11-01): "It needs unique 'squishy sounds' to really sell its swamp creature feel." The user authorized bounded LOCAL
Sound Lab generation for this, Strainer-only (the existing service http://10.0.0.59:7871 through tools/audio-pipeline/
soundlab_runner.py, SOUND_LAB_AUDIO_DIR, SOUND_LAB_MAX_POSTS durable cap, /tmp/ll-soundlab.lock held for the run; at most ~8
generation jobs; stop at the first acceptable takes). No other provider, no synthesis.

Writes the planned clip queue (append-only: existing ids are never rewritten) and PLAN.json to
  reference/tasks/strainer-reach-squish-20261101-201110/audio/        (private raw archive, never in Git)
Seeds are deterministic (sha256 of the clip id), so the plan is reproducible and every request is recorded before it is sent.

Durations are WHOLE seconds (known Sound Lab gotcha: 1.5 s / 2.5 s requests came back as broadband noise / drones); the
derivative builder (tools/audio-pipeline/strainer-build.mjs) trims / slices later. Prompts follow the upstream guide (source,
action + decay, mic + room, `TrackType: SFX`) and ask for DRY one-shots so the game adds its own room reverb.

  batch A (initial, 6 jobs): 2 footstep takes (10 s, sliced into step variants), 2 arm-swing takes (2 s), 2 claw-contact takes (2 s).
  Reserve: at most 2 further jobs, planned ONLY to replace a take that fails the structural gate (appended as batch B).

Python 3 standard library only. Usage: python3 -I tools/audio-pipeline/strainer-plan.py [--dry-run] [--batch B]
"""
from __future__ import annotations

import hashlib
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
AUDIO = Path(os.environ.get("SOUND_LAB_AUDIO_DIR") or ROOT / "reference/tasks/strainer-reach-squish-20261101-201110/audio")
QUEUE = AUDIO / "queue.json"
PLAN_JSON = AUDIO / "PLAN.json"
TASK = "studio-alpha-strainer-reach-squish-20261101-201110-01"
STEPS, CFG = 8, 1.0  # upstream: rf_denoiser distilled for 8 steps; CFG 1 = guidance off (single pass)
DRY = "close mic, recorded dry with no echo or reverb, no words, no music, no background noise."
MAX_JOBS = 8


def seed_for(clip_id: str) -> int:
    return int(hashlib.sha256(f"terminal-state-strainer-squish-20261101:{clip_id}".encode()).hexdigest()[:8], 16) & 0x7FFFFFFF


# (id, cue, seconds, prompt). Order = priority.
BATCH_A: list[tuple[str, str, float, str]] = [
    ("strainer-step-01", "strainerStep", 10.0,
     "TrackType: SFX, slow heavy wet footsteps of a huge swamp creature, bare slimy feet slapping down one at a time on a wet "
     "concrete floor, each step a deep sloppy squelch with a wet slap and a little dripping, distinct separate steps with pauses "
     "between them, " + DRY),
    ("strainer-step-02", "strainerStep", 10.0,
     "TrackType: SFX, a large waterlogged creature stomping slowly on webbed feet across a hard floor, each footfall a thick "
     "fleshy squish and a splat of slime, irregular separate steps with gaps between them, " + DRY),
    ("strainer-swing-01", "strainerSwing", 2.0,
     "TrackType: SFX, a long wet slimy arm swung hard through the air, a single heavy fleshy whoosh with slime and water flung "
     "off the limb, no impact, " + DRY),
    ("strainer-swing-02", "strainerSwing", 2.0,
     "TrackType: SFX, a dripping swamp monster swiping its long clawed arm through the air, one fast wet swoosh with a spray of "
     "water droplets, no hit, " + DRY),
    ("strainer-contact-01", "strainerContact", 2.0,
     "TrackType: SFX, a slimy clawed hand striking a person's body hard, a single heavy wet fleshy slap with a squelch and a "
     "splatter of slime, " + DRY),
    ("strainer-contact-02", "strainerContact", 2.0,
     "TrackType: SFX, a heavy wet blow from a swamp creature's claws hitting a man's chest, a meaty thwack with a sticky squelch, "
     + DRY),
]
# Batch B is filled in only after QC, to replace a structurally rejected take (same cue, adjusted prompt), never as a reroll of
# an acceptable one; total jobs stay <= MAX_JOBS (the runner's SOUND_LAB_MAX_POSTS enforces it durably).
#   2026-11-01 QC of batch A: strainer-swing-02 REJECTED as a swing — two separate clusters 1.1 s apart, 87 % of the energy in
#   300–1000 Hz with a rising ~500 -> 650 Hz pitch track (voiced 44 %): droplet "bloops" / a whistle, not a whoosh. Replacement:
#   the same cue with the "water droplets" / "monster" wording removed (one job; the other five takes passed).
BATCH_B: list[tuple[str, str, float, str]] = [
    ("strainer-swing-03", "strainerSwing", 2.0,
     "TrackType: SFX, a fast heavy swipe of a long wet fleshy arm through the air, a single short whoosh of air with a wet "
     "slimy flutter, no impact, " + DRY),
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
        print(json.dumps({"clips": len(plan), "audioSeconds": sum(c["seconds"] for c in plan), "ids": [c["id"] for c in plan]}, indent=1))
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
        "task": TASK, "lane": "AUDIO (Strainer squish set: wet footsteps, arm swing, claw contact)",
        "endpoint": "http://10.0.0.59:7871",
        "contract": "tools/audio-pipeline/soundlab_runner.py (SOUND_LAB_AUDIO_DIR = this folder, SOUND_LAB_MAX_POSTS durable cap, "
                    "flock /tmp/ll-soundlab.lock); POST /api/generate {prompt,negative_prompt,seconds,steps,cfg,seed} -> 202 {job}",
        "note": "Planned before any request. Entries are append-only; ids never rewritten. Whole-second durations only.",
        "clips": merged})
    write_atomic(PLAN_JSON, {
        "task": TASK, "authorization": "User 2026-11-01: bounded LOCAL Strainer-only Sound Lab generation (existing service; "
        "at most ~8 jobs; stop at the first acceptable takes). Paid budget 0; no other provider; no synthesis.",
        "maxJobs": MAX_JOBS, "batches": batches,
        "clips": [{"id": c["id"], "cue": c["cue"], "seconds": c["seconds"], "seed": c["seed"]} for c in merged],
        "listening": "worker cannot listen: structural QC only (envelope / onsets / spectrogram); the user taste-tests in game"})
    print(f"queue: {len(existing)} -> {len(merged)} clips")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
