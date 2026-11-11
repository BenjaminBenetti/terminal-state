// Task studio-corpse-chipper-fuel-20261110-235304-01: the train CHIPPER'S MODEL CONTRACT — the runtime GLB (a Meshy T2.5 smart-topology
// model from one Codex conditioning design, its own PBR maps kept; cooked by tools/asset-pipeline/props/build-train-chipper.mjs) and the
// anchors the runtime uses (world/chipper.ts). Pure data.
//
// MODEL FRAME (the runtime GLB, metres at runtime size): origin at the bottom centre of the base frame, Y up; +X = the collection-tank
// end, -X = the feed-hopper end; +Z = the FRONT (the face with the rotor housing's inspection grille and the control box, the design's
// side view). The car mounts it with its front toward the aisle.
// SIZE / ANCHORS (model frame): measured on the cooked mesh by the cook (assets/trainChipper.generated.ts; methods in the provenance
// assets/derivatives/train-chipper.json). The runtime reads CHIPPER_SIZE / CHIPPER_ANCHORS only.
// Hopper shape (TRAIN_CHIPPER_MEASURED.hopper): a box with a floor at ~0.47 m, tall end walls, LOW side lips (~0.53 m, front and back)
// and a top frame at the rim height (~0.78 m: the end-wall peaks and two rails across the box; the rubber flap curtain hangs from the
// front rail). The spout leaves the rotor housing's +X side on the machine's middle plane (z ~0), under the control box.

import {TRAIN_CHIPPER, TRAIN_CHIPPER_ANCHORS, TRAIN_CHIPPER_SIZE} from '../assets/trainChipper.generated';

export const CHIPPER_MODEL = {key: 'train-chipper', url: 'assets/models/train-chipper.glb', bytes: TRAIN_CHIPPER.bytes} as const;

/** Runtime size (m): length along X, height, depth along Z (the car's bay pocket: <= 1.40 long, <= 0.64 deep, below the sill). */
export const CHIPPER_SIZE: {readonly l: number; readonly h: number; readonly d: number} = TRAIN_CHIPPER_SIZE;

export interface ChipperAnchors {
  /** Centre of the hopper's open mouth (at the rim height) — where a fed body goes in. */
  hopper: {x: number; y: number; z: number};
  /** Inner size of the hopper mouth (m): along X, along Z. */
  hopperMouth: {x: number; z: number};
  /** Where the hose leaves the rotor housing — the wet discharge / spray point. */
  outlet: {x: number; y: number; z: number};
  /** The control box face (the stop button / lever): the machine's gauge point. */
  panel: {x: number; y: number; z: number};
}

/** Measured on the cooked model (assets/trainChipper.generated.ts). */
export const CHIPPER_ANCHORS: ChipperAnchors = TRAIN_CHIPPER_ANCHORS;
