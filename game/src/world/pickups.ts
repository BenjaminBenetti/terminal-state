// World pickups and item models. Gun pickups reuse the gun derivatives; med kit / bandage are simple procedural boxes (per the
// asset-method rule for primitive shapes); the ammo boxes are Meshy T2.5 models per caliber (lane AMMO; procedural box fallback). Food and drink use the
// generated item models (`models.item_water` … `models.item_noodles`, lane A) when the manifest
// has them, else labelled procedural stand-ins sized to ITEM_DIMS (bottle, can, carton, bar, bag,
// tin, cup). Every item model: origin bottom-centre, front +Z, real-world size in meters.

import * as THREE from 'three';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {DRINK_IDS, FOOD_IDS, itemDef, itemDims} from '../items/items';
import {AMMO_ITEM_IDS} from '../items/calibers'; // lane AMMO
import type {ItemStack} from '../items/inventory';
import {canvasTexture, pickupLabel, surface} from './canvasTextures';
import {authoredItemModel, isAuthoredItem} from './authoredItems'; // Iteration 12 (LIGHT)
import {isMedicalItem, medicalItemModel, medicalModelSource} from './medicalItems'; // Iteration 16 (lane INJURY)
import {MATERIAL_MODEL_SOURCE, isMaterialItem, materialItemModel} from './materialItems'; // lane RACK (office-props-physics-scale-20261030)
import {gearItemModel, gearModelSource, registerGasMaskOutfit} from '../gear/models'; // Iteration 16 (lane GEAR); mask lane: the outfit gas mask
import {isGearItem} from '../items/gear';
import {isReactorItem, reactorItemModel, reactorItemSource} from './reactor/restartItems'; // task reactor-build-20261101 (lane RESTART)
import {fuelCanModel, fuelCanModelSource} from './fuelCanModel'; // task train-fuel-system-20261106 (lane PORT): the delivered fuel-can GLB (fallback box if not loaded)
import {RAIL_TIES_MODEL_SOURCE, railTiesModel} from './railTiesModel'; // task studio-market-rework-20261108-074144-01 (lane TRADE)
import {RAIL_TIES_ID} from '../items/railTies';
import {isBeer} from '../items/beers'; // task studio-market-bar-20261108-225231-01 (lane BEER)
import {beerModel, beerModelSource} from '../market/beer/beerModel';
import {isPantryItem} from '../items/pantryFood'; // task studio-food-shelf-production-20261109-002816-01 (lane ITEMS)
import {pantryFallbackModel, pantryGltf, pantryModelSource} from './pantryModels';
import {weaponVarietyGltf} from './weaponVarietyModels'; // task studio-weapon-variety-production-20261109-224355-01 (lane LOOT-UI): the lazily loaded new weapons
import {isVarietyWeapon} from '../weapons/varietyIds';
import {Grid} from '../gen/grid';
import type {Levels} from '../gen/levels';
import type {MarketStallId} from '../gen/market/marketTypes';

export interface Pickup {
  id: number;
  stack: ItemStack;
  x: number; y: number; z: number;
  obj: THREE.Object3D;
  mats: THREE.MeshStandardMaterial[];
  /**
   * Iteration 07 (Lane K): this pickup was a loot lot shot off its holder (same item id / count; the
   * lot left the holder): its holder serial and lot id, as provenance (QA / tests).
   */
  fromLot?: {holder: number; lot: number};
  /**
   * Task studio-market-rework-20261108-074144-01 (lane WARES): an OWNED pickup — a market stall's displayed stock (market/wares/wares.ts;
   * the stall's id). It is never the plain [E] Take target (the wares system aims at it and offers a red Steal), never station memory
   * (run/worldMemory.ts capturePickups), never train cargo (world/trainCargo.ts) and never station fuel (world/fuelStations.ts).
   */
  owner?: MarketStallId;
}

// ---------------------------------------------------------------------------------------
// Item models (shared, cached templates)

/**
 * Manifest keys of the generated item models: food / drink (lane A) and, lane AMMO (knife-melee-20261030), the Meshy T2.5 ammo box
 * of each caliber (item_ammo_9mm / item_ammo_556 / item_ammo_12ga; fitted to ITEM_DIMS like the food models). Holder lots, pickups,
 * icons and the warm-up all use the same template; the procedural supply box below stays the fallback if a model is missing.
 */
export const ITEM_MODEL_KEYS: Record<string, string> = Object.fromEntries([...DRINK_IDS, ...FOOD_IDS, ...AMMO_ITEM_IDS].map(id => [id, `item_${id}`]));

let itemModels: Record<string, GLTF | undefined> = {};
const templates = new Map<string, THREE.Object3D>();
const templateSource = new Map<string, string>();

/** Call once after assets load so food/drink use generated models when present. */
export function registerItemModels(models: Record<string, GLTF | undefined>): void {
  itemModels = models;
  registerGasMaskOutfit(models.outfit_gasmask); // task gasmask-breach-20261030 (mask lane): the gas-mask item = the shipped zombie outfit mask (gear/models.ts)
  templates.clear();
  templateSource.clear();
}

/**
 * Task studio-food-shelf-production-20261109-002816-01 (lane ITEMS): drop the cached templates of `ids` (a lazily loaded model arrived:
 * world/pantryModels.ts), so the next pickup / lot batch / held copy / icon uses it. Objects already built keep their old copy.
 */
export function refreshItemTemplates(ids: Iterable<string>): void {
  for (const id of ids) { templates.delete(id); templateSource.delete(id); }
}

/** 'models.item_water (generated)' or 'procedural stand-in' per item id (QA/report). */
export function itemModelSources(): Record<string, string> {
  return Object.fromEntries(templateSource);
}

/** Fits a generated item GLB to its runtime dims: uniform scale, bottom-centre origin. */
function fitItemModel(gltf: GLTF, itemId: string): THREE.Object3D {
  const dims = itemDims(itemId);
  const src = gltf.scene.clone(true);
  src.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(src);
  const size = box.getSize(new THREE.Vector3());
  const s = Math.min(dims.h / (size.y || 1), 1.25 * dims.w / (size.x || 1), 1.25 * dims.d / (size.z || 1));
  const c = box.getCenter(new THREE.Vector3());
  src.scale.setScalar(s);
  src.position.set(-c.x * s, -box.min.y * s, -c.z * s);
  const g = new THREE.Group();
  g.add(src);
  return g;
}

// --- procedural stand-ins: one merged mesh per item, vertex colours + one shared label atlas ---
const CELL_W = 256, CELL_H = 128;
const CELLS: Record<string, number> = {water: 0, cola: 1, juice: 2, chocolate: 3, chips: 4, beans: 5, noodles: 6};
const WHITE_CELL = 7;
let atlas: THREE.CanvasTexture | null = null;
let standinMat: THREE.MeshStandardMaterial | null = null;

function labelAtlas(): THREE.CanvasTexture {
  if (atlas) return atlas;
  atlas = canvasTexture(CELL_W * 2, CELL_H * 4, 3031, (ctx) => {
    const cell = (i: number, bg: string, draw: (x: number, y: number) => void) => {
      const x = (i % 2) * CELL_W, y = Math.floor(i / 2) * CELL_H;
      ctx.save();
      ctx.beginPath(); ctx.rect(x, y, CELL_W, CELL_H); ctx.clip();
      ctx.fillStyle = bg; ctx.fillRect(x, y, CELL_W, CELL_H);
      draw(x, y);
      ctx.restore();
    };
    const text = (s: string, x: number, y: number, size: number, color: string, font = 'bold') => {
      ctx.fillStyle = color; ctx.font = `${font} ${size}px Arial`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(s, x, y);
    };
    cell(0, '#eaf2f6', (x, y) => {
      ctx.fillStyle = '#2f6fb5'; ctx.fillRect(x, y + 92, CELL_W, 36);
      ctx.strokeStyle = '#7fb3dd'; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(x, y + 80); ctx.bezierCurveTo(x + 80, y + 60, x + 170, y + 100, x + 256, y + 74); ctx.stroke();
      text('SPRING', x + 128, y + 30, 30, '#1f4f8a'); text('WATER', x + 128, y + 60, 34, '#1f4f8a');
    });
    cell(1, '#b3201c', (x, y) => {
      ctx.strokeStyle = '#f2ece4'; ctx.lineWidth = 9; ctx.beginPath(); ctx.moveTo(x, y + 96); ctx.bezierCurveTo(x + 70, y + 70, x + 170, y + 122, x + 256, y + 88); ctx.stroke();
      text('COLA', x + 128, y + 48, 54, '#f7f1e8');
    });
    cell(2, '#f08a1c', (x, y) => {
      ctx.fillStyle = '#ffd25a'; ctx.beginPath(); ctx.arc(x + 128, y + 76, 30, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#3f8a2e'; ctx.fillRect(x + 124, y + 40, 8, 10);
      text('ORANGE JUICE', x + 128, y + 22, 26, '#ffffff');
    });
    cell(3, '#4a2617', (x, y) => {
      ctx.fillStyle = '#c99a3c'; ctx.fillRect(x, y + 10, CELL_W, 8); ctx.fillRect(x, y + 110, CELL_W, 8);
      text('CHOCO', x + 128, y + 64, 52, '#e9c46a');
    });
    cell(4, '#e3b01c', (x, y) => {
      ctx.fillStyle = '#c4301e'; ctx.fillRect(x, y + 38, CELL_W, 46);
      text('CHIPS', x + 128, y + 62, 40, '#fff6d8'); text('SEA SALT', x + 128, y + 104, 20, '#7a3a10');
    });
    cell(5, '#efe3c4', (x, y) => {
      ctx.fillStyle = '#3d6b35'; ctx.fillRect(x, y, CELL_W, 22); ctx.fillRect(x, y + 106, CELL_W, 22);
      ctx.fillStyle = '#b5532a'; for (let i = 0; i < 9; i++) { ctx.beginPath(); ctx.ellipse(x + 30 + i * 25, y + 88, 9, 6, 0.4, 0, Math.PI * 2); ctx.fill(); }
      text('BEANS', x + 128, y + 52, 40, '#7a2e14');
    });
    cell(6, '#f4f1ea', (x, y) => {
      ctx.fillStyle = '#c8281f'; ctx.fillRect(x, y + 34, CELL_W, 52);
      text('NOODLES', x + 128, y + 61, 38, '#ffffff'); text('instant', x + 128, y + 108, 22, '#8a1a14', 'italic bold');
    });
    cell(WHITE_CELL, '#ffffff', () => {});
  });
  atlas.wrapS = atlas.wrapT = THREE.ClampToEdgeWrapping;
  return atlas;
}

function sharedStandinMat(): THREE.MeshStandardMaterial {
  standinMat ??= new THREE.MeshStandardMaterial({map: labelAtlas(), vertexColors: true, roughness: 0.55, metalness: 0.05});
  return standinMat;
}

/** Prepares a primitive for merging: vertex colour + UVs remapped into an atlas cell (or white). */
function part(geo: THREE.BufferGeometry, color: number, cell: number | null): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const n = g.attributes.position.count;
  const col = new THREE.Color(cell === null ? color : 0xffffff);
  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.toArray(colors, i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const c = cell ?? WHITE_CELL;
  const u0 = (c % 2) / 2, v0 = 1 - (Math.floor(c / 2) + 1) / 4; // canvas y=0 is the texture top (flipY)
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < n; i++) {
    const u = cell === null ? 0.5 : uv.getX(i), v = cell === null ? 0.5 : uv.getY(i);
    uv.setXY(i, u0 + (0.01 + u * 0.98) / 2, v0 + (0.01 + v * 0.98) / 4);
  }
  if (g !== geo) geo.dispose();
  return g;
}

const cyl = (rTop: number, rBot: number, h: number, y0: number, seg = 14, open = true) => {
  // thetaStart = PI puts u = 0.5 (label centre) at the front (+Z).
  const g = new THREE.CylinderGeometry(rTop, rBot, h, seg, 1, open, Math.PI);
  g.translate(0, y0 + h / 2, 0);
  return g;
};
const disc = (r: number, y: number, up = true, seg = 14) => {
  const g = new THREE.CircleGeometry(r, seg);
  g.rotateX(up ? -Math.PI / 2 : Math.PI / 2);
  g.translate(0, y, 0);
  return g;
};
const box = (w: number, h: number, d: number, x: number, y0: number, z: number) => {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y0 + h / 2, z);
  return g;
};
/** Box with selected faces labelled (BoxGeometry face order px, nx, py, ny, pz, nz). */
function labelBox(w: number, h: number, d: number, y0: number, color: number, cell: number, faces: number[]): THREE.BufferGeometry[] {
  const g = box(w, h, d, 0, y0, 0);
  const out: THREE.BufferGeometry[] = [];
  for (let f = 0; f < 6; f++) {
    const face = new THREE.BufferGeometry();
    for (const name of ['position', 'normal', 'uv'] as const) {
      const a = g.attributes[name] as THREE.BufferAttribute;
      face.setAttribute(name, new THREE.BufferAttribute((a.array as Float32Array).slice(f * 4 * a.itemSize, (f + 1) * 4 * a.itemSize), a.itemSize));
    }
    face.setIndex([0, 2, 1, 2, 3, 1]);
    out.push(part(face, color, faces.includes(f) ? cell : null));
  }
  g.dispose();
  return out;
}

function standinGeometry(itemId: string): THREE.BufferGeometry | null {
  const P: THREE.BufferGeometry[] = [];
  switch (itemId) {
    case 'water': {
      const r = 0.034, clear = 0xa8c6d4;
      P.push(part(cyl(r, r, 0.045, 0), clear, null), part(cyl(r + 0.0006, r + 0.0006, 0.075, 0.045), 0, CELLS.water), part(cyl(r, r, 0.03, 0.12), clear, null));
      P.push(part(cyl(0.014, r, 0.05, 0.15), clear, null), part(cyl(0.013, 0.013, 0.012, 0.2), clear, null), part(cyl(0.016, 0.016, 0.018, 0.212, 12, false), 0x2a62b0, null));
      P.push(part(disc(r, 0, false), clear, null));
      break;
    }
    case 'cola': {
      const r = 0.033, silver = 0xb9bdc1;
      P.push(part(cyl(r, 0.027, 0.008, 0), silver, null), part(cyl(r, r, 0.106, 0.008), 0, CELLS.cola), part(cyl(0.027, r, 0.008, 0.114), silver, null));
      P.push(part(disc(0.027, 0.122), silver, null), part(disc(0.027, 0, false), silver, null), part(box(0.012, 0.002, 0.018, 0, 0.122, 0.008), 0x9a9ea2, null));
      break;
    }
    case 'juice': {
      P.push(...labelBox(0.07, 0.158, 0.07, 0, 0xf08a1c, CELLS.juice, [0, 1, 4, 5]));
      // Gable top: triangular prism along X, apex up, then the sealed fin.
      const r = 0.07 / Math.sqrt(3);
      const roof = new THREE.CylinderGeometry(r, r, 0.07, 3, 1, false, Math.PI / 2);
      roof.rotateZ(Math.PI / 2);
      roof.scale(1, 0.03 / (1.5 * r), 1);
      roof.translate(0, 0.158 + 0.5 * r * (0.03 / (1.5 * r)), 0);
      P.push(part(roof, 0xf3efe6, null), part(box(0.07, 0.008, 0.006, 0, 0.187, 0), 0xf3efe6, null));
      break;
    }
    case 'chocolate':
      P.push(...labelBox(0.136, 0.02, 0.08, 0, 0x4a2617, CELLS.chocolate, [2]));
      P.push(part(box(0.012, 0.016, 0.078, -0.074, 0.002, 0), 0xc9a54a, null), part(box(0.012, 0.016, 0.078, 0.074, 0.002, 0), 0xc9a54a, null));
      break;
    case 'chips': {
      // Pillow bag: flattened cylinder body with crimped top and bottom seams.
      const body = new THREE.CylinderGeometry(1, 1, 0.226, 16, 1, true, Math.PI);
      body.scale(0.096, 1, 0.036);
      body.translate(0, 0.022 + 0.113, 0);
      P.push(part(body, 0, CELLS.chips), part(box(0.2, 0.022, 0.012, 0, 0, 0), 0xc99a18, null), part(box(0.2, 0.022, 0.012, 0, 0.248, 0), 0xc99a18, null));
      const cap = (y: number, up: boolean) => { const g = disc(1, y, up, 16); g.scale(0.096, 1, 0.036); return g; };
      P.push(part(cap(0.248, false), 0xe3b01c, null), part(cap(0.022, true), 0xe3b01c, null));
      break;
    }
    case 'beans': {
      const r = 0.0375, tin = 0xa9adb0;
      P.push(part(cyl(r, r, 0.008, 0), tin, null), part(cyl(r - 0.0005, r - 0.0005, 0.094, 0.008), 0, CELLS.beans), part(cyl(r, r, 0.008, 0.102), tin, null));
      P.push(part(disc(r, 0.11), tin, null), part(disc(r, 0, false), tin, null), part(cyl(0.012, 0.012, 0.003, 0.11, 10, false), 0x8d9194, null));
      break;
    }
    case 'noodles':
      P.push(part(cyl(0.0475, 0.035, 0.095, 0), 0, CELLS.noodles), part(cyl(0.0485, 0.0485, 0.01, 0.095, 16, false), 0xd8d0b8, null), part(disc(0.035, 0.0005, false), 0xf4f1ea, null));
      break;
    default:
      return null;
  }
  const merged = mergeGeometries(P, false);
  for (const g of P) g.dispose();
  merged.computeBoundingSphere();
  return merged;
}

/**
 * Cached template for an item (do not add to a scene; clone it). Shared geometry/materials are
 * flagged `userData.shared` so pickups never dispose them.
 */
export function itemTemplate(itemId: string): THREE.Object3D {
  let t = templates.get(itemId);
  if (t) return t;
  const key = ITEM_MODEL_KEYS[itemId];
  const gltf = key ? itemModels[key] : undefined;
  if (isAuthoredItem(itemId)) {
    // Iteration 12 (LIGHT): battery / road flare are authored procedural geometry (world/authoredItems.ts), never generated.
    t = authoredItemModel(itemId);
    templateSource.set(itemId, 'authored procedural geometry (world/authoredItems.ts)');
  } else if (itemId === 'fuel_can') {
    // task train-fuel-system-20261106 (lane PORT): the delivered Meshy fuel-can GLB (preloaded; Meshy maps kept), else the labelled fallback box
    t = fuelCanModel();
    templateSource.set(itemId, fuelCanModelSource());
  } else if (isReactorItem(itemId)) {
    // task reactor-build-20261101 (lane RESTART): startup key / fuse cartridge — the Meshy kit GLBs (procedural stand-in if one failed to load)
    t = reactorItemModel(itemId);
    templateSource.set(itemId, reactorItemSource(itemId));
  } else if (itemId === RAIL_TIES_ID) {
    // task studio-market-rework-20261108-074144-01 (lane TRADE): Rail Ties — a bundle of tie offcuts code-built from the track sleeper
    t = railTiesModel();
    templateSource.set(itemId, RAIL_TIES_MODEL_SOURCE);
  } else if (isBeer(itemId)) {
    // task studio-market-bar-20261108-225231-01 (lane BEER): the market bar's beers — a code-built long-neck with the beer's own Codex label
    t = beerModel(itemId);
    templateSource.set(itemId, beerModelSource());
  } else if (isMaterialItem(itemId)) {
    // Task office-props-physics-scale-20261030 (lane RACK): crafting materials — authored procedural geometry (world/materialItems.ts)
    t = materialItemModel(itemId);
    templateSource.set(itemId, MATERIAL_MODEL_SOURCE);
  } else if (isMedicalItem(itemId)) {
    // Iteration 16 (lane INJURY): splint / sling = Meshy A7 / A8 when delivered (preloaded), else authored; trauma kit authored
    t = medicalItemModel(itemId);
    templateSource.set(itemId, medicalModelSource(itemId));
  } else if (isGearItem(itemId)) {
    // Iteration 16 (lane GEAR): Meshy T2.5 gear derivative A1-A6 once delivered (preloaded), else a procedural stand-in
    t = gearItemModel(itemId);
    templateSource.set(itemId, gearModelSource(itemId));
  } else if (isPantryItem(itemId)) {
    // task studio-food-shelf-production-20261109-002816-01 (lane ITEMS): the pantry foods / drinks — the cook's Meshy model once
    // world/pantryModels.ts fetched it (lazy, per level), fitted like every food model; until then a plain labelled fallback primitive
    const g = pantryGltf(itemId);
    t = g ? fitItemModel(g as GLTF, itemId) : pantryFallbackModel(itemId);
    templateSource.set(itemId, pantryModelSource(itemId));
  } else if (gltf) {
    t = fitItemModel(gltf, itemId);
    templateSource.set(itemId, `models.${key} (generated)`);
  } else {
    const geo = standinGeometry(itemId);
    if (geo) {
      t = new THREE.Group();
      t.add(new THREE.Mesh(geo, sharedStandinMat()));
      templateSource.set(itemId, 'procedural stand-in');
    } else {
      t = legacySupplyMesh(itemId);
      templateSource.set(itemId, 'procedural supply box');
    }
  }
  t.updateMatrixWorld(true);
  t.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) m.userData.shared = true; });
  templates.set(itemId, t);
  return t;
}

/** A world/viewmodel copy of an item (shares geometry and materials with the cached template). */
export function makeSupplyMesh(itemId: string): THREE.Object3D {
  return itemTemplate(itemId).clone(true);
}

function legacySupplyMesh(itemId: string): THREE.Object3D {
  const g = new THREE.Group();
  // Iteration 04 (Lane C): untinted label faces keep their label; every other face gets the shared worn
  // plastic/card grain (mesh UVs, since pickups move), tinted by its colour.
  const std = (o: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial({roughness: 0.7, map: surface('plastic').map, ...o});
  if (itemId === 'ammo_556') {
    const label = pickupLabel('5.56', '#59603f', '#e9e1c8', 11);
    const side = std({color: 0x4c5236});
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.12, 0.16), [side, side, std({color: 0x5d6442}), side, std({map: label}), side]);
    m.position.y = 0.06;
    g.add(m);
  } else if (itemId === 'ammo_9mm') {
    // Pistol lane: small 9 mm carton (procedural supply box like the rifle/shell ones).
    const label = pickupLabel('9MM', '#5a5146', '#efe6cf', 12);
    const side = std({color: 0x4f473d});
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.08, 0.11), [side, side, std({color: 0x5f564a}), side, std({map: label}), side]);
    m.position.y = 0.04;
    g.add(m);
  } else if (itemId === 'ammo_12ga') {
    const label = pickupLabel('12 GA', '#7d2c22', '#efe2c4', 12);
    const side = std({color: 0x6b261d});
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.1, 0.13), [side, side, std({color: 0x7d2c22}), side, std({map: label}), side]);
    m.position.y = 0.05;
    g.add(m);
    for (let i = 0; i < 3; i++) {
      const shell = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.07, 8), std({color: 0xa33a2a}));
      shell.rotation.z = Math.PI / 2;
      shell.position.set(-0.05 + i * 0.04, 0.012, 0.11);
      g.add(shell);
    }
  } else if (itemId === 'medkit') {
    const label = pickupLabel('', '#2f7d4f', '#f2f0e6', 13, true);
    const side = std({color: 0x29704a});
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.12, 0.22), [side, side, std({map: label}), side, std({map: label}), side]);
    m.position.y = 0.06;
    g.add(m);
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.02, 0.03), std({color: 0x1d1f21}));
    handle.position.set(0, 0.13, 0);
    g.add(handle);
  } else if (itemId === 'bandage') {
    const roll = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.1, 16), std({color: 0xe6dfcc, roughness: 0.95}));
    roll.rotation.z = Math.PI / 2;
    roll.position.y = 0.045;
    g.add(roll);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.047, 0.047, 0.02, 16), std({color: 0x2f7d4f}));
    band.rotation.z = Math.PI / 2;
    band.position.y = 0.045;
    g.add(band);
  } else {
    g.add(new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), std({color: 0x888888})));
  }
  return g;
}

export class PickupManager {
  readonly group = new THREE.Group();
  readonly list: Pickup[] = [];
  private nextId = 1;
  private highlighted: Pickup | null = null;
  /**
   * Task studio-market-rework-20261108-074144-01 (lane WARES): the owned pickup the wares system has under the crosshair (it aims at owned
   * pickups itself: `target` skips them) — drawn with the same look-at highlight.
   */
  hover: Pickup | null = null;

  constructor(private readonly guns: Record<string, GLTF>) {
    this.group.name = 'pickups';
  }

  /** The object an item is drawn with (a gun on its side, else the shared item template's copy). Task train-loose-cargo: also its riding cargo. */
  meshFor(itemId: string): THREE.Object3D {
    const def = itemDef(itemId);
    // (task studio-weapon-variety-production-20261109-224355-01, lane LOOT-UI: + the twelve new weapons once their lazy model is resident —
    // world/weaponVarietyModels.ts; its meshes are flagged userData.shared, so remove() never disposes them)
    const model = def.kind === 'weapon' ? this.guns[itemId] ?? weaponVarietyGltf(itemId) : undefined;
    if (model) {
      // Lay the gun on its side: muzzle along -X, detailed side facing up.
      const wrap = new THREE.Group();
      const gun = model.scene.clone(true);
      gun.rotation.set(0, Math.PI / 2, Math.PI / 2);
      wrap.add(gun);
      wrap.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(gun);
      gun.position.y -= box.min.y;
      gun.position.x -= (box.min.x + box.max.x) / 2;
      gun.position.z -= (box.min.z + box.max.z) / 2;
      return wrap;
    }
    return makeSupplyMesh(itemId);
  }

  /**
   * Iteration 07 (Lane K): a pickup at an exact world transform (model frame: origin bottom-centre,
   * front +Z) — e.g. a loot lot lifted off its shelf lying on its side. The targeting anchor is the
   * transformed model centre.
   */
  addAt(stack: ItemStack, matrix: THREE.Matrix4, fromLot?: {holder: number; lot: number}): Pickup {
    const pos = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
    matrix.decompose(pos, q, sc);
    const p = this.add(stack, pos.x, pos.y, pos.z, 0);
    p.obj.quaternion.copy(q);
    p.obj.updateMatrix();
    if (fromLot) p.fromLot = fromLot;
    return p;
  }

  /** The object a pickup of `itemId` is drawn with and its OWN material copies (the glint / look-at highlight write their emissive). */
  private build(itemId: string): {obj: THREE.Object3D; mats: THREE.MeshStandardMaterial[]} {
    const obj = this.meshFor(itemId);
    const mats: THREE.MeshStandardMaterial[] = [];
    obj.traverse(o => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const list = Array.isArray(m.material) ? m.material : [m.material];
      const cloned = list.map(mm => { const c = (mm as THREE.MeshStandardMaterial).clone(); mats.push(c); return c; });
      m.material = Array.isArray(m.material) ? cloned : cloned[0];
    });
    return {obj, mats};
  }

  /**
   * Task studio-perf-ao-train-continuity-20261110-022206-01 (lane PLAY): the meshes of a pickup of every item in `ids`, exactly as add()
   * makes them (meshFor + its own material copies, the pickup's flags), for the runtime-variant pool (render/runtimeVariants.ts, family
   * 'pickup': one hidden prototype per draw variant). A pickup that appears in play — a dropped item, a lot shot off its holder, a
   * stolen ware — is a NEW non-instanced object: unless a pickup with the same material values and geometry layout lay in the station
   * when it was warmed up, its first frame built a node variant and asked for a pipeline (first-use census over the item registry, in
   * Node: 6 to 45 builds per level kind). Each mesh carries its world matrix inside the pickup (a mirrored model part keeps its
   * winding in the pipeline key) and never answers a ray. Pure: nothing joins `list` or the group. `materials` are the copies made
   * here (the pool releases them with the world). The twelve variety weapons are left to their own pool (world/weaponVarietyModels.ts).
   */
  pickupPrototypes(ids: Iterable<string>): {meshes: THREE.Mesh[]; materials: THREE.Material[]} {
    const meshes: THREE.Mesh[] = [], materials: THREE.Material[] = [];
    for (const id of new Set(ids)) {
      if (isVarietyWeapon(id)) continue;
      const {obj, mats} = this.build(id);
      materials.push(...mats);
      obj.updateMatrixWorld(true);
      obj.traverse(o => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        m.matrix.copy(m.matrixWorld);
        m.matrixAutoUpdate = false;
        m.name = `pickup-${id}${m.name ? `-${m.name}` : ''}`;
        m.raycast = () => {};
        meshes.push(m);
      });
    }
    return {meshes, materials};
  }

  add(stack: ItemStack, x: number, y: number, z: number, yaw = 0): Pickup {
    const {obj, mats} = this.build(stack.itemId);
    obj.position.set(x, y, z);
    obj.rotation.y = yaw;
    this.group.add(obj);
    const p: Pickup = {id: this.nextId++, stack, x, y, z, obj, mats};
    this.list.push(p);
    return p;
  }

  remove(p: Pickup): void {
    const i = this.list.indexOf(p);
    if (i >= 0) this.list.splice(i, 1);
    this.group.remove(p.obj);
    p.obj.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh && !m.userData.shared && !this.isShared(m)) m.geometry.dispose(); });
    for (const m of p.mats) m.dispose();
    if (this.highlighted === p) this.highlighted = null;
    if (this.hover === p) this.hover = null;
  }

  private isShared(m: THREE.Mesh): boolean {
    for (const g of Object.values(this.guns)) {
      let shared = false;
      g.scene.traverse(o => { if ((o as THREE.Mesh).geometry === m.geometry) shared = true; });
      if (shared) return true;
    }
    return false;
  }

  clear(): void {
    for (const p of [...this.list]) this.remove(p);
  }

  /**
   * Task office-seamless (lane LIFT): loose items lying inside the moving elevator cab ride its dy (anchor + model). A
   * pickup that is simulating as a physics body is carried with its body and re-synced from it right after.
   */
  /** Lane LIFT: loose items in a doorway the landing doors shut on go to the nearer side (`move` -> new x / z, or null). */
  relocate(move: (x: number, y: number, z: number) => [number, number] | null): number {
    let n = 0;
    for (const p of this.list) {
      const to = move(p.x, p.y + 0.05, p.z);
      if (!to) continue;
      p.obj.position.x += to[0] - p.x; p.obj.position.z += to[1] - p.z;
      p.x = to[0]; p.z = to[1];
      p.obj.updateMatrix();
      n++;
    }
    return n;
  }

  carry(inside: (x: number, y: number, z: number) => boolean, dy: number): number {
    let n = 0;
    for (const p of this.list) {
      if (!inside(p.x, p.y, p.z)) continue;
      p.y += dy;
      p.obj.position.y += dy;
      p.obj.updateMatrix();
      n++;
    }
    return n;
  }

  /**
   * Best pickup the player is looking at (or standing over), within reach and in sight.
   * Iteration 08 (Lane B): with the station Levels the sight test is 3D from the eye to the item
   * (a slab / stair flight between them hides it; 15 cm slack for items lying on stair treads).
   */
  target(eye: THREE.Vector3, dir: THREE.Vector3, world: Grid | Levels): Pickup | null {
    const grid = world instanceof Grid ? world : null;
    const levels = grid ? null : (world as Levels);
    let best: Pickup | null = null, bestScore = Infinity;
    const v = new THREE.Vector3();
    for (const p of this.list) {
      if (p.owner) continue; // (lane WARES: a stall's ware is aimed at by market/wares — never a plain Take)
      v.set(p.x - eye.x, p.y + 0.08 - eye.y, p.z - eye.z);
      const d = v.length();
      if (d > 2.6) continue;
      const ang = Math.acos(Math.max(-1, Math.min(1, v.dot(dir) / d)));
      const flat = Math.hypot(p.x - eye.x, p.z - eye.z);
      const ok = ang < 0.32 || (flat < 1.0 && ang < 1.0);
      if (!ok) continue;
      if (grid ? !grid.lineOfSight(eye.x, eye.z, p.x, p.z) : !levels!.lineOfSight(eye, {x: p.x, y: p.y + 0.08, z: p.z}, {slack: 0.15})) continue;
      const score = ang + d * 0.08;
      if (score < bestScore) { bestScore = score; best = p; }
    }
    if (best !== this.highlighted) {
      if (this.highlighted) for (const m of this.highlighted.mats) m.emissive?.setRGB(0, 0, 0);
      this.highlighted = best;
    }
    return best;
  }

  update(t: number): void {
    // Readability in dark rooms: a faint warm self-glow plus a brief, staggered glint every few
    // seconds, so supplies read as silhouettes without a flashlight. The look-at highlight is stronger.
    for (const p of this.list) {
      if (p === this.highlighted || p === this.hover) continue;
      const s = Math.sin(t * 2.2 + p.id * 2.39);
      const k = 0.035 + (s > 0.9 ? (s - 0.9) * 1.3 : 0);
      for (const m of p.mats) m.emissive?.setRGB(k, k * 0.9, k * 0.72);
    }
    for (const hl of [this.highlighted, this.hover]) {
      if (!hl) continue;
      const k = 0.12 + 0.08 * Math.sin(t * 6);
      for (const m of hl.mats) m.emissive?.setRGB(k, k * 0.85, k * 0.5);
    }
  }
}
