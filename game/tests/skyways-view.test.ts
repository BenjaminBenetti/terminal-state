// Task studio-skyways-level-20261106-054448 (lane VIEW): THE SKYWAYS LOOK — world/skywaysArch.ts (the finish mapper + glazed atrium
// roofs) and world/skywaysExterior.ts (what the glass shows), on REAL Skyways layouts (the lead's generator, two seeds):
//  - arch: public / court / bridge / wet / back-of-house areas resolve to the skyways finishes (walls, floors, ceilings, door soffits /
//    trim), the station storey's platforms / track and every storefront unit keep the builder's own rule; no ceiling is drawn inside
//    an atrium opening; the wall-detail pass never gives a skyways wall a station treatment; one program per surface kind; the GAS
//    lane's reveals take a plain-paint copy of the public wall; bullet impacts take the drawn finish;
//  - atrium roofs: one glazed vault per atrium (transparent glass: never an opaque shadow caster) + steel, tagged with the storeys;
//  - exterior plan: deterministic per seed; one shell per building on its outer faces, never coplanar with a built wall face facing
//    the same way (bridge mouths cut out); one exterior per bridge (underside, roof, side fascias minus its window spans, steel, glazing
//    sheets except on pre-breached bridges); the inner ground = the complex minus every footprint; wrecks only on the streets' road;
//  - exterior build: draws / triangles bounded, wreck models instanced (procedural stand-ins otherwise), never a shadow caster;
//  - runtime: section / frame / preload / warm-up pool hooks, the raised far plane, the fog box per eye position, hidden in the station
//    and shown with a window in view, teardown disposes and restores; inert (and releasing the wrecks) on any other level.
import * as THREE from 'three';
import {beforeAll, describe, expect, it} from 'vitest';
import fs from 'node:fs';
import {installCanvasShim} from './helpers/canvas2d';
import {fakeEnvTextures, loadStripped} from './helpers/openablesFixture';
import {buildBoth} from './helpers/tslShaders';
import {CELL, FLOOR} from '../src/gen/grid';
import type {StationLayout} from '../src/gen/stationTypes';
import {LEVELS} from '../src/levels/registry';
import {WorldMaterials} from '../src/world/materials';
import {buildWorld, type BuiltWorld} from '../src/world/builder';
import {finishFamily, treatmentOf} from '../src/world/wallDetailPlan';
import {LevelColumns, ceilingRuns, stationLevels} from '../src/world/levelGeometry';
import {LOWER, OfficeSurfaceMaterial} from '../src/world/officeArch';
import {SkywaysArch, skywaysAreaClass, type SkywaysClass} from '../src/world/skywaysArch';
import {
  SKYWAYS_EXT, WRECK_KEYS, bridgeOuter, buildSkywaysExterior, groundRects, installSkywaysExterior, planSkywaysExterior, subtractRects,
  type SkywaysExteriorHost, type SkywaysExteriorPlan, type WreckKey,
} from '../src/world/skywaysExterior';
import {planSkywaysWindows} from '../src/world/skywaysWindows';
import {EXT_U, EXTERIOR} from '../src/world/exterior';
import {WarmupRegistry} from '../src/render/warmup';
import {finishClass, FINISH_CLASS_KEYS} from '../src/damage/impactFinish';
import {isArchFinish} from '../src/world/finishAt';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {SKYWAYS_PROP_MODELS} from '../src/assets/skywaysProps.generated';
import {OFFICE_ASSETS} from '../src/assets/officeAssets';
// (task studio-skywalk-variety-20261107-231448-01, lane DRESS) the small shops' palettes (the Mall's finish-row programs)
import {SKYWAYS_SHOP_FLOOR_KEY, SKYWAYS_SHOP_WALL_KEY, skywaysShopFloorKey, skywaysShopWallKey} from '../src/world/skywaysShopFinish';
import {skywaysMallFloorKey, skywaysMallWallKey} from '../src/world/skywaysMallFinish'; // (task studio-skywalk-encounters-20261108-074144-01, lane STORES)
import {mallSurfaceMaterial} from '../src/world/mallSurfaces';

installCanvasShim(false);
const SEEDS = [1, 2] as const;
const LOG = '/tmp/view-skyways-view.log';
let mats: WorldMaterials;
const cache = new Map<number, {L: StationLayout; w: BuiltWorld}>();
beforeAll(() => { mats = new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17}); fs.writeFileSync(LOG, ''); });
const world = (seed: number) => {
  let e = cache.get(seed);
  if (!e) {
    const L = LEVELS.skyways!.generate('main', {levelSeed: seed, startWeapon: 'pistol'} as never);
    cache.set(seed, (e = {L, w: buildWorld(L, mats, {})}));
  }
  return e;
};
const log = (s: string) => fs.appendFileSync(LOG, s + '\n');
const STATION_TREATMENTS = ['platformTile', 'trackTunnel', 'trackFace', 'concourseTile', 'shopTile', 'servicePaint', 'stairCore', 'upperFinish', 'lowerConcrete'];
const tris = (m: THREE.Mesh) => (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3;

/** One open, flat, non-ramp cell of an area on its own storey grid (index), or -1. */
function cellOf(L: StationLayout, areaId: number): {L: number; i: number} {
  const a = L.areas[areaId], lv = a.level ?? 0, g = L.levels![lv].grid;
  for (let y = a.y; y < a.y + a.h; y++) for (let x = a.x; x < a.x + a.w; x++) {
    const i = g.idx(x, y);
    if (g.cells[i] === FLOOR && g.area[i] === areaId && g.rampIdx[i] < 0) return {L: lv, i};
  }
  return {L: lv, i: -1};
}

describe('SkywaysArch: the finishes of a real Skyways layout', () => {
  for (const seed of SEEDS) {
    it(`seed ${seed}: public / court / bridge / wet / back of house -> skyways keys; station + storefronts keep the builder rule`, () => {
      const {L, w} = world(seed);
      const a = w.skywaysArch!;
      expect(a).toBeInstanceOf(SkywaysArch);
      const bridges = new Set(L.skyways!.bridges.map(b => b.area));
      const seen = new Map<SkywaysClass, number>();
      const FLOOR_OF: Partial<Record<SkywaysClass, string>> = {public: 'skyways-floor-public', court: 'skyways-floor-court', bridge: 'skyways-floor-bridge', wet: 'skyways-floor-wet', boh: 'skyways-floor-boh', office: 'skyways-floor-office'};
      for (const ar of L.areas) {
        // (rework) the arch's class: anchors take their store finishes; an atrium court keeps 'court' under a landmark's name
        const cls = a.classOf(ar.id);
        seen.set(cls, (seen.get(cls) ?? 0) + 1);
        const c = cellOf(L, ar.id);
        if (c.i < 0) continue;
        const fk = a.floorKey(c.L, c.i);
        // (task studio-skyways-rework-20261107-054512-01) an anchor store's areas take its family's own finishes (anchorStyles.ts)
        if (a.classOf(ar.id) === 'anchor') {
          expect(fk, `${ar.label} floor`).toMatch(/^skyways-anchor-floor-[a-z]+@/);
          expect(a.ceilKey(c.L, ar.id, c.i), `${ar.label} ceil`).toMatch(/^skyways-anchor-ceil-[a-z]+@/);
          continue;
        }
        // (task studio-skyways-rework-20261107-054512-01, lane ARCH: layout v3 — a roofed bridge has the paver floor and no ceiling
        // (its glass roof); the skylit skyway courts and the atrium courts take the court look: the warm floor, the timber slat
        // ceiling — their stand-ins here, no textures loaded; tests/skyways-arch-rework.test.ts covers the textured path)
        const roofed = L.skyways!.bridges.some(b => b.area === ar.id && b.roof), courtLook = a.rework && (cls === 'court' || (L.skyways!.skylights ?? []).some(s => s.area === ar.id));
        // (task studio-skywalk-variety-20261107-231448-01, lane DRESS) a small shop's floor: its use's palette floor (world/skywaysShopFinish.ts)
        // (task studio-skywalk-encounters-20261108-074144-01, lane STORES: layout version 5 — a Mall store family's floor: its programme's Mall row)
        if (cls === 'shop') { const m = a.mallStoreProgram(ar.id), p = a.shopPalette(ar.id); expect(fk, `${ar.label} floor`).toBe(m ? skywaysMallFloorKey(m) : p ? skywaysShopFloorKey(p) : null); }
        else if (cls === 'station') expect(fk, `${ar.label} floor`).toBeNull();
        else if (roofed) expect(fk, `${ar.label} floor`).toBe('skyways-floor-pavers');
        else if (courtLook) expect(fk, `${ar.label} floor`).toBe('skyways-floor-court');
        else expect(fk, `${ar.label} floor`).toBe(FLOOR_OF[cls]);
        const ck = a.ceilKey(c.L, ar.id, c.i);
        if (a.atriumRoof[c.i] > 0 && L.levels![c.L].grid.ceil[c.i] >= a.atriumRoof[c.i] - 0.5) { expect(ck, `${ar.label} atrium`).toBe(false); continue; }
        if (cls === 'station' || (cls === 'shop' && c.L === 0)) expect(ck, `${ar.label} ceil`).toBeNull();
        else if (roofed) expect(ck, `${ar.label} ceil`).toBe(false);
        else if (courtLook) expect(ck, `${ar.label} ceil`).toBe('skyways-ceil-slats');
        else if (cls === 'bridge') expect(ck).toBe('skyways-ceil-bridge');
        else if (cls === 'boh') expect(ck).toBe('skyways-ceil-core');
        else if (cls === 'office') expect(ck).toBe('skyways-ceil-grid'); // (rework) a tenant office wing
        else if (cls === 'public' && c.L >= 2) expect(ck).toBe('skyways-ceil-grid');
        else expect(ck, `${ar.label} ceil`).toBe('skyways-ceil-plain');
      }
      // the level really has every class (bridges, an atrium court, washrooms, back rooms, storefronts, the station)
      for (const k of ['station', 'shop', 'public', 'court', 'bridge', 'wet', 'boh'] as SkywaysClass[]) expect(seen.get(k) ?? 0, k).toBeGreaterThan(0);
      expect(seen.get('bridge')).toBe(L.skyways!.bridges.length);
      // platforms / track bed: the station finishes
      expect(skywaysAreaClass(L.areas[L.platform], bridges)).toBe('station');
      // walls: by class; the station / storefront faces unchanged
      for (const f of w.wallFaces) {
        const cls = a.classOf(f.area);
        // (task studio-alpha-skyways-shops-20261107-054512-01) a store's own walls are its unit's 'tileShop' faces: every one takes the
        // store's finish (never the Subway shop tile) — the flank faces of a two-level store's internal stair too (integration
        // 20261107-115426)
        if (cls === 'anchor') { expect(f.finish, 'a store wall').toMatch(/^skyways-anchor-wall-[a-z]+@/); expect(finishClass(f.finish)).not.toBeNull(); continue; }
        // (task studio-skywalk-variety-20261107-231448-01, lane DRESS) a small storefront unit's walls take its use's palette, never the
        // Subway shop tile (a shop area without a known use keeps the builder's rule)
        if (cls === 'shop') {
          const p = a.shopPalette(f.area), m = a.mallStoreProgram(f.area); // (+ a Mall store family's wall: its programme's Mall row, lane STORES)
          if (m) { expect(f.finish, `${L.areas[f.area].label} wall`).toBe(skywaysMallWallKey(m)); expect(finishClass(f.finish)).not.toBeNull(); continue; }
          if (p) { expect(f.finish, `${L.areas[f.area].label} wall`).toBe(skywaysShopWallKey(p)); expect(finishClass(f.finish)).not.toBeNull(); } else expect(f.finish.startsWith('skyways-'), `${f.finish} ${cls}`).toBe(false);
          continue;
        }
        if (f.finish === 'tileShop' || cls === 'station') { expect(f.finish.startsWith('skyways-'), `${f.finish} ${cls}`).toBe(false); continue; }
        if (f.slope) { expect(['skyways-wall', 'skyways-boh']).toContain(f.finish); continue; }
        // (lane ARCH) a skylight coffer's well walls: the plain plaster of a light well
        const well = (L.skyways!.skylights ?? []).some(s => s.area === f.area && f.y0 >= s.ceilY - 0.02);
        expect(f.finish, cls).toBe(well ? 'skyways-reveal' : cls === 'wet' ? 'skyways-wet' : cls === 'boh' ? 'skyways-boh' : cls === 'office' ? 'skyways-office-wall' : 'skyways-wall');
        // never a station treatment / identity
        expect(STATION_TREATMENTS).not.toContain(treatmentOf(f));
        expect(['office', 'paint']).toContain(finishFamily(f.finish));
      }
      expect(w.wallFaces.filter(f => f.finish === 'skyways-wall').length).toBeGreaterThan(200);
      // (integration 20261107-115426) a two-level store's own internal stair core (inside its footprint) is the store's: classed
      // 'anchor', so its well and flight walls take the store's finish (seed 1 has one: the design store)
      for (const an of (L.skyways!.anchors ?? []).filter(q => q.upper !== undefined)) {
        const r = an.rect;
        const cores = L.areas.filter(q => q.type === 'stair-core' && q.x * 0.5 >= r.x0 && (q.x + q.w) * 0.5 <= r.x1 && q.y * 0.5 >= r.z0 && (q.y + q.h) * 0.5 <= r.z1);
        expect(cores.length, `${an.name}: its internal stair`).toBeGreaterThan(0);
        for (const q of cores) {
          expect(a.classOf(q.id), q.label).toBe('anchor');
          expect(w.wallFaces.filter(f => f.area === q.id).every(f => f.finish.startsWith('skyways-anchor-wall-')), q.label).toBe(true);
        }
      }
      if (seed === 1) expect((L.skyways!.anchors ?? []).some(q => q.upper !== undefined), 'seed 1 has a two-level store').toBe(true);
      // door frames: dark steel on the skyways storeys, the station's steel on the platforms
      expect(a.doorTrimKey(1, L.areas.find(q => skywaysAreaClass(q, bridges) === 'public'))).toBe('skyways-trim');
      expect(a.doorTrimKey(0, L.areas[L.platform])).toBeNull();
    });
  }

  it('no ceiling inside an atrium opening (the band rises to the glass roof); one glazed vault + steel per atrium, tagged, transparent', () => {
    for (const seed of SEEDS) {
      const {L, w} = world(seed);
      const atria = L.skyways!.buildings.filter(b => b.atrium);
      expect(atria.length, `seed ${seed} atria`).toBeGreaterThan(0);
      // the street-level band rises to the roof line inside every opening: those ceiling runs exist and resolve to "none"
      const a = w.skywaysArch!, levels = stationLevels(L), cols = new LevelColumns(levels);
      let runs = 0;
      for (const r of ceilingRuns(levels, cols)) {
        if (r.voidCell) continue;
        const i = r.row * L.grid.w + r.x0;
        if (a.atriumRoof[i] > 0 && Math.abs(r.y - a.atriumRoof[i]) < 0.5) { runs++; expect(a.ceilKey(r.level, r.area, i, r.y)).toBe(false); }
      }
      expect(runs, `seed ${seed} atrium ceiling runs`).toBeGreaterThan(0);
      let checked = 0;
      w.group.traverse(o => {
        const m = o as THREE.Mesh;
        if (!m.isMesh || (o as THREE.InstancedMesh).isInstancedMesh || /atrium/.test(m.name)) return;
        const p = m.geometry.attributes.position, n = m.geometry.attributes.normal, idx = m.geometry.index;
        if (!p || !n || !idx) return;
        for (let t = 0; t + 2 < idx.count; t += 3) {
          const i0 = idx.getX(t), i1 = idx.getX(t + 1), i2 = idx.getX(t + 2);
          if (n.getY(i0) > -0.99) continue; // down-facing (ceilings / soffits) only
          const cx = (p.getX(i0) + p.getX(i1) + p.getX(i2)) / 3, cy = (p.getY(i0) + p.getY(i1) + p.getY(i2)) / 3, cz = (p.getZ(i0) + p.getZ(i1) + p.getZ(i2)) / 3;
          for (const b of atria) {
            const r = b.atrium!.rect;
            if (cx > r.x0 + 0.05 && cx < r.x1 - 0.05 && cz > r.z0 + 0.05 && cz < r.z1 - 0.05) {
              checked++;
              expect(Math.abs(cy - b.atrium!.roofY), `${m.name} ceiling inside the ${b.id} atrium opening`).toBeGreaterThan(0.6);
            }
          }
        }
      });
      const glass = w.group.getObjectByName('skyways-atrium-glass') as THREE.Mesh, steel = w.group.getObjectByName('skyways-atrium-steel') as THREE.Mesh;
      expect(glass && steel).toBeTruthy();
      const gm = glass.material as THREE.Material;
      expect(gm.transparent).toBe(true); // markShadows skips transparent materials: never an opaque flashlight caster
      expect(gm.side).toBe(THREE.DoubleSide);
      expect(glass.userData.levels).toEqual([1, 2]);
      expect(steel.userData.levels).toEqual([1, 2]);
      const st = w.skywaysArch!.stats;
      expect(st.roofs).toBe(atria.length);
      // the glass covers each atrium rect: its vertices span the rect, springing at roofY
      const box = new THREE.Box3().setFromBufferAttribute(glass.geometry.attributes.position as THREE.BufferAttribute);
      for (const b of atria) {
        expect(box.min.x).toBeLessThanOrEqual(b.atrium!.rect.x0 + 1e-3);
        expect(box.min.y).toBeCloseTo(b.atrium!.roofY, 3);
      }
      log(`seed ${seed}: atrium ceiling runs dropped ${runs}; down-facing tris inside the openings (none at the roof line) ${checked}; roofs ${JSON.stringify(st)}`);
    }
  });

  it('materials: a handful, one program per surface kind, reveal = plain public paint, impacts take the drawn finish', () => {
    const {L, w} = world(SEEDS[0]);
    const a = w.skywaysArch!;
    const used = a.usedMaterials();
    // the public finishes stay a handful; the anchor stores add at most three per family (+ a zone set: the auditorium / booths),
    // every one on the same office programs (wall / floor / ceiling) and with an impact class
    const anchorKeys = [...used.keys()].filter(k => k.startsWith('skyways-anchor-'));
    // (lane ARCH) + the rework's court / bridge finishes (textured or their stand-ins), the roof steel and the skylight sky
    const archKeys = [...used.keys()].filter(k => /^skyways-(tex-|floor-pavers|ceil-slats|skylight-sky|roof-steel)/.test(k));
    expect(archKeys.length).toBeLessThanOrEqual(8);
    // (lane DRESS) + the small shops' palettes: ONE wall and ONE floor material for every palette (the Mall's finish-row programs)
    const shopKeys = [...used.keys()].filter(k => k.startsWith('skyways-shop-'));
    expect(shopKeys.sort()).toEqual([SKYWAYS_SHOP_FLOOR_KEY, SKYWAYS_SHOP_WALL_KEY]);
    expect(used.get(SKYWAYS_SHOP_WALL_KEY)).toBe(mallSurfaceMaterial('wall'));
    expect(used.get(SKYWAYS_SHOP_FLOOR_KEY)).toBe(mallSurfaceMaterial('floor'));
    for (const k of shopKeys) expect(finishClass(k), k).not.toBeNull();
    expect(used.size - anchorKeys.length - archKeys.length - shopKeys.length).toBeLessThanOrEqual(15);
    expect(anchorKeys.length).toBeLessThanOrEqual(6 * (L.skyways!.anchors?.length ?? 0));
    for (const k of anchorKeys) expect(finishClass(k), k).not.toBeNull();
    const aw = anchorKeys.filter(k => k.startsWith('skyways-anchor-wall-')).map(k => used.get(k) as OfficeSurfaceMaterial);
    for (const m of aw) expect(m.colorNode).toBe((used.get('skyways-wall') as OfficeSurfaceMaterial).colorNode);
    const walls = ['skyways-wall', 'skyways-wet', 'skyways-boh'].map(k => used.get(k) as OfficeSurfaceMaterial);
    const reveal = a.revealMaterial(2) as OfficeSurfaceMaterial;
    expect(reveal).toBeInstanceOf(OfficeSurfaceMaterial);
    for (const m of [...walls, reveal]) expect(m.colorNode).toBe(walls[0].colorNode);
    expect(reveal.ofP.w).toBe(LOWER.none);
    expect(reveal.ofP.x).toBe(0); // no skirting band on the reveals' arbitrary uvs
    expect(reveal.ofA.equals((used.get('skyways-wall') as OfficeSurfaceMaterial).ofA)).toBe(true);
    const floors = [...used].filter(([k]) => k.startsWith('skyways-floor')).map(([, m]) => m as OfficeSurfaceMaterial);
    for (const m of floors) expect(m.colorNode).toBe(floors[0].colorNode);
    const ceils = [...used].filter(([k]) => k.startsWith('skyways-ceil')).map(([, m]) => m as OfficeSurfaceMaterial);
    for (const m of ceils) expect(m.colorNode).toBe(ceils[0].colorNode);
    // the bridge soffit is whiter than the public plaster ceiling
    const lum = (c: THREE.Color) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
    expect(lum((used.get('skyways-ceil-bridge') as OfficeSurfaceMaterial).ofA)).toBeGreaterThan(lum((used.get('skyways-ceil-plain') as OfficeSurfaceMaterial).ofA));
    // impacts: every key the arch drew has a damage class; the resolver answers with it
    for (const k of used.keys()) { expect(isArchFinish(k)).toBe(true); expect(finishClass(k), k).not.toBeNull(); }
    expect(FINISH_CLASS_KEYS.skyways).toContain('skyways-wall');
    const f = w.wallFaces.find(q => q.finish === 'skyways-wall' && !q.slope && q.y1 - q.y0 > 2 && Math.abs(q.z0 - q.z1) < 1e-9)!;
    const Lidx = L.levels!.findIndex(l => l.id === f.level);
    expect(w.finishAt!('wall', Lidx, (f.x0 + f.x1) / 2, (f.y0 + f.y1) / 2, f.z0, 0, f.nz)).toBe('skyways-wall');
    expect(finishClass('skyways-wall')).toBe('plaster');
    expect(finishClass('skyways-floor-public')).toBe('terrazzo');
    // inert on every other level
    expect(SkywaysArch.for({...L, skyways: undefined} as StationLayout, mats, L.levels!)).toBeNull();
  });

  it('draw / triangle budget of the Skyways architecture (logged per seed)', () => {
    for (const seed of SEEDS) {
      const {w} = world(seed);
      let skyMeshes = 0, skyTris = 0;
      w.group.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh && /^skyways-/.test((m.material as THREE.Material).name ?? '')) { skyMeshes++; skyTris += tris(m); } });
      log(`seed ${seed}: station group ${JSON.stringify(w.stats)}; skyways-material meshes ${skyMeshes} (${skyTris} tris); arch ${JSON.stringify(w.skywaysArch!.summary())}`);
      expect(w.stats.archMeshes).toBeLessThan(400);
      expect(skyMeshes).toBeLessThan(260);
    }
  });
});

// ---------------------------------------------------------------------------------------------

const rectArea = (r: {s0: number; s1: number; t0: number; t1: number}) => (r.s1 - r.s0) * (r.t1 - r.t0);

describe('skyways exterior: the plan (pure)', () => {
  it('rect helpers: subtraction keeps the area; the inner ground is the complex minus every footprint', () => {
    const parts = subtractRects(0, 10, 0, 5, [{s0: 2, s1: 4, t0: 1, t1: 3}, {s0: 3, s1: 6, t0: 2, t1: 7}]);
    const sum = parts.reduce((s, r) => s + rectArea(r), 0);
    expect(sum).toBeCloseTo(50 - 4 - 3 * 3 + 1, 6); // overlap of the two holes (3..4 x 2..3) counted once
    const {L} = world(SEEDS[0]);
    const info = L.skyways!;
    const g = groundRects(info.exterior, info.buildings.map(b => b.rect));
    const ga = g.reduce((s, r) => s + (r.x1 - r.x0) * (r.z1 - r.z0), 0);
    const ext = (info.exterior.x1 - info.exterior.x0) * (info.exterior.z1 - info.exterior.z0);
    const foot = info.buildings.reduce((s, b) => s + (b.rect.x1 - b.rect.x0) * (b.rect.z1 - b.rect.z0), 0);
    expect(ga).toBeCloseTo(ext - foot, 3);
    for (const r of g) for (const b of info.buildings) {
      const ox = Math.min(r.x1, b.rect.x1) - Math.max(r.x0, b.rect.x0), oz = Math.min(r.z1, b.rect.z1) - Math.max(r.z0, b.rect.z0);
      expect(ox > 1e-6 && oz > 1e-6, `ground over ${b.id}`).toBe(false);
    }
  });

  for (const seed of SEEDS) {
    it(`seed ${seed}: deterministic; one shell per building on its outer faces (bridge mouths cut), never coplanar with a built wall face`, () => {
      const {L, w} = world(seed);
      const info = L.skyways!;
      const p1 = planSkywaysExterior(L), p2 = planSkywaysExterior(L);
      expect(JSON.stringify(p2)).toBe(JSON.stringify(p1));
      expect(p1.shells.map(s => s.building)).toEqual(info.buildings.map(b => b.id));
      // every bridge joins two facades: one hole at each end, the tube's inner cross-section
      for (const br of info.bridges) {
        const holes = p1.shells.flatMap(s => s.holes.filter(h => h.bridge === br.id).map(h => ({...h, b: s.building})));
        expect(holes.map(h => h.b).sort(), br.id).toEqual([br.a, br.b].sort());
        const [l0, l1] = br.axis === 'z' ? [br.rect.x0, br.rect.x1] : [br.rect.z0, br.rect.z1];
        for (const h of holes) { expect(h.s0).toBeCloseTo(l0, 6); expect(h.s1).toBeCloseTo(l1, 6); expect(h.y0).toBe(info.storeys[2].baseY); }
      }
      for (const s of p1.shells) {
        const b = info.buildings.find(q => q.id === s.building)!;
        for (const f of s.faces) {
          const box = s.tower && (f.axis === 'y' ? f.c > s.podiumTop + 1e-6 : f.t0 >= s.podiumTop - 1e-6) ? s.tower : b.rect;
          if (f.axis === 'y') { expect(f.n).toBe(1); continue; }
          const lo = f.axis === 'z' ? box.z0 : box.x0, hi = f.axis === 'z' ? box.z1 : box.x1;
          expect(f.c === lo ? -1 : f.c === hi ? 1 : 0, `${s.building} face plane`).toBe(f.n); // on the outer face, facing out
        }
      }
      // no shell face is coplanar (same plane, same facing, overlapping) with a face the builder drew: no z-fighting
      let tested = 0;
      for (const f of w.wallFaces) {
        const alongX = Math.abs(f.z0 - f.z1) < 1e-9, axis = alongX ? 'z' : 'x', c = alongX ? f.z0 : f.x0, n = Math.sign(alongX ? f.nz : f.nx);
        const s0 = Math.min(alongX ? f.x0 : f.z0, alongX ? f.x1 : f.z1), s1 = Math.max(alongX ? f.x0 : f.z0, alongX ? f.x1 : f.z1);
        for (const sh of p1.shells) for (const q of sh.faces) {
          if (q.axis !== axis || Math.abs(q.c - c) > 1e-3 || q.n !== n) continue;
          tested++;
          const os = Math.min(q.s1, s1) - Math.max(q.s0, s0), oy = Math.min(q.t1, f.y1) - Math.max(q.t0, f.y0);
          expect(os > 1e-3 && oy > 1e-3, `shell ${sh.building} over a built face at ${axis}=${c}`).toBe(false);
        }
      }
      expect(tested).toBeGreaterThan(0); // the bridge mouths' own facade faces share the planes
      // an atrium building: podium to its roof line (cap cut over the opening) + the tower beside it
      for (const s of p1.shells) {
        const b = info.buildings.find(q => q.id === s.building)!;
        if (!b.atrium) { expect(s.tower).toBeNull(); expect(s.top).toBe(b.top); continue; }
        expect(s.podiumTop).toBeCloseTo(b.atrium.roofY, 6);
        const caps = s.faces.filter(f => f.axis === 'y' && Math.abs(f.c - s.podiumTop) < 1e-6);
        const r = b.atrium.rect;
        for (const cap of caps) expect(Math.min(cap.s1, r.x1) - Math.max(cap.s0, r.x0) > 1e-6 && Math.min(cap.t1, r.z1) - Math.max(cap.t0, r.z0) > 1e-6, 'cap over the atrium').toBe(false);
        if (s.tower) {
          const t = s.tower;
          expect(Math.min(t.x1, r.x1) - Math.max(t.x0, r.x0) > 0 && Math.min(t.z1, r.z1) - Math.max(t.z0, r.z0) > 0, 'tower over the atrium').toBe(false);
        }
      }
    });

    it(`seed ${seed}: one exterior per bridge (underside, roof, fascias minus its windows, steel, glazing unless breached); wrecks only on the road`, () => {
      const {L} = world(seed);
      const info = L.skyways!;
      const p = planSkywaysExterior(L);
      expect(p.bridges.map(b => b.bridge)).toEqual(info.bridges.map(b => b.id));
      for (const bp of p.bridges) {
        const br = info.bridges.find(b => b.id === bp.bridge)!;
        expect(bp.outer).toEqual(bridgeOuter(br));
        const under = bp.faces.filter(f => f.axis === 'y' && f.n === -1), roof = bp.faces.filter(f => f.axis === 'y' && f.n === 1);
        expect(under.length).toBe(1);
        expect(under[0].c).toBeCloseTo(info.storeys[2].baseY - SKYWAYS_EXT.deckDepth, 6);
        // (lane ARCH, layout v3) a glazed roof: no opaque roof slab, the fascias stop under its wall plate
        if (br.roof) { expect(roof.length).toBe(0); expect(bp.y1).toBeCloseTo(br.roof.springY - 0.03, 6); }
        else { expect(roof.length).toBe(1); expect(roof[0].c).toBeGreaterThan(info.storeys[2].baseY + 3); }
        const wins = info.windows.filter(w => 'bridge' in w.host && w.host.bridge === br.id);
        const side = bp.faces.filter(f => f.axis !== 'y');
        const full = 2 * (bp.y1 - bp.y0) * (br.axis === 'z' ? br.rect.z1 - br.rect.z0 : br.rect.x1 - br.rect.x0);
        const holes = wins.reduce((s, w) => s + (w.head - w.sill) * (br.axis === 'z' ? w.z1 - w.z0 : w.x1 - w.x0), 0);
        expect(side.reduce((s, f) => s + rectArea(f), 0)).toBeCloseTo(full - holes, 3);
        expect(bp.steel.length).toBeGreaterThanOrEqual(4);
        expect(bp.glass.length).toBe(br.breached ? 0 : wins.length);
      }
      expect(p.wrecks.length).toBeGreaterThanOrEqual(info.streets.length); // a handful per street
      const walks = info.buildings.map(b => ({x0: b.rect.x0 - SKYWAYS_EXT.sidewalk, z0: b.rect.z0 - SKYWAYS_EXT.sidewalk, x1: b.rect.x1 + SKYWAYS_EXT.sidewalk, z1: b.rect.z1 + SKYWAYS_EXT.sidewalk}));
      const inside = (r: {x0: number; z0: number; x1: number; z1: number}, x: number, z: number) => x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1;
      for (const wk of p.wrecks) {
        expect(WRECK_KEYS).toContain(wk.key);
        expect(inside(info.streets[wk.street].rect, wk.x, wk.z), 'on its street').toBe(true);
        expect(inside(info.exterior, wk.x, wk.z), 'inside the complex').toBe(true);
        expect(walks.some(r => inside(r, wk.x, wk.z)), 'off the sidewalks / footprints').toBe(false);
        expect(info.bridges.some(b => inside(b.rect, wk.x, wk.z)), 'never under a bridge').toBe(false);
        for (const o of p.wrecks) if (o !== wk) expect(Math.hypot(o.x - wk.x, o.z - wk.z)).toBeGreaterThan((o.len + wk.len) / 2);
      }
      // curbs: never inside a footprint
      for (const c of p.curbs) for (const b of info.buildings) expect(inside(b.rect, (c.x0 + c.x1) / 2, (c.z0 + c.z1) / 2)).toBe(false);
      // the Skyways streets are painted onto the city map; the city surrounds the complex
      expect(p.city.foot).toEqual(info.exterior);
      for (const s of info.streets) expect(p.city.streets.some(r => r.kind === 'road' && r.x0 === s.rect.x0 && r.z1 === s.rect.z1)).toBe(true);
    });
  }
});

// ---------------------------------------------------------------------------------------------

/** A GLTF-like wreck: one textured-colour box mesh (nose +X). */
function fakeWreck(): GLTF {
  const scene = new THREE.Group();
  const g = new THREE.BoxGeometry(4.6, 1.4, 1.9); g.translate(0, 0.7, 0);
  scene.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({color: 0x664433})));
  return {scene} as unknown as GLTF;
}

describe('skyways exterior: build + runtime', () => {
  it('build: draws / triangles bounded, wreck models instanced (stand-ins otherwise), never a shadow caster, outward-only bridge glass', () => {
    for (const seed of SEEDS) {
      const {L} = world(seed);
      const plan: SkywaysExteriorPlan = planSkywaysExterior(L);
      const used = [...new Set(plan.wrecks.map(w => w.key))];
      const v = buildSkywaysExterior(plan, {wrecks: {[used[0]]: fakeWreck()}});
      const inst = v.instanced;
      for (const k of used) {
        const im = inst.find(m => m.name === `skyways-ext-wreck-${k}`)!;
        expect(im, k).toBeTruthy();
        expect(im.count).toBe(plan.wrecks.filter(w => w.key === k).length);
      }
      expect(v.stats.wreckModels).toBe(1);
      for (const n of ['skyways-ext-ground', 'skyways-ext-shells', 'skyways-ext-bridges', 'skyways-city']) expect(v.root.getObjectByName(n), n).toBeTruthy();
      const bg = v.root.getObjectByName('skyways-ext-bridge-glass') as THREE.Mesh | undefined;
      if (plan.bridges.some(b => b.glass.length)) {
        expect(bg).toBeTruthy();
        expect((bg!.material as THREE.Material).side).toBe(THREE.FrontSide);
        expect((bg!.material as THREE.Material).transparent).toBe(true);
      }
      v.root.traverse(o => { expect(o.castShadow).toBe(false); if ((o as THREE.Mesh).isMesh && o !== v.city.dome) expect(o.renderOrder).toBe(5); });
      // the inner ground shares the city's ground material (one program; its map carries the Skyways streets)
      const cg = v.city.root.getObjectByName('tower-ext-ground') as THREE.Mesh, ig = v.root.getObjectByName('skyways-ext-ground') as THREE.Mesh;
      expect(ig.material).toBe(cg.material);
      // with the delivered models: the wrecks' cooked triangles (SKYWAYS_PROP_MODELS) + the Office city's Meshy heroes / props (OFFICE_ASSETS)
      const wreckTris = plan.wrecks.reduce((s, q) => s + SKYWAYS_PROP_MODELS[q.key].tris, 0);
      const heroTris = plan.city.buildings.filter(b => b.kind === 'tower').length * (OFFICE_ASSETS['ruined-tower'].tris) + plan.city.buildings.filter(b => b.kind === 'midrise').length * (OFFICE_ASSETS['ruined-midrise'].tris);
      const propTris = plan.city.props.reduce((s, q) => s + (q.kind === 'car' ? SKYWAYS_PROP_MODELS.skyways_wreck_sedan_stripped.tris : OFFICE_ASSETS[q.kind === 'bus' ? 'bus-wreck' : 'rubble-pile'].tris), 0);
      log(`seed ${seed}: exterior ${JSON.stringify(v.stats)} (procedural city; ${used.length} wreck models placed); with the delivered models: wrecks ${wreckTris} tris (${plan.wrecks.length}), city heroes ${heroTris} + props ${propTris} tris`);
      expect(v.stats.draws).toBeLessThan(40);
      expect(v.stats.triangles - v.stats.cityTris).toBeLessThan(60_000);
      for (const g of v.geometries) g.dispose();
    }
  });

  it('runtime: hooks, far plane, fog box per eye position, hidden in the station / shown with a window in view, teardown disposes; inert elsewhere', () => {
    const {L, w} = world(SEEDS[0]);
    const info = L.skyways!;
    const paint = new THREE.MeshBasicMaterial();
    const plans = planSkywaysWindows(info, L.seed);
    const host: SkywaysExteriorHost = {
      scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(75, 1, 0.05, 70), levels: {lineOfSight: () => true},
      warmRegistry: new WarmupRegistry(), frameHooks: [], sectionHooks: [], sectionPreloads: [], world: w,
      skywaysWindows: {glazing: {plans}, revealMaterial: () => paint},
    };
    const rt = installSkywaysExterior(host);
    expect([host.frameHooks.length, host.sectionHooks.length, host.sectionPreloads!.length]).toEqual([1, 1, 1]);
    expect((host.warmRegistry as WarmupRegistry).names.pools).toContain('skyways-exterior');
    expect(host.skywaysWindows!.revealMaterial(2)).toBe(w.skywaysArch!.revealMaterial(2));
    host.sectionHooks[0].build!(L);
    const v = rt.view!;
    expect(v.root.parent).toBe(host.scene);
    expect(host.camera.far).toBe(EXTERIOR.far);
    const cam = host.camera;
    const at = (x: number, y: number, z: number, lx: number, ly: number, lz: number) => { cam.position.set(x, y, z); cam.lookAt(lx, ly, lz); cam.updateMatrixWorld(); rt.frame(1); };
    // the station platform: hidden
    at(info.start.x, 1.6, info.start.z, info.start.x, 1.6, info.start.z - 5);
    expect(v.root.visible).toBe(false);
    // on a bridge deck looking at one of its windows: shown; the indoor fog box is the deck
    const br = info.bridges[0], win = info.windows.find(q => 'bridge' in q.host && q.host.bridge === br.id)!;
    const mx = (br.rect.x0 + br.rect.x1) / 2, mz = (br.rect.z0 + br.rect.z1) / 2, ey = info.storeys[2].baseY + 1.6;
    at(mx, ey, mz, (win.x0 + win.x1) / 2, ey, (win.z0 + win.z1) / 2);
    expect(v.root.visible).toBe(true);
    expect(rt.fogBox).toEqual({kind: 'bridge', id: br.id});
    expect([EXT_U.box.value.x, EXT_U.box.value.y, EXT_U.box.value.z, EXT_U.box.value.w]).toEqual([br.rect.x0, br.rect.z0, br.rect.x1, br.rect.z1]);
    // (lane ARCH) under a glazed bridge roof (layout v3) every exterior ray is outdoor (the sky through the roof); else the deck's box
    expect(EXT_U.roofY.value).toBe(br.roof ? -1e9 : 1e9);
    // inside an atrium building: every exterior ray outdoor (the sky through the vault); a plain building: its footprint
    const atr = info.buildings.find(b => b.atrium)!, plain = info.buildings.find(b => !b.atrium)!;
    const r = atr.atrium!.rect;
    at((r.x0 + r.x1) / 2, info.groundY + 1.6, (r.z0 + r.z1) / 2, (r.x0 + r.x1) / 2, atr.atrium!.roofY + 2, (r.z0 + r.z1) / 2 + 0.5);
    expect(rt.fogBox).toEqual({kind: 'atrium', id: atr.id});
    expect(EXT_U.roofY.value).toBeLessThan(-1e8);
    expect(v.root.visible).toBe(true); // the vault is in view
    at((plain.rect.x0 + plain.rect.x1) / 2, info.groundY + 1.6, (plain.rect.z0 + plain.rect.z1) / 2, plain.rect.x0, info.groundY + 1.6, plain.rect.z0);
    expect(rt.fogBox).toEqual({kind: 'building', id: plain.id});
    expect(EXT_U.roofY.value).toBe(1e9);
    // the dome follows the eye
    expect(v.city.dome.position.distanceTo(cam.position)).toBeLessThan(1e-6);
    // teardown: removed, disposed, restored
    let disposed = 0;
    for (const g of [...v.geometries, ...v.city.geometries]) g.addEventListener('dispose', () => { disposed++; });
    let instDisposed = 0;
    for (const im of v.instanced) im.addEventListener('dispose', () => { instDisposed++; });
    host.sectionHooks[0].teardown!();
    expect(v.root.parent).toBeNull();
    expect(rt.view).toBeNull();
    expect(host.camera.far).toBe(70);
    expect(disposed).toBe(v.geometries.length + v.city.geometries.length);
    expect(instDisposed).toBe(0); // deferred one frame
    rt.frame(0.016);
    expect(instDisposed).toBe(v.instanced.length);
    expect([EXT_U.box.value.x, EXT_U.roofY.value]).toEqual([-1e5, 1e9]);
    // another level: inert (no exterior; the wreck cache released)
    host.sectionHooks[0].build!({...L, skyways: undefined} as StationLayout);
    expect(rt.view).toBeNull();
    expect(host.scene.children.length).toBe(0);
    expect(host.camera.far).toBe(70);
    void CELL;
  });
});

describe('skyways: real assets + shaders', () => {
  it('the delivered wreck GLBs (textures stripped): nose +X, grounded, centred; instanced wrecks stand on the road at street level', async () => {
    const models = {} as Record<WreckKey, GLTF>;
    for (const k of WRECK_KEYS) models[k] = await loadStripped(SKYWAYS_PROP_MODELS[k].url);
    for (const k of WRECK_KEYS) {
      const b = new THREE.Box3().setFromObject(models[k].scene), m = SKYWAYS_PROP_MODELS[k];
      expect(b.min.y, k).toBeCloseTo(0, 2);
      expect(b.max.x - b.min.x, k).toBeCloseTo(m.w, 1); // long along X
      expect(b.max.z - b.min.z, k).toBeCloseTo(m.d, 1);
      expect(Math.abs(b.max.x + b.min.x) / 2, k).toBeLessThan(0.05);
    }
    const {L} = world(SEEDS[0]);
    const info = L.skyways!, plan = planSkywaysExterior(L);
    const v = buildSkywaysExterior(plan, {wrecks: models});
    expect(v.stats.wreckModels).toBe(new Set(plan.wrecks.map(q => q.key)).size);
    const walks = info.buildings.map(b => ({x0: b.rect.x0 - SKYWAYS_EXT.sidewalk, z0: b.rect.z0 - SKYWAYS_EXT.sidewalk, x1: b.rect.x1 + SKYWAYS_EXT.sidewalk, z1: b.rect.z1 + SKYWAYS_EXT.sidewalk}));
    const m4 = new THREE.Matrix4(), p = new THREE.Vector3();
    let corners = 0;
    for (const im of v.instanced.filter(q => q.name.startsWith('skyways-ext-wreck-'))) {
      im.geometry.computeBoundingBox();
      const bb = im.geometry.boundingBox!;
      for (let i = 0; i < im.count; i++) {
        im.getMatrixAt(i, m4);
        let minY = Infinity;
        for (const [x, z] of [[bb.min.x, bb.min.z], [bb.max.x, bb.min.z], [bb.min.x, bb.max.z], [bb.max.x, bb.max.z]]) {
          p.set(x, bb.min.y, z).applyMatrix4(m4);
          minY = Math.min(minY, p.y);
          corners++;
          expect(walks.some(r => p.x > r.x0 + 0.05 && p.x < r.x1 - 0.05 && p.z > r.z0 + 0.05 && p.z < r.z1 - 0.05), `${im.name} corner on a sidewalk`).toBe(false);
        }
        expect(minY).toBeGreaterThan(info.groundY - 0.3); // grounded on the street (part bounds: within the model's own min y)
      }
    }
    expect(corners).toBeGreaterThan(0);
    for (const g of v.geometries) g.dispose();
  }, 60_000);

  it('every skyways surface, the atrium roof and the exterior pieces build cleanly on both backends (WGSL + GLSL)', () => {
    const {L, w} = world(SEEDS[0]);
    const lights = () => [new THREE.PointLight(0xffffff, 1, 8)];
    const clean = (o: THREE.Object3D, what: string) => { for (const sh of buildBoth(o, {lights: lights()})) expect(sh.errors, `${what} (${sh.backend})`).toEqual([]); };
    const seen = new Set<THREE.Material>();
    w.group.traverse(o => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || seen.has(m.material as THREE.Material)) return;
      const mat = m.material as THREE.Material;
      if (!/^skyways-/.test(mat.name ?? '') && !/^skyways-atrium/.test(m.name)) return;
      seen.add(mat);
      clean(new THREE.Mesh(m.geometry, mat), m.name);
    });
    expect(seen.size).toBeGreaterThanOrEqual(10);
    const v = buildSkywaysExterior(planSkywaysExterior(L), {wrecks: {[WRECK_KEYS[0]]: fakeWreck()}});
    for (const n of ['skyways-ext-ground', 'skyways-ext-shells', 'skyways-ext-bridges', 'skyways-ext-bridge-glass']) {
      const m = v.root.getObjectByName(n) as THREE.Mesh;
      clean(new THREE.Mesh(m.geometry, m.material as THREE.Material), n);
    }
    const wr = v.instanced.find(q => q.name.startsWith('skyways-ext-wreck-'))!;
    clean(wr, wr.name);
    for (const g of v.geometries) g.dispose();
  }, 120_000);
});
