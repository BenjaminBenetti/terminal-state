// Task studio-skywalk-events-20261115-193624-01 (layout version 7, lead): draws the new events' PROP KINDS (gen/skyways/events/kinds.ts)
// on their placements. Called by world/skywaysDestinations.ts buildSkywaysDestProp for those kinds only.
//  - an event lane's own drawer first (world/skywaysExpoDraw.ts / skywaysGolfDraw.ts / skywaysEvacDraw.ts: a kind that needs more than
//    boxes — the putting greens' turf, a cup liner), else
//  - the spec's code-drawn PARTS (boxes merged per shape / purpose material, one batch per variant; instanced per storey, `prop-<kind>`
//    names so damage / physics find each instance), and
//  - its CANVAS FACES: flat quads showing a locally painted graphic per variant (the lane's painter table: screens, signs, scorecards,
//    notes — DYNAMIC per-seed text over code shapes, root CLAUDE.md). Without a DOM (Node tests) a plain board stands in for the graphic.

import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import type {PropPlacement} from '../gen/props';
import type {ShapeMat} from '../gen/propShapes';
import {isPurposeMat, type PartMat} from '../gen/purposeShapes';
import type {StationLayout} from '../gen/stationTypes';
import type {DestDrawnPart} from '../gen/skyways/destinations/kindTypes';
import type {EventFace, EventKindSpec} from '../gen/skyways/events/eventKindTypes';
import {SKYWAYS_EVENT_SPECS, type SkywaysEventKind} from '../gen/skyways/events/kinds';
import {purposeMaterial} from './purposeTextures';
import {shapeMaterials} from './shapeMaterials';
import {SurfaceNodeMaterial, type WorldMaterials} from './materials';
import {EXPO_PAINTERS, drawExpoProp} from './skywaysExpoDraw';
import {GOLF_PAINTERS, drawGolfProp} from './skywaysGolfDraw';
import {EVAC_PAINTERS, drawEvacProp} from './skywaysEvacDraw';

/** A canvas painter: its texture size (px) and the drawing for a variant (the canvas is cleared to transparent first). */
export interface EventPainter { px: readonly [number, number]; draw: (ctx: CanvasRenderingContext2D, w: number, h: number, variant: number) => void }
const PAINTERS: Readonly<Record<string, EventPainter>> = {...EXPO_PAINTERS, ...GOLF_PAINTERS, ...EVAC_PAINTERS};
/** QA / tests: every painter id the events' faces may name. */
export const SKYWAYS_EVENT_PAINTER_IDS: readonly string[] = Object.keys(PAINTERS).sort();

const UP = new THREE.Vector3(0, 1, 0);
export const eventPlaceM = (p: PropPlacement): THREE.Matrix4 => new THREE.Matrix4().compose(new THREE.Vector3(p.x, p.y, p.z), new THREE.Quaternion().setFromAxisAngle(UP, p.rot), new THREE.Vector3(1, 1, 1));

export function eventPartGeo(part: DestDrawnPart): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(part.s[0], part.s[1], part.s[2]);
  if (part.rx) g.rotateX(part.rx);
  if (part.ry) g.rotateY(part.ry);
  g.translate(part.p[0], part.p[1], part.p[2]);
  return g;
}

const byLevel = <T extends {level?: number}>(list: readonly T[]) => {
  const m = new Map<number, T[]>();
  for (const p of list) { const l = m.get(p.level ?? 0); if (l) l.push(p); else m.set(p.level ?? 0, [p]); }
  return m;
};
export const byVariant = (list: readonly PropPlacement[]): Map<number, PropPlacement[]> => {
  const m = new Map<number, PropPlacement[]>();
  for (const p of list) { const l = m.get(p.variant); if (l) l.push(p); else m.set(p.variant, [p]); }
  return m;
};

/** Instanced per storey (userData.level: the level culler), named `prop-<kind>-<suffix>`. */
export function eventInstanced(group: THREE.Group, geo: THREE.BufferGeometry, mat: THREE.Material, list: readonly PropPlacement[], name: string): number {
  geo.computeBoundingSphere();
  for (const [level, ps] of byLevel(list)) {
    const im = new THREE.InstancedMesh(geo, mat, ps.length);
    ps.forEach((p, i) => im.setMatrixAt(i, eventPlaceM(p)));
    im.name = name;
    im.userData.level = level;
    im.computeBoundingSphere();
    group.add(im);
  }
  return list.length;
}

/** The parts of one variant batch, merged per material. */
export function drawEventParts(group: THREE.Group, kind: string, parts: readonly DestDrawnPart[], list: readonly PropPlacement[], wm: WorldMaterials, tag = ''): void {
  const pm = shapeMaterials(wm), byMat = new Map<PartMat, THREE.BufferGeometry[]>();
  for (const part of parts) { let l = byMat.get(part.m); if (!l) byMat.set(part.m, (l = [])); l.push(eventPartGeo(part)); }
  for (const [m, geos] of byMat) {
    const geo = geos.length > 1 ? mergeGeometries(geos, false) : geos[0];
    if (geos.length > 1) for (const g of geos) g.dispose();
    eventInstanced(group, geo, isPurposeMat(m) ? purposeMaterial(m) : pm[m as ShapeMat], list, `prop-${kind}${tag}-${m}`);
  }
}

// ---------------------------------------------------------------------------------------------
// Canvas faces

const FACE_MATS = new Map<string, THREE.Material>();
let plain: THREE.Material | null = null;
const hasDom = (): boolean => typeof document !== 'undefined' && typeof document.createElement === 'function';
/** QA / tests: was a painter's graphic drawn (a DOM was there)? */
export const eventFacePainted = (paint: string, variant: number, glow = 0): boolean => FACE_MATS.has(`${paint}|${variant}|${glow}`);

/** The material of a painter's graphic for a variant (cached; self-lit when `glow` > 0), or the plain board without a DOM. */
export function eventFaceMaterial(paint: string, variant: number, glow = 0): THREE.Material {
  const key = `${paint}|${variant}|${glow}`;
  let m = FACE_MATS.get(key);
  if (m) return m;
  const painter = PAINTERS[paint];
  if (!painter || !hasDom()) {
    if (!plain) { plain = new SurfaceNodeMaterial({color: 0xd9d5cc, roughness: 0.85, metalness: 0}); plain.name = 'skyways-event-face-plain'; }
    return plain;
  }
  const c = document.createElement('canvas');
  [c.width, c.height] = painter.px;
  const ctx = c.getContext('2d');
  if (!ctx) return eventFaceMaterial('', 0);
  painter.draw(ctx, c.width, c.height, variant);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.generateMipmaps = true;
  m = glow > 0 ? new SurfaceNodeMaterial({map: t, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: glow, roughness: 0.3, metalness: 0})
    : new SurfaceNodeMaterial({map: t, roughness: 0.8, metalness: 0});
  m.name = `skyways-event-face-${paint}`;
  FACE_MATS.set(key, m);
  return m;
}

function faceGeo(f: EventFace): THREE.BufferGeometry {
  const front = new THREE.PlaneGeometry(f.w, f.h);
  let g: THREE.BufferGeometry = front;
  if (f.back) {
    const back = new THREE.PlaneGeometry(f.w, f.h);
    back.rotateY(Math.PI);
    back.translate(0, 0, -0.002);
    g = mergeGeometries([front, back], false);
    front.dispose(); back.dispose();
  }
  if (f.rx) g.rotateX(f.rx);
  if (f.ry) g.rotateY(f.ry);
  g.translate(f.p[0], f.p[1], f.p[2]);
  return g;
}

/** Renders one event kind's placements. Returns the instance count. */
export function buildSkywaysEventProp(group: THREE.Group, kind: SkywaysEventKind, list: PropPlacement[], wm: WorldMaterials, layout?: StationLayout): number {
  if (!list.length) return 0;
  const own = drawExpoProp(group, kind, list, wm, layout) ?? drawGolfProp(group, kind, list, wm, layout) ?? drawEvacProp(group, kind, list, wm, layout);
  if (own !== null) return own;
  const spec = (SKYWAYS_EVENT_SPECS as Readonly<Record<string, EventKindSpec>>)[kind];
  if (!spec) return 0;
  for (const [v, ps] of byVariant(list)) {
    if (spec.parts) drawEventParts(group, kind, spec.parts(v), ps, wm, `-v${v}`);
    (spec.faces?.(v) ?? []).forEach((f: EventFace, k: number) => eventInstanced(group, faceGeo(f), eventFaceMaterial(f.paint, v, f.glow ?? 0), ps, `prop-${kind}-v${v}-face${k}`));
  }
  return list.length;
}
