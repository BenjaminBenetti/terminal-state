// Task studio-alpha-track2-round3-20261031-01 (lane HIDEOUT): opt-in CPU review pictures of the survivor HIDEOUT and its TRAIL on a real
// generated level (no WebGL, no browser): the hideout from its doorway, the bed with the footlocker, the camp table with the lantern /
// stove, a trail mark in a service corridor beside its doorway, the hideout mark at the hideout's door.
//   HIDEOUT_PICTURES=1 [HIDEOUT_SEED=1043] ./node_modules/.bin/vitest run --config game/vitest.config.ts --maxWorkers=1 --no-file-parallelism game/tests/annex-hideout-pictures.preview.test.ts
// Writes qa-artifacts/hideout-pictures/*.png + pictures.txt (git-ignored, never committed). Approximate lighting (helpers/meshPreview.ts:
// flashlight + ambient, albedo only — no light field, so neither the lantern's warm pool nor the paint's glow shows): composition /
// identity / scale review, not the game's look or darkness. Iteration-07 camp things (chairs, work lights) need their models: not drawn.
import {beforeAll, describe, it} from 'vitest';
import * as THREE from 'three';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {installCanvasShim, ShimCanvas, ShimContext} from './helpers/canvas2d';
import {renderMeshes, type PreviewCam} from './helpers/meshPreview';
import {openableModels} from './helpers/openablesFixture';
import {freshLayout} from './helpers/annexRoute';
import {TEXTURE_FILES, type TextureKey} from '../src/assets/manifest';
import {lootProfile} from '../src/items/lootTables';
import {CELL} from '../src/gen/grid';
import {levelsOf} from '../src/gen/levels';
import {annexCachesOf} from '../src/gen/annexCache';

const GAME = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let models: Record<string, GLTF> = {};
beforeAll(async () => { if (process.env.HIDEOUT_PICTURES) models = await openableModels(); }, 120000);

describe.runIf(!!process.env.HIDEOUT_PICTURES)('hideout review pictures (HIDEOUT_PICTURES=1)', () => {
  it('renders the hideout, its camp table, a trail mark and the hideout mark', async () => {
    installCanvasShim(true);
    (ShimContext.prototype as unknown as {clip?: () => void}).clip ??= () => {};
    const out = path.resolve(GAME, '..', 'qa-artifacts', 'hideout-pictures');
    fs.mkdirSync(out, {recursive: true});
    const sharp = (await import('sharp')).default;
    const {WorldMaterials} = await import('../src/world/materials');
    const {buildWorld} = await import('../src/world/builder');
    const {ContainerManager} = await import('../src/world/containers');
    const tex = {} as Record<TextureKey, THREE.Texture>;
    for (const [k, f] of Object.entries(TEXTURE_FILES) as [TextureKey, {url: string}][]) {
      const {data, info} = await sharp(path.join(GAME, 'public', f.url)).ensureAlpha().raw().toBuffer({resolveWithObject: true});
      const c = new ShimCanvas(true); c.width = info.width; c.height = info.height; c.data.set(data);
      const t = new THREE.Texture(c as unknown as HTMLImageElement); t.wrapS = t.wrapT = THREE.RepeatWrapping;
      tex[k] = t;
    }
    const mats = new WorldMaterials(tex, 7, {w: 1.2, h: 0.19, d: 0.17});
    const report: string[] = [];
    const shoot = async (name: string, group: THREE.Group, cam: PreviewCam, ambient = 0.55) => {
      const px = renderMeshes(group, {far: 40, fov: 70, ...cam}, {width: 960, height: 540, flashlight: true, ambient, fog: 0.02});
      await sharp(px, {raw: {width: 960, height: 540, channels: 3}}).png().toFile(path.join(out, `${name}.png`));
      report.push(`${name}: cam ${JSON.stringify(cam)}`);
    };
    const seed = Number(process.env.HIDEOUT_SEED ?? 1043);
    const L = freshLayout('subway', seed);
    const w = buildWorld(L, mats, {});
    const cm = new ContainerManager(models, mats, () => ({}) as never);
    cm.build(L, {}, lootProfile('subway'));
    const scene = new THREE.Group();
    scene.add(w.group, cm.group);
    const caches = annexCachesOf(L);
    // the richest hideout of the level (the camp table set first)
    const c = caches.slice().sort((p, q) => Number(q.table >= 0) - Number(p.table >= 0) || q.pieces.length - p.pieces.length)[0];
    const a = L.areas[c.area], fy = a.floorY!;
    const d = L.doors.find(q => (q.a === a.id || q.b === a.id) && q.a !== q.b)!;
    const dx = (d.x + d.w / 2) * CELL, dz = (d.y + d.h / 2) * CELL, ax = (a.x + a.w / 2) * CELL, az = (a.y + a.h / 2) * CELL;
    const len = Math.hypot(ax - dx, az - dz) || 1, ux = (ax - dx) / len, uz = (az - dz) / len;
    // open the storage, as a player would (the lots show)
    for (const i of c.holders) {
      const hh = cm.all.find(q => q.prop === L.props[i])!;
      const {aim} = cm.aimPoint(hh);
      const eye = new THREE.Vector3(dx + ux * 0.6, fy + 1.6, dz + uz * 0.6);
      cm.target(eye, new THREE.Vector3(aim.x, aim.y, aim.z).sub(eye).normalize(), levelsOf(L));
      if (hh.open || !hh.state.open) cm.interact({container: hh, t: 1, lot: null, part: hh.open ? 0 : undefined} as never);
    }
    for (let t = 0; t < 1.5; t += 1 / 30) cm.update(1 / 30, t);
    // 1. the hideout from its doorway
    await shoot('hideout-from-door', scene, {pos: [dx - ux * 0.3, fy + 1.65, dz - uz * 0.3], target: [ax + ux, fy + 0.45, az + uz]});
    // 2. the bed and the footlocker, from ~2.2 m in front of the bed, a little to one side
    const bed = L.props[c.bed], fx = Math.sin(bed.rot), fz = Math.cos(bed.rot);
    await shoot(`hideout-bed-${bed.kind}`, scene, {pos: [bed.x + fx * 2.2 + fz * 0.7, fy + 1.55, bed.z + fz * 2.2 - fx * 0.7], target: [bed.x, fy + 0.2, bed.z]});
    // 3. the camp table with the lantern and the stove (or the floor lantern)
    const focus = c.table >= 0 ? L.props[c.table] : L.props[c.lantern];
    const tx = Math.sin(focus.rot), tz = Math.cos(focus.rot);
    await shoot(c.table >= 0 ? 'hideout-camp-table' : 'hideout-lantern', scene, {pos: [focus.x + tx * 1.5 + tz * 0.4, fy + 1.45, focus.z + tz * 1.5 - tx * 0.4], target: [focus.x, fy + (c.table >= 0 ? 0.8 : 0.2), focus.z]});
    // 4. a trail mark in a service corridor (the first one past the entry), seen from 2.4 m with its doorway beside it
    const marks = L.extensions!.cacheMarks ?? [];
    const corridorMark = marks.find(m => m.kind === 'arrow' && L.areas[m.area].kind === 'service' && m.step > 0) ?? marks.find(m => m.kind === 'arrow')!;
    const look = (m: (typeof marks)[number], dist: number, side: number) => {
      const [px, pz] = m.axis === 'z' ? [m.c, m.plane] : [m.plane, m.c];
      const nx = m.axis === 'x' ? m.n : 0, nz = m.axis === 'z' ? m.n : 0, along = m.axis === 'z' ? [1, 0] : [0, 1];
      return {pos: [px + nx * dist + along[0] * side, m.y - 0.05, pz + nz * dist + along[1] * side] as [number, number, number], target: [px, m.y - 0.15, pz] as [number, number, number]};
    };
    await shoot(`trail-mark-${L.areas[corridorMark.area].purpose}`, scene, look(corridorMark, 2.4, 0.4), 0.6);
    // 5. the hideout mark beside the hideout's doorway
    const hm = marks.find(m => m.kind === 'hideout' && m.next === c.area) ?? marks.find(m => m.kind === 'hideout');
    if (hm) await shoot('hideout-mark', scene, look(hm, 2.2, -0.3), 0.6);
    report.push(`level subway ${seed}; hideout area ${a.id} (${a.purpose}) depth ${c.depth}, tier ${c.tier}; pieces ${c.pieces.map(i => L.props[i].kind).join(', ')}`);
    report.push(`holders: ${c.holders.map(i => { const hh = cm.all.find(q => q.prop === L.props[i])!; return `${hh.kind} [${hh.state.lots.map(l => l.itemId).join(', ')}]`; }).join('; ')}`);
    report.push(`gear: ${c.gear >= 0 ? L.pickups[c.gear].itemId : '-'}; trail marks ${marks.filter(m => m.annex === c.annex).length}; corridor mark at step ${corridorMark.step} (${corridorMark.dir}); hideout mark ${hm ? `area ${hm.area}` : '-'}`);
    fs.writeFileSync(path.join(out, 'pictures.txt'), report.join('\n') + '\n');
  }, 900000);
});
