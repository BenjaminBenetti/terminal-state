// Pistol staging (targeted pass 2026-10-28, pistol lane).
//
// The pistol's mechanics (item, WeaponDef, ammo, finds, audio mapping) were staged ahead of its art. The user's real
// pistol model is now in: public/assets/models/pistol.glb with the `pistol` ModelKey entry in assets/manifest.ts
// (derivatives/user-weapons-20261028.json). With PISTOL_ART_READY the pistol is the starting weapon in normal play and
// BOTH the rifle and the shotgun are seeded map finds; no URL flag is needed.

import * as THREE from 'three';

/** Staging gate: true now that the user's real pistol model (pistol.glb) is in the asset manifest. */
export const PISTOL_ART_READY = true;

export type StartWeapon = 'rifle' | 'pistol';

/** Starting weapon: the pistol when its art is ready (or in the legacy dev-only `?devpistol=1` mode), else the rifle. */
export function startWeaponFor(devPistol: boolean, artReady: boolean = PISTOL_ART_READY): StartWeapon {
  return artReady || devPistol ? 'pistol' : 'rifle';
}

/** Legacy `?devpistol=1` flag (no longer needed: the pistol starts by default now that its art is ready). */
export function devPistolRequested(search: string = typeof location === 'undefined' ? '' : location.search): boolean {
  return new URLSearchParams(search).get('devpistol') === '1';
}

/**
 * DEV-ONLY PLACEHOLDER — NOT the user's pistol model and NOT final art. A few authored boxes in one dull flat
 * material, kept only for the pre-art staging path (game.ts uses it solely if PISTOL_ART_READY were false and the URL
 * had `?devpistol=1`). Never used while the real pistol.glb is loaded. Model space like the gun GLBs: faces -Z,
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
