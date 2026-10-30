// Task studio-model-touchups-20261030-01 (lane GLASS). User (verbatim): "The fridge cabinent things with glass doors found in shops,
// become hard to see in to when your flash light is on and your standing close, they sorta become almost opaque".
//
// Root cause (two parts, both pinned here):
//  1. Aiming at a glazed openable (drinks cooler, fire-extinguisher cabinet) TAKES IT OVER (world/openables.ts takeover: its own
//     meshes replace the closed instance while it is aimed at, i.e. exactly when the player stands within reach). The own meshes
//     copied the shadow flags of the FIRST closed-part instance (the opaque door frame) onto every mesh, so the transparent glass
//     pane became a flashlight shadow caster: render/volumetric.ts markShadows never marks a transparent material, but three
//     r186 rasterises any castShadow mesh into the spot shadow map. Everything behind the closed glass (shelves, liner, stock,
//     loot) fell into the torch's shadow while the pane itself stayed lit by it.
//  2. The open-front hybrids' glass (open-front-iteration05.mjs, rebuilt on T2.5) was a near-white Lambert film: base colour
//     (0.8, 0.88, 0.9) at alpha 0.14 = 12 % diffuse reflectance. Under a torch 0.5 m away its lit veil outshone dark labels
//     2-3x even with the stock lit (with 1. it outshone everything behind 15-170x: a light-grey sheet, review/glass-numbers.txt).
//     Clear glass has almost no diffuse reflection; the repaired film is a dark
//     grime tint (base ~0.1, alpha 0.2: ~2 % haze, 80 % transmission) with the same GGX gloss (reflections), in NEW
//     cache-busting files *-t25r1.glb (provenance: localRepair, not new Meshy output). The countertop display case shares (2).
// The CPU numbers below mirror three r186's direct lighting (decay / spot attenuation, Lambert x (1 - F), GGX ignored for the
// veil: it is a highlight, not a veil) for the close view; the browser spot check is the primary's.
import {beforeAll, describe, expect, it} from 'vitest';
import * as THREE from 'three';
import {GLTFLoader, type GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {NodeIO} from '@gltf-transform/core';
import {fileURLToPath} from 'node:url';
import {installCanvasShim, ShimContext} from './helpers/canvas2d';
import {fakeEnvTextures, openableModels, rowLayout} from './helpers/openablesFixture';
import {MODEL_FILES} from '../src/assets/manifest';
import {P7_FILES} from '../src/gen/props07';
import {PROP_DEFS} from '../src/gen/props';
import {Inventory} from '../src/items/inventory';
import {WorldMaterials} from '../src/world/materials';
import {ContainerManager, type Holder} from '../src/world/containers';
import {OPENABLE_SPECS} from '../src/world/openablesSpec';
import {markShadows} from '../src/render/volumetric';
import {BEAM} from '../src/player/flashlight';
import {MOOD} from '../src/world/lights';

installCanvasShim(false);
(ShimContext.prototype as unknown as {clip?: () => void}).clip ??= () => {};

const pub = (rel: string) => fileURLToPath(new URL('../public/' + rel, import.meta.url));
/** Every glazed open-front hybrid the game loads (live registries). */
const GLAZED = {
  shopCooler: MODEL_FILES.shopCooler.url,
  shopDisplay: MODEL_FILES.shopDisplay.url,
  fireExtinguisherCabinet: P7_FILES.p7_fireExtinguisherCabinet.url,
} as const;
const lum = (c: readonly number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

interface GlassFacts { name: string; node: string; base: number[]; rough: number; metal: number; doubleSided: boolean; textured: boolean; blendCount: number; window: THREE.Box3 }
const facts = new Map<string, GlassFacts>();
beforeAll(async () => {
  for (const [k, url] of Object.entries(GLAZED)) {
    const doc = await new NodeIO().read(pub(url));
    const blend = doc.getRoot().listMaterials().filter(m => m.getAlphaMode() === 'BLEND');
    const node = doc.getRoot().listNodes().find(n => n.getMesh()?.listPrimitives().some(p => blend.includes(p.getMaterial()!)));
    const m = blend[0];
    const box = new THREE.Box3();
    for (const p of node?.getMesh()?.listPrimitives() ?? []) { const a = p.getAttribute('POSITION')!; for (let i = 0; i < a.getCount(); i++) box.expandByPoint(new THREE.Vector3().fromArray(a.getElement(i, [0, 0, 0]))); }
    facts.set(k, {name: m?.getName() ?? '', node: node?.getName() ?? '', base: m?.getBaseColorFactor() ?? [], rough: m?.getRoughnessFactor() ?? -1, metal: m?.getMetallicFactor() ?? -1,
      doubleSided: !!m?.getDoubleSided(), textured: !!(m?.getBaseColorTexture() || m?.getEmissiveTexture()), blendCount: blend.length, window: box});
  }
}, 60000);

describe('shop glass: material contract of the glazed hybrids', () => {
  it('one transparent, untextured, glossy, DARK-film glass material on the glass node (repaired *-t25r1 files)', () => {
    for (const [k, f] of facts) {
      expect(GLAZED[k as keyof typeof GLAZED], k).toMatch(/-t25r1\.glb$/); // the local repair ships under a new cache-busting path
      expect(f.blendCount, k).toBe(1);
      expect(f.node, k).toBe('glass');
      expect(f.name, k).toMatch(/-open-glass$/);
      expect(f.textured, `${k}: no baked picture / glare texture on the glass`).toBe(false);
      expect(f.doubleSided, k).toBe(true);
      const a = f.base[3], rho = lum(f.base.slice(0, 3));
      // transparency: 70-85 % of the light behind passes (a cooler door is double glazed, slightly tinted)
      expect(a, k).toBeGreaterThanOrEqual(0.15);
      expect(a, k).toBeLessThanOrEqual(0.3);
      // the film's own diffuse reflectance a * rho (the lit veil): <= 3 % (the white film was 12 %); still a visible grime tint
      expect(a * rho, k).toBeLessThanOrEqual(0.03);
      expect(a * rho, k).toBeGreaterThan(0.005);
      expect(rho, `${k}: a dark grime film, not a white diffuser`).toBeLessThanOrEqual(0.15);
      // glossy dielectric (F0 0.04): the reflections / torch glint stay; never metallic or matte
      expect(f.rough, k).toBeLessThanOrEqual(0.12);
      expect(f.metal, k).toBe(0);
    }
  });

  it('after GLTFLoader the pane is transparent and never writes depth; nothing opaque is left in the window in front of the interior', async () => {
    for (const [k, url] of Object.entries(GLAZED)) {
      const io = new NodeIO(), doc = await io.read(pub(url));
      for (const t of doc.getRoot().listTextures()) t.dispose();
      const bin = await io.writeBinary(doc);
      const g = await new Promise<GLTF>((res, rej) => new GLTFLoader().parse(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength) as ArrayBuffer, '', res, rej));
      g.scene.updateMatrixWorld(true);
      const meshes: THREE.Mesh[] = [];
      g.scene.traverse(o => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
      const glass = meshes.filter(m => (m.material as THREE.Material).transparent);
      expect(glass.length, k).toBe(1);
      const gm = glass[0].material as THREE.MeshStandardMaterial;
      expect(gm.depthWrite, k).toBe(false);
      expect(gm.opacity, k).toBeCloseTo(facts.get(k)!.base[3], 5);
      // ray-cast straight through the front window (front pane for the display case): the glass first, then only the interior / far
      // side — no opaque face within 4 cm behind the pane (a painted / baked pane or backing would sit there)
      const w = facts.get(k)!.window, front = w.max.z;
      const rc = new THREE.Raycaster();
      for (const fx of [0.2, 0.5, 0.8]) for (const fy of [0.2, 0.5, 0.8]) {
        const o = new THREE.Vector3(THREE.MathUtils.lerp(w.min.x, w.max.x, fx), THREE.MathUtils.lerp(w.min.y, w.max.y, fy), front + 1);
        rc.set(o, new THREE.Vector3(0, 0, -1));
        const hits = rc.intersectObjects(meshes, false);
        expect(hits.length, k).toBeGreaterThan(0);
        expect((hits[0].object as THREE.Mesh).material, `${k}: the glass is the first surface in the window`).toBe(gm);
        const next = hits.find(h => h.object !== glass[0]); // (none: the ray leaves through the far pane between the trays)
        if (next) expect(next.distance - hits[0].distance, `${k}: nothing opaque right behind the pane`).toBeGreaterThan(0.04);
      }
    }
  });
});

// --- flashlight shadow pass emulation (as tests/container-flashlight.test.ts) ----------------------------------------------------
const FLIP: Record<THREE.Side, THREE.Side> = {[THREE.FrontSide]: THREE.BackSide, [THREE.BackSide]: THREE.FrontSide, [THREE.DoubleSide]: THREE.DoubleSide};
const proxies = new Map<THREE.Side, THREE.MeshBasicMaterial>();
/**
 * First surface a pass draws on the segment: 'shadow' = castShadow meshes with three r186's shadow side rule
 * (`shadowSide ?? flip(side)`); 'colour' = what the eye sees (material side; transparent glass does not hide what is behind it).
 */
function firstHit(root: THREE.Object3D, pass: 'colour' | 'shadow', from: THREE.Vector3, to: THREE.Vector3): {t: number; mesh: THREE.Mesh | null} {
  const d = to.clone().sub(from), dist = d.length();
  const rc = new THREE.Raycaster(from, d.normalize(), 0, dist);
  let best = {t: Infinity, mesh: null as THREE.Mesh | null};
  root.traverseVisible(o => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || (pass === 'shadow' ? !m.castShadow : (m.material as THREE.Material).transparent)) return;
    const saved = m.material as THREE.Material, s = pass === 'shadow' ? saved.shadowSide ?? FLIP[saved.side] : saved.side;
    let p = proxies.get(s);
    if (!p) proxies.set(s, (p = new THREE.MeshBasicMaterial({side: s})));
    m.material = p;
    try { const h = rc.intersectObject(m, false)[0]; if (h && h.distance < best.t) best = {t: h.distance, mesh: m}; } finally { m.material = saved; }
  });
  return best;
}
/** game.ts flashlight: camera-local (0.2, -0.15, 0.1) from the eye. */
function torchAt(eye: THREE.Vector3, look: THREE.Vector3): THREE.Vector3 {
  const fwd = look.clone().sub(eye).normalize(), right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
  const up = new THREE.Vector3().crossVectors(right, fwd).normalize();
  return eye.clone().addScaledVector(right, 0.2).addScaledVector(up, -0.15).addScaledVector(fwd, -0.1);
}

describe('shop glass: aimed at (taken over), the closed glass door does not shadow what is behind it', () => {
  const mats = new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17});
  let models: Record<string, GLTF> = {};
  beforeAll(async () => { models = await openableModels(); }, 120000);
  const KINDS = ['shopCooler', 'fireExtinguisherCabinet'] as const;
  /**
   * What the eye sees through the closed glass (a 5 x 5 fan of view rays across the pane: the first opaque surface behind it) and
   * whether the torch reaches it: the shadow pass's first caster lies at that surface (1.5 cm: its own face, as the pass bias).
   */
  function seenLit(cm: ContainerManager, h: Holder, eye: THREE.Vector3, torch: THREE.Vector3): {seen: number; lit: number; blockers: string[]} {
    const w = facts.get(h.kind)!.window, blockers = new Set<string>();
    let seen = 0, lit = 0;
    for (const fx of [0.1, 0.3, 0.5, 0.7, 0.9]) for (const fy of [0.1, 0.3, 0.5, 0.7, 0.9]) {
      const onPane = new THREE.Vector3(THREE.MathUtils.lerp(w.min.x, w.max.x, fx), THREE.MathUtils.lerp(w.min.y, w.max.y, fy), w.max.z).applyMatrix4(h.matrix);
      const far = eye.clone().add(onPane.clone().sub(eye).multiplyScalar(4));
      const vis = firstHit(cm.group, 'colour', eye, far);
      if (!vis.mesh || vis.t < eye.distanceTo(onPane)) continue; // the frame / bezel in front of the pane, not through it
      const p = eye.clone().add(far.clone().sub(eye).normalize().multiplyScalar(vis.t));
      seen++;
      const occ = firstHit(cm.group, 'shadow', torch, p);
      if (occ.t >= torch.distanceTo(p) - 0.015) lit++;
      else if (occ.mesh) blockers.add(`${occ.mesh.name || occ.mesh.parent?.name}/${((occ.mesh.userData.baseMat ?? occ.mesh.material) as THREE.Material).name}`);
    }
    return {seen, lit, blockers: [...blockers]};
  }

  function setup() {
    const cm = new ContainerManager(models, mats, () => new Inventory());
    const layout = rowLayout(KINDS, {seed: 5, gap: 1.6});
    cm.build(layout);
    markShadows(cm.group, true, true); // as game.ts newStation (surface shadows on)
    return {cm, layout};
  }
  /** Stand 0.6 m in front of the glass (eye height 1.62 m, or level with a wall cabinet) and aim at it: the holder is taken over. */
  function aim(cm: ContainerManager, layout: ReturnType<typeof rowLayout>, h: Holder) {
    const w = facts.get(h.kind)!.window, c = w.getCenter(new THREE.Vector3());
    const look = c.clone().applyMatrix4(h.matrix);
    const eye = new THREE.Vector3(c.x + 0.05, 0, w.max.z + 0.6).applyMatrix4(h.matrix);
    eye.y = h.kind === 'shopCooler' ? 1.62 : look.y + 0.25;
    const t = cm.target(eye, look.clone().sub(eye).normalize(), layout.grid);
    return {eye, look, target: t};
  }

  it('the glass own mesh is never a shadow caster; the door frame still is; the stock space behind it stays lit', () => {
    const {cm, layout} = setup();
    for (const kind of KINDS) {
      const h = cm.all.find(x => x.kind === kind)!;
      if (kind === 'shopCooler') expect(OPENABLE_SPECS[kind].parts[0].glass, kind).toBe(true); // loot seen through it (the cabinet only shows its extinguisher)
      const {eye, look, target} = aim(cm, layout, h);
      expect(target?.container, `${kind}: aimed at within reach`).toBe(h);
      expect(h.open!.root, `${kind}: taken over while aimed at`).toBeTruthy();
      const own: THREE.Mesh[] = [];
      h.open!.root!.traverse(o => { if ((o as THREE.Mesh).isMesh) own.push(o as THREE.Mesh); });
      const base = (m: THREE.Mesh) => ((m.userData.baseMat as THREE.Material | undefined) ?? m.material) as THREE.Material;
      const glass = own.filter(m => base(m).transparent), opaque = own.filter(m => !base(m).transparent);
      expect(glass.length, kind).toBeGreaterThan(0);
      for (const m of glass) expect(m.castShadow, `${kind}: glass own mesh casts the flashlight shadow`).toBe(false);
      expect(opaque.some(m => m.castShadow), `${kind}: the door frame still casts`).toBe(true);
      // what is seen through the closed glass is reached by the torch (shelf rods / lips may shade a few points)
      const torch = torchAt(eye, look);
      const r = seenLit(cm, h, eye, torch);
      console.log(`${kind} (aimed, closed glass): ${r.lit}/${r.seen} surfaces seen through the glass lit by the torch${r.blockers.length ? ` (shaded by ${r.blockers.join(', ')})` : ''}`);
      expect(r.seen, kind).toBeGreaterThanOrEqual(12);
      // (the cabinet: a narrow deep box; the T2.5 body's own extinguisher relief and the placed extinguisher shade each other a little)
      expect(r.lit / r.seen, `${kind}: lit through the closed glass (shaded by ${r.blockers.join(', ')})`).toBeGreaterThanOrEqual(0.7);
      // the regression, demonstrated: the old broadcast flags (the glass a caster) put everything behind it in the torch shadow
      for (const m of glass) m.castShadow = true;
      const old = seenLit(cm, h, eye, torch);
      for (const m of glass) m.castShadow = false;
      console.log(`${kind} with a casting glass pane (before the fix): ${old.lit}/${old.seen} lit`);
      expect(old.lit / old.seen, `${kind}: with a casting glass pane the interior is in the torch shadow`).toBeLessThan(0.1);
    }
  });

  it('the cooler door still opens and closes; its stock is seen through the closed glass and taken only once open; it still blocks sight', () => {
    const {cm, layout} = setup();
    const h = cm.all.find(x => x.kind === 'shopCooler')!;
    aim(cm, layout, h);
    expect(PROP_DEFS.shopCooler.blocksSight).toBe(true);
    const settle = () => { for (let t = 0; t < 1.2; t += 1 / 60) cm.update(1 / 60, t); };
    cm.interact({container: h, t: 1, lot: null, part: 0});
    settle();
    expect(h.state.parts![0]).toBe(true);
    expect(h.open!.parts[0].t).toBe(1);
    h.state.parts![0] = false; // closing (interact semantics: tests/openables.test.ts)
    settle();
    expect(h.open!.parts[0].t).toBe(0);
    // glass part: visible while closed (no lot needed for the rule), not takeable through intact glass
    const priv = cm as unknown as {lotVisible(h: Holder, l: {part?: number}): boolean; lotTakeable(h: Holder, l: {part?: number}): boolean};
    expect(priv.lotVisible(h, {part: 0})).toBe(true);
    expect(priv.lotTakeable(h, {part: 0})).toBe(false);
  });
});

describe('shop glass: lit pane vs contents up close (CPU mirror of three r186 direct lighting)', () => {
  // game.ts: SpotLight(0xfff4e2, MOOD.flashlight cd, 30 m, angle 0.58, penumbra 0.7, decay 1.2), camera-local (0.2, -0.15, 0.1)
  const DECAY = 1.2, RANGE = 30, PENUMBRA = 0.7, ANGLE = Math.acos(BEAM.cosHalfAngle);
  const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  function irradiance(torch: THREE.Vector3, dir: THREE.Vector3, p: THREE.Vector3, n: THREE.Vector3): number {
    const L = torch.clone().sub(p), d = L.length();
    L.normalize();
    const spot = smooth(Math.cos(ANGLE), Math.cos(ANGLE * (1 - PENUMBRA)), -L.dot(dir));
    return MOOD.flashlight * spot / Math.max(d ** DECAY, 0.01) * Math.min(1, Math.max(0, 1 - (d / RANGE) ** 4)) ** 2 * Math.max(0, n.dot(L));
  }
  it('cooler at 0.5 / 0.75 / 1.0 m, torch on: the glass veil stays below a dark label behind it and under a tenth of a light one', () => {
    const f = facts.get('shopCooler')!, a = f.base[3], rho = lum(f.base.slice(0, 3)), N = new THREE.Vector3(0, 0, 1);
    for (const dist of [0.5, 0.75, 1.0]) {
      const eye = new THREE.Vector3(0, 1.62, 0.312 + dist), item = new THREE.Vector3(0, 1.14, 0.22); // middle shelf, front row
      const torch = torchAt(eye, item), dir = item.clone().sub(torch).normalize();
      const pane = eye.clone().lerp(item, (eye.z - 0.312) / (eye.z - item.z));
      // Lambert x (1 - F(0.04)) for both; the pane's veil is weighted by its alpha, what is behind by (1 - alpha)
      const veil = a * rho / Math.PI * 0.96 * irradiance(torch, dir, pane, N);
      const behind = (alb: number) => (1 - a) * alb / Math.PI * 0.96 * irradiance(torch, dir, item, N);
      expect(veil, `${dist} m: veil vs a dark (0.05) label behind the glass`).toBeLessThan(behind(0.05));
      expect(veil, `${dist} m: veil vs a light (0.6) label`).toBeLessThan(0.1 * behind(0.6));
      // the old white film (0.8 / 0.88 / 0.9, alpha 0.14) outshone a dark label 2x and more even with the stock lit by the torch
      const old = 0.14 * lum([0.8, 0.88, 0.9]) / Math.PI * 0.96 * irradiance(torch, dir, pane, N);
      expect(old, `${dist} m: the old film`).toBeGreaterThan(2 * (0.86 / (1 - a)) * behind(0.05));
    }
  });
});
