// Task studio-market-bar-20261108-225231-01 (lane PEOPLE): the bar patrons' BOTTLE IN HAND — a clone of an item model held in the right
// fist at the drinking clips' grip (market/people/drinkClips.ts bottleGrip), shown only while drinking. The model: the bar's own beer
// (items/beers.ts 'beer_lager') when it has a real model at run time (world/pickups.ts itemTemplate: the BEER lane's model), else the
// existing cola can (models.item_cola, an existing drink model) as the fallback — `source` says which. Shared geometry / materials (the
// item template's); no shadow casting (like the guns in the hostile people's hands).
import * as THREE from 'three';
import {itemModelSources, itemTemplate} from '../../world/pickups';
import type {BottleSpec, HandGrip} from './drinkClips';

/** The beer the patrons drink and the fallback drink. */
export const PATRON_BOTTLE_ITEMS = ['beer_lager', 'cola'] as const;

export interface BottleSource {
  /** A template (never added to a scene: cloned per patron). */
  obj: THREE.Object3D;
  /** The item it is ('beer_lager', or the 'cola' fallback). */
  item: string;
  /** Where the model came from (world/pickups.ts itemModelSources, or the caller's note). */
  source: string;
}

/** Item-template sources that are not a real model (a labelled stand-in / supply box). */
const NOT_A_MODEL = /procedural (supply box|stand-in)/;

/** The patrons' bottle: the beer's model when it exists at run time, else the cola can; null when neither can be built (Node, no DOM). */
export function patronBottle(): BottleSource | null {
  for (const item of PATRON_BOTTLE_ITEMS) {
    try {
      const obj = itemTemplate(item);
      const source = itemModelSources()[item] ?? 'item template';
      if (item !== 'cola' && NOT_A_MODEL.test(source)) continue; // (no beer model yet: the fallback)
      return {obj, item, source};
    } catch { /* (no DOM for a stand-in's label: try the next) */ }
  }
  return null;
}

/** A bottle's height and where the fist holds it (a tall bottle low on its body, a can in its middle), from its bounds. */
export function bottleSpecOf(obj: THREE.Object3D): BottleSpec & {box: THREE.Box3} {
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj);
  const h = Math.max(0.05, box.max.y - box.min.y);
  return {h: +h.toFixed(3), grip: +(h * (h > 0.18 ? 0.36 : 0.5)).toFixed(3), box};
}

/**
 * A holder in `hand` (the right hand bone) with a clone of the bottle: its grip point at the holder's origin, the holder at the hand
 * grip. Hidden until drinking.
 */
export function attachBottle(hand: THREE.Object3D, src: BottleSource, grip: HandGrip): {holder: THREE.Object3D; spec: BottleSpec} {
  const {h, grip: gy, box} = bottleSpecOf(src.obj);
  const model = src.obj.clone(true);
  const cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2;
  model.position.set(model.position.x - cx, model.position.y - box.min.y - gy, model.position.z - cz);
  const holder = new THREE.Group();
  holder.name = `market-bottle-${src.item}`;
  holder.add(model);
  holder.quaternion.copy(grip.rot);
  holder.position.copy(grip.pos);
  holder.visible = false;
  holder.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) { m.castShadow = false; m.receiveShadow = false; } });
  hand.add(holder);
  return {holder, spec: {h, grip: gy}};
}
