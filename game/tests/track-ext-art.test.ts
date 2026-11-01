// Track 2 playtest revision (task studio-alpha-track2-playtest-revision-20261031-01, lane ART): the STATION-SURFACE invitation art
// (gen/trackExt/art.ts, world/trackExt/graffiti.ts + graffitiArt.ts) and the extensions' WALL FINISH (world/trackExt/wallFinish.ts).
//   - art only at the bed end of a REAL annex entrance (tunnel mouth or service hatch), on rock walls a platform faces / platform
//     end walls; directional stencils point toward that entrance; no art (and no arrow) where there is no annex;
//   - data only in layout.extensions.art (the core view never carries it); presentation in the one graffiti mesh / atlas; the
//     painted rects are wall-detail keep-outs (no cables / stains / cuts across the paint);
//   - the annex / tunnel walls: the board-formed set at 427 texels / m, world-mapped with macro variation (annex), aged.
// Small and fast (CI budget): three cached Subway seeds of tests/track-ext.test.ts + the synthetic fixture.
import {beforeAll, describe, expect, it} from 'vitest';
import * as THREE from 'three';
import {installCanvasShim} from './helpers/canvas2d';
import {trackExtFixture} from './helpers/trackExtFixture';
import {levelFixture} from './helpers/levelFixture';
import {TEXTURE_FILES, type TextureKey} from '../src/assets/manifest';
import {Rng} from '../src/core/rng';
import {generateStation} from '../src/gen/station';
import type {StationLayout} from '../src/gen/stationTypes';
import {coreView, extensionIssues, planStationArt, stationArtKeepouts, stationArtRecordIssues, type TrackExtensions} from '../src/gen/trackExt/index';
import {WorldMaterials, isWorldMapped} from '../src/world/materials';
import {buildWorld} from '../src/world/builder';
import {ATLAS, CELL_OF, cellRect, graffitiAtlas, graffitiMaterial} from '../src/world/trackExt/graffiti';
import {ANNEX_WALL, BOARD_PX, BOARD_SPAN, BOARD_TEXELS_PER_M, annexWallMaterial, boardFormedSet, extensionWallMaterials, tunnelShellMaterial} from '../src/world/trackExt/wallFinish';
import {DECAY_HOOK} from '../src/world/decay';
import {hasNodeHook} from '../src/render/nodeHooks';
import {planWallDetail} from '../src/world/wallDetailPlan';
import type {NodeMaterial} from 'three/webgpu';

/**
 * tests/track-ext.test.ts corpora: a tunnel-door annex, a service hatch (island-ends), no annex at all. (2026-11-01, lane AREA: the
 * annexes exist only where the level's one area roll succeeds — 1043 / 2654448106 now roll it absent; 1068 = the first seed >= 1043
 * rolling PRESENT whose tunnel annex carries the full entrance art set (piece, stencil, platform end wall, mouth art), 1514198804 = track-ext.test's SUBWAY_HATCH.one; 2027820797 rolls absent.)
 */
const SEED = {tunnel: 1068, hatch: 1514198804, none: 2027820797} as const;
const cache = new Map<number, StationLayout>();
const gen = (s: number) => { let l = cache.get(s); if (!l) cache.set(s, (l = generateStation(s))); return l; };

installCanvasShim(false);
const fakeTex = () => { const o = {} as Record<TextureKey, THREE.Texture>; for (const k of Object.keys(TEXTURE_FILES) as TextureKey[]) o[k] = new THREE.Texture({width: 64, height: 64} as unknown as HTMLImageElement); return o; };

describe('station-surface invitation art (records)', () => {
  it('only at real annex entrances (tunnel mouth and service hatch both), pointing toward them; none without an annex', () => {
    for (const seed of [SEED.tunnel, SEED.hatch]) {
      const L = gen(seed), ext = L.extensions!;
      expect(extensionIssues(L), `seed ${seed}`).toEqual([]);
      const art = ext.art ?? [];
      // every entrance end (a tunnel that leads to an annex door, or a hatch) is announced: a piece and a directional stencil
      const ends = [...ext.tunnels.filter(t => t.doors.length).map(t => ({annex: t.doors[0].annex, entry: 'tunnel'})), ...ext.annexes.filter(a => a.bed).map(a => ({annex: a.id, entry: 'hatch'}))];
      expect(ends.length).toBeGreaterThan(0);
      for (const e of ends) {
        const mine = art.filter(a => a.annex === e.annex && a.entry === e.entry);
        expect(mine.some(a => a.kind === 'piece'), `seed ${seed} ${e.entry} ${e.annex}: piece`).toBe(true);
        expect(mine.some(a => a.kind === 'stencil' && a.toward !== 0), `seed ${seed} ${e.entry} ${e.annex}: stencil`).toBe(true);
        expect(mine.some(a => a.wall === 'end'), `seed ${seed} ${e.entry} ${e.annex}: a platform end wall stencil`).toBe(true);
      }
      for (const a of art) {
        expect(stationArtRecordIssues(L, ext, a), `seed ${seed} ${JSON.stringify(a)}`).toEqual([]);
        expect(ends.some(e => e.annex === a.annex && e.entry === a.entry)).toBe(true);
        // only the stencil points; the piece / watcher never do
        expect(a.toward !== 0).toBe(a.kind === 'stencil');
      }
      expect(ext.art!.length).toBeLessThanOrEqual(ends.length * 8); // a few breadcrumbs, no wall spam
    }
    // the tunnel variant on its stub walls and the hatch variant beside its hatch
    expect(gen(SEED.tunnel).extensions!.art!.some(a => a.entry === 'tunnel' && a.wall !== 'end' && a.s < 6)).toBe(true);
    expect(gen(SEED.hatch).extensions!.art!.some(a => a.entry === 'hatch' && a.kind === 'piece')).toBe(true);
    // a level without an annex: no art, no arrows
    const none = gen(SEED.none);
    expect(none.extensions!.annexes.length).toBe(0);
    expect(none.extensions!.art ?? []).toEqual([]);
  });

  it('no false cue: without the annex entrance nothing is planned; the core view never carries art; deterministic', () => {
    const L = gen(SEED.tunnel), ext = L.extensions!;
    const stripped: TrackExtensions = {...ext, tunnels: ext.tunnels.map(t => ({...t, doors: [], clues: []})), annexes: []};
    expect(planStationArt(L, stripped, new Rng(7))).toEqual([]);
    expect(coreView(L).extensions).toBeUndefined();
    expect(generateStation(SEED.tunnel).extensions!.art).toEqual(ext.art);
  });
});

describe('station-surface invitation art (presentation)', () => {
  let mats: WorldMaterials;
  beforeAll(() => { mats = new WorldMaterials(fakeTex(), 7, {w: 1.2, h: 0.19, d: 0.17}); });

  // (round 3, lane HIDEOUT) a fifth 256 px row holds the survivor's trail cells 12-15: 2048 x 1280 (~13.3 MiB with mips, was ~10.7)
  it('one atlas (<= 2048 x 1280, mipmapped), its cells inside it and disjoint; one material', () => {
    expect(ATLAS.w).toBeLessThanOrEqual(2048);
    expect(ATLAS.h).toBeLessThanOrEqual(1280);
    const t = graffitiAtlas();
    expect(t.generateMipmaps).toBe(true);
    expect([(t.image as {width: number}).width, (t.image as {height: number}).height]).toEqual([ATLAS.w, ATLAS.h]);
    const rects = Array.from({length: 16}, (_, i) => cellRect(i));
    for (const [x, y, w, h] of rects) { expect(x >= 0 && y >= 0 && x + w <= ATLAS.w && y + h <= ATLAS.h).toBe(true); }
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
      const [a, b] = [rects[i], rects[j]];
      expect(a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3], `cells ${i} / ${j}`).toBe(false);
    }
    expect(CELL_OF.service('right') % 2).toBe(0);
    expect(graffitiMaterial()).toBe(graffitiMaterial());
  });

  it('decals at every art record (in the graffiti mesh), on its wall, arrows toward the entrance; painted rects keep wall detail off', () => {
    const fx = trackExtFixture({hatch: true});
    fx.ext.art = planStationArt(fx.layout, fx.ext, new Rng(11));
    expect(fx.ext.art.length).toBeGreaterThan(2);
    expect(fx.ext.art.some(a => a.entry === 'tunnel') && fx.ext.art.some(a => a.entry === 'hatch')).toBe(true);
    const w = buildWorld(fx.layout, mats, {});
    const decals = w.trackExt!.artDecals;
    expect(decals.length).toBe(fx.ext.art.length);
    let meshes = 0;
    w.group.traverse(o => { if (o.name === 'track-ext-graffiti') meshes++; });
    expect(meshes).toBe(1);
    for (const d of decals) {
      const a = fx.ext.art[d.art];
      if (a.kind !== 'stencil') { expect(d.cell).toBe(a.kind === 'piece' ? CELL_OF.piece : CELL_OF.watcher); continue; }
      // a viewer facing the wall: right = (n.z, -n.x); the arrow points the way the record's entrance lies
      const n = a.wall === 'end' ? [a.end!.nx, 0] : [0, a.wall === 'N' ? 1 : -1];
      const right = [n[1], -n[0]];
      const way = a.wall === 'end' ? [0, a.toward] : [(a.from === 'x1' ? -1 : 1) * a.toward, 0];
      expect(d.dir).toBe(right[0] * way[0] + right[1] * way[1] > 0 ? 'right' : 'left');
      expect(d.cell).toBe(CELL_OF.service(d.dir));
    }
    // keep-outs: every painted rect is free of every wall-detail feature on its face
    const keeps = stationArtKeepouts(fx.layout);
    expect(keeps.filter(k => k.why === 'station-art').length).toBe(fx.ext.art.length);
    const plan = planWallDetail(fx.layout, {faces: w.wallFaces});
    let painted = 0;
    plan.faces.forEach((pf, i) => {
      const ko = pf.keepouts.filter(k => k.why === 'graffiti');
      painted += ko.length;
      for (const f of plan.features.filter(q => q.face === i)) for (const k of ko) expect(f.s0 < k.s1 && f.s1 > k.s0 && f.y0 < k.y1 && f.y1 > k.y0, `${f.kind} across the paint`).toBe(false);
    });
    expect(painted).toBeGreaterThanOrEqual(keeps.length);
  });
});

describe('extension wall finish (board-formed, real scale)', () => {
  it('annex walls: the board-formed set at >= 400 texels / m, world-mapped with macro variation, aged; tunnels: the same lining', () => {
    expect(BOARD_TEXELS_PER_M).toBeGreaterThanOrEqual(400); // was 128 (platformFace backing 256 px / 2 m)
    const s = boardFormedSet();
    expect([(s.map.image as {width: number}).width, (s.map.image as {height: number}).height]).toEqual([BOARD_PX.color, BOARD_PX.color]);
    for (const t of [s.roughnessMap!, s.normalMap!]) expect((t.image as {width: number}).width).toBe(BOARD_PX.detail);
    for (const t of [s.map, s.roughnessMap!, s.normalMap!]) { expect(t.generateMipmaps).toBe(true); expect(t.wrapS).toBe(THREE.RepeatWrapping); }
    const mats = new WorldMaterials(fakeTex(), 7, {w: 1.2, h: 0.19, d: 0.17});
    // lazily created: a layout without extensions never builds them
    buildWorld(levelFixture(), mats, {});
    expect(extensionWallMaterials(mats).length).toBe(0);
    const fx = trackExtFixture();
    const w = buildWorld(fx.layout, mats, {});
    const annex = annexWallMaterial(mats), shell = tunnelShellMaterial(mats);
    expect(extensionWallMaterials(mats).length === 2 && extensionWallMaterials(mats)[0] === annex && extensionWallMaterials(mats)[1] === shell).toBe(true);
    expect(isWorldMapped(annex)).toBe(true);
    expect((annex.userData.worldMapping as {span: number[]; macro: number}).span).toEqual([BOARD_SPAN, BOARD_SPAN]);
    expect((annex.userData.worldMapping as {macro: number}).macro).toBeGreaterThan(0.2);
    for (const m of [annex, shell]) expect(hasNodeHook(m as NodeMaterial, DECAY_HOOK)).toBe(true);
    const annexAreas = new Set(fx.ext.annexes.flatMap(a => a.areas));
    expect(w.wallFaces.filter(f => annexAreas.has(f.area)).every(f => f.finish === ANNEX_WALL)).toBe(true);
    let annexMeshes = 0, shellMeshes = 0;
    w.group.traverse(o => { const m = o as THREE.Mesh; if (!m.isMesh) return; if (m.material === annex) annexMeshes++; if (m.material === shell) shellMeshes++; });
    expect(annexMeshes).toBeGreaterThan(0);
    expect(shellMeshes).toBeGreaterThan(0);
    // the formwork overlay is not drawn over a finish that carries its own panels
    const plan = planWallDetail(fx.layout as StationLayout, {faces: w.wallFaces});
    expect(plan.features.filter(f => f.kind === 'formwork' && annexAreas.has(plan.faces[f.face].face.area)).length).toBe(0);
  });
});
