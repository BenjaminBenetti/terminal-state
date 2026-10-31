// Track 2 playtest revision (task studio-alpha-track2-playtest-revision-20261031-01, lane ART): the WALL FINISH of the track
// extensions. User: "The wall textures look low res".
//
// Diagnosis (docs/track-extensions.md "Wall finish"): the annex walls used the 'platformFace' material — the 256 x 256
// platform-authored-backing set (a 5.7 KB colour JPEG) stretched over 2 x 2 m = 128 texels / m, i.e. ~3x magnified at 2 m and ~6x
// at 1 m in a 1.5-2 m service corridor (1080p, 75 deg: ~380 screen px / m at 2 m), plus a 110 px / m formwork overlay. The tunnel
// shell walls used the bed lining 'tunnel' (1024 x 384 over 3.6 x 1.38 m = 284 texels / m) whose stamped repair patches repeat every
// 3.6 m along and FOUR times up a 5.5 m tunnel wall.
//
// Fix: ONE local procedural board-formed concrete set (canvas, generated once per page, deterministic; no image asset, no provider):
// colour 1024 x 1024 over 2.4 x 2.4 m = 427 texels / m (3.3x the annex density, 1.5x the tunnel's), roughness + normal 512 x 512 from
// the same height field (board seams, tie-cone holes, bug holes, grain imprint, panel joints). Two materials share it:
//   - annexWall: world-mapped (real-scale projection, the shared world-mapping program) with its MACRO tone variation (world-space
//     noise, ~1.4 m features: no two bays read the same) and floor grime, + the decay hook (platformFace profile);
//   - tunnelShell: the shell's developed wall UVs (u along the wall from the mouth, v from the bed floor) at the same 2.4 m span,
//     + the decay hook (tunnel profile; its world-space stain field breaks the repeat). The bed walls keep the station lining: a
//     concrete portal rib at the mouth (world/trackExt/shell.ts) marks where the station box ends and the cast tunnel starts.
// Both are created lazily per WorldMaterials (only a level with extensions pays for them: ~8 MiB GPU with mips) and kept for the
// session like every other shared material; they are in the station scene at build, so the warm-up prepares them (no first-use
// compile; docs/rendering-warmup.md).

import * as THREE from 'three';
import {Painter, type SurfaceSet} from '../canvasTextures';
import {SurfaceNodeMaterial, worldMapped, type WorldMaterials} from '../materials';
import {DECAY_PROFILES, applyDecay} from '../decay';

/** Finish key of the annex walls (levelGeometry WallKind 'annex' -> finishFor). */
export const ANNEX_WALL = 'annexWall';
/** Real span (m) of one repeat of the board-formed set, both ways. */
export const BOARD_SPAN = 2.4;
/** Pixel sizes: colour, and roughness / height (normal) layers. */
export const BOARD_PX = {color: 1024, detail: 512} as const;

/** Board-formed cast concrete, BOARD_SPAN x BOARD_SPAN m, tiling: two 1.2 m formwork panels, 0.15 m boards, tie cones on a 0.6 m grid. */
function boardFormed(seed: number): SurfaceSet {
  const N = BOARD_PX.color, ppm = N / BOARD_SPAN;
  const p = new Painter(N, N, seed, {rough: BOARD_PX.detail / N, height: BOARD_PX.detail / N});
  p.base({c: '#97938a', r: 0.86, h: 0.5});
  const board = 0.15 * ppm, panelW = 1.2 * ppm;
  // boards: per panel, per board a slightly different tone / roughness / relief (the timber each was cast against)
  for (let px = 0; px < 2; px++) for (let b = 0; b < N / board; b++) {
    const tone = p.rr(-1, 1), x0 = px * panelW, y0 = b * board;
    const c = tone > 0 ? `rgba(172,168,158,${0.04 + tone * 0.08})` : `rgba(78,76,70,${0.04 - tone * 0.07})`;
    p.shape(ctx => ctx.rect(x0, y0, panelW, board), {c, r: 0.82 + p.rr(0, 0.1), h: 0.5 + p.rr(-0.04, 0.04)}, [x0 + panelW / 2, y0 + board / 2, panelW]);
    // wood-grain imprint: long faint streaks along the board
    for (let k = 0; k < 7; k++) {
      const y = y0 + p.rr(4, board - 4), xa = x0 + p.rr(0, panelW * 0.6), len = p.rr(panelW * 0.25, panelW * 0.7);
      p.shape(ctx => { ctx.moveTo(xa, y); ctx.lineTo(Math.min(x0 + panelW - 2, xa + len), y + p.rr(-1.5, 1.5)); }, {c: p.rr(0, 1) < 0.5 ? 'rgba(60,58,54,0.12)' : 'rgba(190,186,176,0.1)', h: 0.47}, [xa + len / 2, y, len], p.rr(1, 2.2));
    }
    // a knot now and then
    if (p.rnd() < 0.12) { const kx = x0 + p.rr(20, panelW - 20), ky = y0 + board / 2; p.shape(ctx => ctx.ellipse(kx, ky, p.rr(5, 9), p.rr(3, 6), 0, 0, Math.PI * 2), {c: 'rgba(80,76,70,0.35)', h: 0.45}, [kx, ky, 12]); }
  }
  // board seams: thin recessed lines with a little grout bleed; panel joints stronger, with a lip
  for (let y = 0; y < N; y += board) {
    p.shape(ctx => ctx.rect(0, y - 1.2, N, 2.4), {c: 'rgba(58,56,51,0.4)', r: 0.95, h: 0.38}, [N / 2, y, N]);
    p.shape(ctx => ctx.rect(0, y + 1.6, N, 1.6), {c: 'rgba(190,186,176,0.2)', h: 0.53}, [N / 2, y + 2, N]);
  }
  for (const x of [0, panelW]) {
    p.shape(ctx => ctx.rect(x - 2.5, 0, 5, N), {c: 'rgba(44,42,38,0.75)', r: 1, h: 0.28}, [x, N / 2, N]);
    p.shape(ctx => ctx.rect(x + 3, 0, 3, N), {c: 'rgba(196,192,182,0.35)', h: 0.58}, [x + 4, N / 2, N]);
  }
  p.shape(ctx => ctx.rect(0, -2.5, N, 5), {c: 'rgba(44,42,38,0.7)', r: 1, h: 0.3}, [N / 2, 0, N]);
  // tie cones on a 0.6 m grid: open (dark, deep) or plugged with grout (lighter, flush ring)
  for (let gy = 0.3 * ppm; gy < N; gy += 0.6 * ppm) for (let gx = 0.3 * ppm; gx < N; gx += 0.6 * ppm) {
    const x = gx + p.rr(-3, 3), y = gy + p.rr(-3, 3), r = 0.022 * ppm;
    p.shape(ctx => ctx.ellipse(x, y, r * 1.5, r * 1.5, 0, 0, Math.PI * 2), {c: 'rgba(70,67,62,0.35)', h: 0.44}, [x, y, r * 2]);
    if (p.rnd() < 0.55) p.shape(ctx => ctx.ellipse(x, y, r, r, 0, 0, Math.PI * 2), {c: '#1c1b19', r: 1, h: 0.08}, [x, y, r * 1.2]);
    else p.shape(ctx => ctx.ellipse(x, y, r * 1.05, r * 1.05, 0, 0, Math.PI * 2), {c: 'rgba(150,145,135,0.85)', r: 0.75, h: 0.5}, [x, y, r * 1.2]);
  }
  // bug holes (surface air voids), denser toward the panel bottoms; fine aggregate speckle
  for (let i = 0; i < 700; i++) {
    const x = p.rr(0, N), y = Math.pow(p.rnd(), 0.7) * N, r = p.rr(0.5, 1.9);
    p.shape(ctx => ctx.ellipse(x, y, r, r * p.rr(0.6, 1), p.rr(0, 3), 0, Math.PI * 2), {c: 'rgba(36,34,31,0.75)', r: 1, h: 0.25}, [x, y, r + 1]);
  }
  for (let i = 0; i < 2600; i++) {
    const x = p.rr(0, N), y = p.rr(0, N), r = p.rr(0.5, 1.4);
    p.shape(ctx => ctx.rect(x, y, r, r), {c: p.rnd() < 0.5 ? 'rgba(200,196,186,0.4)' : 'rgba(80,77,71,0.4)'}, [x, y, r + 1]);
  }
  // low-contrast mottling (cement paste variation) — the irregular stains / leaks come from the decay field (world space)
  for (let i = 0; i < 26; i++) p.soft(p.rr(0, N), p.rr(0, N), p.rr(60, 200), {c: p.rnd() < 0.5 ? '#a6a297' : '#7f7b73', a: p.rr(0.08, 0.2), r: p.rr(0.8, 0.95)});
  p.grain(9);
  return p.finish([BOARD_SPAN, BOARD_SPAN], 2.2);
}

let boardSet: SurfaceSet | null = null;
/** The shared board-formed set (painted on first use, kept for the page). */
export function boardFormedSet(): SurfaceSet {
  return (boardSet ??= boardFormed(20261031));
}
/** Tests / previews that swap the canvas implementation. */
export function resetBoardFormedSet(): void { boardSet = null; }

const annexMats = new WeakMap<WorldMaterials, THREE.Material>();
const shellMats = new WeakMap<WorldMaterials, THREE.Material>();

/** The annex wall material (world-mapped board-formed concrete with macro variation, aged), shared per WorldMaterials. */
export function annexWallMaterial(mats: WorldMaterials): THREE.Material {
  let m = annexMats.get(mats);
  if (!m) {
    const s = boardFormedSet();
    const mm = new SurfaceNodeMaterial({map: s.map, roughnessMap: s.roughnessMap, normalMap: s.normalMap, roughness: 1, metalness: 0, color: 0xc4c0b6});
    mm.normalScale.set(0.85, 0.85);
    worldMapped(mm, {span: [BOARD_SPAN, BOARD_SPAN], grime: [0.32, 0.5], macro: 0.32});
    mm.name = 'annex-wall';
    applyDecay(mm, DECAY_PROFILES.platformFace);
    annexMats.set(mats, (m = mm));
  }
  return m;
}

/** The tunnel shell wall material (board-formed concrete on the shell's developed UVs, aged), shared per WorldMaterials. */
export function tunnelShellMaterial(mats: WorldMaterials): THREE.Material {
  let m = shellMats.get(mats);
  if (!m) {
    const s = boardFormedSet();
    const mm = new SurfaceNodeMaterial({map: s.map, roughnessMap: s.roughnessMap, normalMap: s.normalMap, roughness: 1, metalness: 0, color: 0xb2aea4});
    mm.normalScale.set(0.85, 0.85);
    mm.name = 'track-ext-shell-wall';
    applyDecay(mm, DECAY_PROFILES.tunnel);
    shellMats.set(mats, (m = mm));
  }
  return m;
}

/** The extension wall materials built so far for `mats` (wall detail: they are cuttable base walls like the station's). */
export function extensionWallMaterials(mats: WorldMaterials): THREE.Material[] {
  return [annexMats.get(mats), shellMats.get(mats)].filter((m): m is THREE.Material => !!m);
}

/** Texels per metre of the board-formed colour map (report / tests). */
export const BOARD_TEXELS_PER_M = BOARD_PX.color / BOARD_SPAN;
