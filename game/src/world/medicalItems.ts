// Iteration 16 (lane INJURY): world / held / icon models of the limb-treatment items (items/medical.ts).
//
//  - leg splint, arm sling: the Meshy T2.5 derivatives A7 'med-leg-splint' / A8 'med-arm-sling' (lane ASSETS,
//    assets/officeAssets.ts; front -Z there, turned to the item frame's +Z here) when delivered and preloaded, fitted uniformly
//    into the item's ITEM_DIMS box (same rule as the generated food / drink models, world/pickups.ts fitItemModel). Until a
//    derivative is delivered — or when it fails to load — an authored procedural model of the same size.
//  - trauma kit: authored procedural geometry only (a simple pouch; the asset-method rule's "simple shapes are geometry").
// Nothing here is AI-generated: procedural shapes are THREE primitives, labels are drawn on canvases in code (generic,
// unbranded, worn). Frames follow world/pickups.ts: origin bottom-centre, front +Z, metres. Geometry / materials are shared
// (cached once; templates flag them `userData.shared`); pickups clone materials for their highlight.

import * as THREE from 'three';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {loadOfficeAsset, OFFICE_ASSETS, type OfficeAssetId} from '../assets/officeAssets';
import {ARM_SLING, LEG_SPLINT, LIMB_TREATMENT_IDS, MEDICAL_DIMS, TRAUMA_KIT} from '../items/medical';
import {canvasTexture} from './canvasTextures';

/** Item id -> Meshy derivative (lane ASSETS). The trauma kit has none. */
export const MEDICAL_MODEL_ASSET: Readonly<Record<string, OfficeAssetId>> = {[LEG_SPLINT]: 'med-leg-splint', [ARM_SLING]: 'med-arm-sling'};

export const isMedicalItem = (id: string): boolean => (LIMB_TREATMENT_IDS as readonly string[]).includes(id);

const loaded = new Map<string, GLTF>();
let preload: Promise<void> | null = null;

/**
 * Fetch the delivered Meshy derivatives once (null urls / failures resolve quietly -> procedural). Game.load awaits this
 * before item templates / icons are built, so the world, the hands and the inventory icons all show the same model.
 */
export function preloadMedicalModels(): Promise<void> {
  preload ??= Promise.all(Object.entries(MEDICAL_MODEL_ASSET).map(async ([itemId, asset]) => {
    if (!OFFICE_ASSETS[asset]?.url) return;
    const gltf = await loadOfficeAsset(asset);
    if (gltf) loaded.set(itemId, gltf);
  })).then(() => undefined, () => undefined);
  return preload;
}

/** 'meshy-t2.5 med-leg-splint (A7)' or 'authored procedural geometry' (QA / itemModelSources). */
export function medicalModelSource(itemId: string): string {
  const asset = MEDICAL_MODEL_ASSET[itemId];
  return loaded.has(itemId) && asset ? `office ${asset} (${OFFICE_ASSETS[asset].code}, meshy-t2.5)` : 'authored procedural geometry (world/medicalItems.ts)';
}

/** Uniform fit into the item's dims box (height exact, 25 % slack on w / d like pickups.ts), bottom-centre, front +Z. */
function fitDerivative(gltf: GLTF, itemId: string): THREE.Group {
  const dims = MEDICAL_DIMS[itemId];
  const src = gltf.scene.clone(true);
  src.rotation.y = Math.PI; // derivatives face -Z; item frames face +Z
  const pivot = new THREE.Group();
  pivot.add(src);
  pivot.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(pivot);
  const size = box.getSize(new THREE.Vector3());
  const s = Math.min(dims.h / (size.y || 1), 1.25 * dims.w / (size.x || 1), 1.25 * dims.d / (size.z || 1));
  const c = box.getCenter(new THREE.Vector3());
  pivot.scale.setScalar(s);
  pivot.position.set(-c.x * s, -box.min.y * s, -c.z * s);
  const g = new THREE.Group();
  g.name = `medical-${itemId}`;
  g.add(pivot);
  return g;
}

// ---------------------------------------------------------------------------------------
// Authored procedural models

const mats: Record<string, THREE.Material> = {};
const geos: Record<string, THREE.BufferGeometry> = {};
const mat = (k: string, make: () => THREE.Material) => (mats[k] ??= make());
const geo = (k: string, make: () => THREE.BufferGeometry) => (geos[k] ??= make());

/** Worn grain / scuffs over a canvas label. */
function grime(ctx: CanvasRenderingContext2D, w: number, h: number, r: () => number, n: number): void {
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = `rgba(${r() < 0.5 ? '255,250,240' : '30,24,18'},${0.03 + r() * 0.06})`;
    ctx.fillRect(r() * w, r() * h, 1 + r() * 3, 1 + r() * 2);
  }
  const g = ctx.createLinearGradient(0, h * 0.75, 0, h);
  g.addColorStop(0, 'rgba(40,32,22,0)');
  g.addColorStop(1, 'rgba(40,32,22,0.35)');
  ctx.fillStyle = g;
  ctx.fillRect(0, h * 0.75, w, h * 0.25);
}

/** SAM-style splint roll: orange outer layer, blue inner foam visible as a spiral at the ends, two black velcro straps. */
function splintModel(): THREE.Group {
  const d = MEDICAL_DIMS[LEG_SPLINT];
  const r = d.h / 2, len = d.w * 0.95;
  const side = mat('splint.side', () => new THREE.MeshStandardMaterial({color: 0xffffff, roughness: 0.78, map: canvasTexture(256, 64, 7101, (ctx, w, h, rr) => {
    ctx.fillStyle = '#d4642a'; ctx.fillRect(0, 0, w, h);
    // the foam's dimple pattern + the outer layer's seam
    for (let i = 0; i < 160; i++) { ctx.fillStyle = `rgba(120,40,10,${0.08 + rr() * 0.08})`; ctx.beginPath(); ctx.arc(rr() * w, rr() * h, 1 + rr() * 1.5, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = 'rgba(70,24,8,0.55)'; ctx.fillRect(w * 0.72, 0, 3, h);
    ctx.fillStyle = 'rgba(245,235,220,0.85)'; ctx.font = 'bold 15px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('SPLINT · 36 IN', w * 0.36, h / 2);
    grime(ctx, w, h, rr, 260);
  })}));
  const end = mat('splint.end', () => new THREE.MeshStandardMaterial({color: 0xffffff, roughness: 0.85, map: canvasTexture(128, 128, 7103, (ctx, w, h, rr) => {
    ctx.fillStyle = '#1f2f5e'; ctx.fillRect(0, 0, w, h);
    // rolled layers: orange / blue spiral
    ctx.lineWidth = 5.5;
    for (let k = 0; k < 2; k++) {
      ctx.strokeStyle = k ? '#2c4a9a' : '#d4642a';
      ctx.beginPath();
      for (let a = 0; a < Math.PI * 9; a += 0.08) { const rad = 6 + a * 2.05 + k * 6.4; const x = w / 2 + Math.cos(a) * rad, y = h / 2 + Math.sin(a) * rad; if (a === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
      ctx.stroke();
    }
    grime(ctx, w, h, rr, 90);
  })}));
  const strap = mat('splint.strap', () => new THREE.MeshStandardMaterial({color: 0x1b1c1e, roughness: 0.95}));
  const g = new THREE.Group();
  const body = new THREE.Mesh(geo('splint.body', () => { const c = new THREE.CylinderGeometry(r * 0.97, r * 0.97, len, 24, 1, true); c.rotateZ(Math.PI / 2); return c; }), side);
  body.position.y = r;
  g.add(body);
  for (const sx of [-1, 1]) {
    const cap = new THREE.Mesh(geo(`splint.cap${sx}`, () => { const c = new THREE.CircleGeometry(r * 0.97, 24); c.rotateY(sx * Math.PI / 2); return c; }), end);
    cap.position.set(sx * len / 2, r, 0);
    g.add(cap);
    const band = new THREE.Mesh(geo('splint.strap', () => { const c = new THREE.CylinderGeometry(r, r, len * 0.13, 24); c.rotateZ(Math.PI / 2); return c; }), strap);
    band.position.set(sx * len * 0.26, r, 0);
    g.add(band);
  }
  // the loose strap tab hanging off one band
  const tab = new THREE.Mesh(geo('splint.tab', () => new THREE.BoxGeometry(len * 0.13, 0.004, 0.035)), strap);
  tab.position.set(len * 0.26, 0.004, r * 0.9);
  tab.rotation.x = -0.25;
  g.add(tab);
  return g;
}

/** Sealed sling + wrap packet: a flat printed pouch with the wrap roll making a bulge at one end. */
function slingModel(): THREE.Group {
  const d = MEDICAL_DIMS[ARM_SLING];
  const flatH = d.h * 0.42;
  const label = mat('sling.label', () => new THREE.MeshStandardMaterial({color: 0xffffff, roughness: 0.42, metalness: 0.02, map: canvasTexture(256, 180, 7201, (ctx, w, h, rr) => {
    ctx.fillStyle = '#e9e6dc'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#2b6aa8'; ctx.fillRect(0, 0, w, 34);
    ctx.fillStyle = '#f4f2ea'; ctx.font = 'bold 19px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('ARM SLING + WRAP', w / 2, 17);
    // red cross + the triangle sling diagram
    ctx.fillStyle = '#c4312a'; ctx.fillRect(26, 62, 14, 42); ctx.fillRect(12, 76, 42, 14);
    ctx.strokeStyle = '#3b3f45'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(80, 60); ctx.lineTo(170, 60); ctx.lineTo(125, 128); ctx.closePath(); ctx.stroke();
    ctx.fillStyle = '#3b3f45'; ctx.font = '12px Arial'; ctx.fillText('TRIANGULAR BANDAGE', 125, 146); ctx.fillText('ELASTIC COMPRESSION 7.5 cm', 125, 162);
    ctx.fillStyle = 'rgba(60,60,60,0.5)'; ctx.fillRect(0, h - 10, w, 10);
    grime(ctx, w, h, rr, 300);
  })}));
  const film = mat('sling.film', () => new THREE.MeshStandardMaterial({color: 0xd9d6cc, roughness: 0.35, metalness: 0.02}));
  const wrap = mat('sling.wrap', () => new THREE.MeshStandardMaterial({color: 0xc9b79a, roughness: 0.92}));
  const g = new THREE.Group();
  const w = d.w * 0.98, dd = d.d * 0.96;
  const packet = new THREE.Mesh(geo('sling.packet', () => new THREE.BoxGeometry(w, flatH, dd)), [film, film, label, film, film, film]);
  packet.position.y = flatH / 2;
  g.add(packet);
  // crimped seal edges
  for (const sz of [-1, 1]) {
    const seal = new THREE.Mesh(geo('sling.seal', () => new THREE.BoxGeometry(w * 1.01, flatH * 0.3, 0.012)), film);
    seal.position.set(0, flatH * 0.5, sz * (dd / 2 - 0.004));
    g.add(seal);
  }
  // the compression wrap roll under the film at the +X end
  const rollR = (d.h - flatH * 0.35) / 2;
  const roll = new THREE.Mesh(geo('sling.roll', () => { const c = new THREE.CylinderGeometry(rollR, rollR, dd * 0.82, 18); c.rotateX(Math.PI / 2); return c; }), wrap);
  roll.position.set(w / 2 - rollR - 0.008, rollR + flatH * 0.12, 0);
  g.add(roll);
  return g;
}

/** Zipped olive trauma pouch: rounded body, a cross patch on the lid, a zip line and a grab handle. */
function traumaKitModel(): THREE.Group {
  const d = MEDICAL_DIMS[TRAUMA_KIT];
  const bodyH = d.h * 0.82;
  const lid = mat('trauma.lid', () => new THREE.MeshStandardMaterial({color: 0xffffff, roughness: 0.9, map: canvasTexture(256, 160, 7301, (ctx, w, h, rr) => {
    ctx.fillStyle = '#4c5232'; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 700; i++) { ctx.fillStyle = `rgba(${rr() < 0.5 ? '120,128,90' : '30,32,20'},${0.08 + rr() * 0.1})`; ctx.fillRect(rr() * w, rr() * h, 2, 1); } // nylon weave
    ctx.fillStyle = '#b7322a'; ctx.fillRect(w / 2 - 42, h / 2 - 42, 84, 84); // patch
    ctx.fillStyle = '#ece6d6'; ctx.fillRect(w / 2 - 9, h / 2 - 32, 18, 64); ctx.fillRect(w / 2 - 32, h / 2 - 9, 64, 18);
    ctx.fillStyle = '#ece6d6'; ctx.font = 'bold 14px Arial'; ctx.textAlign = 'center'; ctx.fillText('TRAUMA', w / 2, h - 12);
    grime(ctx, w, h, rr, 200);
  })}));
  const nylon = mat('trauma.side', () => new THREE.MeshStandardMaterial({color: 0x4a5030, roughness: 0.92}));
  const zip = mat('trauma.zip', () => new THREE.MeshStandardMaterial({color: 0x15161a, roughness: 0.6, metalness: 0.3}));
  const g = new THREE.Group();
  const w = d.w * 0.96, dd = d.d * 0.96;
  const body = new THREE.Mesh(geo('trauma.body', () => new THREE.BoxGeometry(w, bodyH, dd)), [nylon, nylon, lid, nylon, nylon, nylon]);
  body.position.y = bodyH / 2;
  g.add(body);
  const zipLine = new THREE.Mesh(geo('trauma.zipline', () => new THREE.BoxGeometry(w * 1.004, 0.006, dd * 1.004)), zip);
  zipLine.position.y = bodyH * 0.72;
  g.add(zipLine);
  // grab handle: a flat webbing loop over the lid
  const handle = new THREE.Mesh(geo('trauma.handle', () => new THREE.TorusGeometry(0.03, 0.006, 6, 14, Math.PI)), nylon);
  handle.position.set(0, bodyH, -dd * 0.32);
  g.add(handle);
  return g;
}

/** A NEW group for a limb-treatment item: the fitted Meshy derivative when preloaded, else the authored model. */
export function medicalItemModel(itemId: string): THREE.Group {
  const gltf = loaded.get(itemId);
  const g = gltf ? fitDerivative(gltf, itemId) : itemId === LEG_SPLINT ? splintModel() : itemId === ARM_SLING ? slingModel() : traumaKitModel();
  g.name ||= `medical-${itemId}`;
  g.userData.medical = itemId;
  return g;
}
