// Track 2 (VIS lane): opt-in check of the presentation on REAL generated extensions (lane GEN's generateStation output).
//   TRACK_EXT_GEN=1 [SEEDS=2,3,6] [TRACK_EXT_PREVIEW=1] ./node_modules/.bin/vitest run --config game/vitest.config.ts --maxWorkers=1 --no-file-parallelism game/tests/track-ext-vis-gen.test.ts
// Per seed: builds the world, checks no grid wall face shows inside a corridor, every entry door got a wall opening, every
// cap span is sane, and prints draws / triangles; with TRACK_EXT_PREVIEW=1 also renders mouth / mid / cap / door views
// (CPU, real textures) into qa-artifacts/track-ext-vis/gen/. Seeds without extensions are reported and skipped (before
// lane GEN's code is merged, every seed is).
import {describe, expect, it} from 'vitest';
import * as THREE from 'three';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {installCanvasShim, ShimCanvas} from './helpers/canvas2d';
import {TEXTURE_FILES, type TextureKey} from '../src/assets/manifest';
import {renderMeshes} from './helpers/meshPreview';
import type {TrackExtensions} from '../src/gen/trackExt/types';

const GAME = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(GAME, '..', 'qa-artifacts', 'track-ext-vis', 'gen');

describe.runIf(!!process.env.TRACK_EXT_GEN)('track-extension presentation on generated stations (TRACK_EXT_GEN=1)', () => {
  it('builds, clips and opens correctly on generated extensions', async () => {
    const render = !!process.env.TRACK_EXT_PREVIEW;
    installCanvasShim(render);
    const sharp = (await import('sharp')).default;
    const {WorldMaterials} = await import('../src/world/materials');
    const {buildWorld} = await import('../src/world/builder');
    const {generateStation} = await import('../src/gen/station');
    const {TunnelFrame} = await import('../src/world/trackExt/frame');
    const tex = {} as Record<TextureKey, THREE.Texture>;
    for (const [k, f] of Object.entries(TEXTURE_FILES) as [TextureKey, {url: string}][]) {
      if (!render) { tex[k] = new THREE.Texture({width: 64, height: 64} as unknown as HTMLImageElement); continue; }
      const {data, info} = await sharp(path.join(GAME, 'public', f.url)).ensureAlpha().raw().toBuffer({resolveWithObject: true});
      const c = new ShimCanvas(true); c.width = info.width; c.height = info.height; c.data.set(data);
      const t = new THREE.Texture(c as unknown as HTMLImageElement); t.wrapS = t.wrapT = THREE.RepeatWrapping;
      tex[k] = t;
    }
    fs.mkdirSync(OUT, {recursive: true});
    const mats = new WorldMaterials(tex, 7, {w: 1.2, h: 0.19, d: 0.17});
    const report: string[] = [];
    for (const seed of (process.env.SEEDS ?? '1,2,3,4,5,6').split(',').map(Number)) {
      const t0 = performance.now();
      const L = generateStation(seed);
      const tg = performance.now() - t0;
      const e = (L as {extensions?: TrackExtensions}).extensions;
      if (!e?.tunnels.length) { report.push(`seed ${seed} ${L.archetype}: no extensions`); continue; }
      const t1 = performance.now();
      const w = buildWorld(L, mats, {});
      const tb = performance.now() - t1;
      const te = w.trackExt!;
      let inside = 0;
      for (const f of w.wallFaces) if (te.view.insideAny((f.x0 + f.x1) / 2 + f.nx * 0.01, (f.z0 + f.z1) / 2 + f.nz * 0.01, 0.02, 0)) inside++;
      expect(inside, `seed ${seed}: grid faces inside a corridor`).toBe(0);
      expect(te.view.notes, `seed ${seed}: convention notes`).toEqual([]);
      for (const p of te.shells.perTunnel) {
        const t = e.tunnels.find(tt => tt.id === p.id)!;
        expect(p.openings.length).toBe(t.doors.length);
        for (const o of p.openings) { expect(o.s1 - o.s0).toBeGreaterThan(0.9); expect(o.head).toBeGreaterThan(t.floorY + 2); }
        expect(p.cap.back).toBeGreaterThanOrEqual(t.length - 1e-6);
        expect(p.cap.walkEnd).toBeLessThanOrEqual(t.length + 1e-6);
      }
      report.push(`seed ${seed} ${L.archetype}: gen ${tg.toFixed(0)} ms, build ${tb.toFixed(0)} ms; tunnels ${e.tunnels.length} annexes ${e.annexes.length}; ${JSON.stringify(te.stats)}`);
      for (const p of te.shells.perTunnel) report.push(`  tunnel ${p.id}: ${p.length.toFixed(1)} m, ${p.draws} draws, ${p.triangles} tris, cap ${p.cap.kind} front ${p.cap.front.toFixed(2)} walkEnd ${p.cap.walkEnd.toFixed(2)} back ${p.cap.back.toFixed(2)}, openings ${JSON.stringify(p.openings.map(o => [+o.s0.toFixed(2), +o.s1.toFixed(2), o.side, +o.head.toFixed(2)]))}`);
      if (render) for (const t of e.tunnels) {
        const f = new TunnelFrame(t);
        const at = (s: number, lat: number, y: number): [number, number, number] => { const [x, z] = f.point(s, lat); return [x, t.floorY + y, z]; };
        const mid = Math.min(t.length * 0.4, 30);
        const cams: [string, {pos: [number, number, number]; target: [number, number, number]; fov: number}][] = [
          ['mouth', {pos: at(-10, 1.0, 1.65), target: at(10, 0, 1.2), fov: 75}],
          ['mid', {pos: at(mid, 0.8, 1.65), target: at(mid + 15, 0, 1.3), fov: 75}],
          ['cap', {pos: at(t.length - 6, 0.6, 1.65), target: at(t.length, 0, 1.4), fov: 75}],
        ];
        for (const d of t.doors) cams.push([`door${d.door}`, {pos: at(d.s - 4, d.side * -1.2, 1.65), target: at(d.s, d.side * 4, 1.2), fov: 75}]);
        for (const [name, cam] of cams) {
          const px = renderMeshes(w.group, {far: 60, ...cam}, {width: 800, height: 450, flashlight: true, ambient: 0.4, fog: 0.025});
          await sharp(px, {raw: {width: 800, height: 450, channels: 3}}).png().toFile(path.join(OUT, `seed${seed}-t${t.id}-${name}.png`));
        }
      }
    }
    fs.writeFileSync(path.join(OUT, 'report.txt'), report.join('\n') + '\n');
    expect(report.length).toBeGreaterThan(0);
  }, 1_800_000);
});
