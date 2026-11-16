// Task studio-survivor-market-crevice-20261116-074419 (lane ARCH): the architecture LOOK of the Survivor Market's layout version 5 (THE
// CREVICE, gen/market/v5/) — world/marketArch.ts CreviceArch: every container front carries its shape record's paint up its storey band
// (y .. y + the storey pitch) with the crevice's concrete above (the top storey's fronts run on up to the crevice's top); floors /
// ceilings by area (none on / under a bridge deck: the bridge model draws it), the chasm's bed instead of the track's ballast (the track
// bed keeps its ballast); impact classes of the new keys; the Reactor's three texture sets the only new asset rule; the culler's atrium
// (the open crevice columns, not the platform hall's vault); versions 1-4 untouched.
import {describe, expect, it} from 'vitest';
import * as THREE from 'three';
import {installCanvasShim} from './helpers/canvas2d';
import {fakeEnvTextures} from './helpers/openablesFixture';
import {WorldMaterials} from '../src/world/materials';
import {buildWorld, type BuiltWorld} from '../src/world/builder';
import {generateCrevice} from '../src/gen/market/v5/index';
import {generateMarketLevel} from '../src/gen/market/index';
import {CREVICE_FINISHES, CREVICE_KEYS, MARKET_KEYS, isCreviceKey, marketPaintKey} from '../src/world/marketArch';
import {CREVICE_TEXTURES, MarketTextureRuntime, creviceTexture, setCreviceTexture, setMarketTexture, usesCreviceTextures} from '../src/world/marketTextures';
import {MARKET_TEXTURES} from '../src/assets/marketTextures.generated';
import {finishClass} from '../src/damage/impactFinish';
import {isArchFinish} from '../src/world/finishAt';
import {assetAllowedIn, levelOfAsset} from '../src/assets/levelAssets';
import {REACTOR_KIT} from '../src/assets/reactorKit.generated';
import {CELL, FLOOR, SOLID, VOID} from '../src/gen/grid';
import {stationLevels} from '../src/world/levelGeometry';
import type {StationLayout} from '../src/gen/stationTypes';
import type {WallFace} from '../src/world/wallFaces';

installCanvasShim(false);

const SEEDS = [7, 42];
const built = new Map<number, {L: StationLayout; w: BuiltWorld; mats: WorldMaterials}>();
function world(seed: number) {
  let b = built.get(seed);
  if (!b) {
    const L = generateCrevice({levelSeed: seed});
    const mats = new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17});
    built.set(seed, (b = {L, w: buildWorld(L, mats, {}), mats}));
  }
  return b;
}

/** The finish of the wall face on the line through (x, z) facing (nx, nz) that covers height y there (null: no face). */
function finishAt(faces: readonly WallFace[], x: number, z: number, nx: number, nz: number, y: number): string | null {
  for (const f of faces) {
    if (f.nx !== nx || f.nz !== nz) continue;
    const alongX = Math.abs(f.z0 - f.z1) < 1e-9;
    if (alongX ? Math.abs(f.z0 - z) > 1e-4 || x < f.x0 || x > f.x1 : Math.abs(f.x0 - x) > 1e-4 || z < f.z0 || z > f.z1) continue;
    const len = alongX ? f.x1 - f.x0 : f.z1 - f.z0, t = len > 0 ? ((alongX ? x - f.x0 : z - f.z0) / len) : 0;
    const lo = f.slope ? f.slope.b0 + (f.slope.b1 - f.slope.b0) * t : f.y0, hi = f.slope ? f.slope.t0 + (f.slope.t1 - f.slope.t0) * t : f.y1;
    if (y >= lo && y <= hi) return f.finish;
  }
  return null;
}

/** A container box's front: the wall line, the outward normal and the span along it. */
function front(c: {x0: number; z0: number; x1: number; z1: number; face: 'N' | 'E' | 'S' | 'W'}) {
  switch (c.face) {
    case 'N': return {nx: 0, nz: -1, at: (s: number) => [s, c.z0] as const, s0: c.x0, s1: c.x1};
    case 'S': return {nx: 0, nz: 1, at: (s: number) => [s, c.z1] as const, s0: c.x0, s1: c.x1};
    case 'W': return {nx: -1, nz: 0, at: (s: number) => [c.x0, s] as const, s0: c.z0, s1: c.z1};
    default: return {nx: 1, nz: 0, at: (s: number) => [c.x1, s] as const, s0: c.z0, s1: c.z1};
  }
}

/** Every triangle of the world's meshes: centroid, face normal y, material. */
function triangles(group: THREE.Object3D): {c: THREE.Vector3; ny: number; m: THREE.Material}[] {
  const out: {c: THREE.Vector3; ny: number; m: THREE.Material}[] = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), d = new THREE.Vector3(), n = new THREE.Vector3(), e = new THREE.Vector3();
  group.updateMatrixWorld(true);
  group.traverse(o => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || (mesh as unknown as THREE.InstancedMesh).isInstancedMesh) return;
    const p = mesh.geometry.getAttribute('position'), idx = mesh.geometry.index;
    if (!p) return;
    const mat = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.Material;
    const count = idx ? idx.count : p.count;
    for (let k = 0; k + 2 < count; k += 3) {
      const [i0, i1, i2] = idx ? [idx.getX(k), idx.getX(k + 1), idx.getX(k + 2)] : [k, k + 1, k + 2];
      a.fromBufferAttribute(p, i0).applyMatrix4(mesh.matrixWorld);
      b.fromBufferAttribute(p, i1).applyMatrix4(mesh.matrixWorld);
      d.fromBufferAttribute(p, i2).applyMatrix4(mesh.matrixWorld);
      n.subVectors(b, a).cross(e.subVectors(d, a));
      const len = n.length();
      if (len < 1e-9) continue;
      out.push({c: a.clone().add(b).add(d).multiplyScalar(1 / 3), ny: n.y / len, m: mat});
    }
  });
  return out;
}

describe('the Survivor Market crevice architecture (layout version 5)', () => {
  it('container fronts carry their record\'s paint up their storey band; the crevice concrete above the top storey\'s boxes', () => {
    for (const seed of SEEDS) {
      const {L, w} = world(seed);
      const rec = L.market!.crevice!, pitch = rec.bases[1] - rec.bases[0];
      expect(w.marketArch?.v5).toBe(true);
      let checked = 0, fronts = 0;
      const top = rec.bases.length - 1;
      let topChecked = 0;
      for (const c of rec.containers) {
        const fr = front(c);
        let seen = false;
        // inside the box's run along the front (a shared end wall goes to the first box), clear of the box's corners
        for (let s = fr.s0 + 0.6; s <= fr.s1 - 0.6; s += 0.5) {
          const [x, z] = fr.at(s);
          for (const y of [c.y + 0.3, c.y + pitch / 2, c.y + pitch - 0.15]) {
            const k = finishAt(w.wallFaces, x, z, fr.nx, fr.nz, y);
            if (k === null) continue; // no open band in front there (an end-to-end neighbour, a stair's closed side)
            expect(k, `seed ${seed} box ${JSON.stringify(c)} s ${s} y ${y}`).toBe(marketPaintKey(c.paint));
            checked++; seen = true;
          }
          if (c.level === top) {
            // the top storey's front runs on up the rock: concrete from the box's roof line to the crevice's top
            for (const y of [c.y + pitch + 0.15, c.y + pitch + 2, rec.topY - 0.3]) {
              const k = finishAt(w.wallFaces, x, z, fr.nx, fr.nz, y);
              if (k === null) continue;
              expect(k, `seed ${seed} above top box ${JSON.stringify(c)} y ${y}`).toBe(CREVICE_KEYS.wall);
              topChecked++;
            }
          }
        }
        if (seen) fronts++;
      }
      // (most boxes face a walk; a few stand end-on behind a stair / another box)
      expect(fronts, `seed ${seed}`).toBeGreaterThanOrEqual(Math.floor(rec.containers.length * 0.75));
      expect(checked).toBeGreaterThan(200);
      expect(topChecked).toBeGreaterThan(20);
      // several paints, plywood interiors, the crevice's concrete and rock-cut rooms all in use
      const used = new Set(w.wallFaces.map(f => f.finish));
      expect(new Set(rec.containers.map(c => marketPaintKey(c.paint)).filter(k => used.has(k))).size).toBeGreaterThanOrEqual(4);
      for (const k of [MARKET_KEYS.ply, CREVICE_KEYS.wall, CREVICE_KEYS.cut]) expect(used, k).toContain(k);
      // every face of the crevice is an arch-owned key (no station wall treatment, no unmapped builder key above the track bed)
      for (const f of w.wallFaces) if (f.y1 > 0.5) expect(isArchFinish(f.finish), `${f.finish} y ${f.y0}-${f.y1}`).toBe(true);
    }
  });

  it('no floor on a bridge deck\'s cells and no ceiling under it; steel stair feet, corrugated terraces, concrete walks', () => {
    for (const seed of SEEDS) {
      const {L, w} = world(seed);
      const rec = L.market!.crevice!, arch = w.marketArch!, deck = arch.crevice!.deck;
      const tris = triangles(w.group);
      expect(rec.bridges.length).toBeGreaterThan(0);
      for (const b of rec.bridges) {
        const g = L.levels[b.level].grid;
        let cells = 0;
        for (let cz = Math.floor(b.z0 / CELL); cz < Math.ceil(b.z1 / CELL); cz++) for (let cx = Math.floor(b.x0 / CELL); cx < Math.ceil(b.x1 / CELL); cx++) {
          const i = cz * g.w + cx;
          if (g.cells[i] !== FLOOR) continue;
          cells++;
          expect(arch.hidesFloor(b.level, i), `seed ${seed} bridge cell ${cx},${cz}`).toBe(true);
        }
        expect(cells).toBeGreaterThan(0);
        const inside = (p: THREE.Vector3) => p.x > b.x0 + 0.3 && p.x < b.x1 - 0.3 && p.z > b.z0 + 0.3 && p.z < b.z1 - 0.3;
        expect(tris.filter(t => inside(t.c) && t.ny > 0.9 && Math.abs(t.c.y - b.y) < 0.05).map(t => t.m.name), `seed ${seed} floor on bridge ${JSON.stringify(b)}`).toEqual([]);
        expect(tris.filter(t => inside(t.c) && t.ny < -0.9 && Math.abs(t.c.y - (b.y - deck)) < 0.05).map(t => t.m.name), `seed ${seed} ceiling under bridge ${JSON.stringify(b)}`).toEqual([]);
      }
      // floors by area (each storey's first plain cell of the kind)
      const first = (lv: number, pred: (a: StationLayout['areas'][number]) => boolean) => {
        const g = L.levels[lv].grid;
        for (let i = 0; i < g.cells.length; i++) if (g.cells[i] === FLOOR && g.area[i] >= 0 && g.rampIdx[i] < 0 && pred(L.areas[g.area[i]])) return i;
        return -1;
      };
      const sq = first(0, a => a.label === 'Arrival Square'), walk = first(2, a => a.role === 'catwalk'), foot = first(0, a => a.label === 'Stair foot');
      expect(sq).toBeGreaterThanOrEqual(0);
      expect(arch.floorKey(0, sq)).toBe(CREVICE_KEYS.floor);
      expect(arch.floorKey(2, walk)).toBe(MARKET_KEYS.roof);
      if (foot >= 0) expect(arch.floorKey(0, foot)).toBe(CREVICE_KEYS.steel);
      // the platform keeps the station's slab (the builder's own rule)
      const sp = L.grid.idx(...L.grid.cellOf(L.playerSpawn.x, L.playerSpawn.z));
      expect(arch.floorKey(0, sp)).toBeNull();
      // a container's room floor: plywood deck inside its box
      const shop = rec.containers.find(c => c.area >= 0)!;
      const gi = L.levels[shop.level].grid.idx(...L.levels[shop.level].grid.cellOf((shop.x0 + shop.x1) / 2, (shop.z0 + shop.z1) / 2));
      expect(arch.floorKey(shop.level, gi)).toBe(MARKET_KEYS.deck);
      // the crevice's top: dark rock over the open bands
      const used = new Set(tris.map(t => t.m.name));
      for (const k of [CREVICE_KEYS.top, CREVICE_KEYS.vault, CREVICE_KEYS.floor, CREVICE_KEYS.chasm, CREVICE_KEYS.steel, MARKET_KEYS.roof, MARKET_KEYS.deck]) expect(used, `seed ${seed} ${k}`).toContain(k);
    }
  });

  it('the chasm\'s bed is not ballast; the track bed keeps its ballast', () => {
    for (const seed of SEEDS) {
      const {L, w, mats} = world(seed);
      const rec = L.market!.crevice!, arch = w.marketArch!, g = L.grid;
      const ch = rec.chasm;
      let chasm = 0, trench = 0;
      for (let i = 0; i < g.cells.length; i++) {
        if (g.cells[i] !== VOID) continue;
        const cx = i % g.w, x = (cx + 0.5) * CELL, z = ((i - cx) / g.w + 0.5) * CELL;
        const inC = x >= ch.x0 && x < ch.x1 && z >= ch.z0 && z < ch.z1;
        if (inC) { expect(arch.voidFloorKey(0, i)).toBe(CREVICE_KEYS.chasm); chasm++; } else { expect(arch.voidFloorKey(0, i)).toBeNull(); trench++; }
      }
      expect(chasm).toBeGreaterThan(100);
      expect(trench).toBeGreaterThan(100);
      const ballast = mats.get('ballast'), tris = triangles(w.group);
      const inChasm = (p: THREE.Vector3) => p.x > ch.x0 + 0.05 && p.x < ch.x1 - 0.05 && p.z > ch.z0 + 0.05 && p.z < ch.z1 - 0.05;
      const bed = tris.filter(t => t.ny > 0.9 && inChasm(t.c) && Math.abs(t.c.y - rec.chasmY) < 0.05);
      expect(bed.length).toBeGreaterThan(0);
      for (const t of bed) expect(t.m.name).toBe(CREVICE_KEYS.chasm);
      expect(tris.some(t => t.m === ballast && inChasm(t.c))).toBe(false);
      expect(tris.some(t => t.m === ballast && t.ny > 0.9 && !inChasm(t.c))).toBe(true);
    }
  });

  it('one material per key; impact classes of the new keys; the stairs steel; door soffits', () => {
    const {L, w} = world(SEEDS[0]);
    const byName = new Map<string, Set<THREE.Material>>();
    w.group.traverse(o => {
      const m = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (!(o as THREE.Mesh).isMesh || !m || Array.isArray(m) || !isCreviceKey(m.name)) return;
      if (!byName.has(m.name)) byName.set(m.name, new Set());
      byName.get(m.name)!.add(m);
    });
    expect(byName.size).toBeGreaterThanOrEqual(6);
    for (const [k, s] of byName) expect(s.size, k).toBe(1);
    for (const k of Object.values(CREVICE_KEYS)) {
      expect(isArchFinish(k), k).toBe(true);
      expect(finishClass(k), k).toBe(k === CREVICE_KEYS.steel ? 'steel' : 'concrete');
      expect(CREVICE_FINISHES[k].slot, k).toMatch(/^(concrete|rock|steel)$/);
    }
    const arch = w.marketArch!;
    expect(arch.stairKey('terrazzo')).toBe(CREVICE_KEYS.steel);
    expect(arch.stairKey('concrete')).toBe(CREVICE_KEYS.steel);
    expect(arch.stairKey('safetyEdge')).toBeNull();
    expect(arch.doorTrimKey()).toBe(MARKET_KEYS.trim);
    const room = L.areas[L.market!.crevice!.containers.find(c => c.area >= 0)!.area];
    expect(arch.doorCeilKey(0, room, undefined)).toBe(MARKET_KEYS.roof);
    expect(arch.doorCeilKey(0, L.areas[L.platform], undefined)).toBe(CREVICE_KEYS.wall);
    expect(usesCreviceTextures(L)).toBe(true);
  });

  it('assets: exactly the Reactor\'s pit-concrete / mine-rock / rusted-steel texture files may load in the market (still the Reactor family)', () => {
    const urls = Object.values(CREVICE_TEXTURES).flatMap(t => [t.color, t.normal, t.orm]);
    expect(urls).toHaveLength(9);
    for (const u of urls) {
      expect(levelOfAsset(u), u).toBe('reactor');
      expect(assetAllowedIn('market', u), u).toBe(true);
      expect(assetAllowedIn('reactor', u), u).toBe(true);
      expect(assetAllowedIn('bunker', u), u).toBe(true);
      expect(assetAllowedIn('subway', u), u).toBe(false);
    }
    expect(assetAllowedIn('market', 'assets/textures/reactor/grating-color.jpg')).toBe(false);
    expect(assetAllowedIn('market', REACTOR_KIT.generator.url)).toBe(false);
  });

  it('the texture runtime: a version-5 layout also loads the nine crevice maps (colour sRGB, data linear); versions 1-4 load exactly as before', async () => {
    const asked: {url: string; srgb: boolean}[] = [];
    const host = {levelResources: {load: (level: string, url: string, spec: {srgb: boolean}) => {
      expect(level).toBe('market');
      expect(assetAllowedIn(level, url), url).toBe(true);
      asked.push({url, srgb: spec.srgb});
      return Promise.resolve(new THREE.Texture());
    }}};
    const rt = new MarketTextureRuntime(host);
    await rt.preload(generateMarketLevel({levelSeed: 7, layoutVersion: 4}));
    const old = asked.map(a => a.url).sort();
    expect(old).toEqual(Object.values(MARKET_TEXTURES).map(t => t.url).sort());
    for (const s of ['concrete', 'rock', 'steel'] as const) expect(creviceTexture(s, 'color')).toBeNull();
    asked.length = 0;
    await rt.preload(world(SEEDS[0]).L);
    const crev = Object.values(CREVICE_TEXTURES).flatMap(t => [t.color, t.normal, t.orm]);
    expect(asked.map(a => a.url).sort()).toEqual([...old, ...crev].sort());
    for (const a of asked) if (crev.includes(a.url)) expect(a.srgb, a.url).toBe(a.url.endsWith('-color.jpg'));
    for (const s of ['concrete', 'rock', 'steel'] as const) for (const m of ['color', 'normal', 'orm'] as const) expect(creviceTexture(s, m)).not.toBeNull();
    // (leave the module's texture slots empty again: the other tests' worlds use the stand-ins)
    for (const s of ['concrete', 'rock', 'steel'] as const) for (const m of ['color', 'normal', 'orm'] as const) setCreviceTexture(s, m, null);
    for (const k of Object.keys(MARKET_TEXTURES) as (keyof typeof MARKET_TEXTURES)[]) setMarketTexture(k, null);
  });

  it('the culler\'s atrium: the open crevice columns (to the crevice\'s top, two storeys or more), not the platform hall\'s vault', () => {
    for (const seed of SEEDS) {
      const {L, w} = world(seed);
      const rec = L.market!.crevice!, atr = w.marketArch!.atrium, levels = stationLevels(L), g = L.grid;
      const plat = L.areas[L.platform];
      let n = 0;
      for (let i = 0; i < atr.length; i++) {
        if (!atr[i]) continue;
        n++;
        // an atrium column holds an open band running up to the crevice's top
        expect(levels.some(lv => (lv.grid.cells[i] === FLOOR || lv.grid.cells[i] === VOID) && lv.grid.ceil[i] >= rec.topY - 0.05), `cell ${i}`).toBe(true);
      }
      // the platform hall (its area, the track bed beside it) stays out; the chasm and the square are in
      for (let y = plat.y; y < plat.y + plat.h; y++) for (let x = plat.x; x < plat.x + plat.w; x++) expect(atr[y * g.w + x]).toBe(0);
      const ch = rec.chasm, ci = g.idx(...g.cellOf((ch.x0 + ch.x1) / 2, (ch.z0 + ch.z1) / 2 + 0.3));
      expect(atr[ci]).toBe(1);
      const sq = L.areas.find(a => a.label === 'Arrival Square')!;
      expect(atr[(sq.y + (sq.h >> 1)) * g.w + sq.x + (sq.w >> 1)]).toBe(1);
      // bounded: a few thousand columns, ~150 tiles
      expect(n).toBeGreaterThan(2000);
      expect(w.culler.atriumTileCount).toBeGreaterThan(60);
      expect(w.culler.atriumTileCount).toBeLessThan(260);
    }
  });
});

describe('versions 1-4 keep their architecture (the version-5 hooks are inert)', () => {
  it.each([[2, 77], [3, 11], [4, 7]] as const)('layout version %i (seed %i)', (v, seed) => {
    const L = generateMarketLevel({levelSeed: seed, layoutVersion: v});
    const mats = new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17});
    const w = buildWorld(L, mats, {});
    const arch = w.marketArch!, levels = stationLevels(L);
    expect(arch.crevice).toBeNull();
    expect(arch.v5).toBe(false);
    expect(arch.v2).toBe(true);
    expect(usesCreviceTextures(L)).toBe(false);
    for (let lv = 0; lv < levels.length; lv++) {
      const g = levels[lv].grid;
      for (let i = 0; i < g.cells.length; i++) {
        if (g.cells[i] === SOLID) continue;
        expect(arch.hidesFloor(lv, i)).toBe(false);
        if (g.cells[i] === VOID) { expect(arch.voidFloorKey(lv, i)).toBeNull(); expect(arch.voidCeilKey(lv, i, g.ceil[i])).toBeNull(); }
        if (g.area[i] >= 0 && i % 7 === 0) expect(arch.ceilKey(lv, g.area[i], i, g.ceil[i])).toBe(arch.ceilKey(lv, g.area[i]));
      }
    }
    for (const k of ['terrazzo', 'concrete', 'ceiling']) expect(arch.stairKey(k)).toBeNull();
    // no crevice key anywhere; the old atrium rule (a non-solid column roofed above the housing deck's walking zone)
    w.group.traverse(o => { const m = (o as THREE.Mesh).material as THREE.Material | undefined; if ((o as THREE.Mesh).isMesh && m && !Array.isArray(m)) expect(isCreviceKey(m.name)).toBe(false); });
    for (const f of w.wallFaces) expect(isCreviceKey(f.finish)).toBe(false);
    const top = levels[1].baseY + 2.4, g = L.grid;
    for (let i = 0; i < g.cells.length; i++) expect(arch.atrium[i]).toBe(g.cells[i] !== SOLID && g.hasCeil(i) && g.ceil[i] >= top ? 1 : 0);
  });
});
