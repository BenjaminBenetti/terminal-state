// Pistol staging (targeted pass 2026-10-28, pistol lane).
//
// The pistol's mechanics (item, WeaponDef, ammo, finds, audio mapping) are complete, but its real 3D
// model is still to be made by the user: it will arrive as public/assets/models/pistol.glb with a
// `pistol` ModelKey entry in assets/manifest.ts. Until then the game ships with the RIFLE as the
// starting weapon and the shotgun as a seeded map find, and no pistol appears in normal play.
//
// TO FLIP: add the real pistol.glb + its manifest entry, then set PISTOL_ART_READY = true. The
// pistol becomes the starting weapon and BOTH the rifle and the shotgun become seeded map finds.

import * as THREE from 'three';

/** Staging gate: true only once the user's real pistol model is in the asset manifest. */
export const PISTOL_ART_READY = false;

export type StartWeapon = 'rifle' | 'pistol';

/** Starting weapon: the pistol when its art is ready or in the dev-only `?devpistol=1` mode, else the rifle. */
export function startWeaponFor(devPistol: boolean, artReady: boolean = PISTOL_ART_READY): StartWeapon {
  return artReady || devPistol ? 'pistol' : 'rifle';
}

/** `?devpistol=1` (also with qa=1): browser-test the pistol flow with the internal placeholder. */
export function devPistolRequested(search: string = typeof location === 'undefined' ? '' : location.search): boolean {
  return new URLSearchParams(search).get('devpistol') === '1';
}

/**
 * DEV-ONLY PLACEHOLDER — NOT the user's pistol model and NOT final art. A few authored boxes in one
 * dull flat material, used ONLY when the URL has `?devpistol=1` so the pistol flow can be tested
 * before the real model exists. Never used in normal play. Model space like the gun GLBs: faces -Z,
 * `Grip` and `Muzzle` markers.
 */
export function makePistolDevPlaceholder(): THREE.Group {
  const root = new THREE.Group();
  root.name = 'pistol-dev-placeholder';
  const mat = new THREE.MeshLambertMaterial({color: 0x55585c, name: 'pistol-dev-placeholder-flat'});
  const box = (name: string, w: number, h: number, d: number, x: number, y: number, z: number, rx = 0) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.name = `pistol-dev-placeholder-${name}`;
    m.position.set(x, y, z);
    m.rotation.x = rx;
    root.add(m);
  };
  box('slide', 0.03, 0.032, 0.19, 0, 0.086, -0.06);
  box('frame', 0.028, 0.02, 0.16, 0, 0.062, -0.05);
  box('grip', 0.028, 0.11, 0.045, 0, 0.0, 0.0, 0.25);
  box('guard', 0.006, 0.026, 0.05, 0, 0.04, -0.045);
  box('sight', 0.008, 0.008, 0.012, 0, 0.106, -0.145);
  const grip = new THREE.Object3D();
  grip.name = 'Grip';
  grip.position.set(0, 0.03, 0);
  const muzzle = new THREE.Object3D();
  muzzle.name = 'Muzzle';
  muzzle.position.set(0, 0.086, -0.158);
  root.add(grip, muzzle);
  return root;
}
