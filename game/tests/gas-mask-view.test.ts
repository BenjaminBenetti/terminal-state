// Task gas-mask-roof-feedback-20261030 (feedback item 4): the first-person gas-mask view (gear/maskView.ts) built from the REAL
// shipped outfit mask (assets/models/outfit-gasmask-t25.glb, mesh Outfit_gasmask__lastshift): the visor cut, the lens, the
// framing / depth against the viewmodel camera and held items, the don / doff / ADS pose, warm-up registration through the
// viewmodel's warm roots, no material / geometry / texture creation on Q, the GasMaskSystem hook-up, the removed CSS overlay,
// and small CPU renders of the actual view (tests/helpers/viewmodelRender.ts — an approximate software preview, NOT GPU evidence).
// MASK_PREVIEW=1 additionally writes full-size previews into qa-artifacts/gas-mask-view/ (MASK_PREVIEW_BG=<png> lays them over a
// game screenshot instead of the test card).
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import * as THREE from 'three';
import {GLTFLoader, type GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {NodeIO} from '@gltf-transform/core';
import {KHRMeshQuantization} from '@gltf-transform/extensions';
import sharp from 'sharp';
import {beforeAll, describe, expect, it} from 'vitest';
import {MASK_VIEW, MaskView, bakedMaskGeometry, coneRays, trianglesOnRays} from '../src/gear/maskView';
import {GAS_MASK_OUTFIT_MESH} from '../src/gear/models';
import {installGasMask} from '../src/gear/gasMask';
import {Viewmodel} from '../src/weapons/viewmodel';
import {WEAPONS} from '../src/weapons/weapons';
import {Inventory} from '../src/items/inventory';
import {WeaponController} from '../src/weapons/weapons';
import {MODEL_FILES} from '../src/assets/manifest';
import type {RunParticipant} from '../src/run/snapshot';
import type {Game} from '../src/game';
import {installCanvasShim} from './helpers/canvas2d';
import {installFakeDom} from './helpers/fakeDom';
import {renderOverlay, testCard} from './helpers/viewmodelRender';

installCanvasShim(false);

const GAME = fileURLToPath(new URL('..', import.meta.url));
const REPO = path.resolve(GAME, '..');
const pub = (url: string) => path.join(GAME, 'public', url);
const src = (rel: string) => fs.readFileSync(path.join(GAME, rel), 'utf8');

/** A GLB with its textures stripped (no DOM image decoding in Node); `baseColor` decoded with sharp onto every mesh when asked. */
async function loadGlb(url: string, withBaseColor = false): Promise<GLTF> {
  const io = new NodeIO().registerExtensions([KHRMeshQuantization]);
  const doc = await io.read(pub(url));
  let base: Uint8Array | null = null;
  for (const t of doc.getRoot().listTextures()) { if (/baseColor/i.test(t.getName())) base = t.getImage(); t.dispose(); }
  const bin = await io.writeBinary(doc);
  const gltf = await new Promise<GLTF>((res, rej) => new GLTFLoader().parse(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength) as ArrayBuffer, '', res, rej));
  if (withBaseColor && base) {
    const {data, info} = await sharp(Buffer.from(base)).ensureAlpha().raw().toBuffer({resolveWithObject: true});
    const tex = new THREE.DataTexture(new Uint8Array(data), info.width, info.height);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.flipY = false; // glTF
    gltf.scene.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) (m.material as THREE.MeshStandardMaterial).map = tex; });
  }
  return gltf;
}

const stub = {scene: new THREE.Group()} as unknown as GLTF;
const FWD = new THREE.Vector3(0, 0, -1);
/** Rays across the viewmodel camera's frustum at `aspect` (grid incl. the border), unit length. */
function frustumRays(aspect: number, nx = 33, ny = 19): {d: THREE.Vector3; border: boolean; fx: number; fy: number}[] {
  const tv = Math.tan(THREE.MathUtils.degToRad(54 / 2)), th = tv * aspect, out = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const fx = -1 + 2 * i / (nx - 1), fy = -1 + 2 * j / (ny - 1);
    out.push({d: new THREE.Vector3(fx * th, fy * tv, -1).normalize(), border: i === 0 || j === 0 || i === nx - 1 || j === ny - 1, fx, fy});
  }
  return out;
}
/** First-hit distance along `d` from `o` against `geo` (Infinity = none). */
function firstHit(geo: THREE.BufferGeometry, o: THREE.Vector3, d: THREE.Vector3): number {
  const ray = new THREE.Ray(o, d), P = geo.attributes.position, I = geo.index!;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), hit = new THREE.Vector3();
  let best = Infinity;
  for (let t = 0; t < I.count / 3; t++) {
    a.fromBufferAttribute(P, I.getX(t * 3)); b.fromBufferAttribute(P, I.getX(t * 3 + 1)); c.fromBufferAttribute(P, I.getX(t * 3 + 2));
    if (ray.intersectTriangle(a, b, c, false, hit)) best = Math.min(best, hit.distanceTo(o));
  }
  return best;
}

let outfit: GLTF;
let view: MaskView;
beforeAll(async () => {
  outfit = await loadGlb(MODEL_FILES.outfit_gasmask.url, true);
  view = new MaskView(outfit);
}, 120000);

describe('the derivative: built from the shipped outfit mask, visor glass cut out, lens from the inner glass sheet', () => {
  it('uses the real mesh (lastshift fit) and accounts for every source triangle; a few thousand triangles at most', () => {
    expect(MODEL_FILES.outfit_gasmask.url).toBe('assets/models/outfit-gasmask-t25.glb');
    expect(view.source).toBe('outfit');
    const baked = bakedMaskGeometry(outfit);
    const sourceTris = baked.index!.count / 3;
    expect(sourceTris).toBe(3000); // derivatives/outfit-gasmask.json mesh.triangles
    expect(baked.getAttribute('skinIndex')).toBeUndefined();
    const c = view.cut;
    expect(c.glassIslands).toBe(2); // the visor's outer and inner glass sheets
    expect(c.glassTriangles).toBeGreaterThan(300);
    expect(c.lensTriangles).toBeGreaterThan(150);
    expect(c.lensTriangles).toBeLessThan(c.glassTriangles); // one sheet of the two
    expect(c.strapTriangles).toBeGreaterThan(100); // buckles + crown strap behind the face seal
    expect(c.shellTriangles + c.glassTriangles + c.strapTriangles).toBe(sourceTris);
    const shellTris = view.shell.geometry.index!.count / 3, lensTris = view.lens.geometry.index!.count / 3;
    expect(shellTris).toBe(c.shellTriangles + 6); // + the cowl's 3 quads
    expect(c.cowlStart).toBe(c.shellTriangles * 3);
    expect(shellTris + lensTris).toBeLessThan(3200);
    // the eye sits behind the visor glass, centred across it
    expect(c.eye.z).toBeLessThan(c.glassZ - 0.08);
    expect(Math.abs(c.eye.x)).toBeLessThan(0.02);
    // the shell keeps the source mesh's own colour texture (shared, not copied) and UVs
    let srcMap: THREE.Texture | null = null;
    outfit.scene.traverse(o => { if ((o as THREE.Mesh).isMesh && o.name === GAS_MASK_OUTFIT_MESH) srcMap = ((o as THREE.Mesh).material as THREE.MeshStandardMaterial).map; });
    expect(srcMap).toBeTruthy();
    expect(view.shell.material.map).toBe(srcMap);
    expect(view.shell.geometry.getAttribute('uv')).toBeDefined();
  });

  it('visor cut: no shell triangle in the central view cone from the eye; the lens fills it', () => {
    const o = new THREE.Vector3();
    expect(trianglesOnRays(view.shell.geometry, o, coneRays(FWD, MASK_VIEW.clearConeDeg, 6, 32)).size).toBe(0);
    // before the cut the same cone is glass: the source mesh in the same eye frame is hit straight ahead
    const baked = bakedMaskGeometry(outfit).applyMatrix4(view.cut.toEye);
    expect(trianglesOnRays(baked, o, [FWD]).size).toBe(1);
    // the lens covers the whole central cone, facing the eye
    const lensHits = coneRays(FWD, MASK_VIEW.clearConeDeg, 6, 32).map(d => firstHit(view.lens.geometry, o, d));
    expect(lensHits.every(t => t < Infinity)).toBe(true);
    const n = new THREE.Vector3().fromBufferAttribute(view.lens.geometry.attributes.normal as THREE.BufferAttribute, 0);
    const p = new THREE.Vector3().fromBufferAttribute(view.lens.geometry.attributes.position as THREE.BufferAttribute, 0);
    expect(n.dot(p.clone().negate())).toBeGreaterThan(0);
  });

  it('interior frame at the edges: the rim / nose bridge / cowl cover the frustum border at 16:9; the middle stays open', () => {
    const o = new THREE.Vector3();
    for (const aspect of [16 / 9, 4 / 3]) {
      const rays = frustumRays(aspect);
      const hit = rays.map(r => ({...r, t: firstHit(view.shell.geometry, o, r.d)}));
      const border = hit.filter(r => r.border), inner = hit.filter(r => Math.abs(r.fx) < 0.4 && Math.abs(r.fy) < 0.34);
      const covered = border.filter(r => r.t < Infinity).length / border.length;
      expect(covered, `aspect ${aspect.toFixed(2)} border`).toBeGreaterThan(aspect > 1.5 ? 0.6 : 0.5);
      expect(inner.filter(r => r.t < Infinity).length, `aspect ${aspect.toFixed(2)} middle`).toBe(0);
      // the top edge and the nose bridge at the bottom centre are rubber
      expect(hit.filter(r => r.fy === 1).every(r => r.t < Infinity), 'top edge').toBe(true);
      expect(hit.find(r => r.fx === 0 && r.fy === -1)!.t, 'nose bridge').toBeLessThan(Infinity);
    }
  });

  it('depth: every visible part lies beyond the 1 cm near plane and in front of the rifle optic eyepiece, also at full ADS', () => {
    const relief = WEAPONS.rifle.view.optic!.eyeRelief;
    expect(relief).toBeCloseTo(0.105, 3);
    for (const aim of [0, 1]) {
      const o = new THREE.Vector3(0, 0, -MASK_VIEW.aimForward * MASK_VIEW.scale * aim); // the root moves toward the eye = the eye moves forward
      let near = Infinity, far = 0;
      for (const r of frustumRays(16 / 9, 25, 15)) for (const g of [view.shell.geometry, view.lens.geometry]) {
        const t = firstHit(g, o, r.d);
        if (t === Infinity) continue;
        const depth = t * -r.d.z;
        near = Math.min(near, depth);
        far = Math.max(far, depth);
      }
      expect(near, `aim ${aim}`).toBeGreaterThan(0.012);
      expect(far, `aim ${aim}`).toBeLessThan(relief * 0.9);
    }
  });

  it('the lens: transparent, no depth write, no shadows, drawn after the optic lens; clear in the middle, darker along the rim', () => {
    const m = view.lens.material;
    expect(m.transparent).toBe(true);
    expect(m.depthWrite).toBe(false);
    expect(m.depthTest).toBe(true);
    expect(view.lens.castShadow).toBe(false);
    expect(view.lens.receiveShadow).toBe(false);
    expect(view.lens.renderOrder).toBeGreaterThan(3); // weapons/optic.ts glass.renderOrder = 3
    expect(m.map).toBe(view.cut.lensMap);
    expect(m.emissiveMap).toBe(view.cut.glowMap);
    expect(m.map!.colorSpace).toBe(THREE.SRGBColorSpace);
    const img = view.cut.lensMap.image as {data: Uint8Array; width: number; height: number};
    const alpha = (u: number, v: number) => img.data[(Math.floor(v * (img.height - 1)) * img.width + Math.floor(u * (img.width - 1))) * 4 + 3] / 255;
    expect(alpha(0.5, 0.6)).toBeLessThan(0.08); // straight ahead: a faint tint only
    expect(alpha(0.5, 0.98)).toBeGreaterThan(0.3); // top rim band
    expect(alpha(0.02, 0.5)).toBeGreaterThan(0.3); // side rim band
    // the shell: double-sided matte rubber with the seal-to-visor shade, never shadowed
    const s = view.shell.material;
    expect(s.side).toBe(THREE.DoubleSide);
    expect(s.vertexColors).toBe(true);
    expect(s.metalness).toBe(0);
    expect(s.transparent).toBe(false);
    expect(view.shell.castShadow).toBe(false);
    const col = view.shell.geometry.getAttribute('color');
    let lo = 1, hi = 0;
    for (let i = 0; i < col.count - 12; i++) { lo = Math.min(lo, col.getX(i)); hi = Math.max(hi, col.getX(i)); } // (the cowl's 12 vertices last)
    expect(lo).toBeLessThan(0.45);
    expect(hi).toBeGreaterThan(0.95);
  });

  it('provenance flags of the source model are unchanged (accepted delivery, not approved / game-ready / cleared)', () => {
    const rec = JSON.parse(fs.readFileSync(pub('assets/derivatives/outfit-gasmask.json'), 'utf8'));
    expect(rec.status).toMatchObject({approved: false, gameReady: false});
    expect(rec.status.licenseClearance).toMatch(/^none/);
    expect(rec.t25.source.review).toBe('accepted');
    const header = src('src/gear/maskView.ts');
    expect(header).toMatch(/approved: false, gameReady: false\s*\/\/\s*and no licence clearance/);
    expect(header).toMatch(/nothing new is generated/);
  });

  it('a missing outfit mesh falls back to a small procedural frame + lens (same API)', () => {
    const p = new MaskView(null);
    expect(p.source).toBe('procedural');
    p.set(1, 'ok');
    expect(p.root.visible).toBe(true);
    expect(trianglesOnRays(p.shell.geometry, new THREE.Vector3(), [FWD]).size).toBe(0);
    expect(trianglesOnRays(p.lens.geometry, new THREE.Vector3(), [FWD]).size).toBe(1);
    const broken = new MaskView({scene: new THREE.Group()});
    expect(broken.source).toBe('procedural');
  });
});

describe('runtime: cover / ADS / tone pose, the viewmodel face root and warm-up, no creation on Q', () => {
  it('hidden at cover 0; placed at cover 1; comes up from below / in front, tipped; the cowl only on the face; ADS moves the eye toward the glass', () => {
    const v = new MaskView(outfit);
    expect(v.root.visible).toBe(false);
    v.set(0, 'ok');
    expect(v.root.visible).toBe(false);
    v.set(1, 'ok');
    expect(v.root.visible).toBe(true);
    expect(v.root.position.length()).toBeLessThan(1e-9);
    expect(v.root.rotation.x).toBeCloseTo(0, 9);
    expect(v.shell.geometry.drawRange.count).toBe(Infinity);
    v.set(0.5, 'ok');
    expect(v.root.position.y).toBeLessThan(-0.003);
    expect(v.root.position.z).toBeLessThan(-0.001);
    expect(v.root.rotation.x).toBeGreaterThan(0.05);
    expect(v.shell.geometry.drawRange.count).toBe(v.cut.cowlStart);
    v.set(0.25, 'ok');
    const lower = v.root.position.y;
    v.set(0.75, 'ok');
    expect(v.root.position.y).toBeGreaterThan(lower); // monotonic rise onto the face
    v.set(1, 'ok');
    v.update(1 / 60, 1);
    expect(v.root.position.z).toBeCloseTo(MASK_VIEW.aimForward * MASK_VIEW.scale, 9);
    expect(v.lens.material.opacity).toBeCloseTo(1 - MASK_VIEW.aimLensClear, 9);
    v.update(1 / 60, 0);
    expect(v.root.position.z).toBeCloseTo(0, 9);
    expect(v.lens.material.opacity).toBe(1);
  });

  it('filter tone: no glow when ok; amber when low; a red pulse when empty (emissive uniforms only)', () => {
    const v = new MaskView(outfit);
    v.set(1, 'ok');
    expect(v.lens.material.emissive.getHex()).toBe(0);
    v.set(1, 'low');
    expect(v.lens.material.emissive.r).toBeGreaterThan(v.lens.material.emissive.b * 3);
    expect(v.lens.material.emissiveIntensity).toBeCloseTo(MASK_VIEW.lowGlow, 9);
    v.set(1, 'empty');
    const seen = new Set<number>();
    for (let i = 0; i < 60; i++) { v.update(1 / 30, 0); seen.add(+v.lens.material.emissiveIntensity.toFixed(3)); }
    expect(seen.size).toBeGreaterThan(5);
    expect(Math.max(...seen)).toBeLessThanOrEqual(MASK_VIEW.emptyGlow + 1e-9);
    expect(v.lens.material.emissive.r).toBeGreaterThan(v.lens.material.emissive.g * 5);
  });

  it('no material, geometry, texture or light is created and no material recompiles while toggling; the scene graph is unchanged', () => {
    const vm = new Viewmodel({rifle: stub, shotgun: stub}, {});
    const v = new MaskView(outfit);
    vm.addFaceRoot(v.root);
    const ids = () => {
      const m = new THREE.MeshBasicMaterial(), g = new THREE.BufferGeometry(), t = new THREE.Texture();
      const out = {m: (m as unknown as {id: number}).id, g: g.id, t: t.id}; // (three's typings hide Material.id; it is the global counter)
      m.dispose(); g.dispose(); t.dispose();
      return out;
    };
    const objects = () => { const list: THREE.Object3D[] = []; vm.scene.traverse(o => list.push(o)); return list; };
    const before = ids(), graph = objects();
    const versions = [v.shell.material.version, v.lens.material.version];
    const geos = [v.shell.geometry, v.lens.geometry], mats = [v.shell.material, v.lens.material];
    for (let i = 0; i <= 40; i++) {
      v.set(i / 40, (['ok', 'low', 'empty'] as const)[i % 3]);
      v.update(1 / 60, (i % 7) / 6);
    }
    for (let i = 40; i >= 0; i--) v.set(i / 40, 'ok');
    const after = ids();
    expect(after.m - before.m).toBe(1); // only the probe material itself
    expect(after.g - before.g).toBe(1);
    expect(after.t - before.t).toBe(1);
    expect([v.shell.material.version, v.lens.material.version]).toEqual(versions);
    expect([v.shell.geometry, v.lens.geometry]).toEqual(geos);
    expect([v.shell.material, v.lens.material]).toEqual(mats);
    expect(objects()).toEqual(graph);
  });

  it('the viewmodel face root: under the camera (not the held-item pivot), one of warmRoots(); compiled with the pass while hidden', () => {
    const vm = new Viewmodel({rifle: stub, shotgun: stub}, {});
    const v = new MaskView(outfit);
    vm.addFaceRoot(v.root);
    vm.addFaceRoot(v.root); // once
    expect(v.root.parent).toBe(vm.camera);
    expect(vm.warmRoots().filter(r => r === v.root)).toHaveLength(1);
    // what render/warmup.ts does for a registered pass: every renderable in the pass scene + the hidden roots visible for the call
    expect(v.root.visible).toBe(false);
    const hidden = vm.warmRoots();
    const prev = hidden.map(o => o.visible);
    for (const o of hidden) o.visible = true;
    const compiled: THREE.Mesh[] = [];
    vm.scene.traverseVisible(o => { if ((o as THREE.Mesh).isMesh) compiled.push(o as THREE.Mesh); });
    hidden.forEach((o, i) => { o.visible = prev[i]; });
    expect(compiled).toContain(v.shell);
    expect(compiled).toContain(v.lens);
    expect(v.root.visible).toBe(false);
    // the held-item pose never moves it: holster / equip / aim change the pivot only
    vm.setHolstered(1);
    vm.update(0.1, {moving: 1, sprint: true, aiming: false, lookDX: 30, lookDY: 10, reloading: false, reloadProgress: 0, using: false, useProgress: 0, bobT: 1});
    v.set(1, 'ok');
    expect(v.root.position.length()).toBeLessThan(1e-9);
  });

  it('game.ts attaches it in load(): after the viewmodel pass is registered, before the renderer init / warm-up; aim = the ADS blend', () => {
    const g = src('src/game.ts');
    const pass = g.indexOf("addPass({name: 'weapons and held items'");
    const attach = g.indexOf('this.gasMask.attachView(new MaskView(m.outfit_gasmask), vm, () => vm.aimBlend)');
    const init = g.indexOf('await this.initRenderer(); // Iteration 13 (CORE): the icon renders');
    expect(pass).toBeGreaterThan(0);
    expect(attach).toBeGreaterThan(pass);
    expect(init).toBeGreaterThan(attach);
    // the old CSS / SVG overlay is gone
    expect(fs.existsSync(path.join(GAME, 'src/ui/maskOverlay.ts'))).toBe(false);
    expect(src('src/gear/gasMask.ts')).not.toMatch(/maskOverlay|MaskOverlay/);
  });
});

describe('GasMaskSystem drives the view (Q don / doff timing, lifecycle cancel, tone); no DOM camera layer any more', () => {
  function shell() {
    const g = {
      scene: new THREE.Scene(), frameHooks: [] as ((dt: number) => void)[], sectionHooks: [] as {build?(l: unknown): void; teardown?(): void}[],
      stateListeners: [] as ((s: string, prev: string) => void)[], inputOwners: [] as (() => boolean)[], runParticipants: [] as RunParticipant[],
      invUI: {gear: {dropBag: () => null as string | null, changed: () => {}}},
      warmRegistry: {addPool: () => {}},
      inv: new Inventory(), weapon: new WeaponController(), gear: {readied: false, viewOpen: false, holdProgress: null}, state: 'playing', player: {alive: true},
      hud: {toast: () => {}, setMask: () => {}}, sfx: {denied() {}, batteryInsert() {}, maskRustle() {}},
    };
    const sys = installGasMask(g as unknown as Game, {cancelUse: () => {}, cancelFlareHold: () => {}});
    const step = (seconds: number, dt = 1 / 60) => { for (let i = 0; i < Math.round(seconds / dt); i++) for (const f of g.frameHooks) f(dt); };
    const setState = (s: string) => { const prev = g.state; g.state = s; for (const f of g.stateListeners) f(s, prev); };
    return {g, sys, step, setState};
  }

  it('donning raises it over 0.6 s, doffing lowers it over 0.45 s; a cancelled transition hides it; tone reaches the lens; ADS from the host', () => {
    const dom = installFakeDom();
    try {
      const s = shell();
      const v = new MaskView(outfit);
      const host = {roots: [] as THREE.Object3D[], addFaceRoot(r: THREE.Object3D) { this.roots.push(r); }};
      let aim = 0;
      s.sys.attachView(v, host, () => aim);
      expect(host.roots).toEqual([v.root]);
      expect(s.sys.maskView).toBe(v);
      expect(v.root.visible).toBe(false);
      const m = s.g.inv.makeStack('gas_mask', 1);
      m.filter = 0.15 * 150;
      expect(s.g.inv.add(m)).toBe(0);
      expect(s.sys.press()).toBe('donning');
      s.step(0.3);
      expect(v.shown).toBeGreaterThan(0.3);
      expect(v.shown).toBeLessThan(0.7);
      expect(v.root.visible).toBe(true);
      expect(s.sys.protects()).toBe(false); // unchanged gameplay: unprotected until fully on
      s.step(0.35);
      expect(v.shown).toBe(1);
      expect(s.sys.protects()).toBe(true);
      expect(v.tone).toBe('low');
      aim = 1;
      s.step(1 / 60);
      expect(v.aim).toBe(1);
      aim = 0;
      expect(s.sys.press()).toBe('doffing');
      s.step(0.2);
      expect(v.shown).toBeGreaterThan(0.3);
      expect(v.shown).toBeLessThan(1);
      s.step(0.3);
      expect(v.shown).toBe(0);
      expect(v.root.visible).toBe(false);
      expect(v.tone).toBe('ok'); // off the face: no warning glow
      // a running transition cancelled by a state change (pause / death / travel) ends OFF and hidden
      s.sys.press();
      s.step(0.2);
      s.setState('paused');
      expect(s.sys.state).toBe('off');
      expect(v.root.visible).toBe(false);
      expect(s.sys.qa().overlay).toBe(0);
      // Retry restoring an on-face mask shows it at once
      s.setState('playing');
      s.sys.restore(true);
      expect(v.shown).toBe(1);
      // no DOM camera layer is created any more
      expect(dom.el('#hud').children.filter(c => c.id === 'mask-view')).toHaveLength(0);
    } finally {
      dom.uninstall();
    }
  });
});

describe('CPU render of the actual view (approximate software preview; not GPU evidence)', () => {
  const W = 192, H = 108;
  const grey = () => new Float32Array(W * H * 3).fill(0.5);
  function frame(cover: number, aim = 0) {
    const vm = new Viewmodel({rifle: stub, shotgun: stub}, {});
    const v = new MaskView(outfit);
    vm.addFaceRoot(v.root);
    vm.setAspect(W / H);
    vm.setLightLevel(0.3);
    v.set(cover, 'ok');
    v.update(0, aim);
    return renderOverlay(vm.scene, vm.camera, {width: W, height: H, background: grey()});
  }
  const mean = (a: Float32Array, x0: number, y0: number, x1: number, y1: number) => {
    let s = 0, n = 0;
    for (let y = Math.floor(y0 * H); y < Math.ceil(y1 * H); y++) for (let x = Math.floor(x0 * W); x < Math.ceil(x1 * W); x++) { s += a[y * W + x]; n++; }
    return s / n;
  };

  it('cover 1 at 16:9: the middle is only faintly tinted, the top rim and the nose bridge are opaque rubber, the corners are covered', () => {
    const r = frame(1);
    expect(r.skipped).toEqual([]);
    expect(mean(r.alpha, 0.35, 0.3, 0.65, 0.6)).toBeLessThan(0.12);
    expect(mean(r.alpha, 0.3, 0, 0.7, 0.05)).toBeGreaterThan(0.95);
    expect(mean(r.alpha, 0.47, 0.8, 0.53, 0.9)).toBeGreaterThan(0.95); // the nose bridge
    for (const [x0, y0] of [[0, 0], [0.95, 0]]) expect(mean(r.alpha, x0, y0, x0 + 0.05, y0 + 0.05), `top corner ${x0}`).toBeGreaterThan(0.9);
    for (const [x0, y0] of [[0, 0.95], [0.95, 0.95]]) expect(mean(r.alpha, x0, y0, x0 + 0.05, y0 + 0.05), `bottom corner ${x0}`).toBeGreaterThan(0.4); // cheeks (the visor dips low on one side)
    // the rubber is dark but not a black void: some texture / light on it
    let lum = 0, n = 0;
    for (let k = 0; k < W * H; k++) if (r.alpha[k] > 0.99) { lum += (r.rgb[k * 3] + r.rgb[k * 3 + 1] + r.rgb[k * 3 + 2]) / 3; n++; }
    expect(lum / n).toBeGreaterThan(6);
    expect(lum / n).toBeLessThan(70);
  });

  it('cover 0 draws nothing; mid-transition it covers the lower view only; full ADS opens the frame further', () => {
    expect(Math.max(...frame(0).alpha)).toBe(0);
    const half = frame(0.5);
    expect(mean(half.alpha, 0, 0.9, 1, 1)).toBeGreaterThan(0.6);
    const hip = frame(1), ads = frame(1, 1);
    const covered = (a: Float32Array) => a.reduce((s, x) => s + (x > 0.9 ? 1 : 0), 0) / a.length;
    expect(covered(ads.alpha)).toBeLessThan(covered(hip.alpha));
    expect(mean(ads.alpha, 0.35, 0.3, 0.65, 0.6)).toBeLessThan(0.08);
  });
});

describe.runIf(!!process.env.MASK_PREVIEW)('CPU previews into qa-artifacts/gas-mask-view (MASK_PREVIEW=1)', () => {
  it('renders the view at 960x540, 1280x720 and 960x720 (cover, transition, ADS with the rifle optic, tones, dark)', async () => {
    const out = path.join(REPO, 'qa-artifacts', 'gas-mask-view');
    fs.mkdirSync(out, {recursive: true});
    const rifle = await loadGlb(MODEL_FILES.rifle.url), pistol = await loadGlb(MODEL_FILES.pistol.url);
    const vm = new Viewmodel({rifle, shotgun: stub, pistol}, {});
    const v = new MaskView(outfit);
    vm.addFaceRoot(v.root);
    const bgFile = process.env.MASK_PREVIEW_BG;
    const cases: {name: string; W: number; H: number; cover: number; aim?: number; gun?: string; tone?: 'ok' | 'low' | 'empty'; light?: number}[] = [
      {name: '960x540-on', W: 960, H: 540, cover: 1},
      {name: '1280x720-on', W: 1280, H: 720, cover: 1},
      {name: '960x720-on', W: 960, H: 720, cover: 1},
      {name: '960x540-donning-50', W: 960, H: 540, cover: 0.5},
      {name: '960x540-donning-25', W: 960, H: 540, cover: 0.25},
      {name: '960x540-pistol-hip', W: 960, H: 540, cover: 1, gun: 'pistol'},
      {name: '960x540-pistol-ads', W: 960, H: 540, cover: 1, aim: 1, gun: 'pistol'},
      {name: '960x540-rifle-hip', W: 960, H: 540, cover: 1, gun: 'rifle'},
      {name: '960x540-rifle-ads-optic', W: 960, H: 540, cover: 1, aim: 1, gun: 'rifle'},
      {name: '960x540-filter-low', W: 960, H: 540, cover: 1, tone: 'low'},
      {name: '960x540-filter-empty', W: 960, H: 540, cover: 1, tone: 'empty'},
      {name: '960x540-dark-room', W: 960, H: 540, cover: 1, light: 0.03},
      {name: '960x540-bright-room', W: 960, H: 540, cover: 1, light: 0.9},
    ];
    for (const c of cases) {
      vm.setAspect(c.W / c.H);
      vm.setLightLevel(c.light ?? 0.3);
      vm.setItem(c.gun ?? null);
      if (c.gun) for (let i = 0; i < 90; i++) vm.update(1 / 60, {moving: 0, sprint: false, aiming: !!c.aim, lookDX: 0, lookDY: 0, reloading: false, reloadProgress: 0, using: false, useProgress: 0, bobT: 0});
      v.set(c.cover, c.tone ?? 'ok');
      v.update(0, c.aim ?? 0);
      let background: Float32Array;
      if (bgFile && fs.existsSync(bgFile)) {
        const {data} = await sharp(bgFile).resize(c.W, c.H, {fit: 'fill'}).removeAlpha().raw().toBuffer({resolveWithObject: true});
        background = Float32Array.from(data, x => x / 255);
      } else background = testCard(c.W, c.H);
      const r = renderOverlay(vm.scene, vm.camera, {width: c.W, height: c.H, background});
      await sharp(r.rgb, {raw: {width: c.W, height: c.H, channels: 3}}).png().toFile(path.join(out, `${c.name}.png`));
    }
    expect(fs.existsSync(path.join(out, '960x540-on.png'))).toBe(true);
  }, 300000);
});
