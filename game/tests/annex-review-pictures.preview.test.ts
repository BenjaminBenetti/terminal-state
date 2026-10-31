// Track 2 playtest revision (primary): opt-in CPU review pictures of the revised annexes on REAL generated levels (no WebGL, no
// browser) — the generator hall seen from its tight corridor (small / big rhythm, machinery, board-formed walls) and a supply shelf
// near the annex entry with its actual rolled lots (ContainerManager, the game's loot roll):
//   ANNEX_PICTURES=1 ./node_modules/.bin/vitest run --config game/vitest.config.ts --maxWorkers=1 --no-file-parallelism game/tests/annex-review-pictures.preview.test.ts
// Writes qa-artifacts/track2-revision-pictures/*.png (never committed). Approximate lighting (helpers/meshPreview.ts: flashlight +
// ambient, albedo only, no station lights): composition / identity review, not the game's look or darkness.
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

const GAME = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let models: Record<string, GLTF> = {};
beforeAll(async () => { if (process.env.ANNEX_PICTURES) models = await openableModels(); }, 120000);

describe.runIf(!!process.env.ANNEX_PICTURES)('annex review pictures (ANNEX_PICTURES=1)', () => {
  it('renders the corridor -> machinery hall view and an entry supply shelf with its lots', async () => {
    installCanvasShim(true);
    (ShimContext.prototype as unknown as {clip?: () => void}).clip ??= () => {};
    const out = path.resolve(GAME, '..', 'qa-artifacts', 'track2-revision-pictures');
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
    const shoot = async (name: string, group: THREE.Group, cam: PreviewCam, ambient = 0.45) => {
      const px = renderMeshes(group, {far: 60, fov: 72, ...cam}, {width: 960, height: 540, flashlight: true, ambient, fog: 0.02});
      await sharp(px, {raw: {width: 960, height: 540, channels: 3}}).png().toFile(path.join(out, `${name}.png`));
      report.push(`${name}: cam ${JSON.stringify(cam)}`);
    };
    const L = freshLayout('subway', 1043);
    // (round 2, R3) the generated genset (its own base-colour map decoded here: Node's GLTFLoader has no image decoder)
    const {loadStripped} = await import('./helpers/openablesFixture');
    const {ANNEX_GENSET} = await import('../src/assets/annexGenset');
    const genset = await loadStripped(ANNEX_GENSET.url);
    {
      const {NodeIO} = await import('@gltf-transform/core');
      const gd = await new NodeIO().read(path.join(GAME, 'public', ANNEX_GENSET.url));
      const img = gd.getRoot().listMaterials()[0].getBaseColorTexture()!.getImage()!;
      const {data, info} = await sharp(Buffer.from(img)).ensureAlpha().raw().toBuffer({resolveWithObject: true});
      const c = new ShimCanvas(true); c.width = info.width; c.height = info.height; c.data.set(data);
      const t = new THREE.Texture(c as unknown as HTMLImageElement); t.flipY = false; t.colorSpace = THREE.SRGBColorSpace;
      genset.scene.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) { (m.material as THREE.MeshStandardMaterial).map = t; (m.material as THREE.MeshStandardMaterial).needsUpdate = true; } });
    }
    const w = buildWorld(L, mats, {[ANNEX_GENSET.key]: genset});
    report.push(`gensets: ${JSON.stringify(w.trackExt?.gensets ?? null)}`);
    const cm = new ContainerManager(models, mats, () => ({}) as never);
    cm.build(L, {}, lootProfile('subway'));
    const scene = new THREE.Group();
    scene.add(w.group, cm.group);
    const A = L.extensions!.annexes[0], fy = A.floorY;
    // 1. a machinery hall (generator / turbine / boiler …) seen from the doorway of the corridor that opens onto it
    const halls = A.areas.map(id => L.areas[id]).filter(a => a.extHall).sort((p, q) => p.depth - q.depth);
    for (const h of halls.slice(0, 1)) {
      const d = L.doors.find(q => (q.a === h.id || q.b === h.id) && L.areas[q.a === h.id ? q.b : q.a]?.purpose === 'service-corridor') ?? L.doors.find(q => q.a === h.id || q.b === h.id)!;
      const dx = (d.x + d.w / 2) * CELL, dz = (d.y + d.h / 2) * CELL, hx = (h.x + h.w / 2) * CELL, hz = (h.y + h.h / 2) * CELL;
      const len = Math.hypot(hx - dx, hz - dz), ux = (hx - dx) / len, uz = (hz - dz) / len;
      await shoot(`hall-from-corridor-${h.purpose}`, scene, {pos: [dx - ux * 3.2, fy + 1.65, dz - uz * 3.2], target: [hx, fy + 1.1, hz]});
      await shoot(`hall-inside-${h.purpose}`, scene, {pos: [dx + ux * 1.2, fy + 1.65, dz + uz * 1.2], target: [hx + ux * 3, fy + 1.0, hz + uz * 3]});
    }
    // 2. the nearest stocked supply shelf to the annex entry, with its rolled lots, from 1.6 m in front
    const sup = cm.all.filter(hh => A.areas.includes(hh.prop.area) && hh.prop.purpose === 'annex-supply' && hh.state.lots.length)
      .sort((p, q) => Math.hypot(p.prop.x - A.exit.x, p.prop.z - A.exit.z) - Math.hypot(q.prop.x - A.exit.x, q.prop.z - A.exit.z));
    for (const hh of sup.slice(0, 2)) {
      const {aim, stand} = cm.aimPoint(hh);
      const vx = stand.x - aim.x, vz = stand.z - aim.z, n = Math.hypot(vx, vz) || 1;
      // as the game does each frame: aim from the eye (ContainerManager.target sets its view point), then update -> the lots draw
      const eye = new THREE.Vector3(aim.x + (vx / n) * 1.8, fy + 1.6, aim.z + (vz / n) * 1.8);
      cm.target(eye, new THREE.Vector3(aim.x, aim.y, aim.z).sub(eye).normalize(), levelsOf(L));
      for (let t = 0; t < 1; t += 1 / 30) cm.update(1 / 30, t);
      await shoot(`supply-${hh.kind}-${L.areas[hh.prop.area].purpose}`, scene, {pos: [aim.x + (vx / n) * 1.8, fy + 1.6, aim.z + (vz / n) * 1.8], target: [aim.x, aim.y, aim.z]}, 0.5);
      report.push(`  lots: ${hh.state.lots.map(l => l.itemId).join(', ')}; depth ${L.areas[hh.prop.area].depth}`);
    }
    // 3. (round 2, lane CACHE, R5) the survivor cache rooms (gen/annexCache.ts): from the doorway, and from the bedside toward the
    // storage with its rolled lots (iteration-07 camp things need their models: not drawn here)
    const {annexCachesOf} = await import('../src/gen/annexCache');
    for (const c of annexCachesOf(L).filter(q => q.annex === A.id)) {
      const a = L.areas[c.area], d = L.doors.find(q => q.a === a.id || q.b === a.id)!, bed = L.props[c.bed];
      const dx = (d.x + d.w / 2) * CELL, dz = (d.y + d.h / 2) * CELL, ax = (a.x + a.w / 2) * CELL, az = (a.y + a.h / 2) * CELL;
      const len = Math.hypot(ax - dx, az - dz) || 1, ux = (ax - dx) / len, uz = (az - dz) / len;
      for (const i of c.holders) {
        const hh = cm.all.find(q => q.prop === L.props[i])!;
        const {aim} = cm.aimPoint(hh);
        cm.target(new THREE.Vector3(dx + ux * 0.6, fy + 1.6, dz + uz * 0.6), new THREE.Vector3(aim.x, aim.y, aim.z).sub(new THREE.Vector3(dx, fy + 1.6, dz)).normalize(), levelsOf(L));
        if (hh.open || !hh.state.open) cm.interact({container: hh, t: 1, lot: null, part: hh.open ? 0 : undefined} as never); // open it, as a player would
      }
      for (let t = 0; t < 1.5; t += 1 / 30) cm.update(1 / 30, t);
      await shoot(`cache-${a.purpose}-from-door`, scene, {pos: [dx - ux * 0.4, fy + 1.65, dz - uz * 0.4], target: [ax, fy + 0.5, az]}, 0.55);
      // the bed from ~2 m in front of it (its front faces the room), a little to one side
      const fx = Math.sin(bed.rot), fz = Math.cos(bed.rot);
      await shoot(`cache-${a.purpose}-bed`, scene, {pos: [bed.x + fx * 2.1 + fz * 0.6, fy + 1.6, bed.z + fz * 2.1 - fx * 0.6], target: [bed.x, fy + 0.25, bed.z]}, 0.55);
      report.push(`cache room ${a.id} (${a.purpose}) depth ${c.depth}: ${c.holders.map(i => { const hh = cm.all.find(q => q.prop === L.props[i])!; return `${hh.kind} [${hh.state.lots.map(l => l.itemId).join(', ')}]`; }).join('; ')}; decor ${c.decor.map(i => L.props[i].kind).join(', ') || '-'}`);
    }
    fs.writeFileSync(path.join(out, 'pictures.txt'), report.join('\n') + '\n');
  }, 900000);
});
