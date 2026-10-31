// Task mall-round2-20261031 (Studio Beta, lane PROPS, M03): a CONSOLE BASE under a Meshy console model that came modelled sitting on
// the floor (no regeneration; the raw master is untouched). Pure, deterministic gltf-transform helper used by build-office-overhaul.mjs
// FURNITURE (`consoleBase`) in the manifest frame (front -Z, grounded, centred), measured with CPU component lists / ortho renders.
//
// User: "the big multi screen security system thing, like with 20 screens, appears sitting on the floor and doesn't look natural at
// all" (D31 cctv-console: a 5 x 3 bank of 15 monitors in one cabinet on the rear half of a 9 cm desk slab standing on 4.5 cm corner pads,
// its joystick / keypad / touch panel / radio / gooseneck mic on that slab at floor level — the bottom monitor row at knee height).
// The whole model is lifted by `dy` onto a solid steel console base: one box (its own untextured material, node 'plinth' like the office
// lane-FURN riser) from the toe kick up to the slab's pads, inset from the slab edges, RECESSED at the operator's front (-Z) so the
// desk slab overhangs as a work surface with knee space; under it a lower toe-kick band inset further. Outward-wound, closed faces.
import {getBounds, transformMesh} from '@gltf-transform/functions';

/** Axis-aligned box faces [min, max] -> positions / normals / indices (outward CCW); `skip` = face keys left open (e.g. 'bottom'). */
function boxFaces(min, max, skip, P, N, I) {
  const faces = {right: [0, 1], left: [0, -1], top: [1, 1], bottom: [1, -1], back: [2, 1], front: [2, -1]};
  for (const [key, [ax, sg]] of Object.entries(faces)) {
    if (skip.includes(key)) continue;
    const u = (ax + 1) % 3, v = (ax + 2) % 3, base = P.length / 3;
    for (const [a, b] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
      const q = [0, 0, 0]; q[ax] = sg > 0 ? max[ax] : min[ax]; q[u] = a ? max[u] : min[u]; q[v] = b ? max[v] : min[v];
      P.push(...q); const n = [0, 0, 0]; n[ax] = sg; N.push(...n);
    }
    I.push(...(sg > 0 ? [base, base + 1, base + 2, base, base + 2, base + 3] : [base, base + 2, base + 1, base, base + 3, base + 2]));
  }
}

/**
 * Lifts every mesh by `dy` and adds the base: body x rect.x, z rect.z (z0 = the recessed operator front), y kick.h .. dy; toe kick inset
 * by kick.inset, y 0 .. kick.h. Every corner must lie inside the lifted model's footprint (checked: the slab covers the base). Returns the
 * provenance record.
 */
export function addConsoleBase(doc, {dy, rect, kick = null, color = [0.06, 0.062, 0.068, 1], roughness = 0.7, metallic = 0.25}) {
  const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];
  for (const m of doc.getRoot().listMeshes()) transformMesh(m, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, dy, 0, 1]);
  const b = getBounds(scene);
  const [x0, x1] = rect.x, [z0, z1] = rect.z;
  if (x0 < b.min[0] || x1 > b.max[0] || z0 < b.min[2] || z1 > b.max[2] || x0 >= x1 || z0 >= z1) throw new Error('addConsoleBase: base outside the model footprint');
  const kh = kick?.h ?? 0, ki = kick?.inset ?? 0;
  const P = [], N = [], I = [];
  boxFaces([x0, kh, z0], [x1, dy, z1], kh > 0 ? [] : ['bottom'], P, N, I);
  if (kh > 0) boxFaces([x0 + ki, 0, z0 + ki], [x1 - ki, kh, z1 - ki], ['top', 'bottom'], P, N, I);
  const buf = doc.getRoot().listBuffers()[0];
  const prim = doc.createPrimitive()
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setBuffer(buf).setArray(new Float32Array(P)))
    .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setBuffer(buf).setArray(new Float32Array(N)))
    .setIndices(doc.createAccessor().setType('SCALAR').setBuffer(buf).setArray(new Uint16Array(I)))
    .setMaterial(doc.createMaterial('plinth').setBaseColorFactor(color).setRoughnessFactor(roughness).setMetallicFactor(metallic));
  scene.addChild(doc.createNode('plinth').setMesh(doc.createMesh('plinth').addPrimitive(prim)));
  const r4 = v => +v.toFixed(4);
  return {dy, body: {x: [x0, x1], z: [z0, z1], y: [kh, dy]}, ...(kh > 0 ? {kick: {x: [r4(x0 + ki), r4(x1 - ki)], z: [r4(z0 + ki), r4(z1 - ki)], y: [0, kh]}} : {}),
    frontOverhang: r4(z0 - b.min[2]), tris: I.length / 3, color, roughness, metallic};
}
