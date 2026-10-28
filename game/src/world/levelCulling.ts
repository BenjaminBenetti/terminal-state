// Iteration 08 (Lane G): level visibility culling for multi-level stations.
//
// Frustum culling alone draws the deck above and the service crossing below whenever they are in the
// view frustum, although slabs hide them. The station is a stack of levels joined only through
// PORTALS - columns whose free band spans two levels' walking heights (light wells, double-height
// voids, stair flights between levels). The camera's own level renders normally; another level's
// meshes render only within MARGIN of a portal tile that is (a) in the view frustum, (b) within fog
// distance and (c) in 3D line of sight from the eye through the union free space (gen/levels.ts).
// Hidden meshes are moved to an unused layer (never touching `visible`, which other systems own), so
// both the main pass and the flashlight shadow pass skip them. Meshes spanning several levels, or with
// no geometry at registration (dynamic / pooled instances), are never culled.
// Also on a single level: registered (lit, fogged) meshes whose box lies entirely beyond the distance
// where the scene's FogExp2 is >= 99.8 % opaque are hidden (they render as pure fog colour). Emissive
// tubes and glow cards (fixture state readable from afar) are not registered and stay.

import * as THREE from 'three';
import {CELL, FLOOR, VOID} from '../gen/grid';
import type {Level} from '../gen/levels';
import {LevelColumns, cellCeil} from './levelGeometry';
import type {LevelResolver} from './builder';

/** Layer that no camera renders: culled meshes live here. */
export const CULL_LAYER = 31;
/** A level's mesh renders if its X/Z box comes within this distance of a visible portal tile (m). */
export const PORTAL_MARGIN = 12;
/** Portal tiles beyond this distance are not tested (fog makes them invisible; FogExp2 0.043 -> ~1% at 50 m). */
export const PORTAL_MAX_DIST = 55;
/** Portal tiles are square groups of portal columns of this many cells. */
const TILE = 6;
/** Fog transmittance below which a surface is treated as invisible (FogExp2: exp(-(d * density)^2)). */
export const FOG_CULL_TRANSMITTANCE = 0.002;
export function fogCullDistance(fogDensity: number): number {
  return fogDensity > 0 ? Math.sqrt(-Math.log(FOG_CULL_TRANSMITTANCE)) / fogDensity : Infinity;
}
/** Height range above a level's base that counts as its walking/viewing zone (m). */
const ZONE: [number, number] = [0.2, 2.4];

interface Tile { a: number; b: number; x0: number; z0: number; x1: number; z1: number; y0: number; y1: number; cells: number[] }
interface Entry { obj: THREE.Mesh; level: number; x0: number; z0: number; x1: number; z1: number; mask: number; culled: boolean }

export class LevelCuller {
  readonly entries: Entry[] = [];
  private readonly tiles: Tile[] = [];
  private readonly levelIds: number[];
  private readonly fr = new THREE.Frustum();
  private readonly pm = new THREE.Matrix4();
  private readonly box = new THREE.Box3();
  private readonly eye = new THREE.Vector3();
  private last = {x: NaN, y: NaN, z: NaN, qx: 0, qy: 0, qz: 0, qw: 0};
  /** Diagnostics of the last update. */
  stats = {level: 0, tilesTested: 0, tilesVisible: 0, culled: 0, fogged: 0, registered: 0, uncullable: 0};
  enabled = true;
  /** Hide registered meshes entirely beyond this distance (m); set from the scene fog (fogCullDistance). */
  maxDistance = Infinity;

  constructor(private readonly levels: readonly Level[], private readonly cols: LevelColumns, private readonly levelAt: LevelResolver) {
    this.levelIds = levels.map(l => l.id);
    if (levels.length > 1) this.buildPortals();
  }

  /** Portal tiles between every pair of levels (columns whose free band reaches both walking zones). */
  private buildPortals(): void {
    const {W, H} = this.cols;
    const L = this.levels;
    const zone = (k: number): [number, number] => [L[k].baseY + ZONE[0], L[k].baseY + ZONE[1]];
    for (let a = 0; a < L.length; a++) for (let b = a + 1; b < L.length; b++) {
      const za = zone(a), zb = zone(b);
      const tiles = new Map<number, Tile>();
      for (let i = 0; i < W * H; i++) {
        let y0 = Infinity, y1 = -Infinity, portal = false;
        for (let k = 0; k < this.cols.count(i); k++) {
          const g = L[this.cols.level(i, k)].grid;
          if (g.cells[i] !== FLOOR && g.cells[i] !== VOID) continue;
          const f = g.floorOf(i), c = cellCeil(g, i);
          const ra = ramp(g, i);
          // A flight's column sweeps its whole pitch: test its lowest floor / highest ceiling.
          const lo = ra ? ra[0] : f, hi = ra ? ra[1] : c;
          if (lo <= za[1] && hi >= za[0] && lo <= zb[1] && hi >= zb[0]) { portal = true; y0 = Math.min(y0, lo); y1 = Math.max(y1, hi); }
        }
        if (!portal) continue;
        const cx = i % W, cy = (i - cx) / W;
        const key = Math.floor(cy / TILE) * 100000 + Math.floor(cx / TILE);
        let t = tiles.get(key);
        if (!t) tiles.set(key, (t = {a: L[a].id, b: L[b].id, x0: Infinity, z0: Infinity, x1: -Infinity, z1: -Infinity, y0, y1, cells: []}));
        t.x0 = Math.min(t.x0, cx * CELL); t.x1 = Math.max(t.x1, (cx + 1) * CELL);
        t.z0 = Math.min(t.z0, cy * CELL); t.z1 = Math.max(t.z1, (cy + 1) * CELL);
        t.y0 = Math.min(t.y0, y0); t.y1 = Math.max(t.y1, y1);
        t.cells.push(i);
      }
      this.tiles.push(...tiles.values());
    }
  }

  get portalTiles(): number { return this.tiles.length; }

  /**
   * Register every mesh under `root` (call once per station after building). Level = userData.level
   * (builder / stock chunks), else the level holding its box centre when the box fits one level band.
   */
  register(root: THREE.Object3D): void {
    root.updateMatrixWorld(true);
    root.traverse(o => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      this.stats.registered++;
      const im = m as THREE.InstancedMesh;
      if (im.isInstancedMesh) {
        if (im.count === 0 || m.frustumCulled === false) { this.stats.uncullable++; return; }
        im.computeBoundingBox();
        this.box.copy(im.boundingBox!).applyMatrix4(m.matrixWorld);
      } else this.box.setFromObject(m);
      if (this.box.isEmpty()) { this.stats.uncullable++; return; }
      let level = typeof m.userData.level === 'number' ? m.userData.level : NaN;
      if (Number.isNaN(level)) {
        const lo = this.levelAt((this.box.min.x + this.box.max.x) / 2, this.box.min.y + 0.05, (this.box.min.z + this.box.max.z) / 2);
        const hi = this.levelAt((this.box.min.x + this.box.max.x) / 2, this.box.max.y - 0.05, (this.box.min.z + this.box.max.z) / 2);
        if (lo !== hi || this.box.max.y - this.box.min.y > 4.5) { this.stats.uncullable++; return; }
        level = lo;
      }
      // Not a station level (e.g. builder STAIR_LEVEL flights, seen from both levels): fog culling only.
      if (!this.levelIds.includes(level)) level = NaN;
      this.entries.push({obj: m, level, x0: this.box.min.x, z0: this.box.min.z, x1: this.box.max.x, z1: this.box.max.z, mask: m.layers.mask, culled: false});
    });
  }

  /** Re-evaluate for the camera (cheap; skipped while the camera does not move). */
  update(camera: THREE.Camera, force = false): void {
    if (!this.entries.length) return;
    camera.updateMatrixWorld();
    const e = this.eye.setFromMatrixPosition(camera.matrixWorld);
    const q = camera.quaternion, l = this.last;
    if (!force && Math.abs(e.x - l.x) < 0.25 && Math.abs(e.y - l.y) < 0.15 && Math.abs(e.z - l.z) < 0.25
      && Math.abs(q.x - l.qx) + Math.abs(q.y - l.qy) + Math.abs(q.z - l.qz) + Math.abs(q.w - l.qw) < 0.02) return;
    Object.assign(l, {x: e.x, y: e.y, z: e.z, qx: q.x, qy: q.y, qz: q.z, qw: q.w});
    const camLevel = this.levelAt(e.x, e.y, e.z);
    this.stats.level = camLevel;
    // Visible portal tiles from the camera's level, per other level.
    const vis = new Map<number, Tile[]>();
    let tested = 0, visible = 0;
    if (this.enabled) {
      this.pm.multiplyMatrices((camera as THREE.PerspectiveCamera).projectionMatrix, camera.matrixWorldInverse);
      this.fr.setFromProjectionMatrix(this.pm);
      for (const t of this.tiles) {
        if (t.a !== camLevel && t.b !== camLevel) continue;
        const other = t.a === camLevel ? t.b : t.a;
        const dx = Math.max(t.x0 - e.x, 0, e.x - t.x1), dz = Math.max(t.z0 - e.z, 0, e.z - t.z1);
        if (dx * dx + dz * dz > PORTAL_MAX_DIST * PORTAL_MAX_DIST) continue;
        this.box.min.set(t.x0, t.y0, t.z0); this.box.max.set(t.x1, t.y1, t.z1);
        const inside = e.x >= t.x0 && e.x <= t.x1 && e.z >= t.z0 && e.z <= t.z1;
        if (!inside && !this.fr.intersectsBox(this.box)) continue;
        tested++;
        if (!inside && !this.sees(e, t)) continue;
        visible++;
        let list = vis.get(other);
        if (!list) vis.set(other, (list = []));
        list.push(t);
      }
    }
    let culled = 0, fogged = 0;
    const far2 = this.maxDistance * this.maxDistance;
    for (const en of this.entries) {
      let show: boolean;
      const dx = Math.max(en.x0 - e.x, 0, e.x - en.x1), dz = Math.max(en.z0 - e.z, 0, e.z - en.z1);
      if (!this.enabled) show = true;
      else if (dx * dx + dz * dz > far2) { show = false; fogged++; } // entirely inside opaque fog
      else if (en.level === camLevel || Number.isNaN(en.level)) show = true;
      else {
        // Another level: only near a portal tile the camera can see.
        show = false;
        const list = vis.get(en.level);
        if (list) for (const t of list) {
          if (en.x1 >= t.x0 - PORTAL_MARGIN && en.x0 <= t.x1 + PORTAL_MARGIN && en.z1 >= t.z0 - PORTAL_MARGIN && en.z0 <= t.z1 + PORTAL_MARGIN) { show = true; break; }
        }
      }
      if (show === !en.culled) continue;
      if (show) { en.obj.layers.mask = en.mask; en.culled = false; } else { en.mask = en.obj.layers.mask; en.obj.layers.set(CULL_LAYER); en.culled = true; }
    }
    for (const en of this.entries) if (en.culled) culled++;
    this.stats.tilesTested = tested;
    this.stats.tilesVisible = visible;
    this.stats.culled = culled;
    this.stats.fogged = fogged;
  }

  /** Line of sight from the eye to a few columns of a portal tile, through the union of free bands. */
  private sees(e: THREE.Vector3, t: Tile): boolean {
    const n = t.cells.length;
    const picks = n <= 4 ? t.cells : [t.cells[0], t.cells[n - 1], t.cells[n >> 1], t.cells[n >> 2], t.cells[(3 * n) >> 2]];
    for (const i of picks) {
      const cx = i % this.cols.W, cy = (i - cx) / this.cols.W;
      const tx = (cx + 0.5) * CELL, tz = (cy + 0.5) * CELL;
      // Aim at the eye height clamped into the portal band (looking straight across / up / down into it).
      const ty = Math.min(t.y1 - 0.2, Math.max(t.y0 + 0.2, e.y));
      if (this.ray(e.x, e.y, e.z, tx, ty, tz)) return true;
      if (ty !== (t.y0 + t.y1) / 2 && this.ray(e.x, e.y, e.z, tx, (t.y0 + t.y1) / 2, tz)) return true;
    }
    return false;
  }

  /** 3D segment free in the union of open bands (2D DDA over columns, height span per column). */
  private ray(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
    const {W, H} = this.cols;
    const dx = bx - ax, dz = bz - az;
    let x = Math.floor(ax / CELL), y = Math.floor(az / CELL);
    const tx = Math.floor(bx / CELL), ty = Math.floor(bz / CELL);
    const stepX = dx > 0 ? 1 : -1, stepY = dz > 0 ? 1 : -1;
    const adx = Math.abs(dx), adz = Math.abs(dz);
    const tDX = adx > 1e-9 ? CELL / adx : Infinity, tDY = adz > 1e-9 ? CELL / adz : Infinity;
    let tMaxX = adx > 1e-9 ? (dx > 0 ? (x + 1) * CELL - ax : ax - x * CELL) / adx : Infinity;
    let tMaxY = adz > 1e-9 ? (dz > 0 ? (y + 1) * CELL - az : az - y * CELL) / adz : Infinity;
    let tIn = 0;
    for (let guard = 0; guard < 1024; guard++) {
      if (x < 0 || y < 0 || x >= W || y >= H) return false;
      const i = y * W + x;
      const tOut = Math.min(tMaxX, tMaxY, 1);
      const ya = ay + (by - ay) * tIn, yb = ay + (by - ay) * tOut;
      const lo = Math.min(ya, yb), hi = Math.max(ya, yb);
      let ok = false;
      for (let k = 0; k < this.cols.count(i) && !ok; k++) {
        const g = this.levels[this.cols.level(i, k)].grid;
        const r = ramp(g, i);
        const f = r ? r[0] : g.floorOf(i), c = r ? r[1] : cellCeil(g, i);
        ok = lo >= f - 0.1 && hi <= c + 0.1;
      }
      if (!ok) return false;
      if (x === tx && y === ty) return true;
      if (tMaxX < tMaxY) { tIn = tMaxX; tMaxX += tDX; x += stepX; } else { tIn = tMaxY; tMaxY += tDY; y += stepY; }
    }
    return true;
  }

  /** Stop culling these objects (and their meshes), e.g. a holder knocked loose and carried by physics. */
  release(objs: readonly THREE.Object3D[]): void {
    if (!objs.length) return;
    const gone = new Set<THREE.Object3D>();
    for (const o of objs) o.traverse(x => { gone.add(x); });
    for (let k = this.entries.length - 1; k >= 0; k--) {
      const en = this.entries[k];
      if (!gone.has(en.obj)) continue;
      if (en.culled) en.obj.layers.mask = en.mask;
      this.entries.splice(k, 1);
    }
  }

  /** Show everything again (debug / before disposal). */
  reset(): void {
    for (const en of this.entries) if (en.culled) { en.obj.layers.mask = en.mask; en.culled = false; }
  }
}

/** Lowest floor / highest ceiling a flight cell sweeps (null off ramps). */
function ramp(g: Level['grid'], i: number): [number, number] | null {
  const r = g.rampIdx[i];
  if (r < 0) return null;
  const R = g.ramps[r], W = g.w, cx = i % W, cy = (i - cx) / W;
  const a = ((R.axis === 'x' ? cx : cy)) * CELL;
  const h0 = Math.min(rh(R, a), rh(R, a + CELL)), h1 = Math.max(rh(R, a), rh(R, a + CELL));
  return [h0, h1 + R.headroom];
}
function rh(R: {s0: number; s1: number; h0: number; h1: number}, s: number): number {
  const t = (s - R.s0) / (R.s1 - R.s0);
  return R.h0 + (R.h1 - R.h0) * (t < 0 ? 0 : t > 1 ? 1 : t);
}
