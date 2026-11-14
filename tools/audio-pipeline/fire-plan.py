#!/usr/bin/env python3
"""FLAMETHROWER + FIRE set — Sound Lab generation plan (task studio-flamethrower-fire-20261114-031614-01, lane AUDIO).

The flamethrower is a held stream weapon: its jet lights with a whoomp, roars while the trigger is held and cuts off; the fire it leaves
clings to surfaces and props, burning props collapse (game/src/audio/flameAudio.ts implements fire/sound.ts FlameSound over Sfx). Cues
(runtime ids): flameIgnite (the fuel jet lighting: a one-shot at the muzzle), flameRoar (the running jet: a seamless loop that follows
the muzzle), flameOut (the jet cutting off: a short falling whoosh and hot-metal ticks), fireBurn (an open fire on debris: the seamless
bed loop of burning patches and burning props), fireCatch (something catching fire: a soft whoomp), fireCollapse (a burnt object
crumbling in a shower of embers).

Reuse first (game/src/audio/bank.ts): the tank refill is the existing jerrycan pour (fuelPour, 2.58 s for a 2.6 s pour), the dry
trigger the existing dry click (dryFire). The only fire in the bank is the road flare (flareIgnite: a striker scrape + a chemical
hiss; flareBurn: a sputtering 3.5 s hiss loop; flareOut: a dying fizz): a small pyrotechnic hiss, not a pressurised fuel jet and not
an open wood fire, and nothing in the bank whoomps alight or crumbles in embers. So the six cues are generated; the flare clips stay
the documented fallback if a cue cannot be had structurally.

Authority: the task's audio authorization (the user allowed the FREE LOCAL Sound Lab inside this task as useful, without numerical
permission caps: the normal serialized local pipeline, private WAV masters, licence / provenance kept; no other generation service of
any kind). The runner: tools/audio-pipeline/soundlab_runner.py (SOUND_LAB_AUDIO_DIR = the task's private audio folder,
SOUND_LAB_MAX_POSTS = the durable cap of each bounded run, flock /tmp/ll-soundlab.lock held for the run). MAX_JOBS below is this
lane's own ceiling, not a permission.

The prompt TEXT stays private: it is read from PROMPTS.json in SOUND_LAB_AUDIO_DIR (the private raw archive, never in Git); this
file holds the ids, cues, whole-second durations and deterministic seeds (sha256 of the clip id). Writes the planned queue
(append-only: existing ids are never rewritten) and PLAN.json to SOUND_LAB_AUDIO_DIR. Durations are WHOLE seconds (fractional
requests have come back as broadband noise); the derivative builder (tools/audio-pipeline/fire-build.mjs) trims / loops later.
Prompts: `TrackType: SFX`, source, action + decay, close mic, a DRY take (the game's convolver adds the room).

Batches are appended only after the structural QC of the earlier one (the worker cannot listen): a replacement of a structurally
rejected take (the same cue, an adjusted wording) or a further take of an accepted request (the same prompt, a new seed) — never a
reroll of an acceptable one.

Python 3 standard library only. Usage: SOUND_LAB_AUDIO_DIR=<dir> python3 -I tools/audio-pipeline/fire-plan.py [--dry-run] [--through A|B|...]
"""
from __future__ import annotations

import hashlib
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
AUDIO = Path(os.environ.get("SOUND_LAB_AUDIO_DIR") or ROOT / "reference/tasks/flamethrower-fire-20261114-031614/audio")
QUEUE = AUDIO / "queue.json"
PLAN_JSON = AUDIO / "PLAN.json"
PROMPTS = AUDIO / "PROMPTS.json"
TASK = "studio-flamethrower-fire-20261114-031614-01"
STEPS, CFG = 8, 1.0  # upstream: rf_denoiser distilled for 8 steps; CFG 1 = guidance off (single pass) - as every earlier plan
MAX_JOBS = 24


def seed_for(clip_id: str) -> int:
    return int(hashlib.sha256(f"terminal-state-flamethrower-fire-20261114:{clip_id}".encode()).hexdigest()[:8], 16) & 0x7FFFFFFF


# (id, cue, seconds). Order = priority. The prompt for each id is PROMPTS.json[id] (private).
BATCHES: dict[str, list[tuple[str, str, float]]] = {
    # A: a first reading of every cue — two wordings each for the two loops (the better one structurally becomes the loop).
    "A": [
        ("fire-flame-roar-01", "flameRoar", 12.0),     # the running jet: the steadiest window becomes the loop
        ("fire-flame-roar-02", "flameRoar", 12.0),     # a second wording of the jet
        ("fire-burn-01", "fireBurn", 12.0),            # an open fire on debris, crackles and pops: the bed loop
        ("fire-burn-02", "fireBurn", 12.0),            # a second wording of the open fire
        ("fire-flame-ignite-01", "flameIgnite", 2.0),  # valve hiss + whoomp into the roar (one-shot; the loop takes over)
        ("fire-flame-out-01", "flameOut", 3.0),        # the jet cutting off, a falling whoosh, hot-metal ticks (one-shot)
        ("fire-catch-01", "fireCatch", 2.0),           # something catching fire: a soft whoomp (one-shot)
        ("fire-collapse-01", "fireCollapse", 4.0),     # a burnt object crumbling in embers, a crackling settle (one-shot)
    ],
    # Structural QC of batch A (private QC.json / qc/*.png, the spectrograms viewed; NOT listened to):
    #  - flame-roar-01 / 02: both steady (0.5 s blocks within 0.3-0.4 dB over the loop window, 50 ms spread about 1 dB) continuous
    #    broadband roars, but DARK: 88-90 % of the energy under 300 Hz, the octaves fall about 8 dB each above 250 Hz, the band above
    #    1 kHz is 20-22 dB under the whole — a deep rumble with almost no rushing hiss. New wordings ask for the bright jet.
    #  - burn-01: six separate 1.0-2.6 s surges that fall to silence between them (0.5 s blocks from -25 to -51 dB): no steady bed.
    #    burn-02: a steady low flutter (0.5 s blocks within 0.8 dB) with 12-14 broadband crackle transients a second: the bed.
    #  - flame-ignite-01: silent to 0.09 s, a rise to its loudest 50 ms at 0.2 s (99 % under 300 Hz there: the whoomp), a roaring
    #    plateau 5-10 dB lower to 0.95 s, gone by 1.2 s. catch-01: one 0.6 s swell (loudest at 0.4 s, within 5 dB for 0.2 s), a 0.25 s
    #    flutter 15 dB lower, silence from 0.82 s.
    #  - flame-out-01: 1.45 s of roaring, a 0.5 s louder part, then a smooth 0.8 s fall to silence at 2.8 s; no tick transients after it.
    #  - collapse-01: fifteen sharp broadband snaps over 2.7 s (centroid 2.5 kHz, 20 % of the energy under 300 Hz), one mid-heavy
    #    crunch at 1.47 s: a crumbling crackle with little weight.
    # B: new wordings for the roar (a bright jet), the cut-off (ticks after the fall) and the collapse (weight), and a second take of
    # the two accepted one-shot requests heard most often (the same prompt, a new seed: a variant, not a reroll).
    "B": [
        ("fire-flame-roar-03", "flameRoar", 12.0),
        ("fire-flame-roar-04", "flameRoar", 12.0),
        ("fire-flame-out-02", "flameOut", 3.0),
        ("fire-collapse-02", "fireCollapse", 4.0),
        ("fire-flame-ignite-02", "flameIgnite", 2.0),
        ("fire-catch-02", "fireCatch", 2.0),
    ],
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
        "task": TASK, "lane": "AUDIO (flamethrower + fire: ignite, roar loop, cut-off, fire bed loop, catch, collapse)",
        "endpoint": "http://10.0.0.59:7871",
        "contract": "tools/audio-pipeline/soundlab_runner.py (SOUND_LAB_AUDIO_DIR = this folder, SOUND_LAB_MAX_POSTS = each bounded run's "
                    "durable cap, flock /tmp/ll-soundlab.lock); POST /api/generate {prompt,negative_prompt,seconds,steps,cfg,seed} -> 202 {job}",
        "note": "Planned before any request. Entries are append-only; ids never rewritten. Whole-second durations only.",
        "clips": merged})
    write_atomic(PLAN_JSON, {
        "task": TASK, "authorization": "the task's audio authorization: the existing FREE LOCAL Sound Lab inside this task as useful, "
        "without numerical permission caps; the normal serialized local pipeline (the proven runner + lock, bounded batches), private WAV "
        "masters, licence / provenance kept. Paid / external 0; no other provider; no new service / account / install / restart; no synthesis.",
        "reuseCheck": "the tank refill reuses fuelPour and the dry trigger dryFire; the only fire in the bank is the road flare (a striker "
        "scrape, a sputtering chemical hiss, a dying fizz): no pressurised fuel jet, no open wood fire, no whoomp, no ember collapse",
        "laneCeiling": MAX_JOBS, "through": through,
        "clips": [{"id": c["id"], "cue": c["cue"], "seconds": c["seconds"], "seed": c["seed"]} for c in merged],
        "listening": "NOT LISTENED TO: the worker cannot listen. Structural QC only (envelope / level spread / crackle bursts / quiet "
        "fraction / attack / decay / spectrum / band shares / peak / DC / loudness / loop seam, spectrogram images viewed); the user hears it in game"})
    print(f"queue: {len(existing)} -> {len(merged)} clips")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
