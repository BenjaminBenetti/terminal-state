// Iteration 08 (Lane W): opt-in CPU previews of the wall treatment (no WebGL, no browser).
//   WALL_PREVIEW=1 [WALL_PREVIEW_SEEDS=7001,fixture] npx vitest run --config game/vitest.config.ts tests/wall-detail-preview.test.ts
// Builds real stations with the real environment textures (decoded with sharp) and the canvas-shim
// rasterizer, then renders, per treatment, a flashlight perspective on the most damaged spot, a view
// along the wall and an orthographic elevation into qa-artifacts/iter08-walls/. Approximate lighting
// (helpers/meshPreview.ts): for composition / alignment / seam review, not a stand-in for the game.
import {describe, expect, it} from 'vitest';
import * as THREE from 'three';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {installCanvasShim, ShimCanvas} from './helpers/canvas2d';
import {renderMeshes, type PreviewCam} from './helpers/meshPreview';
import {levelFixture} from './helpers/levelFixture';
import {TEXTURE_FILES, type TextureKey} from '../src/assets/manifest';
import {faceFrame} from '../src/world/wallDetailFaces';
import type {WallDetailResult} from '../src/world/wallDetail';

const GAME = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(GAME, '..', 'qa-artifacts', 'iter08-walls');

describe.runIf(!!process.env.WALL_PREVIEW)('wall treatment CPU previews (WALL_PREVIEW=1)', () => {
  it('renders treated walls per zone', async () => {
    installCanvasShim(true);
    const sharp = (await import('sharp')).default;
    const {WorldMaterials} = await import('../src/world/materials');
    const {buildWorld} = await import('../src/world/builder');
    const {Levels} = await import('../src/gen/levels');
    const {stationLevels} = await import('../src/world/levelGeometry');
    const tex = {} as Record<TextureKey, THREE.Texture>;
    for (const [k, f] of Object.entries(TEXTURE_FILES) as [TextureKey, {url: string}][]) {
      const {data, info} = await sharp(path.join(GAME, 'public', f.url)).ensureAlpha().raw().toBuffer({resolveWithObject: true});
      const c = new ShimCanvas(true); c.width = info.width; c.height = info.height; c.data.set(data);
      const t = new THREE.Texture(c as unknown as HTMLImageElement); t.wrapS = t.wrapT = THREE.RepeatWrapping;
      tex[k] = t;
    }
    fs.mkdirSync(OUT, {recursive: true});
    const mats = new WorldMaterials(tex, 7, {w: 1.2, h: 0.19, d: 0.17});
    const report: string[] = [];
    for (const seed of (process.env.WALL_PREVIEW_SEEDS ?? '7001,fixture').split(',')) {
      const L = seed === 'fixture' ? levelFixture() : (await import('../src/gen/station')).generateStation(Number(seed));
      const w = buildWorld(L, mats, {});
      const r = w.group.getObjectByName('wall-detail')!.userData.wallDetailResult as WallDetailResult;
      const plan = r.plan;
      report.push(`seed ${seed} (${L.archetype}): ${JSON.stringify({...r.stats, features: undefined})}`);
      const levels = new Levels(stationLevels(L));
      // Per treatment: the face with the most (weighted) damage; plus every breach face.
      const score = new Map<number, number>();
      for (const f of plan.features) score.set(f.face, (score.get(f.face) ?? 0) + (f.kind === 'breach' ? 20 : f.layer === 'cut' ? 3 : 1));
      const order = [...score.entries()].sort((a, b) => b[1] - a[1]);
      const picks: number[] = [];
      const seen = new Set<string>();
      for (const [i] of order) { const pf = plan.faces[i]; if (seen.has(pf.treatment) || pf.len < 3) continue; seen.add(pf.treatment); picks.push(i); }
      for (const [i] of order) if (plan.features.some(f => f.face === i && f.kind === 'breach') && !picks.includes(i)) picks.push(i);
      let n = 0;
      for (const i of picks.slice(0, 14)) {
        const pf = plan.faces[i], f = pf.face, {len, tx, tz} = faceFrame(f);
        const mine = plan.features.filter(x => x.face === i);
        const focus = mine.find(x => x.kind === 'breach') ?? mine.find(x => x.kind === 'recess') ?? mine.find(x => x.layer === 'cut') ?? mine.find(x => x.kind === 'streak') ?? mine[0];
        const sc = focus ? (focus.s0 + focus.s1) / 2 : len / 2;
        const at = (s: number, y: number, off: number): [number, number, number] => [f.x0 + tx * s + f.nx * off, y, f.z0 + tz * s + f.nz * off];
        const eyeY = Math.min(f.y1 - 0.2, f.y0 + 1.6);
        let room = 0.3;
        while (room < 4 && levels.isFree(...at(sc, eyeY, room + 0.15))) room += 0.1;
        const d = Math.max(0.6, Math.min(2.6, room * 0.85));
        const side = Math.min(1.2, d * 0.5) * (sc > len / 2 ? 1 : -1);
        const hView = Math.min(f.y1 - f.y0, 4.5);
        const cams: [string, PreviewCam][] = [
          ['persp', {pos: at(Math.max(0.2, Math.min(len - 0.2, sc - side)), eyeY, d), target: at(sc, focus ? Math.min(f.y1, (focus.y0 + focus.y1) / 2) : f.y0 + 1.3, 0), fov: 75}],
          ['along', {pos: at(Math.max(0.4, sc - 7), eyeY, Math.min(d, 1.6)), target: at(Math.min(len, sc + 3), f.y0 + 1.2, 0), fov: 75}],
          ['elev', {pos: at(sc, f.y0 + hView / 2, 6), target: at(sc, f.y0 + hView / 2, 0), ortho: hView + 0.3, far: 7}],
        ];
        for (const [kind, cam] of cams) {
          const W = kind === 'elev' ? 1200 : 960, H = kind === 'elev' ? 400 : 540;
          const px = renderMeshes(w.group, cam, {width: W, height: H, flashlight: kind !== 'elev', ambient: kind === 'elev' ? 0.55 : 0.3, fog: kind === 'elev' ? 0 : 0.03});
          await sharp(px, {raw: {width: W, height: H, channels: 3}}).png().toFile(path.join(OUT, `seed${seed}-${String(n).padStart(2, '0')}-${pf.treatment}-${kind}.png`));
        }
        report.push(`  ${String(n).padStart(2, '0')} ${pf.treatment} (${f.zone}, ${f.finish}, level ${f.level}) len ${len.toFixed(1)} H ${(f.y1 - f.y0).toFixed(2)}: ${mine.map(x => x.kind).join(',')}`);
        n++;
      }
    }
    fs.writeFileSync(path.join(OUT, 'previews.txt'), report.join('\n') + '\n');
    expect(fs.existsSync(path.join(OUT, 'previews.txt'))).toBe(true);
  }, 900_000);
});
