// Iteration 04 (Lane C): every procedural surface is textured + the ceiling-fixture derivative is
// a clean low-poly bake. Canvas drawing runs on a node shim (tests/helpers/canvas2d.ts).
// TEXTURE_PREVIEW=1 additionally rasterizes every texture set into qa-artifacts/assets/textures-iteration04/.
import {describe, expect, it} from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import * as THREE from 'three';
import {NodeIO} from '@gltf-transform/core';
import {installCanvasShim, ShimCanvas} from './helpers/canvas2d';
import {renderProps, type RenderBox} from './helpers/propRender';
import {ACCENT_COLORS, SHAPE_MAT_KEYS, propShape, type ShapeMat} from '../src/gen/propShapes';
import {PROP_DEFS, type PropKind} from '../src/gen/props';
import {MODEL_FILES, TEXTURE_FILES, type TextureKey} from '../src/assets/manifest';
import {WM_HOOK, WM_ROUGH_HOOK, WorldMaterials, isWorldMapped, type MatKey} from '../src/world/materials';
import {nodeHookKeys} from '../src/render/nodeHooks';
import {compileNodeMaterial} from './helpers/nodeCompile';
import {SHAPE_MAT_UV, shapeMaterial, shapeMaterials} from '../src/world/shapeMaterials';
import {SURFACE_NAMES, fareScreenTexture, menuBoardTexture, resetSurfaceCache, surface, vendFrontTexture, MENUS} from '../src/world/canvasTextures';

// No-op canvas for structural checks (materials are created lazily, so keep it installed).
installCanvasShim(false);

const GAME = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = path.resolve(GAME, '..');

function fakeEnvTextures(): Record<TextureKey, THREE.Texture> {
  const out = {} as Record<TextureKey, THREE.Texture>;
  for (const k of Object.keys(TEXTURE_FILES) as TextureKey[]) out[k] = new THREE.Texture({width: 64, height: 64} as unknown as HTMLImageElement);
  return out;
}

/** Storefront keys promised to Lane B in lane-contracts.md. */
const CONTRACT_KEYS = ['steelDark', 'steelBright', 'accent', 'counter', 'panel', 'glass', 'screen', 'vendFront', 'grille', 'black', 'porcelain', 'partition', 'concrete', 'shutter', 'mirror',
  'shopFrame', 'signBand', 'menuBoard', 'shutterSteel', 'kitchenSteel', 'laminate', 'tileShop', 'quarryTile', 'woodVeneer', 'plasticSeat', 'glassShopfront'];

describe('procedural surfaces are textured (iteration 04)', () => {
  const mats = new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17});

  it('every shape key (incl. the storefront contract) maps to one shared material with a texture map', () => {
    for (const k of CONTRACT_KEYS) expect(SHAPE_MAT_KEYS as readonly string[]).toContain(k);
    const record = shapeMaterials(mats);
    for (const k of SHAPE_MAT_KEYS) {
      const m = shapeMaterial(mats, k) as THREE.MeshStandardMaterial;
      expect(m.isMeshStandardMaterial, k).toBe(true);
      expect(m.map, k).toBeInstanceOf(THREE.Texture);
      expect(record[k], k).toBe(m);
      expect(shapeMaterial(mats, k), k).toBe(m); // cached, never per instance
      // Iteration 13 (MAT-A): node materials (WebGPURenderer); world mapping = TSL context + 'world-mapped' hooks.
      expect((m as unknown as {isNodeMaterial?: boolean}).isNodeMaterial, k).toBe(true);
      if (SHAPE_MAT_UV[k] === 'world') {
        expect(m.userData.worldMapping?.span?.length, k).toBe(2);
        expect(isWorldMapped(m), k).toBe(true);
      } else {
        expect(m.emissiveMap, k).toBe(m.map);
        expect(isWorldMapped(m), k).toBe(false);
      }
    }
    // Aliases share one material; unknown future keys still render with a related one.
    expect(shapeMaterial(mats, 'shutterSteel')).toBe(shapeMaterial(mats, 'shutter'));
    expect(shapeMaterial(mats, 'shopGlassDoor')).toBe(shapeMaterial(mats, 'glassShopfront'));
    expect(shapeMaterial(mats, 'mysteryThing')).toBe(shapeMaterial(mats, 'panel'));
  });

  it('every key used by a procedural prop shape is a known textured key', () => {
    for (const kind of Object.keys(PROP_DEFS) as PropKind[]) for (const p of propShape(kind) ?? []) {
      expect(SHAPE_MAT_KEYS as readonly string[], `${kind}:${p.m}`).toContain(p.m);
      expect((shapeMaterial(mats, p.m) as THREE.MeshStandardMaterial).map, `${kind}:${p.m}`).toBeTruthy();
    }
  });

  it('trim, columns and track (WorldMaterials) are textured; trim is world-mapped', () => {
    const textured: MatKey[] = ['tileLower', 'tileUpper', 'paint', 'terrazzo', 'concrete', 'platformSlab', 'safetyEdge', 'platformFace', 'ceiling', 'ceilingService', 'tunnel', 'ballast', 'steel', 'rail', 'sleeper', 'coverboard', 'crate', 'bin', 'gate'];
    for (const k of textured) expect((mats.get(k) as THREE.MeshStandardMaterial).map, k).toBeTruthy();
    for (const k of ['steel', 'rail', 'sleeper', 'coverboard'] as MatKey[]) {
      const m = mats.get(k) as THREE.MeshStandardMaterial;
      expect(m.userData.worldMapping, k).toBeTruthy();
      expect(m.roughnessMap, k).toBeTruthy();
      expect(m.normalMap, k).toBeTruthy();
    }
  });

  // Iteration 13 (MAT-A): the iteration-04 GLSL hook is TSL now; this checks the GENERATED shader (three r186 GLSLNodeBuilder,
  // the WebGL2-backend code path of WebGPURenderer; tests/surface-nodes.test.ts covers the maths).
  it('world mapping: per-vertex world projection after instancing feeds every map; one program for all world-mapped keys', () => {
    const m = shapeMaterial(mats, 'steelDark') as THREE.MeshStandardMaterial;
    expect(nodeHookKeys(m as never)).toEqual([WM_HOOK, WM_ROUGH_HOOK]);
    const sh = compileNodeMaterial(new THREE.InstancedMesh(new THREE.BoxGeometry(), m, 2), [new THREE.PointLight()]);
    const v = sh.vertex.slice(sh.vertex.indexOf('void main'));
    // The instance matrix is applied before the projection is chosen (instance-scaled columns keep their texel scale).
    expect(v.indexOf('gl_InstanceID')).toBeGreaterThan(0);
    expect(v.indexOf('vWm = ')).toBeGreaterThan(v.indexOf('gl_InstanceID'));
    // Colour, roughness and normal maps all sample at the world coordinate (through each texture's transform).
    expect(sh.fragmentMain.match(/vec3\( vWm\.xy, 1\.0 \)/g)?.length).toBe(3);
    expect(sh.fragmentMain).toContain('dFdx( vWm.xy )'); // tangent frame from the world coordinate
    expect(sh.fragmentMain).toContain('wmFloor = ');
    expect(sh.fragmentMain).toContain('wmNoise(');
    // Same node graph (per-material values are material properties) -> same program key and identical code.
    const k = shapeMaterial(mats, 'kitchenSteel') as THREE.Material;
    expect(m.customProgramCacheKey()).toBe(k.customProgramCacheKey());
    const sk = compileNodeMaterial(new THREE.InstancedMesh(new THREE.BoxGeometry(), k, 2), [new THREE.PointLight()]);
    const norm = (code: string) => code.replace(/(NodeBuffer_|buffer)\d+/g, '$1N'); // per-object instance-matrix buffer names
    expect(norm(sk.fragment)).toBe(norm(sh.fragment));
    expect(norm(sk.vertex)).toBe(norm(sh.vertex));
  });

  it('texture sets are power-of-two, mipmapped and shared', () => {
    {
      for (const n of SURFACE_NAMES) {
        const s = surface(n);
        expect(surface(n)).toBe(s);
        for (const t of [s.map, s.roughnessMap, s.normalMap]) {
          if (!t) continue;
          const img = t.image as {width: number; height: number};
          expect(Math.log2(img.width) % 1, n).toBe(0);
          expect(Math.log2(img.height) % 1, n).toBe(0);
          expect(Math.max(img.width, img.height), n).toBeLessThanOrEqual(512);
          expect(t.generateMipmaps, n).toBe(true);
          expect(t.wrapS, n).toBe(THREE.RepeatWrapping);
        }
        expect(s.map.colorSpace, n).toBe(THREE.SRGBColorSpace);
        if (s.normalMap) expect(s.normalMap.colorSpace, n).toBe(THREE.NoColorSpace);
      }
    }
  });
});

describe('ceiling light fixture derivative (iteration 04)', () => {
  const url = MODEL_FILES.light.url;
  const file = path.join(GAME, 'public', url);

  it('manifest uses the re-baked LOD with provenance', () => {
    expect(url).toBe('assets/models/light-lod2.glb');
    const prov = JSON.parse(fs.readFileSync(path.join(GAME, 'public/assets/derivatives/light-lod-iteration04.json'), 'utf8'));
    expect(prov.output.sha256).toBe(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'));
    for (const old of ['light.glb', 'light-lod.glb']) expect(fs.existsSync(path.join(GAME, 'public/assets/models', old)), old).toBe(true);
  });

  it('stays within budget with an intact, non-overlapping UV atlas and the original fit', async () => {
    const doc = await new NodeIO().read(file);
    const prims = doc.getRoot().listMeshes().flatMap(m => m.listPrimitives());
    expect(prims.length).toBe(1);
    const prim = prims[0];
    const P = prim.getAttribute('POSITION')!.getArray()!, UV = prim.getAttribute('TEXCOORD_0')!.getArray()!, I = prim.getIndices()!.getArray()!;
    const tris = I.length / 3;
    expect(tris).toBeLessThanOrEqual(1000);
    let uvMin = Infinity, uvMax = -Infinity, uvArea = 0;
    const ratio: number[] = [];
    for (let f = 0; f < tris; f++) {
      const a = I[3 * f], b = I[3 * f + 1], c = I[3 * f + 2];
      for (const v of [a, b, c]) for (const k of [0, 1]) { uvMin = Math.min(uvMin, UV[2 * v + k]); uvMax = Math.max(uvMax, UV[2 * v + k]); }
      const ux = P[3 * b] - P[3 * a], uy = P[3 * b + 1] - P[3 * a + 1], uz = P[3 * b + 2] - P[3 * a + 2], vx = P[3 * c] - P[3 * a], vy = P[3 * c + 1] - P[3 * a + 1], vz = P[3 * c + 2] - P[3 * a + 2];
      const a3 = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
      const auv = Math.abs((UV[2 * b] - UV[2 * a]) * (UV[2 * c + 1] - UV[2 * a + 1]) - (UV[2 * c] - UV[2 * a]) * (UV[2 * b + 1] - UV[2 * a + 1])) / 2;
      uvArea += auv;
      if (a3 > 1e-9) ratio.push(auv / a3);
    }
    expect(uvMin).toBeGreaterThanOrEqual(0);
    expect(uvMax).toBeLessThanOrEqual(1);
    // A sloppy LOD over a baked atlas (iteration 03) had UV area 32x the atlas: triangles spanning unrelated charts.
    expect(uvArea).toBeLessThanOrEqual(1);
    const med = [...ratio].sort((x, y) => x - y)[ratio.length >> 1];
    expect(ratio.filter(r => r > 8 * med).length).toBeLessThanOrEqual(Math.ceil(tris / 300));
    const bb = prim.getAttribute('POSITION')!;
    const mn = bb.getMin([]), mx = bb.getMax([]);
    expect(mx[0] - mn[0]).toBeCloseTo(1.2, 3);
    expect(mx[1]).toBeCloseTo(0, 4); // top-centre anchor: hangs below y = 0
    expect(mx[1] - mn[1]).toBeGreaterThan(0.17);
    expect(mx[1] - mn[1]).toBeLessThan(0.21);
    expect(prim.getMaterial()?.getBaseColorTexture()).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------------------------
// Opt-in visual QA: TEXTURE_PREVIEW=1 npx vitest run --config game/vitest.config.ts tests/textures.test.ts
describe.skipIf(!process.env.TEXTURE_PREVIEW)('texture preview sheets', () => {
  it('rasterizes every set (2x2 tiled colour, roughness, normal, grazing-lit) + face panels', async () => {
    const sharp = (await import('sharp')).default;
    const out = path.join(REPO, 'qa-artifacts/assets/textures-iteration04');
    fs.mkdirSync(out, {recursive: true});
    const uninstall = installCanvasShim(true);
    resetSurfaceCache();
    const rgb = (c: ShimCanvas) => c.data;
    const cell = 256;
    /** Nearest-resample RGBA canvas into a cell x cell RGB tile (2x2 repeat when tiled). */
    const tile = (src: Uint8ClampedArray, w: number, h: number, tiled: boolean, lit?: {n: Uint8ClampedArray; nw: number; nh: number}): Buffer => {
      const o = Buffer.alloc(cell * cell * 3);
      const rep = tiled ? 2 : 1;
      for (let y = 0; y < cell; y++) for (let x = 0; x < cell; x++) {
        const u = (x * rep / cell) % 1, v = (y * rep / cell) % 1;
        const i = (Math.floor(v * h) * w + Math.floor(u * w)) * 4;
        let k = 1;
        if (lit) {
          const j = (Math.floor(v * lit.nh) * lit.nw + Math.floor(u * lit.nw)) * 4;
          const nx = lit.n[j] / 127.5 - 1, ny = lit.n[j + 1] / 127.5 - 1, nz = lit.n[j + 2] / 127.5 - 1;
          k = 0.25 + 1.1 * Math.max(0, nx * -0.55 + ny * 0.55 + nz * 0.63); // light from upper-left, grazing
        }
        const a = src[i + 3] / 255; // composite over mid grey (shows glass alpha)
        for (let ch = 0; ch < 3; ch++) o[(y * cell + x) * 3 + ch] = Math.min(255, (src[i + ch] * a + 90 * (1 - a)) * k);
      }
      return o;
    };
    const rows: {label: string; tiles: Buffer[]}[] = [];
    try {
      for (const n of SURFACE_NAMES) {
        const s = surface(n);
        const c = s.map.image as unknown as ShimCanvas, r = s.roughnessMap?.image as unknown as ShimCanvas | undefined, nm = s.normalMap?.image as unknown as ShimCanvas | undefined;
        const tiles = [tile(rgb(c), c.width, c.height, true)];
        tiles.push(r ? tile(rgb(r), r.width, r.height, true) : Buffer.alloc(cell * cell * 3, 40));
        tiles.push(nm ? tile(rgb(nm), nm.width, nm.height, true) : Buffer.alloc(cell * cell * 3, 40));
        tiles.push(nm ? tile(rgb(c), c.width, c.height, true, {n: rgb(nm), nw: nm.width, nh: nm.height}) : tile(rgb(c), c.width, c.height, true));
        rows.push({label: `${n}  span ${s.span.join(' x ')} m  (colour 2x2 | roughness | normal | lit)`, tiles});
      }
      const W = cell * 4, LH = 22, H = rows.length * (cell + LH);
      const sheet = Buffer.alloc(W * H * 3, 24);
      rows.forEach((row, ri) => row.tiles.forEach((t, ti) => { for (let y = 0; y < cell; y++) t.copy(sheet, ((ri * (cell + LH) + LH + y) * W + ti * cell) * 3, y * cell * 3, (y + 1) * cell * 3); }));
      const svg = `<svg width="${W}" height="${H}">${rows.map((r, i) => `<text x="6" y="${i * (cell + LH) + 16}" font-family="DejaVu Sans" font-size="14" fill="#fff">${r.label}</text>`).join('')}</svg>`;
      await sharp(sheet, {raw: {width: W, height: H, channels: 3}}).composite([{input: Buffer.from(svg)}]).png().toFile(path.join(out, 'surfaces.png'));
      // Face-mapped panels.
      const faces = [...MENUS.map((_, i) => menuBoardTexture(i)), fareScreenTexture(), vendFrontTexture()];
      const comps: {input: Buffer; left: number; top: number}[] = [];
      let x = 0, y = 0, rowH = 0;
      for (const t of faces) {
        const c = t.image as unknown as ShimCanvas;
        const png = await sharp(Buffer.from(c.data), {raw: {width: c.width, height: c.height, channels: 4}}).resize({width: Math.min(c.width, 512)}).png().toBuffer();
        const meta = await sharp(png).metadata();
        if (x + meta.width! > 1100) { x = 0; y += rowH + 8; rowH = 0; }
        comps.push({input: png, left: x, top: y});
        x += meta.width! + 8; rowH = Math.max(rowH, meta.height!);
      }
      await sharp({create: {width: 1100, height: y + rowH, channels: 3, background: '#181818'}}).composite(comps).png().toFile(path.join(out, 'faces.png'));
      // Assembled props with the runtime material configs (spans, tints, grime) and shader projection rules.
      const pm = new WorldMaterials(fakeEnvTextures(), 11, {w: 1.2, h: 0.19, d: 0.17});
      const B = (m: ShapeMat, sz: [number, number, number], at: [number, number, number]): RenderBox => ({part: {m, s: sz, p: at}, mat: shapeMaterial(pm, m)});
      const kinds: PropKind[] = ['table', 'booth', 'ticketMachine', 'toiletStall', 'washCounter', 'desk', 'stall', 'vending', 'shelf', 'exitStair'];
      const scenes: {label: string; boxes: RenderBox[]; yaw?: number}[] = kinds.map(kind => ({label: kind, boxes: (propShape(kind) ?? []).map(part => ({part, mat: shapeMaterial(pm, part.m), tint: part.m === 'accent' ? ACCENT_COLORS[kind]?.[0] : undefined}))}));
      scenes.push({label: 'storefront blocks (sample bay)', yaw: 20, boxes: [
        B('quarryTile', [4, 0.02, 3.2], [0, 0.01, -0.4]), B('tileShop', [4, 3, 0.06], [0, 1.5, -2]),
        B('shopFrame', [0.12, 3, 0.15], [-2, 1.5, 1.1]), B('shopFrame', [0.12, 3, 0.15], [2, 1.5, 1.1]), B('shopFrame', [4.12, 0.15, 0.15], [0, 2.45, 1.1]),
        B('signBand', [4.12, 0.5, 0.12], [0, 2.8, 1.12]), B('shutterSteel', [3.9, 0.45, 0.06], [0, 2.15, 1.05]),
        B('menuBoard', [1.6, 0.8, 0.04], [-0.8, 1.95, -1.95]), B('menuBoardNoodle', [1.2, 0.6, 0.04], [1.0, 2.0, -1.95]),
        B('kitchenSteel', [3.6, 0.9, 0.6], [0, 0.45, -1.6]), B('laminate', [3.0, 0.04, 0.65], [0, 1.0, 0.5]), B('woodVeneer', [3.0, 0.96, 0.04], [0, 0.48, 0.8]),
        B('glassShopfront', [0.02, 1.4, 1.6], [1.9, 1.4, -0.2]),
        B('plasticSeat', [0.38, 0.05, 0.38], [-1, 0.45, 1.9]), B('steelDark', [0.05, 0.43, 0.05], [-1, 0.215, 1.9]),
        B('plasticSeat', [0.38, 0.05, 0.38], [0.6, 0.45, 1.9]), B('steelDark', [0.05, 0.43, 0.05], [0.6, 0.215, 1.9]),
      ]});
      const steel = pm.get('steel');
      scenes.push({label: 'column 4.4 m + door frame (steel trim)', yaw: 25, boxes: [
        {part: {m: 'steelDark', s: [0.5, 4.4, 0.5], p: [0, 2.2, 0]}, mat: steel},
        {part: {m: 'steelDark', s: [0.09, 2.6, 0.36], p: [1.2, 1.3, 0]}, mat: steel}, {part: {m: 'steelDark', s: [0.09, 2.6, 0.36], p: [2.6, 1.3, 0]}, mat: steel},
        {part: {m: 'steelDark', s: [1.49, 0.1, 0.36], p: [1.9, 2.55, 0]}, mat: steel},
        {part: {m: 'concrete', s: [3.5, 0.02, 1.5], p: [1.2, 0.01, 0.3]}, mat: shapeMaterial(pm, 'concrete')},
      ]});
      const SZ = 400, COLS = 4, LH2 = 22, rowsN = Math.ceil(scenes.length / COLS);
      const W2 = SZ * COLS, H2 = rowsN * (SZ + LH2), big = Buffer.alloc(W2 * H2 * 3, 20);
      scenes.forEach((sc, i) => {
        const tile = renderProps(sc.boxes, SZ, sc.yaw ?? 35, 18);
        const ox = (i % COLS) * SZ, oy = Math.floor(i / COLS) * (SZ + LH2) + LH2;
        for (let yy = 0; yy < SZ; yy++) tile.copy(big, ((oy + yy) * W2 + ox) * 3, yy * SZ * 3, (yy + 1) * SZ * 3);
      });
      const svg2 = `<svg width="${W2}" height="${H2}">${scenes.map((sc, i) => `<text x="${(i % COLS) * SZ + 6}" y="${Math.floor(i / COLS) * (SZ + LH2) + 16}" font-family="DejaVu Sans" font-size="14" fill="#fff">${sc.label}</text>`).join('')}</svg>`;
      await sharp(big, {raw: {width: W2, height: H2, channels: 3}}).composite([{input: Buffer.from(svg2)}]).png().toFile(path.join(out, 'props.png'));
    } finally { uninstall(); }
    expect(fs.existsSync(path.join(out, 'surfaces.png'))).toBe(true);
    // Generated node-material shaders (WebGL2-backend GLSL) for manual review (no WebGL in node).
    const pmats = new WorldMaterials(fakeEnvTextures(), 3, {w: 1.2, h: 0.19, d: 0.17});
    const sh = compileNodeMaterial(new THREE.Mesh(new THREE.BoxGeometry(), shapeMaterial(pmats, 'signBand')), [new THREE.PointLight()]);
    fs.writeFileSync(path.join(out, 'world-mapped.vert.glsl'), sh.vertex);
    fs.writeFileSync(path.join(out, 'world-mapped.frag.glsl'), sh.fragment);
  }, 600000);
});
