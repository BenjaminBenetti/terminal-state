// Iteration 13 (MAT-B): effect + character materials on WebGPURenderer (node materials / TSL). Node tests (no GPU):
// crater instance attributes + caps, the fx particle sprites / decals / tracers, the pickup + loot highlight flash,
// the authored battery / flare items and the skinned characters — each built into real WGSL and GLSL (both backends of
// three r186's WebGPURenderer) with no TSL error, plus the behaviour each effect relies on.
import * as THREE from 'three';
import {LineBasicNodeMaterial, MeshLambertNodeMaterial, PointsNodeMaterial, type NodeMaterial} from 'three/webgpu';
import {describe, expect, it} from 'vitest';
import {installCanvasShim} from './helpers/canvas2d';
import {buildBoth} from './helpers/tslShaders';
import {CRATER_CAP, CraterField} from '../src/damage/craters';
import {installWounds, hasWounds} from '../src/damage/wounds';
import {objectData} from '../src/damage/tsl';
import {Effects, STEAM_FX} from '../src/world/fx';
import {PickupManager, itemTemplate} from '../src/world/pickups';
import {LotDisplay} from '../src/world/lootDisplay';
import {authoredItemModel, resetAuthoredItems, thrownFlareModel} from '../src/world/authoredItems';
import {Inventory} from '../src/items/inventory';
import {FLOOR, Grid} from '../src/gen/grid';

installCanvasShim(false);
{
  // the no-op shim lacks a few path calls the item label atlases use
  const ctx0 = (globalThis as unknown as {document: {createElement(t: string): {getContext(k: string): object}}}).document.createElement('canvas').getContext('2d');
  const proto = Object.getPrototypeOf(ctx0) as Record<string, unknown>;
  for (const k of ['clip', 'setLineDash', 'quadraticCurveTo']) if (typeof proto[k] !== 'function') proto[k] = () => {};
}

const lights = () => [new THREE.PointLight(0xffffff, 1, 8)];
const clean = (o: THREE.Object3D, what: string) => {
  for (const sh of buildBoth(o, {lights: lights()})) expect(sh.errors, `${what} (${sh.backend})`).toEqual([]);
};
const meshesOf = (root: THREE.Object3D) => { const out: THREE.Mesh[] = []; root.traverse(o => { if ((o as THREE.Mesh).isMesh || (o as THREE.Sprite).isSprite) out.push(o as THREE.Mesh); }); return out; };

describe('craters: per-instance attributes and caps (instanced node decal)', () => {
  const spec = (style: 0 | 1 | 2) => ({size: 0.06, maxSize: 0.25, depth: 0.3, substrate: new THREE.Color(0.55, 0.5, 0.45), surface: new THREE.Color(0.9, 0.88, 0.8), style});

  it('writes depth / seed / style / alive, rim + substrate colours and an orthonormal decal frame per slot', () => {
    const c = new CraterField(16);
    const g = c.mesh.geometry;
    const at = (name: string) => g.attributes[name] as THREE.InstancedBufferAttribute;
    for (const n of ['aCrater', 'aRim', 'aSub', 'aCrT', 'aCrB']) expect(at(n).isInstancedBufferAttribute, n).toBe(true);
    // the substrate is its own attribute: node materials multiply instanceColor AFTER colorNode (it would tint the gravel)
    expect(c.mesh.instanceColor).toBeNull();
    const normals = [new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -1, 0), new THREE.Vector3(-0.6, 0, 0.8)];
    normals.forEach((n, i) => {
      const cr = c.hit(new THREE.Vector3(i * 2, 1.2, 0), n, spec((i % 3) as 0 | 1 | 2), () => 0.25);
      const s = cr.slot;
      expect(at('aCrater').getX(s)).toBeCloseTo(cr.depth, 6);
      expect(at('aCrater').getY(s)).toBeCloseTo(0.25, 6);
      expect(at('aCrater').getZ(s)).toBe(i % 3);
      expect(at('aCrater').getW(s)).toBe(1);
      expect([at('aSub').getX(s), at('aSub').getY(s), at('aSub').getZ(s)].map(v => +v.toFixed(4))).toEqual([0.55, 0.5, 0.45]);
      expect(at('aRim').getX(s)).toBeCloseTo(0.9, 5);
      const T = new THREE.Vector3(at('aCrT').getX(s), at('aCrT').getY(s), at('aCrT').getZ(s));
      const B = new THREE.Vector3(at('aCrB').getX(s), at('aCrB').getY(s), at('aCrB').getZ(s));
      expect(T.length()).toBeCloseTo(1, 5);
      expect(B.length()).toBeCloseTo(1, 5);
      expect(T.dot(n)).toBeCloseTo(0, 5);
      expect(B.dot(n)).toBeCloseTo(0, 5);
      expect(new THREE.Vector3().crossVectors(n, T).dot(B)).toBeCloseTo(1, 5); // right-handed: N x T = B
      // the frame matches the instance matrix axes (the decal plane drawn)
      const m = new THREE.Matrix4();
      c.mesh.getMatrixAt(s, m);
      const ax = new THREE.Vector3().setFromMatrixColumn(m, 0).normalize();
      expect(ax.distanceTo(T)).toBeLessThan(1e-5);
    });
    // a merge deepens in place, keeps the seed and the frame
    const first = c.list[0], seed = at('aCrater').getY(first.slot);
    c.hit(first.pos.clone().add(new THREE.Vector3(0.005, 0, 0)), first.normal, spec(0), () => 0.9);
    expect(c.merges).toBe(1);
    expect(at('aCrater').getX(first.slot)).toBeGreaterThan(0.3 * 0.8);
    expect(at('aCrater').getY(first.slot)).toBe(seed);
  });

  it('recycles the oldest slot at the cap and keeps one draw (instanced, count <= cap)', () => {
    const c = new CraterField();
    for (let i = 0; i < CRATER_CAP + 30; i++) c.hit(new THREE.Vector3(i * 0.4, 1, 0), new THREE.Vector3(0, 0, 1), spec(0), () => 0.5);
    expect(c.count).toBe(CRATER_CAP);
    expect(c.mesh.count).toBe(CRATER_CAP);
    expect(c.mesh.isInstancedMesh).toBe(true);
    clean(c.mesh, 'crater decal');
  });
});

describe('per-object damage data (one shared graph, state on the mesh)', () => {
  it('reads the mesh own Float32Array; absent / cloned (JSON) / short data reads zeros instead of failing', () => {
    const node = objectData('dmgTest', 3) as unknown as {getValueFromReference(o: unknown): Float32Array};
    const data = new Float32Array(12).fill(2);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    mesh.userData.dmgTest = data;
    expect(node.getValueFromReference(mesh)).toBe(data);
    data[0] = 7; // live edits are what the next draw uploads (no material rebuild)
    expect(node.getValueFromReference(mesh)[0]).toBe(7);
    const copy = mesh.clone(); // Object3D.copy JSON-clones userData: the copy draws undamaged
    const z = node.getValueFromReference(copy);
    expect(z).not.toBe(data);
    expect(z.length).toBe(12);
    expect([...z].every(v => v === 0)).toBe(true);
    expect([...node.getValueFromReference(new THREE.Object3D())].every(v => v === 0)).toBe(true);
    expect(node.getValueFromReference({userData: {dmgTest: new Float32Array(4)}}).length).toBe(12);
  });
});

describe('fx: particles, decals and tracers as node materials', () => {
  it('particle rings are ONE instanced sprite draw each (PointsNodeMaterial), fogged like the GLSL', () => {
    const fx = new Effects();
    const sprites = meshesOf(fx.group).filter(o => (o as unknown as THREE.Sprite).isSprite) as unknown as THREE.Sprite[];
    // Track 2 (VIS): + the small non-hazardous steam ring (STEAM_FX.puffs slots).
    expect(sprites.map(s => s.name).sort()).toEqual(['fx-particles', 'fx-sparks', 'fx-steam']);
    for (const s of sprites) {
      const m = s.material as unknown as PointsNodeMaterial;
      expect(m.isPointsNodeMaterial).toBe(true);
      expect(s.count).toBeGreaterThan(s.name === 'fx-steam' ? STEAM_FX.puffs - 1 : 100); // one quad per ring slot, instanced
      expect(m.sizeNode).toBeTruthy();
      expect(m.positionNode).toBeTruthy();
      expect(m.fog).toBe(false); // applied in the colour node (additive ring fades to black)
      expect(m.depthWrite).toBe(false);
      for (const sh of buildBoth(s)) {
        expect(sh.errors, `${s.name} ${sh.backend}`).toEqual([]);
        // size = aSize * P[1][1] (PointsNodeMaterial adds DPR * half height / depth), cut where alpha <= 0
        expect(sh.vertex).toMatch(/cameraProjectionMatrix\s*\[\s*1u?\s*\]\.y/);
        expect(sh.fragment).toContain('discard');
      }
    }
    expect((sprites.find(s => s.name === 'fx-sparks')!.material as THREE.Material).blending).toBe(THREE.AdditiveBlending);
    // emitting fills the ring; the scene fog reaches the shader uniforms before each draw
    fx.impact(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1), 'metal');
    fx.muzzle(new THREE.Vector3(0, 1.5, 0), new THREE.Vector3(0, 0, -1), true);
    expect(fx.stats().particles).toBeGreaterThan(0);
    expect(fx.stats().sparks).toBeGreaterThan(0);
    const s = sprites[0];
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x0a0b0c, 0.04);
    s.onBeforeRender({} as never, scene, new THREE.PerspectiveCamera(), s.geometry, s.material, null as never);
    for (let k = 0; k < 120; k++) fx.update(1 / 30);
    expect(fx.stats().particles).toBe(0);
    expect(sprites.every(x => !x.visible)).toBe(true);
    // never a raycast target (Sprite.raycast needs raycaster.camera)
    const hits: THREE.Intersection[] = [];
    s.raycast(new THREE.Raycaster(), hits);
    expect(hits).toEqual([]);
  });

  it('decals fade per instance through the opacity node; tracers keep per-vertex alpha', () => {
    const fx = new Effects();
    const decals = meshesOf(fx.group).filter(o => (o as THREE.InstancedMesh).isInstancedMesh) as THREE.InstancedMesh[];
    // hole / metal / wood / blood (Lambert) + the Strainer's wet-shine trail (task studio-alpha-strainer-lumbering-wetness-20261101-01:
    // a LIT standard, near-mirror film — its shine is the specular highlight), each one fixed ring and one draw
    expect(decals.length).toBe(5);
    expect(decals.map(d => d.name).sort()).toEqual(['fx-decals-blood', 'fx-decals-hole', 'fx-decals-metal', 'fx-decals-wet', 'fx-decals-wood']);
    for (const d of decals) {
      const m = d.material as unknown as MeshLambertNodeMaterial;
      if (d.name === 'fx-decals-wet') {
        const w = d.material as unknown as {isMeshStandardNodeMaterial?: boolean; roughness: number; metalness: number; transparent: boolean; depthWrite: boolean};
        expect(w.isMeshStandardNodeMaterial).toBe(true);
        expect(w.roughness).toBeLessThan(0.15);
        expect(w.metalness).toBe(0);
        expect(w.transparent && !w.depthWrite).toBe(true);
      } else expect(m.isMeshLambertNodeMaterial).toBe(true);
      expect(m.opacityNode).toBeTruthy();
      expect(m.polygonOffset).toBe(true);
      expect((d.geometry.attributes.aFade as THREE.InstancedBufferAttribute).isInstancedBufferAttribute).toBe(true);
      for (const sh of buildBoth(d, {lights: lights()})) {
        expect(sh.errors, `${d.name} ${sh.backend}`).toEqual([]);
        expect(sh.vertex).toContain('aFade');
      }
    }
    fx.impact(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1), 'concrete');
    expect(fx.stats().decals).toBe(1);
    const lines = meshesOf(fx.group).length; void lines;
    const tracer = fx.group.children.find(o => (o as THREE.LineSegments).isLineSegments) as THREE.LineSegments;
    expect((tracer.material as unknown as LineBasicNodeMaterial).isLineBasicNodeMaterial).toBe(true);
    expect((tracer.geometry.attributes.color as THREE.BufferAttribute).itemSize).toBe(4);
    for (const sh of buildBoth(tracer)) expect(sh.errors, `tracer ${sh.backend}`).toEqual([]);
  });
});

describe('loot / pickup highlight flash (emissive on own material copies, no shader rebuild)', () => {
  function room(): Grid {
    const g = new Grid(12, 12);
    for (let y = 1; y < 11; y++) for (let x = 1; x < 11; x++) { const i = g.idx(x, y); g.cells[i] = FLOOR; g.floor[i] = 0; g.ceil[i] = 3.5; }
    return g;
  }

  it('the aimed pickup pulses, the others keep a faint glow, the previous one is reset; own clones per pickup', () => {
    const pm = new PickupManager({});
    const inv = new Inventory();
    const a = pm.add(inv.makeStack('battery', 1), 3, 0, 3, 0);
    const b = pm.add(inv.makeStack('flare', 1), 4.5, 0, 3, 0);
    const tpl = itemTemplate('battery');
    const tplMats = new Set<THREE.Material>();
    tpl.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) tplMats.add(m.material as THREE.Material); });
    for (const m of a.mats) expect(tplMats.has(m)).toBe(false); // own clone: the flash never leaks to other items
    const g = room();
    const eye = new THREE.Vector3(2.4, 1.6, 3);
    const look = (p: {x: number; y: number; z: number}) => new THREE.Vector3(p.x - eye.x, p.y + 0.08 - eye.y, p.z - eye.z).normalize();
    expect(pm.target(eye, look(a), g)).toBe(a);
    const ks: number[] = [];
    for (const t of [0, 0.13, 0.26]) { pm.update(t); ks.push(a.mats[0].emissive.r); }
    expect(Math.max(...ks)).toBeGreaterThan(0.12); // pulse 0.12 +- 0.08
    expect(new Set(ks.map(k => k.toFixed(3))).size).toBeGreaterThan(1);
    expect(b.mats[0].emissive.r).toBeLessThan(0.08); // faint self-glow + glint only
    // look at the other pickup: the first one is reset, then re-joins the faint glow
    expect(pm.target(new THREE.Vector3(4.0, 1.6, 3), look(b).set(b.x - 4.0, b.y + 0.08 - 1.6, 0).normalize(), g)).toBe(b);
    expect(a.mats[0].emissive.r).toBe(0);
    pm.update(1);
    expect(a.mats[0].emissive.r).toBeLessThan(0.08);
    // under WebGPURenderer these classic item materials convert to node materials at build; emissive stays a uniform
    for (const o of meshesOf(a.obj)) {
      for (const sh of buildBoth(o, {lights: lights()})) {
        expect(sh.errors, `pickup ${o.name} ${sh.backend}`).toEqual([]);
        expect(sh.fragment).toMatch(/EmissiveColor\s*=/);
      }
    }
  });

  it('loot lots draw instanced with a base glow; the aimed lot is a pulsing highlight copy (emissiveMap = map)', () => {
    const d = new LotDisplay();
    d.allocate(new Map([['battery', 4], ['flare', 2]]));
    const lot = (id: number, itemId: string, x: number) => ({id, itemId, matrix: new THREE.Matrix4().makeTranslation(x, 0.5, 0)});
    d.show([lot(1, 'battery', 0), lot(2, 'battery', 0.1), lot(3, 'flare', 0.3)], 2);
    expect(d.visible).toBe(3);
    const hl = d.group.children.find(o => o.name === 'loot-highlight-battery')!;
    expect(hl.visible).toBe(true);
    const hm: THREE.MeshStandardMaterial[] = [];
    hl.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) hm.push(m.material as THREE.MeshStandardMaterial); });
    const label = hm.find(m => m.map)!;
    expect(label.emissiveMap).toBe(label.map);
    d.pulse(0);
    const k0 = label.emissive.r;
    d.pulse(0.26);
    expect(label.emissive.r).not.toBeCloseTo(k0, 4);
    expect(Math.max(k0, label.emissive.r)).toBeGreaterThan(0.16);
    const batch = d.group.children.find(o => (o as THREE.InstancedMesh).isInstancedMesh && o.visible) as THREE.InstancedMesh;
    expect((batch.material as THREE.MeshStandardMaterial).emissive.r).toBeGreaterThan(0);
    clean(batch, 'loot batch (instanced)');
    for (const o of meshesOf(hl)) clean(o, 'loot highlight copy');
    // aiming elsewhere hides the copy and draws that lot instanced again
    d.show([lot(1, 'battery', 0), lot(2, 'battery', 0.1)], null);
    expect(hl.visible).toBe(false);
  });
});

describe('authored battery / flare items and the struck flare', () => {
  it('build cleanly through the node library on both backends; burning toggles the hot head + additive glow sprite', () => {
    resetAuthoredItems();
    for (const id of ['battery', 'flare'] as const) for (const o of meshesOf(authoredItemModel(id))) clean(o, `${id} ${o.name}`);
    const f = thrownFlareModel();
    f.setBurning(true);
    expect(f.glow.visible).toBe(true);
    expect((f.head.material as THREE.MeshStandardMaterial).emissiveIntensity).toBeGreaterThan(1);
    expect((f.glow.material as THREE.SpriteMaterial).blending).toBe(THREE.AdditiveBlending);
    for (const o of meshesOf(f.root)) clean(o, `thrown flare ${o.name}`);
    f.setBurning(false);
    expect(f.glow.visible).toBe(false);
    expect((f.head.material as THREE.MeshStandardMaterial).emissive.getHex()).toBe(0);
  });
});

describe('characters: skinned zombie / creature layers on node materials', () => {
  function actor(mats: THREE.Material[]) {
    const geo = new THREE.CylinderGeometry(0.15, 0.15, 1.6, 16, 12);
    geo.translate(0, 0.8, 0);
    const n = geo.attributes.position.count, si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) { si[i * 4] = geo.attributes.position.getY(i) < 0.8 ? 0 : 1; sw[i * 4] = 1; }
    geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
    const hips = new THREE.Bone(), spine = new THREE.Bone();
    hips.name = 'Hips'; spine.name = 'Spine'; spine.position.y = 0.8; hips.add(spine);
    const root = new THREE.Group();
    const meshes = mats.map((m, i) => {
      const sm = new THREE.SkinnedMesh(geo, m);
      sm.name = i ? 'ZombieWear_upper' : 'ZombieBody';
      sm.userData = i ? {slot: 'upper', wearable: 'hoodie'} : {slot: 'body', wearable: null};
      sm.castShadow = true;
      root.add(sm);
      return sm;
    });
    meshes[0].add(hips);
    root.updateMatrixWorld(true);
    const sk = new THREE.Skeleton([hips, spine]);
    for (const m of meshes) m.bind(sk, meshes[0].bindMatrix);
    return {root, meshes, mats};
  }

  it('wound install gives each layer a skinned node material that compiles, flashes by emissive and casts its dented shadow', () => {
    const map = new THREE.DataTexture(new Uint8Array([200, 180, 160, 255]), 1, 1);
    map.needsUpdate = true;
    const A = actor([new THREE.MeshStandardMaterial({map, roughness: 0.8}), new THREE.MeshStandardMaterial({color: 0x334455, roughness: 0.9})]);
    installWounds(A);
    for (const m of A.meshes) {
      const nm = m.material as unknown as NodeMaterial & THREE.MeshStandardMaterial;
      expect(nm.isNodeMaterial, m.name).toBe(true);
      expect(hasWounds(nm)).toBe(true);
      // the shadow pass (Renderer._getShadowNodes) takes material.positionNode: the dented skinned position
      expect(nm.positionNode).toBeTruthy();
      expect(nm.emissive.isColor).toBe(true);
      nm.emissive.setRGB(0.45, 0.12, 0.08); // the actors' hit flash edits the CURRENT material's emissive
      for (const sh of buildBoth(m, {lights: lights()})) {
        expect(sh.errors, `${m.name} ${sh.backend}`).toEqual([]);
        expect(sh.vertex).toContain('skinWeight');
        expect(sh.fragment).toMatch(/EmissiveColor\s*=/);
      }
    }
    expect((A.meshes[0].material as THREE.MeshStandardMaterial).map).toBe(map); // textures shared, not copied
  });
});
