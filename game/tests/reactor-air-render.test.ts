// Task reactor-build-20261101 (lane AIR): the Reactor's depth gas in the volumetric march — the reactor-only variant compiles for BOTH
// WebGPURenderer backends (no GPU) with the same structural guarantees as the base march (bounded loop, one shadow compare in
// uniform control flow, explicit-LOD lookups only); every other level builds exactly the previous program (no depth code); the
// VolumetricAtmosphere plumbing: compiled only for layout.reactor at setStation, setDepthGas copies the SAME table the exposure reads
// into the uniforms and gates the term (closed once the pit is clear), ignored elsewhere.
import {describe, expect, it} from 'vitest';
import * as THREE from 'three';
import {generateStation} from '../src/gen/station';
import type {StationLayout} from '../src/gen/stationTypes';
import {VolumetricAtmosphere} from '../src/render/volumetric';
import {VF_DEPTH_MARK, VF_MARK, createFogUniforms, createMarchMaterial} from '../src/render/volumetricShaders';
import {REACTOR_AIR, REACTOR_GAS_LOOK, ReactorAir} from '../src/world/reactor/air';
import {emptyReactorState} from '../src/world/reactor/runState';
import {compileQuad} from './helpers/fogCompile';
import {fixtureInfo} from './reactor-air-fixture';

const textures = (shadow: boolean) => {
  const sh = new THREE.DepthTexture(8, 8);
  sh.compareFunction = THREE.LessEqualCompare;
  const arr = (c: number) => new THREE.DataArrayTexture(new Uint8Array(4 * c), 1, 1, 4);
  return {depth: new THREE.DepthTexture(8, 8), noise: new THREE.Data3DTexture(new Uint8Array(64), 2, 2, 4), density: arr(4), air: arr(1), vis: arr(1), shadow: shadow ? sh : null};
};
const lines = (src: string) => src.split('\n');
const indent = (l: string) => (l.match(/^\t*/)?.[0].length ?? 0);
/** Generated code modulo three's global node-buffer ids (they shift with every uniform ever created). */
const norm = (s: string) => { const m = new Map<string, number>(); return s.replace(/(NodeBuffer_|buffer)(\d+)/g, (_, p: string, d: string) => { if (!m.has(d)) m.set(d, m.size); return `${p}#${m.get(d)}`; }); };

describe('reactor air: the depth term in the march', () => {
  it('compiles for GLSL ES 3.0 + WGSL (bounded loop, one shadow compare in uniform control flow, explicit LOD only)', () => {
    for (const backend of ['glsl', 'wgsl'] as const) for (const shadow of [false, true]) {
      const u = createFogUniforms();
      const f = compileQuad(createMarchMaterial(u, textures(shadow), {steps: 14, depth: true}), backend).fragment;
      expect(f, backend).toContain(VF_MARK.march);
      expect(f, backend).toContain(VF_DEPTH_MARK);
      expect(f).toMatch(backend === 'glsl' ? /for \( int i = 0; i < 14; i \+\+ \)/ : /for \( var i : i32 = 0; i < 14; i \+\+ \)/);
      if (backend === 'wgsl') {
        const cmp = lines(f).filter(l => l.includes('textureSampleCompare('));
        expect(cmp.length).toBe(shadow ? 1 : 0);
        if (shadow) expect(indent(cmp[0])).toBe(indent(lines(f).find(l => /for \( var i : i32/.test(l))!) + 1);
        expect(lines(f).filter(l => /textureSample\(/.test(l))).toEqual([]);
      }
    }
  });

  it('every other level: no depth code, and {depth: false} is exactly the default program', () => {
    for (const backend of ['glsl', 'wgsl'] as const) {
      const a = compileQuad(createMarchMaterial(createFogUniforms(), textures(true), {steps: 14}), backend).fragment;
      const b = compileQuad(createMarchMaterial(createFogUniforms(), textures(true), {steps: 14, depth: false}), backend).fragment;
      expect(a).not.toContain(VF_DEPTH_MARK);
      expect(norm(a)).toBe(norm(b));
    }
  });

  it('uniforms: the table size, the gate off, the look', () => {
    const u = createFogUniforms();
    // (lane FOG, task reactor-submit-roof-fog-20261102: the table is a TABLE_N x 1 float data texture, not a uniform array)
    expect((u.depthTab as unknown as {value: THREE.DataTexture}).value.image.data.length).toBe(REACTOR_AIR.TABLE_N);
    expect(u.depthOn.value).toBe(0);
    expect(u.depthK.value.x).toBeCloseTo(REACTOR_GAS_LOOK.ext, 9);
  });
});

describe('reactor air: VolumetricAtmosphere plumbing (no GPU)', () => {
  const base = generateStation(20261101);
  const make = () => new VolumetricAtmosphere(null, {flashlight: new THREE.SpotLight()}, 'high');
  const sync = (a: VolumetricAtmosphere) => a.sync(new THREE.Scene(), new THREE.PerspectiveCamera(), 1);

  it('another level: the term is not compiled and setDepthGas is ignored', () => {
    const a = make();
    a.setStation(base, null);
    const air = new ReactorAir(fixtureInfo(), {x0: 0, z0: 0, x1: 80, z1: 80}, emptyReactorState(3, 3));
    a.setDepthGas(air.renderTable());
    sync(a);
    expect(a.depthDebug()).toMatchObject({compiled: false, on: false, uploads: 0});
    expect(a.u.depthOn.value).toBe(0);
  });

  it('the Reactor: compiled at setStation; the strata table -> the uniforms (the exposure table, bit for bit), the gate closes when clear', () => {
    const a = make();
    a.setStation({...base, reactor: fixtureInfo()} as StationLayout, null);
    expect(a.depthDebug().compiled).toBe(true);
    expect(a.u.depthOn.value).toBe(0); // nothing until the runtime uploads
    const st = emptyReactorState(3, 3), air = new ReactorAir(fixtureInfo(), {x0: 0, z0: 0, x1: 80, z1: 80}, st);
    a.setDepthGas(air.renderTable());
    sync(a);
    expect(a.u.depthOn.value).toBe(1);
    expect(a.depthTable).toEqual(air.table); // the texels the march loads (lane FOG: the table texture's data)
    const r = a.u.depthRange.value as THREE.Vector4;
    expect([r.x, r.y]).toEqual([air.yLo, air.yHi]);
    expect(r.z).toBeCloseTo(1 / (air.yHi - air.yLo), 9);
    expect((a.u.depthRect.value as THREE.Vector4).toArray()).toEqual([0, 0, 80, 80]);
    // the pit clears: the strata are gone (task reactor-expansion-20261101, lane GASLIGHT: the term stays on for the toxic air above the
    // OPEN pit top — the fixture's roof is 14 m up — so the gate only closes on a pit without an opening)
    air.clearAll(1, 0);
    air.update(2);
    a.setDepthGas(air.renderTable());
    sync(a);
    expect(Math.max(...a.depthTable)).toBe(0);
    expect(a.u.depthOn.value).toBe(1);
    expect(a.depthDebug()).toMatchObject({compiled: true, on: true, uploads: 2});
    const shut = fixtureInfo();
    const flat = new ReactorAir({...shut, pit: {...shut.pit, roofY: shut.pit.rimY}}, {x0: 0, z0: 0, x1: 80, z1: 80}, emptyReactorState(3, 3));
    flat.clearAll(1, 0);
    flat.update(2);
    a.setDepthGas(flat.renderTable());
    sync(a);
    expect(a.u.depthOn.value).toBe(0);
    expect(a.depthDebug()).toMatchObject({compiled: true, on: false, uploads: 3});
    // back on another level: everything off again
    a.setStation(base, null);
    sync(a);
    expect(a.depthDebug()).toMatchObject({compiled: false, on: false});
    expect(Math.max(...a.depthTable)).toBe(0);
  });
});
