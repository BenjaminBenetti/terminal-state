// Task studio-survivor-market-crevice-20261116-074419 (lane VIEW): THE CREVICE's view (Survivor Market layout version 5) — every shipping
// container framed (closed ones too), every visible end a cargo-door end, the cooked bridge kit spanning each deck within its stretch
// limits with the deck surface at the bridge's floor, lines / laundry never through a deck and never lower than 2.3 m over a walk, awnings
// along the E / W fronts never under a bridge, fans only inside covered rooms; nothing for a version 1-4 market (its view unchanged);
// the kit fetched only by a version-5 market with bridges; the teardown disposes everything the view created and nothing it borrowed.
import {beforeAll, describe, expect, it} from 'vitest';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import * as THREE from 'three';
import {GLTFLoader, type GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {installCanvasShim} from './helpers/canvas2d';
import {CELL, SOLID} from '../src/gen/grid';
import type {StationLayout} from '../src/gen/stationTypes';
import {generateMarketLevel} from '../src/gen/market/index';
import {marketAwnings, marketFans} from '../src/gen/market/art';
import {settleLines} from '../src/gen/market/v2/art';
import {CREV_ART, bridgeBays, crevBandAt, crevLineY, creviceAwnings, creviceBridgePieces, creviceContainerArt, creviceFans, creviceLaundryFloor, creviceLines} from '../src/gen/market/v5/art';
import {MARKET_BRIDGE_KIT} from '../src/assets/marketBridgeKit.generated';
import {levelOfAsset} from '../src/assets/levelAssets';
import {MARKET_BRIDGE_KEY, MARKET_BRIDGE_MODEL_FILES, buildCreviceView, marketBridgeModelKeys} from '../src/world/marketCrevice';
import {MarketVisuals, buildMarketView} from '../src/world/marketVisuals';
import {LAUNDRY_GARMENTS, garmentDims, garmentMesh, planLaundry, staticGarment, type GarmentDims} from '../src/world/marketClothes';
import {MARKET_HUMAN_KEY, MARKET_HUMAN_MODEL_FILES} from '../src/market/humanLooks';

installCanvasShim(false);
const PUB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');
async function loadStripped(rel: string): Promise<GLTF> {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.read(path.join(PUB, rel));
  for (const t of doc.getRoot().listTextures()) t.dispose(); // (node has no image decoder)
  const bin = await io.writeBinary(doc);
  return new Promise<GLTF>((res, rej) => new GLTFLoader().parse(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength) as ArrayBuffer, '', res, rej));
}

const SEEDS = [7, 42];
const layouts = new Map<number, StationLayout>();
const L5 = (seed: number) => { let x = layouts.get(seed); if (!x) layouts.set(seed, (x = generateMarketLevel({levelSeed: seed, layoutVersion: 5}))); return x; };
let kit: GLTF;
beforeAll(async () => { kit = await loadStripped(MARKET_BRIDGE_KIT.url); });

/** Every vertex position of the view's merged painted geometry. */
function paintVerts(group: THREE.Object3D): number[][] {
  const out: number[][] = [];
  group.traverse(o => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.name.startsWith('market-crevice-paint')) return;
    const p = m.geometry.getAttribute('position');
    for (let i = 0; i < p.count; i++) out.push([p.getX(i), p.getY(i), p.getZ(i)]);
  });
  return out;
}
const near = (a: number, b: number, e = 2e-3) => Math.abs(a - b) < e;

describe('crevice view: the shipping containers', () => {
  it('every container gets its frame (corner posts up to the box top at both ends, closed boxes too); deterministic', () => {
    for (const seed of SEEDS) {
      const L = L5(seed), C = L.market!.crevice!.containers;
      const v = buildCreviceView(L)!;
      expect(v.frames, `seed ${seed}`).toBe(C.length);
      expect(v.art.length).toBe(C.length);
      expect(C.some(c => c.area < 0)).toBe(true); // (closed boxes exist and are framed like the rest)
      const verts = paintVerts(v.group);
      for (const c of v.art) {
        // the corner posts' outer face (proud of the front plane) reaching the box top, at both ends of the box
        const u = c.front + c.out * CREV_ART.frame.postProud;
        for (const e of c.ends) {
          const hit = verts.some(([x, y, z]) => {
            const n = c.axis === 'z' ? x : z, s = c.axis === 'z' ? z : x;
            return near(n, u) && near(y, c.top) && Math.abs(s - e.at) < CREV_ART.frame.post + CREV_ART.frame.gap + 0.01;
          });
          expect(hit, `seed ${seed} container ${c.index} end ${e.at}`).toBe(true);
        }
      }
      expect(creviceContainerArt(L)).toEqual(v.art);
    }
  });

  it('every visible end (open space before it, no neighbour, no rock) gets the cargo-door end with four locking bars', () => {
    for (const seed of SEEDS) {
      const L = L5(seed), v = buildCreviceView(L)!, verts = paintVerts(v.group);
      let visible = 0;
      for (const c of v.art) for (const e of c.ends) {
        if (e.shared) expect(e.visible, `seed ${seed} container ${c.index}: a shared end is never visible`).toBe(false);
        if (!e.visible) continue;
        visible++;
        const g = L.levels[c.level].grid, s = e.at + e.out * CELL / 2;
        let open = 0;
        for (let n = Math.min(c.front, c.back) + 0.1; n < Math.max(c.front, c.back); n += 0.2) {
          const [cx, cy] = c.axis === 'z' ? g.cellOf(n, s) : g.cellOf(s, n);
          if (g.get(cx, cy) !== SOLID) open++;
        }
        expect(open, `seed ${seed} container ${c.index}: open before its visible end`).toBeGreaterThan(0);
        // the four bars' front faces: two edges each across the end, at the bars' proud plane, within the box's height
        const sb = e.at + e.out * CREV_ART.cargo.barProud, ns = new Set<number>();
        for (const [x, y, z] of verts) {
          const vn = c.axis === 'z' ? x : z, vs = c.axis === 'z' ? z : x;
          if (near(vs, sb) && y > c.y + 0.1 && y < c.top - 0.1 && vn > Math.min(c.front, c.back) && vn < Math.max(c.front, c.back)) ns.add(Math.round(vn * 1000));
        }
        expect(ns.size, `seed ${seed} container ${c.index} end ${e.at}: bar edges`).toBe(8);
      }
      expect(v.doorEnds).toBe(visible);
      expect(visible, `seed ${seed}`).toBeGreaterThan(0);
    }
  });

  it('windows / doors stay on the front between the posts, clear of the openings; all four window kinds occur', () => {
    const L = L5(7), art = creviceContainerArt(L);
    expect(art.reduce((a, c) => a + c.windows.length, 0)).toBeGreaterThan(10);
    expect(new Set(art.flatMap(c => c.windows.map(w => w.kind)))).toEqual(new Set(['dark', 'lit', 'mesh', 'boarded']));
    for (const c of art) {
      for (const w of c.windows) {
        expect(w.s0).toBeGreaterThanOrEqual(c.s0 + CREV_ART.window.margin - 1e-3);
        expect(w.s1).toBeLessThanOrEqual(c.s1 - CREV_ART.window.margin + 1e-3);
        expect(w.y1).toBeLessThan(c.top - CREV_ART.frame.rail);
        for (const o of c.doors) expect(w.s1 <= o.s0 - CREV_ART.door.architrave || w.s0 >= o.s1 + CREV_ART.door.architrave, `container ${c.index}`).toBe(true);
      }
      for (const d of c.doors) expect(d.canopy && d.awning).toBe(false);
    }
  });
});

describe('crevice view: the bridges', () => {
  it('the kit spans every deck exactly: Ends unstretched, bays within the stretch limits, the deck surface at the bridge floor', () => {
    const {min, max} = MARKET_BRIDGE_KIT.stretch, E = MARKET_BRIDGE_KIT.pieces.End.length;
    for (const seed of SEEDS) {
      const L = L5(seed), cr = L.market!.crevice!, pieces = creviceBridgePieces(L, MARKET_BRIDGE_KIT);
      expect(cr.bridges.length).toBeGreaterThan(0);
      cr.bridges.forEach((b, bi) => {
        const mine = pieces.filter(p => p.bridge === bi && p.piece !== 'Trestle').sort((p, q) => p.x0 - q.x0);
        expect(bridgeBays(b.x1 - b.x0 - 2 * E, MARKET_BRIDGE_KIT.pieces.Mid.length, MARKET_BRIDGE_KIT.stretch), `seed ${seed} bridge ${bi}`).not.toBeNull();
        expect(mine[0].piece).toBe('End');
        expect(mine[mine.length - 1].piece).toBe('End');
        expect(mine.filter(p => p.piece === 'End').length).toBe(2);
        expect([mine[0].yaw, mine[mine.length - 1].yaw]).toEqual([0, Math.PI]);
        expect(mine[0].x0).toBeCloseTo(b.x0, 3);
        expect(mine[mine.length - 1].x1).toBeCloseTo(b.x1, 3);
        for (let i = 1; i < mine.length; i++) expect(mine[i].x0).toBeCloseTo(mine[i - 1].x1, 2);
        for (const p of mine) {
          expect(p.y).toBeCloseTo(b.y - MARKET_BRIDGE_KIT.deckY, 3);
          expect(p.z).toBeCloseTo((b.z0 + b.z1) / 2, 3);
          if (p.piece === 'End') expect(p.sx).toBe(1);
          else {
            expect(p.sx).toBeGreaterThanOrEqual(min - 1e-6);
            expect(p.sx).toBeLessThanOrEqual(max + 1e-6);
          }
          // the cabled bay only wholly over the chasm (its festoon hangs into the depth, never over a walk)
          if (p.piece === 'Mid') { expect(p.x0).toBeGreaterThanOrEqual(cr.chasm.x0 - 1e-3); expect(p.x1).toBeLessThanOrEqual(cr.chasm.x1 + 1e-3); }
        }
        expect(mine.some(p => p.piece === 'Mid'), `seed ${seed} bridge ${bi}`).toBe(true);
      });
      // a trestle only on solid ground that is no walkway
      for (const t of pieces.filter(p => p.piece === 'Trestle')) {
        const feet = t.y - MARKET_BRIDGE_KIT.pieces.Trestle.height, b = crevBandAt(L, t.x, feet + 0.05, t.z);
        expect(b !== null && !b.walk && Math.abs(b.floor - feet) < 0.1).toBe(true);
      }
    }
  });

  it('the loaded kit is instanced per piece mesh PER BRIDGE (shared geometry / material; the bridge\'s own bounds and storey)', () => {
    const L = L5(7), cr = L.market!.crevice!, v = buildCreviceView(L, {bridgeKit: kit})!;
    expect(v.kit).toBe('model');
    const ims: THREE.InstancedMesh[] = [];
    v.group.traverse(o => { if ((o as THREE.InstancedMesh).isInstancedMesh) ims.push(o as THREE.InstancedMesh); });
    expect(ims.length).toBeGreaterThanOrEqual(3 * cr.bridges.length);
    const owned = new Set<unknown>();
    kit.scene.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) { owned.add(m.geometry); owned.add(m.material); } });
    const m = new THREE.Matrix4(), box = new THREE.Box3(), c = new THREE.Vector3();
    let instances = 0;
    const perBridge = new Map<number, number>();
    for (const im of ims) {
      expect(owned.has(im.geometry)).toBe(true);
      expect(owned.has(im.material)).toBe(true);
      expect(v.geometries).not.toContain(im.geometry);
      expect(v.materials).not.toContain(im.material);
      expect(im.boundingSphere).not.toBeNull();
      if (!im.geometry.boundingBox) im.geometry.computeBoundingBox();
      const mine = new Set<number>();
      for (let i = 0; i < im.count; i++, instances++) {
        im.getMatrixAt(i, m);
        box.copy(im.geometry.boundingBox!).applyMatrix4(m);
        box.getCenter(c);
        const bi = cr.bridges.findIndex(q => Math.abs(c.z - (q.z0 + q.z1) / 2) < 0.1 && box.min.x >= q.x0 - 0.05 && box.max.x <= q.x1 + 0.05 && box.max.y > q.y + 0.5 && box.max.y < q.y + 1.2);
        expect(bi, `${im.name} #${i}`).toBeGreaterThanOrEqual(0);
        mine.add(bi);
        // its bounds hold every instance (frustum culling never drops a visible piece)
        for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) expect(im.boundingSphere!.center.distanceTo(c.set(x, y, z))).toBeLessThanOrEqual(im.boundingSphere!.radius + 1e-3);
      }
      // one bridge per mesh: its bounds that bridge's (never the whole crevice), its storey the deck's
      expect(mine.size, im.name).toBe(1);
      const b = cr.bridges[[...mine][0]];
      expect(im.userData.level).toBe(b.level);
      expect(im.boundingSphere!.radius).toBeLessThan(Math.hypot(b.x1 - b.x0, b.z1 - b.z0, 2.5) / 2 + 1.5);
      perBridge.set([...mine][0], (perBridge.get([...mine][0]) ?? 0) + im.count);
    }
    expect(instances).toBe(v.pieces.length);
    cr.bridges.forEach((_, bi) => expect(perBridge.get(bi)).toBe(v.pieces.filter(p => p.bridge === bi).length));
    // without the kit (a failed fetch): the same placements as stand-in pieces, so a deck is never invisible
    const s = buildCreviceView(L)!;
    expect(s.kit).toBe('standin');
    expect(s.pieces).toEqual(v.pieces);
  });
});

describe('crevice view: lines, laundry, awnings, fans', () => {
  const dims: GarmentDims[] = [
    {id: 'flannel@m1', min: [-0.3, 0.7, -0.12], max: [0.3, 1.45, 0.12], hang: [0, 1.38, 0], pegs: [-0.17, 0.17]},
    {id: 'jeans@f1', min: [-0.22, -0.05, -0.1], max: [0.22, 1.0, 0.1], hang: [0, 0.99, 0], pegs: [-0.18, 0.18]},
  ];
  const overBridge = (L: StationLayout, x: number, z: number) => L.market!.crevice!.bridges.some(q => x > q.x0 && x < q.x1 && z > q.z0 - 0.3 && z < q.z1 + 0.3);

  it('no line passes through a deck, a slab or the rock; every point >= 2.3 m over any walk; its laundry the same, none at a bridge', () => {
    for (const seed of SEEDS) {
      const L = L5(seed), lines = creviceLines(L);
      expect(lines.length, `seed ${seed}`).toBeGreaterThanOrEqual(4);
      expect(lines.some(l => l.laundry)).toBe(true);
      for (const l of lines) {
        const run = Math.hypot(l.x1 - l.x0, l.z1 - l.z0);
        for (let t = 0; t <= 1; t += 0.1 / run) {
          const x = l.x0 + (l.x1 - l.x0) * t, z = l.z0 + (l.z1 - l.z0) * t, y = crevLineY(l, t);
          const b = crevBandAt(L, x, y, z);
          expect(b, `seed ${seed} line ${l.seed} at ${t.toFixed(2)}`).not.toBeNull();
          expect(y).toBeLessThan(b!.ceil);
          if (b!.walk) expect(y - b!.floor).toBeGreaterThanOrEqual(CREV_ART.line.clear - 1e-6);
          expect(overBridge(L, x, z), `seed ${seed} line ${l.seed}`).toBe(false);
        }
      }
      const plan = planLaundry(L, lines, dims, creviceLaundryFloor(L));
      expect(plan.length, `seed ${seed}`).toBeGreaterThan(0);
      for (const g of plan) {
        const l = lines[g.line], run = Math.hypot(l.x1 - l.x0, l.z1 - l.z0), ux = (l.x1 - l.x0) / run, uz = (l.z1 - l.z0) / run;
        expect(l.laundry && l.y1 === undefined).toBe(true); // (level lines only)
        const d = dims.find(q => q.id === g.garment)!, half = (d.max[2] - d.min[2]) / 2;
        for (let s = g.s0; s <= g.s1 + 1e-9; s += (g.s1 - g.s0) / 4) for (const b of [-half, 0, half]) {
          const x = l.x0 + ux * s - uz * b, z = l.z0 + uz * s + ux * b;
          const band = crevBandAt(L, x, g.bottom + 0.01, z);
          expect(band, `seed ${seed} garment at ${x.toFixed(2)}, ${z.toFixed(2)}`).not.toBeNull();
          if (band!.walk) expect(g.bottom - band!.floor, `seed ${seed} garment over a walk`).toBeGreaterThanOrEqual(CREV_ART.line.clear - 1e-6);
          expect(overBridge(L, x, z)).toBe(false);
        }
      }
    }
  });

  it('the garments stay within the market budget (versions 2-4: <= 18): every line thinned alike, a subset of the full plan', async () => {
    const cast = await loadStripped(MARKET_HUMAN_MODEL_FILES[MARKET_HUMAN_KEY].url);
    const real = LAUNDRY_GARMENTS.map(g => garmentDims(g, staticGarment(garmentMesh(cast, g)!)));
    for (const seed of [...SEEDS, 1, 11, 4242]) {
      const L = L5(seed), lines = creviceLines(L), floor = creviceLaundryFloor(L);
      expect(lines.filter(l => l.laundry).length).toBeLessThanOrEqual(CREV_ART.line.laundry[1]);
      const full = planLaundry(L, lines, real, floor), capped = planLaundry(L, lines, real, floor, CREV_ART.line.garments);
      expect(capped.length, `seed ${seed}`).toBe(Math.min(full.length, CREV_ART.line.garments));
      expect(capped.length, `seed ${seed}`).toBeGreaterThanOrEqual(8);
      for (const g of capped) expect(full).toContainEqual(g);
      expect(planLaundry(L, lines, real, floor, CREV_ART.line.garments)).toEqual(capped);
      // (the view hangs exactly the capped plan)
      const v = buildMarketView(L, {garments: cast})!;
      expect(v.laundry!.plan).toEqual(capped);
      for (const g of v.geometries) g.dispose();
    }
  }, 60_000);

  it('awnings along the E / W fronts (axis z), low edge >= 2.4 m, never under a bridge; fans only inside covered rooms', () => {
    const A = CREV_ART.awning;
    for (const seed of SEEDS) {
      const L = L5(seed), art = creviceContainerArt(L), aw = creviceAwnings(L, art);
      expect(aw.length).toBeGreaterThan(0);
      expect(aw.some(a => a.axis === 'z')).toBe(true);
      for (const a of aw) {
        const c = art.find(q => Math.abs(q.front + q.out * (CREV_ART.rib.proud + 0.004) - a.z) < 1e-3 && Math.abs(q.y + A.wall - a.yWall) < 1e-3 && a.x0 < q.s1 && a.x1 > q.s0)!;
        expect(c, `awning at ${a.z}`).toBeDefined();
        expect(a.axis).toBe(c.axis === 'z' ? 'z' : undefined);
        expect(a.dir).toBe(c.out);
        expect(a.yEdge - c.y).toBeGreaterThanOrEqual(2.4 - 1e-6);
        const g = L.levels[c.level].grid;
        for (let s = a.x0 + 0.1; s < a.x1; s += 0.4) for (const u of [0.15, a.depth - 0.1]) {
          const n = a.z + c.out * u, [x, z] = c.axis === 'z' ? [n, s] : [s, n];
          expect(g.ceilAt(x, z)).toBeGreaterThan(a.yWall);
          // (never under a bridge's deck: one two storeys up may overhang the walk, its lowest part >= 1 m over the awning)
          for (const b of L.market!.crevice!.bridges) if (b.y > c.y && x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1) expect(b.y - MARKET_BRIDGE_KIT.cableDrop - a.yWall, `seed ${seed} awning under a bridge`).toBeGreaterThan(1);
        }
      }
      const fans = creviceFans(L);
      expect(fans.length).toBeGreaterThan(0);
      for (const f of fans) {
        const g = L.levels[f.level!].grid, [cx, cy] = g.cellOf(f.x, f.z), id = g.area[g.idx(cx, cy)], a = L.areas.find(q => q.id === id)!;
        expect(a.kind).toBe('room');
        const base = L.market!.crevice!.bases[f.level!];
        expect(g.ceilAt(f.x, f.z) - base).toBeLessThan(4); // (a covered room: never the open crevice)
        expect(f.y - base).toBeGreaterThan(2.1); // (the blades over every head)
      }
    }
  });
});

describe('crevice view: scope, loading, lifecycle', () => {
  it('nothing for a version 1-4 market (its own fans / awnings / lines as before); the kit only for a version-5 market with bridges', () => {
    const L4 = generateMarketLevel({levelSeed: 7, layoutVersion: 4});
    expect(buildCreviceView(L4)).toBeNull();
    expect(creviceContainerArt(L4)).toEqual([]);
    expect(creviceBridgePieces(L4, MARKET_BRIDGE_KIT)).toEqual([]);
    expect(marketBridgeModelKeys(L4)).toEqual([]);
    const v = buildMarketView(L4, {bridgeKit: kit})!;
    expect(v.crevice).toBeNull();
    expect(v.root.getObjectByName('market-crevice')).toBeUndefined();
    expect([v.fans, v.awnings, v.lines]).toEqual([marketFans(L4), marketAwnings(L4).length, settleLines(L4).length]);
    expect(v.materials.map(m => m.name)).toEqual(['market-fan-steel', 'market-awning']);
    expect(marketBridgeModelKeys({})).toEqual([]);
    expect(marketBridgeModelKeys(L5(7))).toEqual([MARKET_BRIDGE_KEY]);
    expect(MARKET_BRIDGE_MODEL_FILES[MARKET_BRIDGE_KEY]).toEqual({url: MARKET_BRIDGE_KIT.url, bytes: MARKET_BRIDGE_KIT.bytes});
    expect(levelOfAsset(MARKET_BRIDGE_KIT.url)).toBe('market');
  });

  it('bounded: a handful of materials, few draw calls (merged per material per chunk), static bounds for culling', () => {
    const L = L5(7), v = buildCreviceView(L, {bridgeKit: kit})!, bridges = L.market!.crevice!.bridges.length;
    expect(v.materials.length).toBeLessThanOrEqual(4);
    expect(v.draws).toBeLessThanOrEqual(4 * bridges + 12);
    const p = new THREE.Vector3();
    v.group.traverse(o => {
      const m = o as THREE.InstancedMesh;
      if (!m.isMesh) return;
      expect(m.isInstancedMesh ? m.boundingSphere : m.geometry.boundingSphere, m.name).not.toBeNull();
      expect(m.castShadow || m.receiveShadow).toBe(false);
      if (m.isInstancedMesh) return;
      // a merged chunk: its sphere holds every vertex; bounded size; tagged with the storeys of its containers
      const pos = m.geometry.getAttribute('position'), s = m.geometry.boundingSphere!;
      for (let i = 0; i < pos.count; i++) expect(s.center.distanceTo(p.fromBufferAttribute(pos, i))).toBeLessThanOrEqual(s.radius + 1e-3);
      expect(pos.count / 3).toBeLessThan(40000);
      const lv: number[] = m.userData.levels ?? [m.userData.level];
      expect(lv.every(l => typeof l === 'number' && l >= 0 && l < L.levels.length)).toBe(true);
    });
    const kitTris = v.pieces.reduce((a, p) => a + MARKET_BRIDGE_KIT.pieces[p.piece].tris, 0), own = v.triangles - kitTris;
    expect(own).toBeGreaterThan(5000);
    expect(own).toBeLessThan(60000); // (the containers' handmade parts; the kit's pieces are the cooked model's own)
  });

  it('the section runtime builds the view and its teardown disposes everything it created, never the borrowed kit', () => {
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x000000, 0.05);
    let models: Map<string, GLTF> = new Map([[MARKET_BRIDGE_KEY, kit]]);
    const host = {scene, sectionHooks: [] as {build?(l: StationLayout): void; teardown?(): void}[], frameHooks: [] as ((dt: number) => void)[], propModels: {get: (k: string) => models.get(k)}};
    const mv = new MarketVisuals(host).install();
    const kitOwned = new Set<unknown>();
    kit.scene.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) { kitOwned.add(m.geometry); kitOwned.add(m.material); } });
    for (const withKit of [true, false]) {
      if (!withKit) models = new Map();
      host.sectionHooks[0].build!(L5(7));
      const view = mv.view!;
      expect(view.crevice!.kit).toBe(withKit ? 'model' : 'standin');
      expect(scene.getObjectByName('market-crevice')).toBeDefined();
      const made = new Set<THREE.EventDispatcher<{dispose: object}>>(), disposed = new Set<unknown>();
      view.root.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) { made.add(m.geometry); for (const x of [m.material].flat()) made.add(x); } });
      for (const t of view.crevice!.textures) made.add(t);
      for (const x of made) x.addEventListener('dispose', () => disposed.add(x));
      host.sectionHooks[0].teardown!();
      expect(mv.view).toBeNull();
      expect(scene.getObjectByName('market-crevice')).toBeUndefined();
      for (const x of made) expect(disposed.has(x), (x as {name?: string}).name).toBe(!kitOwned.has(x));
    }
    // another level afterwards (no market): nothing built
    host.sectionHooks[0].build!({...L5(7), market: undefined});
    expect(mv.view).toBeNull();
  });
});
