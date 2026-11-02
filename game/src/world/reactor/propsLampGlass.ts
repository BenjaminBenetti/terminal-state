// Task reactor-playtest-round2-20261102 (lane PROPS, user bullet 10): "lights have strange box in front of them". THE LAMP GLASS.
//
// Root cause: every Reactor lamp's glass was the station's TUBE instance (world/builder.ts 'light-tubes': a flat box) re-scaled onto
// the lamp. On the flood-lamp model (a caged jelly-jar bulkhead lamp) it became a 0.17 x 0.24 m opaque plate standing 1 cm IN FRONT
// of the cage (the GLB's bounding-box "lens face" at z 0.21, not its glass) — the pale rectangle in the user's screenshot. The
// procedural cages' bulb was a glowing cube, the mines' pendant cages a glowing square under the cage.
//
// Now the glass is a JAR-shaped glow that fits INSIDE each cage: the flood-lamp model's own glass jar (probed from the cooked GLB,
// 2026-11-02: axis (0, 0.101), its glass <= 0.081 off the axis at mid height, the cage bars from r 0.094), the same jar scaled into the
// procedural cages. One InstancedMesh ('light-glass') over the same light indices as the tubes, SHARING the tubes' instanceColor
// attribute and material: world/lights.ts keeps driving the colour per fixture (lit warm glass / circuit 2 held = dark grey glass /
// flicker) — the glass still glows exactly when the baked light does. The tube instance of such a lamp is collapsed (zero scale).
// The cast light, the housings and the circuits are unchanged. One extra draw call per frame (unculled, no shadow).

import * as THREE from 'three';

/** The glass jar (m, the flood-lamp model's frame: front +Z, wall plate at -Z, base y 0). */
export const LAMP_GLASS = {
  /** The model's jar axis (x, z) and the lathe profile [r, y] from its bottom nipple up into the collar (hidden above y 0.2). */
  jar: {x: 0, z: 0.101},
  profile: [[0, 0.008], [0.034, 0.012], [0.062, 0.028], [0.08, 0.052], [0.088, 0.08], [0.088, 0.2], [0.07, 0.214], [0, 0.214]] as const,
  /** Measured: the model's glass at most 0.081 off its axis at mid height, its cage bars from 0.094 — the glow (0.086..0.088) between. */
  glassR: 0.082, cageR: 0.094,
  segments: 16,
  /** The jar in a procedural cage (archMeshes 'cage' 0.26 x 0.34 x 0.26 about the light point): 0.16 x 0.22 m, centred. */
  cage: {sx: 0.16 / 0.176, sy: 0.22 / 0.206, y0: -0.11},
} as const;

/** The jar's outer radius (top of the profile) and height span. */
export const JAR_R = Math.max(...LAMP_GLASS.profile.map(p => p[0]));

/** The jar glow geometry (model metres, base at the jar's bottom, axis +Y through the origin). */
export function lampGlassGeometry(): THREE.BufferGeometry {
  const g = new THREE.LatheGeometry(LAMP_GLASS.profile.map(([r, y]) => new THREE.Vector2(r, y)), LAMP_GLASS.segments);
  g.name = 'reactor-lamp-glass';
  return g;
}

const UP = new THREE.Vector3(0, 1, 0), _q = new THREE.Quaternion();

/** The flood-lamp model's glass, for a model placed at (ox, oy, oz) turned `yaw` (archKit boxMatrix(ox, oy, oz, 1, 1, 1, yaw)). */
export function floodLampGlass(ox: number, oy: number, oz: number, yaw: number): THREE.Matrix4 {
  const c = Math.cos(yaw), s = Math.sin(yaw), J = LAMP_GLASS.jar;
  return new THREE.Matrix4().compose(new THREE.Vector3(ox + J.x * c + J.z * s, oy, oz - J.x * s + J.z * c), _q.setFromAxisAngle(UP, yaw), new THREE.Vector3(1, 1, 1));
}

/** The glass in a procedural cage centred at (x, y, z) (the mounted cage at the light point, the pendant cage below its hanger). */
export function cageGlass(x: number, y: number, z: number, yaw = 0): THREE.Matrix4 {
  const C = LAMP_GLASS.cage;
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y + C.y0, z), _q.setFromAxisAngle(UP, yaw), new THREE.Vector3(C.sx, C.sy, C.sx));
}

/** A collapsed tube instance at the glass (the lamp shows its jar instead of the station's flat tube box). */
export function hiddenLens(glass: THREE.Matrix4): THREE.Matrix4 {
  const p = new THREE.Vector3().setFromMatrixPosition(glass);
  return new THREE.Matrix4().makeScale(0, 0, 0).setPosition(p);
}

/**
 * The lamps' glass: one InstancedMesh over the tubes' light indices (instance i = layout light i; lights without glass are zero
 * scale), sharing the tubes' material and instanceColor so the lighting drives it, and collapsing those lights' tube instances.
 * Returns the mesh (null without tubes or glass).
 */
export function buildLampGlass(group: THREE.Group, tubes: THREE.InstancedMesh | null, glass: ReadonlyMap<number, THREE.Matrix4>): THREE.InstancedMesh | null {
  if (!tubes || !glass.size) return null;
  const idx = [...glass.keys()].filter(i => i >= 0 && i < tubes.count);
  if (!idx.length) return null;
  const n = Math.max(...idx) + 1;
  const im = new THREE.InstancedMesh(lampGlassGeometry(), tubes.material, n);
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  for (let i = 0; i < n; i++) im.setMatrixAt(i, zero);
  for (const i of idx) {
    const m = glass.get(i)!;
    im.setMatrixAt(i, m);
    tubes.setMatrixAt(i, hiddenLens(m));
  }
  tubes.instanceMatrix.needsUpdate = true;
  tubes.computeBoundingSphere();
  // the tubes' colour attribute IS the glass colour (world/lights.ts setColorAt per fixture; the node material syncs on its version)
  if (!tubes.instanceColor) for (let i = 0; i < tubes.count; i++) tubes.setColorAt(i, new THREE.Color(1, 1, 1));
  im.instanceColor = tubes.instanceColor;
  im.name = 'light-glass';
  im.castShadow = im.receiveShadow = false;
  im.frustumCulled = false; // spans every storey of the pit + the mines: one draw, never level-culled (like the hero's site lamps)
  im.computeBoundingSphere();
  im.matrixAutoUpdate = false;
  group.add(im);
  return im;
}
