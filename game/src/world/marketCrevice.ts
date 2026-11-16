// Task studio-survivor-market-crevice-20261116-074419 (lane VIEW): THE CREVICE's view (Survivor Market layout version 5) — what makes
// the boxes along both sides unmistakably SHIPPING CONTAINERS, and the bridges between the sides. Planned by gen/market/v5/art.ts (pure),
// built here as handmade reusable geometry over the arch's painted grid walls (world/marketArch.ts paints them):
//  - per container (closed ones too): the steel frame on the front — corner posts, top / bottom side rails, corner castings with their
//    dark oval holes, a dark slot between two neighbours — proud corrugation ribs on the front wall; on every visible end the frame and
//    the CARGO-DOOR END (two leaves with horizontal ribs, four locking bars, cam keepers, handles); windows mounted proud of the front
//    (frame + dark / warm-lit / mesh / boarded pane; a lit pane is an emissive warm card: a dynamic effect), door architraves, a steel
//    canopy over some home doors, roof vents, the shopfronts' roll-up shutter boxes and guides;
//  - the BRIDGES: the cooked kit (assets/marketBridgeKit.generated.ts, the user's model cut into End / Mid / MidPlain / Trestle with its
//    own PBR maps, kept) instanced per piece mesh — one InstancedMesh per piece part PER BRIDGE (its own bounds: each bridge frustum-
//    culled alone; tagged userData.level = the deck's storey), the library's geometry / material shared and never disposed here. When
//    the kit is not delivered (a failed fetch) the same placements draw simple stand-in pieces (deck, girders, rails) so the walkable
//    deck is never invisible;
//  - the lines across the crevice (gen/market/v5/art.ts creviceLines): wires + their poles (the market's line steel; the laundry is
//    world/marketClothes.ts, built by world/marketVisuals.ts).
// Materials: ONE painted-steel material for every painted / steel part (the shared painted-panel surface set, world-mapped, tinted by
// vertex colour: the container's paint, its frame, dark steel, galvanised sheet), the window glass, the warm lit pane, the boards (the
// market's Codex plywood, world-mapped; the painted steel in brown while it is not loaded). Geometry merged per material per ~48 m
// chunk; static (no per-frame work); everything this module creates is listed for the teardown (world/marketVisuals.ts disposes it).

import * as THREE from 'three';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import type {StationLayout} from '../gen/stationTypes';
import {MARKET_BRIDGE_KIT} from '../assets/marketBridgeKit.generated';
import type {MarketTextureKey} from '../assets/marketTextures.generated';
import {CREV_ART, crevLineY, crevOf, creviceBridgePieces, creviceContainerArt, type BridgePieceName, type CrevBridgePiece, type CrevContainerArt, type CrevEnd, type CrevLine} from '../gen/market/v5/art';
import {SurfaceNodeMaterial, surfaceMaterial, thinTrim, worldMapped} from './materials';
import {MARKET_PAINTS} from './marketArch';
import {marketSpan, marketTexture} from './marketTextures';

/** The bridge kit's lazy prop-library entry (game.ts propModels / sectionModelKeys): market-only (assets/levelAssets.ts 'market-*'). */
export const MARKET_BRIDGE_KEY = MARKET_BRIDGE_KIT.key;
export const MARKET_BRIDGE_MODEL_FILES: Readonly<Record<string, {url: string; bytes: number}>> = {[MARKET_BRIDGE_KIT.key]: {url: MARKET_BRIDGE_KIT.url, bytes: MARKET_BRIDGE_KIT.bytes}};
/** The kit's key for a layout that needs it: only a version-5 market with bridges ever fetches the kit. */
export function marketBridgeModelKeys(layout: {market?: StationLayout['market']}): string[] {
  const m = layout.market;
  return m?.v === 5 && m.crevice && m.crevice.bridges.length ? [MARKET_BRIDGE_KEY] : [];
}

/** Merge chunk size (m). */
const CHUNK = 48;
/** Mean linear albedo of each market texture (the painted wall's apparent tone: measured from the cooked JPEGs) and of the painted-panel
 *  surface set the frame parts use, so a frame tinted by vertex colour sits in the same tone as the wall it is fixed to. */
const TEX_MEAN: Readonly<Record<MarketTextureKey, number>> = {wall: 0x98816f, roof: 0x8a8a86, rib: 0x746c63, ply: 0xa09183, tarp: 0x8f6f4f};
const PANEL_MEAN = 0.6;

type V3 = [number, number, number];
type Rgb = THREE.Color;
const grey = (v: number): Rgb => new THREE.Color(v, v, v);
const COL = {
  hole: grey(0.012), gap: grey(0.018), dark: grey(0.085), bar: new THREE.Color(0.11, 0.1, 0.09), galv: new THREE.Color(0.42, 0.42, 0.4),
  galvDark: grey(0.2), board: new THREE.Color(1, 0.93, 0.86), boardStandin: new THREE.Color(0.42, 0.3, 0.19),
  rust: new THREE.Color(0.32, 0.17, 0.1), deck: new THREE.Color(0.28, 0.25, 0.22), wire: grey(0.1),
};
const CURTAINS = [0x8c3b30, 0x2f5b4a, 0xc9b27a, 0x56407a, 0x9a6a2e].map(h => new THREE.Color(h).multiplyScalar(0.55));

/** A container paint's body tone (linear vertex colour over the painted-panel set): the wall's texture mean x paint x gain. */
export function crevPaintColour(paint: number): THREE.Color {
  const P = MARKET_PAINTS[((paint % MARKET_PAINTS.length) + MARKET_PAINTS.length) % MARKET_PAINTS.length];
  return new THREE.Color(P.color).multiplyScalar(P.gain).multiply(new THREE.Color(TEX_MEAN[P.tex] ?? 0x808080)).multiplyScalar(1 / PANEL_MEAN);
}

/** Flat-shaded triangle soup with vertex colours (one per material per chunk). */
class Acc {
  readonly p: number[] = [];
  readonly n: number[] = [];
  readonly c: number[] = [];
  get tris(): number { return this.p.length / 9; }
  /** A planar quad a b c d (a cycle), facing `away` from `centre` (or along `normal` when given). */
  quad(a: V3, b: V3, c: V3, d: V3, col: Rgb, ref: {centre?: V3; normal?: V3}): void {
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
    let nx = e1[1] * e2[2] - e1[2] * e2[1], ny = e1[2] * e2[0] - e1[0] * e2[2], nz = e1[0] * e2[1] - e1[1] * e2[0];
    const l = Math.hypot(nx, ny, nz);
    if (l < 1e-12) return;
    nx /= l; ny /= l; nz /= l;
    let want: V3;
    if (ref.normal) want = ref.normal;
    else { const fc = [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2, (a[2] + c[2]) / 2], o = ref.centre!; want = [fc[0] - o[0], fc[1] - o[1], fc[2] - o[2]]; }
    let q = [a, b, c, d];
    if (nx * want[0] + ny * want[1] + nz * want[2] < 0) { q = [a, d, c, b]; nx = -nx; ny = -ny; nz = -nz; }
    for (const i of [0, 1, 2, 0, 2, 3]) { this.p.push(q[i][0], q[i][1], q[i][2]); this.n.push(nx, ny, nz); this.c.push(col.r, col.g, col.b); }
  }
  /** A hexahedron (box topology: 0..3 the -w face, 4..7 the +w face, each cycle u0v0, u1v0, u1v1, u0v1); faces whose outward normal
   *  points along `skip` (a wall it stands on) are left out. */
  hexa(v: V3[], col: Rgb, skip?: V3): void {
    const ce: V3 = [0, 0, 0];
    for (const p of v) { ce[0] += p[0] / 8; ce[1] += p[1] / 8; ce[2] += p[2] / 8; }
    for (const f of HEXA_FACES) {
      if (skip) {
        const fc = [0, 1, 2].map(k => (v[f[0]][k] + v[f[1]][k] + v[f[2]][k] + v[f[3]][k]) / 4 - ce[k]);
        const l = Math.hypot(fc[0], fc[1], fc[2]) || 1;
        if ((fc[0] * skip[0] + fc[1] * skip[1] + fc[2] * skip[2]) / l > 0.9) continue;
      }
      this.quad(v[f[0]], v[f[1]], v[f[2]], v[f[3]], col, {centre: ce});
    }
  }
  box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, col: Rgb, skip?: V3): void {
    if (x1 - x0 < 1e-5 || y1 - y0 < 1e-5 || z1 - z0 < 1e-5) return;
    this.hexa([[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], col, skip);
  }
  /** A thin 4-sided rod from a to b (no caps). */
  rod(a: V3, b: V3, r: number, col: Rgb): void {
    const d = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    if (d.lengthSq() < 1e-10) return;
    d.normalize();
    const up = Math.abs(d.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const u = new THREE.Vector3().crossVectors(d, up).normalize().multiplyScalar(r), w = new THREE.Vector3().crossVectors(d, u).normalize().multiplyScalar(r);
    const at = (p: V3, su: number, sw: number): V3 => [p[0] + u.x * su + w.x * sw, p[1] + u.y * su + w.y * sw, p[2] + u.z * su + w.z * sw];
    const ring = [[1, 1], [-1, 1], [-1, -1], [1, -1]];
    const mid: V3 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
    for (let k = 0; k < 4; k++) {
      const [s0, w0] = ring[k], [s1, w1] = ring[(k + 1) % 4];
      const nrm: V3 = [u.x * (s0 + s1) + w.x * (w0 + w1), u.y * (s0 + s1) + w.y * (w0 + w1), u.z * (s0 + s1) + w.z * (w0 + w1)];
      this.quad(at(a, s0, w0), at(a, s1, w1), at(b, s1, w1), at(b, s0, w0), col, {normal: nrm, centre: mid});
    }
  }
  geometry(): THREE.BufferGeometry | null {
    if (!this.p.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(this.p.length / 3 * 2), 2)); // (world-mapped: never sampled)
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
}
const HEXA_FACES = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 4, 7, 3], [1, 2, 6, 5], [0, 1, 5, 4], [3, 7, 6, 2]] as const;

type MatKey = 'paint' | 'glass' | 'lit' | 'boards';

/** The built crevice view (QA / tests): its meshes under `group`, what it created (for the teardown). */
export interface CreviceView {
  group: THREE.Group;
  art: CrevContainerArt[];
  /** Containers given their frame (= every container), visible ends given the cargo-door end, windows (and lit ones). */
  frames: number;
  doorEnds: number;
  windows: number;
  lit: number;
  pieces: CrevBridgePiece[];
  /** The bridges' source: the cooked kit, the stand-in pieces (kit not delivered), none (no bridge). */
  kit: 'model' | 'standin' | 'none';
  triangles: number;
  draws: number;
  geometries: THREE.BufferGeometry[];
  materials: THREE.Material[];
  textures: THREE.Texture[];
}

/** The painted steel (one material for every painted part; thin-trim maps: many parts are slim). */
function paintMaterial(made: {textures: THREE.Texture[]}): SurfaceNodeMaterial {
  const m = surfaceMaterial('paintedPanel', {metalness: 0.2, vertexColors: true}, {grime: [0.32, 0.55], macro: 0.14});
  const before = [m.map, m.normalMap, m.roughnessMap];
  thinTrim(m);
  for (const t of [m.map, m.normalMap, m.roughnessMap]) if (t && !before.includes(t)) made.textures.push(t);
  m.name = 'crevice-paint';
  return m;
}

/**
 * Builds the crevice view of a version-5 market layout (null: any other layout). `bridgeKit`: the loaded market-bridge-kit.glb (null /
 * absent: the stand-in pieces). Pure three.js (tests and the CPU QA call it directly).
 */
export function buildCreviceView(layout: StationLayout, opts: {bridgeKit?: GLTF | null} = {}): CreviceView | null {
  const cr = crevOf(layout);
  if (!cr) return null;
  const group = new THREE.Group();
  group.name = 'market-crevice';
  const view: CreviceView = {group, art: [], frames: 0, doorEnds: 0, windows: 0, lit: 0, pieces: [], kit: 'none', triangles: 0, draws: 0, geometries: [], materials: [], textures: []};
  const mats = new Map<MatKey, THREE.Material>();
  const matOf = (k: MatKey): THREE.Material => {
    let m = mats.get(k);
    if (m) return m;
    if (k === 'paint') m = paintMaterial(view);
    else if (k === 'glass') { m = surfaceMaterial('glass', {color: 0x39424a, roughness: 0.22, metalness: 0.05}); m.name = 'crevice-glass'; }
    else if (k === 'lit') { m = new SurfaceNodeMaterial({color: 0x24180c, emissive: 0xffb267, emissiveIntensity: 1.5, roughness: 0.45, metalness: 0}); m.name = 'crevice-window-lit'; }
    else {
      const t = marketTexture('ply');
      const b = new SurfaceNodeMaterial({map: t, vertexColors: true, roughness: 0.88, metalness: 0});
      m = worldMapped(b, {span: [marketSpan('ply').u, marketSpan('ply').v], grime: [0.2, 0.5], macro: 0.2});
      m.name = 'crevice-boards';
    }
    mats.set(k, m);
    view.materials.push(m);
    return m;
  };
  const accs = new Map<string, {key: MatKey; acc: Acc; levels: Set<number>}>();
  const accOf = (key: MatKey, x: number, z: number, level: number): Acc => {
    const k = `${key}@${Math.floor(x / CHUNK)},${Math.floor(z / CHUNK)}`;
    let e = accs.get(k);
    if (!e) accs.set(k, (e = {key, acc: new Acc(), levels: new Set()}));
    e.levels.add(level);
    return e.acc;
  };
  const boardsTextured = !!marketTexture('ply');

  // --- the containers ---
  view.art = creviceContainerArt(layout);
  for (const c of view.art) {
    const cx = c.axis === 'z' ? c.front : (c.s0 + c.s1) / 2, cz = c.axis === 'z' ? (c.s0 + c.s1) / 2 : c.front;
    const paint = accOf('paint', cx, cz, c.level), glass = accOf('glass', cx, cz, c.level), lit = accOf('lit', cx, cz, c.level);
    const boards = boardsTextured ? accOf('boards', cx, cz, c.level) : paint;
    const stats = buildContainer(c, {paint, glass, lit, boards}, boardsTextured, layout.seed >>> 0);
    view.frames++;
    view.doorEnds += stats.doorEnds;
    view.windows += c.windows.length;
    view.lit += c.windows.filter(w => w.kind === 'lit').length;
  }

  // --- the bridges: the kit's pieces (or the stand-in) instanced per piece part PER BRIDGE (each bridge's own bounds: frustum-culled
  //     on its own, never the whole crevice's kit for one deck in view), tagged with the deck's storey; geometry / material shared ---
  view.pieces = creviceBridgePieces(layout, MARKET_BRIDGE_KIT);
  if (view.pieces.length) {
    const parts = kitParts(opts.bridgeKit) ?? standinParts(view, matOf('paint'));
    view.kit = parts.model ? 'model' : 'standin';
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    cr.bridges.forEach((b, bi) => {
      for (const [name, list] of parts.pieces) {
        const mine = view.pieces.filter(p => p.bridge === bi && p.piece === name);
        if (!mine.length) continue;
        for (const part of list) {
          const im = new THREE.InstancedMesh(part.geometry, part.material, mine.length);
          im.name = `market-bridge-${bi}-${name}`;
          mine.forEach((p, i) => {
            m.compose(new THREE.Vector3(p.x, p.y, p.z), q.setFromAxisAngle(up, p.yaw), new THREE.Vector3(p.sx, 1, 1)).multiply(part.local);
            im.setMatrixAt(i, m);
          });
          im.instanceMatrix.needsUpdate = true;
          im.computeBoundingBox();
          im.computeBoundingSphere();
          im.userData.level = b.level;
          group.add(im);
          view.draws++;
          view.triangles += triangles(part.geometry) * mine.length;
        }
      }
    });
  }

  // --- merge: one mesh per material per chunk ---
  for (const [k, {key, acc, levels}] of [...accs].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const g = acc.geometry();
    if (!g) continue;
    const mesh = new THREE.Mesh(g, matOf(key));
    mesh.name = `market-crevice-${k}`;
    // (a chunk holds the containers of several storeys: tagged with all of them; userData.level its lowest)
    const lv = [...levels].sort((a, b) => a - b);
    mesh.userData.level = lv[0] ?? 0;
    if (lv.length > 1) mesh.userData.levels = lv;
    group.add(mesh);
    view.geometries.push(g);
    view.draws++;
    view.triangles += acc.tris;
  }
  group.traverse(o => { if (o === group) return; o.castShadow = false; o.receiveShadow = false; o.userData.level ??= 0; });
  return view;
}

const triangles = (g: THREE.BufferGeometry) => (g.index ? g.index.count : g.getAttribute('position').count) / 3;

/** One container's frame, ribs, ends, openings, windows and vents into the accumulators; how many cargo-door ends it got. */
function buildContainer(c: CrevContainerArt, A: {paint: Acc; glass: Acc; lit: Acc; boards: Acc}, boardsTextured: boolean, seed: number): {doorEnds: number} {
  const F = CREV_ART.frame, R = CREV_ART.rib, D = CREV_ART.door, Wn = CREV_ART.window, Cg = CREV_ART.cargo, S = CREV_ART.shutter, V = CREV_ART.vent;
  const y = c.y, top = c.top, out = c.out;
  const body = crevPaintColour(c.paint), frame = body.clone().multiplyScalar(0.74), casting = body.clone().multiplyScalar(0.58);
  const arch = body.clone().multiplyScalar(0.66);
  // (s along the front, u outward from the front plane, y) -> world
  const W = (s: number, u: number, yy: number): V3 => (c.axis === 'z' ? [c.front + out * u, yy, s] : [s, yy, c.front + out * u]);
  const nOut: V3 = c.axis === 'z' ? [out, 0, 0] : [0, 0, out];
  const back: V3 = [-nOut[0], 0, -nOut[2]];
  /** A box in front coordinates (its face against the wall left out unless `keepBack`). */
  const fbox = (acc: Acc, s0: number, s1: number, u0: number, u1: number, y0: number, y1: number, col: Rgb, keepBack = false) => {
    const a = W(Math.min(s0, s1), Math.min(u0, u1), y0), b = W(Math.max(s0, s1), Math.max(u0, u1), y1);
    acc.box(Math.min(a[0], b[0]), Math.max(a[0], b[0]), y0, y1, Math.min(a[2], b[2]), Math.max(a[2], b[2]), col, keepBack ? undefined : back);
  };
  /** A box on an end: s outward from its plane by v, n the front's normal-axis coordinate (absolute). */
  const ebox = (acc: Acc, e: CrevEnd, nA: number, nB: number, v0: number, v1: number, y0: number, y1: number, col: Rgb) => {
    const sA = e.at + e.out * v0, sB = e.at + e.out * v1;
    const s0 = Math.min(sA, sB), s1 = Math.max(sA, sB), n0 = Math.min(nA, nB), n1 = Math.max(nA, nB);
    const skip: V3 = c.axis === 'z' ? [0, 0, -e.out] : [-e.out, 0, 0];
    if (c.axis === 'z') acc.box(n0, n1, y0, y1, s0, s1, col, skip); else acc.box(s0, s1, y0, y1, n0, n1, col, skip);
  };
  /** A front-facing quad (holes, panes, curtains) at u. */
  const fquad = (acc: Acc, s0: number, s1: number, u: number, y0: number, y1: number, col: Rgb) => acc.quad(W(s0, u, y0), W(s1, u, y0), W(s1, u, y1), W(s0, u, y1), col, {normal: nOut});
  const equad = (acc: Acc, e: CrevEnd, n0: number, n1: number, v: number, y0: number, y1: number, col: Rgb) => {
    const s = e.at + e.out * v, P = (n: number, yy: number): V3 => (c.axis === 'z' ? [n, yy, s] : [s, yy, n]);
    acc.quad(P(n0, y0), P(n1, y0), P(n1, y1), P(n0, y1), col, {normal: c.axis === 'z' ? [0, 0, e.out] : [e.out, 0, 0]});
  };
  const rnd = (k: number) => {
    let h = Math.imul((seed ^ 0x2545f491) + c.index * 0x9e3779b1, 0x85ebca6b) ^ Math.imul(k + 0x632be5ab, 0xc2b2ae35);
    h ^= h >>> 15; h = Math.imul(h, 0x27d4eb2f); h ^= h >>> 13;
    return (h >>> 0) / 0x100000000;
  };

  // --- corner posts, side rails, castings, the slot between neighbours ---
  const postRange = (e: CrevEnd): [number, number] => {
    const r: [number, number] = e.visible ? [e.at - e.out * (F.post - F.endProud), e.at + e.out * F.endProud] : e.shared ? [e.at - e.out * (F.post + F.gap), e.at - e.out * F.gap] : [e.at - e.out * F.post, e.at];
    return [Math.min(...r), Math.max(...r)];
  };
  const inner = (e: CrevEnd) => { const [a, b] = postRange(e); return e.out < 0 ? b : a; };
  for (const e of c.ends) {
    const [a, b] = postRange(e);
    fbox(A.paint, a, b, e.visible ? F.postProud - F.post : 0, F.postProud, y, top, frame);
    const [ca, cb] = [a - 0.02, b + 0.02];
    const [cu0, cu1] = [e.visible ? F.postProud - F.post - 0.012 : 0, F.casting[2]];
    for (const [y0, y1] of [[y, y + F.casting[1]], [top - F.casting[1], top]]) {
      fbox(A.paint, ca, cb, cu0, cu1, y0, y1, casting);
      const sc = (ca + cb) / 2, yc = (y0 + y1) / 2;
      fquad(A.paint, sc - 0.05, sc + 0.05, cu1 + 0.002, yc - 0.028, yc + 0.028, COL.hole);
      if (e.visible) {
        const so = e.out > 0 ? cb : ca, nc = c.front + out * (cu0 + cu1) / 2;
        const v = (so - e.at) * e.out + 0.002;
        equad(A.paint, e, nc - 0.045, nc + 0.045, v, yc - 0.028, yc + 0.028, COL.hole);
      }
    }
  }
  if (c.ends[1].shared) fbox(A.paint, c.ends[1].at - F.gap, c.ends[1].at + F.gap, 0, 0.012, y, top, COL.gap);
  const sA = inner(c.ends[0]), sB = inner(c.ends[1]);
  fbox(A.paint, sA, sB, 0, F.railProud, top - F.rail, top - 0.004, frame);
  {
    let s = sA;
    for (const o of [...c.doors].sort((p, q) => p.s0 - q.s0)) { if (o.s0 > s) fbox(A.paint, s, o.s0, 0, F.railProud * 0.9, y, y + F.bottom, frame); s = Math.max(s, o.s1); }
    if (sB > s) fbox(A.paint, s, sB, 0, F.railProud * 0.9, y, y + F.bottom, frame);
  }

  // --- holes in the rib field: openings (their frames / shutter boxes), windows, vents ---
  const holes: [number, number, number, number][] = [];
  for (const o of c.doors) {
    const side = o.wide ? 0.08 : D.architrave;
    holes.push([o.s0 - side - 0.02, o.s1 + side + 0.02, y - 1, y + o.h + (o.wide ? S.h : D.header) + 0.02]);
    if (o.wide) holes.push([o.s0 - S.over - 0.02, o.s1 + S.over + 0.02, y + o.h - 0.02, y + o.h + S.h + 0.02]);
  }
  for (const w of c.windows) holes.push([w.s0 - Wn.frame - 0.07, w.s1 + Wn.frame + 0.07, w.y0 - Wn.frame - 0.05, w.y1 + Wn.frame + 0.03]);
  const vy0 = top - F.rail - V.below, vy1 = vy0 + V.h;
  for (const v of c.vents) holes.push([v - V.w / 2 - 0.03, v + V.w / 2 + 0.03, vy0 - 0.03, vy1 + 0.03]);

  // --- corrugation ribs (trapezoid, proud of the painted wall) ---
  {
    const lo = sA + 0.1, hi = sB - 0.1, n = Math.max(0, Math.floor((hi - lo) / R.pitch) + 1), off = lo + (hi - lo - (n - 1) * R.pitch) / 2;
    const ya = y + F.bottom + 0.004, yb = top - F.rail - 0.004, hb = R.base / 2, hf = R.face / 2;
    for (let k = 0; k < n; k++) {
      const s = off + k * R.pitch;
      let segs: [number, number][] = [[ya, yb]];
      for (const [h0, h1, y0, y1] of holes) {
        if (h1 <= s - hb || h0 >= s + hb) continue;
        segs = segs.flatMap(([p, q]) => (y1 <= p || y0 >= q ? [[p, q]] : [[p, y0], [y1, q]].filter(([u, v]) => v - u > 0.12)) as [number, number][]);
      }
      for (const [p, q] of segs) A.paint.hexa([W(s - hb, 0, p), W(s + hb, 0, p), W(s + hb, 0, q), W(s - hb, 0, q), W(s - hf, R.proud, p), W(s + hf, R.proud, p), W(s + hf, R.proud, q), W(s - hf, R.proud, q)], body, back);
    }
  }

  // --- openings: door architraves + canopies; shopfront guides, the roll-up shutter box and its bottom slat ---
  for (const o of c.doors) {
    if (!o.wide) {
      fbox(A.paint, o.s0 - D.architrave, o.s0, 0, D.proud, y, y + o.h + D.header, arch);
      fbox(A.paint, o.s1, o.s1 + D.architrave, 0, D.proud, y, y + o.h + D.header, arch);
      fbox(A.paint, o.s0, o.s1, 0, D.proud, y + o.h, y + o.h + D.header, arch);
    } else {
      fbox(A.paint, o.s0 - 0.08, o.s0, 0, 0.06, y, y + o.h, COL.galvDark);
      fbox(A.paint, o.s1, o.s1 + 0.08, 0, 0.06, y, y + o.h, COL.galvDark);
      fbox(A.paint, o.s0 - S.over, o.s1 + S.over, 0, S.proud, y + o.h, y + o.h + S.h, COL.galv);
      fbox(A.paint, o.s0 + 0.02, o.s1 - 0.02, 0.05, 0.085, y + o.h - 0.05, y + o.h, COL.galvDark);
    }
    if (o.canopy) {
      const C = D.canopy, a = o.s0 - C.over, b = o.s1 + C.over, yw = y + C.wall, ye = yw - C.drop, t = 0.03;
      A.paint.hexa([W(a, 0.03, yw - t), W(b, 0.03, yw - t), W(b, 0.03, yw), W(a, 0.03, yw), W(a, C.depth, ye - t), W(b, C.depth, ye - t), W(b, C.depth, ye), W(a, C.depth, ye)], COL.galv);
      for (const s of [a + 0.1, b - 0.1]) A.paint.rod(W(s, 0.03, yw - 0.5), W(s, C.depth - 0.06, ye - t), 0.014, COL.dark);
    }
  }

  // --- windows: frame + sill proud of the wall, the pane (dark glass / warm lit / mesh / boarded) ---
  c.windows.forEach((w, wi) => {
    const fw = Wn.frame, fc = rnd(10 + wi) < 0.5 ? COL.dark : arch;
    fbox(A.paint, w.s0 - fw, w.s0, 0, Wn.proud, w.y0 - fw, w.y1 + fw, fc);
    fbox(A.paint, w.s1, w.s1 + fw, 0, Wn.proud, w.y0 - fw, w.y1 + fw, fc);
    fbox(A.paint, w.s0, w.s1, 0, Wn.proud, w.y1, w.y1 + fw, fc);
    fbox(A.paint, w.s0 - fw - 0.04, w.s1 + fw + 0.04, 0, Wn.proud + 0.03, w.y0 - fw - 0.015, w.y0, fc);
    fquad(w.kind === 'lit' ? A.lit : A.glass, w.s0, w.s1, Wn.pane, w.y0, w.y1, w.kind === 'lit' ? grey(1) : grey(1));
    if (w.kind === 'lit' && rnd(20 + wi) < 0.55) {
      const f = 0.22 + 0.2 * rnd(21 + wi), left = rnd(22 + wi) < 0.5, cw = (w.s1 - w.s0) * f;
      fquad(A.paint, left ? w.s0 : w.s1 - cw, left ? w.s0 + cw : w.s1, Wn.pane + 0.002, w.y0, w.y1, CURTAINS[Math.floor(rnd(23 + wi) * CURTAINS.length)]);
    }
    if (w.kind === 'mesh') {
      for (let k = 1; k <= 3; k++) { const s = w.s0 + (w.s1 - w.s0) * k / 4; fbox(A.paint, s - 0.007, s + 0.007, Wn.pane + 0.003, Wn.pane + 0.013, w.y0, w.y1, COL.dark); }
      for (let k = 1; k <= 2; k++) { const yy = w.y0 + (w.y1 - w.y0) * k / 3; fbox(A.paint, w.s0, w.s1, Wn.pane + 0.013, Wn.pane + 0.02, yy - 0.007, yy + 0.007, COL.dark); }
    }
    if (w.kind === 'boarded') {
      const col = boardsTextured ? COL.board : COL.boardStandin;
      for (let k = 0; k < 3; k++) {
        const yc = w.y0 + (w.y1 - w.y0) * (k + 0.5) / 3, tilt = (rnd(30 + wi * 3 + k) - 0.5) * 0.09, a = w.s0 - fw - 0.02 - 0.05 * rnd(31 + k), b = w.s1 + fw + 0.02 + 0.05 * rnd(32 + k);
        const u0 = Wn.proud + 0.004, u1 = u0 + 0.022, h = 0.075;
        A.boards.hexa([W(a, u0, yc - tilt - h), W(b, u0, yc + tilt - h), W(b, u0, yc + tilt + h), W(a, u0, yc - tilt + h), W(a, u1, yc - tilt - h), W(b, u1, yc + tilt - h), W(b, u1, yc + tilt + h), W(a, u1, yc - tilt + h)], col.clone().multiplyScalar(0.85 + 0.3 * rnd(33 + k)), back);
      }
    }
  });

  // --- roof vents (a louvred box high on the front) ---
  for (const v of c.vents) {
    fbox(A.paint, v - V.w / 2, v + V.w / 2, 0, 0.035, vy0, vy1, COL.galvDark);
    for (const yy of [vy0 + 0.035, vy0 + 0.085]) fbox(A.paint, v - V.w / 2 + 0.02, v + V.w / 2 - 0.02, 0.035, 0.05, yy, yy + 0.026, COL.dark);
  }

  // --- visible ends: the end frame and the CARGO-DOOR END ---
  let doorEnds = 0;
  for (const e of c.ends) {
    if (!e.visible) continue;
    doorEnds++;
    const dn = out, nb = c.back, nf = c.front - dn * (F.post - F.postProud);
    ebox(A.paint, e, nb, nb + dn * F.post, 0, F.endProud, y, top, frame); // back post
    ebox(A.paint, e, nb + dn * F.post, nf, 0, F.endProud, top - Cg.header, top, frame); // header
    ebox(A.paint, e, nb + dn * F.post, nf, 0, F.endProud, y, y + Cg.sill, frame); // sill
    for (const [y0, y1] of [[y, y + F.casting[1]], [top - F.casting[1], top]]) {
      ebox(A.paint, e, nb, nb + dn * F.casting[0], 0, F.endProud + 0.02, y0, y1, casting);
      const nc = nb + dn * F.casting[0] / 2, yc = (y0 + y1) / 2;
      equad(A.paint, e, nc - 0.05, nc + 0.05, F.endProud + 0.022, yc - 0.028, yc + 0.028, COL.hole);
    }
    const nL = nb + dn * (F.post + 0.012), nR = nf - dn * 0.012, nm = (nL + nR) / 2;
    const ly0 = y + Cg.sill + 0.005, ly1 = top - Cg.header - 0.005;
    const bars: number[] = [];
    for (const [a, b] of [[nL, nm - dn * 0.007], [nm + dn * 0.007, nR]]) {
      ebox(A.paint, e, a, b, 0, Cg.leaf, ly0, ly1, body);
      for (let k = 0; k < 4; k++) { const yc = ly0 + (ly1 - ly0) * (k + 0.5) / 4; ebox(A.paint, e, a + dn * 0.05, b - dn * 0.05, Cg.leaf, Cg.leaf + 0.016, yc - 0.06, yc + 0.06, body); }
      for (const f of [0.22, 0.7]) bars.push(a + (b - a) * f);
    }
    const by0 = ly0 + 0.07, by1 = ly1 - 0.07, bv0 = Cg.leaf + 0.016, bv1 = Cg.barProud;
    for (const n of bars) {
      ebox(A.paint, e, n - Cg.bar / 2, n + Cg.bar / 2, bv0, bv1, by0, by1, COL.bar);
      for (const [y0, y1] of [[by0 - 0.03, by0 + 0.06], [by1 - 0.06, by1 + 0.03]]) ebox(A.paint, e, n - 0.05, n + 0.05, Cg.leaf, bv1 + 0.012, y0, y1, COL.bar);
      ebox(A.paint, e, n, n + dn * 0.3, bv1 - 0.005, bv1 + 0.03, y + 1.02, y + 1.065, COL.bar); // handle
      ebox(A.paint, e, n + dn * 0.24, n + dn * 0.3, Cg.leaf, bv1 - 0.005, y + 0.99, y + 1.095, COL.bar); // its keeper
    }
  }
  return {doorEnds};
}

// --- Bridge pieces: the kit's meshes, or the stand-in -------------------------------------------------------------------------------

interface PiecePart { geometry: THREE.BufferGeometry; material: THREE.Material; local: THREE.Matrix4 }
const PIECES: readonly BridgePieceName[] = ['End', 'Mid', 'MidPlain', 'Trestle'];

/** The loaded kit's piece meshes (shared with the model library: never disposed here); null when not delivered / incomplete. */
function kitParts(gltf: GLTF | null | undefined): {model: true; pieces: Map<BridgePieceName, PiecePart[]>} | null {
  if (!gltf) return null;
  const root = gltf.scene;
  root.updateMatrixWorld(true);
  const pieces = new Map<BridgePieceName, PiecePart[]>();
  for (const name of PIECES) {
    const node = root.getObjectByName(MARKET_BRIDGE_KIT.pieces[name].node);
    if (!node) return null;
    const inv = new THREE.Matrix4().copy(node.matrixWorld).invert();
    const list: PiecePart[] = [];
    node.traverse(o => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      list.push({geometry: mesh.geometry, material, local: new THREE.Matrix4().multiplyMatrices(inv, mesh.matrixWorld)});
    });
    if (!list.length) return null;
    pieces.set(name, list);
  }
  return {model: true, pieces};
}

/** Simple stand-in pieces at the kit's measures (deck, girders, rails, the Mid's cables, a leg frame), the painted steel. */
function standinParts(view: CreviceView, paint: THREE.Material): {model: false; pieces: Map<BridgePieceName, PiecePart[]>} {
  const K = MARKET_BRIDGE_KIT, E = K.pieces.End.length, Lb = K.pieces.Mid.length, gd = K.girderDepth, rz = K.railZ, rh = K.railH;
  const span = (acc: Acc, x0: number, x1: number, cables: boolean) => {
    acc.box(x0, x1, -0.07, 0, -rz, rz, COL.deck);
    for (const z of [-rz + 0.07, rz - 0.07]) acc.box(x0, x1, -gd, -0.07, z - 0.05, z + 0.05, COL.rust);
    for (const z of [-rz, rz]) {
      acc.box(x0, x1, rh - 0.05, rh, z - 0.025, z + 0.025, COL.rust);
      acc.box(x0, x1, 0.5, 0.54, z - 0.015, z + 0.015, COL.rust);
      acc.box(x0, x0 + 0.05, 0, rh, z - 0.025, z + 0.025, COL.rust);
      if (cables) for (let k = 0; k < 6; k++) {
        const t0 = k / 6, t1 = (k + 1) / 6, yy = (t: number) => -0.45 - (K.cableDrop - 0.45) * 4 * t * (1 - t);
        acc.rod([x0 + (x1 - x0) * t0, yy(t0), z * 0.9], [x0 + (x1 - x0) * t1, yy(t1), z * 0.9], 0.012, COL.wire);
      }
    }
  };
  const make = (f: (a: Acc) => void): PiecePart[] => {
    const a = new Acc();
    f(a);
    const g = a.geometry()!;
    view.geometries.push(g);
    return [{geometry: g, material: paint, local: new THREE.Matrix4()}];
  };
  const pieces = new Map<BridgePieceName, PiecePart[]>([
    ['End', make(a => { span(a, -E, 0, false); a.box(-E, -E + 0.14, -K.legCutDepth, rh, -rz, rz, COL.rust); })],
    ['Mid', make(a => span(a, 0, Lb, true))],
    ['MidPlain', make(a => span(a, 0, Lb, false))],
    ['Trestle', make(a => { for (const z of [-0.9, 0.9]) a.box(-0.08, 0.08, -K.pieces.Trestle.height, 0, z - 0.08, z + 0.08, COL.rust); a.box(-0.06, 0.06, -0.2, 0, -0.9, 0.9, COL.rust); })],
  ]);
  return {model: false, pieces};
}

// --- Lines: wires and their poles ---------------------------------------------------------------------------------------------------

/** The crevice's lines as one geometry (the market's line steel): each wire in 10 sagging segments, its poles and arms. */
export function creviceLineGeometry(lines: readonly CrevLine[]): THREE.BufferGeometry | null {
  if (!lines.length) return null;
  const acc = new Acc();
  for (const l of lines) {
    const N = 10, at = (t: number): V3 => [l.x0 + (l.x1 - l.x0) * t, crevLineY(l, t), l.z0 + (l.z1 - l.z0) * t];
    for (let k = 0; k < N; k++) acc.rod(at(k / N), at((k + 1) / N), 0.008, COL.wire);
    l.poles.forEach((p, i) => {
      const end = at(i ? 1 : 0);
      acc.rod([p.x, p.y0, p.z], [p.x, p.y1, p.z], 0.022, COL.dark);
      if (Math.hypot(p.x - end[0], p.z - end[2]) > 0.02) acc.rod([p.x, end[1], p.z], end, 0.012, COL.dark);
    });
  }
  return acc.geometry();
}
