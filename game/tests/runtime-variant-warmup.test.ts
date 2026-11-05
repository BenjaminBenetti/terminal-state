// Task runtime-variant-warmup-20261105 (user, after the native Office recapture: "Warm up anything you can basically! many of the
// stutters are warm up stutters"): render/runtimeVariants.ts — hidden prototypes of variants that only appear through play, built by
// the REAL runtime factories, compiled by the loading warm-up / the journey job as a registered pool.
//  1. the pool: one prototype per variant key (a structural mirror of three r186's value-based key), hidden, owned resources released
//     through the caller's retire queue only;
//  2. the prototype builders are the real factories and pure: an openable kind's prototypes carry exactly the variant keys a real
//     takeover's meshes have (geometry, material values, shadow flags); highlight prototypes use the SAME cached clone setHighlight
//     puts on the aimed mesh; damaged prototypes cover what a real detach draws (non-instanced, non-indexed extracts, the source's
//     flags); flesh prototypes are the real chunkMaterial per signature — and none of it changes holders, slots, damage state or RNG;
//  3. on the REAL mall (t3a) through three r186's REAL WebGPURenderer (no-op device), ONE full warm-up whose pool holds only half the
//     kinds' prototypes (B): real aims (takeover + highlight), real detaches and a real torn flesh chunk on the OTHER half (A, control)
//     build node variants in the frames after; the same interactions on B kinds — and the chunk — build NONE.
import * as THREE from 'three';
import {afterAll, describe, expect, it, vi} from 'vitest';
import {appendFileSync, writeFileSync} from 'node:fs';
import {stubWebgpuGlobals} from './helpers/fakeWebgpu';
import {WarmupRegistry, geometryKey, planWarmup, runWarmup, type WarmupRenderer} from '../src/render/warmup';
import {renderContextDepth} from '../src/render/renderContextDepth';
import {installShadowAlphaTwin} from '../src/render/shadowOverride';
import {RuntimeVariantPool, drawsDoublePass, materialKey, ownShadowNodes, variantKey} from '../src/render/runtimeVariants';
import {DamageSystem} from '../src/damage/system';
import {CHUNK_PHYS} from '../src/damage/materials';
import {woundsOf} from '../src/damage/wounds';
import {fallbackFlap} from '../src/damage/fleshPatch';
import {PhysicsSystem} from '../src/physics/world';
import {chunkSignature} from '../src/physics/chunks';
import {eyeCam, realMallScene, startPose} from './helpers/rendercpuMall';

const LOG = '/tmp/rvw-runtime-variant-test.txt';
const log = (s: string) => { try { appendFileSync(LOG, s + '\n'); } catch { /* best effort */ } };
afterAll(() => vi.unstubAllGlobals());

describe('runtime-variant pool (render/runtimeVariants.ts)', () => {
  it('materialKey: value-based like three (clones equal; identity / name / colour / texture image ignored; side, maps and samplers count)', () => {
    const t1 = new THREE.Texture(), t2 = new THREE.Texture();
    const a = new THREE.MeshStandardMaterial({color: 0x112233, map: t1, roughness: 0.5});
    const b = a.clone(); b.name = 'other'; b.color.set(0xffffff); b.map = t2;
    expect(materialKey(b)).toBe(materialKey(a));
    const c = a.clone(); c.side = THREE.DoubleSide;
    expect(materialKey(c)).not.toBe(materialKey(a));
    const d = a.clone(); d.map = null;
    expect(materialKey(d)).not.toBe(materialKey(a));
    const e = a.clone(); e.map = t2.clone(); e.map.wrapS = THREE.RepeatWrapping;
    expect(materialKey(e)).not.toBe(materialKey(a)); // (WebGPU binds the sampler)
    const f = a.clone(); f.roughness = 0;
    expect(materialKey(f)).not.toBe(materialKey(a)); // numbers on / off
  });

  it('keeps one hidden prototype per variant key; releases ONLY what it owns, through the retire queue', () => {
    const pool = new RuntimeVariantPool();
    expect(pool.root.visible).toBe(false);
    const g = new THREE.BoxGeometry(), owned = new THREE.BoxGeometry(), m = new THREE.MeshStandardMaterial();
    const lit = (o: THREE.Mesh) => { o.castShadow = true; o.receiveShadow = true; return o; };
    const st = pool.rebuild([{name: 'takeover', meshes: [new THREE.Mesh(g, m), new THREE.Mesh(g, m.clone()), lit(new THREE.Mesh(g, m))]}, {name: 'flesh', meshes: [new THREE.Mesh(owned, m)]}],
      {geometries: [owned]});
    expect(st.families).toEqual({takeover: {offered: 3, kept: 2}, flesh: {offered: 1, kept: 0}}); // (the flesh one = the first takeover's key)
    expect([st.prototypes, st.casters, pool.root.children.length]).toEqual([2, 1, 2]);
    const shared = vi.spyOn(g, 'dispose'), mine = vi.spyOn(owned, 'dispose'), mat = vi.spyOn(m, 'dispose');
    const queue: (() => void)[] = [];
    pool.clear(fn => queue.push(fn));
    expect([pool.root.children.length, mine.mock.calls.length, queue.length]).toEqual([0, 0, 1]); // deferred
    queue[0]();
    expect([mine.mock.calls.length, shared.mock.calls.length, mat.mock.calls.length]).toEqual([1, 0, 0]);
  });

  it('a caster whose material has a map / colour node keeps its material INSTANCE in the key (three builds its shadow variant per instance)', () => {
    const g = new THREE.BoxGeometry(), map = new THREE.Texture();
    const mesh = (m: THREE.Material, cast: boolean) => { const o = new THREE.Mesh(g, m); o.castShadow = cast; return o; };
    const mapped = new THREE.MeshStandardMaterial({map}), plain = new THREE.MeshStandardMaterial();
    expect([ownShadowNodes(mapped), ownShadowNodes(plain)]).toEqual([true, false]);
    expect(variantKey(mesh(mapped.clone(), true))).not.toBe(variantKey(mesh(mapped, true)));
    expect(variantKey(mesh(mapped.clone(), false))).toBe(variantKey(mesh(mapped, false))); // (the scene variant is shared)
    expect(variantKey(mesh(plain.clone(), true))).toBe(variantKey(mesh(plain, true)));
  });

  it('a transparent DoubleSide prototype gets BackSide / FrontSide copies keyed like three\'s two draws; the pool owns only the copies', () => {
    const g = new THREE.BoxGeometry();
    const glass = new THREE.MeshStandardMaterial({transparent: true, side: THREE.DoubleSide, alphaTest: 0.25});
    expect([drawsDoublePass(glass), drawsDoublePass(new THREE.MeshStandardMaterial({transparent: true}))]).toEqual([true, false]);
    const proto = new THREE.Mesh(g, glass);
    proto.receiveShadow = true;
    const pool = new RuntimeVariantPool();
    const st = pool.rebuild([{name: 'damaged', meshes: [proto]}]);
    expect([st.prototypes, st.sideProxies, st.sideMismatch]).toEqual([3, 2, 0]);
    expect(glass.side).toBe(THREE.DoubleSide); // (restored)
    const copies = pool.root.children.filter(o => o !== proto) as THREE.Mesh[];
    for (const [c, side] of copies.map((c, i) => [c, i ? THREE.FrontSide : THREE.BackSide] as const)) {
      const m = c.material as THREE.Material;
      expect([m.side, m.alphaTest, m.transparent, c.castShadow, c.receiveShadow, c.geometry === g]).toEqual([side, 0.25, true, false, true, true]);
      glass.side = side;
      expect(materialKey(m)).toBe(materialKey(glass));
      glass.side = THREE.DoubleSide;
    }
    const own = vi.spyOn(glass, 'dispose'), mine = copies.map(c => vi.spyOn(c.material as THREE.Material, 'dispose'));
    pool.clear();
    expect([own.mock.calls.length, ...mine.map(s => s.mock.calls.length)]).toEqual([0, 1, 1]);
  });
});

// --- the real mall ---------------------------------------------------------------------------------------------------------------

interface Counters { builds: number; built: string[] }

/** A real renderer on the no-op device; node builds counted with the rendered object / material named. */
async function renderer() {
  const canvas = stubWebgpuGlobals();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  const W = await import('three/webgpu');
  const TSL = await import('three/tsl');
  const r = new W.WebGPURenderer({canvas});
  await r.init();
  installShadowAlphaTwin(r);
  r.shadowMap.enabled = true;
  r.shadowMap.type = THREE.PCFShadowMap;
  const n: Counters = {builds: 0, built: []};
  const R = r as unknown as {backend: {createNodeBuilder: (...a: unknown[]) => unknown}; _nodes: {nodeFrame: {update(): void}; _createNodeBuilder: (...a: unknown[]) => unknown}};
  const cnb = R.backend.createNodeBuilder.bind(R.backend);
  R.backend.createNodeBuilder = (...a: unknown[]) => {
    n.builds++;
    const o = a[0] as THREE.Mesh, mat = (o as unknown as {material?: THREE.Material}).material as THREE.Material | undefined;
    if (n.built.length < 60) n.built.push(`${o?.name ?? '?'}|${Array.isArray(mat) ? 'multi' : mat?.name ?? '?'}`);
    return cnb(...a);
  };
  return {r, W, TSL, n, nodeFrame: R._nodes.nodeFrame};
}

const meshesOf = (root: THREE.Object3D) => { const out: THREE.Mesh[] = []; root.traverse(o => { if ((o as THREE.Mesh).isMesh) out.push(o as THREE.Mesh); }); return out; };

describe('the real mall: prototypes are the real factories, pure, and leave nothing to build on first real use', () => {
  it('A/B: control kinds build on first aim / detach; kinds with prototypes — and a torn flesh chunk — build nothing', async () => {
    writeFileSync(LOG, '');
    const k = await renderer();
    const M = await realMallScene('t3a');
    const scene = M.scene, cm = M.cm, c = M.world.culler;
    scene.add(new THREE.HemisphereLight(0x9aa4b0, 0x2a2622, 0.35));
    const cam = eyeCam(startPose(M.layout));
    scene.add(cam);
    const fl = new THREE.SpotLight(0xfff4e2, 1, 30, 0.58, 0.7, 1.2);
    fl.position.set(0.2, -0.15, 0.1);
    fl.target.position.set(0.04, -0.12, -6);
    fl.castShadow = true;
    fl.shadow.mapSize.set(1024, 1024);
    cam.add(fl, fl.target);
    c.viewpoints = [fl];
    // the damage system + physics as Game.buildSection wires them (shared-instance index, holders' own meshes, flesh chunks)
    const ph = new PhysicsSystem(scene);
    ph.build(M.layout as never);
    const damage = new DamageSystem(null, null);
    scene.add(damage.group);
    damage.build(M.layout, null, [M.world.group, cm.group], {ownMeshes: p => cm.ownMeshes(p), physics: ph});
    for (const e of M.enemies) damage.installZombie(e as never);
    const scenePass = k.TSL.pass(scene, cam, {samples: 4}) as unknown as {renderTarget: unknown};
    const pipe = new k.W.RenderPipeline(k.r, scenePass as never);
    const frame = () => { k.r.info.reset(); k.nodeFrame.update(); k.r.setRenderTarget(null); pipe.render(); };
    (cm as unknown as {lastEye: THREE.Vector3}).lastEye.copy(cam.position);
    (cm as unknown as {dirty: boolean}).dirty = true;
    cm.update(0.2, 0);
    c.update(cam, true);

    // --- the kinds present, split A (control) / B (prototyped) ---
    const openKinds: string[] = [...new Set(cm.openList.map(h => h.kind as string))].sort();
    const propKinds: string[] = [...new Set([...damage.props.index.inst.keys()].map(p => p.kind as string))].filter(kd => !openKinds.includes(kd)).sort();
    const A = new Set<string>([...openKinds.filter((_, i) => i % 2 === 0), ...propKinds.filter((_, i) => i % 2 === 0)]);
    const B = new Set<string>([...openKinds.filter((_, i) => i % 2 === 1), ...propKinds.filter((_, i) => i % 2 === 1)]);
    log(`openable kinds ${openKinds.join(',')}; prop kinds ${propKinds.length}; A ${A.size} B ${B.size}`);
    expect(openKinds.length).toBeGreaterThanOrEqual(2);

    // --- the prototypes (all families), checked for purity / equivalence, then filtered to B for the pool ---
    const kindOf = (name: string) => /^(?:openable|damaged)-([A-Za-z0-9]+)/.exec(name)?.[1] ?? '';
    const before = {active: cm.openables.active.size, takeovers: cm.openables.stats.takeovers, states: damage.props.states.size, clones: damage.props.clones};
    const t0 = performance.now();
    const proto = cm.runtimeVariantPrototypes();
    const dmg = damage.props.variantPrototypes(proto.own);
    const dmgB = damage.props.variantPrototypes(proto.own.filter(m => B.has(kindOf(m.name))), B); // (B's own de-duplication: a material B shares with A keeps a B prototype)
    const layers = M.enemies.flatMap(e => woundsOf(e as never)?.layers.map(l => l.material) ?? []);
    const flesh = ph.chunks.fleshPrototypes(layers);
    const buildMs = performance.now() - t0;
    expect({active: cm.openables.active.size, takeovers: cm.openables.stats.takeovers, states: damage.props.states.size, clones: damage.props.clones}).toEqual(before); // pure
    expect(new Set(layers.map(chunkSignature)).size).toBe(flesh.meshes.length);
    const inB = (m: THREE.Mesh) => B.has(kindOf(m.name));
    const pool = new RuntimeVariantPool();
    const st = pool.rebuild([
      {name: 'takeover', meshes: proto.takeover.filter(inB)}, {name: 'highlight', meshes: proto.highlight.filter(inB)},
      {name: 'damaged', meshes: dmgB.meshes}, {name: 'flesh', meshes: flesh.meshes},
    ], {geometries: [...dmgB.geometries, ...flesh.geometries]});
    for (const g of dmg.geometries) g.dispose(); // (the all-kinds set: counted, then dropped)
    scene.add(pool.root);
    { // (report: the game's pool — every family, all kinds — and what it adds to the 'full' plan; the test's pool is B only)
      const all = new RuntimeVariantPool(), dAll = damage.props.variantPrototypes(proto.own);
      const sa = all.rebuild([
        {name: 'takeover', meshes: cm.runtimeVariantPrototypes().takeover}, {name: 'highlight', meshes: cm.runtimeVariantPrototypes().highlight},
        {name: 'damaged', meshes: dAll.meshes}, {name: 'flesh', meshes: ph.chunks.fleshPrototypes(layers).meshes},
      ], {geometries: dAll.geometries});
      scene.add(all.root);
      const plan = (pools: THREE.Object3D[]) => planWarmup(scene, {mode: 'full', cameraMask: cam.layers.mask, pools: [cm.group, ...(M.liftRoot ? [M.liftRoot] : []), ...pools]});
      const without = plan([]), withAll = plan([all.root]);
      const dmgMats = [...(damage.props as unknown as {damageMats: Map<unknown, Map<string, unknown>>}).damageMats.values()].reduce((n, m) => n + m.size, 0);
      const bytes = (g: THREE.BufferGeometry) => Object.values(g.attributes).reduce((n, a) => n + ((a as THREE.BufferAttribute).array?.byteLength ?? 0), g.index?.array.byteLength ?? 0);
      log(`game pool memory: ${dmgMats} station damage materials (shared with detach), owned geometry ${dAll.geometries.length} extracts ${dAll.geometries.reduce((n, g) => n + bytes(g), 0)} B (+ flesh flaps), the rest references live geometry / materials`);
      log(`game pool (all kinds): ${sa.prototypes} prototypes (${sa.casters} casters, ${sa.sideProxies} side proxies) ${JSON.stringify(sa.families)} · 'full' plan items ${without.items.length} -> ${withAll.items.length} (+${withAll.items.length - without.items.length}), casters ${without.items.filter(i => i.caster).length} -> ${withAll.items.filter(i => i.caster).length}`);
      scene.remove(all.root);
      all.clear();
    }
    log(`prototypes (all families) takeover ${proto.takeover.length} highlight ${proto.highlight.length} damaged ${dmg.meshes.length} flesh ${flesh.meshes.length}; built in ${buildMs.toFixed(1)} ms; pool (B) ${JSON.stringify(st.families)} casters ${st.casters} side proxies ${st.sideProxies} (mismatch ${st.sideMismatch})`);
    expect(st.families.takeover.kept).toBeGreaterThan(0);
    expect(st.families.highlight.offered).toBeGreaterThan(0); // (kept 0 when every aim clone keys like its base: three shares the build)
    expect(st.families.damaged.kept).toBeGreaterThan(0);
    expect(st.families.flesh.kept).toBeGreaterThan(0);

    // --- ONE full warm-up (the game's path: the pool registered) ---
    const reg = new WarmupRegistry();
    if (M.liftRoot) reg.addPool('tower', () => [M.liftRoot!]);
    reg.addPool('holders', () => [cm.group]);
    reg.addPool('runtime-variants', () => [pool.root]);
    const tw = performance.now();
    const res = await runWarmup({
      renderer: k.r as unknown as WarmupRenderer, scene, camera: cam, mode: 'full', registry: reg,
      sceneTarget: () => scenePass.renderTarget, torch: fl, torchIntensity: 1, frame, finish: () => { c.update(cam, true); frame(); },
      hide: () => {}, alive: () => true,
      sceneDepth: () => { const m = cam.layers.mask; cam.layers.mask = 0; try { return renderContextDepth(k.r, scenePass.renderTarget, frame) ?? 0; } finally { cam.layers.mask = m; } },
    }, {yieldFrame: () => Promise.resolve()});
    log(`warm-up ${res.status} ${(performance.now() - tw).toFixed(0)} ms · items ${res.plan.items} (flipped ${res.plan.flipped}) casters ${res.plan.casters} others ${res.plan.others} · shadow frames ${res.stages.shadows.total}`);
    expect(res.status).toBe('complete');

    // --- real interactions, drawn in the frames after (both passes: the torch is lit, every new mesh unculled on the camera layers) ---
    const show = (meshes: readonly THREE.Mesh[]) => { for (const m of meshes) { m.frustumCulled = false; m.layers.mask = cam.layers.mask; } };
    const setHighlight = (h: unknown, part: number) => (cm as unknown as {setHighlight(h: unknown, p: number): void}).setHighlight(h, part);
    const openList = cm.openList;
    const interact = (kinds: ReadonlySet<string>) => {
      let meshes = 0;
      const b0 = k.n.builds;
      for (const kd of kinds) {
        const h = openList.find(x => x.kind === kd);
        if (h) {
          setHighlight(h, 0); // aim: the takeover + the highlight on the aimed part, drawn while aimed
          const own = h.open?.root ? meshesOf(h.open.root) : [];
          show(own); meshes += own.length;
          frame(); frame();
          setHighlight(null, -1);
          const s = damage.props.state(h.prop); // then shot: damage takes its own meshes over (hooked base materials)
          if (damage.props.detach(s, true)) { const parts = (s.parts ?? []).map(q => q.mesh); show(parts); meshes += parts.length; frame(); frame(); }
          continue;
        }
        const p = [...damage.props.index.inst.keys()].find(x => x.kind === kd);
        if (!p) continue;
        const s = damage.props.state(p);
        if (damage.props.detach(s, true)) { const parts = (s.parts ?? []).map(q => q.mesh); show(parts); meshes += parts.length; frame(); frame(); }
      }
      return {builds: k.n.builds - b0, meshes};
    };
    const control = interact(A);
    // (diagnostics for phase B: every node build's render object / material / pass, and whether its variant key was prototyped)
    const poolKeys = new Set(meshesOf(pool.root).map(variantKey));
    const builtB: string[] = [];
    const NM = (k.r as unknown as {_nodes: {_createNodeBuilder: (ro: unknown, m: unknown) => unknown}})._nodes;
    const orig = NM._createNodeBuilder.bind(NM);
    NM._createNodeBuilder = (ro: unknown, mat: unknown) => {
      const o = (ro as {object: THREE.Mesh}).object, m = mat as THREE.Material & {isShadowPassMaterial?: boolean};
      const probe = new THREE.Mesh(o.geometry, m); probe.receiveShadow = o.receiveShadow; probe.castShadow = o.castShadow;
      if (builtB.length < 200) builtB.push(`${o.name}|${m.isShadowPassMaterial ? 'SHADOW of ' + ((o.material as THREE.Material)?.name ?? '?') : m.name + ':' + m.type}|inst ${(o as THREE.InstancedMesh).isInstancedMesh ? 1 : 0}|rs ${o.receiveShadow ? 1 : 0} cs ${o.castShadow ? 1 : 0}|geo ${geometryKey(o.geometry)}|prototyped ${poolKeys.has(variantKey(probe)) ? 'yes' : 'no'}`);
      return orig(ro, mat);
    };
    const prepared = interact(B);
    NM._createNodeBuilder = orig;
    for (const x of builtB) log(`B built: ${x}`);
    // a real torn piece: the real chunk material of an enemy layer on a patch-layout geometry, through spawnFlesh
    const layer = woundsOf(M.enemies[0] as never)!.layers[0];
    const b2 = k.n.builds;
    const phys = CHUNK_PHYS[layer.cls];
    const chunk = ph.chunks.spawnFlesh(fallbackFlap(0.04, 0.01, new THREE.Color(0.7, 0.2, 0.2), 7), ph.chunks.chunkMaterial(layer.material), cam.position.clone().add(new THREE.Vector3(0, 0, -1)),
      new THREE.Quaternion(), new THREE.Vector3(0.02, 0.005, 0.02), {vel: new THREE.Vector3(), spin: new THREE.Vector3(), mat: phys.mat, density: phys.density});
    expect(chunk).not.toBeNull();
    show([chunk!]);
    frame(); frame();
    const chunkBuilds = k.n.builds - b2;
    // a loot highlight copy (the first aim at a lot of an item type): prepared hidden in the holders pool by runtimeVariantPrototypes
    const display = (cm as unknown as {display: {show(l: {id: number; itemId: string; matrix: THREE.Matrix4}[], h: number | null): void; highlightObject: THREE.Object3D | null; batches: Map<string, unknown>}}).display;
    const itemId = [...display.batches.keys()][0].split('|')[0];
    const b3 = k.n.builds;
    display.show([{id: -7, itemId, matrix: new THREE.Matrix4().makeTranslation(cam.position.x, cam.position.y - 0.3, cam.position.z - 1)}], -7);
    show(meshesOf(display.highlightObject!));
    frame(); frame();
    const lotBuilds = k.n.builds - b3;
    log(`loot highlight copies prepared ${proto.lotHighlights}; first aim at a ${itemId} lot -> ${lotBuilds} builds`);
    expect(proto.lotHighlights).toBeGreaterThan(0);
    expect(lotBuilds).toBe(0);
    log(`control A: ${control.meshes} new meshes -> ${control.builds} node builds · prepared B: ${prepared.meshes} new meshes -> ${prepared.builds} builds ${JSON.stringify(builtB)} · flesh chunk -> ${chunkBuilds} builds`);
    expect(control.meshes).toBeGreaterThan(0);
    expect(control.builds).toBeGreaterThan(0); // (the control: without prototypes these variants build on first real use)
    expect(prepared.meshes).toBeGreaterThan(0);
    expect(prepared.builds, `built on first use despite the prototypes: ${builtB.slice(0, 8).join(' ; ')}`).toBe(0);
    expect(chunkBuilds).toBe(0);
  }, 900_000);
});
