import {afterAll, describe, expect, it, vi} from 'vitest';
import * as THREE from 'three';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {generateSurfaceLevel} from '../src/gen/surface/index';
import type {StationLayout} from '../src/gen/stationTypes';
import type {SectionKey} from '../src/levels/types';
import type {WorldMaterials} from '../src/world/materials';
import {drawSurfaceMap, exploreSurface, readSurfaceExploration, surfaceExplorationProblem, surfaceMapState, SURFACE_EXPLORATION_LANE} from '../src/ui/surfaceMap';
import {installSurfaceRun, surfaceAccessDoorPose, type SurfaceRunHost} from '../src/world/surface/runtime';
import {SurfaceSectors} from '../src/world/surface/sectors';
import {SURFACE_CITY_MODEL_KEYS} from '../src/world/surface/city';
import {installCanvasShim} from './helpers/canvas2d';

const uninstall = installCanvasShim(false);
afterAll(uninstall);
const layout = generateSurfaceLevel({levelSeed: 93, surfaceVersion: 1}, 'subway');
const info = layout.surface!;

describe('Surface Run military map follows the real local layout', () => {
  it('contains exactly the actual streets/destinations, live positions and only entered places', () => {
    const player = {x: info.checkpoint.return.x, z: info.checkpoint.return.z, yaw: 0, privateField: 'not map intel'};
    const truck = {x: info.truck.x, z: info.truck.z, yaw: info.truck.yaw};
    const explored = readSurfaceExploration({blocks: ['A1', 'NOT-A-BLOCK', 'A1'], destinations: ['SR-00', 'GLOBAL-SECRET']}, info);
    expect(explored).toEqual({v: 1, blocks: ['A1'], destinations: ['SR-00']});
    const map = surfaceMapState(info, explored, player, truck);
    expect(map.roads).toEqual(info.roads);
    expect(map.destinations.map(d => [d.id, d.x, d.z, d.intel])).toEqual(info.destinations.map(d => [d.id, d.entrance.x, d.entrance.z, d.intel]));
    expect(map.player).toEqual({x: player.x, z: player.z, yaw: 0});
    expect(map.truck).toEqual(truck);
    expect(map.destinations.filter(d => d.explored).map(d => d.id)).toEqual(['SR-00']);
    const target = info.destinations[1];
    player.x = target.x + target.w / 2; player.z = target.z + target.d / 2;
    expect(exploreSurface(explored, info, player)).toBe(true);
    expect(explored.destinations).toContain(target.id);
    expect(exploreSurface(explored, info, player)).toBe(false);
    truck.x += 17;
    expect(surfaceMapState(info, explored, player, truck).truck?.x).toBe(truck.x);
    const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 930;
    expect(() => drawSurfaceMap(canvas.getContext('2d')!, surfaceMapState(info, explored, player, truck))).not.toThrow();
  });

  it('rejects malformed or growing exploration records while remaining bounded by64blocks/16destinations', () => {
    const valid = {v: 1, blocks: info.blocks.map(b => b.id), destinations: info.destinations.map(d => d.id)};
    expect(surfaceExplorationProblem(valid)).toBeNull();
    for (const bad of [{...valid, v: 2}, {...valid, blocks: ['A1', 'A1']}, {...valid, destinations: ['SR-16']}, {...valid, blocks: ['I1']}, {...valid, campaign: true}]) expect(surfaceExplorationProblem(bad)).not.toBeNull();
    expect(readSurfaceExploration({blocks: new Array(1000).fill('A1'), destinations: new Array(1000).fill('SR-01')}, info)).toEqual({v: 1, blocks: ['A1'], destinations: ['SR-01']});
  });
});

describe('Surface Run bounded sectors', () => {
  it('keeps camera AND off-camera torch-shadow sectors, hides distant/inactive sectors without changing gameplay state', () => {
    const sectors = new SurfaceSectors();
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 200); camera.position.y = 1.6; camera.lookAt(0, 1.6, -10);
    const shadow = new THREE.PerspectiveCamera(50, 1, 0.1, 120); shadow.position.y = 1.6; shadow.lookAt(0, 1.6, 10);
    const groups = [-30, 30, 180].map((z, i) => {const g = new THREE.Group(); const m = new THREE.Mesh(new THREE.BoxGeometry(4, 5, 4)); m.position.set(0, 2.5, z); g.add(m); sectors.add(String(i), g); return g;});
    sectors.update(camera, 0.016, true);
    expect(groups.map(g => g.visible)).toEqual([true, false, false]);
    sectors.update(camera, 0.016, true, shadow);
    expect(groups.map(g => g.visible)).toEqual([true, true, false]);
    const updates = sectors.stats.updates;
    sectors.update(camera, 0.016, false, shadow);
    expect(groups.every(g => !g.visible)).toBe(true); expect(sectors.stats.updates).toBe(updates);
    sectors.clear(); expect(sectors.stats.total).toBe(0);
    for (const g of groups) g.traverse(o => {if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).geometry.dispose();});
  });
});

function host() {
  const camera = new THREE.PerspectiveCamera(65, 16 / 9, 0.1, 80), scene = new THREE.Scene();
  const originalBackground = new THREE.Color(0x010203); scene.background = originalBackground; scene.fog = new THREE.FogExp2(0x090b0a, 0.043);
  const geometry = new THREE.BoxGeometry(1, 1, 1), material = new THREE.MeshStandardMaterial({map: new THREE.Texture()});
  const modelScene = new THREE.Group(); modelScene.add(new THREE.Mesh(geometry, material));
  const gltf = {scene: modelScene} as GLTF;
  const lanes = new Map<string, unknown>(), requests: string[] = [], pools = new Map<string, () => readonly THREE.Object3D[]>();
  const key = (lane: string, section: SectionKey) => `${section.station ?? section.level}:${section.section}:${lane}`;
  const h: SurfaceRunHost = {
    scene, camera, layout, state: 'playing', mats: {get: () => material} as unknown as WorldMaterials,
    player: {x: info.checkpoint.return.x, y: 0, z: info.checkpoint.return.z, yaw: 0, alive: true},
    propModels: {get: id => SURFACE_CITY_MODEL_KEYS.includes(id as typeof SURFACE_CITY_MODEL_KEYS[number]) ? gltf : undefined},
    world: {culler: {maxDistance: 43}}, skywaysCar: {driving: false, body: {...info.truck}},
    run: {current: {level: 'subway', station: 'st-07', section: 'surface'},
      laneStore: (lane, section = h.run.current) => lanes.get(key(lane, section)) as never,
      setLaneStore: (lane, value, section = h.run.current) => {lanes.set(key(lane, section), structuredClone(value));}},
    surfaceTravel: async section => {requests.push(section); return {ok: true};}, hud: {toast: () => {}},
    frameHooks: [], sectionHooks: [], sectionModelKeys: [], promptProviders: [], interactHandlers: [], inputOwners: [], stateListeners: [],
    warmRegistry: {addPool: (name, roots) => {pools.set(name, roots);}},
  };
  camera.position.set(h.player.x, 1.7, h.player.z); camera.lookAt(h.player.x, 1.7, h.player.z - 10); camera.updateMatrixWorld();
  return {h, lanes, requests, pools, originalBackground, geometry, material, key};
}

describe('Surface Run section runtime', () => {
  it('keeps hidden warm-up sectors available, then explicitly culls the prepared final camera/torch view', () => {
    const {h, geometry, material} = host(); h.warming = true;
    const light = new THREE.SpotLight(0xffffff, 1, 100, Math.PI / 6);
    light.position.copy(h.camera.position); light.target.position.set(h.player.x, 1.7, h.player.z + 50);
    h.flashlight = light; h.scene.add(light, light.target);
    const shadowUpdates = vi.spyOn(light.shadow, 'updateMatrices');
    const rt = installSurfaceRun(h); rt.build(layout);
    const sectors = rt.city!.sectors;
    expect(sectors.sectors).toHaveLength(64);
    expect(sectors.sectors.every(s => s.root.visible)).toBe(true);
    rt.beforeRender();
    expect(sectors.stats.updates).toBe(0); expect(shadowUpdates).not.toHaveBeenCalled();
    expect(sectors.sectors.every(s => s.root.visible)).toBe(true);
    rt.beforeRender(true);
    expect(h.warming).toBe(true); expect(sectors.stats.updates).toBe(1);
    expect(shadowUpdates).toHaveBeenCalledExactlyOnceWith(light);
    expect(sectors.stats.visible).toBeGreaterThan(0); expect(sectors.stats.visible).toBeLessThan(64);
    const finalVisibility = sectors.sectors.map(s => s.root.visible);
    rt.beforeRender();
    expect(sectors.stats.updates).toBe(1); expect(sectors.sectors.map(s => s.root.visible)).toEqual(finalVisibility);
    // The prepared finish view uses the same bounded cull as the following real gameplay frame.
    h.warming = false; rt.beforeRender();
    expect(sectors.stats.updates).toBe(2); expect(sectors.sectors.map(s => s.root.visible)).toEqual(finalVisibility);
    rt.teardown(); light.dispose(); geometry.dispose(); material.dispose();
  });

  it('owns64sectors only while outside, restores atmosphere, saves to the old section key and leaves shared asset resources intact', () => {
    const {h, lanes, pools, originalBackground, geometry, material, key} = host();
    let sourceDisposed = 0; geometry.addEventListener('dispose', () => {sourceDisposed++;}); material.addEventListener('dispose', () => {sourceDisposed++;});
    const rt = installSurfaceRun(h); rt.build(layout);
    expect(rt.city?.stats.sectors).toBe(64); expect(rt.city?.stats.missing).toEqual([]);
    expect(h.sectionModelKeys![0](layout)).toEqual(SURFACE_CITY_MODEL_KEYS);
    expect(pools.get('surface-run-city')!()).toEqual([rt.city!.root]);
    expect(h.camera.far).toBe(160); expect((h.scene.fog as THREE.FogExp2).density).toBe(0.016);
    const city = rt.city!, destination = info.destinations[0];
    h.player.x = destination.x + destination.w / 2; h.player.z = destination.z + destination.d / 2; rt.frame(0.3);
    const oldKey = {...h.run.current};
    h.run.current = {...oldKey, section: 'main'};
    const base = {surfaceAccess: {x: 10, y: 8, z: 10, yaw: 0, level: 0, kind: 'stairwell', label: 'Surface Run'}} as StationLayout;
    h.layout = base; rt.build(base);
    expect(lanes.get(key(SURFACE_EXPLORATION_LANE, oldKey))).toMatchObject({destinations: [destination.id]});
    expect(lanes.has(key(SURFACE_EXPLORATION_LANE, h.run.current))).toBe(false);
    expect(rt.city).toBeNull(); expect(city.root.parent).toBeNull(); expect(city.sectors.stats.total).toBe(0);
    expect(pools.get('surface-run-city')!()).toEqual([]); expect(h.sectionModelKeys![0](base)).toEqual([]);
    expect(h.scene.background).toBe(originalBackground); expect((h.scene.fog as THREE.FogExp2).density).toBe(0.043); expect(h.camera.far).toBe(80); expect(h.world!.culler.maxDistance).toBe(43);
    const frames = rt.stats.frames; rt.frame(99); expect(rt.stats.frames).toBe(frames);
    expect(sourceDisposed).toBe(0);
    rt.teardown(); geometry.dispose(); material.dispose();
  });

  it('reads live map positions, closes on pause, routes access E through the existing local transition and never culls duringwarmup', () => {
    const {h, pools, requests, geometry, material} = host(), rt = installSurfaceRun(h); rt.build(layout);
    const map = info.checkpoint.map;
    h.player.x = map.x; h.player.z = map.z + 2.2;
    h.camera.position.set(map.x, 1.7, map.z + 2.2); h.camera.lookAt(map.x, map.y, map.z); h.camera.updateMatrixWorld();
    expect(rt.openMap()).toBe(true); expect(h.inputOwners![0]()).toBe(true);
    h.skywaysCar!.body!.x += 5; expect(rt.mapState()?.truck?.x).toBe(info.truck.x + 5);
    h.state = 'paused'; rt.frame(4); expect(rt.mapOpen).toBe(false);
    h.state = 'playing'; const updates = rt.city!.sectors.stats.updates; h.warming = true; rt.beforeRender(); expect(rt.city!.sectors.stats.updates).toBe(updates); h.warming = false;
    const returned = surfaceAccessDoorPose(info.checkpoint.return, true);
    h.player.x = info.checkpoint.return.x; h.player.z = info.checkpoint.return.z;
    h.camera.position.set(h.player.x, 1.7, h.player.z); h.camera.lookAt(returned.x, 1.25, returned.z); h.camera.updateMatrixWorld();
    expect(rt.accessAimed()).toBe(true); expect(h.interactHandlers[0]()).toBe(true); expect(requests).toEqual(['main']);
    rt.teardown(); expect(pools.get('surface-run-access')!()).toEqual([]); geometry.dispose(); material.dispose();
  });
});
