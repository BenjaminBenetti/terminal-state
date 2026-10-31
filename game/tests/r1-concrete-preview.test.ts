// Task track2-round2 R1 (lane CONCRETE): opt-in CPU before / after renders of the Beyond-the-Station concrete (annex walls =
// world-mapped board-formed set, tunnel shell = the same set on developed UVs) at PLAYER HEIGHT on a REAL generated level, with
// mip-mapped + anisotropic sampling (helpers/meshPreview.ts `mips`: what survives minification at that distance) and linear-light
// shading (`pbr`: normal + roughness maps, the game's flashlight spot model, the annex fixtures as light-field-shaped point lights,
// world-mapping macro tone + floor grime, exp2 fog 0.043, ACES 0.78). Each view twice: aniso 16 (the surfaces' native request)
// and aniso 1 (the software-rasterizer cap, render/softwareGl.ts). Also writes the board-formed set's per-mip texture metrics.
//   R1_CONCRETE=1 R1_OUT=before|after ./node_modules/.bin/vitest run --config game/vitest.config.ts --maxWorkers=1 --no-file-parallelism game/tests/r1-concrete-preview.test.ts
// Writes qa-artifacts/r1-concrete/<label>/*.png + metrics.json (never committed), and compare/*.png (before | after) once both exist.
// APPROXIMATIONS (stated in views.txt): CPU raster, no shadows / occlusion of the lights, no decay hook (grime / streaks /
// efflorescence), no light-field bounce beyond a 0.17 isotropic share, flashlight at the eye, no bloom / volumetrics. Not the
// game's exact look and NOT a native-GPU result; the comparison is like-for-like (same renderer, seed, cameras, lights).
import {describe, expect, it} from 'vitest';
import * as THREE from 'three';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {installCanvasShim, ShimCanvas} from './helpers/canvas2d';
import {mipChain, mipStats, renderMeshes, type PreviewCam, type PreviewLight} from './helpers/meshPreview';
import {freshLayout} from './helpers/annexRoute';
import {TEXTURE_FILES, type TextureKey} from '../src/assets/manifest';
import {CELL} from '../src/gen/grid';

const GAME = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SEED = 1043;
const [RW, RH] = (process.env.R1_RES ?? '1920x1080').split('x').map(Number);

/** Per-mip statistics of a texture: colour = linear luminance, rough = G, normal = |xy| tilt (minified normals average out). */
function texMetrics(t: THREE.Texture, kind: 'color' | 'rough' | 'normal', spanM: number) {
  const mc = mipChain(t)!;
  return mc.levels.map((m, level) => {
    let s = 0, s2 = 0, mn = Infinity, mx = -Infinity;
    const n = m.w * m.h;
    for (let i = 0; i < n; i++) {
      const r = m.d[i * 4], g = m.d[i * 4 + 1], b = m.d[i * 4 + 2];
      const val = kind === 'color' ? 0.2126 * r + 0.7152 * g + 0.0722 * b : kind === 'rough' ? g : Math.hypot(r * 2 - 1, g * 2 - 1);
      s += val; s2 += val * val; mn = Math.min(mn, val); mx = Math.max(mx, val);
    }
    const mean = s / n, std = Math.sqrt(Math.max(0, s2 / n - mean * mean));
    return {level, px: m.w, texelMm: +(spanM * 1000 / m.w).toFixed(1), mean: +mean.toFixed(4), std: +std.toFixed(4), rel: +(std / (mean || 1)).toFixed(4), min: +mn.toFixed(3), max: +mx.toFixed(3)};
  });
}

describe.runIf(!!process.env.R1_CONCRETE)('R1 concrete: CPU before / after at player height (R1_CONCRETE=1)', () => {
  it('renders the annex corridor (~3 m), a hall wall (~7 m) and the tunnel shell, aniso 16 and 1, plus texture metrics', async () => {
    installCanvasShim(true);
    const label = process.env.R1_OUT ?? 'after';
    const root = path.resolve(GAME, '..', 'qa-artifacts', 'r1-concrete');
    const out = path.join(root, label);
    fs.mkdirSync(out, {recursive: true});
    const sharp = (await import('sharp')).default;
    const {WorldMaterials} = await import('../src/world/materials');
    const {buildWorld} = await import('../src/world/builder');
    const {boardFormedSet, BOARD_SPAN, annexWallMaterial} = await import('../src/world/trackExt/wallFinish');
    const tex = {} as Record<TextureKey, THREE.Texture>;
    for (const [k, f] of Object.entries(TEXTURE_FILES) as [TextureKey, {url: string; srgb: boolean}][]) {
      const {data, info} = await sharp(path.join(GAME, 'public', f.url)).ensureAlpha().raw().toBuffer({resolveWithObject: true});
      const c = new ShimCanvas(true); c.width = info.width; c.height = info.height; c.data.set(data);
      const t = new THREE.Texture(c as unknown as HTMLImageElement); t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.colorSpace = f.srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      tex[k] = t;
    }
    const mats = new WorldMaterials(tex, 7, {w: 1.2, h: 0.19, d: 0.17});

    // ---- texture metrics (the shared board-formed set) ----
    const t0 = performance.now();
    const s = boardFormedSet();
    const paintMs = Math.round(performance.now() - t0);
    const am = annexWallMaterial(mats) as THREE.MeshStandardMaterial;
    const metrics = {
      label, paintMs,
      sizes: {color: [(s.map.image as {width: number}).width, (s.map.image as {height: number}).height], rough: (s.roughnessMap?.image as {width: number} | undefined)?.width ?? 0, normal: (s.normalMap?.image as {width: number} | undefined)?.width ?? 0},
      material: {color: am.color.getHexString(), roughness: am.roughness, normalScale: am.normalScale.x, macro: (am as unknown as {wmGrime: THREE.Vector3}).wmGrime.z},
      color: texMetrics(s.map, 'color', BOARD_SPAN),
      rough: s.roughnessMap ? texMetrics(s.roughnessMap, 'rough', BOARD_SPAN) : [],
      normal: s.normalMap ? texMetrics(s.normalMap, 'normal', BOARD_SPAN) : [],
    };
    fs.writeFileSync(path.join(out, 'metrics.json'), JSON.stringify(metrics, null, 1));
    fs.writeFileSync(`/tmp/r1-metrics-${label}.json`, JSON.stringify(metrics, null, 1));
    // the colour map itself (one 2.4 m repeat) and its 0.3 m-texel mip, for the record
    const sw = s.map.image as unknown as ShimCanvas;
    await sharp(Buffer.from(sw.data), {raw: {width: sw.width, height: sw.height, channels: 4}}).png().toFile(path.join(out, 'swatch-color.png'));

    // ---- the level: subway 1043, first annex ----
    const L = freshLayout('subway', SEED);
    const w = buildWorld(L, mats, {});
    const A = L.extensions!.annexes[0], fy = A.floorY;
    const inAnnex = new Set(A.areas);
    const lights: PreviewLight[] = w.fixtures.filter(f => inAnnex.has(f.area) && !f.broken && f.power > 0.01)
      .map(f => ({pos: [f.x, f.y - 0.1, f.z], intensity: 21 * f.power, range: Math.max(4, 9 * Math.sqrt(Math.min(1.5, f.power))), color: f.warm ? [1.38, 0.86, 0.42] : f.power < 0.8 ? [0.95, 1.04, 0.6] : [0.88, 1.03, 0.92]}));
    const report: string[] = [
      `R1 concrete preview — label ${label}, seed ${SEED} subway, annex 0 floorY ${fy}, ${RW}x${RH} fov 75 (game default), ${lights.length} working annex fixtures as point lights`,
      'Lighting approximation: three SpotLight flashlight model at the eye (34 cd, 0.58 rad, penumbra 0.7, decay 1.2), fixtures = light-field-shaped points (21 x power, lobe, window R, 0.17 isotropic), MOOD hemisphere 0.045, exp2 fog 0.043, ACES exposure 0.78; no shadows, no decay hook, no bounce/bloom/volumetrics.',
      `board-formed set paint time (node canvas shim): ${paintMs} ms`,
    ];
    const pbr = {lights, flashlight: {intensity: 34, angle: 0.58, penumbra: 0.7, decay: 1.2, distance: 30}, ambient: {sky: [0.275, 0.332, 0.287] as [number, number, number], ground: [0.01, 0.011, 0.01] as [number, number, number], intensity: 0.045}, exposure: 0.78, fogDensity: 0.043, floorY: fy};
    const only = (process.env.R1_ONLY ?? '').split(',').filter(Boolean);
    const shoot = async (name: string, cam: PreviewCam, aniso: number, extra: {exposure?: number} = {}) => {
      if (only.length && !only.includes(name)) return;
      const t1 = performance.now();
      mipStats.lodSum = mipStats.samples = mipStats.taps = 0;
      const px = renderMeshes(w.group, {far: 60, fov: 75, near: 0.05, ...cam}, {width: RW, height: RH, mips: {aniso}, pbr: {...pbr, ...extra}});
      await sharp(px, {raw: {width: RW, height: RH, channels: 3}}).png().toFile(path.join(out, `${name}.png`));
      report.push(`${name}: aniso ${aniso}, cam ${JSON.stringify(cam)}, mean LOD ${(mipStats.lodSum / Math.max(1, mipStats.samples)).toFixed(2)}, mean taps ${(mipStats.taps / Math.max(1, mipStats.samples)).toFixed(2)}, ${Math.round(performance.now() - t1)} ms`);
    };
    const areas = A.areas.map(id => L.areas[id]);
    // 1. the longest annex service corridor: eye 1.6 m at one end, looking at its side wall ~3 m ahead (grazing ~15-20 deg)
    const cor = areas.filter(a => a.purpose === 'service-corridor').sort((p, q) => Math.max(q.w, q.h) - Math.max(p.w, p.h))[0];
    if (cor) {
      const alongX = cor.w >= cor.h, x0 = cor.x * CELL, z0 = cor.y * CELL, x1 = (cor.x + cor.w) * CELL, z1 = (cor.y + cor.h) * CELL;
      const eye: [number, number, number] = alongX ? [x0 + 0.5, fy + 1.6, (z0 + z1) / 2] : [(x0 + x1) / 2, fy + 1.6, z0 + 0.5];
      const tgt: [number, number, number] = alongX ? [x0 + 3.5, fy + 1.3, z0] : [x0, fy + 1.3, z0 + 3.5];
      report.push(`corridor: area ${cor.id} ${cor.purpose} ${cor.w}x${cor.h} cells`);
      await shoot('corridor-3m-aniso16', {pos: eye, target: tgt}, 16);
      await shoot('corridor-3m-aniso1', {pos: eye, target: tgt}, 1);
      // straight down the corridor (both side walls receding 1-10 m)
      const far: [number, number, number] = alongX ? [x1, fy + 1.3, (z0 + z1) / 2] : [(x0 + x1) / 2, fy + 1.3, z1];
      await shoot('corridor-axis-aniso16', {pos: eye, target: far}, 16);
    }
    // 2. the biggest annex room / hall: eye 1.6 m, ~7 m in front of its far wall, looking at it slightly off-axis
    const hall = areas.filter(a => a.kind === 'room').sort((p, q) => q.w * q.h - p.w * p.h)[0];
    if (hall) {
      const x0 = hall.x * CELL, z0 = hall.y * CELL, x1 = (hall.x + hall.w) * CELL, z1 = (hall.y + hall.h) * CELL;
      const alongX = x1 - x0 >= z1 - z0, d = Math.min(7, (alongX ? x1 - x0 : z1 - z0) - 0.6);
      const eye: [number, number, number] = alongX ? [x1 - d, fy + 1.6, (z0 + z1) / 2 - 0.6] : [(x0 + x1) / 2 - 0.6, fy + 1.6, z1 - d];
      const tgt: [number, number, number] = alongX ? [x1, fy + 1.4, (z0 + z1) / 2 + 0.8] : [(x0 + x1) / 2 + 0.8, fy + 1.4, z1];
      report.push(`hall: area ${hall.id} ${hall.purpose} ${hall.w}x${hall.h} cells, wall distance ${d.toFixed(1)} m`);
      await shoot('hall-7m-aniso16', {pos: eye, target: tgt}, 16);
      await shoot('hall-7m-aniso1', {pos: eye, target: tgt}, 1);
    }
    // 3. the tunnel shell (developed UVs): in the tunnel 6 m from its mouth, looking along it
    const tun = L.extensions!.tunnels[0];
    if (tun) {
      const {TunnelFrame} = await import('../src/world/trackExt/frame');
      const tf = new TunnelFrame(tun), y0 = L.trenches[tun.trench].floorY;
      const at = (sx: number, lat: number, y: number): [number, number, number] => { const [x, z] = tf.point(sx, lat); return [x, y0 + y, z]; };
      await shoot('tunnel-aniso16', {pos: at(4, -0.8, 1.65), target: at(12, 1.6, 1.6)}, 16);
      await shoot('tunnel-aniso1', {pos: at(4, -0.8, 1.65), target: at(12, 1.6, 1.6)}, 1);
    }
    fs.writeFileSync(path.join(out, 'views.txt'), report.join('\n') + '\n');
    fs.writeFileSync(`/tmp/r1-views-${label}.txt`, report.join('\n') + '\n');
    await compose(root, sharp);
    expect(report.length).toBeGreaterThan(3);
  }, 3_600_000);
});

/** before | after composites (full frame, the centre crop at native pixels = the aimed wall, and the 2.4 m colour swatch). */
async function compose(root: string, sharp: (typeof import('sharp'))['default']): Promise<void> {
  const bdir = path.join(root, 'before'), adir = path.join(root, 'after');
  if (!fs.existsSync(bdir) || !fs.existsSync(adir)) return;
  const cdir = path.join(root, 'compare');
  fs.mkdirSync(cdir, {recursive: true});
  const pair = async (a: Buffer, b: Buffer, w: number, h: number, file: string) =>
    sharp({create: {width: w * 2 + 8, height: h, channels: 3, background: {r: 255, g: 255, b: 255}}})
      .composite([{input: a, left: 0, top: 0}, {input: b, left: w + 8, top: 0}]).png().toFile(path.join(cdir, file));
  for (const f of fs.readdirSync(adir).filter(n => n.endsWith('.png') && fs.existsSync(path.join(bdir, n)))) {
    const m = await sharp(path.join(bdir, f)).metadata(), W = m.width!, H = m.height!;
    if (f.startsWith('swatch')) {
      const sw = async (dir: string) => sharp(path.join(dir, f)).resize(512, 512).png().toBuffer();
      await pair(await sw(bdir), await sw(adir), 512, 512, f);
      continue;
    }
    await pair(await sharp(path.join(bdir, f)).png().toBuffer(), await sharp(path.join(adir, f)).png().toBuffer(), W, H, f);
    const cw = Math.round(W / 2), ch = Math.round(H / 2), crop = {left: Math.round((W - cw) / 2), top: Math.round((H - ch) / 2), width: cw, height: ch};
    await pair(await sharp(path.join(bdir, f)).extract(crop).png().toBuffer(), await sharp(path.join(adir, f)).extract(crop).png().toBuffer(), cw, ch, `crop-${f}`);
  }
}

describe.runIf(!!process.env.R1_COMPOSE)('R1 concrete: recompose before | after (R1_COMPOSE=1)', () => {
  it('writes qa-artifacts/r1-concrete/compare from existing before/ and after/', async () => {
    await compose(path.resolve(GAME, '..', 'qa-artifacts', 'r1-concrete'), (await import('sharp')).default);
    expect(true).toBe(true);
  });
});
