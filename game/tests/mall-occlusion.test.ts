// Task mall-round2-20261031 (lane PERF, user M05 "~1,500 draw calls, CPU in submit"): the mall culler's same- / cross-storey
// OCCLUSION (world/levelCulling.ts OCCL_*) on a small synthetic two-storey plan — fast, no models. The real mall's matched views and
// the depth oracle (eye + flashlight) live in mall-budget.test.ts ('M05 matched views').
//
// Plan (cells 0.5 m; storey 0 at y 0, 4 m ceilings; storey 1 at y 5): storey 0 has a corridor (z 0..3 m, x 0..30 m) and a room
// (x 10..20, z 5..15) behind a wall (z 3..5) with a 2 m doorway (x 14..16); storey 1 has a gallery over the corridor and a closed
// shop (x 10..20, z 5..15) whose front wall (z 3..5) has no opening. A void (x 24..30, z 5..20, open from the storey-0 floor to the
// storey-1 ceiling) joins them.
import * as THREE from 'three';
import {describe, expect, it} from 'vitest';
import {CELL, FLOOR, VOID, Grid} from '../src/gen/grid';
import type {Level} from '../src/gen/levels';
import {CULL_LAYER, LevelCuller} from '../src/world/levelCulling';
import {LevelColumns} from '../src/world/levelGeometry';

const W = 60, H = 44;
type Rect = [number, number, number, number];
function storey(base: number, open: Rect[], voids: Rect[] = []): Grid {
  const g = new Grid(W, H);
  const fill = (r: Rect, v: number) => {
    for (let cy = Math.round(r[1] / CELL); cy < Math.round(r[3] / CELL); cy++) for (let cx = Math.round(r[0] / CELL); cx < Math.round(r[2] / CELL); cx++) {
      g.set(cx, cy, v); const i = g.idx(cx, cy); g.floor[i] = base; g.ceil[i] = base + 4;
    }
  };
  for (const r of open) fill(r, FLOOR);
  for (const r of voids) fill(r, VOID);
  return g;
}
function plan(): {levels: Level[]; cols: LevelColumns} {
  const g0 = storey(0, [[0, 0, 30, 3], [14, 3, 16, 5], [10, 5, 20, 15], [24, 5, 30, 20]]);
  const g1 = storey(5, [[0, 0, 30, 3], [10, 5, 20, 15]], [[24, 5, 30, 20]]);
  // the void column: open from the storey-0 floor to the storey-1 ceiling (one band joining both storeys)
  for (let cy = 10; cy < 40; cy++) for (let cx = 48; cx < 60; cx++) { const i = g0.idx(cx, cy); g0.ceil[i] = 9; g1.floor[i] = 0; g1.ceil[i] = 9; }
  const levels: Level[] = [{id: 0, role: 'main', grid: g0, baseY: 0} as Level, {id: 1, role: 'upper', grid: g1, baseY: 5} as unknown as Level];
  return {levels, cols: new LevelColumns(levels)};
}
const levelAt = (_x: number, y: number) => (y >= 4.7 ? 1 : 0);

/** A 1 x 1 x 1 m box mesh standing on (x, y, z), tagged with its storey. */
function box(root: THREE.Group, x: number, y: number, z: number, level: number, name: string): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
  m.position.set(x, y + 0.5, z);
  m.name = name;
  m.userData.level = level;
  root.add(m);
  return m;
}
function cam(x: number, y: number, z: number, lx: number, ly: number, lz: number): THREE.PerspectiveCamera {
  const c = new THREE.PerspectiveCamera(75, 16 / 9, 0.05, 200);
  c.position.set(x, y, z);
  c.lookAt(lx, ly, lz);
  c.updateMatrixWorld(true);
  return c;
}
const CULLED = new THREE.Layers();
CULLED.set(CULL_LAYER);
const culled = (m: THREE.Mesh) => m.layers.mask === CULLED.mask;

function scene(opts: {mall?: boolean} = {mall: true}) {
  const {levels, cols} = plan();
  const root = new THREE.Group();
  const meshes = {
    room: box(root, 18, 0, 12, 0, 'room-deep'), // storey-0 room, off the doorway's line from the corridor's west end
    corner: box(root, 10.6, 0, 5.6, 0, 'room-corner'), // tucked behind the wall west of the doorway
    corridor: box(root, 22, 0, 1.5, 0, 'corridor'),
    shop: box(root, 15, 5, 10, 1, 'shop-1'), // storey-1 closed shop
    gallery: box(root, 20, 5, 1.5, 1, 'gallery-1'),
    voidFloor: box(root, 27, 0, 17, 0, 'void-0'),
  };
  root.updateMatrixWorld(true);
  const culler = new LevelCuller(levels, cols, levelAt, opts.mall ? {slabs: {see: []}} : undefined);
  culler.register(root);
  culler.maxDistance = 200;
  return {culler, root, meshes};
}

/** Walking east along the corridor (forced decisions every 2 cm): the x where `m` stops being occlusion-culled. */
function flipX(culler: LevelCuller, m: THREE.Mesh): number {
  let prev: boolean | null = null;
  for (let x = 8; x <= 16; x += 0.02) {
    culler.update(cam(x, 1.62, 1.5, x + 6, 1.0, 12), true);
    const h = culled(m);
    if (prev === true && !h) return x;
    prev = h;
  }
  return NaN;
}

describe('mall same- / cross-storey occlusion (world/levelCulling.ts OCCL_*)', () => {
  it('hides a room behind a wall, keeps what a doorway / corridor shows; occlusion off or a non-mall culler hides nothing by it', () => {
    const {culler, meshes} = scene();
    culler.update(cam(2, 1.62, 1.5, 30, 1.2, 8), true); // corridor, west end, looking east-ish across the doorway
    expect(culled(meshes.corner)).toBe(true);
    expect(culled(meshes.corridor)).toBe(false);
    expect(culler.occlusionCulled).toBeGreaterThan(0);
    culler.update(cam(15, 1.62, 1.5, 15, 1.0, 12), true); // in front of the doorway, looking into the room
    expect(culled(meshes.room)).toBe(false);
    expect(culled(meshes.corner)).toBe(true); // still behind the wall west of the doorway
    culler.occlusion = false;
    culler.update(cam(15, 1.62, 1.5, 15, 1.0, 12), true);
    expect(culled(meshes.corner)).toBe(false);
    expect(culler.occlusionCulled).toBe(0);
    const legacy = scene({mall: false}); // Subway / Office: no occlusion data
    legacy.culler.update(cam(2, 1.62, 1.5, 30, 1.2, 8), true);
    expect(legacy.culler.occlusionCulled).toBe(0);
    expect(culled(legacy.meshes.corner)).toBe(false);
  });

  it('a further viewpoint (the flashlight: its shadow pass uses the same layers) keeps what IT sees', () => {
    const {culler, meshes} = scene();
    const flip = flipX(culler, meshes.room);
    const c = cam(flip - 0.4, 1.62, 1.5, flip + 5.6, 1.0, 12); // the deep room box just out of the eye's sight through the doorway
    culler.update(c, true);
    expect(culled(meshes.room)).toBe(true);
    const torch = new THREE.SpotLight(0xffffff, 1, 30);
    c.add(torch);
    // a viewpoint 1 m east of the eye (an exaggerated flashlight offset) sees it through the doorway
    torch.position.copy(c.worldToLocal(new THREE.Vector3(flip + 0.6, 1.62, 1.5)));
    c.updateMatrixWorld(true);
    culler.viewpoints = [torch];
    culler.update(c, true);
    expect(culled(meshes.room)).toBe(false);
    torch.intensity = 0; // a dark torch draws no shadow pass: its sight keeps nothing
    culler.update(c, true);
    expect(culled(meshes.room)).toBe(true);
    torch.intensity = 1; torch.distance = 3; // beyond the light's range its shadow camera never draws the mesh either
    culler.update(c, true);
    expect(culled(meshes.room)).toBe(true);
  });

  it('cross-storey: looking down over the void, a storey-0 room behind its walls is hidden, the void floor is kept', () => {
    const {culler, meshes} = scene();
    culler.update(cam(27, 6.62, 12, 20, 0.5, 13), true); // over the void at storey-1 eye height, looking down west at the room
    expect(culler.stats.visibleLevels).toContain(0);
    expect(culled(meshes.room)).toBe(true);
    expect(culler.occlusionCulled).toBeGreaterThan(0);
    culler.update(cam(27, 6.62, 12, 27, 0.5, 17), true); // looking down south into the void
    expect(culled(meshes.voidFloor)).toBe(false);
    culler.occlusion = false;
    culler.update(cam(27, 6.62, 12, 20, 0.5, 13), true);
    expect(culled(meshes.room)).toBe(false); // only the occlusion hid it (slab / portal rules show it)
  });

  it('exact between full updates: a step below the culler\'s 0.25 m skip that opens a sight line re-decides at once', () => {
    const {culler, meshes} = scene();
    const flip = flipX(culler, meshes.room); // where the deep room box becomes visible walking east along the corridor
    expect(Number.isFinite(flip)).toBe(true);
    culler.update(cam(flip - 0.1, 1.62, 1.5, flip - 0.1 + 6, 1.0, 12), true);
    expect(culled(meshes.room)).toBe(true);
    culler.update(cam(flip + 0.05, 1.62, 1.5, flip + 0.05 + 6, 1.0, 12)); // 0.15 m: below the full-update threshold
    expect(culled(meshes.room)).toBe(false);
  });

  it('a registered mesh that moves (a door sliding, a prop handed back elsewhere) is decided at its new place', () => {
    const {culler, meshes} = scene();
    const c = cam(2, 1.62, 1.5, 30, 1.2, 8);
    culler.update(c, true);
    expect(culled(meshes.corner)).toBe(true);
    meshes.corner.position.set(6, 0.5, 1.5); // into the corridor, in plain view
    meshes.corner.updateMatrixWorld(true);
    culler.update(c, true);
    expect(culled(meshes.corner)).toBe(false);
  });
});
