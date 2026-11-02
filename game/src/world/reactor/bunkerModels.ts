// Task reactor-expansion-20261101 (lane BUNKER): draws the Reactor bunker's HERO PROPS — the lead's Meshy T2.5 models (REACTOR_X_KIT:
// blast door, air filtration unit, radio console, bunk bed; real size, front +Z, grounded, centred; Meshy maps kept) — on their prop
// placements (gen/reactor/complex/bunkerKinds.ts kinds; collision / bullets / sight come from the placements like every prop).
// Instanced: one InstancedMesh per model mesh and storey (userData.level: the level culler hides closed rooms of other storeys), the
// GLB's own materials. Called from the Reactor ARCH build (world/reactor/arch.ts); the models are lazy, level-only library keys
// (archInstall.ts sectionModelKeys -> bunkerModelKeysFor; archAssets.ts reactorModelFiles lists every REACTOR_X_KIT file). A model the
// library could not load (Node tests, a 404) draws nothing — the collision stays (no stand-in box).

import * as THREE from 'three';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import type {PropPlacement} from '../../gen/props';
import type {StationLayout} from '../../gen/stationTypes';
import {BLAST_LEAF, BUNKER_KINDS, BUNKER_MODELS, type BunkerKind} from '../../gen/reactor/complex/bunkerKinds';

export interface BunkerModelStats { instances: number; meshes: number; missing: string[] }

/** Model origin (world x, z) of a placement: the prop centre, except the blast door's leaf-box anchor (variant 0). */
export function bunkerModelOrigin(p: Pick<PropPlacement, 'kind' | 'x' | 'z' | 'rot'>): [number, number] {
  if (p.kind !== 'blastDoor') return [p.x, p.z];
  const c = Math.cos(p.rot), s = Math.sin(p.rot), [lx, lz] = BLAST_LEAF.c;
  // three.js Y rotation: model (x, z) -> world (x cos + z sin, -x sin + z cos)
  return [p.x - (lx * c + lz * s), p.z - (-lx * s + lz * c)];
}

/** The placements a kind's model is drawn on (the blast door: its leaf / anchor part only). */
export function bunkerModelPlacements(layout: Pick<StationLayout, 'props'>, kind: BunkerKind): PropPlacement[] {
  return layout.props.filter(p => p.kind === kind && (kind !== 'blastDoor' || p.variant === 0));
}

export function buildBunkerModels(group: THREE.Group, layout: StationLayout, models: Readonly<Record<string, GLTF | undefined>>): BunkerModelStats {
  const out: BunkerModelStats = {instances: 0, meshes: 0, missing: []};
  const UP = new THREE.Vector3(0, 1, 0);
  for (const kind of BUNKER_KINDS) {
    const list = bunkerModelPlacements(layout, kind);
    if (!list.length) continue;
    const spec = BUNKER_MODELS[kind], gltf = models[spec.model.key];
    if (!gltf) { out.missing.push(kind); continue; }
    const root = gltf.scene;
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root), centre = box.getCenter(new THREE.Vector3());
    // cooked centred / grounded: re-centre on the measured box anyway (x / z centre, min y on the floor), uniform runtime scale
    const fit = new THREE.Matrix4().makeScale(spec.scale, spec.scale, spec.scale).multiply(new THREE.Matrix4().makeTranslation(-centre.x, -box.min.y, -centre.z));
    const byLevel = new Map<number, THREE.Matrix4[]>();
    for (const p of list) {
      const [x, z] = bunkerModelOrigin(p);
      const m = new THREE.Matrix4().compose(new THREE.Vector3(x, p.y, z), new THREE.Quaternion().setFromAxisAngle(UP, p.rot), new THREE.Vector3(1, 1, 1)).multiply(fit);
      const lv = p.level ?? 0;
      let l = byLevel.get(lv);
      if (!l) byLevel.set(lv, (l = []));
      l.push(m);
    }
    root.traverse(o => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const local = mesh.matrixWorld;
      const tmp = new THREE.Matrix4();
      for (const [level, mats] of byLevel) {
        const im = new THREE.InstancedMesh(mesh.geometry, mesh.material, mats.length);
        mats.forEach((m, i) => im.setMatrixAt(i, tmp.multiplyMatrices(m, local)));
        im.name = `reactor-bunker-${kind}`;
        im.userData.level = level;
        im.castShadow = false;
        im.receiveShadow = true;
        im.matrixAutoUpdate = false;
        im.computeBoundingSphere();
        group.add(im);
        out.meshes++;
      }
    });
    out.instances += list.length;
  }
  return out;
}
