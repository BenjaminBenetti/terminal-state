// Task studio-surface-host-ground-connectors-20261118-053602-01: the Office / Mall CONNECTOR TUBE's view — the one rigid canvas tube
// (gen/surface/connectorShape.ts CONNECTOR) drawn at a world's record (gen/surface/surfaceTypes.ts SurfaceConnector). Handmade simple
// geometry in existing finishes only: the command tent's own canvas (the Office 'cubicle-fabric' set the tent's 'surface-canvas' uses,
// tinted darker), the shared procedural timber / painted-steel sets (world/canvasTextures.ts) and the cargo kit's lamp finish — no new
// texture or asset. The name plate over the district's host mouth is runtime text (the host's own name: dynamic, per run).
//  - THE SHELL: low arched canvas (side walls to the eaves, a shallow arc to the crown) sagging a little between steel hoops, a skirt
//    reaching under the floor; duckboards on a dark groundsheet; a caged work lamp hanging mid-way.
//  - THE MOUTHS: a heavier hoop, a fixed canvas header over the clear opening, and a ROLL-UP FLAP (setFlap: 0 shut .. 1 rolled up).
//  - THE HOST WORLD only (end 'host'): a collar of canvas closing the host's street opening round the tube (the Mall's door set is wider).
//  - THE DISTRICT only (end 'tent'): the host's name plate on its facade over the host mouth.
// Lit like the cargo car: its finishes carry the lamp's dim light themselves (a self-glow in their own colour) — the tube reads the same
// in both worlds and across the crossing (no fixture light, no light-set change); the flashlight lights it as anything else.
// Layout: one Group at the record's floor point turned by its yaw (local x = t, local z = -s, y up); one merged mesh per material.

import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {CONNECTOR} from '../../gen/surface/connectorShape';
import type {SurfaceConnector} from '../../gen/surface/surfaceTypes';
import {loadOfficeTexture} from '../../assets/officeAssets';
import {surface} from '../canvasTextures';
import {SurfaceNodeMaterial} from '../materials';
import {elevatorMaterials} from '../elevator';

/** The tube's look (m / linear colours). */
export const CONNECTOR_LOOK = {
  /** Steel hoops: count along the tube (both mouths included), the hoop's square section, the mouth hoop's. */
  hoops: 5, hoop: 0.045, mouthHoop: 0.07,
  /** Canvas sag between hoops (m, at the bay's middle), the skirt under the floor, the fabric texture's span (m per repeat). */
  sag: 0.035, skirt: 0.14, span: 1.2,
  /** Duckboards: slat width / gap / thickness; the groundsheet's depth under the slat tops. */
  slat: 0.11, slatGap: 0.035, slatT: 0.025, sheet: 0.035,
  /** The flaps' inset from their mouth (s), the rolled-up flap's remaining drop (fraction of the opening) and the roll's radius. */
  flapIn: 0.09, rolled: 0.04, roll: 0.05,
  /** The work lamp: s = len * at, hanging this far under the crown. */
  lamp: {at: 0.5, drop: 0.32},
  /**
   * Self-glow (emissive x map) of the finishes: the lamp's dim light in their own colour. The colours TINT their maps (the maps carry
   * the albedo: the tent's fabric ~mid grey, the charcoal painted steel, the dark creosote timber): canvas a little darker than the
   * tent's own; the floor and hoops catch the lamp more than the walls; the groundsheet sits in the slats' shade.
   */
  glow: {canvas: 0.7, floor: 1.15, steel: 1.0, sheet: 0.3},
  colour: {canvas: 0xb3b182, floor: 0xc9b597, steel: 0xb8bcaa, sheet: 0x6a6b55},
  /** The district's host-name plate (m: width, height, above the crown). */
  plate: {w: 1.9, h: 0.34, above: 0.42},
  /** How long a section build waits for the canvas texture before the fallback finish (ms). */
  waitMs: 4000,
} as const;

type Key = 'canvas' | 'floor' | 'steel' | 'sheet';

let mats: Record<Key, THREE.Material> | null = null;
let fabric: THREE.Texture | null = null;
let fabricLoad: Promise<THREE.Texture | null> | null = null;

/** Fetch the canvas set (the tent's fabric) once; a section build with a connector waits for it (bounded: then the fallback set). */
export function loadConnectorTextures(): Promise<THREE.Texture | null> {
  return (fabricLoad ??= loadOfficeTexture('cubicle-fabric').then(t => (fabric = t)).catch(() => null));
}

function finishMat(name: string, map: THREE.Texture | null, colour: number, glow: number, o: {metalness?: number; side?: THREE.Side; normal?: THREE.Texture | null; rough?: THREE.Texture | null} = {}): THREE.Material {
  const m = new SurfaceNodeMaterial({map, roughness: 1, metalness: o.metalness ?? 0, color: colour, side: o.side ?? THREE.FrontSide});
  if (o.normal) m.normalMap = o.normal;
  if (o.rough) m.roughnessMap = o.rough;
  m.emissive.setRGB(1, 0.93, 0.82).multiply(new THREE.Color(colour));
  m.emissiveMap = map;
  m.emissiveIntensity = glow;
  m.name = name;
  return m;
}

/** The tube's finishes (module singletons: one program each, shared by every view and both worlds; never disposed). */
export function connectorMaterials(): Record<Key, THREE.Material> {
  if (mats) return mats;
  const L = CONNECTOR_LOOK, panel = surface('paintedPanel'), timber = surface('timberTie'), steel = surface('paintedSteel');
  const cloth = fabric ?? panel.map;
  if (cloth) { cloth.wrapS = cloth.wrapT = THREE.RepeatWrapping; }
  mats = {
    canvas: finishMat('surface-connector-canvas', cloth, L.colour.canvas, L.glow.canvas, {side: THREE.DoubleSide, normal: fabric ? null : panel.normalMap}),
    floor: finishMat('surface-connector-duckboard', timber.map, L.colour.floor, L.glow.floor, {normal: timber.normalMap, rough: timber.roughnessMap}),
    steel: finishMat('surface-connector-steel', steel.map, L.colour.steel, L.glow.steel, {metalness: 0.3, normal: steel.normalMap, rough: steel.roughnessMap}),
    sheet: finishMat('surface-connector-sheet', panel.map, L.colour.sheet, L.glow.sheet),
  };
  return mats;
}

/** The shell's cross-section (t, y) from the left skirt over the crown to the right skirt, and each point's inward unit normal. */
export function connectorProfile(): {t: number; y: number; nt: number; ny: number; sag: number}[] {
  const W = CONNECTOR.width / 2, H = CONNECTOR.wallH, C = CONNECTOR.crownH, h = C - H, R = (W * W + h * h) / (2 * h), yc = C - R, f0 = Math.asin(W / R);
  const out: {t: number; y: number; nt: number; ny: number; sag: number}[] = [];
  const sk = -CONNECTOR_LOOK.skirt;
  out.push({t: -W, y: sk, nt: 1, ny: 0, sag: 0}, {t: -W, y: H * 0.5, nt: 1, ny: 0, sag: 0.7}, {t: -W, y: H, nt: 1, ny: 0, sag: 1});
  const N = 8;
  for (let k = 1; k < N; k++) {
    const a = -f0 + (2 * f0 * k) / N;
    out.push({t: R * Math.sin(a), y: yc + R * Math.cos(a), nt: -Math.sin(a), ny: -Math.cos(a), sag: 1});
  }
  out.push({t: W, y: H, nt: -1, ny: 0, sag: 1}, {t: W, y: H * 0.5, nt: -1, ny: 0, sag: 0.7}, {t: W, y: sk, nt: -1, ny: 0, sag: 0});
  return out;
}

/** The arc's y at t (the crown's curve), for the mouths' fixed headers. */
function arcY(t: number): number {
  const W = CONNECTOR.width / 2, H = CONNECTOR.wallH, C = CONNECTOR.crownH, h = C - H, R = (W * W + h * h) / (2 * h);
  return C - R + Math.sqrt(Math.max(0, R * R - t * t));
}

/** One built tube. */
export interface ConnectorView {
  root: THREE.Group;
  rec: SurfaceConnector;
  /** The flaps' pivots (host mouth, tent mouth): setFlap scales them. */
  flaps: [THREE.Group, THREE.Group];
  geometries: THREE.BufferGeometry[];
  textures: THREE.Texture[];
  /** Set a flap: 0 shut .. 1 rolled up (0 the host mouth's, 1 the tent mouth's). */
  setFlap(end: 0 | 1, open: number): void;
  dispose(): void;
}

/** A box in tube-local metres (t, y, s ranges) -> local geometry (x = t, z = -s). */
function box(t0: number, t1: number, y0: number, y1: number, s0: number, s1: number, uvSpan = 1): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(Math.abs(t1 - t0), Math.abs(y1 - y0), Math.abs(s1 - s0));
  if (uvSpan !== 1) { const uv = g.getAttribute('uv') as THREE.BufferAttribute; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * Math.abs(t1 - t0) / uvSpan, uv.getY(i) * Math.abs(y1 - y0) / uvSpan); }
  g.translate((t0 + t1) / 2, (y0 + y1) / 2, -(s0 + s1) / 2);
  return g;
}

/** A square-section bar between two tube-local points at the same s (a hoop segment). */
function bar(a: [number, number], b: [number, number], s: number, size: number): THREE.BufferGeometry {
  const dt = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dt, dy) + size * 0.6;
  const g = new THREE.BoxGeometry(len, size, size);
  g.rotateZ(Math.atan2(dy, dt));
  g.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, -s);
  return g;
}

/** The canvas shell: the profile swept along s with a sag between hoops (indexed; smooth normals). */
function shell(len: number): THREE.BufferGeometry {
  const P = connectorProfile(), L = CONNECTOR_LOOK, bays = L.hoops - 1, per = 4, ns = bays * per + 1;
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  // arc length along the profile (the fabric's v)
  const along: number[] = [0];
  for (let i = 1; i < P.length; i++) along.push(along[i - 1] + Math.hypot(P[i].t - P[i - 1].t, P[i].y - P[i - 1].y));
  for (let j = 0; j < ns; j++) {
    const s = (len * j) / (ns - 1), u = (j % per) / per, sagK = Math.sin(Math.PI * u) * L.sag;
    for (let i = 0; i < P.length; i++) {
      const p = P[i], d = sagK * p.sag;
      pos.push(p.t + p.nt * d, p.y + p.ny * d, -s);
      uv.push(s / L.span, along[i] / L.span);
    }
  }
  const n = P.length;
  for (let j = 0; j + 1 < ns; j++) for (let i = 0; i + 1 < n; i++) {
    const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** A flat canvas sheet in the t-y plane at s (a polygon: t0..t1 by y0..y1, the top edge optionally following the arc). */
function sheetAt(t0: number, t1: number, y0: number, y1: number | 'arc', s: number, cols = 8): THREE.BufferGeometry {
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  for (let k = 0; k <= cols; k++) {
    const t = t0 + ((t1 - t0) * k) / cols, top = y1 === 'arc' ? arcY(t) : y1;
    pos.push(t, y0, -s, t, top, -s);
    uv.push(t / CONNECTOR_LOOK.span, y0 / CONNECTOR_LOOK.span, t / CONNECTOR_LOOK.span, top / CONNECTOR_LOOK.span);
  }
  for (let k = 0; k < cols; k++) { const a = 2 * k; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** The district's host-name plate texture (runtime text; owned by the view). */
function plateTexture(text: string): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = 512; c.height = 96;
  const x = c.getContext('2d');
  if (!x) return null;
  x.fillStyle = '#2f3324'; x.fillRect(0, 0, c.width, c.height);
  x.strokeStyle = '#c9c4a6'; x.lineWidth = 4; x.strokeRect(6, 6, c.width - 12, c.height - 12);
  x.fillStyle = '#e4dfc4';
  x.textAlign = 'center'; x.textBaseline = 'middle';
  let size = 44;
  const label = text.toUpperCase();
  do { x.font = `bold ${size}px sans-serif`; size -= 2; } while (size > 18 && x.measureText(label).width > c.width - 40);
  x.fillText(label, c.width / 2, c.height / 2 + 2);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * Build the tube of a record. `name`: the district's host-name plate text (end 'tent'; omitted: no plate). The view is not added to any
 * parent; its meshes carry userData.level / noOcclusion (the level culler never hides the tube behind the grid's cells: in the host world
 * it stands off the grid, in the district on its own SOLID footprint) and userData.surfaceConnector.
 */
export function buildConnectorView(rec: SurfaceConnector, opts: {name?: string} = {}): ConnectorView {
  const M = connectorMaterials(), L = CONNECTOR_LOOK, W = CONNECTOR.width / 2, H = CONNECTOR.wallH, len = rec.len;
  const parts: Record<Key, THREE.BufferGeometry[]> = {canvas: [], floor: [], steel: [], sheet: []};
  parts.canvas.push(shell(len));
  // hoops (the mouths' heavier) along the profile, a little inside the canvas
  const P = connectorProfile().filter(p => p.y >= 0);
  for (let k = 0; k < L.hoops; k++) {
    const s = (len * k) / (L.hoops - 1), mouth = k === 0 || k === L.hoops - 1, size = mouth ? L.mouthHoop : L.hoop, inset = size / 2 + 0.01;
    const sc = mouth ? (k === 0 ? s + size / 2 : s - size / 2) : s;
    for (let i = 0; i + 1 < P.length; i++) parts.steel.push(bar([P[i].t + P[i].nt * inset, P[i].y + P[i].ny * inset], [P[i + 1].t + P[i + 1].nt * inset, P[i + 1].y + P[i + 1].ny * inset], sc, size));
  }
  // the floor: groundsheet + duckboards across the tube on two runners
  parts.sheet.push(box(-W, W, -L.sheet - 0.01, -L.sheet, 0, len));
  for (const t of [-0.62, 0.62]) parts.steel.push(box(t - 0.03, t + 0.03, -L.sheet, -L.slatT, 0.04, len - 0.04));
  for (let s = 0.06; s + L.slat <= len - 0.05; s += L.slat + L.slatGap) parts.floor.push(box(-W + 0.03, W - 0.03, -L.slatT, 0, s, s + L.slat, 0.6));
  // fixed headers over both mouths' clear openings (the wall height .. the arc)
  for (const s of [0.012, len - 0.012]) parts.canvas.push(sheetAt(-W, W, H, 'arc', s, 10));
  // the work lamp: a cable, a cage, its glowing lens
  const ls = len * L.lamp.at, ly = CONNECTOR.crownH - L.lamp.drop;
  parts.steel.push(box(-0.006, 0.006, ly + 0.09, CONNECTOR.crownH - 0.02, ls - 0.006, ls + 0.006));
  parts.steel.push(box(-0.07, 0.07, ly + 0.07, ly + 0.09, ls - 0.07, ls + 0.07));
  for (const [a, b] of [[-0.065, -0.055], [0.055, 0.065]] as const) for (const [c, d] of [[-0.065, -0.055], [0.055, 0.065]] as const) parts.steel.push(box(a, b, ly - 0.09, ly + 0.07, ls + c, ls + d));
  // the host world: the collar closing the host's street opening round the tube (wider than the tube: the Mall's door set)
  if (rec.end === 'host') {
    const cw = Math.max(rec.door.collar, rec.door.width) / 2, top = Math.max(rec.door.height, CONNECTOR.crownH) + 0.12, s = -0.02;
    if (cw > W + 0.02) for (const sg of [-1, 1]) parts.canvas.push(sheetAt(sg < 0 ? -cw - 0.1 : W, sg < 0 ? -W : cw + 0.1, -L.skirt, top, s, 2));
    parts.canvas.push(sheetAt(-cw - 0.1, cw + 0.1, CONNECTOR.crownH - 0.02, top, s, 4));
  }
  const root = new THREE.Group();
  root.name = 'surface-connector';
  root.userData.surfaceConnector = true;
  const geometries: THREE.BufferGeometry[] = [], textures: THREE.Texture[] = [];
  const tag = (o: THREE.Object3D) => { o.userData.level = rec.level; o.userData.noOcclusion = true; o.userData.surfaceConnector = true; };
  for (const k of Object.keys(parts) as Key[]) {
    const list = parts[k];
    if (!list.length) continue;
    const geo = list.length === 1 ? list[0] : mergeGeometries(list, false);
    if (list.length > 1) for (const g of list) g.dispose();
    if (!geo) continue;
    geo.computeBoundingSphere();
    geometries.push(geo);
    const mesh = new THREE.Mesh(geo, M[k]);
    mesh.name = `surface-connector-${k}`;
    mesh.castShadow = false;
    tag(mesh);
    root.add(mesh);
  }
  // the lamp's lens (the cargo kit's lamp finish)
  const lensGeo = new THREE.BoxGeometry(0.09, 0.12, 0.09);
  lensGeo.translate(0, ly - 0.01, -ls);
  geometries.push(lensGeo);
  const lens = new THREE.Mesh(lensGeo, elevatorMaterials().light as THREE.Material);
  lens.name = 'surface-connector-lamp';
  tag(lens);
  root.add(lens);
  // the flaps: a pivot at the opening's top per mouth, the sheet hanging from it (scaled up as it rolls), the roll at its bottom edge
  const flapGeo = sheetAt(-W + 0.03, W - 0.03, -H, 0, 0, 6);
  const rollGeo = new THREE.CylinderGeometry(L.roll, L.roll, 2 * W - 0.06, 10, 1);
  rollGeo.rotateZ(Math.PI / 2);
  geometries.push(flapGeo, rollGeo);
  const flaps = [0, 1].map(e => {
    const pivot = new THREE.Group();
    pivot.name = `surface-connector-flap-${e ? 'tent' : 'host'}`;
    pivot.position.set(0, H, -(e ? len - L.flapIn : L.flapIn));
    const sheet = new THREE.Mesh(flapGeo, M.canvas);
    sheet.name = 'surface-connector-flap';
    tag(sheet);
    const roll = new THREE.Mesh(rollGeo, M.canvas);
    roll.name = 'surface-connector-flap-roll';
    roll.position.y = -H;
    tag(roll);
    pivot.add(sheet, roll);
    root.add(pivot);
    return pivot;
  }) as [THREE.Group, THREE.Group];
  // the district: the host's name over the host mouth, on the facade
  if (rec.end === 'tent' && opts.name) {
    const tex = plateTexture(opts.name);
    if (tex) {
      textures.push(tex);
      const pg = new THREE.PlaneGeometry(L.plate.w, L.plate.h);
      pg.translate(0, CONNECTOR.crownH + L.plate.above, 0.015);
      pg.rotateY(Math.PI); // (facing +s: out of the facade toward the tent)
      geometries.push(pg);
      const pm = new SurfaceNodeMaterial({map: tex, roughness: 0.9, metalness: 0, color: 0xffffff});
      pm.emissive.setRGB(0.5, 0.5, 0.45); pm.emissiveMap = tex; pm.emissiveIntensity = 0.25;
      pm.name = 'surface-connector-plate';
      const plate = new THREE.Mesh(pg, pm);
      plate.name = 'surface-connector-plate';
      tag(plate);
      root.add(plate);
    }
  }
  root.position.set(rec.x, rec.y, rec.z);
  root.rotation.y = rec.yaw;
  root.updateMatrixWorld(true);
  const setFlap = (end: 0 | 1, open: number): void => {
    const o = Math.max(0, Math.min(1, open)), k = 1 - (1 - L.rolled) * o, p = flaps[end];
    const sheet = p.children[0], roll = p.children[1];
    sheet.scale.y = k;
    roll.position.y = -H * k;
    const r = 1 + 2.2 * o;
    roll.scale.set(1, r, r);
    p.updateMatrixWorld(true);
  };
  return {
    root, rec, flaps, geometries, textures, setFlap,
    dispose(): void {
      root.removeFromParent();
      for (const g of geometries) g.dispose();
      for (const t of textures) t.dispose();
      root.traverse(o => { const m = (o as THREE.Mesh).material as THREE.Material | undefined; if (m && m.name === 'surface-connector-plate') m.dispose(); });
    },
  };
}
