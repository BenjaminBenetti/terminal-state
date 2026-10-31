// Task mall-round2-20261031 (lane ARCH, M09 rendering): the LOCKED glazed street exits lane GEN places (layout.mall.exits, lanes/GEN.notes
// CONTRACT) — rendered by world/mallStreetExit.ts through world/mallArch.ts, culled by world/levelCulling.ts's aperture gate:
//  - record -> spec / exit frame (every side a proper rotation, w outward);
//  - visual = collision: the hall-end wall face carries the opening cut, every inner pane lies inside GEN's collider, frame members +
//    panes tile the whole opening (no see-through gap, no invisible collider), the hall stays walkable up to the plane;
//  - the legible lock (chain + padlock per leaf pair on the push bars, EXIT CLOSED sign, notice / NO EXIT, plywood);
//  - the exterior (street, facades, backdrop, fog cards) stays inside GEN's view volume, outside the mall footprint;
//  - palette: the Office fog (EXT_FOG density through the EXT_U uniforms; the roof's own horizon murk colour);
//  - culling: drawn from the hall (depth oracle: nothing visible culled), not submitted from a shop beside it, another storey, the
//    platform, facing away;
//  - NO indoor gas near the exits (the gas system stays inert); the TSL graphs build; warm-up coverage; per-exit cost bounded;
//  - old levels unchanged (Subway / Office: no exit mesh, no aperture entry; a mall without exits: no cut, no mesh).
import {writeFileSync} from 'node:fs';
import * as THREE from 'three';
import {describe, expect, it} from 'vitest';
import {installCanvasShim} from './helpers/canvas2d';
import {fakeEnvTextures} from './helpers/openablesFixture';
import {buildBoth} from './helpers/tslShaders';
import {visibleMeshes} from './helpers/visibleMeshes';
import {FIX_EXIT, MALL_FIX, mallFixture, mallY} from './helpers/mallFixture';
import {CELL, FLOOR, SOLID, VOID} from '../src/gen/grid';
import {WorldMaterials} from '../src/world/materials';
import {buildWorld, type BuiltWorld} from '../src/world/builder';
import {generateStation, type StationLayout} from '../src/gen/station';
import {generateOfficeLevel} from '../src/gen/office/index';
import {CULL_LAYER} from '../src/world/levelCulling';
import {planWarmup} from '../src/render/warmup';
import {MALL_FOG} from '../src/world/mallAtmosphere';
import {MALL_EXT_ORDER, mallSkyPalette} from '../src/world/mallExterior';
import {EXT_FOG, exteriorFogOpacity} from '../src/world/exterior';
import {
  STREET_WORDS, apertureOf, buildStreetExit, cutExitOpenings, exitFrame, planStreet, streetExitMaterials, streetExitSpecs, streetFogOpacity,
  streetMurkCpu, type StreetExitSpec,
} from '../src/world/mallStreetExit';
import {readTowerInfo} from '../src/world/towerShared';
import {roofAirOf} from '../src/world/roofAir';
import {installGas, type GasHost} from '../src/world/gas/system';

installCanvasShim(false);
// every string drawn on a canvas during this file (the lock's words must reach the atlas)
const drawn: string[] = [];
{
  const proto = Object.getPrototypeOf((document as unknown as {createElement(t: string): {getContext(k: string): object}}).createElement('canvas').getContext('2d')) as {fillText: (t: string, x: number, y: number) => void};
  const orig = proto.fillText;
  proto.fillText = function (t: string, x: number, y: number) { drawn.push(String(t)); return orig.call(this, t, x, y); };
}

const mats = () => new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17});
const F = mallFixture({exits: true});
let world: BuiltWorld | null = null;
const fw = (): BuiltWorld => (world ??= buildWorld(F.layout, mats(), {}));
const meshes = (root: THREE.Object3D): THREE.Mesh[] => { const out: THREE.Mesh[] = []; root.traverse(o => { if ((o as THREE.Mesh).isMesh) out.push(o as THREE.Mesh); }); return out; };
const matOf = (m: THREE.Mesh) => (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.Material;
const culled = (m: THREE.Object3D) => (m.layers.mask >>> 0) === ((1 << CULL_LAYER) >>> 0);
const exitMeshes = (w: BuiltWorld) => meshes(w.group).filter(m => m.name.startsWith('mall-exit-'));
const cam = (pos: [number, number, number], target: [number, number, number]): THREE.PerspectiveCamera => {
  const c = new THREE.PerspectiveCamera(75, 16 / 9, 0.05, MALL_FOG.far);
  c.position.set(...pos);
  c.lookAt(...target);
  c.updateMatrixWorld(true);
  return c;
};
/** World triangles of a mesh: vertices + face normal. */
const tris = (q: THREE.Mesh): {v: THREE.Vector3[]; n: THREE.Vector3; c: THREE.Vector3}[] => {
  q.updateMatrixWorld(true);
  const P = q.geometry.attributes.position, idx = q.geometry.index, n = idx ? idx.count : P.count, out = [];
  for (let t = 0; t < n; t += 3) {
    const v = [0, 1, 2].map(k => new THREE.Vector3().fromBufferAttribute(P, idx ? idx.getX(t + k) : t + k).applyMatrix4(q.matrixWorld));
    const nn = new THREE.Vector3().subVectors(v[1], v[0]).cross(new THREE.Vector3().subVectors(v[2], v[0]));
    out.push({v, n: nn.lengthSq() > 0 ? nn.normalize() : nn, c: v[0].clone().add(v[1]).add(v[2]).divideScalar(3)});
  }
  return out;
};
const Y1 = mallY(1);

describe('street exit record -> spec, exit frame', () => {
  it('reads lane GEN\'s record (panes, vestibule = facade - plane, hall ceiling, collider, view); none -> []', () => {
    const specs = streetExitSpecs(F.layout, () => NaN);
    expect(specs.length).toBe(1);
    const s = specs[0];
    expect(s.level).toBe(1);
    expect(s.streetY).toBe(Y1);
    expect([s.nx, s.nz]).toEqual([1, 0]);
    expect(s.plane).toBe(58);
    expect([s.s0, s.s1, s.y0, s.y1]).toEqual([28.5, 31.5, 6, 9]);
    expect(s.vestibule).toBeCloseTo(2.5, 6);
    expect(s.hallCeil).toBe(9.4);
    expect(s.panels.map(p => p.kind)).toEqual(['sidelight', 'door', 'door', 'sidelight', 'transom']);
    expect(streetExitSpecs(mallFixture().layout, () => NaN)).toEqual([]);
    expect(streetExitSpecs(generateStation(4242), () => NaN)).toEqual([]);
  });

  it('every side: origin on the hall-side plane, w outward, [along | up | out] a proper rotation', () => {
    for (const side of ['N', 'S', 'E', 'W'] as const) {
      const n = {N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0]}[side];
      const alongX = n[1] !== 0;
      const s = {
        id: side, level: 1, streetY: 5, nx: n[0], nz: n[1], plane: 20, s0: 10, s1: 15, y0: 5, y1: 8,
        collider: alongX ? {x0: 9.5, x1: 15.5, z0: n[1] > 0 ? 20 : 17.5, z1: n[1] > 0 ? 22.5 : 20, y0: 5, y1: 9} : {z0: 9.5, z1: 15.5, x0: n[0] > 0 ? 20 : 17.5, x1: n[0] > 0 ? 22.5 : 20, y0: 5, y1: 9},
        view: alongX ? {x0: 2, x1: 23, z0: n[1] > 0 ? 22.5 : -2.5, z1: n[1] > 0 ? 42.5 : 17.5, y0: 4, y1: 35} : {z0: 2, z1: 23, x0: n[0] > 0 ? 22.5 : -2.5, x1: n[0] > 0 ? 42.5 : 17.5, y0: 4, y1: 35},
        vestibule: 2.5, hallCeil: 9.2, panels: [], seed: 9,
      } as unknown as StreetExitSpec;
      const f = exitFrame(s);
      expect(f.m.determinant()).toBeCloseTo(1, 9);
      const o = new THREE.Vector3(0, 0, 0).applyMatrix4(f.m);
      expect(alongX ? o.z : o.x).toBeCloseTo(20, 9);
      expect(o.y).toBe(5);
      const p = new THREE.Vector3(0, 0, 3).applyMatrix4(f.m);
      expect(p.x - o.x).toBeCloseTo(3 * n[0], 9);
      expect(p.z - o.z).toBeCloseTo(3 * n[1], 9);
      // the built exit: every exterior vertex inside the view volume (any side)
      const v = buildStreetExit({...s, panels: [{kind: 'door', s0: 11.6, s1: 12.5, y0: 5, y1: 7.3}, {kind: 'door', s0: 12.5, s1: 13.4, y0: 5, y1: 7.3}]});
      for (const m of v.meshes.filter(q => /street|fog/.test(q.name))) for (const t of tris(m)) for (const q of t.v) {
        expect(q.x >= s.view.x0 - 0.06 && q.x <= s.view.x1 + 0.06 && q.z >= s.view.z0 - 0.06 && q.z <= s.view.z1 + 0.06, `${side} ${m.name} ${q.toArray()}`).toBe(true);
      }
    }
  });
});

describe('the locked exit on the fixture build: visual = collision, legible lock', () => {
  it('four meshes per exit (frame, street, fog, glass) on the street storey, aperture-tagged; materials, render order, no shadows from the exterior', () => {
    const w = fw(), st = w.mallArch!.stats;
    expect(st.exits).toBe(1);
    const ms = exitMeshes(w);
    expect(ms.map(m => m.name).sort()).toEqual(['mall-exit-exit-1-fog', 'mall-exit-exit-1-frame', 'mall-exit-exit-1-glass', 'mall-exit-exit-1-street']);
    for (const m of ms) {
      expect(m.userData.level).toBe(1);
      expect(m.userData.aperture).toEqual({nx: 1, nz: 0, plane: 58, s0: 28.5, s1: 31.5, y0: 6, y1: 9});
    }
    const by = (k: string) => ms.find(m => m.name.endsWith(k))!;
    const glass = matOf(by('glass')), fog = matOf(by('fog')), street = matOf(by('street')), frame = matOf(by('frame'));
    expect(glass.transparent && glass.depthWrite).toBe(true); // stops the interior haze march, like the roof glass
    expect(fog.transparent && !fog.depthWrite).toBe(true);
    expect(street.transparent).toBe(false);
    for (const m of [glass, fog, street]) expect((m as {fog?: boolean}).fog).toBe(false);
    expect(by('fog').renderOrder).toBe(MALL_EXT_ORDER.gas);
    expect(by('fog').renderOrder).toBeLessThan(by('glass').renderOrder);
    expect((frame as THREE.MeshStandardMaterial).isMeshStandardMaterial).toBe(true); // lit (blocks the torch like a wall)
    expect((street as {isMeshStandardMaterial?: boolean}).isMeshStandardMaterial).toBeFalsy(); // never a flashlight caster
    expect(st.exitCost[0].meshes).toBe(4);
  });

  it('the hall-end wall face carries the opening (cut up to the head), the hall stays walkable to the plane, the rock behind is SOLID', () => {
    const w = fw();
    const fs = w.wallFaces.filter(f => f.level === 1 && Math.abs(f.x0 - 58) < 1e-6 && Math.abs(f.x1 - 58) < 1e-6 && f.nx < 0 && Math.min(f.z0, f.z1) < 30 && Math.max(f.z0, f.z1) > 30);
    expect(fs.length).toBeGreaterThan(0);
    for (const f of fs.filter(q => q.y0 < 9 - 1e-3)) {
      const a0 = Math.min(f.z0, f.z1);
      expect(f.openings.some(o => a0 + o.s0 <= 28.5 + 1e-6 && a0 + o.s1 >= 31.5 - 1e-6 && o.top >= Math.min(9, f.y1) - 1e-6), `band ${f.y0}`).toBe(true);
    }
    // no wall triangle inside the opening (the glass is visible), the lintel above it stays
    const walls = meshes(w.group).filter(m => /^mall-arch-wall|^arch-wall/.test(m.name));
    for (const m of walls) for (const t of tris(m)) {
      const inOpening = Math.abs(t.c.x - 58) < 0.02 && t.c.z > 28.52 && t.c.z < 31.48 && t.c.y > 6.02 && t.c.y < 8.98;
      expect(inOpening, `${m.name} ${t.c.toArray()}`).toBe(false);
    }
    const g = F.levels[1].grid;
    const cell = (x: number, z: number) => g.cells[Math.floor(z / CELL) * MALL_FIX.W + Math.floor(x / CELL)];
    for (const z of [28.75, 30, 31.25]) { expect(cell(57.75, z)).toBe(FLOOR); expect(cell(58.25, z)).toBe(SOLID); expect(cell(59.75, z)).toBe(SOLID); }
  });

  it('every pane lies inside GEN\'s collider; the inner frame members + panes tile the whole opening; nothing deeper than 0.15 m into the hall', () => {
    const w = fw(), ms = exitMeshes(w), c = FIX_EXIT.collider;
    const glass = ms.find(m => m.name.endsWith('glass'))!, frame = ms.find(m => m.name.endsWith('frame'))!;
    for (const t of tris(glass)) for (const q of t.v) {
      expect(q.x >= c.x0 - 1e-6 && q.x <= c.x1 + 1e-6 && q.z >= c.z0 - 1e-6 && q.z <= c.z1 + 1e-6 && q.y >= c.y0 - 1e-6 && q.y <= c.y1 + 1e-6, `pane vertex ${q.toArray()}`).toBe(true);
    }
    for (const t of tris(frame)) for (const q of t.v) expect(q.x, `frame vertex ${q.toArray()}`).toBeGreaterThanOrEqual(58 - 0.15);
    // coverage: rasterise the hall-facing frame faces and the panes of the inner set (x 57.85 .. 58.4) onto the opening (z, y)
    const step = 0.03, NZ = Math.round(3 / step), NY = Math.round(3 / step), cov = new Uint8Array(NZ * NY);
    const raster = (v: THREE.Vector3[]) => {
      const zs = v.map(p => p.z), ys = v.map(p => p.y);
      const i0 = Math.max(0, Math.floor((Math.min(...zs) - 28.5) / step)), i1 = Math.min(NZ - 1, Math.ceil((Math.max(...zs) - 28.5) / step));
      const j0 = Math.max(0, Math.floor((Math.min(...ys) - 6) / step)), j1 = Math.min(NY - 1, Math.ceil((Math.max(...ys) - 6) / step));
      const [a, b, d] = v, area = (b.z - a.z) * (d.y - a.y) - (d.z - a.z) * (b.y - a.y);
      if (Math.abs(area) < 1e-12) return;
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const z = 28.5 + (i + 0.5) * step, y = 6 + (j + 0.5) * step;
        let w0 = (b.z - z) * (d.y - y) - (d.z - z) * (b.y - y), w1 = (d.z - z) * (a.y - y) - (a.z - z) * (d.y - y), w2 = (a.z - z) * (b.y - y) - (b.z - z) * (a.y - y);
        if (area < 0) { w0 = -w0; w1 = -w1; w2 = -w2; }
        if (w0 >= -1e-9 && w1 >= -1e-9 && w2 >= -1e-9) cov[j * NZ + i] = 1;
      }
    };
    for (const t of tris(frame)) if (t.n.x < -0.5 && t.v.every(q => q.x > 57.85 && q.x < 58.4)) raster(t.v);
    for (const t of tris(glass)) if (t.v.every(q => q.x > 57.85 && q.x < 58.4)) raster(t.v);
    const holes: string[] = [];
    for (let j = 0; j < NY; j++) for (let i = 0; i < NZ; i++) if (!cov[j * NZ + i]) holes.push(`z ${(28.5 + (i + 0.5) * step).toFixed(3)} y ${(6 + (j + 0.5) * step).toFixed(3)}`);
    expect(holes.slice(0, 8), `${holes.length} uncovered samples`).toEqual([]);
    // the pocket / outer set / their dressing beyond the plane stand in rock (SOLID or off the grid) on the street storey
    const g = F.levels[1].grid;
    for (const t of tris(frame)) {
      if (t.c.x < 58.05) continue;
      const cx = Math.floor(t.c.x / CELL), cz = Math.floor(t.c.z / CELL);
      if (cx < MALL_FIX.W && cz >= 0 && cz < MALL_FIX.H) expect(g.cells[cz * MALL_FIX.W + cx], `frame at ${t.c.toArray()}`).toBe(SOLID);
    }
  });

  it('the lock reads: a chain + padlock per leaf pair on the push bars, EXIT CLOSED / DOORS LOCKED sign, the notice and NO EXIT, plywood', () => {
    const w = fw();
    void w;
    for (const t of [...STREET_WORDS.sign, ...STREET_WORDS.notice, ...STREET_WORDS.noExit]) expect(drawn.includes(t), t).toBe(true);
    expect(drawn).toContain('CLOSED');
    expect(FIX_EXIT.sign).toBe(STREET_WORDS.sign[0]);
    // the chain: small steel boxes round 1.0 m on the hall side of the inner set, across the leaf pair's meeting stiles (z 30)
    const frame = exitMeshes(w).find(m => m.name.endsWith('frame'))!;
    const col = frame.geometry.getAttribute('color'), P = frame.geometry.getAttribute('position');
    let chain = 0, brass = 0, glow = 0;
    const gl = frame.geometry.getAttribute('aGlow');
    for (let i = 0; i < P.count; i++) {
      const x = P.getX(i), y = P.getY(i), z = P.getZ(i), r = col.getX(i), gg = col.getY(i), b = col.getZ(i);
      if (Math.abs(r - 0.33) < 1e-3 && Math.abs(gg - 0.32) < 1e-3 && x < 58.12 && Math.abs(z - 30) < 0.32 && y > Y1 + 0.6 && y < Y1 + 1.15) chain++;
      if (Math.abs(r - 0.58) < 1e-3 && Math.abs(b - 0.2) < 1e-3 && Math.abs(z - 30) < 0.06) brass++;
      if (gl.getX(i) > 0.5) glow++;
    }
    expect(chain).toBeGreaterThan(100);
    expect(brass).toBeGreaterThanOrEqual(24);
    expect(glow).toBe(4); // the lit sign face (one quad)
  });
});

describe('the exterior beyond the glass: inside the view volume, outside the footprint, the Office fog', () => {
  it('street / facades / backdrop / fog cards stay inside GEN\'s view volume and off every storey\'s open cells', () => {
    const w = fw(), v = FIX_EXIT.view;
    const ext = exitMeshes(w).filter(m => /street|fog/.test(m.name));
    expect(ext.length).toBe(2);
    let n = 0;
    for (const m of ext) for (const t of tris(m)) for (const q of t.v) {
      n++;
      expect(q.x >= v.x0 - 0.06 && q.x <= v.x1 + 0.06 && q.z >= v.z0 - 0.06 && q.z <= v.z1 + 0.06 && q.y >= v.y0 - 0.5 && q.y <= v.y1 + 0.06, `${m.name} ${q.toArray()}`).toBe(true);
      const cx = Math.floor(q.x / CELL), cz = Math.floor(q.z / CELL);
      if (cx < 0 || cz < 0 || cx >= MALL_FIX.W || cz >= MALL_FIX.H) continue;
      for (const L of F.levels) {
        const c = L.grid.cells[cz * MALL_FIX.W + cx];
        if (c === FLOOR || c === VOID) expect(q.y < L.grid.floorOf(cz * MALL_FIX.W + cx) - 0.05 || q.y > L.grid.ceil[cz * MALL_FIX.W + cx] + 0.05, `${m.name} in an open cell of L${L.id}`).toBe(true);
      }
    }
    expect(n).toBeGreaterThan(300);
  });

  it('the plan: pavement, curb, road, far pavement, facades across the street, wrecks, fog cards — all in the volume', () => {
    const s = fw().mallArch!.exits()[0];
    const p = planStreet(s);
    expect(p.B).toBeCloseTo(2.5, 6);
    expect(p.pavement[0]).toBeCloseTo(p.B, 6);
    expect(p.road[0]).toBeGreaterThan(p.pavement[1]);
    expect(p.road[1] - p.road[0]).toBeGreaterThanOrEqual(5);
    expect(p.buildings.length).toBeGreaterThan(0);
    for (const b of p.buildings) {
      expect(b.u0).toBeGreaterThanOrEqual(p.vol.u0 - 1e-6);
      expect(b.u1).toBeLessThanOrEqual(p.vol.u1 + 1e-6);
      expect(b.w0).toBeGreaterThanOrEqual(p.farPavement[1] - 1e-6);
      expect(b.w1).toBeLessThanOrEqual(p.vol.w1 + 1e-6);
      expect(b.w1).toBeGreaterThan(b.w0);
    }
    expect(p.cards.length).toBeGreaterThanOrEqual(3);
    for (const c of p.cards) { expect(c.w).toBeGreaterThan(p.B); expect(c.w).toBeLessThan(p.vol.w1); }
  });

  it('palette = the Office fog: the roof\'s horizon murk (Office hue, >= its saturation), the Office density / range / patches', () => {
    const srgb = (c: readonly number[]) => c.map(v => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055));
    const hsv = (c: readonly number[]) => {
      const [r, g, b] = srgb(c), mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
      const h = d === 0 ? 0 : mx === r ? 60 * (((g - b) / d) % 6) : mx === g ? 60 * ((b - r) / d + 2) : 60 * ((r - g) / d + 4);
      return {h: (h + 360) % 360, s: mx ? d / mx : 0};
    };
    const office = hsv(EXT_FOG.color), murk = streetMurkCpu();
    expect(Math.abs(hsv(murk).h - office.h)).toBeLessThan(8);
    expect(hsv(murk).s).toBeGreaterThanOrEqual(office.s - 1e-6);
    expect(hsv(murk).s).toBeLessThan(0.65);
    expect(murk).toEqual(mallSkyPalette().horizon); // exactly the roof sky's horizon (one palette through roof and doors)
    for (const L of [5, 12, 25]) expect(streetFogOpacity(L, 1.6)).toBe(exteriorFogOpacity(L, 1.6, 1.6));
    expect(streetFogOpacity(15)).toBeGreaterThan(0.4); // heavy murk across the street
    // fog cards: each slice's Office fog opacity x the Office patch variation (no mean density counted twice)
    const p = planStreet(fw().mallArch!.exits()[0]);
    let prev = p.B;
    for (const c of p.cards) { expect(c.opacity).toBeCloseTo(exteriorFogOpacity(c.w - prev, 1.6, 1.6) * EXT_FOG.noise * 2, 9); prev = c.w; }
  });
});

describe('culling: the street is drawn only while its opening may be seen', () => {
  const check = (w: BuiltWorld, c: THREE.PerspectiveCamera, label: string) => {
    w.culler.update(c, true);
    const vis = visibleMeshes(w.group, c, 128, 72, {minPx: 1});
    const bad = [...vis].filter(([m]) => culled(m)).map(([m, n]) => `${m.name} L${m.userData.level} ${n}px`);
    expect(bad, `${label}: visible but culled`).toEqual([]);
    return vis;
  };

  it('from the hall and from the gallery down the corridor: every exit mesh drawn, the street visible through the glass', () => {
    const w = fw();
    for (const [label, pos, target] of [
      ['hall', [52, Y1 + 1.6, 30], [58, Y1 + 1.6, 30]], ['near the doors', [56.6, Y1 + 1.6, 29.2], [59, Y1 + 1.2, 31]],
      ['gallery', [44, Y1 + 1.6, 30.5], [58, Y1 + 1.8, 30]], ['far gallery', [16, Y1 + 1.6, 30], [58, Y1 + 1.6, 30]],
    ] as [string, [number, number, number], [number, number, number]][]) {
      const c = cam(pos, target);
      const vis = check(w, c, label);
      for (const m of exitMeshes(w)) expect(culled(m), `${label}: ${m.name}`).toBe(false);
      const street = exitMeshes(w).find(m => m.name.endsWith('street'))!;
      expect(vis.get(street) ?? 0, `${label}: street pixels`).toBeGreaterThan(0);
    }
  });

  it('not submitted from a shop beside the exit, from floor 2 above it, from the platform, or facing away; nothing visible is culled', () => {
    const w = fw();
    for (const [label, pos, target] of [
      ['shop beside', [55, Y1 + 1.6, 36], [60, Y1 + 1.6, 30]], ['floor 2 corridor', [52, mallY(2) + 1.6, 30], [58, mallY(2) + 1.6, 30]],
      ['platform', [MALL_FIX.start.x, 1.6, MALL_FIX.start.z], [58, 7, 30]], ['facing away', [52, Y1 + 1.6, 30], [40, Y1 + 1.6, 30]],
    ] as [string, [number, number, number], [number, number, number]][]) {
      const c = cam(pos, target);
      check(w, c, label);
      const ms = exitMeshes(w);
      expect(ms.every(culled), `${label}: ${ms.filter(m => !culled(m)).map(m => m.name)}`).toBe(true);
    }
    // the gate itself (not only the level rule) hides it from the shop beside the corridor (same storey)
    w.culler.update(cam([55, Y1 + 1.6, 36], [60, Y1 + 1.6, 30]), true);
    expect(w.culler.apertureCulled).toBeGreaterThan(0);
  });
});

describe('no indoor gas at the exits; shaders; warm-up; cost', () => {
  it('NO indoor gas hazard by the locked doors: the gas system stays inert (no field, no windows, no exposure, no damage)', () => {
    const L = F.layout;
    expect(roofAirOf(L)).toBeNull();
    const info = readTowerInfo(L)!;
    expect(info.windows.length).toBe(0); // the street exits are not Office windows (no outside air, no gas field)
    const hits: number[] = [], layers: number[] = [];
    let clock = 0;
    const h = {
      player: {x: 52, z: 30, y: Y1, eye: Y1 + 1.6, alive: true, takeDamage(a: number) { hits.push(a); }},
      layout: L, tower: {office: {info, windows: null}},
      atmosphere: {active: true, setGasLayer: (slot: number) => { layers.push(slot); }}, atmosphereBypass: null,
      run: {laneStore: () => undefined, setLaneStore: () => {}},
      get clock() { return clock; }, state: 'playing',
      frameHooks: [] as ((dt: number) => void)[], sectionHooks: [] as {build?(l: StationLayout): void; teardown?(): void}[],
      stateListeners: [] as ((s: never, p: never) => void)[], bulletHitHandlers: [] as ((...a: never[]) => boolean)[],
    };
    const sys = installGas(h as unknown as GasHost);
    h.sectionHooks[0].build!(L);
    expect(sys.field).toBeNull();
    expect(sys.windows).toBeNull();
    // right at the glass (centre and a corner), mid-hall, at the corridor mouth
    for (const [x, z] of [[57.7, 30], [57.7, 28.7], [53, 30], [48.5, 30]] as const) {
      Object.assign(h.player, {x, z, y: Y1, eye: Y1 + 1.6});
      for (let t = 0; t < 2; t += 1 / 30) { clock += 1 / 30; for (const fn of h.frameHooks) fn(1 / 30); }
      expect(sys.exposure.c, `exposure at ${x},${z}`).toBe(0);
      expect(sys.exposure.dps).toBe(0);
      expect(sys.exposure.source).toBeNull();
    }
    expect(hits).toEqual([]);
    expect(layers).toEqual([]);
    expect(sys.exposure.damage).toBe(0);
  });

  it('every street-exit TSL graph builds cleanly on WGSL and GLSL; the warm-up plans the exit materials even when culled', () => {
    const w = fw();
    for (const m of exitMeshes(w)) {
      for (const sh of buildBoth(m, {lights: [new THREE.SpotLight(0xffffff, 1)]})) expect(sh.errors, `${m.name} ${sh.backend}`).toEqual([]);
    }
    w.culler.update(cam([52, mallY(2) + 1.6, 30], [58, mallY(2) + 1.6, 30]), true);
    expect(exitMeshes(w).every(culled)).toBe(true);
    const plan = planWarmup(w.group, {mode: 'full', cameraMask: new THREE.PerspectiveCamera().layers.mask});
    const planned = new Set(plan.items.map(i => matOf(i.object as THREE.Mesh)));
    for (const m of streetExitMaterials()) expect(planned.has(m), m.name).toBe(true);
  });

  it('cost per exit: 4 draws (one per mesh: shared materials / one atlas), bounded triangles', () => {
    const w = fw(), c = w.mallArch!.stats.exitCost[0];
    const per = Object.fromEntries(exitMeshes(w).map(m => [m.name, (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3]));
    if (process.env.LL_MALL_EXIT_OUT) writeFileSync(process.env.LL_MALL_EXIT_OUT, JSON.stringify({cost: c, perMesh: per, plan: planStreet(w.mallArch!.exits()[0])}, null, 1)); // (vitest hides console output)
    expect(c.meshes).toBe(4);
    expect(c.triangles).toBeLessThan(4000);
    const mats4 = new Set(exitMeshes(w).map(matOf));
    expect(mats4.size).toBe(4);
    for (const m of streetExitMaterials()) expect(mats4.has(m)).toBe(true);
  });
});

describe('old levels unchanged; a mall without exits unchanged', () => {
  it('Subway / Office: no exit mesh, no aperture entry; a mall without exits: no cut, no exit mesh', () => {
    for (const L of [generateStation(4242), generateOfficeLevel({levelSeed: 777, startWeapon: 'pistol'} as never) as StationLayout]) {
      const w = buildWorld(L, mats(), {});
      expect(meshes(w.group).some(m => m.name.startsWith('mall-exit-'))).toBe(false);
      expect(w.culler.entries.some(e => (e as {aperture?: unknown}).aperture)).toBe(false);
    }
    const plain = buildWorld(mallFixture().layout, mats(), {});
    expect(plain.mallArch!.stats.exits).toBe(0);
    expect(exitMeshes(plain)).toEqual([]);
    expect(plain.wallFaces.some(f => f.level === 1 && Math.abs(f.x0 - 58) < 1e-6 && f.nx < 0 && f.openings.length)).toBe(false);
    const faces = [{level: 1, x0: 58, z0: 27, x1: 58, z1: 33, y0: 6, y1: 9.4, nx: -1, nz: 0, openings: []}];
    expect(cutExitOpenings(faces, [])).toBe(faces);
    expect(apertureOf(fw().mallArch!.exits()[0]).plane).toBe(58);
  });
});
