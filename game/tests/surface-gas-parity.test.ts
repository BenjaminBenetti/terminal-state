// Task studio-surface-run-opus-rebuild-20261116-020827-01 (lane AIR): SURFACE RUN's gas — the visibility tests the root CLAUDE.md rule
// requires for a new gas source ("Toxic gas is always VISIBLE green volumetric fog": what hurts looks gassy, what looks gassy hurts, one
// source of truth for both), on a SYNTHETIC district (tests/helpers/surfaceAirFixture.ts: the contract's shapes; GEN's generator replaces
// it in play) with the REAL gas system, the REAL Surface air runtime and a REAL VolumetricAtmosphere:
//  - OUTDOORS: every street column carries the outdoor air — exposure == surfaceOutdoorGasAt == the march's surface-variant mirror (its
//    own column texture, uniforms and look); the scene-fog murk at the eye uses the same weight; open sky above roofs too;
//  - SEALED: intact buildings / the tent hold zero gas (exposure, the field, every layer cell, the march's outdoor term inside);
//  - OPENINGS: a pane shot from the street, an opened door, a smashed doorway, GEN's broken pane column -> the room behind fills (exposure
//    == concentrationAt == the uploaded layer); shutting the door thins it visibly as the hazard drops (never a vanish);
//  - THE TRUCK CAB (gas.shelter + the cab volume, follow-up 1): seated, exposure 0 AND no gas drawn inside the cab; beyond its glass the
//    drawn fog == the hazard there == what standing there breathes; THE MASK: dps 0, nothing drawn changes;
//  - the in-engine fallback (pass off): the outdoor murk in the scene fog, the interior field through the existing fallback;
//  - doors (state, collision boxes, [E], enemy push, auto-close, never on a body), persistence per district memory;
//  - the surface variant's binding budget (WebGPU 12 uniform buffers: none added) on both backends.
import {beforeAll, describe, expect, it} from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import * as THREE from 'three';
import {installCanvasShim} from './helpers/canvas2d';
import {fakeEnvTextures} from './helpers/openablesFixture';
import {compileQuad} from './helpers/fogCompile';
import {SA_AT, SA_B0, SA_TENT, surfaceAirFixture, surfaceAirGame} from './helpers/surfaceAirFixture';
import {CELL} from '../src/gen/grid';
import type {StationLayout} from '../src/gen/stationTypes';
import {raycastWorld} from '../src/combat/hitscan';
import {resolveCircle} from '../src/core/physics';
import {WorldMaterials} from '../src/world/materials';
import {paneId} from '../src/world/officeWindows';
import {PANE_MAX_HP} from '../src/world/windowBreach';
import {GAS, gasProfile} from '../src/world/gas/field';
import {ATMOSPHERE_QUALITY} from '../src/render/atmosphere';
import {VolumetricAtmosphere} from '../src/render/volumetric';
import {VF_CAB_MARK, VF_DEPTH_MARK, VF_SURFACE_MARK, createFogUniforms, createMarchMaterial, outdoorMapTexture} from '../src/render/volumetricShaders';
import {gasOpacity, greenness} from '../src/world/gaslightRules';
import {ROOF_FOG} from '../src/world/roofAir';
import {SURFACE_AIR, SURFACE_GAS_LOOK, cabRaySpan, columnTop, inCab, outdoorColumn, outdoorWeight, surfaceOutdoorGasAt, surfaceOutdoorMap} from '../src/world/surface/airMask';
import {SurfaceGasField} from '../src/world/surface/airField';
import {TRUCK_SPEC} from '../src/world/surface/truckSpec';
import {TRUCK_ANCHORS} from '../src/world/surface/truckAnchors.generated';
import {carToWorld} from '../src/world/skywaysCarSpec';
import {SURFACE_WINDOWS_LANE} from '../src/world/surface/airPanes';
import {DOOR_RT, SURFACE_DOORS_LANE, restoredDoor, type SurfaceDoorState} from '../src/world/surface/airDoors';
import {SURFACE_FOG, surfaceFogAt} from '../src/world/surface/airFog';

installCanvasShim(false);
let mats: WorldMaterials;
beforeAll(() => { mats = new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17}); });
const GAME = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const fixture = (() => { let L: StationLayout | null = null; return () => (L ??= surfaceAirFixture()); })();
/** A fresh layout per test that mutates props / lane stores (the door boxes join layout.props at build). */
const fresh = () => surfaceAirFixture();

const sstep = (a: number, b: number, v: number) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

/**
 * CPU mirror of the march's surface-variant outdoor term at (x, y, z) from EXACTLY what the march reads: the column texture's own bytes
 * (nearest texel of the density map's uv = floor(x / CELL), clamped), the regional rect / range / outdoor uniforms (depthDebug).
 * Returns the concentration (c x ramps x column weight; the visual scale `vis` is the look's, applied to the extinction).
 */
function marchOutdoor(atmo: VolumetricAtmosphere, x: number, y: number, z: number): number {
  const s = atmo.surfaceDebug(), d = atmo.depthDebug();
  if (!s.compiled || !d.on || !d.outdoor || !s.texture) return 0;
  const [rx0, rz0, rx1, rz1] = d.rect;
  if (x < rx0 || x > rx1 || z < rz0 || z > rz1) return 0;
  const img = s.texture.image as {width: number; height: number; data: Uint8Array};
  const cx = Math.min(img.width - 1, Math.max(0, Math.floor(x / CELL))), cy = Math.min(img.height - 1, Math.max(0, Math.floor(z / CELL)));
  const top = img.data[cy * img.width + cx] * SURFACE_AIR.TOP_STEP;
  // the strata part: zero (the range ends far below the street)
  const strata = y < d.range[1] ? 1 : 0;
  const o = d.outdoor;
  return strata * 0 + o.c * sstep(o.y0, o.y1, y) * sstep(top - SURFACE_AIR.EDGE, top, y);
}

/** The march's view of the INTERIOR gas at (x, y, z): the R8 layer of the band's slot, bilinear x the profile (the breach term). */
function drawnAt(atmo: VolumetricAtmosphere, x: number, y: number, z: number): {c: number; layer: number; slot: number} {
  const m = atmo.densityMap!, data = (atmo as unknown as {gasData: Uint8Array}).gasData, band = atmo.bandAt(x, y, z);
  if (!band) return {c: 0, layer: 0, slot: -1};
  const base = band.slot * m.w * m.h;
  const at = (a: number, b: number) => (a < 0 || b < 0 || a >= m.w || b >= m.h ? 0 : data[base + b * m.w + a] / 255);
  const u = x / CELL - 0.5, v = z / CELL - 0.5, iu = Math.floor(u), iv = Math.floor(v), fu = u - iu, fv = v - iv;
  const layer = (at(iu, iv) * (1 - fu) + at(iu + 1, iv) * fu) * (1 - fv) + (at(iu, iv + 1) * (1 - fu) + at(iu + 1, iv + 1) * fu) * fv;
  return {c: layer * gasProfile(y, band.floor, band.ceil), layer, slot: band.slot};
}

/** Every layer byte of slot s inside world rect r. */
function layerMax(atmo: VolumetricAtmosphere, s: number, r: {x0: number; z0: number; x1: number; z1: number}): number {
  const m = atmo.densityMap!, data = (atmo as unknown as {gasData: Uint8Array}).gasData;
  let mx = 0;
  for (let y = Math.floor(r.z0 / CELL); y < Math.ceil(r.z1 / CELL); y++) for (let x = Math.floor(r.x0 / CELL); x < Math.ceil(r.x1 / CELL); x++) mx = Math.max(mx, data[s * m.w * m.h + y * m.w + x]);
  return mx / 255;
}

const door = (g: ReturnType<typeof surfaceAirGame>, id: string): SurfaceDoorState => g.air.air!.doors.find(d => d.plan.id === id)!;
const dpsAt = (c: number) => GAS.DPS_MAX * Math.min(1, Math.max(0, (c - GAS.THRESHOLD) / (1 - GAS.THRESHOLD)));

// ---------------------------------------------------------------------------------------------

describe('surface gas: the outdoor air (one column map for exposure, the march and the scene fog)', () => {
  it('the column map: street columns outdoors, footprints indoors to their facade top, the tent to its ridge; cached per layout', () => {
    const L = fixture(), m = surfaceOutdoorMap(L)!;
    expect(m).not.toBe(null);
    expect(surfaceOutdoorMap(L)).toBe(m);
    expect(surfaceOutdoorMap({...L, surface: undefined} as StationLayout)).toBe(null);
    expect(columnTop(m, SA_AT.street.x, SA_AT.street.z)).toBe(0);
    expect(columnTop(m, SA_AT.b0.x, SA_AT.b0.z)).toBe(7.5); // 7.4 m facade top, rounded UP to the 0.25 m step
    expect(columnTop(m, SA_AT.b0door.x, SA_B0.z1 - 0.25)).toBe(7.5); // the doorway cells are the building's (its area): indoors
    expect(columnTop(m, SA_AT.tent.x, SA_AT.tent.z)).toBe(3); // the tent ridge 2.8 -> 3.0
    expect(columnTop(m, -5, -5)).toBe(0); // beyond the grid: the edge (street) columns continue
    expect(m.outdoorCells + m.indoorCells).toBe(m.w * m.h);
    expect(SURFACE_AIR.C).toBe(GAS.ROOF_OUTDOOR_C); // the Office roof's / Reactor sky's surface atmosphere
  });

  it('exposure == surfaceOutdoorGasAt == the march mirror (its own texture bytes + uniforms) at every sampled point; dense, GREEN, hurting', () => {
    const L = fixture();
    const {sys, atmo, eyeAt, air} = surfaceAirGame(L, mats);
    const m = surfaceOutdoorMap(L)!;
    const s = atmo.surfaceDebug();
    expect(s.compiled).toBe(true);
    expect(s.map).toBe(m);
    expect([...(s.texture!.image as {data: Uint8Array}).data]).toEqual([...m.top]); // the march samples the exposure's own bytes
    expect([s.texture!.minFilter, s.texture!.magFilter, s.texture!.format, s.texture!.generateMipmaps]).toEqual([THREE.NearestFilter, THREE.NearestFilter, THREE.RedFormat, false]);
    const d = atmo.depthDebug();
    expect(d.compiled && d.on).toBe(true);
    expect(d.outdoor).toEqual(m.gas);
    expect(d.look.ext).toBe(SURFACE_GAS_LOOK.ext);
    expect(sys.outdoorAir).not.toBe(null);
    // the street at eye height: full outdoor air, unprotected it hurts (the roof's numbers)
    const e = eyeAt(SA_AT.street.x, SA_AT.street.z);
    expect(e.c).toBeCloseTo(SURFACE_AIR.C, 9);
    expect(e.source).toBe('outdoor');
    expect(e.outdoor).toBeCloseTo(SURFACE_AIR.C, 9);
    expect(e.dps).toBeCloseTo(dpsAt(SURFACE_AIR.C), 9);
    expect(e.protected).toBe(false);
    expect(air.fog.k).toBeCloseTo(1, 6);
    // the same function drawn: street, kerb heights, open sky above the roofs, inside every sealed column (0), the doorway columns (0)
    const pts: [number, number, number][] = [];
    for (const x of [1, 5, 25, 28, 31, 52, 58]) for (const z of [1, 4, 23, 40]) for (const y of [-0.4, 0.3, 1.6, 4, 12]) pts.push([x, y, z]);
    for (const [x, z] of [[SA_AT.b0.x, SA_AT.b0.z], [SA_AT.b1.x, SA_AT.b1.z], [SA_AT.b2.x, SA_AT.b2.z], [SA_AT.tent.x, SA_AT.tent.z], [15, 19.75]]) for (const y of [0.2, 1.6, 2.9, 5, 7.4, 7.6, 9, 20]) pts.push([x, y, z]);
    let outdoors = 0, indoors = 0;
    for (const [x, y, z] of pts) {
      const want = surfaceOutdoorGasAt(m, x, y, z);
      expect(marchOutdoor(atmo, x, y, z), `march at ${x},${y},${z}`).toBeCloseTo(want, 9);
      expect(eyeAt(x, z, 0, y).outdoor, `exposure at ${x},${y},${z}`).toBeCloseTo(want, 9);
      if (want > 0.5) outdoors++;
      if (columnTop(m, x, z) > y + SURFACE_AIR.EDGE) { expect(want).toBe(0); indoors++; }
    }
    expect(outdoors).toBeGreaterThan(60);
    expect(indoors).toBeGreaterThan(12);
    // above a roof: outdoors again (open sky over B0)
    expect(marchOutdoor(atmo, SA_AT.b0.x, 8.5, SA_AT.b0.z)).toBeCloseTo(SURFACE_AIR.C, 9);
    // visibly green and dense across a street (the roof deck's look: the same outdoor atmosphere)
    expect(greenness(SURFACE_GAS_LOOK.tint)).toBeGreaterThan(1.2);
    expect(gasOpacity(SURFACE_GAS_LOOK, SURFACE_AIR.C, 20, SURFACE_GAS_LOOK.vis)).toBeGreaterThan(0.3);
    expect(gasOpacity(SURFACE_GAS_LOOK, SURFACE_AIR.C, 60, SURFACE_GAS_LOOK.vis)).toBeGreaterThan(0.7);
  });

  it('the march carries the term only in a district (other layouts: no column texture, the previous program key)', () => {
    const L = fixture();
    const a = new VolumetricAtmosphere(null, {flashlight: new THREE.SpotLight()}, 'high');
    a.setStation({...L, surface: undefined} as StationLayout, null);
    expect(a.surfaceDebug().compiled).toBe(false);
    expect(a.surfaceDebug().texture).toBe(null);
    expect(a.depthDebug().compiled).toBe(false);
    a.setStation(L, null);
    expect(a.surfaceDebug().compiled).toBe(true);
    const tex = a.surfaceDebug().texture!;
    a.setStation({...L, surface: undefined} as StationLayout, null);
    expect(a.surfaceDebug().texture).toBe(null); // disposed with the district (a new one per district world)
    expect(tex).not.toBe(null);
  });
});

describe('surface gas: sealed interiors stay clean; openings let the outdoor air in (hazard <-> visual parity)', () => {
  it('intact B0 (both storeys) and the tent: zero exposure, zero field, zero layer cells, zero outdoor term inside — after 30 s of play', () => {
    const L = fresh();
    const g = surfaceAirGame(L, mats);
    g.step(30);
    for (const [x, z, lv] of [[SA_AT.b0.x, SA_AT.b0.z, 0], [10, 8, 0], [20, 17, 0], [SA_AT.b0.x, SA_AT.b0.z, 1], [10, 8, 1], [SA_AT.tent.x, SA_AT.tent.z, 0], [11.8, 29.2, 0]] as const) {
      const e = g.eyeAt(x, z, lv), y = L.levels[lv].baseY + 1.6;
      expect(e.c, `exposure in a sealed room at ${x},${z} L${lv}`).toBe(0);
      expect(g.sys.field!.concentrationAt(x, y, z)).toBe(0);
      expect(marchOutdoor(g.atmo, x, y, z)).toBe(0);
      expect(drawnAt(g.atmo, x, y, z).layer).toBe(0);
    }
    expect(layerMax(g.atmo, 0, SA_B0)).toBe(0);
    expect(layerMax(g.atmo, 1, SA_B0)).toBe(0);
    expect(layerMax(g.atmo, 0, SA_TENT)).toBe(0);
    const f = g.sys.field as SurfaceGasField;
    expect(f).toBeInstanceOf(SurfaceGasField);
    expect(f.zones.find(z => z.spec.id === 'b0')!.field).toBe(null); // never breached: no field, no cost
    expect(f.zones.find(z => z.spec.id === 'tent')!.field).toBe(null);
  });

  it("GEN's broken pane (B1) and the smashed doorway (B2) are openings AT ARRIVAL: the rooms behind are gassed == the layers", () => {
    const L = fresh();
    const g = surfaceAirGame(L, mats, {at: {x: 41, z: 23}}); // between B1 and B2: both within the wake radius
    const pre = g.air.air!.prebreached;
    expect(pre.length).toBe(1); // the one 'broken' column of w2 (no transom: 1.5 m tall glazing)
    expect(g.sys.windows!.broken(pre[0])).toBe(true);
    expect(g.store.get(SURFACE_WINDOWS_LANE)).toBe(undefined); // first visit: seeded from the generated state (saved at teardown)
    for (const [x, z] of [[40, 7.2], [41, 9], [SA_AT.b2.x, 27], [41, 29.5], [SA_AT.b2.x, SA_AT.b2.z]] as const) {
      const e = g.eyeAt(x, z), y = 1.6, dr = drawnAt(g.atmo, x, y, z);
      expect(e.c, `gassed room at ${x},${z}`).toBeGreaterThan(GAS.THRESHOLD);
      expect(e.source).toBe('field');
      expect(e.c).toBeCloseTo(g.sys.field!.concentrationAt(x, y, z), 9);
      expect(e.outdoor).toBe(0); // the outdoor term never reaches inside: only the openings do
      expect(dr.slot).toBe(0);
      expect(Math.abs(dr.c - e.c), `drawn vs hazard at ${x},${z}`).toBeLessThan(0.02);
    }
    // a room never holds more than the outside air (breaches carry the outdoor strength)
    for (const z of g.sys.field!.storeys) for (const v of z.c) expect(v).toBeLessThanOrEqual(SURFACE_AIR.C + 1e-6);
    // the GREEN breach look (the Office benchmark) is dense over a few metres of that room
    expect(greenness(GAS.TINT)).toBeGreaterThan(1.2);
    expect(gasOpacity({ext: GAS.EXT, emission: GAS.EMISSION, tint: GAS.TINT}, g.eyeAt(41, 29.5).c, 4)).toBeGreaterThan(0.5);
  });

  it('a pane SHOT FROM THE STREET (real hitscan) breaks after 3 pistol hits; the room fills; exposure == concentrationAt == the layer', () => {
    const L = fresh();
    const g = surfaceAirGame(L, mats, {at: {x: 11, z: 3}});
    const o = {x: 10, y: 1.6, z: 3}, dir = {x: 0, y: 0, z: 1};
    const wh = raycastWorld(g.levels, L.props, o, dir, 20, -10);
    expect(wh.kind).toBe('wall');
    const point = new THREE.Vector3(o.x + dir.x * wh.t, o.y + dir.y * wh.t, o.z + dir.z * wh.t);
    expect(point.z).toBeCloseTo(SA_B0.z0, 3); // B0's north facade, street side
    const before = g.sys.counts.broken;
    let shots = 0;
    while (g.sys.counts.broken === before && shots < 6) { shots++; expect(g.sys.bulletHit(wh, point, new THREE.Vector3(0, 0, 1), shots, PANE_MAX_HP / 3 + 1e-6)).toBe(true); }
    expect(shots).toBe(3);
    const plan = g.air.air!.plans.find(p => p.index === 0)!;
    const id = paneId(plan, plan.panes.find(q => q.col === 0)!);
    expect(g.sys.windows!.broken(id)).toBe(true);
    expect(g.sys.bulletHit(wh, point, new THREE.Vector3(0, 0, 1), 9, 10)).toBe(true); // through the hole (no crater)
    // the boarded column takes a bullet like a wall (the damage system)
    const ob = {x: 12.4, y: 1.6, z: 3}, whb = raycastWorld(g.levels, L.props, ob, dir, 20, -10);
    expect(g.sys.bulletHit(whb, new THREE.Vector3(ob.x, ob.y, ob.z + whb.t), new THREE.Vector3(0, 0, 1), 10, 10)).toBe(false);
    // B0 was clean; now its north room fills from that pane while the player stands outside it
    g.step(20);
    let n = 0;
    for (const [x, z] of [[10, 7], [11, 8], [10.5, 9.5]] as const) {
      const e = g.eyeAt(x, z), dr = drawnAt(g.atmo, x, 1.6, z);
      expect(e.c, `after the break at ${x},${z}`).toBeGreaterThan(GAS.THRESHOLD);
      expect(e.c).toBeCloseTo(g.sys.field!.concentrationAt(x, 1.6, z), 9);
      expect(Math.abs(dr.c - e.c)).toBeLessThan(0.02);
      n++;
      g.place(11, 3);
    }
    expect(n).toBe(3);
    // the upper storey has its own (intact) glazing: still clean
    expect(g.eyeAt(10, 8, 1).c).toBe(0);
    expect(layerMax(g.atmo, 1, SA_B0)).toBe(0);
  });

  it('an OPENED door lets it in; SHUTTING it thins the room visibly as the hazard drops (exposure == layer all along, never a vanish)', () => {
    const L = fresh();
    const g = surfaceAirGame(L, mats, {at: {x: 15, z: 21.2}});
    const d = door(g, 'b0-e0');
    expect([d.plan.gen, d.t, d.target, d.gas]).toEqual(['closed', 0, 0, false]);
    // [E] from the street, facing the door (yaw 0 = looking toward -z)
    g.place(15, 21.2, 0, 0);
    g.step(0.1);
    expect(g.air.prompt()).toBe('<b>[E]</b> Open the door');
    expect(g.h.interactHandlers.some(f => f())).toBe(true);
    g.step(1);
    expect([d.t, d.target, d.gas]).toEqual([1, 1, true]);
    expect(d.auto).toBe(true); // opened in play: it would swing shut DOOR_RT.autoClose s after the doorway clears ...
    d.auto = false; // ... held open here (as if propped) while the room fills
    g.place(15, 23);
    g.step(20);
    const probe = {x: 15, z: 17.5};
    const e1 = g.eyeAt(probe.x, probe.z), dr1 = drawnAt(g.atmo, probe.x, 1.6, probe.z);
    expect(e1.c).toBeGreaterThan(GAS.THRESHOLD);
    expect(Math.abs(dr1.c - e1.c)).toBeLessThan(0.02);
    g.place(15, 23);
    // shut it (the auto-close would too after DOOR_RT.autoClose s clear): the source stops, what came in lingers and thins
    expect(g.air.close(d)).toBe(true);
    g.step(1);
    expect([d.t, d.gas]).toEqual([0, false]);
    // the room's peak (the doorway) never rises once the source stopped; the drawn peak follows it; the probe's exposure == its layer
    const zone = (g.sys.field as SurfaceGasField).zones.find(q => q.spec.id === 'b0')!;
    const peak = () => Math.max(0, ...zone.field!.storeys.map(st => st.stats().max));
    const series: {t: number; peak: number; drawn: number; c: number}[] = [];
    for (const t of [0, 5, 15, 30, 60]) {
      if (t) { g.place(15, 23); g.step(t - series[series.length - 1].t); }
      const e = g.eyeAt(probe.x, probe.z), dr = drawnAt(g.atmo, probe.x, 1.6, probe.z);
      expect(Math.abs(dr.c - e.c), `drawn vs hazard ${t} s after shutting`).toBeLessThan(0.02);
      series.push({t, peak: peak(), drawn: layerMax(g.atmo, 0, SA_B0), c: e.c});
      g.place(15, 23);
    }
    expect(series[0].peak).toBeGreaterThan(0.15); // still there right after shutting (no vanish)
    expect(series[0].drawn).toBeGreaterThan(0.15);
    for (let i = 1; i < series.length; i++) {
      expect(series[i].peak, `thinning at ${series[i].t} s`).toBeLessThan(series[i - 1].peak);
      expect(series[i].drawn).toBeLessThanOrEqual(series[i - 1].drawn);
    }
    expect(series[1].peak).toBeGreaterThan(GAS.HUD_MIN); // lingering, visibly (and on the HUD), for a while
    expect(series[2].drawn).toBeGreaterThan(0.02);
    expect(series[series.length - 1].peak).toBeLessThan(GAS.THRESHOLD); // the hazard has dropped below the damage threshold within a minute
    expect(series[series.length - 1].c).toBeLessThan(GAS.HUD_MIN);
    // and fades on toward nothing
    g.place(15, 23);
    g.step(240, 0.25);
    expect(peak()).toBeLessThan(0.03);
  });
});

describe('surface gas: the truck cab, the mask, the in-engine fallback', () => {
  it('the enclosed cab (follow-up 1): seated — exposure 0 AND no gas drawn inside the cab volume; beyond its glass the fog = the hazard there', () => {
    const L = fresh();
    const g = surfaceAirGame(L, mats, {at: {x: 41, z: 23}});
    const map = surfaceOutdoorMap(L)!;
    // the REAL truck's cab (world/surface/truckSpec.ts = the measured anchors): its interior volume and seated eye, the vehicle's frame
    const I = TRUCK_SPEC.interior, E = TRUCK_SPEC.eye;
    expect(g.car.spec.interior).toBe(I);
    const mid = {x: (I.x0 + I.x1) / 2, y: (I.y0 + I.y1) / 2, z: (I.z0 + I.z1) / 2};
    const hx = (I.x1 - I.x0) / 2, hy = (I.y1 - I.y0) / 2, hz = (I.z1 - I.z0) / 2;
    expect(E.x > I.x0 && E.x < I.x1 && E.y > I.y0 && E.y < I.y1 && E.z > I.z0 && E.z < I.z1).toBe(true); // (the seated eye is in its cab)
    // game.ts: only an ENCLOSED vehicle seat shelters (the vehicle controller's `enclosed`: seated, in a vehicle whose def is enclosed)
    const src = fs.readFileSync(path.join(GAME, 'src/game.ts'), 'utf8');
    expect(src).toMatch(/this\.gas\.shelter = \(\) => this\.skywaysCar\?\.enclosed === true;/);
    g.sys.shelter = () => g.car.driving && g.car.enclosed === true; // (the same, on the stand-in: its `enclosed` is the def's flag)
    // the truck on the street between B0 / B1 / B2, turned (the vehicle frame: -z forward); level, and pitched as a seat on a flight is
    for (const pitch of [0, 0.3]) {
      const body = {x: 28, y: 0, z: 31.5, yaw: 0.6, pitch};
      // the seat's own convention (world/skywaysCar.ts writePlayer; the body group's 'YXZ' turn): the pitch about the lateral axis, then the yaw
      const toWorld = (lx: number, ly: number, lz: number) => {
        const cp = Math.cos(pitch), sp = Math.sin(pitch), w = carToWorld(body.x, body.z, body.yaw, lx, ly * sp + lz * cp);
        return {x: w.x, y: body.y + ly * cp - lz * sp, z: w.z};
      };
      const eye = toWorld(E.x, E.y, E.z);
      expect(outdoorColumn(map, eye.x, eye.z)).toBe(true);
      g.car.driving = false;
      g.atmo.syncCab();
      const out = {...g.eyeAt(eye.x, eye.z, 0, eye.y)};
      expect(out.c).toBeCloseTo(SURFACE_AIR.C, 9); // standing there: the outdoor air
      // seated in the ENCLOSED cab
      Object.assign(g.car, {driving: true, enclosed: true, body});
      g.atmo.syncCab(); // (each frame's uniform sync)
      const cab = g.air.cab()!;
      expect(cab).not.toBe(null);
      expect(cab.pitch).toBe(pitch);
      expect(inCab(cab, eye.x, eye.y, eye.z)).toBe(true);
      const seated = g.eyeAt(eye.x, eye.z, 0, eye.y);
      expect([seated.c, seated.dps, seated.source, seated.outdoor], `seated, pitch ${pitch}`).toEqual([0, 0, null, 0]);
      // the march's cab uniforms are THIS cab; the CPU mirror of the march along each camera ray (the cab span cut x the outdoor term)
      const U = g.atmo.surfaceDebug().cabUniforms;
      expect(U).toEqual([cab.x, cab.y, cab.z, cab.yaw, cab.hx, cab.hy, cab.hz, cab.pitch]);
      const uCab = {x: U[0], y: U[1], z: U[2], yaw: U[3], hx: U[4], hy: U[5], hz: U[6], pitch: U[7]};
      const drawnAlongRay = (p: {x: number; y: number; z: number}) => {
        const dx = p.x - eye.x, dy = p.y - eye.y, dz = p.z - eye.z, t = Math.hypot(dx, dy, dz);
        const span = cabRaySpan(uCab, eye, {x: dx / t, y: dy / t, z: dz / t});
        return (span && t >= span[0] && t <= span[1] ? 0 : 1) * marchOutdoor(g.atmo, p.x, p.y, p.z);
      };
      let inside = 0;
      for (const fx of [-0.95, -0.5, 0, 0.5, 0.95]) for (const fy of [-0.95, 0, 0.95]) for (const fz of [-0.95, -0.5, 0, 0.5, 0.95]) {
        const p = toWorld(mid.x + fx * hx, mid.y + fy * hy, mid.z + fz * hz), at = `${fx},${fy},${fz} (pitch ${pitch})`;
        expect(inCab(cab, p.x, p.y, p.z), at).toBe(true);
        // what the eye would breathe there (the ONE outdoor source) and what the march draws there: both clean
        expect(g.sys.outdoorAir!.gasAt(p.x, p.y, p.z), `breathed in the cab at ${at}`).toBe(0);
        expect(drawnAlongRay(p), `drawn in the cab at ${at}`).toBe(0);
        expect(marchOutdoor(g.atmo, p.x, p.y, p.z)).toBeGreaterThan(0); // (without the cut it would be gassy: the cut does the work)
        inside++;
      }
      expect(inside).toBe(75);
      // beyond the glass (0.3 m and 2 m out of every side and the roof): the fog drawn == the hazard there == what standing there breathes
      let outside = 0;
      for (const [ax, ay, az] of [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0]] as const) for (const gap of [0.3, 2]) {
        const p = toWorld(mid.x + ax * (hx + gap), mid.y + ay * (hy + gap), mid.z + az * (hz + gap)), at = `${ax},${ay},${az} +${gap} (pitch ${pitch})`;
        expect(inCab(cab, p.x, p.y, p.z), at).toBe(false);
        const hazard = surfaceOutdoorGasAt(map, p.x, p.y, p.z);
        expect(hazard, `street air at ${at}`).toBeCloseTo(SURFACE_AIR.C, 6);
        expect(drawnAlongRay(p), `drawn at ${at}`).toBeCloseTo(hazard, 6);
        expect(g.sys.outdoorAir!.gasAt(p.x, p.y, p.z)).toBeCloseTo(hazard, 9);
        outside++;
      }
      expect(outside).toBe(10);
      // the glass panes sit on the cab box's faces (within a few cm): no gassy sliver is left between the cut and the glass
      for (const gl of TRUCK_ANCHORS.glass) {
        const n = Math.abs(gl.n[0]) > Math.abs(gl.n[2]) ? 'x' : 'z', face = n === 'x' ? (gl.n[0] < 0 ? I.x0 : I.x1) : (gl.n[2] < 0 ? I.z0 : I.z1);
        const lo = n === 'x' ? gl.x0 : gl.z0, hi = n === 'x' ? gl.x1 : gl.z1;
        expect(Math.min(Math.abs(lo - face), Math.abs(hi - face), lo <= face && face <= hi ? 0 : Infinity), gl.name).toBeLessThan(0.05);
      }
    }
    // the scene fog is distance fog: over the cab's few metres it is nothing (the outdoor murk is what is seen through the glass)
    const fog = g.h.scene.fog as THREE.FogExp2, far = 2 * Math.hypot(hx, hy, hz);
    expect(1 - Math.exp(-((fog.density * far) ** 2))).toBeLessThan(0.01);
    expect(g.air.fog.k).toBeGreaterThan(0.99);
    // stepping out: exposed again, the cut gone
    const eye = {x: g.h.player.x, y: g.h.player.eye, z: g.h.player.z};
    g.car.driving = false;
    g.atmo.syncCab();
    expect(g.air.cab()).toBe(null);
    expect(g.atmo.surfaceDebug().cabUniforms.slice(4)).toEqual([0, 0, 0, 0]); // (off: hx = 0)
    expect(g.eyeAt(eye.x, eye.z, 0, eye.y).c).toBeCloseTo(SURFACE_AIR.C, 9);
    // an OPEN vehicle seat (not enclosed) never shelters
    Object.assign(g.car, {driving: true, enclosed: undefined});
    g.atmo.syncCab();
    expect(g.air.cab()).toBe(null);
    expect(g.eyeAt(eye.x, eye.z, 0, eye.y).c).toBeCloseTo(SURFACE_AIR.C, 9);
    g.teardown();
    expect(g.atmo.surfaceDebug().cab).toBe(null);
  });

  it('a worn mask with a filter: dps 0, protected — the exposure value, the march, the layer and the scene fog unchanged', () => {
    const L = fresh();
    const g = surfaceAirGame(L, mats, {at: {x: 41, z: 23}});
    for (const [x, z] of [[28, 23], [41, 29.5]] as const) {
      const bare = {...g.eyeAt(x, z)}, fogK = g.air.fog.k, dr = drawnAt(g.atmo, x, 1.6, z), mo = marchOutdoor(g.atmo, x, 1.6, z);
      expect(bare.dps).toBeGreaterThan(0);
      g.sys.protection = () => true;
      const masked = g.eyeAt(x, z);
      expect(masked.protected).toBe(true);
      expect(masked.dps).toBe(0);
      expect(masked.c).toBe(bare.c);
      expect(g.air.fog.k).toBe(fogK);
      expect(drawnAt(g.atmo, x, 1.6, z)).toEqual(dr);
      expect(marchOutdoor(g.atmo, x, 1.6, z)).toBe(mo);
      g.sys.protection = () => false;
    }
  });

  it('pass OFF: the outdoor murk is in the scene fog (green, never thinner) by the same weight; sealed rooms get the base back; gassed rooms use the existing fallback', () => {
    const L = fresh();
    const g = surfaceAirGame(L, mats, {active: false, at: {x: 41, z: 23}});
    const fog = g.h.scene.fog as THREE.FogExp2;
    const base = {color: [fog.color.r, fog.color.g, fog.color.b] as [number, number, number], density: fog.density};
    g.eyeAt(28, 23);
    expect(g.air.fog.k).toBeCloseTo(1, 6);
    expect(greenness([fog.color.r, fog.color.g, fog.color.b])).toBeGreaterThan(1.2);
    expect(fog.density).toBeGreaterThanOrEqual(Math.max(base.density, ROOF_FOG.density));
    const want = surfaceFogAt(1, base);
    expect(fog.color.r).toBeCloseTo(want.color[0], 6);
    expect(fog.color.g).toBeCloseTo(SURFACE_FOG.color[1], 6);
    expect(g.sys.exposure.fallback).toBe(0); // (the roof rule: the outdoor murk IS the scene fog; the fallback haze is for the field)
    // half way up a kerb ramp / the doorway edge: the same weight as the exposure
    const k = outdoorWeight(surfaceOutdoorMap(L)!, 28, 1.6, 23);
    expect(g.air.fog.k).toBeCloseTo(k, 6);
    // into sealed B0: the base fog back exactly
    g.eyeAt(SA_AT.b0.x, SA_AT.b0.z);
    expect(g.air.fog.k).toBe(0);
    expect([fog.color.r, fog.color.g, fog.color.b]).toEqual(base.color);
    expect(fog.density).toBe(base.density);
    // into gassed B2 (smashed doorway): the field's in-engine fallback (the existing GASLIGHT path)
    const e = g.eyeAt(SA_AT.b2.x, 29.5);
    expect(e.source).toBe('field');
    expect(e.fallback).toBe(e.c);
    expect(e.fallback).toBeGreaterThan(GAS.THRESHOLD);
    // a base someone else writes (the district look / a mood change) is adopted, ours re-applied over it
    g.eyeAt(28, 23);
    fog.density = 0.05;
    g.eyeAt(28, 23.1);
    expect(fog.density).toBe(0.05);
    expect(greenness([fog.color.r, fog.color.g, fog.color.b])).toBeGreaterThan(1.2);
    // the teardown restores the base
    g.teardown();
    expect(fog.density).toBe(0.05);
  });
});

describe('surface doors: state, collision, [E], enemies, auto-close, persistence', () => {
  it('plans every leafed doorway (smashed = a permanent opening, no leaf / box), boxes in the index + layout.props (the tent flap: walking only)', () => {
    const L = fresh();
    const g = surfaceAirGame(L, mats);
    const doors = g.air.air!.doors;
    expect(doors.map(d => [d.plan.id, d.plan.gen, d.plan.leaves.length]).sort()).toEqual([['b0-e0', 'closed', 2], ['b1-e0', 'closed', 2], ['b2-e0', 'smashed', 0], ['tent', 'closed', 1]].sort());
    const b0 = door(g, 'b0-e0'), tent = door(g, 'tent'), b2 = door(g, 'b2-e0');
    expect(b0.plan.c).toBe(SA_B0.z1); // the leaf hangs in the facade wall, the doorway's own record
    expect(tent.plan.width).toBeCloseTo(1.5, 9); // GEN's 3-cell flap doorway, read from the grid
    expect(tent.plan.cells.length).toBe(3);
    expect(b2.boxes.length).toBe(0);
    expect(b2.gas).toBe(true); // a permanent opening
    for (const d of [b0, tent]) {
      expect(d.boxes[0].h).toBeGreaterThan(1.5); // shut: the doorway box
      expect(d.boxes.slice(1).every(b => b.h === 0)).toBe(true);
      expect(d.boxes.every(b => g.h.propIndex.props.includes(b))).toBe(true);
    }
    expect(b0.boxes.every(b => L.props.includes(b))).toBe(true); // bullets stop at a shut steel door
    expect(tent.boxes.some(b => L.props.includes(b))).toBe(false); // canvas: never a bullet stop
    // the player is held back by the shut leaf (physics against the index)
    const [, zz] = resolveCircle(g.levels, g.h.propIndex, 15, SA_B0.z1, 0.3, 0);
    expect(zz).toBeGreaterThan(SA_B0.z1 - DOOR_RT.inset + DOOR_RT.thick + 0.3 - 1e-3); // pushed back onto the street side of the shut leaf
    // the leaves: one pivot each, in the scene, the warm-up pool
    const view = g.air.air!.doorView!;
    expect(view.leaves.flat().length).toBe(5); // two double doors (2 m) + the single flap
    expect(g.h.warmRegistry.addPool).toHaveBeenCalledWith('surface-air', expect.any(Function));
    // teardown: boxes out of layout.props, the index restored, leaves gone, outdoor air cleared
    const n0 = L.props.length, mine = g.air.air!.layoutBoxes.length;
    expect(mine).toBe(b0.boxes.length + door(g, 'b1-e0').boxes.length);
    g.teardown();
    expect(L.props.length).toBe(n0 - mine);
    expect(L.props.some(p => b0.boxes.includes(p))).toBe(false);
    expect(g.air.air).toBe(null);
    expect(g.sys.outdoorAir).toBe(null);
  });

  it('an architecture-drawn tent flap (tentFlap): no flap leaf of ours, the seam follows the swing; state, box and gas stay here', () => {
    const L = fresh();
    const seen: number[] = [];
    const g = surfaceAirGame(L, mats, {at: {x: SA_AT.tent.x + 4, z: SA_AT.tent.z}, tentFlap: v => seen.push(v)});
    expect(g.air.air!.doorView!.leaves.flat().length).toBe(4); // the two double doors only
    const tent = door(g, 'tent');
    g.step(0.1);
    expect(seen.at(-1)).toBe(0); // hanging shut
    expect(tent.boxes[0].h).toBeGreaterThan(1.5);
    expect(g.air.open(tent, 'qa')).toBe(true);
    g.step(1);
    expect(seen.at(-1)).toBe(1); // tied open
    expect(tent.gas).toBe(true);
    expect(tent.boxes[0].h).toBe(0);
    tent.auto = false;
    g.place(SA_AT.street.x, SA_AT.street.z); // (well clear of the doorway)
    expect(g.air.close(tent)).toBe(true);
    g.step(1);
    expect(seen.at(-1)).toBe(0);
    expect(tent.gas).toBe(false);
    g.teardown();
  });

  it('[E] opens / shuts, the swing swaps the boxes; never shuts on a body; enemies push a shut door open; a door opened in play swings shut once clear', () => {
    const L = fresh();
    const g = surfaceAirGame(L, mats, {at: {x: 41, z: 21.5}});
    const d = door(g, 'b1-e0');
    g.place(41, 21.2, 0, 0);
    g.step(0.1);
    expect(g.air.target).toBe(d);
    g.air.interact();
    g.step(DOOR_RT.time / 2);
    expect(d.t).toBeGreaterThan(0.3);
    g.step(DOOR_RT.time);
    expect(d.t).toBe(1);
    expect(d.boxes[0].h).toBe(0);
    expect(d.boxes.slice(1).every(b => b.h > 2)).toBe(true);
    expect(g.h.physics.propsChanged).toHaveBeenCalled();
    expect(g.air.prompt()).toBe('<b>[E]</b> Close the door');
    // standing in the doorway: refused (a toast), the door stays open
    g.place(41, SA_B0.z1 - 0.25, 0, 0);
    g.step(0.1);
    expect(g.air.close(d)).toBe(false);
    expect(g.air.counts.refusals).toBe(1);
    // auto-close waits for a clear doorway, then swings shut by itself
    g.step(DOOR_RT.autoClose + 1);
    expect(d.target).toBe(1);
    g.place(41, 24);
    g.step(DOOR_RT.autoClose + DOOR_RT.time + 0.5);
    expect(d.t).toBe(0);
    expect(g.air.counts.autoCloses).toBe(1);
    // a zombie walking into the doorway while it closes: it swings open again
    g.air.open(d);
    g.step(DOOR_RT.time + 0.1);
    g.place(41, 24);
    g.air.close(d);
    g.step(0.1);
    const z = {brain: {x: 41, z: SA_B0.z1 - 0.3, y: 0, alive: true, stats: {radius: 0.35}}};
    g.h.zombies.push(z);
    g.step(0.2);
    expect(d.target).toBe(1);
    expect(g.air.counts.reopens).toBeGreaterThanOrEqual(1);
    g.h.zombies.length = 0;
    g.air.close(d);
    g.step(DOOR_RT.time + 0.1);
    expect(d.t).toBe(0);
    // an enemy pressing on the shut leaf from the street pushes it open after DOOR_RT.pushOpen s
    const p = {brain: {x: 41, z: SA_B0.z1 - DOOR_RT.inset + 0.35 + 0.05, y: 0, alive: true, stats: {radius: 0.35}}};
    g.h.zombies.push(p);
    g.step(DOOR_RT.pushOpen - 0.3);
    expect(d.target).toBe(0);
    g.step(0.5);
    expect(d.target).toBe(1);
    expect(g.air.counts.pushOpens).toBe(1);
    // a dead one never does
    g.h.zombies.length = 0;
  });

  it('district memory: doors and panes survive a revisit (never re-seeded); an open door replays its gas aged; invalid records fall back', () => {
    const L = fresh(), store = new Map<string, unknown>();
    const g = surfaceAirGame(L, mats, {store, at: {x: 15, z: 23}});
    const d = door(g, 'b0-e0');
    g.air.open(d);
    g.step(7); // (below the auto-close: still open at the teardown)
    const pre = g.air.air!.prebreached[0];
    g.teardown();
    const rec = store.get(SURFACE_DOORS_LANE) as {v: number; doors: Record<string, {open: number; age?: number}>};
    expect(rec.v).toBe(1);
    expect(rec.doors['b0-e0'].open).toBe(1);
    expect(rec.doors['b0-e0'].age).toBeCloseTo(7, 0);
    expect(rec.doors['b1-e0']).toEqual({open: 0});
    expect(rec.doors['b2-e0']).toBe(undefined); // smashed: generated, never stored
    const win = store.get(SURFACE_WINDOWS_LANE) as {broken: Record<string, number>};
    expect(Object.keys(win.broken)).toEqual([pre]);
    // the revisit: a NEW world of the same district (its own layout object), the same memory
    const L2 = fresh();
    const g2 = surfaceAirGame(L2, mats, {store, at: {x: 15, z: 23}});
    const d2 = door(g2, 'b0-e0');
    expect([d2.t, d2.target, d2.gas, d2.auto]).toEqual([1, 1, true, false]); // found open: stays open (no auto-close after a rebuild)
    expect(g2.sys.windows!.broken(pre)).toBe(true);
    expect(Object.keys((g2.sys.windows!.save(g2.h.clock) as {broken: Record<string, number>}).broken)).toEqual([pre]);
    // the aged door gas is there at arrival (settled behind the loading screen)
    expect(g2.eyeAt(SA_AT.b0door.x, SA_AT.b0door.z).c).toBeGreaterThan(GAS.THRESHOLD);
    // invalid / unknown entries: the generated state
    const plan = d2.plan;
    expect(restoredDoor(plan, {v: 2, doors: {'b0-e0': {open: 1}}})).toEqual({open: false, age: 0, auto: false});
    expect(restoredDoor(plan, {v: 1, doors: {'b0-e0': {open: 'yes'}}})).toEqual({open: false, age: 0, auto: false});
    expect(restoredDoor({...plan, gen: 'open'}, null)).toEqual({open: true, age: GAS.AGE_CAP_S, auto: false});
    expect(restoredDoor(plan, {v: 1, doors: {'b0-e0': {open: 1, age: 1e9}}}).age).toBe(GAS.AGE_CAP_S);
  });
});

describe('surface gas: the march surface variant fits WebGPU\'s default per-stage limits (no new uniform buffer) on both backends', () => {
  const WEBGPU_DEFAULT = {uniformBuffers: 12, sampledTextures: 16} as const;
  const wgsl = (src: string) => ({uniformBuffers: (src.match(/var<uniform>/g) ?? []).length, textures: (src.match(/^@binding\(.*\) var \w+ : texture_/gm) ?? []).length});
  const glsl = (src: string) => ({uniformBuffers: (src.match(/^(layout\(\s*std140\s*\)\s*)?uniform\s+\w+\s*\{/gm) ?? []).length,
    textures: (src.match(/^uniform\s+(highp\s+|mediump\s+|lowp\s+)?\w*sampler\w*\s+\w+;/gm) ?? []).length});
  const textures = (shadow: boolean, outdoor: boolean) => {
    const sh = new THREE.DepthTexture(8, 8);
    sh.compareFunction = THREE.LessEqualCompare;
    const arr = (c: number) => new THREE.DataArrayTexture(new Uint8Array(4 * c), 1, 1, 4);
    const gas = new THREE.DataArrayTexture(new Uint8Array(4 * 4 * 3), 4, 4, 3);
    gas.format = THREE.RedFormat;
    return {depth: new THREE.DepthTexture(8, 8), noise: new THREE.Data3DTexture(new Uint8Array(64), 2, 2, 4), density: arr(4), air: arr(1), vis: arr(1), shadow: shadow ? sh : null, gas,
      ...(outdoor ? {outdoor: outdoorMapTexture(new Uint8Array(16), 4, 4)} : {})};
  };
  it('surface = depth + one sampled texture, the same uniform buffers, inside the limits (shadow x steps x backend)', () => {
    for (const backend of ['wgsl', 'glsl'] as const) {
      const count = backend === 'wgsl' ? wgsl : glsl;
      for (const shadow of [false, true]) for (const steps of [ATMOSPHERE_QUALITY.low.steps, ATMOSPHERE_QUALITY.high.steps]) {
        const depth = compileQuad(createMarchMaterial(createFogUniforms(), textures(shadow, false), {steps, depth: true}), backend);
        const surf = compileQuad(createMarchMaterial(createFogUniforms(), textures(shadow, true), {steps, depth: true, surface: true}), backend);
        expect(surf.fragment).toContain(VF_SURFACE_MARK);
        expect(surf.fragment).toContain(VF_CAB_MARK); // (follow-up 1: the sealed cab's span, two plain uniforms of the shared group)
        expect(surf.fragment).toContain(VF_DEPTH_MARK);
        expect(depth.fragment).not.toContain(VF_SURFACE_MARK);
        expect(depth.fragment).not.toContain(VF_CAB_MARK);
        const a = count(depth.fragment), b = count(surf.fragment), tag = `${backend} shadow=${shadow} steps=${steps}`;
        expect(b.uniformBuffers, `${tag}: no new uniform buffer`).toBe(a.uniformBuffers);
        expect(b.textures, `${tag}: + the column map`).toBe(a.textures + 1);
        expect(b.uniformBuffers).toBeLessThanOrEqual(WEBGPU_DEFAULT.uniformBuffers);
        expect(b.textures).toBeLessThanOrEqual(WEBGPU_DEFAULT.sampledTextures);
        const v = count(surf.vertex);
        expect(v.uniformBuffers).toBeLessThanOrEqual(WEBGPU_DEFAULT.uniformBuffers);
      }
    }
  });
  it('the surface flag without depth is ignored (the base program exactly)', () => {
    const base = compileQuad(createMarchMaterial(createFogUniforms(), textures(false, true), {steps: 24}), 'wgsl').fragment;
    const flag = compileQuad(createMarchMaterial(createFogUniforms(), textures(false, true), {steps: 24, surface: true}), 'wgsl').fragment;
    expect(flag).not.toContain(VF_SURFACE_MARK);
    expect(flag).not.toContain(VF_CAB_MARK);
    expect(wgsl(flag)).toEqual(wgsl(base));
  });
});
