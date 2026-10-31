// Track 2 (VIS lane): opt-in CPU previews of the track tunnels (no WebGL, no browser).
//   TRACK_EXT_PREVIEW=1 ./node_modules/.bin/vitest run --config game/vitest.config.ts --maxWorkers=1 --no-file-parallelism game/tests/track-ext-vis-preview.test.ts
// Builds the synthetic track-extension fixture (helpers/trackExtFixture.ts) with the real environment textures (decoded
// with sharp) and the canvas-shim rasterizer, then renders player-eye views — the tunnel mouth from the bed, along the
// straight, into the bend, the annex door, the graffiti, each cap kind — into qa-artifacts/track-ext-vis/. Approximate
// lighting (helpers/meshPreview.ts: flashlight + ambient): composition / continuity / scale review, not the game's look.
import {describe, expect, it} from 'vitest';
import * as THREE from 'three';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {installCanvasShim, ShimCanvas} from './helpers/canvas2d';
import {renderMeshes, type PreviewCam} from './helpers/meshPreview';
import {trackExtFixture, type TrackExtFixtureOpts} from './helpers/trackExtFixture';
import {TEXTURE_FILES, type TextureKey} from '../src/assets/manifest';

const GAME = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(GAME, '..', 'qa-artifacts', 'track-ext-vis');

describe.runIf(!!process.env.TRACK_EXT_PREVIEW)('track extension CPU previews (TRACK_EXT_PREVIEW=1)', () => {
  it('renders the tunnel mouth, bend, door, graffiti and caps', async () => {
    installCanvasShim(true);
    const sharp = (await import('sharp')).default;
    const {WorldMaterials} = await import('../src/world/materials');
    const {buildWorld} = await import('../src/world/builder');
    const tex = {} as Record<TextureKey, THREE.Texture>;
    for (const [k, f] of Object.entries(TEXTURE_FILES) as [TextureKey, {url: string}][]) {
      const {data, info} = await sharp(path.join(GAME, 'public', f.url)).ensureAlpha().raw().toBuffer({resolveWithObject: true});
      const c = new ShimCanvas(true); c.width = info.width; c.height = info.height; c.data.set(data);
      const t = new THREE.Texture(c as unknown as HTMLImageElement); t.wrapS = t.wrapT = THREE.RepeatWrapping;
      tex[k] = t;
    }
    fs.mkdirSync(OUT, {recursive: true});
    const mats = new WorldMaterials(tex, 7, {w: 1.2, h: 0.19, d: 0.17});
    const only = (process.env.TRACK_EXT_PREVIEW_ONLY ?? '').split(',').filter(Boolean);
    const report: string[] = [];
    const shots: {name: string; opts: TrackExtFixtureOpts; cam: (fx: ReturnType<typeof trackExtFixture>, at: (s: number, lat: number, y: number, t?: 'east' | 'west') => [number, number, number]) => PreviewCam; size?: [number, number]; ambient?: number}[] = [
      {name: 'mouth-from-bed', opts: {}, cam: (_fx, at) => ({pos: at(-14, 1.2, 1.65), target: at(6, 0, 1.2), fov: 75})},
      {name: 'mouth-wide', opts: {}, cam: (_fx, at) => ({pos: at(-9, -2.2, 3.2), target: at(8, 0.5, 0.9), fov: 80}), ambient: 0.55},
      {name: 'straight-to-bend', opts: {}, cam: (_fx, at) => ({pos: at(2, 1.0, 1.65), target: at(20, 0.5, 1.3), fov: 75})},
      {name: 'in-bend', opts: {}, cam: (_fx, at) => ({pos: at(15, 0.6, 1.65), target: at(26, -1.2, 1.4), fov: 75})},
      {name: 'door', opts: {}, cam: (fx, at) => { const d = fx.east.doors[0]; return {pos: at(d.s - 4.5, 1.4, 1.65), target: at(d.s, -4, 1.3), fov: 75}; }},
      {name: 'graffiti', opts: {}, cam: (_fx, at) => ({pos: at(2.5, 0.3, 1.65), target: at(5, -4, 1.6), fov: 70})},
      {name: 'graffiti-tag', opts: {}, cam: (_fx, at) => ({pos: at(3.5, -0.8, 1.65), target: at(5.5, 4, 1.8), fov: 70})},
      {name: 'cap-rubble', opts: {eastCap: 'rubble'}, cam: (fx, at) => ({pos: at(fx.east.length - 7, 0.8, 1.65), target: at(fx.east.length, -0.2, 1.4), fov: 75})},
      {name: 'cap-gate', opts: {eastCap: 'gate'}, cam: (fx, at) => ({pos: at(fx.east.length - 6, 1.0, 1.65), target: at(fx.east.length, -0.2, 1.8), fov: 75})},
      {name: 'cap-bulkhead', opts: {}, cam: (_fx, at) => ({pos: at(10, 0.8, 1.65, 'west'), target: at(16, -0.2, 1.5, 'west'), fov: 75})},
      {name: 'bed-end-no-tunnel', opts: {noWest: true}, cam: (_fx) => ({pos: [28, 0.5, 31], target: [19, 0.2, 32], fov: 75})},
    ];
    const {TunnelFrame} = await import('../src/world/trackExt/frame');
    {
      // The graffiti atlas itself (white marks tinted per decal in game), over mid grey.
      const {paintGraffitiAtlas, ATLAS} = await import('../src/world/trackExt/graffiti');
      const c = new ShimCanvas(true); c.width = ATLAS.w; c.height = ATLAS.h;
      paintGraffitiAtlas(c.getContext() as unknown as CanvasRenderingContext2D, ATLAS.w, ATLAS.h);
      const rgb = Buffer.alloc(ATLAS.w * ATLAS.h * 3);
      for (let i = 0; i < ATLAS.w * ATLAS.h; i++) { const a = c.data[i * 4 + 3] / 255; for (let k = 0; k < 3; k++) rgb[i * 3 + k] = Math.round(110 * (1 - a) + c.data[i * 4 + k] * a); }
      if (!only.length || only.includes('atlas')) await sharp(rgb, {raw: {width: ATLAS.w, height: ATLAS.h, channels: 3}}).png().toFile(path.join(OUT, 'graffiti-atlas.png'));
    }
    for (const shot of shots) {
      if (only.length && !only.includes(shot.name)) continue;
      const fx = trackExtFixture(shot.opts);
      const w = buildWorld(fx.layout, mats, {});
      const fE = new TunnelFrame(fx.east), fW = fx.west ? new TunnelFrame(fx.west) : null;
      const at = (s: number, lat: number, y: number, t: 'east' | 'west' = 'east'): [number, number, number] => {
        const f = t === 'east' ? fE : fW!;
        const [x, z] = f.point(s, lat);
        return [x, fx.east.floorY + y, z];
      };
      const cam = shot.cam(fx, at);
      const [W, H] = shot.size ?? [960, 540];
      const t0 = performance.now();
      const px = renderMeshes(w.group, {far: 60, ...cam}, {width: W, height: H, flashlight: true, ambient: shot.ambient ?? 0.38, fog: 0.025});
      await sharp(px, {raw: {width: W, height: H, channels: 3}}).png().toFile(path.join(OUT, `${shot.name}.png`));
      report.push(`${shot.name}: ${Math.round(performance.now() - t0)} ms; trackExt ${JSON.stringify(w.trackExt?.stats)}`);
    }
    fs.writeFileSync(path.join(OUT, 'previews.txt'), report.join('\n') + '\n');
    expect(report.length).toBeGreaterThan(0);
  }, 900_000);
});
