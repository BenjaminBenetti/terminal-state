// Task studio-corpse-chipper-fuel-20261110-235304-01: the train CHIPPER'S MODEL CONTRACT — the runtime GLB (a Meshy T2.5 smart-topology
// model from one Codex conditioning design, its own PBR maps kept; cooked by tools/asset-pipeline/props/build-train-chipper.mjs) and the
// anchors the runtime uses (world/chipper.ts). Pure data.
//
// MODEL FRAME (the runtime GLB, metres at runtime size): origin at the bottom centre of the base frame, Y up; +X = the collection-tank
// end, -X = the feed-hopper end; +Z = the FRONT (the face with the rotor housing's inspection grille, the design's side view). The car
// mounts it with its front toward the aisle.
// ANCHORS (model frame): measured from the cooked mesh by the cook (assets/trainChipper.generated.ts replaces these estimates when the
// cooked model lands; the runtime reads CHIPPER_ANCHORS only).

export const CHIPPER_MODEL = {key: 'train-chipper', url: 'assets/models/train-chipper.glb'} as const;

/** Runtime size target (m): length along X, height, depth along Z (the car's bay pocket: <= 1.40 long, <= 0.64 deep, below the sill). */
export const CHIPPER_SIZE = {l: 1.36, h: 0.83, d: 0.62} as const;

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

/** Estimates until the cooked model's measured anchors land. */
export const CHIPPER_ANCHORS: ChipperAnchors = {
  hopper: {x: -0.47, y: 0.78, z: 0},
  hopperMouth: {x: 0.36, z: 0.4},
  outlet: {x: 0.07, y: 0.35, z: 0.2},
  panel: {x: 0.2, y: 0.6, z: 0.24},
};
