// Task studio-perf-ao-train-continuity-20261110-022206-01 (lane PLAY, user: "better performance, especially stuttering"): the station
// scene's world matrices ONCE per frame.
//
// three r186 calls `scene.updateMatrixWorld()` at the start of every render of a scene whose `matrixWorldAutoUpdate` is on: in a
// game frame that is the atmosphere's scene pass AND the flashlight's shadow pass nested inside it (and any further pass that draws
// the station scene) — a full traversal of the station each time, recomposing every auto-updating local matrix and multiplying every
// world matrix, although nothing moves between those passes. The game updates the scene once before the frame's render instead and
// turns the automatic update off for that render only (restored after, also on a throw), so every pass sees exactly the matrices
// the first one would have computed. Measured A / B (tests/zz-scratch, Node, three's real WebGPURenderer on a no-op device, 48-frame
// sweeps, interleaved medians): Mall t3a -9.0 / -9.3 %, Subway 7 -2.1 to -4.8 % of three's JavaScript per frame; the same draws with the same
// world matrices on every frame (play-stutter-submit-matrices-once.test.ts). Renders outside the game frame (the warm-up's compiles,
// the journey preparation's off-screen draws, prepareObjects) keep three's own update.
import type * as THREE from 'three';

/**
 * Run `draw` (the frame's render of `scene`) with the scene's world matrices updated once up front and three's per-render update
 * off for its duration. A scene whose automatic update is already off is drawn as is.
 */
export function drawWithSceneMatricesOnce<T>(scene: THREE.Object3D, draw: () => T): T {
  if (!scene.matrixWorldAutoUpdate) return draw();
  scene.updateMatrixWorld();
  scene.matrixWorldAutoUpdate = false;
  try {
    return draw();
  } finally {
    scene.matrixWorldAutoUpdate = true;
  }
}
