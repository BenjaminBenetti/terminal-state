#!/usr/bin/env python3
"""Reactor machine set — Sound Lab generation plan (task studio-reactor-build-20261101-205236-01, primary = the sole asset producer).

Authority: the Reactor build brief allows the EXISTING local Sound Lab "only if needed: narrow reactor / generator ambience, under the
existing lock, bounded jobs, no new service / account / restart". Needed: the auxiliary generators are LOUD by design (their noise pulls
enemies — the player must hear why), the zone fans, the restart controls (breaker / valve / pump / fuse) and the core's startup + hum.
Nothing else: no music, no broad sound campaign. The existing service http://10.0.0.59:7871 through tools/audio-pipeline/
soundlab_runner.py (SOUND_LAB_AUDIO_DIR, SOUND_LAB_MAX_POSTS durable cap, /tmp/ll-soundlab.lock held for the run); at most 12 jobs
(9 planned + at most 3 replacements of structurally rejected takes); stop at the first acceptable take per cue.

Writes the planned clip queue (append-only: existing ids are never rewritten) and PLAN.json to
  reference/tasks/reactor-build-20261101-205236/audio/        (private raw archive, never in Git)
Seeds are deterministic (sha256 of the clip id). Durations are WHOLE seconds (known Sound Lab gotcha); the derivative builder trims /
loops later. Prompts follow the upstream guide (source, action + decay, mic + room, `TrackType: SFX`) and ask for DRY takes.

Python 3 standard library only. Usage: python3 -I tools/audio-pipeline/reactor-plan.py [--dry-run] [--batch B]
"""
from __future__ import annotations

import hashlib
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
AUDIO = Path(os.environ.get("SOUND_LAB_AUDIO_DIR") or ROOT / "reference/tasks/reactor-build-20261101-205236/audio")
QUEUE = AUDIO / "queue.json"
PLAN_JSON = AUDIO / "PLAN.json"
TASK = "studio-reactor-build-20261101-205236-01"
STEPS, CFG = 8, 1.0  # upstream: rf_denoiser distilled for 8 steps; CFG 1 = guidance off (single pass)
DRY = "recorded dry with no echo or reverb, no words, no music, no background noise."
MAX_JOBS = 12


def seed_for(clip_id: str) -> int:
    return int(hashlib.sha256(f"terminal-state-reactor-20261101:{clip_id}".encode()).hexdigest()[:8], 16) & 0x7FFFFFFF


# (id, cue, seconds, prompt). Order = priority.
BATCH_A: list[tuple[str, str, float, str]] = [
    ("reactor-gen-start-01", "reactorGeneratorStart", 6.0,
     "TrackType: SFX, a big old industrial diesel generator being started: the electric starter motor cranks and whirrs, the engine "
     "coughs and sputters a few times, then catches and roars to life and settles into a loud steady rumble, close mic, " + DRY),
    ("reactor-gen-loop-01", "reactorGeneratorLoop", 10.0,
     "TrackType: SFX, a loud big diesel generator engine running steadily at constant speed, continuous deep mechanical rumble and "
     "rattle, no changes in speed, close mic, " + DRY),
    ("reactor-fan-loop-01", "reactorFanLoop", 10.0,
     "TrackType: SFX, a huge industrial extraction fan spinning steadily inside a metal duct, a constant deep whooshing roar of moving "
     "air with a low motor hum, no changes, " + DRY),
    ("reactor-breaker-01", "reactorBreaker", 2.0,
     "TrackType: SFX, a heavy industrial main circuit breaker lever thrown closed, one big mechanical clunk with a deep electrical "
     "thump and a short buzz, close mic, " + DRY),
    ("reactor-fuse-01", "reactorFuse", 2.0,
     "TrackType: SFX, a heavy ceramic cartridge fuse pushed firmly into metal spring clips, one solid metallic click and scrape, "
     "close mic, " + DRY),
    ("reactor-valve-01", "reactorValve", 4.0,
     "TrackType: SFX, a large rusty valve handwheel turned slowly by hand, metal squeaking and grinding, then water starts rushing "
     "through big steel pipes, close mic, " + DRY),
    ("reactor-pump-01", "reactorPump", 6.0,
     "TrackType: SFX, a big industrial electric pump motor starting up, a rising electric whine, then a steady hum with water "
     "surging through large pipes, " + DRY),
    ("reactor-startup-01", "reactorStartup", 10.0,
     "TrackType: SFX, a gigantic industrial power plant machine powering up: heavy relays clacking, a deep low hum rising and "
     "swelling in pitch and loudness, turbines spinning up into a powerful steady drone, " + DRY),
    ("reactor-hum-01", "reactorHum", 10.0,
     "TrackType: SFX, the constant deep low electrical hum of a huge running power plant machine, a steady smooth drone with a faint "
     "mechanical throb, no changes, " + DRY),
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
        "task": TASK, "lane": "primary (Reactor machine set: generators, fans, restart controls, core startup / hum)",
        "endpoint": "http://10.0.0.59:7871",
        "contract": "tools/audio-pipeline/soundlab_runner.py (SOUND_LAB_AUDIO_DIR = this folder, SOUND_LAB_MAX_POSTS durable cap, "
                    "flock /tmp/ll-soundlab.lock); POST /api/generate {prompt,negative_prompt,seconds,steps,cfg,seed} -> 202 {job}",
        "note": "Planned before any request. Entries are append-only; ids never rewritten. Whole-second durations only.",
        "clips": merged})
    write_atomic(PLAN_JSON, {
        "task": TASK, "authorization": "Reactor build brief 2026-11-01: existing local Sound Lab only if needed, narrow reactor / generator "
        "ambience, under the lock, bounded (<= 12 jobs; stop at the first acceptable take per cue). Paid budget 0; no other provider; no synthesis.",
        "maxJobs": MAX_JOBS, "batches": batches,
        "clips": [{"id": c["id"], "cue": c["cue"], "seconds": c["seconds"], "seed": c["seed"]} for c in merged],
        "listening": "worker cannot listen: structural QC only (envelope / onsets / spectrogram); the user taste-tests in game"})
    print(f"queue: {len(existing)} -> {len(merged)} clips")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
