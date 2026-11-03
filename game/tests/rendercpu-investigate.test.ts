// Lane RENDER-CPU investigation harness (env-gated: LL_RCPU_OUT=/tmp/x.txt). Not part of CI: skipped without the variable.
import {appendFileSync, writeFileSync} from 'node:fs';
import * as THREE from 'three';
import {describe, expect, it} from 'vitest';
import {LevelCuller} from '../src/world/levelCulling';
import {planWarmup, warmKeys, isRenderable} from '../src/render/warmup';
import {mallQaPose} from '../src/gen/mall/qa';
import {CELL, FLOOR} from '../src/gen/grid';
import {drawsOf, eyeCam, realMallScene, startPose, submitted, torchOn, type Pose} from './helpers/rendercpuMall';

const OUT = process.env.LL_RCPU_OUT;
const out = (s: string) => { if (OUT) appendFileSync(OUT, s + '\n'); };
const SEED = process.env.LL_RCPU_SEED ?? 't3a';

function poses(layout: Parameters<typeof mallQaPose>[0]): Pose[] {
  const list: Pose[] = [startPose(layout)];
  const add = (name: Parameters<typeof mallQaPose>[1], ring?: number) => {
    const p = mallQaPose(layout, name, ring);
    if (p) list.push({name: `${name}${ring ?? ''}`, x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: 0});
  };
  add('ring-edge', 2); add('shopfront', 1); add('escalator', 1); add('court'); add('corridor', 1);
  const shop = layout.mall!.shops.find(s => s.program === 'lingerie');
  if (shop) {
    const a = layout.areas[shop.area], g = layout.levels[shop.level].grid;
    const cx0 = a.x + Math.floor(a.w / 2), cy0 = a.y + Math.floor(a.h / 2);
    for (let d = 0; d < 12; d++) {
      let hit: [number, number] | null = null;
      for (let dy = -d; dy <= d && !hit; dy++) for (let dx = -d; dx <= d && !hit; dx++) {
        const i = g.idx(cx0 + dx, cy0 + dy);
        if (g.cells[i] === FLOOR && !g.blocked[i] && g.rampIdx[i] < 0) hit = [cx0 + dx, cy0 + dy];
      }
      if (hit) { const x = (hit[0] + 0.5) * CELL, z = (hit[1] + 0.5) * CELL; list.push({name: `lingerie-${shop.id}`, x, y: g.floorAt(x, z), z, yaw: 0, pitch: 0}); break; }
    }
  }
  return list;
}

const COUNTED = ['rasterRuns', 'rasterRunsX', 'hiddenSlice', 'slabHidden', 'sees', 'ray', 'occludedNow', 'refreshBox', 'apertureTest', 'nearAtrium', 'updateAtrium', 'prepareOcclusion', 'occlusionLevel', 'wedgeBins'] as const;

describe.skipIf(!OUT)('RENDER-CPU investigation (mall yaw sweeps)', () => {
  it('culler cost per yaw step, newly submitted objects / groups vs the warm-up plan', async () => {
    writeFileSync(OUT!, '');
    const t0 = performance.now();
    const M = await realMallScene(SEED);
    out(`seed ${SEED}: built in ${((performance.now() - t0) / 1000).toFixed(1)} s; entries ${M.world.culler.entries.length}, atrium tiles ${M.world.culler.atriumTileCount}, portal tiles ${M.world.culler.portalTiles}, enemies ${M.enemies.length}, lingerie ${M.layout.zombies.filter(z => z.look === 'lingerie').length}`);
    const c = M.world.culler;
    // inventory of the scene
    let rend = 0, inst = 0, hiddenAtWarm = 0;
    const hiddenNames = new Map<string, number>();
    const walk = (o: THREE.Object3D, hidden: boolean) => {
      const h = hidden || !o.visible;
      if (isRenderable(o)) {
        rend++;
        if ((o as THREE.InstancedMesh).isInstancedMesh) inst++;
        if (h) { hiddenAtWarm++; const k = o.name.replace(/[-_]?\d+.*$/, '') || o.type; hiddenNames.set(k, (hiddenNames.get(k) ?? 0) + 1); }
      }
      for (const ch of o.children) walk(ch, h);
    };
    // the game's first frame: the start pose, loot display filled for that eye
    const sp = startPose(M.layout);
    const cam0 = eyeCam(sp), fl0 = torchOn(cam0);
    c.viewpoints = [fl0];
    (M.cm as unknown as {lastEye: THREE.Vector3}).lastEye.copy(cam0.position);
    (M.cm as unknown as {dirty: boolean}).dirty = true;
    M.cm.update(0.2, 0);
    c.update(cam0, true);
    walk(M.scene, false);
    out(`renderables ${rend} (instanced ${inst}); hidden (visible=false chain) at warm-up ${hiddenAtWarm}: ${[...hiddenNames].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, n]) => `${k} ${n}`).join(', ')}`);
    // alpha-tested casters
    const alphaCasters: string[] = [];
    M.scene.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh && m.castShadow) { const mats = Array.isArray(m.material) ? m.material : [m.material]; if (mats.some(x => x.alphaTest > 0)) alphaCasters.push(m.name || m.type); } });
    out(`alpha-tested casters ${alphaCasters.length}: ${[...new Set(alphaCasters)].slice(0, 20).join(', ')}`);
    // warm-up plan ('full', no pools: the station scene's pools are effects / flares / gear / … outside these roots)
    const plan = planWarmup(M.scene, {mode: 'full', cameraMask: cam0.layers.mask, pools: []});
    const covered = new Set<string>();
    const reps = new Set<THREE.Object3D>();
    for (const i of plan.items) { reps.add(i.object); for (const k of warmKeys(i.object)) covered.add(k); }
    const repCasters = new Set(plan.items.filter(i => i.caster).map(i => i.object));
    out(`warm-up plan: items ${plan.items.length}, groups ${plan.groups}, renderables ${plan.renderables.length}, skipped ${plan.skipped}, casters ${repCasters.size}`);
    // the first real frame after the warm-up: render objects for whatever the start view submits
    const everScene = new Set<THREE.Object3D>(reps), everShadow = new Set<THREE.Object3D>(repCasters);
    const keysScene = new Set(covered);
    for (const m of submitted(M.scene, cam0)) { everScene.add(m); for (const k of warmKeys(m)) keysScene.add(k); }
    fl0.shadow.camera.layers.mask = cam0.layers.mask;
    for (const m of submitted(M.scene, fl0.shadow.camera, true)) everShadow.add(m);
    cam0.remove(fl0, fl0.target);

    const STEP = 360 / 16; // the lead's 16-step sweeps
    for (const pass of [1, 2]) for (const p of poses(M.layout)) {
      const rows: string[] = [];
      let tSum = 0, tMax = 0, newObjSum = 0, newGrpSum = 0, newInstSum = 0, newShadowSum = 0, drawMax = 0;
      for (let s = 0; s <= 16; s++) {
        const yaw = p.yaw + THREE.MathUtils.degToRad(s * STEP);
        const cam = eyeCam(p, yaw, 0), fl = torchOn(cam);
        c.viewpoints = [fl];
        (M.cm as unknown as {lastEye: THREE.Vector3}).lastEye.copy(cam.position);
        M.cm.update(0.2, 0);
        // timing: median of 5 forced updates (a full update, as every turning frame gets)
        const ts: number[] = [];
        for (let r = 0; r < 5; r++) { const a = performance.now(); c.update(cam, true); ts.push(performance.now() - a); }
        ts.sort((a, b) => a - b);
        const t = ts[2];
        tSum += t; tMax = Math.max(tMax, t);
        const sub = submitted(M.scene, cam);
        fl.shadow.camera.layers.mask = cam.layers.mask;
        const sh = submitted(M.scene, fl.shadow.camera, true);
        let nObj = 0, nGrp = 0, nInst = 0, nSh = 0;
        const newNames = new Map<string, number>();
        for (const m of sub) {
          if (!everScene.has(m)) { everScene.add(m); nObj++; }
          for (const k of warmKeys(m)) if (!keysScene.has(k)) { keysScene.add(k); nGrp++; if ((m as THREE.InstancedMesh).isInstancedMesh) nInst++; const nm = m.name.replace(/[-_|:]?\d.*$/, '') || m.type; newNames.set(nm, (newNames.get(nm) ?? 0) + 1); }
        }
        for (const m of sh) if (!everShadow.has(m)) { everShadow.add(m); nSh++; }
        newObjSum += nObj; newGrpSum += nGrp; newInstSum += nInst; newShadowSum += nSh;
        const draws = drawsOf(sub) + drawsOf(sh, true);
        drawMax = Math.max(drawMax, draws);
        rows.push(`  ${String(Math.round(s * STEP)).padStart(3)}°: cull ${t.toFixed(2)} ms, scene ${drawsOf(sub)} + shadow ${drawsOf(sh, true)} draws; new objects ${nObj}, new shadow ROs ${nSh}, NEW GROUPS ${nGrp} (instanced ${nInst})${newNames.size ? ` [${[...newNames].map(([k, n]) => `${k} ${n}`).join(', ')}]` : ''}; culled ${c.stats.culled}, slab ${c.slabCulled}, occl ${c.occlusionCulled}, atrium seen ${c.atriumStats.seen} tests ${c.atriumStats.sightTests}`);
        cam.remove(fl, fl.target);
      }
      out(`pass ${pass} ${p.name} (${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)}): cull avg ${(tSum / 17).toFixed(2)} max ${tMax.toFixed(2)} ms; new objects ${newObjSum}, new shadow ROs ${newShadowSum}, new groups ${newGrpSum} (instanced ${newInstSum}); max draws ${drawMax}`);
      for (const r of rows) out(r);
    }
    // structural call counts per full update at the start pose (prototype wrappers; timing above was unwrapped)
    const proto = LevelCuller.prototype as unknown as Record<string, (...a: unknown[]) => unknown>;
    const counts: Record<string, number> = {};
    const saved: Record<string, (...a: unknown[]) => unknown> = {};
    for (const k of COUNTED) {
      saved[k] = proto[k];
      counts[k] = 0;
      proto[k] = function (this: unknown, ...a: unknown[]) { counts[k]++; return saved[k].apply(this, a); };
    }
    try {
      for (const p of poses(M.layout)) {
        const cam = eyeCam(p), fl = torchOn(cam);
        c.viewpoints = [fl];
        for (const k of COUNTED) counts[k] = 0;
        c.update(cam, true);
        out(`calls per full update @${p.name}: ${COUNTED.map(k => `${k} ${counts[k]}`).join(', ')}`);
        cam.remove(fl, fl.target);
      }
    } finally {
      for (const k of COUNTED) proto[k] = saved[k];
    }
    expect(true).toBe(true);
  }, 900_000);
});
