// Track 2 (Beyond the Station), lane VIS: presentation of the track tunnels and service annexes (DESIGN §3), on the
// synthetic GEN-shaped fixture (helpers/trackExtFixture.ts): the smooth shell follows the path, meets the bed seamlessly,
// replaces the grid's stair-stepped geometry only inside the corridors, black end planes / barricades go only where a
// tunnel continues, every cap closes the section, track members follow the rails, graffiti only at clue records, steam
// stays bounded, everything is warm-up discoverable, and no light (tinted or not) is added.
import {beforeAll, describe, expect, it} from 'vitest';
import * as THREE from 'three';
import {installCanvasShim} from './helpers/canvas2d';
import {TX, trackExtFixture, type TrackExtFixtureOpts} from './helpers/trackExtFixture';
import {TEXTURE_FILES, type TextureKey} from '../src/assets/manifest';
import {WorldMaterials} from '../src/world/materials';
import {buildWorld, type BuiltWorld} from '../src/world/builder';
import {TunnelFrame} from '../src/world/trackExt/frame';
import {TrackExtView, outsideIntervals, resolveLeftSign} from '../src/world/trackExt/view';
import {SHELL, SHELL_FACE_TYPE, clipOutside, sleeperPhase} from '../src/world/trackExt/shell';
import {CELL_OF, GRAFFITI} from '../src/world/trackExt/graffiti';
import {STEAM, SteamVents, annexVents} from '../src/world/trackExt/steam';
import {Effects, STEAM_FX} from '../src/world/fx';
import {planWarmup, warmKeys} from '../src/render/warmup';
import {treatmentOf, planWallDetail, extWallDetailCaps} from '../src/world/wallDetailPlan';
import {areaNeglect} from '../src/world/decay';
import {ambienceTypeFor, roomKindFor} from '../src/audio/sfx';
import type {StationLayout} from '../src/gen/station';

function fakeEnvTextures(): Record<TextureKey, THREE.Texture> {
  const out = {} as Record<TextureKey, THREE.Texture>;
  for (const k of Object.keys(TEXTURE_FILES) as TextureKey[]) out[k] = new THREE.Texture({width: 64, height: 64} as unknown as HTMLImageElement);
  return out;
}
let mats: WorldMaterials;
beforeAll(() => { installCanvasShim(false); mats = new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17}); });

const cache = new Map<string, {fx: ReturnType<typeof trackExtFixture>; w: BuiltWorld}>();
function built(o: TrackExtFixtureOpts = {}) {
  const key = JSON.stringify(o);
  if (!cache.has(key)) { const fx = trackExtFixture(o); cache.set(key, {fx, w: buildWorld(fx.layout, mats, {})}); }
  return cache.get(key)!;
}
const extMeshes = (w: BuiltWorld, part?: string) => {
  const out: THREE.Mesh[] = [];
  w.group.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh && m.userData.trackExt && (!part || m.userData.trackExt.part === part)) out.push(m); });
  return out;
};
/** World-space vertices of a (non-instanced) mesh. */
function verts(m: THREE.Mesh): THREE.Vector3[] {
  const p = m.geometry.attributes.position, out: THREE.Vector3[] = [];
  m.updateWorldMatrix(true, false);
  for (let i = 0; i < p.count; i++) out.push(new THREE.Vector3(p.getX(i), p.getY(i), p.getZ(i)).applyMatrix4(m.matrixWorld));
  return out;
}
/** Triangle centroids of a mesh. */
function centroids(m: THREE.Mesh): THREE.Vector3[] {
  const v = verts(m), idx = m.geometry.index, out: THREE.Vector3[] = [];
  const n = idx ? idx.count : v.length;
  for (let t = 0; t < n; t += 3) {
    const a = v[idx ? idx.getX(t) : t], b = v[idx ? idx.getX(t + 1) : t + 1], c = v[idx ? idx.getX(t + 2) : t + 2];
    out.push(a.clone().add(b).add(c).multiplyScalar(1 / 3));
  }
  return out;
}
const raycastAll = (w: BuiltWorld, from: THREE.Vector3, dir: THREE.Vector3, far = 60) => {
  w.group.updateMatrixWorld(true);
  return new THREE.Raycaster(from, dir.clone().normalize(), 0, far).intersectObject(w.group, true);
};

describe('track tunnel shell geometry', () => {
  it('walls run at ±width/2 from the centreline from the bed floor to the flat ceiling, on both sides along the whole path', () => {
    const {fx, w} = built();
    for (const t of fx.ext.tunnels) {
      const f = new TunnelFrame(t), half = t.width / 2;
      const capFrom = w.trackExt!.shells.perTunnel.find(p => p.id === t.id)!.cap.walkEnd - 1.2; // rubble panels share the material
      const walls = extMeshes(w, 'tunnel').filter(m => m.userData.trackExt.tunnel === t.id);
      expect(walls.length).toBeGreaterThan(0);
      for (const m of walls) for (const p of verts(m)) {
        const c = f.project(p.x, p.z);
        if (c.s > capFrom) continue;
        expect(Math.abs(Math.abs(c.lat) - half)).toBeLessThan(0.012);
        expect(p.y).toBeGreaterThanOrEqual(t.floorY - 1e-4);
        expect(p.y).toBeLessThanOrEqual(t.ceilY + 1e-4);
      }
      // Coverage: a horizontal ray across the corridor hits a shell wall on both sides at every 0.5 m (above door heads).
      for (let s = 0.25; s < t.length - 0.3; s += 0.5) {
        const p = f.at(s);
        for (const side of [1, -1]) {
          const o = new THREE.Vector3(p.x, t.floorY + 3.2, p.z), d = new THREE.Vector3(side * p.lx, 0, side * p.lz);
          const hit = raycastAll(w, o, d, half + 0.5).find(h => h.object.userData.trackExt?.part === 'tunnel');
          expect(hit, `wall at s ${s.toFixed(2)} side ${side}`).toBeTruthy();
          expect(Math.abs(hit!.distance - half)).toBeLessThan(0.02);
        }
      }
    }
  });

  it('a flat ceiling at ceilY and a ballast floor at floorY cover the full width (vertical rays everywhere inside)', () => {
    const {fx, w} = built();
    for (const t of fx.ext.tunnels) {
      const f = new TunnelFrame(t), half = t.width / 2;
      const capFrom = w.trackExt!.shells.perTunnel.find(p => p.id === t.id)!.cap.walkEnd - 1.2; // rubble slabs share the material
      for (const m of extMeshes(w, 'ceiling').filter(m => m.userData.trackExt.tunnel === t.id)) for (const p of verts(m)) if (f.project(p.x, p.z).s < capFrom) expect(Math.abs(p.y - t.ceilY)).toBeLessThan(1e-4);
      for (let s = 0.2; s < t.length - 1.2; s += 1.1) for (let lat = -half + 0.05; lat < half; lat += 0.6) {
        const [x, z] = f.point(s, lat);
        const down = raycastAll(w, new THREE.Vector3(x, t.floorY + 0.03, z), new THREE.Vector3(0, -1, 0), 0.5);
        expect(down.some(h => h.object.userData.trackExt?.part === 'ballast' && Math.abs(h.point.y - t.floorY) < 1e-3), `floor at s ${s} lat ${lat}`).toBe(true);
        const up = raycastAll(w, new THREE.Vector3(x, t.ceilY - 0.03, z), new THREE.Vector3(0, 1, 0), 0.5);
        expect(up.some(h => h.object.userData.trackExt?.part === 'ceiling' && Math.abs(h.point.y - t.ceilY) < 1e-3), `ceiling at s ${s} lat ${lat}`).toBe(true);
      }
    }
  });

  it('the mouth meets the bed seamlessly: same wall planes, ceiling, floor and wall texture mapping at the end face', () => {
    const {fx, w} = built();
    const tr = fx.layout.trenches[0], m = mats.scale.tunnel;
    for (const t of fx.ext.tunnels) {
      const f = new TunnelFrame(t);
      const xm = t.from === 'x1' ? tr.x1 : tr.x0;
      expect(Math.abs(f.first.x - xm)).toBeLessThan(1e-6);
      const atMouth = extMeshes(w, 'tunnel').filter(mm => mm.userData.trackExt.tunnel === t.id).flatMap(mm => {
        const v = verts(mm), uv = mm.geometry.attributes.uv;
        return v.map((p, i) => ({p, u: uv.getX(i), v: uv.getY(i)})).filter(q => Math.abs(q.p.x - xm) < 1e-4);
      });
      expect(atMouth.length).toBeGreaterThanOrEqual(4);
      for (const q of atMouth) {
        // The bed's side walls are the planes z0 / z1; its wallQuad maps u = x / span facing +Z, -x / span facing -Z.
        const onZ0 = Math.abs(q.p.z - tr.z0) < 1e-4, onZ1 = Math.abs(q.p.z - tr.z1) < 1e-4;
        expect(onZ0 || onZ1).toBe(true);
        expect(q.u).toBeCloseTo((onZ0 ? xm : -xm) / m.u, 4);
        expect(q.v).toBeCloseTo((q.p.y - tr.floorY) / m.v, 4);
        expect([tr.floorY, tr.ceil].some(y => Math.abs(q.p.y - y) < 1e-4)).toBe(true);
      }
    }
  });

  it.each([['GEN all-corners raster', {}], ["DESIGN's centre raster", {centreRule: true}]] as const)('grid walls, floors and ceilings never show inside a corridor (no stair steps / z-fighting), and stay outside it (%s)', (_n, opts) => {
    const {fx, w} = built(opts);
    const view = w.trackExt!.view;
    for (const f of w.wallFaces) {
      const mx = (f.x0 + f.x1) / 2 + f.nx * 0.01, mz = (f.z0 + f.z1) / 2 + f.nz * 0.01;
      expect(view.insideAny(mx, mz, 0.02, 0), `face ${JSON.stringify(f)}`).toBe(false);
    }
    // Tunnel-area faces: only the treatment faces published for the shell's straight walls, ON the wall line.
    const tunnelAreas = new Set(fx.ext.tunnels.flatMap(t => t.areas));
    const shellFaces = w.wallFaces.filter(f => tunnelAreas.has(f.area));
    expect(shellFaces.length).toBeGreaterThan(0);
    for (const f of shellFaces) {
      expect(f.areaType).toBe(SHELL_FACE_TYPE);
      const t = fx.ext.tunnels.find(tt => tt.areas.includes(f.area))!, fr = new TunnelFrame(t);
      for (const u of [0, 0.5, 1]) expect(Math.abs(Math.abs(fr.project(f.x0 + (f.x1 - f.x0) * u, f.z0 + (f.z1 - f.z0) * u).lat) - t.width / 2)).toBeLessThan(1e-3);
    }
    let checked = 0;
    w.group.traverse(o => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || !m.name.startsWith('arch-')) return;
      for (const c of centroids(m)) { checked++; expect(view.insideAny(c.x, c.z, 0.03, -0.03), `${m.name} at ${c.x.toFixed(2)},${c.z.toFixed(2)}`).toBe(false); }
    });
    expect(checked).toBeGreaterThan(100);
    // The bed itself keeps its floor / walls / ceiling (the station is unchanged outside the corridors).
    const bed = raycastAll(w, new THREE.Vector3(40, -1.0, 32), new THREE.Vector3(0, -1, 0), 0.5);
    expect(bed.some(h => h.object.name.startsWith('arch-ballast'))).toBe(true);
  });

  it('black end planes and barricades are suppressed only at the bed ends a tunnel continues', () => {
    const planesAt = (w: BuiltWorld) => {
      const xs: number[] = [];
      w.group.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh && (m.geometry as THREE.PlaneGeometry).type === 'PlaneGeometry' && (m.material as THREE.MeshBasicMaterial).color?.getHex() === 0x030303) xs.push(m.position.x); });
      return xs;
    };
    const barricadeXs = (w: BuiltWorld) => {
      const hz = w.group.getObjectByName('traversal-hazard') as THREE.Mesh | undefined;
      return hz ? [...new Set(verts(hz).map(p => Math.round(p.x)))] : [];
    };
    const both = built();
    expect(planesAt(both.w)).toEqual([]);
    expect(barricadeXs(both.w)).toEqual([]);
    const eastOnly = built({noWest: true});
    expect(planesAt(eastOnly.w).map(x => Math.round(x * 100) / 100)).toEqual([TX.x0 + 0.01]);
    expect(barricadeXs(eastOnly.w).every(x => Math.abs(x - TX.x0) <= 1)).toBe(true);
    expect(barricadeXs(eastOnly.w).length).toBeGreaterThan(0);
  });

  it('every cap kind closes the whole cross-section with opaque geometry at the walkable end', () => {
    for (const kind of ['rubble', 'bulkhead', 'gate'] as const) {
      const {fx, w} = built({eastCap: kind});
      const t = fx.east, f = new TunnelFrame(t), half = t.width / 2;
      const span = w.trackExt!.shells.perTunnel.find(p => p.id === t.id)!.cap;
      expect(span.kind).toBe(kind);
      expect(span.back).toBeGreaterThanOrEqual(t.length - 1e-6);
      expect(span.front).toBeLessThanOrEqual(span.walkEnd + 1e-6);
      const s0 = span.walkEnd - 3;
      for (let lat = -half + 0.08; lat < half; lat += 0.45) for (let y = t.floorY + 0.1; y < t.ceilY; y += 0.45) {
        const p = f.at(s0), [x, z] = f.point(s0, lat);
        const hits = raycastAll(w, new THREE.Vector3(x, y, z), new THREE.Vector3(p.tx, 0, p.tz), 8);
        const first = hits.find(h => (h.object as THREE.Mesh).isMesh);
        expect(first, `${kind}: ray at lat ${lat.toFixed(2)} y ${y.toFixed(2)}`).toBeTruthy();
        // Stops at the cap: nothing passes beyond its back.
        expect(first!.distance).toBeLessThanOrEqual(span.back - s0 + 0.05);
      }
    }
  });

  it('rails, third rail, coverboard and sleepers follow the path at the rail offsets, sleepers continuing the bed rhythm', () => {
    const {fx, w} = built();
    const t = fx.east, f = new TunnelFrame(t);
    const sleepers = extMeshes(w).filter(m => (m as THREE.InstancedMesh).isInstancedMesh && m.userData.trackExt.tunnel === t.id) as THREE.InstancedMesh[];
    expect(sleepers.length).toBeGreaterThan(0);
    const m4 = new THREE.Matrix4(), pos = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
    const byRail = new Map<number, number[]>();
    for (const im of sleepers) for (let i = 0; i < im.count; i++) {
      im.getMatrixAt(i, m4); m4.decompose(pos, q, sc);
      const c = f.project(pos.x, pos.z);
      const r = t.rails.find(rr => Math.abs(rr - c.lat) < 0.01);
      expect(r, `sleeper lat ${c.lat}`).toBeDefined();
      expect(pos.y).toBeCloseTo(t.floorY + SHELL.sleeper[1] / 2, 4);
      // Long axis across the track: the box's local Z is perpendicular to the path tangent.
      const z = new THREE.Vector3(0, 0, 1).applyQuaternion(q), p = f.at(c.s);
      expect(Math.abs(z.x * p.tx + z.z * p.tz)).toBeLessThan(0.02);
      byRail.set(r!, [...(byRail.get(r!) ?? []), c.s]);
    }
    const tr = fx.layout.trenches[0];
    for (const list of byRail.values()) {
      list.sort((a, b) => a - b);
      expect(list[0]).toBeCloseTo(sleeperPhase(t, tr), 3);
      // (On the arc a sleeper at lateral r projects back within a few cm of its arc position.)
      for (let i = 1; i < list.length; i++) expect(Math.abs(list[i] - list[i - 1] - SHELL.sleeperStep)).toBeLessThan(0.06);
      // The bed's last sleeper is one step before the first tunnel sleeper (x1 end).
      const per = Math.floor((tr.x1 - tr.x0) / SHELL.sleeperStep), lastBed = tr.x0 + 0.3 + (per - 1) * SHELL.sleeperStep;
      expect(tr.x1 + list[0] - lastBed).toBeCloseTo(SHELL.sleeperStep, 3);
    }
    // Running rails at rail ± gauge; at the mouth they line up with the bed's tracks.
    const rails = extMeshes(w, 'rail').filter(m => m.userData.trackExt.tunnel === t.id);
    const lats = new Set<number>();
    for (const m of rails) for (const p of verts(m)) if (p.y > t.floorY + SHELL.railY + SHELL.railH / 2 - 1e-3 && p.y < t.floorY + SHELL.railY + SHELL.railH / 2 + 1e-3) lats.add(Math.round(f.project(p.x, p.z).lat * 100) / 100);
    for (const r of t.rails) for (const g of [-SHELL.gauge, SHELL.gauge]) {
      expect([...lats].some(l => Math.abs(l - (r + g - SHELL.railW / 2)) < 0.011)).toBe(true);
      expect([...lats].some(l => Math.abs(l - (r + g + SHELL.railW / 2)) < 0.011)).toBe(true);
    }
    const p0 = f.first;
    expect(t.rails.map(r => p0.z + p0.lz * r).sort()).toEqual([...tr.tracks].sort());
  });

  it('a mirrored-convention data set is detected from its door rect and still lines up with the bed and the door', () => {
    const {fx, w} = built({mirrored: true});
    expect(w.trackExt!.view.notes.join(' ')).toMatch(/mirrored/);
    const t = fx.east, sign = resolveLeftSign(t, fx.layout, fx.layout.trenches[0]);
    expect(sign).toBe(-1);
    const f = new TunnelFrame(t, sign), p0 = f.first;
    expect(t.rails.map(r => p0.z + p0.lz * r).sort()).toEqual([...TX.tracks].sort());
    const op = w.trackExt!.shells.perTunnel[0].openings[0];
    const [, zw] = f.point((op.s0 + op.s1) / 2, op.side * t.width / 2);
    expect(zw).toBeCloseTo(TX.bedZ1, 3); // the door is on the +Z wall, where its rect is
    const plain = built();
    expect(plain.w.trackExt!.shells.perTunnel[0].openings[0].s0).toBeCloseTo(op.s0, 3);
  });
});

describe('annex doors', () => {
  it('the shell wall opens exactly over the door rect, with a lintel above its head, a steel frame and a SERVICE plate on the tunnel side', () => {
    const {fx, w} = built();
    const t = fx.east, f = new TunnelFrame(t), op = w.trackExt!.shells.perTunnel[0].openings[0];
    const d = fx.layout.doors[t.doors[0].door];
    // Opening span = the door rect's X extent (straight wall along X).
    const [xa] = f.point(op.s0, op.side * 4), [xb] = f.point(op.s1, op.side * 4);
    expect(Math.min(xa, xb)).toBeCloseTo(d.x * 0.5, 2);
    expect(Math.max(xa, xb)).toBeCloseTo((d.x + d.w) * 0.5, 2);
    expect(op.head).toBeCloseTo(TX.bedY + 2.3, 3);
    const mid = f.at((op.s0 + op.s1) / 2), side = op.side;
    const toWall = new THREE.Vector3(side * mid.lx, 0, side * mid.lz);
    const below = raycastAll(w, new THREE.Vector3(mid.x, t.floorY + 1.2, mid.z), toWall, 4.2).filter(h => h.object.userData.trackExt?.part === 'tunnel');
    expect(below.length).toBe(0); // walk-through
    const above = raycastAll(w, new THREE.Vector3(mid.x, op.head + 0.6, mid.z), toWall, 4.2).filter(h => h.object.userData.trackExt);
    expect(above.length).toBeGreaterThan(0); // lintel / plate
    expect(extMeshes(w, 'sign').length).toBe(1);
    // The builder's default frame for that door is not drawn (the shell's frame replaces it).
    const trimNear = (name: string) => { const m = w.group.getObjectByName(name) as THREE.Mesh | undefined; return m ? verts(m).filter(p => p.z > 35.4 && p.z < 36.6 && p.x > 69.9 && p.x < 71.6).length : 0; };
    let n = 0; w.group.traverse(o => { if (o.name.startsWith('trim-steel')) n += trimNear(o.name); });
    expect(n).toBe(0);
  });

  it('a door on the arc: the curved wall opens over the door rect and the floor runs on through the threshold', () => {
    const {fx, w} = built({bendDoor: true});
    const t = fx.east, f = new TunnelFrame(t), view = w.trackExt!.view;
    const op = w.trackExt!.shells.perTunnel[0].openings.find(o => o.door === t.doors[1].door)!;
    expect(op.s0).toBeLessThan(22);
    expect(op.s1).toBeGreaterThan(22);
    expect(op.s1 - op.s0).toBeGreaterThan(1.0);
    expect(op.s1 - op.s0).toBeLessThan(2.6);
    expect([...view.mode].filter(m => m === 2).length).toBeGreaterThan(0); // some door cells straddle the curved wall
    // Walking out through the opening: there is floor at floorY under every step, inside and beyond the wall line.
    for (const s of [op.s0 + 0.25, (op.s0 + op.s1) / 2, op.s1 - 0.25]) for (let lat = -3.25; lat >= -4.7; lat -= 0.1) {
      const [x, z] = f.point(s, lat);
      const g = fx.layout.grid, i = Math.floor(z / 0.5) * g.w + Math.floor(x / 0.5);
      if (g.cells[i] !== 1 && Math.abs(lat) > 4) continue; // rock beside the passage
      const down = raycastAll(w, new THREE.Vector3(x, t.floorY + 0.05, z), new THREE.Vector3(0, -1, 0), 0.3);
      expect(down.some(h => Math.abs(h.point.y - t.floorY) < 1e-3), `floor at s ${s.toFixed(2)} lat ${lat.toFixed(2)}`).toBe(true);
    }
  });

  it('straddling door-passage cells keep their outside part (clipped at the wall line)', () => {
    const f = new TunnelFrame({id: 9, width: 8, path: [{x: 0, z: 0}, {x: 10, z: 0}]});
    // A cell centred 0.1 m outside the +left wall (z = -4): its outer 0.35 m stays.
    const poly = clipOutside(f, [[4, -4.35], [4.5, -4.35], [4.5, -3.85], [4, -3.85]])!;
    expect(poly).not.toBeNull();
    const zs = poly.map(p => p[1]);
    expect(Math.max(...zs)).toBeCloseTo(-4, 6);
    expect(Math.min(...zs)).toBeCloseTo(-4.35, 6);
    expect(outsideIntervals(0, 1, a => a > 0.3 && a < 0.6).map(([p, q]) => [Math.round(p * 1000) / 1000, Math.round(q * 1000) / 1000])).toEqual([[0, 0.3], [0.6, 1]]);
  });
});

describe('graffiti clues', () => {
  it('decals exist only at clue records (arrow: one mark, tag: tag + arrow), pointing along the route', () => {
    const {fx, w} = built();
    const decals = w.trackExt!.decals;
    const want = fx.ext.tunnels.reduce((n, t) => n + t.clues.reduce((m, c) => m + (c.kind === 'tag' ? 2 : 1), 0), 0);
    expect(decals.length).toBe(want);
    const mesh = w.group.getObjectByName('track-ext-graffiti') as THREE.Mesh;
    expect(mesh).toBeTruthy();
    for (const d of decals) {
      const t = fx.ext.tunnels.find(tt => tt.id === d.tunnel)!, c = t.clues[d.clue];
      expect(d.side).toBe(c.side);
      expect(Math.abs(d.s - c.s)).toBeLessThan(2.5);
      const f = new TunnelFrame(t), p = f.at(d.s);
      // A viewer facing the wall has `right` = (inward.z, -inward.x); the mark points that way iff the route does.
      const inward = [-d.side * p.lx, -d.side * p.lz], right = [inward[1], -inward[0]];
      const routeRight = (p.tx * right[0] + p.tz * right[1]) * c.toward > 0;
      expect(d.dir).toBe(routeRight ? 'right' : 'left');
      if (d.cell < 6) expect(d.cell % 2).toBe(d.dir === 'left' ? 1 : 0);
      expect(d.y - d.h / 2).toBeGreaterThan(t.floorY + 0.5);
    }
    // Decal vertices sit just inside the wall they are painted on.
    const f = new TunnelFrame(fx.east);
    for (const p of verts(mesh)) expect(Math.abs(Math.abs(f.project(p.x, p.z).lat) - (fx.east.width / 2 - GRAFFITI.offset))).toBeLessThan(0.006);
    expect(CELL_OF.tag(1)).toBe(7);
  });

  it('no clue records: no graffiti mesh at all; deterministic per seed', () => {
    const fx = trackExtFixture();
    for (const t of fx.ext.tunnels) t.clues.length = 0;
    const w = buildWorld(fx.layout, mats, {});
    expect(w.group.getObjectByName('track-ext-graffiti')).toBeUndefined();
    expect(w.trackExt!.decals).toEqual([]);
    const a = buildWorld(trackExtFixture().layout, mats, {}), b = built().w;
    expect(a.trackExt!.decals).toEqual(b.trackExt!.decals);
    expect(a.trackExt!.stats).toEqual(b.trackExt!.stats);
  });
});

describe('steam (visual, non-hazardous, bounded)', () => {
  it('Effects.steam refuses puffs beyond STEAM_FX.puffs live; SteamVents never exceeds it and only vents near the player emit', () => {
    const fx = new Effects();
    for (let i = 0; i < 60; i++) fx.steam({x: 0, y: 1, z: 0}, 0, 0.5, 0, 0.2, 5, new THREE.Color(1, 1, 1), 0.2);
    expect(fx.steamLive()).toBe(STEAM_FX.puffs);
    expect(STEAM_FX.puffs).toBeLessThanOrEqual(24);
    fx.clear();
    expect(fx.steamLive()).toBe(0);
    const vents = Array.from({length: 12}, (_, i) => ({x: i * 2, y: 1, z: 0, dir: {x: 0, y: 0, z: 1}}));
    vents.push({x: 500, y: 1, z: 0, dir: {x: 0, y: 0, z: 1}});
    const sv = new SteamVents(fx, vents, 7);
    let maxLive = 0, maxActive = 0;
    for (let k = 0; k < 600; k++) { sv.update(1 / 60, {x: 10, y: 1.6, z: 0}); fx.update(1 / 60); maxLive = Math.max(maxLive, fx.steamLive()); maxActive = Math.max(maxActive, sv.stats().active); }
    expect(maxLive).toBeGreaterThan(0);
    expect(maxLive).toBeLessThanOrEqual(STEAM.puffs);
    expect(maxActive).toBeLessThanOrEqual(STEAM.maxActive);
    // Far from every vent: nothing new; puffs die out.
    for (let k = 0; k < 400; k++) { sv.update(1 / 60, {x: 300, y: 1.6, z: 300}); fx.update(1 / 60); }
    expect(fx.steamLive()).toBe(0);
    expect(fx.group.getObjectByName('fx-steam')).toBeTruthy();
  });

  it('default annex vents sit on annex walls (deterministic), and relighting keeps the puffs dark without light', () => {
    const {fx} = built();
    const vents = annexVents(fx.layout);
    expect(vents.length).toBeGreaterThan(0);
    expect(vents.length).toBeLessThanOrEqual(fx.ext.annexes.length * STEAM.perAnnex);
    const annexAreas = new Set(fx.ext.annexes.flatMap(a => a.areas));
    for (const v of vents) {
      expect(annexAreas.has(v.area!)).toBe(true);
      expect(v.y).toBeGreaterThan(TX.bedY + 0.4);
      expect(v.y).toBeLessThan(TX.annexCeil);
    }
    expect(annexVents(trackExtFixture().layout)).toEqual(vents);
    const e = new Effects();
    e.steam({x: 0, y: 0, z: 0}, 0, 0, 0, 0.2, 3, new THREE.Color(0.8, 0.8, 0.8), 0.2);
    e.relightSteam(() => 0.05);
    const sprite = e.group.getObjectByName('fx-steam') as THREE.Sprite;
    const col = (sprite.material as unknown as {colorNode: unknown}) && (e as unknown as {steamRing: {col: Float32Array}}).steamRing.col;
    expect(col[0]).toBeCloseTo(0.04, 5);
  });
});

describe('warm-up, draws and lights', () => {
  it('every track-extension mesh is in the station group at build, warm-up discoverable; the steam ring is in the effects pool', () => {
    const {w} = built();
    const scene = new THREE.Scene(), fx = new Effects();
    scene.add(w.group, fx.group);
    const plan = planWarmup(scene, {mode: 'full', cameraMask: 1, pools: [fx.group]});
    const keys = new Set(plan.items.flatMap(i => warmKeys(i.object)));
    const ext = extMeshes(w).concat(w.group.getObjectByName('track-ext-graffiti') as THREE.Mesh);
    expect(ext.length).toBeGreaterThan(10);
    for (const m of ext) {
      expect(m.visible).toBe(true);
      let p: THREE.Object3D | null = m;
      while (p && p !== w.group) p = p.parent;
      expect(p).toBe(w.group);
      for (const k of warmKeys(m)) expect(keys.has(k), `${m.name} ${k}`).toBe(true);
    }
    expect(plan.items.some(i => i.object.name === 'fx-steam')).toBe(true);
  });

  it('bounded draws / triangles per 100 m of tunnel; no light of any kind added', () => {
    const {fx, w} = built();
    const st = w.trackExt!.stats;
    expect(st.tunnels).toBe(2);
    for (const p of w.trackExt!.shells.perTunnel) {
      const chunks = Math.ceil(p.length / SHELL.chunk);
      expect(p.draws).toBeLessThanOrEqual(4 * chunks + 10);
      expect(p.triangles / p.length).toBeLessThan(260); // < 26k triangles per 100 m incl. the cap
    }
    expect(st.per100m.triangles).toBeLessThan(26000);
    // A 100 m straight tunnel (+ the 16 m west one): a few draws per 48 m chunk, ~10k triangles per 100 m.
    const long = built({bend: 0, eastLen: 100, eastCap: 'gate'});
    const pl = long.w.trackExt!.shells.perTunnel[0];
    expect(pl.length).toBeCloseTo(100, 6);
    expect(pl.draws).toBeLessThanOrEqual(4 * Math.ceil(pl.length / SHELL.chunk) + 10);
    expect(pl.triangles).toBeLessThan(16000);
    // No lights: layout lights untouched, no three.js lights in the world, none tinted.
    expect(fx.layout.lights.length).toBe(1);
    let lights = 0; w.group.traverse(o => { if ((o as THREE.Light).isLight) lights++; });
    expect(lights).toBe(0);
    expect(fx.layout.lights.some(l => l.tint)).toBe(false);
  });
});

describe('annex look and sound', () => {
  it('annex walls are cast concrete in the lower zone (lowerConcrete), highly neglected; tunnels ring as track tunnels', () => {
    const {fx, w} = built();
    const annexAreas = new Set(fx.ext.annexes.flatMap(a => a.areas));
    const faces = w.wallFaces.filter(f => annexAreas.has(f.area));
    expect(faces.length).toBeGreaterThan(4);
    for (const f of faces) { expect(f.zone).toBe('lower'); expect(f.finish).toBe('platformFace'); expect(treatmentOf(f)).toBe('lowerConcrete'); }
    const room = fx.layout.areas[fx.ids.annexRoom], tunnel = fx.layout.areas[fx.east.areas[0]];
    expect(areaNeglect(room, 'main', false)).toBeGreaterThanOrEqual(0.86);
    expect(areaNeglect(tunnel, 'main', false)).toBeGreaterThanOrEqual(0.85);
    expect(roomKindFor(tunnel)).toBe('tunnel');
    expect(ambienceTypeFor(tunnel)).toBe('track');
    expect(ambienceTypeFor(room)).toBe('utility');
    expect(roomKindFor(room)).toBe('small');
  });

  it("extension faces get their own wall-detail budget after the core's", () => {
    const {fx, w} = built();
    const plan = planWallDetail(fx.layout as StationLayout, {faces: w.wallFaces});
    const isExt = (i: number) => !!(fx.layout.areas[plan.faces[i].face.area] as {ext?: string} | undefined)?.ext;
    const first = plan.faces.findIndex((_, i) => isExt(i));
    expect(first).toBeGreaterThan(0);
    for (let i = first; i < plan.faces.length; i++) expect(isExt(i)).toBe(true);
    const ext = plan.features.filter(f => isExt(f.face));
    const caps = extWallDetailCaps(fx.layout as StationLayout);
    for (const layer of ['cut', 'decal', 'soft', 'flush', 'proud'] as const) expect(ext.filter(f => f.layer === layer).length).toBeLessThanOrEqual(caps[layer]);
    expect(ext.filter(f => f.kind === 'breach').length).toBeLessThanOrEqual(caps.breach);
  });

  it('a layout without extensions builds exactly as before (no view, no track-ext meshes)', () => {
    const fx = trackExtFixture({noWest: true});
    delete (fx.layout as {extensions?: unknown}).extensions;
    expect(TrackExtView.of(fx.layout)).toBeNull();
    const w = buildWorld(fx.layout, mats, {});
    expect(w.trackExt).toBeUndefined();
    expect(extMeshes(w).length).toBe(0);
  });
});
