// Task studio-survivor-market-20261108-005807-01 (lane LEVEL): THE SURVIVOR MARKET's look — the builder's market finishes (corrugated metal,
// plywood, the roof sheeting; the platform / track keep the station rule), the slow ceiling fans (they turn every frame), the stall
// awnings, and the shed's ordinary (never green) haze that the teardown restores exactly.
import {describe, expect, it} from 'vitest';
import * as THREE from 'three';
import {installCanvasShim} from './helpers/canvas2d';
import {fakeEnvTextures} from './helpers/openablesFixture';
import {WorldMaterials} from '../src/world/materials';
import {buildWorld} from '../src/world/builder';
import {MARKET_FOG, MarketVisuals, buildMarketView, turnFans} from '../src/world/marketVisuals';
import {MARKET_KEYS, marketAreaClass} from '../src/world/marketArch';
import {finishClass} from '../src/damage/impactFinish';
import {isArchFinish} from '../src/world/finishAt';
import {MOOD} from '../src/world/lights';
import {LEVELS} from '../src/levels/registry';
import type {StationLayout} from '../src/gen/stationTypes';

installCanvasShim(false);
// (task studio-market-rework-20261108-074144-01: layout version 1's look; version 2's is tests/market-settlement-look.test.ts)
const L = LEVELS.market.generate('main', {levelSeed: 77, layoutVersion: 1}) as StationLayout;

describe('the Survivor Market look', () => {
  it('the builder draws the market finishes (walls / roof / plywood / deck), arch-owned for impacts; the platform keeps its slab', () => {
    const mats = new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17});
    const w = buildWorld(L, mats, {});
    expect(w.marketArch).toBeDefined();
    const names = new Set<string>();
    w.group.traverse(o => { if ((o as THREE.Mesh).isMesh) names.add(((o as THREE.Mesh).material as THREE.Material).name || o.name); });
    const used = [...names].join(' ');
    for (const k of [MARKET_KEYS.wall, MARKET_KEYS.roof, MARKET_KEYS.ply, MARKET_KEYS.deck]) expect(used, k).toContain(k);
    for (const k of Object.values(MARKET_KEYS)) { expect(isArchFinish(k)).toBe(true); expect(finishClass(k), k).not.toBeNull(); }
    expect(marketAreaClass(L.areas[L.platform])).toBe('platform');
    // the open shed (square / platform / bed) is the culler's atrium; the rooms under the deck and the deck itself are not
    const at = w.marketArch!.atrium, cellAt = (x: number, z: number) => L.grid.idx(...L.grid.cellOf(x, z));
    expect(at[cellAt(L.playerSpawn.x, L.playerSpawn.z)]).toBe(1);
    for (const s of L.market!.spots) if (s.level === 1 || s.kind === 'cook' || s.kind === 'work') expect(at[cellAt(s.x, s.z)], s.kind).toBe(0);
    expect(w.marketArch!.floorKey(0, L.grid.idx(...L.grid.cellOf(L.playerSpawn.x, L.playerSpawn.z)))).toBeNull(); // the platform slab
    // a non-market layout gets no market arch
    expect(buildWorld(LEVELS.subway.generate('main', {levelSeed: 77}), mats, {}).marketArch).toBeUndefined();
  });

  it('fans turn slowly every frame; one awning per stall; the haze is ordinary (not green) and restored exactly on teardown', () => {
    const v = buildMarketView(L)!;
    expect(v.fans.length).toBeGreaterThanOrEqual(5);
    expect(v.awnings).toBe(6);
    const m0 = new THREE.Matrix4(), m1 = new THREE.Matrix4();
    v.rotors!.getMatrixAt(0, m0);
    turnFans(v, 0.5);
    v.rotors!.getMatrixAt(0, m1);
    expect(m0.equals(m1)).toBe(false);
    const p0 = new THREE.Vector3().setFromMatrixPosition(m0), p1 = new THREE.Vector3().setFromMatrixPosition(m1);
    expect(p0.distanceTo(p1)).toBeLessThan(1e-9); // spins in place

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(MOOD.fogColor, MOOD.fogDensity);
    const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 70);
    const culler = {maxDistance: 30};
    const host = {scene, camera, world: {culler}, sectionHooks: [] as {build?(l: StationLayout): void; teardown?(): void}[], frameHooks: [] as ((dt: number) => void)[]};
    const mv = new MarketVisuals(host).install();
    host.sectionHooks[0].build!(L);
    expect(scene.getObjectByName('market-visuals')).toBeDefined();
    const fog = scene.fog as THREE.FogExp2;
    expect(fog.density).toBe(MARKET_FOG.density);
    const c = fog.color; // warm dusty brown: red >= green >= blue, never a green cast
    expect(c.r).toBeGreaterThanOrEqual(c.g);
    expect(c.g).toBeGreaterThanOrEqual(c.b);
    expect(camera.far).toBeGreaterThanOrEqual(MARKET_FOG.far);
    host.frameHooks[0](1 / 60);
    host.sectionHooks[0].teardown!();
    expect(scene.getObjectByName('market-visuals')).toBeUndefined();
    expect([fog.density, fog.color.getHex(), camera.far]).toEqual([MOOD.fogDensity, new THREE.Color(MOOD.fogColor).getHex(), 70]);
    expect(mv.counts).toEqual({builds: 1, teardowns: 1});
    // another level: nothing built, the indoor fog untouched
    host.sectionHooks[0].build!(LEVELS.subway.generate('main', {levelSeed: 77}));
    expect(scene.getObjectByName('market-visuals')).toBeUndefined();
    expect(fog.density).toBe(MOOD.fogDensity);
  });
});
