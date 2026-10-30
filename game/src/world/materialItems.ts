// Task office-props-physics-scale-20261030 (lane RACK): AUTHORED procedural world / held / icon models of the crafting materials
// (items/craftMaterials.ts), per the standing asset-method rule (simple shapes are controlled geometry). Nothing here is
// AI-generated: hand-dimensioned THREE boxes / cylinders / tori; the printed / painted surfaces are drawn on canvases in code
// (generic, unbranded, worn). No image or 3D generation service was used.
//
//  - electrical_parts: a salvaged green circuit board (chips, a relay, capacitors, a pin header) with two loops of insulated copper
//    wire zip-tied on top — the kind of thing stripped out of a dead server or switch.
//  - scrap_metal: a cut length of black rack rail (square-punched U channel), a bent galvanized L-bracket and a rusty plate offcut
//    leaning on them.
//  - bio_mater: a sealed screw-lid specimen jar, murky organic culture behind clear plastic, a biohazard label band, red lid.
// Frames follow world/pickups.ts: origin bottom-centre, front +Z, metres; the bounds equal MATERIAL_DIMS (tests). Geometry /
// materials are shared (cached once; templates flag them `userData.shared`); pickups clone materials for their highlight.

import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {BIO_MATER, ELECTRICAL_PARTS, SCRAP_METAL, isMaterialItem, type MaterialId} from '../items/craftMaterials';
import {canvasTexture} from './canvasTextures';

export {isMaterialItem};

/** Model source line (QA / itemModelSources). */
export const MATERIAL_MODEL_SOURCE = 'authored procedural geometry (world/materialItems.ts)';

let texCache: Record<string, THREE.Texture> = {};
let matCache: Record<string, THREE.Material> = {};
let geoCache: Record<string, THREE.BufferGeometry> = {};
const tex = (key: string, make: () => THREE.Texture) => (texCache[key] ??= make());
const mat = (key: string, make: () => THREE.Material) => (matCache[key] ??= make());
const geo = (key: string, make: () => THREE.BufferGeometry) => (geoCache[key] ??= make());

// ---------------------------------------------------------------------------------------------
// Canvas surfaces

/** Green solder-mask board top: copper traces, pads, white silkscreen boxes / text, a little grime. */
function pcbTex(): THREE.Texture {
  return tex('pcb', () => canvasTexture(256, 168, 7101, (ctx, w, h, r) => {
    ctx.fillStyle = '#1d5a33';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 500; i++) { ctx.fillStyle = `rgba(${r() < 0.5 ? '120,200,140' : '0,20,8'},${0.04 + r() * 0.05})`; ctx.fillRect(r() * w, r() * h, 1 + r() * 2, 1); }
    // copper traces (dull, under the mask): orthogonal runs with 45-degree jogs
    ctx.strokeStyle = 'rgba(176,150,74,0.55)';
    for (let i = 0; i < 46; i++) {
      ctx.lineWidth = r() < 0.2 ? 3 : 1.4;
      let x = r() * w, y = r() * h;
      ctx.beginPath(); ctx.moveTo(x, y);
      for (let k = 0; k < 3; k++) {
        const horiz = r() < 0.5, len = 12 + r() * 50;
        const nx = horiz ? x + (r() < 0.5 ? -len : len) : x + (r() - 0.5) * 10, ny = horiz ? y + (r() - 0.5) * 10 : y + (r() < 0.5 ? -len : len);
        ctx.lineTo(nx, ny); x = nx; y = ny;
      }
      ctx.stroke();
    }
    // tinned pads and vias
    for (let i = 0; i < 90; i++) { ctx.fillStyle = r() < 0.7 ? '#c9c4b2' : '#a8892f'; const s = 2 + r() * 3; ctx.fillRect(r() * w, r() * h, s, s); }
    // silkscreen outlines + refs
    ctx.strokeStyle = 'rgba(235,235,225,0.75)'; ctx.lineWidth = 1.2;
    for (const [x, y, bw, bh] of [[40, 50, 52, 52], [118, 22, 66, 26], [180, 96, 40, 34], [20, 128, 90, 18]]) ctx.strokeRect(x, y, bw, bh);
    ctx.fillStyle = 'rgba(235,235,225,0.8)'; ctx.font = '9px Arial';
    for (const [t, x, y] of [['U3', 42, 46], ['K1', 182, 92], ['C12', 140, 140], ['J4', 22, 124], ['REV C', 200, 160], ['PSU-CTRL', 120, 62]] as const) ctx.fillText(t, x, y);
    // handling grime and a scorch near the regulator
    const g = ctx.createRadialGradient(210, 40, 2, 210, 40, 30);
    g.addColorStop(0, 'rgba(30,22,10,0.55)'); g.addColorStop(1, 'rgba(30,22,10,0)');
    ctx.fillStyle = g; ctx.fillRect(170, 0, 80, 80);
  }));
}

/** Worn steel: galvanised spangle / scratches, optionally rust blooms (scrap pieces). */
function steelTex(key: string, base: string, rust: number, seed: number): THREE.Texture {
  return tex(key, () => canvasTexture(256, 128, seed, (ctx, w, h, r) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 120; i++) { // spangle / mill scale patches
      ctx.fillStyle = `rgba(${r() < 0.5 ? '255,255,255' : '0,0,0'},${0.04 + r() * 0.06})`;
      ctx.beginPath(); ctx.ellipse(r() * w, r() * h, 3 + r() * 10, 2 + r() * 7, r() * 3, 0, Math.PI * 2); ctx.fill();
    }
    ctx.lineCap = 'round';
    for (let i = 0; i < 80; i++) {
      const x = r() * w, y = r() * h, len = 4 + r() * 30, a = (r() - 0.5) * 0.6;
      ctx.strokeStyle = `rgba(${r() < 0.7 ? '235,235,230' : '20,20,20'},${0.15 + r() * 0.25})`; ctx.lineWidth = 0.6 + r();
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len); ctx.stroke();
    }
    for (let i = 0; i < rust; i++) {
      const x = r() * w, y = r() * h, rad = 4 + r() * 22;
      const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
      g.addColorStop(0, `rgba(122,58,22,${0.55 + r() * 0.3})`); g.addColorStop(0.6, 'rgba(150,80,34,0.3)'); g.addColorStop(1, 'rgba(150,80,34,0)');
      ctx.fillStyle = g; ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
  }));
}

/** Black powder-coated rack rail web with its square cage-nut holes (canvas x = along the rail). */
function railTex(): THREE.Texture {
  return tex('rail', () => canvasTexture(512, 32, 7303, (ctx, w, h, r) => {
    ctx.fillStyle = '#26282a';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 300; i++) { ctx.fillStyle = `rgba(255,255,255,${0.02 + r() * 0.05})`; ctx.fillRect(r() * w, r() * h, 1 + r() * 3, 1); }
    // EIA hole pattern: 3 holes per U (15.9 / 15.9 / 12.7 mm), drawn as dark squares with a bright cut edge
    for (let x = 6; x < w - 8; x += 21) {
      ctx.fillStyle = '#060606'; ctx.fillRect(x, 10, 11, 11);
      ctx.strokeStyle = 'rgba(190,190,180,0.5)'; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, 10.5, 10, 10);
    }
    // the cut end: bright raw steel at the right
    ctx.fillStyle = '#9a9a92'; ctx.fillRect(w - 6, 0, 6, h);
  }));
}

/** Specimen jar wrap: canvas x = around the jar (front = centre), top = the lid end. Culture behind clear plastic + a label band. */
function jarTex(): THREE.Texture {
  return tex('jar', () => canvasTexture(256, 128, 7507, (ctx, w, h, r) => {
    // headspace (clear plastic, pale) above the fill line
    ctx.fillStyle = '#b9c2bd';
    ctx.fillRect(0, 0, w, h);
    const fill = 30;
    const g = ctx.createLinearGradient(0, fill, 0, h);
    g.addColorStop(0, '#6f7a3a'); g.addColorStop(0.5, '#4f5a2a'); g.addColorStop(1, '#3a3020');
    ctx.fillStyle = g; ctx.fillRect(0, fill, w, h - fill);
    // meniscus, suspended matter, bubbles
    ctx.fillStyle = 'rgba(210,220,170,0.55)'; ctx.fillRect(0, fill - 1, w, 3);
    for (let i = 0; i < 160; i++) { ctx.fillStyle = `rgba(${r() < 0.5 ? '160,150,90' : '40,30,18'},${0.25 + r() * 0.4})`; ctx.beginPath(); ctx.ellipse(r() * w, fill + 4 + r() * (h - fill - 6), 1 + r() * 4, 1 + r() * 3, r() * 3, 0, Math.PI * 2); ctx.fill(); }
    for (let i = 0; i < 26; i++) { ctx.strokeStyle = 'rgba(230,235,210,0.55)'; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.arc(r() * w, fill + 3 + r() * 30, 1 + r() * 2.2, 0, Math.PI * 2); ctx.stroke(); }
    // a few highlights on the plastic (vertical streaks)
    for (const x of [w * 0.38, w * 0.88]) { ctx.fillStyle = 'rgba(255,255,255,0.22)'; ctx.fillRect(x, 0, 5, h); }
    // label band in front (u 0.5): white with a biohazard mark and handwriting
    const lx = w * 0.3, lw = w * 0.4, ly = 52, lh = 52;
    ctx.fillStyle = '#efece2'; ctx.fillRect(lx, ly, lw, lh);
    ctx.fillStyle = '#e0a21a'; ctx.fillRect(lx, ly, lw, 13);
    ctx.fillStyle = '#1b1b1b'; ctx.font = 'bold 9px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('BIOHAZARD', lx + lw / 2 + 6, ly + 7);
    // trefoil (three circles + centre ring) in the band's corner
    const cx = lx + 9, cy = ly + 7;
    ctx.strokeStyle = '#1b1b1b'; ctx.lineWidth = 1.2;
    for (let k = 0; k < 3; k++) { const a = -Math.PI / 2 + k * (2 * Math.PI / 3); ctx.beginPath(); ctx.arc(cx + Math.cos(a) * 2.6, cy + Math.sin(a) * 2.6, 2.4, 0, Math.PI * 2); ctx.stroke(); }
    ctx.font = '8px Arial'; ctx.fillStyle = '#2a2a2a';
    ctx.fillText('SPECIMEN · KEEP SEALED', lx + lw / 2, ly + 22);
    ctx.strokeStyle = 'rgba(40,40,90,0.75)'; ctx.lineWidth = 1;
    for (const y of [ly + 32, ly + 41]) { ctx.beginPath(); ctx.moveTo(lx + 8, y); for (let x = lx + 8; x < lx + lw - 10; x += 6) ctx.lineTo(x + 3, y + (r() - 0.5) * 3); ctx.stroke(); }
    ctx.fillStyle = 'rgba(60,50,30,0.25)'; ctx.fillRect(lx, ly + lh - 6, lw, 6); // grime at the band's foot
  }));
}

// ---------------------------------------------------------------------------------------------
// Materials

const std = (name: string, o: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial({name, ...o});
const M = {
  pcb: () => mat('pcb', () => std('material-pcb', {map: pcbTex(), roughness: 0.55, metalness: 0.05})),
  pcbEdge: () => mat('pcbEdge', () => std('material-pcb-edge', {color: 0x2c4f33, roughness: 0.7, metalness: 0})),
  chip: () => mat('chip', () => std('material-chip', {color: 0x161718, roughness: 0.45, metalness: 0.1})),
  relay: () => mat('relay', () => std('material-relay', {color: 0x2c4f8a, roughness: 0.5, metalness: 0})),
  wireRed: () => mat('wireRed', () => std('material-wire-red', {color: 0xa3291f, roughness: 0.5, metalness: 0})),
  wireCopper: () => mat('wireCopper', () => std('material-wire-copper', {color: 0xb5713a, roughness: 0.35, metalness: 0.75})),
  tie: () => mat('tie', () => std('material-zip-tie', {color: 0xd9d6cc, roughness: 0.6, metalness: 0})),
  galv: () => mat('galv', () => std('material-scrap-galv', {map: steelTex('galv', '#9da2a3', 5, 7211), roughness: 0.45, metalness: 0.55})),
  rusty: () => mat('rusty', () => std('material-scrap-rusty', {map: steelTex('rusty', '#7c7a74', 26, 7223), roughness: 0.7, metalness: 0.35})),
  rail: () => mat('rail', () => std('material-scrap-rail', {map: railTex(), roughness: 0.6, metalness: 0.3})),
  railEdge: () => mat('railEdge', () => std('material-scrap-rail-edge', {color: 0x2a2c2e, roughness: 0.6, metalness: 0.3})),
  jar: () => mat('jar', () => std('material-jar', {map: jarTex(), roughness: 0.22, metalness: 0})),
  jarBase: () => mat('jarBase', () => std('material-jar-base', {color: 0x4a4a30, roughness: 0.3, metalness: 0})),
  lid: () => mat('lid', () => std('material-jar-lid', {color: 0xb2302a, roughness: 0.55, metalness: 0})),
};

// ---------------------------------------------------------------------------------------------
// Geometry

function merged(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const ni = parts.map(p => (p.index ? p.toNonIndexed() : p));
  for (const p of ni) if (!p.attributes.uv) p.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(p.attributes.position.count * 2), 2));
  const g = mergeGeometries(ni, false);
  for (const p of [...parts, ...ni]) if (p !== g) p.dispose();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}
/** Box w x h x d with its bottom at y0, centred on (x, z), turned `ry` about Y and `rz` about Z (around its own centre). */
const box = (w: number, h: number, d: number, x: number, y0: number, z: number, ry = 0, rz = 0) => {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rz) g.rotateZ(rz);
  if (ry) g.rotateY(ry);
  return g.translate(x, y0 + h / 2, z);
};
const cylY = (r0: number, r1: number, h: number, x: number, y0: number, z: number, seg = 16, open = false) => new THREE.CylinderGeometry(r0, r1, h, seg, 1, open, Math.PI).translate(x, y0 + h / 2, z);

/** Electrical parts: the board (+ chips / relay / caps / header) and two zip-tied wire loops lying on it. */
const PCB = {w: 0.13, d: 0.085, t: 0.0016} as const;
function electricalGeometry(): Record<'board' | 'edge' | 'chips' | 'relay' | 'red' | 'copper' | 'tie', THREE.BufferGeometry> {
  const t = PCB.t;
  return {
    // the board top carries the texture (a thin box: top face mapped, the edges a plain material)
    board: geo('ep.board', () => merged([new THREE.PlaneGeometry(PCB.w, PCB.d).rotateX(-Math.PI / 2).translate(0, t, 0)])),
    edge: geo('ep.edge', () => merged([box(PCB.w, t * 0.98, PCB.d, 0, 0, 0)])),
    chips: geo('ep.chips', () => merged([
      box(0.021, 0.0028, 0.021, -0.033, t, -0.008), // QFP controller
      box(0.03, 0.0042, 0.0095, 0.002, t, -0.028), // DIP
      box(0.012, 0.0026, 0.008, 0.024, t, 0.004),
      box(0.042, 0.0085, 0.0062, -0.02, t, 0.035), // pin header along the front edge
      cylY(0.0048, 0.0048, 0.012, 0.05, t, 0.026), cylY(0.0042, 0.0042, 0.0105, 0.04, t, 0.031), // capacitors
    ])),
    relay: geo('ep.relay', () => merged([box(0.019, 0.015, 0.016, 0.04, t, -0.024)])),
    // two loops of insulated wire (a red one, a bare-copper one), lying flat on the board's left half, crossing at a slight tilt
    red: geo('ep.red', () => merged([new THREE.TorusGeometry(0.027, 0.0042, 8, 30).rotateX(Math.PI / 2).rotateZ(0.08).translate(-0.012, t + 0.0072, 0.004)])),
    copper: geo('ep.copper', () => merged([new THREE.TorusGeometry(0.023, 0.0026, 6, 28).rotateX(Math.PI / 2).rotateZ(-0.12).translate(-0.006, t + 0.0128, -0.002)])),
    tie: geo('ep.tie', () => merged([box(0.007, 0.0145, 0.012, 0.0165, t + 0.0025, 0.004)])),
  };
}

/** Scrap metal: a cut length of rack rail, a bent L-bracket and a rusty plate offcut leaning on them. */
function scrapGeometry(): Record<'railWeb' | 'railEdge' | 'galv' | 'rusty', THREE.BufferGeometry> {
  const L = 0.2, web = 0.019, fl = 0.012, th = 0.0018, zr = -0.048;
  return {
    // rail lying on its back edge, punched web standing and facing the front (+Z, square holes visible), flanges running back
    railWeb: geo('sm.web', () => merged([new THREE.PlaneGeometry(L, web).translate(0.005, web / 2, zr + fl)])),
    railEdge: geo('sm.edge', () => merged([box(L, web, th, 0.005, 0, zr + fl - th / 2 - 0.0002), box(L, th, fl, 0.005, 0, zr + fl / 2), box(L, th, fl, 0.005, web - th, zr + fl / 2)])),
    // L-bracket: flat leg on the floor, a bent-up leg at its end (turned a little on the floor)
    galv: geo('sm.galv', () => {
      const flat = new THREE.BoxGeometry(0.085, 0.003, 0.038).translate(0.0425, 0.0015, 0);
      const up = new THREE.BoxGeometry(0.003, 0.034, 0.038).translate(0.0855, 0.017, 0);
      const g = merged([flat, up]);
      return g.rotateY(0.35).translate(0.005, 0, 0.03);
    }),
    // plate offcut: one edge on the floor, leaning on the rail's flange / the bracket (tilted ~12 degrees)
    rusty: geo('sm.plate', () => box(0.13, 0.0025, 0.082, -0.035, 0, 0.012, -0.18, 0.12).translate(0, 0.0079, 0)), // lowest corner on the floor
  };
}

/** Bio mater: jar body (wrap texture), its base, a red screw lid. */
const JAR = {r: 0.034, h: 0.08, lidR: 0.0365, lidH: 0.02} as const;
function jarGeometry(): Record<'body' | 'base' | 'lid', THREE.BufferGeometry> {
  const {r, h, lidR, lidH} = JAR;
  return {
    body: geo('bm.body', () => merged([cylY(r, r * 0.97, h, 0, 0, 0, 28, true)])),
    base: geo('bm.base', () => merged([new THREE.CircleGeometry(r * 0.97, 28).rotateX(Math.PI / 2)])),
    lid: geo('bm.lid', () => {
      const parts: THREE.BufferGeometry[] = [cylY(lidR, lidR, lidH, 0, h - 0.002, 0, 28, true), new THREE.CircleGeometry(lidR, 28).rotateX(-Math.PI / 2).translate(0, h - 0.002 + lidH, 0)];
      for (let k = 0; k < 24; k++) { // knurled grip ribs
        const a = (k / 24) * Math.PI * 2;
        parts.push(new THREE.BoxGeometry(0.0022, lidH * 0.8, 0.0016).rotateY(-a).translate(Math.sin(a) * lidR, h - 0.002 + lidH / 2, Math.cos(a) * lidR));
      }
      return merged(parts);
    }),
  };
}

function mesh(g: THREE.BufferGeometry, m: THREE.Material, name: string): THREE.Mesh {
  const o = new THREE.Mesh(g, m);
  o.name = name;
  return o;
}

/** A NEW group for a material item (shared geometry / materials; the caller may clone it). */
export function materialItemModel(id: MaterialId): THREE.Group {
  const g = new THREE.Group();
  g.name = `material-${id}`;
  g.userData.authored = true;
  if (id === ELECTRICAL_PARTS) {
    const e = electricalGeometry();
    g.add(mesh(e.board, M.pcb(), 'ep-board'), mesh(e.edge, M.pcbEdge(), 'ep-board-edge'), mesh(e.chips, M.chip(), 'ep-chips'), mesh(e.relay, M.relay(), 'ep-relay'),
      mesh(e.red, M.wireRed(), 'ep-wire'), mesh(e.copper, M.wireCopper(), 'ep-wire-copper'), mesh(e.tie, M.tie(), 'ep-zip-tie'));
  } else if (id === SCRAP_METAL) {
    const s = scrapGeometry();
    g.add(mesh(s.railWeb, M.rail(), 'sm-rail'), mesh(s.railEdge, M.railEdge(), 'sm-rail-edge'), mesh(s.galv, M.galv(), 'sm-bracket'), mesh(s.rusty, M.rusty(), 'sm-plate'));
  } else if (id === BIO_MATER) {
    const j = jarGeometry();
    g.add(mesh(j.body, M.jar(), 'bm-jar'), mesh(j.base, M.jarBase(), 'bm-jar-base'), mesh(j.lid, M.lid(), 'bm-lid'));
  }
  return g;
}

/** Bounds summary of a material model (tests / QA): size in metres. */
export function materialModelSize(id: MaterialId): THREE.Vector3 {
  return new THREE.Box3().setFromObject(materialItemModel(id)).getSize(new THREE.Vector3());
}

/** Drop the caches (tests that swap the canvas implementation). */
export function resetMaterialItems(): void {
  texCache = {};
  matCache = {};
  geoCache = {};
}
