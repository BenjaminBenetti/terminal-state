// Turns a StationLayout into three.js meshes: merged per-material architecture built from the
// cell grid, instanced prop derivatives, procedural props/trim (frames, rails, stairs, gates) and
// instanced signage. Draw calls stay bounded for the large station: architecture is one mesh per
// material, procedural props one instanced mesh per (kind, material), signs one plate mesh plus
// one face mesh per distinct text.

import * as THREE from 'three';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {CELL, FLOOR, SOLID, VOID, type Grid} from '../gen/grid';
import {PROP_DEFS, type PropKind, type PropPlacement} from '../gen/props';
import {ACCENT_COLORS, propShape, type ShapeMat} from '../gen/propShapes';
import {isContainerKind} from '../items/loot';
import type {Area, SignPlacement, StationLayout} from '../gen/station';
import type {WorldMaterials, MatKey} from './materials';
import {canvasTexture, signPlate} from './canvasTextures';
import {shapeMaterial, shapeMaterials} from './shapeMaterials';
import {SHOP_BLOCKERS, SHOP_FURNITURE} from '../gen/storefronts';
import {buildStorefronts} from './storefrontBuilder';
import {buildTraversal} from './traversalBuilder';

class Accum {
  pos: number[] = [];
  nor: number[] = [];
  uv: number[] = [];
  idx: number[] = [];
  quad(p: number[][], n: readonly number[], uv: number[][]) {
    const base = this.pos.length / 3;
    for (let i = 0; i < 4; i++) {
      this.pos.push(p[i][0], p[i][1], p[i][2]);
      this.nor.push(n[0], n[1], n[2]);
      this.uv.push(uv[i][0], uv[i][1]);
    }
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  geometry(): THREE.BufferGeometry | null {
    if (!this.idx.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    return g;
  }
}

const DIRS = [
  {dx: 0, dy: -1, n: [0, 0, 1]},   // north neighbour; face visible from the south
  {dx: 0, dy: 1, n: [0, 0, -1]},
  {dx: -1, dy: 0, n: [1, 0, 0]},
  {dx: 1, dy: 0, n: [-1, 0, 0]},
] as const;

/** Wall edge kinds between a cell and its neighbour. */
const enum Edge { None = 0, Tile = 1, Paint = 2, Tunnel = 3, PlatformFace = 4, Shop = 5 }
/** Storefront unit interiors use world-mapped shape materials (UV scale irrelevant). */
const SHOP_SCALE = {u: 1, v: 1};

export interface Fixture {
  x: number; y: number; z: number;
  broken: boolean; flicker: boolean; warm: boolean;
  /** Mostly-dead tube that sputters in brief bursts. */
  dying: boolean;
  /** Output multiplier 0..1 (aged/dirty tubes in dim areas are < 0.8). */
  power: number;
  area: number;
  phase: number;
  /** Current brightness 0..1 for emissive + pooled light. */
  level: number;
}

export interface BuiltWorld {
  group: THREE.Group;
  fixtures: Fixture[];
  tubes: THREE.InstancedMesh | null;
  stats: {meshes: number; triangles: number; instances: number};
}

/** Instanced model chunk size (m): bigger chunks = fewer draw calls, coarser frustum culling. */
const CHUNK = 18;
/** Model keys for props that use a generated derivative when it exists (optional). */
const MODEL_FOR: Partial<Record<PropKind, string>> = {bench: 'bench', cabinetTall: 'cabinetTall', cabinetLow: 'cabinetLow', stall: 'stall', vending: 'vending', shelf: 'shelf', bin: 'trashCan'};

function floorMatFor(area: Area | undefined): MatKey {
  if (!area) return 'concrete';
  return area.publicSpace ? 'terrazzo' : 'concrete';
}

export function buildWorld(layout: StationLayout, mats: WorldMaterials, models: Record<string, GLTF | undefined>): BuiltWorld {
  const g = layout.grid;
  const group = new THREE.Group();
  group.name = 'station';
  const acc = new Map<MatKey, Accum>();
  const A = (k: MatKey) => { let a = acc.get(k); if (!a) acc.set(k, (a = new Accum())); return a; };
  // Storefront unit interiors (shop tile walls, quarry-tile floors): shape-material accumulators.
  const shopAcc = new Map<string, Accum>();
  const S = (k: string) => { let a = shopAcc.get(k); if (!a) shopAcc.set(k, (a = new Accum())); return a; };
  const trenchY = layout.trench.floorY;
  let instancesFromTraversal = 0;
  const TILE_LOWER_H = mats.tileLowerHeight;

  // --- Walls: merge runs of identical edges along each grid line -------------------------
  // Edge descriptor for cell (x, y) toward neighbour (nx, ny): kind + vertical span + texture
  // base (the cell's floor). Iteration 05 (Lane T): heights come from the grid (track bed,
  // underpass, landings); stair-ramp cells are walled by traversalBuilder (sloped walls).
  let eKind = Edge.None, eY0 = 0, eY1 = 0, eBase = 0;
  const edgeAt = (x: number, y: number, nx: number, ny: number) => {
    eKind = Edge.None;
    const i = y * g.w + x;
    const ct = g.cells[i], nt = g.get(nx, ny);
    if (ct === SOLID || g.rampIdx[i] >= 0) return;
    const ni = g.inBounds(nx, ny) ? ny * g.w + nx : -1;
    const f = g.floorOf(i);
    eBase = f;
    if (ct === FLOOR) {
      const cc = g.ceil[i];
      const area = layout.areas[g.area[i]];
      const kind = !area ? Edge.Tile : area.type === 'eatery' || area.type === 'shop' ? Edge.Shop : area.publicSpace ? Edge.Tile : Edge.Paint;
      if (nt === SOLID) { eKind = kind; eY0 = f; eY1 = cc; }
      else if (ni >= 0 && g.rampIdx[ni] < 0) {
        const nc = g.ceil[ni], nf = g.floorOf(ni);
        if (nt === FLOOR && nc < cc - 1e-4) { eKind = kind; eY0 = nc; eY1 = cc; }
        else if (nf > f + 0.02) { eKind = kind; eY0 = f; eY1 = Math.min(nf, cc); } // face of a higher floor
      }
    } else if (ct === VOID) {
      if (nt === SOLID) { eKind = Edge.Tunnel; eY0 = f; eY1 = g.ceil[i]; }
      else if (nt === FLOOR) { eKind = Edge.PlatformFace; eY0 = f; eY1 = g.floorOf(ni); }
    }
  };
  const emitEdge = (kind: Edge, y0: number, y1: number, base: number, d: (typeof DIRS)[number], line: number, k0: number, k1: number) => {
    if (kind === Edge.Paint) emitWall('paint', y0, y1, base, d, line, k0, k1);
    else if (kind === Edge.Tile) {
      if (y0 < base + TILE_LOWER_H) emitWall('tileLower', y0, Math.min(y1, base + TILE_LOWER_H), base, d, line, k0, k1);
      if (y1 > base + TILE_LOWER_H) emitWall('tileUpper', Math.max(y0, base + TILE_LOWER_H), y1, base + TILE_LOWER_H, d, line, k0, k1);
    } else if (kind === Edge.Shop) emitWallTo(S('tileShop'), SHOP_SCALE, y0, y1, base, d, line, k0, k1);
    else if (kind === Edge.Tunnel) emitWall('tunnel', y0, y1, base, d, line, k0, k1);
    else if (kind === Edge.PlatformFace) emitWall('platformFace', y0, y1, base, d, line, k0, k1);
  };
  for (const d of DIRS) {
    const horizontal = d.dy !== 0; // edge runs along X
    const lines = horizontal ? g.h : g.w;
    const len = horizontal ? g.w : g.h;
    for (let l = 0; l < lines; l++) {
      let runKind = Edge.None, runY0 = 0, runY1 = 0, runBase = 0, runStart = 0;
      for (let k = 0; k <= len; k++) {
        const x = horizontal ? k : l, y = horizontal ? l : k;
        if (k < len) edgeAt(x, y, x + d.dx, y + d.dy); else eKind = Edge.None;
        if (runKind !== Edge.None && eKind === runKind && Math.abs(eY0 - runY0) < 1e-4 && Math.abs(eY1 - runY1) < 1e-4 && Math.abs(eBase - runBase) < 1e-4) continue;
        if (runKind !== Edge.None) emitEdge(runKind, runY0, runY1, runBase, d, l, runStart, k);
        runKind = eKind; runY0 = eY0; runY1 = eY1; runBase = eBase; runStart = k;
      }
    }
  }

  function emitWall(mat: MatKey, y0: number, y1: number, vBase: number, d: (typeof DIRS)[number], line: number, k0: number, k1: number) {
    emitWallTo(A(mat), mats.scale[mat], y0, y1, vBase, d, line, k0, k1);
  }
  function emitWallTo(a: Accum, m: {u: number; v: number}, y0: number, y1: number, vBase: number, d: (typeof DIRS)[number], line: number, k0: number, k1: number) {
    if (y1 <= y0 + 1e-4) return;
    const v0 = (y0 - vBase) / m.v, v1 = (y1 - vBase) / m.v;
    if (d.dy !== 0) {
      const z = (d.dy < 0 ? line : line + 1) * CELL;
      const xa = k0 * CELL, xb = k1 * CELL;
      if (d.n[2] > 0) a.quad([[xa, y0, z], [xb, y0, z], [xb, y1, z], [xa, y1, z]], d.n, [[xa / m.u, v0], [xb / m.u, v0], [xb / m.u, v1], [xa / m.u, v1]]);
      else a.quad([[xb, y0, z], [xa, y0, z], [xa, y1, z], [xb, y1, z]], d.n, [[-xb / m.u, v0], [-xa / m.u, v0], [-xa / m.u, v1], [-xb / m.u, v1]]);
    } else {
      const x = (d.dx < 0 ? line : line + 1) * CELL;
      const za = k0 * CELL, zb = k1 * CELL;
      if (d.n[0] > 0) a.quad([[x, y0, zb], [x, y0, za], [x, y1, za], [x, y1, zb]], d.n, [[-zb / m.u, v0], [-za / m.u, v0], [-za / m.u, v1], [-zb / m.u, v1]]);
      else a.quad([[x, y0, za], [x, y0, zb], [x, y1, zb], [x, y1, za]], d.n, [[za / m.u, v0], [zb / m.u, v0], [zb / m.u, v1], [za / m.u, v1]]);
    }
  }

  // --- Floors and ceilings ------------------------------------------------------------------
  const floorQuad = (mat: MatKey, x0: number, z0: number, x1: number, z1: number, y = 0, vFrom?: number, flip = false) => {
    const m = mats.scale[mat];
    const vz = (z: number) => vFrom !== undefined ? 1 - (flip ? vFrom - z : z - vFrom) / m.v : -z / m.v;
    A(mat).quad([[x0, y, z0], [x0, y, z1], [x1, y, z1], [x1, y, z0]], [0, 1, 0], [[x0 / m.u, vz(z0)], [x0 / m.u, vz(z1)], [x1 / m.u, vz(z1)], [x1 / m.u, vz(z0)]]);
  };
  const ceilQuad = (mat: MatKey, x0: number, z0: number, x1: number, z1: number, y: number) => {
    const m = mats.scale[mat];
    A(mat).quad([[x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1]], [0, -1, 0], [[x0 / m.u, z0 / m.v], [x1 / m.u, z0 / m.v], [x1 / m.u, z1 / m.v], [x0 / m.u, z1 / m.v]]);
  };
  // Lane T: areas whose cells are not all at one floor/ceiling (stair legs with landings) get
  // per-row runs of floor/ceiling quads at each cell's height; ramp cells are built by traversalBuilder.
  const uniform = (a: Area): boolean => {
    const i0 = g.idx(a.x, a.y), f0 = g.floorOf(i0), c0 = g.ceil[i0];
    for (let y = a.y; y < a.y + a.h; y++) for (let x = a.x; x < a.x + a.w; x++) {
      const i = y * g.w + x;
      if (g.rampIdx[i] >= 0 || Math.abs(g.floorOf(i) - f0) > 1e-4 || Math.abs(g.ceil[i] - c0) > 1e-4) return false;
    }
    return true;
  };
  const perCell = (a: Area, mat: MatKey, ceilMat: MatKey) => {
    for (let y = a.y; y < a.y + a.h; y++) {
      for (let x = a.x; x < a.x + a.w;) {
        const i = y * g.w + x;
        if (g.rampIdx[i] >= 0) { x++; continue; }
        const f = g.floorOf(i), c = g.ceil[i];
        let e = x + 1;
        while (e < a.x + a.w && g.rampIdx[y * g.w + e] < 0 && Math.abs(g.floorOf(y * g.w + e) - f) < 1e-4 && Math.abs(g.ceil[y * g.w + e] - c) < 1e-4) e++;
        floorQuad(mat, x * CELL, y * CELL, e * CELL, (y + 1) * CELL, f);
        ceilQuad(ceilMat, x * CELL, y * CELL, e * CELL, (y + 1) * CELL, c);
        x = e;
      }
    }
  };
  for (const a of layout.areas) {
    const x0 = a.x * CELL, z0 = a.y * CELL, x1 = (a.x + a.w) * CELL, z1 = (a.y + a.h) * CELL;
    if (!uniform(a)) { perCell(a, floorMatFor(a), a.publicSpace ? 'ceiling' : 'ceilingService'); continue; }
    const af = g.floorOf(g.idx(a.x, a.y));
    if (af !== 0) { floorQuad(floorMatFor(a), x0, z0, x1, z1, af); ceilQuad(a.publicSpace ? 'ceiling' : 'ceilingService', x0, z0, x1, z1, a.ceil); continue; }
    if (a.kind === 'platform') {
      // Mustard safety edge along the track side(s), kit slab texture for the rest of the platform.
      const strip = mats.scale.safetyEdge.v;
      const n = a.edge !== 'S', sEdge = a.edge === 'S' || a.edge === 'NS';
      if (sEdge) floorQuad('safetyEdge', x0, z1 - strip, x1, z1, 0, z1, true);
      if (n) floorQuad('safetyEdge', x0, z0, x1, z0 + strip, 0, z0);
      floorQuad('platformSlab', x0, n ? z0 + strip : z0, x1, sEdge ? z1 - strip : z1);
    } else if (a.type === 'eatery') {
      const m = SHOP_SCALE;
      S('quarryTile').quad([[x0, 0, z0], [x0, 0, z1], [x1, 0, z1], [x1, 0, z0]], [0, 1, 0], [[x0 / m.u, -z0 / m.v], [x0 / m.u, -z1 / m.v], [x1 / m.u, -z1 / m.v], [x1 / m.u, -z0 / m.v]]);
    } else floorQuad(floorMatFor(a), x0, z0, x1, z1);
    ceilQuad(a.publicSpace ? 'ceiling' : 'ceilingService', x0, z0, x1, z1, a.ceil);
  }
  for (const d of layout.doors) {
    const b = layout.areas[d.b], a = layout.areas[d.a];
    const x0 = d.x * CELL, z0 = d.y * CELL, x1 = (d.x + d.w) * CELL, z1 = (d.y + d.h) * CELL;
    const df = g.floorOf(g.idx(d.x, d.y));
    floorQuad(floorMatFor(a.publicSpace && b.publicSpace ? a : b), x0, z0, x1, z1, df);
    ceilQuad(b.publicSpace ? 'ceiling' : 'ceilingService', x0, z0, x1, z1, df === 0 ? d.height : g.ceil[g.idx(d.x, d.y)]);
  }
  // Track beds: ballast floor and the ceiling continuing over the tracks.
  for (const t of layout.trenches) {
    floorQuad('ballast', t.x0, t.z0, t.x1, t.z1, t.floorY);
    ceilQuad('ceiling', t.x0, t.z0, t.x1, t.z1, t.ceil);
  }
  // Lane T (iteration 05): stair flights (treads, risers, nosings, sloped walls/ceilings, handrails),
  // rescue ladders, underpass track-structure beams, tunnel-mouth barricades.
  instancesFromTraversal = buildTraversal(group, layout, mats, A);

  for (const [k, a] of acc) {
    const geo = a.geometry();
    if (!geo) continue;
    const mesh = new THREE.Mesh(geo, mats.get(k));
    mesh.name = `arch-${k}`;
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
  }
  for (const [k, a] of shopAcc) {
    const geo = a.geometry();
    if (!geo) continue;
    const mesh = new THREE.Mesh(geo, shapeMaterial(mats, k));
    mesh.name = `arch-shop-${k}`;
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
  }

  // Tunnel mouths fade to black beyond the platform ends.
  const voidMat = new THREE.MeshBasicMaterial({color: 0x030303});
  for (const t of layout.trenches) {
    for (const x of [t.x0 + 0.01, t.x1 - 0.01]) {
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(t.z1 - t.z0, t.ceil - trenchY), voidMat);
      plane.position.set(x, (t.ceil + trenchY) / 2, (t.z0 + t.z1) / 2);
      plane.rotation.y = x < (t.x0 + t.x1) / 2 ? Math.PI / 2 : -Math.PI / 2;
      group.add(plane);
    }
  }

  // --- Procedural trim: door frames, rails, sleepers, coverboard, handrails, rods ----------
  const boxes = new Map<MatKey, THREE.BufferGeometry[]>();
  const addBox = (mat: MatKey, cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, rotY = 0) => {
    const b = new THREE.BoxGeometry(sx, sy, sz);
    if (rotY) b.rotateY(rotY);
    b.translate(cx, cy, cz);
    let list = boxes.get(mat);
    if (!list) boxes.set(mat, (list = []));
    list.push(b);
  };
  for (const d of layout.doors) {
    if (d.shopfront) continue; // storefront frames are built by storefrontBuilder
    const h = d.height;
    const ft = 0.09, fd = CELL + 0.06;
    if (d.h === 1) { // wall runs along X; jambs at both X ends of the opening
      const z = (d.y + 0.5) * CELL;
      const xa = d.x * CELL, xb = (d.x + d.w) * CELL;
      addBox('steel', xa + ft / 2, h / 2, z, ft, h, fd);
      addBox('steel', xb - ft / 2, h / 2, z, ft, h, fd);
      addBox('steel', (xa + xb) / 2, h - 0.05, z, xb - xa, 0.1, fd);
    } else {
      const x = (d.x + 0.5) * CELL;
      const za = d.y * CELL, zb = (d.y + d.h) * CELL;
      addBox('steel', x, h / 2, za + ft / 2, fd, h, ft);
      addBox('steel', x, h / 2, zb - ft / 2, fd, h, ft);
      addBox('steel', x, h - 0.05, (za + zb) / 2, fd, 0.1, zb - za);
    }
  }
  const railY = trenchY + 0.14 + 0.08;
  for (const t of layout.trenches) {
    const len = t.x1 - t.x0, cx = (t.x0 + t.x1) / 2;
    t.tracks.forEach((tc, i) => {
      for (const off of [-0.72, 0.72]) addBox('rail', cx, railY, tc + off, len, 0.15, 0.07);
      // Third rail + coverboard on the side away from the platform edge.
      const side = t.third[i] ?? 1;
      addBox('rail', cx, trenchY + 0.3, tc + side * 1.4, len, 0.12, 0.08);
      addBox('coverboard', cx, trenchY + 0.46, tc + side * 1.4, len, 0.035, 0.32);
    });
  }
  // Platform edge lips (both edges of an island).
  for (const id of layout.platforms) {
    const a = layout.areas[id];
    const zs = a.edge === 'NS' ? [a.y * CELL + 0.04, (a.y + a.h) * CELL - 0.04] : [a.edge === 'S' ? (a.y + a.h) * CELL - 0.04 : a.y * CELL + 0.04];
    for (const z of zs) addBox('platformFace', (a.x + a.w / 2) * CELL, -0.04, z, a.w * CELL, 0.08, 0.08);
  }
  // Passages (stairs, escalator halls, transfer passages): wall handrails along both long walls.
  for (const a of layout.areas) {
    if (a.type !== 'passage') continue;
    const alongX = a.w > a.h;
    const s0 = (alongX ? a.x : a.y) * CELL + 0.6, s1 = (alongX ? a.x + a.w : a.y + a.h) * CELL - 0.6;
    const c = (alongX ? a.y + a.h / 2 : a.x + a.w / 2) * CELL;
    for (const w of alongX ? [a.y * CELL + 0.07, (a.y + a.h) * CELL - 0.07] : [a.x * CELL + 0.07, (a.x + a.w) * CELL - 0.07]) {
      const out = w < c ? -0.025 : 0.025;
      if (alongX) {
        addBox('steel', (s0 + s1) / 2, 0.92, w, s1 - s0, 0.05, 0.05);
        for (let t = s0 + 0.2; t < s1; t += 1.6) addBox('steel', t, 0.86, w + out, 0.04, 0.1, 0.04);
      } else {
        addBox('steel', w, 0.92, (s0 + s1) / 2, 0.05, 0.05, s1 - s0);
        for (let t = s0 + 0.2; t < s1; t += 1.6) addBox('steel', w + out, 0.86, t, 0.04, 0.1, 0.04);
      }
    }
  }
  // Pendant rods for fixtures hung below tall ceilings.
  for (const l of layout.lights) {
    // Lane T: the local ceiling (follows flights / landings / the underpass), not the area's top.
    const local = layout.grid.ceilAt(l.x, l.z);
    const ceil = Math.min(layout.areas[l.area]?.ceil ?? l.y, Number.isFinite(local) ? local : Infinity);
    const rod = ceil - l.y;
    if (rod < 0.1) continue;
    const ax = Math.cos(l.rot) * 0.45, az = -Math.sin(l.rot) * 0.45;
    for (const s of [-1, 1]) addBox('steel', l.x + ax * s, l.y + rod / 2, l.z + az * s, 0.015, rod, 0.015);
  }

  let instances = instancesFromTraversal;
  // Sleepers (instanced, every track of every bed)
  {
    const total = layout.trenches.reduce((n, t) => n + Math.floor((t.x1 - t.x0) / 0.65) * t.tracks.length, 0);
    const sleeper = new THREE.InstancedMesh(new THREE.BoxGeometry(0.24, 0.14, 2.5), mats.get('sleeper'), total);
    const m4 = new THREE.Matrix4();
    let n = 0;
    for (const t of layout.trenches) {
      const per = Math.floor((t.x1 - t.x0) / 0.65);
      for (const tc of t.tracks) for (let i = 0; i < per; i++) { m4.makeTranslation(t.x0 + 0.3 + i * 0.65, trenchY + 0.07, tc); sleeper.setMatrixAt(n++, m4); }
    }
    sleeper.name = 'sleepers';
    sleeper.computeBoundingSphere();
    group.add(sleeper);
    instances += n;
  }

  // --- Props: model derivatives instanced, simple shapes procedural ----------------------
  const byKind = new Map<PropKind, PropPlacement[]>();
  for (const p of layout.props) {
    let l = byKind.get(p.kind);
    if (!l) byKind.set(p.kind, (l = []));
    l.push(p);
  }
  // Generated turnstile: kept at its derivative scale (arms are visual only). Its origin is the
  // bounding-box centre including the arms, so shift the cabinet (x 0.142..0.459, z -0.478..0.502
  // per derivatives/props-iteration02.json) onto the collision footprint.
  const TURNSTILE_CABINET_OFFSET = new THREE.Matrix4().makeTranslation(-0.3005, 0, -0.012);
  const placeM = (p: PropPlacement) => new THREE.Matrix4().compose(new THREE.Vector3(p.x, p.y, p.z), new THREE.Quaternion().setFromAxisAngle(UP, p.rot), new THREE.Vector3(1, 1, 1));
  for (const [kind, list] of byKind) {
    // Cabinets and crates are searchable containers: built and animated by world/containers.ts.
    if (isContainerKind(kind)) continue;
    // Storefront furniture / glazing / shutters: built by storefrontBuilder.
    if (SHOP_FURNITURE.includes(kind) || SHOP_BLOCKERS.includes(kind)) continue;
    const def = PROP_DEFS[kind];
    const modelKey = MODEL_FOR[kind];
    if (kind === 'fareGate' && models.turnstile) {
      const size = new THREE.Box3().setFromObject(models.turnstile.scene).getSize(new THREE.Vector3());
      instances += addInstancedModel(group, models.turnstile, list.map(p => placeM(p).multiply(TURNSTILE_CABINET_OFFSET)), {w: size.x, h: size.y, d: size.z, anchor: 'bottom'}, kind);
    } else if (modelKey && models[modelKey]) {
      instances += addInstancedModel(group, models[modelKey]!, list.map(placeM), {w: def.w, h: def.h, d: def.d, anchor: 'bottom'}, kind);
    } else if (kind === 'column') {
      // Unit-height box scaled per instance (platform/concourse columns differ in height).
      const geo = new THREE.BoxGeometry(def.w, 1, def.d);
      geo.translate(0, 0.5, 0);
      const im = new THREE.InstancedMesh(geo, mats.get('steel'), list.length);
      const m4 = new THREE.Matrix4();
      list.forEach((p, i) => im.setMatrixAt(i, m4.makeScale(1, p.h, 1).setPosition(p.x, p.y, p.z)));
      im.name = 'prop-column';
      im.computeBoundingSphere();
      group.add(im);
      instances += list.length;
    } else if (kind === 'bin') {
      const geo = new THREE.CylinderGeometry(def.w / 2, def.w / 2 * 0.92, def.h, 14, 1);
      geo.translate(0, def.h / 2, 0);
      instances += addInstanced(group, geo, mats.get('bin'), list.map(placeM), 'prop-bin');
    } else if (kind === 'fareGate') {
      const geo = new THREE.BoxGeometry(def.w, def.h, def.d);
      geo.translate(0, def.h / 2, 0);
      instances += addInstanced(group, geo, mats.get('gate'), list.map(placeM), 'prop-fareGate');
    } else {
      instances += addProceduralProp(group, kind, list, mats);
    }
  }

  // --- Light fixtures (model derivative) + emissive tubes ----------------------------------
  const fixtures: Fixture[] = layout.lights.map((l, i) => ({x: l.x, y: l.y, z: l.z, broken: l.broken, flicker: l.flicker, warm: l.warm, dying: l.dying, power: l.power, area: l.area, phase: i * 1.7, level: l.broken ? 0 : 1}));
  const lightMats = layout.lights.map(l => new THREE.Matrix4().compose(new THREE.Vector3(l.x, l.y, l.z), new THREE.Quaternion().setFromAxisAngle(UP, l.rot), new THREE.Vector3(1, 1, 1)));
  let tubes: THREE.InstancedMesh | null = null;
  if (models.light) instances += addInstancedModel(group, models.light, lightMats, {w: mats.fixture.w, h: mats.fixture.h, d: mats.fixture.d, anchor: 'top'}, 'light');
  {
    const geo = new THREE.BoxGeometry(mats.fixture.w * 0.82, 0.025, mats.fixture.d * 0.42);
    geo.translate(0, -mats.fixture.h - 0.004, 0);
    tubes = new THREE.InstancedMesh(geo, mats.get('tube'), layout.lights.length);
    lightMats.forEach((m, i) => tubes!.setMatrixAt(i, m));
    const c = new THREE.Color();
    fixtures.forEach((f, i) => tubes!.setColorAt(i, f.broken ? c.setRGB(0.05, 0.05, 0.05) : c.setRGB(1, 1, 1)));
    tubes.name = 'light-tubes';
    tubes.computeBoundingSphere();
    group.add(tubes);
  }

  // --- Storefront bays (frames, fascias, shutters, glazing, menu boards, counters …) -----------
  instances += buildStorefronts(group, layout, {mat: k => shapeMaterial(mats, k), models, instanceModel: addInstancedModel});

  // --- Signs (instanced: shared plates, one face mesh per distinct text) --------------------
  instances += buildSigns(group, layout, mats, models.sign, addBox);

  for (const [k, list] of boxes) {
    const merged = mergeBoxes(list);
    const mesh = new THREE.Mesh(merged, mats.get(k));
    mesh.name = `trim-${k}`;
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
  }

  group.updateMatrixWorld(true);
  let triangles = 0, meshes = 0;
  group.traverse(o => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    meshes++;
    const geo = m.geometry;
    const tris = (geo.index ? geo.index.count : geo.attributes.position.count) / 3;
    triangles += tris * ((o as THREE.InstancedMesh).isInstancedMesh ? (o as THREE.InstancedMesh).count : 1);
  });
  return {group, fixtures, tubes, stats: {meshes, triangles: Math.round(triangles), instances}};
}

const UP = new THREE.Vector3(0, 1, 0);

function addInstanced(group: THREE.Group, geo: THREE.BufferGeometry, mat: THREE.Material, placements: THREE.Matrix4[], name: string, colors?: (THREE.Color | null)[]): number {
  const im = new THREE.InstancedMesh(geo, mat, placements.length);
  placements.forEach((m, i) => im.setMatrixAt(i, m));
  if (colors && colors.some(c => c)) colors.forEach((c, i) => im.setColorAt(i, c ?? WHITE));
  im.name = name;
  im.computeBoundingSphere();
  group.add(im);
  return placements.length;
}
const WHITE = new THREE.Color(1, 1, 1);

// ---------------------------------------------------------------------------------------
// Procedural props (stand-ins for stall/vending/shelf, primitive furniture always)

// Shape-key materials (textured, world-space mapped, shared; keyed by ShapeMat) live in
// world/shapeMaterials.ts (iteration 04, Lane C). Storefront parts use the same keys.
const procMats = shapeMaterials;

function addProceduralProp(group: THREE.Group, kind: PropKind, list: PropPlacement[], mats: WorldMaterials): number {
  const parts = propShape(kind);
  if (!parts) return 0;
  const pm = procMats(mats);
  const byMat = new Map<ShapeMat, THREE.BufferGeometry[]>();
  for (const p of parts) {
    const b = new THREE.BoxGeometry(p.s[0], p.s[1], p.s[2]);
    if (p.rx) b.rotateX(p.rx);
    b.translate(p.p[0], p.p[1], p.p[2]);
    let l = byMat.get(p.m);
    if (!l) byMat.set(p.m, (l = []));
    l.push(b);
  }
  const placements = list.map(p => new THREE.Matrix4().compose(new THREE.Vector3(p.x, p.y, p.z), new THREE.Quaternion().setFromAxisAngle(UP, p.rot), new THREE.Vector3(1, 1, 1)));
  const palette = ACCENT_COLORS[kind];
  const accentColors = palette ? list.map(p => new THREE.Color(palette[p.variant % palette.length])) : undefined;
  for (const [m, geos] of byMat) addInstanced(group, mergeBoxes(geos), pm[m], placements, `prop-${kind}-${m}`, m === 'accent' ? accentColors : undefined);
  return list.length;
}

// ---------------------------------------------------------------------------------------
// Signage

const SIGN_SIZE: Record<SignPlacement['kind'], {w: number; h: number}> = {
  station: {w: 1.8, h: 0.38}, exit: {w: 1.2, h: 0.26}, service: {w: 1.2, h: 0.26}, info: {w: 1.4, h: 0.3}, platform: {w: 2.2, h: 0.42},
};
const signTexCache = new Map<string, THREE.Texture>();

function signTexture(s: SignPlacement, w: number, h: number): THREE.Texture {
  const key = `${s.kind}|${s.text}|${s.arrow ?? ''}|${w.toFixed(2)}`;
  let tex = signTexCache.get(key);
  if (tex) return tex;
  if (s.kind === 'station') tex = signPlate(s.text.toUpperCase(), 'station', s.text.length * 31 + 7);
  else {
    const W = 1024, H = Math.max(160, Math.round(1024 * h / w));
    tex = canvasTexture(W, H, s.text.length * 17 + s.kind.length, (ctx, cw, ch) => {
      const light = s.kind === 'service';
      ctx.fillStyle = light ? '#d8cfb6' : '#1f2225';
      ctx.fillRect(0, 0, cw, ch);
      ctx.fillStyle = light ? '#b53a2c' : s.kind === 'exit' ? '#c2463a' : '#d9a520';
      ctx.fillRect(0, ch - ch * 0.1, cw, ch * 0.045);
      let x = 36;
      let text = s.text;
      if (s.kind === 'platform') {
        const m = /^(\d+)\s*·?\s*(.*)$/.exec(text);
        if (m) {
          const r = ch * 0.34;
          ctx.fillStyle = '#d9a520';
          ctx.beginPath(); ctx.arc(36 + r, ch / 2 - ch * 0.04, r, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#1f2225';
          ctx.font = `bold ${Math.round(r * 1.3)}px "Helvetica Neue", Arial, sans-serif`;
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(m[1], 36 + r, ch / 2 - ch * 0.02);
          ctx.textAlign = 'left';
          x = 36 + r * 2 + 30;
          text = m[2];
        }
      }
      const arrowW = s.arrow ? ch * 0.6 : 0;
      ctx.fillStyle = light ? '#1f2225' : '#ece4cf';
      let size = Math.round(ch * 0.5);
      const font = () => `bold ${size}px "Helvetica Neue", Arial, sans-serif`;
      ctx.font = font();
      while (ctx.measureText(text).width > cw - x - 40 - arrowW && size > 24) { size -= 3; ctx.font = font(); }
      ctx.textBaseline = 'middle';
      ctx.fillText(text, x, ch / 2 - ch * 0.04);
      if (s.arrow) {
        const ax = cw - 30 - arrowW / 2, ay = ch / 2 - ch * 0.04, r = arrowW * 0.42;
        ctx.save();
        ctx.translate(ax, ay);
        ctx.rotate({right: 0, down: Math.PI / 2, left: Math.PI, up: -Math.PI / 2}[s.arrow]);
        ctx.beginPath(); ctx.moveTo(r, 0); ctx.lineTo(-r * 0.2, -r); ctx.lineTo(-r * 0.2, -r * 0.4); ctx.lineTo(-r, -r * 0.4); ctx.lineTo(-r, r * 0.4); ctx.lineTo(-r * 0.2, r * 0.4); ctx.lineTo(-r * 0.2, r); ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
    });
  }
  signTexCache.set(key, tex);
  return tex;
}

const faceMats = new Map<THREE.Texture, THREE.MeshStandardMaterial>();
function faceMat(tex: THREE.Texture): THREE.MeshStandardMaterial {
  let m = faceMats.get(tex);
  if (!m) faceMats.set(tex, (m = new THREE.MeshStandardMaterial({map: tex, roughness: 0.6})));
  return m;
}

function buildSigns(group: THREE.Group, layout: StationLayout, mats: WorldMaterials, signModel: GLTF | undefined,
  addBox: (mat: MatKey, cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, rotY?: number) => void): number {
  const plates: THREE.Matrix4[] = [];
  const stationFrames: THREE.Matrix4[] = [];
  const faces = new Map<THREE.Texture, THREE.Matrix4[]>();
  const q = new THREE.Quaternion();
  const addFace = (tex: THREE.Texture, m: THREE.Matrix4) => { let l = faces.get(tex); if (!l) faces.set(tex, (l = [])); l.push(m); };
  // Station sign model fit (as WorldMaterials.makeSign): back at z = 0, front at frameDepth.
  let frameDepth = 0.02;
  let frameLocal: {mesh: THREE.Mesh; local: THREE.Matrix4}[] = [];
  if (signModel) {
    const root = signModel.scene;
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root);
    const size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
    const {w, h} = SIGN_SIZE.station;
    const fit = new THREE.Matrix4().makeTranslation(-c.x * w / size.x, -c.y * h / size.y, -box.min.z).multiply(new THREE.Matrix4().makeScale(w / size.x, h / size.y, 1));
    frameDepth = size.z;
    root.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) frameLocal.push({mesh: m, local: new THREE.Matrix4().multiplyMatrices(fit, m.matrixWorld)}); });
  }
  for (const s of layout.signs) {
    const size = SIGN_SIZE[s.kind];
    const w = s.w ?? size.w, h = s.w && s.kind !== 'station' && s.kind !== 'platform' ? Math.max(size.h, Math.min(0.34, w * 0.15)) : size.h;
    const tex = signTexture(s, w, h);
    const sides = s.hang ? [s.rot, s.rot + Math.PI] : [s.rot];
    const useFrame = s.kind === 'station' && frameLocal.length && !s.hang && (s.w === undefined || s.w === size.w);
    const depth = useFrame ? frameDepth : 0.02;
    const base = new THREE.Matrix4().compose(new THREE.Vector3(s.x, s.y, s.z), q.setFromAxisAngle(UP, s.rot), new THREE.Vector3(1, 1, 1));
    if (useFrame) stationFrames.push(base.clone());
    else {
      // Unit plate scaled to the sign size; wall plates sit against the wall, hanging plates centred.
      const zc = s.hang ? 0 : depth / 2 + 0.002;
      plates.push(base.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0, zc)).multiply(new THREE.Matrix4().makeScale(w, h, s.hang ? 0.03 : depth)));
    }
    sides.forEach((r, k) => {
      const front = s.hang ? 0.016 : depth + 0.004;
      const m = new THREE.Matrix4().compose(new THREE.Vector3(s.x, s.y, s.z), q.setFromAxisAngle(UP, r), new THREE.Vector3(1, 1, 1))
        .multiply(new THREE.Matrix4().makeTranslation(0, 0, front)).multiply(new THREE.Matrix4().makeScale(w * 0.96, h * 0.8, 1));
      // The back of a hanging sign mirrors left/right arrows so both faces point the same way in the world.
      const flip = k === 1 && (s.arrow === 'left' || s.arrow === 'right');
      addFace(flip ? signTexture({...s, arrow: s.arrow === 'left' ? 'right' : 'left'}, w, h) : tex, m);
    });
    if (s.hang) {
      // Two drop rods to the ceiling.
      const ceil = layout.areas[s.area]?.ceil ?? s.y + 1;
      const rod = ceil - (s.y + h / 2);
      if (rod > 0.05) {
        const ax = Math.cos(s.rot) * w * 0.38, az = -Math.sin(s.rot) * w * 0.38;
        for (const k of [-1, 1]) addBox('steel', s.x + ax * k, s.y + h / 2 + rod / 2, s.z + az * k, 0.015, rod, 0.015);
      }
    }
  }
  let n = 0;
  if (plates.length) {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    n += addInstanced(group, geo, mats.get('steel'), plates, 'sign-plates');
  }
  if (stationFrames.length) {
    for (const {mesh, local} of frameLocal) n += addInstanced(group, mesh.geometry, mesh.material as THREE.Material, stationFrames.map(m => m.clone().multiply(local)), 'sign-frame');
  }
  const plane = new THREE.PlaneGeometry(1, 1);
  for (const [tex, list] of faces) n += addInstanced(group, faces.size > 1 ? plane.clone() : plane, faceMat(tex), list, 'sign-face');
  return n;
}

// ---------------------------------------------------------------------------------------

function mergeBoxes(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let vCount = 0, iCount = 0;
  for (const b of list) { vCount += b.attributes.position.count; iCount += b.index!.count; }
  const pos = new Float32Array(vCount * 3), nor = new Float32Array(vCount * 3), uv = new Float32Array(vCount * 2);
  const idx = new Uint32Array(iCount);
  let vo = 0, io = 0;
  for (const b of list) {
    pos.set(b.attributes.position.array as Float32Array, vo * 3);
    nor.set(b.attributes.normal.array as Float32Array, vo * 3);
    uv.set(b.attributes.uv.array as Float32Array, vo * 2);
    const src = b.index!.array;
    for (let i = 0; i < src.length; i++) idx[io + i] = src[i] + vo;
    vo += b.attributes.position.count;
    io += src.length;
    b.dispose();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  return g;
}

/**
 * Instances every mesh of a GLB derivative. The model is fitted to the target footprint
 * (width X, height Y, depth Z) with its base (or top, for hanging fixtures) at the origin.
 */
export function addInstancedModel(group: THREE.Group, gltf: GLTF, placements: THREE.Matrix4[], fit: {w: number; h: number; d: number; anchor: 'bottom' | 'top'}, name: string): number {
  if (!placements.length) return 0;
  const root = gltf.scene;
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const s = new THREE.Vector3(fit.w / size.x, fit.h / size.y, fit.d / size.z);
  const center = box.getCenter(new THREE.Vector3());
  const anchorY = fit.anchor === 'bottom' ? box.min.y : box.max.y;
  const fitM = new THREE.Matrix4().makeScale(s.x, s.y, s.z).multiply(new THREE.Matrix4().makeTranslation(-center.x, -anchorY, -center.z));
  // Split instances into spatial chunks so off-screen chunks are frustum-culled.
  const chunks = new Map<string, THREE.Matrix4[]>();
  const pos = new THREE.Vector3();
  for (const p of placements) {
    pos.setFromMatrixPosition(p);
    const key = `${Math.floor(pos.x / CHUNK)},${Math.floor(pos.z / CHUNK)}`;
    let list = chunks.get(key);
    if (!list) chunks.set(key, (list = []));
    list.push(p);
  }
  let count = 0;
  root.traverse(o => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const local = new THREE.Matrix4().multiplyMatrices(fitM, mesh.matrixWorld);
    const m = new THREE.Matrix4();
    for (const list of chunks.values()) {
      const im = new THREE.InstancedMesh(mesh.geometry, mesh.material, list.length);
      list.forEach((p, i) => im.setMatrixAt(i, m.multiplyMatrices(p, local)));
      im.name = `prop-${name}`;
      im.computeBoundingSphere();
      group.add(im);
      count += list.length;
    }
  });
  return count;
}

export function gridStats(g: Grid): {floor: number; void: number} {
  let floor = 0, v = 0;
  for (const c of g.cells) { if (c === FLOOR) floor++; else if (c === VOID) v++; }
  return {floor, void: v};
}
