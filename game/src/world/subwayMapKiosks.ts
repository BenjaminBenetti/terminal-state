// Task studio-ui-subway-maps-20261108-074144-01: draws the Subway's STATION MAP KIOSKS (`subwayMapKiosk`, gen/subwayMapKioskKind.ts; placed by
// gen/subwayMapKiosks.ts) — called by world/builder.ts for that kind only (one tagged line). No model file: nothing is loaded for it.
//  - BODY: procedural geometry in the existing shape materials (painted-steel cabinet and plinth, a brushed-steel frame round the panel),
//    instanced per storey (`prop-subwayMapKiosk-<material>`: damage marks / the culler find each instance).
//  - FACE: each kiosk's printed panel — the station plan heads-up from where it stands, its own YOU ARE HERE (world/subwayMapPlan.ts
//    drawKioskFace) — is a cell of ONE atlas canvas for the whole station (a per-layout, runtime-composited DATA texture: the Codex rule's
//    dynamic exemption; nothing here is authored art), the faces merged into one mesh per storey. A station's 2–4 kiosks cost 2 body
//    draws + 1 face draw per storey and one texture.
// Textures and materials are released with the world (the body meshes' dispose event: game.ts leaveSection disposes instanced meshes).
// Every mesh carries userData.level (the level culler).

import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import type {PropPlacement} from '../gen/props';
import type {StationLayout} from '../gen/stationTypes';
import {SUBWAY_MAP_KIOSK as K} from '../gen/subwayMapKioskKind';
import {shapeMaterials} from './shapeMaterials';
import {SurfaceNodeMaterial, type WorldMaterials} from './materials';
import {KIOSK_FACE, drawKioskFace, subwayMapPlan} from './subwayMapPlan';

const box = (w: number, h: number, d: number, x: number, y: number, z: number) => { const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z); return g.toNonIndexed(); };

/** The body parts merged per shape material (prop frame: origin bottom centre, front +Z, back on the wall at -d/2). */
export function subwayMapKioskBody(): {steelDark: THREE.BufferGeometry; steelBright: THREE.BufferGeometry} {
  const plinth = box(K.w + 2 * K.plinthOut, K.plinthH, K.d + K.plinthOut, 0, K.plinthH / 2, K.plinthOut / 2);
  const cab = box(K.w, K.top - K.plinthH, K.d, 0, K.plinthH + (K.top - K.plinthH) / 2, 0);
  const dark = mergeGeometries([plinth, cab], false)!;
  // the frame round the printed panel: four bars standing proud of the cabinet's front
  const f = K.frame, fz = K.d / 2 + 0.008, cy = K.faceY0 + K.faceH / 2;
  const bars = [
    box(K.faceW + 2 * f, f, 0.016, 0, K.faceY0 - f / 2, fz), box(K.faceW + 2 * f, f, 0.016, 0, K.faceY0 + K.faceH + f / 2, fz),
    box(f, K.faceH, 0.016, -(K.faceW + f) / 2, cy, fz), box(f, K.faceH, 0.016, (K.faceW + f) / 2, cy, fz),
  ];
  const bright = mergeGeometries(bars, false)!;
  for (const g of [plinth, cab, ...bars]) g.dispose();
  return {steelDark: dark, steelBright: bright};
}

/** The printed panel (prop frame): uv 0..1 over one face. */
export function subwayMapKioskFaceGeometry(): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(K.faceW, K.faceH);
  g.translate(0, K.faceY0 + K.faceH / 2, K.d / 2 + 0.004);
  return g;
}

const placeM = (p: PropPlacement) => new THREE.Matrix4().compose(new THREE.Vector3(p.x, p.y, p.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.rot), new THREE.Vector3(1, 1, 1));
const hasCanvas = () => typeof document !== 'undefined' && typeof document.createElement === 'function';

/** Build stats of the last call (QA / tests). */
export const SUBWAY_MAP_KIOSK_BUILD = {kiosks: 0, storeys: 0, textures: 0, meshes: 0};

/** Renders the station map kiosks (bodies, the faces from one atlas). Returns the instance count. */
export function buildSubwayMapKiosks(group: THREE.Group, list: readonly PropPlacement[], wm: WorldMaterials, layout?: StationLayout): number {
  Object.assign(SUBWAY_MAP_KIOSK_BUILD, {kiosks: 0, storeys: 0, textures: 0, meshes: 0});
  if (!list.length) return 0;
  const pm = shapeMaterials(wm), body = subwayMapKioskBody();
  const owned: {dispose(): void}[] = [body.steelDark, body.steelBright];
  const add = (o: THREE.Mesh, level: number, name: string) => { o.name = name; o.userData.level = level; group.add(o); SUBWAY_MAP_KIOSK_BUILD.meshes++; return o; };
  // the atlas: one face per kiosk, side by side (the canvas is only drawn where a DOM exists)
  const F = KIOSK_FACE, n = list.length;
  let faceMat: THREE.Material;
  if (hasCanvas() && layout) {
    const plan = subwayMapPlan(layout);
    const c = document.createElement('canvas');
    c.width = F.w * n; c.height = F.h;
    const ctx = c.getContext('2d');
    if (ctx) list.forEach((p, i) => drawKioskFace(ctx, plan, p, i * F.w, 0));
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.anisotropy = 8;
    faceMat = new SurfaceNodeMaterial({map: tex, roughness: 0.35, metalness: 0, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.18});
    owned.push(tex);
    SUBWAY_MAP_KIOSK_BUILD.textures++;
  } else faceMat = new SurfaceNodeMaterial({color: 0xebe6d8, roughness: 0.35, metalness: 0});
  faceMat.name = 'subway-map-kiosk-face';
  owned.push(faceMat);
  const byLevel = new Map<number, number[]>();
  list.forEach((p, i) => { const l = byLevel.get(p.level ?? 0); if (l) l.push(i); else byLevel.set(p.level ?? 0, [i]); });
  const faceGeo = subwayMapKioskFaceGeometry();
  let first: THREE.Object3D | null = null;
  for (const [level, idx] of [...byLevel].sort((a, b) => a[0] - b[0])) {
    SUBWAY_MAP_KIOSK_BUILD.storeys++;
    for (const [key, geo] of [['steelDark', body.steelDark], ['steelBright', body.steelBright]] as const) {
      const im = new THREE.InstancedMesh(geo, pm[key], idx.length);
      idx.forEach((k, j) => im.setMatrixAt(j, placeM(list[k])));
      im.computeBoundingSphere();
      add(im, level, `prop-subwayMapKiosk-${key}`);
      first ??= im;
    }
    // the faces of this storey: one merged mesh, each quad's uv on its kiosk's atlas cell
    const parts = idx.map(k => {
      const g = faceGeo.clone().applyMatrix4(placeM(list[k]));
      const uv = g.getAttribute('uv') as THREE.BufferAttribute;
      for (let v = 0; v < uv.count; v++) uv.setX(v, (k + uv.getX(v)) / n);
      return g;
    });
    const merged = mergeGeometries(parts, false)!;
    for (const g of parts) g.dispose();
    merged.computeBoundingSphere();
    owned.push(merged);
    const mesh = new THREE.Mesh(merged, faceMat);
    mesh.matrixAutoUpdate = false;
    add(mesh, level, `prop-subwayMapKiosk-face-L${level}`);
    SUBWAY_MAP_KIOSK_BUILD.kiosks += idx.length;
  }
  faceGeo.dispose();
  // (the world's release: game.ts leaveSection disposes the instanced meshes -> this build's geometry / textures / materials go with them)
  first?.addEventListener('dispose', () => { for (const o of owned) o.dispose(); owned.length = 0; });
  return list.length;
}
