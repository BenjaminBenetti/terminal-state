// Track 2 playtest revision (lane ART): opt-in CPU before / after previews of the station-side invitation art and the
// extension wall finishes on REAL generated levels (no WebGL, no browser):
//   TRACK_EXT_ART_PREVIEW=1 [ART_OUT=label] ./node_modules/.bin/vitest run --config game/vitest.config.ts --maxWorkers=1 --no-file-parallelism game/tests/track-ext-art-preview.test.ts
// Writes qa-artifacts/track2-revision-art/<label>/*.png (never committed). Approximate lighting (helpers/meshPreview.ts:
// flashlight + ambient, albedo only: no normal map, no decay hook, no station lights): composition / legibility / texel
// density review at player height, not the game's look.
import {describe, expect, it} from 'vitest';
import * as THREE from 'three';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {installCanvasShim, ShimCanvas} from './helpers/canvas2d';
import {renderMeshes, type PreviewCam} from './helpers/meshPreview';
import {TEXTURE_FILES, type TextureKey} from '../src/assets/manifest';
import type {StationLayout} from '../src/gen/stationTypes';

const GAME = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Seeds (tests/track-ext.test.ts corpora): a tunnel-door annex (split, east tunnel) and a service-hatch annex (island-ends). */
const TUNNEL_SEED = 4055629249, HATCH_SEED = 2654448106;

describe.runIf(!!process.env.TRACK_EXT_ART_PREVIEW)('station invitation art + extension walls: CPU previews (TRACK_EXT_ART_PREVIEW=1)', () => {
  it('renders the station views, the routes and an annex wall at ~2 m', async () => {
    installCanvasShim(true);
    const out = path.resolve(GAME, '..', 'qa-artifacts', 'track2-revision-art', process.env.ART_OUT ?? 'after');
    fs.mkdirSync(out, {recursive: true});
    const sharp = (await import('sharp')).default;
    const {WorldMaterials} = await import('../src/world/materials');
    const {buildWorld} = await import('../src/world/builder');
    const {generateStation} = await import('../src/gen/station');
    const tex = {} as Record<TextureKey, THREE.Texture>;
    for (const [k, f] of Object.entries(TEXTURE_FILES) as [TextureKey, {url: string}][]) {
      const {data, info} = await sharp(path.join(GAME, 'public', f.url)).ensureAlpha().raw().toBuffer({resolveWithObject: true});
      const c = new ShimCanvas(true); c.width = info.width; c.height = info.height; c.data.set(data);
      const t = new THREE.Texture(c as unknown as HTMLImageElement); t.wrapS = t.wrapT = THREE.RepeatWrapping;
      tex[k] = t;
    }
    const mats = new WorldMaterials(tex, 7, {w: 1.2, h: 0.19, d: 0.17});
    const only = (process.env.ART_ONLY ?? '').split(',').filter(Boolean);
    const report: string[] = [];
    const shoot = async (name: string, L: StationLayout, w: ReturnType<typeof buildWorld>, cam: PreviewCam, ambient = 0.42, size: [number, number] = [960, 540]) => {
      if (only.length && !only.includes(name)) return;
      const t0 = performance.now();
      const px = renderMeshes(w.group, {far: 70, fov: 75, ...cam}, {width: size[0], height: size[1], flashlight: true, ambient, fog: 0.02});
      await sharp(px, {raw: {width: size[0], height: size[1], channels: 3}}).png().toFile(path.join(out, `${name}.png`));
      report.push(`${name}: seed ${L.seed >>> 0} ${L.archetype}, cam ${JSON.stringify(cam)}, ${Math.round(performance.now() - t0)} ms`);
    };
    // --- tunnel-door annex: split station, east tunnel (trench 0 x1 = 148.5 m), platform P1 south (z 74.5-83.5) ---
    {
      const L = generateStation(TUNNEL_SEED);
      const w = buildWorld(L, mats, {});
      const t = L.extensions!.tunnels.find(tt => tt.doors.length)!, tr = L.trenches[t.trench];
      const xe = t.from === 'x1' ? tr.x1 : tr.x0, dir = t.from === 'x1' ? -1 : 1, y0 = tr.floorY;
      // the player on the platform south of the bed, ~16 m from the platform end, eye 1.65 m, looking at the bed end
      const pz = tr.z1 + 2.5;
      await shoot('station-tunnel', L, w, {pos: [xe + dir * 22, 1.65, pz], target: [xe, 0.4, (tr.z0 + tr.z1) / 2 - 1.5]});
      await shoot('station-tunnel-near', L, w, {pos: [xe + dir * 9, 1.65, pz + 0.5], target: [xe - dir * 1, 0.2, tr.z0]});
      // the route: standing in the bed at the mouth, looking down the tunnel to the door side
      const {TunnelFrame} = await import('../src/world/trackExt/frame');
      const f = new TunnelFrame(t), d = t.doors[0];
      const at = (s: number, lat: number, y: number): [number, number, number] => { const [x, z] = f.point(s, lat); return [x, y0 + y, z]; };
      await shoot('route-tunnel', L, w, {pos: at(-3, -d.side * 1.2, 1.65), target: at(d.s, d.side * 3.2, 1.2)});
      await shoot('route-tunnel-door', L, w, {pos: at(d.s - 4.5, -d.side * 1.0, 1.65), target: at(d.s, d.side * 4, 1.3)});
      // an annex wall at ~2 m: the first annex room with a solid west wall stretch
      const an = L.extensions!.annexes[0];
      const g = L.grid;
      for (const id of an.areas) {
        const a = L.areas[id];
        if (a.kind !== 'room' || a.w < 8 || a.h < 8) continue;
        const zc = (a.y + a.h / 2) * 0.5, xw = a.x * 0.5;
        const [cx, cy] = g.cellOf(xw - 0.25, zc);
        if (g.passable(cx, cy)) continue;
        const fy = an.floorY;
        await shoot('annex-wall-2m', L, w, {pos: [xw + 2.0, fy + 1.65, zc], target: [xw, fy + 1.2, zc + 0.6]}, 0.5);
        await shoot('annex-wall-1m', L, w, {pos: [xw + 1.0, fy + 1.65, zc + 0.4], target: [xw, fy + 1.3, zc + 0.9]}, 0.5);
        break;
      }
    }
    // --- service-hatch annex: island-ends station, hatch in trench 0's N wall near x1 ---
    {
      const L = generateStation(HATCH_SEED);
      const w = buildWorld(L, mats, {});
      const n = L.extensions!.annexes.find(a => a.bed)!, b = n.bed!, tr = L.trenches[b.trench];
      const dir = b.from === 'x1' ? -1 : 1, wallZ = b.wall === 'N' ? tr.z0 : tr.z1, across = b.wall === 'N' ? 1 : -1;
      // the island platform across the bed, ~18 m back from the hatch
      await shoot('station-hatch', L, w, {pos: [b.x + dir * 18, 1.65, wallZ + across * (tr.z1 - tr.z0 + 3)], target: [b.x, 0.2, wallZ]});
      await shoot('route-hatch', L, w, {pos: [b.x + dir * 9, tr.floorY + 1.65, (tr.z0 + tr.z1) / 2 + across * 0.8], target: [b.x, tr.floorY + 1.1, wallZ]});
    }
    fs.writeFileSync(path.join(out, 'previews.txt'), report.join('\n') + '\n');
    expect(report.length).toBeGreaterThan(0);
  }, 1_800_000);
});
