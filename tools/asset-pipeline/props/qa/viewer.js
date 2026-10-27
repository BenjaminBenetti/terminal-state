// QA renderer for the props pipeline (local worker tooling, never shipped).
// Loads GLBs with the stock three.js GLTFLoader (no decoders registered) and renders labelled views.
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';

const W = 800, H = 600;
const renderer = new THREE.WebGLRenderer({antialias: true, preserveDrawingBuffer: true});
renderer.setPixelRatio(1);
renderer.setSize(W, H);
renderer.toneMapping = THREE.NeutralToneMapping;
document.body.appendChild(renderer.domElement);
const pmrem = new THREE.PMREMGenerator(renderer);
const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x5c5f63);
scene.environment = envTex;
scene.environmentIntensity = 0.8;
const key = new THREE.DirectionalLight(0xffffff, 1.6);
key.position.set(-1.5, 2.5, 2.0);
scene.add(key);
const fill = new THREE.DirectionalLight(0xdfe8ff, 0.5);
fill.position.set(2, 1, -1.5);
scene.add(fill);
scene.add(new THREE.HemisphereLight(0xffffff, 0x404040, 0.4));
const helpers = new THREE.Group();
scene.add(helpers);

const loader = new GLTFLoader();
const assets = new Map();
const errors = [];
window.addEventListener('error', e => errors.push(String(e.message)));
window.addEventListener('unhandledrejection', e => errors.push(String(e.reason)));

function bboxOf(obj) { obj.updateMatrixWorld(true); return new THREE.Box3().setFromObject(obj); }

function markerFor(node) {
  const color = node.name === 'Muzzle' ? 0xff2030 : 0x20e0ff;
  const g = new THREE.Group();
  g.name = '__marker';
  const s = new THREE.Mesh(new THREE.SphereGeometry(0.012, 16, 12), new THREE.MeshBasicMaterial({color, depthTest: false}));
  s.renderOrder = 10;
  g.add(s);
  if (node.name === 'Muzzle') {
    const a = new THREE.ArrowHelper(new THREE.Vector3(0, 0, -1), new THREE.Vector3(), 0.12, color, 0.03, 0.015);
    a.traverse(o => { if (o.material) { o.material.depthTest = false; } o.renderOrder = 10; });
    g.add(a);
  }
  g.visible = false;
  node.add(g);
}

async function load(id, url, opts = {}) {
  const t0 = performance.now();
  const gltf = await loader.loadAsync(url);
  const root = new THREE.Group();
  root.add(gltf.scene);
  if (opts.matrix) { root.matrixAutoUpdate = false; root.matrix.fromArray(opts.matrix); }
  root.visible = false;
  scene.add(root);
  let tris = 0; const names = []; const textures = [];
  gltf.scene.traverse(o => {
    if (o.isMesh) {
      const g = o.geometry; tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
      const m = o.material;
      for (const k of ['map', 'metalnessMap', 'roughnessMap', 'normalMap']) if (m[k]) textures.push(`${k}:${m[k].image?.width}x${m[k].image?.height}`);
    }
    if (o.name) names.push(o.name);
  });
  const nodes = {};
  for (const n of ['Muzzle', 'Grip']) {
    const node = gltf.scene.getObjectByName(n);
    if (node) { markerFor(node); root.updateMatrixWorld(true); nodes[n] = node.getWorldPosition(new THREE.Vector3()).toArray(); }
  }
  const box = bboxOf(root);
  assets.set(id, {root, gltf, box});
  return {id, url, ms: Math.round(performance.now() - t0), tris, names, nodes, textures: [...new Set(textures)], bbox: [box.min.toArray(), box.max.toArray()], errors: [...errors]};
}

// Plain three.js usage of extracted texture files: TextureLoader defaults (flipY=true) on a
// PlaneGeometry (v up), normalScale (1,1). Returns once textures are loaded.
async function texPlane(id, {color, orm, normal, w, h}) {
  const tl = new THREE.TextureLoader();
  const [map, ormTex, nrm] = await Promise.all([color, orm, normal].map(u => u ? tl.loadAsync(u) : null));
  map.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.MeshStandardMaterial({map, roughnessMap: ormTex, metalnessMap: ormTex, normalMap: nrm, roughness: 1, metalness: 0});
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  const root = new THREE.Group(); root.add(mesh); root.visible = false; scene.add(root);
  assets.set(id, {root, box: bboxOf(root)});
  return {id, w, h};
}

function dispose(id) {
  const a = assets.get(id);
  if (!a) return;
  scene.remove(a.root);
  a.root.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) { for (const k in o.material) { const v = o.material[k]; if (v && v.isTexture) v.dispose(); } o.material.dispose(); }
  });
  assets.delete(id);
}

function gridLines(plane, center, half, at) {
  // world-aligned 0.1 m minor / 1 m major lines in the given plane
  const minor = [], major = [];
  const [a, b] = plane === 'xy' ? ['x', 'y'] : plane === 'zy' ? ['z', 'y'] : ['x', 'z'];
  const lo = {}, hi = {};
  for (const ax of [a, b]) { lo[ax] = Math.floor((center[ax] - half) * 10) / 10; hi[ax] = Math.ceil((center[ax] + half) * 10) / 10; }
  const fixed = plane === 'xy' ? 'z' : plane === 'zy' ? 'x' : 'y';
  const push = (arr, p, q) => { arr.push(p.x, p.y, p.z, q.x, q.y, q.z); };
  for (const [u, v] of [[a, b], [b, a]]) {
    for (let k = Math.round(lo[u] * 10); k <= Math.round(hi[u] * 10); k++) {
      const p = new THREE.Vector3(), q = new THREE.Vector3();
      p[fixed] = q[fixed] = at; p[u] = q[u] = k / 10; p[v] = lo[v]; q[v] = hi[v];
      push(k % 10 === 0 ? major : minor, p, q);
    }
  }
  const g = new THREE.Group();
  for (const [arr, color, op] of [[minor, 0x3a3d40, 1], [major, 0xc8ccd0, 1]]) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
    g.add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({color, transparent: op < 1, opacity: op})));
  }
  return g;
}

function clearHelpers() {
  for (const c of [...helpers.children]) { helpers.remove(c); c.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); }); }
}

const AXES = {'+x': [1, 0, 0], '-x': [-1, 0, 0], '+y': [0, 1, 0], '-y': [0, -1, 0], '+z': [0, 0, 1], '-z': [0, 0, -1]};

function setupView(view, box) {
  clearHelpers();
  const c = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const radius = size.length() / 2;
  let cam;
  if (view.kind === 'ortho') {
    const d = new THREE.Vector3(...AXES[view.axis]);
    // half extents visible on screen
    const up = Math.abs(d.y) > 0.9 ? new THREE.Vector3(0, 0, -1) : new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(up, d).normalize().negate();
    const hw = Math.abs(right.x) * size.x / 2 + Math.abs(right.y) * size.y / 2 + Math.abs(right.z) * size.z / 2;
    const hh = Math.abs(up.x) * size.x / 2 + Math.abs(up.y) * size.y / 2 + Math.abs(up.z) * size.z / 2;
    const m = view.margin ?? 1.18;
    let ww = hw * m, hhh = hh * m;
    if (ww / hhh > W / H) hhh = ww * H / W; else ww = hhh * W / H;
    cam = new THREE.OrthographicCamera(-ww, ww, hhh, -hhh, 0.001, 100);
    cam.up.copy(up);
    cam.position.copy(c).addScaledVector(d, radius * 4 + 1);
    cam.lookAt(c);
    if (view.grid !== false) {
      const plane = Math.abs(d.z) > 0.9 ? 'xy' : Math.abs(d.x) > 0.9 ? 'zy' : 'xz';
      const axis = plane === 'xy' ? 'z' : plane === 'zy' ? 'x' : 'y';
      const at = (d[axis] > 0 ? box.min[axis] : box.max[axis]) - Math.sign(d[axis]) * 0.03;
      helpers.add(gridLines(plane, c, Math.max(ww, hhh) + 0.2, at));
    }
  } else if (view.kind === 'persp') {
    const dir = new THREE.Vector3(...view.dir).normalize();
    cam = new THREE.PerspectiveCamera(view.fov ?? 35, W / H, 0.01, 100);
    const dist = radius / Math.sin(THREE.MathUtils.degToRad(cam.fov / 2)) * (view.zoom ?? 1.05);
    cam.position.copy(c).addScaledVector(dir, dist);
    cam.lookAt(c);
    if (view.grid !== false) helpers.add(gridLines('xz', c, Math.max(radius * 2.5, 1.2), view.floorY ?? box.min.y));
  } else if (view.kind === 'fp') {
    cam = new THREE.PerspectiveCamera(view.fov ?? 70, W / H, 0.01, 100);
    cam.position.set(0, 0, 0);
    cam.lookAt(0, 0, -1);
    helpers.add(gridLines('xz', new THREE.Vector3(0, -1.6, -2), 3, -1.6));
  }
  return cam;
}

function renderInto(ctx, x, y, label) {
  ctx.drawImage(renderer.domElement, x, y);
  if (label) {
    ctx.font = 'bold 18px DejaVu Sans, sans-serif';
    const w = ctx.measureText(label).width;
    ctx.fillStyle = 'rgba(0,0,0,0.65)'; ctx.fillRect(x, y, w + 16, 28);
    ctx.fillStyle = '#fff'; ctx.fillText(label, x + 8, y + 20);
  }
}

function withOnly(ids, fn) {
  for (const [k, a] of assets) a.root.visible = ids.includes(k);
  try { return fn(); } finally { for (const a of assets.values()) a.root.visible = false; }
}

function setMarkers(id, on) {
  assets.get(id)?.root.traverse(o => { if (o.name === '__marker') o.visible = on; });
}

const stash = new WeakMap();
function setNormalMaps(id, on) {
  assets.get(id)?.root.traverse(o => {
    if (!o.isMesh) return;
    const m = o.material;
    if (!on && m.normalMap) { stash.set(m, m.normalMap); m.normalMap = null; m.needsUpdate = true; }
    if (on && stash.has(m)) { m.normalMap = stash.get(m); stash.delete(m); m.needsUpdate = true; }
  });
}

const white = new THREE.MeshBasicMaterial({color: 0xffffff, side: THREE.DoubleSide});
function silhouette(ids, view) {
  // returns ImageData of mask per id rendered with identical camera
  const a = assets.get(ids[0]);
  const box = a.box.clone();
  for (const id of ids.slice(1)) box.union(assets.get(id).box);
  const cam = setupView({...view, grid: false}, box);
  const masks = [];
  const bg = scene.background; scene.background = new THREE.Color(0); scene.overrideMaterial = white;
  for (const id of ids) {
    withOnly([id], () => renderer.render(scene, cam));
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d'); x.drawImage(renderer.domElement, 0, 0);
    masks.push(x.getImageData(0, 0, W, H));
  }
  scene.background = bg; scene.overrideMaterial = null;
  const out = new ImageData(W, H);
  let onlyA = 0, onlyB = 0, both = 0;
  for (let i = 0; i < W * H; i++) {
    const A = masks[0].data[4 * i] > 127, B = masks[1].data[4 * i] > 127;
    out.data[4 * i + 3] = 255;
    if (A && B) { out.data[4 * i] = 200; out.data[4 * i + 1] = 200; out.data[4 * i + 2] = 200; both++; }
    else if (A) { out.data[4 * i] = 255; out.data[4 * i + 1] = 40; out.data[4 * i + 2] = 40; onlyA++; }
    else if (B) { out.data[4 * i] = 40; out.data[4 * i + 1] = 220; out.data[4 * i + 2] = 255; onlyB++; }
    else { out.data[4 * i] = 30; out.data[4 * i + 1] = 30; out.data[4 * i + 2] = 30; }
  }
  return {image: out, stats: {both, onlyA, onlyB, iou: both / (both + onlyA + onlyB)}};
}

async function sheet({title, cols = 2, cells}) {
  const rows = Math.ceil(cells.length / cols);
  const top = title ? 40 : 0;
  const canvas = document.createElement('canvas');
  canvas.width = cols * W; canvas.height = rows * H + top;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#18191b'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (title) { ctx.font = 'bold 22px DejaVu Sans, sans-serif'; ctx.fillStyle = '#fff'; ctx.fillText(title, 12, 28); }
  const stats = [];
  for (const [i, cell] of cells.entries()) {
    const x = (i % cols) * W, y = top + Math.floor(i / cols) * H;
    if (cell.kind === 'silhouette') {
      const {image, stats: s} = silhouette(cell.ids, cell.view);
      ctx.putImageData(image, x, y);
      stats.push({cell: i, ...s});
      const lbl = `${cell.label}  IoU ${(s.iou * 100).toFixed(1)}%  (red=source only, cyan=derivative only)`;
      ctx.font = 'bold 16px DejaVu Sans, sans-serif'; ctx.fillStyle = 'rgba(0,0,0,0.65)'; ctx.fillRect(x, y, ctx.measureText(lbl).width + 16, 26);
      ctx.fillStyle = '#fff'; ctx.fillText(lbl, x + 8, y + 18);
      continue;
    }
    const a = assets.get(cell.id);
    let restore = null;
    if (cell.view.kind === 'fp') {
      restore = a.root.position.clone();
      a.root.position.set(...(cell.view.place ?? [0.25, -0.22, -0.45]));
      a.root.updateMatrixWorld(true);
    }
    setMarkers(cell.id, !!cell.markers);
    if (cell.noNormal) setNormalMaps(cell.id, false);
    const cam = setupView(cell.view, bboxOf(a.root));
    const saved = {kp: key.position.clone(), ki: key.intensity, fi: fill.intensity, env: scene.environmentIntensity};
    if (cell.light) {
      key.position.set(...cell.light.key); key.intensity = cell.light.intensity ?? key.intensity;
      fill.intensity = cell.light.fill ?? fill.intensity; scene.environmentIntensity = cell.light.env ?? scene.environmentIntensity;
    }
    withOnly([cell.id], () => renderer.render(scene, cam));
    key.position.copy(saved.kp); key.intensity = saved.ki; fill.intensity = saved.fi; scene.environmentIntensity = saved.env;
    renderInto(ctx, x, y, cell.label);
    if (cell.noNormal) setNormalMaps(cell.id, true);
    setMarkers(cell.id, false);
    if (restore) { a.root.position.copy(restore); a.root.updateMatrixWorld(true); }
  }
  clearHelpers();
  return {png: canvas.toDataURL('image/png'), stats};
}

function glInfo() {
  const gl = renderer.getContext();
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  return {webgl2: renderer.capabilities.isWebGL2, renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)};
}

window.qa = {load, texPlane, dispose, sheet, glInfo, errors, ready: true};
