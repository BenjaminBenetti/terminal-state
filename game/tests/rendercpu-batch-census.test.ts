// Task static-batching-warmup-20261105 census harness (env-gated: LL_RCPU_CENSUS_OUT=/tmp/x.txt): per level (Subway, Office, Mall,
// Reactor — the real worlds as the game builds them), the busiest start-pose view of a yaw sweep, its scene-pass and torch-shadow
// draws by root group / instancing / name, and the static-batching candidates: plain (non-instanced, non-skinned) world meshes with
// an opaque single material, grouped by (material, level tag, shadow flags, render order, layers) per 18 m chunk.
import {appendFileSync, writeFileSync} from 'node:fs';
import * as THREE from 'three';
import {describe, expect, it} from 'vitest';
import {drawsOf, eyeCam, startPose, submitted, torchOn} from './helpers/rendercpuMall';

const OUT = process.env.LL_RCPU_CENSUS_OUT;
const out = (s: string) => { if (OUT) appendFileSync(OUT, s + '\n'); };
const LEVELS_ON = (process.env.LL_RCPU_CENSUS_LEVELS ?? 'subway,office,mall,reactor').split(',');

/** A scene's static roots (world, holders, stock) for the census. */
interface Built { name: string; scene: THREE.Scene; world: {group: THREE.Object3D; culler: {update(c: THREE.Camera, f?: boolean): void}}; roots: THREE.Object3D[]; layout: never }

async function build(level: string): Promise<Built> {
  if (level === 'mall') { const M = await (await import('./helpers/rendercpuMall')).realMallScene('t3a'); return {name: 'mall t3a', scene: M.scene, world: M.world, roots: M.roots, layout: M.layout as never}; }
  if (level === 'reactor') { const X = await (await import('./helpers/rendercpuReactor')).realReactorScene(9100); return {name: 'reactor 9100', scene: X.scene, world: X.world, roots: [X.world.group, X.cm.group], layout: X.layout as never}; }
  const L = await (await import('./helpers/rendercpuLevels')).realLevelScene(level as 'subway' | 'office', level === 'office' ? 4242 : 7);
  return {name: `${level} ${L.seed}`, scene: L.scene, world: L.world, roots: L.roots, layout: L.layout as never};
}

const prefix = (n: string) => (n || '(unnamed)').replace(/[-_:|#].*$/, '').replace(/\d+$/, '') || '(unnamed)';

describe.skipIf(!OUT)('static batching census (real worlds, no renderer)', () => {
  it('busiest view per level: draws by group / instancing / name; plain-mesh merge candidates', async () => {
    writeFileSync(OUT!, '');
    // policy overrides (A/B): LL_COHORT_TRIS (cheap threshold; 0 = never cheap), LL_COHORT_M (coarse cohort metres; 'inf' = whole level)
    const SC = await import('../src/world/staticCohorts').then(m => m.STATIC_COHORTS).catch(() => null);
    if (SC && process.env.LL_COHORT_TRIS) SC.levelTriangles = Number(process.env.LL_COHORT_TRIS);
    if (SC && process.env.LL_COHORT_M) SC.coarseM = process.env.LL_COHORT_M === 'inf' ? Infinity : Number(process.env.LL_COHORT_M);
    out(`policy: ${SC ? JSON.stringify({...SC, coarseM: Number.isFinite(SC.coarseM) ? SC.coarseM : 'inf'}) : 'none (main)'}`);
    for (const level of LEVELS_ON) {
      const B = await build(level);
      // multi-view metric: the start pose + 5 evenly spaced enemy spawns (walkable floor of their level), 8 yaws each: scene + torch
      // shadow draws per view (after the culler), and the triangles submitted
      {
        const L = B.layout as unknown as {zombies: {x: number; z: number; y?: number; level?: number}[]; levels: {grid: {floorAt(x: number, z: number): number}}[]};
        const sp0 = startPose(B.layout);
        const poses = [{x: sp0.x, y: sp0.y, z: sp0.z}];
        const zs = L.zombies;
        for (let k = 0; k < 5 && zs.length; k++) { const z = zs[Math.floor((k + 0.5) * zs.length / 5)]; poses.push({x: z.x, y: z.y ?? L.levels[z.level ?? 0].grid.floorAt(z.x, z.z), z: z.z}); }
        const c2 = eyeCam({name: 'v', x: 0, y: 0, z: 0, yaw: 0, pitch: 0});
        B.scene.add(c2);
        const fl2 = torchOn(c2);
        const per: number[] = [], tris: number[] = [];
        const triOf = (list: THREE.Mesh[]) => list.reduce((s, m) => { const g = m.geometry; const t = (g.index ? g.index.count : g.attributes.position.count) / 3; return s + t * ((m as THREE.InstancedMesh).isInstancedMesh ? (m as THREE.InstancedMesh).count : 1); }, 0);
        for (const p of poses) for (let y = 0; y < 8; y++) {
          c2.position.set(p.x, p.y + 1.62, p.z); c2.rotation.set(0, y * Math.PI / 4, 0, 'YXZ'); c2.updateMatrixWorld(true); fl2.shadow.updateMatrices(fl2);
          B.world.culler.update(c2, true);
          const sl = submitted(B.scene, c2), sh = submitted(B.scene, fl2.shadow.camera, true);
          per.push(drawsOf(sl) + drawsOf(sh, true)); tris.push(triOf(sl) + triOf(sh));
        }
        const st = (a: number[]) => { const b = [...a].sort((x, y) => x - y); return `mean ${(a.reduce((x, y) => x + y, 0) / a.length).toFixed(1)} p90 ${b[Math.floor(b.length * 0.9)]} max ${b[b.length - 1]}`; };
        let ims = 0, meshes = 0;
        for (const r of B.roots) r.traverse(o => { if ((o as THREE.InstancedMesh).isInstancedMesh) ims++; else if ((o as THREE.Mesh).isMesh) meshes++; });
        const W = await import('../src/render/warmup');
        const plan = W.planWarmup(B.scene, {mode: 'full', cameraMask: c2.layers.mask, pools: [B.roots[1]]});
        out(`WARMUP ${level}: 'full' plan representatives ${plan.items.length}, others ${plan.others.length}, renderables ${plan.renderables.length}`);
        out(`MULTI ${level}: ${per.length} views · draws (scene + shadow) ${st(per)} · triangles ${st(tris.map(t => Math.round(t / 1000)))}k · static roots: ${ims} InstancedMesh, ${meshes} meshes`);
        B.scene.remove(c2);
        if (process.env.LL_RCPU_CENSUS_MULTI_ONLY) continue;
      }
      const sp = startPose(B.layout);
      const cam = eyeCam(sp);
      B.scene.add(cam);
      const fl = torchOn(cam);
      // busiest of a 16-step yaw sweep (scene + torch shadow casters, after the culler)
      let best = {yaw: sp.yaw, draws: -1};
      for (let s = 0; s < 16; s++) {
        const yaw = sp.yaw + s * Math.PI / 8;
        cam.rotation.set(0, yaw, 0, 'YXZ'); cam.updateMatrixWorld(true); fl.shadow.updateMatrices(fl);
        B.world.culler.update(cam, true);
        const d = drawsOf(submitted(B.scene, cam)) + drawsOf(submitted(B.scene, fl.shadow.camera, true), true);
        if (d > best.draws) best = {yaw, draws: d};
      }
      cam.rotation.set(0, best.yaw, 0, 'YXZ'); cam.updateMatrixWorld(true); fl.shadow.updateMatrices(fl);
      B.world.culler.update(cam, true);
      const sceneList = submitted(B.scene, cam), shadowList = submitted(B.scene, fl.shadow.camera, true);
      const rootOf = (m: THREE.Object3D) => { let p: THREE.Object3D | null = m; while (p && !B.roots.includes(p)) p = p.parent; return p === B.roots[0] ? 'world' : p === B.roots[1] ? 'holders' : p === B.roots[2] ? 'stock' : 'other'; };
      const cat = (list: THREE.Mesh[], shadow: boolean) => {
        const by = new Map<string, number>();
        for (const m of list) {
          const k = `${rootOf(m)}|${(m as THREE.InstancedMesh).isInstancedMesh ? 'inst' : (m as THREE.SkinnedMesh).isSkinnedMesh ? 'skin' : 'mesh'}|${prefix(m.name)}`;
          by.set(k, (by.get(k) ?? 0) + drawsOf([m], shadow));
        }
        return [...by.entries()].sort((a, b) => b[1] - a[1]);
      };
      out(`== ${B.name}: busiest view draws ${best.draws} (scene ${drawsOf(sceneList)} / shadow ${drawsOf(shadowList, true)})`);
      out(`  scene by group|kind|name: ${cat(sceneList, false).slice(0, 28).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
      out(`  shadow by group|kind|name: ${cat(shadowList, true).slice(0, 20).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
      // merge candidates in this view: plain world meshes, single opaque material
      const plain = sceneList.filter(m => rootOf(m) === 'world' && !(m as THREE.InstancedMesh).isInstancedMesh && !(m as THREE.SkinnedMesh).isSkinnedMesh && !Array.isArray(m.material));
      const opaque = plain.filter(m => !(m.material as THREE.Material).transparent);
      const groupKey = (m: THREE.Mesh) => `${(m.material as THREE.Material).uuid}|${JSON.stringify(m.userData.levels ?? m.userData.level ?? null)}|${m.castShadow ? 1 : 0}${m.receiveShadow ? 1 : 0}|${m.renderOrder}|${m.layers.mask}`;
      const groups = new Map<string, THREE.Mesh[]>();
      for (const m of opaque) { const k = groupKey(m); (groups.get(k) ?? groups.set(k, []).get(k)!).push(m); }
      const multi = [...groups.values()].filter(g => g.length > 1);
      out(`  plain world meshes in view ${plain.length} (opaque single-material ${opaque.length}); share material+level+flags: ${multi.reduce((s, g) => s + g.length, 0)} meshes in ${multi.length} groups -> merged would save ${multi.reduce((s, g) => s + g.length - 1, 0)} scene draws (upper bound, before chunking)`);
      out(`  top groups: ${multi.sort((a, b) => b.length - a.length).slice(0, 12).map(g => `${prefix(g[0].name)}:${(g[0].material as THREE.Material).name || (g[0].material as THREE.Material).type} x${g.length}`).join(' · ')}`);
      // instanced cohorts in view: draws vs distinct (name, material) — what per-level (unchunked) cohorts would leave
      for (const want of ['world', 'holders']) {
        const ims = sceneList.filter(m => rootOf(m) === want && (m as THREE.InstancedMesh).isInstancedMesh) as THREE.InstancedMesh[];
        const ids = new Set(ims.map(m => `${m.name}|${(m.material as THREE.Material).uuid}|${JSON.stringify(m.userData.level ?? null)}`));
        const inst = ims.reduce((s, m) => s + m.count, 0);
        const names = new Map<string, number>(); for (const m of ims) names.set(prefix(m.name) + ':' + m.name.split('-').slice(0, 2).join('-'), (names.get(prefix(m.name) + ':' + m.name.split('-').slice(0, 2).join('-')) ?? 0) + 1);
        out(`  ${want} instanced in view: ${ims.length} draws, ${ids.size} distinct (name, material, level) -> per-level cohorts would leave ${ids.size}; instances ${inst}; top names ${[...names.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, v]) => `${k} x${v}`).join(' ')}`);
      }
      // cohort-size estimate: re-bucket every instanced batch's instances by (name, material, level, C m chunk); a cohort is drawn when
      // any currently visible batch has an instance in it; draws = visible cohorts, instances = all instances of visible cohorts
      const tmp = new THREE.Matrix4(), pos = new THREE.Vector3();
      for (const want of ['world', 'holders']) {
        const all: THREE.InstancedMesh[] = [];
        const chunked = want === 'world' ? /^prop-/ : /^(container-body|openable-closed)-/; // (the chunked families: chunkInstances / holder chunks)
        B.roots[want === 'world' ? 0 : 1].traverse(o => { const im = o as THREE.InstancedMesh; if (im.isInstancedMesh && im.count > 0 && im.visible && chunked.test(im.name)) all.push(im); });
        const vis = new Set(sceneList.filter(m => (m as THREE.InstancedMesh).isInstancedMesh));
        const visShadow = new Set(shadowList.filter(m => (m as THREE.InstancedMesh).isInstancedMesh));
        const row: string[] = [];
        for (const C of [12, 18, 24, 36, 48]) {
          const cohorts = new Map<string, {n: number; tris: number; vis: boolean; visS: boolean}>();
          for (const im of all) {
            const tris = (im.geometry.index ? im.geometry.index.count : im.geometry.attributes.position.count) / 3;
            for (let i = 0; i < im.count; i++) {
              im.getMatrixAt(i, tmp); pos.setFromMatrixPosition(tmp.premultiply(im.matrixWorld));
              const k = `${im.name}|${(im.material as THREE.Material).uuid}|${im.userData.level ?? ''}|${Math.floor(pos.x / C)},${Math.floor(pos.z / C)}`;
              let c = cohorts.get(k); if (!c) cohorts.set(k, (c = {n: 0, tris, vis: false, visS: false}));
              c.n++; if (vis.has(im)) c.vis = true; if (visShadow.has(im)) c.visS = true;
            }
          }
          let d = 0, ds = 0, inst = 0, tris = 0;
          for (const c of cohorts.values()) { if (c.vis) { d++; inst += c.n; tris += c.n * c.tris; } if (c.visS) ds++; }
          row.push(`${C} m: scene ${d} shadow ${ds} inst ${inst} tris ${(tris / 1000).toFixed(0)}k`);
        }
        // triangle-budget policy: a (name, level) model whose instances total <= T triangles (all parts) is one cohort per level,
        // heavier ones keep 18 m chunks (same estimation method as the rows above: compare with its 18 m row)
        const trisOf = (im: THREE.InstancedMesh) => (im.geometry.index ? im.geometry.index.count : im.geometry.attributes.position.count) / 3;
        const modelTris = new Map<string, number>();
        for (const im of all) { const k = `${im.name}|${im.userData.level ?? ''}`; modelTris.set(k, (modelTris.get(k) ?? 0) + im.count * trisOf(im)); }
        for (const T of [20000, 50000, 100000]) {
          const cohorts = new Map<string, {n: number; tris: number; vis: boolean; visS: boolean}>();
          for (const im of all) {
            const whole = (modelTris.get(`${im.name}|${im.userData.level ?? ''}`) ?? 0) <= T;
            for (let i = 0; i < im.count; i++) {
              im.getMatrixAt(i, tmp); pos.setFromMatrixPosition(tmp.premultiply(im.matrixWorld));
              const k = `${im.name}|${(im.material as THREE.Material).uuid}|${im.userData.level ?? ''}|${whole ? 'all' : `${Math.floor(pos.x / 18)},${Math.floor(pos.z / 18)}`}`;
              let c = cohorts.get(k); if (!c) cohorts.set(k, (c = {n: 0, tris: trisOf(im), vis: false, visS: false}));
              c.n++; if (vis.has(im)) c.vis = true; if (visShadow.has(im)) c.visS = true;
            }
          }
          let d = 0, ds = 0, inst = 0, tris = 0;
          for (const c of cohorts.values()) { if (c.vis) { d++; inst += c.n; tris += c.n * c.tris; } if (c.visS) ds++; }
          row.push(`budget ${T / 1000}k: scene ${d} shadow ${ds} inst ${inst} tris ${(tris / 1000).toFixed(0)}k`);
        }
        const cur = [...vis].filter(m => all.includes(m as THREE.InstancedMesh)) as THREE.InstancedMesh[];
        out(`  ${want} cohort estimate (current: scene ${cur.length}, inst ${cur.reduce((s, m) => s + m.count, 0)}, tris ${(cur.reduce((s, m) => s + m.count * ((m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3), 0) / 1000).toFixed(0)}k): ${row.join(' · ')}`);
      }
      // plain merge groups within a 48 m chunk, excluding the damage-indexed families (purpose- / shopfront-)
      const chunk48 = (m: THREE.Mesh) => { const b = new THREE.Box3().setFromObject(m), c = b.getCenter(new THREE.Vector3()); return `${Math.floor(c.x / 48)},${Math.floor(c.z / 48)}`; };
      const g48 = new Map<string, THREE.Mesh[]>();
      for (const m of opaque) { if (/^(purpose|shopfront)-/.test(m.name)) continue; const k = `${groupKey(m)}|${chunk48(m)}`; (g48.get(k) ?? g48.set(k, []).get(k)!).push(m); }
      const m48 = [...g48.values()].filter(g => g.length > 1);
      out(`  plain merge within 48 m chunk (no purpose/shopfront): saves ${m48.reduce((s, g) => s + g.length - 1, 0)} scene draws; groups ${m48.sort((a, b) => b.length - a.length).slice(0, 10).map(g => `${g.map(x => prefix(x.name)).join('+').slice(0, 40)}:${(g[0].material as THREE.Material).name || '?'}`).join(' · ')}`);
      // the whole world group (not just this view)
      let wPlain = 0, wInst = 0, wOther = 0;
      B.roots[0].traverse(o => { const m = o as THREE.Mesh; if (!m.isMesh) return; if ((m as THREE.InstancedMesh).isInstancedMesh) wInst++; else if ((m as THREE.SkinnedMesh).isSkinnedMesh) wOther++; else wPlain++; });
      out(`  world group: plain ${wPlain}, instanced ${wInst}, skinned ${wOther}`);
      B.scene.remove(cam);
    }
    expect(true).toBe(true);
  }, 1_800_000);
});
