#!/usr/bin/env python3
"""Iteration 05 Sound Lab generation plan (Lane S, task studio-slice-iteration05-20261026-01).

Writes the planned clip queue to
  reference/tasks/vertical-slice-iteration05-20261026/audio/queue.json
without ever overwriting an existing entry: an existing queue may only be extended
with NEW ids (rerunning with the same plan is a no-op). Seeds are deterministic
(sha256 of the clip id), so the plan is reproducible and every request is
recorded before it is sent.

Prompts follow the upstream guide (source, action + decay, mic + room, `TrackType: SFX`)
and ask for DRY one-shots so the game adds its own room reverb. Multi-event clips
(footsteps, casings, drips, heartbeat, breaths, shell inserts) are sliced into variants
by the derivative pipeline. Ambience beds are 15-20 s takes cut into seamless loops.

Python 3 standard library only. Usage: python3 -I tools/audio-pipeline/plan.py [--dry-run]
"""
from __future__ import annotations

import hashlib
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
AUDIO = ROOT / "reference/tasks/vertical-slice-iteration05-20261026/audio"
QUEUE = AUDIO / "queue.json"
STEPS, CFG = 8, 1.0  # upstream: rf_denoiser distilled for 8 steps; CFG 1 = guidance off (single pass)
DRY = "close mic, recorded dry with no echo or reverb."


def seed_for(clip_id: str) -> int:
    return int(hashlib.sha256(f"last-line-iter05-sfx:{clip_id}".encode()).hexdigest()[:8], 16) & 0x7FFFFFFF


# (cue, base id, seconds, count, prompt). Order = priority (most frequent / important first).
PLAN: list[tuple[str, str, float, int, str]] = [
    # --- weapons (player-local) ---
    ("rifleShot", "rifle-shot", 2.0, 4,
     "TrackType: SFX, a single semi-automatic rifle gunshot with a sharp supersonic crack, a punchy body and a fast natural decay, " + DRY),
    ("shotgunShot", "shotgun-shot", 2.5, 3,
     "TrackType: SFX, a single pump-action shotgun blast with a heavy low-mid boom and a fast decay, " + DRY),
    # --- bullet impacts (very frequent, positional) ---
    ("impactConcrete", "impact-concrete", 1.5, 3,
     "TrackType: SFX, a bullet striking a concrete wall, a hard sharp crack followed by small chips of debris scattering, close mic, dry recording."),
    ("impactTile", "impact-tile", 1.5, 3,
     "TrackType: SFX, a bullet striking a glazed ceramic tile wall, a hard sharp crack with small tile shards breaking off and tinkling to the floor, close mic, dry recording."),
    ("impactMetal", "impact-metal", 1.5, 3,
     "TrackType: SFX, a bullet hitting a thick steel column, a bright metallic ping with a short ringing tail, close mic, dry recording."),
    ("impactWood", "impact-wood", 1.5, 3,
     "TrackType: SFX, a bullet striking a wooden crate, a hard splintering crack of wood with small splinters falling, close mic, dry recording."),
    ("impactFlesh", "impact-flesh", 1.0, 3,
     "TrackType: SFX, a bullet hitting a body, a short wet meaty thwack with a small squelch, close mic, dry recording."),
    # --- player footsteps (sliced) ---
    ("stepConcrete", "step-concrete-walk", 10.0, 1,
     "TrackType: SFX, footsteps of one person in leather boots walking at a steady pace on a gritty concrete floor, distinct separate steps, " + DRY),
    ("stepTile", "step-tile-walk", 10.0, 1,
     "TrackType: SFX, footsteps of one person in hard-soled boots walking at a steady pace on a polished stone tile floor, crisp heel clicks, distinct separate steps, " + DRY),
    ("stepConcreteRun", "step-concrete-run", 8.0, 1,
     "TrackType: SFX, footsteps of one person in boots running fast on a gritty concrete floor, quick heavy strides, " + DRY),
    ("stepTileRun", "step-tile-run", 8.0, 1,
     "TrackType: SFX, footsteps of one person in hard-soled boots running fast on a polished stone tile floor, quick crisp strides, " + DRY),
    # --- zombies (positional) ---
    ("zombieGroan", "zombie-groan", 3.0, 4,
     "TrackType: SFX, a zombie groaning, a low raspy guttural moan from a dry decayed throat, slow and menacing, " + DRY),
    ("zombieGroanDeep", "zombie-groan-deep", 3.0, 3,
     "TrackType: SFX, a large heavy zombie growling, a deep wet rumbling guttural growl, slow and menacing, " + DRY),
    ("zombieAttack", "zombie-attack", 1.5, 3,
     "TrackType: SFX, a zombie lunging to attack, a short aggressive snarling roar from a raspy throat, " + DRY),
    ("zombieDeath", "zombie-death", 2.5, 3,
     "TrackType: SFX, a zombie dying, a choking gurgling death rattle that fades out with a final wheeze, " + DRY),
    ("zombieStep", "zombie-shuffle", 10.0, 1,
     "TrackType: SFX, slow dragging shuffling footsteps of a limping person on a gritty concrete floor, feet scraping, irregular, " + DRY),
    ("zombieStepHeavy", "zombie-stomp", 10.0, 1,
     "TrackType: SFX, slow heavy stomping footsteps of a large person in boots on a concrete floor, irregular heavy thuds, " + DRY),
    # --- casings + bodies (sliced / positional) ---
    ("casingBrass", "casing-brass", 8.0, 1,
     "TrackType: SFX, empty brass rifle casings dropped one at a time onto a bare concrete floor, each a small bright metallic tinkle with a few quick bounces, spaced apart, " + DRY),
    ("casingHull", "casing-hull", 8.0, 1,
     "TrackType: SFX, empty plastic shotgun shells dropped one at a time onto a concrete floor, each a hollow light plastic clatter with two small bounces, spaced apart, " + DRY),
    ("bodyFall", "body-fall", 2.0, 3,
     "TrackType: SFX, a heavy human body collapsing onto a concrete floor, a dull heavy thud with limbs and clothing slapping down, " + DRY),
    # --- reload parts ---
    ("shotgunPump", "shotgun-pump", 2.0, 2,
     "TrackType: SFX, a pump-action shotgun being racked once, the fore-end slides back and snaps forward with two sharp metallic clack-clack sounds, " + DRY),
    ("shellInsert", "shell-insert", 6.0, 1,
     "TrackType: SFX, a shotgun being loaded by hand, single shells pushed one at a time into the tube magazine, each insert a short sharp click of brass and spring, slow steady pace with pauses, " + DRY),
    ("rifleMagOut", "rifle-mag-out", 1.5, 2,
     "TrackType: SFX, the magazine release of an assault rifle pressed and the metal magazine pulled out of the magazine well, a sharp click and a metallic slide, " + DRY),
    ("rifleMagIn", "rifle-mag-in", 1.5, 2,
     "TrackType: SFX, a loaded metal magazine slid into an assault rifle and seated with a firm solid click, " + DRY),
    ("rifleCharge", "rifle-charge", 1.5, 2,
     "TrackType: SFX, the charging handle of an assault rifle pulled back and released, the bolt slams home with a sharp metallic snap, " + DRY),
    ("rifleMagDrop", "rifle-mag-drop", 1.5, 1,
     "TrackType: SFX, an empty metal rifle magazine dropped onto a concrete floor, a single light metallic clatter and bounce, " + DRY),
    ("dryFire", "dry-fire", 1.0, 2,
     "TrackType: SFX, the trigger of an empty gun pulled, the hammer falls on an empty chamber with a single small dry metallic click, " + DRY),
    ("equip", "weapon-equip", 1.5, 2,
     "TrackType: SFX, a soldier raising a rifle into position, a short rustle of jacket fabric and a light rattle of the metal sling swivel, " + DRY),
    # --- player body ---
    ("hurt", "player-hurt", 1.0, 4,
     "TrackType: SFX, a man grunting in pain after being struck, a single short sharp pained grunt, " + DRY),
    ("jump", "jump", 1.0, 2,
     "TrackType: SFX, a person pushing off the ground to jump, a short boot scuff on concrete with a quick clothing rustle, " + DRY),
    ("land", "land", 1.5, 3,
     "TrackType: SFX, a person in boots landing hard on a concrete floor after a jump, a heavy thud with a clothing rustle, " + DRY),
    ("crouch", "crouch-rustle", 1.5, 2,
     "TrackType: SFX, a person crouching down quickly, a short rustle of a heavy jacket and trousers with a creak of boot leather, " + DRY),
    ("stepConcreteSneak", "step-concrete-sneak", 10.0, 1,
     "TrackType: SFX, slow careful soft footsteps of one person sneaking in rubber-soled boots on a concrete floor, quiet light steps with gentle grit, " + DRY),
    ("stepTileSneak", "step-tile-sneak", 10.0, 1,
     "TrackType: SFX, slow careful soft footsteps of one person sneaking in rubber-soled boots on a polished stone tile floor, quiet light steps, " + DRY),
    ("ladder", "ladder-climb", 8.0, 1,
     "TrackType: SFX, a person climbing a steel maintenance ladder, boots and gloved hands on metal rungs, steady rhythmic dull metallic clanks, " + DRY),
    ("heartbeat", "heartbeat", 8.0, 1,
     "TrackType: SFX, a slow heavy human heartbeat, deep muffled lub-dub thumps at a steady pace, close mic, dry, nothing else."),
    ("breath", "breathing", 10.0, 1,
     "TrackType: SFX, a man breathing heavily and panting after running, deep tired breaths in and out, " + DRY),
    ("death", "player-death", 3.0, 2,
     "TrackType: SFX, a man's final agonized groan and gasp as he collapses to the ground, " + DRY),
    # --- ambience beds (loops) ---
    ("bedWind", "bed-wind", 20.0, 2,
     "TrackType: SFX, ambience of wind blowing steadily through a long empty underground subway tunnel, a hollow airy whoosh with slow gentle gusts, no voices, no music."),
    ("bedRumble", "bed-rumble", 20.0, 2,
     "TrackType: SFX, ambience of a deep constant low rumble underground, distant machinery and traffic felt through concrete, steady room tone, no voices, no music."),
    ("bedHvac", "bed-hvac", 20.0, 2,
     "TrackType: SFX, ambience of a large empty hall with a steady ventilation system, air rushing through ducts and a constant fan hum, no voices, no music."),
    ("bedFridge", "bed-fridge", 15.0, 2,
     "TrackType: SFX, the steady electric hum of a commercial refrigerator compressor, a constant low motor drone with a faint rattle, close mic, no voices, no music."),
    ("bedBuzz", "bed-buzz", 15.0, 2,
     "TrackType: SFX, the steady electrical buzz of old fluorescent ceiling lights and a transformer hum in a concrete service corridor, constant, no voices, no music."),
    # --- ambience one-shots ---
    ("drip", "drips", 10.0, 1,
     "TrackType: SFX, single water drops falling from a ceiling into a small puddle on a concrete floor, irregular separate drips, " + DRY),
    ("creak", "creak", 3.0, 2,
     "TrackType: SFX, an old steel structure creaking and groaning under strain, a slow metallic creak, recorded dry."),
    ("clank", "clank", 2.0, 2,
     "TrackType: SFX, a single loose metal pipe clanking somewhere, a hollow metallic knock with a short ring, recorded dry."),
    ("trainDistant", "train-distant", 10.0, 2,
     "TrackType: SFX, a distant subway train rumbling through a tunnel far away, a low rolling rumble that swells and fades, no horn, no voices."),
    ("flicker", "flicker", 3.0, 2,
     "TrackType: SFX, a failing fluorescent tube light flickering, sputtering electrical buzz with sharp clicks of the starter, " + DRY),
    # --- containers ---
    ("cabinetOpen", "cabinet-open", 2.0, 2,
     "TrackType: SFX, a steel storage cabinet door unlatched and swung open, a metal latch click and a short creak of the hinge, " + DRY),
    ("cabinetClose", "cabinet-close", 1.5, 2,
     "TrackType: SFX, a steel storage cabinet door swung shut, a metallic clank and a latch click, " + DRY),
    ("crateOpen", "crate-open", 2.0, 1,
     "TrackType: SFX, the lid of a wooden crate lifted open, a creak of wood and a short scrape, " + DRY),
    ("crateClose", "crate-close", 1.5, 1,
     "TrackType: SFX, the lid of a wooden crate dropped shut, a hollow wooden thud, " + DRY),
    ("vendingPry", "vending-pry", 2.0, 1,
     "TrackType: SFX, prying open the door of a vending machine with a crowbar, metal straining and a latch snapping open with a rattle of glass, " + DRY),
    ("vendingClose", "vending-close", 1.5, 1,
     "TrackType: SFX, the glass front door of a vending machine pushed shut, a metal latch clack and a short glass rattle, " + DRY),
    ("coolerOpen", "cooler-open", 2.0, 1,
     "TrackType: SFX, a glass refrigerator door pulled open, the rubber seal unsticking with a soft suction pop and a rattle of bottles, " + DRY),
    ("coolerClose", "cooler-close", 1.5, 1,
     "TrackType: SFX, a glass refrigerator door swung shut, a soft thump of the rubber seal and a light glass rattle, " + DRY),
    ("drawerOpen", "drawer-open", 1.5, 1,
     "TrackType: SFX, a metal desk drawer pulled open on its runners, a short rolling slide and a soft stop, " + DRY),
    ("search", "search-rummage", 6.0, 1,
     "TrackType: SFX, rummaging through a shelf of small boxes and cans, items shifted and pushed aside, plastic and cardboard rustle, " + DRY),
    # --- items / consumables / UI ---
    ("pickup", "pickup", 1.0, 3,
     "TrackType: SFX, picking up a small object and stuffing it into a canvas backpack, a quick rustle of fabric, " + DRY),
    ("heal", "heal", 2.0, 2,
     "TrackType: SFX, tearing open a paper bandage wrapper and quickly wrapping a cloth bandage around an arm, crinkle and fabric rustle, " + DRY),
    ("eatChips", "eat-chips", 3.0, 1,
     "TrackType: SFX, opening a crinkly foil potato chip bag and loudly crunching a mouthful of chips, " + DRY),
    ("eatChocolate", "eat-chocolate", 3.0, 1,
     "TrackType: SFX, tearing a chocolate bar wrapper and biting off a piece with a snap, then chewing, " + DRY),
    ("eatBeans", "eat-beans", 3.0, 1,
     "TrackType: SFX, pulling the ring-pull lid off a metal food can with a pop and scraping a spoon inside the tin, " + DRY),
    ("eatNoodles", "eat-noodles", 3.0, 1,
     "TrackType: SFX, peeling the lid off a styrofoam cup and crunching dry instant noodles, " + DRY),
    ("eat", "eat-chew", 3.0, 1,
     "TrackType: SFX, a person chewing a mouthful of food with their mouth closed and swallowing, " + DRY),
    ("drinkCola", "drink-cola", 3.0, 1,
     "TrackType: SFX, cracking open a soda can with a sharp pop and fizz, then taking two gulps, " + DRY),
    ("drinkWater", "drink-water", 3.0, 1,
     "TrackType: SFX, twisting the cap off a plastic water bottle with a crackle, then gulping water, " + DRY),
    ("drinkJuice", "drink-juice", 3.0, 1,
     "TrackType: SFX, opening a paper juice carton and drinking with several gulps, " + DRY),
    ("denied", "denied", 1.0, 2,
     "TrackType: SFX, a short soft low electronic error buzz, a single dull negative beep, close mic, dry."),
    ("click", "flashlight-click", 1.0, 2,
     "TrackType: SFX, a single click of a flashlight push-button switch, a short crisp plastic click, " + DRY),
    ("hitTick", "hit-tick", 1.0, 2,
     "TrackType: SFX, a single tiny sharp tick, a small metal pin tapping hard plastic, very short, " + DRY),
    ("hitKill", "kill-thump", 1.0, 2,
     "TrackType: SFX, a single short dull heavy thump, a fist punching a heavy sandbag, very short, " + DRY),
    ("win", "win-chime", 4.0, 1,
     "TrackType: SFX, a subway station public address chime, three soft ascending electronic tones, clean, then silence."),
]


# Batch B (appended 2026-10-26T05:05Z after the first 32 takes): every 1.5 s and 2.5 s take so far
# (12 impacts at 1.5 s, 3 shotgun blasts at 2.5 s) came back as a sustained low drone with no
# transient, while integer lengths (1, 2, 3, 10 s) gave proper one-shots; the user's own 2.0 s takes
# of the same preset prompts are clean transients. The not-yet-submitted half-second entries are
# superseded BEFORE submission (no intent, no job) and replaced by the same prompts at integer
# lengths under new ids. The submitted half-second raws stay preserved and are QC-rejected.
_BY_BASE = {base: (cue, base, seconds, count, prompt) for cue, base, seconds, count, prompt in PLAN}
_B_LEN = {"shotgun-shot": 2.0, "impact-concrete": 2.0, "impact-tile": 2.0, "impact-metal": 2.0, "impact-wood": 2.0,
          "zombie-death": 3.0, "rifle-mag-out": 2.0, "rifle-mag-in": 2.0, "rifle-charge": 2.0, "rifle-mag-drop": 2.0,
          "weapon-equip": 2.0, "land": 2.0, "crouch-rustle": 2.0, "cabinet-close": 2.0, "crate-close": 2.0,
          "vending-close": 2.0, "cooler-close": 2.0, "drawer-open": 2.0}
# (05:06Z) zombie-attack was missed in the first pass: 01/02 were generated at 1.5 s (drones again), 03 is superseded.
_B_LEN2 = {"zombie-attack": 2.0}
PLAN_B = [(_BY_BASE[b][0], f"{b}-b", s, _BY_BASE[b][3], _BY_BASE[b][4]) for b, s in {**_B_LEN, **_B_LEN2}.items()]
SUPERSEDED_BASES = ["zombie-death", "rifle-mag-out", "rifle-mag-in", "rifle-charge", "rifle-mag-drop", "weapon-equip",
                    "land", "crouch-rustle", "cabinet-close", "crate-close", "vending-close", "cooler-close", "drawer-open"]
SUPERSEDED_EXTRA = ["zombie-attack-03"]
SUPERSEDED_REASON = ("Half-second duration superseded before submission: 1.5 s / 2.5 s takes returned sustained drones "
                     "instead of one-shots; replaced by the same prompt at an integer length (batch B, id suffix -b).")


def superseded_ids() -> list[str]:
    return [f"{b}-{i:02d}" for b in SUPERSEDED_BASES for i in range(1, _BY_BASE[b][3] + 1)] + SUPERSEDED_EXTRA


def build() -> list[dict]:
    out, seen = [], set()
    for cue, base, seconds, count, prompt in PLAN + PLAN_B:
        assert len(prompt) <= 600, (base, len(prompt))
        assert 1.0 <= seconds <= 30.0
        for i in range(1, count + 1):
            cid = f"{base}-{i:02d}"
            assert cid not in seen, cid
            seen.add(cid)
            out.append({"id": cid, "cue": cue, "prompt": prompt, "negative_prompt": "", "seconds": seconds,
                        "steps": STEPS, "cfg": CFG, "seed": seed_for(cid)})
    return out


def main(argv: list[str]) -> int:
    plan = build()
    if "--dry-run" in argv:
        print(json.dumps({"clips": len(plan), "audioSeconds": sum(c["seconds"] for c in plan)}, indent=2))
        return 0
    AUDIO.mkdir(parents=True, exist_ok=True)
    existing: list[dict] = []
    if QUEUE.exists():
        existing = json.loads(QUEUE.read_text(encoding="utf-8"))["clips"]
    by_id = {c["id"]: c for c in existing}
    for c in plan:
        if c["id"] in by_id and by_id[c["id"]] != c:
            print(f"refusing: queue entry {c['id']} differs from plan; entries are never rewritten", file=sys.stderr)
            return 2
    merged = existing + [c for c in plan if c["id"] not in by_id]
    sup_path = AUDIO / "superseded.json"
    sup = json.loads(sup_path.read_text(encoding="utf-8")) if sup_path.exists() else {"clips": {}}
    ledger = AUDIO / "ledger"
    added = 0
    for cid in superseded_ids():
        if cid in sup["clips"]:
            continue
        if (ledger / cid).exists():
            print(f"refusing to supersede {cid}: it already has ledger records", file=sys.stderr)
            return 2
        sup["clips"][cid] = {"reason": SUPERSEDED_REASON, "replacement": cid.rsplit("-", 1)[0] + "-b-" + cid.rsplit("-", 1)[1]}
        added += 1
    if added:
        tmp = sup_path.with_name(".superseded.json.tmp")
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(sup, f, indent=1)
            f.write("\n")
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, sup_path)
        print(f"superseded before submission: +{added}")
    if len(merged) == len(existing):
        print(f"queue unchanged ({len(existing)} clips)")
        return 0
    doc = {"task": "studio-slice-iteration05-20261026-01", "lane": "S",
           "endpoint": "http://10.0.0.59:7871", "contract": "POST /api/generate {prompt,negative_prompt,seconds,steps,cfg,seed} -> 202 {job}; GET /api/job; GET /api/outputs; GET /outputs/<day>/<file>",
           "note": "Planned before any request. Entries are append-only; ids never rewritten.", "clips": merged}
    tmp = QUEUE.with_name(".queue.json.tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(doc, f, indent=1)
        f.write("\n")
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, QUEUE)
    print(f"queue: {len(existing)} -> {len(merged)} clips")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
