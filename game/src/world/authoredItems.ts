// Iteration 12 (LIGHT): AUTHORED procedural models for the two new light-survival items, per the standing asset-method rule
// (reference/design/ASSET-METHOD-RULE.md: controlled geometry before AI reconstruction for simple shapes). Nothing here is
// AI-generated: the shapes are hand-dimensioned THREE cylinders / discs / rings and the labels are drawn on canvases in code
// (generic, unbranded, worn). No image or 3D generation service was used for them.
//
//  - battery: an unbranded 1.5 V D cell (IEC LR20, 34.6 mm x 61.5 mm), standing upright. Steel crimp / shoulder / + nub,
//    a wrapped paper-film label (blue-grey with an ochre band, "D · 1.5 V · LR20 · ALKALINE"), scuffs, faded patches, grime
//    at the base and a few corrosion specks at the bottom crimp.
//  - flare: a road (highway) flare lying along X: red waxed-paper tube (29 mm x 215 mm) with a printed band, a dark wax base
//    plug at -X and a black plastic striker cap over the ignition end at +X (33 mm x 50 mm, gritty striker face); 0.255 m
//    overall. `thrownFlareModel` is the struck flare: cap pushed onto the base, the burning head exposed (hot emissive slag
//    + an additive glow sprite), switched to ash when it burns out.
//  - gas_filter (task gasmask-breach-20261030, mask lane): a screw-in 40 mm respirator filter canister standing on its intake
//    face, threaded neck up: olive-drab painted steel can (96 mm x 52 mm) with a cream stencilled band ("GAS FILTER · 40 mm
//    THREAD · KEEP SEALED", generic), a steel top lid, a ridged threaded neck and a dark rubber seal plug; 72 mm overall.
// Frames follow world/pickups.ts: origin bottom-centre, front +Z, metres. Geometry / materials are shared (cached once);
// pickups clone materials for their highlight, the held view / item icons / thrown flare clone the object.

import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {canvasTexture} from './canvasTextures';

/** Item ids with an authored model here (pickups.ts itemTemplate checks this first). */
export const AUTHORED_ITEM_IDS = ['battery', 'flare', 'gas_filter'] as const;
export type AuthoredItemId = (typeof AUTHORED_ITEM_IDS)[number];
export const isAuthoredItem = (id: string): id is AuthoredItemId => (AUTHORED_ITEM_IDS as readonly string[]).includes(id);

/** Authored dimensions (m). */
export const BATTERY_DIMS = {r: 0.0173, h: 0.06, nubR: 0.0045, nubH: 0.0015, crimp: 0.0024} as const;
export const FLARE_DIMS = {bodyR: 0.0145, bodyLen: 0.215, capR: 0.0165, capLen: 0.05, capOverlap: 0.01, headLen: 0.007, total: 0.255} as const;
/** Mask lane: the filter canister (body radius / height, lid, threaded neck radius / height / ridges, seal plug height). */
export const FILTER_DIMS = {r: 0.048, h: 0.052, lid: 0.004, neckR: 0.02, neckH: 0.014, ridges: 3, seal: 0.002} as const;

/** The flare tube axis height above its resting floor (the cap is the widest part) and the X of its ignition head. */
export const FLARE_AXIS_Y = FLARE_DIMS.capR;
export const FLARE_HEAD_X = -FLARE_DIMS.total / 2 + FLARE_DIMS.bodyLen;

// ---------------------------------------------------------------------------------------------
// Labels (canvas, drawn once)

let texCache: Record<string, THREE.Texture> = {};
let matCache: Record<string, THREE.Material> = {};
let geoCache: Record<string, THREE.BufferGeometry> = {};

function tex(key: string, make: () => THREE.Texture): THREE.Texture {
  return (texCache[key] ??= make());
}

/** Scuffs, faded patches and grime over a label (shared by both labels). */
function wear(ctx: CanvasRenderingContext2D, w: number, h: number, r: () => number, o: {scratches: number; fades: number; grime: 'bottom' | 'none'; specks?: string}): void {
  for (let i = 0; i < o.fades; i++) {
    const x = r() * w, y = r() * h, rad = 6 + r() * 18;
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, 'rgba(235,228,210,0.22)');
    g.addColorStop(1, 'rgba(235,228,210,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  ctx.lineCap = 'round';
  for (let i = 0; i < o.scratches; i++) {
    const x = r() * w, y = r() * h, len = 3 + r() * 16, a = (r() - 0.5) * 0.9;
    ctx.strokeStyle = r() < 0.6 ? `rgba(230,225,214,${0.18 + r() * 0.25})` : `rgba(20,18,16,${0.2 + r() * 0.25})`;
    ctx.lineWidth = 0.6 + r() * 0.9;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len); ctx.stroke();
  }
  if (o.grime === 'bottom') {
    const g = ctx.createLinearGradient(0, h * 0.7, 0, h);
    g.addColorStop(0, 'rgba(40,32,22,0)');
    g.addColorStop(1, 'rgba(40,32,22,0.55)');
    ctx.fillStyle = g;
    ctx.fillRect(0, h * 0.7, w, h * 0.3);
  }
  if (o.specks) {
    for (let i = 0; i < 26; i++) {
      ctx.fillStyle = o.specks.replace('A', (0.35 + r() * 0.45).toFixed(2));
      ctx.beginPath(); ctx.ellipse(r() * w, h - r() * h * 0.16, 0.6 + r() * 1.6, 0.5 + r() * 1.2, r() * 3, 0, Math.PI * 2); ctx.fill();
    }
  }
}

/** Unbranded D-cell wrap: canvas x = around the cell (u), canvas top = the + end. */
function batteryLabel(): THREE.Texture {
  return tex('batteryLabel', () => canvasTexture(256, 128, 1207, (ctx, w, h, r) => {
    ctx.fillStyle = '#34495b';
    ctx.fillRect(0, 0, w, h);
    // fibre / film grain
    for (let i = 0; i < 900; i++) { ctx.fillStyle = `rgba(${r() < 0.5 ? '255,255,255' : '0,0,0'},${0.03 + r() * 0.04})`; ctx.fillRect(r() * w, r() * h, 1 + r() * 2, 1); }
    // ochre band with the size / voltage (front = u 0.5 = canvas centre)
    ctx.fillStyle = '#c4ad73';
    ctx.fillRect(0, 50, w, 34);
    ctx.fillStyle = '#20262b';
    ctx.fillRect(0, 48, w, 2); ctx.fillRect(0, 84, w, 2);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    // front half centred on u = 0.5; the back half's copy straddles the u = 0 / 1 seam (drawn at both edges so it wraps)
    for (const cx of [w * 0.5, 0, w]) {
      const front = cx === w * 0.5;
      ctx.font = 'bold 26px Arial'; ctx.fillStyle = '#1d2226';
      ctx.fillText(front ? 'D' : '1.5V', cx - 30, 68); ctx.fillText(front ? '1.5V' : 'D', cx + 26, 68);
      ctx.font = 'bold 15px Arial'; ctx.fillStyle = '#e6e1d2';
      ctx.fillText('ALKALINE', cx, 30);
      ctx.font = '11px Arial'; ctx.fillStyle = 'rgba(230,225,210,0.8)';
      ctx.fillText(front ? 'LR20 · 1.5 V · + END FIRST' : 'DO NOT RECHARGE OR HEAT', cx, 104);
    }
    ctx.font = 'bold 18px Arial'; ctx.fillStyle = '#e6e1d2'; ctx.fillText('+', w * 0.5 - 52, 13);
    wear(ctx, w, h, r, {scratches: 70, fades: 9, grime: 'bottom', specks: 'rgba(138,74,30,A)'});
  }));
}

/** Road-flare wrap: canvas x = around the tube (u), canvas y = along it (top = the head / cap end). */
function flareLabel(): THREE.Texture {
  return tex('flareLabel', () => canvasTexture(128, 512, 3307, (ctx, w, h, r) => {
    ctx.fillStyle = '#a81d17';
    ctx.fillRect(0, 0, w, h);
    // waxed paper: lengthwise sheen streaks + mottling
    for (let i = 0; i < 40; i++) { ctx.fillStyle = `rgba(255,190,170,${0.03 + r() * 0.05})`; ctx.fillRect(r() * w, 0, 1 + r() * 4, h); }
    for (let i = 0; i < 500; i++) { ctx.fillStyle = `rgba(${r() < 0.5 ? '255,230,220' : '40,0,0'},${0.04 + r() * 0.05})`; ctx.fillRect(r() * w, r() * h, 1 + r() * 2, 1 + r() * 3); }
    // spiral seam of the wound paper
    ctx.strokeStyle = 'rgba(60,8,6,0.35)'; ctx.lineWidth = 1.2;
    for (let y = -w; y < h; y += 46) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y + w * 0.36); ctx.stroke(); }
    // printed band (front = u 0.5 = canvas centre column), text reading along the tube
    ctx.fillStyle = '#ece6d6';
    ctx.fillRect(18, 150, w - 36, 230);
    ctx.fillStyle = '#a81d17';
    ctx.fillRect(18, 150, w - 36, 6); ctx.fillRect(18, 374, w - 36, 6);
    ctx.save();
    ctx.translate(w / 2, 265);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#16120f'; ctx.font = 'bold 30px Arial'; ctx.fillText('ROAD FLARE', 0, -18);
    ctx.fillStyle = '#a81d17'; ctx.font = 'bold 17px Arial'; ctx.fillText('30 MIN · RED', 0, 8);
    ctx.fillStyle = '#16120f'; ctx.font = '10px Arial'; ctx.fillText('REMOVE CAP · STRIKE AWAY FROM BODY', 0, 26);
    ctx.fillText('WARNING: FIRE · HOT SLAG', 0, 38);
    ctx.restore();
    // creases (across) and handling dirt
    for (let i = 0; i < 9; i++) {
      const y = r() * h;
      ctx.strokeStyle = `rgba(30,6,4,${0.18 + r() * 0.2})`; ctx.lineWidth = 0.8 + r();
      ctx.beginPath(); ctx.moveTo(0, y); ctx.bezierCurveTo(w * 0.3, y + (r() - 0.5) * 8, w * 0.7, y + (r() - 0.5) * 8, w, y + (r() - 0.5) * 6); ctx.stroke();
    }
    wear(ctx, w, h, r, {scratches: 60, fades: 12, grime: 'bottom'});
  }));
}

/** Mask lane: olive-drab filter can wrap — canvas x = around the can (u; front = centre), top = the neck end. */
function filterLabel(): THREE.Texture {
  return tex('filterLabel', () => canvasTexture(256, 96, 6211, (ctx, w, h, r) => {
    ctx.fillStyle = '#4b5133';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 700; i++) { ctx.fillStyle = `rgba(${r() < 0.5 ? '255,255,235' : '0,0,0'},${0.03 + r() * 0.05})`; ctx.fillRect(r() * w, r() * h, 1 + r() * 2, 1); }
    // rolled seams top and bottom, stencilled band in front (u 0.5) and a lot number on the back (wraps the seam)
    ctx.fillStyle = 'rgba(20,22,14,0.55)';
    ctx.fillRect(0, 0, w, 5); ctx.fillRect(0, h - 5, w, 5);
    ctx.fillStyle = '#d8d0b0';
    ctx.fillRect(w * 0.18, 30, w * 0.64, 30);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#2a2d1d'; ctx.font = 'bold 15px Arial'; ctx.fillText('GAS FILTER', w * 0.5, 39);
    ctx.font = '9px Arial'; ctx.fillText('40 mm THREAD · KEEP SEALED', w * 0.5, 53);
    ctx.fillStyle = 'rgba(216,208,176,0.75)'; ctx.font = '10px Arial';
    for (const cx of [0, w]) ctx.fillText('LOT 07-31', cx, 45);
    ctx.fillStyle = 'rgba(216,208,176,0.6)'; ctx.font = 'bold 11px Arial'; ctx.fillText('▲ THIS END TO MASK', w * 0.5, 18);
    wear(ctx, w, h, r, {scratches: 80, fades: 10, grime: 'bottom', specks: 'rgba(120,70,30,A)'});
  }));
}

/** Black plastic cap with a gritty striker end (canvas = the end disc + side). */
function strikerTex(): THREE.Texture {
  return tex('striker', () => canvasTexture(128, 128, 4409, (ctx, w, h, r) => {
    ctx.fillStyle = '#4a4440';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 2600; i++) { const v = 40 + Math.floor(r() * 90); ctx.fillStyle = `rgb(${v},${v - 6},${v - 10})`; ctx.fillRect(r() * w, r() * h, 1 + r() * 1.5, 1 + r() * 1.5); }
    ctx.strokeStyle = 'rgba(200,190,170,0.35)'; ctx.lineWidth = 1.5;
    for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.moveTo(r() * w, r() * h); ctx.lineTo(r() * w, r() * h); ctx.stroke(); } // old strike marks
  }));
}

function glowTex(): THREE.Texture {
  return tex('flareGlow', () => canvasTexture(64, 64, 5501, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(255,245,235,1)');
    g.addColorStop(0.12, 'rgba(255,170,140,0.95)');
    g.addColorStop(0.35, 'rgba(255,60,30,0.45)');
    g.addColorStop(1, 'rgba(255,20,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }));
}

// ---------------------------------------------------------------------------------------------
// Materials

function mat(key: string, make: () => THREE.Material): THREE.Material {
  return (matCache[key] ??= make());
}

const M = {
  batteryLabel: () => mat('batteryLabel', () => new THREE.MeshStandardMaterial({name: 'authored-battery-label', map: batteryLabel(), roughness: 0.48, metalness: 0.1})),
  steel: () => mat('steel', () => new THREE.MeshStandardMaterial({name: 'authored-battery-steel', color: 0xb4b5b0, roughness: 0.38, metalness: 0.35})),
  flareLabel: () => mat('flareLabel', () => new THREE.MeshStandardMaterial({name: 'authored-flare-paper', map: flareLabel(), roughness: 0.52, metalness: 0})),
  plug: () => mat('plug', () => new THREE.MeshStandardMaterial({name: 'authored-flare-plug', color: 0x5a3f2c, roughness: 0.8, metalness: 0})),
  cap: () => mat('cap', () => new THREE.MeshStandardMaterial({name: 'authored-flare-cap', color: 0x24221f, roughness: 0.62, metalness: 0})),
  striker: () => mat('striker', () => new THREE.MeshStandardMaterial({name: 'authored-flare-striker', map: strikerTex(), roughness: 0.95, metalness: 0})),
  /** The struck head: hot slag (emissive) while burning, grey ash once out. */
  hot: () => mat('hot', () => new THREE.MeshStandardMaterial({name: 'authored-flare-hot', color: 0xffb08a, emissive: 0xff4422, emissiveIntensity: 3.2, roughness: 0.9, metalness: 0})),
  ash: () => mat('ash', () => new THREE.MeshStandardMaterial({name: 'authored-flare-ash', color: 0x6d6862, roughness: 1, metalness: 0})),
  // mask lane: filter canister
  filterLabel: () => mat('filterLabel', () => new THREE.MeshStandardMaterial({name: 'authored-filter-can', map: filterLabel(), roughness: 0.62, metalness: 0.25})),
  filterSteel: () => mat('filterSteel', () => new THREE.MeshStandardMaterial({name: 'authored-filter-steel', color: 0x8f918a, roughness: 0.42, metalness: 0.4})),
  filterSeal: () => mat('filterSeal', () => new THREE.MeshStandardMaterial({name: 'authored-filter-seal', color: 0x1e1f1c, roughness: 0.85, metalness: 0})),
  glow: () => mat('glow', () => new THREE.SpriteMaterial({name: 'authored-flare-glow', map: glowTex(), color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending})),
};

// ---------------------------------------------------------------------------------------------
// Geometry (open tubes + discs, merged per material)

function geo(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  return (geoCache[key] ??= make());
}

/** Open tube along +Y from y0 to y0 + h (thetaStart = PI puts u = 0.5, the label centre, at +Z). */
const tube = (rTop: number, rBot: number, h: number, y0: number, seg = 24) => new THREE.CylinderGeometry(rTop, rBot, h, seg, 1, true, Math.PI).translate(0, y0 + h / 2, 0);
const disc = (r: number, y: number, up: boolean, seg = 24) => new THREE.CircleGeometry(r, seg).rotateX(up ? -Math.PI / 2 : Math.PI / 2).translate(0, y, 0);
const ring = (r0: number, r1: number, y: number, up: boolean, seg = 24) => new THREE.RingGeometry(r0, r1, seg).rotateX(up ? -Math.PI / 2 : Math.PI / 2).translate(0, y, 0);

function merged(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const ni = parts.map(p => (p.index ? p.toNonIndexed() : p));
  const g = mergeGeometries(ni, false);
  for (const p of [...parts, ...ni]) if (p !== g) p.dispose();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

function batteryGeometry(): {label: THREE.BufferGeometry; steel: THREE.BufferGeometry} {
  const {r, h, nubR, nubH, crimp} = BATTERY_DIMS;
  const label = geo('battery.label', () => merged([tube(r, r, h - 2 * crimp, crimp, 28)]));
  const steel = geo('battery.steel', () => merged([
    tube(r * 0.985, r * 0.93, crimp, 0, 28), // bottom crimp
    tube(r * 0.93, r * 0.985, crimp, h - crimp, 28), // top shoulder
    disc(r * 0.93, 0, false, 28), // - terminal
    disc(r * 0.93, h, true, 28),
    tube(nubR, nubR, nubH, h, 16), disc(nubR, h + nubH, true, 16), // + nub
  ]));
  return {label, steel};
}

/** The flare's parts in the upright (+Y = head) frame centred on the tube, before laying it along X. */
function flareGeometry(capOnBase: boolean): Record<'label' | 'plug' | 'cap' | 'striker' | 'head', THREE.BufferGeometry> {
  const {bodyR, bodyLen, capR, capLen, capOverlap, headLen, total} = FLARE_DIMS;
  const y0 = -total / 2; // base end
  const headY = y0 + bodyLen;
  const lay = (g: THREE.BufferGeometry) => g.rotateZ(-Math.PI / 2).translate(0, FLARE_AXIS_Y, 0); // +Y -> +X, axis at the cap radius
  const key = capOnBase ? 'struck' : 'capped';
  const label = geo(`flare.label`, () => merged([lay(tube(bodyR, bodyR, bodyLen, y0, 22))]));
  // capped: the cap covers the head (open rim facing the base). struck: the cap pushed onto the base (rim facing the head).
  const capY0 = capOnBase ? y0 - capOverlap : total / 2 - capLen;
  const cap = geo(`flare.cap.${key}`, () => merged([
    lay(tube(capR, capR, capLen, capY0, 22)),
    lay(ring(bodyR, capR, capOnBase ? capY0 + capLen : capY0, capOnBase, 22)),
  ]));
  const striker = geo(`flare.striker.${key}`, () => merged([lay(disc(capR, capOnBase ? capY0 : capY0 + capLen, !capOnBase, 22))]));
  const plug = geo('flare.plug', () => merged([lay(disc(bodyR, y0, false, 22))]));
  // the exposed ignition head (struck flare only): a short slag-crusted stub past the tube end
  const head = geo('flare.head', () => merged([lay(tube(bodyR * 0.82, bodyR * 0.96, headLen, headY, 16)), lay(disc(bodyR * 0.82, headY + headLen, true, 16)), lay(disc(bodyR * 0.96, headY, true, 16))]));
  return {label, plug, cap, striker, head};
}

/** Mask lane: the filter canister — painted can (label), steel lid + intake face + threaded neck, rubber seal plug. */
function filterGeometry(): {can: THREE.BufferGeometry; steel: THREE.BufferGeometry; seal: THREE.BufferGeometry} {
  const {r, h, lid, neckR, neckH, ridges, seal} = FILTER_DIMS;
  const can = geo('filter.can', () => merged([tube(r, r, h, 0, 32)]));
  const steel = geo('filter.steel', () => {
    const parts = [
      disc(r, 0, false, 32), // intake face (on the floor)
      tube(r * 0.97, r, lid, h, 32), ring(neckR, r * 0.97, h + lid, true, 32), // domed lid shoulder + top
      tube(neckR, neckR, neckH, h + lid, 20), // threaded neck core
    ];
    for (let k = 0; k < ridges; k++) { // thread ridges
      const y = h + lid + (k + 0.5) * (neckH / ridges) - 0.0012;
      parts.push(tube(neckR + 0.0018, neckR + 0.0018, 0.0024, y, 20), ring(neckR, neckR + 0.0018, y + 0.0024, true, 20), ring(neckR, neckR + 0.0018, y, false, 20));
    }
    return merged(parts);
  });
  const sealGeo = geo('filter.seal', () => merged([tube(neckR * 0.9, neckR * 0.9, seal, h + lid + neckH, 20), disc(neckR * 0.9, h + lid + neckH + seal, true, 20), ring(neckR * 0.9, neckR, h + lid + neckH, true, 20)]));
  return {can, steel, seal: sealGeo};
}

function mesh(g: THREE.BufferGeometry, m: THREE.Material, name: string): THREE.Mesh {
  const o = new THREE.Mesh(g, m);
  o.name = name;
  return o;
}

/** A NEW group for an authored item (shared geometry / materials; the caller may clone it). */
export function authoredItemModel(id: AuthoredItemId): THREE.Group {
  const g = new THREE.Group();
  g.name = `authored-${id}`;
  g.userData.authored = true;
  if (id === 'battery') {
    const b = batteryGeometry();
    g.add(mesh(b.label, M.batteryLabel(), 'battery-label'), mesh(b.steel, M.steel(), 'battery-steel'));
  } else if (id === 'gas_filter') { // mask lane
    const f = filterGeometry();
    g.add(mesh(f.can, M.filterLabel(), 'filter-can'), mesh(f.steel, M.filterSteel(), 'filter-steel'), mesh(f.seal, M.filterSeal(), 'filter-seal'));
  } else {
    const f = flareGeometry(false);
    g.add(mesh(f.label, M.flareLabel(), 'flare-body'), mesh(f.plug, M.plug(), 'flare-plug'), mesh(f.cap, M.cap(), 'flare-cap'), mesh(f.striker, M.striker(), 'flare-striker'));
  }
  return g;
}

export interface ThrownFlareModel {
  root: THREE.Group;
  head: THREE.Mesh;
  glow: THREE.Sprite;
  /** Head position in the model frame (the light / smoke source). */
  headLocal: THREE.Vector3;
  setBurning(on: boolean): void;
}

/** A struck flare for throwing: cap on the base, burning head + additive glow sprite at +X. */
export function thrownFlareModel(): ThrownFlareModel {
  const f = flareGeometry(true);
  const root = new THREE.Group();
  root.name = 'thrown-flare';
  root.userData.authored = true;
  const head = mesh(f.head, M.hot(), 'flare-head');
  root.add(mesh(f.label, M.flareLabel(), 'flare-body'), mesh(f.plug, M.plug(), 'flare-plug'), mesh(f.cap, M.cap(), 'flare-cap'), mesh(f.striker, M.striker(), 'flare-striker'), head);
  const headLocal = new THREE.Vector3(FLARE_HEAD_X + FLARE_DIMS.headLen + 0.004, FLARE_AXIS_Y, 0);
  const glow = new THREE.Sprite(M.glow() as THREE.SpriteMaterial);
  glow.name = 'flare-glow';
  glow.position.copy(headLocal);
  glow.scale.setScalar(0.32);
  glow.renderOrder = 3;
  root.add(glow);
  for (const o of root.children) o.userData.shared = true;
  return {
    root, head, glow, headLocal,
    setBurning(on: boolean) { head.material = on ? M.hot() : M.ash(); glow.visible = on; },
  };
}

/** Bounds summary of an authored model (tests / QA): size in metres. */
export function authoredSize(id: AuthoredItemId): THREE.Vector3 {
  return new THREE.Box3().setFromObject(authoredItemModel(id)).getSize(new THREE.Vector3());
}

/** Drop the caches (tests that swap the canvas implementation). */
export function resetAuthoredItems(): void {
  texCache = {};
  matCache = {};
  geoCache = {};
}
