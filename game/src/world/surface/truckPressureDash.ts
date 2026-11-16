// Task studio-surface-run-field-followup-20261116-211729-01 (lane TRUCK): THE DASH'S FOG-PRESSURE WARNING — user: "On the truck dash show
// a red blinking light and 'Fog Pressure'". Simple handmade geometry on the handmade dash (world/surface/truckCab.ts merges the dash
// statically; this is its own small group in the cockpit): a lamp housing on the dash top just right of the steering wheel's rim, its
// RED lens toward the driver, and a printed label plate beside it reading FOG PRESSURE (a runtime-drawn label texture: dynamic text,
// the texture rule's exemption; a 1 x 1 data texture without a DOM, so the material is the same either way). The lens blinks through its
// emissive intensity only (never a light or a program change): world/surface/truckConditionRuntime.ts drives it from the pressure at
// the truck (world/surface/truckPressure.ts dashBlinkHz). Placed from the cab's own layout, under the eye's sight line to the
// windscreen's base (tests/surface-truck-pressure.test.ts). Shared materials / geometry live for the truck model's lifetime
// (releaseTruckDash: with the model, at the next build of a world without the truck).

import * as THREE from 'three';
import {TRUCK_ANCHORS} from './truckAnchors.generated';
import {truckCabLayout, truckCabMaterials} from './truckCab';

/** The lamp / label layout (truck frame, m): on the dash top, right of the steering wheel rim, facing the seated eye. */
export function truckDashLayout() {
  const lay = truckCabLayout(), E = TRUCK_ANCHORS.eye, W = TRUCK_ANCHORS.wheelCentre;
  const dashBack = W.z - 0.16, top = lay.dashTop;
  // x: clear of the wheel's rim on the passenger side; z: a little in from the dash's driver-side edge
  const x = lay.wheel.x + lay.wheel.r + 0.06, z = dashBack - 0.035;
  const housing = {x0: x - 0.026, x1: x + 0.026, y0: top, y1: top + 0.032, z0: z - 0.02, z1: z + 0.02};
  const lens = {x, y: top + 0.016, z: z + 0.0215, w: 0.03, h: 0.02};
  const lab = {x: x + 0.026 + 0.012 + 0.07, y: top + 0.004, z, w: 0.14, h: 0.034};
  // the label plate turns (yaw) and tilts up (tilt) to face the seated eye
  const dx = E.x - lab.x, dz = E.z - lab.z, yaw = Math.atan2(dx, dz), tilt = Math.atan2(E.y - lab.y, Math.hypot(dx, dz));
  return {housing, lens, label: {...lab, tilt, yaw}, eye: {x: E.x, y: E.y, z: E.z}};
}

export interface TruckDashView {
  group: THREE.Group;
  lens: THREE.Mesh;
  label: THREE.Mesh;
  /** The lens is lit now (QA / tests). */
  on: boolean;
}

/** The lens when lit (emissive intensity) and its colour. */
export const DASH_LAMP = {color: 0xff2414, on: 5} as const;

const hasCanvas = (): boolean => typeof document !== 'undefined' && typeof document.createElement === 'function';

let shared: {lens: THREE.MeshStandardMaterial; label: THREE.MeshStandardMaterial; labelTex: THREE.Texture; box: THREE.BufferGeometry; plane: THREE.BufferGeometry} | null = null;

/** The label's texture: FOG PRESSURE printed in red on a dark plate (runtime-drawn text; a 1 x 1 data texture without a DOM). */
function labelTexture(): THREE.Texture {
  if (!hasCanvas()) {
    const t = new THREE.DataTexture(new Uint8Array([40, 14, 12, 255]), 1, 1);
    t.needsUpdate = true;
    return t;
  }
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const ctx = c.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#16130f'; ctx.fillRect(0, 0, 256, 64);
    ctx.strokeStyle = '#6b1a12'; ctx.lineWidth = 4; ctx.strokeRect(4, 4, 248, 56);
    ctx.fillStyle = '#e8402c'; ctx.font = 'bold 34px Arial, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('FOG PRESSURE', 128, 34);
  }
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 4;
  return t;
}

function dashShared(): NonNullable<typeof shared> {
  if (shared) return shared;
  const lens = new THREE.MeshStandardMaterial({color: 0x5a0d08, roughness: 0.35, metalness: 0, emissive: DASH_LAMP.color, emissiveIntensity: 0});
  lens.name = 'surface-truck-dash-pressure-lens';
  const labelTex = labelTexture();
  labelTex.colorSpace = THREE.SRGBColorSpace;
  labelTex.name = 'surface-truck-dash-pressure-label';
  const label = new THREE.MeshStandardMaterial({map: labelTex, roughness: 0.8, metalness: 0});
  label.name = 'surface-truck-dash-pressure-label';
  shared = {lens, label, labelTex, box: new THREE.BoxGeometry(1, 1, 1), plane: new THREE.PlaneGeometry(1, 1)};
  return shared;
}

/** The warning group (truck frame; a child of the cockpit: no shadows), its lens dark. */
export function buildTruckDash(): TruckDashView {
  const L = truckDashLayout(), S = dashShared(), M = truckCabMaterials(), g = new THREE.Group();
  g.name = 'surface-truck-dash-pressure';
  S.lens.emissiveIntensity = 0; // (the shared lens: a new view starts dark, whatever the last one showed)
  const H = L.housing;
  const housing = new THREE.Mesh(S.box, M.dash);
  housing.name = 'surface-truck-dash-pressure-housing';
  housing.scale.set(H.x1 - H.x0, H.y1 - H.y0, H.z1 - H.z0);
  housing.position.set((H.x0 + H.x1) / 2, (H.y0 + H.y1) / 2, (H.z0 + H.z1) / 2);
  const lens = new THREE.Mesh(S.plane, S.lens);
  lens.name = 'surface-truck-dash-pressure-lens';
  lens.scale.set(L.lens.w, L.lens.h, 1);
  lens.position.set(L.lens.x, L.lens.y, L.lens.z); // (the housing's face toward the driver: +Z)
  const label = new THREE.Mesh(S.plane, S.label);
  label.name = 'surface-truck-dash-pressure-label';
  label.scale.set(L.label.w, L.label.h, 1);
  // its normal +Z turned toward the seated eye (yaw, then tilted up); the bottom edge resting on the dash top
  const {tilt, yaw} = L.label, up = (L.label.h / 2) * Math.sin(tilt);
  label.rotation.order = 'YXZ';
  label.rotation.set(-tilt, yaw, 0);
  label.position.set(L.label.x - up * Math.sin(yaw), L.label.y + (L.label.h / 2) * Math.cos(tilt), L.label.z - up * Math.cos(yaw));
  for (const m of [housing, lens, label]) { m.userData.carPart = 'cockpit'; m.castShadow = false; g.add(m); }
  return {group: g, lens, label, on: false};
}

/** The lens lit / dark (its emissive intensity only). */
export function setDashLamp(d: TruckDashView | null | undefined, on: boolean): void {
  if (!d || d.on === on) return;
  d.on = on;
  (d.lens.material as THREE.MeshStandardMaterial).emissiveIntensity = on ? DASH_LAMP.on : 0;
}

/** Drop the shared materials / geometry / label texture (with the truck model: a world without the truck). True: something released. */
export function releaseTruckDash(): boolean {
  const s = shared;
  if (!s) return false;
  s.lens.dispose(); s.label.dispose(); s.labelTex.dispose(); s.box.dispose(); s.plane.dispose();
  shared = null;
  return true;
}
