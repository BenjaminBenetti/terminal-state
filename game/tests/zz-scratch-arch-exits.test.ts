// TEMPORARY lane ARCH probe (deleted after use): GEN's real exits through the M09 renderer on a few seeds.
import {writeFileSync} from 'node:fs';
import * as THREE from 'three';
import {it} from 'vitest';
import {installCanvasShim} from './helpers/canvas2d';
import {fakeEnvTextures} from './helpers/openablesFixture';
import {visibleMeshes} from './helpers/visibleMeshes';
import {WorldMaterials} from '../src/world/materials';
import {buildWorld} from '../src/world/builder';
import {codeToSeed} from '../src/core/rng';
import {CELL, FLOOR, VOID} from '../src/gen/grid';
import {CULL_LAYER, fogCullDistance} from '../src/world/levelCulling';
import {MALL_FOG} from '../src/world/mallAtmosphere';
import {mallQaPose} from '../src/gen/mall/qa';
import {planStreet} from '../src/world/mallStreetExit';

installCanvasShim(false);

it('probe', async () => {
  const {generateMallLevel, setMallVariantOverride} = await import('../src/gen/mall/index');
  const out: unknown[] = [];
  const cases: [string, number, string | null][] = [['t3a', codeToSeed('t3a')!, 'arcade-loop'], ['t3a', codeToSeed('t3a')!, null], ['12345', 12345, null], ['4242', 4242, null]];
  for (const [name, seed, variant] of cases) {
    setMallVariantOverride(variant);
    const layout = generateMallLevel({levelSeed: seed, startWeapon: 'pistol'} as never);
    setMallVariantOverride(null);
    const exits = layout.mall!.exits ?? [];
    const rec: Record<string, unknown> = {name, variant: layout.mall!.variant, exits: exits.length};
    if (!exits.length) { out.push(rec); continue; }
    const w = buildWorld(layout, new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17}), {});
    w.culler.maxDistance = Math.min(fogCullDistance(MALL_FOG.density), MALL_FOG.far);
    const ms = (() => { const a: THREE.Mesh[] = []; w.group.traverse(o => { if ((o as THREE.Mesh).isMesh && o.name.startsWith('mall-exit-')) a.push(o as THREE.Mesh); }); return a; })();
    const culled = (m: THREE.Object3D) => (m.layers.mask >>> 0) === ((1 << CULL_LAYER) >>> 0);
    const per: unknown[] = [];
    exits.forEach((e, k) => {
      const spec = w.mallArch!.exits()[k];
      const mine = ms.filter(m => m.userData.streetExit === e.id);
      const P = planStreet(spec);
      // view volume outside every storey's open cells (vertex test)
      let bad = 0, n = 0, outView = 0;
      for (const m of mine.filter(q => /street|fog/.test(q.name))) {
        const pos = m.geometry.attributes.position;
        for (let i = 0; i < pos.count; i++) {
          const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
          n++;
          if (x < e.view.x0 - 0.06 || x > e.view.x1 + 0.06 || z < e.view.z0 - 0.06 || z > e.view.z1 + 0.06) outView++;
          const g0 = layout.levels[0].grid, cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
          if (cx < 0 || cz < 0 || cx >= g0.w || cz >= g0.h) continue;
          for (const L of layout.levels) { const c = L.grid.cells[cz * g0.w + cx]; if ((c === FLOOR || c === VOID) && y > L.grid.floorOf(cz * g0.w + cx) - 0.05 && y < L.grid.ceil[cz * g0.w + cx] + 0.05) bad++; }
        }
      }
      // glass inside the collider
      let glassOut = 0;
      for (const m of mine.filter(q => q.name.endsWith('glass'))) { const pos = m.geometry.attributes.position; for (let i = 0; i < pos.count; i++) { const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i); const c = e.collider; if (x < c.x0 - 1e-6 || x > c.x1 + 1e-6 || z < c.z0 - 1e-6 || z > c.z1 + 1e-6 || y < c.y0 - 1e-6 || y > c.y1 + 1e-6) glassOut++; } }
      // culling from the QA pose and from the start / platform pose
      const poseRes: Record<string, unknown> = {};
      for (const [pn, pose] of [['street-exit', mallQaPose(layout, 'street-exit', k)], ['platform-lookup', mallQaPose(layout, 'platform-lookup')], ['court', mallQaPose(layout, 'court')]] as const) {
        if (!pose) { poseRes[pn] = null; continue; }
        const cam = new THREE.PerspectiveCamera(75, 960 / 540, 0.05, MALL_FOG.far);
        cam.position.set(pose.x, pose.y + 1.62, pose.z);
        cam.rotation.set(pose.pitch, pose.yaw, 0, 'YXZ');
        cam.updateMatrixWorld(true);
        w.culler.update(cam, true);
        const vis = visibleMeshes(w.group, cam, 128, 72, {minPx: 1});
        poseRes[pn] = {
          drawn: mine.filter(m => !culled(m)).map(m => m.name.split('-').pop()),
          visible: mine.filter(m => vis.has(m)).map(m => `${m.name.split('-').pop()}:${vis.get(m)}`),
          visibleButCulledAll: [...vis].filter(([m]) => culled(m)).map(([m, c]) => `${m.name}:${c}`).slice(0, 6),
          apertureCulled: w.culler.apertureCulled,
        };
      }
      per.push({id: e.id, kind: e.kind, side: e.side, door: e.door, vestibule: e.vestibule, view: e.view, hall: e.hall, panels: e.panels.map(p => `${p.kind}:${(p.s1 - p.s0).toFixed(2)}`),
        cost: w.mallArch!.stats.exitCost[k], plan: {vol: P.vol, road: P.road, buildings: P.buildings.length, cars: P.cars.length, cards: P.cards.length},
        viewVerts: n, inOpenCells: bad, outOfView: outView, glassOutsideCollider: glassOut, poses: poseRes});
    });
    rec.per = per;
    out.push(rec);
  }
  writeFileSync('/tmp/arch-exit-probe.json', JSON.stringify(out, null, 1));
}, 600_000);
