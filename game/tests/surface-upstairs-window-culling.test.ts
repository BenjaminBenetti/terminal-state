// Task studio-surface-upper-storey-culling-20261119-025201-01 (user screenshot, WebGPU, HUD "Moreau Pharmacy · Manager's office ·
// Marlwick Tower": from an upstairs window the street stayed drawn but the facades and walls of the buildings round it disappeared,
// leaving skeletal floors, columns and isolated window blocks). The cause, measured here on the user's own district (network seed 2 ->
// st-02 Marlwick Tower, Office host, level seed 61488949, district version 2) against the depth-buffered oracle
// (tests/helpers/visibleMeshes.ts): the district's whole exterior is drawn on its STREET storey (world/surface/arch.ts tags levels[0]),
// the enterable buildings' upstairs is the upper storey, and the level culler joined the two only through stair runs (portal tiles):
// from an upstairs room every street-storey mesh further than PORTAL_MARGIN from a stair tile in sight was culled — the facades across the
// street, the street lamps, even the road when no stair was in view — while the big merged pieces near a stair stayed (the "skeleton").
// The fix (world/levelCulling.ts, world/surface/lookOcclusion.ts surfaceWindowSpans, world/builder.ts): AIR's live window spans are the
// district culler's WINDOW TILES (the Skyways' glass rule) and name their outer storey, the street: a span seen from its own storey makes
// the street storey air-visible, a span seen from the street its own storey; slab + storey occlusion still decide each mesh. Pinned:
//  - the spans (storey, sill .. head, the street storey outside), and the pre-fix culler options hiding visible facades in the user's room;
//  - the user's room at its north and east windows: nothing the oracle sees is culled, the street storey is air-visible;
//  - a walk window -> turned away -> stairs -> ground floor -> street -> looking up at the windows: every step's decision equals a fresh
//    one (no visibility state sticks or leaks from the previous pose), nothing visible is culled, and turned away from the glass the
//    street's facades are culled again (legitimate culling still works);
//  - other districts (another host's version 2, a version-1 district: rendering only, nothing rerolled): every sampled upstairs window
//    view sees nothing culled.
// Render-layer decisions only (CULL_LAYER): layout, seed, collision, navigation, light, gas and saved data are untouched. Node geometry
// evidence, never hardware / final-lighting proof.
import * as THREE from 'three';
import {describe, expect, it} from 'vitest';
import {installCanvasShim} from './helpers/canvas2d';
import {fakeEnvTextures} from './helpers/openablesFixture';
import {plainLayout} from './helpers/surfaceLookFixture';
import {deepDistrict} from './helpers/surfaceDeepDistricts';
import {visibleMeshes} from './helpers/visibleMeshes';
import {generateSurfaceDistrict} from '../src/gen/surface/index';
import type {StationLayout} from '../src/gen/stationTypes';
import type {SurfaceWindowSpan} from '../src/gen/surface/surfaceTypes';
import {WorldMaterials} from '../src/world/materials';
import {buildWorld} from '../src/world/builder';
import {LevelCuller, fogCullDistance} from '../src/world/levelCulling';
import {LevelColumns, stationLevels} from '../src/world/levelGeometry';
import {LOOK_SKY} from '../src/world/surface/lookSky';
import {SIDE_NORMAL} from '../src/world/surface/archPlan';
import {surfaceOcclusionSee, surfaceWindowSpans} from '../src/world/surface/lookOcclusion';
import {surfaceSkyVolumes} from '../src/world/surface/roofAccessView';

installCanvasShim(false);

/** The user's station: Marlwick Tower (network seed 2, st-02), an Office host, its district at version 2. */
const marlwick = (): StationLayout => generateSurfaceDistrict('office', {levelSeed: 61488949, surfaceVersion: 2});
/** The district's fog cull distance (world/surface/look.ts apply). */
const FAR = Math.min(fogCullDistance(LOOK_SKY.fogDensity), LOOK_SKY.far);

interface Built { L: StationLayout; group: THREE.Group; culler: LevelCuller; levelAt: ReturnType<typeof buildWorld>['levelAt'] }
const worlds = new Map<string, Built>();
function built(key: string, make: () => StationLayout): Built {
  let w = worlds.get(key);
  if (!w) {
    const L = make(), world = buildWorld(L, new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17}), {});
    world.culler.maxDistance = FAR;
    w = {L, group: world.group, culler: world.culler, levelAt: world.levelAt};
    worlds.set(key, w);
  }
  return w;
}

const cam = new THREE.PerspectiveCamera(70, 16 / 9, 0.05, LOOK_SKY.far);
function pose(x: number, y: number, z: number, yaw: number, pitch: number): THREE.PerspectiveCamera {
  cam.position.set(x, y, z);
  cam.rotation.set(pitch, yaw, 0, 'YXZ');
  cam.updateMatrixWorld(true);
  return cam;
}
/** Yaw (three: 0 looks -z) from (x, z) towards (tx, tz). */
const yawTo = (x: number, z: number, tx: number, tz: number) => Math.atan2(-(tx - x), -(tz - z));
const culled = (m: THREE.Object3D) => !m.layers.isEnabled(0);

/** An eye 1.2 m inside a span, at standing height over its storey's floor, and the yaw looking straight out through it. */
function atWindow(L: StationLayout, w: SurfaceWindowSpan): {x: number; y: number; z: number; out: number} {
  const {alongX, n} = SIDE_NORMAL[w.side], mx = (w.x0 + w.x1) / 2, mz = (w.z0 + w.z1) / 2;
  const x = alongX ? mx : mx - n * 1.2, z = alongX ? mz - n * 1.2 : mz;
  return {x, y: L.levels![w.level].grid.floorAt(x, z) + 1.65, z, out: yawTo(x, z, alongX ? x : x + n, alongX ? z + n : z)};
}

/** Meshes the oracle sees (>= 1 px at 192 x 108, inside the fog) that `c` culls for the current camera; `c` is reset afterwards. */
function hiddenVisible(b: Built, c: LevelCuller): string[] {
  const vis = visibleMeshes(b.group, cam, 192, 108, {maxDist: FAR, minPx: 1});
  c.update(cam, true);
  const out = [...vis].filter(([m]) => culled(m)).map(([m, px]) => `${m.name} ${px}px`);
  c.reset();
  return out;
}

describe('Surface Run upstairs windows: the street storey seen through the glass', () => {
  it("surfaceWindowSpans: AIR's live spans — their storey, sill .. head over its floor, the street storey outside; the builder passes them", () => {
    expect(surfaceWindowSpans(plainLayout())).toEqual([]);
    const b = built('marlwick', marlwick), L = b.L, S = L.surface!, lv = L.levels!;
    const spans = surfaceWindowSpans(L);
    expect(spans.length).toBe(S.windows.length);
    S.windows.forEach((w, k) => expect(spans[k], w.id).toEqual({x0: w.x0, z0: w.z0, x1: w.x1, z1: w.z1, y0: lv[w.level].baseY + w.sill, y1: lv[w.level].baseY + w.head, level: lv[w.level].id, out: lv[0].id}));
    expect(spans.filter(s => s.level !== s.out).length, 'upstairs spans').toBeGreaterThan(20);
    // the district culler's window tiles: every span (an outer storey equal to its own adds nothing)
    expect((b.culler as unknown as {winTiles: {out?: number}[]}).winTiles.length).toBe(spans.length);
    expect((b.culler as unknown as {winTiles: {level: number; out?: number}[]}).winTiles.every(t => t.level === lv[0].id ? t.out === undefined : t.out === lv[0].id)).toBe(true);
  }, 120_000);

  it("the user's room (Moreau Pharmacy · Manager's office): out of its north / east windows nothing the oracle sees is culled; the portal rule alone hid the facades", () => {
    const b = built('marlwick', marlwick), L = b.L, S = L.surface!;
    const ph = S.buildings.find(q => q.name === 'Moreau Pharmacy')!;
    const room = ph.areas.find(a => L.areas[a].label === "Moreau Pharmacy · Manager's office")!;
    expect(room, "the Manager's office").toBeDefined();
    const wins = S.windows.filter(w => w.room === room);
    expect(wins.map(w => w.side).sort()).toEqual(['E', 'E', 'N', 'N', 'N']);
    // the culler options before the fix (no window tiles), over the same world
    const levels = stationLevels(L), sky = surfaceSkyVolumes(L);
    const before = new LevelCuller(levels, new LevelColumns(levels), b.levelAt, {slabs: {see: surfaceOcclusionSee(L), ...(sky.length ? {sky} : {})}});
    before.register(b.group);
    before.maxDistance = FAR;
    let poses = 0, facadesSeen = 0, beforeFacades = 0;
    const bad: string[] = [];
    try {
      for (const w of wins) for (const dy of [0, 0.5, -0.5]) for (const pitch of [-0.1, -0.3]) {
        const p = atWindow(L, w);
        pose(p.x, p.y, p.z, p.out + dy, pitch);
        const vis = visibleMeshes(b.group, cam, 192, 108, {maxDist: FAR, minPx: 1});
        const facades = [...vis.keys()].filter(m => m.name.startsWith('surface-arch-surface-facade-'));
        facadesSeen += facades.length;
        before.update(cam, true);
        beforeFacades += facades.filter(culled).length;
        before.reset();
        b.culler.update(cam, true);
        expect(b.culler.airStats.levels, `${w.id} yaw ${dy}`).toContain(L.levels![0].id);
        bad.push(...[...vis].filter(([m]) => culled(m)).map(([m, px]) => `${w.id} ${dy}/${pitch}: ${m.name} ${px}px`));
        b.culler.reset();
        poses++;
      }
    } finally {
      before.reset();
      before.release([b.group]);
    }
    expect(bad).toEqual([]);
    expect(poses).toBe(30);
    expect(facadesSeen, 'the views do look out at the facades').toBeGreaterThan(60);
    expect(beforeFacades, 'before: visible facades culled (the report)').toBeGreaterThan(30);
  }, 300_000);

  it('a walk: window -> turned away -> stairs -> ground floor -> street -> looking up — every decision as a fresh one, nothing visible culled', () => {
    const b = built('marlwick', marlwick), L = b.L, S = L.surface!, c = b.culler, g0 = L.levels![0].grid, g1 = L.levels![1].grid;
    const ph = S.buildings.find(q => q.name === 'Moreau Pharmacy')!, fp = ph.footprint;
    const east = S.windows.find(w => w.building === ph.id && w.level === 1 && w.side === 'E')!, ew = atWindow(L, east);
    // the pharmacy's stair run (upper grid ramp cells), low / mid / high
    const ramp: {x: number; z: number; f: number}[] = [];
    for (let i = 0; i < g1.cells.length; i++) {
      if (g1.rampIdx[i] < 0) continue;
      const x = (i % g1.w + 0.5) * 0.5, z = (Math.floor(i / g1.w) + 0.5) * 0.5;
      if (x > fp.x0 && x < fp.x1 && z > fp.z0 && z < fp.z1) ramp.push({x, z, f: g1.floorAt(x, z)});
    }
    ramp.sort((p, q) => p.f - q.f);
    expect(ramp.length).toBeGreaterThan(8);
    const door = ph.entrances[0], st = {x: door.x + 6, z: door.z};
    const steps: {name: string; x: number; y: number; z: number; yaw: number; pitch: number}[] = [
      {name: 'east window, looking out', ...ew, yaw: ew.out, pitch: -0.12},
      {name: 'same spot, turned to the inner wall', ...ew, yaw: ew.out + Math.PI, pitch: -0.05},
      {name: 'room middle, facing south (the inner wall)', x: 193, y: g1.floorAt(193, 294.5) + 1.65, z: 294.5, yaw: Math.PI, pitch: 0},
      ...[ramp[ramp.length - 2], ramp[ramp.length >> 1], ramp[1]].map((r, k) => ({name: `stairs ${['top', 'mid', 'bottom'][k]}`, x: r.x, y: r.f + 1.65, z: r.z, yaw: yawTo(r.x, r.z, ramp[0].x, ramp[0].z), pitch: -0.1})),
      {name: 'ground floor sales room, facing the door', x: door.x - 4, y: g0.floorAt(door.x - 4, door.z) + 1.65, z: door.z, yaw: yawTo(door.x - 4, door.z, door.x, door.z), pitch: 0},
      {name: 'the street, looking up at the east windows', x: st.x, y: g0.floorAt(st.x, st.z) + 1.65, z: st.z, yaw: yawTo(st.x, st.z, fp.x1, st.z), pitch: 0.35},
      {name: 'the street, facing away', x: st.x, y: g0.floorAt(st.x, st.z) + 1.65, z: st.z, yaw: yawTo(st.x, st.z, st.x + 10, st.z), pitch: 0.05},
      {name: 'back up: east window, looking out', ...ew, yaw: ew.out, pitch: -0.12},
    ];
    const seq: Record<string, {air: number[]; culled: number; facadesDrawn: Set<THREE.Object3D>}> = {};
    c.reset();
    for (const s of steps) {
      pose(s.x, s.y, s.z, s.yaw, s.pitch);
      c.update(cam); // (the game's own call: a full update — every step moves / turns past the skip)
      const mine = new Set<THREE.Object3D>(), facades = new Set<THREE.Object3D>();
      b.group.traverse(o => { if ((o as THREE.Mesh).isMesh && culled(o)) mine.add(o); if ((o as THREE.Mesh).isMesh && !culled(o) && o.name.startsWith('surface-arch-surface-facade-') && (o.userData.level ?? 0) === L.levels![0].id) facades.add(o); });
      seq[s.name] = {air: [...c.airStats.levels], culled: mine.size, facadesDrawn: facades};
      // the same pose decided fresh (no position caches, forced): identical layers
      const vis = visibleMeshes(b.group, cam, 192, 108, {maxDist: FAR, minPx: 1});
      expect([...vis].filter(([m]) => culled(m)).map(([m, px]) => `${m.name} ${px}px`), s.name).toEqual([]);
      c.forgetPositionCaches();
      c.update(cam, true);
      const fresh = new Set<THREE.Object3D>();
      b.group.traverse(o => { if ((o as THREE.Mesh).isMesh && culled(o)) fresh.add(o); });
      expect([...fresh].filter(o => !mine.has(o)).length + [...mine].filter(o => !fresh.has(o)).length, `${s.name}: sequential vs fresh`).toBe(0);
    }
    c.reset();
    const w0 = seq['east window, looking out'], mid = seq['room middle, facing south (the inner wall)'];
    expect(w0.air).toEqual([L.levels![0].id]);
    expect(mid.air, 'no glass in view: no storey seen through it').toEqual([]);
    // legitimate culling still works: turned from the glass, the street storey's facades in front are culled again
    expect(mid.culled).toBeGreaterThan(w0.culled + 300);
    expect(seq['the street, looking up at the east windows'].air, 'the upstairs seen through its glass from the street').toEqual([L.levels![1].id]);
    expect(seq['back up: east window, looking out'].air).toEqual(w0.air);
    expect(seq['back up: east window, looking out'].culled).toBe(w0.culled);
    expect(w0.facadesDrawn.size).toBeGreaterThan(20);
  }, 300_000);

  for (const [key, make] of [
    ['mall seed 13 v2', () => deepDistrict('mall', 13).L],
    ['subway seed 3 v1', () => deepDistrict('subway', 3, 1).L],
  ] as const) it(`${key}: every sampled upstairs window view sees nothing culled`, () => {
    const b = built(key, make), L = b.L;
    const ups = L.surface!.windows.filter(w => w.level > 0);
    expect(ups.length).toBeGreaterThan(10);
    const pick = ups.filter((_, k) => k % Math.ceil(ups.length / 12) === 0);
    const bad: string[] = [];
    let seen = 0;
    for (const w of pick) for (const dy of [0.35, -0.35]) {
      const p = atWindow(L, w);
      pose(p.x, p.y, p.z, p.out + dy, -0.15);
      bad.push(...hiddenVisible(b, b.culler).map(s => `${w.id} ${dy}: ${s}`));
      if (b.culler.airStats.levels.includes(L.levels![0].id)) seen++;
    }
    expect(bad).toEqual([]);
    expect(seen, 'the street storey seen through the glass').toBeGreaterThan(pick.length);
  }, 300_000);
});
