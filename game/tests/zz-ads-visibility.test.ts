// TEMPORARY (sub-lane SHOPS-ADS, R5): visible ad pixels / distinct ads from walkway poses (CPU depth oracle) + light-field
// irradiance on the ad faces. Writes JSON; delete before finishing.
import {mkdirSync, writeFileSync} from 'node:fs';
import * as THREE from 'three';
import {it} from 'vitest';
import {installCanvasShim} from './helpers/canvas2d';
import {fakeEnvTextures} from './helpers/openablesFixture';
import {visibleMeshes} from './helpers/visibleMeshes';
import {WorldMaterials} from '../src/world/materials';
import {buildWorld} from '../src/world/builder';
import type {StationLayout} from '../src/gen/station';
import {mallQaPose, type MallPoseName} from '../src/gen/mall/qa';
import {MALL_FOG} from '../src/world/mallAtmosphere';
import {CELL} from '../src/gen/grid';
import {bakeLightField, sampleField, DEFAULT_FIELD} from '../src/world/lightField';
import {stationLevels} from '../src/world/levelGeometry';
import {mallSkyField} from '../src/world/mallSkylight';
import {MOOD} from '../src/world/lights';

installCanvasShim(false);
const OUT = process.env.LL_ADS_OUT ?? '/tmp/ads-visibility.json';
const SEEDS = (process.env.LL_ADS_SEEDS ?? '0x7ea3c1,4242').split(',').map(s => Number(s));
const POSES: [MallPoseName, number | undefined][] = [['court', undefined], ['ring-edge', 1], ['ring-edge', 2], ['ring-edge', 3], ['shopfront', 1], ['shopfront', 2], ['shopfront', 3],
  ['corridor', 1], ['corridor', 2], ['corridor', 3], ['escalator', 0], ['escalator', 1], ['wing-end', 1], ['wing-end', 2]];
const W = 160, H = 90;
const lum = (c: readonly number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

it('ad visibility', async () => {
  const {generateMallLevel} = await import('../src/gen/mall/index');
  const res: Record<string, unknown> = {};
  for (const seed of SEEDS) {
    const layout = generateMallLevel({levelSeed: seed, startWeapon: 'pistol'} as never) as StationLayout;
    const w = buildWorld(layout, new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17}), {});
    const arch = w.mallArch!;
    const ads = arch.ads;
    const adMesh = (m: THREE.Mesh) => /^mall-ad-(faces|decals|kiosk|menu|lit)/.test(m.name);
    let pixAll = 0, poses = 0;
    const seenAds = new Set<number>();
    const perPose: Record<string, {px: number; ads: number}> = {};
    for (const [name, ring] of POSES) {
      const p = mallQaPose(layout, name, ring);
      if (!p) continue;
      for (const turn of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
        const cam = new THREE.PerspectiveCamera(75, W / H, 0.05, MALL_FOG.far);
        cam.position.set(p.x, p.y + 1.62, p.z);
        cam.rotation.set(0, p.yaw + turn, 0, 'YXZ');
        cam.updateMatrixWorld(true); cam.updateProjectionMatrix();
        const samples = new Map<THREE.Mesh, [number, number, number][]>();
        const vis = visibleMeshes(w.group, cam, W, H, {minPx: 1, maxDist: 40, samples});
        let px = 0; const here = new Set<number>();
        for (const [m, n] of vis) {
          if (!adMesh(m)) continue;
          px += n;
          for (const [sx, sy, d] of samples.get(m) ?? []) {
            // world point of the pixel (view depth d along the ray)
            const ndc = new THREE.Vector3((sx + 0.5) / W * 2 - 1, (sy + 0.5) / H * 2 - 1, 0.5).unproject(cam).sub(cam.position).normalize();
            const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
            const pt = cam.position.clone().addScaledVector(ndc, d / ndc.dot(fwd));
            let best = -1, bd = 0.35;
            ads.forEach((a, i) => {
              const along = a.nz !== 0 ? Math.abs(pt.x - a.x) - a.w / 2 : Math.abs(pt.z - a.z) - a.w / 2;
              const up = Math.abs(pt.y - a.y) - a.h / 2;
              const off = a.nz !== 0 ? Math.abs(pt.z - a.z) : Math.abs(pt.x - a.x);
              const dd = Math.max(along, up, 0) + off * 0.5;
              if (dd < bd) { bd = dd; best = i; }
            });
            if (best >= 0) { here.add(best); seenAds.add(best); }
          }
        }
        pixAll += px; poses++;
        perPose[`${name}${ring ?? ''}@${Math.round(turn * 180 / Math.PI)}`] = {px, ads: here.size};
      }
    }
    // light-field irradiance on the faces (luminance, the game's field params) vs the public walkway at 1.6 m
    const field = bakeLightField({grid: layout.grid, lights: layout.lights, trenchFloorY: layout.trench.floorY, levels: stationLevels(layout), ...mallSkyField(layout, CELL)},
      {...DEFAULT_FIELD, gain: DEFAULT_FIELD.gain * MOOD.fixtureGain, bounce: MOOD.bounce});
    const irr = (x: number, y: number, z: number, n: [number, number, number]) => { const s = sampleField(field, x, y, z, [1, 1, 1], n); return lum(s.amb) + lum(s.dirColor) * Math.max(0, s.dir[0] * n[0] + s.dir[1] * n[1] + s.dir[2] * n[2]); };
    const med = (v: number[]) => { const s = [...v].sort((a, b) => a - b); return s.length ? +s[Math.floor(s.length / 2)].toFixed(3) : null; };
    const byKind: Record<string, number[]> = {};
    for (const a of ads) (byKind[a.kind] ??= []).push(irr(a.x + a.nx * 0.05, a.y, a.z + a.nz * 0.05, [a.nx, 0, a.nz]));
    const walk: number[] = [];
    for (const lv of layout.levels) {
      if (lv.id === 0) continue;
      const g = lv.grid;
      for (let i = 0; i < g.w * g.h; i += 7) {
        const a = layout.areas[Number(g.area[i])];
        if (g.cells[i] !== 1 || !a || a.role !== 'mall') continue;
        const cx = i % g.w, cy = (i - cx) / g.w;
        walk.push(irr((cx + 0.5) * CELL, lv.baseY + 1.6, (cy + 0.5) * CELL, [0, 0, 1]));
      }
    }
    res[`0x${seed.toString(16)}`] = {
      ads: ads.length, poses, distinctAdsSeen: seenAds.size, adPixelsTotal: pixAll, adPixelsPerView: +(pixAll / Math.max(1, poses)).toFixed(1),
      screenShare: +(pixAll / Math.max(1, poses) / (W * H) * 100).toFixed(2) + '%',
      seenByKind: [...seenAds].reduce((o, i) => { const k = ads[i].kind + (ads[i].shop ? '' : ':gallery'); o[k] = (o[k] ?? 0) + 1; return o; }, {} as Record<string, number>),
      perPose,
      irradiance: {walkwayMedian: med(walk), faceMedianByKind: Object.fromEntries(Object.entries(byKind).map(([k, v]) => [k, med(v)]))},
    };
  }
  mkdirSync(OUT.replace(/\/[^/]+$/, ''), {recursive: true});
  writeFileSync(OUT, JSON.stringify(res, null, 1));
}, 900000);
