// TEMPORARY lane PERF probe (task mall-round2-20261031, M05). Not part of the delivered change: deleted before hand-off.
// Builds the real mall t3a (variant forced arcade-loop) exactly as mall-budget.test.ts does and, for the primary's 7 matched
// QA poses, emulates three r186's render-list construction (Renderer._projectObject + renderObject) for the scene pass and
// the flashlight shadow pass (SpotLightShadow camera, casters only, camera layers), attributing each draw by category.
import {mkdirSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import * as THREE from 'three';
import {describe, expect, it} from 'vitest';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {ShimContext, installCanvasShim} from './helpers/canvas2d';
import {fakeEnvTextures, loadStripped} from './helpers/openablesFixture';
import {LEVELS, arrivalPose} from '../src/levels/registry';
import {codeToSeed} from '../src/core/rng';
import {WorldMaterials} from '../src/world/materials';
import {buildWorld} from '../src/world/builder';
import {ContainerManager} from '../src/world/containers';
import {ShelfStock} from '../src/world/shelfStock';
import {fogCullDistance} from '../src/world/levelCulling';
import {mallQaPose} from '../src/gen/mall/qa';
import {setMallVariantOverride} from '../src/gen/mall/frame';
import {MALL_FOG} from '../src/world/mallAtmosphere';
import {p7ModelKeysFor, P7_FILES} from '../src/gen/props07';
import {officeModelKeysFor} from '../src/gen/office/index';
import {enemyModelKeysFor, ENEMY_MODEL_FILES} from '../src/ai/enemyModels';
import {selectLevelKeys} from '../src/assets/levelAssets';
import {MODEL_FILES} from '../src/assets/manifest';
import {OFFICE_MODEL_FILES} from '../src/assets/officeAssets';
import {COMPANY_MODEL_FILES, COMPANY_PART_MODEL_FILES} from '../src/assets/companyAssets';
import {MALL_MODEL_FILES} from '../src/assets/mallAssets';
import {lootProfile} from '../src/items/lootTables';
import {readTowerInfo} from '../src/world/towerShared';
import {buildElevatorView, planElevator} from '../src/world/elevator';
import {Inventory} from '../src/items/inventory';
import {markShadows} from '../src/render/volumetric';
import {visibleMeshes} from './helpers/visibleMeshes';

installCanvasShim(false);
for (const k of ['clip', 'rect']) (ShimContext.prototype as unknown as Record<string, unknown>)[k] ??= () => {};

const CATALOGUE = {...P7_FILES, ...OFFICE_MODEL_FILES, ...COMPANY_MODEL_FILES, ...COMPANY_PART_MODEL_FILES, ...ENEMY_MODEL_FILES, ...MALL_MODEL_FILES} as Record<string, {url: string; bytes: number}>;
const OUT = process.env.LL_PERF_OUT ?? '/tmp/perf-m05';

interface Item { mesh: THREE.Mesh; mat: THREE.Material; root: string; doubled: boolean }

/** three r186 _projectObject: visible chain, layers test per object, frustum (sphere), material groups; renderObject: transparent DoubleSide = 2 draws. */
function renderList(roots: {name: string; o: THREE.Object3D}[], cam: THREE.Camera, fr: THREE.Frustum, casterOnly: boolean, shadowCam = false): Item[] {
  const out: Item[] = [];
  const sph = new THREE.Sphere();
  const walk = (o: THREE.Object3D, root: string) => {
    if (!o.visible) return;
    if (o.layers.test(cam.layers)) {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        const im = m as THREE.InstancedMesh;
        let ok = true;
        if (im.isInstancedMesh && im.count === 0) ok = false;
        if (ok && m.frustumCulled !== false) {
          if (im.isInstancedMesh) { if (!im.boundingSphere) im.computeBoundingSphere(); sph.copy(im.boundingSphere!); } else { if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere(); sph.copy(m.geometry.boundingSphere!); }
          sph.applyMatrix4(m.matrixWorld);
          ok = fr.intersectsSphere(sph);
        }
        if (ok && (!casterOnly || m.castShadow)) {
          const mats = Array.isArray(m.material) ? m.geometry.groups.map(g => (m.material as THREE.Material[])[g.materialIndex!]).filter(Boolean) : [m.material as THREE.Material];
          for (const mt of mats) {
            if (!mt.visible) continue;
            // shadow pass: override material (opaque unless the source is transparent); transparent+DoubleSide doubles in both passes
            const doubled = mt.transparent && mt.side === THREE.DoubleSide && !mt.forceSinglePass && !shadowCam;
            out.push({mesh: m, mat: mt, root, doubled});
          }
        }
      }
    }
    for (const c of o.children) walk(c, root);
  };
  for (const r of roots) walk(r.o, r.name);
  return out;
}

/** Category of a render object (by name / ancestry / root). */
function category(it: Item): string {
  const m = it.mesh;
  if (it.root !== 'world') {
    let n = m.name;
    for (let p: THREE.Object3D | null = m; p && !n; p = p.parent) n = p.name;
    return `${it.root}:${(n || '?').replace(/[-_:|#\d.,]+.*$/, '')}`;
  }
  let n = m.name || '';
  if (!n) for (let p = m.parent; p && !n; p = p.parent) n = p.name;
  const short = n.replace(/\d+(\.\d+)?/g, '#').replace(/\|.*$/, '|*');
  return short.split(/[:]/)[0].slice(0, 48);
}

function draws(list: Item[]): number { return list.reduce((s, i) => s + (i.doubled ? 2 : 1), 0); }

function tally(list: Item[]): Record<string, {draws: number; meshes: number; inst: number; tris: number}> {
  const t: Record<string, {draws: number; meshes: number; inst: number; tris: number; seen?: Set<THREE.Mesh>}> = {};
  for (const it of list) {
    const c = category(it);
    const e = (t[c] ??= {draws: 0, meshes: 0, inst: 0, tris: 0, seen: new Set()});
    e.draws += it.doubled ? 2 : 1;
    if (!e.seen!.has(it.mesh)) {
      e.seen!.add(it.mesh); e.meshes++;
      const im = it.mesh as THREE.InstancedMesh, g = it.mesh.geometry;
      if (im.isInstancedMesh) e.inst++;
      e.tris += Math.round((g.index ? g.index.count : g.attributes.position.count) / 3 * (im.isInstancedMesh ? im.count : 1));
    }
  }
  for (const v of Object.values(t)) delete v.seen;
  return Object.fromEntries(Object.entries(t).sort((a, b) => b[1].draws - a[1].draws)) as never;
}

function eyeCam(x: number, floorY: number, z: number, yaw: number, pitch: number): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(75, 960 / 540, 0.05, MALL_FOG.far);
  cam.position.set(x, floorY + 1.62, z);
  cam.rotation.set(pitch, yaw, 0, 'YXZ');
  cam.updateMatrixWorld(true);
  cam.updateProjectionMatrix();
  return cam;
}

/** The flashlight's SpotLightShadow camera for the game's flashlight (game.ts: SpotLight(.., 30 m, 0.58 rad), camera-local offsets). */
function shadowCam(cam: THREE.PerspectiveCamera): THREE.PerspectiveCamera {
  const light = new THREE.SpotLight(0xffffff, 1, 30, 0.58, 0.7, 1.2);
  light.position.set(0.2, -0.15, 0.1);
  light.target.position.set(0.04, -0.12, -6);
  cam.add(light, light.target);
  cam.updateMatrixWorld(true);
  light.shadow.camera.near = 0.2;
  light.shadow.mapSize.set(1024, 1024);
  light.shadow.updateMatrices(light);
  const sc = light.shadow.camera as THREE.PerspectiveCamera;
  cam.remove(light, light.target);
  return sc;
}

function frustumOf(c: THREE.Camera): THREE.Frustum {
  c.updateMatrixWorld(true);
  return new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices((c as THREE.PerspectiveCamera).projectionMatrix, c.matrixWorldInverse));
}

describe('PERF M05 probe (temporary)', () => {
  it('per pass / category draws on the matched views', async () => {
    mkdirSync(OUT, {recursive: true});
    setMallVariantOverride(process.env.LL_PERF_VARIANT ?? 'arcade-loop');
    const layout = LEVELS.mall.generate(LEVELS.mall.entry, {levelSeed: codeToSeed('t3a')!, startWeapon: 'pistol'});
    setMallVariantOverride(null);
    const keys = selectLevelKeys('mall', [...new Set([...p7ModelKeysFor(layout), ...officeModelKeysFor(layout as never), ...enemyModelKeysFor(layout)])], CATALOGUE).keys;
    const models: Record<string, GLTF> = {};
    for (const k of keys) { if (!k.startsWith('enemy_')) models[k] = await loadStripped(CATALOGUE[k].url); }
    for (const k of ['light', 'sign', 'turnstile', 'bench', 'cabinetTall', 'cabinetLow', 'stall', 'vending', 'shelf', 'trashCan', 'crate', 'shopCounter', 'shopBackbar', 'shopCooler', 'shopDisplay', 'janitorCart', 'magazineRack', 'techDisplay'] as const) {
      models[k] ??= await loadStripped((MODEL_FILES as Record<string, {url: string}>)[k].url);
    }
    const lb = new THREE.Box3().setFromObject(models.light.scene).getSize(new THREE.Vector3());
    const mats = new WorldMaterials(fakeEnvTextures(), 20261025, {w: lb.x, h: lb.y, d: lb.z});
    const t0 = performance.now();
    const world = buildWorld(layout, mats, models);
    const buildMs = performance.now() - t0;
    const cm = new ContainerManager(models, mats, () => new Inventory());
    cm.build(layout, models, lootProfile('mall'));
    const stock = new ShelfStock();
    stock.build(layout, {models, lotsOf: () => []});
    // game.ts buildSection: shadow marking, then culler registration of containers / stock
    markShadows(world.group, true, true);
    markShadows(cm.group, true, true);
    markShadows(stock.group, true, false);
    world.culler.register(cm.group);
    world.culler.register(stock.group);
    const lift = readTowerInfo(layout)?.elevator;
    const liftRoot = new THREE.Group();
    if (lift) {
      const view = buildElevatorView(planElevator(lift), mats, {glass: true});
      view.setCab(lift.stops[0].y, 0);
      liftRoot.add(view.root);
      for (const g of view.landings) world.culler.register(g);
    }
    world.culler.maxDistance = Math.min(fogCullDistance(MALL_FOG.density), MALL_FOG.far);
    const roots = [{name: 'world', o: world.group as THREE.Object3D}, {name: 'containers', o: cm.group}, {name: 'stock', o: stock.group}, {name: 'lift', o: liftRoot}];
    for (const r of roots) r.o.updateMatrixWorld(true);

    // whole-level census by category
    const all: Item[] = [];
    const allCam = new THREE.PerspectiveCamera();
    allCam.layers.enableAll();
    const allFr = new THREE.Frustum(); allFr.planes.forEach(p => p.set(new THREE.Vector3(0, 0, 0), 1)); // everything in
    all.push(...renderList(roots, allCam, allFr, false));

    const extra = (process.env.LL_PERF_EXTRA ?? '').split(';').filter(Boolean).map(t => t.split(',')); // name,ring,yaw,pitch
    const poses: [string, Parameters<typeof mallQaPose>[1] | 'start', number?, number?, number?][] = [...extra.map(([n, r, y, pt]) => [`${n}${r}@${y}`, n, r === '' ? undefined : +r, +y, +pt] as [string, Parameters<typeof mallQaPose>[1], number?, number?, number?]), ['start', 'start'], ['platform-lookup', 'platform-lookup'], ['escalator1', 'escalator', 1], ['ring-edge2', 'ring-edge', 2], ['court1', 'court'], ['corridor1', 'corridor', 1], ['shopfront1', 'shopfront', 1]];
    const report: Record<string, unknown> = {variant: layout.mall?.variant ?? (layout as {mall?: {variant?: string}}).mall?.variant, buildMs: Math.round(buildMs), level: {items: all.length, draws: draws(all), byCat: tally(all)}, culler: {registered: world.culler.stats.registered, uncullable: world.culler.stats.uncullable}};
    const summary: string[] = [];
    for (const [label, name, ring, yawO, pitchO] of poses) {
      let p: {x: number; y: number; z: number; yaw: number; pitch: number} | null;
      if (name === 'start') {
        const a = arrivalPose(layout, {kind: 'start'} as never);
        const lv = a.level ?? 0;
        p = {x: a.x, y: a.y ?? (lv > 0 ? layout.levels[lv].grid : layout.grid).floorAt(a.x, a.z), z: a.z, yaw: a.yaw, pitch: (a as {pitch?: number}).pitch ?? 0};
      } else p = mallQaPose(layout, name, ring);
      if (p && yawO !== undefined) p = {...p, yaw: yawO, pitch: pitchO ?? p.pitch};
      if (!p) { summary.push(`${label}: no pose`); continue; }
      const cam = eyeCam(p.x, p.y, p.z, p.yaw, p.pitch);
      const fl = new THREE.SpotLight(0xffffff, 1, 30, 0.58, 0.7, 1.2); fl.position.set(0.2, -0.15, 0.1); cam.add(fl); cam.updateMatrixWorld(true);
      world.culler.viewpoints = [fl];
      const measure = (occ: boolean) => {
        world.culler.occlusion = occ;
        const tu = performance.now();
        for (let k = 0; k < 10; k++) world.culler.update(cam, true);
        const ms = (performance.now() - tu) / 10;
        const scene = renderList(roots, cam, frustumOf(cam), false);
        const sc = shadowCam(cam);
        sc.layers.mask = cam.layers.mask;
        const shadow = renderList(roots, sc, frustumOf(sc), true, true);
        return {ms, scene, shadow, sc, occl: world.culler.occlusionCulled};
      };
      const off = measure(false);
      const on = measure(true);
      const {scene, shadow} = on;
      summary.push(`${label}: culler.update off ${off.ms.toFixed(3)} ms / on ${on.ms.toFixed(3)} ms; occlusion-culled ${on.occl}`);
      summary.push(`${label}: BEFORE scene ${draws(off.scene)} + shadow ${draws(off.shadow)} = ${draws(off.scene) + draws(off.shadow)} (mats ${new Set(off.scene.map(i => i.mat.uuid)).size}) | AFTER scene ${draws(scene)} + shadow ${draws(shadow)} = ${draws(scene) + draws(shadow)} (mats ${new Set(scene.map(i => i.mat.uuid)).size})`);
      // oracle: no mesh visible from the eye (or from the flashlight, through its shadow camera) may sit on the cull layer by occlusion
      {
        const allRoot = new THREE.Group();
        for (const r of roots) allRoot.add(r.o);
        const culledMask = 1 << 31;
        const occluded = new Set(world.culler.entries.filter(e => e.occluded).map(e => e.obj));
        const seenEye = visibleMeshes(allRoot, cam, 480, 270, {minPx: 1});
        const sc = on.sc as THREE.PerspectiveCamera;
        const seenLight = visibleMeshes(allRoot, sc, 256, 256, {minPx: 1});
        for (const r of roots) allRoot.remove(r.o);
        const badEye = [...seenEye.keys()].filter(m => occluded.has(m)).map(m => `${m.name} ${seenEye.get(m)}px`);
        const badLight = [...seenLight.keys()].filter(m => occluded.has(m)).map(m => `${m.name} ${seenLight.get(m)}px`);
        const anyCulled = [...seenEye.keys()].filter(m => m.layers.mask === culledMask).length;
        // drawn-but-oracle-hidden (scene pass, after) by storey relation / box extent / name family
        const bb = new THREE.Box3(); const rel: Record<string, number> = {}; const eyeLv = world.culler.stats.levels;
        for (const it of scene) {
          if (seenEye.has(it.mesh)) continue;
          const en = world.culler.entries.find(e => e.obj === it.mesh);
          const im = it.mesh as THREE.InstancedMesh;
          if (im.isInstancedMesh) { im.computeBoundingBox(); bb.copy(im.boundingBox!).applyMatrix4(im.matrixWorld); } else bb.setFromObject(it.mesh);
          const sz = bb.getSize(new THREE.Vector3()), ext = Math.max(sz.x, sz.z);
          const lv = en ? (en.levels ? 'multi' : Number.isNaN(en.level) ? 'nan' : eyeLv.includes(en.level) ? 'same' : 'other') : 'unreg';
          const key = `${lv}|${ext < 4 ? '<4' : ext < 12 ? '4-12' : ext < 24 ? '12-24' : '>24'}|${category(it).slice(0, 22)}`;
          rel[key] = (rel[key] ?? 0) + (it.doubled ? 2 : 1);
        }
        (report[label] as Record<string, unknown> ?? {});
        writeFileSync(`${OUT}/hidden-${label}.json`, JSON.stringify(Object.fromEntries(Object.entries(rel).sort((a, b) => b[1] - a[1])), null, 1));
        summary.push(`${label}: ORACLE eye-visible ${seenEye.size}, light-visible ${seenLight.size}; occluded-but-visible eye [${badEye.join(', ')}] light [${badLight.join(', ')}]; eye-visible on cull layer (any rule) ${anyCulled}`);
      }
      const transparent = scene.filter(i => i.mat.transparent);
      const progs = new Set(scene.map(i => i.mat.uuid));
      const sd = draws(scene), hd = draws(shadow);
      report[label] = {pose: p, before: {scene: draws(off.scene), shadow: draws(off.shadow), sceneByCat: tally(off.scene), shadowByCat: tally(off.shadow)}, scene: {draws: sd, items: scene.length, transparentDraws: draws(transparent), doubled: scene.filter(i => i.doubled).length, materials: progs.size, byCat: tally(scene)},
        shadow: {draws: hd, byCat: tally(shadow)}, culler: {culled: world.culler.stats.culled, fogged: world.culler.stats.fogged, slab: world.culler.slabCulled, occl: world.culler.occlusionCulled, levels: world.culler.stats.visibleLevels}};
      summary.push(`${label}: scene ${sd} (transparent ${draws(transparent)}, doubled ${scene.filter(i => i.doubled).length}, mats ${progs.size}) + shadow ${hd} = ${sd + hd}`);
    }
    // culler cost profile at two poses: (slabs, occlusion) on/off, forced updates
    {
      const prof: string[] = [];
      for (const [label, name, ring] of [['start', 'platform-lookup', undefined], ['court1', 'court', undefined], ['ring-edge2', 'ring-edge', 2]] as const) {
        const p = mallQaPose(layout, name, ring)!;
        const cam = eyeCam(p.x, p.y, p.z, p.yaw, p.pitch);
        const fl = new THREE.SpotLight(0xffffff, 1, 30, 0.58, 0.7, 1.2); fl.position.set(0.2, -0.15, 0.1); cam.add(fl); cam.updateMatrixWorld(true);
        world.culler.viewpoints = [fl];
        const row: string[] = [];
        for (const [sl, oc, en] of [[true, true, true], [true, false, true], [false, false, true], [false, false, false]] as const) {
          world.culler.slabs = sl; world.culler.occlusion = oc; world.culler.enabled = en;
          for (let k = 0; k < 5; k++) world.culler.update(cam, true);
          const t = performance.now();
          for (let k = 0; k < 40; k++) world.culler.update(cam, true);
          row.push(`slabs ${sl} occl ${oc} enabled ${en}: ${((performance.now() - t) / 40).toFixed(3)} ms`);
        }
        world.culler.slabs = true; world.culler.occlusion = true; world.culler.enabled = true;
        // refresh-only cost (camera moved 2 cm: below the full-update threshold)
        world.culler.update(cam, true);
        const t2 = performance.now();
        for (let k = 0; k < 40; k++) { cam.position.x += (k % 2 ? -0.02 : 0.02); cam.updateMatrixWorld(true); world.culler.update(cam); }
        row.push(`occlusion refresh between full updates: ${((performance.now() - t2) / 40).toFixed(3)} ms`);
        prof.push(`${label}: ${row.join(' | ')}`);
      }
      writeFileSync(`${OUT}/culler-cost.txt`, prof.join('\n'));
    }
    // yaw sweep (12 directions) at each pose position: the worst direction (scene + shadow draws, static world only)
    const sweep: string[] = [];
    for (const [label, name, ring] of [...poses.filter(q => q[3] === undefined), ['ring-edge1', 'ring-edge', 1], ['ring-edge3', 'ring-edge', 3], ['escalator0', 'escalator', 0], ['escalator2', 'escalator', 2], ['shopfront3', 'shopfront', 3], ['corridor3', 'corridor', 3], ['wing-end2', 'wing-end', 2], ['elevator', 'elevator'], ['washrooms1', 'washrooms', 1]] as typeof poses) {
      if (name === 'start') continue;
      const p = mallQaPose(layout, name, ring);
      if (!p) continue;
      let best = {yaw: 0, pitch: 0, s: 0, h: 0, s1: 0, h1: 0};
      let worstAfter = 0;
      for (let k = 0; k < 12; k++) for (const pitch of [p.pitch, 0, -0.35, 0.5]) {
        const yaw = p.yaw + k * Math.PI / 6;
        const cam = eyeCam(p.x, p.y, p.z, yaw, pitch);
        const fl = new THREE.SpotLight(0xffffff, 1, 30, 0.58, 0.7, 1.2); fl.position.set(0.2, -0.15, 0.1); cam.add(fl); cam.updateMatrixWorld(true);
        world.culler.viewpoints = [fl];
        const one = (occ: boolean) => {
          world.culler.occlusion = occ;
          world.culler.update(cam, true);
          const s = draws(renderList(roots, cam, frustumOf(cam), false));
          const sc = shadowCam(cam); sc.layers.mask = cam.layers.mask;
          return [s, draws(renderList(roots, sc, frustumOf(sc), true, true))];
        };
        const [s0, h0] = one(false), [s1, h1] = one(true);
        if (s0 + h0 > best.s + best.h) best = {yaw: +yaw.toFixed(3), pitch, s: s0, h: h0, s1, h1};
        worstAfter = Math.max(worstAfter, s1 + h1);
      }
      sweep.push(`${label} @(${p.x},${p.y},${p.z}) worst-before yaw ${best.yaw} pitch ${best.pitch}: BEFORE scene ${best.s} + shadow ${best.h} = ${best.s + best.h} | AFTER same view ${best.s1} + ${best.h1} = ${best.s1 + best.h1}; worst after over the sweep ${worstAfter}`);
    }
    writeFileSync(`${OUT}/sweep.txt`, sweep.join('\n'));
    writeFileSync(`${OUT}/probe.json`, JSON.stringify(report, null, 1));
    writeFileSync(`${OUT}/summary.txt`, summary.join('\n'));
    expect(summary.length).toBeGreaterThan(7);
  }, 600_000);
});
