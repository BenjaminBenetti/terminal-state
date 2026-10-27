// QA viewer: loads a GLB with three's GLTFLoader and renders labelled contact sheets.
// Driven from Node through puppeteer (window.qa.*). Worker-only tooling, never shipped.
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';

const errors = [];
window.addEventListener('error', e => errors.push(String(e.message || e)));
window.addEventListener('unhandledrejection', e => errors.push(String(e.reason)));

const renderer = new THREE.WebGLRenderer({antialias: true, preserveDrawingBuffer: true});
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x30343a);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.55;
scene.add(new THREE.HemisphereLight(0xdde6ff, 0x2a2622, 0.6));
const key = new THREE.DirectionalLight(0xfff2e0, 1.6); key.position.set(1.5, 3, 2.5); scene.add(key);
const rim = new THREE.DirectionalLight(0xc8d8ff, 0.6); rim.position.set(-2, 2, -2); scene.add(rim);

// Floor: thin grid + translucent plane at y=0 to judge contact/penetration.
const floor = new THREE.Mesh(new THREE.PlaneGeometry(6, 6), new THREE.MeshBasicMaterial({color: 0x556070, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false}));
floor.rotation.x = -Math.PI / 2; scene.add(floor);
const grid = new THREE.GridHelper(6, 30, 0x8899aa, 0x445566); grid.position.y = 0.0005; scene.add(grid);

let model = null, gltf = null, mixer = null, skinned = [], skelHelper = null, jointDots = null;

function disposeModel() {
  if (!model) return;
  scene.remove(model);
  if (skelHelper) { scene.remove(skelHelper); skelHelper = null; }
  if (jointDots) { scene.remove(jointDots); jointDots = null; }
  model.traverse(o => { o.geometry?.dispose?.(); });
  model = null; gltf = null; mixer = null; skinned = [];
}

async function load(url, opts = {}) {
  disposeModel();
  const loader = new GLTFLoader();
  gltf = await loader.loadAsync(url);
  model = gltf.scene;
  if (opts.normalize) {
    // Masters: unit-ish box, facing -Z. Scale to 1.78 m, face +Z, feet on y=0.
    const box = new THREE.Box3().setFromObject(model);
    const s = 1.78 / (box.max.y - box.min.y);
    const wrap = new THREE.Group();
    model.rotation.y = opts.normalize.rotY ?? Math.PI;
    model.scale.setScalar(s);
    model.position.set(0, -box.min.y * s, 0);
    wrap.add(model); model = wrap;
  }
  scene.add(model);
  model.traverse(o => { if (o.isSkinnedMesh) { skinned.push(o); o.frustumCulled = false; } if (o.isMesh) o.frustumCulled = false; });
  mixer = new THREE.AnimationMixer(model);
  const summary = {
    errors: [...errors],
    meshes: [], skinnedMeshes: skinned.map(m => ({name: m.name, joints: m.skeleton.bones.map(b => b.name), vertices: m.geometry.attributes.position.count, triangles: (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3, material: m.material.name, map: m.material.map ? [m.material.map.image.width, m.material.map.image.height] : null, mr: m.material.metalnessMap ? [m.material.metalnessMap.image.width, m.material.metalnessMap.image.height] : null})),
    sharedSkeleton: skinned.length > 1 ? skinned.every(m => m.skeleton.bones.every((b, i) => b === skinned[0].skeleton.bones[i])) : null,
    clips: gltf.animations.map(c => ({name: c.name, duration: +c.duration.toFixed(4), tracks: c.tracks.length})),
  };
  model.traverse(o => { if (o.isMesh) summary.meshes.push(o.name); });
  return summary;
}

function setPose(clipName, t) {
  mixer.stopAllAction();
  for (const m of skinned) m.skeleton.pose();
  if (clipName) {
    const clip = gltf.animations.find(c => c.name === clipName);
    if (!clip) throw new Error('no clip ' + clipName);
    const a = mixer.clipAction(clip);
    a.reset(); a.setLoop(THREE.LoopOnce); a.clampWhenFinished = true; a.play();
    a.time = Math.min(t, clip.duration);
    mixer.update(0);
  }
  model.updateMatrixWorld(true);
}

// Distinct colour per joint for skin-weight visualisation.
const JOINT_COLORS = [0x888888, 0xff4444, 0xff9944, 0xffee44, 0x99ff44, 0x44ffcc, 0x4499ff, 0x2255ff, 0x9944ff, 0xff44cc, 0xcc2266, 0x772299, 0x44cc44, 0x228833, 0x115511, 0xccaa22, 0x886611, 0x553300];
const weightMats = new Map();
function weightMaterial(mesh) {
  if (weightMats.has(mesh)) return weightMats.get(mesh);
  const g = mesh.geometry, n = g.attributes.position.count;
  const col = new Float32Array(n * 3), J = g.attributes.skinIndex, W = g.attributes.skinWeight;
  const cols = JOINT_COLORS.map(c => new THREE.Color(c));
  for (let i = 0; i < n; i++) for (let k = 0; k < 4; k++) {
    const w = W.getComponent(i, k); if (!w) continue;
    const c = cols[J.getComponent(i, k) % cols.length];
    col[i * 3] += c.r * w; col[i * 3 + 1] += c.g * w; col[i * 3 + 2] += c.b * w;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const m = new THREE.MeshLambertMaterial({vertexColors: true});
  weightMats.set(mesh, m);
  return m;
}
const origMats = new Map();

function setVisibility(cell) {
  model.traverse(o => {
    if (!o.isMesh) return;
    if (o.name === 'ZombieCoat') o.visible = cell.coat !== false;
    if (o.name === 'ZombieBody') o.visible = cell.body !== false;
    if (!origMats.has(o)) origMats.set(o, o.material);
    o.material = cell.weights && o.isSkinnedMesh ? weightMaterial(o) : origMats.get(o);
    if (o.material) { o.material.wireframe = !!cell.wireframe; }
  });
  if (cell.skeleton && !skelHelper && skinned.length) {
    skelHelper = new THREE.SkeletonHelper(model);
    skelHelper.material.depthTest = false; skelHelper.material.linewidth = 2; skelHelper.renderOrder = 10;
    scene.add(skelHelper);
  }
  if (skelHelper) skelHelper.visible = !!cell.skeleton;
}

const VIEWS = {
  front: [0, 0, 1], back: [0, 0, -1], left: [1, 0, 0], right: [-1, 0, 0], side: [1, 0, 0],
  threequarter: [0.7, 0, 0.7], threequarterBack: [-0.7, 0, -0.7], top: [0, 1, 0.0001], low: [0.6, 0.25, 0.75],
};

function makeCamera(cell, w, h) {
  const f = cell.frame || {cx: 0, cy: 0.92, cz: 0, h: 2.0};
  const aspect = w / h;
  const half = f.h / 2;
  const cam = new THREE.OrthographicCamera(-half * aspect, half * aspect, half, -half, 0.01, 50);
  const d = new THREE.Vector3(...(VIEWS[cell.view] || VIEWS.front)).normalize();
  const target = new THREE.Vector3(f.cx, f.cy, f.cz ?? 0);
  cam.position.copy(target).addScaledVector(d, 10);
  if (cell.view === 'top') cam.up.set(0, 0, -1);
  cam.lookAt(target);
  cam.updateMatrixWorld(true);
  return cam;
}

function drawJointLabels(ctx, cam, x0, y0, w, h) {
  if (!skinned.length) return;
  ctx.font = '10px sans-serif';
  const v = new THREE.Vector3();
  for (const b of skinned[0].skeleton.bones) {
    b.getWorldPosition(v); v.project(cam);
    const px = x0 + (v.x * 0.5 + 0.5) * w, py = y0 + (-v.y * 0.5 + 0.5) * h;
    ctx.fillStyle = '#ff4'; ctx.beginPath(); ctx.arc(px, py, 3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.fillText(b.name, px + 4, py - 3);
  }
}

/** Render a labelled contact sheet; returns PNG data URL. */
function sheet(spec) {
  const cols = spec.cols || 4, w = spec.cellW || 400, h = spec.cellH || 500, lab = 22, top = spec.title ? 28 : 0;
  const rows = Math.ceil(spec.cells.length / cols);
  renderer.setPixelRatio(1); renderer.setSize(w, h, false);
  const out = document.createElement('canvas');
  out.width = cols * w; out.height = top + rows * (h + lab);
  const ctx = out.getContext('2d');
  ctx.fillStyle = '#16181b'; ctx.fillRect(0, 0, out.width, out.height);
  if (spec.title) { ctx.fillStyle = '#eee'; ctx.font = 'bold 15px sans-serif'; ctx.fillText(spec.title, 8, 19); }
  spec.cells.forEach((cell, i) => {
    const cx = (i % cols) * w, cy = top + Math.floor(i / cols) * (h + lab);
    setPose(cell.clip || null, cell.t || 0);
    setVisibility(cell);
    floor.visible = grid.visible = cell.floor !== false;
    const cam = makeCamera(cell, w, h);
    renderer.render(scene, cam);
    ctx.drawImage(renderer.domElement, cx, cy + lab);
    if (cell.jointLabels) drawJointLabels(ctx, cam, cx, cy + lab, w, h);
    ctx.fillStyle = '#ddd'; ctx.font = '13px sans-serif'; ctx.fillText(cell.label || '', cx + 6, cy + 16);
    ctx.strokeStyle = '#000'; ctx.strokeRect(cx + 0.5, cy + 0.5, w - 1, h + lab - 1);
  });
  return out.toDataURL('image/png');
}

/** Lowest skinned vertex (world y) for every mesh at a clip time, computed by three's own skinning. */
function minY(clipName, t, names = ['ZombieBody', 'ZombieCoat']) {
  setPose(clipName, t);
  const v = new THREE.Vector3();
  let min = Infinity, max = -Infinity;
  for (const m of skinned) {
    if (!names.includes(m.name)) continue;
    const n = m.geometry.attributes.position.count;
    for (let i = 0; i < n; i++) {
      m.getVertexPosition(i, v); v.applyMatrix4(m.matrixWorld);
      if (v.y < min) min = v.y; if (v.y > max) max = v.y;
    }
  }
  return {min, max};
}

/** Debug overlay: draw joint spheres + parent links from a plain {name:[x,y,z]} map. */
let overlay = null;
function overlayJoints(joints, parents, extra = {}) {
  if (overlay) scene.remove(overlay);
  overlay = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({color: 0xffee00, depthTest: false});
  const lmat = new THREE.LineBasicMaterial({color: 0x00ffcc, depthTest: false});
  for (const [name, p] of Object.entries({...joints, ...extra})) {
    const s = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 6), name in extra ? new THREE.MeshBasicMaterial({color: 0xff3366, depthTest: false}) : mat);
    s.position.set(...p); s.renderOrder = 20; overlay.add(s);
  }
  for (const [c, p] of Object.entries(parents)) {
    if (!p || !joints[c] || !joints[p]) continue;
    const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...joints[p]), new THREE.Vector3(...joints[c])]);
    const l = new THREE.Line(g, lmat); l.renderOrder = 21; overlay.add(l);
  }
  scene.add(overlay);
}

window.qa = {load, sheet, minY, overlayJoints, errors, ready: true};
