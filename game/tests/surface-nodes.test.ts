// Iteration 13 (MAT-A): the surface materials as WebGPURenderer node materials (TSL). The iteration-04 world mapping,
// iteration-08 sign atlas and iteration-12 decay GLSL hooks are TSL node graphs / node hooks now (world/surfaceNodes.ts,
// world/materials.ts, world/decay.ts, world/builder.ts). These tests build the REAL generated shaders with three r186's
// GLSLNodeBuilder (the code path of the renderer's WebGL2 backend; no GPU in node) and run the straight-line parts of
// them on sample inputs (tests/helpers/glslEval.ts) against CPU references:
//  - world-UV projection per dominant world axis, with model AND instance matrices, span and topAlongZ;
//  - the world-space tone noise (wmHash / wmNoise) bit-for-bit against its CPU mirror;
//  - the sign-atlas rect mapping;
// plus the node-hook contract (render/nodeHooks.ts): slots, keys, stage order (world mapping 100, decay 200, a later
// lane's hook 300), determinism / idempotence, program sharing (one program per hook chain + map set), clones.
import {describe, expect, it} from 'vitest';
import * as THREE from 'three';
import {MeshStandardNodeMaterial, NodeMaterial} from 'three/webgpu';
import {float, materialColor, texture, uv, vec3, vec4} from 'three/tsl';
import {installCanvasShim} from './helpers/canvas2d';
import {compileNodeMaterial} from './helpers/nodeCompile';
import {arrayVal, mainBody, mat4, runBlock, shaderFunctions, type Env, type Val} from './helpers/glslEval';
import {TEXTURE_FILES, type TextureKey} from '../src/assets/manifest';
import {addNodeHook, nodeHookKeys, removeNodeHook} from '../src/render/nodeHooks';
import {SurfaceNodeMaterial, WM_HOOK, WM_ROUGH_HOOK, WorldMaterials, cloneSurfaceMaterial, isWorldMapped, surfaceMaterial, worldMapped} from '../src/world/materials';
import {MAPPED_SLOTS, WM_CONTEXT, WM_NORMAL, matRef, wmHashCpu, wmNoiseCpu, worldUvCpu} from '../src/world/surfaceNodes';
import {DECAY_HOOK, DECAY_PROFILES, DECAY_ROUGH_HOOK, applyDecay, archShopMaterial, decayWorldMaterials} from '../src/world/decay';
import {shapeMaterial} from '../src/world/shapeMaterials';
import {signAtlasMat} from '../src/world/builder';
import {interiorShadowSide} from '../src/world/openables';

installCanvasShim(false);

function fakeEnvTextures(): Record<TextureKey, THREE.Texture> {
  const out = {} as Record<TextureKey, THREE.Texture>;
  for (const k of Object.keys(TEXTURE_FILES) as TextureKey[]) out[k] = new THREE.Texture({width: 64, height: 64} as unknown as HTMLImageElement);
  return out;
}
const LIGHTS = () => [new THREE.PointLight()];
const nm = (m: THREE.Material) => m as unknown as NodeMaterial;
const norm = (code: string) => code.replace(/(NodeBuffer_|buffer)\d+/g, '$1N');

/** Run the generated vertex main of `mesh` up to `target` for one vertex (position / normal / uv / instance attributes). */
function runVertex(mesh: THREE.Mesh, target: string, attrs: Record<string, Val>, bind: (vertex: string, env: Env) => void): Val {
  const sh = compileNodeMaterial(mesh, LIGHTS());
  const env: Env = new Map(Object.entries(attrs));
  env.set('gl_InstanceID', 0);
  bind(sh.vertex, env);
  const v = runBlock(mainBody(sh.vertex), env, {}, target);
  if (v === undefined) throw new Error(`${target} not assigned in the vertex shader`);
  return v;
}

/** Bind the uniforms the world-mapping varying reads: the model matrix, wmMap and (instanced) the instance matrices. */
function bindWorldMapping(m: SurfaceNodeMaterial, world: THREE.Matrix4, instances?: THREE.Matrix4[]) {
  return (vertex: string, env: Env) => {
    const model = /v_positionWorld = \( (\w+) \* vec4\( positionLocal, 1\.0 \) \)\.xyz;/.exec(vertex)?.[1];
    const map = /\( (\w+)\.w > 0\.5 \)/.exec(vertex)?.[1];
    expect(model, 'model matrix uniform').toBeTruthy();
    expect(map, 'wmMap uniform').toBeTruthy();
    env.set(model!, mat4(world.elements));
    env.set(map!, m.wmMap.toArray());
    const buf = /(buffer\d+)\[ uint\( gl_InstanceID \) \]/.exec(vertex)?.[1];
    if (instances) { expect(buf, 'instance buffer').toBeTruthy(); env.set(buf!, arrayVal(instances.map(i => mat4(i.elements)))); }
  };
}

describe('world-mapped surfaces: TSL world projection (generated shader evaluated on sample points)', () => {
  // Faces of every orientation, oblique normals and the dominant-axis ties (x wins over y and z; y over z).
  const SAMPLES: [number, number, number][][] = [
    [[0.5, 0.2, -0.3], [1, 0, 0]], [[-0.5, 0.4, 0.1], [-1, 0, 0]], [[0.3, 0.5, -0.2], [0, 1, 0]], [[-0.1, -0.5, 0.4], [0, -1, 0]],
    [[0.2, -0.3, 0.5], [0, 0, 1]], [[0.4, 0.1, -0.5], [0, 0, -1]], [[0.1, 0.2, 0.3], [0.6, 0.8, 0]], [[0.3, 0.1, 0.2], [0.7071, 0, 0.7071]],
    [[0.2, 0.3, 0.1], [0, 0.7071, 0.7071]], [[0.1, 0.1, 0.1], [0.5774, 0.5774, 0.5774]], [[0.25, 0.1, 0.4], [0.2, -0.3, 0.93]],
  ];

  it('matches the dominant-axis projection in WORLD metres (model matrix applied), per span and topAlongZ', () => {
    const world = new THREE.Matrix4().compose(new THREE.Vector3(12.5, 1.25, -7), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.6), new THREE.Vector3(2, 0.5, 1.5));
    for (const topAlongZ of [false, true]) {
      const m = worldMapped(new SurfaceNodeMaterial({map: new THREE.Texture()}), {span: [0.8, 1.7], topAlongZ});
      for (const [p, n] of SAMPLES) {
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(), m);
        mesh.matrixAutoUpdate = false;
        mesh.matrix.copy(world);
        mesh.matrixWorld.copy(world);
        const v = runVertex(mesh, 'vWm', {position: p, normal: n}, bindWorldMapping(m, world)) as number[];
        const pw = new THREE.Vector3(...p).applyMatrix4(world), nw = new THREE.Vector3(...n).transformDirection(world);
        const [u, vv] = worldUvCpu(pw.toArray(), nw.toArray(), [0.8, 1.7], topAlongZ);
        expect(v[0], `u ${p} ${n} z${topAlongZ}`).toBeCloseTo(u, 9);
        expect(v[1], `v ${p} ${n} z${topAlongZ}`).toBeCloseTo(vv, 9);
        expect(v[2], 'up').toBeCloseTo(Math.abs(nw.y), 9);
      }
    }
  });

  it('applies the INSTANCE matrix before projecting (instance-scaled columns keep real texel scale)', () => {
    const m = surfaceMaterial('paintedSteel', {metalness: 0.3}, {grime: [0.3, 0.45], macro: 0.15});
    const span = [1 / m.wmMap.x, 1 / m.wmMap.y] as [number, number];
    const inst = new THREE.Matrix4().compose(new THREE.Vector3(3, 2.2, 5), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2), new THREE.Vector3(0.5, 4.4, 0.5));
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(), m, 1);
    mesh.setMatrixAt(0, inst);
    for (const [p, n] of SAMPLES.slice(0, 6)) {
      const v = runVertex(mesh, 'vWm', {position: p, normal: n}, bindWorldMapping(m, new THREE.Matrix4(), [inst])) as number[];
      // three applies the inverse-transpose of the instance matrix to normals; for these axis faces the direction equals
      // the iteration-04 mat3(instanceMatrix) * normal.
      const pw = new THREE.Vector3(...p).applyMatrix4(inst), nw = new THREE.Vector3(...n).applyMatrix3(new THREE.Matrix3().getNormalMatrix(inst)).normalize();
      const [u, vv] = worldUvCpu(pw.toArray(), nw.toArray(), span);
      expect(v[0], `u ${p}`).toBeCloseTo(u, 9);
      expect(v[1], `v ${p}`).toBeCloseTo(vv, 9);
    }
  });

  it('tone noise: the generated wmHash / wmNoise equal their CPU mirrors', () => {
    const sh = compileNodeMaterial(new THREE.Mesh(new THREE.BoxGeometry(), surfaceMaterial('laminate', {}, {grime: [0.2, 0.35], macro: 0.12})), LIGHTS());
    const fns = shaderFunctions(sh.fragment);
    expect(Object.keys(fns)).toEqual(expect.arrayContaining(['wmHash', 'wmNoise']));
    const pts = [[0, 0, 0], [1.25, -3.5, 7.75], [12.1, 0.7, -40.3], [-0.31, 2.2, 3.3], [100.5, 3.1, 250.25]];
    for (const p of pts) {
      expect(fns.wmHash([p]) as number, `hash ${p}`).toBeCloseTo(wmHashCpu(p[0], p[1], p[2]), 9);
      expect(fns.wmNoise([p]) as number, `noise ${p}`).toBeCloseTo(wmNoiseCpu(p[0], p[1], p[2]), 9);
    }
    // Value noise: in [0, 1), continuous, not constant.
    const vals = Array.from({length: 64}, (_, i) => wmNoiseCpu(i * 0.37, 1.3, i * 0.11));
    expect(Math.min(...vals)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...vals)).toBeLessThan(1);
    expect(Math.max(...vals) - Math.min(...vals)).toBeGreaterThan(0.3);
    expect(Math.abs(wmNoiseCpu(2.5, 1, 1) - wmNoiseCpu(2.5001, 1, 1))).toBeLessThan(1e-3);
  });

  it('every material map samples the world coordinate; the normal map tangent frame follows it; other textures do not', () => {
    const m = surfaceMaterial('brushedSteel', {metalness: 0.5});
    expect(m.contextNode).toBe(WM_CONTEXT);
    expect(m.normalNode).toBe(WM_NORMAL);
    expect(MAPPED_SLOTS).toEqual(['map', 'roughnessMap', 'metalnessMap', 'normalMap', 'emissiveMap', 'alphaMap', 'aoMap']);
    m.emissiveMap = m.map;
    m.emissive.set(0xffffff);
    const sh = compileNodeMaterial(new THREE.Mesh(new THREE.BoxGeometry(), m), LIGHTS());
    // map, roughness, normal and emissive maps: four samples at the world coordinate, none at the mesh uv.
    expect(sh.fragmentMain.match(/vec3\( vWm\.xy, 1\.0 \)/g)?.length).toBe(4);
    expect(sh.fragmentMain).not.toMatch(/\* vec3\( v?uv\w*, 1\.0 \)/i);
    expect(sh.fragmentMain).toContain('dFdx( vWm.xy )');
    expect(sh.fragmentMain).toContain('dFdy( vWm.xy )');
    // A texture of another system with its own uv (e.g. a later lane's hook) keeps that uv: one more sample, not world-mapped.
    const own = new THREE.DataTexture(new Uint8Array(4), 1, 1);
    const m2 = surfaceMaterial('brushedSteel');
    const base = compileNodeMaterial(new THREE.Mesh(new THREE.BoxGeometry(), m2), LIGHTS()).fragmentMain;
    addNodeHook(m2, {key: 'test-own-uv', stage: 'emissive', order: 400, fn: () => texture(own, uv()).rgb});
    const hooked = compileNodeMaterial(new THREE.Mesh(new THREE.BoxGeometry(), m2), LIGHTS()).fragmentMain;
    const count = (c: string, x: RegExp) => c.match(x)?.length ?? 0;
    expect(count(hooked, /texture\(/g)).toBe(count(base, /texture\(/g) + 1);
    expect(count(hooked, /vec3\( vWm\.xy, 1\.0 \)/g)).toBe(count(base, /vec3\( vWm\.xy, 1\.0 \)/g));
  });
});

describe('sign atlas (iteration 08 hook as a node context)', () => {
  it('samples uv * aUvRect.zw + aUvRect.xy per instance', () => {
    const atlas = new THREE.DataTexture(new Uint8Array(4), 1, 1);
    const m = signAtlasMat(atlas);
    expect(m.name).toBe('sign-atlas');
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.setAttribute('aUvRect', new THREE.InstancedBufferAttribute(new Float32Array([0.25, 0.5, 0.5, 0.125]), 4));
    const mesh = new THREE.InstancedMesh(geo, m, 1);
    const sh = compileNodeMaterial(mesh, LIGHTS());
    expect(sh.vertex).toMatch(/\bin vec4 aUvRect;/);
    expect(sh.fragmentMain).toContain('vec3( vSignUv, 1.0 )');
    for (const uv of [[0, 0], [1, 1], [0.3, 0.8]]) {
      const v = runVertex(mesh, 'vSignUv', {uv, aUvRect: [0.25, 0.5, 0.5, 0.125], position: [0, 0, 0], normal: [0, 0, 1]}, (vertex, env) => {
        const buf = /(buffer\d+)\[ uint\( gl_InstanceID \) \]/.exec(vertex)?.[1];
        if (buf) env.set(buf, arrayVal([mat4(new THREE.Matrix4().elements)]));
      }) as number[];
      expect(v[0]).toBeCloseTo(uv[0] * 0.5 + 0.25, 9);
      expect(v[1]).toBeCloseTo(uv[1] * 0.125 + 0.5, 9);
    }
  });
});

describe('node-hook contract: order, determinism, sharing, clones', () => {
  const mats = new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17});
  decayWorldMaterials(mats);

  it('slots and keys: world mapping at 100, decay at 200, a later lane at 300 folds after both', () => {
    const wm = surfaceMaterial('laminate');
    expect(nodeHookKeys(wm)).toEqual([WM_HOOK, WM_ROUGH_HOOK]);
    expect(wm.colorNode && wm.roughnessNode && wm.contextNode && wm.normalNode).toBeTruthy();
    const tile = mats.get('tileLower') as SurfaceNodeMaterial;
    expect(nodeHookKeys(tile)).toEqual([DECAY_HOOK, DECAY_ROUGH_HOOK]);
    expect(isWorldMapped(tile)).toBe(false);
    // A damage-style hook (order 300) receives the decayed colour as `prev`.
    const seen: unknown[] = [];
    const c = cloneSurfaceMaterial(tile);
    addNodeHook(c, {key: 'test-damage', stage: 'color', order: 300, fn: prev => { seen.push(prev); return prev; }});
    expect(nodeHookKeys(c)).toEqual([DECAY_HOOK, DECAY_ROUGH_HOOK, 'test-damage']);
    expect(seen.at(-1)).toBe(tile.colorNode);
    // Registering it with a LOWER order runs it before the decay: the decay then wraps its output.
    addNodeHook(c, {key: 'test-damage', stage: 'color', order: 150, fn: prev => vec4((prev ?? materialColor) as never).mul(0.5)});
    expect(nodeHookKeys(c)).toEqual(['test-damage', DECAY_HOOK, DECAY_ROUGH_HOOK]);
    expect(c.colorNode).not.toBe(tile.colorNode);
    expect(removeNodeHook(c, 'test-damage')).toBe(true);
    expect(c.colorNode).toBe(tile.colorNode);
  });

  it('deterministic and idempotent: re-applying hooks / profiles gives the same node objects (same program)', () => {
    const t = mats.get('terrazzo') as SurfaceNodeMaterial;
    const before = [t.colorNode, t.roughnessNode];
    applyDecay(t, DECAY_PROFILES.terrazzo);
    applyDecay(t, DECAY_PROFILES.terrazzo);
    expect([t.colorNode, t.roughnessNode]).toEqual(before);
    expect(t.colorNode).toBe(before[0]);
    // Two decayed materials of the same map set: identical node graphs, program key and generated code; only the
    // per-material profile values (material properties, read through materialReference) differ.
    const a = mats.get('concrete') as SurfaceNodeMaterial, b = mats.get('ballast') as SurfaceNodeMaterial;
    expect(a.colorNode).toBe(b.colorNode);
    expect(a.customProgramCacheKey()).toBe(b.customProgramCacheKey());
    expect(a.decayP1.toArray()).not.toEqual(b.decayP1.toArray());
    const ca = compileNodeMaterial(new THREE.Mesh(new THREE.BoxGeometry(), a), LIGHTS());
    const cb = compileNodeMaterial(new THREE.Mesh(new THREE.BoxGeometry(), b), LIGHTS());
    expect(norm(ca.fragment)).toBe(norm(cb.fragment));
    // Rebuilding the same material twice generates the same code (no per-build randomness / counters in the output).
    expect(norm(compileNodeMaterial(new THREE.Mesh(new THREE.BoxGeometry(), a), LIGHTS()).fragment)).toBe(norm(ca.fragment));
    // Every world-mapped shape key with the same map set shares one program key.
    const keys = new Set(['steelDark', 'steelBright', 'accent', 'counter', 'panel', 'partition', 'wood', 'shutter', 'kitchenSteel', 'laminate', 'tileShop']
      .map(k => shapeMaterial(mats, k).customProgramCacheKey()));
    expect(keys.size).toBe(1);
  });

  it('clones keep the look and the hook chain (values + nodes), and stay independent', () => {
    const src = shapeMaterial(mats, 'black') as SurfaceNodeMaterial;
    const plain = src.clone() as SurfaceNodeMaterial;
    expect(plain).toBeInstanceOf(SurfaceNodeMaterial);
    expect(plain.colorNode).toBe(src.colorNode);
    expect(plain.wmMap.toArray()).toEqual(src.wmMap.toArray());
    expect(plain.wmMap).not.toBe(src.wmMap);
    const hooked = cloneSurfaceMaterial(src);
    expect(nodeHookKeys(hooked)).toEqual(nodeHookKeys(src));
    applyDecay(hooked, DECAY_PROFILES.tileShop);
    expect(nodeHookKeys(src)).toEqual([WM_HOOK, WM_ROUGH_HOOK]); // the shared material is untouched
    expect(nodeHookKeys(hooked)).toEqual([DECAY_HOOK, DECAY_ROUGH_HOOK, WM_HOOK, WM_ROUGH_HOOK]);
    expect(src.decayP0.toArray()).toEqual([0, 0, 0, 0]);
    // The storefront-unit arch copies are such clones.
    expect(nodeHookKeys(nm(archShopMaterial(mats, 'quarryTile')))).toEqual([DECAY_HOOK, DECAY_ROUGH_HOOK, WM_HOOK, WM_ROUGH_HOOK]);
  });

  it('clones keep alphaTest and the render state (three r186 NodeMaterial.copy drops alphaTest)', () => {
    const state = (m: THREE.Material) => [m.alphaTest, m.transparent, m.side, m.shadowSide, m.depthWrite, m.polygonOffset, m.polygonOffsetFactor, m.vertexColors];
    const params = {alphaTest: 0.5, transparent: true, side: THREE.BackSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, vertexColors: true};
    const surf = new SurfaceNodeMaterial(params);
    surf.shadowSide = THREE.BackSide;
    expect(state(surf.clone())).toEqual(state(surf));
    expect(state(cloneSurfaceMaterial(surf))).toEqual(state(surf));
    const plain = new MeshStandardNodeMaterial(params);
    expect(plain.clone().alphaTest).toBe(0); // the upstream behaviour this guards against
    expect(state(cloneSurfaceMaterial(plain))).toEqual(state(plain));
  });

  it('applyDecay refuses classic (WebGL-only) materials instead of silently dropping the decay', () => {
    expect(() => applyDecay(new THREE.MeshStandardMaterial(), DECAY_PROFILES.paint)).toThrow(/not a node material/);
  });
});

describe('shadow pass (three r186 draws shadow maps with an override material built from colorNode.a)', () => {
  const mats = new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17});
  decayWorldMaterials(mats);
  /** The override material three's ShadowNode / Renderer._getShadowNodes build for `src` (opaque: colour 0, colorNode.a). */
  const shadowMaterialFor = (src: NodeMaterial) => {
    const m = new NodeMaterial();
    (m as unknown as {isShadowPassMaterial: boolean}).isShadowPassMaterial = true;
    m.colorNode = vec4(vec3(0), float(1).mul((src.colorNode as unknown as {a: never}).a) as never);
    return m;
  };

  it('per-material values resolve against the SOURCE material (no uniform update on the override material)', () => {
    const src = mats.get('terrazzo') as SurfaceNodeMaterial, over = shadowMaterialFor(nm(src));
    const ref = matRef('decayTint', 'vec3') as unknown as {updateReference(s: unknown): unknown};
    expect(ref.updateReference({material: src, renderer: {_currentSourceMaterial: null}})).toBe(src);
    expect(ref.updateReference({material: over, renderer: {_currentSourceMaterial: src}})).toBe(src);
  });

  it('the shadow shader skips the world-mapping / decay maths (alpha only)', () => {
    for (const src of [mats.get('terrazzo'), shapeMaterial(mats, 'steelDark'), archShopMaterial(mats, 'tileShop')]) {
      const sh = compileNodeMaterial(new THREE.Mesh(new THREE.BoxGeometry(), shadowMaterialFor(nm(src))));
      for (const s of ['wmNoise(', 'wmFloor', 'dcRough', 'dcD', 'texelFetch(', 'vWm', 'vDecayN']) expect(sh.vertex + sh.fragment, `${src.name}: ${s}`).not.toContain(s);
      // ...while the colour pass has them.
      const full = compileNodeMaterial(new THREE.Mesh(new THREE.BoxGeometry(), src), LIGHTS()).fragment;
      expect(full).toMatch(/dcRough|wmFloor/);
    }
  });
});

describe('every surface factory makes node materials (WebGPURenderer node path, hookable by other lanes)', () => {
  it('wall detail, frieze, cables, shelf stock, storefront / purpose / shape keys', async () => {
    const mats = new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17});
    const {wallDetailMaterials} = await import('../src/world/wallDetail');
    const {stockMaterial} = await import('../src/world/shelfStockGeometry');
    const {purposeMaterial} = await import('../src/world/purposeTextures');
    const {SHAPE_MAT_KEYS} = await import('../src/gen/propShapes');
    const isNode = (m: THREE.Material) => (m as {isNodeMaterial?: boolean}).isNodeMaterial === true;
    const dm = wallDetailMaterials(mats);
    for (const [k, m] of Object.entries(dm)) {
      expect(isNode(m), k).toBe(true);
      expect(m.vertexColors, k).toBe(true);
    }
    // cut-out layers keep their depth / polygon-offset state (draw over the wall without z-fighting)
    expect([dm.flush.depthWrite, dm.flush.polygonOffset, dm.flush.polygonOffsetFactor, dm.decal.polygonOffsetFactor, dm.flush.alphaTest]).toEqual([false, true, -1, -2, 0.5]);
    expect(dm.soft.transparent).toBe(true);
    const stock = stockMaterial();
    expect(isNode(stock) && stock.vertexColors && !!stock.roughnessMap && stock.roughnessMap === stock.metalnessMap).toBe(true);
    for (const k of SHAPE_MAT_KEYS) expect(isNode(shapeMaterial(mats, k)), k).toBe(true);
    for (const k of ['paintRed', 'cardboard', 'magazines', 'deviceScreen', 'vinyl', 'keyBlanks'] as const) expect(isNode(purposeMaterial(k)), k).toBe(true);
    for (const k of ['tileLower', 'paint', 'terrazzo', 'steel', 'rail', 'crate', 'bin', 'gate', 'tube'] as const) expect(isNode(mats.get(k)), k).toBe(true);
    const sign = mats.makeSign('exit', 'EXIT');
    sign.traverse(o => { const m = (o as THREE.Mesh).material; if (m) for (const x of Array.isArray(m) ? m : [m]) expect(isNode(x), o.name).toBe(true); });
  });
});

describe('interior liners keep the iteration-12 shadow-side fix as node materials', () => {
  it('BackSide liners shadow from the faces they draw; WebGPURenderer r186 uses shadowSide ?? flip(side)', async () => {
    const back = interiorShadowSide(new MeshStandardNodeMaterial({side: THREE.BackSide}));
    expect(back.shadowSide).toBe(THREE.BackSide);
    expect(interiorShadowSide(new MeshStandardNodeMaterial()).shadowSide).toBe(null);
    // The pinned renderer's shadow pass rule (three r186 src/renderers/common/Renderer.js renderObject).
    const fs = await import('node:fs');
    const src = fs.readFileSync(new URL('../../node_modules/three/src/renderers/common/Renderer.js', import.meta.url), 'utf8');
    expect(src).toContain('overrideMaterial.side = ( material.shadowSide !== null ) ? material.shadowSide : _shadowSide[ material.side ];');
  });
});
