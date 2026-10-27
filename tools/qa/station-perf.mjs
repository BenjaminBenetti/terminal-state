// Node-side render-cost estimate for generated stations (no browser, no GPU): builds the real
// three.js station (world/builder.ts) with a stubbed 2D canvas and placeholder textures, then counts
// the meshes/instanced meshes a camera would submit (frustum test on bounding spheres, like
// WebGLRenderer) and their triangles from a few viewpoints. Generated GLB models are NOT loaded
// (procedural fallbacks are used), so model-heavy props are approximated.
// Usage: node tools/qa/station-perf.mjs [OUT_JSON] [seed ...]
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const [outFile, ...seedArgs] = process.argv.slice(2);

// --- minimal DOM canvas stub ------------------------------------------------------------------
function ctxStub(w, h) {
  const noop = () => {};
  const grad = {addColorStop: noop};
  const target = {
    canvas: null, measureText: t => ({width: String(t).length * 10}),
    getImageData: (x, y, ww, hh) => ({data: new Uint8ClampedArray(ww * hh * 4), width: ww, height: hh}),
    createImageData: (ww, hh) => ({data: new Uint8ClampedArray(ww * hh * 4), width: ww, height: hh}),
    createLinearGradient: () => grad, createRadialGradient: () => grad, createPattern: () => ({}),
  };
  return new Proxy(target, {get: (t, k) => (k in t ? t[k] : noop), set: (t, k, v) => { t[k] = v; return true; }});
}
globalThis.document = {
  createElement: () => { const c = {width: 1, height: 1, style: {}}; c.getContext = () => ctxStub(c.width, c.height); return c; },
};

const server = await createServer({root: path.join(root, 'game'), configFile: false, logLevel: 'error', server: {middlewareMode: true, hmr: false}, appType: 'custom', optimizeDeps: {noDiscovery: true, include: []}});
try {
  const THREE = await server.ssrLoadModule('three');
  const gen = await server.ssrLoadModule('/src/gen/station.ts');
  const {buildWorld} = await server.ssrLoadModule('/src/world/builder.ts');
  const {WorldMaterials} = await server.ssrLoadModule('/src/world/materials.ts');
  const manifest = await server.ssrLoadModule('/src/assets/manifest.ts');
  const keys = Object.keys(manifest.TEXTURES ?? manifest.textures ?? {});
  const texProxy = new Proxy({}, {get: () => { const t = new THREE.Texture(); t.image = {width: 64, height: 64}; return t; }});
  const tex = keys.length ? Object.fromEntries(keys.map(k => [k, texProxy[k]])) : texProxy;
  const seeds = seedArgs.length ? seedArgs.map(Number) : perArchetype(gen);
  const rows = [];
  for (const seed of seeds) {
    const t0 = performance.now();
    const l = gen.generateStation(seed);
    const genMs = performance.now() - t0;
    const mats = new WorldMaterials(tex, seed);
    const t1 = performance.now();
    const world = buildWorld(l, mats, {});
    const buildMs = performance.now() - t1;
    world.group.updateMatrixWorld(true);
    const cam = new THREE.PerspectiveCamera(75, 16 / 9, 0.05, 60);
    const views = viewpoints(l);
    const perView = views.map(v => {
      cam.position.set(v.x, 1.62, v.z);
      cam.rotation.set(0, v.yaw, 0, 'YXZ');
      cam.updateMatrixWorld(true);
      const fr = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
      let calls = 0, tris = 0;
      const sphere = new THREE.Sphere();
      world.group.traverse(o => {
        if (!o.isMesh || !o.visible) return;
        const geo = o.geometry;
        if (!geo.boundingSphere) geo.computeBoundingSphere();
        if (o.isInstancedMesh) { if (!o.boundingSphere) o.computeBoundingSphere(); sphere.copy(o.boundingSphere).applyMatrix4(o.matrixWorld); }
        else sphere.copy(geo.boundingSphere).applyMatrix4(o.matrixWorld);
        if (o.frustumCulled && !fr.intersectsSphere(sphere)) return;
        calls++;
        const t = (geo.index ? geo.index.count : geo.attributes.position.count) / 3;
        tris += t * (o.isInstancedMesh ? o.count : 1);
      });
      return {view: v.name, calls, tris: Math.round(tris)};
    });
    const row = {seed, archetype: l.archetype, genMs: Math.round(genMs), buildMs: Math.round(buildMs), meshes: world.stats.meshes, triangles: world.stats.triangles, storefronts: l.storefronts.length, views: perView};
    rows.push(row);
    console.log(JSON.stringify(row));
  }
  if (outFile) fs.writeFileSync(outFile, JSON.stringify(rows, null, 2));
} finally {
  await server.close();
}

function perArchetype(gen) {
  const want = new Map();
  for (let i = 0; want.size < gen.ARCHETYPES.length && i < 400; i++) {
    const seed = (i * 2654435761 + 12345) >>> 0;
    const a = gen.pickArchetype(seed);
    if (!want.has(a)) want.set(a, seed);
  }
  return [...want.values()];
}

/** Spawn view, food court looking at its counter wall, middle of the main ticket hall. */
function viewpoints(l) {
  const out = [{name: 'spawn', x: l.playerSpawn.x, z: l.playerSpawn.z, yaw: l.playerSpawn.yaw}];
  const F = l.areas.find(a => a.type === 'food-court');
  const sf = l.storefronts.find(s => s.hall === F.id);
  const yawTo = {N: 0, S: Math.PI, E: -Math.PI / 2, W: Math.PI / 2};
  out.push({name: 'food-court', x: (F.x + F.w / 2) * 0.5, z: (F.y + F.h / 2) * 0.5, yaw: sf ? yawTo[sf.side] : 0});
  const T = l.areas.find(a => a.type === 'fare-hall');
  out.push({name: 'ticket-hall', x: (T.x + T.w / 2) * 0.5, z: (T.y + T.h / 2) * 0.5, yaw: 0});
  const R = l.areas.find(a => a.type === 'retail-arcade');
  if (R) out.push({name: 'arcade', x: (R.x + R.w / 2) * 0.5, z: (R.y + R.h / 2) * 0.5, yaw: R.w >= R.h ? Math.PI / 2 : 0});
  return out;
}
