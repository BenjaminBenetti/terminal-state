// Task studio-reactor-surface-ending-20261102 (lane ENDING): the surface exit's own geometry — code-built from existing materials (no new
// texture / model): THE EXTERIOR DOOR in its rim pit wall (a heavy steel portal with a hazard-yellow lintel, two bi-parting leaves that
// slide into the wall's pockets, a status lamp: red sealed, green open) and THE OPENING'S PARAPET RING on the surface deck (a 0.75 m
// thick concrete upstand, 1.1 m above the deck, continuing the roof curb's inner face: it hides the opening's cell-stepped deck edge
// and stands only over the blocked keep-off ring and the opening's own cells). Lane SURFACE draws the plaza's boundary wall / city.

import * as THREE from 'three';
import type {ReactorSurface} from '../../gen/reactor/reactorTypes';
import {ROOF_KIT} from './roofKit';
import {controlSkin, lampSkin} from './controlsSkin';

/** The door view's sizes (m). */
export const DOOR_VIEW = {
  /** Leaf thickness, overlap past the opening's middle / into the pockets. */
  leafT: 0.16, overlap: 0.04,
  /** Portal jambs / lintel on the pit-side face: width, depth proud of the face, lintel height. */
  jamb: 0.24, proud: 0.07, lintel: 0.32,
  /** Status lamp (box) over the lintel. */
  lamp: 0.16,
} as const;

export interface DoorView {
  root: THREE.Group;
  /** The two leaves (their closed local x offsets) and the lamp's two lenses. */
  leaves: [THREE.Mesh, THREE.Mesh];
  closedX: [number, number];
  lampRed: THREE.Mesh;
  lampGreen: THREE.Mesh;
  /** Leaf travel (m) at fully open. */
  travel: number;
  /** Set the open fraction 0..1 (leaves) and the lamp state. */
  set(open: number): void;
  dispose(): void;
}

/**
 * The exterior door at `s.door` (local frame: +Z = the outward normal into the pit, +X along the wall, origin at the opening's centre
 * on the wall's mid-plane, y = the rim deck).
 */
export function buildDoorView(s: Pick<ReactorSurface, 'door'>): DoorView {
  const d = s.door, V = DOOR_VIEW;
  const root = new THREE.Group();
  root.name = 'reactor-ending-door';
  root.position.set(d.x, d.y, d.z);
  root.rotation.y = Math.atan2(d.nx, d.nz); // local +Z -> (nx, nz)
  const geos: THREE.BufferGeometry[] = [];
  const box = (w: number, h: number, t: number, mat: THREE.Material, x: number, y: number, z: number, name: string): THREE.Mesh => {
    const g = new THREE.BoxGeometry(w, h, t);
    geos.push(g);
    const m = new THREE.Mesh(g, mat);
    m.position.set(x, y, z);
    m.name = name;
    m.userData.level = d.level;
    root.add(m);
    return m;
  };
  const half = d.w / 2, wallHalf = 0.25; // the wall row is one 0.5 m cell
  const leafMat = controlSkin('switchgear'), frameMat = controlSkin('steel'), yellow = controlSkin('yellow');
  // the leaves: each half the opening + an overlap, on the wall's mid-plane, sliding outward along X into the rock pockets
  const lw = half + V.overlap;
  const left = box(lw, d.h, V.leafT, leafMat, -half / 2, d.h / 2, 0, 'reactor-ending-door-leaf-l');
  const right = box(lw, d.h, V.leafT, leafMat, half / 2, d.h / 2, 0, 'reactor-ending-door-leaf-r');
  // a hazard band across each leaf at mid height (the same steel family, yellow)
  for (const leaf of [left, right]) {
    const g = new THREE.BoxGeometry(lw * 0.96, 0.18, V.leafT + 0.02);
    geos.push(g);
    const band = new THREE.Mesh(g, yellow);
    band.position.set(0, 0.25, 0);
    band.name = 'reactor-ending-door-band';
    leaf.add(band);
  }
  // the portal on the pit-side face: jambs + a yellow lintel, proud of the wall face
  const zf = wallHalf + V.proud / 2;
  box(V.jamb, d.h + V.lintel, V.proud, frameMat, -half - V.jamb / 2, (d.h + V.lintel) / 2, zf, 'reactor-ending-door-jamb');
  box(V.jamb, d.h + V.lintel, V.proud, frameMat, half + V.jamb / 2, (d.h + V.lintel) / 2, zf, 'reactor-ending-door-jamb');
  box(d.w + 2 * V.jamb, V.lintel, V.proud, yellow, 0, d.h + V.lintel / 2, zf, 'reactor-ending-door-lintel');
  // the status lamp over the lintel: red (sealed) / green (open) lenses, one shown
  const ly = d.h + V.lintel + V.lamp * 0.75;
  box(V.lamp * 1.6, V.lamp * 1.4, V.proud, frameMat, 0, ly, zf, 'reactor-ending-door-lamp-box');
  const lampRed = box(V.lamp, V.lamp, 0.03, lampSkin('litRed'), 0, ly, zf + V.proud / 2 + 0.016, 'reactor-ending-door-lamp-red');
  const lampGreen = box(V.lamp, V.lamp, 0.03, lampSkin('litGreen'), 0, ly, zf + V.proud / 2 + 0.016, 'reactor-ending-door-lamp-green');
  root.updateMatrixWorld(true);
  const closedX: [number, number] = [-half / 2, half / 2], travel = half + V.overlap + 0.02;
  const view: DoorView = {
    root, leaves: [left, right], closedX, lampRed, lampGreen, travel,
    set(open: number) {
      const k = Math.max(0, Math.min(1, open));
      left.position.x = closedX[0] - travel * k;
      right.position.x = closedX[1] + travel * k;
      // fully open: the leaves stand inside the rock pockets (hidden by the wall faces)
      left.visible = right.visible = k < 0.999;
      lampRed.visible = k <= 0;
      lampGreen.visible = k > 0;
      root.updateMatrixWorld(true);
    },
    dispose() { for (const g of geos) g.dispose(); for (const leaf of [left, right]) for (const c of leaf.children) (c as THREE.Mesh).geometry?.dispose(); },
  };
  view.set(0);
  return view;
}

/** The barrier's railing sizes (m). */
export const RING_VIEW = {posts: 40, postW: 0.07, rail: 0.028, midK: 0.5, apronUp: 0.02} as const;

/**
 * THE BARRIER round the opening on the surface deck (world space): the concrete APRON — a flat annulus from the opening radius out to
 * parapet.r1 a hair over the deck (it covers the roof curb's upstand top, 2 cm under the deck, and the opening's cell-stepped deck
 * edge) with its outer edge face — and the steel GUARD RAILING side-mounted on the curb's inner face just inside the radius
 * (parapet.r0): posts, a top rail at parapet.top and a mid rail. See-through: the player at the deck edge looks down the shaft.
 */
export function ringGeometry(s: Pick<ReactorSurface, 'hole' | 'y'>, roofY: number): {apron: THREE.BufferGeometry; rail: THREE.BufferGeometry} {
  const h = s.hole, V = RING_VIEW, yA = s.y + V.apronUp, rIn = h.r, rOut = h.parapet.r1;
  const band = (ra: number, ya: number, rb: number, yb2: number) =>
    new THREE.LatheGeometry([new THREE.Vector2(ra, ya), new THREE.Vector2(rb, yb2)], ROOF_KIT.segments).translate(h.x, 0, h.z);
  // three's LatheGeometry faces (dy, -dx) of the profile direction: ascending = outward, inward-going = upward
  const apronParts = [band(rOut, yA, rIn, yA), band(rOut, s.y - 0.03, rOut, yA)];
  const apron = mergeLathe(apronParts);
  for (const p of apronParts) p.dispose();
  apron.computeBoundingSphere();
  // the railing: posts bolted to the curb's inner face (from 0.3 m under its top) up to the top rail, two torus rails
  const r = h.parapet.r0, y0 = roofY + ROOF_KIT.upstandH - 0.3, top = h.parapet.top, parts: THREE.BufferGeometry[] = [];
  for (let k = 0; k < V.posts; k++) {
    const a = (k / V.posts) * Math.PI * 2;
    const g = new THREE.BoxGeometry(V.postW, top - y0, V.postW);
    g.rotateY(-a);
    g.translate(h.x + Math.cos(a) * r, (y0 + top) / 2, h.z + Math.sin(a) * r);
    parts.push(g);
  }
  for (const y of [top - V.rail, s.y + (top - s.y) * V.midK]) {
    const g = new THREE.TorusGeometry(r, V.rail, 6, ROOF_KIT.segments);
    g.rotateX(Math.PI / 2);
    g.translate(h.x, y, h.z);
    parts.push(g);
  }
  const rail = mergeLathe(parts);
  for (const p of parts) p.dispose();
  rail.computeBoundingSphere();
  return {apron, rail};
}

function mergeLathe(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  // non-indexed concatenation (position + normal): three lathe bands
  const pos: number[] = [], nrm: number[] = [];
  for (const p of parts) {
    const g = p.index ? p.toNonIndexed() : p;
    const a = g.getAttribute('position'), n = g.getAttribute('normal');
    for (let i = 0; i < a.count; i++) { pos.push(a.getX(i), a.getY(i), a.getZ(i)); nrm.push(n.getX(i), n.getY(i), n.getZ(i)); }
    if (g !== p) g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  return out;
}
