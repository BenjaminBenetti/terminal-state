// Task studio-food-shelf-production-20261109-002816-01 (lane SHELF): opt-in CPU review pictures (no WebGL, no browser) of dressed
// shelf units with the REAL ruined-prop atlas (its base-colour map decoded here: Node's GLTFLoader has no image decoder) — a grocery
// stock shelf, a storage-closet shelf (with its top-of-unit boxes) and an office-storage shelf, at a normal viewing distance:
//   SHELF_PICTURES=<out dir> ./node_modules/.bin/vitest run --config game/vitest.config.ts --maxWorkers=1 --no-file-parallelism game/tests/shelf-junk-pictures.preview.test.ts
// Approximate lighting (helpers/meshPreview.ts: flashlight + ambient, albedo x vertex colour): identity / placement review (textured,
// upright, on the deck, not intersecting), not the game's look. Pictures are QA evidence: never committed.
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import * as THREE from 'three';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {ShimCanvas} from './helpers/canvas2d';
import {installStockCanvas, loadModel, stockProp} from './helpers/stockHelpers';
import {renderMeshes, type PreviewCam} from './helpers/meshPreview';
import {MODEL_FILES} from '../src/assets/manifest';
import {SHELF_JUNK_ATLAS} from '../src/assets/foodShelfModels.generated';
import {SHELF_JUNK_KEY} from '../src/world/shelfJunkModels';
import {ShelfStock} from '../src/world/shelfStock';
import {stockMaterial} from '../src/world/shelfStockGeometry';
import {STOCK_ARCHES} from '../src/world/shelfStockCatalog';
import {PROP_DEFS} from '../src/gen/props';
import {FLOOR, Grid, SOLID} from '../src/gen/grid';

const GAME = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.env.SHELF_PICTURES;
let uninstall: () => void = () => {};
beforeAll(async () => { if (OUT) uninstall = await installStockCanvas(true); });
afterAll(() => uninstall());

/** The base-colour map of a GLB's first material, decoded to a canvas-shim texture. */
async function baseColour(url: string): Promise<THREE.Texture> {
  const sharp = (await import('sharp')).default;
  const {NodeIO} = await import('@gltf-transform/core');
  const doc = await new NodeIO().read(path.join(GAME, 'public', url));
  const img = doc.getRoot().listMaterials()[0].getBaseColorTexture()!.getImage()!;
  const {data, info} = await sharp(Buffer.from(img)).ensureAlpha().raw().toBuffer({resolveWithObject: true});
  // glTF UVs run v down from the image top (three: flipY = false); helpers/meshPreview.ts samples flipY, so the rows go in reversed
  const c = new ShimCanvas(true); c.width = info.width; c.height = info.height;
  const row = info.width * 4;
  for (let y = 0; y < info.height; y++) c.data.set(data.subarray((info.height - 1 - y) * row, (info.height - y) * row), y * row);
  return new THREE.Texture(c as unknown as HTMLImageElement);
}

/** The game's fit of a model to a prop footprint (world/builder.ts addInstancedModel: non-uniform, bottom-anchored). */
function fitted(gltf: GLTF, p: {x: number; y: number; z: number; rot: number}, w: number, h: number, d: number, mat: THREE.Material): THREE.Group {
  const root = gltf.scene.clone(true);
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root), size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
  const inner = new THREE.Group();
  inner.add(root);
  root.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) m.material = mat; });
  root.position.set(-c.x, -box.min.y, -c.z);
  inner.scale.set(w / size.x, h / size.y, d / size.z);
  const g = new THREE.Group();
  g.add(inner);
  g.position.set(p.x, p.y, p.z);
  g.rotation.y = p.rot;
  return g;
}

describe.runIf(!!OUT)('shelf junk review pictures (SHELF_PICTURES=<dir>)', () => {
  it('renders a grocery, a storage-closet and an office-storage shelf unit with the real atlas', async () => {
    const sharp = (await import('sharp')).default;
    fs.mkdirSync(OUT!, {recursive: true});
    const shelf = await loadModel('shelf.glb'), techDisplay = await loadModel('tech-display.glb');
    const atlas = await loadModel('shelf-junk-atlas.glb');
    const shelfMap = await baseColour(MODEL_FILES.shelf.url), atlasMap = await baseColour(SHELF_JUNK_ATLAS.url);
    const shelfMat = new THREE.MeshStandardMaterial({map: shelfMap, side: THREE.DoubleSide});
    const junkMat = new THREE.MeshStandardMaterial({map: atlasMap, side: THREE.DoubleSide});
    const fillerMat = new THREE.MeshStandardMaterial({map: stockMaterial().map, vertexColors: true});
    const wallMat = new THREE.MeshStandardMaterial({color: 0x6e6a62}), floorMat = new THREE.MeshStandardMaterial({color: 0x4a4844});
    const report: string[] = [];
    const scenes: {name: string; kind: 'stockShelf' | 'shelf'; variant: number; purpose: string; seeds: number[]}[] = [
      {name: 'shelf-grocery', kind: 'stockShelf', variant: 1, purpose: 'grocery', seeds: [11, 12, 13, 14, 15, 16]},
      {name: 'shelf-storage-closet', kind: 'shelf', variant: 0, purpose: 'janitor-closet', seeds: [21, 22, 23, 24, 25, 26]},
      {name: 'shelf-office-storage', kind: 'shelf', variant: 0, purpose: 'office-storage', seeds: [31, 32, 33, 34, 35, 36]},
    ];
    for (const sc of scenes) {
      // a 2.6 m room (the storage unit's top-of-unit boxes need the headroom) with the unit against its back wall
      const g = new Grid(24, 24);
      for (let y = 0; y < 24; y++) for (let x = 0; x < 24; x++) { const i = y * 24 + x; g.set(x, y, x < 2 || y < 2 || x >= 22 || y >= 22 ? SOLID : FLOOR); g.ceil[i] = 2.6; }
      const sh = stockProp(sc.kind, 6, 3, {variant: sc.variant});
      // the fullest of a few holder seeds (the review shows the dressing at its intended density)
      let best: ShelfStock | null = null;
      for (const seed of sc.seeds) {
        const S = new ShelfStock();
        S.build({props: [sh], areas: [{purpose: sc.purpose}], seed, grid: g} as never, {models: {shelf, techDisplay, [SHELF_JUNK_KEY]: atlas}});
        if (!best || S.stats().junk.modelPieces > best.stats().junk.modelPieces) best = S;
      }
      const S = best!;
      const st = S.stats();
      expect(st.junk.modelPieces).toBeGreaterThan(3);
      const group = new THREE.Group();
      const def = PROP_DEFS[sc.kind];
      group.add(fitted(shelf, sh, def.w, def.h, def.d, shelfMat));
      if (sc.kind === 'stockShelf') { const b = new THREE.Mesh(new THREE.BoxGeometry(def.w - 0.09, def.h - 0.04 - 0.02, 0.0034), wallMat); b.position.set(sh.x, (def.h - 0.06) / 2 + 0.02, sh.z - def.d / 2 - 0.0025); group.add(b); }
      const wall = new THREE.Mesh(new THREE.PlaneGeometry(6, 2.6), wallMat); wall.position.set(sh.x, 1.3, sh.z - def.d / 2 - 0.06); group.add(wall);
      const floor = new THREE.Mesh(new THREE.PlaneGeometry(6, 6), floorMat); floor.rotation.x = -Math.PI / 2; floor.position.set(sh.x, 0, sh.z + 2); group.add(floor);
      S.group.traverse(o => { const m = o as THREE.Mesh; if (!m.isMesh || (m as THREE.InstancedMesh).isInstancedMesh) return; const c = m.clone(); c.material = m.name.startsWith('shelf-junk-') ? junkMat : fillerMat; group.add(c); });
      const views: [string, PreviewCam][] = [
        ['front', {pos: [sh.x + 0.25, 1.6, sh.z + 2.2], target: [sh.x, 1.05, sh.z], fov: 60}],
        ['angle', {pos: [sh.x + 1.35, 1.55, sh.z + 1.5], target: [sh.x, 1.0, sh.z], fov: 60}],
      ];
      for (const [v, cam] of views) {
        const px = renderMeshes(group, {far: 30, ...cam}, {width: 960, height: 720, flashlight: true, ambient: 0.55, fog: 0.01, mips: {aniso: 4}});
        await sharp(px, {raw: {width: 960, height: 720, channels: 3}}).png().toFile(path.join(OUT!, `${sc.name}-${v}.png`));
      }
      const by: Record<string, number> = {};
      for (const p of S.filler.pieces) { const i = S.pieceInfo(p.id); const k = i.model ? `${i.model}:${i.arch}` : i.arch; by[k] = (by[k] ?? 0) + 1; }
      report.push(`${sc.name}: ${st.pieces} pieces (${st.junk.modelPieces} modelled), unitTop ${JSON.stringify(S.holders[0]?.unitTop ?? null)}; ${Object.entries(by).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} x${n}`).join(', ')}`);
      // top-of-unit boxes: their tops under the 2.6 m ceiling less the headroom
      for (const p of S.holders[0].placements) if (STOCK_ARCHES[p.arch].id === 'junk_shipping_box') report.push(`  shipping box top at ${(sh.y + p.c[1] + STOCK_ARCHES[p.arch].h / 2).toFixed(3)} m`);
    }
    fs.writeFileSync(path.join(OUT!, 'shelf-pictures.txt'), report.join('\n') + '\n');
  }, 600000);
});
