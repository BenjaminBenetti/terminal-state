// Task train-interaction-ux-20261112-063646 (lane CRAFT-UI): THE RECIPE ROWS' 3D PREVIEWS (world/craftPreview.ts + the extra-source
// registry of ui/itemIcons.ts). User: "Put an actual 3D item preview, like the inventory preview, on the LEFT of each recipe. Reuse the
// inventory model-preview/cache resources; no new artwork or proxy final images."
//  - the picture is the unit as the equipment system builds it (the REAL world/trainEquipmentModel.ts EquipmentLook over stub models
//    here) — and only while every part is a real model: a stand-in module, a stand-in hand truck or a stand-in chest gives NOTHING;
//  - a preview goes through the inventory's own icon pass and cache (refreshItemIcons with a recording renderer: the same render /
//    readback / cache / change-listener path as an item), at the trait's camera angle; its transient object is let go afterwards and
//    the shared geometry / materials are never disposed; a catalogue item can never be given an extra source;
//  - the row shows the cached picture on the left, the empty frame otherwise; an open list redraws when its picture arrives;
//  - a render is requested once per look generation — never per frame, not per open (an open asks only for what is missing), never
//    without a renderer, one pass at a time and not while a warm-up owns the renderer.
// Every test loads the modules afresh (the icon cache and the hand truck's models are module state).
import {afterAll, afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import * as THREE from 'three';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import type {WebGPURenderer} from 'three/webgpu';
import {installCanvasShim} from './helpers/canvas2d';
import {installFakeDom} from './helpers/fakeDom';
import type {EquipmentDef, EquipmentKind} from '../src/craft/equipment';
import type {EquipmentView} from '../src/world/trainEquipmentModel';

// (the icon pass awaits the gear models' preload: no fetches in Node)
vi.mock('../src/gear/models', async orig => ({...(await orig<typeof import('../src/gear/models')>()), preloadGearModels: () => Promise.resolve()}));

// the pass turns its pixels into a PNG through a canvas (the 2D shim + a data URL per shot); the recipe list mounts in the tiny fake DOM
installCanvasShim(false);
const canvasDoc = (globalThis as unknown as {document: {createElement(tag: string): Record<string, unknown>}}).document;
const dom = installFakeDom();
const fakeCreate = dom.doc.createElement;
let shotNo = 0;
dom.doc.createElement = ((tag: string) => {
  if (tag !== 'canvas') return fakeCreate(tag);
  const c = canvasDoc.createElement(tag);
  c.toDataURL = () => `data:image/png;base64,SHOT${++shotNo}`;
  return c;
}) as typeof fakeCreate;
afterAll(() => dom.uninstall());

async function load() {
  vi.resetModules();
  const [icons, view, preview, look, carts, equipment, recipes, crafting, materials, inventory] = await Promise.all([
    import('../src/ui/itemIcons'), import('../src/ui/craftView'), import('../src/world/craftPreview'), import('../src/world/trainEquipmentModel'),
    import('../src/world/fuelCartModel'), import('../src/craft/equipment'), import('../src/craft/recipes'), import('../src/craft/crafting'),
    import('../src/items/craftMaterials'), import('../src/items/inventory'),
  ]);
  const lockbox = await import('../src/world/trainLockbox');
  return {icons, view, preview, look, carts, equipment, recipes, crafting, materials, inventory, lockbox};
}
type Mods = Awaited<ReturnType<typeof load>>;

let M: Mods;
beforeEach(async () => { M = await load(); shotNo = 0; });
afterEach(() => { vi.restoreAllMocks(); });

const ids = () => M.recipes.RECIPES.map(r => M.view.craftPreviewId(r.kind));
const dollyKinds = () => M.equipment.EQUIPMENT_KINDS.filter(k => M.equipment.EQUIPMENT[k].move === 'dolly');
const carryKinds = () => M.equipment.EQUIPMENT_KINDS.filter(k => M.equipment.EQUIPMENT[k].move === 'carry');

/** A stub cooked scene: one mesh; its geometry / material count their 'dispose' events (they must never get one). */
function stubScene(name: string, size: [number, number, number], disposed: string[]): THREE.Group {
  const geo = new THREE.BoxGeometry(...size), mat = new THREE.MeshStandardMaterial({color: 0x446655});
  mat.name = `cooked:${name}`;
  geo.addEventListener('dispose', () => disposed.push(`geometry:${name}`));
  mat.addEventListener('dispose', () => disposed.push(`material:${name}`));
  const scene = new THREE.Group(), mesh = new THREE.Mesh(geo, mat);
  mesh.name = name;
  scene.add(mesh);
  return scene;
}

/** The prop library + the hand truck as the game would have them once loaded (each part optional). */
function models(o: {modules?: boolean; lockbox?: boolean; truck?: boolean} = {}) {
  const disposed: string[] = [];
  const lib = new Map<string, {scene: THREE.Object3D}>();
  if (o.modules !== false) for (const k of dollyKinds()) lib.set(M.look.equipmentModelKey(M.equipment.EQUIPMENT[k])!, {scene: stubScene(`module-${k}`, [0.45, 0.9, 0.38], disposed)});
  if (o.lockbox !== false) {
    // the Lockbox model's own two nodes (world/trainLockbox.ts buildLockboxView)
    const scene = new THREE.Group();
    const body = stubScene('lockbox-body', [0.9, 0.4, 0.5], disposed).children[0], lid = stubScene('lockbox-lid', [0.9, 0.08, 0.5], disposed).children[0];
    lid.rotation.x = 0.05; // (a rest angle that is not zero: "shut" is the model's rest pose, not rotation 0)
    scene.add(body, lid);
    lib.set(M.lockbox.LOCKBOX_MODEL_KEY, {scene});
  }
  M.carts.setCartModelsForTests({truck: o.truck !== false ? ({scene: stubScene('truck', [0.5, 1.2, 0.5], disposed)} as unknown as GLTF) : null, drum: null});
  const look = new M.look.EquipmentLook(() => lib);
  look.poll(M.equipment.EQUIPMENT);
  return {lib, look, disposed};
}

const meshesOf = (root: THREE.Object3D) => { const out: THREE.Mesh[] = []; root.traverse(o => { if ((o as THREE.Mesh).isMesh) out.push(o as THREE.Mesh); }); return out; };
const materialNames = (root: THREE.Object3D) => new Set(meshesOf(root).map(m => (m.material as THREE.Material).name));

/** A recording stand-in for the game's renderer: what the icon pass asks of it, and opaque pixels for every readback. */
function recorder(o: {failReadback?: (n: number) => boolean} = {}) {
  let target: unknown = null, reads = 0;
  const log = {renders: [] as {names: string[]; dir: THREE.Vector3; toTarget: boolean; objects: THREE.Object3D[]}[], readbacks: 0};
  const r = {
    coordinateSystem: THREE.WebGLCoordinateSystem, samples: 0, backend: {isWebGPUBackend: false},
    getRenderTarget: () => target, setRenderTarget: (t: unknown) => { target = t; },
    getClearAlpha: () => 1, getClearColor: (c: THREE.Color) => c, setClearColor: () => {}, clear: () => {},
    render: (scene: THREE.Scene, cam: THREE.Camera) => {
      const objects: THREE.Object3D[] = [];
      scene.traverse(x => { if (!(x as THREE.Light).isLight && !(x as THREE.Camera).isCamera && x !== scene) objects.push(x); });
      log.renders.push({names: meshesOf(scene).map(m => m.name), dir: cam.position.clone().normalize(), toTarget: target !== null, objects});
    },
    readRenderTargetPixelsAsync: async (_rt: unknown, _x: number, _y: number, w: number, h: number) => {
      log.readbacks++;
      if (o.failReadback?.(++reads)) throw new Error('readback failed (test)');
      return new Uint8Array(w * h * 4).fill(255);
    },
  };
  return {renderer: r as unknown as WebGPURenderer, log};
}

const viewDir = (v: {az: number; el: number}) => {
  const az = (v.az * Math.PI) / 180, el = (v.el * Math.PI) / 180;
  return new THREE.Vector3(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az));
};

describe('recipe previews: the object is the real unit — or nothing', () => {
  it('no model resident: every kind gives null (a stand-in is never a picture)', () => {
    const {look} = models({modules: false, lockbox: false, truck: false});
    for (const k of M.equipment.EQUIPMENT_KINDS) {
      const def = M.equipment.EQUIPMENT[k];
      expect(look.build(def).standIn, k).toBe(true);
      expect(M.preview.previewObject(look, def), k).toBeNull();
    }
  });

  it('a device needs BOTH its module and the hand truck it stands on; the chest needs the Lockbox model', () => {
    // modules there, the hand truck not (its own stand-in would be drawn): nothing for a device
    let m = models({truck: false});
    for (const k of dollyKinds()) {
      expect(m.look.build(M.equipment.EQUIPMENT[k]).standIn, k).toBe(false); // (the look only knows about the module)
      expect(M.preview.previewObject(m.look, M.equipment.EQUIPMENT[k]), k).toBeNull();
    }
    for (const k of carryKinds()) expect(M.preview.previewObject(m.look, M.equipment.EQUIPMENT[k]), k).not.toBeNull();
    // the hand truck there, the modules not
    m = models({modules: false});
    for (const k of dollyKinds()) expect(M.preview.previewObject(m.look, M.equipment.EQUIPMENT[k]), k).toBeNull();
    // the Lockbox model missing: no chest
    m = models({lockbox: false});
    for (const k of carryKinds()) expect(M.preview.previewObject(m.look, M.equipment.EQUIPMENT[k]), k).toBeNull();
    for (const k of dollyKinds()) expect(M.preview.previewObject(m.look, M.equipment.EQUIPMENT[k]), k).not.toBeNull();
  });

  it('with the models: the unit exactly as the look builds it — real parts only, a fresh view every time, shared geometry, the lid shut', () => {
    const {look, lib, disposed} = models();
    const S = M.look.equipmentMaterials();
    expect(dollyKinds().length).toBeGreaterThan(0);
    expect(carryKinds().length).toBeGreaterThan(0);
    for (const k of M.equipment.EQUIPMENT_KINDS) {
      const def = M.equipment.EQUIPMENT[k], a = M.preview.previewObject(look, def)!, b = M.preview.previewObject(look, def)!;
      expect(a, k).toBeTruthy();
      expect(a).not.toBe(b); // never one object handed out twice (never a live unit's view)
      expect(a.parent).toBeNull();
      expect(a.name).toBe(`train-equipment:${k}`); // the equipment system's own view of the kind
      const names = materialNames(a);
      expect(names.has(S.standIn.name), k).toBe(false);
      expect(names.has(S.standInFace.name), k).toBe(false);
      if (def.move === 'dolly') {
        expect(a.getObjectByName(`train-equipment-module:${k}`), k).toBeTruthy();
        expect(a.getObjectByName('fuel-cart-truck'), k).toBeTruthy();
        expect([...names].sort()).toEqual([`cooked:module-${k}`, 'cooked:truck']);
        // clones share the cooked geometry (nothing is copied or owned by the preview)
        const src = lib.get(M.look.equipmentModelKey(def)!)!.scene.children[0] as THREE.Mesh;
        expect(meshesOf(a).some(x => x.geometry === src.geometry)).toBe(true);
      } else {
        expect(names.has('cooked:lockbox-body') && names.has('cooked:lockbox-lid'), k).toBe(true);
        const lid = a.getObjectByName('lockbox-lid')!;
        expect(lid.rotation.x).toBe(0.05); // shut = the model's rest pose
      }
    }
    expect(disposed).toEqual([]);
  });

  it('the camera is chosen per trait (how the unit is moved), a front three-quarter view from above — no list of kinds', () => {
    const moves = new Set(M.equipment.EQUIPMENT_KINDS.map(k => M.equipment.EQUIPMENT[k].move));
    expect(Object.keys(M.preview.PREVIEW_VIEW).sort()).toEqual([...moves].sort());
    for (const v of Object.values(M.preview.PREVIEW_VIEW)) {
      expect(v.az).toBeGreaterThanOrEqual(20); expect(v.az).toBeLessThanOrEqual(45); // the +Z front (console face / latches) toward the camera, turned a little
      expect(v.el).toBeGreaterThanOrEqual(8); expect(v.el).toBeLessThanOrEqual(35);
    }
  });
});

describe('recipe previews: through the inventory\'s icon pass and cache', () => {
  it('a catalogue item can never get an extra source (what an item renders to cannot change)', () => {
    const src = {build: () => new THREE.Group()};
    expect(() => M.icons.registerIconSource(M.materials.SCRAP_METAL, src)).toThrow(/catalogue item/);
    expect(() => M.icons.registerIconSource('rifle', src)).toThrow(/catalogue item/);
    expect(() => M.icons.registerIconSource('', src)).toThrow();
    // an extra id without a render has NO fallback picture; an item keeps its glyph
    const off = M.icons.registerIconSource('equipment:test', src);
    expect(M.icons.itemIconHtml('equipment:test')).toBe('');
    expect(M.icons.itemIconUrl('equipment:test')).toBeNull();
    expect(M.icons.itemIconHtml(M.materials.SCRAP_METAL).startsWith('<svg')).toBe(true);
    off();
  });

  it('one source per recipe; rendered by refreshItemIcons like an item: the pass\'s target, the trait\'s angle, the same cache and change event', async () => {
    const {look, disposed} = models();
    const previews = new M.preview.CraftPreviews({look: () => look}).install();
    expect(previews.ids).toEqual(ids());
    expect(previews.ids).toEqual(M.equipment.EQUIPMENT_KINDS.map(k => `equipment:${k}`)); // every kind has a recipe, so every kind a preview
    expect(previews.missing()).toEqual(ids());
    const {renderer, log} = recorder();
    const changed: string[][] = [];
    M.icons.onItemIconsChanged(list => changed.push([...list]));
    const v0 = M.icons.itemIconsVersion();
    await M.icons.refreshItemIcons(renderer, previews.ids);
    // one render per preview into the pass's own target, each read back; the renderer handed back as found
    expect(log.renders).toHaveLength(ids().length);
    expect(log.readbacks).toBe(ids().length);
    expect(log.renders.every(r => r.toTarget)).toBe(true);
    expect(renderer.getRenderTarget()).toBeNull();
    M.recipes.RECIPES.forEach((r, i) => {
      const def = M.equipment.EQUIPMENT[r.kind], shot = log.renders[i];
      // what was drawn: that kind's view, real parts
      expect(shot.objects.some(o => o.name === `train-equipment:${r.kind}`), r.kind).toBe(true);
      if (def.move === 'dolly') expect(shot.names).toEqual(expect.arrayContaining(['truck', `module-${r.kind}`]));
      else expect(shot.names).toEqual(expect.arrayContaining(['lockbox-body', 'lockbox-lid']));
      // from the trait's angle
      const want = viewDir(M.preview.PREVIEW_VIEW[def.move]);
      expect(shot.dir.distanceTo(want), r.kind).toBeLessThan(1e-6);
    });
    // cached like an item icon, reported like one
    for (const id of ids()) expect(M.icons.itemIconUrl(id), id).toMatch(/^data:image\/png;base64,SHOT\d+$/);
    expect(new Set(ids().map(id => M.icons.itemIconUrl(id))).size).toBe(ids().length);
    expect(changed).toEqual([ids()]);
    expect(M.icons.itemIconsVersion()).toBe(v0 + 1);
    expect(M.icons.itemIconStats().ids).toEqual(ids());
    expect(M.icons.itemIconStats().failed).toEqual([]);
    expect(previews.missing()).toEqual([]);
    expect(M.icons.itemIconHtml(ids()[0], 'cv-img')).toBe(`<img class="cv-img" src="${M.icons.itemIconUrl(ids()[0])}" alt="" draggable="false">`);
    // nothing shared was disposed by the pass
    expect(disposed).toEqual([]);
    previews.dispose();
  });

  it('a render leaves nothing behind: every object of the transient view is let go after its shot, the shared geometry / materials stay', async () => {
    const {look, disposed} = models();
    const built: THREE.Object3D[] = [], released = new Map<THREE.Object3D, number>();
    const real = look.build.bind(look);
    vi.spyOn(look, 'build').mockImplementation((def: EquipmentDef): EquipmentView => {
      const v = real(def);
      v.group.traverse(o => { built.push(o); (o as unknown as THREE.EventDispatcher<{dispose: object}>).addEventListener('dispose', () => released.set(o, (released.get(o) ?? 0) + 1)); });
      return v;
    });
    const previews = new M.preview.CraftPreviews({look: () => look}).install();
    const {renderer, log} = recorder();
    await M.icons.refreshItemIcons(renderer, previews.ids);
    const drawn = new Set(log.renders.flatMap(r => r.objects));
    expect(built.length).toBeGreaterThan(8);
    for (const o of built) {
      expect(drawn.has(o), o.name).toBe(true); // every view built for the pass was drawn ...
      expect(released.get(o), o.name).toBe(1); // ... and let go exactly once
      let top: THREE.Object3D = o;
      while (top.parent) top = top.parent;
      expect((top as THREE.Scene).isScene, o.name).not.toBe(true); // out of the pass's scene
    }
    expect(disposed).toEqual([]);
    // a second pass (the models changed): again fresh views, again let go — nothing accumulates
    const n = built.length;
    await M.icons.refreshItemIcons(renderer, previews.ids);
    expect(built.length).toBe(n * 2);
    expect(built.every(o => released.get(o) === 1)).toBe(true);
    expect(disposed).toEqual([]);
    previews.dispose();
  });

  it('a preview without its real models is skipped by the pass: no render, no picture — and an earlier real picture stays', async () => {
    const m = models({truck: false}); // only the chest is whole
    let look = m.look;
    const previews = new M.preview.CraftPreviews({look: () => look}).install();
    const {renderer, log} = recorder();
    await M.icons.refreshItemIcons(renderer, previews.ids);
    const chest = carryKinds().map(k => `equipment:${k}`), devices = dollyKinds().map(k => `equipment:${k}`);
    expect(log.renders).toHaveLength(chest.length);
    for (const id of chest) expect(M.icons.itemIconUrl(id), id).toBeTruthy();
    for (const id of devices) expect(M.icons.itemIconUrl(id), id).toBeNull();
    expect(previews.missing()).toEqual(devices);
    // later the Lockbox model is gone (a look without it): the chest's cached picture is kept, nothing new is drawn for it
    const url = M.icons.itemIconUrl(chest[0]);
    look = models({lockbox: false, truck: false}).look;
    await M.icons.refreshItemIcons(renderer, chest);
    expect(log.renders).toHaveLength(chest.length);
    expect(M.icons.itemIconUrl(chest[0])).toBe(url);
    previews.dispose();
    expect(M.icons.itemIconUrl(chest[0])).toBe(url); // (removing the source keeps the cache)
  });
});

describe('recipe previews: in the recipe row', () => {
  const sources = () => {
    const inv = new M.inventory.Inventory();
    inv.add(inv.makeStack(M.materials.SCRAP_METAL, 9));
    inv.add(inv.makeStack(M.materials.ELECTRICAL_PARTS, 9));
    return M.crafting.craftSources({inv});
  };

  it('the cached picture is the row\'s first child (left); a preview that is not there is the empty frame — never a glyph', async () => {
    const {look} = models({truck: false}); // the chest has its picture, the devices not yet
    const previews = new M.preview.CraftPreviews({look: () => look}).install();
    await M.icons.refreshItemIcons(recorder().renderer, previews.ids);
    const m = M.view.craftModel(sources(), () => null), html = M.view.craftRowsHtml(m);
    for (const r of m.rows) {
      const row = html.slice(html.indexOf(`data-kind="${r.kind}">`) + `data-kind="${r.kind}">`.length);
      const url = M.icons.itemIconUrl(r.preview);
      if (M.equipment.EQUIPMENT[r.kind].move === 'carry') {
        expect(url, r.kind).toBeTruthy();
        expect(row.startsWith(`<div class="cv-preview"><img class="cv-img" src="${url}" alt="" draggable="false"></div><div class="cv-what">`), r.kind).toBe(true);
      } else {
        expect(url, r.kind).toBeNull();
        expect(row.startsWith('<div class="cv-preview cv-empty"></div><div class="cv-what">'), r.kind).toBe(true);
      }
    }
    expect(html.match(/<img class="cv-img"/g)).toHaveLength(carryKinds().length);
    expect(html.match(/cv-preview cv-empty/g)).toHaveLength(dollyKinds().length);
    previews.dispose();
  });

  it('an open list redraws when one of its pictures arrives — not for other icons, not while closed', async () => {
    const {look} = models();
    const previews = new M.preview.CraftPreviews({look: () => look}).install();
    const view = new M.view.CraftView({model: () => M.view.craftModel(sources(), () => null), craft: () => {}, close: () => {}});
    const {renderer} = recorder();
    // closed: nothing is drawn
    await M.icons.refreshItemIcons(renderer, [previews.ids[0]]);
    expect(view.renders).toBe(0);
    view.show();
    expect(view.renders).toBe(1);
    // an icon the list does not show
    const off = M.icons.registerIconSource('equipment:elsewhere', {build: () => new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial())});
    await M.icons.refreshItemIcons(renderer, ['equipment:elsewhere']);
    expect(view.renders).toBe(1);
    off();
    // one of its previews
    await M.icons.refreshItemIcons(renderer, [previews.ids[1]]);
    expect(view.renders).toBe(2);
    view.hide();
    await M.icons.refreshItemIcons(renderer, previews.ids);
    expect(view.renders).toBe(2);
    previews.dispose();
  });
});

describe('recipe previews: when a render is requested', () => {
  /** A look whose views are real (a chest: no hand truck involved) and whose generation the test moves. */
  function fakeLook(real = true) {
    const look = {
      gen: 1, builds: 0, real,
      build(def: EquipmentDef): EquipmentView {
        look.builds++;
        const group = new THREE.Group();
        group.name = `train-equipment:${def.kind}`;
        const body = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.5, 0.5), new THREE.MeshStandardMaterial());
        group.add(body);
        return {group, body, gen: look.gen, standIn: !look.real, lid: null, lidRest: 0, lidOpen: 0};
      },
    };
    return look;
  }
  const chestOnly = () => M.recipes.RECIPES.filter(r => M.equipment.EQUIPMENT[r.kind].move === 'carry');
  const kindsOf = (list: readonly (readonly string[])[]) => list.map(l => l.map(id => id.replace('equipment:', '') as EquipmentKind));

  it('without a renderer (Node): nothing is ever requested, and a frame costs no view build', () => {
    const look = fakeLook();
    const previews = new M.preview.CraftPreviews({look: () => look}, chestOnly()).install();
    for (let i = 0; i < 600; i++) previews.tick();
    previews.opened();
    look.gen++;
    for (let i = 0; i < 600; i++) previews.tick();
    previews.opened();
    expect(look.builds).toBe(0);
    expect(previews.counts).toEqual({requests: 0, built: 0, held: 0});
    expect(previews.qa()).toMatchObject({renderer: false, busy: false, shown: {'equipment:chest': false}});
    // no equipment system at all
    const none = new M.preview.CraftPreviews({look: () => null, refreshIcons: () => { throw new Error('never'); }}).install();
    none.tick(); none.opened();
    expect(none.counts.requests).toBe(0);
    previews.dispose(); none.dispose();
  });

  it('once per look generation: thousands of frames and many opens ask once; a new generation asks once more', async () => {
    const look = fakeLook(), {renderer, log} = recorder();
    const asked: string[][] = [];
    const previews = new M.preview.CraftPreviews({look: () => look, refreshIcons: list => { asked.push([...list]); return M.icons.refreshItemIcons(renderer, list); }}, chestOnly()).install();
    for (let i = 0; i < 2000; i++) previews.tick();
    await previews.settled();
    expect(kindsOf(asked)).toEqual([['chest']]);
    expect(log.renders).toHaveLength(1);
    expect(previews.missing()).toEqual([]);
    const builds = look.builds;
    for (let i = 0; i < 2000; i++) previews.tick();
    for (let i = 0; i < 20; i++) previews.opened(); // nothing is missing: an open asks nothing
    await previews.settled();
    expect(asked).toHaveLength(1);
    expect(look.builds).toBe(builds); // (and builds no view)
    expect(log.renders).toHaveLength(1);
    // the models changed
    look.gen++;
    for (let i = 0; i < 2000; i++) previews.tick();
    await previews.settled();
    expect(asked).toHaveLength(2);
    expect(log.renders).toHaveLength(2);
    expect(previews.counts.requests).toBe(2);
    previews.dispose();
  });

  it('only previews with their real models are sent to the pass; when they arrive (a new generation) they are', async () => {
    const m = models({truck: false}), {renderer, log} = recorder();
    const asked: string[][] = [];
    const previews = new M.preview.CraftPreviews({look: () => m.look, refreshIcons: list => { asked.push([...list]); return M.icons.refreshItemIcons(renderer, list); }}).install();
    previews.tick();
    await previews.settled();
    expect(kindsOf(asked)).toEqual([carryKinds()]);
    expect(previews.missing()).toEqual(dollyKinds().map(k => `equipment:${k}`));
    // frames and opens meanwhile: the devices are still not whole — no request, no render
    for (let i = 0; i < 300; i++) previews.tick();
    previews.opened(); previews.opened();
    await previews.settled();
    expect(asked).toHaveLength(1);
    expect(log.renders).toHaveLength(carryKinds().length);
    // the hand truck's model arrives: the equipment system's poll moves the generation, the next frame asks for everything
    M.carts.setCartModelsForTests({truck: {scene: stubScene('truck', [0.5, 1.2, 0.5], [])} as unknown as GLTF, drum: null});
    const gen = m.look.gen;
    expect(m.look.poll(M.equipment.EQUIPMENT)).toBe(true);
    expect(m.look.gen).toBe(gen + 1);
    previews.tick();
    await previews.settled();
    expect(kindsOf(asked)[1]).toEqual(M.recipes.RECIPES.map(r => r.kind));
    expect(previews.missing()).toEqual([]);
    expect(Object.values(previews.qa().shown)).toEqual(ids().map(() => true));
    previews.dispose();
  });

  it('an open asks again only for what is missing (a readback that failed), never for what is there', async () => {
    const look = fakeLook(), {renderer, log} = recorder({failReadback: n => n <= 2}); // (the pass tries its second target too)
    const asked: string[][] = [];
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const previews = new M.preview.CraftPreviews({look: () => look, refreshIcons: list => { asked.push([...list]); return M.icons.refreshItemIcons(renderer, list); }}, chestOnly()).install();
    previews.tick();
    await previews.settled();
    expect(asked).toHaveLength(1);
    expect(previews.missing()).toEqual(['equipment:chest']); // the render failed: the frame stays empty
    for (let i = 0; i < 500; i++) previews.tick(); // frames do not retry (the generation is the same)
    await previews.settled();
    expect(asked).toHaveLength(1);
    previews.opened(); // the open does
    await previews.settled();
    expect(kindsOf(asked)).toEqual([['chest'], ['chest']]);
    expect(previews.missing()).toEqual([]);
    const renders = log.renders.length;
    previews.opened(); previews.opened();
    await previews.settled();
    expect(asked).toHaveLength(2);
    expect(log.renders).toHaveLength(renders);
    expect(warn).toHaveBeenCalled();
    previews.dispose();
  });

  it('one pass at a time, not before the renderer is ready, not while a warm-up owns it', async () => {
    const look = fakeLook();
    let ready = false, release!: () => void, finish!: () => void;
    let warm: Promise<void> | null = new Promise<void>(res => { release = res; });
    const asked: string[][] = [];
    const previews = new M.preview.CraftPreviews({
      look: () => look, rendererReady: () => ready, rendererFree: () => warm,
      refreshIcons: list => { asked.push([...list]); return new Promise<void>(res => { finish = res; }); },
    }, chestOnly()).install();
    // the renderer is not initialised yet: frames keep asking nothing (and remember nothing)
    for (let i = 0; i < 50; i++) previews.tick();
    expect([asked.length, previews.counts.requests, previews.qa().busy]).toEqual([0, 0, false]);
    ready = true;
    previews.tick();
    expect(previews.qa().busy).toBe(true);
    await Promise.resolve(); await Promise.resolve();
    expect(asked).toHaveLength(0); // a warm-up owns the renderer: the pass waits
    warm = null;
    release();
    await new Promise(res => setTimeout(res, 0));
    expect(asked).toHaveLength(1);
    // the models change while the pass runs: nothing overlaps it; the frame after it ends asks
    look.gen++;
    for (let i = 0; i < 30; i++) previews.tick();
    expect(asked).toHaveLength(1);
    expect(previews.counts.held).toBe(30);
    finish();
    await previews.settled();
    previews.tick();
    expect(asked).toHaveLength(2);
    finish();
    await previews.settled();
    // a refresh that throws is contained
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const bad = new M.preview.CraftPreviews({look: () => look, refreshIcons: () => Promise.reject(new Error('no'))}, chestOnly()).install();
    bad.tick();
    await bad.settled();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(bad.qa().busy).toBe(false);
    previews.dispose(); bad.dispose();
  });
});
