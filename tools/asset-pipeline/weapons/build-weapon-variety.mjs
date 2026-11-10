// Task studio-weapon-variety-production-20261109-224355-01 (lane COOK): the runtime models of the twelve user-approved weapon additions
// (six guns G01..G06, six melee weapons M01..M06). Route: the user-approved side-on concept master (Codex native image generation, the
// weapon-variety board / rework tasks) used AS-IS as the conditioning image -> Meshy T2.5 image-to-3D (smart topology, 2K PBR). Every model
// KEEPS Meshy's own PBR maps (base colour / metallic-roughness / normal: kept or downsized / re-encoded only; no re-texture, projection or
// hand-painted replacement).
//
// Reads (never modifies) the lead's private task records OUTSIDE Git (reference/tasks/weapon-variety-production-20261109-224355/):
//   PRODUCTION-INPUT-MANIFEST.json   the 12 approved ids, each approved master's path + sha256 (the rejected Longwatch / Boar Spear / Riot
//                                    Baton masters it names as `replaces` must never be an input)
//   USER-GENERATION-APPROVAL.json    its sha256 must equal every reservation's approvalSha256
//   gen/LEDGER.jsonl                 the broker's fsynced reserve / posted / settle / raw / accept lines (the ONLY source of raws)
//   gen/raw/<ID>-<RES>-<taskId>.glb  the immutable raw originals (read-only; sha256 + bytes checked against the ledger's raw line)
// Only the LATEST ACCEPTED reservation per asset id is cooked; every sha is cross-checked (approval, approved master file = manifest =
// reservation, the actual conditioning image file = the reservation's input sha, the raw = the raw line). The real write needs all 12.
//
// Derivative = the game's held-weapon convention (as the user guns, props/build-user-weapons-iteration10.mjs, and the knife,
// weapons/build-knife.mjs; read by weapons/viewmodel.ts): metres, +Y up, forward = -Z.
//   Meshy frame (inspected, as the iteration-10 user guns): muzzle / head at raw -X, +Y up, the master's visible side (the weapon's RIGHT
//   side) facing raw -Z. Game = rotateY(-90deg) * uniform scale s: (x, y, z) -> (-z s, y s, x s): muzzle / head toward -Z, right side +X.
//   s = the plan's real overall length / the Z extent. THICKNESS: a side-view reconstruction guesses the depth (game X); a round part
//   (barrel, handle) is probed for its X / Y cross-section ratio, and a per-weapon X factor (about the centre, normals by the inverse
//   transpose) is applied ONLY where recorded (THICKNESS); every probe is recorded in the provenance.
//   Guns: the bounding box is centred on the origin (as the user guns); empty marker nodes Grip (pistol-grip hand), Muzzle (bore axis at
//   the muzzle face), Sight (the eye line over the rear sight; the scope's rear lens for G04), Eject (the ejection port, right side).
//   Melee: PIVOT AT THE HAND (as the knife): Grip = the main (rear) hand = the origin, Tip = the reach point (the farthest point of the
//   head / blade along -Z), Grip2 = the lead hand of the two-handed weapons.
//   Parts (movable mesh nodes; local mesh separation of the Meshy mesh, recorded): `Magazine` (G01 / G03 / G04 / G06) and the coach gun's
//   `Barrels` (barrels + fore-end) turning about its `Hinge` marker. A part node's translation is its pivot (Magazine: the top centre of
//   the magazine, i.e. the magazine well; Barrels: the Hinge), its geometry relative to it, so the reload animates the node directly.
//   Separation is by whole position-connected islands inside a box and / or an exact clip of the mesh by an axis-aligned box (triangles
//   crossing a face are split along it with interpolated position / normal / UV; nothing is moved, re-textured or invented).
// Geometry: an exact-attribute weld (lossless) only; NO simplification (Meshy's ~20k-triangle guns / ~12.5k-triangle melee weapons are a
// held-weapon first-person density). Maps: Meshy's 2048 JPEGs; guns keep the base colour byte-exact at 2048 and downsize metallic-
// roughness / normal to 1024; melee weapons downsize all three to 1024 (sharp lanczos3, JPEG 4:4:4).
//
// Writes deterministically:
//   game/public/assets/models/weapon-<item id with dashes>.glb          one body mesh node + part mesh nodes + marker nodes, ONE material
//   game/public/assets/derivatives/weapon-variety-<item id with dashes>.json   provenance (no URLs / tokens / prompts)
//   game/src/assets/weaponVarietyModels.generated.ts                     WEAPON_VARIETY_MODELS (key = item id)
//   tools/release/public-inputs.json                                     ONLY this script's entries added / updated (others untouched)
//
//   node tools/asset-pipeline/weapons/build-weapon-variety.mjs [--reference <dir>] [--dry-run <scratch dir> [--only G01,M02]] [--islands]
//   (--reference defaults to <repo>/reference; --dry-run writes the GLBs + provenance + a registry preview only into the scratch dir and
//   accepts a partial set; --islands prints each model's largest position-connected islands in the game frame, for authoring)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {Document, NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';

const root = path.resolve(import.meta.dirname, '../../..');
const argv = process.argv.slice(2);
const arg = n => { const i = argv.indexOf(n); return i < 0 ? null : argv[i + 1]; };
const REF = path.resolve(arg('--reference') ?? path.join(root, 'reference'));
const DRY = arg('--dry-run') ? path.resolve(arg('--dry-run')) : null;
const ONLY = arg('--only') ? arg('--only').split(',') : null;
const SHOW_ISLANDS = argv.includes('--islands');
if (ONLY && !DRY) throw new Error('--only is a dry-run option');
const PUB = path.join(root, 'game/public');
const REG = path.join(root, 'game/src/assets/weaponVarietyModels.generated.ts');
const IDS_TS = path.join(root, 'game/src/weapons/varietyIds.ts');
const ALLOW = path.join(root, 'tools/release/public-inputs.json');
const SELF = 'tools/asset-pipeline/weapons/build-weapon-variety.mjs';
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const nz = v => (Object.is(v, -0) || Math.abs(v) < 5e-7 ? 0 : v);
const r4 = v => nz(+v.toFixed(4)), r5 = v => nz(+v.toFixed(5)), r6 = v => nz(+v.toFixed(6));
const dashed = s => s.replace(/_/g, '-');
const sharp = (await import('sharp')).default;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

const TASK = {
  id: 'studio-weapon-variety-production-20261109-224355-01',
  dir: 'reference/tasks/weapon-variety-production-20261109-224355',
  manifest: 'PRODUCTION-INPUT-MANIFEST.json',
  approvalSha256: '43b5c9848958bc2b955bbd3c76d514ae6452217c70afd58473422d505791f54e',
  caps: {credits: 300, attempts: 20, posts: 35},
  recipe: {ai_model: 'meshy-t2.5', model_type: 'smart-topology', should_texture: true, texture_resolution: '2k', enable_pbr: true},
  approvalSummary: "the user's weapon-variety production approval: the 12 approved weapons (board revision 2, all KEEP) as Meshy T2.5 models, a fresh 300-credit ceiling (caps 20 attempts / 35 paid POSTs) through one task broker / ledger; Meshy's own PBR maps kept",
  route: "the user-approved side-on concept master (Codex native image_gen, weapon-variety board / rework tasks), used as-is as the conditioning image -> Meshy T2.5 image-to-3D (smart topology, 2K PBR texture); the Meshy model keeps its own PBR maps (kept / downsized / re-encoded only; no re-texture, projection or hand-painted replacement)",
  licence: "generated for this project (Codex concept master -> Meshy T2.5) under the user's weapon-variety production approval; provider terms apply; unapproved prototype asset, no blanket licence or commercial clearance implied",
};

/** Meshy frame -> game frame (before scale): muzzle / head raw -X -> game -Z; the right side raw -Z -> game +X. */
const ROT = ([x, y, z]) => [-z, y, x];
const ROT_TEXT = 'rotateY(-90deg): (x, y, z) -> (-z, y, x); raw -X (muzzle / head) -> game -Z, raw -Z (the master\'s visible = the weapon\'s RIGHT side) -> game +X';
/** The band (m) at the front face whose vertices define the Muzzle / Tip centre. */
const FRONT_BAND = 0.004;
/** A 'mid' y (handle axis): the cross-section within this half-size (m) of z gives the x of the Y ray. */
const MID_R = 0.006;
/** Thickness probe: X / Y cross-section ratios of a round part outside this band would need a recorded correction. */
const ROUND_BAND = [0.85, 1.18];
const TEX = {gun: {baseColor: 2048, metallicRoughness: 1024, normal: 1024}, melee: {baseColor: 1024, metallicRoughness: 1024, normal: 1024}};
const JPEG = {baseColor: {quality: 90, chromaSubsampling: '4:4:4'}, metallicRoughness: {quality: 90, chromaSubsampling: '4:4:4'}, normal: {quality: 92, chromaSubsampling: '4:4:4'}};
const SLOTS = ['baseColor', 'metallicRoughness', 'normal'];

/**
 * The plan's table + the recorded per-weapon processing. All coordinates are metres in the CENTRED game frame (after the rotation, the
 * uniform length fit, any recorded thickness factor and centring the bounding box on the origin; melee weapons are shifted to Grip = origin
 * only at the end). Markers: [x, y, z] with x = 'mid' (the local mid-plane at that y / z) or 'right' (the right-side surface there);
 * {front: {y?, x?}} = the front face (min z) centre of the vertices in the optional y / x ranges.
 * round: the thickness probe (a round part: z / y ranges); kx: the recorded X factor (1 = none).
 * parts: [{name, islands?: {box, expect}, clip?: {box}, pivot: 'top' | 'hinge'}]: whole islands lying inside `islands.box` and / or the
 * mesh clipped to `clip.box` (exact split along its faces) become the part.
 */
const WEAPONS = [
  {asset: 'G01', itemId: 'hornet', kind: 'gun', length: 0.62},
  {asset: 'G02', itemId: 'longslide', kind: 'gun', length: 0.27},
  {asset: 'G03', itemId: 'stub', kind: 'gun', length: 0.70},
  {asset: 'G04', itemId: 'overwatch', kind: 'gun', length: 1.05},
  {asset: 'G05', itemId: 'coach_gun', kind: 'gun', length: 0.95},
  {asset: 'G06', itemId: 'thresher', kind: 'gun', length: 1.00},
  {asset: 'M01', itemId: 'fire_axe', kind: 'melee', length: 0.90},
  {asset: 'M02', itemId: 'machete', kind: 'melee', length: 0.62},
  {asset: 'M03', itemId: 'sledgehammer', kind: 'melee', length: 0.92},
  {asset: 'M04', itemId: 'crowbar', kind: 'melee', length: 0.76},
  {asset: 'M05', itemId: 'slugger', kind: 'melee', length: 0.84},
  {asset: 'M06', itemId: 'track_shovel', kind: 'melee', length: 1.25},
];
/** Recorded per-weapon processing (filled from the inspected raws; see the header). */
const SPEC = {
  G01: {
    round: {z: [-0.30, -0.255], y: [0.03, 0.07]}, roundPart: 'the exposed barrel + muzzle device (round)',
    ops: [{op: 'assign', name: 'Magazine', islands: {box: {min: [-0.02, -0.13, -0.13], max: [0.02, 0.02, -0.08]}, expect: {islands: 1, tris: 238}},
      why: 'lane AG accept of R002: Meshy built the stick magazine (with its base pad) as its own island, reaching up into the magazine well'}],
    parts: [{name: 'Magazine', pivot: 'top', why: 'the box-magazine reload (drop / insert)'}],
    markers: {Grip: ['mid', -0.045, 0.039], Muzzle: {front: {}}, Sight: ['mid', 0.108, 0.03], Eject: [{right: [0.065, -0.05]}, 0.07, -0.07]},
    markerNotes: 'Sight: the eye line through the rear flip aperture (open 0.098 - 0.120) at the front post tip (0.1075); Eject: the port window on the right of the upper receiver; Grip: the pistol grip at mid-hand height',
  },
  G02: {
    kx: 1.3, kxWhy: 'lead decision (lane AG accept of R003): the reconstructed pistol is 22 mm across (slide ~21 mm), slim for a long-slide target pistol; widened x1.3 to ~28.6 mm (a plausible ~28 - 30 mm)',
    round: {z: [-0.12, -0.02], y: [0.025, 0.06]}, roundPart: 'the slide section (a width probe; not round)', widthProbe: true,
    markers: {Grip: ['mid', -0.015, 0.0996], Muzzle: {front: {y: [0.030, 0.046]}}, Sight: ['mid', 0.056, 0.118], Eject: [{right: [0.033, 0.034]}, 0.045, 0.034]},
    markerNotes: 'no Magazine part (lead: only the flush base plate is separate; the whole gun animates the reload). Muzzle: the slide front face around the bore (y 0.030 - 0.046); Sight: the rear notch (bottom 0.0515, ears 0.0588) level with the front post top',
  },
  G03: {
    round: {z: [-0.35, -0.28]}, roundPart: 'the muzzle device (round)',
    ops: [{op: 'assign', name: 'Magazine', islands: {box: {min: [-0.02, -0.14, 0.12], max: [0.02, 0.02, 0.22]}, expect: {islands: 1, tris: 1183}},
      why: 'lane AG accept of R004: the curved magazine behind the grip is its own island'}],
    parts: [{name: 'Magazine', pivot: 'top', why: 'the box-magazine reload (drop / insert)'}],
    markers: {Grip: ['mid', -0.045, 0.038], Muzzle: {front: {}}, Sight: ['mid', 0.12, -0.055], Eject: [{right: [0.035, 0.15]}, 0.057, 0.15]},
    markerNotes: 'Sight: the centre of the reflex sight window (bottom 0.106, top bar 0.133) at its frame (z -0.055); Eject: the bullpup port window behind the grip',
  },
  G04: {
    round: {z: [-0.52, -0.37], y: [0.0, 0.04]}, roundPart: 'the barrel ahead of the handguard (round)',
    ops: [
      {op: 'assign', name: 'Magazine', islands: {box: {min: [-0.02, -0.105, 0.06], max: [0.005, -0.01, 0.135]}, expect: {islands: 1, tris: 234}},
        why: 'lane AG accept of R005: the short magazine is its own island'},
      {op: 'scaleX', name: 'Magazine', width: 0.024, centreX: -0.0068,
        why: 'lead decision: the magazine island is thin (17.7 mm) and off the well; thickened across X to a plausible 24 mm and centred on the magazine well (x -0.0068, the receiver / barrel mid-plane)'},
    ],
    parts: [{name: 'Magazine', pivot: 'top', why: 'the box-magazine reload (drop / insert)'}],
    markers: {Grip: ['mid', -0.06, 0.222], Muzzle: {front: {}}, Sight: {back: {y: [0.055, 0.13], z: [0.0, 0.3]}}, Eject: [{right: [0.005, 0.11]}, 0.022, 0.11]},
    markerNotes: 'Sight: the scope\'s rear lens (the ocular face centre). The receiver, barrel, scope and stock share one mid-plane x ~ -0.007; the bounding box centre is pulled off it by the right-hand windage turret (the lane\'s raw +0.008 z note): no part is offset from another, so nothing is re-centred',
  },
  G05: {
    round: {z: [-0.45, -0.1], y: [0.05, 0.0795]}, roundPart: 'the reconstructed barrel tube (round), before the pair',
    ops: [
      {op: 'assign', name: 'Bead', islands: {box: {min: [-0.01, 0.079, -0.47], max: [0.01, 0.085, -0.445]}, expect: {islands: 1, tris: 162}},
        why: 'the front bead (its own island) is kept single: separated before the barrel tube is paired'},
      {op: 'assign', name: 'Fore', islands: {box: {min: [-0.025, 0.005, -0.40], max: [0.025, 0.051, -0.07]}, expect: {islands: 1, tris: 1992}},
        why: 'the fore-end (its own island) is kept single: separated before the barrel tube is cut / paired'},
      {op: 'drop', islands: {box: {min: [-0.03, 0.02, 0.045], max: [0.03, 0.095, 0.09]}, expect: {islands: 2, tris: 2908}},
        why: 'lead decision (lane AG accept of R006): Meshy built TWO hammers per side (the side-on master shows both hammers one behind the other); a hammer double gun has one per barrel, side by side: the rear pair (z 0.050 - 0.087, overlapping the front pair) is removed, the front pair (their noses at the standing breech) kept'},
      {op: 'assign', name: 'Barrels', clip: {box: {min: [-1, 0.044, -1], max: [1, 1, -0.085]}},
        why: 'lead decision: the single reconstructed barrel tube, in front of the action (z < -0.085): the tube with its thin lower web (down to y 0.0449, sitting in the fore-end channel)'},
      {op: 'assign', name: 'Barrels', clip: {box: {min: [-1, 0.0472, -0.085], max: [1, 1, 0]}},
        why: 'lead decision: the tube over the action bar, cut at the breech face (z 0) just below its underside (0.0474), above the bar (its top 0.043, the cradle lips <= 0.0477); the tube is 30.5 - 33.5 mm, flaring to ~40 mm in its last 2 cm'},
      {op: 'pair', name: 'Barrels', width: 0.022, offset: 0.011, refZ: [-1, -0.04],
        why: 'lead decision: Meshy built ONE round barrel (the side-on master hides the second); it is duplicated laterally into the approved side-by-side pair: each tube 22 mm wide, centres +-11 mm from the bore line, joined along the rib; same UVs / maps'},
      {op: 'assign', name: 'Barrels', from: 'Fore', islands: {box: {min: [-1, -1, -1], max: [1, 1, 1]}, expect: {islands: 1, tris: 1992}}, why: 'the fore-end joins the barrels (it breaks with them)'},
      {op: 'move', name: 'Bead', by: [0, -0.0035, 0], why: 'the bead sat on the single tube\'s crown; lowered 3.5 mm into the rib between the paired tubes (its top level with the tube tops)'},
      {op: 'assign', name: 'Barrels', from: 'Bead', islands: {box: {min: [-1, -1, -1], max: [1, 1, 1]}, expect: {islands: 1, tris: 162}}, why: 'the bead rides on the barrels'},
    ],
    parts: [{name: 'Barrels', pivot: 'hinge', why: 'the break-action reload: barrels + fore-end + bead turn about the Hinge (rotation.x < 0 drops the muzzles and lifts the breech)'}],
    markers: {Grip: ['mid', 0.009, 0.16], Muzzle: {front: {}}, Sight: [{mid: [0.064, -0.006]}, 0.08, -0.006], Eject: ['mid', 0.064, 0.002], Hinge: ['mid', 0.045, -0.075]},
    markerNotes: 'Grip: the wrist of the straight stock behind the trigger guard; Muzzle: the centre between the two muzzles (one muzzle point); Sight: the rib line at the breech, level with the bead top; Eject: the breech face between the chambers (where the shells are extracted when the gun is broken open); Hinge: the front-bottom of the action bar under the barrels (the pivot axis is parallel to X)',
  },
  G06: {
    round: {z: [-0.5, -0.36], y: [0.03, 0.07]}, roundPart: 'the barrel + muzzle device (round)',
    ops: [{op: 'assign', name: 'Magazine', clip: {box: {min: [-0.0175, -1, -0.045], max: [0.0175, -0.002, 0.057]}},
      why: 'lead decision (lane AG accept of R007): the box magazine (26 mm, base pad 32 mm) is fused to the receiver; cut exactly just below the magazine-well lip (y -0.002; the receiver\'s lower edge dips to -0.0015) between the trigger guard (z > 0.057) and the receiver front (z < -0.045), inside x +-0.0175'}],
    parts: [{name: 'Magazine', pivot: 'top', why: 'the box-magazine reload (drop / insert)'}],
    markers: {Grip: [{mid: [-0.05, 0.18]}, -0.05, 0.189], Muzzle: {front: {}}, Sight: ['mid', 0.106, 0.145], Eject: [{right: [0.04, 0.0]}, 0.063, 0.0]},
    markerNotes: 'Sight: the eye line through the rear diopter aperture (open from 0.107 up on the centre line) at the front post tip (0.105)',
  },
  M01: {
    round: {z: [-0.25, 0.2], y: [-0.03, 0.03]}, roundPart: 'the wood haft (an oval axe haft by design: ~22 x 38 mm; a width probe)', widthProbe: true,
    markers: {Grip: ['mid', 'mid', 0.39], Grip2: ['mid', 'mid', 0.15], Tip: {front: {y: [-0.03, 0.03]}}},
    markerNotes: 'two-handed: Grip = the rear hand in front of the pommel cap, Grip2 = the lead hand on the haft above the grip wrap; Tip = the head\'s front face on the haft axis (the blade edge points -Y, the pick +Y)',
  },
  M02: {
    round: {z: [0.15, 0.3]}, roundPart: 'the handle (a flat-oval machete grip by design: a width probe)', widthProbe: true,
    ops: [{op: 'scaleX', islands: {box: {min: [-0.01, -0.03, -0.32], max: [0.01, 0.035, 0.15]}, expect: {islands: 1, tris: 2244}}, toThickness: 0.0028, localR: 0.004,
      why: 'lead decision (lane AM accept of R008): the blade (its own island) is a 0.6 - 1.0 mm sliver (its mid-surface offset ~1.6 mm from the tip\'s); thickened across X to ~2.8 mm about its local mid-surface (the ~2.5 mm tip region barely changes)'}],
    markers: {Grip: ['mid', 'mid', 0.225], Tip: {front: {}}},
    markerNotes: 'one-handed: Grip = the middle of the handle (as the knife); Tip = the blade point (the edge points -Y, the spine +Y)',
  },
  M03: {
    round: {z: [-0.3, 0.1]}, roundPart: 'the fibreglass handle (round)',
    markers: {Grip: ['mid', 'mid', 0.40], Grip2: ['mid', 'mid', 0.20], Tip: {front: {y: [-0.03, 0.03]}}},
    markerNotes: 'two-handed: Grip = the rear hand in front of the end cap, Grip2 = the lead hand at the front of the rubber grip; Tip = the head\'s front face on the handle axis (the striking faces point +-Y)',
  },
  M04: {
    turn: 'lead / lane AM: Meshy built the crowbar with its hook (the head) at raw +X',
    kx: 0.7, kxWhy: 'lead decision (lane AM accept of R010): the shaft section is 24 (Y) x 34 (X) mm, wider across than the master\'s hex bar; X x0.7 makes it a round-ish 24 x 24 mm bar',
    round: {z: [-0.05, 0.05], y: [-0.03, 0.03]}, roundPart: 'the hex shaft (a 10 cm section)',
    markers: {Grip: ['mid', 'mid', 0.25], Tip: {front: {}}},
    markerNotes: 'one-handed: Grip = the hand near the straight (chisel) end; Tip = the front of the gooseneck hook (the claw points -Y)',
  },
  M05: {
    round: {z: [-0.35, -0.1]}, roundPart: 'the barrel (round)',
    markers: {Grip: ['mid', 'mid', 0.38], Grip2: ['mid', 'mid', 0.29], Tip: {front: {}}},
    markerNotes: 'two-handed (stacked hands): Grip = the bottom hand against the knob, Grip2 = the top hand above it; Tip = the barrel end cap centre',
  },
  M06: {
    turn: 'lead / lane AM: Meshy built the track shovel with its blade (the head) at raw +X',
    round: {z: [-0.2, 0.5]}, roundPart: 'the wood handle (round)',
    markers: {Grip: ['mid', 'mid', 0.56], Grip2: ['mid', 'mid', 0.25], Tip: {front: {}}},
    markerNotes: 'two-handed: Grip = the rear hand near the handle end, Grip2 = the lead hand up the shaft; Tip = the blade point. The blade plate (~5.8 mm, kept: lead) lies in the Y-Z plane (its faces +-X)',
  },
};

// ---------- the shared id contract ----------
const idsSrc = fs.readFileSync(IDS_TS, 'utf8');
const CONTRACT = new Map([...idsSrc.matchAll(/^\s+(\w+): \{asset: '(\w+)', name: '([^']+)', family: '(\w+)'/gm)].map(m => [m[1], {asset: m[2], name: m[3], family: m[4]}]));
if (CONTRACT.size !== 12) throw new Error(`varietyIds.ts: expected 12 VARIETY_WEAPONS entries, parsed ${CONTRACT.size}`);
for (const w of WEAPONS) {
  const c = CONTRACT.get(w.itemId);
  if (!c || c.asset !== w.asset) throw new Error(`${w.asset}: varietyIds.ts maps ${w.itemId} to ${c?.asset}`);
  if ((w.kind === 'melee') !== (c.family === 'knife')) throw new Error(`${w.asset}: kind ${w.kind} != family ${c.family}`);
  w.name = c.name; w.family = c.family; w.slug = dashed(w.itemId);
}

// ---------- records ----------
const T = path.join(REF, path.relative('reference', TASK.dir)), GEN = path.join(T, 'gen');
const manifest = JSON.parse(fs.readFileSync(path.join(T, TASK.manifest), 'utf8'));
const approved = new Map(manifest.assets.map(a => [a.id, a]));
if (approved.size !== 12 || WEAPONS.some(w => !approved.has(w.asset))) throw new Error('the plan table does not cover the production manifest');
const supersededShas = new Set(manifest.assets.filter(a => a.replaces).map(a => a.replaces.sourceImageSha256));
const approvalSha = sha(fs.readFileSync(path.join(T, 'USER-GENERATION-APPROVAL.json')));
if (approvalSha !== TASK.approvalSha256) throw new Error('USER-GENERATION-APPROVAL.json sha256 != the task approval');
const ledgerLines = fs.readFileSync(path.join(GEN, 'LEDGER.jsonl'), 'utf8').split('\n').filter(Boolean).map((l, i) => ({...JSON.parse(l), seq: i + 1}));
/** The broker's own state machine (gen/broker.py state()) over the ledger, keeping the line numbers. */
const ledger = (() => {
  const res = new Map();
  for (const l of ledgerLines) {
    if (l.type === 'close') continue;
    if (l.type === 'reserve') { res.set(l.res, {reserve: l, state: 'reserved', billed: 0, lines: {reserve: l.seq}}); continue; }
    const x = res.get(l.res);
    if (!x) continue;
    if (l.asset !== x.reserve.asset) throw new Error(`ledger line ${l.seq}: asset ${l.asset} != reservation ${l.res} asset ${x.reserve.asset}`);
    if (l.type === 'posted') Object.assign(x, {state: 'posted', taskId: l.taskId});
    else if (l.type === 'uncertain') x.state = 'uncertain';
    else if (l.type === 'reconciled') { if (l.taskId) Object.assign(x, {state: 'posted', taskId: l.taskId}); else x.state = 'released'; }
    else if (l.type === 'settle') Object.assign(x, {state: l.status.toLowerCase(), billed: l.billed, settle: l});
    else if (l.type === 'raw') x.raw = l;
    else if (l.type === 'accept') Object.assign(x, {accepted: true, accept: l});
    else if (l.type === 'reject') Object.assign(x, {accepted: false, reject: l});
    x.lines[l.type] = l.seq;
  }
  const all = [...res.values()];
  const billed = all.reduce((s, x) => s + x.billed, 0);
  const reserved = all.filter(x => ['reserved', 'posted', 'uncertain'].includes(x.state)).reduce((s, x) => s + x.reserve.credits, 0);
  if (billed + reserved > TASK.caps.credits || all.length > TASK.caps.attempts || all.length > TASK.caps.posts) throw new Error(`ledger outside the caps: billed ${billed} reserved ${reserved} attempts ${all.length}`);
  return {res, billed, reserved, attempts: all.length};
})();
const relT = f => { const rel = path.relative(T, path.resolve(f)); if (rel.startsWith('..')) throw new Error(`${f} is outside the task dir`); return `${TASK.dir}/${rel.split(path.sep).join('/')}`; };
const relRef = f => { const rel = path.relative(REF, path.resolve(f)); if (rel.startsWith('..')) return path.basename(f); return `reference/${rel.split(path.sep).join('/')}`; };

/** The latest accepted reservation of an asset, cross-checked like its broker (or null when none is accepted yet). */
function records(w) {
  const a = approved.get(w.asset);
  const list = [...ledger.res.values()].filter(x => x.reserve.asset === w.asset && x.accepted === true);
  const x = list.sort((p, q) => q.accept.seq - p.accept.seq)[0];
  if (!x) return null;
  const rv = x.reserve, fail = m => { throw new Error(`${w.asset} ${rv.res}: ${m}`); };
  if (x.state !== 'succeeded' || x.settle?.status !== 'SUCCEEDED') fail(`accepted but not SUCCEEDED (${x.state})`);
  if (!x.taskId || !x.raw) fail('no task id / raw line');
  if (rv.approvalSha256 !== approvalSha) fail('reservation approval sha256 != USER-GENERATION-APPROVAL.json');
  // the approved master: manifest sha == reservation sha == the file's own sha (workerApprovedOriginal)
  if (rv.approvedSourceSha256 !== a.sourceImageSha256) fail('reservation approvedSourceSha256 != the manifest approved master sha256');
  const masterBytes = fs.readFileSync(path.join(REF, path.relative('/workspaces/subway-game/reference', a.workerApprovedOriginal)));
  if (sha(masterBytes) !== a.sourceImageSha256) fail('the approved master file sha256 != the manifest');
  // the actual conditioning image: its bytes == the reservation's input sha / bytes; the approved master itself (or a recorded derivative)
  const inputPath = path.join(REF, path.relative('/workspaces/subway-game/reference', rv.input));
  const inputBytes = fs.readFileSync(inputPath);
  if (sha(inputBytes) !== rv.inputSha256 || inputBytes.length !== rv.inputBytes) fail('conditioning image sha256 / bytes != the reservation');
  if (supersededShas.has(rv.inputSha256) || supersededShas.has(rv.approvedSourceSha256)) fail('a superseded (rejected) master was the input');
  if (rv.inputProof?.kind === 'approved-master') { if (rv.inputSha256 !== a.sourceImageSha256) fail('input proof says approved master but the sha differs'); }
  else if (rv.inputProof?.kind !== 'derivative' || rv.inputProof.approvedSourceSha256 !== a.sourceImageSha256 || rv.inputProof.outputSha256 !== rv.inputSha256) fail('no valid input proof');
  const p = rv.params ?? {};
  for (const [k, v] of Object.entries(TASK.recipe)) if (p[k] !== v) fail(`reservation params.${k} = ${JSON.stringify(p[k])} != the approved recipe ${JSON.stringify(v)}`);
  if (p.file_path !== rv.input) fail('params.file_path != the reserved input');
  if (rv.tool !== 'mcp__meshy__meshy_image_to_3d') fail(`tool ${rv.tool}`);
  const rawFile = path.join(GEN, 'raw', path.basename(x.raw.file));
  if (path.basename(path.dirname(x.raw.file)) !== 'raw' || path.basename(rawFile) !== `${w.asset}-${rv.res}-${x.taskId}.glb`) fail(`raw file name ${x.raw.file} is not gen/raw/<ID>-<RES>-<taskId>.glb`);
  const bytes = fs.readFileSync(rawFile);
  if (sha(bytes) !== x.raw.sha256 || bytes.length !== x.raw.bytes) fail(`raw original sha256 / bytes mismatch (${rawFile})`);
  return {res: rv.res, lane: rv.lane, taskId: x.taskId, reserve: rv, settle: x.settle, raw: x.raw, accept: x.accept, lines: x.lines, bytes, rawFile,
    master: {file: a.workerApprovedOriginal, sha256: a.sourceImageSha256, bytes: masterBytes.length},
    input: {file: rv.input, sha256: rv.inputSha256, bytes: rv.inputBytes, proof: rv.inputProof?.kind},
    attemptsForAsset: [...ledger.res.values()].filter(y => y.reserve.asset === w.asset).map(y => ({res: y.reserve.res, state: y.state, accepted: y.accepted ?? null}))};
}

// ---------- geometry ----------
async function readRaw(w, rec) {
  const doc = await io.readBinary(new Uint8Array(rec.bytes));
  const r = doc.getRoot(), fail = m => { throw new Error(`${w.asset}: ${m}`); };
  const nodes = r.listNodes().filter(n => n.getMesh());
  if (nodes.length !== 1 || r.listMeshes().length !== 1 || r.listMaterials().length !== 1) fail('expected one mesh node / mesh / material');
  const M = nodes[0].getWorldMatrix();
  if (M.some((v, i) => Math.abs(v - [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1][i]) > 1e-9)) fail('non-identity source node');
  const prims = r.listMeshes()[0].listPrimitives();
  if (prims.length !== 1 || prims[0].getMode() !== 4) fail('expected one triangle primitive');
  const p = prims[0], mat = r.listMaterials()[0];
  for (const s of ['POSITION', 'NORMAL', 'TEXCOORD_0']) if (!p.getAttribute(s)) fail(`missing ${s}`);
  if (mat.getAlphaMode() !== 'OPAQUE' || mat.getOcclusionTexture() || mat.getEmissiveTexture()) fail('unexpected material (alpha / occlusion / emissive)');
  const infos = {baseColor: mat.getBaseColorTextureInfo(), metallicRoughness: mat.getMetallicRoughnessTextureInfo(), normal: mat.getNormalTextureInfo()};
  for (const info of Object.values(infos)) if (!info || info.getTexCoord() !== 0) fail('a map is missing or uses TEXCOORD_1');
  const I = p.getIndices() ? Uint32Array.from(p.getIndices().getArray()) : Uint32Array.from({length: p.getAttribute('POSITION').getCount()}, (_, i) => i);
  const m = {P: Float64Array.from(p.getAttribute('POSITION').getArray()), N: Float64Array.from(p.getAttribute('NORMAL').getArray()),
    UV: Float64Array.from(p.getAttribute('TEXCOORD_0').getArray()), I};
  const textures = {baseColor: mat.getBaseColorTexture(), metallicRoughness: mat.getMetallicRoughnessTexture(), normal: mat.getNormalTexture()};
  const maps = SLOTS.map(slot => { const t = textures[slot]; return {slot, size: t.getSize(), mime: t.getMimeType(), bytes: t.getImage().byteLength, sha256: sha(t.getImage())}; });
  const sampler = Object.fromEntries(SLOTS.map(s => [s, {wrapS: infos[s].getWrapS(), wrapT: infos[s].getWrapT(), magFilter: infos[s].getMagFilter(), minFilter: infos[s].getMinFilter()}]));
  const material = {baseColorFactor: mat.getBaseColorFactor(), metallicFactor: mat.getMetallicFactor(), roughnessFactor: mat.getRoughnessFactor(),
    emissiveFactor: mat.getEmissiveFactor(), normalScale: mat.getNormalScale(), doubleSided: mat.getDoubleSided(), alphaMode: mat.getAlphaMode()};
  const extraSemantics = p.listSemantics().filter(s => !['POSITION', 'NORMAL', 'TEXCOORD_0'].includes(s));
  return {m, textures, maps, sampler, material, extraSemantics, tris: I.length / 3, verts: m.P.length / 3};
}

/** Exact-attribute weld (bitwise-equal float32 position / normal / uv) + degenerate-triangle and unreferenced-vertex removal; lossless. */
function weld(m) {
  const nv = m.P.length / 3, stride = 8, A = new Float32Array(nv * stride);
  for (let v = 0; v < nv; v++) for (let k = 0; k < 3; k++) { A[v * stride + k] = m.P[3 * v + k]; A[v * stride + 3 + k] = m.N[3 * v + k]; if (k < 2) A[v * stride + 6 + k] = m.UV[2 * v + k]; }
  const U = new Uint32Array(A.buffer);
  let cap = 1; while (cap < nv * 2) cap <<= 1;
  const table = new Int32Array(cap).fill(-1), remap = new Uint32Array(nv), first = [], used = new Uint8Array(nv);
  for (let i = 0; i < m.I.length; i++) used[m.I[i]] = 1;
  let unreferenced = 0;
  for (let v = 0; v < nv; v++) {
    if (!used[v]) { unreferenced++; continue; }
    let h = 2166136261;
    for (let k = 0; k < stride; k++) { h ^= U[v * stride + k]; h = Math.imul(h, 16777619); }
    for (let s = (h >>> 0) & (cap - 1); ; s = (s + 1) & (cap - 1)) {
      const q = table[s];
      if (q < 0) { table[s] = first.length; remap[v] = first.length; first.push(v); break; }
      let eq = true;
      for (let k = 0; k < stride; k++) if (U[first[q] * stride + k] !== U[v * stride + k]) { eq = false; break; }
      if (eq) { remap[v] = q; break; }
    }
  }
  const n = first.length, P = new Float64Array(n * 3), N = new Float64Array(n * 3), UV = new Float64Array(n * 2);
  first.forEach((v, i) => { for (let k = 0; k < 3; k++) { P[3 * i + k] = m.P[3 * v + k]; N[3 * i + k] = m.N[3 * v + k]; } UV[2 * i] = m.UV[2 * v]; UV[2 * i + 1] = m.UV[2 * v + 1]; });
  const I = [];
  let degenerate = 0;
  for (let f = 0; f < m.I.length; f += 3) {
    const a = remap[m.I[f]], b = remap[m.I[f + 1]], c = remap[m.I[f + 2]];
    if (a === b || b === c || a === c) { degenerate++; continue; }
    I.push(a, b, c);
  }
  return {m: {P, N, UV, I: Uint32Array.from(I)}, info: {verticesBefore: nv, verticesAfter: n, unreferencedVerticesDropped: unreferenced, degenerateTrianglesDropped: degenerate}};
}

function boundsOf(P, I = null) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  const visit = v => { for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], P[3 * v + k]); max[k] = Math.max(max[k], P[3 * v + k]); } };
  if (I) for (let i = 0; i < I.length; i++) visit(I[i]); else for (let v = 0; v < P.length / 3; v++) visit(v);
  return {min, max};
}

/** The vertices (of the triangles in I) inside an axis-aligned range {x?, y?, z?: [lo, hi]}: their bounds + count. */
function slab(m, range, I = m.I) {
  const used = new Uint8Array(m.P.length / 3);
  for (let i = 0; i < I.length; i++) used[I[i]] = 1;
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  let n = 0;
  for (let v = 0; v < used.length; v++) {
    if (!used[v]) continue;
    const p = [m.P[3 * v], m.P[3 * v + 1], m.P[3 * v + 2]];
    if (['x', 'y', 'z'].some((ax, k) => range[ax] && (p[k] < range[ax][0] || p[k] > range[ax][1]))) continue;
    n++;
    for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], p[k]); max[k] = Math.max(max[k], p[k]); }
  }
  return {n, min, max};
}

/** Position-connected islands (exact positions): [{tris: [triangle indices], min, max}], largest first. */
function islands(m) {
  const nv = m.P.length / 3, key = new Map(), rep = new Int32Array(nv);
  for (let v = 0; v < nv; v++) { const k = `${m.P[3 * v]},${m.P[3 * v + 1]},${m.P[3 * v + 2]}`; if (!key.has(k)) key.set(k, key.size); rep[v] = key.get(k); }
  const par = Int32Array.from({length: key.size}, (_, i) => i);
  const f = x => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
  const TN = m.I.length / 3;
  for (let t = 0; t < TN; t++) { const a = rep[m.I[3 * t]], b = rep[m.I[3 * t + 1]], c = rep[m.I[3 * t + 2]]; par[f(a)] = f(b); par[f(b)] = f(c); }
  const comps = new Map();
  for (let t = 0; t < TN; t++) {
    const c = f(rep[m.I[3 * t]]);
    if (!comps.has(c)) comps.set(c, {tris: [], min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity]});
    const o = comps.get(c); o.tris.push(t);
    for (let k = 0; k < 3; k++) { const v = m.I[3 * t + k]; for (let r = 0; r < 3; r++) { o.min[r] = Math.min(o.min[r], m.P[3 * v + r]); o.max[r] = Math.max(o.max[r], m.P[3 * v + r]); } }
  }
  return [...comps.values()].sort((a, b) => b.tris.length - a.tris.length || a.min[2] - b.min[2]);
}
const inBox = (o, b) => [0, 1, 2].every(k => o.min[k] >= b.min[k] && o.max[k] <= b.max[k]);

/**
 * Exact clip of the triangles `cand` of mesh m (P / N / UV extended in place: returned) by an axis-aligned box: triangles crossing a box
 * face are split along it (Sutherland-Hodgman per face; the cut vertex interpolates position / normal / UV, computed in a canonical edge
 * order so both sides of a shared edge get the identical position, and lies exactly on the face). Returns the inside / outside triangles.
 */
function clipBox(m, cand, box) {
  const P = Array.from(m.P), N = Array.from(m.N), UV = Array.from(m.UV);
  const planes = [];
  for (let k = 0; k < 3; k++) {
    if (Number.isFinite(box.min[k])) planes.push({k, sign: -1, d: box.min[k]});
    if (Number.isFinite(box.max[k])) planes.push({k, sign: 1, d: box.max[k]});
  }
  const cache = new Map();
  const before = (a, b) => { for (let k = 0; k < 3; k++) { if (P[3 * a + k] !== P[3 * b + k]) return P[3 * a + k] < P[3 * b + k]; } return a < b; };
  const cut = (a, b, pi) => {
    const key = `${Math.min(a, b)}|${Math.max(a, b)}|${pi}`;
    if (cache.has(key)) return cache.get(key);
    const pl = planes[pi];
    const [lo, hi] = before(a, b) ? [a, b] : [b, a];
    const t = (pl.d - P[3 * lo + pl.k]) / (P[3 * hi + pl.k] - P[3 * lo + pl.k]);
    const v = P.length / 3;
    for (let k = 0; k < 3; k++) P.push(k === pl.k ? pl.d : P[3 * lo + k] + t * (P[3 * hi + k] - P[3 * lo + k]));
    const n = [0, 1, 2].map(k => N[3 * lo + k] + t * (N[3 * hi + k] - N[3 * lo + k])), l = Math.hypot(...n) || 1;
    N.push(n[0] / l, n[1] / l, n[2] / l);
    UV.push(UV[2 * lo] + t * (UV[2 * hi] - UV[2 * lo]), UV[2 * lo + 1] + t * (UV[2 * hi + 1] - UV[2 * lo + 1]));
    cache.set(key, v);
    return v;
  };
  let pending = cand.map(t => [m.I[3 * t], m.I[3 * t + 1], m.I[3 * t + 2]]);
  const outside = [];
  let split = 0;
  planes.forEach((pl, pi) => {
    const next = [];
    for (const poly of pending) {
      const s = poly.map(v => pl.sign * (P[3 * v + pl.k] - pl.d));
      if (s.every(x => x <= 0)) { next.push(poly); continue; }
      if (s.every(x => x >= 0)) { outside.push(poly); continue; }
      split++;
      const inP = [], outP = [];
      for (let i = 0; i < poly.length; i++) {
        const j = (i + 1) % poly.length, a = poly[i], b = poly[j];
        if (s[i] <= 0) inP.push(a);
        if (s[i] >= 0) outP.push(a);
        if ((s[i] < 0 && s[j] > 0) || (s[i] > 0 && s[j] < 0)) { const c = cut(a, b, pi); inP.push(c); outP.push(c); }
      }
      if (inP.length >= 3) next.push(inP);
      if (outP.length >= 3) outside.push(outP);
    }
    pending = next;
  });
  const fan = polys => polys.flatMap(q => q.slice(1, -1).flatMap((v, i) => [q[0], v, q[i + 2]]));
  return {P: Float64Array.from(P), N: Float64Array.from(N), UV: Float64Array.from(UV), inside: fan(pending), outside: fan(outside), splitTriangles: split, planes: planes.length};
}

/** A compact mesh of the triangles I (indices into m), translated by -origin. */
function compact(m, I, origin = [0, 0, 0]) {
  const map = new Map(), P = [], N = [], UV = [], J = new Uint32Array(I.length);
  for (let i = 0; i < I.length; i++) {
    const v = I[i];
    if (!map.has(v)) { map.set(v, P.length / 3); for (let k = 0; k < 3; k++) { P.push(m.P[3 * v + k] - origin[k]); N.push(m.N[3 * v + k]); } UV.push(m.UV[2 * v], m.UV[2 * v + 1]); }
    J[i] = map.get(v);
  }
  return {P: Float32Array.from(P), N: Float32Array.from(N), UV: Float32Array.from(UV), I: J};
}

/** The cooked geometry of one weapon in the centred game frame: rotation, uniform length fit, recorded X factor, centring. */
function toGame(w, m0) {
  const spec = SPEC[w.asset] ?? {};
  const nv = m0.P.length / 3, P = new Float64Array(nv * 3), N = new Float64Array(nv * 3);
  for (let v = 0; v < nv; v++) {
    const turn = spec.turn ? ([x, y, z]) => [-x, y, -z] : q => q; // a half turn about raw Y: the head built at raw +X goes to raw -X
    const p = ROT(turn([m0.P[3 * v], m0.P[3 * v + 1], m0.P[3 * v + 2]])), n = ROT(turn([m0.N[3 * v], m0.N[3 * v + 1], m0.N[3 * v + 2]]));
    for (let k = 0; k < 3; k++) { P[3 * v + k] = p[k]; N[3 * v + k] = n[k]; }
  }
  const b0 = boundsOf(P), s = w.length / (b0.max[2] - b0.min[2]);
  const c0 = [0, 1, 2].map(k => (b0.min[k] + b0.max[k]) / 2);
  for (let v = 0; v < nv; v++) for (let k = 0; k < 3; k++) P[3 * v + k] = (P[3 * v + k] - c0[k]) * s;
  let m = {P, N, UV: m0.UV, I: m0.I};
  // thickness: the probe before / after the recorded X factor (about the centre; normals by the inverse transpose)
  const kx = spec.kx ?? 1;
  const probe = mm => { if (!spec.round) return null; const sl = slab(mm, spec.round); return {n: sl.n, x: r4(sl.max[0] - sl.min[0]), y: r4(sl.max[1] - sl.min[1]), ratioXY: r4((sl.max[0] - sl.min[0]) / (sl.max[1] - sl.min[1]))}; };
  const before = probe(m);
  if (kx !== 1) {
    const cx = (boundsOf(P).min[0] + boundsOf(P).max[0]) / 2;
    for (let v = 0; v < nv; v++) {
      P[3 * v] = cx + (P[3 * v] - cx) * kx;
      const x = N[3 * v] / kx, y = N[3 * v + 1], z = N[3 * v + 2], l = Math.hypot(x, y, z) || 1;
      N[3 * v] = x / l; N[3 * v + 1] = y / l; N[3 * v + 2] = z / l;
    }
  }
  const b1 = boundsOf(P), c1 = [0, 1, 2].map(k => (b1.min[k] + b1.max[k]) / 2);
  for (let v = 0; v < nv; v++) for (let k = 0; k < 3; k++) P[3 * v + k] -= c1[k];
  m = {P, N, UV: m0.UV, I: m0.I};
  const after = probe(m);
  if (after && !spec.widthProbe && (after.ratioXY < ROUND_BAND[0] || after.ratioXY > ROUND_BAND[1])) console.log(`${w.asset}: NOTE thickness probe X/Y ${after.ratioXY} outside ${ROUND_BAND.join(' - ')}`);
  return {m, scale: s, kx, turn: spec.turn ?? null, thickness: {probe: spec.round ?? null, part: spec.roundPart ?? null, before, after, factorX: kx, band: ROUND_BAND, why: spec.kxWhy ?? null}};
}

/** The sorted coordinates along `axis` (0 x / 1 y / 2 z) where a ray at the other two coordinates `at` crosses the mesh's triangles. */
function rayHits(m, axis, at) {
  const [a, b] = [0, 1, 2].filter(k => k !== axis), hits = [];
  for (let f = 0; f < m.I.length; f += 3) {
    const t = [3 * m.I[f], 3 * m.I[f + 1], 3 * m.I[f + 2]];
    const d = (m.P[t[1] + b] - m.P[t[2] + b]) * (m.P[t[0] + a] - m.P[t[2] + a]) + (m.P[t[2] + a] - m.P[t[1] + a]) * (m.P[t[0] + b] - m.P[t[2] + b]);
    if (Math.abs(d) < 1e-16) continue;
    const l0 = ((m.P[t[1] + b] - m.P[t[2] + b]) * (at[0] - m.P[t[2] + a]) + (m.P[t[2] + a] - m.P[t[1] + a]) * (at[1] - m.P[t[2] + b])) / d;
    const l1 = ((m.P[t[2] + b] - m.P[t[0] + b]) * (at[0] - m.P[t[2] + a]) + (m.P[t[0] + a] - m.P[t[2] + a]) * (at[1] - m.P[t[2] + b])) / d, l2 = 1 - l0 - l1;
    if (l0 < 0 || l1 < 0 || l2 < 0) continue;
    hits.push(l0 * m.P[t[0] + axis] + l1 * m.P[t[1] + axis] + l2 * m.P[t[2] + axis]);
  }
  return hits.sort((p, q) => p - q);
}

/** Resolves the marker specs on the centred mesh (see SPEC). */
function resolveMarkers(w, m, specs) {
  const out = {}, rules = {};
  for (const [name, sp] of Object.entries(specs)) {
    if (Array.isArray(sp)) {
      const [x, y0, z] = sp;
      let y = y0, yRule = '';
      if (y0 === 'mid') {
        // the handle axis: a ray along Y through the cross-section's x centre at z (the outermost hits = the section's top / bottom)
        const sl = slab(m, {z: [z - MID_R, z + MID_R]});
        if (!sl.n) throw new Error(`${w.asset} ${name}: no geometry within ${MID_R} m of z ${z}`);
        const hy = rayHits(m, 1, [(sl.min[0] + sl.max[0]) / 2, z]);
        if (hy.length < 2) throw new Error(`${w.asset} ${name}: the Y ray at z ${z} hits ${hy.length} surfaces`);
        y = (hy[0] + hy[hy.length - 1]) / 2; yRule = '; y = the middle of a ray along Y through the cross-section at z (the handle axis)';
      }
      let px = x, rule = 'explicit';
      if (x && typeof x === 'object' && x.mid) {
        const hx = rayHits(m, 0, x.mid);
        if (hx.length < 2) throw new Error(`${w.asset} ${name}: the X probe ray at ${x.mid} hits ${hx.length} surfaces`);
        px = (hx[0] + hx[hx.length - 1]) / 2; rule = `x = the middle of a ray along X at y / z ${JSON.stringify(x.mid)} (the mid-plane there)`;
      } else if (x && typeof x === 'object' && x.right) {
        // the port's opening plane: the right-most surface of a ray along X at a probe point on the receiver side next to the port
        const hx = rayHits(m, 0, x.right);
        if (!hx.length) throw new Error(`${w.asset} ${name}: the X probe ray at ${x.right} hits nothing`);
        px = hx[hx.length - 1]; rule = `x = the right-hand receiver surface (the right-most hit of a ray along X at y / z ${JSON.stringify(x.right)}, beside the port)`;
      } else if (x === 'mid' || x === 'right' || x === 'left') {
        const hx = rayHits(m, 0, [y, z]);
        if (hx.length < 2) throw new Error(`${w.asset} ${name}: the X ray at y ${y} z ${z} hits ${hx.length} surfaces`);
        px = x === 'mid' ? (hx[0] + hx[hx.length - 1]) / 2 : x === 'right' ? hx[hx.length - 1] : hx[0];
        rule = x === 'mid' ? 'x = the middle of a ray along X at y / z (the outermost surfaces: the local mid-plane)' : `x = the ${x}-most surface hit by a ray along X at y / z`;
      }
      out[name] = [px, y, z]; rules[name] = {rule: rule + yRule, spec: sp};
    } else if (sp.front) {
      const range = {...(sp.front.y ? {y: sp.front.y} : {}), ...(sp.front.x ? {x: sp.front.x} : {})};
      const all = slab(m, range);
      const band = slab(m, {...range, z: [all.min[2], all.min[2] + FRONT_BAND]});
      out[name] = [(band.min[0] + band.max[0]) / 2, (band.min[1] + band.max[1]) / 2, all.min[2]];
      rules[name] = {rule: `the front face: z = the minimum z${Object.keys(range).length ? ` within ${JSON.stringify(range)}` : ''}; x / y = the centre of the vertices within ${FRONT_BAND} m of it`, spec: sp, faceVertices: band.n};
    } else if (sp.back) {
      const range = Object.fromEntries(['x', 'y', 'z'].filter(a => sp.back[a]).map(a => [a, sp.back[a]]));
      const all = slab(m, range);
      const band = slab(m, {...range, z: [all.max[2] - FRONT_BAND, all.max[2]]});
      out[name] = [(band.min[0] + band.max[0]) / 2, (band.min[1] + band.max[1]) / 2, all.max[2]];
      rules[name] = {rule: `the rear face: z = the maximum z within ${JSON.stringify(range)}; x / y = the centre of the vertices within ${FRONT_BAND} m of it`, spec: sp, faceVertices: band.n};
    } else throw new Error(`${w.asset} ${name}: bad marker spec`);
  }
  return {markers: out, rules};
}

/**
 * The recorded geometry ops (SPEC.ops), in order, on the centred mesh with a label per triangle ('' = the body, else a part name).
 * Every op is local processing of Meshy's own geometry (UVs / maps untouched):
 *  assign  {name, from?, islands?: {box, expect}, clip?: {box}}  whole islands of label `from` (default the body) lying inside the box and /
 *          or the `from` mesh clipped exactly to the box become label `name`
 *  drop    {islands: {box, expect}}                              whole body islands inside the box are removed (an overlapping duplicate)
 *  scaleX  {name? | islands?: {box, expect}, width? | factor?, centreX?}  the selection's X extent scaled about its own X centre (to `width`
 *          m or by `factor`), then moved to `centreX` when given; normals by the inverse transpose
 *          (clampHalf: the result is clamped to +-clampHalf m about that centre: a thin plate thickened without blowing up a thicker point)
 *  move    {name, by: [dx, dy, dz]}                              the label's (separate) geometry translated rigidly
 *  pair    {name, width, offset}                                 the label's geometry scaled across X to `width`, then duplicated: the two
 *          copies centred `offset` m either side of its X centre (a side-by-side pair from one reconstructed tube; same UVs / maps)
 * Vertices shared across labels (a clip's cut edge) are duplicated per label, so a part moves without tearing the body.
 */
function applyOps(w, m, ops) {
  let P = Array.from(m.P), N = Array.from(m.N), UV = Array.from(m.UV), I = Array.from(m.I);
  let label = new Array(I.length / 3).fill('');
  const recs = [];
  const fail = msg => { throw new Error(`${w.asset}: ${msg}`); };
  const trisOf = l => label.map((x, t) => (x === l ? t : -1)).filter(t => t >= 0);
  const vertsOfTris = tris => { const s = new Set(); for (const t of tris) for (let k = 0; k < 3; k++) s.add(I[3 * t + k]); return [...s].sort((a, b) => a - b); };
  /** whole islands among the triangles `tris` lying inside sel.box: their triangle ids (checked against sel.expect) + a record */
  const pickIslands = (sel, tris) => {
    const sub = {P, I: tris.flatMap(t => [I[3 * t], I[3 * t + 1], I[3 * t + 2]])};
    const hit = islands(sub).filter(o => inBox(o, sel.box));
    const n = hit.reduce((s, o) => s + o.tris.length, 0);
    if (!sel.expect || hit.length !== sel.expect.islands || n !== sel.expect.tris) fail(`islands in the box ${hit.length} / ${n} tris != the recorded ${JSON.stringify(sel.expect)}`);
    return {ids: hit.flatMap(o => o.tris.map(i => tris[i])), rec: {rule: `whole position-connected islands lying inside the box min ${JSON.stringify(sel.box.min)} max ${JSON.stringify(sel.box.max)} (m)`,
      islands: hit.length, triangles: n, bounds: hit.map(o => ({tris: o.tris.length, min: o.min.map(r4), max: o.max.map(r4)}))}};
  };
  /** duplicate the vertices shared by triangles of different labels (the first label keeps the original) */
  const detach = () => {
    const owner = new Map(), copy = new Map();
    for (let t = 0; t < label.length; t++) for (let k = 0; k < 3; k++) {
      const v = I[3 * t + k], l = label[t];
      if (!owner.has(v)) { owner.set(v, l); continue; }
      if (owner.get(v) === l) continue;
      const key = `${v}|${l}`;
      if (!copy.has(key)) { copy.set(key, P.length / 3); P.push(P[3 * v], P[3 * v + 1], P[3 * v + 2]); N.push(N[3 * v], N[3 * v + 1], N[3 * v + 2]); UV.push(UV[2 * v], UV[2 * v + 1]); }
      I[3 * t + k] = copy.get(key);
    }
    return copy.size;
  };
  const scaleVertsX = (verts, k, to, clampHalf = Infinity) => {
    let lo = Infinity, hi = -Infinity;
    for (const v of verts) { lo = Math.min(lo, P[3 * v]); hi = Math.max(hi, P[3 * v]); }
    const c = (lo + hi) / 2, target = to ?? c;
    let clamped = 0, lo2 = Infinity, hi2 = -Infinity;
    for (const v of verts) {
      const d = (P[3 * v] - c) * k;
      if (Math.abs(d) > clampHalf) clamped++;
      P[3 * v] = target + Math.max(-clampHalf, Math.min(clampHalf, d));
      lo2 = Math.min(lo2, P[3 * v]); hi2 = Math.max(hi2, P[3 * v]);
      const x = N[3 * v] / k, y = N[3 * v + 1], z = N[3 * v + 2], l = Math.hypot(x, y, z) || 1;
      N[3 * v] = x / l; N[3 * v + 1] = y / l; N[3 * v + 2] = z / l;
    }
    return {fromWidth: r5(hi - lo), centre: r5(c), toWidth: r5(hi2 - lo2), toCentre: r5(target), ...(Number.isFinite(clampHalf) ? {clampHalf, clampedVertices: clamped, ofVertices: verts.length} : {})};
  };
  /**
   * A thin plate thickened to `T` m across X about its LOCAL mid-surface: per vertex, c / t = the centre / extent of the selection's X
   * coordinates within r (y / z) of it (both faces of the plate), then x' = c + (x - c) * max(1, T / t) (never thinned; a vertex without
   * an opposite face in reach keeps its place); normals by the inverse transpose of its own factor.
   */
  const scaleLocalX = (verts, T, r) => {
    const cell = new Map(), key = (a, b) => `${a},${b}`;
    for (const v of verts) { const a = Math.floor(P[3 * v + 1] / r), b = Math.floor(P[3 * v + 2] / r); const kk = key(a, b); if (!cell.has(kk)) cell.set(kk, []); cell.get(kk).push(v); }
    const local = new Map();
    for (const v of verts) {
      const a = Math.floor(P[3 * v + 1] / r), b = Math.floor(P[3 * v + 2] / r);
      let lo = Infinity, hi = -Infinity;
      for (let da = -1; da <= 1; da++) for (let db = -1; db <= 1; db++) for (const u of cell.get(key(a + da, b + db)) ?? []) {
        if (Math.hypot(P[3 * u + 1] - P[3 * v + 1], P[3 * u + 2] - P[3 * v + 2]) > r) continue;
        lo = Math.min(lo, P[3 * u]); hi = Math.max(hi, P[3 * u]);
      }
      local.set(v, {c: (lo + hi) / 2, t: hi - lo});
    }
    const ts = [...local.values()].map(q => q.t).sort((p, q) => p - q), pct = f => r5(ts[Math.min(ts.length - 1, Math.floor(f * ts.length))]);
    let kept = 0, kMax = 1;
    for (const v of verts) {
      const {c, t} = local.get(v), k = t > 1e-5 ? Math.max(1, T / t) : 1;
      if (k === 1) kept++;
      kMax = Math.max(kMax, k);
      P[3 * v] = c + (P[3 * v] - c) * k;
      const x = N[3 * v] / k, y = N[3 * v + 1], z = N[3 * v + 2], l = Math.hypot(x, y, z) || 1;
      N[3 * v] = x / l; N[3 * v + 1] = y / l; N[3 * v + 2] = z / l;
    }
    return {toThicknessM: T, localR: r, localThicknessBeforeM: {p10: pct(0.1), p50: pct(0.5), p90: pct(0.9)}, maxFactor: r4(kMax), unchangedVertices: kept, ofVertices: verts.length,
      rule: `each vertex moved across X about the plate's LOCAL mid-surface (the centre of the selection's X extent within ${r} m in y / z: both faces) by max(1, ${T} / the local thickness): the plate becomes ~${T * 1000} mm thick where it was thinner, never thinner; normals by the inverse transpose`};
  };
  for (const op of ops) {
    const rec = {op: op.op, why: op.why};
    if (op.op === 'assign') {
      const from = op.from ?? '';
      rec.name = op.name; rec.from = from || 'body';
      if (op.islands) { const r = pickIslands(op.islands, trisOf(from)); for (const t of r.ids) label[t] = op.name; rec.islands = r.rec; }
      if (op.clip) {
        const box = op.clip.box;
        const cand = trisOf(from).filter(t => triCrossesBox({P}, [I[3 * t], I[3 * t + 1], I[3 * t + 2]], box));
        const c = clipBox({P, N, UV, I}, cand, box);
        P = Array.from(c.P); N = Array.from(c.N); UV = Array.from(c.UV);
        const gone = new Set(cand), I2 = [], L2 = [];
        for (let t = 0; t < label.length; t++) if (!gone.has(t)) { I2.push(I[3 * t], I[3 * t + 1], I[3 * t + 2]); L2.push(label[t]); }
        for (let i = 0; i < c.outside.length; i += 3) { I2.push(c.outside[i], c.outside[i + 1], c.outside[i + 2]); L2.push(from); }
        for (let i = 0; i < c.inside.length; i += 3) { I2.push(c.inside[i], c.inside[i + 1], c.inside[i + 2]); L2.push(op.name); }
        I = I2; label = L2;
        rec.clip = {rule: `the ${from || 'body'} mesh clipped to the box min ${JSON.stringify(box.min)} max ${JSON.stringify(box.max)} (m; ${c.planes} finite faces): triangles crossing a face are split exactly along it (interpolated position / normal / UV)`,
          candidateTriangles: cand.length, splitTriangles: c.splitTriangles, insideTriangles: c.inside.length / 3};
      }
      if (!trisOf(op.name).length) fail(`assign ${op.name} selects nothing`);
      rec.detachedVertices = detach();
    } else if (op.op === 'drop') {
      const r = pickIslands(op.islands, trisOf(''));
      const gone = new Set(r.ids), I2 = [], L2 = [];
      for (let t = 0; t < label.length; t++) if (!gone.has(t)) { I2.push(I[3 * t], I[3 * t + 1], I[3 * t + 2]); L2.push(label[t]); }
      I = I2; label = L2; rec.islands = r.rec;
    } else if (op.op === 'scaleX') {
      let tris;
      if (op.name) { tris = trisOf(op.name); rec.name = op.name; } else { const r = pickIslands(op.islands, trisOf('')); tris = r.ids; rec.islands = r.rec; }
      const verts = vertsOfTris(tris);
      let lo = Infinity, hi = -Infinity;
      for (const v of verts) { lo = Math.min(lo, P[3 * v]); hi = Math.max(hi, P[3 * v]); }
      const k = op.width ? op.width / (hi - lo) : op.factor;
      if (op.localR) { rec.scale = scaleLocalX(verts, op.toThickness, op.localR); recs.push(rec); continue; }
      rec.scale = {...scaleVertsX(verts, k, op.centreX, op.clampHalf), factor: r6(k), rule: `the selection's X extent scaled about its own X centre${op.centreX != null ? `, then centred on x = ${op.centreX}` : ''}${op.clampHalf ? `, clamped to +-${op.clampHalf} m about it` : ''}; normals by the inverse transpose`};
    } else if (op.op === 'move') {
      const verts = vertsOfTris(trisOf(op.name));
      if (!verts.length) fail(`move: ${op.name} is empty`);
      for (const v of verts) for (let k = 0; k < 3; k++) P[3 * v + k] += op.by[k];
      rec.name = op.name; rec.move = {byM: op.by, vertices: verts.length, rule: 'a rigid translation of the separate part'};
    } else if (op.op === 'pair') {
      const tris = trisOf(op.name), verts = vertsOfTris(tris);
      // the tube's reference width: its X extent within refZ (the main tube, without the flared breech collar)
      let lo = Infinity, hi = -Infinity;
      for (const v of verts) if (P[3 * v + 2] >= op.refZ[0] && P[3 * v + 2] <= op.refZ[1]) { lo = Math.min(lo, P[3 * v]); hi = Math.max(hi, P[3 * v]); }
      let alo = Infinity, ahi = -Infinity;
      for (const v of verts) { alo = Math.min(alo, P[3 * v]); ahi = Math.max(ahi, P[3 * v]); }
      const c = (lo + hi) / 2, k = op.width / (hi - lo);
      const sc = scaleVertsX(verts, k, c - op.offset, op.width / 2);
      const map = new Map();
      for (const v of verts) { map.set(v, P.length / 3); P.push(P[3 * v] + 2 * op.offset, P[3 * v + 1], P[3 * v + 2]); N.push(N[3 * v], N[3 * v + 1], N[3 * v + 2]); UV.push(UV[2 * v], UV[2 * v + 1]); }
      for (const t of tris) { I.push(map.get(I[3 * t]), map.get(I[3 * t + 1]), map.get(I[3 * t + 2])); label.push(op.name); }
      rec.name = op.name;
      rec.pair = {referenceZ: op.refZ, referenceWidth: r5(hi - lo), fullWidth: r5(ahi - alo), boreLineX: r5(c), tubeWidth: op.width, factorX: r6(k), clampHalf: op.width / 2, clampedVertices: sc.clampedVertices,
        centresX: [r5(c - op.offset), r5(c + op.offset)], trianglesPerTube: tris.length,
        rule: 'the reconstructed single tube scaled across X about the bore line so its main section (referenceZ) is the tube width, its flared breech collar clamped to the same half-width, then two copies centred `offset` either side of the bore line (the side-by-side pair, joined along the rib; together exactly the action\'s width); the copy shares the UVs / maps'};
    } else fail(`unknown op ${op.op}`);
    recs.push(rec);
  }
  return {mesh: {P: Float64Array.from(P), N: Float64Array.from(N), UV: Float64Array.from(UV), I: Uint32Array.from(I)}, label, recs};
}
function triCrossesBox(m, tri, box) {
  const min = [0, 1, 2].map(k => Math.min(...tri.map(v => m.P[3 * v + k]))), max = [0, 1, 2].map(k => Math.max(...tri.map(v => m.P[3 * v + k])));
  return [0, 1, 2].every(k => max[k] >= box.min[k] && min[k] <= box.max[k]);
}
const triList = (mesh, list) => Uint32Array.from(list.flatMap(t => [mesh.I[3 * t], mesh.I[3 * t + 1], mesh.I[3 * t + 2]]));

// ---------- maps ----------
async function cookMaps(w, raw) {
  const out = {}, recs = [];
  for (const slot of SLOTS) {
    const t = raw.textures[slot], img = Buffer.from(t.getImage()), [sw, sh] = t.getSize(), px = TEX[w.kind][slot];
    let bytes, note;
    if (sw === px && sh === px && t.getMimeType() === 'image/jpeg') { bytes = img; note = `Meshy's ${sw} px JPEG, byte-exact`; }
    else {
      bytes = await sharp(img).removeAlpha().resize(px, px, {fit: 'fill', kernel: 'lanczos3'}).jpeg(JPEG[slot]).toBuffer();
      note = `Meshy's ${sw} px map downsized to ${px} (sharp lanczos3, JPEG q${JPEG[slot].quality} ${JPEG[slot].chromaSubsampling})`;
    }
    out[slot] = bytes;
    recs.push({slot, source: {size: [sw, sh], mime: t.getMimeType(), bytes: img.length, sha256: sha(img)}, size: [px, px], mime: 'image/jpeg', bytes: bytes.length, sha256: sha(bytes), note});
  }
  return {images: out, recs};
}

// ---------- cook ----------
const cooked = [], skipped = [];
for (const w of WEAPONS) {
  if (ONLY && !ONLY.includes(w.asset)) continue;
  const rec = records(w);
  if (!rec) { skipped.push(w.asset); continue; }
  const spec = SPEC[w.asset] ?? {};
  const raw = await readRaw(w, rec);
  const rb = boundsOf(raw.m.P), rawExtent = [0, 1, 2].map(k => r4(rb.max[k] - rb.min[k]));
  if (!(rawExtent[0] > rawExtent[1] * 2 && rawExtent[0] > rawExtent[2] * 2)) throw new Error(`${w.asset}: expected the weapon along raw X (${rawExtent})`);
  const welded = weld(raw.m);
  const g = toGame(w, welded.m);
  if (SHOW_ISLANDS) {
    const list = islands(g.m);
    console.log(`${w.asset} islands ${list.length}:`);
    for (const o of list.slice(0, 16)) console.log(`   ${String(o.tris.length).padStart(6)}  min ${o.min.map(r4).join(', ')}  max ${o.max.map(r4).join(', ')}`);
  }
  const ops = applyOps(w, g.m, spec.ops ?? []);
  const {markers: mk0, rules: markerRules} = resolveMarkers(w, ops.mesh, spec.markers ?? {});
  // melee: the pivot at the main hand (Grip = origin)
  if (w.kind === 'melee' && !mk0.Grip && !DRY) throw new Error(`${w.asset}: melee needs a Grip marker`);
  const origin = w.kind === 'melee' && mk0.Grip ? mk0.Grip : [0, 0, 0];
  const markers = Object.fromEntries(Object.entries(mk0).map(([k, p]) => [k, p.map((v, i) => r5(v - origin[i]))]));
  const byLabel = new Map();
  ops.label.forEach((l, t) => { if (!byLabel.has(l)) byLabel.set(l, []); byLabel.get(l).push(t); });
  const nodes = [{name: w.itemId, mesh: compact(ops.mesh, triList(ops.mesh, byLabel.get('') ?? []), origin), translation: [0, 0, 0]}];
  const partRecs = [];
  for (const p of spec.parts ?? []) {
    const tris = byLabel.get(p.name);
    if (!tris?.length) throw new Error(`${w.asset}: part ${p.name} has no triangles`);
    const I = triList(ops.mesh, tris), pb = boundsOf(ops.mesh.P, I);
    let pivot;
    if (p.pivot === 'top') pivot = [(pb.min[0] + pb.max[0]) / 2, pb.max[1], (pb.min[2] + pb.max[2]) / 2];
    else if (p.pivot === 'hinge') { if (!mk0.Hinge) throw new Error(`${w.asset}: ${p.name} pivots about a missing Hinge marker`); pivot = mk0.Hinge; }
    else throw new Error(`${w.asset} ${p.name}: bad pivot`);
    pivot = pivot.map((v, i) => origin[i] + r5(v - origin[i]));
    const at = pivot.map((v, i) => r5(v - origin[i]));
    nodes.push({name: p.name, mesh: compact(ops.mesh, I, pivot), translation: at}); // node translation + local geometry = the model frame
    partRecs.push({name: p.name, why: p.why, pivot: {rule: p.pivot === 'top' ? 'the top centre of the part (x / z centre, max y): the magazine well' : 'the Hinge marker (the break-action axis, parallel to X)', at},
      triangles: I.length / 3, bounds: {min: pb.min.map((v, i) => r4(v - origin[i])), max: pb.max.map((v, i) => r4(v - origin[i]))}});
  }
  if (byLabel.size !== 1 + (spec.parts ?? []).length) throw new Error(`${w.asset}: labels ${[...byLabel.keys()]} != the body + the recorded parts`);
  const maps = await cookMaps(w, raw);
  // ---- the document
  const doc = new Document();
  const buf = doc.createBuffer();
  const tex = Object.fromEntries(SLOTS.map(slot => [slot, doc.createTexture(`weapon-${w.slug}-${slot}`).setImage(new Uint8Array(maps.images[slot])).setMimeType('image/jpeg')]));
  const mt = raw.material;
  const mat = doc.createMaterial(`weapon-${w.slug}`).setBaseColorFactor(mt.baseColorFactor).setMetallicFactor(mt.metallicFactor).setRoughnessFactor(mt.roughnessFactor)
    .setEmissiveFactor(mt.emissiveFactor).setDoubleSided(mt.doubleSided).setAlphaMode(mt.alphaMode)
    .setBaseColorTexture(tex.baseColor).setMetallicRoughnessTexture(tex.metallicRoughness).setNormalTexture(tex.normal).setNormalScale(mt.normalScale);
  for (const [slot, info] of [['baseColor', mat.getBaseColorTextureInfo()], ['metallicRoughness', mat.getMetallicRoughnessTextureInfo()], ['normal', mat.getNormalTextureInfo()]]) {
    const s = raw.sampler[slot];
    info.setWrapS(s.wrapS).setWrapT(s.wrapT); if (s.magFilter != null) info.setMagFilter(s.magFilter); if (s.minFilter != null) info.setMinFilter(s.minFilter);
  }
  const scene = doc.createScene(`weapon-${w.slug}`);
  doc.getRoot().setDefaultScene(scene);
  const acc = (type, a) => doc.createAccessor().setType(type).setArray(a).setBuffer(buf);
  for (const n of nodes) {
    const {P, N, UV, I} = n.mesh;
    const prim = doc.createPrimitive().setMaterial(mat).setAttribute('POSITION', acc('VEC3', P)).setAttribute('NORMAL', acc('VEC3', N)).setAttribute('TEXCOORD_0', acc('VEC2', UV))
      .setIndices(acc('SCALAR', P.length / 3 < 65536 ? Uint16Array.from(I) : Uint32Array.from(I)));
    const node = doc.createNode(n.name).setMesh(doc.createMesh(n.name).addPrimitive(prim));
    if (n.translation.some(v => v !== 0)) node.setTranslation(n.translation);
    scene.addChild(node);
  }
  for (const [name, p] of Object.entries(markers)) scene.addChild(doc.createNode(name).setTranslation(p));
  doc.getRoot().getAsset().generator = `Terminal State ${SELF} (glTF-Transform)`;
  const glb = Buffer.from(await io.writeBinary(doc));
  const json = glb.subarray(20, 20 + glb.readUInt32LE(12)).toString();
  if (/https?:|Signature|X-Amz|token/i.test(json)) throw new Error(`${w.asset}: URL / token-like string inside the glTF JSON`);
  // ---- verify the written bytes + measure on them
  const chk = (await io.readBinary(new Uint8Array(glb))).getRoot();
  if (chk.listMaterials().length !== 1 || chk.listTextures().length !== 3) throw new Error(`${w.asset}: not one material with three maps`);
  const all = {min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity]};
  let tris = 0, verts = 0;
  const partNames = [];
  for (const node of chk.listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    if (node.getName() !== w.itemId) partNames.push(node.getName());
    const M = node.getWorldMatrix(), prim = mesh.listPrimitives()[0], pos = prim.getAttribute('POSITION'), v = [0, 0, 0];
    tris += prim.getIndices().getCount() / 3; verts += pos.getCount();
    for (let i = 0; i < pos.getCount(); i++) { pos.getElement(i, v); for (let k = 0; k < 3; k++) { const q = v[k] + M[12 + k]; all.min[k] = Math.min(all.min[k], q); all.max[k] = Math.max(all.max[k], q); } }
  }
  const length = r4(all.max[2] - all.min[2]);
  if (Math.abs(length - w.length) > 2e-4) throw new Error(`${w.asset}: written length ${length} != ${w.length}`);
  for (const name of Object.keys(markers)) if (!chk.listNodes().some(n => n.getName() === name && !n.getMesh())) throw new Error(`${w.asset}: marker node ${name} missing`);
  const need = w.kind === 'gun' ? ['Grip', 'Muzzle', 'Sight'] : ['Grip', 'Tip'];
  for (const n of need) if (!markers[n]) console.log(`${w.asset}: NOTE marker ${n} not authored yet`);
  if (w.kind === 'melee' && markers.Grip && markers.Grip.some(v => v !== 0)) throw new Error(`${w.asset}: melee Grip is not the origin`);
  const dims = [0, 1, 2].map(k => r4(all.max[k] - all.min[k]));
  cooked.push({w, rec, raw, rawExtent, welded: welded.info, g, opsRecs: ops.recs, markers, markerRules, partRecs, partNames, maps, glb, tris, verts, dims, bounds: {min: all.min.map(r4), max: all.max.map(r4)}, origin});
  console.log(`${w.asset} ${w.itemId}: ${raw.tris} tris -> ${tris} (${partNames.length ? `parts ${partNames.join(', ')}; ` : ''}weld ${welded.info.verticesBefore} -> ${welded.info.verticesAfter} verts), ` +
    `dims ${dims.join(' x ')} m, scale ${r6(g.scale)}${g.kx !== 1 ? ` kx ${g.kx}` : ''}${g.thickness.after ? `, round X/Y ${g.thickness.before.ratioXY} -> ${g.thickness.after.ratioXY} (${g.thickness.after.x} x ${g.thickness.after.y} m)` : ''}; ` +
    `${glb.length} B; maps ${maps.recs.map(t => `${t.slot} ${t.size[0]} ${t.bytes}`).join(', ')}; markers ${Object.entries(markers).map(([k, v]) => `${k} ${v.join(',')}`).join(' | ')}`);
}
if (skipped.length) console.log(`not accepted yet (skipped): ${skipped.join(' ')}`);

// ---------- provenance ----------
const lineOf = l => { const {seq: _s, type: _t, ...rest} = l; return rest; };
const written = new Map();
const guard = (id, b) => { const hit = b.toString().match(/.{0,60}(https?:|Signature|X-Amz|Key-Pair|token=).{0,20}/i); if (hit) throw new Error(`${id}: URL / token-like string in public provenance: ...${hit[0]}...`); return b; };
for (const o of cooked) {
  const {w, rec} = o, a = approved.get(w.asset);
  const url = `assets/models/weapon-${w.slug}.glb`, provRel = `assets/derivatives/weapon-variety-${w.slug}.json`;
  o.url = url;
  const prov = {
    schema: 'terminal-state-derivative-v1', id: `weapon-${w.slug}`, itemId: w.itemId, asset: w.asset, name: w.name, kind: w.kind, family: w.family,
    role: `held / pickup model of the ${w.name} (${w.kind === 'gun' ? a.family : 'melee weapon'}): a weapon-variety ADDITION (the pistol / rifle / shotgun / knife models are unchanged)`,
    task: `${TASK.id} (lane COOK; the model generated by asset lane ${rec.lane} through the task's single broker / ledger)`,
    approval: {userGenerationApprovalSha256: approvalSha, summary: TASK.approvalSummary}, accepted: true, route: TASK.route,
    approvedMaster: {sha256: rec.master.sha256, bytes: rec.master.bytes, revision: a.revision, file: `${relRef(rec.master.file)} (the user-approved side-on concept master, outside Git)`},
    conditioningImage: {sha256: rec.input.sha256, bytes: rec.input.bytes, proof: rec.input.proof === 'approved-master' ? 'the approved master itself (sha256 equal)' : 'a recorded deterministic derivative of the approved master', file: `${relRef(rec.input.file)} (outside Git)`},
    meshy: {tool: rec.reserve.tool, request: (({file_path: _f, ...rest}) => rest)(rec.reserve.params), task: rec.taskId, reservation: rec.res, lane: rec.lane,
      status: rec.settle.status, billedCredits: rec.settle.billed, attemptsForAsset: rec.attemptsForAsset, acceptNote: rec.accept.note || null,
      ledger: {file: `${TASK.dir}/gen/LEDGER.jsonl (outside Git)`, lines: rec.lines, accept: lineOf(rec.accept)}},
    source: {file: `${relT(rec.rawFile)} (raw original, read-only, outside Git; never shipped)`, sha256: rec.raw.sha256, bytes: rec.raw.bytes,
      triangles: o.raw.tris, vertices: o.raw.verts, extent: o.rawExtent, axes: 'muzzle / head at -X, +Y up, the weapon\'s right side (the master\'s visible side) facing -Z',
      material: o.raw.material, maps: o.raw.maps, droppedAttributes: o.raw.extraSemantics},
    processing: {
      weld: {...o.welded, rule: 'exact-attribute weld (bitwise-equal position / normal / uv), degenerate triangles and unreferenced vertices dropped: lossless'},
      simplify: 'none: Meshy\'s triangle count is kept (held-weapon first-person density)',
      rotation: ROT_TEXT, ...(o.g.turn ? {halfTurnFirst: {rotation: 'a half turn about raw Y first: (x, y, z) -> (-x, y, -z)', why: o.g.turn}} : {}), lengthM: w.length, uniformScale: r6(o.g.scale), lengthRule: 'uniform scale so the overall Z extent (muzzle / head to butt / pommel) = the plan\'s real length',
      thickness: o.g.thickness,
      origin: w.kind === 'gun' ? 'the bounding box (all parts) centred on the origin' : `the main hand (Grip) at the origin: the centred frame shifted by ${JSON.stringify(o.origin.map(r5))}`,
      ops: o.opsRecs, parts: o.partRecs, markers: o.markerRules, markerNotes: SPEC[w.asset]?.markerNotes ?? null,
    },
    output: {url, file: `game/public/${url}`, bytes: o.glb.length, sha256: sha(o.glb), triangles: o.tris, vertices: o.verts, dims: o.dims, bounds: o.bounds,
      nodes: {body: w.itemId, parts: o.partNames, markers: Object.keys(o.markers)}, markers: o.markers},
    textures: o.maps.recs,
    texturePolicy: `Meshy's own maps kept slot for slot (base colour / metallic-roughness / normal): ${w.kind === 'gun' ? 'base colour byte-exact 2048 px, metallic-roughness / normal 1024 px' : 'all three 1024 px'} (no recolour, tint, re-texture or projection)`,
    convention: w.kind === 'gun'
      ? 'metres at real size, +Y up, muzzle toward -Z, the right side +X; bounding box centred on the origin; empty marker nodes Grip / Muzzle / Sight / Eject (+ Hinge); part mesh nodes translated to their pivot'
      : 'metres at real size, +Y up, head / blade toward -Z, the right side +X (the master\'s visible side); PIVOT = the main hand: Grip at the origin; empty marker nodes Grip / Tip (+ Grip2 for two-handed weapons)',
    licence: TASK.licence, rebuild: `node ${SELF} [--reference <dir holding tasks/weapon-variety-production-20261109-224355 + the board tasks' masters>]`,
  };
  written.set(url, o.glb);
  written.set(provRel, guard(w.asset, Buffer.from(JSON.stringify(prov, null, 1) + '\n')));
}

// ---------- registry ----------
const vec = v => `[${v.map(x => String(r5(x))).join(', ')}]`;
const registry = `// GENERATED by ${SELF} (task ${TASK.id}) — do not edit.
// The twelve weapon-variety models: Meshy T2.5 image-to-3D from the user-approved side-on concept masters, Meshy's own PBR maps kept (guns:
// base colour 2048 px + metallic-roughness / normal 1024 px; melee: 1024 px). Provenance in assets/derivatives/weapon-variety-*.json.
// Frame (the game's held-weapon convention, as the user guns / knife): metres, +Y up, forward = -Z, the weapon's right side +X.
//  - guns: muzzle toward -Z, bounding box centred on the origin; empty marker nodes Grip (pistol-grip hand) / Muzzle (bore axis at the
//    muzzle face) / Sight (the eye line over the rear sight; the Overwatch: the scope's rear lens) / Eject (the ejection port) in the GLB;
//  - melee: head / blade toward -Z, pivot at the main (rear) hand: Grip = the origin; marker Tip (the reach point) and, for two-handed
//    weapons, Grip2 (the lead hand).
// \`parts\` = named movable mesh nodes for reload / action visuals, each a separate node in the GLB whose translation is its pivot:
// 'Magazine' (pivot = the top centre of the magazine, i.e. the well) and the coach gun's 'Barrels' (barrels + fore-end; pivot = its 'Hinge'
// marker, the break-action axis parallel to X: a rotation.x < 0 drops the muzzles and opens the breech).
import type {VarietyWeaponId} from '../weapons/varietyIds';

export interface WeaponVarietyModel {
  /** User-approved asset id (G01..G06, M01..M06). */
  id: string;
  itemId: VarietyWeaponId;
  kind: 'gun' | 'melee';
  url: string;
  /** Overall length along Z (m). */
  length: number;
  bounds: {min: [number, number, number]; max: [number, number, number]};
  tris: number;
  /** Marker positions in the model frame (the same empty nodes exist in the GLB). */
  markers: Readonly<Record<string, readonly [number, number, number]>>;
  /** Named movable part nodes (empty when the model has none). */
  parts: readonly string[];
}

export const WEAPON_VARIETY_MODELS: Readonly<Partial<Record<VarietyWeaponId, WeaponVarietyModel>>> = {
${cooked.map(o => `  ${o.w.itemId}: {
    id: '${o.w.asset}', itemId: '${o.w.itemId}', kind: '${o.w.kind}', url: '${o.url}', length: ${o.dims[2]},
    bounds: {min: ${vec(o.bounds.min)}, max: ${vec(o.bounds.max)}}, tris: ${o.tris},
    markers: {${Object.entries(o.markers).map(([k, v]) => `${k}: ${vec(v)}`).join(', ')}},
    parts: [${o.partNames.map(p => `'${p}'`).join(', ')}],
  },`).join('\n')}
};
`;

if (DRY) {
  fs.mkdirSync(DRY, {recursive: true});
  for (const [rel, b] of written) fs.writeFileSync(path.join(DRY, path.basename(rel)), b);
  fs.writeFileSync(path.join(DRY, 'weaponVarietyModels.generated.ts'), registry);
  console.log(`dry run: ${written.size} files (${[...written.values()].reduce((t, b) => t + b.length, 0)} B) + registry preview written to ${DRY}${skipped.length ? `; partial: ${skipped.join(' ')} not accepted yet` : ''}`);
  process.exit(0);
}

// the real write: all twelve are cooked (the registry never drops a weapon)
const missing = WEAPONS.filter(w => !cooked.some(o => o.w.asset === w.asset)).map(w => w.asset);
if (missing.length) throw new Error(`refusing the real write: ${missing.join(' ')} not accepted yet (dry-run a partial set instead); nothing written`);
const allowRaw = fs.readFileSync(ALLOW, 'utf8');
const allow = JSON.parse(allowRaw);
if (JSON.stringify(allow, null, 2) + '\n' !== allowRaw) throw new Error('public-inputs.json formatting differs from JSON.stringify(_, null, 2); refusing to rewrite');
const own = new Set(WEAPONS.flatMap(w => [`assets/models/weapon-${w.slug}.glb`, `assets/derivatives/weapon-variety-${w.slug}.json`]));
if ([...written.keys()].some(p => !own.has(p)) || written.size !== own.size) throw new Error('the write set is not exactly the 24 weapon-variety files');
const othersBefore = JSON.stringify(allow.files.filter(f => !own.has(f.path)));
for (const [rel, b] of written) fs.writeFileSync(path.join(PUB, rel), b);
fs.writeFileSync(REG, registry);
allow.files = [...allow.files.filter(f => !own.has(f.path)), ...[...written].map(([p, b]) => ({path: p, bytes: b.length, sha256: sha(b)}))]
  .sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0));
if (JSON.stringify(allow.files.filter(f => !own.has(f.path))) !== othersBefore) throw new Error('a non-weapon-variety allowlist entry changed');
fs.writeFileSync(ALLOW, JSON.stringify(allow, null, 2) + '\n');
console.log(`wrote ${written.size} public files (${[...written.values()].reduce((t, b) => t + b.length, 0)} B) + ${path.relative(root, REG)} + public-inputs.json (${own.size} own entries)`);
