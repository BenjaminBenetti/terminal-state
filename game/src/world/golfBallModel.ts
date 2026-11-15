// Task studio-skywalk-events-20261115-193624-01 (layout version 7, lane GOLF-PLAY): THE GOLF BALL MODEL (items/golfItems.ts) — the world
// pickup / held copy / icon of a mini-golf ball, CODE-BUILT geometry (no generation of any kind, no texture: a plain white satin factor
// material like the other code-built items' factor parts): a regulation 42.7 mm sphere (gen/skyways/events/golfContract.ts GOLF_BALL_R),
// origin at the BOTTOM of the ball (the pickup frame: origin bottom-centre), so physics/dynamicItems.ts sizes its sphere collider from
// these bounds and physics/golfBall.ts golfBallCentre finds the centre at (0, r, 0). Geometry / material are cached once (templates flag
// them `userData.shared`).
import * as THREE from 'three';
import {GOLF_BALL_R} from '../gen/skyways/events/golfContract';

/** Model source line (QA / itemModelSources). */
export const GOLF_BALL_MODEL_SOURCE = 'code-built sphere (world/golfBallModel.ts: plain white, no texture)';

let geo: THREE.BufferGeometry | null = null;
let mat: THREE.MeshStandardMaterial | null = null;

/** A new golf-ball object (shared geometry / material): one white sphere, bottom at y = 0. */
export function golfBallModel(): THREE.Object3D {
  if (!geo) {
    geo = new THREE.SphereGeometry(GOLF_BALL_R, 20, 14).translate(0, GOLF_BALL_R, 0);
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
  }
  mat ??= new THREE.MeshStandardMaterial({color: 0xf1f0ea, roughness: 0.36, metalness: 0});
  const g = new THREE.Group();
  const m = new THREE.Mesh(geo, mat);
  m.name = 'golf_ball';
  g.add(m);
  return g;
}
