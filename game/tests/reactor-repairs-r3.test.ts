// Task studio-reactor-surface-ending-20261102 (lane REPAIRS): the user's Reactor feedback round 3, items 1 / 4 / 5, on REAL generated
// layouts (no browser):
//  (1) "the floor around the reactor does not go under the reactor so there are gaps!" — the core deck continues under the vessel: the
//      plinth's perimeter and the band beyond it are drawn deck at the deck height on every seed (render triangles on one seed); the
//      fill never touches the goop pool / bridges; the vessel stays the blocked, raised column (collision unchanged);
//  (4) "heavy z-fighting on the nuclear waste area emergency wash stations" — the decon shower booth's zero-thickness double sheets:
//      drawn single-sided with its hidden coplanar faces dropped (the delivered maps kept); the procedural stand-in has no coplanar faces;
//  (5) "some overlapping signs in the sub areas" — no two plates of a complex overlap, no plate meets a prop / decor / waste box /
//      fixture, every plate stays wall-backed at a legible height, the complexes' key plates survive (>= 12 seeds).
import {beforeAll, describe, expect, it} from 'vitest';
import * as THREE from 'three';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {LEVELS} from '../src/levels/registry';
import {CELL, FLOOR, SOLID} from '../src/gen/grid';
import {signDims, wallBacked} from '../src/gen/doorways';
import {CORE_LEVEL} from '../src/gen/reactor/index';
import {coreFloorIssues, CORE_FLOOR} from '../src/gen/reactor/coreFloor';
import {PLATE_CLEAR_STATS} from '../src/gen/reactor/complex/plateClear';
import {cellBlocks} from '../src/core/physics';
import {ReactorArch, CORE_HIDDEN, CORE_GOOP} from '../src/world/reactor/arch';
import {CORE_CELL} from '../src/world/reactor/coreHero';
import {REACTOR_MODELS} from '../src/world/reactor/archAssets';
import {buildWasteVisuals} from '../src/world/reactor/wasteVisuals';
import {COPLANAR_BAND, coplanarStats} from '../src/world/reactor/coplanar';
import {REACTOR_X_KIT} from '../src/assets/reactorExpansionKit.generated';
import {WorldMaterials} from '../src/world/materials';
import {buildWorld} from '../src/world/builder';
import {installCanvasShim} from './helpers/canvas2d';
import {fakeEnvTextures, loadStripped} from './helpers/openablesFixture';
import type {SignPlacement, StationLayout} from '../src/gen/stationTypes';

installCanvasShim(false);
const SEEDS = [1, 42, 777, 9100, 31337, 218558, 637474, 2026110, 5, 6, 7, 8, 11, 12];
const cache = new Map<number, StationLayout>();
const plateStats = {moved: 0, redundant: 0, dropped: 0, plates: 0, log: new Map<number, string[]>()};
const level = (seed: number) => {
  let L = cache.get(seed);
  if (!L) {
    L = LEVELS.reactor.generate('main', {levelSeed: seed});
    cache.set(seed, L);
    plateStats.moved += PLATE_CLEAR_STATS.moved; plateStats.redundant += PLATE_CLEAR_STATS.redundant; plateStats.dropped += PLATE_CLEAR_STATS.dropped; plateStats.plates += PLATE_CLEAR_STATS.plates; plateStats.log.set(seed, PLATE_CLEAR_STATS.log.slice());
  }
  return L;
};
const archOf = (L: StationLayout) => ReactorArch.for(L, {} as WorldMaterials, L.levels)!;
const coreIdx = (L: StationLayout) => L.levels.findIndex(l => l.id === CORE_LEVEL);

// =====================================================================================================================================
describe('(1) the core deck continues under the vessel (user: "the floor around the reactor does not go under the reactor")', () => {
  const plinthR = (REACTOR_MODELS.vessel.anchors!.plinthR as number);

  it('every seed: the plinth perimeter and the band beyond it are drawn deck at the deck height — no void (the cells alone left one)', () => {
    let before = 0, samples = 0;
    for (const seed of SEEDS) {
      const L = level(seed), cf = L.reactor!.coreFloor!, Li = coreIdx(L), g = L.levels[Li].grid, arch = archOf(L);
      const fills = arch.floorFills(Li);
      expect(fills.length, `seed ${seed}: fill runs`).toBeGreaterThan(10);
      const s = (2 * L.reactor!.core.radius) / (REACTOR_MODELS.vessel.anchors!.width as number), R0 = plinthR * s;
      const drawnCell = (x: number, z: number): boolean => {
        const [cx, cy] = g.cellOf(x, z), i = g.idx(cx, cy), k = arch.floorKey(Li, i);
        // (a tower standing close to the vessel: its reserved leg column is solid structure drawn by its faces, its foot's notch in the
        // goop is pool under the goop surface — neither is a void)
        if (g.cells[i] === SOLID || (g.cells[i] === FLOOR && Math.abs(g.floorOf(i) - cf.pool.floorY) < 1e-3)) return true;
        return g.cells[i] === FLOOR && !!k && k !== CORE_HIDDEN && k !== CORE_GOOP && Math.abs(g.floorOf(i) - cf.y) < 1e-3;
      };
      const inFill = (x: number, z: number) => fills.some(q => Math.abs(q.y - cf.y) < 1e-6 && x >= q.x0 - 1e-6 && x <= q.x1 + 1e-6 && z >= q.z0 - 1e-6 && z <= q.z1 + 1e-6);
      for (const r of [R0 - 0.02, R0 + 0.02, R0 + 0.1, R0 + 0.2, R0 + 0.3, R0 + 0.4, R0 + 0.5, R0 + 0.6, R0 + 0.8]) {
        for (let k = 0; k < 720; k++) {
          const a = (k / 720) * Math.PI * 2, x = cf.x + Math.cos(a) * r, z = cf.z + Math.sin(a) * r;
          samples++;
          if (!drawnCell(x, z)) before++;
          if (!drawnCell(x, z) && !inFill(x, z)) expect.fail(`seed ${seed}: no deck at r ${r.toFixed(2)} angle ${(a * 180 / Math.PI).toFixed(1)} (${x.toFixed(2)}, ${z.toFixed(2)})`);
        }
      }
    }
    // the fault was real: the cells' own floors left part of that band open
    expect(before / samples).toBeGreaterThan(0.05);
  }, 240_000);

  it('the fill is the ring\'s grating on the vessel\'s own cells only (never a pool / bridge / deck cell: no coplanar double floor), collision unchanged', () => {
    for (const seed of SEEDS) {
      const L = level(seed), cf = L.reactor!.coreFloor!, Li = coreIdx(L), g = L.levels[Li].grid, arch = archOf(L);
      let cells = 0;
      for (const q of arch.floorFills(Li)) {
        expect(q.key).toBe('reactor-grating');
        expect(q.y).toBe(cf.y);
        for (let z = q.z0 + CELL / 2; z < q.z1; z += CELL) for (let x = q.x0 + CELL / 2; x < q.x1; x += CELL) {
          const [cx, cy] = g.cellOf(x, z), i = g.idx(cx, cy);
          cells++;
          expect(arch.coreKinds[i], `seed ${seed}: fill on a non-vessel cell`).toBe(CORE_CELL.vessel);
          // its own floor stays the hidden raised column (never a second drawn floor at the deck height)
          expect(arch.floorKey(Li, i)).toBe(CORE_HIDDEN);
          expect(g.floorOf(i)).toBeGreaterThan(cf.y + 1.5);
          // the vessel is still a solid obstruction for a body on the deck
          expect(g.blocked[i]).toBe(1);
          expect(cellBlocks(g, cx, cy, x, z, cf.y)).toBe(true);
        }
      }
      // every vessel cell is filled (the deck runs on under the whole footprint), the pool / bridges untouched and still valid
      expect(cells).toBe([...arch.coreKinds].filter(k => k === CORE_CELL.vessel).length);
      expect(coreFloorIssues(L), `seed ${seed}`).toEqual([]);
      // (coreCellKinds classifies the pool within pool.r1 + 1.5 m; a far tower foot's goop cells lie beyond it and stay the builder's)
      const pool = [...arch.coreKinds].filter(k => k === CORE_CELL.pool).length;
      expect(pool).toBeGreaterThan(0.95 * cf.pool.cells);
      expect(pool).toBeLessThanOrEqual(cf.pool.cells);
      for (let i = 0; i < arch.coreKinds.length; i++) if (arch.coreKinds[i] === CORE_CELL.pool) expect(arch.floorKey(Li, i)).toBe(CORE_GOOP);
      // the vessel's footprint stays within the plinth band: cells with their centre <= vesselR
      for (let i = 0; i < arch.coreKinds.length; i++) {
        if (arch.coreKinds[i] !== CORE_CELL.vessel) continue;
        const cx = i % g.w, cy = (i - cx) / g.w;
        expect(Math.hypot((cx + 0.5) * CELL - cf.x, (cy + 0.5) * CELL - cf.z)).toBeLessThanOrEqual(CORE_FLOOR.vesselR + 1e-6);
      }
    }
  }, 240_000);

  it('the built world (seed 9100): the grating meshes\' triangles cover the plinth perimeter at the deck height, no new floor mesh', () => {
    const L = level(9100), cf = L.reactor!.coreFloor!;
    const w = buildWorld(L, new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17}), {});
    const tris: number[][] = [];
    const names = new Set<string>();
    w.group.traverse(o => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || (m as THREE.InstancedMesh).isInstancedMesh) return;
      names.add(m.name);
      if (m.name !== 'reactor-arch-grating') return;
      const p = m.geometry.getAttribute('position'), idx = m.geometry.getIndex();
      const n = idx ? idx.count : p.count;
      for (let t = 0; t + 2 < n; t += 3) {
        const v = [0, 1, 2].map(k => idx ? idx.getX(t + k) : t + k);
        if (v.some(q => Math.abs(p.getY(q) - cf.y) > 1e-3)) continue;
        tris.push(v.flatMap(q => [p.getX(q), p.getZ(q)]));
      }
    });
    expect(names.has('reactor-arch-grating')).toBe(true);
    expect([...names].some(n => /fill|under-vessel/.test(n))).toBe(false);
    const inTri = (x: number, z: number, t: number[]) => {
      const d = (ax: number, az: number, bx: number, bz: number) => (x - bx) * (az - bz) - (ax - bx) * (z - bz);
      const d1 = d(t[0], t[1], t[2], t[3]), d2 = d(t[2], t[3], t[4], t[5]), d3 = d(t[4], t[5], t[0], t[1]);
      return !((d1 < -1e-9 || d2 < -1e-9 || d3 < -1e-9) && (d1 > 1e-9 || d2 > 1e-9 || d3 > 1e-9));
    };
    const plinthR = REACTOR_MODELS.vessel.anchors!.plinthR as number;
    let miss = 0;
    for (const r of [plinthR - 0.02, plinthR + 0.15, plinthR + 0.35, plinthR + 0.55]) for (let k = 0; k < 360; k++) {
      const a = (k / 360) * Math.PI * 2, x = cf.x + Math.cos(a) * r, z = cf.z + Math.sin(a) * r;
      if (!tris.some(t => inTri(x, z, t))) miss++;
    }
    expect(miss).toBe(0);
    w.reactorArch?.dispose();
  }, 180_000);
});

// =====================================================================================================================================
describe('(4) the waste repository\'s decon shower booths: no coplanar z-fighting (user: "heavy z-fighting on the … wash stations")', () => {
  let gltf: GLTF;
  beforeAll(async () => { gltf = await loadStripped(REACTOR_X_KIT.deconShower.url); }, 60_000);
  const meshOf = (g: GLTF) => { let m: THREE.Mesh | null = null; g.scene.traverse(o => { if (!m && (o as THREE.Mesh).isMesh) m = o as THREE.Mesh; }); return m! as THREE.Mesh; };
  const seedWithBooths = () => SEEDS.map(level).find(L => (L.reactorWaste?.models.filter(m => m.piece === 'deconShower').length ?? 0) >= 2)!;

  it('the cause is in the delivered mesh: double-sided material, zero-thickness double sheets + stacked same-facing layers', () => {
    const m = meshOf(gltf), st = coplanarStats(m.geometry, 0.001);
    expect((m.material as THREE.Material).side).toBe(THREE.DoubleSide);
    expect(st.opposite).toBeGreaterThan(5);
    expect(st.same).toBeGreaterThan(1);
  }, 120_000);

  it('drawn single-sided (outward-wound closed shell), its hidden coplanar faces dropped, the delivered maps kept', () => {
    const L = seedWithBooths();
    expect(L, 'a seed with two booths').toBeTruthy();
    const src = meshOf(gltf);
    const g = new THREE.Group();
    buildWasteVisuals(g, L, new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17}), {[REACTOR_X_KIT.deconShower.key]: gltf});
    const booths = g.children.filter(o => o.name.startsWith('reactor-waste-model-deconShower')) as THREE.InstancedMesh[];
    expect(booths.reduce((s, b) => s + b.count, 0)).toBe(L.reactorWaste!.models.filter(m => m.piece === 'deconShower').length);
    for (const b of booths) {
      const mat = b.material as THREE.MeshStandardMaterial, srcMat = src.material as THREE.MeshStandardMaterial;
      expect(mat.side).toBe(THREE.FrontSide);
      expect(mat.map).toBe(srcMat.map);
      expect(mat.normalMap).toBe(srcMat.normalMap);
      // same-facing faces in one plane z-fight whatever the side: exact coincidences (<= 0.05 mm) gone, and within the room-distance
      // depth band (COPLANAR_BAND 0.3 mm) only a sliver of slightly tilted crossing faces is left
      const raw = {exact: coplanarStats(src.geometry, 0.00005), band: coplanarStats(src.geometry, COPLANAR_BAND)};
      const now = {exact: coplanarStats(b.geometry, 0.00005), band: coplanarStats(b.geometry, COPLANAR_BAND)};
      expect(raw.exact.same).toBeGreaterThan(1);
      expect(now.exact.same, `exact same-facing ${now.exact.same.toFixed(3)} m2`).toBeLessThan(0.01);
      expect(now.band.same, `same-facing within the band ${now.band.same.toFixed(3)} m2`).toBeLessThan(0.05 * raw.band.same);
      // the surface itself kept: what went were the hidden layers (each covered by a face in front)
      expect(now.band.area).toBeGreaterThan(0.9 * raw.band.area);
      // single-sided needs an outward-wound shell: positive signed volume
      const p = b.geometry.getAttribute('position');
      let V = 0;
      for (let i = 0; i + 2 < p.count; i += 3) {
        const a = new THREE.Vector3().fromBufferAttribute(p, i), c = new THREE.Vector3().fromBufferAttribute(p, i + 1), d = new THREE.Vector3().fromBufferAttribute(p, i + 2);
        V += a.dot(c.cross(d)) / 6;
      }
      expect(V).toBeGreaterThan(0.3);
    }
  }, 180_000);

  it('the procedural stand-in (model not loaded) has no two of its boxes sharing a face plane', () => {
    const L = seedWithBooths(), D = L.reactorWaste!;
    const g = new THREE.Group();
    buildWasteVisuals(g, L, new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17}), {});
    const boxes: THREE.Box3[] = [];
    const m = new THREE.Matrix4();
    for (const o of g.children) {
      const im = o as THREE.InstancedMesh;
      if (!/^reactor-waste-box-/.test(im.name)) continue;
      for (let i = 0; i < im.count; i++) { im.getMatrixAt(i, m); boxes.push(new THREE.Box3(new THREE.Vector3(-0.5, -0.5, -0.5), new THREE.Vector3(0.5, 0.5, 0.5)).applyMatrix4(m)); }
    }
    for (const md of D.models.filter(q => q.piece === 'deconShower')) {
      const r = Math.max(md.w, md.d) / 2 + 0.01;
      const mine = boxes.filter(b => b.min.x >= md.x - r && b.max.x <= md.x + r && b.min.z >= md.z - r && b.max.z <= md.z + r && b.min.y >= md.y - 0.01 && b.max.y <= md.y + md.h + 0.01);
      expect(mine.length).toBeGreaterThanOrEqual(7);
      for (let i = 0; i < mine.length; i++) for (let j = i + 1; j < mine.length; j++) {
        const A = mine[i], B = mine[j];
        for (const ax of ['x', 'y', 'z'] as const) {
          const o = (['x', 'y', 'z'] as const).filter(q => q !== ax);
          const span = (q: 'x' | 'y' | 'z') => Math.min(A.max[q], B.max[q]) - Math.max(A.min[q], B.min[q]);
          if (span(o[0]) <= 1e-4 || span(o[1]) <= 1e-4) continue;
          for (const fa of [A.min[ax], A.max[ax]]) for (const fb of [B.min[ax], B.max[ax]]) {
            const sameFacing = (fa === A.min[ax]) === (fb === B.min[ax]);
            if (Math.abs(fa - fb) < 1e-4 && sameFacing) expect.fail(`booth at ${md.x},${md.z}: two boxes share the ${ax} = ${fa.toFixed(3)} face plane`);
          }
        }
      }
    }
  }, 120_000);
});

// =====================================================================================================================================
describe('(5) the complexes\' plates never overlap (user: "some overlapping signs in the sub areas")', () => {
  /** Plate box (wall face -> 6 cm out: the rendered plate), independent of the clearance pass's own helpers. */
  const box = (s: SignPlacement) => {
    const {w, h} = signDims(s), c = Math.cos(s.rot), sn = Math.sin(s.rot);
    const nx = Math.abs(sn) > 0.5 ? Math.sign(sn) : 0, nz = Math.abs(c) > 0.5 ? Math.sign(c) : 0;
    const wx = s.x - nx * 0.02, wz = s.z - nz * 0.02; // the wall face
    const ax = nz ? w / 2 : 0, az = nx ? w / 2 : 0;
    return {x0: Math.min(wx - ax, wx - ax + nx * 0.08), x1: Math.max(wx + ax, wx + ax + nx * 0.08), z0: Math.min(wz - az, wz - az + nz * 0.08), z1: Math.max(wz + az, wz + az + nz * 0.08), y0: s.y - h / 2, y1: s.y + h / 2};
  };
  type B = {x0: number; x1: number; z0: number; z1: number; y0: number; y1: number};
  const cut = (a: B, b: B, e = 0.003) => a.x0 < b.x1 - e && b.x0 < a.x1 - e && a.z0 < b.z1 - e && b.z0 < a.z1 - e && a.y0 < b.y1 - e && b.y0 < a.y1 - e;

  it('>= 12 seeds: no two plates of a complex (its rooms + the deck at its entrance) overlap; none meets a prop, decor, waste piece or fixture', () => {
    const bad: string[] = [];
    let plates = 0;
    for (const seed of SEEDS) {
      const L = level(seed);
      for (const c of L.reactor!.complexes ?? []) {
        const mine = new Set([...c.areas, ...(c.slot ? [c.slot.frontArea] : [])]);
        const ps = L.signs.filter(s => (s.level ?? 0) === c.level && mine.has(s.area));
        plates += ps.length;
        for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) if (cut(box(ps[i]), box(ps[j]))) bad.push(`seed ${seed} ${c.id}: "${ps[i].text}" x "${ps[j].text}"`);
        const solids: {b: B; what: string}[] = [];
        for (const p of L.props) if ((p.level ?? 0) === c.level) solids.push({b: {x0: p.x - p.hx, x1: p.x + p.hx, z0: p.z - p.hz, z1: p.z + p.hz, y0: p.y, y1: p.y + p.h}, what: `prop ${p.kind}${p.purpose ? `(${p.purpose})` : ''}`});
        for (const d of L.decor) solids.push({b: {x0: Math.min(d.x0, d.x1), x1: Math.max(d.x0, d.x1), z0: Math.min(d.z0, d.z1), z1: Math.max(d.z0, d.z1), y0: d.y0, y1: d.y1}, what: `decor ${d.m}`});
        for (const l of L.lights) if (!l.virtual && (l.level ?? 0) === c.level) solids.push({b: {x0: l.x - 0.2, x1: l.x + 0.2, z0: l.z - 0.2, z1: l.z + 0.2, y0: l.y - 0.25, y1: l.y + 0.05}, what: 'light'});
        const W = L.reactorWaste;
        if (W && W.level === c.level) {
          for (const b of W.boxes) solids.push({b: {x0: Math.min(b.x0, b.x1), x1: Math.max(b.x0, b.x1), z0: Math.min(b.z0, b.z1), z1: Math.max(b.z0, b.z1), y0: Math.min(b.y0, b.y1), y1: Math.max(b.y0, b.y1)}, what: `waste ${b.m}`});
          for (const f of W.fans) solids.push({b: {x0: f.x - f.r - 0.3, x1: f.x + f.r + 0.3, z0: f.z - f.r - 0.3, z1: f.z + f.r + 0.3, y0: f.y - f.r, y1: f.y + f.r}, what: 'waste fan'});
        }
        for (const s of ps) for (const o of solids) if (cut(box(s), o.b)) bad.push(`seed ${seed} ${c.id}: "${s.text}" meets ${o.what}`);
      }
    }
    expect(bad.slice(0, 12), `${bad.length} overlaps`).toEqual([]);
    expect(plates).toBeGreaterThan(SEEDS.length * 3 * 8);
    // the pass really acted (the shipped placers stacked plates on every seed)
    expect(plateStats.moved + plateStats.redundant + plateStats.dropped).toBeGreaterThan(SEEDS.length);
    expect(plateStats.dropped, 'plates dropped for lack of room').toBeLessThan(0.08 * plateStats.plates);
  }, 600_000);

  it('every plate stays legible: wall-backed on its own area\'s wall, 1.5 m+ over the floor, under the ceiling; the key plates survive', () => {
    for (const seed of SEEDS) {
      const L = level(seed);
      for (const c of L.reactor!.complexes ?? []) {
        const g = L.levels[c.level].grid, mine = new Set([...c.areas, ...(c.slot ? [c.slot.frontArea] : [])]);
        const ps = L.signs.filter(s => (s.level ?? 0) === c.level && mine.has(s.area));
        for (const s of ps) {
          const a = L.areas[s.area], {w, h} = signDims(s), cs = Math.cos(s.rot), sn = Math.sin(s.rot);
          const side = Math.abs(cs) >= Math.abs(sn) ? (cs > 0 ? 'N' : 'S') : (sn > 0 ? 'W' : 'E');
          const t = side === 'N' || side === 'S' ? s.x : s.z;
          expect(wallBacked(g, a, side, t - w / 2, t + w / 2, s.y - h / 2), `seed ${seed} "${s.text}" backed`).toBe(true);
          expect(s.y - h / 2).toBeGreaterThan(L.levels[c.level].baseY + 1.5);
          expect(s.y + h / 2).toBeLessThanOrEqual(a.ceil + 1e-6);
        }
        const has = (re: RegExp) => ps.some(s => re.test(s.text));
        if (c.id === 'bunker') { expect(has(/SHELTER 7/), `seed ${seed} bunker entrance plate`).toBe(true); expect(has(/DECONTAMINATION/), `seed ${seed} bunker decon plate`).toBe(true); }
        if (c.id === 'mines') { expect(has(/ADIT/), `seed ${seed} adit plate`).toBe(true); expect(has(/GENERATOR/), `seed ${seed} mines generator plate`).toBe(true); }
        if (c.id === 'waste') { expect(has(/AUX GENERATOR 3/), `seed ${seed} waste generator plate`).toBe(true); expect(ps.length).toBeGreaterThanOrEqual(8); }
      }
      // the pass never loses the way to a generator / the complex names: such a plate is moved (or merged into a twin), not dropped
      const lost = (plateStats.log.get(seed) ?? []).filter(l => /^dropped "/.test(l) && /GENERATOR|ADIT|SHELTER|AIRLOCK|DECONTAMINATION|PLANT|STOPE/.test(l));
      expect(lost, `seed ${seed}`).toEqual([]);
    }
  }, 600_000);
});
