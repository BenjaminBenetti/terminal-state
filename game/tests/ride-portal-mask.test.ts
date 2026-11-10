// Task studio-perf-ao-train-continuity-20261110-022206-01 (lane PORTAL): the RIDE MASK (world/rideMask.ts) in the shaders and its
// CPU mirrors — inside a ride tunnel's box the station's baked light field reads zero (surfaces and the haze's in-scatter: both read
// lightFieldSample), ramping in over `fade` m at the open face (the portal plane), all dark without one (the transit); the haze there
// is the plain track-bed medium (render/atmosphere.ts mediumAt `ride`). Off = exactly as before (a zero-volume box); the programs do
// not depend on the mask's values (uniforms only, in the render group LF already binds: no new uniform buffer).
import * as THREE from 'three';
import {afterEach, describe, expect, it} from 'vitest';
import {MeshStandardNodeMaterial, NodeMaterial} from 'three/webgpu';
import {positionWorld, vec4} from 'three/tsl';
import {LEVELS, LEVEL_IDS} from '../src/levels/registry';
import {playerTrainPlacement} from '../src/gen/playerTrain';
import {stationLevels} from '../src/world/levelGeometry';
import {RIDE_MASK, RIDE_MASK_SKIN, inRideMask, rideMaskGain, setRideBedMedium, setRideMask} from '../src/world/rideMask';
import {RIDE_PORTAL, ridePortals, type Box3} from '../src/world/ridePortal';
import {RM, bindLightField, lightFieldSample, setLightFieldLevels, syncRideMask} from '../src/world/lightFieldNode';
import {ATMOSPHERE_QUALITY, atmosphereFor, buildAirMap, buildDensityMap, buildNoiseVolume, fogMotion, mediumAt, rideBedMultiplier, sampleDensityLayer, type V3} from '../src/render/atmosphere';
import {createFogUniforms, createMarchMaterial} from '../src/render/volumetricShaders';
import {compileOutputNode, compileQuad} from './helpers/fogCompile';

const BOX: Box3 = {x0: 40, x1: 172, y0: -1.18, y1: 3.68, z0: 20.52, z1: 24.48};
afterEach(() => { setRideMask(null); syncRideMask(); });

describe('ride mask: the CPU mirror of the field factor', () => {
  it('off: exactly 1 everywhere (the field as before); on: 1 outside the box, 0 inside beyond the fade, a linear ramp from the open face', () => {
    const pts: [number, number, number][] = [[0, 0, 0], [41, 1, 22], [100, 2, 22.5], [39.9, 1, 22], [180, 1, 22], [100, 4, 22], [100, 1, 25]];
    for (const p of pts) expect(rideMaskGain(RIDE_MASK, ...p)).toBe(1);
    setRideMask(BOX, 40, 4);
    expect(rideMaskGain(RIDE_MASK, 39.9, 1, 22)).toBe(1); // (station side of the plane)
    expect(rideMaskGain(RIDE_MASK, 40.0001, 1, 22)).toBeCloseTo(1, 3);
    expect(rideMaskGain(RIDE_MASK, 41, 1, 22)).toBeCloseTo(0.75, 9);
    expect(rideMaskGain(RIDE_MASK, 43, 1, 22)).toBeCloseTo(0.25, 9);
    expect(rideMaskGain(RIDE_MASK, 44, 1, 22)).toBe(0);
    expect(rideMaskGain(RIDE_MASK, 120, 1, 22)).toBe(0);
    expect(rideMaskGain(RIDE_MASK, 120, 1, 25)).toBe(1); // (beside the box: the rock / rooms the box does not cover keep their field)
    expect(rideMaskGain(RIDE_MASK, 120, 3.7, 22)).toBe(1); // (above it)
    // the transit: no open face, the whole box dark
    setRideMask(BOX);
    expect(rideMaskGain(RIDE_MASK, 40.5, 1, 22)).toBe(0);
    expect(rideMaskGain(RIDE_MASK, 120, 1, 22)).toBe(0);
    setRideMask(null);
    expect(rideMaskGain(RIDE_MASK, 120, 1, 22)).toBe(1);
  });
});

describe('ride mask: the shader uniforms (world/lightFieldNode.ts RM)', () => {
  it('copied from RIDE_MASK when its version changes — at every field bind and on the per-frame field-levels sync; off = a zero-volume box', () => {
    setRideMask(BOX, 40, 4);
    setLightFieldLevels(1, 1, 1); // (StationLighting.update, every frame)
    expect(RM.lo.value.toArray()).toEqual([BOX.x0, BOX.y0, BOX.z0]);
    expect(RM.hi.value.toArray()).toEqual([BOX.x1, BOX.y1, BOX.z1]);
    expect(RM.open.value.toArray()).toEqual([40, 4, 1, BOX.y0 + RIDE_MASK_SKIN]);
    setRideMask(BOX); // (the transit: no open face)
    bindLightField(null);
    expect(RM.open.value.x).toBe(0);
    expect(RM.open.value.z).toBe(0);
    const v = RIDE_MASK.version;
    setRideBedMedium(1.234);
    expect(RIDE_MASK.version).toBe(v); // (the ride / the runtime tell their own mask by its version: a station's bed medium never bumps it)
    syncRideMask();
    expect(RM.bed.value.x).toBe(1.234);
    setRideMask(null);
    syncRideMask();
    expect(RM.lo.value.toArray()).toEqual([0, 0, 0]);
    expect(RM.hi.value.toArray()).toEqual([0, 0, 0]);
    expect(RM.open.value.z).toBe(0);
    setRideBedMedium(rideBedMultiplier(atmosphereFor(null)));
  });

  it('every program is the same whatever the mask holds (uniform values only): a lit material, the field sample, the march — both backends', () => {
    const lit = () => { const m = new NodeMaterial(); m.fragmentNode = vec4(lightFieldSample(positionWorld).amb as never, 1); return m; };
    const march = () => createMarchMaterial(createFogUniforms(), {depth: new THREE.DepthTexture(8, 8), noise: new THREE.Data3DTexture(new Uint8Array(64), 2, 2, 4),
      density: new THREE.DataArrayTexture(new Uint8Array(16), 1, 1, 4), air: new THREE.DataArrayTexture(new Uint8Array(4), 1, 1, 4), vis: new THREE.DataArrayTexture(new Uint8Array(4), 1, 1, 4), shadow: null},
    {steps: ATMOSPHERE_QUALITY.low.steps, depth: false});
    for (const backend of ['wgsl', 'glsl'] as const) {
      // (the same material objects each time: generated names follow node ids)
      const mats = [lit(), march()], out = vec4(lightFieldSample(positionWorld).dirColor as never, 1);
      const build = () => [...mats.map(m => compileQuad(m, backend).fragment), compileOutputNode(out, backend).fragment];
      const off = build();
      setRideMask(BOX, 40, 4); syncRideMask();
      const on = build();
      setRideMask(BOX); syncRideMask();
      const dark = build();
      setRideMask(null); syncRideMask();
      expect(on, backend).toEqual(off);
      expect(dark, backend).toEqual(off);
      // (a lit standard material builds with it too)
      expect(() => compileQuad(new MeshStandardNodeMaterial({color: 0x808080}) as unknown as NodeMaterial, backend)).not.toThrow();
    }
  });
});

describe('ride mask: the haze medium inside the box (render/atmosphere.ts mediumAt, the march\'s mirror)', () => {
  const noise = buildNoiseVolume();
  for (const id of LEVEL_IDS) {
    it(`${id}: off / null = bit-identical; inside = the plain track-bed medium, continuous with the station bed at the portal plane`, () => {
      const L = LEVELS[id].generate('main', {levelSeed: 4242});
      const p = playerTrainPlacement(L);
      expect(p).not.toBeNull();
      const prm = atmosphereFor(L), maps = {map: buildDensityMap(L, prm), air: buildAirMap(L), noise, motion: fogMotion(L.seed, prm)};
      const r = ridePortals(L, p!);
      const bed = rideBedMultiplier(prm, stationLevels(L)[p!.level]?.role ?? 'main');
      const off = {on: false, box: {x0: 0, x1: 0, y0: 0, y1: 0, z0: 0, z1: 0}, bedMult: bed};
      const blank = {...maps, map: {...maps.map, data: new Uint8Array(maps.map.data.length).fill(97)}, air: {...maps.air, data: new Uint8Array(maps.air.data.length)}};
      let inside = 0;
      for (const q of [r.front, r.rear]) {
        const ride = {on: true, box: q.box, bedMult: bed};
        for (let k = 0; k < 40; k++) {
          const x = q.x + q.out * (k - 10) * 1.7, y = q.bedY + 0.2 + (k % 5) * 0.9, z = q.z + ((k % 7) - 3) * 0.6;
          const pt: V3 = [x, y, z], t = 3.7 + k * 0.31;
          const a = mediumAt(pt, maps, prm, t), b = mediumAt(pt, maps, prm, t, undefined, off), c = mediumAt(pt, maps, prm, t, undefined, ride);
          expect(b).toEqual(a);
          if (!inRideMask(ride, x, y, z)) expect(c, `${id} outside`).toEqual(a);
          else {
            // the bed's multiplier and floor, the full draft — whatever rooms / floors / draft the maps hold there
            expect(c.mult).toBe(bed);
            expect({...mediumAt(pt, blank, prm, t, undefined, ride), slot: c.slot}).toEqual(c); // (`slot`: the level pick, the gas's — not the haze's)
            inside++;
          }
        }
        // continuity at the plane: the station bed's own multiplier (the density map just on the station side of the plane, on the
        // track's centre line, at walking height in the bed) is the box's (the 8-bit map stores the same quantised value)
        const [mStation] = sampleDensityLayer(maps.map, q.x - q.out * 0.75, q.z, Math.min(p!.level, maps.map.slots - 1));
        expect(Math.abs(mStation - bed) / bed, `${id} ${q.kind} bed medium vs the station bed at the plane`).toBeLessThan(0.12);
      }
      expect(inside).toBeGreaterThan(30);
      expect(RIDE_PORTAL.skin).toBe(RIDE_MASK_SKIN);
    });
  }
});
